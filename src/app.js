// View (MVVM): draws vm.state() and forwards DOM events to ViewModel commands. No game rules here.
const $ = id => document.getElementById(id);
const boardEl = $('board'), levelEl = $('level'), customEl = $('custom');
let lastLongPress = 0;

// localStorage can throw (private mode); fall back to "nothing stored".
const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

const vm = new ViewModel(storage, { onChange: render, onTick: t => { $('time').textContent = t; } });

function newGame() { vm.start(levelEl.value, [$('rows').value, $('cols').value, $('minesIn').value]); }

function render(s) {
  customEl.hidden = s.level !== 'custom';
  [$('rows').value, $('cols').value, $('minesIn').value] = s.custom; // show clamped values
  boardEl.style.setProperty('--cols', s.cols);
  boardEl.style.setProperty('--s', (s.cols <= 9 ? 36 : s.cols <= 16 ? 30 : 26) + 'px');
  boardEl.innerHTML = '';
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++) {
      const cell = s.cells[r][c];
      const b = document.createElement('button');
      if (cell.revealed) {
        b.className = 'open' + (cell.mine ? ' boom' : '');
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
    { playing: 'Playing - click to reveal, click a number to chord, right-click to flag', won: '🎉 You won!', lost: '💥 Boom! You lost. Press Undo to take it back.' }[s.status];
}

setInterval(() => vm.tick(), 1000);
$('new').onclick = newGame;
levelEl.onchange = newGame;
$('undo').onclick = () => vm.undo();
$('redo').onclick = () => vm.redo();
render(vm.state());
