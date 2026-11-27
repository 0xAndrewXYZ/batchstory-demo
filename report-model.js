/*
 * Season report numbers (2.2.0): pure functions over the Sheet's tabs as `action=data` sends them, no DOM, no d3. Used by
 * report.js and tested in Node (tests/report.test.js). The definitions are the dashboard's, so the report and the dashboard
 * agree: wet and dry lbs and the yield count finished ferments only (wet and dry both recorded); a delivery's farm is
 * "Not stated" when empty; a ferment's wet lbs are the sum of its deliveries (else the recorded figure); a delivery's
 * estimated dry lbs are its share of the ferment's wet lbs (to 0.1%) times the ferment's dry lbs.
 *
 * Money is only here when the Sheet sent it (an admin, or a person marked "Can see money"): a tab without price columns
 * gives paid 0 everywhere, and the page checks `money` before it shows anything.
 */
(function (root) {
  'use strict';
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function num(v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v); }
  function sum(a, f) { return a.reduce(function (s, x) { var v = f(x); return s + (v == null ? 0 : v); }, 0); }
  function seasonOf(id) { return String(id).split('.')[0]; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function idKey(id) { var m = String(id).match(/^(\d+)\.(\d+)$/); return m ? +m[1] * 10000 + +m[2] : 0; }
  var NOT_STATED = 'Not stated';

  /** The seasons in the data, newest first. */
  function seasons(tabs) {
    var seen = Object.create(null); // no prototype: a name like "constructor" is just a name
    (tabs['Ferments'] || []).forEach(function (r) { var id = str(r['Ferment ID']); if (id) seen[seasonOf(id)] = true; });
    return Object.keys(seen).sort(function (a, b) { return b - a; });
  }

  /** The deliveries (Intakes) with the numbers the report needs. */
  function intakes(tabs) {
    return (tabs['Intakes'] || []).map(function (r) {
      return { id: str(r['Intake ID']), ferment: str(r['Ferment ID']), date: str(r['Date added']), farm: str(r['Farm']).trim() || NOT_STATED, paid_to: str(r['Paid to']).trim(),
        lbs: num(r['Wet lbs']), price: num(r['Price per lb (XCD)']), paid: num(r['Amount paid (XCD)']) };
    });
  }

  /** Every ferment: wet (its deliveries' sum), dry, yield (finished only) and what was paid for its deliveries. */
  function ferments(tabs, all) {
    return (tabs['Ferments'] || []).map(function (r) {
      var id = str(r['Ferment ID']);
      var mine = all.filter(function (i) { return i.ferment === id; });
      var wet = mine.length ? sum(mine, function (i) { return i.lbs; }) : num(r['Wet lbs']);
      var dry = num(r['Dry lbs']);
      return { id: id, season: seasonOf(id), load_date: str(r['Load date']), unload_date: str(r['Unload date']), bagged: str(r['Bagged date']), wet: wet, dry: dry,
        finished: !!(wet && dry != null), yield_pct: wet && dry != null ? Math.round(dry / wet * 1000) / 10 : null, deliveries: mine.length,
        paid: sum(mine, function (i) { return i.paid; }) };
    }).filter(function (f) { return f.id; });
  }

  /** Juice taken (P1-D): one total per unit for these ferments, never added together. Same rules as model.js juiceTotals: a value counts only when it is a number above 0;
   * each total is rounded to 0.1 or null when no ferment has that unit; ferments = how many had any. Reads the Ferments tab only. */
  function juiceOf(tabs, fs) {
    var ids = Object.create(null); fs.forEach(function (f) { ids[f.id] = true; });
    var t = { lbs: null, litres: null, gallons: null }, n = 0;
    (tabs['Ferments'] || []).forEach(function (r) {
      if (!ids[str(r['Ferment ID'])]) return;
      var any = false;
      [['lbs', 'Juice lbs'], ['litres', 'Juice litres'], ['gallons', 'Juice gallons']].forEach(function (u) {
        var v = num(r[u[1]]);
        if (v !== null && isFinite(v) && v > 0) { t[u[0]] = (t[u[0]] || 0) + v; any = true; }
      });
      if (any) n++;
    });
    ['lbs', 'litres', 'gallons'].forEach(function (u) { if (t[u] !== null) t[u] = Math.round(t[u] * 10) / 10; });
    return { lbs: t.lbs, litres: t.litres, gallons: t.gallons, ferments: n };
  }

  /**
   * One season (or 'all'). Returns {season, seasons, money, ferments, totals, farms, payees, payees_differ, statements}.
   * totals: ferments, finished, in_progress, wet, dry, yield_pct, lost, lost_pct (of the finished ferments' wet lbs), deliveries,
   * delivered_lbs, paid, paid_lbs (lbs of the deliveries that have an amount), avg_price (paid per wet lb of those), cost_per_dry
   * (paid for the finished ferments' paid deliveries ÷ their estimated dry lbs), first_date, last_date, juice ({lbs, litres, gallons, ferments}).
   */
  function build(tabs, opts) {
    opts = opts || {};
    var all = intakes(tabs), fAll = ferments(tabs, all);
    var list = seasons(tabs);
    var season = opts.season === 'all' ? 'all' : (list.indexOf(str(opts.season)) >= 0 ? str(opts.season) : (list[0] || 'all'));
    var inSeason = function (f) { return season === 'all' || f.season === season; };
    var fs = fAll.filter(inSeason).sort(function (a, b) { return idKey(a.id) - idKey(b.id); });
    var ids = Object.create(null); fs.forEach(function (f) { ids[f.id] = f; });
    var ins = all.filter(function (i) { return ids[i.ferment]; });
    ins.forEach(function (i) {
      var f = ids[i.ferment];
      i.share = f.wet ? Math.round((i.lbs || 0) / f.wet * 1000) / 10 : null; // as the dashboard: to 0.1%
      i.est_dry = f.dry != null && i.share != null ? Math.round(i.share / 100 * f.dry * 10) / 10 : null;
      i.finished = f.finished;
    });
    var done = fs.filter(function (f) { return f.finished; });
    var wet = sum(done, function (f) { return f.wet; }), dry = sum(done, function (f) { return f.dry; });
    var paidIns = ins.filter(function (i) { return i.paid > 0; });
    var paid = sum(ins, function (i) { return i.paid; }), paidLbs = sum(paidIns, function (i) { return i.lbs; });
    var doneIns = paidIns.filter(function (i) { return i.finished && i.est_dry != null; });
    var doneDry = sum(doneIns, function (i) { return i.est_dry; }), donePaid = sum(doneIns, function (i) { return i.paid; });
    var dates = ins.map(function (i) { return i.date; }).concat(fs.map(function (f) { return f.load_date; })).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
    var deliveredLbs = sum(ins, function (i) { return i.lbs; });
    var totals = {
      juice: juiceOf(tabs, fs),
      ferments: fs.length, finished: done.length, in_progress: fs.length - done.length, wet: wet, dry: dry,
      yield_pct: wet ? Math.round(dry / wet * 1000) / 10 : null, lost: wet - dry, lost_pct: wet ? r1(100 - Math.round(dry / wet * 1000) / 10) : null,
      deliveries: ins.length, delivered_lbs: deliveredLbs, paid: r2(paid), paid_lbs: paidLbs,
      avg_price: paidLbs ? r2(paid / paidLbs) : null, cost_per_dry: doneDry ? r2(donePaid / doneDry) : null,
      first_date: dates[0] || '', last_date: dates[dates.length - 1] || '',
    };

    // By farm, as the dashboard's "By farm" table (wet lbs, estimated dry lbs, ferments, paid) plus deliveries, share and average price.
    var byFarm = Object.create(null);
    ins.forEach(function (i) {
      var g = byFarm[i.farm] || (byFarm[i.farm] = { farm: i.farm, deliveries: 0, wet: 0, dry: 0, ferments: Object.create(null), paid: 0, paid_lbs: 0 });
      g.deliveries++; g.wet += i.lbs || 0; g.dry += i.est_dry || 0; g.ferments[i.ferment] = true; g.paid += i.paid || 0;
      if (i.paid > 0) g.paid_lbs += i.lbs || 0;
    });
    var farms = Object.keys(byFarm).map(function (k) {
      var g = byFarm[k];
      return { farm: g.farm, deliveries: g.deliveries, wet: g.wet, share: deliveredLbs ? Math.round(g.wet / deliveredLbs * 1000) / 10 : null, dry: g.dry, ferments: Object.keys(g.ferments).length,
        paid: r2(g.paid), paid_lbs: g.paid_lbs, avg_price: g.paid_lbs ? r2(g.paid / g.paid_lbs) : null };
    }).sort(function (a, b) { return b.wet - a.wet || (a.farm < b.farm ? -1 : 1); });

    // By payee ("Paid to"): only worth showing when someone other than the farm itself was paid.
    var byPayee = Object.create(null), differ = false;
    ins.forEach(function (i) {
      if (!i.paid_to) return;
      if (i.paid_to.toLowerCase() !== i.farm.toLowerCase()) differ = true;
      var g = byPayee[i.paid_to] || (byPayee[i.paid_to] = { payee: i.paid_to, farms: Object.create(null), deliveries: 0, wet: 0, paid: 0, paid_lbs: 0 });
      g.farms[i.farm] = true; g.deliveries++; g.wet += i.lbs || 0; g.paid += i.paid || 0;
      if (i.paid > 0) g.paid_lbs += i.lbs || 0;
    });
    var payees = Object.keys(byPayee).map(function (k) {
      var g = byPayee[k];
      return { payee: g.payee, farms: Object.keys(g.farms).sort(), deliveries: g.deliveries, wet: g.wet, paid: r2(g.paid), avg_price: g.paid_lbs ? r2(g.paid / g.paid_lbs) : null };
    }).sort(function (a, b) { return b.paid - a.paid || (a.payee < b.payee ? -1 : 1); });

    // One statement per farm, holding only that farm's deliveries.
    var statements = farms.filter(function (f) { return f.farm !== NOT_STATED; }).map(function (f) {
      var mine = ins.filter(function (i) { return i.farm === f.farm; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : idKey(a.ferment) - idKey(b.ferment); });
      return { farm: f.farm, lbs: f.wet, paid: f.paid, deliveries: f.deliveries, ferments: f.ferments,
        show_paid_to: mine.some(function (i) { return i.paid_to && i.paid_to.toLowerCase() !== i.farm.toLowerCase(); }),
        rows: mine.map(function (i) { return { date: i.date, ferment: i.ferment, lbs: i.lbs, price: i.price != null ? i.price : (i.paid > 0 && i.lbs ? r2(i.paid / i.lbs) : null), paid: i.paid, paid_to: i.paid_to }; }) };
    });

    return { season: season, seasons: list, ferments: fs, totals: totals, farms: farms, payees: payees, payees_differ: differ, statements: statements };
  }

  root.CH_REPORT = { build: build, seasons: seasons, NOT_STATED: NOT_STATED };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CH_REPORT;
})(typeof window !== 'undefined' ? window : globalThis);
