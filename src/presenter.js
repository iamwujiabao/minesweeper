// Works out what every cell looks like (text, CSS classes, screen-reader label) and which cells should animate.
// The ViewModel asks it for a grid; the view just draws it. No DOM code.
(function (root) {
  class BoardPresenter {
    constructor() { this.reset(); }
    reset() { this.cache = []; this.anim = null; this.prevMarks = null; this.prevKey = null; this.shakeSeq = 0; }

    // Before the view is told about a change: compare with the last board to decide which cells animate - cells just
    // opened pop (a flood-fill ripples outward from the click), cells just flagged bounce, a blocked cell shakes.
    // key identifies the board being shown (so a new game or a replay never animates); cursor is the clicked cell.
    prepare({ cells, cols, key, cursor, blocked }) {
      const marks = cells.flat().map(c => (c.revealed ? 2 : c.flagged ? 1 : c.question ? 3 : 0));
      const prev = this.prevMarks, anim = new Map();
      if (prev && this.prevKey === key && prev.length === marks.length) {
        const opened = [];
        marks.forEach((m, i) => {
          if (m === 2 && prev[i] !== 2) opened.push(i);
          else if ((m === 1 || m === 3) && prev[i] !== m) anim.set(i, { name: 'flag', delay: 0 });
        });
        for (const i of opened) {
          const ring = Math.max(Math.abs(Math.floor(i / cols) - cursor.r), Math.abs((i % cols) - cursor.c));
          anim.set(i, { name: 'pop', delay: opened.length > 1 ? Math.min(ring * 30, 450) : 0 });
        }
      }
      if (blocked) anim.set(blocked.r * cols + blocked.c, { name: 'shake' + (this.shakeSeq++ % 2), delay: 0 }); // two names so a repeat restarts
      this.anim = anim; this.prevMarks = marks; this.prevKey = key;
    }
    done() { this.anim = null; }

    // One {text, cls, label, anim, delay} per cell. A cell whose look did not change keeps the very same object as last
    // time, so views can skip it. neighbors(r, c) -> [[r, c]...] is the board's topology.
    // probs: percentages per cell (or null), guess: {r, c} the best guess, wrong: a Set of cell indexes whose flag is wrong.
    grid({ cells, cols, hex, dim, status, scans, hint, cursor, exploded, neighbors, probs = null, guess = null, wrong = null }) {
      const over = status === 'lost' || status === 'timeout';
      const scanAt = new Map(scans.map(s => [s.r * cols + s.c, s.n]));
      return cells.map((row, r) => row.map((cell, c) => {
        const i = r * cols + c, cls = [];
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
            if (dim && neighbors(r, c).filter(([y, x]) => cells[y][x].flagged).length === cell.adjacent) { cls.push('done'); what += ', all flags placed'; }
          } else what = 'empty';
        } else if (cell.flagged) {
          text = '🚩'; what = 'flagged';
          if ((over && !cell.mine) || (wrong && wrong.has(i))) { cls.push('wrong'); what = 'flagged, wrong'; } // a flag on a safe cell gets a cross
        } else if (cell.question) { text = '?'; what = 'question mark'; if (over) cls.push('faded'); }
        else if (over && cell.mine) { text = '💣'; cls.push('mine'); what = 'mine'; }
        else if (scanAt.has(i)) { text = '🔍' + scanAt.get(i); cls.push('scan'); what = `hidden, scanner found ${scanAt.get(i)} around`; if (over) cls.push('faded'); }
        else if (probs && probs[i] !== null && probs[i] !== undefined) {            // the mine chance of a hidden cell
          text = probs[i] + '%'; cls.push('prob', probs[i] <= 15 ? 'prob-low' : probs[i] <= 40 ? 'prob-mid' : 'prob-high'); what = `hidden, ${probs[i]} percent chance of a mine`;
        } else { what = 'hidden'; if (over) cls.push('faded'); }                   // after the game ends the rest is dimmed
        if (guess && guess.r === r && guess.c === c) { cls.push('guess'); what += `, best guess, ${guess.chance} percent chance of a mine`; }
        if (hint && hint.r === r && hint.c === c) { cls.push('hint'); what += ', hint: safe to open'; }
        const a = this.anim && this.anim.get(i);
        const next = { text, cls: cls.join(' '), label: `Row ${r + 1}, column ${c + 1}, ${what}`, anim: a ? a.name : '', delay: a ? a.delay : 0 };
        const old = this.cache[i];
        const same = old && old.text === next.text && old.cls === next.cls && old.label === next.label && old.anim === next.anim && old.delay === next.delay;
        return same ? old : (this.cache[i] = next);
      }));
    }
  }

  if (typeof module !== 'undefined') module.exports = BoardPresenter; else root.BoardPresenter = BoardPresenter;
})(this);
