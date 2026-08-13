const currentUtcYear = new Date().getUTCFullYear();

export const DEFAULT_CONFIG = Object.freeze({
    holiday_country: 'US',
    pto_accrual_per_pay_period: 1,
    pto_accrual_type: 'days',
    pto_hours_per_day: 8,
    pto_holidays_require_pto: true,
    pay_periods_per_year: 26,
    accrual_start_date: `${currentUtcYear}-01-01`,
    accrual_method: 'pro-rata',
    pto_carryover_limit: 40,
    pto_uses_rollover: true,
    pto_cashout_rate: 0,
    pto_lose_above_limit: true,
    pto_start_year: currentUtcYear,
    pto_vesting_schedule: 'immediate',
    pto_grace_period_days: 0,
    timezone: 'UTC',
    forecast_baseline_enabled: false,
    forecast_baseline_date: `${currentUtcYear}-01-01`,
    forecast_baseline_balance: 0,
    pto_year_boundaries: []
});

export const POLICY_PRESETS = Object.freeze({
    standard: {
        name: 'Standard PTO',
        description: 'A balanced US-style policy with prorated accrual and limited rollover.',
        settings: {
            pto_accrual_per_pay_period: 1, pto_accrual_type: 'days', pto_hours_per_day: 8,
            pto_holidays_require_pto: false, pay_periods_per_year: 26,
            accrual_start_date: `${currentUtcYear}-01-01`, accrual_method: 'pro-rata',
            pto_carryover_limit: 40, pto_uses_rollover: true,
            pto_lose_above_limit: true, pto_vesting_schedule: 'immediate'
        }
    },
    generous: {
        name: 'Generous Rollover',
        description: 'Higher accrual with rollover enabled and no automatic cap.',
        settings: {
            pto_accrual_per_pay_period: 1.5, pto_accrual_type: 'days', pto_hours_per_day: 8,
            pto_holidays_require_pto: false, pay_periods_per_year: 26,
            accrual_start_date: `${currentUtcYear}-01-01`, accrual_method: 'pro-rata',
            pto_carryover_limit: 80, pto_uses_rollover: true,
            pto_lose_above_limit: false, pto_vesting_schedule: 'immediate'
        }
    },
    'use-it-or-lose-it': {
        name: 'Use It or Lose It',
        description: 'Accrual resets at year end with no rollover.',
        settings: {
            pto_accrual_per_pay_period: 1, pto_accrual_type: 'days', pto_hours_per_day: 8,
            pto_holidays_require_pto: false, pay_periods_per_year: 26,
            accrual_start_date: `${currentUtcYear}-01-01`, accrual_method: 'pro-rata',
            pto_carryover_limit: 0, pto_uses_rollover: false,
            pto_lose_above_limit: true, pto_vesting_schedule: 'immediate'
        }
    }
});

export const state = {
    config: {},
    vacations: [],
    forecast: [],
    calendarEvents: {},
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    today: null,
    forecastChart: null,
    multiYearChart: null,
    forecastRequestId: 0,
    multiYearRequestId: 0,
    heatmapRequestId: 0,
    editingVacationId: null,
    vacationCalcRequestId: 0,
    vacationSuggestions: null,
    suggestionFilters: JSON.parse(
        localStorage.getItem('pto-suggestion-filters') || '{"categories":[],"sortBy":"impact"}'
    ),
    suggestionAnalysisTimer: null,
    vacationAnalysisRequestId: 0,
    notificationAlerts: [],
    notifications: []
};

export const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function getStoredConfig() {
    const stored = await globalThis.PTOStore.getConfig();
    const config = { ...DEFAULT_CONFIG, ...(stored || {}) };
    if (!stored) await globalThis.PTOStore.putConfig(config);
    return config;
}

export async function getRuntimeConfig() {
    const config = await getStoredConfig();
    return {
        ...config,
        current_date: globalThis.PTO.getLocalToday(config),
        current_year: globalThis.PTO.getLocalYear(config)
    };
}
