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
    if (this._sessionPromise) return this._sessionPromise;

    const now = Date.now();
    if (this._session && (now - this._lastCheck < 60000)) {
      return this._session;
    }

    this._sessionPromise = (async () => {
      try {
        const { data: { session } } = await this.supabase.auth.getSession();
        this._session = session;
        this._lastCheck = Date.now();
        return session;
      } catch (e) {
        console.error('[AUTH] Error fetching session:', e);
        return null;
      } finally {
        this._sessionPromise = null;
      }
    })();

    return this._sessionPromise;
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
    const session = await this.getSession();
    const key = await this.getTasksKey();

    if (session) {
      if (!this._hasCompletedInitialSync) {
        console.log('[HYDRATE] Waiting for initial cloud sync completion...');
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
          this._hasCompletedInitialSync = true; // Allow app to proceed with local data
          return state.nodes || [];
        }

        const localState = this._getLocalState(key);

        if (data) {
          console.log('[SYNC] Remote state found:', { version: data.version, updated_at: data.updated_at, device_id: data.device_id });

          const remoteVersion = data.version || 0;
          const remoteUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
          const localUpdatedAt = localState.updated_at ? new Date(localState.updated_at).getTime() : 0;
          const localVersion = localState.version || 0;

          // Source of Truth Logic:
          // In a Cloud-First architecture, the remote state is the authority.
          // We only prefer local state if it is strictly newer (offline changes).
          // If they are equal (e.g. both 0), we trust the cloud.

          let shouldAdoptRemote = false;

          if (remoteVersion > localVersion) {
            console.log('[SYNC] Remote version is higher.');
            shouldAdoptRemote = true;
          } else if (remoteVersion === localVersion) {
            if (remoteUpdatedAt >= localUpdatedAt) {
              console.log('[SYNC] Remote timestamp is newer or equal.');
              shouldAdoptRemote = true;
            } else {
              console.log('[SYNC] Local timestamp is newer. Preserving offline changes.');
            }
          } else {
            console.log('[SYNC] Local version is higher. Preserving local state.');
          }

          // Special case: if local is empty and remote has data, always adopt remote
          if (!shouldAdoptRemote && localState.nodes.length === 0 && (data.nodes && data.nodes.length > 0)) {
            console.log('[SYNC] Local state empty, adopting remote data regardless of version/timestamp.');
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

            console.log('[SYNC] Applying remote state to local.');
            this._setLocalState(key, newState);
            window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: newState.nodes }));
          } else {
            console.log('[SYNC] Keeping local state (it is newer or equal).');
            this._currentVersion = remoteVersion;
            this._lastUpdatedAt = data.updated_at;
          }

          this._hasCompletedInitialSync = true;
          return this._getLocalState(key).nodes;
        } else {
          console.log('[SYNC] No remote state found on cloud.');
          // Before giving up, check if we need to migrate legacy data
          const migrationFlag = `neuroaark_migrated_v3_${session.user.id}`;
          if (localStorage.getItem(migrationFlag) !== 'true') {
            console.log('[SYNC] Triggering migration flow...');
            return await this._runMigration(session, key, migrationFlag);
          }
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
    const session = await this.getSession();
    const key = await this.getTasksKey();

    if (session && !this._hasCompletedInitialSync) {
      console.log('[HYDRATE] getTask waiting for initial cloud sync...');
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
    // If we are currently hydrating, we SHOULD still schedule the sync.
    // The _syncQueue and _isHydrating check in _syncTasksToCloud will manage it.
    if (!this._hasCompletedInitialSync && !this._isHydrating) {
      console.warn('[SAVE] Attempted to save before initial sync started. Skipping.');
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
    }, 1500);

    return currentSync.promise;
  },

  async _syncTasksToCloud(tasks) {
    // Wait if we are still hydrating
    if (this._isHydrating) {
      console.log('[SAVE] Postponing sync until hydration completes...');
      // Use the existing revalidation promise if it exists
      const key = await this.getTasksKey();
      if (this._revalidationPromises[key]) {
        await this._revalidationPromises[key];
      }
    }

    this._isSyncing = true;
    console.log('[SAVE] Syncing to cloud. Node count:', tasks.length);
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
          // Only update if the nodes still match what we just saved (to avoid overwriting newer local changes)
          if (JSON.stringify(localState.nodes) === JSON.stringify(tasks)) {
            this._setLocalState(key, {
              ...localState,
              version: nextVersion,
              updated_at: updatedAt,
              device_id: deviceId
            });
          }
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
      console.log('[AUTH] Initial hydration...');
      await this._revalidateTasks(key);

    } catch (e) {
      console.error('[AUTH] Supabase syncOnLogin error:', e);
    }
  },

  async _runMigration(session, key, migrationFlag) {
    // 1. Try to find canonical state again
    const { data: canonical } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('local_id', 'canonical_state')
      .maybeSingle();

    if (canonical) {
      console.log('[MIGRATE] Canonical found. Adopting.');
      const cloudTasks = canonical.nodes || [];
      this._hasCompletedInitialSync = true;
      this._setLocalState(key, {
        nodes: cloudTasks,
        version: canonical.version || 0,
        updated_at: canonical.updated_at,
        device_id: canonical.device_id
      });
      localStorage.setItem(migrationFlag, 'true');
      window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: cloudTasks }));
      return cloudTasks;
    }

    // 2. Check for legacy cloud data
    const { data: legacyCloudTasks } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', session.user.id)
      .neq('local_id', 'canonical_state');

    let consolidatedTasks = [];
    if (legacyCloudTasks && legacyCloudTasks.length > 0) {
      console.log('[MIGRATE] Found legacy cloud tasks.');
      consolidatedTasks = legacyCloudTasks.map(t => ({
        id: t.local_id,
        name: t.name || 'Tarefa sem nome',
        desc: t.description || '',
        color: t.color || '#60a5fa',
        sessions: t.sessions || 0,
        checklist: t.checklist || [],
        nodes: t.nodes || []
      }));
    } else {
      // 3. Fallback to anonymous local storage
      console.log('[MIGRATE] No legacy cloud data. Checking anonymous local.');
      const anonymousTasks = JSON.parse(localStorage.getItem('neuroaark_tasks_anonymous') || '[]');
      if (anonymousTasks.length > 0) {
        consolidatedTasks = anonymousTasks;
      }
    }

    if (consolidatedTasks.length > 0) {
      console.log('[MIGRATE] Migrating', consolidatedTasks.length, 'tasks to canonical state.');
      this._hasCompletedInitialSync = true; // Mark as synced so save can proceed
      await this._syncTasksToCloud(consolidatedTasks);
      // Clean up legacy cloud tasks
      await this.supabase
        .from('tasks')
        .delete()
        .match({ user_id: session.user.id })
        .neq('local_id', 'canonical_state');
    }

    localStorage.setItem(migrationFlag, 'true');
    this._hasCompletedInitialSync = true;
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: consolidatedTasks }));
    return consolidatedTasks;
  },

  async clearSession() {
    console.log('[AUTH] Clearing session and local user cache...');

    // 1. Unsubscribe from realtime first
    if (this._realtimeChannel) {
      try {
        await this.supabase.removeChannel(this._realtimeChannel);
      } catch (e) {
        console.warn('[AUTH] Error removing realtime channel:', e);
      }
      this._realtimeChannel = null;
    }

    // 2. Cancel any pending syncs/timers to prevent "save-after-logout"
    for (const key in this._debounceTimers) {
      if (this._debounceTimers[key].timeoutId) {
        clearTimeout(this._debounceTimers[key].timeoutId);
      }
    }
    this._debounceTimers = {};
    this._revalidationPromises = {};
    // Replace the sync queue with a fresh one to effectively cancel pending cloud writes in the chain
    this._syncQueue = Promise.resolve();

    // 3. Reset internal state
    this._session = null;
    this._sessionPromise = null;
    this._lastCheck = 0;
    this._isSyncing = false;
    this._hasCompletedInitialSync = false;
    this._isHydrating = false;
    this._pendingRealtimeUpdates = [];
    this._currentVersion = 0;
    this._lastUpdatedAt = null;

    // 4. Clean up local storage cautiously
    // We clear the anonymous tasks because logout usually means wanting a fresh start or returning to a clean state.
    localStorage.removeItem('neuroaark_tasks_anonymous');

    // We also clear all user-specific task caches to prevent data leakage between sessions on the same machine.
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('neuroaark_tasks_user_')) {
        localStorage.removeItem(key);
      }
    });
    console.log('[AUTH] Session cleared successfully.');
  },

  async initRealtime(userId) {
    if (this._realtimeChannel) {
      console.log('[REALTIME] Removing existing channel.');
      try {
        await this.supabase.removeChannel(this._realtimeChannel);
      } catch (e) {
        console.warn('[REALTIME] Error removing channel:', e);
      }
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
      .subscribe((status) => {
        console.log('[REALTIME] Status changed:', status);
        if (status === 'SUBSCRIBED') {
           console.log('[REALTIME] Successfully subscribed.');
        }
      });
  },

  async _handleRealtimePayload(payload) {
    console.log('[REALTIME] Event:', payload.eventType);

    if (this._isHydrating || this._isSyncing) {
      console.log('[REALTIME] Busy (Hydrating/Syncing). Queueing.');
      this._pendingRealtimeUpdates.push(payload);
      return;
    }

    if (payload.new && payload.new.local_id === 'canonical_state') {
      const remote = payload.new;
      const key = await this.getTasksKey();
      const local = this._getLocalState(key);

      // 1. Ignore updates from this device to prevent loops
      if (remote.device_id === this.getDeviceId()) {
        console.log('[REALTIME] Ignoring update from self.');
        return;
      }

      const remoteUpdatedAt = new Date(remote.updated_at).getTime();
      const localUpdatedAt = local.updated_at ? new Date(local.updated_at).getTime() : 0;
      const remoteVersion = remote.version || 0;
      const localVersion = local.version || 0;

      // 2. Conflict resolution: Remote wins if it has a higher version or newer timestamp
      // Version is our primary counter, timestamp is the secondary tie-breaker.
      if (remoteVersion > localVersion || (remoteVersion === localVersion && remoteUpdatedAt > localUpdatedAt)) {
        console.log('[REALTIME] Applying newer remote state.', { remoteVersion, localVersion });
        const newState = {
          nodes: remote.nodes || [],
          version: remoteVersion,
          updated_at: remote.updated_at,
          device_id: remote.device_id
        };

        this._currentVersion = remoteVersion;
        this._lastUpdatedAt = remote.updated_at;

        this._setLocalState(key, newState);
        window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: newState.nodes }));
      } else {
        console.log('[REALTIME] Remote state is stale or equal. Ignoring.', { remoteVersion, localVersion });
      }
    }
  }
};
