// Checks the colours in style.css: text contrast (WCAG ratios) in every theme, and that "Auto" in dark mode matches Dark.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const vars = text => Object.fromEntries([...text.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim().replace(/\s+/g, ' '), vars: vars(m[2]) }));
const find = selector => Object.assign({}, ...blocks.filter(b => b.selector === selector).map(b => b.vars));

const base = find(':root');
const themes = {
  light: base,
  dark: { ...base, ...find('[data-theme="dark"]') },
  colorblind: { ...base, ...find('[data-theme="colorblind"]') },
  ocean: { ...base, ...find('[data-theme="ocean"]') },
  sunset: { ...base, ...find('[data-theme="sunset"]') },
  'auto (dark device)': { ...base, ...find('[data-theme="auto"]') },
};

const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every colour the contrast checks use is a plain #rrggbb value', () => {
  for (const [name, t] of Object.entries(themes))
    for (const k of ['--bg', '--card', '--panel', '--fg', '--muted', '--accent', '--accent-fg', '--btn', '--cell', '--cell-open', '--hint', '--cursor', '--focus', '--lcd-bg', '--lcd-fg', '--n1', '--n8'])
      assert.match(t[k] || '', /^#[0-9a-f]{6}$/i, `${name} ${k}`);
});

test('numbers are readable on open cells in every theme (WCAG AA, 4.5:1)', () => {
  for (const [name, t] of Object.entries(themes))
    for (let n = 1; n <= 8; n++) assert.ok(ratio(t['--n' + n], t['--cell-open']) >= 4.5, `${name}: number ${n} is ${ratio(t['--n' + n], t['--cell-open']).toFixed(2)}:1`);
});

test('text, buttons, counters and the muted text meet contrast in every theme', () => {
  for (const [name, t] of Object.entries(themes)) {
    for (const bg of ['--bg', '--card', '--panel', '--btn']) assert.ok(ratio(t['--fg'], t[bg]) >= 7, `${name}: text on ${bg} ${ratio(t['--fg'], t[bg]).toFixed(2)}`);
    for (const bg of ['--card', '--panel']) assert.ok(ratio(t['--muted'], t[bg]) >= 4.5, `${name}: muted text on ${bg} ${ratio(t['--muted'], t[bg]).toFixed(2)}`);
    assert.ok(ratio(t['--accent-fg'], t['--accent']) >= 4.5, `${name}: text on accent ${ratio(t['--accent-fg'], t['--accent']).toFixed(2)}`);
    assert.ok(ratio(t['--lcd-fg'], t['--lcd-bg']) >= 4.5, `${name}: counter digits`);
    assert.ok(ratio(t['--accent'], t['--card']) >= 3, `${name}: links/accent on card ${ratio(t['--accent'], t['--card']).toFixed(2)}`);
  }
});

test('focus ring, cursor and hint outlines stand out against raised and open cells (3:1)', () => {
  for (const [name, t] of Object.entries(themes))
    for (const k of ['--focus', '--cursor', '--hint'])
      for (const cell of ['--cell', '--cell-open']) assert.ok(ratio(t[k], t[cell]) >= 3, `${name}: ${k} on ${cell} ${ratio(t[k], t[cell]).toFixed(2)}`);
});

test('"Auto" on a dark device uses exactly the Dark colours', () => {
  const dark = find('[data-theme="dark"]'), auto = find('[data-theme="auto"]');
  const { 'color-scheme': _a, ...d } = dark; void _a;
  for (const k of Object.keys(d)) assert.strictEqual(auto[k], dark[k], k);
  assert.deepStrictEqual(Object.keys(auto).sort(), Object.keys(dark).sort());
});
