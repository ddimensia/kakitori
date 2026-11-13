// App state: settings, cards, WaniKani subjects and the built-in kanji lists, held in memory
// and written through to storage.

import * as store from './store.js';
import { KANA, KANA_BY_CHAR, selectedKana } from './kana.js';
import { configureSrs, newSrsCard, review, knownSrsCard, State } from './srs.js';

export const DEFAULT_SETTINGS = {
  wkToken: '',
  knownStage: 1,
  vocabContext: true,
  kanjiSource: 'wanikani', // wanikani | jlpt | grade | frequency | none
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
  builtin: null, // data/kanji-info.json once loaded
};

export const KANJI_SOURCES = {
  wanikani: 'Kanji you’ve started on WaniKani',
  jlpt: 'JLPT order, N5 to N1 (2,211 kanji)',
  grade: 'Japanese school order, grade 1 to secondary school (2,136 jōyō kanji)',
  frequency: 'Most frequent first (2,501 kanji)',
  none: 'No kanji, kana only',
};

export const isBuiltinSource = (src) => src === 'jlpt' || src === 'grade' || src === 'frequency';

let builtinPromise = null;
/** Load the built-in kanji lists (about 0.7 MB) the first time a built-in list is used. */
export function ensureBuiltin() {
  if (state.builtin) return Promise.resolve(state.builtin);
  if (!builtinPromise) {
    builtinPromise = fetch(new URL('../data/kanji-info.json', import.meta.url))
      .then((r) => {
        if (!r.ok) throw new Error(`kanji lists unavailable (${r.status})`);
        return r.json();
      })
      .then((d) => { state.builtin = d; return d; })
      .catch((err) => { builtinPromise = null; throw err; });
  }
  return builtinPromise;
}

export async function loadState() {
  const { persistent } = await store.initStore();
  state.persistent = persistent;
  const saved = (await store.kvGet('settings')) || {};
  if (saved.kanjiSource === undefined && saved.includeKanji === false) saved.kanjiSource = 'none';
  delete saved.includeKanji;
  state.settings = { ...DEFAULT_SETTINGS, ...saved };
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
  if (s.kanjiSource === 'wanikani') {
    for (const sub of state.subjects.values()) {
      if (sub.srsStage >= s.knownStage) wanted.set(cardId('kanji', sub.char), { char: sub.char, kind: 'kanji', order: kanjiOrder(sub) });
    }
  } else if (isBuiltinSource(s.kanjiSource)) {
    const data = await ensureBuiltin();
    data.lists[s.kanjiSource].forEach((ch, i) => wanted.set(cardId('kanji', ch), { char: ch, kind: 'kanji', order: i }));
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

/** Characters started through lessons today (ones marked as already known don't count). */
export function introducedToday() {
  const t = startOfToday();
  return [...state.cards.values()].filter((c) => c.introducedAt && c.introducedAt >= t && !c.markedKnown).length;
}

/** New cards in lesson order, honouring the daily limit. */
/** Every character not started yet, in the order lessons would teach it. */
export function pendingLessons() {
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
  return ordered;
}

/** Today's lessons: the next characters in order, up to what's left of the daily limit. */
export function lessonQueue({ ignoreLimit = false } = {}) {
  const ordered = pendingLessons();
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

/**
 * How well you already know a character. `days` is the starting memory stability: first
 * reviews are spread between about a fifth of it and all of it, so a whole set marked at
 * once comes back gradually.
 */
export const FAMILIARITY = [
  { id: 'shaky', label: 'Recognize it, still shaky', days: 2, difficulty: 5, help: 'First review in 1–2 days' },
  { id: 'know', label: 'Know it', days: 10, difficulty: 3, help: 'First reviews spread over the next 10 days' },
  { id: 'well', label: 'Know it well', days: 30, difficulty: 2.5, help: 'First reviews spread over the next month' },
  { id: 'cold', label: 'Could write it in my sleep', days: 90, difficulty: 2, help: 'First reviews spread over the next 3 months' },
];

/**
 * Mark cards as known at a familiarity level, skipping their lessons.
 * Cards already studied are left alone unless `overwrite` is set.
 * @returns {{count:number, undo:()=>Promise<void>}}
 */
export async function markKnown(cards, levelId, { overwrite = false } = {}) {
  const lvl = FAMILIARITY.find((f) => f.id === levelId) || FAMILIARITY[1];
  const DAY = 86400000;
  const now = Date.now();
  const stability = Math.min(lvl.days, state.settings.maxInterval);
  const lo = Math.max(1, stability * 0.2);
  const snapshots = [];
  const changed = [];
  for (const card of cards) {
    if (card.introducedAt && !overwrite) continue;
    snapshots.push(JSON.parse(JSON.stringify(card)));
    const due = now + (lo + Math.random() * Math.max(0, stability - lo)) * DAY;
    card.srs = knownSrsCard({ stability, difficulty: lvl.difficulty, due, now });
    card.due = due;
    card.introducedAt = card.introducedAt || now;
    card.markedKnown = { level: lvl.id, at: now };
    changed.push(card);
  }
  await store.putMany('cards', changed);
  return {
    count: changed.length,
    undo: async () => {
      for (const snap of snapshots) {
        const card = state.cards.get(snap.id);
        if (!card) continue;
        for (const k of Object.keys(card)) delete card[k];
        Object.assign(card, snap);
      }
      await store.putMany('cards', snapshots.map((s) => state.cards.get(s.id)).filter(Boolean));
    },
  };
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
  delete card.markedKnown;
  await store.put('cards', card);
}

function builtinLevelLabel(e, source) {
  if (source === 'jlpt') return e.j ? `JLPT N${e.j}` : 'JLPT';
  if (source === 'grade') return e.g && e.g <= 6 ? `Grade ${e.g}` : 'Secondary school';
  return e.f ? `Frequency #${e.f}` : 'Frequency';
}

/**
 * Meanings, readings and example words for a kanji from the current source, in one shape:
 * { meanings, readings: {onyomi, kunyomi}, words: [{w, r, m}], levelLabel, url, urlLabel }.
 */
export function kanjiInfo(ch) {
  const src = state.settings.kanjiSource;
  if (isBuiltinSource(src) && state.builtin) {
    const e = state.builtin.kanji[ch];
    if (!e) return null;
    return {
      meanings: e.m,
      readings: {
        onyomi: e.on.map((reading) => ({ reading, primary: false })),
        kunyomi: e.kun.map((reading) => ({ reading, primary: false })),
      },
      words: (e.w || []).map(([w, r, m]) => ({ w, r, m })),
      levelLabel: builtinLevelLabel(e, src),
      url: `https://jisho.org/search/${encodeURIComponent(`${ch} #kanji`)}`,
      urlLabel: 'Look up on Jisho',
    };
  }
  const sub = state.subjects.get(ch);
  if (!sub) return null;
  return {
    meanings: sub.meanings,
    readings: sub.readings || {},
    words: sub.words || [],
    levelLabel: `Level ${sub.level}`,
    url: sub.url,
    urlLabel: 'Open on WaniKani',
  };
}

/** Whether a kanji counts as one you know (for the same-meaning check). */
export function isKnownKanji(ch) {
  if (state.settings.kanjiSource === 'wanikani') return (state.subjects.get(ch)?.srsStage ?? 0) >= 1;
  return !!state.cards.get(cardId('kanji', ch))?.introducedAt;
}

/** Group used by the character sheet. */
export function groupFor(card) {
  if (card.kind !== 'kanji') return card.kind === 'hiragana' ? { key: 'a', label: 'Hiragana' } : { key: 'b', label: 'Katakana' };
  const src = state.settings.kanjiSource;
  if (isBuiltinSource(src) && state.builtin) {
    const e = state.builtin.kanji[card.char] || {};
    if (src === 'jlpt') return { key: `j${6 - (e.j || 0)}`, label: e.j ? `Kanji, JLPT N${e.j}` : 'Kanji' };
    if (src === 'grade') return e.g <= 6 ? { key: `g${e.g}`, label: `Kanji, grade ${e.g}` } : { key: 'g8', label: 'Kanji, secondary school' };
    const band = Math.floor(((e.f || 2501) - 1) / 250);
    return { key: `f${String(band).padStart(2, '0')}`, label: `Kanji, frequency ${band * 250 + 1}–${(band + 1) * 250}` };
  }
  const lvl = state.subjects.get(card.char)?.level ?? 0;
  return { key: `k${String(lvl).padStart(2, '0')}`, label: lvl ? `Kanji, level ${lvl}` : 'Kanji' };
}

/** Prompt information for a card. */
export function promptFor(card) {
  if (card.kind === 'kanji') return { kind: 'kanji', subject: kanjiInfo(card.char) };
  return { kind: card.kind, kana: KANA_BY_CHAR.get(card.char) };
}

export function kindLabel(kind) {
  return kind === 'kanji' ? 'Kanji' : kind === 'hiragana' ? 'Hiragana' : 'Katakana';
}

export { KANA };
