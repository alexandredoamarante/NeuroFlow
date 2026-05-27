
import { test, expect } from '@playwright/test';

const mockSession = {
  user: { id: 'user-456', email: 'creator@example.com' },
  access_token: 'fake-token-2',
  refresh_token: 'fake-refresh-2',
  expires_at: Math.floor(Date.now() / 1000) + 3600
};

const BASE_URL = 'http://localhost:8080/index.html';

test.describe('Task Creation Regression', () => {

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

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
              // Simulate no existing tasks
              return route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: []
              });
          }
          if (method === 'POST' || method === 'PATCH') {
              return route.fulfill({
                  status: 200,
                  contentType: 'application/json',
                  json: [{ id: 'fake-id' }]
              });
          }
      }
      return route.continue();
    });

    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn' });
  });

  test('Authenticated user can create a task', async ({ page }) => {
    await page.goto(BASE_URL);

    // Ensure we are on the homepage and loaded
    await expect(page.locator('#taskNameInput')).toBeVisible();

    // Fill the form
    await page.fill('#taskNameInput', 'New Authenticated Task');
    await page.fill('#taskDescInput', 'Task description');

    // Click create
    await page.click('#createTaskBtn');

    // Check if the task appears in the grid
    const taskCard = page.locator('.task-card-title', { hasText: 'New Authenticated Task' });
    await expect(taskCard).toBeVisible({ timeout: 10000 });

    // Check if task count updated
    await expect(page.locator('#taskCount')).toContainText('1 tarefa');
  });

  test('Creation works even if hydration fetch fails initially', async ({ page }) => {
    let hydrationAttempted = false;

    await page.route('**/*.supabase.co/rest/v1/tasks?user_id=eq.user-456&local_id=eq.canonical_state&select=*', async route => {
        if (!hydrationAttempted) {
            hydrationAttempted = true;
            return route.fulfill({
                status: 500,
                contentType: 'application/json',
                json: { message: 'Transient Error' }
            });
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            json: []
        });
    });

    await page.goto(BASE_URL);

    await page.fill('#taskNameInput', 'Task After Failed Hydration');
    await page.click('#createTaskBtn');

    // If it works, the task should be visible despite the first hydration failure
    const taskCard = page.locator('.task-card-title', { hasText: 'Task After Failed Hydration' });
    await expect(taskCard).toBeVisible({ timeout: 10000 });
  });

  test('Lazy Hydration: Task persists even if initial hydration fetch was never called', async ({ page }) => {
    // 1. Intercept hydration fetch to simulate it hanging or being extremely slow
    // We don't fulfill it, effectively keeping hydration incomplete
    let hydrationCalled = false;
    await page.route('**/rest/v1/tasks?user_id=eq.user-456&local_id=eq.canonical_state&select=*', async route => {
        hydrationCalled = true;
        // Don't respond yet
    });

    await page.goto(BASE_URL);

    // 2. Create task.
    // This should work because getTasks is optimistic and _triggerCloudSync will queue it.
    await page.fill('#taskNameInput', 'Lazy Task');
    await page.click('#createTaskBtn');

    // 3. UI should show the task
    await expect(page.locator('.task-card-title', { hasText: 'Lazy Task' })).toBeVisible();

    // 4. Now fulfill the version check call that _syncTasksToCloud will make
    await page.route('**/rest/v1/tasks?user_id=eq.user-456&local_id=eq.canonical_state&select=version%2Cupdated_at%2Cnodes', async route => {
        route.fulfill({
            status: 200,
            json: { version: 1, nodes: [], updated_at: new Date().toISOString() }
        });
    });

    // We need to trigger the cloud sync if it was queued
    // In the real app, this happens after the 1500ms debounce
    await page.waitForTimeout(2000);

    // 5. Verify the app eventually marks itself as hydrated
    const isHydrated = await page.evaluate(() => Storage._hasCompletedInitialSync);
    expect(isHydrated).toBeTruthy();
  });
});
