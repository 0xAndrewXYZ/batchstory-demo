/*
 * Settings page (2.1.0, admins who signed in): the company's name, short name, contact, logo, area names and "ship to"
 * place; My profile (your name, your email with your password, sign out everywhere else); and who changed what.
 * The script checks every change (a signed-in named admin, never the shared admin link), records it in Raw log first,
 * and refuses anything else. This page only asks. Names are only ever shown as text; the logo is a small picture made on
 * this computer (a square of at most 192 × 192 pixels, as a data: address) and only ever shown as an <img>.
 */
(function () {
  'use strict';
  var PAGE_VERSION = '1.31.0'; // app.js APP_VERSION

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  var settings = load('ch.admin', {}) || {};
  var C = window.CH_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
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
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function icon(name, size) { return window.CH_ADMIN ? CH_ADMIN.icon(name, size) : null; }
  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.replaceChildren(icon('circle-check', 18), document.createTextNode(msg)); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 4000); }
  function say(node, text) { node.textContent = text || ''; node.hidden = !text; }
  function readJson(r) {
    return r.text().then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('No connection. Try again.'); }
      return window.CH_SIGNIN ? CH_SIGNIN.guard(j) : j; // "Please sign in again" shows the sign-in instead; also keeps the company's names
    });
  }
  function address() { return C.scriptFor ? C.scriptFor(settings.url) : settings.url; }
  function ask(body) { return fetch(address(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(readJson); }
  function get(what, extra) {
    var body = { key: settings.key, action: 'read', what: what };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return ask(body);
  }
  function post(body) { body.key = settings.key; body.by = settings.by || 'Admin'; return ask(body); }
  function day(iso) { var d = new Date(iso); return isNaN(d) ? '' : (window.CH_PAGE ? CH_PAGE.dayText(d) : d.toLocaleDateString()); }
  function dayTime(iso) { var d = new Date(iso); return isNaN(d) ? '' : day(iso) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

  /** One ID per thing being saved, the same again after a failed try (so pressing Save twice changes it once). */
  var tries = {};
  function attempt(name, sig) { if (!tries[name] || tries[name].sig !== sig) tries[name] = { id: uuid(), sig: sig }; return tries[name].id; }
  function done(name) { delete tries[name]; }

  var S = { data: null, busy: false, view: 'company', next: null, gen: 0 }; // gen (review): counts what was drawn, so an older read never draws over a newer one

  /* ---------- loading ---------- */
  function fetchAll() {
    if (!settings.url || !settings.key) { if (window.CH_SIGNIN) CH_SIGNIN.show(); return Promise.resolve(); }
    if (!settings.session) { $('named-only').hidden = false; $('main').hidden = true; return Promise.resolve(); } // an admin link: sign in instead
    var A = window.CH_ADMIN, M = A && A.memo;
    S.hist = false; // Who changed what is read again when its view is open (now or later: loadHistory)
    // 2.7.1: the page's shape at once, then the last copy (this sign-in's own), then the fresh answer in ONE request
    var q = !S.data && M ? M.get('settings', settings.key) : null;
    if (q && q.data && q.data.settings) { $('main').hidden = false; S.data = q.data; drawAll(); if (window.CH_SETTINGS_FORMS) CH_SETTINGS_FORMS.draw(q.data); }
    else if (!S.data) shape();
    if (A && A.updated) A.updated($('updated'), S.data && S.data.at, true); else $('updated').textContent = 'Loading…';
    var withHist = S.view === 'history';
    if (withHist) histCopy();
    var got = loadSettings(withHist), mine = S.gen; // review: if anything newer is drawn meanwhile (a save's answer), this read is dropped
    // 2.7.1: the QuickBooks card (qb-export.js) shows its settings from this one answer (and at once from the copy): qbCopy, qbFirst
    if (!C.qbFirst) {
      C.qbCopy = S.data ? qbPart(S.data) : null;
      C.qbFirst = got.then(function (st) { return st && st.ok ? qbPart(st) : null; }, function () { return null; });
    }
    return got.then(function (st) {
      if (mine !== S.gen) return; // review: a newer answer was drawn meanwhile
      if (!st.ok) { if (A && A.updated) A.updated($('updated'), null, false); $('main').hidden = true; if (/Sign in with your own/.test(st.error || '')) { $('named-only').hidden = false; return; } throw new Error(st.error || 'The Sheet refused.'); }
      if (S.busy) return; // 1.24.3: a save is on its way; its own answer brings the page's fresh read
      took(st);
      if (S.view === 'history' && !S.hist) loadHistory(); // 2.5.0 / slice 7: read only while it is open (2.7.1: read with the settings when the page opens on it)
    }).catch(function (err) {
      if (mine !== S.gen) return;
      if (A && A.updated) A.updated($('updated'), S.data && S.data.at, false); else $('updated').textContent = '';
      $('problem').hidden = false;
      $('problem-text').textContent = 'Could not load the settings (' + (err.message || err) + '). Check the internet connection and press Refresh.';
    });
  }

  /**
   * A fresh settings answer: kept as this sign-in's copy, then drawn. 1.24.3: also the read that comes inside a save's own
   * answer (read_after, script 2.7.4), so a save needs no second request.
   */
  function took(st) {
    keep(st);
    drawAll();
    if (window.CH_SETTINGS_FORMS) CH_SETTINGS_FORMS.draw(st); // 2.3.0: the "What you track" tab (settings-forms.js)
  }

  /** A fresh settings answer becomes what the page knows is saved (kept as this sign-in's copy); drawing is the caller's. */
  function keep(st) {
    var A = window.CH_ADMIN, M = A && A.memo;
    S.gen++;
    $('problem').hidden = true; $('main').hidden = false;
    S.data = st;
    if (M) M.put('settings', settings.key, st);
    if (st.company && C.setCompany) C.setCompany(st.company);
    if (A && A.navScan && typeof st.scan === 'boolean') A.navScan(st.scan); // P4-B/2: "Scan a form" in the sidebar only while scanning is on
    if (A && A.updated) A.updated($('updated'), st.at, false); else $('updated').textContent = 'Updated ' + new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * 2.7.1: ONE request. The settings alone, or (the page opened on "Who changed what") the settings and the history in one
   * bundle, with the history copy's "nothing changed" stamp. Until 2.7.1 this also asked for the QuickBooks card's first
   * look, which is on the Exports page now: the slowest part of the read, for nothing.
   * A script from before 2.7.1 refuses history in a bundle: then the settings alone, and the history on its own.
   */
  function loadSettings(withHist) {
    if (!withHist) return get('settings');
    var since = window.CH_ADMIN && CH_ADMIN.memo ? CH_ADMIN.memo.since('history', settings.key) : undefined;
    return get('bundle', since ? { parts: ['settings', 'history'], since: { history: since } } : { parts: ['settings', 'history'] }).then(function (j) {
      if (j && j.ok && j.parts && j.parts.settings) {
        var st = window.CH_SIGNIN ? CH_SIGNIN.guard(j.parts.settings) : j.parts.settings;
        if (st && st.ok) gotHistory(j.parts.history);
        return st;
      }
      if (j && !j.ok && /^(Unknown read|Say which reads)/.test(String(j.error || ''))) return get('settings'); // an older script (loadHistory follows)
      return j; // a refusal of the whole request (signed out, …)
    });
  }
  /** The QuickBooks card's part of a settings answer, shaped as read quickbooks answers it; null from a script before 2.7.1. */
  function qbPart(st) { return st && st.qb && st.qb.settings ? { ok: true, settings: st.qb.settings, defaults: st.qb.defaults, max_bills: st.qb.max_bills, date_formats: st.qb.date_formats, suspended: st.suspended, company: st.company, qbd: st.qbd } : null; } // 2.14.0: qbd, the Desktop settings
  /** 2.7.1: before the first read answers, the page's own shape: every heading, label and Edit button, with "…" for each value. */
  function shape() {
    $('main').hidden = false;
    var wait = function (id, labels) { $(id).replaceChildren.apply($(id), labels.map(function (l) { var dd = el('dd'); if (window.CH_ADMIN && CH_ADMIN.pending) CH_ADMIN.pending(dd); else dd.textContent = '…'; return el('div', {}, [el('dt', { text: l }), dd]); })); };
    wait('names-read', ['Company name', 'Short name', 'Support contact']);
    wait('words-read', ['Names', 'Ships to']);
    wait('season-read', ['Season']);
    wait('invoice-read', ['Price per lb', 'From', 'Bill to', 'Invoice numbers', 'Terms']); // P3-C
    wait('facts', ['Batchstory version', 'Connected to Batchstory HQ', 'Admins who can sign in']);
    if (window.CH_ADMIN && CH_ADMIN.pending) CH_ADMIN.pending($('logo-what'));
    $('logo-now').style.visibility = 'hidden'; // (no picture yet: not a broken one)
    Array.prototype.forEach.call(document.querySelectorAll('.settings-page .sec-edit, #logo-actions .btn, #logo-file'), function (n) { n.disabled = true; }); // nothing is changed before it is read
    $('logo-choose').classList.add('is-off');
  }

  function drawAll() {
    var d = S.data, st = d.settings;
    var paused = !!d.suspended;
    $('paused-banner').hidden = !paused;
    $('paused-title').textContent = (C.company || 'This company') + ' is paused by Batchstory.';
    Array.prototype.forEach.call(document.querySelectorAll('.settings-page form button[type=submit], #logo-actions .btn, #logo-file, .sec-edit'), function (n) { n.disabled = paused; }); // (cancelling your own email change works while paused)
    $('logo-choose').classList.toggle('is-off', paused);
    S.next = null; $('logo-pending').value = '';
    SECS.forEach(function (k) { FILL[k](); editing(k, false); say($(k + '-err'), ''); }); // 1.24.3: a fresh answer also clears a "Not saved" note
    say($('logo-err'), '');
    drawLogo();
    drawFacts();
    drawProfile();
    if (bar) { bar.saved(); barErr(''); bar.bar.querySelector('.btn-primary').disabled = paused; }
    if (S.toSection) { var t = S.toSection; S.toSection = ''; afterLoad(function () { toSection(t); }); } // a link to one section (Pick lists → Current season)
  }

  /* ---------- Company: each section is read first; Edit turns it into fields; one Save bar saves them all ---------- */
  var SECS = ['names', 'words', 'season', 'invoice'];
  var TITLE = { names: 'company details', words: 'work areas', season: 'current season', invoice: 'invoices', logo: 'logo', quickbooks: 'QuickBooks export' };
  function row(label, value, tip) { // tip: a short definition behind an (i) beside the label (admin.js infoTip)
    var dd = el('dd');
    if (value) dd.textContent = value; else if (window.CH_ADMIN && CH_ADMIN.none) CH_ADMIN.none(dd);
    return el('div', {}, [el('dt', {}, [label, tip && window.CH_ADMIN && CH_ADMIN.infoTip ? CH_ADMIN.infoTip(label, tip) : null]), dd]);
  }
  function rows(id, list) { $(id).replaceChildren.apply($(id), list.map(function (r) { return row(r[0], r[1], r[2]); })); }
  var FILL = {
    names: function () {
      var d = S.data, st = d.settings;
      $('s-company').value = st.company_name;
      $('s-company-hint').textContent = d.standard && d.standard.company_name && d.standard.company_name !== st.company_name ? 'Before it was changed here: ' + d.standard.company_name + '.' : '';
      $('s-short').value = st.short_name || '';
      // 2.7.2 / 1.24.0: the support contact is a person on People (their ID is kept, so a rename follows), or a typed name
      // ("Someone else…") for a person who is not on People yet. Phones only ever get the name.
      var sel = $('s-contact'), people = d.contacts || [], was = d.contact_was || null;
      // review I1: a saved person who can no longer be the contact (switched off, no email, gone) stays in the list, marked, and
      // stays selected, so the read view and the boxes agree and a save of anything else never clears them by accident
      var WHY = { off: 'switched off', no_email: 'no email', gone: 'no longer on People', name: 'cannot be shown' };
      var stale = was && was.id === st.contact_user ? el('option', { value: was.id, text: (was.name || was.id) + ' (' + (WHY[was.why] || 'not available') + ')' }) : null;
      sel.replaceChildren.apply(sel, people.map(function (p) { return el('option', { value: p.id, text: p.name }); }).concat([stale, el('option', { value: '', text: 'Someone else…' })].filter(Boolean)));
      var picked = st.contact_user && (stale || people.some(function (p) { return p.id === st.contact_user; })) ? st.contact_user : '';
      sel.value = picked;
      S.contactTouched = false; // only a choice the admin makes in this box is ever sent (pending)
      $('s-contact-other').hidden = !!picked;
      $('s-contact-other').value = st.contact_name || '';
      var shown = st.contact_shown || st.contact_name;
      $('s-contact-word').textContent = shown;
      rows('names-read', [['Company name', st.company_name], ['Short name', st.short_name || '', 'Shown on phones where the full name does not fit.'],
        ['Support contact', shown, 'The person the field app tells workers to ask, as in "Ask ' + shown + '". Only the name is shown.']]);
      if (stale) $('names-read').appendChild(el('p', { className: 'hint', id: 'contact-stale', text: (was.name || 'The person picked as support contact') + ' is ' + (WHY[was.why] || 'not available') + ', so workers are told to ask ' + shown + '. Press Edit to pick someone else.' }));
    },
    words: function () {
      var d = S.data, st = d.settings;
      ['fermentation', 'roasting', 'making'].forEach(function (a) {
        var i = $('s-area-' + a);
        i.value = st.areas[a] || '';
        i.placeholder = (d.standard && d.standard.areas && d.standard.areas[a]) || '';
      });
      // 1.24.4: "Ships to" (the ship_to setting) sits with the area names: it names where packages from roasting go
      $('s-ship').value = st.ship_to || '';
      $('s-ship-hint').textContent = shipTip(st.ship_to);
      rows('words-read', [['Names', ['fermentation', 'roasting', 'making'].map(function (a) { return st.areas[a] || (d.standard && d.standard.areas && d.standard.areas[a]) || ''; }).filter(Boolean).join(' · ')],
        ['Ships to', st.ship_to || '', shipTip(st.ship_to)]]);
    },
    season: function () {
      var cur = String(S.data.season || '');
      $('s-season').value = cur;
      rows('season-read', [['Season', cur]]);
      if (!cur) $('season-read').appendChild(el('p', { className: 'hint', text: 'Not set yet. Set it before the first new ferment of the season.' }));
    },
    invoice: function () { // P3-C: the invoice per pallet (Finances → Invoices); an older script sends none, and the section stays hidden
      var v = S.data.invoice;
      $('sec-invoice').hidden = !v;
      if (!v) return;
      INV_FIELDS.forEach(function (f) { $(f[1]).value = v[f[0]] || ''; });
      var prefix = v.invoice_prefix || 'INV';
      rows('invoice-read', [['Price per lb', v.invoice_price_usd ? 'US$ ' + v.invoice_price_usd : '', 'What the US company pays for a pound of nibs. Needed before an invoice can be made.'],
        ['From', v.invoice_from || ''], ['Bill to', v.invoice_bill_to || ''], ['Invoice numbers', prefix + '-0001, ' + prefix + '-0002…'], ['Terms', v.invoice_terms || '']]);
      if (!v.invoice_price_usd) $('invoice-read').appendChild(el('p', { className: 'hint', id: 'invoice-noprice', text: 'Set the price per lb before making the first invoice.' }));
    },
  };
  // P3-C: [setting key, box ID] of the Invoices section, in the order they are sent
  var INV_FIELDS = [['invoice_price_usd', 's-inv-price'], ['invoice_from', 's-inv-from'], ['invoice_bill_to', 's-inv-billto'], ['invoice_prefix', 's-inv-prefix'], ['invoice_terms', 's-inv-terms']];
  /** 1.24.4: what "Ships to" is for, in the place's own name (never a hard-coded one); as Inventory says it (dashboard.js placeWord). */
  function shipTip(place) {
    place = tidy(place);
    return 'Where packages from roasting are shipped, such as your chocolate factory. ' +
      (place ? 'Shown on package labels and as \'At ' + place + '\' in Inventory.' : 'When it is set, it is shown on package labels and as \'At …\' in Inventory.');
  }
  $('s-ship').addEventListener('input', function () { $('s-ship-hint').textContent = shipTip($('s-ship').value); }); // the hint follows what is typed
  var S_EDIT = {};
  function editing(k, on) {
    S_EDIT[k] = !!on;
    $(k + '-fields').hidden = !on; $(k + '-read').hidden = !!on;
    var b = $(k + '-edit');
    b.textContent = on ? 'Cancel' : 'Edit';
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
    b.setAttribute('aria-label', (on ? 'Cancel changes to the ' : 'Edit the ') + TITLE[k]);
    $(k + '-edit').closest('.set-sec').classList.toggle('is-editing', !!on);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.sec-edit'), function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-sec');
      if (!S.data) return;
      say($(k + '-err'), '');
      if (S_EDIT[k]) { FILL[k](); editing(k, false); if (bar) bar.check(); b.focus(); return; } // Cancel: this section back as it was
      editing(k, true);
      var first = $(k + '-fields').querySelector('input:not([hidden]), select');
      if (first) first.focus();
    });
  });
  function tidy(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
  function contactValue() { return tidy($('s-contact-other').value); } // the typed name: used when no person is picked, and kept underneath when one is
  $('s-contact').addEventListener('change', function () {
    S.contactTouched = true;
    var other = !$('s-contact').value;
    $('s-contact-other').hidden = !other;
    if (other) $('s-contact-other').focus();
  });

  /** What differs from what the page showed: [{part, ...}] in the order they are sent. Says what is wrong instead, if anything is. */
  function pending() {
    var d = S.data, st = d.settings, std = d.standard || {};
    var changes = [], parts = [], sections = [];
    var person = S.contactTouched ? $('s-contact').value : (st.contact_user || ''); // a User ID, or '' for a typed name; sent only when this box was changed by hand (review I1)
    var want = { company_name: tidy($('s-company').value), short_name: tidy($('s-short').value), contact_user: person, contact_name: person ? (st.contact_name || '') : contactValue() };
    if (!want.company_name) return { problem: ['names', 'Type the company\'s name.', $('s-company')] };
    if (!want.contact_name) return { problem: ['names', 'Pick the support contact, or type their name.', $('s-contact-other')] };
    Object.keys(want).forEach(function (k) { if (want[k] !== (st[k] || '')) changes.push({ key: k, from: st[k] || '', value: want[k] }); });
    if (changes.length) sections.push('names');
    var n = changes.length;
    ['fermentation', 'roasting', 'making'].forEach(function (a) {
      var v = tidy($('s-area-' + a).value), now = st.areas[a] || '';
      if (v === now || (!v && now === (std.areas || {})[a])) return; // empty = the standard name, which it already is
      changes.push({ key: 'area_' + a, from: now, value: v });
    });
    var ship = tidy($('s-ship').value); // 1.24.4: in Work areas (it was in Company details)
    if (ship !== (st.ship_to || '')) changes.push({ key: 'ship_to', from: st.ship_to || '', value: ship });
    if (changes.length > n) sections.push('words');
    var n2 = changes.length, inv = d.invoice; // P3-C: the Invoices section saves with the other settings, in the same company_settings
    if (inv) {
      for (var i = 0; i < INV_FIELDS.length; i++) {
        var k = INV_FIELDS[i][0], box = $(INV_FIELDS[i][1]), v = tidy(box.value).replace(/^US\$\s*/i, '');
        if (k === 'invoice_price_usd' && v && !(/^\d+(\.\d{1,4})?$/.test(v) && Number(v) > 0 && Number(v) <= 1000)) return { problem: ['invoice', 'The price per lb is a plain number of US$ more than 0 and at most 1000, like 30 or 30.25, or empty.', box] };
        if (k === 'invoice_prefix' && !/^[A-Za-z0-9_-]{1,10}$/.test(v)) return { problem: ['invoice', 'The invoice number prefix is 1 to 10 letters, numbers, - or _ (like INV).', box] };
        if (v !== (inv[k] || '')) changes.push({ key: k, from: inv[k] || '', value: v });
      }
    }
    if (changes.length > n2) sections.push('invoice');
    if (changes.length) parts.push({ part: 'settings', changes: changes, secs: sections.slice() }); // secs: the sections these changes are in (1.24.3: a refusal says so in each)
    if (S.next) { parts.push({ part: 'logo' }); sections.push('logo'); }
    var season = tidy($('s-season').value), cur = String(d.season || '');
    if (season !== cur) {
      if (!/^\d{1,3}$/.test(season)) return { problem: ['season', 'The season is a whole number, like 3.', $('s-season')] };
      parts.push({ part: 'season', value: season, from: cur }); sections.push('season');
    }
    var Q = window.CH_QB_SETTINGS, qc = Q ? Q.changes() : []; // 1.22.2: the QuickBooks export section saves with the rest
    if (qc.length) { parts.push({ part: 'quickbooks', changes: qc }); sections.push('quickbooks'); }
    return { parts: parts, sections: sections };
  }

  /* the one Save bar (CH_ADMIN.ui.dirtyBar), at the foot of the column so it stays in sight while any section has changes */
  var bar = null;
  function barErr(text) { if (!bar) return; var e = bar.bar.querySelector('.err'); say(e, text); }
  function barNote() {
    if (!bar || bar.bar.hidden || !S.data) return;
    var p = pending(), words = (p.sections || []).map(function (k) { return TITLE[k]; });
    bar.bar.firstChild.textContent = words.length ? 'Not saved yet: ' + words.join(', ') + '.' : 'You have unsaved changes.';
  }
  if (window.CH_ADMIN && CH_ADMIN.ui && CH_ADMIN.ui.dirtyBar) {
    bar = CH_ADMIN.ui.dirtyBar($('company-form'), { text: 'You have unsaved changes.', onSave: function () { saveAll(); }, onDiscard: function () {
      S.next = null; drawLogo(); SECS.forEach(function (k) { FILL[k](); editing(k, false); say($(k + '-err'), ''); }); if (window.CH_QB_SETTINGS) CH_QB_SETTINGS.reset(); qbPending(); barErr(''); bar.check();
    } });
    bar.bar.id = 'save-bar';
    bar.bar.querySelector('.btn-primary').id = 'company-save';
    bar.bar.querySelector('.btn-ghost').id = 'company-discard';
    bar.bar.appendChild(el('p', { className: 'err', role: 'alert', hidden: true }));
    $('set-col').appendChild(bar.bar);
    $('company-form').addEventListener('input', barNote); $('company-form').addEventListener('change', barNote);
  }
  /** The QuickBooks section (qb-export.js) says it changed: its changes go in a hidden box of this form, so the Save bar sees them. */
  function qbPending() { var Q = window.CH_QB_SETTINGS, c = Q ? Q.changes() : []; $('qb-pending').value = c.length ? JSON.stringify(c) : ''; if (bar) { bar.check(); barNote(); } }
  window.CH_QB_HOST = { changed: qbPending, save: function () { saveAll(); } };
  $('company-form').addEventListener('submit', function (ev) { ev.preventDefault(); saveAll(); });
  // Enter in a text field saves too (the Save button sits outside the form, in the bar, so the browser would not do it by itself)
  $('company-form').addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (ev.key !== 'Enter' || ev.isComposing || !t || t.tagName !== 'INPUT' || t.type === 'file') return;
    ev.preventDefault(); saveAll();
  });

  /**
   * Sends what changed: the settings (one request), then the logo, then the season. Each has its own ID, kept for a retry.
   * 1.24.3: the new values show in the sections at once, with a quiet "Saving…" in the bar; only the server's answer says
   * Saved. The last request asks for the page's fresh read in its own answer (read_after, script 2.7.4), so there is no
   * second request. If the server refuses, the page reads what really is saved now and shows it, each section not saved
   * says why, and the boxes keep what was typed (Edit shows it, Save tries again, Discard drops it). If the answer never
   * came (no connection, or the Sheet was busy), nothing claims either way: the sections say it may not have gone through,
   * and Save sends the same IDs again (a change that did go through answers duplicate, which counts as saved).
   */
  function saveAll() {
    if (S.busy || !S.data || S.data.suspended) return; // paused: nothing is saved (Enter skips the disabled button)
    SECS.concat(['logo']).forEach(function (k) { say($(k + '-err'), ''); });
    barErr('');
    var p = pending();
    if (p.problem) { var k = p.problem[0]; editing(k, true); say($(k + '-err'), p.problem[1]); p.problem[2].focus(); return; }
    if (window.CH_QB_SETTINGS && CH_QB_SETTINGS.problem()) return; // it says what is wrong in its own section
    if (!p.parts.length) { if (bar) bar.saved(); SECS.forEach(function (k) { editing(k, false); }); toast('Nothing to save.'); return; }
    var btn = $('company-save'); S.busy = true; S.after = null; S.gen++; // review: a read already on its way is not drawn over this
    var shownSecs = p.sections.filter(function (k) { return k !== 'quickbooks'; });
    drawShown(hoped(p), shownSecs); // the new values, at once (not saved yet: the bar says Saving…)
    if (bar && bar.busy) bar.busy('Saving…');
    if (btn) btn.textContent = 'Saving…';
    var said = [];
    function finish(err, at) {
      if (btn) btn.textContent = 'Save';
      if (err) { failed(err, at); return; }
      S.busy = false;
      if (bar && bar.idle) bar.idle();
      toast(said.length > 1 ? 'Saved. Phones get it the next time they refresh.' : said[0]);
      var fresh = S.after; S.after = null;
      if (fresh) took(fresh); else fetchAll(); // an older script: read as before
    }
    /**
     * Review fix: only true words after a failure. The server refused (refused: it answered no): read what is saved now and
     * show that, so "This shows what is saved" is true and a second Save starts from it (never refused as changed meanwhile
     * again and again). The answer never came, or the Sheet was busy: say it may not have gone through, and keep the IDs.
     */
    function failed(err, at) {
      var why = String(err.message || err);
      var left = p.parts.slice(at).map(function (x) { return x.part === 'settings' ? x.secs : [x.part]; }).reduce(function (a, b) { return a.concat(b); }, []).filter(function (k) { return k !== 'quickbooks' && $(k + '-err'); });
      var all = SECS.concat(['logo']);
      function end(note) {
        S.busy = false;
        if (bar && bar.idle) bar.idle();
        left.forEach(function (k) { say($(k + '-err'), note); });
        barErr(why); barNote();
        if (said.length) toast(said.join(' '));
      }
      if (!err.refused) { // no answer, or "busy, try again": it may or may not have gone through
        drawShown(S.data, shownSecs.concat(['logo']));
        end(why + ' This may not have gone through. Press Save to try again.');
        return;
      }
      if (bar && bar.busy) bar.busy('Not saved. Checking what is saved now…');
      get('settings').then(function (st) {
        if (!st || st.ok !== true || !st.settings) throw new Error('no read');
        st = window.CH_SIGNIN ? CH_SIGNIN.guard(st) : st;
        keep(st);
        drawShown(st, all, function () { $('logo-pending').value = ''; $('qb-pending').value = ''; if (bar) bar.saved(); }); // the bar compares what is typed (a chosen picture too) with what is saved now
        end('Not saved: ' + why + ' This shows what is saved.');
      }).catch(function () {
        drawShown(S.data, shownSecs.concat(['logo']));
        end('Not saved: ' + why + ' What is saved now could not be checked: press Refresh.');
      });
    }
    function next(i) {
      if (i >= p.parts.length) { finish(); return; }
      var x = p.parts[i], last = i === p.parts.length - 1;
      var go = x.part === 'settings' ? sendSettings(x.changes, last) : x.part === 'logo' ? sendLogo(S.next.uri, last) : x.part === 'quickbooks' ? CH_QB_SETTINGS.save(x.changes, last ? { read_after: 'settings', onAnswer: gotAfter } : null).then(function (w) { $('qb-pending').value = ''; return w; }) : sendSeason(x.value, x.from, last);
      go.then(function (words) { said.push(words); next(i + 1); }).catch(function (e) { finish(e, i); });
    }
    next(0);
  }
  /** The page's fresh read inside a save's answer (script 2.7.4), used once the last part is saved. */
  function gotAfter(r) { var st = r && r.read_after; if (st && st.ok && st.settings) S.after = window.CH_SIGNIN ? CH_SIGNIN.guard(st) : st; }
  /** What is saved now, with these settings changes in (a retry sends only what is left). */
  function applySettings(d, changes) {
    var st = d.settings, std = d.standard || {};
    changes.forEach(function (c) { if (/^area_/.test(c.key)) st.areas[c.key.slice(5)] = c.value || (std.areas || {})[c.key.slice(5)] || ''; else if (/^invoice_/.test(c.key)) { d.invoice = d.invoice || {}; d.invoice[c.key] = c.value; } else st[c.key] = c.value; }); // P3-C: the invoice settings are their own object
    var person = st.contact_user && (d.contacts || []).filter(function (u) { return u.id === st.contact_user; })[0];
    st.contact_shown = person ? person.name : st.contact_name; // who workers are told to ask: the person picked, else the typed name
    if (d.contact_was && d.contact_was.id !== st.contact_user) d.contact_was = null;
  }
  /** 1.24.3: what the page will show once the save goes through: a copy of what is saved, with the new values in. */
  function hoped(p) {
    var d = JSON.parse(JSON.stringify(S.data));
    p.parts.forEach(function (x) {
      if (x.part === 'settings') applySettings(d, x.changes);
      else if (x.part === 'logo' && S.next) d.settings.logo = S.next.uri;
      else if (x.part === 'season') d.season = x.value;
    });
    return d;
  }
  /**
   * 1.24.3: draws these sections' read views from d (the hoped-for values while saving, what is saved after a refusal). The
   * boxes keep exactly what was typed, so the Save bar still knows what is not saved yet.
   */
  function drawShown(d, secs, filled) { // filled(): called while the boxes hold d's values, before what was typed goes back
    var form = $('company-form'), keep = Array.prototype.filter.call(form.querySelectorAll('input, select, textarea'), function (f) { return f.type !== 'file'; }).map(function (f) { return [f, f.type === 'checkbox' || f.type === 'radio' ? f.checked : f.value]; });
    var touched = S.contactTouched, real = S.data;
    S.data = d;
    try {
      secs.forEach(function (k) { if (FILL[k]) { FILL[k](); editing(k, false); } });
      if (secs.indexOf('logo') >= 0) { drawLogo(); $('logo-new').hidden = !S.next || d !== real; } // while saving, the chosen picture is the logo shown
      if (filled) filled();
    } finally {
      S.data = real;
      keep.forEach(function (x) { if (x[0].type === 'checkbox' || x[0].type === 'radio') x[0].checked = x[1]; else x[0].value = x[1]; });
      S.contactTouched = touched;
      $('s-contact-other').hidden = !!$('s-contact').value;
      $('s-ship-hint').textContent = shipTip($('s-ship').value); // the hint follows the box, which keeps what was typed
    }
  }
  /** Saved, or duplicate: the same changes were saved on an earlier try whose answer was lost. Anything else is refused. */
  function went(r) { return r && r.ok === true && (r.status === 'saved' || r.status === 'duplicate'); }
  /** The server's answer when it did not save. refused: it really said no (nothing written); retry ("busy, try again") is not. */
  function refusal(r) { var e = new Error((r && r.error) || 'That did not go through. Try again.'); e.refused = !!(r && r.ok === false && !r.retry); return e; }
  /** company_settings. from is what the page showed, so a change made meanwhile is never overwritten. */
  function sendSettings(changes, last) {
    var body = { action: 'company_settings', entry_id: attempt('settings', JSON.stringify(changes)), changes: changes };
    if (last) body.read_after = 'settings';
    return post(body).then(function (r) {
      if (!went(r)) { if (!r.retry) done('settings'); throw refusal(r); }
      done('settings');
      if (r.company && C.setCompany) C.setCompany(r.company); // this page's app bar at once
      applySettings(S.data, changes);
      gotAfter(r);
      return r.status === 'duplicate' ? 'Already saved. Phones get it the next time they refresh.' : 'Saved. Phones get it the next time they refresh.';
    });
  }
  /** The season is a pick list on the Sheet's Lists tab: list_set, as the Lists page did before slice 6. */
  function sendSeason(value, from, last) {
    var body = { action: 'list_set', entry_id: attempt('season', from + '>' + value), list: 'Current season', value: value, from: from };
    if (last) body.read_after = 'settings';
    return post(body).then(function (r) {
      if (!went(r)) { if (!r.retry) done('season'); throw refusal(r); }
      done('season');
      S.data.season = value;
      gotAfter(r);
      return r.message ? r.message + '.' : 'Current season set to ' + value + '.';
    });
  }
  /* ---------- the logo ---------- */
  function drawLogo() {
    var st = S.data.settings;
    var has = !!(st.logo && C.goodLogo && C.goodLogo(st.logo));
    $('logo-now').setAttribute('src', has ? st.logo : ((C.standard && C.standard.logo) || 'icons/cocoahead-64.png'));
    $('logo-now').style.visibility = ''; // 2.7.1: hidden while the page's placeholder showed
    $('logo-what').classList.remove('muted', 'pending');
    $('logo-what').textContent = ''; $('logo-what').hidden = true; // 1.22.2: the picture says it
    $('logo-choose-text').textContent = has ? 'Replace logo' : 'Upload logo';
    $('logo-remove').hidden = !has;
    $('logo-new').hidden = !S.next;
  }
  var LOGO_MAX = 40000, LOGO_PX = 192;
  /**
   * The chosen file as a square picture of at most 192 × 192 pixels (the whole picture fitted in, never cropped), as a
   * data: address of at most 40,000 characters: PNG first (keeps see-through parts), then WebP, then smaller, then JPEG.
   */
  function makeLogo(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('Choose a PNG, JPEG or WebP picture.')); return; }
      if (file.size > 8 * 1024 * 1024) { reject(new Error('That file is very large. Choose a picture under 8 MB.')); return; }
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('That file could not be read.')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That file is not a picture this browser can open.')); };
        img.onload = function () {
          var tries = [[LOGO_PX, 'image/png'], [LOGO_PX, 'image/webp', 0.9], [LOGO_PX, 'image/webp', 0.75], [128, 'image/png'], [128, 'image/webp', 0.8], [128, 'image/jpeg', 0.85], [96, 'image/jpeg', 0.8]];
          for (var i = 0; i < tries.length; i++) {
            var px = tries[i][0], type = tries[i][1];
            var cv = document.createElement('canvas');
            cv.width = px; cv.height = px;
            var g = cv.getContext('2d');
            if (type === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, px, px); } // a JPEG has no see-through parts
            var k = Math.min(px / img.naturalWidth, px / img.naturalHeight);
            var w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
            g.imageSmoothingQuality = 'high';
            g.drawImage(img, Math.round((px - w) / 2), Math.round((px - h) / 2), w, h);
            var out = cv.toDataURL(type, tries[i][2]);
            if (out.indexOf('data:' + type + ';base64,') === 0 && out.length <= LOGO_MAX && C.goodLogo(out)) { resolve({ uri: out, px: px, type: type.slice(6).toUpperCase() }); return; }
          }
          reject(new Error('That picture is too detailed to keep as a logo, even made small. Try a simpler one (a plain background helps).'));
        };
        img.src = String(fr.result || '');
      };
      fr.readAsDataURL(file);
    });
  }
  $('logo-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    say($('logo-err'), '');
    if (!f) return;
    makeLogo(f).then(function (x) {
      S.next = x;
      $('logo-next').setAttribute('src', x.uri); $('logo-next-bar').setAttribute('src', x.uri);
      $('logo-next-name').textContent = C.company || '';
      $('logo-size').textContent = 'Made ' + x.px + ' × ' + x.px + ' pixels (' + x.type + ', ' + Math.ceil(x.uri.length / 1024) + ' KB). This is how it looks in the app bar. Press Save to use it.';
      $('logo-new').hidden = false; $('logo-confirm').hidden = true;
      logoPending();
      $('company-save') ? $('company-save').focus() : null;
    }).catch(function (e) { S.next = null; drawLogo(); logoPending(); say($('logo-err'), String(e.message || e)); });
  });
  /** The Save bar counts a chosen picture as a change (a hidden field it watches). */
  function logoPending() { $('logo-pending').value = S.next ? 'new ' + S.next.uri.length : ''; if (bar) { bar.check(); barNote(); } }
  $('logo-cancel').addEventListener('click', function () { S.next = null; drawLogo(); logoPending(); $('logo-choose').focus(); });
  /** company_logo: '' removes it. Resolves with the words to show. */
  function sendLogo(logo, last) {
    var from = S.data.settings.logo_v || '';
    var body = { action: 'company_logo', entry_id: attempt('logo', from + '|' + logo.length + '|' + logo.slice(-40)), logo: logo, from_v: from };
    if (last) body.read_after = 'settings';
    return post(body).then(function (r) {
      if (!went(r)) { if (!r.retry) done('logo'); throw refusal(r); }
      done('logo');
      gotAfter(r);
      if (r.company && C.setCompany) C.setCompany(r.company); // the new logo in this page's app bar at once
      S.data.settings.logo = logo; S.data.settings.logo_v = (r.company && r.company.logo_v) || '';
      S.next = null; $('logo-confirm').hidden = true; $('logo-pending').value = '';
      return logo ? 'The logo is saved. Phones get it the next time they refresh.' : 'The logo is removed. The standard one shows again.';
    });
  }
  $('logo-remove').addEventListener('click', function () {
    var box = $('logo-confirm');
    var yes = el('button', { type: 'button', className: 'btn btn-danger btn-sm', id: 'logo-remove-yes', text: 'Yes, remove it' });
    var no = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Cancel', onclick: function () { box.hidden = true; $('logo-remove').focus(); } });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      S.busy = true; yes.disabled = true; yes.textContent = 'Removing…'; say($('logo-err'), '');
      S.after = null;
      sendLogo('', true).then(function (words) { S.busy = false; toast(words); var fresh = S.after; S.after = null; if (fresh) took(fresh); else fetchAll(); })
        .catch(function (e) { S.busy = false; yes.disabled = false; yes.textContent = 'Yes, remove it'; say($('logo-err'), String(e.message || e)); });
    });
    box.replaceChildren(el('div', { className: 'confirm-title', tabindex: '-1', text: 'Remove the logo?' }),
      el('p', { className: 'confirm-note', text: 'The standard logo shows again everywhere. You can add a logo again any time.' }),
      el('div', { className: 'confirm-actions' }, [no, yes]));
    box.hidden = false; box.querySelector('.confirm-title').focus();
  });

  /* ---------- About: read-only facts (design plan 5.3: so Jake can answer "is it up to date?") ---------- */
  function drawFacts() {
    var d = S.data;
    var rows = [
      ['Version', 'App ' + PAGE_VERSION + ' · server ' + (d.version || '?')],
      ['Connected to Batchstory', d.hq ? 'Yes' : 'No'],
      ['Units', (function () { var u = ((window.CH_CONFIG || {}).units || {}).makingTemp || ''; return 'lbs · °C' + (u && u !== '°C' ? ' · making ' + u : ''); })()], // 1.22.2: said as a fact; changing them is a conversation with Batchstory
      ['Admins who can sign in', String((d.admins || []).length)],
    ];
    $('facts').replaceChildren.apply($('facts'), rows.map(function (r) { return row(r[0], r[1]); }));
  }

  /* ---------- views: Company (settings.html), What you track (#track), My profile (#profile), Who changed what (#history) ---------- */
  var VIEWS = ['company', 'forms', 'profile', 'history']; // forms: "What you track" (2.3.0, settings-forms.js)
  var ALIAS = { track: 'forms', me: 'profile', company: 'company' };
  var HASH = { company: '', forms: '#track', profile: '#profile', history: '#history' };
  var HEAD = {
    company: ['Company settings', ''], // pl2: when phones get a change is under "How changes reach phones" at the foot
    forms: ['Questions', 'What the field app asks. Switch off what you do not record.'],
    profile: ['My profile', 'Your own name, email, password and sign-ins.'],
    history: ['Change log', 'Changes to people, answer choices and settings, newest first.'],
  };
  function show(view) {
    var want = String(view || '');
    var section = /^(sec-[a-z]+|qb-settings)$/.test(want) ? want : '';
    if (section) want = 'company';
    if (ALIAS[want]) want = ALIAS[want];
    S.view = VIEWS.indexOf(want) >= 0 ? want : 'company';
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== S.view; });
    $('set-title').textContent = HEAD[S.view][0];
    $('set-sub').textContent = HEAD[S.view][1]; $('set-sub').hidden = !HEAD[S.view][1];
    if ($('how')) $('how').hidden = S.view !== 'company' && S.view !== 'forms';
    $('set-up').hidden = true; // 1.22.2: History is reached from the sidebar, not from Company
    document.title = document.title.replace(/(Settings|Company settings|Company|What you track|Questions|My profile|Who changed what|Change log)$/, HEAD[S.view][0]);
    var hash = HASH[S.view];
    if (location.hash !== hash && !section) history.replaceState(null, '', location.pathname + hash);
    if (section) { if ($('main').hidden) S.toSection = section; else toSection(section); }
    if (S.view === 'history') loadHistory();
  }
  function afterLoad(fn) { if (document.readyState === 'complete') setTimeout(fn, 0); else window.addEventListener('load', function () { setTimeout(fn, 0); }); } // after the browser's own jump to the #…
  function toSection(id) {
    var t = $(id);
    if (!t) return;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    t.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    var h = t.querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  // the section list: jump without leaving a #… in the address (the address names the view, not the place on it)
  Array.prototype.forEach.call(document.querySelectorAll('.set-toc a[href^="#sec-"], .set-toc a[href="#qb-settings"]'), function (a) {
    a.addEventListener('click', function (ev) { ev.preventDefault(); toSection(a.getAttribute('href').slice(1)); });
  });
  // 1.22.2: the section in view is marked in the list as the page scrolls (admin.js pageNav)
  if (window.CH_ADMIN && CH_ADMIN.pageNav) CH_ADMIN.pageNav(Array.prototype.map.call(document.querySelectorAll('.set-toc a[href^="#sec-"], .set-toc a[href="#qb-settings"]'), function (a) { return { link: a, target: $(a.getAttribute('href').slice(1)) }; }));
  show(String(location.hash || '').replace('#', '') || 'company');
  window.addEventListener('hashchange', function () { show(String(location.hash || '').replace('#', '')); if (S.view !== 'company') window.scrollTo(0, 0); });

  /* ---------- My profile ---------- */
  function drawProfile() {
    var me = S.data.me || {};
    $('p-name').value = me.name || '';
    $('p-email').value = me.email || '';
    $('p-pass').value = '';
    var n = Number(me.other_sign_ins) || 0;
    $('signins-sub').textContent = n ? 'You are also signed in on ' + n + (n === 1 ? ' other browser or computer.' : ' other browsers or computers.') : 'You are not signed in anywhere else.';
    $('p-signout-others').disabled = !n; // works while paused too (signing out is not a change)
    var c = me.email_change;
    $('my-change').hidden = !c;
    if (c) {
      $('my-change-title').textContent = (c.asked_by || 'Another admin') + ' asked to change your sign-in email to ' + c.new_email + '.';
      $('my-change-text').textContent = c.due ? 'The 48 hours are over, but it has not happened yet: you can still cancel it. If you did not ask for this, cancel it now.' : 'It changes on ' + dayTime(c.applies_at) + ' unless you cancel it. If you did not ask for this, cancel it now.';
    }
  }
  function afterMe(r, msg) {
    toast(msg);
    if (r.user && r.user.name) { settings.by = r.user.name; save('ch.admin', settings); var w = document.querySelector('.account-name'); if (w) w.lastChild.textContent = r.user.name; var who = document.querySelector('.account-who b'); if (who) who.textContent = r.user.name; }
    fetchAll();
  }
  $('name-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (S.busy || !S.data) return;
    var me = S.data.me, v = tidy($('p-name').value), err = $('name-err');
    say(err, '');
    if (!v) { say(err, 'Type your name.'); $('p-name').focus(); return; }
    if (v === me.name) { say(err, 'That is already your name.'); return; }
    var btn = $('name-save'); S.busy = true; btn.disabled = true; btn.textContent = 'Saving…';
    post({ action: 'edit_person', entry_id: attempt('name', v), user_id: me.id, changes: [{ field: 'name', from: me.name, value: v }] }).then(function (r) {
      S.busy = false; btn.disabled = false; btn.textContent = 'Save name';
      if (!r.ok || r.status === 'duplicate') { if (!r.retry) done('name'); throw new Error(r.ok ? 'That was already saved.' : (r.error || 'That did not go through. Try again.')); }
      done('name');
      afterMe(r, 'Your name is now ' + v + '.');
    }).catch(function (e) { S.busy = false; btn.disabled = false; btn.textContent = 'Save name'; say(err, String(e.message || e)); });
  });
  $('email-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (S.busy || !S.data) return;
    var me = S.data.me, v = $('p-email').value.trim().toLowerCase(), pw = $('p-pass').value, err = $('email-err');
    say(err, '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { say(err, 'That email address does not look right.'); $('p-email').focus(); return; }
    if (v === (me.email || '')) { say(err, 'That is already your email.'); return; }
    if (!pw) { say(err, 'Type your current password.'); $('p-pass').focus(); return; }
    var btn = $('email-save'); S.busy = true; btn.disabled = true; btn.textContent = 'Changing…';
    post({ action: 'edit_person', entry_id: attempt('email', v), user_id: me.id, password: pw, changes: [{ field: 'email', from: me.email || '', value: v }] }).then(function (r) {
      S.busy = false; btn.disabled = false; btn.textContent = 'Change email'; $('p-pass').value = '';
      if (!r.ok || r.status === 'duplicate') { if (!r.retry) done('email'); throw new Error(r.ok ? 'That was already saved.' : (r.error || 'That did not go through. Try again.')); }
      done('email');
      afterMe(r, 'Your email is now ' + v + '. Sign in with it from now on.');
    }).catch(function (e) { S.busy = false; btn.disabled = false; btn.textContent = 'Change email'; $('p-pass').value = ''; say(err, String(e.message || e)); });
  });
  $('p-signout-others').addEventListener('click', function () {
    var box = $('signout-confirm');
    var msg = el('p', { className: 'err', hidden: true });
    var yes = el('button', { type: 'button', className: 'btn btn-primary', id: 'signout-yes', text: 'Yes, sign out the others' });
    var no = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onclick: function () { box.hidden = true; $('p-signout-others').focus(); } });
    yes.addEventListener('click', function () {
      if (S.busy) return;
      S.busy = true; yes.disabled = true; yes.textContent = 'Signing out…';
      ask({ key: settings.key, action: 'sign_out_others' }).then(function (r) {
        S.busy = false;
        if (!r.ok) throw new Error(r.error || 'That did not go through. Try again.');
        box.hidden = true; toast(r.message || 'Done.'); fetchAll();
      }).catch(function (e) { S.busy = false; yes.disabled = false; yes.textContent = 'Try again'; say(msg, String(e.message || e)); });
    });
    box.replaceChildren(el('div', { className: 'confirm-title', tabindex: '-1', text: 'Sign out everywhere else?' }),
      el('ul', {}, [el('li', { text: 'Every other browser or computer signed in as you is signed out.' }), el('li', { text: 'This one keeps working. Your password does not change.' })]),
      el('div', { className: 'confirm-actions' }, [no, yes]), msg);
    box.hidden = false; box.querySelector('.confirm-title').focus();
  });
  $('my-change-cancel').addEventListener('click', function () {
    var c = S.data && S.data.me && S.data.me.email_change;
    if (!c || S.busy) return;
    var btn = $('my-change-cancel'); S.busy = true; btn.disabled = true; btn.textContent = 'Cancelling…';
    post({ action: 'admin_email_cancel', entry_id: attempt('cancel', c.id), change_id: c.id }).then(function (r) {
      S.busy = false; btn.disabled = false; btn.textContent = 'Cancel this change';
      if (!r.ok) { if (!r.retry) done('cancel'); throw new Error(r.error || 'That did not go through. Try again.'); }
      done('cancel'); toast('Cancelled. Your email stays as it was.'); fetchAll();
    }).catch(function (e) { S.busy = false; btn.disabled = false; btn.textContent = 'Cancel this change'; say($('my-change-err'), String(e.message || e)); });
  });

  /* ---------- who changed what ---------- */
  var KIND = { 'company settings': 'Settings', 'admin email': 'Admin email', invite: 'Person added', revoke: 'Switched off', 'edit person': 'Person changed', 'resend invite': 'New link', 'set password': 'Password', 'shared links': 'Shared links', 'list change': 'Answer choices', platform: 'Batchstory' };
  /** Loads the history when its view opens (slice 7), once per load of the page's data; Refresh loads it again. */
  function loadHistory() {
    if (S.hist || !S.data || !settings.session) return;
    S.hist = true;
    histCopy();
    var M = window.CH_ADMIN && CH_ADMIN.memo, since = M ? M.since('history', settings.key) : undefined;
    if (window.CH_ADMIN && CH_ADMIN.updated) CH_ADMIN.updated($('updated'), S.data && S.data.at, true);
    get('history', since ? { since: since } : null).then(function (h) {
      gotHistory(h);
      if (window.CH_ADMIN && CH_ADMIN.updated) CH_ADMIN.updated($('updated'), S.data && S.data.at, false);
    }).catch(function (e) {
      S.hist = false;
      if (window.CH_ADMIN && CH_ADMIN.updated) CH_ADMIN.updated($('updated'), S.data && S.data.at, false);
      if (!$('hist').tBodies[0].querySelector('tr:not(.skel-row)')) { drawHistory([]); $('hist-empty').hidden = true; }
      say($('hist-err'), 'Could not load the history (' + (e.message || e) + '). Press Refresh.');
    });
  }
  /** 2.7.1: the last history this sign-in read, at once (a quiet placeholder row only when there is none). */
  function histCopy() {
    var M = window.CH_ADMIN && CH_ADMIN.memo, q = M ? M.get('history', settings.key) : null, body = $('hist').tBodies[0];
    $('hist-empty').hidden = true; $('hist').hidden = false;
    if (q && q.data && Array.isArray(q.data.items)) { drawHistory(q.data.items); S.hist = true; return; }
    if (!body.rows.length && window.CH_ADMIN && CH_ADMIN.ui) body.replaceChildren(el('tr', { className: 'skel-row' }, [el('td', { colspan: '4' }, [CH_ADMIN.ui.skeleton('rows', 3)])]));
  }
  /** A history answer: drawn and kept; "unchanged" (2.7.1) keeps what is drawn. */
  function gotHistory(h) {
    var M = window.CH_ADMIN && CH_ADMIN.memo;
    S.hist = true;
    if (h && h.ok && h.unchanged === true) {
      var q = M ? M.get('history', settings.key) : null, full = C.withCopy && q ? C.withCopy(h, q.data, true) : null;
      if (full) { if (M) M.put('history', settings.key, full); drawHistory(full.items || []); say($('hist-err'), ''); return; }
      S.hist = false; loadHistoryFull(); return;
    }
    if (h && h.ok && M) M.put('history', settings.key, h);
    drawHistory(h && h.ok ? h.items || [] : []);
    if (h && !h.ok) say($('hist-err'), h.error || 'Could not load the history. Press Refresh.'); else say($('hist-err'), '');
  }
  function loadHistoryFull() { S.hist = true; get('history').then(gotHistory).catch(function () { S.hist = false; }); }
  /**
   * 1.22.2: a row's words, for the company's own admins. Shown only: the Sheet keeps what it wrote. "Batchstory", never "HQ";
   * a plain description instead of a script property's name; and no "by Batchstory" when the Who column already says so.
   * (To be worded at the source the next time Code.gs changes; this lookup then simply finds nothing to replace.)
   */
  var TUNE_WORDS = { PERF_LOG: 'Request timing', DATA_CACHE: 'The dashboard\'s kept copy', PASSWORD_ROUNDS: 'Sign-in strength setting' };
  function noHq(t) { return String(t).replace(/Batchstory HQ/g, 'Batchstory'); }
  function plainWords(msg, by) {
    msg = String(msg).replace(/^What you track: /, 'Questions: '); // the page was renamed in 1.24.0; the Sheet's own words stay
    var m = /^(?:Batchstory HQ: )?([A-Z][A-Z_]+) changed from (.+?) to (.+?) by .+?\.$/.exec(msg);
    if (m && TUNE_WORDS[m[1]]) {
      var n = function (v) { return /^\d+$/.test(v) ? Number(v).toLocaleString('en-US') : v; };
      if (m[3] === 'on' || m[3] === 'off') return TUNE_WORDS[m[1]] + ' switched ' + m[3];
      return TUNE_WORDS[m[1]] + ' changed to ' + n(m[3]) + (m[2] === '(not set)' ? '' : ' (was ' + n(m[2]) + ')');
    }
    if (msg === 'Connected Batchstory HQ') return 'Connected to Batchstory';
    if (msg === 'Disconnected Batchstory HQ') return 'Disconnected from Batchstory';
    if (msg === 'Changed the Batchstory HQ secret') return 'Renewed the connection to Batchstory';
    return /Batchstory/.test(by || '') ? noHq(msg).replace(/ by Batchstory\.$/, '.') : noHq(msg);
  }
  function drawHistory(items) {
    S.hist = true;
    var body = $('hist').tBodies[0];
    body.replaceChildren.apply(body, items.map(function (x) {
      // app 1.25.0: the kind has its own column (When, Who, What, Details), so a change is one line where it fits
      return el('tr', {}, [el('td', { className: 'nw h-when', text: dayTime(x.at) }), el('td', { className: 'nw h-who', text: noHq(x.by || '') }),
        el('td', { className: 'nw h-kind', text: KIND[x.form] || x.form }), el('td', { className: 'grow h-what', text: plainWords(x.message || '', x.by) })]);
    }));
    if (window.CH_ADMIN && CH_ADMIN.ui && CH_ADMIN.ui.paged) CH_ADMIN.ui.paged($('hist'), { key: 'hist', label: 'Change log' });
    $('hist').hidden = !items.length; $('hist-empty').hidden = !!items.length;
  }

  $('refresh').addEventListener('click', fetchAll);
  window.__settings = { reload: fetchAll, took: function (st) { if (st && st.ok && st.settings) took(window.CH_SIGNIN ? CH_SIGNIN.guard(st) : st); else fetchAll(); }, post: post, attempt: attempt, done: done, toast: toast, data: function () { return S.data; } }; // also for settings-forms.js (1.24.3: took, the read inside a save's answer)
  fetchAll();
})();
