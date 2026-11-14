/* VVVion Space app bridge — injected by the Android app on every page load (idempotent).
 * 1) CSS: no tap highlight / no focus box on mouse/touch.
 * 2) window.VvvionApp: API for the web app (notify, push token, permissions).
 * 3) Media: finds audio playback on its own (HTMLMediaElement hooks + navigator.mediaSession + player DOM),
 *    reports it to the native foreground service and executes notification buttons.
 */
(function () {
  'use strict';
  var H = document.documentElement;
  var DECOR = '.orb{display:none!important}'
    + '.chat-paper{animation:none!important}'
    + '.circle-glow,.mark-ring-2,.mark-core,.mark-dot,.mic-live,.player-wash,.player-cover{animation:none!important}';
  var APP_CSS = '*,*::before,*::after{-webkit-tap-highlight-color:rgba(0,0,0,0)!important}'
    + ':focus:not(:focus-visible){outline:none!important}'
    /* 3.0.0-beta3: a touch app has no keyboard focus ring; the site's light accent :focus-visible ring showed as a light square around round buttons (play/pause) after programmatic focus */
    + 'html.vv-app button:focus-visible,html.vv-app a:focus-visible,html.vv-app [role=button]:focus-visible,html.vv-app [role=tab]:focus-visible,html.vv-app summary:focus-visible{outline:none!important}'
    + 'html,body{overscroll-behavior:none}'
    + 'button,a,[role=button]{-webkit-user-select:none;user-select:none}'
    /* no 300 ms / double-tap-zoom heuristics on anything tappable: a tap is a tap, a drag is a scroll */
    + 'a,button,[role=button],[role=tab],[role=menuitem],[role=switch],summary,label,input,select,textarea{touch-action:manipulation}'
    /* low-end devices / "remove animations": switch off decorative infinite animations that keep the main thread busy 24/7 */
    + DECOR.replace(/(^|\})([^{]+)\{/g, function (m, p, sel) { return p + sel.split(',').map(function (x) { return 'html.vv-lowend ' + x + ',html.vv-reduce-motion ' + x; }).join(',') + '{'; })
    + 'html.vv-lowend *,html.vv-lowend *::before,html.vv-lowend *::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
  function css() {
    try {
      H = H || document.documentElement; if (!H) return;
      H.classList.add('vv-app');
      if (document.getElementById('vv-app-css')) return;
      var host = document.head || H; if (!host) return;
      var s = document.createElement('style'); s.id = 'vv-app-css'; s.textContent = APP_CSS; host.appendChild(s);
    } catch (e) {}
  }
  css();
  if (window.__vvInit || !H) { return; }   // <html> not created yet: a later injection (page finished) does the full init
  var N = window.VvvionNative;
  if (!N) { return; }
  window.__vvInit = true;
  var PERF = {};
  var TAB = false;   /* 2.9.2: tablet flag (native: shorter display side >= 600 dp) */
  function isTab() { try { TAB = !!N.isTablet(); } catch (e) { TAB = false; } return TAB; }   /* cheap; not cached: a foldable can become a tablet when unfolded */
  try { PERF = JSON.parse(N.perf() || '{}'); } catch (e) {}
  var LK = 'vv.lowend';
  function storedLow() { try { var t = +localStorage.getItem(LK) || 0; return !!t && Date.now() - t < 7 * 864e5; } catch (e) { return false; } }
  function applyCls() {
    try {
      if (!H.classList.contains('vv-app')) H.classList.add('vv-app');
      if ((PERF.lowEnd || storedLow()) && !H.classList.contains('vv-lowend')) H.classList.add('vv-lowend');
      if (PERF.reduceMotion && !H.classList.contains('vv-reduce-motion')) H.classList.add('vv-reduce-motion');
      H.classList.toggle('vv-tablet', isTab());
    } catch (e) {}
  }
  applyCls();
  /* Observers: ONE throttled callback (<= 4/s), only attribute 'class' on <html> and direct children of <head>/<html> (no subtree). */
  var pend = 0;
  function later() { if (pend) return; pend = setTimeout(function () { pend = 0; css(); applyCls(); }, 250); }
  try {
    var mo = new MutationObserver(later);
    mo.observe(H, { childList: true, attributes: true, attributeFilter: ['class'] });
    if (document.head) mo.observe(document.head, { childList: true });
  } catch (e) {}
  /* Runtime FPS probe: on the first touch after the page settled (>6 s), look at 2.5 s of frames. > 20 % of frames slower than 45 ms
     => this phone cannot afford the decorative effects: add html.vv-lowend and remember it for a week. One passive listener, removed afterwards. */
  (function () {
    if (H.classList.contains('vv-lowend')) return;
    function probe() {
      if (performance.now() < 6000 || document.hidden) return;
      document.removeEventListener('touchstart', probe, true);
      var n = 0, bad = 0, last = 0, t0 = 0;
      (function f(t) {
        if (!last) { last = t0 = t; } else { n++; if (t - last > 45) bad++; last = t; }
        if (t - t0 < 2500) requestAnimationFrame(f);
        else if (n > 20 && bad / n > 0.2) { try { localStorage.setItem(LK, String(Date.now())); } catch (e) {} H.classList.add('vv-lowend'); }
      })(performance.now());
    }
    document.addEventListener('touchstart', probe, { passive: true, capture: true });
  })();

  var VERSION = '3.0.2';
  function safe(f) { try { return f(); } catch (e) { return undefined; } }

  /* ---------- window.VvvionApp ---------- */
  var App = {
    isApp: true,
    version: VERSION,
    /** notify({id, channel:'messages'|'ai'|'subs'|'player', title, body, url, onlyWhenBackground=true}) -> boolean shown */
    notify: function (o) { return !!safe(function () { return N.notify(JSON.stringify(o || {})); }); },
    cancelNotification: function (id) { safe(function () { N.cancelNotification(String(id)); }); },
    /** Asks the Android 13+ permission (no-op below 13 / already granted). Result: event 'vvvion-app-notifications'. */
    requestNotificationPermission: function () { safe(function () { N.requestNotificationPermission(); }); },
    notificationsEnabled: function () { return !!safe(function () { return N.notificationsEnabled(); }); },
    openNotificationSettings: function () { safe(function () { N.openNotificationSettings(); }); },
    /** FCM token or '' (empty when the build has no Firebase or the token is not ready yet). Event: 'vvvion-app-push-token'. */
    getPushToken: function () { return safe(function () { return N.pushToken(); }) || ''; },
    pushAvailable: function () { return !!safe(function () { return N.pushAvailable(); }); },
    /** haptic('light'|'medium'|'heavy'|'success'|'warning'|'error'|'selection') */
    haptic: function (t) { safe(function () { N.haptic(String(t || 'light')); }); },
    /** Device hints: {lowEnd, reduceMotion, hz, ramMb, cores, sdk, lowEndActive} -- lowEndActive reflects html.vv-lowend (native hint or runtime FPS probe). */
    perf: function () { var o = {}; for (var k in PERF) o[k] = PERF[k]; o.lowEndActive = H.classList.contains('vv-lowend'); return o; },
    /** Force the low-end profile on/off for this device (persisted ~7 days). */
    setLowEnd: function (on) { try { if (on) localStorage.setItem(LK, String(Date.now())); else localStorage.removeItem(LK); } catch (e) {} H.classList.toggle('vv-lowend', !!on); },
    /** The app ships its own native pull-to-refresh; call pullToRefresh(false) if the site's own PTR should be the only one. */
    pullToRefresh: function (on) { safe(function () { N.pullToRefresh(!!on); }); },
    /** 2.9.0: share({title?, text?, url?}) -> system share sheet (text/plain); returns false if nothing to share. */
    share: function (o) { o = o || {}; if (!o.text && !o.url) return false; return !!safe(function () { return N.share(JSON.stringify({ title: o.title || '', text: o.text || '', url: o.url || '' })); }); },
    /** Copies plain text through the Android clipboard (works without a user-gesture check). */
    copy: function (t) { safe(function () { N.copy(String(t == null ? '' : t)); }); },
    /** Unread counter on the launcher icon (via a silent notification; 0 clears). Returns false if notifications are not allowed. */
    badge: function (n) { return !!safe(function () { return N.badge(Math.max(0, Math.min(999, n | 0))); }); },
    /** Last 50 console.error entries: [{t, msg, src, line}] */
    debugLog: function () { return safe(function () { return JSON.parse(N.debugLog() || '[]'); }) || []; },
    webViewVersion: function () { return safe(function () { return N.webViewVersion(); }) || ''; },
    /** {version, versionCode, sdk, device, webView, webViewMajor, webViewPackage} */
    info: function () { return safe(function () { return JSON.parse(N.info() || '{}'); }) || {}; },
    /** 2.9.2: true on tablets (shorter display side >= 600 dp); also html.vv-tablet and the user agent token "VvvionTablet". */
    isTablet: function () { return isTab(); },
    /** 2.9.2: {tablet, smallestWidthDp, widthDp, heightDp, landscape}. Changes (rotation, split-screen, fold): event 'vvvion-app-screen'. */
    screen: function () { return safe(function () { return JSON.parse(N.screen() || '{}'); }) || {}; },
    /** Current keyboard state {height (css px), visible}. Changes: event 'vvvion-app-keyboard', CSS var --vv-kb, class html.vv-kb-open. */
    keyboard: function () { return safe(function () { return JSON.parse(N.keyboard() || '{}'); }) || { height: 0, visible: false }; },
    /** Feature detection for the site: VvvionApp.has('share'). */
    features: ['notify', 'push', 'haptic', 'perf', 'downloads', 'media', 'back', 'theme', 'keyboard', 'share', 'copy', 'badge', 'debugLog', 'webViewVersion', 'info',
      'backFallback', 'fileChooser', 'capture', 'deepLinks', 'fullscreenVideo', 'pullToRefresh', 'tablet', 'screen', 'nativePlayer', 'openExternal', 'bundledStatic', 'widgets'],
    has: function (f) { return App.features.indexOf(f) >= 0; }
  };
  window.VvvionApp = App;

  /* ---------- 3.0.0: native player (Media3 foreground service) + external links ---------- */
  /* The page keeps its own <audio> player as the fallback: every method below returns false / does nothing when it cannot work.
     Feature detection: VvvionApp.has('nativePlayer').  State pushes: window event 'vvvion-app-player', detail = {event, ...getState()}
     event: 'queue' | 'track' | 'play' | 'pause' | 'buffering' | 'ready' | 'seek' | 'progress' (1 s, foreground only) | 'ended' | 'error' | 'stop' | 'sync' | 'state' */
  function plPausePage() {
    safe(function () {
      var all = Array.prototype.slice.call(document.querySelectorAll('audio'));
      var pool = window.Howler && window.Howler._html5AudioPool; if (pool && pool.length) all = all.concat(Array.prototype.slice.call(pool));
      all.forEach(function (a) { try { if (isMusic(a) && !a.paused) a.pause(); } catch (e) {} });
    });
  }
  function plJson(o) { try { return JSON.stringify(o); } catch (e) { return ''; } }
  function plCall(name, arg) { return safe(function () { return N[name](arg); }); }
  /** playTrack({url, title?, artist?, album?, artwork?, id?, positionMs?, autoplay?, repeat?, shuffle?}) -> boolean (false: not playable natively, keep using <audio>). url: https URL or a site path like /api/disk/<id>. */
  App.playTrack = function (o) {
    if (!o || typeof o !== 'object') return false;
    var j = plJson(o); if (!j) return false;
    var ok = !!plCall('plTrack', j);
    if (ok) plPausePage();
    return ok;
  };
  /** setQueue([{url, title, artist, album, artwork, id}], startIndex = 0, {positionMs?, autoplay?, repeat?, shuffle?}) -> boolean */
  App.setQueue = function (items, startIndex, opts) {
    if (!Array.isArray(items) || !items.length) return false;
    var o = {}; if (opts) for (var k in opts) o[k] = opts[k];
    o.items = items; o.startIndex = startIndex | 0;
    var j = plJson(o); if (!j) return false;
    var ok = !!plCall('plQueue', j);
    if (ok) plPausePage();
    return ok;
  };
  /** 3.0.0-beta3: setWidgetCity('Алматы') -> city of the home-screen weather widget (same name the site uses for wttr.in). */
  App.setWidgetCity = function (c) { if (typeof c === 'string') safe(function () { N.setWidgetCity(c); }); };
  App.play = function () { safe(function () { N.plPlay(); }); };
  App.pause = function () { safe(function () { N.plPause(); }); };
  App.next = function () { safe(function () { N.plNext(); }); };
  App.prev = function () { safe(function () { N.plPrev(); }); };
  App.seek = function (ms) { ms = +ms; if (isFinite(ms) && ms >= 0) safe(function () { N.plSeek(ms); }); };
  App.stop = function () { safe(function () { N.plStop(); }); };
  App.setRepeat = function (m) { safe(function () { N.plRepeat(m === 'one' || m === 'all' ? m : 'off'); }); };
  App.setShuffle = function (on) { safe(function () { N.plShuffle(!!on); }); };
  /** updateMeta({index?, title?, artist?, album?, artwork?}) -> late tags / cover for a queued item (playback is not interrupted). */
  App.updateMeta = function (o) { var j = o && plJson(o); if (j) safe(function () { N.plMeta(j); }); };
  /** {available, active, playing, playWhenReady, buffering, state:'idle'|'buffering'|'ready'|'ended', index, count, id, url, title, artist, album, positionMs, durationMs, bufferedMs, repeat, shuffle, updatedAt} */
  App.getState = function () { return safe(function () { return JSON.parse(N.plState() || '{}'); }) || { available: false, active: false }; };
  /** openExternal(url) -> boolean. https/http/tg/mailto/tel; t.me and tg: go to the Telegram app (browser if it is missing). */
  App.openExternal = function (url) { return !!plCall('openExternal', String(url == null ? '' : url)); };

  /* ---------- saving blob:/data: files (a[download], FileSaver-style clicks) ---------- */
  var CHUNK = 196608;   // 192 KB, divisible by 3 -> every chunk is standalone base64
  function readB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var r = String(fr.result); res(r.slice(r.indexOf(',') + 1)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  window.__vvSaveBlob = function (href, name, mime) {
    var id = '';
    fetch(href).then(function (r) { return r.blob(); }).then(function (b) {
      id = N.dlBegin(name || '', mime || b.type || '', b.size);
      if (!id) return;
      var p = Promise.resolve(), ok = true;
      for (var o = 0; o < b.size; o += CHUNK) (function (o) {
        p = p.then(function () { return ok ? readB64(b.slice(o, o + CHUNK)).then(function (s) { ok = N.dlChunk(id, s) !== false && ok; }) : 0; });
      })(o);
      return p.then(function () { if (ok) N.dlEnd(id); });
    }).catch(function () { safe(function () { N.dlFail(id || ''); }); });
  };
  function blobLike(h) { return typeof h === 'string' && (h.indexOf('blob:') === 0 || h.indexOf('data:') === 0); }
  function saveAnchor(a) { window.__vvSaveBlob(a.href, a.getAttribute('download') || '', a.type || ''); }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a && blobLike(a.href)) { e.preventDefault(); e.stopPropagation(); saveAnchor(a); }
  }, true);
  safe(function () {
    var A = HTMLAnchorElement.prototype, oc = A.click, od = A.dispatchEvent;
    A.click = function () { if (this.hasAttribute('download') && blobLike(this.href)) { saveAnchor(this); return; } return oc.apply(this, arguments); };
    A.dispatchEvent = function (ev) {
      if (ev && ev.type === 'click' && this.hasAttribute('download') && blobLike(this.href)) { saveAnchor(this); return true; }
      return od.apply(this, arguments);
    };
  });

  /* ---------- media ---------- */
  var handlers = {};
  var ms = navigator.mediaSession;
  if (ms && typeof ms.setActionHandler === 'function' && !ms.__vvPatched) {
    var origSet = ms.setActionHandler;
    try {
      ms.setActionHandler = function (a, h) { handlers[a] = h; return origSet.call(ms, a, h); };
      ms.__vvPatched = true;
    } catch (e) {}
  }

  var active = null, lastSent = '', timer = 0, pauseTimer = 0, tick = 0;
  var cover = { key: '', data: '' };
  var last = { title: '', artist: '', album: '', coverSrc: '' };
  var IGNORE_ARTIST = { 'Неизвестный исполнитель': 1, 'Музыка': 1, 'Unknown artist': 1, 'Music': 1, 'Белгісіз орындаушы': 1 };

  function srcOf(el) { return (el && (el.currentSrc || el.src)) || ''; }
  function isMusic(el) {
    if (!el || el.tagName !== 'AUDIO') return false;
    var s = srcOf(el);
    if (s.indexOf('data:') === 0) return false;       // Howler's "empty" placeholder between tracks
    if (s.indexOf('/sounds/') >= 0) return false;      // UI sounds (message/notice/fail)
    return true;
  }
  /* 3.0.0-beta3 diagnostics: goes to the app's debug log (Settings -> debug info). No query string, no cookies, no tokens. */
  function diag(el, what) {
    try {
      var u = el.currentSrc || el.src || '', p = '';
      try { var uu = new URL(u, location.href); p = uu.protocol + '//' + uu.host + uu.pathname.replace(/[0-9a-f]{8,}/gi, '#'); } catch (e) { p = String(u).slice(0, 12); }
      var er = el.error;
      console.error('[vv-audio] ' + what + ' | code=' + (er ? er.code : '-') + ' ready=' + el.readyState + ' net=' + el.networkState + ' t=' + (+el.currentTime || 0).toFixed(1) + ' src=' + p);
    } catch (e) {}
  }
  var EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied', 'seeked', 'loadedmetadata', 'durationchange', 'ratechange', 'error'];
  function track(el) {
    if (!el || el.__vvT) return;
    el.__vvT = 1;
    EVENTS.forEach(function (ev) { el.addEventListener(ev, function (e) { onEv(el, e); }, true); });
    el.addEventListener('error', function () { diag(el, 'media error'); }, true);
    el.addEventListener('stalled', function () { if (!el.paused && el.readyState < 3) diag(el, 'stalled'); }, true);
  }
  var proto = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (proto && !proto.__vvPlayPatched) {
    var origPlay = proto.play;
    proto.play = function () {
      var el = this; safe(function () { track(el); });
      var r = origPlay.apply(this, arguments);
      safe(function () {
        if (r && typeof r.catch === 'function') r.catch(function (e) { diag(el, 'play() rejected: ' + (e && e.name) + ' ' + String(e && e.message || '').slice(0, 80)); });
        if (isMusic(el)) setTimeout(function () { if (!el.paused && el.currentTime < 0.2 && el.readyState < 3) diag(el, 'no progress 5s after play()'); }, 5000);
      });
      return r;
    };
    proto.__vvPlayPatched = true;
  }
  safe(function () { Array.prototype.forEach.call(document.querySelectorAll('audio'), track); });
  safe(function () { var pool = window.Howler && window.Howler._html5AudioPool; if (pool) pool.forEach(track); });

  function onEv(el, e) {
    if (!isMusic(el)) { if (el === active && (e.type === 'emptied' || e.type === 'pause' || e.type === 'ended')) schedule(false); return; }
    if (e.type === 'play' || e.type === 'playing') active = el;
    if (el !== active) return;
    var playing = !el.paused && !el.ended;
    if (e.type === 'seeked' || e.type === 'durationchange' || e.type === 'loadedmetadata') { if (playing) report(true); else schedule(false); return; }
    schedule(playing);
    if (playing) { setTimeout(function () { report(true); }, 700); setTimeout(function () { report(true); }, 2500); }
  }
  function schedule(playing) {
    if (playing) {                      // going/staying "playing": report right away
      clearTimeout(pauseTimer); pauseTimer = 0;
      report(false);
      if (!tick) tick = setInterval(function () { report(false); }, 4000);
    } else if (!pauseTimer) {           // "paused": wait a bit so a track change (ended -> next src) doesn't flicker
      pauseTimer = setTimeout(function () { pauseTimer = 0; report(false); if (!isPlaying()) { clearInterval(tick); tick = 0; } }, 700);
    }
  }
  function isPlaying() { return !!active && isMusic(active) && !active.paused && !active.ended; }

  /* ----- metadata: mediaSession (if the site sets it) > player DOM > fallback ----- */
  var L = { play: 'Слушать', pause: 'Пауза', next: 'Дальше', prev: 'Назад' };
  function q(sel, root) { return (root || document).querySelector(sel); }
  function playerRoot() {
    var b = q('button[aria-label="' + L.play + '"],button[aria-label="' + L.pause + '"]');
    if (!b) return null;
    var r = b.closest('[role="dialog"]') || b.closest('.fixed');
    if (!r) { r = b; for (var i = 0; i < 6 && r.parentElement; i++) { r = r.parentElement; if (q('button[aria-label="' + L.next + '"]', r)) break; } }
    return r;
  }
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function metaFromSession() {
    var m = safe(function () { return navigator.mediaSession && navigator.mediaSession.metadata; });
    if (!m || !m.title) return null;
    var art = '';
    var list = m.artwork || [];
    if (list.length) { var best = list[list.length - 1]; art = best && best.src || ''; }
    return { title: m.title, artist: m.artist || '', album: m.album || '', coverSrc: art };
  }
  function metaFromDom(root) {
    var o = { title: '', artist: '', album: '', coverSrc: '' }, im;
    if (root.getAttribute('role') === 'dialog') {
      var tp = q('p.text-3xl.font-serif', root);
      if (tp) { o.title = txt(tp); o.artist = txt(tp.nextElementSibling); }
      if (!o.title) o.title = root.getAttribute('aria-label') || '';
      im = q('img.player-cover', root) || q('img', root);
    } else {
      var tb = q('button.text-left', root);
      if (tb) { o.title = txt(tb); o.artist = txt(tb.nextElementSibling); }
      im = q('img', root);
    }
    if (IGNORE_ARTIST[o.artist]) o.artist = '';
    if (im) o.coverSrc = im.currentSrc || im.src || '';
    return o;
  }
  function currentMeta() {
    var m = metaFromSession(), has = !!m, root = null;
    if (!m) { root = playerRoot(); if (root) { m = metaFromDom(root); has = true; } }
    if (!m) m = { title: '', artist: '', album: '', coverSrc: '' };
    if (!m.title) m.title = last.title || fileName(srcOf(active)) || document.title || 'VVVion Space';
    if (m.title === last.title) {       // lyrics view hides artist/cover: keep what we knew about the same track
      if (!m.artist) m.artist = last.artist;
      if (!m.coverSrc) m.coverSrc = last.coverSrc;
    }
    last = { title: m.title, artist: m.artist, album: m.album || '', coverSrc: m.coverSrc };
    m.hasPlayer = has;
    return m;
  }
  function fileName(s) {
    try { var u = new URL(s, location.href); var n = u.searchParams.get('name') || u.pathname.split('/').pop() || ''; return decodeURIComponent(n).replace(/\.[^.]+$/, ''); } catch (e) { return ''; }
  }

  /* ----- cover -> small JPEG data URL ----- */
  function ensureCover(src) {
    if (src === cover.key) return;
    cover.key = src; cover.data = '';
    if (!src) return;
    var img = new Image();
    img.onload = function () {
      if (cover.key !== src) return;
      try {
        var c = document.createElement('canvas'), S = 320; c.width = S; c.height = S;
        var w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
        if (!side) return;
        c.getContext('2d').drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, S, S);
        cover.data = c.toDataURL('image/jpeg', 0.82);
        lastSent = ''; report(true);
      } catch (e) { /* tainted canvas: no cover */ }
    };
    img.onerror = function () {};
    img.src = src;
  }

  function report(force) {
    var el = active, playing = isPlaying();
    if (!el && !force) return;
    var m = currentMeta();
    ensureCover(m.coverSrc);
    var dur = el && isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
    var pos = el && isFinite(el.currentTime) ? Math.round(el.currentTime * 1000) : 0;
    var o = {
      playing: playing, hasPlayer: !!m.hasPlayer || !!el, title: m.title, artist: m.artist, album: m.album,
      coverKey: m.coverSrc ? String(m.coverSrc).slice(0, 200) : '', duration: dur, position: pos,
      buffering: !!el && playing && el.readyState < 3
    };
    var sig = [o.playing, o.hasPlayer, o.title, o.artist, o.coverKey, cover.data ? 1 : 0, dur, o.buffering].join('|');
    if (!force && sig === lastSent) return;
    // position is extrapolated natively; we re-send only on state/metadata change and on seek
    lastSent = sig;
    o.cover = cover.data || '';
    safe(function () { N.mediaState(JSON.stringify(o)); });
  }

  /* ----- commands from the notification / lock screen ----- */
  function call(name, details) {
    var h = handlers[name]; if (typeof h !== 'function') return false;
    try { h(details || { action: name }); return true; } catch (e) { return false; }
  }
  function click(label) {
    var r = playerRoot(); var b = r && q('button[aria-label="' + label + '"]', r);
    if (b) { b.click(); return true; } return false;
  }
  window.__vvMedia = {
    cmd: function (a, arg) {
      var el = active;
      switch (a) {
        case 'play': if (!(call('play') || click(L.play)) && el) safe(function () { el.play(); }); break;
        case 'pause': if (!(call('pause') || click(L.pause)) && el) safe(function () { el.pause(); }); break;
        case 'next': call('nexttrack') || click(L.next); break;
        case 'prev': call('previoustrack') || click(L.prev); break;
        case 'seek': if (!call('seekto', { action: 'seekto', seekTime: (arg || 0) / 1000 }) && el) safe(function () { el.currentTime = (arg || 0) / 1000; }); break;
        case 'stop': if (!(call('stop')) && el) safe(function () { el.pause(); }); break;
      }
      setTimeout(function () { report(true); }, 350);
    },
    state: function () { return { playing: isPlaying(), meta: currentMeta() }; }
  };

  /* ---------- theme -> status / navigation bar colour (native follows meta[name=theme-color] and html.light) ---------- */
  var lastTheme = '', tpend = 0, headObs = 0;
  function readTheme() {
    var m = document.querySelector('meta[name="theme-color"]'), c = m && m.getAttribute('content'), light = H.classList.contains('light');
    if (/^#[0-9a-f]{6}$/i.test(c || '')) {
      var r = parseInt(c.substr(1, 2), 16), g = parseInt(c.substr(3, 2), 16), b = parseInt(c.substr(5, 2), 16);
      light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
    } else c = light ? '#f4f2ee' : '#0c0c0e';
    return { c: c.toLowerCase(), l: light };
  }
  function pushTheme() {
    var t = readTheme(), k = t.c + (t.l ? 1 : 0);
    if (k === lastTheme) return; lastTheme = k;
    safe(function () { N.onTheme(t.c, t.l); });
  }
  function schedTheme() { if (tpend) return; tpend = setTimeout(function () { tpend = 0; pushTheme(); }, 60); }
  function attachTheme() {
    try {
      if (!headObs) { new MutationObserver(schedTheme).observe(H, { attributes: true, attributeFilter: ['class'] }); headObs = 1; }
      if (document.head && headObs === 1) { new MutationObserver(schedTheme).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] }); headObs = 2; }
    } catch (e) {}
    schedTheme();
  }
  attachTheme();
  document.addEventListener('DOMContentLoaded', attachTheme);

  /* ---------- keyboard: called by native on every change (coalesced) ---------- */
  window.__vvKb = function (h, vis) {
    try {
      // The native host has already resized the WebView for IME; do not subtract its height twice.
      H.style.setProperty('--vv-kb', h + 'px'); H.style.setProperty('--kb', '0px');
      H.classList.toggle('vv-kb-open', !!vis);
      window.dispatchEvent(new CustomEvent('vvvion-app-keyboard', { detail: { height: h, visible: !!vis, open: !!vis } }));
    } catch (e) {}
  };

  /* ---------- native back: dispatcher + fallback for sub-screens the site does not put into history ----------
     Native calls window.__vvBackDispatch() on every system "Back" and treats `true` as "consumed".
     Order: (0) site declares ownership (window.__vvvionBackOwned = true) -> only the site handler;
            (1) a sheet/menu/dialog is open or the site has a nested history screen (history.state.vvNest) -> the site handler first, then Escape/close button;
            (2) Circle is open and shows an in-section "back" control (chevron-left + label, e.g. Сервисы -> Курсы) -> click it;
            (3) the site handler (closes Circle / other layers); (4) false -> native default (history / minimise).
     Never traps: one consumed press per distinct page state; if the state did not change within 400 ms native default runs. */
  var lastBack = { sig: '', t: 0 };
  function vis(e) {
    var r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    var s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
  }
  function circlePanel() { return document.querySelector('aside[role="dialog"][aria-label="Круг"]') || document.querySelector('aside[role="dialog"]'); }
  function overlays() {
    var c = circlePanel(), out = [];
    document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"]').forEach(function (e) {
      if (e === c || e.contains(c) || !vis(e)) return; out.push(e);
    });
    return out;
  }
  function sectionBack(c) {
    var best = null, bt = 1e9;
    c.querySelectorAll('button').forEach(function (b) {
      if (!vis(b)) return;
      var r = b.getBoundingClientRect(); if (r.top > 170) return;                       // header area only (carousel arrows live lower)
      var lab = (b.getAttribute('aria-label') || '').trim(), txt = (b.textContent || '').trim();
      if (!lab && !txt) return;                                                             // icon without a name: unknown meaning
      if (/предыд|след|prev|next|слайд|carousel/i.test(lab + ' ' + txt)) return;
      var sv = b.querySelector('svg'), cls = sv ? String(sv.getAttribute('class') || '') : '';
      if (!(/lucide-(chevron-left|arrow-left)(\s|$)/.test(cls) || /^назад$/i.test(lab || txt))) return;
      if (r.top < bt) { bt = r.top; best = b; }
    });
    return best;
  }
  function pageSig() {
    var st = history.state || {}, c = circlePanel(), s = location.pathname + location.search + '#' + (st.__TSR_index == null ? '' : st.__TSR_index) + '|' + (st.vvNest || '');
    if (c) s += '|' + [].map.call(c.querySelectorAll('h1,h2,h3'), function (h) { return vis(h) ? h.textContent.trim() : ''; }).join(',') + '|' + (sectionBack(c) ? 'B' : '');
    return s + '|' + overlays().length;
  }
  function closeOverlay(list) {
    var o = list[list.length - 1], done = false;
    try { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })); } catch (e) {}
    if (!vis(o)) return true;
    [].some.call(o.querySelectorAll('button,[role="button"]'), function (b) {
      var t = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).trim();
      if (vis(b) && /^(закрыть|отмена|close|cancel|назад|готово)$/i.test(t.replace(/\s+/g, ' ').trim())) { b.click(); done = true; return true; }
    });
    return done || !vis(o);
  }
  /* Handles only what the site does not: returns true when it acted. */
  function backFallback() {
    var ov = overlays(); if (ov.length) return closeOverlay(ov);
    var c = circlePanel(); if (!c) return false;
    var b = sectionBack(c); if (!b) return false;
    b.click(); return true;
  }
  function siteBack() { var f = window.__vvvionHandleBack; return typeof f === 'function' ? safe(function () { return f() === true; }) === true : false; }
  window.__vvvionBackFallback = backFallback;
  window.__vvBackDispatch = function () {
    var st = history.state || {}, before = pageSig(), now = Date.now(), res = false;
    if (window.__vvvionBackOwned === true) return siteBack();
    if (before === lastBack.sig && now - lastBack.t < 450) { lastBack.sig = ''; return false; }   // we already tried in this state: let the default run
    var consumedByFallback = false;
    if (overlays().length || st.vvNest) {
      res = siteBack();
      if (!res) { res = safe(backFallback) === true; consumedByFallback = res; }
    } else {
      var c = circlePanel();
      if (c && sectionBack(c)) { res = safe(backFallback) === true; consumedByFallback = res; }
      else res = siteBack();
    }
    if (res && consumedByFallback) {
      lastBack = { sig: before, t: now };
      setTimeout(function () { if (pageSig() === before) safe(function () { N.backDefault(); }); else if (lastBack.sig === before) lastBack.sig = ''; }, 400);   // click had no effect: do not trap the user
    }
    return res;
  };

  /* ---------- native -> web events ---------- */
  window.__vvEmit = function (name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
  };
  /* 2.9.2: native onConfigurationChanged -> event + html classes vv-landscape / vv-portrait */
  window.__vvScreen = function (d) {
    safe(function () { H.classList.toggle('vv-landscape', !!d.landscape); H.classList.toggle('vv-portrait', !d.landscape); H.classList.toggle('vv-tablet', !!d.tablet); });
    window.__vvEmit('vvvion-app-screen', d);
  };
  setTimeout(function () {
    safe(function () { var d = JSON.parse(N.screen() || '{}'); H.classList.toggle('vv-landscape', !!d.landscape); H.classList.toggle('vv-portrait', !d.landscape); });
    window.__vvEmit('vvvion-app-ready', { version: VERSION });
    var t = App.getPushToken(); if (t) window.__vvEmit('vvvion-app-push-token', { token: t });
  }, 0);
})();
