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
    const style = error ? 'color: #ff4444; font-weight: bold;' : 'color: #44ff44;';
    console.group(`[FORENSIC] [${timestamp}] ${action}`);
    if (payload) console.log('Payload:', JSON.parse(JSON.stringify(payload)));
    if (response) console.log('Response:', JSON.parse(JSON.stringify(response)));
    if (error) console.error('Error Details:', error);
    console.groupEnd();

    // Store in window for inspection if needed
    if (!window.__SUPABASE_LOGS__) window.__SUPABASE_LOGS__ = [];
    window.__SUPABASE_LOGS__.push({ timestamp, action, payload, response, error });
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

    if (session && !this._offlineListenerAdded) {
      window.addEventListener('online', () => this._flushOfflineQueue());
      this._offlineQueue = JSON.parse(localStorage.getItem(`neuroaark_offline_${session.user.id}`) || '[]');
      this._offlineListenerAdded = true;
      if (navigator.onLine) this._flushOfflineQueue();
    }

    if (session) {
      // BLOCKING HYDRATION: For authenticated users, cloud is the single source of truth.
      // We must ensure hydration completes before returning data.
      if (!this._hasCompletedInitialSync || this._revalidationPromises[key]) {
        console.log('[HYDRATE] [TRACE] getTasks: Waiting for hydration.');
        await this._revalidateTasks(key);
      }

      // If hydration failed even after waiting, we return empty to avoid stale/divergent local data.
      if (!this._hasCompletedInitialSync) {
        console.warn('[GET_TASKS] [TRACE] Hydration failed. Returning empty list for safety.');
        return [];
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

    if (session && (!this._hasCompletedInitialSync || this._revalidationPromises[key])) {
      console.log('[HYDRATE] [TRACE] getTask: Waiting for hydration.');
      await this._revalidateTasks(key);
    }

    if (session && !this._hasCompletedInitialSync) {
      console.warn('[GET_TASK] [TRACE] Hydration failed/pending. Returning null.');
      return null;
    }

    const state = this._getLocalState(key);
    const tasks = state.nodes || [];
    return tasks.find(t => t.id === id);
  },

  /**
   * Main hydration logic. Ensures local state is reconciled with cloud state.
   */
  async _revalidateTasks(key) {
    if (this._revalidationPromises[key]) {
      console.log('[HYDRATE] [TRACE] Using existing revalidation promise for:', key);
      return this._revalidationPromises[key];
    }

    console.log('[HYDRATE] [TRACE] _revalidateTasks queuing for:', key);
    this._revalidationPromises[key] = (async () => {
      // Chain hydration to the unified sync queue to ensure serial access to Supabase
      return this._enqueue(async () => {
        console.log('[HYDRATE] [TRACE] Execution started in sync queue for:', key);
        this._isHydrating = true;
        try {
        const session = await this.getSession();
        if (!session) {
          console.warn('[HYDRATE] Aborting: No session found.');
          return this._getLocalState(key).nodes;
        }

        console.log('[HYDRATE] [TRACE] Fetching canonical_state for user:', session.user.id);
        const response = await this.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('local_id', 'canonical_state')
          .maybeSingle();

        const { data, error } = response;
        this._logNetwork('FETCH_CANONICAL_STATE', { userId: session.user.id }, data, error);

        if (error) {
          console.error('[HYDRATE] [TRACE] Supabase error:', error.message, error.code);
          // If it's not a "not found" error, we might want to retry, but for now we fallback to local.
          // Note: maybeSingle() returns data: null and no error for 0 rows.
          // PGRST116 is specifically for "0 or 1 rows expected but more found" or "no rows found" in some configurations.
          if (error.code === 'PGRST116') {
             console.log('[HYDRATE] [TRACE] Canonical state missing in cloud (PGRST116).');
             const nodes = await this._handleMissingCloudData(session, key);
             this._hasCompletedInitialSync = true;
             return nodes;
          }
          // Transient failure: return local cache but do NOT set _hasCompletedInitialSync.
          // This keeps the sync pipeline gated until a successful cloud check occurs.
          console.warn('[HYDRATE] [TRACE] Hydration failed due to transient error. App remains un-synced.');
          return this._getLocalState(key).nodes;
        }

        if (data) {
          console.log('[HYDRATE] [TRACE] Cloud state found:', { version: data.version, t: data.updated_at, nodes: data.nodes?.length });

          // CLOUD AUTHORITY: For initial hydration of authenticated users, Cloud ALWAYS wins.
          // This ensures device parity and prevents stale local data from clobbering remote state.
          console.log('[HYDRATE] [TRACE] Adopting Remote State (Cloud Authority).');
          const newState = {
            nodes: data.nodes || [],
            version: data.version || 0,
            updated_at: data.updated_at,
            device_id: data.device_id
          };
          this._currentVersion = data.version || 0;
          this._lastUpdatedAt = data.updated_at;
          this._setLocalState(key, newState);
          window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: newState.nodes }));
        } else {
          console.log('[HYDRATE] Cloud returned empty data (no row).');
          return await this._handleMissingCloudData(session, key);
        }

        this._hasCompletedInitialSync = true;
        console.log('[HYDRATE] [TRACE] Success. Current version:', this._currentVersion);
        return this._getLocalState(key).nodes;

      } catch (e) {
        console.error('[HYDRATE] [TRACE] Unexpected exception:', e);
        // Do not set _hasCompletedInitialSync on exception to prevent safe-overwrites
        return this._getLocalState(key).nodes;
      } finally {
        this._isHydrating = false;
        console.log('[HYDRATE] [TRACE] Hydration flag cleared for:', key);
        // We delete the promise after a short delay to allow concurrent callers to resolve
        // from the same promise while ensuring subsequent calls trigger a fresh revalidation if needed.
        setTimeout(() => { delete this._revalidationPromises[key]; }, 100);
        this._processPendingUpdates();
      }
    });
    })();

    return this._revalidationPromises[key];
  },

  async _handleMissingCloudData(session, key) {
    console.log('[HYDRATE] [TRACE] Handling missing cloud data (cloud is empty).');
    // Always check for migration if cloud is empty
    return await this._runMigration(session, key);
  },

  async saveTask(task) {
    console.log('[SAVE] [TRACE] saveTask called for task:', task.id);
    const key = await this.getTasksKey();
    const session = await this.getSession();

    if (session) {
      // For authenticated users, cloud is the authority.
      // We MUST ensure hydration is complete to prevent data divergence.
      if (!this._hasCompletedInitialSync || this._revalidationPromises[key]) {
        await this._revalidateTasks(key);
      }

      if (!this._hasCompletedInitialSync) {
        throw new Error('Cloud persistence unavailable: Hydration failed.');
      }

      const state = this._getLocalState(key);
      const tasks = [...(state.nodes || [])];
      const index = tasks.findIndex(t => t.id === task.id);
      if (index > -1) tasks[index] = task;
      else tasks.push(task);

      // Update local cache immediately for UI responsiveness,
      // but the promise only resolves once cloud sync is confirmed.
      this._setLocalState(key, {
        ...state,
        nodes: tasks,
        updated_at: new Date().toISOString(),
        device_id: this.getDeviceId()
      });

      return await this._enqueue(() => this._syncTasksToCloud(tasks));
    } else {
      // Anonymous mode: local-only
      const state = this._getLocalState(key);
      const tasks = [...(state.nodes || [])];
      const index = tasks.findIndex(t => t.id === task.id);
      if (index > -1) tasks[index] = task;
      else tasks.push(task);

      this._setLocalState(key, {
        ...state,
        nodes: tasks,
        updated_at: new Date().toISOString(),
        device_id: this.getDeviceId()
      });
      return Promise.resolve();
    }
  },

  async deleteTask(id) {
    console.log('[SAVE] [TRACE] deleteTask called for task:', id);
    const key = await this.getTasksKey();
    const session = await this.getSession();

    if (session) {
      if (!this._hasCompletedInitialSync || this._revalidationPromises[key]) {
        await this._revalidateTasks(key);
      }

      if (!this._hasCompletedInitialSync) {
        throw new Error('Cloud persistence unavailable: Hydration failed.');
      }

      const state = this._getLocalState(key);
      const filtered = (state.nodes || []).filter(t => t.id !== id);

      this._setLocalState(key, {
        ...state,
        nodes: filtered,
        updated_at: new Date().toISOString(),
        device_id: this.getDeviceId()
      });

      return await this._enqueue(() => this._syncTasksToCloud(filtered));
    } else {
      // Anonymous mode: local-only
      const state = this._getLocalState(key);
      const filtered = (state.nodes || []).filter(t => t.id !== id);

      this._setLocalState(key, {
        ...state,
        nodes: filtered,
        updated_at: new Date().toISOString(),
        device_id: this.getDeviceId()
      });
      return Promise.resolve();
    }
  },

  async _syncTasksToCloud(tasks) {
    console.log('[SAVE] [TRACE] _syncTasksToCloud execution start. Tasks:', tasks.length);

    if (!navigator.onLine) {
      console.warn('[OFFLINE] [TRACE] Sync aborted: Offline.');
      this._queueOfflineMutation(tasks);
      return;
    }

    // Serialization: The unified _syncQueue handles serialization between hydration and sync.

    // CRITICAL: We only sync if hydrated. However, _syncTasksToCloud handles lazy hydration during version check.
    if (!this._hasCompletedInitialSync) {
      console.error('[SAVE] [TRACE] Refusing to sync to cloud: Initial hydration not completed.');
      return;
    }

    this._isSyncing = true;
    try {
      const session = await this.getSession();
      if (!session) {
        console.error('[SAVE] [TRACE] No session found during cloud write.');
        return;
      }

      // VERSION GUARD: Fetch latest version from cloud before UPSERT to prevent clobbering.
      console.log('[SAVE] [TRACE] Fetching latest state for conflict check...');
      const versionCheckResponse = await this.supabase
        .from('tasks')
        .select('version, updated_at, nodes')
        .eq('user_id', session.user.id)
        .eq('local_id', 'canonical_state')
        .maybeSingle();

      const { data: cloudState, error: fetchError } = versionCheckResponse;
      this._logNetwork('VERSION_CHECK_BEFORE_UPSERT', { userId: session.user.id }, cloudState, fetchError);

      if (fetchError) {
        console.error('[SAVE] [TRACE] Error fetching cloud state for version check:', fetchError.message);
        // CRITICAL: If we can't verify the cloud state, we MUST abort the write to prevent accidental wipe.
        console.error('[SAVE] [TRACE] ABORTING CLOUD WRITE: Version check failed. Retrying later via offline queue.');
        this._queueOfflineMutation(tasks);
        return;
      }

      const remoteVersion = cloudState?.version || 0;
      const remoteNodes = cloudState?.nodes || [];
      let tasksToSave = tasks;

      // LAZY HYDRATION: If we reached this point, the version check worked.
      // We can mark hydration as complete to unblock future operations.
      if (!this._hasCompletedInitialSync) {
        console.log('[SAVE] [TRACE] Lazy hydration triggered by successful version check.');
        this._hasCompletedInitialSync = true;
      }

      // ANTI-WIPE HARD GUARD: If local is empty but cloud has data, ALWAYS merge.
      // This protects against race conditions where local state is cleared/empty during initial sync.
      const isLocalEmpty = !tasks || tasks.length === 0;
      const isCloudPopulated = remoteNodes.length > 0;

      if (isLocalEmpty && isCloudPopulated) {
        console.warn('[SAVE] [TRACE] ANTI-WIPE GUARD: Local state is empty but cloud has data. Forcing Safety Merge.');
        tasksToSave = this._reconcileTasks(remoteNodes, tasks);
      } else if (remoteVersion > this._currentVersion) {
        console.warn('[SAVE] [TRACE] Conflict detected! Cloud is ahead. Remote:', remoteVersion, 'Local:', this._currentVersion);

        // RECONCILIATION: Attempt to merge local changes into remote state
        console.log('[SAVE] [TRACE] Attempting a safety merge of local tasks into remote tasks.');
        tasksToSave = this._reconcileTasks(remoteNodes, tasks);

        console.log('[SAVE] [TRACE] Merge complete. Proceeding with UPSERT of merged state.');
        this._currentVersion = remoteVersion;
      }

      const nextVersion = Math.max(this._currentVersion, remoteVersion) + 1;
      const updatedAt = new Date().toISOString();
      const deviceId = this.getDeviceId();

      const payload = {
        user_id: session.user.id,
        local_id: 'canonical_state',
        nodes: tasksToSave,
        version: nextVersion,
        device_id: deviceId,
        updated_at: updatedAt
      };

      console.log('[SAVE] [TRACE] Supabase UPSERT start. Version:', nextVersion);
      const upsertResponse = await this.supabase
        .from('tasks')
        .upsert(payload, { onConflict: 'user_id,local_id' })
        .select();

      const { data, error } = upsertResponse;
      this._logNetwork('UPSERT_CANONICAL_STATE', payload, data, error);

      if (error) {
        console.error('[SAVE] [TRACE] Supabase UPSERT error:', error.message, error.details);
        this._queueOfflineMutation(tasks);
      } else {
        console.log('[SAVE] [TRACE] Supabase UPSERT success. New version:', nextVersion);
        this._currentVersion = nextVersion;
        this._lastUpdatedAt = updatedAt;

        // Update local metadata only if nodes still match (to avoid racing with newer local changes)
        const key = await this.getTasksKey();
        const local = this._getLocalState(key);
        if (JSON.stringify(local.nodes) === JSON.stringify(tasksToSave)) {
          this._setLocalState(key, { nodes: tasksToSave, version: nextVersion, updated_at: updatedAt, device_id: deviceId });
          // If we merged, let the UI know
          if (tasksToSave !== tasks) {
              window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: tasksToSave }));
          }
        }
      }
    } catch (e) {
      console.error('[SAVE] [TRACE] Unexpected sync exception:', e);
    } finally {
      this._isSyncing = false;
      this._processPendingUpdates();
    }
  },

  async syncOnLogin() {
    console.log('[AUTH] [TRACE] syncOnLogin starting.');
    try {
      const session = await this.getSession();
      if (!session) {
        console.warn('[AUTH] [TRACE] syncOnLogin aborted: No session.');
        return;
      }
      await this.initRealtime(session.user.id);
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
          this._currentVersion = nextVersion;
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
    console.log('[REALTIME] [TRACE] Event:', payload.eventType, 'Version:', payload.new?.version, 'Device:', payload.new?.device_id);

    // Safety check: only handle updates if we are authenticated and initialized
    if (!this._hasCompletedInitialSync && !this._isHydrating) {
        console.log('[REALTIME] [TRACE] Skipping update: Not initialized.');
        return;
    }

    if (this._isHydrating || this._isSyncing) {
      console.log('[REALTIME] [TRACE] Busy (Hydrating:', this._isHydrating, 'Syncing:', this._isSyncing, '). Queueing update.');
      this._pendingRealtimeUpdates.push(payload);
      return;
    }

    if (payload.new && payload.new.local_id === 'canonical_state') {
      const remote = payload.new;
      if (remote.device_id === this.getDeviceId()) {
        console.log('[REALTIME] [TRACE] Ignoring self-update.');
        return;
      }

      const key = await this.getTasksKey();
      const local = this._getLocalState(key);

      const remoteVersion = remote.version || 0;
      const localVersion = local.version || 0;
      const remoteUpdatedAt = remote.updated_at ? new Date(remote.updated_at).getTime() : 0;
      const localUpdatedAt = local.updated_at ? new Date(local.updated_at).getTime() : 0;

      console.log('[REALTIME] [TRACE] Comparing. Remote V:', remoteVersion, 'T:', remoteUpdatedAt, 'Local V:', localVersion, 'T:', localUpdatedAt);

      if (remoteVersion > localVersion || (remoteVersion === localVersion && remoteUpdatedAt > localUpdatedAt)) {
        console.log('[REALTIME] [TRACE] Adopting newer remote state.');
        this._currentVersion = remoteVersion;
        this._lastUpdatedAt = remote.updated_at;
        this._setLocalState(key, {
            nodes: remote.nodes || [],
            version: remoteVersion,
            updated_at: remote.updated_at,
            device_id: remote.device_id
        });
        window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: remote.nodes }));
      } else {
        console.log('[REALTIME] [TRACE] Remote state is older or identical. Ignoring.');
      }
    }
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

  async _flushOfflineQueue() {
    if (!navigator.onLine || this._offlineQueue.length === 0) return;
    console.log('[OFFLINE] [TRACE] Connectivity restored. Flushing queue.');
    const tasks = this._offlineQueue.pop();
    this._offlineQueue = [];
    const session = await this.getSession();
    if (session) {
      localStorage.removeItem(`neuroaark_offline_${session.user.id}`);
      await this._enqueue(() => this._syncTasksToCloud(tasks));
    }
  },

  /**
   * Simple reconciliation: Add new local tasks to remote list if they don't exist.
   * This is a "Safety Merge" to prevent data loss when remote is ahead.
   */
  _reconcileTasks(remote, local) {
      const merged = [...remote];
      local.forEach(lTask => {
          if (!merged.find(rTask => rTask.id === lTask.id)) {
              console.log('[RECONCILE] [TRACE] Merging new local task into remote state:', lTask.id);
              merged.push(lTask);
          }
      });
      return merged;
  }
};
