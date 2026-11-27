/*
 * People page (admins): one line per person in a table (search, filters, tabs for Active / Switched off / Shared links).
 * "Invite person" and each person open in the side panel: invite by email or link with what they do, edit or rename,
 * send a new link, switch off, and see who asked for a new link. The script makes every link and shows it once; this page
 * only asks. Only a scrambled copy (hash) of each link and key is kept, so a link cannot be looked up again: press
 * "Send a new link" instead. A worker's link is a short join link (#join=…); the key itself never leaves the phone.
 * Every permission is checked by the script; this page only leaves out what would be refused.
 */
(function () {
  'use strict';

  /* ---------- connection (same as the Entries page) ---------- */
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  var settings = load('ch.admin', {});
  if (!settings.by) settings.by = (load('ch.settings', {}) || {}).person || '';
  function goodUrl(u) { return window.CH_CONFIG && CH_CONFIG.goodScriptUrl ? CH_CONFIG.goodScriptUrl(u) : /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '')); }
  function badLink() {
    var p = document.getElementById('problem'), t = document.getElementById('problem-text');
    if (p && t) { t.textContent = 'That link does not belong to this app, so it was not used. Ask for a new one.'; p.hidden = false; }
  }
  function readConnect(text) {
    var m = String(text || '').match(/#connect=([A-Za-z0-9_\-=]+)/);
    if (!m) return false;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }))) /* UTF-8, so names like José survive */;
      if (!j.url || !j.key) return false;
      if (!goodUrl(j.url)) { badLink(); return false; } // a link that points anywhere but our server is never kept
      settings.url = j.url; settings.key = j.key; settings.unconfirmed = true; // kept only once the Sheet confirms it is the admin link
      if (j.name) settings.by = j.name;
      return true;
    } catch (e) { return false; }
  }
  readConnect(location.hash);

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
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function icon(name, size) { return window.CH_ADMIN ? CH_ADMIN.icon(name, size) : null; }
  var ui = window.CH_ADMIN.ui; // the shared table, menu, panel and pill (admin.js)
  var toastT;
  function toast(msg) { var t = $('toast'); t.replaceChildren(icon('circle-check', 18), document.createTextNode(msg)); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 4000); }
  function readJson(r) {
    return r.text().then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('No connection. Try again.'); }
      return window.CH_SIGNIN ? CH_SIGNIN.guard(j) : j; // "Please sign in again" shows the sign-in instead
    });
  }
  // Everything goes by POST to this site's server (config.js; the link's address only on a site not listed there),
  // so the key or sign-in never goes in a web address.
  function address() { return window.CH_CONFIG && CH_CONFIG.scriptFor ? CH_CONFIG.scriptFor(settings.url) : settings.url; }
  function ask(body) { return fetch(address(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(readJson); }
  function get(what, extra) {
    var body = { key: settings.key, action: 'read', what: what };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return ask(body);
  }
  function post(body) {
    body.key = settings.key;
    body.by = settings.by || 'Admin';
    return ask(body);
  }

  /* ---------- words ---------- */
  var C = window.CH_CONFIG || {};
  var AREAS = ['fermentation', 'roasting', 'making'];
  var NAMES = Object.assign({ fermentation: 'Fermentation', roasting: 'Roasting', making: 'Making' }, C.areas || {}); // the script's names win (S.areaNames)
  function areaName(a) { return (S.areaNames && S.areaNames[a]) || NAMES[a] || a; }
  /** 2.3.0: an area the company switched off (Settings → What you track) has no tick box. A person keeps it: nothing is taken away. */
  function areaOn(a) { return !C.areaOn || C.areaOn(a); }
  /** What a person does, from their ticks: "Fermentation, Roasting", "Admin", "Dashboard only". */
  function doesWords(u) {
    if (u.admin || u.role === 'admin') return 'Admin';
    var a = (u.areas || []).map(areaName);
    return a.length ? a.join(', ') : 'Dashboard only';
  }
  var AREA_HINT = {
    fermentation: 'farm and fermentation forms', roasting: 'roasting, winnowing, packing and shipping forms (works on a tablet with no signal)', making: 'forms to check in packages that arrive and start and finish chocolate batches',
  };
  function day(iso) {
    var d = new Date(iso);
    return CH_PAGE.dayText(d);
  }
  function dayTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : day(iso) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  /** "s…@example.com": enough to recognise, not the whole address on a shared screen. */
  function shortEmail(e) { var m = String(e || '').match(/^(.)(.*)(@.*)$/); return m ? m[1] + '…' + m[3] : String(e || ''); }
  var WHY = { 'admin limit': 'you have sent 30 emails today, the most for one admin', 'person limit': 'they were already sent 3 emails today', limit: 'the daily email limit was reached', address: 'the address was not accepted', error: 'the email could not be sent', 'no email': 'there is no email address' };

  /* ---------- state ---------- */
  var S = { users: [], me: '', busy: false, attempt: null, shared: null, session: false, areaNames: null, mail: null };

  /** What a users answer (or its kept copy) says, into S. */
  function take(res) {
    S.users = res.users || [];
    S.me = res.me || '';
    S.shared = res.shared || null; S.session = !!res.session; S.suspended = !!res.suspended;
    S.areaNames = res.area_names || null; S.mail = res.mail || null;
    S.devices = res.shared_devices || []; // 2.7.0
    S.at = res.at;
  }
  function fetchAll() {
    if (!settings.url || !settings.key) { showConnect(); return Promise.resolve(); }
    var A = window.CH_ADMIN, M = A && A.memo;
    // 2.7.1: the last copy at once (it was never drawn before: S.users starts as an empty list); the fresh one replaces it below
    var q = M && !settings.unconfirmed && !S.loaded && M.get('users', settings.key);
    if (q && q.data && Array.isArray(q.data.users)) { $('connect').hidden = true; $('main').hidden = false; take(q.data); draw(); }
    else if (!S.loaded && !settings.unconfirmed) { // no copy yet: the tabs, the search and the table's head at once, only the rows wait
      $('connect').hidden = true; $('main').hidden = false;
      if (!$('people').firstChild && ui) $('people').replaceChildren(el('tr', { className: 'skel-row' }, [el('td', { colspan: '8' }, [ui.skeleton('rows', 4)])]));
    }
    if (A && A.updated) A.updated($('updated'), S.at || (q && q.data && q.data.at), true); else $('updated').textContent = 'Loading…';
    return get('users').then(function (res) {
      $('loading').hidden = true;
      if (res.retired) { showConnect('The shared admin link has been retired. Sign in with your own username and password.'); return; }
      if (res.revoked) { showConnect('This link was switched off. Ask another admin for a new one.'); return; }
      if (!res.ok && (res.bad_key || /Wrong or missing app key/.test(res.error || ''))) {
        showConnect('The Sheet does not recognise this admin link. If its script was just updated, redeploy it (Apps Script → Deploy → Manage deployments → ✏️ → Version: New version → Deploy), then open a fresh admin link from the Cocoahead menu.');
        return;
      }
      if (!res.ok) { showConnect('This browser has an ordinary setup link, which can log entries but not manage people.'); return; }
      if (!res.users) { showConnect('The Sheet is running an older version of its script. Redeploy it (Apps Script → Deploy → Manage deployments → ✏️ → Version: New version → Deploy).'); return; }
      if (settings.unconfirmed) { delete settings.unconfirmed; save('ch.admin', settings); if (window.CH_ADMIN) CH_ADMIN.showTabs(); }
      if (/#connect=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
      if (window.CH_SIGNIN) CH_SIGNIN.hide(); // an admin link that works: no sign-in needed
      $('connect').hidden = true; $('problem').hidden = true; $('main').hidden = false;
      take(res); S.loaded = true;
      if (M) M.put('users', settings.key, res);
      if (A && A.updated) A.updated($('updated'), res.at, false); else $('updated').textContent = 'Updated ' + new Date(res.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      draw();
    }).catch(function (err) {
      if (A && A.updated) A.updated($('updated'), S.loaded || q ? S.at : null, false); else $('updated').textContent = '';
      $('loading').hidden = true;
      if (!S.loaded && !q) $('main').hidden = true;
      $('problem').hidden = false;
      $('problem-text').textContent = 'Could not load the people (' + (err.message || err) + '). Check the internet connection and press Refresh.';
    });
  }

  function showConnect(why) {
    if (window.CH_SIGNIN) CH_SIGNIN.show(); // admins sign in; the admin link stays as another way in
    $('connect').hidden = false;
    $('main').hidden = true; $('loading').hidden = true; $('invite-open').hidden = true;
    $('updated').textContent = '';
    if (INVITE) INVITE.close();
    if (VIEW) VIEW.panel.close();
    if (why) { $('problem').hidden = false; $('problem-text').textContent = why; }
  }

  /* ---------- the shared links (their own tab): when each was last used, retire, switch back on ---------- */
  var WEEK = 7 * 864e5;
  function ago(t) {
    var d = Date.now() - new Date(t).getTime();
    return d < 864e5 * 1.5 ? 'today or yesterday' : Math.floor(d / 864e5) + ' days ago';
  }
  /** One figure of the strip: label, value (a muted dash when there is none), note. */
  function stat(label, value, note) {
    var v = el('span', { className: 'stat-v', text: value || '' });
    if (!value) CH_ADMIN.none(v);
    return el('li', {}, [el('span', { className: 'stat-l', text: label }), v, el('span', { className: 'stat-n', text: note || '' })]);
  }
  /** Paused by Batchstory: say so, and leave only what still works (the list; the export is on the Exports page). */
  function drawPaused() {
    $('paused-banner').hidden = !S.suspended;
    $('paused-title').textContent = company() + ' is paused by Batchstory.';
    $('invite-open').hidden = !!S.suspended;
    $('shared-actions').hidden = !!S.suspended;
  }

  function drawShared() {
    var sh = S.shared;
    $('ptab-shared').hidden = !sh; // an older script, or no shared links: no tab
    if (!sh) return;
    $('shared-cells').replaceChildren(
      stat('Status', sh.retired ? 'Retired' : 'On', sh.retired ? 'since ' + day(sh.retired_at) : 'both links work'),
      stat('Phone setup link', sh.setup_last_used ? day(sh.setup_last_used) : '', sh.setup_last_used ? 'last used ' + ago(sh.setup_last_used) : 'no use noted'),
      stat('Admin link', sh.admin_last_used ? day(sh.admin_last_used) : '', sh.admin_last_used ? 'last used ' + ago(sh.admin_last_used) : 'no use noted')
    );
    var box = $('shared-confirm');
    box.hidden = true;
    var btn = el('button', { type: 'button', className: 'btn btn-secondary', id: sh.retired ? 'shared-on' : 'shared-retire', text: sh.retired ? 'Switch shared links back on…' : 'Retire shared links…' });
    btn.addEventListener('click', function () { askShared(!sh.retired, box, btn); });
    if (!S.session) btn.disabled = true;
    var kids = [btn];
    if (!S.session) kids.push(el('span', { className: 'hint', id: 'shared-signin', text: 'Sign in with your own email and password to change this. The shared admin link cannot.' }));
    $('shared-actions').replaceChildren.apply($('shared-actions'), kids);
  }

  function askShared(retire, box, btn) {
    if (S.busy) return;
    var sh = S.shared || {};
    var actionId = uuid(); // pressing "Yes" again after a failed try is safe: the Sheet does it once
    var recent = retire && [sh.setup_last_used, sh.admin_last_used].some(function (t) { return t && Date.now() - new Date(t).getTime() < WEEK; });
    var yes = el('button', { type: 'button', className: retire ? 'btn btn-danger' : 'btn btn-primary', id: 'shared-yes', text: retire ? 'Yes, retire them' : 'Yes, switch them back on' });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { endBox(box, btn); } });
    var msg = el('p', { className: 'err', hidden: true });
    var tick = null;
    if (recent) {
      var input = el('input', { type: 'checkbox', id: 'shared-tick' });
      input.addEventListener('change', function () { yes.disabled = !input.checked; });
      tick = el('label', { className: 'check', for: 'shared-tick' }, [input, el('span', { text: 'A shared link was used in the last 7 days. I understand those phones will stop sending until they get their own link.' })]);
      yes.disabled = true;
    }
    yes.addEventListener('click', function () {
      if (S.busy || yes.disabled) return;
      S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = retire ? 'Retiring…' : 'Switching on…';
      post({ action: retire ? 'retire_shared' : 'restore_shared', entry_id: actionId }).then(function (r) {
        S.busy = false;
        if (!r.ok) throw new Error(r.error || 'The Sheet refused.');
        toast(retire ? 'The shared links are retired.' : 'The shared links work again.');
        fetchAll();
      }).catch(function (err) {
        S.busy = false; yes.disabled = false; no.disabled = false; yes.textContent = 'Try again';
        msg.hidden = false; msg.textContent = String(err.message || err) + ' (Pressing it again is safe: it is never done twice.)';
      });
    });
    showBox(box, retire ? (recent ? 'bad' : 'warn') : 'warn', [
      el('div', { className: 'confirm-title', tabindex: '-1', text: retire ? 'Retire the shared links?' : 'Switch the shared links back on?' }),
      el('ul', {}, retire ? [
        el('li', { text: 'Phones still on the shared link will stop sending until they get their own link. Nothing on them is lost.' }),
        el('li', { text: 'The admin link stops working. Signing in with a username and password keeps working.' }),
        el('li', { text: 'Personal links are not affected. You can switch the shared links back on here.' }),
      ] : [
        el('li', { text: 'The old phone setup link and the admin link work again, on every phone and laptop that still has them.' }),
        el('li', { text: 'Phones that kept entries while they were retired send them the next time they are opened.' }),
      ]),
      tick,
      el('div', { className: 'confirm-actions' }, [no, yes]), msg,
    ]);
  }

  /* ---------- tabs: Active, Switched off, Shared links (kept in the address as ?tab=) ---------- */
  var TAB = (function () { var t = new URLSearchParams(location.search).get('tab'); return t === 'off' || t === 'shared' || t === 'devices' ? t : 'active'; })(); // 2.7.0: devices (Shared devices)
  function tabButtons() { return Array.prototype.slice.call($('tabs').querySelectorAll('[role="tab"]')); }
  function showTab(t, focus) {
    if (t === 'shared' && !S.shared) t = 'active';
    TAB = t;
    tabButtons().forEach(function (b) {
      var on = b.getAttribute('data-tab') === t;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    $('view-people').hidden = t === 'shared' || t === 'devices';
    $('view-devices').hidden = t !== 'devices';
    $('view-people').setAttribute('aria-labelledby', t === 'off' ? 'ptab-off' : 'ptab-active');
    $('shared-card').hidden = t !== 'shared';
    var next = new URLSearchParams(location.search);
    if (t === 'active') next.delete('tab'); else next.set('tab', t);
    var qs = next.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) { /* a file page: the address stays */ }
    drawList();
  }
  $('tabs').addEventListener('click', function (ev) { var b = ev.target.closest('[role="tab"]'); if (b) showTab(b.getAttribute('data-tab')); });
  $('tabs').addEventListener('keydown', function (ev) { // arrow keys move along the tabs, as the dashboard's do
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft' && ev.key !== 'Home' && ev.key !== 'End') return;
    var bs = tabButtons().filter(function (b) { return !b.hidden; }), i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    var n = ev.key === 'Home' ? 0 : ev.key === 'End' ? bs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length;
    showTab(bs[n].getAttribute('data-tab'), true);
  });

  /* ---------- the table: one line per person ---------- */
  function draw() { drawAsks(); drawShared(); drawSummary(); showTab(TAB); drawPaused(); drawDevices(); refreshView(); refreshDevice(); openFromHash(); syncInviteBits(); }

  var ASK_DAYS = 7 * 864e5;
  function askedLately(u) { return !u.revoked && !!u.asked_at && new Date(u.asked_at).getTime() > Date.now() - ASK_DAYS; }
  /** A person's state as one pill: tone, word, an optional few words after it, and which Status filter it answers to. */
  function statusOf(u) {
    if (u.revoked) return { tone: '', word: 'Switched off', more: u.revoked_at ? day(u.revoked_at) : '', key: 'off' };
    if (u.admin) {
      if (u.paused_by_undo) return { tone: 'bad', word: 'Paused', key: 'you' };
      if (u.email_change) return { tone: 'warn', word: 'Email change asked', key: 'you' };
      if (!u.sign_in) return u.email ? { tone: 'warn', word: 'No password yet', key: 'wait' } : { tone: 'bad', word: 'Not set up', key: 'you' };
      if (u.locked) return { tone: 'warn', word: 'Locked for 15 minutes', key: 'wait' };
      if (u.must_change) return { tone: 'warn', word: 'Has a temporary password', key: 'wait' };
      return { tone: 'ok', word: 'Signs in', key: 'ok' };
    }
    if (askedLately(u) && !u.ask_handled_by) return { tone: 'info', word: 'Asked for a new link', key: 'you' };
    if (u.join_open && !u.joined) return { tone: 'warn', word: 'Link not opened', more: 'to ' + day(u.join_expires), key: 'wait' };
    if (u.joined) return { tone: 'ok', word: 'Connected', more: (u.devices_live || 0) > 1 ? plural(u.devices_live, 'device', 'devices') : '', key: 'ok' }; // 2.6.0: "2 devices"
    return { tone: 'bad', word: 'Link expired', key: 'you' };
  }
  function initials(name) { return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(''); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function drawSummary() {
    var on = S.users.filter(function (u) { return !u.revoked; });
    var off = S.users.length - on.length;
    var admins = on.filter(function (u) { return u.admin; }).length;
    var unopened = on.filter(function (u) { return !u.admin && u.join_open && !u.joined; }).length;
    var asked = on.filter(function (u) { return askedLately(u) && !u.ask_handled_by; }).length;
    $('n-active').textContent = String(on.length); $('n-off').textContent = String(off);
    $('summary').textContent = !S.users.length ? 'No one has their own link yet.' : [
      on.length + ' active', plural(admins, 'admin', 'admins'),
      unopened ? plural(unopened, 'link', 'links') + ' not opened' : '',
      asked ? asked + ' asked for a new link' : '',
      off ? off + ' switched off' : '',
    ].filter(Boolean).join(' · ');
  }

  var SORT = { i: 0, dir: 'ascending' };
  var sorter = ui.sortable($('people-table'), { onSort: function (i, dir) { SORT = { i: i, dir: dir }; } });
  var filter = null; // made at the first draw, so a filter kept in the address finds its rows

  function drawList() {
    var rows = S.users.filter(function (u) { return TAB === 'off' ? u.revoked : !u.revoked; }); // under Shared links the active people stay drawn, out of sight
    Array.prototype.forEach.call($('f-role').querySelectorAll('option[data-area]'), function (o) { // the company's own names for its areas
      var a = o.getAttribute('data-area'); o.textContent = areaName(a); o.hidden = o.disabled = !areaOn(a) && $('f-role').value !== a;
    });
    $('f-status').parentNode.hidden = TAB === 'off'; // everyone on that tab has the one status
    if (TAB === 'off' && $('f-status').value) $('f-status').value = '';
    var none = $('people-none');
    $('people').replaceChildren.apply($('people'), rows.map(row));
    $('bar').hidden = $('people-box').hidden = !rows.length;
    none.hidden = !!rows.length;
    if (!rows.length) {
      var add = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Invite person', onclick: function () { openInvite(); } });
      none.replaceChildren(TAB === 'off' ? ui.empty('No one is switched off', 'People you switch off are listed here, with the date.')
        : ui.empty('No one has their own link yet', 'Invite the first person. The shared setup link keeps working in the meantime.', S.suspended ? null : add));
    }
    sorter.sort(SORT.i, SORT.dir);
    ui.paged($('people-table'), { key: 'people', label: 'People' }); // app 1.25.0 pager: before the filter, so a search or filter goes back to page one
    if (!filter) filter = ui.filter($('people-table'), { search: $('q'), filters: [$('f-role'), $('f-status')], count: $('count'), noun: ['person', 'people'] });
    else filter.run();
  }

  function td(props, kids) { return el('td', props, kids); }
  /** What can be done to this person, in the same order for everyone; what does not apply is left out. */
  function actionsFor(u) {
    if (u.revoked || S.suspended) return [];
    var mine = !!(S.me && u.id === S.me);
    var list = [{ key: 'edit', label: 'Edit', cls: 'edit-person' }];
    if (mine && u.sign_in) list.push({ key: 'password', label: 'Change password', cls: 'set-password' });
    else list.push({ key: 'resend', label: u.admin ? 'Send password link' : 'Send a new link', cls: 'resend' });
    // 2.1.0: another admin's email is only ever asked for: they are told at their current address and have 48 hours to cancel
    // 2.1.2: not for an admin paused by an undo (a new request must wait 30 days; the paused line says what to do instead)
    if (u.admin && !mine && S.session && u.email && !u.email_change && !u.paused_by_undo) list.push({ key: 'email', label: 'Change email…', cls: 'change-email' });
    if (!mine) list.push({ key: 'off', label: 'Switch off…', cls: 'switch-off', danger: true });
    return list;
  }

  function row(u) {
    var mine = !!(S.me && u.id === S.me);
    var st = statusOf(u);
    var open = el('button', { type: 'button', className: 'open', text: u.name, 'aria-haspopup': 'dialog' });
    var name = td({ className: 'c-name', 'data-v': u.name }, [
      el('span', { className: 'initials', 'aria-hidden': 'true', text: initials(u.name) }), open,
      mine ? el('span', { className: 'you', text: 'you' }) : null,
      u.note ? el('span', { className: 'sub', text: u.note }) : null,
    ]);
    var email = td({ className: 'ell col-email', 'data-v': u.email || '', text: u.email || '' });
    if (!u.email) CH_ADMIN.none(email);
    var seen = td({ className: 'c-seen', 'data-v': u.last_seen || '', text: u.last_seen ? dayTime(u.last_seen) : '' });
    if (!u.last_seen) { CH_ADMIN.none(seen); seen.title = 'Not seen yet'; }
    var acts = actionsFor(u), more = null;
    if (acts.length) {
      more = el('button', { type: 'button', className: 'btn btn-secondary btn-icon more', 'aria-label': 'Actions for ' + u.name }, [icon('ellipsis', 18)]);
      ui.menu(more, function () {
        var now = find(u.id) || u, list = actionsFor(now), items = [];
        list.forEach(function (a) { if (a.danger) items.push('-'); items.push({ label: a.label, danger: a.danger, onSelect: function () { act(now, a.key); } }); });
        return items;
      });
    }
    var roles = u.admin ? 'admin' : (u.areas || []).length ? u.areas.join(' ') : 'none';
    var tr = el('tr', { className: 'person is-link' + (u.revoked ? ' is-off' : ''), 'data-id': u.id, 'data-role': roles, 'data-status': st.key }, [
      name,
      td({ 'data-p': '2', className: 'c-does', text: doesWords(u) }),
      email,
      td({ className: 'c-money' + (u.money ? '' : ' is-no'), text: u.money ? 'Yes' : 'No' }),
      td({ 'data-p': '2', className: 'c-status', 'data-v': st.key + ' ' + st.word }, [ui.pill(st.tone, st.word), st.more ? el('span', { className: 'st-more', text: st.more }) : null]),
      seen,
      td({ className: 'act' }, [more]),
      td({ className: 'go' }, [icon('chevron-right', 18)]),
    ]);
    open.addEventListener('click', function () { openPerson(u.id); });
    tr.addEventListener('click', function (ev) { if (!ev.target.closest('a, button, input, select')) openPerson(u.id, null, open); }); // the whole row opens the person; the name is the real button
    return tr;
  }
  function find(id) { return S.users.filter(function (u) { return u.id === id; })[0] || null; }
  /** A menu item or a panel button: do it for this person. Everything but your own password is confirmed in the panel. */
  function act(u, key) {
    if (key === 'password') { if (window.CH_SIGNIN) CH_SIGNIN.changePassword(); return; }
    openPerson(u.id, key);
  }

  /* ---------- one person, in the side panel: their facts, what you can do, and the confirmation of each ---------- */
  var VIEW = null; // { id, panel, node, mode: 'view' | 'act', direct }
  function cell(k, v, more) { return el('div', { className: 'c' + (more ? ' ' + more : '') }, [el('span', { className: 'k', text: k }), el('span', { className: 'v', text: v })]); }
  function emailCell(u) {
    var v = el('span', { className: 'v' });
    if (u.email) v.appendChild(el('span', { className: 'em', text: u.email })); else CH_ADMIN.none(v);
    if (u.email_status) v.appendChild(el('span', { className: 'mail-status' + (/^sent/.test(u.email_status) ? ' ok' : ' bad'), text: /^sent/.test(u.email_status) ? 'Email sent ' + day(u.email_status.slice(5, 15)) : 'Email not sent' }));
    return el('div', { className: 'c c-email' }, [el('span', { className: 'k', text: 'Email' }), v]);
  }
  function signInWords(u) {
    if (u.paused_by_undo) return 'Paused: no password and no sign-in link';
    if (!u.sign_in) return u.email ? 'No password yet: press Send password link' : 'Not set up';
    return (u.email || u.username) + (u.username && u.email ? ' (or ' + u.username + ')' : '') + (u.must_change ? ' · has not chosen a password yet' : '') + (u.locked ? ' · locked for 15 minutes after wrong tries' : '');
  }
  function linkWords(u) {
    if (u.admin || u.revoked) return '';
    if (u.join_open) return u.joined ? 'Connected. Their newest link still opens until ' + day(u.join_expires) + ' (opening it again on another phone moves that device there).' : 'Link not opened yet. It works until ' + day(u.join_expires) + '.';
    if (u.joined) return 'Connected.';
    return 'Link expired before it was opened. Press Send a new link.';
  }

  function fillPerson(view, u) {
    var mine = !!(S.me && u.id === S.me);
    var st = statusOf(u);
    var box = el('div', { className: 'confirm', hidden: true });
    var seen = cell('Last seen', u.last_seen ? dayTime(u.last_seen) : '');
    if (!u.last_seen) { CH_ADMIN.none(seen.lastChild); seen.lastChild.title = 'Not seen yet'; }
    var facts = [
      emailCell(u),
      u.admin && !u.revoked ? cell('Sign-in', signInWords(u), 'c-signin') : null,
      linkWords(u) ? cell('Link', linkWords(u), 'c-link') : null,
      u.revoked ? cell('Switched off', day(u.revoked_at) + (u.revoked_by ? ' by ' + u.revoked_by : '') + '. To bring them back, invite them again.', 'c-off') : null,
      cell('Can see prices and payments', u.money ? 'Yes' : 'No'),
      cell('Added', day(u.created) + (u.created_by ? ' by ' + u.created_by : '')),
      seen,
      u.note ? cell('Note', u.note, 'c-note') : null,
      cell('Person ID', u.id, 'c-id'),
    ];
    var buttons = actionsFor(u).map(function (a) {
      var b = el('button', { type: 'button', className: 'btn btn-block ' + (a.danger ? 'btn-danger-quiet ' : 'btn-secondary ') + a.cls, text: a.label });
      b.addEventListener('click', function () { if (VIEW) VIEW.direct = false; run(find(u.id) || u, a.key, box, b); });
      return b;
    });
    view.setAttribute('data-id', u.id);
    view.replaceChildren.apply(view, [
      el('div', { className: 'pv-head' }, [
        el('span', { className: 'initials', 'aria-hidden': 'true', text: initials(u.name) }),
        el('span', { className: 'pv-does', text: doesWords(u) + (mine ? ' · you' : '') }),
        ui.pill(st.tone, st.word),
      ]),
      u.email_change && !u.revoked ? changeCell(u, mine) : null,
      u.paused_by_undo && !u.revoked ? pausedCell(u) : null,
      el('div', { className: 'pv-facts' }, facts.filter(Boolean)),
      !u.admin && (u.devices || []).length ? devicesCell(u, box) : null,
      !u.admin && !u.revoked ? pinCell(u, box) : null,
      buttons.length ? el('div', { className: 'pv-actions' }, buttons) : null,
      box,
    ].filter(Boolean));
  }
  function run(u, key, box, btn) {
    if (key === 'password') { if (window.CH_SIGNIN) CH_SIGNIN.changePassword(); return; }
    if (key === 'edit') askEdit(u, box, btn);
    else if (key === 'resend') askResend(u, box, btn);
    else if (key === 'email') askEmailChange(u, box, btn);
    else if (key === 'off') askSwitchOff(u, box, btn);
  }
  /** Opens a person's panel; with a key ("edit", "resend", "email", "off") it opens straight at that step. */
  function openPerson(id, key, opener) {
    var u = find(id);
    if (!u) return;
    if (opener && opener.focus) opener.focus({ preventScroll: true }); // a tap on the row: focus comes back to the person's name
    var view = el('div', { className: 'person-view' });
    fillPerson(view, u);
    var p = ui.panel({ title: u.name, body: view, onClose: function () { if (VIEW && VIEW.panel === p) VIEW = null; } });
    VIEW = { id: id, panel: p, node: view, mode: 'view', direct: !!key };
    if (key) {
      var btn = view.querySelector('.' + ({ edit: 'edit-person', resend: 'resend', email: 'change-email', off: 'switch-off' })[key]);
      if (btn) run(u, key, view.querySelector('.confirm'), btn); else VIEW.direct = false; // it no longer applies: the facts say why
    }
  }
  /** After a refresh: an open panel that is only showing facts gets the new ones; a form or a confirmation is left alone. */
  function refreshView() {
    if (!VIEW || VIEW.mode !== 'view') return;
    var u = find(VIEW.id);
    if (!u) { VIEW.panel.close(); return; }
    var had = VIEW.node.contains(document.activeElement);
    fillPerson(VIEW.node, u);
    VIEW.panel.node.querySelector('.panel-head h2').textContent = u.name;
    if (had) { var f = VIEW.node.querySelector('button'); (f || VIEW.panel.node.querySelector('.panel-head button')).focus(); }
  }
  function closeView() { if (VIEW) VIEW.panel.close(); }

  /* ---------- 2.1.2: an undone email change pauses the account until another admin sends a new sign-in link ---------- */
  function pausedCell(u) {
    var p = u.paused_by_undo;
    var text = 'Email change undone — account paused until another admin sends a new sign-in link. ' +
      'The change of their sign-in email to ' + p.new_email + ' was undone' + (p.at ? ' on ' + dayTime(p.at) : '') + (u.email ? '' : ' (' + p.old_email + ' was taken, so they have no email now)') + '. ' +
      'First check with ' + u.name + ' by phone or in person which address is really theirs. ' +
      (u.email ? 'If it is ' + u.email + ', press Send password link. If it is not, the Sheet\'s owner can give them a temporary password (Sheet menu: Set or reset an admin password…), and they change the email themselves on My profile.'
        : 'They have no email now, so the Sheet\'s owner gives them a temporary password (Sheet menu: Set or reset an admin password…).');
    return el('div', { className: 'notice warn c-paused' }, [el('div', { className: 'notice-body' }, [el('span', { className: 'notice-title', text: 'Paused' }), el('span', { className: 'v', text: text })])]);
  }

  /* ---------- another admin's email (2.1.0): ask, they have 48 hours to cancel ---------- */
  function changeCell(u, mine) {
    var c = u.email_change;
    var v = el('span', { className: 'v' }, [(mine ? 'Someone asked to change your sign-in email' : 'Asked') + ' to ' + c.new_email + ' by ' + (c.asked_by || 'an admin') + '. ' +
      (c.due ? 'The 48 hours are over, but it can still be cancelled until it happens.' : 'It changes on ' + dayTime(c.applies_at) + ' unless it is cancelled.') + ' Every admin was told by email.']);
    var kids = [el('span', { className: 'notice-title', text: 'Email change' }), v];
    if (S.session) {
      var b = el('button', { type: 'button', className: 'btn btn-secondary btn-sm cancel-change', text: 'Cancel it' });
      var id = uuid();
      b.addEventListener('click', function () {
        if (S.busy) return;
        S.busy = true; b.disabled = true; b.textContent = 'Cancelling…';
        post({ action: 'admin_email_cancel', entry_id: id, change_id: c.id }).then(function (r) {
          S.busy = false;
          if (!r.ok) { if (!r.retry) id = uuid(); throw new Error(r.error || 'That did not go through. Try again.'); }
          toast('Cancelled. ' + u.name + '\'s email stays as it was.'); fetchAll();
        }).catch(function (err) { S.busy = false; b.disabled = false; b.textContent = 'Cancel it'; toast(String(err.message || err)); });
      });
      kids.push(el('div', { className: 'notice-actions' }, [b]));
    }
    return el('div', { className: 'notice warn c-change' }, [el('div', { className: 'notice-body' }, kids)]);
  }
  function askEmailChange(u, box, btn) {
    if (S.busy) return;
    var actionId = uuid();
    var input = el('input', { type: 'email', id: 'chg-' + u.id, maxlength: '120', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    var msg = el('p', { className: 'err', hidden: true });
    var yes = el('button', { type: 'button', className: 'btn btn-primary', id: 'change-yes', text: 'Ask to change it' });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { endBox(box, btn); } });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      var e = input.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { msg.hidden = false; msg.textContent = 'That email address does not look right.'; input.focus(); return; }
      S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = 'Asking…';
      post({ action: 'admin_email_request', entry_id: actionId, user_id: u.id, email: e }).then(function (r) {
        S.busy = false;
        if (!r.ok || r.status === 'duplicate') { if (!r.retry) actionId = uuid(); throw new Error(r.ok ? 'That was already asked.' : (r.error || 'That did not go through. Try again.')); }
        closeView();
        toast('Asked. ' + firstName(u.name) + ' is told at their current address and can cancel it for 48 hours.');
        fetchAll();
      }).catch(function (err) {
        S.busy = false; yes.disabled = false; no.disabled = false; yes.textContent = 'Ask to change it';
        msg.hidden = false; msg.textContent = String(err.message || err);
      });
    });
    showBox(box, 'warn', [
      el('div', { className: 'confirm-title', tabindex: '-1', text: 'Change ' + u.name + '\'s sign-in email?' }),
      el('ul', {}, [
        el('li', { text: 'Nothing changes for 48 hours. We email ' + firstName(u.name) + ' at ' + u.email + ' with a button to cancel it, tell the new address, and tell every other admin and the owner, with your name and email.' }),
        el('li', { text: 'Until then no password link can be sent to either address. Any admin can cancel it here.' }),
        el('li', { text: 'Afterwards ' + firstName(u.name) + ' can undo it for 7 days from their old address. After a cancel or an undo, no new request for 30 days.' }),
        el('li', { text: 'If ' + firstName(u.name) + ' can still sign in, it is quicker for them to change it on their own My profile page.' }),
      ]),
      el('div', { className: 'f' }, [el('label', { for: 'chg-' + u.id, text: 'New email' }), input]),
      el('div', { className: 'confirm-actions' }, [no, yes]), msg,
    ]);
    input.focus();
  }

  /** Shows a confirmation (or the edit form) in its box. In a person's panel it takes the place of the action buttons. */
  function showBox(box, cls, kids) {
    box.className = 'confirm' + (cls ? ' ' + cls : ''); box.replaceChildren.apply(box, kids.filter(Boolean)); box.hidden = false;
    var view = box.closest('.person-view');
    if (view) { var a = view.querySelector('.pv-actions'); if (a) a.hidden = true; if (VIEW) VIEW.mode = 'act'; view.classList.toggle('is-editing', cls === 'edit'); } // the edit form stands in for the facts it changes
    var title = box.querySelector('.confirm-title');
    if (title) title.focus();
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }
  /** Cancel: back to where the person was. Opened straight from the row's menu, that is the table; otherwise the panel's buttons. */
  function endBox(box, btn) {
    box.hidden = true; box.replaceChildren();
    var view = box.closest('.person-view');
    if (view && VIEW) {
      if (VIEW.direct) { VIEW.panel.close(); return; }
      VIEW.mode = 'view'; view.classList.remove('is-editing');
      var a = view.querySelector('.pv-actions'); if (a) a.hidden = false;
    }
    if (btn && document.contains(btn)) btn.focus();
  }
  function lastAdmin(u) { return u.admin && S.users.filter(function (x) { return x.admin && !x.revoked; }).length <= 1; }

  function askSwitchOff(u, box, btn) {
    if (S.busy) return;
    if (lastAdmin(u)) { showBox(box, 'warn', [el('div', { className: 'confirm-title', tabindex: '-1', text: u.name + ' is the last admin' }), el('p', { className: 'confirm-note', text: 'Make someone else an admin first (open them and press Edit), then switch ' + u.name + ' off.' }), el('div', { className: 'confirm-actions' }, [el('button', { type: 'button', className: 'btn btn-secondary', text: 'OK', onclick: function () { endBox(box, btn); } })])]); return; }
    var actionId = uuid(); // pressing "Yes" again after a failed try is safe: the script does it once
    var yes = el('button', { type: 'button', className: 'btn btn-danger', text: 'Yes, switch off ' + firstName(u.name) });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { endBox(box, btn); } });
    var msg = el('p', { className: 'err', hidden: true });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = 'Switching off…';
      post({ action: 'revoke', entry_id: actionId, user_id: u.id }).then(function (r) {
        S.busy = false;
        if (!r.ok) throw new Error(r.error || 'That did not go through. Try again.');
        closeView();
        toast(u.name + '\'s link is switched off.');
        fetchAll();
      }).catch(function (err) {
        S.busy = false; yes.disabled = false; no.disabled = false; yes.textContent = 'Try again';
        msg.hidden = false; msg.textContent = String(err.message || err) + ' (Pressing it again is safe: it is never done twice.)';
      });
    });
    showBox(box, 'bad', [
      el('div', { className: 'confirm-title', tabindex: '-1', text: 'Switch off ' + u.name + '?' }),
      el('ul', {}, [
        el('li', { text: 'Their phone keeps any entries it has not sent yet. Nothing is lost.' }),
        u.admin ? el('li', { text: 'They are signed out everywhere and cannot sign in.' }) : el('li', { text: 'They need a new invite before they can send them.' }),
        el('li', { text: 'This cannot be undone, but you can always invite them again.' }),
      ]),
      el('div', { className: 'confirm-actions' }, [no, yes]), msg,
    ]);
  }

  /* ---------- 2.6.0: a person's devices (phone, tablet, laptop): rename, switch off, switch on again ---------- */
  var HOW = { invite: 'from the invite', 'new link': 'from a new link', 'from before': 'before devices were counted', shared: 'as a shared device' };
  function howWords(d) {
    var m = String(d.added_how || '').match(/^added from (D\d+)$/);
    if (m) { var from = ((find(d.user_id) || {}).devices || []).filter(function (x) { return x.id === m[1]; })[0]; return 'from ' + (from ? from.name : m[1]); }
    return HOW[d.added_how] || '';
  }
  function devicePill(d) { return d.off ? ui.pill('', 'Switched off') : !d.joined ? ui.pill('warn', 'Link not opened') : ui.pill('ok', 'On'); }
  function devicesCell(u, box) {
    var mine = (u.devices || []).slice().sort(function (a, b) { return (a.off ? 1 : 0) - (b.off ? 1 : 0); });
    var list = el('ul', { className: 'pv-devices' }, mine.map(function (d) {
      var more = u.revoked || S.suspended ? null : el('button', { type: 'button', className: 'btn btn-secondary btn-icon btn-sm more', 'aria-label': 'Actions for ' + d.name }, [icon('ellipsis', 16)]); // a switched-off person: nothing to do
      if (more) ui.menu(more, function () {
        var items = [{ label: 'Rename', onSelect: function () { askDeviceRename(u, d, box, more); } }];
        if (!d.off) { items.push('-'); items.push({ label: 'Switch off…', danger: true, onSelect: function () { askDeviceOff(u, d, box, more); } }); }
        else if (S.session) items.push({ label: 'Switch on again (new link)…', onSelect: function () { askDeviceOn(u, d, box, more); } });
        return items;
      });
      var bits = ['Added ' + day(d.created) + (howWords(d) ? ', ' + howWords(d) : ''), d.last_seen ? 'last seen ' + dayTime(d.last_seen) : 'not seen yet'];
      if (d.app_version) bits.push('app ' + d.app_version);
      if (d.off) bits.push('switched off ' + day(d.off_at) + (d.off_by ? ' by ' + d.off_by : ''));
      return el('li', { className: 'pv-device' + (d.off ? ' is-off' : ''), 'data-device': d.id }, [
        el('div', { className: 'pv-dev-main' }, [el('span', { className: 'pv-dev-name', text: d.name }), devicePill(d), more]),
        el('span', { className: 'pv-dev-sub', text: bits.join(' · ') }),
      ]);
    }));
    return el('div', { className: 'pv-devices-box', id: 'pv-devices' }, [el('h3', { className: 'pv-h', text: 'Devices' }), list]);
  }
  function deviceAsk(u, d, box, btn, o) {
    if (S.busy) return;
    var actionId = uuid(); // pressing "Yes" again after a failed try is safe: the script does it once
    var yes = el('button', { type: 'button', className: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), id: o.id, text: o.yes });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { endBox(box, btn); } });
    var msg = el('p', { className: 'err', hidden: true });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      var extra = o.body ? o.body() : {};
      if (extra === null) return;
      S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = o.busy;
      post(Object.assign({ action: o.action, entry_id: actionId, device_id: d.id }, extra)).then(function (r) {
        S.busy = false;
        if (!r.ok || (r.status === 'duplicate' && o.action === 'device_on')) { actionId = uuid(); throw new Error(r.ok ? 'That was already done. Press it again for a new link.' : (r.error || 'That did not go through. Try again.')); }
        o.done(r);
        fetchAll();
      }).catch(function (err) {
        S.busy = false; yes.disabled = false; no.disabled = false; yes.textContent = 'Try again';
        msg.hidden = false; msg.textContent = String(err.message || err) + (o.danger ? ' (Pressing it again is safe: it is never done twice.)' : '');
      });
    });
    showBox(box, o.tone, [el('div', { className: 'confirm-title', tabindex: '-1', text: o.title })].concat(o.kids || [], [el('div', { className: 'confirm-actions' }, [no, yes]), msg]));
  }
  /**
   * Review fix (M1): a lost device may have added others ("Add another device") or chosen the PIN. When it is switched off
   * (or replaced as lost), the devices it added in the last 7 days are offered for switching off too (ticked), and if it
   * chose the person's PIN, a Reset PIN is offered (ticked). Each is its own recorded action, done after the first.
   */
  function lostExtras(u) {
    var wrap = el('div', { className: 'lost-extras', id: 'lost-extras' });
    var ticks = [];
    var tick = function (id, label) { var i = el('input', { type: 'checkbox', id: id }); i.checked = true; ticks.push(i); return el('label', { className: 'check', for: id }, [i, el('span', { text: label })]); };
    var show = function (d) {
      ticks = [];
      var weekAgo = Date.now() - 7 * 864e5;
      var kids = (u.devices || []).filter(function (x) { return !x.off && x.joined && x.added_how === 'added from ' + d.id && (Date.parse(x.created) || 0) > weekAgo; });
      var rows = kids.map(function (x) { var row = tick('lost-also-' + x.id, 'Also switch off ' + x.name + ' (added from ' + d.name + ' on ' + day(x.created) + ')'); row.firstChild.setAttribute('data-device', x.id); return row; });
      if (S.session && u.pin && d.id && u.pin_set_on === d.id) { var pr = tick('lost-pin-reset', 'Also reset ' + u.name + '\'s PIN (it was chosen on ' + d.name + ')'); pr.firstChild.setAttribute('data-pin', '1'); rows.push(pr); }
      wrap.replaceChildren.apply(wrap, rows.length ? [el('p', { className: 'confirm-note', text: 'In case it is in the wrong hands:' })].concat(rows) : []);
      wrap.hidden = !rows.length;
    };
    var run = function () {
      var todo = ticks.filter(function (i) { return i.checked; });
      return todo.reduce(function (p, i) {
        return p.then(function (failed) {
          var body = i.getAttribute('data-pin') ? { action: 'pin_reset', entry_id: uuid(), user_id: u.id } : { action: 'device_off', entry_id: uuid(), device_id: i.getAttribute('data-device') };
          return post(body).then(function (r) { return r && r.ok ? failed : failed + 1; }, function () { return failed + 1; });
        });
      }, Promise.resolve(0));
    };
    return { node: wrap, show: show, run: run };
  }
  function askDeviceOff(u, d, box, btn) {
    var extra = lostExtras(u); extra.show(d);
    deviceAsk(u, d, box, btn, { action: 'device_off', id: 'device-off-yes', danger: true, tone: 'bad', yes: 'Yes, switch it off', busy: 'Switching off…', title: 'Switch off ' + u.name + '\'s ' + d.name + '?',
      kids: [el('ul', {}, [el('li', { text: 'It stops at once. Anything saved on it stays on it and is never lost.' }), el('li', { text: u.name + '\'s other devices keep working.' }), el('li', { text: 'To use it again, press Switch on again: it needs a new link.' })]), extra.node],
      done: function () { extra.run().then(function (failed) { closeView(); toast(failed ? d.name + ' is switched off, but ' + plural(failed, 'other step', 'other steps') + ' did not go through. Check the People page.' : d.name + ' is switched off.'); fetchAll(); }); } });
  }
  function askDeviceOn(u, d, box, btn) {
    deviceAsk(u, d, box, btn, { action: 'device_on', id: 'device-on-yes', tone: 'warn', yes: 'Yes, make a link', busy: 'Making it…', title: 'Switch ' + u.name + '\'s ' + d.name + ' on again?',
      kids: [el('ul', {}, [el('li', { text: 'This makes a new link for that same device. It works again once the link is opened on it.' }), el('li', { text: 'Anything it kept while switched off is sent then.' })])],
      done: function (r) { showResult({ name: u.name, admin: false, areas: u.areas, resend: true }, Object.assign({}, r, { user: r.user || u })); } });
  }
  function askDeviceRename(u, d, box, btn) {
    var input = el('input', { type: 'text', id: 'device-name-' + d.id, maxlength: '30', autocomplete: 'off' });
    input.value = d.name;
    deviceAsk(u, d, box, btn, { action: 'device_rename', id: 'device-rename-yes', tone: 'edit', yes: 'Save', busy: 'Saving…', title: 'Rename ' + d.name,
      kids: [el('div', { className: 'f' }, [el('label', { for: 'device-name-' + d.id, text: 'Name (1 to 30 letters)' }), input])],
      body: function () { var n = input.value.trim().replace(/\s+/g, ' '); if (!n || n.length > 30) { input.focus(); return null; } return { name: n }; },
      done: function () { closeView(); toast('Renamed.'); } });
    input.focus();
  }

  /* ---------- 2.6.0: a person's PIN for shared tablets: reset, a first-time code, a wait after wrong PINs ---------- */
  function pinCell(u, box) {
    var state = el('span', { className: 'v', id: 'pv-pin-state' });
    if (u.pin) state.textContent = 'Set ' + day(u.pin_set); else CH_ADMIN.none(state);
    var acts = S.session && !S.suspended ? el('div', { className: 'pv-pin-acts' }, [
      u.pin ? el('button', { type: 'button', className: 'btn btn-secondary btn-sm', id: 'pin-reset', text: 'Reset PIN', onclick: function () { askPinReset(u, box, this); } }) : null,
      el('button', { type: 'button', className: 'btn btn-secondary btn-sm', id: 'pin-code', text: 'Make a first-time code', onclick: function () { askPinCode(u, box, this); } }),
    ]) : null;
    var waits = (u.pin_waits || []).map(function (w) {
      var clear = S.session && !S.suspended ? el('button', { type: 'button', className: 'btn btn-ghost btn-sm', text: 'Clear', 'data-device': w.device, onclick: function () { clearWait(u, w, this); } }) : null;
      return el('p', { className: 'pv-pin-wait', 'data-device': w.device }, [document.createTextNode('Wrong PINs on ' + w.device_name + (w.until ? ': wait until ' + new Date(w.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ': ' + plural(w.n, 'wrong try', 'wrong tries')) + ' '), clear]);
    });
    return el('div', { className: 'pv-pin', id: 'pv-pin' }, [
      el('div', { className: 'pv-pin-row' }, [el('span', { className: 'k', text: 'Tablet PIN' }), state]),
    ].concat(waits, [acts, S.session ? null : el('p', { className: 'hint', text: 'Sign in with your own email and password to change PINs.' })]));
  }
  /** Shows a first-time code once, in the panel; it goes when the box or the panel closes. */
  function showCode(u, box, btn, r) {
    var done = el('button', { type: 'button', className: 'btn btn-primary', id: 'code-done', text: 'Done', onclick: function () { endBox(box, btn); } });
    showBox(box, 'ok', [
      el('div', { className: 'confirm-title', tabindex: '-1', text: firstName(u.name) + '\'s first-time code' }),
      el('p', { className: 'pin-code', id: 'pin-code-shown', text: r.code }),
      el('ul', {}, [el('li', { text: 'At a shared tablet, ' + firstName(u.name) + ' taps their name, then "First time here?", types this code and chooses a PIN.' }), el('li', { text: 'It works once, for 7 days. It is shown once here.' })]),
      el('div', { className: 'confirm-actions' }, [done]),
    ]);
  }
  function pinAsk(u, box, btn, o) {
    if (S.busy) return;
    var actionId = uuid();
    var yes = el('button', { type: 'button', className: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), id: o.id, text: o.yes });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { endBox(box, btn); } });
    var msg = el('p', { className: 'err', hidden: true });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = 'Working…';
      post(Object.assign({ action: o.action, entry_id: actionId, user_id: u.id }, o.body ? o.body() : {})).then(function (r) {
        S.busy = false;
        if (!r.ok || r.status === 'duplicate') { actionId = uuid(); throw new Error(r.ok ? r.message || 'That was already done.' : (r.error || 'That did not go through. Try again.')); }
        if (r.code) showCode(u, box, btn, r); else { closeView(); toast(o.done); }
        fetchAll();
      }).catch(function (err) {
        S.busy = false; yes.disabled = false; no.disabled = false; yes.textContent = 'Try again';
        msg.hidden = false; msg.textContent = String(err.message || err);
      });
    });
    showBox(box, o.tone, [el('div', { className: 'confirm-title', tabindex: '-1', text: o.title })].concat(o.kids || [], [el('div', { className: 'confirm-actions' }, [no, yes]), msg]));
  }
  function askPinReset(u, box, btn) {
    var also = el('input', { type: 'checkbox', id: 'pin-reset-code' });
    also.checked = true;
    pinAsk(u, box, btn, { action: 'pin_reset', id: 'pin-reset-yes', danger: true, tone: 'bad', yes: 'Yes, reset it', title: 'Reset ' + u.name + '\'s PIN?', done: u.name + '\'s PIN is reset.',
      kids: [el('ul', {}, [el('li', { text: 'Their PIN stops at once, on every shared tablet.' }), el('li', { text: 'Entries already saved with it are kept, and those not yet sent will need a look from you.' }), el('li', { text: 'They choose a new one on their phone, or on a tablet with a first-time code.' })]),
        el('label', { className: 'check', for: 'pin-reset-code' }, [also, el('span', { text: 'Also make a first-time code now' })])],
      body: function () { return { make_code: also.checked }; } });
  }
  function askPinCode(u, box, btn) {
    pinAsk(u, box, btn, { action: 'pin_code', id: 'pin-code-yes', tone: 'warn', yes: 'Yes, make a code', title: 'Make a first-time code for ' + u.name + '?',
      kids: [el('ul', {}, [el('li', { text: 'For someone with no phone of their own: they use it at a shared tablet to choose their PIN.' }), el('li', { text: 'It is shown once here, works once, for 7 days. An older code stops.' })])] });
  }
  function clearWait(u, w, btn) {
    if (S.busy) return;
    S.busy = true; btn.disabled = true;
    post({ action: 'pin_wait_clear', entry_id: uuid(), user_id: u.id, device_id: w.device }).then(function (r) {
      S.busy = false;
      if (!r.ok) throw new Error(r.error || 'That did not go through.');
      toast('The wait is cleared.'); fetchAll();
    }).catch(function (err) { S.busy = false; btn.disabled = false; toast(String(err.message || err)); });
  }

  /* ---------- 2.7.0: Shared devices (?tab=devices): tablets people take turns on ---------- */
  var IDLE = [5, 10, 15, 30];
  function areasWords(list) { return (list || []).map(areaName).join(', '); }
  function whoCanWords(d) {
    if ((d.people || []).length) return plural(d.people.length, 'person', 'people') + ' (chosen)';
    return 'Everyone in ' + areasWords(d.areas) + ' with a PIN';
  }
  function deviceStatus(d) { return d.off ? { tone: '', word: 'Switched off' } : !d.joined ? { tone: 'warn', word: d.link_open ? 'Link not opened' : 'Link expired' } : d.waits ? { tone: 'warn', word: 'Wrong PINs' } : { tone: 'ok', word: 'In use' }; }
  function drawDevices() {
    var list = S.devices || [];
    $('n-devices').textContent = String(list.length);
    $('device-add').hidden = !S.session || !!S.suspended;
    var none = $('devices-none');
    $('devices').replaceChildren.apply($('devices'), list.map(function (d) {
      var st = deviceStatus(d);
      var open = el('button', { type: 'button', className: 'open', text: d.name, 'aria-haspopup': 'dialog' });
      open.addEventListener('click', function () { openDevice(d.id, null, open); });
      var seen = td({ className: 'c-seen', 'data-v': d.last_seen || '', text: d.last_seen ? dayTime(d.last_seen) : '' }); if (!d.last_seen) CH_ADMIN.none(seen);
      var app = td({ className: 'c-app', text: d.app_version || '' }); if (!d.app_version) CH_ADMIN.none(app);
      var tr = el('tr', { className: 'device is-link' + (d.off ? ' is-off' : ''), 'data-id': d.id }, [
        td({ className: 'c-name' }, [el('span', { className: 'initials', 'aria-hidden': 'true' }, [icon('tablet', 16)]), open]),
        td({ className: 'c-for', text: areasWords(d.areas) }),
        td({ className: 'c-who', 'data-p': '2', text: whoCanWords(d) + (d.joined ? ' · ' + plural(d.roster_count || 0, 'on its list', 'on its list') : '') }),
        seen, app,
        td({ className: 'c-status', 'data-p': '2' }, [ui.pill(st.tone, st.word)]),
        td({ className: 'go' }, [icon('chevron-right', 18)]),
      ]);
      tr.addEventListener('click', function (ev) { if (!ev.target.closest('a, button, input, select')) openDevice(d.id, null, open); });
      return tr;
    }));
    $('devices-box').hidden = !list.length;
    none.hidden = !!list.length;
    ui.sortable($('devices-table'), { keep: true }); // sortable headings (kept when drawn again), then the shared pager
    ui.paged($('devices-table'), { key: 'devices', label: 'Shared devices' });
    if (!list.length) none.replaceChildren(ui.empty('No shared devices yet', 'A tablet in the factory that several people use: add it here, then open its link on the tablet.',
      S.session && !S.suspended ? el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Add a shared device', onclick: function () { openDevice(null); } }) : null));
  }
  function findDevice(id) { return (S.devices || []).filter(function (d) { return d.id === id; })[0] || null; }
  var DEVVIEW = null; // { id, panel, node, mode }
  var DEVLINK = ''; // a shared device's link, only while its card is on screen
  function closeDevice() { DEVLINK = ''; if (DEVVIEW) DEVVIEW.panel.close(); }
  function refreshDevice() {
    if (!DEVVIEW || DEVVIEW.mode !== 'view' || !DEVVIEW.id) return;
    var d = findDevice(DEVVIEW.id);
    if (!d) { closeDevice(); return; }
    fillDevice(DEVVIEW.node, d);
  }
  /** One shared device (or, id null, a new one) in the side panel. */
  function openDevice(id, key, opener) {
    if (opener && opener.focus) opener.focus({ preventScroll: true });
    var view = el('div', { className: 'person-view device-view' });
    var p = ui.panel({ title: id ? (findDevice(id) || {}).name || 'Shared device' : 'Add a shared device', body: view, onClose: function () { if (DEVVIEW && DEVVIEW.panel === p) { DEVVIEW = null; DEVLINK = ''; } } });
    DEVVIEW = { id: id, panel: p, node: view, mode: id ? 'view' : 'act' };
    if (id) fillDevice(view, findDevice(id)); else deviceForm(view, null);
  }
  function fillDevice(view, d) {
    var st = deviceStatus(d);
    var box = el('div', { className: 'confirm', hidden: true });
    var people = (d.people || []).map(function (id) { var u = find(id); return u ? u.name : id; });
    var facts = [
      cell('For', areasWords(d.areas)),
      cell('Who can use it', whoCanWords(d) + (people.length ? ': ' + people.join(', ') : '')),
      cell('On its list now', String(d.roster_count || 0)),
      cell('A turn ends', 'after ' + d.idle_minutes + ' minutes with no tap, and at ' + d.day_ends),
      cell('Added', day(d.created) + (d.created_by ? ' by ' + d.created_by : '')),
      cell('Last seen', d.last_seen ? dayTime(d.last_seen) + (d.app_version ? ' · app ' + d.app_version : '') : ''),
      d.off ? cell('Switched off', day(d.off_at) + (d.off_by ? ' by ' + d.off_by : '')) : null,
      cell('Device ID', d.id, 'c-id'),
    ];
    if (!d.last_seen) CH_ADMIN.none(facts[5].lastChild);
    var b = function (cls, label, fn, danger) { var x = el('button', { type: 'button', className: 'btn btn-block ' + (danger ? 'btn-danger-quiet ' : 'btn-secondary ') + cls, text: label }); x.addEventListener('click', function () { fn(d, box, x); }); return x; };
    var buttons = S.suspended ? [] : [
      S.session ? b('device-edit', 'Edit', function (dd, bx) { deviceForm(view, dd, bx); }) : null,
      S.session ? b('device-newlink', 'New link for this tablet', askNewTabletLink) : null,
      S.session && !d.off ? b('device-forget', 'Forget PIN checks on this tablet', askForget) : null,
      !d.off ? b('device-switchoff', 'Switch off…', askTabletOff, true) : null,
    ].filter(Boolean);
    view.setAttribute('data-id', d.id);
    view.classList.remove('is-editing');
    view.replaceChildren.apply(view, [
      el('div', { className: 'pv-head' }, [el('span', { className: 'initials', 'aria-hidden': 'true' }, [icon('tablet', 16)]), el('span', { className: 'pv-does', text: 'Shared device' }), ui.pill(st.tone, st.word)]),
      el('div', { className: 'pv-facts' }, facts.filter(Boolean)),
      buttons.length ? el('div', { className: 'pv-actions' }, buttons) : null,
      S.session ? null : el('p', { className: 'hint', text: 'Sign in with your own email and password to change shared devices.' }),
      box,
    ].filter(Boolean));
    if (DEVVIEW) DEVVIEW.mode = 'view';
  }
  /** Add or edit: name, area ticks, who can use it, turn ends after, day ends at. */
  function deviceForm(view, d, box) {
    var p = 'sd-' + (d ? d.id : 'new') + '-';
    var name = el('input', { type: 'text', id: p + 'name', maxlength: '30', autocomplete: 'off', placeholder: 'For example: Factory tablet' }); name.value = d ? d.name : '';
    var areaTicks = AREAS.map(function (a) { var t = chip(p + a, areaName(a), d ? d.areas.indexOf(a) >= 0 : a === 'roasting' && areaOn(a)); t.hidden = !areaOn(a) && !(d && d.areas.indexOf(a) >= 0); return t; });
    var everyone = el('input', { type: 'radio', name: p + 'who', id: p + 'everyone', value: 'all' });
    var chosen = el('input', { type: 'radio', name: p + 'who', id: p + 'chosen', value: 'some' });
    everyone.checked = !(d && d.people.length); chosen.checked = !everyone.checked;
    var workers = S.users.filter(function (u) { return !u.revoked && !u.admin; });
    var picks = el('div', { className: 'chips sd-people', hidden: everyone.checked }, workers.map(function (u) { return chip(p + 'u-' + u.id, u.name, d && d.people.indexOf(u.id) >= 0); }));
    [everyone, chosen].forEach(function (r) { r.addEventListener('change', function () { picks.hidden = everyone.checked; }); });
    var idle = el('div', { className: 'chips sd-idle', role: 'radiogroup', 'aria-label': 'A turn ends after' }, IDLE.map(function (m) {
      var r = el('input', { type: 'radio', name: p + 'idle', id: p + 'idle-' + m, value: String(m) }); r.checked = (d ? d.idle_minutes : 10) === m;
      return el('label', { className: 'chip-opt', for: p + 'idle-' + m }, [r, el('span', { text: m + ' min' })]);
    }));
    var ends = el('input', { type: 'time', id: p + 'ends', value: d ? d.day_ends : '00:00' });
    var msg = el('p', { className: 'err', role: 'alert', hidden: true });
    var actionId = uuid();
    var yes = el('button', { type: 'button', className: 'btn btn-primary', id: 'sd-save', text: d ? 'Save changes' : 'Create link' });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { if (d) fillDevice(view, findDevice(d.id) || d); else closeDevice(); } });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      var v = { name: name.value.trim().replace(/\s+/g, ' '), areas: AREAS.filter(function (a) { return view.querySelector('#' + p + a).checked; }),
        people: chosen.checked ? workers.filter(function (u) { return view.querySelector('#' + p + 'u-' + u.id).checked; }).map(function (u) { return u.id; }) : [],
        idle_minutes: Number((view.querySelector('input[name="' + p + 'idle"]:checked') || {}).value || 10), day_ends: ends.value || '00:00' };
      var bad = !v.name || v.name.length > 30 ? 'Type a name of 1 to 30 letters.' : !v.areas.length ? 'Tick at least one area the device is for.' : chosen.checked && !v.people.length ? 'Tick the people who can use it, or choose Everyone.' : '';
      if (bad) { msg.hidden = false; msg.textContent = bad; return; }
      var body;
      if (d) {
        var changes = [];
        ['name', 'areas', 'people', 'idle_minutes', 'day_ends'].forEach(function (k) { if (JSON.stringify(k === 'areas' || k === 'people' ? v[k].slice().sort() : v[k]) !== JSON.stringify(k === 'areas' || k === 'people' ? d[k].slice().sort() : d[k])) changes.push({ field: k, from: d[k], value: v[k] }); });
        if (!changes.length) { fillDevice(view, d); return; }
        body = { action: 'shared_device_edit', entry_id: actionId, device_id: d.id, changes: changes };
      } else body = Object.assign({ action: 'shared_device_add', entry_id: actionId }, v);
      S.busy = true; yes.disabled = no.disabled = true; yes.textContent = d ? 'Saving…' : 'Creating…';
      post(body).then(function (r) {
        S.busy = false; yes.disabled = no.disabled = false; yes.textContent = d ? 'Save changes' : 'Create link';
        if (!r.ok || r.status === 'duplicate') { actionId = uuid(); throw new Error(r.ok ? 'That was already done.' : (r.error || 'That did not go through. Try again.')); }
        if (d) { toast('Saved ' + v.name + '.'); fetchAll(); if (DEVVIEW) DEVVIEW.mode = 'view'; return; }
        S.devices = (S.devices || []).concat([r.device]);
        tabletLinkCard(view, r.device, r.link, 'added');
        fetchAll();
      }).catch(function (err) { S.busy = false; yes.disabled = no.disabled = false; yes.textContent = d ? 'Save changes' : 'Create link'; msg.hidden = false; msg.textContent = String(err.message || err); });
    });
    if (DEVVIEW) DEVVIEW.mode = 'act';
    view.classList.add('is-editing');
    view.replaceChildren(el('div', { className: 'confirm edit sd-form' }, [
      el('div', { className: 'f' }, [el('label', { for: p + 'name', text: 'Name' }), name]),
      el('fieldset', { className: 'ticks' }, [el('legend', { text: 'Which areas it is for' }), el('div', { className: 'chips' }, areaTicks)]),
      el('fieldset', { className: 'ticks' }, [el('legend', { text: 'Who can use it' }),
        el('label', { className: 'check', for: p + 'everyone' }, [everyone, el('span', { text: 'Everyone in those areas with a PIN' })]),
        el('label', { className: 'check', for: p + 'chosen' }, [chosen, el('span', { text: 'Only the people I choose' })]), picks]),
      el('fieldset', { className: 'ticks' }, [el('legend', { text: 'A turn ends after this long with no tap' }), idle]),
      el('div', { className: 'f' }, [el('label', { for: p + 'ends', text: 'The day ends at (every turn ends then)' }), ends]),
      el('div', { className: 'confirm-actions' }, [no, yes]), msg,
    ]));
    name.focus();
  }
  /** The tablet's link, shown once: QR and Copy only (it is opened on the tablet itself). Cleared however the panel closes. */
  function tabletLinkCard(view, d, link, why) {
    DEVLINK = String(link || '');
    var qr = el('div', { className: 'qr-box', id: 'sd-qr', role: 'img', 'aria-label': 'QR code of the tablet\'s link' });
    if (typeof qrcode === 'function' && DEVLINK) { var q = qrcode(0, 'L'); q.addData(DEVLINK); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
    var copy = el('button', { type: 'button', className: 'btn btn-secondary', id: 'sd-copy' }, [icon('copy', 16), el('span', { text: 'Copy link' })]);
    copy.addEventListener('click', function () {
      if (!DEVLINK) return;
      var done = function () { copy.lastChild.textContent = 'Copied'; setTimeout(function () { copy.lastChild.textContent = 'Copy link'; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(DEVLINK).then(done, function () { toast('Could not copy. Scan the QR code on the tablet instead.'); });
      else toast('Could not copy. Scan the QR code on the tablet instead.');
    });
    var doneBtn = el('button', { type: 'button', className: 'btn btn-primary', id: 'sd-done', text: 'Done', onclick: function () { closeDevice(); } });
    if (DEVVIEW) { DEVVIEW.mode = 'act'; DEVVIEW.id = d.id; DEVVIEW.panel.node.querySelector('.panel-head h2').textContent = d.name; }
    view.classList.remove('is-editing');
    view.replaceChildren(el('div', { className: 'result sd-link', id: 'sd-result' }, [
      el('div', { className: 'who' }, [el('b', { id: 'sd-result-title', tabindex: '-1', text: why === 'added' ? d.name + ' is added' : 'A new link for ' + d.name }), el('span', { className: 'note', text: areasWords(d.areas) })]),
      el('p', { className: 'hint', text: 'On the tablet, scan this with the camera (or open the copied link in its browser).' }), qr,
      el('div', { className: 'send' }, [copy]),
      el('p', { className: 'once', id: 'sd-once', text: 'Open it on the tablet. Works once, for 24 hours. Shown once here.' }),
      el('input', { type: 'hidden', id: 'sd-link', value: DEVLINK }),
      el('div', { className: 'confirm-actions' }, [doneBtn]),
    ]));
    view.querySelector('#sd-result-title').focus();
  }
  function tabletAsk(d, box, btn, o) {
    if (S.busy) return;
    var actionId = uuid();
    var yes = el('button', { type: 'button', className: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), id: o.id, text: o.yes });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { box.hidden = true; box.replaceChildren(); var a = box.parentNode && box.parentNode.querySelector('.pv-actions'); if (a) a.hidden = false; if (DEVVIEW) DEVVIEW.mode = 'view'; if (btn && document.contains(btn)) btn.focus(); } });
    var msg = el('p', { className: 'err', hidden: true });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      S.busy = true; yes.disabled = no.disabled = true; yes.textContent = 'Working…';
      post(Object.assign({ action: o.action, entry_id: actionId, device_id: d.id }, o.body || {})).then(function (r) {
        S.busy = false;
        if (!r.ok || r.status === 'duplicate') { actionId = uuid(); throw new Error(r.ok ? r.message || 'That was already done.' : (r.error || 'That did not go through. Try again.')); }
        o.done(r); fetchAll();
      }).catch(function (err) { S.busy = false; yes.disabled = no.disabled = false; yes.textContent = 'Try again'; msg.hidden = false; msg.textContent = String(err.message || err); });
    });
    box.className = 'confirm ' + (o.tone || ''); box.hidden = false;
    box.replaceChildren.apply(box, [el('div', { className: 'confirm-title', tabindex: '-1', text: o.title })].concat(o.kids || [], [el('div', { className: 'confirm-actions' }, [no, yes]), msg]));
    var a = box.parentNode && box.parentNode.querySelector('.pv-actions'); if (a) a.hidden = true;
    if (DEVVIEW) DEVVIEW.mode = 'act';
    box.querySelector('.confirm-title').focus();
  }
  function askNewTabletLink(d, box, btn) {
    tabletAsk(d, box, btn, { action: 'device_on', id: 'sd-newlink-yes', tone: 'warn', yes: 'Yes, make a new link', title: 'A new link for ' + d.name + '?',
      kids: [el('ul', {}, [el('li', { text: 'For a tablet that was reset, or switched off and back. Opened on it, it connects that tablet again as the same device.' }), el('li', { text: 'Entries kept on it are sent then, and still recorded under whoever made them.' })])],
      done: function (r) { tabletLinkCard(DEVVIEW.node, d, r.link, 'new'); } });
  }
  function askForget(d, box, btn) {
    tabletAsk(d, box, btn, { action: 'shared_device_edit', id: 'sd-forget-yes', danger: true, tone: 'bad', yes: 'Yes, forget them', title: 'Forget PIN checks on ' + d.name + '?', body: { changes: [], forget_pins: true },
      kids: [el('p', { className: 'confirm-note', text: 'Everyone types their PIN once with a connection again. Entries already saved on it are kept, and will need a look from you.' })],
      done: function () { closeDevice(); toast('PIN checks on ' + d.name + ' are forgotten.'); } });
  }
  function askTabletOff(d, box, btn) {
    tabletAsk(d, box, btn, { action: 'device_off', id: 'sd-off-yes', danger: true, tone: 'bad', yes: 'Yes, switch it off', title: 'Switch off ' + d.name + '?',
      kids: [el('ul', {}, [el('li', { text: 'Nobody can use it until it gets a new link.' }), el('li', { text: 'Entries saved on it stay on it, waiting, and are never lost.' })])],
      done: function () { closeDevice(); toast(d.name + ' is switched off.'); } });
  }

  /* ---------- a new link: join link (workers) or password link (admins) ---------- */
  function askResend(u, box, btn) {
    if (S.busy) return;
    var actionId = uuid();
    var mail = u.email ? el('input', { type: 'checkbox', id: 'resend-mail-' + u.id }) : null;
    if (mail) mail.checked = true;
    if (mail && u.admin) mail.disabled = true; // an admin's password link always goes to their own inbox
    // 2.4.3: an admin paused by an undone email change: the box first says to check with them (the old mailbox may not be theirs)
    var paused = !!(u.admin && u.paused_by_undo && u.email);
    // 2.6.0: for a worker, a new link is "For a new device" (it adds one; nothing stops) or "To replace a lost one" (it
    // also switches off the device picked). The first is the default; the second asks which device.
    var live = u.admin ? [] : (u.devices || []).filter(function (d) { return !d.off && d.joined; });
    var why = null, pick = null, extra = null;
    if (live.length) {
      var radio = function (id, name, value, label, on) { var i = el('input', { type: 'radio', id: id, name: name, value: value }); i.checked = !!on; return el('label', { className: 'check', for: id }, [i, el('span', { text: label })]); };
      why = el('fieldset', { className: 'ticks resend-why' }, [el('legend', { text: 'What is it for?' }),
        radio('resend-new-' + u.id, 'resend-why-' + u.id, 'new', 'For a new device', true),
        radio('resend-lost-' + u.id, 'resend-why-' + u.id, 'lost', 'To replace a lost one', false)]);
      pick = el('fieldset', { className: 'ticks resend-pick', hidden: true }, [el('legend', { text: 'Which one is lost? It is switched off.' })].concat(live.map(function (d, i) {
        return radio('resend-dev-' + d.id, 'resend-dev-' + u.id, d.id, d.name + (d.last_seen ? ' (last seen ' + day(d.last_seen) + ')' : ''), i === 0);
      })));
      var extra = lostExtras(u);
      var showExtra = function () { var lost = why.querySelector('input[value="lost"]').checked; var id = (pick.querySelector('input:checked') || {}).value; var d = live.filter(function (x) { return x.id === id; })[0]; if (lost && d) extra.show(d); else extra.show({ id: '' }); };
      why.addEventListener('change', function () { var lost = why.querySelector('input[value="lost"]').checked; pick.hidden = !lost; yes.textContent = lost ? 'Yes, make a link and switch it off' : 'Yes, make a new link'; showExtra(); });
      pick.addEventListener('change', showExtra);
      pick.appendChild(extra.node); extra.node.hidden = true;
    }
    var yes = el('button', { type: 'button', className: 'btn btn-primary', id: 'resend-yes', text: paused ? 'Yes, I checked: send it' : u.admin ? 'Yes, make a password link' : 'Yes, make a new link' });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { endBox(box, btn); } });
    var msg = el('p', { className: 'err', hidden: true });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = 'Making it…';
      var send = !!(mail && mail.checked);
      var lostOne = why && why.querySelector('input[value="lost"]').checked ? (pick.querySelector('input:checked') || {}).value : '';
      var req = { action: u.admin ? 'send_password_link' : 'resend', entry_id: actionId, user_id: u.id, send_email: send };
      if (lostOne) req.replace_device = lostOne;
      post(req).then(function (r) {
        S.busy = false;
        if (!r.ok || r.status === 'duplicate') { if (!r.retry) actionId = uuid(); throw new Error(r.ok ? 'That was already done. Press the button again for a new link.' : (r.error || 'That did not go through. Try again.')); }
        showResult({ name: u.name, admin: u.admin, areas: u.areas, resend: true }, r); // the link card takes the panel's place
        if (lostOne && extra) extra.run().then(function (failed) { if (failed) toast(plural(failed, 'step', 'steps') + ' after the new link did not go through. Check the People page.'); fetchAll(); });
        else fetchAll();
      }).catch(function (err) {
        S.busy = false; yes.disabled = false; no.disabled = false; yes.textContent = 'Try again';
        msg.hidden = false; msg.textContent = String(err.message || err);
      });
    });
    showBox(box, 'warn', [
      el('div', { className: 'confirm-title', tabindex: '-1', text: u.admin ? 'Send ' + u.name + ' a link to choose a password?' : 'Make a new link for ' + u.name + '?' }),
      paused ? el('p', { className: 'confirm-note paused-check' }, [el('b', { text: 'Check with them by phone or in person first: this link goes to ' + u.email + '.' })]) : null,
      paused ? el('p', { className: 'confirm-note', text: 'Their account is paused because a change of their sign-in email was undone. Every admin and the owner will be told that you sent it, and to which address.' }) : null,
      el('ul', {}, u.admin ? [
        el('li', { text: 'The link works once, for 48 hours.' }),
        el('li', { text: 'Their current password (if they have one) keeps working until they use it.' }),
      ] : [
        el('li', { text: 'Their old link stops working. The new one works for 7 days.' }),
        el('li', { text: live.length ? 'Opened on a device, it adds that device. Devices already connected keep working, unless you pick one as lost below.' : 'Opened on a phone, it connects that phone.' }),
      ]),
      why, pick,
      mail ? el('label', { className: 'check', for: 'resend-mail-' + u.id }, [mail, el('span', { text: 'Email it to ' + u.email })]) : el('p', { className: 'confirm-note', text: 'No email address: you can send it by WhatsApp, a QR code or Copy.' }),
      mail && u.admin ? el('p', { className: 'confirm-note', text: 'An admin\'s link only goes to their own inbox. It is shown here only if the email cannot be sent.' }) : null,
      el('div', { className: 'confirm-actions' }, [no, yes]), msg,
    ]);
  }

  /* ---------- edit: name, email, ticks, prices, note ---------- */
  function tick(id, label, on, disabled) {
    var i = el('input', { type: 'checkbox', id: id });
    i.checked = !!on; i.disabled = !!disabled;
    return el('label', { className: 'check', for: id }, [i, el('span', { text: label })]);
  }
  /** An area as a chip you press on or off (a real tick box underneath). */
  function chip(id, label, on) {
    var i = el('input', { type: 'checkbox', id: id });
    i.checked = !!on;
    return el('label', { className: 'chip-opt', for: id }, [i, el('span', { text: label })]);
  }
  function askEdit(u, box, btn) {
    if (S.busy) return;
    var actionId = uuid();
    var mine = !!(S.me && u.id === S.me);
    var p = 'ed-' + u.id + '-';
    var name = el('input', { type: 'text', id: p + 'name', maxlength: '60', autocomplete: 'off', value: u.name });
    name.value = u.name;
    // an admin's email: only that admin, with their password (the script checks this too)
    var emailLocked = u.admin && !mine;
    var email = el('input', { type: 'email', id: p + 'email', maxlength: '120', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    email.value = u.email || ''; email.readOnly = emailLocked;
    var pw = el('input', { type: 'password', id: p + 'pw', maxlength: '200', autocomplete: 'current-password' });
    var pwRow = el('div', { className: 'f', hidden: true }, [el('label', { for: p + 'pw', text: 'Your current password (to change your own email)' }), pw]);
    email.addEventListener('input', function () { pwRow.hidden = !(u.admin && mine && email.value.trim().toLowerCase() !== (u.email || '')); });
    var note = el('input', { type: 'text', id: p + 'note', maxlength: '300', autocomplete: 'off' }); note.value = u.note || '';
    var areaTicks = AREAS.map(function (a) { var t = chip(p + a, areaName(a), (u.areas || []).indexOf(a) >= 0 && !u.admin); t.hidden = !areaOn(a); return t; }); // a hidden tick keeps its value
    var adminTick = tick(p + 'admin', 'Admin (everything, including this page)', u.admin, mine || lastAdmin(u));
    var moneyTick = tick(p + 'money', 'Can see prices and payments', u.money, u.admin);
    var field = function (id) { return box.querySelector('#' + id); };
    var sync = function () {
      var isAdmin = field(p + 'admin').checked;
      AREAS.forEach(function (a) { var t = field(p + a); t.disabled = isAdmin; if (isAdmin) t.checked = false; });
      field(p + 'money').disabled = isAdmin; if (isAdmin) field(p + 'money').checked = true;
    };
    adminTick.querySelector('input').addEventListener('change', sync);
    var msg = el('p', { className: 'err', hidden: true });
    var yes = el('button', { type: 'button', className: 'btn btn-primary', id: 'edit-save', text: 'Save changes' });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { endBox(box, btn); } });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      var isAdmin = field(p + 'admin').checked;
      var areas = AREAS.filter(function (a) { return field(p + a).checked; });
      var changes = [];
      var nm = name.value.trim().replace(/\s+/g, ' ');
      if (!nm) { msg.hidden = false; msg.textContent = 'Please type the person\'s name.'; name.focus(); return; }
      if (nm !== u.name) changes.push({ field: 'name', from: u.name, value: nm });
      var em = email.value.trim().toLowerCase();
      if (!emailLocked && em !== (u.email || '')) changes.push({ field: 'email', from: u.email || '', value: em });
      if (isAdmin !== !!u.admin) changes.push({ field: 'admin', from: !!u.admin, value: isAdmin });
      if (!isAdmin && (u.admin || areas.join(',') !== (u.areas || []).join(','))) changes.push({ field: 'areas', from: u.areas || [], value: areas }); // an admin's areas are all three
      var money = field(p + 'money').checked;
      if (!isAdmin && money !== !!u.money) changes.push({ field: 'money', from: !!u.money, value: money });
      if (note.value.trim() !== (u.note || '')) changes.push({ field: 'note', from: u.note || '', value: note.value.trim() });
      if (!changes.length) { endBox(box, btn); return; }
      var body = { action: 'edit_person', entry_id: actionId, user_id: u.id, changes: changes };
      if (!pwRow.hidden) body.password = pw.value;
      S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = 'Saving…';
      post(body).then(function (r) {
        S.busy = false; pw.value = '';
        if (!r.ok || r.status === 'duplicate') { actionId = uuid(); throw new Error(r.ok ? 'That was already saved.' : (r.error || 'That did not go through. Try again.')); }
        closeView();
        toast('Saved ' + nm + '.' + (r.needs_password_link ? ' Open them and press Send password link so they can sign in.' : '') + (r.notice ? (r.notice.sent ? ' We told the old address.' : ' The note to the old address could not be sent.') : ''));
        fetchAll();
      }).catch(function (err) {
        S.busy = false; yes.disabled = false; no.disabled = false; yes.textContent = 'Save changes';
        msg.hidden = false; msg.textContent = String(err.message || err);
      });
    });
    showBox(box, 'edit', [
      el('div', { className: 'confirm-title', tabindex: '-1', text: 'Edit ' + u.name }),
      el('div', { className: 'f' }, [el('label', { for: p + 'name', text: 'Name' }), name]),
      el('div', { className: 'f' }, [el('label', { for: p + 'email', text: 'Email' }), email,
        emailLocked ? el('span', { className: 'hint', text: 'Only ' + u.name + ' can change their own email. Use Change email… to ask: they are told and have 48 hours to cancel.' })
          : mine ? el('span', { className: 'hint', text: 'Your own email needs your password (or use My profile on the Settings page). We send a note to your old address.' })
          : el('span', { className: 'hint', id: p + 'email-note', text: 'If you change it, we send a note to the old address so ' + firstName(u.name) + ' knows.' })]),
      pwRow,
      el('fieldset', { className: 'ticks' }, [el('legend', { text: 'What they do' }), el('div', { className: 'chips' }, areaTicks), adminTick, moneyTick]),
      el('div', { className: 'f' }, [el('label', { for: p + 'note', text: 'Note' }), note]),
      mine ? el('p', { className: 'confirm-note', text: 'You cannot stop being an admin yourself: ask another admin.' }) : lastAdmin(u) ? el('p', { className: 'confirm-note', text: u.name + ' is the last admin, so they stay an admin.' }) : null,
      el('p', { className: 'confirm-note', text: 'Entries already saved keep the old name. New entries use the new one.' }),
      el('div', { className: 'confirm-actions' }, [no, yes]), msg,
    ]);
    sync();
    name.focus();
  }

  /* ---------- people who asked for a new link ---------- */
  function drawAsks() {
    var asked = S.users.filter(askedLately);
    var banner = $('asks-banner');
    banner.hidden = !asked.length;
    if (!asked.length) return;
    var open = asked.filter(function (u) { return !u.ask_handled_by; });
    banner.className = 'notice asks ' + (open.length ? 'warn' : 'info');
    $('asks-body').replaceChildren.apply($('asks-body'), [el('span', { className: 'notice-title', text: open.length ? (open.length === 1 ? open[0].name + ' asked for a new link.' : open.length + ' people asked for a new link.') : 'New links were sent.' })]
      .concat(asked.map(function (u) {
        if (u.ask_handled_by) return el('span', { className: 'ask-row ask-done', 'data-id': u.id, text: u.name + ': resent by ' + u.ask_handled_by + ' at ' + dayTime(u.ask_handled_at) + '.' });
        var b = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Resend invite' });
        b.addEventListener('click', function () { openResend(u.id); });
        return el('span', { className: 'ask-row', 'data-id': u.id }, [document.createTextNode(u.name + ' (asked ' + dayTime(u.asked_at) + ') '), b]);
      })));
  }
  function openResend(id) { if (!S.suspended) openPerson(id, 'resend'); }
  /** From the dashboard's "Resend invite": people.html#resend=U003 opens that person's resend box once. */
  function openFromHash() {
    var m = String(location.hash || '').match(/^#(resend|person)=(U\d+)$/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (m[1] === 'person') openPerson(m[2]); else openResend(m[2]); // 1.24.2: #person=U003 (Home's wrong-PINs row) opens that person
  }

  /* ---------- inviting: the form lives in the side panel that "Invite person" opens ---------- */
  var INVITE = null; // the open panel, or null
  function drawAreaTicks() {
    var box = $('inv-areas');
    var firstOn = AREAS.filter(areaOn)[0];
    var shown = function () {
      AREAS.forEach(function (a) { var l = box.querySelector('label[for="inv-area-' + a + '"]'), t = $('inv-area-' + a); if (!l) return; l.hidden = !areaOn(a); if (!areaOn(a)) t.checked = false; }); // never invited to an area that is off
    };
    if (box.childNodes.length) { AREAS.forEach(function (a) { var l = box.querySelector('label[for="inv-area-' + a + '"] span'); if (l) l.textContent = areaName(a); }); shown(); return; }
    AREAS.forEach(function (a) { box.appendChild(chip('inv-area-' + a, areaName(a), a === firstOn)); });
    shown();
    box.addEventListener('change', syncInviteBits);
  }
  var sendTouched = false;
  function syncInviteBits() {
    drawAreaTicks();
    var admin = $('inv-admin').checked;
    AREAS.forEach(function (a) { var t = $('inv-area-' + a); t.disabled = admin; if (admin) t.checked = false; });
    var money = $('inv-money');
    if (admin) { money.checked = true; money.disabled = true; } else money.disabled = false;
    var hasEmail = !!$('inv-email').value.trim();
    $('inv-email-opt').textContent = admin ? '(needed for an admin)' : '(optional)';
    $('inv-email-hint').textContent = admin ? 'An admin signs in with this email. We email them a link to choose their password.' : 'Only needed if you send the link by email.';
    // 1.25.3: how the link will be sent is chosen BEFORE it is made (Andrew: not knowing what happens without email was unclear).
    // An admin's link is always emailed, never shown here (the script insists too); Email needs an address. Typing an address
    // picks Email unless another way was picked by hand.
    var via = function (v) { return $('inv-via-' + v); };
    ['whatsapp', 'qr', 'copy'].forEach(function (v) { via(v).disabled = admin; });
    via('email').disabled = !admin && !hasEmail;
    if (admin) via('email').checked = true;
    else if (!hasEmail && via('email').checked) via('whatsapp').checked = true;
    else if (hasEmail && !sendTouched) via('email').checked = true;
    var how = inviteVia();
    $('inv-send').checked = how === 'email';
    $('inv-via-hint').textContent = admin ? 'An admin\'s link is always emailed, so only they can use it.'
      : how === 'email' ? 'We email the link to them now.'
      : how === 'qr' ? 'Next, a QR code shows here: they point their phone\'s camera at it.'
      : how === 'copy' ? 'Next, copy the link and paste it into any message.'
      : 'Next, press Open WhatsApp, pick the person and send. Nothing goes through us.';
    var areas = AREAS.filter(function (a) { return $('inv-area-' + a).checked; });
    if (!S.busy) $('inv-go').textContent = goWord(false);
    $('inv-hint').textContent = admin ? 'Can do everything, including this page. Treat their sign-in like your own.'
      : areas.length ? 'Can use the ' + areas.map(function (a) { return AREA_HINT[a]; }).join(', and the ') + ' in the field app.'
      : 'No forms: they can only look at the season overview.';
  }
  function inviteVia() { var c = document.querySelector('input[name="inv-via"]:checked'); return c ? c.value : 'whatsapp'; }

  /** The invite button says what will happen: an emailed invite is sent; otherwise a link is made to pass on by hand. */
  function goWord(busy) {
    var emailed = $('inv-admin').checked || (!!$('inv-email').value.trim() && $('inv-send').checked);
    if (emailed) return busy ? 'Sending…' : 'Send invite';
    return busy ? 'Creating…' : inviteVia() === 'qr' ? 'Create QR code' : 'Create link';
  }
  function inviteErr(text) { var e = $('inv-err'); e.hidden = !text; e.textContent = text || ''; }

  /** Which half of the panel shows: the form (with Cancel and Send invite / Create link) or the link card (with Done). */
  function inviteMode(result, resend) {
    $('invite-form').hidden = result; $('result').hidden = !result;
    $('inv-cancel').hidden = $('inv-go').hidden = result;
    $('done').hidden = !result; $('inv-another').hidden = !result || !!resend || !!S.suspended;
    if (INVITE) INVITE.node.querySelector('.panel-head h2').textContent = !result ? 'Invite person' : resend ? 'New link' : 'Invited';
  }
  /** Puts the form and its buttons back in their (hidden) place on the page, so the IDs are still there for the next time. */
  var CARD = $('invite-card'), FOOT = $('invite-foot'); // kept by name: while the closing panel is being taken away they are not on the page
  function parkInvite() { $('invite-holder').appendChild(CARD); $('invite-holder').appendChild(FOOT); }
  function openInvite(result, resend) {
    if (S.suspended && !result) return;
    if (!INVITE) {
      var p = ui.panel({ title: 'Invite person', body: CARD, foot: [FOOT], onClose: function () {
        if (INVITE !== p) return;
        INVITE = null; parkInvite(); hideResult(); inviteErr(''); // closing it any way is "Done": the link is cleared from the page
      } });
      INVITE = p;
    }
    inviteMode(!!result, resend);
    if (!result) $('inv-name').focus();
  }
  function closeInvite() { hideResult(); if (INVITE) INVITE.close(); } // the link is cleared at once, before the panel has finished closing

  function submitInvite(ev) {
    ev.preventDefault();
    if (S.busy) return;
    var name = $('inv-name').value.trim().replace(/\s+/g, ' ');
    if (!name) { inviteErr('Please type the person\'s name.'); $('inv-name').focus(); return; }
    var admin = $('inv-admin').checked;
    var email = $('inv-email').value.trim();
    if (admin && !email) { inviteErr('An admin needs an email address: it is how they sign in.'); $('inv-email').focus(); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { inviteErr('That email address does not look right.'); $('inv-email').focus(); return; }
    inviteErr('');
    var body = { action: 'invite', name: name, email: email, admin: admin, areas: admin ? [] : AREAS.filter(function (a) { return $('inv-area-' + a).checked; }),
      money: $('inv-money').checked, note: $('inv-note').value.trim(), send_email: !!(email && $('inv-send').checked) };
    // One ID per invite. After a failed try the same ID is used again, so pressing the button twice can never make two people.
    var sig = JSON.stringify([body.name, body.email, body.admin, body.areas, body.money, body.note, body.send_email]);
    if (!S.attempt || S.attempt.sig !== sig) S.attempt = { id: uuid(), sig: sig };
    body.entry_id = S.attempt.id;
    S.busy = true; $('inv-go').disabled = true; $('inv-go').textContent = goWord(true);
    post(body).then(function (r) {
      S.busy = false; $('inv-go').disabled = false; $('inv-go').textContent = goWord(false);
      // A refused or repeated invite will never give a link: the next press starts a fresh invite.
      if (!r.ok || r.status === 'duplicate') S.attempt = null;
      if (!r.ok) throw new Error(r.error || 'That did not go through. Try again.');
      if (r.status === 'duplicate') throw new Error('That invite was already made, and its link is only shown once. Close this, open the person and press Send a new link.');
      S.attempt = null;
      showResult(body, r);
      $('invite-form').reset(); sendTouched = false; AREAS.forEach(function (a) { $('inv-area-' + a).checked = a === AREAS.filter(areaOn)[0]; }); syncInviteBits();
      fetchAll();
    }).catch(function (err) {
      S.busy = false; $('inv-go').disabled = false; $('inv-go').textContent = goWord(false);
      inviteErr(String(err.message || err));
      fetchAll(); // an invite that went through but whose answer was lost shows up in the list
    });
  }

  var LINK = ''; // the link lives only here and in a hidden box so the page can hand it on; it is never shown as text
  var WHO = '', TO = '';
  function firstName(n) { return String(n || '').split(' ')[0]; }

  /** The invite card, in the side panel: who, what they do, then Email / WhatsApp / QR / Copy for the link (shown once). */
  function showResult(body, r) {
    var name = (r.user && r.user.name) || body.name;
    var admin = !!(body.admin || (r.user && r.user.admin));
    var mail = r.email || {};
    WHO = name; LINK = r.link || ''; TO = (r.user && r.user.email) || body.email || '';
    $('result-title').textContent = admin ? (body.resend ? 'Password link for ' + firstName(name) : firstName(name) + ' is invited as an admin') : firstName(name) + '\'s link is ready';
    $('result-role').textContent = admin ? 'Admin' : doesWords({ areas: (r.user && r.user.areas) || body.areas || [] });
    var note = $('result-mail');
    note.hidden = !mail.asked && !(admin && !LINK);
    if (mail.sent) { note.className = 'notice ok result-mail'; note.textContent = admin ? 'We\'ve emailed ' + firstName(name) + ' a link to choose their password (works for 48 hours).' : 'Sent to ' + shortEmail(mail.to || TO) + '.'; }
    else if (admin && !LINK && mail.asked) { note.className = 'notice warn result-mail'; note.textContent = r.message || 'The email could not be sent. Try again later, or they can press Forgot password on the sign-in page.'; } // 2.0.3: never shown here
    else if (mail.asked) { note.className = 'notice warn result-mail'; note.textContent = 'The email was not sent: ' + (WHY[mail.reason] || 'it could not be sent') + '. Use WhatsApp, the QR code or Copy instead.'; }
    // an emailed admin link is not on this page at all; anything else can be passed on here
    $('result-send').hidden = !LINK;
    $('send-email').disabled = !TO || !!mail.sent;
    $('send-email').hidden = !TO; // 1.25.3: no address, no Email button (not a disabled one)
    $('send-email-text').textContent = mail.sent ? 'Sent' : TO ? 'Send email' : 'No email';
    $('send-email').classList.toggle('is-sent', !!mail.sent);
    $('result-warn').textContent = !LINK ? (mail.sent ? 'If it does not arrive, press Send password link on their row.' : 'Nothing was sent. Try again later.')
      : admin ? 'Send it to ' + firstName(name) + ' only. It works once, for 48 hours. It is shown once here.'
      : 'This link is shown once here. It works for 7 days. If they lose it, press Send a new link on their row.';
    var later = $('result-later');
    var areas = (r.user && r.user.areas) || body.areas || [];
    later.hidden = admin || areas.length > 0;
    later.textContent = 'This link has no forms: it opens an empty home screen with the Dashboard.';
    $('result-link').value = LINK;
    $('qr-box').hidden = true; $('qr-box').replaceChildren(); $('qr-hint').hidden = true; $('send-qr').setAttribute('aria-expanded', 'false');
    $('copy-text').textContent = 'Copy link';
    // 1.25.3: the way chosen before the link was made leads (primary, first); the others stay below it
    var chosen = body.resend ? '' : inviteVia(), btnOf = { whatsapp: 'send-wa', qr: 'send-qr', copy: 'copy', email: 'send-email' };
    ['send-email', 'send-wa', 'send-qr', 'copy'].forEach(function (id) { var b = $(id); b.parentNode.appendChild(b); }); // back to the fixed order first (review)
    ['send-wa', 'send-qr', 'copy', 'send-email'].forEach(function (id) { var b = $(id); var lead = btnOf[chosen] === id && !mail.sent; b.classList.toggle('btn-primary', lead); b.classList.toggle('btn-secondary', !lead); if (lead) b.parentNode.insertBefore(b, b.parentNode.firstChild); });
    openInvite(true, !!body.resend);
    if (chosen === 'qr' && LINK && $('qr-box').hidden) showQr(); // from "Send a new link" this takes the place of the person's panel
    $('result-title').focus();
  }

  function hideResult() { LINK = ''; WHO = ''; TO = ''; $('result-link').value = ''; $('qr-box').replaceChildren(); $('qr-box').hidden = true; $('qr-hint').hidden = true; $('result').hidden = true; }

  function company() { return (C.brand && C.brand.company) || C.company || 'Cocoahead'; }
  function words() { return 'Hi ' + firstName(WHO) + ', this is your link for ' + company() + '. Open it on your phone. It is only for you. ' + LINK; }

  function copyLink() {
    if (!LINK) return;
    var done = function () { $('copy-text').textContent = 'Copied'; setTimeout(function () { $('copy-text').textContent = 'Copy link'; }, 2000); };
    var fallback = function () { toast('Could not copy. Use WhatsApp or Email instead.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(LINK).then(done, fallback);
    else fallback();
  }
  function showQr() {
    var box = $('qr-box');
    if (!box.hidden) { box.hidden = true; box.replaceChildren(); $('qr-hint').hidden = true; $('send-qr').setAttribute('aria-expanded', 'false'); return; }
    if (typeof qrcode !== 'function' || !LINK) { toast('The QR code could not be made here.'); return; }
    var q = qrcode(0, 'L'); q.addData(LINK); q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); // drawn by the bundled QR library from the link only
    box.hidden = false; $('qr-hint').hidden = false; $('send-qr').setAttribute('aria-expanded', 'true');
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }
  // WhatsApp and mail open the person's own app (plain navigation, nothing is fetched)
  function openWhatsApp() { if (LINK) window.open('https://wa.me/?text=' + encodeURIComponent(words()), '_blank', 'noopener'); }
  function openMail() { if (LINK && TO) location.href = 'mailto:' + encodeURIComponent(TO) + '?subject=' + encodeURIComponent('Your link for ' + company()) + '&body=' + encodeURIComponent(words()); }

  /* ---------- wiring ---------- */
  $('invite-open').addEventListener('click', function () { openInvite(); });
  $('invite-form').addEventListener('submit', submitInvite);
  $('inv-admin').addEventListener('change', syncInviteBits);
  $('inv-email').addEventListener('input', syncInviteBits);
  $('inv-via').addEventListener('change', function () { sendTouched = true; syncInviteBits(); });
  $('inv-cancel').addEventListener('click', closeInvite);
  $('inv-another').addEventListener('click', function () { hideResult(); inviteMode(false); $('inv-name').focus(); });
  $('copy').addEventListener('click', copyLink);
  $('send-wa').addEventListener('click', openWhatsApp);
  $('send-email').addEventListener('click', openMail);
  $('send-qr').addEventListener('click', showQr);
  $('done').addEventListener('click', closeInvite);
  $('refresh').addEventListener('click', fetchAll);
  $('connect-btn').addEventListener('click', function () {
    if (readConnect($('connect-link').value)) fetchAll(); else $('connect-link').value = '';
  });
  window.addEventListener('hashchange', function () { if (readConnect(location.hash)) fetchAll(); else if (/^#(resend|person)=/.test(location.hash)) openFromHash(); });
  // Leaving the page (or coming back to it from the back-forward cache) never keeps a link on screen or in memory.
  window.addEventListener('pagehide', function () { closeInvite(); closeView(); closeDevice(); }); // 2.6.0: a first-time code in a person's panel goes too; 2.7.0: a tablet's link
  window.addEventListener('pageshow', function (e) { if (e.persisted) { closeInvite(); closeView(); closeDevice(); } });
  $('device-add').addEventListener('click', function () { openDevice(null); });
  syncInviteBits();
  window.__people = { reload: fetchAll };
  fetchAll();
})();
