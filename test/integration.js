const path = require('node:path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');

const TIME_ZONE = 'Europe/Berlin';
const FIXTURE_ENV = 'SOLARFORECAST_OPEN_METEO_FIXTURE';
const ADAPTER_NAMESPACE = 'solarforecast.0';
const PRELOAD_MODULE_PATH = path.join(__dirname, 'mock-open-meteo.js');

function formatLocalDate(date, timeZone = TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);

    const values = Object.fromEntries(
        parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
}

function formatLocalHour(date, timeZone = TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);

    const values = Object.fromEntries(
        parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
    );
    return Number(values.hour);
}

function addDays(dateString, days) {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function sanitizeStateKey(timestamp) {
    return timestamp.replace(/[^a-zA-Z0-9]/g, '_');
}

function formatChartDateLabel(dateString) {
    return `${dateString.slice(8, 10)}.${dateString.slice(5, 7)}.`;
}

function createAdapterEnvironment(fixtureName) {
    const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
    const preloadNodeOption = `--require=${PRELOAD_MODULE_PATH}`;

    return {
        NODE_OPTIONS: existingNodeOptions ? `${existingNodeOptions} ${preloadNodeOption}` : preloadNodeOption,
        [FIXTURE_ENV]: fixtureName,
    };
}

async function waitForState(harness, id, predicate, timeoutMs = 10000) {
    const existingState = await harness.states.getStateAsync(id);
    if (predicate(existingState)) {
        return existingState;
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            harness.off('stateChange', onStateChange);
            reject(new Error(`Timed out while waiting for state "${id}".`));
        }, timeoutMs);

        const onStateChange = (changedId, state) => {
            if (changedId !== id || !predicate(state)) {
                return;
            }

            clearTimeout(timeout);
            harness.off('stateChange', onStateChange);
            resolve(state);
        };

        harness.on('stateChange', onStateChange);
    });
}

async function seedStaleHourlyChannel(harness) {
    await harness.objects.setObjectAsync(`${ADAPTER_NAMESPACE}.forecast.hourly.timestamps.stale_fixture`, {
        type: 'channel',
        common: {
            name: 'stale fixture',
        },
        native: {},
    });
    await harness.objects.setObjectAsync(`${ADAPTER_NAMESPACE}.forecast.hourly.timestamps.stale_fixture.timestamp`, {
        type: 'state',
        common: {
            name: 'stale timestamp',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
        },
        native: {},
    });
}

async function configureAdapter(harness) {
    await harness.changeAdapterConfig('solarforecast', {
        native: {
            locationMode: 'geocode',
            city: 'Berlin',
            countryCode: 'DE',
            timezoneMode: 'auto',
            timezone: TIME_ZONE,
            tiltDeg: 0,
            azimuthDeg: 0,
            peakPowerKwp: 2.2,
            morningDampingPct: 100,
            afternoonDampingPct: 100,
        },
    });
}

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
    // Keep the test controller compatible with the supported Node.js 20 CI jobs.
    controllerVersion: '7.2.2',
    defineAdditionalTests({ suite }) {
        suite('Publishes forecast states', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('writes forecast states and removes stale hourly channels', async function () {
                this.timeout(30000);

                await configureAdapter(harness);
                await seedStaleHourlyChannel(harness);
                const now = new Date();
                await harness.startAdapterAndWait(true, createAdapterEnvironment('success'));

                const today = formatLocalDate(now);
                const tomorrow = addDays(today, 1);
                const currentLocalHour = formatLocalHour(now);
                const remainingTodayEnergy = Number(((24 - currentLocalHour) * 0.22).toFixed(3));
                const firstHourKey = sanitizeStateKey(`${today}T00:00`);
                const connectionState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.info.connection`);
                const lastErrorState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.info.lastError`);
                const todayEnergyState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.summary.today.energy_kwh`);
                const remainingTodayEnergyState = await harness.states.getStateAsync(
                    `${ADAPTER_NAMESPACE}.summary.today.remaining_energy_kwh`,
                );
                const resolvedNameState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.location.resolvedName`);
                const timezoneState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.location.timezone`);
                const day0DateState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.forecast.daily.day0.date`);
                const day1DateState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.forecast.daily.day1.date`);
                const hourlyTimestampState = await harness.states.getStateAsync(
                    `${ADAPTER_NAMESPACE}.forecast.hourly.timestamps.${firstHourKey}.timestamp`,
                );
                const hourlyTodayJsonState = await harness.states.getStateAsync(
                    `${ADAPTER_NAMESPACE}.forecast.json.hourlyToday`,
                );
                const hourlyTomorrowJsonState = await harness.states.getStateAsync(
                    `${ADAPTER_NAMESPACE}.forecast.json.hourlyTomorrow`,
                );
                const dailyJsonState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.forecast.json.daily`);
                const summaryJsonState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.forecast.json.summary`);
                const lastUpdateObject = await harness.objects.getObjectAsync(`${ADAPTER_NAMESPACE}.info.lastUpdate`);
                const todayEnergyObject = await harness.objects.getObjectAsync(
                    `${ADAPTER_NAMESPACE}.summary.today.energy_kwh`,
                );
                const staleChannel = await harness.objects.getObjectAsync(
                    `${ADAPTER_NAMESPACE}.forecast.hourly.timestamps.stale_fixture`,
                );

                expect(connectionState?.val).to.equal(true);
                expect(lastErrorState?.val).to.equal('');
                expect(todayEnergyState?.val).to.equal(5.28);
                expect(remainingTodayEnergyState?.val).to.equal(remainingTodayEnergy);
                expect(resolvedNameState?.val).to.equal('Berlin, Germany');
                expect(timezoneState?.val).to.equal(TIME_ZONE);
                expect(day0DateState?.val).to.equal(today);
                expect(day1DateState?.val).to.equal(tomorrow);
                expect(hourlyTimestampState?.val).to.equal(`${today}T00:00`);
                expect(lastUpdateObject?.common.role).to.equal('value.datetime');
                expect(todayEnergyObject?.common.role).to.equal('value.power.consumption');

                const hourlyTodayJson = JSON.parse(hourlyTodayJsonState.val);
                const hourlyTomorrowJson = JSON.parse(hourlyTomorrowJsonState.val);
                const dailyJson = JSON.parse(dailyJsonState.val);
                const summaryJson = JSON.parse(summaryJsonState.val);
                expect(hourlyTodayJson.axisLabels).to.have.lengthOf(24);
                expect(hourlyTodayJson.axisLabels[0]).to.equal(`${formatChartDateLabel(today)}\n00:00`);
                expect(hourlyTomorrowJson.axisLabels).to.have.lengthOf(24);
                expect(hourlyTomorrowJson.axisLabels[0]).to.equal(`${formatChartDateLabel(tomorrow)}\n00:00`);
                expect(hourlyTodayJson.graphs).to.have.lengthOf(1);
                expect(hourlyTomorrowJson.graphs).to.have.lengthOf(1);
                expect(hourlyTodayJson.graphs[0]).to.include({
                    type: 'bar',
                    color: '#f9a825',
                    legendText: 'Energy forecast',
                    yAxis_appendix: ' kWh',
                    tooltip_AppendText: ' kWh',
                    yAxis_min: 0,
                    datalabel_show: false,
                });
                expect(hourlyTomorrowJson.graphs[0]).to.include({
                    type: 'bar',
                    color: '#f9a825',
                    legendText: 'Energy forecast',
                    yAxis_appendix: ' kWh',
                    tooltip_AppendText: ' kWh',
                    yAxis_min: 0,
                    datalabel_show: false,
                });
                expect(hourlyTodayJson.graphs[0].data).to.have.lengthOf(24);
                expect(hourlyTomorrowJson.graphs[0].data).to.have.lengthOf(24);
                expect(hourlyTodayJson.graphs[0].data[0]).to.equal(0.22);
                expect(hourlyTomorrowJson.graphs[0].data[0]).to.equal(0.22);
                // The success fixture provides forecast rows through today + 3.
                const expectedDailyEnergyData = [5.28, 5.28, 5.28, 5.28, 0, 0, 0];
                expect(dailyJson.axisLabels).to.deep.equal([
                    formatChartDateLabel(today),
                    formatChartDateLabel(tomorrow),
                    formatChartDateLabel(addDays(today, 2)),
                    formatChartDateLabel(addDays(today, 3)),
                    formatChartDateLabel(addDays(today, 4)),
                    formatChartDateLabel(addDays(today, 5)),
                    formatChartDateLabel(addDays(today, 6)),
                ]);
                expect(dailyJson.graphs).to.have.lengthOf(1);
                expect(dailyJson.graphs[0].data).to.deep.equal(expectedDailyEnergyData);
                expect(summaryJson.todayEnergyKwh).to.equal(5.28);
                expect(summaryJson.todayRemainingEnergyKwh).to.equal(remainingTodayEnergy);
                expect(staleChannel).to.equal(null);
            });
        });

        suite('Reports refresh failures', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('sets info.lastError when the forecast payload is invalid', async function () {
                this.timeout(30000);

                await configureAdapter(harness);
                await harness.startAdapterAndWait(false, createAdapterEnvironment('failure'));

                const lastErrorState = await waitForState(
                    harness,
                    `${ADAPTER_NAMESPACE}.info.lastError`,
                    (state) => Boolean(state && state.val),
                );
                const connectionState = await harness.states.getStateAsync(`${ADAPTER_NAMESPACE}.info.connection`);

                expect(connectionState?.val).to.equal(false);
                expect(lastErrorState.val).to.equal('The forecast payload is missing hourly GTI or cloud cover values.');
            });
        });
    },
});
