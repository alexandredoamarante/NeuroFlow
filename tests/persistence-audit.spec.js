
import { test, expect } from '@playwright/test';

const mockSession = {
  user: { id: 'user-audit', email: 'audit@example.com' },
  access_token: 'fake-token',
  refresh_token: 'fake-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 3600
};

const PROJECT_ID = 'bdvwpyiabmmfsvsjytxn';
const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Infrastructure & Persistence Audit', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage for each test
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test('Audit: Data created while authenticated is strictly synced to Supabase', async ({ page }) => {
    let upsertedData = null;
    let upsertCount = 0;

    // Intercept Supabase calls
    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/v1/')) {
          return route.fulfill({
              status: 200,
              json: { session: mockSession, user: mockSession.user }
          });
      }

      if (url.includes('/rest/v1/tasks')) {
          if (method === 'GET') {
              // Initial fetch returns empty
              return route.fulfill({ status: 200, json: [] });
          }
          if (method === 'POST') {
              const body = route.request().postDataJSON();
              if (body.local_id === 'canonical_state') {
                  upsertedData = body;
                  upsertCount++;
                  return route.fulfill({ status: 200, json: [body] });
              }
          }
      }
      return route.continue();
    });

    // Login and Setup
    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: PROJECT_ID });

    await page.goto(BASE_URL);

    // Create a task
    await page.fill('#taskNameInput', 'Audit Task');
    await page.click('#createTaskBtn');

    // Wait for the task card to appear in UI
    await expect(page.locator('.task-card-title')).toHaveText('Audit Task');

    // Verify that a network request was sent to Supabase
    expect(upsertCount).toBeGreaterThan(0);
    expect(upsertedData).not.toBeNull();
    expect(upsertedData.nodes[0].name).toBe('Audit Task');
    expect(upsertedData.user_id).toBe(mockSession.user.id);
  });

  test('Audit: Fresh device adopts Cloud state authoritativeley on login', async ({ page }) => {
    const cloudTasks = [{ id: 'cloud-1', name: 'Cloud Task', nodes: [] }];

    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/v1/')) {
          return route.fulfill({ status: 200, json: { session: mockSession, user: mockSession.user } });
      }

      if (url.includes('/rest/v1/tasks')) {
          if (method === 'GET') {
              return route.fulfill({
                status: 200,
                json: { local_id: 'canonical_state', nodes: cloudTasks, version: 10, user_id: mockSession.user.id }
              });
          }
      }
      return route.continue();
    });

    // Simulate "Fresh Device" with no relevant localStorage
    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: PROJECT_ID });

    await page.goto(BASE_URL);

    // Should see cloud task
    await expect(page.locator('.task-card-title')).toHaveText('Cloud Task');

    // Verify localStorage was populated from cloud
    const localData = await page.evaluate((userId) => {
        return localStorage.getItem(`neuroaark_tasks_user_${userId}`);
    }, mockSession.user.id);

    const parsed = JSON.parse(localData);
    expect(parsed.nodes[0].name).toBe('Cloud Task');
    expect(parsed.version).toBe(10);
  });

  test('Audit: Stale local data is overwritten by Cloud state on login', async ({ page }) => {
    const cloudTasks = [{ id: 'cloud-2', name: 'Authoritative Cloud Task', nodes: [] }];

    // Pre-populate stale local data
    await page.addInitScript(({ userId }) => {
        localStorage.setItem(`neuroaark_tasks_user_${userId}`, JSON.stringify({
            nodes: [{ id: 'stale-1', name: 'Stale Local Task', nodes: [] }],
            version: 1,
            updated_at: new Date().toISOString()
        }));
    }, { userId: mockSession.user.id });

    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      if (url.includes('/rest/v1/tasks') && route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            json: { local_id: 'canonical_state', nodes: cloudTasks, version: 2, user_id: mockSession.user.id }
          });
      }
      return route.continue();
    });

    // Login
    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: PROJECT_ID });

    await page.goto(BASE_URL);

    // Should see cloud task, NOT stale local task
    await expect(page.locator('.task-card-title')).toHaveText('Authoritative Cloud Task');
    await expect(page.locator('text=Stale Local Task')).not.toBeVisible();
  });
});
