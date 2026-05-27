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

  // Sync lifecycle state
  _hasCompletedInitialSync: false,
  _isHydrating: false,
  _deviceId: null,
  _pendingRealtimeUpdates: [],
  _currentVersion: 0,
  _lastUpdatedAt: null,

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
    console.log('[AUTH] getSession called.');
    if (this._sessionPromise) {
      console.log('[AUTH] Returning existing session promise.');
      return this._sessionPromise;
    }

    const now = Date.now();
    if (this._session && (now - this._lastCheck < 30000)) { // 30s cache
      console.log('[AUTH] Returning cached session.');
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
    console.log('[CACHE] Updating localStorage key:', key, 'Nodes:', state.nodes?.length || 0);
    localStorage.setItem(key, JSON.stringify(state));
  },

  async getTasks() {
    const session = await this.getSession();
    const key = await this.getTasksKey();

    console.log('[GET_TASKS] Session:', !!session, 'Key:', key);

    if (session) {
      if (!this._hasCompletedInitialSync) {
        console.log('[HYDRATE] Triggering revalidation before returning tasks.');
        await this._revalidateTasks(key);
      }
      const state = this._getLocalState(key);
      return state.nodes || [];
    }

    const state = this._getLocalState(key);
    return state.nodes || [];
  },

  async getTask(id) {
    const session = await this.getSession();
    const key = await this.getTasksKey();

    if (session && !this._hasCompletedInitialSync) {
      console.log('[HYDRATE] Triggering revalidation before returning single task.');
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
    console.log('[HYDRATE] _revalidateTasks starting for:', key);
    if (this._revalidationPromises[key]) {
      console.log('[HYDRATE] Using existing revalidation promise.');
      return this._revalidationPromises[key];
    }

    this._revalidationPromises[key] = (async () => {
      this._isHydrating = true;
      try {
        const session = await this.getSession();
        if (!session) {
          console.warn('[HYDRATE] Aborting: No session found.');
          return this._getLocalState(key).nodes;
        }

        console.log('[HYDRATE] Fetching canonical_state for user:', session.user.id);
        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('local_id', 'canonical_state')
          .maybeSingle();

        if (error) {
          console.error('[HYDRATE] Supabase error:', error.message, error.code);
          // If it's not a "not found" error, we might want to retry, but for now we fallback to local.
          if (error.code === 'PGRST116') { // Not found
             console.log('[HYDRATE] Canonical state missing in cloud.');
             return await this._handleMissingCloudData(session, key);
          }
          return this._getLocalState(key).nodes;
        }

        const localState = this._getLocalState(key);
        if (data) {
          console.log('[HYDRATE] Cloud state found:', { version: data.version, t: data.updated_at, nodes: data.nodes?.length });

          const remoteVersion = data.version || 0;
          const remoteUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
          const localUpdatedAt = localState.updated_at ? new Date(localState.updated_at).getTime() : 0;
          const localVersion = localState.version || 0;

          let shouldAdoptRemote = false;
          if (remoteVersion > localVersion) {
            shouldAdoptRemote = true;
            console.log('[HYDRATE] Choice: Remote is newer (version).');
          } else if (remoteVersion === localVersion) {
            if (remoteUpdatedAt >= localUpdatedAt) {
              shouldAdoptRemote = true;
              console.log('[HYDRATE] Choice: Remote is newer or equal (timestamp).');
            } else {
              console.log('[HYDRATE] Choice: Local is newer (timestamp).');
            }
          } else {
            console.log('[HYDRATE] Choice: Local is newer (version).');
          }

          // Absolute safety: if local is empty but cloud has data, adopt cloud.
          if (!shouldAdoptRemote && localState.nodes.length === 0 && (data.nodes && data.nodes.length > 0)) {
            console.log('[HYDRATE] Choice: Local empty, adopting cloud data.');
            shouldAdoptRemote = true;
          }

          if (shouldAdoptRemote) {
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
            this._currentVersion = Math.max(this._currentVersion, remoteVersion);
          }
        } else {
          console.log('[HYDRATE] Cloud returned empty data (no row).');
          return await this._handleMissingCloudData(session, key);
        }

        this._hasCompletedInitialSync = true;
        console.log('[HYDRATE] Success. Current version:', this._currentVersion);
        return this._getLocalState(key).nodes;

      } catch (e) {
        console.error('[HYDRATE] Unexpected exception:', e);
        return this._getLocalState(key).nodes;
      } finally {
        this._isHydrating = false;
        delete this._revalidationPromises[key];
        this._processPendingUpdates();
      }
    })();

    return this._revalidationPromises[key];
  },

  async _handleMissingCloudData(session, key) {
    console.log('[HYDRATE] Handling missing cloud data...');
    // Always check for migration if cloud is empty
    return await this._runMigration(session, key);
  },

  async saveTask(task) {
    console.log('[SAVE] saveTask called for task:', task.id);
    const key = await this.getTasksKey();
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

    const session = await this.getSession();
    if (session) return await this._triggerCloudSync(tasks);
  },

  async deleteTask(id) {
    console.log('[SAVE] deleteTask called for task:', id);
    const key = await this.getTasksKey();
    const state = this._getLocalState(key);
    const filtered = (state.nodes || []).filter(t => t.id !== id);

    const newState = {
      ...state,
      nodes: filtered,
      updated_at: new Date().toISOString(),
      device_id: this.getDeviceId()
    };
    this._setLocalState(key, newState);

    const session = await this.getSession();
    if (session) return await this._triggerCloudSync(filtered);
  },

  _triggerCloudSync(tasks) {
    console.log('[SAVE] _triggerCloudSync. Tasks:', tasks.length, 'Hydrated:', this._hasCompletedInitialSync);

    // Safety: if we are not hydrated AND not currently hydrating, we must be careful.
    // However, if we just created a task, we WANT it to sync eventually.
    if (!this._hasCompletedInitialSync && !this._isHydrating) {
      console.warn('[SAVE] Attempted save before hydration initiated. Force initiating hydration.');
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
    console.log('[SAVE] _syncTasksToCloud execution start.');

    // Critical guard: Wait for hydration to finish so we don't overwrite newer cloud data with older local data.
    if (this._isHydrating) {
      console.log('[SAVE] Waiting for hydration to complete before cloud write...');
      const key = await this.getTasksKey();
      if (this._revalidationPromises[key]) await this._revalidationPromises[key];
    }

    if (!this._hasCompletedInitialSync) {
      console.error('[SAVE] Refusing to sync to cloud: Initial hydration failed or skipped.');
      return;
    }

    this._isSyncing = true;
    try {
      const session = await this.getSession();
      if (!session) {
        console.error('[SAVE] No session found during cloud write.');
        return;
      }

      const nextVersion = this._currentVersion + 1;
      const updatedAt = new Date().toISOString();
      const deviceId = this.getDeviceId();

      const payload = {
        user_id: session.user.id,
        local_id: 'canonical_state',
        nodes: tasks,
        version: nextVersion,
        device_id: deviceId,
        updated_at: updatedAt
      };

      console.log('[SAVE] Supabase UPSERT start. Version:', nextVersion);
      const { data, error } = await this.supabase
        .from('tasks')
        .upsert(payload, { onConflict: 'user_id,local_id' })
        .select();

      if (error) {
        console.error('[SAVE] Supabase UPSERT error:', error.message, error.details);
      } else {
        console.log('[SAVE] Supabase UPSERT success. Data returned:', data?.length ? 'Row exists' : 'Empty');
        this._currentVersion = nextVersion;
        this._lastUpdatedAt = updatedAt;

        // Update local metadata only if nodes still match (to avoid racing with newer local changes)
        const key = await this.getTasksKey();
        const local = this._getLocalState(key);
        if (JSON.stringify(local.nodes) === JSON.stringify(tasks)) {
          this._setLocalState(key, { ...local, version: nextVersion, updated_at: updatedAt, device_id: deviceId });
        }
      }
    } catch (e) {
      console.error('[SAVE] Unexpected sync exception:', e);
    } finally {
      this._isSyncing = false;
      this._processPendingUpdates();
    }
  },

  async syncOnLogin() {
    console.log('[AUTH] syncOnLogin starting.');
    try {
      const session = await this.getSession();
      if (!session) return;
      await this.initRealtime(session.user.id);
      const key = await this.getTasksKey();
      await this._revalidateTasks(key);
    } catch (e) {
      console.error('[AUTH] syncOnLogin error:', e);
    }
  },

  async _runMigration(session, key) {
    console.log('[MIGRATE] Checking for legacy tasks...');
    const migrationFlag = `neuroaark_migrated_v4_${session.user.id}`;

    // Check for legacy cloud tasks (pre-canonical model)
    const { data: legacyCloud } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', session.user.id)
      .neq('local_id', 'canonical_state');

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
      console.log('[MIGRATE] Consolidating', consolidated.length, 'tasks to cloud...');
      this._hasCompletedInitialSync = true; // Unlock to allow migration write
      await this._syncTasksToCloud(consolidated);
      // Clean up legacy
      await this.supabase.from('tasks').delete().match({ user_id: session.user.id }).neq('local_id', 'canonical_state');
    }

    localStorage.setItem(migrationFlag, 'true');
    this._hasCompletedInitialSync = true;
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: consolidated }));
    return consolidated;
  },

  async clearSession() {
    console.log('[AUTH] clearSession called. Purging sensitive state.');
    if (this._realtimeChannel) {
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
      this._realtimeChannel = null;
    }
    for (const k in this._debounceTimers) {
      if (this._debounceTimers[k].timeoutId) clearTimeout(this._debounceTimers[k].timeoutId);
    }
    this._debounceTimers = {};
    this._revalidationPromises = {};
    this._syncQueue = Promise.resolve();

    this._session = null;
    this._sessionPromise = null;
    this._isSyncing = false;
    this._hasCompletedInitialSync = false;
    this._isHydrating = false;
    this._pendingRealtimeUpdates = [];
    this._currentVersion = 0;

    // Clear user-specific caches
    localStorage.removeItem('neuroaark_tasks_anonymous');
    const keys = Object.keys(localStorage);
    keys.forEach(k => { if (k.startsWith('neuroaark_tasks_user_')) localStorage.removeItem(k); });
    console.log('[AUTH] Logout complete.');
  },

  async initRealtime(userId) {
    if (this._realtimeChannel) {
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
      this._realtimeChannel = null;
    }
    console.log('[REALTIME] Subscribing for user:', userId);
    this._realtimeChannel = this.supabase
      .channel(`public:tasks:user_id=eq.${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        payload => this._handleRealtimePayload(payload))
      .subscribe(status => console.log('[REALTIME] Status:', status));
  },

  async _handleRealtimePayload(payload) {
    console.log('[REALTIME] Event:', payload.eventType, payload.new?.version);
    if (this._isHydrating || this._isSyncing) {
      console.log('[REALTIME] Busy. Queueing update.');
      this._pendingRealtimeUpdates.push(payload);
      return;
    }

    if (payload.new && payload.new.local_id === 'canonical_state') {
      const remote = payload.new;
      if (remote.device_id === this.getDeviceId()) return;

      const key = await this.getTasksKey();
      const local = this._getLocalState(key);
      const remoteVersion = remote.version || 0;
      const localVersion = local.version || 0;

      if (remoteVersion > localVersion || (remoteVersion === localVersion && new Date(remote.updated_at) > new Date(local.updated_at))) {
        console.log('[REALTIME] Adopting newer remote state.');
        this._currentVersion = remoteVersion;
        this._lastUpdatedAt = remote.updated_at;
        this._setLocalState(key, { nodes: remote.nodes || [], version: remoteVersion, updated_at: remote.updated_at, device_id: remote.device_id });
        window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: remote.nodes }));
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
  }
};
