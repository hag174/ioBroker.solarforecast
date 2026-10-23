![Logo](admin/solarforecast.png)

# ioBroker.solarforecast

Solar forecast adapter for ioBroker using Open-Meteo.

## What the adapter does

- Resolves a location either by city name or manual coordinates
- Retrieves hourly `global_tilted_irradiance` and `cloud_cover` from Open-Meteo
- Calculates hourly PV energy in `kWh` from irradiance and configured peak power
- Applies separate morning and afternoon damping factors to the PV energy
- Publishes hourly forecast data for today and tomorrow
- Publishes daily totals for today plus the next 6 days
- Exposes widget-ready Material Design chart JSON for hourly and daily energy forecasts
- Publishes current calendar week and current calendar month totals
- Exposes completeness flags when week or month values are only partially covered by the API

## Configuration

The adapter uses a JSON Config based admin UI with these fields:

- `locationMode`: `geocode` or `manual`
- `city`: default `Berlin`
- `countryCode`: optional ISO country code such as `DE`
- `latitude` and `longitude`: auto-filled after a successful city check and editable in manual mode
- `timezoneMode`: `auto` or `manual`
- `timezone`: manual override, default `Europe/Berlin`
- `refreshIntervalMinutes`: forecast refresh interval after startup, default `60`
- `tiltDeg`: panel tilt in degrees, default `0`
- `azimuthDeg`: panel azimuth in degrees, default `0`
- `peakPowerKwp`: installed PV peak power in `kWp`, default `2.2`
- `morningDampingPct`: damping factor in percent for `00:00` to `11:59`, default `100`
- `afternoonDampingPct`: damping factor in percent for `12:00` to `23:59`, default `100`

In geocode mode the settings dialog can validate the configured city directly against Open-Meteo.
Successful validation updates the effective coordinates and timezone preview in the form and enables saving while the current city selection stays unchanged.
The validation endpoint accepts only admin-originated requests, uses a 10 second server-side timeout, and throttles repeated checks for one second.

The adapter refreshes the forecast on startup and then at the configured minute interval.
The default interval is 60 minutes.
Each Open-Meteo refresh uses a 30 second request timeout and skips overlapping scheduled runs while a previous refresh is still active.

## Exposed states

- `info.connection`
- `info.lastUpdate`
- `info.lastError`
- `location.resolvedName`
- `location.countryCode`
- `location.latitude`
- `location.longitude`
- `location.timezone`
- `summary.today.energy_kwh`
- `summary.today.remaining_energy_kwh`
- `summary.currentWeek.energy_kwh`
- `summary.currentWeek.remaining_energy`
- `summary.currentWeek.complete`
- `summary.currentMonth.energy_kwh`
- `summary.currentMonth.remaining_energy`
- `summary.currentMonth.complete`
- `forecast.daily.day0..day6.date`
- `forecast.daily.day0..day6.energy_kwh`
- `forecast.hourly.timestamps.<key>.*`
- `forecast.json.hourlyToday`
- `forecast.json.hourlyTomorrow`
- `forecast.json.daily`
- `forecast.json.summary`

`summary.currentWeek.remaining_energy` is the remaining PV energy forecast in `kWh` from the time of the last successful refresh through Sunday of the current local ISO calendar week, limited to the available forecast.
It uses the same proportional current-hour calculation as the remaining monthly forecast and can include days in the next calendar month.
The summary JSON exposes it as `currentWeek.remainingEnergyKwh`. The state uses the role `value.power.consumption` and updates at the configured forecast refresh interval.
The existing `summary.currentWeek.complete` flag still describes coverage of the entire calendar week.

`summary.currentMonth.remaining_energy` is the remaining PV energy forecast in `kWh` from the time of the last successful refresh through the end of the local calendar month, limited to the available Open-Meteo forecast (16 days including today).
The current hour is prorated by its remaining time, assuming uniform production within that hour; past hours and next-month hours are excluded.
Missing future days are not extrapolated. You can add the measured month-to-date PV energy separately in ioBroker.
The existing `summary.currentMonth.complete` flag still describes coverage of the entire calendar month; the new value is also available as `currentMonth.remainingEnergyKwh` in `forecast.json.summary`.
The new state uses the role `value.power.consumption` and updates at the configured forecast refresh interval.

The hourly `<key>` is derived from the local timestamp and gains a deterministic suffix when the same local hour occurs twice during the DST fallback change.
All `*.energy_kwh` states use the ioBroker role `value.power.consumption`.
`forecast.json.hourlyToday`, `forecast.json.hourlyTomorrow`, and `forecast.json.daily` now contain `axisLabels` plus `graphs` payloads for the vis-materialdesign JSON Chart widget.
This replaces the previous combined `forecast.json.hourly` state and the earlier raw-array JSON format.

## Development

Important scripts:

| Script | Purpose |
| --- | --- |
| `npm run build` | Compile the TypeScript sources |
| `npm run check` | Run TypeScript type checking without emitting files |
| `npm run lint` | Run ESLint |
| `npm test` | Run fast local tests and package validation |
| `npm run coverage` | Run TypeScript coverage for `src/**/*.ts` with `c8` |
| `npm run test:integration` | Run the generated ioBroker integration tests with test-only Open-Meteo mocking |
| `npm run verify` | Run the full verification chain including the real adapter integration path |
| `npm run dev-server` | Start the local ioBroker dev server |

Project-specific unit tests live in `Tests/`. Template package and integration tests remain in `test/`.
`npm run test:integration` now aborts early with a clear message when a host JS-Controller is already running.

## Notes

- `Solarvorhersage.ipynb` remains in the repository as a reference prototype.
- The adapter runtime itself is implemented in TypeScript under `src/`.

## Changelog

### 0.8.0

- Added `summary.currentWeek.remaining_energy` and `summary.currentMonth.remaining_energy` in kWh, with proportional current-hour energy and local week/month boundaries.
- Added remaining energy values to the summary JSON so measured PV production can be added separately in ioBroker.
- Added automatic GitHub releases after successful tagged CI checks.

### 0.6.0

- breaking change: split the combined `forecast.json.hourly` state into `forecast.json.hourlyToday` and `forecast.json.hourlyTomorrow`
- changed the hourly and daily JSON mirrors to vis-materialdesign JSON Chart payloads
- kept `forecast.json.summary` and the existing single forecast states unchanged
- added direct adapter tests for the new chart formatter and runtime wiring

### 0.5.0

- replaced panel area and efficiency with peak power in the settings
- fixed the city validation status display in the admin dialog
- added `summary.today.remaining_energy_kwh` and `todayRemainingEnergyKwh` in `forecast.json.summary`
- added morning and afternoon damping factors for PV energy calculations

### 0.2.5

- (Hagen) renamed the adapter to SolarForecast
- (Hagen) added direct city validation and auto-filled coordinates in the admin dialog

## License

MIT License

Copyright (c) 2026 Hagen <no-reply@example.com>
