// The computer opponent. It sees only what a human sees (the open numbers). If the solver can prove a cell safe it opens
// one of those; when it is stuck it guesses a cell with the lowest mine chance. Ties are broken at random.
(function (root) {
  const Solver = typeof module !== 'undefined' ? require('./solver.js') : root.Solver;

  class AiPlayer {
    constructor(rng = Math.random) { this.rng = rng; }
    pick(list) { return list[Math.floor(this.rng() * list.length)]; }

    // The move to make: {r, c, kind: 'safe' | 'guess'}, or null if there is nothing to open.
    choose(game) {
      const v = game._visible(), n = game.nb.length;
      const { safe } = Solver.deduce(game.nb, v.revealed, v.num, v.known, game.mineCount);
      const certain = [];
      for (let i = 0; i < n; i++) if (safe[i] && !v.revealed[i] && !game.cells[Math.floor(i / game.cols)][i % game.cols].flagged) certain.push(i);
      if (certain.length) return { ...game._coords(this.pick(certain)), kind: 'safe' };
      const p = Solver.probabilities(game.nb, v.revealed, v.num, v.known, game.mineCount);
      let low = Infinity;
      for (let i = 0; i < n; i++) if (!v.revealed[i] && p[i] >= 0 && p[i] < 1 - 1e-12) low = Math.min(low, p[i]);
      if (low === Infinity) return null;
      const best = [];
      for (let i = 0; i < n; i++) if (!v.revealed[i] && p[i] >= 0 && p[i] <= low + 1e-9 && !game.cells[Math.floor(i / game.cols)][i % game.cols].flagged) best.push(i);
      return best.length ? { ...game._coords(this.pick(best)), kind: 'guess' } : null;
    }
  }

  if (typeof module !== 'undefined') module.exports = AiPlayer; else root.AiPlayer = AiPlayer;
})(this);
