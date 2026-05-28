import { test, expect } from '@playwright/test';

test('Creation and local persistence (resilience)', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // 1. Create task anonymously
    await page.fill('#taskNameInput', 'Anon Task');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card')).toContainText('Anon Task');

    // 2. Refresh and verify persistence
    await page.reload();
    await expect(page.locator('.task-card')).toContainText('Anon Task');

    // 3. Login mock
    await page.evaluate(() => {
      window.Storage._session = { user: { id: 'test-user-123' } };
    });

    // 4. Create task while "authenticated"
    await page.fill('#taskNameInput', 'Auth Task');
    await page.click('#createTaskBtn');
    await expect(page.locator('.task-card')).toContainText('Auth Task');

    // 5. Verify local key exists
    const localData = await page.evaluate(() => localStorage.getItem('neuroaark_tasks_user_test-user-123'));
    expect(localData).not.toBeNull();
    expect(localData).toContain('Auth Task');
});
