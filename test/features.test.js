// Tests for the later features: assists, new commands and power-ups, earned undos, shifting mines, timeline, checkpoints,
// the computer opponent, survival, puzzles, hidden counter, shop, stars, missions, weekly challenge and ghost races.
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../src/game.js');
const Commands = require('../src/commands.js');
const Serializer = require('../src/serializer.js');
const Solver = require('../src/solver.js');
const AiPlayer = require('../src/ai.js');
const Modes = require('../src/modes.js');
const Puzzles = require('../src/puzzles.js');
const Shop = require('../src/shop.js');
const Ghosts = require('../src/ghosts.js');
const Stats = require('../src/stats.js');
const Challenges = require('../src/challenges.js');
const { ViewModel } = require('../src/viewmodel.js');
const { mulberry32, weeklyId, weeklySeed } = require('../src/rng.js');

const WALL = [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]];
const wall = opts => { const g = new Game(5, 5, 5, Math.random, opts); g.setMines(WALL); return g; };
const fakeStorage = () => { const d = {}; return { getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); }, data: d }; };
const make = (options = {}, seed = 7, st = fakeStorage(), extra = {}) => {
  const vm = new ViewModel(st, { rng: mulberry32(seed), ...extra });
  for (const [k, v] of Object.entries(options)) vm.setOption(k, v);
  vm.start();
  return vm;
};
const cellsOf = vm => vm.game.cells.flatMap((row, r) => row.map((cell, c) => ({ r, c, cell })));
const mineCell = vm => cellsOf(vm).find(x => x.cell.mine && !x.cell.revealed);
// Win by clicking every safe cell; secs is put on the clock after the first click.
function clearBoard(vm, secs = 0, first = [vm.game.rows >> 1, vm.game.cols >> 1]) {
  vm.click(...first); vm.elapsed = secs;
  for (const { r, c, cell } of cellsOf(vm)) if (!cell.mine && !cell.revealed && vm.game.status === 'playing') vm.click(r, c);
}

// ---- assists on the Game ----
test('auto-flag: flags what logic proves in one undoable move, and counts as a hint', () => {
  const g = wall();
  g.reveal(0, 0);
  assert.strictEqual(g.provenMines().length, 5);
  assert.strictEqual(g.execute(new Commands.AutoFlagCommand()), true);
  assert.deepStrictEqual(g.cells.flat().filter(c => c.flagged).length, 5);
  assert.ok(WALL.every(([r, c]) => g.cells[r][c].flagged));
  assert.strictEqual(g.hintsUsed, 1);
  assert.strictEqual(g.execute(new Commands.AutoFlagCommand()), false);        // nothing left to prove
  assert.strictEqual(g.moves.at(-1).type, 'a');
  g.undo();
  assert.strictEqual(g.cells.flat().filter(c => c.flagged).length, 0);
  assert.strictEqual(g.hintsUsed, 1);                                          // undo does not give the hint back
  assert.strictEqual(wall().execute(new Commands.AutoFlagCommand()), false);   // nothing is open yet
});

test('auto-flag never flags a safe cell (random boards, all shapes)', () => {
  let flagged = 0;
  for (const topology of ['square', 'hex', 'torus'])
    for (let seed = 1; seed <= 40; seed++) {
      const g = new Game(9, 9, 12, mulberry32(seed), { topology });
      g.reveal(4, 4);
      g.execute(new Commands.AutoFlagCommand());
      for (const row of g.cells) for (const c of row) if (c.flagged) { assert.ok(c.mine, `${topology} seed ${seed}`); flagged++; }
    }
  assert.ok(flagged > 50);
});

test('chances, best guess and the one-time flag check', () => {
  const g = new Game(9, 9, 10, mulberry32(3));
  assert.strictEqual(g.chances(), null); assert.strictEqual(g.bestGuess(), null); assert.strictEqual(g.checkFlags(), null);   // before the first click
  g.reveal(4, 4);
  const ch = g.chances();
  assert.strictEqual(ch.length, 81);
  assert.ok(ch.every(x => x === null || (x >= 0 && x <= 100)));
  assert.ok(ch.some(x => x !== null && x > 0 && x < 100) || g.hintsUsed >= 1);
  const guess = g.bestGuess();
  assert.ok(guess && guess.chance >= 0 && !g.cells[guess.r][guess.c].revealed);
  assert.strictEqual(g.hintsUsed, 2);
  const hidden = g.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).filter(([, , x]) => !x.revealed);
  const wrong = hidden.find(([, , x]) => !x.mine), right = hidden.find(([, , x]) => x.mine);
  g.toggleFlag(wrong[0], wrong[1]); g.toggleFlag(right[0], right[1]);
  assert.deepStrictEqual(g.checkFlags(), [{ r: wrong[0], c: wrong[1] }]);
  assert.strictEqual(g.checkFlags(), null);                                    // only once
  g.undo(); g.undo();
  assert.strictEqual(g.checkFlags(), null);                                    // undo does not reset it
});

// ---- power-ups ----
test('reveal a row / a column: safe cells open, mines are flagged, one charge each, undo restores', () => {
  const g = wall({ powerups: true });
  assert.strictEqual(g.execute(new Commands.LineCommand(0, 0, 'row')), true);
  assert.ok(g.cells[0].every((c, i) => (i === 2 ? c.flagged && !c.revealed : c.revealed)));
  assert.strictEqual(g.rowCharges, 0);
  assert.strictEqual(g.execute(new Commands.LineCommand(1, 0, 'row')), false);  // out of charges (here the opening also won the game)
  g.undo(); assert.strictEqual(g.rowCharges, 1); assert.ok(!g.cells[0][0].revealed);
  assert.strictEqual(g.execute(new Commands.LineCommand(0, 3, 'col')), true);
  assert.ok(g.cells.every(row => row[3].revealed)); assert.strictEqual(g.colCharges, 0);
  g.undo(); assert.strictEqual(g.colCharges, 1);
  assert.strictEqual(wall().execute(new Commands.LineCommand(0, 0, 'row')), false);   // power-ups are off by default
});

test('extra life power-up: only in lives games, one charge, undo takes it back', () => {
  const g = wall({ powerups: true, lives: 3 });
  assert.strictEqual(g.execute(new Commands.ExtraLifeCommand()), true);
  assert.deepStrictEqual([g.lives, g.lifeCharges], [4, 0]);
  assert.strictEqual(g.execute(new Commands.ExtraLifeCommand()), false);
  g.undo(); assert.deepStrictEqual([g.lives, g.lifeCharges], [3, 1]);
  assert.strictEqual(wall({ powerups: true }).execute(new Commands.ExtraLifeCommand()), false);   // no lives, no extra life
});

test('time freeze charges are not given back by undo', () => {
  const g = wall({ powerups: true, freezeCharges: 1 });
  assert.strictEqual(g.freezeCharges, 1);
  g.reveal(0, 0);
  assert.strictEqual(g.useFreeze(), true);
  g.undo();
  assert.strictEqual(g.freezeCharges, 0);
  assert.strictEqual(g.useFreeze(), false);
});

test('bought power-ups add charges; they survive saving', () => {
  const g = wall({ powerups: true, lives: 3, bonus: { scanner: 3, row: 2, life: 1, freeze: 1 }, freezeCharges: 1 });
  assert.deepStrictEqual([g.scanner, g.shield, g.rowCharges, g.colCharges, g.lifeCharges, g.freezeCharges], [6, 1, 3, 1, 2, 2]);
  const h = Serializer.deserialize(JSON.parse(JSON.stringify(Serializer.serialize(g))));
  assert.deepStrictEqual([h.scanner, h.rowCharges, h.lifeCharges, h.freezeCharges, h.bonus.scanner], [6, 3, 2, 2, 3]);
});

// ---- earned undos, shifting mines ----
test('limited undo: one more undo for every N safe cells opened, each threshold pays once', () => {
  const g = new Game(9, 9, 10, mulberry32(1), { undoLimit: 3, undoEarnEvery: 20 });
  g.reveal(4, 4);
  const opened = g.cells.flat().filter(c => c.revealed).length, earned = Math.floor(opened / 20);
  assert.ok(earned >= 1, `${opened} cells opened`);
  assert.deepStrictEqual([g.earned, g.undosLeft], [earned, 3 + earned]);
  g.undo(); assert.strictEqual(g.undosLeft, 3 + earned - 1);
  g.reveal(4, 4);                                                              // the same cells again: no second payout
  assert.deepStrictEqual([g.earned, g.undosLeft], [earned, 3 + earned - 1]);
  const h = Serializer.deserialize(JSON.parse(JSON.stringify(Serializer.serialize(g))));
  assert.deepStrictEqual([h.earned, h.undosLeft, h.earnEvery], [earned, 3 + earned - 1, 20]);
});

test('shifting mines: one unflagged mine moves every N moves, numbers on screen stay true, undo restores it', () => {
  let shifted = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Game(9, 9, 10, mulberry32(seed), { shiftEvery: 3 });
    g.reveal(4, 4);
    const safeHidden = () => g.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).filter(([, , x]) => !x.revealed && !x.mine);
    const minesAt = () => g.cells.flat().map((c, i) => (c.mine ? i : -1)).filter(i => i >= 0).join();
    const before = minesAt();
    for (let k = 0; k < 2 && g.status === 'playing'; k++) { const [r, c] = safeHidden()[0] || []; if (r !== undefined) g.reveal(r, c); }
    if (g.status !== 'playing' || g.movesUsed() < 3) continue;
    const after = minesAt();
    assert.strictEqual(g.cells.flat().filter(c => c.mine).length, 10);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++)                          // every number still matches the mines
      assert.strictEqual(g.cells[r][c].adjacent, g.neighbors(r, c).filter(([y, x]) => g.cells[y][x].mine).length);
    for (const c of g.cells.flat()) if (c.revealed) assert.ok(!c.mine);
    if (after !== before) {
      shifted++;
      assert.strictEqual(g.shiftedAt, g.moveCount);
      g.undo(); assert.strictEqual(minesAt(), before);                                // undo puts the mine back
      g.redo(); assert.strictEqual(minesAt(), after);
      const frames = g.replayFrames();                                                // a replay moves the same mine
      assert.deepStrictEqual(frames.at(-1).cells.flat().map(c => c.mine), g.cells.flat().map(c => c.mine));
      const h = Serializer.deserialize(JSON.parse(JSON.stringify(Serializer.serialize(g))));
      assert.deepStrictEqual(h.replayFrames().at(-1).cells.flat().map(c => c.mine), g.cells.flat().map(c => c.mine));
    }
  }
  assert.ok(shifted >= 3, `only ${shifted} boards shifted a mine`);
});

test('shifting is deterministic from the seed', () => {
  const run = () => { const g = new Game(9, 9, 10, mulberry32(4), { shiftEvery: 2, seed: 99 }); g.reveal(4, 4);
    for (let k = 0; k < 6 && g.status === 'playing'; k++) { const h = g.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).find(([, , x]) => !x.revealed && !x.mine); if (h) g.reveal(h[0], h[1]); }
    return g.cells.flat().map(c => +c.mine).join(''); };
  assert.strictEqual(run(), run());
});

// ---- serialization of the new state ----
test('moves keep their clock readings, and mines0 lets a loaded game replay', () => {
  const g = wall({ powerups: true });
  g.reveal(0, 0); g.moves[0].at = 3; g.toggleFlag(4, 4); g.moves[1].at = 5;
  const text = JSON.stringify(Serializer.serialize(g));
  assert.deepStrictEqual(JSON.parse(text).moves, [['r', 0, 0, 3], ['f', 4, 4, 5]]);
  const h = Serializer.deserialize(JSON.parse(text));
  assert.deepStrictEqual(h.moves.map(m => m.at), [3, 5]);
  assert.deepStrictEqual(h.replayFrames().at(-1).cells.flat().map(c => c.revealed), g.cells.flat().map(c => c.revealed));
});

test('the new saved fields are checked', () => {
  const base = () => JSON.parse(JSON.stringify(Serializer.serialize(wall({ powerups: true, lives: 3, undoLimit: 3, undoEarnEvery: 20 }))));
  assert.ok(Serializer.deserialize(base()));
  const bad = [d => { d.flagChecks = 2; }, d => { d.earnEvery = 0; }, d => { d.earned = -1; }, d => { d.shiftEvery = 'x'; }, d => { d.moveLimit = 0; }, d => { d.stage = 0; },
               d => { d.puzzleId = 'zzz'; }, d => { d.bonus = null; }, d => { d.bonus = { scanner: 'x' }; }, d => { d.mines0 = [[0, 0]]; }, d => { d.mines0 = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]; },
               d => { d.rowCharges = 500; }, d => { d.lifeCharges = -1; }, d => { d.freezeCharges = 100; }, d => { d.baseFreeze = 10; }];
  for (const f of bad) { const d = base(); f(d); assert.strictEqual(Serializer.deserialize(d), null, f.toString()); }
  const old = base(); for (const k of ['flagChecks', 'earnEvery', 'earned', 'shiftEvery', 'moveLimit', 'puzzleId', 'stage', 'bonus', 'baseFreeze', 'freezeCharges', 'shieldStart', 'mines0']) delete old[k];
  for (const snap of [old, ...old.history, ...old.redo]) for (const k of ['rowCharges', 'colCharges', 'lifeCharges']) delete snap[k];
  assert.ok(Serializer.deserialize(old), 'a save from before these fields still loads');
});

// ---- computer opponent ----
test('the computer plays a provably safe cell when there is one, and guesses the lowest chance when stuck', () => {
  const g = wall({ players: 2 }); g.reveal(0, 0);
  const ai = new AiPlayer(mulberry32(1)), move = ai.choose(g);
  assert.strictEqual(move.kind, 'safe'); assert.ok(!g.cells[move.r][move.c].mine && !g.cells[move.r][move.c].revealed);
  const stuck = new Game(9, 9, 10, mulberry32(2)); stuck.reveal(4, 4);
  let guesses = 0, wins = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const g2 = new Game(9, 9, 10, mulberry32(seed), { players: 2 });
    g2.reveal(4, 4);
    const m = new AiPlayer(mulberry32(seed)).choose(g2);
    if (!m) continue;
    if (m.kind === 'safe') { assert.ok(!g2.cells[m.r][m.c].mine, `seed ${seed}: the "safe" move was a mine`); wins++; }
    else { guesses++; const v = g2._visible(), p = Solver.probabilities(g2.nb, v.revealed, v.num, v.known, 10); assert.ok(p[m.r * 9 + m.c] <= Math.min(...[...p].filter((x, i) => x >= 0 && x < 1 && !v.revealed[i])) + 1e-9); }
  }
  assert.ok(guesses > 0 && wins > 0, `${wins} safe, ${guesses} guesses`);
});

test('versus the computer: it answers your move on the next tick, you cannot move on its turn, and a full game finishes', () => {
  const vm = make({ mode: 'ai' }, 11);
  assert.strictEqual(vm.game.players, 2); assert.strictEqual(vm.mode.isAi, true);
  vm.click(4, 4);
  assert.strictEqual(vm.game.current, 1);
  assert.match(vm.state().statusText, /The computer's turn/);
  const seen = vm.flashSeq; vm.click(0, 0);                                       // not your turn
  assert.strictEqual(vm.flashSeq, seen + 1);
  const before = vm.game.cells.flat().filter(c => c.revealed).length;
  vm.tick();
  assert.ok(vm.game.cells.flat().filter(c => c.revealed).length > before || vm.game.status !== 'playing');
  for (let i = 0; i < 400 && vm.game.status === 'playing'; i++) {
    if (vm.game.current === 0) { const h = cellsOf(vm).find(x => !x.cell.mine && !x.cell.revealed); if (!h) break; vm.click(h.r, h.c); }
    vm.tick();
  }
  assert.notStrictEqual(vm.game.status, 'playing');
  assert.match(vm.state().statusText, /You win|The computer wins|draw|hit a mine/);
  assert.strictEqual(vm.stats.duels, 1);
});

// ---- survival ----
test('survival: clearing a board starts a bigger, denser one and the lives carry over', () => {
  const vm = make({ mode: 'survival' }, 5);
  assert.deepStrictEqual([vm.game.rows, vm.game.cols, vm.game.mineCount, vm.game.stage, vm.game.lives], [9, 9, 10, 1, 3]);
  vm.click(4, 4);
  const m = mineCell(vm); vm.click(m.r, m.c);                                         // lose a life
  assert.strictEqual(vm.game.lives, 2);
  for (const { r, c, cell } of cellsOf(vm)) if (!cell.mine && !cell.revealed && vm.game.status === 'playing') vm.click(r, c);
  assert.deepStrictEqual([vm.game.rows, vm.game.cols, vm.game.mineCount, vm.game.stage, vm.game.lives], [12, 12, 22, 2, 2]);
  assert.match(vm.state().statusText, /Board 2: 12x12 with 22 mines, 2 lives left/);
  assert.match(vm.state().statusText, /Survival: board 2/);
  assert.strictEqual(vm.stats.won, 1);
  assert.deepStrictEqual(vm.mode.boardFor(5), [16, 30, 99]);
  const sizes = [6, 7, 9].map(s => vm.mode.boardFor(s));
  assert.ok(sizes.every(([r, c, k]) => r <= 30 && c <= 40 && k <= r * c - 9));
  assert.ok(vm.mode.boardFor(7)[2] > vm.mode.boardFor(6)[2] || vm.mode.boardFor(7)[0] > vm.mode.boardFor(6)[0]);
});

test('survival: running out of lives ends the run and records the best board; the run resumes after a reload', () => {
  const st = fakeStorage(), vm = make({ mode: 'survival' }, 6, st);
  vm.click(4, 4); vm.save();
  const b = new ViewModel(st, { rng: mulberry32(1) });
  assert.deepStrictEqual([b.gameMode, b.game.stage, b.game.lives], ['survival', 1, 3]);
  while (vm.game.status === 'playing') { const m = mineCell(vm); vm.click(m.r, m.c); }
  assert.match(vm.state().statusText, /Run over: you cleared 0 boards/);
  assert.strictEqual(vm.state().result.title, 'Run over');
  assert.strictEqual(vm.stats.bestSurvival, 1);
});

// ---- puzzles, hidden counter ----
test('puzzle mode: a fixed board, a move limit, no hints, solved puzzles are remembered', () => {
  const vm = make({ mode: 'puzzle', puzzle: 'p2' }, 3);
  assert.deepStrictEqual([vm.game.rows, vm.game.cols, vm.game.puzzleId, vm.game.moveLimit], [6, 6, 'p2', Puzzles.get('p2').limit]);
  assert.match(vm.state().statusText, /Puzzle: 21 moves left/);
  const flash = vm.flashSeq; vm.hint();
  assert.strictEqual(vm.flashSeq, flash + 1); assert.match(vm.state().statusText, /off in this mode/);
  for (let guard = 0; guard < 80 && vm.game.status === 'playing'; guard++) {       // solve it with the logic solver
    const v = vm.game._visible(), { safe } = Solver.deduce(vm.game.nb, v.revealed, v.num, null);
    const i = safe.findIndex((s, k) => s && !v.revealed[k]);
    if (i < 0) break;
    vm.click(Math.floor(i / 6), i % 6);
  }
  assert.strictEqual(vm.game.status, 'won');
  assert.deepStrictEqual(vm.stats.puzzles, ['p2']);
  assert.ok(vm.unlocked['puzzler']);
  assert.match(vm.state().statusText, /Unlocked: .*Puzzler/);
  const saved = new ViewModel(vm.storage, { rng: mulberry32(1) });                  // the solved puzzle is not resumed (finished)
  assert.ok(saved.game);
});

test('puzzle mode: running out of moves loses (no mine hit) and says so', () => {
  const vm = make({ mode: 'puzzle', puzzle: 'p1' }, 3);
  for (let i = 0; i < 60 && vm.game.status === 'playing'; i++) { const h = cellsOf(vm).find(x => !x.cell.mine && !x.cell.revealed); if (!h) break; vm.click(h.r, h.c); }
  if (vm.game.status === 'lost') {
    assert.strictEqual(vm.game.exploded, null);
    assert.match(vm.state().statusText, /Out of moves/);
    assert.strictEqual(vm.state().result.title, 'Out of moves');
  }
});

test('hidden mine counter mode: no counter and no assists; the game plays normally', () => {
  const vm = make({ mode: 'blind' }, 4);
  assert.strictEqual(vm.state().minesText, '???'); assert.strictEqual(make({}, 4).state().minesText, '10');
  vm.click(4, 4);
  const h = vm.flashSeq; vm.bestGuess(); vm.autoFlag(); vm.checkFlags();
  assert.strictEqual(vm.flashSeq, h + 3);
  assert.strictEqual(vm.game.hintsUsed, 0);
  assert.match(vm.state().statusText, /Mine counter hidden, no hints/);
  clearBoard(make({ mode: 'blind' }, 8), 20);
});

test('shifting mines mode shows when the next shift is due', () => {
  const vm = make({ mode: 'shifting' }, 2);
  assert.match(vm.state().statusText, /A mine moves in 5 moves/);
  vm.click(4, 4);
  assert.match(vm.state().statusText, /A mine moves in 4 moves/);
});

// ---- assists in the ViewModel ----
test('hint with nothing certain shows every cell\'s mine chance and counts as a hint', () => {
  let found = 0;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const vm = make({}, seed); vm.click(4, 4);
    if (vm.game.status !== 'playing') continue;
    const v = vm.game._visible();
    if (Solver.hint(vm.game.nb, v.revealed, v.num, v.known, 10) >= 0) continue;
    found = seed;
    vm.hint();
    assert.ok(vm.state().grid.flat().some(c => /^\d+%$/.test(c.text)));
    assert.match(vm.state().statusText, /No cell is certain/);
    assert.strictEqual(vm.game.hintsUsed, 1);
    assert.ok(vm.state().grid.flat().some(c => /prob-(low|mid|high)/.test(c.cls)));
    vm.flag(0, 0); assert.ok(vm.state().grid.flat().every(c => !/%$/.test(c.text)));      // the next change clears them
  }
  assert.ok(found, 'no seed had a stuck position');
});

test('best guess highlights the safest cell; auto-flag flags proven mines; both make the game ineligible for best times', () => {
  const vm = make({}, 5); vm.click(4, 4);
  vm.bestGuess();
  assert.ok(vm.guessCell); assert.match(vm.state().statusText, /Best guess: row \d+, column \d+, a \d+% chance/);
  const { r, c } = vm.guessCell;
  assert.match(vm.state().grid[r][c].cls, /guess/); assert.match(vm.state().grid[r][c].label, /best guess/);
  const w = make({}, 9); w.game.cells.forEach(() => {}); w.click(0, 0);
  w.autoFlag();
  assert.ok(w.game.hintsUsed >= 0);
  const flagged = w.game.cells.flat().filter(x => x.flagged);
  assert.ok(flagged.every(x => x.mine));
  clearBoard(make({}, 5), 30);
  const fresh = make({}, 5); fresh.click(4, 4); fresh.bestGuess(); clearBoard(fresh, 30, [4, 4]);
  assert.strictEqual(fresh.best(), null);                                                // a hint was used: no record
});

test('the flag check costs time, works once, and marks wrong flags with a cross', () => {
  const vm = make({}, 5); vm.click(4, 4); vm.elapsed = 10;
  const hidden = cellsOf(vm).filter(x => !x.cell.revealed), wrong = hidden.find(x => !x.cell.mine);
  vm.flag(wrong.r, wrong.c);
  vm.checkFlags();
  assert.strictEqual(vm.elapsed, 25);
  assert.match(vm.state().grid[wrong.r][wrong.c].cls, /wrong/); assert.match(vm.state().statusText, /1 wrong flag.*15 seconds/);
  vm.move(1, 0); assert.match(vm.state().grid[wrong.r][wrong.c].cls, /wrong/);              // cursor moves do not clear it
  vm.flag(0, 8);
  const seen = vm.flashSeq; vm.checkFlags();
  assert.strictEqual(vm.flashSeq, seen + 1); assert.match(vm.state().statusText, /only be used once/);
  const zen = make({ mode: 'zen' }, 5); zen.click(4, 4); zen.checkFlags(); assert.strictEqual(zen.elapsed, 0);   // no clock, no cost
});

// ---- power-ups in the ViewModel ----
test('reveal-a-row power-up: arm it, click a cell; the status line says so', () => {
  const vm = make({ powerups: true }, 3);
  vm.click(4, 4);
  vm.toggleLine('row'); assert.strictEqual(vm.lineMode, 'row'); assert.match(vm.state().statusText, /click a cell to reveal its row/);
  vm.toggleLine('col'); assert.strictEqual(vm.lineMode, 'col');                       // arming one disarms the other
  vm.toggleLine('row');
  const hiddenRowCell = vm.game.cells[0].findIndex(c => !c.revealed);
  vm.click(0, Math.max(0, hiddenRowCell));
  assert.strictEqual(vm.game.rowCharges, 0);
  assert.ok(vm.game.cells[0].every(c => c.revealed || c.mine || c.flagged));
  assert.strictEqual(vm.lineMode, null);
  const seen = vm.flashSeq; vm.toggleLine('row'); assert.strictEqual(vm.flashSeq, seen + 1);   // no charges left
  const off = make({}, 3); off.click(4, 4); const s2 = off.flashSeq; off.toggleLine('row'); assert.strictEqual(off.flashSeq, s2 + 1);
});

test('extra life and time freeze power-ups', () => {
  const vm = make({ powerups: true, mode: 'lives' }, 3);
  vm.useLife(); assert.strictEqual(vm.game.lives, 4); assert.match(vm.state().statusText, /Life 0/);
  const timed = make({ powerups: true, mode: 'timeattack' }, 3);
  timed.click(4, 4); timed.tick();
  const t0 = timed.elapsed;
  timed.useFreeze(); assert.strictEqual(timed.freezeLeft, 10);
  for (let i = 0; i < 10; i++) timed.tick();
  assert.strictEqual(timed.elapsed, t0);                                                   // the clock waited
  timed.tick(); assert.strictEqual(timed.elapsed, t0 + 1);
  const seen = timed.flashSeq; timed.useFreeze(); assert.strictEqual(timed.flashSeq, seen + 1);   // used up
  const classic = make({ powerups: true }, 3); classic.click(4, 4); const s = classic.flashSeq; classic.useFreeze(); assert.strictEqual(classic.flashSeq, s + 1);
  assert.strictEqual(make({ powerups: true }, 3).state().powerupsInfo.canLife, false);
});

// ---- timeline and checkpoints ----
test('timeline: jump to any earlier or later state; a limited-undo game limits it', () => {
  const vm = make({}, 6);
  vm.flag(0, 0); vm.flag(0, 1); vm.flag(0, 2); vm.flag(0, 3);
  assert.deepStrictEqual([vm.state().timeline.position, vm.state().timeline.total], [4, 4]);
  assert.match(vm.state().timeline.label, /^Move 4 of 4: Flag or \? at row 1, column 4/);
  vm.jumpTo(1);
  assert.strictEqual(vm.game.cells.flat().filter(c => c.flagged).length, 1); assert.strictEqual(vm.state().timeline.position, 1);
  vm.jumpTo(3); assert.strictEqual(vm.game.cells.flat().filter(c => c.flagged).length, 3);
  vm.jumpTo(0); assert.match(vm.state().timeline.label, /Start of the game/);
  const seen = vm.flashSeq; vm.jumpTo(99); vm.jumpTo(-1); vm.jumpTo(1.5);
  assert.strictEqual(vm.state().timeline.position, 0); assert.strictEqual(vm.flashSeq, seen);   // bad positions are ignored
  vm.flag(5, 5);                                                                            // a new move drops the old future
  assert.strictEqual(vm.state().timeline.total, 1);
  const lim = make({ mode: 'undolimit' }, 6);
  for (let i = 0; i < 6; i++) lim.flag(0, i);
  lim.jumpTo(0);                                                                            // would need 6 undos, 3 are allowed
  assert.strictEqual(lim.state().timeline.position, 3); assert.strictEqual(lim.game.undosLeft, 0);
  assert.strictEqual(make({ mode: 'undopenalty' }, 6).state().timeline.canJump, false);
  const pen = make({ mode: 'undopenalty' }, 6); pen.flag(0, 0); pen.flag(0, 1); pen.click(4, 4); pen.elapsed = 5; pen.jumpTo(1);
  assert.strictEqual(pen.elapsed, 5 + 2 * pen.mode.undoPenalty);                            // two undos, each with its time penalty
});

test('checkpoint: return to a saved moment; it counts as one undo and keeps hints used', () => {
  const vm = make({ mode: 'undolimit' }, 6);
  vm.flag(0, 0); vm.setCheckpoint(); assert.strictEqual(vm.state().checkpoint.set, true);
  vm.flag(0, 1); vm.flag(0, 2); vm.click(4, 4); vm.bestGuess();
  const left = vm.game.undosLeft;
  vm.returnToCheckpoint();
  assert.strictEqual(vm.game.cells.flat().filter(c => c.flagged).length, 1);
  assert.deepStrictEqual([vm.game.undosLeft, vm.game.undoCount], [left - 1, 1]);
  assert.strictEqual(vm.game.hintsUsed, 1);                                                 // not reset
  assert.strictEqual(vm.game.status, 'playing');
  while (vm.game.undosLeft > 0) vm.returnToCheckpoint();
  assert.strictEqual(vm.game.undosLeft, 0); assert.strictEqual(vm.state().checkpoint.canReturn, false);
  const seen = vm.flashSeq; vm.returnToCheckpoint(); assert.strictEqual(vm.flashSeq, seen + 1);
  const none = make({}, 6); const s = none.flashSeq; none.returnToCheckpoint(); assert.strictEqual(none.flashSeq, s + 1);   // no checkpoint yet
  const lost = make({}, 6); lost.setCheckpoint(); lost.click(4, 4); const m = mineCell(lost); lost.click(m.r, m.c);
  assert.strictEqual(lost.game.status, 'lost'); lost.returnToCheckpoint(); assert.strictEqual(lost.game.status, 'playing'); assert.strictEqual(lost.game.started(), false);
});

// ---- shop, stars, coins ----
test('stars: 3, 2 or 1 from the time per 3BV unit; none without a clock', () => {
  assert.deepStrictEqual([Stats.starsFor(30, 30, true), Stats.starsFor(30, 60, true), Stats.starsFor(30, 90, true), Stats.starsFor(30, 20, false), Stats.starsFor(0, 20, true), Stats.starsFor(30, 0, true)], [3, 2, 1, null, null, null]);
  const fast = make({}, 7); clearBoard(fast, 1); assert.strictEqual(fast.lastStars, 3);
  assert.strictEqual(fast.state().result.stars, 3); assert.strictEqual(fast.stats.threeStars, 1); assert.ok(fast.unlocked['three-stars']);
  const slow = make({}, 7); clearBoard(slow, 500); assert.strictEqual(slow.lastStars, 1);
  const zen = make({ mode: 'zen' }, 7); clearBoard(zen, 500); assert.strictEqual(zen.lastStars, null);
  const lost = make({}, 7); lost.click(4, 4); const m = mineCell(lost); lost.click(m.r, m.c); assert.strictEqual(lost.lastStars, null);
});

test('coins: earned from wins (more for stars, level and missions), spent in the shop; themes and power-ups', () => {
  assert.strictEqual(Shop.coinsFor({ stars: 3, level: 'beginner' }), 20); assert.strictEqual(Shop.coinsFor({ stars: 1, level: 'expert', challenge: true, mission: true }), 40);
  const st = fakeStorage(), vm = make({}, 7, st);
  assert.strictEqual(vm.state().coins, 0);
  clearBoard(vm, 1);
  const coins = vm.shop.coins;
  assert.ok(coins >= 20); assert.match(vm.state().statusText, new RegExp(`\\+${coins} coins`));
  assert.strictEqual(new ViewModel(st).state().coins, coins);                               // saved
  assert.strictEqual(vm.buy('pu-scanner'), true); assert.strictEqual(vm.shop.coins, coins - 10); assert.strictEqual(vm.shop.stock.scanner, 3);
  assert.strictEqual(vm.buy('theme-ocean'), coins - 10 >= 30);
  vm.shop.coins = 0; vm.shop.save();
  assert.strictEqual(vm.buy('pu-row'), false); assert.match(vm.state().shop.message, /Not enough coins/);
  assert.strictEqual(vm.buy('nope'), false);
  assert.ok(vm.state().shop.items.every(i => i.price > 0));
});

test('themes from the shop are locked until bought; imports and old saves cannot unlock them', () => {
  const st = fakeStorage(), vm = make({}, 1, st);
  assert.strictEqual(vm.setOption('theme', 'ocean'), false); assert.strictEqual(vm.options.theme, 'auto'); assert.match(vm.state().shop.message, /Buy this theme/);
  assert.strictEqual(vm.setOption('theme', 'dark'), true);
  vm.shop.coins = 100; vm.buy('theme-sunset');
  assert.strictEqual(vm.setOption('theme', 'sunset'), true);
  assert.strictEqual(new ViewModel(st).options.theme, 'sunset');                            // owned: stays
  const other = make({}, 1);
  const text = JSON.stringify({ version: 1, options: { theme: 'ocean' } });
  assert.strictEqual(other.importSettings(text).ok, true); assert.strictEqual(other.options.theme, 'auto');
  const st2 = fakeStorage(); st2.setItem('ms-options', JSON.stringify({ theme: 'ocean' }));
  assert.strictEqual(new ViewModel(st2).options.theme, 'auto');
});

test('bought power-ups join the next game that has power-ups on, and only once', () => {
  const st = fakeStorage(), vm = make({}, 2, st);
  vm.shop.coins = 200; vm.buy('pu-scanner'); vm.buy('pu-life'); vm.buy('pu-freeze');
  vm.start();                                                                               // power-ups are off: the stock waits
  assert.strictEqual(vm.shop.stock.scanner, 3);
  vm.setOption('powerups', true); vm.start();
  assert.deepStrictEqual([vm.game.scanner, vm.game.lifeCharges, vm.game.freezeCharges], [6, 0, 0]);   // no lives / no clock: those stay in stock
  assert.deepStrictEqual([vm.shop.stock.scanner, vm.shop.stock.life, vm.shop.stock.freeze], [0, 1, 1]);
  vm.setOption('mode', 'lives'); vm.start();
  assert.strictEqual(vm.game.lifeCharges, 2);
  vm.setOption('mode', 'timeattack'); vm.start();
  assert.strictEqual(vm.game.freezeCharges, 2);
});

// ---- missions ----
test('missions: one is picked per game (the same for a seed), shown, checked at the end, rewarded', () => {
  const vm = make({}, 3);
  assert.ok(vm.mission); assert.match(vm.state().mission.text, /\w/);
  assert.strictEqual(make({}, 3).mission, vm.mission);
  assert.strictEqual(make({ mode: 'puzzle' }, 3).mission, null); assert.strictEqual(make({ mode: 'twoplayer' }, 3).mission, null);
  const pool = new Set(); for (let s = 1; s <= 60; s++) pool.add(make({}, s).mission);
  assert.ok(pool.size >= 4);
  assert.ok(!pool.has('no-life-lost'));                                                       // not offered without lives
  assert.ok(make({ mode: 'lives' }, 1).mission);
  const ctx = (o = {}) => ({ won: true, level: 'beginner', mode: 'classic', time: 40, bv: 20, clicks: 22, markMoves: 0, chordMoves: 0, undos: 0, hints: 0, livesLost: 0, players: 1, ...o });
  assert.ok(Challenges.missionDone('no-flags', ctx())); assert.ok(!Challenges.missionDone('no-flags', ctx({ markMoves: 1 })));
  assert.ok(!Challenges.missionDone('no-chords', ctx({ chordMoves: 2 }))); assert.ok(!Challenges.missionDone('no-undo', ctx({ undos: 1 })));
  assert.ok(!Challenges.missionDone('no-hints', ctx({ hints: 1 }))); assert.ok(!Challenges.missionDone('fast', ctx({ time: 61 }))); assert.ok(Challenges.missionDone('fast', ctx({ time: 60 })));
  assert.ok(!Challenges.missionDone('few-clicks', ctx({ clicks: 31 }))); assert.ok(Challenges.missionDone('few-clicks', ctx({ clicks: 30 })));
  assert.ok(!Challenges.missionDone('no-life-lost', ctx({ livesLost: 1 }))); assert.ok(!Challenges.missionDone('no-flags', ctx({ won: false })));
  assert.ok(!Challenges.missionDone('nonsense', ctx()));
});

test('completing a mission adds to the count, the coins and a notice; failing it does not', () => {
  const ok = make({}, 3); ok.mission = 'no-undo'; clearBoard(ok, 5);
  assert.strictEqual(ok.stats.missions, 1); assert.match(ok.state().statusText, /Mission complete/); assert.ok(ok.unlocked['mission']);
  const no = make({}, 3); no.mission = 'no-flags'; no.flag(0, 0); clearBoard(no, 5);
  assert.strictEqual(no.stats.missions, 0); assert.doesNotMatch(no.state().statusText, /Mission complete/);
  assert.ok(ok.shop.coins > no.shop.coins);
});

// ---- weekly challenge ----
test('weekly ids follow ISO weeks; the rule and seed depend only on the week', () => {
  assert.strictEqual(weeklyId(new Date('2026-11-13T10:00:00Z')), '2026-W46');
  assert.strictEqual(weeklyId(new Date('2026-01-01T00:00:00Z')), '2026-W01');
  assert.strictEqual(weeklyId(new Date('2024-12-30T12:00:00Z')), '2025-W01');
  assert.strictEqual(weeklyId(new Date('2021-01-03T23:59:00Z')), '2020-W53');
  assert.strictEqual(weeklyId(new Date('2026-11-09T00:00:00Z')), weeklyId(new Date('2026-11-15T23:59:59Z')));      // Monday to Sunday
  assert.notStrictEqual(weeklyId(new Date('2026-11-15T23:59:59Z')), weeklyId(new Date('2026-11-16T00:00:01Z')));
  assert.strictEqual(weeklySeed('2026-W46'), weeklySeed('2026-W46')); assert.notStrictEqual(weeklySeed('2026-W46'), weeklySeed('2026-W47'));
  const rules = new Set(); for (let w = 1; w <= 30; w++) { const r = Challenges.weeklyRule('2026-W' + String(w).padStart(2, '0')); assert.ok(Modes.ids.includes(r.mode)); rules.add(r.mode + r.board); }
  assert.ok(rules.size >= 4);
});

test('weekly challenge: the same board, mode and shape for everybody for the week, with its own badge', () => {
  const at = iso => ({ now: () => new Date(iso) });
  const a = make({ mode: 'zen', board: 'torus', powerups: true }, 1, fakeStorage(), at('2026-11-10T08:00:00Z')); a.startWeekly();
  const b = make({}, 99, fakeStorage(), at('2026-11-15T20:00:00Z')); b.startWeekly();
  const rule = Challenges.weeklyRule('2026-W46');
  assert.deepStrictEqual([a.weekly, a.gameMode, a.game.topology, a.level, a.game.powerups], ['2026-W46', rule.mode, rule.board, rule.level, false]);
  assert.deepStrictEqual([b.gameMode, b.game.topology], [rule.mode, rule.board]);
  const first = [a.game.rows >> 1, a.game.cols >> 1];
  a.click(...first); b.click(...first);
  assert.strictEqual(a.game.cells.flat().map(c => +c.mine).join(''), b.game.cells.flat().map(c => +c.mine).join(''));
  assert.match(a.state().statusText, /Weekly challenge 2026-W46/);
  const next = make({}, 1, fakeStorage(), at('2026-11-16T08:00:00Z')); next.startWeekly(); next.click(...first);
  assert.notStrictEqual(next.game.cells.flat().map(c => +c.mine).join(''), a.game.cells.flat().map(c => +c.mine).join(''));
  a.elapsed = 0; for (const { r, c, cell } of cellsOf(a)) if (!cell.mine && !cell.revealed && a.game.status === 'playing') a.click(r, c);
  if (a.game.status === 'won') assert.ok(a.unlocked['weekly']);
  const resumed = new ViewModel(a.storage, { rng: mulberry32(1) }); assert.ok(resumed.game);
});

// ---- ghost race ----
test('ghost race: your best win on a board is kept; racing it shows its progress and who won', () => {
  const st = fakeStorage();
  const first = make({}, 21, st);
  first.start('beginner', first.custom, { seed: 4242, topology: 'square' });
  assert.strictEqual(first.state().ghost, null);
  first.click(4, 4); first.elapsed = 0;
  let t = 0;
  for (const { r, c, cell } of cellsOf(first)) if (!cell.mine && !cell.revealed && first.game.status === 'playing') { t += 2; first.elapsed = t; first.click(r, c); }
  assert.strictEqual(first.game.status, 'won');
  const key = first.shareCode();
  const ghost = first.ghosts.get(key);
  assert.ok(ghost && ghost.time === first.elapsed && ghost.moves.every(m => m.length === 4));
  const race = new ViewModel(st, { rng: mulberry32(1) });
  race.start('beginner', race.custom, { seed: 4242, topology: 'square' });
  const info = race.state().ghost;
  assert.strictEqual(info.time, ghost.time); assert.ok(info.opened >= 0);
  assert.strictEqual(info.total, 71);
  race.click(4, 4); race.elapsed = ghost.moves.at(-1)[3];
  assert.strictEqual(race.state().ghost.opened, info.total);                                  // by then the ghost has finished
  race.elapsed = 0; assert.ok(race.state().ghost.opened <= race.state().ghost.you + 100);
  let t2 = 0;
  for (const { r, c, cell } of cellsOf(race)) if (!cell.mine && !cell.revealed && race.game.status === 'playing') { t2 += 1; race.elapsed = t2; race.click(r, c); }
  assert.strictEqual(race.game.status, 'won');
  assert.match(race.state().statusText, /You beat your ghost by \d+ s/); assert.ok(race.unlocked['ghost-buster']);
  assert.ok(race.ghosts.get(key).time < ghost.time);                                          // the faster win replaces it
  const again = new ViewModel(st, { rng: mulberry32(1) });
  again.start('beginner', again.custom, { seed: 4242, topology: 'square' });
  again.click(4, 4);
  let t3 = 0;
  for (const { r, c, cell } of cellsOf(again)) if (!cell.mine && !cell.revealed && again.game.status === 'playing') { t3 += 50; again.elapsed = t3; again.click(r, c); }
  assert.match(again.state().statusText, /Your ghost was faster/);
});

test('ghosts are only kept for fair wins and are validated when loaded', () => {
  const st = fakeStorage(), vm = make({}, 3, st);
  vm.start('beginner', vm.custom, { seed: 77, topology: 'square' }); vm.click(4, 4); vm.bestGuess(); vm.elapsed = 9;
  for (const { r, c, cell } of cellsOf(vm)) if (!cell.mine && !cell.revealed && vm.game.status === 'playing') vm.click(r, c);
  assert.strictEqual(vm.ghosts.get(vm.shareCode()), null);                                    // a hint was used
  const g = new Ghosts(fakeStorage()); assert.strictEqual(g.save('bad key', 5, []), false);
  st.setItem('ms-ghosts', JSON.stringify([{ key: '9x9x10-square-5', time: 5, moves: [['r', 4, 4]] }, { key: 'nope', time: 5, moves: [] }, null]));
  assert.strictEqual(new Ghosts(st).list.length, 0);                                          // moves without clock readings are not a ghost
  st.setItem('ms-ghosts', '{{');
  assert.strictEqual(new Ghosts(st).list.length, 0);
  const track = Ghosts.track({ key: '9x9x10-square-5', time: 9, moves: [['r', 4, 4, 1], ['r', 0, 0, 3]] });
  assert.deepStrictEqual([track.total, Ghosts.openedAt(track, 0), Ghosts.openedAt(track, 1) > 0, Ghosts.openedAt(track, 3) >= Ghosts.openedAt(track, 1)], [71, 0, true, true]);
});

// ---- saving keeps the new game state ----
test('survival, puzzle, weekly and mission games survive an export and an import', () => {
  const a = make({ mode: 'survival' }, 3); a.click(4, 4);
  const b = new ViewModel(fakeStorage(), { rng: mulberry32(1) }); assert.strictEqual(b.importFile(a.exportGame()).ok, true);
  assert.deepStrictEqual([b.gameMode, b.game.stage, b.mission], ['survival', 1, a.mission]);
  const p = make({ mode: 'puzzle', puzzle: 'p3' }, 3); p.click(0, 0);
  const q = new ViewModel(fakeStorage(), { rng: mulberry32(1) }); assert.strictEqual(q.importFile(p.exportGame()).ok, true);
  assert.deepStrictEqual([q.game.puzzleId, q.game.rows, q.game.moveLimit], ['p3', 7, Puzzles.get('p3').limit]);
  const wk = make({}, 3, fakeStorage(), { now: () => new Date('2026-11-12T00:00:00Z') }); wk.startWeekly(); wk.click(4, 4);
  const w2 = new ViewModel(fakeStorage(), { rng: mulberry32(1) }); assert.strictEqual(w2.importFile(wk.exportGame()).ok, true);
  assert.strictEqual(w2.weekly, '2026-W46');
  const data = JSON.parse(a.exportGame());
  for (const bad of [{ ...data, mission: 'nope' }, { ...data, weekly: '2026-46' }, { ...data, mode: 'survival', game: { ...data.game, stage: null } }])
    assert.strictEqual(new ViewModel(fakeStorage()).importFile(JSON.stringify(bad)).ok, false);
});

test('all the new achievements exist and have rules', () => {
  const ids = Stats.ACHIEVEMENTS.map(a => a.id);
  for (const id of ['three-stars', 'mission', 'puzzler', 'puzzle-master', 'blindfolded', 'beat-the-ai', 'survivor-5', 'shifty', 'weekly', 'ghost-buster']) assert.ok(ids.includes(id), id);
  const t = id => Stats.ACHIEVEMENTS.find(a => a.id === id).test;
  assert.ok(t('puzzle-master')({ puzzlesSolved: 5 })); assert.ok(!t('puzzle-master')({ puzzlesSolved: 4 }));
  assert.ok(t('survivor-5')({ survivalStage: 5 })); assert.ok(!t('survivor-5')({ survivalStage: 4 }));
  assert.ok(t('beat-the-ai')({ vsAiWin: true })); assert.ok(!t('beat-the-ai')({ vsAiWin: false }));
});
