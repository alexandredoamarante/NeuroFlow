const SUPABASE_URL = "https://bdvwpyiabmmfsvsjytxn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo";

const Storage = {
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
  _session: null,
  _sessionPromise: null,
  _lastCheck: 0,
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
  _hasCompletedInitialSync: false,
  _isHydrating: false,
  _deviceId: null,
  _workspaceId: null,
  _pendingRealtimeUpdates: [],
  _currentVersion: 0,
  _lastUpdatedAt: null,

  /**
   * Forensic logger for Supabase interactions.
   */
  _logNetwork(action, payload, response, error) {
    const timestamp = new Date().toISOString();

    const logEntry = {
      timestamp,
      action,
      payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
      response: response ? JSON.parse(JSON.stringify(response)) : null,
      error: error ? { message: error.message, details: error.details, code: error.code } : null
    };

    console.group(`[FORENSIC] [${timestamp}] ${action}`);
    if (payload) console.log('Payload:', logEntry.payload);
    if (response) console.log('Response:', logEntry.response);
    if (error) console.error('Error Details:', error);
    console.groupEnd();

    if (!window.__SUPABASE_LOGS__) window.__SUPABASE_LOGS__ = [];
    window.__SUPABASE_LOGS__.push(JSON.parse(JSON.stringify(logEntry)));
    if (window.__SUPABASE_LOGS__.length > 100) window.__SUPABASE_LOGS__.shift();
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
    }
    this._workspaceId = id;
    return id;
  },

  async setWorkspaceId(id) {
    if (!id) return;
    this._workspaceId = id;
    localStorage.setItem('neuroaark_workspace_id', id);

    // Reset sync state for new workspace
    this._hasCompletedInitialSync = false;
    const key = await this.getTasksKey();

    // Clear old realtime
    if (this._realtimeChannel) {
      await this.supabase.removeChannel(this._realtimeChannel);
      this._realtimeChannel = null;
    }

    // Trigger immediate hydration and realtime init
    await this.initRealtime(id);
    await this._revalidateTasks(key);
  },

  async getSession() {
    if (this._sessionPromise) return this._sessionPromise;

    const now = Date.now();
    if (this._session && (now - this._lastCheck < 30000)) return this._session;

    this._sessionPromise = (async () => {
      try {
        const { data: { session }, error } = await this.supabase.auth.getSession();
        if (error) throw error;
        this._session = session;
        this._lastCheck = Date.now();
        return session;
      } catch (e) {
        console.error('[AUTH] Session fetch error:', e.message);
        return null;
      } finally {
        this._sessionPromise = null;
      }
    })();

    return this._sessionPromise;
  },

  async requireUser() {
    try {
      const { data: { session }, error } = await this.supabase.auth.getSession();
      if (error || !session || !session.user || !session.user.id) {
        return null;
      }
      this._session = session;
      this._lastCheck = Date.now();
      return session.user;
    } catch (e) {
      console.error('[AUTH] requireUser error:', e.message);
      return null;
    }
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

    if (!this._hasCompletedInitialSync && !this._revalidationPromises[key]) {
      this._revalidateTasks(key);
    }
    const state = this._getLocalState(key);
    return state.nodes || [];
  },

  async getTask(id) {
    const key = await this.getTasksKey();

    if (!this._hasCompletedInitialSync && !this._revalidationPromises[key]) {
      this._revalidateTasks(key);
    }
    const state = this._getLocalState(key);
    const tasks = state.nodes || [];
    return tasks.find(t => t.id === id);
  },

  async _revalidateTasks(key) {
    if (this._revalidationPromises[key]) return this._revalidationPromises[key];

    this._revalidationPromises[key] = (async () => {
      try {
        const workspaceId = this.getWorkspaceId();

        // Ensure realtime is active
        if (!this._realtimeChannel && !this._isSubscribing) {
          this.initRealtime(workspaceId);
        }

        const user = await this.requireUser(); // Optional for compatibility

        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('workspace_id', workspaceId);

        this._logNetwork('FETCH_ALL_TASKS', { workspaceId }, data, error);

        if (error) {
          console.error('[HYDRATE] Supabase fetch error:', error.message);
          return this._getLocalState(key).nodes;
        }

        const dataArray = Array.isArray(data) ? data : (data ? [data] : []);
        const localState = this._getLocalState(key);
        let localTasks = [...(localState.nodes || [])];
        let hasChanges = false;

        let legacyState = dataArray.find(r => r.local_id === 'canonical_state');
        if (legacyState) {
          const remoteTasks = legacyState.nodes || [];
          // Legacy mode: overwrite local with canonical if it exists
          localTasks = remoteTasks;
          hasChanges = true;
          this._migrateLegacyData(user, workspaceId, legacyState);
        } else {
          // Per-task mode: surgical merge based on version
          dataArray.filter(r => r.local_id !== 'canonical_state').forEach(remoteRow => {
            const remoteTask = remoteRow.nodes;
            const remoteVersion = remoteRow.version || 0;
            const localIdx = localTasks.findIndex(t => String(t.id) === String(remoteRow.local_id));

            if (localIdx === -1) {
              localTasks.push(remoteTask);
              hasChanges = true;
            } else {
              const localTask = localTasks[localIdx];
              const localVersion = localTask.version || 0;
              if (remoteVersion > localVersion) {
                localTasks[localIdx] = remoteTask;
                hasChanges = true;
              }
            }
          });
        }

        if (hasChanges || !this._hasCompletedInitialSync) {
          const newState = {
            ...localState,
            nodes: localTasks,
            updated_at: new Date().toISOString(),
            device_id: this.getDeviceId()
          };
          this._setLocalState(key, newState);
          window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: localTasks }));
        }

        this._hasCompletedInitialSync = true;
        return localTasks;
      } catch (e) {
        console.error('[HYDRATE] Hydration exception:', e);
        return this._getLocalState(key).nodes;
      } finally {
        setTimeout(() => { delete this._revalidationPromises[key]; }, 100);
      }
    })();

    return this._revalidationPromises[key];
  },

  async _migrateLegacyData(user, workspaceId, legacyState) {
    const tasks = legacyState.nodes || [];

    for (const task of tasks) {
      const payload = {
        user_id: user ? user.id : null,
        workspace_id: workspaceId,
        local_id: String(task.id),
        nodes: task,
        version: 1,
        device_id: this.getDeviceId()
      };
      const { data, error } = await this.supabase.from('tasks').upsert(payload, { onConflict: 'workspace_id,local_id' });
      this._logNetwork('SAVE_TASK_UPSERT', payload, data, error);
    }

    const { data: delData, error: delError } = await this.supabase.from('tasks').delete().match({ workspace_id: workspaceId, local_id: 'canonical_state' });
    this._logNetwork('MIGRATION_DELETE_LEGACY', { workspaceId }, delData, delError);
  },

  async saveTask(task) {
    const key = await this.getTasksKey();

    // Attach version for conflict resolution
    task.version = Date.now();
    task.updated_at = new Date().toISOString();

    // 1. OPTIMISTIC UPDATE: Local cache immediately
    const state = this._getLocalState(key);
    const tasks = [...(state.nodes || [])];
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx > -1) tasks[idx] = task; else tasks.push(task);

    const newState = { ...state, nodes: tasks, updated_at: new Date().toISOString() };
    this._setLocalState(key, newState);

    // 2. INSTANT FEEDBACK: Dispatch event so UI re-renders immediately
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: tasks }));

    // 3. BACKGROUND SYNC: Enqueue Supabase operation
    const runUpsert = async () => {
      const workspaceId = this.getWorkspaceId();
      const user = await this.requireUser(); // Optional for compatibility

      const payload = {
        user_id: user ? user.id : null,
        workspace_id: workspaceId,
        local_id: String(task.id),
        nodes: JSON.parse(JSON.stringify(task)),
        version: task.version,
        device_id: this.getDeviceId()
      };

      const { data, error } = await this.supabase.from('tasks').upsert(payload, { onConflict: 'workspace_id,local_id' }).select();
      this._logNetwork('SAVE_TASK_UPSERT', { ...payload }, data, error);

      if (error) {
        console.error('[SYNC] Supabase upsert failed:', error);
        throw error;
      }

      // Re-dispatch after cloud confirmation to ensure UI reflects final state
      const finalTasks = this._getLocalState(key).nodes;
      window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: finalTasks }));
    };

    return this._enqueue(runUpsert);
  },

  async deleteTask(id) {
    const key = await this.getTasksKey();

    // 1. OPTIMISTIC DELETE: Local cache immediately
    const state = this._getLocalState(key);
    const filtered = (state.nodes || []).filter(t => t.id !== id);
    this._setLocalState(key, { ...state, nodes: filtered, updated_at: new Date().toISOString() });

    // 2. INSTANT FEEDBACK: UI updates now
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: filtered }));

    // 3. BACKGROUND SYNC
    const runDelete = async () => {
      const workspaceId = this.getWorkspaceId();
      const { data, error } = await this.supabase.from('tasks').delete().match({ workspace_id: workspaceId, local_id: id });
      this._logNetwork('DELETE_TASK', { local_id: id, workspaceId }, data, error);

      if (error) {
        console.error('[SYNC] Supabase deletion failed:', error);
        throw error;
      }

      const finalTasks = this._getLocalState(key).nodes;
      window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: finalTasks }));
    };

    return this._enqueue(runDelete);
  },

  async syncOnLogin() {
    // Legacy support, mostly redundant now
    try {
      const { data: { user } } = await this.supabase.auth.getUser();
      const workspaceId = this.getWorkspaceId();
      const key = await this.getTasksKey();

      await this.initRealtime(workspaceId);
      this._hasCompletedInitialSync = false;
      await this._revalidateTasks(key);

      if (user) {
        await this._runMigration({ user }, key);
      }
    } catch (e) {
      console.error('[AUTH] syncOnLogin error:', e);
    }
  },

  async _runMigration(session, key) {
    // Migrates old anonymous data to the current workspace
    const workspaceId = this.getWorkspaceId();
    const migrationFlag = `neuroaark_ws_migrated_${workspaceId}`;
    if (localStorage.getItem(migrationFlag) === 'true') return;

    const anonRaw = localStorage.getItem('neuroaark_tasks_anonymous');
    if (!anonRaw) {
        localStorage.setItem(migrationFlag, 'true');
        return;
    }

    let anonTasks = [];
    try {
        const parsed = JSON.parse(anonRaw);
        anonTasks = Array.isArray(parsed) ? parsed : (parsed.nodes || []);
    } catch(e) {}

    if (anonTasks.length > 0) {
      this._hasCompletedInitialSync = true;

      for (const task of anonTasks) {
        const payload = {
          user_id: session?.user?.id || null,
          workspace_id: workspaceId,
          local_id: String(task.id),
          nodes: task,
          version: Date.now(),
          device_id: this.getDeviceId()
        };
        const { error } = await this.supabase.from('tasks').upsert(payload, { onConflict: 'workspace_id,local_id' });
        if (error) console.error('[MIGRATE] Error migrating task:', task.id, error);
      }
      localStorage.setItem(migrationFlag, 'true');
      localStorage.removeItem('neuroaark_tasks_anonymous');
      await this._revalidateTasks(key);
    } else {
        localStorage.setItem(migrationFlag, 'true');
    }
  },

  async clearSession() {
    this._hasCompletedInitialSync = false;
    this._isHydrating = false;

    if (this._realtimeChannel) {
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
      this._realtimeChannel = null;
    }

    this._debounceTimers = {};
    this._revalidationPromises = {};
    this._syncQueue = Promise.resolve();
    this._offlineQueue = [];
    this._session = null;
    this._sessionPromise = null;
    localStorage.removeItem('neuroaark_tasks_anonymous');
    console.log('[AUTH] Logout complete.');
  },

  async initRealtime(workspaceId) {
    if (this._isSubscribing) return;
    if (this._realtimeChannel) {
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
    }
    this._isSubscribing = true;
    this._realtimeChannel = this.supabase
      .channel(`public:tasks:workspace_id=eq.${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `workspace_id=eq.${workspaceId}` },
        payload => this._handleRealtimePayload(payload))
      .subscribe(() => { this._isSubscribing = false; });
  },

  async _handleRealtimePayload(payload) {
    if (payload.new && payload.new.device_id === this.getDeviceId()) return;
    if (payload.new && payload.new.local_id === 'canonical_state') return;

    // Debounce revalidation to avoid floods and hydration loops
    if (this._realtimeDebounce) clearTimeout(this._realtimeDebounce);

    this._realtimeDebounce = setTimeout(async () => {
      const key = await this.getTasksKey();
      this._enqueue(() => this._revalidateTasks(key));
    }, 300);
  }
};

window.Storage = Storage;
