/* Paper versions of the app's forms, built from schema.js so they always match. */
(function () {
  'use strict';
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('ch.lists') || 'null'); } catch (e) { /* ignore */ }
  function list(name) {
    var L = (saved && saved.lists) || {};
    return (L[name] && L[name].length ? L[name] : CH.DEFAULT_LISTS[name]) || [];
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }

  function fieldRow(f, n) {
    var row = el('div', 'f');
    var l = el('div', 'l');
    if (n) l.appendChild(el('span', 'qn', n + '. ')); // P4-B/2: the question's number (CH.paperFields), so a scan's reader finds each label in order
    l.appendChild(document.createTextNode(f.label + (f.unit ? ' (' + f.unit + ')' : '')));
    if (f.paperNote) l.appendChild(el('small', '', f.paperNote)); // e.g. "Only when unloading" (fields with showIf, see schema.js)
    row.appendChild(l);
    var v;
    if (f.type === 'choice' || f.type === 'chips' || f.type === 'yesno') {
      var opts = f.type === 'yesno' ? ['Yes', 'No'] : (f.options ? (CH.optionsOf ? CH.optionsOf(f) : f.options) : list(f.list));
      if (!opts.length) { // 1.24.0: a list with nothing on it yet prints as a plain line to write on, not a lone "Other" box
        v = el('div', 'blank');
      } else {
        v = el('div', 'ticks');
        opts.forEach(function (o) { v.appendChild(el('span', '', (f.optionLabels && f.optionLabels[o]) || o)); });
        if (f.list) v.appendChild(el('span', 'write', 'Other'));
      }
    } else if (f.type === 'temps') {
      v = el('div', 'boxes');
      for (var i = 1; i <= 5; i++) v.appendChild(el('span', '', String(i)));
    } else if (f.type === 'buckets') { // P1-A: 20 numbered boxes for the buckets (4 rows of 5), then the total
      v = el('div', 'bk-paper');
      for (var r = 0; r < 4; r++) {
        var line = el('div', 'boxes');
        line.style.marginBottom = '4px';
        for (var b = 1; b <= 5; b++) line.appendChild(el('span', '', String(r * 5 + b)));
        v.appendChild(line);
      }
      v.appendChild(el('div', '', 'Total ______ ' + (f.unit || 'lbs')));
    } else if (f.type === 'textarea') {
      v = el('div', 'blank tall');
    } else {
      v = el('div', 'blank');
    }
    row.appendChild(v);
    return row;
  }

  var root = document.getElementById('forms');
  var on = CH.onPaper; // P4-A: a photo question is never on paper; 2.3.0: questions this company switched off are left off the paper too; 2.4.0: and a question only for an area that is off (the Tasting note's roast picker with Roasting off)
  CH.FORMS.filter(function (form) { return !CH.formOn || CH.formOn(form); }).forEach(function (form) {
    var box = el('section', 'form pform');
    box.setAttribute('data-form', form.id); // P1-E: the chooser shows or hides each form by this
    box.appendChild(el('h2', '', form.title));
    var meta = el('div', 'meta');
    meta.appendChild(el('span', '', ((window.CH_CONFIG || {}).demo ? 'DEMO (made-up data) · ' : '') + ((window.CH_CONFIG || {}).company || 'Cocoahead') + ' · ' + form.hint)); // 2.7.3: the demo company's paper says so
    meta.appendChild(el('b', '', 'Your name: ____________________'));
    box.appendChild(meta);
    CH.paperFields(form).forEach(function (q) {
      var f = q.field;
      if (f.type === 'repeat') {
        for (var i = 1; i <= 3; i++) {
          var g = el('div', 'pgroup');
          g.appendChild(el('div', 'l', f.itemLabel + ' ' + i));
          f.fields.filter(on).forEach(function (s) { g.appendChild(fieldRow(s)); });
          box.appendChild(g);
        }
      } else {
        box.appendChild(fieldRow(f, q.n));
      }
    });
    root.appendChild(box);
  });
  // P1-E: choose which forms to print. Looks only: the choice lives in the address (#forms=a,b), nothing is stored or sent.
  var boxes = [].slice.call(root.querySelectorAll('.pform'));
  var ids = boxes.map(function (b) { return b.getAttribute('data-form'); });
  var printBtn = document.getElementById('print');
  var choose = document.getElementById('choose');
  var ticks = {};
  function fromAddress() {
    var m = /^#forms=([^&]*)/.exec(location.hash || '');
    var want = m ? m[1].split(',').filter(function (id) { return ids.indexOf(id) >= 0; }) : []; // unknown and switched-off forms are ignored
    return want.length ? want : ids; // nothing usable: every form ticked
  }
  function chosen() { return ids.filter(function (id) { return ticks[id].checked; }); }
  function apply(save) {
    var pick = chosen(), last = null;
    boxes.forEach(function (b) {
      var shown = pick.indexOf(b.getAttribute('data-form')) >= 0;
      b.hidden = !shown;
      b.classList.remove('last'); // the last form shown must not leave a blank page behind it
      if (shown) last = b;
    });
    if (last) last.classList.add('last');
    printBtn.disabled = !pick.length;
    printBtn.textContent = pick.length ? 'Print ' + pick.length + (pick.length === 1 ? ' form' : ' forms') : 'Tick a form to print';
    if (save && window.history && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search + (pick.length === ids.length ? '' : '#forms=' + pick.join(',')));
    }
  }
  if (choose && boxes.length) {
    var start = fromAddress();
    choose.appendChild(el('h2', 'choose-h', 'Which forms?'));
    var groups = [], byName = {};
    CH.FORMS.filter(function (form) { return ids.indexOf(form.id) >= 0; }).forEach(function (form) {
      var areas = [].concat(form.area || []);
      var name = areas.length > 1 ? 'Every area' : ((CH.AREA_TITLES || {})[areas[0]] || form.group || 'More forms');
      if (!byName[name]) { byName[name] = el('div', 'choose-g'); byName[name].appendChild(el('div', 'choose-gn', name)); groups.push(byName[name]); }
      var lab = el('label', 'choose-row');
      var box = document.createElement('input');
      box.type = 'checkbox'; box.value = form.id; box.checked = start.indexOf(form.id) >= 0;
      box.addEventListener('change', function () { apply(true); });
      ticks[form.id] = box;
      lab.appendChild(box); lab.appendChild(el('span', '', form.title));
      byName[name].appendChild(lab);
    });
    var wrap = el('div', 'choose-groups');
    groups.forEach(function (g) { wrap.appendChild(g); });
    choose.appendChild(wrap);
    var btns = el('div', 'choose-btns');
    [['All', true], ['None', false]].forEach(function (b) {
      var x = el('button', 'btn btn-secondary', b[0]); x.type = 'button';
      x.addEventListener('click', function () { ids.forEach(function (id) { ticks[id].checked = b[1]; }); apply(true); });
      btns.appendChild(x);
    });
    choose.appendChild(btns);
    apply(false);
  }
  printBtn.addEventListener('click', function () { if (!printBtn.disabled) window.print(); });
})();
