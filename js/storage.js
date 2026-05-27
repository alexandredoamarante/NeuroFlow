const SUPABASE_URL = "https://bdvwpyiabmmfsvsjytxn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo";

const Storage = {
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
  _session: null,
  _lastCheck: 0,
  _debounceTimers: {},
  _revalidationPromises: {},
  _lastCloudFetch: 0,
  _lastWrite: 0,

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
          .order('created_at', { ascending: false });

        if (!error && data) {
          this._lastCloudFetch = Date.now();
          const cloudTasks = data.map(t => ({
            id: t.local_id,
            name: t.name,
            desc: t.description,
            color: t.color,
            sessions: t.sessions,
            checklist: t.checklist,
            nodes: t.nodes
          }));

          const now = Date.now();
          // Safety: Don't overwrite LocalStorage if a local write occurred very recently (within 3s)
          // or if we have active debounced saves.
          if (Object.keys(this._debounceTimers).length > 0 || (now - this._lastWrite < 3000)) {
            console.log('Skipping cloud-to-local overwrite to protect pending local changes');
            return cloudTasks;
          }

          const localStr = localStorage.getItem(key);
          const cloudStr = JSON.stringify(cloudTasks);

          if (localStr !== cloudStr) {
            localStorage.setItem(key, cloudStr);
            window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: cloudTasks }));
          }
          return cloudTasks;
        }
      } catch (e) {
        console.error('Revalidation error:', e);
      } finally {
        delete this._revalidationPromises[key];
      }
      return JSON.parse(localStorage.getItem(key) || '[]');
    })();

    return this._revalidationPromises[key];
  },

  async saveTasks(tasks) {
    const key = await this.getTasksKey();
    localStorage.setItem(key, JSON.stringify(tasks));
    const session = await this.getSession();
    if (session) {
      // For bulk save, we iterate and save each (ensuring cloud sync)
      for (const task of tasks) {
        await this.saveTask(task);
      }
    }
  },

  async getTask(id) {
    const key = await this.getTasksKey();
    const session = await this.getSession();
    const localTasks = JSON.parse(localStorage.getItem(key) || '[]');

    if (session) {
      const now = Date.now();
      const task = localTasks.find(t => t.id === id);

      // If found in local cache and the cache is very fresh (< 10s), return immediately
      if (task && (now - this._lastCloudFetch < 10000)) {
        return task;
      }

      // Otherwise, wait for cloud to ensure we have the latest version (e.g. from another device)
      const cloudTasks = await this._revalidateTasks(key);
      return cloudTasks.find(t => t.id === id);
    }

    return localTasks.find(t => t.id === id);
  },

  async saveTask(task) {
    this._lastWrite = Date.now();
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
    if (this._debounceTimers[task.id]) {
      clearTimeout(this._debounceTimers[task.id]);
    }
    this._debounceTimers[task.id] = setTimeout(() => {
      this._syncTaskToCloud(task);
      delete this._debounceTimers[task.id];
    }, 300); // Faster debounce for cross-device sync
  },

  async _syncTaskToCloud(task) {
    try {
      const session = await this.getSession();
      if (session) {
        const taskData = {
          user_id: session.user.id,
          local_id: task.id,
          name: task.name,
          description: task.desc,
          color: task.color,
          sessions: task.sessions,
          checklist: task.checklist,
          nodes: task.nodes,
          updated_at: new Date().toISOString()
        };

        const { error } = await this.supabase
          .from('tasks')
          .upsert(taskData, { onConflict: 'user_id,local_id' });

        if (error) console.error('Error saving to Supabase:', error.message);
      }
    } catch (e) {
      console.error('Supabase sync error:', e);
    }
  },

  async deleteTask(id) {
    this._lastWrite = Date.now();
    // 1. Update local cache
    const key = await this.getTasksKey();
    const tasks = JSON.parse(localStorage.getItem(key) || '[]');
    const filtered = tasks.filter(t => t.id !== id);
    localStorage.setItem(key, JSON.stringify(filtered));

    // 2. Update Supabase (non-blocking)
    this._deleteTaskFromCloud(id);
  },

  async _deleteTaskFromCloud(id) {
    try {
      const session = await this.getSession();
      if (session) {
        const { error } = await this.supabase
          .from('tasks')
          .delete()
          .match({ user_id: session.user.id, local_id: id });

        if (error) console.error('Error deleting from Supabase:', error.message);
      }
    } catch (e) {
      console.error('Supabase delete error:', e);
    }
  },

  async syncOnLogin() {
    try {
      const session = await this.getSession();
      if (!session) return;

      // Check if we already migrated
      const migrationFlag = `neuroaark_migrated_${session.user.id}`;
      if (localStorage.getItem(migrationFlag) === 'true') return;

      // Sync FROM anonymous storage TO user storage
      const anonymousTasks = JSON.parse(localStorage.getItem('neuroaark_tasks_anonymous') || '[]');
      if (anonymousTasks.length === 0) return;

      // Check if user has any tasks in Supabase
      const { data: cloudData, error } = await this.supabase
        .from('tasks')
        .select('id')
        .limit(1);

      if (error) {
        console.error('Error checking cloud data during sync:', error.message);
        return;
      }

      // If cloud is empty for this user, migrate anonymous tasks
      if (cloudData && cloudData.length === 0) {
        console.log('Migrating anonymous tasks to Supabase user account...');
        for (const task of anonymousTasks) {
          await this.saveTask(task);
        }
        localStorage.setItem(migrationFlag, 'true');
      }
    } catch (e) {
      console.error('Supabase syncOnLogin error:', e);
    }
  }
};
