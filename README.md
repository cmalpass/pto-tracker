# PTO Tracker

A modern web application to calculate, track, and forecast accrued Paid Time Off (PTO).

## Features

- Dashboard with PTO balance, accrued YTD, used YTD
- Monthly calendar with US holidays and vacation overlays
- Add/delete planned vacations with auto-calculated business days
- Chart.js forecast visualization with monthly breakdown
- Configurable accrual rates, pay periods, carryover limits

## Tech Stack

- **Backend:** Flask (Python) + SQLite
- **Frontend:** Vanilla HTML/CSS/JS + Chart.js
- **Testing:** Playwright

## Local Development

### Prerequisites

- Python 3.12+ (tested with Python 3.13)
- macOS, Linux, or Windows

### Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### Run The App

```bash
source .venv/bin/activate
python app.py
```

Default URL: `http://127.0.0.1:5000`

### macOS Port 5000 Conflict (AirPlay Receiver / Control Center)

On some macOS systems, port 5000 is already used by `ControlCenter`.
If you see `Address already in use`, run on port 5001:

```bash
source .venv/bin/activate
python -c "from app import app; app.run(debug=True, host='0.0.0.0', port=5001)"
```

Then open: `http://127.0.0.1:5001`

### Debugging In VS Code

1. Select the `.venv` interpreter.
2. Create a Python launch configuration that runs `app.py`.
3. Start debugging with breakpoints in `app.py`.

### Verify The App Is Running

```bash
curl -s http://127.0.0.1:5000/api/config
```

If running on 5001, use:

```bash
curl -s http://127.0.0.1:5001/api/config
```

## Running Tests

The test file uses Playwright and expects the app at `http://localhost:5000`.

Install browsers once:

```bash
source .venv/bin/activate
python -m playwright install
```

Run tests:

```bash
source .venv/bin/activate
python tests/test_app.py
```

If your app is running on port 5001, update `BASE_URL` in `tests/test_app.py` or run the app on 5000.

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```