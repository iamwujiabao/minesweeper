// Per-game missions and the weekly challenge rule.
(function (root) {
  const Rng = typeof module !== 'undefined' ? require('./rng.js') : root.Rng;

  // ctx describes the finished game: {won, level, mode, time, bv, clicks (moves that open cells), markMoves, chordMoves,
  // undos, hints, livesLost, players}. applies(mode, level) says whether the mission can be offered in that game.
  const clockModes = m => m.usesClock && m.timeLimit({ rows: 9, cols: 9 }) === null;
  const MISSIONS = [
    { id: 'no-flags', text: 'Win without placing a flag', applies: () => true, check: x => x.won && x.markMoves === 0 },
    { id: 'no-chords', text: 'Win without chording', applies: () => true, check: x => x.won && x.chordMoves === 0 },
    { id: 'no-undo', text: 'Win without using undo', applies: () => true, check: x => x.won && x.undos === 0 },
    { id: 'no-hints', text: 'Win without any hint', applies: m => m.allowsHints, check: x => x.won && x.hints === 0 },
    { id: 'fast', text: 'Win quickly (Beginner 60 s, Intermediate 180 s, Expert 480 s, custom 150 s)', applies: clockModes,
      check: x => x.won && x.time > 0 && x.time <= ({ beginner: 60, intermediate: 180, expert: 480 }[x.level] || 150) },
    { id: 'few-clicks', text: 'Win with very few clicks (the board\'s 3BV plus 10, or fewer)', applies: () => true, check: x => x.won && x.clicks <= x.bv + 10 },
    { id: 'no-life-lost', text: 'Win without losing a life', applies: (m, g) => g.lives, check: x => x.won && x.livesLost === 0 },
  ];

  // game: {lives: bool} (is it a lives-based game?). Picks one applicable mission using rng, or null (two-player, puzzles).
  function pickMission(mode, level, game, rng) {
    if (mode.id === 'twoplayer' || mode.isAi || mode.isPuzzle || mode.isSurvival) return null;
    const pool = MISSIONS.filter(m => m.applies(mode, game));
    return pool.length ? pool[Math.floor(rng() * pool.length)].id : null;
  }
  const missionText = id => (MISSIONS.find(m => m.id === id) || {}).text || '';
  const missionDone = (id, ctx) => { const m = MISSIONS.find(x => x.id === id); return !!m && m.check(ctx); };

  // The weekly challenge: the same seed, mode, board shape and size for everybody for a whole week.
  const WEEKLY_RULES = [
    { mode: 'lives', board: 'hex', level: 'intermediate' }, { mode: 'timeattack', board: 'square', level: 'beginner' },
    { mode: 'undolimit', board: 'torus', level: 'intermediate' }, { mode: 'shifting', board: 'square', level: 'beginner' },
    { mode: 'blind', board: 'square', level: 'intermediate' }, { mode: 'lives', board: 'torus', level: 'beginner' },
    { mode: 'zen', board: 'hex', level: 'beginner' },
  ];
  const weeklyRule = id => WEEKLY_RULES[Rng.weeklySeed(id) % WEEKLY_RULES.length];

  const api = { MISSIONS, pickMission, missionText, missionDone, weeklyRule, WEEKLY_RULES };
  if (typeof module !== 'undefined') module.exports = api; else root.Challenges = api;
})(this);
