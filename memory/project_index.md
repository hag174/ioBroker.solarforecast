---
title: project_index
type: note
permalink: solarforecast/project-index
---

# SolarForecast Project Index

## Purpose
This project implements a solar forecast adapter for ioBroker using the Open-Meteo forecast API.

## Canonical Memory Notes
- `project_index` is the preflight entry point for project memory.
- `core/codex_workflow` records persistent workflow rules for Codex sessions.
- `architecture/adapter_v1_plan` records the current v1 adapter implementation plan and design defaults.
- `history/2026_03_20_initial_implementation` records the first implemented adapter milestone and verification status.

## Current Status
- The checked-in project memory for this repository lives in `/home/hagen/Programming/SolarForecast/memory`.
- The adapter configuration uses `peakPowerKwp`, `morningDampingPct`, and `afternoonDampingPct`.
- The admin city-check path is restricted to admin-originated requests, uses a `10000 ms` timeout, and throttles repeated checks for `1000 ms`.
- Energy forecast states use the ioBroker role `value.power.consumption`.
- `forecast.json.hourlyToday`, `forecast.json.hourlyTomorrow`, and `forecast.json.daily` now publish Material Design JSON Chart payloads with `axisLabels` and `graphs`.
- The former combined `forecast.json.hourly` state and the raw-array JSON format have been removed as breaking changes.
- `summary.currentMonth.remaining_energy` publishes remaining forecast energy in kWh at refresh time, with the current hour prorated and the range capped at the local month end and available forecast. Measured production is added externally by the user. The summary JSON exposes `currentMonth.remainingEnergyKwh`; existing monthly totals and completeness semantics are unchanged.
- `summary.currentWeek.remaining_energy` uses the same remaining-energy calculation through the end of the local ISO week (Sunday), including next-month days when necessary. The summary JSON exposes `currentWeek.remainingEnergyKwh`; weekly totals and completeness semantics are unchanged.
- Version `0.8.0` adds weekly/monthly remaining-energy states. Tagged `v*` releases are published by the GitHub Actions release job only after all CI checks succeed.
- The preferred full verification flow is `npm run verify`.

- Release follow-up: the default dev test controller requires Node.js >=22.19.0 and broke the Node.js 20 CI job before database initialization. Version `0.8.1` pins the integration test controller to `7.2.2` (supports Node.js >=18). Version `0.8.0` was installed and both remaining-energy states and connection were verified live; its tag is retained unchanged.
