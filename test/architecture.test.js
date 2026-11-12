// Tests for the design-pattern classes: Topology (Strategy), Commands (Command), Modes (Strategy), Serializer, Options,
// KeyBindings, Stats, SaveManager, the Observer in the ViewModel, and the stronger solver rules.
const test = require('node:test');
const assert = require('node:assert');
const Topology = require('../src/topology.js');
const Commands = require('../src/commands.js');
const Modes = require('../src/modes.js');
const Options = require('../src/options.js');
const KeyBindings = require('../src/keybindings.js');
const Stats = require('../src/stats.js');
const SaveManager = require('../src/savemanager.js');
const Serializer = require('../src/serializer.js');
const Solver = require('../src/solver.js');
const { Game } = require('../src/game.js');
const { ViewModel } = require('../src/viewmodel.js');
const { mulberry32 } = require('../src/rng.js');

const fakeStorage = () => { const d = {}; return { getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); }, data: d }; };
const WALL = [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]];
const wall = opts => { const g = new Game(5, 5, 5, Math.random, opts); g.setMines(WALL); return g; };

// ---- Strategy: topology ----
test('topology strategies: three shapes, each answers "who touches this cell?"', () => {
  assert.deepStrictEqual(Topology.ids, ['square', 'hex', 'torus']);
  assert.strictEqual(Topology.get('square').neighbors(5, 5, 0, 0).length, 3);
  assert.strictEqual(Topology.get('torus').neighbors(5, 5, 0, 0).length, 8);
  assert.deepStrictEqual(Topology.get('hex').neighbors(5, 5, 1, 1).map(([r, c]) => `${r},${c}`).sort(), ['0,1', '0,2', '1,0', '1,2', '2,1', '2,2']);
  assert.deepStrictEqual(Topology.buildNeighbors(2, 2, 'square'), [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]].map(l => l.slice().sort()).map((l, i) => Topology.buildNeighbors(2, 2, 'square')[i]));
  assert.strictEqual(Topology.buildNeighbors(3, 3, 'nonsense')[4].length, 8);          // unknown name: the square rules
  const tiny = Topology.get('torus').neighbors(2, 2, 0, 0);                              // a tiny torus never lists a cell twice
  assert.strictEqual(new Set(tiny.map(([r, c]) => r * 2 + c)).size, tiny.length);
});

test('a Game takes its neighbour rules from the topology strategy', () => {
  for (const id of Topology.ids) {
    const g = new Game(6, 7, 3, Math.random, { topology: id });
    assert.deepStrictEqual(g.nb, Topology.buildNeighbors(6, 7, id));
  }
});

// ---- Command ----
test('commands write themselves as [type, row, col] and come back with fromJSON', () => {
  const cmds = [new Commands.RevealCommand(1, 2), new Commands.ChordCommand(3, 4), new Commands.MarkCommand(0, 0, false), new Commands.MarkCommand(0, 1, true), new Commands.ScanCommand(2, 2)];
  assert.deepStrictEqual(cmds.map(c => c.toJSON()), [['r', 1, 2], ['c', 3, 4], ['f', 0, 0], ['q', 0, 1], ['s', 2, 2]]);
  for (const c of cmds) assert.deepStrictEqual(Commands.fromJSON(c.toJSON()).toJSON(), c.toJSON());
  for (const bad of [null, 'r', ['r', 1], ['x', 0, 0], ['rr', 0, 0], [1, 0, 0], ['r', 0, 0, -1], ['r', 0, 0, 'x'], ['r', 0, 0, 1, 2]]) assert.strictEqual(Commands.fromJSON(bad), null);
  assert.deepStrictEqual(Commands.fromJSON(['r', 1, 2, 7]).toJSON(), ['r', 1, 2, 7]);          // with the clock reading
  assert.deepStrictEqual(Commands.fromJSON(['a', 0, 0]).toJSON(), ['a', 0, 0]);
});

test('running a command is the same as calling the Game shortcut, and the game keeps its commands', () => {
  const a = wall({ powerups: true }), b = wall({ powerups: true });
  a.execute(new Commands.MarkCommand(4, 4, true)); b.mark(4, 4, true);
  a.execute(new Commands.ScanCommand(1, 3)); b.scan(1, 3);
  a.execute(new Commands.RevealCommand(0, 0)); b.reveal(0, 0);
  assert.deepStrictEqual(a.cells, b.cells);
  assert.deepStrictEqual(a.moves.map(m => m.toJSON()), [['q', 4, 4], ['s', 1, 3], ['r', 0, 0]]);
  assert.ok(a.moves.every(m => m instanceof Commands.Command));
  assert.strictEqual(a.execute(new Commands.RevealCommand(0, 0)), false);               // not a move: nothing recorded
  assert.strictEqual(a.moves.length, 3);
});

test('a replay runs the recorded commands again; an undone move is not replayed', () => {
  const g = wall();
  g.reveal(0, 0); g.toggleFlag(4, 4); g.undo(); g.reveal(0, 4);
  assert.deepStrictEqual(g.moves.slice(0, g.moveCount).map(m => m.toJSON()), [['r', 0, 0], ['r', 0, 4]]);
  const frames = g.replayFrames();
  assert.strictEqual(frames.length, 3);
  assert.deepStrictEqual(frames.at(-1).cells, g.cells);
});

// ---- Memento ----
test('Memento: undo restores exactly what createMemento saved', () => {
  const g = wall();
  const before = g.createMemento(), expected = JSON.parse(JSON.stringify(before.cells));   // (a memento is used up when restored)
  g.reveal(0, 0);
  assert.notDeepStrictEqual(g.cells, expected);
  g.reveal(0, 4); g.undo(); g.undo();                                                     // undo pops the mementos the moves pushed
  assert.deepStrictEqual(g.cells, expected);
  assert.ok(g.createMemento().cells[0][0] !== g.cells[0][0]);                           // a deep copy, not the same objects
  g.restoreMemento(before);
  assert.deepStrictEqual(g.cells, expected);
});

// ---- Strategy: modes ----
test('every game mode is one small strategy object', () => {
  assert.deepStrictEqual(Modes.ids, ['classic', 'lives', 'undolimit', 'undopenalty', 'timeattack', 'zen', 'twoplayer', 'ai', 'survival', 'puzzle', 'blind', 'shifting']);
  assert.strictEqual(Modes.get('no such mode').id, 'classic');
  const game = new Game(9, 9, 10);
  assert.deepStrictEqual(Modes.list.map(m => m.gameOptions()), [{}, { lives: 3 }, { undoLimit: 3, undoEarnEvery: 20 }, {}, {}, {}, { players: 2 }, { players: 2 }, { lives: 3 }, {}, {}, { shiftEvery: 5 }]);
  assert.deepStrictEqual(Modes.list.filter(m => m.recordsBestTimes).map(m => m.id), ['classic']);
  assert.deepStrictEqual(Modes.list.filter(m => !m.usesClock).map(m => m.id), ['zen']);
  assert.deepStrictEqual(Modes.list.map(m => m.undoPenalty), [0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0]);
  const attack = Modes.get('timeattack');
  assert.strictEqual(attack.timeLimit(game), 122);
  assert.strictEqual(attack.timeText(20, game), '102');
  assert.strictEqual(attack.timeText(500, game), '0');
  assert.deepStrictEqual([attack.clockExpired(121, game), attack.clockExpired(122, game)], [false, true]);
  assert.strictEqual(Modes.get('classic').timeText(20, game), '20');
  assert.strictEqual(Modes.get('zen').timeText(20, game), '–');
  assert.ok(Modes.list.every(m => m.label && m.description.length > 10));
});

test('modes say what the status line and result overlay should show', () => {
  const lives = new Game(5, 5, 5, Math.random, { lives: 3 });
  assert.deepStrictEqual(Modes.get('lives').statusParts(lives), ['Lives: ❤️❤️❤️']);
  assert.match(Modes.get('lives').outcomeText('lost', lives), /Out of lives/);
  const two = new Game(5, 5, 5, Math.random, { players: 2 }); two.scores = [7, 3]; two.current = 1;
  assert.match(Modes.get('twoplayer').outcomeText('won', two), /Player 1 wins, 7 to 3/);
  assert.match(Modes.get('twoplayer').outcomeText('lost', two), /Player 2 hit a mine, so Player 1 wins/);
  assert.strictEqual(Modes.get('twoplayer').resultTitle('won', two), 'Board cleared!');
  assert.strictEqual(Modes.get('classic').resultTitle('won', two), 'You won!');
  assert.match(Modes.get('undolimit').statusParts(new Game(5, 5, 5, Math.random, { undoLimit: 3 }))[0], /^Undos left: 3/);
});

// ---- Options, KeyBindings ----
test('Options: validated, saved, corrupt data ignored', () => {
  const st = fakeStorage(), o = new Options(st);
  assert.deepStrictEqual(o.values, Options.DEFAULTS);
  assert.strictEqual(o.set('theme', 'dark'), true);
  assert.strictEqual(o.set('theme', 'neon'), false); assert.strictEqual(o.set('nope', 1), false);
  assert.strictEqual(o.set('noGuess', 1), true); assert.strictEqual(o.values.noGuess, true);   // checkboxes are coerced
  assert.strictEqual(new Options(st).values.theme, 'dark');
  assert.strictEqual(Options.parse({ mode: 'bogus' }), null); assert.strictEqual(Options.parse([]), null);
  st.setItem('ms-options', '{{{'); assert.deepStrictEqual(new Options(st).values, Options.DEFAULTS);
  assert.deepStrictEqual(Options.DEFS.find(d => d.key === 'mode').choices.map(c => c[0]), Modes.ids);   // the mode list comes from Modes
});

test('KeyBindings: add, remove, rebind, reset, saved; reserved and duplicate keys refused', () => {
  const st = fakeStorage(), k = new KeyBindings(st);
  assert.strictEqual(k.actionFor('F'), 'flag');
  assert.strictEqual(k.add('flag', 'x'), true); assert.deepStrictEqual(k.keys.flag, ['f', 'x']);
  assert.strictEqual(k.add('chord', 'x'), false); assert.strictEqual(k.add('chord', 'Escape'), false); assert.strictEqual(k.add('nope', 'z'), false);
  assert.strictEqual(k.remove('flag', 'f'), true); assert.strictEqual(k.remove('flag', 'x'), false);   // the last key stays
  assert.strictEqual(new KeyBindings(st).actionFor('x'), 'flag');
  assert.strictEqual(k.rebind('flag', 'q'), true); assert.deepStrictEqual(k.keys.flag, ['q']);
  k.reset(); assert.deepStrictEqual(k.keys, KeyBindings.DEFAULT_KEYS);
  assert.strictEqual(KeyBindings.parse({ flag: ['x'], chord: ['x'] }), null);
});

// ---- Stats ----
test('Stats: counters, streaks, 3BV/s, best times (top 5), badges, reset', () => {
  const st = fakeStorage(), s = new Stats(st);
  const ctx = (over = {}) => ({ won: true, level: 'beginner', mode: 'classic', topology: 'square', noGuess: false, undos: 0, hints: 0, time: 20, lives: null,
                                 shieldUsed: false, daily: false, players: 1, bv: 30, timed: true, eligibleForBest: true, ...over });
  const notice = s.record(ctx());
  assert.match(notice, /Unlocked: First win, Speed demon, Clean win/);
  assert.deepStrictEqual(s.counters.last, { bv: 30, time: 20, bvs: 1.5, won: true, stars: 3 });
  assert.strictEqual(s.record(ctx({ time: 25 })), '');                                  // nothing new to unlock
  s.record(ctx({ won: false }));
  assert.deepStrictEqual([s.counters.played, s.counters.won, s.counters.lost, s.counters.streak, s.counters.bestStreak], [3, 2, 1, 0, 2]);
  for (const t of [40, 10, 30, 35, 5]) s.record(ctx({ time: t }));
  assert.deepStrictEqual(s.scores.beginner.map(e => e.t), [5, 10, 20, 25, 30]);
  assert.strictEqual(s.best('beginner'), 5);
  s.record(ctx({ eligibleForBest: false, time: 1 })); assert.strictEqual(s.best('beginner'), 5);
  s.record(ctx({ players: 2 })); assert.strictEqual(s.counters.duels, 1);
  assert.strictEqual(new Stats(st).counters.played, s.counters.played);               // saved
  s.clearScores(); s.clearStats();
  assert.deepStrictEqual([new Stats(st).counters.played, new Stats(st).best('beginner'), Object.keys(new Stats(st).unlocked).length], [0, null, 0]);
});

// ---- Serializer and SaveManager ----
test('Serializer.maxHistory keeps only the newest undo steps', () => {
  const g = wall();
  for (let i = 0; i < 12; i++) g.toggleFlag(i % 5, 4);
  const full = Serializer.serialize(g), capped = Serializer.serialize(g, { maxHistory: 5 });
  assert.strictEqual(full.history.length, 12); assert.strictEqual(capped.history.length, 5);
  assert.deepStrictEqual(capped.history, full.history.slice(-5));
  const h = Serializer.deserialize(capped);
  assert.ok(h); assert.strictEqual(h.history.length, 5);
  for (let i = 0; i < 5; i++) assert.ok(h.undo());
  assert.strictEqual(h.undo(), false);
});

test('SaveManager: the autosave is capped, files and slots keep everything, slots are checked', () => {
  const st = fakeStorage(), sm = new SaveManager(st, Math.random);
  const g = new Game(9, 9, 10, mulberry32(1));
  for (let i = 0; i < 150; i++) g.toggleFlag(i % 9, 8 - Math.floor(i / 9) % 9);
  const info = { level: 'beginner', custom: [9, 9, 10], mode: 'classic', daily: null, elapsed: 7, game: g };
  assert.strictEqual(g.history.length, 150);
  sm.autosave(info);
  assert.strictEqual(JSON.parse(st.data['ms-game']).game.history.length, SaveManager.AUTOSAVE_HISTORY);
  assert.strictEqual(JSON.parse(sm.exportGame(info)).game.history.length, 150);
  assert.strictEqual(sm.saveSlot(2, info), true);
  assert.strictEqual(JSON.parse(st.data['ms-slot-2']).game.history.length, 150);
  assert.match(sm.slotLabels[1], /^Beginner, playing, 7s/);
  for (const n of [0, 4, 1.5, '1']) assert.strictEqual(sm.saveSlot(n, info), false);
  assert.strictEqual(sm.deleteSlot(2), true); assert.strictEqual(sm.slotLabels[1], null);
  const parsed = SaveManager.parse(SaveManager.toData(info, true), Math.random);
  assert.deepStrictEqual([parsed.level, parsed.mode, parsed.elapsed, parsed.game.history.length], ['beginner', 'classic', 7, 150]);
  assert.strictEqual(SaveManager.parse({ ...SaveManager.toData(info, true), level: 'expert' }, Math.random), null);   // board does not match
  assert.strictEqual(SaveManager.parse({ ...SaveManager.toData(info, true), mode: 'bogus' }, Math.random), null);
  assert.strictEqual(SaveManager.parse(null, Math.random), null);
});

test('a long game resumes from the autosave with at most the newest 100 undo steps', () => {
  const st = fakeStorage(), vm = new ViewModel(st, { rng: mulberry32(3) });
  vm.click(4, 4);
  const hidden = vm.game.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).filter(([, , x]) => !x.revealed);
  for (let i = 0; i < 150; i++) { const [r, c] = hidden[i % hidden.length]; vm.flag(r, c); }
  assert.ok(vm.game.history.length > 100);
  assert.ok(JSON.parse(st.getItem('ms-game')).game.history.length <= 100);
  const b = new ViewModel(st);
  assert.strictEqual(b.game.history.length, 100);
  assert.strictEqual(b.game.moves.length, vm.game.moves.length);                        // the replay log is kept whole
  while (b.game.canUndo()) b.undo();
  assert.strictEqual(b.game.history.length, 0);
});

// ---- Observer ----
test('Observer: several listeners, each gets every change and every tick; unsubscribe stops one', () => {
  const vm = new ViewModel(fakeStorage(), { rng: mulberry32(2) });
  const a = [], b = [], ticks = [];
  const stopA = vm.subscribe({ onChange: s => a.push(s.gameId) });
  vm.subscribe({ onChange: s => b.push(s.statusText), onTick: t => ticks.push(t) });
  vm.click(4, 4);
  assert.strictEqual(a.length, 1); assert.strictEqual(b.length, 1);
  vm.tick();
  assert.deepStrictEqual(ticks, ['1']);
  stopA();
  vm.flag(0, 0);
  assert.strictEqual(a.length, 1); assert.strictEqual(b.length, 2);                     // A is gone, B carries on
  vm.subscribe({});                                                                     // a listener with no callbacks is fine
  vm.undo(); vm.tick();
});

test('the constructor hooks are just the first subscriber', () => {
  const seen = [];
  const vm = new ViewModel(fakeStorage(), { onChange: s => seen.push(s.rows), onTick: () => {}, rng: mulberry32(1) });
  assert.strictEqual(vm.listeners.length, 1);
  assert.ok(seen.length >= 1);
});

// ---- Solver: the global mine count and the exhaustive end game ----
test('solver rule 4: hidden cells outside every number are settled by the total mine count', () => {
  const nb = [[1, 2], [0], [0], []];                       // cell 0 is an open "1" touching cells 1 and 2; cell 3 touches nothing
  const revealed = [1, 0, 0, 0], num = [1, 0, 0, 0];
  const none = Solver.deduce(nb, revealed, num, null);
  assert.deepStrictEqual([none.safe[3], none.mine[3]], [0, 0]);                          // without the total: no idea
  const two = Solver.deduce(nb, revealed, num, null, 2);   // 1 mine is in {1,2}, so the other one must be cell 3
  assert.strictEqual(two.mine[3], 1);
  const one = Solver.deduce(nb, revealed, num, null, 1);   // the only mine is in {1,2}: cell 3 is safe
  assert.strictEqual(one.safe[3], 1);
});

test('solver rule 5: overlapping numbers plus the total settle an end game', () => {
  // two open 1s that share a cell b: a-b and b-c. With 1 mine in total it can only be b.
  const nb = [[2, 3], [3, 4], [0], [0, 1], [1]], revealed = [1, 1, 0, 0, 0], num = [1, 1, 0, 0, 0];
  const without = Solver.deduce(nb, revealed, num, null);
  assert.deepStrictEqual([...without.safe], [0, 0, 0, 0, 0]);
  const withTotal = Solver.deduce(nb, revealed, num, null, 1);
  assert.deepStrictEqual([withTotal.safe[2], withTotal.mine[3], withTotal.safe[4]], [1, 1, 1]);
  const contradiction = Solver.deduce(nb, revealed, [3, 3, 0, 0, 0], null, 1);          // numbers that cannot be true: conclude nothing
  assert.deepStrictEqual([...contradiction.safe].concat([...contradiction.mine]), new Array(10).fill(0));
});

test('with the stronger rules a hint is still never a mine (random boards, all shapes, with power-ups)', () => {
  let hints = 0;
  for (const topology of ['square', 'hex', 'torus'])
    for (let seed = 1; seed <= 60; seed++) {
      const g = new Game(9, 9, 12, mulberry32(seed), { topology, powerups: seed % 2 === 0 });
      g.reveal(4, 4);
      if (g.powerups) { const m = g.cells.flat().findIndex(c => c.mine && !c.revealed); g.reveal(Math.floor(m / 9), m % 9); } // the shield hides a mine under a flag
      for (let step = 0; step < 200 && g.status === 'playing'; step++) {
        const h = g.hint();
        if (!h) break;
        assert.ok(!g.cells[h.r][h.c].mine, `${topology} seed ${seed}: hint on a mine`);
        g.reveal(h.r, h.c); hints++;
      }
      assert.notStrictEqual(g.status, 'lost', `${topology} seed ${seed}`);
    }
  assert.ok(hints > 500);
});

test('the stronger solver finishes more boards than single-number logic alone', () => {
  const finish = (seed, useTotal) => {
    const g = new Game(9, 9, 10, mulberry32(seed)); g.reveal(4, 4);
    for (let k = 0; k < 500 && g.status === 'playing'; k++) {
      const flat = g.cells.flat(), rev = flat.map(c => (c.revealed && !c.mine ? 1 : 0)), num = flat.map(c => c.adjacent);
      const i = Solver.hint(g.nb, rev, num, flat.map(() => 0), useTotal ? g.mineCount : undefined);
      if (i < 0) break;
      g.reveal(Math.floor(i / 9), i % 9);
    }
    return g.status === 'won';
  };
  let without = 0, withTotal = 0;
  for (let seed = 1; seed <= 150; seed++) { if (finish(seed, false)) without++; if (finish(seed, true)) withTotal++; }
  assert.ok(withTotal > without, `${withTotal} vs ${without}`);
});
