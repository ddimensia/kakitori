// A study session: a queue of cards plus cards coming back after a short learning step.

import { rateCard, undoRating } from './state.js';

const RETURN_WINDOW = 30 * 60 * 1000; // cards due again within 30 minutes stay in the session

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Session {
  /**
   * @param {object[]} cards
   * @param {{scheduled?: boolean, shuffle?: boolean, title?: string}} opts
   *   scheduled=false is free practice: nothing is written to the schedule.
   */
  constructor(cards, { scheduled = true, shuffle: doShuffle = true, title = 'Reviews' } = {}) {
    this.scheduled = scheduled;
    this.title = title;
    this.queue = doShuffle ? shuffle(cards.slice()) : cards.slice();
    this.returning = [];
    this.total = cards.length;
    this.finished = 0;
    this.current = null;
    this.lastId = null;
    this.history = [];
    this.practiceRepeats = new Map();
  }

  get remaining() {
    return this.queue.length + this.returning.length + (this.current ? 1 : 0);
  }

  next(now = Date.now()) {
    this.returning.sort((a, b) => a.at - b.at);
    let idx = this.returning.findIndex((r) => r.at <= now && r.card.id !== this.lastId);
    if (idx < 0 && this.queue.length === 0 && this.returning.length) {
      idx = this.returning.findIndex((r) => r.card.id !== this.lastId);
      if (idx < 0) idx = 0;
    }
    if (idx >= 0) this.current = this.returning.splice(idx, 1)[0].card;
    else this.current = this.queue.shift() || null;
    return this.current;
  }

  async answer(rating, details = {}) {
    const card = this.current;
    if (!card) return;
    const entry = { card, rating, score: details.score ?? null, undo: null, returned: false };
    if (this.scheduled) {
      entry.undo = await rateCard(card, rating, details);
      if (card.due - Date.now() < RETURN_WINDOW) {
        this.returning.push({ card, at: card.due });
        entry.returned = true;
      } else this.finished++;
    } else {
      const n = this.practiceRepeats.get(card.id) || 0;
      if (rating <= 2 && n < 2) {
        this.practiceRepeats.set(card.id, n + 1);
        this.returning.push({ card, at: Date.now() + 60 * 1000 });
        entry.returned = true;
      } else this.finished++;
    }
    this.history.push(entry);
    this.lastId = card.id;
    this.current = null;
  }

  canUndo() {
    return this.history.length > 0 && !this.current?.dirty;
  }

  /** Undo the last answer and put that card back on screen. */
  async undo() {
    const entry = this.history.pop();
    if (!entry) return null;
    if (this.current) this.queue.unshift(this.current);
    if (entry.returned) {
      const i = this.returning.findIndex((r) => r.card === entry.card);
      if (i >= 0) this.returning.splice(i, 1);
    } else this.finished--;
    if (this.scheduled && entry.undo) await undoRating(entry.card, entry.undo);
    if (!this.scheduled && entry.returned) {
      this.practiceRepeats.set(entry.card.id, (this.practiceRepeats.get(entry.card.id) || 1) - 1);
    }
    this.current = entry.card;
    this.lastId = null;
    return entry.card;
  }

  summary() {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const firstTry = new Map();
    for (const h of this.history) {
      counts[h.rating]++;
      if (!firstTry.has(h.card.id)) firstTry.set(h.card.id, h.rating);
    }
    const first = [...firstTry.values()];
    const passed = first.filter((r) => r >= 2).length;
    return { counts, reviewed: this.history.length, cards: first.length, passed };
  }
}
