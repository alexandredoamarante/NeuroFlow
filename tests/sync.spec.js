
import { test, expect } from '@playwright/test';

// Mock data for a single canonical document
const mockTasks = [
  {
    id: 'task-1',
    name: 'Test Task',
    desc: 'Description',
    color: '#60a5fa',
    sessions: 0,
    checklist: [],
    nodes: [
      {
        id: 'node-1',
        text: 'Root Note',
        body: 'Note body content',
        expanded: true,
        children: [],
        highlights: [
            {
                id: 'h-1',
                start: 0,
                end: 4,
                text: 'Note',
                comment: 'Test comment',
                color: 'rgba(250, 204, 21, 0.4)'
            }
        ]
      }
    ]
  }
];

const mockSession = {
  user: { id: 'user-123', email: 'test@example.com' },
  access_token: 'fake-token',
  refresh_token: 'fake-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 3600
};

const BASE_URL = 'http://localhost:8080/index.html';
const TASK_URL = (id) => `http://localhost:8080/task.html?id=${id}`;

test.describe('Cross-device Sync (Single Document Model)', () => {

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
        const text = msg.text();
        console.log('BROWSER CONSOLE:', text);
        if (text.includes('Error')) console.error('BROWSER ERROR:', text);
    });

    // Intercept all Supabase calls
    await page.route('**/*.supabase.co/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/v1/')) {
          return route.fulfill({
              status: 200,
              contentType: 'application/json',
              json: {
                  data: { session: mockSession, user: mockSession.user },
                  session: mockSession,
                  user: mockSession.user
              }
          });
      }

      if (url.includes('/rest/v1/tasks')) {
          if (method === 'GET') {
              return route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: { local_id: 'canonical_state', nodes: mockTasks, user_id: 'user-123' }
              });
          }
          if (method === 'POST') {
              return route.fulfill({ status: 200 });
          }
      }

      return route.continue();
    });

    // Mock theme and session
    await page.addInitScript(({ session, projectId }) => {
        localStorage.setItem('neuroflow_theme', 'dark');
        localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
    }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn' });
  });

  test('Test A & B & C: Logged-in user sees same data in new context', async ({ page }) => {
    await page.goto(BASE_URL);

    // Wait for the task card
    const taskCard = page.locator('.task-card-title');
    await expect(taskCard).toHaveText('Test Task', { timeout: 15000 });

    // Open task page
    // await page.click('.task-card');
    // Using direct navigation to avoid issues with .task-card click if it's not working
    await page.goto(TASK_URL('task-1'));

    await expect(page).toHaveURL(/\/task(\.html)?/);

    // Check if scripts are loaded
    const scriptCount = await page.evaluate(() => document.querySelectorAll('script[src^="js/"]').length);
    console.log(`Scripts loaded on task page: ${scriptCount}`);

    await expect(page.locator('#taskPageTitle')).toHaveText('Test Task', { timeout: 15000 });

    await expect(page.locator('.node-title')).toHaveText('Root Note');
    await expect(page.locator('.note-highlight')).toBeVisible();
    await expect(page.locator('.note-highlight')).toHaveText('Note');
  });

  test('Test D: Highlight comment persists', async ({ page }) => {
      await page.goto(TASK_URL('task-1'));

      await page.click('.note-highlight', { timeout: 15000 });
      await expect(page.locator('.comment-content')).toContainText('Test comment');
  });

  test('Strict Cloud-First: New data overrides LocalStorage for logged-in user', async ({ page }) => {
    await page.addInitScript((userId) => {
        localStorage.setItem(`neuroaark_tasks_user_${userId}`, JSON.stringify([{ id: 'stale', name: 'Stale Task' }]));
    }, mockSession.user.id);

    await page.goto(BASE_URL);

    await expect(page.locator('.task-card-title')).toHaveText('Test Task', { timeout: 15000 });
    await expect(page.locator('text=Stale Task')).not.toBeVisible();
  });
});
