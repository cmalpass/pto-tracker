"""Browser integration tests for the static, browser-native PTO Tracker."""

import asyncio
import json
import os
import time
import traceback
from datetime import datetime

from playwright.async_api import async_playwright


BASE_URL = os.environ.get("PTO_TEST_BASE_URL", "http://localhost:5000")


def contrast_ratio(foreground, background):
    def channel(value):
        value /= 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    def luminance(color):
        return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])

    lighter = max(luminance(foreground), luminance(background))
    darker = min(luminance(foreground), luminance(background))
    return (lighter + 0.05) / (darker + 0.05)


def parse_rgb(value):
    return tuple(int(channel) for channel in value.removeprefix("rgb(").removesuffix(")").split(", "))


async def new_page(browser):
    context = await browser.new_context()
    await context.add_init_script("localStorage.clear();")
    return context, await context.new_page()


async def clear_browser_data(page):
    await page.evaluate(
        """async () => {
            localStorage.clear();
            if (typeof indexedDB === 'undefined') return;
            await new Promise(resolve => {
                const request = indexedDB.deleteDatabase('pto-tracker');
                request.onsuccess = resolve;
                request.onerror = resolve;
                request.onblocked = () => {};
            });
        }"""
    )


async def accept_dialog(dialog):
    await dialog.accept()


async def open_app(page):
    await page.goto(BASE_URL)
    await clear_browser_data(page)
    await page.reload()
    await page.wait_for_selector("#current-balance")
    await wait_for_page_function(page, "() => Boolean(window.PTOStore && window.PTO)")


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


async def test_year_selectors_track_the_current_pto_year(browser):
    """Year selectors are populated dynamically so the current PTO year
    stays an option even after the hardcoded HTML options go stale."""
    context, page = await new_page(browser)
    try:
        await page.clock.install()
        await page.clock.set_fixed_time(datetime(2029, 6, 1, 12, 0, 0))
        await open_app(page)
        await wait_for_storage_status(page, "ok")
        # Heatmap options are populated when its tab activates.
        await page.click("#tab-heatmap-tab")
        # Forecast tab re-runs loadForecast, which also loads the multi-year outlook.
        await page.click("#tab-forecast-tab")
        await page.wait_for_selector(".forecast-table tbody tr")
        assert await page.locator(".forecast-table tbody tr").count() == 12
        for select_id in ("forecast-year", "heatmap-year", "multi-year-start"):
            options = await page.locator(f"#{select_id} option").all()
            values = [await option.get_attribute("value") for option in options]
            assert "2029" in values, f"{select_id} is missing the 2029 option"
            # The selected option does not carry a `selected` attribute in the
            # serialized DOM, so read the select's selectedIndex instead.
            selected = await page.locator(f"#{select_id}").evaluate(
                "select => select.selectedIndex >= 0"
                " ? select.options[select.selectedIndex].value : null"
            )
            assert selected == "2029", f"{select_id}: expected 2029 selected, got {selected}"
    finally:
        await context.close()


async def test_forecast_spans_fiscal_pto_year(browser):
    """The yearly forecast covers the PTO year's real month range (a
    July-June fiscal year starts in July), and the dashboard Accrued YTD
    stat follows the current PTO-year month instead of the calendar month."""
    context, page = await new_page(browser)
    try:
        await page.clock.install()
        await page.clock.set_fixed_time(datetime(2027, 11, 15, 12, 0, 0))
        await open_app(page)
        await wait_for_storage_status(page, "ok")
        await page.evaluate(
            """async () => {
                const base = await PTOStore.getConfig();
                await PTOStore.putConfig({
                    ...base,
                    pto_year_boundaries: [
                        { year: 2027, final_date: '2027-06-30' },
                        { year: 2028, final_date: '2028-06-30' }
                    ]
                });
            }"""
        )
        await page.reload()
        await wait_for_storage_status(page, "ok")
        # 2027-11-15 falls inside PTO year 2028, which spans 2027-07-01..2028-06-30.
        expected = await page.evaluate(
            """async () => {
                const config = await PTOStore.getConfig();
                const vacations = await PTOStore.listVacations();
                const today = PTO.getLocalToday(config);
                const year = PTO.getPtoYearForDate(today, config);
                const rows = PTO.generateYearlyForecast(year, config, vacations);
                // "Accrued YTD" is the as-of-today accrual for the current PTO
                // year (consistent with the balance card's "Accrued" and with
                // "Used YTD"), so mirror calculateBalanceOnDate rather than the
                // current month's end-of-month forecast row.
                const balance = PTO.calculateBalanceOnDate(today, config, vacations);
                return {
                    year,
                    rowCount: rows.length,
                    firstMonth: rows[0].month_name,
                    lastMonth: rows[rows.length - 1].month_name,
                    ytd: balance.accrued
                };
            }"""
        )
        assert expected["year"] == 2028
        assert expected["rowCount"] == 12
        assert expected["firstMonth"] == "July"
        assert expected["lastMonth"] == "June"
        await page.click("#tab-forecast-tab")
        await page.wait_for_selector(".forecast-table tbody tr")
        rows = await page.locator(".forecast-table tbody tr").all()
        assert len(rows) == 12
        assert (await rows[0].inner_text()).startswith("July")
        assert (await rows[11].inner_text()).startswith("June")
        ytd_stat = await page.locator("#stat-accrued-ytd").inner_text()
        assert ytd_stat == f"{expected['ytd']:.1f}"
    finally:
        await context.close()


async def test_calendar_tracks_calendar_year_with_fiscal_pto_year(browser):
    """The calendar shows the real calendar month, not the fiscal PTO year,
    while the forecast year select keeps tracking the PTO year."""
    context, page = await new_page(browser)
    try:
        await page.clock.install()
        await page.clock.set_fixed_time(datetime(2027, 11, 15, 12, 0, 0))
        await open_app(page)
        await wait_for_storage_status(page, "ok")
        await page.evaluate(
            """async () => {
                const base = await PTOStore.getConfig();
                await PTOStore.putConfig({
                    ...base,
                    pto_year_boundaries: [
                        { year: 2027, final_date: '2027-06-30' },
                        { year: 2028, final_date: '2028-06-30' }
                    ]
                });
            }"""
        )
        await page.reload()
        await wait_for_storage_status(page, "ok")
        # 2027-11-15 is inside PTO year 2028, but the calendar must show
        # the actual calendar month: November 2027.
        await page.click("#tab-calendar-tab")
        await page.wait_for_selector("#calendar-title")
        title = await page.locator("#calendar-title").inner_text()
        assert title == "November 2027", title
        # The forecast select keeps tracking the PTO year (2028).
        await page.click("#tab-forecast-tab")
        await page.wait_for_selector(".forecast-table tbody tr")
        selected = await page.locator("#forecast-year").evaluate(
            "select => select.selectedIndex >= 0"
            " ? select.options[select.selectedIndex].value : null"
        )
        assert selected == "2028"
    finally:
        await context.close()


async def test_settings_dialog_preserves_zero_carryover_limit(browser):
    """A stored carryover limit of 0 (valid 'no carryover' setting) must
    display as 0 in the settings dialog and remain 0 after save, not fall
    back to the 40-day default."""
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await wait_for_storage_status(page, "ok")
        await page.evaluate(
            """async () => {
                const base = await PTOStore.getConfig();
                await PTOStore.putConfig({...base, pto_carryover_limit: 0});
            }"""
        )
        await page.reload()
        await wait_for_storage_status(page, "ok")
        await page.click("#btn-settings")
        await page.wait_for_selector("#settings-modal.active")
        assert await page.locator("#carryover-limit").input_value() == "0"
        await page.click("button:has-text('Save Settings')")
        await page.wait_for_selector("#settings-modal.active", state="hidden")
        stored = await page.evaluate(
            "() => PTOStore.getConfig().then(config => config.pto_carryover_limit)"
        )
        assert float(stored) == 0
    finally:
        await context.close()


async def test_settings_vesting_start_year_round_trips_and_validates(browser):
    """The vesting start year is editable in settings, round-trips through
    save, and out-of-range values are rejected without touching the config."""
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await wait_for_storage_status(page, "ok")
        await page.evaluate(
            """async () => {
                const base = await PTOStore.getConfig();
                await PTOStore.putConfig({...base, pto_start_year: 2022});
            }"""
        )
        await page.reload()
        await wait_for_storage_status(page, "ok")
        await page.click("#btn-settings")
        await page.wait_for_selector("#settings-modal.active")
        assert await page.locator("#pto-start-year").input_value() == "2022"
        # Out-of-range values are rejected by form validation; the modal
        # stays open and the stored config is untouched.
        await page.fill("#pto-start-year", "1800")
        await page.click("button:has-text('Save Settings')")
        await page.wait_for_timeout(300)
        assert await page.locator("#settings-modal.active").is_visible()
        stored = await page.evaluate(
            "() => PTOStore.getConfig().then(config => Number(config.pto_start_year))"
        )
        assert stored == 2022
        # An empty value bypasses HTML range validation but is rejected by
        # the app-level config validation.
        await page.fill("#pto-start-year", "")
        await page.click("button:has-text('Save Settings')")
        await wait_for_page_function(
            page,
            "() => (document.querySelector('#toast')?.textContent || '').includes('Vesting start year')",
        )
        stored = await page.evaluate(
            "() => PTOStore.getConfig().then(config => Number(config.pto_start_year))"
        )
        assert stored == 2022
        # A valid value round-trips through save.
        await page.fill("#pto-start-year", "2023")
        await page.click("button:has-text('Save Settings')")
        await page.wait_for_selector("#settings-modal.active", state="hidden")
        stored = await page.evaluate(
            "() => PTOStore.getConfig().then(config => Number(config.pto_start_year))"
        )
        assert stored == 2023
    finally:
        await context.close()


async def test_next_accrual_date_is_anchored_to_accrual_start(browser):
    """The Next Accrual tile shows the next boundary of the accrual
    schedule (accrual_start_date + k pay periods), not today + one
    pay period."""
    context, page = await new_page(browser)
    try:
        await page.clock.install()
        await page.clock.set_fixed_time(datetime(2027, 3, 15, 12, 0, 0))
        await open_app(page)
        await wait_for_storage_status(page, "ok")
        await page.evaluate(
            """async () => {
                const base = await PTOStore.getConfig();
                await PTOStore.putConfig({
                    ...base,
                    accrual_start_date: '2027-01-01',
                    pay_periods_per_year: 26
                });
            }"""
        )
        await page.reload()
        await wait_for_storage_status(page, "ok")
        # Period = 365.25/26 days; today is 73 days after the start, so the
        # next boundary is start + 6 periods (84.29 days) = Mar 26. The old
        # "today + one period" code would show Mar 29.
        assert await page.locator("#next-accrual-date").inner_text() == "Mar 26"
        # A future accrual start date is itself the next accrual.
        await page.evaluate(
            """async () => {
                const base = await PTOStore.getConfig();
                await PTOStore.putConfig({...base, accrual_start_date: '2027-06-01'});
            }"""
        )
        await page.reload()
        await wait_for_storage_status(page, "ok")
        assert await page.locator("#next-accrual-date").inner_text() == "Jun 1"
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


async def test_vacation_search_and_type_filter_persist(browser):
    """The vacations tab filters by name/date text and leave type, and the
    filters persist across reloads via localStorage."""
    # No init script here: a fresh context is already clean, and the reload
    # below must keep the saved filter (new_page's init script would wipe it).
    context = await browser.new_context()
    page = await context.new_page()
    try:
        await open_app(page)
        await wait_for_storage_status(page, "ok")
        await page.evaluate(
            """async () => {
                const put = PTOStore.putVacation;
                await put({ name: 'Beach trip', type: 'vacation', start_date: '2026-06-01', end_date: '2026-06-05', days: 5, hours: 0 });
                await put({ name: 'Doctor visit', type: 'sick', start_date: '2026-06-10', end_date: '2026-06-10', days: 1, hours: 0 });
                await put({ name: 'Family time', type: 'personal', start_date: '2026-07-01', end_date: '2026-07-02', days: 2, hours: 0 });
            }"""
        )
        await page.reload()
        await wait_for_storage_status(page, "ok")
        await page.click("#tab-vacations-tab")
        await page.wait_for_selector(".vacation-item")
        assert await page.locator(".vacation-item").count() == 3
        # Text search narrows the list by name.
        await page.fill("#vacation-search", "beach")
        assert await page.locator(".vacation-item").count() == 1
        assert "Beach trip" in await page.locator(".vacation-item").inner_text()
        # The type filter narrows by leave type.
        await page.fill("#vacation-search", "")
        assert await page.locator(".vacation-item").count() == 3
        await page.select_option("#vacation-type-filter", "sick")
        assert await page.locator(".vacation-item").count() == 1
        assert "Doctor visit" in await page.locator(".vacation-item").inner_text()
        # A date search with no match shows the filtered empty state.
        await page.fill("#vacation-search", "2026-07")
        assert await page.locator(".vacation-item").count() == 0
        assert "No matching vacations" in await page.locator("#empty-vacations").inner_text()
        # Filters persist across a reload (the app reopens on the dashboard).
        await page.reload()
        await wait_for_storage_status(page, "ok")
        assert await page.locator("#vacation-search").input_value() == "2026-07"
        assert await page.locator("#vacation-type-filter").input_value() == "sick"
        await page.click("#tab-vacations-tab")
        assert await page.locator(".vacation-item").count() == 0
        # Clearing the filters restores the full list.
        await page.fill("#vacation-search", "")
        await page.select_option("#vacation-type-filter", "")
        assert await page.locator(".vacation-item").count() == 3
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


async def test_json_import_resyncs_fallback_storage(browser):
    """A replace import in IndexedDB mode writes via a direct transaction,
    bypassing put(); the localStorage fallback must be re-synced from the DB
    so a later degraded window starts from the imported data with a nextId
    ahead of every imported id, not a stale copy."""
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await wait_for_storage_status(page, "ok")
        # Seed a record so the fallback and DB can diverge, then replace-import
        # a record with an id far ahead of the seed.
        await page.evaluate(
            """async () => {
                await PTOStore.putVacation({
                    name: 'Seed', start_date: '2026-03-01', end_date: '2026-03-02',
                    days: 2, hours: 0, auto_days: false
                });
                await PTOStore.importJSON({
                    schemaVersion: PTOStore.DB_VERSION,
                    data: {
                        config: null,
                        vacations: [{
                            id: 50,
                            name: 'Imported',
                            start_date: '2026-04-01',
                            end_date: '2026-04-02',
                            days: 2,
                            hours: 0,
                            auto_days: false
                        }],
                        notes: []
                    }
                });
            }"""
        )
        fallback = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('pto-tracker:data:v3') || 'null')"
        )
        assert fallback is not None
        assert [v["name"] for v in fallback["vacations"]] == ["Imported"]
        assert fallback["nextId"]["vacations"] >= 51
        # The database matches the import.
        vacations = await page.evaluate("() => PTOStore.listVacations()")
        assert [v["name"] for v in vacations] == ["Imported"]
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
        page.once("dialog", accept_dialog)
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
        page.once("dialog", accept_dialog)
        await page.click("#btn-confirm-vacation-import")
        await page.wait_for_selector("#vacation-import-modal.active", state="hidden")
        await page.wait_for_selector("text=1 vacation imported")
        imported_count = await page.evaluate(
            "() => PTOStore.listVacations().then(items => items.length)"
        )
        assert imported_count == 2
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
        await wait_for_page_function(page, "() => document.activeElement?.id === 'policy-preset'")
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


async def test_theme_controls_meet_contrast(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await page.click("#btn-settings")
        await page.wait_for_selector("#settings-modal.active")
        for theme in ("light", "dark"):
            styles = await page.evaluate(
                """theme => {
                    document.documentElement.dataset.theme = theme;
                    const select = document.querySelector('#holiday-country');
                    const label = document.querySelector('label[for="holiday-country"]');
                    const read = node => {
                        const style = getComputedStyle(node);
                        const surface = style.backgroundColor === 'rgba(0, 0, 0, 0)'
                            ? getComputedStyle(node.closest('.modal')).backgroundColor
                            : style.backgroundColor;
                        return { color: style.color, background: surface };
                    };
                    return { select: read(select), label: read(label) };
                }""",
                theme,
            )
            select_ratio = contrast_ratio(
                parse_rgb(styles["select"]["color"]),
                parse_rgb(styles["select"]["background"]),
            )
            label_ratio = contrast_ratio(
                parse_rgb(styles["label"]["color"]),
                parse_rgb(styles["label"]["background"]),
            )
            assert select_ratio >= 4.5, (theme, styles, select_ratio)
            assert label_ratio >= 4.5, (theme, styles, label_ratio)
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
        await page.locator("button.cal-day[data-date]").first.click()
        vacation_dialog = page.locator("#vacation-modal")
        await page.wait_for_selector("#vacation-modal.active")
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
        # No leading slash: asset paths are relative so the app also works
        # when deployed under a subdirectory (e.g. /pto-tracker/).
        assert await page.locator("script[type='module'][src*='static/js/app.js']").count() == 1
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
        page.once("dialog", accept_dialog)
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


async def test_import_rejects_invalid_pto_year_boundaries(browser):
    context, page = await new_page(browser)
    try:
        await open_app(page)
        await page.evaluate(
            """async () => {
                await PTOStore.putConfig({
                    holiday_country: 'US',
                    pto_accrual_per_pay_period: 1,
                    pto_hours_per_day: 8,
                    pay_periods_per_year: 26,
                    accrual_start_date: '2026-01-01',
                    accrual_method: 'pro-rata',
                    timezone: 'UTC',
                    pto_year_boundaries: [{ year: 2025, final_date: '2025-12-31' }]
                });
                await PTOStore.putVacation({
                    name: 'Kept trip',
                    start_date: '2026-08-03',
                    end_date: '2026-08-03',
                    days: 1,
                    hours: 0
                });
            }"""
        )
        payload = {
            "schemaVersion": 3,
            "data": {
                "config": {
                    "accrual_start_date": "2026-01-01",
                    "pto_year_boundaries": [{"year": 2026, "final_date": "2027-01-15"}],
                },
                "vacations": [{
                    "id": 55,
                    "name": "Should not appear",
                    "start_date": "2026-09-01",
                    "end_date": "2026-09-01",
                    "days": 1,
                    "hours": 0,
                }],
                "notes": [],
            },
        }
        await page.click("#tab-forecast-tab")
        await page.wait_for_selector("#tab-forecast.active")
        await page.click("#import-json")
        page.once("dialog", accept_dialog)
        await page.locator("input[accept='application/json,.json']").set_input_files({
            "name": "bad-boundaries.json",
            "mimeType": "application/json",
            "buffer": json.dumps(payload).encode(),
        })
        toast = page.locator("#toast")
        await page.wait_for_selector("#toast.show")
        assert "error" in (await toast.get_attribute("class") or "")
        assert "within 2026" in await toast.text_content()

        result = await page.evaluate(
            """async () => {
                const config = await PTOStore.getConfig();
                const vacations = await PTOStore.listVacations();
                return {
                    boundaries: config.pto_year_boundaries,
                    vacationCount: vacations.length,
                    firstVacation: vacations[0].name
                };
            }"""
        )
        assert result["boundaries"] == [{"year": 2025, "final_date": "2025-12-31"}]
        assert result["vacationCount"] == 1
        assert result["firstVacation"] == "Kept trip"
    finally:
        await context.close()


async def wait_for_page_function(page, expression, timeout=15.0):
    """CSP-safe alternative to a string-based page.wait_for_function.

    String-based wait_for_function evaluates through eval() inside the
    injected script, which the app's CSP (script-src without 'unsafe-eval')
    intermittently blocks. page.evaluate sends the expression directly and
    is CSP-safe, so poll it until the expression is truthy.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        if await page.evaluate(expression):
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"page function never became truthy: {expression}")


async def wait_for_storage_status(page, target, timeout=15.0):
    """Poll PTOStore's storage status via page.evaluate.

    String-based page.wait_for_function evaluates through eval() inside the
    injected script, which the app's CSP (script-src without 'unsafe-eval')
    intermittently blocks. page.evaluate sends the expression directly and
    is CSP-safe.
    """
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = await page.evaluate(
            "() => window.PTOStore && typeof window.PTOStore.getStorageStatus === 'function'"
            " ? window.PTOStore.getStorageStatus().state : null"
        )
        if last == target:
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"storage status never reached {target!r} (last seen: {last!r})")


async def test_indexeddb_block_degrades_visibly_and_reconciles(browser):
    # Holds a version-1 connection before the app loads so the app's
    # version-3 open fires onblocked. Init scripts run before page scripts,
    # so the blocker is guaranteed to open first on every load.
    blocker_script = """
    window.__ptoBlockerReady = new Promise(resolve => {
        const blocker = indexedDB.open('pto-tracker', 1);
        window.__ptoBlocker = blocker;
        blocker.onsuccess = () => resolve();
        blocker.onerror = () => resolve();
    });
    """
    context = await browser.new_context()
    page = await context.new_page()
    try:
        await context.add_init_script(blocker_script)
        await page.goto(BASE_URL)
        await wait_for_storage_status(page, "blocked")

        banner = page.locator("#storage-degraded-banner")
        assert await banner.is_visible()
        assert "degraded mode" in await banner.text_content()

        vacation_id = await page.evaluate(
            """async () => {
                const vacation = await PTOStore.putVacation({
                    name: 'Blocked tab trip',
                    start_date: '2026-10-01',
                    end_date: '2026-10-01',
                    days: 1,
                    hours: 0
                });
                const listed = await PTOStore.listVacations();
                return { id: vacation.id, count: listed.length };
            }"""
        )
        assert vacation_id["count"] == 1

        # Reload while still blocked: data written during the degraded
        # window must survive in fallback storage.
        await page.reload()
        await wait_for_storage_status(page, "blocked")
        assert (await page.evaluate("() => PTOStore.listVacations().then(v => v.length)")) == 1
        assert await page.locator("#storage-degraded-banner").is_visible()

        # Release the blocking connection: the app's still-live open request
        # upgrades the database, reconciles the fallback data, and recovers
        # without a reload.
        await page.evaluate("() => window.__ptoBlocker.result.close()")
        await wait_for_storage_status(page, "ok")
        assert not await page.locator("#storage-degraded-banner").is_visible()
        assert (await page.evaluate("() => PTOStore.listVacations().then(v => v.length)")) == 1
        live_ids = await page.evaluate(
            """() => new Promise((resolve, reject) => {
                const request = indexedDB.open('pto-tracker', 3);
                request.onsuccess = () => {
                    const db = request.result;
                    const read = db.transaction('vacations', 'readonly')
                        .objectStore('vacations').getAllKeys();
                    read.onsuccess = () => { db.close(); resolve(read.result); };
                    read.onerror = () => reject(read.error);
                };
                request.onerror = () => reject(request.error);
            })"""
        )
        assert live_ids == [vacation_id["id"]]

        # After a final reload the blocker's open fails (lower version) and
        # the app opens the upgraded database cleanly.
        await page.reload()
        await wait_for_storage_status(page, "ok")
        assert not await page.locator("#storage-degraded-banner").is_visible()
        assert (await page.evaluate("() => PTOStore.listVacations().then(v => v.length)")) == 1
    finally:
        await context.close()


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        tests = [
            test_dashboard_and_forecast,
            test_year_selectors_track_the_current_pto_year,
            test_forecast_spans_fiscal_pto_year,
            test_calendar_tracks_calendar_year_with_fiscal_pto_year,
            test_settings_dialog_preserves_zero_carryover_limit,
            test_settings_vesting_start_year_round_trips_and_validates,
            test_next_accrual_date_is_anchored_to_accrual_start,
            test_smart_notifications_generate_and_link_to_actions,
            test_smart_notification_dismissal_persists_and_changed_fingerprint_reappears,
            test_smart_notifications_cover_forfeiture_and_low_balance,
            test_smart_notifications_empty_state,
            test_vacation_persists_and_deletes,
            test_vacation_search_and_type_filter_persist,
            test_leave_types_and_partial_day_validation,
            test_legacy_browser_backup_migrates_leave_type,
            test_json_import_resyncs_fallback_storage,
            test_notes_and_json_backup,
            test_vacation_calendar_export_and_import_preview,
            test_import_rejects_invalid_pto_year_boundaries,
            test_settings_stay_local,
            test_accessibility_semantics_and_keyboard_controls,
            test_theme_controls_meet_contrast,
            test_mobile_layout_and_touch_targets,
            test_module_loading_and_browser_value_escaping,
            test_indexeddb_block_degrades_visibly_and_reconciles,
        ]
        failures = []
        for test in tests:
            try:
                await test(browser)
                print(f"PASS {test.__name__}")
            except Exception as error:
                failures.append((test.__name__, error))
                print(f"FAIL {test.__name__}: {error}")
                traceback.print_exc()
        await browser.close()
    if failures:
        raise AssertionError(f"{len(failures)} browser test(s) failed")


if __name__ == "__main__":
    asyncio.run(main())
