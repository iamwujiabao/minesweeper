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

  // ---- Probabilities ----
  // Exact mine chance for every hidden cell, from what the player can see. Returns a Float64Array: -1 for cells that
  // are not hidden (or whose chance cannot be worked out), otherwise a number from 0 to 1.
  // How: cells that logic settles get 0 or 1. The rest are split into "frontier" cells (touching an open number) and
  // "outside" cells. Frontier cells that share a number form a group; every way of placing mines in a group that fits its
  // numbers is counted (backtracking, with a work limit). Groups are then combined with the total mine count: the mines
  // not used by the frontier are spread over the outside cells in C(outside, left) ways, which weights each case.
  const NODE_LIMIT = 400000;
  const logFact = [0];
  const logChoose = (n, k) => { for (let i = logFact.length; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i); return logFact[n] - logFact[k] - logFact[n - k]; };

  // Every placement for one group. cells: cell indexes; groups: [{cells (indexes into `cells`), need}]. Returns
  // {ways[k], mineWays[t][k]} (k = mines used), or null if it took too long.
  function enumerateGroup(size, groups) {
    const need = groups.map(g => g.need), free = groups.map(g => g.cells.length), cellGroups = Array.from({ length: size }, () => []);
    groups.forEach((g, gi) => g.cells.forEach(t => cellGroups[t].push(gi)));
    const ways = new Float64Array(size + 1), mineWays = Array.from({ length: size }, () => new Float64Array(size + 1)), assign = new Uint8Array(size);
    let nodes = 0, tooLong = false;
    const place = (t, used) => {
      if (tooLong) return;
      if (++nodes > NODE_LIMIT) { tooLong = true; return; }
      if (t === size) { ways[used]++; for (let i = 0; i < size; i++) if (assign[i]) mineWays[i][used]++; return; }
      for (let v = 0; v <= 1; v++) {
        assign[t] = v;
        let ok = true;
        for (const g of cellGroups[t]) { free[g]--; need[g] -= v; if (need[g] < 0 || need[g] > free[g]) ok = false; }
        if (ok) place(t + 1, used + v);
        for (const g of cellGroups[t]) { free[g]++; need[g] += v; }
      }
      assign[t] = 0;
    };
    place(0, 0);
    return tooLong ? null : { ways, mineWays };
  }

  const convolve = (a, b) => { const out = new Float64Array(a.length + b.length - 1); for (let i = 0; i < a.length; i++) if (a[i]) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]; return out; };

  function probabilities(nb, revealed, num, knownMine, totalMines) {
    const n = nb.length, { safe, mine } = deduce(nb, revealed, num, knownMine, totalMines), prob = new Float64Array(n).fill(-1);
    const unknown = [];
    let known = 0;
    for (let i = 0; i < n; i++) {
      if (revealed[i]) continue;
      if (mine[i]) { prob[i] = 1; known++; } else if (safe[i]) prob[i] = 0; else unknown.push(i);
    }
    if (!unknown.length) return prob;
    // groups of cells that share an open number
    const parent = new Map(unknown.map(c => [c, c]));
    const find = c => { while (parent.get(c) !== c) { parent.set(c, parent.get(parent.get(c))); c = parent.get(c); } return c; };
    const numbers = [];
    for (let i = 0; i < n; i++) {
      if (!revealed[i]) continue;
      const cells = nb[i].filter(j => parent.has(j));
      if (!cells.length) continue;
      numbers.push({ cells, need: num[i] - nb[i].filter(j => mine[j]).length });
      for (const j of cells.slice(1)) parent.set(find(j), find(cells[0]));
    }
    const comps = new Map();
    for (const { cells, need } of numbers) {
      const root = find(cells[0]);
      if (!comps.has(root)) comps.set(root, { cells: new Set(), numbers: [] });
      const c = comps.get(root);
      cells.forEach(j => c.cells.add(j)); c.numbers.push({ cells, need });
    }
    const frontier = new Set(), solved = [];
    let exact = totalMines !== undefined;
    for (const c of comps.values()) {
      const cells = [...c.cells], local = new Map(cells.map((j, t) => [j, t]));
      cells.forEach(j => frontier.add(j));
      const res = enumerateGroup(cells.length, c.numbers.map(g => ({ cells: g.cells.map(j => local.get(j)), need: g.need })));
      if (!res) {                                    // too many cases: a rough chance from the numbers around each cell
        exact = false;
        for (const j of cells) { const own = c.numbers.filter(g => g.cells.includes(j)); prob[j] = own.reduce((s, g) => s + g.need / g.cells.length, 0) / own.length; }
        solved.push(null);
      } else solved.push({ cells, ...res });
    }
    const outside = unknown.filter(j => !frontier.has(j)), M = outside.length;
    const total = solved.filter(Boolean);
    if (!exact) {                                    // no total to combine with (or a rough group): chances per group on their own
      for (const g of total) for (let t = 0; t < g.cells.length; t++) {
        let w = 0, m = 0;
        for (let k = 0; k < g.ways.length; k++) { w += g.ways[k]; m += g.mineWays[t][k]; }
        prob[g.cells[t]] = w ? m / w : -1;
      }
      return prob;
    }
    const R = totalMines - known;
    // weight of "the frontier uses k mines in this group and `rest` in the others": C(M, R - k - rest), scaled to avoid overflow
    const maxF = total.reduce((s, g) => s + g.cells.length, 0);
    let ref = -Infinity;
    for (let r = Math.max(0, R - maxF); r <= Math.min(M, R); r++) ref = Math.max(ref, logChoose(M, r));
    const choose = r => (r < 0 || r > M ? 0 : Math.exp(logChoose(M, r) - ref));
    const others = g => total.filter(x => x !== g).reduce((acc, x) => convolve(acc, x.ways), Float64Array.of(1));
    for (const g of total) {
      const rest = others(g), factor = new Float64Array(g.ways.length);
      for (let k = 0; k < factor.length; k++) for (let m = 0; m < rest.length; m++) factor[k] += rest[m] * choose(R - k - m);
      let denom = 0;
      for (let k = 0; k < factor.length; k++) denom += g.ways[k] * factor[k];
      for (let t = 0; t < g.cells.length; t++) {
        let num2 = 0;
        for (let k = 0; k < factor.length; k++) num2 += g.mineWays[t][k] * factor[k];
        prob[g.cells[t]] = denom ? num2 / denom : -1;
      }
    }
    if (M) {                                         // outside cells: the mines the frontier does not use, spread evenly
      const all = total.reduce((acc, g) => convolve(acc, g.ways), Float64Array.of(1));
      let denom = 0, expected = 0;
      for (let f = 0; f < all.length; f++) { const w = all[f] * choose(R - f); denom += w; expected += w * (R - f); }
      const p = denom ? expected / denom / M : -1;
      for (const j of outside) prob[j] = p;
    }
    return prob;
  }

  // The hidden cell with the lowest mine chance (ties: the one touching the most hidden cells, so opening it tells most),
  // or -1. prob is the array from probabilities(); `revealed` marks open cells.
  function bestGuess(nb, revealed, prob) {
    let best = -1;
    const hiddenAround = i => nb[i].filter(j => !revealed[j]).length;
    for (let i = 0; i < prob.length; i++) {
      if (revealed[i] || prob[i] < 0 || prob[i] >= 1 - 1e-12) continue;     // not hidden, unknown, or a proven mine
      if (best < 0 || prob[i] < prob[best] - 1e-12 || (Math.abs(prob[i] - prob[best]) <= 1e-12 && hiddenAround(i) > hiddenAround(best))) best = i;
    }
    return best;
  }

  const api = { buildNeighbors: Topology.buildNeighbors, deduce, hint, solvable, probabilities, bestGuess };
  if (typeof module !== 'undefined') module.exports = api; else root.Solver = api;
})(this);
