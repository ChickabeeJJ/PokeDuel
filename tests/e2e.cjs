// Browser smoke test for PokeDuel. Requires Playwright (`npm i -D playwright`).
// Serve the repo first (e.g. `python3 -m http.server 8765`), then run:
//   node tests/e2e.cjs            (BASE_URL / SHOTS env vars override the defaults)
// It uses a fresh browser profile, so it never touches your real save.
// PokéAPI and the Firebase CDN are blocked on purpose to exercise offline/error states.
const { chromium } = require('playwright');
const OUT = (process.env.SHOTS || require('os').tmpdir() + '/pokeduel-shots') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = process.env.BASE_URL || 'http://localhost:8765/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text() + ' @ ' + (m.location()?.url || '')); });
  page.on('requestfailed', r => { if (!/pokeapi|gstatic|googleapis/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // Simulate unreachable third parties quickly instead of waiting for timeouts.
  await page.route(/pokeapi\.co|www\.gstatic\.com|googleapis\.com\/identitytoolkit/, r => r.abort());
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: OUT + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };
  const shot = n => page.screenshot({ path: OUT + n + '.png' });
  await page.goto(URL);
  await step('starter screen on clean launch', async () => { await page.waitForSelector('#screen-starter.active', { timeout: 15000 }); });
  await step('9 generation tabs', async () => { const n = await page.locator('.gen-tab').count(); if (n !== 9) throw new Error('tabs ' + n); });
  await step('each gen shows correct 3 starters', async () => {
    const expect = { 1: [1, 4, 7], 2: [152, 155, 158], 3: [252, 255, 258], 4: [387, 390, 393], 5: [495, 498, 501], 6: [650, 653, 656], 7: [722, 725, 728], 8: [810, 813, 816], 9: [906, 909, 912] };
    for (const g of Object.keys(expect)) {
      await page.click(`.gen-tab[data-gen="${g}"]`);
      const nos = await page.$$eval('.starter-card .no', els => els.map(e => +e.textContent.replace(/\D/g, '')));
      if (JSON.stringify(nos) !== JSON.stringify(expect[g])) throw new Error('gen ' + g + ' ' + nos);
    }
  });
  await step('confirm disabled until selection', async () => { if (!(await page.isDisabled('#confirmStarter'))) throw new Error('enabled'); });
  await step('select, switch gen, come back, confirm', async () => {
    await page.click('.gen-tab[data-gen="4"]'); await page.click('[data-pick-starter="chimchar"]');
    await page.click('.gen-tab[data-gen="1"]'); await page.click('.gen-tab[data-gen="4"]');
    if (!(await page.locator('[data-pick-starter="chimchar"].selected').count())) throw new Error('selection lost');
    await shot('01-starter');
    await page.fill('#starterName', 'Tester');
    await page.click('#confirmStarter');
    await page.waitForSelector('.reveal .stage img', { timeout: 5000 });
    await page.waitForTimeout(400); await shot('02-starter-reveal');
    await page.click('#modalContent [data-close]');
    await page.waitForSelector('#screen-home.active');
  });
  await step('home renders party, daily, missions, outbreak', async () => {
    await page.waitForTimeout(800);
    const c = await page.locator('#homeParty .party-row[data-open-mon]').count(); if (c !== 1) throw new Error('party ' + c);
    if (await page.locator('.daily-card').count() !== 3) throw new Error('daily cards');
    if (await page.locator('#missionList .mission').count() < 3) throw new Error('missions');
    await shot('03-home');
  });
  await step('check-in claim', async () => { await page.click('#claimCheckin'); await page.waitForTimeout(300); if (await page.locator('#claimCheckin').count()) throw new Error('still claimable'); });
  await step('reload keeps starter and coins', async () => {
    const coins = await page.textContent('#coins');
    await page.reload(); await page.waitForSelector('#screen-home.active', { timeout: 15000 });
    if (await page.textContent('#coins') !== coins) throw new Error('coins changed');
    if (await page.locator('#homeParty .party-row[data-open-mon]').count() !== 1) throw new Error('party lost');
  });
  const playBattle = async label => {
    await page.waitForSelector('#screen-battle.active');
    for (let i = 0; i < 200; i++) {
      await page.waitForTimeout(250);
      if (await page.locator('#modal:not(.hidden) .result-list').count()) break;
      if (await page.locator('#modal:not(.hidden) [data-swap]:not([disabled])').count()) { await page.locator('#modal:not(.hidden) [data-swap]:not([disabled])').first().click(); continue; }
      if (await page.locator('#modal:not(.hidden) .reveal').count()) { await page.waitForTimeout(2500); const c = page.locator('#modal:not(.hidden) [data-close]'); if (await c.count()) await c.first().click(); continue; }
      const fight = page.locator('#battleControls [data-cmd="fight"]');
      if (await fight.count()) { await fight.click(); if (i === 0) await shot('05-battle-' + label + '-moves'); continue; }
      const dmg = page.locator('#battleControls .move-btn:not([disabled])', { hasText: 'BP' });
      const mv = (await dmg.count()) ? dmg : page.locator('#battleControls .move-btn:not([disabled])');
      if (await mv.count()) { await mv.nth(Math.floor(Math.random() * await mv.count())).click(); continue; }
    }
    await page.waitForSelector('#modal:not(.hidden) .result-list', { timeout: 60000 });
    await shot('06-result-' + label);
    await page.click('#modal:not(.hidden) [data-close]');
    for (let i = 0; i < 10; i++) { await page.waitForTimeout(400); const c = page.locator('#modal:not(.hidden) [data-close]'); if (await c.count()) await c.first().click(); else if (await page.locator('#screen-home.active').count()) break; else if (await page.locator('#modal:not(.hidden) .reveal h2').count()) await page.waitForTimeout(2000); }
  };
  await step('practice battle plays to completion', async () => {
    await page.click('[data-go="practice"]');
    await page.waitForSelector('#battleControls [data-cmd="fight"]', { timeout: 20000 });
    await page.waitForTimeout(800); await shot('04-battle');
    await playBattle('practice');
    await page.waitForSelector('#screen-home.active', { timeout: 15000 });
  });
  await step('shop: buy items and open a box', async () => {
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pokeduel-save-v2')); s.coins = 5000; localStorage.setItem('pokeduel-save-v2', JSON.stringify(s)); });
    await page.reload(); await page.waitForSelector('#screen-home.active', { timeout: 15000 });
    await page.click('.hud-link[data-go="shop"]');
    await page.waitForSelector('#screen-shop.active');
    await page.click('[data-shopsel="box:basic"]');
    await shot('07-shop-boxes');
    await page.click('#shopDetail [data-box="basic"]');
    await page.waitForSelector('.reveal .badges', { timeout: 5000 }); await shot('08-box-reveal');
    await page.click('#modal:not(.hidden) [data-close]');
    await page.click('[data-shopcat="training"]'); await page.click('[data-shopsel="expcandym"]'); await page.click('[data-qty="1"]'); await page.click('#shopDetail [data-buy]');
    await page.click('[data-shopcat="held"]'); await page.click('[data-shopsel="leftovers"]'); await page.click('#shopDetail [data-buy]');
    await page.click('[data-shopcat="medicine"]'); await shot('09-shop-items');
  });
  await step('insufficient coins blocks purchase', async () => {
    await page.click('[data-shopcat="key"]'); await page.click('[data-shopsel="shinycharm"]');
    if (!(await page.isDisabled('#shopDetail [data-buy]'))) throw new Error('shiny charm affordable?');
  });
  await step('boxes summary tabs and give item / use candy', async () => {
    await page.click('.hud-link[data-go="boxes"]');
    await page.waitForSelector('#summaryPanel .sum-head');
    await shot('10-boxes-info');
    await page.click('[data-sumtab="stats"]'); await shot('11-boxes-stats');
    await page.click('[data-sumtab="moves"]');
    await page.click('[data-act="item"]'); await page.click('#modalContent [data-give="leftovers"]');
    await page.click('[data-act="use"]'); await page.click('#modalContent [data-useon="expcandym"]');
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); const m = page.locator('#modal:not(.hidden) [data-close]'); if (await m.count()) { await shot('10b-evolved'); await m.first().click(); break; } }
    const name = await page.textContent('#summaryPanel .sum-head'); console.log('     summary now:', name.trim().replace(/\s+/g, ' '));
  });
  await step('bag screen lists items', async () => { await page.click('.hud-link[data-go="bag"]'); await page.waitForSelector('#bagList .bag-row'); await shot('12-bag'); });
  await step('dex search and entry handles PokéAPI failure', async () => {
    await page.click('.hud-link[data-go="dex"]');
    await page.fill('#dexQuery', 'pika'); await page.waitForTimeout(200);
    await page.click('#dexResults .dex-card');
    await page.waitForFunction(() => /could not be loaded/.test(document.querySelector('#dexFlavor')?.textContent || ''), null, { timeout: 8000 });
    await shot('13-dex-entry');
    await page.click('#modalClose');
    await page.fill('#dexQuery', ''); await page.waitForTimeout(200); await shot('13b-dex');
  });
  await step('daily easy battle once per day', async () => {
    await page.click('.hud-link[data-go="home"]');
    await page.click('[data-battle="easy"]');
    await page.click('#confirmOk');
    await page.waitForSelector('#battleControls [data-cmd="fight"]', { timeout: 20000 });
    await playBattle('daily');
    await page.waitForSelector('#screen-home.active', { timeout: 15000 });
    if (await page.locator('[data-battle="easy"]').count()) throw new Error('easy still available');
  });
  await step('leaderboard shows offline state', async () => { await page.click('.hud-link[data-go="leaderboard"]'); await page.waitForTimeout(500); await shot('14-ranks'); });
  await step('trainer card + export', async () => {
    await page.click('.hud-trainer'); await page.waitForSelector('#trainerCard .tc-head'); await shot('15-profile');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportSave')]);
    const path = OUT + 'export.json'; await dl.saveAs(path);
    const j = JSON.parse(require('fs').readFileSync(path, 'utf8')); if (j.app !== 'PokeDuel' || !j.save.box.length) throw new Error('bad export');
  });
  await step('import round trip', async () => {
    await page.setInputFiles('#importFile', OUT + 'export.json');
    await page.waitForSelector('#confirmOk'); await page.click('#confirmOk');
    await page.waitForTimeout(500);
  });
  await step('medals', async () => { await page.goto(URL + '#/medals'); await page.waitForSelector('.medal', { timeout: 15000 }); await shot('16-medals'); });
  await step('mobile layout has no horizontal scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const s of ['home', 'boxes', 'shop', 'dex', 'profile']) {
      await page.goto(URL + '#/' + s); await page.waitForTimeout(900);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: OUT + 'm-' + s + '.png', fullPage: false });
      if (over > 2) throw new Error(s + ' overflows by ' + over);
    }
  });
  const unexpected = [...new Set(errors)].filter(e => !/pokeapi\.co|www\.gstatic\.com/.test(e));
  console.log('Unexpected errors:', unexpected.length ? '\n' + unexpected.join('\n') : 'none');
  console.log('Screenshots in', OUT);
  await browser.close();
})();
