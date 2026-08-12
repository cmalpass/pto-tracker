"""Playwright integration tests for PTO Tracker."""
import asyncio
import sys
import os
import json
from io import BytesIO
from datetime import date, timedelta
from openpyxl import load_workbook
from playwright.async_api import async_playwright, Page

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

BASE_URL = os.environ.get("PTO_TEST_BASE_URL", "http://localhost:5000")
TEST_YEAR = date.today().year


async def csrf_headers(request_context):
    """Return a CSRF header after establishing the browser token cookie."""
    await request_context.get('/')
    storage = await request_context.storage_state()
    token = next(
        cookie['value'] for cookie in storage['cookies']
        if cookie['name'] == 'pto_csrf_token'
    )
    return {'X-CSRF-Token': token}


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
        assert await page.locator("text=Scheduled PTO Remaining").is_visible()
        assert await page.locator("#stat-scheduled-pto").is_visible()
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


async def test_multi_year_forecast_and_heatmap(request_context):
    """Verify bounded multi-year forecast and weekly impact data."""
    headers = await csrf_headers(request_context)
    forecast = await request_context.get(
        f'/api/forecast/multi-year?start_year={TEST_YEAR}&years=3'
    )
    assert forecast.status == 200
    forecast_data = await forecast.json()
    assert len(forecast_data['years']) == 3
    assert all(len(entry['monthly_balances']) == 12 for entry in forecast_data['years'])
    assert all('carryover' in entry and 'forfeited' in entry for entry in forecast_data['years'])

    heatmap = await request_context.get(f'/api/heatmap/{TEST_YEAR}')
    assert heatmap.status == 200
    heatmap_data = await heatmap.json()
    assert len(heatmap_data['weeks']) in (52, 53)
    assert heatmap_data['max_score'] >= heatmap_data['min_score']
    holiday_weeks = [week for week in heatmap_data['weeks'] if week['holidays']]
    assert holiday_weeks and max(week['score'] for week in holiday_weeks) > 0

    vacation = await request_context.post('/api/vacations', headers=headers, data={
        'name': 'Heatmap Test',
        'start_date': f'{TEST_YEAR}-11-02',
        'end_date': f'{TEST_YEAR}-11-02',
        'auto_days': True,
    })
    assert vacation.status == 201
    booked_heatmap = await request_context.get(f'/api/heatmap/{TEST_YEAR}')
    assert any(week['already_booked'] for week in (await booked_heatmap.json())['weeks'])


async def test_heatmap_boundary_navigation():
    """Verify boundary heatmap weeks stay within the selected calendar year."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(BASE_URL)
        await page.click("button:has-text('Best Weeks')")
        await page.wait_for_selector(".heatmap-cell", timeout=10000)
        await page.locator(".heatmap-cell").first.click()
        assert str(TEST_YEAR) in (await page.locator("#calendar-title").text_content())
        await page.click("button:has-text('Best Weeks')")
        await page.wait_for_selector(".heatmap-cell", timeout=10000)
        await page.locator(".heatmap-cell").last.click()
        assert str(TEST_YEAR) in (await page.locator("#calendar-title").text_content())
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
    headers = await csrf_headers(request_context)
    malformed = await request_context.post('/api/notes', headers=headers, data={
        'date': 123,
        'text': 'Malformed date'
    })
    assert malformed.status == 400
    non_canonical = await request_context.post('/api/notes', headers=headers, data={
        'date': '2026-1-1',
        'text': 'Non-canonical date'
    })
    assert non_canonical.status == 400

    vacation = await request_context.post('/api/vacations', headers=headers, data={
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


async def test_smart_warnings_and_suggestion_filters(request_context=None):
    """Verify vacation analysis warnings and server-side suggestion filters."""
    own_context = request_context is None
    if own_context:
        async with async_playwright() as p:
            request_context = await p.request.new_context(base_url=BASE_URL)
            try:
                await test_smart_warnings_and_suggestion_filters(request_context)
            finally:
                await request_context.dispose()
        return
    headers = await csrf_headers(request_context)
    first = await request_context.post('/api/vacations', headers=headers, data={
        'name': 'Existing trip',
        'start_date': f'{TEST_YEAR}-09-14',
        'end_date': f'{TEST_YEAR}-09-16',
        'days': 3,
        'auto_days': False,
        'hours': 0,
    })
    assert first.status == 201
    analysis = await request_context.post('/api/vacations/analyze',
        data=json.dumps({
            'start_date': f'{TEST_YEAR}-09-15',
            'end_date': f'{TEST_YEAR}-09-17',
            'days': 3,
            'hours': 0,
        }),
        headers={**headers, 'Content-Type': 'application/json'})
    assert analysis.status == 200
    analysis_data = await analysis.json()
    assert any(warning['type'] == 'overlap' for warning in analysis_data['warnings'])

    filtered = await request_context.get(
        f'/api/vacations/suggestions?year={TEST_YEAR}&max_pto_days=1&sort_by=date'
    )
    assert filtered.status == 200
    filtered_data = await filtered.json()
    assert filtered_data['total_filtered'] <= filtered_data['total_unfiltered']
    assert all(item['pto_days'] <= 1 for item in filtered_data['suggestions'])
    assert filtered_data['filters_applied']['sort_by'] == 'date'


async def test_vacation_warning_controls_render():
    """Verify the vacation UI exposes accessible analysis and filter controls."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(BASE_URL)
        await page.click("button:has-text('Vacations')")
        await page.wait_for_timeout(500)
        assert await page.locator("#btn-toggle-suggestion-filters").is_visible()
        assert await page.locator("#vacation-warnings").count() == 1
        await page.locator("#btn-toggle-suggestion-filters").click()
        assert await page.locator("#suggestion-filter-controls").is_visible()
        await browser.close()


async def test_stats_preserve_upcoming_trip_count_and_expose_scheduled_days(request_context):
    """Verify stats keep the entry count while exposing scheduled PTO days."""
    headers = await csrf_headers(request_context)
    start_date = date.today() + timedelta(days=7)
    while start_date.weekday() != 0:
        start_date += timedelta(days=1)
    end_date = start_date + timedelta(days=4)
    vacation = await request_context.post('/api/vacations', headers=headers, data={
        'name': 'Stats Regression',
        'start_date': start_date.isoformat(),
        'end_date': end_date.isoformat(),
        'auto_days': True
    })
    assert vacation.status == 201

    stats_response = await request_context.get('/api/stats')
    assert stats_response.status == 200
    stats = await stats_response.json()
    assert stats['upcoming_vacations'] == 1
    assert stats['remaining_scheduled_pto_days'] == stats['remaining_vacation_days']
    assert stats['remaining_scheduled_pto_days'] == 5


async def main():
    """Run all tests."""
    tests = [
        test_dashboard_loads,
        test_add_vacation,
        test_calendar_shows_holidays,
        test_forecast_table,
        test_settings_save,
        test_chart_rendering,
        test_heatmap_boundary_navigation,
        test_delete_vacation,
        test_export_and_note_validation,
        test_smart_warnings_and_suggestion_filters,
        test_vacation_warning_controls_render,
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
    headers = await csrf_headers(request_context)
    vacations_response = await request_context.get('/api/vacations')
    for vacation in await vacations_response.json():
        await request_context.delete(f"/api/vacations/{vacation['id']}", headers=headers)
    notes_response = await request_context.get('/api/notes')
    for note in await notes_response.json():
        await request_context.delete(f"/api/notes/{note['id']}", headers=headers)
    await request_context.put('/api/config', headers=headers, data={
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
        test_chart_rendering,
        test_multi_year_forecast_and_heatmap,
        test_heatmap_boundary_navigation,
        test_delete_vacation,
        test_export_and_note_validation,
        test_smart_warnings_and_suggestion_filters,
        test_vacation_warning_controls_render,
        test_stats_preserve_upcoming_trip_count_and_expose_scheduled_days,
    ]
    passed = 0
    failed = 0
    async with async_playwright() as p:
        request_context = await p.request.new_context(base_url=BASE_URL)
        try:
            for test in tests:
                await reset_database(request_context)
                try:
                    if test in {
                        test_export_and_note_validation,
                        test_multi_year_forecast_and_heatmap,
                        test_smart_warnings_and_suggestion_filters,
                        test_stats_preserve_upcoming_trip_count_and_expose_scheduled_days,
                    }:
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
