// GUI controller: translates clicks into Game calls and redraws. No game rules here.
const LEVELS = { beginner: [9, 9, 10, 36], intermediate: [16, 16, 40, 30], expert: [16, 30, 99, 26] }; // rows, cols, mines, cell px
const boardEl = document.getElementById('board');
const levelEl = document.getElementById('level');
let game, elapsed = 0, lastLongPress = 0;

// localStorage can throw (private mode), so wrap it.
const loadBest = () => { try { return Number(localStorage.getItem('ms-best-' + levelEl.value)) || null; } catch (e) { return null; } };
const saveBest = t => { try { localStorage.setItem('ms-best-' + levelEl.value, t); } catch (e) {} };

function start() {
  const [r, c, m, px] = LEVELS[levelEl.value];
  game = new Game(r, c, m);
  elapsed = 0;
  boardEl.style.setProperty('--cols', c);
  boardEl.style.setProperty('--s', px + 'px');
  render();
}

function flag(r, c) { game.toggleFlag(r, c); render(); }

function render() {
  if (!game.canUndo()) elapsed = 0; // nothing played (new game or first move undone)
  boardEl.innerHTML = '';
  for (let r = 0; r < game.rows; r++)
    for (let c = 0; c < game.cols; c++) {
      const cell = game.cells[r][c];
      const b = document.createElement('button');
      if (cell.revealed) {
        b.className = 'open' + (cell.mine ? ' boom' : '');
        if (cell.mine) b.textContent = '💣';
        else if (cell.adjacent) { b.textContent = cell.adjacent; b.classList.add('n' + cell.adjacent); }
      } else if (cell.flagged) b.textContent = '🚩';
      else if (game.status === 'lost' && cell.mine) b.textContent = '💣'; // show all mines after a loss

      b.onclick = () => { if (Date.now() - lastLongPress < 600) return; game.reveal(r, c); render(); }; // left click
      b.oncontextmenu = e => { e.preventDefault(); if (Date.now() - lastLongPress < 800) return; flag(r, c); }; // right click

      // Touch: hold 450ms to flag. lastLongPress stops the click/contextmenu that follows from acting twice.
      let timer;
      b.onpointerdown = e => { if (e.pointerType === 'touch') timer = setTimeout(() => { lastLongPress = Date.now(); flag(r, c); }, 450); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(timer);
      boardEl.appendChild(b);
    }

  // High score: best (lowest) time per difficulty, only on a win.
  let best = loadBest();
  if (game.status === 'won' && elapsed > 0 && (!best || elapsed < best)) { best = elapsed; saveBest(best); }

  document.getElementById('mines').textContent = game.minesLeft();
  document.getElementById('time').textContent = elapsed;
  document.getElementById('best').textContent = best ? best + 's' : '-';
  document.getElementById('undo').disabled = !game.canUndo();
  document.getElementById('redo').disabled = !game.canRedo();
  document.getElementById('status').textContent =
    { playing: 'Playing - click to reveal, right-click to flag', won: '🎉 You won!', lost: '💥 Boom! You lost. Press Undo to take it back.' }[game.status];
}

// Timer: ticks only while a game is in progress (at least one move made, not won/lost). Undoing after a loss resumes it.
setInterval(() => {
  if (game.status === 'playing' && game.canUndo()) { elapsed++; document.getElementById('time').textContent = elapsed; }
}, 1000);

document.getElementById('new').onclick = start;
levelEl.onchange = start;
document.getElementById('undo').onclick = () => { game.undo(); render(); };
document.getElementById('redo').onclick = () => { game.redo(); render(); };
start();
