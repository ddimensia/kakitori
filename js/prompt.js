// What the learner sees: meaning/readings for kanji, romaji for kana.

import { esc } from './ui.js';
import { promptFor } from './state.js';

/** A reading; KANJIDIC marks okurigana after a dot (はや.い), shown lighter. */
function readingMarkup(reading) {
  const i = reading.indexOf('.');
  if (i < 0) return esc(reading);
  return `${esc(reading.slice(0, i))}<span class="okuri">${esc(reading.slice(i + 1))}</span>`;
}

function readingList(list) {
  return list.map((r) => (r.primary ? `<b>${readingMarkup(r.reading)}</b>` : readingMarkup(r.reading))).join('、');
}

function contextWord(subject, char, pick, reveal) {
  const words = subject.words || [];
  if (!words.length) return '';
  const w = words[pick % words.length];
  const blanked = [...w.w]
    .map((c) => (c !== char ? esc(c) : reveal ? `<mark class="target">${esc(c)}</mark>` : '<span class="blank" aria-label="blank"></span>'))
    .join('');
  return `<p class="context"><span class="context-word" lang="ja">${blanked}</span>
    <span class="context-reading" lang="ja">${esc(w.r)}</span>
    <span class="context-meaning">${esc(w.m)}</span></p>`;
}

/**
 * @param {object} card
 * @param {{reveal?: boolean, strokeCount?: number|null, contextPick?: number, showContext?: boolean}} opts
 */
export function promptMarkup(card, { reveal = false, strokeCount = null, contextPick = 0, showContext = true, showAnswerChar = true } = {}) {
  const p = promptFor(card);
  const count = strokeCount ? `<p class="stroke-count">${strokeCount} stroke${strokeCount === 1 ? '' : 's'}</p>` : '';
  const revealed = reveal && showAnswerChar ? `<p class="answer-char" lang="ja">${esc(card.char)}</p>` : '';
  if (p.kind === 'kanji') {
    const s = p.subject;
    if (!s) {
      return `<div class="prompt-kind"><span>Kanji</span></div><p class="meaning">No meaning or reading data for this kanji.</p>${revealed}`;
    }
    const [primary, ...rest] = s.meanings;
    const r = s.readings || {};
    const rows = [
      r.onyomi?.length ? `<dt>On’yomi</dt><dd lang="ja">${readingList(r.onyomi)}</dd>` : '',
      r.kunyomi?.length ? `<dt>Kun’yomi</dt><dd lang="ja">${readingList(r.kunyomi)}</dd>` : '',
    ].join('');
    return `<div class="prompt-kind"><span>Kanji</span><span class="level">${esc(s.levelLabel)}</span></div>
      <p class="meaning">${esc(primary || '')}</p>
      ${rest.length ? `<p class="alt-meanings">${esc(rest.join(', '))}</p>` : ''}
      ${rows ? `<dl class="readings">${rows}</dl>` : ''}
      ${showContext ? contextWord(s, card.char, contextPick, reveal) : ''}
      ${count}${revealed}`;
  }
  const k = p.kana;
  return `<div class="prompt-kind kana-${esc(card.kind)}"><span>${card.kind === 'hiragana' ? 'Hiragana' : 'Katakana'}</span></div>
    <p class="romaji">${esc(k?.romaji || '')}</p>
    ${k?.note ? `<p class="kana-note">${esc(k.note)}</p>` : ''}
    ${count}${revealed}`;
}

/** Short one-line description, used in lists and dialogs. */
export function shortGloss(card) {
  const p = promptFor(card);
  if (p.kind === 'kanji') return p.subject?.meanings?.[0] || '';
  return p.kana ? `${p.kana.romaji}${p.kana.note ? ` (${p.kana.note})` : ''}` : '';
}
