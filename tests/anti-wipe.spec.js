import { test, expect } from '@playwright/test';

test('Logout preserves local user data', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // Login mock
    await page.evaluate(() => {
      window.Storage._session = { user: { id: 'wipe-user' } };
    });

    // Create task
    await page.fill('#taskNameInput', 'Safe Task');
    await page.click('#createTaskBtn');

    // Logout
    await page.click('#authBtn');

    // Verify user key still in localStorage
    const localData = await page.evaluate(() => localStorage.getItem('neuroaark_tasks_user_wipe-user'));
    expect(localData).not.toBeNull();
    expect(localData).toContain('Safe Task');
});
