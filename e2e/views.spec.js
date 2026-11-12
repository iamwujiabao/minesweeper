// User-level checks of the game in a real browser.
// playwright.config.js runs the whole file in desktop Chrome, Firefox, WebKit and two phone-sized touch screens.
// Boards are reproducible: pages get ?seed=11, and the test builds the same board with the Game model
// (same seed + same first click = same mines), so it knows where mines and numbers are.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { Game } = require('../src/game.js');
const { mulberry32, dailySeed, dailyId } = require('../src/rng.js');

const file = 'index.html';
const SEED = 11;

// The model's version of the board after the first click at (r, c). Each test gets a fresh one and keeps it in step with the page.
function model(r = 4, c = 4, opts = {}) { const g = new Game(9, 9, 10, mulberry32(SEED), opts); g.reveal(r, c); return g; }
const openCount = g => g.cells.flat().filter(c => c.revealed).length;
const hiddenSafe = g => g.cells.flatMap((row, r) => row.map((cell, c) => [r, c, cell])).filter(([, , cell]) => !cell.mine && !cell.revealed);
const mineCells = g => g.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).filter(([, , x]) => x.mine && !x.revealed).map(([r, c]) => [r, c]);

// Neighbours worked out here from first principles (not by the game code), to check the numbers the pages show.
const hexNeighbors = (r, c) => (r % 2 === 0 ? [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]] : [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]])
  .map(([a, b]) => [r + a, c + b]).filter(([y, x]) => y >= 0 && y < 9 && x >= 0 && x < 9);
const torusNeighbors = (r, c) => [-1, 0, 1].flatMap(a => [-1, 0, 1].map(b => [a, b])).filter(([a, b]) => a || b).map(([a, b]) => [(r + a + 9) % 9, (c + b + 9) % 9]);
const firstMine = g => { const i = g.cells.flat().findIndex(c => c.mine); return [Math.floor(i / 9), i % 9]; };

test.describe('Minesweeper', () => {
  const cell = (page, r, c, cols = 9) => page.locator('#board .cell').nth(r * cols + c);
  const opened = page => page.locator('#board .cell.open');
  // Where things live now: Settings is a dialog with tabs, the New game menu is a popover, stats/saves are in a side panel
  // (a bottom sheet on phones).
  const openSettings = async (page, tab) => { await page.click('#settings-btn'); await page.click('#tab-' + tab); };
  const closeOverlay = page => page.keyboard.press('Escape');                 // closes a dialog or the New game menu
  const openNewGame = page => page.click('#newgame-btn');
  const openSide = async page => { if (await page.locator('#panels-toggle').isVisible() && !(await page.locator('#side.open').count())) await page.click('#panels-toggle'); };
  const closeSide = async page => { if (await page.locator('#side.open').count()) await page.click('#panels-close'); };
  const keyRow = (page, label) => page.locator('.keyrow', { hasText: label + ':' });
  async function load(page, query = `seed=${SEED}`) {
    await page.goto(`/${file}?${query}`);
    await expect(page.locator('#board .cell').first()).toBeVisible();
  }
  async function saveDownload(page, buttonId) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(buttonId)]);
    return dl;
  }

  test('starts a beginner game', async ({ page }) => {
    await load(page);
    await expect(page.locator('#board .cell')).toHaveCount(81);
    await expect(page.locator('#mines')).toHaveText('10');
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#redo')).toBeDisabled();
    await expect(page.locator('#status')).toContainText('Playing');
  });

  test('first click is safe and flood-fills exactly like the model', async ({ page }) => {
    const g = model();
    await load(page);
    await cell(page, 4, 4).click();
    await expect(opened(page)).toHaveCount(openCount(g));
    expect(openCount(g)).toBeGreaterThan(1); // it really was a flood-fill
    await expect(page.locator('#status')).toContainText('Playing');
  });

  test('right-click flags, counter follows, undo and redo', async ({ page }) => {
    await load(page);
    await cell(page, 0, 0).click({ button: 'right' });
    await expect(cell(page, 0, 0)).toHaveText('🚩');
    await expect(page.locator('#mines')).toHaveText('9');
    await page.click('#undo');
    await expect(cell(page, 0, 0)).toHaveText('');
    await expect(page.locator('#mines')).toHaveText('10');
    await page.click('#redo');
    await expect(page.locator('#mines')).toHaveText('9');
  });

  test('undo and redo the first move', async ({ page }) => {
    const g = model();
    await load(page);
    await cell(page, 4, 4).click();
    await expect(opened(page)).toHaveCount(openCount(g));
    await page.click('#undo');
    await expect(opened(page)).toHaveCount(0);
    await expect(page.locator('#undo')).toBeDisabled();
    await page.click('#redo');
    await expect(opened(page)).toHaveCount(openCount(g)); // same mines come back
  });

  test('hitting a mine loses, shows every mine, and undo takes it back', async ({ page }) => {
    const g = model(), [mr, mc] = firstMine(g);
    await load(page);
    await cell(page, 4, 4).click();
    await cell(page, mr, mc).click();
    await expect(page.locator('#status')).toContainText('Boom');
    await expect(page.locator('#board .cell', { hasText: '💣' })).toHaveCount(10);
    await cell(page, 4, 4).click({ force: true }); // further clicks are ignored
    await expect(page.locator('#status')).toContainText('Boom');
    await page.click('#undo');
    await expect(page.locator('#status')).toContainText('Playing');
    await expect(page.locator('#board .cell', { hasText: '💣' })).toHaveCount(0);
  });

  test('revealing every safe cell wins, and undo reopens the game', async ({ page }) => {
    const g = model();
    await load(page);
    await cell(page, 4, 4).click();
    for (const [r, c] of hiddenSafe(g).map(([r, c]) => [r, c])) {
      if (g.cells[r][c].revealed) continue; // opened by an earlier flood-fill
      g.reveal(r, c);
      await cell(page, r, c).click();
    }
    expect(g.status).toBe('won');
    await expect(page.locator('#status')).toContainText('won');
    await expect(page.locator('#mines')).toHaveText('0'); // mines are auto-flagged
    await page.click('#undo');
    await expect(page.locator('#status')).toContainText('Playing');
  });

  test('clicking a number with matching flags chords', async ({ page }) => {
    const g = model();
    let target;
    for (let r = 0; r < 9 && !target; r++)
      for (let c = 0; c < 9; c++) {
        const x = g.cells[r][c], around = g.neighbors(r, c);
        if (x.revealed && x.adjacent > 0 && around.some(([a, b]) => !g.cells[a][b].mine && !g.cells[a][b].revealed)) { target = [r, c]; break; }
      }
    expect(target, 'seed should give a chordable number').toBeTruthy();
    const [tr, tc] = target;
    await load(page);
    await cell(page, 4, 4).click();
    await cell(page, tr, tc).click(); // no flags yet: a number does nothing
    await expect(opened(page)).toHaveCount(openCount(g));
    for (const [a, b] of g.neighbors(tr, tc).filter(([a, b]) => g.cells[a][b].mine)) {
      g.toggleFlag(a, b);
      await cell(page, a, b).click({ button: 'right' });
    }
    g.chord(tr, tc);
    await cell(page, tr, tc).click();
    await expect(opened(page)).toHaveCount(openCount(g));
    await page.click('#undo'); // the whole chord is one undo step
    await expect(opened(page)).toHaveCount(openCount(model()));
  });

  test('keyboard: arrows move the cursor, Enter reveals, F flags, U undoes', async ({ page }) => {
    await load(page);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
    await expect(cell(page, 1, 2)).toHaveClass(/cursor/);
    await page.keyboard.press('f');
    await expect(cell(page, 1, 2)).toHaveText('🚩');
    await page.keyboard.press('u');
    await expect(cell(page, 1, 2)).toHaveText('');
    await page.keyboard.press('Enter');
    await expect(opened(page).first()).toBeVisible();
    await page.keyboard.press('n'); // new game
    await expect(opened(page)).toHaveCount(0);
  });

  test('rebinding: add a second key to an action, saved across reload; last key cannot be removed', async ({ page }) => {
    await load(page);
    await openSettings(page, 'controls');
    await keyRow(page, 'Flag').getByRole('button', { name: '+ add key' }).click();
    await page.keyboard.press('c'); // already used by Chord only
    await expect(page.locator('#keymsg')).toContainText('already used');
    await page.keyboard.press('x');
    await expect(keyRow(page, 'Flag')).toContainText('x ✕');
    await closeOverlay(page);
    await page.keyboard.press('x'); // the new key flags the cursor cell
    await expect(cell(page, 0, 0)).toHaveText('🚩');
    await page.reload(); await openSettings(page, 'controls');
    await expect(keyRow(page, 'Flag')).toContainText('x ✕');
    await keyRow(page, 'Flag').getByRole('button', { name: /^x/ }).click();
    await expect(keyRow(page, 'Flag').getByRole('button', { name: /^f/ })).toBeDisabled(); // only key left
    await page.click('#resetkeys');
    await expect(keyRow(page, 'Flag')).not.toContainText('x');
  });

  test('difficulty and custom size are saved', async ({ page }) => {
    await load(page); await openNewGame(page);
    await page.selectOption('#level', 'expert');
    await expect(page.locator('#board .cell')).toHaveCount(480);
    await expect(page.locator('#mines')).toHaveText('99');
    await page.reload(); await openNewGame(page);
    await expect(page.locator('#level')).toHaveValue('expert');
    await expect(page.locator('#board .cell')).toHaveCount(480);
    await page.selectOption('#level', 'custom');
    await page.fill('#rows', '6'); await page.fill('#cols', '7'); await page.fill('#minesIn', '5');
    await page.click('#start');
    await expect(page.locator('#board .cell')).toHaveCount(42);
    await expect(page.locator('#mines')).toHaveText('5');
    await page.reload();
    await expect(page.locator('#board .cell')).toHaveCount(42);
  });

  test('timer runs after the first move', async ({ page }) => {
    await load(page);
    await expect(page.locator('#time')).toHaveText('0');
    await cell(page, 4, 4).click();
    await expect.poll(async () => Number(await page.locator('#time').textContent()), { timeout: 6000 }).toBeGreaterThanOrEqual(2);
  });

  test('sound mute and volume are saved', async ({ page }) => {
    await load(page); await openSettings(page, 'appearance');
    await expect(page.locator('#sound')).toBeChecked();
    await page.uncheck('#sound');
    await page.locator('#volume').fill('0.9');
    await page.reload();
    await expect(page.locator('#sound')).not.toBeChecked();
    await expect(page.locator('#volume')).toHaveValue('0.9');
  });

  test('settings download and upload', async ({ page }, info) => {
    await load(page); await openSettings(page, 'data');
    const dl = await saveDownload(page, '#export');
    expect(dl.suggestedFilename()).toBe('minesweeper-settings.json');
    const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    expect(saved).toMatchObject({ version: 1, type: 'settings', level: 'beginner', muted: false });

    await page.setInputFiles('#settingsFile', { name: 's.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"level":"expert","volume":0.3}') });
    await expect(page.locator('#settingsMsg')).toContainText('Imported');
    await expect(page.locator('#board .cell')).toHaveCount(480);
    await expect(page.locator('#volume')).toHaveValue('0.3');

    await page.setInputFiles('#settingsFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"volume":9}') });
    await expect(page.locator('#settingsMsg')).toContainText('Not imported');
    await expect(page.locator('#volume')).toHaveValue('0.3'); // unchanged
    await page.setInputFiles('#settingsFile', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(200000, 'x') });
    await expect(page.locator('#settingsMsg')).toContainText('too large');
  });

  test('a game in progress resumes after a reload', async ({ page }) => {
    const g = model(), [fr, fc] = firstMine(g); // a hidden cell to flag
    await load(page);
    await cell(page, 4, 4).click();
    await cell(page, fr, fc).click({ button: 'right' });
    await page.reload();
    await expect(opened(page)).toHaveCount(openCount(g));
    await expect(cell(page, fr, fc)).toHaveText('🚩');
    await expect(page.locator('#undo')).toBeEnabled();
    await page.click('#undo'); await page.click('#undo'); // history survived the reload
    await expect(opened(page)).toHaveCount(0);
    await expect(page.locator('#undo')).toBeDisabled();
  });

  test('download the game, start over, upload it back', async ({ page }) => {
    const g = model(), [fr, fc] = firstMine(g); // a hidden cell to flag
    await load(page);
    await cell(page, 4, 4).click();
    await cell(page, fr, fc).click({ button: 'right' });
    await openSettings(page, 'data');
    const dl = await saveDownload(page, '#exportGame');
    expect(dl.suggestedFilename()).toBe('minesweeper-game.json');
    const file = await dl.path();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ version: 1, type: 'game', level: 'beginner' });

    await closeOverlay(page);
    await page.click('#new');
    await expect(opened(page)).toHaveCount(0);
    await openSettings(page, 'data');
    await page.setInputFiles('#settingsFile', file);
    await expect(page.locator('#settingsMsg')).toContainText('Imported');
    await closeOverlay(page);
    await expect(opened(page)).toHaveCount(openCount(g));
    await expect(cell(page, fr, fc)).toHaveText('🚩');
    await page.click('#undo'); await page.click('#undo');
    await expect(opened(page)).toHaveCount(0); // undo history came with the file
  });

  test('a tampered game file is rejected and the board is left alone', async ({ page }) => {
    const g = model();
    await load(page);
    await cell(page, 4, 4).click();
    await openSettings(page, 'data');
    const dl = await saveDownload(page, '#exportGame');
    const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    data.game.cells = data.game.cells.slice(1); // wrong length
    await page.setInputFiles('#settingsFile', { name: 'bad-game.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await expect(page.locator('#settingsMsg')).toContainText('Not a valid saved game');
    await expect(opened(page)).toHaveCount(openCount(g));
  });

  // ---- saved-game slots and best times ----
  test('saved-game slots: save, play on, load back, delete, survive reload', async ({ page }) => {
    const g = model();
    await load(page); await openSide(page);
    await expect(page.locator('#slot-load-1')).toBeDisabled();
    await closeSide(page);
    await cell(page, 4, 4).click();
    await openSide(page);
    await page.click('#slot-save-2');
    await expect(page.locator('.slotrow').nth(1)).toContainText('Beginner, playing');
    await expect(page.locator('.slotrow').nth(0)).toContainText('empty');

    await closeSide(page); await page.click('#new');
    await expect(opened(page)).toHaveCount(0);
    await openSide(page); await page.click('#slot-load-2');
    await expect(page.locator('#slotMsg')).toContainText('Loaded slot 2');
    await closeSide(page);
    await expect(opened(page)).toHaveCount(openCount(g));
    await page.click('#undo');                                   // undo history was saved too
    await expect(opened(page)).toHaveCount(0);

    await openSide(page); await page.click('#slot-save-3');      // a different slot
    await page.reload(); await openSide(page);
    await expect(page.locator('.slotrow').nth(1)).toContainText('Beginner');
    await expect(page.locator('.slotrow').nth(2)).toContainText('Beginner');
    await page.click('#slot-delete-2');
    await expect(page.locator('.slotrow').nth(1)).toContainText('empty');
    await expect(page.locator('#slot-load-2')).toBeDisabled();
    await expect(page.locator('#slot-load-3')).toBeEnabled();
  });

  test('a win goes into the best-times table (top of the column, shown as Best) and can be cleared', async ({ page }) => {
    const g = model();
    await load(page);
    await cell(page, 4, 4).click();
    await expect.poll(async () => Number(await page.locator('#time').textContent()), { timeout: 6000 }).toBeGreaterThanOrEqual(1);
    for (const [r, c] of hiddenSafe(g).map(([r, c]) => [r, c])) {
      if (g.cells[r][c].revealed) continue;
      g.reveal(r, c);
      await cell(page, r, c).click();
    }
    await expect(page.locator('#status')).toContainText('won');
    const first = page.locator('#scores tbody tr').first().locator('td').first();
    await expect(first).toHaveText(/^\d+s$/);
    await expect(page.locator('#best')).toHaveText(await first.textContent());
    await expect(page.locator('#scores tbody tr')).toHaveCount(5);
    await page.click('#undo');                                   // undo then winning again is a new win,
    await expect(page.locator('#scores tbody tr').nth(1).locator('td').first()).toHaveText('');
    await page.reload(); await openSide(page);                   // but the first one persisted
    await expect(page.locator('#scores tbody tr').first().locator('td').first()).toHaveText(/^\d+s$/);
    await page.click('#clear-scores');
    await expect(page.locator('#scores tbody tr').first().locator('td').first()).toHaveText('');
  });

  // ---- phones and touch ----
  test('layout: the board never sticks out past the screen edge, even the largest one', async ({ page }) => {
    // (a phone browser would zoom out to fit an overflowing page, so compare with the real screen width, not window.innerWidth)
    const screenWidth = page.viewportSize().width;
    const boardRight = () => page.evaluate(() => document.querySelector('#board').getBoundingClientRect().right);
    await load(page);
    expect(await boardRight()).toBeLessThanOrEqual(screenWidth);
    await openNewGame(page);
    await page.selectOption('#level', 'expert');
    await expect(page.locator('#board .cell')).toHaveCount(480);
    expect(await boardRight()).toBeLessThanOrEqual(screenWidth); // on a phone the board scrolls inside itself
  });

  test('touch: long-press flags, and the click that follows a long-press is ignored', async ({ page }) => {
    await load(page);
    const c = cell(page, 0, 0);
    await c.evaluate(el => el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })));
    await page.waitForTimeout(600);
    await expect(c).toHaveText('🚩');
    await c.evaluate(el => { el.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true })); el.click(); });
    await expect(c).toHaveText('🚩');                // the click did not reveal it
    await expect(page.locator('#mines')).toHaveText('9');
    await expect(opened(page)).toHaveCount(0);
    // a short touch does not flag
    const d = cell(page, 8, 8);
    await d.evaluate(el => { el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true })); });
    await page.waitForTimeout(600);
    await expect(d).toHaveText('');
  });

  test('touch: tapping reveals a cell', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'needs a touch screen');
    const g = model();
    await load(page);
    await cell(page, 4, 4).tap();
    await expect(opened(page)).toHaveCount(openCount(g));
  });

  // ---- extra mechanics, assists, modes, boards, sharing, progress, replay, themes ----
  // Start with game options already saved (as if chosen earlier), so the very first game uses them.
  async function loadWith(page, options, query = `seed=${SEED}`) {
    await page.addInitScript(o => { if (!localStorage.getItem('ms-options')) localStorage.setItem('ms-options', JSON.stringify(o)); }, options);
    await load(page, query);
  }
  // Every number on screen equals the mines among its neighbours, counted with the independent neighbour function.
  const expectNumbers = async (page, g, nbFn) => {
    let checked = 0;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const x = g.cells[r][c];
      if (!x.revealed || x.mine) continue;
      const want = nbFn(r, c).filter(([y, z]) => g.cells[y][z].mine).length;
      await expect(cell(page, r, c)).toHaveText(want ? String(want) : '');
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  };
  const winBoard = async (page, g) => { // click every safe cell, keeping the model in step
    for (const [r, c] of hiddenSafe(g).map(([r, c]) => [r, c])) {
      if (g.cells[r][c].revealed) continue;
      g.reveal(r, c);
      await cell(page, r, c).click();
    }
  };

  test('right-click cycles flag, ?, clear; with question marks off it just toggles', async ({ page }) => {
    await load(page);
    const c = cell(page, 0, 0);
    await c.click({ button: 'right' }); await expect(c).toHaveText('🚩'); await expect(page.locator('#mines')).toHaveText('9');
    await c.click({ button: 'right' }); await expect(c).toHaveText('?');  await expect(page.locator('#mines')).toHaveText('10');
    await c.click({ button: 'right' }); await expect(c).toHaveText('');
    await openSettings(page, 'game');
    await page.uncheck('#opt-questionMarks');
    await closeOverlay(page);
    await c.click({ button: 'right' }); await expect(c).toHaveText('🚩');
    await c.click({ button: 'right' }); await expect(c).toHaveText('');
  });

  test('hint highlights the cell the logic solver says is safe; says so before the first click', async ({ page }) => {
    const g = model(), h = g.hint();
    expect(h, 'seed should give a hint after the first click').toBeTruthy();
    await load(page);
    await page.click('#hint');
    await expect(page.locator('#status')).toContainText('first click is always safe');
    await cell(page, 4, 4).click();
    await page.click('#hint');
    await expect(page.locator('#board .cell.hint')).toHaveCount(1);
    await expect(cell(page, h.r, h.c)).toHaveClass(/hint/);
    expect(g.cells[h.r][h.c].mine).toBe(false);
    await cell(page, 0, 0).click({ button: 'right' });           // the next change clears the highlight
    await expect(page.locator('#board .cell.hint')).toHaveCount(0);
  });

  test('hovering an open number outlines its neighbours and counts the flags still needed', async ({ page }) => {
    const g = model();
    const target = g.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).find(([r, c, x]) => x.revealed && x.adjacent > 0 && g.neighbors(r, c).some(([a, b]) => g.cells[a][b].mine));
    const [tr, tc, tx] = target;
    await load(page);
    await cell(page, 4, 4).click();
    await cell(page, tr, tc).hover();
    await expect(page.locator('#board .cell.nb')).toHaveCount(g.neighbors(tr, tc).length);
    await expect(page.locator('#hoverInfo')).toContainText(`${tx.adjacent}: ${tx.adjacent} more flag`);
    await page.mouse.move(0, 0);
    await expect(page.locator('#board .cell.nb')).toHaveCount(0);
    const [mr, mc] = g.neighbors(tr, tc).find(([a, b]) => g.cells[a][b].mine);
    await cell(page, mr, mc).click({ button: 'right' });         // one flag placed
    await cell(page, tr, tc).hover();
    await expect(page.locator('#hoverInfo')).toContainText(tx.adjacent === 1 ? 'all flags placed' : `${tx.adjacent - 1} more flag`);
  });

  test('a number whose flags are all placed is dimmed (and not when the option is off)', async ({ page }) => {
    const g = model();
    const [tr, tc] = g.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).find(([r, c, x]) => x.revealed && x.adjacent > 0)
      .slice(0, 2);
    await load(page);
    await cell(page, 4, 4).click();
    await expect(cell(page, tr, tc)).not.toHaveClass(/done/);
    for (const [a, b] of g.neighbors(tr, tc).filter(([a, b]) => g.cells[a][b].mine)) await cell(page, a, b).click({ button: 'right' });
    await expect(cell(page, tr, tc)).toHaveClass(/done/);
    await openSettings(page, 'appearance');
    await page.uncheck('#opt-dimNumbers');
    await expect(cell(page, tr, tc)).not.toHaveClass(/done/);
  });

  test('game options are applied at the next new game and saved', async ({ page }) => {
    await load(page); await openNewGame(page);
    await page.selectOption('#opt-mode', 'lives');
    await expect(page.locator('#optionsNote')).toContainText('next new game');
    await expect(page.locator('#status')).not.toContainText('Lives');
    await page.click('#start');
    await expect(page.locator('#status')).toContainText('Lives: ❤️❤️❤️');
    await page.reload(); await openNewGame(page);
    await expect(page.locator('#opt-mode')).toHaveValue('lives');
  });

  test('lives mode: a mine costs a life, the third ends the game', async ({ page }) => {
    const g = model(4, 4, { lives: 3 });
    await loadWith(page, { mode: 'lives' });
    await cell(page, 4, 4).click();
    const mines = mineCells(g);
    await cell(page, ...mines[0]).click();
    await expect(page.locator('#status')).toContainText('Playing');
    await expect(page.locator('#status')).toContainText('Lives: ❤️❤️');
    await expect(page.locator('#status')).not.toContainText('❤️❤️❤️');
    await cell(page, ...mines[1]).click();
    await expect(page.locator('#status')).toContainText('Lives: ❤️ ');
    await cell(page, ...mines[2]).click();
    await expect(page.locator('#status')).toContainText('Out of lives');
  });

  test('power-ups: the scanner counts mines around a cell, the shield absorbs one mine', async ({ page }) => {
    const g = model(4, 4, { powerups: true });
    await loadWith(page, { powerups: true });
    await expect(page.locator('#scanner')).toBeVisible();
    await cell(page, 4, 4).click();
    const [sr, sc] = g.cells.flatMap((row, r) => row.map((x, c) => [r, c, x])).find(([, , x]) => !x.revealed && !x.mine);
    g.scan(sr, sc);
    await page.click('#scanner');
    await expect(page.locator('#status')).toContainText('click a cell to scan');
    await cell(page, sr, sc).click();
    await expect(cell(page, sr, sc)).toHaveText('🔍' + g.scans[0].n);
    await expect(page.locator('#scanner')).toHaveText('Scanner (2)');
    const [mr, mc] = mineCells(g)[0];
    await cell(page, mr, mc).click();                            // the shield takes the hit
    await expect(page.locator('#status')).toContainText('Playing');
    await expect(page.locator('#status')).toContainText('Shield 0');
    await expect(cell(page, mr, mc)).toHaveText('🚩');
    const [m2r, m2c] = mineCells(g)[1];
    await cell(page, m2r, m2c).click();
    await expect(page.locator('#status')).toContainText('Boom');
  });

  test('two players: turns alternate and a mine loses for whoever hit it', async ({ page }) => {
    const g = model(4, 4, { players: 2 });
    await loadWith(page, { mode: 'twoplayer' });
    await cell(page, 4, 4).click();
    await expect(page.locator('#status')).toContainText("Player 2's turn");
    const [r, c] = hiddenSafe(g)[0];
    await cell(page, r, c).click();
    await expect(page.locator('#status')).toContainText("Player 1's turn");
    const [mr, mc] = mineCells(g)[0];
    await cell(page, mr, mc).click();
    await expect(page.locator('#status')).toContainText('Player 1 hit a mine, so Player 2 wins');
  });

  test('modes show their own clock and limits: zen, time attack, limited undo', async ({ page }) => {
    await loadWith(page, { mode: 'zen' });
    await expect(page.locator('#time')).toHaveText('–');
    await cell(page, 4, 4).click();
    await page.waitForTimeout(1300);
    await expect(page.locator('#time')).toHaveText('–');
    await page.close();
  });
  test('time attack counts down; limited undo runs out', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    await a.addInitScript(() => localStorage.setItem('ms-options', JSON.stringify({ mode: 'timeattack' })));
    await a.goto(`/${file}?seed=${SEED}`);
    await expect(a.locator('#time')).toHaveText('122');          // 9 x 9 cells x 1.5 seconds
    await a.locator('#board .cell').nth(40).click();
    await expect.poll(async () => Number(await a.locator('#time').textContent()), { timeout: 6000 }).toBeLessThan(121);
    await ctx.close();
    const ctx2 = await browser.newContext();
    const b = await ctx2.newPage();
    await b.addInitScript(() => localStorage.setItem('ms-options', JSON.stringify({ mode: 'undolimit' })));
    await b.goto(`/${file}?seed=${SEED}`);
    await expect(b.locator('#status')).toContainText('Undos left: 3');
    for (const i of [0, 1, 2]) await b.locator('#board .cell').nth(i).click({ button: 'right' });
    await b.locator('#board .cell').nth(3).click({ button: 'right' });
    for (let i = 0; i < 3; i++) await b.click('#undo');
    await expect(b.locator('#undo')).toBeDisabled();
    await expect(b.locator('#status')).toContainText('Undos left: 0');
    await ctx2.close();
  });

  test('hexagonal board: hex-shaped cells and flood-fill that matches the 6-neighbour model', async ({ page }) => {
    const g = model(4, 4, { topology: 'hex' });
    await loadWith(page, { board: 'hex' });
    await expect(page.locator('#board')).toHaveClass(/hexboard/);
    await expect(cell(page, 1, 0)).toHaveClass(/hex odd/);
    await cell(page, 4, 4).click();
    await expect(opened(page)).toHaveCount(openCount(g));
    expect(openCount(g)).toBeGreaterThan(1);
    await expectNumbers(page, g, hexNeighbors);
  });

  test('wrap-around board: the flood-fill crosses the edges exactly like the model', async ({ page }) => {
    const g = model(4, 4, { topology: 'torus' });
    await loadWith(page, { board: 'torus' });
    await cell(page, 4, 4).click();
    await expect(opened(page)).toHaveCount(openCount(g));
    await expectNumbers(page, g, torusNeighbors);
  });

  test('no-guess boards can be finished by following hints, without ever guessing', async ({ page }) => {
    await loadWith(page, { noGuess: true });
    await expect(page.locator('#status')).toContainText('No-guess board');
    await cell(page, 4, 4).click();
    for (let i = 0; i < 100; i++) {
      if (/won/.test(await page.locator('#status').textContent())) break;
      await page.click('#hint');
      await expect(page.locator('#board .cell.hint')).toHaveCount(1);
      await page.locator('#board .cell.hint').click();
    }
    await expect(page.locator('#status')).toContainText('won');
  });

  test('daily challenge: today\'s board is the same for everybody', async ({ page }) => {
    const seed = dailySeed(dailyId(new Date())), g = new Game(16, 16, 40, Math.random, { seed });
    g.reveal(8, 8);
    await load(page); await openNewGame(page);
    await page.click('#daily');
    await expect(page.locator('#status')).toContainText('Daily challenge ' + dailyId(new Date()));
    await expect(page.locator('#board .cell')).toHaveCount(256);
    await cell(page, 8, 8, 16).click();
    await expect(opened(page)).toHaveCount(openCount(g));
    expect(await page.locator('#shareLink').inputValue()).toContain(`?play=16x16x40-square-${seed}`);
  });

  test('share link: the link reproduces the board; bad links are ignored', async ({ page }) => {
    await load(page);
    const link = await page.locator('#shareLink').inputValue();
    expect(link).toMatch(/\?play=9x9x10-square-\d+$/);
    const seedOfLink = Number(link.split('-').pop());
    const g = new Game(9, 9, 10, Math.random, { seed: seedOfLink }); g.reveal(4, 4);
    await page.goto(link);
    await cell(page, 4, 4).click();
    await expect(opened(page)).toHaveCount(openCount(g));
    await page.goto(`/${file}?play=garbage`);
    await expect(page.locator('#board .cell')).toHaveCount(81);
    await page.goto(`/${file}?play=7x12x9-hex-42`);              // another shape and size
    await expect(page.locator('#board .cell')).toHaveCount(84);
    await expect(page.locator('#board')).toHaveClass(/hexboard/);
  });

  test('a win updates statistics and unlocks a badge; statistics can be reset', async ({ page }) => {
    const g = model();
    await load(page);
    await cell(page, 4, 4).click();
    await page.waitForTimeout(1200);                             // so the game has a time (3BV/s needs one)
    await winBoard(page, g);
    await expect(page.locator('#status')).toContainText('won');
    await expect(page.locator('#status')).toContainText('Unlocked: First win');
    const stat = label => page.locator('#stats tr', { hasText: label }).locator('td').nth(1);
    await expect(stat('Games played')).toHaveText('1');
    await expect(stat('Win rate')).toHaveText('100%');
    await expect(stat('Last game 3BV').first()).toHaveText(String(g.bbbv()));
    await expect(page.locator('#achievements li.unlocked').first()).toContainText('First win');
    await page.reload(); await openSide(page);
    await expect(stat('Games played')).toHaveText('1');           // saved
    await page.click('#clear-stats');
    await expect(stat('Games played')).toHaveText('0');
    await expect(page.locator('#achievements li.unlocked')).toHaveCount(0);
  });

  test('replay: step through a finished game, auto-play, and close', async ({ page }) => {
    const g = model(), [mr, mc] = firstMine(g);
    await load(page);
    await expect(page.locator('#replay')).toBeHidden();
    await cell(page, 4, 4).click();
    await cell(page, mr, mc).click();
    await expect(page.locator('#status')).toContainText('Boom');
    await page.click('#replay');
    await expect(page.locator('#status')).toContainText('Replay: move 0 of 2');
    await expect(opened(page)).toHaveCount(0);
    await cell(page, 0, 0).click({ force: true });              // read-only while replaying
    await expect(page.locator('#status')).toContainText('Replay: move 0 of 2');
    await page.click('#replay-next');
    await expect(opened(page)).toHaveCount(openCount(g));
    await page.click('#replay-prev');
    await expect(opened(page)).toHaveCount(0);
    await page.click('#replay-play');                           // auto-play: one move per second
    await expect(page.locator('#status')).toContainText('you hit a mine', { timeout: 6000 });
    await page.click('#replay-close');
    await expect(page.locator('#status')).toContainText('Boom');
    await expect(page.locator('#replaybar')).toBeHidden();
  });

  test('themes: Auto follows the device, dark and colour-blind apply at once and are remembered', async ({ page }) => {
    await load(page);
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await theme()).toBe('auto');
    await page.emulateMedia({ colorScheme: 'light' });
    const lightBg = await bg();
    await page.emulateMedia({ colorScheme: 'dark' });
    const autoDark = await bg();
    expect(autoDark).not.toBe(lightBg);                          // Auto switched with the device
    await page.selectOption('#opt-theme', 'light');
    expect(await bg()).toBe(lightBg);                            // an explicit choice ignores the device
    await page.selectOption('#opt-theme', 'dark');
    expect(await theme()).toBe('dark');
    expect(await bg()).toBe(autoDark);
    await page.selectOption('#opt-theme', 'colorblind');
    expect(await theme()).toBe('colorblind');
    await cell(page, 4, 4).click();
    const numberColour = await page.locator('#board .cell.n1').first().evaluate(el => getComputedStyle(el).color);
    expect(numberColour).toBe('rgb(0, 102, 158)');               // the colour-blind blue, not plain blue
    await page.reload();
    expect(await theme()).toBe('colorblind');
  });

  // ---- the redesign: layout, look, feedback, touch, accessibility, settings, performance ----
  const box = (page, sel) => page.locator(sel).boundingBox();

  test('layout: board first in a card with the counters either side of the face; side panel beside it (bottom sheet on phones)', async ({ page }) => {
    await load(page);
    const [mines, face, time, board, card] = await Promise.all(['#mines', '#new', '#time', '#board', '.game'].map(sel => box(page, sel)));
    expect(mines.x).toBeLessThan(face.x);
    expect(face.x).toBeLessThan(time.x);
    expect(Math.abs(board.x + board.width / 2 - (card.x + card.width / 2))).toBeLessThan(10);   // centred in the card
    expect(board.y - card.y).toBeLessThan(420);                                                   // near the top of the card
    const { width: vw, height: vh } = page.viewportSize();
    if (vw > 800) {
      const side = await box(page, '#side');
      expect(side.x).toBeGreaterThanOrEqual(card.x + card.width - 1);                              // beside the board
    } else {
      await expect(page.locator('#side')).toBeHidden();
      await page.click('#panels-toggle');
      await expect(page.locator('#side')).toBeVisible();
      await expect.poll(async () => { const b = await box(page, '#side'); return Math.abs(b.y + b.height - vh); }).toBeLessThan(3);   // a sheet at the bottom (after it slides up)
      expect((await box(page, '#side')).width).toBeGreaterThan(vw - 4);
      await page.click('#panels-close');
      await expect(page.locator('#side')).toBeHidden();
    }
  });

  test('New game menu groups difficulty, custom size, game options, start and daily; Esc closes it', async ({ page }) => {
    await load(page);
    await expect(page.locator('#level')).toBeHidden();
    await openNewGame(page);
    for (const sel of ['#level', '#opt-mode', '#opt-board', '#opt-noGuess', '#opt-powerups', '#start', '#daily']) await expect(page.locator(sel)).toBeVisible();
    await page.selectOption('#level', 'custom');
    for (const sel of ['#rows', '#cols', '#minesIn']) await expect(page.locator(sel)).toBeVisible();
    await closeOverlay(page);
    await expect(page.locator('#level')).toBeHidden();
  });

  test('3D look: hidden cells are raised, open cells flat and inset; counters are monospace digits', async ({ page }) => {
    await load(page);
    await cell(page, 4, 4).click();
    const style = (loc, props) => loc.evaluate((el, ps) => Object.fromEntries(ps.map(p => [p, getComputedStyle(el)[p]])), props);
    const hidden = await style(page.locator('#board .cell:not(.open)').first(), ['boxShadow', 'backgroundColor']);
    const open = await style(page.locator('#board .cell.open').first(), ['boxShadow', 'backgroundColor']);
    expect((hidden.boxShadow.match(/inset/g) || []).length).toBeGreaterThanOrEqual(2);   // light top-left edge + dark bottom-right edge
    expect((open.boxShadow.match(/inset/g) || []).length).toBe(1);                       // just a flat inset line
    expect(hidden.backgroundColor).not.toBe(open.backgroundColor);
    const lcd = await style(page.locator('#mines'), ['fontFamily', 'fontVariantNumeric']);
    expect(lcd.fontFamily).toMatch(/mono|Menlo|Consolas/i);
    expect(lcd.fontVariantNumeric).toContain('tabular-nums');
  });

  test('loss display: the exploded mine stands out, a wrong flag gets a cross, the rest is dimmed', async ({ page }) => {
    const g = model(), mines = mineCells(g), [wr, wc] = hiddenSafe(g)[0];
    await load(page);
    await cell(page, 4, 4).click();
    await cell(page, ...mines[0]).click({ button: 'right' });   // a correct flag
    await cell(page, wr, wc).click({ button: 'right' });        // a wrong flag
    await cell(page, ...mines[1]).click();                      // boom
    await expect(cell(page, ...mines[1])).toHaveClass(/exploded/);
    await expect(cell(page, ...mines[2])).not.toHaveClass(/exploded/);
    await expect(cell(page, ...mines[2])).toHaveText('💣');
    await expect(cell(page, ...mines[0])).toHaveText('🚩');
    await expect(cell(page, ...mines[0])).not.toHaveClass(/wrong/);
    await expect(cell(page, wr, wc)).toHaveClass(/wrong/);
    expect(await cell(page, wr, wc).evaluate(el => getComputedStyle(el, '::after').content)).toContain('✖');
    const faded = page.locator('#board .cell.faded').first();
    await expect(faded).toBeVisible();
    expect(Number(await faded.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(1);
  });

  test('result overlay: shows the outcome, time and best; Close, Undo and New game work; it returns after another ending', async ({ page }) => {
    const g = model(), [mr, mc] = firstMine(g);
    await load(page);
    await cell(page, 4, 4).click();
    await expect(page.locator('#result')).toBeHidden();
    await cell(page, mr, mc).click();
    await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#resultTitle')).toHaveText('Boom!');
    await expect(page.locator('#resultTime')).toHaveText(/^\d+ s$/);
    await expect(page.locator('#resultBest')).toHaveText('–');
    await expect(page.locator('#new')).toHaveText('😵');
    await page.click('#result-close');
    await expect(page.locator('#result')).toBeHidden();
    await page.click('#undo');
    await expect(page.locator('#new')).toHaveText('🙂');
    await cell(page, mr, mc).click();                           // lose the same way again: the overlay comes back
    await expect(page.locator('#result')).toBeVisible();
    await page.click('#result-undo');
    await expect(page.locator('#result')).toBeHidden();
    await expect(page.locator('#status')).toContainText('Playing');
    await cell(page, mr, mc).click();
    await page.click('#result-new');
    await expect(opened(page)).toHaveCount(0);
    await expect(page.locator('#result')).toBeHidden();
  });

  test('result overlay on a win, with a happy face', async ({ page }) => {
    const g = model();
    await load(page);
    await cell(page, 4, 4).click();
    await winBoard(page, g);
    await expect(page.locator('#resultTitle')).toHaveText('You won!');
    await expect(page.locator('#new')).toHaveText('😎');
  });

  test('blocked moves shake the cell; buttons that cannot act flash the status line', async ({ page }) => {
    const g = model(), [mr, mc] = firstMine(g);
    await load(page);
    await page.keyboard.press('u');                              // nothing to undo
    await expect(page.locator('#status')).toHaveClass(/flash[01]/);
    await cell(page, 4, 4).click();
    await cell(page, mr, mc).click({ button: 'right' });
    await cell(page, mr, mc).click();                            // a flagged cell cannot be opened
    await expect(cell(page, mr, mc)).toHaveClass(/shake[01]/);
    await expect(cell(page, mr, mc)).toHaveText('🚩');
    expect(await cell(page, mr, mc).evaluate(el => getComputedStyle(el).animationName)).toMatch(/shake/);
  });

  test('animations: cells pop (flood-fill ripples out), flags bounce, and prefers-reduced-motion turns them off', async ({ page }) => {
    const g = model(), [mr, mc] = firstMine(g);
    await load(page);
    await cell(page, 4, 4).click();
    const delays = await page.locator('#board .cell.pop').evaluateAll(els => els.map(el => parseFloat(el.style.getPropertyValue('--d'))));
    expect(delays.length).toBe(openCount(g));
    expect(Math.min(...delays)).toBe(0);
    expect(Math.max(...delays)).toBeGreaterThan(0);              // staggered, not all at once
    expect(await cell(page, 4, 4).evaluate(el => getComputedStyle(el).animationName)).toBe('pop');
    await cell(page, mr, mc).click({ button: 'right' });
    await expect(cell(page, mr, mc)).toHaveClass(/\bflag\b/);
    expect(await cell(page, mr, mc).evaluate(el => getComputedStyle(el).animationName)).toBe('bounce');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await cell(page, mr, mc).evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    expect(await cell(page, 4, 4).evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  });

  test('flag mode: plain taps flag (and cycle to ?) until it is switched off', async ({ page }) => {
    await load(page);
    const toggle = page.locator('#flagmode');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await cell(page, 4, 4).click();
    await expect(cell(page, 4, 4)).toHaveText('🚩');
    await expect(opened(page)).toHaveCount(0);                   // it flagged instead of opening
    await cell(page, 4, 4).click();
    await expect(cell(page, 4, 4)).toHaveText('?');
    await cell(page, 4, 4).click();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await cell(page, 4, 4).click();
    expect(await opened(page).count()).toBeGreaterThan(0);
  });

  test('touch screens get 44 px buttons and cells of at least 32 px, even on Expert', async ({ page }) => {
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    await load(page);
    if (coarse) for (const sel of ['#undo', '#redo', '#hint', '#flagmode', '#newgame-btn', '#settings-btn', '#new'])
      expect((await box(page, sel)).height, sel).toBeGreaterThanOrEqual(43.5);
    await openNewGame(page);
    await page.selectOption('#level', 'expert');
    await closeOverlay(page);
    const width = (await page.locator('#board .cell').first().boundingBox()).width;
    expect(width).toBeGreaterThanOrEqual(coarse ? 31.5 : 15.5);
  });

  test('first-time tips: shown once, used up by doing the thing, remembered, and can be shown again', async ({ page }) => {
    await load(page);
    await expect(page.locator('#tip')).toContainText('right-click a cell to flag');
    await page.click('#tip-dismiss');
    await expect(page.locator('#tip')).toBeHidden();
    await cell(page, 4, 4).click();
    await expect(page.locator('#tip')).toContainText('click a number whose flags are all placed');   // once a number is open
    await page.click('#tip-dismiss');
    await expect(page.locator('#tip')).toBeHidden();
    await page.reload();
    await expect(page.locator('#tip')).toBeHidden();             // remembered
    await openSettings(page, 'controls');
    await page.click('#reset-tips');
    await closeOverlay(page);
    await expect(page.locator('#tip')).toBeVisible();
  });

  test('a tip counts as seen once you do what it explains', async ({ page }) => {
    await load(page);
    await expect(page.locator('#tip')).toContainText('flag');
    await cell(page, 0, 0).click({ button: 'right' });
    await expect(page.locator('#tip')).toBeHidden();
  });

  test('help dialog lists the keyboard shortcuts', async ({ page }) => {
    await load(page);
    await expect(page.locator('#help')).toBeHidden();
    await page.click('#help-btn');
    await expect(page.locator('#help')).toBeVisible();
    await expect(page.locator('#shortcuts')).toContainText('Reveal / chord');
    await expect(page.locator('#shortcuts')).toContainText('Enter');
    await expect(page.locator('#shortcuts')).toContainText('Space');
    await expect(page.locator('#shortcuts')).toContainText('Hint');
    await page.click('#help-close');
    await expect(page.locator('#help')).toBeHidden();
  });

  test('accessibility: grid semantics, cell labels, live status, one tab stop, arrow keys move focus with a visible ring', async ({ page }) => {
    await load(page);
    await expect(page.locator('#board')).toHaveAttribute('role', 'grid');
    await expect(page.locator('#board [role=row]')).toHaveCount(9);
    await expect(page.locator('#board [role=gridcell]')).toHaveCount(81);
    await expect(cell(page, 0, 0)).toHaveAttribute('aria-label', 'Row 1, column 1, hidden');
    await expect(page.locator('#status')).toHaveAttribute('role', 'status');
    await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#board [tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Row 1, column 2, hidden');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Row 2, column 2, hidden');
    expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth)).toBe('3px');   // visible focus ring
    await page.keyboard.press('f');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /flagged$/);
    await page.keyboard.press('Enter');                          // a flagged cell cannot be opened
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /flagged$/);
    await page.keyboard.press('f'); await page.keyboard.press('f');
    await page.keyboard.press('Enter');                          // now it opens, and the label says so
    await expect(cell(page, 1, 1)).toHaveAttribute('aria-label', /Row 2, column 2, (empty|\d mines? nearby)/);
    await page.click('#hint');
    await expect(page.locator('#status')).toContainText('Hint: row');
    await expect(page.locator('#board [tabindex="0"]')).toHaveCount(1);
  });

  test('Settings dialog: tabs, arrow keys between tabs, remembered tab, option descriptions', async ({ page }) => {
    await load(page);
    await page.click('#settings-btn');
    await expect(page.locator('[role=tab]')).toHaveCount(4);
    await expect(page.locator('#tab-game')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-game')).toBeVisible();
    await expect(page.locator('#panel-data')).toBeHidden();
    await page.click('#tab-appearance');
    await expect(page.locator('#panel-appearance')).toBeVisible();
    await expect(page.locator('#panel-game')).toBeHidden();
    await expect(page.locator('#opt-dimNumbers-desc')).toContainText('Dims a number');
    await page.focus('#tab-appearance');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-data')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-data')).toBeVisible();
    await closeOverlay(page);
    await expect(page.locator('#settings')).toBeHidden();
    await page.reload();
    await page.click('#settings-btn');
    await expect(page.locator('#panel-data')).toBeVisible();     // reopened where the player left it
  });

  test('option descriptions sit under each mode and option and follow the choice', async ({ page }) => {
    await load(page); await openNewGame(page);
    await expect(page.locator('#opt-mode-desc')).toContainText('usual rules');
    await page.selectOption('#opt-mode', 'lives');
    await expect(page.locator('#opt-mode-desc')).toContainText('three lives');
    await page.selectOption('#opt-board', 'torus');
    await expect(page.locator('#opt-board-desc')).toContainText('no border');
    await expect(page.locator('#opt-noGuess-desc')).toContainText('logic alone');
    await expect(page.locator('#opt-powerups-desc')).toContainText('scanners');
  });

  test('game keys do nothing while a dialog is open (typing a shortcut letter in Settings must not play the game)', async ({ page }) => {
    await load(page);
    await page.click('#settings-btn');
    await page.keyboard.press('n');                              // would be "new game" on the board
    await cell(page, 4, 4).click({ force: true }).catch(() => {});
    await expect(page.locator('#status')).toContainText('Playing');
    await closeOverlay(page);
    await expect(opened(page)).toHaveCount(0);
  });

  test('partial updates: a move changes only the cells that changed, none is rebuilt', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      document.querySelectorAll('#board .cell').forEach((el, i) => { el.dataset.mark = String(i); });
      document.querySelector('#board').dataset.mark = 'board';
      window.__cells = new Set(); window.__structure = 0;
      new MutationObserver(list => list.forEach(m => {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement, c = el.closest('.cell');
        if (c) window.__cells.add(c.dataset.mark);
        else if (m.type === 'childList') window.__structure++;            // rows or cells added/removed = a rebuild
      })).observe(document.querySelector('#board'), { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await cell(page, 0, 0).click({ button: 'right' });
    await expect(cell(page, 0, 0)).toHaveText('🚩');
    const r = await page.evaluate(() => ({ cells: [...window.__cells], structure: window.__structure,
      kept: [...document.querySelectorAll('#board .cell')].filter(e => e.dataset.mark !== undefined).length, board: document.querySelector('#board').dataset.mark }));
    expect(r.kept).toBe(81);                                     // every cell element is still the original one
    expect(r.board).toBe('board');
    expect(r.structure).toBe(0);
    expect(r.cells.length).toBeLessThanOrEqual(2);               // the flagged cell (and the cursor cell, which is the same one)
    await cell(page, 4, 4).click();                              // a flood-fill touches many cells, but still no rebuild
    await expect(opened(page).first()).toBeVisible();
    const r2 = await page.evaluate(() => ({ structure: window.__structure, kept: [...document.querySelectorAll('#board .cell')].filter(e => e.dataset.mark !== undefined).length }));
    expect(r2).toEqual({ structure: 0, kept: 81 });
  });

  // ---- later features ----
  test('assists: best guess highlights one cell, flag check works once, hidden counter and puzzle modes switch them off', async ({ page }) => {
    await load(page);
    await cell(page, 4, 4).click();
    await page.click('#assists-btn'); await page.click('#bestguess');
    await expect(page.locator('#board .cell.guess')).toHaveCount(1);
    await expect(page.locator('#status')).toContainText('Best guess');
    await cell(page, 0, 0).click({ button: 'right' });
    await page.click('#assists-btn'); await page.click('#checkflags');
    await expect(page.locator('#assists-btn')).toBeEnabled();
    await page.click('#assists-btn');
    await expect(page.locator('#checkflags')).toBeDisabled();            // once per game
    await closeOverlay(page);
    await page.evaluate(() => { vm.save = () => {}; localStorage.removeItem('ms-game'); localStorage.setItem('ms-options', JSON.stringify({ mode: 'blind' })); });
    await load(page);
    await expect(page.locator('#mines')).toHaveText('???');
    await cell(page, 4, 4).click();
    await expect(page.locator('#hint')).toBeDisabled();
    await expect(page.locator('#assists-btn')).toBeDisabled();
  });

  test('timeline slider jumps through the game, checkpoints go back, coins show in the header', async ({ page }) => {
    await load(page);
    for (const c of [0, 1, 2]) await cell(page, 0, c).click({ button: 'right' });
    await expect(page.locator('#timeline')).toHaveAttribute('max', '3');
    await page.locator('#timeline').fill('1');
    await expect(page.locator('#board .cell.flag, #board .cell:has-text("🚩")')).toHaveCount(1);
    await expect(page.locator('#timelineLabel')).toContainText('Move 1 of 3');
    await page.locator('#timeline').fill('3');
    await expect(page.locator('#board .cell:has-text("🚩")')).toHaveCount(3);
    await page.click('#cp-set');
    await cell(page, 1, 0).click({ button: 'right' });
    await page.click('#cp-back');
    await expect(page.locator('#board .cell:has-text("🚩")')).toHaveCount(3);
    await expect(page.locator('#coins')).toHaveText('0');
  });

  test('shop: coins buy a theme and power-ups; power-up buttons appear when power-ups are on', async ({ page }) => {
    await page.addInitScript(() => { if (!localStorage.getItem('ms-shop')) localStorage.setItem('ms-shop', JSON.stringify({ coins: 100, themes: [], stock: {} })); localStorage.setItem('ms-options', JSON.stringify({ powerups: true })); });
    await load(page);
    await expect(page.locator('#coins')).toHaveText('100');
    for (const id of ['rowbtn', 'colbtn', 'scanner']) await expect(page.locator('#' + id)).toBeVisible();
    await openSide(page);
    await page.click('#buy-theme-ocean');
    await expect(page.locator('#buy-theme-ocean')).toHaveText('Owned');
    await expect(page.locator('#coins')).toHaveText('70');
    await closeSide(page);
    await openSettings(page, 'appearance'); // the theme list is in the header
    await closeOverlay(page);
    await page.selectOption('#opt-theme', 'ocean');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
    await cell(page, 4, 4).click();
    await page.click('#rowbtn');
    await expect(page.locator('#rowbtn')).toHaveClass(/armed/);
    await cell(page, 0, 4).click();
    await expect(page.locator('#rowbtn')).toContainText('(0)');
  });

  test('weekly challenge, a win with stars, and a ghost race of your best win', async ({ page }) => {
    await load(page);
    await openNewGame(page); await page.click('#weekly');
    await expect(page.locator('#status')).toContainText('Weekly challenge');
    await closeOverlay(page);
    const g = model();
    await page.evaluate(() => { vm.save = () => {}; localStorage.clear(); });
    await load(page);
    await cell(page, 4, 4).click();
    for (const [r, c] of hiddenSafe(g)) { if (await page.locator('#result').isVisible()) break; if (!(await cell(page, r, c).evaluate(el => el.classList.contains('open')))) await cell(page, r, c).click(); }   // a click can open neighbours too
    await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#resultStars')).toContainText('★');
    await expect(page.locator('#coins')).not.toHaveText('0');
    await expect(page.locator('#race-ghost')).toBeVisible();
    await page.click('#result-close');
    await page.click('#race-ghost');
    await expect(page.locator('#ghostbar')).toBeVisible();
  });
});
