// View (MVVM), plain JavaScript: draws vm.state() and forwards DOM events to ViewModel commands. No game rules here.
// A plain script: index.html loads the other files in src/ first, so ViewModel, cellSize, Sound, Rng... are globals here.
// The board's cells are created once and only the cells that changed are updated (no rebuilding with innerHTML).

const $ = id => document.getElementById(id);
const boardEl = $('board'), levelEl = $('level'), customEl = $('custom');
let lastLongPress = 0;
const keyName = k => (k === ' ' ? 'Space' : k);
const baseUrl = () => location.href.split(/[?#]/)[0];

// localStorage can throw (private mode); fall back to "nothing stored".
const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

// ---- Game options: each form field is built once from the ViewModel's option list, then kept in sync ----
// (built before the ViewModel, whose constructor triggers the first render)
const optionEls = {};
for (const def of OPTION_DEFS) {
  const host = $('opts-' + def.group), id = 'opt-' + def.key;
  let input, note;
  if (def.type === 'select') {
    input = document.createElement('select');
    for (const [value, text] of def.choices) input.add(new Option(text, value));
    input.onchange = () => vm.setOption(def.key, input.value);
  } else {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.onchange = () => vm.setOption(def.key, input.checked);
  }
  input.id = id;
  if (def.group === 'header') { host.append(input); optionEls[def.key] = { input }; continue; } // the theme selector lives in the header
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  note = document.createElement('span');
  note.className = 'note'; note.id = id + '-desc';
  input.setAttribute('aria-describedby', note.id);
  if (def.type === 'select') { label.htmlFor = id; label.textContent = def.label; field.append(label, input, note); }
  else { label.append(input, ' ' + def.label); field.append(label, note); }
  host.append(field);
  optionEls[def.key] = { input, note, def };
}
function syncOptions(s) {
  for (const def of OPTION_DEFS) {
    const { input, note } = optionEls[def.key], value = s.options[def.key];
    if (def.type === 'select') input.value = value; else input.checked = value;
    if (note) note.textContent = def.type === 'select' ? def.choices.find(c => c[0] === value)[2] : def.desc;
  }
  $('optionsNote').textContent = s.optionsPending ? 'These apply to the next new game.' : '';
}

// (declared before the ViewModel too: its constructor triggers the first render)
let boardKey = '', cells = [], cellOf = [];            // cells: the elements; cellOf: the view-model cell each element shows
const vm = new ViewModel(storage, {
  onChange: render, onTick: t => { $('time').textContent = t; },
  rng: Rng.rngFromSearch(location.search), play: Rng.parsePlay(location.search),
});

function newGame() { vm.start(levelEl.value, [$('rows').value, $('cols').value, $('minesIn').value]); }

// ---- Board: cells are created once per board shape; after that only changed cells are touched ----
function buildBoard(s) {
  boardEl.replaceChildren();
  cells = []; cellOf = [];
  boardEl.className = s.topology === 'hex' ? 'hexboard' : '';
  boardEl.style.setProperty('--cols', s.cols);
  boardEl.setAttribute('aria-rowcount', s.rows); boardEl.setAttribute('aria-colcount', s.cols);
  for (let r = 0; r < s.rows; r++) {
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    for (let c = 0; c < s.cols; c++) {
      const el = document.createElement('div');
      el.setAttribute('role', 'gridcell');
      el.onclick = () => { if (Date.now() - lastLongPress > 600) vm.click(r, c); };            // click (reveal, chord, flag mode or scan)
      el.oncontextmenu = e => { e.preventDefault(); if (Date.now() - lastLongPress > 800) vm.flag(r, c); };
      el.onmouseenter = () => hoverOn(r, c);                                                   // highlight a number's neighbours
      el.onmouseleave = hoverOff;
      // Touch: hold 450ms to flag. lastLongPress stops the click/contextmenu that follows from acting twice.
      let timer;
      el.onpointerdown = e => { if (e.pointerType === 'touch') timer = setTimeout(() => { lastLongPress = Date.now(); vm.flag(r, c); }, 450); };
      el.onpointerup = el.onpointerleave = el.onpointercancel = () => clearTimeout(timer);
      row.append(el); cells.push(el); cellOf.push(null);
    }
    boardEl.append(row);
  }
}
function updateBoard(s) {
  const key = `${s.rows}x${s.cols}${s.topology}`;
  if (key !== boardKey) { boardKey = key; buildBoard(s); }
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++) {
      const i = r * s.cols + c, cell = s.grid[r][c];
      if (cellOf[i] === cell) continue;                // unchanged: the ViewModel handed back the very same object
      const el = cells[i];
      cellOf[i] = cell;
      el.className = 'cell ' + cell.cls + (cell.anim ? ' ' + cell.anim : '');
      el.textContent = cell.text;
      el.setAttribute('aria-label', cell.label);
      el.tabIndex = cell.cls.includes('cursor') ? 0 : -1;   // roving tabindex: one tab stop, arrow keys move it
      el.style.setProperty('--d', cell.delay + 'ms');
    }
}

function render(s) {
  Sound.onState(s);
  document.documentElement.dataset.theme = s.options.theme;
  syncOptions(s);
  renderKeys(s);
  renderHelp(s);
  renderSaves(s);
  renderProgress(s);
  renderTabs(s);
  levelEl.value = s.level; // restored from saved settings on load
  customEl.hidden = s.level !== 'custom';
  [$('rows').value, $('cols').value, $('minesIn').value] = s.custom; // show clamped values
  resize(s);
  updateBoard(s);
  hoverOff();
  $('mines').textContent = s.minesText;
  $('coins').textContent = s.coins;
  $('time').textContent = s.timeText;
  $('new').textContent = s.face;
  $('best').textContent = s.best ? s.best + 's' : '-';
  $('undo').disabled = !s.canUndo;
  $('redo').disabled = !s.canRedo;
  const live = s.status === 'playing' && !s.replay;
  $('hint').disabled = !live || !s.assists.allowed;
  for (const id of ['bestguess', 'autoflag']) $(id).disabled = !live || !s.assists.allowed;
  $('checkflags').disabled = !live || !s.assists.allowed || !s.assists.canCheckFlags;
  $('assists-btn').disabled = !live || !s.assists.allowed;
  const pu = s.powerupsInfo;
  for (const [id, label, count, show, armed] of [['rowbtn', 'Row', pu.row, true, pu.lineMode === 'row'], ['colbtn', 'Column', pu.col, true, pu.lineMode === 'col'],
      ['lifebtn', '+1 life', pu.life, pu.canLife, false], ['freezebtn', 'Freeze', pu.freeze, pu.canFreeze, false]]) {
    const b = $(id);
    b.hidden = !s.powerups || !show;
    b.textContent = `${label} (${count})`;
    b.disabled = !armed && (count === 0 || !live);
    b.classList.toggle('armed', armed);
  }
  $('freezebtn').textContent = pu.freezeLeft ? `Frozen ${pu.freezeLeft}s` : `Freeze (${pu.freeze})`;
  const tl = $('timeline');
  tl.max = s.timeline.total; tl.value = s.timeline.position; tl.disabled = !s.timeline.canJump || !!s.replay;
  tl.setAttribute('aria-valuetext', s.timeline.label);
  $('timelineLabel').textContent = s.timeline.label;
  $('cp-set').disabled = !live;
  $('cp-back').disabled = !s.checkpoint.canReturn;
  $('cp-back').textContent = s.checkpoint.set ? 'Back to checkpoint' : 'No checkpoint';
  $('race-ghost').hidden = !s.canRace || s.status === 'playing' && s.timeline.total === 0 && !s.ghost;
  $('mission').hidden = !s.mission; if (s.mission) $('mission').textContent = 'Mission: ' + s.mission.text;
  $('ghostbar').hidden = !s.ghost;
  if (s.ghost) {
    $('ghostOpened').textContent = s.ghost.opened; $('ghostTotal').textContent = s.ghost.total; $('ghostTime').textContent = s.ghost.time;
    $('ghostYou').max = s.ghost.total; $('ghostYou').value = s.ghost.you;
  }
  renderShop(s);
  $('scanner').hidden = !s.powerups;
  $('scanner').textContent = `Scanner (${s.scanner})`;
  $('scanner').disabled = !s.scanMode && (s.scanner === 0 || s.status !== 'playing');
  $('scanner').classList.toggle('armed', s.scanMode);
  $('replay').hidden = !s.canReplay || !!s.replay;
  $('flagmode').setAttribute('aria-pressed', s.flagMode);
  $('replaybar').hidden = !s.replay;
  if (s.replay) $('replay-play').innerHTML = s.replay.playing ? '&#10074;&#10074; Pause' : '&#9654; Play';
  $('status').textContent = s.statusText;
  $('status').className = s.flashSeq ? 'flash' + (s.flashSeq % 2) : '';   // two identical animations, alternated, so each flash restarts
  $('tip').hidden = !s.tip;
  if (s.tip) $('tipText').textContent = s.tip.text;
  $('result').hidden = !s.result;
  if (s.result) {
    $('resultTitle').textContent = s.result.title; $('resultDetail').textContent = s.result.detail;
    $('resultTime').textContent = s.result.time; $('resultBest').textContent = s.result.best;
    $('resultStars').textContent = s.result.stars ? '★'.repeat(s.result.stars) + '☆'.repeat(3 - s.result.stars) : '';
    $('resultStars').setAttribute('aria-label', s.result.stars ? s.result.stars + ' of 3 stars' : '');
    $('result-undo').disabled = !s.result.canUndo; $('result-replay').hidden = !s.result.canReplay;
  }
  $('sound').checked = !s.muted;
  $('volume').value = s.volume;
  $('shareLink').value = s.shareCode ? baseUrl() + '?play=' + s.shareCode : '';
  $('copyLink').disabled = !s.shareCode;
  $('shareMsg').textContent = s.shareCode ? '' : 'No-guess boards cannot be shared as a link';
}

// ---- Hover help: outline the neighbours of an open number and say how many flags it still needs ----
function hoverOn(r, c) {
  const h = vm.neighborhood(r, c);
  if (!h) return;
  for (const i of h.cells) cells[i].classList.add('nb');
  $('hoverInfo').textContent = `${h.number}: ` + (h.remaining > 0 ? `${h.remaining} more flag${h.remaining === 1 ? '' : 's'} needed` :
    h.remaining === 0 ? 'all flags placed' : `${-h.remaining} flag${h.remaining === -1 ? '' : 's'} too many`);
}
function hoverOff() {
  for (const el of boardEl.querySelectorAll('.nb')) el.classList.remove('nb');
  $('hoverInfo').textContent = '';
}

// Cell size fits the board to the window (at least 32 px on touch screens, where a bigger board scrolls inside itself).
function resize(s = vm.state()) {
  const room = window.innerWidth - (window.innerWidth > 800 ? 420 : 40);
  const min = window.matchMedia('(pointer: coarse)').matches ? 32 : 16;
  boardEl.style.setProperty('--s', cellSize(s.rows, s.cols, room, window.innerHeight - 260, min) + 'px');
}
window.onresize = () => resize();

// ---- Settings dialog tabs, help dialog ----
function renderTabs(s) {
  for (const tab of TABS) {
    const on = tab === s.settingsTab;
    $('tab-' + tab).setAttribute('aria-selected', on);
    $('tab-' + tab).tabIndex = on ? 0 : -1;
    $('panel-' + tab).hidden = !on;
  }
}
for (const tab of TABS) $('tab-' + tab).onclick = () => vm.setTab(tab);
$('tablist').onkeydown = tablistKeydown;
$('settings-btn').onclick = () => $('settings').showModal();
$('settings-close').onclick = () => $('settings').close();
$('help-btn').onclick = () => $('help').showModal();
$('help-close').onclick = () => $('help').close();
for (const d of [$('settings'), $('help')]) d.addEventListener('click', e => { if (e.target === d) d.close(); }); // click on the backdrop

function renderHelp(s) {
  $('shortcuts').replaceChildren();
  for (const a of Object.keys(ACTION_LABELS)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = ACTION_LABELS[a];
    s.keys[a].forEach((k, i) => { if (i) dd.append(' or '); const kbd = document.createElement('kbd'); kbd.textContent = keyName(k); dd.append(kbd); });
    $('shortcuts').append(dt, dd);
  }
}

// ---- Key bindings (Settings > Controls): each action lists its keys (click a key to remove it, "+ add key" to add one) ----
function renderKeys(s) {
  $('keylist').replaceChildren();
  for (const a of Object.keys(ACTION_LABELS)) {
    const row = document.createElement('div');
    row.className = 'keyrow';
    row.append(ACTION_LABELS[a] + ':');
    for (const k of s.keys[a]) {
      const chip = document.createElement('button');
      chip.textContent = keyName(k) + (s.keys[a].length > 1 ? ' ✕' : '');
      chip.title = 'Remove this key';
      chip.disabled = s.keys[a].length < 2; // an action keeps at least one key
      chip.onclick = () => vm.removeKey(a, k);
      row.append(chip);
    }
    const add = document.createElement('button');
    add.textContent = s.rebinding === a ? 'press a key...' : '+ add key';
    add.onclick = () => vm.startRebind(a);
    row.append(add);
    $('keylist').append(row);
  }
  $('keymsg').textContent = s.keyMessage;
}
$('resetkeys').onclick = () => vm.resetKeys();
$('reset-tips').onclick = () => vm.resetTips();

// ---- Side panel: saved-game slots, best times, statistics, badges ----
function renderSaves(s) {
  $('slots').replaceChildren();
  for (const { n, label } of s.slots) {
    const row = document.createElement('div');
    row.className = 'slotrow';
    row.append(`Slot ${n}: ${label || 'empty'} `);
    for (const [id, text, disabled, run] of [
      ['save', 'Save here', false, () => { vm.saveSlot(n); $('slotMsg').textContent = `Saved to slot ${n}`; }],
      ['load', 'Load', !label, () => { $('slotMsg').textContent = vm.loadSlot(n) ? `Loaded slot ${n}` : `Could not load slot ${n}`; }],
      ['delete', 'Delete', !label, () => { vm.deleteSlot(n); $('slotMsg').textContent = `Deleted slot ${n}`; }],
    ]) {
      const b = document.createElement('button');
      b.id = `slot-${id}-${n}`; b.textContent = text; b.disabled = disabled; b.onclick = run;
      row.append(b, ' ');
    }
    $('slots').append(row);
  }
  const levels = Object.keys(s.scores);
  $('scores').innerHTML = '<thead><tr>' + levels.map(l => `<th>${LEVEL_NAMES[l]}</th>`).join('') + '</tr></thead><tbody>' +
    Array.from({ length: s.scoreRows }, (_, i) => '<tr>' + levels.map(l => {
      const e = s.scores[l][i];
      return e ? `<td title="${e.date}">${e.t}s</td>` : '<td></td>'; // numbers and locale dates only: nothing user-typed goes into the HTML
    }).join('') + '</tr>').join('') + '</tbody>';
}
function renderShop(s) {
  $('shopCoins').textContent = s.coins;
  $('shopMsg').textContent = s.shop.message || '';
  $('shop').replaceChildren();
  for (const i of s.shop.items) {
    const li = document.createElement('li'), b = document.createElement('button');
    b.id = 'buy-' + i.id; b.textContent = i.owned ? 'Owned' : `Buy (${i.price})`;
    b.disabled = i.owned || !i.affordable;
    b.onclick = () => vm.buy(i.id);
    li.append(i.name + (i.kind === 'powerup' ? ` (have ${i.stock}) ` : ' '), b);
    $('shop').append(li);
  }
}
function renderProgress(s) {
  $('stats').replaceChildren();
  for (const [label, value] of s.stats) {
    const tr = $('stats').insertRow();
    tr.insertCell().textContent = label;
    tr.insertCell().textContent = value;
  }
  $('achievements').replaceChildren();
  for (const a of s.achievements) {
    const li = document.createElement('li');
    li.className = 'ach ' + (a.unlocked ? 'unlocked' : 'locked');
    li.textContent = (a.unlocked ? '🏆 ' : '🔒 ') + a.name + ' - ' + a.desc;
    $('achievements').append(li);
  }
}
$('clear-scores').onclick = () => vm.clearScores();
$('clear-stats').onclick = () => vm.clearStats();
const sheet = open => { $('side').classList.toggle('open', open); $('panels-toggle').setAttribute('aria-expanded', open); }; // phones: the side panel is a bottom sheet
$('panels-toggle').onclick = () => sheet(!$('side').classList.contains('open'));
$('panels-close').onclick = () => sheet(false);

// ---- Buttons ----
$('new').onclick = newGame;
$('start').onclick = newGame;
levelEl.onchange = newGame;
$('daily').onclick = () => vm.startDaily();
$('undo').onclick = () => vm.undo();
$('redo').onclick = () => vm.redo();
$('hint').onclick = () => vm.hint();
$('bestguess').onclick = () => vm.bestGuess();
$('autoflag').onclick = () => vm.autoFlag();
$('checkflags').onclick = () => vm.checkFlags();
$('rowbtn').onclick = () => vm.toggleLine('row');
$('colbtn').onclick = () => vm.toggleLine('col');
$('lifebtn').onclick = () => vm.useLife();
$('freezebtn').onclick = () => vm.useFreeze();
$('timeline').oninput = e => vm.jumpTo(Number(e.target.value));
$('cp-set').onclick = () => vm.setCheckpoint();
$('cp-back').onclick = () => vm.returnToCheckpoint();
$('race-ghost').onclick = () => vm.raceGhost();
$('weekly').onclick = () => vm.startWeekly();
$('scanner').onclick = () => vm.toggleScanner();
$('flagmode').onclick = () => vm.toggleFlagMode();
$('replay').onclick = () => vm.startReplay();
$('replay-prev').onclick = () => vm.replayStep(-1);
$('replay-next').onclick = () => vm.replayStep(1);
$('replay-play').onclick = () => vm.replayPlay();
$('replay-close').onclick = () => vm.replayClose();
$('tip-dismiss').onclick = () => vm.dismissTip();
$('result-new').onclick = newGame;
$('result-undo').onclick = () => vm.undo();
$('result-replay').onclick = () => vm.startReplay();
$('result-close').onclick = () => vm.dismissResult();
$('sound').onchange = e => vm.setMuted(!e.target.checked);
$('volume').onchange = e => vm.setVolume(e.target.value);
$('copyLink').onclick = async () => {
  const input = $('shareLink');
  try { await navigator.clipboard.writeText(input.value); $('shareMsg').textContent = 'Link copied'; }
  catch (e) { input.select(); $('shareMsg').textContent = 'Press Ctrl+C (or Cmd+C) to copy the selected link'; } // no clipboard access: let the user copy it
};

// ---- Files: download settings or the game in progress, or upload either (validated all-or-nothing by the ViewModel) ----
$('export').onclick = () => { SettingsFile.download(vm.exportSettings()); $('settingsMsg').textContent = 'Downloaded minesweeper-settings.json'; };
$('exportGame').onclick = () => { SettingsFile.download(vm.exportGame(), 'minesweeper-game.json'); $('settingsMsg').textContent = 'Downloaded minesweeper-game.json'; };
$('settingsFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = ''; // so choosing the same file again still fires change
  if (!file) return;
  try {
    const r = vm.importFile(await SettingsFile.read(file));
    $('settingsMsg').textContent = r.ok ? 'Imported ' + file.name : 'Not imported: ' + r.error;
  } catch (err) { $('settingsMsg').textContent = 'Not imported: ' + err.message; }
};

document.onkeydown = e => handleGameKey(e, vm);
setInterval(() => vm.tick(), 1000);
window.addEventListener('pagehide', () => vm.save()); // keep the exact elapsed time for the autosaved game
render(vm.state());
