// Small UI helpers: escaping, toasts, dialogs and the red-pen grading marks.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
export function toast(msg, { error = false, ms = 3500 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('is-error', error);
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}

/** Modal confirm built on <dialog>. Resolves true when confirmed. */
export function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dialog';
    d.innerHTML = `<form method="dialog">
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
      <div class="dialog-actions">
        <button class="btn" value="cancel">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(confirm)}</button>
      </div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
    d.showModal();
  });
}

// Red-pen marks, as a teacher would write them: × again, △ hard, ○ good, ◎ easy.
const MARK_PATHS = {
  1: ['M20 22 C38 40 60 62 82 84', 'M80 18 C62 40 42 62 18 86'],
  2: ['M51 14 C63 36 76 60 89 82 C64 85 38 85 12 83 C24 60 36 38 49 17'],
  3: ['M54 12 C78 13 92 32 89 54 C86 78 64 92 42 88 C20 84 9 64 13 42 C17 22 34 11 58 15'],
  4: [
    'M54 8 C81 9 96 31 93 55 C90 81 66 96 41 92 C16 88 4 65 9 41 C13 19 32 6 59 11',
    'M52 30 C64 30 72 40 71 51 C70 63 60 71 49 70 C38 69 30 60 31 49 C32 38 41 29 55 31',
  ],
};

export const MARK_NAMES = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
export const MARK_SYMBOLS = { 1: '×', 2: '△', 3: '○', 4: '◎' };

export function markSvg(rating, { animate = false, cls = 'mark' } = {}) {
  const paths = MARK_PATHS[rating] || [];
  return `<svg class="${cls}${animate ? ' is-drawing' : ''}" viewBox="0 0 100 100" aria-hidden="true">${paths
    .map((d, i) => `<path d="${d}" pathLength="100" style="--i:${i}"/>`)
    .join('')}</svg>`;
}

export function relativeTime(ts, now = Date.now()) {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  let s;
  if (min < 1) s = 'less than a minute';
  else if (min < 60) s = `${min} minute${min === 1 ? '' : 's'}`;
  else if (min < 60 * 36) { const h = Math.round(min / 60); s = `${h} hour${h === 1 ? '' : 's'}`; }
  else { const d = Math.round(min / 1440); s = `${d} day${d === 1 ? '' : 's'}`; }
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
