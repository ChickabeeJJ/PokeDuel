import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../js/engine.js';
import * as G from '../js/game.js';

const json = f => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const moves = json('moves.json'), dex = json('pokedex.json'), learnsets = json('learnsets.json');
E.setData({ moves, dex, abilities: json('abilities.json') });
G.setGameData({ dex, moves, learnsets });
G.registerEvolutionItems();

test('experience curves match the official level-100 totals', () => {
  assert.equal(G.expForLevel(1, 100), 1250000);
  assert.equal(G.expForLevel(2, 100), 1000000);
  assert.equal(G.expForLevel(3, 100), 800000);
  assert.equal(G.expForLevel(4, 100), 1059860);
  assert.equal(G.expForLevel(5, 100), 600000);
  assert.equal(G.expForLevel(6, 100), 1640000);
});

test('generated Pokémon have valid IVs, nature, ability, gender and moves', () => {
  const rng = E.makeRng(42);
  for (let i = 0; i < 300; i++) {
    const sp = rng.pick(Object.keys(dex));
    const p = G.generatePokemon(sp, 1 + rng.int(100), { rng });
    for (const k of E.STATS) assert.ok(p.ivs[k] >= 0 && p.ivs[k] <= 31);
    assert.ok(E.NATURES[p.nature]);
    assert.ok(Object.values(dex[sp].ab).map(E.toId).includes(p.ability));
    assert.ok(p.moves.length >= 1 && p.moves.length <= 4 && p.moves.every(m => moves[m]));
    if (dex[sp].g === 'N') assert.equal(p.gender, 'N');
  }
  const legend = G.generatePokemon('mewtwo', 50, { rng });
  assert.ok(E.STATS.filter(k => legend.ivs[k] === 31).length >= 3);
});

test('EV caps: 252 per stat, 510 total', () => {
  const p = G.generatePokemon('pikachu', 20, { rng: E.makeRng(1) });
  G.addEvs(p, { atk: 300 });
  assert.equal(p.evs.atk, 252);
  G.addEvs(p, { spe: 252, hp: 100 });
  assert.equal(E.STATS.reduce((a, k) => a + p.evs[k], 0), 510);
});

test('evolution rules: level, stone, trade with Linking Cord, friendship', () => {
  const rng = E.makeRng(7);
  const charmander = G.generatePokemon('charmander', 15, { rng });
  assert.equal(G.evolutionOptions(charmander)[0].ok, false);
  charmander.level = 16;
  assert.equal(G.evolutionOptions(charmander)[0].ok, true);
  const pikachu = G.generatePokemon('pikachu', 20, { rng });
  assert.equal(G.evolutionOptions(pikachu, { inventory: {} })[0].ok, false);
  assert.equal(G.evolutionOptions(pikachu, { inventory: { thunderstone: 1 } })[0].ok, true);
  const onix = G.generatePokemon('onix', 30, { rng });
  assert.equal(G.evolutionOptions(onix, { inventory: { linkingcord: 1 } })[0].ok, false);
  onix.item = 'metalcoat';
  assert.equal(G.evolutionOptions(onix, { inventory: { linkingcord: 1 } })[0].ok, true);
  G.evolve(onix, 'steelix');
  assert.equal(onix.species, 'steelix');
  const eevee = G.generatePokemon('eevee', 30, { rng });
  assert.equal(G.evolutionOptions(eevee, { inventory: {} }).length, 8);
});

test('v1 prototype saves migrate without losing progress', () => {
  const v1 = { version: 1, coins: 420, starterChosen: true, starterId: 4, selectedId: 'b', party: [{ uid: 'a', pokemonId: 1, name: 'bulbasaur', level: 12, xp: 30 }, { uid: 'b', pokemonId: 4, name: 'charmander', level: 14, xp: 0 }], inventory: { potion: 2, candy: 1, ball: 3 }, dailyDate: '2026-10-30', daily: { easy: { result: 'win' }, medium: null, hard: null }, wins: 5, battles: 7, practiceCount: 2, ownedDex: [1, 4], settings: { animations: true, reducedEffects: false } };
  const s = G.migrateSave(v1);
  assert.equal(s.version, 2);
  assert.equal(s.coins, 420);
  assert.equal(s.box.length, 2);
  assert.equal(s.party[0], 'b');
  assert.equal(s.box.find(p => p.uid === 'b').level, 14);
  assert.equal(s.inventory.potion, 2);
  assert.equal(s.inventory.pokeball, 3);
  assert.equal(s.wins, 5);
  assert.ok(s.starterChosen);
  // Migration is deterministic for the same uid (IVs don't reroll on reload).
  assert.deepEqual(G.migrateSave(v1).box[0].ivs, s.box[0].ivs);
  // A migrated save re-normalises cleanly.
  assert.deepEqual(G.migrateSave(JSON.parse(JSON.stringify(s))).box.length, 2);
  assert.equal(G.migrateSave({ version: 99 }), null);
});

test('imports are sanitised (bad values clamped, unknown items dropped)', () => {
  const s = G.migrateSave({ version: 2, coins: -5, box: [{ uid: 'x', species: 'pikachu', level: 500, ivs: { hp: 99 }, evs: { atk: 999, spe: 999 }, moves: ['thunderbolt', 'notamove'], item: 'cheatitem' }, { species: 'fakemon' }], party: ['x', 'y'], inventory: { potion: 5, hackitem: 9 }, trainerName: '<script>alert(1)</script>' });
  assert.equal(s.coins, 0);
  assert.equal(s.box.length, 1);
  const p = s.box[0];
  assert.equal(p.level, 100);
  assert.equal(p.ivs.hp, 31);
  assert.ok(E.STATS.reduce((a, k) => a + p.evs[k], 0) <= 510);
  assert.deepEqual(p.moves, ['thunderbolt']);
  assert.equal(p.item, null);
  assert.deepEqual(s.party, ['x']);
  assert.equal(s.inventory.hackitem, undefined);
  assert.ok(!s.trainerName.includes('<'));
});

test('box odds sum to 100 and every pool is populated', () => {
  for (const [k, b] of Object.entries(G.BOXES)) {
    assert.equal(b.odds.reduce((a, o) => a + o[1], 0), 100, k);
    for (const o of b.odds) if (o[2] !== 'outbreak') assert.ok(G.boxPool(o[2]).length > 0, o[2]);
  }
  assert.equal(G.boxPool('starter').length, 27);
});

test('daily trainers and missions are deterministic per date', () => {
  const a = G.buildTrainer('hard', '2026-10-31', 30), b = G.buildTrainer('hard', '2026-10-31', 30);
  assert.deepEqual(a.team.map(p => p.species), b.team.map(p => p.species));
  assert.equal(a.team.length, 3);
  assert.deepEqual(G.dailyMissions('2026-10-31').map(m => m.id), G.dailyMissions('2026-10-31').map(m => m.id));
  assert.ok(G.dailyOutbreak('2026-10-31'));
});

import * as S from '../js/security.js';
test('SHA-256 / HMAC match published test vectors', () => {
  assert.equal(S.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(S.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(S.sha256Hex('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  // RFC 4231 test case 2
  assert.equal(S.hmacSha256('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

test('anti-cheat: honest saves pass, edits are detected', () => {
  const fresh = () => {
    const s = G.defaultSave();
    const p = G.generatePokemon('bulbasaur', 10, { rng: E.makeRng(5) });
    s.box.push(p); s.party.push(p.uid); s.ledger.pokemonGranted = 1; s.starterChosen = true;
    return s;
  };
  const s = fresh();
  assert.deepEqual(G.auditSave(s), []);
  S.applySeal(s);
  assert.ok(S.verifySeal(s));
  const edited = JSON.parse(JSON.stringify(s)); edited.coins = 99999;
  assert.ok(!S.verifySeal(edited));
  assert.ok(G.auditSave(edited).some(x => /ledger/.test(x)));
  const shiny = fresh(); shiny.box[0].shiny = true;
  assert.ok(G.auditSave(shiny).some(x => /signature/.test(x)));
  const ivs = fresh(); ivs.box[0].ivs.atk = 31; ivs.box[0].ivs.hp = 31; ivs.box[0].ivs.def = ivs.box[0].ivs.def === 31 ? 30 : 31;
  assert.ok(G.auditSave(ivs).some(x => /signature/.test(x)));
  const swap = fresh(); swap.box[0].species = 'mewtwo';
  assert.ok(G.auditSave(swap).some(x => /evolution line/.test(x)));
  const lvl = fresh(); lvl.box[0].level = 100;
  assert.ok(G.auditSave(lvl).some(x => /level/.test(x)));
  const dup = fresh(); dup.box.push({ ...dup.box[0] }); dup.ledger.pokemonGranted = 2;
  assert.ok(G.auditSave(dup).some(x => /duplicate/.test(x)));
  // Legit progress through the ledger passes.
  const ok = fresh(); const before = ok.box[0].exp; G.gainExp(ok.box[0], 5000); ok.ledger.expGranted += ok.box[0].exp - before;
  ok.coins += 120; ok.ledger.earned += 120;
  assert.deepEqual(G.auditSave(ok), []);
  // Evolution keeps the line.
  ok.box[0].level = Math.max(ok.box[0].level, 16); ok.box[0].exp = Math.max(ok.box[0].exp, G.expForLevel(4, 16));
  G.evolve(ok.box[0], 'ivysaur');
  assert.ok(!G.auditSave(ok).some(x => /line|signature/.test(x)));
});

test('legacy v2 saves (pre-protection) are adopted, not flagged', () => {
  const p = G.generatePokemon('eevee', 20, { rng: E.makeRng(9) });
  delete p.sig; delete p.line; delete p.exp0;
  const s = G.migrateSave({ version: 2, coins: 4321, box: [p], party: [p.uid], starterChosen: true });
  assert.ok(s.legacyAdopted);
  assert.deepEqual(G.auditSave(s), []);
});

test('encrypted export round-trips and rejects wrong passwords / edits', async () => {
  const s = G.defaultSave();
  const env = await S.encryptSave(s, 'correct horse');
  assert.ok(S.isEnvelope(env));
  const back = await S.decryptSave(env, 'correct horse');
  assert.ok(S.verifySeal(back));
  await assert.rejects(S.decryptSave(env, 'wrong'), /Wrong password/);
  const bad = { ...env, data: env.data.slice(0, -6) + (env.data.slice(-6, -5) === 'A' ? 'B' : 'A') + env.data.slice(-5) };
  await assert.rejects(S.decryptSave(bad, 'correct horse'));
});
