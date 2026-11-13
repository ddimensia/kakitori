// Welcome page: what Kakitori is, shown on a first visit and from the footer's About link.

import { state } from '../state.js';
import { getGlyph } from '../strokes.js';
import { StrokePlayer } from '../glyphview.js';
import { markSvg } from '../ui.js';

const REPO = 'https://github.com/ddimensia/kakitori';

const STEPS = [
  { title: 'Watch it written', text: 'An animation shows the order and direction of every stroke.' },
  { title: 'Trace it', text: 'Draw over a faint guide to get the feel of the shape.' },
  { title: 'Write it from memory', text: 'You see only the meaning or reading. Your strokes are checked and marked the way a teacher’s red pen would.' },
  { title: 'Review it over time', text: 'It comes back just before you’d forget it: after a day, then days, then months. Sooner if it gave you trouble.' },
];

export function renderWelcome(view) {
  const first = !state.settings.welcomed;
  const cta = first ? 'Get started' : 'Go to today';

  view.innerHTML = `
    <article class="welcome">
      <section class="w-hero">
        <div class="w-intro">
          <h1><span class="w-title" lang="ja">書き取り</span><span class="w-name">Kakitori</span></h1>
          <p class="w-lead">Practice writing Japanese by hand. Write kana and kanji in a practice square, get your stroke order, direction and shape checked, and review each character just before you’d forget it.</p>
          <p class="w-actions"><a class="btn primary w-cta" href="#today">${cta}</a></p>
          <p class="w-note">Free, with no account. Your progress stays in this browser.</p>
        </div>
        <div class="w-demo">
          <button class="w-square" type="button" aria-label="Play the stroke order for 書 again">
            <span class="w-player"></span>
            <span class="mark-slot w-mark"></span>
          </button>
          <p class="w-caption"><span lang="ja">書</span> (to write), 10 strokes. Tap to replay.</p>
        </div>
      </section>

      <section class="w-steps" aria-labelledby="w-steps-h">
        <h2 id="w-steps-h">How each character is learned</h2>
        <ol>
          ${STEPS.map((s, i) => `<li class="w-step">
            <div class="w-step-sq" data-step="${i}"><span class="w-player"></span><span class="mark-slot w-mark"></span></div>
            <h3><span class="w-step-n">${i + 1}</span>${s.title}</h3>
            <p>${s.text}</p>
          </li>`).join('')}
        </ol>
      </section>

      <section class="w-more">
        <div>
          <h2>What you can practice</h2>
          <ul>
            <li>Hiragana and katakana, with or without dakuten.</li>
            <li>Kanji you’ve studied on WaniKani. Kakitori is an unofficial third-party app: paste a read-only WaniKani API token and it only asks for kanji you’ve already started there.</li>
            <li>Or a built-in kanji list in JLPT order (N5 to N1), Japanese school-grade order, or most frequent first.</li>
            <li>Characters you already know can be marked as known, so they come back only for occasional review.</li>
          </ul>
        </div>
        <div>
          <h2>Your notebook stays with you</h2>
          <ul>
            <li>No account and no server. Progress is saved in this browser, and you can back it up to a file.</li>
            <li>Install it from Chrome’s address bar, or add it as a Chrome extension, and it works offline.</li>
            <li>Write with a stylus, a finger or a mouse.</li>
          </ul>
        </div>
      </section>

      <section class="w-end">
        <a class="btn primary" href="#today">${cta}</a>
        <p class="w-note">Kakitori is open source under the MIT license. <a href="${REPO}" target="_blank" rel="noopener">Source code on GitHub</a></p>
      </section>
    </article>`;

  let alive = true;
  let hero = null;
  const heroMark = view.querySelector('.w-demo .w-mark');

  async function playHero() {
    if (!hero) return;
    heroMark.innerHTML = '';
    await hero.play();
    if (alive) heroMark.innerHTML = markSvg(4, { animate: true });
  }

  (async () => {
    const [kaku, ji] = await Promise.all([getGlyph('書'), getGlyph('字')]);
    if (!alive) return;
    if (kaku) {
      hero = new StrokePlayer(view.querySelector('.w-demo .w-player'), kaku, { numbers: true });
      hero.showUpTo(0);
      playHero();
    }
    if (ji) {
      view.querySelectorAll('.w-step-sq').forEach((sq) => {
        const i = Number(sq.dataset.step);
        const p = new StrokePlayer(sq.querySelector('.w-player'), ji, { numbers: i === 0 });
        if (i === 1) p.showUpTo(3);
        if (i === 2) sq.querySelector('.w-mark').innerHTML = markSvg(3);
        sq.classList.add(['is-model', 'is-trace', 'is-written', 'is-fading'][i]);
        sq.querySelector('svg').setAttribute('aria-hidden', 'true');
      });
    }
  })();

  view.querySelector('.w-square').addEventListener('click', playHero);
  return () => { alive = false; hero?.stop(); };
}
