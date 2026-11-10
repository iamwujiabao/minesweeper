// View (MVVM): draws vm.state() and forwards DOM events to ViewModel commands. No game rules here.
const $ = id => document.getElementById(id);
const boardEl = $('board'), levelEl = $('level'), customEl = $('custom');
let lastLongPress = 0;
let prev = null; // last drawn counts, used to pick a sound; null = no sound (new game)

// Sound: tiny Web Audio beeps, no audio files. Browsers only allow audio after a user gesture, which clicks/keys are.
let audioCtx;
function beep(freq, ms, type = 'square', delay = 0) {
  if (!$('sound').checked) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + delay;
    o.type = type; o.frequency.value = freq; g.gain.value = 0.05;
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + ms / 1000);
  } catch (e) {}
}
function playSound(s) {
  const flat = s.cells.flat(), open = flat.filter(c => c.revealed).length, flags = flat.filter(c => c.flagged).length;
  if (prev) {
    if (s.status === 'lost' && prev.status !== 'lost') beep(90, 450, 'sawtooth');
    else if (s.status === 'won' && prev.status !== 'won') [523, 659, 784].forEach((f, i) => beep(f, 150, 'square', i * 0.15));
    else if (open > prev.open) beep(600, 40);
    else if (open < prev.open) beep(300, 60);  // undo of a reveal
    else if (flags !== prev.flags) beep(420, 50);
  }
  prev = { open, flags, status: s.status };
}

// localStorage can throw (private mode); fall back to "nothing stored".
const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

const vm = new ViewModel(storage, { onChange: render, onTick: t => { $('time').textContent = t; } });

function newGame() { prev = null; vm.start(levelEl.value, [$('rows').value, $('cols').value, $('minesIn').value]); }

function render(s) {
  playSound(s);
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
  const px = cellSize(s.rows, s.cols, window.innerWidth - 32, window.innerHeight - 200);
  boardEl.style.setProperty('--s', px + 'px');
}
window.onresize = () => resize();

// Keyboard play. Ignored while typing in the custom-size fields.
document.onkeydown = e => {
  if (e.target.matches?.('input[type=number], select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const { r, c } = vm.state().cursor;
  const keys = {
    ArrowUp: () => vm.move(-1, 0), ArrowDown: () => vm.move(1, 0), ArrowLeft: () => vm.move(0, -1), ArrowRight: () => vm.move(0, 1),
    Enter: () => vm.click(r, c), ' ': () => vm.click(r, c), f: () => vm.flag(r, c), u: () => vm.undo(), y: () => vm.redo(), n: newGame,
  };
  const act = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!act) return;
  e.preventDefault();
  document.activeElement.blur(); // so Space/Enter doesn't also press a focused toolbar button
  act();
};

setInterval(() => vm.tick(), 1000);
$('new').onclick = newGame;
levelEl.onchange = newGame;
$('undo').onclick = () => vm.undo();
$('redo').onclick = () => vm.redo();
render(vm.state());
