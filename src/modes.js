// Game modes as STRATEGY objects. Everything that differs between modes lives in one small class per mode: how the Game
// is configured, how the clock behaves, what an undo costs, what the status line says, whether wins are recorded.
// The ViewModel just asks the current mode; it has no "if (mode === 'lives')" branches.
(function (root) {
  const UNDO_PENALTY = 10;   // seconds added per undo in "undo costs time" mode

  class GameMode {
    constructor(id, label, description) { this.id = id; this.label = label; this.description = description; }
    gameOptions() { return {}; }                       // extra Game options: lives, undoLimit, players
    timeLimit(game) { return null; }                   // seconds, or null for no countdown
    get usesClock() { return true; }                   // does the clock run (and count in 3BV/s)?
    get undoPenalty() { return 0; }                    // seconds added to the clock by each undo
    get recordsBestTimes() { return false; }           // may a win go into the best-times table?
    get allowsHints() { return true; }                 // hints, best guess, auto-flag, flag check
    get showsMineCounter() { return true; }
    get isAi() { return false; }                       // is player 2 the computer?
    get isSurvival() { return false; }
    get isPuzzle() { return false; }
    timeText(elapsed, game) {
      const limit = this.timeLimit(game);
      return String(limit === null ? elapsed : Math.max(0, limit - elapsed));
    }
    clockExpired(elapsed, game) { const limit = this.timeLimit(game); return limit !== null && elapsed >= limit; }
    statusParts(game) { return []; }                   // extra pieces of the status line while playing
    // The status line when the game is over.
    outcomeText(status, game) {
      if (status === 'won') return '🎉 You won!';
      if (status === 'timeout') return '⏱ Time is up! You lost.';
      return '💥 Boom! You lost.' + (game.canUndo() ? ' Press Undo to take it back.' : '');
    }
    resultTitle(status, game) { return { won: 'You won!', lost: 'Boom!', timeout: "Time's up!" }[status]; }
    // What the win/lose overlay says under the title (the title already says what happened).
    resultDetail(status, game, notice) {
      if (status === 'won') return notice || 'Nicely done!';
      return status === 'lost' && game.canUndo() ? 'Press Undo to take it back.' : 'Start a new game to try again.';
    }
  }

  class ClassicMode extends GameMode {
    constructor() { super('classic', 'Classic', 'The usual rules. The clock counts up and fast wins go in the best-times table.'); }
    get recordsBestTimes() { return true; }
  }

  class LivesMode extends GameMode {
    constructor() { super('lives', 'Lives (3)', 'A mine costs one of three lives instead of ending the game.'); }
    gameOptions() { return { lives: 3 }; }
    statusParts(game) { return ['Lives: ' + '❤️'.repeat(game.lives)]; }
    outcomeText(status, game) {
      return status === 'lost' ? '💥 Boom! Out of lives.' + (game.canUndo() ? ' Press Undo to take it back.' : '') : super.outcomeText(status, game);
    }
  }

  class UndoLimitMode extends GameMode {
    constructor() { super('undolimit', 'Limited undo (3)', 'You start with three undos and earn one more for every 20 safe cells you open.'); }
    gameOptions() { return { undoLimit: 3, undoEarnEvery: 20 }; }
    statusParts(game) { return ['Undos left: ' + game.undosLeft + ' (+1 for every 20 safe cells opened)']; }
  }

  class UndoPenaltyMode extends GameMode {
    constructor() { super('undopenalty', 'Undo costs 10 s', 'Undo is unlimited, but every undo adds ten seconds to your time.'); }
    get undoPenalty() { return UNDO_PENALTY; }
    statusParts() { return [`Each undo costs ${UNDO_PENALTY} s`]; }
  }

  class TimeAttackMode extends GameMode {
    constructor() { super('timeattack', 'Time attack', 'Beat a countdown of 1.5 seconds per cell. When it hits zero you lose.'); }
    timeLimit(game) { return Math.round(game.rows * game.cols * 1.5); }
    statusParts() { return ['Time attack: beat the clock']; }
  }

  class ZenMode extends GameMode {
    constructor() { super('zen', 'Zen (no timer)', 'No clock and nothing recorded. Just play.'); }
    get usesClock() { return false; }
    timeText() { return '–'; }
    statusParts() { return ['Zen mode: no clock, no records']; }
  }

  class TwoPlayerMode extends GameMode {
    constructor() { super('twoplayer', 'Two players (hot-seat)', 'Take turns revealing cells and score points. Whoever opens a mine loses.'); }
    gameOptions() { return { players: 2 }; }
    statusParts(game) { return [`Player ${game.current + 1}'s turn (scores ${game.scores[0]} : ${game.scores[1]})`]; }
    outcomeText(status, game) {
      if (status === 'won') {
        const [a, b] = game.scores;
        return a === b ? `🎉 Board cleared! It's a draw, ${a} each.` : `🎉 Board cleared! Player ${a > b ? 1 : 2} wins, ${Math.max(a, b)} to ${Math.min(a, b)}.`;
      }
      if (status === 'lost') return `💥 Boom! Player ${game.current + 1} hit a mine, so Player ${2 - game.current} wins.`;
      return super.outcomeText(status, game);
    }
    resultTitle(status, game) { return status === 'won' ? 'Board cleared!' : super.resultTitle(status, game); }
    resultDetail(status, game) { return this.outcomeText(status, game); }
  }

  // Two players, but player 2 is the computer. It takes any move the solver can prove safe; when there is none it guesses
  // the cell with the lowest mine chance. (The moves are made by the ViewModel, see ai.js.)
  class AiOpponentMode extends TwoPlayerMode {
    constructor() { super(); this.id = 'ai'; this.label = 'Versus the computer'; this.description = 'Take turns with the computer. It plays safe moves, and guesses when it is stuck. Whoever opens a mine loses.'; }
    get isAi() { return true; }
    statusParts(game) { return [game.current === 0 ? 'Your turn' : "The computer's turn", `scores: you ${game.scores[0]}, computer ${game.scores[1]}`]; }
    outcomeText(status, game) {
      const who = i => (i === 0 ? 'You' : 'The computer');
      if (status === 'won') {
        const [a, b] = game.scores;
        return a === b ? `🎉 Board cleared! A draw, ${a} each.` : `🎉 Board cleared! ${a > b ? 'You win' : 'The computer wins'}, ${Math.max(a, b)} to ${Math.min(a, b)}.`;
      }
      if (status === 'lost') return `💥 Boom! ${who(game.current)} hit a mine, so ${game.current === 0 ? 'the computer wins' : 'you win'}.`;
      return super.outcomeText(status, game);
    }
  }

  // Survival: clear a board and the next one comes, bigger and denser. Lives carry over; the run ends when they run out.
  const SURVIVAL_BOARDS = [[9, 9, 10], [12, 12, 22], [16, 16, 40], [16, 22, 62], [16, 30, 99]]; // rows, cols, mines
  class SurvivalMode extends GameMode {
    constructor() { super('survival', 'Survival', 'Clear a board to get the next one: bigger and denser. Your lives carry over and the run ends when they run out.'); }
    get isSurvival() { return true; }
    gameOptions() { return { lives: 3 }; }
    boardFor(stage) {
      if (stage <= SURVIVAL_BOARDS.length) return SURVIVAL_BOARDS[stage - 1];
      const rows = Math.min(16 + 2 * (stage - 5), 30), cols = Math.min(30 + 2 * (stage - 5), 40);
      return [rows, cols, Math.min(Math.round(rows * cols * 0.22), rows * cols - 9)];
    }
    statusParts(game) { return [`Survival: board ${game.stage}`, 'Lives: ' + '❤️'.repeat(game.lives)]; }
    outcomeText(status, game) { return status === 'lost' ? `💥 Run over: you cleared ${game.stage - 1} ${game.stage === 2 ? 'board' : 'boards'}.` : super.outcomeText(status, game); }
    resultTitle(status, game) { return status === 'lost' ? 'Run over' : super.resultTitle(status, game); }
    resultDetail(status, game, notice) { return status === 'lost' ? `You cleared ${game.stage - 1} ${game.stage === 2 ? 'board' : 'boards'}.` : super.resultDetail(status, game, notice); }
  }

  // Puzzle: a hand-picked board, solved by logic alone, with a limit on the moves (see puzzles.js).
  class PuzzleMode extends GameMode {
    constructor() { super('puzzle', 'Puzzle', 'Solve a hand-picked board by logic alone, within a limit on the number of moves. No hints.'); }
    get isPuzzle() { return true; }
    get allowsHints() { return false; }
    statusParts(game) { return [`Puzzle: ${game.moveLimit - game.movesUsed()} moves left`]; }
    outcomeText(status, game) {
      if (status === 'lost' && !game.exploded) return '⛔ Out of moves.' + (game.canUndo() ? ' Press Undo to try another way.' : '');
      return super.outcomeText(status, game);
    }
    resultTitle(status, game) { return status === 'lost' && !game.exploded ? 'Out of moves' : super.resultTitle(status, game); }
    resultDetail(status, game, notice) { return status === 'won' ? (notice || 'Solved by logic!') : super.resultDetail(status, game, notice); }
  }

  // Hidden mine counter: no counter and no hints.
  class BlindMode extends GameMode {
    constructor() { super('blind', 'Hidden mine counter', 'A harder game: the mine counter is hidden and there are no hints.'); }
    get showsMineCounter() { return false; }
    get allowsHints() { return false; }
    statusParts() { return ['Mine counter hidden, no hints']; }
  }

  // Shifting mines: every few moves one unflagged mine moves (undo puts it back).
  class ShiftingMode extends GameMode {
    constructor() { super('shifting', 'Shifting mines', 'Every 5 moves one unflagged mine moves somewhere else (never next to an open number). Undo puts it back.'); }
    gameOptions() { return { shiftEvery: 5 }; }
    statusParts(game) {
      const used = game.movesUsed(), next = 5 - (used % 5);
      return [game.shiftedAt === game.moveCount && game.moveCount > 0 ? 'A mine just moved!' : `A mine moves in ${next} ${next === 1 ? 'move' : 'moves'}`];
    }
  }

  const list = [new ClassicMode(), new LivesMode(), new UndoLimitMode(), new UndoPenaltyMode(), new TimeAttackMode(), new ZenMode(), new TwoPlayerMode(),
                new AiOpponentMode(), new SurvivalMode(), new PuzzleMode(), new BlindMode(), new ShiftingMode()];
  const Modes = {
    list,
    ids: list.map(m => m.id),
    get: id => list.find(m => m.id === id) || list[0],
    has: id => list.some(m => m.id === id),
    UNDO_PENALTY,
  };
  if (typeof module !== 'undefined') module.exports = Modes; else root.Modes = Modes;
})(this);
