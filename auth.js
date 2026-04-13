const CONFIG = {
  CLIENT_ID: '741788740750-50bjd0rmvke6r1obgcv3rltp3verqpjj.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/cloud-platform'
};

class AuthManager {
  constructor() {
    this.accessToken = null;
    this.tokenClient = null;
  }

  init() {
    // Wait for Google Identity Services to load
    const waitForGIS = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        clearInterval(waitForGIS);
        this._initTokenClient();
      }
    }, 100);

    // Timeout after 10 seconds
    setTimeout(() => clearInterval(waitForGIS), 10000);
  }

  _initTokenClient() {
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      include_granted_scopes: true,
      callback: (response) => {
        if (response.error !== undefined) {
          console.error('[ClipSorter Auth] Token error:', response);
          if (typeof app !== 'undefined') {
            app.showToast('Login failed: ' + response.error, 'error');
          }
          return;
        }

        console.log('[ClipSorter Auth] Granted scopes:', response.scope);

        this.accessToken = response.access_token;
        
        // Cache the token for 1 hour (Google Implicit Token Lifespan)
        localStorage.setItem('clipsorter_session', JSON.stringify({
          token: response.access_token,
          expires_at: Date.now() + (response.expires_in * 1000)
        }));

        this.onLoginSuccess();
      },
    });

    // Check if we have a valid cached token to skip the login screen
    const cachedSessionStr = localStorage.getItem('clipsorter_session');
    if (cachedSessionStr) {
      try {
        const session = JSON.parse(cachedSessionStr);
        // Add a 5 minute buffer to expiration check
        if (session.token && session.expires_at > Date.now() + (5 * 60 * 1000)) {
          console.log('[ClipSorter Auth] Restored session from cache');
          this.accessToken = session.token;
          this.onLoginSuccess();
          return; // Skip setting up login button
        } else {
          localStorage.removeItem('clipsorter_session');
        }
      } catch (e) {
        localStorage.removeItem('clipsorter_session');
      }
    }

    // Default: Setup manual login button
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        this.tokenClient.requestAccessToken({ prompt: '' });
      });
    }
  }

  logout() {
    localStorage.removeItem('clipsorter_session');
    if (this.accessToken && google.accounts.oauth2.revoke) {
      try { google.accounts.oauth2.revoke(this.accessToken); } catch(e) {}
    }
    location.reload();
  }

  onLoginSuccess() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('hidden');
    // Show the app screen
    setTimeout(() => {
      document.getElementById('app-screen').classList.remove('hidden');
      document.getElementById('app-screen').classList.add('active');
      // Notify app that auth is ready
      if (typeof app !== 'undefined' && app.initAfterAuth) {
        app.initAfterAuth();
      }
    }, 50);
  }
}

const auth = new AuthManager();
