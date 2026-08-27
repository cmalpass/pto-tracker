const test = require('node:test');
const assert = require('node:assert/strict');
const PTO = require('../static/js/pto.js');
const PTOStore = require('../static/js/store.js');
const PTOTransfer = require('../static/js/transfer.js');

// Mirror the browser global environment so store.js can resolve shared PTO helpers.
globalThis.PTO = PTO;

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

test('keeps hours-mode usage and forecast values in hours', () => {
    const hoursConfig = {
        ...config,
        pto_accrual_type: 'hours',
        pto_accrual_per_pay_period: 8
    };
    const vacation = {
        start_date: '2026-08-03',
        end_date: '2026-08-03',
        days: 1,
        hours: 0
    };
    const balance = PTO.calculateBalanceOnDate('2026-12-31', hoursConfig, [vacation]);
    const august = PTO.generateYearlyForecast(2026, hoursConfig, [vacation])[7];
    assert.equal(balance.used, 8);
    assert.equal(balance.limit, 40);
    assert.equal(balance.used_days, 1);
    assert.equal(august.used, 8);
    assert.ok(Math.abs(august.balance - (august.accrued - 8)) < 0.01);
});

test('uses the hours-mode carryover limit without converting it twice', () => {
    const hoursConfig = {
        ...config,
        accrual_method: 'full',
        pto_accrual_type: 'hours',
        pto_accrual_per_pay_period: 8,
        pto_carryover_limit: 40
    };
    const yearEnd = PTO.calculateBalanceOnDate('2026-12-31', hoursConfig, []);
    const expectedRisk = Math.max(0, yearEnd.balance - hoursConfig.pto_carryover_limit);
    const suggestions = PTO.generateVacationSuggestions(2026, hoursConfig, [], {
        today: '2026-01-01'
    });

    assert.equal(PTO.analyzeVacation(
        '2026-01-05', '2026-01-05', 1, 0, hoursConfig, []
    ).warnings.some(warning => warning.type === 'policy_limit'), true);
    assert.equal(suggestions.forfeit_risk, expectedRisk);
    assert.equal(suggestions.forfeit_risk > 0, true);
});

test('starts forecasts from an entered baseline and ignores prior history', () => {
    const baselineConfig = {
        ...config,
        forecast_baseline_enabled: true,
        forecast_baseline_date: '2026-08-01',
        forecast_baseline_balance: 10
    };
    const vacations = [
        { start_date: '2026-07-01', end_date: '2026-07-01', days: 5, hours: 0 },
        { start_date: '2026-08-03', end_date: '2026-08-03', days: 2, hours: 0 }
    ];
    const beforeBaseline = PTO.calculateBalanceOnDate('2026-07-31', baselineConfig, vacations);
    const august = PTO.calculateBalanceOnDate('2026-08-31', baselineConfig, vacations);
    assert.equal(beforeBaseline.balance, 0);
    assert.equal(august.used, 2);
    assert.ok(august.balance < 10 + august.accrued);
});

test('classifies usage using inclusive per-year PTO boundaries', () => {
    const boundaryConfig = {
        ...config,
        pto_year_boundaries: [{ year: 2026, final_date: '2026-12-26' }]
    };
    const vacations = [
        { type: 'vacation', start_date: '2026-12-26', end_date: '2026-12-26', days: 1, hours: 0 },
        { type: 'vacation', start_date: '2026-12-27', end_date: '2026-12-27', days: 1, hours: 0 }
    ];
    assert.equal(PTO.getPtoYearForDate('2026-12-26', boundaryConfig), 2026);
    assert.equal(PTO.getPtoYearForDate('2026-12-27', boundaryConfig), 2027);
    assert.equal(PTO.getVacationTypeBreakdown(2026, boundaryConfig, vacations)[0].days, 1);
    assert.equal(PTO.getVacationTypeBreakdown(2027, boundaryConfig, vacations)[0].days, 1);
});

test('applies rollover and cap at a configured PTO year boundary', () => {
    const boundaryConfig = {
        ...config,
        accrual_method: 'full',
        pto_accrual_per_pay_period: 26,
        pto_carryover_limit: 5,
        pto_year_boundaries: [{ year: 2026, final_date: '2026-12-26' }]
    };
    const end = PTO.calculateBalanceOnDate('2026-12-26', boundaryConfig, []);
    const next = PTO.calculateBalanceOnDate('2026-12-27', boundaryConfig, []);
    assert.ok(end.balance > 5);
    assert.equal(next.carry, 5);
    assert.ok(next.balance < end.balance);
});

test('ends yearly forecasts at the configured inclusive boundary', () => {
    const boundaryConfig = {
        ...config,
        pto_year_boundaries: [{ year: 2026, final_date: '2026-12-26' }]
    };
    const vacation = {
        start_date: '2026-12-26',
        end_date: '2026-12-26',
        days: 1,
        hours: 0
    };
    const forecast = PTO.generateMultiYearForecast(2026, 2, boundaryConfig, [vacation]);
    assert.equal(forecast[0].year_end_balance, forecast[0].monthly_balances[11].balance);
    assert.equal(forecast[0].total_used, 1);
    assert.equal(forecast[1].total_used, 0);
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

test('normalizes a null accrual_start_date so config merges keep a valid default', async () => {
   await PTOStore.clear('config');
   await PTOStore.putConfig({ ...config, accrual_start_date: null });
   const stored = await PTOStore.getConfig();
   assert.equal('accrual_start_date' in stored, false);

   globalThis.PTOStore = PTOStore;
   const stateModule = await import(`../static/js/modules/state.js?null-accrual=${Date.now()}`);
   const merged = await stateModule.getStoredConfig();
   assert.notEqual(merged.accrual_start_date, null);
   assert.ok(PTO.isCanonicalDate(merged.accrual_start_date));
   assert.ok(PTO.calculateBalanceOnDate('2026-12-31', merged, []).accrued >= 0);

   await PTOStore.importJSON({
       schemaVersion: 3,
       data: {
           config: { ...config, accrual_start_date: null },
           vacations: [],
           notes: []
       }
   });
   const imported = await PTOStore.getConfig();
   assert.equal('accrual_start_date' in imported, false);
});

test('rejects invalid accrual_start_date strings on config write', async () => {
   await assert.rejects(
       () => PTOStore.putConfig({ ...config, accrual_start_date: '01/01/2026' }),
       /accrual_start_date must use YYYY-MM-DD/
   );
});

test('validates PTO year boundaries with the shared validator', () => {
   // A valid, chronological set passes.
   assert.deepEqual(PTO.validatePtoYearBoundaries([
       { year: 2025, final_date: '2025-12-31' },
       { year: 2026, final_date: '2026-06-30' }
   ]), []);

   // A final day outside its own year is rejected, naming the year.
   assert.deepEqual(PTO.validatePtoYearBoundaries([
       { year: 2026, final_date: '2027-01-15' }
   ]), ['PTO year 2026 final day must be within 2026.']);

   // Unordered final dates are rejected.
   assert.deepEqual(PTO.validatePtoYearBoundaries([
       { year: 2026, final_date: '2026-06-30' },
       { year: 2025, final_date: '2025-12-31' }
   ]), ['PTO year boundary dates must be unique and chronological.']);

   // Duplicate years are rejected.
   assert.deepEqual(PTO.validatePtoYearBoundaries([
       { year: 2026, final_date: '2026-06-30' },
       { year: 2026, final_date: '2026-07-31' }
   ]), ['PTO year 2026 is configured more than once.']);

   // A non-integer year is rejected.
   assert.deepEqual(PTO.validatePtoYearBoundaries([
       { year: 'soon', final_date: '2026-06-30' }
   ]), ['PTO year boundary 1 must use a valid year.']);

   // A malformed final date is rejected.
   assert.deepEqual(PTO.validatePtoYearBoundaries([
       { year: 2026, final_date: '06/30/2026' }
   ]), ['PTO year 2026 final day must use YYYY-MM-DD format.']);

   // A repeated date is rejected (alongside the ordering rule it also trips).
   const repeated = PTO.validatePtoYearBoundaries([
       { year: 2025, final_date: '2025-06-30' },
       { year: 2026, final_date: '2025-06-30' }
   ]);
   assert.ok(repeated.includes('PTO boundary date 2025-06-30 is configured more than once.'));
   assert.ok(repeated.includes('PTO year boundary dates must be unique and chronological.'));

   // Non-array input is treated as no boundaries.
   assert.deepEqual(PTO.validatePtoYearBoundaries(null), []);
   assert.deepEqual(PTO.validatePtoYearBoundaries(undefined), []);
});

test('rejects imports with out-of-year or unordered PTO year boundaries', async () => {
   await PTOStore.clear('config');
   await PTOStore.clear('vacations');
   await PTOStore.putConfig({
       ...config,
       pto_year_boundaries: [{ year: 2025, final_date: '2025-12-31' }]
   });
   await PTOStore.putVacation({
       name: 'Kept trip',
       start_date: '2026-08-03',
       end_date: '2026-08-03',
       days: 1,
       hours: 0
   });

   // Out-of-year boundary: rejected, nothing written.
   await assert.rejects(
       () => PTOStore.importJSON({
           schemaVersion: 3,
           data: {
               config: { ...config, pto_year_boundaries: [{ year: 2026, final_date: '2027-01-15' }] },
               vacations: [{
                   name: 'Should not appear',
                   start_date: '2026-09-01',
                   end_date: '2026-09-01',
                   days: 1,
                   hours: 0
               }],
               notes: []
           }
       }),
       /PTO year 2026 final day must be within 2026/
   );

   // Unordered boundaries: rejected, nothing written.
   await assert.rejects(
       () => PTOStore.importJSON({
           schemaVersion: 3,
           data: {
               config: { ...config, pto_year_boundaries: [
                   { year: 2026, final_date: '2026-06-30' },
                   { year: 2025, final_date: '2025-12-31' }
               ] },
               vacations: [],
               notes: []
           }
       }),
       /must be unique and chronological/
   );

   // Stored state is unchanged: original boundary and original vacation remain.
   const stored = await PTOStore.getConfig();
   assert.deepEqual(stored.pto_year_boundaries, [{ year: 2025, final_date: '2025-12-31' }]);
   const vacations = await PTOStore.listVacations();
   assert.equal(vacations.length, 1);
   assert.equal(vacations[0].name, 'Kept trip');
});

test('rejects config writes with invalid PTO year boundaries', async () => {
   await assert.rejects(
       () => PTOStore.putConfig({
           ...config,
           pto_year_boundaries: [{ year: 2026, final_date: '2027-01-15' }]
       }),
       /PTO year 2026 final day must be within 2026/
   );
});

// --- Fake IndexedDB for storage status tests ---------------------------------

function createFakeIndexedDb(requests) {
   return {
       open: (name, version) => {
           const request = {};
           requests.push(request);
           return request;
       }
   };
}

function createFakeDatabase(stores) {
   const db = {
       open: true,
       objectStoreNames: { contains: name => Boolean(stores[name]) },
       close() {
           this.open = false;
       }
   };
   db.transaction = storeName => {
       const transaction = {};
       const objectStore = {
           get: id => storeRequest(transaction, () =>
               (stores[storeName] || []).find(record => record.id === id)),
           getAll: () => storeRequest(transaction, () =>
               (stores[storeName] || []).map(record => ({ ...record }))),
           getAllKeys: () => storeRequest(transaction, () =>
               (stores[storeName] || []).map(record => record.id)),
           put: record => storeRequest(transaction, () => {
               const array = stores[storeName] || (stores[storeName] = []);
               const existing = array.find(item => item.id === record.id);
               if (existing) Object.assign(existing, record);
               else array.push({ ...record });
               return record.id;
           }),
           clear: () => storeRequest(transaction, () => {
               stores[storeName] = [];
           })
       };
       // Return the transaction itself (not a wrapper): idbRequest assigns
       // oncomplete/onerror to the return value of db.transaction().
       transaction.objectStore = () => objectStore;
       return transaction;
   };
   return db;
}

// Mirrors the IndexedDB request contract: handlers are assigned synchronously
// after the operation returns, then onsuccess fires before transaction.oncomplete.
function storeRequest(transaction, compute) {
   const request = {};
   queueMicrotask(() => {
       request.result = compute();
       if (request.onsuccess) request.onsuccess();
       if (transaction.oncomplete) transaction.oncomplete();
   });
   return request;
}

test('degrades to fallback storage when IndexedDB open is blocked and reconnects', async () => {
   PTOStore.resetStorageConnection();
   localStorageData.clear();
   const statuses = [];
   const unsubscribe = PTOStore.onStorageStatusChange(status => statuses.push(status.state));
   const requests = [];
   globalThis.indexedDB = createFakeIndexedDb(requests);
   try {
       assert.equal(PTOStore.getStorageStatus().state, 'connecting');

       // Start the write without awaiting: the open request is issued
       // synchronously inside the first storage call.
       const vacationPromise = PTOStore.putVacation({
           name: 'Blocked tab trip',
           start_date: '2026-10-01',
           end_date: '2026-10-01',
           days: 1,
           hours: 0
       });
       assert.equal(requests.length, 1);

       // Another connection holds the database: degrade without hanging.
       requests[0].onblocked();
       const vacation = await vacationPromise;
       assert.equal(PTOStore.getStorageStatus().state, 'blocked');
       assert.ok(vacation.id > 0);
       const degraded = await PTOStore.listVacations();
       assert.equal(degraded.length, 1);
       assert.equal(degraded[0].name, 'Blocked tab trip');

       // The other connection closes: the still-live open request completes,
       // the store reconciles the fallback data, and the status flips to ok.
       const liveStores = { vacations: [], notes: [], history: [] };
       requests[0].result = createFakeDatabase(liveStores);
       requests[0].onsuccess();
       await new Promise(resolve => setImmediate(resolve));

       assert.equal(PTOStore.getStorageStatus().state, 'ok');
       const reconciled = await PTOStore.listVacations();
       assert.equal(reconciled.length, 1);
       assert.equal(reconciled[0].name, 'Blocked tab trip');
       assert.equal(liveStores.vacations.length, 1);
       assert.equal(liveStores.vacations[0].name, 'Blocked tab trip');
       assert.deepEqual(statuses, ['connecting', 'blocked', 'ok']);
   } finally {
       unsubscribe();
       delete globalThis.indexedDB;
       PTOStore.resetStorageConnection();
   }
});

test('surfaces IndexedDB open errors and keeps fallback storage usable', async () => {
   PTOStore.resetStorageConnection();
   localStorageData.clear();
   const requests = [];
   globalThis.indexedDB = createFakeIndexedDb(requests);
   try {
       const vacationPromise = PTOStore.putVacation({
           name: 'Error trip',
           start_date: '2026-10-02',
           end_date: '2026-10-02',
           days: 1,
           hours: 0
       });
       assert.equal(requests.length, 1);
       requests[0].error = new Error('SecurityError');
       requests[0].onerror();

       const vacation = await vacationPromise;
       const status = PTOStore.getStorageStatus();
       assert.equal(status.state, 'error');
       assert.match(status.reason, /SecurityError/);
       assert.ok(vacation.id > 0);
       const vacations = await PTOStore.listVacations();
       assert.equal(vacations.length, 1);
       assert.equal(vacations[0].name, 'Error trip');
   } finally {
       delete globalThis.indexedDB;
       PTOStore.resetStorageConnection();
   }
});

test('reports missing IndexedDB and supports status subscriptions', async () => {
   PTOStore.resetStorageConnection();
   localStorageData.clear();
   delete globalThis.indexedDB;
   const seen = [];
   const unsubscribe = PTOStore.onStorageStatusChange(status => seen.push(status.state));
   assert.deepEqual(seen, ['connecting']);
   try {
       await PTOStore.putVacation({
           name: 'No IDB trip',
           start_date: '2026-10-03',
           end_date: '2026-10-03',
           days: 1,
           hours: 0
       });
       const status = PTOStore.getStorageStatus();
       assert.equal(status.state, 'no_indexeddb');
       assert.match(status.reason, /not available/);
       assert.deepEqual(seen, ['connecting', 'no_indexeddb']);

       unsubscribe();
       PTOStore.resetStorageConnection();
       await PTOStore.listVacations();
       assert.equal(PTOStore.getStorageStatus().state, 'no_indexeddb');
       assert.deepEqual(seen, ['connecting', 'no_indexeddb']);
   } finally {
       unsubscribe();
       delete globalThis.indexedDB;
       PTOStore.resetStorageConnection();
   }
});
