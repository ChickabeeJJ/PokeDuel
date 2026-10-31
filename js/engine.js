// PokeDuel battle engine — singles, DOM-free and deterministic for a given seed.
//
// Mechanics follow Pokémon Showdown's Gen 9 implementation (damage formula with
// 4096-based modifier chains, rounding order, crit stages, stat stages, status,
// weather/terrain, hazards, screens, Terastallization) with the Pokémon
// Champions balance layer applied in /data/moves.json and in the status rules
// below (paralysis 1/8 full-para chance, sleep 2–3 turns, freeze thaws within
// 3 turns). Moves whose special behaviour is not simulated are reported by
// moveSupport() so the UI can label them honestly.

const D = { moves: {}, dex: {}, abilities: {} };
export function setData({ moves, dex, abilities }) { if (moves) D.moves = moves; if (dex) D.dex = dex; if (abilities) D.abilities = abilities; }
export const data = D;

export const toId = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
const CHART = {
  Normal: { Rock: .5, Ghost: 0, Steel: .5 },
  Fire: { Fire: .5, Water: .5, Grass: 2, Ice: 2, Bug: 2, Rock: .5, Dragon: .5, Steel: 2 },
  Water: { Fire: 2, Water: .5, Grass: .5, Ground: 2, Rock: 2, Dragon: .5 },
  Electric: { Water: 2, Electric: .5, Grass: .5, Ground: 0, Flying: 2, Dragon: .5 },
  Grass: { Fire: .5, Water: 2, Grass: .5, Poison: .5, Ground: 2, Flying: .5, Bug: .5, Rock: 2, Dragon: .5, Steel: .5 },
  Ice: { Fire: .5, Water: .5, Grass: 2, Ice: .5, Ground: 2, Flying: 2, Dragon: 2, Steel: .5 },
  Fighting: { Normal: 2, Ice: 2, Poison: .5, Flying: .5, Psychic: .5, Bug: .5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: .5 },
  Poison: { Grass: 2, Poison: .5, Ground: .5, Rock: .5, Ghost: .5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: .5, Poison: 2, Flying: 0, Bug: .5, Rock: 2, Steel: 2 },
  Flying: { Electric: .5, Grass: 2, Fighting: 2, Bug: 2, Rock: .5, Steel: .5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: .5, Dark: 0, Steel: .5 },
  Bug: { Fire: .5, Grass: 2, Fighting: .5, Poison: .5, Flying: .5, Psychic: 2, Ghost: .5, Dark: 2, Steel: .5, Fairy: .5 },
  Rock: { Fire: 2, Ice: 2, Fighting: .5, Ground: .5, Flying: 2, Bug: 2, Steel: .5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: .5 },
  Dragon: { Dragon: 2, Steel: .5, Fairy: 0 },
  Dark: { Fighting: .5, Psychic: 2, Ghost: 2, Dark: .5, Fairy: .5 },
  Steel: { Fire: .5, Water: .5, Electric: .5, Ice: 2, Rock: 2, Steel: .5, Fairy: 2 },
  Fairy: { Fire: .5, Fighting: 2, Poison: .5, Dragon: 2, Dark: 2, Steel: .5 },
};
export function typeMult(atk, def) { const v = CHART[atk]?.[def]; return v === undefined ? 1 : v; }
export function effectiveness(moveType, defTypes) { return defTypes.reduce((m, t) => m * typeMult(moveType, t), 1); }

export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_NAMES = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', accuracy: 'accuracy', evasion: 'evasiveness' };
export const NATURES = {
  hardy: [], lonely: ['atk', 'def'], brave: ['atk', 'spe'], adamant: ['atk', 'spa'], naughty: ['atk', 'spd'],
  bold: ['def', 'atk'], docile: [], relaxed: ['def', 'spe'], impish: ['def', 'spa'], lax: ['def', 'spd'],
  timid: ['spe', 'atk'], hasty: ['spe', 'def'], serious: [], jolly: ['spe', 'spa'], naive: ['spe', 'spd'],
  modest: ['spa', 'atk'], mild: ['spa', 'def'], quiet: ['spa', 'spe'], bashful: [], rash: ['spa', 'spd'],
  calm: ['spd', 'atk'], gentle: ['spd', 'def'], sassy: ['spd', 'spe'], careful: ['spd', 'spa'], quirky: [],
};

// Mainline (Gen 3+) stat formula with IVs, EVs and nature.
export function calcStats(sp, level, ivs = {}, evs = {}, nature = 'hardy') {
  const out = {};
  const [plus, minus] = NATURES[nature] || [];
  STATS.forEach((s, i) => {
    const base = sp.bs[i], iv = ivs[s] ?? 31, ev = evs[s] ?? 0;
    const core = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100);
    if (s === 'hp') { out.hp = sp.num === 292 ? 1 : core + level + 10; return; }
    let v = core + 5;
    if (plus === s) v = Math.floor(v * 110 / 100);
    if (minus === s) v = Math.floor(v * 90 / 100);
    out[s] = v;
  });
  return out;
}

// ---------- RNG (mulberry32) ----------
export function makeRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next, int: (n, m) => (m === undefined ? Math.floor(next() * n) : n + Math.floor(next() * (m - n))),
    chance: (num, den) => next() * den < num, pick: arr => arr[Math.floor(next() * arr.length)],
    state: () => a, setState: s => { a = s; },
  };
}
export function hashString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- 4096-based modifiers (Showdown semantics) ----------
const tr = Math.trunc;
export function modify(value, num, den = 1) { const m = tr(num * 4096 / den); return tr((tr(value * m) + 2048 - 1) / 4096); }
class Chain { constructor() { this.v = 4096; } mul(n, d = 1) { const m = tr(n * 4096 / d); this.v = (this.v * m + 2048) >> 12; return this; } apply(x) { return tr((tr(x * this.v) + 2048 - 1) / 4096); } }
const BOOST_TABLE = [1, 1.5, 2, 2.5, 3, 3.5, 4];
function boosted(stat, b) { return b >= 0 ? Math.floor(stat * BOOST_TABLE[b]) : Math.floor(stat / BOOST_TABLE[-b]); }

// ---------- Support tables (what the engine simulates) ----------
export const ABILITY_SUPPORT = new Set(('intimidate drizzle drought sandstream snowwarning electricsurge grassysurge psychicsurge mistysurge ' +
  'levitate flashfire waterabsorb voltabsorb dryskin stormdrain lightningrod sapsipper motordrive eartheater wellbakedbody wonderguard bulletproof soundproof overcoat goodasgold ' +
  'thickfat heatproof waterbubble purifyingsalt fluffy icescales multiscale shadowshield filter solidrock prismarmor furcoat marvelscale sturdy battlearmor shellarmor ' +
  'clearbody whitesmoke fullmetalbody hypercutter keeneye bigpecks innerfocus owntempo oblivious scrappy insomnia vitalspirit sweetveil limber immunity pastelveil waterveil ' +
  'thermalexchange magmaarmor leafguard shielddust unaware magicguard rockhead simple contrary defiant competitive justified rattled steadfast weakarmor stamina angerpoint moxie ' +
  'beastboost chillingneigh grimneigh speedboost regenerator naturalcure shedskin hydration poisonheal guts quickfeet hugepower purepower hustle technician adaptability ironfist ' +
  'strongjaw megalauncher sharpness toughclaws sheerforce reckless punkrock steelworker transistor dragonsmaw rockypayload gorillatactics solarpower sandforce tintedlens sniper ' +
  'superluck compoundeyes noguard serenegrace skilllink blaze torrent overgrow swarm pixilate aerilate refrigerate galvanize normalize prankster galewings triage swiftswim ' +
  'chlorophyll sandrush slushrush unburden static flamebody poisonpoint effectspore roughskin ironbarbs gooey tanglinghair aftermath poisontouch moldbreaker teravolt turboblaze ' +
  'infiltrator sandveil snowcloak raindish icebody pressure defeatist intrepidsword dauntlessshield protosynthesis quarkdrive orichalcumpulse hadronengine armortail queenlymajesty ' +
  'dazzling libero protean download sturdy runaway').split(' '));
export const ITEM_SUPPORT = new Set(('leftovers blacksludge lifeorb choiceband choicespecs choicescarf focussash sitrusberry oranberry lumberry chestoberry expertbelt assaultvest ' +
  'rockyhelmet muscleband wiseglasses charcoal mysticwater miracleseed magnet nevermeltice blackbelt poisonbarb softsand sharpbeak twistedspoon silverpowder hardstone spelltag ' +
  'dragonfang blackglasses metalcoat silkscarf fairyfeather eviolite shellbell quickclaw scopelens razorclaw widelens kingsrock razorfang lightclay heavydutyboots airballoon ' +
  'weaknesspolicy whiteherb flameorb toxicorb luckyegg powerweight powerbracer powerbelt powerlens powerband poweranklet machobrace brightpowder covertcloak clearamulet boosterenergy ' +
  'loadeddice punchingglove safetygoggles damprock heatrock smoothrock icyrock bindingband bigroot protectivepads').split(' '));
const MOVE_HANDLED = new Set(('acrobatics assurance avalanche revenge boltbeak fishiousrend crushgrip wringout dragonenergy eruption waterspout electroball gyroball flail reversal ' +
  'frustration return grassknot lowkick heatcrash heavyslam hex infernalparade lastrespects payback powertrip storedpower punishment ragefist risingvoltage stompingtantrum temperflare ' +
  'tripleaxel triplekick watershuriken wakeupslap smellingsalts hardpress furycutter terablast ficklebeam brine facade knockoff venoshock barbbarrage collisioncourse electrodrift ' +
  'expandingforce gravapple lashout mistyexplosion psyblade retaliate solarbeam solarblade superfang naturesmadness ruination finalgambit endeavor counter mirrorcoat metalburst comeuppance ' +
  'psywave fly bounce dig dive phantomforce shadowforce skullbash skyattack meteorbeam electroshot freezeshock iceburn razorwind geomancy burnup doubleshock fakeout firstimpression ' +
  'suckerpunch thunderclap upperhand rest snore sleeptalk clangoroussoul filletaway bellydrum noretreat auroraveil followme ragepowder teleport clearsmog haze defog rapidspin mortalspin ' +
  'tidyup courtchange painsplit morningsun moonlight synthesis shoreup strengthsap purify refresh healbell aromatherapy psychup topsyturvy curse destinybond protect detect kingsshield ' +
  'spikyshield banefulbunker silktrap obstruct burningbulwark endure substitute trick switcheroo thief covet bugbite pluck incinerate partingshot yawn perishsong roost block meanlook ' +
  'spiderweb soak magicpowder metronome acupressure venomdrench speedswap guardsplit powersplit heartswap powerswap guardswap takeheart junglehealing lunarblessing steelroller icespinner ' +
  'stoneaxe ceaselessedge thousandwaves anchorshot spiritshackle saltcure direclaw triattack alluringvoice burningjealousy eeriespell weatherball terrainpulse hiddenpower judgment ' +
  'multiattack technoblast revelationdance brickbreak psychicfangs ragingbull freezedry flyingpress thousandarrows hurricane thunder blizzard growth photongeyser struggle sandsearstorm ' +
  'wildboltstorm bleakwindstorm highjumpkick jumpkick supercellslam axekick mindblown steelbeam grassyglide poltergeist fellstinger sparklingaria wish healingwish lunardance shedtail ' +
  'chillyreception batonpass lockon mindreader encore disable taunt torment attract gastroacid focuspunch smackdown worryseed simplebeam entrainment throatchop autotomize ' +
  // Correct in singles: these need an ally and fail, or are handled by generic data.
  'leechseed magnetrise miracleeye foresight odorsleuth splash celebrate octolock shellsidearm helpinghand afteryou allyswitch spotlight ' +
  'falseswipe holdback dreameater synchronoise').split(' '));
export function moveSupport(id) {
  const m = D.moves[id];
  if (!m) return 'unknown';
  if (!m.cb || MOVE_HANDLED.has(id)) return 'full';
  return 'partial';
}

// ---------- Battle construction ----------
const SIDE_NAMES = { p: 'Your', e: 'The opposing' };
export function createMon(set, sideId, idx) {
  const sp = D.dex[set.species];
  if (!sp) throw new Error('Unknown species ' + set.species);
  const stats = calcStats(sp, set.level, set.ivs, set.evs, set.nature);
  const moves = (set.moves || []).filter(id => D.moves[id]).slice(0, 4).map(id => ({ id, pp: D.moves[id].pp, maxpp: D.moves[id].pp }));
  if (!moves.length) moves.push({ id: 'tackle', pp: 35, maxpp: 35 });
  return {
    uid: set.uid || sideId + idx, side: sideId, idx, species: set.species, name: set.nickname || sp.name, num: sp.num, level: set.level,
    gender: set.gender || 'N', shiny: !!set.shiny, baseTypes: [...sp.types], types: [...sp.types], teraType: set.teraType || sp.types[0],
    terastallized: false, ability: toId(set.ability), baseAbility: toId(set.ability), item: set.item ? toId(set.item) : null, nature: set.nature,
    ivs: set.ivs || {}, stats, maxhp: stats.hp, hp: stats.hp, status: null, statusState: {}, boosts: zeroBoosts(), volatiles: {}, moves,
    lastMove: null, lastMoveFailed: false, activeTurns: 0, weight: sp.wt, fainted: false, timesHit: 0, friendship: set.friendship ?? 255,
    hasEvo: !!sp.evos?.length, usedItem: null, switchedThisTurn: false,
  };
}
function zeroBoosts() { return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }; }

export function createBattle({ player, enemy, seed = Date.now(), ai = 'medium', allowTera = true, label = '' }) {
  const b = {
    rng: makeRng(seed), turn: 1, events: [], ended: false, winner: null, ai, allowTera, label,
    field: { weather: null, weatherTurns: 0, terrain: null, terrainTurns: 0, trickRoom: 0, gravity: 0 },
    sides: {}, queue: [], request: null, pendingEnemySwitch: null, turnState: {}, stats: { superEffective: 0, crits: 0, damageDealt: 0, kos: 0, statusMoves: 0, teraUsed: 0 },
  };
  for (const [id, cfg] of [['p', player], ['e', enemy]]) {
    b.sides[id] = { id, name: cfg.name || (id === 'p' ? 'You' : 'Rival'), team: cfg.team.map((s, i) => createMon(s, id, i)), active: 0, cond: {}, teraUsed: !allowTera, slot: {} };
  }
  b.sides.p.foe = b.sides.e; b.sides.e.foe = b.sides.p;
  for (const m of b.sides.e.team) m.seenBy = new Set();
  push(b, { t: 'start' });
  switchIn(b, b.sides.p, 0, true);
  switchIn(b, b.sides.e, 0, true);
  const order = speedOrder(b, [active(b, 'p'), active(b, 'e')]);
  for (const m of order) onSwitchInEffects(b, m);
  b.request = moveRequest(b);
  return b;
}
export function active(b, sideId) { const s = b.sides[sideId]; return s.team[s.active]; }
function foeOf(b, mon) { return active(b, mon.side === 'p' ? 'e' : 'p'); }
function sideOf(b, mon) { return b.sides[mon.side]; }
function name(mon) { return mon.side === 'e' ? 'the opposing ' + mon.name : mon.name; }
function Name(mon) { const n = name(mon); return n[0].toUpperCase() + n.slice(1); }
function push(b, ev) { b.events.push(ev); }
function msg(b, text, extra) { push(b, { t: 'msg', text, ...extra }); }
function hpEvent(b, mon, kind, amount, extra) { push(b, { t: kind, side: mon.side, idx: mon.idx, hp: mon.hp, maxhp: mon.maxhp, amount, ...extra }); }

// ---------- Request / actions ----------
function moveRequest(b) {
  const mon = active(b, 'p');
  const locked = mon.volatiles.lockedmove || mon.volatiles.twoturnmove || mon.volatiles.mustrecharge;
  const moves = mon.moves.map((m, i) => ({ index: i, id: m.id, name: D.moves[m.id].name, type: moveTypeFor(b, mon, D.moves[m.id], m.id), pp: m.pp, maxpp: m.maxpp, disabled: !canSelect(b, mon, m) }));
  const trapped = isTrapped(b, mon);
  return { type: 'move', moves, locked: !!locked, canTera: !sideOf(b, mon).teraUsed && !mon.terastallized, teraType: mon.teraType, trapped, switches: benchIndexes(b, 'p'), struggle: moves.every(m => m.disabled) };
}
function benchIndexes(b, sideId) { const s = b.sides[sideId]; return s.team.map((m, i) => i).filter(i => i !== s.active && !s.team[i].fainted); }
function canSelect(b, mon, slot) {
  const m = D.moves[slot.id];
  if (slot.pp <= 0) return false;
  if (mon.volatiles.taunt && m.cat === 'Status') return false;
  if (mon.volatiles.disable?.move === slot.id) return false;
  if (mon.volatiles.encore && mon.volatiles.encore.move !== slot.id) return false;
  if (mon.volatiles.choicelock && mon.volatiles.choicelock !== slot.id) return false;
  if (mon.item === 'assaultvest' && m.cat === 'Status') return false;
  if (mon.volatiles.torment && mon.lastMove === slot.id) return false;
  if (m.flags?.includes('cantusetwice') && mon.lastMove === slot.id) return false;
  if ((slot.id === 'fakeout' || slot.id === 'firstimpression') && mon.activeTurns > 1) return false;
  if (mon.volatiles.throatchop && m.flags?.includes('sound')) return false;
  return true;
}
function isTrapped(b, mon) {
  if (mon.types.includes('Ghost')) return false;
  return !!(mon.volatiles.partiallytrapped || mon.volatiles.trapped || mon.volatiles.ingrain || mon.volatiles.noretreat || mon.volatiles.octolock);
}
export function getRequest(b) { return b.request; }

// action: {type:'move', index, tera} | {type:'switch', index} | {type:'item', item:{name, heal, cure, revive, boosts}, target}
export function submitAction(b, action) {
  const start = b.events.length;
  if (b.ended) return [];
  const req = b.request;
  if (req?.type === 'switch') {
    if (action.type !== 'switch' || !benchIndexes(b, 'p').includes(action.index)) throw new Error('A switch is required');
    b.request = null;
    if (req.reason === 'pivot') {
      const pivot = req.pivot;
      doSwitch(b, b.sides.p, action.index, pivot);
      continueTurn(b);
    } else {
      switchIn(b, b.sides.p, action.index);
      const ins = [active(b, 'p')];
      if (b.pendingEnemySwitch !== null) { switchIn(b, b.sides.e, b.pendingEnemySwitch); ins.push(active(b, 'e')); b.pendingEnemySwitch = null; }
      for (const m of speedOrder(b, ins)) onSwitchInEffects(b, m);
      if (!checkEnd(b)) startNextTurn(b);
    }
    return b.events.slice(start);
  }
  if (action.type === 'move' && req.struggle) action = { type: 'move', index: -1 };
  if (action.type === 'move' && action.index >= 0 && !req.moves[action.index] ) throw new Error('Bad move');
  if (action.type === 'move' && action.index >= 0 && req.moves[action.index].disabled && !req.locked) throw new Error('Move unavailable');
  if (action.type === 'switch' && (req.trapped || !req.switches.includes(action.index))) throw new Error('Cannot switch');
  b.turnState = { moved: {}, damagedBy: {}, hitThisTurn: {}, statsLowered: {}, actions: {} };
  push(b, { t: 'turn', turn: b.turn });
  const pAct = normaliseAction(b, 'p', action);
  const eAct = normaliseAction(b, 'e', chooseAI(b));
  b.turnState.actions = { p: pAct, e: eAct };
  // Terastallization happens before any action, faster Pokémon first.
  for (const m of speedOrder(b, [active(b, 'p'), active(b, 'e')])) {
    const a = b.turnState.actions[m.side];
    if (a.tera && !sideOf(b, m).teraUsed && !m.terastallized) terastallize(b, m);
  }
  b.queue = orderActions(b, [pAct, eAct]);
  continueTurn(b);
  return b.events.slice(start);
}
function normaliseAction(b, side, a) {
  const mon = active(b, side);
  if (a.type === 'move') {
    // Locked into a move (Outrage, charging, recharge) overrides the choice.
    if (mon.volatiles.mustrecharge) return { type: 'move', side, mon, moveId: 'recharge', pri: 0, tera: a.tera };
    if (mon.volatiles.twoturnmove) return { type: 'move', side, mon, moveId: mon.volatiles.twoturnmove.move, pri: D.moves[mon.volatiles.twoturnmove.move].pri, tera: a.tera, noPP: true };
    if (mon.volatiles.lockedmove) return { type: 'move', side, mon, moveId: mon.volatiles.lockedmove.move, pri: D.moves[mon.volatiles.lockedmove.move].pri, tera: a.tera, noPP: true };
    if (mon.volatiles.encore) { const i = mon.moves.findIndex(s => s.id === mon.volatiles.encore.move); if (i >= 0 && mon.moves[i].pp > 0) a = { ...a, index: i }; }
    const slot = mon.moves[a.index];
    if (!slot || a.index < 0 || !canSelect(b, mon, slot) && !mon.moves.some(s => canSelect(b, mon, s))) return { type: 'move', side, mon, moveId: 'struggle', pri: 0, tera: a.tera };
    const move = D.moves[slot.id];
    return { type: 'move', side, mon, moveId: slot.id, slot, pri: priorityOf(b, mon, move, slot.id), tera: a.tera };
  }
  if (a.type === 'switch') return { type: 'switch', side, mon, index: a.index, pri: 7 };
  if (a.type === 'item') return { type: 'item', side, mon, item: a.item, target: a.target ?? b.sides[side].active, pri: 8 };
  throw new Error('Unknown action');
}
function priorityOf(b, mon, move, id) {
  let p = move.pri || 0;
  if (mon.ability === 'prankster' && move.cat === 'Status') p += 1;
  if (mon.ability === 'galewings' && move.type === 'Flying' && mon.hp === mon.maxhp) p += 1;
  if (mon.ability === 'triage' && move.flags?.includes('heal')) p += 3;
  if (id === 'grassyglide' && b.field.terrain === 'grassyterrain' && isGrounded(b, mon)) p += 1;
  return p;
}
function orderActions(b, acts) {
  const qc = {};
  for (const a of acts) if (a.type === 'move' && a.mon.item === 'quickclaw' && b.rng.chance(1, 5)) qc[a.side] = true;
  return acts.slice().sort((x, y) => {
    if (y.pri !== x.pri) return y.pri - x.pri;
    if (x.type === 'move' && (qc[x.side] || qc[y.side]) && qc[x.side] !== qc[y.side]) return qc[x.side] ? -1 : 1;
    const sx = speedOf(b, x.mon), sy = speedOf(b, y.mon);
    if (sx !== sy) return b.field.trickRoom && x.type === 'move' ? sx - sy : sy - sx;
    return b.rng.next() < .5 ? -1 : 1;
  }).map(a => { if (qc[a.side] && a.type === 'move') a.quickClaw = true; return a; });
}
function speedOrder(b, mons) { return mons.filter(Boolean).sort((x, y) => (speedOf(b, y) - speedOf(b, x)) || (b.rng.next() < .5 ? -1 : 1)); }

function continueTurn(b) {
  while (b.queue.length) {
    const a = b.queue.shift();
    if (a.mon.fainted || active(b, a.side) !== a.mon) { if (a.type !== 'switch' || a.mon.fainted) continue; }
    if (a.type === 'switch') { doSwitch(b, b.sides[a.side], a.index); }
    else if (a.type === 'item') useItemAction(b, a);
    else if (a.type === 'move') { if (a.quickClaw) msg(b, Name(a.mon) + "'s Quick Claw let it move first!"); runMove(b, a.mon, a.moveId, a); }
    if (checkEnd(b)) return;
    if (b.request?.type === 'switch' && b.request.reason === 'pivot') return;
  }
  endOfTurn(b);
  if (checkEnd(b)) return;
  const p = active(b, 'p'), e = active(b, 'e');
  let needPlayer = p.fainted && benchIndexes(b, 'p').length;
  if (e.fainted) {
    const idx = aiReplacement(b);
    if (needPlayer) b.pendingEnemySwitch = idx;
    else { switchIn(b, b.sides.e, idx); onSwitchInEffects(b, active(b, 'e')); }
  }
  if (checkEnd(b)) return;
  if (needPlayer) { b.request = { type: 'switch', reason: 'faint', switches: benchIndexes(b, 'p') }; return; }
  startNextTurn(b);
}
function startNextTurn(b) {
  b.turn++;
  for (const s of Object.values(b.sides)) { const m = s.team[s.active]; if (m) { delete m.volatiles.protect; m.switchedThisTurn = false; } }
  b.request = moveRequest(b);
}
function checkEnd(b) {
  const pAlive = b.sides.p.team.some(m => !m.fainted), eAlive = b.sides.e.team.some(m => !m.fainted);
  if (pAlive && eAlive) return false;
  b.ended = true; b.winner = eAlive ? 'e' : 'p';
  if (!pAlive && !eAlive) b.winner = b.turnState?.lastFaintSide === 'e' ? 'p' : 'e';
  b.request = { type: 'end', winner: b.winner };
  push(b, { t: 'end', winner: b.winner });
  return true;
}

// ---------- Switching ----------
function switchIn(b, side, index, initial) {
  const prev = side.team[side.active];
  side.active = index;
  const mon = side.team[index];
  mon.activeTurns = 0; mon.switchedThisTurn = true; mon.boosts = zeroBoosts(); mon.volatiles = {};
  if (mon.status === 'tox') mon.statusState.toxN = 1;
  mon.types = mon.terastallized ? [mon.teraType] : [...mon.baseTypes];
  mon.ability = mon.baseAbility;
  const foe = foeOf(b, mon);
  if (mon.side === 'p' && foe && !foe.fainted) foe.seenBy?.add(mon.uid);
  if (mon.side === 'e' && foe && !foe.fainted) mon.seenBy.add(foe.uid);
  push(b, { t: 'switch', side: side.id, idx: index, name: mon.name, species: mon.species, num: mon.num, shiny: mon.shiny, level: mon.level, hp: mon.hp, maxhp: mon.maxhp, status: mon.status, gender: mon.gender, tera: mon.terastallized ? mon.teraType : null, initial: !!initial });
  msg(b, side.id === 'p' ? 'Go! ' + mon.name + '!' : (b.label || 'The rival') + ' sent out ' + mon.name + '!');
  if (!initial) entryHazards(b, mon);
  return prev;
}
function doSwitch(b, side, index, pivot) {
  const out = side.team[side.active];
  if (out && !out.fainted) {
    onSwitchOut(b, out, pivot);
    msg(b, side.id === 'p' ? out.name + ', come back!' : (b.label || 'The rival') + ' withdrew ' + out.name + '!');
  }
  const keep = pivot === 'batonpass' && out ? { boosts: { ...out.boosts }, sub: out.volatiles.substitute, focus: out.volatiles.focusenergy } : null;
  const shed = pivot === 'shedtail' && out ? out.volatiles.substitute : null;
  switchIn(b, side, index);
  const mon = side.team[index];
  if (keep) { mon.boosts = keep.boosts; if (keep.sub) mon.volatiles.substitute = keep.sub; if (keep.focus) mon.volatiles.focusenergy = keep.focus; }
  if (shed) mon.volatiles.substitute = shed;
  if (side.slot.healingwish && !mon.fainted) {
    delete side.slot.healingwish; mon.hp = mon.maxhp; mon.status = null; hpEvent(b, mon, 'heal', 0); push(b, { t: 'status', side: mon.side, status: null }); msg(b, 'The healing wish came true for ' + name(mon) + '!');
  }
  if (!mon.fainted) onSwitchInEffects(b, mon);
}
function onSwitchOut(b, mon, pivot) {
  if (mon.ability === 'regenerator' && mon.hp > 0) { mon.hp = Math.min(mon.maxhp, mon.hp + Math.floor(mon.maxhp / 3)); hpEvent(b, mon, 'heal', 0, { silent: true }); }
  if (mon.ability === 'naturalcure' && mon.status) { mon.status = null; push(b, { t: 'status', side: mon.side, idx: mon.idx, status: null, silent: true }); }
  delete mon.volatiles.choicelock;
}
function entryHazards(b, mon) {
  const c = sideOf(b, mon).cond;
  if (mon.item === 'heavydutyboots') return;
  if (c.stealthrock) {
    const eff = effectiveness('Rock', mon.types);
    if (!hasMagicGuard(mon)) damageFraction(b, mon, eff / 8, 'Pointed stones dug into ' + name(mon) + '!');
  }
  if (mon.fainted) return;
  if (!isGrounded(b, mon)) return;
  if (c.spikes) { const f = [0, 1 / 8, 1 / 6, 1 / 4][c.spikes.layers]; if (!hasMagicGuard(mon)) damageFraction(b, mon, f, name(mon)[0].toUpperCase() + name(mon).slice(1) + ' was hurt by the spikes!'); }
  if (mon.fainted) return;
  if (c.toxicspikes) {
    if (mon.types.includes('Poison')) { delete c.toxicspikes; msg(b, 'The poison spikes disappeared from around ' + (mon.side === 'p' ? 'your' : "the opposing") + ' team\'s feet!'); }
    else trySetStatus(b, mon, c.toxicspikes.layers >= 2 ? 'tox' : 'psn', null, 'hazard');
  }
  if (c.stickyweb) { msg(b, Name(mon) + ' was caught in a sticky web!'); applyBoosts(b, mon, { spe: -1 }, null); }
}
function onSwitchInEffects(b, mon) {
  if (mon.fainted) return;
  const foe = foeOf(b, mon);
  const ab = mon.ability;
  const weatherAb = { drizzle: 'RainDance', drought: 'sunnyday', sandstream: 'Sandstorm', snowwarning: 'snowscape', orichalcumpulse: 'sunnyday' };
  const terrainAb = { electricsurge: 'electricterrain', grassysurge: 'grassyterrain', psychicsurge: 'psychicterrain', mistysurge: 'mistyterrain', hadronengine: 'electricterrain' };
  if (weatherAb[ab]) setWeather(b, weatherAb[ab], mon);
  if (terrainAb[ab]) setTerrain(b, terrainAb[ab], mon);
  if (ab === 'intimidate' && foe && !foe.fainted) {
    msg(b, Name(mon) + "'s Intimidate!");
    if (['innerfocus', 'owntempo', 'oblivious', 'scrappy'].includes(foe.ability) || foe.volatiles.substitute) msg(b, Name(foe) + ' was not affected!');
    else { applyBoosts(b, foe, { atk: -1 }, mon); if (foe.ability === 'rattled') applyBoosts(b, foe, { spe: 1 }, foe); }
  }
  if (ab === 'intrepidsword') applyBoosts(b, mon, { atk: 1 }, mon);
  if (ab === 'dauntlessshield') applyBoosts(b, mon, { def: 1 }, mon);
  if (ab === 'download' && foe) applyBoosts(b, mon, effStat(b, foe, 'def') < effStat(b, foe, 'spd') ? { atk: 1 } : { spa: 1 }, mon);
  if (ab === 'pressure') msg(b, Name(mon) + ' is exerting its pressure!');
  if (ab === 'moldbreaker' || ab === 'teravolt' || ab === 'turboblaze') msg(b, Name(mon) + ' breaks the mold!');
  if (mon.item === 'airballoon') msg(b, Name(mon) + ' floats in the air with its Air Balloon!');
  checkParadox(b, mon);
}
function checkParadox(b, mon) {
  const ab = mon.ability;
  if (ab !== 'protosynthesis' && ab !== 'quarkdrive') return;
  const on = ab === 'protosynthesis' ? weather(b) === 'sun' : b.field.terrain === 'electricterrain';
  if (mon.volatiles.paradox) return;
  if (on || (mon.item === 'boosterenergy' && !mon.usedItem)) {
    if (!on) { consumeItem(b, mon); msg(b, Name(mon) + ' used its Booster Energy!'); }
    let best = 'atk';
    for (const s of ['def', 'spa', 'spd', 'spe']) if (effStat(b, mon, s, true) > effStat(b, mon, best, true)) best = s;
    mon.volatiles.paradox = { stat: best, fromItem: !on };
    msg(b, Name(mon) + "'s " + STAT_NAMES[best] + ' was heightened!');
  }
}

// ---------- Stats ----------
function hasMagicGuard(mon) { return mon.ability === 'magicguard'; }
function ignoresAbilities(user) { return ['moldbreaker', 'teravolt', 'turboblaze'].includes(user?.ability); }
function abilityOf(mon, attacker) { return attacker && attacker !== mon && ignoresAbilities(attacker) && BREAKABLE.has(mon.ability) ? '' : mon.ability; }
const BREAKABLE = new Set('levitate flashfire waterabsorb voltabsorb dryskin stormdrain lightningrod sapsipper motordrive eartheater wellbakedbody wonderguard bulletproof soundproof goodasgold thickfat heatproof waterbubble purifyingsalt fluffy icescales multiscale filter solidrock furcoat marvelscale sturdy battlearmor shellarmor clearbody whitesmoke hypercutter keeneye bigpecks innerfocus owntempo oblivious insomnia vitalspirit sweetveil limber immunity pastelveil waterveil thermalexchange magmaarmor leafguard shielddust unaware simple contrary armortail queenlymajesty dazzling sandveil snowcloak overcoat'.split(' '));
function weather(b) {
  const w = b.field.weather;
  if (!w) return null;
  const m = { RainDance: 'rain', raindance: 'rain', sunnyday: 'sun', Sandstorm: 'sand', sandstorm: 'sand', snowscape: 'snow', snow: 'snow', hail: 'hail' };
  return m[w] || null;
}
function effStat(b, mon, stat, raw) {
  let v = boosted(mon.stats[stat], raw ? 0 : mon.boosts[stat]);
  return v;
}
function speedOf(b, mon) {
  if (!mon) return 0;
  let s = boosted(mon.stats.spe, mon.boosts.spe);
  const c = new Chain();
  const w = weather(b);
  if (mon.ability === 'swiftswim' && w === 'rain' || mon.ability === 'chlorophyll' && w === 'sun' || mon.ability === 'sandrush' && w === 'sand' || mon.ability === 'slushrush' && (w === 'snow' || w === 'hail')) c.mul(2);
  if (mon.ability === 'unburden' && mon.volatiles.unburden) c.mul(2);
  if (mon.ability === 'quickfeet' && mon.status) c.mul(1.5);
  if (mon.volatiles.paradox?.stat === 'spe') c.mul(1.5);
  if (mon.item === 'choicescarf') c.mul(1.5);
  if (/^power|machobrace/.test(mon.item || '') && ['powerweight', 'powerbracer', 'powerbelt', 'powerlens', 'powerband', 'poweranklet', 'machobrace'].includes(mon.item)) c.mul(0.5);
  if (sideOf(b, mon).cond.tailwind) c.mul(2);
  s = c.apply(s);
  if (mon.status === 'par' && mon.ability !== 'quickfeet') s = Math.floor(s * 50 / 100);
  return s;
}
function isGrounded(b, mon) {
  if (b.field.gravity || mon.volatiles.smackdown || mon.volatiles.ingrain) return true;
  if (mon.item === 'airballoon' || mon.volatiles.magnetrise) return false;
  if (mon.types.includes('Flying') && !mon.volatiles.roost) return false;
  if (mon.ability === 'levitate') return false;
  return true;
}

// ---------- Move helpers ----------
function moveTypeFor(b, mon, move, id) {
  let type = move.type;
  if (id === 'weatherball') type = ({ rain: 'Water', sun: 'Fire', sand: 'Rock', snow: 'Ice', hail: 'Ice' })[weather(b)] || 'Normal';
  if (id === 'terrainpulse' && isGrounded(b, mon)) type = ({ electricterrain: 'Electric', grassyterrain: 'Grass', psychicterrain: 'Psychic', mistyterrain: 'Fairy' })[b.field.terrain] || 'Normal';
  if (['judgment', 'multiattack', 'technoblast', 'revelationdance'].includes(id)) type = mon.terastallized && id === 'revelationdance' ? mon.teraType : mon.baseTypes[0];
  if (id === 'terablast' && mon.terastallized) type = mon.teraType;
  if (id === 'hiddenpower') type = hiddenPowerType(mon.ivs);
  if (id === 'ragingbull' || id === 'struggle') type = id === 'struggle' ? '???' : type;
  if (type === 'Normal' && id !== 'struggle' && id !== 'terablast') {
    const ate = { pixilate: 'Fairy', aerilate: 'Flying', refrigerate: 'Ice', galvanize: 'Electric' }[mon.ability];
    if (ate && move.cat !== 'Status') type = ate;
  }
  if (mon.ability === 'normalize' && move.cat !== 'Status') type = 'Normal';
  return type;
}
export function hiddenPowerType(ivs = {}) {
  const order = ['hp', 'atk', 'def', 'spe', 'spa', 'spd'];
  const sum = order.reduce((s, k, i) => s + (((ivs[k] ?? 31) & 1) << i), 0);
  return ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'][Math.floor(sum * 15 / 63)];
}
function categoryFor(b, mon, move, id, target) {
  if (id === 'photongeyser' || id === 'terablast' && mon.terastallized) return effStat(b, mon, 'atk') > effStat(b, mon, 'spa') ? 'Physical' : 'Special';
  if (id === 'shellsidearm' && target) {
    const p = Math.floor(Math.floor(Math.floor(2 * mon.level / 5 + 2) * 90 * effStat(b, mon, 'atk')) / effStat(b, target, 'def'));
    const s = Math.floor(Math.floor(Math.floor(2 * mon.level / 5 + 2) * 90 * effStat(b, mon, 'spa')) / effStat(b, target, 'spd'));
    return p > s ? 'Physical' : 'Special';
  }
  return move.cat;
}
function targetsFoe(move) { return !['self', 'adjacentAllyOrSelf', 'allySide', 'allyTeam', 'allies', 'all', 'foeSide', 'adjacentAlly'].includes(move.target); }

// ---------- Running a move ----------
function runMove(b, user, id, action = {}) {
  b.turnState.moved[user.side] = true;
  if (id === 'recharge') { delete user.volatiles.mustrecharge; msg(b, Name(user) + ' must recharge!'); user.lastMoveFailed = false; return; }
  const move = D.moves[id];
  if (!beforeMove(b, user, id, move)) { if (user.volatiles.lockedmove) delete user.volatiles.lockedmove; if (user.volatiles.twoturnmove) delete user.volatiles.twoturnmove; user.lastMoveFailed = true; return; }
  // PP
  if (!action.noPP && id !== 'struggle') {
    const slot = user.moves.find(s => s.id === id);
    if (slot) { const foe = foeOf(b, user); slot.pp = Math.max(0, slot.pp - (foe?.ability === 'pressure' && targetsFoe(move) ? 2 : 1)); }
  }
  if (move.cat !== 'Status' && user.item?.startsWith('choice')) user.volatiles.choicelock ||= id;
  if (user.ability === 'gorillatactics') user.volatiles.choicelock ||= id;
  const res = useMove(b, user, id, move, action);
  user.lastMove = id;
  user.lastMoveFailed = res === false;
  if (move.cat === 'Status' && user.side === 'p') b.stats.statusMoves++;
}
function beforeMove(b, user, id, move) {
  if (user.volatiles.flinch) {
    delete user.volatiles.flinch;
    msg(b, Name(user) + ' flinched and couldn\'t move!');
    if (user.ability === 'steadfast') applyBoosts(b, user, { spe: 1 }, user);
    return false;
  }
  if (user.status === 'slp') {
    user.statusState.time--;
    if (user.statusState.time <= 0) { cureStatus(b, user, Name(user) + ' woke up!'); }
    else if (!move.sleepUsable) { msg(b, Name(user) + ' is fast asleep.'); return false; }
  }
  if (user.status === 'frz') {
    const defrost = move.flags?.includes('defrost') && !(id === 'burnup' && !user.types.includes('Fire'));
    if (defrost) cureStatus(b, user, Name(user) + ' thawed out!');
    else {
      user.statusState.time--;
      if (user.statusState.time <= 0 || b.rng.chance(1, 4)) cureStatus(b, user, Name(user) + ' thawed out!');
      else { msg(b, Name(user) + ' is frozen solid!'); return false; }
    }
  }
  if (user.volatiles.taunt && move.cat === 'Status') { msg(b, Name(user) + " can't use " + move.name + ' after the taunt!'); return false; }
  if (user.volatiles.disable?.move === id) { msg(b, Name(user) + "'s " + move.name + ' is disabled!'); return false; }
  if (user.volatiles.healblock && move.flags?.includes('heal')) { msg(b, Name(user) + " can't use " + move.name + ' because of Heal Block!'); return false; }
  if (user.volatiles.confusion) {
    user.volatiles.confusion.time--;
    if (user.volatiles.confusion.time <= 0) { delete user.volatiles.confusion; msg(b, Name(user) + ' snapped out of its confusion!'); }
    else {
      msg(b, Name(user) + ' is confused!');
      if (b.rng.chance(1, 3)) {
        const dmg = confusionDamage(b, user);
        msg(b, 'It hurt itself in its confusion!');
        applyDamage(b, user, dmg, null);
        return false;
      }
    }
  }
  if (user.status === 'par' && b.rng.chance(1, 8)) { msg(b, Name(user) + ' is paralyzed! It can\'t move!'); return false; }
  if (user.volatiles.attract && b.rng.chance(1, 2)) { msg(b, Name(user) + ' is immobilized by love!'); return false; }
  return true;
}
function confusionDamage(b, user) {
  const atk = effStat(b, user, 'atk'), def = effStat(b, user, 'def');
  let d = tr(tr(tr(tr(2 * user.level / 5 + 2) * 40 * atk) / def) / 50) + 2;
  d = tr(tr(d * (100 - b.rng.int(16))) / 100);
  return Math.max(1, d);
}

function useMove(b, user, id, baseMove, action) {
  let move = { ...baseMove, id };
  if (id === 'struggle') move = { ...move, type: '???' };
  if (id === 'metronome') {
    const pool = Object.keys(D.moves).filter(k => D.moves[k].flags?.includes('metronome') && k !== 'metronome');
    msg(b, Name(user) + ' used Metronome!');
    const pick = b.rng.pick(pool);
    msg(b, 'Waggling a finger let it use ' + D.moves[pick].name + '!');
    return useMove(b, user, pick, D.moves[pick], { ...action, called: true });
  }
  if (id === 'sleeptalk') {
    msg(b, Name(user) + ' used Sleep Talk!');
    if (user.status !== 'slp') { msg(b, 'But it failed!'); return false; }
    const opts = user.moves.map(s => s.id).filter(k => k !== 'sleeptalk' && !D.moves[k].flags?.includes('charge') && !D.moves[k].flags?.includes('nosleeptalk'));
    if (!opts.length) { msg(b, 'But it failed!'); return false; }
    const pick = b.rng.pick(opts);
    return useMove(b, user, pick, D.moves[pick], { ...action, called: true });
  }
  move.type = moveTypeFor(b, user, move, id);
  const target = targetsFoe(move) ? foeOf(b, user) : user;
  move.cat = categoryFor(b, user, move, id, target !== user ? target : null);
  // Two-turn moves
  const two = TWO_TURN[id];
  const announce = () => { msg(b, Name(user) + ' used ' + move.name + '!'); push(b, { t: 'move', side: user.side, move: move.name, type: move.type, cat: move.cat, target: target.side }); };
  if (two && !user.volatiles.twoturnmove) {
    const skip = (two.sun && weather(b) === 'sun') || (id === 'electroshot' && weather(b) === 'rain') || user.item === 'powerherb';
    announce();
    if (two.boost) applyBoosts(b, user, two.boost, user);
    if (!skip) { msg(b, Name(user) + ' ' + two.text); user.volatiles.twoturnmove = { move: id, semi: two.semi }; push(b, { t: 'charge', side: user.side, semi: two.semi || null }); return true; }
    if (user.item === 'powerherb') { consumeItem(b, user); msg(b, Name(user) + ' became fully charged due to its Power Herb!'); }
  } else if (two) {
    delete user.volatiles.twoturnmove;
    push(b, { t: 'charge', side: user.side, semi: null });
    announce();
  } else announce();
  // Generic pre-checks
  const fail = () => { msg(b, 'But it failed!'); return false; };
  if (id === 'burnup' && !user.types.includes('Fire')) return fail();
  if (id === 'doubleshock' && !user.types.includes('Electric')) return fail();
  if ((id === 'fakeout' || id === 'firstimpression') && user.activeTurns > 1) return fail();
  if (id === 'suckerpunch' || id === 'thunderclap') {
    const ta = b.turnState.actions[target.side];
    if (b.turnState.moved[target.side] && target.lastMove !== null && ta?.mon === target || !ta || ta.type !== 'move' || D.moves[ta.moveId]?.cat === 'Status' || ta.moveId === 'recharge') return fail();
  }
  if (id === 'upperhand') { const ta = b.turnState.actions[target.side]; if (!ta || ta.type !== 'move' || b.turnState.moved[target.side] || !(ta.pri > 0) || D.moves[ta.moveId]?.cat === 'Status') return fail(); }
  if (id === 'focuspunch' && b.turnState.hitThisTurn[user.side]) { msg(b, Name(user) + ' lost its focus and couldn\'t move!'); return false; }
  if (id === 'snore' && user.status !== 'slp') return fail();
  if (id === 'rest') {
    if (user.hp === user.maxhp || user.status === 'slp' || ['insomnia', 'vitalspirit'].includes(user.ability) || b.field.terrain === 'electricterrain' && isGrounded(b, user)) return fail();
    user.status = 'slp'; user.statusState = { time: 3 };
    push(b, { t: 'status', side: user.side, idx: user.idx, status: 'slp' });
    msg(b, Name(user) + ' slept and became healthy!');
    heal(b, user, user.maxhp, null, true);
    return true;
  }
  if (id === 'splash' || id === 'celebrate' || id === 'holdhands') { msg(b, 'But nothing happened!'); return true; }
  if (['followme', 'ragepowder', 'helpinghand', 'allyswitch', 'aromaticmist', 'holdhands', 'coaching'].includes(id)) return fail();
  if (id === 'auroraveil' && !['snow', 'hail'].includes(weather(b))) return fail();
  if (id === 'poltergeist' && !target.item) return fail();
  if (id === 'dreameater' && target.status !== 'slp' && target.ability !== 'comatose') { msg(b, "It doesn't affect " + name(target) + '...'); return false; }
  if (id === 'synchronoise' && !target.types.some(t => user.types.includes(t))) { msg(b, "It doesn't affect " + name(target) + '...'); return false; }
  if (['afteryou', 'spotlight'].includes(id)) return fail();
  if (id === 'steelroller' && !b.field.terrain) return fail();
  if (id === 'lastresort' && user.moves.length < 2) return fail();
  if (id === 'teleport' && !benchIndexes(b, user.side).length) return fail();
  if (move.selfdestruct === 'always' && !target.fainted) { /* faint after */ }
  // Target checks
  if (id === 'curse' && !user.types.includes('Ghost')) return selfOrFieldMove(b, user, move);
  if (targetsFoe(move)) {
    if (!target || target.fainted) { msg(b, 'But there was no target...'); return false; }
    const res = hitTarget(b, user, target, move, action);
    if (res && move.cat === 'Status' && move.selfdestruct && !user.fainted) applyDamage(b, user, user.hp, null, true);
    return res;
  }
  return selfOrFieldMove(b, user, move);
}
const TWO_TURN = {
  solarbeam: { text: 'absorbed light!', sun: true }, solarblade: { text: 'absorbed light!', sun: true },
  fly: { text: 'flew up high!', semi: 'fly' }, bounce: { text: 'sprang up!', semi: 'fly' }, dig: { text: 'burrowed its way under the ground!', semi: 'dig' },
  dive: { text: 'hid underwater!', semi: 'dive' }, phantomforce: { text: 'vanished instantly!', semi: 'shadow' }, shadowforce: { text: 'vanished instantly!', semi: 'shadow' },
  skullbash: { text: 'tucked in its head!', boost: { def: 1 } }, skyattack: { text: 'became cloaked in a harsh light!' },
  meteorbeam: { text: 'is overflowing with space power!', boost: { spa: 1 } }, electroshot: { text: 'absorbed electricity!', boost: { spa: 1 } },
  freezeshock: { text: 'became cloaked in a freezing light!' }, iceburn: { text: 'became cloaked in freezing air!' }, razorwind: { text: 'whipped up a whirlwind!' },
  geomancy: { text: 'is absorbing power!' },
};
const SEMI_HITS = { fly: ['thunder', 'hurricane', 'skyuppercut', 'twister', 'gust', 'smackdown', 'thousandarrows'], dig: ['earthquake', 'magnitude', 'fissure'], dive: ['surf', 'whirlpool'], shadow: [] };

function protectBlocks(b, user, target, move) {
  const p = target.volatiles.protect;
  if (!p || !move.flags?.includes('protect')) return false;
  if (move.breaksProtect) { delete target.volatiles.protect; msg(b, Name(target) + ' fell for the feint!'); return false; }
  if ((p.kind === 'kingsshield' || p.kind === 'obstruct' || p.kind === 'silktrap') && move.cat === 'Status') return false;
  if (user.ability === 'unseenfist' && move.flags.includes('contact')) return false;
  msg(b, Name(target) + ' protected itself!');
  const contact = move.flags.includes('contact') && user.item !== 'protectivepads' && user.item !== 'punchingglove' || (move.flags.includes('contact') && user.item === 'punchingglove' && !move.flags.includes('punch'));
  if (contact) {
    if (p.kind === 'kingsshield') applyBoosts(b, user, { atk: -1 }, target);
    if (p.kind === 'obstruct') applyBoosts(b, user, { def: -2 }, target);
    if (p.kind === 'silktrap') applyBoosts(b, user, { spe: -1 }, target);
    if (p.kind === 'spikyshield' && !hasMagicGuard(user)) damageFraction(b, user, 1 / 8, Name(user) + ' was hurt!');
    if (p.kind === 'banefulbunker') trySetStatus(b, user, 'psn', target);
    if (p.kind === 'burningbulwark') trySetStatus(b, user, 'brn', target);
  }
  if (move.hasCrashDamage) crash(b, user);
  return true;
}
function crash(b, user) { if (!hasMagicGuard(user)) { msg(b, Name(user) + ' kept going and crashed!'); applyDamage(b, user, Math.floor(user.maxhp / 2), null); } }

function accuracyCheck(b, user, target, move) {
  if (move.acc === true) return true;
  if (user.ability === 'noguard' || target.ability === 'noguard') return true;
  if (user.volatiles.lockon) { delete user.volatiles.lockon; return true; }
  const w = weather(b);
  if ((move.id === 'thunder' || move.id === 'hurricane' || move.id === 'sandsearstorm' || move.id === 'wildboltstorm' || move.id === 'bleakwindstorm') && w === 'rain') return true;
  if (move.id === 'blizzard' && (w === 'snow' || w === 'hail')) return true;
  if (move.id === 'toxic' && user.types.includes('Poison')) return true;
  let acc = move.acc;
  if ((move.id === 'thunder' || move.id === 'hurricane') && w === 'sun') acc = 50;
  if (move.ohko) {
    if (target.level > user.level) return false;
    acc = (move.id === 'sheercold' && !user.types.includes('Ice') ? 20 : 30) + user.level - target.level;
    return b.rng.int(100) < acc;
  }
  let stage = 0;
  const tAb = abilityOf(target, user);
  if (!move.ignoreEvasion && user.ability !== 'unaware' && user.ability !== 'keeneye' && user.ability !== 'mindseye') stage -= target.boosts.evasion;
  if (tAb !== 'unaware') stage += user.boosts.accuracy;
  stage = Math.max(-6, Math.min(6, stage));
  acc = stage >= 0 ? Math.floor(acc * (3 + stage) / 3) : Math.floor(acc * 3 / (3 - stage));
  const c = new Chain();
  if (user.ability === 'compoundeyes') c.mul(1.3);
  if (user.ability === 'hustle' && move.cat === 'Physical') c.mul(0.8);
  if (user.item === 'widelens') c.mul(1.1);
  if (target.item === 'brightpowder') c.mul(0.9);
  if (tAb === 'sandveil' && w === 'sand' || tAb === 'snowcloak' && (w === 'snow' || w === 'hail')) c.mul(0.8);
  if (b.field.gravity) c.mul(5, 3);
  acc = c.apply(acc);
  return b.rng.int(100) < acc;
}

// Ability-based immunities when hit. Returns true if the move was absorbed.
function abilityImmunity(b, user, target, move) {
  const ab = abilityOf(target, user);
  const t = move.type;
  const absorb = (heal, text) => { if (heal) { if (target.hp < target.maxhp) heal4(b, target, Math.floor(target.maxhp / 4)); else msg(b, Name(target) + "'s " + text + ' made the move ineffective!'); } return true; };
  if (move.cat !== 'Status' || move.target !== 'self') {
    if (ab === 'voltabsorb' && t === 'Electric') return absorb(true, 'Volt Absorb');
    if ((ab === 'waterabsorb' || ab === 'dryskin') && t === 'Water') return absorb(true, 'Water Absorb');
    if (ab === 'eartheater' && t === 'Ground') return absorb(true, 'Earth Eater');
    if (ab === 'flashfire' && t === 'Fire') { target.volatiles.flashfire = true; msg(b, 'The power of ' + name(target) + "'s Fire-type moves rose!"); return true; }
    if (ab === 'wellbakedbody' && t === 'Fire') { applyBoosts(b, target, { def: 2 }, target); return true; }
    if (ab === 'lightningrod' && t === 'Electric') { applyBoosts(b, target, { spa: 1 }, target); return true; }
    if (ab === 'stormdrain' && t === 'Water') { applyBoosts(b, target, { spa: 1 }, target); return true; }
    if (ab === 'motordrive' && t === 'Electric') { applyBoosts(b, target, { spe: 1 }, target); return true; }
    if (ab === 'sapsipper' && t === 'Grass') { applyBoosts(b, target, { atk: 1 }, target); return true; }
    if (ab === 'levitate' && t === 'Ground' && move.cat !== 'Status' && !b.field.gravity && !target.volatiles.smackdown && move.id !== 'thousandarrows') { msg(b, "It doesn't affect " + name(target) + '...'); return true; }
    if (ab === 'bulletproof' && move.flags?.includes('bullet')) { msg(b, "It doesn't affect " + name(target) + '...'); return true; }
    if (ab === 'soundproof' && move.flags?.includes('sound')) { msg(b, "It doesn't affect " + name(target) + '...'); return true; }
    if (ab === 'goodasgold' && move.cat === 'Status') { msg(b, "It doesn't affect " + name(target) + '...'); return true; }
    if ((ab === 'overcoat' || target.item === 'safetygoggles') && move.flags?.includes('powder')) { msg(b, "It doesn't affect " + name(target) + '...'); return true; }
    if (['armortail', 'queenlymajesty', 'dazzling'].includes(ab) && b.turnState.currentPri > 0) { msg(b, Name(target) + ' cannot use ' + move.name + '!'); return true; }
  }
  return false;
}
function heal4(b, mon, amt) { heal(b, mon, amt, Name(mon) + ' restored HP using its ability!'); }

function hitTarget(b, user, target, move, action) {
  const id = move.id;
  b.turnState.currentPri = priorityOf(b, user, D.moves[id] || move, id);
  if (target.volatiles.twoturnmove?.semi) {
    const semi = target.volatiles.twoturnmove.semi;
    if (!SEMI_HITS[semi]?.includes(id) && user.ability !== 'noguard') { msg(b, Name(target) + ' avoided the attack!'); return false; }
  }
  if (protectBlocks(b, user, target, move)) return false;
  if (b.field.terrain === 'psychicterrain' && b.turnState.currentPri > 0 && isGrounded(b, target) && target !== user) { msg(b, Name(target) + ' is protected by the Psychic Terrain!'); return false; }
  if (move.flags?.includes('powder') && target.types.includes('Grass')) { msg(b, "It doesn't affect " + name(target) + '...'); return false; }
  if (user.ability === 'prankster' && move.cat === 'Status' && target.types.includes('Dark') && target !== user) { msg(b, "It doesn't affect " + name(target) + '...'); return false; }
  if (abilityImmunity(b, user, target, move)) return false;
  // Type immunity
  const ignoreImm = move.ignoreImmunity !== undefined ? move.ignoreImmunity : move.cat === 'Status';
  let eff = typeEffectivenessFor(b, user, target, move);
  if (eff === 0 && ignoreImm !== true && !(typeof ignoreImm === 'object' && ignoreImm[move.type])) {
    msg(b, "It doesn't affect " + name(target) + '...');
    if (move.hasCrashDamage) crash(b, user);
    return false;
  }
  if (move.ohko && (target.ability === 'sturdy' && !ignoresAbilities(user) || move.ohko === 'Ice' && target.types.includes('Ice'))) { msg(b, Name(target) + ' was protected by Sturdy!'); return false; }
  if (!accuracyCheck(b, user, target, move)) {
    msg(b, Name(target) + ' avoided the attack!');
    if (move.hasCrashDamage) crash(b, user);
    if (user.volatiles.lockedmove) delete user.volatiles.lockedmove;
    return false;
  }
  if (move.cat === 'Status') return statusMoveOnTarget(b, user, target, move);
  return damagingMove(b, user, target, move, eff, action);
}
function typeEffectivenessFor(b, user, target, move) {
  if (move.type === '???') return 1;
  let types = target.types;
  if (target.volatiles.roost && !target.terastallized) { types = types.filter(t => t !== 'Flying'); if (!types.length) types = ['Normal']; }
  let eff = 1;
  for (const t of types) {
    let m = typeMult(move.type, t);
    if (m === 0 && t === 'Ghost' && (move.type === 'Normal' || move.type === 'Fighting') && (user.ability === 'scrappy' || user.ability === 'mindseye')) m = 1;
    if (m === 0 && t === 'Flying' && move.type === 'Ground' && (b.field.gravity || target.volatiles.smackdown || target.volatiles.ingrain || move.id === 'thousandarrows' || target.item === 'ironball')) m = 1;
    if (m === 0 && t === 'Dark' && move.type === 'Psychic' && target.volatiles.miracleeye) m = 1;
    if (move.id === 'freezedry' && t === 'Water') m = 2;
    if (move.id === 'flyingpress') m *= typeMult('Flying', t);
    eff *= m;
  }
  if (move.id === 'thousandarrows' && types.includes('Flying') && !isGrounded(b, target)) eff = 1;
  if (move.type === 'Ground' && target.item === 'airballoon' && move.id !== 'thousandarrows') return 0;
  if (move.type === 'Ground' && target.volatiles.magnetrise && !b.field.gravity) return 0;
  return eff;
}

function damagingMove(b, user, target, move, eff, action) {
  const id = move.id;
  // Substitute blocks unless sound/bypasssub/Infiltrator
  const subApplies = !move.flags?.includes('sound') && !move.flags?.includes('bypasssub') && user.ability !== 'infiltrator';
  let hits = 1;
  if (move.multihit) {
    if (Array.isArray(move.multihit)) {
      const [lo, hi] = move.multihit;
      if (user.ability === 'skilllink') hits = hi;
      else if (lo === 2 && hi === 5) hits = user.item === 'loadeddice' ? 4 + b.rng.int(2) : [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5][b.rng.int(20)];
      else hits = lo + b.rng.int(hi - lo + 1);
    } else hits = move.multihit;
  }
  if (id === 'watershuriken' && user.species === 'greninja') hits = 3;
  let total = 0, landed = 0, lastEff = eff, wasCrit = false;
  const hpBefore = target.hp;
  for (let h = 0; h < hits; h++) {
    if (target.fainted || user.fainted) break;
    if (h > 0 && move.multiaccuracy && !accuracyCheck(b, user, target, move)) break;
    const subBlocks = !!(subApplies && target.volatiles.substitute);
    const { damage, crit, fail } = calcDamage(b, user, target, move, { hitIndex: h, eff, subBlocks });
    if (damage === null) { if (fail) msg(b, 'But it failed!'); break; }
    let dealt;
    if (subBlocks) {
      const sub = target.volatiles.substitute;
      dealt = Math.min(sub.hp, damage);
      sub.hp -= dealt;
      if (crit) msg(b, 'A critical hit!');
      msg(b, 'The substitute took damage for ' + name(target) + '!');
      if (sub.hp <= 0) { delete target.volatiles.substitute; msg(b, Name(target) + "'s substitute faded!"); push(b, { t: 'sub', side: target.side, active: false }); }
    } else {
      dealt = applyHitDamage(b, user, target, damage, move, crit, eff);
    }
    if (crit) { wasCrit = true; if (user.side === 'p') b.stats.crits++; }
    total += dealt; landed++;
    if (!subBlocks) afterHitEffects(b, user, target, move, dealt, crit);
    if (!subBlocks && !target.fainted) secondaryEffects(b, user, target, move);
  }
  const subBlocks = !!(subApplies && target.volatiles.substitute);
  if (hits > 1 && landed) msg(b, 'The Pokémon was hit ' + landed + ' time' + (landed > 1 ? 's' : '') + '!');
  if (lastEff > 1 && landed) { msg(b, "It's super effective!"); if (user.side === 'p') b.stats.superEffective++; }
  else if (lastEff < 1 && lastEff > 0 && landed) msg(b, "It's not very effective...");
  if (user.side === 'p') b.stats.damageDealt += total;
  if (!subBlocks && total > 0) {
    b.turnState.damagedBy[target.side] = { damage: total, cat: move.cat, from: user.side };
    target.lastHitBy = { damage: total, cat: move.cat, turn: b.turn };
    if (target.item === 'weaknesspolicy' && lastEff > 1 && !target.fainted) { consumeItem(b, target); msg(b, 'The Weakness Policy was used!'); applyBoosts(b, target, { atk: 2, spa: 2 }, target); }
    if (target.ability === 'stamina' && !target.fainted) applyBoosts(b, target, { def: 1 }, target);
    if (target.ability === 'weakarmor' && move.cat === 'Physical' && !target.fainted) applyBoosts(b, target, { def: -1, spe: 2 }, target);
    if (target.ability === 'angerpoint' && wasCrit && !target.fainted) { target.boosts.atk = 6; msg(b, Name(target) + ' maxed its Attack!'); push(b, { t: 'boost', side: target.side, stat: 'atk', amount: 12 }); }
    if (target.ability === 'justified' && move.type === 'Dark' && !target.fainted) applyBoosts(b, target, { atk: 1 }, target);
    if (target.ability === 'rattled' && ['Dark', 'Bug', 'Ghost'].includes(move.type) && !target.fainted) applyBoosts(b, target, { spe: 1 }, target);
    if (target.ability === 'cottondown') { /* doubles only effect */ }
    if (target.status === 'frz' && (move.type === 'Fire' || move.thawsTarget) && !target.fainted) cureStatus(b, target, Name(target) + ' thawed out!');
  }
  // Drain
  if (move.drain && total > 0 && !user.fainted) {
    let amt = Math.max(1, Math.round(total * move.drain[0] / move.drain[1]));
    if (user.item === 'bigroot') amt = modify(amt, 1.3);
    if (target.ability === 'liquidooze') { msg(b, Name(user) + ' sucked up the liquid ooze!'); applyDamage(b, user, amt, null); }
    else heal(b, user, amt, Name(target) + ' had its energy drained!');
  }
  // Recoil
  if (move.recoil && total > 0 && !user.fainted && user.ability !== 'rockhead' && !hasMagicGuard(user)) {
    applyDamage(b, user, Math.max(1, Math.round(total * move.recoil[0] / move.recoil[1])), null);
    msg(b, Name(user) + ' was damaged by the recoil!');
  }
  if (id === 'struggle' && !user.fainted) { applyDamage(b, user, Math.max(1, Math.round(user.maxhp / 4)), null); msg(b, Name(user) + ' was damaged by the recoil!'); }
  if ((move.mindBlownRecoil || id === 'steelbeam') && !user.fainted && !hasMagicGuard(user)) { applyDamage(b, user, Math.round(user.maxhp / 2), null); }
  // Self effects after hit
  if (landed && !user.fainted) {
    if (move.self?.boosts && !(move.selfBoost)) applyBoosts(b, user, move.self.boosts, user);
    if (move.selfBoost?.boosts) applyBoosts(b, user, move.selfBoost.boosts, user);
    if (move.self?.volatileStatus === 'mustrecharge') user.volatiles.mustrecharge = true;
    if (move.self?.volatileStatus === 'lockedmove' && !user.volatiles.lockedmove) user.volatiles.lockedmove = { move: id, time: 2 + b.rng.int(2) };
    if (move.self?.volatileStatus === 'roost') user.volatiles.roost = true;
    if (id === 'burnup') { user.types = user.types.filter(t => t !== 'Fire'); if (!user.types.length) user.types = ['???']; msg(b, Name(user) + ' burned itself out!'); }
    if (id === 'doubleshock') { user.types = user.types.filter(t => t !== 'Electric'); if (!user.types.length) user.types = ['???']; msg(b, Name(user) + ' used up all its electricity!'); }
    if (user.item === 'lifeorb' && user.ability !== 'sheerforce' && !hasMagicGuard(user) && total > 0) { applyDamage(b, user, Math.floor(user.maxhp / 10), null); msg(b, Name(user) + ' lost some of its HP!'); }
    else if (user.item === 'lifeorb' && user.ability === 'sheerforce' && !hasSecondary(move) && !hasMagicGuard(user) && total > 0) { applyDamage(b, user, Math.floor(user.maxhp / 10), null); msg(b, Name(user) + ' lost some of its HP!'); }
    if (user.item === 'shellbell' && total > 0 && !user.fainted) heal(b, user, Math.floor(total / 8), Name(user) + ' restored a little HP using its Shell Bell!');
    if (id === 'knockoff' && target.item && !target.fainted && target.ability !== 'stickyhold') { msg(b, Name(user) + ' knocked off ' + name(target) + "'s " + itemName(target.item) + '!'); target.item = null; }
    if ((id === 'thief' || id === 'covet') && target.item && !user.item && !target.fainted) { user.item = target.item; target.item = null; msg(b, Name(user) + ' stole ' + name(target) + "'s " + itemName(user.item) + '!'); }
    if ((id === 'bugbite' || id === 'pluck') && target.item?.endsWith('berry')) { const berry = target.item; target.item = null; msg(b, Name(user) + ' stole and ate its target\'s ' + itemName(berry) + '!'); eatBerry(b, user, berry, true); }
    if (id === 'incinerate' && target.item?.endsWith('berry')) { msg(b, Name(target) + "'s " + itemName(target.item) + ' was burned up!'); target.item = null; }
    if (['rapidspin', 'mortalspin', 'tidyup'].includes(id)) clearHazards(b, user, true);
    if (id === 'rapidspin') applyBoosts(b, user, { spe: 1 }, user);
    if (id === 'mortalspin' && !target.fainted) trySetStatus(b, target, 'psn', user);
    if (id === 'stoneaxe') setHazard(b, target, 'stealthrock');
    if (id === 'ceaselessedge') setHazard(b, target, 'spikes');
    if ((id === 'icespinner' || id === 'steelroller') && b.field.terrain) { msg(b, 'The battlefield returned to normal.'); b.field.terrain = null; push(b, { t: 'terrain', terrain: null }); }
    if (['brickbreak', 'psychicfangs', 'ragingbull'].includes(id)) { const c = sideOf(b, target).cond; if (c.reflect || c.lightscreen || c.auroraveil) { delete c.reflect; delete c.lightscreen; delete c.auroraveil; msg(b, 'The wall shattered!'); } }
    if (id === 'smackdown' || id === 'thousandarrows') { if (!target.fainted && !isGrounded(b, target)) { target.volatiles.smackdown = true; msg(b, Name(target) + ' fell straight down!'); } }
    if (['anchorshot', 'spiritshackle', 'thousandwaves'].includes(id) && !target.fainted) target.volatiles.trapped = true;
    if (id === 'sparklingaria' && target.status === 'brn') cureStatus(b, target, Name(target) + "'s burn was healed.");
    if ((id === 'wakeupslap' && target.status === 'slp') || (id === 'smellingsalts' && target.status === 'par')) cureStatus(b, target, '');
    if (id === 'fellstinger' && target.fainted) applyBoosts(b, user, { atk: 3 }, user);
    if (id === 'clearsmog' && !target.fainted) { target.boosts = zeroBoosts(); msg(b, Name(target) + "'s stat changes were removed!"); }
    if (id === 'throatchop' && !target.fainted) target.volatiles.throatchop = { time: 2 };
  }
  if (user.ability === 'moxie' && target.fainted && !user.fainted) applyBoosts(b, user, { atk: 1 }, user);
  if ((user.ability === 'chillingneigh' || user.ability === 'asoneglastrier') && target.fainted && !user.fainted) applyBoosts(b, user, { atk: 1 }, user);
  if ((user.ability === 'grimneigh' || user.ability === 'asonespectrier') && target.fainted && !user.fainted) applyBoosts(b, user, { spa: 1 }, user);
  if (user.ability === 'beastboost' && target.fainted && !user.fainted) { let best = 'atk'; for (const s of ['def', 'spa', 'spd', 'spe']) if (user.stats[s] > user.stats[best]) best = s; applyBoosts(b, user, { [best]: 1 }, user); }
  if ((move.selfdestruct || id === 'finalgambit' && landed) && !user.fainted) { applyDamage(b, user, user.hp, null, true); }
  // Locked moves (Outrage) count down
  if (user.volatiles.lockedmove && !user.fainted) {
    user.volatiles.lockedmove.time--;
    if (user.volatiles.lockedmove.time <= 0) { delete user.volatiles.lockedmove; if (user.ability !== 'owntempo') addConfusion(b, user, true); }
  }
  // Pivot / forced switch
  if (landed && !b.ended) {
    if (move.selfSwitch && !user.fainted && benchIndexes(b, user.side).length) requestPivot(b, user, move.selfSwitch === true ? 'switch' : move.selfSwitch);
    if (move.forceSwitch && !target.fainted) dragOut(b, target);
  }
  return landed > 0;
}
function hasSecondary(move) { return !!(move.secondary || move.secondaries); }
function itemName(id) { return ITEM_NAMES[id] || id; }
export const ITEM_NAMES = {};

function applyHitDamage(b, user, target, damage, move, crit, eff) {
  let d = Math.min(damage, target.hp);
  if ((move.id === 'falseswipe' || move.id === 'holdback') && d >= target.hp) d = target.hp - 1;
  const full = target.hp === target.maxhp;
  if (d >= target.hp) {
    if (target.volatiles.endure) { d = target.hp - 1; msg(b, Name(target) + ' endured the hit!'); }
    else if (full && target.ability === 'sturdy' && !ignoresAbilities(user)) { d = target.hp - 1; msg(b, Name(target) + ' endured the hit!'); }
    else if (full && target.item === 'focussash') { d = target.hp - 1; consumeItem(b, target); msg(b, Name(target) + ' hung on using its Focus Sash!'); }
  }
  if (crit) msg(b, 'A critical hit!');
  target.hp -= d;
  target.timesHit++;
  b.turnState.hitThisTurn[target.side] = true;
  push(b, { t: 'damage', side: target.side, idx: target.idx, hp: target.hp, maxhp: target.maxhp, amount: d, eff, crit });
  if (target.hp <= 0) faint(b, target, user);
  else afterDamageItems(b, target);
  if (target.item === 'airballoon' && d > 0) { target.item = null; msg(b, Name(target) + "'s Air Balloon popped!"); }
  return d;
}
function afterHitEffects(b, user, target, move, dealt, crit) {
  // Contact abilities / items
  const contact = move.flags?.includes('contact') && user.ability !== 'longreach' && user.item !== 'protectivepads' && !(user.item === 'punchingglove' && move.flags.includes('punch'));
  if (!contact || user.fainted) return;
  const tAb = target.ability;
  if ((tAb === 'roughskin' || tAb === 'ironbarbs') && !hasMagicGuard(user)) damageFraction(b, user, 1 / 8, Name(user) + ' was hurt!');
  if (target.item === 'rockyhelmet' && !hasMagicGuard(user) && !user.fainted) damageFraction(b, user, 1 / 6, Name(user) + ' was hurt by the Rocky Helmet!');
  if (user.fainted) return;
  if (tAb === 'static' && b.rng.chance(3, 10)) trySetStatus(b, user, 'par', target);
  if (tAb === 'flamebody' && b.rng.chance(3, 10)) trySetStatus(b, user, 'brn', target);
  if (tAb === 'poisonpoint' && b.rng.chance(3, 10)) trySetStatus(b, user, 'psn', target);
  if (tAb === 'effectspore' && !user.types.includes('Grass') && user.ability !== 'overcoat' && user.item !== 'safetygoggles') { const r = b.rng.int(100); if (r < 11) trySetStatus(b, user, 'slp', target); else if (r < 21) trySetStatus(b, user, 'par', target); else if (r < 30) trySetStatus(b, user, 'psn', target); }
  if ((tAb === 'gooey' || tAb === 'tanglinghair')) applyBoosts(b, user, { spe: -1 }, target);
  if (tAb === 'aftermath' && target.fainted && !hasMagicGuard(user)) damageFraction(b, user, 1 / 4, Name(user) + ' was caught in the aftermath!');
  if (user.ability === 'poisontouch' && !target.fainted && b.rng.chance(3, 10)) trySetStatus(b, target, 'psn', user);
}
function secondaryEffects(b, user, target, move) {
  if (user.ability === 'sheerforce' && hasSecondary(move)) return;
  const secs = move.secondaries || (move.secondary ? [move.secondary] : []);
  for (const sec of secs) {
    let chance = sec.chance ?? 100;
    if (user.ability === 'serenegrace') chance *= 2;
    if (!b.rng.chance(chance, 100)) continue;
    if (sec.self) {
      if (sec.self.boosts) applyBoosts(b, user, sec.self.boosts, user);
      continue;
    }
    if (target.ability === 'shielddust' && !ignoresAbilities(user) || target.item === 'covertcloak') continue;
    if (sec.status) trySetStatus(b, target, sec.status, user);
    if (sec.volatileStatus === 'flinch') { if (!b.turnState.moved[target.side] && target.ability !== 'innerfocus') target.volatiles.flinch = true; }
    else if (sec.volatileStatus === 'confusion') addConfusion(b, target);
    else if (sec.volatileStatus === 'saltcure') { if (!target.volatiles.saltcure) { target.volatiles.saltcure = true; msg(b, Name(target) + ' is being salt cured!'); } }
    else if (sec.volatileStatus === 'syrupbomb') { target.volatiles.syrupbomb = { time: 3 }; msg(b, Name(target) + ' got covered in sticky candy syrup!'); }
    else if (sec.volatileStatus === 'healblock') target.volatiles.healblock = { time: 2 };
    else if (sec.volatileStatus === 'sparklingaria') { /* handled after hit */ }
    if (sec.boosts) applyBoosts(b, target, sec.boosts, user);
    // Callback-defined secondaries
    if (move.id === 'triattack') trySetStatus(b, target, b.rng.pick(['par', 'brn', 'frz']), user);
    if (move.id === 'direclaw') trySetStatus(b, target, b.rng.pick(['psn', 'par', 'slp']), user);
    if (move.id === 'alluringvoice' && b.turnState.statsRaised?.[target.side]) addConfusion(b, target);
    if (move.id === 'burningjealousy' && b.turnState.statsRaised?.[target.side]) trySetStatus(b, target, 'brn', user);
    if (move.id === 'eeriespell' && target.lastMove) { const s = target.moves.find(x => x.id === target.lastMove); if (s && s.pp) { s.pp = Math.max(0, s.pp - 3); msg(b, 'It reduced the PP of ' + name(target) + "'s " + D.moves[s.id].name + ' by 3!'); } }
  }
  // King's Rock / Razor Fang
  if ((user.item === 'kingsrock' || user.item === 'razorfang') && !secs.some(s => s.volatileStatus === 'flinch') && !b.turnState.moved[target.side] && b.rng.chance(1, 10)) target.volatiles.flinch = true;
}

// ---------- Damage calculation (Showdown getDamage) ----------
export function calcDamage(b, user, target, move, opts = {}) {
  const id = move.id;
  // Fixed damage
  if (move.damage === 'level') return { damage: user.level, crit: false };
  if (typeof move.damage === 'number') return { damage: move.damage, crit: false };
  if (move.ohko) return { damage: target.maxhp, crit: false };
  if (id === 'superfang' || id === 'naturesmadness' || id === 'ruination') return { damage: Math.max(1, Math.floor(target.hp / 2)), crit: false };
  if (id === 'finalgambit') return { damage: user.hp, crit: false };
  if (id === 'endeavor') return target.hp > user.hp ? { damage: target.hp - user.hp, crit: false } : { damage: null, fail: true };
  if (id === 'psywave') return { damage: Math.max(1, Math.floor(user.level * (b.rng.int(101) + 50) / 100)), crit: false };
  if (['counter', 'mirrorcoat', 'metalburst', 'comeuppance'].includes(id)) {
    const hit = b.turnState.damagedBy[user.side];
    const okCat = id === 'counter' ? hit?.cat === 'Physical' : id === 'mirrorcoat' ? hit?.cat === 'Special' : !!hit;
    if (!hit || !okCat || hit.from === user.side) return { damage: null, fail: true };
    return { damage: Math.floor(hit.damage * (id === 'counter' || id === 'mirrorcoat' ? 2 : 1.5)) || 1, crit: false };
  }
  const tAb = abilityOf(target, user);
  // Base power
  let bp = basePowerFor(b, user, target, move, opts.hitIndex || 0, opts.dry);
  if (!bp) return { damage: 0, crit: false };
  // Tera min 60
  if (user.terastallized && move.type === user.teraType && bp < 60 && move.pri <= 0 && !move.multihit && !['struggle', 'waterspout', 'eruption', 'dragonenergy'].includes(id) && move.damage === undefined) bp = 60;
  const bpc = new Chain();
  basePowerMods(b, user, target, move, bpc, tAb, bp, opts.dry);
  bp = Math.max(1, bpc.apply(bp));
  // Crit
  let critStage = (move.critRatio || 1) + (user.volatiles.focusenergy ? 2 : 0) + (user.item === 'scopelens' || user.item === 'razorclaw' ? 1 : 0) + (user.ability === 'superluck' ? 1 : 0) + (user.volatiles.dragoncheer ? 1 : 0);
  let crit = !!move.willCrit || user.volatiles.laserfocus;
  if (!crit) crit = b.rng.chance(1, [0, 24, 8, 2, 1][Math.min(4, critStage)]);
  if (opts.noRandom) crit = false;
  if (crit && (tAb === 'battlearmor' || tAb === 'shellarmor' || sideOf(b, target).cond.luckychant)) crit = false;
  // Attack / Defense
  const physical = move.cat === 'Physical';
  let atkStat = move.overrideOffensiveStat || (physical ? 'atk' : 'spa');
  let defStat = move.overrideDefensiveStat || (physical ? 'def' : 'spd');
  if (b.field.wonderroom) defStat = defStat === 'def' ? 'spd' : 'def';
  const atkSrc = move.overrideOffensivePokemon === 'target' ? target : user;
  let atkBoost = atkSrc.boosts[atkStat], defBoost = target.boosts[defStat];
  if (tAb === 'unaware') atkBoost = 0;
  if (user.ability === 'unaware' || move.ignoreDefensive) defBoost = 0;
  if (crit) { atkBoost = Math.max(0, atkBoost); defBoost = Math.min(0, defBoost); }
  let atk = boosted(atkSrc.stats[atkStat], atkBoost);
  let def = boosted(target.stats[defStat], defBoost);
  const ac = new Chain();
  attackMods(b, user, target, move, ac, atkStat, tAb);
  atk = ac.apply(atk);
  const w = weather(b);
  const dc = new Chain();
  if (w === 'sand' && target.types.includes('Rock') && defStat === 'spd') dc.mul(1.5);
  if ((w === 'snow') && target.types.includes('Ice') && defStat === 'def') dc.mul(1.5);
  if (target.item === 'assaultvest' && defStat === 'spd') dc.mul(1.5);
  if (target.item === 'eviolite' && target.hasEvo) dc.mul(1.5);
  if (tAb === 'furcoat' && defStat === 'def') dc.mul(2);
  if (tAb === 'marvelscale' && target.status && defStat === 'def') dc.mul(1.5);
  if (target.volatiles.paradox && target.volatiles.paradox.stat === defStat) dc.mul(5325, 4096);
  def = Math.max(1, dc.apply(def));
  // Base damage
  let dmg = tr(tr(tr(tr(2 * user.level / 5 + 2) * bp * atk) / def) / 50) + 2;
  // Weather
  if (w === 'rain' && move.type === 'Water' || w === 'sun' && move.type === 'Fire' && id !== 'hydrosteam') dmg = modify(dmg, 1.5);
  else if (w === 'sun' && id === 'hydrosteam') dmg = modify(dmg, 1.5);
  else if (w === 'rain' && move.type === 'Fire' || w === 'sun' && move.type === 'Water') dmg = modify(dmg, 0.5);
  if (crit) dmg = tr(dmg * 1.5);
  // Random 85-100
  dmg = opts.roll !== undefined ? tr(tr(dmg * (100 - opts.roll)) / 100) : tr(tr(dmg * (100 - b.rng.int(16))) / 100);
  // STAB
  let stab = 1;
  const orig = user.baseTypes.includes(move.type);
  if (move.type !== '???') {
    if (user.terastallized) {
      if (move.type === user.teraType) stab = orig ? 2 : 1.5;
      else if (orig) stab = 1.5;
      if (user.ability === 'adaptability' && move.type === user.teraType) stab = orig ? 2.25 : 2;
    } else if (user.types.includes(move.type)) stab = user.ability === 'adaptability' ? 2 : 1.5;
  }
  if (stab !== 1) dmg = modify(dmg, stab);
  // Type effectiveness
  const eff = opts.eff ?? typeEffectivenessFor(b, user, target, move);
  if (eff >= 2) { for (let e = eff; e >= 2; e /= 2) dmg *= 2; }
  else if (eff > 0 && eff < 1) { for (let e = eff; e < 1; e *= 2) dmg = tr(dmg / 2); }
  // Burn
  if (user.status === 'brn' && physical && user.ability !== 'guts' && id !== 'facade') dmg = modify(dmg, 0.5);
  if (!dmg) dmg = 1;
  // Final modifiers
  const fc = new Chain();
  const sc = sideOf(b, target).cond;
  if (!crit && user.ability !== 'infiltrator') {
    if (sc.auroraveil || (physical && sc.reflect) || (!physical && sc.lightscreen)) fc.mul(0.5);
  }
  if (eff > 1 && (tAb === 'filter' || tAb === 'solidrock' || target.ability === 'prismarmor')) fc.mul(0.75);
  if ((tAb === 'multiscale' || target.ability === 'shadowshield') && target.hp === target.maxhp) fc.mul(0.5);
  if (tAb === 'fluffy' && move.flags?.includes('contact') && move.type !== 'Fire') fc.mul(0.5);
  if (tAb === 'fluffy' && move.type === 'Fire' && !move.flags?.includes('contact')) fc.mul(2);
  if (tAb === 'icescales' && !physical) fc.mul(0.5);
  if (tAb === 'punkrock' && move.flags?.includes('sound')) fc.mul(0.5);
  if (user.ability === 'tintedlens' && eff < 1) fc.mul(2);
  if (user.ability === 'sniper' && crit) fc.mul(1.5);
  if (user.item === 'expertbelt' && eff > 1) fc.mul(4915, 4096);
  if (user.item === 'lifeorb') fc.mul(5324, 4096);
  if (SEMI_HITS.dig.includes(id) && target.volatiles.twoturnmove?.semi === 'dig' || SEMI_HITS.dive.includes(id) && target.volatiles.twoturnmove?.semi === 'dive') fc.mul(2);
  if (target.volatiles.minimize && ['stomp', 'heavyslam', 'heatcrash', 'bodyslam', 'dragonrush', 'flyingpress', 'steamroller', 'maliciousmoonsault', 'supercellslam'].includes(id)) fc.mul(2);
  if (move.id === 'collisioncourse' || move.id === 'electrodrift') { if (eff > 1) fc.mul(5461, 4096); }
  dmg = fc.apply(dmg);
  return { damage: Math.max(1, dmg), crit };
}
function basePowerFor(b, user, target, move, hit, dry) {
  const id = move.id;
  let bp = move.bp;
  const hpRatio = (m) => m.hp / m.maxhp;
  const spe = (m) => speedOf(b, m);
  switch (id) {
    case 'acrobatics': return user.item ? 55 : 110;
    case 'assurance': return b.turnState.hitThisTurn[target.side] ? 120 : 60;
    case 'avalanche': case 'revenge': return b.turnState.damagedBy[user.side]?.from === target.side ? bp * 2 : bp;
    case 'boltbeak': case 'fishiousrend': return !b.turnState.moved[target.side] ? bp * 2 : bp;
    case 'crushgrip': case 'wringout': return Math.max(1, Math.floor(120 * target.hp / target.maxhp));
    case 'hardpress': return Math.max(1, Math.floor(100 * target.hp / target.maxhp));
    case 'dragonenergy': case 'eruption': case 'waterspout': return Math.max(1, Math.floor(150 * user.hp / user.maxhp));
    case 'electroball': { const r = Math.floor(spe(user) / Math.max(1, spe(target))); return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; }
    case 'gyroball': return Math.min(150, Math.floor(25 * spe(target) / Math.max(1, spe(user))) + 1);
    case 'flail': case 'reversal': { const r = Math.floor(48 * user.hp / user.maxhp); return r <= 1 ? 200 : r <= 4 ? 150 : r <= 9 ? 100 : r <= 16 ? 80 : r <= 32 ? 40 : 20; }
    case 'return': return Math.max(1, Math.floor(user.friendship * 10 / 25));
    case 'frustration': return Math.max(1, Math.floor((255 - user.friendship) * 10 / 25));
    case 'grassknot': case 'lowkick': { const w = target.weight; return w >= 200 ? 120 : w >= 100 ? 100 : w >= 50 ? 80 : w >= 25 ? 60 : w >= 10 ? 40 : 20; }
    case 'heatcrash': case 'heavyslam': { const r = user.weight / target.weight; return r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40; }
    case 'hex': case 'infernalparade': return target.status ? bp * 2 : bp;
    case 'lastrespects': return 50 + 50 * sideOf(b, user).team.filter(m => m.fainted).length;
    case 'payback': return b.turnState.moved[target.side] ? bp * 2 : bp;
    case 'powertrip': case 'storedpower': return 20 + 20 * Object.values(user.boosts).reduce((s, v) => s + Math.max(0, v), 0);
    case 'punishment': return Math.min(200, 60 + 20 * Object.values(target.boosts).reduce((s, v) => s + Math.max(0, v), 0));
    case 'ragefist': return Math.min(350, 50 + 50 * user.timesHit);
    case 'risingvoltage': return b.field.terrain === 'electricterrain' && isGrounded(b, target) ? 140 : 70;
    case 'stompingtantrum': case 'temperflare': return user.lastMoveFailed ? bp * 2 : bp;
    case 'tripleaxel': return 20 * (hit + 1);
    case 'triplekick': return 10 * (hit + 1);
    case 'wakeupslap': return target.status === 'slp' ? bp * 2 : bp;
    case 'smellingsalts': return target.status === 'par' ? bp * 2 : bp;
    case 'furycutter': { const n = user.lastMove === 'furycutter' ? (user.volatiles.furycutter || 1) + 1 : 1; if (!dry) user.volatiles.furycutter = n; return Math.min(160, 40 * Math.pow(2, n - 1)); }
    case 'terablast': return user.terastallized && user.teraType === 'Stellar' ? 100 : bp;
    case 'ficklebeam': return b.rng.chance(3, 10) ? bp * 2 : bp;
    case 'weatherball': return weather(b) ? 100 : 50;
    case 'terrainpulse': return b.field.terrain && isGrounded(b, user) ? 100 : 50;
    case 'watershuriken': return user.species === 'greninja' ? 20 : bp;
  }
  return bp;
}
function basePowerMods(b, user, target, move, c, tAb, bp, dry) {
  const id = move.id;
  if (id === 'brine' && target.hp * 2 <= target.maxhp) c.mul(2);
  if (id === 'facade' && user.status && user.status !== 'slp') c.mul(2);
  if (id === 'knockoff' && target.item) c.mul(1.5);
  if ((id === 'venoshock' || id === 'barbbarrage') && (target.status === 'psn' || target.status === 'tox')) c.mul(2);
  if (id === 'expandingforce' && b.field.terrain === 'psychicterrain' && isGrounded(b, user)) c.mul(1.5);
  if (id === 'gravapple' && b.field.gravity) c.mul(1.5);
  if (id === 'lashout' && b.turnState.statsLowered[user.side]) c.mul(2);
  if (id === 'mistyexplosion' && b.field.terrain === 'mistyterrain' && isGrounded(b, user)) c.mul(1.5);
  if (id === 'psyblade' && b.field.terrain === 'electricterrain') c.mul(1.5);
  if (id === 'retaliate' && sideOf(b, user).faintedLastTurn) c.mul(2);
  if ((id === 'solarbeam' || id === 'solarblade') && ['rain', 'sand', 'snow', 'hail'].includes(weather(b))) c.mul(0.5);
  if (user.volatiles.charge && move.type === 'Electric') { c.mul(2); if (!dry) delete user.volatiles.charge; }
  if (user.volatiles.flashfire && move.type === 'Fire') c.mul(1.5);
  // Terrain
  const tr2 = b.field.terrain;
  if (isGrounded(b, user)) {
    if (tr2 === 'electricterrain' && move.type === 'Electric' || tr2 === 'grassyterrain' && move.type === 'Grass' || tr2 === 'psychicterrain' && move.type === 'Psychic') c.mul(5325, 4096);
  }
  if (tr2 === 'mistyterrain' && move.type === 'Dragon' && isGrounded(b, target)) c.mul(0.5);
  if (tr2 === 'grassyterrain' && ['earthquake', 'bulldoze', 'magnitude'].includes(id) && isGrounded(b, target)) c.mul(0.5);
  // Abilities
  const ab = user.ability, f = move.flags || [];
  if (ab === 'technician' && bp <= 60) c.mul(1.5);
  if (ab === 'ironfist' && f.includes('punch')) c.mul(4915, 4096);
  if (ab === 'strongjaw' && f.includes('bite')) c.mul(1.5);
  if (ab === 'megalauncher' && f.includes('pulse')) c.mul(1.5);
  if (ab === 'sharpness' && f.includes('slicing')) c.mul(1.5);
  if (ab === 'toughclaws' && f.includes('contact')) c.mul(5325, 4096);
  if (ab === 'sheerforce' && hasSecondary(move)) c.mul(5325, 4096);
  if (ab === 'reckless' && (move.recoil || move.hasCrashDamage)) c.mul(4915, 4096);
  if (ab === 'punkrock' && f.includes('sound')) c.mul(5325, 4096);
  if (ab === 'sandforce' && weather(b) === 'sand' && ['Rock', 'Ground', 'Steel'].includes(move.type)) c.mul(5325, 4096);
  if (['pixilate', 'aerilate', 'refrigerate', 'galvanize', 'normalize'].includes(ab) && D.moves[id]?.type === 'Normal' && move.cat !== 'Status') c.mul(4915, 4096);
  if (tAb === 'heatproof' && move.type === 'Fire') c.mul(0.5);
  if (tAb === 'dryskin' && move.type === 'Fire') c.mul(1.25);
  // Items
  const it = user.item;
  if (it === 'muscleband' && move.cat === 'Physical') c.mul(4505, 4096);
  if (it === 'wiseglasses' && move.cat === 'Special') c.mul(4505, 4096);
  if (it === 'punchingglove' && f.includes('punch')) c.mul(4506, 4096);
  if (it && TYPE_BOOST_ITEMS[it] === move.type) c.mul(4915, 4096);
}
export const TYPE_BOOST_ITEMS = { charcoal: 'Fire', mysticwater: 'Water', miracleseed: 'Grass', magnet: 'Electric', nevermeltice: 'Ice', blackbelt: 'Fighting', poisonbarb: 'Poison', softsand: 'Ground', sharpbeak: 'Flying', twistedspoon: 'Psychic', silverpowder: 'Bug', hardstone: 'Rock', spelltag: 'Ghost', dragonfang: 'Dragon', blackglasses: 'Dark', metalcoat: 'Steel', silkscarf: 'Normal', fairyfeather: 'Fairy' };
function attackMods(b, user, target, move, c, stat, tAb) {
  const ab = user.ability;
  if ((ab === 'hugepower' || ab === 'purepower') && stat === 'atk') c.mul(2);
  if (ab === 'guts' && user.status && stat === 'atk') c.mul(1.5);
  if (ab === 'hustle' && stat === 'atk') c.mul(1.5);
  if (ab === 'gorillatactics' && stat === 'atk') c.mul(1.5);
  if (ab === 'defeatist' && user.hp * 2 <= user.maxhp) c.mul(0.5);
  if (ab === 'solarpower' && stat === 'spa' && weather(b) === 'sun') c.mul(1.5);
  const pinch = { blaze: 'Fire', torrent: 'Water', overgrow: 'Grass', swarm: 'Bug' }[ab];
  if (pinch === move.type && user.hp * 3 <= user.maxhp) c.mul(1.5);
  if (ab === 'waterbubble' && move.type === 'Water') c.mul(2);
  if (ab === 'steelworker' && move.type === 'Steel' || ab === 'dragonsmaw' && move.type === 'Dragon' || ab === 'rockypayload' && move.type === 'Rock') c.mul(1.5);
  if (ab === 'transistor' && move.type === 'Electric') c.mul(5325, 4096);
  if (ab === 'orichalcumpulse' && stat === 'atk' && weather(b) === 'sun') c.mul(5461, 4096);
  if (ab === 'hadronengine' && stat === 'spa' && b.field.terrain === 'electricterrain') c.mul(5461, 4096);
  if (user.volatiles.paradox?.stat === stat) c.mul(5325, 4096);
  if (user.item === 'choiceband' && stat === 'atk' || user.item === 'choicespecs' && stat === 'spa') c.mul(1.5);
  if ((tAb === 'thickfat') && (move.type === 'Fire' || move.type === 'Ice')) c.mul(0.5);
  if (tAb === 'waterbubble' && move.type === 'Fire') c.mul(0.5);
  if (tAb === 'purifyingsalt' && move.type === 'Ghost') c.mul(0.5);
}

// ---------- Status-category moves ----------
function statusMoveOnTarget(b, user, target, move) {
  const id = move.id;
  const fail = () => { msg(b, 'But it failed!'); return false; };
  if (target.volatiles.substitute && !move.flags?.includes('sound') && !move.flags?.includes('bypasssub') && user.ability !== 'infiltrator' && target !== user) {
    if (move.status || move.boosts || move.volatileStatus) return fail();
  }
  let did = false;
  if (move.status) {
    did = trySetStatus(b, target, move.status, user, 'move', move) || did;
    if (!did) return false;
  }
  if (move.boosts) {
    if (target.volatiles.substitute && target !== user) return fail();
    did = applyBoosts(b, target, move.boosts, user, true) || did;
  }
  if (move.volatileStatus) did = addVolatile(b, user, target, move.volatileStatus, move) || did;
  if (move.forceSwitch) { if (!dragOut(b, target)) return fail(); did = true; }
  if (move.sideCondition && ['spikes', 'toxicspikes', 'stealthrock', 'stickyweb'].includes(move.sideCondition)) did = setHazard(b, target, move.sideCondition) || did;
  switch (id) {
    case 'painsplit': { const avg = Math.floor((user.hp + target.hp) / 2); setHp(b, user, avg); setHp(b, target, avg); msg(b, 'The battlers shared their pain!'); did = true; break; }
    case 'strengthsap': { const a = boosted(target.stats.atk, target.boosts.atk); if (target.boosts.atk <= -6) return fail(); applyBoosts(b, target, { atk: -1 }, user); heal(b, user, a, Name(target) + ' had its energy drained!'); did = true; break; }
    case 'psychup': user.boosts = { ...target.boosts }; msg(b, Name(user) + ' copied ' + name(target) + "'s stat changes!"); did = true; break;
    case 'topsyturvy': for (const k in target.boosts) target.boosts[k] = -target.boosts[k]; msg(b, Name(target) + "'s stat changes were all reversed!"); did = true; break;
    case 'trick': case 'switcheroo': { if (!user.item && !target.item) return fail(); [user.item, target.item] = [target.item, user.item]; delete user.volatiles.choicelock; delete target.volatiles.choicelock; msg(b, Name(user) + ' switched items with its target!'); did = true; break; }
    case 'soak': target.types = ['Water']; msg(b, Name(target) + ' transformed into the Water type!'); did = true; break;
    case 'magicpowder': target.types = ['Psychic']; msg(b, Name(target) + ' transformed into the Psychic type!'); did = true; break;
    case 'worryseed': target.ability = 'insomnia'; if (target.status === 'slp') cureStatus(b, target, ''); msg(b, Name(target) + ' acquired Insomnia!'); did = true; break;
    case 'simplebeam': target.ability = 'simple'; msg(b, Name(target) + ' acquired Simple!'); did = true; break;
    case 'entrainment': target.ability = user.ability; msg(b, Name(target) + ' acquired ' + (D.abilities[user.ability]?.name || user.ability) + '!'); did = true; break;
    case 'gastroacid': target.ability = ''; msg(b, Name(target) + "'s Ability was suppressed!"); did = true; break;
    case 'speedswap': [user.stats.spe, target.stats.spe] = [target.stats.spe, user.stats.spe]; msg(b, Name(user) + ' switched Speed with its target!'); did = true; break;
    case 'guardsplit': for (const s of ['def', 'spd']) { const a = Math.floor((user.stats[s] + target.stats[s]) / 2); user.stats[s] = target.stats[s] = a; } msg(b, Name(user) + ' shared its guard with the target!'); did = true; break;
    case 'powersplit': for (const s of ['atk', 'spa']) { const a = Math.floor((user.stats[s] + target.stats[s]) / 2); user.stats[s] = target.stats[s] = a; } msg(b, Name(user) + ' shared its power with the target!'); did = true; break;
    case 'heartswap': case 'powerswap': case 'guardswap': { const keys = id === 'heartswap' ? Object.keys(user.boosts) : id === 'powerswap' ? ['atk', 'spa'] : ['def', 'spd']; for (const k of keys) [user.boosts[k], target.boosts[k]] = [target.boosts[k], user.boosts[k]]; msg(b, Name(user) + ' switched stat changes with its target!'); did = true; break; }
    case 'venomdrench': if (target.status !== 'psn' && target.status !== 'tox') return fail(); applyBoosts(b, target, { atk: -1, spa: -1, spe: -1 }, user); did = true; break;
    case 'defog': { applyBoosts(b, target, { evasion: -1 }, user); clearHazards(b, user, true); clearHazards(b, target, true); const c = sideOf(b, target).cond; for (const k of ['reflect', 'lightscreen', 'auroraveil', 'safeguard', 'mist']) delete c[k]; if (b.field.terrain) { b.field.terrain = null; push(b, { t: 'terrain', terrain: null }); } did = true; break; }
    case 'partingshot': { const ok = applyBoosts(b, target, { atk: -1, spa: -1 }, user, true); if (ok && benchIndexes(b, user.side).length) requestPivot(b, user, 'switch'); did = true; break; }
    case 'yawn': if (target.status || target.volatiles.yawn) return fail(); target.volatiles.yawn = { time: 2 }; msg(b, Name(user) + ' made ' + name(target) + ' drowsy!'); did = true; break;
    case 'block': case 'meanlook': case 'spiderweb': if (target.volatiles.trapped) return fail(); target.volatiles.trapped = true; msg(b, Name(target) + ' can no longer escape!'); did = true; break;
    case 'encore': { if (!target.lastMove || target.volatiles.encore || ['encore', 'struggle', 'transform', 'mimic'].includes(target.lastMove)) return fail(); target.volatiles.encore = { move: target.lastMove, time: 3 }; msg(b, Name(target) + ' must do an encore!'); did = true; break; }
    case 'disable': { if (!target.lastMove || target.volatiles.disable) return fail(); target.volatiles.disable = { move: target.lastMove, time: 4 }; msg(b, Name(target) + "'s " + D.moves[target.lastMove].name + ' was disabled!'); did = true; break; }
    case 'lockon': case 'mindreader': user.volatiles.lockon = true; msg(b, Name(user) + ' took aim at ' + name(target) + '!'); did = true; break;
    case 'curse': if (user.types.includes('Ghost')) { if (target.volatiles.curse) return fail(); applyDamage(b, user, Math.floor(user.maxhp / 2), null); target.volatiles.curse = true; msg(b, Name(user) + ' cut its own HP and put a curse on ' + name(target) + '!'); did = true; } break;
    case 'attract': { const g = user.gender, t = target.gender; if (g === 'N' || t === 'N' || g === t || target.volatiles.attract || target.ability === 'oblivious') return fail(); target.volatiles.attract = true; msg(b, Name(target) + ' fell in love!'); did = true; break; }
  }
  if (!did && !move.status && !move.boosts && !move.volatileStatus) return fail();
  return did;
}
function selfOrFieldMove(b, user, move) {
  const id = move.id;
  const fail = () => { msg(b, 'But it failed!'); return false; };
  let did = false;
  // Protect family
  if (move.stallingMove || id === 'endure') {
    const n = user.volatiles.stall?.count || 0;
    if (!benchFirstMove(b, user) || (n && !b.rng.chance(1, Math.pow(3, n)))) { delete user.volatiles.stall; return fail(); }
    user.volatiles.stall = { count: n + 1, turn: b.turn };
    if (id === 'endure') { user.volatiles.endure = true; msg(b, Name(user) + ' braced itself!'); }
    else { user.volatiles.protect = { kind: id }; msg(b, Name(user) + ' protected itself!'); }
    return true;
  }
  if (id === 'substitute' || id === 'shedtail') {
    const cost = id === 'shedtail' ? Math.ceil(user.maxhp / 2) : Math.floor(user.maxhp / 4);
    if (user.volatiles.substitute || user.hp <= cost) { msg(b, user.volatiles.substitute ? Name(user) + ' already has a substitute!' : 'But it does not have enough HP left to make a substitute!'); return false; }
    if (id === 'shedtail' && !benchIndexes(b, user.side).length) return fail();
    applyDamage(b, user, cost, null);
    user.volatiles.substitute = { hp: Math.floor(user.maxhp / 4) };
    push(b, { t: 'sub', side: user.side, active: true });
    msg(b, Name(user) + (id === 'shedtail' ? ' shed its tail to create a decoy!' : ' put in a substitute!'));
    if (id === 'shedtail') requestPivot(b, user, 'shedtail');
    return true;
  }
  if (id === 'bellydrum') { if (user.hp <= user.maxhp / 2 || user.boosts.atk >= 6) return fail(); applyDamage(b, user, Math.floor(user.maxhp / 2), null); user.boosts.atk = 6; push(b, { t: 'boost', side: user.side, stat: 'atk', amount: 12 }); msg(b, Name(user) + ' cut its own HP and maximized its Attack!'); return true; }
  if (id === 'clangoroussoul' || id === 'filletaway') { const cost = Math.floor(user.maxhp / (id === 'filletaway' ? 2 : 3)); if (user.hp <= cost) return fail(); applyDamage(b, user, cost, null); applyBoosts(b, user, move.boosts || (id === 'filletaway' ? { atk: 2, spa: 2, spe: 2 } : { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }), user); return true; }
  if (id === 'curse' && !user.types.includes('Ghost')) { applyBoosts(b, user, { spe: -1, atk: 1, def: 1 }, user); return true; }
  if (id === 'curse') return statusMoveOnTarget(b, user, foeOf(b, user), move);
  if (id === 'noretreat') { if (user.volatiles.noretreat) return fail(); applyBoosts(b, user, { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, user); user.volatiles.noretreat = true; msg(b, Name(user) + ' can no longer escape because it used No Retreat!'); return true; }
  if (id === 'acupressure') { const opts = Object.keys(user.boosts).filter(k => user.boosts[k] < 6); if (!opts.length) return fail(); applyBoosts(b, user, { [b.rng.pick(opts)]: 2 }, user); return true; }
  if (id === 'growth') { const n = weather(b) === 'sun' ? 2 : 1; return applyBoosts(b, user, { atk: n, spa: n }, user); }
  if (id === 'autotomize') { const ok = applyBoosts(b, user, { spe: 2 }, user); if (ok) { user.weight = Math.max(0.1, user.weight - 100); msg(b, Name(user) + ' became nimble!'); } return ok; }
  if (id === 'takeheart') { if (user.status) cureStatus(b, user, Name(user) + "'s status returned to normal!"); applyBoosts(b, user, { spa: 1, spd: 1 }, user); return true; }
  if (['morningsun', 'moonlight', 'synthesis'].includes(id)) { const w = weather(b); const frac = w === 'sun' ? 2 / 3 : w ? 1 / 4 : 1 / 2; return heal(b, user, Math.round(user.maxhp * frac), Name(user) + ' restored HP!', false, true); }
  if (id === 'shoreup') { return heal(b, user, Math.round(user.maxhp * (weather(b) === 'sand' ? 2 / 3 : 1 / 2)), Name(user) + ' restored HP!', false, true); }
  if (['refresh', 'healbell', 'aromatherapy', 'junglehealing', 'lunarblessing', 'purify'].includes(id)) {
    if (id === 'healbell' || id === 'aromatherapy') { for (const m of sideOf(b, user).team) if (m.status && !m.fainted) { m.status = null; push(b, { t: 'status', side: m.side, idx: m.idx, status: null }); } msg(b, 'A soothing aroma wafted through the area!'); return true; }
    if (id === 'junglehealing' || id === 'lunarblessing') { heal(b, user, Math.round(user.maxhp / 4), Name(user) + ' restored HP!'); if (user.status) cureStatus(b, user, Name(user) + "'s status returned to normal!"); return true; }
    if (!user.status) return fail();
    cureStatus(b, user, Name(user) + "'s status returned to normal!"); return true;
  }
  if (id === 'wish') { const s = sideOf(b, user); if (s.slot.wish) return fail(); s.slot.wish = { hp: Math.floor(user.maxhp / 2), turn: b.turn + 1, from: user.name }; msg(b, Name(user) + ' made a wish!'); return true; }
  if (id === 'healingwish' || id === 'lunardance') { if (!benchIndexes(b, user.side).length) return fail(); sideOf(b, user).slot.healingwish = true; applyDamage(b, user, user.hp, null, true); return true; }
  if (id === 'destinybond') { user.volatiles.destinybond = true; msg(b, Name(user) + ' is hoping to take its attacker down with it!'); return true; }
  if (id === 'haze') { for (const s of Object.values(b.sides)) { const m = s.team[s.active]; if (m) m.boosts = zeroBoosts(); } msg(b, 'All stat changes were eliminated!'); return true; }
  if (id === 'perishsong') { for (const s of Object.values(b.sides)) { const m = s.team[s.active]; if (m && !m.volatiles.perish && m.ability !== 'soundproof') m.volatiles.perish = { time: 4 }; } msg(b, 'All Pokémon that heard the song will faint in three turns!'); return true; }
  if (id === 'courtchange') { const a = b.sides.p.cond, e = b.sides.e.cond; b.sides.p.cond = e; b.sides.e.cond = a; msg(b, Name(user) + ' swapped the battle effects affecting each side of the field!'); return true; }
  if (id === 'tidyup') { clearHazards(b, user, true); clearHazards(b, foeOf(b, user), true); return applyBoosts(b, user, { atk: 1, spe: 1 }, user) || true; }
  if (id === 'chillyreception') { setWeather(b, 'snowscape', user); if (benchIndexes(b, user.side).length) requestPivot(b, user, 'switch'); return true; }
  if (id === 'teleport' || id === 'batonpass') { if (!benchIndexes(b, user.side).length) return fail(); requestPivot(b, user, id === 'batonpass' ? 'batonpass' : 'switch'); return true; }
  if (id === 'roost') { const ok = heal(b, user, Math.round(user.maxhp / 2), Name(user) + ' restored HP!', false, true); if (ok) user.volatiles.roost = true; return ok; }
  if (id === 'sleeptalk' || id === 'metronome') return true;
  // Generic data-driven parts
  if (move.heal) { did = heal(b, user, Math.round(user.maxhp * move.heal[0] / move.heal[1]), Name(user) + ' restored HP!', false, true) || did; if (!did) return false; }
  if (move.boosts && (move.target === 'self' || move.target === 'adjacentAllyOrSelf' || move.target === 'allySide' || move.target === 'allies')) did = applyBoosts(b, user, move.boosts, user, true) || did;
  if (move.self?.boosts && !move.boosts) did = applyBoosts(b, user, move.self.boosts, user, true) || did;
  if (move.volatileStatus) did = addVolatile(b, user, user, move.volatileStatus, move) || did;
  if (move.weather) did = setWeather(b, move.weather, user, true) || did;
  if (move.terrain) did = setTerrain(b, move.terrain, user, true) || did;
  if (move.pseudoWeather) {
    const f = b.field;
    if (move.pseudoWeather === 'trickroom') { if (f.trickRoom) { f.trickRoom = 0; msg(b, 'The twisted dimensions returned to normal!'); } else { f.trickRoom = 5; msg(b, Name(user) + ' twisted the dimensions!'); } push(b, { t: 'field', trickRoom: f.trickRoom }); did = true; }
    else if (move.pseudoWeather === 'gravity') { if (f.gravity) return fail(); f.gravity = 5; msg(b, 'Gravity intensified!'); did = true; }
    else if (move.pseudoWeather === 'wonderroom') { f.wonderroom = f.wonderroom ? 0 : 5; msg(b, 'It created a bizarre area in which Defense and Sp. Def stats are swapped!'); did = true; }
    else { msg(b, move.name + ' had no effect in this battle.'); did = true; }
  }
  if (move.sideCondition) {
    const sc = move.sideCondition;
    if (['spikes', 'toxicspikes', 'stealthrock', 'stickyweb'].includes(sc)) did = setHazard(b, foeOf(b, user) || { side: user.side === 'p' ? 'e' : 'p' }, sc) || did;
    else {
      const cond = sideOf(b, user).cond;
      if (cond[sc]) return fail();
      const turns = sc === 'tailwind' ? 4 : (['reflect', 'lightscreen', 'auroraveil'].includes(sc) && user.item === 'lightclay') ? 8 : 5;
      cond[sc] = { turns };
      const text = { reflect: 'Reflect made your team stronger against physical moves!', lightscreen: 'Light Screen made your team stronger against special moves!', auroraveil: 'Aurora Veil made your team stronger against physical and special moves!', tailwind: 'The Tailwind blew from behind your team!', safeguard: 'Your team cloaked itself in a mystical veil!', mist: 'Your team became shrouded in mist!', luckychant: 'Lucky Chant shielded your team from critical hits!' }[sc] || move.name + ' took effect!';
      msg(b, user.side === 'e' ? text.replace('your team', 'the opposing team').replace('Your team', 'The opposing team') : text);
      push(b, { t: 'side', side: user.side, cond: sc, on: true });
      did = true;
    }
  }
  if (move.slotCondition === 'Wish') did = true;
  if (!did) return fail();
  return true;
}
function benchFirstMove(b, user) { return true; }

// ---------- Effects helpers ----------
function trySetStatus(b, mon, status, source, why, move) {
  if (mon.fainted) return false;
  const fromMove = why === 'move';
  const say = t => { if (fromMove) msg(b, t); };
  if (mon.status) { if (fromMove) say(mon.status === status ? Name(mon) + ' is already ' + STATUS_NAMES[status] + '!' : 'But it failed!'); return false; }
  const ab = abilityOf(mon, source);
  const grounded = isGrounded(b, mon);
  if (sideOf(b, mon).cond.safeguard && source && source.side !== mon.side && source.ability !== 'infiltrator') { say(Name(mon) + ' is protected by Safeguard!'); return false; }
  if (b.field.terrain === 'mistyterrain' && grounded) { say(Name(mon) + ' surrounds itself with a protective mist!'); return false; }
  if (ab === 'purifyingsalt' || ab === 'comatose' || (ab === 'leafguard' && weather(b) === 'sun')) { say("It doesn't affect " + name(mon) + '...'); return false; }
  if ((status === 'psn' || status === 'tox') && (mon.types.includes('Poison') || mon.types.includes('Steel')) && source?.ability !== 'corrosion') { say("It doesn't affect " + name(mon) + '...'); return false; }
  if ((status === 'psn' || status === 'tox') && (ab === 'immunity' || ab === 'pastelveil')) { say("It doesn't affect " + name(mon) + '...'); return false; }
  if (status === 'brn' && (mon.types.includes('Fire') || ab === 'waterveil' || ab === 'waterbubble' || ab === 'thermalexchange')) { say("It doesn't affect " + name(mon) + '...'); return false; }
  if (status === 'par' && (mon.types.includes('Electric') || ab === 'limber')) { say("It doesn't affect " + name(mon) + '...'); return false; }
  if (status === 'frz' && (mon.types.includes('Ice') || ab === 'magmaarmor' || weather(b) === 'sun')) return false;
  if (status === 'slp' && (ab === 'insomnia' || ab === 'vitalspirit' || ab === 'sweetveil' || b.field.terrain === 'electricterrain' && grounded)) { say("It doesn't affect " + name(mon) + '...'); return false; }
  if (move?.id === 'thunderwave' && effectiveness('Electric', mon.types) === 0) { say("It doesn't affect " + name(mon) + '...'); return false; }
  mon.status = status;
  mon.statusState = {};
  if (status === 'slp') { const t = b.rng.pick([2, 3, 3]); mon.statusState = { time: t, start: t }; }
  if (status === 'frz') mon.statusState = { time: 3 };
  if (status === 'tox') mon.statusState = { toxN: 1 };
  push(b, { t: 'status', side: mon.side, idx: mon.idx, status });
  msg(b, Name(mon) + STATUS_TEXT[status]);
  if (mon.item === 'lumberry' || mon.item === 'chestoberry' && status === 'slp') { const berry = mon.item; consumeItem(b, mon); msg(b, Name(mon) + "'s " + itemName(berry) + ' cured its status!'); mon.status = null; push(b, { t: 'status', side: mon.side, idx: mon.idx, status: null }); }
  if (mon.ability === 'synchronize' && source && source !== mon && ['brn', 'par', 'psn', 'tox'].includes(status) && !source.status) trySetStatus(b, source, status === 'tox' ? 'tox' : status, mon);
  if (mon.ability === 'quickfeet' || mon.ability === 'guts') { /* passive */ }
  if (mon.item === 'flameorb' || mon.item === 'toxicorb') { /* passive */ }
  return true;
}
export const STATUS_NAMES = { brn: 'burned', par: 'paralyzed', psn: 'poisoned', tox: 'badly poisoned', slp: 'asleep', frz: 'frozen' };
const STATUS_TEXT = { brn: ' was burned!', par: ' is paralyzed! It may be unable to move!', psn: ' was poisoned!', tox: ' was badly poisoned!', slp: ' fell asleep!', frz: ' was frozen solid!' };
function cureStatus(b, mon, text) { mon.status = null; mon.statusState = {}; push(b, { t: 'status', side: mon.side, idx: mon.idx, status: null }); if (text) msg(b, text); }
function addConfusion(b, mon, fatigue) {
  if (mon.volatiles.confusion || mon.fainted) return false;
  if (mon.ability === 'owntempo' || b.field.terrain === 'mistyterrain' && isGrounded(b, mon)) return false;
  mon.volatiles.confusion = { time: 2 + b.rng.int(4) };
  msg(b, Name(mon) + (fatigue ? ' became confused due to fatigue!' : ' became confused!'));
  return true;
}
function addVolatile(b, user, target, v, move) {
  const mon = target;
  switch (v) {
    case 'confusion': if (mon.volatiles.confusion) { msg(b, Name(mon) + ' is already confused!'); return false; } return addConfusion(b, mon);
    case 'leechseed': if (mon.types.includes('Grass') || mon.volatiles.leechseed) { msg(b, "It doesn't affect " + name(mon) + '...'); return false; } mon.volatiles.leechseed = true; msg(b, Name(mon) + ' was seeded!'); return true;
    case 'taunt': if (mon.volatiles.taunt || mon.ability === 'oblivious') return false; mon.volatiles.taunt = { time: b.turnState.moved[mon.side] ? 4 : 3 }; msg(b, Name(mon) + ' fell for the taunt!'); return true;
    case 'torment': if (mon.volatiles.torment) return false; mon.volatiles.torment = true; msg(b, Name(mon) + ' was subjected to torment!'); return true;
    case 'focusenergy': if (mon.volatiles.focusenergy) return false; mon.volatiles.focusenergy = true; msg(b, Name(mon) + ' is getting pumped!'); return true;
    case 'dragoncheer': mon.volatiles.dragoncheer = true; msg(b, Name(mon) + ' is getting pumped!'); return true;
    case 'aquaring': mon.volatiles.aquaring = true; msg(b, Name(mon) + ' surrounded itself with a veil of water!'); return true;
    case 'ingrain': mon.volatiles.ingrain = true; msg(b, Name(mon) + ' planted its roots!'); return true;
    case 'charge': mon.volatiles.charge = true; applyBoosts(b, mon, { spd: 1 }, mon); msg(b, Name(mon) + ' began charging power!'); return true;
    case 'magnetrise': if (mon.volatiles.magnetrise || mon.volatiles.ingrain) return false; mon.volatiles.magnetrise = { time: 5 }; msg(b, Name(mon) + ' levitated with electromagnetism!'); return true;
    case 'partiallytrapped': if (!mon.volatiles.partiallytrapped) { mon.volatiles.partiallytrapped = { time: user.item === 'gripclaw' ? 7 : 4 + b.rng.int(2), frac: user.item === 'bindingband' ? 6 : 8, move: move.name, src: user }; msg(b, Name(mon) + ' was trapped by ' + move.name + '!'); } return true;
    case 'laserfocus': mon.volatiles.laserfocus = { time: 2 }; msg(b, Name(mon) + ' concentrated intensely!'); return true;
    case 'minimize': mon.volatiles.minimize = true; return true;
    case 'defensecurl': mon.volatiles.defensecurl = true; return true;
    case 'smackdown': mon.volatiles.smackdown = true; return true;
    case 'miracleeye': case 'foresight': mon.volatiles.miracleeye = true; msg(b, Name(mon) + ' was identified!'); return true;
    case 'healblock': mon.volatiles.healblock = { time: 5 }; msg(b, Name(mon) + ' was prevented from healing!'); return true;
    case 'stockpile': mon.volatiles.stockpile = Math.min(3, (mon.volatiles.stockpile || 0) + 1); msg(b, Name(mon) + ' stockpiled ' + mon.volatiles.stockpile + '!'); return true;
    case 'tarshot': mon.volatiles.tarshot = true; return true;
    case 'octolock': mon.volatiles.octolock = true; msg(b, Name(mon) + ' can no longer escape!'); return true;
    case 'gastroacid': mon.ability = ''; msg(b, Name(mon) + "'s Ability was suppressed!"); return true;
    case 'attract': case 'encore': case 'disable': case 'yawn': case 'curse': case 'destinybond': case 'substitute': case 'protect': case 'endure': return false;
    case 'nightmare': if (mon.status !== 'slp') return false; mon.volatiles.nightmare = true; msg(b, Name(mon) + ' began having a nightmare!'); return true;
    default: msg(b, move.name + "'s special effect is not simulated yet."); return true;
  }
}
export function applyBoosts(b, mon, boosts, source, fromMove) {
  if (mon.fainted) return false;
  let any = false, anyFailed = false;
  const ab = abilityOf(mon, source);
  for (let [stat, n] of Object.entries(boosts)) {
    if (!n) continue;
    const byFoe = source && source.side !== mon.side;
    if (n < 0 && byFoe) {
      if (['clearbody', 'whitesmoke', 'fullmetalbody'].includes(ab) || mon.item === 'clearamulet' || sideOf(b, mon).cond.mist && source.ability !== 'infiltrator' || ab === 'hypercutter' && stat === 'atk' || ab === 'keeneye' && stat === 'accuracy' || ab === 'bigpecks' && stat === 'def') {
        msg(b, Name(mon) + "'s " + STAT_NAMES[stat] + ' was not lowered!'); anyFailed = true; continue;
      }
    }
    if (ab === 'simple') n *= 2;
    if (ab === 'contrary') n = -n;
    const before = mon.boosts[stat];
    const after = Math.max(-6, Math.min(6, before + n));
    const diff = after - before;
    if (!diff) { msg(b, Name(mon) + "'s " + STAT_NAMES[stat] + " won't go any " + (n > 0 ? 'higher' : 'lower') + '!'); anyFailed = true; continue; }
    mon.boosts[stat] = after;
    any = true;
    const words = Math.abs(diff) >= 3 ? ' rose drastically!' : Math.abs(diff) === 2 ? ' rose sharply!' : ' rose!';
    msg(b, Name(mon) + "'s " + STAT_NAMES[stat] + (diff > 0 ? words : words.replace('rose', 'fell').replace('drastically', 'severely').replace('sharply', 'harshly')));
    push(b, { t: 'boost', side: mon.side, stat, amount: diff });
    if (diff < 0) { b.turnState.statsLowered = b.turnState.statsLowered || {}; b.turnState.statsLowered[mon.side] = true; }
    if (diff > 0) { b.turnState.statsRaised = b.turnState.statsRaised || {}; b.turnState.statsRaised[mon.side] = true; }
    if (diff < 0 && byFoe && !mon.fainted) {
      if (mon.ability === 'defiant') applyBoosts(b, mon, { atk: 2 }, mon);
      if (mon.ability === 'competitive') applyBoosts(b, mon, { spa: 2 }, mon);
    }
  }
  if (mon.item === 'whiteherb' && Object.values(mon.boosts).some(v => v < 0)) { consumeItem(b, mon); for (const k in mon.boosts) if (mon.boosts[k] < 0) mon.boosts[k] = 0; msg(b, Name(mon) + ' returned its stats to normal using its White Herb!'); }
  return any || (!fromMove && anyFailed);
}
function setWeather(b, w, src, fromMove) {
  const norm = w === 'hail' ? 'hail' : w;
  if (b.field.weather === norm) { if (fromMove) msg(b, 'But it failed!'); return false; }
  const rock = { RainDance: 'damprock', sunnyday: 'heatrock', Sandstorm: 'smoothrock', snowscape: 'icyrock', hail: 'icyrock' }[norm];
  b.field.weather = norm; b.field.weatherTurns = src?.item === rock ? 8 : 5;
  msg(b, { RainDance: 'It started to rain!', sunnyday: 'The sunlight turned harsh!', Sandstorm: 'A sandstorm kicked up!', snowscape: 'It started to snow!', hail: 'It started to hail!' }[norm]);
  push(b, { t: 'weather', weather: weather(b) });
  for (const s of Object.values(b.sides)) { const m = s.team[s.active]; if (m && !m.fainted) checkParadox(b, m); }
  return true;
}
function setTerrain(b, t, src, fromMove) {
  if (b.field.terrain === t) { if (fromMove) msg(b, 'But it failed!'); return false; }
  b.field.terrain = t; b.field.terrainTurns = src?.item === 'terrainextender' ? 8 : 5;
  msg(b, { electricterrain: 'An electric current ran across the battlefield!', grassyterrain: 'Grass grew to cover the battlefield!', psychicterrain: 'The battlefield got weird!', mistyterrain: 'Mist swirled around the battlefield!' }[t]);
  push(b, { t: 'terrain', terrain: t });
  for (const s of Object.values(b.sides)) { const m = s.team[s.active]; if (m && !m.fainted) { checkParadox(b, m); if (t === 'electricterrain' && m.status === 'slp' && isGrounded(b, m)) {/* Electric Terrain doesn't wake */} } }
  return true;
}
function setHazard(b, targetMon, hz) {
  const side = b.sides[targetMon.side];
  const c = side.cond;
  const max = { spikes: 3, toxicspikes: 2, stealthrock: 1, stickyweb: 1 }[hz];
  const cur = c[hz]?.layers || 0;
  if (cur >= max) { msg(b, 'But it failed!'); return false; }
  c[hz] = { layers: cur + 1 };
  const who = targetMon.side === 'e' ? 'the opposing team' : 'your team';
  msg(b, { spikes: 'Spikes were scattered on the ground all around ' + who + '!', toxicspikes: 'Poison spikes were scattered on the ground all around ' + who + '!', stealthrock: 'Pointed stones float in the air around ' + who + '!', stickyweb: 'A sticky web has been laid out on the ground around ' + who + '!' }[hz]);
  push(b, { t: 'side', side: targetMon.side, cond: hz, on: true });
  return true;
}
function clearHazards(b, mon, quiet) {
  const c = sideOf(b, mon).cond;
  let any = false;
  for (const k of ['spikes', 'toxicspikes', 'stealthrock', 'stickyweb']) if (c[k]) { delete c[k]; any = true; push(b, { t: 'side', side: mon.side, cond: k, on: false }); }
  if (mon.volatiles) { delete mon.volatiles.leechseed; delete mon.volatiles.partiallytrapped; }
  if (any) msg(b, 'The hazards around ' + (mon.side === 'p' ? 'your' : 'the opposing') + ' team disappeared!');
}
function requestPivot(b, user, kind) {
  if (user.side === 'p') { b.request = { type: 'switch', reason: 'pivot', pivot: kind, switches: benchIndexes(b, 'p') }; return; }
  const idx = aiReplacement(b);
  doSwitch(b, b.sides.e, idx, kind);
}
function dragOut(b, target) {
  const bench = benchIndexes(b, target.side);
  if (!bench.length || target.volatiles.ingrain || target.ability === 'suctioncups') return false;
  const idx = b.rng.pick(bench);
  msg(b, Name(target) + ' was dragged out!');
  switchIn(b, b.sides[target.side], idx);
  onSwitchInEffects(b, active(b, target.side));
  return true;
}
function damageFraction(b, mon, frac, text) { if (mon.fainted) return; if (text) msg(b, text); applyDamage(b, mon, Math.max(1, Math.floor(mon.maxhp * frac)), null); }
function applyDamage(b, mon, amount, source, silentFaint) {
  if (mon.fainted || amount <= 0) return 0;
  const d = Math.min(mon.hp, amount);
  mon.hp -= d;
  push(b, { t: 'damage', side: mon.side, idx: mon.idx, hp: mon.hp, maxhp: mon.maxhp, amount: d, indirect: true });
  if (mon.hp <= 0) faint(b, mon, source);
  else afterDamageItems(b, mon);
  return d;
}
function setHp(b, mon, hp) { mon.hp = Math.max(1, Math.min(mon.maxhp, hp)); push(b, { t: 'heal', side: mon.side, idx: mon.idx, hp: mon.hp, maxhp: mon.maxhp, amount: 0 }); }
function heal(b, mon, amount, text, silent, fromMove) {
  if (mon.fainted) return false;
  if (mon.volatiles.healblock) { if (fromMove) msg(b, Name(mon) + ' was prevented from healing!'); return false; }
  if (mon.hp >= mon.maxhp) { if (fromMove) msg(b, Name(mon) + "'s HP is full!"); return false; }
  const before = mon.hp;
  mon.hp = Math.min(mon.maxhp, mon.hp + Math.max(1, amount));
  push(b, { t: 'heal', side: mon.side, idx: mon.idx, hp: mon.hp, maxhp: mon.maxhp, amount: mon.hp - before });
  if (text && !silent) msg(b, text);
  return true;
}
function afterDamageItems(b, mon) {
  if (mon.fainted) return;
  if (mon.item === 'sitrusberry' && mon.hp * 2 <= mon.maxhp) { consumeItem(b, mon); heal(b, mon, Math.floor(mon.maxhp / 4), Name(mon) + ' restored its health using its Sitrus Berry!'); }
  else if (mon.item === 'oranberry' && mon.hp * 2 <= mon.maxhp) { consumeItem(b, mon); heal(b, mon, 10, Name(mon) + ' restored its health using its Oran Berry!'); }
}
function eatBerry(b, mon, berry) {
  if (berry === 'sitrusberry') heal(b, mon, Math.floor(mon.maxhp / 4), '');
  if (berry === 'oranberry') heal(b, mon, 10, '');
  if ((berry === 'lumberry' || berry === 'chestoberry') && mon.status) cureStatus(b, mon, '');
}
function consumeItem(b, mon) { mon.usedItem = mon.item; mon.item = null; if (mon.ability === 'unburden') mon.volatiles.unburden = true; }
function faint(b, mon, source) {
  if (mon.fainted) return;
  mon.hp = 0; mon.fainted = true; mon.status = null;
  push(b, { t: 'faint', side: mon.side, idx: mon.idx });
  msg(b, Name(mon) + ' fainted!');
  b.turnState.lastFaintSide = mon.side;
  sideOf(b, mon).faintedThisTurn = true;
  if (mon.side === 'e') { b.stats.kos++; push(b, { t: 'ko', idx: mon.idx, seenBy: [...(mon.seenBy || [])], species: mon.species, level: mon.level }); }
  if (mon.volatiles.destinybond && source && source !== mon && !source.fainted) { msg(b, Name(mon) + ' took its attacker down with it!'); applyDamage(b, source, source.hp, null); }
  // Queued action for the fainted mon is skipped automatically in continueTurn.
}

// ---------- Items used from the Bag ----------
function useItemAction(b, a) {
  const side = b.sides[a.side];
  const mon = side.team[a.target];
  const it = a.item;
  msg(b, (a.side === 'p' ? 'You used ' : 'The rival used ') + it.name + '!');
  if (it.revive) {
    if (!mon.fainted) { msg(b, 'But it had no effect.'); return; }
    mon.fainted = false; mon.hp = Math.max(1, Math.floor(mon.maxhp * it.revive)); mon.status = null;
    msg(b, mon.name + ' was revived!');
    push(b, { t: 'revive', side: mon.side, idx: mon.idx, hp: mon.hp, maxhp: mon.maxhp });
    return;
  }
  if (mon.fainted) { msg(b, 'But it had no effect.'); return; }
  let did = false;
  if (it.heal) { did = heal(b, mon, it.heal === 'full' ? mon.maxhp : it.heal, mon.name + ' recovered HP!') || did; }
  if (it.cure && mon.status) { cureStatus(b, mon, mon.name + "'s status was healed!"); did = true; }
  if (it.cure && mon.volatiles.confusion) { delete mon.volatiles.confusion; did = true; }
  if (it.boosts) did = applyBoosts(b, mon, it.boosts, mon) || did;
  if (it.pp) { for (const s of mon.moves) s.pp = s.maxpp; msg(b, mon.name + "'s PP was restored!"); did = true; }
  if (!did) msg(b, 'But it had no effect.');
}

// ---------- Terastallization ----------
function terastallize(b, mon) {
  sideOf(b, mon).teraUsed = true;
  mon.terastallized = true;
  mon.types = [mon.teraType];
  if (mon.side === 'p') b.stats.teraUsed++;
  push(b, { t: 'tera', side: mon.side, idx: mon.idx, type: mon.teraType });
  msg(b, Name(mon) + ' has Terastallized into the ' + mon.teraType + ' type!');
}

// ---------- End of turn ----------
function endOfTurn(b) {
  const f = b.field;
  const mons = () => speedOrder(b, [active(b, 'p'), active(b, 'e')]).filter(m => !m.fainted);
  const w = weather(b);
  if (f.weather) {
    f.weatherTurns--;
    if (f.weatherTurns <= 0) {
      msg(b, { rain: 'The rain stopped.', sun: 'The harsh sunlight faded.', sand: 'The sandstorm subsided.', snow: 'The snow stopped.', hail: 'The hail stopped.' }[w]);
      f.weather = null; push(b, { t: 'weather', weather: null });
    } else {
      if (w === 'sand' || w === 'hail') {
        msg(b, w === 'sand' ? 'The sandstorm is raging.' : 'The hail is crashing down.');
        for (const m of mons()) {
          const immune = w === 'sand' ? (m.types.some(t => ['Rock', 'Ground', 'Steel'].includes(t)) || ['sandveil', 'sandrush', 'sandforce', 'overcoat', 'magicguard'].includes(m.ability)) : (m.types.includes('Ice') || ['icebody', 'snowcloak', 'overcoat', 'magicguard'].includes(m.ability));
          if (!immune && m.item !== 'safetygoggles') damageFraction(b, m, 1 / 16, Name(m) + ' is buffeted by the ' + (w === 'sand' ? 'sandstorm' : 'hail') + '!');
        }
      }
      for (const m of mons()) {
        if (m.ability === 'raindish' && w === 'rain' || m.ability === 'icebody' && (w === 'snow' || w === 'hail')) heal(b, m, Math.floor(m.maxhp / 16), Name(m) + ' restored HP!');
        if (m.ability === 'dryskin' && w === 'rain') heal(b, m, Math.floor(m.maxhp / 8), Name(m) + ' restored HP!');
        if ((m.ability === 'dryskin' || m.ability === 'solarpower') && w === 'sun' && !hasMagicGuard(m)) damageFraction(b, m, 1 / 8, Name(m) + ' was hurt by the sunlight!');
        if (m.ability === 'hydration' && w === 'rain' && m.status) cureStatus(b, m, Name(m) + "'s Hydration cured its status!");
      }
    }
  }
  // Wish
  for (const s of Object.values(b.sides)) {
    if (s.slot.wish && s.slot.wish.turn === b.turn) { const m = s.team[s.active]; if (!m.fainted) heal(b, m, s.slot.wish.hp, s.slot.wish.from + "'s wish came true!"); delete s.slot.wish; }
  }
  for (const m of mons()) {
    if (b.field.terrain === 'grassyterrain' && isGrounded(b, m)) heal(b, m, Math.floor(m.maxhp / 16), Name(m) + ' restored a little HP thanks to the grassy terrain!');
    if (m.item === 'leftovers') heal(b, m, Math.floor(m.maxhp / 16), Name(m) + ' restored a little HP using its Leftovers!');
    if (m.item === 'blacksludge') { if (m.types.includes('Poison')) heal(b, m, Math.floor(m.maxhp / 16), Name(m) + ' restored a little HP using its Black Sludge!'); else if (!hasMagicGuard(m)) damageFraction(b, m, 1 / 8, Name(m) + ' was hurt by its Black Sludge!'); }
    if (m.volatiles.aquaring) heal(b, m, Math.floor(m.maxhp / 16), 'A veil of water restored ' + name(m) + "'s HP!");
    if (m.volatiles.ingrain) heal(b, m, Math.floor(m.maxhp / 16), Name(m) + ' absorbed nutrients with its roots!');
  }
  for (const m of mons()) {
    if (m.volatiles.leechseed && !hasMagicGuard(m)) {
      const foe = foeOf(b, m);
      const d = applyDamage(b, m, Math.max(1, Math.floor(m.maxhp / 8)), foe);
      msg(b, Name(m) + "'s health is sapped by Leech Seed!");
      if (foe && !foe.fainted) heal(b, foe, d, '', true);
    }
  }
  for (const m of mons()) {
    if (m.status === 'psn' || m.status === 'tox') {
      if (m.ability === 'poisonheal') heal(b, m, Math.floor(m.maxhp / 8), Name(m) + ' restored HP due to Poison Heal!');
      else if (!hasMagicGuard(m)) {
        const frac = m.status === 'tox' ? Math.min(15, m.statusState.toxN || 1) / 16 : 1 / 8;
        damageFraction(b, m, frac, Name(m) + ' was hurt by poison!');
        if (m.status === 'tox') m.statusState.toxN = (m.statusState.toxN || 1) + 1;
      }
    }
    if (m.status === 'brn' && !hasMagicGuard(m)) damageFraction(b, m, 1 / 16, Name(m) + ' was hurt by its burn!');
    if (m.volatiles.nightmare && m.status === 'slp' && !hasMagicGuard(m)) damageFraction(b, m, 1 / 4, Name(m) + ' is locked in a nightmare!');
    if (m.volatiles.curse && !hasMagicGuard(m)) damageFraction(b, m, 1 / 4, Name(m) + ' is afflicted by the curse!');
    if (m.volatiles.partiallytrapped) {
      const pt = m.volatiles.partiallytrapped;
      pt.time--;
      if (pt.time <= 0 || pt.src?.fainted) { delete m.volatiles.partiallytrapped; msg(b, Name(m) + ' was freed from ' + pt.move + '!'); }
      else if (!hasMagicGuard(m)) damageFraction(b, m, 1 / pt.frac, Name(m) + ' is hurt by ' + pt.move + '!');
    }
    if (m.volatiles.saltcure && !hasMagicGuard(m)) damageFraction(b, m, m.types.includes('Water') || m.types.includes('Steel') ? 1 / 4 : 1 / 8, Name(m) + ' is hurt by Salt Cure!');
  }
  // Countdowns
  for (const s of Object.values(b.sides)) {
    for (const [k, v] of Object.entries(s.cond)) {
      if (v.turns === undefined) continue;
      v.turns--;
      if (v.turns <= 0) {
        delete s.cond[k];
        push(b, { t: 'side', side: s.id, cond: k, on: false });
        const who = s.id === 'p' ? 'Your team' : "The opposing team";
        msg(b, { tailwind: who + "'s Tailwind petered out!", reflect: who + "'s Reflect wore off!", lightscreen: who + "'s Light Screen wore off!", auroraveil: who + "'s Aurora Veil wore off!", safeguard: who + ' is no longer protected by Safeguard!', mist: who + ' is no longer protected by mist!' }[k] || '');
      }
    }
  }
  for (const m of mons()) {
    for (const k of ['taunt', 'encore', 'disable', 'magnetrise', 'healblock', 'throatchop', 'laserfocus', 'syrupbomb']) {
      const v = m.volatiles[k];
      if (!v) continue;
      if (k === 'syrupbomb') { applyBoosts(b, m, { spe: -1 }, null); }
      v.time--;
      if (v.time <= 0) { delete m.volatiles[k]; if (k === 'taunt') msg(b, Name(m) + "'s taunt wore off!"); if (k === 'encore') msg(b, Name(m) + "'s encore ended!"); if (k === 'disable') msg(b, Name(m) + "'s move is no longer disabled!"); }
    }
    if (m.volatiles.yawn) { m.volatiles.yawn.time--; if (m.volatiles.yawn.time <= 0) { delete m.volatiles.yawn; trySetStatus(b, m, 'slp', null); } }
    if (m.volatiles.perish) { m.volatiles.perish.time--; msg(b, Name(m) + "'s perish count fell to " + m.volatiles.perish.time + '.'); if (m.volatiles.perish.time <= 0) applyDamage(b, m, m.hp, null); }
  }
  if (f.terrain) { f.terrainTurns--; if (f.terrainTurns <= 0) { f.terrain = null; msg(b, 'The battlefield returned to normal.'); push(b, { t: 'terrain', terrain: null }); } }
  if (f.trickRoom) { f.trickRoom--; if (!f.trickRoom) { msg(b, 'The twisted dimensions returned to normal!'); push(b, { t: 'field', trickRoom: 0 }); } }
  if (f.gravity) { f.gravity--; if (!f.gravity) msg(b, 'Gravity returned to normal!'); }
  if (f.wonderroom) f.wonderroom--;
  for (const m of mons()) {
    if (m.ability === 'speedboost' && m.activeTurns > 0) applyBoosts(b, m, { spe: 1 }, m);
    if (m.ability === 'shedskin' && m.status && b.rng.chance(1, 3)) cureStatus(b, m, Name(m) + "'s Shed Skin cured its status!");
    if (m.item === 'flameorb' && !m.status) { trySetStatus(b, m, 'brn', null); }
    if (m.item === 'toxicorb' && !m.status) { trySetStatus(b, m, 'tox', null); }
    delete m.volatiles.roost; delete m.volatiles.endure; delete m.volatiles.flinch;
    if (m.volatiles.stall && m.volatiles.stall.turn !== b.turn) delete m.volatiles.stall;
    if (m.volatiles.paradox && !m.volatiles.paradox.fromItem) {
      const still = m.ability === 'protosynthesis' ? weather(b) === 'sun' : b.field.terrain === 'electricterrain';
      if (!still) { delete m.volatiles.paradox; msg(b, 'The effects of ' + name(m) + "'s " + (D.abilities[m.ability]?.name || '') + ' wore off!'); }
    }
    m.activeTurns++;
  }
  for (const s of Object.values(b.sides)) { s.faintedLastTurn = s.faintedThisTurn; s.faintedThisTurn = false; }
}

// ---------- AI ----------
function chooseAI(b) {
  const mon = active(b, 'e');
  const foe = active(b, 'p');
  const usable = mon.moves.map((s, i) => ({ s, i })).filter(x => canSelect(b, mon, x.s));
  if (!usable.length) return { type: 'move', index: -1 };
  const randomness = { easy: .45, medium: .15, hard: 0 }[b.ai] ?? .15;
  if (b.rng.next() < randomness) return { type: 'move', index: b.rng.pick(usable).i };
  let best = null;
  for (const { s, i } of usable) {
    const score = scoreMove(b, mon, foe, s.id);
    if (!best || score > best.score) best = { i, score };
  }
  // Tera on hard if it helps or it's the last Pokémon
  let tera = false;
  if (b.ai === 'hard' && !b.sides.e.teraUsed) {
    const last = b.sides.e.team.filter(m => !m.fainted).length === 1;
    if (last || mon.hp / mon.maxhp > .5 && b.rng.chance(1, 3)) tera = true;
  }
  return { type: 'move', index: best.i, tera };
}
function scoreMove(b, mon, foe, id) {
  const m = D.moves[id];
  const move = { ...m, id, type: moveTypeFor(b, mon, m, id) };
  move.cat = categoryFor(b, mon, move, id, foe);
  if (move.cat !== 'Status') {
    const eff = typeEffectivenessFor(b, mon, foe, move);
    if (eff === 0) return -100;
    if (['flashfire', 'waterabsorb', 'voltabsorb', 'levitate', 'stormdrain', 'lightningrod', 'sapsipper', 'motordrive', 'eartheater', 'dryskin', 'wellbakedbody'].includes(foe.ability)) {
      const imm = { flashfire: 'Fire', waterabsorb: 'Water', dryskin: 'Water', voltabsorb: 'Electric', levitate: 'Ground', stormdrain: 'Water', lightningrod: 'Electric', sapsipper: 'Grass', motordrive: 'Electric', eartheater: 'Ground', wellbakedbody: 'Fire' }[foe.ability];
      if (imm === move.type) return -50;
    }
    const snap = b.rng.state();
    let dmg = 0;
    try { dmg = calcDamage(b, mon, foe, move, { roll: 8, noRandom: true, eff, dry: true }).damage || 0; } catch (e) { dmg = 0; }
    b.rng.setState(snap);
    if (move.multihit) dmg *= Array.isArray(move.multihit) ? 3 : move.multihit;
    const acc = move.acc === true ? 1 : move.acc / 100;
    let score = Math.min(dmg, foe.hp) / foe.maxhp * 100 * acc;
    if (dmg >= foe.hp) score += 60 + (move.pri > 0 ? 30 : 0);
    if (move.recoil || move.self?.boosts && Object.values(move.self.boosts).some(v => v < 0)) score -= 6;
    if (move.self?.volatileStatus === 'mustrecharge' && dmg < foe.hp) score -= 25;
    if (TWO_TURN[id] && !(TWO_TURN[id].sun && weather(b) === 'sun')) score -= 20;
    if ((id === 'fakeout') && mon.activeTurns <= 1) score += 25;
    if (id === 'suckerpunch' || id === 'focuspunch') score -= 15;
    if (move.selfdestruct) score -= 40;
    return score;
  }
  // Status moves
  const hpPct = mon.hp / mon.maxhp;
  if (move.heal || ['roost', 'morningsun', 'moonlight', 'synthesis', 'shoreup', 'rest', 'strengthsap'].includes(id)) return hpPct < .45 ? 75 : hpPct < .7 ? 20 : -20;
  if (move.status) {
    if (foe.status || foe.volatiles.substitute) return -30;
    if (move.status === 'par' && foe.types.includes('Electric') || move.status === 'brn' && foe.types.includes('Fire') || (move.status === 'psn' || move.status === 'tox') && (foe.types.includes('Poison') || foe.types.includes('Steel'))) return -40;
    if (id === 'thunderwave' && foe.types.includes('Ground')) return -40;
    return move.status === 'slp' ? 55 : move.status === 'brn' && foe.stats.atk > foe.stats.spa ? 50 : 38;
  }
  if (move.stallingMove) return mon.volatiles.stall ? -40 : 8;
  if (move.boosts && (move.target === 'self' || move.target === 'adjacentAllyOrSelf')) {
    const sum = Object.values(mon.boosts).reduce((a, v) => a + v, 0);
    return hpPct > .7 && sum < 3 ? 34 - sum * 8 : -10;
  }
  if (move.boosts) return Object.values(foe.boosts).some(v => v > 0) ? 22 : 10;
  if (move.sideCondition) {
    const sc = move.sideCondition;
    if (['spikes', 'stealthrock', 'toxicspikes', 'stickyweb'].includes(sc)) return b.sides.p.cond[sc] ? -20 : 30;
    return b.sides.e.cond[sc] ? -20 : 26;
  }
  if (move.weather) return b.field.weather ? -10 : 18;
  if (move.terrain) return b.field.terrain ? -10 : 16;
  if (move.volatileStatus === 'leechseed') return foe.volatiles.leechseed || foe.types.includes('Grass') ? -20 : 30;
  if (move.volatileStatus === 'substitute') return mon.volatiles.substitute || hpPct < .5 ? -20 : 20;
  if (move.volatileStatus === 'confusion') return foe.volatiles.confusion ? -20 : 18;
  if (move.volatileStatus === 'taunt') return foe.moves.some(s => D.moves[s.id]?.cat === 'Status') ? 22 : 0;
  return 5;
}
function aiReplacement(b) {
  const bench = benchIndexes(b, 'e');
  const foe = active(b, 'p');
  if (!foe || foe.fainted || b.ai === 'easy') return bench[0];
  let best = bench[0], bestScore = -Infinity;
  for (const i of bench) {
    const m = b.sides.e.team[i];
    const off = Math.max(...m.moves.map(s => { const mv = D.moves[s.id]; return mv.cat === 'Status' ? 0 : effectiveness(moveTypeFor(b, m, mv, s.id), foe.types) * (m.baseTypes.includes(mv.type) ? 1.5 : 1); }));
    const def = Math.max(...foe.moves.map(s => { const mv = D.moves[s.id]; return mv.cat === 'Status' ? 0 : effectiveness(mv.type, m.types); }));
    const score = off - def;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// Damage range preview used by the UI (no side effects).
export function damageRange(b, attacker, defender, moveId) {
  const m = D.moves[moveId];
  if (!m || m.cat === 'Status') return null;
  const move = { ...m, id: moveId, type: moveTypeFor(b, attacker, m, moveId) };
  move.cat = categoryFor(b, attacker, move, moveId, defender);
  const eff = typeEffectivenessFor(b, attacker, defender, move);
  const snap = b.rng.state();
  const saved = JSON.stringify(b.turnState || {});
  try {
    const lo = calcDamage(b, attacker, defender, move, { roll: 15, noRandom: true, eff, dry: true }).damage;
    const hi = calcDamage(b, attacker, defender, move, { roll: 0, noRandom: true, eff, dry: true }).damage;
    return { lo, hi, eff, type: move.type };
  } catch (e) { return null; } finally { b.rng.setState(snap); b.turnState = JSON.parse(saved); }
}
