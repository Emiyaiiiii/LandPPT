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
 * Check authentication status and redirect if needed
 */
export async function checkAuth() {
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
 */
export async function initAuth() {
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
            }
        } catch (error) {
            console.error('Auth initialization failed:', error);
            removeToken();
            // Redirect to login page
            window.location.href = '/auth/login';
        }
    } else {
        // No token, redirect to login page
        window.location.href = '/auth/login';
    }
}

// Initialize auth when the script is loaded
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initAuth);
}
