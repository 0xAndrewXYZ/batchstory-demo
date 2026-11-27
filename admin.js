/*
 * Shared by the admin pages: turns <i data-icon="name"> placeholders into Lucide icons (icons.js),
 * keeps the tab strip fitted on a phone (pages without the sidebar), and runs the sidebar shell (design plan, slice 1).
 */
(function () {
  'use strict';
  function icon(name, size) {
    var t = document.createElement('span');
    t.innerHTML = window.CH_ICON ? window.CH_ICON(name, size || 18) : '';
    var svg = t.firstChild;
    if (svg && svg.childNodes) Array.prototype.slice.call(svg.childNodes).forEach(function (n) { if (n.nodeType === 3) svg.removeChild(n); }); // no stray spaces in a link's text (1.24.0: every sidebar link has an icon)
    return svg;
  }
  function fill(root) {
    Array.prototype.slice.call((root || document).querySelectorAll('i[data-icon]')).forEach(function (i) {
      var svg = icon(i.getAttribute('data-icon'), Number(i.getAttribute('data-size')) || 18);
      if (svg) i.replaceWith(svg); else i.remove();
    });
  }
  function hasAdminLink() {
    try { var a = JSON.parse(localStorage.getItem('ch.admin') || 'null'); return !!(a && a.key); } catch (e) { return false; }
  }
  /** All five tabs always show (Entries, Lists and People lead to the sign-in for anyone who is not an admin); this just fits the strip on a phone. */
  function showTabs() { fitNav(); }
  /**
   * On a phone the tab strip scrolls sideways: bring the current tab fully into view and fade the edge that has more tabs past it.
   */
  function fitNav() {
    var nav = document.querySelector('.appbar nav');
    if (!nav) return;
    var cur = nav.querySelector('a[aria-current="page"]');
    if (cur && nav.scrollWidth > nav.clientWidth) {
      var left = cur.offsetLeft, right = left + cur.offsetWidth;
      if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth + 12;
      else if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - 12);
    }
    var edge = function () {
      nav.classList.toggle('fade-l', nav.scrollLeft > 4);
      nav.classList.toggle('fade-r', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
    };
    if (!nav.dataset.fit) { nav.dataset.fit = '1'; nav.addEventListener('scroll', edge, { passive: true }); window.addEventListener('resize', function () { fitNav(); }); }
    edge();
  }
  /*
   * Quick copies: the last answer for each admin page, so switching tabs shows it at once while
   * a fresh copy loads. Kept in sessionStorage (this browser tab only, gone when it closes), tied to
   * the key or sign-in that fetched it, and cleared on sign-out. Never used after a change: pages fetch again.
   */
  function fp(key) { var h = 5381, s = String(key || ''); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  /*
   * 2.7.1: an admin who signed in with their own email and password (a personal sign-in, not on a shared tablet) keeps each
   * view's last answer in this browser ("ch.v.<name>", localStorage), so every admin view draws at once, also in a new tab
   * or the next day, while it reads afresh. CH_CONFIG.keepCopy / keptCopy's rules, and stricter: a copy is used only on the
   * server and for the very sign-in that fetched it (never for another company, another admin or another sign-in), signing
   * out deletes every copy, and a new sign-in deletes the old ones (signin-page.js). The dashboard's copy is "ch.dash" itself.
   * The shared admin link keeps its copies for this tab only (sessionStorage, as before); an admin's turn on a shared
   * tablet keeps none.
   */
  function adminCred() { try { var a = JSON.parse(localStorage.getItem('ch.admin') || 'null'); return a && a.key ? a : null; } catch (e) { return null; } }
  function lasting(key) { var a = adminCred(), C = window.CH_CONFIG; return a && a.session && !a.device && a.key === key && C && C.keepCopy && C.keptCopy ? a : null; }
  function onTablet() { var a = adminCred(); return !!(a && a.device); }
  /** 2.7.1 review: a kept copy lives at most a week (a sign-in lasts 30 days); an older one, or one with no time, is deleted. */
  var COPY_DAYS = 7;
  function tooOld(at) { var t = Number(at); return !(t > 0) || Date.now() - t > COPY_DAYS * 864e5 || t > Date.now() + 60000; }
  function sweep() {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('ch.v.') !== 0) return; var c = null; try { c = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { c = null; } if (!c || tooOld(c.at)) localStorage.removeItem(k); }); } catch (e2) { /* blocked: nothing kept anyway */ }
  }
  sweep();
  var memo = {
    /** {at, data} or null. */
    get: function (name, key) {
      if (onTablet()) return null;
      var a = lasting(key), C = window.CH_CONFIG;
      if (a) {
        var c = C.keptCopy(name === 'data' ? 'ch.dash' : 'ch.v.' + name, a.url, key, true, true);
        if (!c) return null;
        if (name === 'data') { var d = {}; Object.keys(c).forEach(function (k) { if (k.indexOf('__') !== 0) d[k] = c[k]; }); return { at: Date.parse(c.at) || Date.now(), data: d }; }
        if (tooOld(c.at)) { try { localStorage.removeItem('ch.v.' + name); } catch (e1) { /* ignore */ } return null; }
        return c.data && typeof c.data === 'object' ? { at: Number(c.at) || 0, data: c.data } : null;
      }
      try { var v = JSON.parse(sessionStorage.getItem('ch.c.' + name) || 'null'); return v && v.k === fp(key) ? v : null; } catch (e) { return null; }
    },
    put: function (name, key, data) {
      if (onTablet() || !data || data.ok !== true) return;
      var a = lasting(key), C = window.CH_CONFIG;
      if (a) {
        if (name === 'data') C.keepCopy('ch.dash', data, a.url, key);
        else C.keepCopy('ch.v.' + name, { at: Date.now(), money: true, data: data }, a.url, key); // (money: whatever is in it, only this sign-in sees it)
        return;
      }
      try { sessionStorage.setItem('ch.c.' + name, JSON.stringify({ k: fp(key), at: Date.now(), data: data })); } catch (e) { /* full or blocked: just no quick copy */ }
    },
    /** The "nothing changed" stamp of a view's copy (2.5.0 / 2.7.1), or undefined. */
    since: function (name, key) { var q = memo.get(name, key); return q && q.data && typeof q.data.rev === 'string' ? q.data.rev : undefined; },
    clear: function () {
      try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf('ch.c.') === 0) sessionStorage.removeItem(k); }); } catch (e) { /* ignore */ }
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('ch.v.') === 0) localStorage.removeItem(k); }); } catch (e1) { /* ignore */ }
      try { localStorage.removeItem('ch.nav'); } catch (e2) { /* ignore */ }
    },
    // 2.7.1: no background read for the other pages any more (prefetch): each page sends exactly one request as it opens
  };
  /**
   * Export everything (admins; also while the company is paused): every tab of the Sheet, as one file this browser saves.
   * url, key: the page's stored address and admin key or sign-in. Resolves with the file name.
   */
  function exportAll(url, key) {
    if (!window.CH_CONFIG || !CH_CONFIG.read) return Promise.reject(new Error('This page could not load its settings.'));
    return CH_CONFIG.read(url, key, 'export').then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok || !j.tabs) throw new Error((j && j.error) || 'The export was refused.');
      var name = String((j.company && j.company.name) || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
      var file = name + '-everything-' + String(j.at || new Date().toISOString()).slice(0, 10) + '.json';
      var blob = new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      return file;
    });
  }
  function shortTime(t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  /**
   * 2.7.1: the page's "Updated 5:48 PM" line. busy: a read is running, shown as a quiet "Updating…" beside it (the only
   * sign of a refresh; what is on the page stays until the answer replaces it). at: when what is shown was read.
   */
  function updated(node, at, busy) {
    if (!node) return;
    var t = at ? new Date(at) : null, parts = [];
    if (t && !isNaN(t)) parts.push(document.createTextNode('Updated ' + shortTime(t)));
    if (busy) { var w = document.createElement('span'); w.className = 'muted updating'; w.textContent = (parts.length ? ' · ' : '') + 'Updating…'; parts.push(w); }
    node.replaceChildren.apply(node, parts);
    node.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  /** 2.7.1: a value not read yet: a quiet "…" in its place (never a whole-page skeleton). */
  function pending(node) { if (!node) return node; node.textContent = '…'; node.classList.add('muted', 'pending'); node.title = ''; return node; }
  window.CH_ADMIN = { exportAll: exportAll, icon: icon, fill: fill, hasAdminLink: hasAdminLink, showTabs: showTabs, memo: memo, shortTime: shortTime, updated: updated, pending: pending };
  // Admin pages never show inside another website's frame (a trick to make someone click unseen buttons).
  if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location = window.self.location.href; } catch (e) { /* blocked: stays hidden */ } }
  /** A cell or figure with nothing recorded yet: a muted dash with a hover note. A real 0 is never passed here. */
  function none(node) {
    node.textContent = '–'; node.classList.add('none'); node.title = 'Nothing recorded yet';
    return node;
  }
  window.CH_ADMIN.none = none;
  fill(document);
  showTabs();

  /*
   * The sidebar shell (pages with <body class="shell">). The links are plain HTML, the same in every page; this only
   *  - opens and closes the list of links on a tablet (Menu) and a phone (More), with Esc and focus handled;
   *  - marks the current item when a page has views of its own (the dashboard's Now/Season/..., Settings' tabs);
   *  - shows Roasting and Making once the dashboard has shown their tabs (remembered in this browser as two yes/no
   *    values, "ch.nav", tied to the sign-in's fingerprint and forgotten on sign-out).
   * Nothing here decides what a person may do: Code.gs does.
   */
  function shell() {
    var body = document.body, nav = document.getElementById('side-nav'), bar = document.getElementById('tabbar');
    if (!body.classList.contains('shell') || !nav) return;
    var page = (location.pathname.split('/').pop() || 'dashboard.html').replace(/\.html$/, '') || 'dashboard';
    var openers = [document.getElementById('side-open'), document.getElementById('more-open')].filter(Boolean);
    var links = function () { return Array.prototype.slice.call(nav.querySelectorAll('a[data-nav]')); };
    var lastOpener = null;
    function setOpen(on, from) {
      body.classList.toggle('nav-open', on);
      openers.forEach(function (b) { b.setAttribute('aria-expanded', on ? 'true' : 'false'); });
      if (on) { lastOpener = from || null; var first = nav.querySelector('a[aria-current="page"]') || links().filter(function (l) { return !l.hidden; })[0]; if (first) first.focus(); }
      else if (lastOpener) { lastOpener.focus(); lastOpener = null; }
    }
    openers.forEach(function (b) { b.addEventListener('click', function () { setOpen(!body.classList.contains('nav-open'), b); }); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && body.classList.contains('nav-open')) setOpen(false); });
    if (window.matchMedia) {
      var wide = window.matchMedia('(min-width: 1024px)');
      var onWide = function () { if (wide.matches && body.classList.contains('nav-open')) { lastOpener = null; setOpen(false); } };
      if (wide.addEventListener) wide.addEventListener('change', onWide); else if (wide.addListener) wide.addListener(onWide);
    }

    /* which item is current */
    var TAB = { home: 'home', stock: 'production' /* slice 5 */, season: 'production', ferments: 'production', roasting: 'production', making: 'production', batches: 'production' /* app 1.19.0 */, entries: 'entries' };
    function mark(key) {
      links().forEach(function (l) { if (l.getAttribute('data-nav') === key) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current'); });
      if (bar) Array.prototype.slice.call(bar.querySelectorAll('[data-bar]')).forEach(function (t) {
        if (t.getAttribute('data-bar') === (TAB[key] || 'more')) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
      });
    }
    var tabs = document.querySelector('main .subtabs');
    function selected() {
      var t = tabs && tabs.querySelector('[role="tab"][aria-selected="true"]');
      if (!t && page === 'settings') return String(location.hash || '').replace('#', ''); /* slice 7: Settings has no tab strip; its view is the address's #… */
      return t ? String(t.id || '').replace(/^tab-/, '') : '';
    }
    function sync() {
      var v = selected();
      if (page === 'dashboard') mark(v && v !== 'now' ? v : 'home');
      else if (page === 'settings') mark(v === 'forms' || v === 'track' ? 'forms' : v === 'history' ? 'history' : v === 'profile' || v === 'me' ? '' : 'company'); /* 1.22.2: the Change log is its own item, the last under Set-up */ /* slice 7: #track, and My profile is not a sidebar item */
    }

    /* Roasting and Making: only once there is something to show (the dashboard decides; here it is only remembered) */
    function who() { try { var a = JSON.parse(localStorage.getItem('ch.admin') || 'null'); return a && a.key ? fp(a.key) : ''; } catch (e) { return ''; } }
    function optional(set) {
      var keep = null;
      try { keep = JSON.parse(localStorage.getItem('ch.nav') || 'null'); } catch (e) { keep = null; }
      if (!keep || keep.k !== who()) keep = { k: who(), roasting: false, making: false };
      if (set) { keep.roasting = !!set.roasting; keep.making = !!set.making; try { localStorage.setItem('ch.nav', JSON.stringify(keep)); } catch (e2) { /* blocked: this page only */ } }
      // 1.24.0: Roasting, Making and Batches show from day one while their work area is switched on (an empty page says what will appear)
      var on = function (a) { var C = window.CH_CONFIG; return !C || !C.areaOn || C.areaOn(a); };
      links().forEach(function (l) { var k = l.getAttribute('data-nav'); if (k === 'roasting') l.hidden = !on('roasting'); else if (k === 'making' || k === 'batches') l.hidden = !on('making'); });
    }
    optional();

    /* slice 5: the count beside Entries (entries that need a look). The dashboard is told the number by the server (admins
     * only) and says it here; it is remembered with Roasting and Making in "ch.nav", so the other pages show it too until
     * the dashboard next looks. Only a number is kept, and sign-out forgets it. */
    function held(n) {
      var keep = null;
      try { keep = JSON.parse(localStorage.getItem('ch.nav') || 'null'); } catch (e) { keep = null; }
      if (!keep || keep.k !== who()) keep = { k: who(), roasting: false, making: false };
      if (n !== undefined) { keep.held = Math.max(0, Math.round(Number(n)) || 0); try { localStorage.setItem('ch.nav', JSON.stringify(keep)); } catch (e2) { /* blocked: this page only */ } }
      var count = hasAdminLink() ? keep.held || 0 : 0;
      [nav.querySelector('a[data-nav="entries"]'), bar && bar.querySelector('[data-bar="entries"]')].forEach(function (a) {
        if (!a) return;
        var old = a.querySelector('.nav-count');
        if (old) old.remove();
        if (!count) return;
        var c = document.createElement('span'), w = document.createElement('span');
        c.className = 'nav-count'; c.textContent = String(count);
        w.className = 'sr-only'; w.textContent = count === 1 ? ' needs a look' : ' need a look'; // one name everywhere (1.24.2), the status pill's
        c.appendChild(w); a.appendChild(c);
      });
    }
    held();
    window.CH_ADMIN.navHeld = held;

    /* slice 5: someone without an admin sign-in or link (a viewer) gets Home, Production and Labels only. This is tidiness on
     * the page: Code.gs refuses the rest whatever the page shows. "Sign in (admins)" stays in the bar as the way in. */
    var ADMIN_ONLY = ['entries', 'exports', 'history', 'people', 'lists', 'forms', 'company'];
    /* P3-A: Finances shows for an admin sign-in or link, and for someone the last page that read data was told may see money
     * (byRole(true/false) from the dashboard, the report or Finances itself; remembered as one yes/no in "ch.nav"). */
    function seesMoney(m) {
      var keep = null;
      try { keep = JSON.parse(localStorage.getItem('ch.nav') || 'null'); } catch (e) { keep = null; }
      if (!keep || keep.k !== who()) keep = { k: who(), roasting: false, making: false };
      if (typeof m === 'boolean' && keep.money !== m) { keep.money = m; try { localStorage.setItem('ch.nav', JSON.stringify(keep)); } catch (e2) { /* blocked: this page only */ } }
      return hasAdminLink() || (typeof m === 'boolean' ? m : keep.money === true);
    }
    /* P4-B/2: "Scan a form" (the sidebar, the Exports page's row: [data-scan-link]) shows only once a settings read said scanning
     * is switched on (scan.html and Settings tell it, navScan(true/false); remembered as one yes/no in "ch.nav"), and never
     * to a viewer. Tidiness only: Code.gs refuses scan_read whatever the page shows. */
    function scanOn(on) {
      var keep = null;
      try { keep = JSON.parse(localStorage.getItem('ch.nav') || 'null'); } catch (e) { keep = null; }
      if (!keep || keep.k !== who()) keep = { k: who(), roasting: false, making: false };
      if (typeof on === 'boolean' && keep.scan !== on) { keep.scan = on; try { localStorage.setItem('ch.nav', JSON.stringify(keep)); } catch (e2) { /* blocked: this page only */ } }
      return keep.scan === true;
    }
    function byRole(money) {
      // only on the pages a viewer can use; the admin-only pages send anyone else to the sign-in themselves, and keep an admin link a moment after they open
      var viewer = !hasAdminLink() && ['dashboard', 'labels', 'report', 'finances'].indexOf(page) >= 0;
      var fin = seesMoney(money), scan = scanOn() && !viewer;
      body.classList.toggle('viewer', viewer);
      links().forEach(function (l) { var k = l.getAttribute('data-nav'); if (k === 'scan') l.hidden = !scan; else if (ADMIN_ONLY.indexOf(k) >= 0) l.hidden = viewer; else if (k === 'finances') l.hidden = !fin; });
      Array.prototype.forEach.call(document.querySelectorAll('[data-scan-link]:not([data-nav])'), function (x) { x.hidden = !scan; });
      Array.prototype.slice.call(nav.querySelectorAll('.nav-group')).forEach(function (g) {
        g.hidden = !Array.prototype.some.call(g.querySelectorAll('a[data-nav]'), function (l) { var k = l.getAttribute('data-nav'); return k === 'finances' ? fin : k === 'scan' ? scan : ADMIN_ONLY.indexOf(k) < 0 || !viewer; });
      });
      var be = bar && bar.querySelector('[data-bar="entries"]');
      if (be) be.hidden = viewer;
      held();
    }
    byRole();
    window.CH_ADMIN.navRole = byRole;
    window.CH_ADMIN.navScan = function (on) { scanOn(!!on); byRole(); }; // P4-B/2

    if (tabs && page === 'dashboard') {
      var seen = function () {
        var r = document.getElementById('tab-roasting'), m = document.getElementById('tab-making');
        optional({ roasting: !!(r && !r.hidden), making: !!(m && !m.hidden) });
      };
      // the sidebar's links to this page's own views press the page's tab, so the page's own code changes the view
      nav.addEventListener('click', function (ev) {
        var l = ev.target.closest ? ev.target.closest('a[data-nav]') : null;
        if (!l || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
        var k = l.getAttribute('data-nav'), t = document.getElementById('tab-' + (k === 'home' ? 'now' : k));
        if (!t || t.hidden || !TAB[k] || k === 'entries') return;
        ev.preventDefault(); t.click(); if (body.classList.contains('nav-open')) { lastOpener = null; setOpen(false); }
        window.scrollTo(0, 0);
      });
      if (bar) bar.addEventListener('click', function (ev) {
        var l = ev.target.closest ? ev.target.closest('a[data-bar]') : null;
        if (!l || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
        var k = l.getAttribute('data-bar'), cur = selected();
        var t = k === 'home' ? document.getElementById('tab-now') : k === 'production' ? document.getElementById(cur && cur !== 'now' ? 'tab-' + cur : 'tab-stock' /* slice 5: Production opens Stock */) : null;
        if (!t || t.hidden) return;
        ev.preventDefault(); t.click(); if (body.classList.contains('nav-open')) { lastOpener = null; setOpen(false); }
        window.scrollTo(0, 0);
      });
      if (window.MutationObserver) new MutationObserver(function () { seen(); sync(); }).observe(tabs, { attributes: true, subtree: true, attributeFilter: ['aria-selected', 'hidden'] });
    } else if (page === 'settings') {
      if (tabs && window.MutationObserver) new MutationObserver(sync).observe(tabs, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
      window.addEventListener('hashchange', sync); /* slice 7 */
      nav.addEventListener('click', function (ev) { var l = ev.target.closest ? ev.target.closest('a[data-nav]') : null; if (l && /^settings\.html/.test(l.getAttribute('href')) && body.classList.contains('nav-open')) { lastOpener = null; setOpen(false); } });
    }
    sync();
  }
  shell();

  /**
   * Light/dark switch. It is not in the app bar any more: signed-in admins find it in the account menu (signin.js);
   * everyone else gets a small text button at the foot of the page. The choice is kept in this browser (see config.js).
   */
  function themeLabel() { var C = window.CH_CONFIG; return C.shownTheme() === 'dark' ? 'Light mode' : 'Dark mode'; }
  function themeButton() {
    var C = window.CH_CONFIG;
    var foot = document.querySelector('.page-foot');
    if (!C || !C.setTheme || !foot) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost btn-sm foot-theme'; b.id = 'theme-toggle';
    function draw() { b.textContent = themeLabel(); b.setAttribute('aria-label', 'Switch to ' + themeLabel().toLowerCase()); }
    b.addEventListener('click', function () { C.setTheme(C.shownTheme() === 'dark' ? 'light' : 'dark'); draw(); });
    if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', draw); }
    draw();
    foot.parentNode.insertBefore(b, foot.nextSibling);
  }
  window.CH_ADMIN.themeLabel = themeLabel;
  themeButton();

  /**
   * The quiet (i) beside a heading (1.22.2; styles in ui.css .infotip). Markup: <span class="infotip"><button class="info-btn" aria-expanded
   * aria-describedby="id">…</button><span class="info-tip" id="id" role="tooltip">…</span></span>. The words show on hover and on
   * keyboard focus (CSS), and a tap or click pins them open. Esc, a second tap, or a tap elsewhere closes. Never a browser title.
   */
  function infoTips() { // 1.24.0: listens on the page, so a tip a page draws later (a settings row) works like one in the markup
    var set = function (box, open) { box.classList.toggle('open', open); var b = box.querySelector('.info-btn'); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    var boxOf = function (t) { return t && t.closest ? t.closest('.infotip') : null; };
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.info-btn') : null, mine = btn ? boxOf(btn) : null;
      Array.prototype.forEach.call(document.querySelectorAll('.infotip.open'), function (box) { if (box !== mine && !box.contains(ev.target)) set(box, false); });
      if (!mine) return;
      var was = mine.classList.contains('open'); mine.classList.toggle('shut', was); set(mine, !was); // a second tap closes, even with the pointer still over it
    });
    document.addEventListener('keydown', function (ev) { var box = boxOf(ev.target); if (box && ev.key === 'Escape') { set(box, false); box.classList.add('shut'); } }); // Esc also hides what hover or focus is showing
    document.addEventListener('mouseout', function (ev) { var box = boxOf(ev.target); if (box && !box.contains(ev.relatedTarget)) box.classList.remove('shut'); });
    document.addEventListener('focusout', function (ev) { var box = boxOf(ev.target); if (box && !box.contains(ev.relatedTarget)) { box.classList.remove('shut'); set(box, false); } });
  }
  infoTips();
  var tipN = 0;
  /** An (i) beside a label: infoTip('Short name', 'Shown on phones where the full name does not fit.') → the node to put after the label. */
  window.CH_ADMIN.infoTip = function (about, text) {
    var id = 'tip-' + (++tipN), box = document.createElement('span'), b = document.createElement('button'), t = document.createElement('span');
    box.className = 'infotip'; b.type = 'button'; b.className = 'info-btn'; b.setAttribute('aria-label', 'About ' + about); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-describedby', id);
    b.appendChild(icon('info', 16)); t.className = 'info-tip'; t.id = id; t.setAttribute('role', 'tooltip'); t.textContent = text;
    box.appendChild(b); box.appendChild(t);
    return box;
  };

  /**
   * The list of a page's sections ("On this page", ui.css .pagenav): the one in view is marked as you scroll (1.22.2).
   * pageNav(pairs): [{link, target}]. One list at a time: calling it again replaces the list (a page draws its sections again).
   */
  var navPairs = [], navOn = false, navTick = 0, navPicked = null;
  function navMark() {
    navTick = 0;
    var live = navPairs.filter(function (p) { return p.target && p.target.offsetParent !== null && document.contains(p.link); });
    if (!live.length) return;
    var line = 120, cur = live[0];
    live.forEach(function (p) { if (p.target.getBoundingClientRect().top <= line) cur = p; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2 && window.scrollY > 0) cur = live[live.length - 1]; // the foot of the page: its last section
    // 2026-11-21: a section picked in the list stays marked while it is on screen, even when the page cannot scroll far enough
    // to bring it to the top (a tall window); the reader's own scrolling (wheel, touch, keys) hands marking back to the scroll position
    if (navPicked && live.indexOf(navPicked) !== -1) { var r = navPicked.target.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0) cur = navPicked; }
    navPairs.forEach(function (p) { if (p === cur) p.link.setAttribute('aria-current', 'true'); else p.link.removeAttribute('aria-current'); });
  }
  function pageNav(pairs) {
    navPairs = pairs || [];
    navPairs.forEach(function (p) { if (p.link && !p.link.__chPick) { p.link.__chPick = true; p.link.addEventListener('click', function () { window.CH_ADMIN.pageNavPick(p.link); }); } }); // every page's list (Settings, Season, Help)
    if (!navOn) {
      navOn = true;
      var later = function () { if (!navTick) navTick = (window.requestAnimationFrame || setTimeout)(navMark); };
      window.addEventListener('scroll', later, { passive: true }); window.addEventListener('resize', later);
      var unpick = function () { navPicked = null; };
      ['wheel', 'touchmove', 'keydown'].forEach(function (k) { window.addEventListener(k, unpick, { passive: true }); });
      if (window.ResizeObserver) new ResizeObserver(later).observe(document.body); // sections that arrive or fold change which one is in view
    }
    navMark();
  }
  window.CH_ADMIN.pageNav = pageNav;
  /** The reader picked this link in the list: keep it marked while its section is on screen (see navMark). */
  window.CH_ADMIN.pageNavPick = function (link) { navPicked = null; navPairs.forEach(function (p) { if (p.link === link) navPicked = p; }); navMark(); };

  /*
   * Components (design plan, slice 2): CH_ADMIN.ui. Styles are in ui.css. Every value is put on the page as text.
   *   el(tag, props, kids)            a small element builder
   *   pill(tone, text)                a status pill: a dot and a word (tone: ok, warn, bad, info, or none)
   *   sortable(table, opts)           click or Enter on a heading sorts; aria-sort says how; IDs sort as text parts (2.9 before 2.10)
   *   pager(opts), paged(table)       one pager for every long list: "1–25 of 214", rows per page (remembered), Previous and Next
   *   filter(table, opts)             search box, dropdown filters and the count, kept in the page's address (opts.q: the search's name there, 'q' unless given)
   *   menu(button, items)             the three-dots row menu: arrow keys, Esc, focus back to the button
   *   panel(opts)                     a side panel (a sheet on a phone): focus stays inside, Esc closes, focus returns
   *   skeleton(kind, n)               the shape of what is loading: 'rows', 'strip' or 'lines'
   *   empty(title, hint, action)      one sentence and one action
   *   toast(text)                     a short message in #toast
   *   dirtyBar(form, opts)            one Save / Discard bar while a section has unsaved changes (busy(text) / idle(): "Saving…")
   */
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'hidden' || k === 'disabled') n[k] = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function pill(tone, text) { return el('span', { className: 'badge' + (tone ? ' ' + tone : ''), text: text }); }

  /* ----- sorting ----- */
  /** Compares two IDs part by part as whole numbers, never as decimals: 2.9 comes before 2.10, and 2.1 is not 2.10. */
  function compareId(a, b) {
    var x = String(a).split(/([0-9]+)/), y = String(b).split(/([0-9]+)/);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = x[i] == null ? '' : x[i], q = y[i] == null ? '' : y[i];
      if (p === q) continue;
      if (/^[0-9]+$/.test(p) && /^[0-9]+$/.test(q)) { var d = Number(p) - Number(q); return d || p.length - q.length; }
      return p < q ? -1 : 1;
    }
    return 0;
  }
  function cellValue(row, i) { var c = row.cells[i]; if (!c) return ''; var v = c.getAttribute('data-v'); return v != null ? v : c.textContent.trim(); }
  function isNone(row, i) { var c = row.cells[i]; return !c || (c.getAttribute('data-v') == null && (c.textContent.trim() === '' || c.textContent.trim() === '–')) || c.getAttribute('data-v') === ''; }
  function sortable(table, opts) {
    opts = opts || {};
    var heads = Array.prototype.slice.call(table.tHead ? table.tHead.rows[0].cells : []);
    var nameOf = function (h) { return h ? h.textContent.trim() : ''; };
    function apply(i, dir) {
      if (!heads[i]) return;
      var kind = heads[i].getAttribute('data-sort');
      var body = table.tBodies[0], rows = Array.prototype.slice.call(body.rows);
      var cmp = kind === 'num' ? function (a, b) { return Number(a) - Number(b); }
        : kind === 'id' ? compareId
        : function (a, b) { return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }); };
      rows.map(function (r, n) { return { r: r, n: n }; }).sort(function (a, b) {
        var ea = isNone(a.r, i), eb = isNone(b.r, i);
        if (ea || eb) return ea && eb ? a.n - b.n : ea ? 1 : -1; // nothing recorded goes last, whichever way the column is sorted
        var c = cmp(cellValue(a.r, i), cellValue(b.r, i));
        return (dir === 'descending' ? -c : c) || a.n - b.n;
      }).forEach(function (x) { body.appendChild(x.r); });
      heads.forEach(function (h, n) { if (h.hasAttribute('data-sort')) h.setAttribute('aria-sort', n === i ? dir : 'none'); });
      // app 1.25.0: the table remembers its sort by the heading's words, so a table drawn again (fresh data) keeps it (opts.keep),
      // and the pager goes back to the first page only when the order really changed
      var was = table.__sort, now = { name: nameOf(heads[i]), dir: dir };
      table.__sort = now;
      if (table.__paged) { if (!was || was.name !== now.name || was.dir !== now.dir) table.__paged.first(); else table.__paged.paint(); }
      if (opts.onSort) opts.onSort(i, dir);
    }
    heads.forEach(function (h, i) {
      if (!h.hasAttribute('data-sort') || h.querySelector('.sort')) return;
      var b = el('button', { type: 'button', className: 'sort' });
      while (h.firstChild) b.appendChild(h.firstChild);
      h.appendChild(b);
      if (!h.hasAttribute('aria-sort')) h.setAttribute('aria-sort', 'none');
      b.addEventListener('click', function () { apply(i, h.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending'); });
    });
    if (opts.keep && table.__sort) {
      var at = heads.map(nameOf).indexOf(table.__sort.name);
      if (at >= 0 && heads[at].hasAttribute('data-sort')) apply(at, table.__sort.dir); else table.__sort = null;
    }
    return { sort: apply };
  }

  /* ----- pages (app 1.25.0) ----- */
  /*
   * One pager for every long list. It works on what the page already has: no request is made.
   *   pager(opts) → { node, range(total), first(), show(index), size() }
   *     opts.key       the list's name: its rows-per-page choice is remembered under it in this browser ("ch.rows")
   *     opts.label     what the list is called, for a screen reader ("Ferments")
   *     opts.onChange  called after the page or the rows per page changed (the caller draws again and calls range())
   *   range(total) → { from, to }: the rows of the current page (to is one past the last); it also draws "1–25 of 214".
   * The control is hidden while everything fits on one page of the usual size (25), so a short table looks as it always did.
   *   paged(table, opts): the same for a <table>: rows outside the page are hidden; rows a filter took out (data-out) stay out.
   */
  var SIZES = [10, 25, 50, 100], SIZE = 25;
  function rowsKept() { try { var v = JSON.parse(localStorage.getItem('ch.rows') || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  function pager(opts) {
    opts = opts || {};
    var kept = opts.key ? Number(rowsKept()[opts.key]) : 0;
    var size = SIZES.indexOf(kept) >= 0 ? kept : SIZE, page = 1, total = 0;
    var name = opts.label || 'this list';
    var range = el('span', { className: 'pager-range' }); // review: not a live region (every redraw would re-announce it)
    var sel = el('select', { 'aria-label': 'Rows per page, ' + name }, SIZES.map(function (n) { return el('option', { value: String(n), text: String(n) }); }));
    sel.value = String(size);
    var prev = el('button', { type: 'button', className: 'btn btn-secondary btn-sm btn-icon pager-prev', 'aria-label': 'Previous page' }, [icon('chevron-left', 16)]);
    var next = el('button', { type: 'button', className: 'btn btn-secondary btn-sm btn-icon pager-next', 'aria-label': 'Next page' }, [icon('chevron-right', 16)]);
    var node = el('nav', { className: 'pager', 'aria-label': 'Pages of ' + name, hidden: true }, [
      range, el('label', { className: 'pager-size' }, [el('span', { text: 'Rows per page' }), sel]), el('span', { className: 'pager-nav' }, [prev, next]),
    ]);
    var pages = function () { return Math.max(1, Math.ceil(total / size)); };
    var fmtN = function (n) { return n.toLocaleString('en-US'); };
    function draw() {
      page = Math.min(Math.max(1, page), pages());
      var from = (page - 1) * size, to = Math.min(total, from + size);
      range.textContent = total ? fmtN(from + 1) + '–' + fmtN(to) + ' of ' + fmtN(total) : '';
      // a button that goes out of use while it holds the keyboard hands it to the other one
      var a = document.activeElement;
      prev.disabled = page <= 1; next.disabled = page >= pages();
      if (a === prev && prev.disabled && !next.disabled) next.focus(); else if (a === next && next.disabled && !prev.disabled) prev.focus();
      node.hidden = !(total > size || (size !== SIZE && total > SIZES[0]));
      return { from: from, to: to };
    }
    function changed() {
      if (opts.onChange) opts.onChange();
      // the top of the next page, not its foot: bring the list's start back into view when it has scrolled away
      var host = opts.top || node.parentNode;
      if (host && host.getBoundingClientRect && host.getBoundingClientRect().top < 0) host.scrollIntoView({ block: 'start' });
    }
    prev.addEventListener('click', function () { page--; draw(); changed(); });
    next.addEventListener('click', function () { page++; draw(); changed(); });
    sel.addEventListener('change', function () {
      var first = (page - 1) * size; // the row at the top stays on the page after the change
      size = Number(sel.value) || SIZE; page = Math.floor(first / size) + 1;
      if (opts.key) { try { var all = rowsKept(); all[opts.key] = size; localStorage.setItem('ch.rows', JSON.stringify(all)); } catch (e) { /* blocked: this visit only */ } }
      draw(); changed();
    });
    return {
      node: node,
      range: function (n) { total = Math.max(0, n | 0); return draw(); },
      first: function () { page = 1; },
      show: function (index) { page = Math.floor(Math.max(0, index) / size) + 1; },
      size: function () { return size; },
    };
  }
  function paged(table, opts) {
    opts = opts || {};
    var st = table.__paged;
    if (!st) {
      var wrap = table.parentNode;
      var p = pager({ key: opts.key || table.id, label: opts.label || table.getAttribute('aria-label') || 'this table', top: wrap.parentNode, onChange: function () { st.paint(); } });
      st = table.__paged = {
        pager: p,
        paint: function () {
          var rows = Array.prototype.slice.call(table.tBodies[0] ? table.tBodies[0].rows : []);
          var live = rows.filter(function (r) { return !r.hasAttribute('data-out'); });
          var r = p.range(live.length);
          rows.forEach(function (row) { if (row.hasAttribute('data-out')) row.hidden = true; });
          live.forEach(function (row, i) { row.hidden = i < r.from || i >= r.to; });
          wrap.classList.toggle('is-paged', !p.node.hidden);
        },
        first: function () { p.first(); st.paint(); },
      };
      wrap.parentNode.insertBefore(p.node, wrap.nextSibling);
    }
    st.paint();
    return st;
  }

  /* ----- search and filters ----- */
  function filter(table, opts) {
    opts = opts || {};
    var search = opts.search || null, selects = opts.filters || [], count = opts.count || null, noun = opts.noun || ['row', 'rows'];
    var qName = opts.q || 'q'; // the search's name in the address: a page with two lists gives each its own (app 1.19.0: Batches is ?bq=)
    var params = new URLSearchParams(location.search);
    if (search && params.get(qName)) search.value = params.get(qName);
    selects.forEach(function (s) { var v = params.get(s.name); if (v != null && Array.prototype.some.call(s.options, function (o) { return o.value === v; })) s.value = v; });
    var lastSig = null;
    function run() {
      var q = search ? search.value.trim().toLowerCase() : '', shown = 0, rows = Array.prototype.slice.call(table.tBodies[0].rows);
      rows.forEach(function (r) {
        var ok = !q || r.textContent.toLowerCase().indexOf(q) >= 0;
        selects.forEach(function (s) { if (ok && s.value) ok = (' ' + (r.getAttribute('data-' + s.name) || '') + ' ').indexOf(' ' + s.value + ' ') >= 0; });
        r.hidden = !ok; r.toggleAttribute('data-out', !ok); if (ok) shown++;
      });
      // app 1.25.0: a paged table goes back to its first page when the search or a filter changed; drawn again with the same ones, it stays
      var sig = q + '\n' + selects.map(function (x) { return x.value; }).join('\n');
      if (table.__paged) { if (sig !== lastSig) table.__paged.first(); else table.__paged.paint(); }
      lastSig = sig;
      selects.forEach(function (s) { if (s.parentNode) s.parentNode.classList.toggle('is-set', !!s.value); });
      if (count) count.textContent = shown === rows.length ? shown + ' ' + (shown === 1 ? noun[0] : noun[1]) : shown + ' of ' + rows.length;
      var none = table.parentNode.parentNode.querySelector('.table-empty');
      if (none) none.hidden = shown > 0;
      var next = new URLSearchParams(location.search);
      if (q) next.set(qName, search.value.trim()); else next.delete(qName);
      selects.forEach(function (s) { if (s.value) next.set(s.name, s.value); else next.delete(s.name); });
      var qs = next.toString();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) { /* a file page: the address stays */ }
      if (opts.onChange) opts.onChange(shown);
    }
    if (search) {
      search.addEventListener('input', run);
      document.addEventListener('keydown', function (ev) { // "/" jumps to the search box, unless you are typing somewhere
        var t = ev.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
        if (ev.key === '/' && !typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); search.focus(); }
      });
    }
    selects.forEach(function (s) { s.addEventListener('change', run); });
    run();
    return { run: run };
  }

  /* ----- the row menu ----- */
  var openMenu = null;
  function closeMenu(focusBack) {
    if (!openMenu) return;
    var m = openMenu; openMenu = null;
    m.node.remove(); m.button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', m.outside, true); window.removeEventListener('resize', m.away); window.removeEventListener('scroll', m.away, true);
    if (focusBack) m.button.focus();
  }
  /** items: [{ label, onSelect, danger, href }] or '-' for a line; or a function that returns them when the menu opens. */
  function menu(button, items) {
    button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    function open(last) {
      closeMenu(false);
      var list = (typeof items === 'function' ? items() : items).filter(Boolean);
      var node = el('div', { className: 'menu', role: 'menu', 'aria-label': button.getAttribute('aria-label') || 'Actions' });
      list.forEach(function (it) {
        if (it === '-') { node.appendChild(el('div', { role: 'separator' })); return; }
        var b = el(it.href ? 'a' : 'button', { role: 'menuitem', tabindex: '-1', className: it.danger ? 'danger' : '', href: it.href || null, type: it.href ? null : 'button', text: it.label });
        b.addEventListener('click', function () { closeMenu(true); if (it.onSelect) it.onSelect(); });
        node.appendChild(b);
      });
      // 2.6.0: a menu inside the side panel (a modal dialog) lives in the dialog, so it is above the page's dimmed layer
      var host = button.closest('dialog[open]');
      (host || document.body).appendChild(node);
      if (host) node.style.position = 'fixed';
      var r = button.getBoundingClientRect(), w = node.offsetWidth, h = node.offsetHeight;
      var left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
      var top = r.bottom + 4 + h > window.innerHeight - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : r.bottom + 4;
      node.style.left = (left + (host ? 0 : window.scrollX)) + 'px'; node.style.top = (top + (host ? 0 : window.scrollY)) + 'px';
      var its = Array.prototype.slice.call(node.querySelectorAll('[role="menuitem"]'));
      node.addEventListener('keydown', function (ev) {
        var i = its.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); its[(i + 1) % its.length].focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
        else if (ev.key === 'Home') { ev.preventDefault(); its[0].focus(); }
        else if (ev.key === 'End') { ev.preventDefault(); its[its.length - 1].focus(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeMenu(true); }
        else if (ev.key === 'Tab') { closeMenu(true); }
      });
      // the menu scrolls with the page; it closes only if its button has moved under it (a table scrolled inside its box, or the window resized)
      var state = { node: node, button: button, outside: function (ev) { if (!node.contains(ev.target) && !button.contains(ev.target)) closeMenu(false); },
        away: function () { var n = button.getBoundingClientRect(), m = node.getBoundingClientRect(); if (Math.abs((n.bottom - m.top) - (r.bottom - top)) > 6 && Math.abs((n.top - m.bottom) - (r.top - top - h)) > 6) closeMenu(false); } };
      document.addEventListener('mousedown', state.outside, true); window.addEventListener('resize', state.away); window.addEventListener('scroll', state.away, true);
      openMenu = state; button.setAttribute('aria-expanded', 'true');
      if (its.length) its[last ? its.length - 1 : 0].focus({ preventScroll: true });
    }
    button.addEventListener('click', function () { if (openMenu && openMenu.button === button) closeMenu(true); else open(false); });
    button.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); open(false); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); open(true); }
    });
    return { open: open, close: function () { closeMenu(true); } };
  }

  /* ----- the side panel ----- */
  /** opts: { title, body (a node), foot (nodes), onClose }. Returns { node, body, foot, close }. One panel at a time. */
  var openPanel = null;
  function panel(opts) {
    opts = opts || {};
    if (openPanel) openPanel.close();
    var id = 'panel-title-' + Date.now().toString(36);
    var body = el('div', { className: 'panel-body' }, opts.body ? [opts.body] : []);
    var foot = el('div', { className: 'panel-foot' }, opts.foot || []);
    var x = el('button', { type: 'button', className: 'btn btn-secondary btn-icon', 'aria-label': 'Close' }, [icon('x', 18)]);
    var d = el('dialog', { className: 'panel', 'aria-labelledby': id }, [
      el('div', { className: 'panel-in' }, [el('div', { className: 'panel-head' }, [el('h2', { id: id, text: opts.title || '' }), x]), body, foot]),
    ]);
    var back = document.activeElement;
    function close() { if (d.open) d.close(); }
    x.addEventListener('click', close);
    d.addEventListener('click', function (ev) { if (ev.target === d) close(); }); // a click on the dimmed page beside it
    d.addEventListener('close', function () {
      d.remove(); if (openPanel && openPanel.node === d) openPanel = null;
      if (back && back.focus && document.contains(back)) back.focus();
      if (opts.onClose) opts.onClose();
    });
    document.body.appendChild(d);
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    var first = body.querySelector('input:not([type=hidden]), select, textarea, button, a[href]');
    (first || x).focus();
    openPanel = { node: d, body: body, foot: foot, close: close };
    return openPanel;
  }

  /* ----- small ones ----- */
  function skeleton(kind, n) {
    var k = kind === 'rows' || kind === 'strip' ? kind : 'lines';
    var s = el('div', { className: 'skel ' + k, 'aria-hidden': 'true' });
    for (var i = 0; i < (n || (k === 'strip' ? 4 : 6)); i++) s.appendChild(el('i', k === 'lines' ? { style: 'width:' + [92, 78, 85, 60, 88, 70][i % 6] + '%' } : {}));
    return s;
  }
  function empty(title, hint, action) {
    return el('div', { className: 'empty' }, [el('span', { className: 'empty-title', text: title }), hint ? el('span', { className: 'empty-hint', text: hint }) : null, action || null]);
  }
  var toastTimer = null;
  function toast(text, ms) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.replaceChildren(icon('circle-check', 18), document.createTextNode(text));
    t.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 4000);
  }
  /** Shows one bar with Save and Discard while any field of the form differs from when it was last saved or loaded. */
  function dirtyBar(form, opts) {
    opts = opts || {};
    var fields = function () { return Array.prototype.slice.call(form.querySelectorAll('input, select, textarea')).filter(function (f) { return f.name || f.id; }); };
    var val = function (f) { return f.type === 'checkbox' || f.type === 'radio' ? String(f.checked) : f.value; };
    var was = {};
    var note = el('span', { text: opts.text || 'You have unsaved changes.' });
    var save = el('button', { type: 'button', className: 'btn btn-primary', text: opts.saveLabel || 'Save' });
    var drop = el('button', { type: 'button', className: 'btn btn-ghost', text: 'Discard' });
    var bar = el('div', { className: 'dirtybar', role: 'region', 'aria-label': 'Unsaved changes', hidden: true }, [note, el('div', { className: 'dirtybar-actions' }, [drop, save])]);
    var saving = false;
    function snap() { was = {}; fields().forEach(function (f) { was[f.name || f.id] = val(f); }); if (!saving) bar.hidden = true; }
    function check() { if (saving) return; bar.hidden = !fields().some(function (f) { return was[f.name || f.id] !== val(f); }); }
    /**
     * 1.24.3: the quiet "Saving…" state. The bar stays in sight with the words given and both buttons off until the page calls
     * idle() with the server's answer: the page may show the new values meanwhile, but only the server's answer says Saved.
     */
    function busy(text) { saving = true; bar.hidden = false; bar.classList.add('is-saving'); bar.setAttribute('aria-busy', 'true'); note.textContent = text || 'Saving…'; save.disabled = true; drop.disabled = true; }
    function idle() { saving = false; bar.classList.remove('is-saving'); bar.removeAttribute('aria-busy'); note.textContent = opts.text || 'You have unsaved changes.'; save.disabled = false; drop.disabled = false; check(); }
    drop.addEventListener('click', function () {
      fields().forEach(function (f) { var v = was[f.name || f.id]; if (v == null) return; if (f.type === 'checkbox' || f.type === 'radio') f.checked = v === 'true'; else f.value = v; });
      check(); if (opts.onDiscard) opts.onDiscard();
    });
    save.addEventListener('click', function () { if (opts.onSave) opts.onSave(snap); });
    form.addEventListener('input', check); form.addEventListener('change', check);
    form.appendChild(bar); snap();
    return { bar: bar, saved: snap, check: check, busy: busy, idle: idle, saving: function () { return saving; } };
  }
  window.CH_ADMIN.ui = { el: el, pill: pill, sortable: sortable, pager: pager, paged: paged, compareId: compareId, filter: filter, menu: menu, panel: panel, skeleton: skeleton, empty: empty, toast: toast, dirtyBar: dirtyBar };
})();
