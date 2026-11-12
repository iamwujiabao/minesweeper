// Board shapes as interchangeable STRATEGY objects. A topology answers one question - "which cells touch this one?" -
// so the rest of the game (numbers, flood-fill, chord, the solver) works on any shape without knowing which it is.
//   square: 8 neighbours.   torus: 8 neighbours with the edges wrapping around.
//   hex: 6 neighbours; odd rows are shifted half a cell to the right ("odd-r" layout).
(function (root) {
  const square = {
    id: 'square',
    neighbors(rows, cols, r, c) {
      const out = [];
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const y = r + dr, x = c + dc;
          if ((dr || dc) && y >= 0 && y < rows && x >= 0 && x < cols) out.push([y, x]);
        }
      return out;
    },
  };

  const torus = {
    id: 'torus',
    neighbors(rows, cols, r, c) {
      const seen = new Set(), out = [];
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const y = (r + dr + rows) % rows, x = (c + dc + cols) % cols, key = y * cols + x;
          if ((dr || dc) && key !== r * cols + c && !seen.has(key)) { seen.add(key); out.push([y, x]); } // (tiny boards: no repeats)
        }
      return out;
    },
  };

  const EVEN_ROW = [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
  const ODD_ROW = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
  const hex = {
    id: 'hex',
    neighbors(rows, cols, r, c) {
      return (r % 2 === 0 ? EVEN_ROW : ODD_ROW).map(([dr, dc]) => [r + dr, c + dc]).filter(([y, x]) => y >= 0 && y < rows && x >= 0 && x < cols);
    },
  };

  const strategies = { square, hex, torus };
  const Topology = {
    ids: Object.keys(strategies),
    get: id => strategies[id],
    // For every cell index (row * cols + col), the list of neighbouring cell indexes.
    buildNeighbors(rows, cols, id) {
      const strategy = strategies[id] || square, out = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) out.push(strategy.neighbors(rows, cols, r, c).map(([y, x]) => y * cols + x));
      return out;
    },
  };

  if (typeof module !== 'undefined') module.exports = Topology; else root.Topology = Topology;
})(this);
