// Moves as COMMAND objects. Each command knows how to perform itself on a Game (execute) and how to be written down
// (toJSON). The game keeps the commands it has run, so a replay is simply "run the same commands again on a fresh
// board", and a saved game stores them as [type, row, col] triples.
//   r = reveal   c = chord   f = flag (toggle)   q = flag / question-mark / clear cycle   s = scanner
// Commands work through the Game's move primitives: createMemento / record (undo support), openCell, endMove.
(function (root) {
  class Command {
    constructor(r, c) { this.r = r; this.c = c; }
    toJSON() { return [this.type, this.r, this.c]; }
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

  const TYPES = 'rcfqs';
  // [type, row, col] -> Command (or null if the triple is not a move).
  function fromJSON(triple) {
    if (!Array.isArray(triple) || triple.length !== 3 || typeof triple[0] !== 'string' || triple[0].length !== 1 || !TYPES.includes(triple[0])) return null;
    const [type, r, c] = triple;
    if (type === 'r') return new RevealCommand(r, c);
    if (type === 'c') return new ChordCommand(r, c);
    if (type === 's') return new ScanCommand(r, c);
    return new MarkCommand(r, c, type === 'q');
  }

  const api = { Command, RevealCommand, ChordCommand, MarkCommand, ScanCommand, fromJSON };
  if (typeof module !== 'undefined') module.exports = api; else root.Commands = api;
})(this);
