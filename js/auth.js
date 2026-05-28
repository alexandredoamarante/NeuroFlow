const authBtn = document.getElementById('authBtn');
const authText = document.getElementById('authText');

/**
 * Authentication module for neuroaark.
 * Handles Supabase OAuth with Google, account switching, and session management.
 */
const Auth = {
  isAuthActionInProgress: false,

  async init() {
    console.log('[AUTH] [TRACE] Auth.init starting.');
    if (!authBtn) return;

    // Check if Supabase is available
    if (!Storage || !Storage.supabase) {
      console.error('[AUTH] [TRACE] Storage or Supabase not initialized');
      return;
    }

    // 1. Check initial session state
    try {
      console.log('[AUTH] [TRACE] Checking initial session...');
      const { data: { session } } = await Storage.supabase.auth.getSession();
      if (session) {
        console.log('[AUTH] [TRACE] Initial session found:', session.user.id);
        Storage._session = session;
        Storage._lastCheck = Date.now();
      } else {
        console.log('[AUTH] [TRACE] No initial session.');
      }
      this.updateUI(session);
    } catch (err) {
      console.error('[AUTH] [TRACE] Error fetching initial session:', err);
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
      console.log('[AUTH] [TRACE] Auth event received:', event, session ? `Session User: ${session.user.id}` : 'No session');

      const oldUserId = Storage._session?.user?.id;
      // Update Storage cache
      Storage._session = session;
      Storage._lastCheck = Date.now();

      // Safety: treat session as logged in only if user exists
      const isLoggedIn = session && session.user;
      this.updateUI(isLoggedIn ? session : null);

      // We trigger sync if:
      // 1. It's a SIGNED_IN event (new login or session recovery)
      // 2. It's INITIAL_SESSION and we have a user
      // 3. The user ID has changed
      const newUserId = session?.user?.id;
      const userChanged = oldUserId !== newUserId;

      if ((event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && isLoggedIn) || userChanged) && isLoggedIn) {
          console.log('[AUTH] [TRACE] User authenticated, changed, or initial session. Triggering sync flow.');
          await Storage.syncOnLogin();
      }

      if (event === 'SIGNED_OUT') {
        console.log('[AUTH] [TRACE] User signed out event.');
        await Storage.clearSession();
      }

      if (event === 'TOKEN_REFRESHED' && isLoggedIn) {
        console.log('[AUTH] Token refreshed.');
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
    console.log('[AUTH] [TRACE] Initiating Logout...');
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
