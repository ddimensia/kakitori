// Usage: node tests/known_srs_test.mjs
// Checks that a "marked as known" card behaves sensibly under FSRS.
import { configureSrs, knownSrsCard, preview, review, retrievability, Rating } from '../js/srs.js';

configureSrs({ retention: 0.9, maxInterval: 365 });
const DAY = 86400000;
const now = Date.parse('2026-11-12T12:00:00Z');
for (const [label, S, D] of [['shaky', 2, 5], ['know', 10, 3], ['well', 30, 2.5], ['cold', 90, 2]]) {
  const due = now + S * 0.6 * DAY;
  const card = knownSrsCard({ stability: S, difficulty: D, due, now });
  const at = new Date(due);
  const p = preview(card, at);
  const fmt = (ms) => `${((ms - at.getTime()) / DAY).toFixed(1)}d`;
  const r = retrievability(card, at);
  const again = review(card, Rating.Again, at).card;
  console.log(label.padEnd(5), `R at first review ${(r * 100).toFixed(0)}%`, '| next if Again/Hard/Good/Easy:', [1, 2, 3, 4].map((g) => fmt(p[g])).join(' / '), '| lapses after Again:', again.lapses, 'state', again.state);
}
