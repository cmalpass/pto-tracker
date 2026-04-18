# PTO Tracker - Project Plan

## Project Overview
A modern web application to calculate, track, and forecast accrued Paid Time Off (PTO) based on calendars, US holidays, and planned vacations.

## Goals
1. Calculate accrued PTO based on configurable pay period rates
2. Track planned vacations and holidays
3. Forecast PTO balance for any date throughout the year
4. Modern, responsive UI with persistent storage
5. Full test coverage with Playwright
6. Deliver screenshots during development

## Architecture
- **Backend:** Flask (Python) + SQLite
- **Frontend:** Vanilla HTML/CSS/JS + Chart.js
- **Testing:** Playwright
- **Dependencies:** holidays library (US federal holidays)

## File Structure
```
pto-tracker/
├── app.py                    # Flask backend + PTO calculation engine
├── requirements.txt          # Python dependencies
├── PLAN.md                   # This file
├── templates/
│   └── index.html           # Main SPA template
├── static/
│   ├── css/
│   │   └── style.css        # Modern responsive styles
│   └── js/
│       └── app.js           # Frontend logic + API calls
├── tests/
│   └── test_app.py          # Playwright integration tests
├── instance/
│   └── pto_tracker.db       # SQLite database (auto-created)
└── venv/                    # Python virtual environment
```

## Task Breakdown

### Phase 1: Project Setup ✅
- [x] Create project directory and initialize git repo
- [x] Set up Python virtual environment
- [x] Install dependencies (Flask, Playwright, holidays, openpyxl)
- [x] Create .gitignore
- [x] Create requirements.txt

### Phase 2: Backend Core ✅
- [x] Create SQLite database schema (config, vacations, notes tables)
- [x] Implement PTO calculation engine
- [x] Implement REST API endpoints

### Phase 3: Frontend UI ✅
- [x] Create responsive HTML layout with 4 tabs
- [x] Modern CSS design
- [x] JavaScript application logic

### Phase 4: Bug Fixes ✅
- [x] Fix Chart.js rendering issue

### Phase 5: Testing ✅
- [x] Set up Playwright test infrastructure
- [x] Write integration tests: 7/7 passing
- [x] Fix DELETE test - now verifies full add+delete cycle end-to-end

### Phase 6: Final Polish ✅
- [x] Fix all remaining UI bugs
- [x] Take final screenshots of all features (7 screenshots)
- [x] Final git commit with all tests passing

## API Documentation

### GET /api/config
Returns current configuration.

### PUT /api/config
Update configuration. Accepts JSON object with config keys.

### GET /api/balance/<date>
Returns PTO balance for a specific date (YYYY-MM-DD).

### GET /api/balance?year=2026
Returns yearly forecast array with monthly data.

### GET /api/forecast/<date>
Returns forecast for a specific date.

### GET /api/vacations
Returns list of all vacations.

### POST /api/vacations
Add a new vacation. Accepts: `{name, start_date, end_date, days, hours}`.

### DELETE /api/vacations/<id>
Delete a vacation by ID.

### GET /api/calendar/<year>/<month>
Returns calendar events for a specific month.

### GET /api/stats
Returns dashboard statistics.
