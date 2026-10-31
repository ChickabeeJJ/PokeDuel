// Browser smoke test for PokeDuel. Requires Playwright (`npm i -D playwright`).
// Serve the repo first (e.g. `python3 -m http.server 8765`), then run:
//   node tests/e2e.cjs            (BASE_URL / SHOTS env vars override the defaults)
// It uses a fresh browser profile, so it never touches your real save.
// PokéAPI and the Firebase CDN are blocked on purpose to exercise offline/error states.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = (process.env.SHOTS || require('os').tmpdir() + '/pokeduel-shots') + '/';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.BASE_URL || 'http://localhost:8765/';
let failures = 0;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text() + ' @ ' + (m.location()?.url || '')); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.route(/pokeapi\.co|www\.gstatic\.com|googleapis\.com\/identitytoolkit/, r => r.abort());
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: OUT + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };
  const shot = n => page.screenshot({ path: OUT + n + '.png' });
  const closeModals = async () => { for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); const c = page.locator('#modal:not(.hidden) [data-close]'); if (await c.count()) await c.first().click(); else if (await page.locator('#modal:not(.hidden)').count() === 0) return; } };
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('pokeduel-save-v2')));

  await page.goto(URL);
  await step('starter screen on clean launch', () => page.waitForSelector('#screen-starter.active', { timeout: 15000 }));
  await step('9 generations show the correct 3 starters', async () => {
    const expect = { 1: [1, 4, 7], 2: [152, 155, 158], 3: [252, 255, 258], 4: [387, 390, 393], 5: [495, 498, 501], 6: [650, 653, 656], 7: [722, 725, 728], 8: [810, 813, 816], 9: [906, 909, 912] };
    if (await page.locator('.gen-tab').count() !== 9) throw new Error('tab count');
    for (const g of Object.keys(expect)) {
      await page.click(`.gen-tab[data-gen="${g}"]`);
      const nos = await page.$$eval('.st-plate small', els => els.map(e => +e.textContent.replace(/\D/g, '')));
      if (JSON.stringify(nos) !== JSON.stringify(expect[g])) throw new Error('gen ' + g + ' ' + nos);
    }
  });
  await step('keyboard: arrows pick, Q/E change generation', async () => {
    await page.click('.gen-tab[data-gen="4"]');
    await page.keyboard.press('ArrowRight');
    if (!(await page.locator('[data-pick-starter="piplup"].selected').count())) throw new Error('arrow');
    await page.keyboard.press('e');
    if (!(await page.locator('.gen-tab[data-gen="5"].active').count())) throw new Error('E');
    await page.keyboard.press('q');
    await page.click('[data-pick-starter="chimchar"]');
    await shot('01-starter');
  });
  await step('confirm adds a level-10 starter and opens Home', async () => {
    await page.fill('#starterName', 'Tester');
    await page.click('#confirmStarter');
    await page.waitForSelector('.reveal .badges', { timeout: 6000 });
    await shot('02-reveal');
    await page.click('#modal:not(.hidden) [data-close]');
    await page.waitForSelector('#screen-home.active');
    const s = await save();
    if (s.box.length !== 1 || s.box[0].level !== 10 || s.box[0].species !== 'chimchar') throw new Error('bad starter');
    if (!s.seal) throw new Error('save not sealed');
  });
  await step('how-to-play then daily check-in', async () => {
    await page.waitForSelector('#modal:not(.hidden) .howto', { timeout: 4000 });
    await page.click('#modal:not(.hidden) [data-close]');
    await page.waitForSelector('#claimCheckin', { state: 'visible', timeout: 4000 });
    await shot('03-checkin');
    // The starter can roll a mark and earn a medal, so measure the check-in itself.
    const before = (await save()).coins;
    await page.click('#claimCheckin');
    await page.waitForTimeout(400);
    const s = await save();
    if (s.checkin.streak !== 1 || s.coins - before !== 60) throw new Error('checkin ' + s.checkin.streak + ' ' + before + '->' + s.coins);
  });
  await step('home: three daily rows, team strip, shortcuts', async () => {
    await closeModals();
    if (await page.locator('.drow').count() !== 3) throw new Error('rows');
    if (await page.locator('.ts-slot').count() !== 6) throw new Error('slots');
    if (await page.locator('.hud-link').count() < 10) throw new Error('tabs');
    await shot('04-home');
  });
  await step('reload keeps progress and the seal stays valid', async () => {
    const coins = await page.textContent('#coins');
    await page.reload(); await page.waitForSelector('#screen-home.active', { timeout: 15000 });
    if (await page.textContent('#coins') !== coins) throw new Error('coins changed');
    const s = await save(); if (s.integrity.status !== 'ok') throw new Error('flagged: ' + s.integrity.reasons);
  });
  const playBattle = async label => {
    await page.waitForSelector('#screen-battle.active');
    for (let i = 0; i < 220; i++) {
      await page.waitForTimeout(250);
      if (await page.locator('#modal:not(.hidden) .result-list').count()) break;
      const swap = page.locator('#modal:not(.hidden) [data-swap]:not([disabled])');
      if (await swap.count()) { await swap.first().click(); continue; }
      const fight = page.locator('#battleControls [data-cmd="fight"]');
      if (await fight.count()) { await fight.click(); if (i < 2) await shot('05-battle-' + label); continue; }
      const dmg = page.locator('#battleControls .move-btn:not([disabled])', { hasText: 'power' });
      const mv = (await dmg.count()) ? dmg : page.locator('#battleControls .move-btn:not([disabled])');
      if (await mv.count()) { await mv.nth(Math.floor(Math.random() * await mv.count())).click(); continue; }
    }
    await page.waitForSelector('#modal:not(.hidden) .result-list', { timeout: 60000 });
    await shot('06-result-' + label);
    await page.click('#modal:not(.hidden) [data-close]');
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); const c = page.locator('#modal:not(.hidden) [data-close]'); if (await c.count()) await c.first().click(); else if (await page.locator('#screen-home.active').count()) break; }
  };
  await step('practice battle plays to completion', async () => {
    await page.click('.hud-link[data-go="practice"]');
    await page.waitForSelector('#battleControls [data-cmd="fight"]', { timeout: 20000 });
    await playBattle('practice');
    await page.waitForSelector('#screen-home.active', { timeout: 15000 });
  });
  await step('ledger stays consistent after battles', async () => {
    const s = await save();
    if (s.coins !== s.ledger.start + s.ledger.earned - s.ledger.spent) throw new Error('ledger mismatch');
    if (s.integrity.status !== 'ok') throw new Error('flagged: ' + s.integrity.reasons);
  });
  await step('editing localStorage is detected (save becomes unranked)', async () => {
    const real = await page.evaluate(() => localStorage.getItem('pokeduel-save-v2'));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pokeduel-save-v2')); s.coins = 999999; localStorage.setItem('pokeduel-save-v2', JSON.stringify(s)); });
    await page.reload(); await page.waitForSelector('#screen-home.active', { timeout: 15000 });
    const s = await save();
    if (s.integrity.status !== 'flagged') throw new Error('not flagged');
    await page.goto(URL + '#/profile'); await page.waitForSelector('.integrity'); await shot('07-unranked');
    // Restore the honest save for the rest of the run.
    await page.evaluate(r => localStorage.setItem('pokeduel-save-v2', r), real);
    await page.goto(URL); await page.waitForSelector('#screen-home.active', { timeout: 15000 });
    if ((await save()).integrity.status !== 'ok') throw new Error('restore failed');
  });
  await step('shop: featured outbreak, buy an item, open a box', async () => {
    await closeModals();
    await page.click('.hud-link[data-go="shop"]');
    await page.waitForSelector('#shopMain .feature');
    await page.click('[data-shopcat="medicine"]'); await page.click('[data-shopsel="potion"]'); await page.click('[data-qty="1"]'); await page.click('#shopDetail [data-buy]');
    await page.click('[data-shopcat="boxes"]'); await page.click('[data-shopsel="box:basic"]');
    await shot('08-shop');
    await page.click('#shopDetail [data-box="basic"]');
    await page.waitForSelector('.reveal .badges', { timeout: 6000 });
    await page.click('#modal:not(.hidden) [data-close]');
    const s = await save(); if (s.box.length !== 2 || s.inventory.potion < 5) throw new Error('purchase not applied');
  });
  await step('insufficient coins disables purchase', async () => {
    await page.click('[data-shopcat="key"]'); await page.click('[data-shopsel="shinycharm"]');
    if (!(await page.isDisabled('#shopDetail [data-buy]'))) throw new Error('affordable?');
  });
  await step('boxes: arrows, summary tabs, select from grid', async () => {
    await page.click('.hud-link[data-go="boxes"]');
    await page.waitForSelector('#summaryPanel .sum-head');
    await page.click('#boxNext'); await page.click('#boxPrev');
    await page.click('#boxGrid .cell[data-sel]');
    for (const t of ['stats', 'moves', 'marks', 'info']) await page.click(`[data-sumtab="${t}"]`);
    await shot('09-boxes');
  });
  await step('bag lists items', async () => { await page.click('.hud-link[data-go="bag"]'); await page.waitForSelector('#bagMain .item-card'); await shot('10-bag'); });
  await step('dex search and entry handle PokéAPI failure', async () => {
    await page.click('.hud-link[data-go="dex"]');
    await page.fill('#dexQuery', 'pika'); await page.waitForTimeout(200);
    await page.click('#dexResults .dex-card');
    await page.waitForFunction(() => /could not be loaded/.test(document.querySelector('#dexFlavor')?.textContent || ''), null, { timeout: 8000 });
    await page.click('#modalClose');
  });
  await step('daily easy battle can be played once', async () => {
    await page.click('.hud-link[data-go="home"]'); await closeModals();
    await page.click('[data-battle="easy"]'); await page.click('#confirmOk');
    await page.waitForSelector('#battleControls [data-cmd="fight"]', { timeout: 20000 });
    await playBattle('daily');
    await page.waitForSelector('#screen-home.active', { timeout: 15000 });
    if (await page.locator('[data-battle="easy"]').count()) throw new Error('easy still available');
  });
  const pw = 'hunter22';
  let envelopePath = OUT + 'export.pokeduel';
  await step('protected export asks for a password and writes an encrypted file', async () => {
    await page.click('.hud-trainer'); await page.waitForSelector('#trainerCard .tc-head');
    await page.click('#exportSave');
    await page.fill('#pw1', pw); await page.fill('#pw2', 'different');
    await page.click('#pwOk');
    if (!/match/.test(await page.textContent('#pwErr'))) throw new Error('mismatch not caught');
    await page.fill('#pw2', pw);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#pwOk')]);
    await dl.saveAs(envelopePath);
    const env = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    if (env.format !== 3 || env.cipher !== 'AES-256-GCM' || /chimchar/i.test(fs.readFileSync(envelopePath, 'utf8'))) throw new Error('not encrypted');
  });
  await step('import with the wrong password is refused', async () => {
    await page.setInputFiles('#importFile', envelopePath);
    await page.fill('#pw1', 'wrongpass'); await page.click('#pwOk');
    await page.waitForSelector('#modal:not(.hidden) h2:has-text("Import refused")', { timeout: 20000 });
    await page.click('#modal:not(.hidden) [data-close]');
  });
  await step('a modified encrypted file is refused', async () => {
    const env = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    const d = env.data; env.data = d.slice(0, 40) + (d[40] === 'A' ? 'B' : 'A') + d.slice(41);
    fs.writeFileSync(OUT + 'tampered.pokeduel', JSON.stringify(env));
    await page.setInputFiles('#importFile', OUT + 'tampered.pokeduel');
    await page.fill('#pw1', pw); await page.click('#pwOk');
    await page.waitForSelector('#modal:not(.hidden) h2:has-text("Import refused")', { timeout: 20000 });
    await page.click('#modal:not(.hidden) [data-close]');
  });
  await step('import with the right password restores the save', async () => {
    await page.setInputFiles('#importFile', envelopePath);
    await page.fill('#pw1', pw); await page.click('#pwOk');
    await page.waitForSelector('#confirmOk', { timeout: 20000 }); await page.click('#confirmOk');
    await page.waitForTimeout(600);
    const s = await save(); if (s.integrity.status !== 'ok' || s.box.length !== 2) throw new Error('import result');
  });
  await step('journey: Kanto is open, Route 1 starts a battle and leaving returns to Journey', async () => {
    await page.goto(URL + '#/journey'); await page.waitForSelector('#journeyBody .jrow', { timeout: 15000 }); await closeModals();
    if (await page.locator('#journeyRegions [data-jregion]:not([disabled])').count() < 1) throw new Error('no region open');
    if (await page.locator('#journeyBody .jrow').count() !== 21) throw new Error('Kanto should have 21 steps');
    await page.click('#journeyBody [data-jstep="0"]');
    await page.waitForSelector('#battleControls [data-cmd="run"]', { timeout: 30000 });
    if (!/Kanto/.test(await page.textContent('#battleLabel'))) throw new Error('label');
    await page.click('#battleControls [data-cmd="run"]'); await page.click('#confirmOk');
    await page.waitForSelector('#modal:not(.hidden) [data-close]'); await page.click('#modal:not(.hidden) [data-close]');
    await page.waitForSelector('#screen-journey.active', { timeout: 10000 });
  });
  await step('medals', async () => { await page.goto(URL + '#/medals'); await page.waitForSelector('.medal', { timeout: 15000 }); });
  await step('no horizontal scroll at 390px on any screen', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const s of ['home', 'journey', 'boxes', 'shop', 'bag', 'dex', 'leaderboard', 'profile', 'medals']) {
      await page.goto(URL + '#/' + s); await page.waitForTimeout(900); await closeModals();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: OUT + 'm-' + s + '.png' });
      if (over > 2) throw new Error(s + ' overflows by ' + over);
    }
  });
  const unexpected = [...new Set(errors)].filter(e => !/pokeapi\.co|www\.gstatic\.com/.test(e));
  console.log('Unexpected errors:', unexpected.length ? '\n' + unexpected.join('\n') : 'none');
  console.log('Screenshots in', OUT, '·', failures ? failures + ' FAILED' : 'all passed');
  await browser.close();
  process.exit(failures || unexpected.length ? 1 : 0);
})();
