// Minesweeper game logic. No DOM code here, so it can be tested with plain Node.
(function (root) {
  class Game {
    constructor(rows = 9, cols = 9, mines = 10, rng = Math.random) {
      this.rows = rows; this.cols = cols; this.mineCount = mines; this.rng = rng;
      this.newGame();
    }

    newGame() {
      // A cell is plain data: { mine, adjacent, revealed, flagged }
      this.cells = Array.from({ length: this.rows }, () =>
        Array.from({ length: this.cols }, () => ({ mine: false, adjacent: 0, revealed: false, flagged: false })));
      this.status = 'playing';   // 'playing' | 'won' | 'lost'
      this.minesPlaced = false;  // mines are placed on the first reveal so it is always safe
      this.exploded = null;      // {r, c} of the mine the player hit
      this.history = [];         // undo stack of snapshots
    }

    neighbors(r, c) {
      const out = [];
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if ((dr || dc) && nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) out.push([nr, nc]);
        }
      return out;
    }

    // Random mines, never on the clicked cell or its neighbours (so the first click opens an area).
    placeMines(safeR, safeC) {
      let safe = new Set([safeR * this.cols + safeC, ...this.neighbors(safeR, safeC).map(([r, c]) => r * this.cols + c)]);
      let free = [];
      const collect = () => { free = []; for (let i = 0; i < this.rows * this.cols; i++) if (!safe.has(i)) free.push(i); };
      collect();
      if (free.length < this.mineCount) { safe = new Set([safeR * this.cols + safeC]); collect(); } // tiny board fallback
      for (let k = 0; k < this.mineCount; k++) { // Fisher-Yates partial shuffle
        const j = k + Math.floor(this.rng() * (free.length - k));
        [free[k], free[j]] = [free[j], free[k]];
      }
      this.setMines(free.slice(0, this.mineCount).map(i => [Math.floor(i / this.cols), i % this.cols]));
    }

    // Fixed layout (used by placeMines and by tests): list of [row, col].
    setMines(list) {
      for (const row of this.cells) for (const cell of row) { cell.mine = false; cell.adjacent = 0; }
      for (const [r, c] of list) this.cells[r][c].mine = true;
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++)
          this.cells[r][c].adjacent = this.neighbors(r, c).filter(([a, b]) => this.cells[a][b].mine).length;
      this.minesPlaced = true;
    }

    // UNDO: a snapshot is a deep copy of everything that can change.
    _snapshot() {
      return { cells: this.cells.map(row => row.map(cell => ({ ...cell }))), status: this.status,
               minesPlaced: this.minesPlaced, exploded: this.exploded && { ...this.exploded } };
    }

    // Left click. Returns true if the game state changed.
    reveal(r, c) {
      if (this.status !== 'playing') return false;
      const cell = this.cells[r][c];
      if (cell.revealed || cell.flagged) return false; // ignored clicks are not undoable moves
      const snap = this._snapshot();          // taken BEFORE placing mines, so undoing move 1 un-places them
      if (!this.minesPlaced) this.placeMines(r, c);
      this.history.push(snap);                // one push per click, however many cells open
      if (cell.mine) { cell.revealed = true; this.exploded = { r, c }; this.status = 'lost'; return true; }

      // Flood-fill: open the cell; if it has 0 adjacent mines, open its neighbours too (iterative, no recursion).
      const stack = [[r, c]];
      while (stack.length) {
        const [y, x] = stack.pop();
        const cur = this.cells[y][x];
        if (cur.revealed || cur.flagged) continue;
        cur.revealed = true;
        if (cur.adjacent === 0) stack.push(...this.neighbors(y, x));
      }
      if (this._allSafeRevealed()) {
        this.status = 'won';
        for (const row of this.cells) for (const k of row) if (k.mine) k.flagged = true;
      }
      return true;
    }

    // Right click. Flagging is also a single undoable move.
    toggleFlag(r, c) {
      if (this.status !== 'playing') return false;
      const cell = this.cells[r][c];
      if (cell.revealed) return false;
      this.history.push(this._snapshot());
      cell.flagged = !cell.flagged;
      return true;
    }

    canUndo() { return this.history.length > 0; }

    // Restore the last snapshot. Works after a loss too. Empty history: does nothing, returns false.
    undo() {
      if (!this.canUndo()) return false;
      const s = this.history.pop();
      this.cells = s.cells; this.status = s.status; this.minesPlaced = s.minesPlaced; this.exploded = s.exploded;
      return true;
    }

    flagCount() { return this.cells.flat().filter(c => c.flagged).length; }
    minesLeft() { return this.mineCount - this.flagCount(); } // can go negative if over-flagged
    _allSafeRevealed() { return this.cells.flat().filter(c => c.revealed).length === this.rows * this.cols - this.mineCount; }
  }

  if (typeof module !== 'undefined') module.exports = { Game }; else root.Game = Game;
})(this);
