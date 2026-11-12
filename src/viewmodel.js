// ViewModel (MVVM): the facade between the Game (model) and the view (app.js). It owns the things that are about the
// session rather than about board rules - which game is on, the clock, hints, replay, tips - and hands everything else to
// small classes: Options, KeyBindings, Stats, SaveManager (what is remembered), Modes (how each game mode behaves) and
// BoardPresenter (what each cell looks like). It exposes commands and one plain state() object, and never touches the
// DOM, so it can be tested without a browser.
// Observer: views subscribe({onChange, onTick}); every change calls onChange(state), every clock second calls onTick(text).
(function (root) {
  const dep = (name, global) => (typeof module !== 'undefined' ? require(name) : root[global]);
  const Game = typeof module !== 'undefined' ? require('./game.js').Game : root.Game;
  const Rng = dep('./rng.js', 'Rng'), Levels = dep('./levels.js', 'Levels'), Modes = dep('./modes.js', 'Modes'), Options = dep('./options.js', 'Options');
  const KeyBindings = dep('./keybindings.js', 'KeyBindings'), Stats = dep('./stats.js', 'Stats'), SaveManager = dep('./savemanager.js', 'SaveManager');
  const BoardPresenter = dep('./presenter.js', 'BoardPresenter');
  const { LEVELS, LEVEL_NAMES, isLevel, clampCustom, levelFor } = Levels;

  const TABS = ['game', 'controls', 'appearance', 'data'];   // Settings dialog tabs
  // One-time tips, shown in this order when they become relevant. `id` is remembered once the tip is dismissed or used.
  const TIPS = [
    { id: 'flag', text: 'Tip: right-click a cell to flag a mine (long-press on a phone, or turn on Flag mode). Right-click again for a ? mark.' },
    { id: 'chord', text: 'Tip: click a number whose flags are all placed to open its remaining neighbours in one go (chording).' },
  ];

  // Cell size in px so the whole board fits a w x h area (2px gaps), between `min` (16; views pass 32 on touch screens,
  // where a board that is too big scrolls inside itself) and 40.
  function cellSize(rows, cols, w, h, min = 16) {
    const fit = (n, room) => Math.floor((room - 2 * (n - 1)) / n);
    return Math.max(min, Math.min(40, fit(cols, w), fit(rows, h)));
  }

  class ViewModel {
    // storage: {getItem, setItem}. hooks: onChange(state) after any change, onTick(timeText) every timer tick (more can be
    // added with subscribe). rng: random source (Math.random, or a seeded one for reproducible boards). play: a parsed
    // share link (see rng.js). now: returns the current Date (replaced in tests).
    constructor(storage, { onChange, onTick, rng = Math.random, play = null, now = () => new Date() } = {}) {
      this.storage = storage; this.rng = rng; this.now = now;
      this.listeners = [];
      this.subscribe({ onChange, onTick });
      this.custom = [9, 9, 10];
      this.gameId = 0;          // increments on every new game (views use it to tell "new game" from "undo")
      this.rebinding = null;    // action waiting for its next key press, or null
      this.keyMessage = '';
      this.replay = null; this.frames = null;
      this.flagMode = false;       // taps flag instead of reveal (for phones)
      this.undoRedoCount = 0;      // part of the result overlay's key: undoing and ending again shows the overlay again
      this.flashSeq = 0;           // blocked-move feedback counter
      this._pendingBlocked = null;
      this.resultDismissed = null;
      // What is remembered between visits (each class loads its own data; corrupt or missing data falls back to defaults).
      this._options = new Options(storage);
      this.bindings = new KeyBindings(storage);
      this.progress = new Stats(storage);
      this.saves = new SaveManager(storage, rng);
      this.presenter = new BoardPresenter();
      let seen = [];
      try { seen = JSON.parse(storage.getItem('ms-tips')); } catch (e) {}
      this.seenTips = Array.isArray(seen) ? seen.filter(id => TIPS.some(t => t.id === id)) : [];
      const tab = storage.getItem('ms-tab');
      this.settingsTab = TABS.includes(tab) ? tab : 'game';
      try { const c = JSON.parse(storage.getItem('ms-custom')); if (Array.isArray(c) && c.length === 3) this.custom = clampCustom(c); } catch (e) {}
      const v = storage.getItem('ms-volume');
      this.muted = storage.getItem('ms-muted') === '1';
      this.volume = v === null || isNaN(Number(v)) ? 0.5 : Math.min(1, Math.max(0, Number(v)));
      const saved = storage.getItem('ms-level');
      if (play) { this._startPlay(play); return; }   // a share link wins over the autosave
      // Resume a game in progress (autosaved after every change). Finished or untouched games start fresh instead.
      const d = this.saves.readAutosave();
      const resumed = !!(d && d.game && d.game.status === 'playing' && Array.isArray(d.game.history) && d.game.history.length > 0 && this._loadGameData(d, true));
      if (!resumed) this.start(isLevel(saved) ? saved : 'beginner');
    }

    // ---- Observer ----
    // Add a listener ({onChange, onTick}, either may be missing). Returns a function that removes it again.
    subscribe(listener) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter(l => l !== listener); };
    }
    _notify(state) { for (const l of this.listeners.slice()) if (l.onChange) l.onChange(state); }
    _notifyTick(text) { for (const l of this.listeners.slice()) if (l.onTick) l.onTick(text); }

    // Settings objects, shown as plain properties.
    get options() { return this._options.values; }
    get keys() { return this.bindings.keys; }
    get stats() { return this.progress.counters; }
    get unlocked() { return this.progress.unlocked; }
    get scores() { return this.progress.scores; }

    // ---- Starting games ----
    // Start a new game. extra: {seed, topology} reproduces a board (share links); {daily, seed} is the daily challenge.
    start(level = this.level, custom = this.custom, extra = {}) {
      this.level = level;
      if (level === 'custom') this.custom = custom = clampCustom(custom);
      const [r, c, m] = level === 'custom' ? custom : LEVELS[level];
      const o = this.options, seeded = extra.seed !== undefined, daily = extra.daily || null;
      const mode = Modes.get(daily ? 'classic' : o.mode); // the daily challenge is the same for everybody: plain classic rules
      const opts = { ...mode.gameOptions(), topology: extra.topology || (daily ? 'square' : o.board), noGuess: !seeded && o.noGuess,
                     powerups: !daily && o.powerups, seed: extra.seed };
      this.game = new Game(r, c, m, this.rng, opts);
      this._setMode(mode.id); this.daily = daily;
      this.gameId++; this.presenter.reset();
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
    _setMode(id) { this.gameMode = id; this.mode = Modes.get(id); }

    _startPlay(p) { // p: {rows, cols, mines, topology, seed} from a share link
      this.start(levelFor(p.rows, p.cols, p.mines), [p.rows, p.cols, p.mines], { seed: p.seed, topology: p.topology });
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
      if (ok) this.elapsed += this.mode.undoPenalty; // the "undo costs time" mode
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

    // ---- Clock (what it does is up to the game mode) ----
    timeLimit() { return this.mode.timeLimit(this.game); }
    timeText() { return this.mode.timeText(this.elapsed, this.game); }
    // Called every second by the view. The clock runs only while a game is in progress (a move was made, not finished).
    tick() {
      if (this.replay) { if (this.replay.playing) this.replayStep(1); return; }
      if (!this.mode.usesClock || this.game.status !== 'playing' || !this.game.started()) return;
      this.elapsed++;
      if (this.mode.clockExpired(this.elapsed, this.game)) { this.game.endByTimeout(); this._changed(true); }
      this._notifyTick(this.timeText());
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

    // ---- Options, key bindings, sound (the data lives in Options / KeyBindings) ----
    setOption(key, value) { const ok = this._options.set(key, value); if (ok) this._emit(); return ok; }

    // actionFor: which action a pressed key triggers (undefined = none).
    actionFor(key) { return this.bindings.actionFor(key); }

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
    addKey(action, key) { const ok = this.bindings.add(action, key); if (ok) this._emit(); return ok; }
    removeKey(action, key) { const ok = this.bindings.remove(action, key); if (ok) this._emit(); return ok; }
    rebind(action, key) { const ok = this.bindings.rebind(action, key); if (ok) this._emit(); return ok; }
    resetKeys() { this.rebinding = null; this.keyMessage = ''; this.bindings.reset(); this._emit(); }

    setMuted(m) { this.muted = !!m; this.storage.setItem('ms-muted', this.muted ? 1 : 0); this._emit(); }
    setVolume(v) { this.volume = Math.min(1, Math.max(0, Number(v) || 0)); this.storage.setItem('ms-volume', this.volume); this._emit(); }

    // ---- Saving (the work is done by SaveManager) ----
    _info() { return { level: this.level, custom: this.custom, mode: this.gameMode, daily: this.daily, elapsed: this.elapsed, game: this.game }; }
    save() { this.saves.autosave(this._info()); } // views also call this when the page is hidden
    exportGame() { return this.saves.exportGame(this._info()); }

    // Validate then apply (all-or-nothing). Returns false, changing nothing, if the data is not a consistent saved game.
    // record: whether finishing this game counts for statistics and best times (own autosave and slots yes, uploaded files no).
    _loadGameData(d, record = false) {
      const p = SaveManager.parse(d, this.rng);
      if (!p) return false;
      this.level = p.level; this.custom = p.custom; this.game = p.game; this.elapsed = p.elapsed;
      this._setMode(p.mode); this.daily = p.daily;
      this.gameId++; this.presenter.reset(); this.cursor = { r: 0, c: 0 }; this.rebinding = null; this.keyMessage = '';
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
      if ('keys' in d && !(keys = KeyBindings.parse(d.keys))) return fail('Bad key map (reserved, empty or duplicate keys)');
      if ('options' in d && !(options = Options.parse(d.options))) return fail('Bad game options');
      if ('muted' in d && typeof d.muted !== 'boolean') return fail('Bad mute value');
      if ('volume' in d && !(typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1)) return fail('Volume must be between 0 and 1');
      // Everything validated: apply.
      this.bindings.replace(keys); this._options.replace(options);
      if ('muted' in d) { this.muted = d.muted; this.storage.setItem('ms-muted', d.muted ? 1 : 0); }
      if ('volume' in d) { this.volume = d.volume; this.storage.setItem('ms-volume', d.volume); }
      this.custom = custom;
      this.rebinding = null; this.keyMessage = '';
      this.start('level' in d ? d.level : this.level, custom);
      return { ok: true };
    }

    // ---- Best times, statistics, badges (the data lives in Stats) ----
    best() { return this.progress.best(this.level); }
    clearScores() { this.progress.clearScores(); this._emit(); }
    clearStats() { this.progress.clearStats(); this._emit(); }

    // Once per game, when it first finishes by a player move or the clock: statistics, best time, badges.
    _recordFinish() {
      const g = this.game;
      this.recordedGame = this.gameId;
      this.notice = this.progress.record({
        won: g.status === 'won', level: this.level, mode: this.gameMode, topology: g.topology, noGuess: g.noGuess && g.guessFree,
        undos: g.undoCount, hints: g.hintsUsed, time: this.elapsed, lives: g.lives, shieldUsed: g.powerups && g.shield === 0,
        daily: !!this.daily, players: g.players, bv: g.minesPlaced ? g.bbbv() : 0, timed: this.mode.usesClock,
        // best times only count for comparable games: classic rules, square board, no power-ups, no hints, not custom
        eligibleForBest: this.mode.recordsBestTimes && g.topology === 'square' && !g.powerups && g.hintsUsed === 0 && this.level !== 'custom',
      });
    }

    // ---- Saved-game slots (the data lives in SaveManager) ----
    saveSlot(n) { if (!this.saves.saveSlot(n, this._info())) return false; this._emit(); return true; }
    // False (nothing changes) if the slot is empty or its data is not a consistent saved game.
    loadSlot(n) { const d = this.saves.readSlot(n); return d ? this._loadGameData(d, true) : false; }
    deleteSlot(n) { if (!this.saves.deleteSlot(n)) return false; this._emit(); return true; }

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

    // Every change goes through here: work out the cell animations, build the state, tell the subscribers.
    _emit() {
      const g = this.game, frame = this.replay ? this.frames[this.replay.index] : null;
      this.presenter.prepare({ cells: frame ? frame.cells : g.cells, cols: g.cols, key: this.gameId + (this.replay ? 'r' : 'g'),
                               cursor: this.cursor, blocked: this._pendingBlocked });
      this._pendingBlocked = null;
      const st = this.state();
      this.presenter.done();
      this._notify(st);
    }

    // ---- What the views draw ----
    _statusText(status, g) {
      if (this.replay) {
        const { index } = this.replay, last = this.frames.length - 1;
        return `Replay: move ${index} of ${last}` + (index === last ? ' - ' + { won: 'you won', lost: 'you hit a mine', timeout: 'time ran out', playing: '' }[status] : '');
      }
      let text;
      if (status !== 'playing') text = this.mode.outcomeText(status, g);
      else {
        const parts = ['Playing - click to reveal, click a number to chord, right-click to flag (or use the keyboard)'];
        if (g.powerups) parts.push(`Scanner ${g.scanner}, Shield ${g.shield}` + (this.scanMode ? ' - click a cell to scan it' : ''));
        parts.push(...this.mode.statusParts(g));
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
      const best = this.best();
      return { kind: status, title: this.mode.resultTitle(status, g), detail: this.mode.resultDetail(status, g, this.notice),
               time: this.mode.usesClock ? this.elapsed + ' s' : '–', best: best ? best + ' s' : '–', canUndo: g.canUndo(), canReplay: g.moveCount > 0 };
    }

    state() {
      const g = this.game, frame = this.replay ? this.frames[this.replay.index] : null;
      const cells = frame ? frame.cells : g.cells, status = frame ? frame.status : g.status, o = this.options;
      const grid = this.presenter.grid({ cells, cols: g.cols, hex: g.topology === 'hex', dim: o.dimNumbers, status, scans: frame ? frame.scans : g.scans,
        hint: frame ? null : this.hintCell, cursor: frame ? null : this.cursor, exploded: frame ? frame.exploded : g.exploded, neighbors: (r, c) => g.neighbors(r, c) });
      return { gameId: this.gameId, level: this.level, custom: this.custom, rows: g.rows, cols: g.cols, topology: g.topology,
               cells, status, grid, statusText: this._statusText(status, g), cursor: this.cursor, minesLeft: g.minesLeft(),
               keys: this.keys, rebinding: this.rebinding, keyMessage: this.keyMessage, muted: this.muted, volume: this.volume,
               time: this.elapsed, timeText: this.timeText(), best: this.best(), scoreRows: Stats.TOP, scores: this.progress.scoresView(),
               slots: this.saves.slotLabels.map((label, i) => ({ n: i + 1, label })),
               canUndo: this._blocked() ? false : g.canUndo(), canRedo: this._blocked() ? false : g.canRedo(),
               options: o, optionsPending: o.mode !== this.gameMode || o.board !== g.topology || o.noGuess !== g.noGuess || o.powerups !== g.powerups,
               powerups: g.powerups, scanner: g.scanner, shield: g.shield, scanMode: this.scanMode, lives: g.lives,
               players: g.players, current: g.current, playerScores: g.scores, undosLeft: g.undosLeft,
               replay: this.replay ? { index: this.replay.index, total: this.frames.length - 1, playing: this.replay.playing } : null,
               canReplay: g.status !== 'playing' && g.moveCount > 0, daily: this.daily, shareCode: this.shareCode(),
               face: { playing: '🙂', won: '😎', lost: '😵', timeout: '😫' }[status], flagMode: this.flagMode, flashSeq: this.flashSeq,
               tip: this.currentTip(), settingsTab: this.settingsTab, result: this._result(status, g),
               stats: this.progress.rows(), achievements: this.progress.achievementsView() };
    }
  }

  const api = { ViewModel, LEVELS, clampCustom, cellSize, DEFAULT_KEYS: KeyBindings.DEFAULT_KEYS, ACTION_LABELS: KeyBindings.LABELS, LEVEL_NAMES,
                OPTION_DEFS: Options.DEFS, DEFAULT_OPTIONS: Options.DEFAULTS, ACHIEVEMENTS: Stats.ACHIEVEMENTS, TABS, TIPS };
  if (typeof module !== 'undefined') module.exports = api;
  else Object.assign(root, { ViewModel, cellSize, ACTION_LABELS: KeyBindings.LABELS, LEVEL_NAMES, OPTION_DEFS: Options.DEFS, TABS });
})(this);
