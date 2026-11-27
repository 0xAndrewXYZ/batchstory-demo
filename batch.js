/*
 * Batch page: one ferment's history, for scanning the QR code on a bag (batch.html?f=2.8), or one package's (batch.html?p=2.8-R1-P1:
 * the package, its roast and winnowing, then the ferment's history). These two addresses are printed on labels: keep them working.
 * A package page also shows how it arrived in Walpole (smell, taste, look, weight) and which batches used it, and offers
 * "Check this package in" (the phone's camera is the scanner: the label's code opens this page). batch.html?c=W26-001 is one
 * chocolate batch's story (app 1.19.0): the product and its tasting notes, the making, each package's arrival, each roast, each
 * ferment's fermentation and drying, and the farms, on one page. Package and ferment pages end with the batches they went into.
 * Shows where the beans came from, how they fermented and dried. Never shows prices or payments.
 * Works on any device connected with a link (an invite's, or the old setup link); with no signal it shows the last copy on the device.
 */
(function () {
  'use strict';
  var P = window.CH_PAGE, el = P.el;
  var $ = function (id) { return document.getElementById(id); };
  if (P.readConnect(location.hash) || P.badLink) history.replaceState(null, '', location.pathname + location.search);
  var qs = new URLSearchParams(location.search);
  var pid = (qs.get('p') || '').trim(); // a package's code (batch.html?p=3.4-R2-P1); the bag's code is ?f=
  var cid = (qs.get('c') || '').trim(); // a Walpole batch's code (batch.html?c=W26-001)
  var id = (qs.get('f') || '').trim() || (pid ? P.fermentOfId(pid) : '');

  function show(kids) { $('main').replaceChildren.apply($('main'), kids.filter(Boolean)); }

  /*
   * app 1.19.3: someone signed in to the admin site (or holding an admin link) reads this page inside the admin pages' sidebar,
   * so opening a batch from the dashboard does not feel like leaving it. Everyone else (a label's QR code, a worker's phone)
   * keeps the plain page above, untouched.
   *  - The sidebar is not copied into batch.html: it is read from dashboard.html, so it is always the same one. Like every
   *    admin file that page is never kept by the service worker, so with no signal this simply does nothing.
   *  - Tidiness only. What this page may read is decided by Code.gs from the key it sends, exactly as before, and it
   *    still never asks for or shows money.
   */
  (function adminShell() {
    var a = null;
    try { a = JSON.parse(localStorage.getItem('ch.admin') || 'null'); } catch (e) { a = null; }
    if (!a || !a.key || a.unconfirmed || !window.fetch || !window.DOMParser) return; // an admin link still being checked is not one yet
    fetch('dashboard.html').then(function (r) { if (!r.ok) throw new Error('no shell'); return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html'); // parsed, never run
      var skip = doc.querySelector('a.skip-link'), bar = doc.querySelector('header.appbar'), tabs = doc.querySelector('nav.tabbar');
      var old = document.querySelector('header.appbar');
      if (!skip || !bar || !tabs || !bar.querySelector('#side-nav') || !old) return;
      skip = document.importNode(skip, true); bar = document.importNode(bar, true); tabs = document.importNode(tabs, true);
      skip.setAttribute('href', '#main');
      var here = cid ? 'batches' : pid ? 'roasting' : 'ferments'; // where this record lives in the sidebar
      [].forEach.call(bar.querySelectorAll('a[data-nav]'), function (l) { if (l.getAttribute('data-nav') === here) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current'); });
      [].forEach.call(tabs.querySelectorAll('[data-bar]'), function (t) { if (t.getAttribute('data-bar') === 'production') t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
      old.replaceWith(bar);
      document.body.insertBefore(skip, bar);
      bar.parentNode.insertBefore(tabs, bar.nextSibling);
      $('main').setAttribute('tabindex', '-1'); // the skip link lands here
      document.body.classList.add('shell');
      var C = window.CH_CONFIG || {};
      if (C.applyBrand) C.applyBrand(bar);
      // the shell's own behaviour (Menu and More, the account menu, the optional links): the admin pages' scripts, fetched fresh
      var files = ['icons.js', 'admin.js', 'signin.js'];
      (function next() {
        var f = files.shift();
        if (!f) { var cur = bar.querySelector('a[data-nav="' + here + '"]'); if (cur) cur.hidden = false; return; } // this record exists, so its list does
        var sc = document.createElement('script'); sc.src = f; sc.onload = next; document.body.appendChild(sc);
      })();
    }).catch(function () { /* no signal, or an older site: the plain page stays */ });
  })();

  function facts(rows) {
    return el('dl', { className: 'facts' }, rows.filter(function (r) { return r[1] !== '' && r[1] != null; }).map(function (r) {
      return el('div', { className: r[2] ? 'wide' : '' }, [el('dt', { text: r[0] }), el('dd', r[1] && r[1].nodeType ? {} : { text: String(r[1]) }, r[1] && r[1].nodeType ? [r[1]] : [])]);
    }));
  }
  /**
   * Slice B: a pallet's ID as a button that opens "Also on pallet S26-03 (24)" right where it is: the same table as the dashboard and the
   * field app (CH_PAGE.palletTable), this package marked "this one". Read only; drawn from data.tabs, so it also works from the last copy.
   * A <details>: the keyboard and screen readers get it for free. The table is only built when it is first opened.
   */
  var palletTabs = null; // data.tabs of the page being drawn
  function palletInline(sid, here) {
    sid = String(sid || '');
    if (!sid) return '';
    var d = el('details', { className: 'pallet-more', 'data-pallet': sid });
    d.appendChild(el('summary', { className: 'pallet-link', 'aria-label': 'Packages on pallet ' + sid, text: sid + ' \u203A' }));
    d.addEventListener('toggle', function () {
      if (!d.open || d.querySelector('.pallet-contents')) return;
      var view = null;
      try { view = M && palletTabs ? M.palletContentsFromTabs(palletTabs, sid) : null; } catch (e) { view = null; } // a problem hides the table, never the page
      d.appendChild(el('h3', { className: 'pallet-h', text: 'Also on pallet ' + sid + (view && view.n ? ' (' + view.n + ')' : '') }));
      d.appendChild(P.palletTable(view, { here: here, href: function (pid) { return 'batch.html?p=' + encodeURIComponent(pid); }, empty: 'No packages on this pallet in the records.' }));
    });
    return d;
  }

  /**
   * Design plan, slice 5: the charts are drawn at about the width they are shown at (a phone, or the 860px page on a laptop), so
   * their text is 12px everywhere. Before, one 640-wide drawing was stretched, and its labels grew with it on a laptop.
   */
  /** A chart's spoken name is set as text on the finished drawing, never written into its markup: the markup is built from numbers only. */
  function named(fig, label) { var svg = label ? fig.querySelector('svg') : null; if (svg) svg.setAttribute('aria-label', label); return fig; }
  function chartWidth() { return Math.max(280, Math.min(780, (document.documentElement.clientWidth || 640) - 72)); }

  function tempChart(checks, o) { // o (the story's small charts, one per ferment on the same scales): {w, h, small, days {lo, hi}, label}
    var pts = checks.filter(function (c) { return c.day != null && (c.centre != null || c.top != null); });
    if (!pts.length) return null;
    o = o || {};
    var W = o.w || chartWidth(), H = o.h || 220, m = { l: o.small ? 32 : 36, r: 12, t: 12, b: 26 };
    // the axis starts at the first day with a reading (model.js dayAxis): day 0 is shown only when something was read on day 0
    var ax = o.days || window.CH_MODEL.dayAxis(pts.map(function (c) { return c.day; })), minDay = ax.lo, maxDay = ax.hi, span = maxDay - minDay;
    var x = function (d) { return m.l + (d - minDay) / span * (W - m.l - m.r); };
    var y = function (t) { return H - m.b - (Math.max(20, Math.min(60, t)) - 20) / 40 * (H - m.t - m.b); };
    var line = function (k) {
      var p = pts.filter(function (c) { return c[k] != null; });
      return p.length ? '<polyline fill="none" stroke-width="2.5" class="l-' + k + '" points="' + p.map(function (c) { return x(c.day).toFixed(1) + ',' + y(c[k]).toFixed(1); }).join(' ') + '"/>' +
        p.map(function (c) { return '<circle r="3.5" class="l-' + k + '" cx="' + x(c.day).toFixed(1) + '" cy="' + y(c[k]).toFixed(1) + '"/>'; }).join('') : '';
    };
    var grid = [20, 30, 40, 50, 60].map(function (t) {
      return '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text class="ax" x="' + (m.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + t + '°</text>';
    }).join('');
    var days = '';
    var dstep = Math.max(1, Math.ceil(32 / ((W - m.l - m.r) / span))); // every day while there is room for the numbers, else every second or third
    for (var d = minDay; d <= maxDay; d += dstep) days += '<text class="ax" x="' + x(d) + '" y="' + (H - 8) + '" text-anchor="middle">' + (d === minDay ? 'Day ' + d : d) + '</text>';
    return named(el('figure', { className: 'chart' }, [
      el('div', { html: '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Temperatures by day since loading">' + grid + days + line('top') + line('centre') + '</svg>' }),
      o.small ? null : el('figcaption', {}, [el('span', { className: 'key centre', text: 'Centre' }), el('span', { className: 'key top', text: 'Top' }), ' average of the readings at each check, °C, by day since loading']),
    ]), o.label);
  }

  function table(head, rows) {
    if (!rows.length) return null;
    return el('div', { className: 'table-wrap' }, [el('table', { className: 'table' }, [
      el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', { className: h.n ? 'n' : '', text: h.h }); }))]),
      el('tbody', {}, rows.map(function (r) { return el('tr', {}, head.map(function (h) { var v = h.f(r); return el('td', { className: h.n ? 'n' : '', text: v == null ? '' : String(v) }); })); })),
    ])]);
  }


  /* ---------- Moisture by day (2.4.0): the Drying check's readings, one line, money-free ---------- */
  var bandLow = null; // the Sheet's target_moisture_low (older scripts send none: then the target line alone, as before)
  function moistureChart(curve, o) { // o (the story's small charts, one per ferment on the same scales): {w, h, small, days {lo, hi}, top, label}
    if (!curve || !curve.has) return null;
    o = o || {};
    var pts = curve.points, target = curve.target;
    var W = o.w || chartWidth(), H = o.h || 220, m = { l: o.small ? 32 : 36, r: 14, t: 14, b: 26 };
    var ax = o.days || window.CH_MODEL.dayAxis(pts.map(function (q) { return q.day; })), minDay = ax.lo, maxDay = ax.hi, span = maxDay - minDay; // from the first day with a reading
    // 2.4.2: the scale stops at 100% whatever the readings say (model.js leaves out readings outside 0 to 100), and the grid has a few lines at most
    var top = Math.ceil(Math.max.apply(null, pts.map(function (q) { return q.moisture; }).concat([target, o.top || 0])) / 10) * 10;
    top = isFinite(top) ? Math.min(100, Math.max(10, top)) : 100;
    var gstep = Math.max(10, Math.ceil(top / 5 / 10) * 10); // about a fifth of the scale, in whole tens: six lines at most
    var x = function (d) { return m.l + (d - minDay) / span * (W - m.l - m.r); };
    var y = function (v) { return H - m.b - Math.max(0, Math.min(top, v)) / top * (H - m.t - m.b); };
    var grid = '';
    for (var g = 0; g <= top; g += gstep) grid += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(g) + '" y2="' + y(g) + '"/><text class="ax" x="' + (m.l - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + g + '%</text>';
    var days = '';
    var step = Math.max(span > 14 ? Math.ceil(span / 10) : 1, Math.ceil(32 / ((W - m.l - m.r) / span)));
    for (var d = minDay; d <= maxDay; d += step) days += '<text class="ax" x="' + x(d) + '" y="' + (H - 8) + '" text-anchor="middle">' + (d === minDay ? 'Day ' + d : d) + '</text>';
    var line = '<polyline fill="none" stroke-width="2.5" class="l-moist" points="' + pts.map(function (q) { return x(q.day).toFixed(1) + ',' + y(q.moisture).toFixed(1); }).join(' ') + '"/>';
    var dots = pts.map(function (q) {
      return q.final ? '<circle r="6.5" class="l-final" cx="' + x(q.day).toFixed(1) + '" cy="' + y(q.moisture).toFixed(1) + '"/>' : '<circle r="3.5" class="l-moist" cx="' + x(q.day).toFixed(1) + '" cy="' + y(q.moisture).toFixed(1) + '"/>';
    }).join('');
    var band = window.CH_MODEL.targetBand(bandLow, target); // P1-C: a 6-8% band, shaded, when the script sent its lower end
    var shade = band.has_band ? '<rect class="band" x="' + m.l + '" y="' + y(band.high) + '" width="' + (W - m.r - m.l) + '" height="' + Math.max(0, y(band.low) - y(band.high)) + '"/>' : '';
    var tline = shade + '<line class="target" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(target) + '" y2="' + y(target) + '"/><text class="ax" x="' + (m.l + 8) + '" y="' + (y(target) - 6) + '">' + (band.has_band ? 'Target ' + band.text : 'target ' + target + '%') + '</text>';
    var fin = curve.final ? ' The ringed point is the final moisture, ' + curve.final.moisture + '%.' : '';
    var reached = curve.days_to_target != null ? ' Reached ' + target + '% on day ' + curve.days_to_target + '.' : '';
    return named(el('figure', { className: 'chart moisture' }, [
      el('div', { html: '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Moisture by day of drying">' + grid + days + tline + line + dots + '</svg>' }),
      o.small ? null : el('figcaption', {}, [el('span', { className: 'key moist', text: 'Moisture' }), ' average of the readings each day, % by day of drying, counted from unloading.' + fin + reached]),
    ]), o.label);
  }

  /* ---------- Tasting notes (2.4.0): on every history page; flagged ones stand out ---------- */
  var M = window.CH_MODEL;
  function noteCard(n, opts) {
    var link = !n.here && !n.orphan && M ? M.tastingLink(opts.tabs, n) : '';
    var about = n.here ? null : (link ? el('a', { href: link, text: n.about }) : el('span', { text: n.about + (n.orphan ? ' (no longer in the records)' : '') }));
    return el('li', { className: 'tnote' + (n.off ? ' off' : '') + (n.orphan ? ' orphan' : '') }, [
      el('div', { className: 'tnote-head' }, [
        el('strong', { text: P.long(n.date) || 'No date' }),
        n.sample ? el('span', { className: 'sub', text: n.sample }) : null,
        n.score != null ? el('span', { className: 'badge info', text: P.fmt(n.score, 1) + ' / 10' }) : null,
        n.off ? el('span', { className: 'badge bad', text: 'Something off' }) : null,
        about,
        n.by ? el('span', { className: 'sub', text: 'by ' + n.by }) : null,
      ]),
      n.flavours.length ? el('p', { className: 'chips-row' }, n.flavours.map(function (w) { return el('span', { className: 'badge tasting', text: w }); })) : null,
      n.notes ? el('p', { className: 'quote', text: '“' + n.notes + '”' }) : null,
    ]);
  }
  /** The "Tasting notes" section of a history page (kind: Ferment, Package or Batch), with the button that opens the form pre-filled. */
  function tastingCard(data, kind, ref) {
    if (!M) return null;
    var tabs = data.tabs || {};
    var notes = M.tastingTrail(tabs, kind, ref);
    var r = P.role(), may = r && r !== 'viewer';
    var key = kind.toLowerCase();
    var qs2 = 'kind=' + kind + '&' + key + '=' + encodeURIComponent(ref);
    var go = may ? el('a', { className: 'btn btn-primary', id: 'add-tasting', href: 'index.html#/form/tasting_note?' + qs2, text: 'Add a tasting note' }) : null;
    return el('section', { className: 'card tasting', id: 'tasting' }, [
      el('h2', { text: 'Tasting notes' }),
      notes.length ? el('ul', { className: 'tnotes' }, notes.map(function (n) { return noteCard(n, { tabs: tabs }); })) : el('p', { className: 'sub', text: 'No tasting notes yet.' }),
      go,
    ]);
  }

  var f1 = function (v) { return v == null ? '' : P.fmt(v, 1); };
  var batchNames = function (p) { return (p.uses || []).map(function (u) { return u.batch; }).filter(function (b, i, a) { return a.indexOf(b) === i; }).join(', '); };
  /** Where a package is now, most advanced step first: used in a batch, checked in, shipped, packed. */
  function where(p) {
    var used = p.uses || [];
    if (used.length) return (used.some(function (u) { return u.emptied; }) ? 'Used up in batch ' : 'Used in batch ') + batchNames(p);
    if (p.arrival) return 'Checked in' + (p.arrival.date ? ' ' + P.long(p.arrival.date) : '') + (p.arrival.problems.length ? ' · ' + p.arrival.problems.join(', ').toLowerCase() + ' not OK' : '');
    return p.shipment ? 'Shipped' + (p.ship_date ? ' ' + P.long(p.ship_date) : '') : 'Packed' + (p.pack_date ? ' ' + P.long(p.pack_date) : '');
  }
  function packageRows(list) {
    return table([
      { h: 'Package', f: function (p) { return p.id; } }, { h: 'Contents', f: function (p) { return p.contents; } }, { h: 'Type', f: function (p) { return p.type; } },
      { h: 'Lbs', n: 1, f: function (p) { return f1(p.lbs); } }, { h: 'Where it is', f: where },
    ].concat(list.some(function (p) { return p.arrival; }) ? [
      { h: 'Arrived lbs', n: 1, f: function (p) { return p.arrival && p.arrival.lbs != null ? f1(p.arrival.lbs) : ''; } },
      { h: 'Smell · taste · look', f: function (p) { return p.arrival ? p.arrival.checks.map(function (c) { return c.word || '–'; }).join(' · ') : ''; } },
    ] : []), list);
  }

  /** What happened to the package in Walpole: how it arrived, and the batches that used it. */
  function arrivalCard(v, p) {
    var a = v.arrival, r = P.role();
    var C = window.CH_CONFIG || {};
    var may = (r === 'walpole' || r === 'admin') && (!C.areaOn || C.areaOn('making')); // the same people who may send the Check in form (2.3.0: while Making is on)
    var go = may ? el('a', { className: 'btn btn-primary', id: 'check-in', href: 'index.html#/form/arrival?package=' + encodeURIComponent(pid), text: 'Check this package in' }) : null;
    if (!a) return el('section', { className: 'card', id: 'arrival' }, [el('h2', { text: 'Arrival check' }), el('p', { className: 'sub', text: 'Not checked in yet.' }), go]);
    var chip = function (c) { return el('span', { className: 'badge ' + (c.ok === false ? 'bad' : c.ok ? 'ok' : 'info'), text: c.what + ': ' + (c.word || 'not checked') }); };
    var change = a.change_lbs == null ? '' : (a.change_lbs > 0 ? '+' : '') + f1(a.change_lbs) + ' lbs' + (a.change_pct != null ? ' (' + (a.change_pct > 0 ? '+' : '') + a.change_pct + '%)' : '') + (p.lbs != null ? ' from ' + f1(p.lbs) + ' lbs packed' : '');
    return el('section', { className: 'card', id: 'arrival' }, [
      el('h2', { text: 'Arrival check' }),
      el('p', { className: 'chips-row' }, a.checks.map(chip)),
      facts([['Checked in', P.long(a.date)], ['Weight on arrival', a.lbs != null ? f1(a.lbs) + ' lbs' : ''], ['Change in weight', change]]),
      a.notes ? el('p', { className: 'quote', text: '“' + a.notes + '”' }) : null,
    ]);
  }
  function usedCard(v) {
    var u = v.uses || [];
    if (!u.length && !v.arrival) return null;
    return el('section', { className: 'card', id: 'used' }, [
      el('h2', { text: 'Used in' }),
      u.length ? table([
        { h: 'Batch', f: function (x) { return x.batch; } }, { h: 'Made for', f: function (x) { return x.destination; } }, { h: 'Started', f: function (x) { return P.short(x.date); } },
        { h: 'Lbs used', n: 1, f: function (x) { return f1(x.lbs); } }, { h: 'Package emptied', f: function (x) { return x.emptied ? 'Yes' : ''; } },
      ], u) : el('p', { className: 'sub', text: 'Not used in a batch yet.' }),
    ]);
  }
  function stateOf(v, p) {
    if (v.uses && v.uses.length) return v.uses.some(function (x) { return x.emptied; }) ? ['info', 'Used up'] : ['info', 'In use'];
    if (v.arrival) return v.arrival.problems.length ? ['warn', 'Checked in · check'] : ['ok', 'Checked in'];
    return p.shipment ? ['ok', 'Shipped'] : ['info', 'Packed'];
  }

  /** Roasting, winnowing, packing and shipping for this ferment. Never prices or payments. */
  function roastingCard(b) {
    if (!b.roasts.length) return el('section', { className: 'card later' }, [el('h2', { text: 'Roasting, packing and shipping' }), el('p', { className: 'sub', text: 'Not roasted yet.' })]);
    var m = function (v) { return v == null ? '' : v + ' min'; };
    var all = [];
    b.roasts.forEach(function (r) { all = all.concat(r.packages); });
    return el('section', { className: 'card', id: 'roasting' }, [
      el('h2', { text: 'Roasting and winnowing' }),
      table([
        // P2-A: a roast made with other ferments' beans says so, and how much of it was this ferment's
        { h: 'Roast', f: function (r) { return r.id + (r.mixed && b.id ? ' (with ' + r.ferments.filter(function (x) { return x !== b.id; }).join(', ') + ')' : ''); } }, { h: 'Date', f: function (r) { return P.short(r.date); } },
        { h: 'Beans in', n: 1, f: function (r) { return r.beans_in == null ? '' : r.mixed && b.id ? f1(r.from_lbs) + ' of ' + f1(r.beans_in) + ' lbs' : f1(r.beans_in) + ' lbs'; } },
        { h: 'To start temp', n: 1, f: function (r) { return m(r.mins_to_start); } }, { h: 'To max temp', n: 1, f: function (r) { return m(r.mins_to_max); } },
        { h: 'Max °C', n: 1, f: function (r) { return r.max_temp; } }, { h: 'Cooling', n: 1, f: function (r) { return m(r.cooling_min); } },
        { h: 'Nibs', n: 1, f: function (r) { return r.nib_lbs != null ? f1(r.nib_lbs) + ' lbs' : 'Not winnowed yet'; } },
        { h: 'Shells', n: 1, f: function (r) { return r.shell_lbs != null ? f1(r.shell_lbs) + ' lbs' : ''; } },
        { h: 'Nib yield', n: 1, f: function (r) { return r.nib_yield != null ? r.nib_yield + '%' : ''; } },
        { h: 'Lost', n: 1, f: function (r) { return r.loss_lbs != null ? f1(r.loss_lbs) + ' lbs · ' + r.loss_pct + '%' : ''; } },
        { h: 'Loads', n: 1, f: function (r) { return r.loads; } },
        { h: 'Notes', f: function (r) { return [r.plan, r.log_ref ? 'Log: ' + r.log_ref : '', r.notes, r.winnow_notes].filter(Boolean).join(' · '); } },
      ], b.roasts),
      el('h2', { className: 'sub-h', text: 'Packages' }),
      packageRows(all) || el('p', { className: 'sub', text: 'Nothing packed yet.' }),
    ]);
  }

  function renderPackage(data, stale) {
    bandLow = data.target_moisture_low; palletTabs = data.tabs || null;
    var v = P.packageView(data, pid);
    var b = P.batch(data, v && v.ferment ? v.ferment : id); // the package's own record first; the ferment read from the ID only if it is not there
    var banner = stale ? el('p', { className: 'notice warn', text: 'No connection: showing the copy saved on this device, from ' + new Date(data.at).toLocaleString() + '.' }) : null;
    if (!v) {
      show([banner, el('h1', { text: 'Package ' + pid }),
        el('p', { className: 'notice warn', text: 'This package is not in the records on this phone yet.' + (b ? ' Showing ferment ' + id + '.' : '') + ' If it was packed just now, connect to the internet and scan again.' })].concat(b ? bodyCards(b, data) : []));
      return;
    }
    var p = v.pkg || { id: pid, contents: '', lbs: null, type: '', pack_date: '', shipment: '', ship_date: '' };
    var r = v.roast;
    // P2-A: a package of a roast made from several ferments: every one is named ("3.4, 3.5"), the farms are worked out over all of them by
    // each ferment's share of the roast, and the full history below is the first ferment's (each has its own page)
    var many = (v.ferments || []).length > 1, others = many ? v.ferments.slice(1).map(function (f) { return P.batch(data, f); }) : [];
    var shares = many ? (P.roastLines(data.tabs || {})[p.roast || (r && r.id) || ''] || []) : [];
    show([banner,
      el('div', { className: 'head' }, [
        el('div', {}, [el('p', { className: 'eyebrow', text: 'Package · batch history' }), el('h1', { text: 'Package ' + pid })]),
        el('span', { className: 'badge ' + stateOf(v, p)[0], text: stateOf(v, p)[1] }),
      ]),
      v.arrival ? null : arrivalCard(v, p), // not checked in yet: the button comes first, it is why the label was scanned
      summaryCard(b, r, p, v, many ? [b].concat(others) : null, shares),
      v.arrival ? arrivalCard(v, p) : null,
      usedCard(v),
      madeIntoCard(data, 'Package', pid),
      tastingCard(data, 'Package', pid),
      el('h2', { className: 'sub-h', text: 'Details' }),
      el('section', { className: 'card' }, [
        el('h2', { text: 'This package' }),
        facts([['Contents', p.contents], ['Net weight', p.lbs != null ? f1(p.lbs) + ' lbs' : ''], ['Type', p.type], ['Package', v.siblings ? v.place + ' of ' + v.siblings + (/^shells?$/i.test(p.contents) ? ' (shells)' : '') : ''],
          ['Packed', P.long(p.pack_date)], ['Shipped', P.long(p.ship_date)], ['Shipment', palletInline(p.shipment, pid), true], ['Checked in', P.long(v.arrival && v.arrival.date)], [many ? 'Ferments' : 'Ferment', (v.ferments || []).join(', ') || v.ferment], ['Roast', r ? r.id : ''],
          ['Roasted', r ? P.long(r.date) : ''], ['Winnowed', r ? P.long(r.winnow_date) : ''], ['Roast max temp', r && r.max_temp != null ? r.max_temp + ' °C' : ''], ['Nib yield', r && r.nib_yield != null ? r.nib_yield + '%' : '']]),
        p.notes ? el('p', { className: 'quote', text: '“' + p.notes + '”' }) : null,
      ]),
      r ? el('section', { className: 'card' }, [el('h2', { text: 'Its roast' }), roastingTable(r)]) : null,
      b ? el('h2', { className: 'sub-h', text: 'Full history of ferment ' + b.id }) : null,
      b && many ? el('p', { className: 'sub', id: 'other-ferments' }, ['This roast also took beans from '].concat([].concat.apply([], v.ferments.slice(1).map(function (f, i) {
        return [i ? ', ' : '', el('a', { href: 'batch.html?f=' + encodeURIComponent(f), text: 'ferment ' + f })];
      })), ['. Each has its own page.'])) : null,
    ].concat(b ? bodyCards(b, data) : []));
    document.title = 'Package ' + pid + ' · ' + ((window.CH_CONFIG || {}).company || 'Cocoahead');
  }
  /** The front of a package page: farms first, then the roast, the weight, fermentation and drying. Details follow underneath. */
  function summaryCard(b, r, p, v, all, shares) {
    var farmLbs = Object.create(null);
    if (b) b.farms.forEach(function (i) { farmLbs[i.farm] = (farmLbs[i.farm] || 0) + (i.lbs || 0); });
    var farms = Object.keys(farmLbs).sort(function (a, c) { return farmLbs[c] - farmLbs[a]; }).map(function (k) { return k + (b.wet ? ' (' + Math.round(farmLbs[k] / b.wet * 100) + '%)' : ''); }).join(', ');
    if (all) { // P2-A, a mixed roast: each farm's share of the wet beans in each ferment, times that ferment's share of the roast
      var pct = Object.create(null);
      all.forEach(function (x) {
        if (!x || !x.wet) return;
        var sh = shares.filter(function (l) { return l.ferment === x.id; }).reduce(function (t, l) { return t + l.share; }, 0);
        x.farms.forEach(function (i) { pct[i.farm] = (pct[i.farm] || 0) + sh * (i.lbs || 0) / x.wet; });
      });
      farms = Object.keys(pct).sort(function (a, c) { return pct[c] - pct[a]; }).map(function (k) { return k + ' (' + Math.round(pct[k] * 100) + '%)'; }).join(', ');
    }
    return el('section', { className: 'card summary' }, [
      el('h2', { text: 'Package summary' }),
      facts([
        ['Farms', farms || 'Not recorded', 1],
        ['Roast max temperature', r && r.max_temp != null ? r.max_temp + ' °C' : ''],
        ['Time to max temperature', r && r.mins_to_max != null ? r.mins_to_max + ' min' : ''],
        ['Cooling', r && r.cooling_min != null ? r.cooling_min + ' min' : ''],
        ['Package weight', p.lbs != null ? f1(p.lbs) + ' lbs ' + (p.contents || '').toLowerCase() : ''],
        ['Roast and winnow loss', r && r.loss_pct != null ? r.loss_pct + '% (' + f1(r.loss_lbs) + ' of ' + f1(r.beans_in) + ' lbs)' : ''],
        ['Days fermenting', b && !all ? b.ferment_days : ''], ['Days drying', b && !all ? b.drying_days : ''], ['Final moisture', b && !all && b.moisture != null ? b.moisture + '%' : ''], // one ferment's figures only (a mixed roast: on each ferment's page)
        ['Ferments', all ? (v.ferments || []).join(', ') : ''],
        ['Where it is now', v && (v.arrival || (v.uses && v.uses.length)) ? where(p) : ''],
      ]),
    ]);
  }
  function roastingTable(r) { return roastingCard({ roasts: [r] }).children[1]; }

  function fermentNodes(b, data, stale) {
    var farmLbs = Object.create(null);
    b.farms.forEach(function (i) { farmLbs[i.farm] = (farmLbs[i.farm] || 0) + (i.lbs || 0); });
    return [
      stale ? el('p', { className: 'notice warn', text: 'No connection: showing the copy saved on this device, from ' + new Date(data.at).toLocaleString() + '.' }) : null,
      el('div', { className: 'head' }, [
        el('div', {}, [el('p', { className: 'eyebrow', text: 'Season ' + b.season + ' · batch history' }), el('h1', { text: 'Ferment ' + b.id })]),
        el('span', { className: 'badge ' + (b.stage === 'Bagged' ? 'ok' : 'info'), text: b.stage }),
      ]),
      el('section', { className: 'card' }, [
        el('h2', { text: 'At a glance' }),
        facts([
          ['Loaded', P.long(b.load_date)], ['Unloaded', P.long(b.unload_date)], ['Days fermenting', b.ferment_days], ['Peak centre', b.peak != null ? f1(b.peak) + ' °C' : ''],
          ['Wet beans', b.wet != null ? P.fmt(b.wet) + ' lbs' : ''], ['Dry beans', b.dry != null ? P.fmt(b.dry) + ' lbs' : ''], ['Yield', b.yield != null ? b.yield + '%' : ''],
          ['Days drying', b.drying_days], ['Final moisture', b.moisture != null ? b.moisture + '%' : ''], ['Bagged', P.long(b.bagged)],
          ['Bags', b.bags != null ? b.bags + (b.labels ? ' · marked ' + b.labels : '') : ''], ['Station', b.station], ['Box', b.box], ['Brix', b.brix], ['Additions', b.additions],
        ]),
        b.notes ? el('p', { className: 'quote', text: '“' + b.notes + '”' }) : null,
      ]),
      el('section', { className: 'card' }, [
        el('h2', { text: 'Where the beans came from' }),
        Object.keys(farmLbs).length ? el('ul', { className: 'farms' }, Object.keys(farmLbs).sort(function (a, c) { return farmLbs[c] - farmLbs[a]; }).map(function (k) {
          return el('li', {}, [el('span', { text: k }), el('span', { className: 'n', text: P.fmt(farmLbs[k]) + ' lbs wet' + (b.wet ? ' · ' + Math.round(farmLbs[k] / b.wet * 100) + '%' : '') })]);
        })) : el('p', { className: 'sub', text: 'No deliveries recorded.' }),
      ]),
      el('section', { className: 'card' }, [
        el('h2', { text: 'Fermentation' }),
        tempChart(b.checks) || el('p', { className: 'sub', text: 'No temperatures recorded yet.' }),
        table([
          { h: 'Date', f: function (r) { return P.short(r.date); } }, { h: 'Day', n: 1, f: function (r) { return r.day; } },
          { h: 'Stage', f: function (r) { return r.stage === 'Turn' ? (r.turn ? 'Into box ' + (r.turn + 1) : 'Next box') : r.stage; } },
          { h: 'Centre °C', n: 1, f: function (r) { return f1(r.centre); } }, { h: 'Top °C', n: 1, f: function (r) { return f1(r.top); } },
          { h: 'Colour', f: function (r) { return r.colour; } }, { h: 'Smell', f: function (r) { return r.smell; } }, { h: 'Cut test', f: function (r) { return r.cut; } },
          { h: 'Notes', f: function (r) { return [r.problems ? 'Problems: ' + r.problems : '', r.added ? 'Added: ' + r.added : '', r.notes].filter(Boolean).join(' · '); } },
        ], b.checks),
      ]),
      el('section', { className: 'card' }, [
        el('h2', { text: 'Drying' }),
        moistureChart(M ? M.moistureCurve(data.tabs || {}, b.id, data.target_moisture) : null),
        table([
          { h: 'Date', f: function (r) { return P.short(r.date); } }, { h: 'Where', f: function (r) { return r.location; } }, { h: 'Weather', f: function (r) { return r.weather; } },
          b.drying.some(function (r) { return r.tent_temp != null || r.tent_humidity != null; }) ? { h: 'Tent', f: function (r) { return [r.tent_temp != null ? r.tent_temp + ' °C' : '', r.tent_humidity != null ? r.tent_humidity + '% humidity' : ''].filter(Boolean).join(' · '); } } : null, // 1.30.0: only when a reading was taken
          { h: 'Outside', f: function (r) { return r.outside_state || (r.outside != null ? r.outside + '% dry' : ''); } }, { h: 'Inside', f: function (r) { return r.inside; } },
          { h: 'Moisture', n: 1, f: function (r) { return r.moisture != null ? r.moisture + '%' : ''; } }, { h: 'Mold or bloom', f: function (r) { return r.mold; } },
          { h: 'Notes', f: function (r) { return [r.treatment, r.note].filter(Boolean).join(' · '); } },
        ].filter(Boolean), b.drying) || el('p', { className: 'sub', text: 'No drying notes yet.' }),
      ]),
      roastingCard(b),
    ];
  }
  /* ---------- The tree-to-bar story (app 1.19.0): batch.html?c=W26-001 ----------
   * One page for one chocolate batch, read as a timeline: the product and its tasting notes, how the chocolate was made, how each
   * package arrived, each roast, each ferment (fermentation and drying), and the farms. It starts at the bar and works back to the
   * farm, because the question it answers starts at the bar ("why does this one taste like this?"); "Farm first" turns it round.
   * Everything is worked out by model.js batchStory() from the copy of the records this page already has: no price or payment is read.
   */
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); };
  var dash = function () { return el('span', { className: 'none', title: 'Nothing recorded yet', text: '–' }); };
  var lbsOf = function (v) { return v == null ? '' : f1(v) + ' lbs'; };
  var degC = function (v) { return v == null ? '' : f1(v) + ' °C'; };
  // An ID as part of an anchor: letters, digits, dots and hyphens as they are, anything else by its code ("2.1 a" and "2.1/a" stay apart)
  var anchor = function (kind, id) { return kind + '-' + String(id).replace(/[^A-Za-z0-9.-]/g, function (ch) { return '_' + ch.charCodeAt(0).toString(16) + '_'; }); };
  /** "Nov 3, 2026", or "Nov 3 – Nov 12, 2026" (the year once when it is the same). */
  function span(a, b) {
    if (!a || !b || a === b) return P.long(a || b);
    return (a.slice(0, 4) === b.slice(0, 4) ? P.short(a) : P.long(a)) + ' – ' + P.long(b);
  }
  function storyOrder() { return P.load('ch.story.order', 'bar') === 'farm' ? 'farm' : 'bar'; }

  /** One tasting note as a row: the score first, then when, what and who, the flavour words, and what was written. */
  function storyNote(n) {
    return el('li', { className: 'tnote' + (n.off ? ' off' : '') + (n.orphan ? ' orphan' : '') }, [
      el('div', { className: 'tn-score' }, n.score != null ? [el('strong', { text: P.fmt(n.score, 1) }), el('small', { text: ' / 10' })] : [dash(), el('span', { className: 'sr-only', text: 'No score' })]),
      el('div', { className: 'tn-body' }, [
        el('p', { className: 'tn-meta' }, [
          el('strong', { text: P.long(n.date) || 'No date' }),
          n.sample ? el('span', { text: n.sample }) : null,
          n.by ? el('span', { text: 'by ' + n.by }) : null,
          n.off ? el('span', { className: 'badge bad', text: 'Something off' }) : null,
          n.orphan ? el('span', { text: '(about one no longer in the records)' }) : null,
        ]),
        n.flavours.length ? el('p', { className: 'tn-words', text: n.flavours.join(' · ') }) : null,
        n.notes ? el('p', { className: 'quote', text: '“' + n.notes + '”' }) : null,
      ]),
    ]);
  }
  function storyNotes(notes, title) {
    if (!notes.length) return null;
    return el('div', { className: 'st-notes' }, [title ? el('h4', { text: title }) : null, el('ul', { className: 'tnotes' }, notes.map(storyNote))]);
  }
  function storyTable(cls, head, rows) {
    if (!rows.length) return null;
    return el('div', { className: 'tablebox' }, [el('div', { className: 'table-wrap' }, [el('table', { className: 'table ' + cls }, [
      el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', { className: h.n ? 'n' : '', scope: 'col', text: h.h }); }))]),
      el('tbody', {}, rows.map(function (r) {
        return el('tr', {}, head.map(function (h, i) {
          var v = h.f(r), td = el(i === 0 ? 'th' : 'td', { className: [h.n ? 'n' : '', h.w ? 'w' : ''].filter(Boolean).join(' '), scope: i === 0 ? 'row' : null, 'data-label': h.h });
          if (v instanceof Node) td.appendChild(v); else if (v == null || v === '') td.appendChild(dash()); else td.textContent = String(v);
          return td;
        }));
      })),
    ])])]);
  }
  function stat(label, value, unit, note) {
    var blank = value == null || value === '';
    return el('li', {}, [
      el('span', { className: 'stat-l', text: label }),
      el('span', { className: 'stat-v' + (blank ? ' none' : '') }, blank ? ['–'] : [String(value), unit ? el('small', { text: unit }) : null]),
      note ? el('span', { className: 'stat-n', text: note }) : null,
    ]);
  }
  /** One place where the work happens (app 1.19.1): a bounded band with its name, what happens there and when. */
  function place(id, title, dot, sub, when, kids) {
    return el('section', { className: 'st-place', id: id, 'aria-labelledby': id + '-h' }, [
      el('header', { className: 'st-place-head' }, [
        el('h2', { id: id + '-h' }, [el('i', { className: 'st-dot ' + dot, 'aria-hidden': 'true' }), title]),
        el('span', { className: 'st-place-sub', text: sub }),
        when ? el('span', { className: 'st-when', text: when }) : null,
      ]),
      el('div', { className: 'st-place-body' }, kids),
    ]);
  }
  function section(id, title, when, kids) {
    return el('section', { className: 'st-sec', id: id, 'aria-labelledby': id + '-h' }, [
      el('div', { className: 'st-sec-head' }, [el('h3', { id: id + '-h', text: title }), when ? el('span', { className: 'st-when', text: when }) : null]),
    ].concat(kids));
  }
  function item(id, title, kids) { return el('article', { className: 'st-item', id: id }, [el('h4', { text: title })].concat(kids)); }

  /**
   * The columns of the story: one per ferment, largest share of the nibs first, each with its own roasts and its packages in this
   * batch. Every table of the story uses these same columns, so one ferment reads straight down the page: how its package arrived,
   * its roast, its drying, its fermentation, its farms.
   */
  function columnsOf(s) {
    return s.ferments.map(function (f) {
      return { f: f, roasts: s.roasts.filter(function (r) { return f.roasts.indexOf(r.id) >= 0; }), packs: s.packages.filter(function (p) { return p.ferments.indexOf(f.id) >= 0; }) }; // P2-A: a mixed roast and its packages are under each of its ferments
    });
  }
  /** The width one column's chart is shown at, so its text stays near 12px: the whole table on a phone, one column of it on a laptop. */
  function colChartW(n) {
    var vw = document.documentElement.clientWidth || 640, w = Math.min(vw, 1120) - 32;
    if (vw >= 1024) w -= 208; // the "jump to" list beside the story
    w -= vw > 640 ? 34 : 2; // the band's border and padding
    if (vw <= 640) return Math.round(Math.max(200, Math.min(560, w - 100 - 18)));
    if (n === 1) return Math.round(Math.max(200, Math.min(520, Math.min(w, vw >= 900 ? 736 : 640) - (vw >= 760 ? 176 : 120) - 24))); // one ferment: its chart has the line to itself
    w = Math.min(w, n === 2 ? 880 : w);
    return Math.round(Math.max(120, Math.min(520, (w - (vw >= 760 ? 176 : 120)) / n - 24)));
  }
  /**
   * A table with one column per ferment. lines: {grp: 'heading'} starts a group; {key, label, of: 'ferment' | 'roast' | 'pack', f}
   * is one line (f gives text or a node for one ferment, roast or package; a ferment with two roasts shows both, one under the
   * other); {chart: true, label, legend, f} is a line of small charts. A line with nothing in any column is left out, and so is a
   * group with no lines. marks: the figures "What stands out" names, by line, kind and ID.
   */
  function matrix(id, caption, cols, head, lines, marks) {
    var blank = function (v) { return v == null || v === ''; };
    var cells = lines.map(function (l) {
      if (l.grp) return null;
      return cols.map(function (c) {
        if (l.chart) return [{ v: l.f(c.f) }];
        var list = l.of === 'roast' ? c.roasts : l.of === 'pack' ? c.packs : [c.f];
        return list.map(function (x) { return { v: l.f(x, c), id: x.id }; }).filter(function (x) { return !blank(x.v); });
      });
    });
    var keep = lines.map(function (l, i) { return l.grp ? null : cells[i].some(function (c) { return c.length; }); });
    lines.forEach(function (l, i) { if (!l.grp) return; var any = false; for (var j = i + 1; j < lines.length && !lines[j].grp; j++) any = any || keep[j]; keep[i] = any; });
    var n = cols.length;
    var body = lines.map(function (l, i) {
      if (!keep[i]) return null;
      if (l.grp) return el('tr', { className: 'st-grp' }, [el('th', { colSpan: n + 1, scope: 'colgroup', text: l.grp })]);
      return el('tr', { className: l.chart ? 'st-chartrow' : (l.wrap ? 'st-wraprow' : ''), id: l.key ? 'row-' + l.key : null }, [
        el('th', { scope: 'row' }, [el('span', { text: l.label }), l.legend || null]),
      ].concat(l.chart ? [chartCell(cols, cells[i])] : cols.map(function (c, k) {
        var td = el('td', {});
        if (!cells[i][k].length) { td.appendChild(dash()); return td; }
        cells[i][k].forEach(function (x) {
          var m = marks && l.key && !l.chart ? marks[l.key + '|' + (l.of || 'ferment') + '|' + x.id] : null;
          var v = el('span', { className: 'st-v' + (m ? ' st-mark' : '') });
          if (x.v instanceof Node) v.appendChild(x.v); else v.textContent = String(x.v);
          if (m) v.appendChild(el('span', { className: 'st-arrow', title: m.hi ? 'Highest in this batch' : 'Lowest in this batch' }, [el('span', { 'aria-hidden': 'true', text: m.hi ? ' ▲' : ' ▼' }), el('span', { className: 'sr-only', text: m.hi ? ' (highest in this batch)' : ' (lowest in this batch)' })]));
          td.appendChild(v);
        });
        return td;
      })));
    });
    // a line of charts is one cell across every column, laid out as the columns are; on a phone the charts go one under the other, each named
    function chartCell(cols, list) {
      var box = el('div', { className: 'st-charts' }, cols.map(function (c, k) {
        var d = el('div', { 'data-label': 'Ferment ' + c.f.id }), v = list[k].length ? list[k][0].v : '';
        if (v instanceof Node) d.appendChild(v); else d.appendChild(dash());
        return d;
      }));
      box.style.setProperty('--n', String(cols.length));
      return el('td', { colSpan: cols.length, className: 'st-chartcell' }, [box]);
    }
    return el('div', { className: 'tablebox st-mxbox st-n' + Math.min(n, 4), id: id }, [el('div', { className: 'table-wrap' }, [el('table', { className: 'table st-mx' }, [
      el('caption', { className: 'sr-only', text: caption }),
      el('colgroup', {}, [el('col', { className: 'st-c0' })].concat(cols.map(function () { return el('col'); }))),
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, [el('span', { className: 'sr-only', text: 'What' })])].concat(cols.map(function (c) { return el('th', { scope: 'col' }, head(c)); })))]),
      el('tbody', {}, body),
    ])])]);
  }
  /** The heading of one column: the ferment (a link to its own column at the farm, or the anchor itself there), then one more line. */
  function colHead(c, here, sub) {
    var name = here ? el('strong', { id: anchor('ferment', c.f.id), className: 'st-anchor', text: 'Ferment ' + c.f.id }) : el('a', { href: '#' + anchor('ferment', c.f.id) }, [el('strong', { text: 'Ferment ' + c.f.id })]);
    return [name].concat(sub.filter(Boolean).map(function (x) { return x instanceof Node ? x : el('small', { text: x }); }));
  }

  function productSection(s) {
    var b = s.batch, r = P.role(), may = r && r !== 'viewer';
    var flags = s.flags.map(function (f) {
      if (f.kind === 'arrival') return el('li', {}, [el('span', { className: 'badge warn', text: 'Arrival' }), el('a', { href: '#arrival', text: 'Package ' + f.ref + ' arrived with ' + f.problems.join(', ').toLowerCase() + ' not OK' })]);
      var where = f.where === 'Batch' ? 'this batch' : f.where.toLowerCase() + ' ' + f.ref;
      // where the note is shown: the batch's own notes, the ferment's notes, or the roast's (a package's note sits with its roast; with no roast known, its line under Arrival)
      var roastOf = f.where === 'Roast' ? f.ref : f.where === 'Package' ? (s.packages.filter(function (p) { return p.id === f.ref; })[0] || {}).roast || '' : '';
      var to = f.where === 'Batch' ? '#tasting' : f.where === 'Ferment' ? '#' + anchor('notes-ferment', f.ref) : roastOf ? '#' + anchor('notes-roast', roastOf) : '#arrival';
      return el('li', {}, [el('span', { className: 'badge bad', text: 'Something off' }), el('a', { href: to, text: 'A tasting note about ' + where + (f.date ? ', ' + P.long(f.date) : '') })]);
    });
    return section('product', 'The product', b.finished ? 'Finished ' + P.long(b.finish_date) : 'Not finished yet', [
      facts([['Made for', b.destination], ['Recipe', b.recipe], ['Bars or pieces', b.output_units], ['What came out', lbsOf(b.output_lbs)]]),
      flags.length ? el('div', { className: 'st-flagbox', id: 'flags' }, [el('h4', { text: 'Worth a look' }), el('ul', { className: 'st-flags' }, flags)]) : null,
      el('div', { className: 'st-notes', id: 'tasting' }, [
        el('h4', { text: 'Tasting notes about this batch' }),
        s.notes.length ? el('ul', { className: 'tnotes' }, s.notes.map(storyNote)) : el('p', { className: 'sub', text: 'No tasting notes about this batch yet.' }),
        may ? el('a', { className: 'btn btn-secondary btn-sm no-print', id: 'add-tasting', href: 'index.html#/form/tasting_note?kind=Batch&batch=' + encodeURIComponent(s.id), text: 'Add a tasting note' }) : null,
      ]),
    ]);
  }
  function makingSection(s) {
    var b = s.batch, hrs = function (v) { return v == null ? '' : v + ' h'; }, deg = function (v) { return v == null ? '' : v + ' ' + b.temp_unit; };
    var rows = [['Started', P.long(b.start_date)], ['Finished', P.long(b.finish_date)], ['Nibs in', lbsOf(b.nib_lbs)]].concat(b.shell_lbs ? [['Shells in', lbsOf(b.shell_lbs)]] : []);
    if (b.chocolate) rows = rows.concat([['Sugar', lbsOf(b.sugar)], ['Cocoa butter added', lbsOf(b.butter)], ['Nibs : sugar', b.ratio], ['Target fineness', b.target_micron != null ? b.target_micron + ' microns' : ''],
      ['Time to reach the target', hrs(b.hours_to_target)], ['Fineness reached', b.final_micron != null ? b.final_micron + ' microns' : ''], ['Conching time', hrs(b.conche_hours)], ['Conching temperature', deg(b.conche_temp)]]);
    else rows.push(['Grinder or press temperature', deg(b.process_temp)]);
    rows = rows.concat([['Anything else added', b.other ? b.other + (b.other_lbs != null ? ' · ' + f1(b.other_lbs) + ' lbs' : '') : ''],
      ['What came out', lbsOf(b.output_lbs)], ['Output as a share of what went in', b.out_pct != null ? b.out_pct + '%' : '']]);
    return section('making', b.chocolate ? 'Chocolate making' : 'Making', span(b.start_date, b.finish_date), [
      facts(rows),
      b.notes ? el('p', { className: 'quote', text: '“' + b.notes + '”' }) : null,
      b.finish_notes ? el('p', { className: 'quote', text: '“' + b.finish_notes + '”' }) : null,
      b.finished ? null : el('p', { className: 'sub', text: 'Not finished yet.' }),
    ]);
  }
  var packLink = function (p) { return el('a', { href: 'batch.html?p=' + encodeURIComponent(p.id), text: p.id }); };
  var changeOf = function (p) { return p.change_lbs == null ? '' : (p.change_lbs > 0 ? '+' : '') + f1(p.change_lbs) + ' lbs' + (p.change_pct != null ? ' (' + (p.change_pct > 0 ? '+' : '') + p.change_pct + '%)' : ''); };
  var checkedIn = function (p) { return p.arrival ? P.long(p.arrival.date) || 'Yes' : el('span', { className: 'st-miss', text: p.found ? 'Not checked in' : 'Not in the records' }); };
  function arrivalWords(p) {
    if (!p.arrival) return '';
    var a = p.arrival, w = [['Smell', a.smell], ['Taste', a.taste], ['Look', a.look]].filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ');
    return w ? el('span', {}, [a.problems.length ? el('span', { className: 'badge warn', text: 'Not OK' }) : null, ' ' + w]) : '';
  }
  function arrivalSection(s, cols) {
    var inCol = function (p) { return cols.some(function (c) { return c.packs.indexOf(p) >= 0; }); };
    var others = s.packages.filter(function (p) { return !inCol(p); }).concat(s.shell_packages);
    var all = s.packages.concat(s.shell_packages), dates = all.map(function (p) { return p.arrival ? p.arrival.date : ''; }).filter(Boolean).sort();
    return section('arrival', 'Arrival', span(dates[0], dates[dates.length - 1]), [
      cols.length ? matrix('mx-arrival', 'How each ferment\'s package arrived', cols, function (c) { return colHead(c, false, [c.f.pct != null ? c.f.pct + '% of the nibs' : '']); }, [
        { label: 'Package', of: 'pack', f: packLink },
        { label: 'Used in this batch', of: 'pack', f: function (p) { return lbsOf(p.used_lbs) + (p.emptied ? ' · emptied' : ''); } },
        { label: 'Checked in', of: 'pack', f: checkedIn },
        { label: 'Packed', of: 'pack', f: function (p) { return lbsOf(p.lbs); } },
        { label: 'Arrived', of: 'pack', f: function (p) { return p.arrival ? lbsOf(p.arrival.lbs) : ''; } },
        { label: 'Change', of: 'pack', f: changeOf },
        { label: 'Smell, taste, look', of: 'pack', wrap: 1, f: arrivalWords },
        { label: 'Notes', of: 'pack', wrap: 1, f: function (p) { return p.arrival ? p.arrival.notes : ''; } },
        { key: 'score', label: 'Tasted before making', f: function (f) { return f.score && f.score.avg != null ? P.fmt(f.score.avg, 1) + ' / 10' : ''; } },
      ]) : null,
      cols.some(function (c) { return c.f.score && c.f.score.avg != null; }) ? el('p', { className: 'sub st-cap', text: '"Tasted before making" is the average of the notes about the ferment, its roast and its packages in this batch.' }) : null,
      others.length ? el('h4', { text: cols.length ? (others.every(function (p) { return p.shells; }) ? 'Shells' : 'Other packages') : 'Packages' }) : null,
      storyTable('st-stack', [
        { h: 'Package', f: function (p) { return el('span', {}, [packLink(p), p.shells ? ' (shells)' : '']); } },
        { h: 'Used here', n: 1, f: function (p) { return lbsOf(p.used_lbs) + (p.emptied ? ' · emptied' : ''); } },
        { h: 'Checked in', f: checkedIn },
        { h: 'Packed', n: 1, f: function (p) { return lbsOf(p.lbs); } },
        { h: 'Arrived', n: 1, f: function (p) { return p.arrival ? lbsOf(p.arrival.lbs) : ''; } },
        { h: 'Change', n: 1, f: changeOf },
        { h: 'Smell, taste, look', w: 1, f: arrivalWords },
        { h: 'Notes', w: 1, f: function (p) { return p.arrival ? p.arrival.notes : ''; } },
      ], others),
      !all.length ? el('p', { className: 'sub', text: 'No packages recorded for this batch.' }) : null,
      s.shell_packages.length ? el('p', { className: 'sub st-cap', text: 'Shells went into this batch too. They are not nibs, so they are left out of the shares, roasts and ferments.' }) : null,
    ]);
  }
  function roastingSection(s, cols, marks) {
    var mins = function (v) { return v == null ? '' : v + ' min'; }, deg = function (v) { return v == null ? '' : v + ' °C'; };
    var dates = s.roasts.map(function (r) { return r.date || ''; }).filter(Boolean).sort();
    var notes = s.roasts.map(function (r) {
      var packs = s.packages.filter(function (p) { return p.roast === r.id; });
      var kids = [r.notes_text ? el('p', { className: 'quote', text: '“' + r.notes_text + '”' }) : null, r.winnow_notes ? el('p', { className: 'quote', text: 'Winnowing: “' + r.winnow_notes + '”' }) : null,
        storyNotes(r.notes, 'Tasting notes about this roast')].concat(packs.map(function (p) { return storyNotes(p.notes, 'Tasting notes about package ' + p.id); })).filter(Boolean);
      return kids.length ? item(anchor('notes-roast', r.id), 'Roast ' + r.id, kids) : null;
    }).filter(Boolean);
    var named = Object.create(null); // P2-A: a mixed roast heads each of its ferments' columns; its anchor (#roast-<id>) is on the first one only
    var head = function (c) {
      return colHead(c, false, c.roasts.map(function (r) {
        var first = !named[r.id]; named[r.id] = true;
        return el('small', first ? { id: anchor('roast', r.id), className: 'st-anchor' } : { className: 'st-anchor' }, ['Roast ' + r.id, r.mixed ? ' (mixed)' : null, r.found ? null : el('span', { className: 'st-miss', text: ' · not in the records on this device' })]);
      }));
    };
    return section('roasting', 'Roasting, winnowing and packing', span(dates[0], dates[dates.length - 1]), s.roasts.length ? [
      matrix('mx-roast', 'Each ferment\'s roast, winnowing and packing', cols, head, [
        { grp: 'Roasting' },
        { label: 'Roasted', of: 'roast', f: function (r) { return P.long(r.date); } },
        { label: 'Beans in', of: 'roast', f: function (r) { return lbsOf(r.beans_in); } },
        { label: 'Start temperature', of: 'roast', f: function (r) { return deg(r.start_temp); } },
        { key: 'roast_max', label: 'Max temperature', of: 'roast', f: function (r) { return deg(r.max_temp); } },
        { label: 'Time to start temperature', of: 'roast', f: function (r) { return mins(r.mins_to_start); } },
        { key: 'mins_to_max', label: 'Time to max temperature', of: 'roast', f: function (r) { return mins(r.mins_to_max); } },
        { label: 'Cooling', of: 'roast', f: function (r) { return mins(r.cooling_min); } },
        { label: 'Roaster', of: 'roast', f: function (r) { return r.roaster; } },
        { label: 'Roast plan', of: 'roast', f: function (r) { return r.plan; } },
        { label: 'Roaster loads', of: 'roast', f: function (r) { return r.loads; } },
        { label: 'Roaster log', of: 'roast', wrap: 1, f: function (r) { return r.log_ref; } },
        { grp: 'Winnowing' },
        { label: 'Winnowed', of: 'roast', f: function (r) { return r.winnowed ? P.long(r.winnow_date) || 'Yes' : r.found ? el('span', { className: 'st-miss', text: 'Not winnowed yet' }) : ''; } },
        { label: 'Nibs', of: 'roast', f: function (r) { return lbsOf(r.nib_lbs); } },
        { label: 'Shells', of: 'roast', f: function (r) { return lbsOf(r.shell_lbs); } },
        { key: 'nib_yield', label: 'Nib yield', of: 'roast', f: function (r) { return r.nib_yield != null ? r.nib_yield + '%' : ''; } },
        { label: 'Lost in roasting and winnowing', of: 'roast', f: function (r) { return r.loss_lbs != null ? f1(r.loss_lbs) + ' lbs · ' + r.loss_pct + '%' : ''; } },
        { grp: 'Packing and shipping' },
        { label: 'Package', of: 'pack', f: packLink },
        { label: 'Type', of: 'pack', f: function (p) { return p.type; } },
        { label: 'Packed', of: 'pack', f: function (p) { return P.long(p.pack_date); } },
        { label: 'Weight', of: 'pack', f: function (p) { return lbsOf(p.lbs); } },
        { label: 'Shipped', of: 'pack', f: function (p) { return p.shipment ? el('span', {}, [(P.long(p.ship_date) || 'Yes') + ' · ', palletInline(p.shipment, p.id)]) : P.long(p.ship_date); } },
      ], marks),
    ].concat(notes) : [el('p', { className: 'sub', text: 'No roast is recorded behind this batch.' })]);
  }
  function fermentsSection(s, cols, marks) {
    var fs = s.ferments, n = fs.length, w = colChartW(n), size = { w: w, h: w < 200 ? 132 : w < 320 ? 150 : 180, small: true };
    var loads = fs.map(function (f) { return f.load_date || ''; }).filter(Boolean).sort(), ends = fs.map(function (f) { return f.bagged_date || f.inside_dry || f.unload_date || ''; }).filter(Boolean).sort();
    // the same scales in every column, so the lines can be compared by eye
    var days = function (list) { return M.dayAxis(list); }; // one axis for every column: from the first day any of them has a reading
    var tDays = days([].concat.apply([], fs.map(function (f) { return (f.checks || []).filter(function (c) { return c.centre != null || c.top != null; }).map(function (c) { return c.day; }); })));
    var curves = fs.map(function (f) { return f.curve; }).filter(function (c) { return c && c.has; });
    var mDays = days([].concat.apply([], curves.map(function (c) { return c.points.map(function (q) { return q.day; }); })));
    var mTop = Math.max.apply(null, [0].concat.apply([0], curves.map(function (c) { return c.points.map(function (q) { return q.moisture; }).concat([c.target]); })));
    var target = (fs.filter(function (f) { return f.curve; })[0] || { curve: {} }).curve.target;
    var key = function (kids) { return el('small', { className: 'st-key' }, kids); };
    var notes = fs.map(function (f) {
      var kids = [f.notes_text ? el('p', { className: 'quote', text: '“' + f.notes_text + '”' }) : null, storyNotes(f.notes, 'Tasting notes about ferment ' + f.id)].filter(Boolean);
      return kids.length ? item(anchor('notes-ferment', f.id), 'Ferment ' + f.id, kids) : null;
    }).filter(Boolean);
    var head = function (c) {
      var f = c.f;
      return colHead(c, true, [[f.pct != null ? f.pct + '% of the nibs' : '', lbsOf(f.lbs)].filter(Boolean).join(' · '), f.found ? null : el('small', { className: 'st-miss', text: 'Not in the records on this device' })]);
    };
    return section('ferments', 'Fermentation and drying', span(loads[0], ends[ends.length - 1]), fs.length ? [
      matrix('compare', 'Each ferment\'s fermentation, drying and farms', cols, head, [
        { grp: 'Fermentation' },
        { label: 'Loaded', f: function (f) { return P.long(f.load_date); } },
        { label: 'Unloaded', f: function (f) { return P.long(f.unload_date); } },
        { key: 'ferment_days', label: 'Days fermenting', f: function (f) { return f.ferment_days; } },
        { label: 'Box moves', wrap: 1, f: function (f) { return !f.found ? '' : f.moves.length ? plural(f.moves.length, 'move') + ' (' + f.moves.map(function (m) { return m.day != null ? 'day ' + m.day : P.short(m.date); }).join(', ') + ')' : (f.has_checks ? 'None logged' : ''); } },
        { key: 'peak_centre', label: 'Peak centre', f: function (f) { return f.peak_centre != null ? degC(f.peak_centre) + (f.peak_day != null ? ' on day ' + f.peak_day : '') : ''; } },
        { label: 'Wet beans', f: function (f) { return f.wet != null ? P.fmt(f.wet) + ' lbs' : ''; } },
        { label: 'Station', f: function (f) { return f.station; } },
        { label: 'Box', f: function (f) { return f.box_type; } },
        { label: 'Plan', wrap: 1, f: function (f) { return f.plan; } },
        { chart: true, label: 'Temperatures', legend: key([el('span', { className: 'key centre', text: 'Centre' }), el('span', { className: 'key top', text: 'Top' }), ' °C by day since loading']),
          f: function (f) { return !f.found ? '' : tempChart(f.checks, { w: size.w, h: size.h, small: true, days: tDays, label: 'Ferment ' + f.id + ': temperatures by day since loading' }) || el('span', { className: 'st-miss', text: f.has_checks ? 'No temperatures were recorded at the checks.' : 'No fermentation checks are recorded for this ferment.' }); } },
        { grp: 'Drying' },
        { key: 'drying_days', label: 'Days drying', f: function (f) { return f.drying_days; } },
        { label: 'Where', wrap: 1, f: function (f) { return f.found ? f.places.join(', ') : ''; } },
        { key: 'final_moisture', label: 'Final moisture', f: function (f) { return f.final_moisture != null ? f.final_moisture + '%' : ''; } },
        { label: 'Reached ' + (target != null ? target + '%' : 'the target'), f: function (f) { return f.days_to_target != null ? 'Day ' + f.days_to_target : ''; } },
        { label: 'Bagged', f: function (f) { return P.long(f.bagged_date); } },
        { label: 'Dry beans', f: function (f) { return f.dry != null ? P.fmt(f.dry) + ' lbs' : ''; } },
        { label: 'Wet to dry', f: function (f) { return f.yield != null ? f.yield + '%' : ''; } },
        { chart: true, label: 'Moisture', legend: key([el('span', { className: 'key moist', text: 'Moisture' }), ' % by day of drying. The ringed point is the final moisture; the dashed line is the target.']),
          f: function (f) {
            if (!f.found) return '';
            if (!f.has_drying) return el('span', { className: 'st-miss', text: 'No drying entries are recorded for this ferment.' });
            return moistureChart(f.curve, { w: size.w, h: size.h, small: true, days: mDays, top: mTop, label: 'Ferment ' + f.id + ': moisture by day of drying' }) || el('span', { className: 'sub', text: 'No moisture readings were taken while it dried.' });
          } },
        { grp: 'The farms' },
        { label: 'Beans from', wrap: 1, f: function (f) { return f.found && f.farms.length ? el('span', { className: 'st-lines' }, f.farms.map(function (x) { return el('span', { text: x.farm + (x.pct != null ? ' ' + Math.round(x.pct) + '%' : '') }); })) : ''; } },
        { label: 'Every entry', wrap: 1, f: function (f) { return /^\d+\.\d+$/.test(f.id) && f.found ? el('a', { className: 'st-more no-print', href: 'batch.html?f=' + encodeURIComponent(f.id), text: 'Open ' + f.id }) : ''; } },
      ], marks),
    ].concat(notes) : [el('p', { className: 'sub', text: 'No ferment is recorded behind this batch.' })]);
  }
  function farmsSection(s) {
    return section('farms', 'Where the beans came from', '', [
      s.farms.length ? el('ul', { className: 'st-farms' }, s.farms.map(function (x) {
        var bar = el('i'); bar.style.width = Math.max(1, Math.min(100, x.pct)) + '%';
        return el('li', {}, [
          el('span', { className: 'f-name' + (x.unknown ? ' st-miss' : ''), text: x.unknown ? 'Not known' : x.farm }),
          el('span', { className: 'f-n', text: x.pct + '% · ' + f1(x.lbs) + ' lbs' }),
          el('span', { className: 'f-bar', 'aria-hidden': 'true' }, [bar]),
          el('span', { className: 'f-via', text: x.unknown ? 'No deliveries are recorded for these nibs.' : 'Through ' + (x.ferments.length === 1 ? 'ferment ' : 'ferments ') + x.ferments.join(', ') }),
        ]);
      })) : el('p', { className: 'sub', text: 'No farms recorded for these packages.' }),
      s.farms.length ? el('p', { className: 'sub st-cap', text: 'Each farm\'s share of the ' + f1(s.nib_lbs) + ' lbs of nibs in this batch: its share of the wet beans in each ferment, times that ferment\'s share of the nibs.' }) : null,
    ]);
  }
  /** "What stands out": the comparisons model.js works out, each linking to the line of the page it is about. Nothing when there is nothing to compare. */
  function standoutSection(list) {
    if (!list.length) return null;
    return el('section', { className: 'st-standout', id: 'standout', 'aria-labelledby': 'standout-h' }, [
      el('h2', { id: 'standout-h', text: 'What stands out' }),
      el('ul', {}, list.map(function (x) { return el('li', {}, [el('a', { href: '#row-' + x.row, text: x.text })]); })),
      el('p', { className: 'sub st-cap' }, ['Differences between this batch\'s ferments and roasts. The figures named here are marked ', el('span', { className: 'st-arrow', 'aria-hidden': 'true', text: '▲' }), ' highest or ', el('span', { className: 'st-arrow', 'aria-hidden': 'true', text: '▼' }), ' lowest below.']),
    ]);
  }

  /** batch.html?c=W26-001: the whole story of one batch. */
  function renderBatch(data, stale) {
    bandLow = data.target_moisture_low; palletTabs = data.tabs || null;
    var s = M ? M.batchStory(data.tabs || {}, cid, { target: data.target_moisture }) : null;
    var banner = stale ? el('p', { className: 'notice warn', text: 'No connection: showing the copy saved on this device, from ' + new Date(data.at).toLocaleString() + '.' }) : null;
    if (!s) { show([banner, el('h1', { text: 'Batch ' + cid }), el('p', { className: 'notice warn', text: 'This batch is not in the records' + (stale ? ' saved on this phone' : '') + '. If it was started just now, connect to the internet and scan again.' })]); return; }
    var b = s.batch, C = window.CH_CONFIG || {};
    var insights = M.storyInsights(s), marks = Object.create(null);
    insights.forEach(function (x) { x.marks.forEach(function (k) { marks[x.row + '|' + k.kind + '|' + k.id] = k; }); });
    function draw() {
      var order = storyOrder(), farmFirst = order === 'farm', cols = columnsOf(s);
      var turn = function (a) { return farmFirst ? a.slice().reverse() : a; };
      var roastDates = s.roasts.map(function (r) { return r.date || ''; }).concat(s.packages.map(function (p) { return p.ship_date || p.pack_date || ''; })).filter(Boolean).sort();
      var farmDates = s.ferments.map(function (f) { return f.load_date || ''; }).concat(s.ferments.map(function (f) { return f.bagged_date || f.inside_dry || f.unload_date || ''; })).filter(Boolean).sort();
      var makeDates = s.packages.concat(s.shell_packages).map(function (p) { return p.arrival ? p.arrival.date : ''; }).concat([b.start_date, b.finish_date]).filter(Boolean).sort();
      // the three places, each with the parts of the story that happen there
      var places = turn([
        { id: 'place-maker', name: 'Chocolate maker', dot: 's-making', sub: ['Arrival, making and tasting', C.shipTo ? 'in ' + C.shipTo : ''].filter(Boolean).join(' '), when: span(makeDates[0], makeDates[makeDates.length - 1]),
          parts: [['product', 'The product'], ['making', b.chocolate ? 'Chocolate making' : 'Making'], ['arrival', 'Arrival']],
          kids: function () { return turn([el('div', { className: 'st-pair' }, turn([productSection(s), makingSection(s)])), arrivalSection(s, cols)]); } },
        { id: 'place-factory', name: 'Factory', dot: 's-roast', sub: 'Roasting, winnowing, packing and shipping', when: span(roastDates[0], roastDates[roastDates.length - 1]),
          parts: [['roasting', 'Roasting']],
          kids: function () { return [roastingSection(s, cols, marks)]; } },
        { id: 'place-farm', name: 'Farm and fermentary', dot: 's-ferm', sub: 'Drying, fermentation and the farms', when: span(farmDates[0], farmDates[farmDates.length - 1]),
          parts: [['ferments', 'Fermentation and drying'], ['farms', 'Farms']],
          kids: function () { return turn([fermentsSection(s, cols, marks), farmsSection(s)]); } },
      ]);
      var pick = function (k, word) {
        return el('button', { type: 'button', className: 'btn btn-secondary btn-sm', 'aria-pressed': order === k ? 'true' : 'false', 'data-order': k, text: word,
          onclick: function () { if (storyOrder() === k) return; P.save('ch.story.order', k); draw(); var again = document.querySelector('.st-order [data-order="' + k + '"]'); if (again) again.focus(); } });
      };
      var made = b.output_units != null ? [P.fmt(b.output_units), 'bars or pieces', b.output_lbs != null ? f1(b.output_lbs) + ' lbs' : ''] : [b.output_lbs != null ? f1(b.output_lbs) : '', 'lbs', b.finished ? '' : 'Not finished yet'];
      var behind = [plural(s.farms.filter(function (x) { return !x.unknown; }).length, 'farm'), plural(s.roasts.length, 'roast'), plural(s.packages.length, 'package')].join(' · ');
      var jump = (insights.length ? [el('li', {}, [el('a', { href: '#standout', text: 'What stands out' })])] : []).concat(places.map(function (p) {
        return el('li', {}, [el('a', { href: '#' + p.id, text: p.name }), el('ul', {}, turn(p.parts).map(function (x) { return el('li', {}, [el('a', { href: '#' + x[0], text: x[1] })]); }))]);
      }));
      show([banner,
        el('p', { className: 'st-printhead' }, [el('span', { 'data-brand': 'company' }), ' · batch story · printed ' + P.long(P.today())]),
        el('div', { className: 'head' }, [
          el('div', {}, [el('p', { className: 'eyebrow', text: (b.destination || 'Batch') + ' · tree to bar' }), el('h1', { text: 'Batch ' + s.id }),
            el('p', { className: 'st-lede', text: [b.recipe, b.finished ? 'Finished ' + P.long(b.finish_date) : b.start_date ? 'Started ' + P.long(b.start_date) : ''].filter(Boolean).join(' · ') })]),
          el('span', { className: 'badge ' + (b.finished ? 'ok' : 'info'), text: b.finished ? 'Finished' : 'In progress' }),
        ]),
        el('ul', { className: 'statstrip st-glance', id: 'glance' }, [
          stat('Tasting score', s.score.avg != null ? P.fmt(s.score.avg, 1) : '', '/ 10', s.score.notes ? plural(s.score.notes, 'note') + (s.score.off ? ' · ' + s.score.off + ' with something off' : '') : 'No tasting notes yet'),
          b.chocolate ? stat('Nibs : sugar', b.ratio, '', lbsOf(b.nib_lbs) + ' of nibs') : stat('Nibs in', b.nib_lbs ? f1(b.nib_lbs) : '', 'lbs', b.shell_lbs ? f1(b.shell_lbs) + ' lbs of shells' : ''),
          stat('Made', made[0], made[1], made[2]),
          stat('From', s.ferments.length ? String(s.ferments.length) : '', s.ferments.length === 1 ? 'ferment' : 'ferments', behind),
        ]),
        el('div', { className: 'st-body' }, [
          el('nav', { className: 'st-jump no-print', 'aria-label': 'Jump to' }, [
            el('p', { className: 'st-jump-l', id: 'jump-l', text: 'Jump to' }),
            el('ul', { 'aria-labelledby': 'jump-l' }, jump),
            el('div', { className: 'st-tools' }, [
              el('div', { className: 'st-order', role: 'group', 'aria-label': 'Which end the story starts from' }, [pick('bar', 'Bar first'), pick('farm', 'Farm first')]),
              el('button', { type: 'button', className: 'btn btn-secondary btn-sm', id: 'story-print', text: 'Print', onclick: function () { window.print(); } }),
            ]),
          ]),
          el('div', { className: 'st-flow', id: 'story', 'data-order': order }, [standoutSection(insights)].concat(places.map(function (p) { return place(p.id, p.name, p.dot, p.sub, p.when, p.kids()); }))),
        ]),
      ]);
      if (C.applyBrand) C.applyBrand($('main'));
    }
    $('main').classList.add('story');
    draw();
    document.title = 'Batch ' + s.id + ' · ' + (C.company || 'Cocoahead');
  }

  /**
   * Package and ferment pages: the batches it went into, each with its main numbers and a link to its whole story, so the chain on
   * these pages runs all the way to the bar as well.
   */
  function madeIntoCard(data, kind, ref) {
    if (!M) return null;
    var list = M.madeInto(data.tabs || {}, kind, ref);
    if (!list.length) return null;
    var what = kind === 'Package' ? 'package' : 'ferment';
    // nibs and shells are said apart: only nibs have a share of the batch's nibs
    var used = function (x) {
      var shells = Math.round((x.lbs - x.nib_lbs) * 10) / 10;
      return [x.nib_lbs ? lbsOf(x.nib_lbs) + ' of nibs' + (x.pct != null ? ' (' + x.pct + '% of its nibs)' : '') : '', shells > 0 ? lbsOf(shells) + ' of shells' : ''].filter(Boolean).join(' · ');
    };
    return el('section', { className: 'card', id: 'made-into' }, [
      el('h2', { text: 'What it was made into' }),
      el('p', { className: 'sub', text: 'Each batch that used this ' + what + '. Open one for its whole story, from the bar back to the farm.' }),
    ].concat(list.map(function (x) {
      var b = x.batch;
      return el('article', { className: 'st-item' }, [
        el('h3', {}, [el('a', { href: 'batch.html?c=' + encodeURIComponent(b.id), text: 'Batch ' + b.id }), el('span', { className: 'badge ' + (b.finished ? 'ok' : 'info'), text: b.finished ? 'Finished' : 'In progress' }),
          x.score.off ? el('span', { className: 'badge bad', text: 'Something off' }) : null]),
        facts([['Made for', b.destination], ['Recipe', b.recipe], ['Started', P.long(b.start_date)], ['Finished', P.long(b.finish_date)],
          ['From this ' + what, used(x)], ['Nibs : sugar', b.ratio],
          ['Conching', b.conche_hours != null ? b.conche_hours + ' h' + (b.conche_temp != null ? ' at ' + b.conche_temp + ' ' + b.temp_unit : '') : ''],
          ['Fineness reached', b.final_micron != null ? b.final_micron + ' microns' : ''], ['Bars or pieces', b.output_units],
          ['Tasting score', x.score.avg != null ? P.fmt(x.score.avg, 1) + ' / 10 from ' + plural(x.score.n, 'note') : ''], ['Ferments in it', x.ferments.join(', ')]]),
      ]);
    })));
  }
  function bodyCards(b, data) { return fermentNodes(b, data || { at: '' }, false).slice(2); }
  function render(data, stale) {
    bandLow = data.target_moisture_low;
    var b = P.batch(data, id);
    if (!b) {
      show([el('h1', { text: 'Ferment ' + id }), el('p', { className: 'notice warn', text: 'This ferment is not in the records' + (stale ? ' saved on this phone' : '') + '. Check the label, or open the dashboard.' })]);
      return;
    }
    var nodes = fermentNodes(b, data, stale);
    nodes.splice(3, 0, tastingCard(data, 'Ferment', b.id)); // after the banner, the heading and At a glance
    nodes.push(madeIntoCard(data, 'Ferment', b.id)); // the chain carries on to the batches made from it
    show(nodes);
    document.title = 'Ferment ' + b.id + ' · ' + ((window.CH_CONFIG || {}).company || 'Cocoahead');
  }

  // P2-A: a new package number (R3.1-P1) names no ferment, but it is still a package page
  if (!id && !cid && !pid) { show([el('h1', { text: 'Batch history' }), el('p', { className: 'sub', text: 'Scan the QR code on a bag, or open this page from the dashboard.' })]); return; }
  if (P.badLink) { show([el('h1', { text: 'Batch history' }), el('p', { className: 'notice warn', text: 'That link does not belong to this app, so it was not used. Ask ' + ((window.CH_CONFIG || {}).contact || 'Jake') + ' for a new one.' })]); return; }
  var what = cid ? 'Batch ' + cid : pid ? 'Package ' + pid : 'Ferment ' + id;
  show([el('p', { className: 'sub', text: 'Loading ' + what.toLowerCase() + '…' })]);
  // 2.7.1: the copy on this device first (only when it has what was asked for: a ferment, package or batch made since then
  // waits for the fresh read instead of saying "not in the records"), then the fresh answer replaces it
  var has = function (data, tab, col, v) { return ((data.tabs || {})[tab] || []).some(function (r) { return String(r[col]) === v; }); };
  P.getData(function (copy) {
    if (cid ? !has(copy, 'Batches', 'Batch ID', cid) : pid ? !has(copy, 'Packages', 'Package ID', pid) : !has(copy, 'Ferments', 'Ferment ID', id)) return;
    if (cid) renderBatch(copy, false); else if (pid) renderPackage(copy, false); else render(copy, false);
  }).then(function (r) {
    // 2.4.2: a page that cannot be drawn says so plainly (it is not a connection problem, and nothing here is lost)
    try { if (cid) renderBatch(r.data, r.stale); else if (pid) renderPackage(r.data, r.stale); else render(r.data, r.stale); } catch (e) {
      if (window.console) console.error(e);
      show([el('h1', { text: what }), el('p', { className: 'notice bad', id: 'draw-failed', text: 'Something went wrong showing this page. Try again later, or ask ' + ((window.CH_CONFIG || {}).contact || 'Jake') + '.' })]);
    }
  }, function (err) {
    if (err.paused) {
      show([el('h1', { text: what }), el('p', { className: 'notice warn', text: err.message })]);
    } else if (err.notConnected) {
      show([el('h1', { text: what }), el('p', { className: 'notice warn', text: 'This phone is not connected yet. Open the invite link you were sent (email, text or WhatsApp) on this phone once, on wifi, then scan the code again. No link yet? Ask ' + ((window.CH_CONFIG || {}).contact || 'Jake') + ' to invite you.' })]);
    } else {
      show([el('h1', { text: what }), el('p', { className: 'notice bad', text: 'No connection (' + (err.message || err) + ') and nothing is saved on this phone yet.' })]);
    }
  });
})();
