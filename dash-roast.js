/*
 * Dashboard, Roasting view (stage 2): the roasts, how nibs yielded, roast shape, the ferment ledger and the pallets.
 * Everything is worked out by docs/model.js from the Roasts, Packages and Shipments tabs. Lbs and °C. No money anywhere.
 * The Roasting tab only shows once a roast has been logged, so the dashboard looks exactly as before until then.
 * dashboard.js passes in its helpers (H): el, axisStyle, tipFor, showTip, short, fmt, fmt1, season, pick, stat, noChart, chartIn, chartW, hrefOf.
 */
(function (root) {
  'use strict';
  var FIRST = 'date'; // the big table arrives newest first; its headings sort from there (the table itself remembers how)
  var $ = function (id) { return document.getElementById(id); };

  function fmt1(v) { return v == null ? '' : d3.format(',.1f')(v); }
  function pct(v) { return v == null ? '' : d3.format('.1f')(v) + '%'; }
  function mins(v) { return v == null ? '' : v + ' min'; }
  function seasonOfId(id) { return String(id).split('.')[0]; }
  /** The season a package belongs to: its roast's own (R3.1-P2 is 3), or an old 3.4-R2-P1's. */
  function packSeason(pid) { var m = /^R?(\d+)\./.exec(String(pid)); return m ? m[1] : ''; }

  /** A small table with a muted dash for no value; sortable when asked (the shared sorting), paged past 25 rows. */
  function table(H, t, cols, rows, sortable, label) {
    var el = H.el;
    var head = el('tr', {}, cols.map(function (c) {
      // app 1.25.0: the shared sorting (admin.js CH_ADMIN.ui.sortable): IDs part by part, numbers as numbers, dates by their ISO text
      var th = el('th', { className: c.n ? 'n' : '', text: c.h, 'data-sort': sortable && c.k ? (c.sort || (c.id ? 'id' : c.n ? 'num' : 'text')) : null });
      if (sortable && c.k === FIRST && !t.__sort) th.setAttribute('aria-sort', 'descending'); // how the rows arrive: newest first
      return th;
    }));
    var body = el('tbody', {}, rows.map(function (r) {
      // a row that opens something: the first cell holds the real link (keyboard, new tab), and a click anywhere on the row follows it
      var tr = el('tr', { className: r.href ? 'is-link' : '' });
      if (r.href) tr.addEventListener('click', function (ev) { if (!ev.target.closest('a, button')) tr.querySelector('a.rowlink').click(); });
      cols.forEach(function (c, i) {
        var v = c.f ? c.f(r) : r[c.k];
        var td = el('td', { className: [c.n ? 'n' : '', c.nw ? 'nw' : '', c.t ? 't' : '', c.id ? 'id' : ''].filter(Boolean).join(' '), 'data-v': sortable && c.k ? (r[c.k] == null ? '' : String(r[c.k])) : null });
        if (i === 0 && r.href && v != null && v !== '') td.appendChild(el('a', { className: 'rowlink', href: r.href, text: String(v) }));
        else if (v && typeof v === 'object' && v.nodeType) td.appendChild(v); // a status pill, or P2-B's Check cell
        else td.textContent = v == null ? '' : v;
        if (td.textContent === '' && !td.firstChild) CH_ADMIN.none(td);
        tr.appendChild(td);
      });
      return tr;
    }));
    t.replaceChildren(el('thead', {}, [head]), body);
    if (sortable) CH_ADMIN.ui.sortable(t, { keep: true });
    CH_ADMIN.ui.paged(t, { label: label });
  }

  /** Slice B: the Packages count of a pallet opens a side panel with what is on it (read only; no money in these tabs). */
  function palletLink(H, T, r) {
    var b = H.el('button', { className: 'pallet-link', type: 'button', 'aria-label': 'Packages on pallet ' + r.id, text: String(r.n) });
    b.addEventListener('click', function () {
      try { // a problem here never breaks the dashboard
        var M = root.CH_MODEL, P = root.CH_PAGE;
        if (!M || typeof M.palletContentsFromTabs !== 'function' || !P || typeof P.palletTable !== 'function') return;
        var view = M.palletContentsFromTabs(T, r.id);
        CH_ADMIN.ui.panel({ title: 'Pallet ' + r.id, body: P.palletTable(view, { href: function (pid) { return 'batch.html?p=' + encodeURIComponent(pid); } }) });
      } catch (e) { /* nothing opens */ }
    });
    return b;
  }

  /** One figure of the stat strip (dashboard.js draws it: no value is the muted dash, a real zero is 0). */
  function tile(H, label, value, unit, note) { return H.stat(label, value === '–' ? '' : value, unit, note, { zero: value === '0' }); }

  /** Nib yield by roast: nibs ÷ beans in, one bar each, oldest first. */
  function yieldChart(H, rs) {
    var box = $('roast-yield-chart');
    var rows = rs.filter(function (r) { return r.nib_yield != null; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1; });
    if (!rows.length) { H.noChart(box, 'No winnowed roasts yet.'); return; }
    var w = H.chartW(box), h = 240, m = { t: 12, r: 12, b: 26, l: 36 };
    var svg = d3.create('svg').attr('width', '100%').attr('viewBox', '0 0 ' + w + ' ' + h).attr('role', 'img').attr('aria-label', 'Nib yield by roast');
    var x = d3.scaleBand(rows.map(function (r) { return r.id; }), [m.l, w - m.r]).padding(0.25), y = d3.scaleLinear([0, 100], [h - m.b, m.t]);
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickFormat(function (v) { return v + '%'; }).tickSize(-(w - m.l - m.r))).call(H.axisStyle);
    // labels stay level: a roast's ID is about 60px wide, so every second or third one is named when the bars are close together
    var step = Math.ceil(64 / Math.max(1, x.step()));
    svg.append('g').attr('transform', 'translate(0,' + (h - m.b) + ')').call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat(function (d, i) { return i % step === 0 ? d : ''; })).call(H.axisStyle);
    var tip = H.tipFor(box);
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', function (d) { return x(d.id) + (x.bandwidth() - Math.min(x.bandwidth(), 56)) / 2; }).attr('width', Math.min(x.bandwidth(), 56)).attr('y', function (d) { return y(d.nib_yield); }).attr('height', function (d) { return y(0) - y(d.nib_yield); })
      .attr('rx', 2).attr('fill', 'var(--chart-roast)').style('cursor', 'pointer')
      .on('click', function (ev, d) { H.pick(d.ferments[0] || ''); }) // P2-A: a mixed roast opens its first ferment
      .on('mousemove', function (ev, d) { H.showTip(box, tip, ev, 'Roast ' + d.id, ['Nib yield ' + pct(d.nib_yield), fmt1(d.beans_in) + ' lbs beans → ' + fmt1(d.nib_lbs) + ' lbs nibs', d.shell_pct != null ? 'Shells ' + pct(d.shell_pct) : '']); })
      .on('mouseleave', function () { tip.hidden = true; });
    H.chartIn(box, svg, tip);
  }

  /** Roast shape: from the start to the time the start temperature was reached, then to the maximum (minutes since the start, °C). */
  function shapeChart(H, rs) {
    var box = $('roast-shape-chart');
    var lines = rs.map(function (r) {
      var p = [];
      if (r.mins_to_start != null && r.start_temp != null) p.push({ x: r.mins_to_start, y: r.start_temp });
      if (r.mins_to_max != null && r.max_temp != null) p.push({ x: r.mins_to_max, y: r.max_temp });
      return { r: r, p: p };
    }).filter(function (l) { return l.p.length; });
    if (!lines.length) { H.noChart(box, 'No roast times logged yet.'); return; }
    var w = H.chartW(box), h = 240, m = { t: 12, r: 14, b: 28, l: 40 };
    var svg = d3.create('svg').attr('width', '100%').attr('viewBox', '0 0 ' + w + ' ' + h).attr('role', 'img').attr('aria-label', 'Roast shape');
    var xmax = Math.max(30, d3.max(lines, function (l) { return d3.max(l.p, function (q) { return q.x; }); }) || 0);
    var ymax = Math.max(160, d3.max(lines, function (l) { return d3.max(l.p, function (q) { return q.y; }); }) || 0);
    var x = d3.scaleLinear([0, xmax], [m.l, w - m.r]).nice(), y = d3.scaleLinear([0, ymax], [h - m.b, m.t]).nice();
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat(function (v) { return v + '°'; }).tickSize(-(w - m.l - m.r))).call(H.axisStyle);
    svg.append('g').attr('transform', 'translate(0,' + (h - m.b) + ')').call(d3.axisBottom(x).ticks(w < 500 ? 4 : 6).tickFormat(function (v) { return v + ' min'; }).tickSize(0).tickPadding(8)).call(H.axisStyle);
    var tip = H.tipFor(box), line = d3.line().x(function (d) { return x(d.x); }).y(function (d) { return y(d.y); });
    lines.forEach(function (l) {
      var g = svg.append('g').style('cursor', 'pointer');
      g.append('path').datum(l.p).attr('d', line).attr('fill', 'none').attr('stroke', 'var(--chart-roast)').attr('stroke-opacity', 0.55).attr('stroke-width', 2);
      g.selectAll('circle').data(l.p).join('circle').attr('cx', function (d) { return x(d.x); }).attr('cy', function (d) { return y(d.y); }).attr('r', 3).attr('fill', 'var(--chart-roast)');
      g.on('click', function () { H.pick(l.r.ferments[0] || ''); })
        .on('mousemove', function (ev) { H.showTip(box, tip, ev, 'Roast ' + l.r.id, ['Start temp ' + (l.r.start_temp != null ? l.r.start_temp + ' °C after ' + mins(l.r.mins_to_start) : 'not logged'), 'Max ' + (l.r.max_temp != null ? l.r.max_temp + ' °C after ' + mins(l.r.mins_to_max) : 'not logged')]); })
        .on('mouseleave', function () { tip.hidden = true; });
    });
    H.chartIn(box, svg, tip);
  }

  /** Is there anything to show? The Roasting tab stays hidden until a roast exists. */
  function has(tabs) { return (tabs['Roasts'] || []).length > 0; }

  /** 2.3.0: is this Roast question still asked (Settings → What you track)? Charts and columns about it go when it is not. */
  function asked(H, key) { return !H.on || H.on('roast', key); }
  function ship(H, key) { return !H.on || H.on('ship', key); }

  /** P2-B: what the 10-bean check found: a "Not good" pill and which of smell, taste, look; Under-roasted / Over-roasted. Nothing found or asked: nothing. */
  function checkFlags(r) {
    var bad = ['smell', 'taste', 'look'].filter(function (k) { return r[k] === 'Not good'; });
    var off = /^(Under|Over)-roasted$/.test(r.profile_achieved || '') ? r.profile_achieved : '';
    return { bad: bad, off: off, n: bad.length + (off ? 1 : 0) };
  }
  function checkCell(H, r) {
    var c = checkFlags(r), ui = root.CH_ADMIN.ui;
    if (!c.n) return (r.smell || r.taste || r.look || r.profile_achieved) ? 'All good' : ''; // checked and fine is said; never checked stays empty (the dash)
    var box = H.el('span', { className: 'check-cell' });
    if (c.bad.length) { box.appendChild(ui.pill('warn', 'Not good')); box.appendChild(document.createTextNode(' ' + c.bad.join(', '))); }
    if (c.off) { if (c.bad.length) box.appendChild(document.createTextNode(' · ')); box.appendChild(ui.pill('warn', c.off)); }
    return box;
  }

  function draw(D, H) {
    var M = root.CH_MODEL, T = D.tabs;
    var timed = asked(H, 'start_time'), toStart = timed && asked(H, 'start_temp'), toMax = timed && asked(H, 'max_temp');
    var s = H.season();
    var inS = function (fid) { return s === 'all' || seasonOfId(fid) === s; };
    var rs = M.roasts(T).filter(function (r) { return s === 'all' || M.inSeason(r, s); }); // P2-A: its own season (R3.1) or any of its ferments'
    var mine = rs.slice().sort(function (a, b) {
      var A = a[FIRST], B = b[FIRST];
      if (A == null || A === '') return 1; if (B == null || B === '') return -1; // no value sinks to the bottom whichever way it sorts
      return A < B ? 1 : A > B ? -1 : 0;
    });
    var done = rs.filter(function (r) { return r.nib_yield != null; });
    var beans = d3.sum(done, function (r) { return r.beans_in; }), nibs = d3.sum(done, function (r) { return r.nib_lbs; });
    var tm = rs.filter(function (r) { return r.mins_to_max != null; });
    $('roast-take').textContent = rs.length
      ? (done.length ? 'Of the beans in winnowed roasts, ' + pct(Math.round(nibs / beans * 1000) / 10) + ' came out as nibs and ' + pct(Math.round((beans - nibs) / beans * 1000) / 10) + ' was lost in roasting and winnowing (' + done.length + ' winnowed).' : 'None winnowed yet.')
      : 'No roasts for this season yet.';
    var sh = d3.sum(rs, function (r) { return r.shell_lbs; });
    $('roast-tiles').replaceChildren.apply($('roast-tiles'), [
      tile(H, 'Roasts', String(rs.length), '', fmt1(d3.sum(rs, function (r) { return r.beans_in; })) + ' lbs of beans in'),
      tile(H, 'Nib yield', done.length ? pct(Math.round(nibs / beans * 1000) / 10) : '–', '', 'nibs ÷ beans in, winnowed roasts'),
      tile(H, 'Shells', done.length && nibs + sh ? pct(Math.round(sh / (nibs + sh) * 1000) / 10) : '–', '', 'of what winnowing gave'),
      toMax ? tile(H, 'To max temp', tm.length ? fmt1(d3.mean(tm, function (r) { return r.mins_to_max; })) : '–', 'min', 'average, start to max') : null,
    ].filter(Boolean));
    table(H, $('roast-table'), [
      { h: 'Roast', k: 'id', id: 1, nw: 1 }, { h: 'Date', k: 'date', nw: 1, f: function (r) { return H.short(r.date); } }, { h: 'Ferments', k: 'ferment_list', sort: 'id' },
      { h: 'Beans in lbs', k: 'beans_in', n: 1, f: function (r) { return fmt1(r.beans_in); } },
      asked(H, 'bean_size') ? { h: 'Bean size', k: 'bean_size' } : null,
      timed && asked(H, 'finish_time') ? { h: 'Roast minutes', k: 'roast_minutes', n: 1, f: function (r) { return mins(r.roast_minutes); } } : null,
      toStart ? { h: 'To start temp', k: 'mins_to_start', n: 1, f: function (r) { return mins(r.mins_to_start); } } : null, toMax ? { h: 'To max temp', k: 'mins_to_max', n: 1, f: function (r) { return mins(r.mins_to_max); } } : null,
      asked(H, 'max_temp') ? { h: 'Max °C', k: 'max_temp', n: 1 } : null, asked(H, 'cooling_min') ? { h: 'Cooling', k: 'cooling_min', n: 1, f: function (r) { return mins(r.cooling_min); } } : null,
      { h: 'Nibs lbs', k: 'nib_lbs', n: 1, f: function (r) { return fmt1(r.nib_lbs); } }, { h: 'Shells lbs', k: 'shell_lbs', n: 1, f: function (r) { return fmt1(r.shell_lbs); } },
      { h: 'Nib yield', k: 'nib_yield', n: 1, f: function (r) { return pct(r.nib_yield); } },
      { h: 'Lost (roast + winnow)', k: 'loss_pct', n: 1, f: function (r) { return r.loss_lbs != null ? fmt1(r.loss_lbs) + ' lbs · ' + pct(r.loss_pct) : ''; } },
      asked(H, 'roaster_loads') ? { h: 'Loads', k: 'loads', n: 1 } : null,
      asked(H, 'smell') || asked(H, 'profile_achieved') ? { h: 'Check', k: 'check_n', n: 1, f: function (r) { return checkCell(H, r); } } : null,
      { h: 'Packed lbs', k: 'packed_nibs', n: 1, f: function (r) { return r.winnowed ? fmt1(r.packed_nibs) : ''; } },
    ].filter(Boolean), mine.map(function (r) { return Object.assign({}, r, { check_n: checkFlags(r).n, ferment_list: r.ferments.join(', '), href: r.ferments.length ? H.hrefOf(r.ferments[0]) : '' }); }), true, 'All roasts'); // "3.4, 3.5": links to the first
    yieldChart(H, rs);
    H.showCard($('roast-shape-chart').closest('section'), toStart || toMax); // the roast's shape needs its start time and a temperature
    if (toStart || toMax) shapeChart(H, rs);

    // Ferment ledger: wet → dry → roasted → nibs → packed → shipped
    var led = M.ledger(T).filter(function (l) { return inS(l.id) && l.roasts > 0; }); // only ferments that have been roasted; the rest are on the Stock view
    // P2-A: after the roaster, a ferment in a mixed roast gets its share of the roast's figures: an estimate, shown with ≈
    var est = function (r, v) { return v === '' || v == null || !r.est ? v : '≈ ' + v; };
    var after = function (k) { return function (r) { return r[k] === 0 ? fmt1(0) : est(r, fmt1(r[k])); }; }; // nothing yet is no estimate
    var note = $('ledger-est');
    if (!note) { // one line under the ledger, made here (the page itself is unchanged)
      note = H.el('p', { className: 'sub', id: 'ledger-est', text: '≈ A ferment roasted together with others gets its share of the roast\'s nibs, packages and shipments, by the lbs each put into the roaster.' });
      $('ledger').closest('.tablebox').after(note);
    }
    note.hidden = !led.some(function (r) { return r.est; });
    table(H, $('ledger'), [
      { h: 'Ferment', k: 'id', id: 1 }, { h: 'Wet lbs', k: 'wet', n: 1, f: function (r) { return r.wet != null ? H.fmt(r.wet) : ''; } },
      { h: 'Dry lbs', k: 'dry', n: 1, f: function (r) { return r.dry != null ? H.fmt(r.dry) : ''; } }, { h: 'Dry ÷ wet', k: 'dry_pct', n: 1, f: function (r) { return pct(r.dry_pct); } },
      { h: 'Roasted lbs', k: 'roasted', n: 1, f: function (r) { return fmt1(r.roasted); } }, { h: 'Left to roast', k: 'left', n: 1, f: function (r) { return r.left != null ? fmt1(r.left) + (r.closed ? ' (done)' : '') : ''; } },
      { h: 'Nibs lbs', k: 'nibs', n: 1, f: after('nibs') }, { h: 'Nibs ÷ roasted', k: 'nib_pct', n: 1, f: function (r) { return est(r, pct(r.nib_pct)); } },
      { h: 'Packed lbs', k: 'packed', n: 1, f: after('packed') }, { h: 'Shipped lbs', k: 'shipped', n: 1, f: after('shipped') },
      // Walpole (stage 3): only once something has been checked in
    ].concat(led.some(function (r) { return r.arrived != null; }) ? [
      { h: 'Arrived lbs', k: 'arrived', n: 1, f: after('arrived') }, { h: 'Used in batches lbs', k: 'used', n: 1, f: after('used') },
    ] : []), led.map(function (r) { return Object.assign({}, r, { href: H.hrefOf(r.id) }); }), true, 'Ferment ledger');

    // Pallets (P2-E: one shipment is one pallet)
    var pal = M.pallets(T);
    var STATE = { 'at port': ['info', 'At the port'], 'on the water': ['warn', 'On the water'], arriving: ['info', 'Arriving'], arrived: ['ok', 'Arrived'] };
    $('shipments-card').hidden = !pal.length;
    table(H, $('shipments'), [
      { h: 'Pallet', k: 'id', id: 1 }, { h: 'To port', k: 'to_port', nw: 1, f: function (r) { return H.short(r.to_port); } }, { h: 'Left port', k: 'left_port', nw: 1, f: function (r) { return r.left_port ? H.short(r.left_port) : ''; } },
      ship(H, 'destination') ? { h: 'Destination', k: 'destination' } : null,
      { h: 'Status', k: 'state', sort: 'text', f: function (r) { var s = STATE[r.state] || ['info', r.state]; return CH_ADMIN.ui.pill(s[0], s[1] + (r.state === 'on the water' && r.days != null ? ' · ' + r.days + (r.days === 1 ? ' day' : ' days') : '')); } },
      ship(H, 'carrier') ? { h: 'Carrier', k: 'carrier' } : null, ship(H, 'tracking') ? { h: 'Tracking', k: 'tracking' } : null,
      { h: 'Packages', k: 'n', n: 1, f: function (r) { return r.n ? palletLink(H, T, r) : String(r.n); } }, { h: 'Lbs', k: 'lbs', n: 1, f: function (r) { return fmt1(r.lbs); } }, { h: 'Ferments', k: 'ferments', sort: 'id' }, ship(H, 'notes') ? { h: 'Notes', k: 'notes', t: 1 } : null,
    ].filter(Boolean), pal, true, 'Pallets');

    // P2-F: Local use: shown only once something was taken from a package kept for local use
    var lu = M.localUse(T).rows.filter(function (x) { return s === 'all' || packSeason(x.package) === s; });
    $('local-card').hidden = !lu.length;
    table(H, $('local-use'), [
      { h: 'Package', k: 'package', id: 1, nw: 1 }, { h: 'Date', k: 'date', nw: 1, f: function (r) { return H.short(r.date); } }, { h: 'Used for', k: 'used_for' },
      { h: 'Lbs', k: 'lbs', n: 1, f: function (r) { return fmt1(r.lbs); } }, { h: 'Emptied', k: 'emptied', f: function (r) { return r.emptied ? 'Yes' : ''; } }, { h: 'Notes', k: 'notes', t: 1 },
    ], lu, true, 'Local use');
  }

  /** "Roasts of this ferment" for the passport: one line per roast with its packages. */
  function passport(D, H, fermentId) {
    var card = $('pp-roasts-card'), M = root.CH_MODEL;
    var rs = M.roasts(D.tabs).filter(function (r) { return r.ferments.indexOf(fermentId) >= 0; }); // P2-A: also a roast that took only some of its beans
    card.hidden = !rs.length;
    if (!rs.length) return;
    var fromHere = function (r) { return r.inputs.filter(function (x) { return x.ferment === fermentId; }).reduce(function (t, x) { return t + (x.lbs || 0); }, 0); };
    table(H, $('pp-roasts'), [
      { h: 'Roast', k: 'id', id: 1, nw: 1 }, { h: 'Date', nw: 1, f: function (r) { return H.short(r.date); } },
      { h: 'Beans in lbs', n: 1, f: function (r) { return r.mixed ? fmt1(fromHere(r)) + ' of ' + fmt1(r.beans_in) : fmt1(r.beans_in); } }, // a mixed roast: this ferment's lbs of the roast's
      rs.some(function (r) { return r.mixed; }) ? { h: 'Roasted with', f: function (r) { return r.ferments.filter(function (f) { return f !== fermentId; }).join(', '); } } : null,
      asked(H, 'max_temp') ? { h: 'Max °C', n: 1, f: function (r) { return r.max_temp; } } : null, { h: 'Nibs lbs', n: 1, f: function (r) { return fmt1(r.nib_lbs); } }, { h: 'Nib yield', n: 1, f: function (r) { return pct(r.nib_yield); } },
      { h: 'Packages', f: function (r) { return r.packages.length ? r.packages.map(function (p) { return p.id.replace(/^.*-P/, 'P') + (p.shipment ? ' shipped' : ' packed'); }).join(', ') : ''; } },
    ].filter(Boolean), rs, false);
  }

  root.CH_DASH_ROAST = { draw: draw, passport: passport, has: has };
})(this);
