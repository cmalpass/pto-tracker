import { DAYS, MONTHS, state } from './state.js?v=20260813-17';
import { clearElement, element, appendText } from './dom.js?v=20260813-17';

let emptyVacationElement;
let emptySuggestionElement;

function addSvgIcon(parent, kind, size = 20) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');
    const paths = kind === 'edit'
        ? [['path', { d: 'M12 20h9' }], ['path', {
            d: 'M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z'
        }]]
        : kind === 'delete'
            ? [['polyline', { points: '3 6 5 6 21 6' }], ['path', {
                d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'
            }]]
            : kind === 'sick'
                ? [['path', { d: 'M9 2v4M15 2v4M4 9h16M6 4h12a2 2 0 0 1 2 2v13H4V6a2 2 0 0 1 2-2z' }],
                    ['path', { d: 'M12 12v4M10 14h4' }]]
                : kind === 'personal'
                    ? [['circle', { cx: '12', cy: '8', r: '3' }],
                        ['path', { d: 'M5 21a7 7 0 0 1 14 0' }]]
                    : kind === 'holiday'
                        ? [['path', { d: 'M4 9h16M6 9v10h12V9M12 9V4' }],
                            ['path', { d: 'M12 4c-2-3-6-1-4 2 1 1 3 1 4 1M12 4c2-3 6-1 4 2-1 1-3 1-4 1' }]]
                        : [['path', {
                            d: 'M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3zm-8.27 4a2.75 2.75 0 0 1-5.46 0'
                        }]];
    paths.forEach(([name, attributes]) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', name);
        Object.entries(attributes).forEach(([key, value]) => path.setAttribute(key, value));
        svg.append(path);
    });
    parent.append(svg);
}

function leaveTypeInfo(type) {
    return globalThis.PTO.leaveType(type);
}

function appendLeaveBadge(parent, type, includeIcon = true) {
    const info = leaveTypeInfo(type);
    const badge = element('span', `leave-type-badge leave-type-${info.key}`);
    badge.title = info.label;
    badge.setAttribute('aria-label', info.label);
    if (includeIcon) addSvgIcon(badge, info.icon, 14);
    appendText(badge, 'span', 'leave-type-label', info.label);
    parent.append(badge);
    return badge;
}

function appendEmpty(container, empty) {
    clearElement(container);
    container.append(empty);
    empty.style.display = 'block';
}

function hideEmpty(empty) {
    empty.style.display = 'none';
}

export function renderSuggestionFilters(availableCategories, filters = {}) {
    ['filter-month-start', 'filter-month-end'].forEach(id => {
        const select = document.getElementById(id);
        if (!select || select.options.length) return;
        ['Any month', ...MONTHS].forEach((month, index) => {
            const option = new Option(month, String(index));
            select.add(option);
        });
    });
    const values = {
        'filter-min-pto': filters.minPto || '',
        'filter-max-pto': filters.maxPto || '',
        'filter-min-impact': filters.minImpact || '',
        'filter-month-start': filters.monthStart || 0,
        'filter-month-end': filters.monthEnd || 0,
        'filter-sort': filters.sortBy || 'impact'
    };
    Object.entries(values).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });
    const categoryContainer = document.getElementById('filter-categories');
    if (categoryContainer) {
        clearElement(categoryContainer);
        availableCategories.forEach(category => {
            const label = element('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = category;
            input.checked = filters.categories?.includes(category) || false;
            label.append(input, document.createTextNode(` ${category.replace('-', ' ')}`));
            categoryContainer.append(label);
        });
    }
    const activeCount = ['minPto', 'maxPto', 'minImpact', 'monthStart', 'monthEnd']
        .filter(key => filters[key] !== null && filters[key] !== undefined && filters[key] !== '').length
        + (filters.categories?.length || 0)
        + (filters.sortBy && filters.sortBy !== 'impact' ? 1 : 0);
    const count = document.getElementById('suggestion-filter-count');
    if (count) count.textContent = activeCount;
}

export function renderMiniCalendar(now, events) {
    const container = document.getElementById('mini-calendar');
    if (!container) return;
    clearElement(container);
    const header = element('div', 'mini-cal-header');
    DAYS.forEach(day => appendText(header, 'span', '', day));
    container.append(header);
    const grid = element('div', 'mini-cal-grid');
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const holidayDates = events.filter(event => event.type === 'holiday')
        .map(event => Number(event.date.split('-')[2]));
    const vacationEvents = events.filter(event => event.type === 'vacation');
    const vacationDates = vacationEvents.map(event => Number(event.date.split('-')[2]));
    for (let i = 0; i < firstDay; i++) grid.append(element('div', 'mini-cal-day other-month'));
    for (let day = 1; day <= daysInMonth; day++) {
        const classes = [
            'mini-cal-day',
            day === now.getDate() ? 'today' : '',
            holidayDates.includes(day) ? 'holiday' : '',
            vacationDates.includes(day) ? 'vacation' : '',
            ...vacationEvents.filter(event => Number(event.date.split('-')[2]) === day)
                .map(event => `leave-type-${event.leave_type || 'vacation'}`)
        ].filter(Boolean).join(' ');
        const cell = appendText(grid, 'div', classes, day);
        const dayTypes = vacationEvents
            .filter(event => Number(event.date.split('-')[2]) === day)
            .map(event => leaveTypeInfo(event.leave_type).label);
        if (dayTypes.length) cell.title = dayTypes.join(', ');
    }
    container.append(grid);
}

export function renderCalendar(year, month, today, monthEvents) {
    const title = document.getElementById('calendar-title');
    const container = document.getElementById('calendar-grid');
    if (!title || !container) return;
    title.textContent = `${MONTHS[month]} ${year}`;
    clearElement(container);
    const header = element('div', 'cal-header');
    header.setAttribute('role', 'row');
    DAYS.forEach(day => {
        const heading = appendText(header, 'span', '', day);
        heading.setAttribute('role', 'columnheader');
    });
    container.append(header);
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousDays = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
        const cell = element('div', 'cal-day other-month');
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-hidden', 'true');
        appendText(cell, 'span', 'day-number', previousDays - i);
        container.append(cell);
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEvents = monthEvents.filter(event => event.date === date);
        const classes = [
            'cal-day',
            today.getDate() === day && today.getMonth() === month && today.getFullYear() === year
                ? 'today' : '',
            dayEvents.some(event => event.type === 'holiday') ? 'holiday' : '',
            dayEvents.some(event => event.type === 'vacation') ? 'vacation' : '',
            ...dayEvents.filter(event => event.type === 'vacation')
                .map(event => `leave-type-${event.leave_type || 'vacation'}`)
        ].filter(Boolean).join(' ');
        const cell = element('button', classes);
        cell.type = 'button';
        cell.dataset.date = date;
        const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        });
        const eventLabels = dayEvents.map(event =>
            event.type === 'holiday'
                ? `Holiday: ${event.name || 'Holiday'}`
                : `${leaveTypeInfo(event.leave_type).label}: ${event.name || 'Leave'}`);
        const stateLabels = [
            classes.includes('today') ? 'Today' : '',
            ...eventLabels
        ].filter(Boolean);
        cell.setAttribute('aria-label', [dateLabel, ...stateLabels].join('. '));
        cell.title = cell.getAttribute('aria-label');
        const vacationEvent = dayEvents.find(event => event.type === 'vacation' && event.id);
        if (vacationEvent) cell.dataset.vacationId = vacationEvent.id;
        appendText(cell, 'span', 'day-number', day);
        dayEvents.slice(0, 2).forEach(event => {
            const typeLabel = event.type === 'holiday'
                ? 'Holiday' : leaveTypeInfo(event.leave_type).label;
            const rawName = event.name || typeLabel;
            const label = `${typeLabel}: ${String(rawName).substring(0, 10)}`;
            const eventElement = appendText(cell, 'span', `day-event ${event.type}${
                event.type === 'vacation' ? ` leave-type-${event.leave_type || 'vacation'}` : ''
            }`, label.substring(0, 28));
            eventElement.title = `${typeLabel}: ${rawName}`;
        });
        container.append(cell);
    }
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remaining; day++) {
        const cell = element('div', 'cal-day other-month');
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-hidden', 'true');
        appendText(cell, 'span', 'day-number', day);
        container.append(cell);
    }
}

export function renderVacationsList(vacations) {
    const container = document.getElementById('vacations-list');
    emptyVacationElement ||= document.getElementById('empty-vacations');
    const empty = emptyVacationElement;
    if (!container || !empty) return;
    clearElement(container);
    container.append(empty);
    if (!vacations.length) {
        empty.style.display = 'block';
        return;
    }
    hideEmpty(empty);
    vacations.forEach(vacation => {
        const type = leaveTypeInfo(vacation.type);
        const start = new Date(`${vacation.start_date}T00:00:00`);
        const end = new Date(`${vacation.end_date}T00:00:00`);
        const dateStr = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${
            end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        const item = element('div', 'vacation-item');
        item.dataset.id = vacation.id;
        const icon = element('div', `vacation-icon leave-type-${type.key}`);
        icon.title = type.label;
        icon.setAttribute('aria-label', type.label);
        addSvgIcon(icon, type.icon);
        const info = element('div', 'vacation-info');
        appendLeaveBadge(info, type.key);
        appendText(info, 'div', 'vacation-name', vacation.name);
        appendText(info, 'div', 'vacation-dates', dateStr);
        const usage = [];
        if ((vacation.days || 0) > 0) usage.push(`${vacation.days}d`);
        if ((vacation.hours || 0) > 0) {
            usage.push(`${Number(vacation.hours).toFixed(2).replace(/\.00$/, '')}h`);
        }
        const usageElement = element('div', 'vacation-days');
        usageElement.textContent = usage.length ? usage.join(' / ') : '0h';
        usageElement.setAttribute('aria-label', `${type.label}: ${usageElement.textContent}`);
        const actions = element('div', 'vacation-actions');
        const edit = element('button', 'vacation-edit');
        edit.dataset.vacationId = vacation.id;
        edit.title = 'Edit';
        edit.setAttribute('aria-label', `Edit vacation ${vacation.name}`);
        addSvgIcon(edit, 'edit', 16);
        const remove = element('button', 'vacation-delete');
        remove.dataset.vacationId = vacation.id;
        remove.title = 'Delete';
        remove.setAttribute('aria-label', `Delete vacation ${vacation.name}`);
        addSvgIcon(remove, 'delete', 16);
        actions.append(edit, remove);
        item.append(icon, info, usageElement, actions);
        container.append(item);
    });
}

export function renderTypeBreakdown(breakdown, unit = 'days') {
    const container = document.getElementById('type-breakdown');
    if (!container) return;
    clearElement(container);
    (breakdown || []).forEach(entry => {
        const row = element('div', `type-breakdown-row leave-type-${entry.key}`);
        const label = element('div', 'type-breakdown-label');
        appendLeaveBadge(label, entry.key);
        appendText(label, 'small', '', `${entry.records} booking${entry.records === 1 ? '' : 's'}`);
        const amount = appendText(row, 'strong', 'type-breakdown-amount',
            `${Number(entry.amount || 0).toFixed(2)} ${unit}`);
        amount.setAttribute('aria-label', `${entry.label}: ${amount.textContent}`);
        row.prepend(label);
        container.append(row);
    });
}

function renderExplanation(suggestion, index) {
    const explanation = suggestion.explanation;
    if (!explanation) return null;
    const panel = element('div', 'explanation-panel');
    panel.id = `suggestion-explanation-${index}`;
    panel.hidden = true;
    appendText(panel, 'h3', '', 'Why this suggestion?');
    const breakdown = explanation.breakdown || {};
    const bar = element('div', 'day-breakdown-bar');
    [
        ['PTO weekdays', breakdown.weekday_pto_days, 'pto'],
        ['Weekends', breakdown.weekend_days, 'weekend'],
        ['Holidays', breakdown.holiday_days, 'holiday'],
        ['Other weekdays', breakdown.non_pto_weekday_days, 'other']
    ].forEach(([label, value, className]) => {
        const amount = Number(value || 0);
        if (!amount) return;
        const segment = appendText(bar, 'span', `day-segment ${className}`, amount);
        segment.style.flex = amount;
        segment.title = `${label}: ${amount}`;
    });
    const breakdownLabels = element('div', 'day-breakdown-labels');
    [
        `${breakdown.weekday_pto_days || 0} PTO`,
        `${breakdown.weekend_days || 0} weekend`,
        `${breakdown.holiday_days || 0} holiday`,
        `${breakdown.free_days_total || 0} total off`
    ].forEach(label => appendText(breakdownLabels, 'span', '', label));
    panel.append(element('div', 'day-breakdown', bar));
    panel.querySelector('.day-breakdown').append(breakdownLabels);

    const grid = element('div', 'explanation-grid');
    const holidays = explanation.holidays_avoided || {};
    const balance = explanation.balance_impact || {};
    const factors = explanation.ranking_factors || {};
    const policy = explanation.policy_assumptions || {};
    const rows = [
        ['Holidays avoided', `${holidays.count || 0}${holidays.names?.length ? `: ${holidays.names.join(', ')}` : ''}`],
        ['Balance impact', `${Number(balance.amount || 0).toFixed(2)} ${balance.unit || 'days'} (${balance.days_equivalent || 0} days)`],
        ['Ranking', `#${factors.rank || '-'} • ${Number(factors.impact_score || 0).toFixed(2)}x impact${factors.holiday_alignment ? ' • holiday aligned' : ''}`],
        ['Policy', `${policy.holidays_require_pto ? 'Holidays use PTO' : 'Holidays do not use PTO'} • ${policy.accrual_type || 'days'} • ${policy.hours_per_day || 8} hours/day`]
    ];
    rows.forEach(([label, value]) => {
        const row = element('div');
        appendText(row, 'strong', '', label);
        appendText(row, 'span', '', value);
        grid.append(row);
    });
    panel.append(grid);
    appendText(panel, 'div', 'score-formula', explanation.score_formula || '');
    const constraints = element('div', 'constraint-list');
    appendText(constraints, 'strong', '', 'Constraints:');
    constraints.append(document.createTextNode(` ${(explanation.constraints || []).join(' • ')}`));
    panel.append(constraints);
    const alternatives = explanation.alternatives || [];
    if (alternatives.length) {
        const wrapper = element('div', 'alternatives');
        appendText(wrapper, 'strong', '', 'Nearby alternatives');
        alternatives.forEach(alternative => {
            const card = element('div', 'alternative-card');
            appendText(card, 'strong', '', alternative.name || 'Nearby alternative');
            appendText(card, 'span', '', `${alternative.start_date || ''} - ${alternative.end_date || ''}`);
            appendText(card, 'span', '', `${Number(alternative.pto_days || 0)} PTO days • ${Number(alternative.total_days_off || 0)} days off`);
            appendText(card, 'small', '', alternative.comparison || '');
            wrapper.append(card);
        });
        panel.append(wrapper);
    }
    return panel;
}

export function renderVacationSuggestions(payload, vacations) {
    const summary = document.getElementById('suggestions-summary');
    const container = document.getElementById('suggestions-list');
    emptySuggestionElement ||= document.getElementById('empty-suggestions');
    const empty = emptySuggestionElement;
    if (!summary || !container || !empty) return;
    if (!payload) {
        clearElement(summary);
        appendEmpty(container, empty);
        return;
    }
    clearElement(summary);
    const risk = Number(payload.forfeit_risk || 0);
    const remaining = Number(payload.remaining_balance || 0);
    const unit = payload.unit || 'days';
    appendText(summary, 'div', 'suggestions-summary-main', payload.summary?.message || 'PTO suggestions are ready.');
    const sub = element('div', 'suggestions-summary-sub');
    sub.append(
        document.createTextNode('Remaining balance: '),
        element('strong', '', `${remaining.toFixed(2)} ${unit}`),
        document.createTextNode(' • Forfeit risk: '),
        element('strong', '', `${risk.toFixed(2)} ${unit}`)
    );
    summary.append(sub);
    const suggestions = payload.suggestions || [];
    if (!suggestions.length) {
        appendEmpty(container, empty);
        return;
    }
    hideEmpty(empty);
    clearElement(container);
    const plannedKeys = new Set(vacations.map(v => `${v.start_date}|${v.end_date}`));
    suggestions.forEach((suggestion, index) => {
        const item = element('div', 'suggestion-item');
        item.dataset.index = index;
        const main = element('div', 'suggestion-main');
        const suggestionStart = new Date(`${suggestion.start_date}T00:00:00`);
        const suggestionEnd = new Date(`${suggestion.end_date}T00:00:00`);
        const dateStr = `${suggestionStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${
            suggestionEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        appendText(main, 'div', 'suggestion-name', suggestion.name || 'Suggested vacation');
        appendText(main, 'div', 'suggestion-dates', dateStr);
        appendText(main, 'div', 'suggestion-reason', suggestion.reason || '');
        appendText(main, 'div', 'suggestion-metrics',
            `${suggestion.pto_days} PTO day${suggestion.pto_days === 1 ? '' : 's'} • ${
                suggestion.total_days_off} day${suggestion.total_days_off === 1 ? '' : 's'} off • impact ${
                Number(suggestion.impact_score || 0).toFixed(2)}x`);
        const explanation = renderExplanation(suggestion, index);
        if (explanation) main.append(explanation);
        const actions = element('div', 'suggestion-actions');
        appendText(actions, 'span', 'suggestion-tag', (suggestion.category || 'high-impact').replace('-', ' '));
        const why = element('button', 'why-button');
        why.type = 'button';
        why.dataset.index = index;
        why.setAttribute('aria-expanded', 'false');
        why.textContent = 'Why?';
        const add = element('button', 'btn btn-primary btn-sm suggestion-add');
        add.dataset.index = index;
        const planned = plannedKeys.has(`${suggestion.start_date}|${suggestion.end_date}`);
        add.disabled = planned;
        add.textContent = planned ? 'Added' : 'Add to Plan';
        actions.append(why, add);
        item.append(main, actions);
        container.append(item);
    });
}

export function renderVacationWarnings(warnings = [], hints = []) {
    const container = document.getElementById('vacation-warnings');
    if (!container) return;
    clearElement(container);
    [...warnings, ...hints].forEach(item => {
        const warning = element('div', `vacation-warning ${item.severity || 'info'}`);
        appendText(warning, 'span', '', item.message);
        if (item.start_date) {
            const button = element('button', 'warning-apply');
            button.type = 'button';
            button.dataset.start = item.start_date;
            button.dataset.end = item.end_date;
            button.textContent = 'Apply';
            warning.append(button);
        }
        container.append(warning);
    });
}

function renderNotificationContent(alert, includeDismiss = true) {
    const item = element('article', `notification-item ${alert.severity || 'info'}`);
    item.dataset.fingerprint = alert.fingerprint;
    appendText(item, 'h3', 'notification-title', alert.title);
    appendText(item, 'p', 'notification-message', alert.message);
    if (alert.detail) appendText(item, 'p', 'notification-detail', alert.detail);
    const actions = element('div', 'notification-actions');
    if (alert.action) {
        const action = element('button', 'btn btn-secondary btn-sm notification-action');
        action.type = 'button';
        action.dataset.notificationTab = alert.action.tab;
        if (alert.action.target) action.dataset.notificationTarget = alert.action.target;
        action.textContent = alert.action.label;
        actions.append(action);
    }
    if (includeDismiss) {
        const dismiss = element('button', 'notification-dismiss');
        dismiss.type = 'button';
        dismiss.dataset.notificationDismiss = alert.fingerprint;
        dismiss.textContent = 'Dismiss';
        dismiss.setAttribute('aria-label', `Dismiss ${alert.title}`);
        actions.append(dismiss);
    }
    if (actions.childElementCount) item.append(actions);
    return item;
}

export function renderNotifications(alerts = []) {
    const badge = document.getElementById('notification-count');
    const button = document.getElementById('btn-notifications');
    const list = document.getElementById('notification-list');
    if (!badge || !button || !list) return;
    list.replaceChildren();
    if (!alerts.length) {
        appendText(list, 'p', 'notification-empty', 'You are all caught up. No smart PTO reminders right now.');
    } else {
        alerts.forEach(alert => list.append(renderNotificationContent(alert)));
    }
    badge.textContent = alerts.length;
    badge.hidden = alerts.length === 0;
    button.setAttribute('aria-label', alerts.length
        ? `Notifications, ${alerts.length} unread`
        : 'Notifications, no unread alerts');
}

export function renderDashboardNotification(alert) {
    const container = document.getElementById('dashboard-notification-alert');
    if (!container) return;
    container.replaceChildren();
    container.hidden = !alert;
    if (!alert) return;
    container.append(renderNotificationContent(alert, false));
}

export async function renderStoredNotes() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    const notes = await globalThis.PTOStore.listNotes();
    clearElement(list);
    if (!notes.length) {
        appendText(list, 'p', 'empty-hint', 'No notes yet');
        return;
    }
    notes.forEach(note => {
        const item = element('div', 'note-item');
        appendText(item, 'strong', '', note.date);
        item.append(document.createTextNode(` ${note.text}`));
        const button = element('button', 'btn btn-sm note-delete');
        button.dataset.localNoteId = note.id;
        button.textContent = 'Delete';
        button.setAttribute('aria-label', `Delete note from ${note.date}`);
        item.append(button);
        list.append(item);
    });
}

export function renderMultiYearSummary(years) {
    const stateElement = document.getElementById('multi-year-state');
    const container = document.getElementById('multi-year-summary');
    if (!stateElement || !container) return;
    if (!years.length) {
        stateElement.textContent = 'No multi-year forecast data is available.';
        stateElement.hidden = false;
        container.hidden = true;
        return;
    }
    stateElement.hidden = true;
    container.hidden = false;
    clearElement(container);
    years.forEach((entry, index) => {
        const column = element('div', 'year-column');
        appendText(column, 'h3', '', entry.year);
        [
            ['Accrued', entry.total_accrued],
            ['Used', entry.total_used],
            ['Year-end balance', entry.year_end_balance],
            ['Carryover', entry.carryover],
            ['Forfeited', entry.forfeited]
        ].forEach(([label, value]) => {
            const metric = element('div', `year-metric${label === 'Forfeited' ? ' forfeit-metric' : ''}`);
            appendText(metric, 'span', '', label);
            appendText(metric, 'strong', '', Number(value).toFixed(1));
            column.append(metric);
        });
        if (index < years.length - 1) {
            const arrow = appendText(column, 'div', 'rollover-arrow', '→');
            arrow.title = `${Number(entry.carryover).toFixed(1)} carries into ${years[index + 1].year}`;
        }
        container.append(column);
    });
}

export function renderHeatmap(data) {
    const stateElement = document.getElementById('heatmap-state');
    const grid = document.getElementById('heatmap-grid');
    const legend = document.getElementById('heatmap-legend');
    if (!stateElement || !grid || !legend) return;
    if (!data.weeks?.length) {
        stateElement.textContent = 'No heatmap data is available for this year.';
        stateElement.hidden = false;
        grid.hidden = true;
        legend.hidden = true;
        return;
    }
    stateElement.hidden = true;
    grid.hidden = false;
    clearElement(grid);
    data.weeks.forEach(week => {
        const intensity = data.max_score === data.min_score
            ? 0.25
            : (week.score - data.min_score) / (data.max_score - data.min_score);
        const color = `hsl(${Math.round(210 - intensity * 175)}, 85%, ${Math.round(88 - intensity * 35)}%)`;
        const cell = element('button', `heatmap-cell${week.already_booked ? ' booked' : ''}`);
        cell.style.setProperty('--heatmap-color', color);
        cell.title = `Week ${week.week_number}: ${week.start_date} to ${week.end_date}\nScore: ${
            week.score.toFixed(2)}\n${week.holidays.length ? week.holidays.join(', ') : 'No holidays'}`;
        cell.dataset.date = week.start_date;
        cell.setAttribute('aria-label', [
            `Week ${week.week_number}, ${week.start_date} to ${week.end_date}`,
            `score ${week.score.toFixed(2)}`,
            week.already_booked ? 'already booked' : 'available',
            week.holidays.length ? `holidays: ${week.holidays.join(', ')}` : 'no holidays'
        ].join('. '));
        cell.textContent = week.week_number;
        grid.append(cell);
    });
    legend.hidden = false;
    clearElement(legend);
    appendText(legend, 'span', '', 'Lower value');
    legend.append(element('span', 'heatmap-gradient'));
    appendText(legend, 'span', '', 'Higher value');
    appendText(legend, 'span', 'heatmap-legend-note',
        'Color intensity shows days off per PTO day; stripes indicate an already booked week.');
}

export function renderForecastTable(forecast, unit = 'days') {
    const tbody = document.getElementById('forecast-tbody');
    if (!tbody) return;
    clearElement(tbody);
    forecast.forEach(item => {
        const row = element('tr');
        appendText(row, 'td', '', item.month_name);
        appendText(row, 'td', '', `${item.accrued.toFixed(1)} ${unit}`);
        appendText(row, 'td', '', `${item.used.toFixed(1)} ${unit}`);
        appendText(row, 'td', item.balance >= 0 ? 'balance-positive' : 'balance-negative', `${item.balance.toFixed(1)} ${unit}`);
        appendText(row, 'td', '', `${item.limit.toFixed(1)} ${unit}`);
        row.firstElementChild.firstChild?.replaceWith(element('strong', '', item.month_name));
        tbody.append(row);
    });
}

export function renderExcelTable(vacations) {
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Name', 'Start Date', 'End Date', 'Days', 'Hours', 'Type'].forEach(value => {
        appendText(headerRow, 'th', '', value);
    });
    head.append(headerRow);
    const body = document.createElement('tbody');
    vacations.forEach(vacation => {
        const row = document.createElement('tr');
        [
            vacation.name,
            vacation.start_date,
            vacation.end_date,
            vacation.days,
            vacation.hours,
            leaveTypeInfo(vacation.type).label
        ].forEach(value => appendText(row, 'td', '', value));
        body.append(row);
    });
    table.append(head, body);
    return table.outerHTML;
}
