import { state } from './state.js?v=20260813-18';

export function calendarData(year, month) {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const holidays = Object.entries(globalThis.PTO.getHolidays(year, state.config))
        .filter(([date]) => date.startsWith(monthPrefix))
        .map(([date, name]) => ({ date, name, type: 'holiday' }));
    const vacations = state.vacations
        .filter(item => item.start_date <= `${monthPrefix}-31` && item.end_date >= `${monthPrefix}-01`)
        .map(item => ({
            ...item,
            type: 'vacation',
            leave_type: globalThis.PTO.normalizeLeaveType(item.type)
        }));
    return { events: [...holidays, ...vacations] };
}

export function expandCalendarEvents(events, year, month) {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const expanded = [];
    (Array.isArray(events) ? events : []).forEach(event => {
        if (event.date) {
            expanded.push(event);
            return;
        }
        if (!event.start_date || !event.end_date) return;
        const start = new Date(`${event.start_date}T00:00:00`);
        const end = new Date(`${event.end_date}T00:00:00`);
        const overlapStart = start > monthStart ? start : monthStart;
        const overlapEnd = end < monthEnd ? end : monthEnd;
        for (const day = new Date(overlapStart); day <= overlapEnd; day.setDate(day.getDate() + 1)) {
            expanded.push({ ...event, date: [
                day.getFullYear(),
                String(day.getMonth() + 1).padStart(2, '0'),
                String(day.getDate()).padStart(2, '0')
            ].join('-') });
        }
    });
    return expanded;
}
