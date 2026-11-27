/*
 * The sign-in page (signin.html, 2.0.0): sign in, forgot password, choose a password from an emailed link, an expired
 * link, and choosing a new password (after a temporary one, or from the account menu). Admins only.
 *
 * Token handling (reviewed line by line):
 *  - A set-password link is signin.html#set=p_…. The token is read from the address and the address is cleaned at once,
 *    before anything else runs or any request is made, so it never stays in the address bar, history or a bookmark.
 *    It is only ever sent to the script, in a POST body (link_check, then link_set_password).
 *  - After signing in the page keeps {url, key: <sign-in>, by: <name>, session: true} in localStorage "ch.admin" (as
 *    before 2.0.0, so every admin page works unchanged). Passwords are never stored or logged.
 *  - A cancel link (2.1.0) is signin.html#cancel=c_…, emailed to an admin's old address when another admin asks to change
 *    it. It is read and cleaned from the address the same way, and sent only in a POST body (email_change_check, then
 *    email_change_cancel once the person presses Cancel: opening the link alone changes nothing).
 *  - An undo link (2.1.1) is signin.html#undo=u_…, emailed to the old address after such a change applied; handled the same way
 *    (email_undo_check, then email_undo once the person presses the button). 2.1.2: it only pauses the account and never
 *    signs anyone in; another admin or the owner sends a new sign-in link after checking with the person.
 *  - ?next= says which page to go back to. Only the admin page names (and the season report), and "app" for the field app
 *    (1.17.0), are accepted; anything else (another site,
 *    a path, a script address) becomes dashboard.html. ?why= picks one of a fixed list of sentences; nothing from the
 *    address is ever shown as text or put into the page.
 */
(function () {
  'use strict';
  // 1. The link token first, and the address cleaned before anything else (no request has been made yet).
  var hash = String(location.hash || '');
  var setToken = (hash.match(/^#set=(p_[0-9a-f]{64})$/) || [])[1] || '';
  var cancelToken = (hash.match(/^#cancel=(c_[0-9a-f]{64})$/) || [])[1] || ''; // 2.1.0
  var undoToken = (hash.match(/^#undo=(u_[0-9a-f]{64})$/) || [])[1] || ''; // 2.1.1: "This wasn't me: undo", emailed to the old address
  var adminLink = /^#connect=[A-Za-z0-9_\-=]+$/.test(hash) ? hash : '';
  if (hash) try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* old browser: the hash stays, nothing is sent with it */ }

  var C = window.CH_CONFIG || {};
  var PAGES = ['dashboard.html', 'entries.html', 'labels.html', 'lists.html', 'people.html', 'settings.html', 'report.html', 'exports.html', 'finances.html']; // slice 4: exports.html; P3-A: finances.html
  var q = Object.create(null); // 1.17.1: no inherited names ("constructor", "__proto__") from the address
  String(location.search || '').replace(/^\?/, '').split('&').forEach(function (p) {
    var i = p.indexOf('='); if (i < 0) return;
    try { q[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { /* ignore a bad part */ }
  });
  // 1.17.0: next=app is the field app (index.html), so "Sign in" there comes back to it. Nothing else is taken from the address.
  var next = q.next === 'app' ? 'index.html' : PAGES.indexOf(q.next) >= 0 ? q.next : 'dashboard.html';
  var adminPage = next === 'index.html' ? 'dashboard.html' : next; // where a pasted or opened admin link is checked (never the field app, which would keep it as a phone's link)
  var WHY = {
    again: 'Please sign in again.',
    retired: 'The shared admin link has been retired. Sign in with your own email and password.',
    admin_link: 'Admins now sign in with their own email and password. Your old admin link no longer works.',
    out: 'Signed out.',
    admins: 'This page is for admins. Sign in to continue.',
    undone: 'Undone: your sign-in email is back and your account is paused. Everyone signed in as you was signed out and your password no longer works. Another admin or the owner will check with you, then send you a new sign-in link.',
  };

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function icon(name, size) { var t = document.createElement('span'); t.innerHTML = window.CH_ICON ? window.CH_ICON(name, size || 18) : ''; return t.firstChild; }
  Array.prototype.slice.call(document.querySelectorAll('i[data-icon]')).forEach(function (i) { var s = icon(i.getAttribute('data-icon'), Number(i.getAttribute('data-size')) || 18); if (s) i.replaceWith(s); else i.remove(); });

  function cred() { var a = load('ch.admin', null); return a && a.key ? a : null; }
  /** The tablet's next day end ("00:00", by its own clock), as turns.js nextDayEnd. */
  function dayEnd(t) { var m = String(t || '00:00').match(/^(\d\d):(\d\d)$/) || [0, '00', '00']; var d = new Date(); d.setHours(+m[1], +m[2], 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d; }
  function address() {
    var a = cred(), s = load('ch.settings', {}) || {};
    var stored = (a && a.url) || s.url || '';
    return (C.site && C.scriptFor ? C.scriptFor(stored) : '') || C.scriptUrl || stored; // this site's server first (config.js)
  }
  function post(body) {
    return fetch(address(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error('unexpected answer'); } });
  }
  var OFFLINE = 'No connection. Check the internet and try again.';

  /*
   * 2.4.6, speed. Google starts the script afresh after a quiet spell, which can take several seconds. wake() asks for the
   * script's version (no key, nothing sent but "version", nothing kept) as soon as the page opens, so that start happens
   * while the person types. warmNext() fetches the files of the page we go to next (its scripts, styles and font) while the
   * person types and while the password is checked, so that page opens at once. Only files of this site, named by that
   * page itself; nothing runs: the page is read as text and only <link rel="prefetch"> tags are added (allowed by the CSP).
   */
  var woke = false, warmed = false;
  function wake() {
    var u = address();
    if (woke || !u || !window.fetch) return;
    woke = true;
    fetch(u + '?action=version', { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'follow' }).catch(function () { /* only a head start */ });
  }
  function warmNext() {
    if (warmed || !window.fetch || !window.DOMParser) return;
    warmed = true;
    var page = next;
    var add = function (href) {
      if (!href || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || document.querySelector('link[rel="prefetch"][href="' + href.replace(/"/g, '') + '"]')) return; // this site's own files only
      var l = document.createElement('link');
      l.rel = 'prefetch'; l.href = href;
      if (/\.woff2$/.test(href)) { l.as = 'font'; l.crossOrigin = 'anonymous'; } // as the page's own preload asks for it, so it is used
      document.head.appendChild(l);
    };
    fetch(page, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
      if (!html) return;
      var doc = new DOMParser().parseFromString(html, 'text/html'); // an inert copy: nothing in it runs or loads
      Array.prototype.forEach.call(doc.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="preload"][href]'), function (n) { add(n.getAttribute('src') || n.getAttribute('href')); });
    }).catch(function () { /* only a head start */ });
  }
  // the person starts typing (or presses the button) in a sign-in, choose-a-password or add-your-email form
  ['input', 'submit'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { var f = e.target && e.target.closest ? e.target.closest('form') : null; if (f && /^(signin|set|pw|em)-form$/.test(f.id)) warmNext(); }, true);
  });
  function company() { return (C.brand && C.brand.company) || C.company || 'Cocoahead'; }
  function contact() { return C.contact || 'another admin'; }

  function field(id, label, attrs) { return el('div', { className: 'f' }, [el('label', { for: id, text: label }), el('input', Object.assign({ id: id }, attrs))]); }
  function errLine(id) { return el('p', { className: 'err', id: id, role: 'alert', hidden: true }); }
  function say(node, text) { node.textContent = text || ''; node.hidden = !text; }
  function why(text) { say($('signin-why-text'), text); $('signin-why').hidden = !text; }
  function screen(title, sub, kids) {
    $('signin-title').textContent = title;
    $('signin-sub').textContent = sub || ''; $('signin-sub').hidden = !sub;
    $('auth-body').replaceChildren.apply($('auth-body'), kids.filter(Boolean));
    if (C.applyBrand) C.applyBrand(document.getElementById('signin'));
  }
  function busy(btn, on, text) { btn.disabled = on; btn.textContent = text; }

  /**
   * Signed in: keep the sign-in where the admin link goes, then go straight back to the page that sent us here.
   * 2.4.6: a dashboard copy already in this browser ("ch.dash", "ch.batchdata") is kept, so the dashboard shows it at once
   * (marked "Offline copy") while it fetches a fresh one. Only an admin signs in, and an admin may see everything, so such
   * a copy never shows them more than they may see; signing out still forgets every copy (signin.js). A copy from another
   * server (another company, on a site not listed in config.js SITES) is deleted here (CH_CONFIG.keptCopy).
   */
  /**
   * 2.7.1: the dashboard's first data came with the sign-in: keep it as the dashboard's copy ("ch.dash", with the server and
   * sign-in it came from) and say it was read just now, so the dashboard draws it without a request of its own
   * (CH_CONFIG.justRead). "unchanged" means the copy this browser already holds is still right. Only an admin's answer.
   */
  function keepData(d, kept, c) {
    if (!d || d.ok !== true || d.admin !== true || !C.keepCopy || !C.justRead) return;
    if (d.unchanged === true) d = C.withCopy ? C.withCopy(d, kept) : null;
    if (!d || !d.tabs) return;
    C.keepCopy('ch.dash', d, c.url, c.key);
    C.justRead('ch.dash', c.key, true);
  }
  function finish(c) {
    if (c.turn) c.turn.at = new Date().toISOString(); // review fix (6): the field app's 2 minutes start now (after a new password or email too)
    save('ch.admin', c);
    if (c.device) { location.replace('index.html'); return; } // a shared tablet: the admin's turn starts in the field app (it checks the turn)
    if (C.keptCopy) { C.keptCopy('ch.dash', c.url, c.key, true); C.keptCopy('ch.batchdata', c.url, c.key, true); } // a copy from another server is deleted (2.4.6 review)
    try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf('ch.c.') === 0) sessionStorage.removeItem(k); }); } catch (e) { /* ignore */ }
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('ch.v.') === 0) localStorage.removeItem(k); }); } catch (e2) { /* ignore */ } // 2.7.1: the admin views' copies of an earlier sign-in
    location.replace(next);
  }

  /* ---------- sign in ---------- */
  function showSignIn(text) {
    why(text || '');
    var err = errLine('signin-err');
    var go = el('button', { type: 'submit', className: 'btn btn-primary btn-block', id: 'signin-go', text: 'Sign in' });
    var form = el('form', { id: 'signin-form', novalidate: true }, [
      field('signin-user', 'Email', { type: 'text', inputmode: 'email', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: '120', 'aria-describedby': 'signin-user-hint' }),
      el('p', { className: 'hint', id: 'signin-user-hint', text: 'Or the username you were given before.' }),
      field('signin-pass', 'Password', { type: 'password', name: 'password', autocomplete: 'current-password', maxlength: '200' }),
      err, go,
    ]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var user = $('signin-user').value.trim(), pass = $('signin-pass').value;
      if (!user || !pass) { say(err, 'Please type your email and password.'); (user ? $('signin-pass') : $('signin-user')).focus(); return; }
      if (!address()) { say(err, 'This page does not know where to sign in. Open the admin link once instead.'); return; }
      say(err, ''); busy(go, true, 'Signing in…');
      var body = { action: 'login', password: pass };
      if (user.indexOf('@') >= 0) body.email = user; else body.username = user;
      // 1.21.0: on a shared tablet the sign-in is short (to the tablet's day end, 12 hours at most) and comes with a turn
      var tablet = load('ch.settings', {}) || {};
      if (tablet.shared && tablet.key) { body.device = tablet.key; body.day_end_at = dayEnd((tablet.shared_device || {}).day_ends).toISOString(); }
      // 2.7.1: one request for signing in and the dashboard's first data, so the dashboard draws at once and sends nothing
      // itself (the script works the data out for this new sign-in, with every check a read has; an admin sees everything).
      // With the logo version this browser has, so a new logo comes with the answer instead of in a request of its own.
      var kept = null;
      if (!body.device) {
        if (C.logoVersion) body.logo_v = C.logoVersion();
        if (next === 'dashboard.html') {
          body.with = 'data';
          kept = C.keptCopy ? C.keptCopy('ch.dash', address(), '', true) : null;
          if (kept && kept.admin === true && C.sinceOf && C.sinceOf(kept)) body.since = C.sinceOf(kept).since;
        }
      }
      post(body).then(function (r) {
        busy(go, false, 'Sign in');
        if (!r.ok || !r.token) { say(err, r.error || 'Could not sign in.'); $('signin-pass').value = ''; $('signin-pass').focus(); return; }
        var c = { url: address(), key: r.token, by: (r.user && r.user.name) || user, id: (r.user && r.user.id) || '', session: true }; // id: the field app knows whose entries are whose (1.17.0)
        // 1.21.0: a shared tablet: which device, and the admin's turn secret for the field app to take into memory at once
        // (it removes it from storage as it starts the turn; it never stays there)
        if (body.device) { c.device = String(tablet.device_id || ''); c.expires = r.expires || ''; if (r.turn && /^[0-9a-f]{64}$/.test(String(r.turn.secret))) c.turn = { kind: 'admin', secret: String(r.turn.secret), sref: String(r.turn.sref || ''), dgen: Number(r.turn.dgen) || 1, at: new Date().toISOString() }; } // review fix (item 4): the field app takes it within 2 minutes, or never
        if (r.company && C.setCompany) C.setCompany(r.company); // 2.1.0: the company's own name and logo version (the next page fetches the logo)
        if (r.must_change) { showChange({ cred: c, must: true, username: user, addEmail: !!r.must_add_email }); return; }
        if (r.must_add_email) { showAddEmail({ cred: c, password: pass }); return; } // 2.0.3: an admin with no email adds one first
        keepData(r.data, kept, c);
        finish(c);
      }).catch(function () { busy(go, false, 'Sign in'); say(err, OFFLINE); });
    });
    var paste = el('input', { type: 'text', id: 'connect-link', placeholder: 'Paste the admin link', 'aria-label': 'Admin link', autocomplete: 'off' });
    var other = el('details', { className: 'auth-other', id: 'connect' }, [
      el('summary', { text: 'Use an admin link instead' }),
      el('p', { className: 'hint', text: 'If you have an admin link from the Sheet\'s menu, paste it here.' }),
      el('div', { className: 'inline-form' }, [paste, el('button', { type: 'button', className: 'btn btn-secondary', id: 'connect-btn', text: 'Use it', onclick: function () {
        var m = String(paste.value || '').match(/#connect=[A-Za-z0-9_\-=]+/);
        if (!m) { paste.value = ''; say(err, 'That is not an admin link.'); return; }
        location.replace(adminPage + m[0]); // the page checks the link with the script and keeps it only if it is an admin's
      } })]),
    ]);
    screen('Sign in to ' + company(), 'For admins.', [form,
      el('p', { className: 'auth-links' }, [el('button', { type: 'button', className: 'btn btn-link', id: 'forgot-open', text: 'Forgot password?', onclick: function () { showForgot($('signin-user').value.trim()); } })]),
      other]);
    $('signin-user').focus();
  }

  /* ---------- forgot password ---------- */
  function showForgot(email) {
    why('');
    var err = errLine('forgot-err');
    var go = el('button', { type: 'submit', className: 'btn btn-primary btn-block', id: 'forgot-go', text: 'Send me a link' });
    var form = el('form', { id: 'forgot-form', novalidate: true }, [
      field('forgot-email', 'Email', { type: 'email', name: 'email', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '120', value: email && email.indexOf('@') >= 0 ? email : '' }),
      err, go,
    ]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var e = $('forgot-email').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { say(err, 'Please type your email address.'); $('forgot-email').focus(); return; }
      say(err, ''); busy(go, true, 'Sending…');
      post({ action: 'forgot_password', email: e }).then(function (r) {
        // the same answer for every email: whether it belongs to an admin is never shown
        screen('Check your email', '', [
          el('p', { className: 'notice ok', id: 'forgot-done', role: 'status' }, [icon('mail', 20), el('span', { text: (r && r.ok && r.message) || 'If that email belongs to an admin, a link is on its way. It works for 1 hour.' })]),
          el('p', { className: 'hint', text: 'No email after a few minutes? Look in spam, or ask ' + contact() + '. Your password has not changed.' }),
          el('button', { type: 'button', className: 'btn btn-secondary', id: 'back-signin', text: 'Back to sign in', onclick: function () { showSignIn(); } }),
        ]);
      }).catch(function () { busy(go, false, 'Send me a link'); say(err, OFFLINE); });
    });
    screen('Forgot your password?', 'Type your email. If it belongs to an admin, we send a link to choose a new password.', [form,
      el('p', { className: 'auth-links' }, [el('button', { type: 'button', className: 'btn btn-link', id: 'back-signin', text: 'Back to sign in', onclick: function () { showSignIn(); } })])]);
    $('forgot-email').focus();
  }

  /* ---------- choose a password (from an emailed link) ---------- */
  function newPasswordFields(prefix, hiddenUser) {
    return [
      // a hidden username helps password managers save the new password under the right name
      el('input', { type: 'text', name: 'username', autocomplete: 'username', value: hiddenUser || '', hidden: true, 'aria-hidden': 'true', tabindex: '-1' }),
      field(prefix + '-new', 'New password', { type: 'password', autocomplete: 'new-password', maxlength: '200', 'aria-describedby': prefix + '-hint' }),
      el('p', { className: 'hint', id: prefix + '-hint', text: 'At least 10 characters. A few ordinary words in a row are easy to remember and hard to guess.' }),
      field(prefix + '-again', 'New password again', { type: 'password', autocomplete: 'new-password', maxlength: '200' }),
    ];
  }
  function checkNew(prefix, err) {
    var a = $(prefix + '-new').value, b = $(prefix + '-again').value;
    if (a.length < 10) { say(err, 'Choose a password of at least 10 characters.'); $(prefix + '-new').focus(); return ''; }
    if (a !== b) { say(err, 'The two new passwords are not the same. Type them again.'); $(prefix + '-again').value = ''; $(prefix + '-again').focus(); return ''; }
    return a;
  }
  function showSetLink() {
    why('');
    screen('Checking your link…', '', [el('p', { className: 'card-sub', text: 'One moment.' })]);
    post({ action: 'link_check', token: setToken }).then(function (r) {
      if (!r.ok) { showExpired(); return; }
      var err = errLine('set-err');
      var go = el('button', { type: 'submit', className: 'btn btn-primary btn-block', id: 'set-go', text: 'Save and sign in' });
      var form = el('form', { id: 'set-form', novalidate: true }, newPasswordFields('set', r.email || r.username || '').concat([err, go]));
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var pw = checkNew('set', err);
        if (!pw) return;
        say(err, ''); busy(go, true, 'Saving…');
        post({ action: 'link_set_password', token: setToken, new_password: pw }).then(function (s) {
          busy(go, false, 'Save and sign in');
          if (s.expired) { showExpired(); return; }
          if (!s.ok || !s.token) { say(err, s.error || 'That did not go through. Try again.'); return; }
          setToken = ''; // used: never sent again
          finish({ url: address(), key: s.token, by: (s.user && s.user.name) || r.name || '', id: (s.user && s.user.id) || '', session: true });
        }).catch(function () { busy(go, false, 'Save and sign in'); say(err, OFFLINE); });
      });
      screen('Choose a password', 'Hello ' + (r.name || '') + '. Choose the password you will sign in with' + (r.email ? ', with ' + r.email : '') + '.', [form]);
      $('set-new').focus();
    }).catch(function () {
      screen('No connection', '', [el('p', { className: 'notice warn', role: 'status', text: OFFLINE }),
        el('button', { type: 'button', className: 'btn btn-secondary', id: 'set-retry', text: 'Try again', onclick: showSetLink })]);
    });
  }
  function showExpired() {
    setToken = '';
    why('');
    screen('This link has expired', '', [
      el('p', { className: 'notice warn', id: 'expired', role: 'status' }, [icon('clock', 20), el('span', { text: 'Links to choose a password work once, for a short time. This one was already used or is too old.' })]),
      el('button', { type: 'button', className: 'btn btn-primary btn-block', id: 'expired-new', text: 'Send me a new one', onclick: function () { showForgot(''); } }),
      el('p', { className: 'auth-links' }, [el('button', { type: 'button', className: 'btn btn-link', id: 'back-signin', text: 'Back to sign in', onclick: function () { showSignIn(); } })]),
    ]);
  }

  /* ---------- choose a new password (after a temporary one, or from the account menu) ---------- */
  function showChange(opts) {
    var must = !!opts.must, cr = opts.cred || cred();
    if (!cr || !cr.session) { showSignIn(WHY.again); return; }
    why('');
    var err = errLine('pw-err');
    var go = el('button', { type: 'submit', className: 'btn btn-primary btn-block', id: 'pw-go', text: must ? 'Save and continue' : 'Save new password' });
    var fields = newPasswordFields('pw', opts.username || cr.by || '');
    if (!must) fields.splice(1, 0, field('pw-old', 'Current password', { type: 'password', autocomplete: 'current-password', maxlength: '200' }));
    var form = el('form', { id: 'pw-form', novalidate: true }, fields.concat([err, go]));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var old = must ? '' : $('pw-old').value;
      if (!must && !old) { say(err, 'Please type your current password.'); $('pw-old').focus(); return; }
      var pw = checkNew('pw', err);
      if (!pw) return;
      say(err, ''); busy(go, true, 'Saving…');
      post({ action: 'change_password', key: cr.key, old_password: old, new_password: pw }).then(function (r) {
        busy(go, false, must ? 'Save and continue' : 'Save new password');
        if (r.signed_out) { drop('ch.admin'); showSignIn(WHY.again); return; }
        if (!r.ok) { say(err, r.error || 'That did not go through. Try again.'); return; }
        if (must && opts.addEmail) { showAddEmail({ cred: cr, password: pw }); return; }
        if (must) { finish(cr); return; }
        screen('Password changed', r.ended ? 'Your other sign-ins (other browsers) were signed out. This one keeps working.' : 'Use it the next time you sign in.', [
          el('button', { type: 'button', className: 'btn btn-primary', id: 'pw-done', text: 'Done', onclick: function () { location.replace(next); } }),
        ]);
        $('pw-done').focus();
      }).catch(function () { busy(go, false, must ? 'Save and continue' : 'Save new password'); say(err, OFFLINE); });
    });
    screen(must ? 'Choose a new password' : 'Change your password', must
      ? 'Hello ' + (cr.by || '') + '. You signed in with a temporary password. Choose your own now; only you will know it.'
      : 'Your other sign-ins will be signed out. This one keeps working.', [form,
      must ? null : el('p', { className: 'auth-links' }, [el('a', { className: 'btn btn-link', href: next, text: 'Cancel' })])]);
    (must ? $('pw-new') : $('pw-old')).focus();
  }

  /* ---------- add your email (2.0.3: admins from before 2.0.0, once, before anything else) ---------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function showAddEmail(opts) {
    var cr = opts.cred || cred();
    if (!cr || !cr.session) { showSignIn(WHY.again); return; }
    var known = opts.password || ''; // the password just typed on this page (kept only in memory, for this one request)
    why('');
    var id = uuid(); // one ID for this screen: pressing Save twice changes the email once
    var err = errLine('em-err');
    var go = el('button', { type: 'submit', className: 'btn btn-primary btn-block', id: 'em-go', text: 'Save and continue' });
    var fields = [field('em-email', 'Your email', { type: 'email', name: 'email', autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false', maxlength: '120', 'aria-describedby': 'em-hint' }),
      el('p', { className: 'hint', id: 'em-hint', text: 'You will sign in with it, and password links go there. Only you can change it later.' })];
    if (!known) fields.push(field('em-pass', 'Your password', { type: 'password', autocomplete: 'current-password', maxlength: '200' }));
    var form = el('form', { id: 'em-form', novalidate: true }, fields.concat([err, go]));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var e = $('em-email').value.trim(), pw = known || ($('em-pass') ? $('em-pass').value : '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { say(err, 'Please type your email address.'); $('em-email').focus(); return; }
      if (!pw) { say(err, 'Please type your password.'); $('em-pass').focus(); return; }
      say(err, ''); busy(go, true, 'Saving…');
      post({ action: 'add_email', key: cr.key, entry_id: id, email: e, password: pw }).then(function (r) {
        busy(go, false, 'Save and continue');
        if (r.signed_out) { drop('ch.admin'); showSignIn(WHY.again); return; }
        if (r.ok && (r.status === 'saved' || r.status === 'duplicate')) { finish(cr); return; }
        if (r.wrong_password && known) { known = ''; showAddEmail({ cred: cr }); say($('em-err'), r.error); return; }
        id = r.retry ? id : uuid();
        say(err, r.error || 'That did not go through. Try again.');
      }).catch(function () { busy(go, false, 'Save and continue'); say(err, OFFLINE); });
    });
    screen('Add your email', 'Hello ' + (cr.by || '') + '. Admins now sign in with their email. Add yours once, then carry on.', [form]);
    $('em-email').focus();
  }

  /* ---------- cancel an email change (2.1.0: the link emailed to an admin's old address) ---------- */
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }); }
  function cancelDone(title, cls, text) {
    cancelToken = '';
    screen(title, '', [
      el('p', { className: 'notice ' + cls, id: 'cancel-result', role: 'status' }, [icon(cls === 'ok' ? 'circle-check' : 'clock', 20), el('span', { text: text })]),
      el('button', { type: 'button', className: 'btn btn-secondary', id: 'back-signin', text: 'Go to sign in', onclick: function () { showSignIn(); } }),
    ]);
  }
  function showCancel() {
    why('');
    screen('Checking your link…', '', [el('p', { className: 'card-sub', text: 'One moment.' })]);
    post({ action: 'email_change_check', token: cancelToken }).then(function (r) {
      if (r.ok && r.company && C.setCompany) C.setCompany(r.company); // the company's own name on the card
      if (!r.ok) { cancelDone(r.too_late ? 'Too late to cancel' : 'This link has expired', 'warn', r.error || 'This link has expired.'); return; }
      var err = errLine('cancel-err');
      var go = el('button', { type: 'button', className: 'btn btn-danger btn-block', id: 'cancel-go', text: 'Cancel the change' });
      go.addEventListener('click', function () {
        busy(go, true, 'Cancelling…'); say(err, '');
        post({ action: 'email_change_cancel', token: cancelToken }).then(function (x) {
          if (x.ok) { cancelDone('Cancelled', 'ok', x.message || 'Cancelled. Your sign-in email stays as it was.'); return; }
          if (x.retry) { busy(go, false, 'Cancel the change'); say(err, x.error || 'Busy just now. Try again in a moment.'); return; }
          cancelDone(x.too_late ? 'Too late to cancel' : 'This link has expired', 'warn', x.error || 'This link has expired.');
        }).catch(function () { busy(go, false, 'Cancel the change'); say(err, OFFLINE); });
      });
      screen('Cancel the email change?', 'Hello ' + (r.name || '') + '. ' + (r.asked_by || 'Another admin') + ' asked to change your sign-in email to ' + (r.new_email || '') + '. ' +
        (r.overdue ? 'It was due on ' + when(r.applies_at) + ', but it has not happened yet, so you can still cancel it.' : 'It changes on ' + when(r.applies_at) + ' unless you cancel it.'), [
        el('p', { className: 'hint', text: 'If you did not ask for this, press Cancel. Your email and password stay as they are.' }),
        err, go,
        el('p', { className: 'auth-links' }, [el('button', { type: 'button', className: 'btn btn-link', id: 'cancel-keep', text: 'I asked for it: keep the change', onclick: function () { cancelDone('Nothing changed yet', 'ok', 'The change goes ahead as planned. You can still cancel it from this email until then.'); } })]),
      ]);
      go.focus();
    }).catch(function () {
      screen('No connection', '', [el('p', { className: 'notice warn', role: 'status', text: OFFLINE }),
        el('button', { type: 'button', className: 'btn btn-secondary', id: 'cancel-retry', text: 'Try again', onclick: showCancel })]);
    });
  }

  /* ---------- undo an email change (2.1.1: the link emailed to the old address after it applied) ---------- */
  function showUndo() {
    why('');
    screen('Checking your link…', '', [el('p', { className: 'card-sub', text: 'One moment.' })]);
    post({ action: 'email_undo_check', token: undoToken }).then(function (r) {
      if (r.ok && r.company && C.setCompany) C.setCompany(r.company);
      if (!r.ok) { undoToken = ''; cancelDone(r.stale ? 'This link no longer applies' : 'This link has expired', 'warn', r.error || 'This link has expired.'); return; }
      var err = errLine('undo-err');
      var go = el('button', { type: 'button', className: 'btn btn-danger btn-block', id: 'undo-go', text: 'Undo it and secure my account' });
      go.addEventListener('click', function () {
        busy(go, true, 'Undoing…'); say(err, '');
        post({ action: 'email_undo', token: undoToken }).then(function (x) {
          if (x.ok) { undoToken = ''; drop('ch.admin'); cancelDone('Undone: your account is paused', 'ok', x.message || 'Undone.'); return; }
          if (x.retry) { busy(go, false, 'Undo it and secure my account'); say(err, x.error || 'Busy just now. Try again in a moment.'); return; }
          undoToken = ''; cancelDone(x.stale ? 'This link no longer applies' : 'This link has expired', 'warn', x.error || 'This link has expired.');
        }).catch(function () { busy(go, false, 'Undo it and secure my account'); say(err, OFFLINE); });
      });
      screen('Was this you?', 'Hello ' + (r.name || '') + '. Your sign-in email was changed from ' + (r.old_email || '') + ' to ' + (r.new_email || '') + ' on ' + when(r.applied_at) + ', as ' + (r.asked_by || 'another admin') + ' asked.', [
        el('ul', { className: 'hint undo-list' }, [
          el('li', { text: 'Your email goes back to ' + (r.old_email || 'the old one') + '.' }),
          el('li', { text: 'Everyone signed in as you is signed out, and your password stops working. Your account is paused.' }),
          el('li', { text: 'This does not sign you in, and no link is sent. Every admin is told; another admin or the owner checks with you, then sends you a new sign-in link.' }),
        ]),
        err, go,
        el('p', { className: 'auth-links' }, [el('button', { type: 'button', className: 'btn btn-link', id: 'undo-keep', text: 'It was me: keep it', onclick: function () { undoToken = ''; cancelDone('Nothing changed', 'ok', 'Your new email stays. The link keeps working for 7 days if you change your mind.'); } })]),
      ]);
      go.focus();
    }).catch(function () {
      screen('No connection', '', [el('p', { className: 'notice warn', role: 'status', text: OFFLINE }),
        el('button', { type: 'button', className: 'btn btn-secondary', id: 'undo-retry', text: 'Try again', onclick: showUndo })]);
    });
  }

  /* ---------- which screen ---------- */
  var a = cred();
  if (!adminLink && !(a && a.session && !q.why)) wake(); // 2.4.6: unless we leave at once
  if (undoToken) showUndo();
  else if (cancelToken) showCancel();
  else if (setToken) showSetLink();
  else if (adminLink) location.replace(adminPage + adminLink); // an admin link opened here: the page it is for checks it
  else if (/^#set=/.test(hash)) showExpired(); // a link that does not even look right
  else if (/^#undo=/.test(hash)) cancelDone('This link has expired', 'warn', 'This link has expired or was already used. Ask another admin or the owner for help.');
  else if (/^#cancel=/.test(hash)) cancelDone('This link has expired', 'warn', 'This link has expired, was already used, or the change was already cancelled.');
  else if ((q.why === 'must' || q.change === '1') && a && a.session) showChange({ must: q.why === 'must' });
  else if (q.why === 'email' && a && a.session) showAddEmail({});
  else if (a && a.session && !q.why) location.replace(next); // already signed in
  else {
    var note = null; try { note = sessionStorage.getItem('ch.signout-note'); sessionStorage.removeItem('ch.signout-note'); } catch (e) { /* ignore */ }
    showSignIn(note ? 'Signed out on this computer, but the sign-in could not be ended everywhere because there was no connection. If this computer might be lost or shared, sign in and use Change password: that ends every other sign-in.' : (Object.prototype.hasOwnProperty.call(WHY, q.why) ? WHY[q.why] : ''));
  }
  window.__signin = { next: next };
})();
