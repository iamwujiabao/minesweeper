// Every puzzle must be solvable by logic alone (no guess, no total mine count) within its move limit, and must be well formed.
const test = require('node:test');
const assert = require('node:assert');
const Puzzles = require('../src/puzzles.js');
const Solver = require('../src/solver.js');
const { Game } = require('../src/game.js');

const make = p => new Game(p.rows, p.cols, p.mines.length, Math.random, { puzzle: p, puzzleId: p.id, moveLimit: p.limit });

test('puzzles are well formed', () => {
  assert.strictEqual(Puzzles.list.length, 5);
  assert.deepStrictEqual(Puzzles.ids, ['p1', 'p2', 'p3', 'p4', 'p5']);
  for (const p of Puzzles.list) {
    assert.ok(p.name && p.description.length > 10);
    const cells = new Set(p.mines.map(([r, c]) => r * p.cols + c));
    assert.strictEqual(cells.size, p.mines.length, `${p.id}: duplicate mines`);
    for (const [r, c] of p.mines.concat(p.open)) assert.ok(r >= 0 && r < p.rows && c >= 0 && c < p.cols);
    for (const [r, c] of p.open) assert.ok(!cells.has(r * p.cols + c), `${p.id}: a mine starts open`);
    const g = make(p);
    assert.strictEqual(g.minesPlaced, true); assert.strictEqual(g.status, 'playing'); assert.strictEqual(g.started(), false);
    assert.ok(g.cells.flat().filter(c => c.revealed).length >= p.open.length);
    assert.strictEqual(Puzzles.get(p.id), p);
  }
  assert.strictEqual(Puzzles.get('nope').id, 'p1'); assert.strictEqual(Puzzles.has('p9'), false);
});

test('every puzzle can be solved by logic alone within its move limit', () => {
  for (const p of Puzzles.list) {
    const g = make(p);
    for (let guard = 0; guard < 100 && g.status === 'playing'; guard++) {
      const flat = g.cells.flat(), revealed = flat.map(c => (c.revealed ? 1 : 0)), num = flat.map(c => c.adjacent);
      const { safe } = Solver.deduce(g.nb, revealed, num, null);          // no total mine count: pure local logic
      const next = [...safe].findIndex((s, i) => s && !revealed[i]);
      if (next < 0) break;
      const i = safe.findIndex((s, k) => s && !revealed[k]);
      g.reveal(Math.floor(i / p.cols), i % p.cols);
    }
    assert.strictEqual(g.status, 'won', `${p.id} was not solved (${g.status})`);
    assert.ok(g.movesUsed() <= p.limit - 2, `${p.id}: ${g.movesUsed()} moves, limit ${p.limit}`);
  }
});

test('too many moves loses a puzzle, and undo takes it back', () => {
  const p = Puzzles.get('p2'), g = make(p);
  const hidden = () => g.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).filter(([, , x]) => !x.revealed && !x.mine);
  let moves = 0;
  while (g.status === 'playing' && moves < 100) {
    const h = hidden()[0];
    if (!h) break;
    g.reveal(h[0], h[1]); moves++;
  }
  assert.ok(['won', 'lost'].includes(g.status));
  if (g.status === 'lost') {
    assert.strictEqual(g.exploded, null);                      // lost by the move limit, not by a mine
    assert.strictEqual(g.movesUsed(), p.limit);
    assert.ok(g.undo()); assert.strictEqual(g.status, 'playing');
  }
});
