/*
 * Scan a paper form (P4-B part 2), behind a switch. An admin picks the form (its name is printed at the top of the paper),
 * takes or chooses a photo, and presses Read it. The photo is made smaller here (CH_PHOTOS.shrink, 2000 px, at most 4 MB)
 * and sent with the form's questions, as schema.js has them for this company, to the script (action scan_read), which asks
 * the reading service and checks every suggestion with our own rules. The answer becomes a scan "Waiting for a look" on this
 * device (localStorage "ch.scans": the suggestions only; the photo in its own database, CH_PHOTOS.scans). "Look and save"
 * opens the normal form in the field app (index.html#/form/<form>?__scan=<id>) in paper mode, filled in, with every unsure
 * answer left empty and marked Needs a look beside the photo; saving it is an ordinary entry. Nothing reaches the records here.
 *
 * Code.gs decides who may read (a named admin signed in with their own password) and whether scanning is on (read settings:
 * scan). Off: this page shows one line and nothing else. Every word from the reader goes on the page as text, never as markup.
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {}, A = window.CH_ADMIN || {}, ui = A.ui, P = window.CH_PHOTOS, CH = window.CH;
  var $ = function (id) { return document.getElementById(id); };
  var el = ui.el;
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }

  var adm = load('ch.admin', null);
  if (!adm || !adm.url || !adm.key || !adm.session) { if (window.CH_SIGNIN) CH_SIGNIN.show(); return; } // a named admin's sign-in only (the server checks it too)
  function ask(body) {
    body.key = adm.key;
    return C.ask(adm.url, body).then(function (r) { return r.text(); }).then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('The Sheet sent back something unexpected.'); }
      return window.CH_SIGNIN ? CH_SIGNIN.guard(j) : j;
    });
  }

  /* ---------- the scans waiting on this device ---------- */
  var KEY = 'ch.scans', MAX_WAITING = 30, TYPES = ['text', 'textarea', 'number', 'choice', 'chips', 'yesno', 'date', 'time', 'ferment', 'ref', 'temps', 'buckets'];
  function mine() { return String(adm.id || ''); }
  function all() { var v = load(KEY, []); return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object' && typeof x.id === 'string'; }) : []; }
  function waiting() { return all().filter(function (x) { return String(x.by || '') === mine(); }); }
  function put(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }

  /* ---------- the form's questions, as printed (CH.paperFields), for the reader ---------- */
  var LISTS = {};
  function listOf(name) { return (LISTS[name] && LISTS[name].length ? LISTS[name] : CH.DEFAULT_LISTS[name]) || []; }
  /** [{key, n, label, type, options (as printed), …}] and, per question, printed option → saved value (optionLabels). */
  function questions(form) {
    var out = [], back = {};
    CH.paperFields(form).forEach(function (q) {
      var f = q.field;
      if (!q.n || TYPES.indexOf(f.type) < 0) return; // a list of deliveries is left for the admin to type
      var opts = f.type === 'yesno' ? ['Yes', 'No'] : f.type === 'choice' || f.type === 'chips' ? (f.options ? CH.optionsOf(f) : listOf(f.list)) : [];
      var map = {};
      var printed = opts.map(function (o) { var l = (f.optionLabels && f.optionLabels[o]) || o; map[l] = o; return l; });
      var x = { key: f.key, n: q.n, label: f.label, type: f.type, required: !!f.required && !f.showIf && !f.requiredIf };
      if (printed.length) x.options = printed.slice(0, 80);
      if (f.unit) x.unit = f.unit;
      if (typeof f.min === 'number') x.min = f.min;
      if (typeof f.max === 'number') x.max = f.max;
      if (f.of) x.of = f.of;
      if (f.multiple) x.multiple = true;
      if (f.paperNote) x.note = f.paperNote; // review L3: printed beside the label; never part of an answer
      if (f.type === 'text' && (f.pattern || /^next/.test(String(f.default || '')))) x.new_id = true; // review M1: a new ID (Ferment ID, Batch): always left for a person
      out.push(x);
      back[f.key] = map;
    });
    return { fields: out, back: back };
  }
  /** The script's answers, with each printed choice turned back into the value the form saves ("Move to next box" → Turn). */
  function tidy(answers, back) {
    return (Array.isArray(answers) ? answers : []).filter(function (a) { return a && typeof a.key === 'string'; }).map(function (a) {
      var m = back[a.key] || {}, v = a.value;
      var one = function (x) { return Object.prototype.hasOwnProperty.call(m, x) ? m[x] : x; };
      v = Array.isArray(v) ? v.map(function (x) { return one(String(x)); }) : v === null || v === undefined ? '' : one(String(v));
      return { key: a.key, value: v, read: String(a.read === undefined || a.read === null ? '' : a.read).slice(0, 300), unsure: a.unsure === true, why: typeof a.why === 'string' ? a.why.slice(0, 30) : '' };
    });
  }

  /* ---------- the page ---------- */
  var S = { photo: null, busy: false };
  function forms() { return CH.FORMS.filter(function (f) { return !CH.formOn || CH.formOn(f); }); }
  function drawForms() {
    var sel = $('scan-form');
    sel.replaceChildren(new Option('Choose a form', ''));
    forms().forEach(function (f) { sel.appendChild(new Option(f.title, f.id)); });
  }
  function ready() { $('scan-read').disabled = S.busy || !S.photo || !$('scan-form').value; }
  function status(t) { $('scan-status').textContent = t || ''; }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

  function drawWaiting() {
    var list = $('scan-list'), items = waiting().slice().sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    list.replaceChildren();
    $('scan-none').hidden = !!items.length;
    items.forEach(function (it) {
      var form = CH.formById(it.form), look = (it.answers || []).filter(function (a) { return a.unsure; }).length;
      var li = el('li', { className: 'scan-item', 'data-id': it.id });
      var confirmBox = el('div', { className: 'scan-confirm', hidden: true }, [
        el('span', { text: 'Throw this scan away? Its photo goes too. Nothing was saved from it.' }),
        el('button', { type: 'button', className: 'btn btn-danger', text: 'Throw away', onclick: function () { drop(it.id); } }),
        el('button', { type: 'button', className: 'btn btn-secondary', text: 'Keep it', onclick: function () { confirmBox.hidden = true; } }),
      ]);
      li.appendChild(el('div', { className: 'scan-what' }, [
        el('b', { text: form ? form.title : it.title || it.form }),
        el('span', { className: 'meta', text: when(it.at) }),
        look ? ui.pill('warn', look + (look === 1 ? ' needs a look' : ' need a look')) : ui.pill('info', 'Check every answer'),
      ]));
      li.appendChild(el('div', { className: 'scan-acts' }, [
        el('a', { className: 'btn btn-primary', href: './#/form/' + encodeURIComponent(it.form) + '?__scan=' + encodeURIComponent(it.id), text: 'Look and save' }),
        el('button', { type: 'button', className: 'btn btn-secondary', text: 'Throw away…', onclick: function () { confirmBox.hidden = false; } }),
      ]));
      li.appendChild(confirmBox);
      list.appendChild(li);
    });
  }
  function drop(id) {
    put(all().filter(function (x) { return x.id !== id; }));
    if (P && P.scans) P.scans.drop(id).catch(function () {});
    drawWaiting();
    ui.toast('Scan thrown away.');
  }

  function pick(file) {
    S.photo = null; ready();
    $('scan-thumb').hidden = true;
    if (!file) return;
    status('Making the photo smaller…');
    P.shrink(file, { side: 2000, maxBytes: 4000000 }).then(function (blob) {
      S.photo = blob;
      return P.base64(blob).then(function (b) { $('scan-thumb').src = 'data:image/jpeg;base64,' + b; $('scan-thumb').hidden = false; status(''); ready(); });
    }).catch(function (e) { status((e && e.message) || 'This photo could not be read. Try again.'); });
  }

  function read() {
    var form = CH.formById($('scan-form').value);
    if (!form || !S.photo || S.busy) return;
    if (waiting().length >= MAX_WAITING) { status(MAX_WAITING + ' scans are waiting for a look. Look at those first.'); return; }
    var q = questions(form);
    if (!q.fields.length) { status('This form has no questions that can be read from a photo. Type it in.'); return; }
    S.busy = true; ready(); status('Reading the form… this can take half a minute.');
    var blob = S.photo;
    P.base64(blob).then(function (image) {
      return ask({ action: 'scan_read', form: form.id, title: form.title, fields: q.fields, image: image });
    }).then(function (p) {
      if (!p || !p.ok) throw new Error((p && p.error) || 'The Sheet refused the request.');
      var item = { id: uuid(), form: form.id, title: form.title, at: new Date().toISOString(), by: mine(), answers: tidy(p.answers, q.back) };
      return P.scans.keep(item.id, blob).then(function () {
        if (!put(all().concat([item]))) { P.scans.drop(item.id).catch(function () {}); throw new Error('This device has no room to keep the scan.'); }
        return item;
      });
    }).then(function (item) {
      S.busy = false; S.photo = null;
      $('scan-photo').value = ''; $('scan-thumb').hidden = true;
      var look = item.answers.filter(function (a) { return a.unsure; }).length;
      status('Read. ' + (look ? look + (look === 1 ? ' answer needs a look.' : ' answers need a look.') : 'Check every answer before saving.'));
      ready(); drawWaiting();
    }).catch(function (e) {
      S.busy = false; ready();
      status((e && e.message) || 'Could not read the form. Try again, or type it in.');
    });
  }

  /**
   * Review nit: scans of another admin sign-in on this browser (someone who signed out and never came back) are tidied away,
   * with their photos, 30 days after they were read. Your own scans stay until you save or throw them away.
   */
  function tidyOthers() {
    var cut = Date.now() - 30 * 864e5, keep = [], gone = [];
    all().forEach(function (x) { var t = Date.parse(x.at); if (String(x.by || '') !== mine() && (!(t > cut))) gone.push(x.id); else keep.push(x); });
    if (!gone.length) return;
    if (put(keep) && P && P.scans) gone.forEach(function (id) { P.scans.drop(id).catch(function () {}); });
  }
  function start() {
    tidyOthers();
    $('loading').replaceChildren(ui.skeleton('lines', 3));
    ask({ action: 'read', what: 'settings' }).then(function (p) {
      if (!p || !p.ok) throw new Error((p && p.error) || 'The Sheet refused the request.');
      if (p.company && C.setCompany) C.setCompany(p.company);
      if (A.navScan) A.navScan(p.scan === true);
      if (p.scan !== true) { $('loading').replaceChildren(); $('scan-off').hidden = false; return null; } // switched off: nothing else on the page
      return ask({ action: 'read', what: 'lists' }).then(function (l) {
        LISTS = (l && l.ok && l.lists) || {};
        $('loading').replaceChildren(); $('main').hidden = false;
        $('scan-where').textContent = 'The photo is sent to a reading service outside ' + ((C.brand && C.brand.company) || 'the company') + ' to be read. Nothing reaches the records until you save.';
        drawForms(); drawWaiting(); ready();
      });
    }).catch(function (e) {
      $('loading').replaceChildren();
      $('problem').hidden = false;
      $('problem-text').textContent = 'Could not open scanning (' + ((e && e.message) || e) + '). Check the internet connection and reload the page.';
    });
  }
  $('scan-form').addEventListener('change', ready);
  $('scan-photo').addEventListener('change', function () { pick(this.files && this.files[0]); });
  $('scan-read').addEventListener('click', read);
  window.addEventListener('storage', function (ev) { if (ev.key === KEY) drawWaiting(); }); // saved in the field app in another tab
  window.addEventListener('pageshow', function () { if (!$('main').hidden) drawWaiting(); });
  start();
})();
