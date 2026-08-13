# PTO Tracker

A browser-native PTO calculator, planner, and forecast tool. Your configuration,
vacations, and notes stay in the current browser profile; there are no accounts,
server-side database, sync, or authentication features.

## Features

- Dashboard with PTO balance, accrual, used YTD, and scheduled PTO
- Monthly calendar with holidays and vacation overlays
- Accrual, carryover, vesting, holiday, conflict, forecast, suggestion, and heatmap calculations
- Configurable accrual policy and IANA timezone
- IndexedDB persistence with a localStorage fallback
- Safe soft-delete with undo and retained client-side change history
- Versioned JSON backup/restore plus client-side CSV, ICS, and Excel-compatible exports
- Browser-local CSV/ICS vacation import with validation, duplicate detection, and confirmation preview
- Vacation, sick, personal, and holiday leave types with accessible labels/icons and per-type dashboard totals
- Quarter-hour and partial-day bookings validated against the configured hours per day

## Architecture

Flask is retained as a small static app server for local development and deployment.
The browser loads `static/js/store.js`, a versioned asynchronous storage wrapper, and
`static/js/pto.js`, the pure client-side calculation engine. No user data is sent to
Flask. Storage persistence is requested through the browser Storage API when the app
first loads.

The UI entry point is the native ES module `static/js/app.js`. It coordinates modules
for browser state, DOM-safe rendering, calendar data, vacations, suggestions, forecasts,
and settings without a frontend framework or build step. Renderers construct DOM nodes
and assign user/imported values with `textContent` or safe attributes; intentional SVG
icons are created from fixed element definitions.

Dates are stored and exported as canonical `YYYY-MM-DD` strings. Vacation records include
a normalized leave type plus `days` and quarter-hour `hours`; older records migrate to the
default `vacation` type. The configured IANA timezone controls the browser-local current
date and year boundaries without converting stored date values.

ICS vacation exports use all-day `VALUE=DATE` events and stable UIDs, with leave type and
partial-day metadata in portable `X-PTO-*` properties. Calendar exchange and CSV import
happen entirely in the browser; there is no subscription URL, sync service, authentication,
or external calendar API. JSON backup/restore remains a separate full-data operation.

**Backup note:** browser profile storage is device-specific and can be lost when site
data is cleared or evicted. Use Export JSON regularly, especially before clearing
browser data or changing devices.

## Local Development

### Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

### Run the static app

```bash
source .venv/bin/activate
python app.py
```

Open `http://127.0.0.1:5000`. If macOS has port 5000 occupied, run:

```bash
python -c "from app import app; app.run(debug=False, host='127.0.0.1', port=5001)"
```

### Tests

Install the Python dependencies and Playwright Chromium once:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Run all Node client checks (calculation, storage, transfer, notifications, and planning):

```bash
npm test
```

With the app running at port 5000, run the Playwright browser checks:

```bash
python tests/test_app.py
```

The pull request workflow runs `npm test` without a server or database, then starts
the Flask static app server only for the Playwright checks. Browser fixtures clear
both localStorage and IndexedDB between tests, and fixed-date client scenarios use
canonical UTC dates so timezone and year-boundary behavior stays reproducible.

## Docker

```bash
docker compose up --build
```
