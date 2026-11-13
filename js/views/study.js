// Review sessions, free practice, and lessons (study → trace → quiz).

import { Writer } from '../writer.js';
import { Session } from '../session.js';
import { StrokePlayer } from '../glyphview.js';
import { getGlyph, prefetchGlyphs } from '../strokes.js';
import { promptMarkup } from '../prompt.js';
import { markIntroduced, state } from '../state.js';
import { esc, markSvg, plural } from '../ui.js';

/**
 * Run a session in `view`.
 * @param {HTMLElement} view
 * @param {Session} session
 * @param {{onExit:()=>void, setKeys:(fn)=>void, nextLessons?:()=>(null|{count:number, batch:number, start:()=>void})}} ctx
 *   nextLessons, during lessons, says whether more lessons follow this batch's quiz.
 */
function fresh(view) {
  const root = document.createElement('div');
  root.className = 'view-root';
  view.replaceChildren(root);
  return root;
}

export function runSession(parent, session, ctx) {
  const view = fresh(parent);
  view.innerHTML = `
    <section class="study">
      <header class="study-bar">
        <h1 class="study-title">${esc(session.title)}</h1>
        <div class="progress" role="progressbar" aria-label="Session progress" aria-valuemin="0"><i></i></div>
        <p class="study-count"></p>
        <button class="btn quiet" data-act="undo-answer" hidden>Undo<span class="long"> last grade</span></button>
        <button class="btn quiet" data-act="end">End<span class="long"> session</span></button>
      </header>
      <div class="desk-host"></div>
    </section>`;
  const host = view.querySelector('.desk-host');
  let writer = null;
  prefetchGlyphs([...session.queue].map((c) => c.char));

  function updateBar() {
    const done = session.finished;
    const total = done + session.remaining;
    const bar = view.querySelector('.progress');
    bar.querySelector('i').style.width = `${total ? (100 * done) / total : 100}%`;
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(done));
    view.querySelector('.study-count').textContent = `${session.remaining} left`;
    view.querySelector('[data-act="undo-answer"]').hidden = session.history.length === 0;
  }

  async function show(card) {
    writer?.destroy();
    writer = null;
    if (!card) { summary(); return; }
    const w = new Writer(host, {
      card,
      mode: 'recall',
      scheduled: session.scheduled,
      onRate: async (rating, details) => {
        await session.answer(rating, details);
        show(session.next());
      },
    });
    writer = w;
    await w.init();
    updateBar();
  }

  function summary() {
    ctx.setKeys(null);
    const s = session.summary();
    const firstGrades = new Map();
    for (const h of session.history) if (!firstGrades.has(h.card.id)) firstGrades.set(h.card.id, h);
    const missed = [...firstGrades.values()].filter((h) => h.rating <= 2).map((h) => h.card);
    const more = ctx.nextLessons?.() || null;
    view.querySelector('.study-bar').hidden = true;
    host.innerHTML = s.reviewed === 0
      ? `<div class="summary"><h2>Nothing to review right now.</h2><button class="btn primary" data-act="end">Back to today</button></div>`
      : `<div class="summary">
          <h2>Session finished</h2>
          <p class="summary-line">${s.passed} of ${plural(s.cards, 'character')} recalled on the first try, ${plural(s.reviewed, 'answer')} in total.</p>
          <ul class="summary-sheet">${[...firstGrades.values()].map((h) => `
            <li class="cell"><span lang="ja">${esc(h.card.char)}</span>${markSvg(h.rating, { cls: 'cell-mark' })}</li>`).join('')}
          </ul>
          <div class="summary-actions">
            ${missed.length ? `<button class="btn" data-act="practice-missed">Practice the ${plural(missed.length, 'miss', 'misses')} again</button>` : ''}
            <button class="btn${more ? '' : ' primary'}" data-act="end">Back to today</button>
            ${more ? `<button class="btn primary" data-act="next-lessons">Learn ${more.batch} more</button>` : ''}
          </div>
          ${more && more.count > more.batch ? `<p class="summary-line sub">${more.count - more.batch} more after that.</p>` : ''}
        </div>`;
    host.querySelector('[data-act="next-lessons"]')?.addEventListener('click', () => { writer?.destroy(); more.start(); });
    if (more) host.querySelector('[data-act="next-lessons"]').focus({ preventScroll: true });
    host.querySelector('[data-act="practice-missed"]')?.addEventListener('click', () => {
      const s2 = new Session(missed, { scheduled: false, title: 'Extra practice' });
      runSession(parent, s2, ctx);
    });
  }

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'end') { writer?.destroy(); ctx.onExit(); }
    if (b.dataset.act === 'undo-answer') {
      const card = await session.undo();
      if (card) { writer?.destroy(); writer = null; await show(card); }
    }
  });

  ctx.setKeys((e) => writer?.handleKey(e));
  show(session.next());
  return () => writer?.destroy();
}

/** Lessons: for each new card, watch the stroke order, trace it, then quiz the batch from memory. */
export function runLessons(parent, cards, ctx) {
  const view = fresh(parent);
  let i = 0;
  let writer = null;
  let player = null;
  prefetchGlyphs(cards.map((c) => c.char));

  view.innerHTML = `
    <section class="study">
      <header class="study-bar">
        <h1 class="study-title">Lessons</h1>
        <div class="progress" aria-hidden="true"><i></i></div>
        <p class="study-count"></p>
        <button class="btn quiet" data-act="end">End<span class="long"> lessons</span></button>
      </header>
      <div class="desk-host"></div>
    </section>`;
  const host = view.querySelector('.desk-host');

  function bar(step) {
    view.querySelector('.progress i').style.width = `${(100 * (i + (step === 'trace' ? 0.5 : 0))) / cards.length}%`;
    view.querySelector('.study-count').textContent = `${i + 1} of ${cards.length}`;
  }

  async function study() {
    writer?.destroy(); writer = null;
    if (i >= cards.length) { quizIntro(); return; }
    const card = cards[i];
    bar('study');
    const glyph = await getGlyph(card.char);
    host.innerHTML = `
      <div class="desk is-study">
        <section class="prompt-col">
          <div class="prompt">${promptMarkup(card, { strokeCount: glyph?.paths.length, reveal: true, showContext: state.settings.vocabContext })}</div>
          <p class="study-tip">Watch the order and direction of each stroke. Numbers mark where each stroke starts.</p>
        </section>
        <section class="work-col">
          <div class="pad-frame"><div class="player-host pad"></div></div>
          <div class="tools">
            <button class="btn quiet" data-act="replay">Replay</button>
            <button class="btn quiet" data-act="skip">I know this one</button>
            <button class="btn primary" data-act="trace">Trace it</button>
          </div>
        </section>
      </div>`;
    if (glyph) {
      player = new StrokePlayer(host.querySelector('.player-host'), glyph, { numbers: true });
      player.play();
    } else {
      host.querySelector('.player-host').innerHTML = `<p class="model-fallback" lang="ja">${esc(card.char)}</p>`;
      host.querySelector('[data-act="trace"]').textContent = 'Next';
    }
    host.querySelector('[data-act="trace"]').focus({ preventScroll: true });
    ctx.setKeys((e) => { if (e.key === 'Enter') { e.preventDefault(); glyph ? trace() : next(); } });
  }

  async function trace() {
    player?.stop();
    const card = cards[i];
    bar('trace');
    writer = new Writer(host, { card, mode: 'trace', onContinue: () => next() });
    await writer.init();
    ctx.setKeys((e) => writer?.handleKey(e));
  }

  async function next() {
    await markIntroduced(cards[i]);
    i++;
    study();
  }

  function quizIntro() {
    view.querySelector('.progress i').style.width = '100%';
    host.innerHTML = `
      <div class="summary">
        <h2>Now write them from memory</h2>
        <p class="summary-line">You’ll see each prompt without the model. Your grades start the review schedule for these characters.</p>
        <ul class="summary-sheet">${cards.map((c) => `<li class="cell"><span lang="ja">${esc(c.char)}</span></li>`).join('')}</ul>
        <div class="summary-actions"><button class="btn primary" data-act="quiz">Start the quiz</button></div>
      </div>`;
    host.querySelector('[data-act="quiz"]').focus({ preventScroll: true });
    ctx.setKeys((e) => { if (e.key === 'Enter') { e.preventDefault(); startQuiz(); } });
  }

  function startQuiz() {
    const s = new Session(cards.filter((c) => c.introducedAt), { scheduled: true, title: 'Lesson quiz' });
    runSession(parent, s, ctx);
  }

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'end') {
      writer?.destroy();
      // Characters already traced stay introduced and show up in reviews.
      ctx.onExit();
    } else if (act === 'replay') player?.play();
    else if (act === 'trace') { if (host.querySelector('.player-host svg')) trace(); else next(); }
    else if (act === 'skip') next();
    else if (act === 'quiz') startQuiz();
  });

  study();
  return () => writer?.destroy();
}
