// Seedable random numbers, the daily challenge seed, and share-link parsing.
// ?seed=123 in a page's URL makes every random choice reproducible (the browser tests rely on it);
// ?play=9x9x10-square-12345 opens one specific board (what the "share link" produces).
(function (root) {
  function mulberry32(a) { // small, well-known 32-bit generator
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngFromSearch(search) {
    const s = new URLSearchParams(search).get('seed');
    return s === null || s === '' || isNaN(Number(s)) ? Math.random : mulberry32(Number(s));
  }

  // Daily challenge: everyone gets the same board on the same (UTC) date.
  function dailyId(date) { return date.toISOString().slice(0, 10); } // e.g. "2026-11-13"
  function dailySeed(id) { // FNV-1a hash of the date text, kept below 2^31
    let h = 2166136261;
    const text = 'minesweeper-daily-' + id;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 1;
  }

  // "?play=ROWSxCOLSxMINES-TOPOLOGY-SEED" -> {rows, cols, mines, topology, seed}, or null if missing or not valid.
  // The URL is untrusted input, so every number is range-checked.
  function parsePlay(search) {
    const m = /^(\d{1,2})x(\d{1,2})x(\d{1,4})-(square|hex|torus)-(\d{1,10})$/.exec(new URLSearchParams(search).get('play') || '');
    if (!m) return null;
    const rows = +m[1], cols = +m[2], mines = +m[3], seed = +m[5];
    if (rows < 5 || rows > 30 || cols < 5 || cols > 40 || mines < 1 || mines > rows * cols - 9 || seed > 2147483647) return null;
    return { rows, cols, mines, topology: m[4], seed };
  }

  const api = { mulberry32, rngFromSearch, dailyId, dailySeed, parsePlay };
  if (typeof module !== 'undefined') module.exports = api; else root.Rng = api;
})(this);
