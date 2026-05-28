# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/critical_persistence_final.spec.js >> Critical Persistence Logic (Mocked) >> Data survives refresh and rejoin
- Location: tests/critical_persistence_final.spec.js:30:9

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForNavigation: Test timeout of 30000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - img [ref=e7]
        - generic [ref=e17]: neuroaark
      - generic [ref=e18]:
        - button "Sync" [ref=e19] [cursor=pointer]:
          - img [ref=e20]
          - generic [ref=e23]: Sync
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
  - generic [ref=e72]:
    - heading "Sincronização" [level=3] [ref=e73]
    - paragraph [ref=e74]: Sincronize seus dados entre dispositivos usando sua chave de workspace.
    - generic [ref=e75]:
      - code [ref=e76]: mist-cloud-6897
      - button "Copiar chave" [ref=e77] [cursor=pointer]:
        - img [ref=e78]
    - generic [ref=e81]:
      - paragraph [ref=e82]: "Entrar em outro workspace:"
      - generic [ref=e83]:
        - textbox "cole-sua-chave-aqui" [ref=e84]: mist-river-1904
        - button "OK" [disabled] [ref=e85] [cursor=pointer]
    - generic [ref=e86]:
      - button "Sair" [ref=e87] [cursor=pointer]
      - button "Fechar" [ref=e88] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  |
  3  | test.describe('Critical Persistence Logic (Mocked)', () => {
  4  |     let mockDb = [];
  5  |
  6  |     test.beforeEach(async ({ page }) => {
  7  |         mockDb = [];
  8  |         await page.route('**/rest/v1/tasks*', async (route) => {
  9  |             const method = route.request().method();
  10 |             const url = new URL(route.request().url());
  11 |             const workspaceId = url.searchParams.get('workspace_id')?.split('.')[1];
  12 |
  13 |             if (method === 'GET') {
  14 |                 const data = mockDb.filter(r => r.workspace_id === workspaceId);
  15 |                 await route.fulfill({ status: 200, body: JSON.stringify(data) });
  16 |             } else if (method === 'POST') {
  17 |                 const payload = JSON.parse(route.request().postData());
  18 |                 const rows = Array.isArray(payload) ? payload : [payload];
  19 |
  20 |                 rows.forEach(row => {
  21 |                     const idx = mockDb.findIndex(r => r.workspace_id === row.workspace_id && r.local_id === row.local_id);
  22 |                     if (idx > -1) mockDb[idx] = { ...mockDb[idx], ...row };
  23 |                     else mockDb.push(row);
  24 |                 });
  25 |                 await route.fulfill({ status: 201, body: JSON.stringify(rows) });
  26 |             }
  27 |         });
  28 |     });
  29 |
  30 |     test('Data survives refresh and rejoin', async ({ page }) => {
  31 |         await page.goto('http://localhost:8080/');
  32 |
  33 |         // 1. Create a workspace and a task
  34 |         const wsId = await page.evaluate(() => window.Storage.getWorkspaceId());
  35 |         const taskName = 'Persistent Task';
  36 |
  37 |         await page.fill('#taskNameInput', taskName);
  38 |         await page.click('#createTaskBtn');
  39 |         await expect(page.locator('.task-card')).toContainText(taskName);
  40 |
  41 |         // 2. Wait for remote sync
  42 |         await page.waitForFunction(() => window.__SUPABASE_LOGS__?.some(l => l.action === 'SAVE_TASK_UPSERT'));
  43 |
  44 |         // 3. REFRESH PAGE
  45 |         await page.reload();
  46 |         await expect(page.locator('.task-card')).toContainText(taskName);
  47 |
  48 |         // 4. LEAVE AND REJOIN SAME KEY
  49 |         page.on('dialog', async dialog => {
  50 |             await dialog.accept();
  51 |         });
  52 |
  53 |         await page.click('#authBtn');
  54 |         await page.click('#leaveWorkspaceBtn');
  55 |         await page.waitForNavigation();
  56 |
  57 |         await expect(page.locator('.task-card')).toHaveCount(0);
  58 |
  59 |         // Rejoin the original
  60 |         await page.click('#authBtn');
  61 |         await page.fill('#workspaceInput', wsId);
  62 |         await page.click('#joinWorkspaceBtn');
> 63 |         await page.waitForNavigation();
     |                    ^ Error: page.waitForNavigation: Test timeout of 30000ms exceeded.
  64 |
  65 |         // 5. FINAL VERIFICATION
  66 |         await expect(page.locator('.task-card')).toContainText(taskName);
  67 |     });
  68 | });
  69 |
```