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
      this.redoStack = [];       // snapshots undone and available to redo
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

    // Left click on a hidden cell. Returns true if the game state changed.
    reveal(r, c) {
      if (this.status !== 'playing') return false;
      const cell = this.cells[r][c];
      if (cell.revealed || cell.flagged) return false; // ignored clicks are not undoable moves
      const snap = this._snapshot();          // taken BEFORE placing mines, so undoing move 1 un-places them
      if (!this.minesPlaced) this.placeMines(r, c);
      this.history.push(snap);                // one push per click, however many cells open
      this.redoStack = [];                    // a new move invalidates redo
      this._open(r, c);
      this._checkWin();
      return true;
    }

    // Chord: click a revealed number whose flag count equals its number -> open all its unflagged neighbours.
    // Wrong flags can open a mine, which loses (standard rules). One undo step for the whole chord.
    chord(r, c) {
      if (this.status !== 'playing') return false;
      const cell = this.cells[r][c];
      if (!cell.revealed || cell.adjacent === 0) return false;
      const around = this.neighbors(r, c);
      if (around.filter(([y, x]) => this.cells[y][x].flagged).length !== cell.adjacent) return false;
      const targets = around.filter(([y, x]) => !this.cells[y][x].revealed && !this.cells[y][x].flagged);
      if (targets.length === 0) return false;
      this.history.push(this._snapshot());
      this.redoStack = [];
      for (const [y, x] of targets) this._open(y, x);
      this._checkWin();
      return true;
    }

    // Open one cell (no snapshot). A mine ends the game; otherwise flood-fill.
    _open(r, c) {
      const cell = this.cells[r][c];
      if (cell.revealed || cell.flagged) return;
      if (cell.mine) {
        cell.revealed = true;
        if (!this.exploded) this.exploded = { r, c };
        this.status = 'lost';
        return;
      }
      // Flood-fill: open the cell; if it has 0 adjacent mines, open its neighbours too (iterative, no recursion).
      const stack = [[r, c]];
      while (stack.length) {
        const [y, x] = stack.pop();
        const cur = this.cells[y][x];
        if (cur.revealed || cur.flagged) continue;
        cur.revealed = true;
        if (cur.adjacent === 0) stack.push(...this.neighbors(y, x));
      }
    }

    _checkWin() {
      if (this.status === 'playing' && this._allSafeRevealed()) {
        this.status = 'won';
        for (const row of this.cells) for (const k of row) if (k.mine) k.flagged = true;
      }
    }

    // Right click. Flagging is also a single undoable move.
    toggleFlag(r, c) {
      if (this.status !== 'playing') return false;
      const cell = this.cells[r][c];
      if (cell.revealed) return false;
      this.history.push(this._snapshot());
      this.redoStack = [];
      cell.flagged = !cell.flagged;
      return true;
    }

    canUndo() { return this.history.length > 0; }

    canRedo() { return this.redoStack.length > 0; }

    // Undo: save the CURRENT state for redo, then restore the last snapshot.
    // Works after a loss too. Empty history: does nothing, returns false.
    undo() {
      if (!this.canUndo()) return false;
      this.redoStack.push(this._snapshot());
      this._restore(this.history.pop());
      return true;
    }

    // Redo: mirror image of undo.
    redo() {
      if (!this.canRedo()) return false;
      this.history.push(this._snapshot());
      this._restore(this.redoStack.pop());
      return true;
    }

    _restore(s) { this.cells = s.cells; this.status = s.status; this.minesPlaced = s.minesPlaced; this.exploded = s.exploded; }

    // ---- Save / load ----
    // Compact JSON form: a board is one string, one character per cell (bits: 1 mine, 2 revealed, 4 flagged, adjacent << 3),
    // so even a long undo history stays small.
    serialize() {
      const enc = cells => cells.flat().map(c =>
        String.fromCharCode(48 + ((c.mine ? 1 : 0) | (c.revealed ? 2 : 0) | (c.flagged ? 4 : 0) | (c.adjacent << 3)))).join('');
      const snap = s => ({ cells: enc(s.cells), status: s.status, minesPlaced: s.minesPlaced, exploded: s.exploded });
      return { rows: this.rows, cols: this.cols, mines: this.mineCount, ...snap(this),
               history: this.history.map(snap), redo: this.redoStack.map(snap) };
    }

    // Rebuild a Game from serialize() output. The input may come from an uploaded file, so everything is checked
    // (sizes, characters, mine count, every number against its neighbours, status); returns null if anything is off.
    static deserialize(d, rng = Math.random) {
      const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
      if (!d || typeof d !== 'object' || !int(d.rows, 1, 50) || !int(d.cols, 1, 50) || !int(d.mines, 1, d.rows * d.cols - 1)) return null;
      if (!Array.isArray(d.history) || !Array.isArray(d.redo) || d.history.length > 5000 || d.redo.length > 5000) return null;
      const g = new Game(d.rows, d.cols, d.mines, rng);
      const decode = p => {
        if (!p || typeof p !== 'object' || typeof p.cells !== 'string' || p.cells.length !== d.rows * d.cols) return null;
        if (!['playing', 'won', 'lost'].includes(p.status) || typeof p.minesPlaced !== 'boolean') return null;
        let exploded = null;
        if (p.exploded !== null) {
          if (!p.exploded || !int(p.exploded.r, 0, d.rows - 1) || !int(p.exploded.c, 0, d.cols - 1)) return null;
          exploded = { r: p.exploded.r, c: p.exploded.c };
        }
        const cells = [];
        let mines = 0, revealedSafe = 0, anyRevealed = false;
        for (let r = 0; r < d.rows; r++) {
          const row = [];
          for (let c = 0; c < d.cols; c++) {
            const code = p.cells.charCodeAt(r * d.cols + c) - 48;
            if (!(code >= 0 && code < 72)) return null; // 71 = mine+revealed+flagged with adjacent 8
            const cell = { mine: !!(code & 1), revealed: !!(code & 2), flagged: !!(code & 4), adjacent: code >> 3 };
            if (cell.mine) mines++;
            if (cell.revealed) { anyRevealed = true; if (!cell.mine) revealedSafe++; }
            row.push(cell);
          }
          cells.push(row);
        }
        for (let r = 0; r < d.rows; r++)
          for (let c = 0; c < d.cols; c++) {
            const expected = g.neighbors(r, c).filter(([a, b]) => cells[a][b].mine).length;
            if (cells[r][c].adjacent !== (p.minesPlaced ? expected : 0)) return null;
          }
        if (p.minesPlaced ? mines !== d.mines : (mines !== 0 || anyRevealed)) return null;
        if (p.status === 'lost' && !exploded) return null;
        if (p.status === 'won' && revealedSafe !== d.rows * d.cols - d.mines) return null;
        return { cells, status: p.status, minesPlaced: p.minesPlaced, exploded };
      };
      const cur = decode(d), history = d.history.map(decode), redo = d.redo.map(decode);
      if (!cur || history.includes(null) || redo.includes(null)) return null;
      Object.assign(g, cur, { history, redoStack: redo });
      return g;
    }

    flagCount() { return this.cells.flat().filter(c => c.flagged).length; }
    minesLeft() { return this.mineCount - this.flagCount(); } // can go negative if over-flagged
    _allSafeRevealed() { return this.cells.flat().filter(c => c.revealed).length === this.rows * this.cols - this.mineCount; }
  }

  if (typeof module !== 'undefined') module.exports = { Game }; else root.Game = Game;
})(this);
