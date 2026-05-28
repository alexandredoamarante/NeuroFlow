import { test, expect } from '@playwright/test';

test.describe('Infrastructure & Persistence Audit (Per-Task Model)', () => {

  test('Audit: Data created while authenticated is strictly synced to Supabase with user_id', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // 1. Setup Mock Auth Session
    await page.evaluate(() => {
      window.Storage._session = {
        user: { id: 'audit-user-123', email: 'audit@example.com' }
      };
    });

    // 2. Intercept Supabase UPSERT
    let interceptedPayload = null;
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (route.request().method() === 'POST') {
        interceptedPayload = JSON.parse(route.request().postData());
        console.log('intercepted POST payload:', JSON.stringify(interceptedPayload));
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 'db-id-123' }])
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
    await page.fill('input[placeholder="Nome da tarefa..."]', 'Audit Task');
    await page.click('button:has-text("Criar Tarefa")');

    // 4. Verify interception and User ID Resolution
    await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'SAVE_TASK_UPSERT'));

    expect(interceptedPayload).not.toBeNull();
    // Payload should be a single row object for per-task model
    const row = Array.isArray(interceptedPayload) ? interceptedPayload[0] : interceptedPayload;
    expect(row.user_id).toBe('audit-user-123');
    expect(row.nodes.name).toBe('Audit Task');
    expect(row.local_id).toBeDefined();

    // 5. Verify local storage also updated (resilience)
    const localTasks = await page.evaluate(async () => {
        return await window.Storage.getTasks();
    });
    expect(localTasks.length).toBe(1);
    expect(localTasks[0].name).toBe('Audit Task');
  });

  test('Audit: Fresh device adopts Cloud state authoritativeley on login', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // 1. Setup Mock Session
    await page.evaluate(() => {
      window.Storage._session = {
        user: { id: 'device-b-user' }
      };
    });

    // 2. Mock Supabase response for multiple tasks (per-task model)
    await page.route('**/rest/v1/tasks*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            user_id: 'device-b-user',
            local_id: 'task-1',
            nodes: { id: 'task-1', name: 'Cloud Task 1' }
          },
          {
            user_id: 'device-b-user',
            local_id: 'task-2',
            nodes: { id: 'task-2', name: 'Cloud Task 2' }
          }
        ])
      });
    });

    // Force revalidation
    await page.evaluate(() => window.Storage._revalidateTasks('neuroaark_tasks_user_device-b-user'));

    // 3. Verify UI reflects cloud data
    await expect(page.locator('.task-card')).toHaveCount(2);
    await expect(page.locator('.task-card').first()).toContainText('Cloud Task 1');
    await expect(page.locator('.task-card').last()).toContainText('Cloud Task 2');
  });

});
