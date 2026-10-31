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
