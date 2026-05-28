import { test, expect } from '@playwright/test';

test.describe('Per-Task Model Persistence', () => {

  test('Creation: Task is saved as a separate row in Supabase with correct user_id', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // 1. Mock Session
    await page.evaluate(() => {
      window.Storage._session = {
        user: { id: 'user-per-task' }
      };
    });

    // 2. Intercept and verify POST
    let interceptedRow = null;
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (route.request().method() === 'POST') {
        interceptedRow = JSON.parse(route.request().postData());
        console.log('intercepted POST payload:', JSON.stringify(interceptedRow));
        await route.fulfill({ status: 201, body: '[]' });
      } else {
        await route.fulfill({ status: 200, body: '[]' });
      }
    });

    // 3. Create task
    const taskId = Date.now().toString();
    await page.evaluate((id) => {
        window.Storage.saveTask({ id: id, name: 'Per Task Test', desc: '', color: '#60a5fa', sessions: 0, checklist: [], nodes: [] });
    }, taskId);

    // 4. Validate payload
    await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'SAVE_TASK_UPSERT'));

    expect(interceptedRow).not.toBeNull();
    const row = Array.isArray(interceptedRow) ? interceptedRow[0] : interceptedRow;
    expect(row.local_id).toBe(taskId);
    expect(row.user_id).toBe('user-per-task');
  });

  test('Migration: Legacy canonical_state is unpacked into individual rows', async ({ page }) => {
    await page.goto('http://localhost:8080/');

    // 1. Mock Session
    await page.evaluate(() => {
      window.Storage._session = {
        user: { id: 'migration-user' }
      };
    });

    // 2. Mock legacy state response
    const legacyTasks = [
      { id: 'l1', name: 'Legacy 1' },
      { id: 'l2', name: 'Legacy 2' }
    ];

    await page.route('**/rest/v1/tasks*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          body: JSON.stringify([{ local_id: 'canonical_state', nodes: legacyTasks, user_id: 'migration-user' }])
        });
      } else {
        await route.fulfill({ status: 201, body: '[]' });
      }
    });

    // Force revalidation
    await page.evaluate(() => window.Storage._revalidateTasks('neuroaark_tasks_user_migration-user'));

    // 3. Verify migration triggered
    await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'MIGRATION_DELETE_LEGACY'));

    // Check if tasks were rendered
    await expect(page.locator('.task-card')).toHaveCount(2);
  });
});
