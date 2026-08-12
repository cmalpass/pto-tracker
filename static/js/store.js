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
    const DB_VERSION = 2;
    const SCHEMA_VERSION = 2;
    const DATA_STORES = Object.freeze(['config', 'vacations', 'notes']);
    const STORES = Object.freeze([...DATA_STORES, 'history']);
    const FALLBACK_KEY = 'pto-tracker:data:v2';
    const LEGACY_FALLBACK_KEY = 'pto-tracker:data:v1';
    let databasePromise;

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
            if (record.accrual_start_date != null && !isCanonicalDate(record.accrual_start_date)) {
                throw new TypeError('accrual_start_date must use YYYY-MM-DD format');
            }
            if (record.timezone != null) {
                try {
                    new Intl.DateTimeFormat('en-US', { timeZone: String(record.timezone) }).format();
                } catch (_) {
                    throw new TypeError('timezone must be a valid IANA timezone');
                }
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
        if (record && (storeName === 'vacations' || storeName === 'notes')
                && record.deleted_at == null) {
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
            return Promise.resolve(null);
        }
        databasePromise = new Promise((resolve) => {
            let request;
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (_) {
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
                db.onversionchange = () => db.close();
                resolve(db);
            };
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        });
        return databasePromise;
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
        const legacyRaw = currentRaw ? null : storage.getItem(LEGACY_FALLBACK_KEY);
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
                storage.removeItem(LEGACY_FALLBACK_KEY);
            }
            return data;
        } catch (error) {
            throw new Error(`Unable to read browser PTO data: ${error.message}`);
        }
    }

    function writeFallback(data) {
        fallbackStorage().setItem(FALLBACK_KEY, JSON.stringify(data));
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
        const db = await openDatabase();
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
        const db = await openDatabase();
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
        const db = await openDatabase();
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
        const db = await openDatabase();
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
        if (!payload || ![1, SCHEMA_VERSION].includes(payload.schemaVersion) || !payload.data) {
            throw new TypeError(`Unsupported PTO data schema; expected version 1 or ${SCHEMA_VERSION}`);
        }
        if (!Array.isArray(payload.data.vacations) || !Array.isArray(payload.data.notes)) {
            throw new TypeError('Imported vacations and notes must be arrays');
        }
        const incoming = {
            config: payload.data.config == null ? null : validateRecord('config', payload.data.config),
            vacations: (payload.data.vacations || []).map(item => validateRecord('vacations', item)),
            notes: (payload.data.notes || []).map(item => validateRecord('notes', item))
        };
        const replace = !options || options.replace !== false;
        if (!replace) {
            if (incoming.config) await put('config', incoming.config);
            for (const record of incoming.vacations) await put('vacations', record);
            for (const record of incoming.notes) await put('notes', record);
        } else {
            const db = await openDatabase();
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
        requestPersistentStorage
    });
}));
