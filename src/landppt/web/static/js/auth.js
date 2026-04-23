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
 * Check if user is logged in via session cookie
 * This function checks if the user is already authenticated by calling the backend
 */
async function checkSessionAuth() {
    try {
        const response = await fetch('/api/auth/check', {
            credentials: 'same-origin' // Include cookies in the request
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.authenticated === true;
        }
        return false;
    } catch (error) {
        console.error('Session auth check failed:', error);
        return false;
    }
}

/**
 * Check authentication status and redirect if needed
 * This function checks both token auth and session cookie auth
 */
export async function checkAuth() {
    // First, check session cookie auth (for regular login)
    try {
        const sessionResponse = await fetch('/api/auth/check', {
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

    // First, check if user is already logged in via session cookie
    const isSessionAuthenticated = await checkSessionAuth();
    if (isSessionAuthenticated) {
        console.log('User is already authenticated via session cookie');
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
