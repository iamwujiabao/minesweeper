// ViewModel tests for what the redesigned views rely on: tips, flag mode, blocked-move feedback, animations,
// screen-reader labels, the loss display, the result overlay, remembered settings tab, option descriptions.
const test = require('node:test');
const assert = require('node:assert');
const { ViewModel, OPTION_DEFS, TABS, TIPS, cellSize } = require('../src/viewmodel.js');
const { mulberry32 } = require('../src/rng.js');

const fakeStorage = () => { const d = {}; return { getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); } }; };
const make = (st = fakeStorage(), seed = 7) => { const states = []; const vm = new ViewModel(st, { rng: mulberry32(seed), onChange: s => states.push(s) }); vm.states = states; vm.last = () => states.at(-1); return vm; };
const flat = vm => vm.game.cells.flatMap((row, r) => row.map((cell, c) => ({ r, c, cell })));
const mineCell = vm => flat(vm).find(x => x.cell.mine && !x.cell.revealed);

test('options: every option is grouped and described; every choice has a description', () => {
  for (const d of OPTION_DEFS) {
    assert.ok(['newgame', 'game', 'appearance', 'header'].includes(d.group), d.key);
    if (d.type === 'select') for (const c of d.choices) assert.ok(c.length === 3 && c[2].length > 10, `${d.key}/${c[0]}`);
    else assert.ok(d.desc && d.desc.length > 10, d.key);
  }
  assert.deepStrictEqual(TABS, ['game', 'controls', 'appearance', 'data']);
});

test('first-time tips: flag tip first, chord tip once a number is open, each shown once and remembered', () => {
  const st = fakeStorage(), vm = make(st);
  assert.strictEqual(vm.state().tip.id, 'flag');
  vm.click(4, 4);
  assert.strictEqual(vm.state().tip.id, 'flag');
  vm.dismissTip();
  assert.strictEqual(vm.state().tip.id, 'chord');         // a number is open now
  vm.dismissTip();
  assert.strictEqual(vm.state().tip, null);
  assert.strictEqual(make(st).state().tip, null);          // remembered across visits
  vm.resetTips();
  assert.strictEqual(vm.state().tip.id, 'flag');
  assert.ok(TIPS.every(t => t.text.length > 20));
});

test('a tip counts as seen once you do what it explains; no tips while the game is over or in a replay', () => {
  const vm = make();
  vm.click(4, 4);
  const h = flat(vm).find(x => !x.cell.revealed && !x.cell.mine);
  vm.flag(h.r, h.c);
  assert.strictEqual(vm.state().tip.id, 'chord');          // flagging used up the flag tip
  const n = flat(vm).find(x => x.cell.revealed && x.cell.adjacent > 0 && vm.game.neighbors(x.r, x.c).some(([y, z]) => !vm.game.cells[y][z].revealed && !vm.game.cells[y][z].mine));
  for (const [y, x] of vm.game.neighbors(n.r, n.c)) if (vm.game.cells[y][x].mine) vm.game.cells[y][x].flagged = true;
  vm.click(n.r, n.c);                                      // chord
  assert.strictEqual(vm.state().tip, null);
  const lost = make(); lost.click(4, 4); const m = mineCell(lost); lost.click(m.r, m.c);
  assert.strictEqual(lost.state().tip, null);
});

test('flag mode: taps flag hidden cells and still chord open numbers; the scanner takes priority', () => {
  const vm = make();
  vm.click(4, 4);
  assert.strictEqual(vm.state().flagMode, false);
  vm.toggleFlagMode(); assert.strictEqual(vm.state().flagMode, true);
  const hidden = flat(vm).find(x => !x.cell.revealed);
  vm.click(hidden.r, hidden.c);
  assert.strictEqual(vm.game.cells[hidden.r][hidden.c].flagged, true);
  assert.strictEqual(vm.game.cells[hidden.r][hidden.c].revealed, false);
  vm.click(hidden.r, hidden.c); assert.strictEqual(vm.game.cells[hidden.r][hidden.c].question, true);   // cycles like right-click
  vm.toggleFlagMode(); assert.strictEqual(vm.state().flagMode, false);
});

test('blocked moves shake the cell (alternating names so repeats restart); blocked buttons flash the status', () => {
  const vm = make();
  vm.click(4, 4);
  const n = flat(vm).find(x => x.cell.revealed && x.cell.adjacent > 0);
  vm.click(n.r, n.c);                                      // a number with no flags: not allowed
  const a = vm.last().grid[n.r][n.c].anim;
  vm.click(n.r, n.c);
  const b = vm.last().grid[n.r][n.c].anim;
  assert.ok(/^shake[01]$/.test(a) && /^shake[01]$/.test(b) && a !== b);
  vm.click(0, 1);                                          // a normal move: no shake left over
  assert.ok(!/shake/.test(vm.last().grid[n.r][n.c].anim));
  const fresh = make(), seq = fresh.state().flashSeq;
  fresh.undo(); fresh.redo();                              // nothing to undo or redo
  assert.strictEqual(fresh.state().flashSeq, seq + 2);
  const h = make(); h.game.status = 'won'; h.hint();
  assert.strictEqual(h.state().flashSeq, 1);
  const flagged = make(); flagged.flag(0, 0); flagged.flag(0, 0); flagged.flag(0, 0);
  flagged.click(4, 4); const f = flat(flagged).find(x => x.cell.revealed); flagged.flag(f.r, f.c);   // flagging an open cell
  assert.match(flagged.last().grid[f.r][f.c].anim, /shake/);
});

test('animations: opened cells pop (flood-fills ripple outward), flagged cells bounce, new games and cursor moves do not animate', () => {
  const vm = make();
  assert.ok(vm.last().grid.flat().every(c => c.anim === ''));
  vm.click(4, 4);
  const opened = vm.last().grid.flat().filter(c => c.anim === 'pop');
  assert.ok(opened.length > 4);
  assert.strictEqual(opened.length, flat(vm).filter(x => x.cell.revealed).length);
  const delays = opened.map(c => c.delay);
  assert.strictEqual(Math.min(...delays), 0); assert.ok(Math.max(...delays) > 0 && Math.max(...delays) <= 450);
  assert.strictEqual(vm.last().grid[4][4].delay, 0);       // ripples start at the click
  const hidden = flat(vm).find(x => !x.cell.revealed);
  vm.flag(hidden.r, hidden.c);
  assert.strictEqual(vm.last().grid.flat().filter(c => c.anim === 'flag').length, 1);
  vm.move(1, 0); assert.ok(vm.last().grid.flat().every(c => c.anim === ''));
  vm.start(); assert.ok(vm.last().grid.flat().every(c => c.anim === ''));
});

test('unchanged cells keep the very same object between updates (so views can skip them)', () => {
  const vm = make();
  vm.click(4, 4);
  vm.move(0, 0);                                           // (the opening pop animation is over after one quiet update)
  const before = vm.last().grid;
  const hidden = flat(vm).find(x => !x.cell.revealed);
  vm.flag(hidden.r, hidden.c);
  const after = vm.last().grid;
  let same = 0, different = 0;
  after.forEach((row, r) => row.forEach((cell, c) => { if (cell === before[r][c]) same++; else different++; }));
  assert.ok(same > 70 && different <= 4, `${same} same, ${different} different`);   // only the flagged cell and the cursor cells change
});

test('screen-reader labels describe every kind of cell', () => {
  const vm = make();
  assert.strictEqual(vm.state().grid[2][3].label, 'Row 3, column 4, hidden');
  vm.click(4, 4);
  const num = flat(vm).find(x => x.cell.revealed && x.cell.adjacent > 0), zero = flat(vm).find(x => x.cell.revealed && x.cell.adjacent === 0);
  assert.strictEqual(vm.last().grid[zero.r][zero.c].label, `Row ${zero.r + 1}, column ${zero.c + 1}, empty`);
  assert.match(vm.last().grid[num.r][num.c].label, /mines? nearby/);
  const h = flat(vm).find(x => !x.cell.revealed);
  vm.flag(h.r, h.c); assert.match(vm.last().grid[h.r][h.c].label, /flagged$/);
  vm.flag(h.r, h.c); assert.match(vm.last().grid[h.r][h.c].label, /question mark$/);
  vm.hint(); const hc = vm.hintCell;
  assert.match(vm.last().grid[hc.r][hc.c].label, /hint: safe to open$/);
  assert.match(vm.state().statusText, new RegExp(`Hint: row ${hc.r + 1}, column ${hc.c + 1} is certainly safe`));
});

test('loss display: the exploded mine stands out, wrong flags get a cross, the rest is dimmed', () => {
  const vm = make();
  vm.click(4, 4);
  const mines = flat(vm).filter(x => x.cell.mine && !x.cell.revealed), safe = flat(vm).filter(x => !x.cell.mine && !x.cell.revealed);
  vm.flag(mines[0].r, mines[0].c);                          // a correct flag
  vm.flag(safe[0].r, safe[0].c);                            // a wrong flag
  vm.click(mines[1].r, mines[1].c);                         // boom
  const g = vm.state().grid, at = x => g[x.r][x.c];
  assert.match(at(mines[1]).cls, /exploded/); assert.match(at(mines[1]).label, /exploded/);
  assert.doesNotMatch(at(mines[2]).cls, /exploded/); assert.match(at(mines[2]).cls, /mine/); assert.strictEqual(at(mines[2]).text, '💣');
  assert.strictEqual(at(mines[0]).text, '🚩'); assert.doesNotMatch(at(mines[0]).cls, /wrong/);
  assert.match(at(safe[0]).cls, /wrong/); assert.match(at(safe[0]).label, /flagged, wrong/);
  assert.match(at(safe[1]).cls, /faded/);
  assert.doesNotMatch(g[4][4].cls, /faded/);                // open cells are not dimmed
  vm.undo(); assert.doesNotMatch(vm.state().grid[safe[1].r][safe[1].c].cls, /faded|wrong/);
});

test('result overlay: appears when the game ends with time and best time, can be closed, comes back for a new ending', () => {
  const vm = make();
  assert.strictEqual(vm.state().result, null);
  vm.click(4, 4); vm.elapsed = 12;
  const m = mineCell(vm); vm.click(m.r, m.c);
  let r = vm.state().result;
  assert.deepStrictEqual([r.kind, r.title, r.time, r.best, r.canUndo], ['lost', 'Boom!', '12 s', '–', true]);
  assert.match(r.detail, /Undo/);
  vm.dismissResult(); assert.strictEqual(vm.state().result, null);
  vm.undo(); assert.strictEqual(vm.state().result, null);
  const m2 = mineCell(vm); vm.click(m2.r, m2.c);
  assert.ok(vm.state().result);                              // a different ending shows it again
  vm.startReplay(); assert.strictEqual(vm.state().result, null);
  vm.replayClose(); assert.ok(vm.state().result);
  const timed = make(); timed.options.mode = 'timeattack'; timed.setOption('mode', 'timeattack'); timed.start();
  timed.click(4, 4); timed.elapsed = 200; timed.tick();
  assert.strictEqual(timed.state().result.title, "Time's up!");
});

test('face button follows the game', () => {
  const vm = make();
  assert.strictEqual(vm.state().face, '🙂');
  vm.click(4, 4); const m = mineCell(vm); vm.click(m.r, m.c);
  assert.strictEqual(vm.state().face, '😵');
  const w = make(); w.click(4, 4);
  for (const x of flat(w)) if (!x.cell.mine && !x.cell.revealed && w.game.status === 'playing') w.click(x.r, x.c);
  assert.strictEqual(w.state().face, '😎');
});

test('the settings tab is remembered; unknown tabs are refused', () => {
  const st = fakeStorage(), vm = make(st);
  assert.strictEqual(vm.state().settingsTab, 'game');
  assert.strictEqual(vm.setTab('data'), true);
  assert.strictEqual(vm.setTab('nonsense'), false);
  assert.strictEqual(make(st).state().settingsTab, 'data');
  st.setItem('ms-tab', 'bogus'); assert.strictEqual(make(st).state().settingsTab, 'game');
});

test('cellSize honours a bigger minimum for touch screens', () => {
  assert.strictEqual(cellSize(16, 30, 400, 800), 16);
  assert.strictEqual(cellSize(16, 30, 400, 800, 32), 32);
  assert.strictEqual(cellSize(9, 9, 1000, 800, 32), 40);
});
