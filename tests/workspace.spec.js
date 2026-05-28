import { test, expect } from '@playwright/test';

test('Workspace Creation and persistence', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // 1. Check if workspace key was generated
    const wsId = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(wsId).not.toBeNull();
    expect(wsId).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);

    // 2. Create task in current workspace
    await page.fill('#taskNameInput', 'Workspace Task');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card')).toContainText('Workspace Task');

    // 3. Refresh and verify persistence
    await page.reload();
    await expect(page.locator('.task-card')).toContainText('Workspace Task');
    const wsIdAfterReload = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(wsIdAfterReload).toBe(wsId);

    // 4. Join a new workspace
    const newWsId = 'test-workspace-1234';
    await page.click('#authBtn');
    await page.fill('#workspaceInput', newWsId);

    // Handle confirm dialog
    page.on('dialog', dialog => dialog.accept());
    await page.click('#joinWorkspaceBtn');

    // Wait for reload
    await page.waitForNavigation();

    // 5. Verify workspace changed and task is gone (new isolation)
    const wsIdAfterChange = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(wsIdAfterChange).toBe(newWsId);
    await expect(page.locator('.task-card')).toHaveCount(0);

    // 6. Create task in NEW workspace
    await page.fill('#taskNameInput', 'New WS Task');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card')).toContainText('New WS Task');

    // 7. Verify sync payload uses workspace_id
    await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'SAVE_TASK_UPSERT'));
    const logs = await page.evaluate(() => window.__SUPABASE_LOGS__);
    const saveLog = logs.find(l => l.action === 'SAVE_TASK_UPSERT');
    expect(saveLog.payload.workspace_id).toBe(newWsId);
});

test('Realtime subscription uses workspace_id', async ({ page }) => {
    await page.goto('http://localhost:8080/');
    const wsId = await page.evaluate(() => window.Storage.getWorkspaceId());

    // Check if initRealtime was called with workspaceId
    await page.waitForFunction(() => window.Storage._realtimeChannel !== null);

    const channelTopic = await page.evaluate(() => window.Storage._realtimeChannel.topic);
    expect(channelTopic).toContain(`workspace_id=eq.${wsId}`);
});
