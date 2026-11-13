// Character sheet (grid of practice squares), the per-character detail dialog, marking
// characters as already known, and the Characters page with group selection.

import { state, setSuspended, resetCard, kanjiInfo, groupFor, markKnown, FAMILIARITY } from '../state.js';
import { strength, STRENGTH_LABELS, formatInterval, retrievability, State } from '../srs.js';
import { getGlyph } from '../strokes.js';
import { StrokePlayer } from '../glyphview.js';
import { promptMarkup, shortGloss } from '../prompt.js';
import { esc, confirmDialog, relativeTime, toast, plural } from '../ui.js';

export function cellMarkup(card, { selecting = false, selected = null } = {}) {
  const st = card.suspended ? 'suspended' : strength(card);
  const due = card.introducedAt && card.due !== null && card.due <= Date.now() && !card.suspended;
  const isSel = selecting && selected?.has(card.id);
  return `<button class="cell s-${st}${due ? ' is-due' : ''}${isSel ? ' is-selected' : ''}" data-card="${esc(card.id)}"${selecting ? ` aria-pressed="${isSel}"` : ''} title="${esc(`${card.char} ${shortGloss(card)}: ${STRENGTH_LABELS[st] || 'Suspended'}`)}"><span lang="ja">${esc(card.char)}</span></button>`;
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
    const { key, label } = groupFor(c);
    if (!by.has(key)) { const g = { key, label, cards: [] }; by.set(key, g); groups.push(g); }
    by.get(key).cards.push(c);
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  for (const g of groups) g.cards.sort((a, b) => a.order - b.order);
  return groups;
}

/**
 * @param {object[]} cards
 * @param {{groupActions?: boolean, selecting?: boolean, selected?: Set<string>}} [opts]
 *   groupActions adds a select button to each group heading (Characters page).
 */
export function sheetMarkup(cards, { groupActions = false, selecting = false, selected = null } = {}) {
  if (!cards.length) return '<p class="empty">No characters match.</p>';
  return groupCards(cards)
    .map((g) => {
      const allSel = selecting && g.cards.every((c) => selected.has(c.id));
      const action = groupActions
        ? `<button class="link group-select" data-group="${esc(g.key)}">${allSel ? 'Deselect group' : 'Select group'}</button>`
        : '';
      return `<section class="sheet-group"><h3>${esc(g.label)} <span class="count">${g.cards.length}</span>${action}</h3>
        <div class="cell-grid">${g.cards.map((c) => cellMarkup(c, { selecting, selected })).join('')}</div></section>`;
    })
    .join('');
}

/**
 * Ask how well the given cards are known.
 * @returns {Promise<null | {level: string, overwrite: boolean}>}
 */
export function familiarityDialog(cards) {
  return new Promise((resolve) => {
    const studied = cards.filter((c) => c.introducedAt).length;
    const single = cards.length === 1;
    const title = single ? `How well do you know ${cards[0].char}?` : `Mark ${plural(cards.length, 'character')} as known`;
    const d = document.createElement('dialog');
    d.className = 'dialog familiar';
    d.innerHTML = `<form method="dialog">
      <h2>${esc(title)}</h2>
      <p class="help">${single ? 'It' : 'They'} skip${single ? 's' : ''} lessons and go straight into reviews.${single ? '' : ' Reviews are spread out so they don’t all come back on the same day.'} A review you miss sends ${single ? 'it' : 'that character'} back into relearning.</p>
      <fieldset class="levels">
        <legend class="sr-only">Familiarity</legend>
        ${FAMILIARITY.map((f, i) => `<label class="level"><input type="radio" name="level" value="${f.id}" ${i === 2 ? 'checked' : ''}>
          <span class="level-name">${esc(f.label)}</span><span class="level-help">${esc(f.help)}</span></label>`).join('')}
      </fieldset>
      ${studied && !single ? `<label class="check"><input type="checkbox" name="overwrite"> Also reschedule the ${plural(studied, 'character')} you’ve already studied</label>` : ''}
      ${studied && single ? '<p class="help">This replaces its current schedule. Its review history is kept.</p>' : ''}
      <div class="dialog-actions">
        <button class="btn" value="cancel">Cancel</button>
        <button class="btn primary" value="ok">Mark as known</button>
      </div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => {
      const form = d.querySelector('form');
      const out = d.returnValue === 'ok'
        ? { level: form.elements.level.value, overwrite: single || !!form.elements.overwrite?.checked }
        : null;
      d.remove();
      resolve(out);
    });
    d.showModal();
  });
}

/** Ask, apply and offer an undo. Returns the number of cards changed. */
export async function markCardsKnown(cards, onChange) {
  const choice = await familiarityDialog(cards);
  if (!choice) return 0;
  const { count, undo } = await markKnown(cards, choice.level, { overwrite: choice.overwrite });
  const label = FAMILIARITY.find((f) => f.id === choice.level).label.toLowerCase();
  if (count === 0) {
    toast('Nothing changed: those characters are already studied.');
  } else {
    toast(cards.length === 1 ? `${cards[0].char} marked as “${label}”.` : `${plural(count, 'character')} marked as “${label}”.`, {
      action: { label: 'Undo', onClick: async () => { await undo(); toast('Undone.'); onChange(); } },
    });
  }
  onChange();
  return count;
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
    if (card.markedKnown) {
      const f = FAMILIARITY.find((x) => x.id === card.markedKnown.level);
      rows.push(['Marked as known', `${f ? f.label : 'Yes'}, ${new Date(card.markedKnown.at).toLocaleDateString()}`]);
    }
  }
  return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

/** Detail dialog for one card. `onPractice(card)` starts free practice. */
export async function openCardDetail(card, { onPractice, onChange = () => {} }) {
  const glyph = await getGlyph(card.char);
  const info = card.kind === 'kanji' ? kanjiInfo(card.char) : null;
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
        ${info?.url ? `<p><a href="${esc(info.url)}" target="_blank" rel="noopener">${esc(info.urlLabel)}</a></p>` : ''}
      </div>
    </div>
    <div class="dialog-actions">
      ${glyph ? '<button class="btn quiet" data-act="replay">Replay</button>' : ''}
      <button class="btn quiet" data-act="known">Mark as known…</button>
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
    else if (act === 'known') { d.close(); await markCardsKnown([card], onChange); }
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
  let selecting = false;
  const selected = new Set();
  let shown = [];

  view.innerHTML = `
    <section class="page characters">
      <header class="page-head">
        <h1>Characters</h1>
        <p class="page-sub">Every character you can practice. Select one to see its stroke order and schedule, or select several to mark them as already known.</p>
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
        <label class="field-inline search">Search <input type="search" placeholder="Meaning, reading, romaji or character" data-q></label>
        <button class="btn" data-act="select-mode" aria-pressed="false">Select</button>
      </div>
      <p class="result-count" aria-live="polite"></p>
      <div class="sheet"></div>
      ${legendMarkup()}
      <div class="select-bar" hidden role="region" aria-label="Selection">
        <p class="select-count" aria-live="polite"></p>
        <button class="btn quiet" data-act="select-shown">Select all shown</button>
        <button class="btn quiet" data-act="select-clear">Clear</button>
        <span class="spacer"></span>
        <button class="btn" data-act="select-done">Done</button>
        <button class="btn primary" data-act="mark-known" disabled>Mark as known…</button>
      </div>
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
      const info = c.kind === 'kanji' ? kanjiInfo(c.char) : null;
      const hay = info
        ? [...info.meanings, ...Object.values(info.readings || {}).flat().map((r) => r.reading.replace('.', '')), ...info.words.map((w) => w.w)]
        : [shortGloss(c)];
      const qk = q.replace(/[ぁ-ゖ]/g, (m) => String.fromCharCode(m.charCodeAt(0) + 0x60)); // on'yomi are in katakana
      return hay.some((h) => { const l = h.toLowerCase(); return l.includes(q) || l.includes(qk); });
    }
    return true;
  }

  function updateBar() {
    const bar = view.querySelector('.select-bar');
    bar.hidden = !selecting;
    view.querySelector('.select-count').textContent = `${plural(selected.size, 'character')} selected`;
    view.querySelector('[data-act="mark-known"]').disabled = selected.size === 0;
    const toggle = view.querySelector('[data-act="select-mode"]');
    toggle.setAttribute('aria-pressed', String(selecting));
    toggle.textContent = selecting ? 'Stop selecting' : 'Select';
    view.querySelector('.characters').classList.toggle('is-selecting', selecting);
  }

  function draw() {
    shown = [...state.cards.values()].filter(matches);
    view.querySelector('.result-count').textContent = `${shown.length} character${shown.length === 1 ? '' : 's'}`;
    view.querySelector('.sheet').innerHTML = sheetMarkup(shown, { groupActions: true, selecting, selected });
    updateBar();
  }

  function setSelecting(v) {
    selecting = v;
    if (!v) selected.clear();
    draw();
  }

  view.addEventListener('click', async (e) => {
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
      const all = selecting && ids.every((id) => selected.has(id));
      selecting = true;
      for (const id of ids) all ? selected.delete(id) : selected.add(id);
      draw();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'select-mode') { setSelecting(!selecting); return; }
    if (act === 'select-done') { setSelecting(false); return; }
    if (act === 'select-clear') { selected.clear(); draw(); return; }
    if (act === 'select-shown') { for (const c of shown) selected.add(c.id); draw(); return; }
    if (act === 'mark-known') {
      const cards = [...selected].map((id) => state.cards.get(id)).filter(Boolean);
      const n = await markCardsKnown(cards, draw);
      if (n) setSelecting(false);
      return;
    }
    const cell = e.target.closest('[data-card]');
    if (!cell) return;
    if (selecting) {
      const id = cell.dataset.card;
      selected.has(id) ? selected.delete(id) : selected.add(id);
      cell.classList.toggle('is-selected', selected.has(id));
      cell.setAttribute('aria-pressed', String(selected.has(id)));
      updateBar();
      // keep each group's "Select group" label in step
      const section = cell.closest('.sheet-group');
      const btn = section?.querySelector('.group-select');
      if (btn) {
        const all = [...section.querySelectorAll('[data-card]')].every((c) => selected.has(c.dataset.card));
        btn.textContent = all ? 'Deselect group' : 'Select group';
      }
    } else {
      openCardDetail(state.cards.get(cell.dataset.card), { onPractice, onChange: draw });
    }
  });
  view.querySelector('[data-status]').addEventListener('change', (e) => { status = e.target.value; draw(); });
  view.querySelector('[data-q]').addEventListener('input', (e) => { query = e.target.value.trim(); draw(); });
  draw();
}
