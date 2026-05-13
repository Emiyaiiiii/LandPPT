/**
 * iframe Session Manager
 * 
 * This script handles session persistence in iframe cross-domain scenarios
 * where cookies may be blocked by browser security policies.
 * 
 * @version 20260513i
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

    function storeToken(token) {
        if (!token) return;
        try {
            sessionStorage.setItem('_iframe_token', token);
        } catch (e) {
            window._iframe_token_fallback = token;
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

    function getStoredToken() {
        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = urlParams.get('token');
        if (urlToken) {
            try {
                sessionStorage.setItem('_iframe_token', urlToken);
            } catch (e) {
                // Ignore storage errors
            }
            return urlToken;
        }

        try {
            const fromStorage = sessionStorage.getItem('_iframe_token');
            if (fromStorage) {
                return fromStorage;
            }
        } catch (e) {
            // Ignore storage errors
        }
        if (window._iframe_token_fallback) {
            return window._iframe_token_fallback;
        }
        return null;
    }

    function appendSessionToUrl(url) {
        // 移除 isInIframe() 检查，让它在所有环境下都工作
        if (url.includes('token=')) {
            return url;
        }

        if (url.includes('_session_id=')) {
            return url;
        }

        // 优先使用 token，如果有 token 就用 token
        const token = getStoredToken();
        if (token) {
            const separator = url.includes('?') ? '&' : '?';
            return `${url}${separator}token=${encodeURIComponent(token)}`;
        }

        // 没有 token 的时候才用 session_id
        const sessionId = getStoredSession();
        if (!sessionId) {
            return url;
        }

        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}_session_id=${encodeURIComponent(sessionId)}`;
    }

    function interceptLinks() {
        // 移除 isInIframe() 检查，让它在所有环境下都工作
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
                e.preventDefault();
                window.location.href = newHref;
            }
        }, true);
    }

    function interceptForms() {
        // 移除 isInIframe() 检查，让它在所有环境下都工作
        document.addEventListener('submit', function(e) {
            const form = e.target;
            const params = getUrlParams();
            
            // 优先用 token
            const token = params.token || getStoredToken();
            if (token) {
                addAuthToForm(form, 'token', token);
                return;
            }
            
            // 没有 token 时才用 session_id
            const sessionId = params.sessionId || getStoredSession();
            if (sessionId) {
                addAuthToForm(form, '_session_id', sessionId);
            }
        }, true);
    }

    function addAuthToForm(form, paramName, paramValue) {
        let actionUrl = form.action;
        if (actionUrl && !actionUrl.includes(`${paramName}=`)) {
            const separator = actionUrl.includes('?') ? '&' : '?';
            form.action = `${actionUrl}${separator}${paramName}=${encodeURIComponent(paramValue)}`;
        }

        let authInput = form.querySelector(`input[name="${paramName}"]`);
        if (!authInput) {
            authInput = document.createElement('input');
            authInput.type = 'hidden';
            authInput.name = paramName;
            form.appendChild(authInput);
        }
        authInput.value = paramValue;
    }

    function interceptFetch() {
        // 移除 isInIframe() 检查，让它在所有环境下都工作
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
            console.log('[Iframe Session] Fetch intercepted:', url);
            let finalUrl = url;

            if (typeof url === 'string') {
                if (url.startsWith('/')) {
                    let authParam = null;
                    let authValue = null;
                    
                    // 优先用 token
                    const token = getStoredToken();
                    if (token && !url.includes('token=')) {
                        authParam = 'token';
                        authValue = token;
                    } else {
                        // 没有 token 时才用 session_id
                        const sessionId = getStoredSession();
                        if (sessionId && !url.includes('_session_id=')) {
                            authParam = '_session_id';
                            authValue = sessionId;
                        }
                    }
                    
                    if (authParam && authValue) {
                        const separator = url.includes('?') ? '&' : '?';
                        finalUrl = `${url}${separator}${authParam}=${encodeURIComponent(authValue)}`;
                        console.log('[Iframe Session] Added auth to URL:', finalUrl);
                    }
                }
            } else if (url instanceof Request) {
                // 处理 Request 对象
                let authParam = null;
                let authValue = null;
                
                // 优先用 token
                const token = getStoredToken();
                if (token) {
                    authParam = 'token';
                    authValue = token;
                } else {
                    // 没有 token 时才用 session_id
                    const sessionId = getStoredSession();
                    if (sessionId) {
                        authParam = '_session_id';
                        authValue = sessionId;
                    }
                }
                
                if (authParam && authValue) {
                    const reqUrl = url.url;
                    if (reqUrl.startsWith(window.location.origin + '/') && !reqUrl.includes(`${authParam}=`)) {
                        const separator = reqUrl.includes('?') ? '&' : '?';
                        const newUrl = `${reqUrl}${separator}${authParam}=${encodeURIComponent(authValue)}`;
                        finalUrl = new Request(newUrl, {
                            method: url.method,
                            headers: url.headers,
                            body: url.body,
                            mode: url.mode,
                            credentials: url.credentials,
                            cache: url.cache,
                            redirect: url.redirect,
                            referrer: url.referrer,
                            integrity: url.integrity,
                            keepalive: url.keepalive,
                            signal: url.signal
                        });
                        console.log('[Iframe Session] Added auth to Request URL:', finalUrl.url);
                    }
                }
            }

            return originalFetch.apply(this, [finalUrl, options]);
        };
        console.log('[Iframe Session] Fetch interception enabled');
    }

    function interceptXHR() {
        // 移除 isInIframe() 检查，让它在所有环境下都工作
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
            if (typeof url === 'string' && url.startsWith('/')) {
                let authParam = null;
                let authValue = null;
                
                // 优先用 token
                const token = getStoredToken();
                if (token && !url.includes('token=')) {
                    authParam = 'token';
                    authValue = token;
                } else {
                    // 没有 token 时才用 session_id
                    const sessionId = getStoredSession();
                    if (sessionId && !url.includes('_session_id=')) {
                        authParam = '_session_id';
                        authValue = sessionId;
                    }
                }
                
                if (authParam && authValue) {
                    const separator = url.includes('?') ? '&' : '?';
                    url = `${url}${separator}${authParam}=${encodeURIComponent(authValue)}`;
                }
            }
            return originalOpen.apply(this, [method, url, async, user, password]);
        };
    }

    function interceptLocation() {
        // 移除 isInIframe() 检查，让它在所有环境下都工作
        try {
            // 保存原始的属性和方法
            const locationProto = window.Location.prototype;
            const hrefDescriptor = Object.getOwnPropertyDescriptor(locationProto, 'href');
            const originalAssign = window.location.assign;
            const originalReplace = window.location.replace;

            // 尝试覆盖 location.href（可能失败但没关系）
            if (hrefDescriptor && hrefDescriptor.configurable && hrefDescriptor.set) {
                Object.defineProperty(locationProto, 'href', {
                    set: function(url) {
                        const newUrl = appendSessionToUrl(url);
                        hrefDescriptor.set.call(this, newUrl);
                    }
                });
            }

            // 覆盖 location.assign（总是可以覆盖）
            window.location.assign = function(url) {
                const newUrl = appendSessionToUrl(url);
                originalAssign.call(this, newUrl);
            };

            // 覆盖 location.replace（总是可以覆盖）
            window.location.replace = function(url) {
                const newUrl = appendSessionToUrl(url);
                originalReplace.call(this, newUrl);
            };

            console.log('[Iframe Session] location interception enabled');
        } catch (e) {
            console.warn('[Iframe Session] Could not intercept location.href:', e);
            // 即使 href 无法拦截，assign 和 replace 应该还是可以工作的
        }
    }

    function interceptEventSource() {
        // 移除 isInIframe() 检查，让它在所有环境下都工作
        const OriginalEventSource = window.EventSource;
        window.EventSource = function(url, options) {
            console.log('[Iframe Session] EventSource intercepted:', url);
            let finalUrl = url;

            if (typeof url === 'string' && (url.startsWith('/') || url.startsWith(window.location.origin + '/'))) {
                let authParam = null;
                let authValue = null;
                
                // 优先用 token
                const token = getStoredToken();
                if (token && !url.includes('token=')) {
                    authParam = 'token';
                    authValue = token;
                } else {
                    // 没有 token 时才用 session_id
                    const sessionId = getStoredSession();
                    if (sessionId && !url.includes('_session_id=')) {
                        authParam = '_session_id';
                        authValue = sessionId;
                    }
                }
                
                if (authParam && authValue) {
                    const separator = url.includes('?') ? '&' : '?';
                    finalUrl = `${url}${separator}${authParam}=${encodeURIComponent(authValue)}`;
                    console.log('[Iframe Session] Added auth to EventSource URL:', finalUrl);
                }
            }

            return new OriginalEventSource(finalUrl, options);
        };

        // 复制静态属性
        Object.assign(window.EventSource, OriginalEventSource);
        console.log('[Iframe Session] EventSource interception enabled');
    }

    function init() {
        const inIframe = isInIframe();
        const params = getUrlParams();

        console.log('[Iframe Session] Initializing...');
        console.log('[Iframe Session] In iframe:', inIframe);
        console.log('[Iframe Session] URL params:', params);

        if (params.token) {
            storeToken(params.token);
            console.log('[Iframe Session] Token stored:', params.token);
        }

        if (params.sessionId) {
            storeSession(params.sessionId);
            console.log('[Iframe Session] Session stored:', params.sessionId);
        }

        // 移除 isInIframe() 检查，让它在所有环境下都工作
        interceptLinks();
        interceptForms();
        interceptFetch();
        interceptXHR();
        interceptLocation();
        interceptEventSource();
    }

    // 立即初始化，不要等待 DOMContentLoaded，确保在其他脚本执行前设置好拦截器
    init();
})();
