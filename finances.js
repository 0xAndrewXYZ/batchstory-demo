/*
 * Finances page (P3-A): for each person or farm that is paid, what the season's deliveries add up to, what has been paid and
 * what is still to pay, in EC$. A payee opens in the side panel: its deliveries, its payments, and Mark paid. A payment's ⋯ menu
 * has Cancel this payment…; a cancelled payment stays listed, struck through, with who and why.
 *
 * This page only asks: Code.gs decides. Reading needs an admin, or a person with "Can see money" (read "finances", by POST, so
 * no key in a web address); recording or cancelling needs an admin signed in with their own email and password (can_pay only
 * hides the buttons). Every name, amount and note goes on the page as text, never as markup. The numbers come worked out from
 * the server; finance-model.js (CH_FIN) adds them up for the figures and writes EC$ amounts, in whole cents.
 *
 * P3-B: a second view, Local sales (?view=sales): the sales of one calendar year, Add a sale (the side panel, confirmed in the
 * page), and each sale's ⋯ menu (Mark as paid…, Cancel this sale…). Money in only: a sale never changes stock.
 *
 * P3-C: a third view, Invoices (?view=invoices): one invoice per pallet to the US company, in US$ (nib lbs × the price per lb
 * setting, up to three other lines). "Pallets not invoiced yet" with Make invoice… (the side panel, confirmed in the page),
 * the invoices with their ⋯ menu (Open, Mark as paid…, Cancel…) and invoice.html?no=… to print one.
 * 1.30.1: Make an invoice by hand… (askHand): the same numbers, paid and cancel, for a pallet not recorded in the app; its
 * lines are worked out by CH_FIN.handInvoice exactly as the script does, and the row says "By hand" instead of the pallet.
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {}, F = window.CH_FIN, A = window.CH_ADMIN || {}, ui = A.ui;
  var $ = function (id) { return document.getElementById(id); };
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  var el = ui.el;
  function icon(name, size) { return A.icon ? A.icon(name, size) : null; }
  function none(node) { return A.none ? A.none(node) : node; }
  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }

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
      return cred.admin && window.CH_SIGNIN ? CH_SIGNIN.guard(j) : j; // "Please sign in again" shows the sign-in instead
    });
  }

  /* ---------- words ---------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    var thisYear = S.today ? S.today.slice(0, 4) : String(new Date().getFullYear());
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + (m[1] === thisYear ? '' : ', ' + m[1]);
  }
  function cents(t) { return F.signedCents(t); }
  function money(c) { return F.money(c); }
  function money0(c) { return c === 0 ? '0' : F.money(c); } // a real zero is 0
  /** A table cell with an amount: a real zero is 0, nothing is a dash, a negative balance is "Overpaid EC$ 40.00" in a pill. */
  function amountCell(t, opts) {
    opts = opts || {};
    var c = cents(t), td = el('td', { className: 'n' + (opts.cls ? ' ' + opts.cls : '') });
    if (opts.label) { td.setAttribute('data-p', '2'); td.setAttribute('data-label', opts.label); }
    if (c === null) return none(td);
    td.setAttribute('data-v', String(c));
    if (c === 0) td.textContent = '0';
    else if (c < 0 && opts.over) td.appendChild(ui.pill('info', F.money(c, { over: true })));
    else td.textContent = money(c);
    return td;
  }
  function lbs(v) { return v === null || v === undefined ? '' : (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }); }

  /* ---------- state ---------- */
  var Q0 = new URLSearchParams(location.search), VIEWS = ['payees', 'sales', 'invoices']; // P3-C: invoices
  var S = { season: Q0.get('season') || '', data: null, open: null, busy: false, view: VIEWS.indexOf(Q0.get('view')) >= 0 ? Q0.get('view') : 'payees', year: Q0.get('year') || '' };

  function read() {
    if (S.busy) return Promise.resolve();
    S.busy = true;
    if (A.updated) A.updated($('updated'), S.data ? S.data.at : null, true); else $('updated').textContent = 'Loading…';
    if (!S.data) $('loading').replaceChildren(ui.skeleton('strip', 3), ui.skeleton('rows', 6));
    return ask({ action: 'read', what: 'finances', season: S.season || undefined }).then(function (p) {
      S.busy = false;
      if (!p.ok) {
        if (!cred.admin && !p.suspended && window.CH_SIGNIN) { CH_SIGNIN.show(); return; } // a worker's or viewer's link without money: the sign-in, as the other admin pages
        throw new Error(p.error || 'The Sheet refused the request.');
      }
      use(p);
    }).catch(function (err) {
      S.busy = false;
      $('loading').replaceChildren();
      if (A.updated) A.updated($('updated'), S.data ? S.data.at : null, false); else $('updated').textContent = '';
      $('problem').hidden = false;
      $('problem-text').textContent = 'Could not load the finances (' + (err.message || err) + '). Check the internet connection and press Refresh.';
    });
  }

  function use(p) {
    S.data = p; S.season = p.season;
    $('problem').hidden = true; $('loading').replaceChildren(); $('main').hidden = false;
    if (A.navRole) A.navRole(true); // this person may see money: the Finances link stays
    if (A.updated) A.updated($('updated'), p.at, false);
    var sel = $('season');
    sel.replaceChildren.apply(sel, (p.seasons || []).map(function (x) { return new Option('Season ' + x, x); }));
    sel.value = p.season; sel.hidden = !(p.seasons || []).length;
    try { var q = new URLSearchParams(location.search); if (p.season) q.set('season', p.season); else q.delete('season'); var qs = q.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) { /* the address stays */ }
    $('paused-banner').hidden = !p.suspended;
    if (p.suspended) $('paused-title').textContent = ((C.brand && C.brand.company) || 'The company') + ' is paused by Batchstory.';
    $('pay-signin').hidden = !!p.can_pay || !!p.suspended;
    drawStats(p.payees || []);
    drawTable(p.payees || []);
    drawSales(p);
    drawInvoices(p); // P3-C
    showView(S.view);
    if (S.open !== null) { var again = find(S.open.name); if (again && S.open.panel && document.contains(S.open.panel.node)) fillPanel(again); }
  }
  function find(name) { return ((S.data && S.data.payees) || []).filter(function (x) { return x.name === name; })[0] || null; }

  function drawStats(payees) {
    var t = F.totals(payees);
    var stat = function (label, c, note) {
      return el('li', { className: c === 0 ? 'is-zero' : '' }, [el('span', { className: 'stat-l', text: label }), el('span', { className: 'stat-v', text: c === 0 ? '0' : money(c) }), note ? el('span', { className: 'stat-n', text: note }) : null]);
    };
    var ls = F.localSales((S.data && S.data.local_sales) || [], thisYear()); // P3-B: money in, this calendar year
    var lsStat = stat('Local sales this year', ls.sold, ls.unpaid ? money(ls.unpaid) + ' not yet paid' : 'Sales not cancelled');
    var lsLink = el('a', { href: 'finances.html?view=sales', id: 'stat-sales', text: 'Local sales this year' });
    lsLink.addEventListener('click', function (ev) { ev.preventDefault(); showView('sales', true); });
    lsStat.firstChild.replaceChildren(lsLink);
    $('fin-stats').replaceChildren(stat('Owed', t.owed, 'For the season\'s deliveries'), stat('Paid', t.paid, 'Payments not cancelled'), stat('Still to pay', t.left, payees.filter(function (p) { return cents(p.balance) > 0; }).length + ' to pay'), lsStat);
  }

  var sorter = null, filt = null;
  function drawTable(payees) {
    var body = $('fin-rows');
    body.replaceChildren.apply(body, payees.map(row));
    $('fin-box').hidden = !payees.length; $('fin-bar').hidden = !payees.length;
    $('fin-none').hidden = !!payees.length;
    if (!payees.length) $('fin-none').replaceChildren(ui.empty('Nothing owed yet' + (S.season ? ' in season ' + S.season : ''), 'Deliveries with an amount paid show here, one row per person or farm paid.'));
    var table = $('fin-table');
    if (!sorter) sorter = ui.sortable(table, { keep: true }); else ui.sortable(table, { keep: true });
    if (!filt) filt = ui.filter(table, { search: $('q'), count: $('count'), noun: ['payee', 'payees'] }); else filt.run();
  }
  function row(p) {
    var last = F.lastPaid(p);
    var open = el('button', { type: 'button', className: 'open fin-open', text: p.name, 'aria-haspopup': 'dialog' });
    var lastTd = el('td', { 'data-v': last });
    if (last) lastTd.textContent = day(last); else none(lastTd);
    var tr = el('tr', { className: 'is-link', 'data-name': p.name }, [
      el('td', { className: 'fin-name' }, [open, el('span', { className: 'sr-only', text: ' ' + (p.deliveries || []).map(function (d) { return d.farm; }).join(' ') })]),
      el('td', { className: 'n', 'data-v': String((p.deliveries || []).length), 'data-p': '2', 'data-label': 'Deliveries', text: String((p.deliveries || []).length) }),
      amountCell(p.owed), amountCell(p.paid),
      amountCell(p.balance, { over: true, label: 'Still to pay', cls: 'fin-left' }),
      lastTd,
      el('td', { className: 'go' }, [icon('chevron-right', 18)]),
    ]);
    open.addEventListener('click', function () { openPayee(p.name, open); });
    tr.addEventListener('click', function (ev) { if (!ev.target.closest('a, button, input, select')) openPayee(p.name, open); });
    return tr;
  }

  /* ---------- one payee: the side panel ---------- */
  function openPayee(name, from) {
    var p = find(name);
    if (!p) return;
    if (from && from.focus) from.focus(); // the panel gives the keyboard back here when it closes
    var panel = ui.panel({ title: p.name, body: el('div', { className: 'fin-panel' }), onClose: function () { S.open = null; } });
    S.open = { name: name, panel: panel, entry: uuid(), form: null };
    fillPanel(p);
  }
  function fillPanel(p) {
    var o = S.open, box = o.panel.body.firstChild;
    var keep = o.form ? { on: o.form.on.value, amt: o.form.amt.value, chk: o.form.chk.value, note: o.form.note.value, ticks: o.form.ticks() } : null;
    var b = cents(p.balance);
    var facts = el('dl', { className: 'facts' }, [
      el('div', {}, [el('dt', { text: 'Owed' }), el('dd', { text: money0(cents(p.owed)) })]),
      el('div', {}, [el('dt', { text: 'Paid' }), el('dd', { text: money0(cents(p.paid)) })]),
      el('div', {}, [el('dt', { text: b < 0 ? 'Overpaid' : 'Still to pay' }), el('dd', { className: 'fin-balance', text: money0(Math.abs(b)) })]),
      el('div', {}, [el('dt', { text: 'Season' }), el('dd', { text: S.season })]),
    ]);
    box.replaceChildren(facts, deliveriesTable(p), paymentsBlock(p), payForm(p, keep));
    if (A.fill) A.fill(box);
  }
  function deliveriesTable(p) {
    var rows = (p.deliveries || []).map(function (d) {
      var dt = el('td', {}); if (d.date) dt.textContent = day(d.date); else none(dt);
      var fm = el('td', {}); if (d.farm) fm.textContent = d.farm; else none(fm);
      var lb = el('td', { className: 'n' }); if (d.lbs !== null && d.lbs !== undefined) lb.textContent = lbs(d.lbs); else none(lb);
      var pr = el('td', { className: 'n' }); if (d.price !== null && d.price !== undefined) pr.textContent = money(Math.round(d.price * 100)); else none(pr);
      return el('tr', {}, [dt, el('td', { className: 'id', text: d.ferment }), fm, lb, pr, el('td', { className: 'n', text: money(cents(d.due)) })]);
    });
    return el('section', { className: 'fin-sec' }, [
      el('h3', { className: 'fin-h', text: 'Deliveries' }),
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table fin-deliveries' }, [
        el('thead', {}, [el('tr', {}, ['Date', 'Ferment', 'Farm', 'Lbs', 'Price per lb', 'Amount due'].map(function (h, i) { return el('th', { className: i >= 3 ? 'n' : '', text: h }); }))]),
        el('tbody', {}, rows),
      ])]),
    ]);
  }
  function paymentsBlock(p) {
    var list = (p.payments || []).slice().reverse();
    if (!list.length) return el('section', { className: 'fin-sec' }, [el('h3', { className: 'fin-h', text: 'Payments' }), el('p', { className: 'note', text: 'No payments recorded yet.' })]);
    var canPay = S.data.can_pay;
    var items = list.map(function (x) {
      var off = !!x.cancelled_at;
      var line = el('div', { className: 'fin-pay-main' }, [
        el('b', { className: 'fin-pay-amt', text: x.amount === null ? '–' : money(cents(x.amount)) }),
        el('span', { text: ' on ' + day(x.paid_on) }),
        x.check_no ? el('span', { className: 'fin-pay-chk', text: ' · check ' + x.check_no }) : null,
        el('span', { className: 'muted', text: ' · ' + x.id }),
      ]);
      var more = [];
      if (x.note) more.push(el('div', { className: 'fin-pay-note', text: x.note }));
      if (x.covered && x.covered.length) more.push(el('div', { className: 'note', text: 'Covers ' + x.covered.join(', ') }));
      more.push(el('div', { className: 'note', text: 'Recorded by ' + (x.by || 'an admin') + (x.at ? ' on ' + day(x.at) : '') }));
      if (off) more.push(el('div', { className: 'fin-pay-cancel' }, [ui.pill('bad', 'Cancelled'), el('span', { text: ' by ' + (x.cancelled_by || 'an admin') + ' on ' + day(x.cancelled_at) + ': ' + x.cancel_reason })]));
      var li = el('li', { className: 'fin-pay' + (off ? ' is-cancelled' : ''), 'data-id': x.id }, [el('div', { className: 'fin-pay-text' }, [line].concat(more))]);
      if (canPay && !off) {
        var dots = el('button', { type: 'button', className: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Actions for ' + x.id }, [icon('ellipsis', 18)]);
        ui.menu(dots, [{ label: 'Cancel this payment…', danger: true, onSelect: function () { askCancel(li, x); } }]);
        li.appendChild(dots);
      }
      return li;
    });
    return el('section', { className: 'fin-sec' }, [el('h3', { className: 'fin-h', text: 'Payments' }), el('ul', { className: 'fin-pays' }, items)]);
  }

  /* ---------- Mark paid ---------- */
  function payForm(p, keep) {
    var o = S.open;
    if (!S.data.can_pay) {
      o.form = null;
      return el('section', { className: 'fin-sec' }, [el('h3', { className: 'fin-h', text: 'Mark paid' }),
        el('p', { className: 'note', id: 'fin-pay-off', text: S.data.suspended ? 'Payments cannot be recorded while the company is paused.' : 'Sign in with your own email and password to record payments.' })]);
    }
    var b = cents(p.balance);
    var tomorrow = new Date(Date.parse(S.data.today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    var on = el('input', { type: 'date', id: 'fp-on', max: tomorrow, value: keep ? keep.on : S.data.today, required: true });
    var amt = el('input', { type: 'text', id: 'fp-amount', inputmode: 'decimal', autocomplete: 'off', value: keep ? keep.amt : b > 0 ? F.plain(b) : '' });
    var chk = el('input', { type: 'text', id: 'fp-check', autocomplete: 'off', maxlength: '30', value: keep ? keep.chk : '' });
    var note = el('input', { type: 'text', id: 'fp-note', autocomplete: 'off', maxlength: '200', value: keep ? keep.note : '' });
    var unpaid = F.unpaid(p);
    var boxes = unpaid.map(function (d, i) {
      var cb = el('input', { type: 'checkbox', id: 'fp-d' + i, value: d.intake_id });
      if (keep && keep.ticks.indexOf(d.intake_id) >= 0) cb.checked = true;
      return el('label', { className: 'check', 'for': 'fp-d' + i }, [cb, el('span', { text: ' ' + (d.date ? day(d.date) + ' · ' : '') + 'Ferment ' + d.ferment + ' · ' + money(cents(d.due)) })]);
    });
    var err = el('p', { className: 'field-msg bad', id: 'fp-err', role: 'alert', hidden: true });
    var conf = el('div', { id: 'fp-confirm', hidden: true });
    var save = el('button', { type: 'button', className: 'btn btn-primary', id: 'fp-save', text: 'Record payment' });
    var form = el('form', { className: 'fin-form', id: 'fp-form', novalidate: true }, [
      el('div', { className: 'f' }, [el('label', { 'for': 'fp-on', text: 'Paid on' }), on]),
      el('div', { className: 'f' }, [el('label', { 'for': 'fp-amount', text: 'Amount (EC$)' }), amt, el('span', { className: 'hint', text: b > 0 ? 'Still to pay: ' + money(b) + '. A part payment is fine.' : 'Nothing is still to pay.' })]),
      el('div', { className: 'f' }, [el('label', { 'for': 'fp-check' }, ['Check number ', el('span', { className: 'opt', text: '(optional)' })]), chk]),
      el('div', { className: 'f' }, [el('label', { 'for': 'fp-note' }, ['Note ', el('span', { className: 'opt', text: '(optional)' })]), note]),
      boxes.length ? el('fieldset', { className: 'ticks' }, [el('legend', { text: 'Deliveries it covers (optional)' })].concat(boxes)) : null,
      err, conf,
      el('div', { className: 'fin-actions' }, [save]),
    ]);
    o.form = { on: on, amt: amt, chk: chk, note: note, ticks: function () { return boxes.map(function (l) { return l.querySelector('input'); }).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }); } };
    var showErr = function (t) { err.hidden = !t; err.textContent = t || ''; o.msg = t || ''; }; // kept when the panel is drawn again with fresh numbers
    if (o.msg) showErr(o.msg);
    form.addEventListener('submit', function (ev) { ev.preventDefault(); save.click(); });
    save.addEventListener('click', function () {
      showErr('');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(on.value)) { showErr('Choose the day the payment was made.'); on.focus(); return; }
      if (on.value > tomorrow) { showErr('The date is in the future. Use the day the payment was made.'); on.focus(); return; }
      var a = F.amountOf(amt.value, S.data.max_amount);
      if (a.error) { showErr(a.error); amt.focus(); return; }
      if (/^[=+\-@]/.test(chk.value.trim())) { showErr('A check number cannot start with = + - or @.'); chk.focus(); return; }
      var body = { action: 'payment_add', entry_id: o.entry, paid_to: p.name, season: S.season, paid_on: on.value, amount: a.text, check_no: chk.value.trim(), note: note.value.trim(), covered: o.form.ticks(), from_balance: p.balance };
      confirmBox(conf, 'Record ' + money(a.cents) + ' paid to ' + p.name + ' on ' + day(on.value) + '?', '', '', 'Record payment', function (yes) {
        if (a.cents <= b) { send(body, yes, conf, showErr); return; }
        // more than is still to pay: asked again, here, before anything is sent (the server asks too: needs_confirm)
        confirmBox(conf, money(a.cents) + ' is more than the ' + money(Math.max(0, b)) + ' still to pay to ' + p.name + '. Record it anyway?', 'warn',
          p.name + ' will show as overpaid by ' + money(a.cents - b) + '.', 'Record it anyway', function (y2) { send(Object.assign({}, body, { confirm_over: true }), y2, conf, showErr); });
      });
    });
    return el('section', { className: 'fin-sec' }, [el('h3', { className: 'fin-h', text: 'Mark paid' }), form]);
  }
  /** An in-page confirmation (never the browser's confirm): the question, an optional note, Yes and Back. */
  function confirmBox(host, question, tone, extra, yesWords, onYes) {
    var yes = el('button', { type: 'button', className: 'btn ' + (tone === 'bad' ? 'btn-danger' : 'btn-primary'), id: 'fp-yes', text: yesWords });
    var back = el('button', { type: 'button', className: 'btn btn-secondary', id: 'fp-back', text: 'Back' });
    host.replaceChildren(el('div', { className: 'confirm' + (tone ? ' ' + tone : ''), role: 'group', 'aria-label': 'Confirm' }, [
      el('span', { className: 'confirm-title', text: question }), extra ? el('span', { className: 'confirm-note', text: extra }) : null,
      el('div', { className: 'confirm-actions' }, [back, yes]),
    ]));
    host.hidden = false;
    var acts = host.parentNode && host.parentNode.querySelector('.fin-actions');
    if (acts) acts.hidden = true; // one set of buttons at a time: the question's
    back.addEventListener('click', function () { host.hidden = true; host.replaceChildren(); if (acts) { acts.hidden = false; var b = acts.querySelector('button'); if (b) b.focus(); } });
    yes.addEventListener('click', function () { onYes(yes); });
    yes.focus();
  }
  function closeConf(conf) { conf.hidden = true; conf.replaceChildren(); var acts = conf.parentNode && conf.parentNode.querySelector('.fin-actions'); if (acts) acts.hidden = false; }
  function send(body, yes, conf, showErr) {
    yes.disabled = true; yes.setAttribute('aria-busy', 'true');
    ask(body).then(function (r) {
      yes.disabled = false; yes.removeAttribute('aria-busy');
      if (r.ok && (r.status === 'saved' || r.status === 'duplicate')) {
        closeConf(conf);
        if (S.open) { S.open.entry = uuid(); S.open.form = null; }
        ui.toast(r.status === 'duplicate' ? 'Already recorded.' : 'Saved. ' + (r.message || ''));
        return read();
      }
      if (r.needs_confirm) { // the server says it is more than still to pay: ask again, here, then send the same entry with confirm_over
        confirmBox(conf, r.error, 'warn', '', 'Record it anyway', function (y2) { send(Object.assign({}, body, { confirm_over: true }), y2, conf, showErr); });
        return;
      }
      closeConf(conf);
      showErr(r.error || 'Not saved. Try again.');
      if (r.stale || r.suspended) read(); // the page was out of date: show what is true now
    }).catch(function (e) {
      yes.disabled = false; yes.removeAttribute('aria-busy');
      closeConf(conf);
      showErr('Not saved: no answer from the Sheet (' + (e.message || e) + '). Press Record payment again: it is recorded once.');
    });
  }

  /* ---------- Cancel this payment… (a reason, confirmed in the panel) ---------- */
  function askCancel(li, x) {
    var old = li.querySelector('.fin-cancel-box');
    if (old) old.remove();
    var reason = el('input', { type: 'text', id: 'fc-reason', maxlength: '200', autocomplete: 'off' });
    var err = el('p', { className: 'field-msg bad', role: 'alert', hidden: true });
    var yes = el('button', { type: 'button', className: 'btn btn-danger', id: 'fc-yes', text: 'Cancel payment' });
    var keepIt = el('button', { type: 'button', className: 'btn btn-secondary', id: 'fc-keep', text: 'Keep it' });
    var box = el('div', { className: 'confirm bad fin-cancel-box' }, [
      el('span', { className: 'confirm-title', text: 'Cancel ' + x.id + ' (' + money(cents(x.amount)) + ' on ' + day(x.paid_on) + ')?' }),
      el('span', { className: 'confirm-note', text: 'It stays in the list, struck through, and no longer counts as paid. This cannot be undone: record it again if it was right.' }),
      el('div', { className: 'f' }, [el('label', { 'for': 'fc-reason', text: 'Why' }), reason]), err,
      el('div', { className: 'confirm-actions' }, [keepIt, yes]),
    ]);
    li.appendChild(box);
    reason.focus();
    var entry = uuid(), sure = false; // 2.14.0: sure = the admin said yes after "exported to QuickBooks Desktop"
    keepIt.addEventListener('click', function () { box.remove(); });
    yes.addEventListener('click', function () {
      var why = reason.value.trim();
      if (!why) { err.hidden = false; err.textContent = 'Say why the payment is cancelled.'; reason.focus(); return; }
      yes.disabled = true; yes.setAttribute('aria-busy', 'true');
      ask({ action: 'payment_cancel', entry_id: entry, payment_id: x.id, reason: why, confirm_exported: sure || undefined }).then(function (r) {
        yes.disabled = false; yes.removeAttribute('aria-busy');
        if (r.ok && (r.status === 'saved' || r.status === 'duplicate')) { ui.toast('Cancelled ' + x.id + '.'); return read(); }
        if (r.needs_confirm && !sure) { sure = true; err.hidden = false; err.textContent = r.error; yes.textContent = 'Yes, cancel it here too'; yes.focus(); return; } // already in a QuickBooks Desktop file: nothing was changed; ask once more, here
        err.hidden = false; err.textContent = r.error || 'Not cancelled. Try again.';
        if (r.stale || r.suspended) read();
      }).catch(function (e) {
        yes.disabled = false; yes.removeAttribute('aria-busy');
        err.hidden = false; err.textContent = 'No answer from the Sheet (' + (e.message || e) + '). Press Cancel payment again: it is done once.';
      });
    });
  }

  /* ---------- P3-B: the two views (Payments, Local sales), kept in the address as ?view=sales ---------- */
  function tabButtons() { return Array.prototype.slice.call($('fin-tabs').querySelectorAll('[role="tab"]')); }
  function showView(v, focus) {
    S.view = VIEWS.indexOf(v) >= 0 ? v : 'payees';
    tabButtons().forEach(function (b) {
      var on = b.getAttribute('data-tab') === S.view;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    var sales = S.view === 'sales', invs = S.view === 'invoices';
    $('view-payees').hidden = S.view !== 'payees'; $('view-sales').hidden = !sales; $('view-invoices').hidden = !invs;
    $('season').hidden = S.view !== 'payees' || !(S.data && (S.data.seasons || []).length);
    $('sale-year').hidden = !sales;
    $('page-sub').textContent = sales
      ? 'What was sold locally, to whom and for how much, in EC$, and whether it has been paid. Sales do not change the stock.'
      : invs ? 'One invoice per pallet to the US company, in US$: the pounds of nibs shipped × the price per lb, or one made by hand. Print it, then mark it paid.'
      : 'What each person or farm is owed for the season\'s deliveries, what has been paid and what is still to pay, in EC$.';
    var q = new URLSearchParams(location.search);
    if (S.view !== 'payees') q.set('view', S.view); else q.delete('view');
    if (sales && S.year && S.year !== thisYear()) q.set('year', S.year); else q.delete('year');
    var qs = q.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) { /* the address stays */ }
  }
  $('fin-tabs').addEventListener('click', function (ev) { var b = ev.target.closest('[role="tab"]'); if (b) showView(b.getAttribute('data-tab')); });
  $('fin-tabs').addEventListener('keydown', function (ev) { // arrow keys move along the tabs, as the other pages' do
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft' && ev.key !== 'Home' && ev.key !== 'End') return;
    var bs = tabButtons(), i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    var n = ev.key === 'Home' ? 0 : ev.key === 'End' ? bs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length;
    showView(bs[n].getAttribute('data-tab'), true);
  });

  /* ---------- P3-B: Local sales: one calendar year (a sale has no ferment, so no season) ---------- */
  function thisYear() { return S.data && S.data.today ? S.data.today.slice(0, 4) : String(new Date().getFullYear()); }
  function qty(s) { return s.quantity === null || s.quantity === undefined ? '' : (Math.round(s.quantity * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + (s.unit ? ' ' + s.unit : ''); } // no quantity: nothing (the cell shows the dash), never just a unit
  function findSale(id) { return ((S.data && S.data.local_sales) || []).filter(function (x) { return x.id === id; })[0] || null; }
  function drawSales(p) {
    var sales = p.local_sales || [], now = thisYear(), years = F.saleYears(sales, now);
    if (years.indexOf(S.year) < 0) S.year = now;
    var ys = $('sale-year');
    ys.replaceChildren.apply(ys, years.map(function (y) { return new Option(y === now ? 'This year (' + y + ')' : y, y); }));
    ys.value = S.year;
    var y = F.localSales(sales, S.year), mine = S.year === now;
    var stat = function (label, c, note, cls) {
      return el('li', { className: (c === 0 ? 'is-zero' : '') + (cls ? ' ' + cls : '') }, [el('span', { className: 'stat-l', text: label }), el('span', { className: 'stat-v', text: c === 0 ? '0' : money(c) }), note ? el('span', { className: 'stat-n', text: note }) : null]);
    };
    var live = y.sales.filter(function (s) { return !s.cancelled_at; }).length;
    $('sale-stats').replaceChildren(
      stat(mine ? 'Sold this year' : 'Sold in ' + S.year, y.sold, live + (live === 1 ? ' sale' : ' sales')),
      stat('Paid', y.paid, ''),
      stat('Not yet paid', y.unpaid, y.open ? y.open + (y.open === 1 ? ' sale' : ' sales') + ' to collect' : '', y.unpaid > 0 ? 'fin-due' : ''));
    $('sale-add').hidden = !p.can_pay;
    $('sale-signin').hidden = !!p.can_pay || !!p.suspended;
    $('sale-count').textContent = y.sales.length + (y.sales.length === 1 ? ' sale' : ' sales');
    var body = $('sale-rows');
    body.replaceChildren.apply(body, y.sales.map(function (s) { return saleRow(s, p.can_pay); }));
    $('sale-box').hidden = !y.sales.length;
    $('sale-none').hidden = !!y.sales.length;
    if (!y.sales.length) $('sale-none').replaceChildren(ui.empty('No local sales ' + (mine ? 'this year' : 'in ' + S.year), p.can_pay ? 'Press Add a sale to write one down.' : 'Sales an admin writes down show here.'));
    ui.sortable($('sale-table'), { keep: true });
  }
  function saleRow(s, canPay) {
    var off = !!s.cancelled_at;
    var dt = el('td', { className: 'strike', 'data-v': s.date, text: day(s.date) });
    var what = el('td', { className: 'sale-what', 'data-p': '2' }, [el('span', { className: 'strike', text: s.what }),
      s.note ? el('span', { className: 'sale-note', text: s.note }) : null,
      off ? el('span', { className: 'sale-note sale-cancel', text: 'Cancelled by ' + (s.cancelled_by || 'an admin') + ' on ' + day(s.cancelled_at) + ': ' + s.cancel_reason }) : null]);
    var q = el('td', { className: 'n strike', 'data-p': '2', 'data-v': s.quantity === null || s.quantity === undefined ? '' : String(s.quantity), text: qty(s) });
    var buyer = el('td', { className: 'strike', 'data-p': '2' });
    if (s.buyer) buyer.textContent = s.buyer; else none(buyer);
    var total = amountCell(s.total, { cls: 'strike' });
    total.setAttribute('data-p', '2');
    var paid = el('td', { className: 'sale-paid', 'data-p': '2', 'data-v': off ? 'c' : s.paid ? 'p' + s.paid_on : 'n' }, [off ? ui.pill('bad', 'Cancelled') : s.paid ? ui.pill('ok', 'Paid ' + day(s.paid_on)) : ui.pill('warn', 'Not paid')]);
    var act = el('td', { className: 'act' });
    if (canPay && !off) {
      var dots = el('button', { type: 'button', className: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Actions for ' + s.id }, [icon('ellipsis', 18)]);
      ui.menu(dots, [s.paid ? null : { label: 'Mark as paid…', onSelect: function () { askSale(s, 'paid', dots); } },
        { label: 'Cancel this sale…', danger: true, onSelect: function () { askSale(s, 'cancel', dots); } }]);
      act.appendChild(dots);
    }
    return dashEmpty(el('tr', { className: 'sale' + (off ? ' is-cancelled' : ''), 'data-id': s.id }, [dt, what, q, buyer, total, paid, act]));
  }
  /** The facts of one sale, for the panels. */
  function saleFacts(s) {
    var fact = function (k, v) { var dd = el('dd', {}); if (v) dd.textContent = v; else none(dd); return el('div', {}, [el('dt', { text: k }), dd]); };
    return el('dl', { className: 'facts' }, [fact('Date', day(s.date)), fact('What', s.what), fact('Quantity', qty(s)), fact('Buyer', s.buyer),
      fact('Price per unit', s.price === null ? '' : money(cents(s.price))), fact('Total', s.total === null ? '' : money(cents(s.total))),
      fact('Paid', s.paid ? day(s.paid_on) : 'Not yet'), fact('Note', s.note), fact('Recorded by', (s.by || 'an admin') + (s.at ? ' on ' + day(s.at) : ''))]);
  }
  /** Mark as paid… or Cancel this sale…: the side panel, with one question to confirm (never the browser's confirm). */
  function askSale(s, kind, from) {
    if (from && from.focus) from.focus(); // the panel gives the keyboard back here when it closes
    var paid = kind === 'paid', entry = uuid();
    var tomorrow = new Date(Date.parse(S.data.today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    var input = paid ? el('input', { type: 'date', id: 'sp-on', max: tomorrow, value: S.data.today, required: true })
      : el('input', { type: 'text', id: 'sc-reason', maxlength: '200', autocomplete: 'off' });
    var err = el('p', { className: 'field-msg bad', id: paid ? 'sp-err' : 'sc-err', role: 'alert', hidden: true });
    var yes = el('button', { type: 'button', className: 'btn ' + (paid ? 'btn-primary' : 'btn-danger'), id: paid ? 'sp-yes' : 'sc-yes', text: paid ? 'Mark paid' : 'Cancel sale' });
    var back = el('button', { type: 'button', className: 'btn btn-secondary', id: paid ? 'sp-back' : 'sc-keep', text: paid ? 'Back' : 'Keep it' });
    var title = (paid ? 'Mark ' + s.id : 'Cancel ' + s.id) + ' (' + money(cents(s.total)) + (s.buyer ? (paid ? ' from ' : ' to ') + s.buyer : '') + ')' + (paid ? ' as paid?' : '?');
    var box = el('div', { className: 'confirm' + (paid ? '' : ' bad'), role: 'group', 'aria-label': 'Confirm' }, [
      el('span', { className: 'confirm-title', text: title }),
      el('span', { className: 'confirm-note', text: paid ? 'It then counts as paid. This is filled in once.' : 'It stays in the list, struck through, and no longer counts. This cannot be undone: add it again if it was right.' }),
      el('div', { className: 'f' }, [el('label', { 'for': input.id, text: paid ? 'Paid on' : 'Why' }), input]), err,
      el('div', { className: 'confirm-actions' }, [back, yes]),
    ]);
    var pnl = ui.panel({ title: (paid ? 'Mark as paid: ' : 'Cancel: ') + s.id, body: el('div', { className: 'fin-panel' }, [saleFacts(s), box]) });
    input.focus();
    back.addEventListener('click', function () { pnl.close(); });
    var fail = function (t) { err.hidden = false; err.textContent = t; };
    yes.addEventListener('click', function () {
      err.hidden = true;
      var v = input.value.trim(), body;
      if (paid) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { fail('Choose the day it was paid.'); input.focus(); return; }
        if (v > tomorrow) { fail('The date is in the future. Use the day it was paid.'); input.focus(); return; }
        body = { action: 'local_sale_paid', entry_id: entry, sale_id: s.id, paid_on: v };
      } else {
        if (!v) { fail('Say why the sale is cancelled.'); input.focus(); return; }
        body = { action: 'local_sale_cancel', entry_id: entry, sale_id: s.id, reason: v, confirm_exported: yes.dataset.sure === '1' || undefined };
      }
      yes.disabled = true; yes.setAttribute('aria-busy', 'true');
      ask(body).then(function (r) {
        yes.disabled = false; yes.removeAttribute('aria-busy');
        if (r.ok && (r.status === 'saved' || r.status === 'duplicate' || r.already)) { pnl.close(); ui.toast(r.status === 'duplicate' ? 'Already done.' : r.message || 'Saved.'); return read(); } // already: marked paid on that day before, nothing changed
        if (r.needs_confirm && yes.dataset.sure !== '1') { yes.dataset.sure = '1'; fail(r.error); yes.textContent = 'Yes, cancel it here too'; yes.focus(); return; } // 2.14.0: in a QuickBooks Desktop file: nothing changed; ask once more, here
        fail(r.error || 'Not saved. Try again.');
        if (r.stale || r.suspended) read();
      }).catch(function (e) {
        yes.disabled = false; yes.removeAttribute('aria-busy');
        fail('No answer from the Sheet (' + (e.message || e) + '). Press ' + yes.textContent + ' again: it is done once.');
      });
    });
  }

  /* ---------- P3-B: Add a sale (the side panel; asked in the page before anything is sent) ---------- */
  /** A pick list from Answer choices, with Other… (a typed answer) at the end. */
  function pick(id, items, label) {
    var otherOpt = el('option', { value: '', 'data-other': '1', text: 'Other…' });
    var sel = el('select', { id: id }, [el('option', { value: '', text: 'Choose…' })].concat((items || []).map(function (x) { return el('option', { value: x, text: x }); }), [otherOpt]));
    var other = el('input', { type: 'text', id: id + '-other', maxlength: '80', autocomplete: 'off', 'aria-label': label + ': other', placeholder: 'Type it', hidden: true });
    var isOther = function () { return sel.selectedIndex === sel.options.length - 1; };
    if (!(items || []).length) { otherOpt.selected = true; other.hidden = false; }
    sel.addEventListener('change', function () { other.hidden = !isOther(); if (!other.hidden) other.focus(); });
    return { sel: sel, other: other, value: function () { return isOther() ? other.value.trim() : sel.value; } };
  }
  function addSale() {
    if (!S.data || !S.data.can_pay) return;
    var lists = S.data.sale_lists || {}, max = S.data.max_amount, entry = uuid();
    var tomorrow = new Date(Date.parse(S.data.today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    var date = el('input', { type: 'date', id: 'ls-date', max: tomorrow, value: S.data.today, required: true });
    var what = pick('ls-what', lists.items, 'What was sold'), unit = pick('ls-unit', lists.units, 'Unit');
    var qn = el('input', { type: 'text', id: 'ls-qty', inputmode: 'decimal', autocomplete: 'off' });
    var buyer = el('input', { type: 'text', id: 'ls-buyer', maxlength: '200', autocomplete: 'off' });
    var price = el('input', { type: 'text', id: 'ls-price', inputmode: 'decimal', autocomplete: 'off' });
    var total = el('input', { type: 'text', id: 'ls-total', inputmode: 'decimal', autocomplete: 'off' });
    var totalHint = el('span', { className: 'hint', id: 'ls-total-hint' });
    var yesR = el('input', { type: 'radio', name: 'ls-paid', id: 'ls-paid-yes', value: 'yes' }), noR = el('input', { type: 'radio', name: 'ls-paid', id: 'ls-paid-no', value: 'no' });
    var paidOn = el('input', { type: 'date', id: 'ls-paid-on', max: tomorrow, value: S.data.today });
    var paidOnBox = el('div', { className: 'f', id: 'ls-paid-on-box', hidden: true }, [el('label', { 'for': 'ls-paid-on', text: 'Paid on' }), paidOn]);
    var note = el('input', { type: 'text', id: 'ls-note', maxlength: '200', autocomplete: 'off' });
    var err = el('p', { className: 'field-msg bad', id: 'ls-err', role: 'alert', hidden: true });
    var conf = el('div', { id: 'ls-confirm', hidden: true });
    var save = el('button', { type: 'button', className: 'btn btn-primary', id: 'ls-save', text: 'Add sale' });
    var opt = function (t) { return [t + ' ', el('span', { className: 'opt', text: '(optional)' })]; };
    var form = el('form', { className: 'fin-form', id: 'ls-form', novalidate: true }, [
      el('div', { className: 'f' }, [el('label', { 'for': 'ls-date', text: 'Date' }), date]),
      el('div', { className: 'f' }, [el('label', { 'for': 'ls-what', text: 'What was sold' }), what.sel, what.other]),
      el('div', { className: 'sale-two' }, [
        el('div', { className: 'f' }, [el('label', { 'for': 'ls-qty', text: 'Quantity' }), qn]),
        el('div', { className: 'f' }, [el('label', { 'for': 'ls-unit', text: 'Unit' }), unit.sel, unit.other]),
      ]),
      el('div', { className: 'f' }, [el('label', { 'for': 'ls-buyer' }, opt('Buyer')), buyer]),
      el('div', { className: 'f' }, [el('label', { 'for': 'ls-price' }, opt('Price per unit (EC$)')), price]),
      el('div', { className: 'f' }, [el('label', { 'for': 'ls-total', text: 'Total (EC$)' }), total, totalHint]),
      el('fieldset', { className: 'ticks' }, [el('legend', { text: 'Paid?' }), el('div', { className: 'chips' }, [
        el('label', { className: 'chip-opt', 'for': 'ls-paid-yes' }, [yesR, el('span', { text: 'Yes' })]),
        el('label', { className: 'chip-opt', 'for': 'ls-paid-no' }, [noR, el('span', { text: 'Not yet' })]),
      ])]),
      paidOnBox,
      el('div', { className: 'f' }, [el('label', { 'for': 'ls-note' }, opt('Note')), note]),
      err, conf,
      el('div', { className: 'fin-actions' }, [save]),
    ]);
    var pnl = ui.panel({ title: 'Add a sale', body: el('div', { className: 'fin-panel' }, [form]) });
    if (A.fill) A.fill(form);
    // the total works itself out from quantity × price; with no price it is typed
    var paidOnTouched = false;
    var sum = function () {
      if (price.value.trim()) {
        var q = F.quantityOf(qn.value), pr = F.amountOf(price.value, max);
        total.readOnly = true;
        total.value = !q.error && !pr.error ? F.plain(F.saleTotal(q.hundredths, pr.cents)) : '';
        totalHint.textContent = 'Quantity × price per unit.';
      } else {
        if (total.readOnly) { total.readOnly = false; total.value = ''; }
        totalHint.textContent = 'Type the total, or a price per unit to work it out.';
      }
    };
    sum();
    qn.addEventListener('input', sum); price.addEventListener('input', sum);
    var paidChoice = function () { paidOnBox.hidden = !yesR.checked; };
    yesR.addEventListener('change', paidChoice); noR.addEventListener('change', paidChoice);
    paidOn.addEventListener('input', function () { paidOnTouched = true; });
    date.addEventListener('input', function () { if (!paidOnTouched) paidOn.value = date.value; }); // paid on the day of the sale, unless changed
    var showErr = function (t) { err.hidden = !t; err.textContent = t || ''; };
    form.addEventListener('submit', function (ev) { ev.preventDefault(); save.click(); });
    save.addEventListener('click', function () {
      showErr('');
      var d = date.value, w = what.value(), u = unit.value(), b = buyer.value.trim(), n = note.value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { showErr('Choose the day of the sale.'); date.focus(); return; }
      if (d > tomorrow) { showErr('The date is in the future. Use the day of the sale.'); date.focus(); return; }
      if (!w) { showErr('Choose what was sold, or type it under Other…'); (what.other.hidden ? what.sel : what.other).focus(); return; }
      var q = F.quantityOf(qn.value);
      if (q.error) { showErr(q.error); qn.focus(); return; }
      if (!u) { showErr('Choose the unit, or type it under Other…'); (unit.other.hidden ? unit.sel : unit.other).focus(); return; }
      var pr = null;
      if (price.value.trim()) { pr = F.amountOf(price.value, max); if (pr.error) { showErr('Price per unit: ' + pr.error); price.focus(); return; } }
      var t = F.amountOf(total.value, max);
      if (t.error) { showErr('Total: ' + t.error); total.focus(); return; }
      if (pr && Math.abs(t.cents - F.saleTotal(q.hundredths, pr.cents)) > 1) { showErr('The total does not match quantity × price.'); return; }
      if (!yesR.checked && !noR.checked) { showErr('Say whether it has been paid.'); yesR.focus(); return; }
      var isPaid = yesR.checked;
      if (isPaid && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn.value)) { showErr('Choose the day it was paid.'); paidOn.focus(); return; }
      if (isPaid && paidOn.value > tomorrow) { showErr('The paid date is in the future. Use the day it was paid.'); paidOn.focus(); return; }
      var body = { action: 'local_sale_add', entry_id: entry, sale_date: d, what: w, quantity: q.text, unit: u, buyer: b, price: pr ? pr.text : '', total: t.text,
        paid: isPaid, paid_on: isPaid ? paidOn.value : '', note: n };
      confirmBox(conf, 'Add ' + q.text + ' ' + u + ' of ' + w + (b ? ' to ' + b : '') + ' on ' + day(d) + ', ' + money(t.cents) + (isPaid ? ', paid on ' + day(paidOn.value) : ', not yet paid') + '?', '', '', 'Add sale', function (yes) {
        yes.disabled = true; yes.setAttribute('aria-busy', 'true');
        ask(body).then(function (r) {
          yes.disabled = false; yes.removeAttribute('aria-busy');
          if (r.ok && (r.status === 'saved' || r.status === 'duplicate')) {
            pnl.close();
            ui.toast(r.status === 'duplicate' ? 'Already recorded.' : 'Saved. ' + (r.message || ''));
            S.year = F.yearOf(d) || S.year; // show the year the sale is in
            return read();
          }
          closeConf(conf);
          showErr(r.error || 'Not saved. Try again.');
          if (r.suspended) read();
        }).catch(function (e) {
          yes.disabled = false; yes.removeAttribute('aria-busy');
          closeConf(conf);
          showErr('Not saved: no answer from the Sheet (' + (e.message || e) + '). Press Add sale again: it is recorded once.');
        });
      });
    });
  }
  /* ---------- P3-C: Invoices: one per pallet to the US company, in US$ ---------- */
  function usd(c) { return F.usd(c); }
  function usdT(t) { var c = cents(t); return c === null ? '' : usd(c); }
  /** A row's empty cells show the muted dash (a real 0 stays 0): nothing is left blank. */
  function dashEmpty(tr) {
    Array.prototype.forEach.call(tr.cells, function (c) { if (!c.classList.contains('act') && !c.classList.contains('go') && !c.classList.contains('none') && !c.children.length && c.textContent.trim() === '') none(c); });
    return tr;
  }
  function lbsV(t) { var h = F.lbsHundredths(t); return h === null ? '' : String(h); } // sorts by hundredths; nothing recorded is empty, not 0
  function lbsT(t) { var h = F.lbsHundredths(t); return h === null ? '' : lbs(h / 100); }
  function invUrl(no) { return 'invoice.html?no=' + encodeURIComponent(no); }
  function findInvoice(no) { return ((S.data && S.data.invoices) || []).filter(function (x) { return x.no === no; })[0] || null; }
  function findPallet(id) { return ((S.data && S.data.to_invoice) || []).filter(function (x) { return x.shipment_id === id; })[0] || null; }
  function invStatus(x) {
    var td = el('td', { className: 'inv-status', 'data-p': '2', 'data-v': x.cancelled_at ? 'c' : x.paid_on ? 'p' + x.paid_on : 'n' });
    td.appendChild(x.cancelled_at ? ui.pill('bad', 'Cancelled') : x.paid_on ? ui.pill('ok', 'Paid ' + day(x.paid_on)) : ui.pill('warn', 'Not paid'));
    if (x.changed) { td.appendChild(document.createTextNode(' ')); td.appendChild(ui.pill('info', 'Pallet changed since')); }
    if (x.paid_on && x.payment_note) td.appendChild(el('span', { className: 'inv-note', text: x.payment_note })); // shown here only, never on the printed invoice
    return td;
  }
  function drawInvoices(p) {
    var list = (p.invoices || []).slice().reverse(), pals = p.to_invoice || [], t = F.invoiceTotals(p.invoices || []);
    if (!$('view-invoices')) return;
    var stat = function (label, c, note, cls) {
      return el('li', { className: (c === 0 ? 'is-zero' : '') + (cls ? ' ' + cls : '') }, [el('span', { className: 'stat-l', text: label }), el('span', { className: 'stat-v', text: c === 0 ? '0' : usd(c) }), note ? el('span', { className: 'stat-n', text: note }) : null]);
    };
    $('inv-stats').replaceChildren(stat('Invoiced', t.invoiced, t.count ? t.count + (t.count === 1 ? ' invoice' : ' invoices') + ' not cancelled' : ''), stat('Paid', t.paid, ''),
      stat('Outstanding', t.outstanding, t.open ? t.open + ' not paid yet' : '', t.outstanding > 0 ? 'fin-due' : ''));
    $('inv-signin').hidden = !!p.can_pay || !!p.suspended;
    $('inv-hand').hidden = !p.can_pay; $('inv-bar').hidden = !p.can_pay; // 1.30.1
    // pallets not invoiced yet
    var pb = $('pal-rows');
    pb.replaceChildren.apply(pb, pals.map(function (x) { return palRow(x, p.can_pay); }));
    $('pal-box').hidden = !pals.length; $('pal-none').hidden = !!pals.length;
    if (!pals.length) $('pal-none').replaceChildren(ui.empty('Every pallet has an invoice', 'A pallet shows here once it is shipped (the Ship form), until it is invoiced. For one not recorded in the app, use Make an invoice by hand.'));
    ui.sortable($('pal-table'), { keep: true });
    // the invoices, newest number first
    var ib = $('inv-rows');
    ib.replaceChildren.apply(ib, list.map(function (x) { return invRow(x, p.can_pay); }));
    $('inv-box').hidden = !list.length; $('inv-none').hidden = !!list.length;
    if (!list.length) $('inv-none').replaceChildren(ui.empty('No invoices yet', p.can_pay ? 'Press Make invoice… beside a pallet above, or Make an invoice by hand.' : 'Invoices an admin makes show here.'));
    ui.sortable($('inv-table'), { keep: true });
  }
  function palRow(x, canPay) {
    var nibs = (x.packages || []).filter(function (k) { return !k.shells; }).length, shells = (x.packages || []).length - nibs;
    var to = el('td', { 'data-v': x.ship_date, 'data-p': '2', 'data-label': 'To port' }); if (x.ship_date) to.textContent = day(x.ship_date); else none(to);
    var act = el('td', { className: 'act' });
    if (canPay && !nibs) act.appendChild(el('span', { className: 'muted', text: 'Shells only: nothing to bill' }));
    else if (canPay) {
      var b = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', id: 'make-' + x.shipment_id, text: 'Make invoice…', 'aria-label': 'Make invoice for pallet ' + x.shipment_id });
      b.addEventListener('click', function () { askInvoice(x.shipment_id, b); });
      act.appendChild(b);
    }
    return dashEmpty(el('tr', { 'data-id': x.shipment_id }, [
      el('td', { className: 'id', text: x.shipment_id }), to,
      el('td', { className: 'n', 'data-p': '2', 'data-label': 'Packages', 'data-v': String((x.packages || []).length), text: nibs ? nibs + (shells ? ' + ' + shells + ' shells' : '') : shells + ' shells' }),
      el('td', { className: 'n', 'data-p': '2', 'data-label': 'Nib lbs', 'data-v': lbsV(x.lbs), text: lbsT(x.lbs) }),
      act,
    ]));
  }
  function invRow(x, canPay) {
    var off = !!x.cancelled_at;
    var link = el('a', { href: invUrl(x.no), className: 'id', text: x.no });
    var dt = el('td', { className: 'strike', 'data-v': x.date, text: day(x.date) });
    var total = el('td', { className: 'n strike', 'data-p': '2', 'data-label': 'Total', 'data-v': String(cents(x.total) || 0), text: usdT(x.total) });
    var act = el('td', { className: 'act' });
    var dots = el('button', { type: 'button', className: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Actions for ' + x.no }, [icon('ellipsis', 18)]);
    ui.menu(dots, [{ label: 'Open', href: invUrl(x.no) },
      canPay && !off && !x.paid_on ? { label: 'Mark as paid…', onSelect: function () { askInvoiceDone(x.no, 'paid', dots); } } : null,
      canPay && !off && !x.paid_on ? { label: 'Cancel…', danger: true, onSelect: function () { askInvoiceDone(x.no, 'cancel', dots); } } : null]);
    act.appendChild(dots);
    return dashEmpty(el('tr', { className: 'inv' + (off ? ' is-cancelled' : ''), 'data-no': x.no }, [
      el('td', { 'data-v': String(x.no) }, [link]), dt,
      forCell(x),
      el('td', { className: 'n strike', 'data-p': '2', 'data-label': 'Lbs', 'data-v': lbsV(x.lbs), text: lbsT(x.lbs) }),
      total, invStatus(x), act,
    ]));
  }
  /** 1.30.1: what an invoice is for: "Pallet S26-03", or "By hand" with its For words. */
  function byHand(x) { return x.kind === 'by hand'; }
  function forWords(x) { return byHand(x) ? 'By hand' + (x.for_ref ? ': ' + x.for_ref : '') : 'Pallet ' + x.shipment_id; }
  function forCell(x) {
    var td = el('td', { className: 'strike inv-for', 'data-p': '2', 'data-v': byHand(x) ? 'b ' + (x.for_ref || '') : 'p ' + x.shipment_id });
    if (byHand(x)) { td.appendChild(el('span', { className: 'inv-kind', text: 'By hand' })); if (x.for_ref) td.appendChild(el('span', { className: 'inv-note', text: x.for_ref })); }
    else td.appendChild(el('span', { className: 'id', text: 'Pallet ' + x.shipment_id }));
    return td;
  }
  /** The packages of a pallet or an invoice: package, roast, lbs (shells marked, at no charge). */
  function packTable(pk) {
    return el('div', { className: 'table-wrap' }, [el('table', { className: 'table fin-deliveries inv-packs' }, [
      el('thead', {}, [el('tr', {}, ['Package', 'Roast', 'Lbs'].map(function (h, i) { return el('th', { className: i === 2 ? 'n' : '', text: h }); }))]),
      el('tbody', {}, (pk || []).map(function (k) {
        return dashEmpty(el('tr', {}, [el('td', { className: 'id', text: k.id }), el('td', { className: 'id', text: k.roast || '' }),
          el('td', { className: 'n', text: (k.lbs === null || k.lbs === undefined ? '' : lbs(k.lbs)) + (k.shells ? ' shells, no charge' : '') })]));
      })),
    ])]);
  }
  /** Make invoice…: the side panel; asked in the page before anything is sent. */
  function askInvoice(id, from) {
    var x = findPallet(id);
    if (!x || !S.data.can_pay) return;
    if (from && from.focus) from.focus();
    var set = S.data.invoice_settings || {}, entry = uuid();
    var fact = function (k, v) { var dd = el('dd', {}); if (v) dd.textContent = v; else none(dd); return el('div', {}, [el('dt', { text: k }), dd]); };
    var facts = el('dl', { className: 'facts' }, [fact('Pallet', x.shipment_id), fact('To port', x.ship_date ? day(x.ship_date) : ''), fact('Nibs', lbsT(x.lbs) + ' lbs'), fact('Bill to', set.bill_to)]);
    var body = el('div', { className: 'fin-panel' }, [facts, el('section', { className: 'fin-sec' }, [el('h3', { className: 'fin-h', text: 'Packages' }), packTable(x.packages)])]);
    var pnl = ui.panel({ title: 'Invoice for pallet ' + x.shipment_id, body: body });
    var setLink = function (words) { return el('p', { className: 'notice warn inv-set', id: 'inv-noprice' }, [el('span', { text: words + ' ' }), el('a', { href: 'settings.html#sec-invoice', text: 'Settings → Invoices' })]); };
    if (!set.price_per_lb) { body.appendChild(setLink('Set the price per lb under')); return; } // the price is a company setting (Q9)
    if (!set.bill_to) body.appendChild(el('p', { className: 'hint', id: 'inv-nobill', text: 'Who the invoice is to (Bill to) is not set yet. It can be set under Settings → Invoices.' }));
    var tomorrow = new Date(Date.parse(S.data.today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    var date = el('input', { type: 'date', id: 'iv-date', max: tomorrow, value: S.data.today, required: true });
    var price = el('input', { type: 'text', id: 'iv-price', inputmode: 'decimal', autocomplete: 'off', value: set.price_per_lb });
    var lines = [];
    for (var i = 0; i < (set.lines_max || 3); i++) {
      lines.push({ label: el('input', { type: 'text', id: 'iv-l' + i, maxlength: String(set.label_max || 40), autocomplete: 'off', 'aria-label': 'Other line ' + (i + 1) + ': what for', placeholder: i ? '' : 'e.g. Freight' }),
        amount: el('input', { type: 'text', id: 'iv-a' + i, inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Other line ' + (i + 1) + ': US$' }) });
    }
    var sum = el('p', { className: 'inv-sum', id: 'iv-sum', 'aria-live': 'polite' });
    var err = el('p', { className: 'field-msg bad', id: 'iv-err', role: 'alert', hidden: true });
    var conf = el('div', { id: 'iv-confirm', hidden: true });
    var save = el('button', { type: 'button', className: 'btn btn-primary', id: 'iv-save', text: 'Make invoice' });
    var form = el('form', { className: 'fin-form', id: 'iv-form', novalidate: true }, [
      el('div', { className: 'f' }, [el('label', { 'for': 'iv-date', text: 'Invoice date' }), date]),
      el('div', { className: 'f' }, [el('label', { 'for': 'iv-price', text: 'Price per lb (US$)' }), price, el('span', { className: 'hint', text: 'From Settings → Invoices. Change it here for this invoice only.' })]),
      el('fieldset', { className: 'ticks inv-lines' }, [el('legend', {}, ['Other lines ', el('span', { className: 'opt', text: '(optional, up to ' + lines.length + ')' })])].concat(lines.map(function (l) { return el('div', { className: 'sale-two' }, [l.label, l.amount]); }))),
      sum, err, conf,
      el('div', { className: 'fin-actions' }, [save]),
    ]);
    body.appendChild(form);
    var lbsH = F.lbsHundredths(x.lbs) || 0;
    /** What the panel would bill: {error} or {priceText, amount, lines: [{label, amount (text)}], total} in cents. */
    var work = function () {
      var pr = F.priceOf(price.value, set.price_max);
      if (pr.error) return { error: pr.error, at: price };
      var out = [], extra = 0;
      for (var k = 0; k < lines.length; k++) {
        var lb = lines[k].label.value.replace(/\s+/g, ' ').trim(), am = lines[k].amount.value.trim();
        if (!lb && !am) continue;
        if (!lb || lb.indexOf(';') >= 0) return { error: 'Other line ' + (k + 1) + ': say what it is for (no ;).', at: lines[k].label };
        var a = F.amountOf(am.replace(/^US\$\s*/i, ''), set.max_total);
        if (a.error) return { error: 'Other line ' + (k + 1) + ': type the amount as a plain number of US$, like 120 or 120.50.', at: lines[k].amount };
        out.push({ label: lb, amount: a.text }); extra += a.cents;
      }
      var amt = F.invoiceAmount(lbsH, pr.units);
      return { price: pr, amount: amt, lines: out, total: amt + extra };
    };
    var show = function () {
      var w = work();
      sum.textContent = w.error ? '' : lbsT(x.lbs) + ' lbs × US$ ' + w.price.text + ' per lb = ' + usd(w.amount) + (w.lines.length ? ' · other lines ' + usd(w.total - w.amount) : '') + ' · Total ' + usd(w.total);
    };
    show();
    [price].concat(lines.map(function (l) { return l.label; }), lines.map(function (l) { return l.amount; })).forEach(function (n) { n.addEventListener('input', show); });
    if (A.fill) A.fill(body);
    date.focus();
    var showErr = function (t) { err.hidden = !t; err.textContent = t || ''; };
    form.addEventListener('submit', function (ev) { ev.preventDefault(); save.click(); });
    save.addEventListener('click', function () {
      showErr('');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { showErr('Choose the invoice date.'); date.focus(); return; }
      if (date.value > tomorrow) { showErr('The invoice date is in the future. Use today, or the day it was made.'); date.focus(); return; }
      var w = work();
      if (w.error) { showErr(w.error); w.at.focus(); return; }
      var no = set.next_no;
      var req = { action: 'invoice_create', entry_id: entry, shipment_id: x.shipment_id, invoice_date: date.value, price_per_lb: w.price.text, other_lines: w.lines, from_lbs: x.lbs, expect_no: no, from_bill_to: set.bill_to || '' }; // review L3: the Bill to this panel showed
      confirmBox(conf, 'Make invoice ' + no + ' for ' + usd(w.total) + '?', '', 'Pallet ' + x.shipment_id + ', dated ' + day(date.value) + '. The number is used once, even if the invoice is cancelled later.', 'Make invoice', function (yes) {
        yes.disabled = true; yes.setAttribute('aria-busy', 'true');
        ask(req).then(function (r) {
          yes.disabled = false; yes.removeAttribute('aria-busy');
          if (r.ok && (r.status === 'saved' || r.status === 'duplicate')) {
            pnl.close();
            ui.toast(r.status === 'duplicate' ? 'Already made.' : 'Saved. ' + (r.message || ''));
            return read();
          }
          closeConf(conf);
          showErr(r.error || 'Not saved. Try again.');
          if (r.stale || r.suspended) { pnl.close(); ui.toast(r.error || 'The page was out of date.'); read(); } // the pallet or the next number changed: show what is true now, then ask again
        }).catch(function (e) {
          yes.disabled = false; yes.removeAttribute('aria-busy');
          closeConf(conf);
          showErr('Not saved: no answer from the Sheet (' + (e.message || e) + '). Press Make invoice again: it is made once.');
        });
      });
    });
  }
  /**
   * 1.30.1: Make an invoice by hand…, for a pallet (or anything) not recorded in the app. The side panel: date, For, up to
   * hand_lines_max lines (a description, then lbs or a quantity and a price, or just an amount), notes; the worked-out total
   * (CH_FIN.handInvoice, rounded to the cent exactly as the script does); asked in the page before anything is sent. Bill to,
   * From and the terms come from Settings → Invoices, as for a pallet's invoice.
   */
  function askHand(from) {
    if (!S.data || !S.data.can_pay) return;
    if (from && from.focus) from.focus();
    var set = S.data.invoice_settings || {}, entry = uuid(), most = set.hand_lines_max || 10;
    var fact = function (k, v) { var dd = el('dd', {}); if (v) dd.textContent = v; else none(dd); return el('div', {}, [el('dt', { text: k }), dd]); };
    var body = el('div', { className: 'fin-panel' }, [el('dl', { className: 'facts' }, [fact('Bill to', set.bill_to), fact('Number', set.next_no)])]);
    var pnl = ui.panel({ title: 'Make an invoice by hand', body: body });
    if (!set.bill_to) body.appendChild(el('p', { className: 'hint', id: 'ih-nobill' }, [el('span', { text: 'Who the invoice is to (Bill to) is not set yet. It can be set under ' }), el('a', { href: 'settings.html#sec-invoice', text: 'Settings → Invoices' }), el('span', { text: '.' })]));
    var tomorrow = new Date(Date.parse(S.data.today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    var date = el('input', { type: 'date', id: 'ih-date', max: tomorrow, value: S.data.today, required: true });
    var ref = el('input', { type: 'text', id: 'ih-for', maxlength: String(set.for_max || 60), autocomplete: 'off', placeholder: 'e.g. Pallet of 12 Nov', required: true });
    var notes = el('input', { type: 'text', id: 'ih-notes', maxlength: String(set.notes_max || 300), autocomplete: 'off' });
    var rows = [], box = el('div', { className: 'ih-lines', id: 'ih-lines' });
    var addLine = function () {
      var i = rows.length, n = i + 1;
      var r = {
        description: el('input', { type: 'text', id: 'ih-d' + i, maxlength: String(set.desc_max || 80), autocomplete: 'off', 'aria-label': 'Line ' + n + ': what for', placeholder: i ? '' : 'e.g. Cocoa nibs' }),
        qty: el('input', { type: 'text', id: 'ih-q' + i, inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Line ' + n + ': lbs or quantity' }),
        unit: el('select', { id: 'ih-u' + i, 'aria-label': 'Line ' + n + ': lbs or a quantity' }, [el('option', { value: 'lbs', text: 'lbs' }), el('option', { value: 'qty', text: 'each' })]),
        price: el('input', { type: 'text', id: 'ih-p' + i, inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Line ' + n + ': price US$' }),
        amount: el('input', { type: 'text', id: 'ih-a' + i, inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Line ' + n + ': amount US$' }),
        auto: false,
      };
      rows.push(r);
      box.appendChild(el('div', { className: 'ih-line', 'data-line': String(i) }, [
        el('span', { className: 'ih-n', text: String(n) }), r.description,
        el('div', { className: 'ih-calc' }, [r.qty, r.unit, el('span', { className: 'ih-x', 'aria-hidden': 'true', text: '×' }), r.price, el('span', { className: 'ih-x', 'aria-hidden': 'true', text: '=' }), r.amount]),
      ]));
      [r.description, r.qty, r.price, r.amount].forEach(function (x) { x.addEventListener('input', show); });
      r.unit.addEventListener('change', show);
      more.hidden = rows.length >= most;
      return r;
    };
    var more = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', id: 'ih-more' }, [icon('plus', 16), document.createTextNode('Add a line')]);
    var sum = el('p', { className: 'inv-sum', id: 'ih-sum', 'aria-live': 'polite' });
    var err = el('p', { className: 'field-msg bad', id: 'ih-err', role: 'alert', hidden: true });
    var conf = el('div', { id: 'ih-confirm', hidden: true });
    var save = el('button', { type: 'button', className: 'btn btn-primary', id: 'ih-save', text: 'Make invoice' });
    var form = el('form', { className: 'fin-form', id: 'ih-form', novalidate: true }, [
      el('div', { className: 'f' }, [el('label', { 'for': 'ih-date', text: 'Invoice date' }), date]),
      el('div', { className: 'f' }, [el('label', { 'for': 'ih-for', text: 'For' }), ref, el('span', { className: 'hint', text: 'What this invoice is for. It shows on the invoice and in the list.' })]),
      el('fieldset', { className: 'ticks inv-lines' }, [el('legend', {}, ['Lines ', el('span', { className: 'opt', text: '(lbs or a quantity × a price, or just an amount; up to ' + most + ')' })]), box, more]),
      el('div', { className: 'f' }, [el('label', { 'for': 'ih-notes' }, ['Notes ', el('span', { className: 'opt', text: '(optional, printed on the invoice)' })]), notes]),
      sum, err, conf,
      el('div', { className: 'fin-actions' }, [save]),
    ]);
    body.appendChild(form);
    var typed = function () { return rows.map(function (r) { return { description: r.description.value, qty: r.qty.value, unit: r.unit.value, price: r.price.value, amount: r.auto ? '' : r.amount.value }; }); };
    /** A line with lbs (or a quantity) or a price works out its own amount (shown, not typed); otherwise the amount is typed. */
    function show() {
      rows.forEach(function (r) {
        var calc = !!(r.qty.value.trim() || r.price.value.trim());
        if (calc) {
          var one = F.handInvoice([{ description: 'x', qty: r.qty.value, unit: r.unit.value, price: r.price.value }], set);
          r.amount.value = one.error ? '' : one.lines[0].amount;
          r.amount.readOnly = true; r.auto = true;
        } else if (r.auto) { r.amount.value = ''; r.amount.readOnly = false; r.auto = false; }
      });
      var w = F.handInvoice(typed(), set);
      sum.textContent = w.error ? '' : w.count + (w.count === 1 ? ' line' : ' lines') + ' · Total ' + usd(w.total);
    }
    more.addEventListener('click', function () { var r = addLine(); r.description.focus(); });
    for (var k = 0; k < 3; k++) addLine();
    show();
    if (A.fill) A.fill(body);
    date.focus();
    var showErr = function (t) { err.hidden = !t; err.textContent = t || ''; };
    form.addEventListener('submit', function (ev) { ev.preventDefault(); save.click(); });
    save.addEventListener('click', function () {
      showErr('');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { showErr('Choose the invoice date.'); date.focus(); return; }
      if (date.value > tomorrow) { showErr('The invoice date is in the future. Use today, or the day it was made.'); date.focus(); return; }
      var f = ref.value.replace(/\s+/g, ' ').trim(), nt = notes.value.replace(/\s+/g, ' ').trim();
      if (!f) { showErr('Say what the invoice is for, like "Pallet of 12 Nov".'); ref.focus(); return; }
      if (F.formulaLike(f)) { showErr('What the invoice is for cannot start with = + - or @.'); ref.focus(); return; }
      if (F.formulaLike(nt)) { showErr('The notes cannot start with = + - or @.'); notes.focus(); return; }
      var w = F.handInvoice(typed(), set);
      if (w.error) { showErr(w.error); var at = rows[w.line] && rows[w.line][w.field]; if (at) at.focus(); return; }
      var no = set.next_no;
      var req = { action: 'invoice_manual', entry_id: entry, invoice_date: date.value, for_ref: f, lines: w.lines, notes: nt, from_total: F.plain(w.total), expect_no: no, from_bill_to: set.bill_to || '' };
      confirmBox(conf, 'Make invoice ' + no + ' for ' + usd(w.total) + '?', '', 'By hand, for ' + f + ', dated ' + day(date.value) + ', ' + w.count + (w.count === 1 ? ' line' : ' lines') + '. The number is used once, even if the invoice is cancelled later.', 'Make invoice', function (yes) {
        yes.disabled = true; yes.setAttribute('aria-busy', 'true');
        ask(req).then(function (r) {
          yes.disabled = false; yes.removeAttribute('aria-busy');
          if (r.ok && (r.status === 'saved' || r.status === 'duplicate')) {
            pnl.close();
            ui.toast(r.status === 'duplicate' ? 'Already made.' : 'Saved. ' + (r.message || ''));
            return read();
          }
          closeConf(conf);
          showErr(r.error || 'Not saved. Try again.');
          if (r.stale || r.suspended) { pnl.close(); ui.toast(r.error || 'The page was out of date.'); read(); } // the number or the Bill to changed: show what is true now, then ask again
        }).catch(function (e) {
          yes.disabled = false; yes.removeAttribute('aria-busy');
          closeConf(conf);
          showErr('Not saved: no answer from the Sheet (' + (e.message || e) + '). Press Make invoice again: it is made once.');
        });
      });
    });
  }
  /** Mark as paid… or Cancel…: the side panel, with one question to confirm. */
  function askInvoiceDone(no, kind, from) {
    var x = findInvoice(no);
    if (!x) return;
    if (from && from.focus) from.focus();
    var paid = kind === 'paid', entry = uuid();
    var tomorrow = new Date(Date.parse(S.data.today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    var input = paid ? el('input', { type: 'date', id: 'ip-on', max: tomorrow, value: S.data.today, required: true }) : el('input', { type: 'text', id: 'ic-reason', maxlength: '200', autocomplete: 'off' });
    var note = paid ? el('input', { type: 'text', id: 'ip-note', maxlength: '200', autocomplete: 'off' }) : null;
    var err = el('p', { className: 'field-msg bad', id: paid ? 'ip-err' : 'ic-err', role: 'alert', hidden: true });
    var yes = el('button', { type: 'button', className: 'btn ' + (paid ? 'btn-primary' : 'btn-danger'), id: paid ? 'ip-yes' : 'ic-yes', text: paid ? 'Mark paid' : 'Cancel invoice' });
    var back = el('button', { type: 'button', className: 'btn btn-secondary', id: paid ? 'ip-back' : 'ic-keep', text: paid ? 'Back' : 'Keep it' });
    var box = el('div', { className: 'confirm' + (paid ? '' : ' bad'), role: 'group', 'aria-label': 'Confirm' }, [
      el('span', { className: 'confirm-title', text: (paid ? 'Mark ' + x.no + ' (' + usdT(x.total) + ') as paid?' : 'Cancel ' + x.no + ' (' + usdT(x.total) + ', ' + (byHand(x) ? 'by hand' + (x.for_ref ? ': ' + x.for_ref : '') : 'pallet ' + x.shipment_id) + ')?') }),
      el('span', { className: 'confirm-note', text: paid ? 'This is filled in once. A paid invoice cannot be cancelled here.' : 'It stays in the list, struck through, and its number is never used again.' + (byHand(x) ? '' : ' The pallet can then be invoiced again.') }),
      el('div', { className: 'f' }, [el('label', { 'for': input.id, text: paid ? 'Paid on' : 'Why' }), input]),
      paid ? el('div', { className: 'f' }, [el('label', { 'for': 'ip-note' }, ['Note ', el('span', { className: 'opt', text: '(optional)' })]), note]) : null,
      err, el('div', { className: 'confirm-actions' }, [back, yes]),
    ]);
    var fact = function (k, v) { var dd = el('dd', {}); if (v) dd.textContent = v; else none(dd); return el('div', {}, [el('dt', { text: k }), dd]); };
    var facts = el('dl', { className: 'facts' }, [fact('Invoice', x.no), fact('Date', day(x.date)), byHand(x) ? fact('For', forWords(x)) : fact('Pallet', x.shipment_id), fact('Total', usdT(x.total))]);
    var pnl = ui.panel({ title: (paid ? 'Mark as paid: ' : 'Cancel: ') + x.no, body: el('div', { className: 'fin-panel' }, [facts, box]) });
    input.focus();
    back.addEventListener('click', function () { pnl.close(); });
    var fail = function (t) { err.hidden = false; err.textContent = t; };
    yes.addEventListener('click', function () {
      err.hidden = true;
      var v = input.value.trim(), req;
      if (paid) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { fail('Choose the day it was paid.'); input.focus(); return; }
        if (v > tomorrow) { fail('The date is in the future. Use the day it was paid.'); input.focus(); return; }
        req = { action: 'invoice_paid', entry_id: entry, invoice_no: x.no, paid_on: v, note: note.value.trim() };
      } else {
        if (!v) { fail('Say why the invoice is cancelled.'); input.focus(); return; }
        req = { action: 'invoice_cancel', entry_id: entry, invoice_no: x.no, reason: v, confirm_exported: yes.dataset.sure === '1' || undefined };
      }
      yes.disabled = true; yes.setAttribute('aria-busy', 'true');
      ask(req).then(function (r) {
        yes.disabled = false; yes.removeAttribute('aria-busy');
        if (r.ok && (r.status === 'saved' || r.status === 'duplicate' || r.already)) { pnl.close(); ui.toast(r.status === 'duplicate' ? 'Already done.' : r.message || 'Saved.'); return read(); }
        if (r.needs_confirm && yes.dataset.sure !== '1') { yes.dataset.sure = '1'; fail(r.error); yes.textContent = 'Yes, cancel it here too'; yes.focus(); return; } // 2.14.0: in a QuickBooks Desktop file: nothing changed; ask once more, here
        fail(r.error || 'Not saved. Try again.');
        if (r.stale || r.suspended) read();
      }).catch(function (e) {
        yes.disabled = false; yes.removeAttribute('aria-busy');
        fail('No answer from the Sheet (' + (e.message || e) + '). Press ' + yes.textContent + ' again: it is done once.');
      });
    });
  }

  $('sale-add').addEventListener('click', addSale);
  $('inv-hand').addEventListener('click', function () { askHand($('inv-hand')); }); // 1.30.1
  $('sale-year').addEventListener('change', function () { S.year = $('sale-year').value; if (S.data) { drawSales(S.data); showView('sales'); } });

  $('season').addEventListener('change', function () { S.season = $('season').value; read(); });
  $('refresh').addEventListener('click', function () { read(); });
  read();
})();
