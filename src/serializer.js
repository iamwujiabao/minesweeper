// Saving and loading a Game as plain JSON (so it can go in localStorage or a downloaded file).
// A board is one string, one character per cell (bits: 1 mine, 2 revealed, 4 flagged, 8 question, adjacent << 4), so even
// a long undo history stays small. Moves are the commands' [type, row, col] triples.
(function (root) {
  const dep = (name, global) => (typeof module !== 'undefined' ? require(name) : root[global]);
  const Game = typeof module !== 'undefined' ? require('./game.js').Game : root.Game;
  const Commands = dep('./commands.js', 'Commands'), Topology = dep('./topology.js', 'Topology'), Puzzles = dep('./puzzles.js', 'Puzzles');
  const STATUSES = ['playing', 'won', 'lost', 'timeout'];

  // maxHistory (optional): keep only the newest n undo (and redo) mementos, to bound the size of an autosave.
  function serialize(game, { maxHistory = Infinity } = {}) {
    const enc = cells => cells.flat().map(c => String.fromCharCode(48 +
      ((c.mine ? 1 : 0) | (c.revealed ? 2 : 0) | (c.flagged ? 4 : 0) | (c.question ? 8 : 0) | (c.adjacent << 4)))).join('');
    const snap = s => ({ cells: enc(s.cells), status: s.status, minesPlaced: s.minesPlaced, exploded: s.exploded,
                         lives: s.lives, scanner: s.scanner, shield: s.shield, scans: s.scans, current: s.current,
                         scores: s.scores, moveCount: s.moveCount, rowCharges: s.rowCharges, colCharges: s.colCharges, lifeCharges: s.lifeCharges });
    const newest = list => (list.length > maxHistory ? list.slice(list.length - maxHistory) : list);
    return { fmt: 2, rows: game.rows, cols: game.cols, mines: game.mineCount, topology: game.topology, lives0: game.initialLives,
             powerups: game.powerups, undoLimit: game.undoLimit, players: game.players, noGuess: game.noGuess,
             guessFree: game.guessFree, seed: game.seed, undoCount: game.undoCount, undosLeft: game.undosLeft,
             hintsUsed: game.hintsUsed, moves: game.moves.map(m => m.toJSON()), flagChecks: game.flagChecks, earnEvery: game.earnEvery,
             earned: game.earned, shiftEvery: game.shiftEvery, moveLimit: game.moveLimit, puzzleId: game.puzzleId, stage: game.stage,
             bonus: game.bonus, baseFreeze: game.baseFreeze, freezeCharges: game.freezeCharges, shieldStart: game.shieldStart,
             mines0: game.mines0, ...snap(game),
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
    const defaults = { topology: 'square', lives0: null, powerups: false, undoLimit: null, players: 1, noGuess: false,
                       guessFree: true, seed: 0, undoCount: 0, undosLeft: null, hintsUsed: 0, moves: [], flagChecks: 0, earnEvery: null,
                       earned: 0, shiftEvery: null, moveLimit: null, puzzleId: null, stage: null,
                       bonus: { scanner: 0, shield: 0, row: 0, col: 0, life: 0, freeze: 0 }, baseFreeze: 0, freezeCharges: 0, shieldStart: 0, mines0: null };
    const cfg = { ...defaults, ...(v2 ? d : {}) };            // saves from before a field existed get its default
    if (!Topology.ids.includes(cfg.topology) || !nullOr(cfg.lives0, v => int(v, 1, 9)) || !bool(cfg.powerups) ||
        !nullOr(cfg.undoLimit, v => int(v, 0, 99)) || !int(cfg.players, 1, 2) || !bool(cfg.noGuess) || !bool(cfg.guessFree) ||
        !int(cfg.seed, 0, 2147483647) || !int(cfg.undoCount, 0, 100000) || !nullOr(cfg.undosLeft, v => int(v, 0, 99)) ||
        (cfg.undoLimit === null) !== (cfg.undosLeft === null) || !int(cfg.hintsUsed, 0, 100000)) return null;
    if (!int(cfg.flagChecks, 0, 1) || !nullOr(cfg.earnEvery, v => int(v, 1, 1000)) || !int(cfg.earned, 0, 1000) || !nullOr(cfg.shiftEvery, v => int(v, 1, 1000)) ||
        !nullOr(cfg.moveLimit, v => int(v, 1, 9999)) || !nullOr(cfg.stage, v => int(v, 1, 999)) || !int(cfg.baseFreeze, 0, 9) || !int(cfg.freezeCharges, 0, 99) || !int(cfg.shieldStart, 0, 99)) return null;
    if (cfg.puzzleId !== null && !(typeof cfg.puzzleId === 'string' && Puzzles.has(cfg.puzzleId))) return null;
    const bonus = cfg.bonus;
    if (!bonus || typeof bonus !== 'object' || !['scanner', 'shield', 'row', 'col', 'life', 'freeze'].every(k => int(bonus[k], 0, 99))) return null;
    if (cfg.mines0 !== null && !(Array.isArray(cfg.mines0) && cfg.mines0.length === d.mines && cfg.mines0.every(m => Array.isArray(m) && m.length === 2 && int(m[0], 0, d.rows - 1) && int(m[1], 0, d.cols - 1)) &&
                                  new Set(cfg.mines0.map(m => m[0] * d.cols + m[1])).size === d.mines)) return null;
    if (!Array.isArray(cfg.moves) || cfg.moves.length > 5000) return null;
    const moves = cfg.moves.map(Commands.fromJSON);
    if (moves.some(m => !m || !int(m.r, 0, d.rows - 1) || !int(m.c, 0, d.cols - 1))) return null;
    const g = new Game(d.rows, d.cols, d.mines, rng, { topology: cfg.topology, lives: cfg.lives0, powerups: cfg.powerups,
                       undoLimit: cfg.undoLimit, players: cfg.players, noGuess: cfg.noGuess, seed: cfg.seed, undoEarnEvery: cfg.earnEvery,
                       shiftEvery: cfg.shiftEvery, moveLimit: cfg.moveLimit, stage: cfg.stage, bonus, freezeCharges: cfg.baseFreeze,
                       puzzleId: cfg.puzzleId, puzzle: cfg.puzzleId ? Puzzles.get(cfg.puzzleId) : null });
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
      const SM = { rowCharges: 0, colCharges: 0, lifeCharges: 0, ...x };    // (older saves have no row/column/life charges)
      if (!int(x.scanner, 0, cfg.powerups ? 99 : 0) || !int(x.shield, 0, cfg.powerups ? 99 : 0) || !int(SM.rowCharges, 0, cfg.powerups ? 99 : 0) ||
          !int(SM.colCharges, 0, cfg.powerups ? 99 : 0) || !int(SM.lifeCharges, 0, cfg.powerups && cfg.lives0 !== null ? 99 : 0)) return null;
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
      if (p.status === 'lost' && !exploded && cfg.moveLimit === null) return null;     // (a puzzle can be lost by running out of moves)
      if (p.status === 'won' && revealedSafe !== d.rows * d.cols - d.mines) return null;
      return { cells, status: p.status, minesPlaced: p.minesPlaced, exploded, lives: x.lives, scanner: x.scanner,
               shield: x.shield, scans: x.scans.map(s => ({ r: s.r, c: s.c, n: s.n })), current: x.current,
               scores: [...x.scores], moveCount: x.moveCount, rowCharges: SM.rowCharges, colCharges: SM.colCharges, lifeCharges: SM.lifeCharges };
    };
    const cur = decode(d), history = d.history.map(decode), redo = d.redo.map(decode);
    if (!cur || history.includes(null) || redo.includes(null)) return null;
    Object.assign(g, cur, { history, redoStack: redo, guessFree: cfg.guessFree, undoCount: cfg.undoCount,
                            undosLeft: cfg.undosLeft, hintsUsed: cfg.hintsUsed, moves, flagChecks: cfg.flagChecks, earned: cfg.earned,
                            freezeCharges: cfg.freezeCharges, shieldStart: cfg.shieldStart, mines0: cfg.mines0 || g.mines0 });
    if (!g.mines0) { g.mines0 = []; g.cells.forEach((row, r) => row.forEach((cell, c) => { if (cell.mine) g.mines0.push([r, c]); })); if (!g.mines0.length) g.mines0 = null; }
    return g;
  }

  const api = { serialize, deserialize };
  if (typeof module !== 'undefined') module.exports = api; else root.Serializer = api;
})(this);
