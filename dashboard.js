/*
 * Cocoahead dashboard. Reads the master Sheet through the sync script (same connection
 * as the field app) and works out yields, days and temperatures from the raw entries.
 */
(function () {
  'use strict';

  /* ---------- connection ---------- */
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  var settings = load('ch.settings', {});
  var adminLink = load('ch.admin', null); // the admin link (set by the Entries page) or an admin's sign-in (signin.js)
  // Prefer the admin link when this browser has one: only it sees prices, payments and held entries.
  if (adminLink && adminLink.url && adminLink.key) settings = { url: adminLink.url, key: adminLink.key, admin: true };
  var badLinkSeen = false;
  function goodUrl(u) { return window.CH_CONFIG && CH_CONFIG.goodScriptUrl ? CH_CONFIG.goodScriptUrl(u) : /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '')); }
  function readConnect(text) {
    var m = String(text || '').match(/#connect=([A-Za-z0-9_\-=]+)/);
    if (!m) return false;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }))) /* UTF-8, so names like José survive */;
      if (!j.url || !j.key) return false;
      if (!goodUrl(j.url)) { badLinkSeen = true; return false; } // a link that points anywhere but our server is never kept
      var s = load('ch.settings', {}) || {};
      s.url = j.url; s.key = j.key; save('ch.settings', s);
      if (!settings.admin) { settings.url = j.url; settings.key = j.key; }
      return true;
    } catch (e) { return false; }
  }
  if (readConnect(location.hash)) history.replaceState(null, '', location.pathname);
  function badLinkNote() {
    if (!badLinkSeen) return;
    badLinkSeen = false;
    if (/#connect=/.test(location.hash)) history.replaceState(null, '', location.pathname);
    var p = document.getElementById('problem'), t = document.getElementById('problem-text');
    if (p && t) { t.textContent = 'That link does not belong to this app, so it was not used. Ask for a new one.'; p.hidden = false; }
  }
  if (badLinkSeen) document.addEventListener('DOMContentLoaded', badLinkNote); // the page is drawn by then

  /* ---------- formatting ---------- */
  var fmt = d3.format(','), fmt1 = d3.format(',.1f');
  // 1.24.1: one rule wherever lbs are shown on Home's strip, Inventory and Season's stages: up to one decimal, a trailing .0 dropped (1,200 · 111.3 · 88)
  var lbsF = function (v) { return fmt1(v).replace(/\.0$/, ''); };
  var pct = function (v) { return v == null ? '' : d3.format('.1f')(v) + '%'; };
  var day0 = function (s) { return s ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null; };
  var daysBetween = function (a, b) { return a && b ? Math.round((day0(b) - day0(a)) / 864e5) : null; };
  var short = function (s) { return s ? CH_PAGE.dayText(new Date(day0(s)), true) : ''; }; // the year shows whenever it is not this year
  var long = function (s) { return s ? d3.utcFormat('%b %-d, %Y')(new Date(day0(s))) : ''; };
  var todayIso = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var txt = function (v) { return v == null ? '' : String(v); };
  var idKey = function (id) { var m = String(id).match(/^(\d+)\.(\d+)$/); return m ? +m[1] * 10000 + +m[2] : 0; };
  var season = function (id) { return String(id).split('.')[0]; };

  /* ---------- data ---------- */
  function num(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v); }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function avg(a) { return a.length ? Math.round(d3.mean(a) * 10) / 10 : null; }

  function shape(p) {
    var T = p.tabs || {};
    var intakes = (T['Intakes'] || []).map(function (r) {
      return { id: str(r['Intake ID']), ferment: str(r['Ferment ID']), date: str(r['Date added']), farm: str(r['Farm']) || 'Not stated',
        paid_to: str(r['Paid to']), lbs: num(r['Wet lbs']), price: num(r['Price per lb (XCD)']), paid: num(r['Amount paid (XCD)']), note: str(r['Note']) };
    });
    var checks = (T['Ferment checks'] || []).map(function (r) {
      var top = [1, 2, 3, 4, 5].map(function (i) { return num(r['Top ' + i + ' °C']); });
      var centre = [1, 2, 3, 4, 5].map(function (i) { return num(r['Centre ' + i + ' °C']); });
      var t = top.filter(function (x) { return x != null; }), c = centre.filter(function (x) { return x != null; });
      return { id: str(r['Check ID']), ferment: str(r['Ferment ID']), date: str(r['Date']), time: str(r['Time']), stage: str(r['Stage']),
        turn: num(r['Turn #']), top: top, centre: centre, top_avg: avg(t), centre_avg: avg(c), centre_max: c.length ? d3.max(c) : null,
        colour: str(r['Colour']), smell: str(r['Smell']), interior: str(r['Interior (cut test)']), problems: str(r['Problems']), added: str(r['Added']), notes: str(r['Notes']), by: str(r['Recorded by']) };
    });
    var drying = (T['Drying log'] || []).map(function (r) {
      return { id: str(r['Drying entry ID']), ferment: str(r['Ferment ID']), date: str(r['Date']), location: str(r['Location']), weather: str(r['Weather']),
        outside_pct: num(r['Exterior dry %']), outside_state: str(r['Exterior state']), inside: str(r['Inside dryness']), speed: str(r['Drying speed']),
        dryness: [str(r['Exterior state']) ? 'outside ' + str(r['Exterior state']).toLowerCase() : r['Exterior dry %'] != null ? r['Exterior dry %'] + '% outside dry' : '', r['Inside dryness'] ? 'inside ' + String(r['Inside dryness']).toLowerCase() : '', str(r['Exterior / dryness']), r['Sticky'] === 'Yes' ? 'sticky' : '', r['Drying speed'] ? 'drying ' + String(r['Drying speed']).toLowerCase() : ''].filter(Boolean).join(', '),
        mold: str(r['Mold or bloom']), treatment: str(r['Treatment']), moisture: num(r['Moisture %']), note: str(r['Observation']), by: str(r['Recorded by']) };
    });
    var ferments = (T['Ferments'] || []).map(function (r) {
      var id = str(r['Ferment ID']);
      var mine = intakes.filter(function (i) { return i.ferment === id; });
      var wet = mine.length ? d3.sum(mine, function (i) { return i.lbs || 0; }) : num(r['Wet lbs']);
      var dry = num(r['Dry lbs']);
      var fc = checks.filter(function (c) { return c.ferment === id; });
      return {
        id: id, season: season(id), station: str(r['Station']), box_type: str(r['Box type']), load_date: str(r['Load date']), unload_date: str(r['Unload date']),
        wet_lbs: wet, dry_lbs: dry, yield_pct: wet && dry ? Math.round(dry / wet * 1000) / 10 : null,
        ferment_days: CH_MODEL.saneDays(daysBetween(str(r['Load date']), str(r['Unload date']))), ferment_days_raw: daysBetween(str(r['Load date']), str(r['Unload date'])), // an impossible number of days (a typo'd date) is not counted
        // Box 1 is the loading box; each move goes one box on, so boxes = moves + 1 (moves are saved as Turn #).
        boxes: 1 + (d3.max(fc.filter(function (c) { return c.stage === 'Turn'; }), function (c) { return c.turn; }) || 0),
        plan: str(r['Ferment plan']),
        juiced: r['Juice lbs'] != null || r['Juice litres'] != null || r['Juice gallons'] != null,
        checks: fc.filter(function (c) { return c.stage !== 'Unload'; }).length,
        peak_centre: d3.max(fc, function (c) { return c.centre_max; }) || null,
        juice: [r['Juice lbs'] != null ? r['Juice lbs'] + ' lbs' : '', r['Juice litres'] != null ? r['Juice litres'] + ' L' : '', r['Juice gallons'] != null ? r['Juice gallons'] + ' gal' : ''].filter(Boolean).join(', '),
        brix: num(r['Brix']), additions: str(r['Additions']), drying_setup: str(r['Drying setup']),
        exterior_dry: str(r['Exterior dry date']), interior_dry: str(r['Interior dry date']), bagged: str(r['Bagged date']),
        moisture: num(r['Final moisture %']), notes: str(r['Notes']), bags: num(r['Bags']), bag_labels: str(r['Bag labels']),
        farms: Array.from(new Set(mine.map(function (i) { return i.farm; }))).join(', '),
      };
    });
    intakes.forEach(function (i) {
      var f = ferments.filter(function (x) { return x.id === i.ferment; })[0];
      i.share = f && f.wet_lbs ? Math.round((i.lbs || 0) / f.wet_lbs * 1000) / 10 : null;
      i.est_dry = f && f.dry_lbs && i.share != null ? Math.round(i.share / 100 * f.dry_lbs * 10) / 10 : null;
    });
    checks.forEach(function (c) {
      var f = ferments.filter(function (x) { return x.id === c.ferment; })[0];
      c.day = f ? daysBetween(f.load_date, c.date) : null;
    });
    ferments.forEach(function (f) {
      var dl = drying.filter(function (d) { return d.ferment === f.id; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var outDay = f.exterior_dry || (dl.filter(function (d) { return d.outside_pct === 100 || d.outside_state.trim().toLowerCase() === 'dry'; })[0] || {}).date || '';
      var inDay = f.interior_dry || (dl.filter(function (d) { return d.inside === 'Dry'; })[0] || {}).date || '';
      f.days_out_dry_raw = daysBetween(f.unload_date, outDay); f.days_in_dry_raw = daysBetween(f.unload_date, inDay);
      f.days_out_dry = CH_MODEL.saneDays(f.days_out_dry_raw); f.days_in_dry = CH_MODEL.saneDays(f.days_in_dry_raw);
    });
    return { ferments: ferments, intakes: intakes, checks: checks, drying: drying, review: p.review || [], asks: p.asks || [], pins: p.pins || [], photo_alerts: p.photo_alerts || [], admin: !!p.admin, at: p.at, current_season: str(p.current_season), tabs: T, target_moisture: p.target_moisture, target_moisture_low: p.target_moisture_low };
  }

  /*
   * 2.3.0: what the company tracks (Settings → What you track, kept by config.js). A chart, tile, fact or column that depends
   * only on questions the company switched off is left out; a dashboard tab of an area that is off is hidden. Numbers that
   * come from core questions never change. on(form, key): is that optional question asked? areaOn(area).
   */
  var CONF = window.CH_CONFIG || {};
  var on = function (form, key) { return !CONF.fieldOn || CONF.fieldOn(form, key); };
  var areaOn = function (a) { return !CONF.areaOn || CONF.areaOn(a); };
  /** Show or hide a card; a two-card row with one hidden lets the other take the whole width. */
  var showCard = function (node, show) {
    node.hidden = !show;
    var row = node.parentNode;
    if (row && row.classList && row.classList.contains('grid2')) row.classList.toggle('one-col', [].some.call(row.children, function (c) { return c.hidden; }));
  };
  var ask = function (form, key, x) { return on(form, key) ? x : null; }; // a fact, column or group kept only while its question is asked

  /* ---------- state ---------- */
  var stageSel = null; // Inventory: the stage whose contents are listed (#inventory/<stage>, app 1.24.0)
  var ADDR = { stock: 'inventory' }; // a view's name in the address ("Stock" became "Inventory"; #stock still opens it)
  var picked = null, pickFocus = false; // picked: the one ferment the Season view is narrowed to (#season/<id>, app 1.22.2); pickFocus: put the keyboard back on its bar after the redraw
  var D = null, sel = null, rec = null, curSeason = null; // sel: the ferment in colour on the Season charts; rec: the ferment whose own page is open (#ferments/<id>)
  var UI = CH_ADMIN.ui; // the shared components (design plan, slice 2)
  var $ = function (id) { return document.getElementById(id); };

  /*
   * "Needs attention", the first thing on Home (design plan, slice 5): entries held for checking, people who asked for a new link
   * (2.0.0; once any admin resends it, every admin sees who did it and when), ferments with no check for too long, and the
   * "your sign-in email was changed" banner (signin.js makes it; here it only moves into this list). What is listed is worked out by
   * docs/model.js from what the data read gave this viewer: held entries and asks reach admins only (Code.gs decides).
   */
  function drawAsks() {
    var list = $('attn');
    if (!list || !D) return;
    var a = CH_MODEL.needsAttention({ tabs: D.tabs, review: D.review, asks: D.asks, pins: D.pins, photos: D.photo_alerts, season: D.current_season, today: todayIso() });
    var banner = $('email-changed');
    if (banner && banner.parentNode !== $('attn-banner')) $('attn-banner').appendChild(banner);
    var when = function (t) { var d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
    list.replaceChildren.apply(list, a.items.map(function (x) {
      var why = x.kind === 'ask' ? (when(x.at) ? 'Asked ' + when(x.at) + '. Their old link has run out.' : 'Their old link has run out.') : x.why;
      return el('li', { className: 'is-' + x.tone, 'data-kind': x.kind }, [
        el('span', { className: 'dot' }),
        el('span', { className: 'what' }, [x.what, el('span', { className: 'why', text: why })]),
        !x.action || ((x.kind === 'check' || x.kind === 'drying') && $('tab-ferments').hidden) ? null : el('a', { className: 'btn btn-secondary btn-sm', href: x.action.href, text: x.action.label, 'aria-label': x.action.label + ': ' + x.what }),
      ]);
    }));
    list.hidden = !a.items.length;
    $('attn-none').hidden = !!a.items.length || !!banner;
    var done = $('attn-done');
    done.hidden = !a.done.length;
    done.replaceChildren.apply(done, a.done.map(function (x) { return el('li', { className: 'ask-done', text: x.name + ': resent by ' + x.by + (when(x.at) ? ' at ' + when(x.at) : '') + '.' }); }));
    $('attn-wait').replaceChildren();
    if (D.admin && CH_ADMIN.navHeld) CH_ADMIN.navHeld((D.review || []).length); // the count beside Entries in the sidebar (admin.js remembers it for the other pages)
  }

  function fetchData() {
    if (!settings.url || !settings.key) { $('connect').hidden = false; $('take').textContent = 'Connect this browser to see the data.'; return; }
    $('connect').hidden = true;
    var was = $('updated').textContent; // 2.4.6: a copy already drawn stays marked as such while a fresh one loads
    $('updated').textContent = /^Offline copy/.test(was) ? was.replace(/ · loading…$/, '') + ' · loading…' : 'Loading…';
    // By POST to this site's server (config.js), so the key never goes in a web address.
    var C = window.CH_CONFIG;
    // 2.5.0: with the stamp of the copy this browser may use (keptCopy's rules), so an unchanged Sheet answers a few bytes
    var have = C && C.withCopy ? keptCopy() : null;
    var read = function (since) {
      return (C && C.read ? C.read(settings.url, settings.key, 'data', since)
        : fetch(settings.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: settings.key, action: 'read', what: 'data' }) }))
        .then(function (r) { return r.json(); });
    };
    // 2.7.1: the sign-in answer carried this copy a moment ago (signin-page.js): drawn as it is, with no request of its own
    var fresh = have && have.tabs && have.ok === true && settings.admin && C.justRead && C.justRead('ch.dash', settings.key);
    (fresh ? Promise.resolve(have) : read(have && C.sinceOf(have)).then(function (p) {
      if (!p || p.unchanged !== true) return p;
      return C.withCopy(p, have) || read(null); // not for this copy: read it in full
    })).then(function (p) {
      if (settings.admin && window.CH_SIGNIN) return CH_SIGNIN.guard(p); // a sign-in that has ended: sign in again (or Cancel to use this browser's setup link)
      return p;
    }).then(function (p) {
      if (p.suspended) { // the company is paused by Batchstory: no dashboard, not even the last copy on this computer
        try { localStorage.removeItem('ch.dash'); } catch (e) { /* ignore */ }
        if (window.CH_ADMIN && CH_ADMIN.memo) CH_ADMIN.memo.clear();
        throw Object.assign(new Error(p.error || 'Paused.'), { paused: true });
      }
      if (!p.ok) throw new Error(p.error || 'The Sheet refused the request.');
      if (!settings.admin && p.company && CONF.setCompany) CONF.setCompany(p.company); // 2.3.0: what the company tracks (admins: CH_SIGNIN.guard keeps it)
      if (CONF.keepCopy) CONF.keepCopy('ch.dash', p, settings.url, settings.key); else save('ch.dash', p); // 2.4.6: with where it came from
      $('problem').hidden = true;
      use(p, false);
      var M = window.CH_ADMIN && CH_ADMIN.memo;
      // an admin: the Entries page's quick copy of the data (2.7.1: no read for the other pages from here any more: Google runs
      // two requests at once side by side and each slows the other, so every page sends exactly one request as it opens)
      if (M && p.admin) M.put('data', settings.key, p);
    }).catch(function (err) {
      if (err && err.paused) { $('problem').hidden = false; $('problem-text').textContent = err.message; $('updated').textContent = ''; return; }
      var cached = keptCopy();
      $('problem').hidden = false;
      $('problem-text').textContent = 'Could not load fresh data (' + (err.message || err) + ').' + (cached ? ' Showing the last copy, from ' + new Date(cached.at).toLocaleString() + '.' : '');
      if (cached) use(cached, true); else $('updated').textContent = '';
    });
  }

  function use(p, stale) {
    D = shape(p);
    D.money = p.money !== false; // false for an ordinary setup link: the Sheet leaves prices and payments out
    if (window.CH_ADMIN && CH_ADMIN.navRole) CH_ADMIN.navRole(D.money); // P3-A: the Finances link, for admins and "Can see money" (tidiness: Code.gs decides)
    $('no-money-note').hidden = D.money;
    var seasons = Array.from(new Set(D.ferments.map(function (f) { return f.season; }))).sort(function (a, b) { return b - a; });
    if (!curSeason || (curSeason !== 'all' && seasons.indexOf(curSeason) < 0)) curSeason = seasons[0] || 'all';
    $('season').replaceChildren.apply($('season'), seasons.map(function (s) { return new Option('Season ' + s, s); }).concat([new Option('All seasons', 'all')]));
    $('season').value = curSeason;
    $('updated').textContent = (stale ? 'Offline copy · ' : 'Updated ') + new Date(p.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    draw();
  }

  function inSeason(f) { return curSeason === 'all' || f.season === curSeason; }

  /* ---------- drawing ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] == null) return;
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'className') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var plural = function (n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); };
  var hrefOf = function (id) { return '#ferments/' + encodeURIComponent(id); }; // a ferment's own page (the ID is text: 2.1 is not 2.10)
  /**
   * A table. cols: {h, k or f(r), n (number), nw, t, id, fill (one line, cut with … past its limit; takes the spare width only as the last column), grow (takes the spare width; wraps only when it must), bar, p2 (second line of the row on a phone), label (said before it there),
   * sort ('id' | 'num' | 'text': the heading sorts), v(r) (the raw value to sort by)}.
   * opts: hideEmpty; ownSort (the caller runs UI.sortable itself); noPages; label (the table's name for the pager); link(r) (the first cell is a real link to the record and the whole row opens it); attrs(r) (data- attributes of the row).
   */
  function table(t, cols, rows, opts) {
    opts = opts || {};
    var head = el('tr', {}, cols.map(function (c) {
      return el('th', { className: (c.n ? 'n' : '') + (c.bar ? ' bar-cell' : ''), 'data-sort': c.sort || null, text: c.h });
    }).concat(opts.link ? [el('th', { className: 'go' }, [el('span', { className: 'sr-only', text: 'Open' })])] : []));
    var body = el('tbody', {}, rows.map(function (r) {
      var href = opts.link ? opts.link(r) : '';
      var tr = el('tr', { className: href ? 'is-link' : '' });
      if (opts.attrs) { var a = opts.attrs(r); Object.keys(a).forEach(function (k) { tr.setAttribute(k, a[k]); }); }
      if (href) tr.addEventListener('click', function (ev) { if (!ev.target.closest('a, button')) tr.querySelector('a.rowlink').click(); });
      cols.forEach(function (c, i) {
        var v = c.f ? c.f(r) : r[c.k];
        var td = el('td', { className: [c.n ? 'n' : '', c.nw ? 'nw' : '', c.t ? 't' : '', c.id ? 'id' : '', c.fill ? 'ell-fill' + (i === cols.length - 1 ? ' ell-last' : '') : '', c.grow ? 'grow' : '', c.bar ? 'bar-cell' : ''].filter(Boolean).join(' '),
          'data-p': c.p2 ? '2' : null, 'data-label': c.label || null, 'data-v': c.v ? (function (x) { return x == null ? '' : String(x); })(c.v(r)) : null });
        if (v instanceof Node) td.appendChild(v);
        else if (i === 0 && href) td.appendChild(el('a', { className: 'rowlink', href: href, text: v == null ? '' : String(v) }));
        else td.textContent = v == null ? '' : v;
        // No value yet shows a muted dash; a real 0 shows as 0 (see CH_ADMIN.none in admin.js)
        if (!(v instanceof Node) && td.textContent === '') CH_ADMIN.none(td);
        if (c.fill && td.textContent) td.title = td.textContent; // full list on hover; the cell shows one line
        tr.appendChild(td);
      });
      if (href) tr.appendChild(el('td', { className: 'go' }, [CH_ADMIN.icon('chevron-right', 18)]));
      return tr;
    }));
    t.replaceChildren(el('thead', {}, [head]), body);
    if (opts.hideEmpty) hideEmptyColumns(t, cols);
    // app 1.25.0: every table sorts by its marked headings (kept when it is drawn again) and pages past 25 rows (admin.js)
    if (!opts.ownSort && cols.some(function (c) { return c.sort; })) UI.sortable(t, { keep: true });
    if (!opts.noPages) UI.paged(t, { label: opts.label });
  }
  /** A column with no value in any row is hidden (a column of dashes says nothing). Never the first column. */
  function hideEmptyColumns(t, cols) {
    var rows = [].slice.call(t.tBodies[0].rows);
    if (!rows.length) return;
    cols.forEach(function (c, i) {
      if (i === 0) return;
      var empty = rows.every(function (r) { return r.cells[i].classList.contains('none'); });
      if (!empty) return;
      t.tHead.rows[0].cells[i].hidden = true;
      rows.forEach(function (r) { r.cells[i].hidden = true; });
    });
  }
  /**
   * One figure of a stat strip (ui.css .statstrip): label, figure, one line of context. No value shows the muted dash; a real 0 is
   * shown as 0 and muted (o.zero). o: {dot (a stage's colour), href (the label links to the list behind it), vs (a second line), zero}.
   */
  function stat(label, value, unit, note, o) {
    o = o || {};
    var blank = value == null || value === '' || value === '–';
    var v = el('span', { className: 'stat-v' }, blank ? [] : [String(value), unit ? el('small', { text: unit }) : null]);
    if (blank) CH_ADMIN.none(v);
    return el('li', { className: o.zero ? 'is-zero' : '' }, [
      el('span', { className: 'stat-l' }, [o.dot ? el('i', { className: 'dot ' + o.dot }) : null, o.href ? el('a', { href: o.href, text: label }) : label]),
      v,
      note ? el('span', { className: 'stat-n', text: note }) : null,
      o.vs ? el('span', { className: 'stat-n vs', text: o.vs }) : null,
    ]);
  }

  /*
   * The views: Home (#now), Stock, Season, Ferments (and one ferment's own page, #ferments/<id>), Roasting and Making. One shows at a
   * time and the choice is kept in the address. On a laptop the sidebar chooses (admin.js presses these tabs); on a phone or tablet the
   * strip under the title does. Roasting and Making only show once a roast / a batch exists, and only while their area is on (see draw).
   */
  var VIEWS = ['now', 'stock', 'ferments', 'roasting', 'making', 'batches', 'season']; // 1.24.0: now, then the order the cocoa moves, then the season's trends
  var offered = function (v) { return VIEWS.indexOf(v) >= 0 && !$('tab-' + v).hidden; };
  var view = 'now';
  function showView(name, noDraw) {
    if (!offered(name)) name = 'now';
    if (name !== 'ferments') rec = null;
    if (name !== 'season') picked = null;
    if (name !== 'stock') stageSel = null;
    view = name;
    $('content').setAttribute('data-at', name);
    VIEWS.forEach(function (v) {
      $('view-' + v).hidden = v !== name;
      var t = $('tab-' + v);
      t.setAttribute('aria-selected', v === name ? 'true' : 'false'); t.tabIndex = v === name ? 0 : -1;
    });
    var strip = $('dash-tabs'), cur = $('tab-' + name); // a phone's strip scrolls sideways: keep the chosen view showing in it
    if (strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2);
    try { history.replaceState(null, '', location.pathname + location.search + '#' + (ADDR[name] || name) + (rec ? '/' + encodeURIComponent(rec) : picked ? '/' + encodeURIComponent(picked) : stageSel ? '/' + stageSel : '')); } catch (e) { /* ignore */ }
    if (!noDraw) draw(); // charts are sized from their box, so they are drawn once their view is showing
  }
  /** The view (and ferment) an address names, or null. A ferment's ID is taken as text, exactly as written. */
  function readAddress(hash) {
    var m = String(hash || '').match(/^#(now|stock|inventory|season|ferments|roasting|making|batches)(?:\/(.+))?$/);
    if (!m) return null;
    if (m[1] === 'inventory') m[1] = 'stock';
    var id = null;
    if ((m[1] === 'ferments' || m[1] === 'season') && m[2]) { try { id = decodeURIComponent(m[2]); } catch (e) { id = m[2]; } }
    return { view: m[1], rec: m[1] === 'ferments' ? id : null, pick: m[1] === 'season' ? id : null, stage: m[1] === 'stock' && /^[a-z]+$/.test(m[2] || '') ? m[2] : null };
  }
  /** Opens one ferment's page. A real change of address, so the browser's Back button returns to where you were. */
  function pick(id) {
    if (!offered('ferments')) return; // 2.3.0: Fermentation is switched off: no ferment pages to open
    if (location.hash === hrefOf(id)) return;
    location.hash = hrefOf(id);
  }
  /**
   * Season: narrows the page to one ferment, or (no id) goes back to the whole season. A real change of address (#season/<id>), so
   * Back steps through what was looked at and the link can be shared. Picking the picked ferment again lets go of it.
   */
  function select(id) {
    if (id && id === picked) id = null;
    var to = '#season' + (id ? '/' + encodeURIComponent(id) : '');
    if (location.hash !== to) location.hash = to;
  }
  function route() {
    var a = readAddress(location.hash);
    if (!a) return;
    var was = rec, stay = (view === 'season' && a.view === 'season') || (view === 'stock' && a.view === 'stock'); // picking a ferment on Season, or a stage on Inventory, keeps the page where it is
    stageSel = a.view === 'stock' ? a.stage : null;
    rec = a.view === 'ferments' ? a.rec : null;
    if (rec) sel = rec;
    if (a.view === 'season') { picked = a.pick; if (picked) sel = picked; }
    wantRoasting = a.view === 'roasting' && !offered('roasting'); wantMaking = a.view === 'making' && !offered('making'); wantBatches = a.view === 'batches' && !offered('batches');
    showView(a.view);
    if (stay) return;
    window.scrollTo(0, 0);
    // keyboard: a ferment's page starts at its title; going back to the list returns to the row it was opened from
    if (rec) $('page-title').focus({ preventScroll: true });
    else if (was && view === 'ferments') { var back = [].filter.call($('all').querySelectorAll('a.rowlink'), function (l) { return l.textContent === was; })[0]; if (back) back.focus(); }
  }

  /* ---------- charts ---------- */
  var axisStyle = function (g) {
    g.attr('font-size', null).attr('font-family', null);
    g.selectAll('text').attr('fill', 'var(--text-3)').style('font-size', '12px');
    g.selectAll('.domain').remove();
    g.selectAll('line').attr('stroke', 'var(--chart-grid)');
  };
  function tipFor(box) {
    var t = box.querySelector('.tip');
    if (!t) { t = el('div', { className: 'tip' }); t.hidden = true; }
    return t;
  }
  function showTip(box, tip, ev, head, lines) {
    tip.replaceChildren(el('div', { className: 'h', text: head }));
    lines.filter(Boolean).forEach(function (l) { tip.appendChild(el('div', { text: l })); });
    tip.hidden = false;
    var r = box.getBoundingClientRect();
    var x = ev.clientX - r.left + 12, y = ev.clientY - r.top + 12;
    if (x + tip.offsetWidth > r.width) x = Math.max(0, ev.clientX - r.left - tip.offsetWidth - 12);
    if (y + tip.offsetHeight > r.height) y = Math.max(0, ev.clientY - r.top - tip.offsetHeight - 12);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  /** A chart with nothing to draw yet: one plain sentence, not empty axes. */
  function noChart(box, text) { box.classList.add('is-none'); box.replaceChildren(el('p', { className: 'chart-none', text: text })); }
  function chartIn(box, svg, tip) { box.classList.remove('is-none'); box.replaceChildren(svg.node(), tip); }
  var chartW = function (box) { return Math.max(300, box.clientWidth); };

  function drawYield(fs, seasonYield) {
    var box = $('yield-chart');
    var rows = fs.filter(function (f) { return f.yield_pct != null; }).sort(function (a, b) { return idKey(a.id) - idKey(b.id); });
    if (!rows.length) { noChart(box, 'No finished ferments yet.'); return; }
    var w = chartW(box), h = 240, m = { t: 12, r: 12, b: 26, l: 36 };
    var x = d3.scaleBand(rows.map(function (r) { return r.id; }), [m.l, w - m.r]).padding(0.25);
    var y = d3.scaleLinear([0, 50], [h - m.b, m.t]);
    var svg = d3.create('svg').attr('width', '100%').attr('viewBox', '0 0 ' + w + ' ' + h).attr('role', 'group').attr('aria-label', 'Yield by ferment. Arrow keys move between ferments, Enter picks one, Escape goes back to the whole season.');
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).tickValues([0, 10, 20, 30, 40, 50]).tickFormat(function (v) { return v + '%'; }).tickSize(-(w - m.l - m.r))).call(axisStyle);
    var step = Math.ceil(30 / Math.max(1, x.step()));
    svg.append('g').attr('transform', 'translate(0,' + (h - m.b) + ')').call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat(function (d, i) { return i % step === 0 ? d : ''; })).call(axisStyle);
    var tip = tipFor(box), bw = Math.min(x.bandwidth(), 48);
    var on = rows.some(function (r) { return r.id === sel; }) ? sel : rows[rows.length - 1].id; // pl2: the picked ferment, or the newest one with a yield, so one bar is always in colour
    // 1.22.2: a bar is a button. A click (or Enter) picks its ferment and stays on Season; one bar is in the Tab order and the arrow keys move along them.
    var bars = svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', function (d) { return x(d.id) + (x.bandwidth() - bw) / 2; }).attr('width', bw).attr('y', function (d) { return y(d.yield_pct); })
      .attr('height', function (d) { return y(0) - y(d.yield_pct); }).attr('rx', 2)
      .attr('fill', function (d) { return d.id === on ? 'var(--chart-1)' : 'var(--chart-bar)'; }).style('cursor', 'pointer')
      .attr('class', 'bar').attr('data-id', function (d) { return d.id; }).attr('role', 'button').attr('tabindex', function (d) { return d.id === on ? 0 : -1; })
      .attr('aria-pressed', function (d) { return d.id === picked ? 'true' : 'false'; })
      .attr('aria-label', function (d) { return 'Ferment ' + d.id + ', yield ' + pct(d.yield_pct); })
      .on('click', function (ev, d) { pickFocus = document.activeElement === this; select(d.id); })
      .on('keydown', function (ev, d) {
        var i = rows.indexOf(d), to = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? rows.length - 1 : null;
        if (to !== null) { ev.preventDefault(); var n = bars.nodes()[Math.max(0, Math.min(rows.length - 1, to))]; bars.attr('tabindex', -1); n.setAttribute('tabindex', 0); n.focus(); return; }
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickFocus = true; select(d.id); }
        else if (ev.key === 'Escape' && picked) { ev.stopPropagation(); pickFocus = true; select(null); }
      })
      .on('mousemove', function (ev, d) { showTip(box, tip, ev, 'Ferment ' + d.id + ' · ' + short(d.load_date), ['Yield ' + pct(d.yield_pct), fmt(d.wet_lbs) + ' lbs wet → ' + fmt(d.dry_lbs) + ' lbs dry', d.farms]); })
      .on('mouseleave', function () { tip.hidden = true; });
    if (seasonYield != null) {
      var yy = y(seasonYield);
      svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', yy).attr('y2', yy).attr('stroke', 'var(--text-3)').attr('stroke-dasharray', '4 4').attr('pointer-events', 'none');
      // The label sits over the bars: full-strength text with a halo in the card's colour, so it reads against any bar.
      svg.append('text').attr('x', w - m.r).attr('y', yy - 7).attr('text-anchor', 'end').attr('fill', 'var(--text)')
        .attr('stroke', 'var(--surface)').attr('stroke-width', 5).attr('stroke-linejoin', 'round').attr('paint-order', 'stroke')
        .style('font-size', '12px').style('font-weight', '600').attr('pointer-events', 'none').text('Season ' + pct(seasonYield));
    }
    chartIn(box, svg, tip);
    if (pickFocus) { pickFocus = false; var back = bars.filter(function (d) { return d.id === on; }).node(); if (back) back.focus({ preventScroll: true }); }
  }

  function drawTemps(checks, ids) {
    var box = $('temp-chart');
    var pts = checks.filter(function (c) { return c.centre_avg != null && c.day != null && ids.indexOf(c.ferment) >= 0; });
    if (!pts.length) { noChart(box, 'No centre temperatures logged yet.'); return; }
    var w = chartW(box), h = 240, m = { t: 12, r: 48, b: 30, l: 36 };
    var ax = CH_MODEL.dayAxis(pts.map(function (c) { return c.day; }), { least: 0, room: w < 500 ? 4 : 8 }); // starts at the first day with a reading
    var x = d3.scaleLinear([ax.lo, ax.hi], [m.l, w - m.r]);
    var y = d3.scaleLinear([25, 56], [h - m.b, m.t]);
    var svg = d3.create('svg').attr('width', '100%').attr('viewBox', '0 0 ' + w + ' ' + h).attr('role', 'img').attr('aria-label', 'Centre temperature by day');
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat(function (v) { return v + '°'; }).tickSize(-(w - m.l - m.r))).call(axisStyle);
    svg.append('g').attr('transform', 'translate(0,' + (h - m.b) + ')').call(d3.axisBottom(x).tickValues(ax.ticks).tickFormat(function (v) { return 'Day ' + v; }).tickSize(0).tickPadding(8)).call(axisStyle);
    var groups = d3.groups(pts, function (c) { return c.ferment; }).map(function (g) { return [g[0], g[1].sort(function (a, b) { return a.day - b.day; })]; });
    // pl2: the picked ferment, or the newest one with readings, so one line is always in colour
    var lit = groups.some(function (g) { return g[0] === sel; }) ? sel : groups.slice().sort(function (a, b) { return idKey(a[0]) - idKey(b[0]); })[groups.length - 1][0];
    groups.sort(function (a, b) { return (a[0] === lit) - (b[0] === lit); });
    var line = d3.line().x(function (c) { return x(c.day); }).y(function (c) { return y(c.centre_avg); });
    var tip = tipFor(box);
    groups.forEach(function (g) {
      var on = g[0] === lit;
      svg.append('path').attr('d', line(g[1])).attr('fill', 'none').attr('stroke', on ? 'var(--chart-1)' : 'var(--chart-muted)')
        .attr('stroke-width', on ? 2 : 1.25).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      if (on) {
        svg.append('g').selectAll('circle').data(g[1]).join('circle').attr('cx', function (c) { return x(c.day); }).attr('cy', function (c) { return y(c.centre_avg); }).attr('r', 3).attr('fill', 'var(--chart-1)');
        var last = g[1][g[1].length - 1];
        svg.append('text').attr('x', x(last.day) + 8).attr('y', y(last.centre_avg) + 4).attr('fill', 'var(--text)').style('font-size', '12px').text(g[0]);
      }
    });
    svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', function (c) { return x(c.day); }).attr('cy', function (c) { return y(c.centre_avg); })
      .attr('r', 7).attr('fill', 'transparent').style('cursor', 'pointer')
      .on('click', function (ev, c) { select(c.ferment); })
      .on('mousemove', function (ev, c) { showTip(box, tip, ev, 'Ferment ' + c.ferment + ' · day ' + c.day, ['Centre avg ' + fmt1(c.centre_avg) + ' °C', c.stage + (c.turn ? ' ' + c.turn : '') + ' · ' + short(c.date)]); })
      .on('mouseleave', function () { tip.hidden = true; });
    chartIn(box, svg, tip);
  }

  function drawPassportChart(cs) {
    var box = $('pp-chart');
    var pts = cs.filter(function (c) { return c.day != null && (c.top_avg != null || c.centre_avg != null); }).sort(function (a, b) { return a.day - b.day; });
    if (!pts.length) { noChart(box, 'No temperature readings yet.'); return; }
    var w = chartW(box), h = 240, m = { t: 20, r: 56, b: 30, l: 36 };
    var svg = d3.create('svg').attr('width', '100%').attr('viewBox', '0 0 ' + w + ' ' + h).attr('role', 'img').attr('aria-label', 'Temperatures at each check');
    var ax = CH_MODEL.dayAxis(pts.map(function (c) { return c.day; }), { room: w < 500 ? 4 : 7 });
    var x = d3.scaleLinear([ax.lo, ax.hi], [m.l, w - m.r]);
    var y = d3.scaleLinear([25, 56], [h - m.b, m.t]);
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat(function (v) { return v + '°'; }).tickSize(-(w - m.l - m.r))).call(axisStyle);
    svg.append('g').attr('transform', 'translate(0,' + (h - m.b) + ')').call(d3.axisBottom(x).tickValues(ax.ticks).tickFormat(function (v) { return 'Day ' + v; }).tickSize(0).tickPadding(8)).call(axisStyle);
    var series = [{ k: 'centre_avg', name: 'Centre', color: 'var(--chart-1)' }, { k: 'top_avg', name: 'Top', color: 'var(--chart-2)' }];
    var ends = [];
    series.forEach(function (s) {
      var sp = pts.filter(function (c) { return c[s.k] != null; });
      if (!sp.length) return;
      svg.append('path').attr('d', d3.line().x(function (c) { return x(c.day); }).y(function (c) { return y(c[s.k]); })(sp)).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      svg.append('g').selectAll('circle').data(sp).join('circle').attr('cx', function (c) { return x(c.day); }).attr('cy', function (c) { return y(c[s.k]); }).attr('r', 3).attr('fill', s.color);
      var last = sp[sp.length - 1];
      ends.push({ name: s.name, color: s.color, x: x(last.day) + 8, y: y(last[s.k]) + 4 });
    });
    if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
      var mid = (ends[0].y + ends[1].y) / 2, up = ends[0].y <= ends[1].y ? 0 : 1;
      ends[up].y = mid - 7; ends[1 - up].y = mid + 7;
    }
    ends.forEach(function (e) { svg.append('text').attr('x', e.x).attr('y', e.y).attr('fill', e.color).style('font-size', '12px').style('font-weight', '600').text(e.name); });
    var tip = tipFor(box);
    var reads = function (a) { return a.filter(function (v) { return v != null; }).join(', ') || '–'; };
    svg.append('g').selectAll('rect').data(pts).join('rect').attr('x', function (c) { return x(c.day) - 10; }).attr('width', 20).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', function (ev, c) { showTip(box, tip, ev, short(c.date) + ' · day ' + c.day + ' · ' + (c.stage === 'Turn' ? (c.turn ? 'into box ' + (c.turn + 1) : 'next box') : c.stage), ['Centre: ' + reads(c.centre) + ' °C', 'Top: ' + reads(c.top) + ' °C', [c.colour, c.smell].filter(Boolean).join(' · ')]); })
      .on('mouseleave', function () { tip.hidden = true; });
    chartIn(box, svg, tip);
  }

  /* ---------- Home: where the beans are, as one strip in the order of the work ---------- */
  var placeWord = function () { return CONF.shipTo ? 'At ' + CONF.shipTo : 'Arrived'; }; // where packages are shipped to (Company settings)
  var lbs0 = function (v, f) { return v ? f(v) : '0'; }; // a real zero is "0", never "0.0" and never a dash
  /** The stages, each {key, area, dot, label, lbs (text), zero, unit, n (how many), note, href}. Worked out by docs/model.js, never kept as a count. */
  function stages(inv) {
    var rst = inv.roasting, mk = inv.making;
    var to = function (v, key) { return '#inventory/' + key; }; // 1.24.0: every stage opens its own contents on Inventory
    // what each stage's lbs are a weight OF (Inventory's "Counted as"): said from what is actually weighed at that step
    var COUNTED = { fermenting: 'wet beans, as delivered', drying: 'wet beans, as delivered', bagged: 'dry beans', roasted: 'roasted beans, not yet winnowed (beans in, where not weighed after roasting)', nibs: 'nibs, not yet packed',
      packed: 'nibs, in packages', local: 'nibs, left in packages kept for local use', shipped: 'nibs, in packages', arrived: 'nibs, left in checked-in packages', batches: 'nibs, used so far' };
    var s = function (key, area, dot, label, v, f, unit, n, note, href) { return { key: key, area: area, dot: dot, label: label, counted: COUNTED[key], lbs: lbs0(v, f), zero: !v, unit: unit, n: n, note: note || '', href: href }; };
    return [
      s('fermenting', 'fermentation', 's-ferm', 'Fermenting', inv.fermenting.wet, lbsF, 'wet', plural(inv.fermenting.n, 'ferment'), '', '#inventory/fermenting'),
      s('drying', 'fermentation', 's-dry', 'Drying', inv.drying.wet, lbsF, 'wet', plural(inv.drying.n, 'ferment'), inv.drying.n ? 'About ' + lbsF(inv.drying.expected_dry) + ' lbs dry to expect, at ' + fmt1(inv.yield) + '% yield' : '', '#inventory/drying'),
      s('bagged', 'fermentation', 's-bag', 'Bagged', inv.bagged.dry, lbsF, 'dry', plural(inv.bagged.n, 'ferment'),
        [inv.bagged.bags ? plural(inv.bagged.bags, 'bag') : '', inv.bagged.roasted ? lbsF(inv.bagged.roasted) + ' lbs roasted so far' : ''].filter(Boolean).join(' · '), '#inventory/bagged'),
      s('roasted', 'roasting', 's-roast', 'Roasted', rst.roasted_waiting.lbs, lbsF, 'to winnow', plural(rst.roasted_waiting.n, 'roast'), '', to('roasting', 'roasted')),
      s('nibs', 'roasting', 's-roast', 'Nibs', rst.nibs_waiting.lbs, lbsF, 'to pack', plural(rst.nibs_waiting.n, 'roast'), '', to('roasting', 'nibs')),
      s('packed', 'roasting', 's-roast', 'Packed', rst.packed.lbs, lbsF, 'nibs', plural(rst.packed.n, 'package'), rst.packed.shell_lbs ? lbsF(rst.packed.shell_lbs) + ' lbs shells' : '', to('roasting', 'packed')),
      rst.local && rst.local.n ? s('local', 'roasting', 's-roast', 'Kept for local use', rst.local.lbs, lbsF, 'nibs', plural(rst.local.n, 'package'), rst.local.shell_lbs ? lbsF(rst.local.shell_lbs) + ' lbs shells' : '', to('roasting', 'local')) : null, // P2-F: only when there is any
      s('shipped', 'roasting', 's-roast', 'Shipped', rst.shipped.lbs, lbsF, 'nibs', plural(rst.shipped.n, 'package'), plural(rst.shipped.shipments, 'shipment'), to('roasting', 'shipped')),
      // what arrived and was not yet used in a batch (stage 3); counted here instead of "Shipped" once checked in
      s('arrived', 'making', 's-making', placeWord(), mk.lbs, lbsF, 'nibs', plural(mk.n, 'package'), ['Arrived, not used up', mk.shell_lbs ? lbsF(mk.shell_lbs) + ' lbs shells' : ''].filter(Boolean).join(' · '), to('making', 'arrived')),
      // the same lbs of nibs as the batches add up to (shells apart); a package used but never checked in is said, not hidden
      s('batches', 'making', 's-making', 'In batches', mk.used.lbs, lbsF, 'nibs', mk.used.batches + (mk.used.batches === 1 ? ' batch' : ' batches'),
        [mk.open_batches + ' not finished', mk.used.shell_lbs ? lbsF(mk.used.shell_lbs) + ' lbs shells' : '',
          mk.flags.used_not_checked_in.length ? plural(mk.flags.used_not_checked_in.length, 'package') + ' used but never checked in: ' + mk.flags.used_not_checked_in.join(', ') : ''].filter(Boolean).join(' · '), to('making', 'batches')),
    ].filter(Boolean);
  }
  /** A view with nothing logged yet (Roasting, Making, Batches): one sentence in place of empty tables and charts. */
  function emptyView(name, empty, title, hint) {
    var box = $('view-' + name), note = box.querySelector(':scope > .view-empty');
    [].forEach.call(box.children, function (c) { if (c !== note) c.classList.toggle('is-hidden-empty', !!empty); });
    if (!empty) { if (note) note.remove(); return; }
    if (!note) { note = el('div', { className: 'view-empty tablebox' }); box.insertBefore(note, box.firstChild); }
    note.replaceChildren(UI.empty(title, hint));
  }
  /**
   * Inventory: what is in the stage that was picked (#inventory/<stage>), under the table of stages. model.js stageItems() lists it,
   * and its lbs add up to the stage's own figure. A ferment, package or batch opens its own page.
   */
  // P2-A: a roast (and its packages) can hold beans from several ferments: "3.4, 3.5", and the row opens the first
  var fermentsOf = function (r) { return (r.ferments && r.ferments.length ? r.ferments : [r.ferment]).filter(Boolean); };
  var fermentCol = { h: 'Ferment', p2: 1, sort: 'id', v: function (r) { return fermentsOf(r)[0] || ''; }, f: function (r) { return fermentsOf(r).join(', '); } };
  var STAGE_COLS = {
    ferment: function (key) { return [{ h: 'Ferment', k: 'id', id: 1, sort: 'id' }, { h: 'Farms', fill: 1, f: function (r) { var x = D.ferments.filter(function (y) { return y.id === r.id; })[0]; return x ? x.farms : ''; } },
      { h: key === 'bagged' ? 'Bagged on' : key === 'drying' ? 'Unloaded' : 'Loaded', nw: 1, p2: 1, f: function (r) { return short(key === 'bagged' ? r.bagged_date : key === 'drying' ? r.unload_date : r.load_date); } },
      { h: key === 'bagged' ? 'Left to roast (lbs)' : 'Wet lbs', n: 1, p2: 1, label: '·', sort: 'num', v: function (r) { return r.lbs; }, f: function (r) { return lbsF(r.lbs); } }]; },
    roast: function (key) { return [{ h: 'Roast', k: 'id', id: 1, sort: 'id' }, fermentCol, { h: key === 'nibs' ? 'Winnowed' : 'Roasted', nw: 1, sort: 'text', v: function (r) { return r.date; }, f: function (r) { return short(r.date); } },
      { h: key === 'nibs' ? 'Nibs to pack (lbs)' : 'Lbs', n: 1, p2: 1, label: '·', sort: 'num', v: function (r) { return r.lbs; }, f: function (r) { return lbsF(r.lbs); } },
      key === 'roasted' ? { h: 'Weight is', f: function (r) { return r.weighed ? 'roasted beans' : 'beans in (not weighed after roasting)'; } } : null].filter(Boolean); },
    package: function (key) { return [{ h: 'Package', k: 'id', id: 1, sort: 'id' }, fermentCol, { h: 'Roast', k: 'roast', sort: 'id' }, key === 'shipped' ? { h: 'Shipment', k: 'shipment', sort: 'id' } : null,
      { h: key === 'arrived' ? 'Arrived' : 'Packed', nw: 1, sort: 'text', v: function (r) { return r.date; }, f: function (r) { return short(r.date); } }, { h: key === 'arrived' || key === 'local' ? 'Nibs left (lbs)' : 'Nibs (lbs)', n: 1, p2: 1, label: '·', sort: 'num', v: function (r) { return r.lbs; }, f: function (r) { return lbsF(r.lbs); } }].filter(Boolean); },
    batch: function () { return [{ h: 'Batch', k: 'id', id: 1, sort: 'id' }, { h: 'Product', k: 'product', p2: 1, sort: 'text' }, { h: 'Started', nw: 1, sort: 'text', v: function (r) { return r.date; }, f: function (r) { return short(r.date); } },
      { h: 'Status', sort: 'text', f: function (r) { return r.finished ? 'Finished' : 'In progress'; } }, { h: 'Nibs used (lbs)', n: 1, p2: 1, label: '·', sort: 'num', v: function (r) { return r.lbs; }, f: function (r) { return lbsF(r.lbs); } }]; },
  };
  function drawStage(inv, rows) {
    var box = $('stage-sec'), st = stageSel ? rows.filter(function (r) { return r.key === stageSel; })[0] : null;
    if (stageSel && !st) { stageSel = null; try { history.replaceState(null, '', location.pathname + location.search + '#inventory'); } catch (e) { /* ignore */ } }
    box.hidden = !st;
    $('live-card').classList.toggle('is-hidden-empty', !!st); $('bags-sec').classList.toggle('is-hidden-empty', !!st); // the stage's own list takes their place
    if (!st) return;
    var items = (CH_MODEL.stageItems(inv)[st.key] || []).slice().sort(function (a, b) { return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; });
    $('stage-h').replaceChildren(el('i', { className: 'dot ' + st.dot }), st.label);
    $('stage-sum').textContent = st.lbs + ' lbs · ' + st.n;
    var kind = items.length ? items[0].kind : '';
    var link = { ferment: function (r) { return offered('ferments') ? hrefOf(r.id) : ''; }, roast: function (r) { return fermentsOf(r).length ? 'batch.html?f=' + encodeURIComponent(fermentsOf(r)[0]) : ''; },
      'package': function (r) { return 'batch.html?p=' + encodeURIComponent(r.id); }, batch: function (r) { return 'batch.html?c=' + encodeURIComponent(r.id); } }[kind];
    $('stage-table').closest('.table-wrap').hidden = !items.length; $('stage-none').hidden = !!items.length;
    $('stage-none').textContent = 'Nothing in this stage now.';
    if ($('stage-table').__stage !== st.key) { $('stage-table').__sort = null; $('stage-table').__stage = st.key; } // another stage: its own order and first page
    if (items.length) table($('stage-table'), STAGE_COLS[kind](st.key), items, { link: link, label: st.label });
  }
  /** Season: "Through the stages". model.js seasonFlow() gives the lbs and each yield with what it is of; a dash where it cannot be said. */
  function drawFlow() {
    var sec = $('flow-sec');
    if (!sec) return;
    var show = areaOn('roasting') || areaOn('making');
    sec.hidden = !show;
    if (!show) return;
    var x = CH_MODEL.seasonFlow(D.tabs, curSeason);
    var lb = function (v) { return v == null ? '' : lbsF(v); }, n = function (c, one) { return plural(c, one); };
    var rows = [
      { step: 'Wet beans delivered', lbs: lb(x.wet), pct: '', of: n(x.ferments, 'ferment') },
      { step: 'Dry beans', lbs: x.finished ? lb(x.dry) : '', pct: pct(x.dry_pct), of: x.finished ? 'dry lbs ÷ wet lbs, ' + n(x.finished, 'finished ferment') : 'no ferment finished yet' },
      { step: 'Into the roaster', lbs: x.roasts ? lb(x.beans_in, fmt1) : '', pct: '', of: x.roasts ? n(x.roasts, 'roast') : '' },
      { step: 'Roasted beans', lbs: lb(x.roasted_out, fmt1), pct: pct(x.roast_pct), of: x.roasts ? (x.weighed_roasts ? 'roasted lbs ÷ beans in, ' + x.weighed_roasts + ' of ' + n(x.roasts, 'roast') + ' weighed after roasting' : 'no roast weighed after roasting') : '' },
      { step: 'Nibs', lbs: lb(x.nibs, fmt1), pct: pct(x.nib_pct), of: x.roasts ? (x.winnowed_roasts ? 'nib lbs ÷ beans in, ' + x.winnowed_roasts + ' of ' + n(x.roasts, 'roast') + ' winnowed' : 'no roast winnowed yet') : '' },
      { step: 'Packed', lbs: x.packages ? lb(x.packed, fmt1) : '', pct: '', of: x.packages ? n(x.packages, 'package') + ' of nibs' : '' },
      { step: 'Shipped', lbs: x.packages ? lb(x.shipped, fmt1) : '', pct: '', of: '' },
      areaOn('making') ? { step: placeWord(), lbs: x.packages ? lb(x.arrived, fmt1) : '', pct: '', of: x.packages ? 'weight at check-in' : '' } : null,
      areaOn('making') ? { step: 'Used in batches', lbs: x.packages ? lb(x.used, fmt1) : '', pct: '', of: '' } : null,
    ].filter(Boolean);
    table($('flow-table'), [{ h: 'Step', k: 'step' }, { h: 'Lbs', k: 'lbs', n: 1 }, { h: 'Yield', k: 'pct', n: 1 }, { h: 'Yield is', k: 'of', t: 1 }], rows, {});
  }
  function drawStock() {
    var inv = CH_MODEL.inventory(D.tabs, { season: D.current_season });
    var shown = CH_MODEL.stockShown(inv, areaOn); // 2.3.0: an area that is off keeps its figures only while they are not all zero
    var rst = inv.roasting, mk = inv.making;
    // 1.24.0: every stage of a work area that is switched on shows from day one, a real 0 as a muted 0, so the whole pipeline is always in view
    var has = { fermentation: shown.fermentation, roasting: shown.roasting, making: shown.making };
    var all = stages(inv);
    var group = function (id, area) {
      var box = $(id), mine = all.filter(function (s) { return s.area === area; });
      box.hidden = !has[area];
      box.style.setProperty('--n', String(mine.length));
      box.replaceChildren.apply(box, box.hidden ? [] : mine.map(function (s) {
        return stat(s.label, s.lbs, 'lbs', s.unit + ' · ' + s.n, { dot: s.dot, href: s.href, zero: s.zero }); // 1.22.2: the unit sits beside the figure
      }));
    };
    group('stock', 'fermentation'); group('stock-roast', 'roasting'); group('stock-making', 'making');
    $('flow-wait').replaceChildren();

    // the Stock view: the same stages with their detail, what is in progress, and the bagged ferments waiting to roast
    var rows = all.filter(function (s) { return has[s.area]; });
    table($('stock-stages'), [
      { h: 'Stage', f: function (r) { return el('a', { className: 'stage-name', href: '#inventory/' + r.key, 'aria-current': stageSel === r.key ? 'true' : null }, [el('i', { className: 'dot ' + r.dot }), r.label]); } },
      { h: 'Lbs', n: 1, f: function (r) { return r.lbs; } }, { h: 'Counted as', k: 'counted' },
      { h: 'How many', k: 'n' }, { h: 'Note', k: 'note', t: 1 },
    ], rows, { hideEmpty: true, attrs: function (r) { return { 'class': (r.zero ? 'is-zero' : '') + (stageSel === r.key ? ' is-picked' : ''), 'data-stage': r.key }; } });
    drawStage(inv, rows);
    // 1.22.2: said only when it changes how a figure reads (the season is in the line under the title)
    $('stock-note').textContent = rst.n ? 'Bagged counts what is left to roast: the weight bagged, less what has gone into the roaster.' : '';
    $('stock-note').hidden = !rst.n;
    var today = todayIso();
    $('bags-sec').hidden = !shown.fermentation;
    table($('stock-bags'), [
      { h: 'Ferment', k: 'id', id: 1, sort: 'id' }, { h: 'Bagged on', nw: 1, p2: 1, label: 'Bagged', sort: 'text', v: function (r) { return r.bagged_date; }, f: function (r) { return short(r.bagged_date); } },
      { h: 'Days since bagging', n: 1, sort: 'num', v: function (r) { return r.bagged_date ? daysBetween(r.bagged_date, today) : ''; }, f: function (r) { return r.bagged_date ? txt(daysBetween(r.bagged_date, today)) : ''; } },
      { h: inv.bagged.roasted ? 'Left to roast' : 'Dry lbs', n: 1, p2: 1, label: inv.bagged.roasted ? '· left to roast' : '· dry', sort: 'num', v: function (r) { return inv.bagged.roasted ? r.left : r.dry; }, f: function (r) { var v = inv.bagged.roasted ? r.left : r.dry; return v != null ? fmt(v) : ''; } },
      inv.bagged.roasted ? { h: 'Bagged lbs', n: 1, sort: 'num', v: function (r) { return r.dry; }, f: function (r) { return r.dry != null ? fmt(r.dry) : ''; } } : null,
      { h: 'Bags', n: 1, sort: 'num', v: function (r) { return r.bags; }, f: function (r) { return r.bags != null ? String(r.bags) : ''; } }, { h: 'Marked as', f: function (r) { var m = String(r.labels == null ? '' : r.labels).trim(); return m && m !== r.id ? el('span', { className: 'note', text: m }) : ''; } } /* 1.24.1: only when the bags are marked with something other than the ferment's own ID */,
    ].filter(Boolean), inv.bagged.ferments.slice().sort(function (a, b) { return idKey(b.id) - idKey(a.id); }), { hideEmpty: true, label: 'Bagged ferments', link: offered('ferments') ? function (r) { return hrefOf(r.id); } : null });
    $('bags-h').textContent = areaOn('roasting') ? 'Bagged, waiting to roast' : 'Bagged'; // 1.22.2: "in store" is retired (decisions.md)
    $('bags-count').textContent = inv.bagged.n ? plural(inv.bagged.n, 'ferment') + ' · ' + fmt(inv.bagged.dry) + ' lbs' : '';
    $('stock-bags').closest('.table-wrap').hidden = !inv.bagged.n;
    $('bags-none').hidden = !!inv.bagged.n;
    $('bags-none').textContent = inv.fermenting.n || inv.drying.n ? 'No bagged ferments this season.' : 'No ferments this season.';
    return inv;
  }

  /** Ferments not yet bagged, newest first (the Stock view). A check that looks overdue is said in the amber pill; Home lists it too. */
  function drawLive(open) {
    var today = todayIso();
    $('live-card').hidden = !open.length;
    var rows = open.slice().sort(function (a, b) { return idKey(b.id) - idKey(a.id); }).map(function (f) {
      var drying = !!f.unload_date;
      var lastC = D.checks.filter(function (c) { return c.ferment === f.id; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
      var lastD = D.drying.filter(function (d) { return d.ferment === f.id; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
      var last = drying ? (lastD || lastC) : lastC;
      var lastDate = last ? last.date : (drying ? f.unload_date : f.load_date);
      // first turn is usually ~2 days after loading; drying is checked daily
      var stale = daysBetween(lastDate, today) > (drying ? 1 : 2);
      var detail = !last ? 'No checks yet' : last.centre_avg != null && on('ferment_check', 'centre') ? 'Centre ' + fmt1(last.centre_avg) + ' °C' + (last.colour ? ' · ' + last.colour : '') : last.dryness || last.note || 'Checked';
      var lastNote = last ? (last.notes || last.note || '') : '';
      return { id: f.id, f: f, stage: (drying ? 'Drying' : 'Fermenting') + ' · day ' + daysBetween(drying ? f.unload_date : f.load_date, today), stale: stale,
        last: last ? short(lastDate) + ' · ' + detail + (stale ? ' (nothing since)' : '') : detail + (stale ? ' since ' + short(lastDate) : ''),
        probs: Array.from(new Set(D.checks.filter(function (c) { return c.ferment === f.id && c.problems; }).map(function (c) { return c.problems; }).join(', ').split(', ').filter(Boolean))).join(', '),
        note: lastNote.length > 90 ? lastNote.slice(0, 88) + '…' : lastNote };
    });
    table($('live'), [
      { h: 'Ferment', k: 'id', id: 1, sort: 'id' }, { h: 'Stage', p2: 1, sort: 'text', v: function (r) { return r.stage; }, f: function (r) { return UI.pill(r.stale ? 'warn' : 'info', r.stage); } },
      { h: 'Wet lbs', n: 1, sort: 'num', v: function (r) { return r.f.wet_lbs || 0; }, f: function (r) { return fmt(r.f.wet_lbs || 0); } }, { h: 'Farms', t: 1, f: function (r) { return r.f.farms; } },
      { h: 'Last check', k: 'last', grow: 1, p2: 1 }, // 1.22.2: the long text takes the spare width, so it sits on one line where there is room
      { h: 'Problems', k: 'probs', t: 1 }, { h: 'Last note', k: 'note', t: 1 },
    ], rows, { hideEmpty: true, label: 'Ferments in progress', link: offered('ferments') ? function (r) { return hrefOf(r.id); } : null });
  }

  // Money columns only when the Sheet sent prices (admins and people who can see money); "Paid to" too.
  function noMoney(c) { return D.money || !(c.money || c.k === 'paid_to'); }

  /** One season's figures (or every season's), worked out the same way for this season and the one before it. */
  function figures(list) {
    var done = list.filter(function (f) { return f.yield_pct != null; });
    var wet = d3.sum(done, function (f) { return f.wet_lbs; }), dry = d3.sum(done, function (f) { return f.dry_lbs; });
    var timed = list.filter(function (f) { return f.ferment_days != null; }), dried = list.filter(function (f) { return f.days_in_dry != null; });
    return { n: list.length, done: done, wet: wet, dry: dry, sy: wet ? Math.round(dry / wet * 1000) / 10 : null,
      open: list.filter(function (f) { return !f.bagged && f.dry_lbs == null; }), dried: dried.length,
      days: timed.length ? d3.mean(timed, function (f) { return f.ferment_days; }) : null, dry_days: dried.length ? d3.mean(dried, function (f) { return f.days_in_dry; }) : null };
  }
  var stageOf = function (f) { return f.bagged || f.dry_lbs != null ? 'bagged' : f.unload_date ? 'drying' : f.load_date ? 'fermenting' : 'planned'; }; // as docs/model.js ferments()
  var STAGE_WORD = { bagged: 'Bagged', drying: 'Drying', fermenting: 'Fermenting', planned: 'Not loaded yet' };
  var STAGE_TONE = { bagged: 'ok', drying: 'info', fermenting: 'info', planned: '' };

  /** The title, the line under it, the breadcrumb and which header tools show: they follow the view. */
  function header(F) {
    var title = { stock: 'Inventory', season: 'Season', ferments: 'Ferments', roasting: 'Roasting', making: 'Making', batches: 'Batches' }[view];
    var take = $('take'), crumb = $('crumb'), s = curSeason === 'all' ? 'all seasons' : 'season ' + curSeason;
    crumb.hidden = !(view === 'ferments' && rec);
    if (view === 'now') {
      // Home's heading is the date; what needs attention comes straight under it
      title = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      var hs = D.current_season || (D.ferments.map(function (x) { return x.season; }).sort(function (a, b) { return b - a; })[0] || '');
      var H = figures(D.ferments.filter(function (x) { return x.season === hs; }));
      take.textContent = hs ? 'Season ' + hs + ' · ' + H.done.length + ' finished ' + (H.done.length === 1 ? 'ferment' : 'ferments') + ' · ' + H.open.length + ' in progress' : 'No ferments yet.';
    } else if (view === 'season') {
      if (curSeason !== 'all') title = 'Season ' + curSeason;
      var lo = d3.least(F.done, function (x) { return x.yield_pct; }), hi = d3.greatest(F.done, function (x) { return x.yield_pct; });
      take.replaceChildren.apply(take, F.done.length ? [
        el('b', { text: String(F.done.length) }), ' finished ferments turned ', el('b', { text: fmt(F.wet) }), ' lbs of wet cocoa into ', el('b', { text: fmt(F.dry) }),
        ' lbs of dry beans (' + pct(F.sy) + '). Yield ran from ' + pct(lo.yield_pct) + ' (' + lo.id + ') to ' + pct(hi.yield_pct) + ' (' + hi.id + ').' + (F.open.length ? ' ' + F.open.length + ' in progress.' : ''),
      ] : [document.createTextNode(F.open.length ? F.open.length + ' ferments in progress, none finished yet this season.' : 'No ferments this season yet.')]);
    } else if (view === 'ferments' && rec) {
      title = 'Ferment ' + rec;
      $('crumb-here').textContent = rec;
      take.textContent = '';
    } else if (view === 'ferments') {
      take.textContent = F.n ? plural(F.n, 'ferment') + ' in ' + s + ' · ' + F.open.length + ' in progress' : 'No ferments in ' + s + ' yet.';
    } else if (view === 'stock') {
      var ss = D.current_season || (D.ferments.map(function (x) { return x.season; }).sort(function (a, b) { return b - a; })[0] || '');
      take.textContent = ss ? 'Where season ' + ss + '\'s beans are right now.' : 'Where the beans are right now.';
    } else if (view === 'batches') {
      take.textContent = 'Every batch, best-tasting first. Open one for its whole story.';
    } else take.textContent = view === 'making' ? 'Every batch, from every season.' : 'Roasts of ' + (curSeason === 'all' ? 'every season\'s' : 'season ' + curSeason + '\'s') + ' ferments.';
    take.hidden = !take.textContent;
    $('page-title').textContent = title;
    // the season picker only where it changes what is shown (Home and Stock are about the current season; Making shows every batch)
    $('season').hidden = !(view === 'season' || view === 'roasting' || (view === 'ferments' && !rec));
  }

  function draw() {
    if (!D) return;
    // which views there are: an area the company switched off (2.3.0) loses its views, the data stays; Roasting and Making
    // appear once there is a roast / a batch (stages 2 and 3)
    $('tab-season').hidden = !areaOn('fermentation'); $('tab-ferments').hidden = !areaOn('fermentation');
    var anyRoast = CH_DASH_ROAST.has(D.tabs) && areaOn('roasting'), anyBatch = CH_DASH_MAKING.has(D.tabs) && areaOn('making');
    // 1.24.0: Roasting, Making and Batches are there from day one while their work area is on; with nothing logged they say what will appear
    var onRoast = areaOn('roasting'), onMake = areaOn('making');
    $('tab-roasting').hidden = !onRoast; $('tab-making').hidden = !onMake; $('tab-batches').hidden = !onMake;
    if (onRoast && wantRoasting) { wantRoasting = false; showView('roasting', true); }
    if (onMake && wantMaking) { wantMaking = false; showView('making', true); }
    if (onMake && wantBatches) { wantBatches = false; showView('batches', true); }
    if (!offered(view)) showView('now', true);

    // Season narrowed to one ferment (#season/<id>): its season is shown; an ID that is not in the records is let go of
    var pf = picked ? D.ferments.filter(function (x) { return x.id === picked; })[0] || null : null; // by its exact text: 2.1 is not 2.10
    if (picked && !pf) { picked = null; if (view === 'season') { try { history.replaceState(null, '', location.pathname + location.search + '#season'); } catch (e) { /* ignore */ } } }
    if (pf && !inSeason(pf)) { curSeason = pf.season; $('season').value = curSeason; }
    if (pf) sel = picked;
    var fs = D.ferments.filter(inSeason);
    var ids = fs.map(function (f) { return f.id; });
    if (!sel || ids.indexOf(sel) < 0) sel = fs.slice().sort(function (a, b) { return idKey(b.id) - idKey(a.id); }).map(function (f) { return f.id; })[0] || null;
    var F = figures(fs), done = F.done, sy = F.sy;
    var recF = rec ? D.ferments.filter(function (x) { return x.id === rec; })[0] || null : null; // by its exact text: 2.1 is not 2.10
    header(F);

    // Home
    drawAsks();
    var inv = drawStock();
    drawLive(D.ferments.filter(function (f) { return f.season === inv.season && !f.bagged && f.dry_lbs == null; }));
    CH_DASH_TASTING.recent(helpers(), D);

    // Season: the stat strip. The four key figures first (wet, dry, yield with weight loss, ferments), each against the season before when there is one
    var seasons = Array.from(new Set(D.ferments.map(function (f) { return f.season; })));
    var before = CH_MODEL.seasonBefore(seasons, curSeason), B = before ? figures(D.ferments.filter(function (f) { return f.season === before; })) : null;
    var vs = function (now, was, kind) {
      var v = B ? CH_MODEL.vsLast(now, was, before, kind !== 'total') : null;
      if (!v) return '';
      var name = 'Season ' + v.season;
      if (kind === 'total') return name + ': ' + fmt(v.value);
      var was1 = kind === 'pct' ? pct(v.value) : fmt1(v.value);
      if (!v.diff) return 'The same as ' + name + ' (' + was1 + ')';
      if (kind === 'pct') return fmt1(Math.abs(v.diff)) + (Math.abs(v.diff) === 1 ? ' point ' : ' points ') + (v.diff > 0 ? 'above ' : 'below ') + name + ' (' + was1 + ')';
      return fmt1(Math.abs(v.diff)) + (Math.abs(v.diff) === 1 ? ' day ' : ' days ') + (v.diff > 0 ? 'longer' : 'shorter') + ' than ' + name + ' (' + was1 + ')';
    };
    $('tiles-h').textContent = (curSeason === 'all' ? 'All seasons' : 'Season ' + curSeason) + ' in numbers';
    $('tiles-in').replaceChildren(
      stat('Wet beans', fmt(F.wet), 'lbs', 'finished ferments', { zero: !F.wet, vs: vs(F.wet, B && B.done.length ? B.wet : null, 'total') }),
      stat('Dry beans', fmt(F.dry), 'lbs', 'finished ferments', { zero: !F.dry, vs: vs(F.dry, B && B.done.length ? B.dry : null, 'total') }),
      stat('Yield', pct(sy), '', sy != null ? 'dry ÷ wet · ' + d3.format('.1f')(100 - sy) + '% weight loss' : 'dry lbs ÷ wet lbs', { vs: vs(sy, B && B.sy, 'pct') }),
      stat('Ferments', String(F.n), '', F.open.length + ' in progress', { zero: !F.n, vs: vs(F.n, B && B.n, 'total') }),
      stat('Days fermenting', F.days != null ? fmt1(F.days) : '', '', 'average, load to unload', { vs: vs(F.days, B && B.days, 'days') }),
      stat('Days drying', F.dry_days != null ? fmt1(F.dry_days) : '', '', 'average, unload to inside dry (' + plural(F.dried, 'ferment') + ')', { vs: vs(F.dry_days, B && B.dry_days, 'days') })
    );
    var odd = CH_MODEL.durationProblems(fs, ['ferment_days_raw', 'days_out_dry_raw', 'days_in_dry_raw']);
    var oddIds = odd.map(function (x) { return x.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    $('days-check').hidden = !oddIds.length;
    if (oddIds.length) $('days-check-text').textContent = 'Check entries for ' + oddIds.join(', ') + ': the dates give a number of days that cannot be right (below 0 or over ' + CH_MODEL.MAX_DAYS + '), so they are left out of the day averages.';

    // P1-D: juice taken, one total per unit (never added together); hidden when the question is off or none was taken
    var jt = CH_MODEL.juiceTotals(D.tabs, curSeason), jl = [jt.lbs != null ? fmt1(jt.lbs) + ' lbs' : '', jt.litres != null ? fmt1(jt.litres) + ' L' : '', jt.gallons != null ? fmt1(jt.gallons) + ' gal' : ''].filter(Boolean);
    $('juice-total').hidden = !(on('new_ferment', 'juice') && jt.ferments > 0);
    $('juice-total').textContent = jl.length ? 'Juice taken: ' + jl.join(' · ') + ', from ' + jt.ferments + ' of ' + plural(fs.length, 'ferment') : '';
    // P1-C: drying places compared (hidden until a ferment of the season has a known outside-dry day)
    var places = CH_MODEL.dryingPlaces(D.tabs, { season: curSeason, target: D.target_moisture, today: todayIso() });
    $('dry-places-card').hidden = !places.length;
    if (places.length) table($('dry-places'), [
      { h: 'Place', k: 'place', fill: 1, sort: 'text' }, { h: 'Ferments', k: 'ferments', n: 1, sort: 'num' },
      { h: 'Outside dry (days)', n: 1, sort: 'num', v: function (r) { return r.outside_days; }, f: function (r) { return r.outside_days != null ? fmt1(r.outside_days) : ''; } },
      { h: 'Too fast', k: 'fast', n: 1, sort: 'num' }, { h: 'Fine', k: 'ok', n: 1, sort: 'num' }, { h: 'Too slow', k: 'slow', n: 1, sort: 'num' },
      { h: 'Days to target', n: 1, sort: 'num', v: function (r) { return r.days_to_target; }, f: function (r) { return r.days_to_target != null ? fmt1(r.days_to_target) : ''; } },
      { h: 'Final moisture', n: 1, sort: 'num', v: function (r) { return r.final_moisture; }, f: function (r) { return r.final_moisture != null ? fmt1(r.final_moisture) + '%' : ''; } },
    ], places, { label: 'drying places', noPages: true });

    drawYield(fs, sy);
    showCard($('temp-chart').closest('section'), on('ferment_check', 'centre')); // 2.3.0: no centre temperatures asked, no chart
    if (on('ferment_check', 'centre')) drawTemps(D.checks, ids);
    CH_DASH_TASTING.compare(helpers(), D, sel);
    drawPicked(pf, sy);
    drawCompare(done, pf);

    // farms: the season's, or only the picked ferment's deliveries
    var farmIds = pf ? [pf.id] : ids;
    var byFarm = d3.rollups(D.intakes.filter(function (i) { return farmIds.indexOf(i.ferment) >= 0; }), function (v) {
      return { wet: d3.sum(v, function (i) { return i.lbs || 0; }), dry: d3.sum(v, function (i) { return i.est_dry || 0; }), n: new Set(v.map(function (i) { return i.ferment; })).size, paid: d3.sum(v, function (i) { return i.paid || 0; }) };
    }, function (i) { return i.farm; }).map(function (x) { return Object.assign({ farm: x[0] }, x[1]); }).sort(function (a, b) { return b.wet - a.wet; });
    var maxW = d3.max(byFarm, function (r) { return r.wet; }) || 1;
    table($('farms'), [
      { h: 'Farm', k: 'farm', fill: 1, sort: 'text' },
      { h: 'Wet lbs', n: 1, sort: 'num', v: function (r) { return r.wet; }, f: function (r) { return fmt(r.wet); } },
      { h: '', bar: 1, f: function (r) { var b = el('i'); b.style.width = Math.max(2, Math.round(r.wet / maxW * 80)) + 'px'; return b; } },
      { h: 'Share of dry lbs', n: 1, sort: 'num', v: function (r) { return r.dry || ''; }, f: function (r) { return r.dry ? fmt(Math.round(r.dry)) : ''; } }, pf ? null : { h: 'Ferments', k: 'n', n: 1, sort: 'num' },
      { h: 'Paid (XCD)', n: 1, money: 1, sort: 'num', v: function (r) { return r.paid || ''; }, f: function (r) { return r.paid ? d3.format(',.2f')(r.paid) : ''; } },
    ].filter(Boolean).filter(noMoney), byFarm, { label: 'By farm' });
    $('farms-h').textContent = pf ? 'By farm · ferment ' + pf.id : 'By farm';
    var rl = $('report-link'); // 2.2.0: the print-ready season report (money: admins and people who can see money only)
    rl.hidden = !D.money; rl.href = 'report.html?season=' + encodeURIComponent(curSeason || 'all');

    // Ferments: the list, or one ferment's own page
    $('ferments-list').hidden = !!rec; $('passport').hidden = !recF; $('rec-missing').hidden = !rec || !!recF;
    drawList(fs);
    if (recF) drawRecord(recF);
    else if (rec) $('rec-missing').replaceChildren(UI.empty('No ferment ' + rec + ' in the records', 'It may have been removed, or the address was mistyped.', el('a', { className: 'btn btn-secondary btn-sm', href: '#ferments', text: 'All ferments' })));

    emptyView('roasting', onRoast && !anyRoast, 'No roasts yet', 'Roasts, nib yield and shipments appear here once the first Roast is logged in the field app.');
    emptyView('making', onMake && !anyBatch, 'No batches yet', 'Arrival checks and batches appear here once the first package is checked in or a batch is started.');
    emptyView('batches', onMake && !anyBatch, 'No batches yet', 'Each chocolate batch and its story appear here once the first batch is started.');
    if (anyRoast && view === 'roasting') CH_DASH_ROAST.draw(D, helpers());
    if (anyBatch && view === 'making') CH_DASH_MAKING.draw(D, helpers());
    if (anyBatch && view === 'batches') drawBatches();
    drawFlow();
  }

  /* The Ferments list: the shared table (CH_ADMIN.ui): search, a stage filter kept in the address, headings that sort, rows that open the ferment. */
  var allSort = { i: 0, dir: 'descending' }, allFilter = null; // newest first until a heading is pressed
  function drawList(fs) {
    var t = $('all');
    var scores = CH_MODEL.fermentScores(D.tabs), anyScore = fs.some(function (f) { return scores[f.id]; }); // app 1.19.0: tasting notes about the ferment and everything made from it
    var cols = [
      { h: 'Ferment', k: 'id', id: 1, sort: 'id' },
      { h: 'Stage', sort: 'text', p2: 1, v: function (r) { return STAGE_WORD[stageOf(r)]; }, f: function (r) { return UI.pill(STAGE_TONE[stageOf(r)], STAGE_WORD[stageOf(r)]); } },
      { h: 'Loaded', nw: 1, sort: 'text', p2: 1, label: '· loaded', v: function (r) { return r.load_date; }, f: function (r) { return short(r.load_date); } },
      { h: 'Wet lbs', n: 1, sort: 'num', v: function (r) { return r.wet_lbs; }, f: function (r) { return r.wet_lbs != null ? fmt(r.wet_lbs) : ''; } },
      { h: 'Dry lbs', n: 1, sort: 'num', v: function (r) { return r.dry_lbs; }, f: function (r) { return r.dry_lbs != null ? fmt(r.dry_lbs) : ''; } },
      { h: 'Yield', n: 1, sort: 'num', p2: 1, label: '· yield', v: function (r) { return r.yield_pct; }, f: function (r) { return pct(r.yield_pct); } },
      { h: 'Boxes', k: 'boxes', n: 1, sort: 'num', v: function (r) { return r.boxes; } }, { h: 'Days', k: 'ferment_days', n: 1, sort: 'num', v: function (r) { return r.ferment_days; } },
      on('ferment_check', 'centre') ? { h: 'Peak °C', k: 'peak_centre', n: 1, sort: 'num', v: function (r) { return r.peak_centre; } } : null,
      { h: 'Days to dry', k: 'days_in_dry', n: 1, sort: 'num', v: function (r) { return r.days_in_dry; } },
      anyScore ? { h: 'Tasting score', score: 1, n: 1, sort: 'num', p2: 1, label: '· score', v: function (r) { return scores[r.id] ? scores[r.id].avg : ''; }, f: function (r) { return scores[r.id] ? fmt1(scores[r.id].avg) : ''; } } : null,
      { h: 'Farms', k: 'farms', fill: 1 },
    ].filter(Boolean);
    table(t, cols, fs, { ownSort: true, label: 'Ferments', link: function (r) { return hrefOf(r.id); }, attrs: function (r) { return { 'data-stage': stageOf(r) }; } });
    var scoreAt = cols.map(function (c) { return !!c.score; }).indexOf(true), best = $('all-best');
    var pressed = function () { best.setAttribute('aria-pressed', scoreAt >= 0 && allSort.i === scoreAt && allSort.dir === 'descending' ? 'true' : 'false'); };
    if (allSort.i >= cols.length || (scoreAt < 0 && allSort.i === cols.length - 1 && allSort.wasScore)) allSort = { i: 0, dir: 'descending' }; // the score column went with its last note
    var sorter = UI.sortable(t, { onSort: function (i, dir) { allSort = { i: i, dir: dir, wasScore: i === scoreAt }; pressed(); } });
    sorter.sort(allSort.i, allSort.dir);
    // "Best first": by the average score of every note about the ferment or anything made from it; pressed again, newest first
    best.hidden = scoreAt < 0;
    best.onclick = function () { if (best.getAttribute('aria-pressed') === 'true') sorter.sort(0, 'descending'); else sorter.sort(scoreAt, 'descending'); };
    if (allFilter) allFilter.run();
    else allFilter = UI.filter(t, { search: $('all-q'), filters: [$('all-stage')], count: $('all-count'), noun: ['ferment', 'ferments'] });
    $('all-none').textContent = fs.length ? 'No ferment matches. Clear the search or the filter.' : 'No ferments this season yet.';
  }

  /*
   * Batches (app 1.19.0): every chocolate batch, the best-tasting first (model.js batchScores: the average of the notes about the batch
   * itself; a batch nobody has tasted goes last). The shared table: search, two filters kept in the address, headings that sort. A row
   * opens the batch's whole story (batch.html?c=). No money is read or shown.
   */
  var batchSort = null, batchFilter = null;
  var slug = function (v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'none'; };
  function drawBatches() {
    var t = $('batches-table'), rows = CH_MODEL.batchScores(D.tabs);
    var flagsOf = function (r) { return [r.off ? 'off' : '', r.off_before ? 'before' : '', r.arrival_problems ? 'arrival' : ''].filter(Boolean); };
    var pills = function (r) {
      var list = [r.off ? UI.pill('bad', 'Something off') : null, r.off_before ? UI.pill('warn', 'Off before making') : null, r.arrival_problems ? UI.pill('warn', 'Arrival not OK') : null].filter(Boolean);
      return list.length ? el('span', { className: 'pills' }, list) : '';
    };
    var product = function (r) { return [r.destination, r.recipe].filter(Boolean).join(' · '); };
    var cols = [
      { h: 'Batch', k: 'id', id: 1, nw: 1, sort: 'id' },
      { h: 'Started', nw: 1, sort: 'text', v: function (r) { return r.start_date; }, f: function (r) { return long(r.start_date); } },
      { h: 'Product', t: 1, sort: 'text', p2: 1, v: product, f: product }, // a long recipe name wraps before the table has to scroll sideways (app 1.25.0)
      { h: 'Ferments', nw: 1, sort: 'id', f: function (r) { return r.ferments.join(', '); } },
      { h: 'Farms', fill: 1, f: function (r) { return r.farms.join(', '); } },
      { h: 'Score', score: 1, n: 1, sort: 'num', p2: 1, label: '· score', v: function (r) { return r.score == null ? '' : r.score; }, f: function (r) { return r.score == null ? '' : fmt1(r.score); } },
      { h: 'Notes', n: 1, sort: 'num', v: function (r) { return r.notes; }, f: function (r) { return String(r.notes); } },
      { h: 'Flags', sort: 'num', p2: 1, v: function (r) { return flagsOf(r).length || ''; }, f: pills },
    ];
    // the products on record fill the Product filter (the choice in the address is kept)
    var sel = $('batches-product'), had = sel.value || new URLSearchParams(location.search).get('product') || '', seen = Object.create(null);
    sel.replaceChildren.apply(sel, [el('option', { value: '', text: 'All' })].concat(rows.filter(function (r) { var k = slug(r.destination); if (seen[k]) return false; seen[k] = 1; return true; })
      .map(function (r) { return el('option', { value: slug(r.destination), text: r.destination || 'Not stated' }); })));
    if (seen[had]) sel.value = had;
    table(t, cols, rows, { ownSort: true, label: 'Batches', link: function (r) { return 'batch.html?c=' + encodeURIComponent(r.id); },
      attrs: function (r) { return { 'data-product': slug(r.destination), 'data-flag': flagsOf(r).join(' ') || 'clear', 'data-batch': r.id }; } });
    var scoreAt = cols.map(function (c) { return !!c.score; }).indexOf(true);
    if (!batchSort) batchSort = { i: scoreAt, dir: 'descending' }; // best first until a heading is pressed
    UI.sortable(t, { onSort: function (i, dir) { batchSort = { i: i, dir: dir }; } }).sort(batchSort.i, batchSort.dir);
    if (batchFilter) batchFilter.run();
    else batchFilter = UI.filter(t, { search: $('batches-q'), filters: [sel, $('batches-flag')], count: $('batches-count'), noun: ['batch', 'batches'], q: 'bq' }); // its own search in the address (?bq=), so it never filters the Ferments list (?q=)
    $('batches-none').textContent = rows.length ? 'No batch matches. Clear the search or the filters.' : 'No batches yet.';
  }

  /** P1-C: the outside of the beans on a ferment's page: the first dry day and how many days it took, with a pill when that was too fast or too slow. */
  function outsideFact(f) {
    var o = CH_MODEL.outsideDry(D.tabs, f.id, todayIso());
    var days = function (n) { return n + (n === 1 ? ' day' : ' days'); };
    var pill = function (flag) { return flag === 'fast' ? UI.pill('warn', 'Too fast') : flag === 'slow' ? UI.pill('warn', 'Too slow') : null; };
    if (o.date) return ['Outside dry', long(o.date) + (o.days != null ? ' (' + days(o.days) + ')' : ''), 0, pill(o.flag)];
    if (stageOf(f) === 'drying' && o.waiting != null) return ['Outside dry', 'Not yet (' + days(o.waiting) + ' since unloading)', 0, o.waiting >= CH_MODEL.DRY_OUTSIDE.slowFrom ? pill('slow') : null];
    return ['Outside dry', ''];
  }
  /** " (under 6-8%)" or " (over 6-8%)" for a final moisture outside the band; nothing inside it, or when the script sent no band. */
  function bandWords(m) {
    var b = CH_MODEL.targetBand(D.target_moisture_low, D.target_moisture), pos = CH_MODEL.bandPosition(m, b);
    return pos === 'under' || pos === 'over' ? ' (' + pos + ' ' + b.text + ')' : '';
  }

  /*
   * One ferment's own page (#ferments/<id>), laid out like the batch page: the title, "At a glance", then sections with a short
   * list of them on the left. Facts about questions the company switched off (2.3.0) are left out; money columns only as sent.
   */
  function drawRecord(f) {
    var id = f.id, st = stageOf(f);
    $('batch-link').href = 'batch.html?f=' + encodeURIComponent(id);
    $('labels-link').href = 'labels.html?f=' + encodeURIComponent(id);
    $('rec-stage').replaceChildren(UI.pill(STAGE_TONE[st], STAGE_WORD[st]));
    $('rec-sub').textContent = ['Season ' + f.season, f.farms].filter(Boolean).join(' · ');
    $('pp-glance').replaceChildren.apply($('pp-glance'), [
      stat('Loaded', long(f.load_date)), stat('Unloaded', long(f.unload_date)),
      stat('Wet lbs', f.wet_lbs != null ? fmt(f.wet_lbs) : ''), stat('Dry lbs', f.dry_lbs != null ? fmt(f.dry_lbs) : ''), stat('Yield', pct(f.yield_pct)),
      on('ferment_check', 'centre') ? stat('Peak centre °C', txt(f.peak_centre)) : null,
    ].filter(Boolean));
    var groups = [
      ['pp-f-ferment', [
        ['Days fermenting', f.ferment_days == null && f.ferment_days_raw != null ? 'Check entries for ' + f.id + ' (the dates give ' + f.ferment_days_raw + ' days)' : txt(f.ferment_days)],
        ['Shape', f.boxes + (f.boxes === 1 ? ' box' : ' boxes') + (f.ferment_days != null ? ', ' + f.ferment_days + (f.ferment_days === 1 ? ' day' : ' days') : f.ferment_days_raw != null ? '' : ' so far')], ask('new_ferment', 'plan', ['Ferment plan', f.plan]),
        ['Checks logged', txt(f.checks)],
        ask('new_ferment', 'station', ['Station', f.station]), ask('new_ferment', 'box_type', ['Box type', f.box_type]), ask('new_ferment', 'juice', ['Juice', f.juice]), ask('new_ferment', 'brix', ['Brix', txt(f.brix)]),
        ask('new_ferment', 'additions', ['Additions', f.additions]), ask('new_ferment', 'notes', ['Notes', f.notes, 1]),
      ]],
      ['pp-f-drying', [
        outsideFact(f), ['Inside dry', long(f.interior_dry) + (f.days_in_dry != null ? ' (' + f.days_in_dry + ' days)' : '')],
        ask('finish_drying', 'moisture', ['Final moisture', f.moisture != null ? f.moisture + '%' + bandWords(f.moisture) : '']),
        ['Bagged', long(f.bagged)], ['Bags', f.bags != null ? f.bags + (f.bag_labels && on('finish_drying', 'bag_labels') ? ' · marked ' + f.bag_labels : '') : ''],
        ask('ferment_check', 'drying_setup', ['Drying setup', f.drying_setup, 1]),
      ]],
    ];
    var hiddenFacts = [];
    groups.forEach(function (g) {
      var shown = 0;
      var dl = el('dl', { className: 'facts' }, g[1].filter(Boolean).map(function (x) { // 2.3.0: facts about questions the company switched off are left out
        var d = el('div', { className: x[2] ? 'wide' : '' }, [el('dt', { text: x[0] }), x[1] ? el('dd', { text: x[1] }, x[3] ? [' ', x[3]] : []) : CH_ADMIN.none(el('dd'))]);
        if (x[1]) shown++; else { d.hidden = true; hiddenFacts.push(d); }
        return d;
      }));
      dl.hidden = !shown;
      $(g[0]).replaceChildren(dl);
    });
    var more = $('pp-more-row');
    more.hidden = !hiddenFacts.length;
    more.replaceChildren();
    if (hiddenFacts.length) {
      more.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm pp-more', text: 'Show ' + plural(hiddenFacts.length, 'fact') + ' not recorded', onclick: function () {
        hiddenFacts.forEach(function (n) { n.hidden = false; n.parentNode.hidden = false; }); more.hidden = true;
      } }));
    }
    CH_DASH_ROAST.passport(D, helpers(), id);
    CH_DASH_MAKING.passport(D, helpers(), id);
    CH_DASH_TASTING.passport(helpers(), D, id);
    var fcs = D.checks.filter(function (c) { return c.ferment === id; });
    $('pp-chart-card').hidden = !(on('ferment_check', 'centre') || on('ferment_check', 'top'));
    if (!$('pp-chart-card').hidden) drawPassportChart(fcs);
    table($('pp-intakes'), [
      { h: 'Farm', k: 'farm', nw: 1 }, on('new_ferment', 'deliveries.paid_to') || on('add_beans', 'paid_to') ? { h: 'Paid to', k: 'paid_to', nw: 1 } : null, { h: 'Wet lbs', n: 1, f: function (r) { return r.lbs != null ? fmt(r.lbs) : ''; } },
      { h: 'Share', n: 1, f: function (r) { return pct(r.share); } }, { h: 'Est. dry lbs', n: 1, f: function (r) { return r.est_dry != null ? fmt1(r.est_dry) : ''; } },
      { h: 'XCD/lb', n: 1, money: 1, f: function (r) { return r.price != null ? r.price.toFixed(2) : ''; } }, { h: 'Paid (XCD)', n: 1, money: 1, f: function (r) { return r.paid != null ? d3.format(',.2f')(r.paid) : ''; } },
    ].filter(Boolean).filter(noMoney), D.intakes.filter(function (i) { return i.ferment === id; }), { hideEmpty: true });
    table($('pp-checks'), [
      { h: 'Date', nw: 1, f: function (r) { return short(r.date); } }, { h: 'Day', k: 'day', n: 1 }, { h: 'Stage', f: function (r) { return r.stage === 'Turn' ? (r.turn ? 'Into box ' + (r.turn + 1) : 'Next box') : r.stage; } },
      { h: 'Top avg °C', n: 1, q: [['ferment_check', 'top']], f: function (r) { return r.top_avg != null ? fmt1(r.top_avg) : ''; } }, { h: 'Centre avg °C', n: 1, q: [['ferment_check', 'centre']], f: function (r) { return r.centre_avg != null ? fmt1(r.centre_avg) : ''; } },
      { h: 'Colour', k: 'colour', t: 1, q: [['ferment_check', 'colour']] }, { h: 'Smell', k: 'smell', q: [['ferment_check', 'smell']] }, { h: 'Cut test', k: 'interior', t: 1, q: [['ferment_check', 'ridges']] },
      { h: 'Problems', k: 'problems', q: [['ferment_check', 'problems']] }, { h: 'Notes', k: 'notes', t: 1, q: [['ferment_check', 'notes']] }, { h: 'By', k: 'by' },
    ].filter(function (c) { return !c.q || c.q.some(function (q) { return on(q[0], q[1]); }); }), fcs.slice().sort(function (a, b) { return (a.day || 0) - (b.day || 0); }), { hideEmpty: true });
    $('pp-checks').closest('.tablebox').hidden = !fcs.length;
    var fd = D.drying.filter(function (d) { return d.ferment === id; });
    table($('pp-drying'), [
      { h: 'Date', nw: 1, f: function (r) { return short(r.date); } }, { h: 'Location', k: 'location', q: [['drying_check', 'location']] }, { h: 'Weather', k: 'weather', q: [['drying_check', 'weather']] }, { h: 'Dryness', k: 'dryness', t: 1 },
      { h: 'Mold or bloom', k: 'mold', q: [['drying_check', 'mold']] }, { h: 'Done', k: 'treatment', q: [['drying_check', 'treatment']] }, { h: 'Moisture %', k: 'moisture', n: 1, q: [['drying_check', 'moisture'], ['finish_drying', 'moisture']] },
      { h: 'Notes', k: 'note', t: 1, q: [['drying_check', 'notes'], ['finish_drying', 'notes']] }, { h: 'By', k: 'by' },
    ].filter(function (c) { return !c.q || c.q.some(function (q) { return on(q[0], q[1]); }); }), fd, { hideEmpty: true });
    $('pp-drying').closest('.table-wrap').hidden = !fd.length;
    $('pp-drying-none').hidden = !!fd.length;

    drawPhotos(id); // P4-A
    // the short list of sections on the left: only the ones this ferment has; each button moves to its heading
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var secs = [].filter.call($('pp').querySelectorAll('section[data-sec]'), function (s) { return !s.hidden; });
    var links = secs.map(function (s) {
      return el('button', { type: 'button', text: s.getAttribute('data-sec'), onclick: function () {
        var h = s.querySelector('h2');
        s.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
        if (h) h.focus({ preventScroll: true });
      } });
    });
    $('pp-nav').replaceChildren(el('p', { className: 'pagenav-h', 'aria-hidden': 'true', text: 'On this page' }), el('div', { className: 'pagenav-list' }, links));
    if (CH_ADMIN.pageNav) CH_ADMIN.pageNav(secs.map(function (s, i) { return { link: links[i], target: s }; })); // 1.22.2: the section in view is marked
  }

  /**
   * P4-A: the ferment's photos, for an admin while photos are switched on (CH_CONFIG.photos). Read from the server (admins
   * only, Code.gs checks) one ferment at a time; drawn again only when another ferment is opened.
   */
  var photosShown = null;
  function drawPhotos(id) {
    var card = $('pp-photos-card');
    if (!card) return;
    var on = !!(settings.admin && CONF.photos && window.CH_PHOTOS);
    card.hidden = !on;
    if (!on) { photosShown = null; return; }
    if (photosShown === id) return;
    photosShown = id;
    var ask = function (body) { body.key = settings.key; return CONF.ask(settings.url, body).then(function (r) { return r.json(); }); };
    $('pp-photos').replaceChildren(CH_PHOTOS.view({ ask: ask, ferment: id }).node);
  }

  /**
   * Finished ferments side by side: by ferment plan, by shape (boxes, days) and juiced or not.
   * Yield is total dry ÷ total wet for the group, so a big ferment counts for more than a small one.
   */
  /**
   * Season narrowed to one ferment (1.22.2): the bar that says so, with the ferment's own figures, the explicit way to its page and
   * the way back to the whole season. The stat strip above stays the season's: it is what the ferment is measured against.
   */
  function drawPicked(pf, seasonYield) {
    var bar = $('pick-bar');
    bar.hidden = !pf;
    $('view-season').classList.toggle('is-picked', !!pf);
    if (!pf) { bar.replaceChildren(); return; }
    var d = pf.yield_pct != null && seasonYield != null ? Math.round((pf.yield_pct - seasonYield) * 10) / 10 : null;
    var facts = [
      pf.load_date ? 'Loaded ' + short(pf.load_date) : '',
      pf.wet_lbs != null ? fmt(pf.wet_lbs) + ' lbs wet' + (pf.dry_lbs != null ? ' → ' + fmt(pf.dry_lbs) + ' lbs dry' : '') : '',
      pf.yield_pct != null ? 'Yield ' + pct(pf.yield_pct) + (d == null ? '' : d === 0 ? ', the season\'s figure' : ', ' + fmt1(Math.abs(d)) + (Math.abs(d) === 1 ? ' point ' : ' points ') + (d > 0 ? 'above' : 'below') + ' the season') : STAGE_WORD[stageOf(pf)],
    ].filter(Boolean).join(' · ');
    bar.replaceChildren(
      el('div', { className: 'pick-what' }, [el('b', { id: 'pick-name', text: 'Showing ferment ' + pf.id }), el('span', { className: 'note', id: 'pick-facts', text: facts })]),
      el('div', { className: 'pick-acts' }, [
        offered('ferments') ? el('a', { className: 'btn btn-secondary btn-sm', id: 'pick-open', href: hrefOf(pf.id) }, ['Open ferment ' + pf.id, CH_ADMIN.icon('chevron-right', 16)]) : null,
        el('button', { type: 'button', className: 'btn btn-ghost btn-sm', id: 'pick-clear', onclick: function () { select(null); } }, [CH_ADMIN.icon('x', 16), 'Whole season']),
      ])
    );
  }
  function drawCompare(done, pf) {
    var card = $('compare-card');
    if (!card) return;
    var rows = [];
    function add(by, label, list) {
      if (!list.length) return;
      var w = d3.sum(list, function (f) { return f.wet_lbs; }), d = d3.sum(list, function (f) { return f.dry_lbs; });
      rows.push({ by: by, group: label, has: !!pf && list.indexOf(pf) >= 0, n: list.length, yield_pct: w ? Math.round(d / w * 1000) / 10 : null,
        days: d3.mean(list.filter(function (f) { return f.ferment_days != null; }), function (f) { return f.ferment_days; }),
        dry_days: d3.mean(list.filter(function (f) { return f.days_in_dry != null; }), function (f) { return f.days_in_dry; }) });
    }
    function groups(by, key, only) {
      var m = d3.group(only ? done.filter(only) : done, key);
      if (m.size < 2) return; // nothing to compare yet
      Array.from(m.keys()).sort().forEach(function (k) { add(by, k, m.get(k)); });
    }
    if (on('new_ferment', 'plan')) groups('Plan', function (f) { return f.plan || 'Not set'; }); // 2.3.0: only for what the company still records
    // Shape only for ferments whose moves and unload were logged, so a gap in the records doesn't look like a schedule.
    groups('Shape', function (f) { return f.boxes + ' boxes, ' + f.ferment_days + (f.ferment_days === 1 ? ' day' : ' days'); },
      function (f) { return f.boxes > 1 && f.ferment_days != null; });
    if (on('new_ferment', 'juice')) groups('Juice', function (f) { return f.juiced ? 'Juiced' : 'Not juiced'; });
    card.hidden = !rows.length;
    if (!rows.length) return;
    // the picked ferment: its own line first, and a mark on each group it belongs to
    if (pf) rows.unshift({ by: 'This ferment', group: pf.id, me: true, n: 1, yield_pct: pf.yield_pct, days: pf.ferment_days, dry_days: pf.days_in_dry });
    table($('compare'), [
      { h: 'Compared by', k: 'by', nw: 1 },
      { h: 'Group', fill: 1, f: function (r) { return r.has ? el('span', {}, [r.group + ' ', UI.pill('info', 'Includes ' + pf.id)]) : r.group; } }, { h: 'Ferments', k: 'n', n: 1, sort: 'num' },
      { h: 'Yield', k: 'yield_pct', n: 1, sort: 'num', v: function (r) { return r.yield_pct; }, f: function (r) { return pct(r.yield_pct); } },
      { h: 'Avg days fermenting', k: 'days', n: 1, sort: 'num', v: function (r) { return r.days; }, f: function (r) { return r.days != null ? fmt1(r.days) : ''; } },
      { h: 'Avg days to dry', k: 'dry_days', n: 1, sort: 'num', v: function (r) { return r.dry_days; }, f: function (r) { return r.dry_days != null ? fmt1(r.dry_days) : ''; } },
    ], rows, { label: 'Compare ferments', attrs: function (r) { return r.me ? { 'class': 'is-me' } : r.has ? { 'class': 'has-me' } : pf ? { 'class': 'not-me' } : {}; } });
  }

  /** What the other dashboard files (dash-roast.js, dash-making.js, dash-tasting.js) are handed. */
  function helpers() {
    return { el: el, axisStyle: axisStyle, tipFor: tipFor, showTip: showTip, short: short, fmt: fmt, fmt1: fmt1, season: function () { return curSeason; }, pick: function (id) { if (view === 'season') select(id); else pick(id); }, on: on, showCard: showCard,
      stat: stat, noChart: noChart, chartIn: chartIn, chartW: chartW, hrefOf: function (id) { return offered('ferments') ? hrefOf(id) : ''; } };
  }

  /* ---------- wiring ---------- */
  /*
   * App 1.25.0: Home leads with "Where the beans are" on a laptop or tablet, where it is one compact row, and with "Needs
   * attention" on a phone, where the same strip is nine rows and would push the things to do far down. The sections are moved
   * in the page itself (not with CSS order), so what a screen reader reads and where Tab goes always match what is seen.
   */
  function homeOrder() {
    var a = $('attn-sec'), s = $('stock-card');
    if (!a || !s || a.parentNode !== s.parentNode) return;
    var wide = !window.matchMedia || window.matchMedia('(min-width: 768px)').matches;
    if (wide && s.nextElementSibling !== a) a.parentNode.insertBefore(s, a);
    else if (!wide && a.nextElementSibling !== s) a.parentNode.insertBefore(a, s);
  }
  homeOrder();
  if (window.matchMedia) { var mqHome = window.matchMedia('(min-width: 768px)'); if (mqHome.addEventListener) mqHome.addEventListener('change', homeOrder); else if (mqHome.addListener) mqHome.addListener(homeOrder); }
  VIEWS.forEach(function (v) {
    $('tab-' + v).addEventListener('click', function () { rec = null; picked = null; stageSel = null; showView(v); });
    $('tab-' + v).addEventListener('keydown', function (ev) {
      var vs = VIEWS.filter(function (x) { return x !== 'now' && offered(x); }), i = vs.indexOf(v), to = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : null;
      if (to === null || to < 0 || to >= vs.length) return;
      ev.preventDefault(); rec = null; picked = null; showView(vs[to]); $('tab-' + vs[to]).focus();
    });
  });
  // The address says where to start: a view, or one ferment (#ferments/2.13). Roasting and Making wait until the data shows there is something.
  var start = readAddress(location.hash);
  var wantRoasting = !!start && start.view === 'roasting', wantMaking = !!start && start.view === 'making', wantBatches = !!start && start.view === 'batches';
  if (start && !wantRoasting && !wantMaking && !wantBatches) { rec = start.rec; picked = start.pick; stageSel = start.stage || null; if (rec || picked) sel = rec || picked; showView(start.view, true); if (start.pick) picked = start.pick; }
  window.addEventListener('hashchange', route);
  $('season').addEventListener('change', function () { curSeason = $('season').value; sel = null; if (picked) { picked = null; showView('season'); } else draw(); });
  // Esc on Season goes back to the whole season (not while typing, or inside a menu or panel that Esc closes)
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || ev.defaultPrevented || view !== 'season' || !picked) return;
    var t = ev.target;
    if (t && t.closest && t.closest('input, select, textarea, details[open], .infotip, [role="dialog"], [role="menu"]')) return;
    select(null);
  });
  $('refresh').addEventListener('click', fetchData);
  $('connect-signin').addEventListener('click', function () {
    if (window.CH_SIGNIN) CH_SIGNIN.open(); else location.href = 'signin.html?next=dashboard.html';
  });
  $('connect-btn').addEventListener('click', function () {
    if (readConnect($('connect-link').value)) fetchData(); else { $('connect-link').value = ''; badLinkNote(); }
  });
  var resizeT, lastW = window.innerWidth;
  window.addEventListener('resize', function () { // charts are sized from their box; a phone's address bar sliding away (height only) is not a reason to draw again
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth; clearTimeout(resizeT); resizeT = setTimeout(draw, 200);
  });
  // 2.4.6 review: only a copy from this server, and one with money only for an admin or the key that fetched it
  function keptCopy() { return CONF.keptCopy ? CONF.keptCopy('ch.dash', settings.url, settings.key, !!settings.admin) : null; }
  var cached = settings.url ? keptCopy() : null;
  if (cached) use(cached, true);
  else if (settings.url && settings.key) { $('attn-wait').replaceChildren(UI.skeleton('lines', 2)); $('flow-wait').replaceChildren(UI.skeleton('strip', 6)); } // the shape of what is coming, only when there is no copy to draw
  fetchData();
})();
