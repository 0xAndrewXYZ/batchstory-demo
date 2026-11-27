/*
 * Label kit: builds one label (bag of dry beans, or package of nibs) and its QR code. No network.
 * Used by the factory tablet's print page (print.html, works offline) and by the admin Labels page (labels.html).
 * Needs common.js (CH_PAGE.el, dates) and vendor/qrcode.js. Labels print black on white, whatever the colour scheme.
 * The code holds a plain web address: batch.html?f=3.4 (bag) or batch.html?p=3.4-R2-P1 (package). Printed labels
 * last for years, so those two addresses must keep working for as long as a labelled bag or package exists.
 */
(function (root) {
  'use strict';
  var P = root.CH_PAGE, el = P.el;

  // Label sizes. Done with CSS page sizes (admin.css .sheet / .size-4x6); no library.
  var SIZES = {
    sheet: { name: 'Letter paper, 6 labels per page', page: 'letter', margin: '0.4in 0.2in', cls: '' },
    sheet10: { name: 'Letter paper, 10 labels per page (2 × 4 in)', page: 'letter', margin: '0.5in 0.15in', cls: 'size-2x4' }, // 1.22.2: the common 10-up shipping-label sheet
    label4x6: { name: '4 × 6 in label printer, one per page', page: '4in 6in', margin: '0.1in', cls: 'size-4x6' }, // [A11] the factory's label stock is not known yet
  };
  var DEFAULT_SIZE = 'sheet';
  function getSize() { var s = P.load('ch.labelsize', DEFAULT_SIZE); return SIZES[s] ? s : DEFAULT_SIZE; }
  function setSize(s) { if (SIZES[s]) P.save('ch.labelsize', s); }
  /** The sheet's class for a size: 'sheet', plus the size's own layout (admin.css). */
  function sheetClass(size) { var z = SIZES[size] || SIZES[DEFAULT_SIZE]; return 'sheet' + (z.cls ? ' ' + z.cls : ''); }
  /** Tells the printer the paper size for this page (an @page rule cannot be switched by a class). Call with the chosen size. */
  function applyPageSize(size) {
    var st = document.getElementById('label-page-size');
    if (!st) { st = document.createElement('style'); st.id = 'label-page-size'; document.head.appendChild(st); }
    var z = SIZES[size] || SIZES[DEFAULT_SIZE];
    st.textContent = '@media print { @page { size: ' + z.page + '; margin: ' + z.margin + '; } }';
  }

  function qrSvg(text) {
    var q = root.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  /**
   * The address a label's code holds. kind: 'f' (ferment, a bag) or 'p' (package). Always the company's live site
   * (CH_CONFIG.labelBase), never the address this page happens to be open at (a test copy, a laptop), because the
   * label lasts for years. Only without labelBase does it fall back to this page's own site.
   */
  function address(kind, id) {
    var base = (root.CH_CONFIG && root.CH_CONFIG.labelBase) || root.location.href;
    return new URL('batch.html?' + kind + '=' + encodeURIComponent(id), base).href;
  }
  function isShells(c) { return /^shells?$/i.test(String(c || '').trim()); }
  /**
   * "Package 2 of 3": counted among the roast's packages with the same contents (nibs and shells apart), in package-number
   * order. all: [{id, contents}] of the roast. Returns {n, of} (0s when the package is not in the list).
   */
  function countOf(id, contents, all) {
    var same = (all || []).filter(function (x) { return isShells(x.contents) === isShells(contents); })
      .sort(function (a, b) { return ((parsePackageId(a.id) || {}).n || 0) - ((parsePackageId(b.id) || {}).n || 0); });
    var i = same.map(function (x) { return x.id; }).indexOf(id);
    return { n: i + 1, of: i < 0 ? 0 : same.length };
  }
  function company() { return (root.CH_CONFIG || {}).company || 'Cocoahead'; } // the Company settings page's name once it is set (config.js)
  // 2.7.3: the demo company's labels say DEMO twice (beside the name and under the code), so a demo label never passes for a real one
  function isDemo() { return !!(root.CH_CONFIG || {}).demo; }
  function brandText() { return company() + (isDemo() ? ' · DEMO' : ''); }
  function scanText() { return isDemo() ? 'DEMO · made-up data' : 'Scan for batch history'; }
  function shipTo() { return String((root.CH_CONFIG || {}).shipTo || ''); } // 2.1.0: "Ship to …" on package labels; empty leaves it out

  /**
   * The foot of a label (1.22.2): ruled lines to write on by hand, across the label's whole width, so the lower half is used on purpose.
   * A bag gets "Dry weight … lbs" (it is weighed after the label is stuck on); every label gets a Notes line.
   */
  function writeIn(weigh) {
    return el('div', { className: 'write' }, [
      weigh ? el('div', { className: 'weigh' }, [el('span', { className: 'w-l', text: 'Dry weight' }), el('span', { className: 'w-rule', html: '&nbsp;' }), el('span', { className: 'w-u', text: 'lbs' })]) : null,
      el('div', { className: 'notes' }, [el('span', { className: 'w-l', text: 'Notes' }), el('span', { className: 'w-rule', html: '&nbsp;' })]),
    ]);
  }
  function bagLabel(o) {
    return el('div', { className: 'label bag-label' }, [
      el('div', {}, [
        el('div', { className: 'brand', text: brandText() }),
        el('div', { className: 'id', text: o.ferment }),
        el('div', { className: 'bag', text: 'Bag ' + o.i + ' of ' + o.n }),
        el('div', { className: 'meta' }, [
          el('div', {}, [el('b', { text: 'Started ' }), P.long(o.load_date) || '–']),
          o.bagged ? el('div', {}, [el('b', { text: 'Bagged ' }), P.long(o.bagged)]) : null,
          o.farms ? el('div', {}, [el('b', { text: 'Farms ' }), o.farms]) : null,
          o.moisture != null ? el('div', {}, [el('b', { text: 'Moisture ' }), o.moisture + '%']) : null,
        ]),
      ]),
      el('div', { className: 'qr', 'data-address': address('f', o.ferment) }, [el('div', { html: qrSvg(address('f', o.ferment)) }), el('div', { className: 'scan', text: scanText() })]), // data-address: exactly what the code holds
      writeIn(true),
    ]);
  }

  /**
   * P2-D: how many labels each package prints: the first entry of the "Label copies" list (a whole number 1-4), else 2 (bag and box).
   * Read from the lists this device holds (ch.lists), so it works with no signal.
   */
  var DEFAULT_COPIES = 2;
  function copies() {
    var l = (P.load('ch.lists', {}) || {})['Label copies'], v = Array.isArray(l) ? l[0] : null;
    var n = /^\s*[1-4]\s*$/.test(String(v == null ? '' : v)) ? Number(v) : NaN;
    return n >= 1 && n <= 4 ? n : DEFAULT_COPIES;
  }
  /** The mark in a label's top corner: copy 1 is the bag's, copy 2 the box's, any further copy has none. */
  function copyMark(copy) { return copy === 1 ? 'Bag' : copy === 2 ? 'Box' : ''; }
  /** The ferments line: "Ferment 3.4", "Ferments 3.4, 3.5"; more than three: the first three then "+2". '' when none is known. */
  function fermentsText(list) {
    var ids = (list || []).map(function (f) { return String(f && typeof f === 'object' ? f.id : f == null ? '' : f).trim(); }).filter(Boolean);
    if (!ids.length) return '';
    return (ids.length === 1 ? 'Ferment ' : 'Ferments ') + ids.slice(0, 3).join(', ') + (ids.length > 3 ? ' +' + (ids.length - 3) : '');
  }
  /**
   * o: {id, contents, lbs, n and of (countOf: its place among the roast's packages with the same contents), ferments: [ids] (or the old one
   * ferment, a string), roast, roast_date, pack_date, for ('Local use' or Shipping/blank), copy (1 = Bag, 2 = Box)}. The roast number is the
   * largest thing on it. Never money, never farm names. The code is unchanged: address('p', id).
   */
  function packageLabel(o) {
    var fl = Array.isArray(o.ferments) && o.ferments.length ? o.ferments : (o.ferment ? [o.ferment] : []);
    var ft = fermentsText(fl), local = String(o['for'] == null ? '' : o['for']).trim().toLowerCase() === 'local use', mark = copyMark(o.copy);
    var dates = [o.roast_date ? 'Roasted ' + P.short(o.roast_date) : '', o.pack_date ? 'Packed ' + P.short(o.pack_date) : ''].filter(Boolean).join(' · ');
    var place = local ? el('div', { className: 'local-use' }, [el('b', { text: 'LOCAL USE' })]) : shipTo() ? el('div', { className: 'ship-to' }, [el('b', { text: 'Ship to ' }), shipTo()]) : null;
    return el('div', { className: 'label pack-label' }, [
      el('div', {}, [
        el('div', { className: 'brand', text: brandText() }),
        el('div', { className: 'id roast-no', text: o.roast || o.id }),
        el('div', { className: 'bag small', text: o.n ? (isShells(o.contents) ? 'Shells package ' : 'Package ') + o.n + (o.of ? ' of ' + o.of : '') : '' }),
        el('div', { className: 'bag', text: (o.contents || 'Nibs') + (o.lbs != null ? ' · net ' + P.fmt(o.lbs, 1) + ' lbs' : '') }),
        el('div', { className: 'meta' }, [
          ft ? el('div', { className: 'ferments' }, [ft]) : null,
          dates ? el('div', { className: 'dates' }, [dates]) : null,
          place,
        ]),
      ]),
      el('div', { className: 'qr', 'data-address': address('p', o.id) }, [el('div', { html: qrSvg(address('p', o.id)) }), el('div', { className: 'pid', text: o.id }), el('div', { className: 'scan', text: scanText() })]),
      mark ? el('div', { className: 'copy-mark', text: mark }) : null,
      writeIn(false),
    ]);
  }

  /**
   * Parts of a package number, either shape. Exact text, so 3.1 and 3.10 (R3.1 and R3.10) never mix.
   *   "3.4-R2-P1" (before P2-A) → {ferment: '3.4', roast: '3.4-R2', n: 1}
   *   "R3.1-P2"   (P2-A)        → {ferment: '', roast: 'R3.1', n: 2}: a new number never names a ferment (a roast may hold several)
   */
  function parsePackageId(id) {
    var m = /^(\d+\.\d+)-R(\d+)-P(\d+)$/.exec(String(id));
    if (m) return { ferment: m[1], roast: m[1] + '-R' + m[2], n: Number(m[3]) };
    m = /^(R\d+\.\d+)-P(\d+)$/.exec(String(id));
    return m ? { ferment: '', roast: m[1], n: Number(m[2]) } : null;
  }

  root.CH_LABELKIT = { SIZES: SIZES, getSize: getSize, setSize: setSize, sheetClass: sheetClass, applyPageSize: applyPageSize, qrSvg: qrSvg, address: address, copies: copies, copyMark: copyMark, fermentsText: fermentsText, countOf: countOf, isShells: isShells, bagLabel: bagLabel, packageLabel: packageLabel, parsePackageId: parsePackageId };
})(this);
