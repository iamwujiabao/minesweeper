// ViewModel tests for the game modes, assists, power-ups, statistics, achievements, daily/share, replay and options.
const test = require('node:test');
const assert = require('node:assert');
const { ViewModel, OPTION_DEFS, ACHIEVEMENTS } = require('../src/viewmodel.js');
const { mulberry32, parsePlay, dailySeed, dailyId } = require('../src/rng.js');

const fakeStorage = () => { const d = {}; return { getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); } }; };
const make = (opts = {}, st = fakeStorage(), extra = {}) => {
  const vm = new ViewModel(st, { rng: mulberry32(opts.seed ?? 7), ...extra });
  for (const [k, v] of Object.entries(opts.options || {})) vm.setOption(k, v);
  vm.start(opts.level || 'beginner', vm.custom);
  return vm;
};
const cellsOf = vm => vm.game.cells.flatMap((row, r) => row.map((cell, c) => ({ r, c, cell })));
const mineCell = vm => cellsOf(vm).find(x => x.cell.mine && !x.cell.revealed);
// Win by clicking every safe cell (the test "knows" where the mines are). `secs` is put on the clock after the first click.
function clearBoard(vm, secs = 0) {
  const mid = [vm.game.rows >> 1, vm.game.cols >> 1];
  vm.click(...mid);
  vm.elapsed = secs;
  for (const { r, c, cell } of cellsOf(vm)) if (!cell.mine && !cell.revealed && vm.game.status === 'playing') vm.click(r, c);
}
// Lose by clicking a mine after one safe click.
function loseGame(vm) { vm.click(vm.game.rows >> 1, vm.game.cols >> 1); const m = mineCell(vm); vm.click(m.r, m.c); }

// ---- options ----
test('options: defaults, validation, saved, and applied to the next new game only', () => {
  const st = fakeStorage(), vm = make({}, st);
  assert.deepStrictEqual(vm.options, { mode: 'classic', board: 'square', noGuess: false, powerups: false, questionMarks: true, dimNumbers: true, theme: 'auto' });
  assert.strictEqual(vm.setOption('mode', 'banana'), false);
  assert.strictEqual(vm.setOption('nope', 1), false);
  assert.strictEqual(vm.setOption('theme', 'dark'), true);
  vm.setOption('mode', 'lives'); vm.setOption('board', 'hex'); vm.setOption('powerups', true);
  assert.strictEqual(vm.game.lives, null);                       // the current game is unchanged...
  assert.strictEqual(vm.state().optionsPending, true);
  vm.start();
  assert.deepStrictEqual([vm.game.lives, vm.game.topology, vm.game.powerups, vm.state().optionsPending], [3, 'hex', true, false]);
  const again = new ViewModel(st);                               // ...and the options are saved
  assert.deepStrictEqual([again.options.mode, again.options.theme, again.options.board], ['lives', 'dark', 'hex']);
  assert.ok(OPTION_DEFS.every(d => d.key in vm.options));
});

test('options: corrupt saved options are ignored; settings export/import carries them and rejects bad ones', () => {
  const st = fakeStorage(); st.setItem('ms-options', '{"mode":"nope"}');
  assert.strictEqual(new ViewModel(st).options.mode, 'classic');
  const a = make({ options: { theme: 'colorblind', board: 'torus' } }), text = a.exportSettings();
  const b = new ViewModel(fakeStorage());
  assert.deepStrictEqual(b.importFile(text), { ok: true, kind: 'settings' });
  assert.deepStrictEqual([b.options.theme, b.options.board, b.game.topology], ['colorblind', 'torus', 'torus']);
  const before = b.exportSettings();
  for (const o of [{ mode: 'x' }, { board: 5 }, { noGuess: 'yes' }, { surprise: true }, [1], null])
    assert.strictEqual(b.importSettings(JSON.stringify({ version: 1, options: o })).ok, false);
  assert.strictEqual(b.exportSettings(), before);
  assert.deepStrictEqual(b.importFile('{"version":1,"volume":0.3}'), { ok: true, kind: 'settings' }); // old exports without options
});

// ---- marks and the grid ----
test('right-click cycles flag, ?, clear when question marks are on; off just toggles', () => {
  const vm = make();
  vm.flag(0, 0); assert.strictEqual(vm.state().grid[0][0].text, '🚩');
  vm.flag(0, 0); assert.strictEqual(vm.state().grid[0][0].text, '?');
  vm.flag(0, 0); assert.strictEqual(vm.state().grid[0][0].text, '');
  vm.setOption('questionMarks', false);
  vm.flag(0, 0); vm.flag(0, 0); assert.strictEqual(vm.state().grid[0][0].text, '');
});

test('grid: hidden cells are blank, numbers carry n-classes, finished numbers dim, cursor is marked', () => {
  const vm = make();
  vm.click(4, 4);
  const g = vm.state().grid;
  assert.match(g[4][4].cls, /cursor/); assert.match(g[4][4].cls, /open/);
  const number = cellsOf(vm).find(x => x.cell.revealed && x.cell.adjacent > 0);
  assert.match(g[number.r][number.c].cls, new RegExp('n' + number.cell.adjacent));
  assert.doesNotMatch(g[number.r][number.c].cls, /done/);
  for (const [y, x] of vm.game.neighbors(number.r, number.c)) if (vm.game.cells[y][x].mine) vm.game.cells[y][x].flagged = true; // flags all placed
  assert.match(vm.state().grid[number.r][number.c].cls, /done/);
  vm.setOption('dimNumbers', false);
  assert.doesNotMatch(vm.state().grid[number.r][number.c].cls, /done/);
});

test('grid: hex rows are marked, mines show after a loss', () => {
  const vm = make({ options: { board: 'hex' } });
  assert.match(vm.state().grid[1][0].cls, /hex odd/); assert.doesNotMatch(vm.state().grid[0][0].cls, /odd/);
  loseGame(vm);
  assert.strictEqual(vm.state().status, 'lost');
  assert.strictEqual(vm.state().grid.flat().filter(c => c.text === '💣').length, 10);
});

test('hover help: remaining flags for an open number, null otherwise', () => {
  const vm = make(); vm.click(4, 4);
  const n = cellsOf(vm).find(x => x.cell.revealed && x.cell.adjacent > 0);
  const h = vm.neighborhood(n.r, n.c);
  assert.strictEqual(h.number, n.cell.adjacent); assert.strictEqual(h.remaining, n.cell.adjacent);
  assert.strictEqual(h.cells.length, vm.game.neighbors(n.r, n.c).length);
  const hidden = cellsOf(vm).find(x => !x.cell.revealed);
  vm.flag(hidden.r, hidden.c);
  assert.strictEqual(vm.neighborhood(hidden.r, hidden.c), null);
  assert.strictEqual(vm.neighborhood(4, 4), vm.game.cells[4][4].adjacent === 0 ? null : vm.neighborhood(4, 4));
});

// ---- hints ----
test('hint highlights a certainly-safe cell, says so before the first click, and disappears on the next change', () => {
  const vm = make();
  vm.hint(); assert.match(vm.state().statusText, /first click is always safe/);
  vm.click(4, 4);
  vm.hint();
  const h = vm.hintCell;
  assert.ok(h && !vm.game.cells[h.r][h.c].mine);
  assert.match(vm.state().grid[h.r][h.c].cls, /hint/);
  vm.flag(0, 0); assert.strictEqual(vm.hintCell, null);
  assert.doesNotMatch(vm.state().grid[h.r][h.c].cls, /hint/);
});

test('hint with nothing certain says so; a game that used a hint gets no best time', () => {
  const vm = make(); clearBoard(vm, 9); // (win first to have a baseline)
  assert.strictEqual(vm.best(), 9);
  const hinted = make({ seed: 5 }, vm.storage);
  hinted.click(4, 4); hinted.hint(); assert.ok(hinted.game.hintsUsed >= 0);
  hinted.game.hintsUsed = 1;
  for (const { r, c, cell } of cellsOf(hinted)) if (!cell.mine && !cell.revealed && hinted.game.status === 'playing') hinted.click(r, c);
  assert.strictEqual(hinted.state().status, 'won');
  assert.strictEqual(vm.storage.getItem('ms-scores').match(/"t":/g).length, 1); // still only the unhinted win
});

// ---- power-ups ----
test('scanner: arm, click a cell, result shows on the board; needs power-ups and a started game', () => {
  const off = make(); off.toggleScanner(); assert.strictEqual(off.scanMode, false);
  const vm = make({ options: { powerups: true } });
  vm.toggleScanner(); assert.strictEqual(vm.scanMode, false);          // nothing to scan before the first click
  vm.click(4, 4);
  vm.toggleScanner(); assert.strictEqual(vm.scanMode, true);
  assert.match(vm.state().statusText, /click a cell to scan/);
  const target = cellsOf(vm).find(x => !x.cell.revealed);
  vm.click(target.r, target.c);
  assert.strictEqual(vm.scanMode, false);
  assert.strictEqual(vm.game.scanner, 2);
  assert.match(vm.state().grid[target.r][target.c].text, /^🔍\d$/);
  assert.strictEqual(vm.game.cells[target.r][target.c].revealed, false);   // scanning does not reveal
  vm.toggleScanner(); vm.toggleScanner(); assert.strictEqual(vm.scanMode, false); // arm then disarm
  assert.strictEqual(vm.pressKey('s'), true);                               // keyboard
  assert.strictEqual(vm.scanMode, true);
});

test('shield saves one mine hit; the status says what is left', () => {
  const vm = make({ options: { powerups: true } });
  vm.click(4, 4);
  const m = mineCell(vm); vm.click(m.r, m.c);
  assert.strictEqual(vm.state().status, 'playing');
  assert.match(vm.state().statusText, /Shield 0/);
  assert.strictEqual(vm.state().grid[m.r][m.c].text, '🚩');
});

// ---- modes ----
test('lives mode: status shows hearts, three hits end the game', () => {
  const vm = make({ options: { mode: 'lives' } });
  vm.click(4, 4);
  assert.match(vm.state().statusText, /Lives: ❤️❤️❤️/);
  let hits = 0;
  while (vm.state().status === 'playing' && hits < 5) { const m = mineCell(vm); vm.click(m.r, m.c); hits++; }
  assert.strictEqual(hits, 3);
  assert.strictEqual(vm.state().status, 'lost');
  assert.match(vm.state().statusText, /Out of lives/);
});

test('limited-undo mode allows 3 undos; undo-penalty mode adds 10 seconds per undo', () => {
  const lim = make({ options: { mode: 'undolimit' } });
  lim.click(4, 4); lim.flag(0, 0); lim.flag(0, 1); lim.flag(0, 2); lim.flag(0, 3);
  assert.match(lim.state().statusText, /Undos left: 3/);
  lim.undo(); lim.undo(); lim.undo();
  assert.strictEqual(lim.state().canUndo, false);
  lim.undo(); assert.strictEqual(lim.game.undoCount, 3);
  const pen = make({ options: { mode: 'undopenalty' } });
  pen.click(4, 4); pen.tick(); pen.undo();                    // undoing the first move resets the clock, so make two moves
  pen.click(4, 4); pen.flag(0, 0); pen.tick(); pen.undo();
  assert.strictEqual(pen.elapsed, 11);                         // 1 s played + 10 s penalty
});

test('time attack: the clock counts down and the game is lost when it reaches 0; undo is off after', () => {
  const vm = make({ options: { mode: 'timeattack' } });
  assert.strictEqual(vm.timeLimit(), 122);                      // 9x9 cells * 1.5, rounded
  vm.click(4, 4); vm.tick();
  assert.strictEqual(vm.timeText(), '121');
  vm.elapsed = 121; vm.tick();
  assert.strictEqual(vm.state().status, 'timeout');
  assert.match(vm.state().statusText, /Time is up/);
  assert.strictEqual(vm.state().canUndo, false);
  assert.strictEqual(vm.state().grid.flat().filter(c => c.text === '💣').length, 10);
  assert.strictEqual(vm.stats.lost, 1);
  vm.tick(); assert.strictEqual(vm.elapsed, 122);              // the clock stopped
});

test('zen mode: no clock, no best time, but the game counts as won', () => {
  const vm = make({ options: { mode: 'zen' } });
  vm.click(4, 4); vm.tick(); vm.tick();
  assert.deepStrictEqual([vm.elapsed, vm.timeText()], [0, '–']);
  clearBoard(vm, 30);
  assert.strictEqual(vm.state().status, 'won');
  assert.strictEqual(vm.best(), null);
  assert.strictEqual(vm.stats.won, 1); assert.strictEqual(vm.stats.last.bvs, null);
});

test('two players: turn text, scores, winner text, and duels are counted apart from wins and losses', () => {
  const vm = make({ options: { mode: 'twoplayer' } });
  assert.strictEqual(vm.game.players, 2);
  vm.click(4, 4);
  assert.match(vm.state().statusText, /Player 2's turn/);
  const m = mineCell(vm); vm.click(m.r, m.c);
  assert.match(vm.state().statusText, /Player 2 hit a mine, so Player 1 wins/);
  assert.deepStrictEqual([vm.stats.duels, vm.stats.played], [1, 0]);
  assert.ok(vm.unlocked['duellist']);
  const v2 = make({ options: { mode: 'twoplayer' } }); clearBoard(v2);
  assert.match(v2.state().statusText, /Board cleared! Player \d wins|draw/);
});

test('hex and wrap-around boards play like any other', () => {
  for (const board of ['hex', 'torus']) {
    const vm = make({ options: { board } }); clearBoard(vm, 5);
    assert.strictEqual(vm.state().status, 'won', board);
    assert.strictEqual(vm.best(), null);                       // not comparable with the square board
    assert.ok(vm.unlocked[board === 'hex' ? 'hex-explorer' : 'traveller']);
  }
});

test('no-guess option builds a board that hints can finish', () => {
  const vm = make({ options: { noGuess: true, level: 'beginner' } });
  vm.click(4, 4);
  for (let i = 0; i < 200 && vm.state().status === 'playing'; i++) { vm.hint(); const h = vm.hintCell; assert.ok(h); vm.click(h.r, h.c); }
  assert.strictEqual(vm.state().status, 'won');
  assert.strictEqual(vm.shareCode(), null);                     // can't be shared as a link
  assert.match(make({ options: { noGuess: true } }).state().statusText, /No-guess board/);
});

// ---- statistics ----
test('statistics: played, win rate, streaks, 3BV and 3BV/s, counted once per game and saved', () => {
  const st = fakeStorage(), vm = make({}, st);
  clearBoard(vm, 20);
  const bv = vm.game.bbbv();
  assert.deepStrictEqual([vm.stats.played, vm.stats.won, vm.stats.streak], [1, 1, 1]);
  assert.deepStrictEqual(vm.stats.last, { bv, time: 20, bvs: Math.round((bv / 20) * 100) / 100, won: true });
  assert.strictEqual(vm.stats.bestBvs, vm.stats.last.bvs);
  clearBoard(make({ seed: 8 }, st), 10);
  assert.strictEqual(new ViewModel(st).stats.streak, 2);
  const lost = make({ seed: 9 }, st); loseGame(lost);
  assert.deepStrictEqual([lost.stats.played, lost.stats.won, lost.stats.lost, lost.stats.streak, lost.stats.bestStreak], [3, 2, 1, 0, 2]);
  lost.undo(); lost.click(lost.game.rows >> 1, lost.game.cols >> 1); const m2 = mineCell(lost); lost.click(m2.r, m2.c);
  assert.strictEqual(lost.stats.played, 3);                     // undoing and losing again is the same game
  const rows = Object.fromEntries(new ViewModel(st).state().stats);
  assert.deepStrictEqual([rows['Games played'], rows['Won'], rows['Lost'], rows['Win rate'], rows['Best win streak']], [3, 2, 1, '67%', 2]);
  lost.clearStats(); assert.strictEqual(new ViewModel(st).stats.played, 0);
});

test('a loaded finished game or an uploaded file never adds statistics or best times', () => {
  const a = make(); clearBoard(a, 9);
  const text = a.exportGame();
  const b = new ViewModel(fakeStorage());
  b.importFile(text);
  assert.deepStrictEqual([b.stats.played, b.best()], [0, null]);
  b.undo();                                                      // take back the winning click and win again
  const target = cellsOf(b).find(x => !x.cell.mine && !x.cell.revealed);
  b.click(target.r, target.c);
  assert.strictEqual(b.state().status, 'won');
  assert.deepStrictEqual([b.stats.played, b.best()], [0, null]); // an uploaded file is never recorded
  const c = new ViewModel(a.storage); c.loadSlot(1);             // (empty slot: nothing happens)
  assert.strictEqual(c.loadSlot(1), false);
});

test('a game resumed from the autosave still records its result', () => {
  const st = fakeStorage(), a = make({ options: { mode: 'timeattack' } }, st);
  a.click(4, 4); a.tick(); a.save();                          // (the page saves on pagehide, which keeps the exact time)
  const b = new ViewModel(st);
  assert.strictEqual(b.gameMode, 'timeattack');
  assert.strictEqual(b.elapsed, 1);
  b.elapsed = 121; b.tick();
  assert.strictEqual(b.stats.lost, 1);
});

// ---- achievements ----
test('achievements unlock once, announce themselves, and persist', () => {
  const st = fakeStorage(), vm = make({}, st);
  clearBoard(vm, 20);
  assert.ok(vm.unlocked['first-win'] && vm.unlocked['speed-demon'] && vm.unlocked['clean-win']);
  assert.match(vm.state().statusText, /🏆 Unlocked: First win, Speed demon, Clean win/);
  const before = vm.unlocked['first-win'];
  const again = make({ seed: 3 }, st); clearBoard(again, 50);
  assert.strictEqual(again.unlocked['first-win'], before);      // not re-awarded
  assert.doesNotMatch(again.state().statusText, /Unlocked/);
  assert.ok(new ViewModel(st).unlocked['speed-demon']);
  const list = new ViewModel(st).state().achievements;
  assert.strictEqual(list.length, ACHIEVEMENTS.length);
  assert.ok(list.find(a => a.id === 'first-win').unlocked && !list.find(a => a.id === 'zen-master').unlocked);
});

test('achievement rules: undo, hints, lives, streaks, zen, time attack', () => {
  const t = id => ACHIEVEMENTS.find(a => a.id === id).test;
  const base = { won: true, level: 'expert', mode: 'classic', topology: 'square', noGuess: false, undos: 0, hints: 0, time: 100, lives: null, shieldUsed: false, streak: 1, daily: false, players: 1 };
  assert.ok(t('expert-no-undo')(base)); assert.ok(!t('expert-no-undo')({ ...base, undos: 1 })); assert.ok(!t('expert-no-undo')({ ...base, level: 'beginner' }));
  assert.ok(!t('clean-win')({ ...base, hints: 1 }));
  assert.ok(!t('speed-demon')({ ...base, level: 'beginner', time: 31 })); assert.ok(t('speed-demon')({ ...base, level: 'beginner', time: 30 }));
  assert.ok(t('survivor')({ ...base, mode: 'lives', lives: 1 })); assert.ok(!t('survivor')({ ...base, mode: 'lives', lives: 2 }));
  assert.ok(t('on-a-roll')({ ...base, streak: 5 })); assert.ok(!t('on-a-roll')({ ...base, streak: 4 }));
  assert.ok(t('beat-the-clock')({ ...base, mode: 'timeattack' })); assert.ok(t('zen-master')({ ...base, mode: 'zen' }));
  assert.ok(t('daily')({ ...base, daily: true })); assert.ok(!t('first-win')({ ...base, won: false }));
  assert.ok(t('no-guesser')({ ...base, noGuess: true })); assert.ok(!t('no-guesser')({ ...base, noGuess: true, hints: 2 }));
});

// ---- daily challenge and sharing ----
test('daily challenge: same board for everyone on the same date, fixed classic rules, its own badge', () => {
  const at = iso => ({ now: () => new Date(iso) });
  const st = fakeStorage();
  const a = new ViewModel(st, { rng: mulberry32(1), ...at('2026-11-13T01:00:00Z') });
  a.setOption('mode', 'lives'); a.setOption('powerups', true); a.setOption('board', 'hex');
  a.startDaily();
  const b = new ViewModel(fakeStorage(), { rng: mulberry32(99), ...at('2026-11-13T23:59:00Z') }); b.startDaily();
  const c = new ViewModel(fakeStorage(), { rng: mulberry32(99), ...at('2026-11-14T00:00:01Z') }); c.startDaily();
  for (const vm of [a, b, c]) vm.click(8, 8);
  const mines = vm => vm.game.cells.flat().map(x => +x.mine).join('');
  assert.strictEqual(mines(a), mines(b));
  assert.notStrictEqual(mines(a), mines(c));
  assert.deepStrictEqual([a.level, a.gameMode, a.game.topology, a.game.powerups, a.game.lives, a.daily], ['intermediate', 'classic', 'square', false, null, '2026-11-13']);
  assert.match(a.state().statusText, /Daily challenge 2026-11-13/);
  assert.strictEqual(dailySeed(dailyId(new Date('2026-11-13T05:00:00Z'))), dailySeed('2026-11-13'));
  clearBoard(a, 40);
  assert.ok(a.unlocked['daily']);
  assert.strictEqual(new ViewModel(st).daily, null);            // a finished game isn't resumed
});

test('share link: the code reproduces the board, in any shape, and survives an autosave', () => {
  const a = make({ options: { board: 'torus' }, level: 'intermediate' });
  const code = a.shareCode();
  assert.match(code, /^16x16x40-torus-\d+$/);
  const play = parsePlay('?play=' + code);
  assert.deepStrictEqual([play.rows, play.cols, play.mines, play.topology], [16, 16, 40, 'torus']);
  const b = new ViewModel(fakeStorage(), { rng: mulberry32(1234), play });
  assert.deepStrictEqual([b.level, b.game.topology], ['intermediate', 'torus']);
  a.click(8, 8); b.click(8, 8);
  assert.strictEqual(b.game.cells.flat().map(x => +x.mine).join(''), a.game.cells.flat().map(x => +x.mine).join(''));
  const c = new ViewModel(fakeStorage(), { play: parsePlay('?play=7x12x9-hex-42') });
  assert.deepStrictEqual([c.level, c.custom, c.game.topology], ['custom', [7, 12, 9], 'hex']);
  assert.strictEqual(c.shareCode(), '7x12x9-hex-42');
  // a link overrides the game in progress
  const st = fakeStorage(); const d = new ViewModel(st, { rng: mulberry32(2) }); d.click(4, 4);
  assert.strictEqual(new ViewModel(st, { play: parsePlay('?play=9x9x10-square-5') }).game.seed, 5);
});

test('share links are validated: nonsense, out of range or wrong shape give null', () => {
  for (const bad of ['', '?play=', '?play=abc', '?play=9x9x10-cube-5', '?play=3x9x1-square-5', '?play=9x9x80-square-5', '?play=31x9x10-square-5',
                     '?play=9x41x10-square-5', '?play=9x9x10-square-99999999999', '?play=9x9x10-square-5;rm', '?play=9x9x0-square-5', '?x=1'])
    assert.strictEqual(parsePlay(bad), null, bad);
  assert.ok(parsePlay('?play=9x9x10-hex-0'));
});

// ---- replay ----
test('replay: step through, auto-play on the clock, the board is read-only meanwhile, close returns to the game', () => {
  const vm = make();
  assert.strictEqual(vm.state().canReplay, false);
  vm.startReplay(); assert.strictEqual(vm.replay, null);        // nothing to replay yet
  vm.click(4, 4); vm.flag(0, 0); vm.flag(0, 0);
  const m = mineCell(vm); vm.click(m.r, m.c);
  assert.strictEqual(vm.state().canReplay, true);
  const finalGrid = JSON.stringify(vm.state().grid);
  vm.startReplay();
  let s = vm.state();
  assert.deepStrictEqual([s.replay.index, s.replay.total], [0, 4]);
  assert.strictEqual(s.grid.flat().filter(c => /open/.test(c.cls)).length, 0);
  assert.match(s.statusText, /Replay: move 0 of 4/);
  vm.click(0, 1); assert.strictEqual(vm.game.history.length, 4); // read-only: ignored
  assert.strictEqual(vm.state().canUndo, false);
  vm.replayStep(1); assert.ok(vm.state().grid.flat().some(c => /open/.test(c.cls)));
  vm.replayPlay(); vm.tick(); vm.tick(); vm.tick();
  s = vm.state();
  assert.strictEqual(s.replay.index, 4); assert.strictEqual(s.replay.playing, false);
  assert.match(s.statusText, /you hit a mine/);
  assert.strictEqual(JSON.stringify(s.grid.map(r => r.map(c => ({ ...c, cls: c.cls.replace(' cursor', '').replace('cursor ', '').replace('cursor', '') })))),
                     JSON.stringify(JSON.parse(finalGrid).map(r => r.map(c => ({ ...c, cls: c.cls.replace(' cursor', '').replace('cursor ', '').replace('cursor', '') })))));
  vm.replayStep(-9); assert.strictEqual(vm.state().replay.index, 0);
  vm.replayClose(); assert.strictEqual(vm.state().replay, null);
  assert.strictEqual(vm.state().status, 'lost');
});

test('replay of a time-out ends with the clock running out', () => {
  const vm = make({ options: { mode: 'timeattack' } });
  vm.click(4, 4); vm.elapsed = 121; vm.tick();
  vm.startReplay(); vm.replayStep(99);
  assert.match(vm.state().statusText, /time ran out/);
});

// ---- saving keeps the mode ----
test('saved games and slots keep mode and daily; unknown modes are rejected; old files default to classic', () => {
  const a = make({ options: { mode: 'lives' } }); a.click(4, 4);
  const b = new ViewModel(fakeStorage()); assert.strictEqual(b.importFile(a.exportGame()).ok, true);
  assert.strictEqual(b.gameMode, 'lives'); assert.strictEqual(b.game.lives, 3);
  const data = JSON.parse(a.exportGame());
  const bad = { ...data, mode: 'bogus' }; assert.strictEqual(b.importFile(JSON.stringify(bad)).ok, false);
  assert.strictEqual(b.importFile(JSON.stringify({ ...data, daily: '13/11' })).ok, false);
  delete data.mode; assert.strictEqual(b.importFile(JSON.stringify(data)).ok, true); assert.strictEqual(b.gameMode, 'classic');
  const slot = make({ options: { mode: 'zen' } }); slot.click(4, 4); slot.saveSlot(1); slot.start(); slot.options.mode; assert.ok(slot.loadSlot(1));
  assert.strictEqual(slot.gameMode, 'zen');
});
