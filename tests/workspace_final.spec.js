
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Workspace Final Stabilization Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept all Supabase calls
    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/rest/v1/tasks')) {
        if (method === 'GET') {
          // Mock response based on workspace_id query param or header
          const searchParams = new URL(url).searchParams;
          const workspaceId = searchParams.get('workspace_id');

          // Default empty response
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            json: []
          });
        }
        if (method === 'POST') {
          return route.fulfill({ status: 201, json: [] });
        }
        if (method === 'DELETE') {
          return route.fulfill({ status: 200, json: [] });
        }
      }

      return route.continue();
    });
  });

  test('TEST 1 & 2: Persistence and Refresh', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => window.Storage.setSyncEnabled(true));

    // Wait for workspace to be generated
    const workspaceId = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(workspaceId).toBeDefined();

    // Intercept the SAVE call to verify workspace_id
    let savedPayload = null;
    await page.route('**/rest/v1/tasks*', async route => {
      if (route.request().method() === 'POST') {
        savedPayload = JSON.parse(route.request().postData());
        await route.fulfill({ status: 201, json: [] });
      } else {
        await route.continue();
      }
    });

    // Create a task
    await page.fill('#taskNameInput', 'Stable Task');
    await page.click('#createTaskBtn');

    // Verify task appears
    await expect(page.locator('.task-card-title')).toHaveText('Stable Task');

    // Verify payload sent to Supabase
    await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'SAVE_TASK_UPSERT'));
    expect(savedPayload).not.toBeNull();
    const row = Array.isArray(savedPayload) ? savedPayload[0] : savedPayload;
    expect(row.workspace_id).toBe(workspaceId);
    expect(row.nodes.name).toBe('Stable Task');

    // Refresh page
    // Mock the GET call to return the task we just "saved"
    await page.route('**/rest/v1/tasks*', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          json: [{
            workspace_id: workspaceId,
            local_id: row.local_id,
            nodes: row.nodes,
            version: row.version
          }]
        });
      } else {
        await route.continue();
      }
    });

    await page.reload();
    await expect(page.locator('.task-card-title')).toHaveText('Stable Task');
  });

  test('TEST 3: Rejoin Same Workspace', async ({ page }) => {
    const WS_KEY = 'test-workspace-123';

    await page.goto(BASE_URL);

    // Mock GET for this specific workspace
    await page.route('**/rest/v1/tasks*', async route => {
        if (route.request().method() === 'GET' && route.request().url().includes(`workspace_id=eq.${WS_KEY}`)) {
          await route.fulfill({
            status: 200,
            json: [{
              workspace_id: WS_KEY,
              local_id: 'task-remote',
              nodes: { id: 'task-remote', name: 'Remote Task' },
              version: Date.now()
            }]
          });
        } else {
          await route.fulfill({ status: 200, json: [] });
        }
    });

    // Join workspace
    await page.click('#authBtn');
    await page.fill('#workspaceInput', WS_KEY);

    // Handle the confirm dialog
    page.on('dialog', dialog => dialog.accept());
    await page.click('#joinWorkspaceBtn');

    // Page reloads after join
    await expect(page.locator('.task-card-title')).toHaveText('Remote Task', { timeout: 15000 });

    const currentWs = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(currentWs).toBe(WS_KEY);
  });

  test('TEST 5: Workspace Switching (No Ghost Data)', async ({ page }) => {
    await page.goto(BASE_URL);

    // Create local task in WS1
    const WS1 = await page.evaluate(() => window.Storage.getWorkspaceId());
    await page.fill('#taskNameInput', 'Task in WS1');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card-title')).toHaveText('Task in WS1');

    // Mock WS2 to be empty
    const WS2 = 'clean-workspace-456';
    await page.route('**/rest/v1/tasks*', async route => {
        if (route.request().url().includes(`workspace_id=eq.${WS2}`)) {
            await route.fulfill({ status: 200, json: [] });
        } else {
            await route.continue();
        }
    });

    // Switch to WS2
    await page.click('#authBtn');
    await page.fill('#workspaceInput', WS2);
    page.on('dialog', dialog => dialog.accept());
    await page.click('#joinWorkspaceBtn');

    // Verify WS1 data is GONE and WS2 is empty
    await expect(page.locator('.task-card-title')).not.toBeVisible();
    await expect(page.locator('#emptyState')).toBeVisible();

    const currentWs = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(currentWs).toBe(WS2);
  });

});
