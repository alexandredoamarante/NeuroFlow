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

    // Ensure workspace sync starts ONLY if enabled
    const wsId = Storage.getWorkspaceId();
    console.log('[WORKSPACE] Initializing with ID:', wsId, 'Sync enabled:', Storage.isSyncEnabled());
    if (Storage.isSyncEnabled()) {
      Storage.initRealtime(wsId);
    }

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
        proceed = confirm(`Deseja entrar no workspace "${newKey}"? A sincronização será ativada.`);
      } else {
        proceed = confirm(`O workspace "${newKey}" não existe. Deseja criá-lo e ativar a sincronização?`);
      }

      if (proceed) {
        console.log('[WORKSPACE_SWITCH] [START] Joining workspace:', newKey);

        // 1. Mark sync as enabled in storage state (but don't trigger push yet)
        localStorage.setItem('neuroaark_sync_enabled', 'true');

        // 2. Switch workspace. Since sync is now enabled, this will trigger hydration.
        // setWorkspaceId handles lifecycle reset, realtime, and initial sync.
        await Storage.setWorkspaceId(newKey, { replaceLocalState: true });

        this.updateUI();
        if (workspaceModal) workspaceModal.style.display = 'none';
        console.log('[WORKSPACE_SWITCH] [SUCCESS] Workspace joined and synced.');
        // Page reload removed as requested. Storage events will trigger UI updates.
      }
      joinWorkspaceBtn.disabled = false;
    });

    leaveWorkspaceBtn?.addEventListener('click', async () => {
      if (confirm('Tem certeza que deseja sair deste workspace? Você será movido para um novo workspace anônimo e o modo offline será ativado.')) {
        await Storage.leaveWorkspace();
        this.updateUI();
        // Page reload removed as requested.
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

    // Add "Enable Sync" button if currently offline
    let enableSyncContainer = workspaceModal.querySelector('#enableSyncContainer');
    if (!Storage.isSyncEnabled()) {
        if (!enableSyncContainer) {
            enableSyncContainer = document.createElement('div');
            enableSyncContainer.id = 'enableSyncContainer';
            enableSyncContainer.style.marginTop = '1rem';
            enableSyncContainer.innerHTML = `
                <button class="lg-btn primary sm w-full" id="enableSyncBtn">Ativar Sincronização em Nuvem</button>
                <p class="modal-text" style="font-size: 0.7rem; margin-top: 0.4rem; opacity: 0.7;">Isso enviará suas notas locais para a nuvem sob esta chave.</p>
            `;
            const displayBox = workspaceModal.querySelector('.workspace-display-box');
            displayBox.after(enableSyncContainer);

            document.getElementById('enableSyncBtn').addEventListener('click', async () => {
                if (confirm('Deseja ativar a sincronização em nuvem para este workspace?')) {
                    await Storage.setSyncEnabled(true);
                    this.updateUI();
                    // Page reload removed as requested.
                }
            });
        }
        enableSyncContainer.style.display = 'block';
    } else {
        if (enableSyncContainer) enableSyncContainer.style.display = 'none';
    }

    workspaceModal.style.display = 'flex';
  },

  /**
   * Updates the UI based on workspace state.
   */
  updateUI() {
    if (!authBtn || !authText) return;

    const isSynced = Storage.isSyncEnabled();
    authText.textContent = isSynced ? 'Synced' : 'Offline';

    if (isSynced) {
        authBtn.classList.add('primary');
        authBtn.classList.remove('ghost');
    } else {
        authBtn.classList.remove('primary');
        authBtn.classList.add('ghost');
    }

    const wsId = Storage.getWorkspaceId();
    authBtn.title = `Workspace: ${wsId} (${isSynced ? 'Sincronizado' : 'Local/Offline'})`;
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Auth.init());
} else {
  Auth.init();
}
