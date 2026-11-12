// ViewModel (MVVM): sits between Game (model) and the page (view). It owns UI state (difficulty,
// timer, best times) and exposes commands + a plain state() object. It never touches the DOM.
(function (root) {
  const G = typeof module !== 'undefined' ? require('./game.js').Game : root.Game;
  const LEVELS = { beginner: [9, 9, 10], intermediate: [16, 16, 40], expert: [16, 30, 99] }; // rows, cols, mines

  // Keyboard actions and their default keys (arrays so an action can have aliases). Single letters are lowercase.
  const DEFAULT_KEYS = {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    reveal: ['Enter', ' '], flag: ['f'], chord: ['c'], mute: ['m'], undo: ['u'], redo: ['y'], newGame: ['n'],
  };
  const normKey = k => (k.length === 1 ? k.toLowerCase() : k);
  const UNBINDABLE = ['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab', 'CapsLock'];

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
    // storage: {getItem, setItem}. hooks: onChange(state) after moves, onTick(seconds) every timer tick.
    constructor(storage, { onChange = () => {}, onTick = () => {} } = {}) {
      this.storage = storage; this.onChange = onChange; this.onTick = onTick;
      this.custom = [9, 9, 10];
      // Sound settings persist: muted flag and master volume (0..1, default 0.5).
      const v = storage.getItem('ms-volume');
      this.keys = this._loadKeys();
      // Saved difficulty / custom size (corrupt or missing data falls back to defaults).
      try { const c = JSON.parse(storage.getItem('ms-custom')); if (Array.isArray(c) && c.length === 3) this.custom = clampCustom(c); } catch (e) {}
      const saved = storage.getItem('ms-level');
      this.muted = storage.getItem('ms-muted') === '1';
      this.volume = v === null || isNaN(Number(v)) ? 0.5 : Math.min(1, Math.max(0, Number(v)));
      this.start(saved in LEVELS || saved === 'custom' ? saved : 'beginner');
    }

    start(level = this.level, custom = this.custom) {
      this.level = level;
      if (level === 'custom') this.custom = custom = clampCustom(custom);
      const [r, c, m] = level === 'custom' ? custom : LEVELS[level];
      this.game = new G(r, c, m);
      this.storage.setItem('ms-level', level);
      if (level === 'custom') this.storage.setItem('ms-custom', JSON.stringify(custom));
      this.elapsed = 0;
      this.cursor = { r: 0, c: 0 }; // keyboard cursor
      this._changed();
    }

    // Left click: a revealed cell chords, a hidden cell reveals.
    click(r, c) { this.cursor = { r, c }; this.game.cells[r][c].revealed ? this.game.chord(r, c) : this.game.reveal(r, c); this._changed(); }
    flag(r, c) { this.cursor = { r, c }; this.game.toggleFlag(r, c); this._changed(); }
    chord(r, c) { this.cursor = { r, c }; this.game.chord(r, c); this._changed(); } // chord only, never reveals
    // Key map. actionFor: which action a pressed key triggers (undefined = none).
    actionFor(key) { const k = normKey(key); return Object.keys(this.keys).find(a => this.keys[a].includes(k)); }
    // Rebind an action to one key. Returns false (and changes nothing) for unknown actions, reserved keys, or keys already used.
    rebind(action, key) {
      const k = normKey(key), other = this.actionFor(k);
      if (!(action in DEFAULT_KEYS) || UNBINDABLE.includes(k) || (other && other !== action)) return false;
      this.keys = { ...this.keys, [action]: [k] };
      this.storage.setItem('ms-keys', JSON.stringify(this.keys));
      this.onChange(this.state());
      return true;
    }
    resetKeys() { this.keys = this._loadKeys(true); this.storage.setItem('ms-keys', JSON.stringify(this.keys)); this.onChange(this.state()); }
    _loadKeys(defaults) {
      try {
        const saved = defaults ? null : JSON.parse(this.storage.getItem('ms-keys'));
        const keys = { ...DEFAULT_KEYS };
        for (const a of Object.keys(DEFAULT_KEYS))
          if (saved && Array.isArray(saved[a]) && saved[a].length && saved[a].every(k => typeof k === 'string')) keys[a] = saved[a];
        const all = Object.values(keys).flat();
        return new Set(all).size === all.length ? keys : { ...DEFAULT_KEYS }; // duplicates = corrupt: use defaults
      } catch (e) { return { ...DEFAULT_KEYS }; }
    }
    setMuted(m) { this.muted = !!m; this.storage.setItem('ms-muted', this.muted ? 1 : 0); this.onChange(this.state()); }
    setVolume(v) { this.volume = Math.min(1, Math.max(0, Number(v) || 0)); this.storage.setItem('ms-volume', this.volume); this.onChange(this.state()); }
    move(dr, dc) { // keyboard cursor, stays on the board
      const { r, c } = this.cursor, g = this.game;
      this.cursor = { r: Math.min(g.rows - 1, Math.max(0, r + dr)), c: Math.min(g.cols - 1, Math.max(0, c + dc)) };
      this.onChange(this.state());
    }
    undo() { this.game.undo(); this._changed(); }
    redo() { this.game.redo(); this._changed(); }

    // Timer runs only while a game is in progress (a move was made, not won/lost).
    tick() {
      if (this.game.status === 'playing' && this.game.canUndo()) { this.elapsed++; this.onTick(this.elapsed); }
    }

    best() { return Number(this.storage.getItem('ms-best-' + this.level)) || null; }

    _changed() {
      if (!this.game.canUndo()) this.elapsed = 0; // nothing played: new game or first move undone
      const best = this.best();
      // No high scores for custom boards (not comparable).
      if (this.game.status === 'won' && this.level !== 'custom' && this.elapsed > 0 && (!best || this.elapsed < best))
        this.storage.setItem('ms-best-' + this.level, this.elapsed);
      this.onChange(this.state());
    }

    state() {
      const g = this.game;
      return { level: this.level, custom: this.custom, rows: g.rows, cols: g.cols, cells: g.cells, cursor: this.cursor, status: g.status,
               minesLeft: g.minesLeft(), keys: this.keys, muted: this.muted, volume: this.volume, time: this.elapsed, best: this.best(), canUndo: g.canUndo(), canRedo: g.canRedo() };
    }
  }

  if (typeof module !== 'undefined') module.exports = { ViewModel, LEVELS, clampCustom, cellSize, DEFAULT_KEYS }; else root.ViewModel = ViewModel; root.cellSize = cellSize;
})(this);
