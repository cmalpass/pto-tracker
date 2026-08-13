export function yearlyForecast(year, config, vacations) {
    return globalThis.PTO.generateYearlyForecast(year, config, vacations);
}

export function multiYearForecast(startYear, count, config, vacations) {
    return globalThis.PTO.generateMultiYearForecast(startYear, count, config, vacations);
}

export function heatmap(year, config, vacations) {
    return globalThis.PTO.generateHeatmap(year, config, vacations);
}
