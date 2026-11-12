// View (MVVM), Vue 3: the same ViewModel as app.js, rendered by Vue. The ViewModel pushes a fresh
// state() into one shallowRef; Vue re-renders from it. No game rules here either.
// Bundled by esbuild (npm run build) into dist/vue-app.js (shared code comes from dist/core.js); the page's own HTML is Vue's template.
import { createApp, shallowRef, ref, computed, onMounted } from 'vue';
import { ViewModel, cellSize, ACTION_LABELS, LEVEL_NAMES, OPTION_DEFS } from './viewmodel.js';
import { rngFromSearch, parsePlay } from './rng.js';
import { Sound } from './sound.js';
import { SettingsFile } from './settingsfile.js';

const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

createApp({
  setup() {
    const s = shallowRef(null);               // latest vm.state()
    const time = ref(0);                      // separate so the timer doesn't recompute the board
    const custom = ref([9, 9, 10]);           // custom-size inputs
    const win = ref({ w: window.innerWidth, h: window.innerHeight });
    const settingsMsg = ref(''), slotMsg = ref(''), shareMsg = ref('');
    const hover = ref(null);                  // the open number under the mouse: {number, remaining, cells, set}
    let lastLongPress = 0, pressTimer;

    const vm = new ViewModel(storage, {
      onChange: st => { Sound.onState(st); document.documentElement.dataset.theme = st.options.theme; custom.value = [...st.custom]; time.value = st.timeText; hover.value = null; s.value = st; },
      onTick: t => { time.value = t; },
      rng: rngFromSearch(location.search), play: parsePlay(location.search),
    });

    const px = computed(() => cellSize(s.value.rows, s.value.cols, win.value.w - 32, win.value.h - 200));
    // One entry per cell: the ViewModel already worked out what to show (text) and which CSS classes to use (cls).
    const items = computed(() => {
      const st = s.value;
      return st.grid.flat().map((cell, i) => ({ i, r: Math.floor(i / st.cols), c: i % st.cols, text: cell.text, cls: cell.cls }));
    });

    // Hover help: outline an open number's neighbours and say how many flags it still needs.
    const hoverOn = (r, c) => { const h = vm.neighborhood(r, c); hover.value = h && { ...h, set: new Set(h.cells) }; };
    const hoverText = computed(() => {
      const h = hover.value;
      if (!h) return '';
      return `${h.number}: ` + (h.remaining > 0 ? `${h.remaining} more flag${h.remaining === 1 ? '' : 's'} needed` :
        h.remaining === 0 ? 'all flags placed' : `${-h.remaining} flag${h.remaining === -1 ? '' : 's'} too many`);
    });

    const shareUrl = computed(() => (s.value.shareCode ? location.href.split(/[?#]/)[0] + '?play=' + s.value.shareCode : ''));
    const copyLink = async () => {
      try { await navigator.clipboard.writeText(shareUrl.value); shareMsg.value = 'Link copied'; }
      catch (e) { shareMsg.value = 'Select the link and copy it (Ctrl+C or Cmd+C)'; document.getElementById('shareLink').select(); }
    };

    const newGame = level => vm.start(level, custom.value);
    const cellClick = (r, c) => { if (Date.now() - lastLongPress > 600) vm.click(r, c); };
    const cellFlag = (r, c) => { if (Date.now() - lastLongPress > 800) vm.flag(r, c); };
    // Touch: hold 450ms to flag; lastLongPress stops the click/contextmenu that follows from acting twice.
    const pressStart = (e, r, c) => { if (e.pointerType === 'touch') pressTimer = setTimeout(() => { lastLongPress = Date.now(); vm.flag(r, c); }, 450); };
    const pressEnd = () => clearTimeout(pressTimer);

    const saveSlot = n => { vm.saveSlot(n); slotMsg.value = `Saved to slot ${n}`; };
    const loadSlot = n => { slotMsg.value = vm.loadSlot(n) ? `Loaded slot ${n}` : `Could not load slot ${n}`; };
    const deleteSlot = n => { vm.deleteSlot(n); slotMsg.value = `Deleted slot ${n}`; };
    const downloadSettings = () => { SettingsFile.download(vm.exportSettings()); settingsMsg.value = 'Downloaded minesweeper-settings.json'; };
    const downloadGame = () => { SettingsFile.download(vm.exportGame(), 'minesweeper-game.json'); settingsMsg.value = 'Downloaded minesweeper-game.json'; };
    const uploadFile = async e => {
      const file = e.target.files[0];
      e.target.value = ''; // so choosing the same file again still fires change
      if (!file) return;
      try {
        const r = vm.importFile(await SettingsFile.read(file));
        settingsMsg.value = r.ok ? 'Imported ' + file.name : 'Not imported: ' + r.error;
      } catch (err) { settingsMsg.value = 'Not imported: ' + err.message; }
    };

    onMounted(() => {
      setInterval(() => vm.tick(), 1000);
      window.addEventListener('pagehide', () => vm.save()); // keep the exact elapsed time for the autosaved game
      window.addEventListener('resize', () => { win.value = { w: window.innerWidth, h: window.innerHeight }; });
      document.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!vm.rebinding && e.target.matches?.('input[type=number], input[type=range], select')) return;
        if (vm.pressKey(e.key)) { e.preventDefault(); document.activeElement.blur?.(); }
      });
    });

    return { vm, s, time, custom, px, items, labels: ACTION_LABELS, levelNames: LEVEL_NAMES, optionDefs: OPTION_DEFS, hover, hoverOn, hoverText, shareUrl, shareMsg, copyLink, slotMsg, saveSlot, loadSlot, deleteSlot, keyName: k => (k === ' ' ? 'Space' : k),
             settingsMsg, newGame, cellClick, cellFlag, pressStart, pressEnd, downloadSettings, downloadGame, uploadFile };
  },
}).mount('#app');
