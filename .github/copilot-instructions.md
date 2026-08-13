# Copilot Instructions For PTO Tracker

## Project Context

- Stack: Flask static app server, browser-local IndexedDB/localStorage persistence, vanilla JS frontend.
- Main server entry point: `app.py`.
- Templates: `templates/index.html`.
- Static assets: `static/css/style.css`, `static/js/app.js`, `static/js/main.js`, and native ES modules under `static/js/modules/`.
- Tests: `tests/test_app.py` (Playwright-style browser checks).

All PTO data and calculations live in the browser. Flask serves the application
shell and static assets only; persistence is handled by the browser storage
adapter.

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

- Preserve browser backup schema compatibility in `static/js/store.js` unless a migration path is added.
- Keep the no-build-step, browser-native frontend architecture intact.
- Keep frontend changes minimal and focused unless explicitly requested.
