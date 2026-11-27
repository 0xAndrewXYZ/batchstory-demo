/*
 * Export for QuickBooks (2.2.0). Two small widgets in one file:
 *   #qb-export    on the Exports page: pick a date range, see the bills, download the CSV file(s) for QuickBooks Online's bill import.
 *   #qb-settings  on the Settings page: the account, tax code, date format, bill number prefix and currency the file uses.
 * Only an admin who signed in can use either (the Sheet checks this; the page just hides what would be refused). The file's
 * text is made by the script, which records the export in Raw log first and marks the deliveries as exported. This page asks,
 * saves what the script returns, and shows every name and amount as text, never as markup.
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var mountExport = $('qb-export'), mountSettings = $('qb-settings');
  if (!mountExport && !mountSettings) return;
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  var cred = load('ch.admin', {}) || {};
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function icon(name, size) { return window.CH_ADMIN ? CH_ADMIN.icon(name, size) : null; }
  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  function readJson(r) {
    return r.text().then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('No connection. Try again.'); }
      return window.CH_SIGNIN ? CH_SIGNIN.guard(j) : j;
    });
  }
  function ask(body) { body.key = cred.key; return C.ask(cred.url, body).then(readJson); }
  function readQb(extra) { return C.read(cred.url, cred.key, 'quickbooks', extra).then(readJson); }
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.replaceChildren(icon('circle-check', 18), document.createTextNode(msg)); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 4000);
  }
  function say(node, text) { node.textContent = text || ''; node.hidden = !text; }
  function money(s) { var n = Number(s); return isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(s || ''); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function dayShort(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? +m[3] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[1] : String(iso || ''); }
  function saveFile(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }
  var DATE_EXAMPLE = { 'MM/DD/YYYY': '11/03/2026 (month first)', 'DD/MM/YYYY': '03/11/2026 (day first)', 'YYYY-MM-DD': '2026-11-03' };

  function rangeWords(g) { return g.from && g.to ? dayShort(g.from) + ' to ' + dayShort(g.to) : g.from ? 'from ' + dayShort(g.from) : g.to ? 'up to ' + dayShort(g.to) : 'every date'; }
  /** "How this file is set up": the assumptions, with this company's settings filled in. */
  function setupNote(s, max) {
    return el('details', { className: 'qb-how' }, [
      el('summary', { text: 'How this file is set up' }),
      el('ul', {}, [
        el('li', { text: 'This is for QuickBooks Online (Essentials, Plus or Advanced), not QuickBooks Desktop. In QuickBooks: Settings, Import data, Bills.' }),
        el('li', { text: 'One bill for each delivery that has a "Paid to" name and an amount. Your own beans (nobody paid) and deliveries with no amount are left out.' }),
        el('li', { text: 'Each bill is paid on delivery, so the bill date and the due date are both the delivery date, written ' + (DATE_EXAMPLE[s.date_format] || s.date_format) + '.' }),
        el('li', { text: 'The bill number is "' + s.bill_prefix + '-" and the delivery\'s ID (for example ' + s.bill_prefix + '-I012; deliveries are I001, I002 and so on). A delivery always keeps its ID, so QuickBooks can recognise one it has seen. To keep them, turn on "Custom transaction numbers" in QuickBooks.' }),
        el('li', { text: 'The supplier is the "Paid to" name exactly as typed. Tick "Add new suppliers that don’t already exist" when you import, or QuickBooks cannot find a name it does not know.' }),
        el('li', { text: 'Every bill goes to one account, "' + s.account + '", which must already exist in QuickBooks. ' + (s.tax_code ? 'The tax code is "' + s.tax_code + '".' : 'The tax code is left empty.') }),
        el('li', { text: s.currency ? 'The currency is ' + s.currency + ' (a Currency column is added, for QuickBooks with more than one currency).' : 'There is no Currency column: QuickBooks uses its home currency.' }),
        el('li', { text: 'A file holds at most ' + max + ' bills, as QuickBooks recommends. If there are more, you get several numbered files: download them one after another.' }),
      ]),
      el('p', { className: 'hint' }, ['Change the account, tax code, date format, bill number prefix and currency on the ', el('a', { href: 'settings.html#company', text: 'Settings page' }), '.']),
    ]);
  }

  /* ================= one delivery, in a side panel (1.22.2) =================
   * Opened from a bill or a left-out delivery on the Exports page, so a wrong or missing amount can be put right without leaving the
   * export. It is the Entries page's fix, for one Intakes row: read first, then Edit; every change goes to the same `correct` action
   * with the value it replaces ("from", so a cell changed elsewhere is never overwritten); the Sheet records the old value first; the
   * save is confirmed in the panel; and a delivery that already went into a QuickBooks file is asked about once more (needs_confirm).
   * Nothing new is asked of the Sheet: `read entries` (which columns may be changed), `read data` (the row) and `correct`.
   */
  var fixCols = null; // {editable, numbers, dates} of the Intakes tab, as the Sheet lists them
  var QB_COLS = ['Paid to', 'Price per lb (XCD)', 'Amount paid (XCD)', 'Date added']; // what a bill needs: always shown, even when empty
  function asText(v) { return v === null || v === undefined ? '' : String(v); }
  function numOf(v) { return C.toNumber(v); } // as the Sheet reads a number: "2,5" is 2.5, "1,234" is 1234 (config.js)
  function fieldId(col) { return 'qf-' + String(col).replace(/[^A-Za-z0-9]/g, function (ch) { return '_' + ch.charCodeAt(0).toString(16); }); } // every column its own id, whatever its punctuation
  function exportedWords(list) { return 'Exported to QuickBooks on ' + list.map(function (x) { return String(x.at).slice(0, 10) + ' (bill ' + x.bill_no + ')'; }).join(', ') + '. Change it in QuickBooks too.'; }
  function exportedNote(text) { return el('div', { className: 'notice warn qb-sent', role: 'status' }, [icon('triangle-alert', 20), el('div', { className: 'notice-body' }, [el('span', { text: text })])]); }
  function openDelivery(d, onSaved) {
    var UI = window.CH_ADMIN && CH_ADMIN.ui;
    if (!UI || !UI.panel) return;
    var box = el('div', { className: 'qb-fixpanel' }, [el('p', { className: 'hint', text: 'Loading…' })]);
    var P = UI.panel({ title: 'Delivery ' + d.intake_id, body: box });
    var busy = false;
    var cols = fixCols ? Promise.resolve(fixCols) : C.read(cred.url, cred.key, 'entries', { limit: 1 }).then(readJson).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'That did not go through.');
      fixCols = (r.columns || {}).Intakes || {}; return fixCols;
    });
    Promise.all([cols, C.read(cred.url, cred.key, 'data').then(readJson)]).then(function (res) {
      var c = res[0], data = res[1];
      if (!data.ok) throw new Error(data.error || 'That did not go through.');
      var same = ((data.tabs || {}).Intakes || []).filter(function (r) { return asText(r['Intake ID']).trim() === d.intake_id; }); // by its exact text
      var row = same.filter(function (r) { return asText(r['Ferment ID']).trim() === d.ferment; })[0];
      if (!row) { box.replaceChildren(el('p', { text: 'Delivery ' + d.intake_id + ' is no longer in your records. Press Show to refresh the list.' })); return; }
      if (asText(row['Intake ID']) !== d.intake_id) { box.replaceChildren(el('p', { text: 'Delivery number ' + d.intake_id + ' has a stray space in the Sheet, so change it in the Sheet\'s Intakes tab first.' })); return; }
      if (same.length > 1) { box.replaceChildren(el('p', { text: 'Delivery number ' + d.intake_id + ' is on more than one row, so it can only be changed in the Sheet\'s Intakes tab.' })); return; }
      drawDelivery(row, c);
    }).catch(function (e) { box.replaceChildren(el('p', { className: 'err', role: 'alert', text: 'Could not open the delivery (' + (e.message || e) + ').' })); });

    function inputType(col, orig) {
      if ((fixCols.dates || []).indexOf(col) >= 0 && (orig === '' || /^\d{4}-\d{2}-\d{2}$/.test(orig))) return 'date';
      return /note/i.test(col) ? 'textarea' : 'text';
    }
    function drawDelivery(row, c) {
      var editable = (c.editable || []).filter(function (h) { return h in row || QB_COLS.indexOf(h) >= 0; });
      var label = 'Delivery ' + d.intake_id + (row['Farm'] ? ' · ' + row['Farm'] : '');
      var facts = el('dl', { className: 'facts' });
      [['Ferment', d.ferment]].concat(editable.map(function (h) { return [h, asText(row[h])]; })).forEach(function (kv) {
        if (kv[1] === '' && QB_COLS.indexOf(kv[0]) < 0) return;
        var dd = el('dd', { text: kv[1] });
        if (kv[1] === '' && window.CH_ADMIN) CH_ADMIN.none(dd);
        facts.appendChild(el('div', {}, [el('dt', { text: kv[0] }), dd]));
      });
      var read = el('section', { className: 'e-rec' }, [facts]);
      var fs = el('fieldset', { className: 'row', hidden: true }, [el('legend', { text: label })]);
      var grid = el('div', { className: 'fields' }), inputs = [], empty = [];
      editable.forEach(function (col) {
        var orig = asText(row[col]), type = inputType(col, orig), numeric = (c.numbers || []).indexOf(col) >= 0;
        var id = fieldId(col);
        var inp = type === 'textarea' ? el('textarea', { id: id, rows: 2 }) : el('input', { id: id, type: type, inputmode: numeric ? 'decimal' : null, autocomplete: 'off' });
        inp.value = orig;
        var sheetValue = orig; // what the Sheet holds: sent as "from"
        orig = inp.value; // what the box shows, so an untouched box is never sent as a change
        var was = el('span', { className: 'was', hidden: true });
        var f = el('div', { className: 'f' }, [el('label', { 'for': id, text: col }), inp, was]);
        var rec = { col: col, input: inp, orig: orig, from: sheetValue, numeric: numeric, wrap: f, was: was };
        inp.addEventListener('input', function () { onEdit(rec); });
        inputs.push(rec);
        if (orig === '' && QB_COLS.indexOf(col) < 0) { f.hidden = true; empty.push(f); }
        grid.appendChild(f);
      });
      fs.appendChild(grid);
      if (empty.length) {
        var more = el('button', { type: 'button', className: 'btn btn-ghost btn-sm', text: 'Show ' + empty.length + ' empty fields' });
        more.addEventListener('click', function () { empty.forEach(function (f) { f.hidden = false; }); more.remove(); });
        fs.appendChild(el('div', { className: 'more-row' }, [more]));
      }
      var confirmBox = el('div', { className: 'confirm', hidden: true });
      var editBtn = el('button', { type: 'button', className: 'btn btn-secondary', id: 'qf-edit' }, [icon('pencil', 16), 'Edit']);
      var saveBtn = el('button', { type: 'button', className: 'btn btn-primary', id: 'qf-save', text: 'Save changes', disabled: true, hidden: true });
      var cancelBtn = el('button', { type: 'button', className: 'btn btn-ghost', text: 'Cancel editing', hidden: true });
      function pick(col) { return inputs.filter(function (r) { return r.col === col; })[0]; }
      function onEdit(rec) {
        var changed = rec.input.value !== rec.orig;
        rec.wrap.classList.toggle('changed', changed); rec.was.hidden = !changed;
        rec.was.textContent = 'was ' + (rec.orig === '' ? '(blank)' : rec.orig);
        // as on Entries: the amount paid follows weight and price only if it was weight × price to begin with
        if (rec.col === 'Wet lbs' || rec.col === 'Price per lb (XCD)') {
          var lbs = pick('Wet lbs'), price = pick('Price per lb (XCD)'), paid = pick('Amount paid (XCD)');
          if (lbs && price && paid) {
            var wasCalc = numOf(lbs.orig) !== null && numOf(price.orig) !== null && numOf(paid.orig) !== null && Math.abs(numOf(lbs.orig) * numOf(price.orig) - numOf(paid.orig)) < 0.01;
            var l = numOf(lbs.input.value), p = numOf(price.input.value);
            if (lbs.input.value === lbs.orig && price.input.value === price.orig) paid.input.value = paid.orig;
            else if (wasCalc && l !== null && p !== null) paid.input.value = String(Math.round(l * p * 100) / 100);
            var pc = paid.input.value !== paid.orig;
            paid.wrap.classList.toggle('changed', pc); paid.was.hidden = !pc;
            paid.was.textContent = 'was ' + (paid.orig === '' ? '(blank)' : paid.orig) + ' · weight × price';
          }
        }
        saveBtn.disabled = !inputs.some(function (r) { return r.input.value !== r.orig; });
      }
      function editing(on) {
        read.hidden = on; fs.hidden = !on; editBtn.hidden = on; saveBtn.hidden = !on; cancelBtn.hidden = !on;
        if (on) { var first = pick('Amount paid (XCD)') || inputs[0]; if (first) first.input.focus(); }
      }
      editBtn.addEventListener('click', function () { editing(true); });
      cancelBtn.addEventListener('click', function () { inputs.forEach(function (r) { r.input.value = r.orig; onEdit(r); }); confirmBox.hidden = true; editing(false); editBtn.focus(); });
      saveBtn.addEventListener('click', askSave);
      function showBox(cls, kids) {
        confirmBox.className = 'confirm' + (cls ? ' ' + cls : ''); confirmBox.replaceChildren.apply(confirmBox, kids.filter(Boolean)); confirmBox.hidden = false;
        var t = confirmBox.querySelector('.confirm-title'); if (t) t.focus();
      }
      function askSave() {
        var changes = [], problems = [];
        inputs.forEach(function (r) {
          if (r.input.value === r.orig) return;
          var v = r.input.value.trim();
          if (v === r.orig.trim()) return;
          if (r.numeric && v !== '' && numOf(v) === null) problems.push(r.col + ': "' + v + '" is not a number.');
          changes.push({ tab: 'Intakes', key: d.intake_id, col: r.col, value: v, from: r.from, shown: r.orig });
        });
        if (problems.length) { showBox('bad', [el('p', { className: 'err', text: problems.join(' ') })]); return; }
        if (!changes.length) return;
        var fix = { action: 'correct', entry_id: uuid(), about: asText(row['Source entry']), by: cred.by || 'Admin', changes: changes.map(function (x) { return { tab: x.tab, key: x.key, col: x.col, from: x.from, value: x.value }; }) };
        var yes = el('button', { type: 'button', className: 'btn btn-primary', id: 'qf-yes', text: 'Yes, save' });
        var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { confirmBox.hidden = true; } });
        var msg = el('p', { className: 'err', role: 'alert', hidden: true });
        yes.addEventListener('click', function () { send(yes, no, msg, fix, true); });
        showBox('', [
          el('div', { className: 'confirm-title', tabindex: '-1', text: 'Save ' + (changes.length === 1 ? 'this change' : 'these ' + changes.length + ' changes') + '?' }),
          el('ul', {}, changes.map(function (x) { return el('li', { text: label + ': ' + x.col + ' ' + (x.shown === '' ? '(blank)' : x.shown) + ' → ' + (x.value === '' ? '(blank)' : x.value) }); })),
          el('span', { className: 'confirm-note', text: 'The old values are kept in the change history.' }),
          el('div', { className: 'confirm-actions' }, [no, yes]), msg,
        ]);
      }
      function send(yes, no, msg, fix, mayConfirm) {
        if (busy) return;
        busy = true; yes.disabled = true; no.disabled = true; yes.textContent = 'Saving…'; yes.setAttribute('aria-busy', 'true');
        ask(fix).then(function (r) {
          busy = false;
          if (!r.ok && r.needs_confirm && mayConfirm) { // already in a QuickBooks file: nothing was changed yet; ask once more, here
            no.disabled = false; msg.hidden = true;
            msg.parentNode.insertBefore(exportedNote(r.error || exportedWords(r.exported || [])), msg.previousSibling);
            var go = el('button', { type: 'button', className: 'btn btn-primary', id: 'qf-yes-too', text: 'Yes, save it here too' });
            go.addEventListener('click', function () { fix.confirm_exported = true; send(go, no, msg, fix, false); });
            yes.replaceWith(go); go.focus();
            return;
          }
          if (!r.ok) throw new Error(r.error || 'That did not go through. Try again.');
          if (r.status !== 'saved' && r.status !== 'duplicate') throw new Error(r.message || 'That was not confirmed. Try again.');
          P.close();
          toast('Saved. Delivery ' + d.intake_id + ' is updated.');
          if (onSaved) onSaved();
        }).catch(function (e) {
          busy = false; yes.disabled = false; no.disabled = false; yes.removeAttribute('aria-busy');
          var text = String(e.message || e);
          msg.hidden = false;
          if (/changed since the page was opened/.test(text)) { msg.textContent = text + ' Close this and open the delivery again.'; yes.remove(); return; }
          yes.textContent = 'Try again';
          msg.textContent = text + ' (Pressing it again is safe: it is never done twice.)';
        });
      }
      var src = asText(row['Source entry']);
      box.replaceChildren.apply(box, [
        el('p', { className: 'qb-fix-sub', text: 'Ferment ' + d.ferment + (row['Farm'] ? ' · ' + row['Farm'] : '') }),
        d.why ? el('div', { className: 'notice warn' }, [icon('triangle-alert', 20), el('div', { className: 'notice-body' }, [el('span', { text: 'Left out of the export: ' + d.why + '.' })])]) : null,
        d.exported ? exportedNote(exportedWords([d.exported]).replace(' Change it in QuickBooks too.', '') + ' A change here does not change QuickBooks.') : null,
        read, fs,
        el('div', { className: 'actions' }, [editBtn, saveBtn, cancelBtn]),
        confirmBox,
        src ? el('p', { className: 'hint' }, [el('a', { href: 'entries.html#entry=' + encodeURIComponent(src), text: 'Open the whole entry on the Entries page' })]) : null,
      ].filter(Boolean));
      editBtn.focus();
    }
  }

  /* ================= the export widget (Exports page) ================= */
  function exportWidget(root) {
    var S = { r: null, busy: false, done: 0, range: { from: '', to: '', include_exported: false }, tries: null };
    root.className = 'card qb-card';
    var title = el('h2', { id: 'qb-title', text: 'Export for QuickBooks' });
    root.setAttribute('aria-labelledby', 'qb-title');
    var from = el('input', { type: 'date', id: 'qb-from', 'aria-label': 'From' }), to = el('input', { type: 'date', id: 'qb-to', 'aria-label': 'To' });
    var inc = el('input', { type: 'checkbox', id: 'qb-include' });
    var body = el('div', { className: 'qb-body' });
    var err = el('p', { className: 'err', role: 'alert', hidden: true });
    // Folded until opened, a row among the other exports; the bills are fetched the first time it opens.
    var det = el('details', { className: 'qb-details', id: 'qb-details' }, [
      el('summary', {}, [el('span', { className: 'qb-sum-title' }, [title, el('span', { className: 'card-sub', text: 'A file of bills for QuickBooks Online: one bill for each delivery that was paid to someone.' })]), icon('chevron-right', 16)]),
      body]);
    root.replaceChildren(det);
    root.hidden = false;
    var loaded = false;
    det.addEventListener('toggle', function () { if (det.open && !loaded) { loaded = true; refresh(); } });
    if (/#quickbooks\b/.test(location.hash)) det.open = true;

    // 1.22.2: an empty date box says "Any date". Some browsers show today's date in grey in an empty date box, which read as a range.
    function anyDate(inp) {
      var w = inp.parentNode && inp.parentNode.classList.contains('qb-date') ? inp.parentNode : el('span', { className: 'qb-date' }, [inp, el('span', { className: 'qb-any', 'aria-hidden': 'true', text: 'Any date' })]);
      var mark = function () { w.classList.toggle('is-empty', !inp.value); };
      if (!inp.dataset.any) { inp.dataset.any = '1'; inp.addEventListener('input', mark); inp.addEventListener('change', mark); }
      mark();
      return w;
    }
    function range() { return { from: from.value, to: to.value, include_exported: inc.checked }; }
    // A set of files is being downloaded (one is on its way, or some are done and some are not): the list must not change under it,
    // so a delivery cannot be opened until the set is finished, and a fix saved meanwhile refreshes only afterwards.
    function midSet() { var n = S.r ? (S.r.files || []).length : 0; return S.busy || (S.done > 0 && S.done < n); }
    function fixed() { if (midSet()) { S.after = true; return; } refresh(); }
    /*
     * 2.7.1: the last look at the same dates (this sign-in's own copy, CH_ADMIN.memo) is drawn at once and read again
     * with its "nothing changed" stamp, so an unchanged Sheet answers a few bytes. The page's "Updated" line says
     * "Updating…" meanwhile.
     */
    var M = window.CH_ADMIN && CH_ADMIN.memo;
    function sameRange(a, b) { return !!a && !!b && String(a.from || '') === String(b.from || '') && String(a.to || '') === String(b.to || '') && !!a.include_exported === !!b.include_exported; }
    function busyLine(on, at) { var u = document.getElementById('updated'); if (u && window.CH_ADMIN && CH_ADMIN.updated) CH_ADMIN.updated(u, at, on); }
    function refresh() {
      S.done = 0; S.tries = null; S.after = false; say(err, '');
      var rg = range(), q = M ? M.get('quickbooks', cred.key) : null, copy = q && q.data && sameRange(q.data.range, rg) ? q.data : null;
      if (copy && !S.r) { S.r = copy; draw(); }
      body.setAttribute('aria-busy', 'true'); busyLine(true, copy && copy.at);
      var ask = copy && typeof copy.rev === 'string' ? Object.assign({ since: copy.rev }, rg) : rg;
      return readQb(ask).then(function (r) {
        if (r && r.ok && r.unchanged === true) r = (C.withCopy ? C.withCopy(r, copy, true) : null) || null;
        return r || readQb(rg); // not for this copy: read it in full
      }).then(function (r) {
        body.removeAttribute('aria-busy');
        if (!r.ok) { busyLine(false, null); say(err, r.error || 'The Sheet refused.'); return; }
        if (M) M.put('quickbooks', cred.key, r);
        S.r = r; draw(); busyLine(false, r.at);
      }).catch(function (e) { body.removeAttribute('aria-busy'); busyLine(false, S.r && S.r.at); say(err, 'Could not load the bills (' + (e.message || e) + ').'); });
    }

    function draw() {
      var r = S.r, files = r.files || [], rows = r.bills || [];
      var controls = el('div', { className: 'qb-controls' }, [
        el('div', { className: 'f' }, [el('label', { 'for': 'qb-from', text: 'From' }), anyDate(from)]),
        el('div', { className: 'f' }, [el('label', { 'for': 'qb-to', text: 'To' }), anyDate(to)]),
        el('label', { className: 'check', 'for': 'qb-include' }, [inc, el('span', { text: 'Include deliveries I already exported' })]),
        el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Show', onclick: refresh }),
      ]);
      var kids = [controls];
      if (inc.checked) kids.push(el('div', { className: 'notice warn' }, [icon('triangle-alert', 20), el('div', { className: 'notice-body' }, [
        el('span', { className: 'notice-title', text: 'These may already be in QuickBooks.' }),
        el('span', { text: 'Loading a bill again can make QuickBooks refuse it or keep two copies. The bill numbers are the same as before. Do this only if you took the first bills out of QuickBooks.' })])]));
      if (r.suspended) kids.push(el('div', { className: 'notice info' }, [icon('info', 20), el('div', { className: 'notice-body' }, [el('span', { text: 'This company is paused. You can still export your own data.' })])]));
      // what is in the file
      var already = r.already_exported || { count: 0 };
      if (rows.length) {
        kids.push(el('p', { className: 'qb-sum' }, [el('b', { text: plural(rows.length, 'bill', 'bills') }), ' · total ', el('b', { text: money(r.total) }), ' · ' + rangeWords(r.range), files.length > 1 ? ' · ' + files.length + ' files of up to ' + r.max_bills + ' bills' : '']));
        var head = el('tr', {}, ['Bill no.', 'Date', 'Supplier', 'Ferment · farm', 'Amount'].map(function (h, i) { return el('th', { className: i === 4 ? 'n' : '', scope: 'col', text: h }); }));
        var shown = rows.slice(0, 200);
        kids.push(el('div', { className: 'table-wrap qb-preview', tabindex: '0', role: 'region', 'aria-label': 'Bills in this file' }, [el('table', { className: 'table' }, [el('thead', {}, [head]),
          el('tbody', {}, shown.map(function (b) {
            return el('tr', {}, [el('td', { className: 'id nw' }, [el('button', { type: 'button', className: 'btn btn-link qb-open', 'aria-label': 'Open delivery ' + b.intake_id + ' (bill ' + b.bill_no + ')', text: b.bill_no, disabled: midSet(), onclick: function () { if (!midSet()) openDelivery(b, fixed); } })]),
              el('td', { className: 'nw', text: dayShort(b.date) }), el('td', { text: b.supplier }),
              el('td', { text: (b.ferment ? 'Ferment ' + b.ferment : '') + (b.farm ? ' · ' + b.farm : '') }),
              el('td', { className: 'n', text: money(b.amount) }), b.exported ? el('td', { className: 'qb-was' }, [el('span', { className: 'badge warn', text: 'Exported ' + dayShort(String(b.exported.at).slice(0, 10)) })]) : null]);
          }))])]));
        if (rows.length > shown.length) kids.push(el('p', { className: 'hint', text: 'Showing the first ' + shown.length + ' of ' + rows.length + ' bills. The files hold all of them.' }));
      } else {
        kids.push(el('p', { className: 'qb-sum muted', text: already.count && !inc.checked ? 'Nothing new to export in this range.' : 'No paid deliveries in this range.' }));
      }
      var notes = [];
      if (already.count && !inc.checked) notes.push(plural(already.count, 'delivery', 'deliveries') + ' (' + money(already.total) + ') already exported before, not in this file');
      var lo = r.left_out || {};
      if (lo.own_beans) notes.push(plural(lo.own_beans, 'delivery', 'deliveries') + ' with nobody paid (your own beans)');
      if (notes.length) kids.push(el('div', { className: 'qb-left' }, [el('b', { text: 'Left out: ' }), notes.join(' · ') + '.']));
      // 1.22.2: deliveries someone was paid for that cannot be a bill yet: a short list, each with what is missing and a way to fix it here
      // why a paid delivery cannot be a bill: no amount; one that rounds to 0.00; a negative one; or one too large for a bill
      var words = function (x) {
        var n = x.amount === null || x.amount === undefined || x.amount === '' ? null : Number(x.amount);
        if (n === null || isNaN(n)) return ['no amount, or one that is not a plain number', 'No amount'];
        if (n < 0) return ['the amount is below 0', 'Amount below 0'];
        if (Math.round(n * 100) === 0) return ['the amount is 0', 'Amount is 0'];
        return ['the amount is too large for a bill', 'Amount too large'];
      };
      var fixes = ((lo.no_amount || {}).items || []).map(function (x) { var w = words(x); return Object.assign({}, x, { why: w[0], short: w[1] }); })
        .concat(((lo.no_date || {}).items || []).map(function (x) { return Object.assign({}, x, { why: 'no date', short: 'No date' }); }));
      var fixN = ((lo.no_amount || {}).count || 0) + ((lo.no_date || {}).count || 0);
      if (fixN) kids.push(el('section', { className: 'qb-fix', id: 'qb-fix', 'aria-labelledby': 'qb-fix-h' }, [
        el('h3', { id: 'qb-fix-h', text: plural(fixN, 'paid delivery is', 'paid deliveries are') + ' left out until fixed' }),
        el('ul', {}, fixes.map(function (x) {
          return el('li', { 'data-id': x.intake_id }, [
            el('span', { className: 'qb-fix-what' }, [el('b', { text: x.intake_id }), el('span', { text: [x.ferment ? 'Ferment ' + x.ferment : '', x.farm, x.supplier ? 'paid to ' + x.supplier : ''].filter(Boolean).join(' · ') })]),
            el('span', { className: 'badge warn', text: x.short }),
            el('button', { type: 'button', className: 'btn btn-secondary btn-sm', 'aria-label': 'Fix delivery ' + x.intake_id, text: 'Fix', disabled: midSet(), onclick: function () { if (!midSet()) openDelivery(x, fixed); } }),
          ]);
        }).concat(fixN > fixes.length ? [el('li', { className: 'qb-fix-more', text: 'and ' + (fixN - fixes.length) + ' more. Fix these and the rest will show.' })] : [])),
      ]));
      // 2.4.1: a delivery number on two rows, or exported before for another ferment: only a fix in the Sheet sorts it out
      if (lo.repeated && lo.repeated.count) kids.push(el('div', { className: 'notice warn qb-look', id: 'qb-look' }, [icon('triangle-alert', 20), el('div', { className: 'notice-body' }, [
        el('span', { className: 'notice-title', text: plural(lo.repeated.count, 'delivery needs', 'deliveries need') + ' a look in the Sheet, so ' + (lo.repeated.count === 1 ? 'it is' : 'they are') + ' left out.' }),
        el('ul', {}, lo.repeated.items.slice(0, 6).map(function (x) {
          return el('li', { text: x.why === 'other_ferment'
            ? 'Delivery ' + x.intake_id + ' on ferment ' + x.ferment + ': that number was exported before for ferment ' + x.exported_ferment + ' (bill ' + x.exported_bill + '). Give this delivery a new number in the Intakes tab.'
            : 'Delivery number ' + x.intake_id + ' is on more than one row (ferment ' + x.ferment + '). Give one of them a new number in the Intakes tab.' });
        }).concat(lo.repeated.count > 6 ? [el('li', { text: '…and ' + (lo.repeated.count - 6) + ' more.' })] : [])),
      ])]));
      // the button
      var total = files.length;
      var label = !total ? 'Download file' : total === 1 ? 'Download file' : S.done >= total ? 'All ' + total + ' files downloaded' : 'Download file ' + (S.done + 1) + ' of ' + total;
      var btn = el('button', { type: 'button', className: 'btn btn-primary', id: 'qb-download', disabled: !total || S.done >= total || S.busy }, [icon('download'), el('span', { text: S.busy ? 'Preparing…' : label })]);
      btn.addEventListener('click', download);
      kids.push(el('div', { className: 'actions qb-actions' }, [btn, total > 1 && S.done > 0 && S.done < total ? el('span', { className: 'hint', text: S.done + ' of ' + total + ' downloaded. Each one is marked as exported when you download it.' }) : null]));
      kids.push(err);
      kids.push(setupNote(r.settings, r.max_bills));
      // earlier exports
      if ((r.history || []).length) {
        kids.push(el('div', { className: 'qb-history' }, [el('h3', { text: 'Earlier exports' }), el('ul', {}, r.history.map(function (h) {
          return el('li', {}, [when(h.at) + ' · ' + h.by + ' · ' + plural(h.count, 'bill', 'bills') + ' · ', el('span', { className: 'mono', text: h.file })]);
        }))]));
      }
      body.replaceChildren.apply(body, kids);
      from.value = r.range.from; to.value = r.range.to; inc.checked = r.range.include_exported;
      anyDate(from); anyDate(to);
    }

    function download() {
      var r = S.r, f = r.files[S.done];
      if (!f || S.busy) return;
      S.busy = true; say(err, ''); draw();
      var sig = JSON.stringify([f.bills, r.range]);
      if (!S.tries || S.tries.sig !== sig) S.tries = { sig: sig, id: uuid() }; // the same ID again after a failed try, so it is marked once
      var req = { action: 'quickbooks_export', entry_id: S.tries.id, bills: f.bills, from: r.range.from, to: r.range.to, include_exported: r.range.include_exported, file_n: f.n, files_total: f.of, by: cred.by };
      ask(req).then(function (out) {
        if (out.ok && out.status === 'duplicate') return readQb({ export_id: S.tries.id }).then(function (again) { if (!again.ok) throw new Error(again.error); return { file: again.file, again: true, changed: again.changed || [], as_exported: again.as_exported }; });
        if (!out.ok) { var e = new Error(out.error || 'The export was refused.'); e.stale = !!out.stale; throw e; }
        return out;
      }).then(function (out) {
        saveFile(out.file.name, out.file.csv);
        toast('Saved ' + out.file.name + ' (' + plural(out.file.count, 'bill', 'bills') + ', ' + money(out.file.total) + ').');
        S.busy = false; S.tries = null; S.done++;
        // 2.4.1: a file given again is the one QuickBooks got; say which bills were changed in the Sheet since
        var later = out.again && out.changed && out.changed.length ? 'This is the file as it was exported. Changed in the Sheet since: ' + out.changed.map(function (c) { return c.bill_no + (c.now ? '' : ' (removed)'); }).join(', ') + '. Change ' + (out.changed.length === 1 ? 'that bill' : 'those bills') + ' in QuickBooks too.'
          : out.again && out.as_exported === false ? 'This file was made again from the Sheet as it is now: an export from before this version kept only the bill numbers.' : '';
        if (S.done >= r.files.length) return refresh().then(function () { if (later) say(err, later); }); // all done: what is left now
        draw();
        if (later) say(err, later);
      }).catch(function (e) {
        S.busy = false;
        say(err, (e.message || e) + (e.stale ? '' : ' Nothing was marked as exported unless you see a saved file.'));
        if (S.after && !midSet() && !e.stale) { S.after = false; refresh().then(function () { say(err, String(e.message || e)); }); return; }
        if (e.stale) refresh().then(function () { say(err, e.message); }); else draw();
      });
    }

  }

  /* ================= the settings section (Company page) =================
   * 1.22.2: read first, then Edit, like the page's other sections, and saved by the page's one Save bar: settings.js asks this
   * section what changed (CH_QB_SETTINGS.changes), sends it with the rest (save) and puts it back on Discard (reset). The stored
   * values and the `company_settings` action are unchanged. Currency is a choice over the same stored three-letter code ('' = none).
   */
  var CUR_CODES = ['XCD', 'USD']; // the Sheet's prices are in XCD; USD is the usual other one. Anything else: "Another currency"
  function settingsWidget(root) {
    root.className = 'set-sec qb-settings';
    root.setAttribute('aria-labelledby', 'qbs-title');
    var tries = {};
    function attempt(sig) { if (!tries.sig || tries.sig !== sig) tries = { sig: sig, id: uuid() }; return tries.id; }
    var F = {
      account: el('input', { type: 'text', id: 'qbs-account', maxlength: '60', autocomplete: 'off' }),
      tax: el('input', { type: 'text', id: 'qbs-tax', maxlength: '40', autocomplete: 'off', placeholder: 'None' }),
      date: el('select', { id: 'qbs-date' }),
      prefix: el('input', { type: 'text', id: 'qbs-prefix', maxlength: '10', autocomplete: 'off', autocapitalize: 'characters' }),
      one: el('input', { type: 'radio', name: 'qbs-cur', id: 'qbs-cur-one', value: 'one' }),
      many: el('input', { type: 'radio', name: 'qbs-cur', id: 'qbs-cur-many', value: 'many' }),
      code: el('select', { id: 'qbs-cur-code', 'aria-label': 'Bills are in' }),
      other: el('input', { type: 'text', id: 'qbs-cur-other', maxlength: '3', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'For example EUR', 'aria-label': 'Another currency: its three-letter code', hidden: true }),
    };
    CUR_CODES.forEach(function (c) { F.code.appendChild(el('option', { value: c, text: c })); });
    F.code.appendChild(el('option', { value: '', text: 'Another currency…' }));
    ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].forEach(function (f) { F.date.appendChild(el('option', { value: f, text: f + '   e.g. ' + (DATE_EXAMPLE[f] || '').split(' (')[0] })); });
    /* 2.14.0: QuickBooks Desktop (see qbd-export.js): which QuickBooks, and one folded group per company file */
    var PRODUCTS = [['online', 'Online'], ['desktop', 'Desktop'], ['unsure', 'Not sure']];
    var MODES = [['ask', 'Not sure yet: leave it out'], ['home', 'In EC$ at a fixed rate'], ['foreign', 'In US$ with multi-currency: leave it out, we enter it by hand']];
    var NAME_TIP = 'Must match the name in QuickBooks letter for letter. If QuickBooks does not find an account with this name it creates a new bank account with it.';
    var DATES = [['MM/DD/YYYY', 'MM/DD/YYYY (month first)'], ['DD/MM/YYYY', 'DD/MM/YYYY (day first)']];
    var QBD_GROUPS = [
      ['Grenada company file (EC$)', 'qbds-gd', [['qbd_gd_bank', 'Bank account checks are written from'], ['qbd_gd_cash', 'Account for payments with no check number (optional)'], ['qbd_gd_beans_account', 'Account for cocoa bean purchases'],
        ['qbd_gd_deposit_account', 'Where local sales money is held until banked'], ['qbd_gd_sales_customer', 'Customer name for local sales'], ['qbd_gd_sales_item', 'Item for local sales'], ['qbd_gd_sales_income', 'Income account for local sales'],
        ['qbd_gd_invoice_mode', 'How do the Grenada books hold the US$ pallet invoice?', MODES], ['qbd_gd_rate', 'EC$ for one US$'], ['qbd_gd_us_customer', 'The US company\'s customer name'], ['qbd_gd_ar', 'Accounts receivable account'],
        ['qbd_gd_export_item', 'Item for nibs'], ['qbd_gd_export_income', 'Income account for nibs'], ['qbd_gd_other_item', 'Item for other invoice lines'], ['qbd_gd_other_income', 'Income account for other invoice lines'],
        ['qbd_gd_class', 'Class (optional)'], ['qbd_gd_date_format', 'Date format', DATES]]],
      ['US company file (US$)', 'qbds-us', [['qbd_us_vendor', 'The Grenada company\'s vendor name'], ['qbd_us_ap', 'Accounts payable account'], ['qbd_us_purchase_account', 'Account for nib purchases'],
        ['qbd_us_other_account', 'Account for freight and other lines'], ['qbd_us_class', 'Class (optional)'], ['qbd_us_date_format', 'Date format', DATES]]],
    ];
    var Q = {}, qbdCur = null, qbdWords = {};
    PRODUCTS.forEach(function (p) { Q['qb_product_' + p[0]] = el('input', { type: 'radio', name: 'qbs-product', id: 'qbs-product-' + p[0], value: p[0] }); });
    var qbdFields = QBD_GROUPS.map(function (g) {
      return el('details', { className: 'qb-group qbd-group', id: g[1] }, [el('summary', { text: g[0] }), el('div', { className: 'fields' }, g[2].map(function (f) {
        var id = 'qbds-' + f[0].replace(/^qbd_/, '').replace(/_/g, '-');
        qbdWords[f[0]] = f[1];
        Q[f[0]] = f[2] ? el('select', { id: id }, f[2].map(function (o) { return el('option', { value: o[0], text: o[1] }); })) : el('input', { type: 'text', id: id, maxlength: f[0] === 'qbd_gd_rate' ? '9' : '60', autocomplete: 'off', inputmode: f[0] === 'qbd_gd_rate' ? 'decimal' : null });
        var tip = !f[2] && f[0] !== 'qbd_gd_rate' && window.CH_ADMIN && CH_ADMIN.infoTip ? CH_ADMIN.infoTip(f[1], NAME_TIP) : null;
        return el('div', { className: 'f' }, [el('label', { 'for': id }, [f[1], tip]), Q[f[0]]]);
      }))]);
    });
    var err = el('p', { className: 'err', role: 'alert', id: 'qbs-err', hidden: true });
    var editBtn = el('button', { type: 'button', className: 'btn btn-secondary btn-sm sec-edit', id: 'qbs-edit', 'aria-controls': 'qbs-fields', 'aria-expanded': 'false', text: 'Edit' });
    var read = el('dl', { className: 'sec-read', id: 'qbs-read' });
    var inBills = el('div', { className: 'f qb-cur-in', id: 'qbs-cur-in', hidden: true }, [el('label', { 'for': 'qbs-cur-code', text: 'Bills are in' }), F.code, F.other, el('span', { className: 'hint', text: 'The one currency your bean payments are recorded in. Adds a Currency column to every bill.' })]);
    var group = function (title, kids) { return el('fieldset', { className: 'qb-group' }, [el('legend', { text: title })].concat(kids)); };
    var fields = el('div', { className: 'sec-fields', id: 'qbs-fields', hidden: true }, [
      group('Which QuickBooks do you use?', PRODUCTS.map(function (p) { return el('label', { className: 'check', 'for': 'qbs-product-' + p[0] }, [Q['qb_product_' + p[0]], el('span', { text: p[1] })]); })
        .concat([el('span', { className: 'hint', text: 'Online: the bills file. Desktop: the IIF files, one per company. Not sure: both show. Import only one of them into the same books.' })])),
      group('In QuickBooks', [el('div', { className: 'fields' }, [
        el('div', { className: 'f' }, [el('label', { 'for': 'qbs-account', text: 'Expense account' }), F.account, el('span', { className: 'hint', text: 'Must already exist in QuickBooks.' })]),
        el('div', { className: 'f' }, [el('label', { 'for': 'qbs-tax', text: 'Tax code' }), F.tax, el('span', { className: 'hint', text: 'As named in QuickBooks, for example Out of scope.' })]),
      ])]),
      group('The file', [el('div', { className: 'fields' }, [
        el('div', { className: 'f' }, [el('label', { 'for': 'qbs-date', text: 'Date format' }), F.date, el('span', { className: 'hint', text: 'The same one you pick when you import.' })]),
        el('div', { className: 'f' }, [el('label', { 'for': 'qbs-prefix' }, ['Bill number prefix', window.CH_ADMIN && CH_ADMIN.infoTip ? CH_ADMIN.infoTip('Bill number prefix', 'A few letters, such as your initials, in front of every bill so you can tell them apart in QuickBooks. After the dash comes the delivery\'s ID: the app numbers deliveries I001, I002 and so on (I is for intake). Changing the letters later is safe: bills already exported keep their numbers.') : null]), F.prefix, el('span', { className: 'hint', id: 'qbs-prefix-hint', text: '' })]),
      ])]),
      group('Currency', [
        el('label', { className: 'check', 'for': 'qbs-cur-one' }, [F.one, el('span', { text: 'QuickBooks uses one currency' })]),
        el('label', { className: 'check', 'for': 'qbs-cur-many' }, [F.many, el('span', { text: 'QuickBooks uses several currencies' })]),
        inBills,
      ]),
      group('QuickBooks Desktop files', qbdFields.concat([el('p', { className: 'hint' }, ['What these mean, on one page: ', el('a', { href: 'qb-accountant.html', text: 'For your accountant' }), '.'])])),
    ]);
    var form = el('form', { id: 'qbs-form', novalidate: '' }, [
      el('div', { className: 'sec-head' }, [el('h2', { id: 'qbs-title', text: 'QuickBooks export' }), editBtn]),
      el('p', { className: 'sec-sub', text: 'Which QuickBooks you use, and the names its files use.' }),
      read, el('div', { id: 'qbds-read' }), fields, err,
      el('p', { className: 'how' }, [el('a', { href: 'help.html#quickbooks', text: 'How the QuickBooks export works' })]),
    ]);
    root.replaceChildren(form);
    root.hidden = false;
    var cur = null, isEditing = false;
    function host() { if (window.CH_QB_HOST && CH_QB_HOST.changed) CH_QB_HOST.changed(); }
    function curValue() { return F.one.checked ? '' : (F.code.value || F.other.value.trim().toUpperCase()); }
    function curDraw() { inBills.hidden = !F.many.checked; F.other.hidden = !!F.code.value; }
    function curSet(v) {
      F.one.checked = !v; F.many.checked = !!v;
      if (!v) { F.code.value = CUR_CODES[0]; F.other.value = ''; } // several: starts at the currency the Sheet's prices are in
      else if (CUR_CODES.indexOf(v) >= 0) { F.code.value = v; F.other.value = ''; }
      else { F.code.value = ''; F.other.value = v; }
      curDraw();
    }
    function editing(on) {
      isEditing = on;
      read.hidden = on; fields.hidden = !on; var qr = form.querySelector('#qbds-read'); if (qr) qr.hidden = on; // 2.14.0
      editBtn.textContent = on ? 'Cancel' : 'Edit';
      editBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
      editBtn.setAttribute('aria-label', (on ? 'Cancel changes to the ' : 'Edit the ') + 'QuickBooks export settings');
      root.classList.toggle('is-editing', on);
    }
    editBtn.addEventListener('click', function () {
      say(err, '');
      if (isEditing) { if (cur) fill(cur); editing(false); host(); editBtn.focus(); return; }
      editing(true); F.account.focus();
    });
    form.addEventListener('input', function () { curDraw(); host(); });
    form.addEventListener('change', function () { curDraw(); if (F.many.checked && !F.code.value && document.activeElement === F.code) F.other.focus(); host(); });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); if (window.CH_QB_HOST && CH_QB_HOST.save) CH_QB_HOST.save(); });

    function fill(r) {
      cur = r;
      if (r.qbd && r.qbd.settings) qbdCur = r.qbd.settings;
      qbdFill();
      var s = r.settings;
      F.account.value = s.account; F.tax.value = s.tax_code; F.date.value = s.date_format; F.prefix.value = s.bill_prefix; curSet(s.currency || '');
      var prefixHint = function () { var v = F.prefix.value.trim() || s.bill_prefix; $('qbs-prefix-hint').textContent = 'Bills read ' + v + '-I012: these letters, then the delivery\'s ID.'; }; // 2026-11-21: one short line; the (i) beside the label says the rest
      prefixHint(); F.prefix.oninput = prefixHint; // 2026-11-21: say what the letters are for, and that I012 is a delivery ID (a letter I), not a number
      read.replaceChildren.apply(read, [['Expense account', s.account], ['Tax code', s.tax_code], ['Date format', s.date_format], ['Bill number prefix', s.bill_prefix],
        ['Currency', s.currency ? 'Several in QuickBooks · bills in ' + s.currency : 'One currency in QuickBooks']].map(function (kv) {
        var dd = el('dd', { text: kv[1] || '' });
        if (!kv[1] && window.CH_ADMIN) CH_ADMIN.none(dd);
        return el('div', {}, [el('dt', { text: kv[0] }), dd]);
      }));
      Array.prototype.forEach.call(form.querySelectorAll('input,select,button'), function (n) { n.disabled = !!r.suspended; });
      if (r.suspended) say(err, (r.company && r.company.name || 'This company') + ' is paused, so settings cannot change now.');
    }
    /** 2.14.0: the Desktop part: its boxes and its read view from what the Sheet holds. */
    function qbdFill() {
      var box = read.parentNode ? read.parentNode.querySelector('#qbds-read') : null;
      if (!qbdCur) { if (box) box.replaceChildren(); return; }
      PRODUCTS.forEach(function (p) { Q['qb_product_' + p[0]].checked = qbdCur.qb_product === p[0]; });
      Object.keys(qbdWords).forEach(function (k) { Q[k].value = qbdCur[k] || ''; });
      var row = function (k, v) { var dd = el('dd', { text: v || '' }); if (!v && window.CH_ADMIN) CH_ADMIN.none(dd); return el('div', {}, [el('dt', { text: k }), dd]); };
      var mode = MODES.filter(function (m) { return m[0] === qbdCur.qbd_gd_invoice_mode; })[0];
      if (box) box.replaceChildren(el('dl', { className: 'sec-read', id: 'qbds-read-dl' }, [row('Which QuickBooks', (PRODUCTS.filter(function (p) { return p[0] === qbdCur.qb_product; })[0] || [0, qbdCur.qb_product])[1]),
        row('Desktop, Grenada file', [qbdCur.qbd_gd_bank, qbdCur.qbd_gd_beans_account, qbdCur.qbd_gd_deposit_account].join(' · ')), row('Pallet invoice in the Grenada file', mode ? mode[1] : qbdCur.qbd_gd_invoice_mode),
        row('Desktop, US file: the Grenada company', qbdCur.qbd_us_vendor), row('Desktop, Grenada file: the US company', qbdCur.qbd_gd_us_customer)]));
    }
    function qbdChanges() {
      if (!qbdCur) return [];
      var out = [], pv = (PRODUCTS.filter(function (p) { return Q['qb_product_' + p[0]].checked; })[0] || [qbdCur.qb_product])[0];
      if (pv !== qbdCur.qb_product) out.push({ key: 'qb_product', from: qbdCur.qb_product, value: pv });
      Object.keys(qbdWords).forEach(function (k) { var v = Q[k].value.trim(); if (v !== (qbdCur[k] || '')) out.push({ key: k, from: qbdCur[k] || '', value: v }); });
      return out;
    }
    /** What differs from what the Sheet holds: [{key, from, value}], as `company_settings` takes them. */
    function changes() {
      if (!cur || cur.suspended) return [];
      var s = cur.settings;
      var now = { qb_account: F.account.value.trim(), qb_tax_code: F.tax.value.trim(), qb_date_format: F.date.value, qb_bill_prefix: F.prefix.value.trim(), qb_currency: curValue() };
      var was = { qb_account: s.account, qb_tax_code: s.tax_code, qb_date_format: s.date_format, qb_bill_prefix: s.bill_prefix, qb_currency: s.currency || '' };
      return Object.keys(now).filter(function (k) { return now[k] !== was[k]; }).map(function (k) { return { key: k, from: was[k], value: now[k] }; }).concat(qbdChanges());
    }
    /** Something the page can see is wrong before sending: [words, the box to go to], or null. */
    function problem() {
      if (F.many.checked && !F.code.value && !/^[A-Za-z]{3}$/.test(F.other.value.trim())) return ['Type the three-letter code of the currency your bills are in, such as EUR.', F.other];
      if (qbdCur && !/^\d+(\.\d{1,4})?$/.test(Q.qbd_gd_rate.value.trim())) { Q.qbd_gd_rate.closest('details').open = true; return ['EC$ for one US$ is a plain number, like 2.70.', Q.qbd_gd_rate]; }
      return null;
    }
    var firstLook = C.qbFirst || null; // 2.5.0: the Settings page already asked for it (settings.js; 2.7.1: in its settings answer); only once
    if (C.qbCopy && C.qbCopy.ok) fill(C.qbCopy); // 2.7.1: the Settings page's kept copy, at once
    function pull() {
      var got = firstLook ? firstLook.then(function (r) { return r && r.ok ? r : readQb({}); }) : readQb({});
      firstLook = null;
      return got.then(function (r) { if (!r.ok) { say(err, r.error || 'Could not load the QuickBooks settings.'); return; } fill(r); host(); }).catch(function (e) { say(err, 'Could not load the QuickBooks settings (' + (e.message || e) + ').'); });
    }
    /** Sends the changes (the page's Save bar calls this). Resolves with the words to show; a refusal is said here too. */
    function save(list, extra) { // extra (1.24.3, the Settings page's last request): {read_after: 'settings', onAnswer(r)}
      say(err, '');
      var body = { action: 'company_settings', entry_id: attempt(JSON.stringify(list)), changes: list, by: cred.by };
      if (extra && extra.read_after) body.read_after = extra.read_after;
      return ask(body).then(function (r) {
        if (!r.ok) { say(err, r.error || 'Could not save.'); editing(true); if (r.stale) pull(); var no = new Error(r.error || 'Could not save the QuickBooks settings.'); no.refused = !r.retry; throw no; } // refused (1.24.3 review): the server said no, so the Settings page reads what is saved
        tries = {}; editing(false);
        if (extra && extra.onAnswer) extra.onAnswer(r);
        // 1.24.3 (script 2.7.4): the fresh values came in the save's own answer, so no second request
        var st = r.read_after, q = st && st.ok && st.qb && st.qb.settings ? { ok: true, settings: st.qb.settings, defaults: st.qb.defaults, max_bills: st.qb.max_bills, date_formats: st.qb.date_formats, suspended: st.suspended, company: st.company, qbd: st.qbd } : null; // 2.14.0: qbd
        if (q) { fill(q); host(); return 'Saved the QuickBooks settings.'; }
        return pull().then(function () { return 'Saved the QuickBooks settings.'; });
      });
    }
    window.CH_QB_SETTINGS = { changes: changes, problem: function () { var p = problem(); if (p) { editing(true); say(err, p[0]); p[1].focus(); } return p; }, save: save,
      reset: function () { say(err, ''); if (cur) fill(cur); editing(false); }, reload: pull };
    pull();
  }

  /* ================= start ================= */
  function start() {
    if (!cred.url || !cred.key) return; // not signed in: the page shows its own sign-in
    if (!cred.session) { // an admin link: the script refuses; say how to get in instead of a broken card
      [mountExport, mountSettings].forEach(function (m) {
        if (!m) return;
        m.className = 'card qb-card'; m.hidden = false;
        m.replaceChildren(el('div', { className: 'card-head' }, [el('div', {}, [el('h2', { text: 'QuickBooks' }),
          el('p', { className: 'card-sub', text: 'Sign in with your own email and password to export for QuickBooks. The shared admin link cannot.' })])]),
          el('div', { className: 'actions' }, [el('a', { className: 'btn btn-secondary', href: 'signin.html?next=' + (mountExport ? 'exports.html' : 'settings.html'), text: 'Sign in' })]));
      });
      return;
    }
    if (mountExport) exportWidget(mountExport);
    if (mountSettings) settingsWidget(mountSettings);
  }
  start();
})();
