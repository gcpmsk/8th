/* =====================================================================
   SATYAM GOLD — Postgres Sync Layer
   ---------------------------------------------------------------------
   काम: जो कुछ भी localStorage में save होता है (सारी sg_* keys),
        बिलकुल वैसा ही PostgreSQL database में भी save हो जाए.

   कैसे:
     1) page खुलते ही server से पूरा data खींच कर localStorage में डाल देता है
        (blocking, ताकि app.js / inline script पढ़ने से पहले data मौजूद हो)
     2) localStorage.setItem / removeItem / clear को wrap करता है —
        हर बदलाव queue में जाता है और /api/sync पर POST हो जाता है
     3) net बंद हो तो queue localStorage में पड़ी रहती है, net आते ही चली जाती है
     4) हर 20 सेकंड में server से नया data pull करता है (दूसरे device का बदलाव)

   ⚠️ इस file को हर page में app के अपने script से *पहले* load करना है.
   ===================================================================== */
(function () {
  'use strict';

  if (window.__sgSyncLoaded) return;
  window.__sgSyncLoaded = true;

  var API        = '/api/sync';
  var PREFIX     = 'sg_';              // सिर्फ़ यही keys sync होंगी
  var META_KEY   = '__sg_sync_meta';   // { key: updated_at }
  var QUEUE_KEY  = '__sg_sync_queue';  // { key: {value, updated_at} }
  var CURSOR_KEY = '__sg_sync_cursor'; // last server updated_at
  var SEED_KEY   = '__sg_sync_seeded';
  var PULL_MS    = 5000;               // हर 5 सेकंड — दूसरे mobile का data लगभग realtime
  var PUSH_MS    = 800;
  var lastError  = '';                 // आख़िरी server error (dot पर click करके देखें)

  /* ---------- raw localStorage (बिना wrap के) ---------- */
  var LS  = window.localStorage;
  var rawGet    = LS.getItem.bind(LS);
  var rawSet    = LS.setItem.bind(LS);
  var rawRemove = LS.removeItem.bind(LS);
  var rawKey    = LS.key.bind(LS);
  var rawClear  = LS.clear.bind(LS);

  function isSyncKey(k) { return typeof k === 'string' && k.indexOf(PREFIX) === 0; }
  function now() { return Date.now(); }

  function jget(k, d) { try { var v = rawGet(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function jset(k, v) { try { rawSet(k, JSON.stringify(v)); } catch (e) {} }

  var meta  = jget(META_KEY, {})  || {};
  var queue = jget(QUEUE_KEY, {}) || {};

  function saveMeta()  { jset(META_KEY, meta); }
  function saveQueue() { jset(QUEUE_KEY, queue); }

  /* ---------- status dot (छोटा सा, print में नहीं दिखता) ----------
     dot पर tap/click करें → पूरा message + आख़िरी error दिखेगा ---------- */
  var dot = null, lastState = 'busy', lastTitle = '';
  function setStatus(state, title) {
    lastState = state; lastTitle = title || state;
    try {
      if (!dot) {
        if (!document.body) return;
        dot = document.createElement('div');
        dot.id = 'sg-sync-dot';
        dot.style.cssText =
          'position:fixed;left:6px;bottom:6px;width:14px;height:14px;border-radius:50%;' +
          'z-index:99999;opacity:.7;cursor:pointer;transition:background .3s;';
        dot.addEventListener('click', function () {
          var msg = 'Sync status: ' + lastState + '\n' + lastTitle;
          if (lastError) msg += '\n\nServer error:\n' + lastError;
          msg += '\n\nPending (भेजना बाक़ी): ' + Object.keys(queue).length + ' items';
          alert(msg);
        });
        document.body.appendChild(dot);
        var st = document.createElement('style');
        st.textContent = '@media print{#sg-sync-dot{display:none!important}}';
        document.head.appendChild(st);
      }
      dot.style.background = state === 'ok'   ? '#2ecc71'
                           : state === 'busy' ? '#f1c40f'
                           : state === 'off'  ? '#95a5a6'
                           : '#e74c3c';
      dot.title = title || state;
    } catch (e) {}
  }
  window.__sgSetStatus = setStatus;

  /* =====================================================================
     1) BOOT PULL — page load पर server से data (synchronous)
     ===================================================================== */
  function applyRows(rows) {
    var changed = 0, maxTs = parseInt(jget(CURSOR_KEY, 0), 10) || 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!isSyncKey(r.key)) continue;
      var ts = parseInt(r.updated_at, 10) || 0;
      if (ts > maxTs) maxTs = ts;

      var localTs = parseInt(meta[r.key], 10) || 0;
      var pending = Object.prototype.hasOwnProperty.call(queue, r.key);
      if (pending || ts <= localTs) continue;   // local नया है या भेजना बाक़ी है → छोड़ दो

      if (r.value === null || r.value === undefined) {
        rawRemove(r.key);
        delete meta[r.key];
      } else {
        try { rawSet(r.key, JSON.stringify(r.value)); } catch (e) { continue; }
        meta[r.key] = ts;
      }
      changed++;
    }
    if (changed) saveMeta();
    jset(CURSOR_KEY, maxTs);
    return changed;
  }

  function bootPull() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', API + '?full=1', false);          // false = synchronous
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        var d = JSON.parse(xhr.responseText);
        if (d && d.ok && Array.isArray(d.rows)) {
          applyRows(d.rows);
          setStatus('ok', 'Database से जुड़ा है');
          return true;
        }
        lastError = (d && d.error) ? String(d.error) : ('bad response: ' + String(xhr.responseText).slice(0, 300));
      } else {
        lastError = 'HTTP ' + xhr.status + ' — ' + String(xhr.responseText).slice(0, 300);
      }
    } catch (e) { lastError = String(e && e.message || e); }
    setStatus('off', 'Database से नहीं जुड़ा — data सिर्फ़ इसी device में है');
    return false;
  }

  /* =====================================================================
     2) localStorage wrap — हर बदलाव queue में
     ===================================================================== */
  function enqueue(key, valueStr) {
    var ts = now();
    meta[key] = ts;
    var val = null;
    if (valueStr !== null) {
      try { val = JSON.parse(valueStr); }
      catch (e) { val = valueStr; }            // JSON न हो तो plain string
    }
    queue[key] = { value: val, updated_at: ts };
    saveMeta(); saveQueue();
    schedulePush();
  }

  LS.setItem = function (k, v) {
    var s = String(v);
    rawSet(k, s);
    if (isSyncKey(k)) enqueue(k, s);
  };
  LS.removeItem = function (k) {
    rawRemove(k);
    if (isSyncKey(k)) enqueue(k, null);
  };
  LS.clear = function () {
    var keys = [];
    for (var i = 0; i < LS.length; i++) { var k = rawKey(i); if (isSyncKey(k)) keys.push(k); }
    rawClear();
    keys.forEach(function (k) { enqueue(k, null); });
  };

  /* =====================================================================
     3) PUSH — queue → server
     ===================================================================== */
  var pushTimer = null, pushing = false;
  function schedulePush() {
    if (pushTimer) return;
    pushTimer = setTimeout(function () { pushTimer = null; pushNow(); }, PUSH_MS);
  }

  function pushNow() {
    if (pushing) { schedulePush(); return; }
    var keys = Object.keys(queue);
    if (!keys.length) return;
    pushing = true;
    setStatus('busy', 'Save हो रहा है…');

    var batch = keys.slice(0, 200);
    var sentTs = {};
    var items = batch.map(function (k) {
      sentTs[k] = queue[k].updated_at;
      return { key: k, value: queue[k].value, updated_at: queue[k].updated_at };
    });

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items })
    })
      .then(function (r) {
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + ' — ' + String(t).slice(0, 300));
        });
      })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || 'save failed');
        batch.forEach(function (k) {
          // भेजने के बाद अगर वही key फिर बदल गयी तो queue में रहने दो
          if (queue[k] && queue[k].updated_at === sentTs[k]) delete queue[k];
        });
        saveQueue();
        pushing = false;
        setStatus('ok', 'Database में save ✔');
        if (Object.keys(queue).length) schedulePush();
      })
      .catch(function (err) {
        pushing = false;
        lastError = String(err && err.message || err);
        setStatus('err', 'Save नहीं हुआ: ' + lastError);
        setTimeout(schedulePush, 5000);
      });
  }

  /* पहली बार — पहले से पड़ा सारा local data database में भेज दो */
  function seedOnce() {
    if (rawGet(SEED_KEY) === '1') return;
    var n = 0;
    for (var i = 0; i < LS.length; i++) {
      var k = rawKey(i);
      if (!isSyncKey(k)) continue;
      if (Object.prototype.hasOwnProperty.call(queue, k)) continue;
      var raw = rawGet(k);
      var val; try { val = JSON.parse(raw); } catch (e) { val = raw; }
      var ts = parseInt(meta[k], 10) || now();
      meta[k] = ts;
      queue[k] = { value: val, updated_at: ts };
      n++;
    }
    if (n) { saveMeta(); saveQueue(); schedulePush(); }
    rawSet(SEED_KEY, '1');
  }

  /* =====================================================================
     4) PERIODIC PULL — दूसरे device का बदलाव
     ===================================================================== */
  function pullDelta() {
    if (document.hidden) return;
    var since = parseInt(jget(CURSOR_KEY, 0), 10) || 0;
    fetch(API + '?since=' + since, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + ' — ' + String(t).slice(0, 300));
        });
      })
      .then(function (d) {
        if (!d || !d.ok || !Array.isArray(d.rows)) {
          lastError = (d && d.error) ? String(d.error) : 'bad response';
          setStatus('err', 'Database error: ' + lastError);
          return;
        }
        var c = applyRows(d.rows);
        setStatus('ok', 'Database से जुड़ा है');
        if (c) refreshUI();
      })
      .catch(function (err) {
        lastError = String(err && err.message || err);
        setStatus('off', 'Database से नहीं जुड़ा: ' + lastError);
      });
  }

  function refreshUI() {
    try { if (typeof window.sgSyncOnRemote === 'function') { window.sgSyncOnRemote(); return; } } catch (e) {}
    try { if (typeof window.renderAll === 'function') window.renderAll(); } catch (e) {}
    try { if (typeof window.tvRefresh === 'function') window.tvRefresh(); } catch (e) {}
  }

  /* =====================================================================
     चालू करो
     ===================================================================== */
  bootPull();
  seedOnce();

  // body अभी न बना हो तो dot बाद में लगाओ
  if (!dot) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setStatus(lastState, lastTitle); });
    } else { setStatus(lastState, lastTitle); }
  }

  setInterval(pullDelta, PULL_MS);
  window.addEventListener('online',  function () { schedulePush(); pullDelta(); });
  window.addEventListener('focus',   function () { pullDelta(); });
  window.addEventListener('beforeunload', function () {
    var keys = Object.keys(queue);
    if (!keys.length || !navigator.sendBeacon) return;
    var items = keys.slice(0, 200).map(function (k) {
      return { key: k, value: queue[k].value, updated_at: queue[k].updated_at };
    });
    try {
      navigator.sendBeacon(API, new Blob([JSON.stringify({ items: items })], { type: 'application/json' }));
    } catch (e) {}
  });

  /* debug helper — console में sgSync.status() */
  window.sgSync = {
    push: pushNow,
    pull: pullDelta,
    status: function () { return { state: lastState, error: lastError, pending: Object.keys(queue).length, cursor: jget(CURSOR_KEY, 0) }; },
    resetSeed: function () { rawRemove(SEED_KEY); rawSet(SEED_KEY, ''); rawRemove(SEED_KEY); seedOnce(); }
  };
})();
