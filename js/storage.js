const SUPABASE_URL = "https://bdvwpyiabmmfsvsjytxn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo";

const Storage = {
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
  _session: null,
  _lastCheck: 0,
  _debounceTimers: {},
  _revalidationPromises: {},

  async getSession() {
    const now = Date.now();
    // Cache session for 1 minute to avoid excessive calls
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
    // Migration: neuroaark_tasks -> neuroaark_tasks_anonymous
    const legacyData = localStorage.getItem('neuroaark_tasks');
    if (legacyData && !localStorage.getItem('neuroaark_tasks_anonymous')) {
      localStorage.setItem('neuroaark_tasks_anonymous', legacyData);
    }

    const session = await this.getSession();
    if (session && session.user) return `neuroaark_tasks_user_${session.user.id}`;
    return 'neuroaark_tasks_anonymous';
  },

  async getTasks() {
    const key = await this.getTasksKey();
    const session = await this.getSession();

    if (session) {
      // When logged in, Supabase is the primary source.
      // ALWAYS wait for a fresh fetch to ensure cross-device consistency.
      return await this._revalidateTasks(key);
    }

    // Offline / Anonymous mode
    return JSON.parse(localStorage.getItem(key) || '[]');
  },

  async _revalidateTasks(key) {
    if (this._revalidationPromises[key]) return this._revalidationPromises[key];

    this._revalidationPromises[key] = (async () => {
      try {
        const session = await this.getSession();
        if (!session) return JSON.parse(localStorage.getItem(key) || '[]');

        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('local_id', 'canonical_state')
          .single();

        if (!error && data) {
          // In the single-document model, the 'nodes' field contains the full array of tasks
          const cloudTasks = data.nodes || [];

          // Safety: Don't overwrite LocalStorage if we have active debounced saves.
          if (Object.keys(this._debounceTimers).length > 0) {
            console.log('Skipping cloud-to-local overwrite to protect pending local changes');
            return JSON.parse(localStorage.getItem(key) || '[]');
          }

          const localStr = localStorage.getItem(key);
          const cloudStr = JSON.stringify(cloudTasks);

          if (localStr !== cloudStr) {
            localStorage.setItem(key, cloudStr);
            window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: cloudTasks }));
          }
          return cloudTasks;
        } else if (error && error.code === 'PGRST116') {
          // Row not found - first time user or legacy user needing migration
          return JSON.parse(localStorage.getItem(key) || '[]');
        } else {
          // Error fetching from cloud (e.g. network failure)
          // Return local cache as fallback but DON'T overwrite anything
          console.warn('Supabase fetch error, falling back to local cache:', error);
          return JSON.parse(localStorage.getItem(key) || '[]');
        }
      } catch (e) {
        console.error('Revalidation error:', e);
        return JSON.parse(localStorage.getItem(key) || '[]');
      } finally {
        delete this._revalidationPromises[key];
      }
    })();

    return this._revalidationPromises[key];
  },

  async saveTasks(tasks) {
    const key = await this.getTasksKey();
    localStorage.setItem(key, JSON.stringify(tasks));
    const session = await this.getSession();
    if (session) {
      // In single-document model, saveTasks updates the full state
      return await this._triggerCloudSync(tasks);
    }
  },

  async getTask(id) {
    const key = await this.getTasksKey();
    const session = await this.getSession();
    const localTasks = JSON.parse(localStorage.getItem(key) || '[]');

    if (session) {
      // For logged-in users, ALWAYS wait for cloud to ensure we have the latest version (e.g. from another device)
      const cloudTasks = await this._revalidateTasks(key);
      const found = cloudTasks.find(t => t.id === id);
      if (found) return found;
      // Fallback to local if not found in cloud yet (maybe newly created)
      return localTasks.find(t => t.id === id);
    }

    return localTasks.find(t => t.id === id);
  },

  async saveTask(task) {
    // 1. Update local cache immediately
    const key = await this.getTasksKey();
    const tasks = JSON.parse(localStorage.getItem(key) || '[]');
    const index = tasks.findIndex(t => t.id === task.id);
    if (index > -1) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }
    localStorage.setItem(key, JSON.stringify(tasks));

    // 2. Update Supabase if logged in (non-blocking with debounce)
    const session = await this.getSession();
    if (session) {
      return await this._triggerCloudSync(tasks);
    }
  },

  _triggerCloudSync(tasks) {
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
    currentSync.timeoutId = setTimeout(async () => {
      // Deleting from map BEFORE async sync starts ensures that if a new save
      // happens during sync, it starts a new debounced batch instead of re-using this resolving one.
      if (this._debounceTimers[syncKey] === currentSync) {
        delete this._debounceTimers[syncKey];
      }
      try {
        await this._syncTasksToCloud(currentSync.tasks);
      } finally {
        currentSync.resolve();
      }
    }, 300);

    return currentSync.promise;
  },

  async _syncTasksToCloud(tasks) {
    try {
      const session = await this.getSession();
      if (session) {
        const payload = {
          user_id: session.user.id,
          local_id: 'canonical_state',
          nodes: tasks, // Using 'nodes' column to store the full state JSON array
          updated_at: new Date().toISOString()
        };

        const { error } = await this.supabase
          .from('tasks')
          .upsert(payload, { onConflict: 'user_id,local_id' });

        if (error) console.error('Error saving to Supabase:', error.message);
      }
    } catch (e) {
      console.error('Supabase sync error:', e);
    }
  },

  async deleteTask(id) {
    // 1. Update local cache
    const key = await this.getTasksKey();
    const tasks = JSON.parse(localStorage.getItem(key) || '[]');
    const filtered = tasks.filter(t => t.id !== id);
    localStorage.setItem(key, JSON.stringify(filtered));

    // 2. Update Supabase (non-blocking)
    const session = await this.getSession();
    if (session) {
      return await this._triggerCloudSync(filtered);
    }
  },

  async syncOnLogin() {
    try {
      const session = await this.getSession();
      if (!session) return;

      // Check if we already migrated to the single-document model
      const migrationFlag = `neuroaark_migrated_v2_${session.user.id}`;
      if (localStorage.getItem(migrationFlag) === 'true') return;

      console.log('Starting migration to single-document model...');

      // 1. Check for canonical state
      const { data: canonical, error: fetchError } = await this.supabase
        .from('tasks')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('local_id', 'canonical_state')
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching canonical state during migration:', fetchError.message);
        return;
      }

      // If canonical state already exists, we consider migration done for cloud
      if (canonical) {
        const key = await this.getTasksKey();
        const cloudTasks = canonical.nodes || [];
        localStorage.setItem(key, JSON.stringify(cloudTasks));
        localStorage.setItem(migrationFlag, 'true');

        // Refresh view
        window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: cloudTasks }));
        return;
      }

      // 2. Fetch all legacy item-level tasks from cloud
      const { data: legacyCloudTasks, error: legacyError } = await this.supabase
        .from('tasks')
        .select('*')
        .eq('user_id', session.user.id)
        .neq('local_id', 'canonical_state');

      let consolidatedTasks = [];

      if (!legacyError && legacyCloudTasks && legacyCloudTasks.length > 0) {
        console.log('Legacy item-level tasks found in cloud. Migrating...');
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
        // 3. Fallback: migrate anonymous LocalStorage tasks
        const anonymousTasks = JSON.parse(localStorage.getItem('neuroaark_tasks_anonymous') || '[]');
        if (anonymousTasks.length > 0) {
          console.log('No legacy cloud tasks. Migrating anonymous LocalStorage tasks...');
          consolidatedTasks = anonymousTasks;
        }
      }

      if (consolidatedTasks.length > 0) {
        // Save to canonical document
        await this._syncTasksToCloud(consolidatedTasks);

        // Cleanup legacy rows (optional but recommended)
        await this.supabase
          .from('tasks')
          .delete()
          .match({ user_id: session.user.id })
          .neq('local_id', 'canonical_state');
      }

      localStorage.setItem(migrationFlag, 'true');
      console.log('Migration to single-document model complete.');

      // Refresh view
      window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: consolidatedTasks }));
    } catch (e) {
      console.error('Supabase syncOnLogin error:', e);
    }
  }
};
