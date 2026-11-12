// Puzzle boards: fixed mines and some cells already open, to be solved by logic alone (no guessing needed) within a limit
// on the number of reveal or chord moves. They were picked from a search for boards that single-number logic (and the
// "one number inside another" rule for the later ones) can finish, then fixed here; test/puzzles.test.js checks again that
// each one can really be solved by logic within its limit. The limit is the moves a simple strategy needs plus 5.
(function (root) {
  const list = [
    { id: 'p1', name: 'First steps', description: 'Every move can be found by looking at one number at a time.', rows: 5, cols: 5, limit: 13,
      mines: [[0,2],[2,2],[2,4],[4,3]],
      open: [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1],[3,2],[4,0],[4,1],[4,2]] },
    { id: 'p2', name: 'Two numbers', description: 'One spot needs two neighbouring numbers read together.', rows: 6, cols: 6, limit: 21,
      mines: [[0,5],[2,0],[2,2],[3,3],[3,5],[4,2],[4,5]],
      open: [[0,0],[0,1],[0,2],[0,3],[0,4],[1,0],[1,1],[1,2],[1,3],[1,4]] },
    { id: 'p3', name: 'Chain reaction', description: 'Each safe cell you open uncovers the next clue.', rows: 7, cols: 7, limit: 35,
      mines: [[0,3],[1,5],[2,2],[3,1],[3,5],[4,1],[4,3],[5,0],[6,0],[6,3],[6,5]],
      open: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1]] },
    { id: 'p4', name: 'Tight corner', description: 'Several places where one number hides inside another.', rows: 8, cols: 8, limit: 30,
      mines: [[0,3],[2,6],[3,0],[3,2],[3,7],[4,0],[4,1],[4,5],[5,3],[5,5],[6,5],[6,6],[6,7],[7,3],[7,7]],
      open: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]] },
    { id: 'p5', name: 'Final exam', description: 'A long chain of deductions on the biggest board.', rows: 9, cols: 9, limit: 38,
      mines: [[0,3],[0,4],[0,5],[0,8],[1,2],[1,3],[1,6],[1,7],[2,8],[3,8],[4,0],[4,5],[4,7],[6,4],[7,1],[7,4],[7,5],[8,5],[8,6],[8,8]],
      open: [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1]] },
  ];
  const Puzzles = { list, ids: list.map(p => p.id), get: id => list.find(p => p.id === id) || list[0], has: id => list.some(p => p.id === id) };
  if (typeof module !== 'undefined') module.exports = Puzzles; else root.Puzzles = Puzzles;
})(this);
