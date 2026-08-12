/** PTO Tracker - Main Application */
const API = {
    authHeader: null,
    async request(path, options = {}, allowAuthPrompt = true) {
        const headers = { ...(options.headers || {}) };
        if (this.authHeader) headers.Authorization = this.authHeader;
        if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase())) {
            const csrfCookie = document.cookie.split('; ').find(cookie => cookie.startsWith('pto_csrf_token='));
            if (csrfCookie) headers['X-CSRF-Token'] = decodeURIComponent(csrfCookie.split('=').slice(1).join('='));
        }
        const res = await fetch(path, { ...options, headers });
        if (res.status === 401 && options.method && allowAuthPrompt) {
            const username = window.prompt('PTO Tracker username:');
            const password = username === null ? null : window.prompt('PTO Tracker password:');
            if (username && password !== null) {
                this.authHeader = `Basic ${btoa(`${username}:${password}`)}`;
                return this.request(path, options, false);
            }
        }
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
        return payload;
    },
    async get(path) {
        return this.request(path);
    },
    async post(path, data) {
        return this.request(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    },
    async put(path, data) {
        return this.request(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    },
    async delete(path) {
        return this.request(path, { method: 'DELETE' });
    }
};

async function parseResponse(res) {
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(data?.error || data?.message || res.statusText || `Request failed (${res.status})`);
    }
    return data;
}

const state = {
    config: {},
    vacations: [],
    forecast: [],
    calendarEvents: {},
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    forecastChart: null,
    multiYearChart: null,
    forecastRequestId: 0,
    multiYearRequestId: 0,
    heatmapRequestId: 0,
    editingVacationId: null,
    vacationCalcRequestId: 0,
    vacationSuggestions: null
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

document.addEventListener('DOMContentLoaded', () => {
    setupThemeToggle();
    setupTabs();
    setupSettings();
    setupVacationModal();
    setupVacationList();
    setupCalendar();
    loadDashboard();
    loadForecast();
});

function setupTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            if (tab.dataset.tab === 'calendar') renderCalendar();
            else if (tab.dataset.tab === 'heatmap') loadHeatmap();
            else if (tab.dataset.tab === 'forecast') loadForecast();
            else if (tab.dataset.tab === 'vacations') loadVacations();
        });
    });
}

function setupThemeToggle() {
    const toggle = document.getElementById('btn-theme-toggle');
    if (!toggle) return;
    const savedTheme = localStorage.getItem('pto-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
    toggle.addEventListener('click', () => {
        const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = nextTheme;
        localStorage.setItem('pto-theme', nextTheme);
        toggle.setAttribute('aria-pressed', String(nextTheme === 'dark'));
    });
}

async function loadDashboard() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    document.getElementById('today-date').textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('current-month-name').textContent = MONTHS[now.getMonth()];
    try {
        const [config, balance, stats] = await Promise.all([
            API.get('/api/config'),
            API.get(`/api/balance/${todayStr}`),
            API.get('/api/stats')
        ]);
        state.config = config;
        const unitLabel = config.pto_accrual_type === 'hours' ? 'hours available' : 'days available';
        const balanceLabel = document.querySelector('.balance-label');
        if (balanceLabel) balanceLabel.textContent = unitLabel;
        document.getElementById('current-balance').textContent = balance.balance.toFixed(1);
        document.getElementById('accrued-balance').textContent = balance.accrued.toFixed(1);
        document.getElementById('used-balance').textContent = balance.used.toFixed(1);
        document.getElementById('limit-balance').textContent = balance.limit.toFixed(1);
        const ytdForecast = stats.yearly_forecast || [];
        const currentMonthIdx = now.getMonth();
        const ytdAccrued = ytdForecast[currentMonthIdx]?.accrued || 0;
        document.getElementById('stat-accrued-ytd').textContent = ytdAccrued.toFixed(1);
        document.getElementById('stat-used-ytd').textContent = stats.current_balance?.used?.toFixed(1) || '0.0';
        document.getElementById('stat-upcoming').textContent = stats.upcoming_vacations || 0;
        const scheduledPtoDays = stats.remaining_scheduled_pto_days ?? stats.remaining_vacation_days ?? 0;
        document.getElementById('stat-scheduled-pto').textContent = Number(scheduledPtoDays).toFixed(1);
        document.getElementById('stat-remaining-days').textContent = daysRemainingThisYear();
        document.getElementById('accrual-per-period').textContent = `${config.pto_accrual_per_pay_period} ${config.pto_accrual_type === 'hours' ? 'hours' : 'days'}`;
        document.getElementById('pay-periods').textContent = config.pay_periods_per_year;
        const annual = (config.pto_accrual_per_pay_period * config.pay_periods_per_year);
        document.getElementById('annual-accrual').textContent = `${annual.toFixed(1)} ${config.pto_accrual_type === 'hours' ? 'hours' : 'days'}`;
        const payPeriodDays = 365.25 / config.pay_periods_per_year;
        const nextAccrual = new Date(now.getTime() + payPeriodDays * 86400000);
        document.getElementById('next-accrual-date').textContent = nextAccrual.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        renderMiniCalendar();
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        showToast('Failed to load dashboard', 'error');
    }
}

function currentDaysUsed() {
    return new Date().getMonth();
}

function daysRemainingThisYear() {
    const now = new Date();
    const end = new Date(now.getFullYear(), 11, 31);
    return Math.ceil((end - now) / 86400000);
}

function renderMiniCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const container = document.getElementById('mini-calendar');
    let html = `<div class="mini-cal-header">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>`;
    html += '<div class="mini-cal-grid">';
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = now.getDate();
    const events = state.calendarEvents[`${year}-${month}`] || [];
    const holidayDates = events.filter(e => e.type === 'holiday').map(e => parseInt(e.date.split('-')[2]));
    const vacationDates = events.filter(e => e.type === 'vacation').map(e => parseInt(e.date.split('-')[2]));
    for (let i = 0; i < firstDay; i++) html += '<div class="mini-cal-day other-month"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
        let classes = 'mini-cal-day';
        if (d === today) classes += ' today';
        if (holidayDates.includes(d)) classes += ' holiday';
        if (vacationDates.includes(d)) classes += ' vacation';
        html += `<div class="${classes}">${d}</div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

function setupCalendar() {
    document.getElementById('cal-prev-month').addEventListener('click', () => {
        state.currentMonth--;
        if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
        renderCalendar();
    });
    document.getElementById('cal-next-month').addEventListener('click', () => {
        state.currentMonth++;
        if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
        renderCalendar();
    });
    document.getElementById('cal-today-btn').addEventListener('click', () => {
        const now = new Date();
        state.currentYear = now.getFullYear();
        state.currentMonth = now.getMonth();
        renderCalendar();
    });

    // Allow adding PTO directly from a calendar day.
    document.getElementById('calendar-grid').addEventListener('click', (e) => {
        const dayEl = e.target.closest('.cal-day[data-date]');
        if (!dayEl) return;
        openCreateVacationModal(dayEl.dataset.date);
    });
}

function expandCalendarEvents(events, year, month) {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const expanded = [];
    (Array.isArray(events) ? events : []).forEach(event => {
        if (event.date) {
            expanded.push(event);
            return;
        }
        if (!event.start_date || !event.end_date) return;
        const start = parseIsoDateToLocal(event.start_date);
        const end = parseIsoDateToLocal(event.end_date);
        const overlapStart = start > monthStart ? start : monthStart;
        const overlapEnd = end < monthEnd ? end : monthEnd;
        for (const day = new Date(overlapStart); day <= overlapEnd; day.setDate(day.getDate() + 1)) {
            expanded.push({ ...event, date: toIsoDate(day) });
        }
    });
    return expanded;
}

async function renderCalendar() {
    const title = `${MONTHS[state.currentMonth]} ${state.currentYear}`;
    document.getElementById('calendar-title').textContent = title;
    try {
        const response = await API.get(`/api/calendar/${state.currentYear}/${state.currentMonth + 1}`);
        const monthEvents = expandCalendarEvents(
            response.events,
            state.currentYear,
            state.currentMonth
        );
        const container = document.getElementById('calendar-grid');
        let html = `<div class="cal-header">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>`;
        const firstDay = new Date(state.currentYear, state.currentMonth, 1).getDay();
        const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
        const prevDays = new Date(state.currentYear, state.currentMonth, 0).getDate();
        const today = new Date();
        for (let i = firstDay - 1; i >= 0; i--) {
            html += `<div class="cal-day other-month"><span class="day-number">${prevDays - i}</span></div>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            let classes = 'cal-day';
            const dateStr = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (today.getDate() === d && today.getMonth() === state.currentMonth && today.getFullYear() === state.currentYear) classes += ' today';
            const dayEvents = monthEvents.filter(e => e.date === dateStr);
            if (dayEvents.some(e => e.type === 'holiday')) classes += ' holiday';
            if (dayEvents.some(e => e.type === 'vacation')) classes += ' vacation';
            html += `<div class="${classes}" data-date="${dateStr}"><span class="day-number">${d}</span>`;
            dayEvents.slice(0, 2).forEach(e => {
                const label = e.type === 'holiday' ? e.name.substring(0, 8) : (e.name || 'Vacation').substring(0, 10);
                const eventClass = e.type === 'holiday' || e.type === 'vacation' ? e.type : 'vacation';
                html += `<span class="day-event ${eventClass}">${escapeHtml(label)}</span>`;
            });
            html += '</div>';
        }
        const totalCells = firstDay + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 1; i <= remaining; i++) {
            html += `<div class="cal-day other-month"><span class="day-number">${i}</span></div>`;
        }
        container.innerHTML = html;
    } catch (err) {
        console.error('Failed to load calendar:', err);
        showToast('Failed to load calendar', 'error');
    }
}

async function loadVacations() {
    try {
        const [vacations, suggestions] = await Promise.all([
            API.get('/api/vacations'),
            API.get(`/api/vacations/suggestions?year=${new Date().getFullYear()}`)
        ]);
        state.vacations = vacations;
        state.vacationSuggestions = suggestions;
        renderVacationsList();
        renderVacationSuggestions();
    } catch (err) {
        console.error('Failed to load vacations:', err);
        showToast('Failed to load vacations', 'error');
    }
}

function renderVacationsList() {
    const container = document.getElementById('vacations-list');
    const empty = document.getElementById('empty-vacations');
    if (state.vacations.length === 0) {
        container.innerHTML = '';
        container.appendChild(empty);
        empty.style.display = 'block';
        return;
    }
    let html = '';
    state.vacations.forEach(v => {
        const start = parseIsoDateToLocal(v.start_date);
        const end = parseIsoDateToLocal(v.end_date);
        const dateStr = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        const usageParts = [];
        if ((v.days || 0) > 0) usageParts.push(`${v.days}d`);
        if ((v.hours || 0) > 0) usageParts.push(`${Number(v.hours).toFixed(2).replace(/\.00$/, '')}h`);
        const usageText = usageParts.length ? usageParts.join(' / ') : '0h';
        html += `
            <div class="vacation-item" data-id="${v.id}">
                <div class="vacation-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3zm-8.27 4a2.75 2.75 0 0 1-5.46 0"></path>
                    </svg>
                </div>
                <div class="vacation-info">
                    <div class="vacation-name">${escapeHtml(v.name)}</div>
                    <div class="vacation-dates">${dateStr}</div>
                </div>
                <div class="vacation-days">${usageText}</div>
                <div class="vacation-actions">
                    <button class="vacation-edit" data-vacation-id="${v.id}" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                        </svg>
                    </button>
                    <button class="vacation-delete" data-vacation-id="${v.id}" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function renderVacationSuggestions() {
    const summaryEl = document.getElementById('suggestions-summary');
    const container = document.getElementById('suggestions-list');
    const empty = document.getElementById('empty-suggestions');
    if (!summaryEl || !container || !empty) return;

    const payload = state.vacationSuggestions;
    if (!payload) {
        summaryEl.innerHTML = '';
        container.innerHTML = '';
        container.appendChild(empty);
        empty.style.display = 'block';
        return;
    }

    const risk = Number(payload.forfeit_risk || 0);
    const remaining = Number(payload.remaining_balance || 0);
    const unit = payload.unit || 'days';
    const riskText = risk > 0 ? `${risk.toFixed(2)} ${unit}` : `0 ${unit}`;
    const remainingText = `${remaining.toFixed(2)} ${unit}`;
    summaryEl.innerHTML = `
        <div class="suggestions-summary-main">${escapeHtml(payload.summary?.message || 'PTO suggestions are ready.')}</div>
        <div class="suggestions-summary-sub">Remaining balance: <strong>${remainingText}</strong> • Forfeit risk: <strong>${riskText}</strong></div>
    `;

    const suggestions = payload.suggestions || [];
    if (!suggestions.length) {
        container.innerHTML = '';
        container.appendChild(empty);
        empty.style.display = 'block';
        return;
    }

    const plannedKeys = new Set(
        state.vacations.map(v => `${v.start_date}|${v.end_date}`)
    );

    container.innerHTML = suggestions.map((s, idx) => {
        const start = parseIsoDateToLocal(s.start_date);
        const end = parseIsoDateToLocal(s.end_date);
        const dateStr = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        const ptoLabel = `${s.pto_days} PTO day${s.pto_days === 1 ? '' : 's'}`;
        const offLabel = `${s.total_days_off} day${s.total_days_off === 1 ? '' : 's'} off`;
        const suggestionKey = `${s.start_date}|${s.end_date}`;
        const alreadyPlanned = plannedKeys.has(suggestionKey);
        return `
            <div class="suggestion-item" data-index="${idx}">
                <div class="suggestion-main">
                    <div class="suggestion-name">${escapeHtml(s.name || 'Suggested vacation')}</div>
                    <div class="suggestion-dates">${dateStr}</div>
                    <div class="suggestion-reason">${escapeHtml(s.reason || '')}</div>
                    <div class="suggestion-metrics">${ptoLabel} • ${offLabel} • impact ${Number(s.impact_score || 0).toFixed(2)}x</div>
                </div>
                <div class="suggestion-actions">
                    <span class="suggestion-tag">${escapeHtml((s.category || 'high-impact').replace('-', ' '))}</span>
                    <button class="btn btn-primary btn-sm suggestion-add" data-index="${idx}" ${alreadyPlanned ? 'disabled' : ''}>${alreadyPlanned ? 'Added' : 'Add to Plan'}</button>
                </div>
            </div>
        `;
    }).join('');
}

async function addSuggestedVacation(index) {
    const list = state.vacationSuggestions?.suggestions || [];
    const suggestion = list[index];
    if (!suggestion) return;

    const suggestionStart = parseIsoDateToLocal(suggestion.start_date);
    const suggestionEnd = parseIsoDateToLocal(suggestion.end_date);
    const suggestionPtoDates = Array.isArray(suggestion.pto_dates) ? suggestion.pto_dates : [];

    const holidayDate = suggestion.holiday_date || null;
    let targetVacation = null;

    if (holidayDate) {
        const holiday = parseIsoDateToLocal(holidayDate);
        targetVacation = state.vacations.find(v => {
            const start = parseIsoDateToLocal(v.start_date);
            const end = parseIsoDateToLocal(v.end_date);
            return holiday >= start && holiday <= end;
        }) || null;
    }

    try {
        if (targetVacation) {
            const existingStart = parseIsoDateToLocal(targetVacation.start_date);
            const existingEnd = parseIsoDateToLocal(targetVacation.end_date);
            const mergedStart = suggestionStart < existingStart ? suggestionStart : existingStart;
            const mergedEnd = suggestionEnd > existingEnd ? suggestionEnd : existingEnd;

            // Only add PTO days that are not already inside the existing vacation range.
            const additionalPtoDays = suggestionPtoDates.filter(d => {
                const day = parseIsoDateToLocal(d);
                return day < existingStart || day > existingEnd;
            }).length;

            await API.put(`/api/vacations/${targetVacation.id}`, {
                name: targetVacation.name,
                start_date: toIsoDate(mergedStart),
                end_date: toIsoDate(mergedEnd),
                days: (Number(targetVacation.days || 0) + additionalPtoDays),
                hours: Number(targetVacation.hours || 0),
                auto_days: false
            });
            showToast('Suggestion merged into existing vacation', 'success');
        } else {
            await API.post('/api/vacations', {
                name: suggestion.name || 'Suggested Vacation',
                start_date: suggestion.start_date,
                end_date: suggestion.end_date,
                days: Number(suggestion.pto_days || 0),
                auto_days: false,
                hours: 0
            });
            showToast('Suggested vacation added', 'success');
        }
        await loadVacations();
        loadDashboard();
        loadForecast();
        renderCalendar();
    } catch (err) {
        console.error('Failed to add suggested vacation:', err);
        showToast('Failed to add suggestion', 'error');
    }
}

function parseIsoDateToLocal(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function toIsoDate(value) {
    if (!(value instanceof Date)) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function openCreateVacationModal(prefillDate = null) {
    state.editingVacationId = null;
    document.getElementById('vacation-modal-title').textContent = 'Add Vacation';
    document.getElementById('btn-submit-vacation').textContent = 'Add Vacation';
    document.getElementById('vacation-auto-days').checked = true;
    document.getElementById('vacation-modal').classList.add('active');
    const selectedDate = prefillDate || new Date().toISOString().split('T')[0];
    document.getElementById('vacation-start').value = selectedDate;
    document.getElementById('vacation-end').value = selectedDate;
    syncVacationDateBounds();
    document.getElementById('vacation-hours').value = 0;
    calcVacationDays();
}

function editVacation(id) {
    const vacation = state.vacations.find(v => v.id === id);
    if (!vacation) return;
    state.editingVacationId = id;
    document.getElementById('vacation-modal-title').textContent = 'Edit Vacation';
    document.getElementById('btn-submit-vacation').textContent = 'Save Changes';
    document.getElementById('vacation-name').value = vacation.name;
    document.getElementById('vacation-start').value = vacation.start_date;
    document.getElementById('vacation-end').value = vacation.end_date;
    syncVacationDateBounds();
    document.getElementById('vacation-hours').value = vacation.hours || 0;
    document.getElementById('vacation-auto-days').checked = (vacation.days || 0) > 0;
    calcVacationDays();
    document.getElementById('vacation-modal').classList.add('active');
}

function setupVacationList() {
    document.getElementById('vacations-list').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-vacation-id]');
        if (!button) return;
        const id = Number(button.dataset.vacationId);
        if (button.classList.contains('vacation-edit')) editVacation(id);
        if (button.classList.contains('vacation-delete')) deleteVacation(id);
    });
}

async function deleteVacation(id) {
    if (!confirm('Delete this vacation?')) return;
    try {
        await API.delete(`/api/vacations/${id}`);
        showToast('Vacation deleted', 'success');
        loadVacations();
        loadDashboard();
    } catch (err) {
        showToast('Failed to delete', 'error');
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function setupVacationModal() {
    document.getElementById('btn-add-vacation').addEventListener('click', () => openCreateVacationModal());
    document.getElementById('btn-close-vacation').addEventListener('click', closeVacationModal);
    document.getElementById('btn-cancel-vacation').addEventListener('click', closeVacationModal);
    document.getElementById('vacation-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('vacation-modal')) closeVacationModal();
    });
    document.getElementById('vacation-start').addEventListener('change', () => {
        syncVacationDateBounds();
        calcVacationDays();
    });
    document.getElementById('vacation-end').addEventListener('change', () => {
        syncVacationDateBounds();
        calcVacationDays();
    });
    document.getElementById('vacation-hours').addEventListener('change', calcVacationDays);
    document.getElementById('vacation-auto-days').addEventListener('change', calcVacationDays);
    document.getElementById('vacation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const autoDays = form.auto_days.checked;
        const data = {
            name: form.name.value,
            start_date: form.start_date.value,
            end_date: form.end_date.value,
            days: parseFloat(form.days.value) || 0,
            hours: normalizeQuarterHours(parseFloat(form.hours.value) || 0),
            auto_days: autoDays
        };
        try {
            if (state.editingVacationId) {
                await API.put(`/api/vacations/${state.editingVacationId}`, data);
                showToast('Vacation updated!', 'success');
            } else {
                await API.post('/api/vacations', data);
                showToast('Vacation added!', 'success');
            }
            closeVacationModal();
            loadVacations();
            loadDashboard();
            loadForecast();
            renderCalendar();
        } catch (err) {
            showToast('Failed to save vacation', 'error');
        }
    });

    const refreshBtn = document.getElementById('btn-refresh-suggestions');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            try {
                state.vacationSuggestions = await API.get(`/api/vacations/suggestions?year=${new Date().getFullYear()}`);
                renderVacationSuggestions();
                showToast('Suggestions refreshed', 'success');
            } catch (err) {
                console.error('Failed to refresh suggestions:', err);
                showToast('Failed to refresh suggestions', 'error');
            }
        });
    }

    const suggestionsList = document.getElementById('suggestions-list');
    if (suggestionsList) {
        suggestionsList.addEventListener('click', async (e) => {
            const button = e.target.closest('.suggestion-add');
            if (!button || button.disabled) return;
            const index = Number(button.dataset.index);
            if (!Number.isFinite(index)) return;
            await addSuggestedVacation(index);
        });
    }
}

function syncVacationDateBounds() {
    const startInput = document.getElementById('vacation-start');
    const endInput = document.getElementById('vacation-end');
    const start = startInput.value;
    if (!start) return;

    // End date can never be earlier than selected start date.
    endInput.min = start;
    if (!endInput.value || endInput.value < start) {
        endInput.value = start;
    }
}

async function calcVacationDays() {
    const start = document.getElementById('vacation-start').value;
    const end = document.getElementById('vacation-end').value;
    if (!start || !end) return;
    const autoDays = document.getElementById('vacation-auto-days').checked;
    const daysInput = document.getElementById('vacation-days');
    const hoursInput = document.getElementById('vacation-hours');
    hoursInput.value = normalizeQuarterHours(parseFloat(hoursInput.value) || 0);
    const startDate = parseIsoDateToLocal(start);
    const endDate = parseIsoDateToLocal(end);
    if (endDate < startDate) {
        daysInput.value = 0;
        document.getElementById('vacation-preview').classList.remove('active');
        return;
    }
    let days = 0;
    if (autoDays) {
        const requestId = ++state.vacationCalcRequestId;
        try {
            const result = await API.get(`/api/vacations/calculate-days?start_date=${start}&end_date=${end}`);
            // Ignore stale responses if user changed dates while waiting.
            if (requestId !== state.vacationCalcRequestId) return;
            if (typeof result.days === 'number') {
                days = result.days;
            }
        } catch (err) {
            // Fallback to weekday-only client estimate if API call fails.
            const current = new Date(startDate);
            while (current <= endDate) {
                if (current.getDay() !== 0 && current.getDay() !== 6) {
                    days += 1;
                }
                current.setDate(current.getDate() + 1);
            }
        }
    }
    daysInput.value = days;
    daysInput.readOnly = true;
    const preview = document.getElementById('vacation-preview');
    const hours = normalizeQuarterHours(parseFloat(hoursInput.value) || 0);
    if (days > 0 && hours > 0) preview.textContent = `This entry will use ${days} PTO day(s) and ${hours} hour(s)`;
    else if (days > 0) preview.textContent = `This entry will use ${days} PTO day(s)`;
    else preview.textContent = `This entry will use ${hours} PTO hour(s)`;
    preview.classList.add('active');
}

function normalizeQuarterHours(hours) {
    const safe = Number.isFinite(hours) ? Math.max(0, hours) : 0;
    return Math.round(safe * 4) / 4;
}

function closeVacationModal() {
    document.getElementById('vacation-modal').classList.remove('active');
    document.getElementById('vacation-form').reset();
    document.getElementById('vacation-preview').classList.remove('active');
    state.editingVacationId = null;
    document.getElementById('vacation-modal-title').textContent = 'Add Vacation';
    document.getElementById('btn-submit-vacation').textContent = 'Add Vacation';
}

function setupSettings() {
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
    document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('settings-modal')) closeSettings();
    });
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = {};
        for (const el of form.elements) {
            if (!el.name || el.type === 'button' || el.type === 'submit') continue;
            if (el.type === 'checkbox') data[el.name] = el.checked;
            else data[el.name] = el.value;
        }
        try {
            await API.put('/api/config', data);
            showToast('Settings saved!', 'success');
            closeSettings();
            loadDashboard();
            loadForecast();
            loadVacations();
        } catch (err) {
            showToast('Failed to save settings', 'error');
        }
    });
}

async function openSettings() {
    try {
        const config = await API.get('/api/config');
        state.config = config;
        document.getElementById('accrual-type').value = config.pto_accrual_type || 'days';
        document.getElementById('accrual-per-period').value = config.pto_accrual_per_pay_period || 1;
        document.getElementById('settings-pay-periods').value = config.pay_periods_per_year || 26;
        document.getElementById('accrual-method').value = config.accrual_method || 'full';
        document.getElementById('carryover-limit').value = config.pto_carryover_limit || 40;
        document.getElementById('accrual-start').value = config.accrual_start_date || new Date().toISOString().split('T')[0];
        document.getElementById('vesting').value = config.pto_vesting_schedule || 'immediate';
        document.getElementById('rollover').checked = config.pto_uses_rollover !== false;
        document.getElementById('lose-limit').checked = config.pto_lose_above_limit !== false;
        document.getElementById('holidays-require-pto').checked = config.pto_holidays_require_pto !== false;
        document.getElementById('settings-modal').classList.add('active');
    } catch (err) {
        showToast('Failed to load settings', 'error');
    }
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
}

async function loadForecast() {
    const yearSelect = document.getElementById('forecast-year');
    if (yearSelect && !yearSelect.dataset.listenerAttached) {
        yearSelect.dataset.listenerAttached = 'true';
        yearSelect.addEventListener('change', async (e) => {
            state.currentYear = parseInt(e.target.value);
            await loadForecast();
        });
    }
    const requestId = ++state.forecastRequestId;
    try {
        const data = await API.get(`/api/balance?year=${state.currentYear}`);
        if (requestId !== state.forecastRequestId) return;
        state.forecast = data.forecast || [];
        try {
            renderForecastChart();
        } catch (chartErr) {
            console.error('Failed to render chart:', chartErr);
            showToast('Failed to render forecast chart', 'error');
        }
        renderForecastTable();
        await loadMultiYearForecast();
    } catch (err) {
        console.error('Failed to load forecast:', err);
        showToast('Failed to load forecast', 'error');
    }
}

async function loadMultiYearForecast() {
    const startSelect = document.getElementById('multi-year-start');
    const countSelect = document.getElementById('multi-year-count');
    if (!startSelect || !countSelect) return;
    if (!startSelect.dataset.listenerAttached) {
        startSelect.dataset.listenerAttached = 'true';
        startSelect.addEventListener('change', loadMultiYearForecast);
        countSelect.addEventListener('change', loadMultiYearForecast);
    }
    const requestId = ++state.multiYearRequestId;
    const stateEl = document.getElementById('multi-year-state');
    try {
        const data = await API.get(
            `/api/forecast/multi-year?start_year=${startSelect.value}&years=${countSelect.value}`
        );
        if (requestId !== state.multiYearRequestId) return;
        renderMultiYearSummary(data.years || []);
        renderMultiYearChart(data.years || []);
    } catch (err) {
        console.error('Failed to load multi-year forecast:', err);
        stateEl.textContent = 'Multi-year forecast is unavailable right now.';
        stateEl.hidden = false;
        document.getElementById('multi-year-summary').hidden = true;
        document.getElementById('multi-year-chart-container').hidden = true;
    }
}

function renderMultiYearSummary(years) {
    const stateEl = document.getElementById('multi-year-state');
    const container = document.getElementById('multi-year-summary');
    if (!years.length) {
        stateEl.textContent = 'No multi-year forecast data is available.';
        stateEl.hidden = false;
        container.hidden = true;
        return;
    }
    stateEl.hidden = true;
    container.hidden = false;
    container.innerHTML = years.map((entry, index) => `
        <div class="year-column">
            <h3>${entry.year}</h3>
            <div class="year-metric"><span>Accrued</span><strong>${Number(entry.total_accrued).toFixed(1)}</strong></div>
            <div class="year-metric"><span>Used</span><strong>${Number(entry.total_used).toFixed(1)}</strong></div>
            <div class="year-metric"><span>Year-end balance</span><strong>${Number(entry.year_end_balance).toFixed(1)}</strong></div>
            <div class="year-metric"><span>Carryover</span><strong>${Number(entry.carryover).toFixed(1)}</strong></div>
            <div class="year-metric forfeit-metric"><span>Forfeited</span><strong>${Number(entry.forfeited).toFixed(1)}</strong></div>
            ${index < years.length - 1 ? `<div class="rollover-arrow" title="${Number(entry.carryover).toFixed(1)} carries into ${years[index + 1].year}">&#8594;</div>` : ''}
        </div>
    `).join('');
}

function renderMultiYearChart(years) {
    const canvas = document.getElementById('multi-year-chart');
    const chartContainer = document.getElementById('multi-year-chart-container');
    if (!canvas || !years.length || typeof Chart === 'undefined') return;
    if (state.multiYearChart) state.multiYearChart.destroy();
    chartContainer.hidden = false;
    const colors = ['#6366f1', '#10b981', '#f59e0b'];
    state.multiYearChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: MONTHS.map(month => month.substring(0, 3)),
            datasets: years.map((entry, index) => ({
                label: String(entry.year),
                data: entry.monthly_balances.map(month => month.balance),
                borderColor: colors[index % colors.length],
                backgroundColor: colors[index % colors.length],
                tension: 0.3,
                pointRadius: 3,
                fill: false
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Balance' } } }
        }
    });
}

async function loadHeatmap() {
    const select = document.getElementById('heatmap-year');
    if (!select) return;
    if (!select.dataset.listenerAttached) {
        select.dataset.listenerAttached = 'true';
        select.addEventListener('change', loadHeatmap);
    }
    const requestId = ++state.heatmapRequestId;
    const stateEl = document.getElementById('heatmap-state');
    const grid = document.getElementById('heatmap-grid');
    const legend = document.getElementById('heatmap-legend');
    try {
        const data = await API.get(`/api/heatmap/${select.value}`);
        if (requestId !== state.heatmapRequestId) return;
        if (!data.weeks?.length) {
            stateEl.textContent = 'No heatmap data is available for this year.';
            stateEl.hidden = false;
            grid.hidden = true;
            legend.hidden = true;
            return;
        }
        stateEl.hidden = true;
        grid.hidden = false;
        grid.innerHTML = data.weeks.map(week => {
            const intensity = data.max_score === data.min_score
                ? 0.25
                : (week.score - data.min_score) / (data.max_score - data.min_score);
            const color = `hsl(${Math.round(210 - intensity * 175)}, 85%, ${Math.round(88 - intensity * 35)}%)`;
            const holidayText = week.holidays.length ? week.holidays.join(', ') : 'No holidays';
            return `<button class="heatmap-cell${week.already_booked ? ' booked' : ''}" style="--heatmap-color:${color}" title="Week ${week.week_number}: ${week.start_date} to ${week.end_date}\nScore: ${week.score.toFixed(2)}\n${holidayText}" data-date="${week.start_date}" aria-label="Week ${week.week_number}, score ${week.score.toFixed(2)}">${week.week_number}</button>`;
        }).join('');
        legend.hidden = false;
        legend.innerHTML = '<span>Lower value</span><span class="heatmap-gradient"></span><span>Higher value</span><span class="heatmap-legend-note">Score = days off per PTO day</span>';
        grid.querySelectorAll('.heatmap-cell').forEach(cell => cell.addEventListener('click', () => {
            const heatmapYear = Number(select.value);
            const day = parseIsoDateToLocal(cell.dataset.date);
            if (day.getFullYear() !== heatmapYear) {
                day.setFullYear(heatmapYear, day < new Date(heatmapYear, 0, 1) ? 0 : 11,
                    day < new Date(heatmapYear, 0, 1) ? 1 : 31);
            }
            state.currentYear = day.getFullYear();
            state.currentMonth = day.getMonth();
            document.querySelector('.nav-tab[data-tab="calendar"]').click();
        }));
    } catch (err) {
        console.error('Failed to load heatmap:', err);
        stateEl.textContent = 'Heatmap is unavailable right now.';
        stateEl.hidden = false;
        grid.hidden = true;
        legend.hidden = true;
    }
}

function renderForecastChart() {
    const ctx = document.getElementById('forecast-chart');
    if (!ctx) return;
    if (state.forecastChart) {
        state.forecastChart.destroy();
        state.forecastChart = null;
    }
    const labels = state.forecast.map(f => f.month_name.substring(0, 3));
    const accrued = state.forecast.map(f => f.accrued);
    const used = state.forecast.map(f => f.used);
    const balance = state.forecast.map(f => f.balance);
    state.forecastChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Accrued', data: accrued, backgroundColor: 'rgba(99, 102, 241, 0.7)', borderColor: 'rgba(99, 102, 241, 1)', borderWidth: 1, borderRadius: 4, order: 2 },
                { label: 'Used', data: used, backgroundColor: 'rgba(239, 68, 68, 0.7)', borderColor: 'rgba(239, 68, 68, 1)', borderWidth: 1, borderRadius: 4, order: 2 },
                { label: 'Balance', data: balance, type: 'line', borderColor: 'rgba(16, 185, 129, 1)', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 3, pointBackgroundColor: 'rgba(16, 185, 129, 1)', pointRadius: 5, fill: true, tension: 0.3, order: 1 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 20, font: { family: 'Inter', size: 12 } } },
                tooltip: { backgroundColor: 'rgba(17, 24, 39, 0.9)', titleFont: { family: 'Inter', size: 13 }, bodyFont: { family: 'Inter', size: 12 }, padding: 12, cornerRadius: 8, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 12 }, color: '#6b7280' } },
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Inter', size: 12 }, color: '#6b7280', callback: (v) => v + ' days' } }
            }
        }
    });
}

function renderForecastTable() {
    const tbody = document.getElementById('forecast-tbody');
    if (!tbody) return;
    let html = '';
    state.forecast.forEach(f => {
        const balanceClass = f.balance >= 0 ? 'balance-positive' : 'balance-negative';
        html += `<tr><td><strong>${f.month_name}</strong></td><td>${f.accrued.toFixed(1)}</td><td>${f.used.toFixed(1)}</td><td class="${balanceClass}">${f.balance.toFixed(1)}</td><td>${f.limit.toFixed(1)}</td></tr>`;
    });
    tbody.innerHTML = html;
}

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}
