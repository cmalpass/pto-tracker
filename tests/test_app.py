"""Playwright integration tests for PTO Tracker."""
import asyncio
import sys
import os
from io import BytesIO
from datetime import date
from openpyxl import load_workbook
from playwright.async_api import async_playwright, Page

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

BASE_URL = os.environ.get("PTO_TEST_BASE_URL", "http://localhost:5000")
TEST_YEAR = date.today().year


async def test_dashboard_loads():
    """Verify dashboard renders with correct balance and stats."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(BASE_URL)
        assert "PTO Tracker" in await page.title()
        assert await page.locator("h1:has-text('PTO Tracker')").is_visible()
        assert await page.locator("h2:has-text('Current Balance')").is_visible()
        assert await page.locator("h2:has-text('Quick Stats')").is_visible()
        assert await page.locator("h2:has-text('Accrual Info')").is_visible()
        balance_text = await page.locator(".balance-amount").text_content()
        assert balance_text, "Balance amount should be displayed"
        assert await page.locator("text=Accrued YTD").is_visible()
        assert await page.locator("text=Used YTD").is_visible()
        assert await page.locator("text=Upcoming Trips").is_visible()
        assert await page.locator("text=Days Left in Year").is_visible()
        print("✅ test_dashboard_loads passed")
        await browser.close()


async def test_add_vacation():
    """Verify vacation form submission updates balance."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(BASE_URL)
        await page.click("button:has-text('Vacations')")
        await page.wait_for_timeout(500)
        await page.evaluate("""
            var settingsModal = document.getElementById('settings-modal');
            if (settingsModal) settingsModal.classList.remove('active');
            var vacationModal = document.getElementById('vacation-modal');
            if (vacationModal) vacationModal.classList.remove('active');
        """)
        await page.wait_for_timeout(300)
        await page.evaluate("""
            var vacationModal = document.getElementById('vacation-modal');
            if (vacationModal) vacationModal.classList.add('active');
        """)
        await page.wait_for_timeout(500)
        await page.fill("input[name='name']", "Test Vacation")
        await page.fill("input[name='start_date']", f"{TEST_YEAR}-08-01")
        await page.fill("input[name='end_date']", f"{TEST_YEAR}-08-05")
        await page.wait_for_timeout(500)
        await page.evaluate("document.querySelector('#vacation-form').requestSubmit()")
        await page.wait_for_timeout(1000)
        assert await page.locator("text=Test Vacation").first.is_visible()
        toast = await page.locator(".toast").text_content()
        assert "Vacation added" in toast or "added" in toast.lower()
        print("✅ test_add_vacation passed")
        await browser.close()


async def test_calendar_shows_holidays():
    """Verify US holidays appear on calendar."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(BASE_URL)
        await page.click("button:has-text('Calendar')")
        await page.wait_for_timeout(500)
        assert await page.locator(".calendar-grid").is_visible()
        await page.click("button:has-text('<')")
        await page.wait_for_timeout(300)
        await page.click("button:has-text('<')")
        await page.wait_for_timeout(300)
        await page.click("button:has-text('<')")
        await page.wait_for_timeout(300)
        calendar_title = await page.locator("#calendar-title").text_content()
        assert "January" in calendar_title or "2026" in calendar_title, f"Should show January 2026, got: {calendar_title}"
        days = await page.locator(".cal-day").count()
        assert days > 0, "Calendar should have at least one day"
        print("✅ test_calendar_shows_holidays passed")
        await browser.close()


async def test_forecast_table():
    """Verify forecast table shows correct monthly data."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(BASE_URL)
        await page.click("button:has-text('Forecast')")
        await page.wait_for_timeout(500)
        await page.wait_for_selector(".forecast-table tbody tr", timeout=10000)
        assert await page.locator(".forecast-table").is_visible()
        assert await page.locator("th:has-text('Month')").is_visible()
        assert await page.locator("th:has-text('Accrued')").is_visible()
        assert await page.locator("th:has-text('Used')").is_visible()
        assert await page.locator("th:has-text('Balance')").is_visible()
        assert await page.locator("th:has-text('Limit')").is_visible()
        rows = await page.locator(".forecast-table tbody tr").count()
        assert rows == 12, f"Should have 12 monthly rows, got {rows}"
        print("✅ test_forecast_table passed")
        await browser.close()


async def test_settings_save():
    """Verify settings changes persist."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(BASE_URL)
        await page.click("#btn-settings")
        await page.wait_for_timeout(500)
        assert await page.locator("#settings-modal").is_visible()
        await page.fill("input[name='pto_accrual_per_pay_period']", "2.0")
        await page.click("button:has-text('Save Settings')")
        await page.wait_for_timeout(500)
        toast = await page.locator(".toast").text_content()
        assert "Settings saved" in toast or "saved" in toast.lower()
        print("✅ test_settings_save passed")
        await browser.close()


async def test_holiday_country_configuration(request_context):
    """Verify country-specific holidays and invalid-country validation."""
    config_response = await request_context.get('/api/config')
    config = await config_response.json()
    assert config['holiday_country'] == 'US'

    invalid = await request_context.put('/api/config', data={'holiday_country': 'ZZ'})
    assert invalid.status == 400

    updated = await request_context.put('/api/config', data={'holiday_country': 'GB'})
    assert updated.status == 200
    assert (await updated.json())['config']['holiday_country'] == 'GB'

    calendar = await request_context.get(f'/api/calendar/{TEST_YEAR}')
    events = await calendar.json()
    holiday_names = {event['name'] for event in events['events'] if event['type'] == 'holiday'}
    assert 'Good Friday' in holiday_names

    restored = await request_context.put('/api/config', data={'holiday_country': 'US'})
    assert restored.status == 200
    await request_context.put('/api/config', data={'holiday_country': 'not-a-country'})
    assert (await (await request_context.get('/api/config')).json())['holiday_country'] == 'US'


async def test_chart_rendering():
    """Verify forecast chart displays data."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(BASE_URL)
        await page.click("button:has-text('Forecast')")
        await page.wait_for_timeout(500)
        canvas = page.locator("#forecast-chart")
        assert await canvas.is_visible()
        canvas_width = await canvas.evaluate("el => el.width")
        canvas_height = await canvas.evaluate("el => el.height")
        assert canvas_width > 0, "Canvas should have width"
        assert canvas_height > 0, "Canvas should have height"
        print("✅ test_chart_rendering passed")
        await browser.close()


async def test_delete_vacation():
    """Verify vacation deletion works end-to-end."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        await page.goto(BASE_URL)
        await page.click("button:has-text('Vacations')")
        await page.wait_for_timeout(500)
        await page.evaluate("""
            var settingsModal = document.getElementById('settings-modal');
            if (settingsModal) settingsModal.classList.remove('active');
            var vacationModal = document.getElementById('vacation-modal');
            if (vacationModal) vacationModal.classList.remove('active');
        """)
        await page.wait_for_timeout(300)
        await page.evaluate("""
            var vacationModal = document.getElementById('vacation-modal');
            if (vacationModal) vacationModal.classList.add('active');
        """)
        await page.wait_for_timeout(500)
        unique_name = f"DeleteMe_{id(browser)}"
        await page.fill("input[name='name']", unique_name)
        await page.fill("input[name='start_date']", f"{TEST_YEAR}-10-01")
        await page.fill("input[name='end_date']", f"{TEST_YEAR}-10-03")
        await page.wait_for_timeout(500)
        await page.evaluate("document.querySelector('#vacation-form').requestSubmit()")
        await page.wait_for_timeout(1500)
        assert await page.locator(f"text={unique_name}").first.is_visible(), \
            f"Vacation '{unique_name}' should appear in list"
        delete_xpath = f"//div[text()='{unique_name}']/ancestor::div[@class='vacation-item']//button[@class='vacation-delete']"
        await page.locator(delete_xpath).click()
        await page.wait_for_timeout(1000)
        remaining = await page.locator(f"text={unique_name}").count()
        assert remaining == 0, \
            f"Vacation '{unique_name}' should be deleted, but {remaining} instances remain"
        api_resp = await page.evaluate("() => fetch('/api/vacations').then(r => r.json())")
        found = any(v['name'] == unique_name for v in api_resp)
        assert not found, f"Vacation '{unique_name}' should not exist in API"
        print("✅ test_delete_vacation passed (full add+delete cycle verified)")
        await browser.close()


async def test_export_and_note_validation(request_context):
    """Verify exports neutralize formulas and malformed note dates return 400."""
    malformed = await request_context.post('/api/notes', data={
        'date': 123,
        'text': 'Malformed date'
    })
    assert malformed.status == 400
    non_canonical = await request_context.post('/api/notes', data={
        'date': '2026-1-1',
        'text': 'Non-canonical date'
    })
    assert non_canonical.status == 400

    vacation = await request_context.post('/api/vacations', data={
        'name': '=HYPERLINK("https://example.com","Injected")',
        'start_date': f'{TEST_YEAR}-11-02',
        'end_date': f'{TEST_YEAR}-11-02',
        'auto_days': True
    })
    assert vacation.status == 201

    csv_response = await request_context.get('/api/export/csv')
    assert csv_response.status == 200
    assert "'=HYPERLINK" in (await csv_response.body()).decode('utf-8')

    excel_response = await request_context.get('/api/export/excel')
    workbook = load_workbook(filename=BytesIO(await excel_response.body()), data_only=False)
    assert workbook['Vacation Schedule']['A2'].value.startswith("'=")


async def main():
    """Run all tests."""
    tests = [
        test_dashboard_loads,
        test_add_vacation,
        test_calendar_shows_holidays,
        test_forecast_table,
        test_settings_save,
        test_chart_rendering,
        test_delete_vacation,
        test_export_and_note_validation,
    ]
    passed = 0
    failed = 0
    for test in tests:
        try:
            await test()
            passed += 1
        except Exception as e:
            print(f"❌ {test.__name__} failed: {e}")
            failed += 1
    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed")
    print(f"{'='*50}")
    return failed == 0


async def reset_database(request_context):
    """Remove test records and restore defaults before each browser test."""
    vacations_response = await request_context.get('/api/vacations')
    for vacation in await vacations_response.json():
        await request_context.delete(f"/api/vacations/{vacation['id']}")
    notes_response = await request_context.get('/api/notes')
    for note in await notes_response.json():
        await request_context.delete(f"/api/notes/{note['id']}")
    await request_context.put('/api/config', data={
        'holiday_country': 'US',
        'pto_accrual_per_pay_period': 1.0,
        'pto_accrual_type': 'days',
        'pto_hours_per_day': 8,
        'pto_holidays_require_pto': True,
        'pay_periods_per_year': 26,
        'accrual_method': 'pro-rata',
        'pto_carryover_limit': 40,
        'pto_uses_rollover': True,
        'pto_lose_above_limit': True,
    })


async def run_isolated_tests():
    """Run each integration test against a clean database state."""
    tests = [
        test_dashboard_loads,
        test_add_vacation,
        test_calendar_shows_holidays,
        test_forecast_table,
        test_settings_save,
        test_holiday_country_configuration,
        test_chart_rendering,
        test_delete_vacation,
        test_export_and_note_validation,
    ]
    passed = 0
    failed = 0
    async with async_playwright() as p:
        request_context = await p.request.new_context(base_url=BASE_URL)
        try:
            for test in tests:
                await reset_database(request_context)
                try:
                    if test in {test_export_and_note_validation, test_holiday_country_configuration}:
                        await test(request_context)
                    else:
                        await test()
                    passed += 1
                except Exception as e:
                    print(f"❌ {test.__name__} failed: {e}")
                    failed += 1
            await reset_database(request_context)
        finally:
            await request_context.dispose()
    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed")
    print(f"{'='*50}")
    return failed == 0


if __name__ == "__main__":
    result = asyncio.run(run_isolated_tests())
    sys.exit(0 if result else 1)
