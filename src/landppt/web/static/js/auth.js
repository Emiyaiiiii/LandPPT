// Auth utility functions

/**
 * Get token from URL parameters
 */
function getTokenFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    return token;
}

/**
 * Check if user is authenticated by checking sessionStorage for token
 */
export function isAuthenticated() {
    return !!getToken();
}

/**
 * Get token from sessionStorage or URL parameters
 * Priority: URL parameters > sessionStorage
 */
export function getToken() {
    // First, try to get token from URL parameters
    const urlToken = getTokenFromUrl();
    if (urlToken) {
        // Save token to sessionStorage for future requests
        setToken(urlToken);
        // Remove token from URL to avoid exposing it in browser history
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        window.history.replaceState({}, document.title, url.toString());
        // Remove surrounding quotes if present
        if (urlToken && (urlToken.startsWith('"') || urlToken.startsWith("'")) && (urlToken.endsWith('"') || urlToken.endsWith("'"))) {
            return urlToken.slice(1, -1);
        }
        return urlToken;
    }
    
    // If no token in URL, try to get from sessionStorage
    const token = sessionStorage.getItem('token');
    // Remove surrounding quotes if present
    if (token && (token.startsWith('"') || token.startsWith("'")) && (token.endsWith('"') || token.endsWith("'"))) {
        return token.slice(1, -1);
    }
    return token;
}

/**
 * Set token in sessionStorage
 */
export function setToken(token) {
    sessionStorage.setItem('token', token);
}

/**
 * Remove token from sessionStorage
 */
export function removeToken() {
    sessionStorage.removeItem('token');
}

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
 * This function checks if the user is already authenticated by calling the backend
 */
async function checkSessionAuth() {
    try {
        // Check if we have session_id in URL (iframe cross-domain scenario)
        const urlSessionId = getSessionIdFromUrl();
        console.log('[checkSessionAuth] URL session_id:', urlSessionId);
        
        let fetchUrl = '/api/auth/check';
        let fetchOptions = {
            credentials: 'same-origin' // Include cookies in the request
        };
        
        // If session_id is in URL, append it to the request
        if (urlSessionId) {
            fetchUrl = `/api/auth/check?_session_id=${encodeURIComponent(urlSessionId)}`;
            console.log('[checkSessionAuth] Using URL session_id for auth check:', urlSessionId);
        }
        
        console.log('[checkSessionAuth] Fetching:', fetchUrl);
        const response = await fetch(fetchUrl, fetchOptions);
        console.log('[checkSessionAuth] Response status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('[checkSessionAuth] Response data:', data);
            return data.authenticated === true;
        }
        console.log('[checkSessionAuth] Response not ok');
        return false;
    } catch (error) {
        console.error('[checkSessionAuth] Error:', error);
        return false;
    }
}

/**
 * Check authentication status and redirect if needed
 * This function checks both token auth and session cookie auth
 * Also supports iframe cross-domain scenario with URL session parameter
 */
export async function checkAuth() {
    // First, check session cookie auth or URL session_id (for regular login and iframe)
    try {
        const urlSessionId = getSessionIdFromUrl();
        let sessionFetchUrl = '/api/auth/check';
        
        if (urlSessionId) {
            sessionFetchUrl = `/api/auth/check?_session_id=${encodeURIComponent(urlSessionId)}`;
        }
        
        const sessionResponse = await fetch(sessionFetchUrl, {
            credentials: 'same-origin'
        });
        
        if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            if (sessionData.authenticated === true) {
                return true;
            }
        }
    } catch (error) {
        console.error('Session auth check failed:', error);
    }

    // Then, check token auth (for external token login)
    const token = getToken();
    if (token) {
        try {
            // Validate token with backend
            const response = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                // Token is valid, user is authenticated
                return true;
            } else {
                // Token is invalid, remove it
                removeToken();
                return false;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            removeToken();
            return false;
        }
    }
    return false;
}

/**
 * Initialize auth on page load
 * This function is called on all pages to check authentication status
 */
export async function initAuth() {
    console.log('[initAuth] Starting auth check, pathname:', window.location.pathname, 'search:', window.location.search);
    
    // Skip auth check on public pages to avoid infinite redirects
    if (isPublicPage()) {
        console.log('Skipping auth check on public page:', window.location.pathname);
        return;
    }

    // Skip auth check on root page - backend handles the redirect
    if (isRootPage()) {
        console.log('Skipping auth check on root page - handled by backend');
        return;
    }

    // First, check if user is already logged in via session cookie or URL session
    const urlSessionId = getSessionIdFromUrl();
    console.log('[initAuth] URL session_id:', urlSessionId);
    
    const isSessionAuthenticated = await checkSessionAuth();
    console.log('[initAuth] Session auth result:', isSessionAuthenticated);
    
    if (isSessionAuthenticated) {
        console.log('User is already authenticated via session');
        return;
    }

    // If not authenticated via session, check for external token
    const token = getToken();
    
    if (token) {
        try {
            // Validate token with backend
            const response = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                // Token is invalid, remove it
                removeToken();
                // Redirect to login page
                window.location.href = '/auth/login';
            } else {
                // Token is valid, user is authenticated
                // The backend middleware should have created a session
                // Refresh the page to get the session cookie
                console.log('Token valid, refreshing to get session cookie');
                window.location.reload();
            }
        } catch (error) {
            console.error('Auth initialization failed:', error);
            removeToken();
            window.location.href = '/auth/login';
        }
    } else {
        // No token and no session, redirect to login page
        window.location.href = '/auth/login';
    }
}

// Initialize auth when the script is loaded
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initAuth);
}
