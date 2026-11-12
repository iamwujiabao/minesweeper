// View (MVVM), plain JavaScript: draws vm.state() and forwards DOM events to ViewModel commands. No game rules here.
// Bundled with esbuild (npm run build) into dist/plain-app.js; the shared code comes from dist/core.js (see scripts/build.js).
import { ViewModel, cellSize, ACTION_LABELS, LEVEL_NAMES, OPTION_DEFS } from './viewmodel.js';
import { rngFromSearch, parsePlay } from './rng.js';
import { Sound } from './sound.js';
import { SettingsFile } from './settingsfile.js';

const $ = id => document.getElementById(id);
const boardEl = $('board'), levelEl = $('level'), customEl = $('custom');
let lastLongPress = 0;
const keyName = k => (k === ' ' ? 'Space' : k);
const baseUrl = () => location.href.split(/[?#]/)[0];

// localStorage can throw (private mode); fall back to "nothing stored".
const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

// (built before the ViewModel, whose constructor triggers the first render)
// Game options form: built once from the ViewModel's option list, then kept in sync.
for (const def of OPTION_DEFS) {
  const label = document.createElement('label');
  label.className = 'opt';
  label.append(def.label + ' ');
  let input;
  if (def.type === 'select') {
    input = document.createElement('select');
    for (const [value, text] of def.choices) input.add(new Option(text, value));
    input.onchange = () => vm.setOption(def.key, input.value);
  } else {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.onchange = () => vm.setOption(def.key, input.checked);
  }
  input.id = 'opt-' + def.key;
  label.append(input);
  $('optionsForm').append(label);
}
const vm = new ViewModel(storage, {
  onChange: render, onTick: t => { $('time').textContent = t; },
  rng: rngFromSearch(location.search), play: parsePlay(location.search),
});

function newGame() { vm.start(levelEl.value, [$('rows').value, $('cols').value, $('minesIn').value]); }

function render(s) {
  Sound.onState(s);
  document.documentElement.dataset.theme = s.options.theme;
  levelEl.value = s.level; // restored from saved settings on load
  renderKeys(s);
  renderSaves(s);
  renderProgress(s);
  syncOptions(s);
  customEl.hidden = s.level !== 'custom';
  [$('rows').value, $('cols').value, $('minesIn').value] = s.custom; // show clamped values
  boardEl.className = s.topology === 'hex' ? 'hexboard' : '';
  boardEl.style.setProperty('--cols', s.cols);
  resize(s);
  boardEl.innerHTML = '';
  $('hoverInfo').textContent = '';
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++) {
      const cell = s.grid[r][c];
      const b = document.createElement('button');
      b.className = cell.cls; b.textContent = cell.text;
      b.onclick = () => { if (Date.now() - lastLongPress > 600) vm.click(r, c); };            // click (reveal, chord or scan)
      b.oncontextmenu = e => { e.preventDefault(); if (Date.now() - lastLongPress > 800) vm.flag(r, c); };
      b.onmouseenter = () => hoverOn(r, c);                                                   // highlight a number's neighbours
      b.onmouseleave = hoverOff;

      // Touch: hold 450ms to flag. lastLongPress stops the click/contextmenu that follows from acting twice.
      let timer;
      b.onpointerdown = e => { if (e.pointerType === 'touch') timer = setTimeout(() => { lastLongPress = Date.now(); vm.flag(r, c); }, 450); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(timer);
      boardEl.appendChild(b);
    }
  $('sound').checked = !s.muted;
  $('volume').value = s.volume;
  $('mines').textContent = s.minesLeft;
  $('time').textContent = s.timeText;
  $('best').textContent = s.best ? s.best + 's' : '-';
  $('undo').disabled = !s.canUndo;
  $('redo').disabled = !s.canRedo;
  $('hint').disabled = s.status !== 'playing' || !!s.replay;
  $('scanner').hidden = !s.powerups;
  $('scanner').textContent = `Scanner (${s.scanner})`;
  $('scanner').disabled = !s.scanMode && (s.scanner === 0 || s.status !== 'playing');
  $('scanner').classList.toggle('armed', s.scanMode);
  $('replay').hidden = !s.canReplay || !!s.replay;
  $('replaybar').hidden = !s.replay;
  if (s.replay) $('replay-play').innerHTML = s.replay.playing ? '&#10074;&#10074; Pause' : '&#9654; Play';
  $('status').textContent = s.statusText;
  $('shareLink').value = s.shareCode ? baseUrl() + '?play=' + s.shareCode : '';
  $('copyLink').disabled = !s.shareCode;
  $('shareMsg').textContent = s.shareCode ? '' : 'No-guess boards cannot be shared as a link';
}

// Hover help: outline the neighbours of an open number and say how many flags it still needs.
function hoverOn(r, c) {
  const h = vm.neighborhood(r, c);
  if (!h) return;
  for (const i of h.cells) boardEl.children[i].classList.add('nb');
  $('hoverInfo').textContent = `${h.number}: ` + (h.remaining > 0 ? `${h.remaining} more flag${h.remaining === 1 ? '' : 's'} needed` :
    h.remaining === 0 ? 'all flags placed' : `${-h.remaining} flag${h.remaining === -1 ? '' : 's'} too many`);
}
function hoverOff() {
  for (const el of boardEl.querySelectorAll('.nb')) el.classList.remove('nb');
  $('hoverInfo').textContent = '';
}

// Cell size fits the board to the window; recomputed on resize without rebuilding the grid.
function resize(s = vm.state()) {
  boardEl.style.setProperty('--s', cellSize(s.rows, s.cols, window.innerWidth - 32, window.innerHeight - 200) + 'px');
}
window.onresize = () => resize();

function syncOptions(s) {
  for (const def of OPTION_DEFS) {
    const input = $('opt-' + def.key);
    if (def.type === 'select') input.value = s.options[def.key]; else input.checked = s.options[def.key];
  }
  $('optionsNote').textContent = s.optionsPending ? 'Mode, board, no-guess and power-ups apply to the next new game.' : '';
}

// Statistics table and achievement badges.
function renderProgress(s) {
  $('stats').innerHTML = '';
  for (const [label, value] of s.stats) {
    const tr = $('stats').insertRow();
    tr.insertCell().textContent = label;
    tr.insertCell().textContent = value;
  }
  $('achievements').innerHTML = '';
  for (const a of s.achievements) {
    const li = document.createElement('li');
    li.className = 'ach ' + (a.unlocked ? 'unlocked' : 'locked');
    li.textContent = (a.unlocked ? '🏆 ' : '🔒 ') + a.name + ' - ' + a.desc;
    $('achievements').append(li);
  }
}

// Key panel: each action lists its keys (click a key to remove it, "+ add key" to add one).
function renderKeys(s) {
  $('keylist').innerHTML = '';
  for (const a of Object.keys(ACTION_LABELS)) {
    const row = document.createElement('div');
    row.className = 'keyrow';
    row.append(ACTION_LABELS[a] + ':');
    for (const k of s.keys[a]) {
      const chip = document.createElement('button');
      chip.textContent = keyName(k) + (s.keys[a].length > 1 ? ' ✕' : '');
      chip.title = 'Remove this key';
      chip.disabled = s.keys[a].length < 2; // an action keeps at least one key
      chip.onclick = () => vm.removeKey(a, k);
      row.append(chip);
    }
    const add = document.createElement('button');
    add.textContent = s.rebinding === a ? 'press a key...' : '+ add key';
    add.onclick = () => vm.startRebind(a);
    row.append(add);
    $('keylist').append(row);
  }
  $('keymsg').textContent = s.keyMessage;
}
$('resetkeys').onclick = () => vm.resetKeys();

// Saved-game slots and the best-times table.
function renderSaves(s) {
  $('slots').innerHTML = '';
  for (const { n, label } of s.slots) {
    const row = document.createElement('div');
    row.className = 'slotrow';
    row.append(`Slot ${n}: ${label || 'empty'} `);
    for (const [id, text, disabled, run] of [
      ['save', 'Save here', false, () => { vm.saveSlot(n); $('slotMsg').textContent = `Saved to slot ${n}`; }],
      ['load', 'Load', !label, () => { $('slotMsg').textContent = vm.loadSlot(n) ? `Loaded slot ${n}` : `Could not load slot ${n}`; }],
      ['delete', 'Delete', !label, () => { vm.deleteSlot(n); $('slotMsg').textContent = `Deleted slot ${n}`; }],
    ]) {
      const b = document.createElement('button');
      b.id = `slot-${id}-${n}`; b.textContent = text; b.disabled = disabled; b.onclick = run;
      row.append(b, ' ');
    }
    $('slots').append(row);
  }
  const levels = Object.keys(s.scores);
  $('scores').innerHTML = '<thead><tr>' + levels.map(l => `<th>${LEVEL_NAMES[l]}</th>`).join('') + '</tr></thead><tbody>' +
    Array.from({ length: s.scoreRows }, (_, i) => '<tr>' + levels.map(l => {
      const e = s.scores[l][i];
      return e ? `<td title="${e.date}">${e.t}s</td>` : '<td></td>'; // numbers and locale dates only: nothing user-typed goes into the HTML
    }).join('') + '</tr>').join('') + '</tbody>';
}
$('clear-scores').onclick = () => vm.clearScores();
$('clear-stats').onclick = () => vm.clearStats();

// Daily challenge, share link, replay, hint, scanner.
$('daily').onclick = () => vm.startDaily();
$('copyLink').onclick = async () => {
  const input = $('shareLink');
  try { await navigator.clipboard.writeText(input.value); $('shareMsg').textContent = 'Link copied'; }
  catch (e) { input.select(); $('shareMsg').textContent = 'Press Ctrl+C (or Cmd+C) to copy the selected link'; } // no clipboard access: let the user copy it
};
$('replay').onclick = () => vm.startReplay();
$('replay-prev').onclick = () => vm.replayStep(-1);
$('replay-next').onclick = () => vm.replayStep(1);
$('replay-play').onclick = () => vm.replayPlay();
$('replay-close').onclick = () => vm.replayClose();
$('hint').onclick = () => vm.hint();
$('scanner').onclick = () => vm.toggleScanner();

// Files: download settings or the game in progress, or upload either (validated all-or-nothing by the ViewModel).
$('export').onclick = () => { SettingsFile.download(vm.exportSettings()); $('settingsMsg').textContent = 'Downloaded minesweeper-settings.json'; };
$('exportGame').onclick = () => { SettingsFile.download(vm.exportGame(), 'minesweeper-game.json'); $('settingsMsg').textContent = 'Downloaded minesweeper-game.json'; };
$('settingsFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = ''; // so choosing the same file again still fires change
  if (!file) return;
  try {
    const r = vm.importFile(await SettingsFile.read(file));
    $('settingsMsg').textContent = r.ok ? 'Imported ' + file.name : 'Not imported: ' + r.error;
  } catch (err) { $('settingsMsg').textContent = 'Not imported: ' + err.message; }
};

// Keyboard: the ViewModel decides what a key means. Skip browser shortcuts and typing in fields.
document.onkeydown = e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!vm.rebinding && e.target.matches?.('input[type=number], input[type=range], select')) return;
  if (vm.pressKey(e.key)) { e.preventDefault(); document.activeElement.blur?.(); } // blur: Space/Enter must not also press a focused button
};

setInterval(() => vm.tick(), 1000);
window.addEventListener('pagehide', () => vm.save()); // keep the exact elapsed time for the autosaved game
$('new').onclick = newGame;
levelEl.onchange = newGame;
$('sound').onchange = e => vm.setMuted(!e.target.checked);
$('volume').onchange = e => vm.setVolume(e.target.value);
$('undo').onclick = () => vm.undo();
$('redo').onclick = () => vm.redo();
render(vm.state());
