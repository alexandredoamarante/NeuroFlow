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
  _unsyncedIds: new Set(),
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
    const session = await this.getSession();
    if (session && session.user) return `neuroaark_tasks_user_${session.user.id}`;
    return 'neuroaark_tasks_anonymous';
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
    const session = await this.getSession();
    const key = await this.getTasksKey();

    if (session && !this._hasCompletedInitialSync && !this._revalidationPromises[key]) {
      this._revalidateTasks(key);
    }
    const state = this._getLocalState(key);
    return state.nodes || [];
  },

  async getTask(id) {
    const session = await this.getSession();
    const key = await this.getTasksKey();

    if (session && !this._hasCompletedInitialSync && !this._revalidationPromises[key]) {
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
        const user = await this.requireUser();
        if (!user) return this._getLocalState(key).nodes;

        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', user.id);

        this._logNetwork('FETCH_ALL_TASKS', { userId: user.id }, data, error);

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
          this._migrateLegacyData(user, legacyState);
        } else {
          // Per-task mode: surgical merge based on cloud authority
          dataArray.filter(r => r.local_id !== 'canonical_state').forEach(remoteRow => {
            const remoteTask = remoteRow.nodes;
            const remoteVersion = remoteRow.version || 0;
            const localId = String(remoteRow.local_id);
            const localIdx = localTasks.findIndex(t => String(t.id) === localId);

            // Convergence fix: Trust cloud as authority unless there are pending local changes.
            if (this._unsyncedIds.has(localId)) return;

            if (localIdx === -1) {
              localTasks.push(remoteTask);
              hasChanges = true;
            } else {
              const localTask = localTasks[localIdx];
              const localVersion = localTask.version || 0;

              // Only update if remote actually has different/newer data to avoid redundant renders
              if (remoteVersion !== localVersion) {
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

  async _migrateLegacyData(user, legacyState) {
    const tasks = legacyState.nodes || [];

    for (const task of tasks) {
      const payload = {
        user_id: user.id,
        local_id: String(task.id),
        nodes: task,
        version: 1,
        device_id: this.getDeviceId()
      };
      const { data, error } = await this.supabase.from('tasks').upsert(payload, { onConflict: 'user_id,local_id' });
      this._logNetwork('SAVE_TASK_UPSERT', payload, data, error);
    }

    const { data: delData, error: delError } = await this.supabase.from('tasks').delete().match({ user_id: user.id, local_id: 'canonical_state' });
    this._logNetwork('MIGRATION_DELETE_LEGACY', { user_id: user.id }, delData, delError);
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
    this._unsyncedIds.add(String(task.id));

    const runUpsert = async () => {
      try {
        const user = await this.requireUser();
        if (!user) {
          console.warn('[SYNC] No auth. Requeuing upsert for task:', task.id);
          this._offlineQueue.push(() => this.saveTask(task));
          return;
        }

      const payload = {
        user_id: user.id,
        local_id: String(task.id),
        nodes: JSON.parse(JSON.stringify(task)),
        version: task.version,
        device_id: this.getDeviceId()
      };

      const { data, error } = await this.supabase.from('tasks').upsert(payload, { onConflict: 'user_id,local_id' }).select();
      this._logNetwork('SAVE_TASK_UPSERT', { ...payload }, data, error);

        if (error) {
          console.error('[SYNC] Supabase upsert failed:', error);
          throw error;
        }

        // Re-dispatch after cloud confirmation to ensure UI reflects final state
        const finalTasks = this._getLocalState(key).nodes;
        window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: finalTasks }));
        this._unsyncedIds.delete(String(task.id));
      } catch (e) {
        console.error('[SYNC] Upsert failed:', e);
        throw e;
      }
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
    this._unsyncedIds.add(String(id));

    const runDelete = async () => {
      try {
        const user = await this.requireUser();
        if (!user) {
          console.warn('[SYNC] No auth. Requeuing deletion for task:', id);
          this._offlineQueue.push(() => this.deleteTask(id));
          return;
        }

      const { data, error } = await this.supabase.from('tasks').delete().match({ user_id: user.id, local_id: id });
      this._logNetwork('DELETE_TASK', { local_id: id, user_id: user.id }, data, error);

        if (error) {
          console.error('[SYNC] Supabase deletion failed:', error);
          throw error;
        }

        const finalTasks = this._getLocalState(key).nodes;
        window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: finalTasks }));
        this._unsyncedIds.delete(String(id));
      } catch (e) {
        console.error('[SYNC] Deletion failed:', e);
        throw e;
      }
    };

    return this._enqueue(runDelete);
  },

  async syncOnLogin() {
    try {
      const { data: { user } } = await this.supabase.auth.getUser();
      if (!user) return;

      const key = await this.getTasksKey();
      await this.initRealtime(user.id);

      // FORCE CLOUD OVERRIDE ON LOGIN
      this._hasCompletedInitialSync = false;
      await this._revalidateTasks(key);

      // Handle anonymous migration if needed
      await this._runMigration({ user }, key);

      // Drain offline queue
      await this._drainOfflineQueue();
    } catch (e) {
      console.error('[AUTH] syncOnLogin error:', e);
    }
  },

  async _runMigration(session, key) {
    const migrationFlag = `neuroaark_migrated_v4_${session.user.id}`;
    if (localStorage.getItem(migrationFlag) === 'true') return;

    // Check anonymous local state
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
      this._hasCompletedInitialSync = true; // Allow write during migration

      for (const task of anonTasks) {
        const payload = {
          user_id: session.user.id,
          local_id: String(task.id),
          nodes: task,
          version: Date.now(),
          device_id: this.getDeviceId()
        };
        const { error } = await this.supabase.from('tasks').upsert(payload, { onConflict: 'user_id,local_id' });
        if (error) console.error('[MIGRATE] Error migrating task:', task.id, error);
      }
      localStorage.setItem(migrationFlag, 'true');
      localStorage.removeItem('neuroaark_tasks_anonymous');
      await this._revalidateTasks(key);
    } else {
        localStorage.setItem(migrationFlag, 'true');
    }
  },

  async _drainOfflineQueue() {
    if (this._offlineQueue.length === 0) return;
    console.log('[SYNC] Draining offline queue...', this._offlineQueue.length);
    const queue = [...this._offlineQueue];
    this._offlineQueue = [];
    for (const fn of queue) {
      try { await fn(); } catch (e) {
        console.error('[SYNC] Failed to process queued task:', e);
      }
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

  async initRealtime(userId) {
    if (this._isSubscribing) return;
    if (this._realtimeChannel) {
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
    }
    this._isSubscribing = true;
    this._realtimeChannel = this.supabase
      .channel(`public:tasks:user_id=eq.${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
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
