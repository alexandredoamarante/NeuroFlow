// TEMPORARILY DISABLED — unstable cloud synchronization architecture
// Restored offline-first mode for stability and data safety
// const SUPABASE_URL = "https://bdvwpyiabmmfsvsjytxn.supabase.co";
// const SUPABASE_ANON_KEY = "sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo";

const Storage = {
  // supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
  supabase: null,
  _debounceTimers: {},
  _revalidationPromises: {},
  _syncQueue: Promise.resolve(),
  _realtimeChannel: null,
  _realtimeDebounce: null,
  _offlineQueue: [],

  /**
   * Helper to append a task to the serial sync queue.
   * Ensures the queue never remains in a rejected state.
   */
  _enqueue(taskFn) {
    this._syncQueue = this._syncQueue
      .then(() => taskFn())
      .catch(err => {
        console.error('[QUEUE] [ERROR] Task in sync queue failed:', err);
        return null;
      });
    return this._syncQueue;
  },

  // Sync lifecycle state
  _hasCompletedInitialSync: true,
  _isHydrating: false,
  _isTransitioning: false,
  _suspendOutgoingSync: false,
  _failedColumns: new Set(),
  _deviceId: null,
  _workspaceId: null,
  _pendingRealtimeUpdates: [],
  _currentVersion: 0,
  _lastUpdatedAt: null,

  /**
   * Forensic logger for Supabase interactions.
   */
  _logNetwork(action, payload, response, error) {
    // console.log(`[NETWORK_LOG] ${action}`, payload, response, error);
  },

  getDeviceId() {
    if (this._deviceId) return this._deviceId;
    let id = localStorage.getItem('neuroaark_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now();
      localStorage.setItem('neuroaark_device_id', id);
    }
    this._deviceId = id;
    return id;
  },

  generateWorkspaceKey() {
    const words = [
      'swift', 'silent', 'bright', 'dark', 'cool', 'warm', 'fast', 'slow',
      'river', 'forest', 'peak', 'valley', 'ocean', 'plain', 'cloud', 'mist',
      'neon', 'glass', 'echo', 'flux', 'node', 'link', 'pulse', 'spark',
      'bold', 'calm', 'vivid', 'wild', 'pure', 'kind', 'brave', 'just'
    ];
    const w1 = words[Math.floor(Math.random() * words.length)];
    const w2 = words[Math.floor(Math.random() * words.length)];
    const num = Math.floor(Math.random() * 9000) + 1000;
    return `${w1}-${w2}-${num}`;
  },

  getWorkspaceId() {
    if (this._workspaceId) return this._workspaceId;
    let id = localStorage.getItem('neuroaark_workspace_id');
    if (!id) {
      id = this.generateWorkspaceKey();
      localStorage.setItem('neuroaark_workspace_id', id);
      // New users start with sync disabled (local offline mode)
      this.setSyncEnabled(false);
    }
    this._workspaceId = id;
    return id;
  },

  isSyncEnabled() {
    // TEMPORARILY DISABLED — unstable cloud synchronization architecture
    return false;
  },

  async setSyncEnabled(enabled) {
    // TEMPORARILY DISABLED — unstable cloud synchronization architecture
    console.log(`[SYNC] [STATE] Cloud sync is currently disabled for stability.`);
    localStorage.setItem('neuroaark_sync_enabled', 'false');
  },

  async checkWorkspaceExists(id) {
    // Since sync is disabled, we can't check remote.
    return false;
  },

  async resetWorkspaceLifecycle() {
    console.log('[WORKSPACE] [RESET] Resetting all lifecycle state...');
    this._hasCompletedInitialSync = true;
    this._realtimeChannel = null;
    this._isSubscribing = false;
    this._realtimeDebounce = null;
    this._debounceTimers = {};
    this._isHydrating = false;
    this._revalidationPromises = {};
    this._pendingRealtimeUpdates = [];
    this._syncQueue = Promise.resolve();
    this._currentVersion = 0;
    this._lastUpdatedAt = null;
  },

  async setWorkspaceId(id, options = {}) {
    if (!id) return;
    console.log(`[WORKSPACE] [SWITCH] Switching to workspace: ${id}`, options);

    this._isTransitioning = true;
    this._suspendOutgoingSync = true;
    this._hasCompletedInitialSync = true;

    await this.resetWorkspaceLifecycle();

    this._workspaceId = id;
    localStorage.setItem('neuroaark_workspace_id', id);

    // const key = await this.getTasksKey();
    // if (options.replaceLocalState) {
    //   console.log('[WORKSPACE] [CLEANUP] Clearing local state for new workspace');
    //   localStorage.removeItem(key);
    // }
    // Removing destructive cleanup to ensure data safety

    console.log('[WORKSPACE] [OFFLINE] Working in local mode.');

    this._isTransitioning = false;
    this._suspendOutgoingSync = false;
    window.dispatchEvent(new CustomEvent('workspaceChanged', { detail: { workspaceId: id } }));
  },

  async leaveWorkspace() {
    console.log('[WORKSPACE] [LEAVE] Leaving workspace. Returning to Offline Mode.');
    this._isTransitioning = true;
    this._suspendOutgoingSync = true;
    localStorage.setItem('neuroaark_sync_enabled', 'false');
    const newKey = this.generateWorkspaceKey();
    await this.setWorkspaceId(newKey);
    console.log('[WORKSPACE] [LEAVE] App returned to safe local mode.');
  },

  async getTasksKey() {
    const workspaceId = this.getWorkspaceId();
    return `neuroaark_tasks_ws_${workspaceId}`;
  },

  _getLocalState(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return { nodes: [], version: 0, updated_at: null, device_id: null };
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { nodes: parsed, version: 0, updated_at: null, device_id: null };
      return {
        nodes: parsed.nodes || [],
        version: parsed.version || 0,
        updated_at: parsed.updated_at || null,
        device_id: parsed.device_id || null
      };
    } catch (e) {
      return { nodes: [], version: 0, updated_at: null, device_id: null };
    }
  },

  _setLocalState(key, state) {
    localStorage.setItem(key, JSON.stringify(state));
  },

  async getTasks() {
    const key = await this.getTasksKey();
    const state = this._getLocalState(key);
    return state.nodes || [];
  },

  async getTask(id) {
    const key = await this.getTasksKey();
    const state = this._getLocalState(key);
    const tasks = state.nodes || [];
    return tasks.find(t => t.id === id);
  },

  async saveTask(task) {
    const key = await this.getTasksKey();
    task.version = Date.now();
    task.updated_at = new Date().toISOString();

    console.log(`[PERSISTENCE] [SAVE] Local save for task: ${task.id}`);

    const state = this._getLocalState(key);
    const tasks = [...(state.nodes || [])];
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx > -1) tasks[idx] = task; else tasks.push(task);

    const newState = { ...state, nodes: tasks, updated_at: new Date().toISOString() };
    this._setLocalState(key, newState);

    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: tasks }));
    return Promise.resolve();
  },

  async deleteTask(id) {
    const key = await this.getTasksKey();
    const state = this._getLocalState(key);
    const filtered = (state.nodes || []).filter(t => t.id !== id);
    this._setLocalState(key, { ...state, nodes: filtered, updated_at: new Date().toISOString() });
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: filtered }));
    return Promise.resolve();
  },

  async initRealtime(workspaceId) {
    // TEMPORARILY DISABLED — unstable cloud synchronization architecture
    console.log('[REALTIME] [SKIP] Realtime is disabled.');
  },

  async exportWorkspace() {
    const workspaceId = this.getWorkspaceId();
    const key = await this.getTasksKey();
    const state = this._getLocalState(key);

    const exportData = {
      workspaceId,
      timestamp: new Date().toISOString(),
      data: state
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workspace.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importWorkspace(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (!imported.workspaceId || !imported.data) {
            throw new Error('Invalid workspace file format.');
          }

          // 1. Create automatic backup
          const currentWorkspaceId = this.getWorkspaceId();
          const currentKey = await this.getTasksKey();
          const currentState = this._getLocalState(currentKey);
          const backupData = {
            workspaceId: currentWorkspaceId,
            timestamp: new Date().toISOString(),
            data: currentState,
            isBackup: true
          };
          const backupBlob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
          const backupUrl = URL.createObjectURL(backupBlob);
          const a = document.createElement('a');
          a.href = backupUrl;
          a.download = `workspace-backup-before-import.json`;
          a.click();
          URL.revokeObjectURL(backupUrl);

          // 2. Restore imported data
          const newWorkspaceId = imported.workspaceId;
          this._workspaceId = newWorkspaceId;
          localStorage.setItem('neuroaark_workspace_id', newWorkspaceId);
          const newKey = `neuroaark_tasks_ws_${newWorkspaceId}`;
          this._setLocalState(newKey, imported.data);

          window.dispatchEvent(new CustomEvent('workspaceChanged', { detail: { workspaceId: newWorkspaceId } }));
          window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: imported.data.nodes }));

          alert('Workspace importado com sucesso!');
          resolve();
        } catch (err) {
          alert('Erro ao importar workspace: ' + err.message);
          reject(err);
        }
      };
      reader.readAsText(file);
    });
  }
};

window.Storage = Storage;
