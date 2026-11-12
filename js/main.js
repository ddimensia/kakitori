// App shell: routing, sync orchestration and session start-up.

import { state, loadState, applySync, dueCards, lessonQueue } from './state.js';
import { fetchKnownKanji } from './wanikani.js';
import { Session } from './session.js';
import { retrievability, State } from './srs.js';
import { warmRecognizer } from './recognizer.js';
import { renderToday } from './views/today.js';
import { renderCharacters } from './views/characters.js';
import { renderSettings } from './views/settings.js';
import { runSession, runLessons } from './views/study.js';
import { toast } from './ui.js';

const main = document.getElementById('view');
let cleanup = null;
let keyHandler = null;
let pendingStudy = null;
let syncStatus = null;

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  keyHandler?.(e);
});

function setKeys(fn) {
  keyHandler = fn;
}

function freshRoot() {
  const root = document.createElement('div');
  root.className = 'view-root';
  main.replaceChildren(root);
  return root;
}

function navigate(hash) {
  if (location.hash === `#${hash}`) route();
  else location.hash = hash;
}

const studyCtx = { onExit: () => navigate('today'), setKeys };

function startStudy(fn) {
  pendingStudy = fn;
  navigate('study');
}

function startReviews() {
  const cards = dueCards();
  if (!cards.length) { toast('Nothing is due right now.'); return; }
  startStudy((root) => runSession(root, new Session(cards, { scheduled: true, title: 'Reviews' }), studyCtx));
}

function startLessons(ignoreLimit) {
  const { available } = lessonQueue({ ignoreLimit });
  const batch = available.slice(0, state.settings.lessonBatch);
  if (!batch.length) { toast('No new characters right now.'); return; }
  startStudy((root) => runLessons(root, batch, studyCtx));
}

function practice(cards, title = 'Practice') {
  startStudy((root) => runSession(root, new Session(cards, { scheduled: false, title }), studyCtx));
}

function extraPractice() {
  const now = new Date();
  const studied = [...state.cards.values()].filter((c) => c.active && !c.suspended && c.introducedAt && c.srs);
  studied.sort((a, b) => {
    const ra = a.srs.state === State.Review ? retrievability(a.srs, now) : 0;
    const rb = b.srs.state === State.Review ? retrievability(b.srs, now) : 0;
    return ra - rb || (b.srs.lapses || 0) - (a.srs.lapses || 0);
  });
  practice(studied.slice(0, 10), 'Weakest ten');
}

async function sync({ quiet = false } = {}) {
  if (syncStatus) return;
  const token = state.settings.wkToken;
  if (!token) { if (!quiet) toast('Add your WaniKani API token first.', { error: true }); return; }
  const setStatus = (msg) => {
    syncStatus = msg;
    document.querySelectorAll('[data-sync-status]').forEach((el) => { el.textContent = `${msg}…`; });
  };
  try {
    syncStatus = 'Syncing with WaniKani';
    refreshIfIdle();
    const result = await fetchKnownKanji(token, { minStage: 1, vocab: true }, setStatus);
    await applySync(result);
    syncStatus = null;
    toast(`Synced ${result.kanji.length} kanji from WaniKani.`);
  } catch (err) {
    syncStatus = null;
    if (!quiet || !(err.message || '').startsWith('Couldn’t reach')) toast(err.message || 'Sync failed.', { error: true, ms: 6000 });
  }
  refreshIfIdle();
}

/** Re-render list pages (not study sessions) to show new data. */
function refreshIfIdle() {
  const name = location.hash.slice(1) || 'today';
  if (name === 'today' || name === 'settings' || name === 'characters') route();
}

const viewOpts = () => ({
  onStartReviews: startReviews,
  onStartLessons: startLessons,
  onSync: () => sync(),
  onPractice: (card) => practice([card], 'Practice'),
  onExtraPractice: extraPractice,
  onRefresh: () => route(),
  syncStatus,
});

function setNav(name) {
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.getAttribute('href') === `#${name}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.body.dataset.view = name;
}

let lastRoute = null;

function route() {
  cleanup?.();
  cleanup = null;
  setKeys(null);
  let name = location.hash.slice(1) || 'today';
  if (name === 'study' && !pendingStudy) { history.replaceState(null, '', '#today'); name = 'today'; }
  if (name !== lastRoute) window.scrollTo(0, 0); // new page starts at the top; refreshes keep position
  lastRoute = name;
  setNav(name);
  const root = freshRoot();
  if (name === 'study') {
    const fn = pendingStudy;
    pendingStudy = null;
    cleanup = fn(root) || null;
  } else if (name === 'characters') renderCharacters(root, viewOpts());
  else if (name === 'settings') renderSettings(root, viewOpts());
  else {
    if (name !== 'today') history.replaceState(null, '', '#today');
    setNav('today');
    renderToday(root, viewOpts());
  }
  if (name !== 'study') main.focus({ preventScroll: true });
}

async function boot() {
  try {
    await loadState();
  } catch (err) {
    main.innerHTML = `<p class="warn">The app couldn’t open its storage: ${String(err.message || err)}</p>`;
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener('hashchange', route);
  route();
  warmRecognizer();
  const s = state.settings;
  if (s.wkToken && (!state.sync || Date.now() - state.sync.at > s.autoSyncHours * 3600000)) sync({ quiet: true });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
