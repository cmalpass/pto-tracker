"""Capture screenshots of all PTO Tracker features."""
import asyncio
import os
import shutil
import tempfile
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("PTO_TEST_BASE_URL", "http://localhost:5000")
OUTPUT_DIR = os.environ.get(
    "PTO_SCREENSHOT_DIR",
    os.path.join(os.path.dirname(__file__), "docs", "screenshots"),
)


async def seed_demo_data(page):
    """Populate an isolated browser context with representative documentation data."""
    await page.evaluate(
        """async () => {
            await PTOStore.putVacation({
                name: 'Long weekend in the mountains',
                start_date: '2026-08-21',
                end_date: '2026-08-24',
                days: 2,
                hours: 0,
                type: 'vacation'
            });
            await PTOStore.putVacation({
                name: 'Family day',
                start_date: '2026-09-14',
                end_date: '2026-09-14',
                days: 1,
                hours: 0,
                type: 'personal'
            });
        }"""
    )
    await page.reload()
    await page.wait_for_selector("#current-balance")


async def dismiss_transient_ui(page):
    """Keep generated documentation images focused on the app surface."""
    await page.evaluate(
        """() => {
            document.querySelectorAll('.toast, .notification-panel').forEach(node => {
                node.classList.remove('active');
                node.hidden = true;
            });
        }"""
    )

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        video_path = os.environ.get("PTO_VIDEO_PATH")
        video_dir = tempfile.mkdtemp(prefix="pto-tracker-video-") if video_path else None
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            record_video_dir=video_dir,
        )
        page = await context.new_page()
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        await page.goto(BASE_URL)
        await page.wait_for_selector("#current-balance")
        await seed_demo_data(page)
        await dismiss_transient_ui(page)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "01-dashboard.png"), full_page=True)
        print("Dashboard screenshot saved")
        await page.click("#tab-calendar-tab")
        await page.wait_for_selector("#calendar-grid")
        await dismiss_transient_ui(page)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "02-calendar.png"), full_page=True)
        print("Calendar screenshot saved")
        await page.click("#tab-vacations-tab")
        await page.wait_for_selector("#vacations-list")
        await dismiss_transient_ui(page)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "03-vacations.png"), full_page=True)
        print("Vacations screenshot saved")
        await page.click("#tab-forecast-tab")
        await page.wait_for_selector("#forecast-table tbody tr")
        await dismiss_transient_ui(page)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "04-forecast.png"), full_page=True)
        print("Forecast screenshot saved")
        await page.goto(BASE_URL)
        await page.wait_for_selector("#current-balance")
        await page.click("#btn-settings")
        await page.wait_for_selector("#settings-modal.active")
        await dismiss_transient_ui(page)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "05-settings.png"), full_page=True)
        print("Settings screenshot saved")
        await page.goto(BASE_URL)
        await page.wait_for_selector("#current-balance")
        await page.click("#tab-vacations-tab")
        await page.wait_for_selector("#vacations-list")
        await page.evaluate("document.getElementById('settings-modal')?.classList.remove('active')")
        await page.click("#btn-add-vacation")
        await page.wait_for_selector("#vacation-modal.active")
        await dismiss_transient_ui(page)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "06-vacation-modal.png"), full_page=True)
        print("Vacation modal screenshot saved")
        await page.set_viewport_size({"width": 375, "height": 812})
        await page.goto(BASE_URL)
        await page.wait_for_timeout(1000)
        await dismiss_transient_ui(page)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "07-mobile.png"), full_page=True)
        print("Mobile screenshot saved")
        print("All screenshots saved to", OUTPUT_DIR)
        await context.close()
        if video_path:
            os.makedirs(os.path.dirname(video_path) or ".", exist_ok=True)
            shutil.copyfile(await page.video.path(), video_path)
            print("Demo video saved to", video_path)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
