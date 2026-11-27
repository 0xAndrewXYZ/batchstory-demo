/*
 * Small helpers shared by the read-only pages (batch page, bag labels): connection, reading the
 * Sheet's data (with the last copy kept for when there is no signal), building elements, dates.
 * The field app, dashboard and Entries page still have their own copies (to be folded in here).
 */
(function (root) {
  'use strict';
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked: fine */ } }

  /** This browser's connection: the setup link (ch.settings), else Jake's admin link (ch.admin). */
  function connection() {
    var s = load('ch.settings', {}) || {};
    if (s.url && s.key) return { url: s.url, key: s.key };
    var a = load('ch.admin', null);
    return a && a.url && a.key ? { url: a.url, key: a.key } : null;
  }
  /** Reads a setup link (#connect=…) if the page was opened with one, and keeps it like the app does. */
  function goodUrl(u) { return root.CH_CONFIG && CH_CONFIG.goodScriptUrl ? CH_CONFIG.goodScriptUrl(u) : /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '')); }
  function readConnect(text) {
    var m = String(text || '').match(/#connect=([A-Za-z0-9_\-=]+)/);
    if (!m) return false;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }))) /* UTF-8, so names like José survive */;
      if (!j.url || !j.key) return false;
      if (!goodUrl(j.url)) { api.badLink = true; return false; } // a link that points anywhere but our server is never kept
      var s = load('ch.settings', {}) || {};
      s.url = j.url; s.key = j.key; save('ch.settings', s);
      return true;
    } catch (e) { return false; }
  }

  /**
   * The dashboard data (all tabs). Falls back to the last copy on this device when the Sheet can't be reached.
   * 2.7.1: onCopy(copy), when given, is called at once with the copy this browser may use (keptCopy's rules), so the page
   * draws it while the fresh read runs (structure first, last copy second); the promise still brings the fresh answer.
   */
  function getData(onCopy) {
    var c = connection();
    if (!c) return Promise.reject(Object.assign(new Error('not connected'), { notConnected: true }));
    // By POST to this site's server (config.js), so the key never goes in a web address.
    var C = root.CH_CONFIG;
    // 2.5.0: with the stamp of the copy this browser may use (keptCopy's rules), so an unchanged Sheet answers a few bytes
    var me = load('ch.admin', null);
    var have = C && C.withCopy && C.keptCopy ? C.keptCopy('ch.batchdata', c.url, c.key, !!(me && me.key === c.key)) : null;
    if (have && have.tabs && typeof onCopy === 'function') { try { onCopy(have); } catch (e0) { /* the fresh answer draws it */ } }
    var read = function (since) {
      return (C && C.read ? C.read(c.url, c.key, 'data', since)
        : fetch(c.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: c.key, action: 'read', what: 'data' }) }))
        .then(function (r) { return r.text(); }).then(function (t) { return JSON.parse(t); });
    };
    return read(have && C.sinceOf(have)).then(function (p) {
      if (!p || p.unchanged !== true) return p;
      return C.withCopy(p, have) || read(null); // not for this copy: read it in full
    }).then(function (p) {
      if (p.signed_out) {
        if (root.CH_SIGNIN) return CH_SIGNIN.guard(p); // admin pages (labels): show the sign-in
        var a = load('ch.admin', null);
        if (a && a.session && a.key === c.key) {
          try { ['ch.admin', 'ch.batchdata', 'ch.dash'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
          if (C && C.dropCopies) C.dropCopies(); // 2.7.1: every admin view's kept copy too
          try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf('ch.c.') === 0) sessionStorage.removeItem(k); }); } catch (e) { /* ignore */ }
        }
      }
      if (p.suspended) { // the company is paused by Batchstory: nothing to show, not even the last copy
        try { localStorage.removeItem('ch.batchdata'); } catch (e) { /* ignore */ }
        throw Object.assign(new Error(p.error || 'Paused.'), { paused: true });
      }
      if (!p.ok) throw new Error(p.error || 'The request was refused.');
      if (p.company && C && C.setCompany) C.setCompany(p.company); // 2.3.0: also what the company tracks (labels leave out what is switched off)
      if (C && C.keepCopy) C.keepCopy('ch.batchdata', p, c.url, c.key); else save('ch.batchdata', p); // 2.4.6: with where it came from
      return { data: p, stale: false };
    }).catch(function (err) {
      var a = load('ch.admin', null);
      var cached = C && C.keptCopy ? C.keptCopy('ch.batchdata', c.url, c.key, !!(a && a.key === c.key)) : null; // 2.4.6: only a copy from this server (money: an admin or the same key)
      if (cached && !err.notConnected && !err.paused) return { data: cached, stale: true, error: err };
      throw err;
    });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else if (k === 'html') n.innerHTML = v; // only ever used for SVG built here (QR codes, charts)
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day0(s) { return s ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null; }
  function daysBetween(a, b) { return a && b ? Math.round((day0(b) - day0(a)) / 864e5) : null; }
  function sane(n) { return n == null || n < 0 || n > 120 ? null : n; } // the same limit as model.js MAX_DAYS (a typo'd date gives an impossible number of days)
  function short(s) { return s ? MONTHS[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) : ''; }
  function long(s) { return s ? short(s) + ', ' + s.slice(0, 4) : ''; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function num(v) { return v === '' || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v); } // 2.4.2: never Infinity
  function map() { return Object.create(null); } // 2.4.2: keyed by IDs or names, with no prototype ("constructor" is only an ID)
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function fmt(n, dp) { return n == null ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 }); }
  function idKey(id) { var m = String(id).match(/^(\d+)\.(\d+)$/); return m ? +m[1] * 10000 + +m[2] : 0; }
  function avg(a) { var v = a.filter(function (x) { return x != null; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null; }

  /** One ferment's history from the dashboard data, with no money in it (no prices, payments or payees). */
  function batch(data, id) {
    var T = data.tabs || {};
    var f = (T['Ferments'] || []).filter(function (r) { return str(r['Ferment ID']) === id; })[0];
    if (!f) return null;
    var intakes = (T['Intakes'] || []).filter(function (r) { return str(r['Ferment ID']) === id; })
      .map(function (r) { return { farm: str(r['Farm']) || 'Not stated', date: str(r['Date added']), picked: str(r['Pick dates']), lbs: num(r['Wet lbs']) }; });
    var wet = intakes.length ? intakes.reduce(function (s, i) { return s + (i.lbs || 0); }, 0) : num(f['Wet lbs']);
    var checks = (T['Ferment checks'] || []).filter(function (r) { return str(r['Ferment ID']) === id; }).map(function (r) {
      var top = [1, 2, 3, 4, 5].map(function (i) { return num(r['Top ' + i + ' °C']); });
      var centre = [1, 2, 3, 4, 5].map(function (i) { return num(r['Centre ' + i + ' °C']); });
      return { date: str(r['Date']), time: str(r['Time']), stage: str(r['Stage']), turn: num(r['Turn #']), top: avg(top), centre: avg(centre),
        colour: str(r['Colour']), smell: str(r['Smell']), cut: str(r['Interior (cut test)']), problems: str(r['Problems']), added: str(r['Added']), notes: str(r['Notes']) };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var drying = (T['Drying log'] || []).filter(function (r) { return str(r['Ferment ID']) === id; }).map(function (r) {
      return { date: str(r['Date']), location: str(r['Location']), weather: str(r['Weather']), outside: num(r['Exterior dry %']), outside_state: str(r['Exterior state']), inside: str(r['Inside dryness']),
        mold: str(r['Mold or bloom']), treatment: str(r['Treatment']), moisture: num(r['Moisture %']), note: str(r['Observation']),
        tent_temp: num(r['Tent temp °C']), tent_humidity: num(r['Tent humidity %']) };
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var load_ = str(f['Load date']), unload = str(f['Unload date']), bagged = str(f['Bagged date']);
    var dry = num(f['Dry lbs']);
    var inDry = str(f['Interior dry date']) || (drying.filter(function (d) { return d.inside === 'Dry'; })[0] || {}).date || '';
    checks.forEach(function (c) { c.day = daysBetween(load_, c.date); });
    return {
      id: id, season: id.split('.')[0], station: str(f['Station']), box: str(f['Box type']),
      load_date: load_, unload_date: unload, bagged: bagged, inside_dry: inDry,
      stage: bagged || dry != null ? 'Bagged' : unload ? 'Drying' : 'Fermenting',
      wet: wet, dry: dry, yield: wet && dry ? Math.round(dry / wet * 1000) / 10 : null,
      ferment_days: sane(daysBetween(load_, unload)), drying_days: sane(daysBetween(unload, inDry)), // an impossible number of days (a typo'd date) is not shown
      moisture: num(f['Final moisture %']), bags: num(f['Bags']), labels: str(f['Bag labels']),
      brix: num(f['Brix']), additions: str(f['Additions']), notes: str(f['Notes']),
      peak: checks.reduce(function (m, c) { return c.centre != null && (m == null || c.centre > m) ? c.centre : m; }, null),
      farms: intakes, checks: checks, drying: drying,
      roasts: roastsOf(T, id),
    };
  }

  /** Minutes between two clock times ("09:05", "9:05:00", "9:05 AM"); past midnight still works; null when either is missing. */
  function clock(t) {
    var m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*$/.exec(str(t));
    if (!m) return null;
    var h = Number(m[1]), ap = m[3] && m[3].toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h * 60 + Number(m[2]);
  }
  function minutes(a, b) { var x = clock(a), y = clock(b); return x === null || y === null ? null : (((y - x) % 1440) + 1440) % 1440; }

  /**
   * P2-A: which ferments went into each roast, as model.js roastInputs(): {roast id: [{ferment, lbs, share}]}. A roast's rows in
   * Roast inputs win; a roast made before P2-A (Roasts "Ferment ID" filled, no input rows) is one line with share 1. Never both.
   */
  function roastLines(T) {
    var out = map(), old = map();
    (T['Roast inputs'] || []).forEach(function (x) {
      var rid = str(x['Roast ID']), f = str(x['Ferment ID']);
      if (rid && f) (out[rid] = out[rid] || []).push({ ferment: f, lbs: num(x['Lbs']) });
    });
    (T['Roasts'] || []).forEach(function (r) {
      var rid = str(r['Roast ID']), f = str(r['Ferment ID']);
      if (!rid || !f || (out[rid] && !old[rid])) return; // input rows win
      old[rid] = true; (out[rid] = out[rid] || []).push({ ferment: f, lbs: num(r['Beans in lbs']) });
    });
    Object.keys(out).forEach(function (rid) {
      var ls = out[rid], tot = ls.reduce(function (t, x) { return t + (x.lbs || 0); }, 0);
      ls.forEach(function (x) { x.share = tot > 0 ? (x.lbs || 0) / tot : 1 / ls.length; });
    });
    return out;
  }
  /** The ferments of one roast, in the order of its lines (an old number not in the records: the ferment it names). */
  function fermentsOfRoast(lines, rid) {
    var out = [];
    (lines[rid] || []).forEach(function (x) { if (out.indexOf(x.ferment) < 0) out.push(x.ferment); });
    if (!out.length && fermentOfId(rid)) out.push(fermentOfId(rid));
    return out;
  }

  /**
   * The roasts of one ferment with their packages (stage 2). Lbs and °C. Only columns that are safe for any phone:
   * no prices, payments or payees exist in these tabs, and none is read here.
   * P2-A: every roast that took beans from this ferment, also one made with others (mixed: ferments lists them all, from_lbs is
   * what this ferment put in).
   */
  function roastsOf(T, fermentId) {
    var ships = map(), mk = makingMaps(T);
    (T['Shipments'] || []).forEach(function (s) { ships[str(s['Shipment ID'])] = s; });
    var packs = (T['Packages'] || []).map(function (r) {
      var sid = str(r['Shipment ID']);
      return { id: str(r['Package ID']), roast: str(r['Roast ID']), contents: str(r['Contents']) || 'Nibs', type: str(r['Package type']), lbs: num(r['Lbs']), pack_date: str(r['Pack date']),
        shipment: sid, ship_date: sid && ships[sid] ? str(ships[sid]['Ship date']) : '', notes: str(r['Notes']),
        arrival: arrivalView(mk.arrivals[str(r['Package ID'])], num(r['Lbs'])), uses: mk.uses[str(r['Package ID'])] || [] };
    });
    var lines = roastLines(T);
    return (T['Roasts'] || []).filter(function (r) { return fermentsOfRoast(lines, str(r['Roast ID'])).indexOf(fermentId) >= 0; }).map(function (r) {
      var id = str(r['Roast ID']), beans = num(r['Beans in lbs']), nib = num(r['Nib lbs']), shell = num(r['Shell lbs']), fl = fermentsOfRoast(lines, id);
      var mine = (lines[id] || []).filter(function (x) { return x.ferment === fermentId; });
      return { id: id, ferments: fl, mixed: fl.length > 1, from_lbs: mine.length ? mine.reduce(function (t, x) { return t + (x.lbs || 0); }, 0) : beans,
        date: str(r['Roast date']), beans_in: beans, loads: num(r['Roaster loads']), log_ref: str(r['Roaster log ref']),
        loss_lbs: nib != null && beans != null ? Math.round((beans - nib) * 10) / 10 : null, loss_pct: nib != null && beans ? Math.round((beans - nib) / beans * 1000) / 10 : null, roaster: str(r['Roaster']), plan: str(r['Roast plan']),
        mins_to_start: minutes(r['Start time'], r['Start temp reached time']), mins_to_max: minutes(r['Start time'], r['Max temp reached time']),
        start_temp: num(r['Start temp °C']), max_temp: num(r['Max temp °C']), cooling_min: num(r['Cooling minutes']), notes: str(r['Notes']),
        winnow_date: str(r['Winnow date']), nib_lbs: nib, shell_lbs: shell, winnow_notes: str(r['Winnow notes']),
        nib_yield: nib != null && beans ? Math.round(nib / beans * 1000) / 10 : null,
        packages: packs.filter(function (p) { return p.roast === id; }).sort(natural) };
    }).sort(natural);
  }

  /* ---------- Making (stage 3): what happened to a package in Walpole. Lbs. Never any money. ---------- */
  function yes(v) { return str(v).trim().toLowerCase() === 'yes'; }
  var OK_WORDS = ['ok', 'okay', 'good', 'fine']; // the same words as model.js: any other word on the "Arrival check" list is a problem
  function checkOk(v) { var t = str(v).trim().toLowerCase(); return t === '' ? null : OK_WORDS.indexOf(t) >= 0; }
  function r1(n) { return n == null ? null : Math.round(n * 10) / 10; }
  /** {arrivals: by package, uses: by package, batches: by batch} from the tabs. */
  function makingMaps(T) {
    var ar = map(), uses = map(), bs = map();
    (T['Batches'] || []).forEach(function (b) { bs[str(b['Batch ID'])] = b; });
    (T['Arrivals'] || []).forEach(function (r) { ar[str(r['Package ID'])] = r; });
    (T['Batch inputs'] || []).forEach(function (x) {
      var pid = str(x['Package ID']), b = bs[str(x['Batch ID'])] || {};
      if (!pid) return;
      (uses[pid] = uses[pid] || []).push({ batch: str(x['Batch ID']), lbs: num(x['Lbs used']), emptied: yes(x['Emptied']), date: str(b['Start date']), destination: str(b['Destination']), finished: !!str(b['Finish date']) });
    });
    return { arrivals: ar, uses: uses, batches: bs };
  }
  /** One check-in as the page shows it: the weight against what was packed, and which of smell, taste, look were not fine. */
  function arrivalView(r, packed) {
    if (!r) return null;
    var lbs = num(r['Arrival lbs']), smell = str(r['Smell']), taste = str(r['Taste']), look = str(r['Look']);
    var checks = [['Smell', smell], ['Taste', taste], ['Look', look]].map(function (x) { return { what: x[0], word: x[1], ok: checkOk(x[1]) }; });
    var change = lbs != null && packed != null ? r1(lbs - packed) : null;
    return { date: str(r['Arrival date']), lbs: lbs, change_lbs: change, change_pct: change != null && packed ? r1(change / packed * 100) : null, checks: checks,
      problems: checks.filter(function (c) { return c.ok === false; }).map(function (c) { return c.what; }), notes: str(r['Notes']) };
  }
  /** This browser's role: a personal link's role, the shared setup link is a field link, the admin link is an admin. null when not connected. */
  function role() {
    var s = load('ch.settings', {}) || {};
    if (s.url && s.key) return s.role || 'field';
    var a = load('ch.admin', null);
    return a && a.url && a.key ? 'admin' : null;
  }

  /** IDs in natural order: 3.4-R2 before 3.4-R10, P2 before P10 (text, so 3.1 and 3.10 stay apart). */
  function natural(a, b) { return String(a.id).localeCompare(String(b.id), undefined, { numeric: true }); }
  function isShells(c) { return /^shells?$/i.test(String(c || '').trim()); }

  /** One package (batch.html?p=3.4-R2-P1): the package, its roast, and the ferment's history. null when the package is not in the records. */
  function packageView(data, pid) {
    var T = data.tabs || {};
    var r = (T['Packages'] || []).filter(function (x) { return str(x['Package ID']) === pid; })[0];
    if (!r) return null;
    var roastId = str(r['Roast ID']);
    // P2-A: the package's ferments are its roast's lines (a new number like R3.1-P1 never names one); an old number names its own
    var ferments = fermentsOfRoast(roastLines(T), roastId);
    if (!ferments.length && fermentOfId(pid)) ferments = [fermentOfId(pid)];
    var fid = ferments[0] || '';
    var mine = fid ? roastsOf(T, fid) : [];
    var roast = mine.filter(function (x) { return x.id === roastId; })[0] || null;
    var pk = roast ? roast.packages.filter(function (x) { return x.id === pid; })[0] : null;
    // "Package n of N" counts the roast's packages with the same contents (nibs and shells apart)
    var same = roast && pk ? roast.packages.filter(function (x) { return isShells(x.contents) === isShells(pk.contents); }) : [];
    var mk = makingMaps(T);
    return { id: pid, ferment: fid, ferments: ferments, roast: roast, pkg: pk, siblings: same.length, place: same.indexOf(pk) + 1,
      arrival: pk ? pk.arrival : arrivalView(mk.arrivals[pid], num(r['Lbs'])), uses: pk ? pk.uses : (mk.uses[pid] || []) };
  }

  /**
   * One batch from Making (batch.html?c=W26-001): what it is, the numbers of the process, the packages that went in and the
   * ferments (and farms) behind them. null when the batch is not in the records. No money anywhere in these tabs.
   */
  function batchView(data, cid) {
    var T = data.tabs || {};
    var r = (T['Batches'] || []).filter(function (x) { return str(x['Batch ID']) === cid; })[0];
    if (!r) return null;
    var pk = map();
    (T['Packages'] || []).forEach(function (x) { pk[str(x['Package ID'])] = x; });
    var lines = roastLines(T);
    var ins = (T['Batch inputs'] || []).filter(function (x) { return str(x['Batch ID']) === cid; }).map(function (x) {
      var id = str(x['Package ID']), p = pk[id] || {}, roast = str(p['Roast ID']);
      // P2-A: the ferments of the package's roast, each with its share (an old number not in the records: the ferment it names)
      var sh = (lines[roast] || []).map(function (l) { return { id: l.ferment, share: l.share }; });
      if (!sh.length && fermentOfId(id)) sh = [{ id: fermentOfId(id), share: 1 }];
      return { package: id, roast: roast, ferment: sh.map(function (f) { return f.id; }).filter(function (f, i, a) { return a.indexOf(f) === i; }).join(', '), shares: sh, lbs: num(x['Lbs used']), emptied: yes(x['Emptied']), contents: str(p['Contents']) };
    });
    // a shells package is not nibs: its lbs are counted apart, still part of what went in (as model.js and the Sheet)
    var shellOf = function (i) { return /^shells?$/i.test(String(i.contents || '').trim()); };
    var nib = ins.reduce(function (s, i) { return s + (shellOf(i) ? 0 : i.lbs || 0); }, 0), shell = ins.reduce(function (s, i) { return s + (shellOf(i) ? i.lbs || 0 : 0); }, 0);
    var sugar = num(r['Sugar lbs']), butter = num(r['Cocoa butter lbs']), other = num(r['Other lbs']), out = num(r['Output lbs']);
    var total = nib + shell + (sugar || 0) + (butter || 0) + (other || 0);
    var TEMP = (root.CH_CONFIG && root.CH_CONFIG.units || {}).makingTemp || ''; // config.js: the unit in the temperature columns' names (°F)
    // each ferment's share of the nibs, and each farm's share inside that ferment (by wet lbs delivered)
    var byF = map();
    ins.forEach(function (i) { // a package of a mixed roast: its lbs split by the ferments' shares
      if (!i.lbs || shellOf(i)) return;
      if (!i.shares.length) byF['?'] = (byF['?'] || 0) + i.lbs;
      i.shares.forEach(function (f) { byF[f.id] = (byF[f.id] || 0) + i.lbs * f.share; });
    });
    var farmLbs = map();
    var ferments = Object.keys(byF).sort(function (a, b) { return byF[b] - byF[a]; }).map(function (f) {
      var share = nib ? byF[f] / nib : null, intakes = (T['Intakes'] || []).filter(function (x) { return str(x['Ferment ID']) === f; });
      var wet = intakes.reduce(function (s, x) { return s + (num(x['Wet lbs']) || 0); }, 0);
      intakes.forEach(function (x) { if (wet && share != null) { var k = str(x['Farm']) || 'Not stated'; farmLbs[k] = (farmLbs[k] || 0) + share * (num(x['Wet lbs']) || 0) / wet; } });
      return { id: f, lbs: r1(byF[f]), pct: share != null ? r1(share * 100) : null };
    });
    var farms = Object.keys(farmLbs).sort(function (a, b) { return farmLbs[b] - farmLbs[a]; }).map(function (k) { return { farm: k, pct: r1(farmLbs[k] * 100) }; });
    var sg = sugar != null && nib + sugar > 0 ? Math.round(nib / (nib + sugar) * 100) : null;
    var dest = str(r['Destination']);
    return { id: cid, destination: dest, chocolate: dest.trim().toLowerCase() === 'chocolate', recipe: str(r['Recipe']), start_date: str(r['Start date']), finish_date: str(r['Finish date']), finished: !!str(r['Finish date']),
      nib_lbs: r1(nib), shell_lbs: r1(shell), sugar: sugar, butter: butter, other: str(r['Other ingredients']), other_lbs: other, ratio: sg != null ? sg + ' : ' + (100 - sg) : '', target_micron: num(r['Target micron']), notes: str(r['Notes']),
      hours_to_target: num(r['Hours to target']), final_micron: num(r['Final micron']), conche_hours: num(r['Conche hours']), conche_temp: num(r['Conche temp ' + TEMP]), process_temp: num(r['Process temp ' + TEMP]), temp_unit: TEMP,
      output_lbs: out, output_units: num(r['Output units']), out_pct: out != null && total ? r1(out / total * 100) : null, finish_notes: str(r['Finish notes']),
      inputs: ins, ferments: ferments, farms: farms };
  }
  function fermentOfId(id) { var m = /^(\d+\.\d+)-R\d+/.exec(String(id)); return m ? m[1] : ''; } // an OLD number only (3.4-R2-P1 → 3.4); R3.1-P1 names no ferment

  /** A day as people read it: "Nov 3", and "Nov 3, 2025" whenever the year is not this year. utc: a date-only value (2026-11-03) read as that day everywhere. */
  function dayText(d, utc, more) {
    d = d instanceof Date ? d : new Date(d);
    if (isNaN(d.getTime())) return '';
    var o = { month: 'short', day: 'numeric', year: (utc ? d.getUTCFullYear() : d.getFullYear()) === new Date().getFullYear() ? undefined : 'numeric' };
    if (utc) o.timeZone = 'UTC';
    if (more) Object.keys(more).forEach(function (k) { o[k] = more[k]; });
    return d.toLocaleDateString([], o);
  }

  /**
   * Slice B: the packages on one pallet, read only (the field app's sheet, the dashboard's panel and the batch page's section all draw it
   * here, so the words and columns cannot drift). view: CH_MODEL.palletContents(...). opts: {here: the package ID to mark "this one",
   * href: function (packageId) -> address (a link on the package ID; none = plain text), empty: words for a pallet with nothing on it}.
   * Empty = the muted dash (td:empty in ui.css); a real 0 stays 0; IDs are text; Lbs right-aligned. Nothing here is an input.
   */
  function palletTable(view, opts) {
    opts = opts || {};
    var v = view || { rows: [], n: 0, arrived_n: 0, lbs: 0 };
    var rows = v.rows || [];
    var wrap = el('div', { className: 'pallet-contents', 'data-pallet': str(v.id) });
    if (!rows.length) { wrap.appendChild(el('p', { className: 'sub pallet-empty', text: opts.empty || 'No packages on this pallet in the records.' })); return wrap; }
    var lb = function (n) { return fmt(n, 1); }; // one decimal, as the dashboard and the package page
    var since = v.state === 'at port' ? 'At the port' + (v.date ? ' since ' + short(v.date) : '') : v.state === 'on the water' ? 'On the water' + (v.left_port ? ' since ' + short(v.left_port) : '')
      : v.state === 'arriving' ? 'Arriving' : 'All checked in';
    var line = [since, v.state === 'arrived' ? '' : v.arrived_n + ' of ' + v.n + ' checked in', lb(v.lbs) + ' lbs' + (v.unweighed ? ' (some not weighed)' : '')].filter(Boolean).join(' · ');
    wrap.appendChild(el('p', { className: 'pallet-status', text: line }));
    var th = function (t, c) { return el('th', { scope: 'col', className: c || '', text: t }); };
    var cell = function (t, c) { return el('td', { className: c || '' }, t === '' || t === null || t === undefined ? [] : [t]); };
    var body = rows.map(function (r) {
      var idNode = el('span', {}, [opts.href ? el('a', { href: opts.href(r.id), text: r.id }) : str(r.id)]);
      if (/^shells?$/i.test(r.contents)) idNode.appendChild(el('span', { className: 'pallet-note', text: ' Shells' }));
      if (opts.here && opts.here === r.id) idNode.appendChild(el('span', { className: 'pallet-here', text: ' this one' }));
      return el('tr', opts.here && opts.here === r.id ? { className: 'sel' } : {}, [
        cell(r.i + ' of ' + r.n), el('td', { className: 'id' }, [idNode]), cell(str(r.roast)), cell(r.ferments.join(', ')),
        cell(r.lbs === null || r.lbs === undefined ? '' : lb(r.lbs), 'n'), cell(str(r['for'])), cell(r.arrived ? 'Yes' : ''),
      ]);
    });
    // narrow places (a phone, a side panel): one stacked row per package instead of the wide table (ui.css container query)
    wrap.appendChild(el('ul', { className: 'pallet-list' }, rows.map(function (r) {
      var here = opts.here && opts.here === r.id;
      var l1 = [opts.href ? el('a', { href: opts.href(r.id), text: r.id }) : str(r.id)];
      if (/^shells?$/i.test(r.contents)) l1.push(el('span', { className: 'pallet-note', text: ' Shells' }));
      if (here) l1.push(el('span', { className: 'pallet-here', text: ' this one' }));
      var parts = [r.i + ' of ' + r.n, str(r.roast) || '\u2013', r.ferments.length ? 'ferments ' + r.ferments.join(', ') : '\u2013', r.lbs === null || r.lbs === undefined ? '\u2013' : lb(r.lbs) + ' lbs', str(r['for']), r.arrived ? 'Checked in' : 'Not checked in'].filter(Boolean);
      var sub = [];
      parts.forEach(function (t, i) { if (i) sub.push(' \u00B7 '); sub.push(el('span', { text: t })); }); // each part stays on one line
      return el('li', { className: 'pallet-item' + (here ? ' sel' : '') }, [el('div', { className: 'pallet-item-id' }, l1), el('div', { className: 'pallet-item-sub' }, sub)]);
    })));
    wrap.appendChild(el('div', { className: 'table-wrap pallet-wrap' }, [el('table', { className: 'table pallet-table' }, [
      el('caption', { className: 'sr-only', text: 'Packages on pallet ' + str(v.id) }),
      el('thead', {}, [el('tr', {}, [th('n of N'), th('Package'), th('Roast'), th('Ferments'), th('Lbs', 'n'), th('For'), th('Checked in')])]),
      el('tbody', {}, body),
    ])]));
    return wrap;
  }
  var api = root.CH_PAGE = { palletTable: palletTable, dayText: dayText, load: load, save: save, connection: connection, readConnect: readConnect, getData: getData, el: el,
    daysBetween: daysBetween, short: short, long: long, today: today, num: num, str: str, fmt: fmt, idKey: idKey, batch: batch, packageView: packageView, batchView: batchView, role: role, fermentOfId: fermentOfId, minutes: minutes, roastLines: roastLines, fermentsOfRoast: fermentsOfRoast };
})(this);
