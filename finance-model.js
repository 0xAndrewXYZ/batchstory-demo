/*
 * Finances numbers (P3-A; P3-B: local sales; P3-C: invoices, at the end): pure functions, no DOM. Used by finances.js and tested in Node (tests/finances.test.js).
 *
 * What is owed is ONE definition, the same as Code.gs's owedByPayee_ (the test feeds both the same rows):
 *   - an Intakes row is a delivery owed for when its "Amount paid (XCD)" is a number > 0 (shown on the page as "Amount due";
 *     the header itself is never renamed); its payee is "Paid to", else "Farm", else "(no payee)"; its season is its
 *     Ferment ID before the dot (2.1 and 2.10 are both season 2, and are never the same ferment);
 *   - paid = the payments not cancelled with the same payee (exact text, trimmed) and the same Season;
 *   - balance = owed - paid, in whole cents (negative = overpaid).
 * Amounts travel as text with two decimals ("402.00", "-40.00"), and are added up here in whole cents, never as decimals.
 */
(function (root) {
  'use strict';
  var NO_PAYEE = '(no payee)';
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  /** A real number, or text of plain digits with at most one point, as whole cents; anything else null. */
  function cents(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
    var t = text(v);
    return /^\d+(\.\d+)?$/.test(t) ? Math.round(Number(t) * 100) : null;
  }
  /** "402.00" or "-40.00" (as the server sends them) as whole cents, or null. */
  function signedCents(v) {
    var t = text(v);
    if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
    var neg = t.charAt(0) === '-', c = Math.round(Number(neg ? t.slice(1) : t) * 100);
    return neg ? -c : c;
  }
  /** Whole cents as "402.00" / "-40.00": never a thousands comma. */
  function plain(c) { var a = Math.abs(c); return (c < 0 ? '-' : '') + Math.floor(a / 100) + '.' + ('0' + (a % 100)).slice(-2); }
  function num(v) { if (typeof v === 'number') return isFinite(v) ? v : null; var t = text(v); return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null; }
  function seasonOf(fermentId) { return text(fermentId).split('.')[0]; }
  function payeeOf(r) { return text(r['Paid to']) || text(r['Farm']) || NO_PAYEE; }
  /** IDs part by part as whole numbers: 2.9 before 2.10, and 2.1 is never 2.10 (the admin pages' compareId). */
  function compareId(a, b) {
    var x = String(a).split(/([0-9]+)/), y = String(b).split(/([0-9]+)/);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = x[i] === undefined ? '' : x[i], q = y[i] === undefined ? '' : y[i];
      if (p === q) continue;
      if (/^[0-9]+$/.test(p) && /^[0-9]+$/.test(q)) { var d = Number(p) - Number(q); return d || p.length - q.length; }
      return p < q ? -1 : 1;
    }
    return 0;
  }
  function covered(v) { return text(v).split(',').map(function (s) { return s.trim(); }).filter(String); }
  function payment(r) {
    var c = cents(r['Amount (XCD)']);
    return { id: text(r['Payment ID']), paid_on: text(r['Paid on']), amount: c === null ? null : plain(c), check_no: text(r['Check no.']), note: text(r['Note']),
      covered: covered(r['Deliveries covered']), by: text(r['Recorded by']), at: text(r['Recorded at']),
      cancelled_at: text(r['Cancelled at']), cancelled_by: text(r['Cancelled by']), cancel_reason: text(r['Cancel reason']) };
  }

  /** The seasons with a delivery owed for or a payment, newest first. intakes, payments: rows {Header: value}. */
  function seasons(intakes, payments) {
    var seen = Object.create(null), out = [];
    var add = function (s) { if (s && !seen[s]) { seen[s] = true; out.push(s); } };
    (intakes || []).forEach(function (r) { var c = cents(r['Amount paid (XCD)']); if (c !== null && c > 0) add(seasonOf(r['Ferment ID'])); });
    (payments || []).forEach(function (r) { if (text(r['Payment ID'])) add(text(r['Season'])); }); // a row with no Payment ID counts nowhere
    return out.sort(function (a, b) { return compareId(b, a); });
  }

  /** Every payee of one season: [{name, owed, paid, balance ("402.00"), deliveries, payments}], names in order. The server's owedByPayee_. */
  function owedByPayee(intakes, payments, season) {
    var by = Object.create(null), names = []; // no prototype: a payee called "constructor" is only a name
    var payee = function (n) { if (!by[n]) { by[n] = { name: n, owed: 0, paid: 0, deliveries: [], payments: [] }; names.push(n); } return by[n]; };
    (intakes || []).forEach(function (r) {
      var c = cents(r['Amount paid (XCD)']);
      if (c === null || !(c > 0) || seasonOf(r['Ferment ID']) !== season) return;
      var p = payee(payeeOf(r));
      p.owed += c;
      p.deliveries.push({ intake_id: text(r['Intake ID']), ferment: text(r['Ferment ID']), date: text(r['Date added']), farm: text(r['Farm']),
        lbs: num(r['Wet lbs']), price: num(r['Price per lb (XCD)']), due: plain(c) });
    });
    (payments || []).forEach(function (r) {
      if (text(r['Season']) !== season || !text(r['Payment ID'])) return;
      var p = payee(text(r['Paid to']) || NO_PAYEE), pay = payment(r), c = cents(r['Amount (XCD)']);
      p.payments.push(pay);
      if (!pay.cancelled_at && c !== null && c > 0) p.paid += c;
    });
    names.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    return names.map(function (n) {
      var p = by[n];
      p.deliveries.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : compareId(a.intake_id, b.intake_id); });
      p.payments.sort(function (a, b) { return a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : compareId(a.id, b.id); });
      return { name: p.name, owed: plain(p.owed), paid: plain(p.paid), balance: plain(p.owed - p.paid), deliveries: p.deliveries, payments: p.payments };
    });
  }

  /* ---------- for the page ---------- */

  /** The three figures over the table: {owed, paid, left} in cents. "Still to pay" adds up only what is owed (an overpaid payee counts 0). */
  function totals(payees) {
    var t = { owed: 0, paid: 0, left: 0 };
    (payees || []).forEach(function (p) {
      var o = signedCents(p.owed) || 0, d = signedCents(p.paid) || 0, b = signedCents(p.balance) || 0;
      t.owed += o; t.paid += d; t.left += Math.max(0, b);
    });
    return t;
  }
  /** The payments that count (not cancelled). */
  function live(p) { return (p.payments || []).filter(function (x) { return !x.cancelled_at; }); }
  /** The date of a payee's latest payment that counts, or ''. */
  function lastPaid(p) { return live(p).reduce(function (m, x) { return x.paid_on > m ? x.paid_on : m; }, ''); }
  /** A payee's deliveries that no payment that counts names as covered. */
  function unpaid(p) {
    var named = Object.create(null);
    live(p).forEach(function (x) { (x.covered || []).forEach(function (id) { named[id] = true; }); });
    return (p.deliveries || []).filter(function (d) { return !named[d.intake_id]; });
  }
  /** "EC$ 402.00", "EC$ 1,250.00"; with over: true a negative is "Overpaid EC$ 40.00". */
  function money(c, opts) {
    if (c === null || c === undefined) return '';
    var a = Math.abs(c), whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ','), s = 'EC$ ' + whole + '.' + ('0' + (a % 100)).slice(-2);
    if (c < 0) return opts && opts.over ? 'Overpaid ' + s : '-' + s;
    return s;
  }
  /** A typed amount as the server takes it (plain digits, at most two decimals, > 0, at most max): {cents} or {error}. */
  function amountOf(typed, max) {
    var t = text(typed).replace(/^EC\$\s*/i, '').replace(/,(?=\d{3}(\D|$))/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'Type the amount as a plain number of EC$, like 402 or 402.50.' };
    var c = Math.round(Number(t) * 100);
    if (!(c > 0)) return { error: 'The amount must be more than 0.' };
    if (max && c > max * 100) return { error: 'That is more than EC$ ' + plain(max * 100).replace(/\B(?=(\d{3})+(?!\d))/, ',') + '. Check the amount.' };
    return { cents: c, text: plain(c) };
  }

  /* ---------- P3-B: local sales (money in) ---------- */
  /*
   * A sale (as read "finances" sends it: {id, date, what, quantity, unit, buyer, price, total ("12.50"), paid, paid_on,
   * cancelled_at, …}) is in the calendar year of its date: a sale has no ferment, so no season. A cancelled sale stays listed
   * and counts for nothing. Sales never change stock.
   */
  /** "2026" from "2026-11-24", or ''. */
  function yearOf(date) { var m = /^(\d{4})-\d{2}-\d{2}/.exec(text(date)); return m ? m[1] : ''; }
  /** The years with a sale, newest first, with `also` (this year) always there. */
  function saleYears(sales, also) {
    var seen = Object.create(null), out = [];
    var add = function (y) { if (y && !seen[y]) { seen[y] = true; out.push(y); } };
    add(text(also));
    (sales || []).forEach(function (s) { add(yearOf(s.date)); });
    return out.sort(function (a, b) { return b < a ? -1 : b > a ? 1 : 0; });
  }
  /**
   * One calendar year of local sales: {year, sales (newest first, cancelled ones too), sold, paid, unpaid (whole cents, cancelled
   * left out), open (how many are not yet paid)}.
   */
  function localSales(sales, year) {
    var y = text(year), out = { year: y, sales: [], sold: 0, paid: 0, unpaid: 0, open: 0 };
    (sales || []).forEach(function (s) { if (yearOf(s.date) === y) out.sales.push(s); });
    out.sales.sort(function (a, b) { return a.date > b.date ? -1 : a.date < b.date ? 1 : compareId(b.id, a.id); });
    out.sales.forEach(function (s) {
      var c = cents(s.total);
      if (s.cancelled_at || c === null || !(c > 0)) return;
      out.sold += c;
      if (s.paid) out.paid += c; else { out.unpaid += c; out.open++; }
    });
    return out;
  }
  /** A typed quantity (plain digits, at most two decimals, more than 0): {hundredths, text} or {error}. */
  function quantityOf(typed, max) {
    var t = text(typed).replace(/,(?=\d{3}(\D|$))/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'Type the quantity as a plain number, like 12 or 2.5.' };
    var h = Math.round(Number(t) * 100);
    if (!(h > 0)) return { error: 'The quantity must be more than 0.' };
    if (max && h > max * 100) return { error: 'That quantity is more than ' + max + '. Check it.' };
    return { hundredths: h, text: String(h / 100) };
  }
  /** quantity × price, rounded to the cent, as the server checks it: hundredths of a unit × cents → cents. */
  function saleTotal(hundredths, priceCents) { return Math.round(hundredths * priceCents / 100); }

  /* ---------- P3-C: invoices to the US company, in US$ ---------- */
  /*
   * An invoice (as read "finances" sends it: {no, shipment_id, date, lbs ("180"), price ("30.00"), amount, other_lines:
   * [{label, amount}], total ("5400.00"), paid_on, cancelled_at, changed, …}). A cancelled invoice stays listed and counts for
   * nothing. The amount is worked out as the server does it: lbs in hundredths × price in ten-thousandths of a US$, rounded
   * to the cent (Code.gs invAmountCents_).
   */
  /** A typed price per lb (plain digits, at most four decimals, more than 0, at most max): {units (1/10,000 US$), text} or {error}. */
  function priceOf(typed, max) {
    var t = text(typed).replace(/^US\$\s*/i, '');
    if (!/^\d+(\.\d{1,4})?$/.test(t)) return { error: 'Type the price per lb as a plain number of US$, like 30 or 30.25.' };
    var u = Math.round(Number(t) * 10000);
    if (!(u > 0)) return { error: 'The price per lb must be more than 0.' };
    if (max && u > max * 10000) return { error: 'The price per lb is more than US$ ' + max + '. Check it.' };
    return { units: u, text: t };
  }
  /** Lbs ("180", "30.5" or a number) as hundredths, or null. */
  function lbsHundredths(v) { if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v * 100) : null; var t = text(v); return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null; }
  /** lbs (hundredths) × price (ten-thousandths) in cents, as the server rounds it. */
  function invoiceAmount(lbsH, priceUnits) { return Math.round(lbsH * priceUnits / 10000); }
  /** "US$ 5,400.00" (whole cents in). */
  function usd(c) {
    if (c === null || c === undefined) return '';
    var a = Math.abs(c), whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (c < 0 ? '-' : '') + 'US$ ' + whole + '.' + ('0' + (a % 100)).slice(-2);
  }
  /** The three figures over the Invoices table: {invoiced, paid, outstanding} in cents, and how many are open. Cancelled ones count for nothing. */
  function invoiceTotals(invoices) {
    var t = { invoiced: 0, paid: 0, outstanding: 0, open: 0, count: 0 };
    (invoices || []).forEach(function (x) {
      var c = cents(x.total);
      if (x.cancelled_at || c === null) return;
      t.count++; t.invoiced += c;
      if (x.paid_on) t.paid += c; else { t.outstanding += c; t.open++; }
    });
    return t;
  }

  /* ---------- 2.13.1: an invoice made by hand (no pallet) ---------- */
  /** Text that a spreadsheet or QuickBooks could take as a formula: it starts with = + - or @ (Code.gs invFormulaLike_). */
  function formulaLike(t) { return /^[=+\-@]/.test(text(t)); }
  function plainNumber(t) { return text(t).replace(/^US\$\s*/i, '').replace(/,(?=\d{3}(\D|$))/g, ''); }
  /**
   * The typed lines of an invoice made by hand, checked and worked out as Code.gs invHandFields_ does: rows [{description,
   * qty, unit ('lbs' | 'qty'), price, amount}] as typed (a row with nothing typed is left out). A row with lbs (or a quantity)
   * or a price is lbs × price, to the cent as invoiceAmount; any other row is its amount. set: read finances'
   * invoice_settings (max_total, qty_max, unit_max, desc_max, hand_lines_max).
   * {error, line (the row's index), field} or {lines (as invoice_manual takes them), total (cents), lbsH, count}.
   */
  function handInvoice(rows, set) {
    set = set || {};
    var max = (set.max_total || 1000000) * 100, qmax = (set.qty_max || 100000) * 100, umax = (set.unit_max || 10000) * 10000, dmax = set.desc_max || 80;
    var out = [], total = 0, lbsH = 0, first = -1;
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i] || {}, n = 'Line ' + (i + 1);
      var d = text(r.description).replace(/\s+/g, ' '), q = plainNumber(r.qty), p = plainNumber(r.price), a = plainNumber(r.amount), c;
      if (!d && !q && !p && !a) continue;
      if (first < 0) first = i;
      if (!d) return { error: n + ': say what it is for.', line: i, field: 'description' };
      if (d.length > dmax || d.indexOf(';') >= 0) return { error: n + ': at most ' + dmax + ' characters, and no ;.', line: i, field: 'description' };
      if (formulaLike(d)) return { error: n + ' cannot start with = + - or @.', line: i, field: 'description' };
      if (q || p) {
        var unit = r.unit === 'qty' ? 'qty' : 'lbs', what = unit === 'lbs' ? 'lbs' : 'quantity';
        var qh = /^\d+(\.\d{1,2})?$/.test(q) ? Math.round(Number(q) * 100) : null;
        if (!(qh > 0) || qh > qmax) return { error: n + ': type the ' + what + ' as a plain number more than 0 and at most ' + (qmax / 100) + ', like 120 or 30.5.', line: i, field: 'qty' };
        var pu = /^\d+(\.\d{1,4})?$/.test(p) ? Math.round(Number(p) * 10000) : null;
        if (!(pu > 0) || pu > umax) return { error: n + ': type the price as a plain number of US$ more than 0 and at most ' + (umax / 10000) + ', like 30 or 30.25.', line: i, field: 'price' };
        c = invoiceAmount(qh, pu);
        if (!(c > 0)) return { error: n + ' comes to US$ 0.00. Check the ' + what + ' and the price.', line: i, field: 'qty' };
        if (c > max) return { error: n + ' is more than ' + usd(max) + '. Check it.', line: i, field: 'price' };
        out.push({ description: d, qty: q, unit: unit, price: p, amount: plain(c) });
        if (unit === 'lbs') lbsH += qh;
      } else {
        if (!/^\d+(\.\d{1,2})?$/.test(a)) return { error: n + ': give lbs (or a quantity) and a price, or an amount as a plain number of US$, like 120 or 120.50.', line: i, field: a ? 'amount' : 'qty' };
        c = Math.round(Number(a) * 100);
        if (!(c > 0)) return { error: n + ': the amount must be more than 0.', line: i, field: 'amount' };
        if (c > max) return { error: n + ' is more than ' + usd(max) + '. Check it.', line: i, field: 'amount' };
        out.push({ description: d, amount: plain(c) });
      }
      total += c;
    }
    if (!out.length) return { error: 'Add at least one line: what it is for, and lbs and a price, or an amount.', line: 0, field: 'description' };
    if (set.hand_lines_max && out.length > set.hand_lines_max) return { error: 'An invoice has at most ' + set.hand_lines_max + ' lines.', line: first, field: 'description' };
    if (total > max) return { error: 'The total is more than ' + usd(max) + '. Check the lines.', line: first, field: 'description' };
    return { lines: out, total: total, lbsH: lbsH, count: out.length };
  }

  var api = { NO_PAYEE: NO_PAYEE, cents: cents, signedCents: signedCents, plain: plain, seasonOf: seasonOf, payeeOf: payeeOf, compareId: compareId,
    seasons: seasons, owedByPayee: owedByPayee, totals: totals, live: live, lastPaid: lastPaid, unpaid: unpaid, money: money, amountOf: amountOf,
    yearOf: yearOf, saleYears: saleYears, localSales: localSales, quantityOf: quantityOf, saleTotal: saleTotal,
    priceOf: priceOf, lbsHundredths: lbsHundredths, invoiceAmount: invoiceAmount, usd: usd, invoiceTotals: invoiceTotals,
    formulaLike: formulaLike, handInvoice: handInvoice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH_FIN = api;
})(typeof window !== 'undefined' ? window : this);
