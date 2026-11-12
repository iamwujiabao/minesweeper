// View (MVVM), React 18: the same ViewModel as app.js and vue-app.js, rendered by React.
// Bundled by esbuild (npm run build) into dist/react-app.js: no globals, everything is imported.
import { useState, useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewModel, cellSize, ACTION_LABELS } from './viewmodel.js';
import { rngFromSearch } from './rng.js';
import { Sound } from './sound.js';
import { SettingsFile } from './settingsfile.js';

const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

// A tiny external store: the ViewModel pushes state in, components subscribe with useSyncExternalStore.
// Time has its own store so the 1-second timer only re-renders the clock, not the board.
let latest, time = 0;
const stateSubs = new Set(), timeSubs = new Set();
const subscribe = set => cb => { set.add(cb); return () => set.delete(cb); };
const subState = subscribe(stateSubs), subTime = subscribe(timeSubs);

const vm = new ViewModel(storage, {
  onChange: st => { Sound.onState(st); latest = st; time = st.time; stateSubs.forEach(f => f()); timeSubs.forEach(f => f()); },
  onTick: t => { time = t; timeSubs.forEach(f => f()); },
  rng: rngFromSearch(location.search),
});
window.addEventListener('pagehide', () => vm.save()); // keep the exact elapsed time for the autosaved game

const keyName = k => (k === ' ' ? 'Space' : k);
const STATUS = { playing: 'Playing - click to reveal, click a number to chord, right-click to flag (or use the keyboard)',
                 won: '🎉 You won!', lost: '💥 Boom! You lost. Press Undo to take it back.' };
let lastLongPress = 0, pressTimer;

function Clock() {
  return <b id="time">{useSyncExternalStore(subTime, () => time)}</b>;
}

function Cell({ cell, r, c, s }) {
  const cls = [];
  let text = '';
  if (r === s.cursor.r && c === s.cursor.c) cls.push('cursor');
  if (cell.revealed) {
    cls.push('open'); if (cell.mine) cls.push('boom');
    if (cell.mine) text = '💣'; else if (cell.adjacent) { text = cell.adjacent; cls.push('n' + cell.adjacent); }
  } else if (cell.flagged) text = '🚩';
  else if (s.status === 'lost' && cell.mine) text = '💣'; // show all mines after a loss
  return (
    <button className={cls.join(' ')}
      onClick={() => { if (Date.now() - lastLongPress > 600) vm.click(r, c); }}
      onContextMenu={e => { e.preventDefault(); if (Date.now() - lastLongPress > 800) vm.flag(r, c); }}
      // Touch: hold 450ms to flag; lastLongPress stops the click/contextmenu that follows from acting twice.
      onPointerDown={e => { if (e.pointerType === 'touch') pressTimer = setTimeout(() => { lastLongPress = Date.now(); vm.flag(r, c); }, 450); }}
      onPointerUp={() => clearTimeout(pressTimer)} onPointerLeave={() => clearTimeout(pressTimer)} onPointerCancel={() => clearTimeout(pressTimer)}>
      {text}
    </button>
  );
}

function KeysPanel({ s }) {
  return (
    <details>
      <summary>Keys</summary>
      {Object.entries(ACTION_LABELS).map(([a, label]) => (
        <div className="keyrow" key={a}>
          {label}:
          {s.keys[a].map(k => (
            <button key={k} disabled={s.keys[a].length < 2} title="Remove this key" onClick={() => vm.removeKey(a, k)}>
              {keyName(k)}{s.keys[a].length > 1 && ' ✕'}
            </button>
          ))}
          <button onClick={() => vm.startRebind(a)}>{s.rebinding === a ? 'press a key...' : '+ add key'}</button>
        </div>
      ))}
      <button id="resetkeys" onClick={() => vm.resetKeys()}>Reset keys</button> <span id="keymsg">{s.keyMessage}</span>
    </details>
  );
}

function SettingsPanel() {
  const [msg, setMsg] = useState('');
  const upload = async e => {
    const file = e.target.files[0];
    e.target.value = ''; // so choosing the same file again still fires change
    if (!file) return;
    try {
      const r = vm.importFile(await SettingsFile.read(file));
      setMsg(r.ok ? 'Imported ' + file.name : 'Not imported: ' + r.error);
    } catch (err) { setMsg('Not imported: ' + err.message); }
  };
  return (
    <details>
      <summary>Files: settings and saved game</summary>
      <p><small>Your game in progress is also saved automatically and resumes when you reopen the page.</small></p>
      <button id="export" onClick={() => { SettingsFile.download(vm.exportSettings()); setMsg('Downloaded minesweeper-settings.json'); }}>Download settings</button>{' '}
      <button id="exportGame" onClick={() => { SettingsFile.download(vm.exportGame(), 'minesweeper-game.json'); setMsg('Downloaded minesweeper-game.json'); }}>Download game</button>
      <label> Upload a settings or game file: <input id="settingsFile" type="file" accept=".json,application/json" onChange={upload} /></label>
      <span id="settingsMsg"> {msg}</span>
    </details>
  );
}

function App() {
  const s = useSyncExternalStore(subState, () => latest);
  const [custom, setCustom] = useState(s.custom);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => setCustom(s.custom), [s.custom]); // show clamped / imported sizes

  useEffect(() => {
    const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    const onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!vm.rebinding && e.target.matches?.('input[type=number], input[type=range], select')) return;
      if (vm.pressKey(e.key)) { e.preventDefault(); document.activeElement.blur?.(); }
    };
    const timer = setInterval(() => vm.tick(), 1000);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    return () => { clearInterval(timer); window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey); };
  }, []);

  const px = cellSize(s.rows, s.cols, win.w - 32, win.h - 200);
  return (
    <>
      <h1>Minesweeper <small>(React view)</small></h1>
      <p><small><a href="index.html">Plain JavaScript version</a>, <a href="vue.html">Vue version</a></small></p>
      <div id="bar">
        <select id="level" value={s.level} onChange={e => vm.start(e.target.value, custom)}>
          <option value="beginner">Beginner 9x9</option><option value="intermediate">Intermediate 16x16</option>
          <option value="expert">Expert 16x30</option><option value="custom">Custom</option>
        </select>
        {s.level === 'custom' && (
          <span id="custom">
            {['rows 5-30', 'columns 5-40', 'mines'].map((title, i) => (
              <span key={i}>{i === 1 ? ' x ' : i === 2 ? ' mines ' : ''}
                <input id={['rows', 'cols', 'minesIn'][i]} type="number" title={title} value={custom[i]}
                  onChange={e => setCustom(cu => cu.map((v, j) => (j === i ? e.target.value : v)))} /></span>
            ))}
          </span>
        )}
        <span>Mines: <b id="mines">{s.minesLeft}</b></span>
        <span>Time: <Clock /></span>
        <span>Best: <b id="best">{s.best ? s.best + 's' : '-'}</b></span>
        <button id="new" onClick={() => vm.start(s.level, custom)}>New Game</button>
        <button id="undo" disabled={!s.canUndo} onClick={() => vm.undo()}>Undo</button>
        <button id="redo" disabled={!s.canRedo} onClick={() => vm.redo()}>Redo</button>
        <label><input id="sound" type="checkbox" checked={!s.muted} onChange={e => vm.setMuted(!e.target.checked)} /> Sound</label>
        <input id="volume" type="range" min="0" max="1" step="0.1" title="volume" value={s.volume} onChange={e => vm.setVolume(e.target.value)} />
      </div>
      <div id="status">{STATUS[s.status]}</div>
      <p><small>Touch: long-press to flag. Keyboard keys are listed (and rebindable) below.</small></p>
      <KeysPanel s={s} />
      <SettingsPanel />
      <br />
      <div id="board" style={{ '--cols': s.cols, '--s': px + 'px' }}>
        {s.cells.map((row, r) => row.map((cell, c) => <Cell key={r * 1000 + c} cell={cell} r={r} c={c} s={s} />))}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
