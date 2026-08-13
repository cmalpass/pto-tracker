import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const PTO = require('../static/js/pto.js');

async function loadModule(path) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

const notifications = await loadModule('static/js/modules/notifications.js');
const planning = await loadModule('static/js/modules/planning.js');

const config = {
    holiday_country: 'US',
    pto_accrual_per_pay_period: 2,
    pto_accrual_type: 'days',
    pto_hours_per_day: 8,
    pto_holidays_require_pto: false,
    pay_periods_per_year: 26,
    accrual_start_date: '2026-01-01',
    accrual_method: 'pro-rata',
    pto_carryover_limit: 1,
    pto_uses_rollover: true,
    pto_lose_above_limit: true,
    timezone: 'UTC'
};

const vacation = {
    id: 1,
    name: 'Upcoming',
    start_date: '2026-08-03',
    end_date: '2026-08-03',
    days: 1,
    hours: 0,
    type: 'vacation'
};

test('generates deterministic notification priorities and actions', () => {
    const options = { pto: PTO, config, vacations: [vacation], today: '2026-08-01' };
    const alerts = notifications.generateNotifications(options);
    assert.deepEqual(alerts.map(alert => alert.type), [
        'carryover-forfeiture',
        'carryover-cap',
        'upcoming-vacation'
    ]);
    assert.equal(
        notifications.generateNotifications(options)[0].fingerprint,
        alerts[0].fingerprint
    );
    assert.deepEqual(alerts.map(alert => alert.action.tab), ['vacations', 'forecast', 'vacations']);
});

test('generates fixed-date low-balance alerts and validates required inputs', () => {
    const lowBalanceConfig = {
        ...config,
        pto_accrual_per_pay_period: 0.25,
        pto_carryover_limit: 40
    };
    const alerts = notifications.generateNotifications({
        pto: PTO,
        config: lowBalanceConfig,
        vacations: [{ ...vacation, start_date: '2026-08-02', end_date: '2026-08-02' }],
        today: '2026-08-01'
    });
    assert.equal(alerts[0].type, 'low-balance');
    assert.equal(alerts[1].type, 'upcoming-vacation');
    assert.throws(
        () => notifications.generateNotifications({ pto: PTO, config, today: '2026-8-1' }),
        /today must use YYYY-MM-DD/
    );
});

test('persists notification dismissal state and tolerates malformed browser storage', () => {
    const storage = new Map();
    const fakeStorage = {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value)
    };
    const alert = notifications.generateNotifications({
        pto: PTO,
        config,
        vacations: [vacation],
        today: '2026-08-01'
    }).at(-1);

    assert.equal(notifications.dismissNotification(alert, fakeStorage), true);
    assert.equal(notifications.visibleNotifications([alert], fakeStorage).length, 0);
    storage.set(notifications.DISMISSED_KEY, '{invalid json');
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(notifications.getDismissedFingerprints(fakeStorage).size, 0);
    } finally {
        console.warn = originalWarn;
    }
});

test('delegates dashboard planning data and keeps scenario calculations date-stable', () => {
    globalThis.PTO = PTO;
    const data = planning.yearAtAGlance(2026, config, [vacation]);
    assert.equal(data.months.length, 12);
    assert.equal(data.months[7].vacations[0].name, vacation.name);
    const scenario = PTO.analyzeVacation(
        '2026-12-01', '2026-12-01', 1, 0, config, [], null
    );
    assert.equal(scenario.unit, 'days');
    assert.equal(scenario.balance_after, scenario.balance_before - 1);
    assert.equal(scenario.forfeit_after, scenario.forfeit_before - 1);
});
