// The writing desk for one card: prompt, practice square, tools, grading feedback and ratings.

import { DrawingPad } from './pad.js';
import { getGlyph } from './strokes.js';
import { gradeAttempt } from './grader.js';
import { recognizeStrokes } from './recognizer.js';
import { StrokePlayer, glyphPaths, hintMarkup } from './glyphview.js';
import { promptMarkup } from './prompt.js';
import { preview, newSrsCard, formatInterval } from './srs.js';
import { state } from './state.js';
import { esc, markSvg, MARK_NAMES, plural } from './ui.js';

const VERDICTS = {
  1: 'Not yet. Study the model and it will come back soon.',
  2: 'Close. It will come back a little sooner.',
  3: 'Well written.',
  4: 'Clean and quick.',
};

function polyline(pts) {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

/** Overlay comparing the (aligned) drawing with the model. */
function overlayMarkup(glyph, result) {
  let s = `<defs><marker id="ov-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" class="ov-arrowhead"/></marker></defs>`;
  s += `<g class="ov-ref">${glyphPaths(glyph, 'ov-ref-stroke')}</g>`;
  result.refInfo.forEach((r, j) => {
    if (r.user < 0) s += `<path class="ov-missing" d="${glyph.paths[j]}"/>`;
  });
  result.aligned.forEach((pts, i) => {
    const u = result.userInfo[i];
    const cls = u.ref < 0 ? 'bad' : u.quality >= 0.7 ? 'good' : u.quality >= 0.45 ? 'fair' : 'bad';
    s += `<polyline class="ov-user ${cls}${u.reversed ? ' reversed' : ''}" points="${polyline(pts)}"${u.reversed ? ' marker-end="url(#ov-arrow)"' : ''}/>`;
  });
  result.aligned.forEach((pts, i) => {
    const u = result.userInfo[i];
    const [x, y] = pts[0];
    s += `<text class="ov-num${u.outOfOrder ? ' wrong' : ''}" x="${(x - 3.5).toFixed(1)}" y="${(y - 2).toFixed(1)}">${i + 1}</text>`;
  });
  return s;
}

export class Writer {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {object} o.card
   * @param {'recall'|'trace'} [o.mode]
   * @param {boolean} [o.scheduled]
   * @param {(rating:number, details:object)=>void} [o.onRate]   recall mode
   * @param {(result:object)=>void} [o.onContinue]               trace mode
   */
  constructor(root, { card, mode = 'recall', scheduled = true, onRate = () => {}, onContinue = () => {} }) {
    this.root = root;
    this.card = card;
    this.mode = mode;
    this.scheduled = scheduled;
    this.onRate = onRate;
    this.onContinue = onContinue;
    this.hints = 0;
    this.phase = 'writing'; // writing | grading | graded
    this.suggested = null;
    this.selected = null;
    this.result = null;
    this.contextPick = Math.floor(Math.random() * 4);
    this.timers = [];
  }

  async init() {
    this.glyph = await getGlyph(this.card.char);
    const settings = state.settings;
    const n = this.glyph ? this.glyph.paths.length : null;
    const showCount = this.mode === 'trace' || settings.showStrokeCount;
    // A fresh element per card, so event listeners never outlive their card.
    this.el = document.createElement('div');
    this.el.className = 'writer';
    this.root.replaceChildren(this.el);
    this.el.innerHTML = `
      <div class="desk ${this.mode === 'trace' ? 'is-trace' : ''}">
        <section class="prompt-col">
          <div class="prompt">${promptMarkup(this.card, { strokeCount: showCount ? n : null, contextPick: this.contextPick, showContext: settings.vocabContext, reveal: this.mode === 'trace' })}</div>
          <div class="feedback" hidden></div>
        </section>
        <section class="work-col">
          <div class="pad-frame">
            <div class="pad-host"></div>
            <div class="mark-slot"></div>
          </div>
          <div class="tools">
            <button class="btn quiet" data-act="undo" title="Undo last stroke (Backspace)">Undo</button>
            <button class="btn quiet" data-act="clear" title="Clear (Esc)">Clear</button>
            ${this.mode === 'recall' ? '<button class="btn quiet" data-act="hint" title="Show the next stroke (H)">Hint</button><button class="btn quiet" data-act="reveal">Show answer</button>' : ''}
            <button class="btn primary" data-act="check" disabled title="Check (Enter)">Check</button>
          </div>
          <div class="ratings" hidden></div>
          <div class="trace-actions" hidden>
            <button class="btn" data-act="again">Trace again</button>
            <button class="btn primary" data-act="continue">Continue</button>
          </div>
          <p class="kbd-hint">${this.mode === 'recall' ? 'Enter checks your writing. Then 1–4 grades, or Enter accepts the suggestion.' : 'Trace over the model in stroke order, then check.'}</p>
        </section>
      </div>`;
    this.$ = (sel) => this.el.querySelector(sel);
    this.pad = new DrawingPad(this.$('.pad-host'), {
      penOnly: settings.penOnly,
      onChange: (strokes) => {
        this.$('[data-act="check"]').disabled = strokes.length === 0;
      },
    });
    if (this.mode === 'trace' && this.glyph) this.pad.setUnderlay(`<g class="trace-guide">${glyphPaths(this.glyph, 'trace-stroke')}</g>`);
    if (!this.glyph) this.$('[data-act="hint"]')?.setAttribute('disabled', '');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !this.el.contains(b)) return;
      if (b.dataset.act) this.act(b.dataset.act);
      if (b.dataset.r) this.choose(Number(b.dataset.r), true);
    });
    this.shownAt = performance.now();
  }

  destroy() {
    this.timers.forEach(clearTimeout);
    this.player?.stop();
    this.pad?.destroy();
  }

  act(a) {
    if (a === 'undo' && this.phase === 'writing') this.pad.undo();
    else if (a === 'clear' && this.phase === 'writing') this.pad.clear();
    else if (a === 'hint' && this.phase === 'writing') this.hint();
    else if (a === 'reveal' && this.phase === 'writing') this.check(true);
    else if (a === 'check' && this.phase === 'writing') this.check(false);
    else if (a === 'again') this.retry();
    else if (a === 'continue') this.onContinue(this.result);
    else if (a === 'replay') this.player?.play();
    else if (a === 'retry-alt') this.retry();
  }

  handleKey(e) {
    if (e.target.closest('input, textarea, select')) return;
    const k = e.key;
    if (this.phase === 'writing') {
      if (k === 'Enter') { e.preventDefault(); if (this.pad.strokes.length) this.check(false); }
      else if (k === 'Backspace' || (k.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.pad.undo(); }
      else if (k === 'Escape') this.pad.clear();
      else if (k.toLowerCase() === 'h' && this.mode === 'recall') this.hint();
    } else if (this.phase === 'graded') {
      if (this.mode === 'recall') {
        if (['1', '2', '3', '4'].includes(k)) { e.preventDefault(); this.choose(Number(k), true); }
        else if (k === 'Enter' || k === ' ') { e.preventDefault(); this.choose(this.selected ?? this.suggested ?? 3, true); }
      } else if (k === 'Enter') { e.preventDefault(); this.onContinue(this.result); }
    }
  }

  hint() {
    if (!this.glyph) return;
    this.hints++;
    const i = Math.min(this.pad.strokes.length, this.glyph.paths.length - 1);
    const markup = this.pad.strokes.length >= this.glyph.paths.length
      ? `<g class="hint-all">${glyphPaths(this.glyph, 'hint-stroke')}</g>`
      : hintMarkup(this.glyph, i);
    this.pad.setUnderlay(`<g class="hint">${markup}</g>`);
    this.timers.push(setTimeout(() => this.pad.setUnderlay(''), 1800));
  }

  async check(gaveUp) {
    this.phase = 'grading';
    this.pad.setLocked(true);
    this.$('.tools').classList.add('is-busy');
    const strokes = gaveUp ? [] : this.pad.strokes.map((s) => s.slice());
    const thinkMs = this.pad.firstStrokeAt ? this.pad.firstStrokeAt - this.shownAt : null;

    if (!this.glyph) {
      this.result = { score: null, suggested: gaveUp ? 1 : null, issues: ['No stroke data for this character, so grade yourself.'], recognised: null };
      this.showFeedback(gaveUp);
      return;
    }
    const recognition = strokes.length && this.mode === 'recall' ? await recognizeStrokes(strokes, this.card.char, this.glyph.points) : null;
    if (this.phase !== 'grading') return; // destroyed or reset meanwhile
    // Easy is only suggested for characters already in long-term review.
    const allowEasy = !!this.card.srs && this.card.srs.state === 2;
    this.result = gradeAttempt({ userStrokes: strokes, glyph: this.glyph, strictness: state.settings.strictness, hints: this.hints, gaveUp, recognition, thinkMs, allowEasy });
    this.alternate = this.mode === 'recall' && !gaveUp ? this.findAlternate(recognition) : null;
    this.showFeedback(gaveUp);
  }

  /** A different kanji you know that shares a meaning: let the learner try again without penalty. */
  findAlternate(rec) {
    if (!rec || rec.rank === 0 || !rec.candidates.length || this.card.kind !== 'kanji') return null;
    const top = rec.candidates[0][0];
    const other = state.subjects.get(top);
    const mine = state.subjects.get(this.card.char);
    if (!other || !mine || !(other.srsStage >= 1)) return null;
    const a = new Set(mine.meanings.map((m) => m.toLowerCase()));
    const shared = other.meanings.find((m) => a.has(m.toLowerCase()));
    return shared ? { char: top, meaning: shared } : null;
  }

  showFeedback(gaveUp) {
    this.phase = 'graded';
    const r = this.result;
    this.$('.tools').hidden = true;
    this.$('.tools').classList.remove('is-busy');
    this.$('.kbd-hint').hidden = this.mode !== 'recall';

    if (this.glyph) {
      this.pad.setInkHidden(true);
      this.pad.setUnderlay('');
      this.pad.setOverlay(gaveUp ? `<g class="ov-ref answer">${glyphPaths(this.glyph, 'ov-answer-stroke')}</g>` : overlayMarkup(this.glyph, r));
    }

    const fb = this.$('.feedback');
    fb.hidden = false;
    const recog = r.recognised
      ? `<p class="recog">Recognizer’s top reads: <span lang="ja">${r.recognised.candidates.map((c) => esc(c)).join(' ')}</span></p>`
      : '';
    const alt = this.alternate
      ? `<div class="alt-note"><p>You wrote <span lang="ja" class="alt-char">${esc(this.alternate.char)}</span>, which also means “${esc(this.alternate.meaning)}”. This card wants a different kanji.</p>
         <button class="btn" data-act="retry-alt">Try again</button></div>`
      : '';
    // When a different known kanji with the same meaning was written, the stroke-by-stroke
    // issues are noise: show only the note and the model.
    const details = this.alternate
      ? ''
      : `${r.score != null ? `<p class="score"><span class="num">${r.score}</span><span class="of">/ 100</span></p>` : ''}
        <p class="verdict-line"></p>
        ${r.issues.length ? `<ul class="issues">${r.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="issues-none">Stroke count, order and direction all match.</p>'}
        ${recog}`;
    fb.innerHTML = `
      ${alt}
      <div class="model-wrap">
        <div class="model" aria-label="Model answer"></div>
        ${this.glyph ? '<button class="btn quiet" data-act="replay">Replay stroke order</button>' : ''}
      </div>
      <div class="verdict">${details || '<p class="verdict-line"></p>'}</div>`;
    if (this.glyph) {
      this.player = new StrokePlayer(fb.querySelector('.model'), this.glyph, { numbers: true });
      if (gaveUp || this.alternate || r.score < 90) this.player.play();
    } else {
      fb.querySelector('.model').innerHTML = `<p class="model-fallback" lang="ja">${esc(this.card.char)}</p>`;
    }

    // On narrow screens the pad sits below the prompt: bring the marked-up pad and grades into view.
    if (window.matchMedia('(max-width: 860px)').matches) {
      this.$('.work-col').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }

    if (this.mode === 'trace') {
      this.$('.trace-actions').hidden = false;
      const e = r.errors;
      const clean = e.order + e.direction + e.missing + e.extra === 0;
      fb.querySelector('.verdict-line').textContent = clean && r.score >= 75
        ? 'Good tracing. Ready for the next step.'
        : 'Check the order and direction in the model, then trace again.';
      const mark = !clean ? Math.min(2, r.score >= 50 ? 2 : 1) : r.score >= 90 ? 4 : r.score >= 75 ? 3 : r.score >= 50 ? 2 : 1;
      this.$('.mark-slot').innerHTML = markSvg(mark, { animate: true });
      this.$('[data-act="continue"]').focus({ preventScroll: true });
      return;
    }

    this.renderRatings();
    if (r.suggested != null) this.choose(r.suggested, false);
    else fb.querySelector('.verdict-line').textContent = 'Compare with the model, then grade yourself.';
    if (this.alternate) fb.querySelector('.verdict-line').textContent = 'Try again, or grade it as a miss.';
  }

  renderRatings() {
    let times = null;
    if (this.scheduled) {
      const now = new Date();
      const p = preview(this.card.srs || newSrsCard(now), now);
      times = Object.fromEntries(Object.entries(p).map(([g, due]) => [g, formatInterval(due - now.getTime())]));
    }
    const el = this.$('.ratings');
    el.hidden = false;
    el.innerHTML = [1, 2, 3, 4]
      .map((g) => `<button class="rate" data-r="${g}" aria-pressed="false">
        ${markSvg(g, { cls: 'rate-mark' })}
        <span class="rate-name">${MARK_NAMES[g]}</span>
        <span class="rate-time">${times ? esc(times[g]) : g <= 2 ? 'again soon' : 'done'}</span>
        <span class="rate-key" aria-hidden="true">${g}</span>
      </button>`)
      .join('');
    if (this.result.suggested) {
      el.querySelector(`[data-r="${this.result.suggested}"]`).classList.add('is-suggested');
    }
  }

  /**
   * Show a grade as selected (the suggestion starts selected). With submit=true the grade is
   * recorded: clicking a grade button or pressing 1–4 submits directly, Enter submits the selection.
   */
  choose(g, submit) {
    if (this.phase !== 'graded' || this.mode !== 'recall') return;
    if (submit) {
      this.phase = 'done';
      this.onRate(g, { score: this.result.score, suggested: this.result.suggested, hints: this.hints });
      return;
    }
    this.selected = g;
    this.el.querySelectorAll('.rate').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.r) === g)));
    this.$('.mark-slot').innerHTML = markSvg(g, { animate: true });
    const line = this.$('.verdict-line');
    if (line) line.textContent = this.result.suggested == null ? 'Compare with the model, then grade yourself.' : VERDICTS[g];
  }

  retry() {
    this.phase = 'writing';
    this.player?.stop();
    this.result = null;
    this.alternate = null;
    this.$('.feedback').hidden = true;
    this.$('.ratings').hidden = true;
    this.$('.trace-actions').hidden = true;
    this.$('.tools').hidden = false;
    this.$('.kbd-hint').hidden = false;
    this.$('.mark-slot').innerHTML = '';
    this.pad.reset();
    if (this.mode === 'trace' && this.glyph) this.pad.setUnderlay(`<g class="trace-guide">${glyphPaths(this.glyph, 'trace-stroke')}</g>`);
    this.$('[data-act="check"]').disabled = true;
    this.shownAt = performance.now();
  }
}

export { plural };
