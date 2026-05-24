import asyncio
from playwright.async_api import async_playwright
import os
import json

async def verify_ux_final():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        # Load the index page first to be on the same domain/origin
        path_index = os.path.abspath("index.html")
        await page.goto(f"file://{path_index}")

        # Inject a dummy task into LocalStorage
        dummy_task = {
            "id": "1",
            "title": "Verification Task",
            "description": "Task for testing UX",
            "color": "#3498db",
            "nodes": [],
            "checklist": [],
            "timerSessions": 0
        }
        await page.evaluate(f"localStorage.setItem('neuroflow_tasks', JSON.stringify([{json.dumps(dummy_task)}]))")

        # Now load the task page
        path_task = os.path.abspath("task.html")
        await page.goto(f"file://{path_task}?id=1")

        try:
            await page.wait_for_selector("#addRootNodeBtn", timeout=5000)
            print("Found #addRootNodeBtn")
        except:
            print("Timed out waiting for #addRootNodeBtn")
            await page.screenshot(path="verification/error_screenshot.png")
            await browser.close()
            return

        # 1. Open Modal and test Clear buttons
        await page.click("#addRootNodeBtn")
        await page.fill("#nodeTextInput", "Title to Clear")
        await page.click("#clearTitleBtn")
        title_val = await page.input_value("#nodeTextInput")
        print(f"Title after clear: '{title_val}'")

        await page.fill("#nodeBodyInput", "Body to Clear")
        await page.click("#clearBodyBtn")
        body_val = await page.input_value("#nodeBodyInput")
        print(f"Body after clear: '{body_val}'")

        # 2. Test Formatting Shortcuts
        await page.fill("#nodeBodyInput", "Line 1\nLine 2")
        await page.focus("#nodeBodyInput")
        await page.keyboard.press("Control+A")
        await page.click("#fmtGreenBtn")
        body_fmt = await page.input_value("#nodeBodyInput")
        print(f"Body after Green shortcut:\n{body_fmt}")

        await page.keyboard.press("Control+A")
        await page.click("#fmtRedBtn")
        body_fmt_red = await page.input_value("#nodeBodyInput")
        print(f"Body after Red shortcut:\n{body_fmt_red}")

        await page.keyboard.press("Control+A")
        await page.click("#fmtClearBtn")
        body_fmt_clear = await page.input_value("#nodeBodyInput")
        print(f"Body after Clear markers:\n{body_fmt_clear}")

        # 3. Test Internal Scrollbar (Long Body)
        long_text = "Line\n" * 50
        await page.fill("#nodeBodyInput", long_text)
        await page.fill("#nodeTextInput", "Long Note")
        await page.click("#modalSave")

        # Expand and check scrollable body
        await page.wait_for_selector(".node-body-text")
        # Take a screenshot of the tree
        await page.screenshot(path="verification/final_ux_tree.png")

        # Check if .node-body-text has overflow-y: auto and max-height
        style = await page.evaluate('''() => {
            const el = document.querySelector(".node-body-text");
            return {
                maxHeight: getComputedStyle(el).maxHeight,
                overflowY: getComputedStyle(el).overflowY
            };
        }''')
        print(f"Body style: {style}")

        # 4. Delete Confirmation
        dialog_appeared = False
        async def handle_dialog(dialog):
            nonlocal dialog_appeared
            dialog_appeared = True
            print(f"Dialog: {dialog.message}")
            await dialog.accept()

        page.on("dialog", handle_dialog)

        await page.wait_for_selector(".node-header")
        await page.hover(".node-header")
        await page.click(".node-actions .danger")

        print(f"Delete confirmation appeared: {dialog_appeared}")

        await browser.close()

if __name__ == "__main__":
    os.makedirs("verification", exist_ok=True)
    asyncio.run(verify_ux_final())
