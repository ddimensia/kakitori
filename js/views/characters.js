// Character sheet (grid of practice squares) and the per-character detail dialog.

import { state, setSuspended, resetCard, kindLabel } from '../state.js';
import { strength, STRENGTH_LABELS, formatInterval, retrievability, State } from '../srs.js';
import { getGlyph } from '../strokes.js';
import { StrokePlayer } from '../glyphview.js';
import { promptMarkup, shortGloss } from '../prompt.js';
import { esc, confirmDialog, relativeTime, toast } from '../ui.js';

export function cellMarkup(card) {
  const st = card.suspended ? 'suspended' : strength(card);
  const due = card.introducedAt && card.due !== null && card.due <= Date.now() && !card.suspended;
  return `<button class="cell s-${st}${due ? ' is-due' : ''}" data-card="${esc(card.id)}" title="${esc(`${card.char} ${shortGloss(card)}: ${STRENGTH_LABELS[st] || 'Suspended'}`)}"><span lang="ja">${esc(card.char)}</span></button>`;
}

export function legendMarkup() {
  return `<ul class="legend" aria-label="Legend">
    ${['unseen', 'learning', 'weak', 'fair', 'strong', 'solid'].map((s) => `<li><span class="cell s-${s} swatch"><span lang="ja">字</span></span>${esc(STRENGTH_LABELS[s])}</li>`).join('')}
    <li><span class="cell s-fair is-due swatch"><span lang="ja">字</span></span>Due now</li>
  </ul>`;
}

function groupCards(cards) {
  const groups = [];
  const by = new Map();
  for (const c of cards) {
    let key, label;
    if (c.kind === 'kanji') {
      const lvl = state.subjects.get(c.char)?.level ?? 0;
      key = `k${String(lvl).padStart(2, '0')}`;
      label = lvl ? `Kanji, level ${lvl}` : 'Kanji';
    } else {
      key = c.kind === 'hiragana' ? 'a' : 'b';
      label = kindLabel(c.kind);
    }
    if (!by.has(key)) { const g = { key, label, cards: [] }; by.set(key, g); groups.push(g); }
    by.get(key).cards.push(c);
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  for (const g of groups) g.cards.sort((a, b) => a.order - b.order);
  return groups;
}

export function sheetMarkup(cards) {
  if (!cards.length) return '<p class="empty">No characters match.</p>';
  return groupCards(cards)
    .map((g) => `<section class="sheet-group"><h3>${esc(g.label)} <span class="count">${g.cards.length}</span></h3>
      <div class="cell-grid">${g.cards.map(cellMarkup).join('')}</div></section>`)
    .join('');
}

function statRows(card) {
  const s = card.srs;
  const rows = [];
  if (card.suspended) rows.push(['Status', 'Suspended']);
  if (!card.introducedAt || !s) {
    rows.push(['Status', 'Not studied yet']);
  } else {
    const stateNames = { [State.New]: 'New', [State.Learning]: 'Learning', [State.Review]: 'Review', [State.Relearning]: 'Relearning' };
    rows.push(['Status', stateNames[s.state]]);
    rows.push(['Next review', card.due <= Date.now() ? 'Due now' : relativeTime(card.due)]);
    if (s.state !== State.New) {
      rows.push(['Memory lasts about', formatInterval(s.stability * 86400000)]);
      rows.push(['Recall chance now', `${Math.round(retrievability(s) * 100)}%`]);
      rows.push(['Difficulty', `${s.difficulty.toFixed(1)} of 10`]);
    }
    rows.push(['Reviews', `${s.reps}, forgotten ${s.lapses} time${s.lapses === 1 ? '' : 's'}`]);
    if (card.lastScore != null) rows.push(['Last score', `${card.lastScore} / 100`]);
  }
  return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

/** Detail dialog for one card. `onPractice(card)` starts free practice. */
export async function openCardDetail(card, { onPractice, onChange = () => {} }) {
  const glyph = await getGlyph(card.char);
  const sub = card.kind === 'kanji' ? state.subjects.get(card.char) : null;
  const d = document.createElement('dialog');
  d.className = 'dialog detail';
  d.setAttribute('aria-label', `${card.char} details`);
  d.innerHTML = `
    <div class="detail-grid">
      <div class="detail-model"><div class="model pad"></div>
        ${glyph ? `<p class="detail-strokes">${glyph.paths.length} stroke${glyph.paths.length === 1 ? '' : 's'}</p>` : ''}
      </div>
      <div class="detail-info">
        <div class="prompt">${promptMarkup(card, { showContext: true, reveal: true, showAnswerChar: false })}</div>
        <dl class="stats">${statRows(card)}</dl>
        ${sub?.url ? `<p><a href="${esc(sub.url)}" target="_blank" rel="noopener">Open on WaniKani</a></p>` : ''}
      </div>
    </div>
    <div class="dialog-actions">
      ${glyph ? '<button class="btn quiet" data-act="replay">Replay</button>' : ''}
      <button class="btn quiet" data-act="suspend">${card.suspended ? 'Unsuspend' : 'Suspend'}</button>
      ${card.introducedAt ? '<button class="btn quiet" data-act="reset">Reset progress</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" data-act="close">Close</button>
      <button class="btn primary" data-act="practice">Practice now</button>
    </div>`;
  document.body.appendChild(d);
  let player = null;
  if (glyph) { player = new StrokePlayer(d.querySelector('.model'), glyph, { numbers: true }); player.play(); }
  else d.querySelector('.model').innerHTML = `<p class="model-fallback" lang="ja">${esc(card.char)}</p>`;
  d.addEventListener('close', () => { player?.stop(); d.remove(); });
  d.addEventListener('click', async (e) => {
    if (e.target === d) { d.close(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') d.close();
    else if (act === 'replay') player?.play();
    else if (act === 'practice') { d.close(); onPractice(card); }
    else if (act === 'suspend') {
      await setSuspended(card, !card.suspended);
      toast(card.suspended ? `${card.char} won’t come up in lessons or reviews.` : `${card.char} is back in your reviews.`);
      d.close(); onChange();
    } else if (act === 'reset') {
      const ok = await confirmDialog({ title: `Reset ${card.char}?`, body: 'Its review history stays, but it goes back to the lesson queue.', confirm: 'Reset progress', danger: true });
      if (ok) { await resetCard(card); toast(`${card.char} is back in the lesson queue.`); d.close(); onChange(); }
    }
  });
  d.showModal();
}

/** The Characters page. */
export function renderCharacters(view, { onPractice }) {
  let kind = 'all';
  let status = 'all';
  let query = '';
  view.innerHTML = `
    <section class="page characters">
      <header class="page-head">
        <h1>Characters</h1>
        <p class="page-sub">Every character you can practice. Select one to see its stroke order and schedule.</p>
      </header>
      <div class="filters">
        <div class="seg" role="group" aria-label="Kind">
          ${[['all', 'All'], ['hiragana', 'Hiragana'], ['katakana', 'Katakana'], ['kanji', 'Kanji']].map(([v, l]) => `<button data-kind="${v}" aria-pressed="${v === kind}">${l}</button>`).join('')}
        </div>
        <label class="field-inline">Show
          <select data-status>
            <option value="all">All</option><option value="unseen">Not studied yet</option><option value="learning">Learning</option>
            <option value="due">Due now</option><option value="weak">Weakest</option><option value="suspended">Suspended</option>
          </select></label>
        <label class="field-inline search">Search <input type="search" placeholder="Meaning, romaji or character" data-q></label>
      </div>
      <p class="result-count" aria-live="polite"></p>
      <div class="sheet"></div>
      ${legendMarkup()}
    </section>`;

  function matches(c) {
    if (!c.active) return false;
    if (kind !== 'all' && c.kind !== kind) return false;
    const st = strength(c);
    if (status === 'suspended' && !c.suspended) return false;
    if (status !== 'suspended' && status !== 'all' && c.suspended) return false;
    if (status === 'unseen' && st !== 'unseen') return false;
    if (status === 'learning' && st !== 'learning') return false;
    if (status === 'due' && !(c.introducedAt && c.due <= Date.now())) return false;
    if (status === 'weak' && !(c.introducedAt && c.srs && retrievability(c.srs) < 0.85 && c.srs.state !== State.New)) return false;
    if (query) {
      const q = query.toLowerCase();
      if (c.char.includes(query)) return true;
      const sub = c.kind === 'kanji' ? state.subjects.get(c.char) : null;
      const hay = sub ? [...sub.meanings, ...Object.values(sub.readings || {}).flat().map((r) => r.reading)] : [shortGloss(c)];
      return hay.some((h) => h.toLowerCase().includes(q));
    }
    return true;
  }

  function draw() {
    const cards = [...state.cards.values()].filter(matches);
    view.querySelector('.result-count').textContent = `${cards.length} character${cards.length === 1 ? '' : 's'}`;
    view.querySelector('.sheet').innerHTML = sheetMarkup(cards);
  }

  view.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      kind = k.dataset.kind;
      view.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b === k)));
      draw();
      return;
    }
    const cell = e.target.closest('[data-card]');
    if (cell) openCardDetail(state.cards.get(cell.dataset.card), { onPractice, onChange: draw });
  });
  view.querySelector('[data-status]').addEventListener('change', (e) => { status = e.target.value; draw(); });
  view.querySelector('[data-q]').addEventListener('input', (e) => { query = e.target.value.trim(); draw(); });
  draw();
}
