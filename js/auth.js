const authBtn = document.getElementById('authBtn');
const authText = document.getElementById('authText');

const Auth = {
  isAuthActionInProgress: false,

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

    // Mobile-friendly event listener
    const handleAuthAction = async (e) => {
      if (this.isAuthActionInProgress) return;
      this.isAuthActionInProgress = true;

      try {
        const { data: { session } } = await Storage.supabase.auth.getSession();
        if (session) {
          await this.logout();
        } else {
          await this.login();
        }
      } catch (err) {
        console.error('Auth action error:', err);
      } finally {
        // Delay resetting to avoid double triggers
        setTimeout(() => {
          this.isAuthActionInProgress = false;
        }, 1000);
      }
    };

    authBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      handleAuthAction(e);
    });

    // Fallback for older browsers
    authBtn.addEventListener('click', (e) => {
      if (e.pointerType === 'mouse' || !e.pointerType) {
        handleAuthAction(e);
      }
    });

    authBtn.style.display = 'flex';
  },

  async login() {
    const { error } = await Storage.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://neuroaark.pages.dev'
      }
    });
    if (error) console.error('Error logging in:', error.message);
  },

  async logout() {
    const { error } = await Storage.supabase.auth.signOut();
    if (error) console.error('Error logging out:', error.message);

    // Clear session-specific state from UI immediately if needed
    this.updateUI(null);

    // Force reload to clear memory and re-initialize state in anonymous mode
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
