const authBtn = document.getElementById('authBtn');
const authText = document.getElementById('authText');

/**
 * Authentication module for neuroaark.
 * Handles Supabase OAuth with Google, account switching, and session management.
 */
const Auth = {
  isAuthActionInProgress: false,

  async init() {
    if (!authBtn) return;

    // Check if Supabase is available
    if (!Storage || !Storage.supabase) {
      console.error('Storage or Supabase not initialized');
      return;
    }

    // 1. Check initial session state
    try {
      const { data: { session }, error } = await Storage.supabase.auth.getSession();
      if (error) throw error;

      const isLoggedIn = session && session.user;
      console.log('Initial session check:', isLoggedIn ? `Logged in as ${session.user.email}` : 'Not logged in');
      this.updateUI(isLoggedIn ? session : null);
    } catch (err) {
      console.error('Error fetching initial session:', err);
      this.updateUI(null);
    }

    // 2. Register a single robust event listener for both desktop and mobile
    // Use 'click' as it's the most standard and handles touch delay/behavior consistently
    authBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (this.isAuthActionInProgress) return;
      this.isAuthActionInProgress = true;

      try {
        const { data: { session } } = await Storage.supabase.auth.getSession();
        if (session && session.user) {
          await this.logout();
        } else {
          await this.login();
        }
      } catch (err) {
        console.error('Auth action error:', err);
        this.isAuthActionInProgress = false; // Reset on error to allow retry
      }
    });

    // 3. Listen for auth changes to sync state across the app
    Storage.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state change detected:', event);

      const isLoggedIn = !!(session && session.user);
      this.updateUI(isLoggedIn ? session : null);

      if (event === 'SIGNED_IN' && isLoggedIn) {
        console.log('User signed in. Syncing and refreshing page...');
        await Storage.syncOnLogin();
        // Force a page refresh after a small delay to ensure storage keys are updated
        // and cloud data is fetched fresh for the newly logged-in user.
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }

      if (event === 'SIGNED_OUT') {
        console.log('User signed out globally.');
        // UI is updated by updateUI(null) called above or in logout()
      }
    });

    // Make button visible once initialized
    authBtn.style.display = 'flex';
  },

  /**
   * Triggers Google OAuth login with forced account selection.
   */
  async login() {
    console.log('Initiating Google Login...');
    const { error } = await Storage.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://neuroaark.pages.dev',
        queryParams: {
          prompt: 'select_account' // MANDATORY: Forces Google to show account picker
        }
      }
    });

    if (error) {
      console.error('Error logging in:', error.message);
      this.isAuthActionInProgress = false;
    }
    // Redirect will happen, isAuthActionInProgress remains true to prevent clicks during redirect
  },

  /**
   * Signs out the user globally and resets the application state.
   */
  async logout() {
    console.log('Initiating Logout...');
    try {
      const { error } = await Storage.supabase.auth.signOut({ scope: 'global' });
      if (error) throw error;

      // Update UI immediately for responsiveness
      this.updateUI(null);

      // Redirect to index to clear all memory states and return to anonymous mode
      window.location.href = 'index.html';
    } catch (err) {
      console.error('Error logging out:', err.message);
      this.isAuthActionInProgress = false;
    }
  },

  /**
   * Updates the auth button text and accessibility based on session state.
   */
  updateUI(session) {
    if (!authBtn || !authText) return;

    const isLoggedIn = session && session.user;

    if (isLoggedIn) {
      authText.textContent = 'Sair';
      authBtn.title = `Logado como ${session.user.email}`;
      console.log('UI updated to: Sair');
    } else {
      authText.textContent = 'Entrar';
      authBtn.title = 'Entrar com Google';
      console.log('UI updated to: Entrar');
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Auth.init());
} else {
  Auth.init();
}
