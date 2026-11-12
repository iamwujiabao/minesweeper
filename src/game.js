// Minesweeper game logic (the Model). No DOM code here, so it can be tested with plain Node.
// Patterns used here: Memento (createMemento / restoreMemento, with `history` and `redoStack` as the caretaker's stacks),
// Command (moves are Command objects, see commands.js) and Strategy (the board shape, see topology.js).
(function (root) {
  const dep = (name, global) => (typeof module !== 'undefined' ? require(name) : root[global]);
  const Rng = dep('./rng.js', 'Rng'), Solver = dep('./solver.js', 'Solver'), Topology = dep('./topology.js', 'Topology');
  const Commands = dep('./commands.js', 'Commands');

  class Game {
    // opts (all optional):
    //  topology 'square' | 'hex' | 'torus'   board shape (how cells touch)
    //  lives n        a mine costs one life instead of ending the game
    //  powerups       3 scanners and 1 shield per game
    //  undoLimit n    at most n undos
    //  players 2      two players alternate moves and score points
    //  noGuess        build boards that can be finished by logic alone
    //  seed n         reproduce one specific board (otherwise a seed is drawn from rng)
    constructor(rows = 9, cols = 9, mines = 10, rng = Math.random, opts = {}) {
      this.rows = rows; this.cols = cols; this.mineCount = mines; this.rng = rng;
      this.topology = Topology.ids.includes(opts.topology) ? opts.topology : 'square';
      this.initialLives = Number.isInteger(opts.lives) && opts.lives > 0 ? opts.lives : null;
      this.powerups = !!opts.powerups;
      this.undoLimit = Number.isInteger(opts.undoLimit) && opts.undoLimit >= 0 ? opts.undoLimit : null;
      this.players = opts.players === 2 ? 2 : 1;
      this.noGuess = !!opts.noGuess;
      this.seed = Number.isInteger(opts.seed) ? opts.seed : Math.floor(rng() * 2147483647);
      this.nb = Topology.buildNeighbors(rows, cols, this.topology);        // neighbour indexes per cell (the topology Strategy)
      this.nbPairs = this.nb.map(list => list.map(i => [Math.floor(i / cols), i % cols]));
      this.newGame();
    }

    newGame() {
      // A cell is plain data: { mine, adjacent, revealed, flagged, question }
      this.cells = Array.from({ length: this.rows }, () =>
        Array.from({ length: this.cols }, () => ({ mine: false, adjacent: 0, revealed: false, flagged: false, question: false })));
      this.status = 'playing';   // 'playing' | 'won' | 'lost' | 'timeout'
      this.minesPlaced = false;  // mines are placed on the first reveal so it is always safe
      this.exploded = null;      // {r, c} of the (last) mine the player hit
      this.history = [];         // undo stack of snapshots
      this.redoStack = [];       // snapshots undone and available to redo
      // State that undo restores (it is in every snapshot):
      this.lives = this.initialLives;                 // null when not playing with lives
      this.scanner = this.powerups ? 3 : 0;           // scanner charges left
      this.shield = this.powerups ? 1 : 0;            // shield charges left
      this.scans = [];                                // [{r, c, n}] scanner results
      this.current = 0;                               // whose turn (two players)
      this.scores = [0, 0];                           // cells revealed per player
      this.moveCount = 0;                             // how many of `moves` are in effect
      // State that undo does NOT restore:
      this.moves = [];                                // the Commands run so far, for replays (see commands.js)
      this.undoCount = 0;
      this.undosLeft = this.undoLimit;
      this.hintsUsed = 0;
      this.guessFree = true;                          // false if a no-guess board could not be built
    }

    neighbors(r, c) { return this.nbPairs[r * this.cols + c]; }

    // ---- Mines ----
    // The layout comes from the seed: shuffle all cells with the seeded generator and take the first `mines` that are
    // not in the safe zone around the first click. So one seed gives (almost) one board whatever the first click is,
    // and a first click never loses.
    _layout(seed, safe) {
      const n = this.rows * this.cols, rnd = Rng.mulberry32(seed), order = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      return order.filter(i => !safe.has(i)).slice(0, this.mineCount);
    }

    placeMines(safeR, safeC) {
      const first = safeR * this.cols + safeC;
      let safe = new Set([first, ...this.nb[first]]);               // the click and its neighbours are safe, so it opens an area
      if (this.rows * this.cols - safe.size < this.mineCount) safe = new Set([first]); // tiny board fallback
      let layout = this._layout(this.seed, safe);
      if (this.noGuess) {
        // Try random seeds until a logic-only player could finish the board starting from this click (give up after 3 s).
        const t0 = Date.now();
        let found = false;
        for (let attempt = 0; attempt < 5000 && !found && Date.now() - t0 < 3000; attempt++) {
          const seed = Math.floor(this.rng() * 2147483647), candidate = this._layout(seed, safe);
          const isMine = new Uint8Array(this.rows * this.cols);
          for (const i of candidate) isMine[i] = 1;
          layout = candidate; this.seed = seed;
          found = Solver.solvable(this.nb, isMine, first);
        }
        this.guessFree = found;
      }
      this.setMines(layout.map(i => [Math.floor(i / this.cols), i % this.cols]));
    }

    // Can a link reproduce this board? Not for no-guess boards (their mines depend on the first click's search).
    shareable() { return !this.noGuess; }

    // Fixed layout (used by placeMines and by tests): list of [row, col].
    setMines(list) {
      for (const row of this.cells) for (const cell of row) { cell.mine = false; cell.adjacent = 0; }
      for (const [r, c] of list) this.cells[r][c].mine = true;
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++)
          this.cells[r][c].adjacent = this.neighbors(r, c).filter(([a, b]) => this.cells[a][b].mine).length;
      this.minesPlaced = true;
    }

    // ---- Undo (Memento) ----
    // A memento is a deep copy of everything that can change, taken before each move. `history` holds the mementos of
    // earlier moves (undo pops one and restores it); `redoStack` holds the states undo threw away.
    createMemento() {
      return { cells: this.cells.map(row => row.map(cell => ({ ...cell }))), status: this.status,
               minesPlaced: this.minesPlaced, exploded: this.exploded && { ...this.exploded },
               lives: this.lives, scanner: this.scanner, shield: this.shield, scans: this.scans.map(s => ({ ...s })),
               current: this.current, scores: [...this.scores], moveCount: this.moveCount };
    }
    restoreMemento(m) { Object.assign(this, m); }

    // Called by a command that is about to change the game: keep the memento for undo, drop any redo, log the command.
    record(memento, command) {
      this.history.push(memento);
      this.redoStack = [];                    // a new move invalidates redo
      this.moves.length = this.moveCount;     // (a move after an undo replaces the undone ones)
      this.moves.push(command);
      this.moveCount++;
    }

    // ---- Moves (each one is a Command; these are shortcuts for running it) ----
    execute(command) { return command.execute(this); }
    reveal(r, c) { return this.execute(new Commands.RevealCommand(r, c)); }
    chord(r, c) { return this.execute(new Commands.ChordCommand(r, c)); }
    // Right click: hidden -> flag -> (with question marks) "?" -> hidden. Without question marks it just toggles the flag.
    mark(r, c, question = false) { return this.execute(new Commands.MarkCommand(r, c, question)); }
    toggleFlag(r, c) { return this.mark(r, c, false); }
    // Scanner power-up: count the mines in the cell and its neighbours.
    scan(r, c) { return this.execute(new Commands.ScanCommand(r, c)); }

    // Open one cell (no memento). A mine is handled by _hitMine; otherwise flood-fill. Returns cells newly revealed.
    openCell(r, c) {
      const cell = this.cells[r][c];
      if (cell.revealed || cell.flagged) return 0;
      if (cell.mine) { this._hitMine(cell, r, c); return 0; }
      // Flood-fill: open the cell; if it has 0 adjacent mines, open its neighbours too (iterative, no recursion).
      let gained = 0;
      const stack = [[r, c]];
      while (stack.length) {
        const [y, x] = stack.pop();
        const cur = this.cells[y][x];
        if (cur.revealed || cur.flagged) continue;
        cur.revealed = true; cur.question = false;
        gained++;
        if (cur.adjacent === 0) stack.push(...this.neighbors(y, x));
      }
      return gained;
    }

    // A mine was opened. The shield absorbs it (the mine stays hidden, marked with a flag); with lives it costs a life;
    // otherwise the game is lost.
    _hitMine(cell, r, c) {
      if (this.shield > 0) { this.shield--; cell.flagged = true; cell.question = false; return; }
      cell.revealed = true; cell.flagged = false; cell.question = false;
      this.exploded = { r, c };
      if (this.lives !== null && this.lives > 1) { this.lives--; return; }
      if (this.lives !== null) this.lives = 0;
      this.status = 'lost';
    }

    // After a reveal or chord: score the cells, check for a win, pass the turn (two players).
    endMove(gained) {
      this.scores[this.current] += gained;
      if (this.status === 'playing' && this._allSafeRevealed()) {
        this.status = 'won';
        for (const row of this.cells) for (const k of row) if (k.mine && !k.revealed) { k.flagged = true; k.question = false; }
      }
      if (this.players === 2 && this.status === 'playing') this.current = 1 - this.current;
    }

    // Hint: a hidden cell that is certainly safe, worked out only from what the player can see (the open numbers).
    // Returns {r, c} or null. Not a move: it does not change the board, only counts as a hint used.
    hint() {
      if (this.status !== 'playing' || !this.minesPlaced) return null;
      const flat = this.cells.flat();
      const revealed = flat.map(c => (c.revealed && !c.mine ? 1 : 0)), num = flat.map(c => c.adjacent);
      const knownMine = flat.map(c => (c.revealed && c.mine ? 1 : 0)); // mines already hit in lives mode
      // (the global mine count is only used while the shield has not hidden a mine under a flag)
      const i = Solver.hint(this.nb, revealed, num, knownMine, this.powerups && this.shield === 0 ? undefined : this.mineCount);
      if (i < 0) return null;
      this.hintsUsed++;
      return { r: Math.floor(i / this.cols), c: i % this.cols };
    }

    // ---- Undo / redo / time ----
    started() { return this.history.length > 0; }             // at least one move made
    canUndo() { return this.started() && this.status !== 'timeout' && (this.undosLeft === null || this.undosLeft > 0); }
    canRedo() { return this.redoStack.length > 0; }

    // Undo: save the CURRENT state for redo, then restore the last snapshot. Works after a loss too.
    // Counts against a limited-undo challenge. Empty history (or no undos left): does nothing, returns false.
    undo() {
      if (!this.canUndo()) return false;
      this.redoStack.push(this.createMemento());
      this.restoreMemento(this.history.pop());
      this.undoCount++;
      if (this.undosLeft !== null) this.undosLeft--;
      return true;
    }
    // Redo: mirror image of undo (free).
    redo() {
      if (!this.canRedo()) return false;
      this.history.push(this.createMemento());
      this.restoreMemento(this.redoStack.pop());
      return true;
    }
    // Time attack: the clock ran out. Final: undo is off afterwards.
    endByTimeout() { if (this.status !== 'playing') return false; this.status = 'timeout'; return true; }

    // ---- Facts about the board ----
    flagCount() { return this.cells.flat().filter(c => c.flagged).length; }
    // Mines still to find. With lives, a mine you hit is found too.
    minesLeft() {
      return this.mineCount - this.flagCount() - (this.initialLives !== null ? this.cells.flat().filter(c => c.mine && c.revealed).length : 0);
    }
    _allSafeRevealed() { return this.cells.flat().filter(c => c.revealed && !c.mine).length === this.rows * this.cols - this.mineCount; }

    // 3BV ("Bechtel's Board Benchmark Value"): the fewest clicks that could solve the board. One per connected zero area
    // (with its border numbers), plus one per number that touches no zero.
    bbbv() {
      if (!this.minesPlaced) return 0;
      const flat = this.cells.flat(), seen = new Uint8Array(flat.length);
      let count = 0;
      for (let i = 0; i < flat.length; i++) {
        if (flat[i].mine || flat[i].adjacent !== 0 || seen[i]) continue;
        count++; seen[i] = 1;
        const stack = [i];
        while (stack.length) for (const k of this.nb[stack.pop()]) if (!seen[k]) { seen[k] = 1; if (flat[k].adjacent === 0) stack.push(k); }
      }
      for (let i = 0; i < flat.length; i++) if (!flat[i].mine && !seen[i]) count++;
      return count;
    }

    // ---- Replay ----
    // Frames of the game as it was played (only the moves still in effect): frame 0 is the blank board, frame k the
    // board after k moves. Built by playing the moves again on a copy with the same mines.
    replayFrames() {
      const mines = [];
      this.cells.forEach((row, r) => row.forEach((cell, c) => { if (cell.mine) mines.push([r, c]); }));
      const g = new Game(this.rows, this.cols, this.mineCount, Math.random,
        { topology: this.topology, lives: this.initialLives, powerups: this.powerups, players: this.players, seed: this.seed });
      g.setMines(mines);
      const frame = () => ({ cells: g.cells.map(row => row.map(cell => ({ ...cell }))), status: g.status, lives: g.lives,
                             scans: g.scans.map(s => ({ ...s })), current: g.current, scores: [...g.scores], exploded: g.exploded && { ...g.exploded } });
      const frames = [frame()];
      for (const command of this.moves.slice(0, this.moveCount)) { // the same Commands, run again on the fresh copy
        command.execute(g);
        frames.push(frame());
      }
      if (this.status === 'timeout') { g.status = 'timeout'; frames.push(frame()); }
      return frames;
    }
  }

  if (typeof module !== 'undefined') module.exports = { Game }; else root.Game = Game;
})(this);
