/*
 * Entries saved on this phone (IndexedDB). An entry is only ever marked "sent"
 * after the Google Sheet confirms it; sent entries stay on the phone for about
 * a year (a whole season and then some) as an extra copy, then are tidied away.
 */
(function (root) {
  'use strict';
  var DB_NAME = 'cocoahead', STORE = 'entries', KEEP_SENT_DAYS = 400;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var s = req.result.createObjectStore(STORE, { keyPath: 'entry_id' });
        s.createIndex('status', 'status');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var out = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Save was interrupted')); };
      });
    });
  }

  var DB = {
    put: function (entry) { return tx('readwrite', function (s) { s.put(entry); }); },
    /** One entry by its ID, or undefined (is a draft's entry already stored?). */
    get: function (id) { return tx('readonly', function (s) { return s.get(id); }).then(function (r) { return r && r.entry_id === id ? r : undefined; }); }, // not found: the request itself comes back, so check
    all: function () {
      return tx('readonly', function (s) { return s.getAll(); }).then(function (rows) {
        return rows.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
      });
    },
    waiting: function () {
      return DB.all().then(function (rows) {
        return rows.filter(function (r) { return r.status === 'waiting'; }).reverse();
      });
    },
    tidy: function () {
      var cutoff = new Date(Date.now() - KEEP_SENT_DAYS * 864e5).toISOString();
      return DB.all().then(function (rows) {
        var old = rows.filter(function (r) { return r.status === 'sent' && r.sent_at && r.sent_at < cutoff; });
        if (!old.length) return 0;
        return tx('readwrite', function (s) { old.forEach(function (r) { s.delete(r.entry_id); }); }).then(function () { return old.length; });
      });
    },
  };
  /*
   * 1.21.0 (slice 7): a key this browser keeps for a shared tablet's turns (a non-extractable CryptoKey: it can be used
   * here but never read out). It lives in its own small database, so the entries' database is never upgraded or touched.
   */
  var kdbp = null;
  function keys(mode, fn) {
    if (!kdbp) kdbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open('cocoahead-keys', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('keys'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return kdbp.then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('keys', mode);
        var out = fn(t.objectStore('keys'));
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('interrupted')); };
      });
    });
  }
  DB.getKey = function (name) { return keys('readonly', function (s) { return s.get(name); }); };
  DB.putKey = function (name, value) { return keys('readwrite', function (s) { s.put(value, name); }); };
  root.CH = Object.assign(root.CH || {}, { DB: DB });
})(self);
