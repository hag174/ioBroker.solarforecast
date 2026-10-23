import {
    addDays,
    boundaryTimestamp,
    formatLocalDate,
    formatLocalHour,
    getIsoWeekRange,
    getMonthRange,
    roundNumber,
} from './dates';
import { LocationResolver } from './location-resolver';
import { OpenMeteoClient } from './open-meteo-client';
import type {
    DailyForecast,
    EffectiveConfig,
    ForecastRow,
    ForecastSnapshot,
    LocationContext,
    OpenMeteoForecastResponse,
} from './types';

/**
 * Builds PV forecast snapshots from Open-Meteo geocoding and hourly forecast data.
 */
export class ForecastService {
    private readonly locationResolver: Pick<LocationResolver, 'resolveLocation'>;

    /**
     * Creates a forecast service that can be stubbed in tests.
     *
     * @param client - Open-Meteo client abstraction used for geocoding and forecast requests.
     */
    public constructor(
        private readonly client: Pick<OpenMeteoClient, 'geocode' | 'fetchForecast'> = new OpenMeteoClient(),
    ) {
        this.locationResolver = new LocationResolver(client);
    }

    /**
     * Resolves the configured location and calculates all public adapter outputs.
     *
     * @param config - Validated adapter configuration.
     * @param signal - Abort signal used for Open-Meteo HTTP requests.
     * @returns The full forecast snapshot for ioBroker state writes.
     */
    public async fetchSnapshot(config: EffectiveConfig, signal?: AbortSignal): Promise<ForecastSnapshot> {
        const resolvedLocation = await this.locationResolver.resolveLocation(config, signal);
        const requestedTimeZone = config.timezoneMode === 'manual' ? config.timeZone : resolvedLocation.timeZone;
        const response = await this.client.fetchForecast({
            latitude: resolvedLocation.latitude,
            longitude: resolvedLocation.longitude,
            timeZone: requestedTimeZone,
            tiltDeg: config.tiltDeg,
            azimuthDeg: config.azimuthDeg,
            signal,
        });

        const effectiveTimeZone =
            config.timezoneMode === 'manual'
                ? config.timeZone
                : response.timezone || resolvedLocation.timeZone || 'UTC';

        const location: LocationContext = {
            ...resolvedLocation,
            timeZone: effectiveTimeZone,
        };

        const allRows = this.buildHourlyRows(response, config);
        if (allRows.length === 0) {
            throw new Error('The Open-Meteo response did not contain any hourly forecast values.');
        }

        const currentDate = new Date();
        const today = formatLocalDate(currentDate, effectiveTimeZone);
        const currentHour = formatLocalHour(currentDate, effectiveTimeZone);
        const tomorrow = addDays(today, 1);
        const weekRange = getIsoWeekRange(today);
        const monthRange = getMonthRange(today);

        const daily = this.buildDailyForecast(allRows, today);

        return {
            location,
            hourly: allRows.filter(row => row.localDate === today || row.localDate === tomorrow),
            daily,
            todayEnergyKwh: daily[0]?.energyKwh ?? 0,
            todayRemainingEnergyKwh: this.sumRemainingTodayEnergy(allRows, today, currentHour),
            currentWeek: {
                remainingEnergyKwh: this.sumRemainingEnergyForRange(
                    allRows,
                    currentDate,
                    effectiveTimeZone,
                    weekRange.endDate,
                ),
                energyKwh: this.sumEnergyForRange(allRows, weekRange.startDate, weekRange.endDate),
                complete: this.isRangeComplete(allRows, weekRange.startDate, weekRange.endDate),
            },
            currentMonth: {
                remainingEnergyKwh: this.sumRemainingEnergyForRange(
                    allRows,
                    currentDate,
                    effectiveTimeZone,
                    monthRange.endDate,
                ),
                energyKwh: this.sumEnergyForRange(allRows, monthRange.startDate, monthRange.endDate),
                complete: this.isRangeComplete(allRows, monthRange.startDate, monthRange.endDate),
            },
        };
    }

    private buildHourlyRows(response: OpenMeteoForecastResponse, config: EffectiveConfig): ForecastRow[] {
        const times = response.hourly?.time ?? [];
        const irradianceValues = response.hourly?.global_tilted_irradiance ?? [];
        const cloudCoverValues = response.hourly?.cloud_cover ?? [];

        if (
            times.length === 0 ||
            irradianceValues.length !== times.length ||
            cloudCoverValues.length !== times.length
        ) {
            throw new Error('The forecast payload is missing hourly GTI or cloud cover values.');
        }

        return times.map((timestamp, index) => {
            if (typeof timestamp !== 'string') {
                throw new Error('The forecast payload contains an invalid timestamp.');
            }

            const gtiWm2 = typeof irradianceValues[index] === 'number' ? irradianceValues[index] : 0;
            const cloudCoverPercent = typeof cloudCoverValues[index] === 'number' ? cloudCoverValues[index] : 0;
            const dampingFactor = this.getDampingFactor(timestamp.slice(11, 16), config);

            return {
                timestamp,
                localDate: timestamp.slice(0, 10),
                localTime: timestamp.slice(11, 16),
                energyKwh: roundNumber(((gtiWm2 * config.peakPowerKwp) / 1000) * dampingFactor),
                cloudCoverPercent: roundNumber(cloudCoverPercent, 1),
                gtiWm2: roundNumber(gtiWm2, 2),
            };
        });
    }

    private getDampingFactor(localTime: string, config: EffectiveConfig): number {
        const hour = Number(localTime.slice(0, 2));
        const dampingPct = hour < 12 ? config.morningDampingPct : config.afternoonDampingPct;
        return dampingPct / 100;
    }

    private buildDailyForecast(rows: ForecastRow[], startDate: string): DailyForecast[] {
        const energyByDate = new Map<string, number>();
        for (const row of rows) {
            energyByDate.set(row.localDate, (energyByDate.get(row.localDate) ?? 0) + row.energyKwh);
        }

        return Array.from({ length: 7 }, (_, offset) => {
            const date = addDays(startDate, offset);
            return {
                date,
                energyKwh: roundNumber(energyByDate.get(date) ?? 0),
            };
        });
    }

    private sumEnergyForRange(rows: ForecastRow[], startDate: string, endDate: string): number {
        const totalEnergy = rows
            .filter(row => row.localDate >= startDate && row.localDate <= endDate)
            .reduce((sum, row) => sum + row.energyKwh, 0);

        return roundNumber(totalEnergy);
    }

    private sumRemainingEnergyForRange(rows: ForecastRow[], now: Date, timeZone: string, endDate: string): number {
        const currentTimestamp = `${formatLocalDate(now, timeZone)}T${formatLocalHour(now, timeZone)}`;
        let startIndex = rows.findIndex(row => row.timestamp >= currentTimestamp);
        if (startIndex < 0) {
            return 0;
        }

        // During DST fallback, skip the first occurrence if we are in the repeated hour.
        const isRepeatedHour = [1, 2].some(hoursAgo => {
            const previousHour = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
            return (
                `${formatLocalDate(previousHour, timeZone)}T${formatLocalHour(previousHour, timeZone)}` ===
                currentTimestamp
            );
        });
        if (isRepeatedHour && rows[startIndex].timestamp === currentTimestamp) {
            const repeatedIndex = rows.findIndex(
                (row, index) => index > startIndex && row.timestamp === currentTimestamp,
            );
            if (repeatedIndex >= 0) {
                startIndex = repeatedIndex;
            }
        }

        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone,
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(now);
        const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0);
        const second = Number(parts.find(part => part.type === 'second')?.value ?? 0);
        const remainingFraction = 1 - (minute * 60 + second + now.getUTCMilliseconds() / 1000) / 3600;
        const totalEnergy = rows
            .slice(startIndex)
            .filter(row => row.localDate <= endDate)
            .reduce(
                (sum, row, index) =>
                    sum + row.energyKwh * (index === 0 && row.timestamp === currentTimestamp ? remainingFraction : 1),
                0,
            );

        return roundNumber(totalEnergy);
    }

    private sumRemainingTodayEnergy(rows: ForecastRow[], today: string, currentHour: string): number {
        const totalEnergy = rows
            .filter(row => row.localDate === today && row.localTime >= currentHour)
            .reduce((sum, row) => sum + row.energyKwh, 0);

        return roundNumber(totalEnergy);
    }

    private isRangeComplete(rows: ForecastRow[], startDate: string, endDate: string): boolean {
        const firstTimestamp = rows[0]?.timestamp;
        const lastTimestamp = rows.at(-1)?.timestamp;

        if (!firstTimestamp || !lastTimestamp) {
            return false;
        }

        return (
            firstTimestamp <= boundaryTimestamp(startDate, false) && lastTimestamp >= boundaryTimestamp(endDate, true)
        );
    }
}
