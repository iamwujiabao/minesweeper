// Keyboard and focus helpers shared by the three views (plain DOM, no framework).

// Put keyboard focus on the board's cursor cell (the one with tabindex 0), once the view has finished drawing.
export function focusCursorSoon() {
  requestAnimationFrame(() => {
    const el = document.querySelector('#board [tabindex="0"]');
    if (el && !el.contains(document.activeElement)) el.focus();
  });
}

// One keydown handler for the whole page: decides whether a key press is a game shortcut and hands it to the ViewModel.
export function handleGameKey(e, vm) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;                       // browser shortcuts stay the browser's
  const t = e.target, el = t && t.closest ? t : document.body;
  if (!vm.rebinding) {
    // Typing, and open dialogs or menus, are not the game's business. (A dialog that has just been closed may still hold
    // the focus in some browsers, so only an OPEN one counts.)
    const dialog = el.closest('dialog'), menu = el.closest('[popover]');
    if (dialog && dialog.open) return;
    if (menu) { let open = true; try { open = menu.matches(':popover-open'); } catch (err) {} if (open) return; }
    if (el.closest('input, select, textarea')) return;
    if ((e.key === 'Enter' || e.key === ' ') && el.closest('button, a, summary, [role=tab]')) return;   // Enter/Space on a button presses it
  }
  if (!vm.pressKey(e.key)) return;
  e.preventDefault();
  if (el.closest('#board') || e.key.startsWith('Arrow')) focusCursorSoon();    // keep screen-reader focus on the cursor cell
}

// Arrow keys, Home and End move between the tabs of a tab list (put this on the role="tablist" element).
export function tablistKeydown(e) {
  const tabs = [...e.currentTarget.querySelectorAll('[role=tab]')], i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const to = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  tabs[to].focus(); tabs[to].click();
}
