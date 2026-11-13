// App shell: routing, sync orchestration and session start-up.

import { state, loadState, applySync, dueCards, lessonQueue, markWelcomed } from './state.js';
import { fetchKnownKanji } from './wanikani.js';
import { Session } from './session.js';
import { retrievability, State } from './srs.js';
import { warmRecognizer } from './recognizer.js';
import { renderToday } from './views/today.js';
import { renderCharacters } from './views/characters.js';
import { renderSettings } from './views/settings.js';
import { renderLessonPicker } from './views/lessons.js';
import { renderWelcome } from './views/welcome.js';
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

const notStarted = (c) => c.active && !c.suspended && !c.introducedAt;

/**
 * Run lessons one batch at a time. `nextCards()` gives the characters still to come; after each
 * batch's quiz the summary offers to continue with them.
 */
function runLessonBatches(nextCards) {
  const cards = nextCards().slice(0, state.settings.lessonBatch);
  if (!cards.length) { toast('No new characters right now.'); return; }
  const nextLessons = () => {
    const rest = nextCards();
    return rest.length ? { count: rest.length, batch: Math.min(rest.length, state.settings.lessonBatch), start: () => runLessonBatches(nextCards) } : null;
  };
  startStudy((root) => runLessons(root, cards, { ...studyCtx, nextLessons }));
}

/** Today's lessons, continuing up to the daily limit; with ignoreLimit, one batch past it. */
function startLessons(ignoreLimit) {
  if (ignoreLimit) {
    const batch = lessonQueue({ ignoreLimit: true }).available.slice(0, state.settings.lessonBatch);
    runLessonBatches(() => batch.filter(notStarted));
  } else {
    runLessonBatches(() => lessonQueue().available);
  }
}

/** Lessons for characters picked on the Choose lessons page, ignoring the daily limit. */
function startChosenLessons(cards) {
  runLessonBatches(() => cards.filter(notStarted));
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
  if (name === 'today' || name === 'settings' || name === 'characters') route(); // not Choose lessons: keep the selection
}

const viewOpts = () => ({
  onStartReviews: startReviews,
  onStartLessons: startLessons,
  onStartChosen: startChosenLessons,
  onSync: () => sync(),
  onPractice: (card) => practice([card], 'Practice'),
  onExtraPractice: extraPractice,
  onRefresh: () => route(),
  syncStatus,
});

function setNav(name) {
  const navName = name === 'lessons' ? 'today' : name; // Choose lessons is reached from Today
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.getAttribute('href') === `#${navName}`) a.setAttribute('aria-current', 'page');
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
  // A first visit opens on the welcome page. Opening any other page (leaving the welcome page,
  // or arriving by a direct link) means it's no longer a first visit.
  if (lastRoute === null && name === 'today' && !state.settings.welcomed) { history.replaceState(null, '', '#welcome'); name = 'welcome'; }
  if (name !== 'welcome') markWelcomed();
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
  else if (name === 'lessons') renderLessonPicker(root, viewOpts());
  else if (name === 'welcome') cleanup = renderWelcome(root);
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
  if (s.kanjiSource === 'wanikani' && s.wkToken && (!state.sync || Date.now() - state.sync.at > s.autoSyncHours * 3600000)) sync({ quiet: true });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
