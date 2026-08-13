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
- Versioned JSON backup/restore plus client-side CSV and Excel-compatible exports

## Architecture

Flask is retained as a small static app server for local development and deployment.
The browser loads `static/js/store.js`, a versioned asynchronous storage wrapper, and
`static/js/pto.js`, the pure client-side calculation engine. No user data is sent to
Flask. Storage persistence is requested through the browser Storage API when the app
first loads.

Dates are stored and exported as canonical `YYYY-MM-DD` strings. The configured IANA
timezone controls the browser-local current date and year boundaries without converting
stored date values.

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

Install Playwright browsers once:

```bash
python -m playwright install
```

Run the client calculation checks:

```bash
node --test tests/client.test.js
```

With the app running at port 5000, run the browser checks:

```bash
python tests/test_app.py
```

## Docker

```bash
docker compose up --build
```
