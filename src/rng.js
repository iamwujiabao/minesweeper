// Seedable random numbers. ?seed=123 in a page's URL makes every board reproducible (the browser tests rely on it);
// without a seed the games use Math.random.
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
  if (typeof module !== 'undefined') module.exports = { mulberry32, rngFromSearch }; else root.Rng = { mulberry32, rngFromSearch };
})(this);
