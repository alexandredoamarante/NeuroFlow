const authBtn = document.getElementById('authBtn');
const authText = document.getElementById('authText');
const workspaceModal = document.getElementById('workspaceModal');
const workspaceClose = document.getElementById('workspaceClose');

const exportWorkspaceBtn = document.getElementById('exportWorkspaceBtn');
const importWorkspaceBtn = document.getElementById('importWorkspaceBtn');
const exportWorkspaceBtnModal = document.getElementById('exportWorkspaceBtnModal');
const importWorkspaceBtnModal = document.getElementById('importWorkspaceBtnModal');
const workspaceFileInput = document.getElementById('workspaceFileInput');

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

    // Header buttons
    exportWorkspaceBtn?.addEventListener('click', () => {
      Storage.exportWorkspace();
    });

    importWorkspaceBtn?.addEventListener('click', () => {
      workspaceFileInput?.click();
    });

    // Modal buttons
    exportWorkspaceBtnModal?.addEventListener('click', () => {
      Storage.exportWorkspace();
    });

    importWorkspaceBtnModal?.addEventListener('click', () => {
      workspaceFileInput?.click();
    });

    workspaceFileInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await Storage.importWorkspace(file);
        e.target.value = ''; // Reset input
        this.updateUI();
      }
    });

    // Ensure workspace starts in local mode
    const wsId = Storage.getWorkspaceId();
    console.log('[WORKSPACE] Initializing with ID:', wsId);

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

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && workspaceModal && workspaceModal.style.display === 'flex') {
        workspaceModal.style.display = 'none';
      }
    });
  },

  openWorkspaceModal() {
    if (!workspaceModal) return;
    workspaceModal.style.display = 'flex';
  },

  /**
   * Updates the UI based on workspace state.
   */
  updateUI() {
    if (!authBtn || !authText) return;

    authText.textContent = 'Local';
    authBtn.classList.remove('primary');
    authBtn.classList.add('ghost');

    const wsId = Storage.getWorkspaceId();
    authBtn.title = `Workspace: ${wsId} (Local/Offline)`;
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Auth.init());
} else {
  Auth.init();
}
