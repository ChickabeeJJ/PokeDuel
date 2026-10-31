// Builds the static game data in /data from Pokémon Showdown (MIT licence) and
// PokéAPI's CSV exports. Nothing downloaded is executed: the Showdown .ts tables
// are read as plain object literals by ./ts-data-parser.mjs.
//
// Usage:
//   node tools/build-data.mjs <showdown-checkout-dir> <pokeapi-csv-dir>
// where <showdown-checkout-dir> contains data/moves.ts, data/pokedex.ts,
// data/learnsets.ts, data/text/*.ts and data/mods/champions/*.ts, and
// <pokeapi-csv-dir> contains pokemon.csv, pokemon_stats.csv, pokemon_species.csv
// from github.com/PokeAPI/pokeapi/tree/master/data/v2/csv.
//
// Move numbers use Gen 9 data with the Pokémon Champions balance layer applied
// (Showdown's data/mods/champions): base power/accuracy/PP/secondary changes and
// the Champions PP rule (PP capped at 20, then (pp / 5 + 1) * 4 max PP).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDataTable } from './ts-data-parser.mjs';

const [sdDir, csvDir] = process.argv.slice(2);
if (!sdDir || !csvDir) { console.error('Usage: node tools/build-data.mjs <showdown-dir> <csv-dir>'); process.exit(1); }
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(OUT, { recursive: true });

const load = f => parseDataTable(readFileSync(join(sdDir, 'data', f + '.ts'), 'utf8'));
const csv = f => {
  const [head, ...rows] = readFileSync(join(csvDir, f + '.csv'), 'utf8').trim().split(/\r?\n/);
  const keys = head.split(',');
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [keys[i], v])));
};
const toId = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'symbol' || k === '__fns' ? undefined : v)));

// ---------- Moves ----------
const baseMoves = load('moves');
const champMoves = load('mods/champions/moves');
const moveText = load('text/moves');
const SKIP_NONSTANDARD = new Set(['Max', 'Gigantamax', 'Z', 'LGPE', 'CAP', 'Custom', 'Unobtainable']);
const KEEP = ['secondary', 'secondaries', 'self', 'boosts', 'status', 'volatileStatus', 'sideCondition', 'slotCondition',
  'weather', 'terrain', 'pseudoWeather', 'heal', 'drain', 'recoil', 'selfSwitch', 'forceSwitch', 'multihit', 'multiaccuracy',
  'critRatio', 'willCrit', 'ohko', 'selfdestruct', 'overrideOffensiveStat', 'overrideOffensivePokemon', 'overrideDefensiveStat',
  'ignoreDefensive', 'ignoreEvasion', 'ignoreImmunity', 'ignoreAbility', 'damage', 'breaksProtect', 'stallingMove',
  'hasCrashDamage', 'mindBlownRecoil', 'struggleRecoil', 'thawsTarget', 'sleepUsable', 'noPPBoosts', 'selfBoost',
  'tracksTarget', 'smartTarget', 'basePowerCallback'];
const FLAGS = ['contact', 'punch', 'bite', 'sound', 'pulse', 'slicing', 'powder', 'bullet', 'wind', 'dance', 'heal',
  'charge', 'recharge', 'protect', 'defrost', 'gravity', 'bypasssub', 'reflectable', 'snatch', 'metronome', 'cantusetwice',
  'futuremove', 'failencore', 'nosleeptalk'];
const CHAMPIONS_DESC = {
  freezedry: 'Super effective on Water. No freeze chance in Champions.',
  makeitrain: 'Lowers the user\'s Sp. Atk by 2. Hits foe(s).',
  toxicthread: 'Lowers the target\'s Speed by 2 and poisons it.',
  growth: 'Raises user\'s Attack and Sp. Atk by 1; 2 in Sun. Grass type.',
  snaptrap: 'Traps and damages the target for 4-5 turns. Steel type.',
  nihillight: 'Ignores the target\'s stat stage changes.',
};
const moves = {};
const champChanged = [];
for (const [id, raw] of Object.entries(baseMoves)) {
  let m = { ...raw };
  const ch = champMoves[id];
  if (ch) {
    const { inherit, __fns, ...rest } = ch;
    const changed = Object.keys(rest).filter(k => k !== 'isNonstandard' && JSON.stringify(rest[k]) !== JSON.stringify(raw[k]));
    if (changed.length) champChanged.push(id);
    m = { ...m, ...rest };
    if (__fns) m.__fns = [...new Set([...(raw.__fns || []), ...__fns])];
    for (const [k, v] of Object.entries(rest)) if (typeof v === 'symbol') delete m[k];
  }
  if (m.isNonstandard && SKIP_NONSTANDARD.has(m.isNonstandard)) continue;
  if (m.isZ || m.isMax) continue;
  const pp = Math.min(m.pp, 20);
  const out = {
    name: m.name, type: m.type, cat: m.category, bp: m.basePower, acc: m.accuracy, pp: m.noPPBoosts ? pp : (pp / 5 + 1) * 4,
    pri: m.priority || 0, target: m.target,
  };
  const flags = FLAGS.filter(f => m.flags?.[f]);
  if (flags.length) out.flags = flags;
  for (const k of KEEP) if (m[k] !== undefined && typeof m[k] !== 'symbol') out[k] = m[k];
  if (m.condition?.duration) out.duration = m.condition.duration;
  const fns = [...(m.__fns || []), ...(m.secondary?.__fns ? ['secondary.' + m.secondary.__fns] : []), ...(m.self?.__fns ? ['self.' + m.self.__fns] : [])];
  if (fns.length) out.cb = fns;
  if (ch && champChanged.includes(id)) out.champions = true;
  const text = moveText[id];
  if (text) out.desc = text.shortDesc || text.desc || '';
  // Showdown's text is written for base Gen 9; correct it where Champions changed the numbers.
  const oldChance = raw.secondary?.chance, newChance = m.secondary?.chance;
  if (out.desc && oldChance && newChance && oldChance !== newChance) out.desc = out.desc.replace(oldChance + '%', newChance + '%');
  if (CHAMPIONS_DESC[id]) out.desc = CHAMPIONS_DESC[id];
  moves[id] = clean(out);
}

// ---------- Species ----------
const dex = load('pokedex');
const learnsets = load('learnsets');
const species = csv('pokemon_species');
const pokemonCsv = csv('pokemon');
const stats = csv('pokemon_stats');
const evByPokemon = {};
for (const s of stats) (evByPokemon[s.pokemon_id] ||= [0, 0, 0, 0, 0, 0])[s.stat_id - 1] = Number(s.effort);
const pkmnById = Object.fromEntries(pokemonCsv.map(p => [p.id, p]));
const speciesById = Object.fromEntries(species.map(s => [s.id, s]));
const pokedex = {};
const nameToId = {};
for (const [id, d] of Object.entries(dex)) {
  if (d.forme || d.num < 1 || d.num > 1025 || d.isNonstandard === 'CAP' || d.isNonstandard === 'Custom') continue;
  nameToId[d.name] = id;
}
for (const [id, d] of Object.entries(dex)) {
  if (nameToId[d.name] !== id) continue;
  const sp = speciesById[d.num] || {};
  const pk = pkmnById[d.num] || {};
  const gender = d.gender ? d.gender : d.genderRatio ? d.genderRatio.F : 0.5;
  const entry = {
    num: d.num, name: d.name, types: d.types,
    bs: [d.baseStats.hp, d.baseStats.atk, d.baseStats.def, d.baseStats.spa, d.baseStats.spd, d.baseStats.spe],
    ab: d.abilities, wt: d.weightkg, ht: d.heightm,
    g: gender, // 'N' genderless, 'M'/'F' fixed, otherwise female ratio 0..1
    ey: evByPokemon[d.num] || [0, 0, 0, 0, 0, 1],
    bx: Number(pk.base_experience) || 64,
    gr: Number(sp.growth_rate_id) || 2,
    cr: Number(sp.capture_rate) || 45,
    gen: Number(sp.generation_id) || 1,
  };
  if (d.tags?.length) entry.tags = d.tags;
  if (Number(sp.is_baby)) entry.baby = 1;
  const evos = (d.evos || []).map(n => nameToId[n]).filter(Boolean);
  if (evos.length) entry.evos = evos;
  if (d.prevo && nameToId[d.prevo]) {
    entry.prevo = nameToId[d.prevo];
    for (const k of ['evoLevel', 'evoType', 'evoItem', 'evoCondition', 'evoMove', 'evoRegion']) if (d[k] !== undefined) entry[k] = d[k];
  }
  pokedex[id] = entry;
}

// ---------- Learnsets (level-up from latest generation available, plus TMs) ----------
const moveIndex = Object.keys(moves);
const moveIdx = Object.fromEntries(moveIndex.map((m, i) => [m, i]));
const learn = {};
for (const id of Object.keys(pokedex)) {
  let ls = learnsets[id]?.learnset;
  if (!ls) continue;
  let best = 0;
  for (const srcs of Object.values(ls)) for (const s of srcs) { const m = /^(\d)L/.exec(s); if (m) best = Math.max(best, +m[1]); }
  const level = [];
  const tm = [];
  for (const [mv, srcs] of Object.entries(ls)) {
    if (!(mv in moveIdx)) continue;
    let lvl = null;
    for (const s of srcs) { const m = new RegExp('^' + best + 'L(\\d+)').exec(s); if (m) lvl = lvl === null ? +m[1] : Math.min(lvl, +m[1]); }
    if (lvl !== null) level.push([lvl, moveIdx[mv]]);
    if (srcs.some(s => s === '9M' || (best < 9 && s === best + 'M'))) tm.push(moveIdx[mv]);
  }
  level.sort((a, b) => a[0] - b[0]);
  learn[id] = { g: best, L: level.flat(), M: tm };
}

// ---------- Ability descriptions (engine support is flagged separately in js/engine.js) ----------
const abilityText = load('text/abilities');
const abilities = {};
for (const [id, a] of Object.entries(load('abilities'))) {
  if (a.isNonstandard === 'CAP' || a.isNonstandard === 'Custom' || !abilityText[id]) continue;
  abilities[id] = { name: a.name, desc: abilityText[id].shortDesc || abilityText[id].desc || '' };
}

writeFileSync(join(OUT, 'moves.json'), JSON.stringify(moves));
writeFileSync(join(OUT, 'abilities.json'), JSON.stringify(abilities));
writeFileSync(join(OUT, 'pokedex.json'), JSON.stringify(pokedex));
writeFileSync(join(OUT, 'learnsets.json'), JSON.stringify({ moves: moveIndex, learnsets: learn }));
console.log('moves', Object.keys(moves).length, 'champions-changed', champChanged.length);
console.log('species', Object.keys(pokedex).length, 'learnsets', Object.keys(learn).length);
