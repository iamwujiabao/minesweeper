// Coins earned from wins, and what they buy: power-ups for the next games and extra themes.
(function (root) {
  const FREE_THEMES = ['auto', 'light', 'dark', 'colorblind'];
  const ITEMS = [
    { id: 'theme-ocean', kind: 'theme', value: 'ocean', name: 'Ocean theme', price: 30 },
    { id: 'theme-sunset', kind: 'theme', value: 'sunset', name: 'Sunset theme', price: 30 },
    { id: 'pu-scanner', kind: 'powerup', value: 'scanner', amount: 3, name: '3 more scanners', price: 10 },
    { id: 'pu-shield', kind: 'powerup', value: 'shield', amount: 1, name: 'An extra shield', price: 15 },
    { id: 'pu-row', kind: 'powerup', value: 'row', amount: 1, name: 'An extra reveal-a-row', price: 12 },
    { id: 'pu-col', kind: 'powerup', value: 'col', amount: 1, name: 'An extra reveal-a-column', price: 12 },
    { id: 'pu-life', kind: 'powerup', value: 'life', amount: 1, name: 'An extra life power-up', price: 20 },
    { id: 'pu-freeze', kind: 'powerup', value: 'freeze', amount: 1, name: 'An extra time freeze', price: 15 },
  ];
  const STOCK_KEYS = ['scanner', 'shield', 'row', 'col', 'life', 'freeze'];

  class Shop {
    constructor(storage) {
      this.storage = storage;
      this.coins = 0; this.themes = []; this.stock = Object.fromEntries(STOCK_KEYS.map(k => [k, 0]));
      try {
        const d = JSON.parse(storage.getItem('ms-shop'));
        if (Number.isInteger(d.coins) && d.coins >= 0) this.coins = d.coins;
        if (Array.isArray(d.themes)) this.themes = d.themes.filter(t => ITEMS.some(i => i.kind === 'theme' && i.value === t));
        for (const k of STOCK_KEYS) if (Number.isInteger(d.stock[k]) && d.stock[k] >= 0 && d.stock[k] <= 999) this.stock[k] = d.stock[k];
      } catch (e) {}
    }
    save() { this.storage.setItem('ms-shop', JSON.stringify({ coins: this.coins, themes: this.themes, stock: this.stock })); }

    // Coins for a win: 5, plus 5 per star, plus a bonus for harder levels, the daily/weekly challenge and a completed mission.
    static coinsFor({ stars = 0, level = 'beginner', challenge = false, mission = false }) {
      return 5 + 5 * stars + ({ intermediate: 5, expert: 10 }[level] || 0) + (challenge ? 10 : 0) + (mission ? 10 : 0);
    }
    earn(n) { if (Number.isInteger(n) && n > 0) { this.coins += n; this.save(); } }

    ownsTheme(theme) { return FREE_THEMES.includes(theme) || this.themes.includes(theme); }
    // Buy one item. Returns {ok: true} or {ok: false, error}. Nothing changes on failure.
    buy(id) {
      const item = ITEMS.find(i => i.id === id);
      if (!item) return { ok: false, error: 'No such item' };
      if (item.kind === 'theme' && this.themes.includes(item.value)) return { ok: false, error: 'You already own it' };
      if (this.coins < item.price) return { ok: false, error: `Not enough coins (needs ${item.price})` };
      this.coins -= item.price;
      if (item.kind === 'theme') this.themes.push(item.value); else this.stock[item.value] += item.amount;
      this.save();
      return { ok: true };
    }
    // Hand the bought power-ups to a new game. allow: which kinds the game can use, e.g. {life: false}. Used stock is gone.
    takeStock(allow = {}) {
      const bonus = {};
      for (const k of STOCK_KEYS) if (allow[k] !== false && this.stock[k] > 0) { bonus[k] = this.stock[k]; this.stock[k] = 0; }
      if (Object.keys(bonus).length) this.save();
      return bonus;
    }
    view() {
      return ITEMS.map(i => ({ id: i.id, name: i.name, price: i.price, kind: i.kind, owned: i.kind === 'theme' ? this.themes.includes(i.value) : false,
                               stock: i.kind === 'powerup' ? this.stock[i.value] : 0, affordable: this.coins >= i.price }));
    }
  }
  Shop.ITEMS = ITEMS; Shop.FREE_THEMES = FREE_THEMES;

  if (typeof module !== 'undefined') module.exports = Shop; else root.Shop = Shop;
})(this);
