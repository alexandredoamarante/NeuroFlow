const authBtn = document.getElementById('authBtn');
const authText = document.getElementById('authText');

const Auth = {
  async init() {
    if (!authBtn) return;

    // Wait for Supabase to be available (it's loaded via CDN)
    if (typeof supabase === 'undefined') {
      console.error('Supabase not loaded');
      return;
    }

    // Check session
    const { data: { session } } = await Storage.supabase.auth.getSession();
    this.updateUI(session);

    // Listen for auth changes
    Storage.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth event:', event);
      this.updateUI(session);

      if (event === 'SIGNED_IN') {
        await Storage.syncOnLogin();
      }
    });

    authBtn.addEventListener('click', async () => {
      const { data: { session } } = await Storage.supabase.auth.getSession();
      if (session) {
        await this.logout();
      } else {
        await this.login();
      }
    });

    authBtn.style.display = 'flex';
  },

  async login() {
    const { error } = await Storage.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) console.error('Error logging in:', error.message);
  },

  async logout() {
    const { error } = await Storage.supabase.auth.signOut();
    if (error) console.error('Error logging out:', error.message);
    // Force reload to clear memory and re-initialize state
    window.location.href = 'index.html';
  },

  updateUI(session) {
    if (!authBtn) return;
    if (session) {
      authText.textContent = 'Sair';
      authBtn.title = `Logado como ${session.user.email}`;
    } else {
      authText.textContent = 'Entrar';
      authBtn.title = 'Entrar com Google';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => Auth.init());
