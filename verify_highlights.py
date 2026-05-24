import asyncio
from playwright.async_api import async_playwright
import os
import json

async def verify_highlights():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        path_index = os.path.abspath("index.html")
        await page.goto(f"file://{path_index}")

        dummy_task = {
            "id": "1",
            "name": "Highlighter Task",
            "color": "#3498db",
            "nodes": [
                {
                    "id": "node1",
                    "text": "Note with highlights",
                    "body": "This is a long text that should be highlighted and then we can add a comment to it. Let's see if it works.",
                    "expanded": True,
                    "children": [],
                    "highlights": []
                }
            ],
            "checklist": []
        }
        await page.evaluate(f"localStorage.setItem('neuroflow_tasks', JSON.stringify([{json.dumps(dummy_task)}]))")

        path_task = os.path.abspath("task.html")
        await page.goto(f"file://{path_task}?id=1")

        await page.wait_for_selector(".node-body-text")

        # Test manual addition of highlight via localStorage to verify rendering first
        dummy_task["nodes"][0]["highlights"].append({
            "id": "h1",
            "text": "long text",
            "comment": "Initial comment",
            "start": 10,
            "length": 9
        })
        await page.evaluate(f"localStorage.setItem('neuroflow_tasks', JSON.stringify([{json.dumps(dummy_task)}]))")
        await page.reload()

        await page.wait_for_selector(".note-highlight")
        print("Highlight rendered successfully!")

        # Click it to see popover
        await page.click(".note-highlight")
        await page.wait_for_selector("#annotationPopover", state="visible")
        print("Popover appeared!")

        # Change comment
        await page.fill("#annotationInput", "Updated comment")
        await page.click("#saveAnnotation")

        # Check if saved
        await page.click(".note-highlight")
        val = await page.input_value("#annotationInput")
        print(f"Updated comment: {val}")

        # Test Delete
        await page.click("#deleteHighlight")
        await page.wait_for_function('document.querySelectorAll(".note-highlight").length === 0')
        print("Highlight deleted successfully!")

        await page.screenshot(path="verification/highlights_final_v2.png")
        await browser.close()

if __name__ == "__main__":
    os.makedirs("verification", exist_ok=True)
    asyncio.run(verify_highlights())
