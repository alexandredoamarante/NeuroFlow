const SUPABASE_URL = "https://bdvwpyiabmmfsvsjytxn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo";

const Storage = {
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),

  async getTasksKey() {
    // Migration: neuroaark_tasks -> neuroaark_tasks_anonymous
    const legacyData = localStorage.getItem('neuroaark_tasks');
    if (legacyData && !localStorage.getItem('neuroaark_tasks_anonymous')) {
      console.log('Migrating legacy localStorage data to anonymous key...');
      localStorage.setItem('neuroaark_tasks_anonymous', legacyData);
    }

    const { data: { session } } = await this.supabase.auth.getSession();
    if (session && session.user) return `neuroaark_tasks_user_${session.user.id}`;
    return 'neuroaark_tasks_anonymous';
  },

  async getTasks() {
    const key = await this.getTasksKey();
    const localTasks = JSON.parse(localStorage.getItem(key) || '[]');

    try {
      const { data: { session } } = await this.supabase.auth.getSession();

      // If logged in, cloud is the source of truth
      if (session && session.user) {
        console.log('Fetching tasks from Supabase...');
        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Supabase SELECT error:', error.message, error.details);
          // Fallback to local cache if cloud fails
          return localTasks;
        }

        if (data) {
          console.log(`Successfully fetched ${data.length} tasks from Supabase.`);
          // Map Supabase data to app format
          const cloudTasks = data.map(t => ({
            id: t.local_id,
            name: t.name,
            desc: t.description,
            color: t.color,
            sessions: t.sessions,
            checklist: t.checklist,
            nodes: t.nodes
          }));
          // Update local cache to match cloud
          localStorage.setItem(key, JSON.stringify(cloudTasks));
          return cloudTasks;
        }
      }
    } catch (e) {
      console.error('Supabase getTasks exception:', e);
    }

    // Default for anonymous or fallback
    return localTasks;
  },

  async saveTasks(tasks) {
    const key = await this.getTasksKey();
    localStorage.setItem(key, JSON.stringify(tasks));
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session) {
      // For bulk save, we iterate and save each (ensuring cloud sync)
      for (const task of tasks) {
        await this.saveTask(task);
      }
    }
  },

  async getTask(id) {
    const tasks = await this.getTasks();
    return tasks.find(t => t.id === id);
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

    // 2. Update Supabase if logged in
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session && session.user) {
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

        if (error) {
          console.error('Supabase UPSERT error:', error.message, error.details, error.hint);
        } else {
          console.log(`Task ${task.id} synced to Supabase.`);
        }
      }
    } catch (e) {
      console.error('Supabase saveTask exception:', e);
    }
  },

  async deleteTask(id) {
    // 1. Update local cache
    const key = await this.getTasksKey();
    const tasks = JSON.parse(localStorage.getItem(key) || '[]');
    const filtered = tasks.filter(t => t.id !== id);
    localStorage.setItem(key, JSON.stringify(filtered));

    // 2. Update Supabase
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session && session.user) {
        const { error } = await this.supabase
          .from('tasks')
          .delete()
          .match({ user_id: session.user.id, local_id: id });

        if (error) {
          console.error('Supabase DELETE error:', error.message, error.details);
        } else {
          console.log(`Task ${id} deleted from Supabase.`);
        }
      }
    } catch (e) {
      console.error('Supabase deleteTask exception:', e);
    }
  },

  async syncOnLogin() {
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
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
