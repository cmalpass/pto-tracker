---
name: pto-tracker-local-dev
description: Run, debug, and troubleshoot the PTO Tracker Flask app locally.
---

# PTO Tracker Local Dev Skill

Use this skill when you need to run or debug the PTO Tracker application in this repository.

## Quick Start

1. `python3 -m venv .venv`
2. `source .venv/bin/activate`
3. `python -m pip install -r requirements.txt`
4. `python app.py`

## If Port 5000 Is Busy On macOS

Run on port 5001:

`python -c "from app import app; app.run(debug=True, host='0.0.0.0', port=5001)"`

## Health Check

- Default: `curl -s http://127.0.0.1:5000/api/config`
- Alternate: `curl -s http://127.0.0.1:5001/api/config`

## Test Reminder

`tests/test_app.py` expects `BASE_URL = "http://localhost:5000"`.
