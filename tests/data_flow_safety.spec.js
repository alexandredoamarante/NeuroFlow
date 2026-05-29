
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Workspace Data Flow Safety', () => {

  test('Safe Rejoin: empty remote does NOT wipe local data', async ({ page }) => {
    await page.goto(BASE_URL);

    // 1. App starts in Offline Mode. Create a local task.
    await page.fill('#taskNameInput', 'Identity Preservation Task');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card-title')).toHaveText('Identity Preservation Task');

    // 2. Open Sync modal and Join a "new" workspace that is empty remotely
    const NEW_WS = 'empty-remote-ws-' + Date.now();

    // Mock Supabase GET for this workspace to return EMPTY
    await page.route('**/rest/v1/tasks*', async route => {
        if (route.request().method() === 'GET' && route.request().url().includes(`workspace_id=eq.${NEW_WS}`)) {
            console.log('[TEST] Returning empty for WS:', NEW_WS);
            await route.fulfill({ status: 200, json: [] });
        } else {
            await route.continue();
        }
    });

    await page.click('#authBtn');
    await page.fill('#workspaceInput', NEW_WS);

    page.on('dialog', dialog => dialog.accept());

    // NOTE: Auth.js now calls setWorkspaceId(NEW_WS, {replaceLocalState: true})
    // This IS intended to clear previous workspace state.
    // BUT we want to verify that once joined, subsequent hydration refreshes
    // do not wipe the NEWLY created tasks in that workspace.

    await page.click('#joinWorkspaceBtn');

    // UI should show Synced
    await expect(page.locator('#authText')).toHaveText('Synced');

    // Previous task should be GONE (because of replaceLocalState: true during switch)
    await expect(page.locator('.task-card-title')).not.toBeVisible();

    // 3. Create a task in the NEW workspace
    await page.fill('#taskNameInput', 'New Workspace Task');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card-title')).toHaveText('New Workspace Task');

    // 4. Simulate a background hydration (e.g. from realtime or refresh)
    // that returns EMPTY (e.g. maybe Supabase just hasn't indexed the insert yet)
    await page.evaluate(() => window.Storage._revalidateTasks(window.Storage.getTasksKey()));

    // 5. Verify the task STILL EXISTS (Conservative Hydration Rule)
    await expect(page.locator('.task-card-title')).toHaveText('New Workspace Task');
  });

});
