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
    if (config.forecast_baseline_enabled) {
        if (!globalThis.PTO.isCanonicalDate(config.forecast_baseline_date)) {
            warnings.push({ severity: 'error', message: 'Available balance date must use YYYY-MM-DD format.' });
        }
        if (Number(config.forecast_baseline_balance) < 0) {
            warnings.push({ severity: 'error', message: 'Available balance cannot be negative.' });
        }
        if (globalThis.PTO.isCanonicalDate(config.forecast_baseline_date)
                && globalThis.PTO.isCanonicalDate(config.accrual_start_date)
                && config.forecast_baseline_date < config.accrual_start_date) {
            warnings.push({ severity: 'error', message: 'Available balance date cannot be before the accrual start date.' });
        }
    }
    const boundaries = Array.isArray(config.pto_year_boundaries)
        ? config.pto_year_boundaries : [];
    const years = new Set();
    const dates = new Set();
    let previousDate = null;
    boundaries.forEach((boundary, index) => {
        const year = Number(boundary?.year);
        const finalDate = boundary?.final_date;
        if (!Number.isInteger(year) || year < 1) {
            warnings.push({ severity: 'error', message: `PTO year boundary ${index + 1} must use a valid year.` });
            return;
        }
        if (!globalThis.PTO.isCanonicalDate(finalDate)) {
            warnings.push({ severity: 'error', message: `PTO year ${year} final day must use YYYY-MM-DD format.` });
            return;
        }
        if (finalDate.slice(0, 4) !== String(year)) {
            warnings.push({ severity: 'error', message: `PTO year ${year} final day must be within ${year}.` });
        }
        if (years.has(year)) {
            warnings.push({ severity: 'error', message: `PTO year ${year} is configured more than once.` });
        }
        if (dates.has(finalDate)) {
            warnings.push({ severity: 'error', message: `PTO boundary date ${finalDate} is configured more than once.` });
        }
        if (previousDate && finalDate <= previousDate) {
            warnings.push({ severity: 'error', message: 'PTO year boundary dates must be unique and chronological.' });
        }
        years.add(year);
        dates.add(finalDate);
        previousDate = finalDate;
    });
    return warnings;
}
