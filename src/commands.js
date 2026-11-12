// Moves as COMMAND objects. Each command knows how to perform itself on a Game (execute) and how to be written down
// (toJSON). The game keeps the commands it has run, so a replay is simply "run the same commands again on a fresh
// board", and a saved game stores them as [type, row, col] triples.
//   r = reveal   c = chord   f = flag (toggle)   q = flag / question-mark / clear cycle   s = scanner
//   a = auto-flag proven mines   w = reveal a row   v = reveal a column   e = extra life
// Commands work through the Game's move primitives: createMemento / record (undo support), openCell, endMove.
(function (root) {
  class Command {
    constructor(r, c) { this.r = r; this.c = c; }
    // `at` (optional) is the clock reading when the move was made; ghost races use it.
    toJSON() { return this.at === undefined ? [this.type, this.r, this.c] : [this.type, this.r, this.c, this.at]; }
  }

  // Left click on a hidden cell. One undo step, however many cells the flood-fill opens.
  class RevealCommand extends Command {
    get type() { return 'r'; }
    execute(game) {
      if (game.status !== 'playing') return false;
      const cell = game.cells[this.r][this.c];
      if (cell.revealed || cell.flagged) return false;        // ignored clicks are not moves
      const memento = game.createMemento();                   // taken BEFORE placing mines, so undoing move 1 un-places them
      if (!game.minesPlaced) game.placeMines(this.r, this.c);
      game.record(memento, this);
      game.endMove(game.openCell(this.r, this.c));
      return true;
    }
  }

  // Click a revealed number whose flag count equals it: open all its unflagged neighbours. Wrong flags can hit a mine.
  class ChordCommand extends Command {
    get type() { return 'c'; }
    execute(game) {
      if (game.status !== 'playing') return false;
      const cell = game.cells[this.r][this.c];
      if (!cell.revealed || cell.adjacent === 0) return false;
      const around = game.neighbors(this.r, this.c);
      if (around.filter(([y, x]) => game.cells[y][x].flagged).length !== cell.adjacent) return false;
      const targets = around.filter(([y, x]) => !game.cells[y][x].revealed && !game.cells[y][x].flagged);
      if (targets.length === 0) return false;
      game.record(game.createMemento(), this);
      let gained = 0;
      for (const [y, x] of targets) gained += game.openCell(y, x);
      game.endMove(gained);
      return true;
    }
  }

  // Right click: hidden -> flag -> (with question marks) "?" -> hidden. Does not pass the turn.
  class MarkCommand extends Command {
    constructor(r, c, question = false) { super(r, c); this.question = question; }
    get type() { return this.question ? 'q' : 'f'; }
    execute(game) {
      if (game.status !== 'playing') return false;
      const cell = game.cells[this.r][this.c];
      if (cell.revealed) return false;
      game.record(game.createMemento(), this);
      if (!cell.flagged && !cell.question) cell.flagged = true;
      else if (cell.flagged) { cell.flagged = false; cell.question = this.question; }
      else cell.question = false;
      return true;
    }
  }

  // Scanner power-up: count the mines in the cell and its neighbours (the 3x3 area; 7 cells on a hex board).
  class ScanCommand extends Command {
    get type() { return 's'; }
    execute(game) {
      if (game.status !== 'playing' || !game.powerups || game.scanner <= 0 || !game.minesPlaced) return false;
      if (game.scans.some(s => s.r === this.r && s.c === this.c)) return false;
      game.record(game.createMemento(), this);
      game.scanner--;
      const n = (game.cells[this.r][this.c].mine ? 1 : 0) + game.neighbors(this.r, this.c).filter(([y, x]) => game.cells[y][x].mine).length;
      game.scans.push({ r: this.r, c: this.c, n });
      return true;
    }
  }

  // Assist: flag every mine that logic can prove from the open numbers. Counts as a hint (so no best-time record).
  class AutoFlagCommand extends Command {
    constructor() { super(0, 0); }
    get type() { return 'a'; }
    execute(game) {
      if (game.status !== 'playing' || !game.minesPlaced) return false;
      const proven = game.provenMines();
      if (!proven.length) return false;
      game.record(game.createMemento(), this);
      for (const { r, c } of proven) { const cell = game.cells[r][c]; cell.flagged = true; cell.question = false; }
      game.hintsUsed++;
      return true;
    }
  }

  // Power-up: open every safe cell in a row (axis 'row') or column (axis 'col'); the mines there get flagged.
  class LineCommand extends Command {
    constructor(r, c, axis) { super(r, c); this.axis = axis; }
    get type() { return this.axis === 'row' ? 'w' : 'v'; }
    execute(game) {
      const row = this.axis === 'row', key = row ? 'rowCharges' : 'colCharges';
      if (game.status !== 'playing' || !game.powerups || game[key] <= 0 || !game.minesPlaced) return false;
      game.record(game.createMemento(), this);
      game[key]--;
      let gained = 0;
      for (let i = 0; i < (row ? game.cols : game.rows); i++) {
        const r = row ? this.r : i, c = row ? i : this.c, cell = game.cells[r][c];
        if (cell.revealed) continue;
        if (cell.mine) { cell.flagged = true; cell.question = false; } else gained += game.openCell(r, c);
      }
      game.endMove(gained);
      return true;
    }
  }

  // Power-up: one more life (lives-based modes only).
  class ExtraLifeCommand extends Command {
    constructor() { super(0, 0); }
    get type() { return 'e'; }
    execute(game) {
      if (game.status !== 'playing' || !game.powerups || game.lives === null || game.lifeCharges <= 0) return false;
      game.record(game.createMemento(), this);
      game.lifeCharges--; game.lives++;
      return true;
    }
  }

  const TYPES = 'rcfqsawve';
  // [type, row, col] or [type, row, col, at] -> Command (or null if it is not a move).
  function fromJSON(triple) {
    if (!Array.isArray(triple) || (triple.length !== 3 && triple.length !== 4) || typeof triple[0] !== 'string' || triple[0].length !== 1 || !TYPES.includes(triple[0])) return null;
    const [type, r, c, at] = triple;
    if (triple.length === 4 && !(Number.isInteger(at) && at >= 0)) return null;
    const cmd = type === 'r' ? new RevealCommand(r, c) : type === 'c' ? new ChordCommand(r, c) : type === 's' ? new ScanCommand(r, c) :
                type === 'a' ? new AutoFlagCommand() : type === 'e' ? new ExtraLifeCommand() :
                type === 'w' ? new LineCommand(r, c, 'row') : type === 'v' ? new LineCommand(r, c, 'col') : new MarkCommand(r, c, type === 'q');
    if (triple.length === 4) cmd.at = at;
    return cmd;
  }

  const api = { Command, RevealCommand, ChordCommand, MarkCommand, ScanCommand, AutoFlagCommand, LineCommand, ExtraLifeCommand, fromJSON };
  if (typeof module !== 'undefined') module.exports = api; else root.Commands = api;
})(this);
