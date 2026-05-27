const SUPABASE_URL = "https://bdvwpyiabmmfsvsjytxn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo";

const Storage = {
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
  _session: null,
  _lastCheck: 0,
  _debounceTimers: {},
  _revalidationPromises: {},
  _syncQueue: Promise.resolve(),
  _realtimeChannel: null,
  _isSyncing: false,

  // New sync lifecycle state
  _hasCompletedInitialSync: false,
  _isHydrating: false,
  _deviceId: null,
  _pendingRealtimeUpdates: [],
  _currentVersion: 0,
  _lastUpdatedAt: null,

  /**
   * Generates or retrieves a unique device ID to track the source of updates.
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

  async getSession() {
    const now = Date.now();
    if (this._session && (now - this._lastCheck < 60000)) {
      return this._session;
    }
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      this._session = session;
      this._lastCheck = now;
      return session;
    } catch (e) {
      return null;
    }
  },

  async getTasksKey() {
    const legacyData = localStorage.getItem('neuroaark_tasks');
    if (legacyData && !localStorage.getItem('neuroaark_tasks_anonymous')) {
      localStorage.setItem('neuroaark_tasks_anonymous', legacyData);
    }

    const session = await this.getSession();
    if (session && session.user) return `neuroaark_tasks_user_${session.user.id}`;
    return 'neuroaark_tasks_anonymous';
  },

  /**
   * Helper to get the full state object from localStorage, including metadata.
   */
  _getLocalState(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return { nodes: [], version: 0, updated_at: null, device_id: null };
    try {
      const parsed = JSON.parse(raw);
      // Handle legacy format (array only) vs new format (object with metadata)
      if (Array.isArray(parsed)) {
        return { nodes: parsed, version: 0, updated_at: null, device_id: null };
      }
      return parsed;
    } catch (e) {
      return { nodes: [], version: 0, updated_at: null, device_id: null };
    }
  },

  /**
   * Helper to set the full state object in localStorage.
   */
  _setLocalState(key, state) {
    localStorage.setItem(key, JSON.stringify(state));
  },

  async getTasks() {
    const key = await this.getTasksKey();
    const session = await this.getSession();

    if (session) {
      if (!this._hasCompletedInitialSync && !this._isHydrating) {
        console.log('[HYDRATE] Triggering initial cloud fetch...');
        await this._revalidateTasks(key);
      }
      const state = this._getLocalState(key);
      return state.nodes || [];
    }

    const state = this._getLocalState(key);
    return state.nodes || [];
  },

  async _revalidateTasks(key) {
    if (this._revalidationPromises[key]) return this._revalidationPromises[key];

    this._revalidationPromises[key] = (async () => {
      this._isHydrating = true;
      console.log('[HYDRATE] Starting revalidation...');
      try {
        const session = await this.getSession();
        if (!session) {
          const state = this._getLocalState(key);
          return state.nodes || [];
        }

        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('local_id', 'canonical_state')
          .maybeSingle();

        if (error) {
          console.warn('[SYNC] Supabase fetch error, falling back to local cache:', error.message);
          const state = this._getLocalState(key);
          return state.nodes || [];
        }

        const localState = this._getLocalState(key);

        if (data) {
          console.log('[SYNC] Remote state found:', { version: data.version, updated_at: data.updated_at, device_id: data.device_id });

          const remoteVersion = data.version || 0;
          const remoteUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
          const localUpdatedAt = localState.updated_at ? new Date(localState.updated_at).getTime() : 0;

          // Conflict Protection: Never overwrite newer data with older state
          if (remoteUpdatedAt < localUpdatedAt && localState.nodes.length > 0) {
             console.log('[SYNC] Local state is newer than remote. Skipping overwrite.');
             this._hasCompletedInitialSync = true;
             return localState.nodes;
          }

          // Conflict Protection: Remote state must be protected against accidental deletion caused by empty local caches
          if (localState.nodes.length === 0 && (data.nodes && data.nodes.length > 0)) {
            console.log('[SYNC] Local state empty but remote has data. Adopting remote state.');
          }

          // Adopt remote state if it's newer or we are just starting
          const newState = {
            nodes: data.nodes || [],
            version: remoteVersion,
            updated_at: data.updated_at,
            device_id: data.device_id
          };

          this._currentVersion = remoteVersion;
          this._lastUpdatedAt = data.updated_at;

          if (JSON.stringify(localState.nodes) !== JSON.stringify(newState.nodes)) {
            console.log('[SYNC] Applying remote state to local.');
            this._setLocalState(key, newState);
            window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: newState.nodes }));
          }

          this._hasCompletedInitialSync = true;
          return newState.nodes;
        } else {
          console.log('[SYNC] No remote state found.');
          this._hasCompletedInitialSync = true;
          return localState.nodes;
        }
      } catch (e) {
        console.error('[SYNC] Revalidation error:', e);
        const state = this._getLocalState(key);
        return state.nodes || [];
      } finally {
        this._isHydrating = false;
        delete this._revalidationPromises[key];
        this._processPendingUpdates();
      }
    })();

    return this._revalidationPromises[key];
  },

  _processPendingUpdates() {
    if (this._pendingRealtimeUpdates.length > 0) {
      console.log(`[REALTIME] Processing ${this._pendingRealtimeUpdates.length} pending updates.`);
      const updates = [...this._pendingRealtimeUpdates];
      this._pendingRealtimeUpdates = [];
      updates.forEach(payload => this._handleRealtimePayload(payload));
    }
  },

  async saveTasks(tasks) {
    const key = await this.getTasksKey();
    const localState = this._getLocalState(key);

    const newState = {
      ...localState,
      nodes: tasks,
      updated_at: new Date().toISOString(),
      device_id: this.getDeviceId()
    };

    this._setLocalState(key, newState);

    const session = await this.getSession();
    if (session) {
      return await this._triggerCloudSync(tasks);
    }
  },

  async getTask(id) {
    const key = await this.getTasksKey();
    const session = await this.getSession();

    if (session && !this._hasCompletedInitialSync && !this._isHydrating) {
      await this._revalidateTasks(key);
    }

    const state = this._getLocalState(key);
    const tasks = state.nodes || [];
    return tasks.find(t => t.id === id);
  },

  async saveTask(task) {
    const key = await this.getTasksKey();
    const state = this._getLocalState(key);
    const tasks = state.nodes || [];
    const index = tasks.findIndex(t => t.id === task.id);
    if (index > -1) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }

    const newState = {
      ...state,
      nodes: tasks,
      updated_at: new Date().toISOString(),
      device_id: this.getDeviceId()
    };

    this._setLocalState(key, newState);

    const session = await this.getSession();
    if (session) {
      return await this._triggerCloudSync(tasks);
    }
  },

  _triggerCloudSync(tasks) {
    // Prevent autosave before initial cloud hydration
    if (!this._hasCompletedInitialSync && !this._isHydrating) {
      console.warn('[SAVE] Attempted to save before initial sync. Skipping.');
      return Promise.resolve();
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
      if (this._debounceTimers[syncKey] === currentSync) {
        delete this._debounceTimers[syncKey];
      }

      this._syncQueue = this._syncQueue.then(async () => {
        try {
          await this._syncTasksToCloud(currentSync.tasks);
        } finally {
          currentSync.resolve();
        }
      });
    }, 1500); // Aggressive 1500ms debounce

    return currentSync.promise;
  },

  async _syncTasksToCloud(tasks) {
    if (this._isHydrating) {
      console.log('[SAVE] Skipping sync while hydrating.');
      return;
    }

    this._isSyncing = true;
    console.log('[SAVE] Syncing to cloud...');
    try {
      const session = await this.getSession();
      if (session) {
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

        const { error } = await this.supabase
          .from('tasks')
          .upsert(payload, { onConflict: 'user_id,local_id' });

        if (error) {
          console.error('[SAVE] Error saving to Supabase:', error.message);
        } else {
          console.log('[SAVE] Sync successful. Version:', nextVersion);
          this._currentVersion = nextVersion;
          this._lastUpdatedAt = updatedAt;

          // Update local state metadata after successful sync
          const key = await this.getTasksKey();
          const localState = this._getLocalState(key);
          this._setLocalState(key, {
            ...localState,
            version: nextVersion,
            updated_at: updatedAt,
            device_id: deviceId
          });
        }
      }
    } catch (e) {
      console.error('[SAVE] Supabase sync error:', e);
    } finally {
      this._isSyncing = false;
      this._processPendingUpdates();
    }
  },

  async deleteTask(id) {
    const key = await this.getTasksKey();
    const state = this._getLocalState(key);
    const tasks = state.nodes || [];
    const filtered = tasks.filter(t => t.id !== id);

    const newState = {
      ...state,
      nodes: filtered,
      updated_at: new Date().toISOString(),
      device_id: this.getDeviceId()
    };

    this._setLocalState(key, newState);

    const session = await this.getSession();
    if (session) {
      return await this._triggerCloudSync(filtered);
    }
  },

  async syncOnLogin() {
    console.log('[AUTH] Sync on login triggered.');
    try {
      const session = await this.getSession();
      if (!session) return;

      await this.initRealtime(session.user.id);

      const key = await this.getTasksKey();

      // Perform migration if needed
      const migrationFlag = `neuroaark_migrated_v2_${session.user.id}`;
      if (localStorage.getItem(migrationFlag) !== 'true') {
        console.log('[AUTH] Running migration...');
        await this._runMigration(session, key, migrationFlag);
      } else {
        await this._revalidateTasks(key);
      }

    } catch (e) {
      console.error('[AUTH] Supabase syncOnLogin error:', e);
    }
  },

  async _runMigration(session, key, migrationFlag) {
    const { data: canonical, error: fetchError } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('local_id', 'canonical_state')
      .maybeSingle();

    if (fetchError) {
      console.error('[AUTH] Error fetching canonical state during migration:', fetchError.message);
      return;
    }

    if (canonical) {
      const cloudTasks = canonical.nodes || [];
      this._setLocalState(key, {
        nodes: cloudTasks,
        version: canonical.version || 0,
        updated_at: canonical.updated_at,
        device_id: canonical.device_id
      });
      localStorage.setItem(migrationFlag, 'true');
      this._hasCompletedInitialSync = true;
      window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: cloudTasks }));
      return;
    }

    // Handle legacy data...
    const { data: legacyCloudTasks } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', session.user.id)
      .neq('local_id', 'canonical_state');

    let consolidatedTasks = [];
    if (legacyCloudTasks && legacyCloudTasks.length > 0) {
      consolidatedTasks = legacyCloudTasks.map(t => ({
        id: t.local_id,
        name: t.name,
        desc: t.description,
        color: t.color,
        sessions: t.sessions,
        checklist: t.checklist,
        nodes: t.nodes
      }));
    } else {
      const anonymousTasks = JSON.parse(localStorage.getItem('neuroaark_tasks_anonymous') || '[]');
      if (anonymousTasks.length > 0) {
        consolidatedTasks = anonymousTasks;
      }
    }

    if (consolidatedTasks.length > 0) {
      await this._syncTasksToCloud(consolidatedTasks);
      await this.supabase
        .from('tasks')
        .delete()
        .match({ user_id: session.user.id })
        .neq('local_id', 'canonical_state');
    }

    localStorage.setItem(migrationFlag, 'true');
    this._hasCompletedInitialSync = true;
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: consolidatedTasks }));
  },

  async clearSession() {
    console.log('[AUTH] Clearing session...');
    if (this._realtimeChannel) {
      await this.supabase.removeChannel(this._realtimeChannel);
      this._realtimeChannel = null;
    }

    this._session = null;
    this._lastCheck = 0;
    this._isSyncing = false;
    this._hasCompletedInitialSync = false;
    this._isHydrating = false;
    this._pendingRealtimeUpdates = [];

    for (const key in this._debounceTimers) {
      if (this._debounceTimers[key].timeoutId) {
        clearTimeout(this._debounceTimers[key].timeoutId);
      }
    }
    this._debounceTimers = {};
    this._revalidationPromises = {};
    // Ensure sync queue is reset for next user
    this._syncQueue = Promise.resolve();

    // Clear temporary caches to prevent mixing user states
    console.log('[AUTH] Clearing local state cache...');
    localStorage.removeItem('neuroaark_tasks_anonymous');
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('neuroaark_tasks_user_')) {
        localStorage.removeItem(key);
      }
    });
  },

  async initRealtime(userId) {
    if (this._realtimeChannel) {
      await this.supabase.removeChannel(this._realtimeChannel);
      this._realtimeChannel = null;
    }

    console.log('[REALTIME] Initializing for user:', userId);
    this._realtimeChannel = this.supabase
      .channel(`public:tasks:user_id=eq.${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${userId}`
        },
        async (payload) => {
          this._handleRealtimePayload(payload);
        }
      )
      .subscribe();
  },

  async _handleRealtimePayload(payload) {
    console.log('[REALTIME] Update received:', payload.eventType);

    if (this._isHydrating || this._isSyncing) {
      console.log('[REALTIME] Hydration or Sync in progress. Queueing update.');
      this._pendingRealtimeUpdates.push(payload);
      return;
    }

    if (payload.new && payload.new.local_id === 'canonical_state') {
      const remote = payload.new;
      const key = await this.getTasksKey();
      const local = this._getLocalState(key);

      // Never apply our own updates back via realtime to avoid feedback loops
      if (remote.device_id === this.getDeviceId()) {
        console.log('[REALTIME] Ignoring update from current device.');
        return;
      }

      const remoteUpdatedAt = new Date(remote.updated_at).getTime();
      const localUpdatedAt = local.updated_at ? new Date(local.updated_at).getTime() : 0;

      if (remoteUpdatedAt > localUpdatedAt) {
        console.log('[REALTIME] Remote state is newer. Applying.');
        const newState = {
          nodes: remote.nodes || [],
          version: remote.version || 0,
          updated_at: remote.updated_at,
          device_id: remote.device_id
        };

        this._currentVersion = newState.version;
        this._lastUpdatedAt = newState.updated_at;

        this._setLocalState(key, newState);
        window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: newState.nodes }));
      } else {
        console.log('[REALTIME] Remote state is older or equal. Ignoring.');
      }
    }
  }
};
