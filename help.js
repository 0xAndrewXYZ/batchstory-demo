/*
 * Help page (app 1.22.2): draws the articles of help-content.js, the list of topics beside them and the search.
 * All of it is on the page at once (nothing is read from the Sheet), so a link such as help.html#quickbooks lands on its article.
 */
(function () {
  'use strict';
  var H = window.CH_HELP, C = window.CH_CONFIG || {};
  if (!H) return;
  var $ = function (id) { return document.getElementById(id); };
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  var col = $('help-col'), list = $('help-list'), pairs = [], groups = [];
  H.articles.forEach(function (a) {
    var sec = mk('section', 'help-art'); sec.id = a.id; sec.setAttribute('aria-labelledby', a.id + '-h');
    var h = mk('h2', '', a.title); h.id = a.id + '-h'; h.tabIndex = -1;
    sec.appendChild(h);
    H.body(a, mk, { contact: C.contact }).forEach(function (n) { sec.appendChild(n); });
    col.appendChild(sec);
    var g = groups.filter(function (x) { return x.name === a.group; })[0];
    if (!g) { g = { name: a.group, box: mk('div', 'help-group'), ul: mk('ul') }; g.box.appendChild(mk('p', 'help-g', a.group)); g.box.appendChild(g.ul); list.appendChild(g.box); groups.push(g); }
    var li = mk('li'), link = mk('a', '', a.title); link.href = '#' + a.id;
    li.appendChild(link); g.ul.appendChild(li);
    pairs.push({ link: link, target: sec, li: li, group: g, text: (a.title + ' ' + sec.textContent).toLowerCase() });
  });
  if (window.CH_ADMIN && CH_ADMIN.pageNav) CH_ADMIN.pageNav(pairs);

  function go(id, focus) {
    var p = pairs.filter(function (x) { return x.target.id === id; })[0];
    if (!p) return;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    p.target.scrollIntoView({ behavior: calm || !focus ? 'auto' : 'smooth', block: 'start' });
    if (focus) p.target.querySelector('h2').focus({ preventScroll: true });
  }
  list.addEventListener('click', function (ev) {
    var a = ev.target.closest ? ev.target.closest('a') : null;
    if (!a) return;
    ev.preventDefault();
    var id = a.getAttribute('href').slice(1);
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* a file page */ }
    go(id, true);
  });
  window.addEventListener('hashchange', function () { go(String(location.hash).slice(1), true); });

  /** Marks every place a searched word is written in an article (and takes the old marks away first). */
  function marks(sec, words) {
    Array.prototype.slice.call(sec.querySelectorAll('mark')).forEach(function (m) { m.replaceWith(document.createTextNode(m.textContent)); });
    sec.normalize();
    if (!words.length) return;
    var walk = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT), nodes = [], n;
    while ((n = walk.nextNode())) nodes.push(n);
    nodes.forEach(function (t) {
      var low = t.nodeValue.toLowerCase(), at = -1, len = 0;
      words.forEach(function (w) { var i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) { at = i; len = w.length; } });
      if (at < 0) return;
      var hit = t.splitText(at); hit.splitText(len);
      var m = mk('mark', '', hit.nodeValue); hit.replaceWith(m);
    });
  }
  // search: every word must be in the article; the topics that do not match leave the list and the page
  $('help-q').addEventListener('input', function () {
    var words = this.value.toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
    pairs.forEach(function (p) {
      var ok = words.every(function (w) { return p.text.indexOf(w) >= 0; });
      p.target.hidden = !ok; p.li.hidden = !ok; if (ok) shown++;
      marks(p.target, ok ? words : []);
    });
    groups.forEach(function (g) { g.box.hidden = !pairs.some(function (p) { return p.group === g && !p.li.hidden; }); });
    $('help-none').hidden = shown > 0;
    col.classList.toggle('is-searching', words.length > 0);
  });

  // "Contact Batchstory": an address the company was given (the settings read's optional batchstory_contact, signed-in admins only).
  // Until then, and for anyone else, the line stays as words. No address is ever kept in these files.
  (function () {
    var cred = null;
    try { cred = JSON.parse(localStorage.getItem('ch.admin') || 'null'); } catch (e) { cred = null; }
    if (!cred || !cred.url || !cred.key || !cred.session || !C.read) return;
    C.read(cred.url, cred.key, 'settings').then(function (r) { return r.json(); }).then(function (j) {
      var to = String((j && j.ok && j.batchstory_contact) || '').trim(), p = $('help-contact');
      if (!p || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(to)) return; // only a plain address ever becomes a link
      var a = mk('a', 'btn btn-secondary btn-sm', 'Contact Batchstory'); a.id = 'help-contact-link'; a.href = 'mailto:' + to;
      p.replaceChildren(a);
    }).catch(function () { /* the words stay */ });
  })();

  // the sidebar's Help row is this page
  var mark = function () { var l = $('help-link'); if (l) l.setAttribute('aria-current', 'page'); };
  mark(); setTimeout(mark, 0); window.addEventListener('load', mark);
  if (location.hash) go(String(location.hash).slice(1), false);
})();
