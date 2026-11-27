/*
 * Entries page (admin link only): every entry from the app, newest first, with who logged it.
 * Open one to fix a value or remove it. The sync script records each change in Raw log first
 * (old value, or a full copy of what was removed), checks everything before writing, and refuses
 * formula (✱) and ID columns. This page only asks; the script decides.
 */
(function () {
  'use strict';
  // The QuickBooks export moved to the Exports page (design plan, slice 4): an old bookmark goes there
  if (/^#quickbooks\b/.test(location.hash)) { location.replace('exports.html#quickbooks'); return; }

  /* ---------- connection ---------- */
  // The admin key is kept apart from the field app's setup link (ch.settings), so opening the admin
  // link in a browser never gives the field app on that device admin rights.
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
      return true;
    } catch (e) { return false; }
  }
  readConnect(location.hash); // the link leaves the address bar once the Sheet confirms it (so a failed first load can be retried)

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  var toastT;
  function icon(name, size) { return window.CH_ADMIN ? CH_ADMIN.icon(name, size) : null; }
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

  /* ---------- state ---------- */
  var S = { rows: {}, entries: [], columns: {}, openId: null, busy: false, more: false, next: null, total: 0, older: false,
    review: [], gen: 0, looking: false, openHeld: false }; // 1.24.2: the held entries the Sheet named, and the look further back for them (bringHeld)
  /** entries.html#entry=<entry ID> (the field app's "Fix on the Entries page"): that entry, as text, or null. */
  function entryInHash(h) {
    var m = /(?:^#|&)entry=([^&]*)/.exec(String(h || ''));
    if (!m) return null;
    try { return decodeURIComponent(m[1]) || null; } catch (e) { return null; }
  }
  S.wantEntry = entryInHash(location.hash); // opened and scrolled to once it is in the list (wantedEntry); not there: nothing happens
  var PAGE = 500; // the Sheet sends the newest entries 500 at a time; "Show older entries" asks for the next 500
  /** What the server said about paging (an older script sends everything and no paging fields). */
  function paging(en) { S.more = en.more === true; S.next = S.more ? en.next : null; S.total = typeof en.total === 'number' ? en.total : (en.entries || []).length; }
  // Each tab's key column and what one row is called come from the Sheet (action=entries, "columns").
  function keyOf(tab) { return (S.columns[tab] || {}).key || ''; }
  var FERMENT_TABS = ['Ferments', 'Intakes', 'Ferment checks', 'Drying log'];
  var CHANGE_FORMS = ['correction', 'removal', 'invite', 'revoke', 'list change', 'set password', 'shared links', 'platform', 'edit person', 'resend invite', 'company settings', 'admin email'];

  function fetchAll() {
    if (!settings.url || !settings.key) { showConnect(); return; }
    var A = window.CH_ADMIN, M = A && A.memo;
    var qe = M && !settings.unconfirmed && M.get('entries', settings.key), qd = M && !settings.unconfirmed && M.get('data', settings.key); // 2.5.0: its stamp goes with the next read (loadBoth)
    var shownAt = S.entries.length ? S.at : null;
    if (qe && qd && !S.entries.length) { // the last copy at once; the fresh one replaces it below
      $('connect').hidden = true; $('filters').hidden = false;
      S.entries = qe.data.entries || []; S.columns = qe.data.columns || {}; S.rows = qd.data.tabs || {}; paging(qe.data);
      shownAt = qe.data.at || qe.at;
      fillPeople(); draw();
    } else if (!S.entries.length && !settings.unconfirmed) { // 2.7.1: no copy yet: the filters and the list's place at once, only the entries wait
      $('connect').hidden = true; $('filters').hidden = false;
      if (!$('list').firstChild && A && A.ui) $('list').replaceChildren(A.ui.skeleton('rows', 4));
    }
    if (A && A.updated) A.updated($('updated'), shownAt, true); else $('updated').textContent = 'Loading…';
    // A refresh loads as many of the newest entries as were showing (at least one page, at most 2000), so an older entry being worked on stays in view.
    var limit = Math.min(2000, Math.max(PAGE, S.entries.length));
    loadBoth(limit, qd && qd.data, qe && qe.data) /* a copy of another page size simply gets the full answer */.then(function (res) {
      var en = res[0], da = res[1];
      if (!en.ok && (en.bad_key || /Wrong or missing app key/.test(en.error || ''))) {
        showConnect('The Sheet does not recognise this admin link. If its script was just updated, redeploy it (Apps Script → Deploy → Manage deployments → ✏️ → Version: New version → Deploy), then open a fresh admin link from the Cocoahead menu.');
        return;
      }
      if (en.retired) { showConnect('The shared admin link has been retired. Sign in with your own username and password.'); return; }
      if (!en.ok && en.suspended) { $('updated').textContent = ''; $('problem').hidden = false; $('problem-text').textContent = en.error; return; }
      if (!en.ok) { showConnect('This browser has an ordinary setup link, which can log entries but not change them.'); return; }
      if (!en.entries || !en.columns) { showConnect('The Sheet is running an older version of its script. Redeploy it (Apps Script → Deploy → Manage deployments → ✏️ → Version: New version → Deploy).'); return; }
      if (!da.ok) throw new Error(da.error || 'Could not read the Sheet.');
      if (settings.unconfirmed) { delete settings.unconfirmed; save('ch.admin', settings); if (window.CH_ADMIN) CH_ADMIN.showTabs(); }
      if (/#connect=/.test(location.hash)) history.replaceState(null, '', location.pathname);
      if (window.CH_SIGNIN) CH_SIGNIN.hide(); // an admin link that works: no sign-in needed
      $('connect').hidden = true; $('problem').hidden = true; $('filters').hidden = false;
      S.entries = en.entries || [];
      S.columns = en.columns || {};
      S.rows = da.tabs || {};
      S.review = Array.isArray(da.review) ? da.review : []; // every held entry, however old (admins only; Code.gs decides)
      S.gen++; S.older = false; S.looking = false;
      if (A && A.navHeld) A.navHeld(S.review.length); // the count beside Entries in the sidebar agrees with this page
      paging(en);
      if (M) { M.put('entries', settings.key, en); M.put('data', settings.key, da); }
      S.at = en.at;
      if (A && A.updated) A.updated($('updated'), en.at, false); else $('updated').textContent = 'Updated ' + new Date(en.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      fillPeople();
      draw();
      // Always the small budget here, whatever the filter: a page open or a Refresh never starts a long walk (review M1).
      // An entry asked for in the address (#entry=…) may be an old one that needs a look, so it is given up only after that (M3).
      bringHeld(LOOK.quiet, function () { S.wantEntry = null; }); // still not in the list: nothing happens
    }).catch(function (err) {
      if (A && A.updated) A.updated($('updated'), S.entries.length ? shownAt : null, false); else $('updated').textContent = '';
      if (!S.entries.length) $('list').replaceChildren();
      $('problem').hidden = false;
      $('problem-text').textContent = 'Could not load the entries (' + (err.message || err) + '). Check the internet connection and press Refresh.';
    });
  }

  /**
   * 2.5.0: entries and data in ONE request (read "bundle"), with the stamp of the quick copy of data when there is one, so an
   * unchanged Sheet sends only the entries. A script from before 2.4.6 does not know "bundle": then both are read on their own.
   * Resolves with [entries answer, data answer]; a refusal of the whole request (signed out, switched off) is both.
   */
  function loadBoth(limit, copy, copyEn) {
    var C = window.CH_CONFIG || {};
    var extra = { parts: ['entries', 'data'], limit: limit };
    var since = C.sinceOf && C.sinceOf(copy), sinceEn = C.sinceOf && C.sinceOf(copyEn);
    // 2.7.1: the stamps of both copies ({part: stamp}); a script from before 2.7.1 reads only a string, so it answers in full
    if (sinceEn) { extra.since = { entries: sinceEn.since }; if (since) extra.since.data = since.since; } else if (since) extra.since = since.since;
    var apart = function () { return Promise.all([get('entries', { limit: limit }), get('data')]); };
    return get('bundle', extra).then(function (b) {
      if (b && !b.ok && /^Unknown read/.test(String(b.error || ''))) return apart(); // an older script
      if (!b || !b.ok || !b.parts) return [b, b];
      var en = window.CH_SIGNIN ? CH_SIGNIN.guard(b.parts.entries) : b.parts.entries, da = b.parts.data;
      if (en && en.unchanged === true) en = (C.withCopy ? C.withCopy(en, copyEn, true) : null) || null;
      if (!en) return get('bundle', { parts: ['entries', 'data'], limit: limit }).then(function (f) { return f && f.ok && f.parts ? [f.parts.entries, f.parts.data] : [f, f]; }); // not for this copy: read both in full
      if (da && da.unchanged === true) {
        var full = C.withCopy ? C.withCopy(da, copy) : null;
        if (!full) return get('data').then(function (d) { return [en, d]; }); // not for this copy: read it in full
        da = full;
      }
      return [en, da];
    });
  }

  function showConnect(why) {
    if (window.CH_SIGNIN) CH_SIGNIN.show(); // admins sign in; the admin link stays as another way in
    $('connect').hidden = false;
    $('filters').hidden = true;
    $('list').replaceChildren();
    $('updated').textContent = '';
    if (why) { $('problem').hidden = false; $('problem-text').textContent = why; }
  }

  /* ---------- reading entries ---------- */
  function isChange(e) { return CHANGE_FORMS.indexOf(e.form) >= 0; }
  function title(e) {
    if (e.form === 'correction') return 'Fix';
    if (e.form === 'removal') return 'Removal';
    if (e.form === 'invite') return 'Person added';
    if (e.form === 'revoke') return 'Link switched off';
    if (e.form === 'list change') return 'Pick list changed';
    if (e.form === 'set password') return 'Sign-in password set';
    if (e.form === 'shared links') return 'Shared links switched';
    if (e.form === 'platform') return 'Batchstory';
    if (e.form === 'edit person') return 'Person changed';
    if (e.form === 'resend invite') return 'New link sent';
    if (e.form === 'company settings') return 'Company settings changed'; // 2.1.0
    if (e.form === 'admin email') return 'Admin email change';
    var f = CH.formById && CH.formById(e.form);
    return f ? f.title : (e.form || 'Entry');
  }
  function fermentOf(e) {
    var ops = e.ops || [];
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].row && ops[i].row['Ferment ID']) return String(ops[i].row['Ferment ID']);
      if (ops[i].op === 'update' && ops[i].tab === 'Ferments') return String(ops[i].key);
    }
    return '';
  }
  /** What an entry is about: "Roast 3.4-R2" for a row with an ID made on the device (not a ferment), else the ferment as before. */
  function subjectOf(e) {
    var ops = e.ops || [];
    for (var i = 0; i < ops.length; i++) {
      var c = S.columns[ops[i].tab];
      if (!c || !c.noun || c.auto || c.key === 'Ferment ID' || FERMENT_TABS.indexOf(ops[i].tab) >= 0) continue;
      var k = ops[i].op === 'update' ? ops[i].key : ops[i].row && ops[i].row[c.key];
      if (k !== undefined && k !== null && String(k) !== '') return c.noun + ' ' + k;
    }
    return fermentOf(e);
  }
  function num(v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v); }
  function summary(e) {
    if (isChange(e)) return e.message || '';
    var ops = e.ops || [];
    var rowsIn = function (tab) { return ops.filter(function (o) { return o.op === 'append' && o.tab === tab; }).map(function (o) { return o.row; }); };
    var intakes = rowsIn('Intakes');
    var lbs = intakes.reduce(function (s, r) { return s + (num(r['Wet lbs']) || 0); }, 0);
    var farms = intakes.map(function (r) { return r['Farm']; }).filter(Boolean).join(', ');
    if (e.form === 'new_ferment' || e.form === 'add_beans') return lbs + ' lbs wet' + (farms ? ' from ' + farms : '');
    if (e.form === 'ferment_check') {
      var c = rowsIn('Ferment checks')[0] || {};
      var centre = [1, 2, 3, 4, 5].map(function (i) { return num(c['Centre ' + i + ' °C']); }).filter(function (v) { return v !== null; });
      return [c['Stage'] === 'Turn' ? (c['Turn #'] ? 'Into box ' + (Number(c['Turn #']) + 1) : 'Next box') : c['Stage'], centre.length ? 'centre ' + Math.round(centre.reduce(function (a, b) { return a + b; }, 0) / centre.length * 10) / 10 + ' °C' : '', c['Colour'], c['Notes']].filter(Boolean).join(' · ');
    }
    if (e.form === 'drying_check') {
      var d = rowsIn('Drying log')[0] || {};
      return [d['Location'], d['Exterior state'] ? 'outside ' + String(d['Exterior state']).toLowerCase() : d['Exterior dry %'] != null && d['Exterior dry %'] !== '' ? d['Exterior dry %'] + '% outside dry' : '', d['Inside dryness'] ? 'inside ' + String(d['Inside dryness']).toLowerCase() : '', d['Observation']].filter(Boolean).join(' · ');
    }
    if (e.form === 'finish_drying') {
      var u = (ops.filter(function (o) { return o.op === 'update'; })[0] || {}).set || {};
      return [u['Dry lbs'] != null && u['Dry lbs'] !== '' ? u['Dry lbs'] + ' lbs dry' : '', u['Bags'] ? u['Bags'] + ' bags' : ''].filter(Boolean).join(' · ');
    }
    return '';
  }
  function when(e) {
    var s = e.created_at || e.received;
    var d = new Date(s);
    if (isNaN(d)) return s || '';
    return CH_PAGE.dayText(d) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  /** An entry's state, for the Status column and filter: saved, held for a look, fixed by hand in the Sheet, or removed. */
  function statusOf(e) {
    var s = String(e.status || '');
    if (/removed/.test(s)) return { key: 'removed', tone: '', text: 'Removed', removed: true };
    if (s === 'needs review') return { key: 'held', tone: 'bad', text: 'Needs a look' };
    if (s === 'received') return { key: 'held', tone: 'bad', text: 'Interrupted' };
    if (s === 'fixed') return { key: 'fixed', tone: 'info', text: 'Fixed by hand' };
    return { key: 'saved', tone: '', text: 'Saved' };
  }
  /** The area of the work a form belongs to (fermentation, roasting, making); changes made on the admin pages have none. */
  function areaOf(e) {
    if (isChange(e)) return '';
    var f = CH.formById && CH.formById(e.form);
    var a = f ? [].concat(f.area || [])[0] : '';
    return CH.areaKey ? CH.areaKey(a) : String(a || '');
  }
  function areaName(a) { return ((window.CH_CONFIG || {}).areas || {})[a] || (CH.AREA_TITLES || {})[a] || a; }

  /** The rows in the Sheet that this entry wrote, and which of their columns can be changed. */
  function ownedRows(e) {
    var out = [];
    var seen = {};
    (e.ops || []).forEach(function (op) {
      var rows = S.rows[op.tab] || [];
      var keyCol = keyOf(op.tab);
      var editable = ((S.columns[op.tab] || {}).editable) || [];
      if (op.op === 'append') {
        rows.forEach(function (r) {
          if (r['Source entry'] !== e.entry_id || seen[op.tab + r[keyCol]]) return;
          seen[op.tab + r[keyCol]] = true;
          out.push({ tab: op.tab, key: String(r[keyCol]), row: r, cols: editable, all: true });
        });
      } else if (op.op === 'update') {
        var r = rows.filter(function (x) { return String(x[keyCol]) === String(op.key); })[0];
        if (!r || seen[op.tab + op.key]) return;
        var cols = Object.keys(op.set || {}).filter(function (h) { return editable.indexOf(h) >= 0 && op.set[h] !== ''; });
        if (cols.length) out.push({ tab: op.tab, key: String(op.key), row: r, cols: cols, all: false });
      }
    });
    return out;
  }
  function rowLabel(o) {
    if (o.tab === 'Ferments') return 'Ferment ' + o.key + (o.all ? '' : ' (what this entry filled in)');
    if (o.tab === 'Intakes') return 'Delivery ' + o.key + (o.row['Farm'] ? ' · ' + o.row['Farm'] : '');
    if (o.tab === 'Ferment checks') return 'Check ' + o.key;
    if (o.tab === 'Drying log') return 'Drying note ' + o.key;
    return ((S.columns[o.tab] || {}).noun || o.tab) + ' ' + o.key + (o.all ? '' : ' (what this entry filled in)');
  }
  // Date and time pickers only when the Sheet's value already fits them, so the browser never blanks a value.
  function inputType(tab, col, orig) {
    var c = S.columns[tab] || {};
    if ((c.dates || []).indexOf(col) >= 0 && (orig === '' || /^\d{4}-\d{2}-\d{2}$/.test(orig))) return 'date';
    if ((c.times || []).indexOf(col) >= 0 && (orig === '' || /^\d{2}:\d{2}$/.test(orig))) return 'time';
    if (/note|observation|interior|treatment|setup/i.test(col)) return 'textarea';
    return 'text';
  }
  function isNumber(tab, col) { return ((S.columns[tab] || {}).numbers || []).indexOf(col) >= 0; }
  function asText(v) { return v === null || v === undefined ? '' : String(v); }

  /* ---------- drawing ---------- */
  // Design plan, slice 4: one list with column headings, sorting, search and filters. The rows stay <details class="e">.
  var UI = (window.CH_ADMIN && CH_ADMIN.ui) || {};
  var FILTERS = { kind: 'show', area: 'area', who: 'by', status: 'status', when: 'when' }; // select id: its name in the address
  var SORT = { key: 'when', dir: 'desc' };
  var FIRST_DIR = { when: 'desc', form: 'asc', about: 'asc', by: 'asc', status: 'asc' };
  var STATUS_RANK = { held: 0, fixed: 1, saved: 2, removed: 3 };
  var wanted = {}; // the view kept in the address (?show=…&status=…), applied once its option exists
  (function () {
    var p = new URLSearchParams(location.search);
    Object.keys(FILTERS).forEach(function (id) { if (p.get(FILTERS[id])) wanted[id] = p.get(FILTERS[id]); });
    if (p.get('q')) $('q').value = p.get('q');
    var m = /^(-?)(when|form|about|by|status)$/.exec(p.get('sort') || '');
    if (m) SORT = { key: m[2], dir: m[1] ? 'desc' : 'asc' };
    if (wanted.status === 'held' && S.wantEntry === null) S.openHeld = true; // from Home's "Needs attention": a single held entry opens
  })();

  function options(sel, list) { // [[value, text]]: put them in the box, keeping what was chosen if it is still there
    var cur = wanted[sel.id] != null ? wanted[sel.id] : sel.value;
    sel.replaceChildren.apply(sel, list.map(function (o) { return new Option(o[1], o[0]); }));
    if (list.some(function (o) { return o[0] === cur; })) { sel.value = cur; delete wanted[sel.id]; } else sel.value = list[0] ? list[0][0] : '';
  }
  /** Fills the filters from what is loaded: the people, the forms and the areas that have entries. */
  function fillPeople() {
    var field = S.entries.filter(function (e) { return !isChange(e); });
    var people = Array.from(new Set(field.map(function (e) { return e.by; }).filter(Boolean))).sort();
    options($('who'), [['', 'Everyone']].concat(people.map(function (p) { return [p, p]; })));
    var forms = {}, areas = {};
    field.forEach(function (e) { forms[e.form] = title(e); var a = areaOf(e); if (a) areas[a] = true; });
    var kind = $('kind'), group = $('kind-forms'), cur = wanted.kind != null ? wanted.kind : kind.value;
    group.replaceChildren.apply(group, Object.keys(forms).sort(function (a, b) { return forms[a].localeCompare(forms[b]); }).map(function (f) { return new Option(forms[f], 'f:' + f); }));
    kind.value = Array.prototype.some.call(kind.options, function (o) { return o.value === cur; }) ? cur : 'field';
    if (kind.value === cur) delete wanted.kind;
    options($('area'), [['', 'All areas']].concat((CH.AREAS || Object.keys(areas)).filter(function (a) { return areas[a]; }).map(function (a) { return [a, areaName(a)]; })));
    ['status', 'when'].forEach(function (id) { if (wanted[id] != null && Array.prototype.some.call($(id).options, function (o) { return o.value === wanted[id]; })) $(id).value = wanted[id]; delete wanted[id]; });
  }

  function stamp(e) { var d = new Date(e.created_at || e.received); return isNaN(d) ? null : d.getTime(); }
  /** "today", "7" or "30": whether the entry was made since the start of that many days ago (today counts as one). */
  function inWhen(e, w) {
    var t = stamp(e);
    if (t === null) return false;
    var start = new Date(); start.setHours(0, 0, 0, 0);
    if (w !== 'today') start.setDate(start.getDate() - (Number(w) - 1));
    return t >= start.getTime();
  }
  function matches(e) {
    var kind = $('kind').value, who = $('who').value, area = $('area').value, st = $('status').value, w = $('when').value, q = $('q').value.trim().toLowerCase();
    if (kind === 'field' && isChange(e)) return false;
    if (kind === 'changes' && !isChange(e)) return false;
    if (kind.slice(0, 2) === 'f:' && e.form !== kind.slice(2)) return false;
    if (area && areaOf(e) !== area) return false;
    if (who && e.by !== who) return false;
    if (st && statusOf(e).key !== st) return false;
    if (w && !inWhen(e, w)) return false;
    if (!q) return true;
    var hay = [title(e), subjectOf(e), e.by, summary(e), e.message, e.entry_id].concat((e.ops || []).map(function (o) { return o.row ? Object.keys(o.row).map(function (k) { return o.row[k]; }).join(' ') : ''; })).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function filtering() { return !!($('q').value.trim() || $('who').value || $('area').value || $('status').value || $('when').value || $('kind').value.slice(0, 2) === 'f:'); }
  function clearFilters() {
    $('q').value = ''; ['who', 'area', 'status', 'when'].forEach(function (id) { $(id).value = ''; });
    if ($('kind').value.slice(0, 2) === 'f:') $('kind').value = 'field';
    if (pager) pager.first(); draw(); $('q').focus();
  }
  /** The view in the address, so it can be bookmarked or sent (an admin link still being checked keeps its #connect). */
  function keepAddress() {
    var p = new URLSearchParams(location.search);
    if ($('q').value.trim()) p.set('q', $('q').value.trim()); else p.delete('q');
    Object.keys(FILTERS).forEach(function (id) { var v = $(id).value; if (v && !(id === 'kind' && v === 'field')) p.set(FILTERS[id], v); else p.delete(FILTERS[id]); });
    if (SORT.key !== 'when' || SORT.dir !== 'desc') p.set('sort', (SORT.dir === 'desc' ? '-' : '') + SORT.key); else p.delete('sort');
    var qs = p.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (err) { /* a file page: the address stays */ }
  }

  /** What an entry is about. A fix or removal is about the entry it changed. */
  function aboutOf(e, byId) {
    if (isChange(e) && e.about && byId && byId[e.about] && !isChange(byId[e.about])) return subjectOf(byId[e.about]);
    return isChange(e) ? '' : subjectOf(e);
  }
  function sorted(list, byId) {
    var key = SORT.key, sign = SORT.dir === 'desc' ? -1 : 1;
    var val = function (e) {
      if (key === 'when') return stamp(e);
      if (key === 'form') return title(e);
      if (key === 'about') return aboutOf(e, byId) || null;
      if (key === 'by') return e.by || null;
      return STATUS_RANK[statusOf(e).key];
    };
    var cmp = key === 'about' ? (UI.compareId || function (a, b) { return String(a).localeCompare(String(b)); })
      : key === 'when' || key === 'status' ? function (a, b) { return a - b; }
      : function (a, b) { return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }); };
    return list.map(function (e, n) { return { e: e, n: n, v: val(e), held: statusOf(e).key === 'held' }; }).sort(function (a, b) {
      if (a.held !== b.held) return a.held ? -1 : 1; // entries that need a look stay at the top, under their own heading
      var na = a.v === null || a.v === '', nb = b.v === null || b.v === '';
      if (na || nb) return na && nb ? a.n - b.n : na ? 1 : -1; // nothing recorded goes last, whichever way
      return sign * cmp(a.v, b.v) || a.n - b.n;
    }).map(function (x) { return x.e; });
  }
  /** The column headings: which one sorts, and which way, said in words for a screen reader too. */
  function drawHead() {
    Array.prototype.forEach.call($('e-head').querySelectorAll('button.sort'), function (b) {
      var k = b.getAttribute('data-key'), on = k === SORT.key, name = b.textContent;
      var words = k === 'when' ? (SORT.dir === 'desc' ? 'newest first' : 'oldest first') : k === 'status' ? (SORT.dir === 'asc' ? 'needs a look first' : 'removed first') : SORT.dir === 'asc' ? 'A to Z' : 'Z to A';
      b.setAttribute('data-dir', on ? SORT.dir : '');
      b.setAttribute('aria-label', name + (on ? ', sorted ' + words : ', sort by this'));
    });
  }

  var pager = UI.pager ? UI.pager({ key: 'entries', label: 'Entries', top: $('list').parentNode, onChange: function () { draw(); } }) : null;
  if (pager) $('list').parentNode.appendChild(pager.node);
  function draw() {
    var byId = Object.create(null);
    S.entries.forEach(function (e) { byId[e.entry_id] = e; });
    var list = sorted(S.entries.filter(matches), byId);
    $('count').textContent = list.length + (list.length === 1 ? ' entry' : ' entries') +
      (S.more ? ' · showing the newest ' + S.entries.length.toLocaleString('en-US') + ' of ' + S.total.toLocaleString('en-US') : '');
    var held = list.filter(isHeld).length;
    // arrived from "Needs attention" (?status=held), or pressed Show: exactly one held entry opens by itself
    if (S.openHeld && S.gen && !S.looking && !heldMissing()) { // only once the Sheet has answered (never from the kept copy alone)
      if ($('status').value === 'held' && list.length === 1 && S.wantEntry == null) S.wantEntry = String(list[0].entry_id);
      S.openHeld = false;
    }
    // app 1.25.0: pages instead of "Show more" (admin.js pager: 25 a page unless another number was chosen, remembered in this
    // browser). Entries that need a look are not paged: they stay on top of every page, under their own heading. Sorting,
    // search and filters work on everything loaded, then the result is paged.
    var pinned = held && held < list.length ? list.slice(0, held) : [], rest = pinned.length ? list.slice(held) : list;
    var wanted = null;
    if (S.wantEntry !== null && S.wantEntry !== undefined) {
      var at = -1;
      list.forEach(function (e, i) { if (at < 0 && String(e.entry_id) === S.wantEntry) at = i; });
      if (at >= 0) { wanted = S.wantEntry; if (pager && at >= pinned.length) pager.show(at - pinned.length); } // the page it is on
    }
    if (wanted !== null) { S.openId = wanted; S.wantEntry = null; }
    var r = pager ? pager.range(rest.length) : { from: 0, to: rest.length };
    var nodes = [];
    if (pinned.length) nodes.push(el('h2', { className: 'e-group', text: 'Needs a look · ' + held }));
    pinned.forEach(function (e) { nodes.push(card(e, byId)); });
    if (pinned.length) nodes.push(el('h2', { className: 'e-group', text: 'Everything else' }));
    rest.slice(r.from, r.to).forEach(function (e) { nodes.push(card(e, byId)); });
    if (!list.length) {
      var some = S.entries.length > 0;
      var clear = some && filtering() ? el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Clear the search and filters', onclick: clearFilters }) : null;
      nodes = [UI.empty ? UI.empty(some ? 'No matches' : 'No entries yet', some ? 'Try a different search or filter.' : 'They appear here as soon as the app sends them.', clear)
        : el('div', { className: 'empty', text: some ? 'No matches' : 'No entries yet' })];
    }
    if (S.more && r.to >= rest.length) {
      // the last page of what is loaded: the Sheet has older entries (the search and filters only cover what is loaded)
      nodes.push(el('div', { className: 'list-more' }, [
        filtering() ? el('p', { className: 'hint', id: 'older-note', text: 'The search covers the newest ' + S.entries.length.toLocaleString('en-US') + ' entries. Show older entries to search further back.' }) : null,
        el('button', { type: 'button', className: 'btn btn-secondary', id: 'older', text: S.older ? 'Loading older entries…' : 'Show older entries', disabled: S.older, onclick: loadOlder }),
      ]));
    }
    $('list').replaceChildren.apply($('list'), nodes);
    Object.keys(FILTERS).forEach(function (id) { var v = $(id).value; $(id).parentNode.classList.toggle('is-set', !!v && !(id === 'kind' && v === 'field')); }); // a filter that is on reads in bold
    drawHead();
    drawHeldNote();
    keepAddress();
    if (wanted !== null) wantedEntry(wanted);
    if (S.refocus) { // after a save or removal the list is drawn again: the keyboard goes back to the entry that was open
      S.refocus = false;
      var open = $('list').querySelector('details.e[open] > summary');
      if (open) open.focus({ preventScroll: true });
    }
  }

  /** The entry asked for in the address is open: bring it into view and put the keyboard on it. Compared as text (2.1 is not 2.10). */
  function wantedEntry(id) {
    var row = Array.prototype.filter.call($('list').querySelectorAll('details.e'), function (d) { return d.getAttribute('data-id') === id; })[0];
    if (!row) return;
    row.open = true;
    var sum = row.querySelector('summary');
    if (sum) sum.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'start' });
    // then clear of what sticks at the top (the app bar on a phone, the heading row)
    var cover = 0;
    [document.querySelector('.appbar'), $('e-head')].forEach(function (n) {
      if (!n || !n.getClientRects().length || getComputedStyle(n).position !== 'sticky') return;
      var r = n.getBoundingClientRect();
      if (r.top < 120 && r.bottom > cover) cover = r.bottom;
    });
    if (sum) window.scrollBy(0, sum.getBoundingClientRect().top - cover - 8);
  }

  /** The next page of older entries, added below the ones already showing. Resolves true when it was added to this list. */
  function older(limit) {
    var gen = S.gen;
    S.older = true; draw();
    return get('entries', { limit: limit, before: S.next }).then(function (en) {
      if (gen !== S.gen) return false; // the list was read again meanwhile: this page belongs to the old one
      S.older = false;
      if (!en.ok) throw new Error(en.error || 'The Sheet refused.');
      var have = {};
      S.entries.forEach(function (e) { have[e.entry_id] = true; });
      S.entries = S.entries.concat((en.entries || []).filter(function (e) { return !have[e.entry_id]; }));
      paging(en);
      fillPeople(); draw();
      return true;
    }, function (err) { if (gen === S.gen) S.older = false; throw err; });
  }
  function loadOlder() {
    if (S.older || !S.more || !S.next) return;
    older(PAGE).catch(function (err) {
      draw();
      toast('Could not load older entries (' + (err.message || err) + '). Try again.');
    });
  }

  /*
   * 1.24.2: entries held for checking are always in the list, however old. The list opens on the newest 500, and a held
   * entry can be far older than that (nobody filed it yet), so "Needs a look" on top used to miss it. The data read names
   * every held entry (S.review); the ones not loaded yet are fetched by reading further back, in the largest pages the
   * Sheet gives (2,000). On an ordinary open that is at most LOOK.quiet extra requests, and none at all in the usual case
   * (nothing held, or it is recent), whatever the filter or address, and the same on Refresh. Past that the notice says so and
   * only its button looks further (LOOK.asked more requests each press).
   */
  var LOOK = { quiet: 2, asked: 10, page: 2000 };
  function isHeld(e) { return statusOf(e).key === 'held'; }
  /** How many held entries the Sheet named that are not in the list yet (compared as text). */
  function heldMissing() {
    if (!S.more) return 0; // everything is loaded: the list itself is the answer
    var have = Object.create(null);
    S.entries.forEach(function (e) { have[String(e.entry_id)] = true; });
    return S.review.filter(function (r) { return r && r.entry_id !== undefined && r.entry_id !== '' && !have[String(r.entry_id)]; }).length;
  }
  function bringHeld(left, done) {
    var gen = S.gen;
    var end = function () { var was = S.looking; S.looking = false; if (was) draw(); if (done) done(); };
    if (!heldMissing() || !S.next || S.older || !(left > 0)) { end(); return; }
    S.looking = true;
    older(LOOK.page).then(function (ok) { if (ok) bringHeld(left - 1, done); /* not ok: the list was read again, and that read looks for itself */ }).catch(function (err) {
      if (gen !== S.gen) return; // an old read's error: the new one's state and words are left alone (review M2)
      end();
      toast('Could not look further back (' + (err.message || err) + '). Try again.');
    });
  }
  /** The notice's "Show": only the held entries, of every kind, with the other filters out of the way; a single one opens. */
  function showHeld() {
    $('q').value = ''; ['who', 'area', 'when'].forEach(function (id) { $(id).value = ''; });
    $('kind').value = 'all'; $('status').value = 'held';
    if (pager) pager.first(); S.openHeld = true;
    draw();
    bringHeld(LOOK.asked);
  }
  /** The calm line above the filters whenever anything needs a look: how many, and one button to get to them (or back to everything). */
  function drawHeldNote() {
    var loaded = S.entries.filter(isHeld).length, missing = heldMissing(), n = loaded + missing;
    var box = $('held-note');
    box.hidden = !n;
    if (!n) return;
    var only = $('status').value === 'held', go = $('held-go');
    $('held-what').textContent = only ? 'Showing ' + (n === 1 ? 'the 1 entry that needs a look' : 'the ' + n + ' entries that need a look') : n === 1 ? '1 entry needs a look' : n + ' entries need a look';
    var far = S.entries.length.toLocaleString('en-US');
    $('held-why').textContent = S.looking ? 'Looking further back for ' + (missing === 1 ? 'it' : 'them') + '…'
      : missing ? (missing === n ? (n === 1 ? 'It is' : 'They are') : missing + ' of them ' + (missing === 1 ? 'is' : 'are')) + ' older than the newest ' + far + ' entries.'
      : only ? '' : (n === 1 ? 'It arrived but could not be filed.' : 'They arrived but could not be filed.');
    var act = S.looking ? null : missing ? ['Look further back', function () { if (!only) showHeld(); else bringHeld(LOOK.asked); }]
      : only ? ['Show all entries', function () { $('kind').value = 'all'; clearFilters(); }] /* all of them, as it says: fixes and removals too (review M5) */ : ['Show', showHeld];
    go.hidden = !act;
    if (act) { go.textContent = act[0]; go.onclick = act[1]; }
  }

  function card(e, byId) {
    var st = statusOf(e);
    var fid = aboutOf(e, byId);
    var fixes = isChange(e) ? 0 : S.entries.filter(function (x) { return x.form === 'correction' && x.about === e.entry_id; }).length;
    var d = el('details', { className: 'e' + (st.removed ? ' is-removed' : '') + (st.key === 'held' ? ' is-held' : ''), 'data-id': e.entry_id });
    var tail = [summary(e) + (fixes ? ' (as first sent)' : ''), fixes ? (fixes === 1 ? 'fixed once since' : 'fixed ' + fixes + ' times since') : ''].filter(Boolean).join(' · ');
    var sumText = summary(e) || fixes ? tail : '';
    var pill = UI.pill ? UI.pill(st.tone, st.text) : el('span', { className: 'badge ' + st.tone, text: st.text });
    pill.className += ' chip is-' + st.key;
    d.appendChild(el('summary', {}, [
      el('span', { className: 't' }, [ // "Ferment check · 3.1": the form and what it is about (two columns on a laptop, one line on a phone)
        el('span', { className: 'form', text: title(e) }),
        fid ? el('span', { className: 'sep', text: ' · ' }) : null,
        el('span', { className: 'id fid', text: fid }),
      ]),
      el('span', { className: 'when', text: when(e) }),
      el('span', { className: 'by', text: e.by || '' }),
      el('span', { className: 'sum', text: sumText, title: sumText || null }),
      pill,
      el('span', { className: 'chev' }, [icon('chevron-right', 16)]),
    ]));
    var body = el('div', { className: 'body' });
    d.appendChild(body);
    d.addEventListener('toggle', function () {
      if (d.open) { S.openId = e.entry_id; if (!body.firstChild) fillBody(e, body); }
      else if (S.openId === e.entry_id) S.openId = null;
    });
    if (S.openId === e.entry_id) { d.open = true; fillBody(e, body); }
    return d;
  }

  /**
   * 1.24.2: why an entry needs a look and what to do about it, in an admin's words. The server's reason (e.message) is also
   * what the records keep and what the phone was told, so it is not changed there: it is put into plain words here. No
   * "the Sheet", "Raw log" or "README". A reason this does not know is shown as it is, with only those words swapped.
   * Returns {why, todo}. The advice is part of data safety (review I1), so three cases never get "log it again":
   *  - part of the entry was saved (interrupted, or "Already written before the error"): a second copy would double those rows;
   *  - "X already exists": it may be a DIFFERENT box or batch given the same number on another phone (rule 10), so it is
   *    compared first, and X is never to be changed to this entry's details;
   *  - the records lack a tab or column: logging again fails the same way until setup has been run.
   */
  function plainWords(m) {
    return String(m || '').replace(/,? so (it|this entry) is kept for checking\./, '.').replace(/ is kept for checking\./, ' needs a look.')
      .replace(/ ?\(see (the )?README\)/g, '').replace(/ ?Run setup\(\) (first|again)\.?/g, '')
      .replace(/\bthe Sheet\b/g, 'the records').replace(/\b(the )?Raw log\b/g, 'the record of entries').replace(/\bto the tabs\b/g, 'to the records').trim();
  }
  // What the server calls the things whose number the form picks or makes (Code.gs CFG.NOUNS): New ferment, Roast, Pack, Ship,
  // Start batch, Tasting note. Not "Arrival": Check in takes its number from the package.
  var MADE_IN_FORM = ['Ferment', 'Roast', 'Package', 'Shipment', 'Batch', 'Tasting note'];
  function heldWords(e) {
    var m = String(e.message || '').replace(/\s+/g, ' ').trim(), x;
    var updates = (e.ops || []).some(function (op) { return op && op.op === 'update'; });
    // an entry that changes a record already there (Finish drying, Unload…): sent again, it writes over what that record holds now (review R2)
    var again = 'If it was a mistake or a test, remove it below. If it should count, ' + (updates ? 'check the record first: logging it again replaces what is there now. Then log it again in the app and remove this one.' : 'log it again in the app, then remove this one.');
    var product = (window.CH_CONFIG && CH_CONFIG.brand && CH_CONFIG.brand.product) || 'the app';
    // part of it was saved: never "log it again"
    // …unless nothing of it is there: no row it made is in the records and it changes no record already there (review R3)
    var nothing = !updates && !ownedRows(e).length;
    var none = 'Nothing of it is in the records: if it should count, log it again, then remove this one.';
    var partly = 'Do not log it again: the part that was saved would be there twice. Check what was saved (shown below, or find it on this page) and complete it with Edit.';
    if ((x = /^(.*?)\.? Already written before the error: (.+)$/.exec(m))) {
      return { why: 'Saving it stopped part-way' + (x[1] ? ' (' + plainWords(x[1]) + ')' : '') + '. This part was saved: ' + plainWords(x[2]).replace(/\.$/, '') + '.' + (nothing ? ' That is no longer there.' : ''), todo: nothing ? none : partly, part: !nothing };
    }
    if (String(e.status || '') === 'received' || /interrupted/i.test(m)) {
      return nothing ? { why: 'Saving it was interrupted before anything was saved.', todo: none, part: false }
        : { why: 'Saving it was interrupted, so part of it may have been saved and part not.', todo: partly, part: true };
    }
    if ((x = /^(.+?) already exists\.( Pick a new ID or use "Add beans"\.?)?/.exec(m))) {
      var beans = /Add beans/.test(m);
      // "Log it again under a new number" only where the form itself picks or makes the number (MADE_IN_FORM). An arrival's
      // number is read off the package's label, and so is anything this list does not know: there is no new number to give,
      // so the advice is to ask whoever logged it before anything is removed.
      var own = MADE_IN_FORM.some(function (n) { return x[1].indexOf(n + ' ') === 0; });
      return { why: x[1] + ' is already in the records. This may be the same thing sent twice, or a different ' + (beans ? 'box' : 'one') + ' that was given the same number on another phone.',
        todo: 'Compare it with ' + x[1] + ' (what this entry holds is shown below). If they are the same, remove this copy. If they are different, ' +
          (own ? 'log this one again under a new number' + (beans ? ' (or with Add beans, if these beans went into ' + x[1] + ')' : '') + ', then remove this one.'
            : 'check with whoever logged it before removing anything.') + ' Do not change ' + x[1] + ' to match this entry.' };
    }
    // the records lack a tab or a column: nothing to log again until setup has been run
    var setup = 'Ask whoever set up ' + product + ' to run its setup again. Keep this entry until then: logging it again would stop the same way.';
    if ((x = /^(?:Tab is missing from the Sheet|Unknown tab): (.+)$/.exec(m))) return { why: 'The records have no place for "' + x[1] + '" yet.', todo: setup };
    if ((x = /^Column "(.+?)" is missing from (.+?)\./.exec(m))) return { why: 'The records have no "' + x[1] + '" column in ' + x[2] + ' yet.', todo: setup };
    if (/setup\(\)/.test(m)) return { why: plainWords(m), todo: setup };
    // Rule 10, both server wordings: X in the records is a DIFFERENT one, made on another phone, and this entry is about the
    // other one with the same number. Sent again under X it would write this one's figures onto X's record (review R1),
    // so the advice never says "log it again" without "a new number".
    if ((x = /^(.+?) in the (?:Sheet|records) was (?:started on another phone|made on another device)\./.exec(m))) {
      var kind = MADE_IN_FORM.filter(function (n) { return x[1].indexOf(n + ' ') === 0; })[0];
      var first = kind === 'Ferment' ? 'its New ferment entry' : kind ? 'the ' + kind + ' entry that made it' : '';
      return { why: x[1] + ' in the records is a different ' + (kind === 'Ferment' ? 'box' : 'one') + ', made on another phone. This entry is about another ' + (kind === 'Ferment' ? 'box' : 'one') + ' that was given the same number.',
        todo: 'Do not log it again under ' + x[1] + ': that would write this one\'s details onto the other. ' +
          (kind ? 'First give this one its own number (' + first + ' needs a look too: log that again under a new number), then log this entry under that new number and remove this one. If unsure, check with whoever logged it.'
            : 'Check with whoever logged it before removing anything.') };
    }
    if ((x = /^(.+?) has no row with (.+?) ID (.+)\.$/.exec(m))) {
      return { why: x[2] + ' ' + x[3] + ' is not in the records. It may have been removed, or the number was mistyped.', todo: again };
    }
    if (/^Waiting for an admin to file it\.?$/.test(m)) m = '';
    return { why: plainWords(m).replace(/\. Nothing was written to the records\.$/, '. Nothing was saved.'), todo: again };
  }
  /** What an entry that needs a look was sending (read only), so it can be compared with what is in the records. */
  function sentFacts(e) {
    var out = [];
    (e.ops || []).forEach(function (op) {
      var vals = op.row || op.set || {}, facts = el('dl', { className: 'facts' }), n = 0;
      Object.keys(vals).forEach(function (col) {
        var v = asText(vals[col]);
        if (v === '') return;
        n++; facts.appendChild(el('div', {}, [el('dt', { text: col }), el('dd', { text: v })]));
      });
      if (!n) return;
      var noun = (S.columns[op.tab] || {}).noun || op.tab, key = op.key !== undefined && op.key !== null ? String(op.key) : asText(vals[keyOf(op.tab)]);
      out.push(el('section', { className: 'e-rec e-sent' }, [el('h3', { text: 'What it holds: ' + noun + (key ? ' ' + key : '') }), facts]));
    });
    return out;
  }

  /**
   * App 1.25.0: an entry that needs a look, side by side with the record that already has its number ("Arrival 8.1-R1-P1 already
   * exists"), so the two can be compared without leaving the page: one row per detail, the ones that differ said in words, and
   * a link to the entry that filed the record. Read only: nothing here changes anything, and there is still no way to edit an
   * entry that was never filed. A part of the entry with no such record is shown as before (sentFacts).
   */
  function sameValue(tab, h, a, b) {
    a = asText(a).trim(); b = asText(b).trim();
    // 43.7 and 43.70 are the same weight, but only in a number column: in any other column (an ID) "2.1" is not "2.10" (rule 5)
    return a === b || (isNumber(tab, h) && isNumberText(a) && isNumberText(b) && Number(a) === Number(b));
  }
  function isNumberText(v) { return /^-?\d+(\.\d+)?$/.test(v); }
  function besideRecord(e) {
    var out = [], any = false;
    (e.ops || []).forEach(function (op) {
      var sent = op.row || null, keyCol = keyOf(op.tab), c = S.columns[op.tab] || {};
      var key = sent && keyCol && !c.auto ? asText(sent[keyCol]) : '';
      var rec = key === '' ? null : (S.rows[op.tab] || []).filter(function (r) { return String(r[keyCol]) === key; })[0]; // compared as text: 2.1 is not 2.10
      if (!rec) { sentFacts({ ops: [op] }).forEach(function (n) { out.push(n); }); return; }
      any = true;
      var name = (c.noun || op.tab) + ' ' + key, diff = [];
      // the details an entry fills in: what this one sent, and anything else a person can fill in on the record (never a worked-out column)
      var fillable = (c.editable || []).concat([keyCol, 'Recorded by']);
      var cols = Object.keys(rec).filter(function (h) { return h.charAt(0) !== '✱' && h !== 'Source entry' && (Object.prototype.hasOwnProperty.call(sent, h) || fillable.indexOf(h) >= 0); });
      Object.keys(sent).forEach(function (h) { if (cols.indexOf(h) < 0 && h !== 'Source entry') cols.push(h); });
      var rows = cols.filter(function (h) { return asText(sent[h]) !== '' || asText(rec[h]) !== ''; }).map(function (h) {
        // "Recorded by" is who logged each one: shown, never counted as a difference in the details (the entry holds no such column)
        var counts = h !== 'Recorded by' && h !== keyCol, same = !counts || sameValue(op.tab, h, sent[h], rec[h]);
        if (!same) diff.push(h);
        var a = el('td', { text: h === 'Recorded by' && asText(sent[h]) === '' ? asText(e.by) : asText(sent[h]) }), b = el('td', { text: asText(rec[h]) });
        if (a.textContent === '' && window.CH_ADMIN) CH_ADMIN.none(a);
        if (b.textContent === '' && window.CH_ADMIN) CH_ADMIN.none(b);
        return el('tr', { className: same ? null : 'is-diff' }, [el('th', { scope: 'row', text: h }), a, b, el('td', { className: 'cmp-note', text: same ? '' : 'Different' })]);
      });
      var maker = asText(rec['Source entry']) === '' ? null : S.entries.filter(function (x) { return String(x.entry_id) === String(rec['Source entry']); })[0];
      var open = maker ? el('a', { className: 'e-compare-open', href: 'entries.html#entry=' + encodeURIComponent(maker.entry_id), text: 'Open the entry that filed ' + name,
        onclick: function (ev) {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return; // a new tab opens it there
          ev.preventDefault();
          if (!matches(maker)) { $('q').value = ''; ['who', 'area', 'status', 'when'].forEach(function (id) { $(id).value = ''; }); $('kind').value = 'all'; } // the held-only view would hide it
          S.wantEntry = String(maker.entry_id); draw(); S.wantEntry = null;
        } }) : null;
      out.push(el('section', { className: 'e-rec e-compare' }, [
        el('h3', { text: 'This entry beside ' + name + ' in the records' }),
        el('p', { className: 'e-compare-sum', text: diff.length ? (diff.length === 1 ? '1 detail is different: ' : diff.length + ' details are different: ') + diff.join(', ') + '.' : 'Every detail is the same.' }),
        el('div', { className: 'tablebox' }, [el('div', { className: 'table-wrap' }, [el('table', { className: 'table e-compare-table' }, [
          el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Detail' }), el('th', { scope: 'col', text: 'This entry (not filed)' }), el('th', { scope: 'col', text: 'In the records now' }), el('th', { scope: 'col' }, [el('span', { className: 'sr-only', text: 'Same or different' })])])]),
          el('tbody', {}, rows),
        ])])]),
        el('p', { className: 'hint e-compare-from' }, maker ? [(maker.by ? 'Filed by ' + maker.by + ', ' : 'Filed ') + when(maker) + '. ', open]
          : [asText(rec['Source entry']) === '' ? 'The record was not filed from the app.' : 'The entry that filed it is older than the entries loaded on this page.']),
      ]));
    });
    return any ? out : [];
  }

  /**
   * An open entry: first what it filled in (read only), then Edit turns those into boxes with Save changes and Cancel
   * (design plan 3.4). Saving and removing work exactly as before: confirmed in the page, recorded first, re-checked.
   */
  function fillBody(e, body) {
    var kids = [];
    var st = String(e.status || '');
    var history = S.entries.filter(function (x) { return isChange(x) && x.about === e.entry_id; });
    if (isChange(e)) {
      kids.push(el('p', { text: e.message || '' }));
      if (e.form === 'removal') kids.push(el('p', { text: 'Word-for-word copies of the removed rows are in the Sheet\'s "Removed rows" tab, removal ' + e.entry_id + '.' }));
      body.replaceChildren.apply(body, kids);
      return;
    }
    if (st === 'needs review' || st === 'received') {
      var why = heldWords(e);
      kids.push(el('div', { className: 'notice bad' }, [icon('triangle-alert', 20), el('div', { className: 'notice-body' }, [
        el('span', { className: 'notice-title', text: why.part ? 'This entry arrived, but only part of it may have been filed.' : 'This entry arrived but was not filed.' }),
        why.why ? el('span', { className: 'held-reason', text: why.why }) : null,
        el('span', { className: 'held-todo', text: why.todo }),
      ])]));
      if (!ownedRows(e).length) {
        // nothing of it is in the records: show what it was sending, beside the record with the same number when there is one (app 1.25.0)
        var side = besideRecord(e);
        (side.length ? side : sentFacts(e)).forEach(function (n) { kids.push(n); });
        if (!why.part) kids.push(el('p', { className: 'hint e-noedit', text: 'There is no Edit here: this entry was never filed, so nothing of it is in the records to change. When the advice above is done, remove it.' }));
      }
    }
    if (/removed/.test(st)) {
      kids.push(el('p', { text: e.message || 'This entry was removed.' }));
      body.replaceChildren.apply(body, kids);
      return;
    }
    var owned = ownedRows(e);
    var inputs = [], reads = [], forms = [];
    owned.forEach(function (o) {
      // the read view: what is in the Sheet now, empty cells of a row this entry made left out
      var facts = el('dl', { className: 'facts' });
      var shown = 0;
      o.cols.forEach(function (col) {
        var v = asText(o.row[col]);
        if (o.all && v === '') return;
        shown++;
        var dd = el('dd', { text: v });
        if (v === '' && window.CH_ADMIN) CH_ADMIN.none(dd);
        facts.appendChild(el('div', { className: inputType(o.tab, col, v) === 'textarea' ? 'wide' : null }, [el('dt', { text: col }), dd]));
      });
      var read = el('section', { className: 'e-rec' }, [el('h3', { text: rowLabel(o) }), shown ? facts : el('p', { className: 'hint', text: 'Nothing filled in yet. Press Edit to fill it in.' })]);
      reads.push(read); kids.push(read);
      // the edit view, as before
      var fs = el('fieldset', { className: 'row', hidden: true }, [el('legend', { text: rowLabel(o) })]);
      var grid = el('div', { className: 'fields' });
      var empty = [];
      o.cols.forEach(function (col) {
        var orig = asText(o.row[col]);
        var type = inputType(o.tab, col, orig);
        var numeric = isNumber(o.tab, col);
        var id = 'f-' + e.entry_id.slice(0, 8) + '-' + o.tab.replace(/\W/g, '') + '-' + o.key.replace(/\W/g, '') + '-' + col.replace(/\W/g, '');
        var inp = type === 'textarea'
          ? el('textarea', { id: id, rows: Math.min(6, Math.max(2, orig.split('\n').length)) })
          : el('input', { id: id, type: type, inputmode: numeric ? 'decimal' : null, autocomplete: 'off' });
        inp.value = orig;
        var sheetValue = orig; // what the Sheet holds: sent as "from", so a value changed elsewhere is never overwritten
        orig = inp.value; // what the box shows, so an untouched box is never sent as a change
        var was = el('span', { className: 'was', hidden: true });
        var f = el('div', { className: 'f' }, [el('label', { for: id, text: col }), inp, was]);
        var rec = { o: o, col: col, input: inp, orig: orig, from: sheetValue, numeric: numeric, wrap: f, was: was };
        inp.addEventListener('input', function () { onEdit(rec, inputs, saveBtn); });
        inputs.push(rec);
        if (o.all && orig === '') { f.hidden = true; empty.push(f); }
        grid.appendChild(f);
      });
      fs.appendChild(grid);
      if (empty.length) {
        var more = el('button', { type: 'button', className: 'btn btn-ghost btn-sm', text: 'Show ' + empty.length + ' empty fields' });
        more.addEventListener('click', function () { empty.forEach(function (f) { f.hidden = false; }); more.remove(); });
        fs.appendChild(el('div', { className: 'more-row' }, [more]));
      }
      forms.push(fs); kids.push(fs);
    });
    if (!owned.length && st !== 'needs review') kids.push(el('p', { text: 'None of this entry\'s rows are in the Sheet any more (they may have been changed or removed by hand).' }));
    if (history.length) {
      kids.push(el('div', { className: 'history-wrap' }, [el('b', { text: 'Changes so far' }), el('ul', { className: 'history' }, history.map(function (h) { return el('li', { text: when(h) + ' · ' + (h.by || 'Admin') + ': ' + (h.message || '') }); }))]));
    }
    var photos = photoStrip(e); // P4-A
    if (photos) kids.push(photos);
    var confirmBox = el('div', { className: 'confirm', hidden: true });
    var editBtn = el('button', { type: 'button', className: 'btn btn-secondary e-edit' }, [icon('pencil', 16), 'Edit']);
    var saveBtn = el('button', { type: 'button', className: 'btn btn-primary', text: 'Save changes', disabled: true, hidden: true });
    var cancelBtn = el('button', { type: 'button', className: 'btn btn-ghost', text: 'Cancel editing', hidden: true }); // not just "Cancel": the save question below has its own
    function editing(on) {
      body.classList.toggle('is-editing', on);
      reads.forEach(function (r) { r.hidden = on; });
      forms.forEach(function (f) { f.hidden = !on; });
      editBtn.hidden = on; saveBtn.hidden = !on; cancelBtn.hidden = !on;
      if (on) { var first = body.querySelector('fieldset.row .f:not([hidden]) input, fieldset.row .f:not([hidden]) textarea'); if (first) first.focus(); }
    }
    function cancel() { // undo every change, close the boxes, and give the keyboard back to Edit
      inputs.forEach(function (r) { r.input.value = r.orig; onEdit(r, inputs, saveBtn); });
      confirmBox.hidden = true;
      editing(false); editBtn.focus();
    }
    editBtn.addEventListener('click', function () { editing(true); });
    cancelBtn.addEventListener('click', cancel);
    forms.forEach(function (f) { f.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.preventDefault(); cancel(); } }); });
    var removeBtn = el('button', { type: 'button', className: 'btn btn-danger-quiet remove', text: 'Remove this entry…' });
    confirmBox.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { confirmBox.hidden = true; removeBtn.focus(); } });
    saveBtn.addEventListener('click', function () { askSave(e, inputs, confirmBox); });
    removeBtn.addEventListener('click', function () { askRemove(e, confirmBox, removeBtn); });
    kids.push(el('div', { className: 'actions divided' }, [owned.length ? editBtn : null, owned.length ? saveBtn : null, owned.length ? cancelBtn : null, removeBtn]));
    kids.push(confirmBox);
    body.replaceChildren.apply(body, kids);
  }

  /**
   * P4-A: an entry's photos (a form with a photo question, while photos are switched on). Read from the server, admins only
   * (Code.gs checks), as data: images; never a Drive address. null when there is nothing to show.
   */
  function photoStrip(e) {
    var C = window.CH_CONFIG || {}, form = CH.formById ? CH.formById(e.form) : null;
    if (!C.photos || !window.CH_PHOTOS || !form || !form.fields.some(function (f) { return f.type === 'photo'; })) return null;
    var v = CH_PHOTOS.view({ ask: function (body) { body.key = settings.key; return ask(body); }, entry_id: e.entry_id, heading: 'Photos' });
    v.ready.then(function (n) { if (!n) v.node.hidden = true; });
    return v.node;
  }

  function onEdit(rec, inputs, saveBtn) {
    var changed = rec.input.value !== rec.orig;
    rec.wrap.classList.toggle('changed', changed);
    rec.was.hidden = !changed;
    rec.was.textContent = 'was ' + (rec.orig === '' ? '(blank)' : rec.orig);
    // A delivery's amount paid follows its weight and price, but only if it was weight × price to begin with
    // (a payment with a deduction is left alone), and it goes back to what it was if they do.
    if (rec.o.tab === 'Intakes' && (rec.col === 'Wet lbs' || rec.col === 'Price per lb (XCD)')) {
      var pick = function (c) { return inputs.filter(function (r) { return r.o === rec.o && r.col === c; })[0]; };
      var lbs = pick('Wet lbs'), price = pick('Price per lb (XCD)'), paid = pick('Amount paid (XCD)');
      if (lbs && price && paid) {
        var n = function (v) { return CH_CONFIG.toNumber(v); }; // as the Sheet reads it: "2,5" is 2.5, never 25 (config.js)
        var wasCalc = n(lbs.orig) !== null && n(price.orig) !== null && n(paid.orig) !== null && Math.abs(n(lbs.orig) * n(price.orig) - n(paid.orig)) < 0.01;
        var l = n(lbs.input.value), p = n(price.input.value);
        if (lbs.input.value === lbs.orig && price.input.value === price.orig) paid.input.value = paid.orig;
        else if (wasCalc && l !== null && p !== null) paid.input.value = String(Math.round(l * p * 100) / 100);
        var pc = paid.input.value !== paid.orig;
        if (pc) paid.wrap.hidden = false;
        paid.wrap.classList.toggle('changed', pc); paid.was.hidden = !pc;
        paid.was.textContent = 'was ' + (paid.orig === '' ? '(blank)' : paid.orig) + ' · worked out from weight × price';
      }
    }
    saveBtn.disabled = !inputs.some(function (r) { return r.input.value !== r.orig; });
  }

  function askSave(e, inputs, box) {
    var changes = [], problems = [];
    inputs.forEach(function (r) {
      if (r.input.value === r.orig) return;
      var v = r.input.value.trim();
      if (v === r.orig.trim()) return; // only spaces changed
      if (r.numeric && v !== '' && CH_CONFIG.toNumber(v) === null) problems.push(r.col + ': "' + v + '" is not a number.');
      changes.push({ tab: r.o.tab, key: r.o.key, col: r.col, value: v, from: r.from, shown: r.orig, label: rowLabel(r.o) });
    });
    if (problems.length) { showBox(box, 'bad', [el('p', { className: 'err', text: problems.join(' ') })]); return; }
    if (!changes.length) return;
    var actionId = uuid();
    var yes = el('button', { type: 'button', className: 'btn btn-primary', text: 'Yes, save' });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { box.hidden = true; } });
    var msg = el('p', { className: 'err', hidden: true });
    var fix = { action: 'correct', entry_id: actionId, about: e.entry_id, changes: changes.map(function (c) { return { tab: c.tab, key: c.key, col: c.col, from: c.from, value: c.value }; }) };
    yes.addEventListener('click', function () {
      // a delivery already in a QuickBooks file: the Sheet says so first, and the fix goes ahead only once the admin confirms it here
      send(yes, no, msg, fix, 'Saved. The Sheet is updated.', null, function () { fix.confirm_exported = true; });
    });
    showBox(box, '', [
      el('div', { className: 'confirm-title', tabindex: '-1', text: 'Save ' + (changes.length === 1 ? 'this change' : 'these ' + changes.length + ' changes') + '?' }),
      el('ul', {}, changes.map(function (c) { return el('li', { text: c.label + ': ' + c.col + ' ' + (c.shown === '' ? '(blank)' : c.shown) + ' → ' + (c.value === '' ? '(blank)' : c.value) }); })),
      el('span', { className: 'confirm-note', text: 'The old values are kept in the change history.' }),
      el('div', { className: 'confirm-actions' }, [no, yes]), msg,
    ]);
  }

  function askRemove(e, box, btn) {
    if (S.busy) return;
    var actionId = uuid();
    btn.disabled = true;
    showBox(box, 'bad', [el('span', { text: 'Checking what would be removed…' })]);
    post({ action: 'remove', entry_id: actionId, target: e.entry_id, dry_run: true }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { showBox(box, 'bad', [el('p', { className: 'err', text: r.error || 'That did not go through. Try again.' })]); return; }
      var p = r.plan;
      var items = p.rows.map(function (x) { return 'Remove ' + friendly(x); })
        .concat(p.clears.map(function (c) { return (c.to === '' || c.to == null ? 'Clear ' + c.col : 'Set ' + c.col + ' back to ' + c.to) + ' on ' + (c.tab === 'Ferments' ? 'ferment ' : FERMENT_TABS.indexOf(c.tab) >= 0 || !(S.columns[c.tab] || {}).noun ? c.tab + ' ' : S.columns[c.tab].noun.toLowerCase() + ' ') + c.key + ' (now ' + c.old + ')'; }));
      var others = p.entries.filter(function (id) { return id !== e.entry_id; }).length;
      var wholeFerment = p.rows.some(function (x) { return x.tab === 'Ferments'; });
      var sent = r.exported || []; // 2.4.1: deliveries in this entry that went into a QuickBooks file
      var yes = el('button', { type: 'button', className: 'btn btn-danger', text: sent.length ? 'Yes, remove it here too' : 'Yes, remove' });
      var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { box.hidden = true; } });
      var msg = el('p', { className: 'err', hidden: true });
      yes.addEventListener('click', function () {
        var body = { action: 'remove', entry_id: actionId, target: e.entry_id, token: r.token };
        if (sent.length) body.confirm_exported = true; // the warning above is shown in this same confirmation
        send(yes, no, msg, body, 'Removed. A copy is kept in the "Removed rows" tab.',
          function () { askRemove(e, box, btn); }, // something changed: ask again and show the new list
          function () { body.confirm_exported = true; }); // exported since the list was made: ask here first
      });
      showBox(box, 'bad', [
        el('div', { className: 'confirm-title', tabindex: '-1', text: 'Remove this entry?' }),
        items.length ? el('ul', {}, items.map(function (t) { return el('li', { text: t }); })) : el('span', { text: 'Nothing from it is in the tabs; it will just be marked as removed.' }),
        others && wholeFerment ? el('span', { text: 'This removes the whole ferment, so ' + others + (others === 1 ? ' other entry about it is' : ' other entries about it are') + ' marked as removed too.' }) : null,
        others && !wholeFerment ? el('span', { text: others + (others === 1 ? ' other entry only filled in cells on what is removed, so it is' : ' other entries only filled in cells on what is removed, so they are') + ' marked as removed too.' }) : null,
        sent.length ? exportedNote(sent) : null,
        el('span', { className: 'confirm-note', text: 'A word-for-word copy of every row goes into the Sheet\'s "Removed rows" tab first, so it can be put back by hand.' }),
        el('div', { className: 'confirm-actions' }, [no, yes]), msg,
      ]);
    }).catch(function (err) {
      btn.disabled = false;
      showBox(box, 'bad', [el('p', { className: 'err', text: 'No connection. Nothing was changed. Try again.' })]);
    });
  }

  function friendly(x) {
    var v = x.values || {};
    if (x.tab === 'Ferments') return 'ferment ' + x.key;
    if (x.tab === 'Intakes') return 'delivery ' + x.key + (v['Farm'] ? ' (' + v['Farm'] + (v['Wet lbs'] !== '' && v['Wet lbs'] != null ? ', ' + v['Wet lbs'] + ' lbs' : '') + ')' : '');
    if (x.tab === 'Ferment checks') return 'check ' + x.key + (v['Stage'] ? ' (' + (v['Stage'] === 'Turn' ? (v['Turn #'] ? 'into box ' + (Number(v['Turn #']) + 1) : 'next box') : v['Stage']) + ', ' + v['Date'] + ')' : '');
    if (x.tab === 'Drying log') return 'drying note ' + x.key + (v['Date'] ? ' (' + v['Date'] + ')' : '');
    return ((S.columns[x.tab] || {}).noun || x.tab).toLowerCase() + ' ' + x.key;
  }

  /** 2.4.1: "Exported to QuickBooks on 2026-11-12 (bill CH-I012). Change it in QuickBooks too." as a warning inside a confirmation. */
  function exportedWords(list) {
    return 'Exported to QuickBooks on ' + list.map(function (x) { return x.at + ' (bill ' + x.bill_no + ')'; }).join(', ') + '. Change it in QuickBooks too.';
  }
  function exportedNote(list, text) {
    return el('div', { className: 'notice warn qb-sent', role: 'status' }, [icon('triangle-alert', 20), el('div', { className: 'notice-body' }, [el('span', { text: text || exportedWords(list) })])]);
  }

  function showBox(box, cls, kids) {
    box.className = 'confirm' + (cls ? ' ' + cls : ''); box.replaceChildren.apply(box, kids.filter(Boolean)); box.hidden = false;
    var title = box.querySelector('.confirm-title');
    if (title) title.focus(); // keyboard and screen-reader users land on the question
  }

  function send(yes, no, msg, body, done, recheck, confirmExported) {
    if (S.busy) return;
    S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = 'Saving…'; yes.setAttribute('aria-busy', 'true');
    post(body).then(function (r) {
      S.busy = false;
      if (!r.ok && r.needs_confirm && confirmExported) { // 2.4.1: nothing was changed yet; say why and ask once more, in the page
        no.disabled = false; msg.hidden = true;
        msg.parentNode.insertBefore(exportedNote(r.exported || [], r.error), msg.previousSibling); // above the buttons
        var go = el('button', { type: 'button', className: 'btn btn-primary', text: 'Yes, save it here too' });
        go.addEventListener('click', function () { confirmExported(); send(go, no, msg, body, done, recheck, null); });
        yes.replaceWith(go); go.focus();
        return;
      }
      if (!r.ok) throw new Error(r.error || 'That did not go through. Try again.');
      if (r.status !== 'saved' && r.status !== 'duplicate') throw new Error(r.message || 'The Sheet did not confirm it. Check the Raw log.');
      toast(done);
      S.refocus = true;
      fetchAll();
    }).catch(function (err) {
      S.busy = false; yes.disabled = false; no.disabled = false; yes.removeAttribute('aria-busy');
      var text = String(err.message || err);
      msg.hidden = false;
      if (recheck && /changed since you looked/.test(text)) {
        msg.textContent = text;
        var again = el('button', { type: 'button', className: 'btn btn-danger', text: 'Check again', onclick: recheck });
        yes.replaceWith(again);
        return;
      }
      if (/changed since the page was opened/.test(text)) { msg.textContent = text; yes.remove(); return; }
      yes.textContent = 'Try again';
      msg.textContent = text + ' (Pressing it again is safe: it is never done twice.)';
    });
  }

  /* ---------- wiring ---------- */
  ['q', 'kind', 'area', 'who', 'status', 'when'].forEach(function (id) { $(id).addEventListener('input', function () { if (pager) pager.first(); draw(); }); });
  document.addEventListener('keydown', function (ev) { // "/" jumps to the search box, unless you are typing somewhere
    var t = ev.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (ev.key === '/' && !typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !$('filters').hidden) { ev.preventDefault(); $('q').focus(); }
  });
  $('e-head').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('button.sort') : null;
    if (!b) return;
    var k = b.getAttribute('data-key');
    SORT = k === SORT.key ? { key: k, dir: SORT.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: FIRST_DIR[k] };
    if (pager) pager.first();
    draw();
  });
  drawHead();
  // "Changes recorded as": a signed-in admin's own name, as a quiet line; a box to type a name only for the old shared admin link
  if (settings.session) {
    $('by').hidden = true; $('by-label').removeAttribute('for');
    $('by-name').textContent = settings.by || ''; $('by-name').hidden = !settings.by;
    $('byline').hidden = !settings.by;
  }
  $('by').value = settings.by || '';
  $('by').addEventListener('change', function () { settings.by = $('by').value.trim(); if (!settings.unconfirmed && settings.key) save('ch.admin', settings); });
  $('refresh').addEventListener('click', fetchAll);
  $('connect-btn').addEventListener('click', function () {
    if (readConnect($('connect-link').value)) fetchAll(); else $('connect-link').value = '';
  });
  // opening the admin link while this page is already open
  window.addEventListener('hashchange', function () {
    if (readConnect(location.hash)) { fetchAll(); return; }
    var id = entryInHash(location.hash);
    if (id !== null && S.entries.length) { S.wantEntry = id; draw(); S.wantEntry = null; }
  });
  window.__entries = { reload: fetchAll, words: heldWords };
  fetchAll();
})();
