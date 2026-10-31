// PokeDuel service worker: makes repeat visits start instantly.
// - Code (HTML/JS/CSS): network first, falling back to the cached copy offline,
//   so new deploys are picked up straight away.
// - Game data and assets: served from cache immediately, refreshed in the background.
// Sprites (PokéAPI sprite repo) are left to the browser's own HTTP cache.
// Firebase, Google sign-in and PokéAPI requests are never cached.
const VERSION = 'v2';
const CODE = 'pd-code-' + VERSION, DATA = 'pd-data-' + VERSION;
const PRECACHE = ['./', 'index.html', 'styles.css', 'app.js', 'js/engine.js', 'js/game.js', 'js/security.js', 'assets/icons.svg', 'assets/logo.svg', 'assets/manifest.json', 'data/pokedex.json', 'data/moves.json', 'data/learnsets.json', 'data/abilities.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(DATA).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![CODE, DATA].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(CODE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req)) || (await caches.match(req)) || Response.error();
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (url.pathname.includes('/data/') || url.pathname.includes('/assets/')) { e.respondWith(staleWhileRevalidate(req)); return; }
  e.respondWith(networkFirst(req));
});
