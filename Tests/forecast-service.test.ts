import { expect } from 'chai';
import sinon from 'sinon';

import { ForecastService } from '../src/lib/forecast-service';
import type { EffectiveConfig, OpenMeteoForecastResponse } from '../src/lib/types';

function createHourlyResponse(startDate: string, endDate: string): OpenMeteoForecastResponse {
    const times: string[] = [];
    const irradiance: number[] = [];
    const cloudCover: number[] = [];

    let current = new Date(`${startDate}T00:00:00Z`);
    const limit = new Date(`${endDate}T23:00:00Z`);

    while (current <= limit) {
        const isoTimestamp = current.toISOString().slice(0, 16);
        times.push(isoTimestamp);
        irradiance.push(100);
        cloudCover.push(20);
        current = new Date(current.getTime() + 60 * 60 * 1000);
    }

    return {
        timezone: 'Europe/Berlin',
        hourly: {
            time: times,
            global_tilted_irradiance: irradiance,
            cloud_cover: cloudCover,
        },
    };
}

describe('ForecastService', () => {
    const baseConfig: EffectiveConfig = {
        locationMode: 'geocode',
        city: 'Berlin',
        countryCode: 'DE',
        latitude: null,
        longitude: null,
        timezoneMode: 'auto',
        timeZone: 'auto',
        refreshIntervalMinutes: 60,
        tiltDeg: 0,
        azimuthDeg: 0,
        peakPowerKwp: 2.2,
        morningDampingPct: 100,
        afternoonDampingPct: 100,
    };

    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sinon.useFakeTimers(new Date('2026-03-20T10:00:00Z'));
    });

    afterEach(() => {
        clock.restore();
    });

    it('creates hourly, daily, weekly and monthly summaries from a complete response', async () => {
        const geocodeStub = sinon.stub().resolves({
            resolvedName: 'Berlin, Germany',
            countryCode: 'DE',
            latitude: 52.52,
            longitude: 13.405,
            timeZone: 'Europe/Berlin',
        });
        const forecastStub = sinon.stub().resolves(createHourlyResponse('2026-03-01', '2026-03-31'));

        const service = new ForecastService({
            geocode: geocodeStub,
            fetchForecast: forecastStub,
        });

        const snapshot = await service.fetchSnapshot(baseConfig);

        expect(snapshot.location.resolvedName).to.equal('Berlin, Germany');
        expect(snapshot.hourly).to.have.lengthOf(48);
        expect(snapshot.daily).to.have.lengthOf(7);
        expect(snapshot.daily[0]).to.deep.equal({
            date: '2026-03-20',
            energyKwh: 5.28,
        });
        expect(snapshot.todayEnergyKwh).to.equal(5.28);
        expect(snapshot.todayRemainingEnergyKwh).to.equal(2.86);
        expect(snapshot.currentWeek.complete).to.equal(true);
        expect(snapshot.currentMonth.complete).to.equal(true);
        expect(snapshot.currentMonth.energyKwh).to.equal(163.68);
        expect(geocodeStub.calledOnce).to.equal(true);
        expect(forecastStub.calledOnce).to.equal(true);
    });

    it('applies different morning and afternoon damping factors to hourly and aggregated energy', async () => {
        const geocodeStub = sinon.stub().resolves({
            resolvedName: 'Berlin, Germany',
            countryCode: 'DE',
            latitude: 52.52,
            longitude: 13.405,
            timeZone: 'Europe/Berlin',
        });
        const forecastStub = sinon.stub().resolves(createHourlyResponse('2026-03-20', '2026-03-20'));

        const service = new ForecastService({
            geocode: geocodeStub,
            fetchForecast: forecastStub,
        });

        const snapshot = await service.fetchSnapshot({
            ...baseConfig,
            morningDampingPct: 50,
            afternoonDampingPct: 25,
        });

        expect(snapshot.hourly).to.have.lengthOf(24);
        expect(snapshot.hourly[11]).to.include({
            localTime: '11:00',
            energyKwh: 0.11,
        });
        expect(snapshot.hourly[12]).to.include({
            localTime: '12:00',
            energyKwh: 0.055,
        });
        expect(snapshot.daily[0]).to.deep.equal({
            date: '2026-03-20',
            energyKwh: 1.98,
        });
        expect(snapshot.todayEnergyKwh).to.equal(1.98);
        expect(snapshot.todayRemainingEnergyKwh).to.equal(0.77);
    });

    it('marks the current month as partial when the response does not cover the full range', async () => {
        const geocodeStub = sinon.stub().resolves({
            resolvedName: 'Berlin, Germany',
            countryCode: 'DE',
            latitude: 52.52,
            longitude: 13.405,
            timeZone: 'Europe/Berlin',
        });
        const forecastStub = sinon.stub().resolves(createHourlyResponse('2026-03-10', '2026-03-31'));

        const service = new ForecastService({
            geocode: geocodeStub,
            fetchForecast: forecastStub,
        });

        const snapshot = await service.fetchSnapshot(baseConfig);

        expect(snapshot.currentMonth.complete).to.equal(false);
        expect(snapshot.currentWeek.complete).to.equal(true);
    });

    for (const { name, now, start, end, expected } of [
        {
            name: 'prorates the current hour and excludes past hours and the next month',
            now: '2026-03-31T10:30:00Z',
            start: '2026-03-01',
            end: '2026-04-02',
            expected: 2.53,
        },
        {
            name: 'includes the full current hour at its start',
            now: '2026-03-31T10:00:00Z',
            start: '2026-03-01',
            end: '2026-04-02',
            expected: 2.64,
        },
        {
            name: 'uses only the available forecast when month end is out of range',
            now: '2026-03-01T10:30:00Z',
            start: '2026-02-01',
            end: '2026-03-16',
            expected: 81.95,
        },
        {
            name: 'returns zero when all available hours are in the past',
            now: '2026-03-31T22:00:00Z',
            start: '2026-03-01',
            end: '2026-03-31',
            expected: 0,
        },
        {
            name: 'uses the configured timezone at a local month boundary',
            now: '2026-03-31T22:00:00Z',
            start: '2026-03-01',
            end: '2026-04-01',
            expected: 5.28,
        },
    ]) {
        it(name, async () => {
            clock.setSystemTime(new Date(now));
            const service = new ForecastService({
                geocode: sinon.stub(),
                fetchForecast: sinon.stub().resolves(createHourlyResponse(start, end)),
            });
            const snapshot = await service.fetchSnapshot({
                ...baseConfig,
                locationMode: 'manual',
                latitude: 52.52,
                longitude: 13.405,
                timezoneMode: 'manual',
                timeZone: 'Europe/Berlin',
            });

            expect(snapshot.currentMonth).to.have.property('remainingEnergyKwh', expected);
        });
    }

    for (const { now, expected } of [
        { now: '2026-10-25T00:30:00Z', expected: 0.55 },
        { now: '2026-10-25T01:30:00Z', expected: 0.33 },
    ]) {
        it(`counts only future hours during DST fallback at ${now}`, async () => {
            clock.setSystemTime(new Date(now));
            const service = new ForecastService({
                geocode: sinon.stub(),
                fetchForecast: sinon.stub().resolves({
                    timezone: 'Europe/Berlin',
                    hourly: {
                        time: ['2026-10-25T01:00', '2026-10-25T02:00', '2026-10-25T02:00', '2026-10-25T03:00'],
                        global_tilted_irradiance: [100, 100, 100, 100],
                        cloud_cover: [20, 20, 20, 20],
                    },
                }),
            });
            const snapshot = await service.fetchSnapshot({
                ...baseConfig,
                locationMode: 'manual',
                latitude: 52.52,
                longitude: 13.405,
                timezoneMode: 'manual',
                timeZone: 'Europe/Berlin',
            });

            expect(snapshot.currentMonth).to.have.property('remainingEnergyKwh', expected);
        });
    }

    it('handles a two-hour DST rollback in the configured timezone', async () => {
        clock.setSystemTime(new Date('2026-10-25T01:30:00Z'));
        const service = new ForecastService({
            geocode: sinon.stub(),
            fetchForecast: sinon.stub().resolves({
                hourly: {
                    time: ['00', '01', '02', '01', '02', '03'].map(hour => `2026-10-25T${hour}:00`),
                    global_tilted_irradiance: [100, 100, 100, 100, 100, 100],
                    cloud_cover: [20, 20, 20, 20, 20, 20],
                },
            }),
        });
        const snapshot = await service.fetchSnapshot({
            ...baseConfig,
            locationMode: 'manual',
            latitude: -72,
            longitude: 2,
            timezoneMode: 'manual',
            timeZone: 'Antarctica/Troll',
        });

        expect(snapshot.currentMonth.remainingEnergyKwh).to.equal(0.55);
    });

    for (const { name, now, start, end, expected } of [
        {
            name: 'prorates the remaining Sunday and excludes the next week',
            now: '2026-03-22T10:30:00Z',
            start: '2026-03-01',
            end: '2026-03-31',
            expected: 2.75,
        },
        {
            name: 'starts a new remaining week at local Monday midnight',
            now: '2026-03-22T23:00:00Z',
            start: '2026-03-01',
            end: '2026-03-31',
            expected: 36.96,
        },
        {
            name: 'includes next-month hours belonging to the current week',
            now: '2026-03-31T10:30:00Z',
            start: '2026-03-01',
            end: '2026-04-10',
            expected: 28.93,
        },
        {
            name: 'limits the remaining week to the available forecast',
            now: '2026-03-20T10:30:00Z',
            start: '2026-03-01',
            end: '2026-03-20',
            expected: 2.75,
        },
    ]) {
        it(name, async () => {
            clock.setSystemTime(new Date(now));
            const service = new ForecastService({
                geocode: sinon.stub(),
                fetchForecast: sinon.stub().resolves(createHourlyResponse(start, end)),
            });
            const snapshot = await service.fetchSnapshot({
                ...baseConfig,
                locationMode: 'manual',
                latitude: 52.52,
                longitude: 13.405,
                timezoneMode: 'manual',
                timeZone: 'Europe/Berlin',
            });

            expect(snapshot.currentWeek).to.have.property('remainingEnergyKwh', expected);
        });
    }

    it('skips geocoding in manual mode', async () => {
        const geocodeStub = sinon.stub();
        const forecastStub = sinon.stub().resolves(createHourlyResponse('2026-03-01', '2026-03-31'));

        const service = new ForecastService({
            geocode: geocodeStub,
            fetchForecast: forecastStub,
        });

        await service.fetchSnapshot({
            ...baseConfig,
            locationMode: 'manual',
            city: 'Roof array',
            latitude: 50.57,
            longitude: 11.82,
            timezoneMode: 'manual',
            timeZone: 'Europe/Berlin',
        });

        expect(geocodeStub.called).to.equal(false);
        expect(forecastStub.calledOnce).to.equal(true);
    });

    it('forwards abort signals to geocoding and forecast requests', async () => {
        const signal = new AbortController().signal;
        const geocodeStub = sinon.stub().resolves({
            resolvedName: 'Berlin, Germany',
            countryCode: 'DE',
            latitude: 52.52,
            longitude: 13.405,
            timeZone: 'Europe/Berlin',
        });
        const forecastStub = sinon.stub().resolves(createHourlyResponse('2026-03-01', '2026-03-31'));

        const service = new ForecastService({
            geocode: geocodeStub,
            fetchForecast: forecastStub,
        });

        await service.fetchSnapshot(baseConfig, signal);

        expect(geocodeStub.firstCall.args[2]).to.equal(signal);
        expect(forecastStub.firstCall.args[0].signal).to.equal(signal);
    });
});
