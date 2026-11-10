// GUI controller: translates clicks into Game calls and redraws. No game rules here.
const game = new Game(9, 9, 10);
const boardEl = document.getElementById('board');

function render() {
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
      b.onclick = () => { game.reveal(r, c); render(); };                                  // left click
      b.oncontextmenu = e => { e.preventDefault(); game.toggleFlag(r, c); render(); };      // right click
      boardEl.appendChild(b);
    }
  document.getElementById('mines').textContent = game.minesLeft();
  document.getElementById('undo').disabled = !game.canUndo();
  document.getElementById('status').textContent =
    { playing: 'Playing - click to reveal, right-click to flag', won: '🎉 You won!', lost: '💥 Boom! You lost. Press Undo to take it back.' }[game.status];
}

document.getElementById('new').onclick = () => { game.newGame(); render(); };
document.getElementById('undo').onclick = () => { game.undo(); render(); };
render();
