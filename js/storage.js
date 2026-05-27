const SUPABASE_URL = "https://bdvwpyiabmmfsvsjytxn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo";

const Storage = {
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),

  async getTasks() {
    const localTasks = JSON.parse(localStorage.getItem('neuroaark_tasks') || '[]');

    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session) {
        const { data, error } = await this.supabase
          .from('tasks')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
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
          // Update local cache
          localStorage.setItem('neuroaark_tasks', JSON.stringify(cloudTasks));
          return cloudTasks;
        }
      }
    } catch (e) {
      console.error('Supabase getTasks error:', e);
    }

    return localTasks;
  },

  async saveTasks(tasks) {
    localStorage.setItem('neuroaark_tasks', JSON.stringify(tasks));
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session) {
      // For bulk save, we might want a single call, but current app saves individually mostly
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
    const tasks = JSON.parse(localStorage.getItem('neuroaark_tasks') || '[]');
    const index = tasks.findIndex(t => t.id === task.id);
    if (index > -1) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }
    localStorage.setItem('neuroaark_tasks', JSON.stringify(tasks));

    // 2. Update Supabase if logged in
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
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
      console.error('Supabase saveTask error:', e);
    }
  },

  async deleteTask(id) {
    // 1. Update local cache
    const tasks = JSON.parse(localStorage.getItem('neuroaark_tasks') || '[]');
    const filtered = tasks.filter(t => t.id !== id);
    localStorage.setItem('neuroaark_tasks', JSON.stringify(filtered));

    // 2. Update Supabase
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session) {
        const { error } = await this.supabase
          .from('tasks')
          .delete()
          .match({ user_id: session.user.id, local_id: id });

        if (error) console.error('Error deleting from Supabase:', error.message);
      }
    } catch (e) {
      console.error('Supabase deleteTask error:', e);
    }
  },

  async syncOnLogin() {
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (!session) return;

      // Check if we already migrated
      if (localStorage.getItem('neuroaark_migrated') === 'true') return;

      const localTasks = JSON.parse(localStorage.getItem('neuroaark_tasks') || '[]');
      if (localTasks.length === 0) return;

      // Check if cloud has data
      const { data: cloudData, error } = await this.supabase
        .from('tasks')
        .select('id')
        .limit(1);

      if (error) {
        console.error('Error checking cloud data during sync:', error.message);
        return;
      }

      if (cloudData && cloudData.length === 0) {
        console.log('Migrating local tasks to Supabase...');
        for (const task of localTasks) {
          await this.saveTask(task);
        }
        localStorage.setItem('neuroaark_migrated', 'true');
      }
    } catch (e) {
      console.error('Supabase syncOnLogin error:', e);
    }
  }
};
