/** PTO Tracker application coordinator. */
import {
    DEFAULT_CONFIG,
    POLICY_PRESETS,
    state,
    MONTHS,
    getRuntimeConfig
} from './modules/state.js?v=20260813-15';
import {
    announce,
    closeDialog,
    openDialog,
    reportError,
    setupDialog,
    showToast,
    showWarningToast
} from './modules/dom.js?v=20260813-15';
import {
    renderSuggestionFilters as renderSuggestionFiltersDom,
    renderMiniCalendar as renderMiniCalendarDom,
    renderCalendar as renderCalendarDom,
    renderVacationsList as renderVacationsListDom,
    renderTypeBreakdown as renderTypeBreakdownDom,
    renderVacationSuggestions as renderVacationSuggestionsDom,
    renderVacationWarnings as renderVacationWarningsDom,
    renderNotifications as renderNotificationsDom,
    renderDashboardNotification as renderDashboardNotificationDom,
    renderStoredNotes as renderStoredNotesDom,
    renderMultiYearSummary as renderMultiYearSummaryDom,
    renderHeatmap as renderHeatmapDom,
    renderForecastTable as renderForecastTableDom,
    renderExcelTable
} from './modules/rendering.js?v=20260813-15';
import {
    dismissNotification,
    generateNotifications,
    visibleNotifications
} from './modules/notifications.js?v=20260813-15';
import {
    calendarData,
    expandCalendarEvents
} from './modules/calendar.js?v=20260813-15';
import { generateSuggestions } from './modules/suggestions.js?v=20260813-15';
import { configWarnings } from './modules/settings.js?v=20260813-15';
import { normalizeQuarterHours } from './modules/vacations.js?v=20260813-15';
import {
    yearlyForecast as yearlyForecastFor,
    multiYearForecast as multiYearForecastFor,
    heatmap as heatmapFor
} from './modules/forecast.js?v=20260813-15';

function renderSuggestionFilters(availableCategories) {
    renderSuggestionFiltersDom(availableCategories, state.suggestionFilters || {});
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

function renderPtoYearBoundaries(boundaries = []) {
    const container = document.getElementById('pto-year-boundary-rows');
    if (!container) return;
    container.replaceChildren();
    boundaries.forEach(boundary => addPtoYearBoundaryRow(boundary));
}

function addPtoYearBoundaryRow(boundary = {}) {
    const container = document.getElementById('pto-year-boundary-rows');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'pto-year-boundary-row';
    const year = document.createElement('input');
    year.type = 'number';
    year.min = '1';
    year.step = '1';
    year.inputMode = 'numeric';
    year.value = boundary.year || new Date().getUTCFullYear();
    year.dataset.boundaryYear = 'true';
    year.setAttribute('aria-label', 'PTO year');
    const finalDate = document.createElement('input');
    finalDate.type = 'date';
    finalDate.value = boundary.final_date || `${year.value}-12-31`;
    finalDate.dataset.boundaryDate = 'true';
    finalDate.setAttribute('aria-label', 'PTO year final day');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-secondary btn-sm';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => row.remove());
    row.append(year, finalDate, remove);
    container.append(row);
}

function collectPtoYearBoundaries() {
    return [...document.querySelectorAll('.pto-year-boundary-row')].map(row => ({
        year: row.querySelector('[data-boundary-year]')?.value,
        final_date: row.querySelector('[data-boundary-date]')?.value
    }));
}

export function startApplication() {
    document.addEventListener('DOMContentLoaded', async () => {
    try {
        setupThemeToggle();
        setupTabs();
        setupStorageStatusBanner();
        setupNotifications();
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
        reportError('Failed to start PTO Tracker', err, 'Unable to start PTO Tracker');
    }
    });
}

function setupStorageStatusBanner() {
    const banner = document.getElementById('storage-degraded-banner');
    if (!banner || typeof PTOStore?.onStorageStatusChange !== 'function') return;
    let previousState = PTOStore.getStorageStatus().state;
    PTOStore.onStorageStatusChange(status => {
        banner.classList.remove('danger');
        let message = '';
        if (status.state === 'blocked') {
            message = 'Storage is in degraded mode: another tab may be holding your PTO data. Close the other tabs and reload to avoid losing changes.';
        } else if (status.state === 'error') {
            message = `Storage is in degraded mode (IndexedDB error${status.reason ? `: ${status.reason}` : ''}). Changes are kept in browser fallback storage; export a backup to be safe.`;
            banner.classList.add('danger');
        } else if (status.state === 'no_indexeddb') {
            message = 'IndexedDB is not available, so your PTO data is stored in browser fallback storage. Export backups regularly.';
        }
        banner.textContent = message;
        banner.hidden = message === '';
        if (previousState === 'blocked' && status.state === 'ok') {
            refreshCurrentView();
        }
        previousState = status.state;
    });
}

function refreshCurrentView() {
    const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
    if (activeTab === 'calendar') renderCalendar();
    else if (activeTab === 'heatmap') loadHeatmap();
    else if (activeTab === 'forecast') loadForecast();
    else if (activeTab === 'vacations') loadVacations();
    else loadDashboard();
}

function setupTabs() {
    const tabs = [...document.querySelectorAll('.nav-tab')];
    const activateTab = tab => {
        tabs.forEach(candidate => {
            const selected = candidate === tab;
            candidate.classList.toggle('active', selected);
            candidate.setAttribute('aria-selected', String(selected));
            candidate.tabIndex = selected ? 0 : -1;
        });
        document.querySelectorAll('.tab-content').forEach(panel => {
            const selected = panel.id === `tab-${tab.dataset.tab}`;
            panel.classList.toggle('active', selected);
            panel.hidden = !selected;
        });
        if (tab.dataset.tab === 'calendar') renderCalendar();
        else if (tab.dataset.tab === 'heatmap') loadHeatmap();
        else if (tab.dataset.tab === 'forecast') loadForecast();
        else if (tab.dataset.tab === 'vacations') loadVacations();
    };
    tabs.forEach(tab => {
        tab.addEventListener('click', () => activateTab(tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = tabs.indexOf(tab);
            const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
            const nextTab = tabs[nextIndex];
            nextTab.focus();
            activateTab(nextTab);
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
    announce('Loading current PTO balance.');
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
        updateUnitLabels(config);
        refreshNotifications();
        await loadForecast();
        const now = parseIsoDateToLocal(state.today);
        const balance = PTO.calculateBalanceOnDate(config.current_date, config, vacations);
        const yearlyForecast = yearlyForecastFor(config.current_year, config, vacations);
        const typeBreakdown = PTO.getVacationTypeBreakdown(config.current_year, config, vacations);
        const remainingUsage = PTO.calculateVacationUsageInRange(
            config.current_date, PTO.getPtoYearEnd(config.current_year, config), config, vacations);
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
        const ytdForecast = stats.yearly_forecast || [];
        const currentMonthIdx = now.getMonth();
        const ytdAccrued = ytdForecast[currentMonthIdx]?.accrued || 0;
        document.getElementById('stat-accrued-ytd').textContent = ytdAccrued.toFixed(1);
        document.getElementById('stat-used-ytd').textContent = stats.current_balance?.used?.toFixed(1) || '0.0';
        document.getElementById('stat-upcoming').textContent = stats.upcoming_vacations || 0;
        const scheduledPtoDays = stats.remaining_scheduled_pto_days ?? stats.remaining_vacation_days ?? 0;
        document.getElementById('stat-scheduled-pto').textContent = Number(scheduledPtoDays).toFixed(1);
        document.getElementById('stat-remaining-days').textContent = daysRemainingThisYear();
        renderTypeBreakdownDom(typeBreakdown, config.pto_accrual_type === 'hours' ? 'hours' : 'days');
        document.getElementById('dashboard-accrual-per-period').textContent = `${config.pto_accrual_per_pay_period} ${config.pto_accrual_type === 'hours' ? 'hours' : 'days'}`;
        document.getElementById('pay-periods').textContent = config.pay_periods_per_year;
        const annual = (config.pto_accrual_per_pay_period * config.pay_periods_per_year);
        document.getElementById('annual-accrual').textContent = `${annual.toFixed(1)} ${config.pto_accrual_type === 'hours' ? 'hours' : 'days'}`;
        const payPeriodDays = 365.25 / config.pay_periods_per_year;
        const nextAccrual = new Date(now.getTime() + payPeriodDays * 86400000);
        document.getElementById('next-accrual-date').textContent = nextAccrual.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        announce(`Current PTO balance loaded: ${balance.balance.toFixed(1)} ${unitLabel}.`);
        state.calendarEvents[`${now.getFullYear()}-${now.getMonth()}`] =
            expandCalendarEvents(calendarData(now.getFullYear(), now.getMonth()).events, now.getFullYear(), now.getMonth());
        renderMiniCalendar();
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        showToast('Failed to load dashboard', 'error');
    }
}

function refreshNotifications() {
        state.notificationAlerts = generateNotifications({
            pto: PTO,
            config: state.config,
            vacations: state.vacations,
            today: state.today
        });
        state.notifications = visibleNotifications(state.notificationAlerts);
        renderNotificationsDom(state.notifications);
        renderDashboardNotificationDom(state.notifications[0] || null);
    }

function activateNotificationAction(action) {
        const tab = document.querySelector(`.nav-tab[data-tab="${action.dataset.notificationTab}"]`);
        if (tab) tab.click();
        const targetId = action.dataset.notificationTarget;
        if (targetId) {
            window.setTimeout(() => {
                const target = document.getElementById(targetId);
                if (!target) return;
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (target.matches('[tabindex]')) target.focus({ preventScroll: true });
            }, 0);
        }
    }

function handleNotificationEvent(event) {
        const dismiss = event.target.closest('[data-notification-dismiss]');
        if (dismiss) {
            const alert = state.notificationAlerts.find(item =>
                item.fingerprint === dismiss.dataset.notificationDismiss);
            if (alert) {
                dismissNotification(alert);
                refreshNotifications();
                announce(`${alert.title} dismissed.`);
            }
            return;
        }
        const action = event.target.closest('.notification-action');
        if (action) {
            activateNotificationAction(action);
            closeNotificationPanel();
        }
    }

function closeNotificationPanel() {
        const panel = document.getElementById('notification-panel');
        const button = document.getElementById('btn-notifications');
        if (!panel || !button) return;
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }

function setupNotifications() {
        const button = document.getElementById('btn-notifications');
        const panel = document.getElementById('notification-panel');
        if (!button || !panel) return;
        button.addEventListener('click', event => {
            event.stopPropagation();
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
        });
        panel.addEventListener('click', handleNotificationEvent);
        document.getElementById('dashboard-notification-alert')?.addEventListener(
            'click', handleNotificationEvent);
        document.addEventListener('click', event => {
            if (!event.target.closest('.notification-popover')) closeNotificationPanel();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeNotificationPanel();
        });
}

function currentDaysUsed() {
    return getTodayDate().getMonth();
}

function daysRemainingThisYear(today = getTodayDate()) {
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const yearEndUtc = Date.UTC(today.getFullYear(), 11, 31);
    return Math.round((yearEndUtc - todayUtc) / 86400000);
}

function ptoUnit(config = state.config) {
    return config.pto_accrual_type === 'hours' ? 'hours' : 'days';
}

function updateUnitLabels(config) {
    const unit = ptoUnit(config);
    const labels = {
        'accrued-label': `Accrued (${unit})`,
        'used-label': `Used (${unit})`,
        'limit-label': `Limit (${unit})`,
        'stat-accrued-ytd-label': `Accrued YTD (${unit})`,
        'stat-used-ytd-label': `Used YTD (${unit})`,
        'stat-scheduled-pto-label': `Scheduled PTO Remaining (${unit})`,
        'carryover-limit-label': `Carryover Limit (${unit})`,
        'forecast-accrued-heading': `Accrued (${unit})`,
        'forecast-used-heading': `Used (${unit})`,
        'forecast-balance-heading': `Balance (${unit})`,
        'forecast-limit-heading': `Limit (${unit})`
    };
    Object.entries(labels).forEach(([id, text]) => {
        const label = document.getElementById(id);
        if (label) label.textContent = text;
    });
    const carryoverInput = document.getElementById('carryover-limit');
    if (carryoverInput) carryoverInput.step = unit === 'hours' ? '0.25' : '1';
}

function renderMiniCalendar() {
    const now = getTodayDate();
    const year = now.getFullYear();
    const month = now.getMonth();
    const events = state.calendarEvents[`${year}-${month}`] || [];
    renderMiniCalendarDom(now, events);
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
            state.vacations = await PTOStore.listVacations();
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

async function renderCalendar() {
    announce(`Loading ${MONTHS[state.currentMonth]} ${state.currentYear} calendar.`);
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
        const today = getTodayDate();
        renderCalendarDom(state.currentYear, state.currentMonth, today, monthEvents);
    } catch (err) {
        console.error('Failed to load calendar:', err);
        showToast('Failed to load calendar', 'error');
    }
}

async function loadVacations() {
    announce('Loading planned vacations.');
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
   renderVacationsListDom(state.vacations);
}

function renderVacationSuggestions() {
   renderVacationSuggestionsDom(state.vacationSuggestions, state.vacations);
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
    document.getElementById('vacation-type').value = 'vacation';
    const selectedDate = prefillDate || getTodayIsoDate();
    document.getElementById('vacation-start').value = selectedDate;
    document.getElementById('vacation-end').value = selectedDate;
    syncVacationDateBounds();
    document.getElementById('vacation-days').value = 0;
    document.getElementById('vacation-hours').value = 0;
    calcVacationDays();
    openDialog(document.getElementById('vacation-modal'), '#vacation-name');
}

function editVacation(id) {
    const vacation = state.vacations.find(v => v.id === id);
    if (!vacation) return;
    state.editingVacationId = id;
    document.getElementById('vacation-modal-title').textContent = 'Edit Vacation';
    document.getElementById('btn-submit-vacation').textContent = 'Save Changes';
    document.getElementById('vacation-name').value = vacation.name;
    document.getElementById('vacation-type').value = PTO.normalizeLeaveType(vacation.type);
    document.getElementById('vacation-start').value = vacation.start_date;
    document.getElementById('vacation-end').value = vacation.end_date;
    syncVacationDateBounds();
    document.getElementById('vacation-days').value = vacation.days || 0;
    document.getElementById('vacation-hours').value = vacation.hours || 0;
    document.getElementById('vacation-auto-days').checked = vacation.auto_days !== false
        && (vacation.days || 0) > 0;
    calcVacationDays();
    openDialog(document.getElementById('vacation-modal'), '#vacation-name');
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
    if (!window.confirm('Delete this vacation? This can be undone briefly.')) return;
    try {
        const deleted = state.vacations.find(item => item.id === id);
        if (!deleted || !(await PTOStore.deleteVacation(id))) return;
        showToast('Vacation deleted', 'success', {
            label: 'Undo',
            onClick: async () => {
                try {
                    await PTOStore.restoreVacation(id);
                    await refreshViews();
                    showToast('Vacation restored', 'success');
                } catch (error) {
                    showToast(error.message || 'Failed to restore vacation', 'error');
                }
            }
        });
        await refreshViews();
    } catch (err) {
        showToast(err.message || 'Failed to delete vacation', 'error');
    }
}

function setupVacationModal() {
    document.getElementById('btn-add-vacation').addEventListener('click', () => openCreateVacationModal());
    document.getElementById('btn-close-vacation').addEventListener('click', closeVacationModal);
    document.getElementById('btn-cancel-vacation').addEventListener('click', closeVacationModal);
    setupDialog(document.getElementById('vacation-modal'), closeVacationModal);
    document.getElementById('vacation-start').addEventListener('change', () => {
        syncVacationDateBounds();
        calcVacationDays();
    });
    document.getElementById('vacation-end').addEventListener('change', () => {
        syncVacationDateBounds();
        calcVacationDays();
    });
    document.getElementById('vacation-hours').addEventListener('change', calcVacationDays);
    document.getElementById('vacation-auto-days').addEventListener('change', () => {
        if (!document.getElementById('vacation-auto-days').checked) {
            document.getElementById('vacation-days').value = 0;
        }
        calcVacationDays();
    });
    ['vacation-start', 'vacation-end', 'vacation-days', 'vacation-hours', 'vacation-type'].forEach(id => {
        document.getElementById(id).addEventListener('input', scheduleVacationAnalysis);
        document.getElementById(id).addEventListener('change', scheduleVacationAnalysis);
    });
    document.getElementById('vacation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const autoDays = form.auto_days.checked;
        try {
            const booking = PTO.normalizeBooking(
                parseFloat(form.days.value) || 0,
                parseFloat(form.hours.value) || 0,
                state.config
            );
            const data = {
                name: form.name.value,
                start_date: form.start_date.value,
                end_date: form.end_date.value,
                days: booking.days,
                hours: booking.hours,
                type: PTO.normalizeLeaveType(form.elements.type.value),
                auto_days: autoDays
            };
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
    renderVacationWarningsDom(warnings, hints);
    const container = document.getElementById('vacation-warnings');
    if (!container) return;
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
    let days = Number(daysInput.value) || 0;
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
    daysInput.readOnly = autoDays;
    const preview = document.getElementById('vacation-preview');
    const hours = normalizeQuarterHours(parseFloat(hoursInput.value) || 0);
    let booking;
    try {
        booking = PTO.normalizeBooking(days, hours, state.config);
    } catch (err) {
        preview.textContent = err.message || 'Invalid PTO amount';
        preview.classList.add('active');
        return;
    }
    const unit = ptoUnit();
    const amount = booking.amount.toFixed(2).replace(/\.?0+$/, '');
    preview.textContent = `This entry will use ${amount} PTO ${unit}`;
    preview.classList.add('active');
}

function closeVacationModal() {
    closeDialog(document.getElementById('vacation-modal'));
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
    csvExportLink?.addEventListener('click', event => {
        event.preventDefault();
        downloadText(PTOTransfer.toCSV(state.vacations),
            `pto-tracker-${getTodayIsoDate()}.csv`, 'text/csv;charset=utf-8');
    });
    excelExportLink?.addEventListener('click', event => {
        event.preventDefault();
        downloadText(
            renderExcelTable(state.vacations),
            `pto-tracker-${getTodayIsoDate()}.xls`,
            'application/vnd.ms-excel'
        );
    });
    setupVacationExchange(downloadText);
}

function setupVacationExchange(downloadText) {
    const exportButton = document.getElementById('btn-export-ics');
    const importButton = document.getElementById('btn-import-vacations');
    const fileInput = document.createElement('input');
    const importModal = document.getElementById('vacation-import-modal');
    const confirmButton = document.getElementById('btn-confirm-vacation-import');
    if (!exportButton || !importButton || !fileInput || !importModal || !confirmButton) return;

    fileInput.id = 'vacation-import-file';
    fileInput.type = 'file';
    fileInput.accept = '.csv,.ics,text/csv,text/calendar';
    fileInput.hidden = true;
    importButton.after(fileInput);

    let preview = null;
    const closeImport = () => {
        closeDialog(importModal);
        fileInput.value = '';
        preview = null;
        confirmButton.disabled = true;
        confirmButton.textContent = 'Import valid vacations';
        document.querySelector('#vacation-import-preview tbody')?.replaceChildren();
        const summary = document.getElementById('vacation-import-summary');
        if (summary) summary.textContent = '';
        const errors = document.getElementById('vacation-import-errors');
        if (errors) {
            errors.textContent = '';
            errors.hidden = true;
        }
    };
    document.getElementById('btn-close-vacation-import').addEventListener('click', closeImport);
    document.getElementById('btn-cancel-vacation-import').addEventListener('click', closeImport);
    setupDialog(importModal, closeImport);

    exportButton.addEventListener('click', () => {
        try {
            downloadText(PTOTransfer.toICS(state.vacations), `pto-tracker-vacations-${getTodayIsoDate()}.ics`,
                'text/calendar;charset=utf-8');
            showToast('Active vacations exported as ICS', 'success');
        } catch (error) {
            showToast(error.message || 'Failed to export vacations', 'error');
        }
    });
    importButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
            const parsed = PTOTransfer.parse(await file.text(), file.name);
            const existing = await PTOStore.listVacations();
            preview = PTOTransfer.validateRows(parsed.rows, {
                existingVacations: existing,
                config: state.config,
                pto: globalThis.PTO
            });
            renderVacationImportPreview(preview, parsed.format, file.name);
            importButton.focus({ preventScroll: true });
            openDialog(importModal, '#btn-cancel-vacation-import');
        } catch (error) {
            preview = null;
            renderVacationImportError(error.message || 'Unable to parse the selected file.');
            importButton.focus({ preventScroll: true });
            openDialog(importModal, '#btn-cancel-vacation-import');
        }
    });
    confirmButton.addEventListener('click', async () => {
        if (!preview?.valid?.length) return;
        const count = preview.valid.length;
        if (!window.confirm(`Add ${count} valid vacation${count === 1 ? '' : 's'} to this browser?`)) return;
        confirmButton.disabled = true;
        try {
            for (const vacation of preview.valid) {
                const { source, errors, duplicate, valid, analysis, ...record } = vacation;
                await PTOStore.putVacation(record);
            }
            closeImport();
            await refreshViews();
            showToast(`${count} vacation${count === 1 ? '' : 's'} imported`, 'success');
        } catch (error) {
            confirmButton.disabled = false;
            showToast(error.message || 'Failed to import vacations', 'error');
        }
    });
}

function renderVacationImportError(message) {
    const summary = document.getElementById('vacation-import-summary');
    const errors = document.getElementById('vacation-import-errors');
    const body = document.querySelector('#vacation-import-preview tbody');
    if (summary) summary.textContent = 'No import preview is available.';
    if (errors) {
        errors.textContent = message;
        errors.hidden = false;
    }
    body?.replaceChildren();
    const button = document.getElementById('btn-confirm-vacation-import');
    if (button) {
        button.disabled = true;
        button.textContent = 'Import valid vacations';
    }
}

function renderVacationImportPreview(result, format, filename) {
    const summary = document.getElementById('vacation-import-summary');
    const errors = document.getElementById('vacation-import-errors');
    const body = document.querySelector('#vacation-import-preview tbody');
    const confirmButton = document.getElementById('btn-confirm-vacation-import');
    if (!summary || !errors || !body || !confirmButton) return;
    body.replaceChildren();
    errors.replaceChildren();
    errors.hidden = result.invalid.length === 0;
    summary.textContent = `${filename} (${format.toUpperCase()}): ${result.valid.length} valid, `
        + `${result.invalid.length} skipped, ${result.duplicateCount} duplicate${result.duplicateCount === 1 ? '' : 's'}.`;
    result.invalid.forEach(row => {
        const item = document.createElement('div');
        item.textContent = `${row.source}: ${row.errors.join('; ')}`;
        errors.append(item);
    });
    result.rows.forEach(row => {
        const tableRow = document.createElement('tr');
        const status = document.createElement('td');
        status.className = row.valid ? 'import-valid' : 'import-invalid';
        status.textContent = row.valid ? 'Ready' : 'Skipped';
        const name = document.createElement('td');
        name.textContent = row.name;
        const type = document.createElement('td');
        type.textContent = PTO.leaveType(row.type).label;
        const dates = document.createElement('td');
        dates.textContent = `${row.start_date} to ${row.end_date}`;
        const details = document.createElement('td');
        details.className = 'import-row-detail';
        const warnings = row.analysis?.warnings?.filter(item => item.severity !== 'error')
            .map(item => item.message) || [];
        details.textContent = row.valid
            ? `${PTO.leaveType(row.type).label}: ${warnings.join(' ')}`.trim()
            : row.errors.join('; ');
        tableRow.append(status, name, type, dates, details);
        body.append(tableRow);
    });
    confirmButton.disabled = result.valid.length === 0;
    confirmButton.textContent = result.valid.length
        ? `Import ${result.valid.length} valid vacation${result.valid.length === 1 ? '' : 's'}`
        : 'Import valid vacations';
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
            showToast('Note saved', 'success');
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
    await renderStoredNotesDom();
    const list = document.getElementById('notes-list');
    if (!list) return;
    list.querySelectorAll('[data-local-note-id]').forEach(button => {
        button.addEventListener('click', async () => {
            try {
                if (!window.confirm('Delete this note? This can be undone briefly.')) return;
                const id = Number(button.dataset.localNoteId);
                if (!(await PTOStore.deleteNote(id))) return;
                showToast('Note deleted', 'success', {
                    label: 'Undo',
                    onClick: async () => {
                        try {
                            await PTOStore.restoreNote(id);
                            await renderStoredNotes();
                            showToast('Note restored', 'success');
                        } catch (error) {
                            showToast(error.message || 'Failed to restore note', 'error');
                        }
                    }
                });
                await renderStoredNotes();
            } catch (error) {
                showToast(error.message || 'Failed to delete note', 'error');
            }
        });
    });
}

function setupSettings() {
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
    document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
    setupDialog(document.getElementById('settings-modal'), closeSettings);
    document.getElementById('btn-preview-policy').addEventListener('click', previewPolicy);
    document.getElementById('btn-apply-policy').addEventListener('click', applyPolicy);
    document.getElementById('btn-add-pto-year-boundary').addEventListener(
        'click', () => addPtoYearBoundaryRow());
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
            merged.pto_year_boundaries = collectPtoYearBoundaries();
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
        document.getElementById('settings-accrual-per-period').value = config.pto_accrual_per_pay_period || 1;
        document.getElementById('hours-per-day').value = config.pto_hours_per_day || 8;
        document.getElementById('settings-pay-periods').value = config.pay_periods_per_year || 26;
        document.getElementById('accrual-method').value = config.accrual_method || 'full';
        document.getElementById('carryover-limit').value = config.pto_carryover_limit || 40;
        document.getElementById('accrual-start').value = config.accrual_start_date || getTodayIsoDate();
        renderPtoYearBoundaries(config.pto_year_boundaries || []);
        document.getElementById('forecast-baseline-enabled').checked = config.forecast_baseline_enabled === true;
        document.getElementById('forecast-baseline-date').value =
            config.forecast_baseline_date || config.accrual_start_date || getTodayIsoDate();
        document.getElementById('forecast-baseline-balance').value = config.forecast_baseline_balance || 0;
        document.getElementById('timezone').value = config.timezone || 'UTC';
        document.getElementById('vesting').value = config.pto_vesting_schedule || 'immediate';
        document.getElementById('rollover').checked = config.pto_uses_rollover !== false;
        document.getElementById('lose-limit').checked = config.pto_lose_above_limit !== false;
        document.getElementById('holidays-require-pto').checked = config.pto_holidays_require_pto !== false;
        openDialog(document.getElementById('settings-modal'), '#policy-preset');
    } catch (err) {
        showToast('Failed to load settings', 'error');
    }
}

function closeSettings() {
    closeDialog(document.getElementById('settings-modal'));
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
    announce(`Loading ${state.currentYear} forecast.`);
    const yearSelect = document.getElementById('forecast-year');
    // The select's HTML options are static, so rebuild them around the year
    // about to be rendered and mirror that year into the select.
    globalThis.PTOYearSelects.populateYearSelect(yearSelect, state.currentYear);
    if (yearSelect) {
        yearSelect.value = String(state.currentYear);
    }
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
            forecast: yearlyForecastFor(state.currentYear, state.config, state.vacations)
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
    globalThis.PTOYearSelects.populateYearSelect(startSelect, state.config?.current_year ?? state.currentYear);
    if (!startSelect.dataset.listenerAttached) {
        startSelect.dataset.listenerAttached = 'true';
        startSelect.addEventListener('change', loadMultiYearForecast);
        countSelect.addEventListener('change', loadMultiYearForecast);
    }
    const requestId = ++state.multiYearRequestId;
    const stateEl = document.getElementById('multi-year-state');
    announce('Loading multi-year forecast.');
    try {
        const data = {
            years: multiYearForecastFor(
                Number(startSelect.value), Number(countSelect.value), state.config, state.vacations)
        };
        if (requestId !== state.multiYearRequestId) return;
        renderMultiYearSummary(data.years || []);
        renderMultiYearChart(data.years || []);
    } catch (err) {
        console.error('Failed to load multi-year forecast:', err);
        stateEl.textContent = 'Multi-year forecast is unavailable right now.';
        announce('Multi-year forecast is unavailable right now.');
        stateEl.hidden = false;
        document.getElementById('multi-year-summary').hidden = true;
        document.getElementById('multi-year-chart-container').hidden = true;
    }
}

function renderMultiYearSummary(years) {
    renderMultiYearSummaryDom(years);
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
    globalThis.PTOYearSelects.populateYearSelect(select, state.config?.current_year ?? state.currentYear);
    if (!select.dataset.listenerAttached) {
        select.dataset.listenerAttached = 'true';
        select.addEventListener('change', loadHeatmap);
    }
    const requestId = ++state.heatmapRequestId;
    const stateEl = document.getElementById('heatmap-state');
    const grid = document.getElementById('heatmap-grid');
    const legend = document.getElementById('heatmap-legend');
    announce(`Loading ${select.value} best weeks heatmap.`);
    try {
        const data = heatmapFor(Number(select.value), state.config, state.vacations);
        if (requestId !== state.heatmapRequestId) return;
        if (!data.weeks?.length) {
            stateEl.textContent = 'No heatmap data is available for this year.';
            stateEl.hidden = false;
            grid.hidden = true;
            legend.hidden = true;
            return;
        }
        renderHeatmapDom(data);
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
        announce('Heatmap is unavailable right now.');
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
                tooltip: { backgroundColor: 'rgba(17, 24, 39, 0.9)', titleFont: { family: 'Inter', size: 13 }, bodyFont: { family: 'Inter', size: 12 }, padding: 12, cornerRadius: 8, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} ${ptoUnit()}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 12 }, color: '#6b7280' } },
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Inter', size: 12 }, color: '#6b7280', callback: (v) => `${v} ${ptoUnit()}` } }
            }
        }
    });
}

function renderForecastTable() {
    renderForecastTableDom(state.forecast, ptoUnit());
}
