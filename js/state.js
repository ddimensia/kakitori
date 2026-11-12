// App state: settings, cards and WaniKani subjects held in memory and written through to storage.

import * as store from './store.js';
import { KANA, KANA_BY_CHAR, selectedKana } from './kana.js';
import { configureSrs, newSrsCard, review, State } from './srs.js';

export const DEFAULT_SETTINGS = {
  wkToken: '',
  knownStage: 1,
  vocabContext: true,
  includeKanji: true,
  hiragana: true,
  katakana: true,
  dakuten: true,
  newPerDay: 10,
  lessonBatch: 5,
  lessonOrder: 'mixed', // mixed | kana | kanji
  retention: 0.9,
  maxInterval: 365,
  strictness: 'normal',
  showStrokeCount: false,
  penOnly: true,
  autoSyncHours: 6,
};

export const state = {
  persistent: true,
  settings: { ...DEFAULT_SETTINGS },
  sync: null, // { at, user, count }
  cards: new Map(),
  subjects: new Map(),
};

export async function loadState() {
  const { persistent } = await store.initStore();
  state.persistent = persistent;
  state.settings = { ...DEFAULT_SETTINGS, ...((await store.kvGet('settings')) || {}) };
  state.sync = (await store.kvGet('sync')) || null;
  state.cards = new Map((await store.getAll('cards')).map((c) => [c.id, c]));
  state.subjects = new Map((await store.getAll('subjects')).map((s) => [s.char, s]));
  configureSrs(state.settings);
  await reconcileCards();
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await store.kvSet('settings', state.settings);
  configureSrs(state.settings);
  await reconcileCards();
}

export const cardId = (kind, char) => `${kind[0]}:${char}`;

function kanjiOrder(s) {
  return s.level * 10000 + (s.lessonPosition || 0);
}

/**
 * Make the card set match the settings and synced subjects.
 * Cards are never deleted: ones no longer selected are marked inactive and keep their history.
 */
export async function reconcileCards() {
  const s = state.settings;
  const wanted = new Map();
  for (const k of selectedKana(s)) wanted.set(cardId(k.kind, k.char), { char: k.char, kind: k.kind, order: k.order });
  if (s.includeKanji) {
    for (const sub of state.subjects.values()) {
      if (sub.srsStage >= s.knownStage) wanted.set(cardId('kanji', sub.char), { char: sub.char, kind: 'kanji', order: kanjiOrder(sub) });
    }
  }
  const changed = [];
  for (const [id, w] of wanted) {
    const c = state.cards.get(id);
    if (!c) {
      const card = { id, char: w.char, kind: w.kind, order: w.order, active: true, suspended: false, introducedAt: null, srs: null, due: null, createdAt: Date.now() };
      state.cards.set(id, card);
      changed.push(card);
    } else if (!c.active || c.order !== w.order) {
      c.active = true;
      c.order = w.order;
      changed.push(c);
    }
  }
  for (const c of state.cards.values()) {
    if (c.active && !wanted.has(c.id)) { c.active = false; changed.push(c); }
  }
  await store.putMany('cards', changed);
}

export async function applySync(result) {
  const subjects = result.kanji;
  const seen = new Set(subjects.map((k) => k.char));
  await store.putMany('subjects', subjects);
  for (const k of subjects) state.subjects.set(k.char, k);
  // Kanji that dropped out of WaniKani's started list (e.g. after a level reset)
  for (const [ch, sub] of state.subjects) {
    if (!seen.has(ch) && sub.srsStage) {
      sub.srsStage = 0;
      await store.put('subjects', sub);
    }
  }
  state.sync = { at: Date.now(), user: result.user, count: subjects.length };
  await store.kvSet('sync', state.sync);
  await reconcileCards();
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const studyable = (c) => c.active && !c.suspended;

export function dueCards(now = Date.now()) {
  return [...state.cards.values()].filter((c) => studyable(c) && c.introducedAt && c.due !== null && c.due <= now);
}

export function introducedToday() {
  const t = startOfToday();
  return [...state.cards.values()].filter((c) => c.introducedAt && c.introducedAt >= t).length;
}

/** New cards in lesson order, honouring the daily limit. */
export function lessonQueue({ ignoreLimit = false } = {}) {
  const pending = [...state.cards.values()].filter((c) => studyable(c) && !c.introducedAt);
  const kana = pending.filter((c) => c.kind !== 'kanji').sort((a, b) => a.order - b.order);
  const kanji = pending.filter((c) => c.kind === 'kanji').sort((a, b) => a.order - b.order);
  let ordered;
  const order = state.settings.lessonOrder;
  if (order === 'kana') ordered = [...kana, ...kanji];
  else if (order === 'kanji') ordered = [...kanji, ...kana];
  else {
    ordered = [];
    for (let i = 0; i < Math.max(kana.length, kanji.length); i++) {
      if (i < kanji.length) ordered.push(kanji[i]);
      if (i < kana.length) ordered.push(kana[i]);
    }
  }
  const left = ignoreLimit ? ordered.length : Math.max(0, state.settings.newPerDay - introducedToday());
  return { available: ordered.slice(0, left), waiting: ordered.length };
}

export async function markIntroduced(card) {
  const now = new Date();
  card.introducedAt = now.getTime();
  card.srs = newSrsCard(now);
  card.due = now.getTime();
  await store.put('cards', card);
}

/** Apply a rating; returns a snapshot that undoRating() can restore. */
export async function rateCard(card, rating, details = {}) {
  const snapshot = JSON.parse(JSON.stringify(card));
  const now = new Date();
  if (!card.srs) card.srs = newSrsCard(now);
  const { card: next } = review(card.srs, rating, now);
  card.srs = next;
  card.due = new Date(next.due).getTime();
  if (!card.introducedAt) card.introducedAt = now.getTime();
  card.lastScore = details.score ?? null;
  await store.put('cards', card);
  const logId = await store.addLog({ ts: now.getTime(), cardId: card.id, rating, score: details.score ?? null, suggested: details.suggested ?? null, state: snapshot.srs ? snapshot.srs.state : State.New });
  return { snapshot, logId };
}

export async function undoRating(card, undo) {
  Object.assign(card, undo.snapshot);
  for (const k of Object.keys(card)) if (!(k in undo.snapshot)) delete card[k];
  await store.put('cards', card);
  if (undo.logId != null) await store.remove('log', undo.logId);
}

export async function setSuspended(card, v) {
  card.suspended = v;
  await store.put('cards', card);
}

export async function resetCard(card) {
  card.introducedAt = null;
  card.srs = null;
  card.due = null;
  card.lastScore = null;
  await store.put('cards', card);
}

/** Prompt information for a card. */
export function promptFor(card) {
  if (card.kind === 'kanji') {
    const s = state.subjects.get(card.char);
    return { kind: 'kanji', subject: s || null };
  }
  return { kind: card.kind, kana: KANA_BY_CHAR.get(card.char) };
}

export function kindLabel(kind) {
  return kind === 'kanji' ? 'Kanji' : kind === 'hiragana' ? 'Hiragana' : 'Katakana';
}

export { KANA };
