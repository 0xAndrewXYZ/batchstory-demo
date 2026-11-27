/*
 * Pick lists page (admin link only): the choices phones offer, read from the Sheet's Lists tab.
 * Add a name or take one off. The sync script checks each change, records it in Raw log first and refuses anything from an
 * ordinary setup link. This page only asks. (The current season moved to the Company page in the redesign, slice 6.)
 *
 * Two panes (design plan, slice 6): every list on the left, grouped by the area whose forms offer it (worked out from
 * schema.js, so a new question's list lands in the right group by itself); the chosen list on the right. On a phone it is one
 * pane at a time: the lists, then one list, with "All lists" (or the phone's Back) to return. The chosen list is kept in the
 * address (#list=Farm), so a list can be bookmarked or sent.
 *
 * 1.30.1: a name added or taken off shows at once ("Saving…" / "Taking off…") and the changes go to the Sheet one after
 * another (pump), so one made while another is on its way is never dropped; a refusal stays on its row with the reason. A
 * read that set off before a change was saved never puts the older list back (S.changed, fetchLists).
 * Review fixes: only lists actually read are kept over a read (never the empty placeholder); a "duplicate" answer reads the
 * lists again; each kept change says who made it, and only that person's are sent by themselves (others: Send / Dismiss);
 * the kept queue is shared job by job between tabs and forgotten on sign-out; a send gets 60 s; a change not saved is marked
 * in the list of lists and its row never disappears.
 */
(function () {
  'use strict';

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  var settings = load('ch.admin', {}) || {};
  if (!settings.by) settings.by = (load('ch.settings', {}) || {}).person || '';

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
  function icon(name, size) { return window.CH_ADMIN ? CH_ADMIN.icon(name, size) : null; }
  var toastT;
  function toast(msg) { var t = $('toast'); t.replaceChildren(icon('circle-check', 18), document.createTextNode(msg)); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 4000); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function readJson(r) {
    return r.text().then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('The Sheet sent back something unexpected. Check the web app address in the admin link.'); }
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

  // The lists people change most come first in their group; the rest follow in the Sheet's order.
  var FIRST = ['Farm', 'Station', 'Person', 'Box type', 'Ferment plan', 'Paid to', 'Drying location', 'Outside of beans', 'Drying setup type', 'Roaster', 'Roast plan', 'Package type', 'Standard package lbs', 'Carrier', 'Flavour', 'Tasting sample', 'Target moisture'];
  var HELP = {
    'Farm': 'Farms beans come from.',
    'Station': 'Where the boxes are.',
    'Person': 'Names offered when a phone is first set up.',
    'Paid to': 'Who is paid for beans. Every phone sees these names (never the amounts).',
    'Box type': 'Kinds of fermenting box.',
    'Ferment plan': 'Turning schedules to compare, e.g. "Daily turns" or "Every other day". Optional on New ferment; hidden there while this list is empty.',
    'Roaster': 'Roasting machines, e.g. "Drum 1". Optional on the Roast form; hidden there while this list is empty.',
    'Roast plan': 'Roast profiles to compare, e.g. "Light" or "Dark". Optional on the Roast form; hidden there while this list is empty.',
    'Package type': 'What nibs are packed in. Starts with Vacuum bag and Box; the first one is filled in on the Pack form.',
    'Standard package lbs': 'The usual weight of one package, as a plain number of lbs, e.g. 5. Keep one entry (take the old one off first to change it). It fills in the weight on the Pack form; each package can still be changed.',
    'Carrier': 'Who carries a shipment, e.g. "Courier". Optional on the Ship form.',
    'Flavour': 'Flavour words to tick on the Tasting note form (a phone can also type its own under Other).',
    'Tasting sample': 'What was tasted on the Tasting note form, e.g. Beans, Nibs, Liquor, Chocolate.',
    'Outside of beans': 'The steps the Drying check offers for the outside of the beans: Wet, Sticky, Dry. You may add a step, but keep the word "Dry": the dashboard counts the days until the outside is Dry (under 2 is too fast, 4 or more too slow).',
    'Drying setup type': 'What the beans dry in, e.g. Tent or Drawers. Asked on the Drying check only once "Setup" is switched on in Settings → What you track.',
    'Target moisture': 'The moisture the dried beans should reach, in percent. Two entries give the target band, e.g. 6 and 8 (the dashboard counts the days each ferment took to reach the higher one). One entry, e.g. 7, means 6 to 7.',
    'Sale item': 'What is sold locally, e.g. Nibs, Shells, Juice. Offered on Add a sale (Finances, Local sales: admins only); Other… types one in.',
    'Sale unit': 'The units local sales are counted in, e.g. lbs, bags, bottles, each. Offered on Add a sale (Finances, Local sales); Other… types one in.',
  };
  // Lists no form question names, but that belong to one area all the same (P1-C: the Drying check's two lists too, so they stay
  // under Fermentation whatever the forms say).
  var AREA_OF = { 'Target moisture': ['fermentation'], 'Outside of beans': ['fermentation'], 'Drying setup type': ['fermentation'], 'Standard package lbs': ['roasting'], 'Label copies': ['roasting'], 'Person': ['fermentation', 'roasting', 'making'] };

  /** For each list: the areas and the forms (by title) whose questions offer it. From schema.js. */
  var USE = (function () {
    var out = {}, CH = window.CH;
    if (!CH || !CH.FORMS || !CH.eachField) return out;
    CH.FORMS.forEach(function (f) {
      var areas = [].concat(f.area || []).map(function (a) { return CH.areaKey ? CH.areaKey(a) || a : a; });
      CH.eachField(f, function (q) {
        if (!q.list) return;
        var u = out[q.list] || (out[q.list] = { areas: [], forms: [] });
        areas.forEach(function (a) { if (u.areas.indexOf(a) < 0) u.areas.push(a); });
        if (u.forms.indexOf(f.title) < 0) u.forms.push(f.title);
      });
    });
    return out;
  })();
  var AREAS = (window.CH && CH.AREAS) || ['fermentation', 'roasting', 'making'];
  function areasOf(name) { return (USE[name] && USE[name].areas.length ? USE[name].areas : AREA_OF[name]) || []; }
  function areaName(a) { var C = window.CH_CONFIG || {}; return (C.areas && C.areas[a]) || (window.CH && CH.AREA_TITLES && CH.AREA_TITLES[a]) || a; }
  function areaIsOn(a) { return !(window.CH && CH.areaOn) || CH.areaOn(a); }
  /** The group a list goes under: its one area, "Every area", "Several areas" or "Other lists". */
  function groupOf(name) {
    var a = areasOf(name);
    if (a.length === 1) return a[0];
    if (a.length >= AREAS.length) return 'every';
    return a.length ? 'several' : 'other';
  }
  function groupTitle(g) { return g === 'every' ? 'Every area' : g === 'several' ? 'Several areas' : g === 'other' ? 'Other lists' : areaName(g); }

  // 1.30.1: queue: the changes not saved yet, sent one after another (each with its own entry_id, kept for its retries);
  // tick / changed: a read that started before a change was saved never puts the older list back (see fetchLists).
  // real: the lists this page has actually read (or had back from a save): only those are kept over a read (M1).
  var S = { lists: {}, order: [], chosen: null, open: null, pushed: false, queue: [], sending: false, tick: 0, changed: {}, real: {}, seen: {}, reread: false };
  var phone = window.matchMedia ? window.matchMedia('(max-width: 767px)') : { matches: false };

  function fetchLists() {
    if (!settings.url || !settings.key) { $('connect').hidden = false; if (window.CH_SIGNIN) CH_SIGNIN.show(); return; }
    var A = window.CH_ADMIN, M = A && A.memo;
    var q = M && !S.loaded && M.get('lists', settings.key);
    if (q && q.data && q.data.lists) { show(q.data, q.data.at || q.at, true); Object.keys(S.lists).forEach(function (n) { S.real[n] = true; }); } // the last copy at once
    else if (!S.loaded) { // 2.7.1: no copy yet: the lists themselves are known from the forms (schema.js), so they show at once; only their names wait
      var known = {};
      Object.keys(USE).concat(Object.keys(AREA_OF)).forEach(function (n) { known[n] = []; });
      S.pending = true; show({ lists: known }, null, true);
    }
    var shownAt = q && q.data ? q.data.at || q.at : null, t0 = S.tick;
    get('lists').then(function (j) {
      if (!j.ok) throw new Error(j.error || 'Could not read the Sheet.');
      // 1.30.1: a list changed here after this read set off (or with a change still waiting) keeps what this page knows: the
      // read is older than that change, so it must not put the old list back (the name would vanish until a reload)
      // M1: only a list this page actually read (never the empty placeholder shown before the first read)
      j.lists = j.lists || {};
      Object.keys(S.lists).forEach(function (n) {
        if (!S.real[n]) return;
        if ((S.changed[n] || 0) > t0) j.lists[n] = S.lists[n]; // a save answered after this read set off: the save's list is newer
        else if (queued(n)) { j.lists[n] = S.lists[n]; S.reread = true; } // a change still on its way: read again once the queue is quiet
      });
      Object.keys(j.lists).forEach(function (n) { S.real[n] = true; });
      if (M) M.put('lists', settings.key, j);
      S.pending = false; S.loaded = true;
      show(j, j.at || new Date().toISOString(), false);
      pump(); // a re-read asked for while the queue was busy
    }).catch(function (err) {
      if (A && A.updated) A.updated($('updated'), S.pending ? null : shownAt, false);
      problem('Could not load the lists (' + (err.message || err) + '). Check the internet connection and reload the page.');
    });
  }
  /** at: when what is shown was read; busy: a fresh read is still running (2.7.1: "Updated 5:48 PM · Updating…"). */
  function show(j, at, busy) {
    $('problem').hidden = true; $('lp').hidden = false;
    S.lists = j.lists || {};
    if (window.CH_ADMIN && CH_ADMIN.updated) CH_ADMIN.updated($('updated'), at, busy);
    else $('updated').textContent = at ? 'Updated ' + new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    var names = Object.keys(S.lists).filter(function (n) { return n !== 'Current season'; });
    S.order = FIRST.filter(function (n) { return names.indexOf(n) >= 0; }).concat(names.filter(function (n) { return FIRST.indexOf(n) < 0; }));
    var season = (S.lists['Current season'] || [])[0] || '';
    if (S.pending) $('lp-season').replaceChildren(el('span', { className: 'muted pending', text: '…' })); // 2.7.1: not read yet
    else $('lp-season').replaceChildren(document.createTextNode(season ? 'Season ' + season + '. ' : 'The season is not set. '),
      el('a', { href: 'settings.html#sec-season', text: season ? 'Change it in Settings' : 'Set it in Settings' }));
    pick(fromHash(), false);
  }
  function problem(msg) { $('problem').hidden = false; $('problem-text').textContent = msg; }
  function paneErr(msg) { var e = $('lp-err'); e.textContent = msg || ''; e.hidden = !msg; }

  /* ---------- which list is showing ---------- */
  function fromHash() {
    var m = /^#list=(.+)$/.exec(location.hash || '');
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }
  function hashFor(name) { return '#list=' + encodeURIComponent(name); }
  /** Shows a list (or, on a phone, the list of lists when name is null). focus: move the keyboard to what opened. */
  function pick(name, focus) {
    if (name && S.order.indexOf(name) < 0) name = null;
    if (!name && !phone.matches) name = visible()[0] || S.order[0] || null; // a laptop always shows one
    var changed = name !== S.chosen;
    if (S.chosen) S.last = S.chosen;
    S.chosen = name;
    if (changed) { S.open = null; $('lp-add').value = ''; paneErr(''); }
    document.body.classList.toggle('lp-one', !!name && phone.matches);
    drawSide();
    drawMain();
    if (focus === 'main' && name) $('lp-title').focus();
    if (focus === 'side') { var a = sideLink(S.last); if (a) a.focus(); } // back to the list it came from
  }
  function sideLink(name) { return Array.prototype.filter.call(document.querySelectorAll('#lp-groups a[data-list-link]'), function (a) { return a.getAttribute('data-list-link') === name; })[0]; }

  /* ---------- search ---------- */
  function query() { return $('q').value.trim().toLowerCase(); }
  function hits(name) {
    var q = query();
    if (!q || name.toLowerCase().indexOf(q) >= 0) return { all: true, n: (S.lists[name] || []).length };
    var m = (S.lists[name] || []).filter(function (v) { return v.toLowerCase().indexOf(q) >= 0; }).length;
    return m ? { all: false, n: m } : null;
  }
  function visible() { return S.order.filter(function (n) { return !!hits(n); }); }

  /* ---------- the left pane: the lists, grouped ---------- */
  function drawSide() {
    var groups = {}, keys = [];
    visible().forEach(function (n) { var g = groupOf(n); if (!groups[g]) { groups[g] = []; keys.push(g); } groups[g].push(n); });
    var rank = AREAS.concat(['several', 'every', 'other']);
    keys.sort(function (a, b) { return rank.indexOf(a) - rank.indexOf(b); });
    var out = keys.map(function (g) {
      var off = AREAS.indexOf(g) >= 0 && !areaIsOn(g);
      var id = 'lp-g-' + g;
      return el('div', { className: 'lp-group', role: 'group', 'aria-labelledby': id }, [
        el('span', { className: 'lp-g', id: id }, [groupTitle(g), off ? el('span', { className: 'lp-off', text: ' · switched off' }) : null]),
        el('ul', {}, groups[g].map(function (n) {
          var h = hits(n);
          var stuck = jobsOf(n).filter(function (x) { return x.state === 'failed' || x.state === 'held'; }).length; // 1.30.1: a change not saved is never out of sight
          var a = el('a', { href: hashFor(n), 'data-list-link': n, 'aria-current': n === S.chosen ? 'true' : null }, [
            el('span', { className: 'lp-name', text: n }),
            stuck ? el('span', { className: 'lp-stuck', text: '!', title: stuck + (stuck === 1 ? ' change' : ' changes') + ' not saved', 'aria-label': stuck + (stuck === 1 ? ' change' : ' changes') + ' not saved' }) : null,
            S.pending ? el('span', { className: 'lp-n muted pending', text: '…', 'aria-label': 'not read yet' }) // 2.7.1: a value that is not there yet
              : el('span', { className: 'lp-n', text: h.all ? String(h.n) : h.n + ' found', 'aria-label': h.all ? h.n + (h.n === 1 ? ' name' : ' names') : h.n + ' found' }),
          ]);
          return el('li', {}, [a]);
        })),
      ]);
    });
    if (!out.length) out = [window.CH_ADMIN && CH_ADMIN.ui ? CH_ADMIN.ui.empty('No matches for "' + $('q').value.trim() + '".', 'Try part of a name, or clear the search.') : el('p', { text: 'Nothing matches.' })];
    $('lp-groups').replaceChildren.apply($('lp-groups'), out);
  }
  $('lp-groups').addEventListener('click', function (ev) {
    var a = ev.target.closest ? ev.target.closest('a[data-list-link]') : null;
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
    var name = a.getAttribute('data-list-link');
    ev.preventDefault();
    if (phone.matches) { history.pushState({ lp: 1 }, '', hashFor(name)); S.pushed = true; pick(name, 'main'); window.scrollTo(0, 0); }
    else { history.replaceState(null, '', hashFor(name)); pick(name, false); }
  });
  $('lp-back').addEventListener('click', function (ev) {
    ev.preventDefault();
    if (S.pushed) { S.pushed = false; history.back(); return; } // the phone's own Back does the same
    history.replaceState(null, '', location.pathname + location.search);
    pick(null, 'side');
  });
  window.addEventListener('popstate', function () { S.pushed = false; pick(fromHash(), fromHash() ? 'main' : 'side'); });
  window.addEventListener('hashchange', function () { if (fromHash() !== S.chosen) pick(fromHash(), 'main'); }); // a link or a typed address
  var onPhone = function () { pick(S.chosen, false); };
  if (phone.addEventListener) phone.addEventListener('change', onPhone); else if (phone.addListener) phone.addListener(onPhone);

  /* ---------- the right pane: one list ---------- */
  function drawMain() {
    var name = S.chosen, main = $('lp-main');
    main.hidden = !name;
    if (!name) { main.removeAttribute('data-list'); return; }
    var items = S.lists[name] || [];
    main.setAttribute('data-list', name);
    $('lp-title').textContent = name;
    $('lp-count').textContent = S.pending ? '…' : items.length + (items.length === 1 ? ' name' : ' names');
    $('lp-add').disabled = !!S.pending; $('lp-add-btn').disabled = !!S.pending; // 2.7.1: nothing is added before the list itself is read
    var u = USE[name];
    var where = u && u.forms.length ? 'Offered on ' + listWords(u.forms) + '.' : '';
    $('lp-help').textContent = [HELP[name] || '', where].filter(Boolean).join(' ');
    $('lp-help').hidden = !$('lp-help').textContent;
    $('lp-add').setAttribute('aria-label', 'Add to ' + name);
    $('lp-add').placeholder = 'Add to ' + name;
    drawNames();
  }
  function listWords(a) { return a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  /*
   * 1.30.1: the changes not saved yet (S.queue). Each job: {action, list, value, entry_id, state, tries, error, again, who,
   * who_id}. state: waiting (to send), sending, failed (refused or maybe lost: shown with the reason), held (made here by
   * someone else, or under another name: never sent by itself; Send / Dismiss). who / who_id: the person who made it (the
   * name, and the signed-in person's id; never a key).
   */
  function jobsOf(name) { return S.queue.filter(function (x) { return x.list === name; }); }
  /** On its way: a read must not put the older list back over these. Failed and held ones do not count. */
  function active(x) { return x.state === 'waiting' || x.state === 'sending'; }
  function queued(name) { return jobsOf(name).some(active); }
  function me() { return { id: settings.session && settings.id ? String(settings.id) : '', name: String(settings.by || '').trim() }; }
  /** Was this job made by the person using this page now? A signed-in person by their id; the shared admin link by the typed name. */
  function isMine(x) { var m = me(); return x.who_id ? x.who_id === m.id : !m.id && !!x.who && x.who === m.name; }
  function again(x) { x.state = 'waiting'; x.error = ''; x.tries = 0; keepQueue(); paneErr(''); drawSide(); drawNames(); pump(); }
  /** A change's row: the name, what is happening to it, and what can be done (Try again / Send / Dismiss). */
  function jobRow(x) {
    var adding = x.action === 'list_add', failed = x.state === 'failed', held = x.state === 'held';
    var words = held ? ' · ' + (adding ? 'Add' : 'Take off') + ', made by ' + (x.who || 'someone else') + ', not sent'
      : failed ? (adding ? ' · Not added: ' : ' · Not taken off: ') + x.error
      : adding ? ' · Saving…' : ' · Taking off…';
    var cls = 'lp-row lp-job' + (failed ? ' is-failed' : held ? ' is-held' : ' is-pending') + (!adding && !failed && !held ? ' is-going' : '');
    return el('li', { className: cls, 'data-job': x.entry_id }, [
      el('span', { className: 'nm' }, [x.value, el('span', { className: 'lp-state', text: words })]),
      failed || held ? el('span', { className: 'lp-job-acts' }, [
        held ? el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Send', 'aria-label': 'Send ' + x.value + ' as ' + (me().name || 'you'), onclick: function () {
          if (!me().name) { paneErr('Type your name under "Changes recorded as" first, so the change history says who made the change.'); $('by').focus(); return; }
          var m = me(); x.who = m.name; x.who_id = m.id; again(x);
        } }) : null,
        failed && x.again ? el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Try again', 'aria-label': 'Try ' + x.value + ' again', onclick: function () { again(x); } }) : null,
        el('button', { type: 'button', className: 'btn btn-ghost btn-sm', text: 'Dismiss', 'aria-label': 'Dismiss ' + x.value, onclick: function () { drop(x); paneErr(''); drawSide(); drawNames(); $('lp-add').focus(); } }),
      ]) : null,
    ]);
  }
  function drawNames() {
    var name = S.chosen;
    if (!name) return;
    var items = S.lists[name] || [], q = query(), jobs = jobsOf(name);
    var shown = !q || name.toLowerCase().indexOf(q) >= 0 ? items : items.filter(function (v) { return v.toLowerCase().indexOf(q) >= 0; });
    var ul = $('lp-names');
    if (S.pending) { ul.replaceChildren(el('li', { className: 'lp-empty muted pending', text: '…' })); return; } // 2.7.1: not read yet
    // a removal sits on its name's row; a removal whose name is no longer listed, and every add, go below (never hidden)
    var onRow = {}, extra = [];
    jobs.forEach(function (x) { if (x.action === 'list_remove' && items.indexOf(x.value) >= 0 && !onRow[x.value]) onRow[x.value] = x; else extra.push(x); });
    if (!shown.length && !extra.length) {
      ul.replaceChildren(el('li', { className: 'lp-empty', text: items.length ? 'No names on this list match "' + $('q').value.trim() + '".' : 'Nothing on this list yet. Phones leave the question out, or show an empty choice, until a name is added.' }));
      return;
    }
    ul.replaceChildren.apply(ul, shown.map(function (v) {
      var open = S.open && S.open.list === name && S.open.value === v;
      if (onRow[v]) return jobRow(onRow[v]); // 1.30.1: being taken off: shown so at once, until the Sheet says so (or says why not)
      return el('li', { className: 'lp-row' + (open ? ' open' : '') }, [
        el('span', { className: 'nm', text: v }),
        el('button', { type: 'button', className: 'btn btn-ghost btn-icon btn-sm lp-x', 'aria-label': 'Take ' + v + ' off the ' + name + ' list', title: 'Take off the list', 'aria-expanded': open ? 'true' : 'false', 'data-v': v, onclick: function () {
          S.open = open ? null : { list: name, value: v }; paneErr(''); drawNames();
          var b = open ? xButton(v) : document.querySelector('#lp-names li.open .confirm .btn-danger');
          if (b) b.focus();
        } }, [icon('x', 16)]),
        open ? el('div', { className: 'confirm bad' }, [
          el('span', { className: 'confirm-title', text: 'Take "' + v + '" off the ' + name + ' list?' }),
          el('span', { className: 'confirm-note', text: 'Phones stop offering it. Entries that already use it keep it. You can add it back any time.' }),
          el('div', { className: 'confirm-actions' }, [
            el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Cancel', onclick: function () { S.open = null; drawNames(); var b = xButton(v); if (b) b.focus(); } }),
            el('button', { type: 'button', className: 'btn btn-danger btn-sm', text: 'Take off', onclick: function () { if (change({ action: 'list_remove', list: name, value: v })) $('lp-title').focus(); } }),
          ]),
        ]) : null,
      ]);
    }).concat(extra.map(jobRow)));
  }
  function xButton(v) { return Array.prototype.filter.call(document.querySelectorAll('#lp-names .lp-x'), function (b) { return b.getAttribute('data-v') === v; })[0]; }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && S.open) { var v = S.open.value; S.open = null; drawNames(); var b = xButton(v); if (b) b.focus(); } });

  function tidy(v) { return String(v).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function add() {
    var v = $('lp-add').value.replace(/\s+/g, ' ').trim();
    if (!S.chosen) return;
    if (!v) { $('lp-add').focus(); return; }
    var name = S.chosen;
    // the same name twice: said at once (the Sheet would refuse it too)
    var on = (S.lists[name] || []).filter(function (x) { return tidy(x) === tidy(v); })[0];
    var going = jobsOf(name).filter(function (x) { return x.action === 'list_add' && x.state !== 'failed' && tidy(x.value) === tidy(v); })[0];
    if (on && !jobsOf(name).some(function (x) { return x.action === 'list_remove' && x.value === on && x.state !== 'failed'; })) { paneErr('"' + on + '" is already on the ' + name + ' list.'); $('lp-add').focus(); return; }
    if (going) { paneErr('"' + going.value + '" is being added already.'); $('lp-add').focus(); return; }
    if (change({ action: 'list_add', list: name, value: v })) { $('lp-add').value = ''; $('lp-add').focus(); }
  }
  $('lp-add').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
  $('lp-add-btn').addEventListener('click', add);

  /**
   * 1.30.1: queues one change (true) and shows it at once in the pending style; pump() sends the queue one change after
   * another, so a change made while another is on its way waits its turn and is never dropped. Each keeps its own entry_id
   * for its retries (the Sheet does it once). On "saved" the list becomes what the Sheet now holds; a refusal is shown on its
   * row and under the Add box, in the Sheet's own words; "busy" is tried again by itself, a few times.
   */
  function change(body) {
    var m = me();
    if (!m.name) { paneErr('Type your name under "Changes recorded as" first, so the change history says who made the change.'); $('by').focus(); return false; }
    paneErr('');
    var x = { action: body.action, list: body.list, value: body.value, entry_id: uuid(), state: 'waiting', tries: 0, error: '', again: false, who: m.name, who_id: m.id };
    S.seen[x.entry_id] = true;
    S.queue.push(x);
    keepQueue();
    S.open = null;
    drawNames();
    pump();
    return true;
  }
  function drop(x) { var i = S.queue.indexOf(x); if (i >= 0) S.queue.splice(i, 1); keepQueue(); }
  /**
   * The queue is kept in this browser until each change is answered, so a reload or a closed tab never loses one: the page
   * sends it again on opening with the same entry_id (done once: an answered one comes back "duplicate"). Only for the same
   * Sheet; names and ids only, never the key. Several tabs share it job by job (L4): each tab rewrites only the jobs it
   * knows (S.seen) and keeps the others'. Forgotten on every sign-out (signin.js forget, CH_CONFIG.dropCopies).
   */
  var QKEY = 'ch.lists.queue';
  function stored() { var q = load(QKEY, null); return q && Array.isArray(q.jobs) && q.url === (settings.url || '') ? q.jobs.filter(function (j) { return j && j.entry_id; }) : []; }
  function keepQueue() {
    var others = stored().filter(function (j) { return !S.seen[j.entry_id]; });
    var mine = S.queue.filter(function (x) { return x.state !== 'failed' || x.again; }).map(function (x) { // a refusal is shown, not kept: only what may still go through
      return { action: x.action, list: x.list, value: x.value, entry_id: x.entry_id, failed: x.state === 'failed', error: x.error, again: x.again, who: x.who || '', who_id: x.who_id || '' };
    });
    var all = others.concat(mine);
    if (all.length) save(QKEY, { url: settings.url || '', jobs: all }); else try { localStorage.removeItem(QKEY); } catch (e) { /* ignore */ }
  }
  /** On opening: the changes kept in this browser. Only this person's are sent by themselves; anyone else's wait (held). */
  function resumeQueue() {
    stored().forEach(function (j) {
      if ((j.action !== 'list_add' && j.action !== 'list_remove') || typeof j.list !== 'string' || typeof j.value !== 'string' || S.seen[j.entry_id]) return;
      var x = { action: j.action, list: j.list, value: j.value, entry_id: String(j.entry_id), state: 'waiting', tries: 0, error: j.error || '', again: !!j.again, who: typeof j.who === 'string' ? j.who : '', who_id: typeof j.who_id === 'string' ? j.who_id : '' };
      x.state = !isMine(x) ? 'held' : j.failed ? 'failed' : 'waiting';
      S.seen[x.entry_id] = true;
      S.queue.push(x);
    });
    drawSide(); drawNames();
    pump();
  }
  var LOST_ = 'May not have been saved. Press Try again (it is only done once).';
  function failed(x, words, again) {
    x.state = 'failed'; x.error = words; x.again = !!again;
    keepQueue();
    paneErr('"' + x.value + '" was not ' + (x.action === 'list_add' ? 'added' : 'taken off') + ': ' + words);
    drawSide(); if (x.list === S.chosen) drawNames();
  }
  var SEND_MS = 60000; // no answer in a minute: it may or may not have been saved (sent again with the same entry_id, it is done once)
  function send(x) {
    var ctl = window.AbortController ? new AbortController() : null;
    var body = { key: settings.key, by: x.who || settings.by || 'Admin', action: x.action, list: x.list, value: x.value, entry_id: x.entry_id };
    var req = fetch(address(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined }).then(readJson);
    return new Promise(function (ok, no) {
      var t = setTimeout(function () { if (ctl) ctl.abort(); no(new Error('timeout')); }, SEND_MS);
      req.then(function (j) { clearTimeout(t); ok(j); }, function (e) { clearTimeout(t); no(e); });
    });
  }
  /** One answer for job x (never confused with a drawing error: those are not "not added"). */
  function answered(x, j) {
    if (j.status === 'saved' || j.status === 'duplicate') {
      drop(x);
      if (Array.isArray(j.items)) { S.lists[x.list] = j.items; S.real[x.list] = true; S.changed[x.list] = ++S.tick; }
      else S.reread = true; // a duplicate (done on an earlier try, perhaps in another tab) says nothing of the list now: read it again once the queue is quiet
      if (S.loaded && window.CH_ADMIN && CH_ADMIN.memo) CH_ADMIN.memo.put('lists', settings.key, { ok: true, lists: S.lists }); // never a copy of the lists not read yet
      toast(j.status === 'duplicate' ? 'Already done: ' + (x.action === 'list_add' ? 'added "' : 'took "') + x.value + (x.action === 'list_add' ? '" to ' : '" off ') + x.list + '.' : j.message || 'Saved.');
      return true;
    }
    if (j.retry && x.tries < 3) { x.tries++; x.state = 'waiting'; return false; } // the Sheet was busy: nothing was changed; the same change again in a moment
    failed(x, j.error || 'That did not go through.', !!j.retry);
    return true;
  }
  function pump() {
    if (S.sending) return;
    var x = S.queue.filter(function (j) { return j.state === 'waiting'; })[0];
    if (!x) { if (S.reread && !S.queue.some(active)) { S.reread = false; fetchLists(); } return; }
    S.sending = true; x.state = 'sending';
    send(x).then(function (j) {
      S.sending = false;
      var now = answered(x, j);
      try { drawSide(); if (x.list === S.chosen) drawMain(); } catch (e) { if (window.console) console.error(e); } // a drawing problem is not a refusal
      if (now) pump(); else setTimeout(pump, 1500 * x.tries);
    }, function () {
      S.sending = false;
      failed(x, LOST_, true);
      pump();
    });
  }

  // the pane's own message line, under the Add box (where the eye is when a change is refused)
  $('lp-names').parentNode.insertBefore(el('p', { className: 'err', id: 'lp-err', role: 'alert', hidden: true }), $('lp-names'));
  $('by').value = settings.by || '';
  $('by').addEventListener('input', function () { settings.by = $('by').value.trim(); save('ch.admin', settings); });
  $('q').addEventListener('input', function () {
    if (!phone.matches && S.chosen && !hits(S.chosen)) { var first = visible()[0]; if (first) { history.replaceState(null, '', hashFor(first)); pick(first, false); return; } }
    drawSide(); drawNames();
  });
  $('refresh').addEventListener('click', fetchLists);
  fetchLists();
  if (settings.url && settings.key) resumeQueue();
})();
