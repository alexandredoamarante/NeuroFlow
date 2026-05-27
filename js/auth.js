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
    Storage.supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth event:', event);
      this.updateUI(session);

      if (event === 'SIGNED_IN') {
        Storage.syncOnLogin();
      }
    });

    authBtn.addEventListener('click', () => {
      const user = Storage.supabase.auth.getUser();
      Storage.supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          this.logout();
        } else {
          this.login();
        }
      });
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
    else window.location.reload();
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
