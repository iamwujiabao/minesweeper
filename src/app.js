// View (MVVM), plain JavaScript: draws vm.state() and forwards DOM events to ViewModel commands. No game rules here.
const $ = id => document.getElementById(id);
const boardEl = $('board'), levelEl = $('level'), customEl = $('custom');
let lastLongPress = 0;
const keyName = k => (k === ' ' ? 'Space' : k);

// localStorage can throw (private mode); fall back to "nothing stored".
const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

const vm = new ViewModel(storage, { onChange: render, onTick: t => { $('time').textContent = t; } });

function newGame() { vm.start(levelEl.value, [$('rows').value, $('cols').value, $('minesIn').value]); }

function render(s) {
  Sound.onState(s);
  levelEl.value = s.level; // restored from saved settings on load
  renderKeys(s);
  customEl.hidden = s.level !== 'custom';
  [$('rows').value, $('cols').value, $('minesIn').value] = s.custom; // show clamped values
  boardEl.style.setProperty('--cols', s.cols);
  resize(s);
  boardEl.innerHTML = '';
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++) {
      const cell = s.cells[r][c];
      const b = document.createElement('button');
      if (r === s.cursor.r && c === s.cursor.c) b.className = 'cursor';
      if (cell.revealed) {
        b.className += ' open' + (cell.mine ? ' boom' : '');
        if (cell.mine) b.textContent = '💣';
        else if (cell.adjacent) { b.textContent = cell.adjacent; b.classList.add('n' + cell.adjacent); }
      } else if (cell.flagged) b.textContent = '🚩';
      else if (s.status === 'lost' && cell.mine) b.textContent = '💣'; // show all mines after a loss

      b.onclick = () => { if (Date.now() - lastLongPress > 600) vm.click(r, c); };            // click (reveal or chord)
      b.oncontextmenu = e => { e.preventDefault(); if (Date.now() - lastLongPress > 800) vm.flag(r, c); };

      // Touch: hold 450ms to flag. lastLongPress stops the click/contextmenu that follows from acting twice.
      let timer;
      b.onpointerdown = e => { if (e.pointerType === 'touch') timer = setTimeout(() => { lastLongPress = Date.now(); vm.flag(r, c); }, 450); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(timer);
      boardEl.appendChild(b);
    }
  $('sound').checked = !s.muted;
  $('volume').value = s.volume;
  $('mines').textContent = s.minesLeft;
  $('time').textContent = s.time;
  $('best').textContent = s.best ? s.best + 's' : '-';
  $('undo').disabled = !s.canUndo;
  $('redo').disabled = !s.canRedo;
  $('status').textContent =
    { playing: 'Playing - click to reveal, click a number to chord, right-click to flag (or use the keyboard)', won: '🎉 You won!', lost: '💥 Boom! You lost. Press Undo to take it back.' }[s.status];
}

// Cell size fits the board to the window; recomputed on resize without rebuilding the grid.
function resize(s = vm.state()) {
  boardEl.style.setProperty('--s', cellSize(s.rows, s.cols, window.innerWidth - 32, window.innerHeight - 200) + 'px');
}
window.onresize = () => resize();

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

// Settings file: download the JSON, or upload one (validated all-or-nothing by the ViewModel).
$('export').onclick = () => { SettingsFile.download(vm.exportSettings()); $('settingsMsg').textContent = 'Downloaded minesweeper-settings.json'; };
$('settingsFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = ''; // so choosing the same file again still fires change
  if (!file) return;
  try {
    const r = vm.importSettings(await SettingsFile.read(file));
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
$('new').onclick = newGame;
levelEl.onchange = newGame;
$('sound').onchange = e => vm.setMuted(!e.target.checked);
$('volume').onchange = e => vm.setVolume(e.target.value);
$('undo').onclick = () => vm.undo();
$('redo').onclick = () => vm.redo();
render(vm.state());
