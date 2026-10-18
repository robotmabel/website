/* One client for the store API, shared by order.html and account.html.
   The session is a bearer token in localStorage: the page lives on github.io
   and the API on duckdns.org, so a cookie would be third-party and Safari drops
   it. `?api=` overrides the base for local runs and is remembered. */
(function (root) {
  'use strict';
  var DEFAULT_API = 'https://order.mabelrobot.duckdns.org';
  var SESSION_KEY = 'mabel.session', API_KEY = 'mabel.order.api';
  var api = (function () {
    try {
      var q = new URLSearchParams(location.search).get('api');
      if (q) localStorage.setItem(API_KEY, q);
      return localStorage.getItem(API_KEY) || DEFAULT_API;
    } catch (e) { return DEFAULT_API; }
  })();
  function token() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) {
    try { if (t) localStorage.setItem(SESSION_KEY, t); else localStorage.removeItem(SESSION_KEY); } catch (e) {}
    document.dispatchEvent(new CustomEvent('order:auth'));
  }
  function req(method, path, body) {
    if (!api) return Promise.reject(new Error('no api'));
    var h = { 'Content-Type': 'application/json' }, t = token();
    if (t) h.Authorization = 'Bearer ' + t;
    return fetch(api + path, { method: method, credentials: 'include', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.detail || j.error || ('HTTP ' + r.status)); return j; }); });
  }
  var store = {
    get api() { return api; }, set api(v) { api = v; },
    token: token, setToken: setToken, req: req,
    health: function () { return req('GET', '/api/health'); },
    whoami: function () { if (!token()) return Promise.resolve({ user: null }); return req('GET', '/api/auth/me').then(function (j) { if (!j.user) setToken(''); return j; }); },
    register: function (ident, password) { return req('POST', '/api/auth/register', { ident: ident, password: password }).then(keep); },
    login: function (ident, password) { return req('POST', '/api/auth/login', { ident: ident, password: password }).then(keep); },
    sendCode: function (ident) { return req('POST', '/api/auth/code', { ident: ident }); },
    verify: function (ident, code) { return req('POST', '/api/auth/verify', { ident: ident, code: code }).then(keep); },
    setPassword: function (password) { return req('POST', '/api/auth/password', { password: password }); },
    logout: function () { return req('POST', '/api/auth/logout').catch(function () {}).then(function () { setToken(''); }); },
    registerRobot: function (serial, name, source) { return req('POST', '/api/robots/register', { serial: serial, name: name || null, source: source || 'kit' }); },
    unregisterRobot: function (serial) { return req('DELETE', '/api/robots/' + encodeURIComponent(serial)); },
    validIdent: function (s) { s = (s || '').trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s) || /^\+?[\d\s\-().]{8,20}$/.test(s); },
    usd: function (n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  };
  function keep(j) { if (j && j.token) setToken(j.token); return j; }
  root.MabelStore = store;
})(window);
