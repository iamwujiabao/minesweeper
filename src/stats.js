// What the game remembers about how you play: statistics, achievement badges, and the best-times table.
// Everything is kept in the injected storage (localStorage in the browser).
(function (root) {
  const Levels = typeof module !== 'undefined' ? require('./levels.js') : root.Levels;
  const TOP = 5;   // best-time rows kept per difficulty
  const emptyCounters = () => ({ played: 0, won: 0, lost: 0, duels: 0, streak: 0, bestStreak: 0, bestBvs: 0, last: null, missions: 0, threeStars: 0, bestSurvival: 0, puzzles: [] });

  // Badges. test(ctx) is run when a game finishes; ctx describes the finished game (see Stats.record).
  const ACHIEVEMENTS = [
    { id: 'first-win', name: 'First win', desc: 'Win any game', test: x => x.won },
    { id: 'expert-no-undo', name: 'No take-backs', desc: 'Win Expert without using undo', test: x => x.won && x.level === 'expert' && x.undos === 0 },
    { id: 'speed-demon', name: 'Speed demon', desc: 'Win Beginner in 30 seconds or less', test: x => x.won && x.level === 'beginner' && x.mode === 'classic' && x.time > 0 && x.time <= 30 },
    { id: 'clean-win', name: 'Clean win', desc: 'Win with no undo and no hint', test: x => x.won && x.undos === 0 && x.hints === 0 },
    { id: 'survivor', name: 'Survivor', desc: 'Win Lives mode with one life left', test: x => x.won && x.mode === 'lives' && x.lives === 1 },
    { id: 'shielded', name: 'Shielded', desc: 'Win a game in which the shield saved you', test: x => x.won && x.shieldUsed },
    { id: 'no-guesser', name: 'Pure logic', desc: 'Win a no-guess board without a hint', test: x => x.won && x.noGuess && x.hints === 0 },
    { id: 'hex-explorer', name: 'Hex explorer', desc: 'Win on a hexagonal board', test: x => x.won && x.topology === 'hex' },
    { id: 'traveller', name: 'World traveller', desc: 'Win on a wrap-around board', test: x => x.won && x.topology === 'torus' },
    { id: 'daily', name: 'Daily winner', desc: 'Win a daily challenge', test: x => x.won && x.daily },
    { id: 'on-a-roll', name: 'On a roll', desc: 'Win 5 games in a row', test: x => x.won && x.streak >= 5 },
    { id: 'beat-the-clock', name: 'Beat the clock', desc: 'Win a time-attack game', test: x => x.won && x.mode === 'timeattack' },
    { id: 'zen-master', name: 'Zen master', desc: 'Win a game in Zen mode', test: x => x.won && x.mode === 'zen' },
    { id: 'duellist', name: 'Duellist', desc: 'Finish a two-player game', test: x => x.players === 2 },
    { id: 'three-stars', name: 'Three stars', desc: 'Win with a three-star rating', test: x => x.won && x.stars === 3 },
    { id: 'mission', name: 'Mission accomplished', desc: 'Complete a game mission', test: x => x.missionDone },
    { id: 'puzzler', name: 'Puzzler', desc: 'Solve a puzzle', test: x => x.won && !!x.puzzle },
    { id: 'puzzle-master', name: 'Puzzle master', desc: 'Solve all five puzzles', test: x => x.puzzlesSolved >= 5 },
    { id: 'blindfolded', name: 'Blindfolded', desc: 'Win with the mine counter hidden', test: x => x.won && x.mode === 'blind' },
    { id: 'beat-the-ai', name: 'Beat the computer', desc: 'Win a game against the computer', test: x => x.vsAiWin },
    { id: 'survivor-5', name: 'Deep survivor', desc: 'Reach board 5 in Survival', test: x => x.survivalStage >= 5 },
    { id: 'shifty', name: 'Shifty', desc: 'Win a Shifting mines game', test: x => x.won && x.mode === 'shifting' },
    { id: 'weekly', name: 'Weekly winner', desc: 'Win a weekly challenge', test: x => x.won && x.weekly },
    { id: 'ghost-buster', name: 'Ghost buster', desc: 'Beat your own ghost', test: x => x.beatGhost },
  ];

  // 1 to 3 stars for a win, from the time per 3BV unit (how fast you cleared the board for how hard it was). null when
  // there was no clock.
  function starsFor(bv, seconds, timed) {
    if (!timed || !(seconds > 0) || !(bv > 0)) return null;
    const perUnit = seconds / bv;
    return perUnit <= 1.2 ? 3 : perUnit <= 2.5 ? 2 : 1;
  }

  class Stats {
    constructor(storage) {
      this.storage = storage;
      this.counters = this._loadCounters();
      this.unlocked = this._loadAchievements();
      this.scores = this._loadScores();
    }

    // ---- Best times: the TOP fastest wins per difficulty ----
    best(level) { const list = this.scores[level]; return list && list.length ? list[0].t : null; }
    recordWin(level, seconds) {
      this.scores = this._loadScores(); // pick up wins recorded meanwhile by another tab
      const list = this.scores[level];
      list.push({ t: seconds, at: Date.now() });
      list.sort((a, b) => a.t - b.t); list.length = Math.min(list.length, TOP);
      this.storage.setItem('ms-scores', JSON.stringify(this.scores));
    }
    clearScores() {
      this.scores = { beginner: [], intermediate: [], expert: [] };
      this.storage.setItem('ms-scores', JSON.stringify(this.scores));
      for (const level of Object.keys(Levels.LEVELS)) this.storage.setItem('ms-best-' + level, 0); // so an old single best doesn't come back
    }
    scoresView() {
      return Object.fromEntries(Object.entries(this.scores).map(([l, list]) => [l, list.map(e => ({ t: e.t, date: e.at ? new Date(e.at).toLocaleDateString() : '' }))]));
    }

    // ---- Statistics and badges ----
    // Called once when a game first finishes. ctx: {won, level, mode (id), topology, noGuess, undos, hints, time, lives,
    // shieldUsed, daily, players, bv (3BV), timed (did a clock run?), eligibleForBest}. Returns a notice such as
    // "Unlocked: First win" (or '').
    record(ctx) {
      const st = this.counters, won = ctx.won;
      this.lastStars = won ? starsFor(ctx.bv, ctx.time, ctx.timed) : null;
      if (this.lastStars === 3) st.threeStars++;
      if (ctx.missionDone) st.missions++;
      if (won && ctx.puzzle && !st.puzzles.includes(ctx.puzzle)) st.puzzles.push(ctx.puzzle);
      if (ctx.survivalStage) st.bestSurvival = Math.max(st.bestSurvival, ctx.survivalStage);
      const bvs = won && ctx.time > 0 && ctx.timed ? Math.round((ctx.bv / ctx.time) * 100) / 100 : null;
      if (ctx.players === 2) st.duels++;           // two-player games do not count as wins or losses
      else {
        st.played++;
        if (won) { st.won++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); } else { st.lost++; st.streak = 0; }
        if (bvs && bvs > st.bestBvs) st.bestBvs = bvs;
        st.last = { bv: ctx.bv, time: ctx.time, bvs, won, stars: this.lastStars };
      }
      this.storage.setItem('ms-stats', JSON.stringify(st));
      if (won && ctx.eligibleForBest && ctx.time > 0) this.recordWin(ctx.level, ctx.time);
      const fresh = ACHIEVEMENTS.filter(a => !this.unlocked[a.id] && a.test({ ...ctx, streak: st.streak, stars: this.lastStars, puzzlesSolved: st.puzzles.length }));
      for (const a of fresh) this.unlocked[a.id] = Date.now();
      if (!fresh.length) return '';
      this.storage.setItem('ms-ach', JSON.stringify(this.unlocked));
      return '🏆 Unlocked: ' + fresh.map(a => a.name).join(', ');
    }
    clearStats() {
      this.counters = emptyCounters(); this.unlocked = {};
      this.storage.setItem('ms-stats', JSON.stringify(this.counters)); this.storage.setItem('ms-ach', '{}');
    }
    rows() {
      const s = this.counters, decided = s.won + s.lost, l = s.last;
      return [['Games played', s.played], ['Won', s.won], ['Lost', s.lost], ['Win rate', decided ? Math.round((s.won / decided) * 100) + '%' : '–'],
              ['Win streak now', s.streak], ['Best win streak', s.bestStreak], ['Best 3BV/s', s.bestBvs || '–'],
              ['Last game 3BV', l ? l.bv : '–'], ['Last game 3BV/s', l && l.bvs ? l.bvs : '–'], ['Two-player games', s.duels],
              ['Three-star wins', s.threeStars], ['Missions completed', s.missions], ['Puzzles solved', s.puzzles.length + ' of 5'], ['Best Survival board', s.bestSurvival || '–']];
    }
    achievementsView() { return ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, desc: a.desc, unlocked: !!this.unlocked[a.id] })); }

    // ---- Loading (corrupt or missing data falls back to empty) ----
    _loadCounters() {
      const base = emptyCounters();
      try {
        const s = JSON.parse(this.storage.getItem('ms-stats'));
        for (const k of ['played', 'won', 'lost', 'duels', 'streak', 'bestStreak']) if (Number.isInteger(s[k]) && s[k] >= 0) base[k] = s[k];
        if (Number.isFinite(s.bestBvs) && s.bestBvs >= 0) base.bestBvs = s.bestBvs;
        const l = s.last;
        if (l && Number.isInteger(l.bv) && Number.isInteger(l.time) && (l.bvs === null || Number.isFinite(l.bvs)) && typeof l.won === 'boolean')
          base.last = { bv: l.bv, time: l.time, bvs: l.bvs, won: l.won, stars: [1, 2, 3].includes(l.stars) ? l.stars : null };
        for (const k of ['missions', 'threeStars', 'bestSurvival']) if (Number.isInteger(s[k]) && s[k] >= 0) base[k] = s[k];
        if (Array.isArray(s.puzzles)) base.puzzles = s.puzzles.filter((id, i) => typeof id === 'string' && /^p\d$/.test(id) && s.puzzles.indexOf(id) === i);
      } catch (e) {}
      return base;
    }
    _loadAchievements() {
      const out = {};
      try {
        const s = JSON.parse(this.storage.getItem('ms-ach'));
        for (const a of ACHIEVEMENTS) if (Number.isFinite(s[a.id])) out[a.id] = s[a.id];
      } catch (e) {}
      return out;
    }
    _loadScores() {
      let saved = {};
      try { saved = JSON.parse(this.storage.getItem('ms-scores')) || {}; } catch (e) {}
      const out = {};
      for (const level of Object.keys(Levels.LEVELS)) {
        let list = (Array.isArray(saved[level]) ? saved[level] : []).filter(e => e && Number.isInteger(e.t) && e.t > 0)
          .map(e => ({ t: e.t, at: Number.isFinite(e.at) ? e.at : null }));
        const old = Number(this.storage.getItem('ms-best-' + level)); // single best time saved by an older version
        if (!list.length && old > 0) list = [{ t: old, at: null }];
        out[level] = list.sort((a, b) => a.t - b.t).slice(0, TOP);
      }
      return out;
    }
  }
  Stats.ACHIEVEMENTS = ACHIEVEMENTS; Stats.TOP = TOP; Stats.starsFor = starsFor;

  if (typeof module !== 'undefined') module.exports = Stats; else root.Stats = Stats;
})(this);
