// Today: what's due, lessons available, the coming week, your character sheet and WaniKani sync.

import { state, dueCards, lessonQueue, introducedToday, KANJI_SOURCES, isBuiltinSource } from '../state.js';
import { esc, relativeTime, plural } from '../ui.js';
import { sheetMarkup, legendMarkup, openCardDetail } from './characters.js';
import { logSince } from '../store.js';

function forecast() {
  const days = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const from = start.getTime() + i * 86400000;
    days.push({ from, to: from + 86400000, n: 0, label: i === 0 ? 'Today' : new Date(from).toLocaleDateString(undefined, { weekday: 'short' }) });
  }
  for (const c of state.cards.values()) {
    if (!c.active || c.suspended || !c.introducedAt || c.due === null) continue;
    const d = days.find((x) => c.due < x.to); // overdue cards count toward today
    if (d) d.n++;
  }
  return days;
}

export async function renderToday(view, { onStartReviews, onStartLessons, onSync, onPractice, onExtraPractice, onRefresh, syncStatus }) {
  const due = dueCards();
  const { available, waiting } = lessonQueue();
  const doneToday = introducedToday();
  const active = [...state.cards.values()].filter((c) => c.active);
  const upcoming = active.filter((c) => !c.suspended && c.introducedAt && c.due > Date.now()).sort((a, b) => a.due - b.due);
  const studied = active.filter((c) => c.introducedAt).length;
  const todayLog = await logSince(new Date().setHours(0, 0, 0, 0));
  const fc = forecast();
  const maxN = Math.max(1, ...fc.map((d) => d.n));
  const s = state.settings;

  let reviewsSub;
  const soon = upcoming.filter((c) => c.due < Date.now() + 86400000).length;
  if (due.length) reviewsSub = soon ? `${soon} more due in the next 24 hours.` : 'Nothing else is due in the next 24 hours.';
  else if (upcoming.length) reviewsSub = `Next review ${relativeTime(upcoming[0].due)}.`;
  else reviewsSub = 'Finish a lesson to start your schedule.';

  let lessonsSub;
  if (available.length) lessonsSub = waiting > available.length ? `${waiting - available.length} more waiting after today.` : 'These are the last new characters for now.';
  else if (waiting) lessonsSub = `You’ve learned ${doneToday} today. ${waiting} waiting for tomorrow.`;
  else if (s.kanjiSource === 'wanikani') lessonsSub = s.wkToken ? 'You’re caught up with WaniKani. New kanji arrive as you do lessons there.' : 'Connect WaniKani or choose a kanji list in Settings.';
  else lessonsSub = 'You’ve started every character in your list.';

  const wk = (() => {
    if (isBuiltinSource(s.kanjiSource)) return `<p class="wk-line">Kanji list: ${esc(KANJI_SOURCES[s.kanjiSource])}.</p><a class="btn quiet" href="#settings">Change list</a>`;
    if (s.kanjiSource === 'none') return `<p class="wk-line">Kana only. You can add kanji from WaniKani or a built-in list.</p><a class="btn" href="#settings">Choose kanji</a>`;
    if (syncStatus) return `<p class="wk-line is-busy" data-sync-status>${esc(syncStatus)}…</p>`;
    if (!s.wkToken) return `<p class="wk-line">WaniKani isn’t connected, so only kana are included. You can also pick a built-in kanji list instead.</p><a class="btn" href="#settings">Connect WaniKani or choose a list</a>`;
    if (!state.sync) return `<p class="wk-line">WaniKani is connected but hasn’t synced yet.</p><button class="btn" data-act="sync">Sync now</button>`;
    const u = state.sync.user;
    return `<p class="wk-line">Synced ${esc(relativeTime(state.sync.at))} as ${esc(u.username)}, level ${esc(u.level)}. ${plural(state.sync.count, 'kanji', 'kanji')} started on WaniKani.</p>
      <button class="btn quiet" data-act="sync">Sync now</button>`;
  })();

  const answeredToday = todayLog.length;
  const recalledToday = todayLog.filter((l) => l.rating >= 2).length;

  view.innerHTML = `
    <section class="page today">
      <div class="today-top">
        <div class="action">
          <h2>Reviews</h2>
          <p class="big"><span class="num">${due.length}</span> <span class="unit">due now</span></p>
          <p class="sub">${esc(reviewsSub)}</p>
          <button class="btn primary" data-act="reviews" ${due.length ? '' : 'disabled'}>Start reviews</button>
        </div>
        <div class="action">
          <h2>Lessons</h2>
          <p class="big"><span class="num">${available.length}</span> <span class="unit">new today</span></p>
          <p class="sub">${esc(lessonsSub)}</p>
          <div class="action-row">
            <button class="btn ${due.length ? '' : 'primary'}" data-act="lessons" ${available.length ? '' : 'disabled'}>Start lessons</button>
            ${!available.length && waiting ? `<button class="btn quiet" data-act="lessons-extra">Learn ${Math.min(s.lessonBatch, waiting)} more anyway</button>` : ''}
          </div>
        </div>
        <div class="week" aria-label="Reviews due over the next seven days">
          <h2>Coming up</h2>
          <ol class="bars">${fc.map((d) => `<li><span class="bar-n">${d.n || ''}</span><span class="bar" style="--h:${(d.n / maxN).toFixed(3)}"></span><span class="bar-label">${esc(d.label)}</span></li>`).join('')}</ol>
          <p class="sub">${answeredToday ? `${plural(answeredToday, 'answer')} today, ${Math.round((100 * recalledToday) / answeredToday)}% recalled.` : 'No reviews yet today.'}</p>
        </div>
      </div>

      <section class="sheet-wrap">
        <header class="sheet-head">
          <h2>Your characters</h2>
          <p class="sub">${studied} of ${active.length} studied. ${studied ? '<button class="link" data-act="extra">Practice your weakest ten</button>' : ''}</p>
        </header>
        <div class="sheet">${active.length ? sheetMarkup(active) : '<p class="empty">No characters yet. Turn on kana, connect WaniKani or choose a kanji list in Settings.</p>'}</div>
        ${active.length ? legendMarkup() : ''}
      </section>

      <section class="wk">${wk}</section>
    </section>`;

  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const a = b.dataset.act;
      if (a === 'reviews') onStartReviews();
      else if (a === 'lessons') onStartLessons(false);
      else if (a === 'lessons-extra') onStartLessons(true);
      else if (a === 'sync') onSync();
      else if (a === 'extra') onExtraPractice();
      return;
    }
    const cell = e.target.closest('[data-card]');
    if (cell) openCardDetail(state.cards.get(cell.dataset.card), { onPractice, onChange: onRefresh });
  });
}
