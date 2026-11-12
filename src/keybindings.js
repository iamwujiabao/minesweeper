// Keyboard shortcuts: which keys trigger which action, how they can be changed, and saving them.
(function (root) {
  // Actions and their default keys (arrays: an action can have several keys). Single letters are lowercase.
  const DEFAULT_KEYS = {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    reveal: ['Enter', ' '], flag: ['f'], chord: ['c'], hint: ['h'], scanner: ['s'],
    mute: ['m'], undo: ['u'], redo: ['y'], newGame: ['n'],
  };
  const LABELS = { up: 'Cursor up', down: 'Cursor down', left: 'Cursor left', right: 'Cursor right', reveal: 'Reveal / chord',
                   flag: 'Flag', chord: 'Chord only', hint: 'Hint', scanner: 'Scanner', mute: 'Mute', undo: 'Undo', redo: 'Redo', newGame: 'New game' };
  const normKey = k => (k.length === 1 ? k.toLowerCase() : k);
  const UNBINDABLE = ['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab', 'CapsLock'];

  class KeyBindings {
    constructor(storage) {
      this.storage = storage;
      let saved = null;
      try { saved = KeyBindings.parse(JSON.parse(storage.getItem('ms-keys'))); } catch (e) {}
      this.keys = saved || { ...DEFAULT_KEYS };
    }

    // Which action a pressed key triggers (undefined = none).
    actionFor(key) { const k = normKey(key); return Object.keys(this.keys).find(a => this.keys[a].includes(k)); }

    // Add one more key to an action. False (nothing changed) for unknown actions, reserved keys, or keys already in use.
    add(action, key) {
      const k = normKey(key);
      if (!(action in DEFAULT_KEYS) || UNBINDABLE.includes(k) || this.actionFor(k)) return false;
      this.replace({ ...this.keys, [action]: [...this.keys[action], k] });
      return true;
    }
    // Remove a key from an action; every action keeps at least one key.
    remove(action, key) {
      const k = normKey(key);
      if (!(action in DEFAULT_KEYS) || !this.keys[action].includes(k) || this.keys[action].length < 2) return false;
      this.replace({ ...this.keys, [action]: this.keys[action].filter(x => x !== k) });
      return true;
    }
    // Replace an action's keys with a single key (same rules as add, but the action's own keys may be reused).
    rebind(action, key) {
      const k = normKey(key), other = this.actionFor(k);
      if (!(action in DEFAULT_KEYS) || UNBINDABLE.includes(k) || (other && other !== action)) return false;
      this.replace({ ...this.keys, [action]: [k] });
      return true;
    }
    reset() { this.replace({ ...DEFAULT_KEYS }); }
    replace(keys) { this.keys = keys; this.storage.setItem('ms-keys', JSON.stringify(keys)); }

    // Validate a saved/imported key map. Returns the full map (missing actions get defaults) or null if invalid
    // (wrong shape, empty list, reserved key, or the same key used twice).
    static parse(saved) {
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
  }
  KeyBindings.DEFAULT_KEYS = DEFAULT_KEYS; KeyBindings.LABELS = LABELS;

  if (typeof module !== 'undefined') module.exports = KeyBindings; else root.KeyBindings = KeyBindings;
})(this);
