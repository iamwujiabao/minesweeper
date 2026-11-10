const test = require('node:test');
const assert = require('node:assert');
const { ViewModel, clampCustom } = require('../src/viewmodel.js');

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
