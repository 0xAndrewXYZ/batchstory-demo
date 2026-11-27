/**
 * fresh.js: one reload when an older offline copy is still in charge (app 1.22.1).
 *
 * Why: the offline helper (sw.js) of app 1.10 kept config.js, ui.css, admin.css and other files and served them first.
 * The admin pages and the sign-in page are always fetched fresh, so on the first visit after an update a browser that
 * knew the old site showed a new page with old styles (the sign-in card in the corner) until it was reloaded.
 *
 * What: this file has a name the old helper never kept, so it always arrives fresh. It asks the browser to check sw.js;
 * if a newer helper takes over within a few seconds ("controllerchange"), the page reloads once. Only once per tab
 * (sessionStorage), never on a page that had no helper, and nothing else changes: no data, no sign-in, no network
 * besides the browser's own check of sw.js.
 */
(function () {
  'use strict';
  try {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return; // no helper in charge: nothing old can be served
    if (sessionStorage.getItem('ch.fresh') === '1') return; // reloaded once already in this tab
    var done = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (done) return; done = true;
      try { sessionStorage.setItem('ch.fresh', '1'); } catch (e) { /* ignore */ }
      location.reload();
    });
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg) return reg.update();
    }).catch(function () { /* offline or blocked: keep the page as it is */ });
    setTimeout(function () { done = true; }, 15000); // a takeover after this would interrupt someone working: leave it for the next visit
  } catch (e) { /* never stop the page */ }
})();
