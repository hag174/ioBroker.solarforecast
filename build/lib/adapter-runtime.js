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
var adapter_runtime_exports = {};
__export(adapter_runtime_exports, {
  AdapterRuntime: () => AdapterRuntime,
  HOURLY_REFRESH_INTERVAL_MS: () => HOURLY_REFRESH_INTERVAL_MS,
  REQUEST_TIMEOUT_MS: () => REQUEST_TIMEOUT_MS
});
module.exports = __toCommonJS(adapter_runtime_exports);
var import_config = require("./config");
var import_dates = require("./dates");
var import_forecast_service = require("./forecast-service");
var import_material_design_chart = require("./material-design-chart");
const MINUTE_IN_MS = 60 * 1e3;
const HOURLY_REFRESH_INTERVAL_MS = 60 * 60 * 1e3;
const REQUEST_TIMEOUT_MS = 3e4;
class AdapterRuntime {
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    var _a, _b, _c, _d, _e;
    this.forecastService = (_a = options.forecastService) != null ? _a : new import_forecast_service.ForecastService();
    this.now = (_b = options.now) != null ? _b : (() => /* @__PURE__ */ new Date());
    this.scheduleTimeout = (_c = options.setTimeout) != null ? _c : setTimeout;
    this.cancelTimeout = (_d = options.clearTimeout) != null ? _d : clearTimeout;
    this.createAbortController = (_e = options.createAbortController) != null ? _e : (() => new AbortController());
  }
  refreshTimer;
  activeRefresh;
  activeAbortController;
  activeTimeout;
  isUnloading = false;
  forecastService;
  now;
  scheduleTimeout;
  cancelTimeout;
  createAbortController;
  async onReady() {
    this.isUnloading = false;
    await this.ensureStaticObjects();
    await this.adapter.setStateAsync("info.connection", { val: false, ack: true });
    await this.adapter.setStateAsync("info.lastError", { val: "", ack: true });
    await this.refreshForecast("startup");
    this.refreshTimer = this.adapter.setInterval(() => {
      void this.refreshForecast("timer");
    }, this.getRefreshIntervalMs());
  }
  onUnload(callback) {
    try {
      this.isUnloading = true;
      if (this.refreshTimer) {
        this.adapter.clearInterval(this.refreshTimer);
        this.refreshTimer = void 0;
      }
      this.abortActiveRefresh(new Error("Adapter is unloading."));
      callback();
    } catch (error) {
      this.adapter.log.error(`Error during unloading: ${this.toErrorMessage(error)}`);
      callback();
    }
  }
  async refreshForecast(trigger = "manual") {
    if (this.activeRefresh) {
      if (trigger === "timer") {
        this.adapter.log.warn(
          "Skipping scheduled forecast refresh because the previous refresh is still running."
        );
      }
      return this.activeRefresh;
    }
    const refreshPromise = this.runRefresh().finally(() => {
      if (this.activeRefresh === refreshPromise) {
        this.activeRefresh = void 0;
      }
    });
    this.activeRefresh = refreshPromise;
    return refreshPromise;
  }
  async runRefresh() {
    const config = (0, import_config.resolveEffectiveConfig)(this.adapter.config);
    const { signal, dispose } = this.createRefreshAbortContext();
    try {
      const snapshot = await this.forecastService.fetchSnapshot(config, signal);
      if (this.isUnloading) {
        return;
      }
      await this.writeSnapshot(snapshot);
      await this.adapter.setStateAsync("info.connection", { val: true, ack: true });
      await this.adapter.setStateAsync("info.lastError", { val: "", ack: true });
      await this.adapter.setStateAsync("info.lastUpdate", { val: this.now().toISOString(), ack: true });
    } catch (error) {
      if (this.isUnloading && signal.aborted) {
        return;
      }
      const message = this.getRefreshErrorMessage(error, signal);
      this.adapter.log.error(`Forecast refresh failed: ${message}`);
      await this.adapter.setStateAsync("info.connection", { val: false, ack: true });
      await this.adapter.setStateAsync("info.lastError", { val: message, ack: true });
    } finally {
      dispose();
    }
  }
  createRefreshAbortContext() {
    const abortController = this.createAbortController();
    const timeoutHandle = this.scheduleTimeout(() => {
      abortController.abort(new Error(`Open-Meteo request timed out after ${REQUEST_TIMEOUT_MS} ms.`));
    }, REQUEST_TIMEOUT_MS);
    this.activeAbortController = abortController;
    this.activeTimeout = timeoutHandle;
    return {
      signal: abortController.signal,
      dispose: () => {
        this.cancelTimeout(timeoutHandle);
        if (this.activeTimeout === timeoutHandle) {
          this.activeTimeout = void 0;
        }
        if (this.activeAbortController === abortController) {
          this.activeAbortController = void 0;
        }
      }
    };
  }
  abortActiveRefresh(reason) {
    if (this.activeTimeout) {
      this.cancelTimeout(this.activeTimeout);
      this.activeTimeout = void 0;
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort(reason);
      this.activeAbortController = void 0;
    }
  }
  getRefreshErrorMessage(error, signal) {
    if (signal.aborted && signal.reason !== void 0) {
      return this.toErrorMessage(signal.reason);
    }
    return this.toErrorMessage(error);
  }
  getRefreshIntervalMs() {
    return (0, import_config.resolveEffectiveConfig)(this.adapter.config).refreshIntervalMinutes * MINUTE_IN_MS;
  }
  toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  async ensureStaticObjects() {
    await this.ensureChannel("info", "Information");
    await this.ensureState("info.connection", "Connection to Open-Meteo", "boolean", "indicator.connected", false);
    await this.ensureState("info.lastUpdate", "Last successful update", "string", "value.datetime", false);
    await this.ensureState("info.lastError", "Last error message", "string", "text", false);
    await this.ensureChannel("location", "Resolved location");
    await this.ensureState("location.resolvedName", "Resolved location name", "string", "text", false);
    await this.ensureState("location.countryCode", "Country code", "string", "text", false);
    await this.ensureState("location.latitude", "Latitude", "number", "value.gps.latitude", false, "\xB0");
    await this.ensureState("location.longitude", "Longitude", "number", "value.gps.longitude", false, "\xB0");
    await this.ensureState("location.timezone", "Effective timezone", "string", "text", false);
    await this.ensureChannel("summary", "Energy summaries");
    await this.ensureState(
      "summary.today.energy_kwh",
      "Today energy forecast",
      "number",
      "value.power.consumption",
      false,
      "kWh"
    );
    await this.ensureState(
      "summary.today.remaining_energy_kwh",
      "Remaining energy forecast for today",
      "number",
      "value.power.consumption",
      false,
      "kWh"
    );
    await this.ensureState(
      "summary.currentWeek.energy_kwh",
      "Current week energy forecast",
      "number",
      "value.power.consumption",
      false,
      "kWh"
    );
    await this.ensureState(
      "summary.currentWeek.remaining_energy",
      "Remaining energy forecast for the current week",
      "number",
      "value.power.consumption",
      false,
      "kWh"
    );
    await this.ensureState(
      "summary.currentWeek.complete",
      "Current week forecast complete",
      "boolean",
      "indicator",
      false
    );
    await this.ensureState(
      "summary.currentMonth.energy_kwh",
      "Current month energy forecast",
      "number",
      "value.power.consumption",
      false,
      "kWh"
    );
    await this.ensureState(
      "summary.currentMonth.remaining_energy",
      "Remaining energy forecast for the current month",
      "number",
      "value.power.consumption",
      false,
      "kWh"
    );
    await this.ensureState(
      "summary.currentMonth.complete",
      "Current month forecast complete",
      "boolean",
      "indicator",
      false
    );
    await this.ensureChannel("forecast", "Forecast data");
    await this.ensureChannel("forecast.daily", "Daily forecast data");
    await this.ensureChannel("forecast.hourly", "Hourly forecast data");
    await this.ensureChannel("forecast.hourly.timestamps", "Hourly forecast grouped by local timestamp");
    await this.ensureChannel("forecast.json", "JSON mirrors");
    await this.ensureState(
      "forecast.json.hourlyToday",
      "Today hourly Material Design chart JSON",
      "string",
      "json",
      false
    );
    await this.ensureState(
      "forecast.json.hourlyTomorrow",
      "Tomorrow hourly Material Design chart JSON",
      "string",
      "json",
      false
    );
    await this.ensureState("forecast.json.daily", "Daily Material Design chart JSON", "string", "json", false);
    await this.ensureState("forecast.json.summary", "Summary JSON", "string", "json", false);
    await this.cleanupLegacyJsonStates();
    for (let index = 0; index < 7; index++) {
      const prefix = `forecast.daily.day${index}`;
      await this.ensureChannel(prefix, `Daily forecast day ${index}`);
      await this.ensureState(`${prefix}.date`, `Date for day ${index}`, "string", "value.date", false);
      await this.ensureState(
        `${prefix}.energy_kwh`,
        `Energy for day ${index}`,
        "number",
        "value.power.consumption",
        false,
        "kWh"
      );
    }
  }
  async writeSnapshot(snapshot) {
    await this.writeLocationStates(snapshot);
    await this.writeSummaryStates(snapshot);
    await this.writeDailyStates(snapshot.daily);
    await this.syncHourlyStates(snapshot.hourly);
    const { todayRows, tomorrowRows } = this.splitHourlyRows(snapshot.hourly);
    await this.adapter.setStateAsync("forecast.json.hourlyToday", {
      val: JSON.stringify((0, import_material_design_chart.formatHourlyMaterialDesignChart)(todayRows)),
      ack: true
    });
    await this.adapter.setStateAsync("forecast.json.hourlyTomorrow", {
      val: JSON.stringify((0, import_material_design_chart.formatHourlyMaterialDesignChart)(tomorrowRows)),
      ack: true
    });
    await this.adapter.setStateAsync("forecast.json.daily", {
      val: JSON.stringify((0, import_material_design_chart.formatDailyMaterialDesignChart)(snapshot.daily)),
      ack: true
    });
    await this.adapter.setStateAsync("forecast.json.summary", {
      val: JSON.stringify({
        todayEnergyKwh: snapshot.todayEnergyKwh,
        todayRemainingEnergyKwh: snapshot.todayRemainingEnergyKwh,
        currentWeek: snapshot.currentWeek,
        currentMonth: snapshot.currentMonth
      }),
      ack: true
    });
  }
  async writeLocationStates(snapshot) {
    await this.adapter.setStateAsync("location.resolvedName", { val: snapshot.location.resolvedName, ack: true });
    await this.adapter.setStateAsync("location.countryCode", { val: snapshot.location.countryCode, ack: true });
    await this.adapter.setStateAsync("location.latitude", { val: snapshot.location.latitude, ack: true });
    await this.adapter.setStateAsync("location.longitude", { val: snapshot.location.longitude, ack: true });
    await this.adapter.setStateAsync("location.timezone", { val: snapshot.location.timeZone, ack: true });
  }
  async writeSummaryStates(snapshot) {
    await this.adapter.setStateAsync("summary.today.energy_kwh", { val: snapshot.todayEnergyKwh, ack: true });
    await this.adapter.setStateAsync("summary.today.remaining_energy_kwh", {
      val: snapshot.todayRemainingEnergyKwh,
      ack: true
    });
    await this.adapter.setStateAsync("summary.currentWeek.energy_kwh", {
      val: snapshot.currentWeek.energyKwh,
      ack: true
    });
    await this.adapter.setStateAsync("summary.currentWeek.remaining_energy", {
      val: snapshot.currentWeek.remainingEnergyKwh,
      ack: true
    });
    await this.adapter.setStateAsync("summary.currentWeek.complete", {
      val: snapshot.currentWeek.complete,
      ack: true
    });
    await this.adapter.setStateAsync("summary.currentMonth.energy_kwh", {
      val: snapshot.currentMonth.energyKwh,
      ack: true
    });
    await this.adapter.setStateAsync("summary.currentMonth.remaining_energy", {
      val: snapshot.currentMonth.remainingEnergyKwh,
      ack: true
    });
    await this.adapter.setStateAsync("summary.currentMonth.complete", {
      val: snapshot.currentMonth.complete,
      ack: true
    });
  }
  async writeDailyStates(days) {
    for (let index = 0; index < days.length; index++) {
      const day = days[index];
      await this.adapter.setStateAsync(`forecast.daily.day${index}.date`, { val: day.date, ack: true });
      await this.adapter.setStateAsync(`forecast.daily.day${index}.energy_kwh`, {
        val: day.energyKwh,
        ack: true
      });
    }
  }
  splitHourlyRows(rows) {
    const uniqueDates = Array.from(new Set(rows.map((row) => row.localDate)));
    const todayDate = uniqueDates[0];
    const tomorrowDate = uniqueDates[1];
    return {
      todayRows: todayDate ? rows.filter((row) => row.localDate === todayDate) : [],
      tomorrowRows: tomorrowDate ? rows.filter((row) => row.localDate === tomorrowDate) : []
    };
  }
  async cleanupLegacyJsonStates() {
    const legacyHourlyStateId = "forecast.json.hourly";
    const adapterObjects = await this.adapter.getAdapterObjectsAsync();
    if (`${this.adapter.namespace}.${legacyHourlyStateId}` in adapterObjects) {
      await this.adapter.delObjectAsync(legacyHourlyStateId);
    }
  }
  async syncHourlyStates(rows) {
    const desiredChannels = /* @__PURE__ */ new Set();
    const stateKeys = (0, import_dates.createHourlyStateKeys)(rows.map((row) => row.timestamp));
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const channelId = `forecast.hourly.timestamps.${stateKeys[index]}`;
      desiredChannels.add(channelId);
      await this.ensureChannel(channelId, row.timestamp);
      await this.ensureState(`${channelId}.timestamp`, "Local forecast timestamp", "string", "text", false);
      await this.ensureState(`${channelId}.local_date`, "Local forecast date", "string", "value.date", false);
      await this.ensureState(`${channelId}.local_time`, "Local forecast time", "string", "text", false);
      await this.ensureState(
        `${channelId}.energy_kwh`,
        "Forecast energy for this hour",
        "number",
        "value.power.consumption",
        false,
        "kWh"
      );
      await this.ensureState(
        `${channelId}.cloud_cover_percent`,
        "Cloud cover for this hour",
        "number",
        "value",
        false,
        "%"
      );
      await this.ensureState(
        `${channelId}.gti_wm2`,
        "Global tilted irradiance for this hour",
        "number",
        "value",
        false,
        "W/m\xB2"
      );
      await this.adapter.setStateAsync(`${channelId}.timestamp`, { val: row.timestamp, ack: true });
      await this.adapter.setStateAsync(`${channelId}.local_date`, { val: row.localDate, ack: true });
      await this.adapter.setStateAsync(`${channelId}.local_time`, { val: row.localTime, ack: true });
      await this.adapter.setStateAsync(`${channelId}.energy_kwh`, { val: row.energyKwh, ack: true });
      await this.adapter.setStateAsync(`${channelId}.cloud_cover_percent`, {
        val: row.cloudCoverPercent,
        ack: true
      });
      await this.adapter.setStateAsync(`${channelId}.gti_wm2`, { val: row.gtiWm2, ack: true });
    }
    const adapterObjects = await this.adapter.getAdapterObjectsAsync();
    const staleChannels = /* @__PURE__ */ new Set();
    const prefix = `${this.adapter.namespace}.forecast.hourly.timestamps.`;
    for (const fullId of Object.keys(adapterObjects)) {
      if (!fullId.startsWith(prefix)) {
        continue;
      }
      const relativeId = fullId.slice(this.adapter.namespace.length + 1);
      const segments = relativeId.split(".");
      if (segments.length < 4) {
        continue;
      }
      const channelId = segments.slice(0, 4).join(".");
      if (!desiredChannels.has(channelId)) {
        staleChannels.add(channelId);
      }
    }
    for (const channelId of staleChannels) {
      await this.adapter.delObjectAsync(channelId, { recursive: true });
    }
  }
  async ensureChannel(id, name) {
    await this.adapter.setObjectNotExistsAsync(id, {
      type: "channel",
      common: {
        name
      },
      native: {}
    });
  }
  async ensureState(id, name, type, role, write, unit) {
    await this.adapter.setObjectNotExistsAsync(id, {
      type: "state",
      common: {
        name,
        type,
        role,
        read: true,
        write,
        unit
      },
      native: {}
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AdapterRuntime,
  HOURLY_REFRESH_INTERVAL_MS,
  REQUEST_TIMEOUT_MS
});
//# sourceMappingURL=adapter-runtime.js.map
