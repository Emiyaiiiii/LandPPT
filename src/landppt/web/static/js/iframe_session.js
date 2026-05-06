/**
 * iframe Session Manager
 * 
 * This script handles session persistence in iframe cross-domain scenarios
 * where cookies may be blocked by browser security policies.
 */

(function() {
    'use strict';

    function isInIframe() {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    }

    function getUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            sessionId: params.get('_session_id'),
            token: params.get('token')
        };
    }

    function storeSession(sessionId) {
        if (!sessionId) return;
        try {
            sessionStorage.setItem('_iframe_session_id', sessionId);
        } catch (e) {
            window._iframe_session_id_fallback = sessionId;
        }
    }

    function getStoredSession() {
        const urlParams = new URLSearchParams(window.location.search);
        const urlSessionId = urlParams.get('_session_id');
        if (urlSessionId) {
            try {
                sessionStorage.setItem('_iframe_session_id', urlSessionId);
            } catch (e) {
                // Ignore storage errors
            }
            return urlSessionId;
        }

        try {
            const fromStorage = sessionStorage.getItem('_iframe_session_id');
            if (fromStorage) {
                return fromStorage;
            }
        } catch (e) {
            // Ignore storage errors
        }
        if (window._iframe_session_id_fallback) {
            return window._iframe_session_id_fallback;
        }
        return null;
    }

    function appendSessionToUrl(url) {
        if (!isInIframe()) {
            return url;
        }

        if (url.includes('_session_id=')) {
            return url;
        }

        const sessionId = getStoredSession();
        if (!sessionId) {
            return url;
        }

        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}_session_id=${encodeURIComponent(sessionId)}`;
    }

    function interceptLinks() {
        if (!isInIframe()) {
            return;
        }

        document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (!link) return;

            const href = link.getAttribute('href');

            if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
                return;
            }

            if (href.startsWith('http') && !href.startsWith(window.location.origin)) {
                return;
            }

            const newHref = appendSessionToUrl(href);
            if (newHref !== href) {
                link.setAttribute('href', newHref);
            }
        }, true);
    }

    function interceptForms() {
        if (!isInIframe()) {
            return;
        }

        document.addEventListener('submit', function(e) {
            const form = e.target;
            const params = getUrlParams();
            const sessionId = params.sessionId;

            if (!sessionId) {
                return;
            }

            addSessionToForm(form, sessionId);
        }, true);
    }

    function addSessionToForm(form, sessionId) {
        let actionUrl = form.action;
        if (actionUrl && !actionUrl.includes('_session_id=')) {
            const separator = actionUrl.includes('?') ? '&' : '?';
            form.action = `${actionUrl}${separator}_session_id=${encodeURIComponent(sessionId)}`;
        }

        let sessionInput = form.querySelector('input[name="_session_id"]');
        if (!sessionInput) {
            sessionInput = document.createElement('input');
            sessionInput.type = 'hidden';
            sessionInput.name = '_session_id';
            form.appendChild(sessionInput);
        }
        sessionInput.value = sessionId;
    }

    function interceptFetch() {
        if (!isInIframe()) {
            return;
        }

        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
            if (typeof url === 'string' && url.startsWith('/')) {
                const params = getUrlParams();
                const sessionId = params.sessionId;
                if (sessionId && !url.includes('_session_id=')) {
                    const separator = url.includes('?') ? '&' : '?';
                    url = `${url}${separator}_session_id=${encodeURIComponent(sessionId)}`;
                }
            }
            return originalFetch.apply(this, [url, options]);
        };
    }

    function interceptXHR() {
        if (!isInIframe()) {
            return;
        }

        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
            if (typeof url === 'string' && url.startsWith('/')) {
                const params = getUrlParams();
                const sessionId = params.sessionId;
                if (sessionId && !url.includes('_session_id=')) {
                    const separator = url.includes('?') ? '&' : '?';
                    url = `${url}${separator}_session_id=${encodeURIComponent(sessionId)}`;
                }
            }
            return originalOpen.apply(this, [method, url, async, user, password]);
        };
    }

    function init() {
        const inIframe = isInIframe();
        const params = getUrlParams();

        if (params.sessionId) {
            storeSession(params.sessionId);
        }

        if (inIframe) {
            interceptLinks();
            interceptForms();
            interceptFetch();
            interceptXHR();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
