(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.PTOStore = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DB_NAME = 'pto-tracker';
    const DB_VERSION = 3;
    const SCHEMA_VERSION = 3;
    const DATA_STORES = Object.freeze(['config', 'vacations', 'notes']);
    const STORES = Object.freeze([...DATA_STORES, 'history']);
    const FALLBACK_KEY = 'pto-tracker:data:v3';
    const LEGACY_FALLBACK_KEYS = Object.freeze([
        'pto-tracker:data:v2',
        'pto-tracker:data:v1'
    ]);
    const LEAVE_TYPES = Object.freeze(['vacation', 'sick', 'personal', 'holiday']);
    let databasePromise;
    let activeDb = null;
    let storageStatus = Object.freeze({ state: 'connecting', reason: null });
    const statusListeners = new Set();

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function isCanonicalDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return false;
        }
        const [year, month, day] = value.split('-').map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return parsed.getUTCFullYear() === year
            && parsed.getUTCMonth() === month - 1
            && parsed.getUTCDate() === day;
    }

    function normalizeLeaveType(value) {
        const candidate = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        const aliases = {
            pto: 'vacation',
            paid_time_off: 'vacation',
            paid_leave: 'vacation',
            personal_day: 'personal',
            public_holiday: 'holiday'
        };
        const normalized = aliases[candidate] || candidate;
        return LEAVE_TYPES.includes(normalized) ? normalized : 'vacation';
    }

    function normalizeQuarterHours(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.round(Math.max(0, numeric) * 4) / 4 : 0;
    }

    function isQuarterHour(value) {
        return Math.abs((value * 4) - Math.round(value * 4)) < 1e-9;
    }

    function setStorageStatus(state, reason = null) {
        if (storageStatus.state === state && storageStatus.reason === reason) {
            return;
        }
        storageStatus = Object.freeze({ state, reason });
        if (state === 'error' || state === 'blocked') {
            console.warn('PTO Tracker storage degraded', { state, reason });
        }
        for (const listener of [...statusListeners]) {
            try {
                listener(storageStatus);
            } catch (error) {
                console.warn('PTO Tracker storage status listener failed', error);
            }
        }
    }

    function getStorageStatus() {
        return storageStatus;
    }

    function onStorageStatusChange(listener) {
        statusListeners.add(listener);
        listener(storageStatus);
        return () => statusListeners.delete(listener);
    }

    // Test hook: clear the cached connection so the next call re-opens.
    // Needed because Node test suites share one module instance.
    function resetStorageConnection() {
        databasePromise = undefined;
        activeDb = null;
        storageStatus = Object.freeze({ state: 'connecting', reason: null });
    }

    function assertVacationAmount(record, config) {
        const days = Number(record.days ?? 0);
        const hours = Number(record.hours ?? 0);
        const hoursPerDay = Number(config?.pto_hours_per_day) || 8;
        if (!Number.isFinite(days) || days < 0) {
            throw new TypeError('Vacation days must be a non-negative number');
        }
        if (!Number.isFinite(hours) || hours < 0 || !isQuarterHour(hours)) {
            throw new TypeError('Vacation hours must use 0.25-hour increments');
        }
        if (hours > hoursPerDay + 1e-9) {
            throw new RangeError(`Vacation hours cannot exceed ${hoursPerDay} hours per day`);
        }
        if (!isQuarterHour((days * hoursPerDay) + hours)) {
            throw new TypeError(
                `Vacation amount must resolve to quarter-hours using ${hoursPerDay} hours per day`
            );
        }
    }

    function assertStore(storeName) {
        if (!STORES.includes(storeName)) {
            throw new TypeError(`Unknown store: ${storeName}`);
        }
    }

    function validateRecord(storeName, value) {
        assertStore(storeName);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError(`${storeName} records must be objects`);
        }
        const record = clone(value);
        if (storeName === 'config') {
            if (record.accrual_start_date == null) {
                // An explicit null or missing value means "no stored value"; the
                // DEFAULT_CONFIG merge in state.js supplies the default. Keeping the
                // key with a null value would override the default and crash every
                // accrual calculation (see issue #116).
                delete record.accrual_start_date;
            } else if (!isCanonicalDate(record.accrual_start_date)) {
                throw new TypeError('accrual_start_date must use YYYY-MM-DD format');
            }
            if (record.timezone != null) {
                try {
                    new Intl.DateTimeFormat('en-US', { timeZone: String(record.timezone) }).format();
                } catch (_) {
                    throw new TypeError('timezone must be a valid IANA timezone');
                }
            }
            if (record.pto_hours_per_day != null
                    && (!Number.isFinite(Number(record.pto_hours_per_day))
                        || Number(record.pto_hours_per_day) <= 0)) {
                throw new TypeError('pto_hours_per_day must be greater than zero');
            }
            if (record.pto_hours_per_day != null
                    && !isQuarterHour(Number(record.pto_hours_per_day))) {
                throw new TypeError('pto_hours_per_day must use 0.25-hour increments');
            }
            const boundaryErrors = globalThis.PTO.validatePtoYearBoundaries(record.pto_year_boundaries);
            if (boundaryErrors.length) {
                throw new TypeError(boundaryErrors.join(' '));
            }
            record.id = 'config';
        } else if (storeName === 'vacations') {
            if (!isCanonicalDate(record.start_date) || !isCanonicalDate(record.end_date)) {
                throw new TypeError('Vacation dates must use YYYY-MM-DD format');
            }
            if (record.start_date > record.end_date) {
                throw new RangeError('start_date cannot be after end_date');
            }
            if (record.id != null && (!Number.isInteger(record.id) || record.id < 1)) {
                throw new TypeError('Vacation id must be a positive integer');
            }
            if (record.days != null
                    && (!Number.isFinite(Number(record.days)) || Number(record.days) < 0)) {
                throw new TypeError('Vacation days must be a non-negative number');
            }
            if (record.hours != null
                    && (!Number.isFinite(Number(record.hours)) || Number(record.hours) < 0)) {
                throw new TypeError('Vacation hours must be a non-negative number');
            }
            if (record.days != null) record.days = Number(record.days);
            if (record.hours != null) {
                record.hours = Number(record.hours);
                if (!isQuarterHour(record.hours)) {
                    throw new TypeError('Vacation hours must use 0.25-hour increments');
                }
            }
            record.type = normalizeLeaveType(record.type ?? record.leave_type ?? record.category);
        } else if (storeName === 'notes' && !isCanonicalDate(record.date)) {
            throw new TypeError('Note date must use YYYY-MM-DD format');
        } else if (storeName === 'notes'
                && record.id != null && (!Number.isInteger(record.id) || record.id < 1)) {
            throw new TypeError('Note id must be a positive integer');
        } else if (storeName === 'history') {
            if (!['create', 'update', 'delete', 'restore', 'import'].includes(record.action)) {
                throw new TypeError('History action is invalid');
            }
            if (!['config', 'vacations', 'notes', 'system'].includes(record.store)) {
                throw new TypeError('History store is invalid');
            }
            if (!record.at || typeof record.at !== 'string') {
                throw new TypeError('History timestamp is required');
            }
        }
        return record;
    }

    function normalizeRecord(storeName, value) {
        const record = clone(value);
        if (record && storeName === 'vacations') {
            record.type = normalizeLeaveType(record.type ?? record.leave_type ?? record.category);
            if (record.hours != null) record.hours = normalizeQuarterHours(record.hours);
            if (record.deleted_at == null) record.deleted_at = null;
        } else if (record && storeName === 'notes' && record.deleted_at == null) {
            record.deleted_at = null;
        }
        return record;
    }

    function isDeleted(record) {
        return Boolean(record?.deleted_at);
    }

    function openDatabase() {
        if (databasePromise) {
            return databasePromise;
        }
        if (typeof indexedDB === 'undefined') {
            setStorageStatus('no_indexeddb', 'IndexedDB is not available in this browser');
            return Promise.resolve(null);
        }
        databasePromise = new Promise((resolve) => {
            let request;
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (_) {
                setStorageStatus('error', 'IndexedDB open threw synchronously');
                resolve(null);
                return;
            }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('config')) {
                    db.createObjectStore('config', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('vacations')) {
                    db.createObjectStore('vacations', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('notes')) {
                    db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('history')) {
                    db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
                }
                ['vacations', 'notes'].forEach(storeName => {
                    if (!request.transaction.objectStore(storeName)) return;
                    const cursorRequest = request.transaction.objectStore(storeName).openCursor();
                    cursorRequest.onsuccess = () => {
                        const cursor = cursorRequest.result;
                        if (!cursor) return;
                        const record = normalizeRecord(storeName, cursor.value);
                        cursor.update(record);
                        cursor.continue();
                    };
                });
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    // Another connection wants a newer schema version. Drop
                    // this connection and re-open so we either upgrade in
                    // place or stay degraded until the other tab closes.
                    activeDb = null;
                    db.close();
                    databasePromise = undefined;
                    setStorageStatus('blocked', 'another tab requested a database upgrade');
                    databasePromise = openDatabase();
                };
                (async () => {
                    await reconcileFallbackIntoDatabase(db);
                    activeDb = db;
                    setStorageStatus('ok');
                    resolve(db);
                })();
            };
            request.onerror = () => {
                setStorageStatus('error', request.error?.message || 'IndexedDB open failed');
                resolve(null);
            };
            request.onblocked = () => {
                // Another connection holds the database. Degrade to fallback
                // storage immediately so the app never hangs, but keep the
                // open request alive: once the other connection closes,
                // onsuccess fires above and we reconnect without a reload.
                setStorageStatus('blocked', 'another tab is holding PTO storage');
                resolve(null);
            };
        });
        return databasePromise;
    }

    async function currentDatabase() {
        if (activeDb) {
            return activeDb;
        }
        const db = await openDatabase();
        if (activeDb) {
            return activeDb;
        }
        return db && db.open ? db : null;
    }

    function fallbackStorage() {
        if (typeof localStorage === 'undefined') {
            throw new Error('Browser storage is unavailable');
        }
        return localStorage;
    }

    function readFallback() {
        const storage = fallbackStorage();
        const currentRaw = storage.getItem(FALLBACK_KEY);
        const legacyKey = LEGACY_FALLBACK_KEYS.find(key => storage.getItem(key));
        const legacyRaw = currentRaw ? null : (legacyKey ? storage.getItem(legacyKey) : null);
        const raw = currentRaw || legacyRaw;
        if (!raw) {
            return {
                config: [], vacations: [], notes: [], history: [],
                nextId: { vacations: 1, notes: 1, history: 1 }
            };
        }
        try {
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new TypeError('Stored PTO data must be an object');
            }
            for (const name of STORES) {
                if (name !== 'history' && !Array.isArray(data[name])) {
                    throw new TypeError(`Stored ${name} data must be an array`);
                }
            }
            data.history = Array.isArray(data.history) ? data.history : [];
            data.nextId = {
                vacations: data.nextId?.vacations || 1,
                notes: data.nextId?.notes || 1,
                history: data.nextId?.history || 1
            };
            data.vacations = data.vacations.map(item => normalizeRecord('vacations', item));
            data.notes = data.notes.map(item => normalizeRecord('notes', item));
            if (legacyRaw) {
                writeFallback(data);
                LEGACY_FALLBACK_KEYS.forEach(key => storage.removeItem(key));
            }
            return data;
        } catch (error) {
            throw new Error(`Unable to read browser PTO data: ${error.message}`);
        }
    }

    function writeFallback(data) {
        fallbackStorage().setItem(FALLBACK_KEY, JSON.stringify(data));
    }

    // Merge fallback (localStorage) records into IndexedDB on a successful
    // connection, then re-sync the fallback from the merged database so the
    // next degraded window starts from merged state. On the same id the DB
    // record wins (conservative union - without timestamps there is no way
    // to know which copy is newer).
    async function reconcileFallbackIntoDatabase(db) {
        try {
            const data = readFallback();
            const idStores = ['vacations', 'notes', 'history'];
            const hasFallbackData = idStores.some(name => data[name].length) || data.config.length > 0;
            if (!hasFallbackData) {
                return;
            }
            for (const storeName of idStores) {
                if (!data[storeName].length) continue;
                const existingKeys = await idbRequest(db, storeName, 'readonly', store => store.getAllKeys());
                const missing = data[storeName].filter(record => !existingKeys.includes(record.id));
                for (const record of missing) {
                    await idbRequest(db, storeName, 'readwrite', store => store.put(record));
                }
            }
            if (data.config.length) {
                const existingConfig = await idbRequest(db, 'config', 'readonly', store => store.get('config'));
                if (!existingConfig) {
                    await idbRequest(db, 'config', 'readwrite', store => store.put(data.config[0]));
                }
            }
            // Re-sync the fallback from the merged database.
            const merged = {
                config: await idbRequest(db, 'config', 'readonly', store => store.getAll()),
                vacations: await idbRequest(db, 'vacations', 'readonly', store => store.getAll()),
                notes: await idbRequest(db, 'notes', 'readonly', store => store.getAll()),
                history: await idbRequest(db, 'history', 'readonly', store => store.getAll()),
                nextId: {}
            };
            for (const storeName of idStores) {
                const maxId = merged[storeName].reduce((max, record) => Math.max(max, Number(record.id) || 0), 0);
                merged.nextId[storeName] = Math.max(maxId + 1, data.nextId[storeName] || 1);
            }
            writeFallback(merged);
        } catch (error) {
            console.warn('PTO Tracker: could not reconcile browser fallback storage', error);
        }
    }

    function idbRequest(db, storeName, mode, operation) {
        return new Promise((resolve, reject) => {
            let transaction;
            let request;
            let result;
            try {
                transaction = db.transaction(storeName, mode);
                request = operation(transaction.objectStore(storeName));
            } catch (error) {
                reject(error);
                return;
            }
            request.onsuccess = () => {
                result = request.result;
            };
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => resolve(clone(result));
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
        });
    }

    async function getRaw(storeName, id) {
        assertStore(storeName);
        const db = await currentDatabase();
        if (db) {
            const record = await idbRequest(db, storeName, 'readonly', store => store.get(id));
            return normalizeRecord(storeName, record);
        }
        return normalizeRecord(storeName, readFallback()[storeName].find(item => item.id === id));
    }

    async function get(storeName, id, options = {}) {
        const record = await getRaw(storeName, id);
        if (!options.includeDeleted && isDeleted(record)) return undefined;
        return record;
    }

    async function list(storeName, options = {}) {
        assertStore(storeName);
        const db = await currentDatabase();
        let records;
        if (db) {
            records = await idbRequest(db, storeName, 'readonly', store => store.getAll());
        } else {
            records = clone(readFallback()[storeName]);
        }
        records = records.map(record => normalizeRecord(storeName, record));
        if (!options.includeDeleted && (storeName === 'vacations' || storeName === 'notes')) {
            records = records.filter(record => !isDeleted(record));
        }
        if (storeName === 'vacations') {
            records.sort((a, b) => a.start_date.localeCompare(b.start_date) || Number(a.id) - Number(b.id));
        } else if (storeName === 'notes') {
            records.sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
        } else if (storeName === 'history') {
            records.sort((a, b) => String(b.at).localeCompare(String(a.at)) || Number(b.id) - Number(a.id));
        }
        return records;
    }

    async function writeRecord(storeName, value) {
        const record = validateRecord(storeName, value);
        if (storeName !== 'config' && !record.created_at) {
            record.created_at = new Date().toISOString();
        }
        const normalized = normalizeRecord(storeName, record);
        const db = await currentDatabase();
        if (db) {
            const id = await idbRequest(db, storeName, 'readwrite', store => store.put(normalized));
            return getRaw(storeName, id);
        }
        const data = readFallback();
        if (storeName !== 'config' && normalized.id == null) {
            normalized.id = data.nextId[storeName] || 1;
            data.nextId[storeName] = normalized.id + 1;
        } else if (storeName !== 'config' && Number.isInteger(normalized.id)) {
            data.nextId[storeName] = Math.max(data.nextId[storeName] || 1, normalized.id + 1);
        }
        const index = data[storeName].findIndex(item => item.id === normalized.id);
        if (index < 0) {
            data[storeName].push(normalized);
        } else {
            data[storeName][index] = normalized;
        }
        writeFallback(data);
        return clone(normalized);
    }

    async function appendHistory(action, storeName, record) {
        return writeRecord('history', {
            action,
            store: storeName,
            recordId: record?.id ?? null,
            at: new Date().toISOString(),
            record: clone(record)
        });
    }

    async function put(storeName, value) {
        if (storeName === 'vacations') {
            assertVacationAmount(value, await getConfig());
        }
        const previous = value?.id == null ? null : await getRaw(storeName, value.id);
        const record = await writeRecord(storeName, value);
        if (storeName !== 'history') {
            await appendHistory(previous ? 'update' : 'create', storeName, record);
        }
        return record;
    }

    async function softDelete(storeName, id) {
        if (storeName !== 'vacations' && storeName !== 'notes') {
            throw new TypeError('Only vacations and notes can be deleted');
        }
        const record = await getRaw(storeName, id);
        if (!record || isDeleted(record)) return false;
        const deleted = await writeRecord(storeName, {
            ...record,
            deleted_at: new Date().toISOString()
        });
        await appendHistory('delete', storeName, deleted);
        return true;
    }

    async function restore(storeName, id) {
        if (storeName !== 'vacations' && storeName !== 'notes') {
            throw new TypeError('Only vacations and notes can be restored');
        }
        const record = await getRaw(storeName, id);
        if (!record || !isDeleted(record)) return false;
        const restored = await writeRecord(storeName, { ...record, deleted_at: null });
        await appendHistory('restore', storeName, restored);
        return true;
    }

    async function remove(storeName, id) {
        return softDelete(storeName, id);
    }

    async function clear(storeName) {
        assertStore(storeName);
        const db = await currentDatabase();
        if (db) {
            await idbRequest(db, storeName, 'readwrite', store => store.clear());
            return;
        }
        const data = readFallback();
        data[storeName] = [];
        if (storeName !== 'config') {
            data.nextId[storeName] = 1;
        }
        writeFallback(data);
    }

    async function getConfig() {
        const record = await get('config', 'config');
        if (!record) {
            return null;
        }
        const result = clone(record);
        delete result.id;
        return result;
    }

    function putConfig(config) {
        return put('config', config).then(record => {
            const result = clone(record);
            delete result.id;
            return result;
        });
    }

    async function exportJSON(space) {
        const payload = {
            schemaVersion: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            data: {
                config: await getConfig(),
                vacations: await list('vacations'),
                notes: await list('notes')
            }
        };
        return JSON.stringify(payload, null, space == null ? 2 : space);
    }

    async function importJSON(input, options) {
        const payload = typeof input === 'string' ? JSON.parse(input) : clone(input);
        if (!payload || ![1, 2, SCHEMA_VERSION].includes(payload.schemaVersion) || !payload.data) {
            throw new TypeError(`Unsupported PTO data schema; expected version 1, 2, or ${SCHEMA_VERSION}`);
        }
        if (!Array.isArray(payload.data.vacations) || !Array.isArray(payload.data.notes)) {
            throw new TypeError('Imported vacations and notes must be arrays');
        }
        const incoming = {
            config: payload.data.config == null ? null : validateRecord('config', payload.data.config),
            vacations: (payload.data.vacations || []).map(item => validateRecord('vacations', item)),
            notes: (payload.data.notes || []).map(item => validateRecord('notes', item))
        };
        const importConfig = incoming.config || await getConfig() || {};
        incoming.vacations.forEach(record => assertVacationAmount(record, importConfig));
        const replace = !options || options.replace !== false;
        if (!replace) {
            if (incoming.config) await put('config', incoming.config);
            for (const record of incoming.vacations) await put('vacations', record);
            for (const record of incoming.notes) await put('notes', record);
        } else {
            const db = await currentDatabase();
            if (db) {
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction(DATA_STORES, 'readwrite');
                    transaction.oncomplete = resolve;
                    transaction.onerror = () => reject(transaction.error);
                    transaction.onabort = () => reject(transaction.error || new Error('Import aborted'));
                    DATA_STORES.forEach(storeName => transaction.objectStore(storeName).clear());
                    if (incoming.config) transaction.objectStore('config').put(incoming.config);
                    incoming.vacations.forEach(record =>
                        transaction.objectStore('vacations').put(record));
                    incoming.notes.forEach(record => transaction.objectStore('notes').put(record));
                });
            } else {
                const previous = readFallback();
                try {
                    await Promise.all(DATA_STORES.map(clear));
                    if (incoming.config) await put('config', incoming.config);
                    for (const record of incoming.vacations) await put('vacations', record);
                    for (const record of incoming.notes) await put('notes', record);
                } catch (error) {
                    writeFallback(previous);
                    throw error;
                }
            }
        }
        return {
            schemaVersion: SCHEMA_VERSION,
            imported: {
                config: incoming.config ? 1 : 0,
                vacations: incoming.vacations.length,
                notes: incoming.notes.length
            }
        };
    }

    async function requestPersistentStorage() {
        if (typeof navigator === 'undefined' || !navigator.storage
                || typeof navigator.storage.persist !== 'function') {
            return false;
        }
        try {
            if (typeof navigator.storage.persisted === 'function'
                    && await navigator.storage.persisted()) {
                return true;
            }
            return Boolean(await navigator.storage.persist());
        } catch (_) {
            return false;
        }
    }

    return Object.freeze({
        DB_NAME,
        DB_VERSION,
        SCHEMA_VERSION,
        STORES,
        isCanonicalDate,
        normalizeLeaveType,
        get,
        put,
        list,
        delete: remove,
        restore,
        clear,
        getConfig,
        putConfig,
        getVacation: id => get('vacations', id),
        putVacation: value => put('vacations', value),
        listVacations: () => list('vacations'),
        deleteVacation: id => remove('vacations', id),
        restoreVacation: id => restore('vacations', id),
        getNote: id => get('notes', id),
        putNote: value => put('notes', value),
        listNotes: () => list('notes'),
        deleteNote: id => remove('notes', id),
        restoreNote: id => restore('notes', id),
        getHistory: id => get('history', id),
        listHistory: () => list('history', { includeDeleted: true }),
        exportJSON,
        importJSON,
        requestPersistentStorage,
        getStorageStatus,
        onStorageStatusChange,
        resetStorageConnection
    });
}));
