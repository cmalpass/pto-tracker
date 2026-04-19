# Copilot Instructions For PTO Tracker

## Project Context

- Stack: Flask backend, SQLite persistence, vanilla JS frontend.
- Main server entry point: `app.py`.
- Templates: `templates/index.html`.
- Static assets: `static/css/style.css`, `static/js/app.js`.
- Tests: `tests/test_app.py` (Playwright-style browser checks).

## Local Commands

- Create venv: `python3 -m venv .venv`
- Activate venv: `source .venv/bin/activate`
- Install dependencies: `python -m pip install -r requirements.txt`
- Run app (default): `python app.py`
- Run app on alternate port: `python -c "from app import app; app.run(debug=True, host='0.0.0.0', port=5001)"`

## Known Local Environment Note (macOS)

- Port 5000 may be occupied by macOS `ControlCenter` (AirPlay Receiver behavior).
- If port 5000 is unavailable, run the app on port 5001 for local debugging.

## Testing Notes

- Tests currently use `BASE_URL = "http://localhost:5000"` in `tests/test_app.py`.
- If app runs on 5001, update `BASE_URL` temporarily or run server on 5000.

## Editing Guidance

- Keep API response shapes backward compatible for frontend calls in `static/js/app.js`.
- Preserve SQLite schema compatibility in `init_db()` unless a migration path is added.
- Keep frontend changes minimal and focused unless explicitly requested.
