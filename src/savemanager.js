// Saving games: the autosave, the three slots, and the game files you download. It turns the current session into
// plain data (using the Serializer) and checks data that comes back (it may come from an uploaded file).
(function (root) {
  const dep = (name, global) => (typeof module !== 'undefined' ? require(name) : root[global]);
  const Serializer = dep('./serializer.js', 'Serializer'), Levels = dep('./levels.js', 'Levels'), Modes = dep('./modes.js', 'Modes');
  const SLOTS = 3;
  const AUTOSAVE_HISTORY = 100;   // the autosave keeps only the newest 100 undo steps, so its size stays bounded

  class SaveManager {
    constructor(storage, rng) {
      this.storage = storage; this.rng = rng;
      this.slotLabels = Array.from({ length: SLOTS }, (_, i) => this.label(i + 1));
    }

    // The data to save. info: {level, custom, mode (id), daily, elapsed, game}. full: keep the whole undo history.
    static toData(info, full) {
      return { version: 1, type: 'game', level: info.level, custom: info.custom, mode: info.mode, daily: info.daily,
               elapsed: info.elapsed, game: Serializer.serialize(info.game, full ? {} : { maxHistory: AUTOSAVE_HISTORY }) };
    }

    // ---- Autosave and files ----
    autosave(info) { this.storage.setItem('ms-game', JSON.stringify(SaveManager.toData(info, false))); }
    readAutosave() { try { return JSON.parse(this.storage.getItem('ms-game')); } catch (e) { return null; } }
    exportGame(info) { return JSON.stringify(SaveManager.toData(info, true)); }

    // ---- Slots (kept until overwritten or deleted; separate from the autosave) ----
    static validSlot(n) { return Number.isInteger(n) && n >= 1 && n <= SLOTS; }
    label(n) {
      try {
        const d = JSON.parse(this.storage.getItem('ms-slot-' + n));
        if (!d || d.type !== 'game' || !Levels.isLevel(d.level) || !d.game || typeof d.game.status !== 'string') return null;
        const when = Number.isFinite(d.savedAt) ? ', saved ' + new Date(d.savedAt).toLocaleString() : '';
        return Levels.LEVEL_NAMES[d.level] + ', ' + d.game.status + ', ' + d.elapsed + 's' + when;
      } catch (e) { return null; }
    }
    saveSlot(n, info) {
      if (!SaveManager.validSlot(n)) return false;
      this.storage.setItem('ms-slot-' + n, JSON.stringify({ ...SaveManager.toData(info, true), savedAt: Date.now() }));
      this.slotLabels[n - 1] = this.label(n);
      return true;
    }
    readSlot(n) { try { return SaveManager.validSlot(n) ? JSON.parse(this.storage.getItem('ms-slot-' + n)) : null; } catch (e) { return null; } }
    deleteSlot(n) {
      if (!SaveManager.validSlot(n)) return false;
      this.storage.setItem('ms-slot-' + n, '');
      this.slotLabels[n - 1] = null;
      return true;
    }

    // Check saved data. Returns {level, custom, mode, daily, elapsed, game} (game is a Game) or null if it is not a
    // consistent saved game: right shape, a board that matches the difficulty it claims, a known mode, a real date.
    static parse(d, rng) {
      if (!d || typeof d !== 'object' || d.version !== 1 || d.type !== 'game' || !Levels.isLevel(d.level)) return null;
      if (!Array.isArray(d.custom) || d.custom.length !== 3 || !d.custom.every(Number.isFinite)) return null;
      if (!Number.isInteger(d.elapsed) || d.elapsed < 0 || d.elapsed > 1e7) return null;
      const mode = d.mode === undefined ? 'classic' : d.mode;
      if (!Modes.has(mode) || !(d.daily === undefined || d.daily === null || /^\d{4}-\d{2}-\d{2}$/.test(d.daily))) return null;
      const custom = Levels.clampCustom(d.custom), game = Serializer.deserialize(d.game, rng);
      if (!game) return null;
      const [r, c, m] = d.level === 'custom' ? custom : Levels.LEVELS[d.level];
      if (game.rows !== r || game.cols !== c || game.mineCount !== m) return null;
      return { level: d.level, custom, mode, daily: d.daily || null, elapsed: d.elapsed, game };
    }
  }
  SaveManager.SLOTS = SLOTS; SaveManager.AUTOSAVE_HISTORY = AUTOSAVE_HISTORY;

  if (typeof module !== 'undefined') module.exports = SaveManager; else root.SaveManager = SaveManager;
})(this);
