// A logic solver. It is used three ways: to build "no-guess" boards, to give hints (it only uses what the player can
// see), and by the tests. Neighbour lists come from the Topology strategies. No DOM code.
(function (root) {
  const Topology = typeof module !== 'undefined' ? require('./topology.js') : root.Topology;

  // Logic only: which hidden cells are certainly safe / certainly mines, given the revealed numbers.
  //  nb: neighbour lists. revealed[i]: cell i is an open number. num[i]: its number.
  //  knownMine[i] (optional): cells already known to be mines.
  //  totalMines (optional): how many mines the whole board has, for rule 4.
  // Rules, repeated until nothing new is found:
  //  1. A number whose remaining mines = 0 -> all its hidden neighbours are safe.
  //  2. A number whose remaining mines = its hidden neighbours -> they are all mines.
  //  3. If one number's hidden neighbours are all inside another's, the difference follows from the difference
  //     of their counts (the "subset rule"), which settles patterns like 1-2-1.
  //  4. The global mine count: if the numbers' groups do not overlap, the mines left for all the other hidden cells are
  //     total - known - what the groups need. If that is 0 those cells are safe; if it equals their number they are all
  //     mines. (This is what settles most end games.)
  //  5. Exhaustive end game: when at most ENDGAME_CELLS hidden cells are left, try every placement of the remaining mines
  //     that fits all the numbers; a cell that is a mine in every placement (or in none) is settled.
  function deduce(nb, revealed, num, knownMine, totalMines) {
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
      if (!progress && totalMines !== undefined) progress = globalRule(n, revealed, mine, safe, cons, totalMines);
      if (!progress && totalMines !== undefined) progress = endgame(nb, revealed, num, mine, safe, totalMines);
    }
    return { safe, mine };
  }

  // Rule 4. cons are the unsettled groups ({cells, need}); returns true if it found something.
  function globalRule(n, revealed, mine, safe, cons, totalMines) {
    let known = 0;
    const unknown = [];
    for (let i = 0; i < n; i++) { if (mine[i]) known++; else if (!revealed[i] && !safe[i]) unknown.push(i); }
    const inGroup = new Uint8Array(n);
    let needed = 0;
    for (const c of cons) {
      needed += c.need;
      for (const j of c.cells) { if (inGroup[j]) return false; inGroup[j] = 1; } // overlapping groups: not worked out here
    }
    const outside = unknown.filter(j => !inGroup[j]), left = totalMines - known - needed;
    if (!outside.length) return false;
    if (left === 0) { for (const j of outside) safe[j] = 1; return true; }
    if (left === outside.length) { for (const j of outside) mine[j] = 1; return true; }
    return false;
  }

  const ENDGAME_CELLS = 16;
  // Rule 5. Backtracking over the hidden cells (mine / safe), pruned by every number and by the total. Returns true if it
  // settled at least one cell.
  function endgame(nb, revealed, num, mine, safe, totalMines) {
    const unknown = [];
    let known = 0;
    for (let i = 0; i < nb.length; i++) { if (mine[i]) known++; else if (!revealed[i] && !safe[i]) unknown.push(i); }
    const n = unknown.length;
    if (n === 0 || n > ENDGAME_CELLS) return false;
    const index = new Map(unknown.map((cell, k) => [cell, k]));
    const need = [], free = [], cellGroups = unknown.map(() => []);
    for (let i = 0; i < nb.length; i++) {            // one group per open number that still touches a hidden cell
      if (!revealed[i]) continue;
      const cells = [];
      let m = 0;
      for (const j of nb[i]) { if (mine[j]) m++; else if (index.has(j)) cells.push(index.get(j)); }
      if (!cells.length) continue;
      const g = need.length;
      need.push(num[i] - m); free.push(cells.length);
      for (const k of cells) cellGroups[k].push(g);
    }
    const target = totalMines - known, assign = new Uint8Array(n), asMine = new Int32Array(n);
    let solutions = 0;
    const place = (k, minesSoFar) => {
      if (minesSoFar > target || minesSoFar + (n - k) < target) return;
      if (k === n) { solutions++; for (let t = 0; t < n; t++) asMine[t] += assign[t]; return; }
      for (let v = 0; v <= 1; v++) {
        assign[k] = v;
        let ok = true;
        for (const g of cellGroups[k]) { free[g]--; need[g] -= v; if (need[g] < 0 || need[g] > free[g]) ok = false; }
        if (ok) place(k + 1, minesSoFar + v);
        for (const g of cellGroups[k]) { free[g]++; need[g] += v; }
      }
      assign[k] = 0;
    };
    place(0, 0);
    if (solutions === 0) return false;               // the numbers contradict each other: conclude nothing
    let progress = false;
    for (let t = 0; t < n; t++) {
      if (asMine[t] === 0) { safe[unknown[t]] = 1; progress = true; }
      else if (asMine[t] === solutions) { mine[unknown[t]] = 1; progress = true; }
    }
    return progress;
  }

  // First hidden cell that is provably safe, or -1.
  function hint(nb, revealed, num, knownMine, totalMines) {
    const { safe } = deduce(nb, revealed, num, knownMine, totalMines);
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
      const { safe } = deduce(nb, revealed, num, null, mines);
      let any = false;
      for (let i = 0; i < n; i++) if (safe[i] && !revealed[i]) { open(i); any = true; }
      if (!any) break;
    }
    return count === n - mines;
  }

  const api = { buildNeighbors: Topology.buildNeighbors, deduce, hint, solvable };
  if (typeof module !== 'undefined') module.exports = api; else root.Solver = api;
})(this);
