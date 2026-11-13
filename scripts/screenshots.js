// Takes the screenshots used in REPORT.md (docs/screenshots/*.png). Run with: node scripts/screenshots.js
// Needs Playwright (npm install). Set PW_CHANNEL=chrome to use your own Chrome. Boards are seeded, so the shots are repeatable.
const { chromium, devices } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const { Game } = require('../src/game.js');
const { mulberry32 } = require('../src/rng.js');

const out = path.join(__dirname, '..', 'docs', 'screenshots');
const PORT = 4174, base = `http://127.0.0.1:${PORT}/index.html?seed=11`;
const desktop = { viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 };

// The mines of the board the page will show after a first click at (4, 4), found with the same seed.
function minesOf(opts = {}) {
  const g = new Game(9, 9, 10, mulberry32(11), opts);
  g.reveal(4, 4);
  const cells = g.cells.flatMap((row, r) => row.map((x, c) => ({ r, c, x })));
  return { mines: cells.filter(m => m.x.mine && !m.x.revealed), safe: cells.filter(m => !m.x.mine && !m.x.revealed) };
}

// Cells to click (after the first click at 4,4) until Hint finds nothing certain, not even by the exact count: there the hint shows chances.
function stuckClicks(seed) {
  const g = new Game(9, 9, 10, mulberry32(seed)); g.reveal(4, 4);
  const clicks = [];
  for (;;) {
    const h = g.status === 'playing' ? g.hint() : null;
    if (!h) return { clicks, stuck: g.status === 'playing' };
    clicks.push([h.r, h.c]); g.reveal(h.r, h.c);
  }
}
const stuckSeed = () => { for (let seed = 1; ; seed++) if (stuckClicks(seed).stuck) return seed; };

const STUCK = stuckSeed();

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.js')], { env: { ...process.env, PORT: String(PORT) } });
  await new Promise(resolve => setTimeout(resolve, 800));
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

  async function shot(name, ctxOptions, options, steps, seed = 11) {
    const ctx = await browser.newContext(ctxOptions);
    const page = await ctx.newPage();
    if (options) await page.addInitScript(o => localStorage.setItem('ms-options', JSON.stringify(o)), options);
    await page.goto(base.replace('seed=11', 'seed=' + seed));
    const cell = (r, c) => page.locator('#board .cell').nth(r * 9 + c);
    const dismissTip = async () => { if (await page.locator('#tip').isVisible()) await page.click('#tip-dismiss'); };
    await steps({ page, cell, dismissTip });
    await page.waitForTimeout(500);                           // let the animations finish
    await page.screenshot({ path: path.join(out, name + '.png') });
    await ctx.close();
    console.log('saved', name);
  }

  await shot('01-new-game', desktop, null, async ({ dismissTip }) => { await dismissTip(); });

  await shot('02-first-click-and-hint', desktop, null, async ({ page, cell, dismissTip }) => {
    await dismissTip(); await cell(4, 4).click(); await dismissTip(); await page.click('#hint');
  });

  await shot('03-lives-mode', desktop, { mode: 'lives' }, async ({ cell, dismissTip }) => {
    const { mines } = minesOf({ lives: 3 });
    await dismissTip(); await cell(4, 4).click(); await dismissTip(); await cell(mines[0].r, mines[0].c).click();
  });

  await shot('04-hex-board', desktop, { board: 'hex' }, async ({ cell, dismissTip }) => {
    await dismissTip(); await cell(4, 4).click(); await dismissTip();
  });

  await shot('05-loss', desktop, null, async ({ cell, dismissTip }) => {
    const { mines, safe } = minesOf();
    await dismissTip(); await cell(4, 4).click(); await dismissTip();
    await cell(mines[0].r, mines[0].c).click({ button: 'right' });   // a right flag
    await cell(safe[0].r, safe[0].c).click({ button: 'right' });     // a wrong flag (it gets a cross)
    await cell(mines[1].r, mines[1].c).click();
  });

  await shot('06-replay', desktop, null, async ({ page, cell, dismissTip }) => {
    const { mines } = minesOf();
    await dismissTip(); await cell(4, 4).click(); await dismissTip(); await cell(mines[0].r, mines[0].c).click();
    await page.click('#result-close'); await page.click('#replay'); await page.click('#replay-next');
  });

  await shot('07-dark-theme', { ...desktop, colorScheme: 'dark' }, null, async ({ page, cell, dismissTip }) => {
    await dismissTip(); await cell(4, 4).click(); await dismissTip();
    await cell(0, 0).click({ button: 'right' });
  });

  await shot('08-phone', { ...devices['Pixel 7'], deviceScaleFactor: 1 }, null, async ({ cell, dismissTip }) => {
    await dismissTip(); await cell(4, 4).click(); await dismissTip();
  });

  await shot('09-probability-hint', desktop, null, async ({ page, cell, dismissTip }) => {
    await dismissTip(); await cell(4, 4).click(); await dismissTip();
    for (const [r, c] of stuckClicks(STUCK).clicks) if (!(await cell(r, c).evaluate(el => el.classList.contains('open')))) await cell(r, c).click();
    await page.click('#hint');
  }, STUCK);

  await shot('10-undo-timeline', desktop, null, async ({ page, cell, dismissTip }) => {
    await dismissTip(); await cell(4, 4).click(); await dismissTip();
    for (const c of [0, 1, 2, 3]) await cell(0, c).click({ button: 'right' });
    await page.locator('#timeline').fill('3');
  });

  await shot('11-versus-computer', desktop, { mode: 'ai' }, async ({ page, cell, dismissTip }) => {
    await dismissTip(); await cell(4, 4).click(); await dismissTip();
    await page.waitForTimeout(1500);                           // the computer answers on the next clock tick
  });

  const shopCtx = { ...desktop, viewport: { width: 1100, height: 1100 } };
  await shot('12-shop', shopCtx, null, async ({ page, dismissTip }) => {
    await page.evaluate(() => { vm.shop.coins = 60; vm.shop.stock.scanner = 3; vm.shop.save(); vm.buy('pu-row'); });
    await dismissTip(); await page.locator('#buy-theme-ocean').scrollIntoViewIfNeeded();
  });

  await browser.close();
  server.kill();
})();
