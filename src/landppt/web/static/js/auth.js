// Auth utility functions


/**
 * Check if current page is a public page that doesn't require authentication
 */
function isPublicPage() {
    const path = window.location.pathname;
    const publicPaths = [
        '/auth/login',
        '/auth/register',
        '/auth/forgot-password',
        '/auth/reset-password',
        '/auth/logout'
    ];
    return publicPaths.some(publicPath => path.startsWith(publicPath));
}

/**
 * Check if current page is the root page
 */
function isRootPage() {
    return window.location.pathname === '/';
}

/**
 * Get session ID from URL parameters (for iframe cross-domain scenarios)
 */
function getSessionIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('_session_id');
}

/**
 * Check if user is logged in via session cookie or URL session parameter
 */
async function checkSessionAuth() {
    try {
        const urlSessionId = getSessionIdFromUrl();

        let fetchUrl = '/api/auth/check';
        let fetchOptions = {
            credentials: 'same-origin'
        };

        if (urlSessionId) {
            fetchUrl = `/api/auth/check?_session_id=${encodeURIComponent(urlSessionId)}`;
        }

        const response = await fetch(fetchUrl, fetchOptions);

        if (response.ok) {
            const data = await response.json();
            return data.authenticated === true;
        }
        return false;
    } catch (error) {
        console.error('[checkSessionAuth] Error:', error);
        return false;
    }
}

/**
 * Initialize auth on page load
 * This function is called on all pages to check authentication status
 *
 * For browser token login: backend (main.py root()) handles token -> session conversion
 * For iframe token login: backend handles it and passes _session_id via URL
 */
export async function initAuth() {
    // Skip auth check on public pages to avoid infinite redirects
    if (isPublicPage()) {
        return;
    }

    // Skip auth check on root page - backend handles the redirect
    if (isRootPage()) {
        return;
    }

    // Get _session_id from URL first (for iframe cross-domain scenarios)
    const urlSessionId = getSessionIdFromUrl();

    // Check if user is already logged in via session cookie or URL session
    const isSessionAuthenticated = await checkSessionAuth();

    if (isSessionAuthenticated) {
        // If we have _session_id in URL, store it for iframe use
        if (urlSessionId && typeof window.sessionStorage !== 'undefined') {
            try {
                sessionStorage.setItem('_iframe_session_id', urlSessionId);
            } catch (e) {
                // Ignore storage errors
            }
        }
        return;
    }

    // Not authenticated via session, redirect to login page
    // Preserve _session_id if present (for iframe scenarios)
    let loginUrl = '/auth/login';
    if (urlSessionId) {
        loginUrl = `/auth/login?_session_id=${encodeURIComponent(urlSessionId)}`;
    }
    window.location.href = loginUrl;
}

// Initialize auth when the script is loaded
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initAuth);
}
