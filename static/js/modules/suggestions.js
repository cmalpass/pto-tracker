import { state } from './state.js?v=20260813-19';

export function suggestionOptions() {
    const filters = state.suggestionFilters || {};
    return {
        today: state.today || globalThis.PTO.getLocalToday(state.config),
        min_pto_days: filters.minPto,
        max_pto_days: filters.maxPto,
        min_impact: filters.minImpact,
        month_start: filters.monthStart,
        month_end: filters.monthEnd,
        categories: filters.categories || [],
        sort_by: filters.sortBy || 'impact'
    };
}

export function generateSuggestions() {
    return globalThis.PTO.generateVacationSuggestions(
        state.currentYear,
        state.config,
        state.vacations,
        suggestionOptions()
    );
}
