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

    console.log('[GET_TASKS] [TRACE] Session:', !!session, 'Key:', key, 'Hydrated:', this._hasCompletedInitialSync, 'Hydrating:', !!this._revalidationPromises[key]);

    if (session && !this._offlineListenerAdded) {
      window.addEventListener('online', () => this._flushOfflineQueue());
      this._offlineQueue = JSON.parse(localStorage.getItem(`neuroaark_offline_${session.user.id}`) || '[]');
      this._offlineListenerAdded = true;
      if (navigator.onLine) this._flushOfflineQueue();
    }

    if (session) {
      // BLOCKING HYDRATION: If we are not hydrated OR currently hydrating, we MUST wait.
      if (!this._hasCompletedInitialSync || this._revalidationPromises[key]) {
        console.log('[HYDRATE] [TRACE] getTasks: Waiting for hydration.');
        await this._revalidateTasks(key);
      }
      const state = this._getLocalState(key);
      console.log('[GET_TASKS] [TRACE] Returning tasks from local state. Count:', state.nodes?.length || 0);
      return state.nodes || [];
    }

    const state = this._getLocalState(key);
    console.log('[GET_TASKS] [TRACE] Returning tasks (anonymous). Count:', state.nodes?.length || 0);
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
      return this._syncQueue = this._syncQueue.then(async () => {
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
          if (error.code === 'PGRST116') { // Not found
             console.log('[HYDRATE] [TRACE] Canonical state missing in cloud.');
             return await this._handleMissingCloudData(session, key);
          }
          return this._getLocalState(key).nodes;
        }

        const localState = this._getLocalState(key);
        if (data) {
          console.log('[HYDRATE] [TRACE] Cloud state found:', { version: data.version, t: data.updated_at, nodes: data.nodes?.length });

          const remoteVersion = data.version || 0;
          const remoteUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
          const localUpdatedAt = localState.updated_at ? new Date(localState.updated_at).getTime() : 0;
          const localVersion = localState.version || 0;

          // FORCE CLOUD AUTHORITY: Remote wins unless local is strictly newer AND has more data.
          let shouldAdoptRemote = false;

          if (remoteVersion > localVersion) {
            shouldAdoptRemote = true;
            console.log('[HYDRATE] [TRACE] Choice: Remote version is ahead.');
          } else if (remoteVersion === localVersion) {
            if (remoteUpdatedAt >= localUpdatedAt) {
              shouldAdoptRemote = true;
              console.log('[HYDRATE] [TRACE] Choice: Remote timestamp is newer or equal.');
            } else {
              console.log('[HYDRATE] [TRACE] Choice: Local timestamp is newer.');
            }
          }

          // HARD GUARD: Remote exists but Local is empty? ALWAYS adopt Remote.
          if (localState.nodes.length === 0 && data.nodes?.length > 0) {
              console.warn('[HYDRATE] [TRACE] HARD GUARD: Local is empty. Adopting Cloud.');
              shouldAdoptRemote = true;
          }

          // HARD GUARD: Remote exists but Local is legacy? ALWAYS adopt Remote.
          if (localState.version === 0 && !localState.updated_at && data.nodes?.length > 0) {
              console.warn('[HYDRATE] [TRACE] HARD GUARD: Local is legacy. Adopting Cloud.');
              shouldAdoptRemote = true;
          }

          if (shouldAdoptRemote) {
            console.log('[HYDRATE] [TRACE] Adopting Remote State.');
            const newState = {
              nodes: data.nodes || [],
              version: remoteVersion,
              updated_at: data.updated_at,
              device_id: data.device_id
            };
            this._currentVersion = remoteVersion;
            this._lastUpdatedAt = data.updated_at;
            this._setLocalState(key, newState);
            window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: newState.nodes }));
          } else {
            console.log('[HYDRATE] [TRACE] Keeping Local State. Version:', localVersion);
            this._currentVersion = Math.max(this._currentVersion, remoteVersion, localVersion);
          }
        } else {
          console.log('[HYDRATE] Cloud returned empty data (no row).');
          return await this._handleMissingCloudData(session, key);
        }

        this._hasCompletedInitialSync = true;
        console.log('[HYDRATE] [TRACE] Success. Current version:', this._currentVersion);
        return this._getLocalState(key).nodes;

      } catch (e) {
        console.error('[HYDRATE] [TRACE] Unexpected exception:', e);
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
    if (session && (!this._hasCompletedInitialSync || this._isHydrating)) {
        console.warn('[SAVE] [TRACE] saveTask: Waiting for hydration to complete before local update.');
        await this._revalidateTasks(key);
    }

    const state = this._getLocalState(key);
    const tasks = state.nodes || [];
    const index = tasks.findIndex(t => t.id === task.id);
    if (index > -1) tasks[index] = task;
    else tasks.push(task);

    const newState = {
      ...state,
      nodes: tasks,
      updated_at: new Date().toISOString(),
      device_id: this.getDeviceId()
    };
    this._setLocalState(key, newState);

    if (session) return await this._triggerCloudSync(tasks);
  },

  async deleteTask(id) {
    console.log('[SAVE] [TRACE] deleteTask called for task:', id);
    const key = await this.getTasksKey();

    const session = await this.getSession();
    if (session && (!this._hasCompletedInitialSync || this._isHydrating)) {
        console.warn('[SAVE] [TRACE] deleteTask: Waiting for hydration to complete before local update.');
        await this._revalidateTasks(key);
    }

    const state = this._getLocalState(key);
    const filtered = (state.nodes || []).filter(t => t.id !== id);

    const newState = {
      ...state,
      nodes: filtered,
      updated_at: new Date().toISOString(),
      device_id: this.getDeviceId()
    };
    this._setLocalState(key, newState);

    if (session) return await this._triggerCloudSync(filtered);
  },

  _triggerCloudSync(tasks) {
    console.log('[SAVE] [TRACE] _triggerCloudSync called. Tasks:', tasks.length, 'Hydrated:', this._hasCompletedInitialSync, 'IsHydrating:', this._isHydrating);

    if (!this._hasCompletedInitialSync && !this._isHydrating) {
        console.error('[SAVE] [TRACE] _triggerCloudSync blocked: App is NOT hydrated and NOT hydrating. This prevents accidental empty overwrites.');
        return Promise.resolve();
    }

    if (!navigator.onLine) {
      console.log('[OFFLINE] [TRACE] Device offline. Queueing mutation.');
      this._queueOfflineMutation(tasks);
      return Promise.resolve();
    }

    // Safety: if we are not hydrated AND not currently hydrating, we must be careful.
    // However, if we just created a task, we WANT it to sync eventually.
    if (!this._hasCompletedInitialSync && !this._isHydrating) {
      console.warn('[SAVE] [TRACE] Attempted save before hydration initiated. Force initiating hydration.');
      this.getTasksKey().then(key => this._revalidateTasks(key));
    }

    const syncKey = 'canonical_state';
    if (this._debounceTimers[syncKey]) {
      clearTimeout(this._debounceTimers[syncKey].timeoutId);
      this._debounceTimers[syncKey].tasks = tasks;
    } else {
      let resolve;
      const promise = new Promise(res => { resolve = res; });
      this._debounceTimers[syncKey] = { promise, resolve, tasks };
    }

    const currentSync = this._debounceTimers[syncKey];
    currentSync.timeoutId = setTimeout(() => {
      if (this._debounceTimers[syncKey] === currentSync) delete this._debounceTimers[syncKey];
      this._syncQueue = this._syncQueue.then(async () => {
        try {
          await this._syncTasksToCloud(currentSync.tasks);
        } finally {
          currentSync.resolve();
        }
      });
    }, 1500);

    return currentSync.promise;
  },

  async _syncTasksToCloud(tasks) {
    console.log('[SAVE] [TRACE] _syncTasksToCloud execution start. Tasks:', tasks.length);

    if (!navigator.onLine) {
      console.warn('[OFFLINE] [TRACE] Sync aborted: Offline.');
      this._queueOfflineMutation(tasks);
      return;
    }

    // Serialization: The unified _syncQueue handles serialization between hydration and sync.

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
      }

      const remoteVersion = cloudState?.version || 0;
      let tasksToSave = tasks;

      if (remoteVersion > this._currentVersion) {
        console.warn('[SAVE] [TRACE] Conflict detected! Cloud is ahead. Remote:', remoteVersion, 'Local:', this._currentVersion);

        // RECONCILIATION: Attempt to merge local changes into remote state
        console.log('[SAVE] [TRACE] Attempting a safety merge of local tasks into remote tasks.');
        const remoteNodes = cloudState.nodes || [];
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
      }
    }

    localStorage.setItem(migrationFlag, 'true');
    this._hasCompletedInitialSync = true;
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

    // Clear user-specific caches
    localStorage.removeItem('neuroaark_tasks_anonymous');
    // CRITICAL: DO NOT clear user keys anymore. This allows offline/recovery mode if re-login fails or returns empty.
    // const keys = Object.keys(localStorage);
    // keys.forEach(k => { if (k.startsWith('neuroaark_tasks_user_')) localStorage.removeItem(k); });
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
      await this._triggerCloudSync(tasks);
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
