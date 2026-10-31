// Journey mode: Kanto to Paldea. Gym Leaders, Elite Four and Champions use the
// species and levels from one reference game per region (listed below). These
// were written from game knowledge, not imported from a database; see
// TECH_DEBT.md. Regional forms (e.g. Alolan Persian) use the base species,
// because alternate forms aren't implemented yet. Movesets are built by the
// game's AI move picker from each Pokémon's real level-up/TM learnset.
//
// Format: [species id, level]
import { makeRng, hashString } from './engine.js';
import { gameData as G, generatePokemon, buildAiMoves } from './game.js';

const L = (name, title, type, team, extra = {}) => ({ name, title, type, team, ...extra });

export const REGIONS = [
  { id: 'kanto', name: 'Kanto', game: 'FireRed/LeafGreen', range: [1, 151],
    gyms: [
      L('Brock', 'Pewter Gym', 'Rock', [['geodude', 12], ['onix', 14]]),
      L('Misty', 'Cerulean Gym', 'Water', [['staryu', 18], ['starmie', 21]]),
      L('Lt. Surge', 'Vermilion Gym', 'Electric', [['voltorb', 21], ['pikachu', 18], ['raichu', 24]]),
      L('Erika', 'Celadon Gym', 'Grass', [['victreebel', 29], ['tangela', 24], ['vileplume', 29]]),
      L('Koga', 'Fuchsia Gym', 'Poison', [['koffing', 37], ['muk', 39], ['koffing', 37], ['weezing', 43]]),
      L('Sabrina', 'Saffron Gym', 'Psychic', [['kadabra', 38], ['mrmime', 37], ['venomoth', 38], ['alakazam', 43]]),
      L('Blaine', 'Cinnabar Gym', 'Fire', [['growlithe', 42], ['ponyta', 40], ['rapidash', 42], ['arcanine', 47]]),
      L('Giovanni', 'Viridian Gym', 'Ground', [['rhyhorn', 45], ['dugtrio', 42], ['nidoqueen', 44], ['nidoking', 45], ['rhyhorn', 50]]),
    ],
    elite: [
      L('Lorelei', 'Elite Four', 'Ice', [['dewgong', 52], ['cloyster', 51], ['slowbro', 52], ['jynx', 54], ['lapras', 54]]),
      L('Bruno', 'Elite Four', 'Fighting', [['onix', 51], ['hitmonchan', 53], ['hitmonlee', 53], ['onix', 54], ['machamp', 56]]),
      L('Agatha', 'Elite Four', 'Ghost', [['gengar', 54], ['golbat', 54], ['haunter', 53], ['arbok', 56], ['gengar', 58]]),
      L('Lance', 'Elite Four', 'Dragon', [['gyarados', 56], ['dragonair', 54], ['dragonair', 54], ['aerodactyl', 58], ['dragonite', 60]]),
    ],
    champion: L('Blue', 'Champion', 'Mixed', [['pidgeot', 59], ['alakazam', 57], ['rhydon', 59], ['arcanine', 59], ['exeggutor', 61], ['blastoise', 63]]) },
  { id: 'johto', name: 'Johto', game: 'HeartGold/SoulSilver', range: [152, 251],
    gyms: [
      L('Falkner', 'Violet Gym', 'Flying', [['pidgey', 9], ['pidgeotto', 13]]),
      L('Bugsy', 'Azalea Gym', 'Bug', [['metapod', 15], ['kakuna', 15], ['scyther', 17]]),
      L('Whitney', 'Goldenrod Gym', 'Normal', [['clefairy', 17], ['miltank', 19]]),
      L('Morty', 'Ecruteak Gym', 'Ghost', [['gastly', 21], ['haunter', 21], ['haunter', 23], ['gengar', 25]]),
      L('Chuck', 'Cianwood Gym', 'Fighting', [['primeape', 29], ['poliwrath', 31]]),
      L('Jasmine', 'Olivine Gym', 'Steel', [['magnemite', 30], ['magnemite', 30], ['steelix', 35]]),
      L('Pryce', 'Mahogany Gym', 'Ice', [['seel', 30], ['dewgong', 32], ['piloswine', 34]]),
      L('Clair', 'Blackthorn Gym', 'Dragon', [['dragonair', 38], ['dragonair', 38], ['gyarados', 38], ['kingdra', 41]]),
    ],
    elite: [
      L('Will', 'Elite Four', 'Psychic', [['xatu', 40], ['jynx', 41], ['exeggutor', 41], ['slowbro', 41], ['xatu', 42]]),
      L('Koga', 'Elite Four', 'Poison', [['ariados', 40], ['venomoth', 41], ['forretress', 43], ['muk', 42], ['crobat', 44]]),
      L('Bruno', 'Elite Four', 'Fighting', [['hitmontop', 42], ['hitmonlee', 42], ['hitmonchan', 42], ['onix', 43], ['machamp', 46]]),
      L('Karen', 'Elite Four', 'Dark', [['umbreon', 42], ['vileplume', 42], ['murkrow', 44], ['gengar', 45], ['houndoom', 47]]),
    ],
    champion: L('Lance', 'Champion', 'Dragon', [['gyarados', 44], ['dragonite', 47], ['dragonite', 47], ['aerodactyl', 46], ['charizard', 46], ['dragonite', 50]]) },
  { id: 'hoenn', name: 'Hoenn', game: 'Ruby/Sapphire', range: [252, 386],
    gyms: [
      L('Roxanne', 'Rustboro Gym', 'Rock', [['geodude', 12], ['geodude', 12], ['nosepass', 15]]),
      L('Brawly', 'Dewford Gym', 'Fighting', [['machop', 16], ['makuhita', 19]]),
      L('Wattson', 'Mauville Gym', 'Electric', [['magnemite', 22], ['voltorb', 20], ['magneton', 23]]),
      L('Flannery', 'Lavaridge Gym', 'Fire', [['slugma', 26], ['slugma', 26], ['torkoal', 28]]),
      L('Norman', 'Petalburg Gym', 'Normal', [['slaking', 28], ['vigoroth', 30], ['slaking', 31]]),
      L('Winona', 'Fortree Gym', 'Flying', [['swellow', 31], ['pelipper', 30], ['skarmory', 32], ['altaria', 33]]),
      L('Tate & Liza', 'Mossdeep Gym', 'Psychic', [['lunatone', 42], ['solrock', 42]]),
      L('Wallace', 'Sootopolis Gym', 'Water', [['luvdisc', 40], ['whiscash', 42], ['sealeo', 40], ['seaking', 42], ['milotic', 43]]),
    ],
    elite: [
      L('Sidney', 'Elite Four', 'Dark', [['mightyena', 46], ['cacturne', 46], ['shiftry', 48], ['sharpedo', 48], ['absol', 49]]),
      L('Phoebe', 'Elite Four', 'Ghost', [['dusclops', 48], ['banette', 49], ['sableye', 50], ['banette', 49], ['dusclops', 51]]),
      L('Glacia', 'Elite Four', 'Ice', [['sealeo', 50], ['glalie', 50], ['sealeo', 52], ['glalie', 52], ['walrein', 53]]),
      L('Drake', 'Elite Four', 'Dragon', [['shelgon', 52], ['altaria', 54], ['flygon', 53], ['flygon', 53], ['salamence', 55]]),
    ],
    champion: L('Steven', 'Champion', 'Steel', [['skarmory', 57], ['claydol', 55], ['aggron', 56], ['cradily', 56], ['armaldo', 56], ['metagross', 58]]) },
  { id: 'sinnoh', name: 'Sinnoh', game: 'Diamond/Pearl', range: [387, 493],
    gyms: [
      L('Roark', 'Oreburgh Gym', 'Rock', [['geodude', 12], ['onix', 12], ['cranidos', 14]]),
      L('Gardenia', 'Eterna Gym', 'Grass', [['cherubi', 19], ['turtwig', 19], ['roserade', 22]]),
      L('Maylene', 'Veilstone Gym', 'Fighting', [['meditite', 27], ['machoke', 27], ['lucario', 30]]),
      L('Crasher Wake', 'Pastoria Gym', 'Water', [['gyarados', 27], ['quagsire', 27], ['floatzel', 30]]),
      L('Fantina', 'Hearthome Gym', 'Ghost', [['drifblim', 32], ['gengar', 34], ['mismagius', 36]]),
      L('Byron', 'Canalave Gym', 'Steel', [['bronzor', 36], ['steelix', 36], ['bastiodon', 39]]),
      L('Candice', 'Snowpoint Gym', 'Ice', [['sneasel', 38], ['piloswine', 38], ['abomasnow', 40], ['froslass', 42]]),
      L('Volkner', 'Sunyshore Gym', 'Electric', [['raichu', 46], ['ambipom', 47], ['octillery', 47], ['luxray', 49]]),
    ],
    elite: [
      L('Aaron', 'Elite Four', 'Bug', [['dustox', 53], ['beautifly', 53], ['vespiquen', 54], ['heracross', 54], ['drapion', 57]]),
      L('Bertha', 'Elite Four', 'Ground', [['quagsire', 55], ['sudowoodo', 56], ['golem', 56], ['whiscash', 55], ['hippowdon', 59]]),
      L('Flint', 'Elite Four', 'Fire', [['rapidash', 58], ['steelix', 57], ['drifblim', 58], ['lopunny', 57], ['infernape', 61]]),
      L('Lucian', 'Elite Four', 'Psychic', [['mrmime', 59], ['girafarig', 59], ['medicham', 60], ['alakazam', 60], ['bronzong', 63]]),
    ],
    champion: L('Cynthia', 'Champion', 'Mixed', [['spiritomb', 61], ['roserade', 60], ['gastrodon', 60], ['lucario', 63], ['milotic', 63], ['garchomp', 66]]) },
  { id: 'unova', name: 'Unova', game: 'Black', range: [494, 649],
    gyms: [
      L('Cilan', 'Striaton Gym', 'Grass', [['lillipup', 12], ['pansage', 14]]),
      L('Lenora', 'Nacrene Gym', 'Normal', [['herdier', 18], ['watchog', 20]]),
      L('Burgh', 'Castelia Gym', 'Bug', [['whirlipede', 21], ['dwebble', 21], ['leavanny', 23]]),
      L('Elesa', 'Nimbasa Gym', 'Electric', [['emolga', 25], ['emolga', 25], ['zebstrika', 27]]),
      L('Clay', 'Driftveil Gym', 'Ground', [['krokorok', 29], ['palpitoad', 29], ['excadrill', 31]]),
      L('Skyla', 'Mistralton Gym', 'Flying', [['swoobat', 33], ['unfezant', 33], ['swanna', 35]]),
      L('Brycen', 'Icirrus Gym', 'Ice', [['vanillish', 37], ['cryogonal', 37], ['beartic', 39]]),
      L('Drayden', 'Opelucid Gym', 'Dragon', [['fraxure', 41], ['druddigon', 41], ['haxorus', 43]]),
    ],
    elite: [
      L('Shauntal', 'Elite Four', 'Ghost', [['cofagrigus', 48], ['jellicent', 48], ['golurk', 48], ['chandelure', 50]]),
      L('Grimsley', 'Elite Four', 'Dark', [['scrafty', 48], ['krookodile', 48], ['liepard', 48], ['bisharp', 50]]),
      L('Caitlin', 'Elite Four', 'Psychic', [['reuniclus', 48], ['musharna', 48], ['sigilyph', 48], ['gothitelle', 50]]),
      L('Marshal', 'Elite Four', 'Fighting', [['throh', 48], ['sawk', 48], ['mienshao', 48], ['conkeldurr', 50]]),
    ],
    champion: L('Alder', 'Champion', 'Mixed', [['accelgor', 75], ['bouffalant', 75], ['druddigon', 75], ['vanilluxe', 75], ['escavalier', 75], ['volcarona', 77]]) },
  { id: 'kalos', name: 'Kalos', game: 'X/Y', range: [650, 721],
    gyms: [
      L('Viola', 'Santalune Gym', 'Bug', [['surskit', 10], ['vivillon', 12]]),
      L('Grant', 'Cyllage Gym', 'Rock', [['amaura', 25], ['tyrunt', 25]]),
      L('Korrina', 'Shalour Gym', 'Fighting', [['mienfoo', 29], ['machoke', 28], ['hawlucha', 32]]),
      L('Ramos', 'Coumarine Gym', 'Grass', [['jumpluff', 30], ['weepinbell', 31], ['gogoat', 34]]),
      L('Clemont', 'Lumiose Gym', 'Electric', [['emolga', 35], ['magneton', 35], ['heliolisk', 37]]),
      L('Valerie', 'Laverre Gym', 'Fairy', [['mawile', 38], ['mrmime', 39], ['sylveon', 42]]),
      L('Olympia', 'Anistar Gym', 'Psychic', [['sigilyph', 44], ['slowking', 45], ['meowstic', 48]]),
      L('Wulfric', 'Snowbelle Gym', 'Ice', [['abomasnow', 56], ['cryogonal', 55], ['avalugg', 59]]),
    ],
    elite: [
      L('Malva', 'Elite Four', 'Fire', [['pyroar', 63], ['torkoal', 63], ['chandelure', 63], ['talonflame', 65]]),
      L('Siebold', 'Elite Four', 'Water', [['clawitzer', 63], ['starmie', 63], ['gyarados', 63], ['barbaracle', 65]]),
      L('Wikstrom', 'Elite Four', 'Steel', [['klefki', 63], ['probopass', 63], ['scizor', 63], ['aegislash', 65]]),
      L('Drasna', 'Elite Four', 'Dragon', [['dragalge', 63], ['druddigon', 63], ['altaria', 63], ['noivern', 65]]),
    ],
    champion: L('Diantha', 'Champion', 'Mixed', [['hawlucha', 64], ['tyrantrum', 65], ['aurorus', 65], ['gourgeist', 65], ['goodra', 66], ['gardevoir', 68]]) },
  { id: 'alola', name: 'Alola', game: 'Sun/Moon', range: [722, 809], kahunas: true,
    gyms: [
      L('Hala', 'Melemele Kahuna', 'Fighting', [['mankey', 14], ['makuhita', 14], ['crabrawler', 15]]),
      L('Olivia', 'Akala Kahuna', 'Rock', [['nosepass', 26], ['boldore', 26], ['lycanroc', 27]]),
      L('Nanu', 'Ula\'ula Kahuna', 'Dark', [['sableye', 38], ['krokorok', 38], ['persian', 39]]),
      L('Hapu', 'Poni Kahuna', 'Ground', [['dugtrio', 47], ['gastrodon', 47], ['flygon', 47], ['mudsdale', 48]]),
    ],
    elite: [
      L('Hala', 'Elite Four', 'Fighting', [['hariyama', 54], ['primeape', 54], ['bewear', 54], ['poliwrath', 54], ['crabominable', 55]]),
      L('Olivia', 'Elite Four', 'Rock', [['relicanth', 54], ['carbink', 54], ['golem', 54], ['probopass', 54], ['lycanroc', 55]]),
      L('Acerola', 'Elite Four', 'Ghost', [['sableye', 54], ['drifblim', 54], ['dhelmise', 54], ['froslass', 54], ['palossand', 55]]),
      L('Kahili', 'Elite Four', 'Flying', [['skarmory', 54], ['crobat', 54], ['oricorio', 54], ['mandibuzz', 54], ['toucannon', 55]]),
    ],
    champion: L('Professor Kukui', 'Champion', 'Mixed', [['lycanroc', 57], ['ninetales', 56], ['braviary', 56], ['magnezone', 56], ['snorlax', 56], ['incineroar', 58]]) },
  { id: 'galar', name: 'Galar', game: 'Sword', range: [810, 905],
    gyms: [
      L('Milo', 'Turffield Stadium', 'Grass', [['gossifleur', 19], ['eldegoss', 20]]),
      L('Nessa', 'Hulbury Stadium', 'Water', [['goldeen', 22], ['arrokuda', 23], ['drednaw', 24]]),
      L('Kabu', 'Motostoke Stadium', 'Fire', [['ninetales', 25], ['arcanine', 25], ['centiskorch', 27]]),
      L('Bea', 'Stow-on-Side Stadium', 'Fighting', [['hitmontop', 34], ['pangoro', 34], ['sirfetchd', 35], ['machamp', 36]]),
      L('Opal', 'Ballonlea Stadium', 'Fairy', [['weezing', 36], ['mawile', 36], ['togekiss', 37], ['alcremie', 38]]),
      L('Gordie', 'Circhester Stadium', 'Rock', [['barbaracle', 40], ['shuckle', 40], ['stonjourner', 41], ['coalossal', 42]]),
      L('Piers', 'Spikemuth', 'Dark', [['scrafty', 44], ['malamar', 45], ['skuntank', 45], ['obstagoon', 46]]),
      L('Raihan', 'Hammerlocke Stadium', 'Dragon', [['gigalith', 46], ['flygon', 47], ['sandaconda', 46], ['duraludon', 48]]),
    ],
    elite: [
      L('Marnie', 'Champion Cup', 'Dark', [['liepard', 47], ['toxicroak', 47], ['scrafty', 47], ['morpeko', 48], ['grimmsnarl', 49]]),
    ],
    champion: L('Leon', 'Champion', 'Mixed', [['aegislash', 62], ['dragapult', 62], ['haxorus', 63], ['seismitoad', 64], ['mrrime', 64], ['charizard', 65]]) },
  { id: 'paldea', name: 'Paldea', game: 'Scarlet/Violet', range: [906, 1025],
    gyms: [
      L('Katy', 'Cortondo Gym', 'Bug', [['nymble', 14], ['tarountula', 14], ['teddiursa', 15]]),
      L('Brassius', 'Artazon Gym', 'Grass', [['petilil', 16], ['smoliv', 16], ['sudowoodo', 17]]),
      L('Iono', 'Levincia Gym', 'Electric', [['wattrel', 23], ['bellibolt', 23], ['luxio', 23], ['mismagius', 24]]),
      L('Kofu', 'Cascarrafa Gym', 'Water', [['veluza', 29], ['wugtrio', 29], ['crabominable', 30]]),
      L('Larry', 'Medali Gym', 'Normal', [['komala', 35], ['dudunsparce', 35], ['staraptor', 36]]),
      L('Ryme', 'Montenevera Gym', 'Ghost', [['banette', 41], ['mimikyu', 41], ['houndstone', 41], ['toxtricity', 42]]),
      L('Tulip', 'Alfornada Gym', 'Psychic', [['farigiraf', 44], ['gardevoir', 44], ['espathra', 44], ['florges', 45]]),
      L('Grusha', 'Glaseado Gym', 'Ice', [['frosmoth', 47], ['beartic', 47], ['cetitan', 47], ['altaria', 48]]),
    ],
    elite: [
      L('Rika', 'Elite Four', 'Ground', [['whiscash', 57], ['camerupt', 57], ['donphan', 57], ['dugtrio', 57], ['clodsire', 58]]),
      L('Poppy', 'Elite Four', 'Steel', [['copperajah', 58], ['magnezone', 58], ['bronzong', 58], ['corviknight', 58], ['tinkaton', 59]]),
      L('Larry', 'Elite Four', 'Flying', [['tropius', 59], ['oricorio', 59], ['altaria', 59], ['staraptor', 59], ['flamigo', 60]]),
      L('Hassel', 'Elite Four', 'Dragon', [['noivern', 60], ['haxorus', 60], ['dragalge', 60], ['flapple', 60], ['baxcalibur', 61]]),
    ],
    champion: L('Geeta', 'Champion', 'Mixed', [['espathra', 61], ['gogoat', 61], ['veluza', 61], ['avalugg', 61], ['kingambit', 61], ['glimmora', 62]]) },
];

// Rewards for a first clear. Rematches give Exp. Points only.
export const STEP_COINS = { route: 40, gym: 180, elite: 320, champion: 1000 };
const ROUTE_NAMES = ['Youngster', 'Lass', 'Bug Catcher', 'Hiker', 'Swimmer', 'Ace Trainer', 'Picnicker', 'Camper', 'Fisherman', 'Battle Girl', 'Psychic', 'Veteran'];

// Linear step list for a region: route trainer then gym, ..., Elite Four, Champion.
export function regionSteps(ri) {
  const R = REGIONS[ri];
  const steps = [];
  R.gyms.forEach((g, gi) => { steps.push({ kind: 'route', gym: gi }); steps.push({ kind: 'gym', gym: gi, leader: g }); });
  R.elite.forEach((e, ei) => steps.push({ kind: 'elite', index: ei, leader: e }));
  steps.push({ kind: 'champion', leader: R.champion });
  return steps.map((s, i) => ({ ...s, region: ri, index: i, key: R.id + ':' + i }));
}
export const JOURNEY_TOTAL_COINS = REGIONS.reduce((sum, R, ri) => sum + regionSteps(ri).reduce((a, s) => a + STEP_COINS[s.kind], 0), 0);

function aceLevel(team) { return Math.max(...team.map(t => t[1])); }
// Builds a battle-ready trainer for a step. Deterministic for a given step.
export function buildStepTrainer(step) {
  const R = REGIONS[step.region];
  const rng = makeRng(hashString('journey:' + step.key));
  const isLeader = step.kind !== 'route';
  let teamSpec, name;
  if (isLeader) {
    teamSpec = step.leader.team;
    name = step.leader.title === 'Champion' ? 'Champion ' + step.leader.name : step.leader.title === 'Elite Four' ? 'Elite Four ' + step.leader.name : (R.kahunas ? 'Kahuna ' : step.kind === 'gym' ? 'Gym Leader ' : '') + step.leader.name;
  } else {
    // Route trainers sit between the previous and next leader in strength.
    const next = R.gyms[step.gym].team, prev = step.gym ? R.gyms[step.gym - 1].team : null;
    const lvl = Math.max(4, Math.round(((prev ? aceLevel(prev) : aceLevel(next) - 6) + aceLevel(next)) / 2) - 2);
    const dex = G.dex;
    const pool = Object.keys(dex).filter(id => { const d = dex[id]; return d.num >= R.range[0] && d.num <= R.range[1] && !d.tags?.some(t => /Legendary|Mythical/.test(t)) && (lvl >= 30 ? true : !d.prevo); });
    const size = 1 + Math.min(2, Math.floor(lvl / 20));
    teamSpec = Array.from({ length: size }, () => [rng.pick(pool), lvl]);
    name = rng.pick(ROUTE_NAMES) + ' ' + ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lia'][rng.int(12)];
  }
  const tough = step.kind === 'elite' || step.kind === 'champion';
  const team = teamSpec.map(([species, level]) => {
    const p = generatePokemon(species, level, { rng, noMark: true, shinyRate: 0, perfectIvs: tough ? 3 : step.kind === 'gym' ? 1 : 0, origin: 'trainer' });
    p.moves = buildAiMoves(species, level, { useTms: isLeader, rng });
    if (tough) { const best = G.dex[species].bs[1] > G.dex[species].bs[3] ? 'atk' : 'spa'; p.evs[best] = 252; p.evs.spe = 252; }
    return p;
  });
  return { name, team, level: aceLevel(teamSpec), ai: step.kind === 'route' ? 'medium' : 'hard' };
}
