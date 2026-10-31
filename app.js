import * as E from './js/engine.js';
import * as G from './js/game.js';
import * as S from './js/security.js';
import * as J from './js/journey.js';

// Firebase is loaded lazily so the game still works if the Firebase CDN is
// unreachable; only sign-in, cloud saves and leaderboards are affected.

const firebaseConfig = {
  apiKey: "AIzaSyAoOPSRcfDNqHsbAw3s771xttxmkQFZRFA",
  authDomain: "poke-duel.firebaseapp.com",
  projectId: "poke-duel",
  storageBucket: "poke-duel.firebasestorage.app",
  messagingSenderId: "484956920261",
  appId: "1:484956920261:web:baed770f30ff57affd53ac",
  measurementId: "G-71KJCN6WBP"
};
const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/';
let fb = null, auth = null, db = null, googleProvider = null;
async function loadFirebase() {
  const [appMod, authMod, fsMod] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => import(FIREBASE_CDN + f)));
  fb = { ...authMod, ...fsMod };
  const firebaseApp = appMod.initializeApp(firebaseConfig);
  auth = fb.getAuth(firebaseApp);
  db = fb.getFirestore(firebaseApp);
  googleProvider = new fb.GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: "select_account" });
}

(() => {
'use strict';

const SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
const API = 'https://pokeapi.co/api/v2';
// v2 saves live under a new key so the v1 prototype save is never overwritten.
const STORAGE_KEY = 'pokeduel-save-v2';
const LEGACY_KEY = 'pokeduel-save-v1';
const BACKUP_KEY = 'pokeduel-save-backup';
const LOCAL_MODIFIED_KEY = 'pokeduel-save-modified-v2';
const LEGACY_MODIFIED_KEY = 'pokeduel-save-modified-v1';
const DAILY = ['easy', 'medium', 'hard'];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString();
const sleep = ms => new Promise(r => setTimeout(r, save?.settings?.reducedEffects ? Math.min(ms, 120) : ms / (Number(save?.settings?.battleSpeed) || 1)));
const D = () => G.gameData.dex;
const M = () => G.gameData.moves;
const sp = p => D()[p.species];
const tclass = t => 't-' + String(t || 'unknown').toLowerCase().replace(/[^a-z]/g, '').replace('???', 'unknown');

// ---------- Sprites (PokéAPI sprite repository) ----------
const img = {
  icon: (n, s) => `${SPR}/pokemon/${s ? 'shiny/' : ''}${n}.png`,
  art: (n, s) => `${SPR}/pokemon/other/home/${s ? 'shiny/' : ''}${n}.png`,
  front: (n, s) => `${SPR}/pokemon/other/showdown/${s ? 'shiny/' : ''}${n}.gif`,
  back: (n, s) => `${SPR}/pokemon/other/showdown/back/${s ? 'shiny/' : ''}${n}.gif`,
};
const pic = (src, fallbacks = [], attrs = '') => `<img src="${esc(src)}" data-fb="${esc(fallbacks.join('|'))}" ${attrs} decoding="async">`;
// Small icons appear in long grids, so they load lazily; large artwork loads eagerly.
const iconOf = (n, s, alt = '') => pic(img.icon(n, s), [img.icon(n, false), img.art(n, s)], `alt="${esc(alt)}" loading="lazy"`);
const artOf = (n, s, alt = '') => pic(img.art(n, s), [img.art(n, false), img.icon(n, s)], `alt="${esc(alt)}"`);
const preload = src => { const i = new Image(); i.src = src; };
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.type) { t.outerHTML = `<span class="type ${tclass(t.dataset.type)}">${esc(t.dataset.type)}</span>`; return; }
  if (t.tagName !== 'IMG' || !t.dataset.fb) return;
  const list = t.dataset.fb.split('|').filter(Boolean);
  const next = list.shift();
  t.dataset.fb = list.join('|');
  if (next) t.src = next; else { t.removeAttribute('data-fb'); t.style.visibility = 'hidden'; }
}, true);
// Icons come from the original SVG set in assets/icons.svg.
const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="assets/icons.svg#i-${name}"/></svg>`;
const shinyIc = () => `<svg class="ic shiny-ic" role="img" aria-label="shiny"><use href="assets/icons.svg#i-shiny"/></svg>`;
const TYPE_IDS = { Normal: 1, Fighting: 2, Flying: 3, Poison: 4, Ground: 5, Rock: 6, Bug: 7, Ghost: 8, Steel: 9, Fire: 10, Water: 11, Grass: 12, Electric: 13, Psychic: 14, Ice: 15, Dragon: 16, Dark: 17, Fairy: 18 };
// Official Scarlet/Violet type labels from the PokéAPI sprite repo, with a CSS chip fallback.
const typeImg = t => TYPE_IDS[t] ? `<img class="type-img" src="${SPR}/types/generation-ix/scarlet-violet/${TYPE_IDS[t]}.png" alt="${esc(t)}" data-type="${esc(t)}" decoding="async">` : `<span class="type ${tclass(t)}">${esc(t)}</span>`;
const typeChips = types => '<span class="types">' + types.map(typeImg).join('') + '</span>';
const hpCls = pct => pct <= 20 ? 'lo' : pct <= 50 ? 'mid' : '';
const genderIcon = g => g === 'M' ? `<span class="gbadge m" role="img" aria-label="male">${ic('male')}</span>` : g === 'F' ? `<span class="gbadge f" role="img" aria-label="female">${ic('female')}</span>` : '';

// ---------- State ----------
let save = null;
let currentUser = null, authReady = false, applyingRemoteSave = false, booting = true;
let cloudSaveTimer = null, cloudWriteQueue = Promise.resolve(), lbTimer = null;
let authStatusMessage = 'Not signed in. Progress stays on this device.';
let activeScreen = 'home';
let toastTimer = null;
let initialLocalSaveTimestamp = 0;
const ui = { deviceSealed: false, boxPage: 0, sel: null, sumTab: 'info', boxSearch: '', boxSort: 'recent', shopCat: 'boxes', shopSel: null, shopQty: 1, bagCat: 'medicine', bagSel: null, dexShown: 120, rankTab: 'score', starterGen: 1, starterSel: null };

// ---------- Save / persistence ----------
const SEALED_FLAG = 'pokeduel-sealed';
// Reads the local save, verifying its tamper seal on the raw stored data
// (before normalisation), then migrates/normalises it.
function readSave() {
  try {
    const v2 = localStorage.getItem(STORAGE_KEY);
    if (v2) {
      const raw = JSON.parse(v2);
      const s = G.migrateSave(raw);
      if (s) {
        if (raw.seal && !S.verifySeal(raw)) flag(s, 'Save data was edited outside the game.');
        else if (!raw.seal && localStorage.getItem(SEALED_FLAG)) flag(s, 'Save protection data was removed.');
        return s;
      }
    }
    const v1 = localStorage.getItem(LEGACY_KEY);
    if (v1) {
      const s = G.migrateSave(JSON.parse(v1));
      if (s) { setTimeout(() => toast('Your save was upgraded! Existing Pokémon received natures, IVs and abilities.'), 1200); return s; }
    }
  } catch (e) { console.warn('Could not read save', e); }
  return G.defaultSave();
}
// Marks a save unranked. Never deletes anything; reasons are shown on the Trainer Card.
function flag(s, ...reasons) {
  s.integrity = s.integrity || { status: 'ok', reasons: [] };
  s.integrity.status = 'flagged';
  s.integrity.reasons = [...new Set([...(s.integrity.reasons || []), ...reasons])].slice(0, 12);
  s.integrity.since = s.integrity.since || new Date().toISOString();
}
function runAudit(s) { const issues = G.auditSave(s); if (issues.length) flag(s, ...issues); return issues; }
const ranked = () => save.integrity?.status !== 'flagged';
function persist() {
  save.lastActive = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S.applySeal(save)));
    localStorage.setItem(SEALED_FLAG, '1');
    if (!booting && !applyingRemoteSave) localStorage.setItem(LOCAL_MODIFIED_KEY, String(Date.now()));
  } catch (e) { console.warn('Could not save locally', e); toast('Could not save to this browser (storage full or blocked).'); }
  updateHud();
  if (!booting && !applyingRemoteSave && currentUser && authReady) { scheduleCloudSave(); scheduleLeaderboard(); }
}
// Every coin and Exp. change goes through the ledger so audits can check the totals.
function addCoins(n) { n = Math.max(0, Math.floor(n)); save.coins += n; save.ledger.earned += n; return n; }
function spendCoins(n) { n = Math.floor(n); if (n < 0 || save.coins < n) return false; save.coins -= n; save.ledger.spent += n; return true; }
function grantExp(p, amount) { const before = p.exp; const levels = G.gainExp(p, amount); save.ledger.expGranted += p.exp - before; return levels; }
function getLocalSaveModifiedAt() {
  try {
    const v = Number(localStorage.getItem(LOCAL_MODIFIED_KEY)) || Number(localStorage.getItem(LEGACY_MODIFIED_KEY));
    if (Number.isFinite(v) && v > 0) return v;
  } catch (e) {}
  return initialLocalSaveTimestamp;
}
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800); }

// ---------- Firebase auth + cloud save (unchanged strategy: last-modified wins) ----------
function setAuthStatus(message) { authStatusMessage = message; const s = $('#authStatus'); if (s) s.textContent = currentUser ? authStatusMessage : 'Not signed in. Progress stays on this device.'; }
function renderAuthState() {
  const a = $('#googleSignIn'), b = $('#googleSignOut');
  if (a) a.hidden = !!currentUser;
  if (b) b.hidden = !currentUser;
  const n = $('#profileName'); if (n) n.textContent = currentUser ? (currentUser.displayName || 'Signed in') : 'Guest (this device only)';
  setAuthStatus(authStatusMessage);
}
function authErrorMessage(error) {
  const code = error?.code || '';
  if (code === 'auth/unauthorized-domain') return 'This domain is not authorised. Add it under Firebase Authentication → Settings → Authorised domains.';
  if (code === 'auth/operation-not-allowed') return 'Google sign-in is not enabled yet. Enable Google in Firebase Authentication → Sign-in method.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google sign-in popup. Allow popups for this site and try again.';
  if (code === 'auth/popup-closed-by-user') return 'Google sign-in was cancelled.';
  if (code === 'auth/network-request-failed') return 'Network error during sign-in. Check your connection and try again.';
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return 'Firestore denied the request. Publish the rules in firestore.rules (users/{uid} and leaderboard/{uid}).';
  return error?.message || 'Something went wrong. Check the browser console for details.';
}
function writeCloudSave(user, snapshotSave) {
  const snapshot = JSON.parse(JSON.stringify(snapshotSave));
  const op = async () => {
    await fb.setDoc(fb.doc(db, 'users', user.uid), { schemaVersion: 2, saveData: snapshot, displayName: user.displayName || null, email: user.email || null, photoURL: user.photoURL || null, updatedAt: fb.serverTimestamp() }, { merge: true });
    try { localStorage.setItem(LOCAL_MODIFIED_KEY, String(Date.now())); } catch (e) {}
  };
  cloudWriteQueue = cloudWriteQueue.then(op, op);
  return cloudWriteQueue;
}
function scheduleCloudSave() {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    cloudSaveTimer = null;
    if (!currentUser || !authReady || applyingRemoteSave) return;
    const user = currentUser;
    writeCloudSave(user, save).then(() => { if (currentUser?.uid === user.uid) setAuthStatus('Signed in · cloud save synced.'); })
      .catch(err => { console.error('PokeDuel cloud save failed:', err); if (currentUser?.uid === user.uid) setAuthStatus('Signed in, but cloud save failed: ' + authErrorMessage(err)); });
  }, 650);
}
async function syncSignedInUser(user) {
  setAuthStatus('Signed in · checking your cloud save…');
  try {
    const snap = await fb.getDoc(fb.doc(db, 'users', user.uid));
    if (!snap.exists()) { await writeCloudSave(user, save); setAuthStatus('Signed in · this device’s progress was backed up to your account.'); toast('Progress backed up to your account.'); scheduleLeaderboard(); return; }
    const data = snap.data();
    const remote = G.migrateSave(data.saveData);
    if (!remote) throw new Error('The cloud save format is missing or unsupported. Your local save has not been deleted.');
    if (data.saveData?.seal && !S.verifySeal(data.saveData)) flag(remote, 'Cloud save was edited outside the game.');
    runAudit(remote);
    const cloudAt = Number(data.updatedAt?.toMillis?.() || Date.parse(remote.lastActive || '') || 0);
    if (getLocalSaveModifiedAt() > cloudAt) { await writeCloudSave(user, save); setAuthStatus('Signed in · your newer local progress was synced to the cloud.'); toast('Your local progress was synced to your account.'); scheduleLeaderboard(); return; }
    applyingRemoteSave = true;
    save = remote; persist();
    try { localStorage.setItem(LOCAL_MODIFIED_KEY, String(cloudAt || Date.now())); } catch (e) {}
    applyingRemoteSave = false;
    afterSaveReplaced();
    setAuthStatus('Signed in · cloud save synced.'); toast('Your account save has been loaded.');
    scheduleLeaderboard();
  } catch (err) {
    applyingRemoteSave = false;
    console.error('PokeDuel cloud sync failed:', err);
    setAuthStatus('Signed in, but cloud sync is unavailable: ' + authErrorMessage(err)); toast('Signed in, but cloud saving needs setup.');
  }
}
async function startFirebaseAuth() {
  try { await loadFirebase(); }
  catch (err) {
    console.warn('Firebase could not be loaded:', err);
    authStatusMessage = 'Cloud features are unavailable right now (could not reach Firebase). Your progress is saved on this device.';
    const st = $('#authStatus'); if (st) st.textContent = authStatusMessage;
    const btn = $('#googleSignIn'); if (btn) { btn.disabled = true; btn.title = 'Firebase could not be loaded'; }
    ui.firebaseDown = true;
    return;
  }
  $('#googleSignIn').addEventListener('click', async () => {
    const btn = $('#googleSignIn'); btn.disabled = true;
    try { await fb.signInWithPopup(auth, googleProvider); }
    catch (err) { console.error('Google sign-in failed:', err); const m = authErrorMessage(err); setAuthStatus(m); toast(m); }
    finally { btn.disabled = false; }
  });
  $('#googleSignOut').addEventListener('click', async () => {
    const btn = $('#googleSignOut'); btn.disabled = true;
    try { clearTimeout(cloudSaveTimer); cloudSaveTimer = null; if (currentUser && authReady) await writeCloudSave(currentUser, save); await fb.signOut(auth); toast('Signed out. Your local save is still on this device.'); }
    catch (err) { console.error('Sign-out failed:', err); const m = authErrorMessage(err); setAuthStatus(m); toast(m); }
    finally { btn.disabled = false; }
  });
  fb.onAuthStateChanged(auth, async user => {
    currentUser = user; authReady = true; renderAuthState();
    if (user) await syncSignedInUser(user); else setAuthStatus('Not signed in. Progress stays on this device.');
    if (activeScreen === 'leaderboard') renderRanks();
  });
}

// ---------- Leaderboards (Firestore /leaderboard/{uid}) ----------
const RANKS = [[0, 'Rookie'], [600, 'Trainer'], [2000, 'Ace Trainer'], [6000, 'Veteran'], [15000, 'Elite'], [40000, 'Champion']];
const rankName = score => RANKS.filter(r => score >= r[0]).pop()[1];
const trainerName = () => save.trainerName || 'Trainer';
function leaderboardDoc() {
  const showcase = (save.showcase.length ? save.showcase : save.party.slice(0, 3)).map(u => save.box.find(p => p.uid === u)).filter(Boolean).slice(0, 3)
    .map(p => ({ num: sp(p).num, shiny: !!p.shiny, level: p.level, mark: p.mark || null }));
  const daily = {};
  for (const [k, v] of Object.entries(save.dailyScores || {})) if (G.dayDiff(k, G.todayKey()) <= 2) daily[k] = v;
  return { name: trainerName().slice(0, 16), avatar: save.avatar || 25, score: G.trainerScore(save), wins: save.wins, dex: save.ownedDex.length, shinies: save.shinyDex.length,
    streak: save.checkin.best || 0, showcase, daily, updatedAt: fb.serverTimestamp() };
}
function scheduleLeaderboard() {
  clearTimeout(lbTimer);
  lbTimer = setTimeout(async () => {
    if (!currentUser || !save.starterChosen) return;
    if (!ranked()) { try { await fb.deleteDoc(fb.doc(db, 'leaderboard', currentUser.uid)); } catch (e) {} return; }
    try { await fb.setDoc(fb.doc(db, 'leaderboard', currentUser.uid), leaderboardDoc()); }
    catch (err) { console.warn('Leaderboard publish failed (will retry):', err); ui.lbError = authErrorMessage(err); clearTimeout(lbTimer); lbTimer = setTimeout(scheduleLeaderboard, 60000); }
  }, 20000);
}
const RANK_TABS = { score: ['Trainer Score', 'score', v => fmt(v) + ' TP'], today: ['Today’s Gauntlet', 'daily', v => fmt(v) + ' pts'], shinies: ['Shiny Hunters', 'shinies', v => v + ' shiny'], dex: ['Pokédex', 'dex', v => v + ' / 1025'] };
async function renderRanks() {
  $('#rankTabs').innerHTML = Object.entries(RANK_TABS).map(([k, v]) => `<button role="tab" data-rank="${k}" class="${ui.rankTab === k ? 'on' : ''}" aria-selected="${ui.rankTab === k}">${v[0]}</button>`).join('');
  const body = $('#rankBody');
  const mine = { score: G.trainerScore(save), today: save.dailyScores?.[G.todayKey()] || 0, shinies: save.shinyDex.length, dex: save.ownedDex.length }[ui.rankTab];
  const meCard = `<div class="rank-row me"><span class="pos">You</span><span class="who">${iconOf(save.avatar || 25, false)}<b>${esc(trainerName())}</b></span><span class="val">${RANK_TABS[ui.rankTab][2](mine)}</span></div>`;
  if (ui.firebaseDown) { body.innerHTML = meCard + '<div class="empty"><b>Leaderboards unavailable</b><p>Firebase could not be reached. Check your connection and reload.</p></div>'; return; }
  if (!currentUser) { body.innerHTML = meCard + `<div class="empty"><b>Sign in to compete</b><p>Leaderboards use your trainer name and scores only. Sign in with Google on the Trainer Card to publish your score.</p><button class="btn primary" data-go="profile">Go to Trainer Card</button></div>`; return; }
  const unrankedNote = ranked() ? '' : `<div class="integrity">${ic('warn')}<div><b>Your save is unranked</b>, so your score isn't published. See the Trainer Card for details.</div></div>`;
  body.innerHTML = meCard + unrankedNote + '<div class="loading"><span class="spinner"></span>Loading rankings…</div>';
  try {
    const [, field] = RANK_TABS[ui.rankTab];
    const order = ui.rankTab === 'today' ? fb.orderBy(new fb.FieldPath('daily', G.todayKey()), 'desc') : fb.orderBy(field, 'desc');
    const snap = await fb.getDocs(fb.query(fb.collection(db, 'leaderboard'), order, fb.limit(50)));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!rows.length) { body.innerHTML = meCard + '<div class="empty">No scores yet today. Be the first!</div>'; return; }
    body.innerHTML = meCard + unrankedNote + rows.map((r, i) => {
      const v = ui.rankTab === 'today' ? r.daily?.[G.todayKey()] || 0 : r[field] || 0;
      const sc = (r.showcase || []).map(s => iconOf(s.num, s.shiny)).join('');
      return `<div class="rank-row ${r.id === currentUser.uid ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="who">${iconOf(Number(r.avatar) || 25, false)}<b>${esc(r.name || 'Trainer')}</b><span class="showcase">${sc}</span></span><span class="val">${RANK_TABS[ui.rankTab][2](v)}</span></div>`;
    }).join('');
  } catch (err) {
    console.error('Leaderboard load failed', err);
    body.innerHTML = meCard + `<div class="empty"><b>Leaderboard unavailable</b><p>${esc(authErrorMessage(err))}</p><button class="btn ghost" data-rank="${ui.rankTab}">Try again</button></div>`;
  }
}

// ---------- Helpers ----------
const partyMons = () => save.party.map(u => save.box.find(p => p.uid === u)).filter(Boolean);
const lead = () => partyMons()[0] || null;
const byUid = u => save.box.find(p => p.uid === u);
const topLevel = () => partyMons().reduce((m, p) => Math.max(m, p.level), 5);
function bumpDay(stat, n = 1) {
  const key = G.todayKey();
  if (save.dayStats.date !== key) save.dayStats = { date: key, values: {} };
  save.dayStats.values[stat] = (save.dayStats.values[stat] || 0) + n;
}
function addToCollection(p) {
  save.ledger.pokemonGranted++;
  save.box.push(p);
  if (save.party.length < 6) save.party.push(p.uid);
  const n = sp(p).num;
  if (!save.ownedDex.includes(n)) save.ownedDex.push(n);
  if (p.shiny && !save.shinyDex.includes(n)) save.shinyDex.push(n);
}
function checkMedals() {
  for (const m of G.MEDALS) {
    if (save.medals[m.id] || !m.test(save)) continue;
    save.medals[m.id] = G.todayKey(); addCoins(m.reward);
    toast('Medal earned: ' + m.name + '! +' + m.reward + ' coins');
  }
}
function afterProgress() { checkMedals(); persist(); }
function learnNewMoves(p, levels) {
  const learned = [];
  for (const l of levels) for (const m of G.levelUpMoves(p.species)) {
    if (m.level !== l || !M()[m.id] || p.moves.includes(m.id)) continue;
    if (p.moves.length < 4) p.moves.push(m.id); else if (!p.learned.includes(m.id)) p.learned.push(m.id);
    learned.push(M()[m.id].name);
  }
  return learned;
}
function autoEvolutions(p) { return G.evolutionOptions(p, { inventory: {}, weather: G.dailyWeather(G.todayKey()).id, coins: save.coins }).filter(o => o.ok && !o.consume); }

// ---------- Daily reset ----------
function checkNewDay() {
  const key = G.todayKey();
  if (save.dailyDate !== key) { save.dailyDate = key; save.daily = { easy: null, medium: null, hard: null }; if (!booting) toast('A new day — a fresh gauntlet!'); }
  for (const k of DAILY) if (save.daily[k]?.result === 'pending') { save.daily[k] = { result: 'loss', score: 0, date: key, abandoned: true }; setTimeout(() => toast('An unfinished daily battle counted as a loss.'), 900); }
  if (save.missions.date !== key) save.missions = { date: key, list: G.dailyMissions(key), bonus: false };
  if (save.dayStats.date !== key) save.dayStats = { date: key, values: {} };
}

// ---------- Navigation ----------
const SCREENS = ['starter', 'home', 'boxes', 'shop', 'bag', 'dex', 'leaderboard', 'profile', 'medals', 'journey', 'battle'];
function go(name, opts = {}) {
  if (name === 'practice') { startBattle('practice'); return; }
  if (!SCREENS.includes(name)) name = 'home';
  if (!save.starterChosen) name = 'starter';
  if (activeScreen === 'battle' && name !== 'battle' && battleState && !battleState.b.ended) { confirmForfeit(() => go(name)); return; }
  activeScreen = name;
  document.body.classList.toggle('in-battle', name === 'battle');
  $('#hud').hidden = name === 'starter' || name === 'battle';
  $('#siteFoot').hidden = !['home', 'dex', 'leaderboard', 'profile', 'medals', 'journey'].includes(name);
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  $$('.hud-link').forEach(b => b.classList.toggle('active', b.dataset.go === name));
  if (!opts.noHash && location.hash !== '#/' + name) history.pushState(null, '', '#/' + name);
  window.scrollTo({ top: 0, behavior: 'auto' });
  ({ starter: renderStarter, home: renderHome, boxes: renderBoxes, shop: renderShop, bag: renderBag, dex: renderDex, leaderboard: renderRanks, profile: renderProfile, medals: renderMedals, journey: renderJourney }[name] || (() => {}))();
}
function updateHud() {
  if (!save) return;
  $('#coins').textContent = fmt(save.coins);
  for (const id of ['#shopCoins', '#bagCoins']) { const e = $(id); if (e) e.textContent = fmt(save.coins); }
  const score = G.trainerScore(save);
  $('#hudScore').textContent = fmt(score);
  $('#hudName').textContent = trainerName();
  $('#hudRank').textContent = rankName(score);
  const a = $('#hudAvatar'); const src = img.icon(save.avatar || 25, false); if (a.getAttribute('src') !== src) a.src = src;
}

// ---------- Modal ----------
let modalOnClose = null;
function showModal(html, { wide = false, onClose = null, locked = false } = {}) {
  $('#modalContent').innerHTML = html;
  $('#modal .modal').classList.toggle('wide', wide);
  $('#modal').classList.remove('hidden');
  $('#modal').dataset.locked = locked ? '1' : '';
  $('#modalClose').hidden = locked;
  modalOnClose = onClose;
  // Don't steal focus if the player (or a test) already focused a field in the dialog.
  setTimeout(() => { if ($('#modal').contains(document.activeElement)) return; ($('#modalContent [autofocus]') || $('#modalContent button') || $('#modalClose')).focus?.(); }, 30);
}
function closeModal(force) {
  if ($('#modal').dataset.locked && !force) return;
  $('#modal').classList.add('hidden');
  const cb = modalOnClose; modalOnClose = null;
  cb?.();
  if (activeScreen === 'home' && save) maybeCheckin();
}
function confirmBox(title, text, okLabel, onOk, danger) {
  showModal(`<h2 id="modalTitle">${esc(title)}</h2><p>${text}</p><div class="row-btns"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="confirmOk">${esc(okLabel)}</button></div>`);
  $('#confirmOk').onclick = () => { closeModal(true); onOk(); };
}
// Pick a Pokémon from the collection. filter(p) → true | string (reason disabled)
function pickPokemon(title, filter, onPick, { partyOnly = false } = {}) {
  const list = partyOnly ? partyMons() : [...partyMons(), ...save.box.filter(p => !save.party.includes(p.uid))];
  showModal(`<h2 id="modalTitle">${esc(title)}</h2><div class="pick-grid">${list.map(p => { const r = filter ? filter(p) : true; return `<button data-pick="${esc(p.uid)}" ${r === true ? '' : 'disabled title="' + esc(r) + '"'}>${iconOf(sp(p).num, p.shiny)}<span>${esc(p.nickname || sp(p).name)}${p.shiny ? shinyIc() : ''}</span><small class="muted">Lv. ${p.level}${r !== true ? ' · ' + esc(r) : ''}</small></button>`; }).join('') || '<div class="empty">No Pokémon available.</div>'}</div>`, { wide: true });
  $$('#modalContent [data-pick]').forEach(b => b.onclick = () => { closeModal(true); onPick(byUid(b.dataset.pick)); });
}

// ---------- Starter selection ----------
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
function renderStarter() {
  const ids = G.STARTERS_BY_GEN[ui.starterGen].map(n => G.speciesByNum(n));
  if (!ids.includes(ui.starterSel)) ui.starterSel = ui.starterSel && D()[ui.starterSel] && !ui.starterKeep ? ui.starterSel : ids[1];
  $('#generationBar').innerHTML = Object.keys(G.STARTERS_BY_GEN).map(g => `<button role="tab" class="gen-tab ${+g === ui.starterGen ? 'active' : ''}" data-gen="${g}" aria-selected="${+g === ui.starterGen}"><b>${ROMAN[g]}</b><small>${G.REGIONS['g' + g]}</small></button>`).join('');
  $('#onboardStarterGrid').innerHTML = ids.map(id => {
    const d = D()[id];
    return `<button type="button" class="st-mon ${tclass(d.types[0])} ${ui.starterSel === id ? 'selected' : ''}" data-pick-starter="${id}" aria-pressed="${ui.starterSel === id}" aria-label="${esc(d.name)}"><span class="art">${artOf(d.num, false, d.name)}</span><span class="st-plate"><small>No. ${String(d.num).padStart(4, '0')}</small><b>${esc(d.name)}</b>${typeChips(d.types)}</span></button>`;
  }).join('');
  const sel = D()[ui.starterSel];
  const screen = $('#screen-starter');
  if (sel) screen.style.setProperty('--tc', `var(--t-${sel.types[0].toLowerCase()})`);
  const total = sel ? sel.bs.reduce((a, b) => a + b, 0) : 0;
  $('#chosenSummary').innerHTML = sel ? `
    <div><div class="eyebrow">Your partner</div><h2>${esc(sel.name)}</h2>
      <div class="meta">${typeChips(sel.types)}<span class="tag">Base total ${total}</span></div>
      <p>Abilities: ${Object.entries(sel.ab).map(([k, a]) => `<b>${esc(a)}</b>${k === 'H' ? ' (hidden, 5%)' : ''}`).join(' · ')}</p></div>
    <div class="stat-bars">${E.STATS.map((k, i) => `<div><span>${STAT_LABEL[k]}</span><b>${sel.bs[i]}</b><i class="${sel.bs[i] === Math.max(...sel.bs) ? 'hi' : ''}" style="width:${Math.min(100, sel.bs[i] / 130 * 100)}%"></i></div>`).join('')}</div>
    <div class="st-cta"><label class="field"><span>Trainer name</span><input id="starterName" maxlength="16" placeholder="Your name" autocomplete="nickname" value="${esc(ui.starterName ?? save.trainerName ?? '')}"></label>
      <button class="btn primary big" id="confirmStarter">Choose ${esc(sel.name)}</button>
      <div class="keys-hint"><span><kbd>&larr;</kbd><kbd>&rarr;</kbd> Pick</span><span><kbd>Q</kbd><kbd>E</kbd> Generation</span><span><kbd>Enter</kbd> Choose</span></div></div>` : '';
}
function confirmStarter() {
  const id = ui.starterSel;
  if (!id || save.starterChosen) return;
  const name = ($('#starterName')?.value || '').trim().replace(/[<>]/g, '').slice(0, 16);
  save.trainerName = name || 'Trainer';
  const p = G.generatePokemon(id, 10, { origin: 'starter', markContext: markCtx() });
  p.friendship = 120;
  addToCollection(p);
  save.starterChosen = true; save.starterId = sp(p).num; save.avatar = sp(p).num;
  afterProgress();
  go('home');
  revealModal(p, { title: 'Your adventure begins!', subtitle: sp(p).name + ' is your first partner.' });
}
// ---------- Home ----------
const WEATHER_ICONS = { sunny: 'sun', cloudy: 'cloud', rain: 'rain', thunder: 'storm', snow: 'snow', blizzard: 'snow', 'harsh-sun': 'sun', sandstorm: 'sand', fog: 'fog' };
const TIER_NUM = { easy: 'I', medium: 'II', hard: 'III' };
const dailyNumber = () => Math.max(1, G.dayDiff('2026-10-28', G.todayKey()) + 1);
function untilReset() { const n = new Date(), m = new Date(n); m.setHours(24, 0, 0, 0); const t = Math.max(0, m - n) / 1000; return [t / 3600, (t % 3600) / 60, t % 60].map(x => String(Math.floor(x)).padStart(2, '0')).join(':'); }
let resetTimer = null;
// Home is a single focused daily column, like daily web puzzle games: today's
// three battles front and centre, the team underneath, everything else one tap away.
function renderHome() {
  checkNewDay();
  const key = G.todayKey(), w = G.dailyWeather(key);
  const claimed = save.checkin.last === key;
  const todayScore = save.dailyScores?.[key] || 0;
  const tiles = DAILY.map(k => { const r = save.daily[k]; return `<span class="ptile ${r ? r.result : ''}" title="${G.DAILY_TIERS[k].name}">${r?.result === 'win' ? ic('check') : r?.result === 'loss' ? ic('close') : TIER_NUM[k]}</span>`; }).join('');
  $('#dailyHead').innerHTML = `
    <div class="dh-bar"><span class="dh-no">Daily #${dailyNumber()}</span><span class="dh-date">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      <span class="dh-icons"><button class="icon-btn" id="howToPlay" aria-label="How to play" title="How to play"><b>?</b></button><button class="icon-btn" data-go="leaderboard" aria-label="Leaderboards" title="Leaderboards">${ic('rank')}</button><button class="icon-btn" data-go="profile" aria-label="Trainer card and settings" title="Trainer card and settings">${ic('card')}</button></span></div>
    <h1>Today's Gauntlet</h1>
    <p>Beat three trainers. One try each. Everyone faces the same teams today.</p>
    <div class="dh-progress"><span class="ptiles">${tiles}</span><span class="dh-score"><small>Today</small><b>${fmt(todayScore)}</b><small>pts</small></span></div>
    <div class="dh-chips"><span class="chip">${ic(WEATHER_ICONS[w.id] || 'sun')}${esc(w.name)}</span><button class="chip ${claimed ? '' : 'alert'}" id="openCheckin">${ic('calendar')}${claimed ? 'Streak ' + save.checkin.streak : 'Daily reward ready'}</button><span class="chip">${ic('bolt')}New battles in&nbsp;<b id="resetCountdown">${untilReset()}</b></span></div>`;
  $('#dailyCards').innerHTML = DAILY.map(k => {
    const t = G.DAILY_TIERS[k], r = save.daily[k];
    const tr = G.buildTrainer(k, key, topLevel());
    const team = tr.team.map(p => iconOf(sp(p).num, false, r ? sp(p).name : 'Hidden Pokémon')).join('');
    const action = !r ? `<button class="btn primary" data-battle="${k}">${ic('battle')}Battle</button>`
      : r.result === 'win' ? `<span class="res win"><b>${fmt(r.score)}</b><small>points</small></span><button class="icon-btn" data-share="${k}" aria-label="Share result" title="Share result">${ic('share')}</button>`
      : '<span class="res loss"><b>Lost</b><small>Back tomorrow</small></span>';
    return `<article class="drow ${k} ${r ? 'done ' + r.result : ''}"><span class="dnum">${TIER_NUM[k]}</span>
      <div class="dinfo"><span class="dtier">${k}</span><h3>${t.name}</h3><span class="dmeta">vs ${esc(tr.name)} · ${t.size} Pokémon · Lv. ${tr.level}${tr.sunday ? ' · Sunday legend' : ''}</span></div>
      <div class="dteam ${r ? 'shown' : ''}">${team}</div><div class="dact">${action}</div></article>`;
  }).join('');
  const party = partyMons();
  $('#teamStrip').innerHTML = `<div class="ts-head"><b>Your team</b><small>${party.length} / 6 · your lead goes first</small><button class="btn ghost small" data-go="boxes">${ic('box')}Edit team</button></div>
    <div class="ts-slots">${party.map((p, i) => `<button class="ts-slot ${i === 0 ? 'lead' : ''}" data-open-mon="${esc(p.uid)}" title="${esc(G.displayName(p))}">${artOf(sp(p).num, p.shiny, sp(p).name)}<span>${esc(p.nickname || sp(p).name)} · Lv. ${p.level}</span>${p.shiny ? shinyIc() : ''}</button>`).join('')}${Array.from({ length: 6 - party.length }, () => '<button class="ts-slot vacant" data-go="shop" aria-label="Get more Pokémon from the Shop">' + ic('plus') + '</button>').join('')}</div>`;
  renderMainMenu();
  updateHud();
  clearInterval(resetTimer);
  resetTimer = setInterval(() => { const el = $('#resetCountdown'); if (!el || activeScreen !== 'home') { clearInterval(resetTimer); return; } el.textContent = untilReset(); const mr = $('#missionReset'); if (mr) mr.textContent = el.textContent; if (save.dailyDate !== G.todayKey()) renderHome(); }, 1000);
  maybeCheckin();
}
function missionReady() { const v = save.dayStats.values; return save.missions.list.filter(m => !m.claimed && (v[m.stat] || 0) >= m.goal).length; }
function renderMainMenu() {
  const ready = missionReady();
  const left = Math.max(0, 5 - (save.outbreak.date === G.todayKey() ? save.outbreak.opened : 0));
  const items = [['journey', 'map', 'Journey', ''], ['practice', 'battle', 'Practice', ''], ['missions', 'mission', 'Missions', ready || ''], ['boxes', 'box', 'Boxes', ''], ['shop', 'shop', 'Shop', left ? 'New' : ''], ['bag', 'bag', 'Bag', ''], ['dex', 'dex', 'Pokédex', ''], ['medals', 'medal', 'Medals', '']];
  $('#mainMenu').innerHTML = items.map(([go, icon, label, badge]) => `<button class="qtile" data-go="${go}">${ic(icon)}<span>${label}</span>${badge ? `<i class="badge">${badge}</i>` : ''}</button>`).join('');
}
function showCheckin() {
  const key = G.todayKey();
  const claimed = save.checkin.last === key;
  const cont = save.checkin.last && G.dayDiff(save.checkin.last, key) === 1;
  const streakNow = claimed ? save.checkin.streak : (cont ? save.checkin.streak : 0);
  const today = claimed ? ((save.checkin.streak - 1) % 7) + 1 : (streakNow % 7) + 1;
  const doneUpTo = claimed ? today : today - 1;
  showModal(`<div class="eyebrow">Daily check-in</div><h2 id="modalTitle">${claimed ? 'See you tomorrow!' : 'Your daily reward'}</h2>
    <p>Check in every day to keep your streak. Missing a day restarts the 7-day cycle. Best streak: ${save.checkin.best || 0} days.</p>
    <div class="checkin-track">${G.CHECKIN_REWARDS.map(r => `<div class="ck-day ${r.day <= doneUpTo ? 'done' : ''} ${r.day === today && !claimed ? 'today' : ''}">${ic(r.day <= doneUpTo ? 'check' : r.box ? 'gift' : r.coins ? 'coin' : 'bag')}<b>Day ${r.day}</b><span>${esc(r.text)}</span></div>`).join('')}</div>
    <div class="row-btns">${claimed ? '<button class="btn primary" data-close autofocus>Close</button>' : '<button class="btn ghost" data-close>Later</button><button class="btn primary" id="claimCheckin" autofocus>Claim reward</button>'}</div>`);
}
function showHowTo() {
  showModal(`<div class="eyebrow">How to play</div><h2 id="modalTitle">PokeDuel in 30 seconds</h2>
    <ul class="howto">
      <li>${ic('battle')}<span><b>Three battles a day.</b> Warm-Up, Rival Test and Ace Challenge. One attempt each, with the same teams for every player.</span></li>
      <li>${ic('rank')}<span><b>Score points.</b> Win with more HP left and in fewer turns to score higher, then compare on the leaderboard.</span></li>
      <li>${ic('box')}<span><b>Grow your team.</b> Open boxes, train EVs, chase shinies and rare marks. Practice battles are unlimited.</span></li>
      <li>${ic('calendar')}<span><b>Come back tomorrow.</b> New trainers every day at midnight, plus a daily reward streak.</span></li>
    </ul><div class="row-btns"><button class="btn primary" data-close autofocus>Let's battle</button></div>`);
}
// Home intro queue: "How to play" once for new players, then the daily reward.
function maybeCheckin() {
  if (!save.starterChosen) return;
  const needHowTo = !save.seenHowTo;
  if (!needHowTo && (ui.checkinShown || save.checkin.last === G.todayKey())) return;
  setTimeout(() => {
    if (activeScreen !== 'home' || !$('#modal').classList.contains('hidden')) return;
    if (!save.seenHowTo) { save.seenHowTo = true; persist(); showHowTo(); return; }
    if (ui.checkinShown || save.checkin.last === G.todayKey()) return;
    ui.checkinShown = true; showCheckin();
  }, 450);
}
const MISSION_ICON = { practiceWins: 'battle', superEffective: 'bolt', crits: 'physical', boxesOpened: 'gift', teraUsed: 'gem', statusMoves: 'status', trainingItems: 'bag', kos: 'flame', dailyWins: 'rank', damageDealt: 'special' };
function showMissions() {
  const v = save.dayStats.values;
  const ms = save.missions.list;
  const claimed = ms.filter(m => m.claimed).length;
  const allDone = ms.length && ms.every(m => m.claimed);
  const total = ms.reduce((a, m) => a + m.reward, 0);
  const cards = ms.map((m, i) => {
    const prog = Math.min(m.goal, v[m.stat] || 0), pct = prog / m.goal * 100;
    const state = m.claimed ? 'done' : prog >= m.goal ? 'ready' : 'open';
    return `<li class="mcard ${state}"><span class="mnum">0${i + 1}</span><span class="micon">${ic(MISSION_ICON[m.stat] || 'mission')}</span>
      <b class="mtitle">${esc(m.text)}</b>
      <span class="mprog"><span class="mbar"><i style="width:${pct}%"></i></span><span class="mcount">${fmt(prog)} / ${fmt(m.goal)}</span></span>
      <span class="mfoot"><span class="mreward">${ic('coin')}${m.reward}</span>${state === 'done' ? `<span class="mstamp">${ic('check')}Claimed</span>` : state === 'ready' ? `<button class="btn primary small" data-claim-mission="${i}">Claim</button>` : `<span class="mleft">${fmt(m.goal - prog)} to go</span>`}</span></li>`;
  }).join('');
  const pips = ms.map(m => `<i class="${m.claimed ? 'on' : ''}"></i>`).join('');
  showModal(`<div class="mhead"><div><div class="eyebrow">Daily missions · resets in <b id="missionReset">${untilReset()}</b></div><h2 id="modalTitle">Today's missions</h2></div>
      <div class="mtotal"><small>Claimed</small><b>${claimed}<span>/${ms.length}</span></b><small>${total} coins available</small></div></div>
    <ul class="mgrid">${cards}</ul>
    <div class="mbonus ${allDone ? (save.missions.bonus ? 'done' : 'ready') : ''}">${pic(G.itemSprite('expcandyl'), [], 'alt=""')}<div><b>Daily bonus: Exp. Candy L</b><small>Claim all three missions to unlock it.</small><span class="mpips">${pips}</span></div>
      ${allDone ? (save.missions.bonus ? `<span class="mstamp">${ic('check')}Claimed</span>` : '<button class="btn primary" id="missionBonus">Claim bonus</button>') : `<span class="mleft">${ms.length - claimed} left</span>`}</div>
    <div class="row-btns"><button class="btn ghost" data-close>Close</button></div>`, { wide: true });
}
function claimCheckin() {
  const key = G.todayKey();
  if (save.checkin.last === key) return;
  const cont = save.checkin.last && G.dayDiff(save.checkin.last, key) === 1;
  save.checkin.streak = cont ? save.checkin.streak + 1 : 1;
  save.checkin.best = Math.max(save.checkin.best || 0, save.checkin.streak);
  save.checkin.last = key;
  const r = G.CHECKIN_REWARDS[(save.checkin.streak - 1) % 7];
  if (r.coins) addCoins(r.coins);
  for (const [id, n] of Object.entries(r.items || {})) save.inventory[id] = (save.inventory[id] || 0) + n;
  afterProgress(); closeModal(true); if (activeScreen === 'home') renderHome();
  if (r.box) openBox(r.box, true); else toast('Check-in reward: ' + r.text + '!');
}
// ---------- Boxes ----------
function filteredBox() {
  const q = ui.boxSearch.trim().toLowerCase();
  let list = [...save.box];
  if (q) list = list.filter(p => { const d = sp(p); return [d.name, p.nickname, ...d.types, p.mark && G.MARKS[p.mark].name, p.shiny && 'shiny', p.nature].join(' ').toLowerCase().includes(q); });
  const ivt = p => E.STATS.reduce((a, k) => a + p.ivs[k], 0);
  const sorts = { recent: (a, b) => (b.metAt || '').localeCompare(a.metAt || ''), dex: (a, b) => sp(a).num - sp(b).num, level: (a, b) => b.level - a.level, iv: (a, b) => ivt(b) - ivt(a), shiny: (a, b) => (b.shiny - a.shiny) || (b.mark ? 1 : 0) - (a.mark ? 1 : 0) };
  return list.sort(sorts[ui.boxSort] || sorts.recent);
}
function renderBoxes() {
  if (!ui.sel || !byUid(ui.sel)) ui.sel = save.party[0] || save.box[0]?.uid;
  const party = partyMons();
  $('#boxTotals').textContent = save.box.length + ' Pokémon · ' + save.shinyDex.length + ' shiny species';
  $('#boxParty').innerHTML = party.map(p => `<li><button class="${ui.sel === p.uid ? 'sel' : ''}" data-sel="${esc(p.uid)}"><span><span class="row1"><span class="lvpill">Lv. ${p.level}</span>${genderIcon(p.gender)}${p.shiny ? shinyIc() : ''}</span><b>${esc(p.nickname || sp(p).name)}</b></span>${iconOf(sp(p).num, p.shiny)}</button></li>`).join('') + Array.from({ length: 6 - party.length }, () => '<li><div class="empty-slot">Empty</div></li>').join('');
  const list = filteredBox();
  const pages = Math.max(1, Math.ceil(list.length / 30));
  ui.boxPage = Math.min(ui.boxPage, pages - 1);
  $('#boxName').textContent = 'Box ' + (ui.boxPage + 1) + ' / ' + pages;
  const slice = list.slice(ui.boxPage * 30, ui.boxPage * 30 + 30);
  $('#boxGrid').innerHTML = slice.map(p => `<button class="cell ${ui.sel === p.uid ? 'sel' : ''} ${save.party.includes(p.uid) ? 'in-party' : ''}" data-sel="${esc(p.uid)}" aria-label="${esc(sp(p).name)} level ${p.level}${p.shiny ? ', shiny' : ''}">${iconOf(sp(p).num, p.shiny)}${p.shiny ? '<svg class="cs shiny-ic" aria-hidden="true"><use href="assets/icons.svg#i-shiny"/></svg>' : ''}${p.mark ? '<svg class="cm" aria-hidden="true"><use href="assets/icons.svg#i-mark"/></svg>' : ''}</button>`).join('') + Array.from({ length: 30 - slice.length }, () => '<div class="cell"></div>').join('');
  renderSummary();
}
const STAT_LABEL = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
function radar(p) {
  // Hexagon in SV order: HP top, Atk upper-right, Def lower-right, Spe bottom, SpD lower-left, SpA upper-left.
  const order = ['hp', 'atk', 'def', 'spe', 'spd', 'spa'];
  const cx = 150, cy = 118, R = 78;
  const pt = (i, r) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const ivs = G.effectiveIvs(p);
  const poly = r => order.map((_, i) => pt(i, r).join(',')).join(' ');
  const val = order.map((k, i) => pt(i, 12 + (ivs[k] / 31) * (R - 12)).join(',')).join(' ');
  const labels = order.map((k, i) => { const [x, y] = pt(i, R + 22); return `<text x="${x}" y="${y - 6}" text-anchor="middle" class="lbl">${STAT_LABEL[k]}</text><text x="${x}" y="${y + 9}" text-anchor="middle">${G.ivJudge(ivs[k])}${p.hyper?.[k] ? ' (HT)' : ''}</text>`; }).join('');
  return `<svg class="radar" viewBox="0 0 300 240" role="img" aria-label="IV judge chart"><polygon points="${poly(R)}" fill="rgba(5,30,45,.45)" stroke="rgba(255,255,255,.5)"/><polygon points="${poly(R * .5)}" fill="none" stroke="rgba(255,255,255,.18)"/><polygon points="${val}" fill="rgba(120,220,255,.75)" stroke="#fff" stroke-width="1.5"/>${labels}</svg>`;
}
function renderSummary() {
  const el = $('#summaryPanel');
  const p = byUid(ui.sel);
  if (!p) { el.innerHTML = '<div class="empty">Select a Pokémon.</div>'; return; }
  const d = sp(p), st = G.statsOf(p);
  const nat = p.mint || p.nature, [plus, minus] = E.NATURES[nat];
  const ab = G.gameData.dex && E.data.abilities[p.ability];
  const prog = G.levelProgress(p);
  const tabs = { info: 'Info', stats: 'Stats', moves: 'Moves', marks: 'Marks' };
  let body = '';
  if (ui.sumTab === 'info') {
    body = `<dl class="kv"><dt>No.</dt><dd>${String(d.num).padStart(4, '0')} ${esc(d.name)}</dd>
      <dt>Types</dt><dd>${typeChips(d.types)}</dd><dt>Tera Type</dt><dd>${typeChips([p.teraType])}</dd>
      <dt>Nature</dt><dd>${cap(p.nature)}${p.mint ? ' (' + cap(p.mint) + ' Mint)' : ''}</dd>
      <dt>Ability</dt><dd>${esc(ab?.name || p.ability)}${p.abilitySlot === 'H' ? ' <span class="tag">Hidden</span>' : ''}${E.ABILITY_SUPPORT.has(p.ability) ? '' : ' <span class="tag" title="This ability has no effect in battle yet">not simulated</span>'}<br><small class="muted">${esc(ab?.desc || '')}</small></dd>
      <dt>Held item</dt><dd>${p.item ? pic(G.itemSprite(p.item), [], 'alt="" width="22" height="22"') + ' ' + esc(G.ITEMS[p.item]?.name) : 'None'}</dd>
      <dt>Exp. points</dt><dd>${fmt(p.exp)}${p.level < 100 ? ' · ' + fmt(prog.need - prog.cur) + ' to next' : ''}<div class="xp-bar"><i style="width:${prog.pct}%"></i></div></dd>
      <dt>Friendship</dt><dd>${p.friendship}/255</dd><dt>Size</dt><dd>${p.size === 255 ? 'Jumbo (255)' : p.size === 0 ? 'Mini (0)' : p.size + ' / 255'}</dd>
      <dt>Record</dt><dd>${p.wins || 0} wins · ${p.battles || 0} battles</dd><dt>Met</dt><dd>${new Date(p.metAt).toLocaleDateString()} · ${esc(p.origin)}</dd></dl>`;
  } else if (ui.sumTab === 'stats') {
    const ivSum = E.STATS.reduce((a, k) => a + p.ivs[k], 0), evSum = E.STATS.reduce((a, k) => a + p.evs[k], 0);
    body = radar(p) + `<p style="text-align:center;font-weight:800">${G.ivTotalJudge(ivSum)}</p><table class="stat-table"><tr><th>Stat</th><th>Value</th><th>IV</th><th>EV</th></tr>${E.STATS.map(k => `<tr><td class="${k === plus ? 'plus' : k === minus ? 'minus' : ''}">${STAT_LABEL[k]}${k === plus ? ' +10%' : k === minus ? ' −10%' : ''}</td><td>${st[k]}</td><td>${p.ivs[k]}${p.hyper?.[k] ? ' HT' : ''}</td><td>${p.evs[k]} <span class="ev-bar"><i style="width:${p.evs[k] / 252 * 100}%"></i></span></td></tr>`).join('')}</table><p class="muted">EVs ${evSum}/510 · Base stat total ${d.bs.reduce((a, b) => a + b, 0)} · ${G.GROWTH_NAMES[d.gr]} growth</p>`;
  } else if (ui.sumTab === 'moves') {
    body = `<div class="move-list">${p.moves.map(id => moveRow(id)).join('')}</div><button class="btn teal small" data-act="moves">Change moves</button>`;
  } else {
    body = p.marks.length ? `<div class="mark-list">${p.marks.map(m => `<div class="mark-row">${ic('mark')}<span>${esc(G.MARKS[m].name)}<br><small class="muted">Title: “${esc(G.MARKS[m].title)}”</small></span>${p.mark === m ? '<span class="tag">Shown</span>' : `<button class="btn small ghost" data-act="showmark" data-mark="${m}">Show title</button>`}</div>`).join('')}${p.mark ? '<button class="btn small ghost" data-act="hidemark">Hide title</button>' : ''}</div>` : '<p class="muted">No marks yet. Marks can appear on any Pokémon you get: rare, personality, time-of-day and weather marks, plus Jumbo/Mini, Partner and Mightiest marks earned in play.</p>';
  }
  const inParty = save.party.includes(p.uid);
  const evos = G.evolutionOptions(p, { inventory: save.inventory, weather: G.dailyWeather(G.todayKey()).id, coins: save.coins });
  const canEvo = evos.filter(o => o.ok);
  el.innerHTML = `<div class="sum-head"><span class="ball"></span><span>${esc(p.nickname || d.name)}</span>${genderIcon(p.gender)}${p.shiny ? shinyIc() : ''}<span class="lvl">Lv. ${p.level}</span></div>
    <div class="sum-scroll"><div class="sum-body"><div class="sum-art">${artOf(d.num, p.shiny, d.name)}${p.mark ? `<span class="mark-banner">${ic('mark')}${esc(G.displayName(p))}</span>` : ''}</div>
    <div class="sum-tabs" role="tablist">${Object.entries(tabs).map(([k, v]) => `<button role="tab" data-sumtab="${k}" class="${ui.sumTab === k ? 'on' : ''}" aria-selected="${ui.sumTab === k}">${v}</button>`).join('')}</div>${body}</div>
    <div class="sum-actions">
      ${inParty ? (save.party[0] === p.uid ? '' : '<button class="btn small primary" data-act="lead">Make lead</button>') + (save.party.length > 1 ? '<button class="btn small ghost" data-act="unparty">Move to box</button>' : '') : `<button class="btn small primary" data-act="party" ${save.party.length >= 6 ? 'disabled title="Party is full (6)"' : ''}>Add to party</button>`}
      ${canEvo.length ? `<button class="btn small teal" data-act="evolve">Evolve!</button>` : evos.length ? `<button class="btn small ghost" data-act="evoinfo">Evolution</button>` : ''}
      <button class="btn small ghost" data-act="item">${p.item ? 'Swap item' : 'Give item'}</button>${p.item ? '<button class="btn small ghost" data-act="take">Take item</button>' : ''}
      <button class="btn small ghost" data-act="use">Use item</button>
      <button class="btn small ghost" data-act="showcase">${save.showcase.includes(p.uid) ? 'Unshowcase' : 'Showcase'}</button>
      <button class="btn small ghost" data-act="nick">Nickname</button>
      <button class="btn small ghost" data-act="avatar">Set as avatar</button>
      <button class="btn small danger" data-act="release" ${save.box.length <= 1 ? 'disabled' : ''}>Release</button>
    </div></div>`;
}
const cap = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
function moveRow(id) {
  const m = M()[id]; if (!m) return '';
  const sup = E.moveSupport(id);
  return `<div class="move-row"><span class="type ${tclass(m.type)}">${esc(m.type)}</span><span><b>${esc(m.name)}</b>${m.champions ? ' <span class="tag" title="Champions balance change">C</span>' : ''}<br><small>${esc(m.desc || '')}${sup === 'partial' ? ' · special effect simplified' : ''}</small></span><small>${m.cat === 'Status' ? 'Status' : (m.bp || '—') + ' BP'} · ${m.acc === true ? '—' : m.acc + '%'} · ${m.pp} PP</small></div>`;
}
function summaryAction(act, btn) {
  const p = byUid(ui.sel); if (!p) return;
  const d = sp(p);
  switch (act) {
    case 'lead': save.party = [p.uid, ...save.party.filter(u => u !== p.uid)]; persist(); renderBoxes(); toast(d.name + ' will lead your team.'); break;
    case 'unparty': if (save.party.length <= 1) return; save.party = save.party.filter(u => u !== p.uid); persist(); renderBoxes(); break;
    case 'party': if (save.party.length >= 6) { toast('Your party is full (6).'); return; } save.party.push(p.uid); persist(); renderBoxes(); break;
    case 'evolve': case 'evoinfo': evolutionMenu(p); break;
    case 'item': giveItemMenu(p); break;
    case 'take': save.inventory[p.item] = (save.inventory[p.item] || 0) + 1; toast('Took the ' + G.ITEMS[p.item].name + '.'); p.item = null; persist(); renderBoxes(); break;
    case 'use': useItemMenu(p); break;
    case 'showcase':
      if (save.showcase.includes(p.uid)) save.showcase = save.showcase.filter(u => u !== p.uid);
      else { if (save.showcase.length >= 3) save.showcase.shift(); save.showcase.push(p.uid); toast(d.name + ' is now on your Trainer Card showcase.'); }
      persist(); renderSummary(); break;
    case 'nick':
      showModal(`<h2 id="modalTitle">Nickname</h2><input id="nickInput" maxlength="12" value="${esc(p.nickname)}" placeholder="${esc(d.name)}" autofocus><div class="row-btns"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nickOk">Save</button></div>`);
      $('#nickOk').onclick = () => { p.nickname = $('#nickInput').value.trim().replace(/[<>]/g, '').slice(0, 12); closeModal(true); persist(); renderBoxes(); };
      break;
    case 'avatar': save.avatar = d.num; persist(); toast(d.name + ' is your new avatar.'); break;
    case 'moves': moveEditor(p); break;
    case 'showmark': p.mark = btn.dataset.mark; persist(); renderSummary(); break;
    case 'hidemark': p.mark = null; persist(); renderSummary(); break;
    case 'release':
      confirmBox('Release ' + (p.nickname || d.name) + '?', 'This permanently removes ' + esc(G.displayName(p)) + ' (Lv. ' + p.level + (p.shiny ? ', shiny' : '') + ') from your collection.', 'Release', () => {
        save.box = save.box.filter(x => x.uid !== p.uid);
        save.party = save.party.filter(u => u !== p.uid);
        save.showcase = save.showcase.filter(u => u !== p.uid);
        if (!save.party.length && save.box.length) save.party.push(save.box[0].uid);
        ui.sel = null; persist(); renderBoxes(); toast('Bye-bye, ' + d.name + '!');
      }, true);
      break;
  }
}
function moveEditor(p) {
  const pool = [...new Set([...G.learnableAt(p.species, p.level), ...p.learned, ...p.moves])].filter(id => M()[id]);
  const tms = G.tmMoves(p.species).filter(id => !pool.includes(id));
  let chosen = [...p.moves];
  const tmPrice = id => 100 + Math.round((M()[id].bp || 40) * 3);
  const draw = () => {
    $('#modalContent').innerHTML = `<h2 id="modalTitle">${esc(sp(p).name)}'s moves</h2><p>Choose up to four. Level-up moves up to Lv. ${p.level} are free to relearn; TM moves can be taught for coins.</p>
      <div class="move-list">${pool.map(id => `<label class="move-row pick"><input type="checkbox" class="tick" data-mv="${id}" ${chosen.includes(id) ? 'checked' : ''} aria-label="Use ${esc(M()[id]?.name || id)}">${moveRow(id).replace(/^<div class="move-row">|<\/div>$/g, '')}</label>`).join('')}</div>
      ${tms.length ? `<details style="margin-top:12px"><summary class="btn ghost small">Teach a TM (${tms.length} available)</summary><div class="move-list" style="margin-top:8px">${tms.map(id => `<div class="move-row"><span class="type ${tclass(M()[id].type)}">${esc(M()[id].type)}</span><span><b>${esc(M()[id].name)}</b><br><small>${esc(M()[id].desc || '')}</small></span><button class="btn small primary" data-tm="${id}">${ic('coin')}${tmPrice(id)}</button></div>`).join('')}</div></details>` : ''}
      <div class="row-btns"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="movesOk">Save moves (${chosen.length}/4)</button></div>`;
    $$('#modalContent [data-mv]').forEach(c => c.onchange = () => {
      const id = c.dataset.mv;
      if (c.checked) { if (chosen.length >= 4) { c.checked = false; toast('Unselect a move first (max 4).'); return; } chosen.push(id); } else chosen = chosen.filter(x => x !== id);
      $('#movesOk').textContent = 'Save moves (' + chosen.length + '/4)';
    });
    $$('#modalContent [data-tm]').forEach(b => b.onclick = () => {
      const id = b.dataset.tm, price = tmPrice(id);
      if (!spendCoins(price)) { toast('Not enough coins.'); return; }
      p.learned.push(id); pool.push(id); tms.splice(tms.indexOf(id), 1); persist(); toast(sp(p).name + ' can now use ' + M()[id].name + '!'); draw();
    });
    $('#movesOk').onclick = () => { if (!chosen.length) { toast('Pick at least one move.'); return; } p.moves = chosen; persist(); closeModal(true); renderSummary(); };
  };
  showModal('', { wide: true });
  draw();
}
function evolutionMenu(p) {
  const opts = G.evolutionOptions(p, { inventory: save.inventory, weather: G.dailyWeather(G.todayKey()).id, coins: save.coins });
  showModal(`<h2 id="modalTitle">${esc(sp(p).name)} can evolve into…</h2><div class="move-list">${opts.map(o => `<div class="move-row">${iconOf(D()[o.into].num, p.shiny)}<span><b>${esc(o.name)}</b><br><small>${esc(o.need)}</small></span>${o.ok ? `<button class="btn small teal" data-evo="${o.into}">Evolve</button>` : '<span class="tag">Not yet</span>'}</div>`).join('')}</div>`, { wide: true });
  $$('#modalContent [data-evo]').forEach(b => b.onclick = () => { const o = opts.find(x => x.into === b.dataset.evo); closeModal(true); doEvolve(p, o); });
}
function doEvolve(p, o, then) {
  const fromNum = sp(p).num;
  preload(img.art(D()[o.into].num, p.shiny));
  showModal(`<div class="reveal"><div class="stage">${artOf(fromNum, p.shiny)}</div><h2 id="modalTitle">What? ${esc(sp(p).name)} is evolving!</h2></div>`, { locked: true });
  setTimeout(() => {
    if (o.consume) { save.inventory[o.consume]--; if (save.inventory[o.consume] <= 0) delete save.inventory[o.consume]; }
    const expBefore = p.exp;
    const r = G.evolve(p, o.into);
    save.ledger.expGranted += p.exp - expBefore;
    save.stats.evolutions++;
    const n = sp(p).num;
    if (!save.ownedDex.includes(n)) save.ownedDex.push(n);
    if (p.shiny && !save.shinyDex.includes(n)) save.shinyDex.push(n);
    afterProgress();
    showModal(`<div class="reveal ${p.shiny ? 'shiny' : ''}"><div class="stage">${artOf(n, p.shiny)}</div><h2 id="modalTitle">Congratulations!</h2><p>Your ${esc(r.from)} evolved into ${esc(r.to)}!</p><div class="row-btns"><button class="btn primary" data-close autofocus>Great!</button></div></div>`, { onClose: () => { if (activeScreen === 'boxes') renderBoxes(); then?.(); } });
  }, save.settings.reducedEffects ? 200 : 1800);
}
function giveItemMenu(p) {
  const held = Object.keys(save.inventory).filter(id => G.ITEMS[id]?.hold && save.inventory[id] > 0);
  if (!held.length) { toast('You have no holdable items. Visit the Shop!'); return; }
  showModal(`<h2 id="modalTitle">Give an item to ${esc(sp(p).name)}</h2><div class="pick-grid">${held.map(id => `<button data-give="${id}">${pic(G.itemSprite(id), [], 'alt=""')}<span>${esc(G.ITEMS[id].name)}</span><small class="muted">×${save.inventory[id]}</small></button>`).join('')}</div>`, { wide: true });
  $$('#modalContent [data-give]').forEach(b => b.onclick = () => {
    const id = b.dataset.give;
    if (p.item) save.inventory[p.item] = (save.inventory[p.item] || 0) + 1;
    p.item = id; save.inventory[id]--; if (!save.inventory[id]) delete save.inventory[id];
    closeModal(true); persist(); renderBoxes(); toast(sp(p).name + ' is now holding ' + G.ITEMS[id].name + '.');
  });
}
function useItemMenu(p) {
  const usable = Object.keys(save.inventory).filter(id => save.inventory[id] > 0 && isUsableOutside(G.ITEMS[id]));
  if (!usable.length) { toast('No usable items. Training and evolution items are in the Shop.'); return; }
  showModal(`<h2 id="modalTitle">Use an item on ${esc(sp(p).name)}</h2><div class="pick-grid">${usable.map(id => `<button data-useon="${id}">${pic(G.itemSprite(id), [], 'alt=""')}<span>${esc(G.ITEMS[id].name)}</span><small class="muted">×${save.inventory[id]}</small></button>`).join('')}</div>`, { wide: true });
  $$('#modalContent [data-useon]').forEach(b => b.onclick = () => { closeModal(true); applyItem(b.dataset.useon, p); });
}
const isUsableOutside = it => it && (it.exp || it.levelUp || it.ev || it.resetEvs || it.hyperOne || it.hyperAll || it.abilityCapsule || it.abilityPatch || it.teraChange || it.mint || it.friendship || it.cat === 'evolution' && !it.hold || it.id === 'linkingcord');
function consume(id) { save.inventory[id]--; if (save.inventory[id] <= 0) delete save.inventory[id]; }
function applyItem(id, p) {
  const it = G.ITEMS[id], d = sp(p), name = p.nickname || d.name;
  const done = (msg, training = true) => { consume(id); if (training) { save.stats.trainingItems++; bumpDay('trainingItems'); } afterProgress(); toast(msg); if (activeScreen === 'boxes') renderBoxes(); if (activeScreen === 'bag') renderBag(); };
  if (it.exp || it.levelUp) {
    if (p.level >= 100) { toast("It won't have any effect."); return; }
    const amt = it.levelUp ? G.expForLevel(d.gr, p.level + 1) - p.exp : it.exp;
    const lv = grantExp(p, amt);
    const learned = learnNewMoves(p, lv);
    p.friendship = Math.min(255, p.friendship + (it.levelUp ? 3 : 1));
    done(name + (lv.length ? ' grew to Lv. ' + p.level + '!' : ' gained ' + fmt(amt) + ' Exp. Points!') + (learned.length ? ' Learned ' + learned.join(', ') + '!' : ''));
    const evo = autoEvolutions(p); if (evo.length) setTimeout(() => doEvolve(p, evo[0]), 600);
    return;
  }
  if (it.ev) { const applied = G.addEvs(p, it.ev); if (!Object.keys(applied).length) { toast("It won't have any effect."); return; } return done(name + "'s " + STAT_LABEL[Object.keys(applied)[0]] + ' effort rose!'); }
  if (it.resetEvs) { if (!E.STATS.some(k => p.evs[k])) { toast("It won't have any effect."); return; } for (const k of E.STATS) p.evs[k] = 0; return done(name + "'s EVs were reset."); }
  if (it.friendship) { if (p.friendship >= 255) { toast("It won't have any effect."); return; } p.friendship = Math.min(255, p.friendship + it.friendship); if (p.friendship >= 255 && !p.marks.includes('partner')) { p.marks.push('partner'); toast(name + ' earned the Partner Mark!'); } return done(name + ' looks happy! Friendship ' + p.friendship + '/255.', false); }
  if (it.hyperOne || it.hyperAll) {
    if (p.level < 50) { toast('Hyper Training needs a Pokémon at level 50 or higher.'); return; }
    const open = E.STATS.filter(k => p.ivs[k] < 31 && !p.hyper?.[k]);
    if (!open.length) { toast("It won't have any effect."); return; }
    if (it.hyperAll) { p.hyper = p.hyper || {}; for (const k of open) p.hyper[k] = true; return done(name + ' was Hyper Trained in every stat!'); }
    showModal(`<h2 id="modalTitle">Hyper Training</h2><p>Choose a stat to treat as a perfect 31.</p><div class="row-btns" style="justify-content:flex-start">${open.map(k => `<button class="btn ghost" data-ht="${k}">${STAT_LABEL[k]} (${p.ivs[k]})</button>`).join('')}</div>`);
    $$('#modalContent [data-ht]').forEach(b => b.onclick = () => { p.hyper = p.hyper || {}; p.hyper[b.dataset.ht] = true; closeModal(true); done(name + "'s " + STAT_LABEL[b.dataset.ht] + ' was Hyper Trained!'); });
    return;
  }
  if (it.abilityCapsule) { if (!d.ab['1'] || p.abilitySlot === 'H') { toast("It won't have any effect."); return; } p.abilitySlot = p.abilitySlot === '0' ? '1' : '0'; p.ability = E.toId(d.ab[p.abilitySlot]); return done(name + "'s Ability became " + d.ab[p.abilitySlot] + '!'); }
  if (it.abilityPatch) { if (!d.ab.H || p.abilitySlot === 'H') { toast("It won't have any effect."); return; } p.abilitySlot = 'H'; p.ability = E.toId(d.ab.H); return done(name + "'s Ability became " + d.ab.H + '!'); }
  if (it.mint) { if ((p.mint || p.nature) === it.mint) { toast("It won't have any effect."); return; } p.mint = it.mint === p.nature ? null : it.mint; return done(name + "'s stats may grow differently now!"); }
  if (it.teraChange) {
    showModal(`<h2 id="modalTitle">Choose a Tera Type</h2><div class="types" style="gap:8px">${E.TYPES.filter(t => t !== p.teraType).map(t => `<button class="type ${tclass(t)}" data-tera="${t}" style="border:0;cursor:pointer;padding:6px 12px 6px 4px">${t}</button>`).join('')}</div>`);
    $$('#modalContent [data-tera]').forEach(b => b.onclick = () => { p.teraType = b.dataset.tera; closeModal(true); done(name + "'s Tera Type is now " + p.teraType + '!'); });
    return;
  }
  if (it.cat === 'evolution' || id === 'linkingcord') {
    const o = G.evolutionOptions(p, { inventory: save.inventory, coins: save.coins }).find(x => x.ok && x.consume === id);
    if (!o) { toast("It won't have any effect."); return; }
    doEvolve(p, o, () => { if (activeScreen === 'bag') renderBag(); });
    return;
  }
  toast("It won't have any effect.");
}

// ---------- Shop ----------
const SHOP_CATS = { boxes: ['Pokémon boxes', 'gift'], medicine: ['Medicine', 'heart'], training: ['Training', 'bolt'], held: ['Held items', 'gem'], evolution: ['Evolution', 'shiny'], key: ['Key items', 'lock'] };
const BOX_TIER = { starter: 'starter', basic: 'basic', rare: 'rare', master: 'master', outbreak: 'outbreak' };
// One discounted item per day (same for everyone), 30% off.
function dailyDeal() {
  const pool = Object.values(G.ITEMS).filter(i => ['medicine', 'training', 'held'].includes(i.cat) && !i.notForSale && i.price >= 60).map(i => i.id).sort();
  return pool[G.dailyRng(G.todayKey(), 'deal').int(pool.length)];
}
const priceOf = id => { const it = G.ITEMS[id]; return id === dailyDeal() ? Math.round(it.price * 0.7) : it.price; };
function shopEntries(cat) {
  if (cat === 'boxes') return Object.keys(G.BOXES).map(k => ({ id: 'box:' + k, box: k, name: G.BOXES[k].name, price: G.BOXES[k].price })).sort((a, b) => a.price - b.price);
  return Object.values(G.ITEMS).filter(i => i.cat === cat && !i.notForSale).map(i => ({ id: i.id, name: i.name, price: priceOf(i.id) }));
}
function boxArt(k) { return k === 'outbreak' ? D()[G.dailyOutbreak(G.todayKey())].num : G.BOXES[k].art; }
function renderShop() {
  $('#shopCats').innerHTML = Object.entries(SHOP_CATS).map(([k, [n, icon]]) => `<button role="tab" class="bag-cat ${ui.shopCat === k ? 'on' : ''}" data-shopcat="${k}" aria-selected="${ui.shopCat === k}">${ic(icon)}${n}</button>`).join('');
  const list = shopEntries(ui.shopCat);
  if (!list.find(x => x.id === ui.shopSel)) ui.shopSel = list[0]?.id;
  const key = G.todayKey(), deal = dailyDeal(), ob = D()[G.dailyOutbreak(key)];
  const left = Math.max(0, 5 - (save.outbreak.date === key ? save.outbreak.opened : 0));
  const features = `<div class="feature-row">
    <button class="feature ${ui.shopSel === 'box:outbreak' ? 'on' : ''}" data-feature="box:outbreak" data-cat="boxes">${artOf(ob.num, false, ob.name)}<span><span class="k">Mass outbreak</span><b>${esc(ob.name)}</b><small>Boosted shiny odds · ${left} of 5 left today</small></span></button>
    <button class="feature deal ${ui.shopSel === deal ? 'on' : ''}" data-feature="${deal}" data-cat="${G.ITEMS[deal].cat}">${pic(G.itemSprite(deal), [], 'alt="" class="px"')}<span><span class="k">Deal of the day · 30% off</span><b>${esc(G.ITEMS[deal].name)}</b><small>${fmt(priceOf(deal))} coins instead of ${fmt(G.ITEMS[deal].price)}</small></span></button></div>`;
  const cards = list.map(x => {
    if (x.box) return `<li><button class="item-card box-card tier-${BOX_TIER[x.box] || 'region'} ${ui.shopSel === x.id ? 'on' : ''}" data-shopsel="${x.id}"><span class="tile">${pic(img.art(boxArt(x.box), false), [img.icon(boxArt(x.box), false)], 'alt="" class="art" loading="lazy"')}</span><b>${esc(x.name)}</b><span class="price">${ic('coin')}${fmt(x.price)}</span></button></li>`;
    const it = G.ITEMS[x.id];
    const own = it.key ? (save.keyItems[x.id] ? 'Owned' : '') : (save.inventory[x.id] ? '×' + save.inventory[x.id] : '');
    return `<li><button class="item-card ${ui.shopSel === x.id ? 'on' : ''}" data-shopsel="${x.id}">${own ? `<span class="own">${own}</span>` : ''}${x.id === deal ? '<span class="sale">-30%</span>' : ''}<span class="tile">${pic(G.itemSprite(x.id), [SPR + '/items/poke-ball.png'], 'alt="" loading="lazy"')}</span><b>${esc(x.name)}</b><span class="price">${ic('coin')}${x.id === deal ? `<s>${fmt(it.price)}</s>` : ''}${fmt(x.price)}</span></button></li>`;
  }).join('');
  $('#shopMain').innerHTML = features + `<div class="section-title"><h2>${SHOP_CATS[ui.shopCat][0]}</h2><span class="tag">${list.length} items</span></div><ul class="item-grid">${cards}</ul>`;
  renderShopDetail();
  if (ui.shopCat === 'boxes') startBoxCycle();
  updateHud();
}
// Selecting an item only moves the highlight and redraws the detail panel, so the
// grid's images aren't rebuilt (rebuilding them made the screen flicker).
function selectShopItem(id) {
  ui.shopSel = id; ui.shopQty = 1;
  $$('#shopMain [data-shopsel], #shopMain [data-feature]').forEach(b => b.classList.toggle('on', (b.dataset.shopsel || b.dataset.feature) === id));
  renderShopDetail();
}
// Each box tile cycles through Pokémon from its own pool every 3 seconds.
let boxCycleTimer = null;
function startBoxCycle() {
  clearInterval(boxCycleTimer);
  if (save.settings.reducedEffects) return;
  let tick = 0;
  boxCycleTimer = setInterval(() => {
    const cards = $$('#shopMain .box-card');
    if (activeScreen !== 'shop' || !cards.length) { clearInterval(boxCycleTimer); boxCycleTimer = null; return; }
    if (document.hidden) return;
    tick++;
    cards.forEach((card, i) => {
      const k = card.dataset.shopsel.slice(4);
      if (k === 'outbreak') return;
      const pool = G.BOXES[k].odds.flatMap(o => G.boxPool(o[2]));
      const n = D()[pool[Math.floor(Math.random() * pool.length)]].num;
      const imgEl = card.querySelector('.tile img'); if (!imgEl) return;
      const next = new Image(); next.src = img.art(n, false);
      // Stagger the swaps so the grid ripples instead of changing all at once.
      setTimeout(() => next.decode().then(() => {
        imgEl.classList.add('swap');
        setTimeout(() => { imgEl.src = next.src; imgEl.removeAttribute('data-fb'); imgEl.classList.remove('swap'); }, 220);
      }).catch(() => {}), (i % 7) * 120);
    });
  }, 3000);
}
function renderShopDetail() {
  const el = $('#shopDetail');
  const id = ui.shopSel;
  if (!id) { el.innerHTML = ''; return; }
  if (id.startsWith('box:')) {
    const k = id.slice(4), bx = G.BOXES[k];
    const key = G.todayKey();
    const ob = k === 'outbreak' ? D()[G.dailyOutbreak(key)] : null;
    const left = k === 'outbreak' ? Math.max(0, 5 - (save.outbreak.date === key ? save.outbreak.opened : 0)) : null;
    const charm = save.keyItems.shinycharm;
    const shiny = k === 'outbreak' ? (charm ? '3/1024' : '1/1024') : (charm ? '3/8192' : '1/8192');
    el.innerHTML = `<div class="art">${pic(img.art(boxArt(k), false), [img.icon(boxArt(k), false)], 'alt="" class="hd"')}</div><h3>${esc(bx.name)}</h3><p>${esc(bx.desc)}${ob ? ' Today: <b>' + esc(ob.name) + '</b>.' : ''}</p>
      <div class="odds">${bx.odds.map(o => `<div class="odds-row"><span>${esc(o[0])}</span><b>${o[1]}%</b></div>`).join('')}
      <div class="odds-row"><span>Shiny${charm ? ' (Shiny Charm)' : ''}</span><b>${shiny}</b></div>
      <div class="odds-row"><span>Any mark (approx.)</span><b>~${save.keyItems.markcharm ? '20' : '7'}%</b></div>
      <div class="odds-row"><span>Hidden Ability</span><b>5%</b></div>${bx.perfectIvs ? `<div class="odds-row"><span>Guaranteed perfect IVs</span><b>${bx.perfectIvs}+</b></div>` : ''}</div>
      <p class="muted">Arrives at Lv. ${G.boxLevel(k, topLevel())} (scales with your party).</p>
      <div class="price-row"><span class="price">${ic('coin')}${fmt(bx.price)}</span>${left !== null ? `<span class="tag">${left} / 5 left today</span>` : ''}<button class="btn primary big" data-box="${k}" ${save.coins < bx.price || left === 0 ? 'disabled' : ''}>${save.coins < bx.price ? 'Not enough coins' : left === 0 ? 'Sold out today' : 'Open box'}</button></div>`;
    return;
  }
  const it = G.ITEMS[id];
  const own = it.key ? (save.keyItems[id] ? 1 : 0) : (save.inventory[id] || 0);
  const qty = it.key ? 1 : ui.shopQty;
  const unit = priceOf(id), total = unit * qty;
  const kinds = [it.hold && 'Hold item', it.battle && 'Usable in battle', isUsableOutside(it) && 'Use from Bag', it.key && 'Always active'].filter(Boolean);
  el.innerHTML = `<div class="art">${pic(G.itemSprite(id), [SPR + '/items/poke-ball.png'], 'alt=""')}</div><h3>${esc(it.name)}</h3>
    <div class="kind">${kinds.map(k => `<span class="tag">${k}</span>`).join('')}${id === dailyDeal() ? '<span class="tag pink">Deal of the day</span>' : ''}</div><p>${esc(it.desc)}</p>
    <p class="muted">In your Bag: ${it.key ? (own ? 'owned' : 'not owned') : own}</p>
    <div class="price-row"><span class="price">${ic('coin')}${fmt(total)}${unit !== it.price && qty === 1 ? ` <s>${fmt(it.price)}</s>` : ''}</span>${it.key ? '' : `<span class="qty-step"><button data-qty="-1" aria-label="Decrease quantity">${ic('minus')}</button><span>${qty}</span><button data-qty="1" aria-label="Increase quantity">${ic('plus')}</button></span>`}
    <button class="btn primary big" data-buy="${id}" ${save.coins < total || (it.key && own) ? 'disabled' : ''}>${it.key && own ? 'Owned' : save.coins < total ? 'Not enough coins' : 'Buy'}</button></div>`;
}
function buyItem(id) {
  const it = G.ITEMS[id]; if (!it) return;
  const qty = it.key ? 1 : ui.shopQty, total = priceOf(id) * qty;
  if (it.key && save.keyItems[id]) return;
  if (!spendCoins(total)) { toast('Not enough coins.'); return; }
  if (it.key) save.keyItems[id] = true;
  else save.inventory[id] = (save.inventory[id] || 0) + qty;
  afterProgress();
  const card = $(`#shopMain [data-shopsel="${id}"]`);
  if (card) { let own = card.querySelector('.own'); if (!own) { own = document.createElement('span'); own.className = 'own'; card.prepend(own); } own.textContent = it.key ? 'Owned' : '×' + save.inventory[id]; }
  renderShopDetail(); updateHud();
  toast('Bought ' + (qty > 1 ? qty + '× ' : '') + it.name + '!');
}
// ---------- Boxes (lootboxes) ----------
function markCtx() { return { date: new Date(), weatherMark: G.dailyWeather(G.todayKey()).mark, markCharm: !!save.keyItems.markcharm, createdAt: save.createdAt }; }
function openBox(kind, free) {
  const bx = G.BOXES[kind]; if (!bx) return;
  const key = G.todayKey();
  if (kind === 'outbreak') { if (save.outbreak.date !== key) save.outbreak = { date: key, opened: 0 }; if (save.outbreak.opened >= 5) { toast('Today\'s outbreak boxes are sold out. Come back tomorrow!'); return; } }
  if (!free && !spendCoins(bx.price)) { toast('Not enough coins.'); return; }
  if (kind === 'outbreak') save.outbreak.opened++;
  const rng = E.makeRng(Math.floor(Math.random() * 2 ** 32));
  const { species } = G.rollBox(kind, rng, { outbreak: G.dailyOutbreak(key) });
  const base = kind === 'outbreak' ? G.SHINY_OUTBREAK : G.SHINY_BASE;
  const p = G.generatePokemon(species, G.boxLevel(kind, topLevel()), { rng, origin: bx.name, shinyRate: base * (save.keyItems.shinycharm ? 3 : 1), perfectIvs: bx.perfectIvs, markContext: markCtx() });
  addToCollection(p);
  save.stats.boxesOpened++; bumpDay('boxesOpened');
  afterProgress();
  if (activeScreen === 'shop') renderShop(); if (activeScreen === 'home') renderHome();
  const sub = G.BOXES[kind].odds.map(o => o[2]);
  const reelPool = kind === 'outbreak' ? [G.dailyOutbreak(key)] : sub.flatMap(k => G.boxPool(k));
  revealModal(p, { again: free ? null : kind, reel: reelPool });
}
// Casino-style vertical reel: icons spin past a lit window and land on the prize.
const REEL_STEP = 112, REEL_LEN = 34, REEL_STOP = 30;
function spinReel(p, pool) {
  const r = E.makeRng(Math.floor(Math.random() * 2 ** 32));
  const strip = Array.from({ length: REEL_LEN }, (_, i) => i === REEL_STOP ? p.species : pool[r.int(pool.length)]);
  const items = strip.map((id, i) => { const n = D()[id].num; return `<li class="${i === REEL_STOP ? 'prize' : ''}">${pic(img.icon(n, i === REEL_STOP && p.shiny), [img.icon(n, false)], 'alt=""')}</li>`; }).join('');
  const lights = Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join('');
  showModal(`<div class="reveal"><div class="eyebrow">Opening box</div><div class="reel ${p.shiny ? 'shiny' : ''}" aria-hidden="true"><div class="reel-lights">${lights}</div><div class="reel-window"><ul class="reel-strip" style="--stop:${-(REEL_STOP - 1) * REEL_STEP}px">${items}</ul><span class="reel-pointer l"></span><span class="reel-pointer r"></span></div></div><h2 id="modalTitle">Spinning…</h2></div>`, { locked: true });
  requestAnimationFrame(() => requestAnimationFrame(() => $('#modalContent .reel')?.classList.add('spin')));
}
function revealModal(p, { title, subtitle, again, reel } = {}) {
  const d = sp(p);
  const ivSum = E.STATS.reduce((a, k) => a + p.ivs[k], 0);
  const perfect = E.STATS.filter(k => p.ivs[k] === 31).length;
  preload(img.art(d.num, p.shiny));
  const spin = reel?.length && !save.settings.reducedEffects;
  if (spin) spinReel(p, reel);
  else showModal(`<div class="reveal"><div class="stage"><div class="crate"></div></div><h2 id="modalTitle">Opening…</h2></div>`, { locked: true });
  const finish = () => {
    const sparkles = p.shiny ? Array.from({ length: 6 }, (_, i) => `<svg class="sparkle" style="left:${10 + i * 15}%;top:${(i * 37) % 80}%;animation-delay:${i * .15}s" aria-hidden="true"><use href="assets/icons.svg#i-shiny"/></svg>`).join('') : '';
    showModal(`<div class="reveal ${p.shiny ? 'shiny' : ''}"><div class="stage">${sparkles}${artOf(d.num, p.shiny, d.name)}</div>
      <h2 id="modalTitle">${esc(title || (p.shiny ? 'A shiny ' + d.name + '!' : 'You got ' + d.name + '!'))}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
      ${typeChips(d.types)}
      <div class="badges">${p.shiny ? `<span class="badge-chip gold">${ic('shiny')}Shiny</span>` : ''}${p.mark ? `<span class="badge-chip pink">${esc(G.MARKS[p.mark].name)} · “${esc(G.MARKS[p.mark].title)}”</span>` : ''}${p.abilitySlot === 'H' ? '<span class="badge-chip gold">Hidden Ability</span>' : ''}${perfect ? `<span class="badge-chip">${perfect}× Best IV</span>` : ''}
      <span class="badge-chip">Lv. ${p.level}</span><span class="badge-chip">${cap(p.nature)} nature</span><span class="badge-chip">Tera ${p.teraType}</span><span class="badge-chip">${esc(E.data.abilities[p.ability]?.name || p.ability)}</span>${p.size === 255 ? '<span class="badge-chip">Jumbo size</span>' : p.size === 0 ? '<span class="badge-chip">Mini size</span>' : ''}</div>
      <p class="muted">${G.ivTotalJudge(ivSum)} ${save.party.includes(p.uid) ? 'Added to your party.' : 'Sent to your Boxes.'}</p>
      <div class="row-btns" style="justify-content:center"><button class="btn ghost" id="revealBoxes">View in Boxes</button>${again ? `<button class="btn ghost" id="revealAgain" ${save.coins < G.BOXES[again].price ? 'disabled' : ''}>Open another (${G.BOXES[again].price})</button>` : ''}<button class="btn primary" data-close autofocus>Continue</button></div></div>`);
    $('#revealBoxes').onclick = () => { closeModal(true); ui.sel = p.uid; go('boxes'); };
    const ag = $('#revealAgain'); if (ag) ag.onclick = () => { closeModal(true); openBox(again); };
  };
  setTimeout(finish, save.settings.reducedEffects ? 150 : spin ? 3600 : 1100);
}

// ---------- Bag ----------
const BAG_CATS = { medicine: ['Medicine', 'heart'], training: ['Training', 'bolt'], held: ['Held items', 'gem'], evolution: ['Evolution', 'shiny'], key: ['Key items', 'lock'], collectible: ['Other', 'bag'] };
function bagIds(cat) { return cat === 'key' ? Object.keys(save.keyItems).filter(k => save.keyItems[k] && G.ITEMS[k]) : Object.keys(save.inventory).filter(id => G.ITEMS[id]?.cat === cat && save.inventory[id] > 0); }
function renderBag() {
  $('#bagCats').innerHTML = Object.entries(BAG_CATS).map(([k, [n, icon]]) => `<button role="tab" class="bag-cat ${ui.bagCat === k ? 'on' : ''}" data-bagcat="${k}" aria-selected="${ui.bagCat === k}">${ic(icon)}${n}<span class="n">${bagIds(k).length || ''}</span></button>`).join('');
  const ids = bagIds(ui.bagCat);
  if (!ids.includes(ui.bagSel)) ui.bagSel = ids[0];
  $('#bagMain').innerHTML = `<div class="section-title"><h2>${BAG_CATS[ui.bagCat][0]}</h2></div>` + (ids.length ? `<ul class="item-grid">${ids.map(id => `<li><button class="item-card ${ui.bagSel === id ? 'on' : ''}" data-bagsel="${id}">${ui.bagCat === 'key' ? '' : `<span class="own">×${save.inventory[id]}</span>`}<span class="tile">${pic(G.itemSprite(id), [SPR + '/items/poke-ball.png'], 'alt="" loading="lazy"')}</span><b>${esc(G.ITEMS[id].name)}</b></button></li>`).join('')}</ul>`
    : `<div class="bag-empty">${ic('bag')}<b>Nothing in this pocket yet.</b><button class="btn primary" data-go="shop">Visit the Shop</button></div>`);
  const id = ui.bagSel, it = G.ITEMS[id];
  $('#bagDetail').innerHTML = it ? `<div class="art">${pic(G.itemSprite(id), [SPR + '/items/poke-ball.png'], 'alt=""')}</div><h3>${esc(it.name)}</h3><p>${esc(it.desc)}</p>
    <div class="price-row">${isUsableOutside(it) ? '<button class="btn primary big" data-baguse>Use</button>' : ''}${it.hold ? '<button class="btn ghost" data-baggive>Give to a Pokémon</button>' : ''}${it.battle ? '<span class="tag">Use it during battle</span>' : ''}${it.key ? '<span class="tag cyan">Always active</span>' : ''}</div>` : '<div class="bag-empty">Select an item.</div>';
  updateHud();
}
// ---------- Pokédex ----------
function dexList() {
  const q = ($('#dexQuery').value || '').trim().toLowerCase(), f = $('#dexFilter').value, g = +$('#dexGen').value;
  return Object.entries(D()).sort((a, b) => a[1].num - b[1].num).filter(([, d]) => {
    if (g && d.gen !== g) return false;
    if (f === 'owned' && !save.ownedDex.includes(d.num)) return false;
    if (f === 'missing' && save.ownedDex.includes(d.num)) return false;
    if (f === 'shiny' && !save.shinyDex.includes(d.num)) return false;
    if (!q) return true;
    return d.name.toLowerCase().includes(q) || String(d.num) === q.replace(/^0+/, '') || d.types.some(t => t.toLowerCase() === q);
  });
}
function renderDex() {
  if ($('#dexGen').options.length === 1) $('#dexGen').insertAdjacentHTML('beforeend', [1, 2, 3, 4, 5, 6, 7, 8, 9].map(g => `<option value="${g}">Gen ${g} · ${G.REGIONS['g' + g]}</option>`).join(''));
  $('#dexTotals').textContent = save.ownedDex.length + ' owned · ' + save.shinyDex.length + ' shiny';
  const list = dexList();
  $('#dexResults').innerHTML = list.slice(0, ui.dexShown).map(([id, d]) => {
    const own = save.ownedDex.includes(d.num), sh = save.shinyDex.includes(d.num);
    return `<button class="dex-card ${own ? '' : 'unowned'}" data-dex="${id}">${sh ? '<svg class="badge shiny-ic" aria-label="shiny owned"><use href="assets/icons.svg#i-shiny"/></svg>' : own ? '<span class="badge own" aria-label="owned"></span>' : ''}${iconOf(d.num, false, d.name)}<small>No. ${String(d.num).padStart(4, '0')}</small><b>${esc(d.name)}</b></button>`;
  }).join('') || '<div class="empty">No Pokémon match. Try a name, number or type.</div>';
  $('#loadMore').classList.toggle('hidden', list.length <= ui.dexShown);
}
function baseStatBars(d) { return E.STATS.map((k, i) => `<div><span>${STAT_LABEL[k]}</span><b>${d.bs[i]}</b><i style="width:${Math.min(100, d.bs[i] / 200 * 100)}%"></i></div>`).join(''); }
async function showDexEntry(id) {
  const d = D()[id]; if (!d) return;
  const own = save.ownedDex.includes(d.num), sh = save.shinyDex.includes(d.num);
  const chain = []; let root = id; while (D()[root].prevo && D()[D()[root].prevo]) root = D()[root].prevo;
  const walk = (x, depth) => { chain.push(x); for (const e of D()[x].evos || []) walk(e, depth + 1); }; walk(root, 0);
  const ls = G.levelUpMoves(id).filter(m => M()[m.id]);
  showModal(`<div class="eyebrow">No. ${String(d.num).padStart(4, '0')} · Gen ${d.gen}</div><h2 id="modalTitle">${esc(d.name)} ${sh ? shinyIc() : ''}</h2>
    <div style="display:grid;grid-template-columns:minmax(0,200px) 1fr;gap:16px;align-items:start"><div>${artOf(d.num, sh)}</div><div style="display:grid;gap:10px">${typeChips(d.types)}
    <p id="dexFlavor" class="muted">Loading Pokédex entry…</p>
    <dl class="kv"><dt>Abilities</dt><dd>${Object.entries(d.ab).map(([k, a]) => `<span title="${esc(E.data.abilities[E.toId(a)]?.desc || '')}">${esc(a)}${k === 'H' ? ' (H)' : ''}</span>`).join(', ')}</dd><dt>Height / weight</dt><dd>${d.ht} m · ${d.wt} kg</dd><dt>EV yield</dt><dd>${E.STATS.filter((k, i) => d.ey[i]).map(k => d.ey[E.STATS.indexOf(k)] + ' ' + STAT_LABEL[k]).join(', ')}</dd><dt>Growth</dt><dd>${G.GROWTH_NAMES[d.gr]}</dd><dt>Status</dt><dd>${own ? 'Owned' : 'Not owned yet'}</dd></dl></div></div>
    <h3 style="margin:14px 0 6px">Base stats</h3><div class="base-stats">${baseStatBars(d)}</div>
    ${chain.length > 1 ? `<h3 style="margin:14px 0 6px">Evolution</h3><div class="evo-chain">${chain.map(x => `<button data-dexjump="${x}">${iconOf(D()[x].num, false)}<span>${esc(D()[x].name)}</span>${D()[x].evoLevel ? `<small class="muted">Lv. ${D()[x].evoLevel}</small>` : D()[x].evoItem ? `<small class="muted">${esc(D()[x].evoItem)}</small>` : ''}</button>`).join('')}</div>` : ''}
    <details style="margin-top:12px"><summary class="btn ghost small">Level-up moves (${ls.length})</summary><div class="move-list" style="margin-top:8px">${ls.map(m => `<div class="move-row"><small>Lv. ${m.level}</small>${moveRow(m.id).replace(/^<div class="move-row">|<\/div>$/g, '')}</div>`).join('')}</div></details>`, { wide: true });
  $$('#modalContent [data-dexjump]').forEach(b => b.onclick = () => showDexEntry(b.dataset.dexjump));
  try {
    const res = await fetch(API + '/pokemon-species/' + d.num);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const genus = data.genera?.find(g => g.language.name === 'en')?.genus || '';
    const flav = [...(data.flavor_text_entries || [])].reverse().find(f => f.language.name === 'en')?.flavor_text?.replace(/[\f\n­]/g, ' ') || '';
    const el = $('#dexFlavor'); if (el) el.textContent = (genus ? genus + '. ' : '') + flav;
  } catch (e) { const el = $('#dexFlavor'); if (el) el.textContent = 'Pokédex text could not be loaded (PokéAPI unreachable). Stats above are stored offline.'; }
}

// ---------- Trainer card / medals / options ----------
function renderProfile() {
  const score = G.trainerScore(save);
  const show = save.showcase.map(byUid).filter(Boolean);
  const integ = save.integrity || { status: 'ok' };
  $('#trainerCard').innerHTML = `<div class="tc-head"><button class="tc-avatar-btn" id="pickAvatar" aria-label="Change profile picture" title="Change profile picture">${pic(img.art(save.avatar || 25, false), [img.icon(save.avatar || 25, false)], 'class="tc-avatar" alt=""')}<span>Change</span></button><div><div class="eyebrow">${rankName(score)}</div><h2>${esc(trainerName())}</h2>
    <div class="tc-verify ${ranked() ? 'ok' : 'bad'}">${ic(ranked() ? 'shield' : 'warn')}${ranked() ? 'Verified save · ranked' : 'Unranked save'}</div>
    <div class="row-btns" style="margin-top:8px"><button class="btn small ghost" id="renameTrainer">Edit name</button><button class="btn small ghost" id="pickAvatar2">Change picture</button></div></div></div>
    ${ranked() ? '' : `<div class="integrity" style="margin-top:14px">${ic('warn')}<div><b>This save failed integrity checks, so it won't appear on leaderboards.</b> You can keep playing normally.<ul>${(integ.reasons || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul></div></div>`}
    <div class="tc-stats"><div><small>Trainer score</small><b>${fmt(score)}</b></div><div><small>Wins</small><b>${fmt(save.wins)}</b></div><div><small>Battles</small><b>${fmt(save.battles)}</b></div><div><small>Pokédex</small><b>${save.ownedDex.length}</b></div><div><small>Shiny species</small><b>${save.shinyDex.length}</b></div><div><small>Best streak</small><b>${save.checkin.best || 0} days</b></div><div><small>Daily sweeps</small><b>${save.stats.dailySweeps}</b></div><div><small>Medals</small><b>${Object.keys(save.medals).length}/${G.MEDALS.length}</b></div></div>
    <div class="section-title"><h2>Showcase</h2><span class="muted">Shown on leaderboards</span></div>
    <div class="showcase-slots">${[0, 1, 2].map(i => { const p = show[i]; return p ? `<button class="showcase-slot filled" data-showslot="${i}">${artOf(sp(p).num, p.shiny)}<b>${esc(G.displayName(p))}${p.shiny ? shinyIc() : ''}</b><small>Lv. ${p.level} · ${E.STATS.filter(k => p.ivs[k] === 31).length}× Best IV</small></button>` : `<button class="showcase-slot" data-showslot="${i}"><span class="muted">${ic('plus')} Add a Pokémon</span></button>`; }).join('')}</div>
    <div class="row-btns"><button class="btn ghost" id="shareCard">${ic('copy')}Copy trainer card text</button></div>`;
  $('#animationsToggle').checked = !!save.settings.animations;
  $('#effectsToggle').checked = !!save.settings.reducedEffects;
  $('#damageToggle').checked = save.settings.showDamage !== false;
  $('#speedSelect').value = String(save.settings.battleSpeed || 1);
  renderAuthState();
}
function renderMedals() {
  $('#medalCount').textContent = Object.keys(save.medals).length + ' / ' + G.MEDALS.length;
  $('#medalGrid').innerHTML = G.MEDALS.map(m => `<div class="medal ${save.medals[m.id] ? '' : 'locked'}"><span class="m">${ic(save.medals[m.id] ? 'medal' : 'lock')}</span><span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><small>${save.medals[m.id] ? 'Earned ' + save.medals[m.id] : 'Reward: ' + m.reward + ' coins'}</small></span></div>`).join('');
}
// ---------- Journey ----------
// Kanto to Paldea: a route trainer before every gym, then the Elite Four and the
// Champion. Each region unlocks after the previous Champion falls.
function stepLabel(step) {
  if (step.kind === 'route') return 'Route ' + (step.gym + 1);
  if (step.kind === 'gym') return step.leader.name;
  return (step.kind === 'champion' ? 'Champion ' : 'Elite Four ') + step.leader.name;
}
const journeyCleared = key => !!save.journey?.cleared?.[key];
function regionUnlocked(ri) { return ri === 0 || journeyCleared(J.REGIONS[ri - 1].id + ':' + (J.regionSteps(ri - 1).length - 1)); }
function regionDone(ri) { return J.regionSteps(ri).filter(s => journeyCleared(s.key)).length; }
function currentRegion() { let ri = 0; while (ri < J.REGIONS.length - 1 && regionUnlocked(ri + 1)) ri++; return ri; }
const typeCls = t => 't-' + (t === 'Mixed' ? 'unknown' : t.toLowerCase());
function renderJourney() {
  save.journey = save.journey || { cleared: {} };
  if (ui.jRegion === undefined || !regionUnlocked(ui.jRegion)) ui.jRegion = currentRegion();
  const badgesAll = J.REGIONS.reduce((a, R, ri) => a + J.regionSteps(ri).filter(s => s.kind === 'gym' && journeyCleared(s.key)).length, 0);
  const champs = J.REGIONS.filter((R, ri) => journeyCleared(R.id + ':' + (J.regionSteps(ri).length - 1))).length;
  $('#journeyCount').textContent = badgesAll + ' badges · ' + champs + ' / ' + J.REGIONS.length + ' regions';
  $('#journeyRegions').innerHTML = J.REGIONS.map((R, ri) => {
    const open = regionUnlocked(ri), done = regionDone(ri), total = J.regionSteps(ri).length;
    return `<button class="j-region ${ri === ui.jRegion ? 'active' : ''} ${done === total ? 'clear' : ''}" data-jregion="${ri}" ${open ? '' : 'disabled'} aria-pressed="${ri === ui.jRegion}">
      <small>${ri + 1}</small><b>${R.name}</b>${open ? `<i>${done === total ? ic('crown') : done + '/' + total}</i>` : ic('lock')}</button>`;
  }).join('');
  const ri = ui.jRegion, R = J.REGIONS[ri], steps = J.regionSteps(ri);
  const next = steps.find(s => !journeyCleared(s.key));
  const badges = steps.filter(s => s.kind === 'gym');
  const head = `<header class="j-head"><div><span class="eyebrow">${R.kahunas ? 'Island challenge' : 'Gym challenge'} · ${esc(R.game)} teams</span><h1>${R.name}</h1>
      <p>${next ? `Next: <b>${esc(next.kind === 'route' ? 'a trainer on the road to ' + R.gyms[next.gym].name : stepLabel(next))}</b>` : `You are the ${R.name} Champion. Rematches give Exp. Points.`}</p></div>
    <div class="j-badges" aria-label="${R.kahunas ? 'Grand trials' : 'Badges'}">${badges.map(s => `<span class="j-badge ${typeCls(s.leader.type)} ${journeyCleared(s.key) ? 'got' : ''}" title="${esc(s.leader.name)} · ${esc(s.leader.type)}${journeyCleared(s.key) ? ' · earned' : ''}">${ic('badge')}</span>`).join('')}</div></header>`;
  let gate = false;
  const rows = steps.map((s, i) => {
    const cleared = journeyCleared(s.key), avail = !gate && (i === 0 || journeyCleared(steps[i - 1].key));
    if (!cleared && !avail) gate = true;
    const lead = s.kind !== 'route';
    const team = lead ? s.leader.team : null, route = lead ? null : J.buildStepTrainer(s);
    const lvl = lead ? Math.max(...team.map(t => t[1])) : route.level;
    const kindTag = { route: 'Trainer', gym: R.kahunas ? 'Kahuna' : 'Gym Leader', elite: s.leader?.title === 'Elite Four' ? 'Elite Four' : s.leader?.title, champion: 'Champion' }[s.kind];
    const act = cleared ? `<span class="j-done">${ic('check')}Cleared</span><button class="btn ghost small" data-jstep="${i}">Rematch</button>`
      : avail ? `<span class="j-reward">${ic('coin')}+${J.STEP_COINS[s.kind]}</span><button class="btn primary" data-jstep="${i}">${ic('battle')}Battle</button>`
      : `<span class="j-locked">${ic('lock')}Locked</span>`;
    return `<article class="jrow ${s.kind} ${cleared ? 'cleared' : ''} ${avail && !cleared ? 'next' : ''} ${!avail && !cleared ? 'locked' : ''}">
      <span class="jnum">${lead ? ic(s.kind === 'champion' ? 'crown' : 'badge') : s.gym + 1}</span>
      <div class="jinfo"><span class="jkind">${esc(kindTag)}${lead ? ` <span class="type ${typeCls(s.leader.type)}">${esc(s.leader.type)}</span>` : ''}</span>
        <h3>${esc(lead ? s.leader.name : 'Route ' + (s.gym + 1))}</h3>
        <span class="jmeta">${lead ? esc(s.leader.title === 'Elite Four' || s.leader.title === 'Champion' ? R.name + ' League' : s.leader.title) + ' · ' : ''}${lead ? team.length : route.team.length} Pokémon · up to Lv. ${lvl}</span></div>
      <div class="jteam">${lead && (cleared || avail) ? team.map(([id]) => iconOf(G.gameData.dex[id].num, false, G.gameData.dex[id].name)).join('') : ''}</div>
      <div class="jact">${act}</div></article>`;
  }).join('');
  $('#journeyBody').innerHTML = head + `<div class="j-path">${rows}</div>`;
  $$('#journeyRegions [data-jregion]').forEach(b => b.onclick = () => { ui.jRegion = +b.dataset.jregion; renderJourney(); });
  $$('#journeyBody [data-jstep]').forEach(b => b.onclick = () => {
    const s = steps[+b.dataset.jstep];
    const top = topLevel(), lvl = s.kind === 'route' ? J.buildStepTrainer(s).level : Math.max(...s.leader.team.map(t => t[1]));
    if (top < lvl - 8) confirmBox('Tough battle ahead', `${esc(stepLabel(s))}'s team goes up to Lv. ${lvl}, and your strongest Pokémon is Lv. ${top}. You can still try. Losing costs nothing.`, 'Battle anyway', () => startBattle('journey', s));
    else startBattle('journey', s);
  });
}

// Any Pokémon can be the profile picture, owned or not.
function showAvatarPicker() {
  const all = [...new Map(Object.values(D()).filter(d => d.num > 0 && d.num <= 1025).sort((a, b) => a.num - b.num).map(d => [d.num, d])).values()];
  showModal(`<h2 id="modalTitle">Profile picture</h2><p class="muted">Pick any Pokémon. It appears on your Trainer Card, the top bar and leaderboards.</p>
    <label class="field"><span>Search</span><input id="avatarSearch" type="search" placeholder="Name or Pokédex number" autocomplete="off"></label>
    <div class="pick-grid avatar-grid" id="avatarGrid" style="margin-top:12px"></div>`, { wide: true });
  const draw = () => {
    const q = $('#avatarSearch').value.trim().toLowerCase().replace(/^#/, '');
    const list = q ? all.filter(d => d.name.toLowerCase().includes(q) || String(d.num) === q.replace(/^0+/, '')) : all;
    $('#avatarGrid').innerHTML = list.slice(0, 180).map(d => `<button data-avatar="${d.num}" class="${d.num === save.avatar ? 'on' : ''}">${iconOf(d.num, false)}<span>${esc(d.name)}</span><small>#${String(d.num).padStart(4, '0')}</small></button>`).join('')
      + (list.length > 180 ? `<p class="muted" style="grid-column:1/-1">Showing 180 of ${list.length}. Search to narrow it down.</p>` : '') || '<div class="empty">No Pokémon match that search.</div>';
  };
  draw();
  $('#avatarSearch').addEventListener('input', draw);
  $('#avatarGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-avatar]'); if (!b) return;
    save.avatar = +b.dataset.avatar; persist(); updateHud(); closeModal(true);
    if (activeScreen === 'profile') renderProfile();
    toast(D()[G.gameData.numToId[save.avatar]].name + ' is your new profile picture.');
  });
}

// ---------- Export / import ----------
// Asks for a password (twice when creating one). Resolves to the password or null.
function askPassword({ title, text, confirm }) {
  return new Promise(resolve => {
    showModal(`<div class="eyebrow">${ic('lock')} Protected save</div><h2 id="modalTitle">${esc(title)}</h2><p>${text}</p>
      <label class="field"><span>Password</span><input type="password" id="pw1" minlength="6" autocomplete="${confirm ? 'new-password' : 'current-password'}" autofocus></label>
      ${confirm ? '<label class="field" style="margin-top:10px"><span>Repeat password</span><input type="password" id="pw2" autocomplete="new-password"></label>' : ''}
      <p class="muted" id="pwErr" style="margin-top:8px"></p>
      <div class="row-btns"><button class="btn ghost" id="pwCancel">Cancel</button><button class="btn primary" id="pwOk">${confirm ? 'Encrypt and export' : 'Unlock'}</button></div>`, { onClose: () => resolve(null) });
    const ok = () => {
      const a = $('#pw1').value, b = confirm ? $('#pw2').value : a;
      if (a.length < 6) { $('#pwErr').textContent = 'Use at least 6 characters.'; return; }
      if (a !== b) { $('#pwErr').textContent = 'The passwords don’t match.'; return; }
      modalOnClose = null; closeModal(true); resolve(a);
    };
    $('#pwOk').onclick = ok;
    $('#pwCancel').onclick = () => closeModal(true);
    $$('#modalContent input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); }));
  });
}
async function makeEnvelope() {
  const pw = await askPassword({ title: 'Choose an export password', text: 'Your save will be encrypted with this password. You will need it to import the save on any device. It can’t be recovered if you forget it.', confirm: true });
  if (!pw) return null;
  toast('Encrypting…');
  return S.encryptSave(JSON.parse(JSON.stringify(save)), pw);
}
async function exportFile() {
  const env = await makeEnvelope(); if (!env) return;
  const blob = new Blob([JSON.stringify(env)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'pokeduel-save-' + G.todayKey() + '.pokeduel';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Protected save exported.');
}
const toCode = obj => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const fromCode = s => JSON.parse(decodeURIComponent(escape(atob(s.trim()))));
async function copyCode() {
  const env = await makeEnvelope(); if (!env) return;
  const code = toCode(env);
  try { await navigator.clipboard.writeText(code); toast('Protected save code copied to clipboard.'); }
  catch (e) { showModal(`<h2 id="modalTitle">Your save code</h2><p>Copy this text and keep it somewhere safe. It is encrypted with your password.</p><textarea readonly>${esc(code)}</textarea><div class="row-btns"><button class="btn primary" data-close>Done</button></div>`); }
}
// Returns { save, unprotected } or throws a readable error.
async function parseImport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { try { obj = fromCode(text); } catch (e2) { throw new Error('This isn’t a PokeDuel save file or code.'); } }
  if (S.isEnvelope(obj)) {
    const pw = await askPassword({ title: 'Enter the save password', text: 'This save is protected. Enter the password that was used when it was exported.' });
    if (!pw) return null;
    const raw = await S.decryptSave(obj, pw);
    if (!S.verifySeal(raw)) throw new Error('This save was modified after it was exported, so it can’t be imported.');
    const s = G.migrateSave(raw);
    if (!s) throw new Error('This save is from an unsupported version.');
    const issues = G.auditSave(s);
    if (issues.length) throw new Error('This save failed integrity checks:\n• ' + issues.join('\n• '));
    return { save: s, unprotected: false };
  }
  // Older, unencrypted exports (made before save protection) still import, but unranked.
  const raw = obj?.app === 'PokeDuel' ? obj.save : obj;
  const s = G.migrateSave(raw);
  if (!s) throw new Error('This save is from an unsupported version.');
  flag(s, 'Imported from an unprotected save file (made before save protection), so it can’t be verified.');
  return { save: s, unprotected: true };
}
async function previewImport(text) {
  let res;
  try { res = await parseImport(text); }
  catch (e) { showModal(`<h2 id="modalTitle">Import refused</h2><p style="white-space:pre-line">${esc(e.message)}</p><div class="row-btns"><button class="btn primary" data-close>OK</button></div>`); return; }
  if (!res) return;
  const s = res.save;
  confirmBox('Import this save?', `<b>${esc(s.trainerName || 'Trainer')}</b> · ${s.box.length} Pokémon · ${s.ownedDex.length} species · ${fmt(s.coins)} coins · last played ${s.lastActive ? new Date(s.lastActive).toLocaleString() : 'unknown'}.<br><br>${res.unprotected ? '<b>This file is unprotected, so the save will be unranked (no leaderboards).</b><br><br>' : ''}This replaces the save in this browser${currentUser ? ' and your cloud save' : ''}. A backup of your current save is kept in this browser.`, 'Import save', () => {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(save)); } catch (e) {}
    save = s; afterProgress(); afterSaveReplaced(); toast('Save imported!');
  }, true);
}
function afterSaveReplaced() {
  checkNewDay();
  document.body.classList.toggle('reduced-effects', !!save.settings.reducedEffects);
  ui.sel = null;
  go(save.starterChosen ? (activeScreen === 'starter' ? 'home' : activeScreen === 'battle' ? 'home' : activeScreen) : 'starter', { noHash: true });
  updateHud();
}

// ---------- Battle ----------
let battleState = null;
function buildPlayerTeam() {
  return partyMons().map(p => ({ uid: p.uid, species: p.species, level: p.level, nickname: p.nickname, moves: p.moves, ability: p.ability, item: p.item, nature: p.mint || p.nature, ivs: G.effectiveIvs(p), evs: p.evs, teraType: p.teraType, gender: p.gender, shiny: p.shiny, friendship: p.friendship }));
}
// Free battles (practice, journey) can be left at any time and don't use a daily attempt.
const isFree = tier => tier === 'practice' || tier === 'journey';
const JOURNEY_LIGHT = { route: 'easy', gym: 'medium', elite: 'hard', champion: 'hard' };
function startBattle(tier, step) {
  if (!save.starterChosen || !partyMons().length) { toast('Choose a starter first.'); return; }
  checkNewDay();
  if (!isFree(tier) && save.daily[tier]) { toast('You already took on this daily battle today.'); return; }
  const begin = () => {
    const key = G.todayKey();
    const trainer = tier === 'journey' ? J.buildStepTrainer(step) : G.buildTrainer(tier, key, topLevel());
    const seed = isFree(tier) ? Date.now() : E.hashString(key + ':' + tier + ':battle');
    const b = E.createBattle({ player: { name: trainerName(), team: buildPlayerTeam() }, enemy: { name: trainer.name, team: trainer.team }, seed, ai: tier === 'journey' ? trainer.ai : G.DAILY_TIERS[tier].ai, label: trainer.name });
    if (!isFree(tier)) { save.daily[tier] = { result: 'pending', date: key }; persist(); }
    battleState = { b, tier, step, trainer, ui: { p: null, e: null }, tera: false, menu: 'main', playing: false, ko: [], startedTurn: 1, itemsUsed: 0 };
    // Arena art follows the scenario: a Gym Leader's type in Journey (the road to a
    // gym uses that gym's ground), or today's weather for daily and practice battles.
    const sceneType = tier === 'journey' ? (step.leader || J.REGIONS[step.region].gyms[step.gym]).type : null;
    const arenaKey = sceneType ? assets.typeArenas?.[sceneType] : assets.weatherArenas?.[G.dailyWeather(key).id];
    setupArena(tier === 'journey' ? JOURNEY_LIGHT[step.kind] : tier, arenaKey);
    $('#battleLabel').textContent = tier === 'practice' ? 'Practice' : tier === 'journey' ? J.REGIONS[step.region].name + ' · ' + stepLabel(step) : 'Daily · ' + G.DAILY_TIERS[tier].name;
    $('#battleLog').textContent = '';
    $('#battleControls').innerHTML = '';
    $('#playerSprite').className = 'battle-sprite mine gone'; $('#enemySprite').className = 'battle-sprite foe gone';
    go('battle');
    const intro = b.events.slice(0);
    intro.unshift({ t: 'msg', text: (tier === 'practice' ? 'Practice Partner' : trainer.name) + ' would like to battle!' });
    playEvents(intro).then(renderCommands);
  };
  if (isFree(tier)) begin();
  else confirmBox('Daily battle · ' + G.DAILY_TIERS[tier].name, `You get <b>one attempt</b> per day. Leaving or reloading during the battle counts as a loss. Your party of ${partyMons().length} will battle ${G.DAILY_TIERS[tier].size} Pokémon.`, 'Battle!', begin);
}
// Places sprites on the painted platforms of the arena art (positions from assets/manifest.json).
function setupArena(tier, arenaKey) {
  const arena = $('#battlefield');
  const cfg = assets.tiers?.[tier] || {};
  const art = assets.arenas?.[arenaKey] || assets.arenas?.[cfg.arena];
  arena.className = 'arena theme-' + tier + ' light-' + (cfg.light || 'day') + (art ? ' has-art' : '');
  arena.style.setProperty('--arena-bg', art ? `url("assets/backgrounds/${art.file}")` : 'none');
  const foe = art?.foe || { x: 76, y: 58, w: 26 }, me = art?.player || { x: 28, y: 92, w: 40 };
  // Square sprite boxes sized from the platform width; feet sit near the platform centre.
  Object.assign($('#foeSlot').style, { left: foe.x + '%', bottom: (100 - foe.y - 3) + '%', width: foe.w * 0.72 + '%' });
  Object.assign($('#playerSlot').style, { left: me.x + '%', bottom: (100 - me.y - 3) + '%', width: me.w * 0.6 + '%' });
}
function monView(side) { return E.active(battleState.b, side); }
function renderStatusCard(side) {
  const s = battleState.ui[side]; if (!s) return;
  const mon = monView(side);
  const pct = Math.max(0, s.hp / s.maxhp * 100);
  const boosts = Object.entries(mon?.boosts || {}).filter(([, v]) => v).map(([k, v]) => `<span class="${v > 0 ? 'up' : 'down'}">${({ atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', accuracy: 'Acc', evasion: 'Eva' })[k]} ${v > 0 ? '+' : ''}${v}</span>`).join('');
  const vol = mon ? ['confusion', 'leechseed', 'substitute', 'taunt', 'encore'].filter(v => mon.volatiles[v]).map(v => `<span>${({ confusion: 'Confused', leechseed: 'Seeded', substitute: 'Substitute', taunt: 'Taunted', encore: 'Encore' })[v]}</span>`).join('') : '';
  $(side === 'p' ? '#playerCard' : '#foeCard').innerHTML = `<div class="sc-top">${s.tera ? `<span class="sc-tera" title="Terastallized: ${esc(s.tera)}">${ic('gem')}</span>` : ''}<b>${esc(s.name)}</b>${genderIcon(s.gender)}${s.status ? `<span class="status-chip st-${s.status}">${s.status.toUpperCase()}</span>` : ''}<span class="lvl">Lv. ${s.level}</span></div>
    <div class="hp"><span class="hp-label">HP</span><span class="hp-bar"><i class="${hpCls(pct)}" style="width:${pct}%"></i></span></div>
    ${side === 'p' ? `<div class="sc-hpnum">${Math.max(0, s.hp)} / ${s.maxhp}</div>` : ''}<div class="sc-boosts">${boosts}${vol}${s.tera ? typeImg(s.tera) : ''}</div>`;
}
function renderFoeTeam() {
  const team = battleState.b.sides.e.team;
  $('#foeTeam').innerHTML = team.map(m => `<i class="${m.fainted ? 'out' : ''}" title="${m.fainted ? 'Fainted' : 'Able to battle'}"></i>`).join('');
}
function renderFieldChips() {
  const b = battleState.b, f = b.field, out = [];
  const w = { RainDance: 'Rain', sunnyday: 'Harsh sun', Sandstorm: 'Sandstorm', snowscape: 'Snow', hail: 'Hail' }[f.weather];
  if (w) out.push(w);
  if (f.terrain) out.push({ electricterrain: 'Electric Terrain', grassyterrain: 'Grassy Terrain', psychicterrain: 'Psychic Terrain', mistyterrain: 'Misty Terrain' }[f.terrain]);
  if (f.trickRoom) out.push('Trick Room');
  for (const [sid, label] of [['p', 'Your side'], ['e', 'Foe side']]) {
    const c = b.sides[sid].cond;
    const names = Object.keys(c).map(k => ({ stealthrock: 'Stealth Rock', spikes: 'Spikes ×' + (c[k].layers || 1), toxicspikes: 'Toxic Spikes', stickyweb: 'Sticky Web', reflect: 'Reflect', lightscreen: 'Light Screen', auroraveil: 'Aurora Veil', tailwind: 'Tailwind', safeguard: 'Safeguard', mist: 'Mist' })[k]).filter(Boolean);
    if (names.length) out.push(label + ': ' + names.join(', '));
  }
  $('#fieldChips').innerHTML = out.map(x => `<span>${esc(x)}</span>`).join('');
}
// Like the original games: your Pokémon is shown from behind, the opponent from the front.
// Animated Showdown sprites (both sides, same art style) with static fallbacks for
// species they don't cover; pixel art is scaled by whole numbers so it stays crisp.
function setSprite(side, ev) {
  const el = side === 'p' ? $('#playerSprite') : $('#enemySprite');
  const front = side === 'e';
  const stat = (s) => `${SPR}/pokemon/${front ? '' : 'back/'}${s ? 'shiny/' : ''}${ev.num}.png`;
  const primary = front ? img.front(ev.num, ev.shiny) : img.back(ev.num, ev.shiny);
  el.dataset.fb = [front ? img.front(ev.num, false) : img.back(ev.num, false), stat(ev.shiny), stat(false), img.art(ev.num, ev.shiny)].join('|');
  el.style.visibility = '';
  el.alt = ev.name;
  el.dataset.num = ev.num;
  el.className = 'battle-sprite pixel ' + (front ? 'foe' : 'mine') + ' gone';
  el.style.width = el.style.height = '';
  el.crossOrigin = 'anonymous';
  el.onload = () => fitSprite(el, side);
  el.src = primary;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('gone')));
}
// Measures the visible (non-transparent) part of a sprite's first frame, because
// sprite canvases carry very different amounts of empty padding.
const spriteBoxes = new Map();
function spriteBox(el) {
  if (spriteBoxes.has(el.src)) return spriteBoxes.get(el.src);
  let box = null;
  try {
    const w = el.naturalWidth, h = el.naturalHeight, c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(el, 0, 0);
    const a = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= 0) box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  } catch { /* cross-origin image without CORS: fall back to the full canvas */ }
  box = box || { x: 0, y: 0, w: el.naturalWidth, h: el.naturalHeight };
  spriteBoxes.set(el.src, box);
  return box;
}
// Sizes every sprite to its platform: bigger species stand taller, but nothing
// spills off the platform or shrinks to a speck. Pixel art keeps half-step scales.
function fitSprite(el, side) {
  const hd = el.src.includes('/home/');
  el.classList.toggle('pixel', !hd);
  el.classList.toggle('flip', hd && side === 'p');
  el.style.marginBottom = el.style.left = '';
  if (hd || !el.naturalHeight) { el.style.width = el.style.height = ''; return; }
  const slot = el.parentElement.getBoundingClientRect();
  const P = slot.width / (side === 'p' ? 0.6 : 0.72); // painted platform width
  const b = spriteBox(el);
  const ht = D()[G.gameData.numToId[+el.dataset.num]]?.ht ?? 1;
  const t = Math.max(0, Math.min(1, (Math.log2(Math.max(0.1, ht)) + 1.5) / 4));
  let scale = P * (side === 'p' ? 0.3 + 0.36 * t : 0.36 + 0.34 * t) / Math.max(b.h, b.w * 0.8);
  scale = Math.min(scale, P * 0.78 / b.w, P * (side === 'p' ? 0.78 : 0.92) / b.h);
  scale = Math.max(0.5, Math.floor(scale * 2) / 2);
  el.style.width = el.naturalWidth * scale + 'px';
  el.style.height = el.naturalHeight * scale + 'px';
  // Stand the visible feet on the platform centre and centre the body horizontally.
  el.style.marginBottom = -Math.round((el.naturalHeight - b.y - b.h) * scale) + 'px';
  el.style.left = -Math.round((b.x + b.w / 2 - el.naturalWidth / 2) * scale) + 'px';
}
window.addEventListener('resize', () => { for (const [id, side] of [['#playerSprite', 'p'], ['#enemySprite', 'e']]) { const el = $(id); if (el?.complete && el.src) fitSprite(el, side); } });
function anim(sel, cls) {
  if (!save.settings.animations || save.settings.reducedEffects) return;
  const el = $(sel); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 600);
}
// ---------- Move animations ----------
// Physical moves wind up and dash at the target; special moves fire a
// type-coloured orb; status moves raise an aura. Hits land with a burst in the
// move's type colour and knock the target back. No screen flashes.
const fxOn = () => save.settings.animations && !save.settings.reducedEffects && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const spriteEl = side => side === 'p' ? $('#playerSprite') : $('#enemySprite');
const typeColor = t => `var(--t-${String(t || 'normal').toLowerCase()})`;
function spriteCentre(side) {
  const a = $('#battlefield').getBoundingClientRect(), r = spriteEl(side).getBoundingClientRect();
  return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height * 0.55, h: r.height };
}
function fxNode(cls, x, y, color, extra = '') {
  const el = document.createElement('div');
  el.className = 'fx ' + cls;
  el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.setProperty('--c', color);
  el.innerHTML = extra;
  $('#battleFlash').appendChild(el);
  return el;
}
async function moveFx(ev) {
  if (!fxOn()) { await sleep(180); return; }
  const user = ev.side, foe = user === 'p' ? 'e' : 'p', el = spriteEl(user);
  const from = spriteCentre(user), to = spriteCentre(foe), dx = to.x - from.x, dy = to.y - from.y;
  const color = typeColor(ev.type);
  if (ev.cat === 'Physical') {
    el.animate([
      { transform: 'none' },
      { transform: `translate(${-dx * 0.07}px,${-dy * 0.07}px) scale(1.06,.92)`, offset: 0.3 },
      { transform: `translate(${dx * 0.42}px,${dy * 0.42}px) scale(.95,1.06)`, offset: 0.62 },
      { transform: `translate(${dx * 0.36}px,${dy * 0.36}px)`, offset: 0.72 },
      { transform: 'none' },
    ], { duration: 620, easing: 'cubic-bezier(.3,0,.3,1)' });
    await sleep(380);
  } else if (ev.cat === 'Special') {
    el.animate([{ transform: 'none' }, { transform: 'translateY(-6%) scale(1.05)', offset: 0.4 }, { transform: 'none' }], { duration: 560, easing: 'ease-out' });
    auraFx(user, ev.type);
    await sleep(160);
    const orb = fxNode('fx-orb', from.x, from.y, color);
    const lift = -Math.max(40, Math.abs(dx) * 0.18);
    const fly = orb.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px),calc(-50% + ${dy * 0.5 + lift}px)) scale(1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.25)`, opacity: 1 },
    ], { duration: 420, easing: 'cubic-bezier(.4,0,.6,1)' });
    // A short trail of fading copies follows the orb.
    for (let i = 1; i <= 3; i++) setTimeout(() => {
      if (!orb.isConnected) return;
      const t = fxNode('fx-orb trail', from.x, from.y, color);
      t.animate(fly.effect.getKeyframes(), { duration: 420, easing: 'cubic-bezier(.4,0,.6,1)' }).onfinish = () => t.remove();
    }, i * 45);
    fly.onfinish = () => orb.remove();
    await sleep(400);
  } else {
    auraFx(user, ev.type);
    el.animate([{ transform: 'none' }, { transform: 'translateY(-4%)', offset: 0.35 }, { transform: 'none' }], { duration: 600, easing: 'ease-in-out' });
    await sleep(520);
  }
}
function impactFx(side, type, big) {
  if (!fxOn()) return;
  const c = spriteCentre(side), color = typeColor(type);
  const shards = Array.from({ length: 10 }, (_, i) => `<i style="--a:${i * 36 + (i % 2) * 14}deg;--d:${big ? 1.35 : 1}"></i>`).join('');
  const burst = fxNode('fx-burst' + (big ? ' big' : ''), c.x, c.y, color, '<b></b><b></b><s></s>' + shards);
  burst.style.setProperty('--s', Math.max(130, Math.min(240, c.h * 1.4)) * (big ? 1.25 : 1) + 'px');
  setTimeout(() => burst.remove(), 700);
  const away = side === 'e' ? 1 : -1;
  spriteEl(side).animate([
    { transform: 'none' },
    { transform: `translate(${away * 7}%,${-away * 2}%) rotate(${away * 6}deg)`, offset: 0.18 },
    { transform: `translate(${-away * 3}%,0) rotate(${-away * 3}deg)`, offset: 0.45 },
    { transform: `translate(${away * 2}%,0)`, offset: 0.7 },
    { transform: 'none' },
  ], { duration: 460, easing: 'ease-out' });
}
function auraFx(side, type, crystal) {
  if (!fxOn()) return;
  const c = spriteCentre(side);
  const a = fxNode('fx-aura' + (crystal ? ' crystal' : ''), c.x, c.y + c.h * 0.4, typeColor(type), '<b></b><b></b><b></b>');
  a.style.setProperty('--s', Math.max(120, Math.min(240, c.h * 1.3)) + 'px');
  setTimeout(() => a.remove(), 1000);
}
async function say(text) { $('#battleLog').textContent = text; await sleep(420 + Math.min(900, text.length * 16)); }
async function playEvents(events) {
  const st = battleState;
  st.playing = true;
  $('#battleControls').innerHTML = '';
  for (const ev of events) {
    if (battleState !== st) return;
    const side = ev.side;
    switch (ev.t) {
      case 'msg': await say(ev.text); break;
      case 'switch':
        st.ui[side] = { name: ev.name, level: ev.level, hp: ev.hp, maxhp: ev.maxhp, status: ev.status, gender: ev.gender, tera: ev.tera, num: ev.num, shiny: ev.shiny };
        setSprite(side, ev); renderStatusCard(side); if (side === 'e') renderFoeTeam(); await sleep(250); break;
      case 'move': st.lastMove = ev; await moveFx(ev); break;
      case 'damage':
        if (st.ui[side]) { st.ui[side].hp = ev.hp; }
        if (!ev.indirect) { impactFx(side, st.lastMove?.type, ev.crit || ev.eff > 1); if (ev.crit || ev.eff > 1) anim('#battlefield', 'shake'); }
        renderStatusCard(side); await sleep(520); break;
      case 'heal': if (st.ui[side]) st.ui[side].hp = ev.hp; renderStatusCard(side); await sleep(380); break;
      case 'revive': break;
      case 'status': if (st.ui[side] && (ev.idx === undefined || monView(side)?.idx === ev.idx)) { st.ui[side].status = ev.status; renderStatusCard(side); } break;
      case 'boost': renderStatusCard(side); break;
      case 'faint': (side === 'p' ? $('#playerSprite') : $('#enemySprite')).classList.add('gone'); if (side === 'e') renderFoeTeam(); await sleep(520); break;
      case 'tera': if (st.ui[side]) st.ui[side].tera = ev.type; (side === 'p' ? $('#playerSprite') : $('#enemySprite')).classList.add('tera'); auraFx(side, ev.type, true); renderStatusCard(side); await sleep(600); break;
      case 'charge': (side === 'p' ? $('#playerSprite') : $('#enemySprite')).classList.toggle('semi', !!ev.semi); break;
      case 'weather': case 'terrain': case 'side': case 'field': renderFieldChips(); break;
      case 'sub': renderStatusCard(side); break;
      case 'ko': st.ko.push(ev); break;
      case 'turn': $('#battleTurn').textContent = 'Turn ' + ev.turn; break;
    }
  }
  renderFieldChips();
  for (const s of ['p', 'e']) renderStatusCard(s);
  st.playing = false;
}
const CAT_ICON = { Physical: 'physical', Special: 'special', Status: 'status' };
function renderCommands() {
  const st = battleState; if (!st) return;
  const b = st.b, req = E.getRequest(b);
  const el = $('#battleControls');
  if (b.ended) { finishBattle(); return; }
  if (req.type === 'switch') { renderPartyPicker(true); return; }
  const me = monView('p');
  if (st.menu === 'fight') {
    if (req.locked) { submit({ type: 'move', index: 0 }); return; }
    const foe = monView('e');
    el.innerHTML = `<div class="moves-grid">${req.struggle ? `<button class="move-btn t-normal" data-mi="-1"><span class="mtop">${typeImg('Normal')}</span><b>Struggle</b><span class="mbot">Out of PP</span></button>` : req.moves.map(m => {
      const mv = M()[m.id];
      let effTxt = '';
      if (mv.cat !== 'Status' && foe) {
        const e = E.effectiveness(m.type, foe.types);
        effTxt = e === 0 ? '<span class="eff no">No effect</span>' : e > 1 ? '<span class="eff se">Effective</span>' : e < 1 ? '<span class="eff nve">Not very effective</span>' : '';
      }
      let dmg = '';
      if (save.settings.showDamage !== false && mv.cat !== 'Status' && foe) { const r = E.damageRange(b, me, foe, m.id); if (r && r.hi) dmg = Math.round(r.lo / foe.maxhp * 100) + '–' + Math.min(999, Math.round(r.hi / foe.maxhp * 100)) + '%'; }
      const info = mv.cat === 'Status' ? 'Status' : (mv.bp ? mv.bp + ' power' : 'Varies') + (mv.acc === true ? '' : ' · ' + mv.acc + '%');
      return `<button class="move-btn ${tclass(m.type)}" data-mi="${m.index}" ${m.disabled ? 'disabled' : ''} title="${esc(mv.desc || '')}">${effTxt}<span class="mtop">${typeImg(m.type)}<span class="cat" title="${mv.cat}">${ic(CAT_ICON[mv.cat] || 'status')}</span></span><b>${esc(m.name)}</b><span class="mbot"><span>${info}${dmg ? ' · ' + dmg : ''}${E.moveSupport(m.id) === 'partial' ? ' · simplified' : ''}</span><span class="pp">${m.pp}/${m.maxpp}</span></span></button>`;
    }).join('')}</div><div class="cmd-foot">${req.canTera ? `<button class="tera-toggle ${st.tera ? 'on' : ''}" id="teraBtn" aria-pressed="${st.tera}">${ic('gem')}Terastallize · ${esc(req.teraType)}</button>` : '<span></span>'}<button class="cmd back" data-cmd="back">${ic('back')}Back</button></div>`;
    $('#battleLog').textContent = 'Choose a move for ' + me.name + '. Keys 1–4 also work.';
    return;
  }
  const bagLocked = !isFree(st.tier) && st.tier !== 'easy' && st.itemsUsed >= 3;
  el.innerHTML = `<div class="cmd-grid"><button class="cmd fight" data-cmd="fight">${ic('battle')}Fight</button><button class="cmd party" data-cmd="party" ${req.trapped || !req.switches.length ? 'disabled' : ''}>${ic('swap')}Pokémon</button><button class="cmd bag" data-cmd="bag" ${bagLocked ? 'disabled title="Item limit reached"' : ''}>${ic('bag')}Bag</button><button class="cmd run" data-cmd="run">${ic('run')}${isFree(st.tier) ? 'Run' : 'Forfeit'}</button></div>`;
  $('#battleLog').textContent = 'What will ' + me.name + ' do?';
}
function renderPartyPicker(forced) {
  const st = battleState, b = st.b, req = E.getRequest(b);
  const team = b.sides.p.team;
  $('#battleLog').textContent = forced ? (req.reason === 'pivot' ? 'Choose a Pokémon to switch in.' : 'Choose your next Pokémon.') : 'Switch to which Pokémon?';
  showModal(`<h2 id="modalTitle">${forced ? 'Send out a Pokémon' : 'Switch Pokémon'}</h2><div class="party-pick">${team.map((m, i) => {
    const ok = req.switches?.includes(i) || (!forced && req.switches?.includes(i));
    return `<button data-swap="${i}" ${ok ? '' : 'disabled'}>${iconOf(m.num, m.shiny)}<span><b>${esc(m.name)}</b> ${genderIcon(m.gender)} ${m.status ? `<span class="status-chip st-${m.status}">${m.status.toUpperCase()}</span>` : ''}<br><small class="muted">Lv. ${m.level} · ${m.fainted ? 'Fainted' : m.hp + '/' + m.maxhp + ' HP'}${i === b.sides.p.active && !m.fainted ? ' · in battle' : ''}</small><span class="hp"><span class="hp-bar"><i class="${hpCls(m.hp / m.maxhp * 100)}" style="width:${m.hp / m.maxhp * 100}%"></i></span></span></span></button>`;
  }).join('')}</div>${forced ? '' : '<div class="row-btns"><button class="btn ghost" data-close>Cancel</button></div>'}`, { locked: forced, wide: true });
  $$('#modalContent [data-swap]').forEach(btn => btn.onclick = () => { closeModal(true); submit({ type: 'switch', index: +btn.dataset.swap }); });
}
function renderBattleBag() {
  const st = battleState, team = st.b.sides.p.team;
  const items = Object.keys(save.inventory).filter(id => G.ITEMS[id]?.battle && save.inventory[id] > 0);
  showModal(`<h2 id="modalTitle">Bag</h2>${st.tier === 'medium' || st.tier === 'hard' ? `<p class="muted">Daily ${st.tier} battles allow up to 3 items (${3 - st.itemsUsed} left).</p>` : ''}<div class="pick-grid">${items.map(id => `<button data-bitem="${id}">${pic(G.itemSprite(id), [], 'alt=""')}<span>${esc(G.ITEMS[id].name)}</span><small class="muted">×${save.inventory[id]}</small></button>`).join('') || '<div class="empty">No battle items. Buy Potions in the Shop.</div>'}</div>`, { wide: true });
  $$('#modalContent [data-bitem]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.bitem, it = G.ITEMS[id];
    showModal(`<h2 id="modalTitle">Use ${esc(it.name)} on…</h2><div class="party-pick">${team.map((m, i) => { const ok = it.targetFainted ? m.fainted : !m.fainted; return `<button data-bt="${i}" ${ok ? '' : 'disabled'}>${iconOf(m.num, m.shiny)}<span><b>${esc(m.name)}</b><br><small class="muted">${m.fainted ? 'Fainted' : m.hp + '/' + m.maxhp + ' HP'}</small></span></button>`; }).join('')}</div><div class="row-btns"><button class="btn ghost" data-close>Cancel</button></div>`, { wide: true });
    $$('#modalContent [data-bt]').forEach(t => t.onclick = () => {
      closeModal(true);
      consume(id); st.itemsUsed++; persist();
      submit({ type: 'item', item: { name: it.name, ...it.battle }, target: +t.dataset.bt });
    });
  });
}
async function submit(action) {
  const st = battleState; if (!st || st.playing) return;
  if (action.type === 'move' && st.tera) action.tera = true;
  let events;
  try { events = E.submitAction(st.b, action); }
  catch (err) { console.error(err); toast(err.message || 'That action is not possible.'); renderCommands(); return; }
  st.menu = 'main'; st.tera = false;
  await playEvents(events);
  renderCommands();
}
function confirmForfeit(after) {
  const st = battleState;
  const free = isFree(st.tier);
  confirmBox(free ? 'Leave this battle?' : 'Forfeit this battle?', st.tier === 'journey' ? 'It counts as a loss. You can challenge this trainer again any time.' : free ? 'You will receive no rewards.' : 'Forfeiting counts as a loss and uses today\'s attempt.', free ? 'Leave' : 'Forfeit', () => {
    st.b.ended = true; st.b.winner = 'e'; st.forfeit = true;
    finishBattle().then(() => after?.());
  }, true);
}
async function finishBattle() {
  const st = battleState; if (!st || st.finished) return; st.finished = true;
  const b = st.b, won = b.winner === 'p';
  const tier = st.tier, journey = tier === 'journey';
  const firstClear = journey && won && !st.forfeit && !save.journey.cleared[st.step.key];
  const t = journey ? { name: stepLabel(st.step), coins: firstClear ? J.STEP_COINS[st.step.kind] : 0 } : G.DAILY_TIERS[tier];
  const key = G.todayKey();
  const party = partyMons();
  const participants = new Set(b.sides.p.team.filter(m => m.activeTurns > 0 || m === E.active(b, 'p') || st.ko.some(k => k.seenBy.includes(m.uid))).map(m => m.uid));
  // EXP, EVs, friendship
  const gains = {};
  for (const p of party) gains[p.uid] = { exp: 0, evs: {}, levels: [], learned: [] };
  if (!st.forfeit) for (const ko of st.ko) {
    const seen = ko.seenBy.filter(u => gains[u]);
    for (const p of party) {
      const isPart = seen.includes(p.uid);
      const fainted = b.sides.p.team.find(m => m.uid === p.uid)?.fainted;
      if (fainted && isPart) continue;
      const exp = G.expYield(ko.species, ko.level, p.level, { trainer: tier !== 'practice', luckyEgg: p.item === 'luckyegg', share: isPart ? 1 : 0.5 });
      gains[p.uid].exp += exp;
      if (isPart) for (const [k, v] of Object.entries(G.evYieldFor(ko.species, p.item))) gains[p.uid].evs[k] = (gains[p.uid].evs[k] || 0) + v;
    }
  }
  const evoQueue = [];
  for (const p of party) {
    const g = gains[p.uid];
    if (g.exp) { g.levels = grantExp(p, g.exp); g.learned = learnNewMoves(p, g.levels); }
    g.evApplied = G.addEvs(p, g.evs);
    if (participants.has(p.uid)) {
      p.battles = (p.battles || 0) + 1; if (won) p.wins = (p.wins || 0) + 1;
      p.friendship = Math.min(255, p.friendship + (won ? 3 : 1) * (p.item === 'soothebell' ? 2 : 1));
      if (p.friendship >= 255 && !p.marks.includes('partner')) { p.marks.push('partner'); g.newMark = 'partner'; }
      if (won && tier === 'hard') { p.hardWins = (p.hardWins || 0) + 1; if (p.hardWins >= 7 && !p.marks.includes('mightiest')) { p.marks.push('mightiest'); g.newMark = 'mightiest'; } }
    }
    if (autoEvolutions(p).length) evoQueue.push(p);
  }
  // Coins and records
  let coins = won ? t.coins : journey ? 0 : Math.floor(t.coins * 0.3);
  if (st.forfeit) coins = isFree(tier) ? 0 : Math.floor(t.coins * 0.2);
  // Journey rewards are one-off and fixed, so the Amulet Coin doesn't double them.
  const amulet = !journey && party.some(p => participants.has(p.uid) && p.item === 'amuletcoin');
  if (amulet) coins *= 2;
  let capped = false;
  if (tier === 'practice' && won) {
    const pc = save.ledger.practiceCoins = save.ledger.practiceCoins?.date === key ? save.ledger.practiceCoins : { date: key, wins: 0 };
    if (pc.wins >= G.PRACTICE_COIN_WINS) { coins = 0; capped = true; } else pc.wins++;
  }
  addCoins(coins);
  save.battles++; if (won) save.wins++;
  const pTeam = b.sides.p.team;
  const hpLeftPct = pTeam.reduce((a, m) => a + m.hp / m.maxhp, 0) / pTeam.length;
  const fainted = pTeam.filter(m => m.fainted).length;
  const turns = b.turn;
  let score = 0;
  let newBadge = null;
  if (tier === 'practice') { save.practiceCount++; if (won) bumpDay('practiceWins'); }
  else if (journey) {
    if (firstClear) { save.journey.cleared[st.step.key] = key; if (st.step.kind === 'gym') newBadge = st.step.leader; }
  }
  else {
    score = G.battleScore(tier, won && !st.forfeit, { turns, hpLeftPct, fainted });
    save.daily[tier] = { result: won ? 'win' : 'loss', score, turns, date: key, hp: Math.round(hpLeftPct * 100), team: st.trainer.team.map(p => sp(p).num) };
    save.dailyScores = save.dailyScores || {};
    save.dailyScores[key] = (save.dailyScores[key] || 0) + score;
    for (const k of Object.keys(save.dailyScores)) if (G.dayDiff(k, key) > 6) delete save.dailyScores[k];
    if (won) bumpDay('dailyWins');
    if (DAILY.every(k => save.daily[k]?.result === 'win')) { save.stats.dailySweeps++; toast('Daily sweep! All three battles won.'); }
  }
  const bs = b.stats;
  for (const k of ['kos', 'superEffective', 'crits', 'damageDealt', 'statusMoves', 'teraUsed']) { save.stats[k] = (save.stats[k] || 0) + (bs[k] || 0); bumpDay(k, bs[k] || 0); }
  if (won && bs.teraUsed) save.stats.teraWins++;
  for (const m of st.trainer.team) { const n = sp(m).num; if (!save.seenDex.includes(n)) save.seenDex.push(n); }
  save.history = [...(save.history || []), { date: key, tier, won, score, turns }].slice(-30);
  afterProgress();
  // Results
  const rows = party.map(p => {
    const g = gains[p.uid];
    const prog = G.levelProgress(p);
    const evTxt = Object.entries(g.evApplied || {}).map(([k, v]) => '+' + v + ' ' + STAT_LABEL[k]).join(', ');
    return `<div class="result-mon">${iconOf(sp(p).num, p.shiny)}<span><b>${esc(p.nickname || sp(p).name)}</b> ${g.levels.length ? `<span class="badge-chip gold">Lv. ${p.level}!</span>` : `<small>Lv. ${p.level}</small>`}<br><small>+${fmt(g.exp)} EXP${evTxt ? ' · EVs ' + evTxt : ''}${g.learned.length ? ' · learned ' + esc(g.learned.join(', ')) : ''}${g.newMark ? ' · earned the ' + esc(G.MARKS[g.newMark].name) + '!' : ''}</small><div class="xp-bar"><i style="width:${prog.pct}%"></i></div></span></div>`;
  }).join('');
  const choice = await new Promise(resolve => {
    const title = won ? (journey && st.step.kind === 'champion' && firstClear ? 'New Champion!' : 'You won!') : st.forfeit ? (isFree(tier) ? 'You left the battle.' : 'You forfeited.') : 'You lost…';
    const eyebrow = tier === 'practice' ? 'Practice' : journey ? 'Journey · ' + esc(J.REGIONS[st.step.region].name) : 'Daily · ' + esc(t.name);
    const msg = won ? 'You defeated ' + esc(st.trainer.name) + ' in ' + turns + ' turns.' + (newBadge ? ` You earned the <b>${esc(newBadge.title.replace(/ (Gym|Stadium|Kahuna)$/, ''))} ${J.REGIONS[st.step.region].kahunas ? 'Grand Trial stamp' : 'Badge'}</b>!` : journey && !firstClear ? ' Rematches give Exp. Points only.' : '') : 'Train up and try again' + (isFree(tier) ? '!' : ' tomorrow!');
    showModal(`<div class="eyebrow">${eyebrow}</div><h2 id="modalTitle">${title}</h2>
      <p>${msg}</p>
      <div class="odds"><div class="odds-row"><span>Coins</span><b>+${coins}${amulet ? ' (Amulet Coin ×2)' : ''}${capped ? ' (daily practice coin limit reached)' : ''}</b></div>${!isFree(tier) ? `<div class="odds-row"><span>Daily score</span><b>${fmt(score)} pts</b></div>` : ''}<div class="odds-row"><span>Knockouts</span><b>${bs.kos}</b></div></div>
      <div class="result-list">${rows}</div>
      <div class="row-btns">${!isFree(tier) && won ? `<button class="btn ghost" data-share="${tier}">Share result</button>` : ''}${tier === 'practice' ? '<button class="btn ghost" id="againPractice">Battle again</button>' : ''}<button class="btn primary" data-close autofocus>Continue</button></div>`, { wide: true, onClose: () => resolve('continue') });
    const again = $('#againPractice'); if (again) again.onclick = () => { modalOnClose = null; closeModal(true); resolve('again'); };
  });
  if (battleState === st) battleState = null;
  const runEvos = () => {
    const p = evoQueue.shift();
    if (!p) { if (choice === 'again') startBattle('practice'); else if (activeScreen === 'battle') go(journey ? 'journey' : 'home'); return; }
    const o = autoEvolutions(p)[0]; if (!o) return runEvos(); doEvolve(p, o, runEvos);
  };
  runEvos();
}
function shareText(tier) {
  const r = save.daily[tier]; if (!r) return '';
  const all = DAILY.map(k => save.daily[k]?.result === 'win' ? 'W' : save.daily[k] ? 'L' : '-').join(' ');
  return `PokeDuel ${G.todayKey()} [${all}]\n${G.DAILY_TIERS[tier].name}: won in ${r.turns} turns with ${r.hp}% HP left\nScore ${fmt(r.score)} · ${location.origin}`;
}
async function share(tier) {
  const text = shareText(tier);
  try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Result copied — paste it anywhere!'); } }
  catch (e) { if (e?.name !== 'AbortError') showModal(`<h2 id="modalTitle">Share your result</h2><textarea readonly>${esc(text)}</textarea><div class="row-btns"><button class="btn primary" data-close>Done</button></div>`); }
}

// ---------- Event wiring ----------
function setupListeners() {
  document.addEventListener('click', e => {
    const t = e.target.closest('button, [data-go], label') || e.target;
    if (t.closest?.('[data-close]')) { closeModal(true); return; }
    const goEl = e.target.closest('[data-go]'); if (goEl) { e.preventDefault(); if (goEl.dataset.go === 'missions') { showMissions(); return; } closeModal(true); go(goEl.dataset.go); return; }
    const battleBtn = e.target.closest('[data-battle]'); if (battleBtn) { startBattle(battleBtn.dataset.battle); return; }
    const box = e.target.closest('[data-box]'); if (box) { openBox(box.dataset.box); return; }
    const shareBtn = e.target.closest('[data-share]'); if (shareBtn) { share(shareBtn.dataset.share); return; }
    const openMon = e.target.closest('[data-open-mon]'); if (openMon) { ui.sel = openMon.dataset.openMon; go('boxes'); return; }
    if (e.target.closest('#claimCheckin')) { claimCheckin(); return; }
    const cm = e.target.closest('[data-claim-mission]');
    if (cm) { const m = save.missions.list[+cm.dataset.claimMission]; const v = save.dayStats.values[m?.stat] || 0; if (m && !m.claimed && v >= m.goal) { m.claimed = true; addCoins(m.reward); afterProgress(); renderHome(); showMissions(); toast('Mission complete! +' + m.reward + ' coins'); } return; }
    if (e.target.closest('#missionBonus')) { if (!save.missions.bonus && save.missions.list.every(m => m.claimed)) { save.missions.bonus = true; save.inventory.expcandyl = (save.inventory.expcandyl || 0) + 1; afterProgress(); renderHome(); showMissions(); toast('Bonus: Exp. Candy L added to your Bag!'); } return; }
    if (e.target.closest('#openCheckin')) { showCheckin(); return; }
    if (e.target.closest('#howToPlay')) { showHowTo(); return; }
    const feat = e.target.closest('[data-feature]'); if (feat) { if (ui.shopCat === feat.dataset.cat) { selectShopItem(feat.dataset.feature); return; } ui.shopCat = feat.dataset.cat; ui.shopSel = feat.dataset.feature; ui.shopQty = 1; renderShop(); return; }
    const rank = e.target.closest('[data-rank]'); if (rank) { ui.rankTab = rank.dataset.rank; renderRanks(); return; }
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('#modalClose').addEventListener('click', () => closeModal());
  // Starter
  const setGen = g => { ui.starterName = $('#starterName')?.value; ui.starterGen = ((g - 1 + 9) % 9) + 1; ui.starterSel = G.speciesByNum(G.STARTERS_BY_GEN[ui.starterGen][1]); renderStarter(); };
  $('#generationBar').addEventListener('click', e => { const b = e.target.closest('[data-gen]'); if (b) setGen(+b.dataset.gen); });
  $('#genPrev').addEventListener('click', () => setGen(ui.starterGen - 1));
  $('#genNext').addEventListener('click', () => setGen(ui.starterGen + 1));
  $('#onboardStarterGrid').addEventListener('click', e => { const b = e.target.closest('[data-pick-starter]'); if (b) { ui.starterName = $('#starterName')?.value; ui.starterSel = b.dataset.pickStarter; renderStarter(); } });
  $('#chosenSummary').addEventListener('click', e => { if (e.target.closest('#confirmStarter')) confirmStarter(); });
  $('#chosenSummary').addEventListener('input', e => { if (e.target.id === 'starterName') ui.starterName = e.target.value; });
  // Boxes
  $('#screen-boxes').addEventListener('click', e => {
    const s = e.target.closest('[data-sel]'); if (s) { ui.sel = s.dataset.sel; renderBoxes(); return; }
    const tab = e.target.closest('[data-sumtab]'); if (tab) { ui.sumTab = tab.dataset.sumtab; renderSummary(); return; }
    const act = e.target.closest('[data-act]'); if (act) { summaryAction(act.dataset.act, act); return; }
  });
  $('#boxPrev').addEventListener('click', () => { ui.boxPage = Math.max(0, ui.boxPage - 1); renderBoxes(); });
  $('#boxNext').addEventListener('click', () => { ui.boxPage++; const pages = Math.ceil(filteredBox().length / 30); if (ui.boxPage >= pages) ui.boxPage = 0; renderBoxes(); });
  $('#boxSearch').addEventListener('input', e => { ui.boxSearch = e.target.value; ui.boxPage = 0; renderBoxes(); });
  $('#boxSort').addEventListener('change', e => { ui.boxSort = e.target.value; renderBoxes(); });
  // Shop
  $('#screen-shop').addEventListener('click', e => {
    const c = e.target.closest('[data-shopcat]'); if (c) { ui.shopCat = c.dataset.shopcat; ui.shopSel = null; ui.shopQty = 1; renderShop(); return; }
    const s = e.target.closest('[data-shopsel]'); if (s) { selectShopItem(s.dataset.shopsel); return; }
    const q = e.target.closest('[data-qty]'); if (q) { ui.shopQty = Math.max(1, Math.min(99, ui.shopQty + +q.dataset.qty)); renderShopDetail(); return; }
    const b = e.target.closest('[data-buy]'); if (b) { buyItem(b.dataset.buy); return; }
  });
  // Bag
  $('#screen-bag').addEventListener('click', e => {
    const c = e.target.closest('[data-bagcat]'); if (c) { ui.bagCat = c.dataset.bagcat; ui.bagSel = null; renderBag(); return; }
    const s = e.target.closest('[data-bagsel]'); if (s) { ui.bagSel = s.dataset.bagsel; renderBag(); return; }
    if (e.target.closest('[data-baguse]')) { const id = ui.bagSel; pickPokemon('Use ' + G.ITEMS[id].name + ' on…', null, p => applyItem(id, p)); return; }
    if (e.target.closest('[data-baggive]')) {
      const id = ui.bagSel;
      pickPokemon('Give ' + G.ITEMS[id].name + ' to…', null, p => { if (p.item) save.inventory[p.item] = (save.inventory[p.item] || 0) + 1; p.item = id; consume(id); persist(); renderBag(); toast(sp(p).name + ' is now holding ' + G.ITEMS[id].name + '.'); });
    }
  });
  // Dex
  const dexRefresh = () => { ui.dexShown = 120; renderDex(); };
  $('#dexQuery').addEventListener('input', dexRefresh); $('#dexFilter').addEventListener('change', dexRefresh); $('#dexGen').addEventListener('change', dexRefresh);
  $('#loadMore').addEventListener('click', () => { ui.dexShown += 120; renderDex(); });
  $('#dexResults').addEventListener('click', e => { const c = e.target.closest('[data-dex]'); if (c) showDexEntry(c.dataset.dex); });
  // Profile
  $('#screen-profile').addEventListener('click', e => {
    if (e.target.closest('#pickAvatar, #pickAvatar2')) { showAvatarPicker(); return; }
    if (e.target.closest('#renameTrainer')) {
      showModal(`<h2 id="modalTitle">Trainer name</h2><p class="muted">Shown on leaderboards. Keep it friendly — no personal information.</p><input id="nameInput" maxlength="16" value="${esc(save.trainerName)}" autofocus><div class="row-btns"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nameOk">Save</button></div>`);
      $('#nameOk').onclick = () => { save.trainerName = $('#nameInput').value.trim().replace(/[<>]/g, '').slice(0, 16) || 'Trainer'; closeModal(true); persist(); renderProfile(); };
      return;
    }
    const slot = e.target.closest('[data-showslot]');
    if (slot) { pickPokemon('Choose a Pokémon to showcase', null, p => { const i = +slot.dataset.showslot; const list = save.showcase.filter(u => u !== p.uid); list.splice(Math.min(i, list.length), 0, p.uid); save.showcase = list.slice(0, 3); persist(); renderProfile(); }); return; }
    if (e.target.closest('#shareCard')) {
      const show = save.showcase.map(byUid).filter(Boolean).map(p => (p.shiny ? 'Shiny ' : '') + G.displayName(p) + ' Lv.' + p.level).join(' · ');
      const text = `PokeDuel Trainer Card — ${trainerName()} (${rankName(G.trainerScore(save))})\nScore ${fmt(G.trainerScore(save))} · Dex ${save.ownedDex.length} · Shinies ${save.shinyDex.length} · Wins ${save.wins}${show ? '\nShowcase: ' + show : ''}`;
      navigator.clipboard?.writeText(text).then(() => toast('Trainer card copied!'), () => showModal(`<textarea readonly>${esc(text)}</textarea><div class="row-btns"><button class="btn primary" data-close>Done</button></div>`));
    }
  });
  $('#exportSave').addEventListener('click', exportFile);
  $('#copySave').addEventListener('click', copyCode);
  $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; if (f.size > 5e6) { toast('That file is too large to be a save.'); return; } f.text().then(previewImport); e.target.value = ''; });
  $('#pasteSave').addEventListener('click', () => {
    showModal(`<h2 id="modalTitle">Paste a save code</h2><textarea id="pasteBox" placeholder="Paste your save code or JSON here" autofocus></textarea><div class="row-btns"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="pasteOk">Continue</button></div>`);
    $('#pasteOk').onclick = () => { const v = $('#pasteBox').value; closeModal(true); previewImport(v); };
  });
  $('#animationsToggle').addEventListener('change', e => { save.settings.animations = e.target.checked; persist(); startParade(); });
  $('#effectsToggle').addEventListener('change', e => { save.settings.reducedEffects = e.target.checked; document.body.classList.toggle('reduced-effects', e.target.checked); persist(); startParade(); });
  $('#damageToggle').addEventListener('change', e => { save.settings.showDamage = e.target.checked; persist(); });
  $('#speedSelect').addEventListener('change', e => { save.settings.battleSpeed = Number(e.target.value) || 1; persist(); });
  $('#resetSave').addEventListener('click', () => confirmBox('Reset everything?', 'This deletes the save in this browser (a backup copy is kept). Your cloud save is not deleted, but it will be overwritten if you keep playing while signed in.', 'Delete local save', () => {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(save)); localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    save = G.defaultSave(); battleState = null; persist(); afterSaveReplaced(); toast('Local save reset.');
  }, true));
  // Battle
  $('#battleControls').addEventListener('click', e => {
    const st = battleState; if (!st || st.playing) return;
    const c = e.target.closest('[data-cmd]'), mi = e.target.closest('[data-mi]');
    if (e.target.closest('#teraBtn')) { st.tera = !st.tera; renderCommands(); return; }
    if (mi) { submit({ type: 'move', index: +mi.dataset.mi }); return; }
    if (!c) return;
    const cmd = c.dataset.cmd;
    if (cmd === 'fight') { st.menu = 'fight'; renderCommands(); }
    if (cmd === 'back') { st.menu = 'main'; renderCommands(); }
    if (cmd === 'party') renderPartyPicker(false);
    if (cmd === 'bag') renderBattleBag();
    if (cmd === 'run') confirmForfeit();
  });
  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) { if (activeScreen === 'starter' && e.key === 'Enter' && e.target.id === 'starterName') confirmStarter(); return; }
    if (activeScreen === 'starter' && $('#modal').classList.contains('hidden')) {
      const ids = G.STARTERS_BY_GEN[ui.starterGen].map(n => G.speciesByNum(n));
      const i = ids.indexOf(ui.starterSel);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { ui.starterSel = ids[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; renderStarter(); e.preventDefault(); }
      if (e.key.toLowerCase() === 'q') setGen(ui.starterGen - 1);
      if (e.key.toLowerCase() === 'e') setGen(ui.starterGen + 1);
      if (e.key === 'Enter') confirmStarter();
      return;
    }
    if (e.key === 'Escape') { if (!$('#modal').classList.contains('hidden')) { closeModal(); return; } if (activeScreen === 'battle' && battleState?.menu === 'fight') { battleState.menu = 'main'; renderCommands(); return; } if (!['home', 'battle', 'starter'].includes(activeScreen)) go('home'); return; }
    if (!$('#modal').classList.contains('hidden')) return;
    if (activeScreen === 'home') {
      if (e.key.toLowerCase() === 'b') go('boxes');
      if (e.key.toLowerCase() === 'p') startBattle('practice');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = $$('#mainMenu .qtile, #dailyCards [data-battle]'); const i = items.indexOf(document.activeElement);
        const n = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[n].focus(); e.preventDefault();
      }
    }
    if (activeScreen === 'battle' && battleState && !battleState.playing && /^[1-4]$/.test(e.key) && battleState.menu === 'fight') { const b = $(`#battleControls [data-mi="${+e.key - 1}"]`); if (b && !b.disabled) b.click(); }
  });
  window.addEventListener('popstate', () => { const name = location.hash.replace('#/', '') || 'home'; if (name !== activeScreen) go(name, { noHash: true }); });
  window.addEventListener('beforeunload', e => { if (battleState && !battleState.b.ended && !isFree(battleState.tier)) { e.preventDefault(); e.returnValue = ''; } });
}

// ---------- Boot ----------
async function loadData() {
  const files = ['moves', 'pokedex', 'abilities', 'learnsets'];
  const out = await Promise.all(files.map(f => fetch('data/' + f + '.json').then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); })));
  const [moves, dex, abilities, learnsets] = out;
  E.setData({ moves, dex, abilities });
  G.setGameData({ dex, moves, learnsets });
  G.registerEvolutionItems();
  for (const [id, it] of Object.entries(G.ITEMS)) E.ITEM_NAMES[id] = it.name;
}
// Optional artwork listed in assets/manifest.json (see ASSET_REQUESTS.md). Only
// files named there are requested, so missing art never causes 404s.
const assets = { backgrounds: {}, arenas: {}, tiers: {} };
async function loadAssetManifest() {
  try {
    const r = await fetch('assets/manifest.json');
    if (!r.ok) return;
    const m = await r.json();
    assets.backgrounds = m.backgrounds || {};
    assets.arenas = m.arenas || {};
    assets.tiers = m.tiers || {};
    assets.typeArenas = m.typeArenas || {};
    assets.weatherArenas = m.weatherArenas || {};
    for (const a of Object.values(assets.arenas)) if (a?.file) preload('assets/backgrounds/' + a.file);
    if (assets.backgrounds.home) document.body.style.setProperty('--home-bg', `url("assets/backgrounds/${assets.backgrounds.home}")`);
  } catch (e) { /* artwork is optional */ }
}
// Inline error state if game data can't be fetched (there is no splash screen).
function showBootError() {
  const box = document.createElement('div');
  box.className = 'boot-error card';
  box.setAttribute('role', 'alert');
  box.innerHTML = '<h2>Couldn’t load the game</h2><p class="muted">Check your connection and try again.</p><div class="row-btns"><button class="btn primary" id="bootRetry">Try again</button></div>';
  $('#app').prepend(box);
  $('#bootRetry').addEventListener('click', () => { box.remove(); boot(); });
}
// ---------- Wandering Pokémon ----------
// Random Pokémon cross the bottom of the screen: walkers trot along the ground,
// Flying types and Levitate users drift higher with a slow bob. Off in battle and
// when the player turns animations off or asks for reduced motion.
const parade = { timer: null, pool: null, live: 0 };
function paradeOn() {
  return save?.settings?.animations !== false && !save?.settings?.reducedEffects && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function paradePool() {
  if (!parade.pool) parade.pool = Object.keys(D()).filter(id => { const d = D()[id]; return d.num <= 1000 && !d.prevo && !d.tags?.length; });
  return parade.pool;
}
function spawnWanderer() {
  const lane = $('#parade');
  if (!lane || document.hidden || activeScreen === 'battle' || !paradeOn()) return;
  if (parade.live >= (innerWidth < 700 ? 2 : 4)) return;
  const pool = paradePool(), id = pool[Math.floor(Math.random() * pool.length)], d = D()[id];
  const flies = d.types.includes('Flying') || Object.values(d.ab || {}).includes('Levitate');
  const rightward = Math.random() < 0.5;
  const el = document.createElement('div');
  el.className = 'wanderer ' + (flies ? 'fly' : 'walk');
  el.style.bottom = (flies ? 34 + Math.random() * 40 : 0) + 'px';
  const im = new Image();
  im.alt = ''; im.decoding = 'async'; im.crossOrigin = 'anonymous';
  im.onerror = () => el.remove();
  im.onload = () => {
    if (!el.isConnected) return;
    // Scale by real species height (Joltik small, Wailord big), measured on the visible pixels.
    const b = spriteBox(im), targetH = Math.max(22, Math.min(110, 46 * Math.sqrt(d.ht || 1)));
    const k = targetH / b.h;
    im.style.width = Math.round(im.naturalWidth * k) + 'px';
    im.style.marginBottom = -Math.round((im.naturalHeight - b.y - b.h) * k) + 'px';
    const w = lane.clientWidth, span = w + 240;
    const speed = 50 + d.bs[5] * 0.7; // px per second, from base Speed
    parade.live++;
    const run = el.animate([{ transform: `translateX(${rightward ? -120 : w + 120}px)` }, { transform: `translateX(${rightward ? w + 120 : -120}px)` }], { duration: span / speed * 1000, easing: 'linear' });
    run.onfinish = run.oncancel = () => { el.remove(); parade.live--; };
  };
  // Showdown sprites face left; mirror them when walking right.
  if (rightward) im.style.scale = '-1 1';
  im.src = img.front(d.num, Math.random() < 1 / 64);
  el.appendChild(im);
  lane.appendChild(el);
}
function startParade() {
  clearInterval(parade.timer);
  if (!paradeOn()) { $$('#parade .wanderer').forEach(e => e.getAnimations().forEach(a => a.cancel())); return; }
  setTimeout(spawnWanderer, 800);
  parade.timer = setInterval(() => { if (Math.random() < 0.6) spawnWanderer(); }, 2600);
}

async function boot() {
  try { await Promise.all([loadData(), loadAssetManifest()]); }
  catch (err) { console.error('Data load failed', err); showBootError(); return; }
  save = readSave();
  runAudit(save);
  initialLocalSaveTimestamp = Date.parse(save.lastActive || '') || 0;
  checkNewDay();
  if (save.settings.reducedEffects) document.body.classList.add('reduced-effects');
  if (!boot.wired) { setupListeners(); boot.wired = true; }
  startParade();
  const start = location.hash.replace('#/', '');
  go(save.starterChosen ? (SCREENS.includes(start) && start !== 'battle' && start !== 'starter' ? start : 'home') : 'starter', { noHash: false });
  checkMedals();
  persist();
  booting = false;
  startFirebaseAuth();
  // Cache code, data and sprites on the device so later visits start instantly.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e));
}
boot();
})();
