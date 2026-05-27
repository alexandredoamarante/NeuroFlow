import { test, expect } from '@playwright/test';

test.describe('Cloud-Only Persistence Enforcement', () => {
  test('Authenticated user tasks are NOT saved to localStorage', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // 1. Setup Mock Auth Session
    await page.evaluate(() => {
      localStorage.setItem('supabase.auth.token', JSON.stringify({
        currentSession: {
          user: { id: 'cloud-only-user', email: 'cloud@example.com' },
          access_token: 'fake-token'
        }
      }));
    });

    await page.reload();

    // 2. Intercept Supabase UPSERT to simulate successful cloud save
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 'fake-db-id' }])
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([])
        });
      }
    });

    // 3. Create a task
    await page.fill('input[placeholder="Nome da tarefa..."]', 'Cloud Only Task');
    await page.click('button:has-text("Criar Tarefa")');

    // 4. Wait for UI update (optimistic)
    await expect(page.locator('.task-card')).toContainText('Cloud Only Task');

    // 5. VERIFY: localStorage should NOT contain user-specific task data
    const localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
    const userKeys = localStorageKeys.filter(k => k.startsWith('neuroaark_tasks_user_'));

    console.log('LocalStorage Keys:', localStorageKeys);
    expect(userKeys.length).toBe(0);

    // 6. VERIFY: data exists in memory cache (internal)
    const memoryNodes = await page.evaluate(async () => {
        const tasks = await Storage.getTasks();
        return tasks;
    });
    expect(memoryNodes.length).toBe(1);
    expect(memoryNodes[0].name).toBe('Cloud Only Task');
  });

});
