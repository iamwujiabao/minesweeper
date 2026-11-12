// View (MVVM), React 18: the same ViewModel as app.js and vue-app.js, rendered by React.
// Bundled by esbuild (npm run build) into dist/react-app.js; the shared code comes from dist/core.js (see scripts/build.js).
// Cell components are memoised: the ViewModel hands back the very same cell object when a cell did not change,
// so only the cells that changed are re-rendered.
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewModel, cellSize, ACTION_LABELS, LEVEL_NAMES, OPTION_DEFS, TABS } from './viewmodel.js';
import { rngFromSearch, parsePlay } from './rng.js';
import { Sound } from './sound.js';
import { SettingsFile } from './settingsfile.js';
import { handleGameKey, tablistKeydown } from './a11y.js';

const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

// A tiny external store: the ViewModel pushes state in, components subscribe with useSyncExternalStore.
// Time has its own store so the 1-second timer only re-renders the clock, not the board.
let latest, time = '0';
const stateSubs = new Set(), timeSubs = new Set();
const subscribe = set => cb => { set.add(cb); return () => set.delete(cb); };
const subState = subscribe(stateSubs), subTime = subscribe(timeSubs);

const vm = new ViewModel(storage, {
  onChange: st => {
    Sound.onState(st);
    document.documentElement.dataset.theme = st.options.theme;
    latest = st; time = st.timeText;
    stateSubs.forEach(f => f()); timeSubs.forEach(f => f());
  },
  onTick: t => { time = t; timeSubs.forEach(f => f()); },
  rng: rngFromSearch(location.search), play: parsePlay(location.search),
});
window.addEventListener('pagehide', () => vm.save()); // keep the exact elapsed time for the autosaved game

const keyName = k => (k === ' ' ? 'Space' : k);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const TAB_LABELS = { game: 'Game', controls: 'Controls', appearance: 'Appearance', data: 'Data' };
const closeOnBackdrop = e => { if (e.target === e.currentTarget) e.currentTarget.close(); }; // a click on the dark backdrop closes a dialog
let lastLongPress = 0, pressTimer;

function Clock() {
  return <b id="time" className="lcd">{useSyncExternalStore(subTime, () => time)}</b>;
}

const Cell = memo(function Cell({ cell, r, c, hovered, onHover }) {
  return (
    <div role="gridcell" className={'cell ' + cell.cls + (cell.anim ? ' ' + cell.anim : '') + (hovered ? ' nb' : '')}
      tabIndex={cell.cls.includes('cursor') ? 0 : -1} aria-label={cell.label} style={{ '--d': cell.delay + 'ms' }}
      onClick={() => { if (Date.now() - lastLongPress > 600) vm.click(r, c); }}
      onContextMenu={e => { e.preventDefault(); if (Date.now() - lastLongPress > 800) vm.flag(r, c); }}
      onMouseEnter={() => onHover(r, c)} onMouseLeave={() => onHover(null)}
      // Touch: hold 450ms to flag; lastLongPress stops the click/contextmenu that follows from acting twice.
      onPointerDown={e => { if (e.pointerType === 'touch') pressTimer = setTimeout(() => { lastLongPress = Date.now(); vm.flag(r, c); }, 450); }}
      onPointerUp={() => clearTimeout(pressTimer)} onPointerLeave={() => clearTimeout(pressTimer)} onPointerCancel={() => clearTimeout(pressTimer)}>
      {cell.text}
    </div>
  );
});

// One settings field (a select or a checkbox with its description), used in the New game menu and in Settings.
function OptionField({ def, value }) {
  const id = 'opt-' + def.key;
  const desc = def.type === 'select' ? def.choices.find(c => c[0] === value)[2] : def.desc;
  return (
    <div className="field">
      {def.type === 'select'
        ? <><label htmlFor={id}>{def.label}</label>
            <select id={id} value={value} aria-describedby={id + '-desc'} onChange={e => vm.setOption(def.key, e.target.value)}>
              {def.choices.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
            </select></>
        : <label><input type="checkbox" id={id} checked={value} aria-describedby={id + '-desc'} onChange={e => vm.setOption(def.key, e.target.checked)} /> {def.label}</label>}
      <span className="note" id={id + '-desc'}>{desc}</span>
    </div>
  );
}
const group = (g, s) => OPTION_DEFS.filter(d => d.group === g).map(d => <OptionField key={d.key} def={d} value={s.options[d.key]} />);

function SidePanel({ s, open, onClose }) {
  const [slotMsg, setSlotMsg] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const url = s.shareCode ? location.href.split(/[?#]/)[0] + '?play=' + s.shareCode : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setShareMsg('Link copied'); }
    catch (e) { document.getElementById('shareLink').select(); setShareMsg('Select the link and copy it (Ctrl+C or Cmd+C)'); } // no clipboard access
  };
  return (
    <aside id="side" className={'card side' + (open ? ' open' : '')} aria-label="Statistics, saved games and sharing">
      <div className="sheet-head"><b>Stats &amp; saves</b><button id="panels-close" onClick={onClose}>Close</button></div>
      <h2>Progress</h2>
      <table id="stats"><tbody>{s.stats.map(([label, value]) => <tr key={label}><td>{label}</td><td>{value}</td></tr>)}</tbody></table>
      <ul id="achievements">
        {s.achievements.map(a => <li key={a.id} className={'ach ' + (a.unlocked ? 'unlocked' : 'locked')}>{a.unlocked ? '🏆' : '🔒'} {a.name} - {a.desc}</li>)}
      </ul>
      <button id="clear-stats" onClick={() => vm.clearStats()}>Reset statistics and badges</button>
      <h2>Saved games</h2>
      <div id="slots">
        {s.slots.map(({ n, label }) => (
          <div className="slotrow" key={n}>
            Slot {n}: {label || 'empty'}{' '}
            <button id={'slot-save-' + n} onClick={() => { vm.saveSlot(n); setSlotMsg(`Saved to slot ${n}`); }}>Save here</button>{' '}
            <button id={'slot-load-' + n} disabled={!label} onClick={() => setSlotMsg(vm.loadSlot(n) ? `Loaded slot ${n}` : `Could not load slot ${n}`)}>Load</button>{' '}
            <button id={'slot-delete-' + n} disabled={!label} onClick={() => { vm.deleteSlot(n); setSlotMsg(`Deleted slot ${n}`); }}>Delete</button>
          </div>
        ))}
      </div>
      <span id="slotMsg" className="note">{slotMsg}</span>
      <h2>Best times</h2>
      <table id="scores">
        <thead><tr>{Object.keys(s.scores).map(l => <th key={l}>{LEVEL_NAMES[l]}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: s.scoreRows }, (_, i) => (
            <tr key={i}>{Object.keys(s.scores).map(l => {
              const e = s.scores[l][i];
              return <td key={l} title={e ? e.date : undefined}>{e ? e.t + 's' : ''}</td>;
            })}</tr>
          ))}
        </tbody>
      </table>
      <button id="clear-scores" onClick={() => vm.clearScores()}>Clear best times</button>
      <h2>Share this board</h2>
      <input id="shareLink" readOnly size="30" placeholder="Share link" aria-label="Share link" value={url} /> <button id="copyLink" disabled={!s.shareCode} onClick={copy}>Copy link</button>
      <span id="shareMsg" className="note">{s.shareCode ? shareMsg : 'No-guess boards cannot be shared as a link'}</span>
    </aside>
  );
}

function SettingsDialog({ s, dialogRef }) {
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
    <dialog id="settings" ref={dialogRef} aria-labelledby="settingsTitle" onClick={closeOnBackdrop}>
      <div className="dialog-head"><h2 id="settingsTitle">Settings</h2><button id="settings-close" onClick={() => dialogRef.current.close()}>Close</button></div>
      <div role="tablist" aria-label="Settings sections" id="tablist" onKeyDown={tablistKeydown}>
        {TABS.map(t => (
          <button key={t} role="tab" id={'tab-' + t} aria-controls={'panel-' + t} aria-selected={s.settingsTab === t}
            tabIndex={s.settingsTab === t ? 0 : -1} onClick={() => vm.setTab(t)}>{TAB_LABELS[t]}</button>
        ))}
      </div>
      <div className="dialog-body">
        <div role="tabpanel" id="panel-game" aria-labelledby="tab-game" hidden={s.settingsTab !== 'game'}>
          {group('game', s)}
          <p className="note">Mode, board, no-guess and power-ups are chosen in <b>New game&hellip;</b>.</p>
        </div>
        <div role="tabpanel" id="panel-controls" aria-labelledby="tab-controls" hidden={s.settingsTab !== 'controls'}>
          <p className="note">Click <b>+ add key</b>, then press the key you want. Esc cancels.</p>
          <div id="keylist">
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
          </div>
          <button id="resetkeys" onClick={() => vm.resetKeys()}>Reset keys</button> <span id="keymsg" className="note">{s.keyMessage}</span>
          <p><button id="reset-tips" onClick={() => vm.resetTips()}>Show the first-time tips again</button></p>
        </div>
        <div role="tabpanel" id="panel-appearance" aria-labelledby="tab-appearance" hidden={s.settingsTab !== 'appearance'}>
          {group('appearance', s)}
          <div className="field">
            <label><input id="sound" type="checkbox" checked={!s.muted} onChange={e => vm.setMuted(!e.target.checked)} /> Sound</label>
            <input id="volume" type="range" min="0" max="1" step="0.1" aria-label="Volume" value={s.volume} onChange={e => vm.setVolume(e.target.value)} />
            <span className="note">Short beeps for reveals, flags, undo, wins and losses.</span>
          </div>
          <p className="note">The theme is chosen in the header. Animations switch off automatically if your device asks for reduced motion.</p>
        </div>
        <div role="tabpanel" id="panel-data" aria-labelledby="tab-data" hidden={s.settingsTab !== 'data'}>
          <p className="note">Your game in progress is saved automatically and resumes when you reopen the page.</p>
          <button id="export" onClick={() => { SettingsFile.download(vm.exportSettings()); setMsg('Downloaded minesweeper-settings.json'); }}>Download settings</button>{' '}
          <button id="exportGame" onClick={() => { SettingsFile.download(vm.exportGame(), 'minesweeper-game.json'); setMsg('Downloaded minesweeper-game.json'); }}>Download game</button>
          <div className="field"><label htmlFor="settingsFile">Upload a settings or game file</label><input id="settingsFile" type="file" accept=".json,application/json" onChange={upload} /></div>
          <span id="settingsMsg" className="note">{msg}</span>
        </div>
      </div>
    </dialog>
  );
}

function HelpDialog({ s, dialogRef }) {
  return (
    <dialog id="help" ref={dialogRef} aria-labelledby="helpTitle" onClick={closeOnBackdrop}>
      <div className="dialog-head"><h2 id="helpTitle">Keyboard shortcuts and help</h2><button id="help-close" onClick={() => dialogRef.current.close()}>Close</button></div>
      <div className="dialog-body">
        <dl id="shortcuts" className="shortcuts">
          {Object.entries(ACTION_LABELS).map(([a, label]) => (
            <><dt key={a + 't'}>{label}</dt>
              <dd key={a + 'd'}>{s.keys[a].map((k, i) => <span key={k}>{i > 0 && ' or '}<kbd>{keyName(k)}</kbd></span>)}</dd></>
          ))}
        </dl>
        <p className="note">Change keys in Settings &rarr; Controls.</p>
        <h3>Mouse and touch</h3>
        <ul>
          <li>Click a cell to open it. Click an open number whose flags are all placed to open its neighbours (chording).</li>
          <li>Right-click, or long-press on a phone, flags a cell; again for a ? mark. <b>Flag mode</b> makes plain taps flag.</li>
          <li>Hover an open number to outline its neighbours and see how many flags it still needs.</li>
          <li>The arrow keys move around the board; screen readers announce each cell.</li>
        </ul>
      </div>
    </dialog>
  );
}

function App() {
  const s = useSyncExternalStore(subState, () => latest);
  const [custom, setCustom] = useState(s.custom);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [hover, setHover] = useState(null); // the open number under the mouse: {number, remaining, set}
  const [sheetOpen, setSheetOpen] = useState(false); // phones: the side panel is a bottom sheet
  const settingsRef = useRef(null), helpRef = useRef(null);
  useEffect(() => setCustom(s.custom), [s.custom]); // show clamped / imported sizes
  useEffect(() => setHover(null), [s]);             // any change clears the hover help

  useEffect(() => {
    const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    const onKey = e => handleGameKey(e, vm);
    const timer = setInterval(() => vm.tick(), 1000);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    return () => { clearInterval(timer); window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey); };
  }, []);

  // Hover help: outline an open number's neighbours and say how many flags it still needs.
  const onHover = useCallback((r, c) => {
    const h = r === null ? null : vm.neighborhood(r, c);
    setHover(h && { number: h.number, remaining: h.remaining, set: new Set(h.cells) });
  }, []);
  const hoverText = !hover ? '' : `${hover.number}: ` + (hover.remaining > 0 ? `${plural(hover.remaining, 'more flag')} needed` :
    hover.remaining === 0 ? 'all flags placed' : `${plural(-hover.remaining, 'flag')} too many`);

  const px = cellSize(s.rows, s.cols, win.w - (win.w > 800 ? 420 : 40), win.h - 260, window.matchMedia('(pointer: coarse)').matches ? 32 : 16);
  const newGame = level => vm.start(level, custom);
  const themeDef = OPTION_DEFS.find(d => d.key === 'theme');
  return (
    <>
      <header className="topbar">
        <h1>Minesweeper <small>(React)</small></h1>
        <span className="links"><a href="index.html">Plain JavaScript</a> &middot; <a href="vue.html">Vue</a> &middot; React</span>
        <label>Theme{' '}
          <select id="opt-theme" value={s.options.theme} onChange={e => vm.setOption('theme', e.target.value)}>
            {themeDef.choices.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
          </select>
        </label>
        <button id="help-btn" aria-label="Keyboard shortcuts and help" title="Keyboard shortcuts and help" onClick={() => helpRef.current.showModal()}>?</button>
        <button id="settings-btn" onClick={() => settingsRef.current.showModal()}>&#9881; Settings</button>
      </header>

      <main className="layout">
        <section className="card game" aria-label="Game">
          <div className="gamebar">
            <div className="counter"><span className="lbl">Mines</span><b id="mines" className="lcd">{s.minesLeft}</b></div>
            <button id="new" className="face" aria-label="New game" title="New game" onClick={() => newGame(s.level)}>{s.face}</button>
            <div className="counter right"><span className="lbl">Time</span><Clock /></div>
          </div>
          <div className="toolbar" role="toolbar" aria-label="Game actions">
            <button id="undo" disabled={!s.canUndo} onClick={() => vm.undo()}>Undo</button>
            <button id="redo" disabled={!s.canRedo} onClick={() => vm.redo()}>Redo</button>
            <button id="hint" disabled={s.status !== 'playing' || !!s.replay} title="Highlight a cell that is certainly safe" onClick={() => vm.hint()}>Hint</button>
            {s.powerups && (
              <button id="scanner" className={s.scanMode ? 'armed' : ''} disabled={!s.scanMode && (s.scanner === 0 || s.status !== 'playing')}
                title="Count the mines around a cell you click" onClick={() => vm.toggleScanner()}>Scanner ({s.scanner})</button>
            )}
            {s.canReplay && !s.replay && <button id="replay" onClick={() => vm.startReplay()}>Replay</button>}
            <button id="flagmode" aria-pressed={s.flagMode} title="Taps flag cells instead of opening them" onClick={() => vm.toggleFlagMode()}>🚩 Flag mode</button>
            <button id="newgame-btn" popovertarget="newgame-pop">New game&hellip;</button>
            <button id="panels-toggle" aria-expanded={sheetOpen} aria-controls="side" onClick={() => setSheetOpen(o => !o)}>Stats &amp; saves</button>
          </div>
          <div className="meta">Best time: <b id="best">{s.best ? s.best + 's' : '-'}</b></div>
          <div id="status" role="status" aria-live="polite" className={s.flashSeq ? 'flash' + (s.flashSeq % 2) : ''}>{s.statusText}</div>
          {s.replay && (
            <div id="replaybar" className="replaybar">
              <button id="replay-prev" onClick={() => vm.replayStep(-1)}>◀ Step back</button>
              <button id="replay-play" onClick={() => vm.replayPlay()}>{s.replay.playing ? '❚❚ Pause' : '▶ Play'}</button>
              <button id="replay-next" onClick={() => vm.replayStep(1)}>Step ▶</button>
              <button id="replay-close" onClick={() => vm.replayClose()}>Close replay</button>
            </div>
          )}
          {s.tip && <div id="tip" className="tip"><span id="tipText">{s.tip.text}</span><button id="tip-dismiss" onClick={() => vm.dismissTip()}>Got it</button></div>}
          <div id="hoverInfo" aria-hidden="true">{hoverText}</div>
          <div className="boardwrap">
            <div id="board" role="grid" aria-label="Minefield" aria-rowcount={s.rows} aria-colcount={s.cols}
              className={s.topology === 'hex' ? 'hexboard' : ''} style={{ '--cols': s.cols, '--s': px + 'px' }}>
              {s.grid.map((row, r) => (
                <div role="row" key={r}>
                  {row.map((cell, c) => <Cell key={c} cell={cell} r={r} c={c} hovered={!!hover && hover.set.has(r * s.cols + c)} onHover={onHover} />)}
                </div>
              ))}
            </div>
            {s.result && (
              <div id="result" className="result">
                <div className="result-card" role="group" aria-labelledby="resultTitle">
                  <h2 id="resultTitle">{s.result.title}</h2>
                  <p id="resultDetail">{s.result.detail}</p>
                  <div className="result-stats"><div><span>Time</span><b id="resultTime">{s.result.time}</b></div><div><span>Best</span><b id="resultBest">{s.result.best}</b></div></div>
                  <div className="result-actions">
                    <button id="result-new" className="primary" onClick={() => newGame(s.level)}>New game</button>
                    <button id="result-undo" disabled={!s.result.canUndo} onClick={() => vm.undo()}>Undo</button>
                    {s.result.canReplay && <button id="result-replay" onClick={() => vm.startReplay()}>Replay</button>}
                    <button id="result-close" onClick={() => vm.dismissResult()}>Close</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
        <SidePanel s={s} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      </main>

      <div id="newgame-pop" popover="">
        <h2>New game</h2>
        <div className="field"><label htmlFor="level">Difficulty</label>
          <select id="level" value={s.level} onChange={e => newGame(e.target.value)}>
            <option value="beginner">Beginner 9x9</option><option value="intermediate">Intermediate 16x16</option>
            <option value="expert">Expert 16x30</option><option value="custom">Custom</option>
          </select>
          {s.level === 'custom' && (
            <span id="custom">
              {['Rows', 'Columns', 'Mines'].map((title, i) => (
                <span key={i}>{i === 1 ? ' × ' : i === 2 ? ' mines ' : ''}
                  <input id={['rows', 'cols', 'minesIn'][i]} type="number" aria-label={title} title={title} value={custom[i]}
                    onChange={e => setCustom(cu => cu.map((v, j) => (j === i ? e.target.value : v)))} /></span>
              ))}
            </span>
          )}
          <span className="note">Changing the difficulty starts a new game at once.</span></div>
        {group('newgame', s)}
        <small id="optionsNote" className="note">{s.optionsPending ? 'These apply to the next new game.' : ''}</small>
        <div className="field-row">
          <button id="start" className="primary" popovertarget="newgame-pop" popovertargetaction="hide" onClick={() => newGame(s.level)}>Start new game</button>
          <button id="daily" popovertarget="newgame-pop" popovertargetaction="hide" onClick={() => vm.startDaily()}>Today's daily challenge</button>
        </div>
      </div>

      <SettingsDialog s={s} dialogRef={settingsRef} />
      <HelpDialog s={s} dialogRef={helpRef} />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
