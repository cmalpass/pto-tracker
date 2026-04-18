/** PTO Tracker - Main Application */
const API = {
    async get(path) {
        const res = await fetch(path);
        return res.json();
    },
    async post(path, data) {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },
    async put(path, data) {
        const res = await fetch(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },
    async delete(path) {
        const res = await fetch(path, { method: 'DELETE' });
        return res.json();
    }
};

const state = {
    config: {},
    vacations: [],
    forecast: [],
    calendarEvents: {},
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    forecastChart: null
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupSettings();
    setupVacationModal();
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
            else if (tab.dataset.tab === 'forecast') loadForecast();
            else if (tab.dataset.tab === 'vacations') loadVacations();
        });
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
}

async function renderCalendar() {
    const title = `${MONTHS[state.currentMonth]} ${state.currentYear}`;
    document.getElementById('calendar-title').textContent = title;
    try {
        const events = await API.get(`/api/calendar/${state.currentYear}/${state.currentMonth + 1}`);
        const container = document.getElementById('calendar-grid');
        let html = `<div class="cal-header">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>`;
        html += '<div class="cal-grid">';
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
            const dayEvents = events.events.filter(e => e.date === dateStr);
            if (dayEvents.some(e => e.type === 'holiday')) classes += ' holiday';
            if (dayEvents.some(e => e.type === 'vacation')) classes += ' vacation';
            html += `<div class="${classes}" data-date="${dateStr}"><span class="day-number">${d}</span>`;
            dayEvents.slice(0, 2).forEach(e => {
                const label = e.type === 'holiday' ? e.name.substring(0, 8) : (e.name || 'Vacation').substring(0, 10);
                html += `<span class="day-event">${label}</span>`;
            });
            html += '</div>';
        }
        const totalCells = firstDay + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 1; i <= remaining; i++) {
            html += `<div class="cal-day other-month"><span class="day-number">${i}</span></div>`;
        }
        html += '</div>';
        container.innerHTML = html;
    } catch (err) {
        console.error('Failed to load calendar:', err);
    }
}

async function loadVacations() {
    try {
        state.vacations = await API.get('/api/vacations');
        renderVacationsList();
    } catch (err) {
        console.error('Failed to load vacations:', err);
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
        const start = new Date(v.start_date);
        const end = new Date(v.end_date);
        const dateStr = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
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
                <div class="vacation-days">${v.days}d${v.hours > 0 ? ` / ${v.hours}h` : ''}</div>
                <button class="vacation-delete" onclick="deleteVacation(${v.id})" title="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
    });
    container.innerHTML = html;
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
    document.getElementById('btn-add-vacation').addEventListener('click', () => {
        document.getElementById('vacation-modal').classList.add('active');
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('vacation-start').value = today;
        document.getElementById('vacation-end').value = today;
    });
    document.getElementById('btn-close-vacation').addEventListener('click', closeVacationModal);
    document.getElementById('btn-cancel-vacation').addEventListener('click', closeVacationModal);
    document.getElementById('vacation-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('vacation-modal')) closeVacationModal();
    });
    document.getElementById('vacation-start').addEventListener('change', calcVacationDays);
    document.getElementById('vacation-end').addEventListener('change', calcVacationDays);
    document.getElementById('vacation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = {
            name: form.name.value,
            start_date: form.start_date.value,
            end_date: form.end_date.value,
            days: parseFloat(form.days.value) || 0,
            hours: parseFloat(form.hours.value) || 0
        };
        try {
            await API.post('/api/vacations', data);
            showToast('Vacation added!', 'success');
            closeVacationModal();
            loadVacations();
            loadDashboard();
            loadForecast();
        } catch (err) {
            showToast('Failed to add vacation', 'error');
        }
    });
}

function calcVacationDays() {
    const start = document.getElementById('vacation-start').value;
    const end = document.getElementById('vacation-end').value;
    if (!start || !end) return;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (endDate < startDate) {
        document.getElementById('vacation-days').value = 0;
        document.getElementById('vacation-preview').classList.remove('active');
        return;
    }
    let days = 0;
    const current = new Date(startDate);
    const holidays = ['2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-07-04','2026-09-07','2026-11-26','2026-12-25'];
    while (current <= endDate) {
        if (current.getDay() !== 0 && current.getDay() !== 6) {
            const dateStr = current.toISOString().split('T')[0];
            if (!holidays.includes(dateStr)) days += 0.5;
        }
        current.setDate(current.getDate() + 1);
    }
    days = Math.round(days * 2) / 2;
    document.getElementById('vacation-days').value = days;
    const preview = document.getElementById('vacation-preview');
    preview.textContent = `This trip will use ${days} PTO days`;
    preview.classList.add('active');
}

function closeVacationModal() {
    document.getElementById('vacation-modal').classList.remove('active');
    document.getElementById('vacation-form').reset();
    document.getElementById('vacation-preview').classList.remove('active');
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
        for (const [key, value] of Object.entries(form)) {
            if (value.type === 'checkbox') data[key] = value.checked;
            else if (value.type !== 'button') data[key] = value.value;
        }
        try {
            await API.put('/api/config', data);
            showToast('Settings saved!', 'success');
            closeSettings();
            loadDashboard();
            loadForecast();
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
        document.getElementById('pay-periods').value = config.pay_periods_per_year || 26;
        document.getElementById('accrual-method').value = config.accrual_method || 'full';
        document.getElementById('carryover-limit').value = config.pto_carryover_limit || 40;
        document.getElementById('accrual-start').value = config.accrual_start_date || new Date().toISOString().split('T')[0];
        document.getElementById('vesting').value = config.pto_vesting_schedule || 'immediate';
        document.getElementById('rollover').checked = config.pto_uses_rollover !== false;
        document.getElementById('lose-limit').checked = config.pto_lose_above_limit !== false;
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
    if (yearSelect) {
        yearSelect.value = state.currentYear;
        yearSelect.addEventListener('change', async (e) => {
            state.currentYear = parseInt(e.target.value);
            await loadForecast();
        });
    }
    try {
        const data = await API.get(`/api/balance?year=${state.currentYear}`);
        state.forecast = data.forecast || [];
        renderForecastChart();
        renderForecastTable();
    } catch (err) {
        console.error('Failed to load forecast:', err);
    }
}

function renderForecastChart() {
    const ctx = document.getElementById('forecast-chart');
    if (!ctx) return;
    if (state.forecastChart) state.forecastChart.destroy();
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
