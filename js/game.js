// PokeDuel game rules that sit on top of the battle engine: Pokémon instances
// (IVs, EVs, natures, shinies, marks, Tera types, held items), experience curves,
// evolution, the item catalogue, boxes/odds, daily content and the save format.
// DOM-free so it can be unit-tested in Node.

import { NATURES, STATS, TYPES, calcStats, makeRng, hashString, toId, TYPE_BOOST_ITEMS } from './engine.js';
import { signPokemon, verifyPokemon } from './security.js';

const G = { dex: {}, moves: {}, learn: null, moveList: [], numToId: {} };
export function setGameData({ dex, moves, learnsets }) {
  if (dex) { G.dex = dex; G.numToId = {}; for (const [id, d] of Object.entries(dex)) G.numToId[d.num] = id; }
  if (moves) G.moves = moves;
  if (learnsets) { G.learn = learnsets.learnsets; G.moveList = learnsets.moves; }
}
export const gameData = G;
export const speciesByNum = n => G.numToId[n];
// Root of a species' evolution family (used to check a Pokémon can't change line).
export function familyRoot(species) { let s = species, guard = 0; while (G.dex[s]?.prevo && G.dex[G.dex[s].prevo] && guard++ < 5) s = G.dex[s].prevo; return s; }

// ---------- Dates / seeded daily content ----------
export const todayKey = (d = new Date()) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000);
export const dailyRng = (key, salt) => makeRng(hashString(key + ':' + salt));

export const WEATHERS = [
  { id: 'sunny', name: 'Clear skies', icon: '☀', mark: null },
  { id: 'cloudy', name: 'Overcast', icon: '☁', mark: 'cloudy' },
  { id: 'rain', name: 'Rain', icon: '☂', mark: 'rainy' },
  { id: 'thunder', name: 'Thunderstorm', icon: '⚡', mark: 'stormy' },
  { id: 'snow', name: 'Snow', icon: '❄', mark: 'snowy' },
  { id: 'blizzard', name: 'Blizzard', icon: '❄', mark: 'blizzard' },
  { id: 'harsh-sun', name: 'Harsh sunlight', icon: '☀', mark: 'dry' },
  { id: 'sandstorm', name: 'Sandstorm', icon: '≋', mark: 'sandstorm' },
  { id: 'fog', name: 'Fog', icon: '≡', mark: 'misty' },
];
export function dailyWeather(key) { const r = dailyRng(key, 'weather'); const w = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8]; return WEATHERS[w[r.int(w.length)]]; }
export function isNight(d = new Date()) { const h = d.getHours(); return h < 6 || h >= 18; }

// ---------- Experience ----------
export function expForLevel(rate, n) {
  if (n <= 1) return 0;
  const c = n * n * n;
  switch (rate) {
    case 1: return Math.floor(5 * c / 4);
    case 3: return Math.floor(4 * c / 5);
    case 4: return Math.max(0, Math.floor(6 / 5 * c - 15 * n * n + 100 * n - 140));
    case 5: return n < 50 ? Math.floor(c * (100 - n) / 50) : n < 68 ? Math.floor(c * (150 - n) / 100) : n < 98 ? Math.floor(c * Math.floor((1911 - 10 * n) / 3) / 500) : Math.floor(c * (160 - n) / 100);
    case 6: return n < 15 ? Math.floor(c * (Math.floor((n + 1) / 3) + 24) / 50) : n < 36 ? Math.floor(c * (n + 14) / 50) : Math.floor(c * (Math.floor(n / 2) + 32) / 50);
    default: return c;
  }
}
export const GROWTH_NAMES = { 1: 'Slow', 2: 'Medium Fast', 3: 'Fast', 4: 'Medium Slow', 5: 'Erratic', 6: 'Fluctuating' };
export function levelProgress(p) {
  const sp = G.dex[p.species], rate = sp?.gr || 2;
  if (p.level >= 100) return { cur: 0, need: 0, pct: 100 };
  const lo = expForLevel(rate, p.level), hi = expForLevel(rate, p.level + 1);
  return { cur: p.exp - lo, need: hi - lo, pct: Math.max(0, Math.min(100, (p.exp - lo) / (hi - lo) * 100)) };
}
// Adds experience; returns the list of levels reached.
export function gainExp(p, amount) {
  const sp = G.dex[p.species], rate = sp?.gr || 2;
  const levels = [];
  if (p.level >= 100) return levels;
  p.exp = Math.min(expForLevel(rate, 100), p.exp + Math.max(0, Math.floor(amount)));
  while (p.level < 100 && p.exp >= expForLevel(rate, p.level + 1)) { p.level++; levels.push(p.level); }
  return levels;
}
// Gen 7+ scaled formula. trainer: 1.5x (daily battles), luckyEgg 1.5x.
export function expYield(defeatedSpecies, defeatedLevel, winnerLevel, { trainer = true, luckyEgg = false, share = 1 } = {}) {
  const b = G.dex[defeatedSpecies]?.bx || 64;
  const L = defeatedLevel, Lp = winnerLevel;
  let exp = Math.floor(b * L / 5 * Math.pow((2 * L + 10) / (L + Lp + 10), 2.5)) + 1;
  if (trainer) exp = Math.floor(exp * 1.5);
  if (luckyEgg) exp = Math.floor(exp * 1.5);
  return Math.max(1, Math.floor(exp * share));
}

// ---------- EVs / IVs ----------
export const EV_CAP = 252, EV_TOTAL = 510;
export function addEvs(p, gains) {
  let total = STATS.reduce((s, k) => s + (p.evs[k] || 0), 0);
  const applied = {};
  for (const k of STATS) {
    const want = gains[k] || 0;
    if (!want) continue;
    const room = Math.min(EV_CAP - (p.evs[k] || 0), EV_TOTAL - total);
    const add = Math.max(0, Math.min(want, room));
    if (add) { p.evs[k] = (p.evs[k] || 0) + add; total += add; applied[k] = add; }
  }
  return applied;
}
export const POWER_ITEMS = { powerweight: 'hp', powerbracer: 'atk', powerbelt: 'def', powerlens: 'spa', powerband: 'spd', poweranklet: 'spe' };
export function evYieldFor(defeatedSpecies, holderItem) {
  const ey = G.dex[defeatedSpecies]?.ey || [0, 0, 0, 0, 0, 1];
  const g = {};
  STATS.forEach((k, i) => { if (ey[i]) g[k] = ey[i]; });
  if (POWER_ITEMS[holderItem]) g[POWER_ITEMS[holderItem]] = (g[POWER_ITEMS[holderItem]] || 0) + 8;
  if (holderItem === 'machobrace') for (const k in g) g[k] *= 2;
  return g;
}
// Scarlet/Violet "Judge" wording.
export function ivJudge(v) { return v === 31 ? 'Best' : v >= 30 ? 'Fantastic' : v >= 26 ? 'Very good' : v >= 16 ? 'Pretty good' : v >= 1 ? 'Decent' : 'No good'; }
export function ivTotalJudge(sum) { return sum >= 151 ? 'Outstanding potential!' : sum >= 121 ? 'Relatively superior potential!' : sum >= 91 ? 'Above-average ability.' : 'Decent ability.'; }
export function effectiveIvs(p) { const out = { ...p.ivs }; for (const k of Object.keys(p.hyper || {})) if (p.hyper[k]) out[k] = 31; return out; }
export function statsOf(p) { return calcStats(G.dex[p.species], p.level, effectiveIvs(p), p.evs, p.mint || p.nature); }
export function hiddenPowerLike(p) { return p; }

// ---------- Marks (Scarlet/Violet-style titles) ----------
export const MARKS = {
  lunchtime: { name: 'Lunchtime Mark', title: 'the Peckish', kind: 'time' }, sleepytime: { name: 'Sleepy-Time Mark', title: 'the Sleepy', kind: 'time' },
  dusk: { name: 'Dusk Mark', title: 'the Dozy', kind: 'time' }, dawn: { name: 'Dawn Mark', title: 'the Early Riser', kind: 'time' },
  cloudy: { name: 'Cloudy Mark', title: 'the Cloud Watcher', kind: 'weather' }, rainy: { name: 'Rainy Mark', title: 'the Sodden', kind: 'weather' },
  stormy: { name: 'Stormy Mark', title: 'the Thunderstruck', kind: 'weather' }, snowy: { name: 'Snowy Mark', title: 'the Snow Frolicker', kind: 'weather' },
  blizzard: { name: 'Blizzard Mark', title: 'the Shivering', kind: 'weather' }, dry: { name: 'Dry Mark', title: 'the Parched', kind: 'weather' },
  sandstorm: { name: 'Sandstorm Mark', title: 'the Sandswept', kind: 'weather' }, misty: { name: 'Misty Mark', title: 'the Mist Drifter', kind: 'weather' },
  uncommon: { name: 'Uncommon Mark', title: 'the Sociable', kind: 'chance' }, rare: { name: 'Rare Mark', title: 'the Recluse', kind: 'chance' },
  rowdy: { name: 'Rowdy Mark', title: 'the Rowdy', kind: 'personality' }, absentminded: { name: 'Absent-Minded Mark', title: 'the Spacey', kind: 'personality' },
  jittery: { name: 'Jittery Mark', title: 'the Anxious', kind: 'personality' }, excited: { name: 'Excited Mark', title: 'the Giddy', kind: 'personality' },
  charismatic: { name: 'Charismatic Mark', title: 'the Radiant', kind: 'personality' }, calmness: { name: 'Calmness Mark', title: 'the Serene', kind: 'personality' },
  intense: { name: 'Intense Mark', title: 'the Feisty', kind: 'personality' }, zonedout: { name: 'Zoned-Out Mark', title: 'the Daydreamer', kind: 'personality' },
  joyful: { name: 'Joyful Mark', title: 'the Joyful', kind: 'personality' }, angry: { name: 'Angry Mark', title: 'the Furious', kind: 'personality' },
  smiley: { name: 'Smiley Mark', title: 'the Beaming', kind: 'personality' }, teary: { name: 'Teary Mark', title: 'the Teary-Eyed', kind: 'personality' },
  upbeat: { name: 'Upbeat Mark', title: 'the Chipper', kind: 'personality' }, peeved: { name: 'Peeved Mark', title: 'the Grumpy', kind: 'personality' },
  intellectual: { name: 'Intellectual Mark', title: 'the Scholar', kind: 'personality' }, ferocious: { name: 'Ferocious Mark', title: 'the Rampaging', kind: 'personality' },
  crafty: { name: 'Crafty Mark', title: 'the Opportunist', kind: 'personality' }, scowling: { name: 'Scowling Mark', title: 'the Stern', kind: 'personality' },
  kindly: { name: 'Kindly Mark', title: 'the Kindhearted', kind: 'personality' }, flustered: { name: 'Flustered Mark', title: 'the Easily Flustered', kind: 'personality' },
  pumpedup: { name: 'Pumped-Up Mark', title: 'the Driven', kind: 'personality' }, zeroenergy: { name: 'Zero Energy Mark', title: 'the Apathetic', kind: 'personality' },
  prideful: { name: 'Prideful Mark', title: 'the Arrogant', kind: 'personality' }, unsure: { name: 'Unsure Mark', title: 'the Reluctant', kind: 'personality' },
  humble: { name: 'Humble Mark', title: 'the Humble', kind: 'personality' }, thorny: { name: 'Thorny Mark', title: 'the Pompous', kind: 'personality' },
  vigor: { name: 'Vigor Mark', title: 'the Lively', kind: 'personality' }, slump: { name: 'Slump Mark', title: 'the Worn-Out', kind: 'personality' },
  jumbo: { name: 'Jumbo Mark', title: 'the Great', kind: 'size' }, mini: { name: 'Mini Mark', title: 'the Teeny', kind: 'size' },
  destiny: { name: 'Destiny Mark', title: 'the Chosen One', kind: 'special' }, partner: { name: 'Partner Mark', title: 'the Reliable Partner', kind: 'special' },
  mightiest: { name: 'Mightiest Mark', title: 'the Unrivaled', kind: 'special' },
};
const PERSONALITY = Object.keys(MARKS).filter(k => MARKS[k].kind === 'personality');
// Mark odds used by rollMark(); displayed truthfully in the box info screen.
export const MARK_ODDS = { rare: 1 / 400, personality: 1 / 40, uncommon: 1 / 50, time: 1 / 50, weather: 1 / 50 };
export function rollMark(rng, { date = new Date(), weatherMark = null, markCharm = false, createdAt = null } = {}) {
  const boost = markCharm ? 3 : 1;
  const won = p => rng.next() < p * boost;
  if (createdAt) {
    const c = new Date(createdAt);
    if (c.getMonth() === date.getMonth() && c.getDate() === date.getDate() && c.getFullYear() !== date.getFullYear()) return 'destiny';
  }
  if (won(MARK_ODDS.rare)) return 'rare';
  if (won(MARK_ODDS.personality)) return PERSONALITY[rng.int(PERSONALITY.length)];
  if (won(MARK_ODDS.uncommon)) return 'uncommon';
  const h = date.getHours();
  const timeMark = h >= 5 && h < 9 ? 'dawn' : h >= 11 && h < 14 ? 'lunchtime' : h >= 17 && h < 20 ? 'dusk' : (h >= 22 || h < 5) ? 'sleepytime' : null;
  if (timeMark && won(MARK_ODDS.time)) return timeMark;
  if (weatherMark && won(MARK_ODDS.weather)) return weatherMark;
  return null;
}
export function displayName(p) {
  const base = p.nickname || G.dex[p.species]?.name || p.species;
  return p.mark && MARKS[p.mark] ? base + ' ' + MARKS[p.mark].title : base;
}

// ---------- Moves / learnsets ----------
export function levelUpMoves(species) {
  const L = G.learn?.[species]?.L || [];
  const out = [];
  for (let i = 0; i < L.length; i += 2) out.push({ level: L[i], id: G.moveList[L[i + 1]] });
  return out;
}
export function tmMoves(species) { return (G.learn?.[species]?.M || []).map(i => G.moveList[i]).filter(id => G.moves[id]); }
export function learnableAt(species, level) {
  const seen = new Set(), out = [];
  for (const m of levelUpMoves(species)) if (m.level <= level && G.moves[m.id] && !seen.has(m.id)) { seen.add(m.id); out.push(m.id); }
  return out;
}
// Wild-style default: the four most recent level-up moves.
export function defaultMoves(species, level) {
  const all = learnableAt(species, level);
  const picked = all.slice(-4);
  if (!picked.length) return ['tackle'];
  return picked;
}
// Competitive-ish moveset for AI trainers.
export function buildAiMoves(species, level, { useTms = false, rng } = {}) {
  const sp = G.dex[species];
  let pool = learnableAt(species, level);
  if (useTms) pool = [...new Set([...pool, ...tmMoves(species)])];
  const scored = pool.map(id => {
    const m = G.moves[id];
    if (!m) return null;
    let s = 0;
    if (m.cat !== 'Status') {
      const bp = m.bp || (m.damage ? 60 : 0);
      s = bp * (m.acc === true ? 1 : m.acc / 100) * (sp.types.includes(m.type) ? 1.5 : 1);
      if (m.self?.volatileStatus === 'mustrecharge' || m.selfdestruct || m.flags?.includes('charge')) s *= 0.4;
      if (m.multihit) s *= Array.isArray(m.multihit) ? 2.5 : m.multihit;
      if (m.ohko) s = 30;
    } else {
      s = m.boosts && m.target === 'self' ? 55 : m.status ? 50 : m.heal ? 45 : m.sideCondition ? 40 : 15;
    }
    return { id, m, s: s * (0.9 + (rng ? rng.next() * 0.2 : 0.1)) };
  }).filter(Boolean).sort((a, b) => b.s - a.s);
  const out = [], types = new Set();
  let statusCount = 0;
  for (const x of scored) {
    if (out.length >= 4) break;
    if (x.m.cat === 'Status') { if (statusCount >= 1) continue; statusCount++; out.push(x.id); continue; }
    if (types.has(x.m.type) && scored.some(y => !types.has(y.m.type) && y.m.cat !== 'Status' && y.s > x.s * 0.6 && !out.includes(y.id))) continue;
    types.add(x.m.type); out.push(x.id);
  }
  for (const x of scored) { if (out.length >= 4) break; if (!out.includes(x.id)) out.push(x.id); }
  return out.length ? out : ['tackle'];
}

// ---------- Pokémon generation ----------
export const SHINY_BASE = 1 / 256;
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export function generatePokemon(species, level, opts = {}) {
  const rng = opts.rng || makeRng(Math.floor(Math.random() * 2 ** 32));
  const sp = G.dex[species];
  if (!sp) throw new Error('Unknown species ' + species);
  const legendary = sp.tags?.some(t => /Legendary|Mythical/.test(t));
  const ivs = {};
  for (const k of STATS) ivs[k] = rng.int(32);
  if (legendary || opts.perfectIvs) { const pool = [...STATS]; for (let i = 0; i < (opts.perfectIvs || 3); i++) { const k = pool.splice(rng.int(pool.length), 1)[0]; ivs[k] = 31; } }
  const shinyRate = opts.shinyRate ?? SHINY_BASE;
  const shiny = opts.shiny ?? (rng.next() < shinyRate);
  const g = sp.g;
  const gender = g === 'N' ? 'N' : g === 'M' ? 'M' : g === 'F' ? 'F' : (rng.next() < g ? 'F' : 'M');
  const slots = Object.keys(sp.ab).filter(k => k !== 'H' && k !== 'S');
  let abilitySlot = rng.next() < (opts.hiddenRate ?? 1 / 20) && sp.ab.H ? 'H' : slots[rng.int(slots.length)] || '0';
  const sizeRoll = rng.next();
  const size = sizeRoll < 0.01 ? 0 : sizeRoll > 0.99 ? 255 : Math.min(254, Math.max(1, Math.round(128 + (rng.next() + rng.next() + rng.next() - 1.5) * 85)));
  let mark = opts.noMark ? null : rollMark(rng, opts.markContext || {});
  if (!mark && size === 255) mark = 'jumbo';
  if (!mark && size === 0) mark = 'mini';
  const teraType = rng.next() < 0.15 ? TYPES[rng.int(TYPES.length)] : sp.types[rng.int(sp.types.length)];
  const p = {
    uid: opts.uid || uid(), species, level, exp: expForLevel(sp.gr, level), nickname: '', shiny, gender,
    nature: Object.keys(NATURES)[rng.int(25)], mint: null, abilitySlot, ability: toId(sp.ab[abilitySlot]),
    ivs, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, hyper: {}, teraType, item: null,
    marks: mark ? [mark] : [], mark, size, moves: defaultMoves(species, level), learned: [], friendship: legendary ? 0 : 70,
    metAt: new Date().toISOString(), origin: opts.origin || 'box', battles: 0, wins: 0, fav: false,
    line: familyRoot(species),
  };
  p.exp0 = p.exp;
  return signPokemon(p);
}

// ---------- Evolution ----------
export function evolutionOptions(p, ctx = {}) {
  const sp = G.dex[p.species];
  if (!sp?.evos) return [];
  const st = statsOf(p);
  const night = isNight(ctx.date);
  const out = [];
  for (const into of sp.evos) {
    const e = G.dex[into];
    if (!e) continue;
    const type = e.evoType || 'level';
    const cond = e.evoCondition || '';
    const timeOk = !/night/.test(cond) || night, dayOk = !/during the day/.test(cond) || !night;
    const timeText = /night/.test(cond) ? ' at night' : /during the day/.test(cond) ? ' during the day' : '';
    let ok = false, need = '', item = null;
    if (type === 'level') {
      const lvl = e.evoLevel || 1;
      ok = p.level >= lvl && timeOk && dayOk;
      if (/Atk stat > its Def/.test(cond)) ok = ok && st.atk > st.def;
      if (/Atk stat < its Def/.test(cond)) ok = ok && st.atk < st.def;
      if (/Atk stat equal/.test(cond)) ok = ok && st.atk === st.def;
      if (/during rain/.test(cond)) ok = ok && ['rain', 'thunder'].includes(ctx.weather);
      need = 'Level ' + lvl + timeText + (/during rain/.test(cond) ? ' while it is raining' : '') + (/Atk stat/.test(cond) ? ' (' + cond.replace('with an ', '') + ')' : '');
    } else if (type === 'levelFriendship') {
      ok = p.friendship >= 160 && timeOk && dayOk; need = 'High friendship (' + p.friendship + '/160)' + timeText;
    } else if (type === 'levelMove') {
      const mv = toId(e.evoMove); ok = p.moves.includes(mv); need = 'Knows ' + (G.moves[mv]?.name || e.evoMove);
    } else if (type === 'levelHold') {
      item = toId(e.evoItem); ok = p.item === item && timeOk && dayOk; need = 'Level up holding ' + e.evoItem + timeText;
    } else if (type === 'levelExtra') {
      ok = p.level >= 30; need = 'Level 30 (special condition simplified)';
      if (into === 'sylveon') { ok = p.friendship >= 160 && p.moves.some(m => G.moves[m]?.type === 'Fairy'); need = 'High friendship and knows a Fairy-type move'; }
    } else if (type === 'trade') {
      item = e.evoItem ? toId(e.evoItem) : null;
      ok = (ctx.inventory?.linkingcord || 0) > 0 && (!item || p.item === item);
      need = 'Use a Linking Cord' + (item ? ' while holding ' + e.evoItem : '');
    } else if (type === 'useItem') {
      item = toId(e.evoItem); ok = (ctx.inventory?.[item] || 0) > 0; need = 'Use a ' + e.evoItem;
    } else if (type === 'other') {
      ok = (p.battles || 0) >= 20 && (into !== 'gholdengo' || (ctx.coins || 0) >= 999);
      need = into === 'gholdengo' ? 'Fight 20 battles and have 999 coins' : 'Fight 20 battles together (simplified condition)';
    }
    out.push({ into, name: e.name, type, ok, need, consume: type === 'trade' ? 'linkingcord' : type === 'useItem' ? item : null });
  }
  return out;
}
export function evolve(p, into) {
  const from = G.dex[p.species], to = G.dex[into];
  const oldName = from.name;
  p.species = into;
  p.ability = toId(to.ab[p.abilitySlot] || to.ab['0']);
  if (!p.abilitySlot || !to.ab[p.abilitySlot]) p.abilitySlot = '0';
  if (p.exp < expForLevel(to.gr, p.level)) p.exp = expForLevel(to.gr, p.level);
  // Learn an evolution move (level 0/1 moves on the new species) if a slot is free.
  const evoMoves = levelUpMoves(into).filter(m => m.level === 0).map(m => m.id).filter(id => G.moves[id] && !p.moves.includes(id));
  for (const id of evoMoves) { if (p.moves.length < 4) p.moves.push(id); else if (!p.learned.includes(id)) p.learned.push(id); }
  return { from: oldName, to: to.name };
}

// ---------- Item catalogue ----------
// id → { name, cat, price, sprite slug (PokéAPI items), desc, ... }
const I = {};
const add = (cat, id, name, price, desc, extra = {}) => { I[id] = { id, name, cat, price, desc, sprite: extra.sprite || name.toLowerCase().replace(/[.'’]/g, '').replace(/é/g, 'e').replace(/\s+/g, '-'), ...extra }; };
add('medicine', 'potion', 'Potion', 20, 'Restores 20 HP to a Pokémon in battle.', { battle: { heal: 20 } });
add('medicine', 'superpotion', 'Super Potion', 45, 'Restores 60 HP to a Pokémon in battle.', { battle: { heal: 60 } });
add('medicine', 'hyperpotion', 'Hyper Potion', 90, 'Restores 120 HP to a Pokémon in battle.', { battle: { heal: 120 } });
add('medicine', 'maxpotion', 'Max Potion', 160, 'Fully restores a Pokémon\'s HP in battle.', { battle: { heal: 'full' } });
add('medicine', 'fullheal', 'Full Heal', 50, 'Cures all status conditions and confusion.', { battle: { cure: true } });
add('medicine', 'fullrestore', 'Full Restore', 220, 'Fully restores HP and cures all status conditions.', { battle: { heal: 'full', cure: true } });
add('medicine', 'revive', 'Revive', 120, 'Revives a fainted Pokémon with half its max HP.', { battle: { revive: 0.5 }, targetFainted: true });
add('medicine', 'maxrevive', 'Max Revive', 300, 'Revives a fainted Pokémon with full HP.', { battle: { revive: 1 }, targetFainted: true });
add('medicine', 'maxelixir', 'Max Elixir', 150, 'Fully restores the PP of all of a Pokémon\'s moves.', { battle: { pp: true } });
add('medicine', 'xattack', 'X Attack', 60, 'Sharply raises Attack (+2) for the rest of the battle.', { battle: { boosts: { atk: 2 } } });
add('medicine', 'xdefense', 'X Defense', 60, 'Sharply raises Defense (+2).', { battle: { boosts: { def: 2 } } });
add('medicine', 'xspatk', 'X Sp. Atk', 60, 'Sharply raises Sp. Atk (+2).', { battle: { boosts: { spa: 2 } } });
add('medicine', 'xspdef', 'X Sp. Def', 60, 'Sharply raises Sp. Def (+2).', { battle: { boosts: { spd: 2 } } });
add('medicine', 'xspeed', 'X Speed', 60, 'Sharply raises Speed (+2).', { battle: { boosts: { spe: 2 } } });
add('medicine', 'xaccuracy', 'X Accuracy', 60, 'Sharply raises accuracy (+2).', { battle: { boosts: { accuracy: 2 } } });

add('training', 'expcandyxs', 'Exp. Candy XS', 15, 'Gives a Pokémon 100 Exp. Points.', { exp: 100 });
add('training', 'expcandys', 'Exp. Candy S', 60, 'Gives a Pokémon 800 Exp. Points.', { exp: 800 });
add('training', 'expcandym', 'Exp. Candy M', 180, 'Gives a Pokémon 3,000 Exp. Points.', { exp: 3000 });
add('training', 'expcandyl', 'Exp. Candy L', 500, 'Gives a Pokémon 10,000 Exp. Points.', { exp: 10000 });
add('training', 'expcandyxl', 'Exp. Candy XL', 1200, 'Gives a Pokémon 30,000 Exp. Points.', { exp: 30000 });
add('training', 'rarecandy', 'Rare Candy', 250, 'Raises a Pokémon\'s level by 1.', { levelUp: 1 });
const VIT = { hpup: ['HP Up', 'hp'], protein: ['Protein', 'atk'], iron: ['Iron', 'def'], calcium: ['Calcium', 'spa'], zinc: ['Zinc', 'spd'], carbos: ['Carbos', 'spe'] };
for (const [id, [n, s]] of Object.entries(VIT)) add('training', id, n, 100, 'Raises base ' + ({ hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' })[s] + ' effort (+10 EVs).', { ev: { [s]: 10 } });
const FEA = { healthfeather: ['Health Feather', 'hp'], musclefeather: ['Muscle Feather', 'atk'], resistfeather: ['Resist Feather', 'def'], geniusfeather: ['Genius Feather', 'spa'], cleverfeather: ['Clever Feather', 'spd'], swiftfeather: ['Swift Feather', 'spe'] };
for (const [id, [n, s]] of Object.entries(FEA)) add('training', id, n, 10, 'Raises ' + ({ hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' })[s] + ' effort by 1 EV.', { ev: { [s]: 1 }, sprite: n.toLowerCase().replace(' feather', '-wing') });
add('training', 'freshstartmochi', 'Fresh-Start Mochi', 150, 'Resets all of a Pokémon\'s EVs to zero.', { resetEvs: true, sprite: 'fresh-start-mochi' });
add('training', 'bottlecap', 'Bottle Cap', 800, 'Hyper Training: treats one IV as 31. Pokémon must be level 50+.', { hyperOne: true });
add('training', 'goldbottlecap', 'Gold Bottle Cap', 3000, 'Hyper Training: treats every IV as 31. Pokémon must be level 50+.', { hyperAll: true });
add('training', 'abilitycapsule', 'Ability Capsule', 500, 'Switches between a species\' two standard Abilities.', { abilityCapsule: true });
add('training', 'abilitypatch', 'Ability Patch', 1500, 'Changes a Pokémon\'s Ability to its Hidden Ability.', { abilityPatch: true });
add('training', 'terashard', 'Tera Shard Bundle', 600, 'Changes a Pokémon\'s Tera Type to one you choose.', { teraChange: true, sprite: 'normal-tera-shard' });
for (const [nat, [plus, minus]] of Object.entries(NATURES)) {
  if (!plus && nat !== 'serious') continue;
  const n = nat[0].toUpperCase() + nat.slice(1);
  add('training', nat + 'mint', n + ' Mint', 400, plus ? 'Stats grow like a ' + n + ' nature (+' + plus.toUpperCase() + ', -' + minus.toUpperCase() + '). The nature itself is unchanged.' : 'Stats grow evenly, like a Serious nature.', { mint: nat });
}
add('training', 'sweetheart', 'Soothing Snack', 40, 'A treat that raises a Pokémon\'s friendship by 10.', { friendship: 10, sprite: 'pecha-berry' });

const H = (id, name, price, desc, extra) => add('held', id, name, price, desc, { hold: true, ...extra });
H('leftovers', 'Leftovers', 800, 'Restores 1/16 of max HP at the end of every turn.');
H('lifeorb', 'Life Orb', 1000, 'Boosts move damage by 1.3x; the holder loses 1/10 of max HP after attacking.');
H('choiceband', 'Choice Band', 1000, '1.5x Attack, but the holder is locked into its first move.');
H('choicespecs', 'Choice Specs', 1000, '1.5x Sp. Atk, but the holder is locked into its first move.');
H('choicescarf', 'Choice Scarf', 1000, '1.5x Speed, but the holder is locked into its first move.');
H('focussash', 'Focus Sash', 600, 'Survives a hit that would KO it from full HP with 1 HP (once per battle).');
H('assaultvest', 'Assault Vest', 900, '1.5x Sp. Def, but the holder can only use damaging moves.');
H('expertbelt', 'Expert Belt', 700, 'Super-effective moves deal 1.2x damage.');
H('rockyhelmet', 'Rocky Helmet', 700, 'Attackers making contact lose 1/6 of their max HP.');
H('heavydutyboots', 'Heavy-Duty Boots', 700, 'Protects the holder from entry hazards.');
H('eviolite', 'Eviolite', 800, '1.5x Defense and Sp. Def if the holder can still evolve.');
H('weaknesspolicy', 'Weakness Policy', 700, '+2 Attack and Sp. Atk when hit super effectively (once per battle).');
H('sitrusberry', 'Sitrus Berry', 80, 'Restores 1/4 of max HP at 1/2 HP or less (once per battle).');
H('oranberry', 'Oran Berry', 30, 'Restores 10 HP at 1/2 HP or less (once per battle).');
H('lumberry', 'Lum Berry', 150, 'Cures any status condition (once per battle).');
H('chestoberry', 'Chesto Berry', 60, 'Cures sleep (once per battle).');
H('muscleband', 'Muscle Band', 500, 'Physical moves deal 1.1x damage.');
H('wiseglasses', 'Wise Glasses', 500, 'Special moves deal 1.1x damage.');
H('shellbell', 'Shell Bell', 600, 'Restores 1/8 of the damage dealt.');
H('quickclaw', 'Quick Claw', 500, '20% chance to move first in its priority bracket.');
H('scopelens', 'Scope Lens', 500, 'Raises the critical-hit ratio by one stage.');
H('widelens', 'Wide Lens', 400, '1.1x move accuracy.');
H('brightpowder', 'Bright Powder', 400, 'Lowers opposing moves\' accuracy (0.9x).');
H('kingsrock', 'King\'s Rock', 500, 'Damaging moves get a 10% chance to flinch. Also a trade-evolution item.');
H('lightclay', 'Light Clay', 500, 'Reflect, Light Screen and Aurora Veil last 8 turns.');
H('airballoon', 'Air Balloon', 400, 'Immune to Ground moves until hit.');
H('whiteherb', 'White Herb', 400, 'Restores lowered stats (once per battle).');
H('flameorb', 'Flame Orb', 400, 'Burns the holder at the end of the turn.');
H('toxicorb', 'Toxic Orb', 400, 'Badly poisons the holder at the end of the turn.');
H('blacksludge', 'Black Sludge', 600, 'Poison types restore 1/16 HP per turn; others lose 1/8.');
H('covertcloak', 'Covert Cloak', 600, 'Protects from the additional effects of moves.');
H('clearamulet', 'Clear Amulet', 600, 'Prevents other Pokémon from lowering the holder\'s stats.');
H('boosterenergy', 'Booster Energy', 800, 'Activates Protosynthesis or Quark Drive (once per battle).');
H('loadeddice', 'Loaded Dice', 700, '2–5 hit moves hit 4 or 5 times.');
H('punchingglove', 'Punching Glove', 500, 'Punching moves deal 1.1x and don\'t make contact.');
H('safetygoggles', 'Safety Goggles', 500, 'Immune to powder moves and weather damage.');
H('protectivepads', 'Protective Pads', 500, 'Contact moves don\'t trigger the target\'s contact effects.');
H('bigroot', 'Big Root', 400, 'Draining moves restore 1.3x HP.');
H('bindingband', 'Binding Band', 300, 'Binding moves deal 1/6 instead of 1/8 per turn.');
H('damprock', 'Damp Rock', 400, 'Rain lasts 8 turns.'); H('heatrock', 'Heat Rock', 400, 'Sun lasts 8 turns.');
H('smoothrock', 'Smooth Rock', 400, 'Sandstorm lasts 8 turns.'); H('icyrock', 'Icy Rock', 400, 'Snow lasts 8 turns.');
const TB = { charcoal: 'Charcoal', mysticwater: 'Mystic Water', miracleseed: 'Miracle Seed', magnet: 'Magnet', nevermeltice: 'Never-Melt Ice', blackbelt: 'Black Belt', poisonbarb: 'Poison Barb', softsand: 'Soft Sand', sharpbeak: 'Sharp Beak', twistedspoon: 'Twisted Spoon', silverpowder: 'Silver Powder', hardstone: 'Hard Stone', spelltag: 'Spell Tag', dragonfang: 'Dragon Fang', blackglasses: 'Black Glasses', metalcoat: 'Metal Coat', silkscarf: 'Silk Scarf', fairyfeather: 'Fairy Feather' };
for (const [id, n] of Object.entries(TB)) H(id, n, 400, TYPE_BOOST_ITEMS[id] + '-type moves deal 1.2x damage.' + (id === 'metalcoat' ? ' Also a trade-evolution item.' : ''));
H('luckyegg', 'Lucky Egg', 1200, 'The holder earns 1.5x Exp. Points.');
H('amuletcoin', 'Amulet Coin', 3000, 'Doubles coins from battles the holder takes part in.');
H('soothebell', 'Soothe Bell', 300, 'Friendship rises twice as fast.');
H('machobrace', 'Macho Brace', 300, 'Doubles EVs gained in battle; halves Speed.');
for (const [id, s] of Object.entries(POWER_ITEMS)) H(id, ({ powerweight: 'Power Weight', powerbracer: 'Power Bracer', powerbelt: 'Power Belt', powerlens: 'Power Lens', powerband: 'Power Band', poweranklet: 'Power Anklet' })[id], 300, '+8 ' + s.toUpperCase() + ' EVs per Pokémon defeated; halves Speed.');

const EVO_ITEMS = {};
export function registerEvolutionItems() {
  for (const d of Object.values(G.dex)) {
    if (!d.evoItem || I[toId(d.evoItem)]) continue;
    const id = toId(d.evoItem);
    EVO_ITEMS[id] = true;
    const stone = /Stone$/.test(d.evoItem);
    const holdOnly = d.evoType === 'trade' || d.evoType === 'levelHold';
    add('evolution', id, d.evoItem, stone ? 300 : 450, holdOnly ? 'Evolution item. Hold it while evolving certain Pokémon.' : 'Evolution item. Use it on certain Pokémon to evolve them.', { hold: holdOnly });
  }
}
add('evolution', 'linkingcord', 'Linking Cord', 600, 'Evolves Pokémon that normally evolve by trade.');
add('key', 'shinycharm', 'Shiny Charm', 25000, 'Triples the chance of shiny Pokémon from boxes (1/256 → 3/256).', { key: true });
add('key', 'markcharm', 'Mark Charm', 8000, 'Triples the chance of Pokémon carrying a mark.', { key: true });
add('key', 'expshare', 'Exp. Share', 0, 'Party members that sat out a battle still earn 50% Exp. Points. Always on.', { key: true, notForSale: true });
add('collectible', 'pokeball', 'Poké Ball', 25, 'A collectible. Capture mechanics are not implemented.', { sprite: 'poke-ball' });
export const ITEMS = I;
export function itemSprite(id) { const it = I[id]; return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/' + (it?.sprite || id) + '.png'; }

// ---------- Boxes (lootboxes) with truthful odds ----------
export const BOX_RANGES = { g1: [1, 151], g2: [152, 251], g3: [252, 386], g4: [387, 493], g5: [494, 649], g6: [650, 721], g7: [722, 809], g8: [810, 905], g9: [906, 1025] };
export const REGIONS = { g1: 'Kanto', g2: 'Johto', g3: 'Hoenn', g4: 'Sinnoh', g5: 'Unova', g6: 'Kalos', g7: 'Alola', g8: 'Galar', g9: 'Paldea' };
export const STARTERS_BY_GEN = { 1: [1, 4, 7], 2: [152, 155, 158], 3: [252, 255, 258], 4: [387, 390, 393], 5: [495, 498, 501], 6: [650, 653, 656], 7: [722, 725, 728], 8: [810, 813, 816], 9: [906, 909, 912] };
const isLegend = d => d.tags?.some(t => /Legendary|Mythical/.test(t));
const bst = d => d.bs.reduce((a, b) => a + b, 0);
function pool(filter) { return Object.keys(G.dex).filter(id => filter(G.dex[id])); }
const poolCache = {};
export function boxPool(kind) {
  if (poolCache[kind]) return poolCache[kind];
  let p;
  if (kind === 'starter') p = Object.values(STARTERS_BY_GEN).flat().map(n => G.numToId[n]);
  else if (kind === 'basic') p = pool(d => !isLegend(d));
  else if (kind === 'rare') p = pool(d => !isLegend(d) && bst(d) >= 480);
  else if (kind === 'legend') p = pool(d => isLegend(d));
  else if (BOX_RANGES[kind]) p = pool(d => d.num >= BOX_RANGES[kind][0] && d.num <= BOX_RANGES[kind][1] && !isLegend(d));
  return poolCache[kind] = p || [];
}
export const BOXES = {
  starter: { name: 'Starter Box', price: 180, desc: 'A first-partner Pokémon from any of the nine generations.', odds: [['Starter Pokémon (27)', 100, 'starter']], art: 1 },
  basic: { name: 'Basic Box', price: 120, desc: 'Any non-legendary Pokémon from the National Pokédex.', odds: [['Non-legendary National Dex', 100, 'basic']], art: 52 },
  rare: { name: 'Rare Box', price: 350, desc: 'Strong, fully evolved Pokémon (base stat total 480+).', odds: [['BST 480+ non-legendary', 95, 'rare'], ['Legendary or Mythical', 5, 'legend']], art: 149, perfectIvs: 1 },
  master: { name: 'Master Box', price: 700, desc: 'High chance of a Legendary or Mythical Pokémon.', odds: [['Legendary or Mythical', 40, 'legend'], ['BST 480+ non-legendary', 40, 'rare'], ['Non-legendary National Dex', 20, 'basic']], art: 1007, perfectIvs: 2 },
};
for (const [k, n] of Object.entries(REGIONS)) BOXES[k] = { name: n + ' Box', price: 150, desc: 'A non-legendary Pokémon from ' + n + ' (No. ' + BOX_RANGES[k].join('–') + ').', odds: [[n + ' non-legendary', 100, k]], art: BOX_RANGES[k][0] + 3, region: true };
BOXES.outbreak = { name: 'Outbreak Box', price: 90, desc: 'Today\'s mass-outbreak species, with boosted shiny odds (1/64). Max 5 per day.', odds: [['Today\'s outbreak species', 100, 'outbreak']], daily: 5 };
export function rollBox(kind, rng, ctx = {}) {
  const box = BOXES[kind];
  let r = rng.next() * 100, sub = box.odds[box.odds.length - 1][2];
  for (const [, pct, s] of box.odds) { if (r < pct) { sub = s; break; } r -= pct; }
  const species = sub === 'outbreak' ? ctx.outbreak : rng.pick(boxPool(sub));
  return { species, sub };
}
export function boxLevel(kind, partyTop) { return Math.max(5, Math.min(100, Math.floor((partyTop || 10) * (kind === 'master' ? .9 : .75)))); }

// ---------- Daily content ----------
export function dailyOutbreak(key) {
  const r = dailyRng(key, 'outbreak');
  const p = pool(d => !isLegend(d) && !d.prevo && d.evos?.length);
  return p[r.int(p.length)];
}
export const MISSION_POOL = [
  { id: 'practice2', text: 'Win 2 practice battles', goal: 2, reward: 50, stat: 'practiceWins' },
  { id: 'super5', text: 'Land 5 super-effective hits', goal: 5, reward: 40, stat: 'superEffective' },
  { id: 'crit2', text: 'Land 2 critical hits', goal: 2, reward: 40, stat: 'crits' },
  { id: 'box1', text: 'Open a Pokémon box', goal: 1, reward: 40, stat: 'boxesOpened' },
  { id: 'tera1', text: 'Terastallize in battle', goal: 1, reward: 40, stat: 'teraUsed' },
  { id: 'status3', text: 'Use 3 status moves', goal: 3, reward: 30, stat: 'statusMoves' },
  { id: 'train1', text: 'Use a training item', goal: 1, reward: 30, stat: 'trainingItems' },
  { id: 'ko6', text: 'Knock out 6 Pokémon', goal: 6, reward: 60, stat: 'kos' },
  { id: 'daily2', text: 'Clear 2 daily battles', goal: 2, reward: 60, stat: 'dailyWins' },
  { id: 'damage', text: 'Deal 1,500 total damage', goal: 1500, reward: 50, stat: 'damageDealt' },
];
export function dailyMissions(key) {
  const r = dailyRng(key, 'missions');
  const pool2 = [...MISSION_POOL];
  const out = [];
  for (let i = 0; i < 3; i++) out.push({ ...pool2.splice(r.int(pool2.length), 1)[0], progress: 0, claimed: false });
  return out;
}
export const CHECKIN_REWARDS = [
  { day: 1, coins: 60, text: '60 coins' }, { day: 2, items: { potion: 3 }, text: '3 Potions' }, { day: 3, coins: 120, text: '120 coins' },
  { day: 4, items: { expcandym: 1 }, text: 'Exp. Candy M' }, { day: 5, coins: 180, text: '180 coins' }, { day: 6, items: { rarecandy: 2 }, text: '2 Rare Candies' },
  { day: 7, box: 'rare', text: 'Free Rare Box' },
];
export const DAILY_TIERS = {
  easy: { name: 'Warm-Up', size: 1, coins: 60, ai: 'easy', bst: [250, 420], levelOffset: -2, base: 100 },
  medium: { name: 'Rival Test', size: 2, coins: 110, ai: 'medium', bst: [400, 500], levelOffset: 0, base: 200 },
  hard: { name: 'Ace Challenge', size: 3, coins: 200, ai: 'hard', bst: [480, 600], levelOffset: 3, base: 400 },
  practice: { name: 'Practice', size: 1, coins: 25, ai: 'medium', bst: [250, 520], levelOffset: -1, base: 0 },
};
export const RIVAL_NAMES = ['Ace Trainer Mira', 'Rival Theo', 'Gym Trainer Ines', 'Veteran Kofi', 'Ace Trainer Rin', 'Battle Girl Ada', 'Scientist Pell', 'Rival Juno', 'Dragon Tamer Vey', 'Ace Trainer Sol'];
export function buildTrainer(tier, key, partyTop) {
  const t = DAILY_TIERS[tier];
  const r = tier === 'practice' ? makeRng(Math.floor(Math.random() * 2 ** 32)) : dailyRng(key, tier);
  const level = Math.max(5, Math.min(100, (partyTop || 10) + t.levelOffset + (tier === 'practice' ? r.int(3) - 1 : 0)));
  const sunday = new Date(key + 'T12:00:00').getDay() === 0;
  let candidates = pool(d => !isLegend(d) && bst(d) >= t.bst[0] && bst(d) <= t.bst[1] && (level >= 30 || !d.evos || bst(d) < 500));
  const team = [];
  for (let i = 0; i < t.size; i++) {
    let species = r.pick(candidates);
    if (tier === 'hard' && i === t.size - 1 && sunday) species = r.pick(boxPool('legend'));
    const p = generatePokemon(species, level + (tier === 'hard' && i === t.size - 1 ? 2 : 0), { rng: r, noMark: true, shinyRate: 1 / 512, perfectIvs: tier === 'hard' ? 3 : tier === 'medium' ? 1 : 0, origin: 'trainer' });
    p.moves = buildAiMoves(species, p.level, { useTms: tier === 'hard', rng: r });
    if (tier !== 'easy') { const spread = Math.min(510, level * 6); const best = G.dex[species].bs[1] > G.dex[species].bs[3] ? 'atk' : 'spa'; p.evs[best] = Math.min(252, spread / 2); p.evs.spe = Math.min(252, spread / 2); }
    if (tier === 'hard') p.item = r.pick(['leftovers', 'lifeorb', 'sitrusberry', 'expertbelt', 'focussash', 'choicescarf', 'rockyhelmet', 'weaknesspolicy']);
    if (tier === 'medium' && r.next() < .5) p.item = r.pick(['oranberry', 'sitrusberry', 'leftovers']);
    team.push(p);
  }
  return { name: tier === 'practice' ? 'Practice Partner' : RIVAL_NAMES[r.int(RIVAL_NAMES.length)], team, level, sunday: tier === 'hard' && sunday };
}
export function battleScore(tier, won, { turns, hpLeftPct, fainted }) {
  if (!won) return 0;
  const base = DAILY_TIERS[tier].base;
  return Math.round(base + base * 0.5 * hpLeftPct + Math.max(0, 12 - turns) * base * 0.03 - fainted * base * 0.1);
}

// ---------- Medals (achievements) ----------
export const MEDALS = [
  { id: 'firstwin', name: 'First Victory', desc: 'Win your first battle.', test: s => s.wins >= 1, reward: 50 },
  { id: 'wins25', name: 'Seasoned Trainer', desc: 'Win 25 battles.', test: s => s.wins >= 25, reward: 150 },
  { id: 'wins100', name: 'Battle Veteran', desc: 'Win 100 battles.', test: s => s.wins >= 100, reward: 500 },
  { id: 'dex10', name: 'Field Researcher', desc: 'Own 10 species.', test: s => s.ownedDex.length >= 10, reward: 100 },
  { id: 'dex50', name: 'Pokédex Scholar', desc: 'Own 50 species.', test: s => s.ownedDex.length >= 50, reward: 400 },
  { id: 'dex151', name: 'Professor\'s Pride', desc: 'Own 151 species.', test: s => s.ownedDex.length >= 151, reward: 1500 },
  { id: 'shiny1', name: 'Something Sparkles', desc: 'Obtain a shiny Pokémon.', test: s => s.shinyDex.length >= 1, reward: 300 },
  { id: 'shiny5', name: 'Shiny Hunter', desc: 'Obtain 5 shiny species.', test: s => s.shinyDex.length >= 5, reward: 1000 },
  { id: 'mark1', name: 'Marked for Greatness', desc: 'Obtain a Pokémon with a mark.', test: s => s.box.some(p => p.mark), reward: 100 },
  { id: 'raremark', name: 'The Recluse', desc: 'Obtain a Pokémon with the Rare Mark.', test: s => s.box.some(p => p.marks?.includes('rare')), reward: 1000 },
  { id: 'evolve1', name: 'Growing Up', desc: 'Evolve a Pokémon.', test: s => s.stats.evolutions >= 1, reward: 100 },
  { id: 'evolve10', name: 'Metamorphosis', desc: 'Evolve 10 Pokémon.', test: s => s.stats.evolutions >= 10, reward: 400 },
  { id: 'lv50', name: 'Halfway There', desc: 'Raise a Pokémon to level 50.', test: s => s.box.some(p => p.level >= 50), reward: 300 },
  { id: 'lv100', name: 'Peak Performance', desc: 'Raise a Pokémon to level 100.', test: s => s.box.some(p => p.level >= 100), reward: 1500 },
  { id: 'streak7', name: 'Creature of Habit', desc: 'Check in 7 days in a row.', test: s => s.checkin.best >= 7, reward: 300 },
  { id: 'streak30', name: 'Devoted', desc: 'Check in 30 days in a row.', test: s => s.checkin.best >= 30, reward: 1500 },
  { id: 'sweep1', name: 'Daily Sweep', desc: 'Win all three daily battles in one day.', test: s => s.stats.dailySweeps >= 1, reward: 200 },
  { id: 'sweep10', name: 'Unstoppable', desc: 'Achieve 10 daily sweeps.', test: s => s.stats.dailySweeps >= 10, reward: 1000 },
  { id: 'perfect', name: 'Flawless Genes', desc: 'Own a Pokémon with six "Best" IVs.', test: s => s.box.some(p => STATS.every(k => p.ivs[k] === 31)), reward: 1500 },
  { id: 'evmax', name: 'Effort Pays Off', desc: 'Reach 510 total EVs on a Pokémon.', test: s => s.box.some(p => STATS.reduce((a, k) => a + (p.evs[k] || 0), 0) >= 510), reward: 300 },
  { id: 'tera', name: 'Crystal Clear', desc: 'Win a battle after Terastallizing.', test: s => s.stats.teraWins >= 1, reward: 100 },
];

// ---------- Trainer score ----------
export function trainerScore(s) {
  const best = s.box.reduce((m, p) => Math.max(m, p.level), 0);
  return s.wins * 10 + s.ownedDex.length * 25 + s.shinyDex.length * 200 + s.box.filter(p => p.mark).length * 50 + best * 5 + (s.checkin.best || 0) * 20 + (s.stats.dailySweeps || 0) * 100 + Object.keys(s.medals || {}).length * 30;
}

// ---------- Save format ----------
export const SAVE_VERSION = 2;
export function defaultSave() {
  return {
    version: SAVE_VERSION, createdAt: new Date().toISOString(), trainerName: '', avatar: 25, coins: 300, starterChosen: false, starterId: null,
    box: [], party: [], inventory: { potion: 3, superpotion: 1, expcandys: 1 }, keyItems: { expshare: true },
    dailyDate: todayKey(), daily: { easy: null, medium: null, hard: null }, outbreak: { date: '', opened: 0 },
    checkin: { last: '', streak: 0, best: 0 }, missions: { date: '', list: [], bonus: false },
    wins: 0, battles: 0, practiceCount: 0, ownedDex: [], seenDex: [], shinyDex: [], medals: {}, showcase: [],
    stats: { kos: 0, superEffective: 0, crits: 0, boxesOpened: 0, evolutions: 0, dailySweeps: 0, teraWins: 0, damageDealt: 0, statusMoves: 0, trainingItems: 0, teraUsed: 0, practiceWins: 0, dailyWins: 0 },
    dayStats: { date: '', values: {} }, history: [], dailyScores: {},
    ledger: { start: 300, earned: 0, spent: 0, expGranted: 0, pokemonGranted: 0, practiceCoins: { date: '', wins: 0 } },
    integrity: { status: 'ok', reasons: [] },
    settings: { animations: true, reducedEffects: false, battleSpeed: 1, showDamage: true },
    lastActive: '',
  };
}
const num = (v, d = 0, min = 0, max = Infinity) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d; };
function cleanInstance(p) {
  if (!p || typeof p !== 'object' || !G.dex[p.species]) return null;
  const sp = G.dex[p.species];
  const out = { ...p };
  out.uid = String(p.uid || uid()).slice(0, 40);
  out.level = Math.round(num(p.level, 5, 1, 100));
  out.exp = Math.round(num(p.exp, expForLevel(sp.gr, out.level), 0));
  if (out.exp < expForLevel(sp.gr, out.level)) out.exp = expForLevel(sp.gr, out.level);
  out.ivs = {}; out.evs = {};
  for (const k of STATS) { out.ivs[k] = Math.round(num(p.ivs?.[k], 15, 0, 31)); out.evs[k] = Math.round(num(p.evs?.[k], 0, 0, 252)); }
  let total = STATS.reduce((a, k) => a + out.evs[k], 0);
  if (total > EV_TOTAL) for (const k of STATS) out.evs[k] = Math.floor(out.evs[k] * EV_TOTAL / total);
  out.nature = NATURES[p.nature] ? p.nature : 'hardy';
  out.mint = NATURES[p.mint] ? p.mint : null;
  out.moves = (Array.isArray(p.moves) ? p.moves : []).filter(m => G.moves[m]).slice(0, 4);
  if (!out.moves.length) out.moves = defaultMoves(p.species, out.level);
  out.learned = (Array.isArray(p.learned) ? p.learned : []).filter(m => G.moves[m]);
  out.marks = (Array.isArray(p.marks) ? p.marks : []).filter(m => MARKS[m]);
  out.mark = MARKS[p.mark] ? p.mark : (out.marks[0] || null);
  out.teraType = TYPES.includes(p.teraType) ? p.teraType : sp.types[0];
  out.item = p.item && I[p.item] ? p.item : null;
  out.hyper = typeof p.hyper === 'object' && p.hyper ? p.hyper : {};
  out.friendship = Math.round(num(p.friendship, 70, 0, 255));
  out.size = Math.round(num(p.size, 128, 0, 255));
  out.shiny = !!p.shiny;
  out.gender = ['M', 'F', 'N'].includes(p.gender) ? p.gender : 'N';
  out.abilitySlot = sp.ab[p.abilitySlot] ? p.abilitySlot : '0';
  out.ability = toId(sp.ab[out.abilitySlot]);
  out.nickname = String(p.nickname || '').slice(0, 12);
  out.battles = Math.round(num(p.battles)); out.wins = Math.round(num(p.wins));
  return out;
}
// Accepts v1 (ChatGPT prototype) and v2 saves. Returns null if unusable.
export function migrateSave(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = defaultSave();
  if (raw.version === 1) {
    const box = [];
    for (const e of Array.isArray(raw.party) ? raw.party : []) {
      const species = G.numToId[Number(e.pokemonId)];
      if (!species) continue;
      const p = generatePokemon(species, Math.round(num(e.level, 10, 1, 100)), { rng: makeRng(hashString(String(e.uid))), uid: String(e.uid), origin: Number(e.pokemonId) === Number(raw.starterId) ? 'starter' : 'migrated', noMark: true });
      box.push(p);
    }
    const sel = String(raw.selectedId || '');
    const party = box.map(p => p.uid).sort((a, b) => (b === sel) - (a === sel)).slice(0, 6);
    const inv = { ...base.inventory };
    if (raw.inventory) { inv.potion = num(raw.inventory.potion, 0); if (raw.inventory.candy) inv.expcandys = (inv.expcandys || 0) + num(raw.inventory.candy); if (raw.inventory.ball) inv.pokeball = num(raw.inventory.ball); }
    raw = { ...base, coins: num(raw.coins, 250), starterChosen: !!raw.starterChosen && box.length > 0, starterId: raw.starterId ?? null, box, party, inventory: inv,
      dailyDate: raw.dailyDate || base.dailyDate, daily: { ...base.daily, ...(raw.daily || {}) }, wins: num(raw.wins), battles: num(raw.battles), practiceCount: num(raw.practiceCount),
      ownedDex: raw.ownedDex || [], settings: { ...base.settings, ...(raw.settings || {}) }, lastActive: raw.lastActive || '', migratedFrom: 1,
      ledger: { ...base.ledger, start: num(raw.coins, 250), pokemonGranted: box.length } };
  }
  if (raw.version !== 1 && raw.version !== SAVE_VERSION && raw.migratedFrom !== 1) return null;
  const s = { ...base, ...raw, version: SAVE_VERSION };
  s.box = (Array.isArray(raw.box) ? raw.box : []).map(cleanInstance).filter(Boolean);
  const uids = new Set(s.box.map(p => p.uid));
  s.party = [...new Set((Array.isArray(raw.party) ? raw.party : []).map(String).filter(u => uids.has(u)))].slice(0, 6);
  if (!s.party.length && s.box.length) s.party = s.box.slice(0, 6).map(p => p.uid);
  s.coins = Math.round(num(raw.coins, base.coins));
  s.inventory = {};
  for (const [k, v] of Object.entries(raw.inventory || {})) if (I[k] && num(v) > 0) s.inventory[k] = Math.round(num(v, 0, 0, 9999));
  s.keyItems = { ...base.keyItems, ...(raw.keyItems || {}) };
  s.daily = { ...base.daily, ...(raw.daily || {}) };
  s.stats = { ...base.stats, ...(raw.stats || {}) };
  for (const k of Object.keys(s.stats)) s.stats[k] = num(s.stats[k]);
  s.checkin = { ...base.checkin, ...(raw.checkin || {}) };
  s.missions = { ...base.missions, ...(raw.missions || {}) };
  s.outbreak = { ...base.outbreak, ...(raw.outbreak || {}) };
  s.settings = { ...base.settings, ...(raw.settings || {}) };
  s.medals = typeof raw.medals === 'object' && raw.medals ? raw.medals : {};
  s.dayStats = raw.dayStats && typeof raw.dayStats === 'object' ? raw.dayStats : base.dayStats;
  for (const k of ['ownedDex', 'seenDex', 'shinyDex']) s[k] = [...new Set((Array.isArray(raw[k]) ? raw[k] : []).map(Number).filter(n => n > 0 && n <= 1025))];
  for (const p of s.box) { const n = G.dex[p.species].num; if (!s.ownedDex.includes(n)) s.ownedDex.push(n); if (p.shiny && !s.shinyDex.includes(n)) s.shinyDex.push(n); }
  s.showcase = (Array.isArray(raw.showcase) ? raw.showcase : []).filter(u => uids.has(u)).slice(0, 3);
  s.ledger = { ...base.ledger, ...(raw.ledger || {}) };
  for (const k of ['start', 'earned', 'spent', 'expGranted', 'pokemonGranted']) s.ledger[k] = num(s.ledger[k]);
  if (!raw.ledger) {
    // Pre-protection save: adopt its current state as the baseline.
    s.ledger = { ...base.ledger, start: s.coins, pokemonGranted: s.box.length };
    s.box.forEach(adoptLegacyPokemon);
    s.legacyAdopted = true;
  }
  s.integrity = raw.integrity && typeof raw.integrity === 'object' ? { status: raw.integrity.status || 'ok', reasons: Array.isArray(raw.integrity.reasons) ? raw.integrity.reasons.slice(0, 12).map(String) : [], since: raw.integrity.since } : { ...base.integrity };
  s.history = (Array.isArray(raw.history) ? raw.history : []).slice(-30);
  s.wins = num(raw.wins); s.battles = num(raw.battles); s.practiceCount = num(raw.practiceCount);
  s.trainerName = String(raw.trainerName || '').replace(/[<>]/g, '').slice(0, 16);
  s.avatar = Math.round(num(raw.avatar, 25, 1, 1025));
  s.starterChosen = !!raw.starterChosen && s.box.length > 0;
  return s;
}

// ---------- Integrity audit ----------
// Generous plausibility checks. A failed check never deletes anything; the save
// is just marked unranked. Caps are set well above what legitimate play earns.
export const RELEASE_EPOCH = Date.parse('2026-10-28T00:00:00Z');
export const DAILY_COIN_CAP = 3000;        // check-in + missions + daily battles (x2 Amulet Coin) + capped practice
export const PRACTICE_COIN_WINS = 30;      // practice wins per day that still pay coins
export const MEDAL_TOTAL = () => MEDALS.reduce((a, m) => a + m.reward, 0);
export function levelForExp(rate, exp) { let l = 1; while (l < 100 && expForLevel(rate, l + 1) <= exp) l++; return l; }
// Gives older (pre-protection) Pokémon a lineage and signature, keeping their current state.
export function adoptLegacyPokemon(p) {
  if (!p.line) p.line = familyRoot(p.species);
  if (p.exp0 === undefined) p.exp0 = p.exp;
  return signPokemon(p);
}
export function auditSave(s, now = Date.now()) {
  const issues = [];
  const L = s.ledger || {};
  if (s.coins !== (L.start || 0) + (L.earned || 0) - (L.spent || 0)) issues.push('Coin balance does not match the coin ledger.');
  const born = Math.max(Date.parse(s.createdAt) || now, RELEASE_EPOCH);
  const days = Math.max(1, Math.floor((now - born) / 864e5) + 1);
  if ((L.earned || 0) > MEDAL_TOTAL() + days * DAILY_COIN_CAP) issues.push('More coins were earned than the game can pay out in ' + days + ' day(s).');
  if ((L.start || 0) > 20000) issues.push('Starting coin balance is implausible.');
  const seen = new Set();
  let expGained = 0, shinies = 0;
  for (const p of s.box || []) {
    const n = G.dex[p.species]?.name || p.species;
    if (seen.has(p.uid)) issues.push(n + ' is a duplicate of another Pokémon.');
    seen.add(p.uid);
    if (!verifyPokemon(p)) issues.push(n + ' failed its signature check (edited IVs, nature, shiny or origin).');
    else if (familyRoot(p.species) !== p.line) issues.push(n + ' does not belong to its original evolution line.');
    if (expForLevel(G.dex[p.species]?.gr || 2, p.level) > p.exp) issues.push(n + "'s level is higher than its Exp. Points allow.");
    expGained += Math.max(0, p.exp - (p.exp0 || 0));
    if (p.shiny) shinies++;
  }
  if (expGained > (L.expGranted || 0) + 1) issues.push('Pokémon have more Exp. Points than were ever earned.');
  if ((s.box || []).length > (L.pokemonGranted || 0)) issues.push('More Pokémon than were ever obtained.');
  if (shinies > 3 + (L.pokemonGranted || 0) / 10) issues.push('Implausibly many shiny Pokémon for the number obtained.');
  if ((s.wins || 0) > (s.battles || 0)) issues.push('More wins than battles.');
  for (const v of Object.values(s.dailyScores || {})) if (v > 1400) { issues.push('A daily score is above the maximum possible.'); break; }
  return [...new Set(issues)];
}
