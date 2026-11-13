// Offline support for the installed web app.
//
// Two caches:
//   kakitori-app-<VERSION>   app files; bump VERSION after changing any of them.
//   kakitori-data-<version>  stroke data and fonts listed in precache.json (about 15 MB);
//                            its version comes from tools/build_precache.py and changes
//                            only when those files change, so app updates don't re-download it.
// App files and data/kanji-info.json (rebuilt monthly) are network-first, so updates
// arrive whenever the server is reachable.
// Data and fonts are cache-first. WaniKani API requests are never cached.

const VERSION = '10';
const APP_CACHE = `kakitori-app-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'css/fonts.css',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'precache.json',
  'js/main.js',
  'js/state.js',
  'js/store.js',
  'js/srs.js',
  'js/session.js',
  'js/kana.js',
  'js/strokes.js',
  'js/pad.js',
  'js/glyphview.js',
  'js/grader.js',
  'js/recognizer.js',
  'js/recognizer.worker.js',
  'js/prompt.js',
  'js/writer.js',
  'js/ui.js',
  'js/wanikani.js',
  'js/views/today.js',
  'js/views/study.js',
  'js/views/characters.js',
  'js/views/lessons.js',
  'js/views/welcome.js',
  'js/views/settings.js',
  'vendor/ts-fsrs.js',
  'vendor/kanjicanvas-core.js',
  'data/kc-refs.json',
  'data/kanji-info.json', // updated monthly, so it's fetched fresh like the app files
];

async function dataCacheName() {
  const res = await caches.match('precache.json', { cacheName: APP_CACHE });
  const list = res ? await res.json() : { version: 'none' };
  return `kakitori-data-${list.version}`;
}

async function install() {
  const app = await caches.open(APP_CACHE);
  await app.addAll(SHELL);
  const list = await (await app.match('precache.json')).json();
  const data = await caches.open(`kakitori-data-${list.version}`);
  const missing = [];
  for (const url of list.files) if (!(await data.match(url))) missing.push(url);
  // Small batches, so a slow connection doesn't open hundreds of requests at once.
  for (let i = 0; i < missing.length; i += 12) {
    await Promise.all(missing.slice(i, i + 12).map((url) => data.add(url).catch(() => {})));
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(install().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([APP_CACHE, await dataCacheName()]);
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(await dataCacheName())).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isData = (url.pathname.includes('/data/') && !url.pathname.endsWith('/kanji-info.json')) || url.pathname.includes('/fonts/');
  event.respondWith(isData ? cacheFirst(req) : networkFirst(req));
});
