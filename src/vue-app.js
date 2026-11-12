// View (MVVM), Vue 3: the same ViewModel as app.js, rendered by Vue. The ViewModel pushes a fresh
// state() into one shallowRef; Vue re-renders from it and patches only the cells that changed. No game rules here either.
// Bundled by esbuild (npm run build) into dist/vue-app.js (shared code comes from dist/core.js); the page's own HTML is Vue's template.
import { createApp, shallowRef, ref, computed, onMounted } from 'vue';
import { ViewModel, cellSize, ACTION_LABELS, LEVEL_NAMES, OPTION_DEFS, TABS } from './viewmodel.js';
import { rngFromSearch, parsePlay } from './rng.js';
import { Sound } from './sound.js';
import { SettingsFile } from './settingsfile.js';
import { handleGameKey, tablistKeydown } from './a11y.js';

const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

// One settings field (a select or a checkbox with its description), used in the New game menu and in Settings.
const OptionField = {
  props: ['def', 'value'],
  emits: ['change'],
  computed: { desc() { return this.def.type === 'select' ? this.def.choices.find(c => c[0] === this.value)[2] : this.def.desc; } },
  template: `
    <div class="field">
      <template v-if="def.type === 'select'">
        <label :for="'opt-' + def.key">{{ def.label }}</label>
        <select :id="'opt-' + def.key" :value="value" :aria-describedby="'opt-' + def.key + '-desc'" @change="$emit('change', $event.target.value)">
          <option v-for="c in def.choices" :key="c[0]" :value="c[0]">{{ c[1] }}</option>
        </select>
      </template>
      <label v-else><input type="checkbox" :id="'opt-' + def.key" :checked="value" :aria-describedby="'opt-' + def.key + '-desc'" @change="$emit('change', $event.target.checked)"> {{ def.label }}</label>
      <span class="note" :id="'opt-' + def.key + '-desc'">{{ desc }}</span>
    </div>`,
};

const app = createApp({
  setup() {
    const s = shallowRef(null);               // latest vm.state()
    const time = ref('0');                    // separate so the timer doesn't recompute the board
    const custom = ref([9, 9, 10]);           // custom-size inputs
    const win = ref({ w: window.innerWidth, h: window.innerHeight });
    const settingsMsg = ref(''), slotMsg = ref(''), shareMsg = ref('');
    const hover = ref(null);                  // the open number under the mouse: {number, remaining, cells, set}
    const sheetOpen = ref(false);             // phones: the side panel is a bottom sheet
    const settingsDlg = ref(null), helpDlg = ref(null);
    let lastLongPress = 0, pressTimer;

    const vm = new ViewModel(storage, {
      onChange: st => { Sound.onState(st); document.documentElement.dataset.theme = st.options.theme; custom.value = [...st.custom]; time.value = st.timeText; hover.value = null; s.value = st; },
      onTick: t => { time.value = t; },
      rng: rngFromSearch(location.search), play: parsePlay(location.search),
    });

    // Cell size fits the board to the window (at least 32 px on touch screens, where a bigger board scrolls inside itself).
    const px = computed(() => cellSize(s.value.rows, s.value.cols, win.value.w - (win.value.w > 800 ? 420 : 40), win.value.h - 260,
                                       window.matchMedia('(pointer: coarse)').matches ? 32 : 16));

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
    const closeOnBackdrop = e => { if (e.target === e.currentTarget) e.currentTarget.close(); }; // a click on the dark backdrop closes a dialog

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
      document.addEventListener('keydown', e => handleGameKey(e, vm));
    });

    return { vm, s, time, custom, px, hover, hoverOn, hoverText, sheetOpen, settingsDlg, helpDlg,
             labels: ACTION_LABELS, levelNames: LEVEL_NAMES, tabs: TABS, tabLabels: { game: 'Game', controls: 'Controls', appearance: 'Appearance', data: 'Data' },
             themeDef: OPTION_DEFS.find(d => d.key === 'theme'), optGroup: g => OPTION_DEFS.filter(d => d.group === g),
             keyName: k => (k === ' ' ? 'Space' : k), shareUrl, shareMsg, copyLink, slotMsg, saveSlot, loadSlot, deleteSlot,
             settingsMsg, newGame, cellClick, cellFlag, pressStart, pressEnd, closeOnBackdrop, tablistKeydown,
             downloadSettings, downloadGame, uploadFile };
  },
});
app.component('OptionField', OptionField);
app.mount('#app');
