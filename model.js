/*
 * Cocoahead data model: pure functions over the Sheet's tabs (as sent by action=data), no DOM, no d3.
 * Used by the dashboard and tested in Node (tests/model.test.js).
 *
 * Inventory is always worked out from the entries, never stored: every stage's lbs come from what was
 * logged. Stages after bagging (roasting, packing, shipping, Walpole) will be added here from the
 * factory and Walpole tabs, the same way. Roasting (stage 2) is in: bagged beans in store are what was bagged minus what
 * went into the roaster, and roastStock() / ledger() carry the beans on from there. Making (stage 3) is in too: a package that
 * has arrived in Walpole is stock there (arrived minus what batches used, never below 0), see makingStock() and batches().
 */
(function (root) {
  'use strict';
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function num(v) { return v === '' || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v); } // 2.4.2: never Infinity ("Infinity", 1e400)
  // 2.4.2: every map keyed by an ID or a name has no prototype, so an ID like "constructor" or "toString" is only an ID
  function map() { return Object.create(null); }
  function sum(a, f) { return a.reduce(function (s, x) { var v = f(x); return s + (v == null ? 0 : v); }, 0); }
  function seasonOf(id) { return String(id).split('.')[0]; }
  // config.js (loaded first on the dashboard; read from the file in Node tests): the unit in Making's temperature column names
  var CONF = root.CH_CONFIG || (typeof module !== 'undefined' && typeof require === 'function' ? require('./config.js') : {});
  var TEMP = (CONF.units || {}).makingTemp; // e.g. '°F'

  /** Each ferment with the numbers inventory needs. Wet lbs = sum of its deliveries (else the recorded figure). */
  function ferments(tabs) {
    var intakes = (tabs['Intakes'] || []);
    return (tabs['Ferments'] || []).map(function (r) {
      var id = str(r['Ferment ID']);
      var mine = intakes.filter(function (i) { return str(i['Ferment ID']) === id; });
      var wet = mine.length ? sum(mine, function (i) { return num(i['Wet lbs']); }) : num(r['Wet lbs']);
      var dry = num(r['Dry lbs']);
      var bagged = str(r['Bagged date']);
      var unload = str(r['Unload date']);
      var load = str(r['Load date']);
      return {
        id: id, season: seasonOf(id), wet: wet, dry: dry, bags: num(r['Bags']), labels: str(r['Bag labels']),
        load_date: load, unload_date: unload, bagged_date: bagged,
        stage: bagged || dry != null ? 'bagged' : unload ? 'drying' : load ? 'fermenting' : 'planned',
      };
    }).filter(function (f) { return f.id; });
  }

  /** Wet → dry yield (%) over finished ferments, or null when none are finished. */
  function yieldPct(list) {
    var done = list.filter(function (f) { return f.wet && f.dry != null; });
    var w = sum(done, function (f) { return f.wet; }), d = sum(done, function (f) { return f.dry; });
    return w ? Math.round(d / w * 1000) / 10 : null;
  }

  /**
   * Where the beans are, for one season (default: the Lists tab's current season, else the newest in the data).
   * Returns lbs and ferments per stage. Beans still drying also get the dry lbs to expect, at the season's
   * yield so far, else the yield over every finished ferment on record, else 35%.
   */
  function inventory(tabs, opts) {
    opts = opts || {};
    var all = ferments(tabs);
    var seasons = all.map(function (f) { return f.season; }).sort(function (a, b) { return Number(b) - Number(a); });
    var season = str(opts.season) || seasons[0] || '';
    var fs = all.filter(function (f) { return f.season === season; });
    var y = yieldPct(fs);
    var ySource = 'season';
    if (y == null) { y = yieldPct(all); ySource = 'all'; }
    if (y == null) { y = 35; ySource = 'typical'; }
    var by = function (st) { return fs.filter(function (f) { return f.stage === st; }); };
    var fermenting = by('fermenting'), drying = by('drying'), bagged = by('bagged');
    // Dry beans in store = what was bagged minus what went into the roaster (0 once a roast was marked "last of this ferment").
    // With no roast on record every number is exactly as before.
    var roastedBy = roastedByFerment(tabs);
    bagged.forEach(function (f) {
      var r = roastedBy[f.id];
      f.roasted = r ? r.beans_in : 0;
      f.closed = !!(r && r.closed);
      f.left = r ? (r.closed ? 0 : Math.max(0, (f.dry || 0) - r.beans_in)) : f.dry;
    });
    var inStore = bagged.filter(function (f) { return !f.closed && !(f.roasted > 0 && f.left <= 0); });
    return {
      season: season, yield: y, yield_source: ySource,
      fermenting: { n: fermenting.length, wet: sum(fermenting, function (f) { return f.wet; }), ferments: fermenting },
      drying: { n: drying.length, wet: sum(drying, function (f) { return f.wet; }), expected_dry: Math.round(sum(drying, function (f) { return f.wet; }) * y / 100), ferments: drying },
      bagged: { n: inStore.length, dry: sum(inStore, function (f) { return f.left; }), dry_bagged: sum(bagged, function (f) { return f.dry; }), roasted: sum(bagged, function (f) { return f.roasted; }),
        bags: sum(inStore, function (f) { return f.bags; }), ferments: inStore, all: bagged },
      roasting: roastStock(tabs),
      making: makingStock(tabs),
    };
  }

  /* ---------------- Roasting (stage 2) ----------------
   * Lbs, °C. Everything is added up from the Roasts, Packages and Shipments tabs; the ✱ columns are never read.
   * ASSUMPTIONS [A1] one roast per package (P2-A: a roast can take beans from several ferments, roastInputs); [A5] winnowing once per roast (see README "Roasting").
   */
  function yes(v) { return str(v).trim().toLowerCase() === 'yes'; }
  function r1(n) { return n == null ? null : Math.round(n * 10) / 10; }
  /** A clock time as the Sheet shows it ("09:05", "9:05:00", "9:05 AM") in minutes since midnight, or null. */
  function clock(t) {
    var m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*$/.exec(str(t));
    if (!m) return null;
    var h = Number(m[1]), ap = m[3] && m[3].toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h * 60 + Number(m[2]);
  }
  /** Minutes from one clock time to a later one; a roast that runs past midnight still works. */
  function minutesBetween(a, b) {
    var x = clock(a), y = clock(b);
    return x === null || y === null ? null : (((y - x) % 1440) + 1440) % 1440;
  }
  function fermentOfRoast(id) { var m = /^(\d+\.\d+)-R\d+$/.exec(str(id)); return m ? m[1] : ''; } // an OLD roast number only (3.4-R2); R3.1 names no ferment
  /** The season of a roast number: "3" for R3.1 (P2-A); an old number (3.4-R2) gives its ferment's season. '' for neither. */
  function seasonOfRoastId(id) { var m = /^R(\d+)\.\d+$/.exec(str(id)); return m ? m[1] : fermentOfRoast(id) ? seasonOf(fermentOfRoast(id)) : ''; }
  /** The roast a package number belongs to, either shape (R3.1-P2 → R3.1, 3.4-R2-P1 → 3.4-R2); '' for anything else. */
  function roastOfPackage(pid) { return (/^((?:\d+\.\d+-R\d+|R\d+\.\d+))-P\d+$/.exec(str(pid)) || [])[1] || ''; }

  /**
   * P2-A: which ferments went into each roast. {roast id: [{ferment, lbs, last, share}]}, in the order the lines were written.
   *   - A roast with rows in Roast inputs is read from those rows only (they win: its Roasts "Ferment ID" is never counted too).
   *   - A roast made before P2-A (Roasts "Ferment ID" filled, no input rows) is one line: its Beans in lbs, "Last of ferment", share 1.
   *   - share: the line's lbs over the roast's lines added up (equal shares when no line has a weight). Shares add up to 1.
   * Input rows whose roast is not on the Roasts tab are still listed (their beans did go into a roaster).
   */
  function roastInputs(tabs) {
    var out = map();
    (tabs['Roast inputs'] || []).forEach(function (x) {
      var rid = str(x['Roast ID']), f = str(x['Ferment ID']);
      if (!rid || !f) return;
      (out[rid] = out[rid] || []).push({ ferment: f, lbs: num(x['Lbs']), last: yes(x['Last of ferment']) });
    });
    Object.keys(out).forEach(shares);
    (tabs['Roasts'] || []).forEach(function (r) {
      var rid = str(r['Roast ID']), f = str(r['Ferment ID']);
      if (!rid || !f || out[rid] && !out[rid].old) return; // input rows win
      if (!out[rid]) { out[rid] = []; Object.defineProperty(out[rid], 'old', { value: true }); }
      out[rid].push({ ferment: f, lbs: num(r['Beans in lbs']), last: yes(r['Last of ferment']) });
      shares(rid);
    });
    function shares(rid) {
      var ls = out[rid], tot = sum(ls, function (x) { return x.lbs; });
      ls.forEach(function (x) { x.share = tot > 0 ? (x.lbs || 0) / tot : 1 / ls.length; });
    }
    return out;
  }
  /** {ferment: share} of one roast (from roastInputs); an old number not in the records is its ferment's, all of it. */
  function sharesOf(ins, rid) {
    var o = map(), ls = ins[rid];
    if (ls && ls.length) ls.forEach(function (x) { o[x.ferment] = (o[x.ferment] || 0) + x.share; });
    else if (fermentOfRoast(rid)) o[fermentOfRoast(rid)] = 1;
    return o;
  }

  /** Packages with where each one is now: packed, or shipped on a date. */
  function packages(tabs) {
    var ships = map(), arr = arrivals(tabs), used = map(), ins = roastInputs(tabs);
    (tabs['Shipments'] || []).forEach(function (s) { ships[str(s['Shipment ID'])] = s; });
    (tabs['Batch inputs'] || []).forEach(function (x) {
      var k = str(x['Package ID']);
      if (!k) return;
      var o = used[k] = used[k] || { lbs: 0, emptied: false, batches: [] };
      o.lbs += num(x['Lbs used']) || 0; if (yes(x['Emptied'])) o.emptied = true;
      if (o.batches.indexOf(str(x['Batch ID'])) < 0) o.batches.push(str(x['Batch ID']));
    });
    var local = map(); // P2-F: what was taken from each package kept for local use
    (tabs['Local use'] || []).forEach(function (x) {
      var k = str(x['Package ID']);
      if (!k) return;
      var o = local[k] = local[k] || { lbs: 0, emptied: false };
      o.lbs += num(x['Lbs used']) || 0; if (yes(x['Emptied'])) o.emptied = true;
    });
    return (tabs['Packages'] || []).map(function (r) {
      var sid = str(r['Shipment ID']), roast = str(r['Roast ID']), id = str(r['Package ID']), a = arr[id] || null, u = used[id] || null;
      var lbs = num(r['Lbs']), had = a ? (a.lbs != null ? a.lbs : lbs) : 0;
      // P2-A: a package's ferments are its roast's lines (share of each); one ferment → ferment is it, several → ferment is ''
      var sh = sharesOf(ins, roast), fl = Object.keys(sh).map(function (f) { return { id: f, share: sh[f] }; });
      return { id: id, roast: roast, ferments: fl, ferment: fl.length === 1 ? fl[0].id : '', mixed: fl.length > 1, contents: str(r['Contents']) || 'Nibs', type: str(r['Package type']), lbs: lbs,
        'for': /^local use$/i.test(str(r['For']).trim()) ? 'Local use' : 'Shipping', // blank reads as Shipping
        pack_date: str(r['Pack date']), last_of_roast: yes(r['Last of roast']), shipment: sid, ship_date: sid && ships[sid] ? str(ships[sid]['Ship date']) : '',
        carrier: sid && ships[sid] ? str(ships[sid]['Carrier']) : '', notes: str(r['Notes']),
        arrival: a, arrived: !!a, used_lbs: u ? r1(u.lbs) : 0, emptied: !!(u && u.emptied), batches: u ? u.batches : [],
        left: a && !(u && u.emptied) ? r1(Math.max(0, had - (u ? u.lbs : 0))) : 0, // never below 0; a package that was never checked in is not stock in Walpole
        where: a ? (u && u.emptied ? 'used up' : u ? 'in use' : 'arrived') : sid ? 'shipped' : 'packed' };
    }).filter(function (p) { return p.id; }).map(function (p) { // P2-F: added fields only
      var l = local[p.id] || null;
      p.local_used = l ? r1(l.lbs) : 0; p.local_emptied = !!(l && l.emptied);
      p.local_left = p.local_emptied ? 0 : r1(Math.max(0, (p.lbs || 0) - p.local_used));
      return p;
    });
  }
  /**
   * P2-F: the Local use tab, newest first: what was taken from packages kept for local use and what for. n, lbs (all of it) and
   * by_for [{used_for, n, lbs}] (biggest first). A row with no Used for counts under "Not said". Reads only.
   */
  function localUse(tabs) {
    var rows = (tabs['Local use'] || []).map(function (x) {
      return { id: str(x['Local use ID']), package: str(x['Package ID']), date: str(x['Use date']), used_for: str(x['Used for']), lbs: num(x['Lbs used']) || 0, emptied: yes(x['Emptied']), notes: str(x['Notes']) };
    }).filter(function (x) { return x.package || x.id; });
    var by = map();
    rows.forEach(function (x) { var k = x.used_for || 'Not said', o = by[k] = by[k] || { used_for: k, n: 0, lbs: 0 }; o.n++; o.lbs += x.lbs; });
    return {
      n: rows.length, lbs: r1(sum(rows, function (x) { return x.lbs; })),
      by_for: Object.keys(by).map(function (k) { return { used_for: k, n: by[k].n, lbs: r1(by[k].lbs) }; }).sort(function (a, b) { return b.lbs - a.lbs; }),
      rows: rows.slice().reverse(),
    };
  }

  /* ---------------- P2-E: pallets (one shipment = one pallet) ---------------- */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayWords(iso) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(str(iso)); return m && MON[Number(m[1]) - 1] ? MON[Number(m[1]) - 1] + ' ' + Number(m[2]) : str(iso); }
  function natCmp(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }
  /**
   * Where a pallet is: 'arriving' (some of its packages checked in) or 'arrived' (all of them), whether or not its Left port date was
   * filled in (Phase 2 review L1: a package checked in at Walpole has left the port); otherwise 'at port' (no Left port date) or 'on the water'.
   */
  function palletState(left, n, arrivedN) {
    if (arrivedN) return arrivedN < n ? 'arriving' : 'arrived';
    return left ? 'on the water' : 'at port';
  }
  /**
   * One row per pallet (Shipments tab): {id, to_port, left_port, destination, carrier, tracking, notes, n, lbs, ferments, arrived_n, state, days}.
   * to_port is the Ship date (the day it was taken to the port); days = whole days since left_port (null while at the port). today: 'YYYY-MM-DD'
   * (defaults to now). Newest first. Nothing here is money.
   */
  function pallets(tabs, today) {
    var pk = packages(tabs), t = dayNum(today || new Date().toISOString().slice(0, 10));
    return (tabs['Shipments'] || []).map(function (x) {
      var id = str(x['Shipment ID']);
      if (!id) return null;
      var mine = pk.filter(function (p) { return p.shipment === id && p['for'] !== 'Local use'; }), seen = {}, ferments = []; // slice B: a package kept for local use is never on a pallet's list
      mine.forEach(function (p) { p.ferments.forEach(function (f) { if (!seen[f.id]) { seen[f.id] = 1; ferments.push(f.id); } }); });
      var left = str(x['Left port date']), arrivedN = mine.filter(function (p) { return p.arrived; }).length, ld = dayNum(left);
      return { id: id, to_port: str(x['Ship date']), left_port: left, destination: str(x['Destination']), carrier: str(x['Carrier']), tracking: str(x['Tracking']), notes: str(x['Notes']),
        n: mine.length, lbs: r1(mine.reduce(function (s, p) { return s + (p.lbs || 0); }, 0)), ferments: ferments.sort(natCmp).join(', '), arrived_n: arrivedN,
        state: palletState(left, mine.length, arrivedN), days: ld !== null && t !== null ? Math.max(0, t - ld) : null };
    }).filter(Boolean).sort(function (a, b) { return a.to_port < b.to_port ? 1 : a.to_port > b.to_port ? -1 : natCmp(b.id, a.id); });
  }
  /**
   * The Making area's Home rows: a pallet at the port or on the water (what the phone knows: o.shipments = [{id, date, left_port}], o.packages = [{shipment, arrived}]).
   * [{kind: 'pallet', id, text, actions: []}], oldest first; a pallet with a package already checked in is no longer "on the water".
   */
  function palletProgress(o) {
    o = o || {};
    var pk = o.packages || [];
    return (o.shipments || []).map(function (s) {
      var id = str(s && s.id);
      if (!id) return null;
      var mine = pk.filter(function (p) { return onPallet(p, id); }), arrivedN = mine.filter(function (p) { return p.arrived; }).length;
      var state = palletState(str(s.left_port), mine.length, arrivedN);
      if (state === 'arrived') return null; // gone once the last package is checked in
      var n = mine.length, pk1 = n + (n === 1 ? ' package' : ' packages');
      var text = state === 'arriving' ? pk1 + ' · ' + arrivedN + ' of ' + n + ' checked in'
        : pk1 + ' · ' + (state === 'at port' ? 'at the port' + (str(s.date) ? ' since ' + dayWords(s.date) : '') : 'on the water' + (str(s.left_port) ? ' since ' + dayWords(s.left_port) : ''));
      return { kind: 'pallet', id: id, date: str(s.date), n: n, text: text, actions: [] };
    }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : natCmp(a.id, b.id); }).map(function (r) { delete r.date; return r; });
  }
  /** A package that is on this pallet: its shipment is the pallet (exact text) and it is not kept for local use. */
  function isLocalFor(v) { return /^local use$/i.test(str(v).trim()); }
  function onPallet(p, id) { return !!p && str(p.shipment) === id && !isLocalFor(p['for']); }
  /**
   * Slice B: what is on one pallet (read only; nothing here is money). pallet: {id, date (to port), left_port, destination};
   * packages: [{id, roast, contents, lbs, for, arrived, shipment}] (any packages; only this pallet's are used);
   * roastFerments: {roast ID: [ferment IDs]} (a roast missing from it has no ferments shown, never a guess).
   * Returns {id, date, left_port, destination, state, n, arrived_n, lbs, rows: [{i, n, id, roast, ferments: [ids], contents, lbs, for, arrived}]}
   * in natural ID order. Every ID is compared as text (S26-01 is not S26-010, R3.1-P1 is not R3.10-P1). Rows are built from named fields only.
   */
  function palletContents(pallet, packages, roastFerments) {
    pallet = pallet || {};
    var id = str(pallet.id), rf = roastFerments || {};
    var mine = (packages || []).filter(function (p) { return onPallet(p, id); }).sort(function (a, b) { return natCmp(a.id, b.id); });
    var n = mine.length, arrivedN = 0, total = 0, unweighed = 0;
    var rows = mine.map(function (p, i) {
      var rid = str(p.roast), fs = Object.prototype.hasOwnProperty.call(rf, rid) && Array.isArray(rf[rid]) ? rf[rid].map(function (x) { return str(x && typeof x === 'object' ? x.id : x); }).filter(Boolean) : [];
      var seen = {}; fs = fs.filter(function (f) { if (seen[f]) return false; seen[f] = 1; return true; }).sort(natCmp);
      var lbs = num(p.lbs); if (lbs === null) unweighed++; total += lbs || 0; if (p.arrived) arrivedN++;
      return { i: i + 1, n: n, id: str(p.id), roast: rid, ferments: fs, contents: str(p.contents) || 'Nibs', lbs: lbs, 'for': 'Shipping', arrived: !!p.arrived };
    });
    return { id: id, date: str(pallet.date), left_port: str(pallet.left_port), destination: str(pallet.destination), state: palletState(str(pallet.left_port), n, arrivedN), n: n, arrived_n: arrivedN, lbs: r1(total), unweighed: unweighed, rows: rows };
  }
  /** Feeder 1 (dashboard, batch page): from the tabs. null when the Shipments tab has no such pallet. */
  function palletContentsFromTabs(tabs, id) {
    id = str(id);
    var x = (tabs['Shipments'] || []).filter(function (r) { return str(r['Shipment ID']) === id; })[0];
    if (!x) return null;
    var rf = map(), pk = packages(tabs).map(function (p) {
      rf[p.roast] = p.ferments.map(function (f) { return f.id; });
      return { id: p.id, roast: p.roast, contents: p.contents, lbs: p.lbs, 'for': p['for'], arrived: p.arrived, shipment: p.shipment };
    });
    return palletContents({ id: id, date: str(x['Ship date']), left_port: str(x['Left port date']), destination: str(x['Destination']) }, pk, rf);
  }
  /**
   * Feeder 2 (the field app): from what the phone holds. o = {shipments: known('shipment'), packages: known('package'), roasts: the lists' roasts}.
   * The same inputs the Home row uses, so this phone's own unsent Ship and Check in entries count the same way.
   */
  function palletContentsFromLists(id, o) {
    o = o || {}; id = str(id);
    var s = (o.shipments || []).filter(function (x) { return str(x && x.id) === id; })[0];
    if (!s) return null;
    var rf = map();
    (o.roasts || []).forEach(function (r) { if (r && str(r.id)) rf[str(r.id)] = (r.ferments || []).map(function (f) { return str(f && typeof f === 'object' ? f.id : f); }).filter(Boolean); });
    var pk = (o.packages || []).map(function (p) { return { id: p.id, roast: p.roast, contents: p.contents, lbs: p.lbs, 'for': p['for'], arrived: p.arrived, shipment: p.shipment }; });
    return palletContents({ id: id, date: s.date, left_port: s.left_port, destination: s.destination }, pk, rf);
  }

  /* ---------------- Making (stage 3) ----------------
   * Lbs, and temperatures in TEMP (config.js units.makingTemp, °F). Arrivals, Batches and Batch inputs. ASSUMPTIONS: see README "Making (Walpole)".
   * A word on the "Arrival check" list counts as fine when it is one of these (any case); any other word is a problem. If the words on the
   * Lists page are renamed, add the new "fine" word here.
   */
  var OK_WORDS = ['ok', 'okay', 'good', 'fine'];
  function checkOk(v) { var t = str(v).trim().toLowerCase(); return t === '' ? null : OK_WORDS.indexOf(t) >= 0; }
  /** {package id: arrival}: the check-in of each package. problems = which of smell, taste, look were not fine. */
  function arrivals(tabs) {
    var out = map();
    (tabs['Arrivals'] || []).forEach(function (r) {
      var id = str(r['Package ID']);
      if (!id) return;
      var smell = str(r['Smell']), taste = str(r['Taste']), look = str(r['Look']);
      var problems = [['Smell', smell], ['Taste', taste], ['Look', look]].filter(function (x) { return checkOk(x[1]) === false; }).map(function (x) { return x[0]; });
      out[id] = { package: id, date: str(r['Arrival date']), lbs: num(r['Arrival lbs']), smell: smell, taste: taste, look: look, notes: str(r['Notes']),
        problems: problems, ok: problems.length ? false : (checkOk(smell) === null && checkOk(taste) === null && checkOk(look) === null ? null : true) };
    });
    return out;
  }
  /** "70 : 30" (nib share first) from nib and sugar lbs, or '' unless both are known. */
  function nibSugar(nib, sugar) {
    if (nib == null || sugar == null || nib + sugar <= 0) return '';
    var a = Math.round(nib / (nib + sugar) * 100);
    return a + ' : ' + (100 - a);
  }
  /**
   * Each batch with what went in (per package, per ferment: lbs from a package → its roast → its ferment), the nib : sugar ratio and
   * the numbers of the process. Chocolate batches carry the conching and fineness numbers; the rest carry weights and temperatures.
   */
  function batches(tabs) {
    var pk = packages(tabs), byId = map();
    pk.forEach(function (p) { byId[p.id] = p; });
    var inputs = (tabs['Batch inputs'] || []);
    return (tabs['Batches'] || []).map(function (r) {
      var id = str(r['Batch ID']);
      var ins = inputs.filter(function (x) { return str(x['Batch ID']) === id; }).map(function (x) {
        var p = byId[str(x['Package ID'])];
        var old = fermentOfRoast(str(x['Package ID'])), fl = p ? p.ferments : old ? [{ id: old, share: 1 }] : []; // P2-A: a package of a mixed roast holds several ferments
        return { id: str(x['Input ID']), package: str(x['Package ID']), lbs: num(x['Lbs used']), emptied: yes(x['Emptied']), roast: p ? p.roast : '',
          ferment: fl.length === 1 ? fl[0].id : '', ferments: fl, contents: p ? p.contents : '' };
      });
      // a shells package is not nibs: its lbs are counted apart (shell_lbs), still part of what went in
      var nib = sum(ins.filter(function (i) { return !isShells(i.contents); }), function (i) { return i.lbs; }), shell = sum(ins.filter(function (i) { return isShells(i.contents); }), function (i) { return i.lbs; });
      var sugar = num(r['Sugar lbs']), butter = num(r['Cocoa butter lbs']), other = num(r['Other lbs']);
      var total = nib + shell + (sugar || 0) + (butter || 0) + (other || 0), out = num(r['Output lbs']);
      var mix = map();
      ins.forEach(function (i) { // each ferment's share of the nibs (P2-A: a mixed package's lbs split by its ferments' shares)
        if (!i.lbs || isShells(i.contents)) return;
        if (!i.ferments.length) mix['?'] = (mix['?'] || 0) + i.lbs;
        i.ferments.forEach(function (f) { mix[f.id] = (mix[f.id] || 0) + i.lbs * f.share; });
      });
      var finish = str(r['Finish date']);
      return {
        id: id, start_date: str(r['Start date']), destination: str(r['Destination']), recipe: str(r['Recipe']), sugar: sugar, butter: butter, other: str(r['Other ingredients']), other_lbs: other,
        target_micron: num(r['Target micron']), notes: str(r['Notes']),
        finish_date: finish, finished: !!finish, hours_to_target: num(r['Hours to target']), final_micron: num(r['Final micron']), conche_hours: num(r['Conche hours']),
        conche_temp: num(r['Conche temp ' + TEMP]), process_temp: num(r['Process temp ' + TEMP]), temp_unit: TEMP, output_lbs: out, output_units: num(r['Output units']), finish_notes: str(r['Finish notes']),
        inputs: ins, nib_lbs: r1(nib), shell_lbs: r1(shell), in_lbs: r1(total), ratio: nibSugar(nib, sugar), nib_pct: sugar != null && nib + sugar > 0 ? r1(nib / (nib + sugar) * 100) : null,
        out_pct: out != null && total ? r1(out / total * 100) : null,
        chocolate: str(r['Destination']).trim().toLowerCase() === 'chocolate',
        mix: Object.keys(mix).sort(function (a, b) { return mix[b] - mix[a]; }).map(function (f) { return { ferment: f, lbs: r1(mix[f]), pct: nib ? r1(mix[f] / nib * 100) : null }; }),
      };
    }).filter(function (b) { return b.id; });
  }
  /**
   * Stock in Walpole: what arrived minus what batches used, per package, never below 0 (0 once a batch emptied the package).
   * Nibs and shells are counted apart. used: what batches used, nibs (lbs, the same as the batches' nib lbs added up) and
   * shells apart, whether or not the package was checked in. Flags: packages that arrived but were never marked shipped, and
   * ones used in a batch with no check-in (not stock: nothing arrived; counted as used, and no longer as packed or shipped).
   */
  function makingStock(tabs) {
    var pk = packages(tabs), bs = batches(tabs);
    var arrived = pk.filter(function (p) { return p.arrived; }), nibs = arrived.filter(function (p) { return !isShells(p.contents); }), shells = arrived.filter(function (p) { return isShells(p.contents); });
    var holding = nibs.filter(function (p) { return p.left > 0; });
    return {
      n: holding.length, lbs: r1(sum(holding, function (p) { return p.left; })), packages: holding,
      shell_lbs: r1(sum(shells, function (p) { return p.left; })),
      arrived: { n: arrived.length, lbs: r1(sum(arrived, function (p) { return p.arrival.lbs != null ? p.arrival.lbs : p.lbs; })) },
      used: { lbs: r1(sum(bs, function (b) { return b.nib_lbs; })), shell_lbs: r1(sum(bs, function (b) { return b.shell_lbs; })), batches: bs.length },
      batches: bs, open_batches: bs.filter(function (b) { return !b.finished; }).length,
      flags: { never_shipped: arrived.filter(function (p) { return !p.shipment; }).map(function (p) { return p.id; }), used_not_checked_in: pk.filter(function (p) { return !p.arrived && p.used_lbs > 0; }).map(function (p) { return p.id; }) },
    };
  }

  /** Shells packages are counted apart from nibs; read the same way as the server ("Shells", "shell", any case). */
  function isShells(c) { return /^shells?$/i.test(String(c || '').trim()); }

  /** Each roast with its numbers (minutes are measured from the start), its packages and whether it is fully packed. */
  function roasts(tabs) {
    var pk = packages(tabs), ins = roastInputs(tabs);
    return (tabs['Roasts'] || []).map(function (r) {
      var id = str(r['Roast ID']), beans = num(r['Beans in lbs']), nib = num(r['Nib lbs']), shell = num(r['Shell lbs']);
      var mine = pk.filter(function (p) { return p.roast === id; });
      var nibsPacked = sum(mine.filter(function (p) { return !isShells(p.contents); }), function (p) { return p.lbs; });
      // P2-A: the ferments come from the roast's lines (Roast inputs), else from an old row's Ferment ID; one ferment → ferment is it
      var lines = (ins[id] || []).map(function (x) { return { ferment: x.ferment, lbs: x.lbs, last: x.last, share: x.share }; });
      var fids = [];
      lines.forEach(function (x) { if (fids.indexOf(x.ferment) < 0) fids.push(x.ferment); });
      var fid = fids.length === 1 ? fids[0] : '';
      var start = str(r['Start time']), finish = str(r['Finish time']);
      return {
        id: id, ferment: fid, ferments: fids, mixed: fids.length > 1, inputs: lines,
        season: seasonOfRoastId(id) || (fids[0] ? seasonOf(fids[0]) : ''), date: str(r['Roast date']), beans_in: beans, bags_opened: num(r['Bags opened']),
        last_of_ferment: yes(r['Last of ferment']) || lines.some(function (x) { return x.last; }),
        // read from the P2-A columns (P2-B asks them); an older Sheet has none of them: all blank
        bean_size: str(r['Bean size']), finish: finish, roast_minutes: minutesBetween(start, finish), smell: str(r['Smell']), taste: str(r['Taste']), look: str(r['Look']),
        quality_note: str(r['Quality note']), profile_achieved: str(r['Profile achieved']),
        roaster: str(r['Roaster']), plan: str(r['Roast plan']), start: str(r['Start time']), start_temp_time: str(r['Start temp reached time']), max_temp_time: str(r['Max temp reached time']),
        start_temp: num(r['Start temp °C']), max_temp: num(r['Max temp °C']), cooling_min: num(r['Cooling minutes']), roasted_lbs: num(r['Roasted lbs']), notes: str(r['Notes']),
        mins_to_start: minutesBetween(r['Start time'], r['Start temp reached time']), mins_to_max: minutesBetween(r['Start time'], r['Max temp reached time']),
        winnow_date: str(r['Winnow date']), nib_lbs: nib, shell_lbs: shell, winnow_notes: str(r['Winnow notes']),
        loads: num(r['Roaster loads']), log_ref: str(r['Roaster log ref']),
        loss_lbs: nib !== null && beans !== null ? r1(beans - nib) : null, loss_pct: nib !== null && beans ? r1((beans - nib) / beans * 100) : null,
        winnowed: nib !== null, nib_yield: nib !== null && beans ? r1(nib / beans * 100) : null, shell_pct: shell !== null && nib !== null && nib + shell ? r1(shell / (nib + shell) * 100) : null,
        packages: mine, packed_nibs: nibsPacked, packed_shells: sum(mine.filter(function (p) { return isShells(p.contents); }), function (p) { return p.lbs; }),
        closed: mine.some(function (p) { return p.last_of_roast; }),
      };
    }).filter(function (r) { return r.id; });
  }

  /** P2-A: does a roast belong to a season? Its own season (R3.1 → 3), or the season of any of its ferments (season filters pass both). */
  function inSeason(r, season) {
    season = str(season);
    return !!r && (r.season === season || (r.ferments || []).some(function (f) { return seasonOf(f) === season; }));
  }
  /** {ferment: {beans_in, closed, n}}: what went into the roaster from each ferment. P2-A: each roast's lines, counted once (roastInputs). */
  function roastedByFerment(tabs) {
    var out = map(), ins = roastInputs(tabs);
    Object.keys(ins).forEach(function (rid) {
      ins[rid].forEach(function (x) {
        var o = out[x.ferment] = out[x.ferment] || { beans_in: 0, closed: false, n: 0 };
        o.beans_in += x.lbs || 0; o.n++;
        if (x.last) o.closed = true;
      });
    });
    return out;
  }

  /**
   * Where the roasted beans are (all seasons: last season's nibs are still stock). Steps, each in its own unit, never one total:
   *   roasted_waiting  roasts with no nib weight yet (roasted lbs if weighed, else beans in)
   *   nibs_waiting     per roast: nibs - nib packages, 0 once a package was marked "last of roast"
   *   packed           nib packages not on a shipment (shells counted apart)
   *   shipped          packages on a shipment that have not been checked in yet (arrived ones are in makingStock)
   * A package that arrived or that a batch used (even one never checked in, makingStock's used_not_checked_in) is in makingStock, not here.
   */
  function roastStock(tabs) {
    var rs = roasts(tabs), pk = packages(tabs);
    var waiting = rs.filter(function (r) { return !r.winnowed; });
    var toPack = rs.filter(function (r) { return r.winnowed && !r.closed; });
    var nibs = function (p) { return !isShells(p.contents); };
    // a package that has arrived in Walpole, or that a batch used, is counted there (makingStock), not here: so every pound is counted once
    var here = function (p) { return !p.arrived && !(p.used_lbs > 0); };
    var kept = function (p) { return p['for'] === 'Local use'; }; // P2-F: kept for local use: counted under local, never as packed for shipping
    var packed = pk.filter(function (p) { return nibs(p) && !p.shipment && here(p) && !kept(p); }), shipped = pk.filter(function (p) { return nibs(p) && p.shipment && here(p); });
    var localNibs = pk.filter(function (p) { return kept(p) && nibs(p) && !p.shipment && here(p) && p.local_left > 0; });
    var shipIds = map();
    pk.forEach(function (p) { if (p.shipment) shipIds[p.shipment] = 1; });
    return {
      n: rs.length, roasts: rs,
      roasted_waiting: { n: waiting.length, lbs: r1(sum(waiting, function (r) { return r.roasted_lbs != null ? r.roasted_lbs : r.beans_in; })), roasts: waiting },
      nibs_waiting: { n: toPack.length, lbs: r1(sum(toPack, function (r) { return Math.max(0, r.nib_lbs - r.packed_nibs); })), roasts: toPack }, // never below 0 (the server's nibsLeft)
      packed: { n: packed.length, lbs: r1(sum(packed, function (p) { return p.lbs; })), packages: packed, shell_lbs: r1(sum(pk.filter(function (p) { return !nibs(p) && !p.shipment && here(p) && !kept(p); }), function (p) { return p.lbs; })) },
      local: { n: localNibs.length, lbs: r1(sum(localNibs, function (p) { return p.local_left; })), packages: localNibs, shell_lbs: r1(sum(pk.filter(function (p) { return kept(p) && !nibs(p) && !p.shipment && here(p); }), function (p) { return p.local_left; })) },
      shipped: { n: shipped.length, lbs: r1(sum(shipped, function (p) { return p.lbs; })), shipments: Object.keys(shipIds).length, packages: shipped },
    };
  }

  /**
   * The ferment ledger: one row per ferment that has beans past drying. wet → dry → roasted → nibs → packed → shipped, with the
   * yield at each step. "difference" is the weighing difference a "last of this ferment" tick absorbed (dry - roasted).
   * P2-A: a roast can take beans from several ferments. A ferment's roasted lbs are its own lines' lbs; everything after the
   * roaster (nibs, packed, shipped, arrived, used) is each roast's figure times the ferment's share of that roast, so the rows of
   * one roast add up to the roast's own figures. A row that includes a mixed roast is an estimate: est is true (the table shows ≈).
   */
  function ledger(tabs) {
    var rs = roasts(tabs), fs = ferments(tabs), ins = roastInputs(tabs);
    var ids = map();
    fs.forEach(function (f) { if (f.stage === 'bagged') ids[f.id] = 1; });
    rs.forEach(function (r) { r.ferments.forEach(function (f) { ids[f] = 1; }); });
    Object.keys(ins).forEach(function (rid) { ins[rid].forEach(function (x) { ids[x.ferment] = 1; }); }); // lines of a roast not on the Roasts tab still went in
    return Object.keys(ids).map(function (id) {
      var f = fs.filter(function (x) { return x.id === id; })[0] || { id: id, wet: null, dry: null };
      var lines = [];
      Object.keys(ins).forEach(function (rid) { ins[rid].forEach(function (x) { if (x.ferment === id) lines.push(x); }); });
      var shareIn = function (r) { return sum(r.inputs.filter(function (x) { return x.ferment === id; }), function (x) { return x.share; }); };
      var mine = rs.filter(function (r) { return r.ferments.indexOf(id) >= 0; });
      var roasted = sum(lines, function (x) { return x.lbs; });
      var closed = lines.some(function (x) { return x.last; });
      var winnowed = mine.filter(function (r) { return r.winnowed; });
      var nibs = sum(winnowed, function (r) { return r.nib_lbs * shareIn(r); }), nibsKnown = winnowed.length > 0;
      var packedLbs = sum(mine, function (r) { return r.packed_nibs * shareIn(r); });
      var shippedLbs = sum(mine, function (r) { return shareIn(r) * sum(r.packages.filter(function (p) { return !isShells(p.contents) && p.shipment; }), function (p) { return p.lbs; }); });
      var arrivedP = [];
      mine.forEach(function (r) { r.packages.forEach(function (p) { if (!isShells(p.contents) && p.arrived) arrivedP.push({ p: p, share: shareIn(r) }); }); });
      var inBasis = sum(winnowed, function (r) { return r.beans_in * shareIn(r); });
      return {
        id: id, season: seasonOf(id), wet: f.wet, dry: f.dry, roasted: lines.length ? r1(roasted) : null, roasts: mine.length || lines.length,
        left: f.dry != null ? (closed ? 0 : r1(Math.max(0, f.dry - roasted))) : null, closed: closed, difference: closed && f.dry != null ? r1(f.dry - roasted) : null,
        nibs: nibsKnown ? r1(nibs) : null, packed: mine.length ? r1(packedLbs) : null, shipped: mine.length ? r1(shippedLbs) : null,
        arrived: arrivedP.length ? r1(sum(arrivedP, function (x) { return x.share * (x.p.arrival.lbs != null ? x.p.arrival.lbs : x.p.lbs); })) : null,
        used: arrivedP.length ? r1(sum(arrivedP, function (x) { return x.share * x.p.used_lbs; })) : null,
        dry_pct: f.wet && f.dry != null ? r1(f.dry / f.wet * 100) : null,
        nib_pct: roasted && nibsKnown && inBasis ? r1(nibs / inBasis * 100) : null,
        wet_to_nib_pct: f.wet && nibsKnown ? r1(nibs / f.wet * 100) : null,
        est: mine.some(function (r) { return r.mixed; }),
      };
    }).sort(function (a, b) { return idNum(b.id) - idNum(a.id); });
  }
  function idNum(id) { var m = String(id).match(/^(\d+)\.(\d+)$/); return m ? Number(m[1]) * 10000 + Number(m[2]) : 0; }

  /**
   * Durations (days fermenting, days drying) worked out from dates typed on phones. A typo'd date makes an impossible number
   * (negative, or more than MAX_DAYS): such a duration is left out of every average and the ferment is named so its entries can be checked.
   * saneDays(n) → n, or null when it is not a possible duration. durationProblems(rows, keys) → [{id, key, days}] for the rows where
   * a raw duration (row[key]) is impossible; rows are {id, <key>: days or null}.
   */
  var MAX_DAYS = 120;
  /**
   * The by-day axis every chart shares (app 1.24.0). It starts at the first day that has a reading in any plotted line, so day 0
   * is on the axis only when something was recorded on day 0, and it never ends before `least` (7 unless said: a short ferment
   * keeps the usual week's width). Labels are whole days, `room` of them at most, and the first day is always labelled.
   * days: every plotted point's day. Returns { lo, hi, ticks }.
   */
  function dayAxis(days, o) {
    o = o || {};
    var ok = (days || []).filter(function (d) { return d !== null && d !== undefined && d !== '' && isFinite(Number(d)); }).map(Number);
    var least = o.least === undefined ? 7 : Number(o.least) || 0;
    var lo = ok.length ? Math.max(0, Math.floor(Math.min.apply(null, ok))) : 0;
    var hi = Math.max(ok.length ? Math.ceil(Math.max.apply(null, ok)) : 0, least, lo + 1);
    var step = Math.max(1, Math.ceil((hi - lo) / Math.max(1, Math.floor(o.room || 8))));
    var ticks = [];
    for (var d = lo; d <= hi; d += step) ticks.push(d);
    return { lo: lo, hi: hi, step: step, ticks: ticks };
  }
  function saneDays(n) { return n === null || n === undefined || isNaN(Number(n)) || Number(n) < 0 || Number(n) > MAX_DAYS ? null : Number(n); }
  function durationProblems(rows, keys) {
    var out = [];
    (rows || []).forEach(function (r) { (keys || []).forEach(function (k) { var v = r[k]; if (v !== null && v !== undefined && saneDays(v) === null) out.push({ id: r.id, key: k, days: v }); }); });
    return out;
  }

  /**
   * 2.3.0: which areas' stock tiles the dashboard's "Where the beans are" shows. An area that is on: always (as before). An area
   * the company switched off (Settings → What you track): only while one of its tiles is not zero, so stock that is still
   * there is never hidden. areaOn(area) → false for an area that is off. inv: inventory().
   */
  function stockShown(inv, areaOn) {
    var on = function (a) { return typeof areaOn !== 'function' || areaOn(a) !== false; };
    var some = function (vals) { return vals.some(function (v) { return (Number(v) || 0) !== 0; }); };
    var r = inv.roasting || {}, m = inv.making || {};
    return {
      fermentation: on('fermentation') || some([inv.fermenting && inv.fermenting.wet, inv.drying && inv.drying.wet, inv.bagged && inv.bagged.dry]),
      roasting: on('roasting') || some([r.roasted_waiting && r.roasted_waiting.lbs, r.nibs_waiting && r.nibs_waiting.lbs, r.packed && r.packed.lbs, r.packed && r.packed.shell_lbs, r.shipped && r.shipped.lbs, r.local && r.local.lbs, r.local && r.local.shell_lbs]),
      making: on('making') || some([m.lbs, m.shell_lbs, m.used && m.used.lbs, m.used && m.used.shell_lbs]),
    };
  }

  /* ---------------- Moisture while drying (2.4.0) ----------------
   * The Drying check's "Moisture %" reading, day by day. Day 0 is the day the beans came out of the boxes (the ferment's Unload date;
   * without one, the day of its first drying entry). Two readings on one day (beans in two places) are averaged. A reading from before
   * day 0 (a mistyped date) is left out. The ferment's "Final moisture %" (Finish drying) is the last point, on the bagging day (else the last
   * reading's day), and replaces a reading of that same day. ASSUMPTION: the target moisture is TARGET_MOISTURE (7%, the middle of the usual
   * 6 to 8) unless the Lists tab's "Target moisture" says otherwise; "days to target" is the day of the first reading at or under it.
   */
  var TARGET_MOISTURE = 7;
  function dayNum(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function targetOf(t) { var n = num(t); return n !== null && n > 0 && n <= 30 ? n : TARGET_MOISTURE; }
  /** 2.4.2: a moisture reading as a number from 0 to 100, else null (a reading that cannot be right is left out of every chart and number). */
  function moist(v) { var n = num(v); return n !== null && n >= 0 && n <= 100 ? n : null; }

  /** One ferment's moisture curve: {ferment, start, points: [{day, date, moisture, final?}], final, reached, days_to_target, finished, has}; has = at least one daily reading. */
  function moistureCurve(tabs, fid, target) {
    fid = str(fid); target = targetOf(target);
    var f = (tabs['Ferments'] || []).filter(function (r) { return str(r['Ferment ID']) === fid; })[0] || null;
    var rows = (tabs['Drying log'] || []).filter(function (r) { return str(r['Ferment ID']) === fid && dayNum(r['Date']) !== null; });
    var firstEntry = rows.map(function (r) { return str(r['Date']).slice(0, 10); }).sort()[0] || '';
    var start = f && dayNum(f['Unload date']) !== null ? str(f['Unload date']).slice(0, 10) : firstEntry;
    var by = map();
    rows.forEach(function (r) {
      var m = moist(r['Moisture %']), d = str(r['Date']).slice(0, 10);
      if (m === null || !start || dayNum(d) < dayNum(start)) return;
      (by[d] = by[d] || []).push(m);
    });
    var points = Object.keys(by).sort().map(function (d) {
      var a = by[d];
      return { day: dayNum(d) - dayNum(start), date: d, moisture: Math.round(sum(a, function (x) { return x; }) / a.length * 10) / 10 };
    });
    var has = points.length > 0, finalM = f ? moist(f['Final moisture %']) : null, final = null;
    if (has && finalM !== null) {
      var bagged = f ? str(f['Bagged date']).slice(0, 10) : '', last = points[points.length - 1];
      var day = bagged && dayNum(bagged) >= dayNum(start) ? dayNum(bagged) - dayNum(start) : last.day;
      var at = points.filter(function (p) { return p.day === day; })[0];
      if (at) { at.moisture = finalM; at.final = true; final = at; }
      else if (day > last.day) { final = { day: day, date: bagged, moisture: finalM, final: true }; points.push(final); }
      else { last.final = true; last.moisture = finalM; final = last; } // bagged "before" its last reading: the last reading stands in
    }
    var reached = points.filter(function (p) { return p.moisture <= target; })[0] || null;
    return { ferment: fid, season: seasonOf(fid), start: start, start_from: f && dayNum(f['Unload date']) !== null ? 'unload' : 'first entry', points: points, final: final, target: target,
      reached: reached ? { day: reached.day, date: reached.date, moisture: reached.moisture } : null, days_to_target: reached ? reached.day : null,
      finished: !!(f && (str(f['Bagged date']) || num(f['Dry lbs']) !== null)), has: has };
  }
  /** The curves of every ferment that has a daily reading. opts: {target, finished: true for finished ferments only, season}. Newest ferment first. */
  function moistureCurves(tabs, opts) {
    opts = opts || {};
    var ids = map();
    (tabs['Drying log'] || []).forEach(function (r) { if (moist(r['Moisture %']) !== null && str(r['Ferment ID'])) ids[str(r['Ferment ID'])] = 1; });
    return Object.keys(ids).map(function (id) { return moistureCurve(tabs, id, opts.target); })
      .filter(function (c) { return c.has && (!opts.finished || c.finished) && (!opts.season || opts.season === 'all' || c.season === str(opts.season)); })
      .sort(function (a, b) { return idNum(b.ferment) - idNum(a.ferment); });
  }
  /** How many days the curves took to reach the target: {n (curves), reached (how many did), mean, min, max}. A curve that never got there, or whose
   * number of days cannot be right (saneDays: a typo'd date), is not counted in the days. */
  function daysToTarget(curves) {
    var d = curves.filter(function (c) { return saneDays(c.days_to_target) !== null; }).map(function (c) { return c.days_to_target; });
    return { n: curves.length, reached: d.length, mean: d.length ? Math.round(sum(d, function (x) { return x; }) / d.length * 10) / 10 : null, min: d.length ? Math.min.apply(null, d) : null, max: d.length ? Math.max.apply(null, d) : null };
  }

  /* ---------------- Drying flags and the moisture band (P1-C part 2) ----------------
   * The outside of the beans: how many whole days from the unload date to the first day the outside is Dry. Under fastUnder = too fast,
   * fastUnder to slowFrom - 1 = fine, slowFrom or more = too slow. Only the outside is flagged; after it the aim is the moisture band, as fast as possible.
   * First dry day: the Ferments "Exterior dry date" if set, else the first Drying log row on or after the unload date whose "Exterior state" is Dry
   * (any case) or whose "Exterior dry %" is 100. A row dated after `today` (when given) or before the unload date is ignored. Both columns may be
   * missing (an older Sheet): then only the old % can say. Nothing here reads money.
   */
  var DRY_OUTSIDE = { fastUnder: 2, slowFrom: 4 };
  var BAND_LOW = 6; // the usual lower end of the moisture band (6 to 8%)
  function outsideDry(tabs, fid, today) {
    fid = str(fid);
    var f = (tabs['Ferments'] || []).filter(function (r) { return str(r['Ferment ID']) === fid; })[0] || null;
    var out = { start: '', date: '', days: null, source: null, flag: null, waiting: null };
    if (!f || dayNum(f['Unload date']) === null) return out;
    var start = str(f['Unload date']).slice(0, 10), s = dayNum(start), t = dayNum(today);
    out.start = start;
    var date = '', source = null, set = str(f['Exterior dry date']).slice(0, 10);
    if (dayNum(set) !== null && (t === null || dayNum(set) <= t)) { date = set; source = 'finish'; }
    else {
      (tabs['Drying log'] || []).forEach(function (r) {
        if (str(r['Ferment ID']) !== fid) return;
        var d = str(r['Date']).slice(0, 10), n = dayNum(d);
        if (n === null || n < s || (t !== null && n > t)) return;
        var dry = str(r['Exterior state']).trim().toLowerCase() === 'dry' || num(r['Exterior dry %']) === 100;
        if (dry && (date === '' || d < date)) { date = d; source = 'log'; }
      });
    }
    if (date) {
      out.date = date; out.source = source; out.days = saneDays(dayNum(date) - s);
      out.flag = out.days === null ? null : out.days < DRY_OUTSIDE.fastUnder ? 'fast' : out.days >= DRY_OUTSIDE.slowFrom ? 'slow' : 'ok';
    } else if (t !== null && t >= s) out.waiting = saneDays(t - s);
    return out;
  }
  /** The moisture band for display. low is null when the Sheet sent none (an older script): then there is the target line alone. */
  function targetBand(low, high) {
    var h = targetOf(high), l = num(low);
    if (l === null || l <= 0 || l >= h) return { low: null, high: h, has_band: false, text: h + '%' };
    return { low: l, high: h, has_band: true, text: l + '–' + h + '%' };
  }
  /** Where a reading sits against the band: 'under', 'in', 'over', or null (no reading, or no band). */
  function bandPosition(value, band) {
    var m = moist(value);
    if (m === null || !band || !band.has_band) return null;
    return m < band.low ? 'under' : m > band.high ? 'over' : 'in';
  }
  /** A ferment's drying place: the Location used most in its Drying log (tie: the one used first), else the first item of "Drying setup", else Station, else "Not stated". */
  function dryingPlaceOf(tabs, fid, f) {
    var count = map(), first = map(), order = [];
    (tabs['Drying log'] || []).filter(function (r) { return str(r['Ferment ID']) === fid; })
      .sort(function (a, b) { return str(a['Date']) < str(b['Date']) ? -1 : str(a['Date']) > str(b['Date']) ? 1 : 0; })
      .forEach(function (r) { var w = str(r['Location']).trim(); if (!w) return; if (!count[w]) { count[w] = 0; order.push(w); } count[w]++; });
    var best = '';
    order.forEach(function (w) { if (best === '' || count[w] > count[best]) best = w; });
    if (best) return best;
    var setup = str(f && f['Drying setup']).split(/[,;]/)[0].trim();
    return setup || str(f && f['Station']).trim() || 'Not stated';
  }
  /**
   * Drying places compared. opts: {season ('all' or blank = every season), target, today}. Rows, most ferments first (then by name):
   * {place, ferments, outside_days (mean, 1 decimal), fast, ok, slow, days_to_target (mean, from unloading, or null), final_moisture (mean, or null)}.
   * Only ferments with a known outside-dry day count; a place with none has no row.
   */
  function dryingPlaces(tabs, opts) {
    opts = opts || {};
    var season = str(opts.season), all = season === '' || season === 'all', groups = map(), names = [];
    (tabs['Ferments'] || []).forEach(function (f) {
      var id = str(f['Ferment ID']);
      if (!id || (!all && seasonOf(id) !== season)) return;
      var o = outsideDry(tabs, id, opts.today);
      if (o.days === null) return;
      var place = dryingPlaceOf(tabs, id, f);
      if (!groups[place]) { groups[place] = { place: place, days: [], fast: 0, ok: 0, slow: 0, toTarget: [], final: [] }; names.push(place); }
      var g = groups[place];
      g.days.push(o.days); g[o.flag]++;
      var t = saneDays(moistureCurve(tabs, id, opts.target).days_to_target); if (t !== null) g.toTarget.push(t);
      var fm = moist(f['Final moisture %']); if (fm !== null) g.final.push(fm);
    });
    var m1 = function (a) { return a.length ? r1(sum(a, function (x) { return x; }) / a.length) : null; };
    return names.map(function (k) {
      var g = groups[k];
      return { place: g.place, ferments: g.days.length, outside_days: m1(g.days), fast: g.fast, ok: g.ok, slow: g.slow, days_to_target: m1(g.toTarget), final_moisture: m1(g.final) };
    }).sort(function (a, b) { return b.ferments - a.ferments || byNatural(a.place, b.place); });
  }

  /* ---------------- Juice taken (P1-D) ----------------
   * Juice lbs, litres and gallons of a season's ferments, one total per unit (units are never added together or converted).
   * A value counts only when it is a number above 0. ferments = how many ferments had any juice taken. A season is the ferment ID's text before the dot
   * (3 does not include 30.1); 'all' or blank = every season. Each total is rounded to 0.1, or null when no ferment has that unit.
   */
  function juiceTotals(tabs, season) {
    var s = str(season), all = s === '' || s === 'all', t = { lbs: 0, litres: 0, gallons: 0 }, seen = { lbs: false, litres: false, gallons: false }, n = 0;
    (tabs['Ferments'] || []).forEach(function (r) {
      var id = str(r['Ferment ID']);
      if (!id || (!all && seasonOf(id) !== s)) return;
      var any = false;
      [['lbs', 'Juice lbs'], ['litres', 'Juice litres'], ['gallons', 'Juice gallons']].forEach(function (u) {
        var v = num(r[u[1]]);
        if (v !== null && v > 0) { t[u[0]] += v; seen[u[0]] = true; any = true; }
      });
      if (any) n++;
    });
    var out = { season: all ? 'all' : s, ferments: n };
    ['lbs', 'litres', 'gallons'].forEach(function (u) { out[u] = seen[u] ? Math.round(t[u] * 10) / 10 : null; });
    return out;
  }

  /* ---------------- Tasting notes (2.4.0) ----------------
   * The Tasting notes tab: a note is about one ferment, roast, package or batch ("Ref kind" + "Ref ID"). Nothing here reads money (there is none).
   * A note whose thing was removed stays and is marked orphan. tastingTrail() collects the notes that matter on a history page:
   *   ferment: itself, its roasts, their packages and the batches that used those;  roast: itself, its ferment, its packages and their batches;
   *   package: itself, its roast, its ferment and the batches that used it;          batch: itself, the packages it used, their roasts and ferments.
   */
  function mapOf(o) { var m = map(); for (var k in o) m[k] = o[k]; return m; }
  var TASTING_TABS = mapOf({ Ferment: ['Ferments', 'Ferment ID'], Roast: ['Roasts', 'Roast ID'], Package: ['Packages', 'Package ID'], Batch: ['Batches', 'Batch ID'] });
  var KIND_WORDS = mapOf({ Ferment: 'Ferment', Roast: 'Roast', Package: 'Package', Batch: 'Batch' });
  function fermentOfAny(id) { var m = /^(\d+\.\d+)(?:-R\d+)?/.exec(str(id)); return m ? m[1] : ''; } // P2-A: R3.1 and R3.1-P1 name no ferment (the roast's lines do)
  function tastingNotes(tabs) {
    var have = map(); // kind → {ID: the Source entry of that row}
    Object.keys(TASTING_TABS).forEach(function (k) {
      var set = have[k] = map();
      (tabs[TASTING_TABS[k][0]] || []).forEach(function (r) { var id = str(r[TASTING_TABS[k][1]]); if (id) set[id] = str(r['Source entry']); });
    });
    // 2.4.2: a note made by script 2.4.2 or later knows the entry that made what it is about ("Ref entry"). When the row there now came from
    // another entry (a ferment removed, and its number given to a new box), the note is about the old one: it is shown as no longer in the records.
    // A note with no Ref entry (older, or about a row made by hand) is matched by its ID alone, as before.
    var gone = function (kind, ref, refEntry) {
      if (!TASTING_TABS[kind]) return false;
      if (!(ref in have[kind])) return true;
      return !!refEntry && have[kind][ref] !== refEntry;
    };
    var out = (tabs['Tasting notes'] || []).map(function (r, i) {
      var kind = str(r['Ref kind']), ref = str(r['Ref ID']), score = num(r['Score']);
      if (score !== null && (score < 1 || score > 10)) score = null; // 2.4.2: a score outside 1 to 10 cannot be right: not shown
      return { id: str(r['Note ID']), kind: kind, ref: ref, date: str(r['Date']), sample: str(r['What was tasted']), by: str(r['Tasted by']) || str(r['Recorded by']), score: score,
        flavours: str(r['Flavours']).split(/\s*,\s*/).filter(Boolean), off: yes(r['Something off']), notes: str(r['Notes']), order: i,
        orphan: gone(kind, ref, str(r['Ref entry'])), about: (KIND_WORDS[kind] || kind) + ' ' + ref };
    }).filter(function (n) { return n.id && n.kind && n.ref; });
    // newest first: by the day tasted (no day last), then the order they were added
    return out.sort(function (a, b) { return (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || b.order - a.order; });
  }
  /** The notes behind one history page (see above); each carries here: true when it is about the page's own subject. */
  function tastingTrail(tabs, kind, id, notes) {
    id = str(id);
    var roastFerment = map(), packRoast = map(), usesOf = map(), packsOf = map(), roastsOf = map(), inputsOf = map(), ins = roastInputs(tabs);
    // P2-A: a roast's ferments are its lines (one or several); an old roast's is its Ferment ID
    Object.keys(ins).forEach(function (rid) { roastFerment[rid] = []; ins[rid].forEach(function (x) { if (roastFerment[rid].indexOf(x.ferment) < 0) { roastFerment[rid].push(x.ferment); (roastsOf[x.ferment] = roastsOf[x.ferment] || []).push(rid); } }); });
    (tabs['Packages'] || []).forEach(function (r) { var pid = str(r['Package ID']), rid = str(r['Roast ID']); packRoast[pid] = rid; (packsOf[rid] = packsOf[rid] || []).push(pid); });
    (tabs['Batch inputs'] || []).forEach(function (x) {
      var b = str(x['Batch ID']), p = str(x['Package ID']);
      if (!b || !p) return;
      (usesOf[p] = usesOf[p] || []).push(b); (inputsOf[b] = inputsOf[b] || []).push(p);
    });
    var want = map();
    var add = function (k, v) { if (v) want[k + '|' + v] = true; };
    var fermentsOf = function (rid) { return roastFerment[rid] || [fermentOfRoast(rid)].filter(Boolean); };
    var roastOf = function (pid) { return packRoast[pid] || roastOfPackage(pid); };
    var addFerments = function (rid) { fermentsOf(rid).forEach(function (f) { add('Ferment', f); }); };
    var batchesOf = function (pids) { pids.forEach(function (p) { (usesOf[p] || []).forEach(function (b) { add('Batch', b); }); }); };
    add(kind, id);
    if (kind === 'Ferment') {
      (roastsOf[id] || []).forEach(function (r) { add('Roast', r); (packsOf[r] || []).forEach(function (p) { add('Package', p); }); batchesOf(packsOf[r] || []); });
    } else if (kind === 'Roast') {
      addFerments(id); (packsOf[id] || []).forEach(function (p) { add('Package', p); }); batchesOf(packsOf[id] || []);
    } else if (kind === 'Package') {
      add('Roast', roastOf(id)); addFerments(roastOf(id)); batchesOf([id]);
    } else if (kind === 'Batch') {
      (inputsOf[id] || []).forEach(function (p) { add('Package', p); add('Roast', roastOf(p)); addFerments(roastOf(p)); });
    }
    return (notes || tastingNotes(tabs)).filter(function (n) { return want[n.kind + '|' + n.ref]; })
      .map(function (n) { var o = {}; for (var k in n) o[k] = n[k]; o.here = n.kind === kind && n.ref === id; return o; });
  }
  /**
   * The most recent notes, newest first (by the day tasted): up to n. 1.24.2: a note marked "something off" keeps its place by
   * date and is only marked (the page's badge). It used to be pinned first, and nothing ever unpins a note, so a note from a
   * season ago led "Recent" for good.
   */
  function tastingRecent(tabs, n, notes) {
    return (notes || tastingNotes(tabs)).slice(0, n || 6);
  }
  /** Where a note's history page is: the ferment's bag page, a package's, a batch's; '' when the thing is gone (orphan). A roast has no page of its own: its ferment's. */
  function tastingLink(tabs, note) {
    if (note.orphan) return '';
    if (note.kind === 'Ferment') return 'batch.html?f=' + encodeURIComponent(note.ref);
    if (note.kind === 'Package') return 'batch.html?p=' + encodeURIComponent(note.ref);
    if (note.kind === 'Batch') return 'batch.html?c=' + encodeURIComponent(note.ref);
    if (note.kind === 'Roast') { // its first ferment's page (P2-A: the first of its lines)
      if (!(tabs['Roasts'] || []).some(function (r) { return str(r['Roast ID']) === note.ref; })) return '';
      var f = ((roastInputs(tabs)[note.ref] || [])[0] || {}).ferment;
      return f ? 'batch.html?f=' + encodeURIComponent(str(f)) : '';
    }
    return '';
  }

  /* ---------------- Home and Season helpers (design plan, slice 5) ----------------
   * needsAttention: what the Home view lists first. It uses only what the data read already gave this viewer: `review` and
   * `asks` reach admins only (Code.gs decides), so anyone else gets the overdue checks alone. No money is read here.
   */
  var CHECK_EVERY = { fermenting: 2, drying: 1 }; // days: the first move is about 2 days after loading; drying is looked at daily
  function formWords(k) { var t = str(k).replace(/_/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Entry'; }
  function clip(t, n) { t = str(t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  /**
   * input: {tabs, review, asks, pins, season, today ('2026-11-18')}. Returns {items, done}.
   *   items: [{kind: 'held' | 'ask' | 'pin' | 'photos' | 'check', tone: 'bad' | 'warn', what, why, at, action: {label, href}}], most urgent first
   *     (each action's href opens the thing itself: the held entries, that person, that ferment):
   *     entries held for checking (one row for all of them), then people who asked for a new link (oldest ask first), then
   *     (2.7.0) people with many wrong PINs on a shared tablet today (most first), then
     (P1-C) drying ferments whose outside is not dry after 4 days or more, or was dry in under 2 (kind 'drying'), then
   *     ferments of the season with no check for too long (longest wait first; newest ferment first among equals).
   *   done: [{name, by, at}]: asks another admin already answered (said, not counted).
   * IDs are compared as text throughout: 2.1 is never 2.10.
   */
  /* 1.24.2: every row's button lands on the thing itself. Held entries: the Entries page with its Status filter on "Needs a
   * look" and every kind of entry showing (a held invite or fix counts too); with exactly one, that page opens it. */
  var HELD_HREF = 'entries.html?show=all&status=held';
  function needsAttention(input) {
    input = input || {};
    var tabs = input.tabs || {}, items = [], done = [];
    var held = (input.review || []).filter(Boolean);
    if (held.length) {
      var lines = held.slice(0, 3).map(function (r) { return clip(formWords(r.form) + (r.by ? ' from ' + r.by : '') + (r.message ? ': ' + r.message : ''), 110); });
      items.push({ kind: 'held', tone: 'bad', n: held.length, what: held.length === 1 ? '1 entry needs a look' : held.length + ' entries need a look',
        why: lines.join(' · ') + (held.length > 3 ? ' · and ' + (held.length - 3) + ' more' : ''),
        action: { label: held.length === 1 ? 'Open the entry' : 'Show the ' + held.length + ' entries', href: HELD_HREF } });
    }
    (input.asks || []).filter(Boolean).slice().sort(function (a, b) { return str(a.asked_at) < str(b.asked_at) ? -1 : str(a.asked_at) > str(b.asked_at) ? 1 : 0; }).forEach(function (a) {
      if (a.handled_by) { done.push({ name: str(a.name), by: str(a.handled_by), at: str(a.handled_at) }); return; }
      items.push({ kind: 'ask', tone: 'warn', what: str(a.name) + ' asked for a new link', why: '', at: str(a.asked_at),
        action: { label: 'Send a new link', href: 'people.html#resend=' + encodeURIComponent(str(a.user_id)) } });
    });
    (input.pins || []).filter(Boolean).slice().sort(function (a, b) { return (Number(b.n) || 0) - (Number(a.n) || 0); }).forEach(function (p) {
      items.push({ kind: 'pin', tone: 'warn', what: str(p.name) + ': ' + (Number(p.n) || 0) + ' wrong PINs on ' + str(p.device_name) + ' today',
        why: 'If it was not ' + str(p.name).split(' ')[0] + ', someone may be guessing: press Reset PIN.',
        action: /^U\d+$/.test(str(p.user_id)) ? { label: 'Open ' + str(p.name), href: 'people.html#person=' + str(p.user_id) } : { label: 'Open People', href: 'people.html' } });
    });
    // P4-A: a photo problem only the Sheet's owner can fix (Drive nearly full, a photos folder shared): admins only (Code.gs decides)
    (input.photos || []).filter(function (p) { return p && p.what; }).forEach(function (p) {
      items.push({ kind: 'photos', tone: 'bad', what: 'Photos are not being stored', why: clip(p.what, 200), action: null });
    });
    var today = dayNum(input.today);
    if (today !== null) {
      var last = map(); // ferment ID -> the day of its newest check (fermentation checks and the drying log)
      var note = function (rows) { (rows || []).forEach(function (r) { var id = str(r['Ferment ID']), d = dayNum(r['Date']); if (id && d !== null && d <= today && (last[id] === undefined || d > last[id])) last[id] = d; }); };
      note(tabs['Ferment checks']); note(tabs['Drying log']);
      var all = ferments(tabs), season = str(input.season) || all.map(function (f) { return f.season; }).sort(function (a, b) { return Number(b) - Number(a); })[0] || '';
      var due = [];
      all.forEach(function (f) {
        if (f.season !== season || (f.stage !== 'fermenting' && f.stage !== 'drying')) return;
        var began = dayNum(f.stage === 'drying' ? f.unload_date : f.load_date);
        if (began === null || began > today) return;
        var seen = last[f.id] !== undefined && last[f.id] >= began ? last[f.id] : null; // a drying ferment's last fermentation check does not count as a drying check
        var wait = today - (seen === null ? began : seen);
        if (wait <= CHECK_EVERY[f.stage]) return;
        due.push({ kind: 'check', tone: 'warn', id: f.id, wait: wait, what: 'Ferment ' + f.id + ' is on day ' + (today - began) + ' of ' + f.stage,
          why: seen === null ? 'No check logged since ' + (f.stage === 'drying' ? 'it was unloaded' : 'it was loaded') : 'No check for ' + wait + ' days',
          action: { label: 'Open', href: '#ferments/' + encodeURIComponent(f.id) } });
      });
      due.sort(function (a, b) { return b.wait - a.wait || idNum(b.id) - idNum(a.id) || (a.id < b.id ? 1 : -1); });
      // P1-C: the outside of the beans took too long (not dry after 4 days or more) or dried too fast (under 2 days); drying ferments of the season only
      var dryItems = [], days = function (n) { return n + (n === 1 ? ' day' : ' days'); };
      all.forEach(function (f) {
        if (f.season !== season || f.stage !== 'drying') return;
        var o = outsideDry(tabs, f.id, input.today);
        if (o.date === '' && o.waiting !== null && o.waiting >= DRY_OUTSIDE.slowFrom) {
          dryItems.push({ kind: 'drying', tone: 'warn', id: f.id, flag: 'slow', n: o.waiting, what: 'Ferment ' + f.id + ': outside still not dry after ' + days(o.waiting),
            why: DRY_OUTSIDE.slowFrom + ' days or more is too slow.', action: { label: 'Open', href: '#ferments/' + encodeURIComponent(f.id) } });
        } else if (o.flag === 'fast') {
          dryItems.push({ kind: 'drying', tone: 'warn', id: f.id, flag: 'fast', n: o.days, what: 'Ferment ' + f.id + ': outside dry after ' + days(o.days),
            why: 'Under ' + DRY_OUTSIDE.fastUnder + ' days is too fast.', action: { label: 'Open', href: '#ferments/' + encodeURIComponent(f.id) } });
        }
      });
      dryItems.sort(function (a, b) { return (a.flag === b.flag ? 0 : a.flag === 'slow' ? -1 : 1) || b.n - a.n || idNum(b.id) - idNum(a.id) || (a.id < b.id ? 1 : -1); });
      items = items.concat(dryItems, due);
    }
    return { items: items, done: done };
  }

  /** The season before `cur` among the seasons on record, as whole numbers (9 is before 10), or '' when there is none (or cur is "all"). */
  function seasonBefore(seasons, cur) {
    var c = num(cur);
    if (c === null) return '';
    var best = null;
    (seasons || []).forEach(function (s) { var n = num(s); if (n !== null && n < c && (best === null || n > num(best))) best = str(s); });
    return best === null ? '' : best;
  }
  /**
   * One Season figure against the season before: {season, value, diff} or null when there is nothing to compare (no earlier
   * season, or no figure on either side). diff (one decimal) only for rates and averages (rate: true): a total of a season still
   * running against a finished one would only mislead, so totals just say last season's figure.
   */
  function vsLast(now, before, season, rate) {
    if (!season || now === null || now === undefined || before === null || before === undefined || !isFinite(now) || !isFinite(before)) return null;
    return { season: str(season), value: before, diff: rate ? Math.round((now - before) * 10) / 10 : null };
  }

  /* ---------------- The field app's home: what is in progress (design slice 8) ----------------
   * Pure: worked out only from what the phone already holds (its lists and its own entries). Nothing is read or sent.
   */
  function dayOf(iso) { return dayNum(str(iso).slice(0, 10)); }
  /** Day 1 is the day itself; null when either date cannot be read or the count is not sane. */
  function dayCount(from, today) {
    var a = dayOf(from), b = dayOf(today);
    if (a === null || b === null) return null;
    var n = Math.round(b - a) + 1;
    return n >= 1 && n <= MAX_DAYS ? n : null;
  }
  function blank(v) { return v === null || v === undefined || v === ''; }
  /**
   * Where a ferment is, from its list row and this phone's own entries not yet in the lists (entries: [{form, data}]):
   * {stage: 'fermenting' | 'drying' | 'done', box, day, text}. box = last move + 1 (loaded into box 1).
   * text: "box 2 · day 3", "drying · day 5", "bagged" or "280 lbs dry".
   */
  function fermentState(f, entries, today) {
    f = f || {};
    var id = str(f.id), turn = Number(f.last_turn) || 0, unloaded = blank(f.unload_date) ? '' : str(f.unload_date);
    (entries || []).forEach(function (e) {
      var d = (e && e.data) || {};
      if (!e || e.form !== 'ferment_check' || str(d.ferment) !== id) return;
      if (d.stage === 'Turn') { var t = !blank(d.box) ? Number(d.box) - 1 : Number(d.turn); if (t > turn) turn = t; }
      if (d.stage === 'Unload' && !unloaded) unloaded = str(d.date) || 'yes';
    });
    if (!blank(f.bagged_date) || !blank(f.dry_lbs)) {
      return { stage: 'done', box: turn + 1, day: null, text: !blank(f.dry_lbs) && Number(f.dry_lbs) > 0 ? Number(f.dry_lbs) + ' lbs dry' : 'bagged' };
    }
    var day;
    if (unloaded) {
      day = dayCount(unloaded, today);
      return { stage: 'drying', box: turn + 1, day: day, text: 'drying' + (day ? ' · day ' + day : '') };
    }
    day = dayCount(f.load_date, today);
    return { stage: 'fermenting', box: turn + 1, day: day, text: 'box ' + (turn + 1) + (day ? ' · day ' + day : '') };
  }
  // The fermentation forms all offer every open box; which one is the usual next step depends on where the box is.
  var FERMENT_NEXT = { fermenting: ['ferment_check', 'add_beans'], drying: ['drying_check', 'finish_drying'] };
  var FERMENT_FORMS = FERMENT_NEXT.fermenting.concat(FERMENT_NEXT.drying);
  // A form's own "what do I offer" is wider than "what is waiting for me": a package is checked in only once it was shipped.
  var READY = { arrival: function (p) { return !blank(p.shipment); } };
  function sameText(text, id) { var t = str(text); return t.indexOf(id + ' · ') === 0 ? t.slice(id.length + 3) : t === id ? '' : t; }
  /**
   * The home screen's "In progress" list.
   * o.forms:    the schema forms this person may use, in their order (schema.js objects: id, title, fields with open/itemText)
   * o.items:    {ferment: [...], roast: [...], package: [...], batch: [...]} as the phone knows them, newest first
   * o.entries:  this phone's own entries not yet counted in the lists ([{form, data}])
   * o.drafts:   unfinished forms on this phone ([{form, title, text}]); they come first
   * o.ctx:      what a field's open(item, ctx) may look at;  o.today: 'YYYY-MM-DD'
   * Returns rows [{kind, id, text, actions: [{form, label, query}]}]: one row per thing, with the forms that are its usual
   * next step (query: the pre-filled form link's "field=value", '' for a form that only opens). A form that takes
   * several things at once (Ship, Start batch) gets one row saying how many are ready.
   */
  function inProgress(o) {
    o = o || {};
    var rows = [], at = map(), items = o.items || {};
    function row(kind, id, text) {
      var k = kind + '|' + id;
      if (!at[k]) { at[k] = { kind: kind, id: id, text: text, actions: [] }; rows.push(at[k]); }
      return at[k];
    }
    (o.drafts || []).forEach(function (d) {
      if (!d || !d.form) return;
      row('draft', d.form, d.text || 'not saved yet').actions.push({ form: d.form, label: 'Carry on', query: '', title: d.title || d.form });
    });
    (o.forms || []).forEach(function (form) {
      if (!form || !form.fields) return;
      var pick = null, inner = null;
      form.fields.forEach(function (f) {
        if (pick || inner || f.showIf) return;
        if ((f.type === 'ferment' || f.type === 'ref') && f.required) pick = f;
        else if (f.type === 'repeat') (f.fields || []).forEach(function (s) { if (!inner && (s.type === 'ref' || s.type === 'ferment') && s.required && !s.showIf) inner = s; }); // P2-A: a roast's "Beans from" lines
      });
      var f = pick || inner;
      if (!f) return;
      var kind = f.type === 'ferment' ? 'ferment' : f.of;
      var ready = READY[form.id];
      var open = (items[kind] || []).filter(function (x) {
        if (!x || blank(x.id)) return false;
        var ok;
        if (typeof f.open === 'function') { try { ok = !!f.open(x, o.ctx || {}, {}); } catch (e) { ok = false; } }
        else ok = kind !== 'ferment' || fermentState(x, o.entries, o.today).stage !== 'done';
        return ok && (!ready || ready(x));
      });
      if (!open.length) return;
      if (inner || f.multiple) { // several at once: one line, and the form opens empty
        var noun = (o.nouns && o.nouns[kind]) || kind;
        row('many', form.id, open.length + ' ' + noun + (open.length === 1 ? '' : 's') + ' ready').actions.push({ form: form.id, label: form.title, query: '', title: form.title });
        return;
      }
      open.forEach(function (x) {
        var id = str(x.id), text, st;
        if (kind === 'ferment' && FERMENT_FORMS.indexOf(form.id) >= 0) {
          st = fermentState(x, o.entries, o.today);
          if ((FERMENT_NEXT[st.stage] || []).indexOf(form.id) < 0) return;
          text = st.text;
        } else {
          try { text = typeof f.itemText === 'function' ? sameText(f.itemText(x, o.ctx || {}), id) : ''; } catch (e) { text = ''; }
        }
        var r = row(kind, id, text);
        if (!r.text && text) r.text = text;
        r.actions.push({ form: form.id, label: form.progressLabel || form.title, query: encodeURIComponent(f.key) + '=' + encodeURIComponent(id), title: form.title });
      });
    });
    return mergeSame(rows, o);
  }
  /*
   * Field design (app 1.24.0). Home says what needs doing; it is not a stock list. When more than MERGE_OVER things wait for
   * the same single form (sixteen bagged ferments, each offering only Roast), they become one row that says how many and what
   * what they are ready for ("16 ferments" · "ready to roast"; not "bagged": the Roast form also offers a ferment with a dry weight and no bag date); its button opens the form with nothing picked, and the form's
   * picker lists them. Up to MERGE_OVER stay one-tap rows. A thing with two next steps (a box fermenting or drying) is never merged.
   */
  var MERGE_OVER = 3;
  function mergeSame(rows, o) {
    var by = map(), order = [];
    rows.forEach(function (r) {
      if (r.kind === 'draft' || r.kind === 'many' || r.kind === 'shipment' || r.actions.length !== 1 || !r.actions[0].query) return; // a pallet at the port keeps its own row
      var f = r.actions[0].form;
      if (!by[f]) { by[f] = []; order.push(f); }
      by[f].push(r);
    });
    order.forEach(function (f) {
      var same = by[f];
      if (same.length <= MERGE_OVER) return;
      var a = same[0].actions[0], noun = (o.nouns && o.nouns[same[0].kind]) || same[0].kind;
      var head = same.length + ' ' + noun + (/(ch|s|x)$/.test(noun) ? 'es' : 's'), tail = 'ready to ' + str(a.title || a.label).toLowerCase();
      var merged = { kind: 'many', id: f, text: head + ' ' + tail, head: head, tail: tail, count: same.length, actions: [{ form: f, label: a.label, query: '', title: a.title }] };
      rows[rows.indexOf(same[0])] = merged;
      rows = rows.filter(function (r) { return same.indexOf(r) < 0; });
    });
    return rows;
  }

  /* ---------------- The tree-to-bar story (app 1.19.0) ----------------
   * One chocolate batch and everything behind it: the packages it used, how each arrived, their roasts, the ferments (fermentation
   * and drying) and the farms. Worked out from the tabs the data read already sends; nothing here reads a price, a payment or a payee.
   *   - A shells package is not nibs: it is listed apart (shell_packages) and left out of the shares, the roasts, the ferments and the farms.
   *   - IDs are text: 2.1 is not 2.10. A package that is not in the records still names its roast and ferment by the shape of its ID.
   *   - A link that is missing (a package never checked in, a ferment with no drying entries) is named in `missing`, never guessed.
   *   - Scores: a batch's score is the average of the notes about the batch itself (the finished product). Notes about what went into it
   *     are shown beside their package, roast or ferment, and only their "something off" marks reach the batch's flags.
   */
  function mean(a) { return a.length ? sum(a, function (x) { return x; }) / a.length : null; }
  function daysApart(a, b) { var x = dayNum(a), y = dayNum(b); return x === null || y === null ? null : y - x; }
  function byNatural(a, b) { return str(a).localeCompare(str(b), undefined, { numeric: true }); }
  /** {avg, n (notes with a score), notes (how many), off (how many say "something off")}; a note about something no longer in the records is not counted. */
  function scoreOf(notes) {
    var live = notes.filter(function (n) { return !n.orphan; }), scored = live.filter(function (n) { return n.score !== null && n.score !== undefined; });
    return { avg: scored.length ? r1(mean(scored.map(function (n) { return n.score; }))) : null, n: scored.length, notes: live.length, off: live.filter(function (n) { return n.off; }).length };
  }
  /** "Something off" first, then as tastingNotes() orders them (newest first). */
  function offFirst(notes) { return notes.filter(function (n) { return n.off; }).concat(notes.filter(function (n) { return !n.off; })); }

  /** Everything the story helpers look up, read once from the tabs. */
  function storyCtx(tabs, notes) {
    var c = { tabs: tabs, notes: notes || tastingNotes(tabs), packs: map(), roasts: map(), intakes: map(), ferments: map(), arr: arrivals(tabs), batches: batches(tabs), byRef: map() };
    packages(tabs).forEach(function (p) { c.packs[p.id] = p; });
    roasts(tabs).forEach(function (r) { c.roasts[r.id] = r; });
    (tabs['Ferments'] || []).forEach(function (r) { var id = str(r['Ferment ID']); if (id) c.ferments[id] = r; });
    (tabs['Intakes'] || []).forEach(function (i) {
      var f = str(i['Ferment ID']);
      if (f) (c.intakes[f] = c.intakes[f] || []).push({ farm: str(i['Farm']) || 'Not stated', lbs: num(i['Wet lbs']) });
    });
    c.notes.forEach(function (n) { var k = n.kind + '|' + n.ref; (c.byRef[k] = c.byRef[k] || []).push(n); });
    c.notesOf = function (kind, ref) { return offFirst(c.byRef[kind + '|' + ref] || []); };
    return c;
  }

  /** The chain behind one batch, without the long details: its packages, roasts, each ferment's and farm's share, score and flags. */
  function batchChain(c, b) {
    var seen = map(), packs = [];
    b.inputs.forEach(function (i) {
      if (!i.package) return;
      var o = seen[i.package];
      if (!o) {
        var p = c.packs[i.package] || null, roast = (p && p.roast) || roastOfPackage(i.package), a = (p && p.arrival) || c.arr[i.package] || null;
        var packed = p ? p.lbs : null, change = a && a.lbs !== null && packed !== null ? r1(a.lbs - packed) : null;
        // P2-A: the package's ferments with their shares (its roast's lines); a package not in the records: its roast's, else an old number's ferment
        var fl = p && p.ferments.length ? p.ferments : c.roasts[roast] && c.roasts[roast].inputs.length ? c.roasts[roast].inputs.map(function (x) { return { id: x.ferment, share: x.share }; })
          : fermentOfAny(i.package) ? [{ id: fermentOfAny(i.package), share: 1 }] : [];
        o = seen[i.package] = { id: i.package, found: !!p, contents: p ? p.contents : '', shells: !!p && isShells(p.contents), type: p ? p.type : '', lbs: packed, used_lbs: 0, emptied: false,
          roast: roast, ferment: fl.length === 1 ? fl[0].id : '', ferments: fl.map(function (x) { return x.id; }), shares: fl, mixed: fl.length > 1,
          pack_date: p ? p.pack_date : '', shipment: p ? p.shipment : '', ship_date: p ? p.ship_date : '', package_notes: p ? p.notes : '',
          arrival: a, change_lbs: change, change_pct: change !== null && packed ? r1(change / packed * 100) : null, notes: c.notesOf('Package', i.package) };
        packs.push(o);
      }
      o.used_lbs = r1(o.used_lbs + (i.lbs || 0)); if (i.emptied) o.emptied = true;
    });
    var nibs = packs.filter(function (p) { return !p.shells; }), shells = packs.filter(function (p) { return p.shells; });
    var nib = sum(nibs, function (p) { return p.used_lbs; }), byF = map(), roastIds = [], fermentIds = [];
    // P2-A: a package's lbs used are split over its ferments by share before the farms are worked out (no ferment known: '')
    nibs.forEach(function (p) {
      if (!p.shares.length) byF[''] = (byF[''] || 0) + p.used_lbs;
      p.shares.forEach(function (x) {
        byF[x.id] = (byF[x.id] || 0) + p.used_lbs * x.share;
        if (x.id && fermentIds.indexOf(x.id) < 0) fermentIds.push(x.id);
      });
      if (p.roast && roastIds.indexOf(p.roast) < 0) roastIds.push(p.roast);
    });
    var share = function (lbs) { return nib ? lbs / nib : null; };
    fermentIds.sort(function (x, y) { return byF[y] - byF[x] || byNatural(x, y); });
    var farmShare = map(), farmVia = map(), unknown = byF[''] || 0;
    var ferments = fermentIds.map(function (f) {
      var s = share(byF[f]), ins = c.intakes[f] || [], wet = sum(ins, function (x) { return x.lbs; });
      if (s !== null && wet > 0) ins.forEach(function (x) {
        farmShare[x.farm] = (farmShare[x.farm] || 0) + s * (x.lbs || 0) / wet;
        if (!farmVia[x.farm]) farmVia[x.farm] = [];
        if (farmVia[x.farm].indexOf(f) < 0) farmVia[x.farm].push(f);
      });
      else unknown += byF[f]; // no deliveries on record for this ferment: its share of the nibs has no farm
      return { id: f, found: !!c.ferments[f], lbs: r1(byF[f]), pct: s !== null ? r1(s * 100) : null,
        roasts: roastIds.filter(function (r) { return nibs.some(function (p) { return p.roast === r && p.ferments.indexOf(f) >= 0; }); }).sort(byNatural), notes: c.notesOf('Ferment', f) }; // a mixed roast is under each of its ferments
    });
    var farms = Object.keys(farmShare).sort(function (x, y) { return farmShare[y] - farmShare[x] || byNatural(x, y); }).map(function (k) {
      return { farm: k, pct: r1(farmShare[k] * 100), lbs: r1(farmShare[k] * nib), ferments: farmVia[k] };
    });
    if (nib && unknown > 0) farms.push({ farm: '', unknown: true, pct: r1(unknown / nib * 100), lbs: r1(unknown), ferments: [] });
    var fermentOfR = function (id) { return c.roasts[id] ? c.roasts[id].ferments[0] || '' : fermentOfRoast(id); }; // a mixed roast sits with its first ferment
    // roasts in the order of their ferments (largest share first), so every section of the story lists things the same way
    var roastList = roastIds.sort(function (x, y) { return fermentIds.indexOf(fermentOfR(x)) - fermentIds.indexOf(fermentOfR(y)) || byNatural(x, y); }).map(function (id) {
      var r = c.roasts[id] || null;
      return { id: id, found: !!r, ferment: r ? r.ferment : fermentOfRoast(id), ferments: r ? r.ferments.slice() : [fermentOfRoast(id)].filter(Boolean), mixed: !!(r && r.mixed),
        packages: nibs.filter(function (p) { return p.roast === id; }).map(function (p) { return p.id; }), notes: c.notesOf('Roast', id) };
    });
    var own = c.notesOf('Batch', b.id), flags = [];
    var offs = function (list, where) { list.forEach(function (n) { if (n.off && !n.orphan) flags.push({ kind: 'off', where: where, ref: n.ref, date: n.date, note: n.id }); }); };
    offs(own, 'Batch');
    nibs.forEach(function (p) { offs(p.notes, 'Package'); });
    roastList.forEach(function (r) { offs(r.notes, 'Roast'); });
    ferments.forEach(function (f) { offs(f.notes, 'Ferment'); });
    packs.forEach(function (p) { if (p.arrival && p.arrival.problems.length) flags.push({ kind: 'arrival', where: 'Package', ref: p.id, date: p.arrival.date, problems: p.arrival.problems.slice() }); });
    var missing = [];
    packs.forEach(function (p) { if (!p.found) missing.push({ what: 'package', id: p.id }); else if (!p.arrival) missing.push({ what: 'arrival', id: p.id }); });
    roastList.forEach(function (r) { if (!r.found) missing.push({ what: 'roast', id: r.id }); });
    ferments.forEach(function (f) { if (!f.found) missing.push({ what: 'ferment', id: f.id }); });
    return { packages: nibs, shell_packages: shells, nib_lbs: r1(nib), roasts: roastList, ferments: ferments, farms: farms, notes: own, score: scoreOf(own), flags: flags, missing: missing };
  }

  /**
   * One ferment as the story tells it: fermentation (days, each move to the next box, the average centre and top temperature at each
   * check) and drying (days, where, the moisture curve, final moisture), with the farms and their share of the wet beans.
   * {id, found: false} when the ferment is not in the records. has_checks / has_drying say whether anything was logged.
   */
  function fermentDetail(tabs, fid, target, today) {
    fid = str(fid);
    var f = (tabs['Ferments'] || []).filter(function (r) { return str(r['Ferment ID']) === fid; })[0];
    if (!f) return { id: fid, found: false };
    var temp = function (r, what) { var v = [1, 2, 3, 4, 5].map(function (i) { return num(r[what + ' ' + i + ' °C']); }).filter(function (x) { return x !== null; }); return v.length ? r1(mean(v)) : null; };
    var load = str(f['Load date']), unload = str(f['Unload date']), bagged = str(f['Bagged date']), dry = num(f['Dry lbs']);
    var ins = (tabs['Intakes'] || []).filter(function (r) { return str(r['Ferment ID']) === fid; }), farmLbs = map();
    ins.forEach(function (i) { var k = str(i['Farm']) || 'Not stated'; farmLbs[k] = (farmLbs[k] || 0) + (num(i['Wet lbs']) || 0); });
    var wet = ins.length ? sum(ins, function (i) { return num(i['Wet lbs']); }) : num(f['Wet lbs']);
    var checks = (tabs['Ferment checks'] || []).filter(function (r) { return str(r['Ferment ID']) === fid; }).map(function (r) {
      return { date: str(r['Date']).slice(0, 10), time: str(r['Time']), day: daysApart(load, r['Date']), stage: str(r['Stage']), turn: num(r['Turn #']), centre: temp(r, 'Centre'), top: temp(r, 'Top') };
    }).sort(function (a, b) { return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0); });
    var moves = checks.filter(function (c) { return c.stage === 'Turn'; }).map(function (c) { return { date: c.date, day: c.day, box: c.turn !== null ? c.turn + 1 : null }; });
    var peak = null;
    checks.forEach(function (c) { if (c.centre !== null && (peak === null || c.centre > peak.centre)) peak = c; });
    var log = (tabs['Drying log'] || []).filter(function (r) { return str(r['Ferment ID']) === fid; }).sort(function (a, b) { return str(a['Date']) < str(b['Date']) ? -1 : str(a['Date']) > str(b['Date']) ? 1 : 0; });
    var places = [];
    log.forEach(function (r) { var w = str(r['Location']).trim(); if (w && places.indexOf(w) < 0) places.push(w); });
    var inDry = str(f['Interior dry date']) || str((log.filter(function (r) { return str(r['Inside dryness']) === 'Dry'; })[0] || {})['Date']);
    var curve = moistureCurve(tabs, fid, target), outside = outsideDry(tabs, fid, today);
    return {
      id: fid, found: true, season: seasonOf(fid), stage: bagged || dry !== null ? 'Bagged' : unload ? 'Drying' : load ? 'Fermenting' : 'Not loaded yet',
      station: str(f['Station']), box_type: str(f['Box type']), plan: str(f['Ferment plan']), notes_text: str(f['Notes']),
      load_date: load, unload_date: unload, ferment_days: saneDays(daysApart(load, unload)),
      checks: checks, has_checks: checks.length > 0, moves: moves, boxes: 1 + moves.reduce(function (m, x) { return Math.max(m, x.box ? x.box - 1 : 0); }, 0),
      peak_centre: peak ? peak.centre : null, peak_day: peak ? peak.day : null,
      wet: wet, dry: dry, yield: wet && dry ? r1(dry / wet * 100) : null,
      has_drying: log.length > 0 || !!inDry || moist(f['Final moisture %']) !== null,
      drying_entries: log.length, places: places, inside_dry: inDry.slice(0, 10), drying_days: saneDays(daysApart(unload, inDry)),
      final_moisture: moist(f['Final moisture %']), bagged_date: bagged, curve: curve, days_to_target: saneDays(curve.days_to_target),
      outside: outside, days_dry_to_target: outside.date && curve.reached ? saneDays(dayNum(curve.reached.date) - dayNum(outside.date)) : null, // days from the outside being dry to the first reading in the band
      farms: Object.keys(farmLbs).sort(function (a, b) { return farmLbs[b] - farmLbs[a] || byNatural(a, b); }).map(function (k) { return { farm: k, lbs: r1(farmLbs[k]), pct: wet ? r1(farmLbs[k] / wet * 100) : null }; }),
    };
  }

  /**
   * The whole story of one batch, from the bar back to the farm: {batch (the making numbers), packages (each with its check-in and notes),
   * shell_packages, roasts (each roast's numbers and notes), ferments (each with fermentation, drying, share and notes), farms (share of
   * the nibs in % and lbs), notes and score (about the batch itself), flags, missing}. null when the batch is not in the records.
   * opts: {target (the target moisture), notes (tastingNotes() already worked out)}.
   */
  function batchStory(tabs, id, opts) {
    id = str(id); opts = opts || {};
    var c = opts.ctx || storyCtx(tabs, opts.notes), b = c.batches.filter(function (x) { return x.id === id; })[0];
    if (!b) return null;
    var s = batchChain(c, b);
    s.id = id; s.batch = b;
    s.roasts = s.roasts.map(function (r) {
      var full = c.roasts[r.id], o = {};
      if (full) for (var k in full) o[k] = full[k];
      o.notes_text = full ? full.notes : ''; // what was written on the roast; `notes` are its tasting notes
      o.id = r.id; o.found = r.found; o.ferment = r.ferment; o.ferments = r.ferments; o.mixed = r.mixed; o.packages = r.packages; o.notes = r.notes; // the packages of this roast that went into this batch
      return o;
    });
    s.ferments = s.ferments.map(function (f) {
      var d = fermentDetail(tabs, f.id, opts.target);
      d.lbs = f.lbs; d.pct = f.pct; d.roasts = f.roasts; d.notes = f.notes;
      var mine = s.roasts.filter(function (r) { return f.roasts.indexOf(r.id) >= 0 && r.found; });
      d.roast_max = mine.map(function (r) { return r.max_temp; }).filter(function (v) { return v !== null && v !== undefined; });
      d.nib_yield = mine.map(function (r) { return r.nib_yield; }).filter(function (v) { return v !== null && v !== undefined; });
      d.score = scoreOf(f.notes.concat.apply(f.notes, s.roasts.filter(function (r) { return f.roasts.indexOf(r.id) >= 0; }).map(function (r) { return r.notes; })
        .concat(s.packages.filter(function (p) { return p.ferments.indexOf(f.id) >= 0; }).map(function (p) { return p.notes; }))));
      if (d.found && !d.has_checks) s.missing.push({ what: 'fermentation', id: f.id });
      if (d.found && !d.has_drying) s.missing.push({ what: 'drying', id: f.id });
      return d;
    });
    var dates = [b.start_date, b.finish_date].concat(s.packages.map(function (p) { return p.arrival ? p.arrival.date : ''; }), s.roasts.map(function (r) { return r.date || ''; }), s.ferments.map(function (f) { return f.load_date || ''; })).filter(Boolean).sort();
    s.from = dates[0] || ''; s.to = dates[dates.length - 1] || '';
    return s;
  }

  /**
   * What stands out in a batch's story (app 1.19.1): plain comparisons between its ferments and between its roasts, worked out from
   * the numbers batchStory() already holds. Facts only: who was highest, lowest or different, and by how much; never a cause, a
   * judgement or advice. One line per measure at most, in the order the work happens (fermentation, drying, roasting, winnowing).
   *   - A measure is compared only when two or more of the batch's ferments (or roasts) have a number for it, and they differ by at
   *     least the measure's smallest step (a day, a minute, 0.5 of a degree or of a percentage point), so rounding is not news.
   *   - Two things: "A … more than B". Three or more with one apart and the rest alike: "A … more than the others". Otherwise the range.
   *   - A final moisture above the target is said for each ferment it is true of, whether or not there is anything to compare it with.
   * [{key, row (the line of the page it is about), text, marks: [{kind: 'ferment' | 'roast', id, hi}]}]. IDs stay text (2.1 is not 2.10).
   */
  var STORY_MEASURES = [
    { key: 'ferment_days', of: 'ferment', label: 'Days fermenting', step: 1, get: function (f) { return f.ferment_days; }, unit: 'day', up: 'fermented {d} longer than', down: 'fermented {d} less than' },
    { key: 'peak_centre', of: 'ferment', label: 'Peak centre temperature', step: 0.5, get: function (f) { return f.peak_centre; }, unit: '°C', up: 'peaked {d} higher than', down: 'peaked {d} lower than' },
    { key: 'drying_days', of: 'ferment', label: 'Days drying', step: 1, get: function (f) { return f.drying_days; }, unit: 'day', up: 'dried {d} longer than', down: 'dried {d} less than' },
    { key: 'final_moisture', of: 'ferment', label: 'Final moisture', step: 0.5, get: function (f) { return f.final_moisture; }, unit: '%', up: 'ended drying {d} higher in moisture than', down: 'ended drying {d} lower in moisture than' },
    { key: 'roast_max', of: 'roast', label: 'Roast max temperature', step: 0.5, get: function (r) { return r.max_temp; }, unit: '°C', up: 'reached a max temperature {d} higher than', down: 'reached a max temperature {d} lower than' },
    { key: 'mins_to_max', of: 'roast', label: 'Time to max temperature', step: 1, get: function (r) { return r.mins_to_max; }, unit: 'min', up: 'took {d} longer to reach its max temperature than', down: 'took {d} less to reach its max temperature than' },
    { key: 'nib_yield', of: 'roast', label: 'Nib yield', step: 0.5, get: function (r) { return r.nib_yield; }, unit: '%', up: 'gave a nib yield {d} higher than', down: 'gave a nib yield {d} lower than' },
  ];
  function storyAmount(v, unit, diff) {
    var t = String(r1(v));
    if (unit === 'day') return t + (r1(v) === 1 ? ' day' : ' days');
    if (unit === 'min') return t + ' min';
    if (unit === '°C') return t + ' °C';
    return diff ? t + (r1(v) === 1 ? ' point' : ' points') : t + '%'; // a difference between two percentages is in points
  }
  function storyInsights(s) {
    if (!s) return [];
    var out = [], cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
    STORY_MEASURES.forEach(function (m) {
      var list = (m.of === 'ferment' ? s.ferments : s.roasts).filter(function (x) { return x.found; }).map(function (x) { return { id: str(x.id), v: num(m.get(x)) }; }).filter(function (x) { return x.v !== null; });
      if (list.length < 2) return;
      var lo = Math.min.apply(null, list.map(function (x) { return x.v; })), hi = Math.max.apply(null, list.map(function (x) { return x.v; }));
      if (r1(hi - lo) < m.step) return;
      var his = list.filter(function (x) { return x.v === hi; }), los = list.filter(function (x) { return x.v === lo; }), name = function (x) { return m.of + ' ' + x.id; };
      var marks = his.map(function (x) { return { kind: m.of, id: x.id, hi: true }; }).concat(los.map(function (x) { return { kind: m.of, id: x.id, hi: false }; }));
      var d = storyAmount(hi - lo, m.unit, true), text;
      var levels = list.map(function (x) { return x.v; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length;
      if (list.length === 2) text = cap(name(his[0])) + ' ' + m.up.replace('{d}', d) + ' ' + name(los[0]) + ': ' + storyAmount(hi, m.unit) + ' against ' + storyAmount(lo, m.unit) + '.';
      else if (levels === 2 && his.length === 1) { text = cap(name(his[0])) + ' ' + m.up.replace('{d}', d) + ' the others: ' + storyAmount(hi, m.unit) + ' against ' + storyAmount(lo, m.unit) + '.'; marks = marks.filter(function (k) { return k.hi; }); }
      else if (levels === 2 && los.length === 1) { text = cap(name(los[0])) + ' ' + m.down.replace('{d}', d) + ' the others: ' + storyAmount(lo, m.unit) + ' against ' + storyAmount(hi, m.unit) + '.'; marks = marks.filter(function (k) { return !k.hi; }); }
      else {
        var who = function (a) { return a.map(function (x) { return x.id; }).join(', '); };
        text = m.label + ' ran from ' + storyAmount(lo, m.unit) + ' (' + who(los) + ') to ' + storyAmount(hi, m.unit) + ' (' + who(his) + ').';
      }
      out.push({ key: m.key, row: m.key, text: text, marks: marks });
    });
    s.ferments.forEach(function (f) {
      var t = f.curve ? num(f.curve.target) : null, v = num(f.final_moisture);
      if (!f.found || t === null || v === null || v <= t) return;
      out.push({ key: 'over_target:' + f.id, row: 'final_moisture', text: 'Ferment ' + f.id + ' finished drying above the ' + t + '% moisture target: its final moisture is ' + r1(v) + '%.', marks: [{ kind: 'ferment', id: str(f.id), hi: true }] });
    });
    return out;
  }

  /**
   * Every batch for the Batches list, best first: {id, start_date, finish_date, finished, destination, recipe, chocolate, output_units,
   * ferments [ids], farms [names], score (average of the notes about the batch, or null), scored, notes, off, flags}. Batches with no
   * score come after the scored ones, newest first.
   */
  function batchScores(tabs, notes) {
    var c = storyCtx(tabs, notes);
    return c.batches.map(function (b) {
      var s = batchChain(c, b);
      return { id: b.id, start_date: b.start_date, finish_date: b.finish_date, finished: b.finished, destination: b.destination, recipe: b.recipe, chocolate: b.chocolate, output_units: b.output_units,
        ferments: s.ferments.map(function (f) { return f.id; }), farms: s.farms.filter(function (f) { return !f.unknown; }).map(function (f) { return f.farm; }),
        score: s.score.avg, scored: s.score.n, notes: s.score.notes, off: s.score.off,
        off_before: s.flags.filter(function (f) { return f.kind === 'off' && f.where !== 'Batch'; }).length, arrival_problems: s.flags.filter(function (f) { return f.kind === 'arrival'; }).length, flags: s.flags };
    }).sort(function (a, b) {
      if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
      return (b.score || 0) - (a.score || 0) || (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0) || byNatural(a.id, b.id);
    });
  }

  /**
   * {ferment id: {avg, n, off}}: the average score of every tasting note about the ferment or anything made from it (its roasts, its
   * packages of nibs, and the batches those went into). A ferment with no scored note is not in the map.
   */
  function fermentScores(tabs, notes) {
    var c = storyCtx(tabs, notes), of = map();
    var add = function (f, n) { if (f) (of[f] = of[f] || []).push(n); };
    var inBatch = map();
    c.batches.forEach(function (b) { inBatch[b.id] = batchChain(c, b).ferments.map(function (f) { return f.id; }); });
    c.notes.forEach(function (n) {
      if (n.orphan) return;
      if (n.kind === 'Ferment') add(n.ref, n);
      else if (n.kind === 'Roast') (c.roasts[n.ref] ? c.roasts[n.ref].ferments : [fermentOfRoast(n.ref)]).forEach(function (f) { add(f, n); }); // P2-A: each ferment of a mixed roast
      else if (n.kind === 'Package') { var p = c.packs[n.ref]; if (!p || !isShells(p.contents)) (p ? p.ferments.map(function (x) { return x.id; }) : [fermentOfAny(n.ref)]).forEach(function (f) { add(f, n); }); }
      else if (n.kind === 'Batch') (inBatch[n.ref] || []).forEach(function (f) { add(f, n); });
    });
    var out = map();
    Object.keys(of).forEach(function (f) { var s = scoreOf(of[f]); if (s.n) out[f] = { avg: s.avg, n: s.n, off: s.off }; });
    return out;
  }

  /**
   * The batches one package or one ferment went into (kind: 'Package' or 'Ferment'), newest first: each with the batch's own numbers,
   * its score, how many lbs of this package or ferment it used, and (for nibs) that as a share of the batch's nibs.
   */
  function madeInto(tabs, kind, id, notes) {
    id = str(id);
    var c = storyCtx(tabs, notes), out = [];
    c.batches.forEach(function (b) {
      var s = batchChain(c, b), all = s.packages.concat(s.shell_packages);
      var mine = all.filter(function (p) { return kind === 'Package' ? p.id === id : p.ferments.indexOf(id) >= 0; });
      if (!mine.length) return;
      // a ferment's lbs: its share of each package (P2-A: a package of a mixed roast is only partly this ferment's)
      var part = function (p) { return kind === 'Package' ? p.used_lbs : p.used_lbs * sum(p.shares.filter(function (x) { return x.id === id; }), function (x) { return x.share; }); };
      var nibLbs = sum(mine.filter(function (p) { return !p.shells; }), part);
      out.push({ batch: b, score: s.score, flags: s.flags, lbs: r1(sum(mine, part)), nib_lbs: r1(nibLbs),
        pct: s.nib_lbs && nibLbs ? r1(nibLbs / s.nib_lbs * 100) : null, packages: mine.map(function (p) { return p.id; }), ferments: s.ferments.map(function (f) { return f.id; }) });
    });
    return out.sort(function (a, b) { return (a.batch.start_date < b.batch.start_date ? 1 : a.batch.start_date > b.batch.start_date ? -1 : 0) || byNatural(a.batch.id, b.batch.id); });
  }

  /* ---------------- Inventory: what is in each stage, and a season through the stages (app 1.24.0) ---------------- */
  /**
   * What makes up each stage of inventory(): {stage key: [{id, kind ('ferment' | 'roast' | 'package' | 'batch'), lbs, ...}]}.
   * The lbs of a stage's items add up to the stage's own figure (a test checks every stage), so a breakdown can never disagree
   * with the total above it. IDs are text throughout (2.1 is never 2.10). Nothing here reads a price or a payment.
   */
  function stageItems(inv) {
    var rst = inv.roasting || {}, mk = inv.making || {};
    var f = function (x, lbs) { return { id: x.id, kind: 'ferment', lbs: lbs || 0, farms: x.farms || '', load_date: x.load_date || '', unload_date: x.unload_date || '', bagged_date: x.bagged_date || '', bags: x.bags == null ? null : x.bags, dry: x.dry == null ? null : x.dry }; };
    var list = function (o, k) { return (o && o[k]) || []; };
    return {
      fermenting: list(inv.fermenting, 'ferments').map(function (x) { return f(x, x.wet); }),
      drying: list(inv.drying, 'ferments').map(function (x) { return f(x, x.wet); }),
      bagged: list(inv.bagged, 'ferments').map(function (x) { return f(x, x.left); }),
      roasted: list(rst.roasted_waiting, 'roasts').map(function (r) { return { id: r.id, kind: 'roast', ferment: r.ferment, ferments: r.ferments, date: r.date, lbs: r.roasted_lbs != null ? r.roasted_lbs : (r.beans_in || 0), weighed: r.roasted_lbs != null }; }),
      nibs: list(rst.nibs_waiting, 'roasts').map(function (r) { return { id: r.id, kind: 'roast', ferment: r.ferment, ferments: r.ferments, date: r.winnow_date || r.date, lbs: r1(Math.max(0, r.nib_lbs - r.packed_nibs)), nib_lbs: r.nib_lbs }; }),
      packed: list(rst.packed, 'packages').map(function (p) { return { id: p.id, kind: 'package', ferment: p.ferment, ferments: p.ferments.map(function (x) { return x.id; }), roast: p.roast, date: p.pack_date || '', lbs: p.lbs || 0 }; }),
      local: list(rst.local, 'packages').map(function (p) { return { id: p.id, kind: 'package', ferment: p.ferment, ferments: p.ferments.map(function (x) { return x.id; }), roast: p.roast, date: p.pack_date || '', lbs: p.local_left || 0 }; }), // P2-F
      shipped: list(rst.shipped, 'packages').map(function (p) { return { id: p.id, kind: 'package', ferment: p.ferment, ferments: p.ferments.map(function (x) { return x.id; }), roast: p.roast, shipment: p.shipment || '', date: p.pack_date || '', lbs: p.lbs || 0 }; }),
      arrived: list(mk, 'packages').map(function (p) { return { id: p.id, kind: 'package', ferment: p.ferment, ferments: p.ferments.map(function (x) { return x.id; }), roast: p.roast, date: (p.arrival && p.arrival.date) || '', lbs: p.left || 0 }; }),
      batches: list(mk, 'batches').map(function (b) { return { id: b.id, kind: 'batch', product: b.product || b.destination || '', date: b.start_date || b.date || '', finished: !!b.finished, lbs: b.nib_lbs || 0 }; }),
    };
  }
  /**
   * One season (or 'all') through the stages, in lbs, with the yield of each step WHERE IT CAN BE SAID, and what each yield is of:
   *   dry_pct    dry lbs ÷ wet lbs, over ferments that have both (finished ferments)
   *   roast_pct  roasted lbs out ÷ beans in, over roasts whose roasted weight was recorded
   *   nib_pct    nib lbs ÷ beans in, over roasts that have been winnowed
   * A yield with nothing to stand on is null (the page shows a dash), never a percentage of partial data. A roast belongs to its
   * own season (R3.1 → 3) and to the seasons of its ferments (inSeason). packed, shipped, arrived and used are nibs (shells apart), each counted from its own records.
   */
  function seasonFlow(tabs, season) {
    var all = str(season) === 'all' || season == null || season === '';
    var mine = function (id) { return all || seasonOf(id) === str(season); };
    var fs = ferments(tabs).filter(function (x) { return mine(x.id); });
    var done = fs.filter(function (x) { return x.wet != null && x.wet > 0 && x.dry != null; });
    var rs = roasts(tabs).filter(function (r) { return all || inSeason(r, season); }); // P2-A: its own season, or any of its ferments'
    var weighed = rs.filter(function (r) { return r.roasted_lbs != null && r.beans_in > 0; });
    var winnowed = rs.filter(function (r) { return r.winnowed && r.beans_in > 0; });
    var pk = [];
    rs.forEach(function (r) { pk = pk.concat(r.packages.filter(function (p) { return !isShells(p.contents); })); });
    var arrived = pk.filter(function (p) { return p.arrived; });
    var pctOf = function (a, b) { return b > 0 ? r1(a / b * 100) : null; };
    var wetDone = sum(done, function (x) { return x.wet; }), dryDone = sum(done, function (x) { return x.dry; });
    return {
      season: all ? 'all' : str(season), ferments: fs.length, finished: done.length,
      wet: sum(fs, function (x) { return x.wet || 0; }), dry: dryDone, dry_pct: pctOf(dryDone, wetDone), dry_basis_wet: wetDone,
      roasts: rs.length, beans_in: r1(sum(rs, function (r) { return r.beans_in || 0; })),
      roasted_out: weighed.length ? r1(sum(weighed, function (r) { return r.roasted_lbs; })) : null, weighed_roasts: weighed.length,
      roast_pct: weighed.length ? pctOf(sum(weighed, function (r) { return r.roasted_lbs; }), sum(weighed, function (r) { return r.beans_in; })) : null,
      nibs: winnowed.length ? r1(sum(winnowed, function (r) { return r.nib_lbs; })) : null, winnowed_roasts: winnowed.length,
      nib_pct: winnowed.length ? pctOf(sum(winnowed, function (r) { return r.nib_lbs; }), sum(winnowed, function (r) { return r.beans_in; })) : null,
      packed: r1(sum(pk, function (p) { return p.lbs || 0; })), packages: pk.length,
      shipped: r1(sum(pk.filter(function (p) { return p.shipment; }), function (p) { return p.lbs || 0; })),
      arrived: r1(sum(arrived, function (p) { return p.arrival.lbs != null ? p.arrival.lbs : (p.lbs || 0); })),
      used: r1(sum(pk, function (p) { return p.used_lbs || 0; })),
    };
  }

  /*
   * My entries → "From the records" (field app 1.26.1): every ferment with its deliveries, checks, drying and finish, as
   * read data gives them (whoever entered them, old app included). Newest ferment first; rows by date, then delivery,
   * check, drying, finish. IDs are compared as text ("2.1" is not "2.10").
   * opts: money (only true shows price, amount and paid_to, and only when the row has the column: the server leaves those
   * columns out for anyone who may not see money, and this never invents them), mine (this device's own entry IDs),
   * names (lower-case names that are "me"), limit (ferments kept, default 30).
   * A row is mine when its Source entry is one of opts.mine, or the name in Recorded by (the part before " (sent with "
   * or " (paper, typed in by ") is one of opts.names. A held shared-tablet row ("<device> (not checked: <name>)") is never mine.
   */
  var REC_KIND = { delivery: 0, check: 1, drying: 2, finish: 3 };
  // the name before " (sent with Pat's link)" or (review fix) " (paper, typed in by Jake)": a worker's own paper form, typed in by an admin, is theirs
  function recBase(by) {
    var s = str(by);
    [' (sent with ', ' (paper, typed in by '].forEach(function (cut) { var i = s.indexOf(cut); if (i >= 0) s = s.slice(0, i); });
    return s.trim().toLowerCase();
  }
  function records(tabs, opts) {
    tabs = tabs || {}; opts = opts || {};
    var money = opts.money === true;
    var limit = Number(opts.limit) > 0 ? Math.floor(Number(opts.limit)) : 30;
    var mineIds = map(); (opts.mine || []).forEach(function (id) { if (str(id)) mineIds[str(id)] = true; });
    var names = map(); (opts.names || []).forEach(function (n) { var k = str(n).trim().toLowerCase(); if (k) names[k] = true; });
    function isMine(r) {
      var by = str(r['Recorded by']);
      if (/\(not checked:/i.test(by)) return false;
      var src = str(r['Source entry']).trim();
      if (src && mineIds[src]) return true;
      var b = recBase(by);
      return !!b && !!names[b];
    }
    function has(r, h) { return Object.prototype.hasOwnProperty.call(r, h) && r[h] !== null && r[h] !== undefined && str(r[h]) !== ''; }
    function row(kind, r, date, extra) {
      var o = { kind: kind, date: str(date), by: kind === 'finish' ? '' : str(r['Recorded by']).trim(), mine: kind === 'finish' ? false : isMine(r) };
      Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined) o[k] = extra[k]; });
      return o;
    }
    var by = map();
    function slot(id) { return by[id] || (by[id] = []); }
    (tabs['Intakes'] || []).forEach(function (r) {
      var id = str(r['Ferment ID']).trim(); if (!id) return;
      var x = { farm: str(r['Farm']).trim(), lbs: num(r['Wet lbs']), buckets: num(r['Buckets']), text: '' };
      if (has(r, 'Bucket weights')) x.bucket_weights = str(r['Bucket weights']);
      if (money) { // only what the server sent: a column it left out stays out
        if (has(r, 'Price per lb (XCD)')) x.price = num(r['Price per lb (XCD)']);
        if (has(r, 'Amount paid (XCD)')) x.amount = num(r['Amount paid (XCD)']);
        if (has(r, 'Paid to')) x.paid_to = str(r['Paid to']).trim();
      }
      x.text = [x.farm, x.lbs != null ? x.lbs + ' lbs' : '', x.buckets != null ? x.buckets + ' buckets' : ''].filter(Boolean).join(' · ');
      slot(id).push(row('delivery', r, r['Date added'], x));
    });
    (tabs['Ferment checks'] || []).forEach(function (r) {
      var id = str(r['Ferment ID']).trim(); if (!id) return;
      var stage = str(r['Stage']).trim(), turn = num(r['Turn #']);
      var text = stage === 'Turn' ? (turn != null ? 'moved to box ' + (turn + 1) : 'moved to the next box') : stage === 'Unload' ? 'unloaded' : stage ? stage.toLowerCase() : 'checked';
      slot(id).push(row('check', r, r['Date'], { text: text }));
    });
    (tabs['Drying log'] || []).forEach(function (r) {
      var id = str(r['Ferment ID']).trim(); if (!id) return;
      var out = has(r, 'Exterior state') ? 'outside ' + str(r['Exterior state']).trim() : has(r, 'Exterior dry %') ? 'outside ' + num(r['Exterior dry %']) + '% dry' : has(r, 'Exterior / dryness') ? 'outside ' + str(r['Exterior / dryness']).trim() : '';
      var m = num(r['Moisture %']);
      var text = [str(r['Location']).trim(), out, m != null ? m + '%' : ''].filter(Boolean).join(' · ') || str(r['Observation']).trim();
      slot(id).push(row('drying', r, r['Date'], { text: text }));
    });
    var all = ferments(tabs);
    var seen = map();
    var list = (tabs['Ferments'] || []).map(function (r, i) {
      var f = all.filter(function (x) { return x.id === str(r['Ferment ID']); })[0];
      var id = str(r['Ferment ID']).trim();
      if (!id || seen[id]) return null;
      seen[id] = true;
      var rows = (by[id] || []).slice();
      var dry = num(r['Dry lbs']), bags = num(r['Bags']), bagged = str(r['Bagged date']);
      if (dry != null || bagged) rows.push(row('finish', r, bagged, { lbs: dry != null ? dry : undefined, bags: bags != null ? bags : undefined, text: [dry != null ? dry + ' lbs dry' : '', bags != null ? bags + (bags === 1 ? ' bag' : ' bags') : ''].filter(Boolean).join(' · ') || 'bagged' }));
      rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : REC_KIND[a.kind] - REC_KIND[b.kind]; });
      var farms = [], fm = map();
      rows.forEach(function (x) {
        if (x.kind !== 'delivery') return;
        var k = x.farm || '';
        if (!fm[k]) { fm[k] = { farm: k, lbs: 0 }; farms.push(fm[k]); }
        fm[k].lbs = Math.round((fm[k].lbs + (x.lbs || 0)) * 10) / 10;
      });
      return { id: id, season: seasonOf(id), station: str(r['Station']).trim(), load_date: str(r['Load date']), stage: f ? f.stage : '', wet: f ? f.wet : num(r['Wet lbs']), farms: farms, rows: rows, i: i };
    }).filter(Boolean);
    list.sort(function (a, b) { return idNum(b.id) - idNum(a.id) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) || b.i - a.i; });
    var out = { ferments: list.slice(0, limit).map(function (f) { delete f.i; return f; }) };
    if (list.length > limit) out.more = list.length - limit;
    return out;
  }

  root.CH_MODEL = { stockShown: stockShown, saneDays: saneDays, durationProblems: durationProblems, MAX_DAYS: MAX_DAYS, ferments: ferments, yieldPct: yieldPct, inventory: inventory, roasts: roasts, packages: packages, localUse: localUse, roastStock: roastStock, ledger: ledger, minutesBetween: minutesBetween,
    roastInputs: roastInputs, roastedByFerment: roastedByFerment, inSeason: inSeason, roastOfPackage: roastOfPackage, seasonOfRoastId: seasonOfRoastId, // P2-A
    arrivals: arrivals, batches: batches, makingStock: makingStock, checkOk: checkOk, nibSugar: nibSugar,
    TARGET_MOISTURE: TARGET_MOISTURE, moistureCurve: moistureCurve, moistureCurves: moistureCurves, daysToTarget: daysToTarget,
    tastingNotes: tastingNotes, tastingTrail: tastingTrail, tastingRecent: tastingRecent, tastingLink: tastingLink,
    DRY_OUTSIDE: DRY_OUTSIDE, outsideDry: outsideDry, dryingPlaces: dryingPlaces, targetBand: targetBand, bandPosition: bandPosition, juiceTotals: juiceTotals,
    needsAttention: needsAttention, seasonBefore: seasonBefore, vsLast: vsLast, stageItems: stageItems, seasonFlow: seasonFlow };
  root.CH_MODEL.batchStory = batchStory; root.CH_MODEL.batchScores = batchScores; root.CH_MODEL.fermentScores = fermentScores; root.CH_MODEL.fermentDetail = fermentDetail; root.CH_MODEL.madeInto = madeInto; root.CH_MODEL.storyInsights = storyInsights; // the tree-to-bar story (app 1.19.0)
  root.CH_MODEL.inProgress = inProgress; root.CH_MODEL.fermentState = fermentState; root.CH_MODEL.dayCount = dayCount; root.CH_MODEL.dayAxis = dayAxis; // the field app's home (slice 8)
  root.CH_MODEL.pallets = pallets; root.CH_MODEL.palletProgress = palletProgress; root.CH_MODEL.palletContents = palletContents; root.CH_MODEL.palletContentsFromTabs = palletContentsFromTabs; root.CH_MODEL.palletContentsFromLists = palletContentsFromLists; // P2-E, slice B
  root.CH_MODEL.records = records; // the field app's My entries: From the records (1.26.1)
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CH_MODEL;
})(typeof window !== 'undefined' ? window : this);
