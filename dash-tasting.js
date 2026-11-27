/*
 * Dashboard: moisture while drying and tasting notes (script 2.4.0, app 1.16.0). All of it is worked out by docs/model.js from the
 * Drying log, Ferments and Tasting notes tabs; nothing here reads money (there is none in those tabs).
 *   Ferment passport: "Moisture while drying" (the ferment's readings by day, the target line, the final moisture ringed; only when it has
 *   readings) and "Tasting notes" (everything about it, its roasts, packages and batches; only when there are notes).
 *   Season view: "Moisture while drying" compares every finished ferment's curve (light lines, the selected one highlighted) and says how
 *   many days they took to reach the target moisture (the Lists tab's "Target moisture", 7% unless changed). Only when there is data.
 *   Home: "Recent tasting notes", the ones marked "something off" first. Only when there are notes.
 * dashboard.js passes in its helpers (H): el, axisStyle, tipFor, showTip, short, fmt, fmt1, season, pick, and sel() for the selected ferment.
 */
(function (root) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = root.CH_MODEL;

  /** One note as a list item (shared by the passport and the Now view). linkTo: show where it opens. */
  function noteItem(H, D, n, opts) {
    var el = H.el, link = n.orphan ? '' : M.tastingLink(D.tabs, n);
    var about = link ? el('a', { href: link, text: n.about }) : el('span', { text: n.about + (n.orphan ? ' (no longer in the records)' : '') });
    return el('li', { className: 'tnote' + (n.off ? ' off' : '') + (n.orphan ? ' orphan' : '') }, [
      el('div', { className: 'tnote-head' }, [
        el('strong', { text: H.short(n.date) || 'No date' }), about,
        n.sample ? el('span', { className: 'sub', text: n.sample }) : null,
        n.score != null ? el('span', { className: 'tnote-score', text: H.fmt1(n.score) + ' / 10' }) : null,
        n.off ? el('span', { className: 'badge bad', text: 'Something off' }) : null,
        n.by ? el('span', { className: 'sub', text: 'by ' + n.by }) : null,
      ]),
      n.flavours.length ? el('p', { className: 'tnote-words', text: n.flavours.join(' · ') }) : null,
      n.notes ? el('p', { className: 'quote', text: '“' + n.notes + '”' }) : null,
    ]);
  }

  /** Home: up to six recent notes, "something off" first. */
  function recent(H, D) {
    var card = $('tasting-recent-card');
    if (!card || !M) return;
    var notes = M.tastingRecent(D.tabs, 6);
    card.hidden = !notes.length;
    if (!notes.length) return;
    var ul = $('tasting-recent');
    ul.replaceChildren.apply(ul, notes.map(function (n) { return noteItem(H, D, n); }));
  }

  /** A ferment's own page: its moisture curve and its tasting trail. */
  function passport(H, D, sel) {
    var mc = $('pp-moisture-card'), tc = $('pp-tasting-card');
    if (!M || !mc || !tc) return;
    var curve = sel ? M.moistureCurve(D.tabs, sel, D.target_moisture) : null;
    mc.hidden = !(curve && curve.has);
    if (curve && curve.has) drawOne($('pp-moisture-chart'), H, curve, D.target_moisture_low);
    var notes = sel ? M.tastingTrail(D.tabs, 'Ferment', sel) : [];
    tc.hidden = !notes.length;
    if (notes.length) { var ul = $('pp-tasting'); ul.replaceChildren.apply(ul, notes.map(function (n) { return noteItem(H, D, n); })); }
    $('pp-tasting-add').href = 'index.html#/form/tasting_note?kind=Ferment&ferment=' + encodeURIComponent(sel || '');
  }

  /** The target as a shaded band (6-8%) when the script sent its lower end, else the dashed line alone. */
  function targetMark(svg, x0, x1, y, band, target) {
    if (band.has_band) svg.append('rect').attr('class', 'band').attr('x', x0).attr('width', x1 - x0).attr('y', y(band.high)).attr('height', Math.max(0, y(band.low) - y(band.high))).attr('fill', 'var(--chart-muted)').attr('fill-opacity', 0.25);
    svg.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(target)).attr('y2', y(target)).attr('stroke', 'var(--chart-muted)').attr('stroke-width', 1.5).attr('stroke-dasharray', '5 4');
    svg.append('text').attr('x', x0 + 8).attr('y', y(band.has_band ? band.high : target) - 6).attr('fill', 'var(--text-3)').style('font-size', '12px').text(band.has_band ? 'Target ' + band.text : 'target ' + target + '%');
  }

  function drawOne(box, H, curve, low) {
    var pts = curve.points, w = H.chartW(box), h = 240, m = { t: 14, r: 56, b: 30, l: 36 };
    var top = Math.max(10, Math.ceil(d3.max(pts, function (p) { return p.moisture; }) / 10) * 10);
    var ax = CH_MODEL.dayAxis(pts.map(function (p) { return p.day; }), { room: w < 500 ? 4 : 7 }); // starts at the first day with a reading
    var x = d3.scaleLinear([ax.lo, ax.hi], [m.l, w - m.r]);
    var y = d3.scaleLinear([0, Math.max(top, curve.target)], [h - m.b, m.t]);
    var svg = d3.create('svg').attr('width', '100%').attr('viewBox', '0 0 ' + w + ' ' + h).attr('role', 'img').attr('aria-label', 'Moisture by day of drying');
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat(function (v) { return v + '%'; }).tickSize(-(w - m.l - m.r))).call(H.axisStyle);
    svg.append('g').attr('transform', 'translate(0,' + (h - m.b) + ')').call(d3.axisBottom(x).tickValues(ax.ticks).tickFormat(function (v) { return 'Day ' + v; }).tickSize(0).tickPadding(8)).call(H.axisStyle);
    targetMark(svg, m.l, w - m.r, y, M.targetBand(low, curve.target), curve.target);
    svg.append('path').attr('d', d3.line().x(function (p) { return x(p.day); }).y(function (p) { return y(p.moisture); })(pts)).attr('fill', 'none').attr('stroke', 'var(--chart-3)').attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    svg.append('g').selectAll('circle').data(pts.filter(function (p) { return !p.final; })).join('circle').attr('cx', function (p) { return x(p.day); }).attr('cy', function (p) { return y(p.moisture); }).attr('r', 3).attr('fill', 'var(--chart-3)');
    if (curve.final) {
      svg.append('circle').attr('class', 'final-mark').attr('cx', x(curve.final.day)).attr('cy', y(curve.final.moisture)).attr('r', 6).attr('fill', 'var(--surface)').attr('stroke', 'var(--chart-3)').attr('stroke-width', 2);
      svg.append('text').attr('x', x(curve.final.day)).attr('y', y(curve.final.moisture) - 12).attr('text-anchor', 'middle').attr('fill', 'var(--text)').style('font-size', '12px').text('final ' + curve.final.moisture + '%');
    }
    var tip = H.tipFor(box);
    svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', function (p) { return x(p.day); }).attr('cy', function (p) { return y(p.moisture); }).attr('r', 9).attr('fill', 'transparent')
      .on('mousemove', function (ev, p) { H.showTip(box, tip, ev, H.short(p.date) + ' · day ' + p.day, [p.moisture + '% moisture' + (p.final ? ' (final)' : '')]); })
      .on('mouseleave', function () { tip.hidden = true; });
    box.replaceChildren(svg.node(), tip);
  }

  /** Season view: every finished ferment's curve, the selected one highlighted, and how long they took to reach the target. */
  function compare(H, D, sel) {
    var card = $('moist-compare-card');
    if (!card || !M) return;
    var curves = M.moistureCurves(D.tabs, { finished: true, season: H.season(), target: D.target_moisture });
    card.hidden = !curves.length;
    if (!curves.length) return;
    var tg = curves[0].target, st = M.daysToTarget(curves);
    var stat = function (v, label) { return H.el('div', { className: 'stat' }, [H.el('b', { text: v }), H.el('span', { text: label })]); };
    var stats = $('moist-stats');
    stats.replaceChildren.apply(stats, [
      stat(st.mean == null ? '–' : H.fmt1(st.mean), 'days to reach ' + tg + '% (average)'),
      st.reached ? stat(st.min === st.max ? String(st.min) : st.min + ' to ' + st.max, 'days, fastest to slowest') : null,
      stat(st.reached + ' of ' + st.n, 'finished ferments reached ' + tg + '%'),
    ]);
    var box = $('moist-compare-chart');
    var w = H.chartW(box), h = 240, m = { t: 14, r: 56, b: 30, l: 36 };
    var all = [].concat.apply([], curves.map(function (c) { return c.points; }));
    var ax = CH_MODEL.dayAxis(all.map(function (p) { return p.day; }), { room: w < 500 ? 4 : 8 });
    var x = d3.scaleLinear([ax.lo, ax.hi], [m.l, w - m.r]);
    var y = d3.scaleLinear([0, Math.max(10, Math.ceil(d3.max(all, function (p) { return p.moisture; }) / 10) * 10)], [h - m.b, m.t]);
    var svg = d3.create('svg').attr('width', '100%').attr('viewBox', '0 0 ' + w + ' ' + h).attr('role', 'img').attr('aria-label', 'Moisture by day of drying, every finished ferment');
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat(function (v) { return v + '%'; }).tickSize(-(w - m.l - m.r))).call(H.axisStyle);
    svg.append('g').attr('transform', 'translate(0,' + (h - m.b) + ')').call(d3.axisBottom(x).tickValues(ax.ticks).tickFormat(function (v) { return 'Day ' + v; }).tickSize(0).tickPadding(8)).call(H.axisStyle);
    targetMark(svg, m.l, w - m.r, y, M.targetBand(D.target_moisture_low, tg), tg);
    var line = d3.line().x(function (p) { return x(p.day); }).y(function (p) { return y(p.moisture); });
    // pl2: the picked ferment, or the newest one with readings, so one line is always in colour (IDs are text: 2.10 comes after 2.9)
    var key = function (id) { var k = String(id).match(/^(\d+)\.(\d+)$/); return k ? +k[1] * 10000 + +k[2] : 0; };
    var lit = curves.some(function (c) { return c.ferment === sel; }) ? sel : curves.slice().sort(function (a, b) { return key(a.ferment) - key(b.ferment); })[curves.length - 1].ferment;
    curves.slice().sort(function (a, b) { return (a.ferment === lit) - (b.ferment === lit); }).forEach(function (c) {
      var on = c.ferment === lit;
      svg.append('path').attr('class', on ? 'moist-pick' : 'moist-faint').attr('d', line(c.points)).attr('fill', 'none').attr('stroke', on ? 'var(--chart-3)' : 'var(--chart-muted)')
        .attr('stroke-width', on ? 2 : 1.25).attr('opacity', on ? 1 : 0.8).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      if (on) {
        var last = c.points[c.points.length - 1];
        svg.append('text').attr('x', x(last.day) + 8).attr('y', y(last.moisture) + 4).attr('fill', 'var(--text)').style('font-size', '12px').text(c.ferment);
      }
    });
    var tip = H.tipFor(box);
    svg.append('g').selectAll('circle').data([].concat.apply([], curves.map(function (c) { return c.points.map(function (p) { return { c: c.ferment, p: p }; }); }))).join('circle')
      .attr('cx', function (d) { return x(d.p.day); }).attr('cy', function (d) { return y(d.p.moisture); }).attr('r', 7).attr('fill', 'transparent').style('cursor', 'pointer')
      .on('click', function (ev, d) { H.pick(d.c); })
      .on('mousemove', function (ev, d) { H.showTip(box, tip, ev, 'Ferment ' + d.c + ' · day ' + d.p.day, [d.p.moisture + '% moisture' + (d.p.final ? ' (final)' : ''), H.short(d.p.date)]); })
      .on('mouseleave', function () { tip.hidden = true; });
    box.replaceChildren(svg.node(), tip);
  }

  root.CH_DASH_TASTING = { recent: recent, passport: passport, compare: compare };
})(window);
