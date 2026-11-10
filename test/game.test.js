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
    assert.strictEqual(g.status, 'playing');
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
