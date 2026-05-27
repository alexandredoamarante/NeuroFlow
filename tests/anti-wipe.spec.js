
import { test, expect } from '@playwright/test';

const mockTasks = [
  {
    id: 'task-existing',
    name: 'Existing Cloud Task',
    desc: 'Should not be deleted',
    color: '#60a5fa',
    sessions: 0,
    checklist: [],
    nodes: []
  }
];

const mockSession = {
  user: { id: 'user-789', email: 'persister@example.com' },
  access_token: 'fake-token-3',
  refresh_token: 'fake-refresh-3',
  expires_at: Math.floor(Date.now() / 1000) + 3600
};

const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Data Persistence & Anti-Wipe Protection (Legacy Migration)', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept all Supabase calls
    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/v1/')) {
          return route.fulfill({
              status: 200,
              contentType: 'application/json',
              json: { data: { user: mockSession.user, session: mockSession } }
          });
      }

      if (url.includes('/rest/v1/tasks')) {
          if (method === 'GET') {
              // Return as array (new model expectation)
              return route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: [{
                    local_id: 'canonical_state',
                    nodes: mockTasks,
                    user_id: 'user-789',
                    version: 5,
                    updated_at: new Date().toISOString()
                }]
              });
          }
          if (method === 'POST') {
              const body = route.request().postDataJSON();
              return route.fulfill({ status: 200, json: [body] });
          }
      }
      return route.continue();
    });
  });

  test('Fresh login must NOT overwrite cloud with empty state (via migration path)', async ({ page }) => {
    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn' });

    await page.goto(BASE_URL);
    // Should see task from canonical_state after migration/unpacking
    await expect(page.locator('.task-card-title')).toHaveText('Existing Cloud Task', { timeout: 15000 });

    // Perform Logout
    await page.click('#authBtn');
    await expect(page.locator('#authText')).toHaveText('Entrar');

    // Log back in
    await page.evaluate(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn' });

    await page.reload();

    // Create new task
    await page.fill('#taskNameInput', 'Race Task');
    await page.click('#createTaskBtn');

    // Both must be present
    await expect(page.locator('.task-card-title', { hasText: 'Existing Cloud Task' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.task-card-title', { hasText: 'Race Task' })).toBeVisible();
  });

  test('Anti-Wipe Guard: Migration handles empty local correctly', async ({ page }) => {
    await page.addInitScript(({ session, projectId, userId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
        // Empty local but cloud has canonical_state
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn', userId: mockSession.user.id });

    await page.goto(BASE_URL);
    await expect(page.locator('.task-card-title')).toHaveText('Existing Cloud Task', { timeout: 15000 });
  });
});
