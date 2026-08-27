(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.PTO = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DAY_MS = 86400000;
    const DEFAULT_TIMEZONE = 'UTC';
    const DEFAULT_HOLIDAY_COUNTRY = 'US';
    const MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const LEAVE_TYPES = Object.freeze({
        vacation: Object.freeze({
            key: 'vacation', label: 'Vacation', color: '#4f46e5', icon: 'vacation'
        }),
        sick: Object.freeze({
            key: 'sick', label: 'Sick', color: '#dc2626', icon: 'sick'
        }),
        personal: Object.freeze({
            key: 'personal', label: 'Personal', color: '#7c3aed', icon: 'personal'
        }),
        holiday: Object.freeze({
            key: 'holiday', label: 'Holiday', color: '#0891b2', icon: 'holiday'
        })
    });
    const LEAVE_TYPE_ALIASES = Object.freeze({
        pto: 'vacation',
        paid_time_off: 'vacation',
        paid_leave: 'vacation',
        personal_day: 'personal',
        public_holiday: 'holiday'
    });

    function parseCanonicalDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new TypeError('Date must use YYYY-MM-DD format');
        }
        const [year, month, day] = value.split('-').map(Number);
        const result = new Date(Date.UTC(year, month - 1, day));
        if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1
                || result.getUTCDate() !== day) {
            throw new TypeError('Date must use YYYY-MM-DD format');
        }
        return result;
    }

    function isCanonicalDate(value) {
        try {
            parseCanonicalDate(value);
            return true;
        } catch (_) {
            return false;
        }
    }

    function dateOf(year, month, day) {
        return new Date(Date.UTC(year, month - 1, day));
    }

    function formatDate(value) {
        return value.toISOString().slice(0, 10);
    }

    function addDays(value, days) {
        return new Date(value.getTime() + (days * DAY_MS));
    }

    function daysBetween(start, end) {
        return Math.round((end - start) / DAY_MS);
    }

    function dateRange(start, end) {
        const result = [];
        for (let day = start; day <= end; day = addDays(day, 1)) {
            result.push(day);
        }
        return result;
    }

    function round2(value) {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    function numberValue(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function normalizeLeaveType(value) {
        const candidate = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        const normalized = LEAVE_TYPE_ALIASES[candidate] || candidate;
        return Object.prototype.hasOwnProperty.call(LEAVE_TYPES, normalized)
            ? normalized : 'vacation';
    }

    function leaveType(value) {
        return LEAVE_TYPES[normalizeLeaveType(value)];
    }

    function isQuarterHour(value) {
        return Math.abs((value * 4) - Math.round(value * 4)) < 1e-9;
    }

    function normalizeBooking(days, hours, config) {
        const normalized = normalizedConfig(config);
        const dayAmount = Number(days);
        const hourAmount = Number(hours);
        if (!Number.isFinite(dayAmount) || dayAmount < 0) {
            throw new TypeError('PTO days must be a non-negative number');
        }
        if (!Number.isFinite(hourAmount) || hourAmount < 0) {
            throw new TypeError('PTO hours must be a non-negative number');
        }
        if (!isQuarterHour(hourAmount)) {
            throw new TypeError('PTO hours must use 0.25-hour increments');
        }
        if (hourAmount > normalized.pto_hours_per_day + 1e-9) {
            throw new RangeError(
                `PTO hours cannot exceed ${normalized.pto_hours_per_day} hours per day`
            );
        }
        const totalHours = (dayAmount * normalized.pto_hours_per_day) + hourAmount;
        if (!isQuarterHour(totalHours)) {
            throw new TypeError(
                `PTO amount must resolve to quarter-hours using ${normalized.pto_hours_per_day} hours per day`
            );
        }
        return {
            days: round2(dayAmount),
            hours: round2(hourAmount),
            amount: round2(normalized.pto_accrual_type === 'hours'
                ? totalHours : totalHours / normalized.pto_hours_per_day),
            total_hours: round2(totalHours)
        };
    }

    function boolValue(value, fallback) {
        if (value == null) return fallback;
        if (typeof value === 'string') {
            return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
        }
        return Boolean(value);
    }

    function normalizedConfig(config) {
        const source = config || {};
        return {
            ...source,
            holiday_country: normalizeHolidayCountry(source.holiday_country),
            pto_accrual_per_pay_period: numberValue(source.pto_accrual_per_pay_period, 1),
            pto_accrual_type: source.pto_accrual_type === 'hours' ? 'hours' : 'days',
            pto_hours_per_day: numberValue(source.pto_hours_per_day, 8) || 8,
            pto_holidays_require_pto: boolValue(source.pto_holidays_require_pto, true),
            pay_periods_per_year: numberValue(source.pay_periods_per_year, 26),
            accrual_method: source.accrual_method || 'pro-rata',
            pto_carryover_limit: numberValue(source.pto_carryover_limit, 40),
            pto_uses_rollover: boolValue(source.pto_uses_rollover, true),
            // Match DEFAULT_CONFIG.pto_lose_above_limit (true) so a missing key
            // behaves the same in the engine as in the settings UI.
            pto_lose_above_limit: boolValue(source.pto_lose_above_limit, true),
            forecast_baseline_enabled: boolValue(source.forecast_baseline_enabled, false),
            forecast_baseline_date: source.forecast_baseline_date || source.accrual_start_date,
            forecast_baseline_balance: numberValue(source.forecast_baseline_balance, 0),
            pto_year_boundaries: normalizePtoYearBoundaries(source.pto_year_boundaries),
            timezone: getConfiguredTimezone(source)
        };
    }

    function normalizePtoYearBoundaries(value) {
        if (!Array.isArray(value)) return [];
        return value.map(item => ({
            year: Number(item?.year),
            final_date: typeof item?.final_date === 'string' ? item.final_date : ''
        }));
    }

    // Shared source of truth for PTO-year boundary rules, used by both the Settings
    // save path (settings.js) and the import/write path (store.js validateRecord) so a
    // crafted import can't inject out-of-year, duplicated, or unordered boundaries.
    function validatePtoYearBoundaries(value) {
        const errors = [];
        if (!Array.isArray(value)) return errors;
        const years = new Set();
        const dates = new Set();
        let previousDate = null;
        value.forEach((boundary, index) => {
            const year = Number(boundary?.year);
            const finalDate = boundary?.final_date;
            if (!Number.isInteger(year) || year < 1) {
                errors.push(`PTO year boundary ${index + 1} must use a valid year.`);
                return;
            }
            if (!isCanonicalDate(finalDate)) {
                errors.push(`PTO year ${year} final day must use YYYY-MM-DD format.`);
                return;
            }
            if (String(finalDate).slice(0, 4) !== String(year)) {
                errors.push(`PTO year ${year} final day must be within ${year}.`);
            }
            if (years.has(year)) {
                errors.push(`PTO year ${year} is configured more than once.`);
            }
            if (dates.has(finalDate)) {
                errors.push(`PTO boundary date ${finalDate} is configured more than once.`);
            }
            if (previousDate && finalDate <= previousDate) {
                errors.push('PTO year boundary dates must be unique and chronological.');
            }
            years.add(year);
            dates.add(finalDate);
            previousDate = finalDate;
        });
        return errors;
    }

    function ptoYearEnd(year, config) {
        const normalized = normalizedConfig(config);
        const configured = normalized.pto_year_boundaries.find(item => item.year === Number(year));
        const fallback = `${Number(year)}-12-31`;
        return configured && isCanonicalDate(configured.final_date)
            ? configured.final_date : fallback;
    }

    function ptoYearStart(year, config) {
        const previousEnd = parseCanonicalDate(ptoYearEnd(Number(year) - 1, config));
        return formatDate(addDays(previousEnd, 1));
    }

    function getPtoYearForDate(targetDate, config) {
        const target = typeof targetDate === 'string' ? parseCanonicalDate(targetDate) : targetDate;
        if (!(target instanceof Date) || Number.isNaN(target.getTime())) {
            throw new TypeError('targetDate must be a valid date');
        }
        const normalized = normalizedConfig(config);
        let year = target.getUTCFullYear();
        while (target > parseCanonicalDate(ptoYearEnd(year, normalized))) year += 1;
        while (target < parseCanonicalDate(ptoYearStart(year, normalized))) year -= 1;
        return year;
    }

    function getConfiguredTimezone(config) {
        const requested = config && typeof config.timezone === 'string'
            ? config.timezone.trim() : DEFAULT_TIMEZONE;
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: requested }).format();
            return requested;
        } catch (_) {
            return DEFAULT_TIMEZONE;
        }
    }

    function isValidTimezone(value) {
        if (typeof value !== 'string' || !value.trim()) return false;
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format();
            return true;
        } catch (_) {
            return false;
        }
    }

    function getLocalToday(config, now) {
        const instant = now == null ? new Date() : new Date(now);
        if (Number.isNaN(instant.getTime())) {
            throw new TypeError('now must be a valid date or timestamp');
        }
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: getConfiguredTimezone(config),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(instant);
        const part = type => parts.find(item => item.type === type).value;
        return `${part('year')}-${part('month')}-${part('day')}`;
    }

    function getLocalYear(config, now) {
        return getPtoYearForDate(getLocalToday(config, now), config);
    }

    function vestingMultiplier(targetDate, config) {
        const schedule = String(config?.pto_vesting_schedule || 'immediate').toLowerCase();
        if (schedule === 'immediate') return 1;
        const target = typeof targetDate === 'string' ? parseCanonicalDate(targetDate) : targetDate;
        const startYear = Number(config?.pto_start_year)
            || parseCanonicalDate(config.accrual_start_date).getUTCFullYear();
        const start = dateOf(startYear, 1, 1);
        const serviceYears = Math.max(0, daysBetween(start, target) / 365.25);
        if (schedule === 'cliff') return serviceYears >= 3 ? 1 : 0;
        if (schedule === 'graded') return Math.min(1, serviceYears / 3);
        return 1;
    }

    function normalizeHolidayCountry(value) {
        const country = typeof value === 'string' ? value.trim().toUpperCase() : '';
        return ['US', 'CA', 'GB', 'AU', 'FR', 'DE', 'IN', 'JP'].includes(country)
            ? country : DEFAULT_HOLIDAY_COUNTRY;
    }

    function nthWeekday(year, month, weekday, nth) {
        const first = dateOf(year, month, 1);
        return dateOf(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + ((nth - 1) * 7));
    }

    function lastWeekday(year, month, weekday) {
        const last = dateOf(year, month + 1, 0);
        return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
    }

    function easterSunday(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return dateOf(year, month, day);
    }

    function addHoliday(map, day, name, observedRule) {
        const key = formatDate(day);
        map[key] = map[key] ? `${map[key]}; ${name}` : name;
        if (!observedRule || (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)) return;
        let observed = observedRule(day);
        while (map[formatDate(observed)]) observed = addDays(observed, 1);
        if (observed.getUTCFullYear() !== day.getUTCFullYear()) return;
        const observedKey = formatDate(observed);
        const observedName = `${name} (observed)`;
        map[observedKey] = map[observedKey]
            ? `${map[observedKey]}; ${observedName}` : observedName;
    }

    function usObserved(day) {
        return addDays(day, day.getUTCDay() === 6 ? -1 : 1);
    }

    function caObserved(day) {
        return addDays(day, day.getUTCDay() === 6 ? 2 : 1);
    }

    function getUSHolidays(year) {
        const holidays = {};
        addHoliday(holidays, dateOf(year, 1, 1), "New Year's Day", usObserved);
        const nextNewYear = dateOf(year + 1, 1, 1);
        if (nextNewYear.getUTCDay() === 6) {
            holidays[formatDate(addDays(nextNewYear, -1))] = "New Year's Day (observed)";
        }
        addHoliday(holidays, lastWeekday(year, 5, 1), 'Memorial Day');
        if (year >= 2021) {
            addHoliday(holidays, dateOf(year, 6, 19), 'Juneteenth National Independence Day', usObserved);
        }
        addHoliday(holidays, dateOf(year, 7, 4), 'Independence Day', usObserved);
        addHoliday(holidays, nthWeekday(year, 9, 1, 1), 'Labor Day');
        addHoliday(holidays, dateOf(year, 11, 11), 'Veterans Day', usObserved);
        addHoliday(holidays, nthWeekday(year, 11, 4, 4), 'Thanksgiving');
        addHoliday(holidays, dateOf(year, 12, 25), 'Christmas Day', usObserved);
        if (year >= 1986) {
            addHoliday(holidays, nthWeekday(year, 1, 1, 3), 'Martin Luther King Jr. Day');
        }
        addHoliday(holidays, nthWeekday(year, 2, 1, 3), "Washington's Birthday");
        addHoliday(holidays, nthWeekday(year, 10, 1, 2), 'Columbus Day');
        return holidays;
    }

    function getCanadianHolidays(year) {
        const holidays = {};
        addHoliday(holidays, dateOf(year, 1, 1), "New Year's Day", caObserved);
        addHoliday(holidays, addDays(easterSunday(year), -2), 'Good Friday');
        addHoliday(holidays, dateOf(year, 7, 1), 'Canada Day');
        addHoliday(holidays, nthWeekday(year, 9, 1, 1), 'Labor Day');
        addHoliday(holidays, dateOf(year, 12, 25), 'Christmas Day', caObserved);
        addHoliday(holidays, dateOf(year, 12, 26), 'Boxing Day', caObserved);
        return holidays;
    }

    function getUnitedKingdomHolidays(year) {
        const holidays = {};
        addHoliday(holidays, dateOf(year, 1, 1), "New Year's Day", caObserved);
        addHoliday(holidays, addDays(easterSunday(year), -2), 'Good Friday');
        addHoliday(holidays, addDays(easterSunday(year), 1), 'Easter Monday');
        addHoliday(holidays, nthWeekday(year, 5, 1, 1), 'Early May Bank Holiday');
        addHoliday(holidays, lastWeekday(year, 5, 1), 'Spring Bank Holiday');
        addHoliday(holidays, lastWeekday(year, 8, 1), 'Summer Bank Holiday');
        addHoliday(holidays, dateOf(year, 12, 25), 'Christmas Day');
        addHoliday(holidays, dateOf(year, 12, 26), 'Boxing Day');
        for (const [day, name] of [
            [dateOf(year, 12, 25), 'Christmas Day'],
            [dateOf(year, 12, 26), 'Boxing Day']
        ]) {
            if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) continue;
            let observed = addDays(day, 1);
            while (observed.getUTCDay() === 0 || observed.getUTCDay() === 6
                    || holidays[formatDate(observed)]) {
                observed = addDays(observed, 1);
            }
            holidays[formatDate(observed)] = `${name} (substitute day)`;
        }
        return holidays;
    }

    function getAustralianHolidays(year) {
        const holidays = {};
        addHoliday(holidays, dateOf(year, 1, 1), "New Year's Day", caObserved);
        addHoliday(holidays, dateOf(year, 1, 26), 'Australia Day', caObserved);
        addHoliday(holidays, addDays(easterSunday(year), -2), 'Good Friday');
        addHoliday(holidays, addDays(easterSunday(year), 1), 'Easter Monday');
        addHoliday(holidays, dateOf(year, 4, 25), 'Anzac Day', caObserved);
        addHoliday(holidays, nthWeekday(year, 6, 1, 2), "King's Birthday");
        addHoliday(holidays, dateOf(year, 12, 25), 'Christmas Day', caObserved);
        addHoliday(holidays, dateOf(year, 12, 26), 'Boxing Day', caObserved);
        return holidays;
    }

    function getFrenchHolidays(year) {
        const holidays = {};
        addHoliday(holidays, dateOf(year, 1, 1), "New Year's Day");
        addHoliday(holidays, addDays(easterSunday(year), 1), 'Easter Monday');
        addHoliday(holidays, dateOf(year, 5, 1), 'Labor Day');
        addHoliday(holidays, dateOf(year, 5, 8), 'Victory in Europe Day');
        addHoliday(holidays, addDays(easterSunday(year), 39), 'Ascension Day');
        addHoliday(holidays, addDays(easterSunday(year), 50), 'Whit Monday');
        addHoliday(holidays, dateOf(year, 7, 14), 'Bastille Day');
        addHoliday(holidays, dateOf(year, 8, 15), 'Assumption of Mary');
        addHoliday(holidays, dateOf(year, 11, 1), "All Saints' Day");
        addHoliday(holidays, dateOf(year, 11, 11), 'Armistice Day');
        addHoliday(holidays, dateOf(year, 12, 25), 'Christmas Day');
        return holidays;
    }

    function getGermanHolidays(year) {
        const holidays = {};
        addHoliday(holidays, dateOf(year, 1, 1), "New Year's Day");
        addHoliday(holidays, addDays(easterSunday(year), -2), 'Good Friday');
        addHoliday(holidays, addDays(easterSunday(year), 1), 'Easter Monday');
        addHoliday(holidays, dateOf(year, 5, 1), 'Labor Day');
        addHoliday(holidays, addDays(easterSunday(year), 39), 'Ascension Day');
        addHoliday(holidays, addDays(easterSunday(year), 50), 'Whit Monday');
        addHoliday(holidays, dateOf(year, 10, 3), 'German Unity Day');
        addHoliday(holidays, dateOf(year, 12, 25), 'Christmas Day');
        addHoliday(holidays, dateOf(year, 12, 26), 'Boxing Day');
        return holidays;
    }

    function getIndianHolidays(year) {
        const holidays = {};
        addHoliday(holidays, dateOf(year, 1, 26), 'Republic Day');
        addHoliday(holidays, addDays(easterSunday(year), -2), 'Good Friday');
        addHoliday(holidays, dateOf(year, 8, 15), 'Independence Day');
        addHoliday(holidays, dateOf(year, 10, 2), "Gandhi's Birthday");
        addHoliday(holidays, dateOf(year, 12, 25), 'Christmas Day');
        return holidays;
    }

    function getJapaneseHolidays(year) {
        const holidays = {};
        addHoliday(holidays, dateOf(year, 1, 1), "New Year's Day");
        addHoliday(holidays, nthWeekday(year, 1, 1, 2), 'Coming of Age Day');
        addHoliday(holidays, dateOf(year, 2, 11), 'National Foundation Day');
        addHoliday(holidays, dateOf(year, 2, 23), "Emperor's Birthday");
        addHoliday(holidays, dateOf(year, 4, 29), 'Showa Day');
        addHoliday(holidays, dateOf(year, 5, 3), 'Constitution Memorial Day');
        addHoliday(holidays, dateOf(year, 5, 4), 'Greenery Day');
        addHoliday(holidays, dateOf(year, 5, 5), "Children's Day");
        addHoliday(holidays, nthWeekday(year, 7, 1, 3), 'Marine Day');
        addHoliday(holidays, nthWeekday(year, 8, 1, 2), 'Mountain Day');
        addHoliday(holidays, nthWeekday(year, 9, 1, 3), 'Respect for the Aged Day');
        addHoliday(holidays, nthWeekday(year, 10, 1, 2), 'Sports Day');
        addHoliday(holidays, dateOf(year, 11, 3), 'Culture Day');
        addHoliday(holidays, dateOf(year, 11, 23), 'Labor Thanksgiving Day');
        return holidays;
    }

    function getHolidays(year, config) {
        if (!Number.isInteger(Number(year))) throw new TypeError('year must be an integer');
        const country = normalizeHolidayCountry(config && config.holiday_country);
        const holidayGenerators = {
            US: getUSHolidays,
            CA: getCanadianHolidays,
            GB: getUnitedKingdomHolidays,
            AU: getAustralianHolidays,
            FR: getFrenchHolidays,
            DE: getGermanHolidays,
            IN: getIndianHolidays,
            JP: getJapaneseHolidays
        };
        return holidayGenerators[country](Number(year));
    }

    function holidaySet(startYear, endYear, config) {
        const result = new Set();
        for (let year = startYear; year <= endYear; year += 1) {
            Object.keys(getHolidays(year, config)).forEach(day => result.add(day));
        }
        return result;
    }

    function isBusinessDay(value) {
        const day = typeof value === 'string' ? parseCanonicalDate(value) : value;
        return day.getUTCDay() !== 0 && day.getUTCDay() !== 6;
    }

    function getVacationBusinessDays(startDate, endDate, config) {
        const start = parseCanonicalDate(startDate);
        const end = parseCanonicalDate(endDate);
        if (start > end) throw new RangeError('start_date cannot be after end_date');
        const normalized = normalizedConfig(config);
        const holidays = normalized.pto_holidays_require_pto
            ? new Set() : holidaySet(start.getUTCFullYear(), end.getUTCFullYear(), normalized);
        return dateRange(start, end).filter(day =>
            isBusinessDay(day) && !holidays.has(formatDate(day))).length;
    }

    function countBusinessDays(start, end, holidays) {
        if (start > end) return 0;
        return dateRange(start, end).filter(day =>
            isBusinessDay(day) && !(holidays && holidays.has(formatDate(day)))).length;
    }

    function calculateAccrualToDate(targetDate, config) {
        const normalized = normalizedConfig(config);
        const start = parseCanonicalDate(normalized.accrual_start_date);
        const target = parseCanonicalDate(targetDate);
        if (target < start) return 0;
        if (normalized.pay_periods_per_year <= 0) {
            throw new RangeError('pay_periods_per_year must be greater than zero');
        }
        const payPeriodDays = 365.25 / normalized.pay_periods_per_year;
        if (normalized.accrual_method === 'pro-rata') {
            const holidays = holidaySet(start.getUTCFullYear(), target.getUTCFullYear(), normalized);
            const businessDays = countBusinessDays(start, target, holidays);
            return businessDays
                * (normalized.pto_accrual_per_pay_period / (payPeriodDays * 5 / 7))
                * vestingMultiplier(target, normalized);
        }
        return (daysBetween(start, target) / payPeriodDays)
            * normalized.pto_accrual_per_pay_period * vestingMultiplier(target, normalized);
    }

    function overlappingVacations(startDate, endDate, vacations, excludeId) {
        parseCanonicalDate(startDate);
        parseCanonicalDate(endDate);
        return (vacations || [])
            .filter(item => item && item.start_date <= endDate && item.end_date >= startDate
                && (excludeId == null || item.id !== excludeId))
            .sort((a, b) => a.start_date.localeCompare(b.start_date) || Number(a.id) - Number(b.id));
    }

    function detectVacationConflicts(startDate, endDate, vacations, excludeId) {
        const details = overlappingVacations(startDate, endDate, vacations, excludeId).map(item => ({
            id: item.id,
            name: item.name,
            start_date: item.start_date,
            end_date: item.end_date,
            days: item.days,
            hours: item.hours
        }));
        return {
            has_conflicts: details.length > 0,
            conflicts: details,
            error: details.length
                ? `Vacation dates overlap existing vacation(s): ${details.map(item =>
                    `${item.name} (${item.start_date} to ${item.end_date})`).join(', ')}`
                : null
        };
    }

    function calculateVacationUsageInRange(rangeStart, rangeEnd, config, vacations, excludeId) {
        const start = typeof rangeStart === 'string' ? parseCanonicalDate(rangeStart) : rangeStart;
        const end = typeof rangeEnd === 'string' ? parseCanonicalDate(rangeEnd) : rangeEnd;
        const normalized = normalizedConfig(config);
        const rows = overlappingVacations(formatDate(start), formatDate(end), vacations, excludeId);
        const claimed = new Set();
        let totalDays = 0;
        let totalHours = 0;
        for (const row of rows) {
            const vacationStart = parseCanonicalDate(row.start_date);
            const vacationEnd = parseCanonicalDate(row.end_date);
            const effectiveStart = vacationStart > start ? vacationStart : start;
            const effectiveEnd = vacationEnd < end ? vacationEnd : end;
            const rowDates = dateRange(effectiveStart, effectiveEnd);
            const uniqueDates = rowDates.filter(day => !claimed.has(formatDate(day)));
            const uniqueStart = vacationStart >= start && vacationStart <= end
                && !claimed.has(row.start_date);
            rowDates.forEach(day => claimed.add(formatDate(day)));
            const totalBusinessDays = getVacationBusinessDays(row.start_date, row.end_date, normalized);
            const uniqueBusinessDays = uniqueDates.filter(day => {
                if (!isBusinessDay(day)) return false;
                return normalized.pto_holidays_require_pto
                    || !Object.prototype.hasOwnProperty.call(
                        getHolidays(day.getUTCFullYear(), normalized), formatDate(day));
            }).length;
            if (totalBusinessDays > 0) {
                totalDays += numberValue(row.days, totalBusinessDays)
                    * (uniqueBusinessDays / totalBusinessDays);
            } else if (uniqueStart) {
                totalDays += numberValue(row.days, 0);
            }
            if (uniqueStart) totalHours += numberValue(row.hours, 0);
        }
        return { days: totalDays, hours: totalHours };
    }

    function getVacationTypeBreakdown(year, config, vacations) {
        if (!Number.isInteger(Number(year))) throw new TypeError('year must be an integer');
        const normalized = normalizedConfig(config);
        const ptoStart = parseCanonicalDate(ptoYearStart(Number(year), normalized));
        const ptoEnd = parseCanonicalDate(ptoYearEnd(Number(year), normalized));
        const baselineStart = normalized.forecast_baseline_enabled
            ? normalized.forecast_baseline_date : formatDate(ptoStart);
        const start = parseCanonicalDate(baselineStart) > ptoStart
            ? baselineStart : formatDate(ptoStart);
        const end = formatDate(ptoEnd);
        const unit = normalized.pto_accrual_type === 'hours' ? 'hours' : 'days';
        return Object.values(LEAVE_TYPES).map(type => {
            const records = (vacations || []).filter(item =>
                normalizeLeaveType(item?.type ?? item?.leave_type) === type.key
            );
            const usage = calculateVacationUsageInRange(start, end, normalized, records);
            const amount = bookingAmount(usage.days, usage.hours, normalized);
            return {
                ...type,
                records: records.length,
                days: round2(usage.days),
                hours: round2(usage.hours),
                amount: round2(amount),
                unit
            };
        });
    }

    // Canonical "available balance" definition: the balance is clamped at 0 for
    // each PTO year (Math.max below), so the dashboard and forecasts never show
    // a negative balance. Callers that need the raw, unclamped available amount
    // (e.g. analyzeVacation's negative-balance warning) must compute
    // `accrued - used` themselves and clamp any returned "balance" to >= 0 so it
    // stays consistent with this function.
    function calculateBalanceOnDate(targetDate, config, vacations) {
        const normalized = normalizedConfig(config);
        const target = parseCanonicalDate(targetDate);
        const accrualStart = parseCanonicalDate(normalized.accrual_start_date);
        const baselineEnabled = normalized.forecast_baseline_enabled;
        const baselineDate = parseCanonicalDate(normalized.forecast_baseline_date);
        const isHours = normalized.pto_accrual_type === 'hours';
        const limit = normalized.pto_carryover_limit;
        const empty = {
            accrued: 0, used: 0, used_days: 0, used_hours: 0,
            balance: 0, limit: round2(limit), carry: 0
        };
        if (baselineEnabled && target < baselineDate) return empty;
        if (target < accrualStart) return empty;
        let carry = 0;
        const firstYear = getPtoYearForDate(
            baselineEnabled ? baselineDate : accrualStart, normalized);
        const targetYear = getPtoYearForDate(target, normalized);
        for (let year = firstYear; year <= targetYear; year += 1) {
            const periodStart = parseCanonicalDate(ptoYearStart(year, normalized));
            const periodEnd = parseCanonicalDate(ptoYearEnd(year, normalized));
            const policyStart = accrualStart > periodStart ? accrualStart : periodStart;
            const windowStart = baselineEnabled && baselineDate > policyStart
                ? baselineDate : policyStart;
            const windowEnd = target < periodEnd ? target : periodEnd;
            const yearAccrual = windowStart <= windowEnd
                ? calculateAccrualToDate(formatDate(windowEnd), normalized)
                    - calculateAccrualToDate(formatDate(addDays(windowStart, -1)), normalized)
                : 0;
            const usage = windowStart <= windowEnd
                ? calculateVacationUsageInRange(windowStart, windowEnd, normalized, vacations || [])
                : { days: 0, hours: 0 };
            const used = isHours
                ? usage.days * normalized.pto_hours_per_day + usage.hours
                : usage.days + usage.hours / normalized.pto_hours_per_day;
            const opening = baselineEnabled && year === firstYear
                ? normalized.forecast_baseline_balance : carry;
            const balance = Math.max(0, opening + yearAccrual - used);
            if (year === targetYear) {
                return {
                    accrued: round2(opening + yearAccrual),
                    used: round2(used),
                    used_days: round2(usage.days),
                    used_hours: round2(usage.hours),
                    balance: round2(balance),
                    limit: round2(limit),
                    carry: round2(carry)
                };
            }
            carry = balance;
            if (!normalized.pto_uses_rollover) carry = 0;
            else if (normalized.pto_lose_above_limit) carry = Math.min(carry, limit);
        }
        return empty;
    }

    function generateYearlyForecast(year, config, vacations) {
        const normalized = normalizedConfig(config);
        const yearStart = parseCanonicalDate(ptoYearStart(year, normalized));
        const yearEnd = parseCanonicalDate(ptoYearEnd(year, normalized));
        const monthly = [];
        let cursor = dateOf(yearStart.getUTCFullYear(), yearStart.getUTCMonth() + 1, 1);
        for (;;) {
            const month = cursor.getUTCMonth() + 1;
            const monthYear = cursor.getUTCFullYear();
            const end = dateOf(monthYear, month + 1, 0);
            const forecastEnd = end < yearEnd ? end : yearEnd;
            monthly.push({
                ...calculateBalanceOnDate(formatDate(forecastEnd), normalized, vacations),
                month: `${monthYear}-${String(month).padStart(2, '0')}`,
                month_name: MONTH_NAMES[month - 1]
            });
            if (end >= yearEnd) break;
            cursor = dateOf(monthYear, month + 2, 0);
        }
        return monthly;
    }

    function generateMultiYearForecast(startYear, years, config, vacations) {
        if (!Number.isInteger(years) || years < 1) throw new RangeError('years must be a positive integer');
        const normalized = normalizedConfig(config);
        return Array.from({ length: years }, (_, offset) => {
            const year = startYear + offset;
            const monthly = generateYearlyForecast(year, normalized, vacations);
            const yearStart = parseCanonicalDate(ptoYearStart(year, normalized));
            const yearEnd = parseCanonicalDate(ptoYearEnd(year, normalized));
            const yearEndResult = calculateBalanceOnDate(formatDate(yearEnd), normalized, vacations || []);
            const totalAccrued = normalized.forecast_baseline_enabled
                ? yearEndResult.accrued
                : calculateAccrualToDate(formatDate(yearEnd), normalized)
                    - calculateAccrualToDate(formatDate(addDays(yearStart, -1)), normalized);
            const usage = calculateVacationUsageInRange(yearStart, yearEnd, normalized, vacations || []);
            const totalUsed = normalized.forecast_baseline_enabled
                ? yearEndResult.used
                : normalized.pto_accrual_type === 'hours'
                    ? usage.days * normalized.pto_hours_per_day + usage.hours
                    : usage.days + usage.hours / normalized.pto_hours_per_day;
            const finalMonth = monthly[monthly.length - 1];
            const yearEndBalance = finalMonth.balance;
            const limit = finalMonth.limit;
            let carryover = yearEndBalance;
            let forfeited = 0;
            if (!normalized.pto_uses_rollover) {
                carryover = 0;
                forfeited = yearEndBalance;
            } else if (normalized.pto_lose_above_limit) {
                carryover = Math.min(yearEndBalance, limit);
                forfeited = Math.max(0, yearEndBalance - limit);
            }
            return {
                year,
                monthly_balances: monthly.map((entry, index) => ({
                    month: entry.month,
                    month_number: index + 1,
                    month_name: entry.month_name,
                    balance: entry.balance
                })),
                year_end_balance: yearEndBalance,
                carryover: round2(carryover),
                forfeited: round2(forfeited),
                total_accrued: round2(totalAccrued),
                total_used: round2(totalUsed),
                limit
            };
        });
    }

    function bookingAmount(days, hours, config) {
        const normalized = normalizedConfig(config);
        const totalHours = (Number(days) * normalized.pto_hours_per_day) + Number(hours);
        return normalized.pto_accrual_type === 'hours'
            ? totalHours : totalHours / normalized.pto_hours_per_day;
    }

    function forfeitAmount(balance, config) {
        const normalized = normalizedConfig(config);
        // The carryover limit is already expressed in the configured accrual unit.
        const limit = normalized.pto_carryover_limit;
        if (!normalized.pto_uses_rollover) return Math.max(0, balance);
        if (normalized.pto_lose_above_limit) return Math.max(0, balance - limit);
        return 0;
    }

    function findShiftSavings(startDate, endDate, config) {
        const start = parseCanonicalDate(startDate);
        const end = parseCanonicalDate(endDate);
        const original = getVacationBusinessDays(startDate, endDate, config);
        if (original <= 0) return [];
        const hints = [];
        for (const offset of [-2, -1, 1, 2]) {
            const shiftedStart = addDays(start, offset);
            const shiftedEnd = addDays(end, offset);
            const cost = getVacationBusinessDays(
                formatDate(shiftedStart), formatDate(shiftedEnd), config);
            const savings = original - cost;
            if (savings > 0 && cost > 0) {
                const display = day => new Intl.DateTimeFormat('en-US', {
                    month: 'short', day: 'numeric', timeZone: 'UTC'
                }).format(day);
                hints.push({
                    type: 'shift_suggestion',
                    message: `Shift to ${display(shiftedStart)}-${display(shiftedEnd)} to save `
                        + `${savings} PTO day${savings === 1 ? '' : 's'}.`,
                    savings,
                    start_date: formatDate(shiftedStart),
                    end_date: formatDate(shiftedEnd)
                });
            }
        }
        return hints.slice(0, 2);
    }

    function analyzeVacation(startDate, endDate, days, hours, config, vacations, vacationId) {
        const start = parseCanonicalDate(startDate);
        const end = parseCanonicalDate(endDate);
        if (start > end) throw new RangeError('start_date cannot be after end_date');
        const normalized = normalizedConfig(config);
        const booking = normalizeBooking(days, hours, normalized);
        const requestedDays = booking.days;
        const requestedHours = booking.hours;
        const overlaps = overlappingVacations(startDate, endDate, vacations, vacationId);
        const withoutEdited = (vacations || []).filter(item => item.id !== vacationId);
        const projected = calculateBalanceOnDate(endDate, normalized, withoutEdited);
        const requested = bookingAmount(requestedDays, requestedHours, normalized);
        // Raw (unclamped) available amount keeps the negative signal for the
        // warning; balance_after follows the canonical clamped definition so
        // it matches what the dashboard shows after the booking.
        const rawAfter = projected.accrued - projected.used - requested;
        const balanceAfter = Math.max(0, rawAfter);
        const yearEnd = ptoYearEnd(getPtoYearForDate(end, normalized), normalized);
        const endBalance = calculateBalanceOnDate(yearEnd, normalized, withoutEdited);
        const baselineForfeit = forfeitAmount(Math.max(0, endBalance.accrued - endBalance.used), normalized);
        const proposedForfeit = forfeitAmount(
            Math.max(0, endBalance.accrued - endBalance.used - requested), normalized);
        const unit = normalized.pto_accrual_type === 'hours' ? 'hours' : 'days';
        const warnings = [];
        if (overlaps.length) {
            warnings.push({
                type: 'overlap',
                message: `This range overlaps ${overlaps.slice(0, 2).map(item => item.name).join(', ')}.`,
                severity: 'warning'
            });
        }
        if (rawAfter < -1e-9) {
            warnings.push({
                type: 'negative_balance',
                message: `Balance will be ${rawAfter.toFixed(2)} ${unit} after this vacation.`,
                severity: 'error'
            });
        }
        if (proposedForfeit > baselineForfeit + 1e-9) {
            warnings.push({
                type: 'forfeit_increase',
                message: `This increases year-end forfeiture risk by `
                    + `${(proposedForfeit - baselineForfeit).toFixed(2)} ${unit}.`,
                severity: 'warning'
            });
        } else if (proposedForfeit > 0) {
            warnings.push({
                type: 'policy_limit',
                message: `${proposedForfeit.toFixed(2)} ${unit} may exceed your year-end policy limit.`,
                severity: 'warning'
            });
        }
        return {
            warnings,
            hints: findShiftSavings(startDate, endDate, normalized),
            balance_after: round2(balanceAfter),
            pto_days_charged: round2(requestedDays),
            pto_hours_charged: round2(requestedHours),
            unit
        };
    }

    function continuousDaysOffInterval(ptoDates, holidays, minDate, maxDate, requiresPto) {
        if (!ptoDates.size) return null;
        const sorted = [...ptoDates].sort();
        let start = parseCanonicalDate(sorted[0]);
        let end = parseCanonicalDate(sorted[sorted.length - 1]);
        const lower = minDate || dateOf(start.getUTCFullYear(), 1, 1);
        const upper = maxDate || dateOf(end.getUTCFullYear(), 12, 31);
        // When holidays require PTO, an uncovered holiday is a working day,
        // so the stretch stops there; only weekends and the candidate's own
        // dates (which include any covered holidays) continue it.
        const isOff = day => !isBusinessDay(day) || ptoDates.has(formatDate(day))
            || (!requiresPto && holidays.has(formatDate(day)));
        while (addDays(start, -1) >= lower && isOff(addDays(start, -1))) start = addDays(start, -1);
        while (addDays(end, 1) <= upper && isOff(addDays(end, 1))) end = addDays(end, 1);
        return [start, end];
    }

    function continuousDaysOffCount(ptoDates, holidays, minDate, maxDate, requiresPto) {
        const interval = continuousDaysOffInterval(
            ptoDates, holidays, minDate, maxDate, requiresPto);
        return interval ? daysBetween(interval[0], interval[1]) + 1 : 0;
    }

    function combinations(values, size, start, selected, output) {
        if (selected.length === size) {
            output.push(selected.slice());
            return output;
        }
        for (let index = start; index <= values.length - (size - selected.length); index += 1) {
            selected.push(values[index]);
            combinations(values, size, index + 1, selected, output);
            selected.pop();
        }
        return output;
    }

    function isoWeek(date) {
        const target = new Date(date);
        target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
        const yearStart = dateOf(target.getUTCFullYear(), 1, 1);
        return Math.ceil((((target - yearStart) / DAY_MS) + 1) / 7);
    }

    function calculateWeekImpact(weekStart, weekEnd, holidayMap, booked, requiresPto,
                                 windowStart, windowEnd) {
        const holidays = new Set(Object.keys(holidayMap));
        const candidates = dateRange(weekStart, weekEnd).filter(day =>
            day >= windowStart && day <= windowEnd && isBusinessDay(day)
            && !booked.has(formatDate(day))
            && (requiresPto || !holidays.has(formatDate(day))));
        const best = {};
        for (let needed = 1; needed <= Math.min(3, candidates.length); needed += 1) {
            let result = { score: 0, total_days_off: 0, pto_dates: [] };
            for (const selected of combinations(candidates, needed, 0, [], [])) {
                const selectedSet = new Set(selected.map(formatDate));
                const total = continuousDaysOffCount(
                    selectedSet, holidays, windowStart, windowEnd,
                    requiresPto);
                const score = total / needed;
                if (score > result.score) {
                    result = {
                        score: round2(score),
                        total_days_off: total,
                        pto_dates: selected.map(formatDate)
                    };
                }
            }
            best[needed] = result;
        }
        const primary = best[1] || { score: 0, total_days_off: 0, pto_dates: [] };
        return {
            score: primary.score,
            pto_days_needed: candidates.length ? 1 : 0,
            total_days_off: primary.total_days_off,
            best_pto_dates: primary.pto_dates,
            best_two_day_score: best[2] ? best[2].score : 0,
            best_three_day_score: best[3] ? best[3].score : 0,
            holidays: [...new Set(Object.entries(holidayMap)
                .filter(([day]) => day >= formatDate(weekStart) && day <= formatDate(weekEnd))
                .map(([, name]) => name))].sort(),
            already_booked: dateRange(weekStart, weekEnd).some(day => booked.has(formatDate(day)))
        };
    }

    function generateHeatmap(year, config, vacations) {
        const normalized = normalizedConfig(config);
        const yearStart = parseCanonicalDate(ptoYearStart(year, normalized));
        const yearEnd = parseCanonicalDate(ptoYearEnd(year, normalized));
        const firstWeek = addDays(yearStart, -((yearStart.getUTCDay() + 6) % 7));
        const lastWeek = addDays(yearEnd, 6 - ((yearEnd.getUTCDay() + 6) % 7));
        const holidayMap = {};
        for (const holidayYear of [year - 1, year, year + 1]) {
            Object.assign(holidayMap, getHolidays(holidayYear, normalized));
        }
        const booked = new Set();
        for (const row of overlappingVacations(formatDate(yearStart), formatDate(yearEnd), vacations)) {
            const start = parseCanonicalDate(row.start_date) > yearStart
                ? parseCanonicalDate(row.start_date) : yearStart;
            const end = parseCanonicalDate(row.end_date) < yearEnd
                ? parseCanonicalDate(row.end_date) : yearEnd;
            dateRange(start, end).forEach(day => booked.add(formatDate(day)));
        }
        const weeks = [];
        for (let current = firstWeek; current <= lastWeek; current = addDays(current, 7)) {
            const weekEnd = addDays(current, 6);
            weeks.push({
                week_number: isoWeek(current),
                start_date: formatDate(current),
                end_date: formatDate(weekEnd),
                ...calculateWeekImpact(current, weekEnd, holidayMap, booked,
                    normalized.pto_holidays_require_pto, yearStart, yearEnd)
            });
        }
        const scores = weeks.map(week => week.score);
        return {
            year,
            weeks,
            max_score: scores.length ? Math.max(...scores) : 0,
            min_score: scores.length ? Math.min(...scores) : 0
        };
    }

    function suggestionMetrics(start, end, holidays, requiresPto, windowStart, windowEnd) {
        const allDates = dateRange(start, end);
        const ptoDates = allDates.filter(day => isBusinessDay(day)
            && (requiresPto || !holidays.has(formatDate(day)))).map(formatDate);
        const interval = continuousDaysOffInterval(
            new Set(allDates.map(formatDate)), holidays,
            windowStart, windowEnd,
            requiresPto);
        const expanded = interval ? dateRange(interval[0], interval[1]) : allDates;
        const ptoSet = new Set(ptoDates);
        return {
            all_dates: expanded,
            pto_dates: ptoDates,
            pto_days: ptoDates.length,
            holiday_dates: expanded.filter(day => holidays.has(formatDate(day))),
            weekend_days: expanded.filter(day => !isBusinessDay(day) && !holidays.has(formatDate(day))),
            non_pto_weekday_days: expanded.filter(day => isBusinessDay(day)
                && !ptoSet.has(formatDate(day)) && !holidays.has(formatDate(day))),
            weekday_pto_days: expanded.filter(day =>
                ptoSet.has(formatDate(day)) && !holidays.has(formatDate(day))),
            total_days_off: expanded.length
        };
    }

    function suggestionExplanation(metrics, holidayMap, requiresPto, config, alternatives) {
        const normalized = normalizedConfig(config);
        const ptoDays = metrics.pto_days;
        const total = metrics.total_days_off;
        const holidayNames = metrics.holiday_dates
            .map(day => holidayMap[formatDate(day)]).filter(Boolean);
        const unit = normalized.pto_accrual_type === 'hours' ? 'hours' : 'days';
        return {
            breakdown: {
                weekday_pto_days: metrics.weekday_pto_days.length,
                weekend_days: metrics.weekend_days.length,
                holiday_days: metrics.holiday_dates.length,
                non_pto_weekday_days: metrics.non_pto_weekday_days.length,
                free_days_total: total
            },
            holidays_avoided: { count: holidayNames.length, names: holidayNames },
            balance_impact: {
                amount: round2(unit === 'hours' ? ptoDays * normalized.pto_hours_per_day : ptoDays),
                unit,
                days_equivalent: ptoDays
            },
            policy_assumptions: {
                holidays_require_pto: requiresPto,
                accrual_type: normalized.pto_accrual_type,
                hours_per_day: round2(normalized.pto_hours_per_day)
            },
            score_formula: `total_days_off (${total}) / pto_days (${ptoDays}) = `
                + `${(ptoDays ? total / ptoDays : 0).toFixed(2)}`,
            alternatives: alternatives || []
        };
    }

    function generateVacationSuggestions(year, config, vacations, options) {
        if (!Number.isInteger(year) || year < 1) throw new RangeError('year must be a positive integer');
        const normalized = normalizedConfig(config);
        const today = parseCanonicalDate(
            options && options.today ? options.today : getLocalToday(normalized));
        const yearStart = parseCanonicalDate(ptoYearStart(year, normalized));
        const yearEnd = parseCanonicalDate(ptoYearEnd(year, normalized));
        const earliest = today > yearStart ? today : yearStart;
        const isHours = normalized.pto_accrual_type === 'hours';
        const endBalance = calculateBalanceOnDate(formatDate(yearEnd), normalized, vacations);
        const remainingAmount = Math.max(0, endBalance.accrued - endBalance.used);
        const remainingDays = isHours
            ? remainingAmount / normalized.pto_hours_per_day : remainingAmount;
        // The carryover limit is already expressed in the configured accrual unit.
        const carryLimit = normalized.pto_carryover_limit;
        const forfeit = !normalized.pto_uses_rollover ? remainingAmount
            : normalized.pto_lose_above_limit ? Math.max(0, remainingAmount - carryLimit) : 0;
        const forfeitDays = isHours ? forfeit / normalized.pto_hours_per_day : forfeit;
        const targetDays = forfeitDays > 0 ? forfeitDays : Math.min(remainingDays, 10);
        const budgetDays = Math.max(0, Math.floor(targetDays + 1e-9));
        const reserved = new Set();
        for (const row of overlappingVacations(formatDate(yearStart), formatDate(yearEnd), vacations)) {
            const start = parseCanonicalDate(row.start_date) > yearStart
                ? parseCanonicalDate(row.start_date) : yearStart;
            const end = parseCanonicalDate(row.end_date) < yearEnd
                ? parseCanonicalDate(row.end_date) : yearEnd;
            dateRange(start, end).forEach(day => reserved.add(formatDate(day)));
        }
        // The PTO-year window can span two calendar years, so fetch a
        // one-year margin on each side (mirrors generateHeatmap); out-of-window
        // holidays are filtered by validPtoDay and the earliest/yearEnd clamps.
        const holidayMap = {};
        for (const holidayYear of [year - 1, year, year + 1]) {
            Object.assign(holidayMap, getHolidays(holidayYear, normalized));
        }
        const holidays = new Set(Object.keys(holidayMap));
        const candidates = [];
        const seen = new Set();
        const validPtoDay = day => day >= earliest && day <= yearEnd
            && isBusinessDay(day)
            && (normalized.pto_holidays_require_pto || !holidays.has(formatDate(day)))
            && !reserved.has(formatDate(day));
        const addCandidate = (start, end, name, reason, category, holiday) => {
            if (start > end || start < earliest) return;
            if (dateRange(start, end).some(day =>
                (!holiday || formatDate(day) !== formatDate(holiday)) && !validPtoDay(day))) return;
            if (holiday && holiday >= earliest && holiday <= yearEnd
                    && !reserved.has(formatDate(holiday))) {
                if (holiday < start) start = holiday;
                if (holiday > end) end = holiday;
            }
            const key = `${formatDate(start)}:${formatDate(end)}`;
            if (seen.has(key)) return;
            seen.add(key);
            const metrics = suggestionMetrics(
                start, end, holidays, normalized.pto_holidays_require_pto,
                yearStart, yearEnd);
            if (!metrics.pto_days) return;
            candidates.push({
                name,
                start_date: formatDate(start),
                end_date: formatDate(end),
                holiday_date: holiday ? formatDate(holiday) : null,
                pto_dates: metrics.pto_dates,
                pto_days: metrics.pto_days,
                total_days_off: metrics.total_days_off,
                impact_score: round2(metrics.total_days_off / metrics.pto_days),
                category,
                reason,
                tags: [category.replace('-', ' ')],
                _metrics: metrics
            });
        };
        for (const [holidayDate, holidayName] of Object.entries(holidayMap).sort()) {
            const holiday = parseCanonicalDate(holidayDate);
            switch (holiday.getUTCDay()) {
            case 1:
                addCandidate(addDays(holiday, -3), addDays(holiday, -3),
                    `Extend ${holidayName}`, `Take Friday off to turn ${holidayName} into a 4-day break.`,
                    'holiday-bridge', holiday);
                break;
            case 2:
                addCandidate(addDays(holiday, -1), addDays(holiday, -1),
                    `Bridge into ${holidayName}`, `Take Monday off before ${holidayName} for a longer break.`,
                    'holiday-bridge', holiday);
                break;
            case 3:
                addCandidate(addDays(holiday, 1), addDays(holiday, 2),
                    `Long break after ${holidayName}`, `Take Thu/Fri after ${holidayName} for a 5-day stretch.`,
                    'holiday-bridge', holiday);
                break;
            case 4:
                addCandidate(addDays(holiday, 1), addDays(holiday, 1),
                    `Extend ${holidayName}`, `Take Friday off after ${holidayName} for a 4-day weekend.`,
                    'holiday-bridge', holiday);
                break;
            case 5:
                addCandidate(addDays(holiday, 3), addDays(holiday, 3),
                    `Extend ${holidayName}`, `Take Monday off after ${holidayName} for extra recovery time.`,
                    'holiday-bridge', holiday);
                break;
            default:
                break;
            }
        }
        for (let day = earliest; day <= yearEnd; day = addDays(day, 1)) {
            if (day.getUTCDay() === 1 || day.getUTCDay() === 5) {
                addCandidate(day, day, 'Create a Long Weekend',
                    'Use a single PTO day next to the weekend for a 3-day break.', 'high-impact');
            }
        }
        candidates.sort((a, b) => b.impact_score - a.impact_score
            || b.total_days_off - a.total_days_off);
        const selected = [];
        const selectedDates = new Set(reserved);
        let usedDays = 0;
        const hardCap = Math.max(0, Math.floor(Math.min(Math.max(remainingDays, 0), 15)));
        const maxDays = budgetDays > 0 ? budgetDays : hardCap;
        for (const candidate of candidates) {
            if (selected.length >= 12) break;
            const dates = dateRange(
                parseCanonicalDate(candidate.start_date), parseCanonicalDate(candidate.end_date))
                .map(formatDate);
            if (dates.some(day => selectedDates.has(day))) continue;
            if (usedDays + candidate.pto_days > maxDays) continue;
            selected.push(candidate);
            dates.forEach(day => selectedDates.add(day));
            usedDays += candidate.pto_days;
        }
        const selectedKeys = new Set(selected.map(item => `${item.start_date}:${item.end_date}`));
        selected.forEach((candidate, index) => {
            const start = parseCanonicalDate(candidate.start_date);
            const end = parseCanonicalDate(candidate.end_date);
            const alternatives = [];
            for (const [altStart, altEnd] of [
                [addDays(start, -1), end], [start, addDays(end, -1)], [start, addDays(end, 1)]
            ]) {
                const key = `${formatDate(altStart)}:${formatDate(altEnd)}`;
                if (altStart > altEnd || selectedKeys.has(key) || altStart < earliest) continue;
                const metrics = suggestionMetrics(
                    altStart, altEnd, holidays, normalized.pto_holidays_require_pto,
                    yearStart, yearEnd);
                if (!metrics.pto_days) continue;
                alternatives.push({
                    name: 'Nearby alternative',
                    start_date: formatDate(altStart),
                    end_date: formatDate(altEnd),
                    pto_days: metrics.pto_days,
                    total_days_off: metrics.total_days_off,
                    impact_score: round2(metrics.total_days_off / metrics.pto_days),
                    comparison: `Uses ${Math.abs(candidate.pto_days - metrics.pto_days)} `
                        + `${metrics.pto_days < candidate.pto_days ? 'fewer' : 'more'} PTO day(s) and provides `
                        + `${Math.abs(candidate.total_days_off - metrics.total_days_off)} `
                        + `${metrics.total_days_off < candidate.total_days_off ? 'fewer' : 'more'} day(s) off.`
                });
                if (alternatives.length === 2) break;
            }
            const explanation = suggestionExplanation(
                candidate._metrics, holidayMap, normalized.pto_holidays_require_pto,
                normalized, alternatives);
            explanation.constraints = [
                'Starts on or after today',
                'Avoids overlapping planned vacations',
                `Fits within the ${maxDays} PTO-day suggestion budget`
            ];
            explanation.ranking_factors = {
                rank: index + 1,
                impact_score: candidate.impact_score,
                days_off_per_pto_day: candidate.impact_score,
                holiday_alignment: candidate.category === 'holiday-bridge'
            };
            candidate.explanation = explanation;
            delete candidate._metrics;
        });
        let message;
        if (remainingDays < 1) {
            // Every candidate costs at least one whole PTO day, so a
            // sub-day balance can never afford any suggestion.
            message = remainingDays > 0
                ? 'Less than one PTO day remains this PTO year, so no whole-day suggestion fits within the remaining balance.'
                : 'No PTO balance remains this PTO year, so no suggestions can be offered.';
            if (forfeitDays > 0) {
                message += ' The leftover balance will be forfeited at year end.';
            }
        } else if (forfeitDays > 0) {
            message = 'You are on track to forfeit PTO unless you schedule additional time off.';
        } else {
            message = 'You still have PTO available; these options maximize time off per PTO day.';
        }
        const allSuggestions = selected;
        const filters = options || {};
        const categories = Array.isArray(filters.categories) ? filters.categories : [];
        const filtered = allSuggestions.filter(item =>
            (filters.min_pto_days == null || item.pto_days >= Number(filters.min_pto_days))
            && (filters.max_pto_days == null || item.pto_days <= Number(filters.max_pto_days))
            && (filters.min_impact == null || item.impact_score >= Number(filters.min_impact))
            && (filters.month_start == null || Number(item.start_date.slice(5, 7)) >= Number(filters.month_start))
            && (filters.month_end == null || Number(item.start_date.slice(5, 7)) <= Number(filters.month_end))
            && (!categories.length || categories.includes(item.category)));
        const sortBy = ['impact', 'date', 'pto_days'].includes(filters.sort_by)
            ? filters.sort_by : 'impact';
        if (sortBy === 'date') {
            filtered.sort((a, b) => a.start_date.localeCompare(b.start_date));
        } else if (sortBy === 'pto_days') {
            filtered.sort((a, b) => b.pto_days - a.pto_days);
        } else {
            filtered.sort((a, b) => b.impact_score - a.impact_score
                || b.total_days_off - a.total_days_off);
        }
        return {
            year,
            unit: isHours ? 'hours' : 'days',
            hours_per_day: round2(normalized.pto_hours_per_day),
            remaining_balance: round2(remainingAmount),
            remaining_balance_days_equivalent: round2(remainingDays),
            forfeit_risk: round2(forfeit),
            forfeit_risk_days_equivalent: round2(forfeitDays),
            target_to_plan_days: round2(targetDays),
            suggested_pto_amount: round2(isHours
                ? usedDays * normalized.pto_hours_per_day : usedDays),
            suggested_pto_days: usedDays,
            summary: {
                message,
                recommendation: 'Add one or more suggestions to your plan to avoid unused PTO at year end.'
            },
            suggestions: filtered,
            total_unfiltered: allSuggestions.length,
            total_filtered: filtered.length,
            available_categories: [...new Set(allSuggestions.map(item => item.category))].sort(),
            filters_applied: {
                min_pto_days: filters.min_pto_days == null ? null : Number(filters.min_pto_days),
                max_pto_days: filters.max_pto_days == null ? null : Number(filters.max_pto_days),
                min_impact: filters.min_impact == null ? null : Number(filters.min_impact),
                month_start: filters.month_start == null ? null : Number(filters.month_start),
                month_end: filters.month_end == null ? null : Number(filters.month_end),
                categories,
                sort_by: sortBy
            }
        };
    }

    return Object.freeze({
        DEFAULT_TIMEZONE,
        DEFAULT_HOLIDAY_COUNTRY,
        LEAVE_TYPES,
        isCanonicalDate,
        parseCanonicalDate,
        getConfiguredTimezone,
        getLocalToday,
        getLocalYear,
        normalizePtoYearBoundaries,
        validatePtoYearBoundaries,
        getPtoYearForDate,
        getPtoYearStart: ptoYearStart,
        getPtoYearEnd: ptoYearEnd,
        vestingMultiplier,
        normalizeHolidayCountry,
        normalizeLeaveType,
        leaveType,
        isValidTimezone,
        getUSHolidays,
        getCanadianHolidays,
        getHolidays,
        isBusinessDay,
        getVacationBusinessDays,
        getVacationDays: getVacationBusinessDays,
        calculateAccrualToDate,
        normalizeBooking,
        bookingAmount,
        calculateVacationUsageInRange,
        getVacationTypeBreakdown,
        calculateBalanceOnDate,
        generateYearlyForecast,
        generateMultiYearForecast,
        detectVacationConflicts,
        analyzeVacation,
        generateVacationSuggestions,
        generateHeatmap
    });
}));
