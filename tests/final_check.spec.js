
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Workspace Final Stabilization', () => {

  test('Identity: Offline by Default and Toggle Sync', async ({ page }) => {
    await page.goto(BASE_URL);

    // 1. Initial State
    await expect(page.locator('#authText')).toHaveText('Offline');

    // 2. Create Task Offline
    await page.fill('#taskNameInput', 'Offline Task');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card-title')).toHaveText('Offline Task');

    // 3. Enable Sync
    await page.click('#authBtn');
    page.on('dialog', dialog => dialog.accept());

    // Mock Supabase
    await page.route('**/rest/v1/tasks*', async route => {
        await route.fulfill({ status: 201, json: [] });
    });

    await page.click('#enableSyncBtn');

    // 4. Verify Synced
    await expect(page.locator('#authText')).toHaveText('Synced', { timeout: 15000 });
    await expect(page.locator('.task-card-title')).toHaveText('Offline Task');
  });

  test('Safety: Hydration preserves local data', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => window.Storage.setSyncEnabled(true));
    await page.reload();

    // 1. Create local task
    await page.fill('#taskNameInput', 'Local Task');
    await page.click('#createTaskBtn');

    // 2. Mock empty remote response
    await page.route('**/rest/v1/tasks*', async route => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ status: 200, json: [] });
        } else {
            await route.continue();
        }
    });

    // 3. Trigger revalidation
    await page.evaluate(() => window.Storage._revalidateTasks('neuroaark_tasks_ws_test'));

    // 4. Verify task NOT deleted (Conservative Hydration Rule)
    await expect(page.locator('.task-card-title')).toHaveText('Local Task');
  });

  test('Leave Workspace: preserves remote and generates new key', async ({ page }) => {
    const WS1 = 'workspace-alpha';
    await page.goto(BASE_URL);

    // 1. Join WS1
    await page.click('#authBtn');
    await page.fill('#workspaceInput', WS1);
    page.on('dialog', dialog => dialog.accept());
    await page.click('#joinWorkspaceBtn');
    await expect(page.locator('#authText')).toHaveText('Synced');

    // 2. Intercept DELETE to detect accidental wipes
    let deleteCaught = false;
    await page.route('**/rest/v1/tasks*', async route => {
        if (route.request().method() === 'DELETE') deleteCaught = true;
        await route.continue();
    });

    // 3. Leave
    await page.click('#authBtn');
    await page.click('#leaveWorkspaceBtn');

    // 4. Verify state: App should be offline, no deletes sent, and have a NEW key
    await expect(page.locator('#authText')).toHaveText('Offline');
    expect(deleteCaught).toBe(false);
    const currentWs = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(currentWs).not.toBe(WS1);
    expect(currentWs).not.toBe('----');
  });

});
