/*
 * Dashboard, Making view (stage 3, chocolate making in Walpole): the batches side by side (time to the target fineness, conching
 * time and temperature, nibs : sugar, what came out), conching time against notes, arrival checks, and where one ferment's
 * beans ended up. Everything is worked out by docs/model.js from the Arrivals, Batches and Batch inputs tabs. Lbs, and temperatures in
 * config.js's units.makingTemp (°F). Shells packages used in a batch are counted apart from its nibs. No money.
 * The Making tab only shows once a batch has been started, so the dashboard looks exactly as before until then.
 * dashboard.js passes in its helpers (H): el, axisStyle, tipFor, showTip, short, fmt, fmt1, season, pick, stat, noChart, chartIn, chartW, hrefOf.
 */
(function (root) {
  'use strict';
  var FIRST = 'start_date'; // the big table arrives newest first; its headings sort from there (the table itself remembers how)
  var UNIT = (root.CH_CONFIG && root.CH_CONFIG.units || {}).makingTemp || ''; // config.js: the unit of Making's temperatures (°F)
  var $ = function (id) { return document.getElementById(id); };

  function fmt1(v) { return v == null ? '' : d3.format(',.1f')(v); }
  function pct(v) { return v == null ? '' : d3.format('.1f')(v) + '%'; }
  function hrs(v) { return v == null ? '' : v + ' h'; }

  /** A small table with a muted dash for no value; sortable when asked; a column with nothing in it is left out. */
  function table(H, t, cols, rows, sortable, label) {
    var el = H.el;
    cols = cols.filter(function (c, i) { return i === 0 || !c.hideEmpty || rows.some(function (r) { var v = c.f ? c.f(r) : r[c.k]; return v != null && v !== ''; }); });
    var head = el('tr', {}, cols.map(function (c) {
      // app 1.25.0: the shared sorting (admin.js CH_ADMIN.ui.sortable): IDs part by part, numbers as numbers, dates by their ISO text
      var th = el('th', { className: c.n ? 'n' : '', text: c.h, 'data-sort': sortable && c.k ? (c.sort || (c.id ? 'id' : c.n ? 'num' : 'text')) : null });
      if (sortable && c.k === FIRST && !t.__sort) th.setAttribute('aria-sort', 'descending'); // how the rows arrive: newest first
      return th;
    }));
    var body = el('tbody', {}, rows.map(function (r) {
      // a row that opens something: the first cell holds the real link (keyboard, new tab), and a click anywhere on the row follows it
      var tr = el('tr', { className: (r.href ? 'is-link ' : '') + (r.flag ? 'flag' : '') });
      if (r.href) tr.addEventListener('click', function (ev) { if (!ev.target.closest('a, button')) tr.querySelector('a.rowlink').click(); });
      cols.forEach(function (c, i) {
        var v = c.f ? c.f(r) : r[c.k];
        var td = el('td', { className: [c.n ? 'n' : '', c.nw ? 'nw' : '', c.t ? 't' : '', c.id ? 'id' : ''].filter(Boolean).join(' '), 'data-v': sortable && c.k ? (r[c.k] == null ? '' : String(r[c.k])) : null });
        if (i === 0 && r.href && v != null && v !== '') td.appendChild(el('a', { className: 'rowlink', href: r.href, text: String(v) }));
        else td.textContent = v == null ? '' : v;
        if (td.textContent === '') CH_ADMIN.none(td);
        tr.appendChild(td);
      });
      return tr;
    }));
    t.replaceChildren(el('thead', {}, [head]), body);
    if (sortable) CH_ADMIN.ui.sortable(t, { keep: true });
    CH_ADMIN.ui.paged(t, { label: label });
  }

  /** One figure of the stat strip (dashboard.js draws it: no value is the muted dash, a real zero is 0). */
  function tile(H, label, value, unit, note) { return H.stat(label, value === '–' ? '' : value, unit, note, { zero: value === '0' }); }

  var mixText = function (b) { return b.mix.map(function (m) { return m.ferment + (m.pct != null ? ' ' + Math.round(m.pct) + '%' : ''); }).join(' · '); };
  var noteText = function (b) { return [b.recipe, b.notes, b.finish_notes].filter(Boolean).join(' · '); };

  /** Hours to reach the target fineness against the nib share (nibs ÷ nibs and sugar): one dot per finished chocolate batch. */
  function scatter(H, bs) {
    var box = $('making-scatter');
    var pts = bs.filter(function (b) { return b.chocolate && b.nib_pct != null && b.hours_to_target != null; });
    if (!pts.length) { H.noChart(box, 'No batch has both a sugar weight and a time to target yet.'); return; }
    var w = H.chartW(box), h = 240, m = { t: 14, r: 16, b: 40, l: 44 };
    var svg = d3.create('svg').attr('width', '100%').attr('viewBox', '0 0 ' + w + ' ' + h).attr('role', 'img').attr('aria-label', 'Hours to the target fineness against nib share');
    var xs = pts.map(function (p) { return p.nib_pct; }), lo = Math.floor(Math.min(60, d3.min(xs) || 60) - 2), hi = Math.ceil(Math.max(80, d3.max(xs) || 80) + 2);
    var x = d3.scaleLinear([lo, hi], [m.l, w - m.r]), y = d3.scaleLinear([0, Math.max(10, d3.max(pts, function (p) { return p.hours_to_target; }) || 0)], [h - m.b, m.t]).nice();
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat(function (v) { return v + ' h'; }).tickSize(-(w - m.l - m.r))).call(H.axisStyle);
    svg.append('g').attr('transform', 'translate(0,' + (h - m.b) + ')').call(d3.axisBottom(x).ticks(6).tickFormat(function (v) { return v + '%'; }).tickSize(0).tickPadding(8)).call(H.axisStyle);
    svg.append('text').attr('x', (m.l + w - m.r) / 2).attr('y', h - 4).attr('text-anchor', 'middle').attr('fill', 'var(--text-3)').style('font-size', '12px').text('Nibs as a share of nibs + sugar');
    var tip = H.tipFor(box);
    svg.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', function (p) { return x(p.nib_pct); }).attr('cy', function (p) { return y(p.hours_to_target); }).attr('r', 6).attr('fill', 'var(--stage-making)').attr('fill-opacity', 0.8).attr('stroke', 'var(--surface)').attr('stroke-width', 1.5)
      .on('click', function (ev, p) { location.href = 'batch.html?c=' + encodeURIComponent(p.id); }).style('cursor', 'pointer')
      .on('mousemove', function (ev, p) { H.showTip(box, tip, ev, 'Batch ' + p.id, [p.ratio + ' nibs : sugar', hrs(p.hours_to_target) + ' to reach ' + (p.final_micron != null ? p.final_micron : p.target_micron != null ? p.target_micron : '?') + ' microns']); })
      .on('mouseleave', function () { tip.hidden = true; });
    H.chartIn(box, svg, tip);
  }

  /** Conching time against notes: one row per chocolate batch with a conching time, shortest first, each with its words beside it. */
  function conche(H, bs) {
    var el = H.el, box = $('making-conche');
    var rows = bs.filter(function (b) { return b.chocolate && b.conche_hours != null; }).sort(function (a, b) { return a.conche_hours - b.conche_hours || (a.id < b.id ? -1 : 1); });
    if (!rows.length) { box.replaceChildren(el('p', { className: 'note', text: 'No batch has a conching time yet. Finish a chocolate batch and enter it.' })); return; }
    var max = d3.max(rows, function (b) { return b.conche_hours; }) || 1;
    box.replaceChildren(el('ul', { className: 'conche' }, rows.map(function (b) {
      var bar = el('span', { className: 'cbar' }); bar.style.width = Math.max(4, Math.round(b.conche_hours / max * 100)) + '%';
      return el('li', {}, [
        el('a', { className: 'cid', href: 'batch.html?c=' + encodeURIComponent(b.id), text: b.id }),
        el('span', { className: 'ctrack' }, [bar]),
        el('span', { className: 'chrs n', text: b.conche_hours + ' h' + (b.conche_temp != null ? ' · ' + b.conche_temp + ' ' + UNIT : '') }),
        el('span', { className: 'cnote', text: [b.ratio ? b.ratio + ' nibs : sugar' : '', noteText(b)].filter(Boolean).join(' · ') || '–' }),
      ]);
    })));
  }

  /** Arrival checks: anything not OK on top, then newest first. Smell, taste and look as the person chose; weight against what was packed. */
  function arrivals(H, D) {
    var M = root.CH_MODEL, el = H.el;
    var seen = function (key) { return asked(H, 'arrival', key); }; // 2.3.0: the check-in's optional questions
    var pk = M.packages(D.tabs).filter(function (p) { return p.arrived; });
    var rows = pk.map(function (p) { // P2-A: ferment is "3.4, 3.5" for a package of a mixed roast
      var a = p.arrival, days = a.date && p.ship_date ? Math.round((Date.UTC(+a.date.slice(0, 4), +a.date.slice(5, 7) - 1, +a.date.slice(8, 10)) - Date.UTC(+p.ship_date.slice(0, 4), +p.ship_date.slice(5, 7) - 1, +p.ship_date.slice(8, 10))) / 864e5) : null;
      return { id: p.id, ferment: p.ferments.map(function (f) { return f.id; }).join(', '), ferments: p.ferments.map(function (f) { return f.id; }), date: a.date, packed: p.lbs, lbs: a.lbs, change: a.lbs != null && p.lbs != null ? Math.round((a.lbs - p.lbs) * 10) / 10 : null, days: days,
        smell: a.smell, taste: a.taste, look: a.look, notes: a.notes, bad: a.problems.length, problems: a.problems, flag: a.problems.length > 0,
        href: 'batch.html?p=' + encodeURIComponent(p.id) };
    }).sort(function (a, b) { return (b.bad > 0) - (a.bad > 0) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0); });
    $('arrivals-card').hidden = !rows.length;
    table(H, $('arrivals'), [
      { h: 'Package', k: 'id', id: 1, nw: 1 }, { h: 'Ferment', k: 'ferment', sort: 'id' }, { h: 'Arrived', k: 'date', nw: 1, f: function (r) { return H.short(r.date); } },
      { h: 'Days from shipping', k: 'days', n: 1, hideEmpty: 1, f: function (r) { return r.days; } },
      { h: 'Packed lbs', k: 'packed', n: 1, f: function (r) { return fmt1(r.packed); } }, { h: 'Arrived lbs', k: 'lbs', n: 1, f: function (r) { return fmt1(r.lbs); } },
      { h: 'Change lbs', k: 'change', n: 1, f: function (r) { return r.change == null ? '' : (r.change > 0 ? '+' : '') + fmt1(r.change); } },
      seen('smell') ? { h: 'Smell', k: 'smell', hideEmpty: 1 } : null, seen('taste') ? { h: 'Taste', k: 'taste', hideEmpty: 1 } : null, seen('look') ? { h: 'Look', k: 'look', hideEmpty: 1 } : null,
      seen('notes') ? { h: 'Notes', k: 'notes', t: 1, hideEmpty: 1 } : null,
    ].filter(Boolean), rows, true, 'Arrival checks');
    // the smell, taste and look words that were not fine, counted per ferment, so one that keeps arriving "Sharp" stands out
    var by = Object.create(null); // 2.4.2: keyed by ferment ID
    rows.forEach(function (r) { (r.ferments.length ? r.ferments : ['?']).forEach(function (id) { // a package of a mixed roast counts for each of its ferments
      var f = by[id] = by[id] || { ferment: id, n: 0, bad: 0, words: Object.create(null) };
      f.n++; if (r.bad) f.bad++;
      r.problems.forEach(function (w) { var word = (r[w.toLowerCase()] || '').trim(); var k = w + ': ' + word; f.words[k] = (f.words[k] || 0) + 1; });
    }); });
    var fl = Object.keys(by).map(function (k) { return by[k]; }).filter(function (f) { return f.bad; }).sort(function (a, b) { return b.bad - a.bad; });
    $('arrivals-by-ferment').hidden = !fl.length || !(seen('smell') || seen('taste') || seen('look')); // only about smell, taste and look
    if (fl.length) table(H, $('arrivals-by-ferment-table'), [
      { h: 'Ferment', k: 'ferment', id: 1 }, { h: 'Packages checked in', n: 1, f: function (r) { return String(r.n); } }, { h: 'With a problem', n: 1, f: function (r) { return String(r.bad); } },
      { h: 'What was not OK', f: function (r) { return Object.keys(r.words).map(function (k) { return k + (r.words[k] > 1 ? ' ×' + r.words[k] : ''); }).join(' · '); } },
    ], fl.map(function (f) { return Object.assign({}, f, { href: f.ferment === '?' ? '' : H.hrefOf(f.ferment) }); }), false);
  }

  function has(tabs) { return (tabs['Batches'] || []).length > 0; }
  /** 2.3.0: is this question still asked (Settings → What you track)? Charts, tiles and columns about it go when it is not. */
  function asked(H, form, key) { return !H.on || H.on(form, key); }

  function draw(D, H) {
    // (the tabs were once called T here, which hid the temperature unit of the same name: the page said "temperatures [object Object]")
    var M = root.CH_MODEL, tabs = D.tabs;
    var bs = M.batches(tabs), st = M.makingStock(tabs);
    var mine = bs.slice().sort(function (a, b) {
      var A = a[FIRST], B = b[FIRST];
      if (A == null || A === '') return 1; if (B == null || B === '') return -1; // no value sinks to the bottom whichever way it sorts
      return A < B ? 1 : A > B ? -1 : 0;
    });
    var choc = bs.filter(function (b) { return b.chocolate; }), done = bs.filter(function (b) { return b.finished; });
    var tt = choc.filter(function (b) { return b.hours_to_target != null; }), ch = choc.filter(function (b) { return b.conche_hours != null; });
    $('making-take').textContent = bs.length + (bs.length === 1 ? ' batch' : ' batches') + ' started, ' + done.length + ' finished, ' + fmt1(d3.sum(bs, function (b) { return b.nib_lbs; })) + ' lbs of nibs used' +
      (d3.sum(bs, function (b) { return b.shell_lbs; }) ? ' (and ' + fmt1(d3.sum(bs, function (b) { return b.shell_lbs; })) + ' lbs of shells)' : '') + '. ' +
      'Weights are in lbs' + (UNIT ? ', temperatures in ' + UNIT : '') + '.';
    var toTarget = asked(H, 'batch_finish', 'hours_to_target'), conching = asked(H, 'batch_finish', 'conche_hours');
    $('making-tiles').replaceChildren.apply($('making-tiles'), [
      tile(H, 'Batches', String(bs.length), '', st.open_batches + ' not finished'),
      tile(H, 'Made', done.length ? fmt1(d3.sum(done, function (b) { return b.output_lbs; })) : '–', 'lbs', 'out of finished batches'),
      toTarget ? tile(H, 'To target fineness', tt.length ? fmt1(d3.mean(tt, function (b) { return b.hours_to_target; })) : '–', 'h', 'average, chocolate batches') : null,
      conching ? tile(H, 'Conching', ch.length ? fmt1(d3.mean(ch, function (b) { return b.conche_hours; })) : '–', 'h', ch.length + (ch.length === 1 ? ' batch' : ' batches') + ' with a conching time') : null,
    ].filter(Boolean));
    var q = function (form, key, c) { return asked(H, form, key) ? c : null; };
    var notesOn = asked(H, 'batch_start', 'recipe') || asked(H, 'batch_start', 'notes') || asked(H, 'batch_finish', 'notes');
    table(H, $('making-table'), [
      { h: 'Batch', k: 'id', id: 1, nw: 1 }, { h: 'Started', k: 'start_date', nw: 1, f: function (r) { return H.short(r.start_date); } }, { h: 'Made for', k: 'destination' }, q('batch_start', 'recipe', { h: 'Recipe', k: 'recipe', nw: 1, hideEmpty: 1 }),
      { h: 'Nibs lbs', k: 'nib_lbs', n: 1, f: function (r) { return fmt1(r.nib_lbs); } }, { h: 'Shells lbs', k: 'shell_lbs', n: 1, hideEmpty: 1, f: function (r) { return r.shell_lbs ? fmt1(r.shell_lbs) : ''; } },
      { h: 'Nibs : sugar', k: 'nib_pct', n: 1, hideEmpty: 1, f: function (r) { return r.ratio; } },
      q('batch_start', 'target_micron', { h: 'Target microns', k: 'target_micron', n: 1, hideEmpty: 1 }), q('batch_finish', 'hours_to_target', { h: 'Hours to target', k: 'hours_to_target', n: 1, hideEmpty: 1, f: function (r) { return hrs(r.hours_to_target); } }),
      q('batch_finish', 'final_micron', { h: 'Microns reached', k: 'final_micron', n: 1, hideEmpty: 1 }), q('batch_finish', 'conche_hours', { h: 'Conche hours', k: 'conche_hours', n: 1, hideEmpty: 1, f: function (r) { return hrs(r.conche_hours); } }),
      q('batch_finish', 'conche_temp', { h: 'Conche ' + UNIT, k: 'conche_temp', n: 1, hideEmpty: 1 }), q('batch_finish', 'process_temp', { h: 'Process ' + UNIT, k: 'process_temp', n: 1, hideEmpty: 1 }),
      { h: 'Out lbs', k: 'output_lbs', n: 1, f: function (r) { return fmt1(r.output_lbs); } }, { h: 'Out ÷ in', k: 'out_pct', n: 1, f: function (r) { return pct(r.out_pct); } },
      q('batch_finish', 'output_units', { h: 'Pieces', k: 'output_units', n: 1, hideEmpty: 1 }), { h: 'Ferments', t: 1, f: mixText }, notesOn ? { h: 'Notes', t: 1, f: noteText, hideEmpty: 1 } : null,
    ].filter(Boolean), mine.map(function (r) { return Object.assign({}, r, { href: 'batch.html?c=' + encodeURIComponent(r.id) }); }), true, 'All batches');
    H.showCard($('making-scatter').closest('section'), toTarget); // the scatter is hours to target against nibs : sugar
    if (toTarget) scatter(H, bs);
    H.showCard($('making-conche').closest('section'), conching);
    if (conching) conche(H, bs);
    arrivals(H, D);
  }

  /** "Where its beans ended up" for the passport: Walpole's share of the story for one ferment. */
  function passport(D, H, fermentId) {
    var card = $('pp-making-card'), M = root.CH_MODEL;
    var pk = M.packages(D.tabs).filter(function (p) { return p.ferments.some(function (f) { return f.id === fermentId; }) && !/^shells?$/i.test(p.contents); }); // P2-A: also a package of a mixed roast
    var arrived = pk.filter(function (p) { return p.arrived; });
    var bs = M.batches(D.tabs), rows = [];
    bs.forEach(function (b) { b.inputs.filter(function (i) { return i.ferments.some(function (f) { return f.id === fermentId; }); }).forEach(function (i) { rows.push({ batch: b.id, destination: b.destination, start_date: b.start_date, finished: b.finished, package: i.package, lbs: i.lbs, out: b.output_lbs }); }); });
    card.hidden = !arrived.length && !rows.length;
    if (card.hidden) return;
    // P2-A: a package of a mixed roast counts by this ferment's share of it (the note then says "about")
    var share = function (p) { return d3.sum(p.ferments.filter(function (f) { return f.id === fermentId; }), function (f) { return f.share; }); };
    var sum = function (a, f) { return d3.sum(a, function (p) { return (f(p) || 0) * share(p); }); }, about = pk.some(function (p) { return p.mixed; }) ? 'about ' : '';
    $('pp-making-note').textContent = 'Of this ferment\'s nibs: ' + about + fmt1(sum(pk, function (p) { return p.lbs; })) + ' lbs packed, ' + fmt1(sum(arrived, function (p) { return p.arrival.lbs != null ? p.arrival.lbs : p.lbs; })) +
      ' lbs arrived in Walpole, ' + fmt1(sum(arrived, function (p) { return p.used_lbs; })) + ' lbs used in batches, ' + fmt1(sum(arrived, function (p) { return p.left; })) + ' lbs still there.';
    table(H, $('pp-making'), [
      { h: 'Batch', k: 'batch', id: 1, nw: 1 }, { h: 'Made for', k: 'destination' }, { h: 'Started', nw: 1, f: function (r) { return H.short(r.start_date); } },
      { h: 'Package', k: 'package', nw: 1 }, { h: 'Lbs used', n: 1, f: function (r) { return fmt1(r.lbs); } }, { h: 'Batch', f: function (r) { return r.finished ? 'Finished' + (r.out != null ? ' · ' + fmt1(r.out) + ' lbs out' : '') : 'In progress'; } },
    ], rows.map(function (r) { return Object.assign({}, r, { href: 'batch.html?c=' + encodeURIComponent(r.batch) }); }), false);
  }

  root.CH_DASH_MAKING = { draw: draw, passport: passport, has: has };
})(this);
