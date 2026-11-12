// Saving and loading a Game as plain JSON (so it can go in localStorage or a downloaded file).
// A board is one string, one character per cell (bits: 1 mine, 2 revealed, 4 flagged, 8 question, adjacent << 4), so even
// a long undo history stays small. Moves are the commands' [type, row, col] triples.
(function (root) {
  const dep = (name, global) => (typeof module !== 'undefined' ? require(name) : root[global]);
  const Game = typeof module !== 'undefined' ? require('./game.js').Game : root.Game;
  const Commands = dep('./commands.js', 'Commands'), Topology = dep('./topology.js', 'Topology');
  const STATUSES = ['playing', 'won', 'lost', 'timeout'];

  // maxHistory (optional): keep only the newest n undo (and redo) mementos, to bound the size of an autosave.
  function serialize(game, { maxHistory = Infinity } = {}) {
    const enc = cells => cells.flat().map(c => String.fromCharCode(48 +
      ((c.mine ? 1 : 0) | (c.revealed ? 2 : 0) | (c.flagged ? 4 : 0) | (c.question ? 8 : 0) | (c.adjacent << 4)))).join('');
    const snap = s => ({ cells: enc(s.cells), status: s.status, minesPlaced: s.minesPlaced, exploded: s.exploded,
                         lives: s.lives, scanner: s.scanner, shield: s.shield, scans: s.scans, current: s.current,
                         scores: s.scores, moveCount: s.moveCount });
    const newest = list => (list.length > maxHistory ? list.slice(list.length - maxHistory) : list);
    return { fmt: 2, rows: game.rows, cols: game.cols, mines: game.mineCount, topology: game.topology, lives0: game.initialLives,
             powerups: game.powerups, undoLimit: game.undoLimit, players: game.players, noGuess: game.noGuess,
             guessFree: game.guessFree, seed: game.seed, undoCount: game.undoCount, undosLeft: game.undosLeft,
             hintsUsed: game.hintsUsed, moves: game.moves.map(m => m.toJSON()), ...snap(game),
             history: newest(game.history).map(snap), redo: newest(game.redoStack).map(snap) };
  }

  // Rebuild a Game from serialize() output (older saves without `fmt` still load). The input may come from an uploaded
  // file, so everything is checked (sizes, characters, mine count, every number against its neighbours, status,
  // counters); returns null if anything is off.
  function deserialize(d, rng = Math.random) {
    const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    const bool = v => typeof v === 'boolean';
    const nullOr = (v, f) => v === null || f(v);
    if (!d || typeof d !== 'object' || !int(d.rows, 1, 50) || !int(d.cols, 1, 50) || !int(d.mines, 1, d.rows * d.cols - 1)) return null;
    if (!Array.isArray(d.history) || !Array.isArray(d.redo) || d.history.length > 5000 || d.redo.length > 5000) return null;
    const v2 = d.fmt === 2;
    if (d.fmt !== undefined && !v2) return null;
    const cfg = v2 ? d : { topology: 'square', lives0: null, powerups: false, undoLimit: null, players: 1, noGuess: false,
                           guessFree: true, seed: 0, undoCount: 0, undosLeft: null, hintsUsed: 0, moves: [] };
    if (!Topology.ids.includes(cfg.topology) || !nullOr(cfg.lives0, v => int(v, 1, 9)) || !bool(cfg.powerups) ||
        !nullOr(cfg.undoLimit, v => int(v, 0, 99)) || !int(cfg.players, 1, 2) || !bool(cfg.noGuess) || !bool(cfg.guessFree) ||
        !int(cfg.seed, 0, 2147483647) || !int(cfg.undoCount, 0, 100000) || !nullOr(cfg.undosLeft, v => int(v, 0, 99)) ||
        (cfg.undoLimit === null) !== (cfg.undosLeft === null) || !int(cfg.hintsUsed, 0, 100000)) return null;
    if (!Array.isArray(cfg.moves) || cfg.moves.length > 5000) return null;
    const moves = cfg.moves.map(Commands.fromJSON);
    if (moves.some(m => !m || !int(m.r, 0, d.rows - 1) || !int(m.c, 0, d.cols - 1))) return null;
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
          !x.scores.every(v => int(v, 0, 100000)) || !int(x.moveCount, 0, moves.length)) return null;
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
                            undosLeft: cfg.undosLeft, hintsUsed: cfg.hintsUsed, moves });
    return g;
  }

  const api = { serialize, deserialize };
  if (typeof module !== 'undefined') module.exports = api; else root.Serializer = api;
})(this);
