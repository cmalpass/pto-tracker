const DISMISSED_KEY = 'pto-tracker:notifications:dismissed:v1';
const UPCOMING_DAYS = 14;
const DEFAULT_LOW_BALANCE = 5;
const SEVERITY_RANK = Object.freeze({ critical: 0, warning: 1, info: 2 });

function addDays(value, amount) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function amountLabel(value, unit) {
    const number = Number(value);
    const formatted = number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return `${formatted} ${unit}`;
}

function amountValue(record, pto, config) {
    return pto.bookingAmount(Number(record?.days || 0), Number(record?.hours || 0), config);
}

function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
}

function fingerprint(type, values) {
    return `pto-${type}-${hash([type, ...values].join('|'))}`;
}

function normalizedToday(pto, config, today) {
    if (today) return today;
    return pto.getLocalToday(config);
}

function createForfeitureAlert({ pto, config, vacations, today, year, balance, unit }) {
    const available = Math.max(0, balance.accrued - balance.used);
    const limit = Number(config.pto_carryover_limit || 0);
    const forfeited = !config.pto_uses_rollover
        ? available
        : config.pto_lose_above_limit ? Math.max(0, available - limit) : 0;
    if (forfeited <= 1e-9) return null;
    const policy = config.pto_uses_rollover
        ? `The ${amountLabel(limit, unit)} carryover cap is projected to be exceeded`
        : 'Your policy does not carry unused PTO into the next year';
    return {
        type: 'carryover-forfeiture',
        severity: 'critical',
        title: 'Projected PTO forfeiture',
        message: `${amountLabel(forfeited, unit)} may be forfeited on ${year + 1}-01-01. ${policy}.`,
        detail: `Based on ${today} and ${vacations.length} planned leave booking${vacations.length === 1 ? '' : 's'}.`,
        amount: forfeited,
        unit,
        fingerprint: fingerprint('carryover-forfeiture', [
            year, unit, forfeited.toFixed(2), limit.toFixed(2),
            Boolean(config.pto_uses_rollover), Boolean(config.pto_lose_above_limit)
        ]),
        action: { label: 'Plan time off', tab: 'vacations', target: 'suggestions-card' }
    };
}

function createCapAlert({ config, year, balance, unit }) {
    if (!config.pto_uses_rollover || !config.pto_lose_above_limit) return null;
    const available = Math.max(0, balance.accrued - balance.used);
    const limit = Number(config.pto_carryover_limit || 0);
    if (limit <= 0 || available < limit * 0.8) return null;
    const remaining = Math.max(0, limit - available);
    return {
        type: 'carryover-cap',
        severity: 'warning',
        title: 'Carryover cap is approaching',
        message: `Projected year-end balance is ${amountLabel(available, unit)}, leaving only `
            + `${amountLabel(remaining, unit)} below the ${amountLabel(limit, unit)} cap.`,
        amount: available,
        unit,
        fingerprint: fingerprint('carryover-cap', [year, unit, available.toFixed(2), limit.toFixed(2)]),
        action: { label: 'Open forecast', tab: 'forecast', target: 'tab-forecast' }
    };
}

function createUpcomingAlerts({ pto, config, vacations, today, unit }) {
    const lastReminderDate = addDays(today, UPCOMING_DAYS);
    return vacations
        .filter(item => item?.end_date >= today && item.start_date <= lastReminderDate)
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || Number(a.id) - Number(b.id))
        .map(item => {
            const type = pto.leaveType(item.type);
            const amount = amountValue(item, pto, config);
            const timing = item.start_date < today ? 'is underway' : `starts on ${item.start_date}`;
            const dateKey = `${item.start_date}|${item.end_date}`;
            const recordKey = item.id == null
                ? `${item.name || ''}|${dateKey}|${item.type || ''}` : String(item.id);
            return {
                type: 'upcoming-vacation',
                severity: 'info',
                title: 'Upcoming time off',
                message: `${item.name || type.label} ${timing}.`,
                detail: `${type.label} • ${dateKey} • ${amountLabel(amount, unit)}`,
                amount,
                unit,
                fingerprint: fingerprint('upcoming-vacation', [
                    recordKey, item.name || '', dateKey, item.type || 'vacation',
                    Number(item.days || 0).toFixed(2), Number(item.hours || 0).toFixed(2)
                ]),
                action: { label: 'Review vacations', tab: 'vacations', target: 'vacations-card' }
            };
        });
}

function createLowBalanceAlert({ config, today, balance, unit }) {
    const threshold = config.pto_accrual_type === 'hours'
        ? DEFAULT_LOW_BALANCE * Number(config.pto_hours_per_day || 8)
        : DEFAULT_LOW_BALANCE;
    if (balance.accrued <= 1e-9 || balance.balance > threshold + 1e-9) return null;
    return {
        type: 'low-balance',
        severity: 'warning',
        title: 'PTO balance is running low',
        message: `Only ${amountLabel(balance.balance, unit)} remain available as of ${today}.`,
        detail: `This alert appears below ${amountLabel(threshold, unit)}.`,
        amount: balance.balance,
        unit,
        fingerprint: fingerprint('low-balance', [
            today.slice(0, 4), unit, balance.balance.toFixed(2), threshold.toFixed(2)
        ]),
        action: { label: 'Open forecast', tab: 'forecast', target: 'tab-forecast' }
    };
}

export function generateNotifications({ pto, config, vacations = [], today } = {}) {
    if (!pto || !config) throw new TypeError('PTO and config are required');
    const localToday = normalizedToday(pto, config, today);
    if (!pto.isCanonicalDate(localToday)) throw new TypeError('today must use YYYY-MM-DD format');
    const year = pto.getPtoYearForDate(localToday, config);
    const normalizedVacations = Array.isArray(vacations) ? vacations : [];
    const unit = config.pto_accrual_type === 'hours' ? 'hours' : 'days';
    const yearEnd = pto.getPtoYearEnd(year, config);
    const balance = pto.calculateBalanceOnDate(yearEnd, config, normalizedVacations);
    const alerts = [
        createForfeitureAlert({
            pto, config, vacations: normalizedVacations, today: localToday,
            year, balance, unit
        }),
        createCapAlert({ config, year, balance, unit }),
        createLowBalanceAlert({
            config,
            today: localToday,
            balance: pto.calculateBalanceOnDate(localToday, config, normalizedVacations),
            unit
        }),
        ...createUpcomingAlerts({
            pto, config, vacations: normalizedVacations, today: localToday, unit
        })
    ].filter(Boolean);
    return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        || String(a.message).localeCompare(String(b.message)));
}

function storageOrDefault(storage) {
    return storage || globalThis.localStorage;
}

export function getDismissedFingerprints(storage) {
    const source = storageOrDefault(storage);
    if (!source) return new Set();
    const raw = source.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    try {
        const parsed = JSON.parse(raw);
        const entries = Array.isArray(parsed) ? parsed : Object.keys(parsed || {});
        return new Set(entries.map(entry => typeof entry === 'string' ? entry : entry.fingerprint)
            .filter(Boolean));
    } catch (error) {
        console.warn('Ignoring invalid notification dismissal state:', error);
        return new Set();
    }
}

export function dismissNotification(notification, storage) {
    if (!notification?.fingerprint) throw new TypeError('Notification fingerprint is required');
    const source = storageOrDefault(storage);
    if (!source) return false;
    const dismissed = getDismissedFingerprints(source);
    dismissed.add(notification.fingerprint);
    source.setItem(DISMISSED_KEY, JSON.stringify([...dismissed].sort()));
    return true;
}

export function visibleNotifications(alerts, storage) {
    const dismissed = getDismissedFingerprints(storage);
    return (alerts || []).filter(alert => !dismissed.has(alert.fingerprint));
}

export { DISMISSED_KEY };
