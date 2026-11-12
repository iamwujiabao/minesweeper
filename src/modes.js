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
    constructor() { super('undolimit', 'Limited undo (3)', 'You get only three undos in the whole game.'); }
    gameOptions() { return { undoLimit: 3 }; }
    statusParts(game) { return ['Undos left: ' + game.undosLeft]; }
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

  const list = [new ClassicMode(), new LivesMode(), new UndoLimitMode(), new UndoPenaltyMode(), new TimeAttackMode(), new ZenMode(), new TwoPlayerMode()];
  const Modes = {
    list,
    ids: list.map(m => m.id),
    get: id => list.find(m => m.id === id) || list[0],
    has: id => list.some(m => m.id === id),
    UNDO_PENALTY,
  };
  if (typeof module !== 'undefined') module.exports = Modes; else root.Modes = Modes;
})(this);
