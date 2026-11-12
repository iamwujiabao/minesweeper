// The player's game and appearance options: what they are, which values are allowed, and saving them.
(function (root) {
  const Modes = typeof module !== 'undefined' ? require('./modes.js') : root.Modes;
  const Puzzles = typeof module !== 'undefined' ? require('./puzzles.js') : root.Puzzles;

  // Where each option is shown: group 'newgame' = the New game menu (applies to the next new game), 'game' and
  // 'appearance' = Settings tabs, 'header' = the header. Each option and each choice has a short description.
  const DEFS = [
    { key: 'mode', label: 'Mode', group: 'newgame', type: 'select', choices: Modes.list.map(m => [m.id, m.label, m.description]) },
    { key: 'board', label: 'Board', group: 'newgame', type: 'select', choices: [
      ['square', 'Square', 'The usual board: every cell has eight neighbours.'],
      ['hex', 'Hexagonal', 'Hexagon cells with six neighbours.'],
      ['torus', 'Wrap-around', 'The edges connect, so there is no border and every cell has eight neighbours.']] },
    { key: 'puzzle', label: 'Puzzle (for Puzzle mode)', group: 'newgame', type: 'select', choices: Puzzles.list.map(p => [p.id, `${p.name} (${p.rows}x${p.cols})`, p.description]) },
    { key: 'noGuess', label: 'No-guess boards', group: 'newgame', type: 'checkbox', desc: 'Boards that can be finished by logic alone. They cannot be shared as a link.' },
    { key: 'powerups', label: 'Power-ups', group: 'newgame', type: 'checkbox', desc: 'Three scanners (count the mines around a cell) and one shield (survives one mine) per game.' },
    { key: 'questionMarks', label: 'Question marks', group: 'game', type: 'checkbox', desc: 'Right-click cycles flag, question mark, then clear. Takes effect at once.' },
    { key: 'dimNumbers', label: 'Dim finished numbers', group: 'appearance', type: 'checkbox', desc: 'Dims a number once all of its flags are placed.' },
    { key: 'theme', label: 'Theme', group: 'header', type: 'select', choices: [
      ['auto', 'Auto', 'Follows your device\'s light or dark setting.'],
      ['light', 'Light', 'Light colours.'],
      ['dark', 'Dark', 'Dark colours.'],
      ['colorblind', 'Colour-blind', 'A palette that stays distinct with colour blindness; higher numbers are also underlined.'],
      ['ocean', 'Ocean (shop)', 'Cool blues and greens. Buy it in the Shop.'],
      ['sunset', 'Sunset (shop)', 'Warm oranges and purples. Buy it in the Shop.']] },
  ];
  const DEFAULTS = { mode: 'classic', board: 'square', puzzle: 'p1', noGuess: false, powerups: false, questionMarks: true, dimNumbers: true, theme: 'auto' };

  class Options {
    constructor(storage) {
      this.storage = storage;
      let saved = null;
      try { saved = Options.parse(JSON.parse(storage.getItem('ms-options'))); } catch (e) {}
      this.values = saved || { ...DEFAULTS };         // corrupt or missing data falls back to the defaults
    }

    // Change one option. False (nothing changes) for an unknown option or a value that is not allowed.
    set(key, value) {
      const def = DEFS.find(d => d.key === key);
      if (!def) return false;
      if (def.type === 'checkbox') value = !!value;
      else if (!def.choices.some(([v]) => v === value)) return false;
      this.replace({ ...this.values, [key]: value });
      return true;
    }
    replace(values) { this.values = values; this.storage.setItem('ms-options', JSON.stringify(values)); }

    // Validate saved/imported options. Returns a full options object, or null if any value is not allowed.
    static parse(saved) {
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
      const out = { ...DEFAULTS };
      for (const [k, v] of Object.entries(saved)) {
        const def = DEFS.find(d => d.key === k);
        if (!def) return null;
        if (def.type === 'checkbox' ? typeof v !== 'boolean' : !def.choices.some(([value]) => value === v)) return null;
        out[k] = v;
      }
      return out;
    }
  }
  Options.DEFS = DEFS; Options.DEFAULTS = DEFAULTS;

  if (typeof module !== 'undefined') module.exports = Options; else root.Options = Options;
})(this);
