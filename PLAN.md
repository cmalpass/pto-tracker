# PTO Tracker - Project Plan

PTO Tracker is a browser-native application for calculating, tracking, and
forecasting paid time off. The current layer keeps user context in the browser
profile and leaves server accounts, sync, and database persistence out of scope.

## Architecture

- **Static server:** Flask serves the app shell and static assets only.
- **Storage:** `static/js/store.js` provides versioned asynchronous IndexedDB
  persistence with a localStorage fallback for `config`, typed `vacations`, and `notes`.
- **Business logic:** `static/js/pto.js` contains pure date, holiday, accrual,
  carryover, vesting, conflict, forecast, suggestion, and heatmap calculations.
- **UI:** `static/js/app.js` renders the existing vanilla HTML/CSS interface and
  writes only through the browser store.
- **Testing:** Node's built-in test runner covers the calculation layer and
  Playwright covers static-app browser behavior.

## Data contract

All stored dates use canonical `YYYY-MM-DD` strings. Vacation records use a normalized
leave type and quarter-hour `hours` amounts alongside `days`. JSON backups include a
`schemaVersion` field and contain the complete config, typed vacation, and notes state;
schema versions 1 and 2 migrate records to the default `vacation` type.
CSV and Excel-compatible downloads are generated in the browser from the same
state.

## Future layers

Keep future features on top of the browser store and pure calculation modules.
Cross-device sync, accounts, server subscriptions, and server-side reminders are
intentionally separate product decisions.
