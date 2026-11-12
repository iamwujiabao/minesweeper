// ViewModel (MVVM): sits between Game (model) and a view. It owns UI state (difficulty, timer, best
// times, sound and key settings) and exposes commands + a plain state() object. It never touches the DOM,
// so the same ViewModel drives both index.html (plain JS view) and vue.html (Vue view).
(function (root) {
  const G = typeof module !== 'undefined' ? require('./game.js').Game : root.Game;
  const LEVELS = { beginner: [9, 9, 10], intermediate: [16, 16, 40], expert: [16, 30, 99] }; // rows, cols, mines
  const isLevel = l => l === 'custom' || Object.prototype.hasOwnProperty.call(LEVELS, l); // not `in`: avoids 'constructor' etc.

  // Keyboard actions and their default keys (arrays: an action can have several keys). Single letters are lowercase.
  const DEFAULT_KEYS = {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    reveal: ['Enter', ' '], flag: ['f'], chord: ['c'], mute: ['m'], undo: ['u'], redo: ['y'], newGame: ['n'],
  };
  const ACTION_LABELS = { up: 'Cursor up', down: 'Cursor down', left: 'Cursor left', right: 'Cursor right', reveal: 'Reveal / chord',
                          flag: 'Flag', chord: 'Chord only', mute: 'Mute', undo: 'Undo', redo: 'Redo', newGame: 'New game' };
  const normKey = k => (k.length === 1 ? k.toLowerCase() : k);
  const UNBINDABLE = ['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab', 'CapsLock'];

  // Validate a saved/imported key map. Returns the full map (missing actions get defaults) or null if invalid
  // (wrong shape, empty list, reserved key, or the same key used twice).
  function parseKeys(saved) {
    if (!saved || typeof saved !== 'object') return null;
    const keys = { ...DEFAULT_KEYS };
    for (const a of Object.keys(DEFAULT_KEYS)) {
      if (!(a in saved)) continue;
      const v = saved[a];
      if (!Array.isArray(v) || !v.length || !v.every(k => typeof k === 'string' && k.length && !UNBINDABLE.includes(normKey(k)))) return null;
      keys[a] = v.map(normKey);
    }
    const all = Object.values(keys).flat();
    return new Set(all).size === all.length ? keys : null;
  }

  // Keep custom sizes sane; max mines leaves room for the safe first-click area.
  function clampCustom([rows, cols, mines]) {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || lo));
    rows = clamp(rows, 5, 30); cols = clamp(cols, 5, 40);
    return [rows, cols, clamp(mines, 1, rows * cols - 9)];
  }

  // Cell size in px so the whole board fits a w x h area (2px gaps), between 16 and 40.
  function cellSize(rows, cols, w, h) {
    const fit = (n, room) => Math.floor((room - 2 * (n - 1)) / n);
    return Math.max(16, Math.min(40, fit(cols, w), fit(rows, h)));
  }

  class ViewModel {
    // storage: {getItem, setItem}. hooks: onChange(state) after any change, onTick(seconds) every timer tick.
    // rng: random source for mine placement (Math.random, or a seeded one for reproducible boards).
    constructor(storage, { onChange = () => {}, onTick = () => {}, rng = Math.random } = {}) {
      this.storage = storage; this.onChange = onChange; this.onTick = onTick; this.rng = rng;
      this.custom = [9, 9, 10];
      this.gameId = 0;          // increments on every new game (views use it to tell "new game" from "undo")
      this.rebinding = null;    // action waiting for its next key press, or null
      this.keyMessage = '';
      // Everything below is saved settings; corrupt or missing data falls back to defaults.
      let keys = null;
      try { keys = parseKeys(JSON.parse(storage.getItem('ms-keys'))); } catch (e) {}
      this.keys = keys || { ...DEFAULT_KEYS };
      try { const c = JSON.parse(storage.getItem('ms-custom')); if (Array.isArray(c) && c.length === 3) this.custom = clampCustom(c); } catch (e) {}
      const v = storage.getItem('ms-volume');
      this.muted = storage.getItem('ms-muted') === '1';
      this.volume = v === null || isNaN(Number(v)) ? 0.5 : Math.min(1, Math.max(0, Number(v)));
      const saved = storage.getItem('ms-level');
      // Resume a game in progress (autosaved after every change). Finished or untouched games start fresh instead.
      let resumed = false;
      try {
        const d = JSON.parse(storage.getItem('ms-game'));
        resumed = d.game.status === 'playing' && d.game.history.length > 0 && this._loadGameData(d);
      } catch (e) {}
      if (!resumed) this.start(isLevel(saved) ? saved : 'beginner');
    }

    start(level = this.level, custom = this.custom) {
      this.level = level;
      if (level === 'custom') this.custom = custom = clampCustom(custom);
      const [r, c, m] = level === 'custom' ? custom : LEVELS[level];
      this.game = new G(r, c, m, this.rng);
      this.gameId++;
      this.storage.setItem('ms-level', level);
      this.storage.setItem('ms-custom', JSON.stringify(this.custom));
      this.elapsed = 0;
      this.cursor = { r: 0, c: 0 }; // keyboard cursor
      this._changed();
    }

    // Left click: a revealed cell chords, a hidden cell reveals.
    click(r, c) { this.cursor = { r, c }; this.game.cells[r][c].revealed ? this.game.chord(r, c) : this.game.reveal(r, c); this._changed(); }
    flag(r, c) { this.cursor = { r, c }; this.game.toggleFlag(r, c); this._changed(); }
    chord(r, c) { this.cursor = { r, c }; this.game.chord(r, c); this._changed(); } // chord only, never reveals
    move(dr, dc) { // keyboard cursor, stays on the board
      const { r, c } = this.cursor, g = this.game;
      this.cursor = { r: Math.min(g.rows - 1, Math.max(0, r + dr)), c: Math.min(g.cols - 1, Math.max(0, c + dc)) };
      this.onChange(this.state());
    }
    undo() { this.game.undo(); this._changed(); }
    redo() { this.game.redo(); this._changed(); }

    // ---- Keyboard ----
    // actionFor: which action a pressed key triggers (undefined = none).
    actionFor(key) { const k = normKey(key); return Object.keys(this.keys).find(a => this.keys[a].includes(k)); }

    // A view forwards every key press here. Returns true if the key was used (view should preventDefault).
    // While rebinding, the next key becomes an extra key for that action; Esc cancels; bad keys keep waiting.
    pressKey(key) {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return false;
      if (this.rebinding) {
        const a = this.rebinding;
        this.rebinding = null;
        if (key === 'Escape') this.keyMessage = '';
        else if (this.addKey(a, key)) { this.keyMessage = ''; return true; } // addKey already notified
        else { this.rebinding = a; this.keyMessage = (key === ' ' ? 'Space' : key) + ' is reserved or already used - try another (Esc cancels)'; }
        this.onChange(this.state());
        return true;
      }
      const act = this.actionFor(key);
      if (!act) return false;
      const { r, c } = this.cursor;
      ({ up: () => this.move(-1, 0), down: () => this.move(1, 0), left: () => this.move(0, -1), right: () => this.move(0, 1),
         reveal: () => this.click(r, c), flag: () => this.flag(r, c), chord: () => this.chord(r, c),
         mute: () => this.setMuted(!this.muted), undo: () => this.undo(), redo: () => this.redo(),
         newGame: () => this.start(this.level, this.custom) })[act]();
      return true;
    }

    startRebind(action) { this.rebinding = action; this.keyMessage = 'Press a key to add (Esc cancels)'; this.onChange(this.state()); }

    // Add one more key to an action. False (nothing changed) for unknown actions, reserved keys, or keys already in use.
    addKey(action, key) {
      const k = normKey(key);
      if (!(action in DEFAULT_KEYS) || UNBINDABLE.includes(k) || this.actionFor(k)) return false;
      this._setKeys({ ...this.keys, [action]: [...this.keys[action], k] });
      return true;
    }
    // Remove a key from an action; every action keeps at least one key.
    removeKey(action, key) {
      const k = normKey(key);
      if (!(action in DEFAULT_KEYS) || !this.keys[action].includes(k) || this.keys[action].length < 2) return false;
      this._setKeys({ ...this.keys, [action]: this.keys[action].filter(x => x !== k) });
      return true;
    }
    // Replace an action's keys with a single key (same rules as addKey, but the action's own keys may be reused).
    rebind(action, key) {
      const k = normKey(key), other = this.actionFor(k);
      if (!(action in DEFAULT_KEYS) || UNBINDABLE.includes(k) || (other && other !== action)) return false;
      this._setKeys({ ...this.keys, [action]: [k] });
      return true;
    }
    resetKeys() { this.rebinding = null; this.keyMessage = ''; this._setKeys({ ...DEFAULT_KEYS }); }
    _setKeys(keys) { this.keys = keys; this.storage.setItem('ms-keys', JSON.stringify(keys)); this.onChange(this.state()); }

    // ---- Sound settings ----
    setMuted(m) { this.muted = !!m; this.storage.setItem('ms-muted', this.muted ? 1 : 0); this.onChange(this.state()); }
    setVolume(v) { this.volume = Math.min(1, Math.max(0, Number(v) || 0)); this.storage.setItem('ms-volume', this.volume); this.onChange(this.state()); }

    // ---- Save / load a game in progress ----
    // The whole game (board, undo and redo history) plus difficulty and elapsed time, as a plain object.
    _gameData() { return { version: 1, type: 'game', level: this.level, custom: this.custom, elapsed: this.elapsed, game: this.game.serialize() }; }
    save() { this.storage.setItem('ms-game', JSON.stringify(this._gameData())); } // views also call this when the page is hidden
    exportGame() { return JSON.stringify(this._gameData()); }
    // Validate then apply (all-or-nothing). Returns false, changing nothing, if the data is not a consistent saved game.
    _loadGameData(d) {
      if (!d || typeof d !== 'object' || d.version !== 1 || d.type !== 'game' || !isLevel(d.level)) return false;
      if (!Array.isArray(d.custom) || d.custom.length !== 3 || !d.custom.every(Number.isFinite)) return false;
      if (!Number.isInteger(d.elapsed) || d.elapsed < 0 || d.elapsed > 1e7) return false;
      const custom = clampCustom(d.custom), g = G.deserialize(d.game, this.rng);
      if (!g) return false;
      const [r, c, m] = d.level === 'custom' ? custom : LEVELS[d.level]; // the board must match the difficulty it claims
      if (g.rows !== r || g.cols !== c || g.mineCount !== m) return false;
      this.level = d.level; this.custom = custom; this.game = g; this.elapsed = d.elapsed;
      this.gameId++; this.cursor = { r: 0, c: 0 }; this.rebinding = null; this.keyMessage = '';
      this.storage.setItem('ms-level', this.level); this.storage.setItem('ms-custom', JSON.stringify(this.custom));
      this._changed(false); // false: a loaded win must not count as a new best time
      return true;
    }
    // One entry point for uploaded files: a saved game or a settings export.
    importFile(text) {
      let d;
      try { d = JSON.parse(text); } catch (e) { return { ok: false, error: 'Not valid JSON' }; }
      if (d && d.type === 'game') return this._loadGameData(d) ? { ok: true, kind: 'game' } : { ok: false, error: 'Not a valid saved game' };
      const r = this.importSettings(text);
      return r.ok ? { ok: true, kind: 'settings' } : r;
    }

    // ---- Export / import of settings (difficulty, custom size, keys, mute, volume; not scores or the game in progress) ----
    exportSettings() {
      return JSON.stringify({ version: 1, type: 'settings', level: this.level, custom: this.custom, keys: this.keys, muted: this.muted, volume: this.volume }, null, 2);
    }
    // All-or-nothing: if any field is invalid nothing changes. Returns {ok, error?}. Starts a new game on success.
    importSettings(text) {
      const fail = error => ({ ok: false, error });
      let d;
      try { d = JSON.parse(text); } catch (e) { return fail('Not valid JSON'); }
      if (!d || typeof d !== 'object' || d.version !== 1 || (d.type !== undefined && d.type !== 'settings')) return fail('Not a Minesweeper settings export (expected version 1)');
      if ('level' in d && !isLevel(d.level)) return fail('Unknown difficulty');
      let custom = this.custom;
      if ('custom' in d) {
        if (!Array.isArray(d.custom) || d.custom.length !== 3 || !d.custom.every(Number.isFinite)) return fail('Bad custom size');
        custom = clampCustom(d.custom);
      }
      let keys = this.keys;
      if ('keys' in d && !(keys = parseKeys(d.keys))) return fail('Bad key map (reserved, empty or duplicate keys)');
      if ('muted' in d && typeof d.muted !== 'boolean') return fail('Bad mute value');
      if ('volume' in d && !(typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1)) return fail('Volume must be between 0 and 1');
      // Everything validated: apply.
      this.keys = keys; this.storage.setItem('ms-keys', JSON.stringify(keys));
      if ('muted' in d) { this.muted = d.muted; this.storage.setItem('ms-muted', d.muted ? 1 : 0); }
      if ('volume' in d) { this.volume = d.volume; this.storage.setItem('ms-volume', d.volume); }
      this.custom = custom;
      this.rebinding = null; this.keyMessage = '';
      this.start('level' in d ? d.level : this.level, custom);
      return { ok: true };
    }

    // Timer runs only while a game is in progress (a move was made, not won/lost).
    tick() {
      if (this.game.status === 'playing' && this.game.canUndo()) { this.elapsed++; this.onTick(this.elapsed); }
    }

    best() { return Number(this.storage.getItem('ms-best-' + this.level)) || null; }

    _changed(recordBest = true) {
      if (!this.game.canUndo()) this.elapsed = 0; // nothing played: new game or first move undone
      const best = this.best();
      // No high scores for custom boards (not comparable).
      if (recordBest && this.game.status === 'won' && this.level !== 'custom' && this.elapsed > 0 && (!best || this.elapsed < best))
        this.storage.setItem('ms-best-' + this.level, this.elapsed);
      this.save();
      this.onChange(this.state());
    }

    state() {
      const g = this.game;
      return { gameId: this.gameId, level: this.level, custom: this.custom, rows: g.rows, cols: g.cols, cells: g.cells, cursor: this.cursor,
               status: g.status, minesLeft: g.minesLeft(), keys: this.keys, rebinding: this.rebinding, keyMessage: this.keyMessage,
               muted: this.muted, volume: this.volume, time: this.elapsed, best: this.best(), canUndo: g.canUndo(), canRedo: g.canRedo() };
    }
  }

  if (typeof module !== 'undefined') module.exports = { ViewModel, LEVELS, clampCustom, cellSize, DEFAULT_KEYS, ACTION_LABELS };
  else { root.ViewModel = ViewModel; root.cellSize = cellSize; root.ACTION_LABELS = ACTION_LABELS; }
})(this);
