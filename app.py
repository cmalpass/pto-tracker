"""PTO Tracker - Paid Time Off Calculator & Forecaster"""
import os
import json
import sqlite3
import math
import calendar
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, render_template, g
import holidays

app = Flask(__name__)
DATABASE = os.path.join(os.path.dirname(__file__), 'instance', 'pto_tracker.db')


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA journal_mode=WAL')
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    os.makedirs(os.path.dirname(DATABASE), exist_ok=True)
    conn = sqlite3.connect(DATABASE)
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vacations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            days REAL NOT NULL,
            hours REAL NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    defaults = {
        'pto_accrual_per_pay_period': '1.0',
        'pto_accrual_type': 'days',
        'pay_periods_per_year': '26',
        'accrual_start_date': '2026-01-01',
        'accrual_method': 'pro-rata',
        'pto_carryover_limit': '40',
        'pto_uses_rollover': 'true',
        'pto_cashout_rate': '0',
        'pto_lose_above_limit': 'true',
        'pto_start_year': str(datetime.now().year),
        'pto_vesting_schedule': 'immediate',
        'pto_grace_period_days': '0',
    }
    for key, value in defaults.items():
        conn.execute('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)',
                     (key, value))
    conn.commit()
    conn.close()


def get_config():
    db = get_db()
    rows = db.execute('SELECT key, value FROM config').fetchall()
    config = {}
    for row in rows:
        key = row['key']
        value = row['value']
        if key in ('pto_accrual_per_pay_period', 'pay_periods_per_year',
                    'pto_carryover_limit', 'pto_grace_period_days'):
            config[key] = float(value)
        elif key in ('pto_uses_rollover', 'pto_lose_above_limit'):
            config[key] = value.lower() == 'true'
        elif key in ('pto_cashout_rate',):
            config[key] = float(value)
        else:
            config[key] = value
    return config


def get_us_holidays(year):
    return holidays.US(years=year, observed=True)


def is_business_day(date):
    return date.weekday() < 5


def get_vacation_days(start_date, end_date, config):
    start = datetime.strptime(start_date, '%Y-%m-%d').date()
    end = datetime.strptime(end_date, '%Y-%m-%d').date()
    holidays_set = get_us_holidays(start.year)
    if start.year != end.year:
        holidays_set.update(get_us_holidays(end.year))
    days = 0
    current = start
    while current <= end:
        if is_business_day(current) and current not in holidays_set:
            days += 1
        current += timedelta(days=1)
    return days


def calculate_accrual_to_date(target_date, config):
    accrual_start = datetime.strptime(config['accrual_start_date'], '%Y-%m-%d').date()
    target = datetime.strptime(target_date, '%Y-%m-%d').date()
    if target < accrual_start:
        return 0.0
    pay_period_days = 365.25 / config['pay_periods_per_year']
    days_elapsed = (target - accrual_start).days
    if config['accrual_method'] == 'pro-rata':
        business_days_worked = 0
        current = accrual_start
        holidays_set = set()
        for y in range(accrual_start.year, target.year + 1):
            holidays_set.update(get_us_holidays(y))
        while current <= target:
            if is_business_day(current) and current not in holidays_set:
                business_days_worked += 1
            current += timedelta(days=1)
        accrual_per_day = config['pto_accrual_per_pay_period'] / (pay_period_days * 5 / 7)
        accrued = business_days_worked * accrual_per_day
    else:
        pay_periods_elapsed = days_elapsed / pay_period_days
        accrued = pay_periods_elapsed * config['pto_accrual_per_pay_period']
    return accrued


def calculate_vacation_usage(target_date, config):
    db = get_db()
    target = datetime.strptime(target_date, '%Y-%m-%d').date()
    rows = db.execute(
        'SELECT start_date, end_date, days, hours FROM vacations '
        'WHERE end_date <= ? ORDER BY start_date',
        (target_date,)
    ).fetchall()
    total_days = 0
    total_hours = 0
    for row in rows:
        total_days += row['days']
        total_hours += row['hours']
    return total_days, total_hours


def calculate_balance_on_date(target_date, config):
    accrued = calculate_accrual_to_date(target_date, config)
    used_days, used_hours = calculate_vacation_usage(target_date, config)
    balance_days = accrued - used_days
    if config['pto_lose_above_limit'] and balance_days > config['pto_carryover_limit']:
        balance_days = config['pto_carryover_limit']
    if balance_days < 0:
        balance_days = 0
    return {
        'accrued': round(accrued, 2),
        'used': round(used_days, 2),
        'balance': round(balance_days, 2),
        'limit': config['pto_carryover_limit']
    }


def generate_yearly_forecast(year, config):
    forecast = []
    for month in range(1, 13):
        if month == 12:
            end_date = datetime(year, 12, 31)
        else:
            end_date = datetime(year, month + 1, 1) - timedelta(days=1)
        balance = calculate_balance_on_date(end_date.strftime('%Y-%m-%d'), config)
        balance['month'] = end_date.strftime('%Y-%m')
        balance['month_name'] = end_date.strftime('%B')
        forecast.append(balance)
    return forecast


def generate_calendar_events(year, config):
    events = []
    us_holidays = get_us_holidays(year)
    for date, name in sorted(us_holidays.items()):
        events.append({
            'date': date.strftime('%Y-%m-%d'),
            'type': 'holiday',
            'name': name,
            'color': '#e74c3c'
        })
    db = get_db()
    rows = db.execute(
        'SELECT * FROM vacations WHERE start_date LIKE ? OR end_date LIKE ?',
        (f'{year}%', f'{year}%')
    ).fetchall()
    for row in rows:
        start = datetime.strptime(row['start_date'], '%Y-%m-%d').date()
        end = datetime.strptime(row['end_date'], '%Y-%m-%d').date()
        for i in range((end - start).days + 1):
            day = start + timedelta(days=i)
            if day.year == year:
                events.append({
                    'date': day.strftime('%Y-%m-%d'),
                    'type': 'vacation',
                    'name': row['name'],
                    'color': '#3498db',
                    'vacation_id': row['id']
                })
    events.sort(key=lambda x: x['date'])
    return events


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/config', methods=['GET'])
def api_get_config():
    return jsonify(get_config())


@app.route('/api/config', methods=['PUT'])
def api_update_config():
    data = request.get_json()
    db = get_db()
    for key, value in data.items():
        if key.startswith('pto_') or key.startswith('accrual') or key == 'pay_periods_per_year':
            if isinstance(value, bool):
                db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
                          (key, str(value).lower()))
            else:
                db.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
                          (key, str(value)))
    db.commit()
    return jsonify({'status': 'ok', 'config': get_config()})


@app.route('/api/balance/<date>', methods=['GET'])
def api_get_balance(date):
    config = get_config()
    balance = calculate_balance_on_date(date, config)
    return jsonify({'date': date, **balance})


@app.route('/api/balance', methods=['GET'])
def api_get_balance_range():
    year = request.args.get('year', str(datetime.now().year), type=int)
    config = get_config()
    forecast = generate_yearly_forecast(year, config)
    return jsonify({'year': year, 'forecast': forecast})


@app.route('/api/forecast/<date>', methods=['GET'])
def api_get_forecast(date):
    config = get_config()
    balance = calculate_balance_on_date(date, config)
    return jsonify({'date': date, **balance})


@app.route('/api/vacations', methods=['GET'])
def api_get_vacations():
    db = get_db()
    rows = db.execute('SELECT * FROM vacations ORDER BY start_date').fetchall()
    return jsonify([dict(row) for row in rows])


@app.route('/api/vacations', methods=['POST'])
def api_add_vacation():
    data = request.get_json()
    db = get_db()
    name = data.get('name', 'Vacation')
    start_date = data.get('start_date')
    end_date = data.get('end_date')
    if 'days' not in data:
        days = get_vacation_days(start_date, end_date, get_config())
    else:
        days = data.get('days', 0)
    hours = data.get('hours', 0)
    cursor = db.execute(
        'INSERT INTO vacations (name, start_date, end_date, days, hours) VALUES (?, ?, ?, ?, ?)',
        (name, start_date, end_date, days, hours)
    )
    db.commit()
    row = db.execute('SELECT * FROM vacations WHERE id = ?', (cursor.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route('/api/vacations/<int:vacation_id>', methods=['DELETE'])
def api_delete_vacation(vacation_id):
    db = get_db()
    db.execute('DELETE FROM vacations WHERE id = ?', (vacation_id,))
    db.commit()
    return jsonify({'status': 'deleted'})


@app.route('/api/calendar/<int:year>', methods=['GET'])
def api_get_calendar(year):
    config = get_config()
    events = generate_calendar_events(year, config)
    return jsonify({'year': year, 'events': events})


@app.route('/api/calendar/<int:year>/<int:month>', methods=['GET'])
def api_get_month_calendar(year, month):
    config = get_config()
    events = []
    us_holidays = get_us_holidays(year)
    for date, name in us_holidays.items():
        if date.month == month:
            events.append({
                'date': date.strftime('%Y-%m-%d'),
                'type': 'holiday',
                'name': name,
                'color': '#e74c3c'
            })
    db = get_db()
    last_day = calendar.monthrange(year, month)[1]
    rows = db.execute(
        'SELECT * FROM vacations WHERE start_date <= ? AND end_date >= ?',
        (f'{year}-{month:02d}-{last_day:02d}', f'{year}-{month:02d}-01')
    ).fetchall()
    for row in rows:
        start = datetime.strptime(row['start_date'], '%Y-%m-%d').date()
        end = datetime.strptime(row['end_date'], '%Y-%m-%d').date()
        month_start = datetime(year, month, 1).date()
        if month == 12:
            month_end = datetime(year, 12, 31).date()
        else:
            month_end = datetime(year, month + 1, 1).date() - timedelta(days=1)
        if start <= month_end and end >= month_start:
            events.append({
                'date': row['start_date'],
                'type': 'vacation',
                'name': row['name'],
                'color': '#3498db',
                'vacation_id': row['id']
            })
    events.sort(key=lambda x: x['date'])
    return jsonify({'year': year, 'month': month, 'events': events})


@app.route('/api/stats', methods=['GET'])
def api_get_stats():
    config = get_config()
    today = datetime.now().date().strftime('%Y-%m-%d')
    balance = calculate_balance_on_date(today, config)
    forecast = generate_yearly_forecast(datetime.now().year, config)
    db = get_db()
    vacations = db.execute('SELECT * FROM vacations ORDER BY start_date').fetchall()
    year_end = datetime(datetime.now().year, 12, 31).date()
    remaining_vacations = 0
    for v in vacations:
        end = datetime.strptime(v['end_date'], '%Y-%m-%d').date()
        if end <= year_end and end >= datetime.now().date():
            remaining_vacations += v['days']
    return jsonify({
        'today': today,
        'current_balance': balance,
        'yearly_forecast': forecast,
        'upcoming_vacations': len([v for v in vacations if datetime.strptime(v['end_date'], '%Y-%m-%d').date() >= datetime.now().date()]),
        'remaining_vacation_days': remaining_vacations,
        'total_vacations': len(vacations)
    })


with app.app_context():
    init_db()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
