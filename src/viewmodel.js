// ViewModel (MVVM): sits between Game (model) and the view (app.js). It owns everything about the session that is not a board
// rule: difficulty and game modes, timers, hints and power-up buttons, statistics, achievements, best times, saved
// games, replay, key bindings, sound and theme settings. It exposes commands and one plain state() object, and never
// touches the DOM, so it can be tested without a browser.
(function (root) {
  const G = typeof module !== 'undefined' ? require('./game.js').Game : root.Game;
  const Rng = typeof module !== 'undefined' ? require('./rng.js') : root.Rng;
  const LEVELS = { beginner: [9, 9, 10], intermediate: [16, 16, 40], expert: [16, 30, 99] }; // rows, cols, mines
  const LEVEL_NAMES = { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert', custom: 'Custom' };
  const SLOTS = 3, TOP = 5;   // saved-game slots, and best-time rows kept per difficulty
  const UNDO_PENALTY = 10;    // seconds added per undo in "undo costs time" mode
  const isLevel = l => l === 'custom' || Object.prototype.hasOwnProperty.call(LEVELS, l); // not `in`: avoids 'constructor' etc.
  const MODES = ['classic', 'lives', 'undolimit', 'undopenalty', 'timeattack', 'zen', 'twoplayer'];

  // Settings and where they are shown: group 'newgame' = the New game menu (applies to the next new game), 'game' and
  // 'appearance' = Settings tabs, 'header' = the header. Each option and each choice has a short description.
  const OPTION_DEFS = [
    { key: 'mode', label: 'Mode', group: 'newgame', type: 'select', choices: [
      ['classic', 'Classic', 'The usual rules. The clock counts up and fast wins go in the best-times table.'],
      ['lives', 'Lives (3)', 'A mine costs one of three lives instead of ending the game.'],
      ['undolimit', 'Limited undo (3)', 'You get only three undos in the whole game.'],
      ['undopenalty', 'Undo costs 10 s', 'Undo is unlimited, but every undo adds ten seconds to your time.'],
      ['timeattack', 'Time attack', 'Beat a countdown of 1.5 seconds per cell. When it hits zero you lose.'],
      ['zen', 'Zen (no timer)', 'No clock and nothing recorded. Just play.'],
      ['twoplayer', 'Two players (hot-seat)', 'Take turns revealing cells and score points. Whoever opens a mine loses.']] },
    { key: 'board', label: 'Board', group: 'newgame', type: 'select', choices: [
      ['square', 'Square', 'The usual board: every cell has eight neighbours.'],
      ['hex', 'Hexagonal', 'Hexagon cells with six neighbours.'],
      ['torus', 'Wrap-around', 'The edges connect, so there is no border and every cell has eight neighbours.']] },
    { key: 'noGuess', label: 'No-guess boards', group: 'newgame', type: 'checkbox', desc: 'Boards that can be finished by logic alone. They cannot be shared as a link.' },
    { key: 'powerups', label: 'Power-ups', group: 'newgame', type: 'checkbox', desc: 'Three scanners (count the mines around a cell) and one shield (survives one mine) per game.' },
    { key: 'questionMarks', label: 'Question marks', group: 'game', type: 'checkbox', desc: 'Right-click cycles flag, question mark, then clear. Takes effect at once.' },
    { key: 'dimNumbers', label: 'Dim finished numbers', group: 'appearance', type: 'checkbox', desc: 'Dims a number once all of its flags are placed.' },
    { key: 'theme', label: 'Theme', group: 'header', type: 'select', choices: [
      ['auto', 'Auto', 'Follows your device\'s light or dark setting.'],
      ['light', 'Light', 'Light colours.'],
      ['dark', 'Dark', 'Dark colours.'],
      ['colorblind', 'Colour-blind', 'A palette that stays distinct with colour blindness; higher numbers are also underlined.']] },
  ];
  const DEFAULT_OPTIONS = { mode: 'classic', board: 'square', noGuess: false, powerups: false, questionMarks: true, dimNumbers: true, theme: 'auto' };
  const TABS = ['game', 'controls', 'appearance', 'data'];   // Settings dialog tabs
  // One-time tips, shown in this order when they become relevant. `id` is remembered once the tip is dismissed or used.
  const TIPS = [
    { id: 'flag', text: 'Tip: right-click a cell to flag a mine (long-press on a phone, or turn on Flag mode). Right-click again for a ? mark.' },
    { id: 'chord', text: 'Tip: click a number whose flags are all placed to open its remaining neighbours in one go (chording).' },
  ];

  // Validate saved/imported options. Returns a full options object, or null if any value is not allowed.
  function parseOptions(saved) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    const out = { ...DEFAULT_OPTIONS };
    for (const [k, v] of Object.entries(saved)) {
      const def = OPTION_DEFS.find(d => d.key === k);
      if (!def) return null;
      if (def.type === 'checkbox' ? typeof v !== 'boolean' : !def.choices.some(([value]) => value === v)) return null;
      out[k] = v;
    }
    return out;
  }

  // Keyboard actions and their default keys (arrays: an action can have several keys). Single letters are lowercase.
  const DEFAULT_KEYS = {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    reveal: ['Enter', ' '], flag: ['f'], chord: ['c'], hint: ['h'], scanner: ['s'],
    mute: ['m'], undo: ['u'], redo: ['y'], newGame: ['n'],
  };
  const ACTION_LABELS = { up: 'Cursor up', down: 'Cursor down', left: 'Cursor left', right: 'Cursor right', reveal: 'Reveal / chord',
                          flag: 'Flag', chord: 'Chord only', hint: 'Hint', scanner: 'Scanner', mute: 'Mute', undo: 'Undo', redo: 'Redo', newGame: 'New game' };
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

  // Cell size in px so the whole board fits a w x h area (2px gaps), between `min` (16; views pass 32 on touch screens,
  // where a board that is too big scrolls inside itself) and 40.
  function cellSize(rows, cols, w, h, min = 16) {
    const fit = (n, room) => Math.floor((room - 2 * (n - 1)) / n);
    return Math.max(min, Math.min(40, fit(cols, w), fit(rows, h)));
  }

  const emptyStats = () => ({ played: 0, won: 0, lost: 0, duels: 0, streak: 0, bestStreak: 0, bestBvs: 0, last: null });

  // Badges. test(ctx) is run when a game finishes; ctx describes the finished game.
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
  ];

  class ViewModel {
    // storage: {getItem, setItem}. hooks: onChange(state) after any change, onTick(timeText) every timer tick.
    // rng: random source (Math.random, or a seeded one for reproducible boards). play: a parsed share link (see rng.js).
    // now: returns the current Date (replaced in tests).
    constructor(storage, { onChange = () => {}, onTick = () => {}, rng = Math.random, play = null, now = () => new Date() } = {}) {
      this.storage = storage; this.onChange = onChange; this.onTick = onTick; this.rng = rng; this.now = now;
      this.custom = [9, 9, 10];
      this.gameId = 0;          // increments on every new game (views use it to tell "new game" from "undo")
      this.rebinding = null;    // action waiting for its next key press, or null
      this.keyMessage = '';
      this.replay = null; this.frames = null;
      this.flagMode = false;       // taps flag instead of reveal (for phones)
      this.undoRedoCount = 0;      // part of the result overlay's key: undoing and ending again shows the overlay again
      this.flashSeq = 0; this.shakeSeq = 0;   // blocked-move feedback counters
      this._pendingBlocked = null; this._anim = null; this._prevMarks = null; this._prevKey = null; this._cellCache = [];
      this.resultDismissed = null;
      // Everything below is saved settings; corrupt or missing data falls back to defaults.
      let keys = null;
      try { keys = parseKeys(JSON.parse(storage.getItem('ms-keys'))); } catch (e) {}
      this.keys = keys || { ...DEFAULT_KEYS };
      let options = null;
      try { options = parseOptions(JSON.parse(storage.getItem('ms-options'))); } catch (e) {}
      this.options = options || { ...DEFAULT_OPTIONS };
      this.scores = this._loadScores();
      let seen = [];
      try { seen = JSON.parse(storage.getItem('ms-tips')); } catch (e) {}
      this.seenTips = Array.isArray(seen) ? seen.filter(id => TIPS.some(t => t.id === id)) : [];
      const tab = storage.getItem('ms-tab');
      this.settingsTab = TABS.includes(tab) ? tab : 'game';
      this.stats = this._loadStats();
      this.unlocked = this._loadAchievements();
      this.slotLabels = Array.from({ length: SLOTS }, (_, i) => this._slotLabel(i + 1));
      try { const c = JSON.parse(storage.getItem('ms-custom')); if (Array.isArray(c) && c.length === 3) this.custom = clampCustom(c); } catch (e) {}
      const v = storage.getItem('ms-volume');
      this.muted = storage.getItem('ms-muted') === '1';
      this.volume = v === null || isNaN(Number(v)) ? 0.5 : Math.min(1, Math.max(0, Number(v)));
      const saved = storage.getItem('ms-level');
      if (play) { this._startPlay(play); return; }   // a share link wins over the autosave
      // Resume a game in progress (autosaved after every change). Finished or untouched games start fresh instead.
      let resumed = false;
      try {
        const d = JSON.parse(storage.getItem('ms-game'));
        resumed = d.game.status === 'playing' && d.game.history.length > 0 && this._loadGameData(d, true);
      } catch (e) {}
      if (!resumed) this.start(isLevel(saved) ? saved : 'beginner');
    }

    // Start a new game. extra: {seed, topology} reproduces a board (share links); {daily, seed} is the daily challenge.
    start(level = this.level, custom = this.custom, extra = {}) {
      this.level = level;
      if (level === 'custom') this.custom = custom = clampCustom(custom);
      const [r, c, m] = level === 'custom' ? custom : LEVELS[level];
      const o = this.options, seeded = extra.seed !== undefined, daily = extra.daily || null;
      const mode = daily ? 'classic' : o.mode; // the daily challenge is the same for everybody: plain classic rules
      const opts = { topology: extra.topology || (daily ? 'square' : o.board), noGuess: !seeded && o.noGuess,
                     powerups: !daily && o.powerups, seed: extra.seed };
      if (mode === 'lives') opts.lives = 3;
      if (mode === 'undolimit') opts.undoLimit = 3;
      if (mode === 'twoplayer') opts.players = 2;
      this.game = new G(r, c, m, this.rng, opts);
      this.gameMode = mode; this.daily = daily;
      this.gameId++; this._cellCache = [];
      this.storage.setItem('ms-level', level);
      this.storage.setItem('ms-custom', JSON.stringify(this.custom));
      this.elapsed = 0;
      this.cursor = { r: 0, c: 0 }; // keyboard cursor
      this.scanMode = false; this.hintCell = null; this.hintMessage = ''; this.notice = '';
      this.replay = null; this.frames = null;
      this.resultDismissed = null;
      this.recordedGame = -1;       // gameId whose result has been recorded (statistics, best times, badges)
      this._changed();
    }

    _startPlay(p) { // p: {rows, cols, mines, topology, seed} from a share link
      const preset = Object.keys(LEVELS).find(l => LEVELS[l][0] === p.rows && LEVELS[l][1] === p.cols && LEVELS[l][2] === p.mines);
      this.start(preset || 'custom', [p.rows, p.cols, p.mines], { seed: p.seed, topology: p.topology });
    }
    startDaily() {
      const id = Rng.dailyId(this.now());
      this.start('intermediate', this.custom, { daily: id, seed: Rng.dailySeed(id) });
    }

    // ---- Playing ----
    _blocked() { return !!this.replay; } // while a replay is open the board is read-only

    // Left click: with the scanner armed it scans; in flag mode it flags; a revealed cell chords; a hidden cell reveals.
    // A move that is not allowed (a flagged cell, a finished game, a number without matching flags...) shakes that cell.
    click(r, c) {
      if (this._blocked()) return;
      this.cursor = { r, c };
      const cell = this.game.cells[r][c];
      let ok, player = false;
      if (this.scanMode) { ok = this.game.scan(r, c); this.scanMode = false; }
      else if (this.flagMode && !cell.revealed) { ok = this.game.mark(r, c, this.options.questionMarks); if (ok) this._tipUsed('flag'); }
      else if (cell.revealed) { ok = this.game.chord(r, c); player = true; if (ok) this._tipUsed('chord'); }
      else { ok = this.game.reveal(r, c); player = true; }
      if (!ok) this._pendingBlocked = { r, c };
      this._changed(player);
    }
    flag(r, c) { // right click: flag, then "?" if question marks are on, then clear
      if (this._blocked()) return;
      this.cursor = { r, c };
      const ok = this.game.mark(r, c, this.options.questionMarks);
      if (ok) this._tipUsed('flag'); else this._pendingBlocked = { r, c };
      this._changed();
    }
    chord(r, c) { // chord only, never reveals
      if (this._blocked()) return;
      this.cursor = { r, c };
      const ok = this.game.chord(r, c);
      if (ok) this._tipUsed('chord'); else this._pendingBlocked = { r, c };
      this._changed(true);
    }
    move(dr, dc) { // keyboard cursor, stays on the board
      const { r, c } = this.cursor, g = this.game;
      this.cursor = { r: Math.min(g.rows - 1, Math.max(0, r + dr)), c: Math.min(g.cols - 1, Math.max(0, c + dc)) };
      this._emit();
    }
    undo() {
      if (this._blocked()) return;
      const ok = this.game.undo();
      if (ok) this.undoRedoCount++;
      if (ok && this.gameMode === 'undopenalty') this.elapsed += UNDO_PENALTY; // the challenge: each undo costs time
      if (!ok) this._flash();
      this._changed();
    }
    redo() { if (this._blocked()) return; if (this.game.redo()) this.undoRedoCount++; else this._flash(); this._changed(); }
    toggleFlagMode() { this.flagMode = !this.flagMode; this._emit(); }
    _flash() { this.flashSeq++; }   // a move that is not allowed outside the board: the status line flashes

    // Hint: highlights one cell that is certainly safe, worked out from the open numbers only.
    hint() {
      if (this._blocked() || this.game.status !== 'playing') { this._flash(); this._emit(); return; }
      const h = this.game.hint();
      this.hintCell = h;
      this.hintMessage = h ? `Hint: row ${h.r + 1}, column ${h.c + 1} is certainly safe.` : this.game.minesPlaced ? 'No cell is certainly safe - you will have to guess.' : 'Click anywhere to start: the first click is always safe.';
      this.save();
      this._emit();
    }
    // Scanner power-up: arm it, then click a cell to count the mines around it. Click the button again to disarm.
    toggleScanner() {
      const g = this.game;
      if (this._blocked() || g.status !== 'playing' || !g.powerups || (!this.scanMode && (g.scanner <= 0 || !g.minesPlaced))) { this._flash(); this._emit(); return; }
      this.scanMode = !this.scanMode;
      this._emit();
    }

    // Hover help: the neighbours of an open number and how many flags it still needs. null for anything else.
    neighborhood(r, c) {
      if (this._blocked()) return null;
      const cell = this.game.cells[r][c];
      if (!cell.revealed || cell.mine || cell.adjacent === 0) return null;
      const around = this.game.neighbors(r, c);
      const flags = around.filter(([y, x]) => this.game.cells[y][x].flagged).length;
      return { number: cell.adjacent, remaining: cell.adjacent - flags, cells: around.map(([y, x]) => y * this.game.cols + x) };
    }

    // ---- Clock ----
    timeLimit() { return this.gameMode === 'timeattack' ? Math.round(this.game.rows * this.game.cols * 1.5) : null; } // seconds
    timeText() {
      if (this.gameMode === 'zen') return '–';
      const limit = this.timeLimit();
      return String(limit === null ? this.elapsed : Math.max(0, limit - this.elapsed));
    }
    // Called every second by the view. The clock runs only while a game is in progress (a move was made, not finished).
    tick() {
      if (this.replay) { if (this.replay.playing) this.replayStep(1); return; }
      if (this.gameMode === 'zen' || this.game.status !== 'playing' || !this.game.started()) return;
      this.elapsed++;
      const limit = this.timeLimit();
      if (limit !== null && this.elapsed >= limit) { this.game.endByTimeout(); this._changed(true); }
      this.onTick(this.timeText());
    }

    // ---- Replay of a finished game ----
    startReplay() {
      if (this.replay || this.game.status === 'playing' || this.game.moveCount === 0) return;
      this.frames = this.game.replayFrames();
      this.replay = { index: 0, playing: false };
      this._emit();
    }
    replayStep(d) {
      if (!this.replay) return;
      this.replay.index = Math.min(this.frames.length - 1, Math.max(0, this.replay.index + d));
      if (this.replay.index === this.frames.length - 1) this.replay.playing = false;
      this._emit();
    }
    replayPlay() { // auto-play: one move per timer tick
      if (!this.replay) return;
      if (this.replay.index === this.frames.length - 1) this.replay.index = 0;
      this.replay.playing = !this.replay.playing;
      this._emit();
    }
    replayClose() { this.replay = null; this.frames = null; this._emit(); }

    // ---- Sharing ----
    // "9x9x10-square-12345" reproduces this board; null if it can't be (no-guess boards depend on the first click).
    shareCode() {
      const g = this.game;
      return g.shareable() ? `${g.rows}x${g.cols}x${g.mineCount}-${g.topology}-${g.seed}` : null;
    }

    // ---- Options ----
    setOption(key, value) {
      const def = OPTION_DEFS.find(d => d.key === key);
      if (!def) return false;
      if (def.type === 'checkbox') value = !!value;
      else if (!def.choices.some(([v]) => v === value)) return false;
      this.options = { ...this.options, [key]: value };
      this.storage.setItem('ms-options', JSON.stringify(this.options));
      this._emit();
      return true;
    }

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
        this._emit();
        return true;
      }
      const act = this.actionFor(key);
      if (!act) return false;
      const { r, c } = this.cursor;
      ({ up: () => this.move(-1, 0), down: () => this.move(1, 0), left: () => this.move(0, -1), right: () => this.move(0, 1),
         reveal: () => this.click(r, c), flag: () => this.flag(r, c), chord: () => this.chord(r, c),
         hint: () => this.hint(), scanner: () => this.toggleScanner(),
         mute: () => this.setMuted(!this.muted), undo: () => this.undo(), redo: () => this.redo(),
         newGame: () => this.start(this.level, this.custom) })[act]();
      return true;
    }

    startRebind(action) { this.rebinding = action; this.keyMessage = 'Press a key to add (Esc cancels)'; this._emit(); }

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
    _setKeys(keys) { this.keys = keys; this.storage.setItem('ms-keys', JSON.stringify(keys)); this._emit(); }

    // ---- Sound settings ----
    setMuted(m) { this.muted = !!m; this.storage.setItem('ms-muted', this.muted ? 1 : 0); this._emit(); }
    setVolume(v) { this.volume = Math.min(1, Math.max(0, Number(v) || 0)); this.storage.setItem('ms-volume', this.volume); this._emit(); }

    // ---- Save / load a game in progress ----
    // The whole game (board, undo and redo history, replay log) plus difficulty, mode and elapsed time, as a plain object.
    _gameData() {
      return { version: 1, type: 'game', level: this.level, custom: this.custom, mode: this.gameMode, daily: this.daily,
               elapsed: this.elapsed, game: this.game.serialize() };
    }
    save() { this.storage.setItem('ms-game', JSON.stringify(this._gameData())); } // views also call this when the page is hidden
    exportGame() { return JSON.stringify(this._gameData()); }
    // Validate then apply (all-or-nothing). Returns false, changing nothing, if the data is not a consistent saved game.
    // record: whether finishing this game counts for statistics and best times (own autosave and slots yes, uploaded files no).
    _loadGameData(d, record = false) {
      if (!d || typeof d !== 'object' || d.version !== 1 || d.type !== 'game' || !isLevel(d.level)) return false;
      if (!Array.isArray(d.custom) || d.custom.length !== 3 || !d.custom.every(Number.isFinite)) return false;
      if (!Number.isInteger(d.elapsed) || d.elapsed < 0 || d.elapsed > 1e7) return false;
      const mode = d.mode === undefined ? 'classic' : d.mode;
      if (!MODES.includes(mode) || !(d.daily === undefined || d.daily === null || /^\d{4}-\d{2}-\d{2}$/.test(d.daily))) return false;
      const custom = clampCustom(d.custom), g = G.deserialize(d.game, this.rng);
      if (!g) return false;
      const [r, c, m] = d.level === 'custom' ? custom : LEVELS[d.level]; // the board must match the difficulty it claims
      if (g.rows !== r || g.cols !== c || g.mineCount !== m) return false;
      this.level = d.level; this.custom = custom; this.game = g; this.elapsed = d.elapsed;
      this.gameMode = mode; this.daily = d.daily || null;
      this.gameId++; this._cellCache = []; this.cursor = { r: 0, c: 0 }; this.rebinding = null; this.keyMessage = '';
      this.scanMode = false; this.hintCell = null; this.hintMessage = ''; this.notice = '';
      this.replay = null; this.frames = null; this.resultDismissed = null;
      this.recordedGame = record ? -1 : this.gameId;
      this.storage.setItem('ms-level', this.level); this.storage.setItem('ms-custom', JSON.stringify(this.custom));
      this._changed(); // loading never records a result by itself
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

    // ---- Export / import of settings (difficulty, custom size, options, keys, mute, volume; not scores or the game) ----
    exportSettings() {
      return JSON.stringify({ version: 1, type: 'settings', level: this.level, custom: this.custom, options: this.options,
                              keys: this.keys, muted: this.muted, volume: this.volume }, null, 2);
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
      let keys = this.keys, options = this.options;
      if ('keys' in d && !(keys = parseKeys(d.keys))) return fail('Bad key map (reserved, empty or duplicate keys)');
      if ('options' in d && !(options = parseOptions(d.options))) return fail('Bad game options');
      if ('muted' in d && typeof d.muted !== 'boolean') return fail('Bad mute value');
      if ('volume' in d && !(typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1)) return fail('Volume must be between 0 and 1');
      // Everything validated: apply.
      this.keys = keys; this.storage.setItem('ms-keys', JSON.stringify(keys));
      this.options = options; this.storage.setItem('ms-options', JSON.stringify(options));
      if ('muted' in d) { this.muted = d.muted; this.storage.setItem('ms-muted', d.muted ? 1 : 0); }
      if ('volume' in d) { this.volume = d.volume; this.storage.setItem('ms-volume', d.volume); }
      this.custom = custom;
      this.rebinding = null; this.keyMessage = '';
      this.start('level' in d ? d.level : this.level, custom);
      return { ok: true };
    }

    // ---- Best times: the TOP fastest wins per difficulty (classic rules only; see _recordFinish) ----
    best() { const list = this.scores[this.level]; return list && list.length ? list[0].t : null; }
    _loadScores() {
      let saved = {};
      try { saved = JSON.parse(this.storage.getItem('ms-scores')) || {}; } catch (e) {}
      const out = {};
      for (const level of Object.keys(LEVELS)) {
        let list = (Array.isArray(saved[level]) ? saved[level] : []).filter(e => e && Number.isInteger(e.t) && e.t > 0)
          .map(e => ({ t: e.t, at: Number.isFinite(e.at) ? e.at : null }));
        const old = Number(this.storage.getItem('ms-best-' + level)); // single best time saved by an older version
        if (!list.length && old > 0) list = [{ t: old, at: null }];
        out[level] = list.sort((a, b) => a.t - b.t).slice(0, TOP);
      }
      return out;
    }
    _recordWin() {
      this.scores = this._loadScores(); // pick up wins recorded meanwhile by another tab
      const list = this.scores[this.level];
      list.push({ t: this.elapsed, at: Date.now() });
      list.sort((a, b) => a.t - b.t); list.length = Math.min(list.length, TOP);
      this.storage.setItem('ms-scores', JSON.stringify(this.scores));
    }
    clearScores() {
      this.scores = { beginner: [], intermediate: [], expert: [] };
      this.storage.setItem('ms-scores', JSON.stringify(this.scores));
      for (const level of Object.keys(LEVELS)) this.storage.setItem('ms-best-' + level, 0); // so an old single best doesn't come back
      this._emit();
    }

    // ---- Statistics and achievements ----
    _loadStats() {
      const base = emptyStats();
      try {
        const s = JSON.parse(this.storage.getItem('ms-stats'));
        for (const k of ['played', 'won', 'lost', 'duels', 'streak', 'bestStreak']) if (Number.isInteger(s[k]) && s[k] >= 0) base[k] = s[k];
        if (Number.isFinite(s.bestBvs) && s.bestBvs >= 0) base.bestBvs = s.bestBvs;
        const l = s.last;
        if (l && Number.isInteger(l.bv) && Number.isInteger(l.time) && (l.bvs === null || Number.isFinite(l.bvs)) && typeof l.won === 'boolean') base.last = { bv: l.bv, time: l.time, bvs: l.bvs, won: l.won };
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
    clearStats() {
      this.stats = emptyStats(); this.unlocked = {};
      this.storage.setItem('ms-stats', JSON.stringify(this.stats)); this.storage.setItem('ms-ach', '{}');
      this._emit();
    }

    // Once per game, when it first finishes by a player move or the clock: statistics, best time, badges.
    _recordFinish() {
      const g = this.game, status = g.status, won = status === 'won', st = this.stats;
      this.recordedGame = this.gameId;
      const bv = g.minesPlaced ? g.bbbv() : 0;
      const bvs = won && this.elapsed > 0 && this.gameMode !== 'zen' ? Math.round((bv / this.elapsed) * 100) / 100 : null;
      if (g.players === 2) st.duels++;           // two-player games do not count as wins or losses
      else {
        st.played++;
        if (won) { st.won++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); } else { st.lost++; st.streak = 0; }
        if (bvs && bvs > st.bestBvs) st.bestBvs = bvs;
        st.last = { bv, time: this.elapsed, bvs, won };
      }
      this.storage.setItem('ms-stats', JSON.stringify(st));
      // Best times: only comparable games - classic rules, square board, no power-ups, no hints, not custom, not zen/timed
      if (won && this.gameMode === 'classic' && g.topology === 'square' && !g.powerups && g.hintsUsed === 0 && this.level !== 'custom' && this.elapsed > 0) this._recordWin();
      const ctx = { won, level: this.level, mode: this.gameMode, topology: g.topology, noGuess: g.noGuess && g.guessFree, undos: g.undoCount,
                    hints: g.hintsUsed, time: this.elapsed, lives: g.lives, shieldUsed: g.powerups && g.shield === 0, streak: st.streak,
                    daily: !!this.daily, players: g.players };
      const fresh = ACHIEVEMENTS.filter(a => !this.unlocked[a.id] && a.test(ctx));
      for (const a of fresh) this.unlocked[a.id] = Date.now();
      if (fresh.length) { this.storage.setItem('ms-ach', JSON.stringify(this.unlocked)); this.notice = '🏆 Unlocked: ' + fresh.map(a => a.name).join(', '); }
    }

    // ---- Saved-game slots (SLOTS of them, kept until overwritten or deleted; separate from the autosave) ----
    _slotLabel(n) {
      try {
        const d = JSON.parse(this.storage.getItem('ms-slot-' + n));
        if (!d || d.type !== 'game' || !isLevel(d.level) || !d.game || typeof d.game.status !== 'string') return null;
        const when = Number.isFinite(d.savedAt) ? ', saved ' + new Date(d.savedAt).toLocaleString() : '';
        return LEVEL_NAMES[d.level] + ', ' + d.game.status + ', ' + d.elapsed + 's' + when;
      } catch (e) { return null; }
    }
    saveSlot(n) {
      if (!Number.isInteger(n) || n < 1 || n > SLOTS) return false;
      this.storage.setItem('ms-slot-' + n, JSON.stringify({ ...this._gameData(), savedAt: Date.now() }));
      this.slotLabels[n - 1] = this._slotLabel(n);
      this._emit();
      return true;
    }
    // False (nothing changes) if the slot is empty or its data is not a consistent saved game.
    loadSlot(n) {
      if (!Number.isInteger(n) || n < 1 || n > SLOTS) return false;
      try { return this._loadGameData(JSON.parse(this.storage.getItem('ms-slot-' + n)), true); } catch (e) { return false; }
    }
    deleteSlot(n) {
      if (!Number.isInteger(n) || n < 1 || n > SLOTS) return false;
      this.storage.setItem('ms-slot-' + n, '');
      this.slotLabels[n - 1] = null;
      this._emit();
      return true;
    }

    // ---- First-time tips, settings tab, result overlay ----
    currentTip() {
      const g = this.game;
      if (this.replay || g.status !== 'playing') return null;
      const has = { flag: true, chord: g.started() && g.cells.flat().some(c => c.revealed && !c.mine && c.adjacent > 0) };
      return TIPS.find(t => !this.seenTips.includes(t.id) && has[t.id]) || null;
    }
    _tipUsed(id) { // doing the thing the tip explains counts as having seen it
      if (!this.seenTips.includes(id)) { this.seenTips = [...this.seenTips, id]; this.storage.setItem('ms-tips', JSON.stringify(this.seenTips)); }
    }
    dismissTip() { const t = this.currentTip(); if (t) { this._tipUsed(t.id); this._emit(); } }
    resetTips() { this.seenTips = []; this.storage.setItem('ms-tips', '[]'); this._emit(); }
    setTab(tab) { if (!TABS.includes(tab)) return false; this.settingsTab = tab; this.storage.setItem('ms-tab', tab); this._emit(); return true; }
    _resultKey() { return [this.gameId, this.game.status, this.game.moveCount, this.undoRedoCount].join(':'); }
    dismissResult() { this.resultDismissed = this._resultKey(); this._emit(); }

    // player: true after a player move (click/chord) or the clock running out, so undo/redo and loading never add a result.
    _changed(player = false) {
      this.hintCell = null; this.hintMessage = ''; this.notice = '';
      if (!this.game.started()) this.elapsed = 0; // nothing played: new game or first move undone
      if (player && this.game.status !== 'playing' && this.recordedGame !== this.gameId) this._recordFinish();
      this.save();
      this._emit();
    }

    // ---- Notifying the view ----
    // Every change goes through here. Before the view is told, work out which cells should animate: cells just opened pop
    // (flood-fills ripple outward from the click), cells just flagged bounce, a blocked cell shakes.
    _emit() {
      this._computeAnim();
      const st = this.state();
      this._anim = null;
      this.onChange(st);
    }
    _computeAnim() {
      const g = this.game, frame = this.replay ? this.frames[this.replay.index] : null;
      const marks = (frame ? frame.cells : g.cells).flat().map(c => (c.revealed ? 2 : c.flagged ? 1 : c.question ? 3 : 0));
      const key = this.gameId + (this.replay ? 'r' : 'g'), prev = this._prevMarks, anim = new Map();
      if (prev && this._prevKey === key && prev.length === marks.length) {
        const opened = [];
        marks.forEach((m, i) => {
          if (m === 2 && prev[i] !== 2) opened.push(i);
          else if ((m === 1 || m === 3) && prev[i] !== m) anim.set(i, { name: 'flag', delay: 0 });
        });
        for (const i of opened) {
          const ring = Math.max(Math.abs(Math.floor(i / g.cols) - this.cursor.r), Math.abs((i % g.cols) - this.cursor.c));
          anim.set(i, { name: 'pop', delay: opened.length > 1 ? Math.min(ring * 30, 450) : 0 });
        }
      }
      if (this._pendingBlocked) { // two alternating animation names so a repeated shake restarts
        anim.set(this._pendingBlocked.r * g.cols + this._pendingBlocked.c, { name: 'shake' + (this.shakeSeq++ % 2), delay: 0 });
        this._pendingBlocked = null;
      }
      this._anim = anim; this._prevMarks = marks; this._prevKey = key;
    }

    // ---- What the views draw ----
    // One {text, cls, label, anim, delay} per cell, so every view shows exactly the same thing. cls holds CSS class names,
    // label is the screen-reader description, anim/delay say how to animate it. A cell whose look did not change keeps the
    // very same object as last time, so views can skip it.
    _grid(cells, status, scans, hint, cursor, exploded) {
      const g = this.game, hex = g.topology === 'hex', dim = this.options.dimNumbers, over = status === 'lost' || status === 'timeout';
      const scanAt = new Map(scans.map(s => [s.r * g.cols + s.c, s.n]));
      return cells.map((row, r) => row.map((cell, c) => {
        const i = r * g.cols + c, cls = [];
        let text = '', what;
        if (cursor && cursor.r === r && cursor.c === c) cls.push('cursor');
        if (hex) { cls.push('hex'); if (r % 2 === 1) cls.push('odd'); }
        if (cell.revealed) {
          cls.push('open');
          if (cell.mine) { cls.push('boom'); text = '💣'; what = 'mine'; if (exploded && exploded.r === r && exploded.c === c) { cls.push('exploded'); what = 'mine, exploded'; } }
          else if (cell.adjacent) {
            text = String(cell.adjacent); cls.push('n' + cell.adjacent);
            what = `${cell.adjacent} ${cell.adjacent === 1 ? 'mine' : 'mines'} nearby`;
            // a number whose flags are all placed is dimmed
            if (dim && g.neighbors(r, c).filter(([y, x]) => cells[y][x].flagged).length === cell.adjacent) { cls.push('done'); what += ', all flags placed'; }
          } else what = 'empty';
        } else if (cell.flagged) {
          text = '🚩'; what = 'flagged';
          if (over && !cell.mine) { cls.push('wrong'); what = 'flagged, wrong'; } // a flag on a safe cell gets a cross
        } else if (cell.question) { text = '?'; what = 'question mark'; if (over) cls.push('faded'); }
        else if (over && cell.mine) { text = '💣'; cls.push('mine'); what = 'mine'; }
        else if (scanAt.has(i)) { text = '🔍' + scanAt.get(i); cls.push('scan'); what = `hidden, scanner found ${scanAt.get(i)} around`; if (over) cls.push('faded'); }
        else { what = 'hidden'; if (over) cls.push('faded'); }                   // after the game ends the rest is dimmed
        if (hint && hint.r === r && hint.c === c) { cls.push('hint'); what += ', hint: safe to open'; }
        const a = this._anim && this._anim.get(i);
        const next = { text, cls: cls.join(' '), label: `Row ${r + 1}, column ${c + 1}, ${what}`, anim: a ? a.name : '', delay: a ? a.delay : 0 };
        const old = this._cellCache[i];
        const same = old && old.text === next.text && old.cls === next.cls && old.label === next.label && old.anim === next.anim && old.delay === next.delay;
        return same ? old : (this._cellCache[i] = next);
      }));
    }

    _statusText(status, g) {
      if (this.replay) {
        const { index } = this.replay, last = this.frames.length - 1;
        return `Replay: move ${index} of ${last}` + (index === last ? ' - ' + { won: 'you won', lost: 'you hit a mine', timeout: 'time ran out', playing: '' }[status] : '');
      }
      const two = g.players === 2, other = 2 - g.current;
      let text;
      if (status === 'won') {
        const [a, b] = g.scores;
        text = two ? (a === b ? `🎉 Board cleared! It's a draw, ${a} each.` : `🎉 Board cleared! Player ${a > b ? 1 : 2} wins, ${Math.max(a, b)} to ${Math.min(a, b)}.`) : '🎉 You won!';
      } else if (status === 'lost') {
        text = two ? `💥 Boom! Player ${g.current + 1} hit a mine, so Player ${other} wins.` :
               g.initialLives !== null ? '💥 Boom! Out of lives.' + (g.canUndo() ? ' Press Undo to take it back.' : '') :
               '💥 Boom! You lost.' + (g.canUndo() ? ' Press Undo to take it back.' : '');
      } else if (status === 'timeout') text = '⏱ Time is up! You lost.';
      else {
        const parts = ['Playing - click to reveal, click a number to chord, right-click to flag (or use the keyboard)'];
        if (g.initialLives !== null) parts.push('Lives: ' + '❤️'.repeat(g.lives));
        if (g.powerups) parts.push(`Scanner ${g.scanner}, Shield ${g.shield}` + (this.scanMode ? ' - click a cell to scan it' : ''));
        if (two) parts.push(`Player ${g.current + 1}'s turn (scores ${g.scores[0]} : ${g.scores[1]})`);
        if (g.undosLeft !== null) parts.push('Undos left: ' + g.undosLeft);
        if (this.gameMode === 'undopenalty') parts.push(`Each undo costs ${UNDO_PENALTY} s`);
        if (this.gameMode === 'timeattack') parts.push('Time attack: beat the clock');
        if (this.gameMode === 'zen') parts.push('Zen mode: no clock, no records');
        if (this.daily) parts.push('Daily challenge ' + this.daily);
        if (g.noGuess) parts.push(g.minesPlaced && !g.guessFree ? 'No-guess board (could not be built, you may need to guess)' : 'No-guess board');
        if (this.hintMessage) parts.push(this.hintMessage);
        text = parts.join(' | ');
      }
      return this.notice ? text + ' ' + this.notice : text;
    }

    // The win/lose overlay: null while playing, during a replay, or after it was closed.
    _result(status, g) {
      if (this.replay || status === 'playing' || this.resultDismissed === this._resultKey()) return null;
      const title = { won: g.players === 2 ? 'Board cleared!' : 'You won!', lost: 'Boom!', timeout: "Time's up!" }[status];
      const best = this.best();
      // (the title already says what happened, so the detail only adds what you can do about it)
      const detail = g.players === 2 ? this._statusText(status, g) : status === 'won' ? (this.notice || 'Nicely done!') :
                     status === 'lost' && g.canUndo() ? 'Press Undo to take it back.' : 'Start a new game to try again.';
      return { kind: status, title, detail, time: this.gameMode === 'zen' ? '–' : this.elapsed + ' s',
               best: best ? best + ' s' : '–', canUndo: g.canUndo(), canReplay: g.moveCount > 0 };
    }

    _statsRows() {
      const s = this.stats, decided = s.won + s.lost, l = s.last;
      return [['Games played', s.played], ['Won', s.won], ['Lost', s.lost], ['Win rate', decided ? Math.round((s.won / decided) * 100) + '%' : '–'],
              ['Win streak now', s.streak], ['Best win streak', s.bestStreak], ['Best 3BV/s', s.bestBvs || '–'],
              ['Last game 3BV', l ? l.bv : '–'], ['Last game 3BV/s', l && l.bvs ? l.bvs : '–'], ['Two-player games', s.duels]];
    }

    state() {
      const g = this.game, frame = this.replay ? this.frames[this.replay.index] : null;
      const cells = frame ? frame.cells : g.cells, status = frame ? frame.status : g.status;
      return { gameId: this.gameId, level: this.level, custom: this.custom, rows: g.rows, cols: g.cols, topology: g.topology,
               cells, status, grid: this._grid(cells, status, frame ? frame.scans : g.scans, frame ? null : this.hintCell, frame ? null : this.cursor, frame ? frame.exploded : g.exploded),
               statusText: this._statusText(status, g), cursor: this.cursor, minesLeft: g.minesLeft(),
               keys: this.keys, rebinding: this.rebinding, keyMessage: this.keyMessage, muted: this.muted, volume: this.volume,
               time: this.elapsed, timeText: this.timeText(), best: this.best(), scoreRows: TOP,
               scores: Object.fromEntries(Object.entries(this.scores).map(([l, list]) => [l, list.map(e => ({ t: e.t, date: e.at ? new Date(e.at).toLocaleDateString() : '' }))])),
               slots: this.slotLabels.map((label, i) => ({ n: i + 1, label })), canUndo: this._blocked() ? false : g.canUndo(), canRedo: this._blocked() ? false : g.canRedo(),
               options: this.options,
               optionsPending: this.options.mode !== this.gameMode || this.options.board !== g.topology || this.options.noGuess !== g.noGuess || this.options.powerups !== g.powerups,
               powerups: g.powerups, scanner: g.scanner, shield: g.shield, scanMode: this.scanMode, lives: g.lives,
               players: g.players, current: g.current, playerScores: g.scores, undosLeft: g.undosLeft,
               replay: this.replay ? { index: this.replay.index, total: this.frames.length - 1, playing: this.replay.playing } : null,
               canReplay: g.status !== 'playing' && g.moveCount > 0, daily: this.daily, shareCode: this.shareCode(),
               face: { playing: '🙂', won: '😎', lost: '😵', timeout: '😫' }[status], flagMode: this.flagMode, flashSeq: this.flashSeq,
               tip: this.currentTip(), settingsTab: this.settingsTab, result: this._result(status, g),
               stats: this._statsRows(),
               achievements: ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, desc: a.desc, unlocked: !!this.unlocked[a.id] })) };
    }
  }

  const api = { ViewModel, LEVELS, clampCustom, cellSize, DEFAULT_KEYS, ACTION_LABELS, LEVEL_NAMES, OPTION_DEFS, DEFAULT_OPTIONS, ACHIEVEMENTS, TABS, TIPS };
  if (typeof module !== 'undefined') module.exports = api;
  else Object.assign(root, { ViewModel, cellSize, ACTION_LABELS, LEVEL_NAMES, OPTION_DEFS, TABS });
})(this);
