const authBtn = document.getElementById('authBtn');
const authText = document.getElementById('authText');
const workspaceModal = document.getElementById('workspaceModal');
const workspaceClose = document.getElementById('workspaceClose');
const workspaceKeyDisplay = document.getElementById('workspaceKeyDisplay');
const workspaceInput = document.getElementById('workspaceInput');
const joinWorkspaceBtn = document.getElementById('joinWorkspaceBtn');
const copyWorkspaceKey = document.getElementById('copyWorkspaceKey');
const leaveWorkspaceBtn = document.getElementById('leaveWorkspaceBtn');

/**
 * Workspace management module for neuroaark.
 * Handles Workspace-key synchronization.
 */
const Auth = {
  async init() {
    console.log('[WORKSPACE] [TRACE] Auth module initializing.');
    if (!authBtn) return;

    // Workspace UI setup
    this.setupWorkspaceUI();

    // Repurposed: Auth button now opens workspace modal
    authBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openWorkspaceModal();
    });

    // Ensure workspace sync starts
    const wsId = Storage.getWorkspaceId();
    console.log('[WORKSPACE] Initializing with ID:', wsId);
    Storage.initRealtime(wsId);

    // Initial UI update
    this.updateUI();

    // Make button visible once initialized
    authBtn.style.display = 'flex';
  },

  setupWorkspaceUI() {
    workspaceClose?.addEventListener('click', () => {
      if (workspaceModal) workspaceModal.style.display = 'none';
    });

    workspaceModal?.addEventListener('click', (e) => {
      if (e.target === workspaceModal) workspaceModal.style.display = 'none';
    });

    copyWorkspaceKey?.addEventListener('click', () => {
      const key = Storage.getWorkspaceId();
      navigator.clipboard.writeText(key).then(() => {
        const originalSvg = copyWorkspaceKey.innerHTML;
        copyWorkspaceKey.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M20 6L9 17l-5-5"></path></svg>';
        setTimeout(() => { copyWorkspaceKey.innerHTML = originalSvg; }, 2000);
      });
    });

    joinWorkspaceBtn?.addEventListener('click', async () => {
      const newKey = workspaceInput.value.trim();
      if (!newKey) return;

      joinWorkspaceBtn.disabled = true;
      const exists = await Storage.checkWorkspaceExists(newKey);

      let proceed = false;
      if (exists) {
        proceed = confirm(`Deseja entrar no workspace "${newKey}"?`);
      } else {
        proceed = confirm(`O workspace "${newKey}" não existe. Deseja criá-lo?`);
      }

      if (proceed) {
        await Storage.setWorkspaceId(newKey, { replaceLocalState: true });
        this.updateUI();
        if (workspaceModal) workspaceModal.style.display = 'none';
        window.location.reload();
      }
      joinWorkspaceBtn.disabled = false;
    });

    leaveWorkspaceBtn?.addEventListener('click', async () => {
      if (confirm('Tem certeza que deseja sair deste workspace? Você será movido para um novo workspace anônimo.')) {
        await Storage.leaveWorkspace();
        window.location.reload();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && workspaceModal && workspaceModal.style.display === 'flex') {
        workspaceModal.style.display = 'none';
      }
    });
  },

  openWorkspaceModal() {
    if (!workspaceModal) return;
    workspaceKeyDisplay.textContent = Storage.getWorkspaceId();
    workspaceModal.style.display = 'flex';
  },

  /**
   * Updates the UI based on workspace state.
   */
  updateUI() {
    if (!authBtn || !authText) return;
    authText.textContent = 'Sync';
    const wsId = Storage.getWorkspaceId();
    authBtn.title = `Workspace: ${wsId}`;
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Auth.init());
} else {
  Auth.init();
}
