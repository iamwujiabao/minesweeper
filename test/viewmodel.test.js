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
