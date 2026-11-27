/*
 * Settings page, "What you track" tab (2.3.0; admins who signed in). Batchstory's master menu (schema.js MENU) lists everything
 * that can be tracked: the areas of the work, the forms, and the optional questions on them, each on or off by default. Here a
 * company switches menu items on or off; questions the stock numbers, IDs or links between stages need are always asked.
 * Nothing is deleted: entries and tabs stay, and switching back on brings everything back. Every form can be previewed here,
 * also one whose area is off (read-only: a picture of the phone's form). The page sends the whole new state once
 * (company_forms, with the version it showed, so a change made meanwhile is never overwritten); the script checks it again,
 * records it in Raw log first and refuses it while the company is paused. Phones get it the next time they refresh.
 */
(function () {
  'use strict';
  var C = window.CH_CONFIG || {}, P = window.__settings, CH = window.CH;
  var $ = function (id) { return document.getElementById(id); };
  if (!P || !CH || !$('view-forms')) return;
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
  var AREAS = CH.AREAS;
  var S = { saved: null, draft: null, form: '', busy: false, paused: false, names: {} };

  /* ---------- the menu, with this page's (unsaved) choices ---------- */
  // Every menu item: {kind: 'area'|'form'|'field', key, form, dflt}. The state is the shape phones get: what is off, and the
  // items that start off but are on. An item it does not name is at its default.
  function items() {
    var out = AREAS.map(function (a) { return { kind: 'area', key: a, dflt: CH.AREA_DEFAULTS[a] || 'on' }; });
    CH.FORMS.forEach(function (f) {
      var sw = CH.MENU[f.id] && CH.MENU[f.id].switch;
      if (sw) out.push({ kind: 'form', key: f.id, dflt: sw.default === 'off' ? 'off' : 'on' });
      CH.switches(f).forEach(function (s) { out.push({ kind: 'field', form: f.id, key: s.key, dflt: s.default }); });
    });
    return out;
  }
  function lists(st, it) {
    if (it.kind === 'area') return [st.areas_off, st.areas_on];
    if (it.kind === 'form') return [st.forms_off, st.forms_on];
    return [st.hidden[it.form] || [], st.shown[it.form] || []];
  }
  function isOn(st, it) { var l = lists(st, it); return l[0].indexOf(it.key) >= 0 ? false : l[1].indexOf(it.key) >= 0 ? true : it.dflt !== 'off'; }
  function find(kind, key, form) { return items().filter(function (it) { return it.kind === kind && it.key === key && (!form || it.form === form); })[0]; }
  /** The state with every menu item on or off as on(it) says, in the menu's order. */
  function build(on) {
    var st = { areas_off: [], areas_on: [], forms_off: [], forms_on: [], hidden: {}, shown: {} };
    items().forEach(function (it) {
      var v = on(it);
      if (it.kind === 'field') { if (!v) (st.hidden[it.form] = st.hidden[it.form] || []).push(it.key); else if (it.dflt === 'off') (st.shown[it.form] = st.shown[it.form] || []).push(it.key); return; }
      var pre = it.kind === 'area' ? 'areas_' : 'forms_';
      if (!v) st[pre + 'off'].push(it.key); else if (it.dflt === 'off') st[pre + 'on'].push(it.key);
    });
    return st;
  }
  function tidy(st) { return build(function (it) { return isOn(st, it); }); }
  function setOn(it, v) { var d = S.draft; S.draft = build(function (x) { return x === it || (x.kind === it.kind && x.key === it.key && x.form === it.form) ? v : isOn(d, x); }); }
  function areaName(a) { return S.names[a] || CH.AREA_TITLES[a] || a; }
  function formsOf(a) { return CH.FORMS.filter(function (f) { return f.area === a; }); }
  /** 2.4.0: forms of several areas (Tasting note): on the phones while any of their areas is on. */
  function sharedForms() { return CH.FORMS.filter(function (f) { return Array.isArray(f.area); }); }
  function areaOn(a) { return isOn(S.draft, find('area', a)); }
  function formAreaOn(f) { return [].concat(f.area || []).some(areaOn); }
  function formOn(f) { var it = find('form', f.id); return formAreaOn(f) && (!it || isOn(S.draft, it)); }
  /** Asked on the phone with the choices on this page (not yet saved)? */
  // P4-A: the photo questions are listed only while the server says photos are switched on (company.photos); they stay in the
  // saved choices either way (items() still has them), so nothing about them is lost while they are not listed
  function listed(s) { return !!C.photos || !s.fields.some(function (f) { return f.type === 'photo'; }); }
  function shownSwitches(form) { return CH.switches(form).filter(listed); }
  function askedHere(form, f) { var m = f.__main || f; return f.tier !== 'optional' || isOn(S.draft, find('field', m.__path, form.id)); }

  /* ---------- drawing ---------- */
  function draw(data) {
    var forms = (data && data.company && data.company.forms) || C.forms || {};
    var was = S.saved, keep = was && S.draft && changes().length && String(forms.v || '') === was.v; // another card saved: unsaved switches here stay
    S.saved = tidy({ areas_off: forms.areas_off || [], areas_on: forms.areas_on || [], forms_off: forms.forms_off || [], forms_on: forms.forms_on || [], hidden: forms.hidden || {}, shown: forms.shown || {} });
    S.saved.v = String(forms.v || '');
    if (!keep) S.draft = tidy(S.saved);
    S.paused = !!(data && data.suspended);
    S.names = (data && data.settings && data.settings.areas) || C.areas || {};
    if (data && data.company && C.setForms) C.setForms(forms); // this computer's own pages (dashboard, labels) follow at once
    if (!S.form || !CH.formById(S.form)) S.form = CH.FORMS[0].id;
    fillPicker();
    redraw();
  }
  function redraw() { drawAreas(); drawForm(); drawBar(); }

  function switchRow(id, label, on, disabled, onChange, desc, extra) {
    var input = el('input', { type: 'checkbox', id: id, role: 'switch', 'aria-describedby': desc ? id + '-d' : null });
    input.checked = on; input.disabled = disabled;
    input.addEventListener('change', function () { onChange(input.checked); var again = $(id); if (again) again.focus(); });
    return el('div', { className: 'fx-row' + (on ? '' : ' is-off') }, [
      el('div', { className: 'fx-row-top' }, [el('label', { className: 'fx-switch', for: id }, [input, el('span', { className: 'fx-track', 'aria-hidden': 'true' }), el('span', { className: 'fx-name', text: label })]), extra || null]),
      desc ? el('span', { className: 'fx-desc', id: id + '-d', text: desc }) : null,
    ]);
  }

  function drawAreas() {
    var box = $('fx-areas');
    var onCount = AREAS.filter(areaOn).length;
    box.replaceChildren.apply(box, AREAS.map(function (a) {
      var on = areaOn(a), last = on && onCount === 1, it = find('area', a);
      var names = formsOf(a).map(function (f) { return f.title; }).join(', ');
      var preview = el('button', { type: 'button', className: 'btn btn-ghost btn-sm fx-preview-btn', id: 'fx-preview-' + a, text: 'Preview forms', onclick: function () {
        S.form = formsOf(a)[0].id; $('fx-form').value = S.form; drawForm(); $('fx-preview').scrollTop = 0;
        var fig = document.querySelector('.fx-phone');
        if (fig && fig.scrollIntoView) fig.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } });
      return switchRow('fx-area-' + a, areaName(a), on, S.paused || last, function (v) { setOn(it, v); redraw(); },
        last ? names + '. The last area on: it stays on.' : on ? names + '.' : 'Off: ' + names + ' are not on the phones. You can still preview them.', preview);
    }));
  }

  function fillPicker() {
    var sel = $('fx-form');
    var groups = AREAS.map(function (a) {
      return el('optgroup', { label: areaName(a) }, formsOf(a).map(function (f) { return el('option', { value: f.id, text: f.title }); }));
    });
    if (sharedForms().length) groups.push(el('optgroup', { label: 'Every area' }, sharedForms().map(function (f) { return el('option', { value: f.id, text: f.title }); })));
    sel.replaceChildren.apply(sel, groups);
    sel.value = S.form;
  }
  function pickerCounts() {
    Array.prototype.forEach.call($('fx-form').options, function (o) {
      var f = CH.formById(o.value), n = shownSwitches(f).filter(function (s) { return !isOn(S.draft, find('field', s.key, f.id)); }).length;
      o.textContent = f.title + (n ? ' (' + n + ' off)' : '') + (!formOn(f) ? ' · not on phones' : '');
    });
  }

  function drawForm() {
    var form = CH.formById(S.form);
    pickerCounts();
    var off = !formOn(form), fit = find('form', form.id);
    $('fx-area-off').hidden = !off;
    $('fx-area-off-text').textContent = !off ? '' : !formAreaOn(form)
      ? [].concat(form.area).map(areaName).join(', ') + ([].concat(form.area).length > 1 ? ' are' : ' is') + ' switched off, so phones do not show this form. This is a preview only; what you choose here is kept for when it is back on.'
      : 'This form is switched off, so phones do not show it. This is a preview only.';
    var list = $('fx-list');
    $('fx-list-legend').textContent = 'Questions on ' + form.title + ' you can switch off';
    var rows = [];
    if (fit) rows.push(switchRow('fx-formsw-' + form.id, 'Ask this form on the phones', isOn(S.draft, fit), S.paused, function (v) { setOn(fit, v); drawForm(); drawBar(); }, [form.switchHint, fit.dflt === 'off' ? 'Starts off: switch it on when you want it.' : ''].filter(Boolean).join(' ')));
    shownSwitches(form).forEach(function (s) {
      var it = find('field', s.key, form.id);
      var inRepeat = s.key.indexOf('.') > 0 ? form.fields.filter(function (f) { return f.key === s.key.split('.')[0]; })[0] : null;
      var also = s.fields.slice(1).map(function (f) { return f.label; });
      var note = [inRepeat ? 'In each ' + inRepeat.itemLabel.toLowerCase() : '', also.length ? 'Goes with: ' + also.join(', ') : '', s.default === 'off' ? 'Starts off' : ''].filter(Boolean).join(' · ');
      rows.push(switchRow('fx-q-' + form.id + '-' + s.key.replace(/\./g, '-'), s.label, isOn(S.draft, it), S.paused, function (v) { setOn(it, v); drawForm(); drawBar(); }, note));
    });
    if (!shownSwitches(form).length) rows.push(el('p', { className: 'hint', text: 'Every question on this form is needed, so none can be switched off.' }));
    list.replaceChildren.apply(list, [list.querySelector('legend')].concat(rows));
    var core = [];
    CH.eachField(form, function (f) { if (f.tier === 'core' && f.type !== 'repeat' && !f.readonly) core.push(f.label); });
    $('fx-core').textContent = core.join(' · ');
    drawPreview(form);
  }

  /** A small picture of the phone's form with the questions it will ask. Read-only: looks only, no inputs, nothing saved. */
  function drawPreview(form) {
    var box = $('fx-preview');
    var shown = 0, offN = 0;
    function shape(f) {
      if (f.type === 'textarea') return el('span', { className: 'fx-in tall' });
      if (f.type === 'temps') return el('span', { className: 'fx-temps' }, [1, 2, 3, 4, 5].map(function () { return el('span', { className: 'fx-in sq' }); }));
      if (['choice', 'chips', 'yesno', 'ferment', 'ref'].indexOf(f.type) >= 0) {
        var opts = f.type === 'yesno' ? ['Yes', 'No'] : (f.options || []).slice(0, 3);
        return el('span', { className: 'fx-chips' }, (opts.length ? opts : ['', '', '']).map(function (o) { return el('span', { className: 'fx-chip', text: o }); }));
      }
      return el('span', { className: 'fx-in' + (f.unit ? ' has-unit' : '') }, f.unit ? [el('span', { className: 'fx-unit', text: f.unit })] : []);
    }
    function q(f) {
      if (f.type === 'photo' && !C.photos) return null; // P4-A: not on any phone while photos are switched off
      if (!askedHere(form, f)) { offN++; return null; }
      if (f.type === 'repeat') return el('div', { className: 'fx-group' }, [el('span', { className: 'fx-l', text: f.itemLabel + ' 1' })].concat(f.fields.map(q).filter(Boolean)));
      shown++;
      return el('div', { className: 'fx-pq' + (f.showIf ? ' sometimes' : '') }, [el('span', { className: 'fx-l', text: f.label + (f.required ? ' *' : '') }), shape(f)]);
    }
    var kids = form.fields.map(q).filter(Boolean);
    box.classList.toggle('is-off', !formOn(form));
    box.replaceChildren.apply(box, [el('div', { className: 'fx-ph' }, [el('b', { text: form.title }), el('span', { text: form.hint })])].concat(kids, [el('div', { className: 'fx-save', text: 'Save' })]));
    $('fx-phone-cap').textContent = (formOn(form) ? 'On the phone: ' : 'Preview (not on the phones): ') + shown + (shown === 1 ? ' question' : ' questions') + (offN ? ', ' + offN + ' switched off' : '');
  }

  /* ---------- saving ---------- */
  function changes() {
    var out = [];
    if (!S.saved || !S.draft) return out;
    AREAS.forEach(function (a) { var it = find('area', a); if (isOn(S.saved, it) !== isOn(S.draft, it)) out.push(areaName(a) + (isOn(S.draft, it) ? ' on' : ' off')); });
    CH.FORMS.forEach(function (f) {
      var fit = find('form', f.id);
      if (fit && isOn(S.saved, fit) !== isOn(S.draft, fit)) out.push(f.title + (isOn(S.draft, fit) ? ' on' : ' off'));
      var n = CH.switches(f).filter(function (s) { var it = find('field', s.key, f.id); return isOn(S.saved, it) !== isOn(S.draft, it); }).length;
      if (n) out.push(f.title + ': ' + n + (n === 1 ? ' question' : ' questions'));
    });
    return out;
  }
  function drawBar() {
    var c = changes();
    $('fx-bar').hidden = !c.length;
    $('fx-bar-text').textContent = c.length ? 'Not saved yet: ' + c.join(' · ') + '.' : '';
    $('fx-save').disabled = S.busy || S.paused;
  }
  function say(text) { var e = $('fx-err'); e.textContent = text || ''; e.hidden = !text; }

  $('fx-form').addEventListener('change', function () { S.form = $('fx-form').value; drawForm(); $('fx-preview').scrollTop = 0; }); // another form starts at its top (a switch keeps the place)
  $('fx-undo').addEventListener('click', function () { S.draft = tidy(S.saved); say(''); redraw(); });
  $('fx-save').addEventListener('click', function () {
    if (S.busy || S.paused || !S.saved) return;
    var next = tidy(S.draft);
    if (!AREAS.some(areaOn)) { say('At least one area must stay on.'); return; }
    say('');
    S.busy = true;
    var btn = $('fx-save'); btn.disabled = true; btn.textContent = 'Saving…';
    var sig = JSON.stringify(next) + '|' + S.saved.v;
    P.post({ action: 'company_forms', entry_id: P.attempt('forms', sig), forms: next, from_v: S.saved.v, read_after: 'settings' }).then(function (r) { // 1.24.3: the page's fresh read comes in this answer (script 2.7.4)
      S.busy = false; btn.textContent = 'Save';
      if (!(r.ok === true && (r.status === 'saved' || r.status === 'duplicate'))) { if (!r.retry) P.done('forms'); throw new Error(r.error || 'That did not go through. Try again.'); } // 1.24.3 review: duplicate = saved on an earlier try whose answer was lost
      P.done('forms');
      if (r.company && C.setCompany) C.setCompany(r.company); // this computer's pages follow at once
      if (r.company && r.company.forms) { S.saved = tidy(r.company.forms); S.saved.v = String(r.company.forms.v || ''); S.draft = tidy(S.saved); }
      redraw();
      P.toast('Saved. Phones ask the new questions the next time they refresh.');
      if (r.read_after && P.took) P.took(r.read_after); else P.reload(); // an older script: read again as before
    }).catch(function (e) { S.busy = false; btn.textContent = 'Save'; drawBar(); say(String(e.message || e)); });
  });

  window.CH_SETTINGS_FORMS = { draw: draw };
  if (P.data && P.data()) draw(P.data());
})();
