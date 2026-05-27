
import { test, expect } from '@playwright/test';

const mockSession = {
  user: { id: 'user-per-task', email: 'pertask@example.com' },
  access_token: 'fake-token-per',
  refresh_token: 'fake-refresh-per',
  expires_at: Math.floor(Date.now() / 1000) + 3600
};

const PROJECT_ID = 'bdvwpyiabmmfsvsjytxn';
const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Per-Task Model Persistence', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage and setup session
    await page.addInitScript(({ session, projectId }) => {
        localStorage.clear();
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: PROJECT_ID });

    // Global route for per-task Supabase interactions
    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/v1/')) {
          return route.fulfill({
              status: 200,
              json: { data: { user: mockSession.user, session: mockSession } }
          });
      }
      return route.continue();
    });
  });

  test('Creation: Task is saved as a separate row in Supabase with correct user_id', async ({ page }) => {
    let upsertedPayload = null;

    await page.route('**/*.supabase.co/rest/v1/tasks*', async route => {
      const method = route.request().method();
      if (method === 'GET') return route.fulfill({ status: 200, json: [] });
      if (method === 'POST') {
          const body = route.request().postDataJSON();
          if (body.local_id !== 'canonical_state') {
              upsertedPayload = body;
              console.log('intercepted POST payload:', JSON.stringify(body));
              return route.fulfill({ status: 200, json: [body] });
          }
      }
      return route.continue();
    });

    await page.goto(BASE_URL);
    await page.fill('#taskNameInput', 'Per Task Test');
    await page.click('#createTaskBtn');

    // UI Check
    await expect(page.locator('.task-card-title')).toHaveText('Per Task Test');

    // Wait for the network request instead of just the log
    await page.waitForResponse(resp =>
        resp.url().includes('/rest/v1/tasks') &&
        resp.request().method() === 'POST'
    );

    expect(upsertedPayload).not.toBeNull();
    expect(upsertedPayload.nodes.name).toBe('Per Task Test');
    expect(upsertedPayload.user_id).toBe(mockSession.user.id);
  });

  test('Migration: Legacy canonical_state is unpacked into individual rows', async ({ page }) => {
    const legacyTasks = [
        { id: 'legacy-1', name: 'Legacy Task 1', checklist: [] },
        { id: 'legacy-2', name: 'Legacy Task 2', checklist: [] }
    ];

    let upsertedLocalIds = [];
    let legacyDeleted = false;

    await page.route('**/*.supabase.co/rest/v1/tasks*', async route => {
      const method = route.request().method();
      const url = route.request().url();

      if (method === 'GET') {
          // Return legacy row
          return route.fulfill({
            status: 200,
            json: [{ user_id: mockSession.user.id, local_id: 'canonical_state', nodes: legacyTasks }]
          });
      }
      if (method === 'POST') {
          const body = route.request().postDataJSON();
          upsertedLocalIds.push(body.local_id);
          return route.fulfill({ status: 200, json: [body] });
      }
      if (method === 'DELETE' && url.includes('local_id=eq.canonical_state')) {
          legacyDeleted = true;
          return route.fulfill({ status: 200 });
      }
      return route.continue();
    });

    await page.goto(BASE_URL);

    // Both legacy tasks should appear in UI
    await expect(page.locator('.task-card-title', { hasText: 'Legacy Task 1' })).toBeVisible();
    await expect(page.locator('.task-card-title', { hasText: 'Legacy Task 2' })).toBeVisible();

    // Verify migration actions
    await page.waitForFunction((count) => {
        return window.__SUPABASE_LOGS__?.filter(l => l.action === 'SAVE_TASK_UPSERT').length >= count;
    }, legacyTasks.length);

    expect(upsertedLocalIds).toContain('legacy-1');
    expect(upsertedLocalIds).toContain('legacy-2');
  });
});
