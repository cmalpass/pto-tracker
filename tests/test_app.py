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
        await page.locator("input[type='file']").set_input_files({
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
            test_vacation_persists_and_deletes,
            test_notes_and_json_backup,
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
