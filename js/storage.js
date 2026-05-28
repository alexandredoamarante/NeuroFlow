const SUPABASE_URL = "https://bdvwpyiabmmfsvsjytxn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo";

const Storage = {
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
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

  async checkWorkspaceExists(id) {
    console.log(`[WORKSPACE] Checking if workspace exists: ${id}`);
    const { count, error } = await this.supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', id);

    if (error) {
      console.error('[WORKSPACE] Error checking workspace existence:', error);
      return false;
    }
    return count > 0;
  },

  async resetWorkspaceLifecycle() {
    console.log('[WORKSPACE] Resetting lifecycle...');

    // 1. Destroy old realtime
    if (this._realtimeChannel) {
      console.log('[REALTIME] Removing old channel:', this._realtimeChannel.topic);
      try {
        await this.supabase.removeChannel(this._realtimeChannel);
      } catch (e) {
        console.error('[REALTIME] Error removing channel:', e);
      }
      this._realtimeChannel = null;
    }
    this._isSubscribing = false;

    // 2. Clear timers and debounces
    if (this._realtimeDebounce) clearTimeout(this._realtimeDebounce);
    for (const id in this._debounceTimers) clearTimeout(this._debounceTimers[id]);
    this._debounceTimers = {};

    // 3. Reset sync/hydration state
    this._hasCompletedInitialSync = false;
    this._isHydrating = false;
    this._revalidationPromises = {};
    this._pendingRealtimeUpdates = [];
    this._syncQueue = Promise.resolve();
    this._currentVersion = 0;
    this._lastUpdatedAt = null;
  },

  async setWorkspaceId(id, options = {}) {
    if (!id) return;
    console.log(`[WORKSPACE] Switching to workspace: ${id}`, options);

    await this.resetWorkspaceLifecycle();

    this._workspaceId = id;
    localStorage.setItem('neuroaark_workspace_id', id);

    const key = await this.getTasksKey();

    if (options.replaceLocalState) {
      console.log('[WORKSPACE] Clearing local state for new workspace');
      localStorage.removeItem(key);
    }

    // Trigger immediate hydration with full replacement if requested
    await this.initRealtime(id);
    await this._revalidateTasks(key, {
      forceRemote: true,
      replaceLocalState: options.replaceLocalState
    });

    window.dispatchEvent(new CustomEvent('workspaceChanged', { detail: { workspaceId: id } }));
  },

  async leaveWorkspace() {
    console.log('[WORKSPACE] Leaving workspace...');
    const newKey = this.generateWorkspaceKey();
    await this.setWorkspaceId(newKey, { replaceLocalState: true });
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

  async _revalidateTasks(key, options = {}) {
    if (this._revalidationPromises[key]) return this._revalidationPromises[key];

    this._revalidationPromises[key] = (async () => {
      try {
        const workspaceId = this.getWorkspaceId();
        console.log(`[HYDRATION] [SELECT] Revalidating workspace: ${workspaceId}`, options);

        // Ensure realtime is active
        if (!this._realtimeChannel && !this._isSubscribing) {
          this.initRealtime(workspaceId);
        }

        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('workspace_id', workspaceId);

        this._logNetwork('FETCH_ALL_TASKS', { workspaceId }, data, error);
        console.log(`[HYDRATION] [SELECT] Response from Supabase:`, { count: data?.length, error });

        if (error) {
          console.error('[HYDRATE] Supabase fetch error:', error.message);
          return this._getLocalState(key).nodes;
        }

        const dataArray = Array.isArray(data) ? data : (data ? [data] : []);
        const localState = options.replaceLocalState ? { nodes: [] } : this._getLocalState(key);
        let localTasks = [...(localState.nodes || [])];
        let hasChanges = options.replaceLocalState;

        let legacyState = dataArray.find(r => r.local_id === 'canonical_state');
        if (legacyState) {
          console.log('[HYDRATION] Found legacy canonical_state, migrating...');
          const remoteTasks = legacyState.nodes || [];
          localTasks = remoteTasks;
          hasChanges = true;
          this._migrateLegacyData(workspaceId, legacyState);
        } else {
          // Per-task mode
          if (options.replaceLocalState) {
             localTasks = dataArray.filter(r => r.local_id !== 'canonical_state').map(r => r.nodes);
          } else {
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

  async _migrateLegacyData(workspaceId, legacyState) {
    const tasks = legacyState.nodes || [];
    console.log(`[PERSISTENCE] [MIGRATE] Migrating ${tasks.length} tasks to workspace ${workspaceId}`);

    for (const task of tasks) {
      const payload = {
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
    // Ensure BIGINT compatible timestamp
    task.version = Date.now();
    task.updated_at = new Date().toISOString();

    console.log(`[PERSISTENCE] [SAVE] Optimistic save for task: ${task.id}`);

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
      console.log(`[PERSISTENCE] [INSERT/UPSERT] Syncing task: ${task.id} to workspace: ${workspaceId}`);

      const payload = {
        workspace_id: workspaceId,
        local_id: String(task.id),
        nodes: JSON.parse(JSON.stringify(task)),
        version: task.version,
        device_id: this.getDeviceId()
      };

      const { data, error } = await this.supabase
        .from('tasks')
        .upsert(payload, { onConflict: 'workspace_id,local_id' })
        .select();

      this._logNetwork('SAVE_TASK_UPSERT', { ...payload }, data, error);

      if (error) {
        console.error('[PERSISTENCE] [ERROR] Supabase upsert failed:', error.message, error.details);
        throw error;
      }

      console.log(`[PERSISTENCE] [SUCCESS] Task ${task.id} synced remotely.`);

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


  async initRealtime(workspaceId) {
    if (this._isSubscribing) return;

    if (this._realtimeChannel) {
      console.log('[REALTIME] Cleaning up existing channel before re-subscribing');
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
      this._realtimeChannel = null;
    }

    console.log(`[REALTIME] Subscribing to workspace: ${workspaceId}`);
    this._isSubscribing = true;

    const channelName = `public:tasks:workspace_id=eq.${workspaceId}`;
    this._realtimeChannel = this.supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tasks',
        filter: `workspace_id=eq.${workspaceId}`
      },
      payload => this._handleRealtimePayload(payload))
      .subscribe((status) => {
        console.log(`[REALTIME] Subscription status for ${workspaceId}:`, status);
        this._isSubscribing = false;
      });
  },

  async _handleRealtimePayload(payload) {
    if (payload.new && payload.new.device_id === this.getDeviceId()) return;
    if (payload.new && payload.new.local_id === 'canonical_state') return;

    console.log('[REALTIME] Payload received:', payload.eventType, payload.new?.local_id);

    // Debounce revalidation to avoid floods and hydration loops
    if (this._realtimeDebounce) clearTimeout(this._realtimeDebounce);

    this._realtimeDebounce = setTimeout(async () => {
      console.log('[REALTIME] Triggering revalidation after debounce');
      const key = await this.getTasksKey();
      this._enqueue(() => this._revalidateTasks(key));
    }, 300);
  }
};

window.Storage = Storage;
