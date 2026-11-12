// Board neighbours for each shape, and a logic solver. The solver is used three ways: to build "no-guess" boards,
// to give hints (it only uses what the player can see), and by the tests. No DOM code.
(function (root) {
  // For every cell index (row * cols + col), the list of neighbouring cell indexes.
  //  square: 8 neighbours.  torus: 8 neighbours, edges wrap around.
  //  hex: 6 neighbours; odd rows are shifted half a cell to the right ("odd-r" layout).
  function buildNeighbors(rows, cols, topology) {
    const out = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let offsets;
        if (topology === 'hex') {
          offsets = r % 2 === 0 ? [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]]
                                : [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
        } else {
          offsets = [];
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) offsets.push([dr, dc]);
        }
        const set = new Set();
        for (const [dr, dc] of offsets) {
          let nr = r + dr, nc = c + dc;
          if (topology === 'torus') { nr = (nr + rows) % rows; nc = (nc + cols) % cols; }
          else if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (nr !== r || nc !== c) set.add(nr * cols + nc);
        }
        out.push([...set]);
      }
    return out;
  }

  // Logic only: which hidden cells are certainly safe / certainly mines, given the revealed numbers.
  //  nb: neighbour lists. revealed[i]: cell i is an open number. num[i]: its number.
  //  knownMine[i] (optional): cells already known to be mines.
  // Rules, repeated until nothing new is found:
  //  1. A number whose remaining mines = 0 -> all its hidden neighbours are safe.
  //  2. A number whose remaining mines = its hidden neighbours -> they are all mines.
  //  3. If one number's hidden neighbours are all inside another's, the difference follows from the difference
  //     of their counts (the "subset rule"), which settles patterns like 1-2-1.
  function deduce(nb, revealed, num, knownMine) {
    const n = nb.length, mine = new Uint8Array(n), safe = new Uint8Array(n);
    if (knownMine) for (let i = 0; i < n; i++) if (knownMine[i]) mine[i] = 1;
    let progress = true;
    while (progress) {
      progress = false;
      const cons = []; // constraints that rules 1 and 2 could not settle: {cells, need, set}
      for (let i = 0; i < n; i++) {
        if (!revealed[i]) continue;
        const unknown = [];
        let m = 0;
        for (const j of nb[i]) { if (mine[j]) m++; else if (!revealed[j] && !safe[j]) unknown.push(j); }
        if (!unknown.length) continue;
        const need = num[i] - m;
        if (need === 0) { for (const j of unknown) safe[j] = 1; progress = true; }
        else if (need === unknown.length) { for (const j of unknown) mine[j] = 1; progress = true; }
        else if (need > 0 && need < unknown.length) cons.push({ cells: unknown, need, set: new Set(unknown) });
      }
      if (progress) continue;
      const byCell = new Map();
      cons.forEach((c, k) => { for (const j of c.cells) { if (!byCell.has(j)) byCell.set(j, []); byCell.get(j).push(k); } });
      for (let a = 0; a < cons.length; a++) {
        const A = cons[a];
        for (const b of byCell.get(A.cells[0])) {          // only constraints sharing a cell with A can contain it
          const B = cons[b];
          if (b === a || B.cells.length <= A.cells.length || !A.cells.every(j => B.set.has(j))) continue;
          const diff = B.cells.filter(j => !A.set.has(j)), need = B.need - A.need;
          if (need === 0) { for (const j of diff) if (!safe[j]) { safe[j] = 1; progress = true; } }
          else if (need === diff.length) { for (const j of diff) if (!mine[j]) { mine[j] = 1; progress = true; } }
        }
      }
    }
    return { safe, mine };
  }

  // First hidden cell that is provably safe, or -1.
  function hint(nb, revealed, num, knownMine) {
    const { safe } = deduce(nb, revealed, num, knownMine);
    for (let i = 0; i < safe.length; i++) if (safe[i] && !revealed[i] && !(knownMine && knownMine[i])) return i;
    return -1;
  }

  // Can a player who starts by clicking `start` finish this board using logic only (never guessing)?
  // isMine: 0/1 per cell. Plays the board: open the start (flooding zeros), then repeatedly open whatever is provably safe.
  function solvable(nb, isMine, start) {
    const n = nb.length;
    const num = new Uint8Array(n), revealed = new Uint8Array(n);
    let mines = 0;
    for (let i = 0; i < n; i++) { if (isMine[i]) mines++; for (const j of nb[i]) if (isMine[j]) num[i]++; }
    let count = 0;
    const open = first => {
      const stack = [first];
      while (stack.length) {
        const i = stack.pop();
        if (revealed[i] || isMine[i]) continue;
        revealed[i] = 1; count++;
        if (num[i] === 0) stack.push(...nb[i]);
      }
    };
    open(start);
    for (;;) {
      const { safe } = deduce(nb, revealed, num, null);
      let any = false;
      for (let i = 0; i < n; i++) if (safe[i] && !revealed[i]) { open(i); any = true; }
      if (!any) break;
    }
    return count === n - mines;
  }

  const api = { buildNeighbors, deduce, hint, solvable };
  if (typeof module !== 'undefined') module.exports = api; else root.Solver = api;
})(this);
