/*
 * Labels page (admin): make QR labels for a ferment's bags, for every package of a roast, or for one package.
 * Uses the label kit (labelkit.js), the same one the factory tablet prints with. Black on white.
 * Three label sizes: a Letter page of 6, a Letter page of 10 (2 x 4 in) or a 4 x 6 in label printer (see labelkit.js SIZES to change them).
 */
(function () {
  'use strict';
  var P = window.CH_PAGE, K = window.CH_LABELKIT, el = P.el, $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  var DATA = null;
  var T = function (n) { return (DATA && DATA.tabs[n]) || []; };

  function options(sel, items) { sel.replaceChildren.apply(sel, items.map(function (i) { return new Option(i[1], i[0]); })); }
  function fermentIds() { return T('Ferments').map(function (f) { return P.str(f['Ferment ID']); }).filter(Boolean).sort(function (a, b) { return P.idKey(b) - P.idKey(a); }); }
  var natural = function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); }; // newest first, R10 after R9
  function roastIds() { return T('Roasts').map(function (r) { return P.str(r['Roast ID']); }).filter(Boolean).sort(natural); }
  function packageIds() { return T('Packages').map(function (r) { return P.str(r['Package ID']); }).filter(Boolean).sort(natural); }

  /** The label facts for one package from the records. */
  function packageInfo(id, siblings) {
    var r = T('Packages').filter(function (x) { return P.str(x['Package ID']) === id; })[0];
    if (!r) return null;
    var rid = P.str(r['Roast ID']), pk = K.parsePackageId(id);
    var ro = T('Roasts').filter(function (x) { return P.str(x['Roast ID']) === rid; })[0] || {};
    var all = siblings || T('Packages').filter(function (x) { return P.str(x['Roast ID']) === rid; });
    var c = K.countOf(id, P.str(r['Contents']) || 'Nibs', all.map(function (x) { return { id: P.str(x['Package ID']), contents: P.str(x['Contents']) || 'Nibs' }; }));
    // P2-A: the roast's ferments from its lines ("3.4, 3.5"); an old roast's Ferment ID, else the ferment an old number names. A new number names none.
    var fl = P.fermentsOfRoast(P.roastLines(DATA.tabs), rid);
    return { id: id, contents: P.str(r['Contents']) || 'Nibs', lbs: P.num(r['Lbs']), n: c.n, of: c.of, ferments: fl.length ? fl : (pk && pk.ferment ? [pk.ferment] : []), roast: rid,
      roast_date: P.str(ro['Roast date']), pack_date: P.str(r['Pack date']), 'for': P.str(r['For']) };
  }

  /** P2-D: copies of each package label (bag, box...): the stepper, which starts at the Label copies list. This print only. */
  function copiesWanted() { var n = Math.floor(Number($('copies').value)); return n >= 1 && n <= 4 ? n : K.copies(); }
  /** One package's labels, its copies together (bag, box...). */
  function copiesOf(info) { var out = []; for (var i = 1; i <= copiesWanted(); i++) out.push(K.packageLabel(Object.assign({}, info, { copy: i }))); return out; }
  function draw() {
    var kind = $('kind').value, what = $('what').value, size = $('size').value, labels = [];
    $('count-wrap').hidden = kind !== 'bag';
    $('copies-wrap').hidden = kind === 'bag';
    if (kind === 'bag') {
      var b = what && P.batch(DATA, what);
      if (b) {
        var n = Math.max(1, Math.min(60, Number($('count').value) || 1));
        var farms = Array.from(new Set(b.farms.map(function (i) { return i.farm; }))).join(', ');
        var moist = !CONF.fieldOn || CONF.fieldOn('finish_drying', 'moisture') ? b.moisture : null; // 2.3.0: not printed once the company stopped recording it
        for (var i = 1; i <= n; i++) labels.push(K.bagLabel({ ferment: b.id, i: i, n: n, load_date: b.load_date, bagged: b.bagged, farms: farms, moisture: moist }));
      }
    } else if (kind === 'roast') {
      var list = T('Packages').filter(function (x) { return P.str(x['Roast ID']) === what; }).sort(function (a, b) { return (K.parsePackageId(P.str(a['Package ID'])) || {}).n - (K.parsePackageId(P.str(b['Package ID'])) || {}).n; });
      list.forEach(function (x) { labels = labels.concat(copiesOf(packageInfo(P.str(x['Package ID']), list))); });
      $('hint').textContent = list.length ? '' : 'Nothing is packed from this roast yet.';
    } else {
      var info = what && packageInfo(what);
      if (info) labels = labels.concat(copiesOf(info));
    }
    if (kind === 'bag') $('hint').textContent = '';
    K.applyPageSize(size);
    var sheet = $('sheet');
    sheet.className = K.sheetClass(size);
    sheet.replaceChildren.apply(sheet, labels);
    $('print').disabled = !labels.length;
  }

  function fillWhat() {
    var kind = $('kind').value;
    $('what-label').textContent = kind === 'bag' ? 'Ferment' : kind === 'roast' ? 'Roast' : 'Package';
    var items = kind === 'bag' ? fermentIds().map(function (i) { return [i, 'Ferment ' + i]; }) : kind === 'roast' ? roastIds().map(function (i) { return [i, 'Roast ' + i]; }) : packageIds().map(function (i) { return [i, 'Package ' + i]; });
    options($('what'), items);
    if (!items.length) $('hint').textContent = kind === 'bag' ? 'No ferments yet.' : 'Nothing to label yet.';
    var b = kind === 'bag' && P.batch(DATA, $('what').value);
    $('count').value = b && b.bags ? b.bags : 1;
  }

  // 2.3.0: label types of an area the company switched off are not offered (bag labels: fermentation; roast and package labels: roasting)
  var KIND_AREA = { bag: 'fermentation', roast: 'roasting', package: 'roasting' };
  var CONF = window.CH_CONFIG || {};
  function kindsOn() {
    Array.prototype.slice.call($('kind').options).forEach(function (o) { var on = !CONF.areaOn || CONF.areaOn(KIND_AREA[o.value] || ''); o.hidden = !on; o.disabled = !on; });
    var sel = $('kind').options[$('kind').selectedIndex];
    if (sel && sel.disabled) { var first = Array.prototype.filter.call($('kind').options, function (o) { return !o.disabled; })[0]; if (first) $('kind').value = first.value; }
    return Array.prototype.some.call($('kind').options, function (o) { return !o.disabled; });
  }
  kindsOn();

  $('kind').addEventListener('change', function () { fillWhat(); draw(); });
  $('what').addEventListener('change', function () { var b = $('kind').value === 'bag' && P.batch(DATA, $('what').value); if (b) $('count').value = b.bags || 1; draw(); });
  $('count').addEventListener('input', draw);
  $('copies').value = K.copies();
  $('copies').addEventListener('input', draw);
  $('copies').addEventListener('change', function () { $('copies').value = copiesWanted(); draw(); });
  $('size').addEventListener('change', function () { K.setSize($('size').value); draw(); });
  $('print').addEventListener('click', function () { window.print(); });
  options($('size'), Object.keys(K.SIZES).map(function (k) { return [k, K.SIZES[k].name]; }));
  $('size').value = K.getSize();

  // 2.7.1: the copy on this device at once, then the fresh answer (what was chosen meanwhile is kept when it is still there)
  var first = function (data) {
    var was = DATA ? $('what').value : '';
    DATA = data;
    if (!kindsOn()) return;
    fillWhat();
    if (was && Array.prototype.some.call($('what').options, function (o) { return o.value === was; })) $('what').value = was;
    draw();
  };
  P.getData(function (copy) { var f = qs.get('f'), ro = qs.get('r'), pk = qs.get('p'); $('kind').value = pk ? 'package' : ro ? 'roast' : 'bag'; first(copy); var want = pk || ro || f; if (want && Array.prototype.some.call($('what').options, function (o) { return o.value === want; })) { $('what').value = want; draw(); } }).then(function (r) {
    var picked = DATA ? $('what').value : '';
    DATA = r.data;
    // A link can say what to print: labels.html?f=3.4 (bags), ?r=3.4-R1 (a roast), ?p=3.4-R1-P1 (a package).
    var f = qs.get('f'), ro = qs.get('r'), pk = qs.get('p');
    $('kind').value = pk ? 'package' : ro ? 'roast' : 'bag';
    if (!kindsOn()) { $('kind').disabled = true; $('msg').textContent = 'Labels are for the areas your company switched off on the Settings page.'; return; }
    fillWhat();
    var want = pk || ro || f;
    if (picked && Array.prototype.some.call($('what').options, function (o) { return o.value === picked; })) want = picked; // (chosen while the copy was showing)
    if (want && Array.prototype.some.call($('what').options, function (o) { return o.value === want; })) { $('what').value = want; var b = P.batch(DATA, want); if (b && b.bags) $('count').value = b.bags; }
    if (r.stale) $('msg').textContent = 'No connection: using the copy saved on this device.';
    draw();
  }).catch(function (err) {
    $('msg').textContent = err.paused ? err.message : err.notConnected ? 'This browser is not connected. Open the setup link once, then come back.' : 'No connection: ' + (err.message || err);
  });
})();
