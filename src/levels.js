// Difficulty levels and custom board sizes.
(function (root) {
  const LEVELS = { beginner: [9, 9, 10], intermediate: [16, 16, 40], expert: [16, 30, 99] }; // rows, cols, mines
  const LEVEL_NAMES = { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert', custom: 'Custom' };
  const isLevel = l => l === 'custom' || Object.prototype.hasOwnProperty.call(LEVELS, l); // not `in`: avoids 'constructor' etc.

  // Keep custom sizes sane; max mines leaves room for the safe first-click area.
  function clampCustom([rows, cols, mines]) {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || lo));
    rows = clamp(rows, 5, 30); cols = clamp(cols, 5, 40);
    return [rows, cols, clamp(mines, 1, rows * cols - 9)];
  }

  // The level whose size is exactly rows x cols with this many mines, or 'custom'.
  const levelFor = (rows, cols, mines) => Object.keys(LEVELS).find(l => LEVELS[l][0] === rows && LEVELS[l][1] === cols && LEVELS[l][2] === mines) || 'custom';

  const api = { LEVELS, LEVEL_NAMES, isLevel, clampCustom, levelFor };
  if (typeof module !== 'undefined') module.exports = api; else root.Levels = api;
})(this);
