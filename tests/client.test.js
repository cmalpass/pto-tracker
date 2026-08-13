const test = require('node:test');
const assert = require('node:assert/strict');
const PTO = require('../static/js/pto.js');
const PTOStore = require('../static/js/store.js');
const PTOTransfer = require('../static/js/transfer.js');

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

test('validates leave types and quarter-hour partial-day amounts against policy hours', () => {
    assert.equal(PTO.normalizeLeaveType('Sick'), 'sick');
    assert.equal(PTO.normalizeLeaveType('unknown-type'), 'vacation');
    assert.deepEqual(PTO.normalizeBooking(0, 4, config), {
        days: 0,
        hours: 4,
        amount: 0.5,
        total_hours: 4
    });
    assert.deepEqual(PTO.normalizeBooking(0.5, 0, config).amount, 0.5);
    assert.throws(
        () => PTO.normalizeBooking(0, 8.25, config),
        /cannot exceed 8 hours per day/
    );
    assert.throws(
        () => PTO.normalizeBooking(0.333, 0, config),
        /quarter-hours/
    );
    assert.equal(PTO.getVacationTypeBreakdown(2026, config, [{
        type: 'sick',
        start_date: '2026-08-03',
        end_date: '2026-08-03',
        days: 0,
        hours: 4
    }])[1].amount, 0.5);
});

test('generates escaped CRLF ICS with stable date-only UIDs and round-trips dates', () => {
    const vacation = {
        id: 7,
        name: 'Summer, family\\ntrip; 2026',
        start_date: '2026-08-03',
        end_date: '2026-08-05'
    };
    const ics = PTOTransfer.toICS([vacation], { timestamp: '2026-01-02T03:04:05Z' });
    assert.match(ics, /UID:vacation-7@pto-tracker\.local\r\n/);
    assert.match(ics, /DTSTART;VALUE=DATE:20260803\r\n/);
    assert.match(ics, /DTEND;VALUE=DATE:20260806\r\n/);
    assert.match(ics, /SUMMARY:Summer\\, family\\\\ntrip\\; 2026\r\n/);
    assert.equal(ics.includes('\n') && !ics.includes('\r\n'), false);
    assert.equal(PTOTransfer.toICS([vacation], { timestamp: '2026-01-02T03:04:05Z' }), ics);
    assert.deepEqual(PTOTransfer.parseICS(ics)[0], {
        source: 'ICS event 1',
        name: vacation.name,
        start_date: vacation.start_date,
        end_date_exclusive: '2026-08-06',
        end_date: vacation.end_date,
        days: null,
        hours: null
    });
});

test('parses CSV quoting and rejects timed ICS events during validation', () => {
    const csv = PTOTransfer.toCSV([{
        name: 'Team, retreat',
        start_date: '2026-09-01',
        end_date: '2026-09-02',
        days: 2,
        hours: 0
    }]);
    assert.deepEqual(PTOTransfer.parseCSV(csv)[0], {
        source: 'CSV row 2',
        name: 'Team, retreat',
        start_date: '2026-09-01',
        end_date: '2026-09-02',
        days: '2',
        hours: '0'
    });

    const timed = PTOTransfer.parseICS([
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'SUMMARY:Timed',
        'DTSTART:20260901T090000Z',
        'DTEND:20260901T170000Z',
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n'));
    const result = PTOTransfer.validateRows(timed, { pto: PTO, config });
    assert.equal(result.valid.length, 0);
    assert.match(result.invalid[0].errors.join(' '), /timed events are not supported/i);
});

test('round-trips leave types and partial amounts through CSV and ICS metadata', () => {
    const record = {
        id: 4,
        name: 'Sick appointment',
        start_date: '2026-09-01',
        end_date: '2026-09-01',
        days: 0,
        hours: 3.75,
        type: 'sick'
    };
    const csv = PTOTransfer.toCSV([record]);
    const csvRow = PTOTransfer.parseCSV(csv)[0];
    assert.equal(csvRow.type, 'sick');
    const validated = PTOTransfer.validateRows([csvRow], { pto: PTO, config });
    assert.equal(validated.valid[0].type, 'sick');
    assert.equal(validated.valid[0].hours, 3.75);

    const ics = PTOTransfer.toICS([record], { timestamp: '2026-01-02T03:04:05Z' });
    assert.match(ics, /CATEGORIES:Sick\r\n/);
    assert.match(ics, /X-PTO-HOURS:3\.75\r\n/);
    const icsRow = PTOTransfer.parseICS(ics)[0];
    assert.equal(icsRow.type, 'sick');
    assert.equal(icsRow.hours, '3.75');
});

test('detects duplicate and overlapping imported vacations before writing', () => {
    const rows = PTOTransfer.parseCSV([
        'Name,Start Date,End Date,Days,Hours',
        'Existing,2026-08-03,2026-08-03,1,0',
        'New,2026-08-03,2026-08-04,2,0',
        'Broken,2026-13-01,2026-08-04,1,0'
    ].join('\r\n'));
    const result = PTOTransfer.validateRows(rows, {
        pto: PTO,
        config,
        existingVacations: [{
            id: 1,
            name: 'Existing',
            start_date: '2026-08-03',
            end_date: '2026-08-03',
            days: 1,
            hours: 0
        }]
    });
    assert.equal(result.valid.length, 0);
    assert.equal(result.duplicateCount, 1);
    assert.match(result.invalid[1].errors.join(' '), /overlap/i);
    assert.match(result.invalid[2].errors.join(' '), /YYYY-MM-DD/);
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
    assert.equal(Array.isArray(suggestions.suggestions), true);
});

test('builds year-at-a-glance planning data and scenario projections', () => {
    const riskConfig = {
        ...config,
        pto_carryover_limit: 1,
        pto_lose_above_limit: true
    };
    const vacation = {
        id: 9,
        name: 'Summer planning',
        start_date: '2026-07-03',
        end_date: '2026-07-06',
        days: 1,
        hours: 0,
        type: 'vacation'
    };
    const planning = PTO.generateYearAtAGlance(2026, riskConfig, [vacation]);
    assert.equal(planning.months.length, 12);
    assert.equal(planning.months[6].vacations[0].name, 'Summer planning');
    assert.ok(planning.months[6].holidays.some(item => item.date === '2026-07-03'));
    assert.ok(planning.months[0].accrual_milestones.length > 0);
    assert.ok(planning.months.some(month => month.annotations.some(item => item.type === 'cap')));
    assert.ok(planning.months[11].annotations.some(item => item.type === 'forfeiture'));

    const scenario = PTO.analyzeVacation(
        '2026-12-01', '2026-12-01', 1, 0, riskConfig, [], null
    );
    assert.equal(scenario.unit, 'days');
    assert.equal(scenario.balance_after, scenario.balance_before - 1);
    assert.equal(scenario.forfeit_after, scenario.forfeit_before - 1);
    assert.ok(Object.hasOwn(scenario, 'limit'));
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
    assert.equal(backup.schemaVersion, 3);
    assert.equal(backup.data.vacations.length, 1);
    assert.equal(backup.data.vacations[0].type, 'vacation');
    await PTOStore.importJSON(backup);
    assert.equal((await PTOStore.listNotes())[0].text, 'Backup note');
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
   localStorageData.delete('pto-tracker:data:v3');
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
   assert.ok(localStorageData.get('pto-tracker:data:v3'));
   assert.equal(migrated[0].type, 'vacation');

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
   assert.equal((await PTOStore.listVacations())[0].type, 'vacation');
});
