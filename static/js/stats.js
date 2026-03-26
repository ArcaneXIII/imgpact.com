(function () {
  'use strict';

  // ── Session ID ────────────────────────────────────────────────────────────
  function getSessionId() {
    var KEY = 'imgpact-sid';
    var id = localStorage.getItem(KEY);
    if (!id) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = crypto.randomUUID();
      } else {
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
      }
      try { localStorage.setItem(KEY, id); } catch (e) {}
    }
    return id;
  }

  // ── Track a tool use ──────────────────────────────────────────────────────
  window.trackToolUse = function (toolSlug) {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolSlug, session_id: getSessionId() }),
    }).catch(function () {});
  };

  // ── Homepage hero stats ───────────────────────────────────────────────────
  var heroStats = document.getElementById('hero-stats');
  if (heroStats) {
    fetch('/api/stats')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        var usesEl  = document.getElementById('hero-stat-uses');
        var usersEl = document.getElementById('hero-stat-users');
        if (usesEl)  usesEl.textContent  = data.total_uses.toLocaleString();
        if (usersEl) usersEl.textContent = data.total_unique_users.toLocaleString();
        heroStats.removeAttribute('hidden');
      })
      .catch(function () {});
  }
})();
