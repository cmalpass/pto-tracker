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
    const DB_VERSION = 1;
    const SCHEMA_VERSION = 1;
    const STORES = Object.freeze(['config', 'vacations', 'notes']);
    const FALLBACK_KEY = 'pto-tracker:data:v1';
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
        } else if (!isCanonicalDate(record.date)) {
            throw new TypeError('Note date must use YYYY-MM-DD format');
        } else if (record.id != null && (!Number.isInteger(record.id) || record.id < 1)) {
            throw new TypeError('Note id must be a positive integer');
        }
        return record;
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
        const raw = fallbackStorage().getItem(FALLBACK_KEY);
        if (!raw) {
            return { config: [], vacations: [], notes: [], nextId: { vacations: 1, notes: 1 } };
        }
        try {
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new TypeError('Stored PTO data must be an object');
            }
            for (const name of STORES) {
                if (!Array.isArray(data[name])) {
                    throw new TypeError(`Stored ${name} data must be an array`);
                }
            }
            data.nextId = data.nextId || { vacations: 1, notes: 1 };
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

    async function get(storeName, id) {
        assertStore(storeName);
        const db = await openDatabase();
        if (db) {
            return idbRequest(db, storeName, 'readonly', store => store.get(id));
        }
        return clone(readFallback()[storeName].find(item => item.id === id));
    }

    async function list(storeName) {
        assertStore(storeName);
        const db = await openDatabase();
        let records;
        if (db) {
            records = await idbRequest(db, storeName, 'readonly', store => store.getAll());
        } else {
            records = clone(readFallback()[storeName]);
        }
        if (storeName === 'vacations') {
            records.sort((a, b) => a.start_date.localeCompare(b.start_date) || Number(a.id) - Number(b.id));
        } else if (storeName === 'notes') {
            records.sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
        }
        return records;
    }

    async function put(storeName, value) {
        const record = validateRecord(storeName, value);
        if (storeName !== 'config' && !record.created_at) {
            record.created_at = new Date().toISOString();
        }
        const db = await openDatabase();
        if (db) {
            const id = await idbRequest(db, storeName, 'readwrite', store => store.put(record));
            return get(storeName, id);
        }
        const data = readFallback();
        if (storeName !== 'config' && record.id == null) {
            record.id = data.nextId[storeName] || 1;
            data.nextId[storeName] = record.id + 1;
        } else if (storeName !== 'config' && Number.isInteger(record.id)) {
            data.nextId[storeName] = Math.max(data.nextId[storeName] || 1, record.id + 1);
        }
        const index = data[storeName].findIndex(item => item.id === record.id);
        if (index < 0) {
            data[storeName].push(record);
        } else {
            data[storeName][index] = record;
        }
        writeFallback(data);
        return clone(record);
    }

    async function remove(storeName, id) {
        assertStore(storeName);
        const db = await openDatabase();
        if (db) {
            await idbRequest(db, storeName, 'readwrite', store => store.delete(id));
            return true;
        }
        const data = readFallback();
        const length = data[storeName].length;
        data[storeName] = data[storeName].filter(item => item.id !== id);
        writeFallback(data);
        return data[storeName].length !== length;
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
        if (!payload || payload.schemaVersion !== SCHEMA_VERSION || !payload.data) {
            throw new TypeError(`Unsupported PTO data schema; expected version ${SCHEMA_VERSION}`);
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
                    const transaction = db.transaction(STORES, 'readwrite');
                    transaction.oncomplete = resolve;
                    transaction.onerror = () => reject(transaction.error);
                    transaction.onabort = () => reject(transaction.error || new Error('Import aborted'));
                    STORES.forEach(storeName => transaction.objectStore(storeName).clear());
                    if (incoming.config) transaction.objectStore('config').put(incoming.config);
                    incoming.vacations.forEach(record =>
                        transaction.objectStore('vacations').put(record));
                    incoming.notes.forEach(record => transaction.objectStore('notes').put(record));
                });
            } else {
                const previous = readFallback();
                try {
                    await Promise.all(STORES.map(clear));
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
        clear,
        getConfig,
        putConfig,
        getVacation: id => get('vacations', id),
        putVacation: value => put('vacations', value),
        listVacations: () => list('vacations'),
        deleteVacation: id => remove('vacations', id),
        getNote: id => get('notes', id),
        putNote: value => put('notes', value),
        listNotes: () => list('notes'),
        deleteNote: id => remove('notes', id),
        exportJSON,
        importJSON,
        requestPersistentStorage
    });
}));
