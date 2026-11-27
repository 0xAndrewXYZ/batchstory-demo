/*
 * QuickBooks Desktop files (script 2.14.0, spec QB-DESKTOP): the row "QuickBooks Desktop files" on the Exports page (#qbd-export).
 * One IIF file per QuickBooks company file: the Grenada company's (EC$: checks for farmer payments, sales receipts for paid local
 * sales, and pallet invoices only when the books keep them in EC$) or the US company's (US$: a bill per invoice).
 * The page only asks: Code.gs decides who may export (a named admin who signed in), what goes into a file, and marks what went in.
 *   - Download a test file: a few records, stamped TEST, nothing marked (a read; nothing is written).
 *   - Download and mark as exported: Raw log first, then the marks; the first real file of a company file needs the "test file
 *     was tried in a copy" tick. A lost download comes back from Earlier files (word for word), never by exporting again.
 *   - The demo company: Download sample files (both company files, plus the Grenada file with invoices, for discussion).
 * The file's text is made into Windows-1252 bytes by iif-bytes.js; a file with a character it cannot hold is never saved.
 * Settings → QuickBooks's "Which QuickBooks do you use?" (qb_product) shows this row, the Online row, or both (with a warning).
 * Every name and amount goes on the page as text, never as markup.
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var mount = $('qbd-export');
  if (!mount) return;
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  var cred = load('ch.admin', {}) || {};
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function icon(name, size) { return window.CH_ADMIN ? CH_ADMIN.icon(name, size) : null; }
  function none(node) { if (window.CH_ADMIN && CH_ADMIN.none) CH_ADMIN.none(node); else node.textContent = '–'; return node; }
  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  function readJson(r) { return r.text().then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { throw new Error('No connection. Try again.'); } return window.CH_SIGNIN ? CH_SIGNIN.guard(j) : j; }); }
  function ask(body) { body.key = cred.key; return C.ask(cred.url, body).then(readJson); }
  function readQbd(extra) { return C.read(cred.url, cred.key, 'quickbooks_desktop', extra).then(readJson); }
  function toast(msg) { if (window.CH_ADMIN && CH_ADMIN.ui && CH_ADMIN.ui.toast) CH_ADMIN.ui.toast(msg); }
  function say(node, text) { node.textContent = text || ''; node.hidden = !text; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  var CUR = { grenada: 'EC$', us: 'US$' };
  function money(file, s) { var n = Number(s); return CUR[file] + ' ' + (isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(s || '')); }
  function usd(s) { var n = Number(s); return 'US$ ' + (isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(s || '')); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : String(iso || ''); }
  var KIND = { payment: ['Farmer payments', 'Check'], sale: ['Local sales', 'Sales receipt'], invoice: ['Pallet invoices', 'Invoice'], bill: ['Invoices from the Grenada company', 'Bill'] };
  /** The file's bytes (Windows-1252) saved as a download. Refuses a file holding a character that has no byte (the Sheet left those out). */
  function saveIif(name, text) {
    var b = window.CH_IIF ? CH_IIF.iifBytes(text) : null;
    if (!b) throw new Error('The page could not make the file (iif-bytes.js is missing). Refresh the page.');
    if (b.bad.length) throw new Error('The file holds a letter QuickBooks may not read (' + b.bad.join(' ') + '). Nothing was saved.');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([b.bytes], { type: 'application/octet-stream' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }

  /* ---------- the Online row's title and the "only one of them" line ---------- */
  function onlineRow() { var o = $('qb-export'); return o ? o.closest('li') : null; }
  var BOTH = 'Use only one of the two for the same books: the Online file records a bill per delivery, the Desktop files a check per payment. Importing both counts the beans twice. Settings → QuickBooks says which you use.';
  function product(p) {
    var li = onlineRow(), mine = mount.closest('li');
    if (p === 'online') { if (mine) mine.hidden = true; return false; }
    if (p === 'desktop' && li) li.hidden = true;
    if (p === 'unsure' && li) {
      var t = $('qb-title'); if (t) t.textContent = 'QuickBooks Online file';
      if (!$('qb-both')) { var sum = li.querySelector('.qb-sum-title'); if (sum) sum.appendChild(el('span', { className: 'card-sub qbd-both', id: 'qb-both', text: BOTH })); }
    }
    return true;
  }

  function widget(first) {
    var S = { file: '', r: null, busy: false, done: 0, tries: null, first: first };
    mount.className = 'card qb-card qbd-card'; mount.hidden = false;
    mount.setAttribute('aria-labelledby', 'qbd-title');
    var body = el('div', { className: 'qb-body' });
    var det = el('details', { className: 'qb-details', id: 'qbd-details' }, [
      el('summary', {}, [el('span', { className: 'qb-sum-title' }, [el('h2', { id: 'qbd-title', text: 'QuickBooks Desktop files' }),
        el('span', { className: 'card-sub', text: 'Import files (IIF) for QuickBooks Desktop: one for each company\'s books.' }),
        first.product === 'unsure' ? el('span', { className: 'card-sub qbd-both', text: BOTH }) : null]), icon('chevron-right', 16)]),
      body]);
    mount.replaceChildren(det);
    var err = el('p', { className: 'err', role: 'alert', id: 'qbd-err', hidden: true });
    var from = el('input', { type: 'date', id: 'qbd-from' }), to = el('input', { type: 'date', id: 'qbd-to' }), inc = el('input', { type: 'checkbox', id: 'qbd-include' });
    var picks = CUR_FILES.map(function (f) {
      return el('button', { type: 'button', className: 'qbd-pick', id: 'qbd-pick-' + f, 'aria-pressed': 'false', onclick: function () { pick(f); } }, [
        el('b', { text: (f === 'grenada' ? first.labels.grenada : first.labels.us) }), el('span', { text: f === 'grenada' ? 'Grenada company (EC$)' : 'US company (US$)' })]);
    });
    var out = el('div', { className: 'qbd-out', id: 'qbd-out' });
    body.replaceChildren.apply(body, [
      el('div', { className: 'f' }, [el('span', { className: 'qbd-q', id: 'qbd-q', text: 'Which QuickBooks file?' }), el('div', { className: 'qbd-picks', role: 'group', 'aria-labelledby': 'qbd-q' }, picks)]),
      out, err,
      first.demo ? el('div', { className: 'qbd-sample' }, [el('button', { type: 'button', className: 'btn btn-secondary', id: 'qbd-samples', onclick: samples }, [icon('download'), el('span', { text: 'Download sample files' })]),
        el('span', { className: 'hint', text: 'The demo company\'s made-up records, stamped TEST, for the accountant. Nothing is marked as exported.' })]) : null,
      el('p', { className: 'how' }, [el('a', { href: 'qb-accountant.html', id: 'qbd-accountant', text: 'For your accountant: one page to print' }), ' · ', el('a', { href: 'settings.html#qb-settings', text: 'Settings → QuickBooks' })])].filter(Boolean)); // never a "null" text node
    if (/#quickbooks-desktop\b/.test(location.hash)) det.open = true;

    function pick(f) {
      if (S.busy) return;
      S.file = f; S.r = null; S.done = 0; S.tries = null;
      picks.forEach(function (b) { b.setAttribute('aria-pressed', b.id === 'qbd-pick-' + f ? 'true' : 'false'); });
      refresh();
    }
    function range() { return { file: S.file, from: from.value, to: to.value, include_exported: inc.checked }; }
    function refresh() {
      say(err, ''); S.done = 0; S.tries = null;
      out.setAttribute('aria-busy', 'true');
      return readQbd(range()).then(function (r) {
        out.removeAttribute('aria-busy');
        if (!r.ok) { say(err, r.error || 'That did not go through.'); return; }
        S.r = r; draw();
      }).catch(function (e) { out.removeAttribute('aria-busy'); say(err, 'Could not load the records (' + (e.message || e) + ').'); });
    }
    function notice(kind, title, kids, id) { return el('div', { className: 'notice ' + kind, id: id }, [icon(kind === 'info' ? 'info' : 'triangle-alert', 20), el('div', { className: 'notice-body' }, [title ? el('span', { className: 'notice-title', text: title }) : null].concat(kids))]); }
    function cell(text, cls) { var td = el('td', { className: cls }); if (text === '' || text === null || text === undefined) none(td); else td.textContent = text; return td; }

    function draw() {
      var r = S.r, f = S.file, kids = [];
      kids.push(el('div', { className: 'qb-controls' }, [
        el('div', { className: 'f' }, [el('label', { 'for': 'qbd-from', text: 'From' }), from]),
        el('div', { className: 'f' }, [el('label', { 'for': 'qbd-to', text: 'To' }), to]),
        el('label', { className: 'check', 'for': 'qbd-include' }, [inc, el('span', { text: 'Include ones already exported' })]),
        el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Show', onclick: refresh }),
      ]));
      if (inc.checked) kids.push(notice('warn', 'QuickBooks does not notice repeats.', [el('span', { text: 'Importing these again records them twice.' })], 'qbd-inc-warn'));
      if (r.suspended) kids.push(notice('info', '', [el('span', { text: 'This company is paused. You can still export your own data.' })]));
      // 1. what is in the file, by kind
      var counts = el('table', { className: 'table qbd-counts', id: 'qbd-counts' }, [el('tbody', {}, Object.keys(r.counts).map(function (k) {
        var c = r.counts[k];
        return el('tr', { 'data-kind': k }, [el('th', { scope: 'row', text: KIND[k][0] }), el('td', { className: 'n', text: String(c.count) }), el('td', { className: 'n', text: money(f, c.total) })]);
      }))]);
      kids.push(el('div', { className: 'table-wrap' }, [counts]));
      if (r.records.length) {
        var shown = r.records.slice(0, 200);
        kids.push(el('div', { className: 'table-wrap qb-preview', tabindex: '0', role: 'region', 'aria-label': 'Records in this file' }, [el('table', { className: 'table' }, [
          el('thead', {}, [el('tr', {}, ['Record', 'Date', 'Name', 'Number', 'Amount'].map(function (h, i) { return el('th', { scope: 'col', className: i === 4 ? 'n' : '', text: h }); }))]),
          el('tbody', { id: 'qbd-rows' }, shown.map(function (x) {
            return el('tr', { 'data-id': x.id }, [cell(KIND[x.kind][1] + ' ' + x.id, 'nw'), cell(day(x.date), 'nw'), cell(x.name), cell(x.doc_no, 'mono'), cell(money(f, x.amount), 'n'),
              x.exported ? el('td', {}, [el('span', { className: 'badge warn', text: 'Exported ' + day(String(x.exported.at).slice(0, 10)) })]) : null]);
          }))])]));
        if (r.records.length > shown.length) kids.push(el('p', { className: 'hint', text: 'Showing the first ' + shown.length + ' of ' + r.records.length + '. The files hold all of them.' }));
      } else kids.push(el('p', { className: 'qb-sum muted', id: 'qbd-nothing', text: r.already_exported.count && !inc.checked ? 'Nothing new to export in this range.' : 'Nothing to export in this range.' }));
      if (r.already_exported.count && !inc.checked) kids.push(el('p', { className: 'qb-left', text: plural(r.already_exported.count, 'record', 'records') + ' already exported before, not in this file.' }));
      // 2. a setting that holds a kind back
      var miss = r.left_out.setting_missing;
      if (miss.count) kids.push(notice('warn', '', [el('span', { text: plural(miss.count, 'invoice is', 'invoices are') + ' held back until ' + (f === 'us' ? 'the Grenada company\'s vendor name' : 'the US company\'s customer name') + ' is set. ' }),
        el('a', { href: 'settings.html#qb-settings', id: 'qbd-set-link', text: 'Settings → QuickBooks' })], 'qbd-missing'));
      // 3. changed since exported
      if ((r.changed_since || []).length) kids.push(notice('warn', 'Changed since they were exported', [el('ul', { id: 'qbd-changed' }, r.changed_since.map(function (c) { return el('li', { text: c.id + ': ' + c.words }); }))], 'qbd-changed-box'));
      // 4. enter by hand
      kids.push(el('section', { className: 'qbd-sec', id: 'qbd-hand' }, [el('h3', { text: 'Enter these by hand in QuickBooks' }),
        r.by_hand.length ? el('ul', {}, r.by_hand.map(function (b) { return el('li', { text: b.words }); })) : none(el('p', {}))]));
      // 5. left out, with reasons (folded; the count in the heading)
      var lo = r.left_out, n = 0, items = [];
      Object.keys(lo).forEach(function (k) { if (k === 'setting_missing' || k === 'invoice_mode') return; n += lo[k].count; lo[k].items.forEach(function (x) { items.push(x); }); });
      kids.push(el('details', { className: 'qbd-sec qbd-left', id: 'qbd-left' }, [el('summary', { text: 'Left out: ' + n }),
        items.length ? el('ul', {}, items.map(function (x) { return el('li', { text: x.id + (x.name ? ' (' + x.name + ')' : '') + ': ' + x.why + '.' }); })) : none(el('p', {}))]));
      // 6. names QuickBooks must already have
      kids.push(el('details', { className: 'qbd-sec', id: 'qbd-names' }, [el('summary', { text: 'Names QuickBooks must already have' }),
        el('ul', { className: 'qbd-namelist' }, r.names.map(function (x) { return el('li', { text: x.name + ' (' + x.as + ')' }); }).concat(r.accounts.map(function (a) { return el('li', { text: a.name + ' (' + a.as + ')' }); }))),
        el('p', { className: 'hint', text: 'Spelled exactly like this. QuickBooks makes an unknown account into a new bank account.' })]));
      // 7. the buttons
      var files = r.files || [], total = files.length;
      var testBtn = el('button', { type: 'button', className: 'btn btn-secondary', id: 'qbd-test', disabled: S.busy, onclick: testFile }, [icon('download'), el('span', { text: 'Download a test file' })]);
      var label = total <= 1 ? 'Download and mark as exported' : S.done >= total ? 'All ' + total + ' files downloaded' : 'Download file ' + (S.done + 1) + ' of ' + total + ' and mark as exported';
      var realBtn = el('button', { type: 'button', className: 'btn btn-primary', id: 'qbd-real', disabled: !total || S.done >= total || S.busy, onclick: askReal }, [icon('download'), el('span', { text: S.busy ? 'Preparing…' : label })]);
      kids.push(el('div', { className: 'actions qb-actions' }, [testBtn, realBtn]));
      kids.push(el('p', { className: 'hint', text: 'A test file holds a few records, stamped TEST. Nothing is marked as exported. It is for trying in a copy of the QuickBooks file.' }));
      kids.push(el('div', { id: 'qbd-confirm', className: 'confirm', hidden: true }));
      // 8. earlier files
      if ((r.history || []).length) kids.push(el('div', { className: 'qb-history', id: 'qbd-history' }, [el('h3', { text: 'Earlier files' }), el('ul', {}, r.history.map(function (h) {
        return el('li', {}, [day(String(h.at).slice(0, 10)) + ' · ' + h.by + ' · ' + plural(h.count, 'record', 'records') + ' · ', el('span', { className: 'mono', text: h.file }), ' ',
          el('button', { type: 'button', className: 'btn btn-link qbd-again', 'data-export': h.export_id, text: 'Download again', onclick: function () { again(h.export_id); } })]);
      }))]));
      out.replaceChildren.apply(out, kids);
      from.value = r.range.from; to.value = r.range.to; inc.checked = r.range.include_exported;
    }

    function testFile() {
      if (S.busy) return;
      S.busy = true; say(err, '');
      readQbd(Object.assign(range(), { test: true })).then(function (r) {
        S.busy = false;
        if (!r.ok) throw new Error(r.error || 'That did not go through.');
        if (!r.test_file.count) { say(err, 'There is nothing to put in a test file in this range.'); return; }
        saveIif(r.test_file.name, r.test_file.iif);
        toast('Saved ' + r.test_file.name + ' (' + plural(r.test_file.count, 'record', 'records') + ', stamped TEST). Nothing was marked.');
      }).catch(function (e) { S.busy = false; say(err, String(e.message || e)); });
    }
    function samples() {
      say(err, '');
      var asks = [{ file: 'grenada' }, { file: 'us' }, { file: 'grenada', with_invoices: true }];
      asks.reduce(function (p, a) {
        return p.then(function () { return readQbd(Object.assign({ test: true, sample: true }, a)).then(function (r) { if (!r.ok) throw new Error(r.error); if (r.test_file.count) saveIif(r.test_file.name, r.test_file.iif); }); });
      }, Promise.resolve()).then(function () { toast('Saved the sample files. Nothing was marked as exported.'); }).catch(function (e) { say(err, 'Could not make the sample files (' + (e.message || e) + ').'); });
    }

    /** The in-page confirmation before a real file: the count and total, and the first time for a file the trial tick box. */
    function askReal() {
      var r = S.r, f = r.files[S.done];
      if (!f || S.busy) return;
      var box = $('qbd-confirm'), tick = el('input', { type: 'checkbox', id: 'qbd-tested' });
      var yes = el('button', { type: 'button', className: 'btn btn-primary', id: 'qbd-yes', text: 'Yes, make the file', disabled: r.first_real });
      var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { box.hidden = true; } });
      tick.addEventListener('change', function () { yes.disabled = !tick.checked; });
      yes.addEventListener('click', function () { box.hidden = true; download(r.first_real && tick.checked); });
      box.replaceChildren.apply(box, [
        el('div', { className: 'confirm-title', tabindex: '-1', text: 'Make the file for the ' + (S.file === 'us' ? 'US' : 'Grenada') + ' QuickBooks file: ' + plural(f.count, 'record', 'records') + ', ' + money(S.file, f.total) + '?' }),
        el('span', { className: 'confirm-note', text: 'They will be marked as exported so they are never sent twice.' }),
        r.first_real ? el('label', { className: 'check', 'for': 'qbd-tested' }, [tick, el('span', { text: 'A test file was imported into a copy of this QuickBooks file first, and it looked right.' })]) : null,
        el('div', { className: 'confirm-actions' }, [no, yes]),
      ].filter(Boolean));
      box.hidden = false; box.querySelector('.confirm-title').focus();
    }
    function download(tested) {
      var r = S.r, f = r.files[S.done];
      S.busy = true; say(err, ''); draw();
      var sig = JSON.stringify([S.file, f.records, r.range]);
      if (!S.tries || S.tries.sig !== sig) S.tries = { sig: sig, id: uuid() }; // the same ID again after a failed try, so it is marked once
      var req = { action: 'quickbooks_desktop_export', entry_id: S.tries.id, file: S.file, records: f.records, from: r.range.from, to: r.range.to, include_exported: r.range.include_exported,
        confirm_tested: tested || undefined, file_n: f.n, files_total: f.of, by: cred.by };
      ask(req).then(function (o) {
        if (o.ok && o.status === 'duplicate') return readQbd({ file: S.file, export_id: S.tries.id }).then(function (a) { if (!a.ok) throw new Error(a.error); return { file: a.export_file }; });
        if (!o.ok) { var e = new Error(o.error || 'The export was refused.'); e.stale = !!o.stale; throw e; }
        return o;
      }).then(function (o) {
        saveIif(o.file.name, o.file.iif);
        toast('Saved ' + o.file.name + ' (' + plural(o.file.count, 'record', 'records') + ', ' + money(S.file, o.file.total) + '). Marked as exported.');
        S.busy = false; S.tries = null; S.done++;
        if (S.done >= r.files.length) return refresh();
        draw();
      }).catch(function (e) {
        S.busy = false;
        say(err, (e.message || e) + (e.stale ? '' : ' Nothing was marked as exported unless you see a saved file. Pressing it again is safe: it is never done twice.'));
        if (e.stale) refresh().then(function () { say(err, e.message); }); else draw();
      });
    }
    /** Earlier files: the file of an export already made, exactly as it was first made (never a new export). */
    function again(id) {
      say(err, '');
      readQbd({ file: S.file, export_id: id }).then(function (a) {
        if (!a.ok) throw new Error(a.error || 'That did not go through.');
        saveIif(a.export_file.name, a.export_file.iif);
        var changed = (a.changed || []).map(function (c) { return c.words; });
        toast('Saved ' + a.export_file.name + ', exactly as first made. Nothing new was marked.');
        if (changed.length) say(err, 'This is the file exactly as first made. Since then: ' + changed.join(' '));
      }).catch(function (e) { say(err, 'Could not get the file again (' + (e.message || e) + ').'); });
    }
  }
  var CUR_FILES = ['grenada', 'us'];

  /* ---------- start ---------- */
  function off(words, link) {
    mount.className = 'card qb-card qbd-card'; mount.hidden = false;
    mount.replaceChildren(el('div', { className: 'card-head' }, [el('div', {}, [el('h2', { text: 'QuickBooks Desktop files' }), el('p', { className: 'card-sub', id: 'qbd-off', text: words })])]),
      link ? el('div', { className: 'actions' }, [el('a', { className: 'btn btn-secondary', href: 'signin.html?next=exports.html', text: 'Sign in' })]) : null);
  }
  if (!cred.url || !cred.key) return; // not signed in: the page shows its own sign-in
  if (!cred.session) { off('Sign in with your own email and password to make QuickBooks Desktop files. The shared admin link cannot.', true); return; }
  readQbd({}).then(function (r) {
    if (!r.ok && /Unknown read/.test(r.error || '')) { off('Update needed: the Sheet\'s script is older than 2.14.0. Ask Batchstory.'); return; }
    if (!r.ok) { off(r.error || 'That did not go through.'); return; }
    if (product(r.product)) widget(r);
  }).catch(function (e) { off('Could not load (' + (e.message || e) + '). Refresh the page.'); });
})();
