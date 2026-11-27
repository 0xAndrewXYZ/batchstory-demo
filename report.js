/*
 * Season report (2.2.0): a print-ready summary of one season, laid out like the dashboard's "Where the beans came from",
 * for the end of the year. The browser's Print → Save as PDF makes the PDF. Admins and people marked "Can see money" only:
 * the Sheet leaves prices and payments out for everyone else (`money: false`), and then this page shows nothing but a note.
 * The data comes from the same read as the dashboard (a POST, so no key is ever in a web address). The numbers are worked
 * out by report-model.js. Every name and amount is put on the page as text, never as markup.
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {}, R = window.CH_REPORT;
  var $ = function (id) { return document.getElementById(id); };
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
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
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* ---------- connection: an admin's sign-in or admin link, else this browser's setup link (as the dashboard) ---------- */
  var settings = load('ch.settings', {}) || {};
  var adminLink = load('ch.admin', null);
  if (adminLink && adminLink.url && adminLink.key) settings = { url: adminLink.url, key: adminLink.key, admin: true };
  var badLinkSeen = false;
  function goodUrl(u) { return C.goodScriptUrl ? C.goodScriptUrl(u) : /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '')); }
  /** A personal link opened on this page (#connect=…), as on the dashboard: kept only if it points at our server. */
  function readConnect(text) {
    var m = String(text || '').match(/#connect=([A-Za-z0-9_\-=]+)/);
    if (!m) return false;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); })));
      if (!j.url || !j.key) return false;
      if (!goodUrl(j.url)) { badLinkSeen = true; return false; }
      var s = load('ch.settings', {}) || {};
      s.url = j.url; s.key = j.key; save('ch.settings', s);
      if (!settings.admin) { settings.url = j.url; settings.key = j.key; }
      return true;
    } catch (e) { return false; }
  }
  if (readConnect(location.hash) || /#connect=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); // the link leaves the address bar

  /* ---------- formatting ---------- */
  var CUR = 'XCD'; // the money columns are named (XCD), as on the dashboard
  function n0(v) { return v == null ? '' : Math.round(v).toLocaleString('en-US'); }
  function n1(v) { return v == null ? '' : (Math.round(v * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }); }
  function lbs(v) { return v == null ? '' : (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }); }
  function m2(v) { return v == null ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) { return v == null ? '' : (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayText(iso, withYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? +m[3] + ' ' + MONTHS[+m[2] - 1] + (withYear === false ? '' : ' ' + m[1]) : String(iso || '');
  }
  function todayText() { var d = new Date(); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function dash() { return el('span', { className: 'rpt-none', text: '–', title: 'Nothing recorded' }); }
  function cell(v, cls) { var td = el('td', { className: cls || '' }); if (v === '' || v === null || v === undefined) td.appendChild(dash()); else td.textContent = v; return td; }

  /* ---------- the page ---------- */
  var D = null, B = null, season = null, farmsOff = {}; // farmsOff: farms the person unticked for the statements

  function company() { return (C.brand && C.brand.company) || C.company || 'Cocoahead'; }

  function header(title, sub) {
    var logo = el('img', { src: 'icons/cocoahead-64.png', alt: '', width: '40', height: '40', 'data-brand-logo': '' }); // the company's own logo replaces it (config.js)
    var head = el('div', { className: 'rpt-head' }, [
      el('div', { className: 'rpt-brand' }, [logo, el('span', { className: 'rpt-company', 'data-brand': 'company', text: company() })]),
      el('div', { className: 'rpt-title' }, [el('h2', { text: title }), el('p', { text: sub })]),
    ]);
    return head;
  }
  function seasonWords() { return B.season === 'all' ? 'All seasons' : 'Season ' + B.season; }
  function rangeText() {
    var t = B.totals;
    if (!t.first_date) return '';
    return t.first_date === t.last_date ? dayText(t.first_date) : dayText(t.first_date) + ' to ' + dayText(t.last_date);
  }

  function table(cols, rows, foot) {
    var head = el('tr', {}, cols.map(function (c) { return el('th', { className: c.n ? 'n' : '', scope: 'col', text: c.h }); }));
    var body = el('tbody', {}, rows.map(function (r) {
      return el('tr', {}, cols.map(function (c) { return cell(c.f(r), (c.n ? 'n ' : '') + (c.cls || '')); }));
    }));
    var kids = [el('thead', {}, [head]), body];
    if (foot) kids.push(el('tfoot', {}, [el('tr', {}, cols.map(function (c, i) { return el('td', { className: (c.n ? 'n ' : '') + 'rpt-total', text: foot[i] }); }))]));
    return el('div', { className: 'table-wrap rpt-wrap' }, [el('table', { className: 'rpt-table' }, kids)]);
  }
  function tile(label, value, note, unit) {
    var v = el('span', { className: 'rpt-tile-v' }, [value === '' ? dash() : document.createTextNode(value), value !== '' && unit ? el('small', { text: ' ' + unit }) : null]);
    return el('div', { className: 'rpt-tile' }, [el('span', { className: 'rpt-tile-l', text: label }), v, el('span', { className: 'rpt-tile-n', text: note || '' })]);
  }

  function summary() {
    var t = B.totals;
    var sec = el('section', { className: 'rpt-section rpt-summary', 'aria-labelledby': 'rpt-h1' });
    var head = header('Season report', seasonWords() + (rangeText() ? ' · ' + rangeText() : '') + ' · Generated ' + todayText());
    head.querySelector('h2').id = 'rpt-h1';
    sec.appendChild(head);
    sec.appendChild(el('div', { className: 'rpt-tiles' }, [
      tile('Ferments', String(t.ferments), t.finished + ' finished' + (t.in_progress ? ', ' + t.in_progress + ' in progress' : '')),
      tile('Wet beans in', n0(t.wet), 'finished ferments', 'lbs'),
      tile('Dry beans out', n0(t.dry), 'finished ferments', 'lbs'),
      tile('Yield', pct(t.yield_pct), 'dry ÷ wet'),
      tile('Lost in drying', t.finished ? n0(t.lost) : '', t.lost_pct != null ? pct(t.lost_pct) + ' of the wet weight' : '', t.finished ? 'lbs' : ''),
      tile('Total paid', m2(t.paid), 'for ' + t.deliveries + ' deliveries', CUR),
      tile('Average price', t.avg_price != null ? m2(t.avg_price) : '', 'per wet lb, paid deliveries', t.avg_price != null ? CUR : ''),
      tile('Cost per dry lb', t.cost_per_dry != null ? m2(t.cost_per_dry) : '', 'finished ferments, paid deliveries', t.cost_per_dry != null ? CUR : ''),
    ]));
    var j = t.juice; // P1-D: one total per unit, only when juice was taken
    if (j && j.ferments) {
      var jn = function (v) { return v.toLocaleString(undefined, { maximumFractionDigits: 1 }); };
      var jt = [j.lbs != null ? jn(j.lbs) + ' lbs' : '', j.litres != null ? jn(j.litres) + ' L' : '', j.gallons != null ? jn(j.gallons) + ' gal' : ''].filter(Boolean).join(' · ');
      sec.appendChild(el('p', { className: 'rpt-juice' }, [el('span', { className: 'rpt-juice-l', text: 'Juice taken' }), el('b', { className: 'rpt-juice-v', text: jt }), el('span', { className: 'rpt-juice-n', text: 'from ' + j.ferments + (j.ferments === 1 ? ' ferment' : ' ferments') })]));
    }
    sec.appendChild(el('h3', { className: 'rpt-sub', text: 'Wet in, dry out, ferment by ferment' }));
    var fs = B.ferments;
    var tw = fs.filter(function (f) { return f.finished; });
    sec.appendChild(table([
      { h: 'Ferment', f: function (f) { return f.id; }, cls: 'id' },
      { h: 'Loaded', f: function (f) { return f.load_date ? dayText(f.load_date, false) : ''; }, cls: 'nw' },
      { h: 'Wet lbs', n: 1, f: function (f) { return f.wet != null ? lbs(f.wet) : ''; } },
      { h: 'Dry lbs', n: 1, f: function (f) { return f.dry != null ? lbs(f.dry) : ''; } },
      { h: 'Lost lbs', n: 1, f: function (f) { return f.finished ? lbs(f.wet - f.dry) : ''; } },
      { h: 'Yield', n: 1, f: function (f) { return f.finished ? pct(f.yield_pct) : ''; } },
      { h: 'Paid (' + CUR + ')', n: 1, f: function (f) { return f.paid ? m2(f.paid) : ''; } },
    ], fs, ['Finished ferments', '', n0(t.wet), n0(t.dry), n0(t.lost), pct(t.yield_pct), m2(t.paid)]));
    var notes = el('div', { className: 'rpt-notes' }, [
      el('p', { text: 'Wet, dry and yield count finished ferments only (a ferment with a dry weight). ' + (t.in_progress ? t.in_progress + ' not finished yet, so their wet weight is not in those totals. ' : '') + 'The totals row adds up the finished ferments; paid is every delivery in the season.' }),
      el('p', { text: 'Average price is the amount paid divided by the wet lbs of the deliveries that have an amount. Cost per dry lb divides what was paid for the finished ferments’ paid deliveries by their estimated dry lbs (each delivery gets its share of its ferment’s dry weight).' }),
    ]);
    sec.appendChild(notes);
    return sec;
  }

  function farmsSection() {
    var t = B.totals;
    var sec = el('section', { className: 'rpt-section rpt-farms', 'aria-labelledby': 'rpt-h2' });
    var head = header('Where the beans came from', seasonWords() + ' · by farm');
    head.querySelector('h2').id = 'rpt-h2';
    sec.appendChild(head);
    sec.appendChild(table([
      { h: 'Farm', f: function (f) { return f.farm; }, cls: 'rpt-farm' },
      { h: 'Deliveries', n: 1, f: function (f) { return String(f.deliveries); } },
      { h: 'Wet lbs', n: 1, f: function (f) { return lbs(f.wet); } },
      { h: 'Share', n: 1, f: function (f) { return pct(f.share); } },
      { h: 'Est. dry lbs', n: 1, f: function (f) { return f.dry ? n0(f.dry) : ''; } },
      { h: 'Paid (' + CUR + ')', n: 1, f: function (f) { return f.paid ? m2(f.paid) : ''; } },
      { h: 'Avg price / lb', n: 1, f: function (f) { return f.avg_price != null ? m2(f.avg_price) : ''; } },
    ], B.farms, ['Total', String(t.deliveries), lbs(t.delivered_lbs), t.delivered_lbs ? '100.0%' : '', t.dry ? n0(t.dry) : '', m2(t.paid), t.avg_price != null ? m2(t.avg_price) : '']));
    sec.appendChild(el('div', { className: 'rpt-notes' }, [
      el('p', { text: 'Wet lbs are what was delivered. Share is each farm’s part of all wet lbs delivered. Est. dry lbs splits each ferment’s dry weight by wet weight, so every farm in a ferment gets that ferment’s yield. Average price is paid divided by the wet lbs of the deliveries that have an amount; own beans with no amount are not counted in it.' }),
    ]));
    if (B.payees_differ) {
      sec.appendChild(el('h3', { className: 'rpt-sub', text: 'Who was paid' }));
      sec.appendChild(table([
        { h: 'Paid to', f: function (p) { return p.payee; }, cls: 'rpt-farm' },
        { h: 'For beans from', f: function (p) { return p.farms.join(', '); } },
        { h: 'Deliveries', n: 1, f: function (p) { return String(p.deliveries); } },
        { h: 'Wet lbs', n: 1, f: function (p) { return lbs(p.wet); } },
        { h: 'Paid (' + CUR + ')', n: 1, f: function (p) { return p.paid ? m2(p.paid) : ''; } },
        { h: 'Avg price / lb', n: 1, f: function (p) { return p.avg_price != null ? m2(p.avg_price) : ''; } },
      ], B.payees));
    }
    return sec;
  }

  function statement(s) {
    var sec = el('section', { className: 'rpt-section rpt-statement' });
    var head = header('Statement for ' + s.farm, seasonWords() + ' · ' + todayText());
    sec.appendChild(head);
    sec.appendChild(el('div', { className: 'rpt-tiles two' }, [
      tile('Taken from your farm', lbs(s.lbs), s.deliveries + (s.deliveries === 1 ? ' delivery' : ' deliveries') + ', wet weight', 'lbs'),
      tile('Total paid', s.paid ? m2(s.paid) : '', s.paid ? 'for these deliveries' : 'no amount recorded', s.paid ? CUR : ''),
    ]));
    var cols = [
      { h: 'Date', f: function (r) { return dayText(r.date); }, cls: 'nw' },
      { h: 'Ferment', f: function (r) { return r.ferment; }, cls: 'id' },
      { h: 'Wet lbs', n: 1, f: function (r) { return r.lbs != null ? lbs(r.lbs) : ''; } },
      { h: 'Price / lb', n: 1, f: function (r) { return r.price != null ? m2(r.price) : ''; } },
      { h: 'Amount (' + CUR + ')', n: 1, f: function (r) { return r.paid != null ? m2(r.paid) : ''; } },
    ];
    var foot = ['Total', '', lbs(s.lbs), '', s.paid ? m2(s.paid) : ''];
    if (s.show_paid_to) { cols.splice(2, 0, { h: 'Paid to', f: function (r) { return r.paid_to; } }); foot.splice(2, 0, ''); }
    sec.appendChild(table(cols, s.rows, foot));
    sec.appendChild(el('div', { className: 'rpt-notes' }, [el('p', { text: 'Weights are wet pounds as delivered. Amounts are in ' + CUR + '.' })]));
    return sec;
  }

  function draw() {
    if (!D) return;
    B = R.build(D.tabs, { season: season });
    var sheet = $('sheet');
    var kids = [summary(), farmsSection()];
    var wantStatements = $('with-statements').checked;
    var picks = B.statements;
    drawFarmPicks(picks, wantStatements);
    if (wantStatements) picks.filter(function (s) { return !farmsOff[s.farm]; }).forEach(function (s) { kids.push(statement(s)); });
    sheet.replaceChildren.apply(sheet, kids);
    if (window.CH_ADMIN && CH_ADMIN.fill) CH_ADMIN.fill(sheet); // the company's own name and logo in each page header
    document.title = company() + ' ' + seasonWords().toLowerCase() + ' report';
    $('empty').hidden = !!B.ferments.length;
    $('sheet').hidden = !B.ferments.length;
    $('print').disabled = !B.ferments.length;
  }

  function drawFarmPicks(picks, on) {
    var box = $('farm-picks');
    box.hidden = !on || !picks.length;
    var list = $('farm-list');
    list.replaceChildren.apply(list, picks.map(function (s, i) {
      var id = 'fp-' + i;
      var cb = el('input', { type: 'checkbox', id: id });
      cb.checked = !farmsOff[s.farm];
      cb.addEventListener('change', function () { if (cb.checked) delete farmsOff[s.farm]; else farmsOff[s.farm] = true; draw(); });
      return el('label', { className: 'check', 'for': id }, [cb, el('span', { text: s.farm })]);
    }));
  }

  function use(p) {
    D = { tabs: p.tabs || {}, money: p.money !== false, current: String(p.current_season || ''), at: p.at };
    $('connect').hidden = true; $('problem').hidden = true;
    $('no-money').hidden = D.money;
    if (window.CH_ADMIN && CH_ADMIN.navRole) CH_ADMIN.navRole(D.money); // P3-A: the Finances link
    $('tools').hidden = !D.money;
    if (!D.money) { $('sheet').hidden = true; $('empty').hidden = true; $('updated').textContent = ''; return; }
    var list = R.seasons(D.tabs);
    var want = new URLSearchParams(location.search).get('season');
    if (!season || (season !== 'all' && list.indexOf(season) < 0)) season = (want && (want === 'all' || list.indexOf(want) >= 0)) ? want : (list.indexOf(D.current) >= 0 ? D.current : list[0] || 'all');
    var sel = $('season');
    sel.replaceChildren.apply(sel, list.map(function (s) { return new Option('Season ' + s, s); }).concat([new Option('All seasons', 'all')]));
    sel.value = season;
    $('updated').textContent = 'Updated ' + new Date(p.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    draw();
  }

  function fetchData() {
    if (!settings.url || !settings.key) { $('connect').hidden = false; $('sheet').hidden = true; $('tools').hidden = true; return; }
    // 2.7.1: the dashboard's copy in this browser (keptCopy's rules) at once, then the fresh read with its "nothing changed" stamp
    var have = C.keptCopy ? C.keptCopy('ch.dash', settings.url, settings.key, !!settings.admin) : null;
    if (have && have.tabs && !D) { try { use(have); } catch (e0) { /* the fresh answer draws it */ } }
    if (window.CH_ADMIN && CH_ADMIN.updated) CH_ADMIN.updated($('updated'), have && have.tabs ? have.at : null, true); else $('updated').textContent = 'Loading…';
    var read = function (since) { return C.read(settings.url, settings.key, 'data', since).then(function (r) { return r.json(); }); };
    read(have && C.sinceOf ? C.sinceOf(have) : null).then(function (p) {
      if (!p || p.unchanged !== true) return p;
      return (C.withCopy ? C.withCopy(p, have) : null) || read(null);
    }).then(function (p) {
      if (settings.admin && window.CH_SIGNIN) return CH_SIGNIN.guard(p);
      return p;
    }).then(function (p) {
      if (p.suspended) throw new Error(p.error || 'This company is paused.');
      if (!p.ok) throw new Error(p.error || 'The Sheet refused the request.');
      if (C.keepCopy && p.tabs) C.keepCopy('ch.dash', p, settings.url, settings.key);
      use(p);
    }).catch(function (err) {
      if (window.CH_ADMIN && CH_ADMIN.updated) CH_ADMIN.updated($('updated'), null, false); else $('updated').textContent = '';
      $('problem').hidden = false;
      $('problem-text').textContent = badLinkSeen ? 'That link does not belong to this app, so it was not used. Ask for a new one.' : 'Could not load the data (' + (err.message || err) + '). Check the internet connection and press Refresh.';
    });
  }

  /* ---------- paper size and printing ---------- */
  var paperStyle = el('style', { id: 'paper-style' });
  document.head.appendChild(paperStyle);
  function setPaper(p) {
    p = p === 'A4' ? 'A4' : 'Letter';
    paperStyle.textContent = '@page { size: ' + p + '; margin: 0.6in 0.65in 0.7in; }';
    document.body.setAttribute('data-paper', p);
    $('paper').value = p;
    save('ch.reportPaper', p);
  }

  $('season').addEventListener('change', function () { season = $('season').value; draw(); });
  $('with-statements').addEventListener('change', draw);
  $('paper').addEventListener('change', function () { setPaper($('paper').value); });
  $('print').addEventListener('click', function () { window.print(); });
  $('refresh').addEventListener('click', fetchData);
  $('connect-signin').addEventListener('click', function () { if (window.CH_SIGNIN) CH_SIGNIN.open(); else location.href = 'signin.html?next=report.html'; });
  setPaper(load('ch.reportPaper', 'Letter'));
  fetchData();
})();
