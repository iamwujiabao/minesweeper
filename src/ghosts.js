// Ghost races: the commands of your best win on a seeded board are kept, so you can race them next time.
// A ghost is {key, time, moves}; key is the share code of the board, moves are [type, row, col, at] with the clock reading.
(function (root) {
  const dep = (name, global) => (typeof module !== 'undefined' ? require(name) : root[global]);
  const Commands = dep('./commands.js', 'Commands');
  const Game = typeof module !== 'undefined' ? require('./game.js').Game : root.Game;
  const MAX = 20;                       // ghosts kept (the oldest are dropped)
  const KEY = /^(\d{1,2})x(\d{1,2})x(\d{1,4})-(square|hex|torus)-(\d{1,10})$/;

  class Ghosts {
    constructor(storage) {
      this.storage = storage; this.list = [];
      try {
        const d = JSON.parse(storage.getItem('ms-ghosts'));
        this.list = d.filter(g => g && KEY.test(g.key) && Number.isInteger(g.time) && g.time > 0 && Array.isArray(g.moves) && g.moves.length <= 5000 &&
                                  g.moves.every(m => Commands.fromJSON(m) && m.length === 4)).slice(-MAX);
      } catch (e) {}
    }
    get(key) { return this.list.find(g => g.key === key) || null; }
    // Keep this win if the board has no ghost yet or this one is faster. moves: the game's commands (with `at`).
    save(key, time, moves) {
      if (!KEY.test(key) || !(time > 0) || !moves.length || !moves.every(m => m.at !== undefined)) return false;
      const old = this.get(key);
      if (old && old.time <= time) return false;
      this.list = this.list.filter(g => g.key !== key).concat({ key, time, moves: moves.map(m => m.toJSON()) }).slice(-MAX);
      this.storage.setItem('ms-ghosts', JSON.stringify(this.list));
      return true;
    }

    // How many safe cells the ghost had opened at each of its moves: {time, total, steps: [{at, opened}]}.
    static track(ghost) {
      const [, rows, cols, mines, topology, seed] = KEY.exec(ghost.key);
      const g = new Game(+rows, +cols, +mines, Math.random, { topology, seed: +seed });
      const steps = [];
      for (const m of ghost.moves) {
        Commands.fromJSON(m).execute(g);
        steps.push({ at: m[3], opened: g.cells.flat().filter(c => c.revealed && !c.mine).length });
      }
      return { time: ghost.time, total: g.rows * g.cols - g.mineCount, steps };
    }
    static openedAt(track, seconds) {
      let opened = 0;
      for (const s of track.steps) { if (s.at <= seconds) opened = s.opened; else break; }
      return opened;
    }
  }

  if (typeof module !== 'undefined') module.exports = Ghosts; else root.Ghosts = Ghosts;
})(this);
