/*
 * Turns on a shared tablet (app 1.21.0, script 2.7.0; handbook/design-devices.md 3.3).
 *
 * The server gives the tablet a person's turn secret T once, after it has checked their PIN (turn_begin). This file:
 *   - wraps T under the PIN, so the tablet keeps only the wrapped copy: AES-GCM with a key made from the PIN by
 *     PBKDF2-SHA256 (a random 16-byte salt, 200,000 rounds). A wrong PIN fails AES-GCM's check: "That PIN is not right",
 *     with no signal needed. 2.7.0 slice 7 adds a second layer: a non-extractable AES key that never leaves this browser.
 *   - signs each entry saved in a turn (review fix, version 2): proof = HMAC-SHA256(key = T as text,
 *     "v2|entry_id|form|created_at|user|" + SHA-256 hex of the canonical JSON of {ops, sources, ferment_source}), as hex,
 *     so what the entry does is signed too. The server works T out again and checks the same bytes (Code.gs turnProof_,
 *     canonJson_; tests/turns.test.js checks they agree).
 *   - the wait after wrong PINs, and the PIN rules, the same as Code.gs (pinWaitMs_, pinProblem_).
 *   - when a turn ends at the tablet's day end.
 * Pure logic, Web Crypto only (built into the browser; Node's crypto.webcrypto in the tests). No PIN and no T is ever
 * written anywhere by this file.
 */
(function (root) {
  'use strict';
  var C = (root.crypto && root.crypto.subtle) ? root.crypto : (typeof require === 'function' ? require('crypto').webcrypto : null);
  var subtle = C && C.subtle;
  var ROUNDS = 200000;
  var enc = function (t) { return new TextEncoder().encode(String(t)); };
  var dec = function (b) { return new TextDecoder().decode(b); };
  function b64(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return (root.btoa || function (x) { return Buffer.from(x, 'binary').toString('base64'); })(s); }
  function unb64(t) { var s = (root.atob || function (x) { return Buffer.from(x, 'base64').toString('binary'); })(String(t || '')); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function hex(buf) { var a = new Uint8Array(buf), out = ''; for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2); return out; }
  function random(n) { var a = new Uint8Array(n); C.getRandomValues(a); return a; }

  function pinKey(pin, salt) {
    return subtle.importKey('raw', enc(pin), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  /**
   * T (64 hex) wrapped under the PIN → {salt, iv, wrapped} (base64 text, safe to keep). outer (optional): a
   * non-extractable AES-GCM CryptoKey of this browser that wraps it once more (slice 7): {…, iv2, outer: true}.
   */
  function wrap(secret, pin, outer) {
    var salt = random(16), iv = random(12);
    return pinKey(pin, salt).then(function (k) { return subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc(secret)); }).then(function (inner) {
      if (!outer) return { salt: b64(salt), iv: b64(iv), wrapped: b64(inner) };
      var iv2 = random(12);
      return subtle.encrypt({ name: 'AES-GCM', iv: iv2 }, outer, inner).then(function (both) { return { salt: b64(salt), iv: b64(iv), iv2: b64(iv2), wrapped: b64(both), outer: true }; });
    });
  }
  /** T back from what wrap made, or a rejected promise (a wrong PIN, or the outer key is not this browser's). */
  function unwrap(rec, pin, outer) {
    if (!rec || !rec.salt || !rec.iv || !rec.wrapped) return Promise.reject(new Error('nothing kept'));
    var data = unb64(rec.wrapped);
    var first = rec.outer ? (outer ? subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv2) }, outer, data) : Promise.reject(new Error('no outer key'))) : Promise.resolve(data);
    return first.then(function (inner) {
      return pinKey(pin, unb64(rec.salt)).then(function (k) { return subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, k, inner); });
    }).then(function (plain) {
      var t = dec(plain);
      if (!/^[0-9a-f]{64}$/.test(t)) throw new Error('not a turn');
      return t;
    });
  }
  /** JSON with every object's keys sorted, as Code.gs canonJson_ (the value is first made plain, as sending it would). */
  function canon(v) {
    if (v === null || typeof v !== 'object') return v === undefined ? 'null' : JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(function (x) { return x === undefined || typeof x === 'function' ? 'null' : canon(x); }).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined && typeof v[k] !== 'function'; }).map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  function contentHash(entry) {
    var o = {};
    ['ops', 'sources', 'ferment_source'].forEach(function (k) { if (entry && entry[k] !== undefined) o[k] = JSON.parse(JSON.stringify(entry[k])); });
    return subtle.digest('SHA-256', enc(canon(o))).then(hex);
  }
  /** The entry's proof (version 2): HMAC-SHA256(T as text, "v2|entry_id|form|created_at|user|" + its content hash) as hex. */
  function proof(secret, entry, user) {
    if (/\|/.test(String(entry.entry_id) + String(entry.form || '') + String(entry.created_at || ''))) return Promise.reject(new Error('An entry\'s ID, form and time never have "|" in them.'));
    return contentHash(entry).then(function (h) {
      var text = 'v2|' + String(entry.entry_id) + '|' + String(entry.form || '') + '|' + String(entry.created_at || '') + '|' + user + '|' + h;
      return subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']).then(function (k) { return subtle.sign('HMAC', k, enc(text)); }).then(hex);
    });
  }
  /** Days since 1970 (UTC), as Code.gs epochDay_: a worker's turn signs entries for OFFLINE_DAYS after the day it was given. */
  function epochDay(t) { return Math.floor((t === undefined ? Date.now() : t) / 864e5); }
  var OFFLINE_DAYS = 30;
  /** A non-extractable AES-GCM key for this browser (slice 7: kept in IndexedDB, never readable as bytes). */
  function deviceKey() { return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }

  // the waits after wrong PINs: 3 free, then 1, 5, 15 minutes, then an hour (Code.gs CFG.PIN_WAITS_MS, pinWaitMs_)
  var FREE = 3, WAITS = [60000, 300000, 900000], MAX = 3600000;
  function waitFor(n) { return n < FREE ? 0 : (WAITS[n - FREE] || MAX); }
  function triesLeft(n) { return Math.max(0, FREE - n); }
  /** '' if this can be a PIN, else why not (Code.gs pinProblem_). */
  function pinProblem(pin) {
    pin = String(pin);
    if (!/^\d{4,6}$/.test(pin)) return 'A PIN is 4 to 6 numbers.';
    if (/^(\d)\1+$/.test(pin)) return 'That PIN is too easy to guess: use different numbers.';
    var up = true, down = true;
    for (var i = 1; i < pin.length; i++) { var a = +pin.charAt(i - 1), b = +pin.charAt(i); if (b !== (a + 1) % 10) up = false; if (b !== (a + 9) % 10) down = false; }
    return up || down ? 'That PIN is too easy to guess: avoid numbers in a row.' : '';
  }
  /** The next time a day ends ("00:00", "18:30"), by this device's clock, after `from` (a Date). */
  function nextDayEnd(dayEnds, from) {
    var m = String(dayEnds || '00:00').match(/^(\d\d):(\d\d)$/) || [0, '00', '00'];
    var at = new Date(from.getTime());
    at.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);
    return at;
  }

  var api = { wrap: wrap, unwrap: unwrap, proof: proof, canon: canon, epochDay: epochDay, OFFLINE_DAYS: OFFLINE_DAYS, deviceKey: deviceKey, waitFor: waitFor, triesLeft: triesLeft, pinProblem: pinProblem, nextDayEnd: nextDayEnd, ROUNDS: ROUNDS, ready: !!subtle };
  root.CH_TURNS = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
