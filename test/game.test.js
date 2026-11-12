const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../src/game.js');

// 5x5 with a wall of mines down column 2: revealing (0,0) opens only columns 0-1.
const wall = () => { const g = new Game(5, 5, 5); g.setMines([[0,2],[1,2],[2,2],[3,2],[4,2]]); return g; };
const snapshot = g => JSON.stringify([g.cells, g.status, g.exploded]);

test('mine placement: right count, first click and neighbours safe', () => {
  for (let i = 0; i < 200; i++) {
    const g = new Game(9, 9, 10);
    g.reveal(4, 4);
    assert.strictEqual(g.cells.flat().filter(c => c.mine).length, 10);
    assert.ok(!g.cells[4][4].mine);
    assert.ok(g.neighbors(4, 4).every(([r, c]) => !g.cells[r][c].mine));
    assert.notStrictEqual(g.status, 'lost'); // an opening flood-fill can (rarely) already win
  }
});

test('adjacent numbers', () => {
  const g = wall();
  assert.strictEqual(g.cells[0][1].adjacent, 2);
  assert.strictEqual(g.cells[2][1].adjacent, 3);
  assert.strictEqual(g.cells[2][0].adjacent, 0);
});

test('flagging toggles, blocks reveal, adjusts counter', () => {
  const g = wall();
  g.toggleFlag(0, 0);
  assert.strictEqual(g.minesLeft(), 4);
  assert.strictEqual(g.reveal(0, 0), false);
  g.toggleFlag(0, 0);
  assert.strictEqual(g.minesLeft(), 5);
  assert.strictEqual(g.cells[0][0].flagged, false);
});

test('flood-fill opens the zero region and its number border only', () => {
  const g = wall();
  g.reveal(0, 0);
  assert.strictEqual(g.cells.flat().filter(c => c.revealed).length, 10);
  assert.ok(!g.cells[0][3].revealed);
  assert.strictEqual(g.status, 'playing');
});

test('flood-fill does not open flagged cells', () => {
  const g = wall();
  g.toggleFlag(4, 0);
  g.reveal(0, 0);
  assert.ok(!g.cells[4][0].revealed);
});

test('loss on mine, no moves afterwards', () => {
  const g = wall();
  g.reveal(0, 2);
  assert.strictEqual(g.status, 'lost');
  assert.deepStrictEqual(g.exploded, { r: 0, c: 2 });
  assert.strictEqual(g.reveal(0, 0), false);
  assert.strictEqual(g.toggleFlag(0, 0), false);
});

test('win when all safe cells revealed', () => {
  const g = wall();
  g.reveal(0, 0);
  assert.strictEqual(g.status, 'playing');
  g.reveal(0, 4); // zero cell: floods the right-hand columns
  assert.strictEqual(g.status, 'won');
});

test('undo with empty history does nothing', () => {
  const g = wall();
  const before = snapshot(g);
  assert.strictEqual(g.undo(), false);
  assert.strictEqual(snapshot(g), before);
});

test('undo a flag', () => {
  const g = wall();
  const before = snapshot(g);
  g.toggleFlag(1, 1);
  g.undo();
  assert.strictEqual(snapshot(g), before);
});

test('undo a flood-fill reverts all cells in one step', () => {
  const g = wall();
  g.toggleFlag(4, 0);
  const before = snapshot(g);
  g.reveal(0, 0);
  assert.strictEqual(g.history.length, 2);
  g.undo();
  assert.strictEqual(snapshot(g), before);
  assert.strictEqual(g.cells.flat().filter(c => c.revealed).length, 0);
});

test('undo the first move: board is blank and next first click is safe again', () => {
  const g = new Game(9, 9, 10);
  g.reveal(4, 4);
  g.undo();
  assert.strictEqual(g.minesPlaced, false);
  assert.strictEqual(g.cells.flat().filter(c => c.revealed || c.mine).length, 0);
  assert.strictEqual(g.canUndo(), false);
  g.reveal(0, 0);
  assert.ok(!g.cells[0][0].mine);
  assert.strictEqual(g.status, 'playing');
});

test('undo after a loss restores playing state', () => {
  const g = wall();
  g.reveal(0, 0);
  const before = snapshot(g);
  g.reveal(2, 2);
  assert.strictEqual(g.status, 'lost');
  g.undo();
  assert.strictEqual(g.status, 'playing');
  assert.strictEqual(g.exploded, null);
  assert.strictEqual(snapshot(g), before);
  assert.strictEqual(g.reveal(0, 3), true); // can keep playing
});

test('undo after a win unflags auto-flagged mines', () => {
  const g = wall();
  g.reveal(0, 0);
  for (let r = 0; r < 5; r++) for (let c = 3; c < 5; c++) g.reveal(r, c);
  assert.strictEqual(g.status, 'won');
  g.undo();
  assert.strictEqual(g.status, 'playing');
  assert.strictEqual(g.flagCount(), 0);
});

test('redo re-applies an undone move; new move clears redo', () => {
  const g = wall();
  g.reveal(0, 0);
  const after = snapshot(g);
  g.undo();
  assert.strictEqual(g.canRedo(), true);
  g.redo();
  assert.strictEqual(snapshot(g), after);
  g.undo();
  g.toggleFlag(4, 4); // new move
  assert.strictEqual(g.canRedo(), false);
});

test('redo with empty stack does nothing; redo restores a loss', () => {
  const g = wall();
  assert.strictEqual(g.redo(), false);
  g.reveal(2, 2);
  g.undo();
  g.redo();
  assert.strictEqual(g.status, 'lost');
});

test('redo of the first move restores the same mine layout', () => {
  const g = new Game(9, 9, 10);
  g.reveal(4, 4);
  const after = snapshot(g);
  g.undo();
  g.redo();
  assert.strictEqual(snapshot(g), after);
});

// 3x3 with mines at opposite corners; (0,1) is a "1" next to the (0,0) mine.
const corners = () => { const g = new Game(3, 3, 2); g.setMines([[0, 0], [2, 2]]); g.reveal(0, 1); return g; };

test('chord opens unflagged neighbours when flags match, in one undo step', () => {
  const g = corners();
  g.toggleFlag(0, 0);
  const before = snapshot(g), n = g.history.length;
  assert.strictEqual(g.chord(0, 1), true);
  assert.ok(g.cells[1][0].revealed && g.cells[1][1].revealed && g.cells[1][2].revealed && g.cells[0][2].revealed);
  assert.strictEqual(g.status, 'playing');
  assert.strictEqual(g.history.length, n + 1);
  g.undo();
  assert.strictEqual(snapshot(g), before);
});

test('chord does nothing when flag count differs, on hidden cells, or on zeros', () => {
  const g = corners();
  const n = g.history.length;
  assert.strictEqual(g.chord(0, 1), false); // 0 flags, number is 1
  assert.strictEqual(g.chord(2, 0), false); // hidden
  assert.strictEqual(g.history.length, n);
});

test('chord with a wrong flag hits the mine and loses; undo recovers', () => {
  const g = corners();
  g.toggleFlag(1, 2); // wrong
  g.chord(0, 1);
  assert.strictEqual(g.status, 'lost');
  assert.deepStrictEqual(g.exploded, { r: 0, c: 0 });
  g.undo();
  assert.strictEqual(g.status, 'playing');
});

// ---- save / load ----
const played = () => { // a game with flags, a flood-fill, an undo and a redo pending
  const g = wall();
  g.toggleFlag(4, 4); g.reveal(0, 0); g.toggleFlag(0, 2); g.undo();
  return g;
};
const roundTrip = g => Game.deserialize(JSON.parse(JSON.stringify(g.serialize())));

test('serialize/deserialize restores the exact state, history and redo', () => {
  const g = played(), h = roundTrip(g);
  assert.deepStrictEqual(h.cells, g.cells); // deepStrictEqual ignores key order
  assert.deepStrictEqual(h.serialize(), g.serialize());
  assert.strictEqual(h.history.length, g.history.length);
  assert.strictEqual(h.canRedo(), true);
  h.redo(); g.redo();
  assert.deepStrictEqual(h.cells, g.cells); // redo works after loading
  h.undo(); h.undo(); h.undo();
  assert.strictEqual(h.canUndo(), false);       // full undo history was kept
});

test('a loaded game before the first move still places mines safely on the first click', () => {
  const h = roundTrip(new Game(9, 9, 10));
  h.reveal(4, 4);
  assert.ok(!h.cells[4][4].mine);
  assert.strictEqual(h.cells.flat().filter(c => c.mine).length, 10);
});

test('a lost game round-trips with its exploded cell', () => {
  const g = wall(); g.reveal(2, 2);
  const h = roundTrip(g);
  assert.strictEqual(h.status, 'lost');
  assert.deepStrictEqual(h.exploded, { r: 2, c: 2 });
});

test('deserialize rejects inconsistent or malformed data', () => {
  const good = () => JSON.parse(JSON.stringify(played().serialize()));
  const mutate = f => { const d = good(); f(d); return Game.deserialize(d); };
  assert.ok(Game.deserialize(good()));
  assert.strictEqual(Game.deserialize(null), null);
  assert.strictEqual(Game.deserialize('x'), null);
  assert.strictEqual(mutate(d => { d.cells = d.cells.slice(1); }), null);               // wrong length
  assert.strictEqual(mutate(d => { d.cells = '~' + d.cells.slice(1); }), null);          // invalid character
  assert.strictEqual(mutate(d => { d.mines = 4; }), null);                               // mine count mismatch
  assert.strictEqual(mutate(d => { d.rows = 99; }), null);
  assert.strictEqual(mutate(d => { d.status = 'banana'; }), null);
  assert.strictEqual(mutate(d => { d.status = 'won'; }), null);                          // not actually won
  assert.strictEqual(mutate(d => { d.status = 'lost'; d.exploded = null; }), null);      // lost without a mine hit
  assert.strictEqual(mutate(d => { d.exploded = { r: 50, c: 0 }; }), null);
  assert.strictEqual(mutate(d => { d.history[0].cells = d.history[0].cells.slice(1); }), null);
  assert.strictEqual(mutate(d => { delete d.history; }), null);
  // a number that disagrees with its neighbours
  assert.strictEqual(mutate(d => { const ch = d.cells.charCodeAt(0) - 48; d.cells = String.fromCharCode(48 + (ch ^ 8)) + d.cells.slice(1); }), null);
});
