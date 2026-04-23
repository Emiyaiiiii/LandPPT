/**
 * iframe Session Manager
 * 
 * This script handles session persistence in iframe cross-domain scenarios
 * where cookies may be blocked by browser security policies.
 */

(function() {
    'use strict';

    // Check if we're in an iframe
    function isInIframe() {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    }

    // Get URL parameters
    function getUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            sessionId: params.get('_session_id'),
            token: params.get('token')
        };
    }

    // Store session info
    function storeSession(sessionId) {
        if (sessionId) {
            sessionStorage.setItem('_iframe_session_id', sessionId);
            console.log('[iframeSession] Stored session_id:', sessionId);
        }
    }

    // Get stored session
    function getStoredSession() {
        return sessionStorage.getItem('_iframe_session_id');
    }

    // Append session_id to URL if in iframe
    function appendSessionToUrl(url) {
        if (!isInIframe()) return url;
        
        const sessionId = getStoredSession();
        if (!sessionId) return url;

        // Don't append if already has _session_id
        if (url.includes('_session_id=')) return url;

        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}_session_id=${encodeURIComponent(sessionId)}`;
    }

    // Intercept all link clicks
    function interceptLinks() {
        if (!isInIframe()) return;

        document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (!link) return;

            const href = link.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
            
            // Only handle same-origin links
            if (href.startsWith('http') && !href.startsWith(window.location.origin)) return;

            // Append session_id and update href
            const newHref = appendSessionToUrl(href);
            if (newHref !== href) {
                link.setAttribute('href', newHref);
                console.log('[iframeSession] Modified link:', href, '->', newHref);
            }
        }, true);
    }

    // Intercept form submissions
    function interceptForms() {
        if (!isInIframe()) return;

        document.addEventListener('submit', function(e) {
            const form = e.target;
            const sessionId = getStoredSession();
            
            if (!sessionId) return;

            // Check if form already has _session_id input
            let sessionInput = form.querySelector('input[name="_session_id"]');
            if (!sessionInput) {
                sessionInput = document.createElement('input');
                sessionInput.type = 'hidden';
                sessionInput.name = '_session_id';
                form.appendChild(sessionInput);
            }
            sessionInput.value = sessionId;
            console.log('[iframeSession] Added session_id to form');
        }, true);
    }

    // Main initialization
    function init() {
        console.log('[iframeSession] Initializing, inIframe:', isInIframe());

        // Store session from URL if present
        const params = getUrlParams();
        if (params.sessionId) {
            storeSession(params.sessionId);
            
            // Note: We don't clean URL here because:
            // 1. auth.js also needs to read _session_id from URL
            // 2. Page refresh would lose the session if we clean it
            // The URL parameter is harmless and helps with debugging
        }

        // Set up interceptors if in iframe
        if (isInIframe()) {
            interceptLinks();
            interceptForms();
            console.log('[iframeSession] Interceptors enabled');
        }
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
