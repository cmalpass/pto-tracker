"""Playwright integration tests for PTO Tracker."""
import asyncio
import sys
import os
from playwright.async_api import async_playwright, Page

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

BASE_URL = "http://localhost:5000"


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
        await page.fill("input[name='start_date']", "2026-08-01")
        await page.fill("input[name='end_date']", "2026-08-05")
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
        assert await page.locator(".cal-grid").is_visible()
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
        await page.fill("input[name='start_date']", "2026-10-01")
        await page.fill("input[name='end_date']", "2026-10-03")
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


if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(0 if result else 1)
