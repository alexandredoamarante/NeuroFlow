
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Identity Lifecycle Stabilization', () => {

  test('First Access: Offline Mode by Default', async ({ page }) => {
    await page.goto(BASE_URL);

    // 1. Verify UI shows Offline
    await expect(page.locator('#authText')).toHaveText('Offline');

    // 2. Verify Storage state
    const isSyncEnabled = await page.evaluate(() => window.Storage.isSyncEnabled());
    expect(isSyncEnabled).toBe(false);

    const wsId = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(wsId).toBeDefined();

    // 3. Create a local task
    await page.fill('#taskNameInput', 'Local Task');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card-title')).toHaveText('Local Task');

    // 4. Verify NO remote calls were made
    let remoteCallMade = false;
    await page.route('**/*.supabase.co/**', async route => {
        remoteCallMade = true;
        await route.continue();
    });

    await page.reload();
    expect(remoteCallMade).toBe(false);
    await expect(page.locator('.task-card-title')).toHaveText('Local Task');
  });

  test('Enable Sync: Propagates Local Data to Cloud', async ({ page }) => {
    await page.goto(BASE_URL);

    // 1. Create local task
    await page.fill('#taskNameInput', 'Migrating Task');
    await page.click('#createTaskBtn');

    // 2. Mock Supabase UPSERT
    let interceptedCount = 0;
    await page.route('**/rest/v1/tasks*', async route => {
        if (route.request().method() === 'POST') {
            interceptedCount++;
            await route.fulfill({ status: 201, json: [] });
        } else {
            await route.fulfill({ status: 200, json: [] });
        }
    });

    // 3. Enable Sync (bypass UI for reliable interception in test)
    await page.evaluate(async () => {
        await window.Storage.setSyncEnabled(true);
    });

    // Wait for the serial queue to finish
    await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'SAVE_TASK_UPSERT'));

    // 4. Verify cloud sync triggered
    expect(interceptedCount).toBeGreaterThan(0);
  });

  test('Leave Workspace: Returns to Offline Mode & Preserves Remote', async ({ page }) => {
    await page.goto(BASE_URL);

    // 1. Manually enable sync
    await page.evaluate(() => {
        window.Storage.setSyncEnabled(true);
        localStorage.setItem('neuroaark_workspace_id', 'remote-ws-123');
    });
    await page.reload();
    await expect(page.locator('#authText')).toHaveText('Synced');

    // 2. Intercept and verify NO deletes sent to remote-ws-123 during leave
    let deleteDetected = false;
    await page.route('**/rest/v1/tasks*', async route => {
        if (route.request().method() === 'DELETE' && route.request().url().includes('workspace_id=eq.remote-ws-123')) {
            deleteDetected = true;
        }
        await route.continue();
    });

    // 3. Leave workspace
    await page.click('#authBtn');
    page.on('dialog', dialog => dialog.accept());
    await page.click('#leaveWorkspaceBtn');

    // 4. Verify app is offline and on a NEW key
    await expect(page.locator('#authText')).toHaveText('Offline');
    const newWsId = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(newWsId).not.toBe('remote-ws-123');
    expect(deleteDetected).toBe(false);
  });

});
