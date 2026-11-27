/*
 * For your accountant (script 2.14.0): qb-accountant.html. One printable Letter page, in light colours, that explains the
 * QuickBooks Desktop files to the company's accountant and asks five questions. It is filled in with the company's CURRENT
 * settings (read "settings" → qbd), so what the accountant reads is what the files will contain.
 * No amounts, no farmer or buyer names: only account, item and company names from Settings → QuickBooks.
 * This page only asks: read "settings" is for a named admin who signed in (the Sheet checks; anyone else gets its sentence).
 * Every name goes on the page as text, never as markup.
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {};
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
  var cred = load('ch.admin', null);
  if (!cred || !cred.url || !cred.key) { if (window.CH_SIGNIN) CH_SIGNIN.show(); return; }
  var paper = document.createElement('style');
  paper.textContent = '@page { size: Letter; margin: 0.4in 0.5in 0.4in; }';
  document.head.appendChild(paper);

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function today() { var d = new Date(); return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function problem(text) { $('problem').hidden = false; $('problem-text').textContent = text; $('loading').hidden = true; }

  function draw(r) {
    var s = r.qbd.settings, company = (r.settings && r.settings.company_name) || (C.brand && C.brand.company) || '';
    var contact = (r.company && r.company.contact) || '';
    /** A name from the settings, in bold; an unset one says what it stands for, in italics. */
    function nm(v, stands) { return v ? el('b', { text: v }) : el('i', { className: 'qba-unset', text: stands }); }
    function line(parts) { return el('span', {}, parts); }
    var grenada = s.qbd_us_vendor || 'the Grenada company', us = s.qbd_gd_us_customer || 'the US company';
    var home = s.qbd_gd_invoice_mode === 'home';
    var cashWords = s.qbd_gd_cash ? [' (no check number: from ', nm(s.qbd_gd_cash), ')'] : [];

    var files = el('table', { className: 'rpt-table qba-files' }, [
      el('thead', {}, [el('tr', {}, ['File', 'Each record becomes', 'Accounts and names used'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
      el('tbody', {}, [
        el('tr', {}, [el('td', { rowSpan: '3', className: 'qba-file' }, [el('b', { text: 'Grenada company file' }), el('br'), 'EC$']),
          el('td', { text: 'A Check for each payment to a farmer (one per check written, the check number kept)' }),
          el('td', {}, [line(['From ', nm(s.qbd_gd_bank)].concat(cashWords, [' to ', nm(s.qbd_gd_beans_account), '. Payee: the farmer, as a Vendor.']))])]),
        el('tr', {}, [el('td', { text: 'A Sales Receipt for each local sale once it is paid, dated the day paid' }),
          el('td', {}, [line(['To ', nm(s.qbd_gd_deposit_account), '; customer ', nm(s.qbd_gd_sales_customer), '; item ', nm(s.qbd_gd_sales_item), ' → ', nm(s.qbd_gd_sales_income), '.'])])]),
        el('tr', {}, [el('td', { text: 'The invoice to ' + us + ' for each pallet' }),
          el('td', {}, home ? [line(['An Invoice in EC$ at ', el('b', { text: s.qbd_gd_rate }), ' to ', nm(s.qbd_gd_us_customer, 'the US company (not set yet)'), ' through ', nm(s.qbd_gd_ar),
            '; item ', nm(s.qbd_gd_export_item), ' → ', nm(s.qbd_gd_export_income), ', other lines ', nm(s.qbd_gd_other_item), ' → ', nm(s.qbd_gd_other_income), '.'])]
            : [el('b', { text: 'Not in the file for now' }), ' (see Currency). Entered by hand.'])]),
        el('tr', {}, [el('td', { className: 'qba-file' }, [el('b', { text: 'US company file' }), el('br'), 'US$']),
          el('td', { text: 'A Bill for each invoice from ' + grenada + ', dated the invoice date; Ref. No. = the invoice number' }),
          el('td', {}, [line(['From ', nm(s.qbd_us_vendor, 'the Grenada company (not set yet)'), ' (a Vendor) through ', nm(s.qbd_us_ap), '; nibs → ', nm(s.qbd_us_purchase_account),
            '; freight and every other line → ', nm(s.qbd_us_other_account), '.'])])]),
      ]),
    ]);
    var cls = [s.qbd_gd_class ? 'Class ' + s.qbd_gd_class + ' in the Grenada file.' : '', s.qbd_us_class ? 'Class ' + s.qbd_us_class + ' in the US file.' : ''].filter(Boolean).join(' ');
    var box = function () { return el('span', { className: 'qba-box', 'aria-hidden': 'true', text: '☐' }); };
    var q = function (letter, kids) { return el('li', {}, [el('b', { className: 'qba-q', text: letter + '.' })].concat(kids)); };
    var blank = function (w) { return el('span', { className: 'qba-blank', style: 'width:' + (w || 9) + 'em' }); };

    var sheet = el('section', { className: 'rpt-section qba-paper' }, [
      el('header', { className: 'rpt-head' }, [
        el('div', { className: 'rpt-brand' }, [el('span', { className: 'rpt-company', text: company })]),
        el('div', { className: 'rpt-title' }, [el('h2', { text: 'QuickBooks Desktop import files' }), el('p', { text: 'Please check our assumptions · ' + today() })]),
      ]),
      el('p', { className: 'qba-lead', text: 'Batchstory records cocoa deliveries, payments to farmers, local sales and pallet invoices. It can make IIF import files for QuickBooks Desktop, so these need not be typed again. Nothing has been imported yet: please check our assumptions first. Two sample files made from invented data come with this page.' }),
      el('h3', { className: 'rpt-sub', text: 'The two files' }), el('div', { className: 'table-wrap rpt-wrap' }, [files]),
      cls ? el('p', { className: 'qba-note', text: cls }) : null,
      el('div', { className: 'qba-two' }, [
        el('div', {}, [
          el('h3', { className: 'rpt-sub', text: 'Currency' }),
          el('p', { text: 'Each file holds only its own company\'s currency: EC$ in the Grenada file, US$ in the US file. No exchange rates are imported. ' +
            (home ? 'The US$ invoice to ' + us + ' is in the Grenada file in EC$ at ' + s.qbd_gd_rate + ', the US$ amount in its memo.'
              : 'The US$ invoice to ' + us + ' stays out of the Grenada file unless you tell us those books keep it in EC$ (we would convert at your rate, 2.70 by default). If you keep it in US$ with multi-currency, it stays a manual entry: IIF import does not carry currencies.') }),
          el('h3', { className: 'rpt-sub', text: 'Left out on purpose' }),
          el('p', { text: 'Payments between the two companies, and local sales not yet paid. IIF cannot link a payment to its invoice or bill, so please enter those in Receive Payments / Pay Bills.' }),
        ]),
        el('div', {}, [
          el('h3', { className: 'rpt-sub', text: 'Never twice' }),
          el('p', { text: 'Each payment, sale and invoice goes into one real file, once; later files leave it out, and a file downloaded again is identical. QuickBooks does not notice a repeated import: import each real file once. Sample and test files say TEST in every memo; their numbers start T-. Each memo carries the Batchstory number (PAY012, INV-0004).' }),
        ]),
      ]),
      el('h3', { className: 'rpt-sub', text: 'Names that must already exist in QuickBooks' }),
      el('p', { className: 'qba-names' }, [el('b', { text: 'Grenada file: ' }), [s.qbd_gd_bank, s.qbd_gd_cash, s.qbd_gd_beans_account, s.qbd_gd_deposit_account, s.qbd_gd_sales_customer, s.qbd_gd_sales_item, s.qbd_gd_sales_income].concat(home ? [s.qbd_gd_ar, s.qbd_gd_us_customer, s.qbd_gd_export_item, s.qbd_gd_export_income, s.qbd_gd_other_item, s.qbd_gd_other_income] : []).filter(Boolean).join(' · ') + ' · each farmer as a Vendor.']),
      el('p', { className: 'qba-names' }, [el('b', { text: 'US file: ' }), [s.qbd_us_vendor || 'the Grenada company as a Vendor', s.qbd_us_ap, s.qbd_us_purchase_account, s.qbd_us_other_account].filter(Boolean).join(' · ') + '.']),
      el('p', { className: 'qba-note', text: 'Batchstory never creates accounts, vendors, customers or items. If a name differs, tell us yours and we change our setting (QuickBooks would turn an unknown account into a new bank account).' }),
      el('h3', { className: 'rpt-sub', text: 'Five questions' }),
      el('ol', { className: 'qba-qs' }, [
        q('A', [' Both companies use QuickBooks ', el('b', { text: 'Desktop' }), ' (not Online). ', box(), ' Yes ', box(), ' No: ', blank(7), ' Year and edition: ', blank(7)]),
        q('B', [' In the Grenada file the invoice to the US company is kept ', box(), ' in EC$ at 2.70 ', box(), ' in US$ with multi-currency ', box(), ' other: ', blank(6), '. Multi-currency is on in ', box(), ' neither ', box(), ' Grenada ', box(), ' US.']),
        q('C', [' Farmers are paid with ', el('b', { text: 'Write Checks' }), ' straight to an account, one entry per check, and each farmer is a ', el('b', { text: 'Vendor' }), '. ', box(), ' Yes ', box(), ' No: ', blank(12)]),
        q('D', [' The names above match your books; on invoices made by hand, lbs lines go to the nib accounts, other lines to the other accounts; no sales tax (VAT) is needed on these. ', box(), ' Yes ', box(), ' Changes: ', blank(10)]),
        q('E', [' I will import the sample files into a ', el('b', { text: 'copy' }), ' of each company file (or Intuit\'s IIF sample company) and say what I see. ', box(), ' Yes']),
      ]),
      el('h3', { className: 'rpt-sub', text: 'Trying it safely' }),
      el('ol', { className: 'qba-steps' }, [
        el('li', { text: 'Back up the company file, then restore the backup under a new name such as "TRIAL - do not use" (or use Intuit\'s IIF sample company).' }),
        el('li', { text: 'In the copy, note the bank balance and how many vendors, customers and accounts there are. Add the names listed above.' }),
        el('li', { text: 'File → Utilities → Import → IIF Files → Import IIF. Not "Import it for me. I\'ll fix it later": that skips QuickBooks\'s checks. Do not re-save the file in Excel (it drops leading zeros).' }),
        el('li', { text: 'Check: no new names or accounts; the bank' + (s.qbd_gd_cash ? ' (and ' + s.qbd_gd_cash + ', for payments with no check number)' : '') + ' fell by the checks\' total; a check, a sales receipt and a bill look right; a date after the 12th is in the right month; Edit → Find "TEST" finds every record.' }),
        el('li', { text: 'Tell us what looked wrong (the wording of any ERROR line QuickBooks shows), or "all good"' + (contact ? ', to ' + contact : '') + '. Only then is the first real file made.' }),
      ]),
    ]);
    $('sheet').replaceChildren(sheet);
    $('loading').hidden = true;
    $('print').hidden = false;
  }

  $('print').addEventListener('click', function () { window.print(); });
  $('loading').textContent = 'Loading…';
  C.read(cred.url, cred.key, 'settings').then(function (res) { return res.text(); }).then(function (t) {
    var j; try { j = JSON.parse(t); } catch (e) { throw new Error('No connection. Try again.'); }
    return window.CH_SIGNIN ? CH_SIGNIN.guard(j) : j;
  }).then(function (r) {
    if (!r || !r.ok) { problem((r && r.error) || 'Could not load the settings.'); return; }
    if (!r.qbd || !r.qbd.settings) { problem('Update needed: the Sheet\'s script is older than 2.14.0, so it has no QuickBooks Desktop settings yet.'); return; }
    draw(r);
  }).catch(function (e) { problem('Could not load the settings (' + (e.message || e) + ').'); });
})();
