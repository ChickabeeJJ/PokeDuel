// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../js/engine.js';

const json = f => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const moves = json('moves.json'), dex = json('pokedex.json'), abilities = json('abilities.json'), ls = json('learnsets.json');
E.setData({ moves, dex, abilities });

const set = (species, moveIds, extra = {}) => ({ species, level: 100, moves: moveIds, ability: dex[species].ab[0], nature: 'hardy', ivs: {}, evs: {}, ...extra });
const battle = (p, e, seed = 1, opts = {}) => E.createBattle({ player: { team: Array.isArray(p) ? p : [p] }, enemy: { team: Array.isArray(e) ? e : [e] }, seed, ai: 'hard', allowTera: true, ...opts });
const texts = evs => evs.filter(e => e.t === 'msg').map(e => e.text);
// Force the enemy's choice by giving it a single move.

test('stat formula matches mainline (Garchomp, Adamant 252 Atk)', () => {
  const s = E.calcStats(dex.garchomp, 100, {}, { atk: 252 }, 'adamant');
  assert.equal(s.atk, 394);
  assert.equal(s.hp, 357);
  assert.equal(s.spa, 176); // (160+31)+5 = 196 * 0.9 = 176
});

test('damage range equals the Showdown formula (Earthquake vs Heatran)', () => {
  const b = battle(set('garchomp', ['earthquake'], { nature: 'adamant', evs: { atk: 252 }, ability: 'roughskin' }), set('heatran', ['splash'], { ability: 'flashfire' }));
  const r = E.damageRange(b, E.active(b, 'p'), E.active(b, 'e'), 'earthquake');
  assert.deepEqual([r.lo, r.hi], [684, 808]);
  assert.equal(r.eff, 4);
});

test('type and ability immunities', () => {
  let b = battle(set('garchomp', ['earthquake']), set('pidgeot', ['splash'], { teraType: 'Flying' }));
  let ev = E.submitAction(b, { type: 'move', index: 0 });
  assert.ok(texts(ev).some(t => t.includes("doesn't affect")));
  b = battle(set('garchomp', ['earthquake']), set('gengar', ['splash'], { ability: 'levitate', teraType: 'Ghost' }));
  ev = E.submitAction(b, { type: 'move', index: 0 });
  assert.ok(texts(ev).some(t => t.includes("doesn't affect")));
  b = battle(set('jolteon', ['thunderwave']), set('garchomp', ['splash']), 1, { allowTera: false });
  ev = E.submitAction(b, { type: 'move', index: 0 });
  assert.equal(E.active(b, 'e').status, null);
  b = battle(set('jolteon', ['thunderbolt']), set('lanturn', ['splash'], { ability: 'voltabsorb' }));
  ev = E.submitAction(b, { type: 'move', index: 0 });
  assert.equal(E.active(b, 'e').hp, E.active(b, 'e').maxhp);
});

test('priority beats speed; Trick Room reverses order', () => {
  const b = battle(set('snorlax', ['quickattack']), set('jolteon', ['thunderbolt']), 3);
  const ev = E.submitAction(b, { type: 'move', index: 0 });
  const first = ev.find(e => e.t === 'move');
  assert.equal(first.side, 'p');
  const b2 = battle(set('snorlax', ['trickroom', 'bodyslam']), set('jolteon', ['shadowball']), 4);
  E.submitAction(b2, { type: 'move', index: 0 });
  const ev2 = E.submitAction(b2, { type: 'move', index: 1 });
  assert.equal(ev2.find(e => e.t === 'move').side, 'p');
});

test('Protect blocks and consecutive Protect can fail', () => {
  let fails = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const b = battle(set('snorlax', ['protect']), set('machamp', ['closecombat'], { ability: 'noguard' }), seed);
    const ev1 = E.submitAction(b, { type: 'move', index: 0 });
    assert.ok(texts(ev1).some(t => t.includes('protected itself')));
    assert.equal(E.active(b, 'p').hp, E.active(b, 'p').maxhp);
    const ev2 = E.submitAction(b, { type: 'move', index: 0 });
    if (texts(ev2).includes('But it failed!')) fails++;
  }
  assert.ok(fails > 25 && fails < 55, 'second protect should fail ~2/3 of the time, got ' + fails);
});

test('burn halves physical damage; Guts and Facade ignore it', () => {
  const mk = st => { const b = battle(set('machamp', ['closecombat', 'facade'], { ability: 'noguard' }), set('blissey', ['splash'])); E.active(b, 'p').status = st; return b; };
  const healthy = E.damageRange(mk(null), E.active(mk(null), 'p'), E.active(mk(null), 'e'), 'closecombat');
  const b = mk('brn');
  const burned = E.damageRange(b, E.active(b, 'p'), E.active(b, 'e'), 'closecombat');
  assert.ok(Math.abs(burned.hi * 2 - healthy.hi) <= 2);
  const facadeBurn = E.damageRange(b, E.active(b, 'p'), E.active(b, 'e'), 'facade');
  const b2 = mk(null);
  const facadeHealthy = E.damageRange(b2, E.active(b2, 'p'), E.active(b2, 'e'), 'facade');
  assert.ok(facadeBurn.hi > facadeHealthy.hi * 1.9);
});

test('Champions balance values are applied', () => {
  assert.equal(moves.moonblast.secondary.chance, 10);
  assert.equal(moves.protect.pp, 8);          // PP 5 -> (5/5+1)*4
  assert.equal(moves.tackle.pp, 20);          // capped at 20
  assert.equal(moves.flamethrower.pp, 16);
  assert.equal(moves.slash.bp, 80);
  assert.equal(moves.crabhammer.acc, 95);
  assert.equal(moves.makeitrain.self.boosts.spa, -2);
  assert.equal(moves.freezedry.secondary, undefined);
  assert.equal(moves.growth.type, 'Grass');
});

test('Champions paralysis: speed halved, ~1/8 full paralysis', () => {
  let fullPara = 0, n = 400;
  for (let seed = 1; seed <= n; seed++) {
    const b = battle(set('snorlax', ['bodyslam']), set('blissey', ['splash']), seed);
    E.active(b, 'p').status = 'par';
    const ev = E.submitAction(b, { type: 'move', index: 0 });
    if (texts(ev).some(t => t.includes("can't move"))) fullPara++;
  }
  assert.ok(fullPara > n * 0.07 && fullPara < n * 0.19, 'full para ' + fullPara + '/' + n);
});

test('Champions sleep: 1/3 wake on turn 2, otherwise turn 3', () => {
  const dist = {};
  for (let seed = 1; seed <= 200; seed++) {
    const b = battle(set('snorlax', ['bodyslam']), set('breloom', ['spore'], { ability: 'technician' }), seed);
    // Breloom is faster: Snorlax falls asleep and loses this turn too.
    let skipped = texts(E.submitAction(b, { type: 'move', index: 0 })).some(x => x.includes('fast asleep')) ? 1 : 0;
    for (let t = 0; t < 5 && E.active(b, 'p').status === 'slp'; t++) {
      E.active(b, 'e').moves[0].id = 'splash';
      const ev = E.submitAction(b, { type: 'move', index: 0 });
      if (texts(ev).some(x => x.includes('fast asleep'))) skipped++;
    }
    dist[skipped] = (dist[skipped] || 0) + 1;
  }
  assert.ok(!dist[0] && !dist[3], JSON.stringify(dist));
  assert.ok(dist[1] > 45 && dist[1] < 90 && dist[2] > 110, JSON.stringify(dist));
});

test('Stealth Rock deals 50% to 4x-weak Charizard', () => {
  const b = battle(set('garchomp', ['stealthrock', 'roar']), [set('blissey', ['splash']), set('charizard', ['splash'])], 9);
  E.submitAction(b, { type: 'move', index: 0 });
  E.submitAction(b, { type: 'move', index: 1 });
  const zard = b.sides.e.team[1];
  assert.equal(b.sides.e.active, 1);
  assert.equal(zard.hp, zard.maxhp - Math.floor(zard.maxhp / 2));
});

test('Skill Link hits 5 times; Intimidate drops Attack', () => {
  const b = battle(set('cinccino', ['tailslap'], { ability: 'skilllink' }), set('blissey', ['splash']), 2);
  const ev = E.submitAction(b, { type: 'move', index: 0 });
  assert.ok(texts(ev).includes('The Pokémon was hit 5 times!'));
  const b2 = battle(set('garchomp', ['earthquake']), set('gyarados', ['splash'], { ability: 'intimidate' }));
  assert.equal(E.active(b2, 'p').boosts.atk, -1);
});

test('Terastallization changes defensive type and boosts STAB to 2x', () => {
  const b = battle(set('charizard', ['flamethrower'], { teraType: 'Fire' }), set('blissey', ['splash']));
  const before = E.damageRange(b, E.active(b, 'p'), E.active(b, 'e'), 'flamethrower');
  E.submitAction(b, { type: 'move', index: 0, tera: true });
  assert.deepEqual(E.active(b, 'p').types, ['Fire']);
  const after = E.damageRange(b, E.active(b, 'p'), E.active(b, 'e'), 'flamethrower');
  assert.ok(Math.abs(after.hi / before.hi - 4 / 3) < 0.02);
});

test('U-turn asks the player to pick a replacement mid-turn', () => {
  const b = battle([set('scizor', ['uturn'], { ability: 'technician' }), set('blissey', ['splash'])], set('snorlax', ['bodyslam']), 5);
  E.submitAction(b, { type: 'move', index: 0 });
  assert.equal(E.getRequest(b).type, 'switch');
  E.submitAction(b, { type: 'switch', index: 1 });
  assert.equal(b.sides.p.active, 1);
  assert.equal(E.getRequest(b).type, 'move');
});

test('fainted lead forces a replacement and the battle ends correctly', () => {
  const b = battle([set('magikarp', ['splash'], { level: 5 }), set('magikarp', ['splash'], { level: 5 })], set('mewtwo', ['psystrike'], { ability: 'pressure' }), 7);
  E.submitAction(b, { type: 'move', index: 0 });
  assert.equal(E.getRequest(b).type, 'switch');
  E.submitAction(b, { type: 'switch', index: 1 });
  E.submitAction(b, { type: 'move', index: 0 });
  assert.equal(b.ended, true);
  assert.equal(b.winner, 'e');
});

test('fuzz: 600 random battles complete without errors', () => {
  const ids = Object.keys(dex);
  const learn = ls.learnsets, mlist = ls.moves;
  const rng = E.makeRng(1234);
  const randomSet = () => {
    const sp = rng.pick(ids);
    const L = learn[sp]?.L || [];
    const pool = [];
    for (let i = 0; i < L.length; i += 2) pool.push(mlist[L[i + 1]]);
    for (const i of learn[sp]?.M || []) pool.push(mlist[i]);
    const mv = [...new Set(pool)].sort(() => rng.next() - .5).slice(0, 4);
    const abs = Object.values(dex[sp].ab);
    const items = [...E.ITEM_SUPPORT];
    return { species: sp, level: 5 + rng.int(96), moves: mv.length ? mv : ['tackle'], ability: rng.pick(abs), nature: rng.pick(Object.keys(E.NATURES)), item: rng.next() < .6 ? rng.pick(items) : null, teraType: rng.pick(E.TYPES), ivs: {}, evs: {} };
  };
  for (let n = 0; n < 600; n++) {
    const b = E.createBattle({ player: { team: [randomSet(), randomSet(), randomSet()] }, enemy: { team: [randomSet(), randomSet(), randomSet()] }, seed: n, ai: rng.pick(['easy', 'medium', 'hard']) });
    let guard = 0;
    while (!b.ended && guard++ < 300) {
      const req = E.getRequest(b);
      if (req.type === 'switch') { E.submitAction(b, { type: 'switch', index: rng.pick(req.switches) }); continue; }
      const usable = req.moves.filter(m => !m.disabled);
      const r = rng.next();
      if (r < .1 && req.switches.length && !req.trapped && !req.locked) E.submitAction(b, { type: 'switch', index: rng.pick(req.switches) });
      else E.submitAction(b, { type: 'move', index: usable.length ? rng.pick(usable).index : 0, tera: req.canTera && rng.next() < .2 });
      for (const s of Object.values(b.sides)) for (const m of s.team) assert.ok(m.hp >= 0 && m.hp <= m.maxhp && Number.isInteger(m.hp), 'bad hp ' + m.hp);
    }
  }
});
