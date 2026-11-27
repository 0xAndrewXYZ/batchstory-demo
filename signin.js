/*
 * Signing in on the admin pages: the guard, the account menu and the way to the sign-in page (2.0.0).
 *
 *  - Signing in happens on its own page, signin.html (signin-page.js): email or username and password, forgot
 *    password, choose a password from an emailed link. This file only sends people there and back.
 *  - After signing in the browser keeps {url, key: <sign-in token>, by: <name>, session: true} in localStorage
 *    "ch.admin", the same place an admin link goes, so every admin page works unchanged.
 *  - Any answer {signed_out: true} (signed out elsewhere, password reset, switched off, no longer an admin, 30 days up)
 *    clears "ch.admin" and goes to the sign-in page; {must_change: true} goes there to choose a new password, and
 *    {must_add_email: true} (2.0.3, an admin from before 2.0.0) to add their email.
 *  - A browser with no admin credential goes to the sign-in page when an admin-only page needs one. A page opened
 *    with a link (#connect=…: a worker's, or an admin link being checked) stays, says what is wrong, and shows a
 *    "Sign in (admins)" button.
 *
 * Pages call: CH_SIGNIN.show() when they have no admin credential, CH_SIGNIN.open() for a "Sign in" button, and
 * CH_SIGNIN.guard(answer) on every answer (it stops the page if the answer means "sign in again" or "choose a new password").
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {};
  var openedWithLink = /#connect=/.test(String(location.hash || '')); // read before the page tidies its address
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function icon(name, size) { return window.CH_ADMIN ? CH_ADMIN.icon(name, size) : null; }

  function cred() { var a = load('ch.admin', null); return a && a.key ? a : null; }
  function signedIn() { var a = cred(); return !!(a && a.session); }
  function address() {
    var a = cred(), s = load('ch.settings', {}) || {};
    var stored = (a && a.url) || s.url || '';
    return (C.site && C.scriptFor ? C.scriptFor(stored) : '') || C.scriptUrl || stored;
  }
  function post(body) {
    return fetch(address(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error('unexpected answer'); } });
  }

  /** Forgets this browser's sign-in, and the copies of admin-only data (prices, payments) kept for offline use. */
  function forget() { drop('ch.admin'); drop('ch.dash'); drop('ch.batchdata'); drop('ch.lists.queue'); if (window.CH_ADMIN && CH_ADMIN.memo) CH_ADMIN.memo.clear(); if (C.dropCopies) C.dropCopies(); } // 2.7.1: and every admin view's kept copy; 1.30.1: and the Answer choices changes not sent yet (they belong to this sign-in)
  var pageKey = (cred() || {}).key; // the sign-in this page was opened with
  /** A sign-in ended: forget it, unless another tab has meanwhile signed in afresh (then keep that one). */
  function forgetEnded() {
    var a = cred();
    if (a && pageKey && a.key !== pageKey) { if (window.CH_ADMIN && CH_ADMIN.memo) CH_ADMIN.memo.clear(); return false; }
    forget();
    return true;
  }

  /** This page's file name, for coming back after signing in (signin.html accepts only the admin pages). */
  function here() { var p = String(location.pathname || '').split('/').pop(); return p || 'dashboard.html'; }
  /** The sign-in page, with where to come back to and (from a fixed list) why. */
  function url(why, extra) { return 'signin.html?next=' + encodeURIComponent(here()) + (why ? '&why=' + why : '') + (extra || ''); }
  function go(why, extra) { location.replace(url(why, extra)); return new Promise(function () {}); }
  /** A "Sign in" button: always the sign-in page. */
  function open() { location.href = url(''); }

  /**
   * The page has no admin credential. No link of any kind in this browser: go and sign in. Another link (a worker's,
   * or an admin link still being checked): stay, show the page's own "Or use the admin link" box and a Sign in button.
   */
  function show(opts) {
    opts = opts || {};
    if (!cred() && !openedWithLink && !/#connect=/.test(String(location.hash || ''))) { go(opts.why || ''); return; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-signin-alt]'), function (n) { n.hidden = false; });
    addSignInButton();
  }
  function hide() {
    if (cred()) { var o = $('signin-open'); if (o) o.remove(); }
  }

  /** The script says this sign-in has ended: forget it and sign in again. */
  function signedOut() {
    if (!forgetEnded()) { location.reload(); return new Promise(function () {}); } // another tab signed in meanwhile
    return go('again');
  }
  /** This browser's admin link was the shared one, and the shared links were retired. */
  function retiredLink() { forget(); return go('retired'); }

  /**
   * For every answer from the script. Returns the answer, or (when it means "sign in again" or "choose a new
   * password first") goes to the sign-in page and returns a promise that never settles, so the page stops there.
   */
  function guard(j) {
    if (j && j.ok && j.company) company(j.company);
    if (j && j.ok && j.my_email_change && signedIn()) emailBanner(j.my_email_change); // 2.1.1
    if (j && j.signed_out && signedIn()) return signedOut();
    if (j && j.retired && cred() && !signedIn()) return retiredLink();
    if (j && j.admin_link && cred() && !signedIn()) { forget(); return go('admin_link'); } // 2.0.1: a personal key on an admin row
    if (j && j.must_change && signedIn()) return go('must');
    if (j && j.must_add_email && signedIn()) return go('email'); // 2.0.3: an admin with no email adds one first
    return j;
  }

  /**
   * 2.1.0: every answer names the company and its logo's version (Company settings). Keep them (config.js), and fetch the
   * logo once when its version changed. Only a small picture is ever used (CH_CONFIG.goodLogo checks).
   */
  var askedLogo = '';
  function company(c) {
    if (!C.setCompany || !C.setCompany(c)) return;
    var a = cred();
    if (!a || askedLogo === c.logo_v) return;
    askedLogo = c.logo_v;
    post({ key: a.key, action: 'read', what: 'company' }).then(function (r) { if (r && r.ok && r.company) C.setCompany(r.company); }).catch(function () { /* the next answer tries again */ askedLogo = ''; });
  }

  /**
   * 2.1.1: the person signed in had their sign-in email changed at another admin's request in the last 7 days. Every admin
   * page shows it with Undo, which puts the old email back, signs them out everywhere and pauses the account (2.1.2: no
   * link is sent; another admin or the owner sends one after checking with them).
   */
  function emailBanner(c) {
    var main = document.querySelector('main');
    if (!main || $('email-changed')) return;
    var d = new Date(c.applied_at);
    var day = isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'long' });
    var msg = el('p', { className: 'err', hidden: true });
    var undo = el('button', { type: 'button', className: 'btn btn-danger btn-sm', id: 'email-undo', text: 'Undo…' });
    var box = el('div', { className: 'notice-actions' }, [undo]);
    var n = el('div', { className: 'notice bad email-changed', id: 'email-changed', role: 'alert' }, [icon('triangle-alert', 20), el('div', { className: 'notice-body' }, [
      el('span', { className: 'notice-title', text: 'Your sign-in email was changed to ' + c.new_email + (day ? ' on ' + day : '') + ', at the request of ' + c.asked_by + '.' }),
      el('span', { text: 'If this wasn\'t you, undo it: your email goes back to ' + c.old_email + ', everyone signed in as you is signed out and your account is paused until another admin or the owner checks with you and sends you a new sign-in link.' }),
      box, msg,
    ])]);
    undo.addEventListener('click', function () {
      var id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'u-' + Date.now().toString(36);
      var yes = el('button', { type: 'button', className: 'btn btn-danger btn-sm', id: 'email-undo-yes', text: 'Yes, undo it' });
      var no = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Cancel', onclick: function () { box.replaceChildren(undo); } });
      yes.addEventListener('click', function () {
        var a = cred();
        if (!a) return;
        yes.disabled = true; yes.textContent = 'Undoing…'; msg.hidden = true;
        post({ key: a.key, action: 'admin_email_undo', entry_id: id, change_id: c.change_id }).then(function (r) {
          if (!r || !r.ok) throw new Error((r && r.error) || 'That did not go through. Try again.');
          forget(); go('undone');
        }).catch(function (e) { yes.disabled = false; yes.textContent = 'Yes, undo it'; msg.hidden = false; msg.textContent = String(e.message || e); });
      });
      box.replaceChildren(el('span', { text: 'You will be signed out here too.' }), no, yes);
    });
    var head = main.querySelector('.page-head');
    if (head && head.nextSibling) main.insertBefore(n, head.nextSibling); else main.insertBefore(n, main.firstChild);
  }

  /* ---------- the app bar ---------- */
  function tools() {
    var bar = document.querySelector('.appbar-in');
    if (!bar) return null;
    var t = bar.querySelector('.appbar-tools');
    if (!t) {
      if (!bar.querySelector('.spacer')) bar.appendChild(el('span', { className: 'spacer' }));
      t = el('div', { className: 'appbar-tools' });
      bar.appendChild(t);
    }
    return t;
  }
  function addSignInButton() {
    var t = tools();
    if (!t || $('signin-open')) return;
    t.appendChild(el('a', { className: 'btn btn-secondary btn-sm', id: 'signin-open', href: url(''), text: 'Sign in (admins)' }));
  }
  function signOut(btn) {
    var a = cred();
    btn.disabled = true; btn.textContent = 'Signing out…';
    var done = function () { forget(); location.replace(url('out')); };
    // This browser forgets the sign-in either way. If the script could not be told, the sign-in stays valid there
    // until it expires: say so once, so it can be ended with Change password (which ends all other sign-ins).
    var offline = function () {
      forget();
      try { sessionStorage.setItem('ch.signout-note', '1'); } catch (e) { /* ignore */ }
      location.replace(url(''));
    };
    (a && a.session ? post({ action: 'logout', key: a.key }).then(function (r) { if (r && r.ok === false && !r.signed_out) throw new Error('refused'); }) : Promise.resolve()).then(done, offline);
  }
  function changePassword() { location.href = url('', '&change=1'); }
  function addAccount(a) {
    var t = tools();
    if (!t) return;
    // 1.22.2: the menu under your name is about you: your profile (the password is changed there), how the pages look, and signing out.
    // Help and the switch to the field app have their own rows at the sidebar's foot; only where there is no sidebar (a phone, a tablet) are they here.
    var themes = [['light', 'Light'], ['dark', 'Dark'], ['', 'System']];
    var themeBox = el('div', { className: 'theme-pick', role: 'group', 'aria-label': 'Appearance', id: 'theme-menu' }, themes.map(function (t) {
      return el('button', { type: 'button', className: 'btn btn-secondary btn-sm', 'data-theme-pick': t[0], id: 'theme-' + (t[0] || 'auto'), text: t[1], onclick: function () { C.setTheme(t[0]); drawThemes(); } });
    }));
    function drawThemes() { var now = C.theme ? C.theme() : ''; Array.prototype.forEach.call(themeBox.children, function (b) { b.setAttribute('aria-pressed', (b.getAttribute('data-theme-pick') || '') === (now === 'light' || now === 'dark' ? now : '') ? 'true' : 'false'); }); }
    drawThemes();
    var menu = el('div', { className: 'account-menu card' }, [
      el('p', { className: 'account-who' }, ['Signed in as ', el('b', { text: a.by || 'admin' })]),
      el('a', { className: 'btn btn-ghost btn-sm', id: 'my-profile', href: 'settings.html#profile' }, [icon('user', 16), 'My profile']), // 2.1.0: name, email, password, sign out everywhere else
      el('p', { className: 'account-label', text: 'Appearance' }), themeBox,
      el('a', { className: 'btn btn-ghost btn-sm', id: 'help-menu', href: 'help.html' }, [icon('info', 16), 'Help']),
      el('a', { className: 'btn btn-ghost btn-sm', id: 'field-app-menu', href: 'index.html' }, [icon('tablet', 16), 'Switch to field app']), // 1.17.0: log entries as yourself
      el('button', { type: 'button', className: 'btn btn-secondary btn-sm', id: 'sign-out', onclick: function () { signOut(this); } }, [icon('log-out', 16), 'Sign out']),
    ]);
    var d = el('details', { className: 'account', id: 'account' }, [
      el('summary', { className: 'btn btn-secondary btn-sm', 'aria-label': 'Signed in as ' + (a.by || 'admin') + ': account menu' }, [
        icon('user', 16), el('span', { className: 'account-name' }, [el('span', { className: 'account-pre', text: 'Signed in as ' }), a.by || 'admin']), icon('chevron-down', 14),
      ]),
      menu,
    ]);
    d.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { d.open = false; d.querySelector('summary').focus(); } });
    // 1.24.0: in the sidebar the menu is fixed to the window (the sidebar scrolls and would clip it): it sits just above the name
    d.addEventListener('toggle', function () { if (d.open) menu.style.setProperty('--menu-bottom', Math.max(8, window.innerHeight - d.querySelector('summary').getBoundingClientRect().top + 4) + 'px'); });
    document.addEventListener('click', function (ev) { if (d.open && !d.contains(ev.target)) d.open = false; });
    // 1.17.0: the field app runs with this sign-in (the same name, every form the company has on); in the menu on a phone
    if (!$('field-app-link')) t.insertBefore(el('a', { className: 'appbar-link field-app-link', id: 'field-app-link', href: 'index.html' }, [icon('tablet', 16), 'Switch to field app']), t.firstChild);
    if (!$('help-link')) t.insertBefore(el('a', { className: 'appbar-link field-app-link help-link', id: 'help-link', href: 'help.html' }, [icon('info', 16), 'Help']), $('field-app-link').nextSibling); // 1.22.2: every explanation in one place
    t.appendChild(d);
    var foot = $('theme-toggle'); if (foot) foot.hidden = true; // the account menu has the dark/light item
  }

  /*
   * 1.21.0: a shared tablet (ch.settings.shared). An admin's sign-in lives only as long as their turn, which the field app
   * keeps in ch.turn (who, which kind, the last tap, the day end; never a secret). Here the page checks that turn: if it is
   * not an admin's, has gone idle or passed the day end, the sign-in is ended and forgotten, and the tablet goes back to
   * "Who's using this?". Taps on this page keep the turn going.
   */
  var tablet = load('ch.settings', {}) || {};
  if (tablet.shared && tablet.key) {
    var turnNow = load('ch.turn', null), adm = cred();
    var fresh = function (t) { return !!t && t.kind === 'admin' && Date.now() - Date.parse(t.last_tap) < (Number(t.idle_minutes) || 10) * 60000 && Date.now() < Date.parse(t.day_end); };
    var endHere = function () {
      var x = cred();
      if (x && x.session) post({ action: 'logout', key: x.key }).catch(function () { /* it ends by itself at its short expiry */ });
      forget(); drop('ch.turn');
      location.replace('index.html');
    };
    if (adm && (!fresh(turnNow) || adm.device !== tablet.device_id || (turnNow && adm.id && turnNow.user !== adm.id))) endHere(); // the page goes away
    var lastWrite = 0;
    ['pointerdown', 'keydown'].forEach(function (k) { document.addEventListener(k, function () {
      var t = load('ch.turn', null);
      if (!fresh(t)) { endHere(); return; }
      if (Date.now() - lastWrite > 5000) { lastWrite = Date.now(); t.last_tap = new Date().toISOString(); localStorage.setItem('ch.turn', JSON.stringify(t)); }
    }, true); });
    setInterval(function () { if (cred() && !fresh(load('ch.turn', null))) endHere(); }, 5000);
    // review fix (M6): back from the browser's page cache (Back after the turn ended) the page is checked again before it
    // shows: it is hidden as it goes, and shown only if the admin's turn is still on here
    window.addEventListener('pagehide', function () { if (document.body) document.body.style.visibility = 'hidden'; });
    window.addEventListener('pageshow', function () {
      var x = cred(), t = load('ch.turn', null);
      if (!x || !fresh(t) || x.device !== tablet.device_id || (x.id && t.user !== x.id)) { if (x) endHere(); else location.replace('index.html'); return; }
      if (document.body) document.body.style.visibility = '';
    });
  }

  var a = cred();
  if (a && a.session) {
    addAccount(a);
    // the script records a signed-in admin's changes under their own name, so it is not typed here
    var by = $('by');
    if (by) { by.value = a.by || ''; by.readOnly = true; by.title = 'You are signed in, so changes are recorded under your name.'; }
  } else if (!a) {
    addSignInButton();
  }

  window.CH_SIGNIN = { show: show, open: open, hide: hide, guard: guard, signedIn: signedIn, signedOut: signedOut, changePassword: changePassword, url: url, company: company };
})();
