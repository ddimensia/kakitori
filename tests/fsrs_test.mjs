// Sanity check of the vendored ts-fsrs scheduler API used by the app.
import { fsrs, generatorParameters, createEmptyCard, Rating } from '../vendor/ts-fsrs.js';

const f = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 3650, enable_fuzz: false }));
let now = new Date('2026-11-12T10:00:00Z');
let card = createEmptyCard(now);
const prev = f.repeat(card, now);
for (const g of [1, 2, 3, 4]) {
  console.log('new card, rating', g, '->', prev[g].card.due.toISOString(), 'state', prev[g].card.state, 'S', prev[g].card.stability.toFixed(2));
}
let r = f.next(card, now, Rating.Good);
card = r.card;
console.log(JSON.stringify(card));
now = card.due;
r = f.next(card, now, Rating.Good);
card = r.card;
console.log('second good ->', card.due.toISOString(), 'state', card.state, 'days', card.scheduled_days);
const j = JSON.parse(JSON.stringify(card));
r = f.next(j, card.due, Rating.Good);
console.log('from JSON ->', r.card.due.toISOString(), 'days', r.card.scheduled_days);
