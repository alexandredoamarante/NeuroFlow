# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/per-task.spec.js >> Per-Task Model Persistence >> Migration: Legacy canonical_state is unpacked into individual rows
- Location: tests/per-task.spec.js:42:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.waitForFunction: Test timeout of 60000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - img [ref=e7]
      - generic [ref=e17]: neuroaark
    - generic [ref=e18]:
      - button "Entrar" [ref=e19] [cursor=pointer]:
        - img [ref=e20]
        - generic [ref=e23]: Entrar
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
      - generic [ref=e66]: 0 tarefas
    - generic [ref=e68]:
      - generic [ref=e69]: —
      - paragraph [ref=e70]:
        - text: Nenhuma tarefa ainda.
        - text: Crie sua primeira acima.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  |
  3  | test.describe('Per-Task Model Persistence', () => {
  4  |
  5  |   test('Creation: Task is saved as a separate row in Supabase with correct user_id', async ({ page }) => {
  6  |     await page.goto('http://localhost:8080/');
  7  |
  8  |     // 1. Mock Session
  9  |     await page.evaluate(() => {
  10 |       window.Storage._session = {
  11 |         user: { id: 'user-per-task' }
  12 |       };
  13 |     });
  14 |
  15 |     // 2. Intercept and verify POST
  16 |     let interceptedRow = null;
  17 |     await page.route('**/rest/v1/tasks*', async (route) => {
  18 |       if (route.request().method() === 'POST') {
  19 |         interceptedRow = JSON.parse(route.request().postData());
  20 |         console.log('intercepted POST payload:', JSON.stringify(interceptedRow));
  21 |         await route.fulfill({ status: 201, body: '[]' });
  22 |       } else {
  23 |         await route.fulfill({ status: 200, body: '[]' });
  24 |       }
  25 |     });
  26 |
  27 |     // 3. Create task
  28 |     const taskId = Date.now().toString();
  29 |     await page.evaluate((id) => {
  30 |         window.Storage.saveTask({ id: id, name: 'Per Task Test', desc: '', color: '#60a5fa', sessions: 0, checklist: [], nodes: [] });
  31 |     }, taskId);
  32 |
  33 |     // 4. Validate payload
  34 |     await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'SAVE_TASK_UPSERT'));
  35 |
  36 |     expect(interceptedRow).not.toBeNull();
  37 |     const row = Array.isArray(interceptedRow) ? interceptedRow[0] : interceptedRow;
  38 |     expect(row.local_id).toBe(taskId);
  39 |     expect(row.user_id).toBe('user-per-task');
  40 |   });
  41 |
  42 |   test('Migration: Legacy canonical_state is unpacked into individual rows', async ({ page }) => {
  43 |     await page.goto('http://localhost:8080/');
  44 |
  45 |     // 1. Mock Session
  46 |     await page.evaluate(() => {
  47 |       window.Storage._session = {
  48 |         user: { id: 'migration-user' }
  49 |       };
  50 |     });
  51 |
  52 |     // 2. Mock legacy state response
  53 |     const legacyTasks = [
  54 |       { id: 'l1', name: 'Legacy 1' },
  55 |       { id: 'l2', name: 'Legacy 2' }
  56 |     ];
  57 |
  58 |     await page.route('**/rest/v1/tasks*', async (route) => {
  59 |       if (route.request().method() === 'GET') {
  60 |         await route.fulfill({
  61 |           status: 200,
  62 |           body: JSON.stringify([{ local_id: 'canonical_state', nodes: legacyTasks, user_id: 'migration-user' }])
  63 |         });
  64 |       } else {
  65 |         await route.fulfill({ status: 201, body: '[]' });
  66 |       }
  67 |     });
  68 |
  69 |     // Force revalidation
  70 |     await page.evaluate(() => window.Storage._revalidateTasks('neuroaark_tasks_user_migration-user'));
  71 |
  72 |     // 3. Verify migration triggered
> 73 |     await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'MIGRATION_DELETE_LEGACY'));
     |                ^ Error: page.waitForFunction: Test timeout of 60000ms exceeded.
  74 |
  75 |     // Check if tasks were rendered
  76 |     await expect(page.locator('.task-card')).toHaveCount(2);
  77 |   });
  78 | });
  79 |
```