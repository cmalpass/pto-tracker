(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.PTOTransfer = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CRLF = '\r\n';
    const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
    const LEAVE_TYPES = Object.freeze({
        vacation: { label: 'Vacation' },
        sick: { label: 'Sick' },
        personal: { label: 'Personal' },
        holiday: { label: 'Holiday' }
    });

    function isCanonicalDate(value) {
        if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
        const [year, month, day] = value.split('-').map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return parsed.getUTCFullYear() === year
            && parsed.getUTCMonth() === month - 1
            && parsed.getUTCDate() === day;
    }

    function assertCanonicalDate(value, label) {
        if (!isCanonicalDate(value)) {
            throw new TypeError(`${label} must use YYYY-MM-DD format`);
        }
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
        return Object.prototype.hasOwnProperty.call(LEAVE_TYPES, normalized)
            ? normalized : 'vacation';
    }

    function addDays(value, amount) {
        const [year, month, day] = value.split('-').map(Number);
        const result = new Date(Date.UTC(year, month - 1, day + amount));
        return result.toISOString().slice(0, 10);
    }

    function icsDate(value) {
        return value.replace(/-/g, '');
    }

    function escapeIcsText(value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\r\n|\r|\n/g, '\\n');
    }

    function unescapeIcsText(value) {
        return String(value ?? '').replace(/\\([\\;,nN])/g, (_, escaped) => {
            if (escaped.toLowerCase() === 'n') return '\n';
            return escaped;
        });
    }

    function hash(value) {
        let result = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            result ^= value.charCodeAt(index);
            result = Math.imul(result, 16777619);
        }
        return (result >>> 0).toString(16).padStart(8, '0');
    }

    function vacationUid(vacation) {
        if (vacation?.id != null) return `vacation-${vacation.id}@pto-tracker.local`;
        const key = `${vacation?.name || ''}|${vacation?.start_date || ''}|${vacation?.end_date || ''}`;
        return `vacation-${hash(key)}@pto-tracker.local`;
    }

    function foldLine(line) {
        const chunks = [];
        let current = '';
        for (const character of String(line)) {
            if (current && new TextEncoder().encode(current + character).length > 75) {
                chunks.push(current);
                current = ` ${character}`;
            } else {
                current += character;
            }
        }
        if (current || !chunks.length) chunks.push(current);
        return chunks.join(CRLF);
    }

    function formatTimestamp(value) {
        const date = value instanceof Date ? value : new Date(value || Date.now());
        if (Number.isNaN(date.getTime())) throw new TypeError('ICS timestamp must be valid');
        return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }

    function normalizeExportVacation(vacation) {
        if (!vacation || typeof vacation !== 'object') {
            throw new TypeError('Vacation must be an object');
        }
        assertCanonicalDate(vacation.start_date, 'start_date');
        assertCanonicalDate(vacation.end_date, 'end_date');
        if (vacation.start_date > vacation.end_date) {
            throw new RangeError('start_date cannot be after end_date');
        }
        const name = String(vacation.name ?? '').trim() || 'Vacation';
        return {
            ...vacation,
            name,
            type: normalizeLeaveType(vacation.type ?? vacation.leave_type)
        };
    }

    function toICS(vacations = [], options = {}) {
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//PTO Tracker//Vacation Calendar//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH'
        ];
        vacations.map(normalizeExportVacation).forEach(vacation => {
            lines.push(
                'BEGIN:VEVENT',
                `UID:${escapeIcsText(vacationUid(vacation))}`,
                `DTSTAMP:${formatTimestamp(options.timestamp)}`,
                `DTSTART;VALUE=DATE:${icsDate(vacation.start_date)}`,
                `DTEND;VALUE=DATE:${icsDate(addDays(vacation.end_date, 1))}`,
                `SUMMARY:${escapeIcsText(vacation.name)}`,
                `CATEGORIES:${escapeIcsText(LEAVE_TYPES[vacation.type].label)}`,
                `X-PTO-TYPE:${vacation.type}`,
                `X-PTO-DAYS:${vacation.days ?? ''}`,
                `X-PTO-HOURS:${vacation.hours ?? ''}`,
                'END:VEVENT'
            );
        });
        lines.push('END:VCALENDAR');
        return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
    }

    function escapeCsv(value) {
        const text = String(value ?? '');
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function toCSV(vacations = []) {
        const rows = [
            ['Name', 'Start Date', 'End Date', 'Days', 'Hours', 'Type'],
            ...vacations.map(normalizeExportVacation).map(vacation => [
                vacation.name,
                vacation.start_date,
                vacation.end_date,
                vacation.days ?? '',
                vacation.hours ?? '',
                vacation.type
            ])
        ];
        return `${rows.map(row => row.map(escapeCsv).join(',')).join(CRLF)}${CRLF}`;
    }

    function parseDelimited(text) {
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;
        for (let index = 0; index < String(text).length; index += 1) {
            const character = String(text)[index];
            if (quoted) {
                if (character === '"' && String(text)[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else if (character === '"') {
                    quoted = false;
                } else {
                    field += character;
                }
            } else if (character === '"') {
                quoted = true;
            } else if (character === ',') {
                row.push(field);
                field = '';
            } else if (character === '\r' || character === '\n') {
                if (character === '\r' && String(text)[index + 1] === '\n') index += 1;
                row.push(field);
                if (row.some(value => value.trim() !== '')) rows.push(row);
                row = [];
                field = '';
            } else {
                field += character;
            }
        }
        if (quoted) throw new TypeError('CSV contains an unterminated quoted field');
        if (field || row.length) {
            row.push(field);
            if (row.some(value => value.trim() !== '')) rows.push(row);
        }
        return rows;
    }

    function normalizeHeader(value) {
        return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }

    function parseCSV(text) {
        const rows = parseDelimited(text);
        if (!rows.length) throw new TypeError('CSV file is empty');
        const headers = rows.shift().map(normalizeHeader);
        const aliases = {
            name: ['name', 'trip_name', 'vacation_name', 'summary'],
            start_date: ['start_date', 'start', 'from'],
            end_date: ['end_date', 'end', 'to'],
            days: ['days', 'pto_days'],
            hours: ['hours', 'pto_hours'],
            type: ['type', 'leave_type', 'category']
        };
        const indexFor = key => aliases[key].map(alias => headers.indexOf(alias))
            .find(index => index >= 0);
        const indexes = Object.fromEntries(Object.keys(aliases).map(key => [key, indexFor(key)]));
        ['name', 'start_date', 'end_date'].forEach(key => {
            if (indexes[key] == null) throw new TypeError(`CSV is missing a ${key.replace('_', ' ')} column`);
        });
        return rows.map((values, index) => {
            const row = {
                source: `CSV row ${index + 2}`,
                name: values[indexes.name] ?? '',
                start_date: values[indexes.start_date] ?? '',
                end_date: values[indexes.end_date] ?? '',
                days: indexes.days == null ? null : values[indexes.days] ?? '',
                hours: indexes.hours == null ? null : values[indexes.hours] ?? ''
            };
            if (indexes.type != null) {
                const type = normalizeLeaveType(values[indexes.type]);
                if (type !== 'vacation') row.type = type;
            }
            return row;
        });
    }

    function splitIcsProperty(line) {
        const separator = line.indexOf(':');
        if (separator < 0) return null;
        const left = line.slice(0, separator);
        const value = line.slice(separator + 1);
        const parts = left.split(';');
        const name = parts.shift().toUpperCase();
        const params = Object.fromEntries(parts.map(part => {
            const [key, parameterValue = ''] = part.split('=');
            return [key.toUpperCase(), parameterValue.replace(/^"(.*)"$/, '$1').toUpperCase()];
        }));
        return { name, params, value };
    }

    function parseIcsDate(value, label) {
        const clean = String(value).trim();
        if (!/^\d{8}$/.test(clean)) throw new TypeError(`${label} must be an all-day VALUE=DATE`);
        const date = `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
        assertCanonicalDate(date, label);
        return date;
    }

    function parseICS(text) {
        const unfolded = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
            .split(/\r\n|\n|\r/);
        const rows = [];
        let event = null;
        unfolded.forEach(line => {
            const property = splitIcsProperty(line);
            if (!property) return;
            if (property.name === 'BEGIN' && property.value.toUpperCase() === 'VEVENT') {
                event = { source: `ICS event ${rows.length + 1}` };
                return;
            }
            if (property.name === 'END' && property.value.toUpperCase() === 'VEVENT') {
                if (event) rows.push(event);
                event = null;
                return;
            }
            if (!event) return;
            if (property.name === 'SUMMARY') event.name = unescapeIcsText(property.value);
            if (property.name === 'X-PTO-TYPE') event.type = normalizeLeaveType(property.value);
            if (property.name === 'X-PTO-DAYS') event.days = property.value.trim() === ''
                ? null : property.value;
            if (property.name === 'X-PTO-HOURS') event.hours = property.value.trim() === ''
                ? null : property.value;
            if (property.name === 'DTSTART') {
                if (property.params.VALUE !== 'DATE') {
                    event.errors = ['ICS DTSTART must use VALUE=DATE; timed events are not supported'];
                    event.start_date = '';
                } else {
                    try {
                        event.start_date = parseIcsDate(property.value, 'DTSTART');
                    } catch (error) {
                        event.start_date = '';
                        event.errors = [error.message];
                    }
                }
            }
            if (property.name === 'DTEND') {
                if (property.params.VALUE !== 'DATE') {
                    event.errors = [...(event.errors || []),
                        'ICS DTEND must use VALUE=DATE; timed events are not supported'];
                } else {
                    try {
                        event.end_date_exclusive = parseIcsDate(property.value, 'DTEND');
                    } catch (error) {
                        event.end_date_exclusive = '';
                        event.errors = [...(event.errors || []), error.message];
                    }
                }
            }
        });
        if (event) throw new TypeError('ICS contains an unterminated VEVENT');
        if (!rows.length) throw new TypeError('ICS file contains no VEVENT entries');
        return rows.map(row => {
            const result = {
                ...row,
                name: row.name || '',
                start_date: row.start_date || '',
                end_date: row.end_date_exclusive ? addDays(row.end_date_exclusive, -1) : row.start_date,
                days: row.days == null ? null : row.days,
                hours: row.hours == null ? null : row.hours
            };
            if (result.type == null || result.type === 'vacation') delete result.type;
            return result;
        });
    }

    function parse(text, format) {
        const selected = format || (String(text).match(/^\s*BEGIN:VCALENDAR/i) ? 'ics' : 'csv');
        if (selected.toLowerCase().includes('ics') || selected.toLowerCase().includes('calendar')) {
            return { format: 'ics', rows: parseICS(text) };
        }
        return { format: 'csv', rows: parseCSV(text) };
    }

    function numberField(value, label, errors) {
        if (value == null || String(value).trim() === '') return 0;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            errors.push(`${label} must be a non-negative number`);
            return 0;
        }
        return parsed;
    }

    function validateRows(rows, options = {}) {
        const pto = options.pto;
        const config = options.config || {};
        const existing = Array.isArray(options.existingVacations) ? options.existingVacations : [];
        const active = existing.filter(item => !item?.deleted_at);
        const seen = new Set();
        const working = [...active];
        const validated = (rows || []).map((input, index) => {
            const errors = [...(input.errors || [])];
            const name = String(input.name ?? '').trim();
            const start = String(input.start_date ?? '').trim();
            const end = String(input.end_date ?? '').trim();
            if (!name) errors.push('Name is required');
            if (!isCanonicalDate(start)) errors.push('Start date must use YYYY-MM-DD format');
            if (!isCanonicalDate(end)) errors.push('End date must use YYYY-MM-DD format');
            if (isCanonicalDate(start) && isCanonicalDate(end) && start > end) {
                errors.push('Start date cannot be after end date');
            }
            const days = numberField(input.days, 'Days', errors);
            const hours = numberField(input.hours, 'Hours', errors);
            const candidate = {
                name: name || 'Vacation',
                start_date: start,
                end_date: end,
                days: days,
                hours: hours,
                type: normalizeLeaveType(input.type),
                auto_days: false
            };
            const hasDays = input.days != null && String(input.days).trim() !== '';
            if (!hasDays && pto && isCanonicalDate(start) && isCanonicalDate(end)) {
                candidate.days = pto.getVacationDays(start, end, config);
                candidate.auto_days = true;
            }
            if (pto?.normalizeBooking && !errors.length) {
                try {
                    const booking = pto.normalizeBooking(candidate.days, candidate.hours, config);
                    candidate.days = booking.days;
                    candidate.hours = booking.hours;
                } catch (error) {
                    errors.push(error.message);
                }
            }
            const key = `${name.toLowerCase()}|${start}|${end}`;
            const duplicate = seen.has(key) || active.some(item =>
                String(item.name || '').trim().toLowerCase() === name.toLowerCase()
                && item.start_date === start && item.end_date === end);
            if (duplicate) errors.push('Duplicate vacation with the same name and date range');
            const validDates = isCanonicalDate(start) && isCanonicalDate(end) && start <= end;
            if (pto && validDates) {
                const conflict = pto.detectVacationConflicts(start, end, working);
                if (conflict.has_conflicts) errors.push(conflict.error);
                try {
                    const analysis = pto.analyzeVacation(
                        start, end, candidate.days, candidate.hours, config, working);
                    analysis.warnings.filter(item => item.severity === 'error')
                        .forEach(item => errors.push(item.message));
                    candidate.analysis = analysis;
                } catch (error) {
                    errors.push(error.message);
                }
            }
            const result = {
                ...candidate,
                source: input.source || `Row ${index + 1}`,
                errors: [...new Set(errors)],
                duplicate,
                valid: errors.length === 0
            };
            if (result.valid) {
                seen.add(key);
                working.push(candidate);
            }
            return result;
        });
        return {
            rows: validated,
            valid: validated.filter(row => row.valid),
            invalid: validated.filter(row => !row.valid),
            duplicateCount: validated.filter(row => row.duplicate).length
        };
    }

    return Object.freeze({
        LEAVE_TYPES,
        isCanonicalDate,
        normalizeLeaveType,
        escapeIcsText,
        unescapeIcsText,
        vacationUid,
        toICS,
        toCSV,
        parseCSV,
        parseICS,
        parse,
        validateRows
    });
}));
