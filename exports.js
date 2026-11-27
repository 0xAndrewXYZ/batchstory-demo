/*
 * Exports page (design plan, slice 4): the QuickBooks export (qb-export.js), Export everything, and links to the Season
 * report and the paper forms. This page only asks: the Sheet decides who may export. Export everything and the
 * QuickBooks export need an admin who signed in with their own email and password (never the shared admin link),
 * and both still work while the company is paused.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  var cred = load('ch.admin', {}) || {};
  if (!cred.url || !cred.key) { if (window.CH_SIGNIN) CH_SIGNIN.show(); return; } // no admin sign-in in this browser: sign in first

  /* Export everything: one file of every tab. The button waits for your own sign-in (the Sheet checks this too). */
  var btn = $('export'), err = $('export-err');
  btn.disabled = !cred.session;
  $('export-signin').hidden = !!cred.session;
  btn.addEventListener('click', function () {
    if (btn.disabled || !window.CH_ADMIN) return;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); err.hidden = true;
    CH_ADMIN.exportAll(cred.url, cred.key).then(function (file) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      CH_ADMIN.ui.toast('Saved ' + file + '.');
    }).catch(function (e) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      err.hidden = false; err.textContent = 'Could not export (' + (e.message || e) + '). Try again.';
    });
  });
})();
