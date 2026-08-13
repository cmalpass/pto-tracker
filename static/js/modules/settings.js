export function configWarnings(config) {
    const warnings = [];
    if (Number(config.pto_accrual_per_pay_period) <= 0) {
        warnings.push({ severity: 'error', message: 'Accrual per pay period must be greater than zero.' });
    }
    if (Number(config.pay_periods_per_year) <= 0) {
        warnings.push({ severity: 'error', message: 'Pay periods per year must be greater than zero.' });
    }
    if (Number(config.pto_carryover_limit) < 0) {
        warnings.push({ severity: 'error', message: 'Carryover limit cannot be negative.' });
    }
    if (Number(config.pto_hours_per_day) <= 0) {
        warnings.push({ severity: 'error', message: 'Hours per day must be greater than zero.' });
    }
    if (Math.abs((Number(config.pto_hours_per_day) * 4)
            - Math.round(Number(config.pto_hours_per_day) * 4)) > 1e-9) {
        warnings.push({ severity: 'error', message: 'Hours per day must use 0.25-hour increments.' });
    }
    if (!globalThis.PTO.isValidTimezone(config.timezone)) {
        warnings.push({ severity: 'error', message: 'Timezone must be a valid IANA timezone.' });
    }
    if (!globalThis.PTO.isCanonicalDate(config.accrual_start_date)) {
        warnings.push({ severity: 'error', message: 'Accrual start date must use YYYY-MM-DD format.' });
    }
    return warnings;
}
