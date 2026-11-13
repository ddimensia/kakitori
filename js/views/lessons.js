// Choose lessons: pick any characters you haven't started, regardless of the daily limit.
// The counterpart of WaniKani's "Advanced" lesson picker.

import { state, pendingLessons, introducedToday, groupFor } from '../state.js';
import { esc, plural } from '../ui.js';
import { sheetMarkup } from './characters.js';

const KINDS = [['all', 'All'], ['hiragana', 'Hiragana'], ['katakana', 'Katakana'], ['kanji', 'Kanji']];

/** @param {{onStartChosen: (cards: object[]) => void}} opts */
export function renderLessonPicker(view, { onStartChosen }) {
  const pending = pendingLessons(); // already in lesson order
  const s = state.settings;
  const batch = s.lessonBatch;
  const done = introducedToday();
  const kinds = KINDS.filter(([k]) => k === 'all' || pending.some((c) => c.kind === k));
  let kind = 'all';
  let shown = [];
  const selected = new Set();

  const limitLine = done >= s.newPerDay
    ? `You’ve reached today’s limit of ${s.newPerDay} new characters. Lessons you choose here go past it.`
    : `Your daily limit is ${s.newPerDay} new characters${done ? `, and you’ve learned ${done} today` : ''}. Lessons you choose here count toward it and can go past it.`;

  view.innerHTML = `
    <section class="page characters picker is-selecting">
      <header class="page-head">
        <h1>Choose lessons</h1>
        <p class="page-sub">Pick any characters you haven’t started yet. ${esc(limitLine)}</p>
      </header>
      ${pending.length ? `
      <div class="filters">
        ${kinds.length > 2 ? `<div class="seg" role="group" aria-label="Kind">
          ${kinds.map(([v, l]) => `<button data-kind="${v}" aria-pressed="${v === kind}">${l}</button>`).join('')}
        </div>` : ''}
        <button class="btn" data-act="next-batch">Select the next ${batch}</button>
        <button class="btn quiet" data-act="select-shown">Select all shown</button>
      </div>
      <p class="result-count" aria-live="polite"></p>
      <div class="sheet"></div>
      <div class="select-bar" role="region" aria-label="Selection">
        <p class="select-count" aria-live="polite"></p>
        <button class="btn quiet" data-act="select-clear">Clear</button>
        <span class="spacer"></span>
        <a class="btn" href="#today">Cancel</a>
        <button class="btn primary" data-act="start" disabled>Start lessons</button>
      </div>` : `
      <p class="empty">You’ve started every character in your list.</p>
      <p><a class="btn" href="#today">Back to today</a></p>`}
    </section>`;
  if (!pending.length) return;

  function updateBar() {
    const n = selected.size;
    let line = `${plural(n, 'character')} selected`;
    if (n > batch) line += `, learned ${batch} at a time with a quiz after each batch`;
    view.querySelector('.select-count').textContent = `${line}.`;
    view.querySelector('[data-act="start"]').disabled = n === 0;
  }

  function draw() {
    shown = pending.filter((c) => kind === 'all' || c.kind === kind);
    view.querySelector('.result-count').textContent = `${plural(shown.length, 'character')} not started yet`;
    view.querySelector('.sheet').innerHTML = sheetMarkup(shown, { groupActions: true, selecting: true, selected });
    updateBar();
  }

  view.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      kind = k.dataset.kind;
      view.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b === k)));
      draw();
      return;
    }
    const groupBtn = e.target.closest('.group-select');
    if (groupBtn) {
      const ids = shown.filter((c) => groupFor(c).key === groupBtn.dataset.group).map((c) => c.id);
      const all = ids.every((id) => selected.has(id));
      for (const id of ids) all ? selected.delete(id) : selected.add(id);
      draw();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next-batch') {
      let added = 0;
      for (const c of shown) {
        if (added >= batch) break;
        if (!selected.has(c.id)) { selected.add(c.id); added++; }
      }
      draw();
      return;
    }
    if (act === 'select-shown') { for (const c of shown) selected.add(c.id); draw(); return; }
    if (act === 'select-clear') { selected.clear(); draw(); return; }
    if (act === 'start') { onStartChosen(pending.filter((c) => selected.has(c.id))); return; }
    const cell = e.target.closest('[data-card]');
    if (!cell) return;
    const id = cell.dataset.card;
    selected.has(id) ? selected.delete(id) : selected.add(id);
    cell.classList.toggle('is-selected', selected.has(id));
    cell.setAttribute('aria-pressed', String(selected.has(id)));
    updateBar();
    const section = cell.closest('.sheet-group');
    const btn = section?.querySelector('.group-select');
    if (btn) {
      const all = [...section.querySelectorAll('[data-card]')].every((c) => selected.has(c.dataset.card));
      btn.textContent = all ? 'Deselect group' : 'Select group';
    }
  });
  draw();
}
