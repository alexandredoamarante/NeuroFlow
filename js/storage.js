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
  _isSyncing: false,
  _offlineQueue: [],

  /**
   * Helper to append a task to the serial sync queue.
   * Ensures the queue never remains in a rejected state.
   */
  _enqueue(taskFn) {
    this._syncQueue = this._syncQueue
      .then(taskFn)
      .catch(err => {
        console.error('[QUEUE] [ERROR] Task in sync queue failed:', err);
        return null; // Ensure the queue remains functional
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

    // Crucial: Create the log entry object with deep-cloned payload immediately
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

    // Store in window for inspection if needed
    if (!window.__SUPABASE_LOGS__) window.__SUPABASE_LOGS__ = [];
    window.__SUPABASE_LOGS__.push(JSON.parse(JSON.stringify(logEntry)));
    if (window.__SUPABASE_LOGS__.length > 100) window.__SUPABASE_LOGS__.shift();
  },

  /**
   * Generates or retrieves a unique device ID.
   */
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

  /**
   * Safe session retrieval with deduplication.
   */
  async getSession() {
    console.log('[AUTH] [TRACE] getSession called.');
    if (this._sessionPromise) {
      console.log('[AUTH] [TRACE] Returning existing session promise.');
      return this._sessionPromise;
    }

    const now = Date.now();
    if (this._session && (now - this._lastCheck < 30000)) { // 30s cache
      console.log('[AUTH] [TRACE] Returning cached session. User:', this._session.user.id);
      return this._session;
    }

    this._sessionPromise = (async () => {
      try {
        console.log('[AUTH] Fetching session from Supabase...');
        const { data: { session }, error } = await this.supabase.auth.getSession();
        if (error) throw error;
        console.log('[AUTH] Session result:', session ? `User: ${session.user.id}` : 'No session');
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

  async getTasksKey() {
    const session = await this.getSession();
    if (session && session.user) return `neuroaark_tasks_user_${session.user.id}`;
    return 'neuroaark_tasks_anonymous';
  },

  _getLocalState(key) {
    console.log('[CACHE] [TRACE] _getLocalState called for:', key);
    const raw = localStorage.getItem(key);
    if (!raw) {
      console.log('[CACHE] [TRACE] No local data found for:', key);
      return { nodes: [], version: 0, updated_at: null, device_id: null };
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
          console.log('[CACHE] [TRACE] Found legacy array format for:', key);
          return { nodes: parsed, version: 0, updated_at: null, device_id: null };
      }
      console.log('[CACHE] [TRACE] Found state object for:', key, 'Version:', parsed.version, 'Nodes:', parsed.nodes?.length);
      return {
        nodes: parsed.nodes || [],
        version: parsed.version || 0,
        updated_at: parsed.updated_at || null,
        device_id: parsed.device_id || null
      };
    } catch (e) {
      console.error('[CACHE] [TRACE] Error parsing local data for:', key, e.message);
      return { nodes: [], version: 0, updated_at: null, device_id: null };
    }
  },

  _setLocalState(key, state) {
    console.log('[CACHE] [TRACE] Updating localStorage key:', key, 'Version:', state.version, 'Nodes:', state.nodes?.length || 0);
    localStorage.setItem(key, JSON.stringify(state));
  },

  async getTasks() {
    console.log('[GET_TASKS] [TRACE] getTasks called.');
    const session = await this.getSession();
    const key = await this.getTasksKey();

    if (session) {
      // OPTIMISTIC: Trigger background sync if not hydrated, but return local cache immediately.
      if (!this._hasCompletedInitialSync && !this._revalidationPromises[key]) {
        console.log('[HYDRATE] [TRACE] getTasks: Triggering background hydration.');
        this._revalidateTasks(key);
      }
      const state = this._getLocalState(key);
      return state.nodes || [];
    }

    const state = this._getLocalState(key);
    return state.nodes || [];
  },

  async getTask(id) {
    console.log('[GET_TASK] [TRACE] getTask called for:', id);
    const session = await this.getSession();
    const key = await this.getTasksKey();

    if (session && !this._hasCompletedInitialSync && !this._revalidationPromises[key]) {
      this._revalidateTasks(key);
    }

    const state = this._getLocalState(key);
    const tasks = state.nodes || [];
    return tasks.find(t => t.id === id);
  },

  /**
   * Main hydration logic. Fetches all tasks from Supabase and reconciles with local state.
   */
  async _revalidateTasks(key) {
    if (this._revalidationPromises[key]) return this._revalidationPromises[key];

    this._revalidationPromises[key] = (async () => {
      try {
        const { data: { user } } = await this.supabase.auth.getUser();
        if (!user) return this._getLocalState(key).nodes;

        console.log('[HYDRATE] [TRACE] Fetching all tasks for user:', user.id);
        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', user.id);

        this._logNetwork('FETCH_ALL_TASKS', { userId: user.id }, data, error);

        if (error) {
          console.error('[HYDRATE] [TRACE] Supabase fetch error:', error.message);
          return this._getLocalState(key).nodes;
        }

        // Process results
        let remoteTasks = [];
        let legacyState = data.find(r => r.local_id === 'canonical_state');

        if (legacyState) {
          console.log('[HYDRATE] [TRACE] Legacy canonical_state found. Unpacking...');
          remoteTasks = legacyState.nodes || [];
          // Trigger background migration of legacy data
          this._migrateLegacyData(user, legacyState);
        } else {
          // Per-task model: each row is a task (except for reserved local_ids)
          remoteTasks = data
            .filter(r => r.local_id !== 'canonical_state')
            .map(r => r.nodes); // In per-task model, 'nodes' column stores the whole task object
        }

        // AUTHORITATIVE SYNC: For logged in users, Cloud is the source of truth.
        // We replace local state with cloud state.
        const newState = {
          nodes: remoteTasks,
          version: Date.now(), // Simplified versioning for per-task
          updated_at: new Date().toISOString(),
          device_id: this.getDeviceId()
        };

        this._setLocalState(key, newState);
        this._hasCompletedInitialSync = true;
        window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: remoteTasks }));

        return remoteTasks;
      } catch (e) {
        console.error('[HYDRATE] [TRACE] Hydration exception:', e);
        return this._getLocalState(key).nodes;
      } finally {
        setTimeout(() => { delete this._revalidationPromises[key]; }, 100);
      }
    })();

    return this._revalidationPromises[key];
  },

  /**
   * Migrates legacy single-document state to per-task rows.
   */
  async _migrateLegacyData(user, legacyState) {
    console.log('[MIGRATE] [TRACE] Starting legacy migration...');
    const tasks = legacyState.nodes || [];

    for (const task of tasks) {
      const payload = {
        user_id: user.id,
        local_id: task.id,
        nodes: task,
        version: 1,
        device_id: this.getDeviceId()
      };
      console.log('[MIGRATE] [TRACE] Upserting migrated task:', task.id);
      const { data, error } = await this.supabase.from('tasks').upsert(payload, { onConflict: 'user_id,local_id' });
      this._logNetwork('SAVE_TASK_UPSERT', payload, data, error);
    }

    // Remove legacy row
    console.log('[MIGRATE] [TRACE] Deleting legacy canonical_state row.');
    const { data: delData, error: delError } = await this.supabase.from('tasks').delete().match({ user_id: user.id, local_id: 'canonical_state' });
    this._logNetwork('MIGRATION_DELETE_LEGACY', { user_id: user.id }, delData, delError);
    console.log('[MIGRATE] [TRACE] Migration complete.');
  },

  async saveTask(task) {
    console.log('[SAVE] [TRACE] saveTask called:', task.id);
    const key = await this.getTasksKey();

    // 1. Update local cache IMMEDIATELY (Optimistic UI)
    const state = this._getLocalState(key);
    const tasks = [...(state.nodes || [])];
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx > -1) tasks[idx] = task; else tasks.push(task);

    this._setLocalState(key, { ...state, nodes: tasks, updated_at: new Date().toISOString() });

    // 2. Authoritative Supabase Insert (Non-blocking)
    // We explicitly use getUser() to ensure a fresh, valid user ID for RLS compliance.
    const runUpsert = async () => {
      console.log('[SAVE] [TRACE] runUpsert starting...');
      try {
        // Use cached session first if available to speed up
        let user = this._session?.user;
        if (!user) {
            const { data: authData, error: authError } = await this.supabase.auth.getUser();
            console.log('[SAVE] [TRACE] getUser result:', authData?.user?.id, authError);
            user = authData?.user;
        }

        if (!user) {
          console.warn('[SAVE] [TRACE] Cloud persistence skipped: No authenticated user.');
          return;
        }
        const userId = user.id;

        if (!userId || userId === 'undefined') {
          console.error('[SAVE] [ERROR] Resolved userId is invalid:', userId);
          return;
        }

        const localId = String(task.id);
        const deviceId = this.getDeviceId();

        const payload = {
          user_id: userId,
          local_id: localId,
          nodes: JSON.parse(JSON.stringify(task)), // Whole task object stored in JSONB 'nodes' column
          version: Date.now(),
          device_id: deviceId
        };

        console.log('[SAVE] [TRACE] Triggering Supabase UPSERT for User:', userId, 'LocalID:', localId);
        const { data, error } = await this.supabase.from('tasks').upsert(payload, { onConflict: 'user_id,local_id' }).select();

        this._logNetwork('SAVE_TASK_UPSERT', { ...payload }, data, error);
        if (error) console.error('[SAVE] [ERROR] Supabase persistence failed:', error.message);
        else console.log('[SAVE] [SUCCESS] Task persisted in cloud:', task.id);
      } catch (e) {
        console.error('[SAVE] [TRACE] Unexpected save error:', e);
      }
    };

    runUpsert();
    return Promise.resolve();
  },

  async deleteTask(id) {
    console.log('[SAVE] [TRACE] deleteTask called:', id);
    const key = await this.getTasksKey();

    // 1. Update local cache IMMEDIATELY
    const state = this._getLocalState(key);
    const filtered = (state.nodes || []).filter(t => t.id !== id);
    this._setLocalState(key, { ...state, nodes: filtered, updated_at: new Date().toISOString() });

    // 2. Supabase Delete (Non-blocking)
    this.supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;

      console.log('[SAVE] [TRACE] Triggering Supabase DELETE for User:', user.id, 'LocalID:', id);
      const { data, error } = await this.supabase.from('tasks').delete().match({ user_id: user.id, local_id: id });

      this._logNetwork('DELETE_TASK', { local_id: id, user_id: user.id }, data, error);
      if (error) console.error('[SAVE] [ERROR] Supabase deletion failed:', error.message);
      else console.log('[SAVE] [SUCCESS] Task deleted from cloud:', id);
    });

    return Promise.resolve();
  },

  async syncOnLogin() {
    console.log('[AUTH] [TRACE] syncOnLogin starting.');
    try {
      const { data: { user } } = await this.supabase.auth.getUser();
      if (!user) {
        console.warn('[AUTH] [TRACE] syncOnLogin aborted: No user.');
        return;
      }
      await this.initRealtime(user.id);
      const key = await this.getTasksKey();
      await this._revalidateTasks(key);
    } catch (e) {
      console.error('[AUTH] [TRACE] syncOnLogin error:', e);
    }
  },

  async _runMigration(session, key) {
    console.log('[MIGRATE] [TRACE] Checking for legacy tasks...');
    const migrationFlag = `neuroaark_migrated_v4_${session.user.id}`;

    // Check for legacy cloud tasks (pre-canonical model)
    const migrationFetchResponse = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', session.user.id)
      .neq('local_id', 'canonical_state');

    const { data: legacyCloud, error: migrationError } = migrationFetchResponse;
    this._logNetwork('MIGRATION_FETCH_LEGACY', { userId: session.user.id }, legacyCloud, migrationError);

    let consolidated = [];
    if (legacyCloud && legacyCloud.length > 0) {
      console.log('[MIGRATE] Found legacy cloud tasks:', legacyCloud.length);
      consolidated = legacyCloud.map(t => ({
        id: t.local_id,
        name: t.name || 'Tarefa',
        desc: t.description || '',
        color: t.color || '#60a5fa',
        sessions: t.sessions || 0,
        checklist: t.checklist || [],
        nodes: t.nodes || []
      }));
    } else {
      // Fallback to anonymous local state if this is the first login ever on this device
      if (localStorage.getItem(migrationFlag) !== 'true') {
        console.log('[MIGRATE] Checking anonymous localStorage.');
        const anon = JSON.parse(localStorage.getItem('neuroaark_tasks_anonymous') || '[]');
        if (anon.length > 0) consolidated = anon;
      }
    }

    if (consolidated.length > 0) {
      console.log('[MIGRATE] [TRACE] Consolidating', consolidated.length, 'tasks to cloud...');
      this._hasCompletedInitialSync = true; // Unlock to allow migration write

      const nextVersion = this._currentVersion + 1;
      const payload = {
        user_id: session.user.id,
        local_id: 'canonical_state',
        nodes: consolidated,
        version: nextVersion,
        device_id: this.getDeviceId(),
        updated_at: new Date().toISOString()
      };

      console.log('[MIGRATE] [TRACE] Performing direct migration UPSERT...');
      const migrateUpsert = await this.supabase
        .from('tasks')
        .upsert(payload, { onConflict: 'user_id,local_id' });

      this._logNetwork('MIGRATION_UPSERT', payload, migrateUpsert.data, migrateUpsert.error);

      if (!migrateUpsert.error) {
          // Clean up legacy
          await this.supabase.from('tasks').delete().match({ user_id: session.user.id }).neq('local_id', 'canonical_state');
          localStorage.setItem(migrationFlag, 'true');
          this._hasCompletedInitialSync = true;
      } else {
          console.error('[MIGRATE] [TRACE] Migration UPSERT failed. Sync remaining gated.');
          this._hasCompletedInitialSync = false;
      }
    } else {
        localStorage.setItem(migrationFlag, 'true');
        this._hasCompletedInitialSync = true;
    }

    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: consolidated }));
    return consolidated;
  },

  async clearSession() {
    console.log('[AUTH] [TRACE] clearSession called. Purging sensitive state.');

    // IMMEDIATELY set flags to block any further outgoing syncs
    this._hasCompletedInitialSync = false;
    this._isSyncing = false;
    this._isHydrating = false;

    // REJECT current sync queue to stop pending operations
    this._syncQueue = Promise.reject(new Error('Logout cleanup initiated')).catch(() => {
        console.log('[AUTH] [TRACE] Sync queue rejected due to logout.');
        return Promise.resolve();
    });

    if (this._realtimeChannel) {
      console.log('[AUTH] [TRACE] Removing realtime channel.');
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
      this._realtimeChannel = null;
    }
    for (const k in this._debounceTimers) {
      if (this._debounceTimers[k].timeoutId) {
        console.log('[AUTH] [TRACE] Clearing debounce timer for:', k);
        clearTimeout(this._debounceTimers[k].timeoutId);
      }
    }
    this._debounceTimers = {};
    this._revalidationPromises = {};
    this._syncQueue = Promise.resolve();
    this._offlineQueue = [];

    this._session = null;
    this._sessionPromise = null;
    this._offlineListenerAdded = false;
    this._pendingRealtimeUpdates = [];
    this._currentVersion = 0;

    // Clear anonymous cache on logout.
    localStorage.removeItem('neuroaark_tasks_anonymous');
    // CRITICAL RESILIENCE: DO NOT clear user keys on logout.
    // This allows recovery/offline mode if re-login fails or returns empty.
    // Authenticated users are protected by RLS and the 'canonical_state' document sync logic.
    console.log('[AUTH] [TRACE] Logout complete. Cache preserved for resilience.');
  },

  async initRealtime(userId) {
    if (this._isSubscribing) {
        console.log('[REALTIME] [TRACE] Subscription already in progress.');
        return;
    }
    console.log('[REALTIME] [TRACE] initRealtime called for user:', userId);
    if (this._realtimeChannel) {
      console.log('[REALTIME] [TRACE] Removing existing channel.');
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
      this._realtimeChannel = null;
    }
    this._isSubscribing = true;
    console.log('[REALTIME] [TRACE] Subscribing...');
    this._realtimeChannel = this.supabase
      .channel(`public:tasks:user_id=eq.${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        payload => this._handleRealtimePayload(payload))
      .subscribe(status => {
          console.log('[REALTIME] [TRACE] Status:', status);
          this._isSubscribing = false;
      });
  },

  async _handleRealtimePayload(payload) {
    console.log('[REALTIME] [TRACE] Event:', payload.eventType, 'LocalID:', payload.new?.local_id);

    // If it's a self-update or not a task document, ignore
    if (payload.new && payload.new.device_id === this.getDeviceId()) return;
    if (payload.new && payload.new.local_id === 'canonical_state') return;

    // For per-task model, we just trigger a full revalidation to keep it simple and reliable
    console.log('[REALTIME] [TRACE] Change detected. Triggering background revalidation.');
    const key = await this.getTasksKey();
    this._revalidateTasks(key);
  },

  _processPendingUpdates() {
    if (this._pendingRealtimeUpdates.length > 0) {
      console.log('[REALTIME] Processing', this._pendingRealtimeUpdates.length, 'queued updates.');
      const updates = [...this._pendingRealtimeUpdates];
      this._pendingRealtimeUpdates = [];
      updates.forEach(p => this._handleRealtimePayload(p));
    }
  },

  async _queueOfflineMutation(tasks) {
    const session = await this.getSession();
    if (!session) return;
    console.log('[OFFLINE] [TRACE] Persistence queueing mutation. User:', session.user.id);
    this._offlineQueue = [tasks]; // We only care about the latest canonical state
    localStorage.setItem(`neuroaark_offline_${session.user.id}`, JSON.stringify(this._offlineQueue));
  },

  /**
   * Placeholder for future per-task offline handling.
   * For now, we rely on background revalidation upon reconnection.
   */
  _flushOfflineQueue() {}
};

window.Storage = Storage;
