
import { test, expect } from '@playwright/test';

const mockSession = {
  user: { id: 'user-audit', email: 'audit@example.com' },
  access_token: 'fake-token',
  refresh_token: 'fake-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 3600
};

const PROJECT_ID = 'bdvwpyiabmmfsvsjytxn';
const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Infrastructure & Persistence Audit (Per-Task Model)', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test('Audit: Data created while authenticated is strictly synced to Supabase with user_id', async ({ page }) => {
    let upsertedData = null;
    let upsertCount = 0;

    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/v1/')) {
          return route.fulfill({
              status: 200,
              json: {
                  session: mockSession,
                  user: mockSession.user,
                  data: { user: mockSession.user, session: mockSession }
              }
          });
      }

      if (url.includes('/rest/v1/tasks')) {
          if (method === 'GET') return route.fulfill({ status: 200, json: [] });
          if (method === 'POST') {
              const body = route.request().postDataJSON();
              upsertedData = body;
              upsertCount++;
              return route.fulfill({ status: 200, json: [body] });
          }
      }
      return route.continue();
    });

    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: PROJECT_ID });

    await page.goto(BASE_URL);

    await page.fill('#taskNameInput', 'Audit Task');
    await page.click('#createTaskBtn');

    await expect(page.locator('.task-card-title')).toHaveText('Audit Task');

    // Wait for async log
    await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'SAVE_TASK_UPSERT'));

    expect(upsertCount).toBeGreaterThan(0);
    expect(upsertedData.nodes.name).toBe('Audit Task');
    expect(upsertedData.user_id).toBe(mockSession.user.id);
  });

  test('Audit: Fresh device adopts Cloud state authoritativeley on login', async ({ page }) => {
    const cloudTasks = [
        { user_id: mockSession.user.id, local_id: 'task-1', nodes: { id: 'task-1', name: 'Cloud Task 1', checklist: [] } },
        { user_id: mockSession.user.id, local_id: 'task-2', nodes: { id: 'task-2', name: 'Cloud Task 2', checklist: [] } }
    ];

    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      if (url.includes('/auth/v1/')) {
          return route.fulfill({ status: 200, json: { data: { user: mockSession.user, session: mockSession } } });
      }
      if (url.includes('/rest/v1/tasks') && route.request().method() === 'GET') {
          return route.fulfill({ status: 200, json: cloudTasks });
      }
      return route.continue();
    });

    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: PROJECT_ID });

    await page.goto(BASE_URL);

    await expect(page.locator('.task-card-title', { hasText: 'Cloud Task 1' })).toBeVisible();
    await expect(page.locator('.task-card-title', { hasText: 'Cloud Task 2' })).toBeVisible();
  });
});
