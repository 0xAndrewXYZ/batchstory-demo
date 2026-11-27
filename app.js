/*
 * Cocoahead field app.
 * Saves every entry on the phone first, then sends it to the Google Sheet when there is
 * internet. Screens: home, a form, my entries, settings. Forms are defined in schema.js.
 */
(function () {
  'use strict';

  var APP_VERSION = '1.31.0';
  var BATCH = 5;
  var view = document.getElementById('view');
  var S = {
    settings: load('ch.settings', {}),
    lists: load('ch.lists', null),
    drafts: load('ch.drafts', {}), // 1.21.0: on a shared tablet, each person's own (ch.drafts.<User ID>), loaded when their turn starts
    entries: [],
    syncing: false,
    lastError: '',
    script: { v: '', url: '', asking: null }, // 1.29.2: the server's version as its last answer said, and that server's address (memory only; see knownVersion)
    gated: {}, // 1.29.2: entry IDs kept waiting at the last send because the server is older than they need (never stored)
  };
  if (!S.settings.device) { S.settings.device = 'device-' + uid().slice(0, 8); save('ch.settings', S.settings); }

  /* ---------------- small helpers ---------------- */

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  function uid() {
    if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowTime() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function when(iso) {
    var d = new Date(iso);
    return CH_PAGE.dayText(d) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'className') n.className = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  /** An inline Lucide icon as an svg element (decorative). */
  // Icons are decoration: if icons.js ever fails to load, the app still starts and works without them.
  var CFG = window.CH_CONFIG || { company: 'Cocoahead', product: 'Cocoahead', fieldAppName: 'Field Log', contact: 'Jake' }; // names: see config.js
  var ICON = typeof window.CH_ICON === 'function' ? window.CH_ICON : function () { return ''; };
  function svgEl(name, size) { var w = document.createElement('div'); w.innerHTML = ICON(name, size || 20); return w.firstChild || document.createElement('span'); }
  function ico(name, size) { return svgEl(name, size); }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.replaceChildren(ico('circle-check', 18), el('span', { text: msg })); t.hidden = false;
    t.classList.toggle('long', String(msg).length > 70); // looks only (app.css): a long message is set smaller, three lines at most
    // 1.24.0: the message lies over the top bar itself (app.css), so the page keeps no empty band for it and nothing
    // moves when it comes or goes. It goes by itself after a moment, so the sync state under it is never hidden for long.
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 2500);
  }
  function hideToast() { clearTimeout(toastTimer); var t = document.getElementById('toast'); if (t) t.hidden = true; }
  (function () { var t = document.getElementById('toast'); if (t) t.addEventListener('click', hideToast); })();
  var viewSeq = 0;     // goes up each time the screen is redrawn
  var swapping = false;
  function setView(nodes, title) {
    viewSeq++;
    document.documentElement.style.removeProperty('--savebar-h');
    // Removing a focused box fires its 'blur' handler in the middle of the swap; anything it asks for runs after (afterTap).
    swapping = true;
    try { view.replaceChildren.apply(view, nodes.filter(Boolean)); } finally { swapping = false; }
    document.title = (title ? title + ' · ' : '') + CFG.company + ' ' + CFG.fieldAppName;
    paintTabs();
    window.scrollTo(0, 0);
  }
  /**
   * The bottom bar (Home · My entries · Settings): which one is current, and how many entries wait. A form has its own
   * Save bar instead (body[data-screen="form"] hides this one), so the two never stack on a small phone.
   */
  function paintTabs() {
    var r = route(), name = view.querySelector('#savebar') ? 'form' : r.name === 'form' ? '' : r.name;
    document.body.setAttribute('data-screen', name || 'other');
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar .tab'), function (t) {
      if (t.getAttribute('data-tab') === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    var n = S.entries.filter(function (e) { return e.status === 'waiting'; }).length, c = document.getElementById('tab-count');
    if (c) { c.hidden = !n; c.textContent = n ? String(n) : ''; c.setAttribute('aria-label', n ? n + ' waiting' : ''); }
    paintTurnChip(); // 1.21.0: a shared tablet's name, or "Ann · Switch"
  }
  /*
   * Who this device logs as (1.17.0). Three ways, in this order:
   *  - "worker": the phone was connected with a link (an invite's join link, a personal link, or the old shared setup
   *    link). It always wins, so an admin who signs in on a worker's phone never takes it over without anyone noticing:
   *    the phone keeps logging as the worker, and its home screen says so.
   *  - "admin": no link, but an admin signed in in this browser (signin.html keeps {url, key: s_…, by, id, session: true}
   *    in localStorage "ch.admin"). The field app runs as that admin: their own name, locked, and every form the company
   *    has switched on. Entries are sent with the sign-in.
   *  - "none": neither. The welcome screen asks for the invite link (or an admin's sign-in). No name is typed and no
   *    form opens. Anything already saved on the device stays and is sent once it is connected.
   */
  function adminCred() { var a = load('ch.admin', null); return a && a.key && a.session ? a : null; }
  /*
   * 1.17.1: "Disconnect this device" on a phone where an admin once signed in lands on the welcome screen, not on the
   * admin: the sign-in is set aside (S.settings.skipAdmin, a fingerprint of that sign-in, never the sign-in itself) until
   * someone chooses "Log as …" there, or signs in afresh (a new sign-in has another fingerprint).
   */
  function fp(key) { var h = 5381, t = String(key || ''); for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function adminSetAside() { var a = adminCred(); return !!(a && S.settings.skipAdmin && S.settings.skipAdmin === fp(a.key)); }
  /*
   * 1.21.0: a fourth way, "shared": a shared tablet (opened with a shared device's #join=e_ link). It logs as nobody until
   * someone takes a turn with their PIN (TURN, below); every entry then carries that person's turn proof, and the
   * tablet's own key sends everyone's entries. See "Shared tablet" further down.
   */
  function mode() { if (S.settings.url && S.settings.key) return S.settings.shared ? 'shared' : 'worker'; return adminCred() && !adminSetAside() ? 'admin' : 'none'; }
  function connected() { return mode() !== 'none'; }
  function linked() { var m = mode(); return m === 'worker' || m === 'shared'; }
  function shared() { return mode() === 'shared'; }
  function sendKey() { var m = mode(); return m === 'worker' || m === 'shared' ? S.settings.key : m === 'admin' ? adminCred().key : ''; }
  /** The name entries are logged under: the worker's (from the link or typed with the shared link), the signed-in admin's, or (shared tablet) whose turn it is. */
  function person() {
    if (shared()) return TURN ? TURN.name : '';
    if (mode() !== 'admin') return S.settings.person || '';
    var a = adminCred();
    return String(a.by || '').trim() || 'Admin';
  }
  /** "Sign in" from the field app comes back to it (signin.html accepts next=app). why: a sentence from its fixed list. */
  function signinUrl(why) { return 'signin.html?next=app' + (why ? '&why=' + why : ''); }
  // Roles (set by a personal link; the old shared setup link has none and acts as "field"; a signed-in admin is "admin").
  function role() { return mode() === 'admin' ? 'admin' : S.settings.role || 'field'; }
  // The forms this person may use: their own areas (ticked on the People page, 2.0.0: from the join link and "me"),
  // else those of their role's areas (schema.js ROLE_AREAS). The script checks the same.
  function myForms() {
    if (shared()) return TURN && CH.formsForAreas ? CH.formsForAreas(TURN.areas || []) : []; // 1.21.0: the areas the person shares with the tablet (the script checks the same)
    if (role() !== 'admin' && Array.isArray(S.settings.areas) && CH.formsForAreas) return CH.formsForAreas(S.settings.areas);
    return CH.formsFor(role());
  }
  function mayUse(form) { return !!form && myForms().indexOf(form) >= 0; }
  function canLog() { return myForms().length > 0; }
  function nameLocked() { return mode() === 'admin' || shared() || !!(S.settings.locked && S.settings.person); }

  /* ---------------- lists and ferments ---------------- */

  function list(name) {
    var L = (S.lists && S.lists.lists) || {};
    return (L[name] && L[name].length ? L[name] : CH.DEFAULT_LISTS[name]) || [];
  }

  /** Ferments the phone knows: from the Sheet, plus new ones saved here and not yet confirmed. */
  // Does this device's own copy of an entry still matter, or does the Sheet's list already include it?
  // Waiting entries always count. Sent ones count only until the lists are read from the Sheet after the Sheet had them;
  // after that the Sheet is the truth, so rows removed there (e.g. test ferments) disappear here too.
  // Since 2.0.1 the lists name the entries the Sheet had received when it answered (recent, the last RECENT_DAYS days):
  // that decides, not this device's clock, so two browser tabs (an iPhone opens one per QR scan) never count an entry twice.
  var RECENT_DAYS = 7; // Code.gs CFG.RECENT_DAYS
  function inRecent(e) { var r = S.lists && S.lists.recent; return Array.isArray(r) && r.indexOf(e.entry_id) >= 0; }
  function notYetInLists(e) {
    if (e.status === 'waiting') return true;
    if (e.status !== 'sent') return false;
    var asked = S.lists && S.lists.asked;
    if (S.lists && Array.isArray(S.lists.recent)) {
      if (inRecent(e)) return false; // the Sheet had it when it answered: its list already counts it
      // older than the Sheet's list of recent entries (a day spare for clocks that differ): long counted there
      return !(asked && e.sent_at && Date.parse(e.sent_at) < Date.parse(asked) - (RECENT_DAYS - 1) * 864e5);
    }
    return !asked || !e.sent_at || e.sent_at >= asked; // an older script: compare with when the lists were asked for
  }

  function knownFerments() {
    var out = ((S.lists && S.lists.ferments) || []).map(function (f) { return Object.assign({}, f); });
    var ids = out.map(function (f) { return f.id; });
    S.entries.slice().reverse().forEach(function (e) {
      if (!notYetInLists(e)) return;
      if (e.form === 'new_ferment' && ids.indexOf(e.data.ferment) < 0) {
        out.push({ id: e.data.ferment, load_date: e.data.date, station: e.data.station || '', local: true, source: e.entry_id, last_turn: 0 }); // P1-C: its station starts the drying place
        ids.push(e.data.ferment);
      }
      if (e.form === 'finish_drying') {
        var f = out.filter(function (x) { return x.id === e.data.ferment; })[0];
        if (f) {
          f.bagged_date = f.bagged_date || e.data.bagged_date || 'done';
          if (f.dry_lbs === null || f.dry_lbs === undefined || f.dry_lbs === '') f.dry_lbs = Number(e.data.dry_lbs) || 0; // so the Roast form knows how much there is
        }
      }
      if (e.form === 'roast') { // beans put into the roaster on this device, not yet in the Sheet's list (P2-A: each "Beans from" line; an old entry is one line)
        CH.roastLines(e.data).forEach(function (x) {
          var rf = out.filter(function (f) { return f.id === x.ferment; })[0];
          if (!rf) return;
          rf.roasted_lbs = (Number(rf.roasted_lbs) || 0) + (Number(x.lbs) || 0);
          if (x.last === 'Yes') rf.roast_closed = true;
        });
      }
    });
    return out.sort(function (a, b) { return idKey(b.id) - idKey(a.id); });
  }
  /** Roasts, packages, batches… the device knows (field type 'ref'): from the Sheet's lists, plus ones made here not yet confirmed. */
  // skip: the entry ID of the draft being saved, so a save that is tried again never counts its own earlier copy.
  // Entries held for review count too, but only for what they made (their things exist; labels may be printed), never for
  // the lbs they used or packed: a held entry is not in the Sheet's numbers, so it must not lower "lbs left" here either.
  // The same for a waiting entry the Sheet already has (its answer was lost): the Sheet's list counts it.
  function idsOnly(e) { return e.status === 'review' || (e.status === 'waiting' && inRecent(e)); }
  function known(kind, skip) {
    var k = CH.KINDS[kind] || {};
    var mine = S.entries.filter(function (e) { return (notYetInLists(e) || e.status === 'review') && (!skip || e.entry_id !== skip); }).slice().reverse(); // oldest first
    return CH.knownItems(kind, (S.lists && k.list && S.lists[k.list]) || [], mine, idsOnly);
  }
  /**
   * Every ID of this kind ever used, as far as this device knows: the Sheet's "taken" list (removed and held ones
   * included), what the Sheet's lists offer, and every ID any entry on this device made, whatever its status.
   * New IDs never repeat one.
   */
  function taken(kind, skip) {
    var k = CH.KINDS[kind] || {};
    var out = ((S.lists && S.lists.taken && S.lists.taken[kind]) || []).map(String);
    var mine = S.entries.filter(function (e) { return !skip || e.entry_id !== skip; }).slice().reverse();
    CH.knownItems(kind, (S.lists && k.list && S.lists[k.list]) || [], mine).forEach(function (x) { if (out.indexOf(x.id) < 0) out.push(x.id); });
    return out;
  }
  /** What forms' default, check, prepare and open functions may look at. skip: see known(). */
  function formCtx(skip) {
    return { known: function (k) { return known(k, skip); }, taken: function (k) { return taken(k, skip); }, ferments: knownFerments, list: list, today: today, now: nowTime, role: role(), person: person(), entry: skip || '' }; // entry: the draft's own entry ID (Tasting note makes its number from it)
  }
  function idKey(id) { var m = String(id).match(/^(\d+)\.(\d+)$/); return m ? Number(m[1]) * 10000 + Number(m[2]) : 0; }
  function isOpen(f) { return !f.bagged_date && (f.dry_lbs === null || f.dry_lbs === undefined || f.dry_lbs === ''); }

  function lastTurn(fid) {
    var f = knownFerments().filter(function (x) { return x.id === fid; })[0];
    var n = f ? Number(f.last_turn) || 0 : 0;
    S.entries.forEach(function (e) {
      if (notYetInLists(e) && e.form === 'ferment_check' && e.data.ferment === fid && e.data.stage === 'Turn') {
        var t = e.data.box !== undefined && e.data.box !== '' ? Number(e.data.box) - 1 : Number(e.data.turn); // box = turn + 1
        n = Math.max(n, t || 0);
      }
    });
    return n;
  }
  function lastLocation(fid) {
    for (var i = 0; i < S.entries.length; i++) {
      var e = S.entries[i];
      if (e.form === 'drying_check' && e.data.ferment === fid && e.data.location) return e.data.location;
    }
    return '';
  }

  /** P1-C: the station a ferment's box is at (the Sheet's list, or this phone's own New ferment); '' when not known. */
  function stationOf(fid) {
    var f = knownFerments().filter(function (x) { return x.id === fid; })[0];
    return f && f.station ? String(f.station) : '';
  }

  function resolveDefault(field, data) {
    var d = field.default;
    if (d === 'today') return today();
    if (d === 'now') return nowTime();
    if (d === 'nextFermentId') return CH.nextFermentId(knownFerments().map(function (f) { return f.id; }), list('Current season')[0]);
    if (d === 'fermentId') return data.ferment || '';
    if (d === 'nextTurn') return data.ferment ? String(lastTurn(data.ferment) + 1) : '';
    if (d === 'nextBox') return data.ferment ? String(lastTurn(data.ferment) + 2) : ''; // loaded into box 1; each move goes one box on
    if (d === 'lastLocation') return data.ferment ? lastLocation(data.ferment) : '';
    if (d === 'dryingPlace') return data.ferment ? lastLocation(data.ferment) || stationOf(data.ferment) : ''; // P1-C: the last place logged here, else the ferment's station
    if (d === 'stationList') return data.ferment && stationOf(data.ferment) ? [stationOf(data.ferment)] : []; // P1-C: Unload starts with the station ticked
    if (typeof d === 'function') return d(data, formCtx());
    return d === undefined ? undefined : d;
  }
  /** Re-work suggestions that depend on which ferment is chosen (and, for newer forms, fields with dependsOn: the key that changed). */
  var curDraft = null; // the answers of the form on screen (set by renderForm), also before the first change is kept as a draft
  function refreshDependent(data, changedKey) {
    var form = CH.formById(route().id);
    var draft = form ? S.drafts[form.id] || curDraft : null;
    (form ? form.fields : []).forEach(function (ff) {
      if (ff.type === 'repeat') { // one row of a list (a package in Start batch) whose answer changed: its own questions that depend on it
        if (changedKey && draft && data !== draft && (draft[ff.key] || []).indexOf(data) >= 0) ff.fields.forEach(function (sf) { if (sf.dependsOn === changedKey) data[sf.key] = resolveDefault(sf, data); });
        return;
      }
      if (data !== draft && draft) return; // a row of a list: only the list's own questions above
      if (['nextTurn', 'nextBox', 'lastLocation', 'dryingPlace', 'stationList', 'fermentId'].indexOf(ff.default) >= 0) data[ff.key] = resolveDefault(ff, data);
      else if (changedKey && ff.dependsOn === changedKey) data[ff.key] = resolveDefault(ff, data);
    });
  }

  /* ---------------- connecting a phone ---------------- */

  function goodUrl(u) { return CFG.goodScriptUrl ? CFG.goodScriptUrl(u) : /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '')); }
  /** Phase 2 review nit: a held entry's reason as a worker reads it: the admin's "Fix it on the Entries page." becomes who will look at it. Admins keep the detail. */
  function heldWords(msg) {
    msg = String(msg || '');
    if (mode() === 'admin' || !/(Fix (it|its [A-Za-z ]+) on the Entries page|Remove [^.]* first)\.\s*$/.test(msg)) return msg;
    return msg.replace(/\s*(Fix (it|its [A-Za-z ]+) on the Entries page|Remove [^.]* first)\.\s*$/, '') + ' ' + CFG.contact + ' will look at it.';
  }
  function badLinkWords() { return 'This link does not belong to this app. Nothing was changed. Ask ' + CFG.contact + ' for a new one.'; }
  function readConnect(text) {
    S.badLink = false;
    var m = String(text || '').match(/#connect=([A-Za-z0-9_\-=]+)/);
    if (!m) return false;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }))) /* UTF-8, so names like José survive */;
      if (!j.url || !j.key) return false;
      if (!goodUrl(j.url)) { S.badLink = true; return false; } // a link that points anywhere but our server is never kept
      S.settings.url = j.url; S.settings.key = j.key;
      dropRecords(); // 1.26.1: the records kept for the old link are not this person's
      // A personal link carries the person's name and role: the name is locked, the role decides which forms show.
      if (j.name) { S.settings.person = String(j.name); S.settings.locked = true; } else { delete S.settings.locked; }
      if (j.role) S.settings.role = String(j.role); else delete S.settings.role;
      delete S.settings.areas; // an older link: its role decides (the next sync brings "me" if the person has ticks)
      delete S.settings.uid; // 1.17.1: whose link this is comes with "me" (an old link has no user ID in it)
      delete S.settings.revoked; delete S.settings.replaced; // a new link: try again
      save('ch.settings', S.settings);
      if (S.syncing) S.syncAgain = true; // a send under the old link is still running: send again with this one once it ends
      return true;
    } catch (e) { return false; }
  }

  /*
   * Join links (2.0.0): #join=j_… from an invite (email, WhatsApp, QR or Copy). The token is taken out of the address
   * at once and kept only in memory; the phone posts it once (join) and gets its own key back, then stores url, key,
   * name, role and areas exactly as a #connect link does. No signal or any problem: nothing on this phone changes and
   * no entry is touched. An expired link offers "Ask for a new invite". The key itself is never in a link.
   */
  function joinToken(text) { var m = String(text || '').match(/#join=([je]_[0-9a-f]{64})(?![0-9a-f])/); return m ? m[1] : ''; } // 1.21.0: e_ is a shared device's link
  function joinAddress() { return (CFG.scriptFor ? CFG.scriptFor(S.settings.url) : S.settings.url) || CFG.scriptUrl || ''; }
  /*
   * 1.20.0: what this device calls itself when it joins (People shows it; the person can rename it). A guess from the
   * browser, never sent anywhere else.
   */
  function deviceKind() {
    var ua = String(navigator.userAgent || '');
    if (/iPad|Tablet|SM-T|Tab\b|Kindle|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'Tablet';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android phone';
    return 'Laptop';
  }
  /** A typed add-device code (1.20.0): 8 letters and digits, dashes and spaces ignored; '' if it cannot be one. */
  function codeOf(text) { var c = String(text || '').toUpperCase().replace(/[\s-]+/g, ''); return /^[A-HJ-NP-Z2-9]{8}$/.test(c) ? c : ''; }
  function startJoin(token, code, sure) {
    // 1.21.0: a shared tablet never takes a person's own link (it would log everything as them): it says so and changes nothing
    if (shared() && (code || /^j_/.test(token || ''))) { S.join = { state: 'shared-own', token: '' }; render(); return Promise.resolve(); }
    // a shared device's link on a device that has someone's link: asked first in the page, then their entries go first
    if (/^e_/.test(token || '') && !sure && mode() === 'worker' && !S.settings.shared) { S.join = { state: 'make-shared', token: token }; render(); return Promise.resolve(); }
    S.join = { state: 'connecting', token: token || '', code: code || '' };
    render();
    var at = joinAddress();
    var again = { token: token || '', code: code || '' };
    if (!at) { S.join = Object.assign({ state: 'failed' }, again); render(); return Promise.resolve(); }
    var ask = token ? { action: 'join', token: token, device_name: deviceKind() } : { action: 'join', code: code, device_name: deviceKind() };
    return fetchT(at, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(ask) }, 30000)
      .then(function (r) { return r.text(); })
      .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } return j; })
      .then(function (j) {
        if (j && j.ok && j.key && j.shared && /^e_/.test(token || '')) return becomeShared(j, at);
        if (j && j.ok && j.key) {
          var url = j.url && goodUrl(j.url) ? j.url : at;
          if (!goodUrl(url)) { S.join = { state: 'failed', token: token }; render(); return null; }
          S.settings.url = url; S.settings.key = String(j.key);
          dropRecords(); // 1.26.1: the records kept for the old link are not this person's
          if (j.name) { S.settings.person = String(j.name); S.settings.locked = true; }
          if (j.role) S.settings.role = String(j.role); else delete S.settings.role;
          if (Array.isArray(j.areas)) S.settings.areas = j.areas.map(String); else delete S.settings.areas;
          if (j.user_id) S.settings.uid = String(j.user_id); else delete S.settings.uid; // 1.17.1: whose entries are whose (personalFor)
          setDevice(j.device);
          delete S.settings.devices; // the list comes with the next lists read
          delete S.settings.revoked; delete S.settings.replaced;
          save('ch.settings', S.settings);
          S.join = null;
          toast('Connected. Sending entries…');
          if (S.syncing) { S.syncAgain = true; render(); return null; } // a send under the old link is still running: send again with this one once it ends
          return sync(true);
        }
        if (j && j.suspended) { setPaused(j); S.join = { state: 'paused', token: '' }; render(); return null; }
        if (j && j.too_many) { S.join = { state: 'full', token: '', words: String(j.error || '') }; render(); return null; } // 1.20.0: 5 devices already
        if (j && j.expired) { S.join = Object.assign({ state: code ? 'badcode' : 'expired' }, again); render(); return null; }
        S.join = Object.assign({ state: 'failed' }, again); render(); return null; // busy, or an answer we do not know: try again later
      })
      .catch(function () { S.join = Object.assign({ state: 'failed' }, again); render(); });
  }
  /** 1.20.0: this device's own ID and name on the server (D002, "Android phone"), from join and "me". Never a secret. */
  function setDevice(d) {
    if (d && typeof d === 'object' && /^D\d+$/.test(String(d.id || ''))) { S.settings.device_id = String(d.id); S.settings.device_name = String(d.name || '').slice(0, 30); }
    else { delete S.settings.device_id; delete S.settings.device_name; }
  }
  function askInvite() {
    var j = S.join;
    if (!j || !j.token) return;
    j.asking = true; render();
    fetchT(joinAddress(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'ask_invite', token: j.token }) }, 30000)
      .then(function (r) { return r.json(); })
      .then(function (a) {
        if (!a || a.ok === false) throw new Error('not yet');
        S.join = { state: 'asked', token: '', contact: (a && a.contact) || CFG.contact };
        render();
      })
      .catch(function () { j.asking = false; j.askFailed = true; render(); });
  }
  /** "me" from lists (2.0.0): a rename or new ticks reach this phone with no new link. */
  function applyMe(me, key) {
    if (!me || typeof me !== 'object') return;
    if (me.money === false) recordsMoneyOff(); // review fix: "Can see money" was taken away: a kept copy with prices goes
    if (mode() === 'admin') { // 1.17.0: a signed-in admin: their Users name (a rename on People reaches this browser too)
      var a = adminCred();
      if (!a || a.key !== key) return; // another tab signed in as someone else meanwhile
      var name = String(me.name || '').trim(), id = String(me.id || '');
      if ((name && a.by !== name) || (id && a.id !== id)) { if (name) a.by = name; if (id) a.id = id; save('ch.admin', a); }
      return;
    }
    var changed = false;
    if (me.id && S.settings.uid !== String(me.id)) { S.settings.uid = String(me.id); changed = true; } // 1.17.1: whose link this is
    if (S.settings.locked && me.name && S.settings.person !== String(me.name)) { S.settings.person = String(me.name); changed = true; }
    if (me.role && S.settings.role !== String(me.role)) { S.settings.role = String(me.role); changed = true; }
    if (Array.isArray(me.areas) && JSON.stringify(S.settings.areas || null) !== JSON.stringify(me.areas.map(String))) { S.settings.areas = me.areas.map(String); changed = true; }
    // 1.20.0: Settings → Your devices (names, when last used, which is this one; no secret)
    if (me.device && me.device.id && (S.settings.device_id !== String(me.device.id) || S.settings.device_name !== String(me.device.name || ''))) { setDevice(me.device); changed = true; }
    if (Array.isArray(me.devices)) {
      var list = me.devices.slice(0, 20).map(function (d) { return { id: String(d.id || ''), name: String(d.name || ''), this: !!d.this, last_seen: String(d.last_seen || ''), off: !!d.off, joined: !!d.joined }; });
      if (JSON.stringify(S.settings.devices || null) !== JSON.stringify(list)) { S.settings.devices = list; changed = true; }
      if (me.device_max && S.settings.device_max !== Number(me.device_max)) { S.settings.device_max = Number(me.device_max); changed = true; }
    }
    if (typeof me.pin === 'boolean' && (!!S.settings.pin !== me.pin || (S.settings.pin_set || '') !== String(me.pin_set || ''))) { S.settings.pin = me.pin; S.settings.pin_set = String(me.pin_set || ''); changed = true; } // 2.6.0: whether they have a PIN (never the PIN)
    if (changed) save('ch.settings', S.settings);
  }
  function renderJoin() {
    var j = S.join, nodes;
    var done = function () { S.join = null; history.replaceState(null, '', location.pathname + '#/'); render(); };
    if (j.state === 'connecting') {
      nodes = [el('div', { className: 'notice info', role: 'status', id: 'join-connecting' }, [svgEl('loader-circle', 20), el('div', { className: 'notice-body' }, [el('div', { className: 'notice-title', text: 'Connecting…' }), el('span', { text: 'One moment. Keep this screen open.' })])])];
    } else if (j.state === 'expired') {
      nodes = [el('div', { className: 'notice warn', role: 'alert', id: 'join-expired' }, [svgEl('clock', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'This link has expired.' }),
        el('span', { text: 'Ask for a new one and ' + CFG.contact + ' will send it to you. Anything already saved on this phone stays here.' }),
        j.askFailed ? el('span', { className: 'err', text: 'No connection. Try again when you have signal.' }) : null,
        el('div', { className: 'notice-actions' }, [el('button', { className: 'btn btn-primary', type: 'button', id: 'ask-invite', disabled: !!j.asking, text: j.asking ? 'Asking…' : 'Ask for a new invite', onclick: askInvite })]),
      ])]), el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'join-close', text: 'Close', onclick: done })];
    } else if (j.state === 'asked') {
      nodes = [el('div', { className: 'notice ok', role: 'status', id: 'join-asked' }, [svgEl('circle-check', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'We\'ve told ' + (j.contact || CFG.contact) + '.' }),
        el('span', { text: 'Open the new link on this phone when it comes.' }),
      ])]), el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'join-close', text: 'OK', onclick: done })];
    } else if (j.state === 'shared-own') {
      nodes = [el('div', { className: 'notice warn', role: 'alert', id: 'join-shared-own' }, [svgEl('info', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'This is a shared tablet.' }),
        el('span', { text: 'Your own link is for your own phone. Here, tap your name and type your PIN. Nothing on this tablet was changed.' }),
      ])]), el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'join-close', text: 'OK', onclick: done })];
    } else if (j.state === 'make-shared') {
      var owner = S.settings.person || 'this phone\'s person';
      nodes = [el('div', { className: 'notice warn', role: 'alert', id: 'join-make-shared' }, [svgEl('users', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'Make this a shared tablet?' }),
        el('span', { text: owner + '\'s link is removed from it. Their entries are sent first; anything that cannot be sent stays here and is checked by ' + CFG.contact + '. Then people take turns on it with their PIN.' }),
        el('div', { className: 'notice-actions' }, [el('button', { className: 'btn btn-primary', type: 'button', id: 'make-shared-yes', text: 'Yes, make it shared', onclick: function () { this.disabled = true; makeShared(j.token); } })]),
      ])]), el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'join-close', text: 'No, keep it as it is', onclick: done })];
    } else if (j.state === 'full') {
      nodes = [el('div', { className: 'notice warn', role: 'alert', id: 'join-full' }, [svgEl('triangle-alert', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'This device could not be added.' }),
        el('span', { text: (j.words || '') + ' Anything already saved on this device stays here.' }),
      ])]), el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'join-close', text: 'OK', onclick: done })];
    } else if (j.state === 'badcode') {
      nodes = [el('div', { className: 'notice warn', role: 'alert', id: 'join-badcode' }, [svgEl('clock', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'That code did not work.' }),
        el('span', { text: 'A code works once, for 15 minutes. Check the letters, or make a new one on your other device (Settings → Your devices → Add another device). Anything already saved here stays here.' }),
      ])]), el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'join-close', text: 'OK', onclick: done })];
    } else if (j.state === 'paused') {
      nodes = [el('div', { className: 'notice warn', role: 'alert', id: 'join-paused' }, [svgEl('triangle-alert', 20), el('div', { className: 'notice-body' }, [el('div', { className: 'notice-title', text: pausedWords() })])]),
        el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'join-close', text: 'OK', onclick: done })];
    } else {
      nodes = [el('div', { className: 'notice warn', role: 'alert', id: 'join-failed' }, [svgEl('wifi-off', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'Could not connect just now.' }),
        el('span', { text: 'Nothing on this phone was changed. Open the link again when you have signal.' }),
        el('div', { className: 'notice-actions' }, [el('button', { className: 'btn btn-primary', type: 'button', id: 'join-retry', text: 'Try again', onclick: function () { startJoin(j.token, j.code); } })]),
      ])]), el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'join-close', text: 'Close', onclick: done })];
    }
    setView([el('div', { className: 'page-head' }, [el('h1', { text: 'Your link' })])].concat(nodes), 'Your link');
  }

  /* ---------------- sending to the Sheet ---------------- */

  function fetchT(url, opts, ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms || 90000);
    return fetch(url, Object.assign({ signal: ctl.signal, redirect: 'follow' }, opts)).finally(function () { clearTimeout(t); });
  }

  /** The Sheet always answers with JSON. Anything else (usually a Google sign-in page) means the setup link is wrong. */
  function readJson(r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) {
        var err = new Error('This link is not working. Ask ' + CFG.contact + ' for a new one.');
        err.fatal = true;
        throw err;
      }
    });
  }

  /** The Sheet said this link was switched off. Nothing is dropped: unsent entries stay waiting on this phone. */
  function revokedError(j) {
    var err = new Error(j && j.retired ? 'This shared link has been retired. Ask ' + CFG.contact + ' for your own link.'
      : j && j.replaced ? 'This link was opened on another phone, so it stopped working here. Ask ' + CFG.contact + ' for a new one.'
      : 'This link was switched off. Ask ' + CFG.contact + ' for a new one.');
    err.fatal = true; err.revoked = true; err.replaced = !!(j && j.replaced);
    return err;
  }
  /*
   * The company is paused (suspended by Batchstory). Entries made on this phone before the pause still send; later ones
   * are kept here, waiting, and send when it is back on. No new entries can be made meanwhile. Tried again as usual.
   */
  function paused() { return S.settings.paused || null; }
  function pausedWords() { var p = paused() || {}; return (p.company || CFG.company) + ' is paused. Ask ' + (p.contact || CFG.contact) + '.'; }
  function setPaused(j) {
    var c = (j && j.company) || {};
    S.settings.paused = { company: String(c.name || CFG.company), contact: String(c.contact || CFG.contact) };
    save('ch.settings', S.settings);
  }
  function clearPaused() { if (S.settings.paused) { delete S.settings.paused; save('ch.settings', S.settings); } }
  function pausedError() {
    var err = new Error(pausedWords());
    err.fatal = true; err.paused = true;
    return err;
  }
  /*
   * 1.17.0: an admin's sign-in that cannot send (ended: signed out, 30 days up, switched off or no longer an admin; or a
   * new password or an email must be added first). Nothing is dropped: the entries stay waiting and are sent once they
   * sign in again. An ended sign-in is forgotten here, as the admin pages do, unless another tab has signed in afresh.
   */
  var SESSION_WORDS = { again: 'Sign in again to send your entries.', must: 'Choose a new password to send your entries.', email: 'Add your email to send your entries.' };
  function sessionError(j, key) {
    var a = adminCred();
    if (!a || a.key !== key) { var later = new Error('No connection. Will try again.'); later.fatal = false; return later; } // 1.17.1: about a sign-in this browser no longer uses (another tab signed in afresh): try again with the new one
    var why = j.signed_out ? 'again' : j.must_change ? 'must' : 'email';
    if (why === 'again') forgetAdmin(key);
    var err = new Error(SESSION_WORDS[why]);
    err.fatal = true; err.session = why;
    return err;
  }
  function sessionAnswer(j) { return !!(j && (j.signed_out || j.must_change || j.must_add_email)) && mode() === 'admin'; }
  function forgetAdmin(key) {
    var a = load('ch.admin', null);
    if (!a || a.key !== key) return; // another tab signed in afresh: keep that one
    dropRecords(); // 1.26.1: and the records kept for this sign-in
    ['ch.admin', 'ch.dash', 'ch.batchdata'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }); if (window.CH_CONFIG && CH_CONFIG.dropCopies) CH_CONFIG.dropCopies(); /* 2.7.1: the admin views' kept copies too */ // as signin.js: no admin-only copies left behind
  }
  function clearRevoked() { if (S.settings.revoked || S.settings.replaced) { delete S.settings.revoked; delete S.settings.replaced; save('ch.settings', S.settings); } }

  /** Where to send: the server for this site (config.js), else the address from the link this phone was opened with. */
  function storedUrl() { return mode() === 'admin' ? adminCred().url || CFG.scriptUrl : S.settings.url; }
  function address() { return CFG.scriptFor ? CFG.scriptFor(storedUrl()) : storedUrl(); }
  function postJson(body, ms) {
    return fetchT(address(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }, ms);
  }

  function refreshLists() {
    if (!connected()) return Promise.resolve();
    var asked = new Date().toISOString(); // this device's clock, so it compares with sent_at
    // By POST, so the key never goes in a web address.
    // logo_v (2.1.0): the logo this phone has, so the picture comes only when the Company settings page changed it
    var key = sendKey(), at = address();
    var body = { key: key, action: 'read', what: 'lists', app_version: APP_VERSION };
    if (CFG.logoVersion) body.logo_v = CFG.logoVersion();
    return postJson(body, 20000).then(readJson).then(function (j) {
      // The phone was connected with another link (or sign-in) while this read was on its way: the answer, and its "me"
      // above all, is about the old one. Nothing of it is kept; the next read uses the new link.
      if (sendKey() !== key) return;
      if (sessionAnswer(j)) throw sessionError(j, key);
      if (j.suspended) { setPaused(j); throw pausedError(); }
      if (j.revoked) throw revokedError(j);
      if (!j.ok) throw new Error(j.error || 'Could not read the lists.');
      clearRevoked(); clearPaused();
      noteVersion(j, at);
      applyMe(j.me, key);
      if (shared()) applyShared(j); // 1.21.0: the tablet's own settings and who may take a turn on it
      if (j.company && CFG.setCompany) CFG.setCompany(j.company); // 2.1.0: a new company name, contact or logo reaches this phone (kept for no signal)
      S.lists = { lists: j.lists, ferments: j.ferments, at: j.at || asked, asked: asked };
      Object.keys(CH.KINDS).forEach(function (k) { var n = CH.KINDS[k].list; if (Array.isArray(j[n])) S.lists[n] = j[n]; }); // roasts, packages… when the Sheet sends them
      if (j.taken && typeof j.taken === 'object') S.lists.taken = j.taken; // every ID ever used, so numbering never starts again
      if (Array.isArray(j.recent)) S.lists.recent = j.recent.map(String); // entries the Sheet had when it answered (2.0.1; see notYetInLists)
      save('ch.lists', S.lists);
    });
  }

  /*
   * "personal" tells the server to record the entry under the sender's own name (1.17.0: only when the one sending is the
   * one who made it). An admin's entry sent with another sign-in or with a worker's link, or a worker's entry sent with an
   * admin's sign-in, keeps its own name: the server records "<name> (sent with <sender>'s link)". Nothing is ever dropped.
   */
  function sameAdmin(made, a) { return !!(made && a) && (made.id && a.id ? made.id === a.id : String(made.name || '') === String(a.by || '')); }
  function personalFor(e) {
    if (shared()) return e.turn ? true : undefined; // 1.21.0: the turn proof says whose it is (the script checks it)
    if (!e.personal) return undefined;
    var m = mode();
    if (e.admin) return m === 'admin' && sameAdmin(e.admin, adminCred()) ? true : undefined;
    if (m !== 'worker') return undefined; // a worker's entry sent with an admin's sign-in
    // 1.17.1: only the person whose link this is (Ann's entry left waiting, then Ben's link opened: "Ann (sent with Ben's link)")
    if (e.worker && S.settings.uid) return e.worker === S.settings.uid ? true : undefined;
    return String(e.recorded_by || '').trim() === String(S.settings.person || '').trim() ? true : undefined; // older entries, or a link with no user ID yet
  }
  /**
   * 1.17.1: which waiting entries go now. On a phone with someone's link, an admin's entries wait for that admin's own
   * sign-in (the worker's link may not be allowed their forms): they are sent once the phone logs as an admin again.
   */
  function goesNow(e) { return mode() !== 'worker' || !e.admin; }
  function heldForAdmin() { return mode() === 'worker' ? S.entries.filter(function (e) { return e.status === 'waiting' && e.admin; }) : []; }
  function sendBatch(rows) {
    var key = sendKey(), sender = senderId(), at = address();
    var body = JSON.stringify({
      key: key,
      entries: rows.map(function (e) {
        return { entry_id: e.entry_id, form: e.form, recorded_by: e.recorded_by, personal: personalFor(e), device: e.device, app_version: e.app_version, created_at: e.created_at, paper: e.paper, ops: e.ops, ferment_source: e.ferment_source, sources: e.sources, turn: e.turn, before_shared: e.before_shared };
      }),
    });
    return fetchT(at, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(readJson)
      .then(function (j) {
        // retry: the Sheet was busy with another phone. Nothing was stored; try again later, not a problem.
        if (sessionAnswer(j)) throw sessionError(j, key); // nothing was stored: every entry stays waiting
        if (j.revoked) throw revokedError(j);
        if (!j.ok && j.suspended) { setPaused(j); throw pausedError(); } // nothing was stored: every entry stays waiting
        if (!j.ok) { var err = new Error(j.error || ('These entries could not be sent. Ask ' + CFG.contact + '.')); err.fatal = !j.retry; throw err; }
        clearRevoked();
        noteVersion(j, at); // 1.29.2: the next chunk goes only if this server takes it (holdBack)
        if (j.suspended) setPaused(j); else clearPaused();
        var byId = {}, held = false;
        (j.results || []).forEach(function (r) { byId[r.entry_id] = r; });
        return Promise.all(rows.map(function (e) {
          var r = byId[e.entry_id];
          if (r && r.paused) held = true; // made after the pause: kept here, sent when it is back on
          if (r && r.status === 'error' && !r.paused && r.message && r.message !== e.server_message) { e.server_message = String(r.message); return CH.DB.put(e); } // 1.24.5: still waiting, with the reason shown on the entry
          if (!r || r.status === 'error') return null; // not stored yet: stays waiting, tried again later
          e.status = r.status === 'saved' || r.status === 'duplicate' ? 'sent' : 'review';
          if (sender) e.sent_with = sender; // P4-A: who sent it, as the server sees it (user and device IDs, never a key): its photos go only from them
          e.server_message = r.message || '';
          e.sent_at = new Date().toISOString();
          return CH.DB.put(e);
        })).then(function () { if (held) throw pausedError(); }); // the rest of the queue is newer still: wait
      });
  }

  /*
   * 1.29.2: entries wait for a new enough script (the 25 Nov review's H1). On a go-live the pages reach phones before the
   * script is deployed; an older script would hold an entry with a column it does not know. Each entry records
   * needs_script (schema.js needsScript), and goes only when the server's version is that or newer (CH.scriptReady), and
   * never ahead of a held entry that made its box, roast or package (CH.holdBack). The version comes from the plain no-key
   * GET ?action=version (the same as the wake-up) and from every lists and send answer, and counts only for the server
   * that gave it. Not known (no answer, or an answer without a proper version): everything is sent as before. Nothing is
   * ever dropped: the entry stays waiting, with the same entry ID, and goes by itself on a later send.
   */
  function noteVersion(j, url) {
    if (!j || !j.ok) return; // a refusal or a busy answer says nothing about the version
    S.script.v = CH.versionCmp && CH.versionCmp(j.version, j.version) === 0 ? j.version : ''; // review L3: not a version = not known
    S.script.url = String(url || '');
  }
  /** The version of the server this phone sends to now, as its last answer said; '' when not known (or it was another server's: review L2). */
  function knownVersion() { return S.script.v && S.script.url === address() ? S.script.v : ''; }
  function askVersion() {
    if (S.script.asking) return S.script.asking;
    var u = address();
    if (!u || !goodUrl(u) || !navigator.onLine) return Promise.resolve();
    S.script.asking = fetchT(u + '?action=version', { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'follow' }, 20000)
      .then(function (r) { return r.json(); }).then(function (j) { noteVersion(j, u); }, function () { /* not learned: the last answer's version stands */ })
      .then(function () { S.script.asking = null; });
    return S.script.asking;
  }
  /** Review L1: ask only when a waiting entry needs a newer script than the one known (or none is known). */
  function mustAsk(rows) {
    var need = CH.newestNeed ? CH.newestNeed(rows) : '', known = knownVersion();
    return !!need && (!known || CH.versionCmp(known, need) < 0);
  }
  function gatedCount() { return turnEntries().filter(function (e) { return e.status === 'waiting' && S.gated[e.entry_id]; }).length; } // a shared tablet: this person's own
  function gatedWords() { var n = gatedCount(); return n === 1 ? '1 entry is waiting for an update on our side. Nothing to do: it will send by itself.' : n + ' entries are waiting for an update on our side. Nothing to do: they will send by themselves.'; }

  function sync(manual, opening) {
    if (S.syncing) return Promise.resolve();
    if (!connected()) { badge(); if (manual) toast('This device is not connected yet. Entries stay here. ' + lastSentText() + '.'); return Promise.resolve(); }
    // A switched-off link is not tried every minute; "Send now" still tries, opening the app tries once (it may have been
    // switched back on), and a new link clears the notice.
    if (linked() && S.settings.revoked && !manual && !opening) { badge(); return Promise.resolve(); }
    if (mode() === 'admin' && S.session && !manual && !opening) { badge(); return Promise.resolve(); } // a new password or an email first: not every minute
    if (!navigator.onLine) { badge(); if (manual) toast('No internet now. Entries are safe on this device. ' + lastSentText() + '.'); return Promise.resolve(); }
    S.syncing = true; badge();
    var sentAny = false;
    // The link or sign-in this send started with. If the phone is connected with another one meanwhile, no more entries
    // go under the old one: what is left stays waiting for the next send (straight after, for a new link: S.syncAgain).
    var startKey = sendKey();
    var moved = function () { return sendKey() !== startKey; };
    return CH.DB.waiting().then(function (rows) {
      rows = rows.filter(goesNow);
      // 1.29.2: an entry that needs a newer script than the server has stays waiting, and so does any entry about a box,
      // roast or package it made (CH.holdBack); the rest go as before. The version is asked when a waiting entry needs a
      // newer one than is known; when it cannot be learned, everything goes as before.
      return (mustAsk(rows) ? askVersion() : Promise.resolve()).then(function () {
        S.gated = {};
        var ready = CH.holdBack ? CH.holdBack(rows, knownVersion(), S.gated) : rows;
        sentAny = ready.length > 0;
        var chain = Promise.resolve();
        for (var i = 0; i < ready.length; i += BATCH) {
          (function (chunk) {
            chain = chain.then(function () {
              if (moved()) return;
              var go = CH.holdBack ? CH.holdBack(chunk, knownVersion(), S.gated) : chunk; // the last answer may have told the version (same held set)
              if (go.length) return sendBatch(go);
            });
          })(ready.slice(i, i + BATCH));
        }
        return chain;
      });
    }).then(function () {
      if (moved()) return null; // the rest waits for the next send, with the new link or sign-in
      S.lastError = ''; S.session = '';
      // Re-read pick lists and open ferments after sending, when asked, or every 10 minutes:
      // not on every one-minute check, which would cost each phone a Sheet read a minute.
      var age = S.lists && S.lists.asked ? Date.now() - new Date(S.lists.asked).getTime() : Infinity;
      if (!sentAny && !manual && age < 10 * 60 * 1000) return null;
      return refreshLists().catch(function (e) { if (e && (e.revoked || e.session)) throw e; /* lists can wait; a switched-off or replaced link, or an ended sign-in, is said at once */ });
    }).then(function () {
      if (shared()) reportMisses(); // 1.21.0 (slice 7): wrong PINs typed here today, so admins can see if someone is guessing
      if ((sentAny || manual) && !moved() && route().name === 'entries') REC.askAfterSync = true; // 1.26.1: the records once more, after a send, while My entries is open
      if (manual && !moved()) toast(gatedCount() ? gatedWords() : 'Everything is sent. ' + lastSentText() + '.');
    }).catch(function (err) {
      if (moved()) return; // about the old link or sign-in: nothing of it is kept (the new one is tried next)
      S.session = (err && err.session) || '';
      if (err && err.revoked) { S.settings.revoked = true; if (err.replaced) S.settings.replaced = true; else delete S.settings.replaced; save('ch.settings', S.settings); }
      S.lastFatal = !!(err && err.fatal);
      S.lastError = S.lastFatal ? err.message : 'No connection. Will try again.';
      if (manual) toast(S.lastError);
    }).then(function () {
      S.syncing = false;
      setTimeout(applyUpdateIfIdle, 0);
      return refreshEntries();
    }).then(function () {
      badge();
      sendPhotos(false); // P4-A: photos after the entries, on their own (never rejects; it waits while any entry is waiting)
      var r = route();
      if (r.name === 'home' || r.name === 'entries' || r.name === 'settings') render();
      // A new link was opened while this send ran (startJoin, readConnect): send once more, with it (what is left is still
      // waiting). Any other change of sign-in leaves the rest for the next send, as before.
      var again = S.syncAgain;
      S.syncAgain = false;
      if (again) return sync(true);
    });
  }

  function refreshEntries() { return CH.DB.all().then(function (rows) { S.entries = rows; }); }

  function badge() {
    var b = document.getElementById('sync-badge'), t = document.getElementById('sync-text');
    var held = heldForAdmin().length; // 1.17.1: an admin's entries on a phone with someone's link wait for the admin (My entries says so)
    var waiting = S.entries.filter(function (e) { return e.status === 'waiting'; }).length - held;
    var state, text;
    if (S.syncing && waiting) { state = 'sending'; text = 'Sending…'; }
    else if (!connected()) { state = 'offline'; text = waiting ? waiting + ' saved here' : 'Not connected'; }
    else if (linked() && S.settings.revoked) { state = 'problem'; text = waiting ? waiting + ' kept · link off' : 'Link switched off'; }
    else if (mode() === 'admin' && S.session) { state = 'problem'; text = waiting ? waiting + ' kept · sign in' : 'Sign in'; }
    else if (paused()) { state = 'problem'; text = waiting ? waiting + ' kept · paused' : 'Paused'; }
    else if (!navigator.onLine) { state = 'offline'; text = waiting ? 'Offline · ' + waiting + ' waiting' : 'Offline'; }
    else if (S.lastError && waiting) { state = 'problem'; text = waiting + ' waiting'; }
    else if (waiting) { state = 'waiting'; text = waiting + ' waiting'; }
    else if (held) { state = 'waiting'; text = held + ' kept'; }
    else { state = 'ok'; text = 'All sent'; }
    b.dataset.state = state; t.textContent = text;
    b.dataset.left = state === 'offline' && waiting ? '1' : '0'; // looks only (app.css): waiting with no connection shows amber, not grey
    b.title = S.lastError || (gatedCount() ? gatedWords() : '');
    paintTabs();
  }

  /* ---------------- routing ---------------- */

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = h.indexOf('?');
    var p = (q >= 0 ? h.slice(0, q) : h).split('/');
    // a pre-filled form: #/form/<id>?<field>=<value>&… (e.g. a scanned label's "Check this package in")
    if (p[0] === 'form' && CH.formById(p[1])) return { name: 'form', id: p[1], params: q >= 0 ? h.slice(q + 1) : '' };
    if (p[0] === 'entries') return { name: 'entries' };
    if (p[0] === 'settings') return { name: 'settings' };
    if (p[0] === 'pallet' && p[1]) { var pid; try { pid = decodeURIComponent(p[1]); } catch (e) { pid = ''; } if (pid) return { name: 'pallet', id: pid }; } // slice B: a page, for a browser with no <dialog>
    return { name: 'home' };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  /* ---------------- laptop view (1.31.0): looks and keys only ---------------- */
  /*
   * On a wide screen with a mouse the same forms are laid out for a desk: the forms list beside the open form, short
   * questions two to a row, My entries as a table, "Save and start another", a few keys. Nothing here saves, sends or
   * stores anything except the layout choice (ch.settings.layout = 'auto' | 'phone' | 'laptop', a plain word, kept per
   * device). There is one save path: "Save and start another" runs the same submit, and only decides where to go once
   * the entry is safely kept. Under 1024 px it is always off, whatever was chosen, so a phone never lands in it.
   */
  var DESK_MQ = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
  var WIDE_MQ = '(min-width: 1024px)';
  function mqOn(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  function wideNow() { return mqOn(WIDE_MQ); }
  function layoutChoice() { var v = S.settings.layout; return v === 'phone' || v === 'laptop' ? v : 'auto'; }
  function deskOn() {
    if (!wideNow()) return false;
    var c = layoutChoice();
    return c === 'laptop' || (c === 'auto' && mqOn(DESK_MQ));
  }
  var deskWas = null, deskRetry = null;
  /** Sets body.desk (a class only) and redraws when it changed; never under an open sheet or while saving (it waits). */
  function applyDesk() {
    clearTimeout(deskRetry);
    var on = deskOn();
    if (deskWas === on) return;
    if (deskWas !== null && (picker || entrySheet || addSheet || stillDlg || S.saving)) { deskRetry = setTimeout(applyDesk, 400); return; }
    var first = deskWas === null;
    deskWas = on;
    document.body.classList.toggle('desk', on);
    if (!first) render();
  }
  function setLayout(v) {
    if (v === 'auto') delete S.settings.layout; else S.settings.layout = v;
    save('ch.settings', S.settings);
    if (deskWas === deskOn()) render(); else applyDesk(); // the Settings row shows the new choice either way
  }
  (function () {
    [DESK_MQ, WIDE_MQ].forEach(function (q) {
      try {
        var m = window.matchMedia && window.matchMedia(q);
        if (!m) return;
        if (m.addEventListener) m.addEventListener('change', applyDesk); else if (m.addListener) m.addListener(applyDesk);
      } catch (e) { /* an old browser: the phone layout */ }
    });
  })();
  /*
   * The laptop view's keys, on the form only (one listener; a sheet or the picker is outside #view, so never here):
   * Ctrl/⌘+Enter presses Save, Ctrl/⌘+Shift+Enter "Save and start another" (a press on a button that is already
   * saving does nothing: it is disabled). Enter in a one-line box goes to the next control instead of saving, unless the
   * box handles Enter itself (buckets, "Something else", typing an ID): those call preventDefault first. No bare letters.
   */
  var ONE_LINE = { text: 1, date: 1, time: 1, number: 1, email: 1, tel: 1, search: 1, url: 1, 'datetime-local': 1 };
  function deskFocusables(form) {
    var all = Array.prototype.slice.call(form.querySelectorAll('input, textarea, button, select, summary, a[href], [tabindex]'));
    var seenGroup = {};
    return all.filter(function (n) {
      if (n.disabled || n.type === 'hidden' || n.getAttribute('tabindex') === '-1') return false;
      if (n.checkVisibility ? !n.checkVisibility() : !(n.offsetWidth || n.offsetHeight)) return false; // not shown (a shut "More details" too)
      if (n.type === 'radio' && n.name) { // one stop per group of radios, as Tab: the one picked, or the first
        var picked = form.querySelector('input[type=radio][name="' + n.name.replace(/"/g, '') + '"]:checked');
        if (picked ? picked !== n : seenGroup[n.name]) return false;
        seenGroup[n.name] = true;
      }
      return true;
    });
  }
  view.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || !deskOn() || route().name !== 'form') return;
    var t = ev.target, form = view.querySelector('#entry-form');
    if (ev.ctrlKey || ev.metaKey) {
      if (ev.defaultPrevented || ev.altKey) return; // a box that took this Enter for itself (a bucket weight): left alone
      var b = (ev.shiftKey && view.querySelector('#save-again')) || view.querySelector('#save'); // review: no "start another" here: a plain save
      ev.preventDefault();
      if (b && !b.disabled) b.click();
      return;
    }
    if (ev.defaultPrevented || ev.shiftKey || ev.altKey || !form || !t || !form.contains(t)) return;
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' && (t.type === 'radio' || t.type === 'checkbox')) { ev.preventDefault(); return; } // never saves by itself
    if (tag !== 'input' || !ONE_LINE[t.type]) return; // a textarea takes Enter; a button presses
    ev.preventDefault();
    var list = deskFocusables(form), i = list.indexOf(t);
    var next = i >= 0 ? list[i + 1] : null;
    if (!next) next = view.querySelector('#save');
    if (next && next.focus) next.focus();
  });
  /**
   * Does the drafts' write that is waiting (keepDraft writes 400 ms after the last change) now: leaving a form by the
   * rail, or the page going away. Only a write that is waiting, with the same key and drafts: with none waiting it writes
   * nothing, so a page going away never puts its in-memory copy over drafts kept since (another tab, a reload).
   */
  function flushDrafts() { clearTimeout(draftTimer); if (draftWrite) draftWrite(); }
  window.addEventListener('pagehide', flushDrafts);

  var prefilledFor = ''; // 1.31.0: the form on screen was opened pre-filled for one item (never stored)
  function render() {
    var r = route();
    if (!(r.name === 'form' && r.id === prefilledFor)) prefilledFor = '';
    document.body.classList.toggle('is-shared', shared()); // design review: a shared tablet uses its width (app.css)
    if (S.join) return renderJoin(); // a join link being opened, or one that did not work (2.0.0)
    if (shared() && !TURN) return renderWho(); // 1.21.0: a shared tablet with nobody's turn: "Who's using this?"
    // 1.17.0: no link and no admin sign-in: the welcome screen (no name to type, no forms). What is saved here stays
    // reachable: My entries and Settings (with the link box) still open.
    if (mode() === 'none') {
      if (r.name === 'entries') return renderEntries();
      if (r.name === 'settings') return renderSettings();
      return renderWelcome(); // a form's address (a scanned "Check this package in") is left as it is: it opens once connected
    }
    if (!person() && r.name !== 'settings') return renderPerson(); // the old shared setup link: it has no name in it
    if (r.name === 'form') {
      if (!mayUse(CH.formById(r.id))) { go('#/'); return; } // not one of this role's forms
      if (paused()) { go('#/'); return; } // no new entries while the company is paused (a draft stays saved)
      if (r.params) {
        var scanId = scanParam(r.params); // P4-B/2: a scanned paper form opened from scan.html
        if (scanId) openScan(CH.formById(r.id), scanId); else prefill(CH.formById(r.id), r.params);
        prefilledFor = r.id; // 1.31.0: opened for one item: no "Save and start another" (screen state only)
        history.replaceState(null, '', location.pathname + '#/form/' + r.id); // a reload does not fill it in again
      }
      return renderForm(CH.formById(r.id));
    }
    if (r.name === 'entries') return renderEntries();
    if (r.name === 'settings') return renderSettings();
    if (r.name === 'pallet') return renderPalletPage(r.id);
    return renderHome();
  }

  /* ---------------- screens ---------------- */

  // Home-screen icon for each form (Lucide, see icons.js).
  var ICONS = { new_ferment: 'package', ferment_check: 'thermometer', add_beans: 'bean', drying_check: 'sun', finish_drying: 'shopping-bag' };
  // The order the work happens in, as Jake asked, in two groups.
  var AREA_STAGE = { roasting: 'roast', making: 'making' }; // the stage colour of a group of forms (ui.css --stage-roast, --stage-making)
  var HOME_GROUPS = [['Fermenting', ['new_ferment', 'ferment_check', 'add_beans'], 'ferment'], ['Drying', ['drying_check', 'finish_drying'], 'dry']];

  /** The home screen's groups of this person's forms: the usual two first, then each newer form under its group or area. */
  function homeGroups() {
    var mine = myForms().map(function (f) { return f.id; });
    var placed = [];
    var out = HOME_GROUPS.map(function (g) {
      var ids = g[1].filter(function (id) { return mine.indexOf(id) >= 0; });
      placed = placed.concat(ids);
      return [g[0], ids].concat(g.slice(2)); // anything after the ids (e.g. the group's stage colour) is kept
    });
    myForms().forEach(function (f) {
      if (placed.indexOf(f.id) >= 0) return;
      var name = f.group || CH.AREA_TITLES[[].concat(f.area || [])[0]] || 'More forms';
      var g = out.filter(function (x) { return x[0] === name; })[0];
      if (!g) { g = [name, [], f.stage || AREA_STAGE[[].concat(f.area || [])[0]]]; out.push(g); }
      g[1].push(f.id);
    });
    return out.filter(function (g) { return g[1].length; });
  }
  /*
   * Folding the groups on home (fd1). An admin, and anyone whose forms come from more than one area, sees every group
   * folded at first: their home is long, so they open only the group they need. Anyone with one area sees them open, as
   * before. Each group's open or shut, once tapped, is kept on this device for that person ("ch.homefold.<user ID>"):
   * group names and true/false only, nothing else.
   */
  function homeFoldsShut() {
    // 1.24.0: on a wide screen the forms have a column of their own, so folding only hides them: every group starts open
    try { if (window.matchMedia && window.matchMedia('(min-width: 1024px)').matches) return false; } catch (e) { /* an old browser: the rule below */ }
    if (role() === 'admin') return true;
    // The person's own areas (as myForms), not the forms' (Tasting note is in every area), and only areas switched on
    var mine = Array.isArray(S.settings.areas) ? S.settings.areas : (CH.ROLE_AREAS && CH.ROLE_AREAS.hasOwnProperty(role()) ? CH.ROLE_AREAS[role()] : []);
    var areas = {};
    [].concat(mine).forEach(function (a) { var k = CH.areaKey ? CH.areaKey(a) : String(a); if (k && (!CH.areaOn || CH.areaOn(k))) areas[k] = true; });
    return Object.keys(areas).length > 1;
  }
  function homeFoldKey() {
    if (mode() === 'admin') { var a = adminCred(); return 'ch.homefold.admin' + (a && a.id ? '.' + a.id : ''); }
    return 'ch.homefold.' + (S.settings.uid || 'device');
  }
  function homeFoldSaved() {
    var v = load(homeFoldKey(), null);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function saveHomeFold(name, open) {
    var v = homeFoldSaved();
    v[name] = !!open;
    save(homeFoldKey(), v);
  }
  /** How many of these forms hold an unfinished draft (shown on the group's heading, folded or not). */
  function unfinishedIn(ids) {
    return ids.filter(function (id) { try { return unfinished(CH.formById(id)); } catch (e) { return false; } }).length;
  }

  function initials(name) {
    var p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function chev() { return el('span', { className: 'chev', html: ICON('chevron-right', 20) }); }
  function clock(iso) { return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

  /** The sync state in plain words for the home status card. */
  function syncSummary() {
    var waiting = S.entries.filter(function (e) { return e.status === 'waiting'; }).length;
    var last = S.entries.reduce(function (m, e) { return e.sent_at && e.sent_at > m ? e.sent_at : m; }, '');
    var lastTxt = last ? ' · last sent ' + clock(last) : '';
    if (S.syncing && waiting) return { cls: 'waiting', icon: 'loader-circle', text: 'Sending ' + waiting + (waiting === 1 ? ' entry…' : ' entries…') };
    if (!connected()) return { cls: 'waiting', icon: 'cloud-off', text: waiting ? waiting + ' saved on this phone · not connected' : 'Not connected yet' };
    if (linked() && S.settings.revoked) return { cls: 'problem', icon: 'triangle-alert', text: 'Link switched off' + (waiting ? ' · ' + waiting + ' kept here' : '') };
    if (mode() === 'admin' && S.session) return { cls: 'problem', icon: 'triangle-alert', text: 'Waiting for your sign-in' + (waiting ? ' · ' + waiting + ' kept here' : '') };
    if (paused()) return { cls: 'problem', icon: 'triangle-alert', text: 'Paused' + (waiting ? ' · ' + waiting + ' kept here' : '') };
    if (!navigator.onLine) return { cls: 'waiting', icon: 'cloud-off', text: 'No internet' + (waiting ? ' · ' + waiting + ' saved here, will send later' : ' · entries stay saved here') };
    if (S.lastError && waiting) return { cls: 'problem', icon: 'triangle-alert', text: waiting + ' waiting · ' + (S.lastFatal ? S.lastError : 'no connection, trying again') };
    if (waiting) return { cls: 'waiting', icon: 'clock', text: waiting + (waiting === 1 ? ' entry' : ' entries') + ' waiting to send' };
    return { cls: 'ok', icon: 'circle-check', text: 'All sent' + lastTxt };
  }

  /** When this phone last sent an entry, in plain words. */
  function lastSentText() {
    var last = S.entries.reduce(function (m, e) { return e.sent_at && e.sent_at > m ? e.sent_at : m; }, '');
    if (!last) return 'Nothing sent from this phone yet';
    var d = new Date(last);
    var sameDay = d.toDateString() === new Date().toDateString();
    return 'Last sent ' + (sameDay ? 'today at ' + clock(last) : CH_PAGE.dayText(d, false, { weekday: 'short' }) + ' at ' + clock(last));
  }

  /** Newest first, but the things one entry made stay in their own order (P1, P2, P3). */
  function newestFirst(base) {
    var all = [];
    for (var i = base.length - 1; i >= 0;) {
      var j = i;
      while (j > 0 && base[i].source && base[j - 1].source === base[i].source) j--;
      all = all.concat(base.slice(j, i + 1));
      i = j - 1;
    }
    return all;
  }
  /** A draft someone has put work into (more than the form fills in by itself), or one whose Save was already tapped. */
  function unfinished(form) {
    var d = S.drafts[form.id];
    return !!d && typeof d === 'object' && (!!d.__entry_id || !untouched(form, d));
  }
  /**
   * Home's "In progress" rows (design slice 8), worked out by model.js from what this phone already holds: its lists,
   * its own entries not yet counted there, and its unfinished forms. Looks only: nothing is read from the server or sent.
   */
  function progressRows() {
    // All of it in the try: odd data kept on the phone (an old draft, a list from an older script) must never blank
    // home. Without the list, home still shows every form.
    try {
      var M = window.CH_MODEL;
      if (!M || typeof M.inProgress !== 'function' || paused() || !canLog()) return [];
      var forms = myForms(), items = { ferment: knownFerments() }, nouns = {};
      Object.keys(CH.KINDS).forEach(function (k) { items[k] = newestFirst(known(k)); nouns[k] = String(CH.KINDS[k].noun || k).toLowerCase(); });
      var drafts = forms.filter(unfinished).map(function (f) {
        var d = S.drafts[f.id], pick = f.fields.filter(function (x) { return (x.type === 'ferment' || (x.type === 'ref' && !x.multiple)) && d[x.key]; })[0];
        return { form: f.id, title: f.title, text: (pick ? d[pick.key] + ' · ' : '') + 'not saved yet' };
      });
      var rows = M.inProgress({ forms: forms, items: items, entries: S.entries.filter(notYetInLists), drafts: drafts, ctx: formCtx(), nouns: nouns, today: today() });
      rows = Array.isArray(rows) ? rows : [];
      // P2-E: people with the Making area also see the pallets at the port or on the water (read only)
      if (typeof M.palletProgress === 'function' && forms.some(function (f) { return [].concat(f.area || []).indexOf('making') >= 0; })) rows = rows.concat(M.palletProgress({ shipments: known('shipment'), packages: known('package') }) || []);
      return rows;
    } catch (e) { return []; } // the list is a shortcut: home still shows every form without it
  }
  var PROGRESS_MAX = 5; // rows shown before "Show all"
  function progressCard() {
    try { return progressNodes(progressRows()); } catch (e) { return []; } // as progressRows: never blank home
  }
  /** Slice B: the ID of a pallet row (Walpole's "at the port / on the water", the factory's "Left the port") is a button that shows what is on it. Read only. */
  function palletButton(r, name) {
    if (r.kind !== 'pallet' && r.kind !== 'shipment') return null;
    try {
      var btn = el('button', { className: 'prog-id id pallet-open', type: 'button', 'aria-label': 'Packages on pallet ' + r.id, 'data-pallet': r.id, onclick: function () { openPallet(r.id, btn); } }, [name + ' \u203A']);
      return btn;
    } catch (e) { return null; } // the row still shows, as before
  }
  function progressNodes(rows) {
    if (!rows.length) return [];
    var all = !!S.progressAll || rows.length <= PROGRESS_MAX + 1;
    var list = el('ul', { className: 'prog', id: 'in-progress' }, (all ? rows : rows.slice(0, PROGRESS_MAX)).map(function (r) {
      var first = r.actions[0] || {};
      var name = r.kind === 'draft' ? first.title : r.kind === 'many' ? (r.head || r.text) : r.id;
      var ctx = r.kind === 'many' ? (r.head ? r.tail : '') : r.text;
      return el('li', { className: 'prog-row' + (r.actions.length > 1 ? ' two' : ''), 'data-kind': r.kind, 'data-id': r.id }, [
        el('div', { className: 'prog-what' }, [palletButton(r, name) || el('span', { className: 'prog-id' + (r.kind === 'draft' || r.kind === 'many' ? '' : ' id'), text: name }), ctx ? el('span', { className: 'prog-ctx', text: ctx }) : null]),
        el('div', { className: 'prog-acts' }, r.actions.map(function (a) {
          return el('button', { className: 'btn btn-secondary', type: 'button', text: a.label, 'data-form': a.form, 'aria-label': r.kind === 'draft' ? 'Carry on with ' + a.title : r.kind === 'many' ? a.label + ': ' + r.text : a.label + ' for ' + r.id,
            onclick: function () { go('#/form/' + a.form + (a.query ? '?' + a.query : '')); } });
        })),
      ]);
    }));
    return [
      el('h2', { className: 'sect-title', id: 'in-progress-title', text: 'In progress' }),
      list,
      all ? null : el('button', { className: 'btn btn-secondary btn-block prog-more', type: 'button', id: 'in-progress-all', text: 'Show all (' + rows.length + ')', onclick: function () { S.progressAll = true; render(); } }),
    ];
  }

  /**
   * The folded groups of this person's forms: home's forms column, and (1.31.0) the laptop view's rail beside a form.
   * prefix: the id of each group's body; current: the form on screen (marked aria-current), '' on home.
   */
  function formGroupNodes(prefix, current) {
    var formsCol = [];
    var foldShut = homeFoldsShut(), foldSaved = homeFoldSaved();
    homeGroups().forEach(function (g, i) {
      var open = Object.prototype.hasOwnProperty.call(foldSaved, g[0]) ? foldSaved[g[0]] === true : !foldShut;
      var bodyId = prefix + i, left = unfinishedIn(g[1]);
      var head = el('button', { className: 'grp-btn', type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': bodyId, 'data-group': g[0],
        onclick: function () {
          var now = this.getAttribute('aria-expanded') !== 'true';
          this.setAttribute('aria-expanded', now ? 'true' : 'false');
          document.getElementById(bodyId).hidden = !now;
          saveHomeFold(g[0], now);
        } }, [
        el('span', { className: 'grp-t', text: g[0] }),
        el('span', { className: 'grp-n', text: '· ' + g[1].length }, [el('span', { className: 'sr-only', text: g[1].length === 1 ? ' form' : ' forms' })]),
        left ? el('span', { className: 'badge warn grp-left', text: left + ' unfinished' }) : null,
        el('span', { className: 'chev', html: ICON('chevron-down', 20) }),
      ]);
      formsCol.push(el('h2', { className: 'sect-title grp-head' }, [head]));
      formsCol.push(el('div', { className: 'actions', id: bodyId, 'data-stage': g[2], hidden: !open }, g[1].map(function (id) {
        var f = CH.formById(id);
        return el('button', { className: 'action', type: 'button', 'data-form': id, disabled: !!paused(), 'aria-current': id === current ? 'page' : undefined, onclick: function () { go('#/form/' + id); } }, [
          el('span', { className: 'ico', html: ICON(f.icon || ICONS[id] || 'file-text', 24) }),
          el('span', { className: 'txt' }, [el('span', { className: 't', text: f.title }), el('span', { className: 'h', text: f.hint })]),
          chev(),
        ]);
      })));
    });
    return formsCol;
  }

  /**
   * 1.31.0, the laptop view: the rail beside an open form (from 1280 px; app.css hides it below). In progress, then the
   * folded groups, built by the same code as home, in a try like home's list: a problem leaves the form without a rail.
   * Leaving a form by the rail keeps what was typed (it is kept as it is typed; the rail also writes it at once).
   */
  function deskRail(form) {
    if (!deskOn()) return null;
    try {
      var kids = progressCard().concat(formGroupNodes('rail-group-', form.id));
      if (!kids.length) return null;
      // review: a keyboard goes past the rail in one step (it is shown only when focused, as the admin pages' skip link)
      var skip = el('button', { type: 'button', className: 'desk-skip', id: 'desk-skip', text: 'Skip to the form', onclick: function () { focusFirstQ(); } });
      var rail = el('nav', { className: 'desk-rail', id: 'desk-rail', 'aria-label': 'Forms' }, [skip].concat(kids));
      rail.addEventListener('click', flushDrafts, true);
      return rail;
    } catch (e) { return null; }
  }

  /** 1.31.0, the laptop view: under the Save panel, how many of this form were saved here today, and the last five (read-only). */
  function savedToday(form) {
    try {
      var day = new Date().toDateString();
      var mine = turnEntries().filter(function (e) { return e.form === form.id && e.created_at && new Date(e.created_at).toDateString() === day; });
      if (!mine.length) return null;
      return el('div', { className: 'saved-today', id: 'saved-today' }, [
        el('p', { className: 'saved-today-n', text: 'Saved today: ' + mine.length }),
        el('ul', { className: 'saved-list' }, mine.slice(0, 5).map(function (e) {
          var st = statusOf(e);
          var b = el('button', { className: 'saved-row', type: 'button', 'data-entry': e.entry_id, 'aria-haspopup': 'dialog', onclick: function () { openEntry(e, b); } }, [
            el('span', { className: 'saved-t', text: e.summary || form.title }),
            el('span', { className: 'saved-h' }, [el('time', { text: clock(e.created_at) }), el('span', { className: 'badge' + (st[0] === 'ok' ? ' is-sent' : ' ' + st[0]), text: st[1] })]),
          ]);
          return el('li', {}, [b]);
        })),
      ]);
    } catch (e) { return null; } // a hint only: the form never depends on it
  }
  /** 1.31.0, the laptop view: after a plain save, the keyboard is on the saved form's row on home (Enter opens it again). */
  var homeFocus = ''; // screen state: the form whose row home puts the keyboard on once drawn
  function focusHomeForm(id) {
    var b = view.querySelector('.home .action[data-form="' + String(id).replace(/"/g, '') + '"]');
    if (b && !b.disabled && b.offsetParent && b.focus) b.focus({ preventScroll: true });
  }
  /** After "Save and start another": the cursor in the first question of the fresh form. */
  function focusFirstQ() {
    var q = view.querySelector('#entry-form .q:not(.paper-box)');
    var t = q && (q.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([disabled]), textarea, button.pk-open') || q.querySelector('input:not([disabled]), button:not([disabled])'));
    if (t && t.focus) t.focus();
  }

  function renderHome() {
    var waiting = S.entries.filter(function (e) { return e.status === 'waiting'; }).length;
    var review = S.entries.filter(function (e) { return e.status === 'review'; }).length;
    var sy = syncSummary();
    var top = [
      el('h1', { className: 'sr-only', text: 'Field log' }),
      el('div', { className: 'who' }, [
        el('span', { className: 'avatar', 'aria-hidden': 'true', text: initials(person()) }),
        el('span', { className: 'status-who' }, [el('small', {}, ['Logging as ', mode() === 'admin' ? el('span', { className: 'who-role', text: 'admin' }) : null]), el('b', { text: person() })]),
        nameLocked() ? null : el('button', { className: 'btn btn-secondary who-btn', type: 'button', onclick: function () { go('#/settings'); } }, [svgEl('pencil', 18), 'Change']),
        shared() ? el('button', { className: 'btn btn-secondary who-btn', type: 'button', id: 'switch-person', onclick: function () { endTurn('switch'); } }, [svgEl('users', 18), 'Switch person']) : null, // 1.21.0
        mode() === 'admin' ? el('a', { className: 'btn btn-secondary who-btn', id: 'admin-dashboard', href: 'dashboard.html' }, [svgEl('layout-dashboard', 18), 'Switch to admin']) : null, // 1.17.0: back to the admin pages; 1.22.2: named as the pair of their "Field app" link
      ]),
      sy.cls === 'ok' ? null : el('div', { className: 'status-sync ' + sy.cls }, [svgEl(sy.icon, 18), el('span', { text: sy.text })]), // "All sent" is already in the top bar
    ];
    var nodes = top;
    if (mode() === 'admin' && S.session) nodes.push(sessionNotice(waiting)); // 1.17.0: a new password or an email first
    if (linked() && S.settings.revoked) {
      nodes.push(el('div', { className: 'notice bad', role: 'alert', id: 'revoked-notice' }, [
        svgEl('triangle-alert', 20),
        el('div', { className: 'notice-body' }, [
          el('div', { className: 'notice-title', text: S.settings.replaced ? 'This link was opened on another phone, so it stopped working here. Ask ' + CFG.contact + ' for a new one.' : 'This link was switched off. Ask ' + CFG.contact + ' for a new one.' }),
          el('span', { text: waiting
            ? 'Your ' + waiting + (waiting === 1 ? ' unsent entry is' : ' unsent entries are') + ' kept on this phone. Open the new link on this phone and they will be sent.'
            : 'Nothing is waiting to send. Open the new link on this phone when you have it.' }),
        ]),
      ]));
    }
    if (connected() && paused() && !(linked() && S.settings.revoked)) {
      nodes.push(el('div', { className: 'notice warn', role: 'alert', id: 'paused-notice' }, [
        svgEl('triangle-alert', 20),
        el('div', { className: 'notice-body' }, [
          el('div', { className: 'notice-title', text: pausedWords() }),
          el('span', { text: 'New entries cannot be made for now.' + (waiting
            ? ' Your ' + waiting + (waiting === 1 ? ' unsent entry is' : ' unsent entries are') + ' kept on this phone and will still be sent.'
            : '') }),
        ]),
      ]));
    }
    if (review) {
      nodes.push(el('div', { className: 'notice bad', role: 'alert' }, [
        svgEl('triangle-alert', 20),
        el('div', { className: 'notice-body' }, [
          el('div', { className: 'notice-title', text: review + (review === 1 ? ' entry needs' : ' entries need') + ' a look from ' + CFG.contact + '.' }),
          el('span', { text: 'They arrived safely, but something did not fit. ' + CFG.contact + ' will check them.' }),
          el('div', { className: 'notice-actions' }, [el('button', { className: 'btn btn-secondary', type: 'button', text: 'See which', onclick: function () { go('#/entries'); } })]),
        ]),
      ]));
    }
    if (!canLog()) {
      nodes.push(el('div', { className: 'empty', id: 'forms-coming' }, [
        svgEl('clock', 20),
        el('div', { className: 'empty-title', text: 'Your forms are coming' }),
        el('div', { className: 'empty-hint', text: 'There are no forms for your part of the work yet. You can already look at the Dashboard below.' }),
      ]));
    }
    // What is in progress comes first: the usual next step is one tap (it opens the form with the box, roast… already picked)
    progressCard().forEach(function (n) { nodes.push(n); });

    var formsCol = formGroupNodes('home-group-', '');

    // My entries and Settings are in the bottom bar now; what is left here are the pages outside the app
    var more = [
      el('h2', { className: 'sect-title', text: 'More' }),
      el('div', { className: 'list' }, [
        mayUse(CH.formById('pack')) ? el('a', { className: 'list-row', href: 'print.html' }, [el('span', { className: 'li', html: ICON('printer', 22) }), el('span', { className: 'txt' }, [el('span', { className: 't', text: 'Print labels' }), el('span', { className: 'h', text: 'Package labels, also reprints' })]), chev()]) : null,
        mode() === 'admin' ? null : el('a', { className: 'list-row', href: 'dashboard.html' }, [el('span', { className: 'li', html: ICON('layout-dashboard', 22) }), el('span', { className: 'txt' }, [el('span', { className: 't', text: 'Dashboard' })]), chev()]), // 1.22.2: an admin's way back is "Switch to admin" beside their name, in one place only
        el('a', { className: 'list-row', href: 'paper.html' }, [el('span', { className: 'li', html: ICON('file-text', 22) }), el('span', { className: 'txt' }, [el('span', { className: 't', text: 'Paper forms' })]), chev()]),
      ]),
    ];
    // 1.17.0: an admin signed in in this browser, on a phone connected with someone's link: it keeps logging as that person
    var a = mode() === 'worker' ? adminCred() : null; // (a shared tablet never keeps an admin's sign-in outside an admin's turn)
    if (a) more.push(adminOnLinked(a));
    more.push(el('div', { className: 'home-foot' }, [el('span', { text: 'Field log ' + APP_VERSION }), el('span', { className: 'by-lockup', 'data-brand-poweredby': '', hidden: true })]));
    // 1.31.0: a quiet way out of (or back into) the laptop view; a touch tablet on Automatic never sees it (Settings has the choice)
    if (wideNow() && (deskOn() || layoutChoice() === 'phone')) {
      var desk = deskOn();
      more.push(el('button', { className: 'btn btn-text desk-toggle', type: 'button', id: 'desk-toggle', text: desk ? 'Switch to phone layout' : 'Switch to laptop layout', onclick: function () { setLayout(desk ? 'phone' : 'laptop'); } }));
    }
    // One column on a phone (who, in progress, forms, more); two on a wide screen (app.css .home)
    setView([el('div', { className: 'home' + (formsCol.length ? '' : ' home-one') }, [
      el('div', { className: 'home-a' }, nodes),
      formsCol.length ? el('div', { className: 'home-b' }, formsCol) : null,
      el('div', { className: 'home-c' }, more),
    ])], '');
    if (window.CH_CONFIG && CH_CONFIG.applyBrand) CH_CONFIG.applyBrand(view);
    if (homeFocus) { var hf = homeFocus; homeFocus = ''; focusHomeForm(hf); } // 1.31.0: after a save on the laptop view
  }

  /**
   * An admin signed in in this browser, but the device was opened with someone's link: the link wins (it was opened on
   * purpose; an admin signing in on a worker's phone must not take it over unnoticed). Switching is offered, and asked twice.
   */
  function disconnectLink() { dropRecords(); delete S.settings.url; delete S.settings.key; delete S.settings.locked; delete S.settings.role; delete S.settings.areas; delete S.settings.uid; delete S.settings.revoked; delete S.settings.replaced; delete S.settings.paused; delete S.settings.device_id; delete S.settings.device_name; delete S.settings.devices; delete S.settings.pin; delete S.settings.pin_set; save('ch.settings', S.settings); }
  /**
   * 1.17.1: sign an admin out on this phone (a 30-day sign-in left on a worker's phone). The server is told when it can be;
   * this phone forgets the sign-in either way. Their unsent entries stay here, waiting for them to sign in again.
   */
  function signOutAdmin(a) {
    var name = a.by || 'The admin', key = a.key;
    var at = CFG.scriptFor ? CFG.scriptFor(a.url || CFG.scriptUrl) : a.url;
    var done = function (told) {
      forgetAdmin(key);
      delete S.settings.skipAdmin; save('ch.settings', S.settings);
      S.session = ''; S.lastError = '';
      toast(told ? name + ' is signed out on this phone.' : name + ' is signed out on this phone. With no connection the sign-in could not be ended everywhere: ' + name + ' can end it with Change password.');
      render(); badge();
    };
    fetchT(at, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'logout', key: key }) }, 20000)
      .then(function (r) { return r.json(); })
      .then(function (j) { done(!!(j && (j.ok || j.signed_out))); }, function () { done(false); });
  }
  function adminOnLinked(a) {
    var box = el('div', { className: 'admin-hint', id: 'admin-on-linked' });
    var ask = function () {
      box.replaceChildren(el('p', { text: 'You are signed in as ' + (a.by || 'an admin') + ' in this browser too, but entries here are logged as ' + (S.settings.person || 'this phone\'s person') + ', from the link this phone was opened with.' }),
        el('div', { className: 'row' }, [
          el('a', { className: 'btn btn-secondary', href: 'dashboard.html', text: 'Switch to admin' }),
          el('button', { className: 'btn btn-secondary', type: 'button', id: 'use-signin', text: 'Log as ' + (a.by || 'me') + ' instead', onclick: sure }),
          el('button', { className: 'btn btn-secondary', type: 'button', id: 'admin-signout', text: 'Sign ' + (a.by || 'the admin') + ' out on this phone', onclick: function () { this.disabled = true; signOutAdmin(a); } }),
        ]));
    };
    var sure = function () {
      box.replaceChildren(el('p', { text: 'This phone stops using ' + (S.settings.person ? S.settings.person + '\'s' : 'its') + ' link and logs as ' + (a.by || 'you') + '. Entries already saved here are kept and sent with the name they were made under.' }),
        el('div', { className: 'row' }, [
          el('button', { className: 'btn btn-secondary', type: 'button', text: 'Keep it as it is', onclick: ask }),
          el('button', { className: 'btn btn-primary', type: 'button', id: 'use-signin-yes', text: 'Yes, log as ' + (a.by || 'me'), onclick: function () { disconnectLink(); delete S.settings.skipAdmin; save('ch.settings', S.settings); S.lastError = ''; toast('Logging as ' + person() + '.'); render(); badge(); sync(true); } }),
        ]));
    };
    ask();
    return box;
  }

  /** True if a person typed or picked something beyond what the form fills in by itself. */
  function draftHasWork(d) {
    var auto = { ferment: 1, date: 1, time: 1, stage: 1, turn: 1 };
    return Object.keys(d).some(function (k) {
      if (auto[k] || k.indexOf('__') === 0) return false;
      var v = d[k];
      if (Array.isArray(v)) return v.some(function (x) { return x !== '' && x !== null && x !== undefined; });
      return v !== '' && v !== null && v !== undefined;
    });
  }

  /**
   * Fill a form from a link (#/form/<id>?package=3.4-R2-P1). Only the form's own top-level questions of a
   * simple kind are filled. An unfinished draft of this form with other answers is never thrown away.
   */
  var PREFILL_TYPES = ['text', 'number', 'date', 'time', 'choice', 'yesno', 'ferment', 'ref'];
  function prefill(form, query) {
    var params = {};
    try { new URLSearchParams(query).forEach(function (v, k) { params[k] = String(v).trim().slice(0, 100); }); } catch (e) { return; }
    var fields = form.fields.filter(function (f) { return params.hasOwnProperty(f.key) && params[f.key] !== '' && PREFILL_TYPES.indexOf(f.type) >= 0; });
    if (!fields.length) return;
    var value = function (f) { return f.type === 'ref' && f.multiple ? params[f.key].split(',').map(function (x) { return x.trim(); }).filter(Boolean) : params[f.key]; };
    var d = S.drafts[form.id];
    var differs = !!d && fields.some(function (f) { return JSON.stringify(d[f.key]) !== JSON.stringify(value(f)); });
    if (d && differs && (d.__entry_id || !untouched(form, d))) {
      // never thrown away by itself: the form shows the draft and asks (renderForm, "clash")
      var shown = fields.filter(function (f) { return d[f.key] !== undefined && d[f.key] !== '' && JSON.stringify(d[f.key]) !== JSON.stringify(value(f)); })[0] || fields[0];
      S.clash = { form: form.id, query: query, what: shown, old: d[shown.key], now: value(shown) };
      return;
    }
    if (!d || differs) d = {};
    fields.forEach(function (f) { d[f.key] = value(f); });
    applyDefaults(form.fields, d);
    fields.forEach(function (f) { refreshDependentOf(form, d, f.key); });
    keepDraft(form, d);
  }
  /** "check-in for package 3.4-R2-P1": what an unsaved draft is, in words, from one of its answers. */
  function draftWords(form, f, v) {
    var noun = form.id === 'arrival' ? 'check-in' : form.title.toLowerCase(), thing = thingWords(f, v);
    return noun + (thing ? ' for ' + thing : '');
  }
  function thingWords(f, v) {
    if (!f || v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '';
    var what = f.type === 'ref' ? ((CH.KINDS[f.of] || {}).noun || f.label).toLowerCase() : f.type === 'ferment' ? 'box' : f.label.toLowerCase();
    return what + ' ' + [].concat(v).join(', ');
  }
  /**
   * A link opened a form (a scanned label) while an unsaved draft of it holds other answers: the form shows the draft with
   * a plain choice above it, never a toast that is easily missed. Keep it: carry on with the draft. Start the new one: the
   * draft is cleared and the form is filled from the link.
   */
  function clashNotice(form) {
    var c = S.clash;
    if (!c || c.form !== form.id) return null;
    return el('div', { className: 'notice warn', role: 'alert', id: 'draft-clash' }, [
      svgEl('triangle-alert', 20),
      el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'You have an unsaved ' + draftWords(form, c.what, c.old) + '.' }),
        el('span', { text: 'It is kept until you choose.' + (thingWords(c.what, c.now) ? ' The link you opened is for ' + thingWords(c.what, c.now) + '.' : '') }),
        el('div', { className: 'notice-actions' }, [
          el('button', { className: 'btn btn-primary', type: 'button', text: 'Keep it', onclick: function () { S.clash = null; renderForm(form); window.scrollTo(0, 0); } }),
          el('button', { className: 'btn btn-secondary', type: 'button', text: 'Start the new one', onclick: function () {
            S.clash = null; dropDraft(form); prefill(form, c.query); renderForm(form); window.scrollTo(0, 0); toast('Started a new ' + draftWords(form, c.what, c.now) + '.');
          } }),
        ]),
      ]),
    ]);
  }
  /** A choice changed: questions of this form whose default depends on it (dependsOn) are worked out again. The five fermentation forms have none. */
  function hasDependents(key) { var form = CH.formById(route().id); return !!form && form.fields.some(function (ff) { return ff.dependsOn === key; }); }
  function dependsOnChoice(d, key) {
    var form = CH.formById(route().id);
    if (form && form.fields.some(function (ff) { return ff.dependsOn === key; }) && S.drafts[form.id] === d) refreshDependentOf(form, d, key);
  }
  function refreshDependentOf(form, d, key) {
    form.fields.forEach(function (ff) { if (ff.dependsOn === key) d[ff.key] = resolveDefault(ff, d); });
  }
  /** True if a draft holds only what the form fills in by itself (given the same picks). */
  function untouched(form, d) {
    var fresh = {};
    form.fields.forEach(function (f) { if (f.type === 'ferment' || f.type === 'ref') fresh[f.key] = d[f.key]; });
    applyDefaults(form.fields, fresh);
    return Object.keys(d).every(function (k) {
      if (k.indexOf('__') === 0) return true;
      var v = d[k];
      var none = v === '' || v === null || v === undefined || (Array.isArray(v) && !v.some(function (x) { return x !== '' && x !== null && x !== undefined && !(typeof x === 'object' && !Object.keys(x).some(function (y) { return x[y] !== '' && x[y] !== undefined; })); }));
      return none || JSON.stringify(v) === JSON.stringify(fresh[k]);
    });
  }

  /** A pasted link: an invite's join link, a personal or shared #connect link. Nothing changes for anything else. */
  function usePasted(input) {
    var pasted = joinToken(input.value);
    if (pasted) { input.value = ''; startJoin(pasted); return; } // a pasted join link (an iPhone's home-screen app)
    if (readConnect(input.value)) { input.value = ''; toast('Connected. Sending entries…'); sync(true); render(); }
    else toast(S.badLink ? badLinkWords() : 'That does not look like an invite link. Copy the whole link and try again.');
  }
  function pasteRow() {
    var input = el('input', { type: 'text', id: 'connect-link', placeholder: 'Paste your invite link', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Invite link',
      onkeydown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); usePasted(input); } } });
    return el('div', { className: 'connect-row' }, [input, el('button', { className: 'btn btn-primary', type: 'button', text: 'Connect', onclick: function () { usePasted(input); } })]);
  }
  /** 1.20.0: the code from "Add another device" on the person's other phone, typed here (a laptop has no camera for the QR code). */
  function useCode(input) {
    var c = codeOf(input.value);
    if (!c) { toast('Type the 8 letters and numbers shown on your other device.'); input.focus(); return; }
    input.value = ''; startJoin('', c);
  }
  function codeRow() {
    var input = el('input', { type: 'text', id: 'connect-code', placeholder: 'For example K7P4-QX2M', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '12', 'aria-label': 'Code from your other device',
      onkeydown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); useCode(input); } } });
    return el('div', { className: 'connect-row' }, [input, el('button', { className: 'btn btn-secondary', type: 'button', id: 'connect-code-go', text: 'Use code', onclick: function () { useCode(input); } })]);
  }
  /** Settings, on a device with no link: the same box as the welcome screen. */
  function connectBox() {
    return el('div', { className: 'notice warn', role: 'status' }, [
      svgEl('wifi-off', 20),
      el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'This phone is not connected yet.' }),
        el('span', { text: 'Open the invite link from ' + CFG.contact + ' on this phone, or paste it here. Anything already saved on this phone stays here and is sent once it is connected.' }),
        pasteRow(),
      ]),
    ]);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  /** An admin's sign-in needs a new password or an email before entries can go (they stay waiting). */
  function sessionNotice(waiting) {
    return el('div', { className: 'notice bad', role: 'alert', id: 'session-notice' }, [
      svgEl('triangle-alert', 20),
      el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: SESSION_WORDS[S.session] }),
        el('span', { text: waiting ? 'Your ' + plural(waiting, 'unsent entry is', 'unsent entries are') + ' kept on this device and will be sent after that.' : 'Nothing is waiting to send.' }),
        el('div', { className: 'notice-actions' }, [el('a', { className: 'btn btn-primary', id: 'session-signin', href: signinUrl(S.session), text: S.session === 'must' ? 'Choose a new password' : S.session === 'email' ? 'Add your email' : 'Sign in again' })]),
      ]),
    ]);
  }

  /**
   * 1.17.1: this phone was disconnected from a link while an admin was signed in on it. The welcome screen asks what to
   * do with that sign-in: log as the admin (asked twice), or sign them out on this phone. Nothing happens by itself.
   */
  function setAsideBox(a) {
    var name = a.by || 'An admin';
    var box = el('div', { className: 'welcome-admin', id: 'welcome-admin-aside' });
    var ask = function () {
      box.replaceChildren(el('span', { text: name + ' is still signed in on this phone.' }), el('div', { className: 'row' }, [
        el('button', { className: 'btn btn-secondary', type: 'button', id: 'aside-log-as', text: 'Log as ' + name, onclick: sure }),
        el('button', { className: 'btn btn-secondary', type: 'button', id: 'aside-signout', text: 'Sign ' + name + ' out on this phone', onclick: function () { this.disabled = true; signOutAdmin(a); } }),
      ]));
    };
    var sure = function () {
      box.replaceChildren(el('span', { text: 'This phone then logs entries as ' + name + ', an admin, until ' + name + ' is signed out here.' }), el('div', { className: 'row' }, [
        el('button', { className: 'btn btn-secondary', type: 'button', text: 'Not now', onclick: ask }),
        el('button', { className: 'btn btn-primary', type: 'button', id: 'aside-log-as-yes', text: 'Yes, log as ' + name, onclick: function () { delete S.settings.skipAdmin; save('ch.settings', S.settings); S.lastError = ''; toast('Logging as ' + person() + '.'); render(); badge(); sync(true); } }),
      ]));
    };
    ask();
    return box;
  }

  /*
   * The front door (1.17.0): a device with no link and no admin sign-in. No name to type and no forms: people are invited
   * (People page: email, text, WhatsApp, QR) and the link opens this app with their name in it. Admins sign in. Anything
   * already saved here (from before this version, or an admin whose sign-in ended) is listed and kept, never removed.
   */
  function renderWelcome() {
    var waiting = S.entries.filter(function (e) { return e.status === 'waiting'; });
    var mine = waiting.filter(function (e) { return !!e.admin; }); // made by a signed-in admin: their sign-in sends them
    var drafts = Object.keys(S.drafts || {}).filter(function (k) { var d = S.drafts[k]; return d && typeof d === 'object' && (d.__entry_id || draftHasWork(d)); }).length;
    var saved = null;
    if (mine.length && adminSetAside()) { // 1.17.1: the admin is still signed in here, only set aside: the box below asks
      saved = el('div', { className: 'notice info', role: 'status', id: 'welcome-admin-kept' }, [svgEl('info', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: plural(mine.length, 'entry', 'entries') + ' made by ' + (adminCred().by || 'an admin') + (mine.length === 1 ? ' is' : ' are') + ' kept on this phone.' }),
        el('span', { text: 'They are sent once this phone logs as ' + (adminCred().by || 'that admin') + ' again. Nothing is lost.' }),
        el('div', { className: 'notice-actions' }, [el('a', { className: 'btn btn-secondary', href: '#/entries', text: 'See them' })]),
      ])]);
    } else if (mine.length) {
      saved = el('div', { className: 'notice warn', role: 'alert', id: 'welcome-signin-again' }, [svgEl('clock', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: SESSION_WORDS.again }),
        el('span', { text: 'Your sign-in has ended. ' + plural(waiting.length, 'entry is', 'entries are') + ' kept on this device and will be sent once you sign in.' + (drafts ? ' ' + plural(drafts, 'unfinished form is', 'unfinished forms are') + ' kept too.' : '') }),
        el('div', { className: 'notice-actions' }, [
          el('a', { className: 'btn btn-primary', id: 'signin-again', href: signinUrl('again'), text: 'Sign in again' }),
          el('a', { className: 'btn btn-secondary', href: '#/entries', text: 'See them' }),
        ]),
      ])]);
    } else if (waiting.length || drafts) {
      saved = el('div', { className: 'notice info', role: 'status', id: 'welcome-saved' }, [svgEl('info', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: (waiting.length ? plural(waiting.length, 'entry is', 'entries are') + ' saved on this phone' : 'Unfinished work is saved on this phone') + '.' }),
        el('span', { text: (waiting.length ? 'They will be sent once you open your invite link on this phone. Nothing is lost.' : '') + (drafts ? (waiting.length ? ' ' : '') + plural(drafts, 'unfinished form is', 'unfinished forms are') + ' kept for you to finish after that.' : '') }),
        waiting.length ? el('div', { className: 'notice-actions' }, [el('a', { className: 'btn btn-secondary', href: '#/entries', text: 'See them' })]) : null,
      ])]);
    }
    setView([ // the company's name and logo are in the top bar (brand slots)
      el('section', { className: 'welcome', id: 'welcome', 'aria-labelledby': 'welcome-title' }, [
        saved,
        el('div', { className: 'card welcome-card' }, [
          el('h1', { id: 'welcome-title', text: 'Open your invite link' }),
          el('p', { className: 'sub', text: 'This app is for people invited by your team.' }),
          el('ol', { className: 'welcome-steps' }, [
            el('li', {}, [el('span', { className: 'welcome-ic', html: ICON('mail', 20) }), el('span', { text: 'Open the invite link you were sent (email, text or WhatsApp) on this phone.' })]),
            el('li', {}, [el('span', { className: 'welcome-ic', html: ICON('circle-check', 20) }), el('span', { text: 'The app opens with your name in it, ready to log.' })]),
          ]),
          el('div', { className: 'welcome-paste' }, [
            el('label', { for: 'connect-link', text: 'Or paste the link here' }),
            pasteRow(),
          ]),
          el('div', { className: 'welcome-paste welcome-code' }, [
            el('label', { for: 'connect-code', text: 'Have a code from your other phone? Type it here.' }),
            codeRow(),
          ]),
          el('p', { className: 'welcome-help', id: 'help-contact', text: 'No link yet? Ask ' + CFG.contact + ' to invite you.' }),
        ]),
        adminSetAside() ? setAsideBox(adminCred()) : el('div', { className: 'welcome-admin' }, [
          el('span', { text: 'Manage the data?' }),
          el('a', { className: 'btn btn-secondary', id: 'welcome-signin', href: signinUrl(''), text: 'Sign in' }),
        ]),
        el('div', { className: 'home-foot' }, [el('span', { text: 'Field log ' + APP_VERSION }), el('span', { className: 'by-lockup', 'data-brand-poweredby': '', hidden: true })]),
      ]),
    ], 'Welcome');
    if (window.CH_CONFIG && CH_CONFIG.applyBrand) CH_CONFIG.applyBrand(view);
  }

  function renderPerson() {
    var people = list('Person');
    // The list can arrive while someone is typing: keep what they typed when the screen is redrawn.
    var was = document.getElementById('person-other'), wasQ = document.getElementById('person-search');
    var other = el('input', { type: 'text', id: 'person-other', placeholder: 'Your name', autocomplete: 'name', value: was ? was.value : null });
    function pick(name) {
      name = String(name || '').trim();
      if (!name) { toast('Type your name first.'); return; }
      S.settings.person = name; save('ch.settings', S.settings); render();
    }
    var rows = people.map(function (p) {
      var b = el('button', { className: 'person-row', type: 'button', onclick: function () { pick(p); } }, [
        el('span', { className: 'avatar', 'aria-hidden': 'true', text: initials(p) }), el('span', { className: 'nm', text: p }), chev(),
      ]);
      b.dataset.name = p.toLowerCase();
      return b;
    });
    // A search box once the list is long enough to scroll on a phone.
    var none = el('p', { className: 'sub', id: 'person-none', text: 'No one by that name. Type your name below.' });
    none.hidden = true;
    var search = people.length > 8 ? el('input', { type: 'search', id: 'person-search', placeholder: 'Search names', autocomplete: 'off', 'aria-label': 'Search names', oninput: function () {
      var q = search.value.trim().toLowerCase(), shown = 0;
      rows.forEach(function (b) { var ok = !q || b.dataset.name.indexOf(q) >= 0; b.hidden = !ok; if (ok) shown++; });
      none.hidden = shown > 0;
    } }) : null;
    var typing = was && document.activeElement === was ? other : (wasQ && document.activeElement === wasQ ? search : null);
    setView([
      el('div', { className: 'page-head' }, [
        el('h1', { text: 'Who is logging entries?' }),
        el('p', { className: 'sub', text: 'Your name is saved with each entry. You can change it later in Settings.' }),
      ]),
      search ? el('div', { className: 'q' }, [search]) : null,
      people.length ? el('div', { className: 'people' }, rows) : null,
      search ? none : null,
      el('div', { className: 'q' }, [el('label', { for: 'person-other', text: people.length ? 'Not on the list? Type your name' : 'Your name' }), other]),
      el('button', { className: 'btn btn-primary btn-block', type: 'button', text: 'Continue', onclick: function () { pick(other.value); } }),
    ], 'Who');
    if (search && wasQ && wasQ.value) { search.value = wasQ.value; search.dispatchEvent(new Event('input')); }
    if (typing) typing.focus();
  }

  /* ---------------- forms ---------------- */

  function draftFor(form) {
    var d = S.drafts[form.id];
    if (d) {
      // P2-C: a Pack draft begun before (one list of packages, one type) becomes one group per package: the same rows in the same order
      if (form.id === 'pack' && !Array.isArray(d.groups) && Array.isArray(d.packages)) {
        d.groups = d.packages.map(function (p) { return { package_type: d.package_type || '', lbs: (p || {}).lbs, count: '1', 'for': 'Shipping' }; });
        delete d.packages; delete d.package_type;
      }
      return d;
    }
    d = {};
    applyDefaults(form.fields, d);
    return d;
  }
  function applyDefaults(fields, data, paper) {
    paper = paper || !!data.__paper;
    fields.forEach(function (f) {
      if (data[f.key] !== undefined) return;
      if (paper && (f.default === 'today' || f.default === 'now')) return; // P4-B/1: from paper, the date and time on the paper are typed, never today's
      if (f.type === 'repeat') {
        data[f.key] = [];
        for (var i = 0; i < (f.min || 0); i++) { var it = {}; applyDefaults(f.fields, it, paper); data[f.key].push(it); }
        return;
      }
      var v = resolveDefault(f, data);
      if (v !== undefined) data[f.key] = v;
      else if (f.type === 'chips') data[f.key] = [];
      else if (f.type === 'temps') data[f.key] = ['', '', '', '', ''];
      else if (f.type === 'buckets') data[f.key] = [];
    });
  }
  /**
   * P4-B/1: an admin typing in a paper form. The draft keeps __paper (true) and __paper_by (the writer's name). The entry is
   * sent with paper: {written_by}; the script records "<writer> (paper, typed in by <admin>)" for a signed-in admin only.
   * Dates and times are not filled in for you in paper mode: the ones on the paper are typed.
   */
  function paperOn(data) { return mode() === 'admin' && !!data.__paper; }
  function paperName(data) { return paperOn(data) ? String(data.__paper_by || '').replace(/\s+/g, ' ').trim().slice(0, 60) : ''; }
  function setPaper(form, data, on) {
    if (on) {
      data.__paper = true;
      // the paper's own date and time: only what was filled in for you goes (review nit: a date or time already typed stays)
      form.fields.forEach(function (f) {
        if (f.default === 'today' && data[f.key] === today()) data[f.key] = '';
        if (f.default === 'now' && !data.__time_typed) data[f.key] = ''; // a time typed or set with "Now" is marked __time_typed
      });
    } else {
      delete data.__paper; delete data.__paper_by; delete data.__paper_other;
      form.fields.forEach(function (f) { if ((f.default === 'today' || f.default === 'now') && !data[f.key]) data[f.key] = resolveDefault(f, data); });
    }
  }
  function paperLine(p) { return p && p.written_by ? el('p', { className: 'sub paper-line', text: (p.scanned ? 'From paper, scanned' : 'From paper') + ' · written by ' + p.written_by }) : null; }
  function paperBox(form, data, errs, rerender, changed) {
    var on = !!data.__paper;
    var sw = el('input', { type: 'checkbox', id: 'paper-switch', checked: on, disabled: !!data.__scan, onchange: function () { setPaper(form, data, sw.checked); rerender(); } }); // P4-B/2: a scanned form is always from paper
    var box = el('div', { className: 'paper-box q', id: 'paper-box', 'data-key': '__paper_by' }, [el('label', { className: 'paper-switch', for: 'paper-switch' }, [sw, ' Typing in a paper form'])]);
    if (!on) return box;
    var people = list('Person'), by = String(data.__paper_by || '');
    var other = !!data.__paper_other || (by && people.indexOf(by) < 0);
    var sel = el('select', { id: 'paper-by', 'aria-label': 'Written by', onchange: function () {
      if (sel.value === '__other') { data.__paper_other = true; data.__paper_by = ''; rerender(); return; }
      delete data.__paper_other; data.__paper_by = sel.value; changed(); } },
      [el('option', { value: '', text: 'Choose a name' })].concat(people.map(function (n) { return el('option', { value: n, text: n }); }), [el('option', { value: '__other', text: 'Other…' })]));
    sel.value = other ? '__other' : by;
    var typed = other ? el('input', { type: 'text', id: 'paper-other', placeholder: 'Name on the paper', maxlength: 60, autocomplete: 'off', value: by, oninput: function () { data.__paper_by = typed.value; changed(); } }) : null;
    box.className += errs.__paper_by ? ' is-error' : '';
    box.appendChild(el('div', { className: 'paper-by' }, [el('label', { for: 'paper-by', text: 'Written by' }), sel, typed, errs.__paper_by ? fieldMsg('bad', errs.__paper_by, 'paper-by-msg') : null]));
    box.appendChild(el('p', { className: 'help', text: 'Type the date and time that are on the paper.' }));
    return box;
  }
  /*
   * P4-B/2: a scanned paper form. scan.html keeps each read in localStorage "ch.scans" ({id, form, at, by, answers: [{key, value,
   * read, unsure, why}]}) and its photo in CH_PHOTOS.scans. "Look and save" opens #/form/<form>?__scan=<id>: the scan becomes
   * this form's draft in paper mode, sure answers filled in, unsure ones left EMPTY (so no default fills them either) and listed
   * in __scan.look {key: {read, why}}, shown as "Needs a look · Reader thinks: …" beside the photo. Admins only. Saving is the
   * normal entry path, sent with paper: {written_by, scanned: true}; then the scan and its photo are dropped from this device.
   * The reader's words are only ever answers or text on the screen (textContent), never anything else.
   */
  var SCAN_WHY = { unsure: 'The reader was not sure.', not_a_choice: 'Not one of the choices.', not_a_number: 'Not a number.', out_of_range: 'Outside what this question takes.',
    not_a_date: 'Not a date.', date_far: 'Not near today\'s date.', not_a_time: 'Not a time.', unknown_id: 'No such ID in the records.',
    id_as_number: 'Read as a number, so a 0 at the end may be lost.', missing: 'Needed, but nothing was read.',
    id_twin: 'Another ID differs only by a 0 at the end (like 2.1 and 2.10).', new_id: 'A new ID: copy it from the paper yourself.',
    comma: 'A comma: a decimal point or thousands? Type it as on the paper.', date_order: 'The day and month could be either way round.' }; // review M1, M2, L2
  function scanParam(query) { var m = /(?:^|&)__scan=([A-Za-z0-9-]{1,60})(?:&|$)/.exec(String(query || '')); return m ? m[1] : ''; }
  function scanItems() { var v = load('ch.scans', []); return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object' && typeof x.id === 'string'; }) : []; }
  function scanItem(id) { var me = String((adminCred() || {}).id || ''); return scanItems().filter(function (x) { return x.id === id && String(x.by || '') === me; })[0] || null; }
  function scanDone(id) {
    try { localStorage.setItem('ch.scans', JSON.stringify(scanItems().filter(function (x) { return x.id !== id; }))); } catch (e) { /* stays listed on scan.html; nothing is lost */ }
    if (window.CH_PHOTOS && CH_PHOTOS.scans) CH_PHOTOS.scans.drop(id).catch(function () {});
  }
  function scanDraft(form, it) {
    var d = { __paper: true, __scan: { id: it.id, at: String(it.at || ''), look: {} } };
    var filled = {};
    (Array.isArray(it.answers) ? it.answers : []).forEach(function (a) {
      var f = a && form.fields.filter(function (x) { return x.key === a.key && x.type !== 'repeat' && x.type !== 'photo'; })[0];
      if (!f) return;
      var list = f.type === 'chips' || f.type === 'temps' || f.type === 'buckets' || (f.type === 'ref' && f.multiple);
      var v = a.unsure ? (list ? [] : '') : list ? (Array.isArray(a.value) ? a.value : []).map(String).slice(0, 60) : String(a.value === undefined || a.value === null ? '' : a.value);
      if (f.type === 'temps') { var t = ['', '', '', '', '']; v.slice(0, 5).forEach(function (x, i) { t[i] = x; }); v = t; }
      d[f.key] = v; // an unsure answer is left empty on purpose: no default fills it in
      if (a.unsure) d.__scan.look[f.key] = { read: String(a.read || '').slice(0, 300), why: SCAN_WHY.hasOwnProperty(a.why) ? a.why : 'unsure' };
      else filled[f.key] = true;
    });
    applyDefaults(form.fields, d, true);
    Object.keys(filled).forEach(function (k) { form.fields.forEach(function (ff) { if (ff.dependsOn === k && !filled[ff.key] && !d.__scan.look[ff.key]) d[ff.key] = resolveDefault(ff, d); }); });
    return d;
  }
  /** #/form/<form>?__scan=<id>: the scan becomes the draft, unless an unsaved draft of this form is there (then the form asks). */
  function openScan(form, id) {
    if (!form || mode() !== 'admin') return;
    var it = scanItem(id);
    var d = S.drafts[form.id];
    if (d && d.__scan && d.__scan.id === id) return; // opened before: carry on with it
    if (!it || it.form !== form.id) { S.scanGone = true; return; }
    if (d && (d.__entry_id || !untouched(form, d))) { S.scanClash = { form: form.id, id: id }; return; }
    keepDraft(form, scanDraft(form, it));
    saveDrafts();
  }
  function scanClashNotice(form) {
    var c = S.scanClash;
    if (!c || c.form !== form.id) return null;
    return el('div', { className: 'notice warn', role: 'alert', id: 'scan-clash' }, [svgEl('triangle-alert', 20), el('div', { className: 'notice-body' }, [
      el('div', { className: 'notice-title', text: 'You have an unsaved ' + form.title.toLowerCase() + ' on this device.' }),
      el('span', { text: 'It is kept until you choose. Opening the scan replaces it: what you typed there is cleared.' }),
      el('div', { className: 'notice-actions' }, [
        el('button', { className: 'btn btn-primary', type: 'button', text: 'Keep it', onclick: function () { S.scanClash = null; renderForm(form); } }),
        el('button', { className: 'btn btn-secondary', type: 'button', id: 'scan-take', text: 'Replace it with the scan', onclick: function () {
          S.scanClash = null; dropDraft(form); openScan(form, c.id); renderForm(form); window.scrollTo(0, 0);
        } }),
      ]),
    ])]);
  }
  /** The photo and the line above the form, for a scanned draft. */
  function scanBox(data) {
    var sc = data.__scan, n = Object.keys(sc.look || {}).length;
    var img = el('img', { className: 'scan-photo', alt: 'The photo of the paper form' });
    var holder = el('button', { type: 'button', className: 'scan-photo-btn', 'aria-pressed': 'false', 'aria-label': 'The photo of the paper form: show larger', onclick: function () {
      var big = !holder.classList.contains('is-big'); holder.classList.toggle('is-big', big); holder.setAttribute('aria-pressed', big ? 'true' : 'false');
    } }, [img]);
    var note = el('p', { className: 'help', id: 'scan-photo-note', hidden: true });
    if (window.CH_PHOTOS && CH_PHOTOS.scans) CH_PHOTOS.scans.preview(sc.id).then(function (url) { if (url) img.src = url; else { holder.remove(); note.hidden = false; note.textContent = 'The photo is no longer on this device. Check the answers against the paper.'; } }).catch(function () { holder.remove(); note.hidden = false; note.textContent = 'The photo could not be shown. Check the answers against the paper.'; });
    return el('section', { className: 'scan-box', id: 'scan-box' }, [
      el('p', { className: 'scan-lead', text: 'Read from a photo. Check every answer against the paper' + (n ? '; ' + n + (n === 1 ? ' answer is' : ' answers are') + ' left empty for you, marked Needs a look.' : '.') }),
      holder, note,
    ]);
  }
  /** After the form is drawn: "Needs a look" on each unsure question, with what the reader thinks (as text). */
  function paintScan(data) {
    var look = (data.__scan && data.__scan.look) || {};
    Object.keys(look).forEach(function (k) {
      var q = view.querySelector('.q[data-key="' + k.replace(/[^a-z0-9_]/g, '') + '"]');
      if (!q || q.querySelector('.scan-hint')) return;
      q.classList.add('needs-look');
      var l = look[k], hint = el('p', { className: 'scan-hint' }, [el('b', { text: 'Needs a look' }), document.createTextNode(l.read ? ' · Reader thinks: ' + l.read : ' · Nothing was read for it.'), el('span', { className: 'scan-why', text: ' ' + (SCAN_WHY[l.why] || SCAN_WHY.unsure) })]);
      q.insertBefore(hint, q.firstChild ? q.firstChild.nextSibling : null);
      var fold = q.closest ? q.closest('details') : null;
      if (fold && !fold.open) fold.open = true;
    });
  }
  var draftTimer, draftWrite = null;
  /**
   * 1.17.1: who is logging right now. A draft keeps who started it (__by), and the entry is saved under that person, so a
   * form begun by one person and saved after another's link or sign-in took over is never put under the wrong name: it is
   * sent the "(sent with …'s link)" way. The form says so, and "Save it as <now> instead" hands it over on purpose.
   */
  function whoNow() {
    var m = mode();
    if (m === 'shared') return { name: person(), locked: true, worker: TURN ? TURN.user : undefined, turn: true }; // 1.21.0
    return { name: person(), locked: nameLocked(), admin: m === 'admin' ? { id: String(adminCred().id || ''), name: person() } : undefined, worker: m === 'worker' && S.settings.uid ? S.settings.uid : undefined };
  }
  function samePerson(x, y) {
    if (!x || !y) return true;
    if (!!x.admin !== !!y.admin) return false;
    if (x.admin) return x.admin.id && y.admin.id ? x.admin.id === y.admin.id : x.name === y.name;
    if (x.worker && y.worker) return x.worker === y.worker;
    return x.name === y.name;
  }
  /** Where drafts are kept: one set per device, or (1.21.0, a shared tablet) one set per person, never shown to the next one. */
  function draftsKey() { return shared() ? (TURN ? 'ch.drafts.' + TURN.user : '') : 'ch.drafts'; }
  function saveDrafts() { clearTimeout(draftTimer); draftWrite = null; var k = draftsKey(); if (k) save(k, S.drafts); } // 1.31.0: a write waiting is done by this one (never later, from an old copy)
  function keepDraft(form, data) {
    if (data.__kept) return; // 1.30.1: this draft is already a stored entry; a key pressed during the save must not bring it back (or its entry ID)
    if (shared() && !TURN) return; // nobody's turn: nothing is kept under nobody
    if (!data.__by && mode() !== 'none') data.__by = whoNow();
    S.drafts[form.id] = data;
    clearTimeout(draftTimer);
    var k = draftsKey(), all = S.drafts;
    draftWrite = function () { draftWrite = null; if (k) save(k, all); }; // 1.31.0: the write waiting, so flushDrafts can do it now
    draftTimer = setTimeout(function () { if (draftWrite) draftWrite(); }, 400);
  }
  function dropDraft(form) { delete S.drafts[form.id]; saveDrafts(); if (foldState.form === form.id) foldState.form = ''; }

  function renderForm(form, notice) {
    var data = draftFor(form);
    curDraft = data;
    var errorsByKey = (notice && notice.byKey) || {};
    // Device-made IDs are worked out again after an edit, but never once this draft has an entry ID: it may already be stored under it.
    function rerender(n) { if (!data.__entry_id) delete data.__prepared; keepDraft(form, data); var y = window.scrollY; renderForm(form, n); if (!n) window.scrollTo(0, y); } // a tap keeps your place on the page
    function changed() { if (!data.__entry_id) delete data.__prepared; keepDraft(form, data); paintLive(); paintFold(); needSoon(); }
    // A line worked out from the answers and redrawn as they are typed (form.live: Start batch's nib : sugar ratio)
    var live = form.live ? el('p', { className: 'live-note', id: 'live-note', 'aria-live': 'polite' }) : null;
    function paintLive() { if (live) { var t = form.live.text(cleanData(form.fields, data), formCtx()); live.textContent = t; live.hidden = !t; } }

    var warnKeys = (notice && notice.warnKeys) || {};
    var desk = deskOn(); // 1.31.0: the laptop view (looks only: short questions two to a row, app.css)
    var body = el('form', { id: 'entry-form', className: desk ? 'form-qs' : undefined, novalidate: true, onsubmit: function (ev) { ev.preventDefault(); submit(false); } });
    var HALF = { number: 1, date: 1, time: 1, yesno: 1 };
    var qEl = function (f) { var q = fieldEl(f, data, f.key, errorsByKey, changed, rerender, warnKeys); if (desk && HALF[f.type] && q) q.setAttribute('data-w', 'half'); return q; };
    if (mode() === 'admin') body.appendChild(paperBox(form, data, errorsByKey, rerender, changed)); // P4-B/1: admins only
    var headings = SECTIONS[form.id] || {};
    var section = null, carried = '';
    /*
     * Folding (design slice 8). Optional questions marked fold: true in schema.js sit under "More details (n)" at the
     * end of the form, with how many of them are filled in, so nothing is hidden by surprise. Which questions fold is
     * that fixed flag only: the form never rearranges itself. Looks only: a folded question is still part of the draft,
     * is still checked and still saved to the same column (cleanData, validate and toOps never look at the fold).
     * A form folds only when two or more of its questions would; a folded question with a problem opens the fold.
     */
    var shownNow = function (f) { return !(CH.fieldOn && !CH.fieldOn(f)) && CH.visible(f, data) && !hiddenEmpty(f); };
    var folds = function (f) { return !!f.fold && !f.required && f.type !== 'repeat'; };
    var folded = form.fields.filter(function (f) { return folds(f) && shownNow(f); });
    var foldBox = folded.length >= 2 ? el('div', { className: 'fold-body' }) : null;
    form.fields.forEach(function (f) {
      // 2.3.0: a question this company switched off takes its section heading with it to the next question shown
      if (CH.fieldOn && !CH.fieldOn(f)) { if (headings[f.key]) { var hh = [].concat(headings[f.key]); carried = hh.length > 1 ? hh[1] : hh[0]; } return; }
      if (!CH.visible(f, data) || hiddenEmpty(f)) return;
      if (foldBox && folds(f)) { // its section heading goes on to the next question that stays up front (or is not shown)
        if (headings[f.key]) carried = [].concat(headings[f.key])[0];
        foldBox.appendChild(fieldEl(f, data, f.key, errorsByKey, changed, rerender, warnKeys));
        return;
      }
      var head = [].concat(headings[f.key] || carried)[0];
      carried = '';
      if (head) { section = el('section', { className: 'sec' + (desk ? ' form-qs' : '') }, [el('h2', { className: 'sec-head', text: head })]); body.appendChild(section); }
      (section || body).appendChild(qEl(f));
      if (live && form.live.after === f.key) (section || body).appendChild(live);
    });
    var foldCount = null, fold = null;
    if (foldBox) {
      var marked = folded.some(function (f) { return errorsByKey[f.key] || warnKeys[f.key]; });
      if (foldState.form !== form.id) { foldState.form = form.id; foldState.open = false; }
      if (marked) foldState.open = true;
      foldCount = el('span', { className: 'fold-n', id: 'more-filled' });
      fold = el('details', { className: 'fold', id: 'more-details' }, [
        el('summary', {}, [el('span', { className: 'fold-txt' }, [el('span', { className: 'fold-t', text: 'More details' }), el('span', { className: 'fold-sub' }, [el('span', { className: 'fold-q', text: folded.length + ' optional questions' }), foldCount])]), el('span', { className: 'chev', html: ICON('chevron-down', 20) })]),
        foldBox,
      ]);
      fold.open = foldState.open;
      fold.addEventListener('toggle', function () { foldState.open = fold.open; }); // screen state only: never in the draft
      body.appendChild(fold);
    }
    function answered(v) { return Array.isArray(v) ? v.some(function (x) { return x !== '' && x !== null && x !== undefined; }) : v !== '' && v !== null && v !== undefined; }
    function paintFold() {
      if (!foldCount) return;
      var n = folded.filter(function (f) { return answered(typeof data[f.key] === 'string' ? data[f.key].trim() : data[f.key]); }).length;
      foldCount.textContent = n ? n + ' filled' : '';
      foldCount.hidden = !n;
    }
    paintLive(); paintFold();

    // 1.31.0: "Save and start another" (laptop view only): never after Pack (its labels come next), on a paper or scanned
    // form, or on a form opened for one item (a scanned label's "Check this package in")
    var againOk = desk && !form.afterSave && !data.__paper && !data.__scan && prefilledFor !== form.id;
    var nodes = [deskRail(form), el('div', { className: 'page-head' }, [el('h1', { text: form.title }), el('p', { className: 'sub', text: 'Logging as ' + person() }), paperLine(paperName(data) && { written_by: paperName(data), scanned: !!data.__scan })])];
    if (data.__by && !samePerson(data.__by, whoNow())) { // 1.17.1: begun under someone else's name
      nodes.push(el('div', { className: 'notice warn', role: 'status', id: 'draft-owner' }, [svgEl('user', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'This form was started by ' + (data.__by.name || 'someone else') + '.' }),
        el('span', { text: 'It is saved under ' + (data.__by.name || 'their') + '\'s name unless you take it over.' }),
        el('div', { className: 'notice-actions' }, [el('button', { className: 'btn btn-secondary', type: 'button', id: 'draft-take', text: 'Save it as ' + person() + ' instead', onclick: function () { data.__by = whoNow(); rerender(); } })]),
      ])]));
    }
    if (S.clash && S.clash.form !== form.id) S.clash = null; // a choice only for the form the link opened
    nodes.push(clashNotice(form));
    if (S.scanClash && S.scanClash.form !== form.id) S.scanClash = null;
    nodes.push(scanClashNotice(form)); // P4-B/2
    if (S.scanGone) { S.scanGone = false; nodes.push(el('div', { className: 'notice warn', role: 'status', id: 'scan-gone' }, [svgEl('triangle-alert', 20), el('div', { className: 'notice-body' }, [el('span', { text: 'That scan is no longer on this device. Scan the paper again, or type it in.' })])])); }
    if (data.__scan && paperOn(data)) nodes.push(scanBox(data));
    nodes.push(body);
    nodes.push(el('div', { className: 'form-foot' }, [
      el('span', { text: 'Going back keeps what you typed for later.' }),
      el('button', { className: 'btn btn-ghost', type: 'button', text: 'Clear this form', onclick: function () { dropDraft(form); renderForm(form); toast('Form cleared.'); } }),
    ]));
    // The summary sits directly above the save bar, where the person is looking when they tap Save.
    var panel = null;
    if (notice && notice.kind === 'errors') {
      panel = el('div', { className: 'notice bad', role: 'alert' }, [
        svgEl('circle-alert', 20),
        el('div', { className: 'notice-body' }, notice.byKey
          // problems on the fields: one short line here, the messages stay on the fields; "Show me" goes to the first one
          ? [el('div', { className: 'notice-title', text: notice.items.length + (notice.items.length === 1 ? ' thing to fix' : ' things to fix') }),
            el('div', { className: 'notice-actions' }, [el('button', { className: 'btn btn-secondary', type: 'button', text: 'Show me', onclick: function () { focusProblem(); } })])]
          : [el('div', { className: 'notice-title', text: 'Please fix these first:' }), el('ul', {}, notice.items.map(function (m) { return el('li', { text: m }); }))]),
      ]);
    }
    if (notice && notice.kind === 'warnings') {
      panel = el('div', { className: 'notice warn', role: 'alert' }, [
        svgEl('triangle-alert', 20),
        el('div', { className: 'notice-body' }, [
          el('div', { className: 'notice-title', text: 'Check these before saving:' }),
          el('ul', {}, notice.items.map(function (m) { return el('li', { text: m }); })),
          el('div', { className: 'notice-actions' }, [
            el('button', { className: 'btn btn-primary', type: 'button', text: 'Yes, save', onclick: function () { submit(true, !!notice.again); } }),
            el('button', { className: 'btn btn-secondary', type: 'button', text: 'Go back and fix', onclick: function () { renderForm(form, { kind: 'fix', warnKeys: warnKeys }); focusProblem(); } }),
          ]),
        ]),
      ]);
    }
    // "2 answers needed": what Save would still ask for, counted as the form is filled in; a tap goes to the first one.
    // It only reads the answers (the same check Save runs); it never marks a question wrong before Save is tapped.
    var need = panel ? null : el('button', { className: 'need', type: 'button', id: 'need', hidden: true, onclick: function () { showNeeded(); } });
    var needKeys = [], needTimer;
    function paintNeed() {
      if (!need) return;
      var was = need.hidden;
      try {
        var res = CH.validate(form, cleanData(form.fields, data));
        needKeys = res.errors.filter(function (e) { return / is needed\.$|^Add at least /.test(e.msg); }).map(function (e) { return e.key; });
        // review fix: a bucket weight typed but not added (or a bucket fix not saved) is pointed to as well; Save stops on it
        var pend = bucketsPending(form.fields, data, ''), adds = pend.filter(function (p) { return p.kind === 'add'; }).length, fixes = pend.length - adds;
        var words = [];
        if (needKeys.length) words.push(needKeys.length + (needKeys.length === 1 ? ' answer needed' : ' answers needed'));
        if (adds) words.push(adds + (adds === 1 ? ' bucket not added' : ' buckets not added'));
        if (fixes) words.push(fixes + (fixes === 1 ? ' bucket fix not saved' : ' bucket fixes not saved'));
        needKeys = needKeys.concat(pend.map(function (p) { return p.key; }));
        need.hidden = !needKeys.length;
        need.textContent = '';
        need.appendChild(el('span', { text: words.join(' · ') }));
        need.appendChild(el('span', { className: 'need-go', text: 'Show me' }));
      } catch (e) { needKeys = []; need.hidden = true; } // only a hint: Save still runs the full check, so a problem here hides the line
      if (was !== need.hidden) sizeBar();
    }
    function needSoon() { clearTimeout(needTimer); var seq = viewSeq; needTimer = setTimeout(function () { if (seq === viewSeq) paintNeed(); }, 150); }
    function sizeBar() { var sb = document.getElementById('savebar'); if (sb) document.documentElement.style.setProperty('--savebar-h', sb.offsetHeight + 'px'); }
    function showNeeded() {
      paintNeed();
      var q = null;
      Array.prototype.some.call(view.querySelectorAll('.q[data-key]'), function (x) { if (needKeys.indexOf(x.getAttribute('data-key')) >= 0) q = x; return !!q; }); // the first on the page
      if (!q) needKeys.some(function (k) { q = view.querySelector('.q[data-key="' + k.replace(/"/g, '') + '"]'); return !!q; });
      if (!q) return;
      var inFold = q.closest ? q.closest('details') : null;
      if (inFold && !inFold.open) inFold.open = true;
      var target = q.querySelector('.bk-ein') || q.querySelector('input:not([type=radio]):not([type=checkbox]), textarea, button.pk-open') || q.querySelector('input, button');
      if (q.scrollIntoView) q.scrollIntoView({ block: 'center' });
      if (target && target.focus) target.focus({ preventScroll: true });
    }
    nodes.push(el('div', { className: 'savebar', id: 'savebar' }, [el('div', { className: 'savebar-in' }, [
      panel,
      need,
      el('div', { className: 'savebar-btns' }, [
        el('button', { className: 'btn btn-secondary', type: 'button', text: 'Back', onclick: function () { go('#/'); } }),
        el('button', { className: 'btn btn-primary', type: 'submit', form: 'entry-form', id: 'save', text: 'Save', 'aria-keyshortcuts': desk ? 'Control+Enter Meta+Enter' : undefined }),
      ]),
      againOk ? el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'save-again', text: 'Save and start another', 'aria-keyshortcuts': 'Control+Shift+Enter Meta+Shift+Enter', onclick: function () { submit(false, true); } }) : null,
      desk ? savedToday(form) : null,
    ])]));
    setView(nodes, form.title);
    if (data.__scan && paperOn(data)) paintScan(data); // P4-B/2
    paintNeed();
    sizeBar(); // the bar's height decides how far the page scrolls up behind it
    if (notice && notice.kind === 'errors') focusProblem();

    /** Scroll to the first field that is marked, and put the cursor in it. */
    function focusProblem() {
      var bad = view.querySelector('.is-error, .is-warn');
      if (!bad) return;
      var inFold = bad.closest ? bad.closest('details') : null;
      if (inFold && !inFold.open) inFold.open = true;
      var target = bad.querySelector('.bk-ein') || bad.querySelector('input:not([type=radio]):not([type=checkbox]), textarea, button.pk-open') || bad.querySelector('input'); // a bucket fix not saved: its own box
      if (bad.scrollIntoView) bad.scrollIntoView({ block: 'center' });
      if (target && target.focus) target.focus({ preventScroll: true });
    }

    function submit(acceptWarnings, again) {
      if (S.saving) return; // a second tap while saving does nothing
      // 1.17.0: signed out in another tab while this form was open: what was typed stays as a draft, saved under nobody's name never
      if (mode() === 'none') { keepDraft(form, data); rerender({ kind: 'errors', items: ['You are not signed in any more. What you typed is kept on this device: sign in again, then save it.'] }); return; }
      if (shared() && !TURN) { go('#/'); return; } // 1.21.0: a turn ended meanwhile: the form was kept for its owner
      var clean = cleanData(form.fields, data);
      var ctx = formCtx(data.__entry_id);
      var res = CH.validate(form, clean, ctx);
      if (data.__paper && mode() === 'admin' && !paperName(data)) res.errors.unshift({ key: '__paper_by', msg: 'Who wrote it? Choose the name on the paper.' });
      // review fix: a bucket weight typed but not added, or a bucket fix not saved, stops Save (never dropped, never added for you)
      bucketsPending(form.fields, data, '').forEach(function (p) { res.errors.push({ key: p.key, msg: p.msg }); });
      if (res.errors.length) {
        var byKey = {};
        res.errors.forEach(function (e) { byKey[e.key] = e.msg; });
        rerender({ kind: 'errors', items: res.errors.map(function (e) { return e.msg; }), byKey: byKey });
        return;
      }
      var checks = res.warnings.map(function (e) { return e.msg; });
      var ask = form.confirm ? form.confirm(clean, ctx) : '';
      if (ask) checks.push(ask);
      if (checks.length && !acceptWarnings) {
        var wk = {};
        res.warnings.forEach(function (w) { (wk[w.key] = wk[w.key] || []).push(w.msg); });
        rerender({ kind: 'warnings', items: checks, warnKeys: wk, again: !!again });
        return;
      }
      if (!data.__entry_id) { data.__entry_id = uid(); keepDraft(form, data); } // same ID if Save is tapped twice
      S.saving = true;
      var saveBtn = view.querySelector('.savebar .btn-primary[type=submit]');
      if (saveBtn) { saveBtn.disabled = true; if (!again) saveBtn.textContent = 'Saving…'; }
      var againBtn = view.querySelector('#save-again'); // 1.31.0: both buttons wait while one saves
      if (againBtn) { againBtn.disabled = true; if (again) againBtn.textContent = 'Saving…'; }
      if (typeof form.prepare !== 'function') { save2(again); return; } // the fermentation forms: straight on, as before
      var failed = function (msg) { S.saving = false; rerender({ kind: 'errors', items: [msg] }); };
      // Is this draft already stored on this device (a save whose screen then failed)? Then its device-made IDs
      // (package numbers, a shipment ID) may be on printed labels: they are kept, and only new rows get new ones.
      var stored = CH.DB.get ? CH.DB.get(data.__entry_id).catch(function () { return { data: data.__prepared || {}, status: 'waiting' }; }) : Promise.resolve(null); // cannot tell: keep what was worked out
      stored.then(function (old) {
        if (old && old.status && old.status !== 'waiting') { // already sent: saving it again would change nothing on the Sheet
          S.saving = false; data.__kept = true; dropDraft(form); toast('This entry was already saved and sent.'); go('#/'); return;
        }
        if (typeof form.prepare === 'function') {
          data.__prepared = form.prepare(clean, ctx, old ? old.data : null) || {};
          keepDraft(form, data);
          Object.keys(data.__prepared).forEach(function (k) { clean[k] = data.__prepared[k]; });
          var bad = typeof form.preparedProblem === 'function' ? form.preparedProblem(clean) : '';
          if (bad) { failed(bad); return; }
        }
        save2(again);
      });
    }
    function save2(again) {
      var clean = cleanData(form.fields, data);
      if (data.__prepared) Object.keys(data.__prepared).forEach(function (k) { clean[k] = data.__prepared[k]; });
      var ops;
      // 2.3.0: the columns of questions this company switched off are left out (CH.opsFor); with none off it is exactly toOps
      try { ops = CH.opsFor ? CH.opsFor(form, clean) : form.toOps(clean); } catch (err) { S.saving = false; rerender({ kind: 'errors', items: [String(err && err.message || err)] }); return; }
      // rule 10: the ferment, roasts, packages… picked that an entry on this device made, whatever that entry's status
      // (waiting, sent, held for review, already in the lists), so the server can tell a box another phone gave the same ID
      var fsrc = CH.fermentSource(form, clean, S.entries, data.__entry_id);
      var sources = CH.refSources(form, clean, S.entries, data.__entry_id);
      var by = data.__by || whoNow(); // who started this form (1.17.1)
      var entry = {
        entry_id: data.__entry_id, form: form.id,
        ferment_source: fsrc || undefined, sources: sources.length ? sources : undefined, created_at: new Date().toISOString(), recorded_by: by.name, personal: by.locked ? true : undefined,
        admin: by.admin, worker: by.worker, // made by a signed-in admin (1.17.0), or by the person whose link this was (1.17.1); see personalFor
        paper: paperName(data) ? (data.__scan ? { written_by: paperName(data), scanned: true } : { written_by: paperName(data) }) : undefined, // P4-B/1; P4-B/2: read from a photo first
        device: S.settings.device, app_version: APP_VERSION, data: clean, ops: ops,
        summary: form.summary(clean), status: 'waiting',
      };
      entry.needs_script = (CH.needsScript && CH.needsScript(entry)) || undefined; // 1.29.2: the oldest script that takes it (never sent)
      // 1.21.0: on a shared tablet the entry is signed now, with this turn's secret, so it can be sent later by anyone's turn
      // and the server can still tell whose it was. The secret itself is never stored with it.
      var t = shared() ? TURN : null;
      // Review fix: version 2 proofs cover what the entry does (ops, sources); an admin's turn names its sign-in (sref).
      var signing = t ? window.CH_TURNS.proof(t.secret, entry, t.user).then(function (p) {
        entry.turn = t.kind === 'admin' ? { v: 2, kind: 'admin', device: S.settings.device_id, user: t.user, sref: t.sref, dgen: t.dgen, proof: p }
          : { v: 2, kind: 'person', device: S.settings.device_id, user: t.user, gen: t.gen, dgen: t.dgen, ep: t.ep, proof: p };
      }) : Promise.resolve();
      var scanned = data.__scan && data.__scan.id;
      signing.then(function () { return CH.DB.put(entry); }).then(function () {
        data.__kept = true; // 1.30.1: before anything else, so typing on during the save cannot keep this draft again
        S.saving = false;
        dropDraft(form);
        if (scanned) scanDone(scanned); // P4-B/2: the entry is kept on this device now; the scan and its photo go
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
        return refreshEntries();
      }).then(function () {
        badge(); // review L5: the new entry is counted at once
        if (form.afterSave === 'labels') { sync(false); renderPacked(entry); return; } // Pack: offer the labels at once, before the entry is even sent
        toast(deskOn() ? 'Saved on this device. Sending when online.' : 'Saved on this phone. Sending when online.');
        // 1.31.0: "Save and start another" only chooses where to go now that the entry is kept: the same form again, as a
        // new draft (the old one was dropped above, so the next entry gets a new entry ID), nothing carried over
        // review: home only from the form that was saved; someone who moved on (the rail, another tab) stays where they are
        var here = route().name === 'form' && route().id === form.id;
        if (again && deskOn() && mayUse(form) && here) { go('#/form/' + form.id); focusFirstQ(); }
        else if (here) { homeFocus = deskOn() ? form.id : ''; go('#/'); }
        sync(false);
      }).catch(function (err) {
        S.saving = false;
        delete data.__kept; // stored, but the screen after it failed: the draft is kept again with its entry ID, so Save again replaces that same waiting entry and keeps its device-made IDs (as before 1.30.1)
        rerender({ kind: 'errors', items: ['Could not save on this device: ' + (err && err.message ? err.message : err) + '. Write it on paper for now.'] });
      });
    }
  }

  /** After a Pack save: the labels are ready to print now (print.html works with no signal). */
  function renderPacked(entry) {
    var n = (entry.data.package_ids || []).length;
    setView([
      el('div', { className: 'page-head' }, [el('h1', { text: 'Saved' }), el('p', { className: 'sub', text: entry.summary })]),
      el('section', { className: 'card done' }, [
        svgEl('circle-check', 28),
        el('h2', { text: n + (n === 1 ? ' label is' : ' labels are') + ' ready to print' }),
        el('p', { className: 'help', text: 'Saved on this tablet; it is sent as soon as there is a connection. The labels print without one.' }),
        el('div', { className: 'row' }, [
          el('a', { className: 'btn btn-primary', href: 'print.html?entry=' + encodeURIComponent(entry.entry_id), 'data-act': 'print' }, [ico('printer', 20), el('span', { text: 'Print labels' })]),
          el('button', { className: 'btn btn-secondary', type: 'button', text: 'Done', onclick: function () { go('#/'); } }),
        ]),
      ]),
    ], 'Saved');
    window.scrollTo(0, 0);
  }

  /** Values of visible fields only, trimmed. */
  function cleanData(fields, data) {
    var out = {};
    fields.forEach(function (f) {
      if (!CH.visible(f, data) || hiddenEmpty(f)) return;
      var v = data[f.key];
      if (f.type === 'repeat') { out[f.key] = (v || []).map(function (it) { return cleanData(f.fields, it); }); return; }
      if (typeof v === 'string') v = v.trim();
      if (f.type === 'number' && typeof v === 'string') v = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v) ? v.replace(/,/g, '') : v.replace(',', '.');
      if (f.type === 'temps') v = (v || []).map(function (t) { return String(t || '').trim().replace(',', '.'); });
      if (f.type === 'buckets') v = CH.bucketList({ bucket_weights: v }); // trimmed, comma → dot, blanks dropped (a draft from before: [])
      out[f.key] = v;
    });
    // P1-A: with buckets on the list, Wet beans and Buckets are what the list adds up to, whatever the boxes hold
    fields.forEach(function (f) {
      var b = f.type === 'buckets' ? out[f.key] : null;
      if (!b || !b.length || !b.every(function (x) { return CH.BUCKET_NUM.test(x); })) return; // a bad bucket is refused by the check; nothing is worked out from it
      if (f.sumInto && out.hasOwnProperty(f.sumInto)) out[f.sumInto] = String(CH.bucketSum(b));
      if (f.countInto && out.hasOwnProperty(f.countInto)) out[f.countInto] = String(b.length);
    });
    return out;
  }

  // Section headings shown above a field, per form (looks only: fields, ids and answers are unchanged).
  var SECTIONS = {
    // [heading, heading when its own question is switched off (2.3.0)]
    new_ferment: { ferment: 'Box', deliveries: 'Beans in the box', juice: ['Juice and Brix', 'Brix'], additions: 'Additions and notes' },
    ferment_check: { ferment: 'Which box', top: 'Temperatures', colour: ['Look and smell', 'Smell'], ridges: 'Cut test', problems: 'Problems and additions' },
    drying_check: { ferment: 'Which box', location: 'Where and weather', outside: 'How the beans look', moisture: 'Moisture and notes' }, // P1-C: the look starts at Outside of beans
    add_beans: { ferment: 'Which box', farm: 'The delivery', note: 'Notes' },
    finish_drying: { ferment: 'Which box', exterior_date: 'Dry dates', moisture: 'Moisture', cut_ridges: 'Cut test', dry_lbs: 'Weight', bags: 'Bags', notes: 'Notes' }, // P1-C: the cut test after drying sits between moisture and weight
    arrival: { package: 'Package', smell: 'Smell, taste and look', notes: 'Notes' },
    batch_start: { batch_id: 'Batch', inputs: 'Packages used', sugar_lbs: 'For chocolate', other: 'Anything else added' },
    batch_finish: { batch: 'Batch', hours_to_target: 'Fineness and conching', process_temp: 'Temperature', output_lbs: 'What came out' },
    tasting_note: { kind: 'What it is about', sample: 'How it tasted', notes: 'Notes' },
    roast: { smell: ['Check about 10 cut beans', ''] }, // P2-B: '' = switched off, so the heading does not move to the next question
  };

  // P4-A: the photo questions, last on their forms, under their own heading
  SECTIONS.ferment_check.photo_beans = 'Photos'; SECTIONS.drying_check.photo = 'Photo'; SECTIONS.finish_drying.photo_cut = 'Photo';

  /** An optional question whose Sheet list is still empty is not shown (e.g. Ferment plan until Jake adds plans). */
  function hiddenEmpty(f) { return !!f.hideIfEmpty && !!f.list && !list(f.list).length; }
  /*
   * How a question's options are laid out (field design, 1.24.0). Looks only: the same radios and tick boxes as before.
   * Equal tiles in a grid, sized by the longest label so they line up: 'xs' (F0, F1: one row), 's' (three across on a
   * phone), 'm' (two across), 'l' (one per line). 'seg': a short fixed scale where one is picked (Yes / No, 0% to 100%)
   * is one joined bar. Pick-one tiles carry a round mark, pick-any a square one (ui.css, body.field).
   */
  var SEG_MAX = { 2: 14, 3: 14, 4: 7, 5: 4 }; // the longest label a joined bar of n parts can hold on a 360 px phone
  function optBox(labels, o) {
    o = o || {};
    var n = labels.length, max = labels.reduce(function (m, l) { return Math.max(m, String(l).length); }, 0);
    var size = o.single && o.fixed && SEG_MAX[n] && max <= SEG_MAX[n] ? 'seg'
      : o.fixed ? 'l' // a few fixed answers with long words (What are you doing?): one per line, full width
        : n <= 4 && max <= 4 ? 'xs' : max <= 6 ? 's' : max <= 22 ? 'm' : 'l';
    var box = el('div', { className: 'chips opts', 'data-size': size, 'data-pick': o.single ? 'one' : 'any' });
    if (size === 'seg') box.style.setProperty('--n', String(n));
    return box;
  }
  function moreBtn(attrs, icon, text) { return el('button', Object.assign({ type: 'button' }, attrs), [svgEl(icon, 18), el('span', { text: text })]); }
  function chipOpt(input, label, other) { return el('label', { className: 'chip-opt' + (other ? ' other' : '') }, [input, el('span', { text: label })]); }
  function fieldMsg(kind, text, id) {
    return el('p', { className: 'field-msg ' + kind, id: id }, [svgEl(kind === 'bad' ? 'circle-alert' : 'triangle-alert', 16), el('span', { text: text })]);
  }

  /*
   * Leaving a typed box (by tapping a button) can redraw the form. If the redraw happens between the
   * finger going down and the tap landing, the tap hits a button that no longer exists and is lost.
   * afterTap waits for that tap to finish first; with no finger down it runs straight away.
   */
  var pointerDown = false;
  document.addEventListener('pointerdown', function () { pointerDown = true; }, true);
  document.addEventListener('pointerup', function () { setTimeout(function () { pointerDown = false; }, 0); }, true);
  document.addEventListener('pointercancel', function () { pointerDown = false; }, true);
  function afterTap(fn) {
    var seq = viewSeq;
    // Runs once the current tap and redraw are over, and only if nothing has redrawn the screen meanwhile
    // (a redraw already shows the latest answers, and leaving the form must not bring it back).
    var later = function () { if (seq === viewSeq) fn(); };
    if (!pointerDown) { if (swapping) setTimeout(later, 0); else fn(); return; }
    var done = false;
    function run() { if (done) return; done = true; document.removeEventListener('click', run, true); setTimeout(later, 0); }
    document.addEventListener('click', run, true);
    setTimeout(run, 700); // a long press or a scroll gives no click
  }

  var fieldSeq = 0;

  /* ---------------- compact pickers for long lists ---------------- */

  // One rule for every choice (design slice 8): up to 6 options are chips; 7 to 12 show the first six as chips plus
  // "More…" (the picker sheet); more than 12 show only what was used lately (or what is picked) and the picker sheet.
  var PICK_AT = 7;     // from this many options a choice gets "More…" and the picker sheet
  var MULTI_AT = 7;    // the same for a tick-several question
  var CHIPS_MAX = 6;   // chips shown up front for 7 to 12 options
  var SHEET_AT = 13;   // from this many, no fixed chips up front
  var RECENT_MAX = 3;
  var picker = null;   // the open full-screen list, if any (never saved in drafts)
  // An old phone browser without <dialog> keeps the plain buttons, so every choice can still be picked.
  var CAN_DIALOG = typeof document.createElement('dialog').showModal === 'function';

  /** The last few different values this phone saved for this field, newest first (only ones still on the list). */
  function recentValues(fkey, allowed) {
    var out = [];
    function take(v) {
      if (typeof v === 'string' && v && allowed.indexOf(v) >= 0 && out.indexOf(v) < 0 && out.length < RECENT_MAX) out.push(v);
    }
    for (var i = 0; i < S.entries.length && out.length < RECENT_MAX; i++) {
      var d = S.entries[i].data || {};
      take(d[fkey]);
      Object.keys(d).forEach(function (k) {
        if (Array.isArray(d[k])) d[k].forEach(function (it) { if (it && typeof it === 'object' && !Array.isArray(it)) take(it[fkey]); });
      });
    }
    return out;
  }

  /** Close the full-screen list. popHistory: also remove the history step added when it opened. */
  function closePicker(popHistory) {
    var p = picker;
    if (!p) return;
    picker = null;
    if (p.dlg.open) p.dlg.close();
    p.dlg.remove();
    if (popHistory && p.pushed) history.back();
    if (p.onClose) p.onClose();
  }
  // The phone's Back button closes the list instead of leaving the form.
  window.addEventListener('popstate', function () { if (picker) closePicker(false); });

  /**
   * Open the picker sheet: the one full-screen list for every long choice and every ID (design slice 8).
   * cfg: title, items, multi, selected (value, or array when multi), recent, noneLabel, allowOther, otherOn,
   * onPick(value) / onOther() / onNone() for single picks, onDone(array) for multi, onClose().
   * An item is a string, or {value, label, sub, group}: sub is the context shown beside it ("box 2 · day 3"), group
   * a heading above the first item that has it ("In progress"). search: true always shows the search box (IDs);
   * otherwise it shows from 13 items. selectAll: a "Select all" button (multi).
   * typeIn: {label, inputLabel, placeholder, inputmode, value, onType(text)}: a last row that lets an ID be typed.
   * It only ever changes the answer of the question that opened it: nothing here saves, sends or removes anything.
   */
  function openPicker(cfg) {
    closePicker(true);
    var n = 'pk' + (++fieldSeq);
    var kind = cfg.multi ? 'checkbox' : 'radio';
    var cur = cfg.multi ? (cfg.selected || []).slice() : null;
    var dlg = el('dialog', { className: 'pk', 'aria-labelledby': n + '-t' });
    var rows = [];
    var items = cfg.items.map(function (o) { return typeof o === 'string' ? { value: o, label: o } : o; });
    // An arrow key moves through a list of radio buttons and "clicks" each one on the way: that must not choose it.
    // Enter or Space chooses the one the keyboard is on; a tap or a mouse click chooses at once, as before.
    var arrow = false;
    dlg.addEventListener('keydown', function (ev) {
      if (/^Arrow/.test(ev.key)) { arrow = true; setTimeout(function () { arrow = false; }, 0); }
      else if (ev.key === 'Enter' && ev.target && ev.target.type === 'radio') { ev.preventDefault(); arrow = false; ev.target.click(); } // review: Enter right after an arrow still chooses
    }, true);
    function row(o, name, checked, onClick) {
      var inp = el('input', { type: kind, name: name, value: o.value, checked: !!checked });
      inp.addEventListener('click', function () { if (arrow && !cfg.multi) return; onClick(inp); });
      var txt = o.sub
        ? el('span', { className: 'pk-txt' }, [el('span', { className: 'pk-t id', text: o.label }), el('span', { className: 'pk-sub', text: o.sub })])
        : el('span', { className: 'pk-txt', text: o.label });
      return el('label', { className: 'pk-row' }, [inp, txt]);
    }
    var plain = function (text) { return { value: text, label: text }; };
    var fs = el('fieldset', { className: 'pk-list' }, [el('legend', { className: 'sr-only', text: cfg.title })]);
    function head(text) { return el('p', { className: 'pk-head2', text: text }); }
    var finish = function () { closePicker(true); };
    var group = null;
    function groupHead(o) {
      if (o.group === undefined || o.group === group) return;
      group = o.group;
      if (group) { var h = head(group); h.className += ' pk-skip'; fs.appendChild(h); }
    }
    if (!cfg.multi) {
      if (cfg.noneLabel) {
        var nr = row(plain(cfg.noneLabel), n, !cfg.selected && !cfg.otherOn, function () { cfg.onNone(); finish(); });
        nr.className += ' pk-skip'; fs.appendChild(nr);
      }
      if (cfg.recent && cfg.recent.length) {
        var rg = el('div', { className: 'pk-recent pk-skip' }, [head('Recent')]);
        cfg.recent.forEach(function (o) { rg.appendChild(row(plain(o), n + 'r', cfg.selected === o, function () { cfg.onPick(o); finish(); })); });
        fs.appendChild(rg);
        var ah = head('All'); ah.className += ' pk-skip'; fs.appendChild(ah);
      }
      items.forEach(function (o) {
        groupHead(o);
        var r = row(o, n, cfg.selected === o.value, function () { cfg.onPick(o.value); finish(); });
        r.dataset.q = (o.label + ' ' + (o.sub || '')).toLowerCase(); if (o.group) r.dataset.group = o.group; rows.push(r); fs.appendChild(r);
      });
      if (cfg.allowOther) fs.appendChild(row(plain('Other – type it'), n, cfg.otherOn, function () { cfg.onOther(); finish(); }));
    } else {
      items.forEach(function (o) {
        groupHead(o);
        var r = row(o, n, cur.indexOf(o.value) >= 0, function (inp) {
          cur = cur.filter(function (x) { return x !== o.value; });
          if (inp.checked) cur.push(o.value);
        });
        r.dataset.q = (o.label + ' ' + (o.sub || '')).toLowerCase(); if (o.group) r.dataset.group = o.group; rows.push(r); fs.appendChild(r);
      });
    }
    var none = el('p', { className: 'pk-none', text: items.length ? 'Nothing matches. Clear the search to see everything.' : (cfg.emptyText || 'Nothing to pick on this phone yet.') });
    none.hidden = items.length > 0;
    var search = null;
    if (items.length > 12 || (cfg.search && items.length > 0)) {
      search = el('input', { type: 'search', className: 'pk-search', placeholder: 'Search', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Search ' + cfg.title.toLowerCase(),
        oninput: function () {
          var q = search.value.trim().toLowerCase(), shown = 0;
          rows.forEach(function (r) { var ok = !q || r.dataset.q.indexOf(q) >= 0; r.hidden = !ok; if (ok) shown++; });
          Array.prototype.forEach.call(fs.querySelectorAll('.pk-skip'), function (x) { x.hidden = !!q; }); // "no answer", Recent and headings are for the full list
          none.hidden = shown > 0;
        } });
    }
    // "Not in the list": the ID can still be typed (a box started on another phone, a label read by eye)
    var typeBox = null;
    if (cfg.typeIn) {
      var t = cfg.typeIn;
      var tin = el('input', { type: 'text', id: n + '-type', className: 'pk-type', inputmode: t.inputmode, placeholder: t.placeholder, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', value: t.value || '',
        onkeydown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); useTyped(); } } });
      var useTyped = function () {
        var val = tin.value.trim();
        if (!val) { tin.focus(); return; }
        t.onType(val); finish();
      };
      var form = el('div', { className: 'pk-typeform' }, [
        el('label', { for: n + '-type', text: t.inputLabel }),
        el('div', { className: 'pk-typerow' }, [tin, el('button', { className: 'btn btn-primary', type: 'button', text: 'Use this', onclick: useTyped })]),
        t.hint ? el('p', { className: 'help', text: t.hint }) : null,
      ]);
      form.hidden = !t.value && items.length > 0;
      var opener = el('button', { className: 'pk-typein', type: 'button', 'aria-expanded': form.hidden ? 'false' : 'true', onclick: function () {
        form.hidden = false; opener.setAttribute('aria-expanded', 'true'); tin.focus();
        if (form.scrollIntoView) form.scrollIntoView({ block: 'center' });
      } }, [ico('pencil', 20), el('span', { text: t.label || 'Not in the list' })]);
      typeBox = el('div', { className: 'pk-typebox' }, [opener, form]);
    }
    var closeBtn = el('button', { className: 'pk-close', type: 'button', 'aria-label': 'Close', onclick: function () { closePicker(true); } }, [ico('x', 24), el('span', { text: 'Close' })]);
    dlg.appendChild(el('div', { className: 'pk-bar' }, [el('h2', { id: n + '-t', text: cfg.title }), closeBtn]));
    if (search) dlg.appendChild(el('div', { className: 'pk-searchrow' }, [search]));
    dlg.appendChild(el('div', { className: 'pk-scroll' }, [fs, none, typeBox]));
    if (cfg.multi) {
      dlg.appendChild(el('div', { className: 'pk-foot' }, [
        cfg.selectAll && items.length > 1 ? el('button', { className: 'btn btn-secondary', type: 'button', text: 'Select all', onclick: function () {
          rows.forEach(function (r) { var inp = r.querySelector('input'); if (!r.hidden && !inp.checked) { inp.checked = true; cur.push(inp.value); } });
        } }) : null,
        el('button', { className: 'btn btn-primary', type: 'button', text: 'Done', onclick: function () { closePicker(true); } }),
      ]));
    }
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); closePicker(true); }); // Esc
    document.body.appendChild(dlg);
    history.pushState({ chPicker: 1 }, '');
    picker = { dlg: dlg, pushed: true, onClose: function () {
      if (cfg.multi && cfg.onDone) cfg.onDone(cur);
      if (cfg.onClose) cfg.onClose();
    } };
    if (CAN_DIALOG) dlg.showModal(); else dlg.setAttribute('open', ''); // idField never opens it there (plainIdField); a safety net
    if (deskOn()) {
      // 1.31.0, the laptop view: typing goes straight into the search; ↑/↓ move between the rows (without choosing), Enter picks
      dlg.classList.add('pk-desk');
      dlg.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
        var t = ev.target;
        if (t === search || (t && t.type === kind && t.closest && t.closest('.pk-list'))) {
          var ins = Array.prototype.filter.call(fs.querySelectorAll('.pk-row input'), function (x) { return !!x.closest('.pk-row').offsetParent; });
          var i = ins.indexOf(t), to = t === search ? (ev.key === 'ArrowDown' ? ins[0] : null) : ev.key === 'ArrowDown' ? ins[i + 1] : (i > 0 ? ins[i - 1] : search);
          ev.preventDefault();
          if (to && to.focus) { to.focus(); if (to.scrollIntoView && to !== search) to.closest('.pk-row').scrollIntoView({ block: 'nearest' }); }
        }
      });
      if (search) { search.focus(); return; }
    }
    closeBtn.focus();
    var on = dlg.querySelector('input:checked');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'center' });
  }

  function focusPk(key) {
    var b = view.querySelector('[data-pk="' + key + '"]');
    if (b && b.focus) b.focus({ preventScroll: true });
  }
  function fieldEl(f, obj, key, errs, changed, rerender, warns) {
    warns = warns || {};
    var id = 'f' + (++fieldSeq);
    var isSet = f.type === 'choice' || f.type === 'chips' || f.type === 'yesno' || f.type === 'temps';
    var wrap = el(isSet ? 'fieldset' : 'div', { className: 'q' + (errs[key] ? ' is-error' : '') + (warns[key] && !errs[key] ? ' is-warn' : ''), 'data-key': key });
    var labelTag = isSet ? 'legend' : 'label';
    // A list of cards already has its section heading, so its label is only kept for screen readers.
    wrap.appendChild(el(labelTag, Object.assign(labelTag === 'label' ? { for: id } : {}, f.type === 'repeat' ? { className: 'sr-only' } : {}), [f.label, f.required ? el('span', { className: 'req', text: ' *', 'aria-hidden': 'true' }) : null]));
    if (f.help) wrap.appendChild(el('p', { className: 'help', text: f.help }));
    var msgId = id + '-msg';
    var invalid = errs[key] ? { 'aria-invalid': 'true', 'aria-describedby': msgId } : {};

    var v = obj[f.key], saidHere = false;
    switch (f.type) {
      case 'text': case 'number': case 'date': case 'time': {
        // P1-A: Wet beans and Buckets while buckets are on the list: what the list adds up to, read-only (see case 'buckets')
        var summed = f.type === 'number' && (f.sumOf || f.countOf) ? bucketsFill(f, obj) : null;
        if (summed !== null) { v = summed; obj[f.key] = summed; }
        var input = el('input', Object.assign({
          id: id, type: f.type === 'number' ? 'text' : f.type, value: v === undefined || v === null ? '' : v,
          inputmode: f.type === 'number' ? 'decimal' : f.inputmode, placeholder: f.placeholder, autocomplete: 'off', required: f.required, readonly: !!f.readonly || summed !== null,
          oninput: function () {
            obj[f.key] = input.value;
            if (f.type === 'time') obj.__time_typed = true;
            if (f.type === 'date' && f.key === 'date' && input.value !== today() && obj.time && !obj.__time_typed) { obj.time = ''; changed(); rerender(); return; }
            changed();
          },
          // a date that other answers follow (Start batch: the batch number's year): worked out again once the date is picked
          onchange: f.type === 'date' && hasDependents(f.key) ? function () { obj[f.key] = input.value; changed(); dependsOnChoice(obj, f.key); rerender(); } : undefined,
        }, invalid));
        if (f.unit && !errs[key]) input.setAttribute('aria-describedby', id + '-unit');
        if (f.type === 'time' && f.now) {
          // "Now": the time is tapped as it happens, while the form stays open as a draft
          wrap.appendChild(el('div', { className: 'input-unit' }, [input, el('button', { className: 'btn btn-secondary', type: 'button', text: 'Now', 'aria-label': f.label + ': now', onclick: function () {
            input.value = nowTime(); obj[f.key] = input.value; obj.__time_typed = true; changed();
          } })]));
          break;
        }
        wrap.appendChild(f.unit ? el('div', { className: 'input-unit' }, [input, el('span', { className: 'unit', id: id + '-unit', text: f.unit })]) : input);
        if (f.type === 'number' && bucketField(f, obj)) wrap.appendChild(el('p', { className: 'sum-note', text: f.sumOf ? 'Added up from the buckets.' : 'Counted from the buckets.', hidden: summed === null }));
        break;
      }
      case 'photo': photoField(f, obj, id, wrap, changed); break; // P4-A: the camera (see photoField)
      case 'textarea': {
        var ta = el('textarea', Object.assign({ id: id, placeholder: f.placeholder, oninput: function () { obj[f.key] = ta.value; changed(); } }, invalid));
        ta.value = v || '';
        wrap.appendChild(ta);
        break;
      }
      case 'yesno':
      case 'choice': {
        var opts = f.type === 'yesno' ? ['Yes', 'No'] : (f.options ? CH.optionsOf(f, v) : list(f.list)); // 2.4.0: an option whose area is off is not offered
        var isOther = !!v && opts.indexOf(v) < 0;
        // A long Sheet list (not fixed options) gets recent chips plus a full-screen list; the count is read each time it is drawn.
        var compact = CAN_DIALOG && f.type === 'choice' && !f.options && !!f.list && opts.length >= PICK_AT;
        var shownLabel = function (o) { return (f.optionLabels && f.optionLabels[o]) || o; };
        var box = optBox((compact ? opts.slice(0, CHIPS_MAX) : opts).map(shownLabel), { single: true, fixed: f.type === 'yesno' || !!f.options });
        var more = el('div', { className: 'opt-more' });
        var radio = function (o, other) {
          var checked = o === 'Other…' && other ? isOther : v === o;
          var inp = el('input', { type: 'radio', name: id, value: o, checked: !!checked });
          inp.addEventListener('click', function () {
            if (o === 'Other…' && other) { obj[f.key] = isOther ? v : ''; obj['__other_' + f.key] = true; }
            else if (obj[f.key] === o && !f.required) { obj[f.key] = ''; }
            else { obj[f.key] = o; delete obj['__other_' + f.key]; dependsOnChoice(obj, f.key); }
            rerender();
          });
          return inp;
        };
        var typedLabel = null;
        if (compact) {
          // 7 to 12: the first six, always in the list's own order (the form never rearranges itself); 13 or more: the last few used
          var shown = opts.length < SHEET_AT ? opts.slice(0, CHIPS_MAX) : recentValues(f.key, opts);
          if (v && !isOther && shown.indexOf(v) < 0) shown = opts.length < SHEET_AT ? shown.concat([v]) : [v].concat(shown);
          shown.forEach(function (o) { box.appendChild(chipOpt(radio(o), o)); });
          if (isOther) { // a typed value shows as the selected chip
            var tinp = radio(v);
            typedLabel = el('span', { text: v });
            box.appendChild(el('label', { className: 'chip-opt' }, [tinp, typedLabel]));
          }
          more.appendChild(moreBtn({ className: 'chip-btn other pk-open', 'aria-haspopup': 'dialog', 'data-pk': key, onclick: function () {
            openPicker({
              title: f.label, items: opts, recent: recentValues(f.key, opts), selected: isOther ? null : v,
              noneLabel: f.required ? '' : (f.noneLabel || 'None'), allowOther: true, otherOn: isOther || !!obj['__other_' + f.key],
              onPick: function (o) { obj[f.key] = o; delete obj['__other_' + f.key]; rerender(); },
              onNone: function () { obj[f.key] = ''; delete obj['__other_' + f.key]; rerender(); },
              onOther: function () { obj[f.key] = isOther ? v : ''; obj['__other_' + f.key] = true; rerender(); },
              onClose: function () {
                var t = obj['__other_' + f.key] && !obj[f.key] ? view.querySelector('[data-pk-other="' + key + '"]') : null;
                if (t) t.focus({ preventScroll: true }); else focusPk(key);
              },
            });
          } }, 'list', f.pickerLabel || 'More…'));
        } else {
          opts.forEach(function (o) { box.appendChild(chipOpt(radio(o, true), shownLabel(o))); });
          if (f.list) more.appendChild(chipOpt(radio('Other…', true), 'Other…', true)); // an action under the tiles, not one more answer among them
        }
        wrap.appendChild(box);
        if (more.firstChild) wrap.appendChild(more);
        if (isOther || obj['__other_' + f.key]) {
          var ot = el('input', { type: 'text', className: 'other', placeholder: 'Type it', value: isOther ? v : '', 'aria-label': f.label + ' (other)', 'data-pk-other': key,
            oninput: function () {
              obj[f.key] = ot.value; changed();
              if (typedLabel) { typedLabel.textContent = ot.value; typedLabel.parentNode.hidden = !ot.value.trim(); }
            } });
          wrap.appendChild(ot);
        }
        break;
      }
      case 'chips': {
        var sel = Array.isArray(v) ? v : [];
        var all = list(f.list);
        var extra = sel.filter(function (x) { return all.indexOf(x) < 0; });
        var longList = CAN_DIALOG && all.length >= MULTI_AT;
        var cmore = el('div', { className: 'opt-more' });
        // 7 to 12: the first six and whatever else is picked; 13 or more: only what is picked. The picker sheet has the rest.
        var upFront = !longList ? all.concat(extra) : all.length < SHEET_AT ? all.slice(0, CHIPS_MAX).concat(sel.filter(function (x) { return all.slice(0, CHIPS_MAX).indexOf(x) < 0; })) : sel;
        var cbox = optBox(upFront, { single: false });
        upFront.forEach(function (o) {
          var cb = el('input', { type: 'checkbox', value: o, checked: sel.indexOf(o) >= 0 });
          cb.addEventListener('change', function () {
            var cur = (obj[f.key] || []).filter(function (x) { return x !== o; });
            if (cb.checked) cur.push(o);
            obj[f.key] = cur; changed();
            if (longList) rerender();
          });
          cbox.appendChild(chipOpt(cb, o));
        });
        if (longList) {
          cmore.appendChild(moreBtn({ className: 'chip-btn other pk-open', 'aria-haspopup': 'dialog', 'data-pk': key, onclick: function () {
            openPicker({
              title: f.label, items: all, multi: true, selected: sel.filter(function (x) { return all.indexOf(x) >= 0; }),
              onDone: function (picked) {
                var same = picked.length === sel.length - extra.length && picked.every(function (x) { return sel.indexOf(x) >= 0; });
                if (same) return;
                obj[f.key] = picked.concat(extra); rerender();
              },
              onClose: function () { focusPk(key); },
            });
          } }, 'list', f.pickerLabel || 'More…'));
        }
        var otherOpen = !!obj['__other_' + f.key] || extra.length > 0;
        if (!otherOpen) {
          cmore.appendChild(moreBtn({ className: 'chip-btn other', 'aria-expanded': 'false', onclick: function () {
            obj['__other_' + f.key] = true; rerender();
            var t = view.querySelector('[data-pk-other="' + key + '"]');
            if (t) t.focus({ preventScroll: true });
          } }, 'plus', 'Other…'));
        }
        if (upFront.length) wrap.appendChild(cbox);
        if (cmore.firstChild) wrap.appendChild(cmore);
        if (otherOpen) {
          var add = el('input', { type: 'text', className: 'other', placeholder: 'Something else', 'aria-label': f.label + ' (add another)', 'data-pk-other': key,
            onkeydown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addOther(); } }, onblur: function () { addOther(true); } });
          // 1.24.0: an Add button beside the box ("press Enter" is not plain on a phone keyboard; leaving the box still adds it, as before)
          wrap.appendChild(el('div', { className: 'other-row' }, [add, el('button', { className: 'btn btn-secondary', type: 'button', text: 'Add', 'aria-label': f.label + ': add', onclick: function () { addOther(); } })]));
        }
        function addOther(fromBlur) {
          var t = add.value.trim();
          if (!t) return;
          obj[f.key] = (obj[f.key] || []).concat([t]); add.value = ''; // kept now, even if the box is being removed
          if (fromBlur) afterTap(rerender); else rerender();
        }
        break;
      }
      case 'temps': {
        var vals = Array.isArray(v) ? v : ['', '', '', '', ''];
        obj[f.key] = vals;
        // Readings the check flagged, by position ("... reading 3 is 4 °C ...").
        var flagged = {};
        (warns[key] || []).forEach(function (m) { var r = /reading (\d+)/.exec(m); if (r) flagged[Number(r[1]) - 1] = true; });
        var row = el('div', { className: 'temps' });
        for (var i = 0; i < 5; i++) {
          (function (i) {
            var t = el('input', { type: 'text', inputmode: 'decimal', value: vals[i] || '', 'aria-label': f.label + ' ' + (i + 1), autocomplete: 'off',
              oninput: function () {
                vals[i] = t.value; changed();
                if (/^\d{2}$/.test(t.value)) {
                  var all = Array.prototype.slice.call(view.querySelectorAll('.temps input'));
                  var next = all[all.indexOf(t) + 1];
                  if (next) next.focus();
                }
              } });
            row.appendChild(el('label', { className: flagged[i] ? 'is-warn' : '' }, [el('span', { className: 'n', text: String(i + 1) }), t]));
          })(i);
        }
        wrap.appendChild(row);
        break;
      }
      case 'buckets': {
        saidHere = bucketsEl(f, obj, key, id, wrap, errs, warns, changed); // true: its message is under its own box
        break;
      }
      case 'ferment': {
        idField(f, obj, key, id, wrap, changed, rerender);
        break;
      }
      case 'ref': {
        idField(f, obj, key, id, wrap, changed, rerender);
        break;
      }
      case 'repeat': {
        var items = Array.isArray(v) ? v : [];
        obj[f.key] = items;
        // Which one is being worked on is only on this screen: not in the draft, not sent. Fresh screen (or a reload): the last one.
        if (openItem.owner !== obj || openItem.key !== key || items.indexOf(openItem.item) < 0) { openItem.owner = obj; openItem.key = key; openItem.item = items[items.length - 1]; }
        items.forEach(function (it, i) {
          var title = el('span', { className: 't' });
          var setTitle = function () {
            var bits = [f.itemLabel + ' ' + (i + 1)];
            if (it.package) bits.push(it.package);
            if (it.ferment) bits.push(it.ferment); // P2-A: a roast's "Beans from" line
            if (String(it.lbs || '').trim()) bits.push((String(it.count || '').trim() ? String(it.count).trim() + ' × ' : '') + String(it.lbs).trim() + ' lbs' + (it['for'] === 'Local use' ? ' · local use' : '')); // P2-C: Pack's "3 × 30 lbs"; Remove/Edit unchanged
            if (it.farm) bits.push(it.farm);
            title.textContent = bits.join(' · ');
          };
          setTitle();
          // A finished delivery that is not the one being worked on, and has no mistake or warning marked, shows as one line.
          var prefix = key + '.' + i + '.';
          var marked = Object.keys(errs).concat(Object.keys(warns || {})).some(function (k) { return k.indexOf(prefix) === 0; });
          var finished = CH.validate({ fields: f.fields }, cleanData(f.fields, it)).errors.length === 0 && !bucketsPending(f.fields, it, '').length; // a bucket typed but not added keeps it open
          if (items.length > 1 && finished && !marked && it !== openItem.item) {
            // 1.25.1: Remove sits beside Edit, so a package (or delivery) added by mistake goes in one tap without opening it.
            // Nothing is saved until the form is, so it is safe; the list renumbers and the total follows.
            wrap.appendChild(el('div', { className: 'group collapsed' }, [el('div', { className: 'group-head' }, [
              title,
              el('div', { className: 'group-acts' }, [
                items.length > (f.min || 0) ? el('button', { className: 'btn btn-ghost', type: 'button', text: 'Remove', 'aria-label': 'Remove ' + f.itemLabel.toLowerCase() + ' ' + (i + 1), onclick: function () {
                  var label = title.textContent; items.splice(i, 1); changed(); rerender(); toast('Removed: ' + label);
                } }) : null,
                el('button', { className: 'btn btn-secondary', type: 'button', text: 'Edit', 'aria-label': 'Edit ' + f.itemLabel.toLowerCase() + ' ' + (i + 1), onclick: function () { openItem.item = it; rerender(); } }),
              ]),
            ])]));
            return;
          }
          var g = el('div', { className: 'group' }, [el('div', { className: 'group-head' }, [
            title,
            items.length > (f.min || 0) ? el('button', { className: 'btn btn-ghost', type: 'button', text: 'Remove', onclick: function () { items.splice(i, 1); rerender(); } }) : null,
          ])]);
          var subChanged = function () { setTitle(); changed(); };
          f.fields.forEach(function (sub) { if (CH.visible(sub, it)) g.appendChild(fieldEl(sub, it, key + '.' + i + '.' + sub.key, errs, subChanged, rerender, warns)); });
          wrap.appendChild(g);
        });
        wrap.appendChild(el('button', { className: 'btn btn-secondary btn-block', type: 'button', text: f.addText || 'Add another ' + f.itemLabel.toLowerCase(), onclick: function () {
          var it = {}; applyDefaults(f.fields, it, !!(curDraft && curDraft.__paper)); items.push(it); openItem.item = it; rerender();
        } }));
        if (f.bulk) {
          // "Same weight × how many": fills several rows at once (e.g. eight 11 lb packages)
          var bw = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Weight', autocomplete: 'off', 'aria-label': f.bulk.text + ': weight' });
          var bn = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'Count', autocomplete: 'off', 'aria-label': f.bulk.text + ': how many' });
          wrap.appendChild(el('div', { className: 'bulk' }, [
            el('p', { className: 'help', text: f.bulk.text }),
            el('div', { className: 'bulk-row' }, [bw, el('span', { className: 'unit', text: 'lbs ×' }), bn, el('button', { className: 'btn btn-secondary', type: 'button', text: 'Add', onclick: function () {
              var w = bw.value.trim().replace(',', '.'), n = Math.min(60, parseInt(bn.value, 10) || 0);
              if (!w || isNaN(Number(w)) || !n) return;
              while (items.length && !String(items[items.length - 1][f.bulk.key] || '').trim()) items.pop(); // empty rows left at the end make way
              var made;
              for (var k = 0; k < n; k++) { made = {}; applyDefaults(f.fields, made, !!(curDraft && curDraft.__paper)); made[f.bulk.key] = w; items.push(made); }
              openItem.item = made; rerender();
            } })]),
          ]));
        }
        break;
      }
    }
    if (errs[key] && !saidHere) wrap.appendChild(fieldMsg('bad', errs[key], msgId));
    else if (warns[key] && !errs[key] && f.type !== 'repeat') {
      var given = obj[f.key], blank = given === undefined || given === null || given === '' || (Array.isArray(given) && !given.some(function (x) { return x !== '' && x !== null; }));
      // P1-C: a note about a question left empty (the meter reading once the outside is dry) is no "looks unusual"
      wrap.appendChild(fieldMsg('warn', blank ? 'See the note at the top.' : f.type === 'temps' ? 'A reading looks unusual. Check it.' : 'This looks unusual. Check it.', msgId));
    }
    return wrap;
  }

  /*
   * P1-A: weigh bucket by bucket (field type 'buckets'). Type one bucket's weight, tap Add (or Enter), and again; the count,
   * the total and the list show as it grows, and the answers it fills (sumInto: Wet beans, countInto: Buckets) follow.
   * The box and Add sit above the list, so they never move. It never redraws the form (that would close the phone's
   * keyboard): only its own boxes and the two answers it fills change, and every Add, fix and remove is kept on the phone
   * at once (rule 1: no waiting for the draft timer). A tile opens to fix or remove that bucket; a removal can be undone.
   * Review fix: what is typed in the box but not added yet (obj.__bk_pending), and a bucket being fixed (obj.__bk_edit
   * {i, value}), are kept with the draft (never sent: cleanData reads only the answers), come back when the form is drawn
   * again, and stop Save (bucketsPending) until Add or Save is tapped or the box is cleared. Nothing is added for you.
   * Answers true when it showed the form's message for this question itself (under the box, or under the bucket being fixed).
   */
  function bucketsEl(f, obj, key, id, wrap, errs, warns, changed) {
    var bl = Array.isArray(obj[f.key]) ? obj[f.key] : [];
    obj[f.key] = bl;
    var unit = f.unit || 'lbs';
    var flagged = {}; // buckets the check marked ("Bucket 3 is 95 lbs ...")
    [].concat(errs[key] || [], warns[key] || []).forEach(function (m) { var r = /^Bucket (\d+)/.exec(m); if (r) flagged[Number(r[1]) - 1] = true; });
    var ed = obj.__bk_edit;
    if (ed && !(typeof ed === 'object' && ed.i >= 0 && ed.i < bl.length)) { delete obj.__bk_edit; ed = null; } // about a bucket no longer on the list
    var editing = ed ? ed.i : -1, lastAdd = 0, lastSave = { at: 0, i: -1 }, undo = null, fade = null;
    var bIn = el('input', { id: id, type: 'text', inputmode: 'decimal', enterkeyhint: 'enter', placeholder: 'Bucket ' + unit, 'aria-label': 'Bucket weight', autocomplete: 'off', className: 'bk-in',
      value: typeof obj.__bk_pending === 'string' ? obj.__bk_pending : '',
      onkeydown: function (ev) { if (ev.key === 'Enter' || ev.keyCode === 13) { ev.preventDefault(); addOne(); } }, // never the form's Save
      oninput: function () {
        if (bIn.value.trim()) obj.__bk_pending = bIn.value; else delete obj.__bk_pending; // typed, not added yet: Save asks for Add
        if (!bMsg.hidden) say(bMsg, bIn, '');
        changed();
      } });
    var bAdd = el('button', { className: 'btn btn-primary bk-add', type: 'button', text: 'Add',
      onmousedown: function (ev) { ev.preventDefault(); }, // the tap leaves the cursor in the box, so the keyboard stays open
      onclick: function () { addOne(); } });
    var bMsg = el('p', { className: 'field-msg bad', id: id + '-bk', hidden: true }, [svgEl('circle-alert', 16), el('span')]);
    var bTotal = el('p', { className: 'bk-total', 'aria-live': 'polite' });
    var bList = el('div', { className: 'bk-list' });
    var bUndo = el('p', { className: 'bk-undo', 'aria-live': 'polite', hidden: true });
    wrap.appendChild(el('div', { className: 'bk-row' }, [bIn, bAdd]));
    wrap.appendChild(bMsg);
    wrap.appendChild(bTotal);
    wrap.appendChild(bList);
    wrap.appendChild(bUndo);

    function say(msg, inp, text) {
      msg.lastChild.textContent = text; msg.hidden = !text;
      if (text) { inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', msg.id); } else { inp.removeAttribute('aria-invalid'); inp.removeAttribute('aria-describedby'); }
    }
    function paintTotal() {
      var n = bl.length;
      bTotal.textContent = n ? n + (n === 1 ? ' bucket' : ' buckets') + ' · ' + CH.bucketSum(bl) + ' ' + unit : '';
      bTotal.hidden = !n;
      bList.hidden = !n;
    }
    function tile(i) {
      if (i === editing) {
        var shown = obj.__bk_edit && obj.__bk_edit.i === i && typeof obj.__bk_edit.value === 'string' ? obj.__bk_edit.value : bl[i];
        obj.__bk_edit = { i: i, value: shown };
        var ein = el('input', { type: 'text', inputmode: 'decimal', enterkeyhint: 'done', value: shown, 'aria-label': 'Bucket ' + (i + 1) + ' weight', autocomplete: 'off', className: 'bk-ein',
          onkeydown: function (ev) {
            if (ev.key === 'Enter' || ev.keyCode === 13) { ev.preventDefault(); saveEdit(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); editing = -1; delete obj.__bk_edit; paintList(); changed(); bIn.focus(); }
          },
          oninput: function () { obj.__bk_edit = { i: i, value: ein.value }; if (!emsg.hidden) say(emsg, ein, ''); changed(); } }); // a fix not saved yet: Save asks for it
        var emsg = el('p', { className: 'field-msg bad', id: id + '-bk-e', hidden: true }, [svgEl('circle-alert', 16), el('span')]);
        var saveEdit = function () {
          if (editing !== i) return; // a second tap on Save: already done
          var r = bucketWeight(f, ein.value);
          if (!r.w) { say(emsg, ein, r.msg); ein.focus(); return; }
          bl[i] = r.w; editing = -1; delete obj.__bk_edit; lastSave = { at: Date.now(), i: i }; clearUndo();
          paintList(); kept(); bIn.focus();
        };
        return el('div', { className: 'bk-edit' }, [
          el('span', { className: 'bk-n', text: String(i + 1) }), ein,
          el('button', { className: 'btn btn-primary', type: 'button', text: 'Save', onmousedown: function (ev) { ev.preventDefault(); }, onclick: saveEdit }),
          el('button', { className: 'btn btn-secondary', type: 'button', text: 'Remove', onclick: function () { if (editing === i) removeOne(i); } }),
          emsg,
        ]);
      }
      var over = f.warnMax !== undefined && Number(bl[i]) > f.warnMax;
      return el('button', { type: 'button', className: 'bk-tile' + (flagged[i] || over ? ' is-warn' : ''), 'aria-label': 'Bucket ' + (i + 1) + ': ' + bl[i] + ' ' + unit + '. Tap to fix or remove.',
        onclick: function () {
          if (lastSave.i === i && Date.now() - lastSave.at < 500) return; // the second tap of a double tap on Save lands on this tile
          if (fixWaiting()) return; // another bucket's fix is not saved yet: it is not thrown away
          editing = i; delete obj.__bk_edit; paintList();
          var e = bList.querySelector('.bk-ein');
          if (e) { e.focus(); e.select(); }
        } }, [el('span', { className: 'bk-n', text: (i + 1) + ' · ' }), el('span', { text: bl[i] })]);
    }
    function paintList() {
      if (fade) { clearTimeout(fade); fade = null; }
      bList.textContent = '';
      bl.forEach(function (x, i) { bList.appendChild(tile(i)); });
      paintTotal();
    }
    function clearUndo() { undo = null; bUndo.hidden = true; bUndo.textContent = ''; }
    /** A bucket being fixed with a changed weight: say so under it and put the cursor there (true), so nothing drops it. */
    function fixWaiting() {
      var p = bucketPendingOf(f, obj);
      if (!p || p.kind !== 'fix') return false;
      var e = bList.querySelector('.bk-ein'), m = bList.querySelector('.bk-edit .field-msg');
      if (e && m) { say(m, e, p.msg); e.focus(); }
      return true;
    }
    /** The list changed: Wet beans and Buckets follow it (empty again with no buckets), and the draft is kept at once. */
    function kept() {
      var on = bl.length > 0;
      if (f.sumInto) { obj[f.sumInto] = on ? String(CH.bucketSum(bl)) : ''; sibling(f.sumInto, obj[f.sumInto], on); }
      if (f.countInto) { obj[f.countInto] = on ? String(bl.length) : ''; sibling(f.countInto, obj[f.countInto], on); }
      paintTotal();
      changed();
      saveDrafts();
    }
    function sibling(k, val, on) { // the answer box beside this one ("deliveries.0.lbs"), changed in place
      var q = view.querySelector('.q[data-key="' + key.replace(/[^.]+$/, k).replace(/"/g, '') + '"]');
      if (!q) return;
      var inp = q.querySelector('input');
      if (inp) { inp.value = val; inp.readOnly = on; }
      var note = q.querySelector('.sum-note');
      if (note) note.hidden = !on;
    }
    function addOne() {
      var raw = bIn.value.trim();
      if (!raw && Date.now() - lastAdd < 800) { bIn.focus(); return; } // the second tap of a double tap on Add finds the box empty
      var r = bucketWeight(f, raw);
      if (!r.w) { say(bMsg, bIn, r.msg); bIn.focus(); return; }
      if (f.maxItems && bl.length >= f.maxItems) { say(bMsg, bIn, 'At most ' + f.maxItems + ' buckets. Type the total below instead.'); bIn.focus(); return; }
      if (fixWaiting()) return; // a bucket being fixed with a changed weight: Save or change it back first (the typed one stays in the box)
      bl.push(r.w); lastAdd = Date.now(); bIn.value = ''; delete obj.__bk_pending; say(bMsg, bIn, ''); clearUndo();
      if (editing >= 0) { editing = -1; delete obj.__bk_edit; paintList(); } else bList.appendChild(tile(bl.length - 1));
      var t = bList.lastChild, was = bList.querySelector('.bk-new');
      if (was) was.classList.remove('bk-new'); // only the newest is marked
      if (t) {
        t.classList.add('bk-new');
        if (fade) clearTimeout(fade);
        fade = setTimeout(function () { fade = null; t.classList.remove('bk-new'); }, 1200);
      }
      kept();
      bIn.focus();
    }
    function removeOne(i) {
      var w = bl.splice(i, 1)[0];
      editing = -1; delete obj.__bk_edit;
      paintList(); kept();
      undo = { i: i, w: w };
      bUndo.textContent = '';
      bUndo.appendChild(el('span', { text: 'Removed bucket ' + (i + 1) + ' (' + w + ' ' + unit + '). ' }));
      bUndo.appendChild(el('button', { className: 'btn btn-secondary bk-undo-btn', type: 'button', text: 'Undo', onclick: function () {
        if (!undo) return;
        bl.splice(Math.min(undo.i, bl.length), 0, undo.w);
        clearUndo(); paintList(); kept(); bIn.focus();
      } }));
      bUndo.hidden = false;
      var u = bUndo.querySelector('button');
      if (u) u.focus();
    }
    paintList();
    // Save stopped on a bucket typed but not added (or a fix not saved): the words go under that box, not below the list
    var p = errs[key] ? bucketPendingOf(f, obj) : null;
    if (p && p.msg === errs[key]) {
      var fe = bList.querySelector('.bk-ein'), fm = bList.querySelector('.bk-edit .field-msg');
      if (p.kind === 'fix' && fe && fm) say(fm, fe, p.msg); else say(bMsg, bIn, p.msg);
      return true;
    }
    return false;
  }
  /** P1-A: one typed bucket weight as kept ("23.50" → "23.5"): { w }, or { msg } saying why it cannot be one bucket. */
  function bucketWeight(f, raw) {
    var x = String(raw === null || raw === undefined ? '' : raw).trim().replace(',', '.'), n = Number(x);
    if (CH.BUCKET_DECIMALS && CH.BUCKET_DECIMALS.test(x)) return { msg: 'Use at most 2 decimals, like 23.45.' };
    if (!CH.BUCKET_NUM.test(x) || isNaN(n) || n < f.min || n > f.max) return { msg: 'Type a weight between ' + f.min + ' and ' + f.max + ' ' + (f.unit || 'lbs') + '.' };
    return { w: String(n) };
  }
  /**
   * Review fix: a bucket of this question typed but not added ({kind: 'add'}), or being fixed with a changed weight
   * ({kind: 'fix'}), with the words that say so; null when there is none. Read from the draft (obj.__bk_pending, __bk_edit).
   */
  function bucketPendingOf(f, obj) {
    var unit = f.unit || 'lbs', bl = CH.bucketList({ bucket_weights: obj && obj[f.key] });
    var ed = obj && obj.__bk_edit;
    if (ed && typeof ed === 'object' && ed.i >= 0 && ed.i < bl.length && typeof ed.value === 'string') {
      var now = ed.value.trim(), w = bucketWeight(f, now).w;
      if (now.replace(',', '.') !== bl[ed.i] && w !== bl[ed.i]) {
        return { kind: 'fix', msg: 'Bucket ' + (ed.i + 1) + ' is changed' + (w ? ' to ' + w + ' ' + unit : '') + ' but not saved. Tap Save, or change it back to ' + bl[ed.i] + '.' };
      }
    }
    var raw = obj && typeof obj.__bk_pending === 'string' ? obj.__bk_pending.trim() : '';
    if (!raw) return null;
    var pw = bucketWeight(f, raw).w;
    return { kind: 'add', msg: 'Bucket ' + (bl.length + 1) + (pw ? ' (' + pw + ' ' + unit + ')' : '') + ' is typed but not added. Tap Add, or clear the box.' };
  }
  /** Every bucket typed but not added (or fix not saved) in a form's answers, as [{key, kind, msg}] (shown questions only). */
  function bucketsPending(fields, data, prefix) {
    var out = [];
    (fields || []).forEach(function (f) {
      if (!data || !CH.visible(f, data) || hiddenEmpty(f)) return;
      if (f.type === 'repeat') {
        (Array.isArray(data[f.key]) ? data[f.key] : []).forEach(function (it, i) { out = out.concat(bucketsPending(f.fields, it || {}, prefix + f.key + '.' + i + '.')); });
        return;
      }
      if (f.type !== 'buckets') return;
      var p = bucketPendingOf(f, data);
      if (p) out.push({ key: prefix + f.key, kind: p.kind, msg: p.msg });
    });
    return out;
  }
  /** P1-A: the 'buckets' question an answer is worked out from (Wet beans: sumOf, Buckets: countOf), if it is shown. */
  function bucketField(f, obj) {
    var src = f.sumOf || f.countOf, form = src && f.__form ? CH.formById(f.__form) : null, hit = null;
    if (!form || !f.__path) return null;
    var want = f.__path.replace(/[^.]+$/, src);
    CH.eachField(form, function (x, p) { if (p === want) hit = x; });
    return hit && hit.type === 'buckets' && CH.visible(hit, obj) ? hit : null;
  }
  /** What that answer is while buckets are on the list (their total, or how many); null with none (then it is typed). */
  function bucketsFill(f, obj) {
    var lf = bucketField(f, obj);
    var b = lf ? CH.bucketList({ bucket_weights: obj[lf.key] }) : [];
    if (!b.length || !b.every(function (x) { return CH.BUCKET_NUM.test(x); })) return null;
    return f.sumOf ? String(CH.bucketSum(b)) : String(b.length);
  }

  /*
   * P4-A: a photo question (schema type 'photo'; docs/photos.js). "Take photo" opens the camera; the photo is shrunk, kept in
   * its own database on this phone and the draft keeps only [photo_id]. The photo belongs to the draft's one entry ID (made
   * now if the draft has none yet: the same ID the entry is saved under). Nothing here sends or saves an entry; a photo that
   * cannot be read or kept only says so, and the form can still be saved.
   */
  function photoField(f, obj, id, wrap, changed) {
    var P = window.CH_PHOTOS;
    var box = el('div', { className: 'photo-q' });
    wrap.appendChild(box);
    if (!P || !window.indexedDB) { box.appendChild(el('p', { className: 'help', text: 'This phone cannot take photos in the app.' })); return; }
    var input = el('input', { type: 'file', id: id, accept: 'image/*', capture: 'environment', className: 'photo-input', tabindex: '-1' }); // the question's label points here (a tap on it opens the camera too); the buttons keep their own names
    var msg = el('p', { className: 'photo-msg', 'aria-live': 'polite' });
    function ids() { return Array.isArray(obj[f.key]) ? obj[f.key].filter(function (x) { return typeof x === 'string' && x; }) : []; }
    function say(t, bad) { msg.textContent = t || ''; msg.className = 'photo-msg' + (bad ? ' bad' : ''); }
    function buttons(on) { Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.disabled = !on; }); }
    function take() {
      // the camera app may close this page on a small phone: the draft and its entry ID are kept first
      if (!obj.__entry_id) { obj.__entry_id = uid(); changed(); }
      saveDrafts();
      input.value = ''; input.click();
    }
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var old = ids();
      buttons(false); say('Saving the photo on this phone…');
      P.shrink(file).then(function (blob) {
        if (!obj.__entry_id) obj.__entry_id = uid();
        return P.keep(obj.__entry_id, f.key, blob, { form: f.__form, n: 1 });
      }).then(function (rec) {
        obj[f.key] = [rec.photo_id];
        changed(); saveDrafts(); // kept at once, not after the usual pause
        old.forEach(function (x) { dropDraftPhoto(x, obj.__entry_id); }); // a retake: the one it replaces goes
        paint('Photo saved on this phone.');
      }).catch(function (err) {
        buttons(true);
        say(err && (err.full || /could not be read/.test(err.message || '')) ? err.message : 'This photo could not be kept on this phone (it may be full). The rest of the form is safe.', true);
      });
    });
    function paint(note) {
      var cur = ids();
      box.replaceChildren();
      if (!cur.length) {
        var btn = el('button', { type: 'button', className: 'btn btn-secondary btn-block photo-take', onclick: take }, [svgEl('image', 20), el('span', { text: 'Take photo' })]);
        box.appendChild(btn);
        if (P.used()) P.canKeep().then(function (ok) { if (!ok) { btn.disabled = true; say('Too many photos waiting to send. Connect and try again.', true); } }).catch(function () {});
      } else {
        var img = el('img', { className: 'photo-thumb', alt: f.label });
        box.appendChild(img);
        box.appendChild(el('div', { className: 'row photo-acts' }, [
          el('button', { type: 'button', className: 'btn btn-secondary', text: 'Retake', onclick: take }),
          el('button', { type: 'button', className: 'btn btn-ghost', text: 'Remove', onclick: function () {
            cur.forEach(function (x) { dropDraftPhoto(x, obj.__entry_id); });
            obj[f.key] = []; changed(); saveDrafts(); paint('Photo removed.');
          } }),
        ]));
        P.preview(cur[0]).then(function (url) { if (url) img.src = url; else { img.remove(); say('This photo is no longer on this phone. Take it again or remove it.', true); } }).catch(function () {});
      }
      box.appendChild(input); box.appendChild(msg);
      say(note || '');
    }
    paint('');
  }
  /** A draft's photo that is replaced or removed: thrown away, unless its entry is already stored on this phone (never lost). */
  function dropDraftPhoto(photoId, entryId) {
    var P = window.CH_PHOTOS;
    if (!P) return;
    (entryId && CH.DB.get ? CH.DB.get(entryId).catch(function () { return true; }) : Promise.resolve(null)).then(function (stored) { if (!stored) return P.drop(photoId); }).catch(function () {});
  }
  /**
   * Is this entry one whose photos may go now: answered by the server, and with the same link or sign-in that sent it (the
   * server takes a photo only from whoever sent its entry; another person's link opened on this phone meanwhile: the photo
   * waits for theirs). Entries sent before this was noted: as before (an admin's with their sign-in).
   */
  function photoEntryState(id) {
    var e = S.entries.filter(function (x) { return x.entry_id === id; })[0];
    if (!e || (e.status !== 'sent' && e.status !== 'review')) return 'later';
    // review R1: who, not which key: a new sign-in, or the same join link opened again, is still the same sender. After a day
    // of waiting it is tried with whoever is here now, and the server decides (a "refused" photo then stops counting later).
    if (e.sent_with && /:/.test(e.sent_with) && e.sent_with !== senderId()) return Date.now() - (Date.parse(e.sent_at || '') || 0) > 864e5 ? 'answered' : 'later';
    if (!e.sent_with && e.admin && mode() !== 'admin') return 'later';
    return 'answered';
  }
  /**
   * P4-A review R1: who sends, as the server compares it for a photo (Raw log's _sender): a person's user ID and this device's
   * ID with a link; this device's ID on a shared tablet; the admin's user ID with a sign-in. Never a key or a token.
   */
  function senderId() {
    var m = mode();
    if (m === 'shared') return S.settings.device_id ? 'd:' + S.settings.device_id : '';
    if (m === 'worker') return S.settings.uid ? 'u:' + S.settings.uid + '|d:' + (S.settings.device_id || '') : '';
    if (m === 'admin') { var a = adminCred(); return a && a.id ? 'a:' + String(a.id) : ''; }
    return '';
  }
  /**
   * Entries a send will try again, which hold the photos back. Only an entry that can never go (the server said it is too large
   * to send) does not: a passing problem ("Could not be saved just now") still holds them (review N1).
   */
  function entriesToSend() { return S.entries.some(function (e) { return e.status === 'waiting' && goesNow(e) && !/too large to send/i.test(e.server_message || ''); }); }
  function photosOn() { return !!CFG.photos && !!window.CH_PHOTOS; }
  /**
   * P4-A: waiting photos go after the entries (end of sync), one at a time, wholly apart: whatever happens here, no entry
   * changes and the promise never rejects. Wi-Fi only (Settings): only on Wi-Fi when the phone can tell; when it cannot,
   * only when Send photos is tapped (manual).
   */
  function sendPhotos(manual) {
    try {
      if (!photosOn() || !CH_PHOTOS.used() || !connected() || !navigator.onLine || paused()) return Promise.resolve(null);
      if (linked() && S.settings.revoked) return Promise.resolve(null);
      if (mode() === 'admin' && S.session) return Promise.resolve(null);
      if (!manual && S.settings.photo_wifi && !(CH_PHOTOS.canTellWifi() && CH_PHOTOS.onWifi())) return Promise.resolve(null);
      // the server said photos are switched off: nothing is tried again until a newer lists read says they are on
      if (S.photosOff && S.photosOff === String((S.lists && S.lists.asked) || '')) return Promise.resolve(null);
      var key = sendKey();
      return CH_PHOTOS.sendDue({
        key: key, app_version: APP_VERSION, state: photoEntryState, manual: !!manual,
        busy: function () { return S.syncing || sendKey() !== key || entriesToSend(); },
        post: function (body) {
          return fetchT(address(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }, 120000).then(function (r) {
            return r.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } }); // not JSON: tried again later
          });
        },
      }).then(function (r) {
        if (r && r.off) S.photosOff = String((S.lists && S.lists.asked) || '');
        if (r && (r.sent || r.refused) && route().name === 'entries') render();
        return r;
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  /** The photo lines of My entries, filled in once the photo records are read (looks only; a problem leaves them out). */
  function paintPhotoLines() {
    if (!window.CH_PHOTOS || !(photosOn() || CH_PHOTOS.used())) return; // the photos database is never made while photos are off
    CH_PHOTOS.all().then(function (rows) {
      var by = {};
      rows.forEach(function (r) { (by[r.entry_id] = by[r.entry_id] || []).push(r); });
      Array.prototype.forEach.call(view.querySelectorAll('.list-row.entry[data-entry]'), function (b) {
        var recs = by[b.getAttribute('data-entry')];
        var h = b.querySelector('.h');
        if (!recs || !h || b.querySelector('.photo-line')) return;
        h.parentNode.appendChild(el('span', { className: 'h photo-line', text: CH_PHOTOS.words(recs) }));
      });
      Array.prototype.forEach.call(view.querySelectorAll('#entries-table tr[data-entry]'), function (tr) { // 1.31.0: the laptop view's table
        var recs = by[tr.getAttribute('data-entry')], td = tr.querySelector('td.grow');
        if (!recs || !td || td.querySelector('.photo-line')) return;
        td.appendChild(el('span', { className: 'muted photo-line', text: ' · ' + CH_PHOTOS.words(recs) }));
      });
      var tools = view.querySelector('.entries-tools');
      var waiting = rows.filter(function (r) { return r.status === 'waiting'; }).length;
      if (tools && waiting && photosOn() && !document.getElementById('send-photos')) {
        tools.appendChild(el('button', { className: 'btn btn-secondary', type: 'button', id: 'send-photos', text: 'Send photos', onclick: function () {
          if (!connected() || !navigator.onLine) { toast('No connection now. Photos are safe on this phone.'); return; }
          if (entriesToSend()) { toast('Entries go first. Photos are sent after them.'); sync(true); return; }
          toast('Sending photos…');
          sendPhotos(true).then(function (r) { toast(r && r.sent ? (r.sent === 1 ? 'Photo sent.' : r.sent + ' photos sent.') : 'Photos are safe on this phone. Waiting for signal.'); render(); });
        } }));
      }
    }).catch(function () {});
  }
  /** The photo part of a saved entry's sheet: each photo's state in a worker's words. */
  function photoFacts(e, kv) {
    if (!window.CH_PHOTOS || !(photosOn() || CH_PHOTOS.used())) return;
    CH_PHOTOS.forEntry(e.entry_id).then(function (recs) {
      if (!recs.length || !kv.isConnected) return;
      var w = { waiting: 'Photo saved on this phone. Waiting for signal.', sent: 'Photo sent.', refused: 'Photo not sent. Ask ' + CFG.contact + '.' };
      recs.forEach(function (r) {
        var form = CH.formById(r.form), f = form && form.fields.filter(function (x) { return x.key === r.field; })[0];
        kv.appendChild(el('dt', { text: f ? f.label : 'Photo' }));
        kv.appendChild(el('dd', { className: 'photo-state', text: w[r.status] || w.waiting }));
      });
    }).catch(function () {});
  }
  /** Settings: "Send photos on Wi-Fi only" (off by default); a phone that cannot tell Wi-Fi: only when Send photos is tapped. */
  function photoSettings() {
    if (!photosOn()) return null;
    var tell = CH_PHOTOS.canTellWifi();
    var box = el('input', { type: 'checkbox', id: 'photo-wifi' });
    box.checked = !!S.settings.photo_wifi;
    box.addEventListener('change', function () { S.settings.photo_wifi = box.checked; save('ch.settings', S.settings); toast('Saved.'); });
    return el('div', { className: 'photo-settings' }, [
      el('label', { className: 'chip-opt photo-wifi', for: 'photo-wifi' }, [box, el('span', { text: tell ? 'Send photos on Wi-Fi only' : 'Send photos only when I tap Send photos' })]),
      el('p', { className: 'help', text: tell ? 'Photos are kept on this phone until it is on Wi-Fi. Entries are always sent at once.' : 'This phone cannot tell when it is on Wi-Fi. Tap Send photos in My entries when you want them sent. Entries are always sent at once.' }),
    ]);
  }

  /** P4-A: tidy the photos (CH_PHOTOS.tidy): an entry ID is still wanted if an entry or any draft on this device has it. */
  function tidyPhotos() {
    try {
      if (!window.CH_PHOTOS || !window.indexedDB || !CH_PHOTOS.used()) return; // nothing kept yet: the photos database is not made
      CH.DB.all().then(function (rows) {
        var keep = {};
        rows.forEach(function (e) { keep[e.entry_id] = true; });
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!/^ch\.drafts(\.|$)/.test(k || '')) continue;
          var d = load(k, {}) || {};
          Object.keys(d).forEach(function (f) { if (d[f] && d[f].__entry_id) keep[d[f].__entry_id] = true; });
        }
        Object.keys(S.drafts || {}).forEach(function (f) { var d = S.drafts[f]; if (d && d.__entry_id) keep[d.__entry_id] = true; });
        return CH_PHOTOS.tidy(function (id) { return !!keep[id]; });
      }).catch(function () { /* nothing is guessed: tried again next time */ });
    } catch (e) { /* the same */ }
  }

  var openItem = { owner: null, key: null, item: null }; // screen state for the delivery list: which one is open
  var foldState = { form: '', open: false }; // screen state: is "More details" open on the form being filled in

  /**
   * P2-E: a tick-several question with tickButtons (Ship's packages): a line that stays in view with how many are ticked,
   * and "Untick all" / "Tick all" (everything this form offers). Nothing is fetched; it only changes the answer on screen.
   */
  function naturalOrder(ids) { return ids.slice().sort(function (a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }); }
  function tickTools(f, obj, openIds, set, cleanUp) {
    var n = (obj[f.key] || []).length;
    return el('div', { className: 'tick-tools', 'data-tick': f.key }, [
      el('span', { className: 'tick-count', role: 'status', 'aria-live': 'polite', text: n + ' of ' + Math.max(openIds.length, n) + ' ticked' }),
      el('button', { className: 'btn btn-secondary', type: 'button', 'data-act': 'untick', text: 'Untick all', disabled: !n, onclick: function () { cleanUp(); set([]); } }),
      el('button', { className: 'btn btn-secondary', type: 'button', 'data-act': 'tick', text: 'Tick all', disabled: !openIds.length || n >= openIds.length, onclick: function () { cleanUp(); set(naturalOrder(openIds)); } }),
    ]);
  }

  /**
   * Any ID choice (field types 'ferment' and 'ref'): one button that shows what is picked, with its context, and opens
   * the picker sheet (design slice 8; it replaces the chips, the "Older or other…" dropdown and the type-in box).
   * The sheet lists what the form offers first (f.open: in progress, or ready for this form), then everything else
   * this phone knows, newest first; "Not in the list" lets the ID be typed (a box started on another phone).
   * multiple: tick several in the sheet (with "Select all"); what is picked shows as chips that can be taken off.
   * The answer is kept exactly as before: obj[f.key] is the ID as text (an array of IDs when multiple).
   */
  function idField(f, obj, key, id, wrap, changed, rerender) {
    var ctx = formCtx();
    var isFerment = f.type === 'ferment';
    var all = isFerment ? knownFerments() : newestFirst(known(f.of));
    var noun = (isFerment ? 'Ferment' : (CH.KINDS[f.of] || {}).noun || 'Item').toLowerCase();
    var offer = function (x) { return typeof f.open === 'function' ? !!f.open(x, ctx, obj) : isFerment ? isOpen(x) : true; }; // obj: the answers so far (e.g. Pack offers closed roasts for shells)
    var mine = S.entries.filter(notYetInLists);
    // "2.13 · 307 lbs left" from the form's own words, else where the box is ("box 2 · day 3")
    var sub = function (x) {
      var t = '';
      if (typeof f.itemText === 'function') { t = String(f.itemText(x, ctx)); t = t.indexOf(x.id + ' · ') === 0 ? t.slice(String(x.id).length + 3) : t === String(x.id) ? '' : t; }
      else if (isFerment && window.CH_MODEL && CH_MODEL.fermentState) t = CH_MODEL.fermentState(x, mine, today()).text;
      return t + (x.local ? (t ? ' · ' : '') + 'new on this phone' : '');
    };
    var item = function (x, group) { return { value: String(x.id), label: String(x.id), sub: sub(x), group: group }; };
    var open = all.filter(offer);
    var openIds = open.map(function (x) { return String(x.id); });
    var readyWord = isFerment && typeof f.open !== 'function' ? 'In progress' : 'Ready for this form';
    var set = function (val) { obj[f.key] = val; refreshDependent(obj, f.key); rerender(); };
    var cleanUp = function () { delete obj.__ferment_more; delete obj['__more_' + f.key]; }; // screen state of the older controls, left in a draft from before
    if (!CAN_DIALOG) { plainIdField(f, obj, id, wrap, changed, rerender, { all: all, open: open, openIds: openIds, noun: noun, isFerment: isFerment, sub: sub, set: set, cleanUp: cleanUp }); return; }
    if (f.multiple) {
      var sel = Array.isArray(obj[f.key]) ? obj[f.key] : [];
      obj[f.key] = sel;
      var extra = sel.filter(function (x) { return openIds.indexOf(x) < 0; });
      var find = function (x) { return all.filter(function (y) { return String(y.id) === x; })[0] || { id: x }; };
      var box = el('div', { className: 'chips' });
      sel.forEach(function (x) { // what is picked: a chip each, tap to take it off
        var cb = el('input', { type: 'checkbox', value: x, checked: true });
        cb.addEventListener('change', function () { obj[f.key] = (obj[f.key] || []).filter(function (y) { return y !== x; }); refreshDependent(obj, f.key); changed(); rerender(); });
        var it = find(x), st = sub(it);
        box.appendChild(chipOpt(cb, x + (st ? ' · ' + st : '')));
      });
      box.appendChild(el('button', { className: 'chip-btn other pk-open idpick-many', type: 'button', 'aria-haspopup': 'dialog', 'data-pk': key, text: sel.length ? 'Change…' : 'Choose ' + noun + 's…', onclick: function () {
        openPicker({
          title: f.label, multi: true, search: true, selectAll: true,
          items: open.map(function (x) { return item(x, readyWord); }).concat(extra.map(function (x) { return item(find(x), 'Picked before'); })),
          selected: sel.slice(), emptyText: 'Nothing to pick on this phone yet.',
          onDone: function (picked) {
            var same = picked.length === sel.length && picked.every(function (x) { return sel.indexOf(x) >= 0; });
            if (same) return;
            // in the order they are listed (as packed), then anything picked before that is no longer offered
            var ordered = (f.tickButtons ? naturalOrder(openIds) : openIds).filter(function (x) { return picked.indexOf(x) >= 0; }).concat(extra.filter(function (x) { return picked.indexOf(x) >= 0; })); // tickButtons (Ship): natural ID order, as the starting ticks
            cleanUp(); set(ordered);
          },
          onClose: function () { focusPk(key); },
        });
      } }));
      if (f.tickButtons && (open.length || sel.length)) wrap.appendChild(tickTools(f, obj, openIds, set, cleanUp));
      wrap.appendChild(box);
      if (!open.length && !sel.length) wrap.appendChild(el('p', { className: 'help', text: 'Nothing to pick on this device yet.' }));
      return;
    }
    var v = obj[f.key] === undefined || obj[f.key] === null ? '' : String(obj[f.key]);
    var known_ = v ? all.filter(function (x) { return String(x.id) === v; })[0] : null;
    var btn = el('button', { className: 'idpick pk-open' + (v ? ' is-set' : ''), type: 'button', id: id, 'aria-haspopup': 'dialog', 'data-pk': key, 'data-value': v,
      'aria-label': f.label + ': ' + (v ? v + (known_ && sub(known_) ? ', ' + sub(known_) : '') + '. Change' : 'choose a ' + noun), onclick: function () {
      var rest = all.filter(function (x) { return openIds.indexOf(String(x.id)) < 0; });
      openPicker({
        title: f.label, search: true, selected: v,
        items: open.map(function (x) { return item(x, readyWord); }).concat(rest.map(function (x) { return item(x, open.length ? 'Others' : ''); })),
        emptyText: isFerment ? 'No ferments on this phone yet. Start one with "New ferment", or type the ID if it was started on another phone.' : 'Nothing to pick on this phone yet. Type the ID if it was made on another phone.',
        typeIn: { label: 'Not in the list', inputLabel: isFerment ? 'Ferment ID' : f.label + ' ID', placeholder: isFerment ? 'Like 3.1' : 'Type the ' + noun + ' ID', inputmode: isFerment ? 'decimal' : undefined,
          value: v && !known_ ? v : '', hint: 'For one made on another phone that this phone has not seen yet.',
          onType: function (text) { cleanUp(); set(text); } },
        onPick: function (val) { cleanUp(); set(val); },
        onClose: function () { focusPk(key); },
      });
    } }, [
      el('span', { className: 'idpick-txt' }, v
        ? [el('span', { className: 'idpick-t id', text: v }), el('span', { className: 'idpick-h', text: known_ ? sub(known_) : 'typed in' })]
        : [el('span', { className: 'idpick-none', text: 'Choose a ' + noun })]),
      el('span', { className: 'chev', html: ICON('chevron-down', 20) }),
    ]);
    wrap.appendChild(btn);
    if (v && !known_) wrap.appendChild(el('p', { className: 'help', text: 'This device has not seen ' + noun + ' ' + v + ' yet. That is fine if it was ' + (isFerment ? 'started' : 'made') + ' on another device.' }));
  }

  /**
   * An ID question on an old phone browser without <dialog> (no picker sheet): what the form offers as chips, and a plain
   * box to type any other ID, as before design slice 8. The answer is kept exactly as the sheet keeps it: the ID as text
   * ("2.10" stays "2.10"), an array of IDs for a tick-several question.
   */
  function plainIdField(f, obj, id, wrap, changed, rerender, o) {
    var label = function (x) { var t = o.sub(x); return String(x.id) + (t ? ' · ' + t : ''); };
    var box = el('div', { className: 'chips' });
    if (f.multiple) {
      var sel = Array.isArray(obj[f.key]) ? obj[f.key] : [];
      obj[f.key] = sel;
      var extra = sel.filter(function (x) { return o.openIds.indexOf(x) < 0; });
      o.open.concat(extra.map(function (x) { return o.all.filter(function (y) { return String(y.id) === x; })[0] || { id: x }; })).forEach(function (x) {
        var xid = String(x.id);
        var cb = el('input', { type: 'checkbox', value: xid, checked: sel.indexOf(xid) >= 0 });
        cb.addEventListener('change', function () {
          var cur = (obj[f.key] || []).filter(function (y) { return y !== xid; });
          if (cb.checked) cur.push(xid);
          obj[f.key] = cur; o.cleanUp(); refreshDependent(obj, f.key); changed();
        });
        box.appendChild(chipOpt(cb, label(x)));
      });
      if (f.tickButtons && (o.open.length || sel.length)) wrap.appendChild(tickTools(f, obj, o.openIds, o.set, o.cleanUp));
      wrap.appendChild(box);
      if (o.open.length > 1) wrap.appendChild(el('button', { className: 'btn btn-secondary', type: 'button', text: 'Select all', onclick: function () {
        var cur = (obj[f.key] || []).slice();
        o.openIds.forEach(function (x) { if (cur.indexOf(x) < 0) cur.push(x); });
        o.cleanUp(); o.set(cur);
      } }));
      if (!o.open.length && !extra.length) wrap.appendChild(el('p', { className: 'help', text: 'Nothing to pick on this device yet.' }));
      return;
    }
    var v = obj[f.key] === undefined || obj[f.key] === null ? '' : String(obj[f.key]);
    o.open.forEach(function (x) {
      var xid = String(x.id);
      var inp = el('input', { type: 'radio', name: id, value: xid, checked: v === xid });
      inp.addEventListener('click', function () { o.cleanUp(); o.set(xid); });
      box.appendChild(chipOpt(inp, label(x)));
    });
    if (o.open.length) wrap.appendChild(box);
    var elsewhere = !!v && o.openIds.indexOf(v) < 0;
    var typed = el('input', { type: 'text', id: id, className: 'other', inputmode: o.isFerment ? 'decimal' : undefined, placeholder: o.isFerment ? 'Or type the ferment ID, like 3.1' : 'Or type the ' + o.noun + ' ID',
      'aria-label': o.isFerment ? 'Ferment ID' : f.label + ' ID', value: elsewhere ? v : '', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
      oninput: function () { obj[f.key] = typed.value.trim(); o.cleanUp(); changed(); },
      onchange: function () { refreshDependent(obj, f.key); afterTap(rerender); } });
    wrap.appendChild(typed);
    if (!o.all.length) wrap.appendChild(el('p', { className: 'help', text: o.isFerment ? 'No ferments on this phone yet. Start one with "New ferment", or type the ID if it was started on another phone.' : 'Nothing to pick on this phone yet. Type the ID if it was made on another phone.' }));
    if (v && !o.all.some(function (x) { return String(x.id) === v; })) wrap.appendChild(el('p', { className: 'help', text: 'This device has not seen ' + o.noun + ' ' + v + ' yet. That is fine if it was ' + (o.isFerment ? 'started' : 'made') + ' on another device.' }));
  }

  /* ---------------- my entries ---------------- */

  /**
   * An entry's status in words. "Waiting for signal" is the usual reason an entry has not gone; when the phone itself is
   * held up (not connected, link switched off, paused, an admin's sign-in needed) it says "Kept on this phone" instead,
   * so nobody waits for a signal that would not help.
   */
  function statusOf(e) {
    if (e.status === 'sent') return ['ok', 'Sent'];
    if (e.status === 'review') return ['bad', 'Needs a look']; // 1.24.2: the same words as the home notice ("needs a look from …") and the admin pages
    if (e.status !== 'waiting') return ['warn', String(e.status || '')];
    var stuck = !connected() || (linked() && S.settings.revoked) || (mode() === 'admin' && S.session) || paused() || !goesNow(e);
    if (!stuck && S.gated[e.entry_id]) return ['warn', 'Waiting for an update']; // 1.29.2: sent by itself once the update is done
    return ['warn', stuck ? 'Kept on this phone' : 'Waiting for signal'];
  }
  /** The answers of a saved entry as [label, value] pairs, in the form's own words and order (a question the form no longer has keeps its plain name). */
  function entryFacts(e) {
    var form = CH.formById(e.form), d = e.data || {}, out = [], seen = {};
    function text(v) { return Array.isArray(v) ? v.filter(function (x) { return x !== '' && x !== null && x !== undefined; }).join(', ') : v === null || v === undefined ? '' : String(v); }
    (form ? form.fields : []).forEach(function (f) {
      seen[f.key] = true;
      var v = d[f.key];
      if (f.type === 'repeat') {
        (Array.isArray(v) ? v : []).forEach(function (it, i) {
          var bits = f.fields.map(function (sf) { var t = text((it || {})[sf.key]); if (sf.type === 'date') t = CH.dayWords(t); return t ? sf.label + ': ' + t + (sf.unit ? ' ' + sf.unit : '') : ''; }).filter(Boolean);
          if (bits.length) out.push([f.itemLabel + ' ' + (i + 1), bits.join(' · ')]);
        });
        return;
      }
      if (f.type === 'photo') return; // P4-A: shown with its state below the answers (photoFacts), never as an ID
      var t = text(v);
      if (f.type === 'date') t = CH.dayWords(t); // shown as "Nov 18"; the entry itself keeps 2026-11-18 (app 1.19.3)
      if (t) out.push([f.label, ((f.optionLabels && f.optionLabels[t]) || t) + (f.unit && f.type === 'number' ? ' ' + f.unit : '')]);
    });
    var rest = {};
    Object.keys(d).forEach(function (k) { if (!seen[k]) rest[k] = d[k]; });
    return out.concat(flatten(rest).map(function (p) { return [p[0].charAt(0).toUpperCase() + p[0].slice(1), p[1]]; }));
  }
  var entrySheet = null; // the open read-only sheet, if any
  function closeEntry() { var d = entrySheet; entrySheet = null; if (d) { if (d.open) d.close(); d.remove(); } }
  /**
   * A saved entry, read-only (design slice 8). The phone never changes or removes an entry it has saved: the server may
   * already hold it (data-safety rules 1, 4 and 11). So this sheet only shows it: there is nothing to type in and no
   * button that writes. A mistake is fixed by an admin on the Entries page, where every fix is recorded.
   */
  function openEntry(e, opener) {
    closeEntry();
    var st = statusOf(e), form = CH.formById(e.form), n = 'es' + (++fieldSeq);
    var kv = el('dl', { className: 'kv' });
    entryFacts(e).forEach(function (p) { kv.appendChild(el('dt', { text: p[0] })); kv.appendChild(el('dd', { text: p[1] })); });
    photoFacts(e, kv); // P4-A
    var why = { sent: 'It has arrived.', review: 'It arrived safely, but something did not fit. ' + CFG.contact + ' will check it.' }[e.status]
      || (st[1] === 'Waiting for signal' ? 'It is safe on this phone and is sent by itself when there is a connection.'
        : st[1] === 'Waiting for an update' ? 'Waiting for an update on our side. Nothing to do: it will send by itself. It is safe on this phone.'
        : 'It is safe on this phone and is sent once this phone can send again.');
    var close = el('button', { className: 'btn btn-secondary btn-icon', type: 'button', 'aria-label': 'Close', onclick: function () { closeEntry(); } }, [ico('x', 20)]);
    var dlg = el('dialog', { className: 'panel entry-sheet', id: 'entry-sheet', 'aria-labelledby': n }, [el('div', { className: 'panel-in' }, [
      el('div', { className: 'panel-head' }, [el('h2', { id: n, text: form ? form.title : e.form }), close]),
      el('div', { className: 'panel-body' }, [
        el('div', { className: 'entry-state' }, [el('span', { className: 'badge ' + st[0], id: 'entry-status', text: st[1] }), el('span', { className: 'sub', text: why })]),
        el('p', { className: 'entry-sum', text: e.summary || '' }),
        paperLine(e.paper),
        el('p', { className: 'sub', text: 'Saved ' + when(e.created_at) + (e.recorded_by ? ' by ' + e.recorded_by : '') + (e.sent_at && e.status !== 'waiting' ? ' · sent ' + when(e.sent_at) : '') }),
        e.server_message && e.status === 'review' ? el('div', { className: 'notice bad', role: 'status' }, [svgEl('triangle-alert', 20), el('div', { className: 'notice-body' }, [el('div', { className: 'notice-title', text: 'What did not fit' }), el('span', { text: heldWords(e.server_message) })])]) : null,
        e.server_message && e.status === 'waiting' ? el('div', { className: 'notice warn', role: 'status' }, [svgEl('triangle-alert', 20), el('div', { className: 'notice-body' }, [el('div', { className: 'notice-title', text: 'Not sent yet' }), el('span', { text: e.server_message })])]) : null,
        kv,
        el('p', { className: 'entry-wrong', id: 'entry-wrong', text: 'Something wrong? Ask ' + CFG.contact + '.' }),
        // An admin fixes it where fixes are recorded: the Entries page, opened at this entry (the link carries only the entry's ID)
        mode() === 'admin' ? el('a', { className: 'btn btn-secondary', id: 'entry-fix', href: 'entries.html#entry=' + encodeURIComponent(e.entry_id), text: 'Fix on the Entries page' }) : null,
      ]),
      el('div', { className: 'panel-foot' }, [el('button', { className: 'btn btn-primary', type: 'button', text: 'Done', onclick: function () { closeEntry(); } })]),
    ])]);
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); closeEntry(); });
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) closeEntry(); }); // a tap on the dimmed page beside it
    dlg.addEventListener('close', function () { if (opener && opener.isConnected && opener.focus) opener.focus(); });
    document.body.appendChild(dlg);
    entrySheet = dlg;
    if (CAN_DIALOG) dlg.showModal(); else dlg.setAttribute('open', '');
    close.focus();
  }

  /* ---- Slice B: what is on a pallet (read only: no request, nothing stored; drawn from the lists this phone already holds) ---- */
  function palletBody(id) {
    var view = null;
    try {
      var M = window.CH_MODEL;
      if (M && typeof M.palletContentsFromLists === 'function') view = M.palletContentsFromLists(id, { shipments: known('shipment'), packages: known('package'), roasts: known('roast') });
    } catch (e) { view = null; } // a problem hides the table, never the page
    var asked = S.lists && S.lists.asked;
    return [
      CH_PAGE.palletTable(view, { href: function (pid) { return 'batch.html?p=' + encodeURIComponent(pid); }, empty: 'No packages on this pallet in the records on this phone.' }),
      el('p', { className: 'sub pallet-asof', text: asked && !isNaN(new Date(asked).getTime()) ? 'As of ' + when(asked) : 'Not updated on this phone yet. Connect to the internet to see the latest.' }),
    ];
  }
  function openPallet(id, opener) {
    if (!CAN_DIALOG) { go('#/pallet/' + encodeURIComponent(id)); return; }
    closeEntry();
    var n = 'ps' + (++fieldSeq);
    var close = el('button', { className: 'btn btn-secondary btn-icon', type: 'button', 'aria-label': 'Close', onclick: function () { closeEntry(); } }, [ico('x', 20)]);
    var dlg = el('dialog', { className: 'panel entry-sheet pallet-sheet', id: 'pallet-sheet', 'aria-labelledby': n }, [el('div', { className: 'panel-in' }, [
      el('div', { className: 'panel-head' }, [el('h2', { id: n, text: 'Pallet ' + id }), close]),
      el('div', { className: 'panel-body' }, palletBody(id)),
      el('div', { className: 'panel-foot' }, [el('button', { className: 'btn btn-primary', type: 'button', text: 'Done', onclick: function () { closeEntry(); } })]),
    ])]);
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); closeEntry(); });
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) closeEntry(); });
    dlg.addEventListener('close', function () { if (opener && opener.isConnected && opener.focus) opener.focus(); });
    document.body.appendChild(dlg);
    entrySheet = dlg;
    dlg.showModal();
    close.focus();
  }
  function renderPalletPage(id) {
    closeEntry();
    setView([
      el('div', { className: 'page-head' }, [el('h1', { text: 'Pallet ' + id })]),
      el('div', { className: 'card pallet-page' }, palletBody(id)),
      el('button', { className: 'btn btn-primary btn-block', type: 'button', id: 'pallet-back', text: 'Done', onclick: function () { go('#/'); } }),
    ], 'Pallet ' + id);
  }

  function renderEntries() {
    closeEntry();
    // 1.21.0: on a shared tablet, only the entries of the person whose turn it is; the others are counted, and all are sent
    var all = S.entries, mine = turnEntries();
    var others = shared() ? all.filter(function (e) { return e.status === 'waiting' && mine.indexOf(e) < 0; }).length : 0;
    var records = seesRecords(); // 1.26.1: From the records, under this device's own entries
    var nodes = [
      el('div', { className: 'page-head' }, [
        el('h1', { text: 'My entries' }),
        el('p', { className: 'sub', text: records ? 'What you saved on this device, and the records for each ferment.' : 'Everything saved on this device in the last year. Entries waiting to send are never removed.' }),
      ]),
      records ? el('h2', { className: 'sect-title entries-here', id: 'on-this-phone', text: deskOn() ? 'On this device' : 'On this phone' }) : null,
      el('div', { className: 'row entries-tools' }, [
        el('button', { className: 'btn btn-primary', type: 'button', text: 'Send now', onclick: function () { sync(true); } }),
        el('button', { className: 'btn btn-secondary', type: 'button', text: 'Download a copy', onclick: exportEntries }),
      ]),
    ];
    // 1.17.1: an admin's entries on a phone with someone's link wait for that admin (never sent with the worker's link)
    var held = heldForAdmin();
    if (held.length) {
      var names = held.map(function (e) { return String((e.admin && e.admin.name) || e.recorded_by || 'an admin'); }).filter(function (n, i, all) { return all.indexOf(n) === i; });
      var who = names.join(' and ');
      nodes.push(el('div', { className: 'notice info', role: 'status', id: 'held-for-admin' }, [svgEl('info', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: plural(held.length, 'entry', 'entries') + ' made by ' + who + ' wait until ' + who + (names.length === 1 ? ' signs' : ' sign') + ' in again on this phone.' }),
        el('span', { text: 'They are kept here and are not sent with this phone\'s link. Nothing is lost.' }),
      ])]));
    }
    if (gatedCount()) nodes.push(el('div', { className: 'notice info', role: 'status', id: 'waiting-update' }, [svgEl('info', 20), el('div', { className: 'notice-body' }, [
      el('div', { className: 'notice-title', text: gatedWords() }), el('span', { text: (gatedCount() === 1 ? 'It is' : 'They are') + ' safe on this phone. Nothing is lost.' }),
    ])])); // 1.29.2
    if (others) nodes.push(el('p', { className: 'sub', id: 'others-waiting', text: plural(others, 'more entry from others is', 'more entries from others are') + ' waiting on this tablet. ' + (others === 1 ? 'It is' : 'They are') + ' sent with the rest.' }));
    if (!mine.length) nodes.push(el('div', { className: 'empty' }, [svgEl('list', 32), el('div', { className: 'empty-title', text: 'No entries yet' }), el('div', { className: 'empty-hint', text: 'Entries you save will show here, with whether they have been sent.' })]));
    else if (deskOn()) nodes.push(entriesTable(mine)); // 1.31.0, the laptop view: the same entries as a table (looks only)
    else nodes.push(el('ul', { className: 'entries list' }, mine.map(function (e) {
      var st = statusOf(e);
      var form = CH.formById(e.form);
      var b = el('button', { className: 'list-row entry', type: 'button', 'data-entry': e.entry_id, 'aria-haspopup': 'dialog', onclick: function () { openEntry(e, b); } }, [
        el('span', { className: 'txt' }, [
          el('span', { className: 'entry-top' }, [el('span', { className: 't', text: (form ? form.title : e.form) }), el('span', { className: 'badge ' + st[0], text: st[1] })]),
          el('span', { className: 'h', text: (e.summary || '') + ' · ' + when(e.created_at) + ' · ' + (e.recorded_by || '') }),
          e.paper && e.paper.written_by ? el('span', { className: 'h paper-line', text: (e.paper.scanned ? 'From paper, scanned' : 'From paper') + ' · written by ' + e.paper.written_by }) : null,
        ]),
        chev(),
      ]);
      return el('li', {}, [b]);
    })));
    var opening = document.body.getAttribute('data-screen') !== 'entries'; // (paintTabs sets it: the screen shown before this one)
    if (records) { try { nodes.push(recordsSection()); } catch (e) { /* as In progress: a problem hides the section, never the page */ } }
    setView(nodes, 'My entries');
    if (records) { var after = REC.askAfterSync; REC.askAfterSync = false; if (after) refreshRecords(); else if (opening) recordsOnOpen(); }
    paintPhotoLines(); // P4-A: "1 photo waiting" / "Photo sent" under each entry with photos
  }

  /*
   * 1.31.0, the laptop view: sorting a table drawn from a list (My entries, a ferment's records). rows: the items;
   * by: {key: function (item) → value}; sort: {key, dir: 'ascending'|'descending'}. A stable sort: equal values keep
   * the list's own order (newest first for My entries). Text compares as text, "2.10" after "2.9" (numeric parts).
   */
  function sortRows(rows, by, sort) {
    var get = by[sort.key];
    if (!get) return rows.slice();
    var sign = sort.dir === 'descending' ? -1 : 1;
    return rows.map(function (r, n) { return { r: r, n: n, v: get(r) }; }).sort(function (a, b) {
      var c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' });
      return sign * c || a.n - b.n;
    }).map(function (x) { return x.r; });
  }
  /** A sortable heading: a button inside the th, aria-sort on the th (as the admin pages' tables). */
  function sortHead(text, key, sort, onSort, cls) {
    var on = sort.key === key;
    return el('th', { scope: 'col', className: cls, 'aria-sort': on ? sort.dir : 'none', 'data-sort': key }, [el('button', { type: 'button', className: 'sort', text: text, onclick: function () {
      onSort({ key: key, dir: on && sort.dir === 'ascending' ? 'descending' : on ? 'ascending' : (key === 'when' || key === 'date' ? 'descending' : 'ascending') });
    } })]);
  }
  var ENT_SORT = { key: 'when', dir: 'descending' }; // screen state only
  /** "Nov 18, 3:00 AM": the admin pages' way (entries.js) */
  function deskWhen(iso) { var d = new Date(iso); return CH_PAGE.dayText(d) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  var STATUS_RANK = { bad: 0, warn: 1, ok: 2 };
  /** My entries on the laptop view: When · Form · What · By · Status; a row (or its When button) opens the same read-only panel. */
  function entriesTable(mine) {
    var wrap = el('div', { className: 'tablebox entries-table', id: 'entries-table' });
    var by = {
      when: function (e) { return String(e.created_at || ''); },
      form: function (e) { var f = CH.formById(e.form); return f ? f.title : String(e.form || ''); },
      status: function (e) { var st = statusOf(e); return (STATUS_RANK[st[0]] === undefined ? 3 : STATUS_RANK[st[0]]) + ' ' + st[1]; },
    };
    function draw(focusKey) {
      var rows = sortRows(mine, by, ENT_SORT);
      var resort = function (s) { ENT_SORT = s; draw(s.key); };
      var table = el('table', { className: 'table', 'aria-label': 'Entries on this device' }, [
        el('thead', {}, [el('tr', {}, [sortHead('When', 'when', ENT_SORT, resort, 'c-when'), sortHead('Form', 'form', ENT_SORT, resort), el('th', { scope: 'col', text: 'What' }), el('th', { scope: 'col', text: 'By' }), sortHead('Status', 'status', ENT_SORT, resort), el('th', { className: 'act' }, [el('span', { className: 'sr-only', text: 'Open' })])])]),
        el('tbody', {}, rows.map(function (e) {
          var st = statusOf(e), form = CH.formById(e.form);
          var b = el('button', { type: 'button', className: 'row-open', 'data-entry': e.entry_id, 'aria-haspopup': 'dialog', text: deskWhen(e.created_at), onclick: function (ev) { ev.stopPropagation(); openEntry(e, b); } });
          var tr = el('tr', { className: 'click', 'data-entry': e.entry_id, onclick: function () { openEntry(e, b); } }, [
            el('td', { className: 'nw' }, [b]),
            el('td', { className: 'nw', text: form ? form.title : e.form }),
            el('td', { className: 'grow ell-last', title: e.summary || '' }, [el('span', { text: e.summary || '' }), e.paper && e.paper.written_by ? el('span', { className: 'muted paper-line', text: ' · ' + (e.paper.scanned ? 'From paper, scanned' : 'From paper') + ' · written by ' + e.paper.written_by }) : null]),
            el('td', { className: 'nw', text: e.recorded_by || '' }),
            el('td', { className: 'nw' }, [el('span', { className: 'badge' + (st[0] === 'ok' ? ' is-sent' : ' ' + st[0]), text: st[1] })]), // as the admin pages: sent is a dot and quiet words; only what needs a look is coloured
            el('td', { className: 'act', 'aria-hidden': 'true' }, [chev()]),
          ]);
          return tr;
        })),
      ]);
      wrap.replaceChildren(el('div', { className: 'table-wrap' }, [table]));
      if (focusKey) { var h = wrap.querySelector('th[data-sort="' + focusKey + '"] button'); if (h) h.focus(); paintPhotoLines(); }
    }
    draw('');
    return wrap;
  }

  function flatten(o, prefix) {
    var out = [];
    Object.keys(o || {}).forEach(function (k) {
      if (k.indexOf('__') === 0) return;
      var v = o[k], name = (prefix ? prefix + ' ' : '') + k.replace(/_/g, ' ');
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') v.forEach(function (it, i) { out = out.concat(flatten(it, name + ' ' + (i + 1))); });
      else if (Array.isArray(v)) { var j = v.filter(function (x) { return x !== ''; }).join(', '); if (j) out.push([name, j]); }
      else if (v !== '' && v !== null && v !== undefined) out.push([name, String(v)]);
    });
    return out;
  }

  /** 1.21.0: on a shared tablet, the entries of the person whose turn it is (all of them on a personal device). */
  function turnEntries() {
    var all = S.entries;
    return shared() ? all.filter(function (e) { return TURN && ((e.turn && e.turn.user === TURN.user) || (!e.turn && e.worker === TURN.user)); }) : all;
  }
  function exportEntries() {
    var stamp = today();
    // audit M3 (1.24.5): on a shared tablet a worker's turn downloads only their own entries (others' may hold prices and
    // payments); an admin's turn may download everything on the tablet, to rescue entries that are stuck.
    var list = shared() && !(TURN && TURN.kind === 'admin') ? turnEntries() : S.entries;
    list = list.map(function (e) { var o = {}; for (var k in e) if (k !== 'sent_with') o[k] = e[k]; return o; }); // P4-A (review N2): who sent it stays on this phone
    var blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), device: S.settings.device, person: person(), entries: list }, null, 1)], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'cocoahead-entries-' + S.settings.device + '-' + stamp + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    toast('Downloaded. Send this file to ' + CFG.contact + ' if entries are stuck.');
  }

  /* ---------------- 1.26.1: My entries → From the records ---------------- */
  /*
   * Every ferment with its deliveries, checks, drying and finish, from the records (read data: whoever entered them, from
   * whichever app), so a farmer can be shown the weights. Read-only: nothing here saves, sends or changes an entry or a
   * setting. The read is separate from sync: any problem leaves the queue alone (rules 1 and 11).
   *  - Money: decided by the server (read data leaves the money columns out unless the person may see money). A price is
   *    shown only when the answer said money: true and the row has the column; never on a shared tablet.
   *  - The kept copy ("ch.records") is the result of CH_MODEL.records(), not the answer, kept with keepCopy (its server and
   *    a short fingerprint of the key, never the key) and drawn only for the same key (own). A shared tablet keeps it in
   *    memory for the turn only. Disconnect, a new link, an admin's sign-out and the end of a turn forget it.
   *  - It reads when My entries opens with a copy older than 10 minutes, and once after a send that sent something (or
   *    "Send now") while My entries is on screen. Never on a timer.
   */
  var REC_NAME = 'ch.records', REC_AGE = 10 * 60 * 1000, REC_LIMIT = 30;
  var REC = { mem: null, reading: false, mine: false, pick: '', askAfterSync: false };
  /** Who may see this section: anyone with the fermentation forms (the same forms home shows them). */
  function seesRecords() {
    try { return connected() && myForms().some(function (f) { return [].concat(f.area || []).length === 1 && f.area === 'fermentation'; }); } catch (e) { return false; }
  }
  function recordsCopy() {
    if (shared()) {
      try { localStorage.removeItem(REC_NAME); } catch (e) { /* ignore */ } // never kept on a shared tablet
      return REC.mem && TURN && REC.mem.user === TURN.user && REC.mem.key === sendKey() ? REC.mem : null;
    }
    if (!connected() || !CFG.keptCopy) return null;
    var c = CFG.keptCopy(REC_NAME, storedUrl(), sendKey(), false, true); // own: only the key or sign-in that fetched it
    return c && Array.isArray(c.ferments) ? c : null;
  }
  function keepRecords(rec) {
    if (shared()) { REC.mem = Object.assign({ user: TURN && TURN.user, key: sendKey() }, rec); return; } // memory only, for this turn
    if (CFG.keepCopy) CFG.keepCopy(REC_NAME, rec, storedUrl(), sendKey());
  }
  function dropRecords() {
    REC.mem = null; REC.pick = ''; REC.mine = false; REC.askAfterSync = false;
    try { localStorage.removeItem(REC_NAME); } catch (e) { /* ignore */ }
  }
  /** An answer says this person may not see money now: a kept copy made with prices is forgotten (read again without). */
  function recordsMoneyOff() {
    var had = false;
    try { var raw = JSON.parse(localStorage.getItem(REC_NAME) || 'null'); had = !!(raw && raw.money === true); } catch (e) { had = true; } // cannot tell: forget it
    if (REC.mem && REC.mem.money === true) had = true;
    if (had) { dropRecords(); paintRecords(); }
  }
  /** This device's own entries: their IDs match a row's Source entry. */
  function myEntryIds() {
    var m = mode(), a = m === 'admin' ? adminCred() : null, me = String(person() || '').trim();
    var list = shared() ? turnEntries() : S.entries.filter(function (e) {
      if (m === 'admin') return !!e.admin && sameAdmin(e.admin, a);
      if (e.admin) return false;
      return e.worker && S.settings.uid ? e.worker === S.settings.uid : String(e.recorded_by || '').trim() === me;
    });
    return list.map(function (e) { return String(e.entry_id); });
  }
  function refreshRecords() {
    if (REC.reading || !seesRecords() || !navigator.onLine || !window.CH_MODEL || !CH_MODEL.records) return Promise.resolve();
    if (shared() && !TURN) return Promise.resolve();
    var key = sendKey(), user = shared() ? TURN.user : '';
    var asked = new Date().toISOString();
    var still = function () { return sendKey() === key && (!shared() || (TURN && TURN.user === user)); };
    REC.reading = true; paintRecords();
    return postJson({ key: key, action: 'read', what: 'data', app_version: APP_VERSION }, 60000).then(readJson).then(function (j) {
      // a new link, sign-in or turn while this was on its way: the answer is about the old one, so nothing of it is kept
      if (!still()) return;
      // switched off, or (review fix) a sign-in that ended or must change its password or add an email first: no copy left
      // to look at (nothing else changes: the queue and the settings are sync's and the sign-in page's business)
      if (j && (j.revoked || j.bad_key || j.signed_out || j.must_change || j.must_add_email)) { dropRecords(); return; }
      if (!j || !j.ok || !j.tabs || typeof j.tabs !== 'object') return; // busy, paused…: the copy stays
      var money = !shared() && j.money === true;
      var rec = CH_MODEL.records(j.tabs, { money: money, mine: myEntryIds(), names: [String(person() || '').trim().toLowerCase()], limit: REC_LIMIT });
      var out = { at: String(j.at || asked), asked: asked, money: money, ferments: rec.ferments };
      if (rec.more) out.more = rec.more;
      keepRecords(out);
    }).catch(function () { /* no connection: the copy stays, its "As of" line tells its age */ }).then(function () {
      REC.reading = false;
      if (still()) paintRecords();
    });
  }
  /** Opening My entries: read when the copy is older than 10 minutes (or there is none). */
  function recordsOnOpen() {
    if (!seesRecords()) return;
    var c = recordsCopy(), age = c && c.asked ? Date.now() - Date.parse(c.asked) : Infinity;
    if (!(age < REC_AGE)) refreshRecords();
  }
  /** Redraw only the section (a read ended, a filter changed), so the page does not jump and open folds stay open. */
  function paintRecords() {
    var sec = view.querySelector('#records');
    if (!sec) return;
    var open = sec.querySelector('details.rec-f') ? [] : null; // nothing drawn yet: the newest (or the picked one) opens
    Array.prototype.forEach.call(sec.querySelectorAll('details.rec-f[open]'), function (d) { open.push(d.getAttribute('data-ferment')); });
    drawRecords(sec, open);
  }
  function recordsSection() {
    var sec = el('section', { className: 'records', id: 'records', 'aria-labelledby': 'records-title' });
    drawRecords(sec, null);
    return sec;
  }
  function lbsText(n) { return n == null ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function recDay(d) { return d ? CH_PAGE.dayText(String(d).slice(0, 10), true) : ''; }
  var STAGE_WORDS = { planned: 'not loaded', fermenting: 'fermenting', drying: 'drying', bagged: 'bagged' };
  function drawRecords(sec, open) {
    try {
      var c = recordsCopy();
      var nodes = [el('h2', { className: 'sect-title', id: 'records-title', text: 'From the records' })];
      var at = REC.reading ? 'Updating…' : c ? 'As of ' + CH_PAGE.dayText(new Date(c.at)) + ', ' + clock(c.at) : '';
      nodes.push(el('p', { className: 'sub rec-at', id: 'records-at', role: 'status', text: at }));
      if (!c) {
        if (!REC.reading) nodes.push(el('p', { className: 'rec-empty', id: 'records-none', text: 'No connection. Open this page once with a connection to see the records here.' }));
        sec.replaceChildren.apply(sec, nodes);
        return;
      }
      var all = c.ferments || [];
      if (REC.pick && !all.some(function (f) { return f.id === REC.pick; })) REC.pick = '';
      nodes.push(recordsFilters(all));
      var list = all.filter(function (f) { return !REC.pick || f.id === REC.pick; });
      if (REC.mine) list = list.map(function (f) { return Object.assign({}, f, { rows: (f.rows || []).filter(function (r) { return r.mine; }) }); }).filter(function (f) { return f.rows.length; });
      if (!list.length) {
        nodes.push(el('p', { className: 'rec-empty', id: 'records-none', text: REC.mine ? 'Nothing under your name. Entries made with a different name show under Everyone.' : 'No ferments in the records yet.' }));
      } else {
        nodes.push(el('div', { className: 'rec-list', id: 'records-list' }, list.map(function (f, i) {
          var isOpen = open ? open.indexOf(f.id) >= 0 || (REC.pick && f.id === REC.pick) : (REC.pick ? f.id === REC.pick : i === 0);
          return fermentRecord(f, isOpen, c.money === true && !shared());
        })));
      }
      if (c.more && !REC.pick) nodes.push(el('p', { className: 'sub rec-more', id: 'records-more', text: 'Showing the newest ' + REC_LIMIT + ' ferments.' }));
      sec.replaceChildren.apply(sec, nodes);
    } catch (e) {
      sec.hidden = true; // a problem hides this section, never the page
    }
  }
  function recordsFilters(all) {
    var pickBtn = null, chips = null;
    if (CAN_DIALOG) {
      pickBtn = el('button', { className: 'btn btn-secondary rec-pick', type: 'button', id: 'records-ferment', 'aria-haspopup': 'dialog', onclick: function () {
        openPicker({ title: 'Ferment', search: true, selected: REC.pick || '', noneLabel: 'All ferments',
          items: all.map(function (f) { return { value: f.id, label: f.id, sub: [f.station, STAGE_WORDS[f.stage] || ''].filter(Boolean).join(' · ') }; }),
          onPick: function (v) { REC.pick = String(v); paintRecords(); },
          onNone: function () { REC.pick = ''; paintRecords(); },
          onClose: function () { var b = view.querySelector('#records-ferment'); if (b) b.focus(); } });
      } }, [svgEl('list', 18), el('span', { text: REC.pick ? 'Ferment ' + REC.pick : 'All ferments' })]);
    } else { // no <dialog>: the newest 6 as chips, plus All
      chips = el('div', { className: 'rec-chips', id: 'records-chips', role: 'group', 'aria-label': 'Ferment' }, [{ id: '', label: 'All' }].concat(all.slice(0, 6).map(function (f) { return { id: f.id, label: f.id }; })).map(function (o) {
        return el('button', { className: 'btn ' + (REC.pick === o.id ? 'btn-primary' : 'btn-secondary'), type: 'button', 'aria-pressed': REC.pick === o.id ? 'true' : 'false', 'data-ferment': o.id, text: o.label, onclick: function () { REC.pick = o.id; paintRecords(); } });
      }));
    }
    var seg = el('div', { className: 'seg', id: 'records-whose', role: 'group', 'aria-label': 'Whose entries' }, [['Everyone', false], ['Mine', true]].map(function (o) {
      return el('button', { type: 'button', className: 'seg-btn', 'aria-pressed': REC.mine === o[1] ? 'true' : 'false', text: o[0], onclick: function () { REC.mine = o[1]; paintRecords(); } });
    }));
    return el('div', { className: 'rec-filters' }, [pickBtn || chips, seg]);
  }
  function fermentRecord(f, isOpen, money) {
    var rows = f.rows || [];
    var head = ['Ferment ' + f.id, f.station, f.wet != null ? lbsText(f.wet) + ' lbs wet' : '', STAGE_WORDS[f.stage] || ''].filter(Boolean).join(' · ');
    var kids = [el('summary', { className: 'rec-sum' }, [el('span', { className: 'rec-head', text: head }), el('span', { className: 'chev', 'aria-hidden': 'true', html: ICON('chevron-down', 20) })])];
    var group = function (title, kind, extra) {
      var mine = rows.filter(function (r) { return r.kind === kind; });
      if (!mine.length) return;
      kids.push(el('h3', { className: 'rec-h', text: title }));
      kids.push(el('ul', { className: 'rec-rows', 'data-kind': kind }, mine.map(function (r) { return recordRow(r, money); })));
      if (extra) kids.push(extra(mine));
    };
    var totalLine = function () {
      if (!f.farms || !f.farms.length) return null;
      var total = f.farms.reduce(function (s, x) { return s + (x.lbs || 0); }, 0);
      return el('p', { className: 'rec-total', text: ['Total ' + lbsText(Math.round(total * 10) / 10) + ' lbs'].concat(f.farms.length > 1 ? f.farms.map(function (x) { return (x.farm || 'No farm') + ' ' + lbsText(x.lbs); }) : []).join(' · ') });
    };
    if (deskOn() && rows.length) { // 1.31.0, the laptop view: one table of the same rows, the same words (and money only as below)
      kids.push(recordsTable(f, rows, money));
      var tl = rows.some(function (r) { return r.kind === 'delivery'; }) ? totalLine() : null;
      if (tl) kids.push(tl);
    } else {
      group('Deliveries', 'delivery', totalLine);
      group('Checks', 'check');
      group('Drying', 'drying');
      group('Finished', 'finish');
    }
    if (rows.length === 0) kids.push(el('p', { className: 'sub rec-norows', text: 'Nothing recorded for this ferment yet.' }));
    return el('details', { className: 'rec-f', 'data-ferment': f.id, open: !!isOpen }, kids);
  }
  /** A record row's words after its date (one place, so the phone list and the laptop table say the same; money only when money is true). */
  function recordDetails(r, money) {
    var parts = [];
    if (r.kind === 'delivery') {
      parts.push(r.farm || '', r.lbs != null ? lbsText(r.lbs) + ' lbs' : '', r.buckets != null ? lbsText(r.buckets) + (r.buckets === 1 ? ' bucket' : ' buckets') : '');
      if (money) {
        if (r.price != null) parts.push(lbsText(r.price) + ' XCD/lb');
        if (r.amount != null) parts.push(lbsText(r.amount) + ' XCD');
        if (r.paid_to) parts.push('paid to ' + r.paid_to);
      }
    } else parts.push(r.text || '');
    return parts.filter(Boolean);
  }
  function bucketList(r) { return r.kind === 'delivery' && r.bucket_weights ? String(r.bucket_weights).split(',').map(function (w) { return w.trim(); }).filter(Boolean) : []; }
  var REC_STEPS = { delivery: ['Delivery', 0], check: ['Check', 1], drying: ['Drying', 2], finish: ['Finished', 3] };
  /** 1.31.0, the laptop view: one ferment's rows as a table, Date · Step · Details · By, sortable by Date and Step. */
  function recordsTable(f, rows, money) {
    var step = function (r) { return REC_STEPS[r.kind] || [String(r.kind || ''), 9]; };
    var base = rows.slice().sort(function (a, b) { return step(a)[1] - step(b)[1]; }); // the phone's order: deliveries, checks, drying, finished
    var sort = REC.sort || { key: 'date', dir: 'ascending' };
    var resort = function (s2) {
      REC.sort = s2; paintRecords();
      var h = view.querySelector('#records details.rec-f[data-ferment="' + String(f.id).replace(/"/g, '') + '"] th[data-sort="' + s2.key + '"] button');
      if (h) h.focus();
    };
    var sorted = sortRows(base, { date: function (r) { return String(r.date || ''); }, step: function (r) { return step(r)[1]; } }, sort);
    return el('div', { className: 'table-wrap rec-table' }, [el('table', { className: 'table', 'aria-label': 'Records of ferment ' + f.id }, [
      el('thead', {}, [el('tr', {}, [sortHead('Date', 'date', sort, resort), sortHead('Step', 'step', sort, resort), el('th', { scope: 'col', text: 'Details' }), el('th', { scope: 'col', text: 'By' })])]),
      el('tbody', {}, sorted.map(function (r) {
        var words = recordDetails(r, money).join(' · '), weights = bucketList(r);
        var details = weights.length ? el('details', { className: 'rec-buckets' }, [el('summary', {}, [el('span', { className: 'rec-t', text: words })]),
          el('ol', { className: 'rec-weights', 'aria-label': 'Bucket weights' }, weights.map(function (w) { return el('li', { text: w + ' lbs' }); }))]) : words;
        return el('tr', { className: 'rec-tr', 'data-kind': r.kind }, [
          el('td', { className: 'nw', text: recDay(r.date) }),
          el('td', { className: 'nw', text: step(r)[0] }),
          el('td', { className: 'grow' }, [details]),
          el('td', { className: 'nw' }, [r.mine ? el('span', { className: 'badge info plain rec-you', text: 'You' }) : null, r.by ? el('span', { className: 'muted rec-by', text: (r.mine ? ' ' : '') + r.by }) : null]),
        ]);
      })),
    ])]);
  }
  function recordRow(r, money) {
    var parts = [recDay(r.date)].concat(recordDetails(r, money));
    var line = [el('span', { className: 'rec-t', text: parts.filter(Boolean).join(' · ') })];
    if (r.mine) line.push(el('span', { className: 'badge info plain rec-you', text: 'You' }));
    if (r.by) line.push(el('span', { className: 'muted rec-by', text: 'by ' + r.by }));
    var weights = bucketList(r);
    if (!weights.length) return el('li', { className: 'rec-row', 'data-kind': r.kind }, line);
    return el('li', { className: 'rec-row', 'data-kind': r.kind }, [el('details', { className: 'rec-buckets' }, [
      el('summary', {}, line),
      el('ol', { className: 'rec-weights', 'aria-label': 'Bucket weights' }, weights.map(function (w) { return el('li', { text: w + ' lbs' }); })),
    ])]);
  }

  /* ---------------- 1.20.0: Your devices (a person's phone, tablet or laptop) ---------------- */

  // One entry ID per press of a device action, kept for a retry of the same action, so pressing again never does it twice.
  var devAct = null;
  function devActId(what, id) { var k = what + '|' + id; if (!devAct || devAct.k !== k) devAct = { k: k, id: uid() }; return devAct.id; }
  function personalDevice() { return linked() && !!S.settings.device_id && !S.settings.shared; }
  /** An action from this device (its own link). A switched-off or paused answer is handled as sync does: nothing is dropped. */
  function deviceAsk(body) {
    var key = sendKey();
    return postJson(Object.assign({ key: key, app_version: APP_VERSION }, body), 30000).then(readJson).then(function (j) {
      if (j.revoked) throw revokedError(j);
      if (j.suspended) { setPaused(j); throw pausedError(); }
      return j;
    });
  }
  function seenWords(iso) { return iso ? 'Last used ' + when(iso) : 'Not used yet'; }
  function devicesBox() {
    var list = (S.settings.devices || []).slice();
    if (!list.some(function (d) { return d.this; })) list.unshift({ id: S.settings.device_id, name: S.settings.device_name || 'This device', this: true });
    var max = S.settings.device_max || 5, working = list.filter(function (d) { return !d.off; }).length;
    var rows = list.map(function (d) {
      // design review: one line per device (name · this device or when last seen), its actions behind one ⋯ button
      var acts = el('div', { className: 'device-acts', hidden: true });
      var label = d.name || 'Device';
      var more = d.off ? null : el('button', { className: 'btn btn-ghost device-more', type: 'button', 'aria-label': 'Change ' + label, 'aria-expanded': 'false', onclick: function () {
        var open = acts.hidden;
        if (open) plain();
        acts.hidden = !open; more.setAttribute('aria-expanded', open ? 'true' : 'false');
      } }, [svgEl('ellipsis', 22)]);
      var row = el('li', { className: 'device-row' + (d.off ? ' is-off' : ''), 'data-device': d.id }, [
        el('div', { className: 'device-line' }, [
          el('span', { className: 't' }, [el('span', { className: 'nm', text: label }),
            el('span', { className: 'h', text: d.off ? 'Switched off · only ' + CFG.contact + ' can switch it back on' : d.this ? 'This device · in use now' : seenWords(d.last_seen) })]),
          more,
        ]),
        acts,
      ]);
      var plain = function () {
        acts.replaceChildren();
        if (d.this) acts.appendChild(el('button', { className: 'btn btn-secondary', type: 'button', id: 'device-rename', text: 'Rename', onclick: rename }));
        else if (!d.off) acts.appendChild(el('button', { className: 'btn btn-secondary not-mine', type: 'button', text: 'Not mine any more', onclick: stop }));
      };
      var msg = function (t) { return el('p', { className: 'err', role: 'alert', text: t }); };
      var rename = function () {
        var input = el('input', { type: 'text', id: 'device-name', maxlength: '30', autocomplete: 'off', value: d.name || '', 'aria-label': 'Name of this device' });
        var save = el('button', { className: 'btn btn-primary', type: 'button', id: 'device-name-save', text: 'Save', onclick: function () {
          var name = input.value.trim().replace(/\s+/g, ' ');
          if (!name || name.length > 30) { acts.appendChild(msg('Type a name of 1 to 30 letters.')); return; }
          save.disabled = true; save.textContent = 'Saving…';
          deviceAsk({ action: 'device_rename', entry_id: devActId('rename:' + name, d.id), device_id: d.id, name: name }).then(function (j) {
            if (!j.ok) throw new Error(j.error || 'That did not go through. Try again.');
            toast('Renamed.');
            return refreshLists().catch(function () {}).then(render);
          }).catch(function (err) { save.disabled = false; save.textContent = 'Save'; acts.appendChild(msg(String(err && err.message || err))); });
        } });
        acts.replaceChildren(el('div', { className: 'connect-row' }, [input, el('div', { className: 'row' }, [el('button', { className: 'btn btn-secondary', type: 'button', text: 'Cancel', onclick: plain }), save])]));
        input.focus();
      };
      var stop = function () {
        var yes = el('button', { className: 'btn btn-danger', type: 'button', id: 'not-mine-yes', text: 'Yes, stop it', onclick: function () {
          yes.disabled = true; yes.textContent = 'Stopping…';
          deviceAsk({ action: 'device_off', entry_id: devActId('off', d.id), device_id: d.id }).then(function (j) {
            if (!j.ok) throw new Error(j.error || 'That did not go through. Try again.');
            toast((d.name || 'That device') + ' is stopped.');
            return refreshLists().catch(function () {}).then(render);
          }).catch(function (err) { yes.disabled = false; yes.textContent = 'Try again'; acts.appendChild(msg(String(err && err.message || err) + ' (Pressing it again is safe.)')); });
        } });
        acts.replaceChildren(el('div', { className: 'confirm-inline', role: 'group', 'aria-label': 'Stop ' + (d.name || 'this device') }, [
          el('p', { className: 'confirm-title', text: 'Stop ' + (d.name || 'that device') + '?' }),
          el('p', { className: 'sub', text: 'Anything saved on it stays on it. Only ' + CFG.contact + ' can switch it back on.' }),
          el('div', { className: 'row' }, [el('button', { className: 'btn btn-secondary', type: 'button', text: 'Keep it', onclick: plain }), yes]),
        ]));
        yes.focus();
      };
      return row;
    });
    var full = working >= max;
    return el('div', { className: 'devices', id: 'my-devices' }, [
      el('ul', { className: 'device-list' }, rows),
      el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'add-device', disabled: full || !navigator.onLine, text: 'Add another device', onclick: function () { openAddDevice(this); } }),
      el('p', { className: 'sub', id: 'add-device-note', text: full ? 'You have ' + max + ' devices, the most there can be. Stop one you no longer use first.' : !navigator.onLine ? 'Adding a device needs a connection.' : 'For a tablet or a laptop of your own. It needs a connection.' }),
    ]);
  }
  /*
   * "Add another device": a QR code to scan with the other device, and a code to type on a laptop. Both work once, for
   * 15 minutes. The link lives only in this panel; closing it any way, or leaving the page, clears it.
   */
  var addSheet = null;
  function closeAddDevice() { var d = addSheet; addSheet = null; if (d) { if (d.open) d.close(); d.remove(); } }
  function openAddDevice(opener) {
    closeAddDevice();
    var link = '';
    var body = el('div', { className: 'panel-body' }, [el('p', { className: 'sub', id: 'add-device-wait', text: 'Making a code…' })]);
    var close = el('button', { className: 'btn btn-secondary btn-icon', type: 'button', 'aria-label': 'Close', onclick: function () { closeAddDevice(); } }, [ico('x', 20)]);
    var dlg = el('dialog', { className: 'panel entry-sheet add-device-sheet', id: 'add-device-sheet', 'aria-labelledby': 'add-device-title' }, [el('div', { className: 'panel-in' }, [
      el('div', { className: 'panel-head' }, [el('h2', { id: 'add-device-title', text: 'Add another device' }), close]),
      body,
      el('div', { className: 'panel-foot' }, [el('button', { className: 'btn btn-primary', type: 'button', id: 'add-device-done', text: 'Done', onclick: function () { closeAddDevice(); } })]),
    ])]);
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); closeAddDevice(); });
    dlg.addEventListener('close', function () { link = ''; if (opener && opener.isConnected && opener.focus) opener.focus(); });
    document.body.appendChild(dlg);
    addSheet = dlg;
    if (CAN_DIALOG) dlg.showModal(); else dlg.setAttribute('open', '');
    close.focus();
    deviceAsk({ action: 'device_link' }).then(function (j) {
      if (addSheet !== dlg) return; // closed meanwhile: the link is never shown
      if (!j.ok) { body.replaceChildren(el('div', { className: 'notice warn', role: 'alert', id: 'add-device-refused' }, [svgEl('triangle-alert', 20), el('div', { className: 'notice-body' }, [el('span', { text: j.error || 'That did not work. Try again.' })])])); return; }
      link = String(j.link || '');
      var qr = el('div', { className: 'qr-box', id: 'add-device-qr', role: 'img', 'aria-label': 'QR code for your other device' });
      if (typeof window.qrcode === 'function') { var q = window.qrcode(0, 'L'); q.addData(link); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } // drawn by the bundled QR library from the link only
      var copy = el('button', { className: 'btn btn-secondary', type: 'button', id: 'add-device-copy', text: 'Copy link', onclick: function () {
        if (!link) return;
        var ok = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy link'; }, 2000); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(ok, function () { toast('Could not copy. Type the code instead.'); });
        else toast('Could not copy. Type the code instead.');
      } });
      body.replaceChildren(
        el('p', { className: 'sub', text: 'On the other device, open the camera and point it at this.' }), qr,
        el('p', { className: 'add-code-line' }, ['Or type this code on the other device: ', el('b', { id: 'add-device-code', text: String(j.code || '') })]),
        el('p', { className: 'sub', id: 'add-device-once', text: 'Works once, for the next ' + (j.minutes || 15) + ' minutes.' }),
        copy);
    }).catch(function (err) {
      if (addSheet !== dlg) return;
      body.replaceChildren(el('div', { className: 'notice warn', role: 'alert', id: 'add-device-refused' }, [svgEl('wifi-off', 20), el('div', { className: 'notice-body' }, [el('span', { text: err && err.fatal ? err.message : 'No connection. Try again when you have signal.' })])]));
    });
  }
  // leaving the page, or coming back to it from the back-forward cache, never keeps the link on screen
  window.addEventListener('pagehide', closeAddDevice);
  window.addEventListener('pageshow', function (e) { if (e.persisted) closeAddDevice(); });

  /* ---------------- 2.6.0: a PIN for shared tablets ---------------- */

  /** '' if this can be a PIN, else why not (the script checks the same: Code.gs pinProblem_). */
  function pinProblem(pin) {
    if (!/^\d{4,6}$/.test(pin)) return 'A PIN is 4 to 6 numbers.';
    if (/^(\d)\1+$/.test(pin)) return 'That PIN is too easy to guess: use different numbers.';
    var up = true, down = true;
    for (var i = 1; i < pin.length; i++) { var a = +pin.charAt(i - 1), b = +pin.charAt(i); if (b !== (a + 1) % 10) up = false; if (b !== (a + 9) % 10) down = false; }
    return up || down ? 'That PIN is too easy to guess: avoid numbers in a row.' : '';
  }
  /**
   * A number pad (big keys, the digits shown as dots). opts: {id, title, note, okText, onDone(pin, pad)}. The PIN lives only
   * in this closure until OK; pad.clear() empties it, pad.say(text, bad) shows a line under the dots. Typing digits on a
   * keyboard works too.
   */
  function pinPad(opts) {
    var pin = '', max = 6, min = 4;
    var dots = el('div', { className: 'pin-dots', 'aria-hidden': 'true' });
    var live = el('p', { className: 'pin-say', id: (opts.id || 'pin') + '-say', role: 'status', 'aria-live': 'polite' });
    var count = el('span', { className: 'sr-only', id: (opts.id || 'pin') + '-count' });
    var ok = el('button', { className: 'btn btn-primary pin-ok', type: 'button', id: (opts.id || 'pin') + '-ok', text: opts.okText || 'OK', disabled: true, onclick: function () { if (pin.length >= min) opts.onDone(pin, api); } });
    var paint = function () {
      dots.replaceChildren.apply(dots, Array.apply(null, Array(Math.max(4, pin.length))).map(function (x, i) { return el('span', { className: 'pin-dot' + (i < pin.length ? ' on' : '') }); }));
      count.textContent = pin.length + ' of ' + max + ' numbers typed';
      ok.disabled = pin.length < min;
    };
    var press = function (k) {
      if (/ bad$/.test(live.className)) { live.textContent = ''; live.className = 'pin-say'; } // a new try: the last "not right" goes
      if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < max) pin += k;
      paint();
    };
    var key = function (k, label, cls, aria) { return el('button', { className: 'pin-key' + (cls ? ' ' + cls : ''), type: 'button', 'data-key': k, 'aria-label': aria || null, text: label, onclick: function () { press(k); } }); };
    var keys = el('div', { className: 'pin-keys', role: 'group', 'aria-label': 'Number pad' },
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(function (d) { return key(d, d); }).concat([key('del', '⌫', 'pin-del', 'Delete'), key('0', '0'), ok]));
    var box = el('div', { className: 'pinpad', id: opts.id || 'pin', tabindex: '-1' }, [
      opts.title ? el('h2', { className: 'pin-title', id: (opts.id || 'pin') + '-title', text: opts.title }) : null,
      opts.note ? el('p', { className: 'sub pin-note', text: opts.note }) : null,
      dots, count, live, keys,
    ]);
    box.addEventListener('keydown', function (ev) {
      if (/^\d$/.test(ev.key)) { ev.preventDefault(); press(ev.key); }
      else if (ev.key === 'Backspace') { ev.preventDefault(); press('del'); }
      else if (ev.key === 'Enter' && pin.length >= min) { ev.preventDefault(); opts.onDone(pin, api); }
    });
    var api = { node: box, clear: function () { pin = ''; paint(); }, say: function (t, bad) { live.textContent = t || ''; live.className = 'pin-say' + (bad ? ' bad' : ''); }, busy: function (on) { Array.prototype.forEach.call(keys.querySelectorAll('button'), function (b) { b.disabled = !!on || (b === ok && pin.length < min); }); } };
    paint();
    return api;
  }
  /** Settings → PIN for shared tablets (a person's own device): type it twice; the server keeps only a scrambled copy. */
  function pinBox() {
    var box = el('div', { className: 'pin-section', id: 'pin-section' });
    var has = !!S.settings.pin;
    var plainView = function () {
      box.replaceChildren(
        el('p', { className: 'sub', id: 'pin-state', text: has ? 'You have a PIN' + (S.settings.pin_set ? ' (chosen ' + CH_PAGE.dayText(new Date(S.settings.pin_set)) + ')' : '') + '.' : 'No PIN yet.' }),
        el('p', { className: 'sub', text: 'Use it on a shared tablet, like the one at the factory. Nobody else needs to know it, not even ' + CFG.contact + '.' }),
        el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'pin-choose', disabled: !navigator.onLine, text: has ? 'Change your PIN' : 'Choose a PIN', onclick: step1 }),
        navigator.onLine ? null : el('p', { className: 'sub', text: 'Choosing a PIN needs a connection.' }));
    };
    var cancel = el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'pin-cancel', text: 'Cancel', onclick: function () { plainView(); } });
    var step1 = function () {
      var pad = pinPad({ id: 'pin-new', title: 'Type a new PIN', note: '4 to 6 numbers. Not 1234, and not one number again and again.', okText: 'Next', onDone: function (first, p) {
        var bad = pinProblem(first);
        if (bad) { p.clear(); p.say(bad, true); return; }
        step2(first);
      } });
      box.replaceChildren(pad.node, cancel);
      pad.node.focus();
    };
    var step2 = function (first) {
      var pad = pinPad({ id: 'pin-again', title: 'Type it again', okText: 'Save', onDone: function (second, p) {
        if (second !== first) { first = ''; step1(); var s = box.querySelector('.pin-say'); if (s) { s.textContent = 'The two were not the same. Start again.'; s.className = 'pin-say bad'; } return; }
        p.busy(true); p.say('Saving…');
        deviceAsk({ action: 'pin_set', pin: second }).then(function (j) {
          second = ''; first = '';
          if (!j.ok) { p.busy(false); p.clear(); p.say(j.error || 'That did not work. Try again.', true); return; }
          S.settings.pin = true; S.settings.pin_set = j.pin_set || new Date().toISOString(); save('ch.settings', S.settings); has = true;
          toast('Your PIN is set.');
          plainView();
        }).catch(function (err) { p.busy(false); p.say(err && err.fatal ? err.message : 'No connection. Try again when you have signal.', true); });
      } });
      box.replaceChildren(pad.node, cancel);
      pad.node.focus();
    };
    plainView();
    return box;
  }

  /* ---------------- 1.21.0: a shared tablet: "Who's using this?", PINs and turns ---------------- */
  /*
   * A shared tablet logs as nobody until someone takes a turn: they tap their name and type their PIN. The first time on
   * this tablet that needs a connection (the server checks the PIN and gives their turn secret T); the tablet keeps T only
   * wrapped under the PIN (turns.js), so after that the PIN works with no signal. T itself is kept only in memory, for the
   * turn. Every entry saved in a turn is signed with T (turn proof), so whoever's turn it is when it is sent, and even
   * days later, the server files it under the person who made it.
   * A turn ends on Switch person, End my turn, after the tablet's idle minutes (with a 30-second "Still you?"), at its
   * day end, and when the page reloads. Ending a turn loses nothing: an open form is that person's draft (kept per
   * person, never shown to the next one), and saved entries stay queued and are sent in the background.
   * Kept in localStorage: ch.turns (per person: the wrapped T, its salt, the gens, wrong tries; never a PIN or T) and
   * ch.turn (who has the turn now, which kind, when it started and the last tap; never a secret).
   */
  var TURN = null; // {user, name, kind: 'worker'|'admin', secret, gen, dgen, areas, started, last_tap, day_end}
  var STILL_MS = 30000; // "Still you?" shows this long before the idle time is up
  function turnRecs() { return load('ch.turns', {}) || {}; }
  function saveTurnRecs(r) { save('ch.turns', r); }
  function sharedInfo() { return S.settings.shared_device || {}; }
  function roster() { return Array.isArray(S.settings.roster) ? S.settings.roster : []; }
  function rosterOf(uid) { return roster().filter(function (p) { return p.id === uid; })[0] || null; }
  function idleMs() { return (Number(sharedInfo().idle_minutes) || 10) * 60000; }
  /** lists for a shared tablet: what it is and who may use it (no secret). A change of gens makes an old wrapped copy unusable. */
  function applyShared(j) {
    var changed = false;
    if (j.device && typeof j.device === 'object') {
      var dev = { id: String(j.device.id || ''), name: String(j.device.name || ''), areas: (j.device.areas || []).map(String), people: (j.device.people || []).map(String), idle_minutes: Number(j.device.idle_minutes) || 10, day_ends: String(j.device.day_ends || '00:00'), dgen: Number(j.device.dgen) || 1 };
      if (JSON.stringify(dev) !== JSON.stringify(S.settings.shared_device || null)) { S.settings.shared_device = dev; S.settings.device_id = dev.id; S.settings.device_name = dev.name; changed = true; }
    }
    if (Array.isArray(j.roster)) {
      var r = j.roster.slice(0, 200).map(function (p) { return { id: String(p.id || ''), name: String(p.name || ''), areas: (p.areas || []).map(String), gen: Number(p.gen) || 0, pin: !!p.pin, code: !!p.code, wait_until: String(p.wait_until || ''), cleared_at: String(p.cleared_at || '') }; });
      if (JSON.stringify(r) !== JSON.stringify(S.settings.roster || null)) { S.settings.roster = r; changed = true; }
      // review fix (item 6): an admin cleared someone's wrong-PIN wait: this tablet forgets its own wrong tries from before
      var recs = turnRecs(), dropped = false;
      r.forEach(function (p) {
        var rec = recs[p.id], cl = Date.parse(p.cleared_at) || 0;
        if (!rec || !cl || !(rec.misses || rec.wait_until || rec.day_misses)) return;
        if ((Date.parse(rec.miss_at || '') || 0) <= cl) { rec.misses = 0; rec.day_misses = 0; delete rec.wait_until; delete rec.miss_at; dropped = true; }
      });
      if (dropped) saveTurnRecs(recs);
    }
    if (changed) save('ch.settings', S.settings);
    // a turn whose person left the list, or whose PIN or this tablet's PIN checks changed, ends now
    if (TURN && TURN.kind === 'worker') {
      var p = rosterOf(TURN.user);
      if (!p || p.gen !== TURN.gen || sharedInfo().dgen !== TURN.dgen) endTurn('changed');
    }
  }
  /** The shared device's link worked: from now on this device is a shared tablet. */
  function becomeShared(j, at) {
    var url = j.url && goodUrl(j.url) ? j.url : at;
    if (!goodUrl(url)) { S.join = { state: 'failed', token: '' }; render(); return null; }
    var sameRow = S.settings.device_id && j.device && S.settings.device_id === String(j.device.id); // switched on again: its turns still count
    var wasWorker = !S.settings.shared && !!S.settings.key;
    var mark = wasWorker ? CH.DB.waiting().then(function (rows) { return Promise.all(rows.filter(function (e) { return !e.turn; }).map(function (e) { e.before_shared = true; return CH.DB.put(e); })); }) : Promise.resolve();
    return mark.then(function () {
      ['person', 'locked', 'role', 'areas', 'uid', 'revoked', 'replaced', 'paused', 'devices', 'device_max', 'pin', 'pin_set'].forEach(function (k) { delete S.settings[k]; });
      S.settings.url = url; S.settings.key = String(j.key); S.settings.shared = true;
      dropRecords(); // 1.26.1: nothing of the records is ever kept on a shared tablet
      applyShared({ device: j.device });
      if (!sameRow) saveTurnRecs({});
      save('ch.settings', S.settings);
      endAdminHere(); // never an admin's sign-in left over on a tablet that is now shared
      S.join = null; TURN = null;
      try { localStorage.removeItem('ch.turn'); } catch (e) { /* ignore */ }
      S.drafts = {};
      history.replaceState(null, '', location.pathname + '#/');
      toast('This tablet is shared now.');
      return sync(false, true); // (no "Everything is sent" message over this one)
    });
  }
  /** "Make this a shared tablet?" → Yes: what waits is sent with the person's own link first, then the tablet joins. */
  function makeShared(token) {
    S.join = { state: 'connecting', token: '' }; render();
    var before = S.syncing ? Promise.resolve() : sync(true, true);
    return Promise.resolve(before).catch(function () {}).then(function () { return startJoin(token, '', true); });
  }

  /* --- who's using this? --- */
  function lastUsed(uid) { var r = turnRecs()[uid]; return r && r.last_used ? Date.parse(r.last_used) || 0 : 0; }
  function canOffline(p) { var r = turnRecs()[p.id]; return !!(r && r.wrapped && !r.lost && r.gen === p.gen && r.dgen === (sharedInfo().dgen || 1) && !stale(r)); }
  /** Review fix (M5): a turn with a signal at least every 30 days; past that the PIN needs a connection again. */
  function stale(r) { return !(Number(r.ep) > 0) || window.CH_TURNS.epochDay() - Number(r.ep) > window.CH_TURNS.OFFLINE_DAYS; }
  function waitingAll() { return S.entries.filter(function (e) { return e.status === 'waiting'; }).length; }
  function renderWho() {
    closeEntry();
    if (S.turnPick) { var p0 = rosterOf(S.turnPick); if (p0) return renderPinFor(p0); S.turnPick = null; }
    var people = roster().slice().sort(function (a, b) { return lastUsed(b.id) - lastUsed(a.id) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1); });
    var waiting = waitingAll();
    var dev = sharedInfo();
    var nodes = [
      el('div', { className: 'page-head who-head' }, [el('h1', { id: 'who-title', text: 'Who\'s using this?' }), el('p', { className: 'sub', id: 'who-device', text: dev.name || 'Shared tablet' })]),
    ];
    if (S.settings.revoked) nodes.push(el('div', { className: 'notice bad', role: 'alert', id: 'revoked-notice' }, [svgEl('triangle-alert', 20), el('div', { className: 'notice-body' }, [
      el('div', { className: 'notice-title', text: 'This tablet was switched off. Ask ' + CFG.contact + '.' }),
      el('span', { text: waiting ? plural(waiting, 'entry is', 'entries are') + ' kept on this tablet and will be sent once it is switched back on.' : 'Nothing is waiting to send.' }),
    ])]));
    nodes.push(people.length ? el('div', { className: 'who-grid', id: 'who-list' }, people.map(function (p) {
      return el('button', { className: 'who-person', type: 'button', 'data-user': p.id, onclick: function () { S.turnPick = p.id; render(); } }, [
        el('span', { className: 'avatar', 'aria-hidden': 'true', text: initials(p.name) }), el('span', { className: 'nm', text: p.name }),
      ]);
    })) : el('div', { className: 'empty', id: 'who-none' }, [svgEl('users', 28), el('div', { className: 'empty-title', text: 'Nobody can use this tablet yet' }), el('div', { className: 'empty-hint', text: 'Ask ' + CFG.contact + ' to set up PINs.' })]));
    nodes.push(el('p', { className: 'sub who-help', id: 'help-contact', text: 'Not on the list? Ask ' + CFG.contact + '.' }));
    nodes.push(el('p', { className: 'sub who-waiting', id: 'who-waiting', text: waiting ? plural(waiting, 'entry is', 'entries are') + ' waiting on this tablet. They are sent by themselves.' : 'Everything made on this tablet is sent.' }));
    nodes.push(el('div', { className: 'welcome-admin who-admin' }, [el('span', { text: 'An admin?' }), el('a', { className: 'btn btn-secondary', id: 'who-signin', href: signinUrl(''), text: 'Sign in' })]));
    nodes.push(el('div', { className: 'home-foot' }, [el('span', { text: 'Field log ' + APP_VERSION + (dev.id ? ' · ' + dev.id : '') }), el('span', { className: 'by-lockup', 'data-brand-poweredby': '', hidden: true })]));
    setView([el('section', { className: 'who-screen', 'aria-labelledby': 'who-title' }, nodes)], 'Who\'s using this?');
    if (window.CH_CONFIG && CH_CONFIG.applyBrand) CH_CONFIG.applyBrand(view);
  }
  function minutesWords(ms) { var m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? 'an hour' : plural(m, 'minute', 'minutes'); }
  /** The PIN pad for one person (or, first time with no PIN, their code and then a new PIN). */
  function renderPinFor(p) {
    var first = p.name.split(' ')[0];
    var back = el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'pin-back', text: 'Not ' + first + '? Back', onclick: function () { S.turnPick = null; render(); } });
    var rec = turnRecs()[p.id] || {};
    var offlineOk = canOffline(p);
    var head = el('div', { className: 'page-head who-head' }, [el('p', { className: 'sub', text: sharedInfo().name || '' })]);
    var wait = Math.max(Date.parse(rec.wait_until || '') || 0, Date.parse(p.wait_until || '') || 0) - Date.now(); // review fix (item 6): the longer of this tablet's and the server's
    if (wait > 0) {
      setView([head, el('div', { className: 'notice warn', role: 'alert', id: 'pin-wait' }, [svgEl('clock', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: 'Too many wrong tries, ' + first + '.' }),
        el('span', { text: 'Wait ' + minutesWords(wait) + ', or ask ' + CFG.contact + '.' })])]), back], 'PIN');
      return;
    }
    if (!offlineOk && !navigator.onLine) {
      var again = rec.wrapped && stale(rec); // used here before, but not with a connection for 30 days
      setView([head, el('div', { className: 'notice warn', role: 'alert', id: 'pin-first-offline' }, [svgEl('wifi-off', 20), el('div', { className: 'notice-body' }, [
        el('div', { className: 'notice-title', text: again ? first + ', this tablet needs a connection: it is over ' + window.CH_TURNS.OFFLINE_DAYS + ' days since your last turn with one.' : first + ', this tablet needs a connection the first time you use it.' }),
        el('span', { text: 'Use your phone, or a paper form, for now.' })])]), back], 'PIN');
      return;
    }
    if (!p.pin && p.code && !offlineOk) return renderCodeFor(p, head, back);
    var pad = pinPad({ id: 'turn-pin', title: 'Hi ' + first + '. Type your PIN.', okText: 'OK', onDone: function (pin, pd) {
      pd.busy(true); pd.say('Checking…');
      var wrong = function (left, until) {
        pd.busy(false); pd.clear();
        if (until && Date.parse(until) > Date.now()) { render(); return; }
        pd.say('That PIN is not right.' + (left > 0 ? ' ' + plural(left, 'try', 'tries') + ' before a short wait.' : ''), true);
      };
      if (offlineOk) {
        var recs = turnRecs(), r = recs[p.id];
        outerKey().then(function (outer) {
          if (!sameOuter(r, outer)) { var e = new Error('lost'); e.lost = true; throw e; } // this browser's key is gone: not the PIN's fault
          return window.CH_TURNS.unwrap(r, pin, outer && outer.key);
        }).then(function (secret) {
          r.misses = 0; delete r.wait_until; r.last_used = new Date().toISOString(); recs[p.id] = r; saveTurnRecs(recs);
          startTurn({ user: p.id, name: p.name, kind: 'worker', secret: secret, gen: r.gen, dgen: r.dgen, ep: Number(r.ep) || 0, areas: p.areas });
        }, function (err) {
          if (err && err.lost) { r.lost = true; recs[p.id] = r; saveTurnRecs(recs); pd.busy(false); render(); return; } // shown as a first time (a connection is needed)
          r.misses = (Number(r.misses) || 0) + 1; r.day_misses = (r.day === today() ? Number(r.day_misses) || 0 : 0) + 1; r.day = today(); r.miss_at = new Date().toISOString();
          var w = window.CH_TURNS.waitFor(r.misses);
          if (w) r.wait_until = new Date(Date.now() + w).toISOString();
          recs[p.id] = r; saveTurnRecs(recs);
          wrong(window.CH_TURNS.triesLeft(r.misses), r.wait_until);
        });
        return;
      }
      postJson({ key: sendKey(), action: 'turn_begin', user_id: p.id, pin: pin, app_version: APP_VERSION }, 30000).then(readJson).then(function (j) {
        if (j.revoked) throw revokedError(j);
        if (j.ok && j.turn) return keepTurn(p, pin, j);
        if (j.wrong) {
          if (j.wait_until) { var recs2 = turnRecs(), r2 = recs2[p.id] || {}; r2.wait_until = j.wait_until; r2.miss_at = new Date().toISOString(); recs2[p.id] = r2; saveTurnRecs(recs2); }
          return wrong(Number(j.tries_left) || 0, j.wait_until);
        }
        throw new Error(j.error || 'That did not work. Try again.');
      }).catch(function (err) { pd.busy(false); pd.clear(); pd.say(err && err.fatal ? err.message : err && err.message && !/fetch|network|abort/i.test(err.message) ? err.message : 'No connection. Try again.', true); })
        .then(function () { pin = ''; });
    } });
    setView([head, pad.node, back], 'PIN');
    pad.node.focus();
  }
  /** First time on a tablet with no PIN: the 8-digit code from the admin, then a new PIN twice. */
  function renderCodeFor(p, head, back) {
    var first = p.name.split(' ')[0];
    var input = el('input', { type: 'text', id: 'first-code', inputmode: 'numeric', autocomplete: 'off', maxlength: '9', placeholder: '1234 5678', 'aria-label': 'Code from ' + CFG.contact });
    var msg = el('p', { className: 'pin-say', id: 'first-code-say', role: 'status' });
    var go2 = el('button', { className: 'btn btn-primary btn-block', type: 'button', id: 'first-code-next', text: 'Next', onclick: function () {
      var code = input.value.replace(/\s+/g, '');
      if (!/^\d{8}$/.test(code)) { msg.textContent = 'The code is 8 numbers.'; msg.className = 'pin-say bad'; input.focus(); return; }
      choosePin(code);
    } });
    var choosePin = function (code) {
      var one = pinPad({ id: 'first-pin', title: 'Choose your PIN', note: '4 to 6 numbers. Not 1234, and not one number again and again.', okText: 'Next', onDone: function (a, pd) {
        var bad = window.CH_TURNS.pinProblem(a);
        if (bad) { pd.clear(); pd.say(bad, true); return; }
        var two = pinPad({ id: 'first-pin2', title: 'Type it again', okText: 'Start', onDone: function (b, pd2) {
          if (a !== b) { pd2.clear(); pd2.say('The two were not the same. Type it again.', true); return; }
          pd2.busy(true); pd2.say('Checking…');
          postJson({ key: sendKey(), action: 'turn_begin', user_id: p.id, code: code, new_pin: b, app_version: APP_VERSION }, 30000).then(readJson).then(function (j) {
            if (j.revoked) throw revokedError(j);
            if (j.ok && j.turn) return keepTurn(p, b, j);
            if (j.wrong && j.wait_until) { var recs = turnRecs(), r = recs[p.id] || {}; r.wait_until = j.wait_until; r.miss_at = new Date().toISOString(); recs[p.id] = r; saveTurnRecs(recs); render(); return; }
            throw new Error(j.wrong ? 'That code is not right, or it was already used. Ask ' + CFG.contact + ' for a new one.' : (j.error || 'That did not work. Try again.'));
          }).catch(function (err) { pd2.busy(false); pd2.clear(); pd2.say(err && err.message && !/fetch|network|abort/i.test(err.message) ? err.message : 'No connection. Try again.', true); });
        } });
        setView([head, two.node, back], 'PIN'); two.node.focus();
      } });
      setView([head, one.node, back], 'PIN'); one.node.focus();
    };
    setView([head, el('div', { className: 'first-code', id: 'first-time' }, [
      el('h2', { className: 'pin-title', text: 'First time here, ' + first + '?' }),
      el('p', { className: 'sub', text: 'Type the code from ' + CFG.contact + '. Then you choose your PIN.' }),
      input, msg, go2]), back], 'First time');
    input.focus();
  }
  /** The server checked the PIN and gave the turn secret: keep it wrapped under the PIN, then start the turn. */
  function keepTurn(p, pin, j) {
    var kid = '';
    return outerKey().then(function (outer) { kid = outer ? outer.kid : ''; return window.CH_TURNS.wrap(j.turn.secret, pin, outer && outer.key); }).then(function (w) {
      var recs = turnRecs();
      recs[p.id] = Object.assign(w, { gen: Number(j.turn.gen) || 0, dgen: Number(j.turn.dgen) || 1, ep: Number(j.turn.ep) || 0, name: p.name, misses: 0, last_used: new Date().toISOString() }, kid && w.outer ? { kid: kid } : {});
      saveTurnRecs(recs);
      // the roster's gen follows (a first-time code made a new PIN)
      var r = roster().map(function (x) { return x.id === p.id ? Object.assign({}, x, { gen: Number(j.turn.gen) || 0, pin: true, code: false }) : x; });
      S.settings.roster = r; save('ch.settings', S.settings);
      startTurn({ user: p.id, name: j.name || p.name, kind: 'worker', secret: j.turn.secret, gen: Number(j.turn.gen) || 0, dgen: Number(j.turn.dgen) || 1, ep: Number(j.turn.ep) || 0, areas: Array.isArray(j.areas) ? j.areas : p.areas });
    });
  }
  function startTurn(t) {
    var now = Date.now();
    TURN = Object.assign(t, { started: now, last_tap: now, day_end: window.CH_TURNS.nextDayEnd(sharedInfo().day_ends, new Date(now)).getTime() });
    save('ch.turn', { user: t.user, kind: t.kind, started: new Date(now).toISOString(), last_tap: new Date(now).toISOString(), idle_minutes: Number(sharedInfo().idle_minutes) || 10, day_end: new Date(TURN.day_end).toISOString() });
    S.drafts = load('ch.drafts.' + t.user, {}) || {};
    S.turnPick = null;
    history.replaceState(null, '', location.pathname + '#/');
    render(); paintTurnChip();
    toast('Hi ' + t.name.split(' ')[0] + '.');
  }
  /** Ends the turn: the open form is kept as that person's draft, an admin's sign-in is forgotten here, nothing is lost. */
  function endTurn(why) {
    if (!TURN) return;
    var t = TURN, onForm = route().name === 'form';
    clearTimeout(draftTimer); saveDrafts();
    TURN = null; S.turnPick = null; S.drafts = {};
    dropRecords(); // 1.26.1: the turn's records (memory only) go with it
    try { localStorage.removeItem('ch.turn'); } catch (e) { /* ignore */ }
    closeStill(); closeEntry(); closeAddDevice();
    if (t.kind === 'admin') endAdminHere(true);
    history.replaceState(null, '', location.pathname + '#/');
    render(); paintTurnChip();
    setTimeout(applyUpdateIfIdle, 0); // an update that waited for this turn to end
    var first = t.name.split(' ')[0];
    toast(why === 'idle' ? 'Turn ended after no taps. ' + (onForm ? 'Your form is kept for you, ' + first + '.' : '') : why === 'day' ? 'The day is over: the turn ended.' + (onForm ? ' Your form is kept for you, ' + first + '.' : '') : onForm ? 'Your form is kept for you, ' + first + '.' : 'Turn ended.');
  }
  /** An admin's sign-in is never kept on a shared tablet: logout if it can, and always forgotten here. */
  function endAdminHere(sendFirst) {
    var a = load('ch.admin', null);
    dropRecords(); // 1.26.1
    ['ch.admin', 'ch.dash', 'ch.batchdata'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }); if (window.CH_CONFIG && CH_CONFIG.dropCopies) CH_CONFIG.dropCopies(); /* 2.7.1: the admin views' kept copies too */ // at once
    if (a && a.key && a.session) {
      var at = CFG.scriptFor ? CFG.scriptFor(a.url || CFG.scriptUrl) : a.url;
      var out = function () { try { fetchT(at, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'logout', key: a.key }) }, 15000).catch(function () { /* it ends by itself at its short expiry */ }); } catch (e) { /* ignore */ } };
      // review fix (item 4, 7): the admin's entries are signed with their sign-in, so they are sent before it ends; a send
      // already running is waited for (up to 20 seconds), then one more send
      var idle = function () { var t0 = Date.now(); return new Promise(function (ok) { (function check() { if (!S.syncing || Date.now() - t0 > 20000) ok(); else setTimeout(check, 200); })(); }); };
      if (sendFirst && navigator.onLine) idle().then(function () { return S.syncing ? null : sync(false, true); }).catch(function () {}).then(out); else out();
    }
  }
  /* the turn's clock: idle minutes (with "Still you?") and the day end */
  var stillDlg = null;
  function closeStill() { var d = stillDlg; stillDlg = null; if (d) { if (d.open) d.close(); d.remove(); } }
  function tapped() {
    if (!TURN) return;
    var now = Date.now();
    if (stillDlg) return; // only "Yes, carry on" answers "Still you?"
    TURN.last_tap = now;
    if (!tapped.at || now - tapped.at > 5000) { tapped.at = now; var c = load('ch.turn', null); if (c) { c.last_tap = new Date(now).toISOString(); save('ch.turn', c); } }
  }
  function showStill() {
    var first = TURN.name.split(' ')[0];
    var count = el('span', { id: 'still-count', text: '30' });
    var yes = el('button', { className: 'btn btn-primary btn-block still-yes', type: 'button', id: 'still-yes', text: 'Yes, carry on', onclick: function () { closeStill(); tapped.at = 0; tapped(); } });
    var dlg = el('dialog', { className: 'panel still-you', id: 'still-you', 'aria-labelledby': 'still-title' }, [el('div', { className: 'panel-in' }, [el('div', { className: 'panel-body' }, [
      el('h2', { id: 'still-title', text: 'Still you, ' + first + '?' }),
      el('p', { className: 'sub' }, ['The turn ends in ', count, ' seconds. Your form is kept either way.']), yes,
      el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'still-switch', text: 'Switch person', onclick: function () { endTurn('switch'); } }),
    ])])]);
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); });
    document.body.appendChild(dlg); stillDlg = dlg;
    if (CAN_DIALOG) dlg.showModal(); else dlg.setAttribute('open', '');
    yes.focus();
  }
  function turnClock() {
    if (!TURN) return;
    var now = Date.now();
    if (now >= TURN.day_end) { endTurn('day'); return; }
    var left = TURN.last_tap + idleMs() - now;
    if (left <= 0) { endTurn('idle'); return; }
    if (left <= STILL_MS && !stillDlg) showStill();
    if (stillDlg) { var c = stillDlg.querySelector('#still-count'); if (c) c.textContent = String(Math.ceil(left / 1000)); }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (k) { document.addEventListener(k, tapped, { passive: true, capture: true }); });
  setInterval(turnClock, 1000);
  /** The top bar: the tablet's name, or "Ann · Switch" during a turn. */
  function paintTurnChip() {
    var c = document.getElementById('turn-chip');
    if (!c) return;
    c.hidden = !shared();
    if (!shared()) return;
    c.replaceChildren();
    if (TURN) { c.disabled = false; c.appendChild(el('b', { text: TURN.name.split(' ')[0] })); c.appendChild(document.createTextNode(' · Switch')); c.setAttribute('aria-label', 'Switch person (now ' + TURN.name + ')'); }
    else { c.disabled = true; c.textContent = sharedInfo().name || 'Shared tablet'; c.removeAttribute('aria-label'); }
  }
  /*
   * Slice 7: a second layer for the wrapped turn secrets: an AES key made in this browser, non-extractable (it can be used
   * but never read out), kept in IndexedDB. A copy of this tablet's storage is then useless on another computer: guessing
   * a PIN has to run here. outerKey() gives it (made once), or null where the browser cannot keep one (then only the PIN wraps).
   */
  var outerPromise = null;
  /** {key, kid} or null. kid tells a wrapped copy which key wrapped it (a copy made with another key is never "a wrong PIN"). */
  function outerKey() {
    if (outerPromise) return outerPromise;
    outerPromise = (CH.DB.getKey ? CH.DB.getKey('turn-wrap') : Promise.resolve(null)).then(function (k) {
      if (k && k.key && k.kid) return k;
      if (!CH.DB.putKey || !window.CH_TURNS.deviceKey) return null;
      return window.CH_TURNS.deviceKey().then(function (nk) { var rec = { key: nk, kid: uid().slice(0, 8) }; return CH.DB.putKey('turn-wrap', rec).then(function () { return rec; }); });
    }).catch(function () { return null; });
    return outerPromise;
  }
  /** Can this wrapped copy be opened here? (the same outer key, or none was used) */
  function sameOuter(rec, outer) { return rec.outer ? !!(outer && rec.kid === outer.kid) : true; }
  /**
   * Wrong PINs typed on this tablet today (checked here, so the server never saw them), sent when there is a connection:
   * only counts, never a PIN. Each count is sent again only when it grew.
   */
  function reportMisses() {
    var recs = turnRecs(), d = today(), counts = [];
    Object.keys(recs).forEach(function (u) { var r = recs[u]; if (r && r.day === d && (Number(r.day_misses) || 0) > (Number(r.reported) || 0)) counts.push({ user: u, n: Number(r.day_misses) || 0 }); });
    if (!counts.length) return;
    postJson({ key: sendKey(), action: 'pin_report', counts: counts, app_version: APP_VERSION }, 20000).then(readJson).then(function (j) {
      if (!j || !j.ok) return;
      var now = turnRecs();
      counts.forEach(function (c) { if (now[c.user]) now[c.user].reported = c.n; });
      saveTurnRecs(now);
    }).catch(function () { /* the next sync tries again */ });
  }
  /** At start-up on a shared tablet: a fresh admin sign-in becomes an admin turn; anything else left over is ended. */
  function sharedStart() {
    if (!shared()) return;
    var a = load('ch.admin', null);
    if (a && a.key && a.session && a.turn && a.turn.secret && a.device === S.settings.device_id) {
      var secret = String(a.turn.secret), dgen = Number(a.turn.dgen) || 1, sref = String(a.turn.sref || ''), age = Date.now() - (Date.parse(a.turn.at || '') || 0);
      delete a.turn; save('ch.admin', a); // the secret leaves storage at once: it lives in memory for this turn only
      // review fix (item 4): only straight from the sign-in page (2 minutes), and only an admin turn tied to that sign-in
      if (/^[0-9a-f]{64}$/.test(secret) && /^[0-9a-f]{16}$/.test(sref) && age >= 0 && age < 120000) { startTurn({ user: String(a.id || ''), name: String(a.by || 'Admin'), kind: 'admin', secret: secret, sref: sref, dgen: dgen, areas: sharedInfo().areas || [] }); return; }
    }
    if (a && a.key) { // an admin's sign-in without a live turn (a reload, a crash, a flat battery, or too slow): signed out here
      endAdminHere();
      // review fix (6): said in plain words, never silently
      setTimeout(function () { toast((a.by ? String(a.by).split(' ')[0] + ', your' : 'Your') + ' admin sign-in on this tablet has ended, so you are signed out here. Sign in again to carry on.'); }, 0);
    }
    var c = load('ch.turn', null);
    try { localStorage.removeItem('ch.turn'); } catch (e) { /* ignore */ }
    // a reload during a worker's turn: the same person just types their PIN to carry on (if the turn would still be on)
    if (c && c.kind === 'worker' && rosterOf(c.user) && Date.now() - Date.parse(c.last_tap) < idleMs() && Date.now() < Date.parse(c.day_end)) S.turnPick = c.user;
  }
  /* Settings during a turn on a shared tablet */
  function sharedSettings() {
    var nodes = [
      el('p', { className: 'sub', id: 'logging-as', text: 'Logging as ' + (TURN ? TURN.name : '') + ' on ' + (sharedInfo().name || 'this shared tablet') + (TURN && TURN.kind === 'admin' ? ' (signed in as an admin)' : '') }),
      el('button', { className: 'btn btn-primary btn-block', type: 'button', id: 'end-turn', text: 'End my turn', onclick: function () { endTurn('end'); } }),
    ];
    if (TURN && TURN.kind === 'admin') nodes = nodes.concat(adminTabletTools());
    return nodes;
  }
  /** An admin's turn: others' unfinished forms (read-only, never continued) and "Stop sharing this tablet" (asked twice). */
  function adminTabletTools() {
    var others = [];
    var add = function (p, d) { Object.keys(d || {}).forEach(function (k) { var x = d[k]; if (x && typeof x === 'object' && (x.__entry_id || draftHasWork(x))) others.push({ p: p, form: CH.formById(k), data: x }); }); };
    roster().forEach(function (p) { add(p, load('ch.drafts.' + p.id, {})); });
    // review fix (M8): also the forms left from before this tablet was shared, and those of people no longer on its list:
    // listed read only, kept, never deleted
    add({ id: '', name: 'From before it was shared' }, load('ch.drafts', {}));
    var known = {}; roster().forEach(function (p) { known['ch.drafts.' + p.id] = true; });
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!/^ch\.drafts\.U\d+$/.test(key || '') || known[key]) continue;
        var rec = turnRecs()[key.slice(10)];
        add({ id: key.slice(10), name: (rec && rec.name ? rec.name : key.slice(10)) + ' (not on this tablet\'s list now)' }, load(key, {}));
      }
    } catch (e) { /* no storage */ }
    var names = others.map(function (o) { return o.p.id ? o.p.name.split(' ')[0] : 'from before it was shared'; }).filter(function (n, i, all) { return all.indexOf(n) === i; });
    var box = el('div', { className: 'stop-sharing', id: 'stop-sharing' });
    var ask = function () { box.replaceChildren(el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'stop-sharing-1', text: 'Stop sharing this tablet', onclick: sure1 })); };
    var sure1 = function () {
      box.replaceChildren(el('p', { className: 'confirm-title', text: 'Stop sharing this tablet?' }), el('p', { className: 'sub', text: 'Nobody can take a turn on it any more. Everything saved on it is sent first, then it is switched off, so its link never works again.' }),
        el('div', { className: 'row' }, [el('button', { className: 'btn btn-secondary', type: 'button', text: 'Keep sharing', onclick: ask }), el('button', { className: 'btn btn-danger', type: 'button', id: 'stop-sharing-2', text: 'Yes, stop sharing', onclick: sure2 })]));
    };
    var sure2 = function () {
      box.replaceChildren(el('p', { className: 'confirm-title', text: 'Sure? Every PIN check on this tablet is forgotten.' }),
        el('div', { className: 'row' }, [el('button', { className: 'btn btn-secondary', type: 'button', text: 'Keep sharing', onclick: ask }), el('button', { className: 'btn btn-danger', type: 'button', id: 'stop-sharing-3', text: 'Yes, I am sure', onclick: function () {
          this.disabled = true;
          var btn = this;
          sync(true).then(function () {
            var left = waitingAll();
            if (left) { btn.disabled = false; box.replaceChildren(el('p', { className: 'err', role: 'alert', text: plural(left, 'entry is', 'entries are') + ' still waiting. Send them first (a connection is needed), then try again.' })); return; }
            // review fix (M7): with the admin's own sign-in, the tablet is switched off on the server too, so its link can
            // never work again; without one, say who must do it
            var a = adminCred(), devId = S.settings.device_id;
            var at = a ? (CFG.scriptFor ? CFG.scriptFor(a.url || CFG.scriptUrl) : a.url) : '';
            var off = a && devId && at ? fetchT(at, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: a.key, action: 'device_off', entry_id: uid(), by: a.by || '', device_id: devId, app_version: APP_VERSION }) }, 30000).then(readJson).then(function (j) { return !!(j && (j.status === 'saved' || j.status === 'duplicate')); }, function () { return false; }) : Promise.resolve(false);
            return off.then(function (done) {
              if (!done) { btn.disabled = false; box.replaceChildren(el('p', { className: 'err', role: 'alert', id: 'stop-sharing-nooff', text: 'This tablet could not be switched off from here. ' + (a ? 'Check the connection and try again, or ' : '') + 'someone with an admin sign-in must switch it off on the People page (Shared devices).' })); return; }
              ['url', 'key', 'shared', 'shared_device', 'roster', 'device_id', 'device_name', 'revoked', 'replaced'].forEach(function (k) { delete S.settings[k]; });
              save('ch.settings', S.settings); saveTurnRecs({});
              endTurn('end'); toast('This tablet is no longer shared, and it is switched off.'); render();
            });
          });
        } })]));
    };
    ask();
    return [
      el('h2', { className: 'sect-title', text: 'Unfinished forms by others' }),
      el('p', { className: 'sub', id: 'others-drafts', text: others.length ? others.length + ' (' + names.join(', ') + '). They are kept until each person comes back.' : 'None.' }),
      others.length ? el('ul', { className: 'device-list' }, others.map(function (o) {
        return el('li', { className: 'device-row' }, [el('span', { className: 'txt' }, [el('span', { className: 't', text: (o.form ? o.form.title : 'Form') + ' · ' + o.p.name }),
          el('span', { className: 'h', text: draftFacts(o.form, o.data) })])]);
      })) : null,
      el('h2', { className: 'sect-title', text: 'This tablet' }),
      // review fix (item 6): wrong PINs typed here with no signal make waits the server never saw: an admin can clear them
      el('button', { className: 'btn btn-secondary btn-block', type: 'button', id: 'clear-local-waits', text: 'Clear wrong-PIN waits on this tablet', onclick: function () {
        var recs = turnRecs(), n = 0;
        Object.keys(recs).forEach(function (k) { var r = recs[k]; if (r && (r.misses || r.wait_until)) { r.misses = 0; delete r.wait_until; delete r.miss_at; n++; } });
        saveTurnRecs(recs);
        toast(n ? 'Cleared on this tablet. Waits kept by the server are cleared on the People page.' : 'No waits on this tablet.');
      } }),
      box,
    ];
  }
  /** A read-only line of what is filled in on someone else's draft (never opened as a form). */
  function draftFacts(form, d) {
    if (!form) return '';
    return entryFacts({ form: form.id, data: d }).slice(0, 4).map(function (p) { return p[0] + ': ' + p[1]; }).join(' · ') || 'Nothing typed yet';
  }

  /* ---------------- settings ---------------- */

  /** Match the phone, or always light / always dark. Kept on this device (see config.js). */
  /** Settings → Help: each topic folds open in place. The words are help-content.js `field`, in worker wording. */
  function helpBox() {
    var mk = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    return el('div', { className: 'list help-list', id: 'field-help' }, CH_HELP.field.map(function (a) {
      var d = el('details', { className: 'help-item', id: 'help-' + a.id }, [el('summary', {}, [el('span', { className: 't', text: a.title }), el('span', { className: 'chev', html: ICON('chevron-down', 20) })])]);
      var box = el('div', { className: 'help-body' });
      CH_HELP.body(a, mk, { contact: CFG.contact }).forEach(function (n) { box.appendChild(n); });
      d.appendChild(box);
      return d;
    }));
  }
  function themeChoice() {
    var C = window.CH_CONFIG;
    if (!C || !C.setTheme) return null;
    var now = C.theme();
    return el('div', { className: 'row theme-choice', role: 'group', 'aria-label': 'Appearance' }, [['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
      return el('button', { type: 'button', className: 'btn ' + (now === o[0] ? 'btn-primary' : 'btn-secondary'), 'aria-pressed': now === o[0] ? 'true' : 'false', text: o[1], onclick: function () { C.setTheme(o[0]); render(); } });
    }));
  }

  /** 1.31.0: Settings → Screen layout: Automatic (laptop layout with a mouse) · Phone · Laptop. Kept on this device only. */
  function layoutChoiceRow() {
    var now = layoutChoice();
    return el('div', { className: 'row theme-choice', role: 'group', id: 'layout-choice', 'aria-labelledby': 'layout-title' }, [['auto', 'Automatic'], ['phone', 'Phone'], ['laptop', 'Laptop']].map(function (o) {
      return el('button', { type: 'button', className: 'btn ' + (now === o[0] ? 'btn-primary' : 'btn-secondary'), 'aria-pressed': now === o[0] ? 'true' : 'false', 'data-layout': o[0], text: o[1], onclick: function () { setLayout(o[0]); } });
    }));
  }

  function renderSettings() {
    var name = el('input', { type: 'text', id: 'set-person', value: S.settings.person || '', autocomplete: 'name' });
    var listsAt = S.lists && S.lists.at ? when(S.lists.at) : 'never';
    var m = mode(), typed = m === 'worker' && !nameLocked(); // a name is typed only with the old shared setup link (1.17.0)
    setView([
      el('div', { className: 'page-head' }, [el('h1', { text: 'Settings' })]),
      // A personal link fixes the name: it is the name the entries are recorded under. A signed-in admin logs under their own.
      m === 'shared' ? el('div', { className: 'shared-settings' }, sharedSettings()) : null,
      m === 'shared' ? null : m === 'admin' ? el('p', { className: 'sub', id: 'logging-as', text: 'Logging as ' + person() + ' (signed in as an admin)' })
        : nameLocked() ? el('p', { className: 'sub', id: 'logging-as', text: 'Logging as ' + S.settings.person + ' (from your link)' }) : null,
      typed ? el('div', { className: 'q' }, [el('label', { for: 'set-person', text: 'Your name' }), name]) : null,
      !typed ? null : el('button', { className: 'btn btn-primary btn-block', type: 'button', text: 'Save name', onclick: function () {
        if (!name.value.trim()) { toast('Type a name first.'); return; }
        S.settings.person = name.value.trim(); save('ch.settings', S.settings); toast('Saved.'); go('#/');
      } }),
      el('h2', { className: 'sect-title', text: 'Connection' }),
      connected()
        ? el('div', { className: 'notice ok', role: 'status' }, [svgEl('circle-check', 20), el('div', { className: 'notice-body' }, [el('div', { className: 'notice-title', text: m === 'admin' ? 'Connected with your sign-in.' : 'Connected.' }), el('span', { text: 'Lists and ferments last updated ' + listsAt + '.' + (m === 'admin' ? ' To sign out, use the account menu on the admin site.' : '') })])])
        : connectBox(),
      S.lastError ? el('div', { className: 'notice bad', role: 'alert' }, [svgEl('circle-alert', 20), el('div', { className: 'notice-body' }, [el('span', { text: S.lastError })])]) : null,
      el('div', { className: 'row' }, [
        el('button', { className: 'btn btn-secondary', type: 'button', text: 'Send and refresh now', onclick: function () { sync(true); } }),
        mode() === 'worker' ? el('button', { className: 'btn btn-secondary', type: 'button', text: 'Disconnect this device', onclick: function () {
          // 1.17.1: back to the welcome screen, never quietly on to an admin who once signed in here (it asks there)
          disconnectLink();
          var a = adminCred();
          if (a) { S.settings.skipAdmin = fp(a.key); save('ch.settings', S.settings); }
          S.lastError = ''; toast('Disconnected. Entries stay on this device.'); go('#/'); badge();
        } }) : null,
      ]),
      personalDevice() ? el('h2', { className: 'sect-title', text: 'Your devices' }) : null,
      personalDevice() ? devicesBox() : null,
      personalDevice() ? el('h2', { className: 'sect-title', text: 'PIN for shared tablets' }) : null,
      personalDevice() ? pinBox() : null,
      photosOn() ? el('h2', { className: 'sect-title', text: 'Photos' }) : null,
      photoSettings(), // P4-A
      el('h2', { className: 'sect-title', text: 'Appearance' }),
      themeChoice(),
      wideNow() ? el('h2', { className: 'sect-title', id: 'layout-title', text: 'Screen layout' }) : null,
      wideNow() ? layoutChoiceRow() : null, // 1.31.0: on a wide screen only (a phone is always the phone layout)
      window.CH_HELP ? el('h2', { className: 'sect-title', text: 'Help' }) : null,
      window.CH_HELP ? helpBox() : null, // 1.22.2: short answers for the person logging (help-content.js `field`)
      el('h2', { className: 'sect-title', text: 'About' }),
      el('p', { className: 'sub', id: 'help-contact', text: 'For help or a new link, ask ' + CFG.contact + '.' }),
      el('p', { className: 'sub', text: 'App version ' + APP_VERSION + ' · device ID ' + (S.settings.device_id ? S.settings.device_id + ' (' + S.settings.device + ')' : S.settings.device) + ' · ' + S.entries.length + ' entries on this device' }),
    ], 'Settings');
  }

  /* ---------------- start ---------------- */

  var firstJoin = joinToken(location.hash);
  if (firstJoin) {
    history.replaceState(null, '', location.pathname + '#/'); // out of the address bar at once, before anything is sent
    S.join = { state: 'connecting', token: firstJoin };
  } else if (readConnect(location.hash)) {
    history.replaceState(null, '', location.pathname + '#/');
    setTimeout(function () { toast('Connected.'); }, 300);
  } else if (S.badLink) {
    history.replaceState(null, '', location.pathname + '#/');
    setTimeout(function () { toast(badLinkWords()); }, 300);
  }
  window.addEventListener('hashchange', function () {
    // A new link opened while the app is already open (for example after one was switched off): use it and send what is waiting.
    var jt = joinToken(location.hash);
    if (jt) { history.replaceState(null, '', location.pathname + '#/'); startJoin(jt); return; }
    if (/#connect=/.test(location.hash) && readConnect(location.hash)) {
      history.replaceState(null, '', location.pathname + '#/');
      toast('Connected.');
      sync(true);
    } else if (S.badLink) {
      history.replaceState(null, '', location.pathname + '#/');
      toast(badLinkWords());
    }
    render();
  });
  // 1.17.0: signing in or out in another tab of this browser changes who this device logs as (when it has no link)
  window.addEventListener('storage', function (ev) {
    if (ev.key !== 'ch.admin' || linked()) return;
    S.session = ''; S.lastError = '';
    badge(); if (route().name !== 'form') render();
    if (mode() === 'admin') sync(false, true);
  });
  window.addEventListener('online', function () { badge(); sync(false); });
  window.addEventListener('offline', badge);
  var syncIc = document.getElementById('sync-ic');
  if (syncIc) syncIc.innerHTML = [['check', 'i-check'], ['clock', 'i-clock'], ['loader-circle', 'i-loader'], ['cloud-off', 'i-cloud'], ['triangle-alert', 'i-alert']].map(function (p) {
    return ICON(p[0], 16).replace('class="icon ', 'class="icon i-state ' + p[1] + ' ');
  }).join('');
  document.getElementById('sync-badge').addEventListener('click', function () {
    // sync(true) ends with a message that includes when entries were last sent
    var waiting = S.entries.filter(function (e) { return e.status === 'waiting'; }).length;
    if (waiting && connected() && navigator.onLine) toast('Sending now…');
    sync(true);
  });
  document.getElementById('go-home').addEventListener('click', function () { go('#/'); });
  // The bottom bar: Home · My entries · Settings (index.html)
  Array.prototype.forEach.call(document.querySelectorAll('#tabbar .tab'), function (t) {
    var ic = t.querySelector('[data-icon]');
    if (ic) ic.innerHTML = ICON(ic.getAttribute('data-icon'), 22);
    t.addEventListener('click', function () { var to = t.getAttribute('data-tab'); go(to === 'home' ? '#/' : '#/' + to); });
  });
  /*
   * A head start (design slice 8), like the sign-in page's: Google starts the script afresh after a quiet spell, which can
   * take several seconds. When the app opens with a connection and has entries waiting, it asks for the version once
   * (doGet?action=version: no key, nothing about this phone, nothing stored), so the script is awake by the time the
   * entries are sent. If it fails nothing is lost: it never touches the queue, and sending goes on exactly as before.
   */
  var woke = false;
  function wake() {
    if (woke || !navigator.onLine || !connected()) return;
    if (!S.entries.some(function (e) { return e.status === 'waiting' && goesNow(e); })) return;
    var u = address();
    if (!u || !goodUrl(u)) return;
    woke = true;
    try { askVersion(); } catch (e) { /* only a head start */ } // 1.29.2: its answer also tells the version (knownVersion)
  }
  setInterval(function () { if (document.visibilityState === 'visible') sync(false); }, 60000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync(false); });

  applyDesk(); // 1.31.0: body.desk before the first screen is drawn
  CH.DB.tidy().catch(function () {}).then(refreshEntries).then(function () {
    sharedStart(); // 1.21.0: a shared tablet: an admin's fresh sign-in becomes their turn; anything else left over ends
    paintTurnChip();
    var chip = document.getElementById('turn-chip');
    if (chip) chip.addEventListener('click', function () { if (TURN) endTurn('switch'); });
    badge(); render();
    if (firstJoin) startJoin(firstJoin); else { wake(); sync(false, true); }
    setTimeout(tidyPhotos, 5000); // P4-A: after the app has opened
  }).catch(function (err) {
    setView([el('div', { className: 'notice bad', role: 'alert' }, [svgEl('circle-alert', 20), el('div', { className: 'notice-body' }, [el('div', { className: 'notice-title', text: 'This device cannot store entries.' }), el('span', { text: String(err && err.message || err) + '. Use paper for now and tell Jake.' })])])], 'Problem');
  });

  // Offline support and updates.
  // Updates apply themselves: a new version downloads in the background whenever the app is
  // online, then takes over the next time this screen is idle (not in the middle of a form).
  // Forms save as you type, so even a reload mid-form would lose nothing.
  var updateReady = false, reloaded = false;
  function applyUpdateIfIdle() {
    if (!updateReady || reloaded || S.syncing || S.saving || route().name === 'form') return;
    if (shared() && TURN) return; // 1.21.0: a reload would end the turn: a shared tablet updates between turns
    reloaded = true;
    location.reload();
  }
  if ('serviceWorker' in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; } // first install: already running the newest code
      updateReady = true;
      applyUpdateIfIdle();
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg.waiting) reg.waiting.postMessage('skipWaiting'); // a version left waiting by the old "Update now" button
      var check = function () { if (navigator.onLine) reg.update().catch(function () {}); };
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 60 * 60 * 1000);
    }).catch(function () {});
    window.addEventListener('hashchange', function () { setTimeout(applyUpdateIfIdle, 0); });
  }

  // for tests
  window.__ch = { S: S, sync: sync, render: render, toast: toast, version: APP_VERSION, turn: function () { return TURN ? { user: TURN.user, kind: TURN.kind, name: TURN.name } : null; }, clock: function (ms) { if (TURN) { TURN.last_tap -= ms || 0; } turnClock(); }, dayEnd: function () { if (TURN) TURN.day_end = Date.now() - 1; turnClock(); } };
  window.__ch.sendPhotos = sendPhotos; // P4-A (the browser tests)
})();
