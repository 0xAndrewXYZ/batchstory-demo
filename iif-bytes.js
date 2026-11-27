/*
 * QuickBooks Desktop files (script 2.14.0): an IIF file's text → its bytes, in Windows-1252, with no byte-order mark.
 * Intuit does not document IIF's encoding; IIF is older than Unicode and Intuit opens it in Excel or Notepad, so single-byte
 * Windows text is the cautious choice (plain ASCII is always safe). The script already left out every record holding a character
 * this table cannot hold (Code.gs QBD_CP1252_HIGH_, the same table; a test feeds both every character 0–0xFFFF), so `bad` is empty
 * for any file the script made: the Exports page refuses to save a file if it is not.
 * Pure, no dependencies: loaded by the Exports page (window.CH_IIF) and by Node tests (require).
 */
(function (root) {
  'use strict';
  // Windows-1252's 0x80–0x9F: the Unicode character of each byte (0x81, 0x8D, 0x8F, 0x90 and 0x9D have none).
  var HIGH = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89,
    0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96,
    0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  /** The Windows-1252 byte of one UTF-16 code unit, or -1 when it has none. */
  function byteOf(code) {
    if (code < 0x80 || (code >= 0xA0 && code <= 0xFF)) return code;
    return Object.prototype.hasOwnProperty.call(HIGH, code) ? HIGH[code] : -1;
  }
  /** text → {bytes: Uint8Array, bad: [characters with no byte, each once]}. A bad character is written as "?" (the page then refuses the file). */
  function iifBytes(text) {
    var s = String(text === null || text === undefined ? '' : text), out = new Uint8Array(s.length), bad = [];
    for (var i = 0; i < s.length; i++) {
      var b = byteOf(s.charCodeAt(i));
      if (b < 0) { if (bad.indexOf(s.charAt(i)) < 0) bad.push(s.charAt(i)); b = 0x3F; }
      out[i] = b;
    }
    return { bytes: out, bad: bad };
  }
  var api = { iifBytes: iifBytes, byteOf: byteOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH_IIF = api;
})(this);
