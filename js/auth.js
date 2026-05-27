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
      const { data: { session } } = await Storage.supabase.auth.getSession();
      if (session) {
        Storage._session = session;
        Storage._lastCheck = Date.now();
      }
      this.updateUI(session);
    } catch (err) {
      console.error('Error fetching initial session:', err);
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
      console.log('[AUTH] Auth event:', event);

      // Update Storage cache
      Storage._session = session;
      Storage._lastCheck = Date.now();

      // Safety: treat session as logged in only if user exists
      const isLoggedIn = session && session.user;
      this.updateUI(isLoggedIn ? session : null);

      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (isLoggedIn) {
          console.log('[AUTH] User authenticated. Triggering sync flow.');
          await Storage.syncOnLogin();
        }
      }

      if (event === 'SIGNED_OUT') {
        // Reset local app state if needed
        console.log('[AUTH] User signed out');
        await Storage.clearSession();
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
      // Clear session data before signing out to ensure listeners are gone
      await Storage.clearSession();

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

    if (session && session.user) {
      authText.textContent = 'Sair';
      authBtn.title = `Logado como ${session.user.email}`;
    } else {
      authText.textContent = 'Entrar';
      authBtn.title = 'Entrar com Google';
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Auth.init());
} else {
  Auth.init();
}
