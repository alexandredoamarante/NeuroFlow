# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/sync.spec.js >> Cross-device Sync (Single Document Model) >> Test D: Highlight comment persists
- Location: tests/sync.spec.js:119:7

# Error details

```
TimeoutError: page.click: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('.note-highlight')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - img [ref=e7]
      - generic [ref=e17]: neuroaark
    - generic [ref=e18]:
      - button "Sair" [ref=e19] [cursor=pointer]:
        - img [ref=e20]
        - generic [ref=e23]: Sair
      - button "Guia de formatação" [ref=e24] [cursor=pointer]:
        - img [ref=e25]
      - button "Alternar tema" [ref=e27] [cursor=pointer]:
        - img [ref=e28]
        - img [ref=e30]
  - generic [ref=e34]:
    - heading "Nova Tarefa" [level=2] [ref=e35]
    - generic [ref=e36]:
      - textbox "Nome da tarefa..." [ref=e37]
      - textbox "Descrição (opcional)..." [ref=e38]
      - generic [ref=e39]:
        - generic [ref=e40]: Cor
        - generic [ref=e41]:
          - button [ref=e42] [cursor=pointer]
          - button [ref=e43] [cursor=pointer]
          - button [ref=e44] [cursor=pointer]
          - button [ref=e45] [cursor=pointer]
          - button [ref=e46] [cursor=pointer]
          - button [ref=e47] [cursor=pointer]
          - button [ref=e48] [cursor=pointer]
          - button [ref=e49] [cursor=pointer]
          - button [ref=e50] [cursor=pointer]
          - button [ref=e51] [cursor=pointer]
          - button [ref=e52] [cursor=pointer]
          - button [ref=e53] [cursor=pointer]
          - button [ref=e54] [cursor=pointer]
          - button [ref=e55] [cursor=pointer]
          - button [ref=e56] [cursor=pointer]
          - button [ref=e57] [cursor=pointer]
          - button [ref=e58] [cursor=pointer]
          - button [ref=e59] [cursor=pointer]
      - button "Criar Tarefa" [ref=e60] [cursor=pointer]:
        - img [ref=e61]
        - text: Criar Tarefa
  - generic [ref=e63]:
    - generic [ref=e64]:
      - heading "Minhas Tarefas" [level=2] [ref=e65]
      - generic [ref=e66]: 1 tarefa
    - generic [ref=e68] [cursor=pointer]:
      - generic [ref=e71]: Test Task
      - generic [ref=e72]: Description
      - generic [ref=e73]:
        - generic [ref=e74]: 0 itens
        - generic [ref=e75]: 0 sessões
```

# Test source

```ts
  22  |                 id: 'h-1',
  23  |                 start: 0,
  24  |                 end: 4,
  25  |                 text: 'Note',
  26  |                 comment: 'Test comment',
  27  |                 color: 'rgba(250, 204, 21, 0.4)'
  28  |             }
  29  |         ]
  30  |       }
  31  |     ]
  32  |   }
  33  | ];
  34  |
  35  | const mockSession = {
  36  |   user: { id: 'user-123', email: 'test@example.com' },
  37  |   access_token: 'fake-token',
  38  |   refresh_token: 'fake-refresh',
  39  |   expires_at: Math.floor(Date.now() / 1000) + 3600
  40  | };
  41  |
  42  | const BASE_URL = 'http://localhost:8080/index.html';
  43  | const TASK_URL = (id) => `http://localhost:8080/task.html?id=${id}`;
  44  |
  45  | test.describe('Cross-device Sync (Single Document Model)', () => {
  46  |
  47  |   test.beforeEach(async ({ page }) => {
  48  |     page.on('console', msg => {
  49  |         const text = msg.text();
  50  |         console.log('BROWSER CONSOLE:', text);
  51  |         if (text.includes('Error')) console.error('BROWSER ERROR:', text);
  52  |     });
  53  |
  54  |     // Intercept all Supabase calls
  55  |     await page.route('**/*.supabase.co/**', async route => {
  56  |       const url = route.request().url();
  57  |       const method = route.request().method();
  58  |
  59  |       if (url.includes('/auth/v1/')) {
  60  |           return route.fulfill({
  61  |               status: 200,
  62  |               contentType: 'application/json',
  63  |               json: {
  64  |                   data: { session: mockSession, user: mockSession.user },
  65  |                   session: mockSession,
  66  |                   user: mockSession.user
  67  |               }
  68  |           });
  69  |       }
  70  |
  71  |       if (url.includes('/rest/v1/tasks')) {
  72  |           if (method === 'GET') {
  73  |               return route.fulfill({
  74  |                 status: 200,
  75  |                 contentType: 'application/json',
  76  |                 json: { local_id: 'canonical_state', nodes: mockTasks, user_id: 'user-123' }
  77  |               });
  78  |           }
  79  |           if (method === 'POST') {
  80  |               return route.fulfill({ status: 200 });
  81  |           }
  82  |       }
  83  |
  84  |       return route.continue();
  85  |     });
  86  |
  87  |     // Mock theme and session
  88  |     await page.addInitScript(({ session, projectId }) => {
  89  |         localStorage.setItem('neuroflow_theme', 'dark');
  90  |         localStorage.setItem(`sb-${projectId}-auth-token`, JSON.stringify(session));
  91  |     }, { session: mockSession, projectId: 'bdvwpyiabmmfsvsjytxn' });
  92  |   });
  93  |
  94  |   test('Test A & B & C: Logged-in user sees same data in new context', async ({ page }) => {
  95  |     await page.goto(BASE_URL);
  96  |
  97  |     // Wait for the task card
  98  |     const taskCard = page.locator('.task-card-title');
  99  |     await expect(taskCard).toHaveText('Test Task', { timeout: 15000 });
  100 |
  101 |     // Open task page
  102 |     // await page.click('.task-card');
  103 |     // Using direct navigation to avoid issues with .task-card click if it's not working
  104 |     await page.goto(TASK_URL('task-1'));
  105 |
  106 |     await expect(page).toHaveURL(/\/task(\.html)?/);
  107 |
  108 |     // Check if scripts are loaded
  109 |     const scriptCount = await page.evaluate(() => document.querySelectorAll('script[src^="js/"]').length);
  110 |     console.log(`Scripts loaded on task page: ${scriptCount}`);
  111 |
  112 |     await expect(page.locator('#taskPageTitle')).toHaveText('Test Task', { timeout: 15000 });
  113 |
  114 |     await expect(page.locator('.node-title')).toHaveText('Root Note');
  115 |     await expect(page.locator('.note-highlight')).toBeVisible();
  116 |     await expect(page.locator('.note-highlight')).toHaveText('Note');
  117 |   });
  118 |
  119 |   test('Test D: Highlight comment persists', async ({ page }) => {
  120 |       await page.goto(TASK_URL('task-1'));
  121 |
> 122 |       await page.click('.note-highlight', { timeout: 15000 });
      |                  ^ TimeoutError: page.click: Timeout 15000ms exceeded.
  123 |       await expect(page.locator('.comment-content')).toContainText('Test comment');
  124 |   });
  125 |
  126 |   test('Strict Cloud-First: New data overrides LocalStorage for logged-in user', async ({ page }) => {
  127 |     await page.addInitScript((userId) => {
  128 |         localStorage.setItem(`neuroaark_tasks_user_${userId}`, JSON.stringify([{ id: 'stale', name: 'Stale Task' }]));
  129 |     }, mockSession.user.id);
  130 |
  131 |     await page.goto(BASE_URL);
  132 |
  133 |     await expect(page.locator('.task-card-title')).toHaveText('Test Task', { timeout: 15000 });
  134 |     await expect(page.locator('text=Stale Task')).not.toBeVisible();
  135 |   });
  136 | });
  137 |
```