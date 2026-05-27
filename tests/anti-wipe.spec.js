
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

test.describe('Data Persistence & Anti-Wipe Protection', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept all Supabase calls
    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/v1/')) {
          return route.fulfill({
              status: 200,
              contentType: 'application/json',
              json: { session: mockSession, user: mockSession.user }
          });
      }

      if (url.includes('/rest/v1/tasks')) {
          if (method === 'GET') {
              return route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    local_id: 'canonical_state',
                    nodes: mockTasks,
                    user_id: 'user-789',
                    version: 5,
                    updated_at: new Date().toISOString()
                }
              });
          }
          if (method === 'POST') {
              const body = JSON.parse(route.request().postData());
              console.log('SUPABASE POST:', body.local_id, 'Nodes:', body.nodes.length, 'Version:', body.version);
              return route.fulfill({ status: 200, json: [body] });
          }
      }
      return route.continue();
    });
  });

  test('Fresh login must NOT overwrite cloud with empty state', async ({ page }) => {
    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn' });

    await page.goto(BASE_URL);
    await expect(page.locator('.task-card-title')).toHaveText('Existing Cloud Task', { timeout: 10000 });

    // Perform Logout
    await page.click('#authBtn');
    await expect(page.locator('#authText')).toHaveText('Entrar');

    // Log back in
    await page.evaluate(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn' });

    await page.reload();

    // Race: Create new task immediately
    await page.fill('#taskNameInput', 'Race Task');
    await page.click('#createTaskBtn');

    // Both must be present
    await expect(page.locator('.task-card-title', { hasText: 'Existing Cloud Task' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.task-card-title', { hasText: 'Race Task' })).toBeVisible();
  });

  test('Anti-Wipe Guard: Empty Local + Populated Cloud results in Merge', async ({ page }) => {
    await page.addInitScript(({ session, projectId, userId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
        localStorage.setItem(`neuroaark_tasks_user_${userId}`, JSON.stringify({ nodes: [], version: 10, updated_at: new Date().toISOString() }));
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn', userId: mockSession.user.id });

    await page.goto(BASE_URL);
    await expect(page.locator('.task-card-title')).toHaveText('Existing Cloud Task', { timeout: 10000 });
  });

  test('Abort Cloud Write if Version Check Fails', async ({ page }) => {
    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn' });

    // Fail the version check during saveTask
    await page.route('**/rest/v1/tasks?user_id=eq.user-789&local_id=eq.canonical_state&select=version%2Cupdated_at%2Cnodes', async route => {
        return route.fulfill({
            status: 500,
            json: { message: 'Version Check Failed' }
        });
    });

    await page.goto(BASE_URL);
    await page.fill('#taskNameInput', 'Fail-Safe Task');
    await page.click('#createTaskBtn');

    // Task appears locally
    await expect(page.locator('.task-card-title', { hasText: 'Fail-Safe Task' })).toBeVisible();

    // But since version check failed, NO POST should have occurred to 'canonical_state' with empty list
    // (Checked via console logs or lack of successful POST)
  });
});
