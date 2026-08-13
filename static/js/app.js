/** PTO Tracker - Main Application */
const modulesReady = Promise.resolve();

const currentUtcYear = new Date().getUTCFullYear();
const DEFAULT_CONFIG = Object.freeze({
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
    timezone: 'UTC'
});

const POLICY_PRESETS = Object.freeze({
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

async function getStoredConfig() {
    await modulesReady;
    const stored = await PTOStore.getConfig();
    const config = { ...DEFAULT_CONFIG, ...(stored || {}) };
    if (!stored) await PTOStore.putConfig(config);
    return config;
}

async function getRuntimeConfig() {
    const config = await getStoredConfig();
    return {
        ...config,
        current_date: PTO.getLocalToday(config),
        current_year: PTO.getLocalYear(config)
    };
}

function suggestionOptions() {
    const filters = state.suggestionFilters || {};
    return {
        today: state.today || PTO.getLocalToday(state.config),
        min_pto_days: filters.minPto,
        max_pto_days: filters.maxPto,
        min_impact: filters.minImpact,
        month_start: filters.monthStart,
        month_end: filters.monthEnd,
        categories: filters.categories || [],
        sort_by: filters.sortBy || 'impact'
    };
}

function generateSuggestions() {
    return PTO.generateVacationSuggestions(
        state.currentYear, state.config, state.vacations, suggestionOptions());
}

function calendarData(year, month) {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const holidays = Object.entries(PTO.getHolidays(year, state.config))
        .filter(([date]) => date.startsWith(monthPrefix))
        .map(([date, name]) => ({ date, name, type: 'holiday' }));
    const vacations = state.vacations
        .filter(item => item.start_date <= `${monthPrefix}-31` && item.end_date >= `${monthPrefix}-01`)
        .map(item => ({ ...item, type: 'vacation' }));
    return { events: [...holidays, ...vacations] };
}

function configWarnings(config) {
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
    if (!PTO.isValidTimezone(config.timezone)) {
        warnings.push({ severity: 'error', message: 'Timezone must be a valid IANA timezone.' });
    }
    if (!PTO.isCanonicalDate(config.accrual_start_date)) {
        warnings.push({ severity: 'error', message: 'Accrual start date must use YYYY-MM-DD format.' });
    }
    return warnings;
}

function renderSuggestionFilters(availableCategories) {
    const months = ['Any month', ...MONTHS];
    ['filter-month-start', 'filter-month-end'].forEach(id => {
        const select = document.getElementById(id);
        if (!select || select.options.length) return;
        select.innerHTML = months.map((month, index) => `<option value="${index}">${month}</option>`).join('');
    });
    const filters = state.suggestionFilters || {};
    const values = {
        'filter-min-pto': filters.minPto || '',
        'filter-max-pto': filters.maxPto || '',
        'filter-min-impact': filters.minImpact || '',
        'filter-month-start': filters.monthStart || 0,
        'filter-month-end': filters.monthEnd || 0,
        'filter-sort': filters.sortBy || 'impact'
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.value = value;
    });
    const categoryContainer = document.getElementById('filter-categories');
    if (categoryContainer) {
        categoryContainer.innerHTML = availableCategories.map(category => `
            <label><input type="checkbox" value="${escapeHtml(category)}"
                ${filters.categories?.includes(category) ? 'checked' : ''}> ${escapeHtml(category.replace('-', ' '))}</label>
        `).join('');
    }
    const activeCount = ['minPto', 'maxPto', 'minImpact', 'monthStart', 'monthEnd']
        .filter(key => filters[key] !== null && filters[key] !== undefined && filters[key] !== '').length
        + (filters.categories?.length || 0)
        + (filters.sortBy && filters.sortBy !== 'impact' ? 1 : 0);
    const count = document.getElementById('suggestion-filter-count');
    if (count) count.textContent = activeCount;
}

function updateSuggestionFilters() {
    const numberValue = id => {
        const value = document.getElementById(id)?.value;
        return value === '' ? null : Number(value);
    };
    state.suggestionFilters = {
        minPto: numberValue('filter-min-pto'),
        maxPto: numberValue('filter-max-pto'),
        minImpact: numberValue('filter-min-impact'),
        monthStart: numberValue('filter-month-start') || null,
        monthEnd: numberValue('filter-month-end') || null,
        categories: [...document.querySelectorAll('#filter-categories input:checked')].map(input => input.value),
        sortBy: document.getElementById('filter-sort')?.value || 'impact'
    };
    localStorage.setItem('pto-suggestion-filters', JSON.stringify(state.suggestionFilters));
    renderSuggestionFilters(state.vacationSuggestions?.available_categories || []);
    clearTimeout(state.suggestionAnalysisTimer);
    state.suggestionAnalysisTimer = setTimeout(() => {
        try {
            state.vacationSuggestions = generateSuggestions();
            renderSuggestionFilters(state.vacationSuggestions.available_categories || []);
            renderVacationSuggestions();
        } catch (err) {
            showToast(err.message || 'Failed to filter suggestions', 'error');
        }
    }, 250);
}

function resetSuggestionFilters() {
    state.suggestionFilters = { categories: [], sortBy: 'impact' };
    localStorage.setItem('pto-suggestion-filters', JSON.stringify(state.suggestionFilters));
    loadVacations();
}

const state = {
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
    suggestionFilters: JSON.parse(localStorage.getItem('pto-suggestion-filters') || '{"categories":[],"sortBy":"impact"}'),
    suggestionAnalysisTimer: null,
    vacationAnalysisRequestId: 0
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await modulesReady;
        setupThemeToggle();
        setupTabs();
        setupSettings();
        setupVacationModal();
        setupVacationList();
        setupCalendar();
        await setupNotes();
        setupDataTransfer();
        await loadDashboard();
        const persisted = await PTOStore.requestPersistentStorage();
        if (navigator.storage?.persist && !persisted) {
            showToast('Browser storage persistence was not granted; export backups regularly.', 'warning');
        }
    } catch (err) {
        console.error('Failed to start PTO Tracker:', err);
        showToast('Unable to start PTO Tracker', 'error');
    }
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
    try {
        const [config, vacations] = await Promise.all([
            getRuntimeConfig(),
            PTOStore.listVacations()
        ]);
        state.config = config;
        state.vacations = vacations;
        state.today = config.current_date;
        state.currentYear = config.current_year;
        state.currentMonth = parseIsoDateToLocal(state.today).getMonth();
        await loadForecast();
        const now = parseIsoDateToLocal(state.today);
        const balance = PTO.calculateBalanceOnDate(config.current_date, config, vacations);
        const yearlyForecast = PTO.generateYearlyForecast(config.current_year, config, vacations);
        const remainingUsage = PTO.calculateVacationUsageInRange(
            config.current_date, `${config.current_year}-12-31`, config, vacations);
        const stats = {
            current_balance: balance,
            yearly_forecast: yearlyForecast,
            upcoming_vacations: vacations.filter(item => item.end_date >= config.current_date).length,
            remaining_scheduled_pto_days: config.pto_accrual_type === 'hours'
                ? (remainingUsage.days * Number(config.pto_hours_per_day || 8)) + remainingUsage.hours
                : remainingUsage.days + (remainingUsage.hours / Number(config.pto_hours_per_day || 8))
        };
        document.getElementById('today-date').textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        document.getElementById('current-month-name').textContent = MONTHS[now.getMonth()];
        const unitLabel = config.pto_accrual_type === 'hours' ? 'hours available' : 'days available';
        const balanceLabel = document.querySelector('.balance-label');
        if (balanceLabel) balanceLabel.textContent = unitLabel;
        document.getElementById('current-balance').textContent = balance.balance.toFixed(1);
        document.getElementById('accrued-balance').textContent = balance.accrued.toFixed(1);
        document.getElementById('used-balance').textContent = balance.used.toFixed(1);
        document.getElementById('limit-balance').textContent = balance.limit.toFixed(1);
        renderRuleSummary(config);
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
        state.calendarEvents[`${now.getFullYear()}-${now.getMonth()}`] =
            expandCalendarEvents(calendarData(now.getFullYear(), now.getMonth()).events, now.getFullYear(), now.getMonth());
        renderMiniCalendar();
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        showToast('Failed to load dashboard', 'error');
    }
}

function renderRuleSummary(config = state.config) {
    const unit = config.pto_accrual_type === 'hours' ? 'hours' : 'days';
    const chip = document.getElementById('rules-unit-chip');
    if (chip) chip.textContent = unit === 'hours' ? 'Hours' : 'Days';

    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setValue('rule-accrual-type', `${config.pto_accrual_type === 'hours' ? 'Hours' : 'Days'} accrual`);
    setValue('rule-accrual-method', config.accrual_method === 'pro-rata' ? 'Pro-rata (business days)' : 'Full accrual');
    setValue('rule-carryover', `${Number(config.pto_carryover_limit || 0).toFixed(0)} ${unit}`);
    setValue('rule-rollover', config.pto_uses_rollover === false ? 'No rollover' : 'Rollover enabled');
    setValue('rule-holidays', config.pto_holidays_require_pto === false ? 'Holiday days are free' : 'Holidays require PTO');
    setValue('rule-vesting', formatSettingLabel(config.pto_vesting_schedule || 'immediate'));
    setValue('rule-grace', `${Number(config.pto_grace_period_days || 0).toFixed(0)} days`);

    const remainingLabel = document.getElementById('stat-remaining-label');
    if (remainingLabel) {
        remainingLabel.textContent = config.pto_accrual_type === 'hours' ? 'Calendar Hours Left' : 'Calendar Days Left';
    }
}

function formatSettingLabel(value) {
    if (!value) return 'Immediate';
    return String(value)
        .replace(/[_-]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function currentDaysUsed() {
    return getTodayDate().getMonth();
}

function daysRemainingThisYear(today = getTodayDate()) {
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const yearEndUtc = Date.UTC(today.getFullYear(), 11, 31);
    return Math.round((yearEndUtc - todayUtc) / 86400000);
}

function renderMiniCalendar() {
    const now = getTodayDate();
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
        const now = getTodayDate();
        state.currentYear = now.getFullYear();
        state.currentMonth = now.getMonth();
        renderCalendar();
    });

    // Allow adding PTO directly from a calendar day.
    document.getElementById('calendar-grid').addEventListener('click', async (e) => {
        const dayEl = e.target.closest('.cal-day[data-date]');
        if (!dayEl) return;

        if (!state.vacations.length) {
            try {
                state.vacations = await API.get('/api/vacations');
            } catch (err) {
                console.error('Failed to load vacations for edit:', err);
            }
        }

        let vacationId = Number(dayEl.dataset.vacationId || 0);
        if (vacationId <= 0) {
            const clickedDate = dayEl.dataset.date;
            const match = state.vacations.find(v => v.start_date <= clickedDate && v.end_date >= clickedDate);
            if (match) vacationId = Number(match.id || 0);
        }

        if (vacationId > 0) {
            editVacation(vacationId);
            return;
        }

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
        if (!state.vacations.length) state.vacations = await PTOStore.listVacations();
        const response = calendarData(state.currentYear, state.currentMonth);
        const monthEvents = expandCalendarEvents(
            response.events,
            state.currentYear,
            state.currentMonth
        );
        state.calendarEvents[`${state.currentYear}-${state.currentMonth}`] = monthEvents;
        const container = document.getElementById('calendar-grid');
        let html = `<div class="cal-header">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>`;
        const firstDay = new Date(state.currentYear, state.currentMonth, 1).getDay();
        const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
        const prevDays = new Date(state.currentYear, state.currentMonth, 0).getDate();
        const today = getTodayDate();
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
            const vacationEvent = dayEvents.find(e => e.type === 'vacation' && e.vacation_id);
            const vacationIdAttr = vacationEvent ? ` data-vacation-id="${vacationEvent.vacation_id}"` : '';
            html += `<div class="${classes}" data-date="${dateStr}"${vacationIdAttr}><span class="day-number">${d}</span>`;
            dayEvents.slice(0, 2).forEach(e => {
                const rawName = e.name || (e.type === 'holiday' ? 'Holiday' : 'Vacation');
                const label = e.type === 'holiday' ? rawName : rawName.substring(0, 10);
                const eventClass = e.type === 'holiday' || e.type === 'vacation' ? e.type : 'vacation';
                html += `<span class="day-event ${eventClass}" title="${escapeHtml(rawName)}">${escapeHtml(label)}</span>`;
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
        const vacations = await PTOStore.listVacations();
        state.vacations = vacations;
        state.vacationSuggestions = generateSuggestions();
        renderSuggestionFilters(state.vacationSuggestions.available_categories || []);
        renderVacationsList();
        renderVacationSuggestions();
    } catch (err) {
        console.error('Failed to load vacations:', err);
        showToast('Failed to load vacations', 'error');
    }
}

async function refreshViews() {
    await loadDashboard();
    await loadVacations();
    await renderCalendar();
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
                    ${renderSuggestionExplanation(s, idx)}
                </div>
                <div class="suggestion-actions">
                    <span class="suggestion-tag">${escapeHtml((s.category || 'high-impact').replace('-', ' '))}</span>
                    <button class="why-button" type="button" data-index="${idx}" aria-expanded="false">Why?</button>
                    <button class="btn btn-primary btn-sm suggestion-add" data-index="${idx}" ${alreadyPlanned ? 'disabled' : ''}>${alreadyPlanned ? 'Added' : 'Add to Plan'}</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderSuggestionExplanation(suggestion, index) {
   const explanation = suggestion.explanation;
   if (!explanation) return '';
   const breakdown = explanation.breakdown || {};
   const policy = explanation.policy_assumptions || {};
   const holidays = explanation.holidays_avoided || {};
   const balance = explanation.balance_impact || {};
   const factors = explanation.ranking_factors || {};
   const alternatives = explanation.alternatives || [];
   const segment = (label, value, className) => {
       const numericValue = Number(value || 0);
       return numericValue ? `<span class="day-segment ${className}" style="flex:${numericValue}" title="${label}: ${numericValue}">${numericValue}</span>` : '';
   };
   const alternativeMarkup = alternatives.map(alt => `
       <div class="alternative-card">
           <strong>${escapeHtml(alt.name || 'Nearby alternative')}</strong>
           <span>${escapeHtml(alt.start_date)} - ${escapeHtml(alt.end_date)}</span>
           <span>${Number(alt.pto_days || 0)} PTO days • ${Number(alt.total_days_off || 0)} days off</span>
           <small>${escapeHtml(alt.comparison || '')}</small>
       </div>
   `).join('');
   return `
       <div class="explanation-panel" id="suggestion-explanation-${index}" hidden>
           <h3>Why this suggestion?</h3>
           <div class="day-breakdown">
               <div class="day-breakdown-bar">
                   ${segment('PTO weekdays', breakdown.weekday_pto_days, 'pto')}
                   ${segment('Weekends', breakdown.weekend_days, 'weekend')}
                   ${segment('Holidays', breakdown.holiday_days, 'holiday')}
                   ${segment('Other weekdays', breakdown.non_pto_weekday_days, 'other')}
               </div>
               <div class="day-breakdown-labels">
                   <span>${breakdown.weekday_pto_days || 0} PTO</span>
                   <span>${breakdown.weekend_days || 0} weekend</span>
                   <span>${breakdown.holiday_days || 0} holiday</span>
                   <span>${breakdown.free_days_total || 0} total off</span>
               </div>
           </div>
           <div class="explanation-grid">
               <div><strong>Holidays avoided</strong><span>${holidays.count || 0}${holidays.names?.length ? `: ${escapeHtml(holidays.names.join(', '))}` : ''}</span></div>
               <div><strong>Balance impact</strong><span>${Number(balance.amount || 0).toFixed(2)} ${escapeHtml(balance.unit || 'days')} (${balance.days_equivalent || 0} days)</span></div>
               <div><strong>Ranking</strong><span>#${factors.rank || '-'} • ${Number(factors.impact_score || 0).toFixed(2)}x impact${factors.holiday_alignment ? ' • holiday aligned' : ''}</span></div>
               <div><strong>Policy</strong><span>${policy.holidays_require_pto ? 'Holidays use PTO' : 'Holidays do not use PTO'} • ${escapeHtml(policy.accrual_type || 'days')} • ${policy.hours_per_day || 8} hours/day</span></div>
           </div>
           <div class="score-formula">${escapeHtml(explanation.score_formula || '')}</div>
           <div class="constraint-list"><strong>Constraints:</strong> ${(explanation.constraints || []).map(item => escapeHtml(item)).join(' • ')}</div>
           ${alternativeMarkup ? `<div class="alternatives"><strong>Nearby alternatives</strong>${alternativeMarkup}</div>` : ''}
       </div>
   `;
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

            await PTOStore.putVacation({
                ...targetVacation,
                name: targetVacation.name,
                start_date: toIsoDate(mergedStart),
                end_date: toIsoDate(mergedEnd),
                days: (Number(targetVacation.days || 0) + additionalPtoDays),
                hours: Number(targetVacation.hours || 0),
                auto_days: false
            });
            showToast('Suggestion merged into existing vacation', 'success');
        } else {
            await PTOStore.putVacation({
                name: suggestion.name || 'Suggested Vacation',
                start_date: suggestion.start_date,
                end_date: suggestion.end_date,
                days: Number(suggestion.pto_days || 0),
                auto_days: false,
                hours: 0
            });
            showToast('Suggested vacation added', 'success');
        }
        await refreshViews();
    } catch (err) {
        console.error('Failed to add suggested vacation:', err);
        showToast('Failed to add suggestion', 'error');
    }
}

function parseIsoDateToLocal(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function getTodayIsoDate() {
    return state.today || new Date().toISOString().split('T')[0];
}

function getTodayDate() {
    return parseIsoDateToLocal(getTodayIsoDate());
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
    const selectedDate = prefillDate || getTodayIsoDate();
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
        await PTOStore.deleteVacation(id);
        showToast('Vacation deleted', 'success');
        await refreshViews();
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
    ['vacation-start', 'vacation-end', 'vacation-days', 'vacation-hours'].forEach(id => {
        document.getElementById(id).addEventListener('input', scheduleVacationAnalysis);
        document.getElementById(id).addEventListener('change', scheduleVacationAnalysis);
    });
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
            const conflict = PTO.detectVacationConflicts(
                data.start_date, data.end_date, state.vacations, state.editingVacationId);
            if (conflict.has_conflicts) throw new Error(conflict.error);
            const analysis = PTO.analyzeVacation(
                data.start_date, data.end_date, data.days, data.hours,
                state.config, state.vacations, state.editingVacationId);
            const blockingWarning = analysis.warnings.find(item => item.severity === 'error');
            if (blockingWarning) throw new Error(blockingWarning.message);
            if (state.editingVacationId) {
                const existing = state.vacations.find(item => item.id === state.editingVacationId) || {};
                await PTOStore.putVacation({ ...existing, ...data, id: state.editingVacationId });
                showToast('Vacation updated!', 'success');
                showWarningToast(analysis.warnings);
            } else {
                await PTOStore.putVacation(data);
                showToast('Vacation added!', 'success');
                showWarningToast(analysis.warnings);
            }
            closeVacationModal();
            await refreshViews();
        } catch (err) {
            showToast(err.message || 'Failed to save vacation', 'error');
        }
    });

    const refreshBtn = document.getElementById('btn-refresh-suggestions');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            try {
                state.vacationSuggestions = generateSuggestions();
                renderSuggestionFilters(state.vacationSuggestions.available_categories || []);
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
            const whyButton = e.target.closest('.why-button');
            if (whyButton) {
                const panel = document.getElementById(`suggestion-explanation-${whyButton.dataset.index}`);
                if (!panel) return;
                const expanded = !panel.hidden;
                panel.hidden = expanded;
                whyButton.setAttribute('aria-expanded', String(!expanded));
                whyButton.textContent = expanded ? 'Why?' : 'Hide why';
                return;
            }
            const button = e.target.closest('.suggestion-add');
            if (!button || button.disabled) return;
            const index = Number(button.dataset.index);
            if (!Number.isFinite(index)) return;
            await addSuggestedVacation(index);
        });
    }
    document.getElementById('btn-toggle-suggestion-filters')?.addEventListener('click', (event) => {
        const controls = document.getElementById('suggestion-filter-controls');
        const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
        event.currentTarget.setAttribute('aria-expanded', String(!expanded));
        controls.hidden = expanded;
    });
    document.getElementById('btn-reset-suggestion-filters')?.addEventListener('click', resetSuggestionFilters);
    document.getElementById('suggestion-filter-controls')?.addEventListener('change', updateSuggestionFilters);
}

function scheduleVacationAnalysis() {
    clearTimeout(state.suggestionAnalysisTimer);
    state.suggestionAnalysisTimer = setTimeout(analyzeVacation, 300);
}

async function analyzeVacation() {
    const form = document.getElementById('vacation-form');
    const start = form.start_date.value;
    const end = form.end_date.value;
    if (!start || !end || end < start) {
        renderVacationWarnings([]);
        return;
    }
    const requestId = ++state.vacationAnalysisRequestId;
    try {
        const result = PTO.analyzeVacation(
            start, end, Number(form.days.value) || 0, Number(form.hours.value) || 0,
            state.config, state.vacations, state.editingVacationId);
        if (requestId === state.vacationAnalysisRequestId) renderVacationWarnings(result.warnings, result.hints);
    } catch (err) {
        if (requestId === state.vacationAnalysisRequestId) renderVacationWarnings([{
            severity: 'error', message: err.message || 'Unable to analyze this vacation.'
        }]);
    }
}

function renderVacationWarnings(warnings = [], hints = []) {
    const container = document.getElementById('vacation-warnings');
    if (!container) return;
    container.innerHTML = [...warnings, ...hints].map(item => `
        <div class="vacation-warning ${item.severity || 'info'}">
            <span>${escapeHtml(item.message)}</span>
            ${item.start_date ? `<button type="button" class="warning-apply" data-start="${item.start_date}" data-end="${item.end_date}">Apply</button>` : ''}
        </div>
    `).join('');
    container.querySelectorAll('.warning-apply').forEach(button => {
        button.addEventListener('click', () => {
            document.getElementById('vacation-start').value = button.dataset.start;
            document.getElementById('vacation-end').value = button.dataset.end;
            syncVacationDateBounds();
            calcVacationDays();
            scheduleVacationAnalysis();
        });
    });
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
            const result = { days: PTO.getVacationDays(start, end, state.config) };
            if (requestId !== state.vacationCalcRequestId) return;
            if (typeof result.days === 'number') {
                days = result.days;
            }
        } catch (err) {
            daysInput.value = 0;
            renderVacationWarnings([{
                severity: 'error',
                message: err.message || 'Unable to calculate vacation days.'
            }]);
            return;
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

function setupDataTransfer() {
    const jsonExportLink = document.getElementById('export-json');
    const jsonImportLink = document.getElementById('import-json');
    const csvExportLink = document.getElementById('export-csv');
    const excelExportLink = document.getElementById('export-excel');
    if (!jsonExportLink || !jsonImportLink) return;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.hidden = true;
    jsonImportLink.after(fileInput);

    jsonExportLink.addEventListener('click', async event => {
        event.preventDefault();
        try {
            const contents = await PTOStore.exportJSON(2);
            const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
            const download = document.createElement('a');
            download.href = url;
            download.download = `pto-tracker-${getTodayIsoDate()}.json`;
            download.click();
            URL.revokeObjectURL(url);
            showToast('PTO data exported', 'success');
        } catch (err) {
            showToast(err.message || 'Failed to export data', 'error');
        }
    });
    jsonImportLink.addEventListener('click', event => {
        event.preventDefault();
        fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
            if (!window.confirm('Importing a backup will replace current browser data. Continue?')) {
                return;
            }
            await PTOStore.importJSON(await file.text());
            state.config = await getRuntimeConfig();
            await refreshViews();
            await renderStoredNotes();
            showToast('PTO data imported', 'success');
        } catch (err) {
            showToast(err.message || 'Failed to import data', 'error');
        } finally {
            fileInput.value = '';
        }
    });

    const downloadText = (contents, filename, type) => {
        const url = URL.createObjectURL(new Blob([contents], { type }));
        const download = document.createElement('a');
        download.href = url;
        download.download = filename;
        download.click();
        URL.revokeObjectURL(url);
    };
    const escapeCsv = value => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const exportRows = () => [
        ['Name', 'Start Date', 'End Date', 'Days', 'Hours'],
        ...state.vacations.map(v => [v.name, v.start_date, v.end_date, v.days, v.hours])
    ];
    csvExportLink?.addEventListener('click', event => {
        event.preventDefault();
        downloadText(
            exportRows().map(row => row.map(escapeCsv).join(',')).join('\n'),
            `pto-tracker-${getTodayIsoDate()}.csv`,
            'text/csv'
        );
    });
    excelExportLink?.addEventListener('click', event => {
        event.preventDefault();
        const rows = exportRows().map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
        downloadText(
            `<table><thead>${rows.split('</tr>')[0]}</tr></thead><tbody>${rows.split('</tr>').slice(1).join('</tr>')}</tbody></table>`,
            `pto-tracker-${getTodayIsoDate()}.xls`,
            'application/vnd.ms-excel'
        );
    });
}

async function setupNotes() {
    const form = document.getElementById('note-form');
    const dateInput = document.getElementById('note-date');
    if (!form || !dateInput) return;
    dateInput.value = (await getRuntimeConfig()).current_date;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        try {
            await PTOStore.putNote({
                date: dateInput.value,
                text: document.getElementById('note-text').value.trim()
            });
            document.getElementById('note-text').value = '';
            await renderStoredNotes();
        } catch (error) {
            showToast(error.message || 'Failed to save note', 'error');
        }
    });
    renderStoredNotes().catch(error => {
        console.error('Failed to load notes:', error);
        showToast('Failed to load notes', 'error');
    });
}

async function renderStoredNotes() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    const notes = await PTOStore.listNotes();
    list.innerHTML = notes.length ? notes.map(note => `
        <div class="note-item"><strong>${escapeHtml(note.date)}</strong> ${escapeHtml(note.text)}
            <button class="btn btn-sm" data-local-note-id="${note.id}">Delete</button>
        </div>`).join('') : '<p class="empty-hint">No notes yet</p>';
    list.querySelectorAll('[data-local-note-id]').forEach(button => {
        button.addEventListener('click', async () => {
            await PTOStore.deleteNote(Number(button.dataset.localNoteId));
            await renderStoredNotes();
        });
    });
}

function setupSettings() {
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
    document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('settings-modal')) closeSettings();
    });
    document.getElementById('btn-preview-policy').addEventListener('click', previewPolicy);
    document.getElementById('btn-apply-policy').addEventListener('click', applyPolicy);
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
            const merged = { ...state.config, ...data };
            delete merged.current_date;
            delete merged.current_year;
            const warnings = configWarnings(merged);
            const blocking = warnings.find(item => item.severity === 'error');
            if (blocking) throw new Error(blocking.message);
            await PTOStore.putConfig(merged);
            state.config = await getRuntimeConfig();
            showToast('Settings saved!', 'success');
            showWarningToast(warnings);
            closeSettings();
            await refreshViews();
        } catch (err) {
            showToast(err.message || 'Failed to save settings', 'error');
        }
    });
}

async function openSettings() {
    try {
        const config = await getRuntimeConfig();
        state.config = config;
        resetPolicyPreview();
        loadPolicyPresets().catch((err) => {
            console.warn('Policy presets unavailable:', err);
            disablePolicyWizard();
        });
        document.getElementById('holiday-country').value = config.holiday_country || 'US';
        document.getElementById('accrual-type').value = config.pto_accrual_type || 'days';
        document.getElementById('accrual-per-period').value = config.pto_accrual_per_pay_period || 1;
        document.getElementById('settings-pay-periods').value = config.pay_periods_per_year || 26;
        document.getElementById('accrual-method').value = config.accrual_method || 'pro-rata';
        document.getElementById('carryover-limit').value = config.pto_carryover_limit || 40;
        document.getElementById('start-year').value = config.pto_start_year || getTodayDate().getFullYear();
        document.getElementById('cashout-rate').value = config.pto_cashout_rate ?? 0;
        document.getElementById('grace-period').value = config.pto_grace_period_days || 0;
        document.getElementById('accrual-start').value = config.accrual_start_date || getTodayIsoDate();
        document.getElementById('timezone').value = config.timezone || 'UTC';
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

async function loadPolicyPresets() {
    const presets = POLICY_PRESETS;
    const select = document.getElementById('policy-preset');
    document.querySelector('.policy-wizard').removeAttribute('aria-disabled');
    select.disabled = false;
    document.getElementById('btn-preview-policy').disabled = false;
    select.replaceChildren(new Option('Choose a policy preset', ''));
    Object.entries(presets).forEach(([id, preset]) => {
        select.add(new Option(preset.name, id));
    });
    state.policyPresets = presets;
}

function disablePolicyWizard() {
    const wizard = document.querySelector('.policy-wizard');
    wizard.setAttribute('aria-disabled', 'true');
    document.getElementById('policy-preset').disabled = true;
    document.getElementById('btn-preview-policy').disabled = true;
    document.getElementById('btn-apply-policy').hidden = true;
    const preview = document.getElementById('policy-preview');
    preview.textContent = 'Policy presets are temporarily unavailable. You can still edit and save settings below.';
    preview.hidden = false;
}

function resetPolicyPreview() {
    document.getElementById('policy-preset').value = '';
    const preview = document.getElementById('policy-preview');
    preview.replaceChildren();
    preview.hidden = true;
    document.getElementById('btn-apply-policy').hidden = true;
}

function previewPolicy() {
    const presetId = document.getElementById('policy-preset').value;
    const preset = state.policyPresets?.[presetId];
    if (!preset) {
        showToast('Choose a policy preset to preview', 'error');
        return;
    }
    const preview = document.getElementById('policy-preview');
    preview.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = preset.name;
    const description = document.createElement('p');
    description.textContent = preset.description;
    const summary = document.createElement('p');
    const settings = preset.settings;
    summary.textContent = `${settings.pto_accrual_per_pay_period} ${settings.pto_accrual_type} per pay period, ${settings.pay_periods_per_year} pay periods/year, ${settings.pto_uses_rollover ? 'rollover enabled' : 'no rollover'}.`;
    preview.append(heading, description, summary);
    preview.hidden = false;
    document.getElementById('btn-apply-policy').hidden = false;
}

async function applyPolicy() {
    const presetId = document.getElementById('policy-preset').value;
    const preset = state.policyPresets?.[presetId];
    if (!preset) return;
    if (!window.confirm(`Apply the "${preset.name}" preset? This will replace the current PTO settings.`)) return;
    try {
        const config = { ...DEFAULT_CONFIG, ...preset.settings };
        await PTOStore.putConfig(config);
        state.config = await getRuntimeConfig();
        showToast('Policy preset applied!', 'success');
        closeSettings();
        await refreshViews();
    } catch (err) {
        showToast(err.message || 'Failed to apply policy preset', 'error');
    }
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
        const data = {
            forecast: PTO.generateYearlyForecast(state.currentYear, state.config, state.vacations)
        };
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
        const data = {
            years: PTO.generateMultiYearForecast(
                Number(startSelect.value), Number(countSelect.value), state.config, state.vacations)
        };
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
        const data = PTO.generateHeatmap(Number(select.value), state.config, state.vacations);
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

function showWarningToast(warnings = []) {
    const warning = warnings.find(item => item.severity === 'error' || item.severity === 'warning');
    if (warning) {
        setTimeout(() => {
            showToast(warning.message, warning.severity === 'error' ? 'error' : 'warning');
        }, 3200);
    }
}
