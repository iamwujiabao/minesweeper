// The probability solver, checked against brute force: try every placement of the mines that fits what is visible.
const test = require('node:test');
const assert = require('node:assert');
const Solver = require('../src/solver.js');
const { Game } = require('../src/game.js');
const { mulberry32 } = require('../src/rng.js');

function visible(g) {
  const flat = g.cells.flat();
  return { revealed: flat.map(c => (c.revealed && !c.mine ? 1 : 0)), num: flat.map(c => c.adjacent), known: flat.map(() => 0) };
}
// Fraction of consistent mine placements in which each hidden cell is a mine.
function bruteForce(g) {
  const { revealed, num } = visible(g), nb = g.nb, hidden = [];
  revealed.forEach((r, i) => { if (!r) hidden.push(i); });
  const chosen = new Uint8Array(nb.length), counts = new Float64Array(nb.length);
  let layouts = 0;
  const go = (from, left) => {
    if (left === 0) {
      for (let i = 0; i < nb.length; i++) if (revealed[i] && nb[i].filter(j => chosen[j]).length !== num[i]) return;
      layouts++; for (const h of hidden) counts[h] += chosen[h]; return;
    }
    for (let k = from; k <= hidden.length - left; k++) { chosen[hidden[k]] = 1; go(k + 1, left - 1); chosen[hidden[k]] = 0; }
  };
  go(0, g.mineCount);
  return { layouts, prob: hidden.map(h => [h, counts[h] / layouts]) };
}

test('probabilities equal brute force on small boards of every shape', () => {
  let checked = 0, fractional = 0;
  for (const topology of ['square', 'hex', 'torus'])
    for (let seed = 1; seed <= 25; seed++) {
      const g = new Game(5, 5, 5, mulberry32(seed), { topology });
      g.reveal(seed % 5, (seed * 3) % 5);
      if (g.status !== 'playing') continue;
      const { revealed, num, known } = visible(g), p = Solver.probabilities(g.nb, revealed, num, known, g.mineCount);
      const exact = bruteForce(g);
      for (const [cell, want] of exact.prob) {
        assert.ok(Math.abs(p[cell] - want) < 1e-9, `${topology} seed ${seed} cell ${cell}: ${p[cell]} vs ${want}`);
        checked++; if (want > 0 && want < 1) fractional++;
      }
      for (let i = 0; i < p.length; i++) if (revealed[i]) assert.strictEqual(p[i], -1);
    }
  assert.ok(checked > 400 && fractional > 100, `${checked} cells checked, ${fractional} uncertain`);
});

test('probabilities after more moves, and with a hit mine already known (lives mode)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Game(5, 5, 6, mulberry32(seed), { lives: 3 });
    g.reveal(2, 2);
    const m = g.cells.flat().findIndex(c => c.mine && !c.revealed);
    if (m >= 0) g.reveal(Math.floor(m / 5), m % 5);                     // a mine opened: it is known now
    if (g.status !== 'playing') continue;
    const flat = g.cells.flat();
    const revealed = flat.map(c => (c.revealed && !c.mine ? 1 : 0)), num = flat.map(c => c.adjacent), known = flat.map(c => (c.revealed && c.mine ? 1 : 0));
    const p = Solver.probabilities(g.nb, revealed, num, known, g.mineCount);
    // brute force with the known mine counted
    const hidden = []; revealed.forEach((r, i) => { if (!r && !known[i]) hidden.push(i); });
    const left = g.mineCount - known.filter(Boolean).length, chosen = new Uint8Array(25), counts = new Float64Array(25);
    let layouts = 0;
    const go = (from, n) => {
      if (n === 0) { for (let i = 0; i < 25; i++) if (revealed[i] && g.nb[i].filter(j => chosen[j] || known[j]).length !== num[i]) return; layouts++; hidden.forEach(h => { counts[h] += chosen[h]; }); return; }
      for (let k = from; k <= hidden.length - n; k++) { chosen[hidden[k]] = 1; go(k + 1, n - 1); chosen[hidden[k]] = 0; }
    };
    go(0, left);
    for (const h of hidden) assert.ok(Math.abs(p[h] - counts[h] / layouts) < 1e-9, `seed ${seed} cell ${h}`);
  }
});

test('without the total mine count the chances still come out (frontier only), and outside cells are left unknown', () => {
  let uncertain = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = new Game(9, 9, 10, mulberry32(seed)); g.reveal(4, 4);
    const { revealed, num, known } = visible(g), p = Solver.probabilities(g.nb, revealed, num, known, undefined);
    if ([...p].some(x => x > 0 && x < 1)) uncertain++;
    assert.ok([...p].every((x, i) => (revealed[i] ? x === -1 : x >= -1 && x <= 1)));
  }
  assert.ok(uncertain > 5);
});

test('best guess: the lowest chance, certain cells first, nothing when there is nothing to guess', () => {
  const g = new Game(9, 9, 10, mulberry32(9)); g.reveal(4, 4);
  const { revealed, num, known } = visible(g), p = Solver.probabilities(g.nb, revealed, num, known, g.mineCount);
  const i = Solver.bestGuess(g.nb, revealed, p);
  assert.ok(i >= 0 && !revealed[i]);
  for (let k = 0; k < p.length; k++) if (!revealed[k] && p[k] >= 0 && p[k] < 1) assert.ok(p[i] <= p[k] + 1e-9);
  assert.strictEqual(Solver.bestGuess([[]], [1], Float64Array.of(-1)), -1);
});

test('a real board with a large frontier finishes quickly (work limit)', () => {
  const g = new Game(16, 30, 99, mulberry32(5)); g.reveal(8, 15);
  const { revealed, num, known } = visible(g);
  const t0 = Date.now(), p = Solver.probabilities(g.nb, revealed, num, known, g.mineCount);
  assert.ok(Date.now() - t0 < 3000);
  assert.ok([...p].every(x => x === -1 || (x >= 0 && x <= 1 + 1e-9)));
});
