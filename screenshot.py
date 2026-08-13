"""Capture screenshots of all PTO Tracker features."""
import asyncio
import os
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("PTO_TEST_BASE_URL", "http://localhost:5000")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        await page.goto(BASE_URL)
        await page.wait_for_selector("#current-balance")
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "01-dashboard.png"), full_page=True)
        print("Dashboard screenshot saved")
        await page.click("button:has-text('Calendar')")
        await page.wait_for_selector("#calendar-grid")
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "02-calendar.png"), full_page=True)
        print("Calendar screenshot saved")
        await page.click("button:has-text('Vacations')")
        await page.wait_for_selector("#vacations-list")
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "03-vacations.png"), full_page=True)
        print("Vacations screenshot saved")
        await page.click("button:has-text('Forecast')")
        await page.wait_for_selector("#forecast-table tbody tr")
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "04-forecast.png"), full_page=True)
        print("Forecast screenshot saved")
        await page.goto(BASE_URL)
        await page.wait_for_selector("#current-balance")
        await page.click("#btn-settings")
        await page.wait_for_selector("#settings-modal.active")
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "05-settings.png"), full_page=True)
        print("Settings screenshot saved")
        await page.goto(BASE_URL)
        await page.wait_for_selector("#current-balance")
        await page.click("button:has-text('Vacations')")
        await page.wait_for_selector("#vacations-list")
        await page.evaluate("document.getElementById('settings-modal')?.classList.remove('active')")
        await page.click("#btn-add-vacation")
        await page.wait_for_selector("#vacation-modal.active")
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "06-vacation-modal.png"), full_page=True)
        print("Vacation modal screenshot saved")
        await page.set_viewport_size({"width": 375, "height": 812})
        await page.goto(BASE_URL)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "07-mobile.png"), full_page=True)
        print("Mobile screenshot saved")
        print("All screenshots saved to", OUTPUT_DIR)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
