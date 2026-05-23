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
            "name": "Greentext Test",
            "color": "#3498db",
            "checklist": [
                { "text": ">greentext in checklist\nNormal line", "done": False },
                { "text": "<redtext here", "done": True }
            ],
            "nodes": [
                {
                    "id": "n1",
                    "text": ">greentext in title",
                    "body": "Body line 1\n>greentext in body\n<redtext in body",
                    "expanded": True,
                    "children": []
                }
            ]
        }

        page.add_init_script(f"localStorage.setItem('neuroflow_tasks', JSON.stringify([{json.dumps(mock_task)}]))")

        file_path = "file://" + os.path.abspath("task.html") + "?id=1"
        page.goto(file_path)
        page.wait_for_load_state("networkidle")

        # Screenshot specifically of the checklist and the tree
        page.screenshot(path="full_view.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    run_verification()
