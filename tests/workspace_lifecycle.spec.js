import { test, expect } from '@playwright/test';

test('Leave Workspace and automatic key generation', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // 1. Get current workspace ID
    const initialWsId = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(initialWsId).not.toBeNull();

    // 2. Click Sync -> Sair (Leave Workspace)
    await page.click('#authBtn');

    // Handle confirm dialog
    page.on('dialog', dialog => dialog.accept());
    await page.click('#leaveWorkspaceBtn');

    // 3. Wait for reload
    await page.waitForNavigation();

    // 4. Verify workspace changed
    const newWsId = await page.evaluate(() => window.Storage.getWorkspaceId());
    expect(newWsId).not.toBe(initialWsId);
    expect(newWsId).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
});

test('Workspace validation on join', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    const nonExistentWs = 'this-workspace-does-not-exist-9999';

    await page.click('#authBtn');
    await page.fill('#workspaceInput', nonExistentWs);

    // Capture dialog message to verify validation
    let dialogMessage = '';
    const dialogHandler = async (dialog) => {
        dialogMessage = dialog.message();
        console.log('Dialog caught:', dialogMessage);
        await dialog.dismiss();
    };
    page.on('dialog', dialogHandler);

    await page.click('#joinWorkspaceBtn');

    // Give it a moment for the async check to complete and dialog to show
    await page.waitForTimeout(500);

    // We expect a confirmation asking to create it because it doesn't exist
    expect(dialogMessage).toContain('não existe. Deseja criá-lo?');
});
