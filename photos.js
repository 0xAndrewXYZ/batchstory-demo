/*
 * Photos on checks (P4-A). Camera first, one standard size, kept on this phone, sent AFTER their entry.
 *
 * The field app (app.js) uses:
 *   CH_PHOTOS.shrink(file)                 → a JPEG Blob, longest side 1280 px, quality 0.7 (about 150-300 KB). Drawing it on a
 *                                            canvas drops everything else the camera put in the file, its location included.
 *   CH_PHOTOS.keep(entryId, field, blob, o) → the photo's record, kept in this phone's own database "cocoahead-photos" (never the
 *                                            entries' database, never localStorage). The draft keeps only d.<field> = [photo_id].
 *   CH_PHOTOS.sendDue(o)                   → sends waiting photos one at a time, only for entries the server has answered, never
 *                                            while entries are waiting to go. Its own promise; it never changes an entry.
 *   CH_PHOTOS.forEntry(id), .tidy(known), .drop(id), .preview(id), .waitingCount()
 * The admin pages use CH_PHOTOS.view(o): an entry's or a ferment's photos, read from the server (admins only) as data: images.
 * P4-B/2 (scanning a paper form): CH_PHOTOS.shrink(file, {side: 2000, maxBytes: 4000000}) and CH_PHOTOS.scans.keep / get / drop,
 *   the scan's photo in its own database "cocoahead-scans" until its form is saved; CH_PHOTOS.base64(blob). Never sent as a photo.
 *
 * Data safety: a photo can never delay, block or lose an entry. Entries are saved and sent exactly as before; photos have their
 * own database and their own sending, after the entries, wholly in a try (app.js). A photo is kept until the server says
 * "saved" or "duplicate"; then its picture is dropped and a small record stays. "error", no connection, a switched-off link or
 * a paused company: it stays waiting and is tried again later with the same photo_id (the server files a photo_id only once).
 * The phone keeps at most CAP photos and MAX_TOTAL bytes, and none when the browser's free room is short, so photos can never
 * crowd out entries on a cheap phone.
 */
(function (root) {
  'use strict';
  var DB_NAME = 'cocoahead-photos', META = 'photos', BLOBS = 'blobs';
  var MAX_SIDE = 1280, QUALITY = 0.7, MAX_BYTES = 600000; // MAX_BYTES: Code.gs CFG.PHOTO_MAX_BYTES
  // Bounded on a cheap phone, whose storage the entries share (review M4): at most CAP photos and MAX_TOTAL bytes kept, and
  // never when the browser's free allowance is under FREE_MIN or three times the photo
  var CAP = 60, MAX_TOTAL = 30000000, FREE_MIN = 50000000;
  var KEEP_SENT_DAYS = 400, KEEP_REFUSED_DAYS = 60, ORPHAN_DAYS = 2;
  var BACKOFF_MIN = 60000, BACKOFF_MAX = 6 * 3600000; // review M1: 1, 2, 4… minutes between tries of one photo, at most 6 hours
  var STUCK = 3; // review L5: this many photos in a row answered "error" end the run (the rest wait for the next one)
  var USED = 'ch.photos_used', WAIT = 'ch.photo_wait'; // a photo was ever kept here (so the database is never made for nothing); the day cap's "not before" (a time only)
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        // the records (small) and the pictures (big) apart, so listing photos never loads every picture into memory
        var s = db.createObjectStore(META, { keyPath: 'photo_id' });
        s.createIndex('entry_id', 'entry_id');
        db.createObjectStore(BLOBS);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { dbp = null; reject(req.error); };
    });
    return dbp;
  }
  function tx(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(stores, mode), out;
        out = fn(t);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Interrupted')); };
      });
    });
  }
  function uid() {
    if (root.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  /* ---------- the picture: decode, shrink, JPEG ---------- */
  function unreadable() { return new Error('This photo could not be read. Try again.'); }
  function viaImage(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(unreadable()); };
      fr.onload = function () {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(unreadable()); };
        img.src = String(fr.result); // a data: address (the pages' CSP allows img-src data:, nothing more)
      };
      fr.readAsDataURL(file);
    });
  }
  /**
   * Decoded the right way up (browsers honour the camera's orientation for both ways) and, where the browser can, already
   * small (resizeWidth / resizeHeight), so a phone with 1-2 GB never holds a whole 12-megapixel picture: 1280 wide first,
   * and 1280 high instead when that comes out taller than wide.
   */
  function decode(file, side) {
    if (typeof root.createImageBitmap !== 'function') return viaImage(file);
    var bm = function (o) { return root.createImageBitmap(file, o); };
    return bm({ imageOrientation: 'from-image', resizeWidth: side, resizeQuality: 'high' }).then(function (b) {
      if (b.height <= side) return b;
      if (b.close) b.close();
      return bm({ imageOrientation: 'from-image', resizeHeight: side, resizeQuality: 'high' });
    }).catch(function () {
      return bm({ imageOrientation: 'from-image' }).catch(function () { return bm(); }).catch(function () { return viaImage(file); });
    });
  }
  function encode(canvas, q) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) { canvas.toBlob(function (b) { if (b) resolve(b); else reject(unreadable()); }, 'image/jpeg', q); return; }
      try {
        var url = canvas.toDataURL('image/jpeg', q), bin = atob(url.split(',')[1]), a = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        resolve(new Blob([a], { type: 'image/jpeg' }));
      } catch (e) { reject(unreadable()); }
    });
  }
  function draw(src, side) {
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    if (!(w > 0 && h > 0)) throw unreadable();
    var s = Math.min(1, side / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // a see-through picture comes out on white, not black
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  /**
   * One standard size: longest side 1280 px, JPEG 0.7; smaller or plainer until it is under the server's limit.
   * P4-B/2: o.side and o.maxBytes for a scanned paper form (2000 px, 4 MB: the handwriting must stay legible).
   */
  function shrink(file, o) {
    o = o || {};
    var side = o.side || MAX_SIDE, cap = o.maxBytes || MAX_BYTES;
    if (!file || (file.type && !/^image\//.test(file.type))) return Promise.reject(unreadable());
    return decode(file, side).then(function (src) {
      var tries = side === MAX_SIDE ? [[MAX_SIDE, QUALITY], [MAX_SIDE, 0.55], [MAX_SIDE, 0.4], [960, 0.5], [720, 0.5]]
        : [[side, 0.85], [side, 0.7], [side, 0.55], [Math.round(side * 0.75), 0.6]];
      function next(i) {
        var c = draw(src, tries[i][0]);
        return encode(c, tries[i][1]).then(function (b) {
          c.width = c.height = 0; // let the memory go at once on a small phone
          if (b.size <= cap || i === tries.length - 1) { if (src.close) src.close(); if (b.size > cap) throw unreadable(); return b; }
          return next(i + 1);
        });
      }
      return next(0);
    }).catch(function () { throw unreadable(); });
  }
  function bufOf(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (resolve, reject) { var fr = new FileReader(); fr.onload = function () { resolve(fr.result); }; fr.onerror = function () { reject(fr.error); }; fr.readAsArrayBuffer(blob); });
  }
  function b64(buf) {
    var a = new Uint8Array(buf), out = '', CH = 0x8000;
    for (var i = 0; i < a.length; i += CH) out += String.fromCharCode.apply(null, a.subarray(i, i + CH));
    return btoa(out);
  }

  /* ---------- kept on this phone ---------- */
  function all() { return tx([META], 'readonly', function (t) { return t.objectStore(META).getAll(); }).then(function (r) { return r || []; }); }
  function holds(r) { return r.status === 'waiting' || (r.status === 'refused' && !r.dropped); }
  function waitingCount() { return all().then(function (rows) { return rows.filter(holds).length; }); }
  function used() { try { return localStorage.getItem(USED) === '1'; } catch (e) { return false; } }
  function full(words) { var e = new Error(words); e.full = true; return e; }
  /** The browser's room for this site (navigator.storage.estimate), or null when it cannot tell. */
  function room() {
    if (!(root.navigator && navigator.storage && navigator.storage.estimate)) return Promise.resolve(null);
    return navigator.storage.estimate().then(function (e) { return e && e.quota > 0 ? Math.max(0, e.quota - (e.usage || 0)) : null; }, function () { return null; });
  }
  /**
   * Keeps a shrunk photo for an entry (its draft's one entry ID). o: {form, n}. Refused (err.full) when CAP photos or
   * MAX_TOTAL bytes are already kept, or the browser's free room is short: entries share that room, and a photo must never
   * be why an entry cannot be saved. The count and the write are one transaction, so two quick photos never pass the cap
   * together. The first photo asks the browser to keep this site's storage (navigator.storage.persist).
   */
  function keep(entryId, field, blob, o) {
    o = o || {};
    var buf;
    if (root.navigator && navigator.storage && navigator.storage.persist) { try { navigator.storage.persist().catch(function () {}); } catch (e) { /* only asked */ } }
    return bufOf(blob).then(function (b) {
      buf = b;
      return room();
    }).then(function (free) {
      if (free !== null && (free < FREE_MIN || free < 3 * buf.byteLength)) throw full('This phone is nearly full, so the photo was not kept. Your entries are safe. Send what is waiting, then try again.');
      var rec = { photo_id: uid(), entry_id: String(entryId), form: String(o.form || ''), field: String(field), n: Number(o.n) || 1, bytes: buf.byteLength,
        taken_at: new Date().toISOString(), status: 'waiting', tries: 0 };
      var problem = '';
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction([META, BLOBS], 'readwrite');
          var q = t.objectStore(META).getAll();
          q.onsuccess = function () {
            var held = (q.result || []).filter(holds);
            var bytes = held.reduce(function (n, r) { return n + (Number(r.bytes) || 0); }, 0);
            if (held.length >= CAP || bytes + buf.byteLength > MAX_TOTAL) { problem = 'Too many photos waiting to send. Connect and try again.'; return; }
            t.objectStore(META).put(rec); t.objectStore(BLOBS).put(buf, rec.photo_id);
          };
          t.oncomplete = function () { if (problem) reject(full(problem)); else { try { localStorage.setItem(USED, '1'); } catch (e) { /* only a hint */ } resolve(rec); } };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error || new Error('Interrupted')); };
        });
      });
    });
  }
  /** Is there room for another photo (the camera button)? */
  function canKeep() {
    return all().then(function (rows) {
      var held = rows.filter(holds);
      return held.length < CAP && held.reduce(function (n, r) { return n + (Number(r.bytes) || 0); }, 0) < MAX_TOTAL;
    });
  }
  function get(id) { return tx([META], 'readonly', function (t) { return t.objectStore(META).get(String(id)); }).then(function (r) { return r && r.photo_id === String(id) ? r : undefined; }); }
  function picture(id) { return tx([BLOBS], 'readonly', function (t) { return t.objectStore(BLOBS).get(String(id)); }).then(function (b) { return b instanceof ArrayBuffer ? b : null; }); }
  /** A data: address to show the photo on this phone ('' when its picture is no longer here). */
  function preview(id) { return picture(id).then(function (b) { return b ? 'data:image/jpeg;base64,' + b64(b) : ''; }); }
  /** Retake / Remove on a draft: only a photo never sent is thrown away. */
  function drop(id) {
    return get(id).then(function (r) {
      if (!r || r.status === 'sent') return false;
      return tx([META, BLOBS], 'readwrite', function (t) { t.objectStore(META).delete(r.photo_id); t.objectStore(BLOBS).delete(r.photo_id); }).then(function () { return true; });
    });
  }
  function forEntry(entryId) {
    return tx([META], 'readonly', function (t) { return t.objectStore(META).index('entry_id').getAll(String(entryId)); }).then(function (r) { return (r || []).sort(function (a, b) { return a.taken_at < b.taken_at ? -1 : 1; }); });
  }
  function update(rec, dropPicture) {
    return tx([META, BLOBS], 'readwrite', function (t) { t.objectStore(META).put(rec); if (dropPicture) t.objectStore(BLOBS).delete(rec.photo_id); });
  }
  /**
   * Tidying (when the app opens): sent records after about a year; the pictures of refused photos after 60 days (they stop
   * counting against CAP); and photos of a draft that was thrown away (known(entry_id) false: no entry and no draft has that
   * ID) once they are 2 days old. known null: that last step is skipped (the entries could not be read, so nothing is guessed).
   */
  function tidy(known) {
    var now = Date.now(), day = 864e5;
    return all().then(function (rows) {
      var gone = [], drops = [];
      rows.forEach(function (r) {
        var age = now - (Date.parse(r.sent_at || r.taken_at) || now);
        if (r.status === 'sent' && age > KEEP_SENT_DAYS * day) gone.push(r);
        else if (r.status === 'refused' && !r.dropped && age > KEEP_REFUSED_DAYS * day) { r.dropped = true; drops.push(r); }
        else if (r.status === 'waiting' && typeof known === 'function' && !known(r.entry_id) && now - (Date.parse(r.taken_at) || now) > ORPHAN_DAYS * day) gone.push(r);
      });
      if (!gone.length && !drops.length) return 0;
      return tx([META, BLOBS], 'readwrite', function (t) {
        gone.forEach(function (r) { t.objectStore(META).delete(r.photo_id); t.objectStore(BLOBS).delete(r.photo_id); });
        drops.forEach(function (r) { t.objectStore(META).put(r); t.objectStore(BLOBS).delete(r.photo_id); });
      }).then(function () { return gone.length + drops.length; });
    });
  }

  /* ---------- sending, after the entries ---------- */
  var running = null;
  // The phone-wide wait (ch.photo_wait): {until, n}. Set by today's cap (until the next UTC day), and (review R2) by any answer about
  // the whole phone or company (the Drive full, a link switched off, a paused company, busy, no proper answer, no connection),
  // n of them in a row: 1, 2, 4… minutes, at most 6 hours. A photo stored or refused clears it.
  function waitOf() { try { var w = JSON.parse(localStorage.getItem(WAIT) || 'null'); return w && typeof w === 'object' ? w : { until: Date.parse(localStorage.getItem(WAIT) || '') ? localStorage.getItem(WAIT) : '', n: 0 }; } catch (e) { return { until: '', n: 0 }; } }
  function waitUntil() { return Date.parse(waitOf().until || '') || 0; }
  function setWait(iso, n) { try { if (iso) localStorage.setItem(WAIT, JSON.stringify({ until: iso, n: n || 0 })); else localStorage.removeItem(WAIT); } catch (e) { /* only a time */ } }
  function phoneWait() { var n = (Number(waitOf().n) || 0) + 1; setWait(new Date(Date.now() + backoff(n)).toISOString(), n); }
  function backoff(tries) { return Math.min(BACKOFF_MAX, BACKOFF_MIN * Math.pow(2, Math.max(0, tries - 1))); }
  /**
   * o: {post(body) → Promise<answer>, key, app_version, state(entry_id) → 'answered' | anything else (not yet), busy() → true
   * while an entry is waiting to go, manual (Send photos was tapped: every waiting photo is tried now)}.
   * One photo at a time, the least-tried first, then the oldest. Each photo that fails waits longer before its next try
   * (next_at: 1, 2, 4… minutes, at most 6 hours). An answer about the whole phone or company (photos switched off, today's
   * cap, the Drive full, the link switched off, a paused company, no connection) ends the run: off: true is reported so the
   * app waits until photos are on again; the day cap sets a "not before" for every photo (the next day). STUCK photos in a
   * row answered "error" end it too, so one stuck photo never holds the rest for long. Resolves {sent, refused, stopped, off};
   * never rejects; never touches an entry.
   */
  function sendDue(o) {
    if (running) return running;
    var done = { sent: 0, refused: 0, stopped: false, off: false };
    var now = Date.now();
    if (!o.manual && waitUntil() > now) return Promise.resolve(done);
    running = all().then(function (rows) {
      var due = rows.filter(function (r) { return r.status === 'waiting' && (o.manual || !(Date.parse(r.next_at || '') > now)); })
        .sort(function (a, b) { return (Number(a.tries) || 0) - (Number(b.tries) || 0) || (a.taken_at < b.taken_at ? -1 : 1); });
      var chain = Promise.resolve(), stop = false, inRow = 0;
      var later = function (r) { r.tries = (Number(r.tries) || 0) + 1; r.next_at = new Date(Date.now() + backoff(r.tries)).toISOString(); return update(r, false); };
      due.forEach(function (r) {
        chain = chain.then(function () {
          if (stop) return null;
          if (o.busy && o.busy()) { stop = true; return null; } // entries first: a new entry waits for nothing
          if (!o.state || o.state(r.entry_id) !== 'answered') return null;
          return picture(r.photo_id).then(function (buf) {
            if (!buf) return null; // its picture is not here: nothing to send (never happens for a waiting photo)
            var body = { key: o.key, action: 'photo', photo_id: r.photo_id, entry_id: r.entry_id, field: r.field, n: r.n, mime: 'image/jpeg', bytes: buf.byteLength, data: b64(buf), taken_at: r.taken_at, app_version: o.app_version };
            return o.post(body).then(function (j) {
              if (j && (j.ok === true || j.refused === true) && waitOf().until) setWait('');
              if (j && j.ok === true && (j.status === 'saved' || j.status === 'duplicate')) { inRow = 0; r.status = 'sent'; r.sent_at = new Date().toISOString(); delete r.next_at; done.sent++; return update(r, true); }
              if (j && j.refused === true) { inRow = 0; r.status = 'refused'; r.message = String(j.error || '').slice(0, 200); done.refused++; return update(r, false); }
              if (j && j.off) { stop = true; done.stopped = true; done.off = true; return null; } // switched off: waits, untouched, until photos are on again
              if (j && j.day_cap) { stop = true; done.stopped = true; setWait(Date.parse(j.retry_at || '') > Date.now() ? j.retry_at : new Date(Date.now() + BACKOFF_MAX).toISOString(), 0); return null; }
              if (!j || j.storage || j.revoked || j.bad_key || j.suspended || j.signed_out || j.must_change || j.must_add_email || j.retry || j.ok !== false || j.status !== 'error') { stop = true; done.stopped = true; phoneWait(); return null; } // about the whole phone or company (or an older script): every photo waits (review R2)
              inRow++; done.stopped = true;
              if (inRow >= STUCK) stop = true;
              return later(r); // this photo only: the others still go
            }, function () { stop = true; done.stopped = true; phoneWait(); return later(r); }); // no connection (or it timed out): every photo waits, this one longer
          });
        });
      });
      return chain;
    }).catch(function () { done.stopped = true; }).then(function () { running = null; return done; });
    return running;
  }
  function sending() { return !!running; }

  /** Wi-Fi only: whether this browser can tell (navigator.connection.type), and whether it is on Wi-Fi now. */
  function canTellWifi() { var c = root.navigator && navigator.connection; return !!(c && typeof c.type === 'string' && c.type); }
  function onWifi() { var c = root.navigator && navigator.connection; return !!(c && (c.type === 'wifi' || c.type === 'ethernet')); }

  /** "1 photo waiting", "2 photos sent", "Photo not sent", in a worker's words (never a server's message). */
  function words(recs) {
    var w = recs.filter(function (r) { return r.status === 'waiting'; }).length, s = recs.filter(function (r) { return r.status === 'sent'; }).length;
    var x = recs.filter(function (r) { return r.status === 'refused'; }).length;
    var out = [];
    if (w) out.push(w + (w === 1 ? ' photo waiting' : ' photos waiting'));
    if (s) out.push(s === 1 && !w && !x ? 'Photo sent' : s + (s === 1 ? ' photo sent' : ' photos sent'));
    if (x) out.push(x === 1 ? 'Photo not sent' : x + ' photos not sent');
    return out.join(' · ');
  }

  /* ---------- the admin pages: an entry's or a ferment's photos ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v; else if (k === 'className') n.className = v; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var GOOD_DATA = /^[A-Za-z0-9+/]+={0,2}$/;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** "2026-11-25…" → "Nov 25" (with the year when it is not this year); anything else as it is. */
  function dayText(t) {
    var m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(t || '');
    return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + (Number(m[1]) !== new Date().getFullYear() ? ', ' + m[1] : '');
  }
  /**
   * o: {ask(body) → Promise<answer> (the page adds its key), ferment? | entry_id?, heading?}. Returns {node, ready}: ready gives
   * how many photos there are (0: the caller may hide the node). Pictures are fetched one at a time, as they are drawn; a
   * picture is shown only as a data:image/jpeg address. Hidden photos (their entry was removed) are left out.
   */
  function view(o) {
    var list = el('ul', { className: 'photo-list' });
    var note = el('p', { className: 'note photo-note', text: 'Loading photos…' });
    var node = el('div', { className: 'photo-strip', 'data-photos': '' }, [o.heading ? el('h3', { text: o.heading }) : null, note, list]);
    var body = { action: 'read', what: 'photos' };
    if (o.ferment !== undefined) body.ferment = String(o.ferment);
    if (o.entry_id !== undefined) body.entry_id = String(o.entry_id);
    var ready = o.ask(body).then(function (j) {
      if (!j || !j.ok) { note.textContent = (j && j.error) || 'Photos could not be loaded.'; return 0; }
      var rows = (j.photos || []).filter(function (p) { return !p.hidden; });
      note.textContent = rows.length ? '' : 'No photos.';
      note.hidden = !!rows.length;
      var chain = Promise.resolve();
      rows.forEach(function (p) {
        var alt = [p.question || 'Photo', p.ferment ? 'ferment ' + p.ferment : '', dayText(p.taken_at || p.received_at)].filter(Boolean).join(', ');
        var img = el('img', { alt: alt, className: 'photo-img', loading: 'lazy' });
        var holder = el('button', { type: 'button', className: 'photo-btn', 'aria-label': alt + ': show larger', 'aria-pressed': 'false', onclick: function () {
          var big = !holder.classList.contains('is-big'); holder.classList.toggle('is-big', big); holder.setAttribute('aria-pressed', big ? 'true' : 'false');
        } }, [img]);
        var cap = el('figcaption', { text: [p.question, dayText(p.taken_at || p.received_at), p.recorded_by ? 'by ' + p.recorded_by : ''].filter(Boolean).join(' · ') });
        list.appendChild(el('li', {}, [el('figure', {}, [holder, cap])]));
        if (p.status !== 'saved') { holder.disabled = true; holder.appendChild(el('span', { className: 'photo-wait', text: 'Still arriving' })); return; }
        chain = chain.then(function () {
          return o.ask({ action: 'read', what: 'photo', photo_id: p.photo_id }).then(function (a) {
            if (a && a.ok && a.mime === 'image/jpeg' && typeof a.data === 'string' && GOOD_DATA.test(a.data)) img.src = 'data:image/jpeg;base64,' + a.data;
            else holder.appendChild(el('span', { className: 'photo-wait', text: 'Could not be loaded' }));
          }, function () { holder.appendChild(el('span', { className: 'photo-wait', text: 'Could not be loaded' })); });
        });
      });
      return rows.length;
    }, function () { note.textContent = 'Photos could not be loaded. No connection.'; return 0; });
    return { node: node, ready: ready };
  }

  /*
   * P4-B/2: the photo of a scanned paper form, kept on this device beside its draft until the form is saved (scan.js keeps it,
   * app.js shows it beside the form and drops it once the entry is saved). Its own small database, "cocoahead-scans", one
   * record per scan ({id, blob}); never the photos' database (those photos are sent), never the entries', never localStorage.
   */
  var sdb = null;
  function scanDb() {
    if (sdb) return sdb;
    sdb = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('This browser cannot keep the photo.')); return; }
      var req = root.indexedDB.open('cocoahead-scans', 1);
      req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains('scans')) req.result.createObjectStore('scans', { keyPath: 'id' }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { sdb = null; reject(req.error); };
    });
    return sdb;
  }
  function scanTx(mode, fn) {
    return scanDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(['scans'], mode), out = fn(t.objectStore('scans'));
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : null); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Interrupted')); };
      });
    });
  }
  var scans = {
    keep: function (id, blob) { return scanTx('readwrite', function (st) { return st.put({ id: String(id), blob: blob, at: new Date().toISOString() }); }); },
    get: function (id) { return scanTx('readonly', function (st) { return st.get(String(id)); }).then(function (r) { return r && r.blob ? r.blob : null; }); },
    drop: function (id) { return scanTx('readwrite', function (st) { return st.delete(String(id)); }); },
    preview: function (id) { return scans.get(id).then(function (b) { return b ? bufOf(b).then(function (x) { return 'data:image/jpeg;base64,' + b64(x); }) : ''; }); }, // a data: address (the pages' CSP allows no blob:)
  };
  function base64(blob) { return bufOf(blob).then(b64); }

  root.CH_PHOTOS = {
    scans: scans, base64: base64, // P4-B/2
    MAX_SIDE: MAX_SIDE, QUALITY: QUALITY, MAX_BYTES: MAX_BYTES, CAP: CAP,
    MAX_TOTAL: MAX_TOTAL, FREE_MIN: FREE_MIN, BACKOFF_MIN: BACKOFF_MIN, BACKOFF_MAX: BACKOFF_MAX,
    shrink: shrink, keep: keep, canKeep: canKeep, used: used, get: get, drop: drop, preview: preview, forEntry: forEntry, all: all, waitingCount: waitingCount,
    sendDue: sendDue, sending: sending, tidy: tidy, words: words, canTellWifi: canTellWifi, onWifi: onWifi, view: view,
  };
})(self);
