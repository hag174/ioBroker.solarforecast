/* eslint-disable jsdoc/require-jsdoc */

export type LocationMode = 'geocode' | 'manual';
export type TimezoneMode = 'auto' | 'manual';

export interface EffectiveConfig {
    locationMode: LocationMode;
    city: string;
    countryCode: string;
    latitude: number | null;
    longitude: number | null;
    timezoneMode: TimezoneMode;
    timeZone: string;
    refreshIntervalMinutes: number;
    tiltDeg: number;
    azimuthDeg: number;
    peakPowerKwp: number;
    morningDampingPct: number;
    afternoonDampingPct: number;
}

export interface LocationResolutionConfig {
    locationMode: LocationMode;
    city: string;
    countryCode: string;
    latitude: number | null;
    longitude: number | null;
    timezoneMode: TimezoneMode;
    timeZone: string;
}

export interface GeocodingResult {
    resolvedName: string;
    countryCode: string;
    latitude: number;
    longitude: number;
    timeZone: string;
}

export interface LocationContext {
    resolvedName: string;
    countryCode: string;
    latitude: number;
    longitude: number;
    timeZone: string;
}

export interface ForecastRow {
    timestamp: string;
    localDate: string;
    localTime: string;
    energyKwh: number;
    cloudCoverPercent: number;
    gtiWm2: number;
}

export interface DailyForecast {
    date: string;
    energyKwh: number;
}

export interface PeriodSummary {
    remainingEnergyKwh: number;
    energyKwh: number;
    complete: boolean;
}

export interface ForecastSnapshot {
    location: LocationContext;
    hourly: ForecastRow[];
    daily: DailyForecast[];
    todayEnergyKwh: number;
    todayRemainingEnergyKwh: number;
    currentWeek: PeriodSummary;
    currentMonth: PeriodSummary;
}

export interface OpenMeteoForecastResponse {
    timezone?: string;
    hourly?: {
        time?: string[];
        global_tilted_irradiance?: Array<number | null>;
        cloud_cover?: Array<number | null>;
    };
}

export interface AdminLocationValidationRequest {
    city?: unknown;
    countryCode?: unknown;
    timezoneMode?: unknown;
    timezone?: unknown;
}

export interface AdminLocationValidationResponse {
    native: Record<string, string | number>;
    text: string;
    icon?: string;
    style?: Record<string, string>;
}
