// Spaced repetition via FSRS (ts-fsrs). Cards are stored as plain JSON.

import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.js';

export { Rating, State };

let scheduler = null;

export function configureSrs({ retention = 0.9, maxInterval = 365 } = {}) {
  scheduler = fsrs(
    generatorParameters({
      request_retention: retention,
      maximum_interval: maxInterval,
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: ['1m', '10m'],
      relearning_steps: ['10m'],
    }),
  );
}

function toPlain(card) {
  return {
    ...card,
    due: new Date(card.due).toISOString(),
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null,
  };
}

function toInput(card) {
  const c = { ...card, due: new Date(card.due) };
  if (card.last_review) c.last_review = new Date(card.last_review);
  else delete c.last_review;
  return c;
}

export function newSrsCard(now = new Date()) {
  return toPlain(createEmptyCard(now));
}

/** Due time in ms for each rating, without changing the card. */
export function preview(srsCard, now = new Date()) {
  const p = scheduler.repeat(toInput(srsCard), now);
  const out = {};
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) out[g] = new Date(p[g].card.due).getTime();
  return out;
}

export function review(srsCard, rating, now = new Date()) {
  const { card, log } = scheduler.next(toInput(srsCard), now, rating);
  return { card: toPlain(card), log };
}

export function retrievability(srsCard, now = new Date()) {
  if (!srsCard || srsCard.state === State.New) return 0;
  try {
    return scheduler.get_retrievability(toInput(srsCard), now, false);
  } catch {
    return 0;
  }
}

export function formatInterval(ms) {
  const min = ms / 60000;
  if (min < 1) return 'now';
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30.44;
  if (mo < 12) return `${mo < 10 ? mo.toFixed(1).replace(/\.0$/, '') : Math.round(mo)}mo`;
  const y = d / 365.25;
  return `${y.toFixed(1).replace(/\.0$/, '')}y`;
}

/** Memory strength bucket used for colouring the character grid. */
export function strength(card) {
  if (!card.introducedAt || !card.srs) return 'unseen';
  const s = card.srs;
  if (s.state === State.New || s.state === State.Learning || s.state === State.Relearning) return 'learning';
  if (s.stability < 7) return 'weak';
  if (s.stability < 30) return 'fair';
  if (s.stability < 120) return 'strong';
  return 'solid';
}

export const STRENGTH_LABELS = {
  unseen: 'Not studied yet',
  learning: 'Learning',
  weak: 'Under a week',
  fair: 'Weeks',
  strong: 'Months',
  solid: 'Four months or more',
};
