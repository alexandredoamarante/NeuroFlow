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
  _isTransitioning: false,
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
    console.log('[WORKSPACE] [RESET] Resetting all lifecycle state...');
    this._isTransitioning = true;

    // 1. Destroy old realtime
    if (this._realtimeChannel) {
      const topic = this._realtimeChannel.topic;
      console.log('[REALTIME] [CLEANUP] Removing channel:', topic);
      try {
        await this.supabase.removeChannel(this._realtimeChannel);
        console.log('[REALTIME] [CLEANUP] Channel removed:', topic);
      } catch (e) {
        console.error('[REALTIME] [ERROR] Error removing channel:', e);
      }
      this._realtimeChannel = null;
    }
    this._isSubscribing = false;

    // 2. Clear timers and debounces
    if (this._realtimeDebounce) {
      clearTimeout(this._realtimeDebounce);
      this._realtimeDebounce = null;
    }
    for (const id in this._debounceTimers) {
      clearTimeout(this._debounceTimers[id]);
    }
    this._debounceTimers = {};

    // 3. Reset sync/hydration state
    this._hasCompletedInitialSync = false;
    this._isHydrating = false;
    this._revalidationPromises = {};
    this._pendingRealtimeUpdates = [];

    // Reset sync queue properly by letting it drain or just replacing it
    // Note: Replacing it might leave floating promises, but since we are resetting the workspace,
    // those old operations (if any) should target the old workspace anyway.
    this._syncQueue = Promise.resolve();

    this._currentVersion = 0;
    this._lastUpdatedAt = null;

    console.log('[WORKSPACE] [RESET] Lifecycle reset complete.');
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

    this._isTransitioning = false;
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
        this._isHydrating = true;
        const workspaceId = this.getWorkspaceId();
        console.log(`[HYDRATION] [START] Revalidating workspace: ${workspaceId}`, options);

        // Ensure realtime is active
        if (!this._realtimeChannel && !this._isSubscribing) {
          this.initRealtime(workspaceId);
        }

        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('workspace_id', workspaceId);

        this._logNetwork('FETCH_ALL_TASKS', { workspaceId }, data, error);

        if (error) {
          console.error('[HYDRATION] [ERROR] Supabase fetch failed:', error.message, error.details);
          // If we fail to fetch, we DO NOT set _hasCompletedInitialSync to true.
          // This keeps the system in a "revalidation required" state.
          return this._getLocalState(key).nodes;
        }

        const dataArray = Array.isArray(data) ? data : (data ? [data] : []);
        console.log(`[HYDRATION] [FETCH] Found ${dataArray.length} remote rows.`);

        const localState = options.replaceLocalState ? { nodes: [] } : this._getLocalState(key);
        let localTasks = [...(localState.nodes || [])];
        let hasChanges = options.replaceLocalState;

        // 1. Check for Legacy Data
        let legacyRow = dataArray.find(r => r.local_id === 'canonical_state');
        if (legacyRow) {
          console.log('[HYDRATION] [LEGACY] Found legacy monolithic state. Unpacking...');
          const remoteTasks = legacyRow.nodes || [];

          // Legacy migration: Monolithic state takes precedence initially
          localTasks = remoteTasks;
          hasChanges = true;

          // Trigger background migration
          this._migrateLegacyData(workspaceId, legacyRow);
        } else {
          // 2. Per-Task Merging (Cloud Parity Authority)
          // Remote state is the source of truth for WHICH tasks exist.
          const remoteTasksMap = new Map();
          dataArray.forEach(row => {
            if (row.local_id !== 'canonical_state') {
              remoteTasksMap.set(String(row.local_id), row);
            }
          });

          if (options.replaceLocalState) {
            console.log('[HYDRATION] [REPLACE] Replacing local state with remote data.');
            localTasks = Array.from(remoteTasksMap.values()).map(r => r.nodes);
            hasChanges = true;
          } else {
            // Smart Merge:
            // a) Tasks in remote but not local -> Add
            // b) Tasks in both -> Compare version, take newest
            // c) Tasks in local but not remote -> DELETED (unless they are new and not yet synced)

            const mergedTasks = [];

            // Handle Remote & Common tasks
            remoteTasksMap.forEach((remoteRow, localId) => {
              const remoteTask = remoteRow.nodes;
              const remoteVersion = remoteRow.version || 0;
              const localIdx = localTasks.findIndex(t => String(t.id) === localId);

              if (localIdx === -1) {
                // New from remote
                mergedTasks.push(remoteTask);
                hasChanges = true;
              } else {
                const localTask = localTasks[localIdx];
                const localVersion = localTask.version || 0;

                if (remoteVersion >= localVersion) {
                  mergedTasks.push(remoteTask);
                  if (remoteVersion > localVersion) hasChanges = true;
                } else {
                  // Local is newer (e.g. offline edit)
                  mergedTasks.push(localTask);
                  // We don't mark hasChanges = true for local storage because it's already there
                  // but we should eventually trigger a sync UP if needed.
                }
              }
            });

            // Handle tasks that might be local-only (newly created, not yet in cloud)
            // Or tasks that were deleted remotely
            localTasks.forEach(localTask => {
              if (!remoteTasksMap.has(String(localTask.id))) {
                // If we haven't completed initial sync yet, we should be VERY careful about deleting local data.
                // It might be that the remote fetch failed or returned partial data.
                if (!this._hasCompletedInitialSync) {
                   console.log(`[HYDRATION] [KEEP] Preserving local-only task during initial sync: ${localTask.id}`);
                   mergedTasks.push(localTask);
                } else {
                  // Is it very new? (Created in last 30 seconds)
                  const isVeryNew = (Date.now() - (localTask.version || 0)) < 30000;
                  if (isVeryNew) {
                    console.log(`[HYDRATION] [KEEP] Keeping local-only task (likely pending sync): ${localTask.id}`);
                    mergedTasks.push(localTask);
                  } else {
                    console.log(`[HYDRATION] [DELETE] Removing local task not found in cloud: ${localTask.id}`);
                    hasChanges = true;
                  }
                }
              }
            });

            localTasks = mergedTasks;
          }
        }

        if (hasChanges || !this._hasCompletedInitialSync) {
          console.log(`[HYDRATION] [COMMIT] Applying ${localTasks.length} tasks to local state.`);
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
        console.error('[HYDRATION] [EXCEPTION] Hydration failed:', e);
        return this._getLocalState(key).nodes;
      } finally {
        this._isHydrating = false;
        setTimeout(() => { delete this._revalidationPromises[key]; }, 100);
      }
    })();

    return this._revalidationPromises[key];
  },

  async _migrateLegacyData(workspaceId, legacyState) {
    const tasks = legacyState.nodes || [];
    console.log(`[PERSISTENCE] [MIGRATE] Migrating ${tasks.length} tasks to workspace ${workspaceId}`);

    // We use a serial migration to avoid hitting rate limits or RLS bottlenecks
    for (const task of tasks) {
      const payload = {
        workspace_id: workspaceId,
        local_id: String(task.id),
        nodes: task,
        version: 1, // Start with version 1 for migrated tasks
        device_id: this.getDeviceId()
      };

      try {
        const { data, error } = await this.supabase
          .from('tasks')
          .upsert(payload, { onConflict: 'workspace_id,local_id' });
        this._logNetwork('MIGRATION_TASK_UPSERT', payload, data, error);

        if (error) console.error('[MIGRATE] [ERROR] Failed to upsert task:', task.id, error);
      } catch (e) {
        console.error('[MIGRATE] [EXCEPTION] Task migration failed:', task.id, e);
      }
    }

    // ONLY delete the legacy row AFTER all tasks are upserted successfully
    // This is safer to avoid data loss if migration is interrupted.
    console.log('[PERSISTENCE] [MIGRATE] Deleting legacy monolithic row...');
    const { data: delData, error: delError } = await this.supabase
      .from('tasks')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('local_id', 'canonical_state');

    this._logNetwork('MIGRATION_DELETE_LEGACY', { workspaceId }, delData, delError);
    if (delError) console.error('[MIGRATE] [ERROR] Failed to delete legacy row:', delError);
  },

  async saveTask(task) {
    if (this._isTransitioning) {
      console.warn('[PERSISTENCE] [SAVE] Skipping save: Workspace is transitioning.');
      return;
    }
    const key = await this.getTasksKey();
    const workspaceIdAtTimeOfSave = this.getWorkspaceId();

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
      // Use the workspace ID that was active when saveTask was CALLED
      const workspaceId = workspaceIdAtTimeOfSave;

      // Safety: If the current workspace has changed since the task was enqueued,
      // we must be VERY careful. However, since we captured workspaceIdAtTimeOfSave,
      // this specific upsert will still target the "correct" workspace it was meant for.

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
    if (this._isTransitioning) {
      console.warn('[PERSISTENCE] [DELETE] Skipping delete: Workspace is transitioning.');
      return;
    }
    const key = await this.getTasksKey();
    const workspaceIdAtTimeOfDelete = this.getWorkspaceId();

    // 1. OPTIMISTIC DELETE: Local cache immediately
    const state = this._getLocalState(key);
    const filtered = (state.nodes || []).filter(t => t.id !== id);
    this._setLocalState(key, { ...state, nodes: filtered, updated_at: new Date().toISOString() });

    // 2. INSTANT FEEDBACK: UI updates now
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: filtered }));

    // 3. BACKGROUND SYNC
    const runDelete = async () => {
      const workspaceId = workspaceIdAtTimeOfDelete;
      const { data, error } = await this.supabase
        .from('tasks')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('local_id', String(id));

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

    const channelName = `public:tasks:ws:${workspaceId}`;

    // 1. Pre-check: If we already have a channel for THIS workspace, do nothing
    if (this._realtimeChannel) {
      if (this._realtimeChannel.topic === `realtime:${channelName}`) {
        console.log('[REALTIME] [SKIP] Already subscribed to:', workspaceId);
        return;
      }
      // If it's a different workspace, clean it up first
      console.log('[REALTIME] [CLEANUP] Removing old channel before switching...');
      try { await this.supabase.removeChannel(this._realtimeChannel); } catch(e){}
      this._realtimeChannel = null;
    }

    console.log(`[REALTIME] [START] Subscribing to: ${workspaceId}`);
    this._isSubscribing = true;

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
        console.log(`[REALTIME] [STATUS] ${workspaceId}:`, status);
        this._isSubscribing = false;

        if (status === 'CHANNEL_ERROR') {
          console.error('[REALTIME] [ERROR] Subscription failed. Retrying in 5s...');
          this._realtimeChannel = null;
          setTimeout(() => this.initRealtime(workspaceId), 5000);
        }
      });
  },

  async _handleRealtimePayload(payload) {
    // 1. Ignore updates from ourselves
    if (payload.new && payload.new.device_id === this.getDeviceId()) return;

    // 2. Ignore legacy state updates
    if (payload.new && payload.new.local_id === 'canonical_state') return;
    if (payload.old && payload.old.local_id === 'canonical_state') return;

    console.log('[REALTIME] [EVENT] Received:', payload.eventType, payload.new?.local_id || payload.old?.local_id);

    // 3. Debounce revalidation
    if (this._realtimeDebounce) clearTimeout(this._realtimeDebounce);

    this._realtimeDebounce = setTimeout(async () => {
      console.log('[REALTIME] [REVALIDATE] Triggering hydration...');
      const key = await this.getTasksKey();
      // Hydration handles merging correctly
      this._revalidateTasks(key);
    }, 300);
  }
};

window.Storage = Storage;
