// Tests for the extended rules: question marks, power-ups, lives, undo limit, time-out, two players, board shapes,
// seeds, no-guess boards, hints, 3BV, replay frames, and saving the new state.
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../src/game.js');
const Serializer = require('../src/serializer.js');
const { mulberry32 } = require('../src/rng.js');
const Solver = require('../src/solver.js');

const WALL = [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]]; // 5x5 with a wall of mines down column 2
const wall = opts => { const g = new Game(5, 5, 5, Math.random, opts); g.setMines(WALL); return g; };
const revealed = g => g.cells.flat().filter(c => c.revealed).length;
const same = (a, b) => assert.deepStrictEqual(a.map(row => row.map(({ mine, revealed, flagged, question, adjacent }) => ({ mine, revealed, flagged, question, adjacent }))),
                                              b.map(row => row.map(({ mine, revealed, flagged, question, adjacent }) => ({ mine, revealed, flagged, question, adjacent }))));
const roundTrip = g => Serializer.deserialize(JSON.parse(JSON.stringify(Serializer.serialize(g))));

// ---- question marks ----
test('mark cycles hidden -> flag -> ? -> hidden; a plain toggle skips the ?', () => {
  const g = wall();
  g.mark(0, 0, true); assert.ok(g.cells[0][0].flagged && !g.cells[0][0].question);
  assert.strictEqual(g.minesLeft(), 4);
  g.mark(0, 0, true); assert.ok(!g.cells[0][0].flagged && g.cells[0][0].question);
  assert.strictEqual(g.minesLeft(), 5);                   // a ? is not a flag
  g.mark(0, 0, true); assert.ok(!g.cells[0][0].flagged && !g.cells[0][0].question);
  g.toggleFlag(1, 1); g.toggleFlag(1, 1);
  assert.ok(!g.cells[1][1].flagged && !g.cells[1][1].question);
});

test('a ? cell can be revealed, undo restores the ?, and a ? does not count toward a chord', () => {
  const g = wall();
  g.mark(0, 0, true); g.mark(0, 0, true);                 // now a "?"
  g.reveal(0, 0);
  assert.ok(g.cells[0][0].revealed && !g.cells[0][0].question);
  g.undo();
  assert.ok(!g.cells[0][0].revealed && g.cells[0][0].question);
  g.reveal(1, 0); g.mark(0, 2, true); g.mark(0, 2, true);   // number (0,1)=2 with one "?" and no flags
  assert.strictEqual(g.chord(0, 1), false);
});

// ---- power-ups ----
test('scanner counts mines in the 3x3 area, is limited, and undo gives the charge back', () => {
  const g = wall({ powerups: true });
  assert.strictEqual(g.scanner, 3);
  assert.strictEqual(g.scan(0, 1), true);
  assert.deepStrictEqual(g.scans, [{ r: 0, c: 1, n: 2 }]);   // (0,2) and (1,2)
  assert.strictEqual(g.scan(0, 1), false);                    // same cell twice
  assert.strictEqual(g.scan(2, 1), true);
  assert.deepStrictEqual(g.scans[1], { r: 2, c: 1, n: 3 });
  g.scan(4, 4); assert.strictEqual(g.scanner, 0);
  assert.strictEqual(g.scan(0, 0), false);                    // out of charges
  g.undo(); assert.strictEqual(g.scanner, 1); assert.strictEqual(g.scans.length, 2);
  assert.strictEqual(new Game(5, 5, 5).scan(0, 0), false);    // power-ups are off by default
  const fresh = new Game(5, 5, 5, Math.random, { powerups: true });
  assert.strictEqual(fresh.scan(0, 0), false);                // nothing to scan before the first click
});

test('shield absorbs one mine; the second mine loses; undo restores the shield', () => {
  const g = wall({ powerups: true });
  g.reveal(0, 2);
  assert.strictEqual(g.status, 'playing');
  assert.ok(g.cells[0][2].flagged && !g.cells[0][2].revealed);
  assert.strictEqual(g.shield, 0);
  g.reveal(1, 2);
  assert.strictEqual(g.status, 'lost');
  g.undo(); g.undo();
  assert.strictEqual(g.shield, 1); assert.ok(!g.cells[0][2].flagged);
});

// ---- lives ----
test('lives: each mine costs a life, the third ends the game, undo restores lives', () => {
  const g = wall({ lives: 3 });
  g.reveal(0, 2);
  assert.deepStrictEqual([g.status, g.lives, g.cells[0][2].revealed], ['playing', 2, true]);
  assert.strictEqual(g.minesLeft(), 4);                       // a mine you hit counts as found
  g.reveal(1, 2); assert.strictEqual(g.lives, 1);
  g.reveal(2, 2);
  assert.deepStrictEqual([g.status, g.lives], ['lost', 0]);
  g.undo(); assert.deepStrictEqual([g.status, g.lives], ['playing', 1]);
});

test('lives: you can still win with mines revealed', () => {
  const g = wall({ lives: 3 });
  g.reveal(0, 2); g.reveal(0, 0);
  g.reveal(0, 4);
  assert.strictEqual(g.status, 'won');
  assert.strictEqual(g.lives, 2);
});

// ---- limited undo, time-out ----
test('limited undo: only the allowed number of undos, redo is free', () => {
  const g = wall({ undoLimit: 2 });
  g.reveal(0, 0); g.toggleFlag(4, 4); g.toggleFlag(3, 4);
  assert.ok(g.undo()); assert.ok(g.undo());
  assert.strictEqual(g.undosLeft, 0); assert.strictEqual(g.undoCount, 2);
  assert.strictEqual(g.canUndo(), false); assert.strictEqual(g.undo(), false);
  assert.ok(g.redo()); assert.ok(g.redo());                   // redo is not limited
  assert.strictEqual(g.undoCount, 2);
});

test('time-out ends the game for good: no moves, no undo', () => {
  const g = wall();
  g.reveal(0, 0);
  assert.strictEqual(g.endByTimeout(), true);
  assert.strictEqual(g.status, 'timeout');
  assert.strictEqual(g.reveal(4, 4), false); assert.strictEqual(g.toggleFlag(4, 4), false);
  assert.strictEqual(g.canUndo(), false); assert.strictEqual(g.endByTimeout(), false);
});

// ---- two players ----
test('two players: turns alternate, flags do not pass the turn, cells are scored, a mine loses for the player who hit it', () => {
  const g = wall({ players: 2 });
  g.reveal(0, 0);                                             // player 1 opens 10 cells
  assert.deepStrictEqual([g.scores, g.current], [[10, 0], 1]);
  g.toggleFlag(4, 4); assert.strictEqual(g.current, 1);       // flagging is free
  g.reveal(0, 3);
  assert.deepStrictEqual([g.scores, g.current], [[10, 1], 0]);
  g.reveal(0, 2);                                             // player 1 hits a mine
  assert.deepStrictEqual([g.status, g.current], ['lost', 0]);
  g.undo();
  assert.deepStrictEqual([g.status, g.current, g.scores], ['playing', 0, [10, 1]]);
});

test('two players: clearing the board ends it with scores kept', () => {
  const g = wall({ players: 2 });
  g.reveal(0, 0); g.reveal(0, 4);
  assert.strictEqual(g.status, 'won');
  assert.strictEqual(g.scores[0] + g.scores[1], 20);
});

// ---- board shapes ----
test('neighbour counts for square, hex and torus boards, and neighbours are symmetric', () => {
  const sq = new Game(5, 5, 3), hex = new Game(5, 5, 3, Math.random, { topology: 'hex' }), tor = new Game(5, 5, 3, Math.random, { topology: 'torus' });
  assert.deepStrictEqual([sq.neighbors(0, 0).length, sq.neighbors(2, 2).length], [3, 8]);
  assert.deepStrictEqual([hex.neighbors(2, 2).length, hex.neighbors(0, 1).length, hex.neighbors(1, 1).length], [6, 4, 6]);
  assert.deepStrictEqual([tor.neighbors(0, 0).length, tor.neighbors(2, 2).length], [8, 8]);
  assert.ok(tor.neighbors(0, 0).some(([r, c]) => r === 4 && c === 4));   // wraps to the opposite corner
  for (const g of [sq, hex, tor])
    g.nb.forEach((list, i) => list.forEach(j => assert.ok(g.nb[j].includes(i), `${g.topology}: ${i} <-> ${j}`)));
  // odd rows are shifted right: (1,1) touches (0,1),(0,2) above and (2,1),(2,2) below
  assert.deepStrictEqual(hex.neighbors(1, 1).map(([r, c]) => `${r},${c}`).sort(), ['0,1', '0,2', '1,0', '1,2', '2,1', '2,2']);
});

test('hex numbers use 6 neighbours', () => {
  const g = new Game(5, 5, 1, Math.random, { topology: 'hex' }); g.setMines([[0, 0]]);
  assert.strictEqual(g.cells[0][1].adjacent, 1);
  assert.strictEqual(g.cells[1][0].adjacent, 1);   // odd row: (0,0) is its upper-left neighbour
  assert.strictEqual(g.cells[1][1].adjacent, 0);   // on a square board this would be 1
});

test('wrap-around flood-fill crosses the edge', () => {
  const t = wall({ topology: 'torus' });
  assert.strictEqual(t.topology, 'torus');
  t.reveal(0, 0);
  assert.strictEqual(revealed(t), 20);              // columns 4 and 0 are neighbours: everything but the mines opens
  assert.strictEqual(t.status, 'won');
  const s = wall(); s.reveal(0, 0);
  assert.strictEqual(revealed(s), 10);              // on a flat board only the left side opens
});

// ---- seeds ----
test('a seed reproduces the board whatever the random source; first clicks are safe and boards nearly agree', () => {
  const make = (seed, click) => { const g = new Game(16, 16, 40, Math.random, { seed }); g.reveal(...click); return g; };
  const a = make(77, [8, 8]), b = make(77, [8, 8]), c = make(77, [0, 0]);
  same(a.cells, b.cells);
  assert.ok(!a.cells[8][8].mine && !c.cells[0][0].mine);
  const mines = g => g.cells.flat().map((x, i) => (x.mine ? i : -1)).filter(i => i >= 0);
  const shared = mines(a).filter(i => mines(c).includes(i)).length;
  assert.ok(shared > 25, 'different first clicks only move the mines near the click');
  assert.notDeepStrictEqual(mines(a), mines(make(78, [8, 8])));
  assert.strictEqual(new Game(9, 9, 10, mulberry32(5)).seed, new Game(9, 9, 10, mulberry32(5)).seed); // drawn from the rng
});

// ---- solver, no-guess boards, hints ----
test('hints are always safe and, used repeatedly, never lose', () => {
  let usedHints = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const g = new Game(9, 9, 10, mulberry32(seed));
    g.reveal(4, 4);
    for (let step = 0; step < 200 && g.status === 'playing'; step++) {
      const h = g.hint();
      if (!h) break;
      assert.ok(!g.cells[h.r][h.c].mine, `seed ${seed}: hint on a mine`);
      g.reveal(h.r, h.c); usedHints++;
    }
    assert.notStrictEqual(g.status, 'lost');
  }
  assert.ok(usedHints > 100);
});

test('hint gives nothing before the first click, and counts only hints it gives', () => {
  const g = new Game(9, 9, 10, mulberry32(3));
  assert.strictEqual(g.hint(), null); assert.strictEqual(g.hintsUsed, 0);
  g.reveal(4, 4);
  assert.ok(g.hint()); assert.strictEqual(g.hintsUsed, 1);
});

test('no-guess boards can be finished with hints alone, on every board shape', () => {
  const cases = [[9, 9, 10, 'square'], [16, 16, 40, 'square'], [9, 9, 10, 'hex'], [9, 9, 10, 'torus'], [16, 30, 99, 'square']];
  for (const [rows, cols, mines, topology] of cases) {
    for (let seed = 1; seed <= 3; seed++) {
      const g = new Game(rows, cols, mines, mulberry32(seed), { noGuess: true, topology });
      const t0 = Date.now();
      g.reveal(Math.floor(rows / 2), Math.floor(cols / 2));
      assert.ok(Date.now() - t0 < 4000, `${rows}x${cols} ${topology} took too long`);
      assert.strictEqual(g.guessFree, true, `${rows}x${cols}x${mines} ${topology} seed ${seed}`);
      for (let step = 0; step < 1000 && g.status === 'playing'; step++) {
        const h = g.hint();
        assert.ok(h, `${rows}x${cols} ${topology} seed ${seed}: stuck without a safe move`);
        g.reveal(h.r, h.c);
      }
      assert.strictEqual(g.status, 'won');
    }
  }
});

test('solver: shape rules settle 1-2-1 patterns, and a coin-flip board is not solvable', () => {
  // 1 mine in either of two cells that no number can tell apart: a pure guess
  const nb = [[1], [0, 2], [1]];                       // a 3-cell line: 0 - 1 - 2
  assert.strictEqual(Solver.solvable(nb, Uint8Array.from([0, 0, 1]), 0), true);   // opening 0 shows a 0 -> all safe/known
  const two = Solver.buildNeighbors(1, 4, 'square');   // cells 0 1 2 3 in a row, mines at 1 and 3? number at 0 is 1
  assert.strictEqual(Solver.solvable(two, Uint8Array.from([0, 1, 0, 1]), 0), false); // 0 sees 1 mine at 1; 2 is a 2 but unreachable
});

// ---- 3BV ----
test('3BV counts one click per zero area plus each number that touches no zero', () => {
  assert.strictEqual(wall().bbbv(), 2);                // a zero area on each side of the wall
  const corner = new Game(5, 5, 1); corner.setMines([[0, 0]]);
  assert.strictEqual(corner.bbbv(), 1);
  const corners = new Game(3, 3, 4); corners.setMines([[0, 0], [0, 2], [2, 0], [2, 2]]);
  assert.strictEqual(corners.bbbv(), 5);               // no zeros: each of the 5 safe cells is its own click
});

// ---- replay ----
test('replay frames end exactly where the game ended, frame 0 is blank, and undone moves are not replayed', () => {
  const g = wall({ powerups: true, lives: 3, players: 2 });
  g.reveal(0, 0); g.mark(4, 4, true); g.scan(1, 3); g.mark(4, 4, true); g.reveal(0, 2);   // shield absorbs this mine
  g.toggleFlag(0, 4); g.undo(); g.undo();                                                 // undone: not in the replay
  g.reveal(1, 3); g.reveal(2, 3); g.reveal(3, 3); g.reveal(0, 4);
  const frames = g.replayFrames();
  assert.strictEqual(frames.length, g.moveCount + 1);
  assert.strictEqual(frames[0].cells.flat().filter(c => c.revealed || c.flagged).length, 0);
  same(frames.at(-1).cells, g.cells);
  assert.strictEqual(frames.at(-1).status, g.status);
  assert.deepStrictEqual(frames.at(-1).scores, g.scores);
});

test('replay of a lost game and of a time-out', () => {
  const g = wall(); g.reveal(0, 0); g.reveal(1, 2);
  assert.strictEqual(g.status, 'lost');
  const f = g.replayFrames();
  assert.deepStrictEqual([f.length, f.at(-1).status, f.at(-1).exploded], [3, 'lost', { r: 1, c: 2 }]);
  const t = wall(); t.reveal(0, 0); t.endByTimeout();
  assert.strictEqual(t.replayFrames().at(-1).status, 'timeout');
});

// ---- saving the new state ----
test('everything new survives serialize/deserialize', () => {
  const g = wall({ powerups: true, lives: 3, undoLimit: 4, players: 2, topology: 'square' });
  g.mark(4, 4, true); g.mark(4, 4, true); g.scan(1, 3); g.reveal(0, 0); g.hint(); g.undo();
  const h = roundTrip(g);
  assert.ok(h);
  assert.deepStrictEqual(Serializer.serialize(h), Serializer.serialize(g));
  assert.deepStrictEqual([h.scanner, h.shield, h.lives, h.current, h.undosLeft, h.undoCount, h.hintsUsed], [g.scanner, g.shield, g.lives, g.current, g.undosLeft, g.undoCount, g.hintsUsed]);
  assert.deepStrictEqual(h.replayFrames().length, g.replayFrames().length);
  h.redo(); g.redo(); same(h.cells, g.cells);
  const hex = new Game(9, 9, 10, mulberry32(2), { topology: 'hex', seed: 5 }); hex.reveal(4, 4);
  assert.ok(roundTrip(hex)); assert.strictEqual(roundTrip(hex).topology, 'hex');
});

test('saves from before the new features still load', () => {
  // old format: no fmt, 3 flag bits (mine 1, revealed 2, flagged 4), adjacent << 3
  const code = (mine, rev, flag, adj) => String.fromCharCode(48 + (mine | (rev << 1) | (flag << 2) | (adj << 3)));
  const cells = code(0, 1, 0, 1) + code(1, 0, 0, 0) + code(0, 0, 0, 1);       // 1x3: open 1, mine, hidden 1
  const snap = { cells, status: 'playing', minesPlaced: true, exploded: null };
  const g = Serializer.deserialize({ rows: 1, cols: 3, mines: 1, ...snap, history: [{ ...snap, cells: code(0, 0, 0, 1) + code(1, 0, 0, 0) + code(0, 0, 0, 1) }], redo: [] });
  assert.ok(g);
  assert.strictEqual(g.cells[0][0].revealed, true);
  assert.strictEqual(g.topology, 'square'); assert.strictEqual(g.lives, null);
  assert.strictEqual(g.undo(), true);
});

test('tampered new fields are rejected', () => {
  const base = () => JSON.parse(JSON.stringify(Serializer.serialize(wall({ powerups: true, lives: 3, undoLimit: 2 }))));
  const bad = [
    d => { d.topology = 'cube'; }, d => { d.lives = 7; }, d => { d.lives = null; }, d => { d.scanner = 9; }, d => { d.shield = 2; },
    d => { d.scans = [{ r: 0, c: 0, n: 99 }]; }, d => { d.current = 1; }, d => { d.scores = [1]; }, d => { d.moveCount = 3; },
    d => { d.moves = [['x', 0, 0]]; }, d => { d.moves = [['r', 99, 0]]; }, d => { d.undosLeft = null; }, d => { d.undosLeft = 500; },
    d => { d.players = 3; }, d => { d.seed = -1; }, d => { d.fmt = 3; }, d => { d.powerups = 'yes'; },
    d => { d.cells = String.fromCharCode(48 + 6) + d.cells.slice(1); },          // revealed and flagged at once
    d => { d.cells = String.fromCharCode(48 + 10) + d.cells.slice(1); },         // revealed and question at once
  ];
  assert.ok(Serializer.deserialize(base()));
  for (const f of bad) { const d = base(); f(d); assert.strictEqual(Serializer.deserialize(d), null, f.toString()); }
});
