/*
 * Print labels (factory tablet, offline). Works from what this tablet already holds: packages it packed
 * (entries in IndexedDB, sent or not) and the last copy of the roasts and packages lists. No network.
 * ?entry=<entry id> opens with that Pack entry's packages ticked (the "Print labels" button after saving).
 */
(function () {
  'use strict';
  var P = window.CH_PAGE, K = window.CH_LABELKIT, el = P.el, $ = function (id) { return document.getElementById(id); };
  if (window.CH_ICON) Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'), function (n) { n.outerHTML = CH_ICON(n.getAttribute('data-icon'), 20); });
  var want = new URLSearchParams(location.search).get('entry') || '';
  var S = { roasts: Object.create(null), packages: Object.create(null), entryOf: Object.create(null) }; // 2.4.2: keyed by IDs, no prototype

  /** Everything the tablet knows about packages and their roasts: the saved lists first, then its own entries (newer). */
  function collect(entries) {
    var lists = P.load('ch.lists', {}) || {};
    // P2-A: a roast can take beans from several ferments: the label names them all ("3.4, 3.5"); an older list has only ferment
    // P2-D: the ferments as a list of IDs (an older list has only the one ferment; none known = an empty list, never "undefined")
    var names = function (fs, one) { var t = (fs || []).map(function (f) { return f && typeof f === 'object' ? f.id : f; }).filter(Boolean); return t.length ? t : (one ? [one] : []); };
    (lists.roasts || []).forEach(function (r) { S.roasts[r.id] = { id: r.id, ferments: names(r.ferments, r.ferment), date: r.date }; });
    (lists.packages || []).forEach(function (p) { S.packages[p.id] = { id: p.id, roast: p.roast, contents: p.contents, lbs: p.lbs, pack_date: p.pack_date, 'for': p['for'] }; });
    entries.slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).forEach(function (e) {
      var d = e.data || {};
      if (e.form === 'roast' && d.roast_id) S.roasts[d.roast_id] = { id: d.roast_id, ferments: names((Array.isArray(d.inputs) ? d.inputs : []).map(function (x) { return x && x.ferment; }), d.ferment), date: d.date }; // "Beans from" lines, or an old entry's one ferment
      var rows = e.form === 'pack' ? CH.packRows(d) : []; // P2-C: the packages as flat rows, for a new entry (groups) and an old one (packages)
      if (e.form === 'pack') (d.package_ids || []).forEach(function (id, i) {
        if (S.packages[id]) return; // the first package with this ID wins (the Sheet's, or the older entry's): a later one never replaces it
        S.packages[id] = { id: id, roast: d.roast, contents: d.contents || 'Nibs', lbs: rows[i] && rows[i].lbs !== '' && rows[i].lbs !== undefined ? Number(rows[i].lbs) : null, pack_date: d.date, 'for': rows[i] && rows[i]['for'] };
        S.entryOf[id] = e.entry_id;
      });
    });
    Object.keys(S.packages).forEach(function (id) { // a package of a roast this tablet has not heard of: the ID says which ferment and roast
      var p = S.packages[id], parts = K.parsePackageId(id);
      if (!p.roast && parts) p.roast = parts.roast;
      if (!S.roasts[p.roast] && parts) S.roasts[p.roast] = { id: p.roast, ferments: parts.ferment ? [parts.ferment] : [], date: '' };
    });
  }
  function ofRoast(rid) { return Object.keys(S.packages).map(function (id) { return S.packages[id]; }).filter(function (p) { return p.roast === rid; }).sort(function (a, b) { return (K.parsePackageId(a.id) || {}).n - (K.parsePackageId(b.id) || {}).n; }); }
  function roastIds() {
    var ids = Object.create(null);
    Object.keys(S.packages).forEach(function (id) { ids[S.packages[id].roast] = 1; });
    var key = function (r) { return P.idKey(r.replace(/^R/, '').split('-')[0]); }; // R3.1 and 3.4-R2 both by season, then number: newest first
    return Object.keys(ids).sort(function (a, b) { return key(b) - key(a) || b.localeCompare(a, undefined, { numeric: true }); });
  }

  function picked() { return Array.prototype.filter.call($('packages').querySelectorAll('input:checked'), function () { return true; }).map(function (i) { return i.value; }); }
  /** Copies of each label for this print only (not saved): the stepper, starting at the "Label copies" list. */
  function copiesWanted() { var n = Math.floor(Number($('copies').value)); return n >= 1 && n <= 4 ? n : K.copies(); }
  function draw() {
    var size = $('size').value;
    $('sheet').className = K.sheetClass(size);
    K.applyPageSize(size);
    var ids = picked(), labels = [];
    var all = ofRoast($('roast').value);
    var k = copiesWanted();
    ids.forEach(function (id) { // the copies of one package come off together: bag, box, then the next package
      var p = S.packages[id], parts = K.parsePackageId(id) || {}, r = S.roasts[p.roast] || {}, c = K.countOf(id, p.contents, all);
      var fl = r.ferments && r.ferments.length ? r.ferments : (parts.ferment ? [parts.ferment] : []);
      for (var i = 1; i <= k; i++) labels.push(K.packageLabel({ id: id, contents: p.contents, lbs: p.lbs, n: c.n, of: c.of, ferments: fl, roast: p.roast, roast_date: r.date, pack_date: p.pack_date, 'for': p['for'], copy: i }));
    });
    $('sheet').replaceChildren.apply($('sheet'), labels);
    $('print').disabled = !labels.length;
    $('msg').textContent = labels.length ? labels.length + (labels.length === 1 ? ' label' : ' labels') + ' ready.' : 'Tick the packages to print.';
  }
  function drawPackages(rid, only) {
    var list = ofRoast(rid);
    $('packages').replaceChildren.apply($('packages'), [el('legend', { text: 'Packages to print' })].concat(list.map(function (p) {
      var cb = el('input', { type: 'checkbox', value: p.id });
      if (!only || only.indexOf(p.id) >= 0) cb.checked = true;
      cb.addEventListener('change', draw);
      return el('label', { className: 'pk' }, [cb, el('span', { text: p.id + (p.lbs != null ? ' · ' + P.fmt(p.lbs, 1) + ' lbs' : '') + (p.contents === 'Shells' ? ' · shells' : '') })]);
    })));
    draw();
  }

  $('size').replaceChildren.apply($('size'), Object.keys(K.SIZES).map(function (k) { return new Option(K.SIZES[k].name, k); }));
  $('size').value = K.getSize();
  $('copies').value = K.copies();
  $('copies').addEventListener('input', draw);
  $('copies').addEventListener('change', function () { $('copies').value = copiesWanted(); draw(); });
  $('size').addEventListener('change', function () { K.setSize($('size').value); draw(); });
  $('roast').addEventListener('change', function () { drawPackages($('roast').value); });
  $('print').addEventListener('click', function () { window.print(); });

  // The company is paused (Batchstory): no labels, like the other pages. The app stored the pause in this browser's settings.
  var paused = (P.load('ch.settings', {}) || {}).paused;
  if (paused) {
    $('roast').replaceChildren(); $('print').disabled = true;
    $('msg').textContent = (paused.company || (window.CH_CONFIG || {}).company || 'The company') + ' is paused. Ask ' + (paused.contact || (window.CH_CONFIG || {}).contact || 'Jake') + '.';
    return;
  }
  CH.DB.all().catch(function () { return []; }).then(function (entries) {
    collect(entries);
    var ids = roastIds();
    if (!ids.length) { $('roast').replaceChildren(); $('print').disabled = true; $('msg').textContent = 'No packages on this tablet yet. Save a Pack entry first.'; return; }
    $('roast').replaceChildren.apply($('roast'), ids.map(function (r) { var n = ofRoast(r).length; return new Option('Roast ' + r + ' · ' + n + (n === 1 ? ' package' : ' packages'), r); }));
    var only = null;
    if (want) {
      var mine = Object.keys(S.entryOf).filter(function (id) { return S.entryOf[id] === want; });
      if (mine.length) { only = mine; $('roast').value = S.packages[mine[0]].roast; }
    }
    drawPackages($('roast').value, only);
  });
})();
