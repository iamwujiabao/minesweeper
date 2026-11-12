// Minesweeper game logic. No DOM code here, so it can be tested with plain Node.
(function (root) {
  const Rng = typeof module !== 'undefined' ? require('./rng.js') : root.Rng;
  const Solver = typeof module !== 'undefined' ? require('./solver.js') : root.Solver;
  const TOPOLOGIES = ['square', 'hex', 'torus'];
  const STATUSES = ['playing', 'won', 'lost', 'timeout'];

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
      this.topology = TOPOLOGIES.includes(opts.topology) ? opts.topology : 'square';
      this.initialLives = Number.isInteger(opts.lives) && opts.lives > 0 ? opts.lives : null;
      this.powerups = !!opts.powerups;
      this.undoLimit = Number.isInteger(opts.undoLimit) && opts.undoLimit >= 0 ? opts.undoLimit : null;
      this.players = opts.players === 2 ? 2 : 1;
      this.noGuess = !!opts.noGuess;
      this.seed = Number.isInteger(opts.seed) ? opts.seed : Math.floor(rng() * 2147483647);
      this.nb = Solver.buildNeighbors(rows, cols, this.topology);          // neighbour indexes per cell
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
      this.moves = [];                                // log of moves [type, r, c] for replays; type r/c/f/q/s
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

    // ---- Undo ----
    // A snapshot is a deep copy of everything that can change.
    _snapshot() {
      return { cells: this.cells.map(row => row.map(cell => ({ ...cell }))), status: this.status,
               minesPlaced: this.minesPlaced, exploded: this.exploded && { ...this.exploded },
               lives: this.lives, scanner: this.scanner, shield: this.shield, scans: this.scans.map(s => ({ ...s })),
               current: this.current, scores: [...this.scores], moveCount: this.moveCount };
    }
    _restore(s) { Object.assign(this, s); }

    // Remember the state for undo, drop any redo, and note the move for the replay log.
    _begin(snap, type, r, c) {
      this.history.push(snap);
      this.redoStack = [];                    // a new move invalidates redo
      this.moves.length = this.moveCount;     // (a move after an undo replaces the undone ones)
      this.moves.push([type, r, c]);
      this.moveCount++;
    }

    // ---- Moves ----
    // Left click on a hidden cell. Returns true if the game state changed.
    reveal(r, c) {
      if (this.status !== 'playing') return false;
      const cell = this.cells[r][c];
      if (cell.revealed || cell.flagged) return false; // ignored clicks are not undoable moves
      const snap = this._snapshot();          // taken BEFORE placing mines, so undoing move 1 un-places them
      if (!this.minesPlaced) this.placeMines(r, c);
      this._begin(snap, 'r', r, c);           // one entry per click, however many cells open
      this._endMove(this._openCell(r, c));
      return true;
    }

    // Chord: click a revealed number whose flag count equals its number -> open all its unflagged neighbours.
    // Wrong flags can open a mine, which costs a life or loses (standard rules). One undo step for the whole chord.
    chord(r, c) {
      if (this.status !== 'playing') return false;
      const cell = this.cells[r][c];
      if (!cell.revealed || cell.adjacent === 0) return false;
      const around = this.neighbors(r, c);
      if (around.filter(([y, x]) => this.cells[y][x].flagged).length !== cell.adjacent) return false;
      const targets = around.filter(([y, x]) => !this.cells[y][x].revealed && !this.cells[y][x].flagged);
      if (targets.length === 0) return false;
      this._begin(this._snapshot(), 'c', r, c);
      let gained = 0;
      for (const [y, x] of targets) gained += this._openCell(y, x);
      this._endMove(gained);
      return true;
    }

    // Open one cell (no snapshot). A mine is handled by _hitMine; otherwise flood-fill. Returns cells newly revealed.
    _openCell(r, c) {
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
    _endMove(gained) {
      this.scores[this.current] += gained;
      if (this.status === 'playing' && this._allSafeRevealed()) {
        this.status = 'won';
        for (const row of this.cells) for (const k of row) if (k.mine && !k.revealed) { k.flagged = true; k.question = false; }
      }
      if (this.players === 2 && this.status === 'playing') this.current = 1 - this.current;
    }

    // Right click: hidden -> flag -> (with question marks) "?" -> hidden. Without question marks it just toggles the flag.
    // Marking is an undoable move but does not pass the turn.
    mark(r, c, question = false) {
      if (this.status !== 'playing') return false;
      const cell = this.cells[r][c];
      if (cell.revealed) return false;
      this._begin(this._snapshot(), question ? 'q' : 'f', r, c);
      if (!cell.flagged && !cell.question) cell.flagged = true;
      else if (cell.flagged) { cell.flagged = false; cell.question = question; }
      else cell.question = false;
      return true;
    }
    toggleFlag(r, c) { return this.mark(r, c, false); }

    // Scanner power-up: count the mines in the cell and its neighbours (the 3x3 area; 7 cells on a hex board).
    scan(r, c) {
      if (this.status !== 'playing' || !this.powerups || this.scanner <= 0 || !this.minesPlaced) return false;
      if (this.scans.some(s => s.r === r && s.c === c)) return false;
      this._begin(this._snapshot(), 's', r, c);
      this.scanner--;
      const n = (this.cells[r][c].mine ? 1 : 0) + this.neighbors(r, c).filter(([y, x]) => this.cells[y][x].mine).length;
      this.scans.push({ r, c, n });
      return true;
    }

    // Hint: a hidden cell that is certainly safe, worked out only from what the player can see (the open numbers).
    // Returns {r, c} or null. Not a move: it does not change the board, only counts as a hint used.
    hint() {
      if (this.status !== 'playing' || !this.minesPlaced) return null;
      const flat = this.cells.flat();
      const revealed = flat.map(c => (c.revealed && !c.mine ? 1 : 0)), num = flat.map(c => c.adjacent);
      const knownMine = flat.map(c => (c.revealed && c.mine ? 1 : 0)); // mines already hit in lives mode
      const i = Solver.hint(this.nb, revealed, num, knownMine);
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
      this.redoStack.push(this._snapshot());
      this._restore(this.history.pop());
      this.undoCount++;
      if (this.undosLeft !== null) this.undosLeft--;
      return true;
    }
    // Redo: mirror image of undo (free).
    redo() {
      if (!this.canRedo()) return false;
      this.history.push(this._snapshot());
      this._restore(this.redoStack.pop());
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
      for (const [type, r, c] of this.moves.slice(0, this.moveCount)) {
        if (type === 'r') g.reveal(r, c); else if (type === 'c') g.chord(r, c);
        else if (type === 'f') g.mark(r, c, false); else if (type === 'q') g.mark(r, c, true); else if (type === 's') g.scan(r, c);
        frames.push(frame());
      }
      if (this.status === 'timeout') { g.status = 'timeout'; frames.push(frame()); }
      return frames;
    }

    // ---- Save / load ----
    // Compact JSON form: a board is one string, one character per cell (bits: 1 mine, 2 revealed, 4 flagged, 8 question,
    // adjacent << 4), so even a long undo history stays small.
    serialize() {
      const enc = cells => cells.flat().map(c => String.fromCharCode(48 +
        ((c.mine ? 1 : 0) | (c.revealed ? 2 : 0) | (c.flagged ? 4 : 0) | (c.question ? 8 : 0) | (c.adjacent << 4)))).join('');
      const snap = s => ({ cells: enc(s.cells), status: s.status, minesPlaced: s.minesPlaced, exploded: s.exploded,
                           lives: s.lives, scanner: s.scanner, shield: s.shield, scans: s.scans, current: s.current,
                           scores: s.scores, moveCount: s.moveCount });
      return { fmt: 2, rows: this.rows, cols: this.cols, mines: this.mineCount, topology: this.topology, lives0: this.initialLives,
               powerups: this.powerups, undoLimit: this.undoLimit, players: this.players, noGuess: this.noGuess,
               guessFree: this.guessFree, seed: this.seed, undoCount: this.undoCount, undosLeft: this.undosLeft,
               hintsUsed: this.hintsUsed, moves: this.moves, ...snap(this),
               history: this.history.map(snap), redo: this.redoStack.map(snap) };
    }

    // Rebuild a Game from serialize() output (older saves without `fmt` still load). The input may come from an uploaded
    // file, so everything is checked (sizes, characters, mine count, every number against its neighbours, status,
    // counters); returns null if anything is off.
    static deserialize(d, rng = Math.random) {
      const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
      const bool = v => typeof v === 'boolean';
      const nullOr = (v, f) => v === null || f(v);
      if (!d || typeof d !== 'object' || !int(d.rows, 1, 50) || !int(d.cols, 1, 50) || !int(d.mines, 1, d.rows * d.cols - 1)) return null;
      if (!Array.isArray(d.history) || !Array.isArray(d.redo) || d.history.length > 5000 || d.redo.length > 5000) return null;
      const v2 = d.fmt === 2;
      if (d.fmt !== undefined && !v2) return null;
      const cfg = v2 ? d : { topology: 'square', lives0: null, powerups: false, undoLimit: null, players: 1, noGuess: false,
                             guessFree: true, seed: 0, undoCount: 0, undosLeft: null, hintsUsed: 0, moves: [] };
      if (!TOPOLOGIES.includes(cfg.topology) || !nullOr(cfg.lives0, v => int(v, 1, 9)) || !bool(cfg.powerups) ||
          !nullOr(cfg.undoLimit, v => int(v, 0, 99)) || !int(cfg.players, 1, 2) || !bool(cfg.noGuess) || !bool(cfg.guessFree) ||
          !int(cfg.seed, 0, 2147483647) || !int(cfg.undoCount, 0, 100000) || !nullOr(cfg.undosLeft, v => int(v, 0, 99)) ||
          (cfg.undoLimit === null) !== (cfg.undosLeft === null) || !int(cfg.hintsUsed, 0, 100000)) return null;
      if (!Array.isArray(cfg.moves) || cfg.moves.length > 5000 ||
          !cfg.moves.every(m => Array.isArray(m) && m.length === 3 && 'rcfqs'.includes(m[0]) && m[0].length === 1 &&
                                int(m[1], 0, d.rows - 1) && int(m[2], 0, d.cols - 1))) return null;
      const g = new Game(d.rows, d.cols, d.mines, rng, { topology: cfg.topology, lives: cfg.lives0, powerups: cfg.powerups,
                         undoLimit: cfg.undoLimit, players: cfg.players, noGuess: cfg.noGuess, seed: cfg.seed });
      const shift = v2 ? 4 : 3; // old saves had 3 flag bits and no question mark

      const decode = p => {
        if (!p || typeof p !== 'object' || typeof p.cells !== 'string' || p.cells.length !== d.rows * d.cols) return null;
        if (!STATUSES.includes(p.status) || !bool(p.minesPlaced)) return null;
        let exploded = null;
        if (p.exploded !== null) {
          if (!p.exploded || !int(p.exploded.r, 0, d.rows - 1) || !int(p.exploded.c, 0, d.cols - 1)) return null;
          exploded = { r: p.exploded.r, c: p.exploded.c };
        }
        const x = v2 ? p : { lives: null, scanner: 0, shield: 0, scans: [], current: 0, scores: [0, 0], moveCount: 0 };
        if (!(cfg.lives0 === null ? x.lives === null : int(x.lives, 0, cfg.lives0))) return null;
        if (!int(x.scanner, 0, cfg.powerups ? 3 : 0) || !int(x.shield, 0, cfg.powerups ? 1 : 0)) return null;
        if (!Array.isArray(x.scans) || x.scans.length > 100 ||
            !x.scans.every(s => s && int(s.r, 0, d.rows - 1) && int(s.c, 0, d.cols - 1) && int(s.n, 0, 9))) return null;
        if (!int(x.current, 0, cfg.players - 1) || !Array.isArray(x.scores) || x.scores.length !== 2 ||
            !x.scores.every(v => int(v, 0, 100000)) || !int(x.moveCount, 0, cfg.moves.length)) return null;
        const cells = [];
        let mines = 0, revealedSafe = 0, anyRevealed = false;
        for (let r = 0; r < d.rows; r++) {
          const row = [];
          for (let c = 0; c < d.cols; c++) {
            const code = p.cells.charCodeAt(r * d.cols + c) - 48;
            if (!(code >= 0 && code < (9 << shift))) return null; // adjacent is at most 8
            const cell = { mine: !!(code & 1), revealed: !!(code & 2), flagged: !!(code & 4),
                           question: v2 && !!(code & 8), adjacent: code >> shift };
            if ((cell.flagged && cell.question) || (cell.revealed && (cell.flagged || cell.question))) return null;
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
        return { cells, status: p.status, minesPlaced: p.minesPlaced, exploded, lives: x.lives, scanner: x.scanner,
                 shield: x.shield, scans: x.scans.map(s => ({ r: s.r, c: s.c, n: s.n })), current: x.current,
                 scores: [...x.scores], moveCount: x.moveCount };
      };
      const cur = decode(d), history = d.history.map(decode), redo = d.redo.map(decode);
      if (!cur || history.includes(null) || redo.includes(null)) return null;
      Object.assign(g, cur, { history, redoStack: redo, guessFree: cfg.guessFree, undoCount: cfg.undoCount,
                              undosLeft: cfg.undosLeft, hintsUsed: cfg.hintsUsed, moves: cfg.moves.map(m => [m[0], m[1], m[2]]) });
      return g;
    }
  }

  if (typeof module !== 'undefined') module.exports = { Game }; else root.Game = Game;
})(this);
