const test = require('node:test');
const assert = require('node:assert/strict');
const PTO = require('../static/js/pto.js');
const PTOStore = require('../static/js/store.js');

const config = {
    holiday_country: 'US',
    pto_accrual_per_pay_period: 1,
    pto_accrual_type: 'days',
    pto_hours_per_day: 8,
    pto_holidays_require_pto: false,
    pay_periods_per_year: 26,
    accrual_start_date: '2026-01-01',
    accrual_method: 'pro-rata',
    pto_carryover_limit: 40,
    pto_uses_rollover: true,
    pto_lose_above_limit: true,
    timezone: 'UTC'
};

const localStorageData = new Map();
global.localStorage = {
    getItem: key => localStorageData.get(key) || null,
    setItem: (key, value) => localStorageData.set(key, String(value)),
    removeItem: key => localStorageData.delete(key)
};

test('validates canonical dates and configured timezone boundaries', () => {
    assert.equal(PTO.isCanonicalDate('2026-02-28'), true);
    assert.equal(PTO.isCanonicalDate('2026-2-28'), false);
    const instant = '2026-01-01T00:30:00.000Z';
    assert.equal(PTO.getLocalToday({ timezone: 'UTC' }, instant), '2026-01-01');
    assert.equal(PTO.getLocalToday({ timezone: 'America/Los_Angeles' }, instant), '2025-12-31');
});

test('calculates holidays, business days, and accrual', () => {
    assert.equal(PTO.getHolidays(2026, config)['2026-07-03'], 'Independence Day (observed)');
    assert.equal(PTO.getVacationBusinessDays('2026-07-02', '2026-07-06', config), 2);
    assert.equal(
        PTO.getHolidays(2026, { ...config, holiday_country: 'GB' })['2026-12-28'],
        'Boxing Day (substitute day)'
    );
    assert.ok(PTO.calculateAccrualToDate('2026-12-31', config) > 0);
});

test('applies immediate, graded, and cliff vesting schedules', () => {
    assert.equal(PTO.vestingMultiplier('2026-12-31', config), 1);
    assert.ok(PTO.vestingMultiplier('2026-12-31', {
        ...config, pto_vesting_schedule: 'graded', pto_start_year: 2026
    }) < 1);
    assert.equal(PTO.vestingMultiplier('2028-12-31', {
        ...config, pto_vesting_schedule: 'cliff', pto_start_year: 2026
    }), 0);
    assert.equal(PTO.vestingMultiplier('2029-01-01', {
        ...config, pto_vesting_schedule: 'cliff', pto_start_year: 2026
    }), 1);
});

test('calculates conflicts, balances, forecasts, suggestions, and heatmap', () => {
    const vacation = {
        id: 1,
        name: 'Summer',
        start_date: '2026-08-03',
        end_date: '2026-08-05',
        days: 3,
        hours: 0
    };
    const conflict = PTO.detectVacationConflicts(
        '2026-08-05', '2026-08-07', [vacation]
    );
    assert.equal(conflict.has_conflicts, true);
    const balance = PTO.calculateBalanceOnDate('2026-12-31', config, [vacation]);
    assert.equal(balance.used, 3);
    assert.equal(PTO.generateYearlyForecast(2026, config, [vacation]).length, 12);
    assert.equal(PTO.generateMultiYearForecast(2026, 2, config, [vacation]).length, 2);
    assert.equal(PTO.generateHeatmap(2026, config, [vacation]).weeks.length >= 52, true);
    const suggestions = PTO.generateVacationSuggestions(2026, config, [vacation], {
        today: '2026-01-01'
    });

    test('persists and round-trips versioned browser backups', async () => {
        await PTOStore.clear('config');
        await PTOStore.clear('vacations');
        await PTOStore.clear('notes');
        await PTOStore.putConfig(config);
        await PTOStore.putVacation({
            name: 'Backup trip',
            start_date: '2026-08-03',
            end_date: '2026-08-03',
            days: 1,
            hours: 0
        });
        await PTOStore.putNote({ date: '2026-01-01', text: 'Backup note' });
        const backup = JSON.parse(await PTOStore.exportJSON());
        assert.equal(backup.schemaVersion, 2);
        assert.equal(backup.data.vacations.length, 1);
        await PTOStore.importJSON(backup);
        assert.equal((await PTOStore.listNotes())[0].text, 'Backup note');
    });
    assert.equal(Array.isArray(suggestions.suggestions), true);
});

test('soft deletes records, supports undo, filters active queries, and keeps history', async () => {
   await PTOStore.clear('vacations');
   await PTOStore.clear('notes');
   await PTOStore.clear('history');
   const vacation = await PTOStore.putVacation({
       name: 'Undo trip',
       start_date: '2026-08-03',
       end_date: '2026-08-03',
       days: 1,
       hours: 0
   });
   const note = await PTOStore.putNote({ date: '2026-08-03', text: 'Undo note' });

   assert.equal(await PTOStore.deleteVacation(vacation.id), true);
   assert.equal((await PTOStore.listVacations()).length, 0);
   assert.equal((await PTOStore.getVacation(vacation.id)), undefined);
   const deletedVacation = (await PTOStore.list('vacations', { includeDeleted: true }))
       .find(item => item.id === vacation.id);
   assert.ok(deletedVacation.deleted_at);

   const backup = JSON.parse(await PTOStore.exportJSON());
   assert.equal(backup.data.vacations.length, 0);

   assert.equal(await PTOStore.restoreVacation(vacation.id), true);
   assert.equal((await PTOStore.listVacations())[0].name, 'Undo trip');
   assert.equal(await PTOStore.deleteNote(note.id), true);
   assert.equal((await PTOStore.listNotes()).length, 0);
   assert.equal(await PTOStore.restoreNote(note.id), true);
   assert.equal((await PTOStore.listNotes())[0].text, 'Undo note');

   const actions = (await PTOStore.listHistory()).map(item => item.action);
   assert.ok(actions.includes('delete'));
   assert.ok(actions.includes('restore'));
});

test('migrates legacy fallback records and imports schema v1 backups', async () => {
   localStorageData.delete('pto-tracker:data:v2');
   localStorageData.set('pto-tracker:data:v1', JSON.stringify({
       config: [],
       vacations: [{
           id: 11,
           name: 'Legacy trip',
           start_date: '2026-09-01',
           end_date: '2026-09-01',
           days: 1,
           hours: 0
       }],
       notes: [],
       nextId: { vacations: 12, notes: 1 }
   }));
   const migrated = await PTOStore.listVacations();
   assert.equal(migrated[0].deleted_at, null);
   assert.ok(localStorageData.get('pto-tracker:data:v2'));

   await PTOStore.importJSON({
       schemaVersion: 1,
       data: {
           config: null,
           vacations: [{
               id: 12,
               name: 'Old backup',
               start_date: '2026-10-01',
               end_date: '2026-10-01',
               days: 1,
               hours: 0
           }],
           notes: []
       }
   });
   assert.equal((await PTOStore.listVacations())[0].name, 'Old backup');
});
