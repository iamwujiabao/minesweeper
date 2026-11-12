const test = require('node:test');
const assert = require('node:assert');
const { ViewModel, clampCustom, cellSize } = require('../src/viewmodel.js');

const fakeStorage = () => { const d = {}; return { getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); } }; };
// Beginner board with mines in column 4 plus (0,8): two clicks win it.
const rigged = vm => { vm.start('beginner'); vm.game.setMines([...Array(9).keys()].map(r => [r, 4]).concat([[0, 8]])); };
const win = (vm, secs) => { rigged(vm); vm.click(8, 0); vm.elapsed = secs; vm.click(8, 8); };

test('custom sizes are clamped', () => {
  assert.deepStrictEqual(clampCustom([2, 99, 9999]), [5, 40, 191]);
  assert.deepStrictEqual(clampCustom(['abc', 10, 0]), [5, 10, 1]);
  const vm = new ViewModel(fakeStorage());
  vm.start('custom', [6, 7, 5]);
  assert.strictEqual(vm.state().rows, 6);
  assert.strictEqual(vm.state().cols, 7);
});

test('difficulty presets', () => {
  const vm = new ViewModel(fakeStorage());
  vm.start('expert');
  assert.strictEqual(vm.state().cells.length * vm.state().cells[0].length, 480);
  assert.strictEqual(vm.state().minesLeft, 99);
});

test('timer ticks only after a move and resets when the first move is undone', () => {
  const vm = new ViewModel(fakeStorage());
  vm.tick(); assert.strictEqual(vm.elapsed, 0);
  vm.click(4, 4); vm.tick(); vm.tick(); assert.strictEqual(vm.elapsed, 2);
  vm.undo(); assert.strictEqual(vm.elapsed, 0);
});

test('best time saved on win, only improved, not for custom', () => {
  const st = fakeStorage(), vm = new ViewModel(st);
  win(vm, 9); assert.strictEqual(vm.state().status, 'won'); assert.strictEqual(vm.best(), 9);
  win(vm, 12); assert.strictEqual(vm.best(), 9);
  win(vm, 4); assert.strictEqual(vm.best(), 4);
  vm.start('custom', [5, 5, 1]);
  vm.click(0, 0); vm.elapsed = 1; vm.game.status = 'won'; vm._changed();
  assert.strictEqual(vm.best(), null);
});

test('clicking a revealed cell chords, a hidden cell reveals', () => {
  const vm = new ViewModel(fakeStorage());
  rigged(vm); vm.click(8, 0);
  let chorded = 0; vm.game.chord = () => chorded++;
  vm.click(0, 3); // revealed number
  assert.strictEqual(chorded, 1);
  vm.click(0, 5); // hidden: reveal, no chord
  assert.strictEqual(chorded, 1);
  assert.ok(vm.game.cells[0][5].revealed);
});

test('keyboard cursor moves, stays on the board, and clicking moves it', () => {
  const vm = new ViewModel(fakeStorage());
  vm.move(-1, -1); assert.deepStrictEqual(vm.state().cursor, { r: 0, c: 0 });
  vm.move(1, 0); vm.move(0, 1); assert.deepStrictEqual(vm.state().cursor, { r: 1, c: 1 });
  vm.move(99, 99); assert.deepStrictEqual(vm.state().cursor, { r: 8, c: 8 });
  vm.flag(2, 3); assert.deepStrictEqual(vm.state().cursor, { r: 2, c: 3 });
});

test('cellSize shrinks for big boards and stays within 16..40', () => {
  assert.strictEqual(cellSize(9, 9, 1000, 800), 40);
  assert.strictEqual(cellSize(30, 40, 1000, 800), 23); // width-limited: (1000-78)/40
  assert.strictEqual(cellSize(30, 40, 200, 200), 16);
});

test('mute and volume are saved and reloaded; volume is clamped', () => {
  const st = fakeStorage(), a = new ViewModel(st);
  assert.strictEqual(a.state().muted, false); assert.strictEqual(a.state().volume, 0.5);
  a.setMuted(true); a.setVolume(7);
  assert.strictEqual(a.volume, 1);
  const b = new ViewModel(st); // "next visit"
  assert.strictEqual(b.state().muted, true); assert.strictEqual(b.state().volume, 1);
  b.setVolume(0); assert.strictEqual(new ViewModel(st).state().volume, 0); // 0 is kept, not defaulted
});

test('chord command only chords: on a hidden cell it does nothing', () => {
  const vm = new ViewModel(fakeStorage());
  vm.click(4, 4); const open = vm.game.cells.flat().filter(c => c.revealed).length;
  vm.chord(0, 0); // hidden or zero: no state change beyond the cursor
  assert.strictEqual(vm.game.cells.flat().filter(c => c.revealed).length, open);
  assert.deepStrictEqual(vm.state().cursor, { r: 0, c: 0 });
});

test('difficulty and custom size are saved and restored', () => {
  const st = fakeStorage(), a = new ViewModel(st);
  assert.strictEqual(a.level, 'beginner');
  a.start('custom', [12, 14, 20]);
  const b = new ViewModel(st); // next visit
  assert.strictEqual(b.level, 'custom');
  assert.deepStrictEqual([b.state().rows, b.state().cols, b.state().minesLeft], [12, 14, 20]);
  a.start('expert');
  const c = new ViewModel(st);
  assert.strictEqual(c.level, 'expert');
  assert.deepStrictEqual(c.custom, [12, 14, 20]); // custom size remembered while on another level
});

test('corrupt saved settings fall back to defaults', () => {
  const st = fakeStorage();
  st.setItem('ms-level', 'nonsense'); st.setItem('ms-custom', '{oops'); st.setItem('ms-keys', 'null');
  const vm = new ViewModel(st);
  assert.strictEqual(vm.level, 'beginner');
  assert.deepStrictEqual(vm.custom, [9, 9, 10]);
  assert.strictEqual(vm.actionFor('f'), 'flag');
  st.setItem('ms-keys', JSON.stringify({ flag: ['x'], chord: ['x'] })); // duplicate keys
  assert.strictEqual(new ViewModel(st).actionFor('x'), undefined);
});

test('key map: defaults, rebinding, conflicts, persistence, reset', () => {
  const st = fakeStorage(), vm = new ViewModel(st);
  assert.strictEqual(vm.actionFor('F'), 'flag');       // case-insensitive letters
  assert.strictEqual(vm.actionFor(' '), 'reveal');
  assert.strictEqual(vm.rebind('flag', 'x'), true);
  assert.strictEqual(vm.actionFor('x'), 'flag');
  assert.strictEqual(vm.actionFor('f'), undefined);    // old key freed
  assert.strictEqual(vm.rebind('chord', 'x'), false);  // already used
  assert.strictEqual(vm.rebind('chord', 'Escape'), false); // reserved
  assert.strictEqual(vm.rebind('bogus', 'z'), false);
  assert.strictEqual(new ViewModel(st).actionFor('x'), 'flag'); // saved
  vm.resetKeys();
  assert.strictEqual(new ViewModel(st).actionFor('f'), 'flag');
});

test('new game increments gameId; undo does not', () => {
  const vm = new ViewModel(fakeStorage()), id = vm.state().gameId;
  vm.click(4, 4); vm.undo();
  assert.strictEqual(vm.state().gameId, id);
  vm.start();
  assert.strictEqual(vm.state().gameId, id + 1);
});

test('pressKey runs actions at the cursor; unknown and modifier keys are not used', () => {
  const vm = new ViewModel(fakeStorage());
  assert.strictEqual(vm.pressKey('ArrowRight'), true);
  assert.deepStrictEqual(vm.state().cursor, { r: 0, c: 1 });
  assert.strictEqual(vm.pressKey('f'), true);
  assert.strictEqual(vm.game.cells[0][1].flagged, true);
  assert.strictEqual(vm.pressKey('u'), true);
  assert.strictEqual(vm.game.cells[0][1].flagged, false);
  assert.strictEqual(vm.pressKey('Enter'), true);
  assert.strictEqual(vm.game.canUndo(), true);
  assert.strictEqual(vm.pressKey('q'), false);
  assert.strictEqual(vm.pressKey('Shift'), false);
  vm.pressKey('n'); assert.strictEqual(vm.game.canUndo(), false); // new game
});

test('multiple keys per action: add via rebinding mode, remove, last key protected, saved', () => {
  const st = fakeStorage(), vm = new ViewModel(st);
  vm.startRebind('flag');
  assert.strictEqual(vm.state().rebinding, 'flag');
  assert.strictEqual(vm.pressKey('x'), true);            // becomes an extra flag key
  assert.deepStrictEqual(vm.keys.flag, ['f', 'x']);
  assert.strictEqual(vm.state().rebinding, null);
  assert.strictEqual(vm.actionFor('f'), 'flag'); assert.strictEqual(vm.actionFor('x'), 'flag');

  vm.startRebind('chord');
  vm.pressKey('x');                                        // taken by flag: keep waiting, with a message
  assert.strictEqual(vm.state().rebinding, 'chord');
  assert.match(vm.state().keyMessage, /already used/);
  vm.pressKey('Escape');                                   // cancel
  assert.strictEqual(vm.state().rebinding, null);

  assert.strictEqual(vm.removeKey('flag', 'f'), true);
  assert.strictEqual(vm.removeKey('flag', 'x'), false);    // it is now the only key
  assert.strictEqual(vm.removeKey('flag', 'zzz'), false);
  assert.deepStrictEqual(new ViewModel(st).keys.flag, ['x']);
  assert.strictEqual(vm.addKey('flag', 'Tab'), false);     // reserved
});

test('export then import restores settings in a fresh profile', () => {
  const a = new ViewModel(fakeStorage());
  a.start('custom', [8, 12, 15]); a.addKey('flag', 'x'); a.setMuted(true); a.setVolume(0.2);
  const text = a.exportSettings();
  const st = fakeStorage(), b = new ViewModel(st);
  assert.deepStrictEqual(b.importSettings(text), { ok: true });
  assert.deepStrictEqual([b.level, b.custom, b.keys.flag, b.muted, b.volume], ['custom', [8, 12, 15], ['f', 'x'], true, 0.2]);
  assert.strictEqual(b.state().cols, 12);
  const c = new ViewModel(st); // and it was saved
  assert.deepStrictEqual([c.level, c.keys.flag, c.muted, c.volume], ['custom', ['f', 'x'], true, 0.2]);
});

test('invalid imports are rejected and change nothing', () => {
  const vm = new ViewModel(fakeStorage());
  const before = vm.exportSettings();
  const bad = [
    'nope', '[]', '{"version":2}', '{"version":1,"level":"constructor"}', '{"version":1,"custom":[1,2]}',
    '{"version":1,"volume":7}', '{"version":1,"muted":"yes"}',
    '{"version":1,"keys":{"flag":["x"],"chord":["x"]}}',  // duplicate key
    '{"version":1,"keys":{"flag":[]}}',                      // empty list
    '{"version":1,"keys":{"flag":["Escape"]}}',              // reserved
    '{"version":1,"muted":true,"volume":0.1,"keys":{"flag":[]}}', // one bad field spoils the rest
  ];
  for (const text of bad) {
    const r = vm.importSettings(text);
    assert.strictEqual(r.ok, false, text);
    assert.ok(r.error, text);
  }
  assert.strictEqual(vm.exportSettings(), before);
});

test('a saved level like "constructor" falls back to beginner', () => {
  const st = fakeStorage(); st.setItem('ms-level', 'constructor');
  assert.strictEqual(new ViewModel(st).level, 'beginner');
});

// ---- save / load a game in progress ----
const { mulberry32, rngFromSearch } = require('../src/rng.js');
const inProgress = st => { // a game with a click, a flag on a hidden cell (a mine), and 2 seconds on the clock
  const vm = new ViewModel(st, { rng: mulberry32(7) });
  vm.click(4, 4);
  const i = vm.game.cells.flat().findIndex(c => c.mine);
  vm.flagged = [Math.floor(i / 9), i % 9];
  vm.flag(...vm.flagged); vm.tick(); vm.tick();
  return vm;
};

test('a game in progress is autosaved and resumed, including time and undo history', () => {
  const st = fakeStorage(), a = inProgress(st);
  const open = a.game.cells.flat().filter(c => c.revealed).length;
  const b = new ViewModel(st);                                  // "reload the page"
  assert.strictEqual(b.game.cells.flat().filter(c => c.revealed).length, open);
  assert.strictEqual(b.game.cells[a.flagged[0]][a.flagged[1]].flagged, true);
  assert.strictEqual(b.elapsed, 0);                             // ticks are saved with the next change (or save())
  a.save(); assert.strictEqual(new ViewModel(st).elapsed, 2);   // save() (called on pagehide) keeps the time
  b.undo(); b.undo();
  assert.strictEqual(b.game.canUndo(), false);                  // history came back too
});

test('finished, untouched and corrupt autosaves start a fresh game', () => {
  const st = fakeStorage(); new ViewModel(st);                  // untouched game was saved
  assert.strictEqual(new ViewModel(st).game.canUndo(), false);
  const lost = new ViewModel(fakeStorage(), { rng: mulberry32(1) }); lost.click(4, 4);
  const mine = lost.game.cells.flat().findIndex(c => c.mine);
  lost.click(Math.floor(mine / 9), mine % 9);
  assert.strictEqual(lost.game.status, 'lost');
  assert.strictEqual(new ViewModel(lost.storage).game.status, 'playing');
  const bad = fakeStorage(); bad.setItem('ms-game', '{"version":1,"type":"game"'); 
  assert.strictEqual(new ViewModel(bad).game.canUndo(), false);
  bad.setItem('ms-game', JSON.stringify({ game: { status: 'playing', history: [1] } }));
  assert.strictEqual(new ViewModel(bad).game.canUndo(), false);
});

test('exportGame then importFile restores the game, difficulty and time in another profile', () => {
  const a = inProgress(fakeStorage()); a.start('custom', [6, 7, 5]); a.click(2, 2); a.elapsed = 41;
  const b = new ViewModel(fakeStorage());
  assert.deepStrictEqual(b.importFile(a.exportGame()), { ok: true, kind: 'game' });
  assert.deepStrictEqual([b.level, b.custom, b.elapsed, b.game.rows, b.game.cols], ['custom', [6, 7, 5], 41, 6, 7]);
  assert.strictEqual(JSON.stringify(b.game.serialize()), JSON.stringify(a.game.serialize()));
  b.undo(); assert.strictEqual(b.game.canUndo(), false);
});

test('importFile also accepts settings files, old (untyped) and new', () => {
  const vm = new ViewModel(fakeStorage());
  assert.deepStrictEqual(vm.importFile('{"version":1,"volume":0.3}'), { ok: true, kind: 'settings' });
  assert.deepStrictEqual(vm.importFile(vm.exportSettings()), { ok: true, kind: 'settings' });
  assert.strictEqual(vm.importFile('{"version":1,"type":"banana"}').ok, false);
  assert.strictEqual(vm.importFile('nope').ok, false);
});

test('invalid game files are rejected and change nothing', () => {
  const vm = inProgress(fakeStorage()), before = vm.exportGame();
  const good = JSON.parse(before);
  const bad = [
    d => { d.game.cells = 'x'; }, d => { d.level = 'constructor'; }, d => { d.elapsed = -1; }, d => { d.elapsed = 1.5; },
    d => { d.custom = [1, 2]; }, d => { d.version = 2; },
    d => { d.level = 'expert'; },                                  // board is 9x9 but claims expert
    d => { d.game.history = 'no'; },
  ];
  for (const f of bad) {
    const d = JSON.parse(before); f(d);
    assert.strictEqual(vm.importFile(JSON.stringify(d)).ok, false);
  }
  assert.strictEqual(vm.exportGame(), before);
  assert.ok(good.game);
});

test('a loaded won game does not record a best time', () => {
  const a = new ViewModel(fakeStorage()); win(a, 9);
  const data = JSON.parse(a.exportGame()); data.elapsed = 1;       // a crafted file claiming a 1 second win
  const st = fakeStorage(), b = new ViewModel(st);
  assert.strictEqual(b.importFile(JSON.stringify(data)).ok, true);
  assert.strictEqual(b.state().status, 'won');
  assert.strictEqual(b.best(), null);
});

test('seeded rng gives reproducible boards', () => {
  const seq = r => [r(), r(), r()];
  assert.deepStrictEqual(seq(mulberry32(5)), seq(mulberry32(5)));
  assert.notDeepStrictEqual(seq(mulberry32(5)), seq(mulberry32(6)));
  assert.strictEqual(rngFromSearch('?x=1'), Math.random);
  assert.strictEqual(rngFromSearch('?seed=abc'), Math.random);
  const mines = seed => { const vm = new ViewModel(fakeStorage(), { rng: rngFromSearch('?seed=' + seed) }); vm.click(4, 4); return vm.game.cells.flat().map(c => +c.mine).join(''); };
  assert.strictEqual(mines(3), mines(3));
  assert.notStrictEqual(mines(3), mines(4));
});

// ---- saved-game slots ----
test('slots save, load and delete independently, keeping undo history', () => {
  const st = fakeStorage(), vm = inProgress(st);
  const open = vm.game.cells.flat().filter(c => c.revealed).length;
  assert.deepStrictEqual(vm.state().slots.map(s => s.label), [null, null, null]);
  assert.strictEqual(vm.saveSlot(2), true);
  assert.match(vm.state().slots[1].label, /^Beginner, playing, 2s/);
  assert.strictEqual(vm.state().slots[0].label, null);

  vm.start('expert');                                   // play something else
  assert.strictEqual(vm.loadSlot(2), true);
  assert.strictEqual(vm.level, 'beginner');
  assert.strictEqual(vm.game.cells.flat().filter(c => c.revealed).length, open);
  assert.strictEqual(vm.elapsed, 2);
  vm.undo(); vm.undo(); assert.strictEqual(vm.game.canUndo(), false);

  vm.saveSlot(1);                                       // slots do not overwrite each other
  assert.ok(vm.state().slots[0].label && vm.state().slots[1].label);
  assert.ok(new ViewModel(st).state().slots[1].label);  // and survive a reload
  assert.strictEqual(vm.deleteSlot(2), true);
  assert.strictEqual(vm.loadSlot(2), false);
  assert.strictEqual(vm.state().slots[1].label, null);
  assert.ok(vm.state().slots[0].label);
});

test('slot numbers are checked; empty and corrupt slots do not load', () => {
  const st = fakeStorage(), vm = new ViewModel(st);
  for (const n of [0, 4, -1, 1.5, '1', NaN, undefined]) {
    assert.strictEqual(vm.saveSlot(n), false); assert.strictEqual(vm.loadSlot(n), false); assert.strictEqual(vm.deleteSlot(n), false);
  }
  assert.strictEqual(vm.loadSlot(1), false);            // empty
  st.setItem('ms-slot-1', '{"version":1,"type":"game","level":"beginner","custom":[9,9,10],"elapsed":0,"game":{"rows":9}}');
  assert.strictEqual(vm.loadSlot(1), false);            // corrupt game
  assert.strictEqual(new ViewModel(st).state().slots[0].label, null);
  st.setItem('ms-slot-1', 'not json');
  assert.strictEqual(vm.loadSlot(1), false);
});

test('loading a finished game from a slot adds no best time', () => {
  const vm = new ViewModel(fakeStorage()); win(vm, 9);
  vm.saveSlot(1); vm.clearScores();
  vm.loadSlot(1);
  assert.strictEqual(vm.state().status, 'won');
  assert.strictEqual(vm.best(), null);
});

// ---- best-times table ----
test('best times keep the 5 fastest per difficulty, sorted, and survive reload', () => {
  const st = fakeStorage(), vm = new ViewModel(st);
  for (const t of [30, 12, 20, 25, 9, 40, 15]) win(vm, t);
  assert.deepStrictEqual(vm.state().scores.beginner.map(e => e.t), [9, 12, 15, 20, 25]);
  assert.strictEqual(vm.best(), 9);
  assert.deepStrictEqual(vm.state().scores.expert, []);
  assert.strictEqual(vm.state().scoreRows, 5);
  assert.deepStrictEqual(new ViewModel(st).state().scores.beginner.map(e => e.t), [9, 12, 15, 20, 25]);
});

test('undo then redo of the winning move does not add a second time', () => {
  const vm = new ViewModel(fakeStorage()); win(vm, 9);
  vm.undo(); vm.redo();
  assert.strictEqual(vm.state().status, 'won');
  assert.strictEqual(vm.state().scores.beginner.length, 1);
});

test('a single best time saved by an older version becomes the first table entry; clear removes it for good', () => {
  const st = fakeStorage(); st.setItem('ms-best-beginner', 33);
  const vm = new ViewModel(st);
  assert.deepStrictEqual(vm.state().scores.beginner, [{ t: 33, date: '' }]);
  win(vm, 50);
  assert.deepStrictEqual(vm.state().scores.beginner.map(e => e.t), [33, 50]);
  vm.clearScores();
  assert.deepStrictEqual(vm.state().scores.beginner, []);
  assert.strictEqual(vm.best(), null);
  assert.strictEqual(new ViewModel(st).best(), null);   // the old value does not come back
});

test('corrupt score data is ignored; custom boards never record', () => {
  const st = fakeStorage(); st.setItem('ms-scores', JSON.stringify({ beginner: [{ t: -5 }, { t: 'x' }, null, { t: 8, at: 'nope' }], expert: 'no' }));
  const vm = new ViewModel(st);
  assert.deepStrictEqual(vm.state().scores.beginner, [{ t: 8, date: '' }]);
  assert.deepStrictEqual(vm.state().scores.expert, []);
  st.setItem('ms-scores', '{bad');
  assert.deepStrictEqual(new ViewModel(st).state().scores.beginner, []);
  vm.start('custom', [5, 5, 1]); vm.click(0, 0); vm.elapsed = 5; vm.game.status = 'won'; vm._changed(true);
  assert.strictEqual(vm.best(), null);
});
