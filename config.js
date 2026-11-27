/**
 * Names and addresses in one place, so the app can be renamed (or set up for a second
 * chocolate company) by editing this file, not every page. See "Renaming the app" in README.md.
 *
 *  - company: the chocolate company whose data this is (shown in the app bar and page titles).
 *  - product: the app's own name (Andrew's). Same as the company until a product name is chosen.
 *  - scriptUrl: where the admin pages' sign-in sends the username and password (the deployed /exec address).
 *  - SITES: which server each web address talks to (see "The server address" below).
 *
 * Pages keep a plain fallback in their HTML, so they still read sensibly if this file fails to load.
 */
(function () {
  'use strict';
  /*
   * The server address (P3.6). Phones and admin pages send everything to the address listed here for the web address
   * they were opened from, not to the address stored from their link. So the server can move (a new deployment, or
   * a new backend later) by changing this file, with no new links for anyone. A site not listed here (a test copy on a
   * laptop) keeps using the address from the link it was opened with. One line per company site.
   */
  var LIVE_HOST = 'cocoahead.batchstory.com';
  /*
   * The preview site (README "Preview site (before going live)"): the next version of these pages, published to its own
   * address and talking to a COPY of the Sheet with its own script. It shows a "Preview" badge, and it never talks to the
   * live script: not by itself, and not even through a live link pasted into it. Keep PREVIEW_HOST the same as the
   * repository variable PREVIEW_HOST (the preview workflow checks). Once the copy's script is deployed, put its /exec
   * address in the preview line below and take away the two slashes in front of it.
   */
  var PREVIEW_HOST = 'preview.batchstory.com';
  /*
   * The demo site (handbook/operations.md "Set up the demo company"): the live version of these pages (from main), published
   * to its own address and talking to the DEMO company's own Sheet, which holds only made-up data. Like the preview it never
   * talks to the live script, and its labels' QR codes point at the demo site, not the live one. Every page there shows a
   * "Demo · made-up data" label. Keep DEMO_HOST the same as the repository variable DEMO_HOST (the demo workflow checks).
   * Once the demo Sheet's script is deployed, put its /exec address in the demo line below and take away the two slashes.
   */
  var DEMO_HOST = 'demo.batchstory.com';
  var SITES = {
    'cocoahead.batchstory.com': { scriptUrl: 'https://script.google.com/macros/s/AKfycby_ECGvVwGI3oIvqzRiumdI-TaJMNDxKc70dMX1Z5DE7P9a01kD0EWnaMbmdQstMaoZyQ/exec' },
    'preview.batchstory.com': { scriptUrl: 'https://script.google.com/macros/s/AKfycbwajWJY3x6hLd4UmJjr3hhsZXx_qgvVzPN4O0LOveTJ2eKuisBLKswYQL01oe8EKBOe1A/exec' },
    'demo.batchstory.com': { scriptUrl: 'https://script.google.com/macros/s/AKfycbyFOlPTRzrI3nsSu4iXoRHjHN0KWCei-xaWqT_nDYakqre_OcxpSnjoDIwC6TZqKfzo/exec' },
  };
  var C = (typeof window !== 'undefined' ? window : globalThis).CH_CONFIG = { // globalThis: read by the tests in Node too
    company: 'Cocoahead',
    product: 'Cocoahead',
    fieldAppName: 'Field Log',
    // where packages are shipped to (the Ship form's hint says "Packages leaving for …", package labels say "Ship to …");
    // empty leaves the place out. The same as Code.gs CFG.SHIP_TO (tests/config.test.js checks); the Company settings page
    // can change it for one company (it then comes from the server, see "The company's own settings" below).
    shipTo: 'Walpole',
    // The names of the areas of the work: the headings of the forms on a phone's home screen and the People page's tick boxes.
    // The keys never change; rename the words here. The one source of truth with Code.gs CFG.AREA_NAMES (tests/config.test.js
    // checks they agree). On the People page the script's answer wins, so the AREA_NAMES script property also renames them.
    areas: { fermentation: 'Fermentation', roasting: 'Roasting', making: 'Making' },
    // Units that are a choice. makingTemp: the temperatures of Making (stage 3: conching, grinder or press), the unit in the
    // Batches columns' names ("Conche temp °F"). The one place for the pages; Code.gs CFG.MAKING_TEMP_UNIT must say the same
    // (tests/config.test.js checks). [Assumption: Walpole is in the US, so °F. See README "Making (Walpole)" before changing it.]
    units: { makingTemp: '°F' },
    // who workers should ask for a new link or help (shown on phones)
    contact: 'Jake',
    // The Sheet's web app address, so admins can sign in on a fresh laptop with no link. Not secret.
    // Built from apps-script/deploy.json's deploymentId (tests/config.test.js checks they agree).
    // Brand hooks: the one place names and logos come from; pages and the sign-in card read them.
    //  - logo: the company's picture beside its name (any [data-brand-logo] image). wordmark: a picture of the name; when set it replaces the text.
    //  - productLogo: the app maker's angled mark (a file in brand/: swap the file, nothing else). productUrl: its web address.
    //  - poweredBy: true shows a small grey "powered by <product>" line (plain text). The sign-in card alone shows the full lockup (mark + wordmark).
    //  - emailColor: the button colour in emails (R4). There is no per-company colour: a company changes its logo and name only.
    brand: { product: 'Batchstory', company: 'Cocoahead', logo: 'icons/cocoahead-64.png', wordmark: '', productLogo: 'brand/batchstory-mark.svg', productUrl: 'https://batchstory.com', poweredBy: true, emailColor: '#1D1B18' },
    scriptUrl: 'https://script.google.com/macros/s/AKfycby_ECGvVwGI3oIvqzRiumdI-TaJMNDxKc70dMX1Z5DE7P9a01kD0EWnaMbmdQstMaoZyQ/exec',
    sites: SITES,
    // The address printed in every label's QR code (batch.html?f= / ?p=): the company's live site, whatever computer prints it.
    // Labels last for years, so this must keep answering. Same as the SITES entry above.
    labelBase: 'https://cocoahead.batchstory.com/',
  };

  var host = '', hostname = '';
  try { host = String(location.host || '').toLowerCase(); hostname = String(location.hostname || host.replace(/:\d+$/, '')).toLowerCase(); } catch (e) { /* not a web page */ }
  /** The preview site (see PREVIEW_HOST above): shows a badge and never uses the live script. */
  C.preview = !!PREVIEW_HOST && hostname === PREVIEW_HOST;
  /** The demo site (see DEMO_HOST above): shows the Demo label and never uses the live script. */
  C.demoSite = !!DEMO_HOST && hostname === DEMO_HOST;
  var notLive = C.preview || C.demoSite; // a site that must never talk to the live script
  // The demo site's own first look (2026-11-21): before the demo company's answer names it, show a neutral demo name and the
  // Batchstory mark, never Cocoahead's name, logo or contact. The demo company's settings replace these once known.
  if (C.demoSite) { C.company = 'Batchstory demo'; C.brand.company = 'Batchstory demo'; C.brand.logo = C.brand.productLogo; C.contact = 'your manager'; }
  var onLive = hostname === LIVE_HOST; // the live site: exactly its name (no trailing dot, no other address)
  var local = hostname === 'localhost' || hostname === '127.0.0.1'; // this computer (the tests and npm run serve)
  C.site = Object.prototype.hasOwnProperty.call(SITES, host) ? SITES[host] : null;
  /*
   * 2.7.3 review (M1): on the preview or demo site, every server address in SITES except this site's own is refused: the live
   * script and the other test site's script are never used, kept from a link, or accepted on this site's own line by mistake.
   */
  var foreign = [];
  Object.keys(SITES).forEach(function (h) { if (h !== host && SITES[h] && SITES[h].scriptUrl) foreign.push(SITES[h].scriptUrl); });
  function refused(u) { return notLive && foreign.indexOf(String(u || '')) >= 0; }
  // Review fix (item 4): an admin's turn secret waits in ch.admin only for the moment between the sign-in page and the field
  // app on a shared tablet. Any other page, or the field app more than 2 minutes later, removes it as the page loads.
  try {
    var adm = JSON.parse(localStorage.getItem('ch.admin') || 'null');
    if (adm && adm.turn) {
      var fieldApp = /(^|\/)(index\.html)?$/.test(location.pathname);
      var fresh = Date.now() - (Date.parse(adm.turn.at || '') || 0) < 120000;
      if (!fieldApp || !fresh) { delete adm.turn; localStorage.setItem('ch.admin', JSON.stringify(adm)); }
    }
  } catch (e) { /* no storage: nothing kept */ }
  if (C.site && refused(C.site.scriptUrl)) C.site = null; // another site's address (the live one, or the other test site's) written on this line by mistake
  if (C.site && C.site.scriptUrl) C.scriptUrl = C.site.scriptUrl; // the sign-in on a fresh laptop goes here too
  // 2.7.3 review (M3): with no line of its own, a page signs in at the live script only on the live site itself (or this computer,
  // for the tests); anywhere else (the preview or demo with no line yet, an old github.io address, a trailing-dot or unknown
  // host) there is no default: only the address from that browser's own link.
  else if (notLive || !(onLive || local)) C.scriptUrl = '';
  /**
   * Is this a server address a link may carry? Only a Google Apps Script web app (…/macros/s/<id>/exec), or this
   * computer for tests. Every page checks it before keeping a link, so a link can never point a phone somewhere else.
   * On the preview and demo sites a link to the live script (or to the other test site's) is not kept either.
   */
  C.goodScriptUrl = function (u) {
    if (refused(u)) return false;
    return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '')) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/exec$/.test(String(u || ''));
  };
  /** Where to send a request: this site's own server, else `stored` (the address kept from the link this browser was opened with). */
  C.scriptFor = function (stored) {
    if (C.site && C.site.scriptUrl) return C.site.scriptUrl;
    if (refused(stored)) return ''; // never the live script (or the other test site's) from the preview or demo site
    return stored || '';
  };
  /** A request to the server, always by POST, so no key or sign-in ever goes in a web address. */
  C.ask = function (stored, body) {
    return fetch(C.scriptFor(stored), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  };
  /*
   * 2.4.6 review: the last dashboard / batch-page copy kept in this browser ("ch.dash", "ch.batchdata") remembers which
   * server it came from (the address requests really go to) and, by a short fingerprint, which key or sign-in fetched it.
   * A copy from another server is never drawn (another company on a site not listed in SITES) and is deleted; a copy with
   * money is drawn only for an admin's sign-in or link, or for the same key that fetched it (a person who may see money).
   */
  function fingerprint(key) { var h = 5381, t = String(key || ''); for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function from(stored) { return C.scriptFor(stored) || String(stored || ''); }
  C.keepCopy = function (name, data, stored, key) {
    if (!data || typeof data !== 'object') return;
    var copy = {};
    Object.keys(data).forEach(function (k) { copy[k] = data[k]; });
    copy.__from = from(stored); copy.__k = fingerprint(key);
    try { localStorage.setItem(name, JSON.stringify(copy)); } catch (e) { /* storage full or blocked: just no copy */ }
  };
  /** own (2.7.1): only a copy the same key or sign-in fetched (the admin pages' kept copies), whatever is in it. */
  C.keptCopy = function (name, stored, key, admin, own) {
    var c = null;
    try { c = JSON.parse(localStorage.getItem(name) || 'null'); } catch (e) { c = null; }
    if (!c || typeof c !== 'object') return null;
    var ok = !!c.__from && c.__from === from(stored) && (own ? c.__k === fingerprint(key) : (c.money !== true || admin || c.__k === fingerprint(key)));
    if (!ok) { try { localStorage.removeItem(name); } catch (e) { /* ignore */ } return null; }
    return c;
  };
  /*
   * 2.5.0 "nothing changed". A page that holds a copy of read data (one keptCopy allowed it to use) sends its stamp as
   * {since: copy.rev}. If the server answers {unchanged: true}, C.withCopy gives the copy back with the answer's fresh parts
   * (time, asks, company, email banner) put in. null means "read it in full": the answer is not for this copy (another
   * stamp or view), so the copy is never used for it.
   */
  // 2.7.1 review: pins too (an admin's "many wrong PINs" item); every FRESH key of the copy is dropped, whatever the answer holds
  var FRESH = ['ok', 'version', 'at', 'asks', 'pins', 'company', 'my_email_change', 'rev'];
  C.sinceOf = function (copy) { return copy && typeof copy.rev === 'string' ? { since: copy.rev } : null; };
  /** any (2.7.1): an answer of another read (entries, history, quickbooks), whose copy has no tabs. */
  C.withCopy = function (p, copy, any) {
    if (!p || p.unchanged !== true) return p;
    if (!p.ok || !copy || copy.rev !== p.rev || copy.admin !== p.admin || copy.money !== p.money || !(any || copy.tabs)) return null;
    var out = {};
    Object.keys(copy).forEach(function (k) { if (k.indexOf('__') !== 0 && FRESH.indexOf(k) < 0) out[k] = copy[k]; });
    FRESH.forEach(function (k) { if (p[k] !== undefined) out[k] = p[k]; });
    return out;
  };

  /*
   * 2.7.1: "read just now". The sign-in page keeps the dashboard data its sign-in answer carried, and marks it here (this
   * browser tab only, for the sign-in that read it). The dashboard then draws it without a request of its own, once, and
   * only within C.JUST_READ_MS; after that, or for another sign-in, it reads as always.
   * C.justRead(name, key, true) marks; C.justRead(name, key) asks (and forgets the mark either way).
   */
  C.JUST_READ_MS = 60000;
  /** 2.7.1: forgets every admin view's kept copy ("ch.v.*") and quick copy ("ch.c.*"): at sign-out, and at each new sign-in. 1.26.1: and the field app's records ("ch.records", My entries). */
  C.dropCopies = function () {
    try { localStorage.removeItem('ch.records'); localStorage.removeItem('ch.lists.queue'); } catch (e0) { /* ignore */ } // 1.30.1: the Answer choices changes not sent yet go with the sign-in
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('ch.v.') === 0) localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
    try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf('ch.c.') === 0 || k.indexOf('ch.justread.') === 0) sessionStorage.removeItem(k); }); } catch (e2) { /* ignore */ }
  };
  C.justRead = function (name, key, mark) {
    var k = 'ch.justread.' + name;
    try {
      if (mark) { sessionStorage.setItem(k, JSON.stringify({ k: fingerprint(key), at: Date.now() })); return true; }
      var m = JSON.parse(sessionStorage.getItem(k) || 'null');
      sessionStorage.removeItem(k);
      var age = m ? Date.now() - Number(m.at) : NaN;
      return !!(m && m.k === fingerprint(key) && age >= 0 && age < C.JUST_READ_MS);
    } catch (e) { return false; }
  };

  /** A read: what is 'lists', 'data', 'entries' or 'users'; extra adds fields such as {limit, before} for entries. */
  /**
   * A typed number, read the way the Sheet's script reads it (Code.gs toNumber_): commas are thousands separators only when they
   * group the digits in threes ("1,234.5"); otherwise a comma is the decimal point ("2,5" is 2.5, never 25). Not a number: null.
   * One helper for every page that works with a typed amount (Entries, the Exports page's delivery panel).
   */
  C.toNumber = function (v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v === null || v === undefined) return null;
    var t = String(v).trim().replace(/\s/g, '');
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
    else t = t.replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };
  C.read = function (stored, key, what, extra) {
    var body = { key: key, action: 'read', what: what };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return C.ask(stored, body);
  };

  /*
   * Light or dark. 'auto' (the default) follows the device; 'light'/'dark' is a choice kept in this browser.
   * Each page loads this file in <head>, so the colours are right before anything is drawn.
   */
  // 1.25.2: the field app (index.html) starts Light, not "Match phone": it is used outdoors in the sun, and many of the phones
  // it runs on are set to dark. A choice made in Settings (Match phone too) is kept and wins. Admin pages still follow the device.
  var FIELD_PAGE = typeof location !== 'undefined' && /^\/(index\.html)?$/.test(location.pathname); // the site root only (the field app), never another index.html
  function storedTheme() { var d = FIELD_PAGE ? 'light' : 'auto'; try { return localStorage.getItem('ch.theme') || d; } catch (e) { return d; } }
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  C.theme = function () { return storedTheme(); };
  /** The theme actually showing now: 'light' or 'dark'. */
  C.shownTheme = function () {
    var t = storedTheme();
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  C.setTheme = function (t) {
    try { localStorage.setItem('ch.theme', t === 'light' || t === 'dark' ? t : 'auto'); } catch (e) { /* private window: still applies now */ } // 1.25.2: "Match phone" is kept too, so it is not mistaken for no choice
    applyTheme(t);
  };
  /*
   * The company's own settings (2.1.0). Admins change the company's name, short name, contact, area names, "ship to" place
   * and logo on the Company settings page. The server sends what that page set (company.custom) and the logo's version
   * (company.logo_v) with every read; this browser keeps a copy ("ch.company") and uses it from the first moment a page
   * loads (before schema.js reads the area names), so it also works with no signal. Names reach the page only as text
   * (textContent), the logo only as an <img src> that is a small data:image/png|jpeg|webp;base64 address (C.goodLogo).
   * Nothing set: the names above, and the bundled logo.
   */
  var STANDARD = { company: C.company, contact: C.contact, shipTo: C.shipTo, areas: JSON.parse(JSON.stringify(C.areas)), logo: C.brand.logo, brandCompany: C.brand.company, labelBase: C.labelBase };
  C.standard = STANDARD;
  var LOGO_MAX = 40000; // Code.gs CFG.LOGO_MAX
  C.goodLogo = function (v) { return typeof v === 'string' && v.length <= LOGO_MAX && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/]+={0,2}$/.test(v); };
  /** A name from the server: text of at most max characters with no control characters or markup, else '' (not used). */
  function plainText(v, max) {
    if (typeof v !== 'string') return '';
    var t = v.replace(/ +/g, ' ').trim();
    return t.length <= max && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff<>"`\\{}]/.test(t) ? t : '';
  }
  function loadCompany() { try { return JSON.parse(localStorage.getItem('ch.company') || 'null') || {}; } catch (e) { return {}; } }
  function useCompany(k) {
    var cu = (k && k.custom) || {};
    C.company = plainText(cu.company_name, 60) || STANDARD.company;
    C.brand.company = plainText(cu.company_name, 60) || STANDARD.brandCompany;
    C.short = plainText(cu.short_name, 12);
    C.contact = plainText(cu.contact_name, 60) || STANDARD.contact;
    C.shipTo = typeof cu.ship_to === 'string' && (cu.ship_to === '' || plainText(cu.ship_to, 60)) ? plainText(cu.ship_to, 60) : STANDARD.shipTo;
    C.areas = {};
    Object.keys(STANDARD.areas).forEach(function (a) { C.areas[a] = plainText(((cu.areas || {})[a]), 40) || STANDARD.areas[a]; });
    C.brand.logo = k && C.goodLogo(k.logo) && k.logo ? k.logo : STANDARD.logo;
    C.logoV = k && k.logo && C.goodLogo(k.logo) ? String(k.logo_v || '') : '';
    C.forms = cleanForms(k && k.forms);
    C.photos = !!(k && k.photos === true); // P4-A: the server's photo switch (script property PHOTOS): phones show a camera button only when true
    // The Demo label: on the demo site, or when the server says so (script property DEMO), but never on the live site (2.7.3
    // review M4). While it shows, labels point at the demo site, so a demo label's QR code never opens the live one.
    C.demo = C.demoSite || (!onLive && !!(k && k.demo === true));
    C.labelBase = C.demo ? 'https://' + DEMO_HOST + '/' : STANDARD.labelBase;
  }

  /*
   * What this company tracks (2.3.0, Settings → What you track): its choices from Batchstory's master menu (schema.js MENU).
   * From the server with every answer (company.forms, v '' = nothing switched off): areas_off / forms_off / hidden {form: [keys]}
   * are off; areas_on / forms_on / shown {form: [keys]} are menu items that start off and this company switched on. Anything
   * not named follows the menu's default (dflt). Kept in "ch.company" with the rest, so a phone with no signal keeps the same
   * forms. Anything that does not look right is ignored, and all three areas can never be off at once: then everything shows.
   */
  var AREA_KEYS = ['fermentation', 'roasting', 'making'];
  var NAME = /^[a-z_]{1,40}$/, PATH = /^[a-z_]{1,40}(\.[a-z_]{1,40})?$/;
  function cleanForms(f) {
    var out = { v: '', areas_off: [], areas_on: [], forms_off: [], forms_on: [], hidden: {}, shown: {} };
    if (!f || typeof f !== 'object') return out;
    out.v = typeof f.v === 'string' && /^[0-9a-f]{0,32}$/.test(f.v) ? f.v : '';
    var names = function (a, ok) { return (Array.isArray(a) ? a : []).filter(function (x, i, all) { return typeof x === 'string' && ok(x) && all.indexOf(x) === i; }).slice(0, 60); };
    out.areas_off = names(f.areas_off, function (a) { return AREA_KEYS.indexOf(a) >= 0; });
    out.areas_on = names(f.areas_on, function (a) { return AREA_KEYS.indexOf(a) >= 0 && out.areas_off.indexOf(a) < 0; });
    if (out.areas_off.length >= AREA_KEYS.length) out.areas_off = [];
    out.forms_off = names(f.forms_off, function (x) { return NAME.test(x); });
    out.forms_on = names(f.forms_on, function (x) { return NAME.test(x) && out.forms_off.indexOf(x) < 0; });
    ['hidden', 'shown'].forEach(function (part) {
      var h = f[part] && typeof f[part] === 'object' ? f[part] : {};
      Object.keys(h).forEach(function (form) {
        if (!NAME.test(form) || !Array.isArray(h[form])) return;
        var keys = names(h[form], function (k) { return PATH.test(k) && !(part === 'shown' && (out.hidden[form] || []).indexOf(k) >= 0); });
        if (keys.length) out[part][form] = keys;
      });
    });
    return out;
  }
  C.forms = cleanForms(null);
  /** The company's choice, else the menu's default ('off' = starts off). */
  function chosen(off, on, k, dflt) { return off.indexOf(k) >= 0 ? false : on.indexOf(k) >= 0 ? true : dflt !== 'off'; }
  /** Is this area of the work switched on? */
  C.areaOn = function (a, dflt) { return chosen(C.forms.areas_off, C.forms.areas_on, a, dflt); };
  /** Is this form (one on the menu by itself) switched on? */
  C.formOn = function (form, dflt) { return chosen(C.forms.forms_off, C.forms.forms_on, form, dflt); };
  /** Is this optional question of this form switched on? (schema.js asks only for optional questions.) */
  C.fieldOn = function (form, path, dflt) { return chosen(C.forms.hidden[form] || [], C.forms.shown[form] || [], path, dflt); };
  /** Use and keep new form settings only (the Settings page right after a change, and the tests). */
  C.setForms = function (f) {
    var had = loadCompany();
    had.forms = cleanForms(f);
    try { localStorage.setItem('ch.company', JSON.stringify(had)); } catch (e) { /* private window: still used now */ }
    C.forms = had.forms;
  };
  /**
   * The company part of a server answer ({name, contact, custom, logo_v, logo?}). Keeps it in this browser, uses it at once and
   * fills the brand slots again. Returns true when the logo changed but this answer did not carry it (the page then asks
   * for it with read "company"); a logo that is not a small picture is never kept.
   */
  C.setCompany = function (c) {
    if (!c || typeof c !== 'object') return false;
    var had = loadCompany(), next = { custom: c.custom && typeof c.custom === 'object' ? c.custom : {}, logo: had.logo || '', logo_v: had.logo_v || '' };
    next.forms = c.forms && typeof c.forms === 'object' ? cleanForms(c.forms) : had.forms; // 2.3.0: an older server sends none: keep what we had
    if (c.photos === true) next.photos = true; // P4-A: the server's photo switch; every answer says it again (an answer without it: off)
    if (c.demo === true) next.demo = true; // 2.7.3: the demo company (its script property DEMO = yes); every answer says it again
    var want = typeof c.logo_v === 'string' ? c.logo_v : next.logo_v, need = false;
    if (typeof c.logo === 'string' && (c.logo === '' || C.goodLogo(c.logo))) { next.logo = c.logo; next.logo_v = c.logo ? want : ''; }
    else if (want === '') { next.logo = ''; next.logo_v = ''; }
    else if (want !== next.logo_v) need = true; // a new logo: keep showing the old one until it arrives
    try { localStorage.setItem('ch.company', JSON.stringify(next)); } catch (e) { /* private window: still used now */ }
    useCompany(next);
    if (typeof document !== 'undefined' && C.applyBrand) C.applyBrand();
    if (typeof document !== 'undefined' && C.demoMark) C.demoMark();
    return need;
  };
  /** The logo version this browser has ('' for the bundled one), for lists ("logo_v"). */
  C.logoVersion = function () { return String(loadCompany().logo_v || ''); };
  useCompany(loadCompany());

  if (typeof document === 'undefined') { if (typeof module !== 'undefined' && module.exports) module.exports = C; return; } // Node (tests): the settings only
  applyTheme(storedTheme());

  /**
   * Fill the brand slots from CH_CONFIG.brand (falling back to the plain names above): [data-brand] text, [data-brand-logo] and
   * [data-brand-wordmark] pictures, the [data-brand-poweredby] lockup (hidden while poweredBy is false), and the page title.
   * Pass a part of the page to fill only that part (the sign-in card is drawn after the page loads).
   */
  function apply(root) {
    root = root && root.querySelectorAll ? root : document;
    var B = C.brand || {};
    var company = B.company || C.company;
    var nodes = root.querySelectorAll('[data-brand]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-brand');
      var v = B[k] || C[k];
      if (v) nodes[i].textContent = v;
      // 2.1.0: a short name (Company settings) replaces the name in a narrow app bar (ui.css .brand.has-short)
      var bar = k === 'company' && nodes[i].parentNode && nodes[i].parentNode.classList && nodes[i].parentNode.classList.contains('brand') ? nodes[i].parentNode : null;
      if (bar) {
        var sh = bar.querySelector('.brand-short');
        if (C.short && !sh) { sh = document.createElement('span'); sh.className = 'brand-short'; sh.setAttribute('aria-hidden', 'true'); nodes[i].parentNode.insertBefore(sh, nodes[i].nextSibling); }
        if (sh) sh.textContent = C.short || '';
        bar.classList.toggle('has-short', !!C.short);
      }
    }
    var logos = root.querySelectorAll('[data-brand-logo]');
    for (var j = 0; j < logos.length; j++) if (B.logo && (B.logo === STANDARD.logo || C.goodLogo(B.logo))) logos[j].setAttribute('src', B.logo);
    var marks = root.querySelectorAll('[data-brand-wordmark]');
    for (var m = 0; m < marks.length; m++) {
      if (!B.wordmark) continue;
      marks[m].setAttribute('src', B.wordmark); marks[m].hidden = false;
      var text = marks[m].parentNode && marks[m].parentNode.querySelector('[data-brand]'); // the picture replaces the name next to it
      if (text) text.hidden = true;
    }
    var by = root.querySelectorAll('[data-brand-poweredby]');
    for (var b = 0; b < by.length; b++) { by[b].textContent = 'powered by ' + (B.product || C.product); by[b].hidden = !B.poweredBy; }
    // the full lockup (sign-in card only): "powered by", the angled mark, and the name in the wordmark face
    var lk = root.querySelectorAll('[data-brand-lockup]');
    for (var l = 0; l < lk.length; l++) {
      var node = lk[l]; node.textContent = ''; node.hidden = !B.poweredBy;
      node.appendChild(document.createTextNode('powered by '));
      if (B.productLogo) { var img = document.createElement('img'); img.alt = ''; img.src = B.productLogo; node.appendChild(img); }
      var nm = document.createElement('span'); nm.className = 'wordmark-text'; nm.textContent = B.product || C.product; node.appendChild(nm);
    }
    if (root === document && company !== 'Cocoahead') document.title = document.title.replace(/Cocoahead/g, company);
    if (root === document && C.lastTitleCompany && C.lastTitleCompany !== company) document.title = document.title.split(C.lastTitleCompany).join(company); // renamed again on this page
    if (root === document) C.lastTitleCompany = company;
  }
  C.applyBrand = apply;
  /** The preview site's badge (ui.css .preview-badge), so nobody mistakes it for the live site. It never takes a tap. */
  function previewBadge() {
    if (!C.preview || !document.body || document.getElementById('preview-badge')) return;
    var b = document.createElement('div');
    b.id = 'preview-badge'; b.className = 'preview-badge'; b.setAttribute('role', 'note');
    b.textContent = 'Preview: a test copy, not the live data';
    document.body.appendChild(b);
  }
  C.previewBadge = previewBadge;
  /**
   * The demo label (2.7.3, ui.css .demo-mark): "Demo · made-up data", so nobody mistakes the demo company for a real one.
   * Shown while C.demo is true (the demo site, or the server's company.demo, which only the script property DEMO sets).
   * Admin pages: first in the app bar's tools (the top bar on a phone, the sidebar's foot on a laptop). The field app: in its
   * top bar beside the name. Any other page (sign-in, paper forms): a small fixed label in the top corner. Text only; no tap.
   */
  function demoMark() {
    if (!document.body) return;
    var had = document.getElementById('demo-mark');
    if (!C.demo) { if (had && had.parentNode) had.parentNode.removeChild(had); return; }
    if (had) return;
    var m = document.createElement('span');
    m.id = 'demo-mark'; m.className = 'demo-mark'; m.setAttribute('role', 'note'); m.title = 'Demo: made-up data, not a real company';
    var b = document.createElement('b'); b.textContent = 'Demo';
    var more = document.createElement('span'); more.className = 'demo-more'; more.textContent = ' · made-up data';
    m.appendChild(b); m.appendChild(more);
    var tools = document.querySelector('.appbar-tools'), bar = document.querySelector('.bar-in');
    if (tools) tools.insertBefore(m, tools.firstChild);
    else if (bar) { var brand = bar.querySelector('.brand'); bar.insertBefore(m, brand ? brand.nextSibling : bar.firstChild); }
    else { m.className += ' demo-float'; document.body.appendChild(m); }
  }
  C.demoMark = demoMark;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(); previewBadge(); demoMark(); });
  else { apply(); previewBadge(); demoMark(); }
})();
