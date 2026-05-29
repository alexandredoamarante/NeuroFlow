const { test, expect } = require('@playwright/test');

test.describe('NeuroFlow UX Polish Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
    // Ensure storage is initialized
    await page.evaluate(() => {
      if (!localStorage.getItem('neuroflow_tasks_workspace_id')) {
        localStorage.setItem('neuroflow_tasks_workspace_id', 'test-workspace');
      }
    });
    await page.reload();
  });

  test('Header buttons and dividers are correctly placed and ordered', async ({ page }) => {
    // Expected order: Theme, Info, Divider, Export, Import, Divider, Workspace
    const headerRight = page.locator('.header-right');
    const children = headerRight.locator('> *');

    // 0: themeToggle
    await expect(children.nth(0)).toHaveId('themeToggle');
    // 1: infoToggle
    await expect(children.nth(1)).toHaveId('infoToggle');
    // 2: Divider
    await expect(children.nth(2)).toHaveCSS('width', '1px');
    // 3: exportWorkspaceBtn
    await expect(children.nth(3)).toHaveId('exportWorkspaceBtn');
    // 4: importWorkspaceBtn
    await expect(children.nth(4)).toHaveId('importWorkspaceBtn');
    // 5: Divider
    await expect(children.nth(5)).toHaveCSS('width', '1px');
    // 6: authBtn
    await expect(children.nth(7)).toHaveId('authBtn'); // nth(6) is file input

    // Check that authBtn is visible (it should be flex after Auth.init())
    await expect(page.locator('#authBtn')).toBeVisible();
    await expect(page.locator('#authText')).toHaveText('Workspace');
  });

  test('Export and Import icons are present', async ({ page }) => {
    // Just verify the SVG exists and has paths
    await expect(page.locator('#exportWorkspaceBtn svg')).toBeVisible();
    await expect(page.locator('#importWorkspaceBtn svg')).toBeVisible();
  });

  test('Workspace Modal content matches requirements', async ({ page }) => {
    await page.click('#authBtn');
    const modal = page.locator('#workspaceModal');
    await expect(modal).toBeVisible();

    const modalContent = await page.locator('.modal-panel.small').innerText();

    expect(modalContent).toContain('Neuroaark salva tudo localmente');
    expect(modalContent).toContain('Para mover suas notas');
    expect(modalContent).toContain('Export Workspace');
    expect(modalContent).toContain('Import Workspace');

    // Verify buttons in modal
    await expect(page.locator('#exportWorkspaceBtnModal')).toBeVisible();
    await expect(page.locator('#importWorkspaceBtnModal')).toBeVisible();

    // Verify REMOVAL of technical elements
    await expect(page.locator('text=Workspace ID')).not.toBeVisible();
    await expect(page.locator('text=Trocar')).not.toBeVisible();
    await expect(page.locator('text=Sair')).not.toBeVisible();
  });
});
