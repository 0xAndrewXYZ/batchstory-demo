/*
 * The printable invoice (P3-C): invoice.html?no=INV-0004. One Letter page in light colours: the seller (the company's name
 * and logo slots, and the "Invoice from" setting), Bill to (as it was on the day), the number, the date, the pallet and its
 * to-port date, a table of the packages (package, roast, lbs; shells listed at no charge), the nib total, the price per lb,
 * the amount, the other lines, Total US$, the terms, and "Paid on" once paid (never the payment note: that stays in Finances).
 * The seller ("Invoice from") and the terms are the ones of the day it was made. Print prints only the invoice.
 *
 * This page only asks: it reads "finances" by POST (an admin, or a person with "Can see money"; anyone else gets a note with
 * no numbers). Every name, address and amount goes on the page as text, never as markup. US$ only: no EC$ figure and no
 * farm price is ever on it (the read's invoices hold neither).
 * 1.30.1: an invoice made by hand (kind "by hand") has "For" in place of the pallet, its own lines (description, lbs or
 * quantity × price, amount) in place of the packages, and its notes above the terms.
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {}, F = window.CH_FIN, A = window.CH_ADMIN || {};
  var $ = function (id) { return document.getElementById(id); };
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* ---------- who is asking: an admin's sign-in or admin link, else this browser's own link (a money viewer) ---------- */
  var adm = load('ch.admin', null), cred = null;
  if (adm && adm.url && adm.key) cred = { url: adm.url, key: adm.key, admin: true };
  else { var s = load('ch.settings', {}) || {}; if (s.url && s.key) cred = { url: s.url, key: s.key, admin: false }; }
  if (!cred) { if (window.CH_SIGNIN) CH_SIGNIN.show(); return; }
  function ask(body) {
    body.key = cred.key;
    return C.ask(cred.url, body).then(function (r) { return r.text(); }).then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('The Sheet sent back something unexpected.'); }
      return cred.admin && window.CH_SIGNIN ? CH_SIGNIN.guard(j) : j;
    });
  }

  /* ---------- words ---------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : String(iso || ''); }
  function usdT(t) { var c = F.cents(t); return c === null ? '' : F.usd(c); }
  function lbs(v) { return v === null || v === undefined ? '' : (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function lbsT(t) { var h = F.lbsHundredths(t); return h === null ? '' : lbs(h / 100); }
  function company() { return (C.brand && C.brand.company) || C.company || ''; }
  function dash() { return el('span', { className: 'rpt-none', text: '–', title: 'Nothing recorded' }); }
  /** An address or name as typed (one line in Settings), wrapping where it must; nothing = a muted dash. */
  function block(text, cls) { var p = el('p', { className: cls }); if (text) p.textContent = text; else p.appendChild(dash()); return p; }

  var no = new URLSearchParams(location.search).get('no') || '';
  $('inv-title').textContent = no ? 'Invoice ' + no : 'Invoice';
  var paper = document.createElement('style');
  paper.textContent = '@page { size: Letter; margin: 0.6in 0.65in 0.7in; }'; // the US company's paper
  document.head.appendChild(paper);

  function problem(t) { $('loading').replaceChildren(); $('problem').hidden = false; $('problem-text').textContent = t; }

  function draw(x, p) {
    var set = p.invoice_settings || {};
    // review L2: the seller and terms as printed the day it was made (the server falls back to today's only for older rows)
    var from = x.from !== undefined ? x.from : set.from, terms = x.terms !== undefined ? x.terms : set.terms;
    document.title = x.no + ' · ' + (company() || 'Invoice');
    var logo = el('img', { src: 'icons/cocoahead-64.png', alt: '', width: '40', height: '40', 'data-brand-logo': '' }); // the company's own logo replaces it (config.js)
    var head = el('div', { className: 'rpt-head inv-head' }, [
      el('div', { className: 'inv-seller' }, [
        el('div', { className: 'rpt-brand' }, [logo, el('span', { className: 'rpt-company', 'data-brand': 'company', text: company() })]),
        from ? el('p', { className: 'inv-addr', id: 'inv-from', text: from }) : null,
      ]),
      el('div', { className: 'rpt-title' }, [el('h2', { text: 'Invoice' }), el('p', { className: 'inv-no', id: 'inv-no', text: x.no }), el('p', { id: 'inv-date', text: 'Date: ' + day(x.date) })]),
    ]);
    if (x.kind === 'by hand') { drawHand(x, head, from, terms); return; }
    var meta = el('div', { className: 'inv-meta' }, [
      el('div', { className: 'inv-billto' }, [el('h3', { className: 'rpt-sub', text: 'Bill to' }), block(x.bill_to, 'inv-addr')]),
      el('div', { className: 'inv-pallet' }, [el('h3', { className: 'rpt-sub', text: 'Pallet' }),
        el('p', { id: 'inv-pallet', text: x.shipment_id + (x.ship_date ? ' · to port ' + day(x.ship_date) : '') + (x.left_port ? ' · left port ' + day(x.left_port) : '') })]),
    ]);
    var nibs = (x.packages || []).filter(function (k) { return !k.shells; });
    var rows = (x.packages || []).map(function (k) {
      return el('tr', { className: k.shells ? 'inv-shells' : '' }, [el('td', { className: 'nw', text: k.id }), el('td', { className: 'nw' }, [k.roast ? document.createTextNode(k.roast) : dash()]),
        el('td', { text: k.shells ? 'Shells, no charge' : 'Nibs' }), el('td', { className: 'n' }, [lbs(k.lbs) === '' ? dash() : document.createTextNode(lbs(k.lbs))])]);
    });
    var packs = el('div', { className: 'rpt-wrap' }, [el('table', { className: 'rpt-table inv-packs', id: 'inv-packs' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Package' }), el('th', { text: 'Roast' }), el('th', { text: 'Contents' }), el('th', { className: 'n', text: 'Lbs' })])]),
      el('tbody', {}, rows),
      el('tfoot', {}, [el('tr', {}, [el('td', { text: 'Nibs' }), el('td', { text: nibs.length + (nibs.length === 1 ? ' package' : ' packages') }), el('td', {}), el('td', { className: 'n', text: lbsT(x.lbs) })])]),
    ])]);
    var line = function (label, amount, cls) { return el('tr', { className: cls || '' }, [el('td', { text: label }), el('td', { className: 'n', text: amount })]); };
    var sums = [line('Nibs: ' + lbsT(x.lbs) + ' lbs × US$ ' + (x.price || '') + ' per lb', usdT(x.amount))].concat((x.other_lines || []).map(function (l) { return line(l.label, usdT(l.amount)); }));
    var totals = el('table', { className: 'rpt-table inv-totals', id: 'inv-totals' }, [
      el('tbody', {}, sums),
      el('tfoot', {}, [el('tr', {}, [el('td', { text: 'Total US$' }), el('td', { className: 'n', id: 'inv-total', text: usdT(x.total) })])]),
    ]);
    var foot = el('div', { className: 'rpt-notes inv-foot' }, [
      terms ? el('p', { id: 'inv-terms', text: terms }) : null,
      x.paid_on ? el('p', { className: 'inv-paid', id: 'inv-paid', text: 'Paid on ' + day(x.paid_on) + '.' }) : null, // the payment note stays in Finances: this paper goes to the US company
      x.cancelled_at ? el('p', { className: 'inv-cancelled', id: 'inv-cancelled', text: 'Cancelled on ' + day(x.cancelled_on || x.cancelled_at) + (x.cancel_reason ? ': ' + x.cancel_reason : '') + '. This invoice is not to be paid.' }) : null,
    ]);
    var sheet = el('section', { className: 'rpt-section inv-paper' + (x.cancelled_at ? ' is-cancelled' : ''), 'aria-label': 'Invoice ' + x.no }, [head, meta, el('h3', { className: 'rpt-sub', text: 'Packages on the pallet' }), packs, totals, foot]);
    $('sheet').replaceChildren(sheet);
    if (A.fill) A.fill($('sheet')); // the company's own name and logo
    $('changed').hidden = !x.changed;
    $('print').hidden = false;
  }

  /** Totals, notes, terms, paid and cancelled: the foot every invoice ends with. */
  function footOf(x, terms) {
    return el('div', { className: 'rpt-notes inv-foot' }, [
      x.notes ? el('p', { className: 'inv-notes', id: 'inv-notes', text: x.notes }) : null,
      terms ? el('p', { id: 'inv-terms', text: terms }) : null,
      x.paid_on ? el('p', { className: 'inv-paid', id: 'inv-paid', text: 'Paid on ' + day(x.paid_on) + '.' }) : null, // never the payment note
      x.cancelled_at ? el('p', { className: 'inv-cancelled', id: 'inv-cancelled', text: 'Cancelled on ' + day(x.cancelled_on || x.cancelled_at) + (x.cancel_reason ? ': ' + x.cancel_reason : '') + '. This invoice is not to be paid.' }) : null,
    ]);
  }
  /** 1.30.1: an invoice made by hand: For, then its lines, then Total US$. */
  function drawHand(x, head, from, terms) {
    var meta = el('div', { className: 'inv-meta' }, [
      el('div', { className: 'inv-billto' }, [el('h3', { className: 'rpt-sub', text: 'Bill to' }), block(x.bill_to, 'inv-addr')]),
      el('div', { className: 'inv-pallet' }, [el('h3', { className: 'rpt-sub', text: 'For' }), el('p', { id: 'inv-for', text: x.for_ref || '' })]),
    ]);
    var price = function (t) { return t ? 'US$ ' + t : ''; };
    var rows = (x.lines || []).map(function (l) {
      var q = l.qty ? lbsT(l.qty) + (l.unit === 'lbs' ? ' lbs' : '') : '';
      return el('tr', {}, [el('td', { text: l.description }), el('td', { className: 'n' }, [q ? document.createTextNode(q) : dash()]),
        el('td', { className: 'n' }, [l.price ? document.createTextNode(price(l.price)) : dash()]), el('td', { className: 'n', text: usdT(l.amount) })]);
    });
    var lines = el('div', { className: 'rpt-wrap' }, [el('table', { className: 'rpt-table inv-packs inv-hand', id: 'inv-lines' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Description' }), el('th', { className: 'n', text: 'Lbs or qty' }), el('th', { className: 'n', text: 'Price' }), el('th', { className: 'n', text: 'Amount' })])]),
      el('tbody', {}, rows),
    ])]);
    var totals = el('table', { className: 'rpt-table inv-totals', id: 'inv-totals' }, [
      el('tfoot', {}, [el('tr', {}, [el('td', { text: 'Total US$' }), el('td', { className: 'n', id: 'inv-total', text: usdT(x.total) })])]),
    ]);
    var sheet = el('section', { className: 'rpt-section inv-paper' + (x.cancelled_at ? ' is-cancelled' : ''), 'aria-label': 'Invoice ' + x.no }, [head, meta, lines, totals, footOf(x, terms)]);
    $('sheet').replaceChildren(sheet);
    if (A.fill) A.fill($('sheet'));
    $('changed').hidden = true;
    $('print').hidden = false;
  }

  function read() {
    $('loading').textContent = 'Loading…';
    if (!no) { problem('Open an invoice from Finances → Invoices.'); return; }
    ask({ action: 'read', what: 'finances' }).then(function (p) {
      $('loading').replaceChildren();
      if (!p.ok) {
        if (p.suspended) { problem(p.error || 'The company is paused.'); return; }
        $('no-money').hidden = false; // no numbers, no names: only the note
        return;
      }
      if (A.navRole) A.navRole(true);
      var x = (p.invoices || []).filter(function (i) { return i.no === no; })[0]; // exact text: INV-01 is not INV-0001
      if (!x) { problem('There is no invoice ' + no + '. Open it from Finances → Invoices.'); return; }
      draw(x, p);
    }).catch(function (err) { problem('Could not load the invoice (' + (err.message || err) + '). Check the internet connection and reload the page.'); });
  }
  $('print').addEventListener('click', function () { window.print(); });
  read();
})();
