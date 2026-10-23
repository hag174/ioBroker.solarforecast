---
title: 2026_03_20_initial_implementation
type: note
permalink: solarforecast/history/2026-03-20-initial-implementation
tags:
- history
- implementation
- verification
---

# Initial Implementation

## Completed work
- Generated the repository from the official ioBroker TypeScript adapter scaffold.
- Implemented JSON Config based adapter settings for geocoding/manual coordinates, timezone handling, tilt, azimuth, peak power, and morning/afternoon damping.
- Implemented Open-Meteo geocoding and forecast clients.
- Implemented PV forecast transformation with hourly kWh calculation, daily totals for day0..day6, and calendar week/month summaries with completeness flags.
- Implemented ioBroker state writing for `info`, `location`, `summary`, `forecast.daily`, `forecast.hourly.timestamps`, and JSON mirror states.
- Updated project tests to use Mocha, Chai, and Sinon in the `Tests/` directory.
- Updated `README.md`, `AGENTS.MD`, and VS Code extension recommendations.

## Verification
- `npm run check` passed.
- `npm run lint` passed.
- `npm test` passed.
- `npm run build` passed.

## Notable implementation choices
- Hourly states are keyed by DST-safe local timestamp keys with deterministic suffixes for repeated fallback hours.
- The adapter keeps the last successful forecast values when refreshing fails and only updates connection and error states.
- Calendar week and month totals expose explicit completeness flags instead of estimating missing ranges.

## Follow-up ideas
- Improve the JSON Config UI with dynamic field visibility for geocode/manual and auto/manual timezone modes.
- Add integration tests that validate the created ioBroker state tree more directly.
- Fill or regenerate admin translations if multi-language labels become important in v1.

## VS Code test workflow
- Added the `hbenl.vscode-mocha-test-adapter` recommendation for running Mocha tests in the VS Code Testing view.
- Added workspace settings for `mochaExplorer` so VS Code discovers `Tests/**/*.test.ts`, `test/package.js`, and `test/integration.js`.
- Added a `Debug Mocha Tests` launch configuration for debugging tests from VS Code.

## VS Code Mocha Test Explorer workaround
- When test discovery failed with `spawn /usr/bin/node ENOENT`, the workspace setting `mochaExplorer.nodePath` was set to `null` so the extension uses the Node runtime bundled with VS Code instead of an externally detected binary.
- The fallback to the VS Code bundled runtime was not sufficient for one local setup, so the workspace was tightened further to `mochaExplorer.nodePath = "/bin/node"` and `mochaExplorer.mochaPath = "node_modules/mocha"`.

## VS Code test workflow update
- The legacy `hbenl.vscode-mocha-test-adapter` continues to fail in one local VS Code setup with `spawn ... ENOENT` while loading Mocha options, even though the project tests themselves run successfully from the shell.
- The workspace recommendations were updated to stop recommending that extension and to mark it as an unwanted recommendation for this repository.
- The reliable VS Code workflow for this project is now `Tasks: Run Task` for running tests and `Run and Debug` with the checked-in launch configurations for debugging Mocha tests.
- `mochaExplorer.autoload` remains disabled so the broken extension does not spam automatic discovery attempts if it is still installed locally.

## Repository metadata alignment
- Updated repository links in `io-package.json` and `package.json` from the scaffold placeholder adapter repository to the actual GitHub repository `hag174/ioBroker.solarforecast`.
- Corrected the external icon URL, README URL, homepage URL, repository URL, and issues URL.

## Visual identity
- Replaced `admin/solarforecast.png` with a newly generated 320x320 PNG icon showing a stylized sun, sky and solar panels for a clearer PV-focused adapter identity.

## Setup command reference
- Updated `requirements.txt` into a documented setup-command reference for this repository.
- Added explicit `npm install` commands for the project dependencies, the Mocha/Chai/Sinon test stack, and the TypeScript toolchain alongside the existing Basic Memory and ioBroker bootstrap commands.

## Git hygiene
- Tightened `.gitignore` to explicitly exclude `node_modules/`, `build/`, `dist/`, `.nyc_output/`, coverage output, and common npm/yarn log files.
- This prevents future accidental additions, but already tracked files still need to be removed from the Git index separately.

## Quality review 2026-03-21
- Re-verified the repository in a clean dependency state with `npm ci`, then ran `npm run check`, `npm run lint`, `npm test`, `npm run build`, `npm run coverage`, and `npm run test:integration`.
- `npm run check`, `npm run lint`, `npm test`, and `npm run build` passed.
- `npm run coverage` completed but reported `0/0`, so the current coverage configuration does not provide a meaningful measurement for the TypeScript sources.
- `npm run test:integration` could not complete in the current local environment because a JS-Controller instance was already running.
- The highest remaining quality risk is missing automated coverage for `src/main.ts`, especially timer handling, ioBroker state writes, stale hourly state cleanup, and error-state updates.
- Follow-up: add adapter runtime tests that exercise the real `Pvforecast` class and verify the created state tree, not only the isolated service/helper modules.

## Quality hardening follow-up 2026-03-21
- Extracted the refresh orchestration from `src/main.ts` into a dedicated runtime layer so timer handling, state writes, stale hourly cleanup, error-state updates, unload cleanup and overlap handling are covered by direct unit tests.
- Added Open-Meteo request abort support with a 30 second timeout and single-flight scheduling so scheduled refreshes are skipped while a prior refresh is still in progress.
- Replaced raw sanitized local timestamp keys with DST-safe hourly keys that add deterministic suffixes for repeated fallback hours.
- Removed the unused `refreshIntervalMinutes` field from the effective config and adjusted tests accordingly.
- Switched TypeScript coverage from `nyc` to `c8` and verified meaningful source coverage.

## Verification update 2026-03-21
- `npm run check` passed.
- `npm run lint` passed.
- `npm test` passed.
- `npm run coverage` passed with 96.01% statements, 75.44% branches, 100% functions and 96.01% lines.
- `npm run build` passed.
- `npm run test:integration` is still blocked in the current local environment because a JS-Controller instance is already running.

## Integration test expansion 2026-03-21
- Extended `test/integration.js` with fixture-driven integration suites that validate successful forecast state publishing and the refresh error path against a real JS-Controller test harness.
- Added a test-only Open-Meteo mocking path for integration tests so the real adapter process can avoid live network access without adding product-code hooks.
- The success-path integration test now verifies `info.connection`, `info.lastError`, `location.*`, `summary.today.energy_kwh`, daily forecast states, hourly JSON output, and stale hourly channel cleanup.
- The failure-path integration test now verifies that invalid forecast payloads keep the adapter alive but set `info.connection = false` and populate `info.lastError`.
- Re-verified `npm run test:integration` successfully after stopping the host JS-Controller; the suite now reports 3 passing tests.

## Metadata alignment fix 2026-03-21
- Corrected `info.lastUpdate` from role `value.time` to `value.datetime` while keeping the state value as the existing ISO datetime string.
- Added regression coverage in the runtime unit test and in the integration success path so the object metadata is checked alongside the state value.
- Re-verified `npm run check` and `npm run build`; the TypeScript test suite passed while the repository still needed further quality hardening around integration coverage.

## Quality hardening update 2026-03-26
- Removed the Open-Meteo fixture file hook from product code and moved integration mocking to a test-only preload under `test/`.
- Added a dedicated admin message handler that accepts only admin-originated `resolveLocationConfig` requests, validates payload lengths and formats, enforces a `10000 ms` timeout, and throttles repeated requests for `1000 ms`.
- Updated all `*.energy_kwh` objects to use the ioBroker role `value.power.consumption`.
- Added `npm run verify`, a JS-Controller preflight wrapper for `npm run test:integration`, an explicit CI integration-test job, and a governance consistency test that detects legacy names and stale memory terms.

## Release 0.8.1 deployment — 2026-10-23

- Added `summary.currentWeek.remaining_energy` and `summary.currentMonth.remaining_energy` in kWh, including proportional remaining current-hour energy and the local calendar cutoff. Both values are also mirrored in the summary JSON.
- Published immutable Git tags `v0.8.0` and `v0.8.1` to `hag174/ioBroker.solarforecast`; updated the local origin URL after GitHub reported the repository rename.
- Added a GitHub Actions release job that creates the GitHub Release only after all tagged CI jobs succeed.
- The first tag exposed a test infrastructure incompatibility: the default dev JS-Controller now requires Node.js >=22.19.0. Version 0.8.1 pins the integration test controller to 7.2.2, which supports Node.js >=18; product runtime is unchanged from 0.8.0.
- Local type checking, 54 TypeScript tests, 57 package tests and the build passed. All nine GitHub adapter-test jobs (Node.js 20/22/24 on Linux/macOS/Windows), check/lint, and the dedicated integration test passed.
- Installed version 0.8.1 from its exact GitHub tag in `/opt/iobroker` and restarted only `solarforecast.0`. Verified instance metadata version 0.8.1, enabled/alive true, `info.connection` true, empty `info.lastError`, and numeric values for both new remaining-energy states.
- GitHub Release `v0.8.1` was published successfully: https://github.com/hag174/ioBroker.solarforecast/releases/tag/v0.8.1 . No release or deployment steps remain open.
