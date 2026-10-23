"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var forecast_service_exports = {};
__export(forecast_service_exports, {
  ForecastService: () => ForecastService
});
module.exports = __toCommonJS(forecast_service_exports);
var import_dates = require("./dates");
var import_location_resolver = require("./location-resolver");
var import_open_meteo_client = require("./open-meteo-client");
class ForecastService {
  /**
   * Creates a forecast service that can be stubbed in tests.
   *
   * @param client - Open-Meteo client abstraction used for geocoding and forecast requests.
   */
  constructor(client = new import_open_meteo_client.OpenMeteoClient()) {
    this.client = client;
    this.locationResolver = new import_location_resolver.LocationResolver(client);
  }
  locationResolver;
  /**
   * Resolves the configured location and calculates all public adapter outputs.
   *
   * @param config - Validated adapter configuration.
   * @param signal - Abort signal used for Open-Meteo HTTP requests.
   * @returns The full forecast snapshot for ioBroker state writes.
   */
  async fetchSnapshot(config, signal) {
    var _a, _b;
    const resolvedLocation = await this.locationResolver.resolveLocation(config, signal);
    const requestedTimeZone = config.timezoneMode === "manual" ? config.timeZone : resolvedLocation.timeZone;
    const response = await this.client.fetchForecast({
      latitude: resolvedLocation.latitude,
      longitude: resolvedLocation.longitude,
      timeZone: requestedTimeZone,
      tiltDeg: config.tiltDeg,
      azimuthDeg: config.azimuthDeg,
      signal
    });
    const effectiveTimeZone = config.timezoneMode === "manual" ? config.timeZone : response.timezone || resolvedLocation.timeZone || "UTC";
    const location = {
      ...resolvedLocation,
      timeZone: effectiveTimeZone
    };
    const allRows = this.buildHourlyRows(response, config);
    if (allRows.length === 0) {
      throw new Error("The Open-Meteo response did not contain any hourly forecast values.");
    }
    const currentDate = /* @__PURE__ */ new Date();
    const today = (0, import_dates.formatLocalDate)(currentDate, effectiveTimeZone);
    const currentHour = (0, import_dates.formatLocalHour)(currentDate, effectiveTimeZone);
    const tomorrow = (0, import_dates.addDays)(today, 1);
    const weekRange = (0, import_dates.getIsoWeekRange)(today);
    const monthRange = (0, import_dates.getMonthRange)(today);
    const daily = this.buildDailyForecast(allRows, today);
    return {
      location,
      hourly: allRows.filter((row) => row.localDate === today || row.localDate === tomorrow),
      daily,
      todayEnergyKwh: (_b = (_a = daily[0]) == null ? void 0 : _a.energyKwh) != null ? _b : 0,
      todayRemainingEnergyKwh: this.sumRemainingTodayEnergy(allRows, today, currentHour),
      currentWeek: {
        remainingEnergyKwh: this.sumRemainingEnergyForRange(
          allRows,
          currentDate,
          effectiveTimeZone,
          weekRange.endDate
        ),
        energyKwh: this.sumEnergyForRange(allRows, weekRange.startDate, weekRange.endDate),
        complete: this.isRangeComplete(allRows, weekRange.startDate, weekRange.endDate)
      },
      currentMonth: {
        remainingEnergyKwh: this.sumRemainingEnergyForRange(
          allRows,
          currentDate,
          effectiveTimeZone,
          monthRange.endDate
        ),
        energyKwh: this.sumEnergyForRange(allRows, monthRange.startDate, monthRange.endDate),
        complete: this.isRangeComplete(allRows, monthRange.startDate, monthRange.endDate)
      }
    };
  }
  buildHourlyRows(response, config) {
    var _a, _b, _c, _d, _e, _f;
    const times = (_b = (_a = response.hourly) == null ? void 0 : _a.time) != null ? _b : [];
    const irradianceValues = (_d = (_c = response.hourly) == null ? void 0 : _c.global_tilted_irradiance) != null ? _d : [];
    const cloudCoverValues = (_f = (_e = response.hourly) == null ? void 0 : _e.cloud_cover) != null ? _f : [];
    if (times.length === 0 || irradianceValues.length !== times.length || cloudCoverValues.length !== times.length) {
      throw new Error("The forecast payload is missing hourly GTI or cloud cover values.");
    }
    return times.map((timestamp, index) => {
      if (typeof timestamp !== "string") {
        throw new Error("The forecast payload contains an invalid timestamp.");
      }
      const gtiWm2 = typeof irradianceValues[index] === "number" ? irradianceValues[index] : 0;
      const cloudCoverPercent = typeof cloudCoverValues[index] === "number" ? cloudCoverValues[index] : 0;
      const dampingFactor = this.getDampingFactor(timestamp.slice(11, 16), config);
      return {
        timestamp,
        localDate: timestamp.slice(0, 10),
        localTime: timestamp.slice(11, 16),
        energyKwh: (0, import_dates.roundNumber)(gtiWm2 * config.peakPowerKwp / 1e3 * dampingFactor),
        cloudCoverPercent: (0, import_dates.roundNumber)(cloudCoverPercent, 1),
        gtiWm2: (0, import_dates.roundNumber)(gtiWm2, 2)
      };
    });
  }
  getDampingFactor(localTime, config) {
    const hour = Number(localTime.slice(0, 2));
    const dampingPct = hour < 12 ? config.morningDampingPct : config.afternoonDampingPct;
    return dampingPct / 100;
  }
  buildDailyForecast(rows, startDate) {
    var _a;
    const energyByDate = /* @__PURE__ */ new Map();
    for (const row of rows) {
      energyByDate.set(row.localDate, ((_a = energyByDate.get(row.localDate)) != null ? _a : 0) + row.energyKwh);
    }
    return Array.from({ length: 7 }, (_, offset) => {
      var _a2;
      const date = (0, import_dates.addDays)(startDate, offset);
      return {
        date,
        energyKwh: (0, import_dates.roundNumber)((_a2 = energyByDate.get(date)) != null ? _a2 : 0)
      };
    });
  }
  sumEnergyForRange(rows, startDate, endDate) {
    const totalEnergy = rows.filter((row) => row.localDate >= startDate && row.localDate <= endDate).reduce((sum, row) => sum + row.energyKwh, 0);
    return (0, import_dates.roundNumber)(totalEnergy);
  }
  sumRemainingEnergyForRange(rows, now, timeZone, endDate) {
    var _a, _b, _c, _d;
    const currentTimestamp = `${(0, import_dates.formatLocalDate)(now, timeZone)}T${(0, import_dates.formatLocalHour)(now, timeZone)}`;
    let startIndex = rows.findIndex((row) => row.timestamp >= currentTimestamp);
    if (startIndex < 0) {
      return 0;
    }
    const isRepeatedHour = [1, 2].some((hoursAgo) => {
      const previousHour = new Date(now.getTime() - hoursAgo * 60 * 60 * 1e3);
      return `${(0, import_dates.formatLocalDate)(previousHour, timeZone)}T${(0, import_dates.formatLocalHour)(previousHour, timeZone)}` === currentTimestamp;
    });
    if (isRepeatedHour && rows[startIndex].timestamp === currentTimestamp) {
      const repeatedIndex = rows.findIndex(
        (row, index) => index > startIndex && row.timestamp === currentTimestamp
      );
      if (repeatedIndex >= 0) {
        startIndex = repeatedIndex;
      }
    }
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(now);
    const minute = Number((_b = (_a = parts.find((part) => part.type === "minute")) == null ? void 0 : _a.value) != null ? _b : 0);
    const second = Number((_d = (_c = parts.find((part) => part.type === "second")) == null ? void 0 : _c.value) != null ? _d : 0);
    const remainingFraction = 1 - (minute * 60 + second + now.getUTCMilliseconds() / 1e3) / 3600;
    const totalEnergy = rows.slice(startIndex).filter((row) => row.localDate <= endDate).reduce(
      (sum, row, index) => sum + row.energyKwh * (index === 0 && row.timestamp === currentTimestamp ? remainingFraction : 1),
      0
    );
    return (0, import_dates.roundNumber)(totalEnergy);
  }
  sumRemainingTodayEnergy(rows, today, currentHour) {
    const totalEnergy = rows.filter((row) => row.localDate === today && row.localTime >= currentHour).reduce((sum, row) => sum + row.energyKwh, 0);
    return (0, import_dates.roundNumber)(totalEnergy);
  }
  isRangeComplete(rows, startDate, endDate) {
    var _a, _b;
    const firstTimestamp = (_a = rows[0]) == null ? void 0 : _a.timestamp;
    const lastTimestamp = (_b = rows.at(-1)) == null ? void 0 : _b.timestamp;
    if (!firstTimestamp || !lastTimestamp) {
      return false;
    }
    return firstTimestamp <= (0, import_dates.boundaryTimestamp)(startDate, false) && lastTimestamp >= (0, import_dates.boundaryTimestamp)(endDate, true);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ForecastService
});
//# sourceMappingURL=forecast-service.js.map
