"""Browser integration tests for the static, browser-native PTO Tracker."""

import asyncio
import json
import os

from playwright.async_api import async_playwright


BASE_URL = os.environ.get("PTO_TEST_BASE_URL", "http://localhost:5000")


async def new_page(browser):
    context = await browser.new_context()
    await context.add_init_script(
        "localStorage.clear(); indexedDB.deleteDatabase('pto-tracker');"
    )
    return context, await context.new_page()


async def open_app(page):
    await page.goto(BASE_URL)
    await page.wait_for_selector("#current-balance")
    await page.wait_for_function("() => Boolean(window.PTOStore && window.PTO)")


async def test_dashboard_and_forecast(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        assert await page.locator("h1:has-text('PTO Tracker')").is_visible()
        assert await page.locator("#stat-accrued-ytd").is_visible()
        await page.click("button:has-text('Forecast')")
        await page.wait_for_selector(".forecast-table tbody tr")
        assert await page.locator(".forecast-table tbody tr").count() == 12
    finally:
        await context.close()


async def test_smart_notifications_generate_and_link_to_actions(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        upcoming = await page.evaluate(
            """() => {
                const today = PTO.getLocalToday(PTOStore.getConfig());
                const [year, month, day] = today.split('-').map(Number);
                return new Date(Date.UTC(year, month - 1, day + 3))
                    .toISOString().slice(0, 10);
            }"""
        )
        await page.click("button:has-text('Vacations')")
        await page.click("#btn-add-vacation")
        await page.fill("input[name='name']", "Reminder Trip")
        await page.fill("input[name='start_date']", upcoming)
        await page.fill("input[name='end_date']", upcoming)
        await page.locator("#vacation-form").evaluate("(form) => form.requestSubmit()")
        await page.wait_for_selector(".vacation-name:has-text('Reminder Trip')")
        await page.wait_for_selector("#notification-count:not([hidden])")
        assert await page.locator("#notification-count").inner_text()
        await page.click("#btn-notifications")
        assert await page.locator("#notification-list").get_by_text("Reminder Trip").is_visible()
        await page.locator(".notification-action").filter(has_text="Review vacations").first.click()
        assert await page.locator("#tab-vacations-tab").get_attribute("aria-selected") == "true"
        assert upcoming
    finally:
        await context.close()


async def test_smart_notification_dismissal_persists_and_changed_fingerprint_reappears(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        upcoming = await page.evaluate(
            """() => {
                const today = PTO.getLocalToday(PTOStore.getConfig());
                const [year, month, day] = today.split('-').map(Number);
                return new Date(Date.UTC(year, month - 1, day + 2))
                    .toISOString().slice(0, 10);
            }"""
        )
        await page.click("button:has-text('Vacations')")
        await page.click("#btn-add-vacation")
        await page.fill("input[name='name']", "Dismiss Me")
        await page.select_option("#vacation-type", "personal")
        await page.fill("input[name='start_date']", upcoming)
        await page.fill("input[name='end_date']", upcoming)
        await page.locator("#vacation-form").evaluate("(form) => form.requestSubmit()")
        await page.wait_for_selector("#notification-list", state="attached")
        await page.click("#btn-notifications")
        item = page.locator(".notification-item").filter(has_text="Dismiss Me")
        await item.locator(".notification-dismiss").click()
        assert not await page.locator("#notification-list .notification-item").filter(
            has_text="Dismiss Me"
        ).is_visible()
        dismissed = await page.evaluate(
            "() => localStorage.getItem('pto-tracker:notifications:dismissed:v1')"
        )
        assert "pto-upcoming-vacation-" in dismissed
        await page.click("#tab-dashboard-tab")
        await page.click("#tab-vacations-tab")
        await page.wait_for_selector("#notification-list", state="attached")
        assert not await page.locator("#notification-list .notification-item").filter(
            has_text="Dismiss Me"
        ).is_visible()
        await page.locator(".vacation-edit").click()
        await page.uncheck("#vacation-auto-days")
        await page.fill("input[name='hours']", "2")
        await page.locator("#vacation-form").evaluate("(form) => form.requestSubmit()")
        await page.wait_for_selector("#notification-list", state="attached")
        await page.click("#btn-notifications")
        assert await page.locator("#notification-list .notification-item").filter(
            has_text="Dismiss Me"
        ).is_visible()
    finally:
        await context.close()


async def test_smart_notifications_cover_forfeiture_and_low_balance(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        base = await page.evaluate("() => PTOStore.getConfig()")
        await page.evaluate(
            """async (base) => {
                await PTOStore.putConfig({
                    ...base,
                    pto_accrual_per_pay_period: 2,
                    pto_carryover_limit: 1,
                    pto_lose_above_limit: true,
                    pto_uses_rollover: true
                });
            }""",
            base,
        )
        await page.click("button:has-text('Vacations')")
        await page.click("#btn-add-vacation")
        await page.fill("input[name='name']", "Forfeiture refresh")
        await page.uncheck("#vacation-auto-days")
        await page.fill("input[name='hours']", "2")
        await page.locator("#vacation-form").evaluate("(form) => form.requestSubmit()")
        await page.wait_for_selector("#notification-count:not([hidden])")
        await page.click("#btn-notifications")
        assert await page.locator("#notification-list").get_by_text(
            "Projected PTO forfeiture"
        ).is_visible()
        await page.evaluate(
            """async () => {
                const config = await PTOStore.getConfig();
                await PTOStore.putConfig({
                    ...config,
                    pto_accrual_per_pay_period: 0.25,
                    pto_carryover_limit: 40,
                    pto_lose_above_limit: true,
                    pto_uses_rollover: true
                });
            }"""
        )
        await page.click("#btn-add-vacation")
        await page.fill("input[name='name']", "Low balance refresh")
        refresh_date = await page.evaluate(
            """() => {
                const today = PTO.getLocalToday({ timezone: 'UTC' });
                const [year, month, day] = today.split('-').map(Number);
                return new Date(Date.UTC(year, month - 1, day + 1))
                    .toISOString().slice(0, 10);
            }"""
        )
        await page.fill("input[name='start_date']", refresh_date)
        await page.fill("input[name='end_date']", refresh_date)
        await page.uncheck("#vacation-auto-days")
        await page.fill("input[name='hours']", "2")
        await page.locator("#vacation-form").evaluate("(form) => form.requestSubmit()")
        if await page.locator("#notification-panel").get_attribute("hidden") is not None:
            await page.click("#btn-notifications")
        assert await page.locator("#notification-list").get_by_text(
            "PTO balance is running low"
        ).is_visible()
    finally:
        await context.close()


async def test_smart_notifications_empty_state(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await page.click("#btn-notifications")
        assert await page.locator("#notification-list").get_by_text(
            "You are all caught up."
        ).is_visible()
        assert await page.locator("#notification-count").is_hidden()
        assert await page.locator("#dashboard-notification-alert").is_hidden()
    finally:
        await context.close()


async def test_vacation_persists_and_deletes(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await page.click("button:has-text('Vacations')")
        await page.click("#btn-add-vacation")
        await page.fill("input[name='name']", "Browser Trip")
        await page.fill("input[name='start_date']", "2026-08-03")
        await page.fill("input[name='end_date']", "2026-08-05")
        await page.locator("#vacation-form").evaluate("(form) => form.requestSubmit()")
        await page.wait_for_selector("text=Browser Trip")
        assert await page.locator("text=Browser Trip").count() == 1
        page.on("dialog", lambda dialog: dialog.accept())
        await page.locator(".vacation-delete").click()
        await page.wait_for_timeout(100)
        assert await page.locator("text=Browser Trip").count() == 0
        assert await page.evaluate(
            "() => PTOStore.listVacations().then(items => items.length)"
        ) == 0
        assert await page.evaluate(
            "() => PTOStore.list('vacations', {includeDeleted: true}).then(items => items.length)"
        ) == 1
        await page.locator(".toast-action").click()
        await page.wait_for_selector("text=Browser Trip")
    finally:
        await context.close()


async def test_leave_types_and_partial_day_validation(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await page.click("button:has-text('Vacations')")
        await page.click("#btn-add-vacation")
        await page.fill("input[name='name']", "Sick appointment")
        await page.select_option("#vacation-type", "sick")
        await page.fill("input[name='start_date']", "2026-12-01")
        await page.fill("input[name='end_date']", "2026-12-01")
        await page.uncheck("#vacation-auto-days")
        await page.fill("input[name='hours']", "4")
        await page.locator("#vacation-form").evaluate("(form) => form.requestSubmit()")
        await page.wait_for_selector("text=Sick appointment")
        assert await page.locator(".leave-type-sick").count() >= 1
        stored = await page.evaluate(
            "() => PTOStore.listVacations().then(items => items[0])"
        )
        assert stored["type"] == "sick"
        assert float(stored["hours"]) == 4
        assert float(stored["days"]) == 0
        assert await page.locator("#type-breakdown .type-breakdown-row.leave-type-sick").count() == 1

        await page.click("#btn-add-vacation")
        await page.fill("input[name='name']", "Invalid partial booking")
        await page.fill("input[name='start_date']", "2026-12-02")
        await page.fill("input[name='end_date']", "2026-12-02")
        await page.uncheck("#vacation-auto-days")
        await page.fill("input[name='hours']", "8.25")
        await page.locator("#vacation-form").evaluate("(form) => form.requestSubmit()")
        await page.wait_for_selector("#toast.show")
        assert "cannot exceed" in (await page.locator("#toast").text_content()).lower()
        assert await page.evaluate(
            "() => PTOStore.listVacations().then(items => items.length)"
        ) == 1
    finally:
        await context.close()


async def test_legacy_browser_backup_migrates_leave_type(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        migrated = await page.evaluate(
            """async () => {
                await PTOStore.importJSON({
                    schemaVersion: 2,
                    data: {
                        config: null,
                        vacations: [{
                            id: 7,
                            name: 'Legacy vacation',
                            start_date: '2026-12-03',
                            end_date: '2026-12-03',
                            days: 1,
                            hours: 0
                        }],
                        notes: []
                    }
                });
                return (await PTOStore.listVacations())[0];
            }"""
        )
        assert migrated["type"] == "vacation"
        assert await page.evaluate("() => PTOStore.DB_VERSION == 3")
    finally:
        await context.close()


async def test_notes_and_json_backup(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await page.click("button:has-text('Forecast')")
        await page.fill("#note-text", "Keep a backup")
        await page.click("#note-form button[type='submit']")
        await page.wait_for_selector("text=Keep a backup")
        assert await page.locator("text=Keep a backup").is_visible()
        page.once("dialog", lambda dialog: dialog.accept())
        await page.locator(".note-delete").click()
        await page.wait_for_timeout(100)
        assert not await page.locator("text=Keep a backup").is_visible()
        await page.locator(".toast-action").click()
        await page.wait_for_selector("text=Keep a backup")
        assert await page.locator("#export-json").is_visible()
        assert await page.locator("#import-json").is_visible()
    finally:
        await context.close()


async def test_vacation_calendar_export_and_import_preview(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await page.evaluate(
            """async () => {
                await PTOStore.putVacation({
                    name: 'Existing Trip',
                    start_date: '2026-08-03',
                    end_date: '2026-08-03',
                    days: 1,
                    hours: 0
                });
            }"""
        )
        await page.click("button:has-text('Vacations')")
        await page.wait_for_selector("text=Existing Trip")

        async with page.expect_download() as download_info:
            await page.click("#btn-export-ics")
        download = await download_info.value
        assert download.suggested_filename.endswith(".ics")
        ics_path = await download.path()
        with open(ics_path, encoding="utf-8") as exported:
            ics = exported.read()
        assert "DTSTART;VALUE=DATE:20260803" in ics
        assert "DTEND;VALUE=DATE:20260804" in ics

        csv = (
            "Name,Start Date,End Date,Days,Hours\r\n"
            "Imported Trip,2026-09-01,2026-09-02,2,0\r\n"
            "Existing Trip,2026-08-03,2026-08-03,1,0\r\n"
            "Broken Trip,not-a-date,2026-09-03,1,0\r\n"
        )
        await page.click("#btn-import-vacations")
        await page.locator("#vacation-import-file").set_input_files({
            "name": "vacations.csv",
            "mimeType": "text/csv",
            "buffer": csv.encode()
        })
        await page.wait_for_selector("#vacation-import-modal.active")
        assert "1 valid" in await page.locator("#vacation-import-summary").text_content()
        assert "1 duplicate" in await page.locator("#vacation-import-summary").text_content()
        assert await page.locator("#btn-confirm-vacation-import").get_attribute("disabled") is None
        page.once("dialog", lambda dialog: dialog.accept())
        await page.click("#btn-confirm-vacation-import")
        await page.wait_for_selector("text=Imported Trip")
        assert await page.evaluate(
            "() => PTOStore.listVacations().then(items => items.length)"
        ) == 2
    finally:
        await context.close()


async def test_settings_stay_local(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await page.click("#btn-settings")
        await page.fill("input[name='pto_accrual_per_pay_period']", "2")
        await page.click("button:has-text('Save Settings')")
        await page.wait_for_timeout(100)
        stored = await page.evaluate(
            "() => PTOStore.getConfig().then(config => config.pto_accrual_per_pay_period)"
        )
        assert float(stored) == 2
    finally:
        await context.close()


async def test_accessibility_semantics_and_keyboard_controls(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        tabs = page.locator("[role='tab']")
        assert await tabs.count() == 5
        await tabs.nth(0).focus()
        await page.keyboard.press("ArrowRight")
        assert await page.locator("#tab-calendar-tab").get_attribute("aria-selected") == "true"
        assert await page.locator("#tab-calendar").is_visible()
        await page.wait_for_selector(".cal-day[data-date]")
        assert await page.locator(".cal-day[data-date]").first.get_attribute("aria-label")
        await page.locator("#cal-prev-month").focus()
        await page.click("#btn-settings")
        settings = page.locator("#settings-modal")
        assert await settings.get_attribute("role") == "dialog"
        assert await settings.get_attribute("aria-modal") == "true"
        assert await page.locator("#policy-preset").evaluate("(node) => node === document.activeElement")
        await page.keyboard.press("Escape")
        assert not await settings.is_visible()
        assert await page.locator("#btn-settings").evaluate("(node) => node === document.activeElement")
        await page.click("#tab-vacations-tab")
        await page.click("#btn-add-vacation")
        vacation_dialog = page.locator("#vacation-modal")
        assert await vacation_dialog.get_attribute("role") == "dialog"
        await page.locator("#btn-submit-vacation").focus()
        await page.keyboard.press("Tab")
        assert await page.locator("#btn-close-vacation").evaluate("(node) => node === document.activeElement")
        await page.keyboard.press("Escape")
        assert not await vacation_dialog.is_visible()
        assert await page.locator("#btn-add-vacation").evaluate("(node) => node === document.activeElement")
        await page.click("#tab-heatmap-tab")
        await page.wait_for_selector(".heatmap-cell")
        assert "Color intensity" in await page.locator("#heatmap-legend").text_content()
        assert await page.locator(".heatmap-cell").first.get_attribute("aria-label")
    finally:
        await context.close()


async def test_mobile_layout_and_touch_targets(browser):
    context = await browser.new_context(viewport={"width": 320, "height": 844})
    await context.add_init_script(
        "localStorage.clear(); indexedDB.deleteDatabase('pto-tracker');"
    )
    page = await context.new_page()
    try:
        await open_app(page)
        nav = page.locator("#pto-tabs")
        assert await nav.evaluate("(node) => getComputedStyle(node).position") == "fixed"
        assert await nav.evaluate(
            "(node) => node.getBoundingClientRect().bottom >= window.innerHeight - 1"
        )
        assert await page.locator(".nav-tab").evaluate_all(
            "(nodes) => nodes.every(node => node.getBoundingClientRect().height >= 44)"
        )

        await page.click("#tab-calendar-tab")
        await page.wait_for_selector(".cal-day[data-date]")
        assert await page.locator(".cal-day[data-date]").evaluate_all(
            "(nodes) => nodes.every(node => node.getBoundingClientRect().height >= 44)"
        )
        await page.locator(".cal-day[data-date]").first.click()
        vacation_dialog = page.locator("#vacation-modal")
        assert await vacation_dialog.is_visible()
        assert await vacation_dialog.locator(".modal").evaluate(
            "(node) => node.getBoundingClientRect().width <= window.innerWidth"
        )
        await page.keyboard.press("Escape")
    finally:
        await context.close()


async def test_module_loading_and_browser_value_escaping(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        assert await page.locator("script[type='module'][src*='/static/js/app.js']").count() == 1
        asset_versions = await page.locator(
            "link[href*='?v='], script[src*='?v=']"
        ).evaluate_all(
            "(nodes) => nodes.map(node => new URL(node.href || node.src).searchParams.get('v'))"
        )
        assert len(set(asset_versions)) == 1
        vacation_name = "<img src=x onerror=window.__xss=1> Imported"
        note_text = "<svg onload=window.__xss=2> private note"
        payload = {
            "schemaVersion": 1,
            "data": {
                "config": None,
                "vacations": [{
                    "id": 7,
                    "name": vacation_name,
                    "start_date": "2026-08-03",
                    "end_date": "2026-08-03",
                    "days": 1,
                    "hours": 0,
                }],
                "notes": [{"id": 8, "date": "2026-08-03", "text": note_text}],
            },
        }
        await page.click("button:has-text('Forecast')")
        page.once("dialog", lambda dialog: dialog.accept())
        await page.click("#import-json")
        await page.locator("input[accept='application/json,.json']").set_input_files({
            "name": "unsafe-backup.json",
            "mimeType": "application/json",
            "buffer": json.dumps(payload).encode(),
        })
        await page.wait_for_selector("#notes-list .note-item")
        await page.click("button:has-text('Vacations')")
        await page.wait_for_selector(".vacation-name")
        assert await page.locator(".vacation-name").text_content() == vacation_name
        assert await page.locator(".vacation-name img").count() == 0
        assert await page.locator("#notes-list").text_content() == f"2026-08-03 {note_text}Delete"
        assert await page.locator("#notes-list img, #notes-list svg").count() == 0
        assert await page.evaluate("() => !window.__xss")
    finally:
        await context.close()


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        tests = [
            test_dashboard_and_forecast,
            test_smart_notifications_generate_and_link_to_actions,
            test_smart_notification_dismissal_persists_and_changed_fingerprint_reappears,
            test_smart_notifications_cover_forfeiture_and_low_balance,
            test_smart_notifications_empty_state,
            test_vacation_persists_and_deletes,
            test_leave_types_and_partial_day_validation,
            test_legacy_browser_backup_migrates_leave_type,
            test_notes_and_json_backup,
            test_vacation_calendar_export_and_import_preview,
            test_settings_stay_local,
            test_accessibility_semantics_and_keyboard_controls,
            test_mobile_layout_and_touch_targets,
            test_module_loading_and_browser_value_escaping,
        ]
        failures = []
        for test in tests:
            try:
                await test(browser)
                print(f"PASS {test.__name__}")
            except Exception as error:
                failures.append((test.__name__, error))
                print(f"FAIL {test.__name__}: {error}")
        await browser.close()
    if failures:
        raise AssertionError(f"{len(failures)} browser test(s) failed")


if __name__ == "__main__":
    asyncio.run(main())
