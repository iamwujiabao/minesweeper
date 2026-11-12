// The same user-level checks run against all three views (plain JS, Vue, React): they share ids and behaviour.
// Boards are reproducible: pages get ?seed=11, and the test builds the same board with the Game model
// (same seed + same first click = same mines), so it knows where mines and numbers are.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { Game } = require('../src/game.js');
const { mulberry32 } = require('../src/rng.js');

const PAGES = ['index.html', 'vue.html', 'react.html'];
const SEED = 11;

// The model's version of the board after the first click at (r, c). Each test gets a fresh one and keeps it in step with the page.
function model(r = 4, c = 4) { const g = new Game(9, 9, 10, mulberry32(SEED)); g.reveal(r, c); return g; }
const openCount = g => g.cells.flat().filter(c => c.revealed).length;
const hiddenSafe = g => g.cells.flatMap((row, r) => row.map((cell, c) => [r, c, cell])).filter(([, , cell]) => !cell.mine && !cell.revealed);
const firstMine = g => { const i = g.cells.flat().findIndex(c => c.mine); return [Math.floor(i / 9), i % 9]; };

for (const file of PAGES) {
  test.describe(file, () => {
    const cell = (page, r, c, cols = 9) => page.locator('#board button').nth(r * cols + c);
    const opened = page => page.locator('#board button.open');
    const panels = async page => { for (const s of await page.locator('summary').all()) await s.click(); };
    const keyRow = (page, label) => page.locator('.keyrow', { hasText: label + ':' });
    async function load(page, query = `seed=${SEED}`) {
      await page.goto(`/${file}?${query}`);
      await expect(page.locator('#board button').first()).toBeVisible();
    }
    async function saveDownload(page, buttonId) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click(buttonId)]);
      return dl;
    }

    test('starts a beginner game', async ({ page }) => {
      await load(page);
      await expect(page.locator('#board button')).toHaveCount(81);
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
      await expect(page.locator('#board button', { hasText: '💣' })).toHaveCount(10);
      await cell(page, 4, 4).click({ force: true }); // further clicks are ignored
      await expect(page.locator('#status')).toContainText('Boom');
      await page.click('#undo');
      await expect(page.locator('#status')).toContainText('Playing');
      await expect(page.locator('#board button', { hasText: '💣' })).toHaveCount(0);
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
      await panels(page);
      await keyRow(page, 'Flag').getByRole('button', { name: '+ add key' }).click();
      await page.keyboard.press('c'); // already used by Chord only
      await expect(page.locator('#keymsg')).toContainText('already used');
      await page.keyboard.press('x');
      await expect(keyRow(page, 'Flag')).toContainText('x ✕');
      await page.keyboard.press('x'); // the new key flags the cursor cell
      await expect(cell(page, 0, 0)).toHaveText('🚩');
      await page.reload(); await panels(page);
      await expect(keyRow(page, 'Flag')).toContainText('x ✕');
      await keyRow(page, 'Flag').getByRole('button', { name: /^x/ }).click();
      await expect(keyRow(page, 'Flag').getByRole('button', { name: /^f/ })).toBeDisabled(); // only key left
      await page.click('#resetkeys');
      await expect(keyRow(page, 'Flag')).not.toContainText('x');
    });

    test('difficulty and custom size are saved', async ({ page }) => {
      await load(page);
      await page.selectOption('#level', 'expert');
      await expect(page.locator('#board button')).toHaveCount(480);
      await expect(page.locator('#mines')).toHaveText('99');
      await page.reload();
      await expect(page.locator('#level')).toHaveValue('expert');
      await expect(page.locator('#board button')).toHaveCount(480);
      await page.selectOption('#level', 'custom');
      await page.fill('#rows', '6'); await page.fill('#cols', '7'); await page.fill('#minesIn', '5');
      await page.click('#new');
      await expect(page.locator('#board button')).toHaveCount(42);
      await expect(page.locator('#mines')).toHaveText('5');
      await page.reload();
      await expect(page.locator('#board button')).toHaveCount(42);
    });

    test('timer runs after the first move', async ({ page }) => {
      await load(page);
      await expect(page.locator('#time')).toHaveText('0');
      await cell(page, 4, 4).click();
      await expect.poll(async () => Number(await page.locator('#time').textContent()), { timeout: 6000 }).toBeGreaterThanOrEqual(2);
    });

    test('sound mute and volume are saved', async ({ page }) => {
      await load(page);
      await expect(page.locator('#sound')).toBeChecked();
      await page.uncheck('#sound');
      await page.locator('#volume').fill('0.9');
      await page.reload();
      await expect(page.locator('#sound')).not.toBeChecked();
      await expect(page.locator('#volume')).toHaveValue('0.9');
    });

    test('settings download and upload', async ({ page }, info) => {
      await load(page); await panels(page);
      const dl = await saveDownload(page, '#export');
      expect(dl.suggestedFilename()).toBe('minesweeper-settings.json');
      const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      expect(saved).toMatchObject({ version: 1, type: 'settings', level: 'beginner', muted: false });

      await page.setInputFiles('#settingsFile', { name: 's.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"level":"expert","volume":0.3}') });
      await expect(page.locator('#settingsMsg')).toContainText('Imported');
      await expect(page.locator('#board button')).toHaveCount(480);
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
      await panels(page);
      const dl = await saveDownload(page, '#exportGame');
      expect(dl.suggestedFilename()).toBe('minesweeper-game.json');
      const file = await dl.path();
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ version: 1, type: 'game', level: 'beginner' });

      await page.click('#new');
      await expect(opened(page)).toHaveCount(0);
      await page.setInputFiles('#settingsFile', file);
      await expect(page.locator('#settingsMsg')).toContainText('Imported');
      await expect(opened(page)).toHaveCount(openCount(g));
      await expect(cell(page, fr, fc)).toHaveText('🚩');
      await page.click('#undo'); await page.click('#undo');
      await expect(opened(page)).toHaveCount(0); // undo history came with the file
    });

    test('a tampered game file is rejected and the board is left alone', async ({ page }) => {
      const g = model();
      await load(page);
      await cell(page, 4, 4).click();
      await panels(page);
      const dl = await saveDownload(page, '#exportGame');
      const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      data.game.cells = data.game.cells.slice(1); // wrong length
      await page.setInputFiles('#settingsFile', { name: 'bad-game.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await expect(page.locator('#settingsMsg')).toContainText('Not a valid saved game');
      await expect(opened(page)).toHaveCount(openCount(g));
    });
  });
}
