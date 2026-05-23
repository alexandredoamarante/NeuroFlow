from playwright.sync_api import sync_playwright
import os
import json

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()

        # Mock data
        mock_task = {
            "id": "1",
            "name": "Final Test Task",
            "color": "#3498db",
            "checklist": [
                { "text": "Line 1\nLine 2 with http://google.com\n>greentext line", "done": False }
            ],
            "nodes": [
                {
                    "id": "n1",
                    "text": "Root Node",
                    "body": "Body with www.example.com\n<redtext line\nMulti-line\ncontent",
                    "expanded": True,
                    "children": []
                }
            ]
        }

        # Inject script to set localStorage
        page.add_init_script(f"localStorage.setItem('neuroflow_tasks', JSON.stringify([{json.dumps(mock_task)}]))")

        # Load page
        file_path = "file://" + os.path.abspath("task.html") + "?id=1"
        page.goto(file_path)
        page.wait_for_load_state("networkidle")

        # 1. Verify Checklist
        check_text = page.locator(".check-text")
        lines = check_text.locator(".node-line")
        assert lines.count() == 3
        assert "Line 1" in lines.nth(0).inner_text()
        assert lines.nth(1).locator("a").get_attribute("href") == "http://google.com"
        assert "greentext" in lines.nth(2).get_attribute("class")

        # 2. Verify Note Body
        node_body = page.locator(".node-body-text")
        body_lines = node_body.locator(".node-line")
        assert body_lines.count() == 4
        assert body_lines.nth(0).locator("a").get_attribute("href") == "http://www.example.com"
        assert "redtext" in body_lines.nth(1).get_attribute("class")

        # 3. Verify Alignment
        check_item = page.locator(".check-item").first
        align_items = check_item.evaluate("el => window.getComputedStyle(el).alignItems")
        assert align_items == "flex-start"

        # 4. Verify Dividers
        tree_node = page.locator(".tree-node").first
        border_bottom = tree_node.evaluate("el => window.getComputedStyle(el).borderBottomWidth")
        assert float(border_bottom.replace('px', '')) > 0

        # Screenshot
        page.screenshot(path="final_verification_result.png", full_page=True)
        print("Verification successful!")

        browser.close()

if __name__ == "__main__":
    run_verification()
