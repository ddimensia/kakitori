// Settings: WaniKani connection, which characters to study, scheduling, grading and backups.

import { state, saveSettings, loadState, KANJI_SOURCES, isBuiltinSource } from '../state.js';
import { SRS_THRESHOLDS } from '../wanikani.js';
import { STRICTNESS } from '../grader.js';
import { exportAll, importAll, wipeAll } from '../store.js';
import { esc, toast, confirmDialog, relativeTime } from '../ui.js';

const TOKEN_URL = 'https://www.wanikani.com/settings/personal_access_tokens';

export function renderSettings(view, { onSync, syncStatus, onRefresh }) {
  const s = state.settings;
  const sync = state.sync;
  view.innerHTML = `
    <section class="page settings">
      <header class="page-head"><h1>Settings</h1>
        <p class="page-sub">Changes save as you make them. Everything stays in this browser.</p></header>
      ${state.persistent ? '' : '<p class="warn">This browser isn’t letting the app store data, so progress will be lost when you close the tab. Private browsing is the usual cause.</p>'}

      <form class="settings-form" autocomplete="off">
        <fieldset>
          <legend>Characters</legend>
          <label class="field">Kanji to study
            <select name="kanjiSource">${Object.entries(KANJI_SOURCES).map(([v, l]) => `<option value="${v}" ${v === s.kanjiSource ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
            <span class="help">${isBuiltinSource(s.kanjiSource)
              ? 'Kanji arrive through lessons in this order. Meanings and readings come from KANJIDIC2; JLPT levels are the widely used unofficial lists, since the JLPT no longer publishes official ones.'
              : 'WaniKani adds the kanji you’ve started there. The built-in lists work without a WaniKani account.'}
              Progress is kept per character, so switching keeps what you’ve learned.</span>
          </label>
          <label class="check"><input type="checkbox" name="vocabContext" ${s.vocabContext ? 'checked' : ''}> Show an example word as a hint, with the kanji blanked out</label>
          <label class="check"><input type="checkbox" name="hiragana" ${s.hiragana ? 'checked' : ''}> Hiragana</label>
          <label class="check"><input type="checkbox" name="katakana" ${s.katakana ? 'checked' : ''}> Katakana</label>
          <label class="check"><input type="checkbox" name="dakuten" ${s.dakuten ? 'checked' : ''}> Include kana with dakuten and handakuten (が, ぱ…)</label>
          <span class="help">Turning a set off hides it but keeps its progress.</span>
        </fieldset>

${s.kanjiSource === 'wanikani' ? `
        <fieldset>
          <legend>WaniKani</legend>
          <p class="help unofficial">Kakitori is an unofficial third-party app. It isn’t made by, affiliated with or endorsed by WaniKani or Tofugu LLC.</p>
          <label class="field">API token
            <span class="token-row">
              <input type="password" name="wkToken" value="${esc(s.wkToken)}" spellcheck="false" placeholder="Paste your personal access token">
              <button type="button" class="btn quiet" data-act="toggle-token">Show</button>
            </span>
            <span class="help">Create a read-only token on <a href="${TOKEN_URL}" target="_blank" rel="noopener">WaniKani’s API tokens page</a>. It’s stored only in this browser and sent only to WaniKani.</span>
          </label>
          <label class="field">WaniKani kanji to include
            <select name="knownStage">${SRS_THRESHOLDS.map((t) => `<option value="${t.stage}" ${t.stage === s.knownStage ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
            <span class="help">Only kanji at this WaniKani stage or higher appear here.</span>
          </label>
          <div class="field-actions">
            <button type="button" class="btn" data-act="sync" ${s.wkToken && !syncStatus ? '' : 'disabled'} ${syncStatus ? 'data-sync-status' : ''}>${syncStatus ? esc(syncStatus) + '…' : 'Sync now'}</button>
            <span class="help">${sync ? `Last synced ${esc(relativeTime(sync.at))}: ${sync.count} kanji.` : 'Not synced yet.'} The app also syncs when opened if the last sync is over ${s.autoSyncHours} hours old.</span>
          </div>
        </fieldset>
` : ''}

        <fieldset>
          <legend>Lessons and reviews</legend>
          <label class="field">New characters per day
            <input type="number" name="newPerDay" min="0" max="100" value="${s.newPerDay}"></label>
          <label class="field">Characters per lesson
            <input type="number" name="lessonBatch" min="1" max="20" value="${s.lessonBatch}"></label>
          <label class="field">Lesson order
            <select name="lessonOrder">
              <option value="mixed" ${s.lessonOrder === 'mixed' ? 'selected' : ''}>Alternate kana and kanji</option>
              <option value="kana" ${s.lessonOrder === 'kana' ? 'selected' : ''}>Kana first</option>
              <option value="kanji" ${s.lessonOrder === 'kanji' ? 'selected' : ''}>Kanji first</option>
            </select></label>
          <label class="field">Target recall rate
            <select name="retention">${[0.8, 0.85, 0.9, 0.93, 0.95].map((r) => `<option value="${r}" ${r === s.retention ? 'selected' : ''}>${Math.round(r * 100)}%${r === 0.9 ? ' (recommended)' : ''}</option>`).join('')}</select>
            <span class="help">Higher means more frequent reviews. Scheduling uses the FSRS algorithm.</span></label>
          <label class="field">Longest gap between reviews
            <select name="maxInterval">${[[90, '3 months'], [180, '6 months'], [365, '1 year'], [730, '2 years'], [3650, '10 years']].map(([v, l]) => `<option value="${v}" ${v === s.maxInterval ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="showStrokeCount" ${s.showStrokeCount ? 'checked' : ''}> Show the stroke count in reviews</label>
        </fieldset>

        <fieldset>
          <legend>Writing and grading</legend>
          <label class="field">Grading strictness
            <select name="strictness">${Object.entries(STRICTNESS).map(([k, v]) => `<option value="${k}" ${k === s.strictness ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
            <span class="help">How closely each stroke must follow the model’s shape and position. Stroke order and direction are always checked.</span></label>
          <label class="check"><input type="checkbox" name="penOnly" ${s.penOnly ? 'checked' : ''}> Ignore finger and palm touches once a stylus is used</label>
        </fieldset>

        <fieldset>
          <legend>Backup</legend>
          <p class="help">Progress lives in this browser only. Save a backup file now and then, or to move to another device. Backups don’t include your API token.</p>
          <div class="field-actions">
            <button type="button" class="btn" data-act="export">Save backup file</button>
            <label class="btn">Restore from backup<input type="file" accept="application/json,.json" data-act="import" hidden></label>
            <button type="button" class="btn danger" data-act="wipe">Erase all progress</button>
          </div>
        </fieldset>
      </form>

      <section class="credits">
        <h2>Credits</h2>
        <p>Stroke-order data and the app icon are adapted from <a href="https://kanjivg.tagaini.net" target="_blank" rel="noopener">KanjiVG</a> by Ulrich Apel,
        used under <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a>.
        The adapted data is shared under the same license.
        Handwriting recognition from <a href="https://github.com/asdfjkl/kanjicanvas" target="_blank" rel="noopener">KanjiCanvas</a> by Dominik Klein, MIT license.
        Scheduling by <a href="https://github.com/open-spaced-repetition/ts-fsrs" target="_blank" rel="noopener">ts-fsrs</a>, MIT license.
        Built-in kanji lists: meanings, readings, school grades and frequency ranks from <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noopener">KANJIDIC2</a>
        and example words from <a href="https://www.edrdg.org/jmdict/j_jmdict.html" target="_blank" rel="noopener">JMdict</a>, both by the Electronic Dictionary Research and Development Group,
        used under <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noopener">CC BY-SA 4.0</a>; JLPT levels from <a href="https://www.tanos.co.uk/jlpt/" target="_blank" rel="noopener">Jonathan Waller’s JLPT lists</a>, CC BY.
        Fonts: Klee One and Zen Kaku Gothic New, SIL Open Font License.
        Kanji meanings, readings and vocabulary come from your <a href="https://www.wanikani.com" target="_blank" rel="noopener">WaniKani</a> account.
        They are © Tofugu LLC, used under <a href="https://www.wanikani.com/terms" target="_blank" rel="noopener">WaniKani’s terms</a>, and aren’t covered by Kakitori’s license.</p>
        <p>Kakitori is an unofficial third-party app for WaniKani users. It isn’t made by, affiliated with or endorsed by WaniKani or Tofugu LLC.
        Kakitori’s own code is <a href="https://github.com/ddimensia/kakitori" target="_blank" rel="noopener">open source</a> under the MIT license.</p>
      </section>
    </section>`;

  const form = view.querySelector('form');
  form.addEventListener('submit', (e) => e.preventDefault());
  const num = new Set(['knownStage', 'newPerDay', 'lessonBatch', 'retention', 'maxInterval']);
  form.addEventListener('change', async (e) => {
    const el = e.target;
    if (!el.name) return;
    let v = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (num.has(el.name)) {
      v = Number(v);
      if (!Number.isFinite(v)) return;
      if (el.min) v = Math.max(Number(el.min), v);
      if (el.max) v = Math.min(Number(el.max), v);
    }
    const tokenChanged = el.name === 'wkToken' && v !== state.settings.wkToken;
    try {
      await saveSettings({ [el.name]: v });
    } catch (err) {
      toast(`Couldn’t load the kanji list: ${err.message}`, { error: true });
      return;
    }
    toast('Saved.');
    if (tokenChanged && v) onSync();
    else if (el.name === 'wkToken' || el.name === 'kanjiSource') onRefresh();
  });

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'toggle-token') {
      const input = form.elements.wkToken;
      input.type = input.type === 'password' ? 'text' : 'password';
      b.textContent = input.type === 'password' ? 'Show' : 'Hide';
    } else if (a === 'sync') onSync();
    else if (a === 'export') {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kakitori-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Backup saved.');
    } else if (a === 'wipe') {
      const ok = await confirmDialog({ title: 'Erase all progress?', body: 'This deletes every review, schedule and setting in this browser. It can’t be undone unless you have a backup file.', confirm: 'Erase everything', danger: true });
      if (!ok) return;
      await wipeAll();
      await loadState();
      toast('All progress erased.');
      onRefresh();
    }
  });

  view.querySelector('[data-act="import"]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ok = await confirmDialog({ title: 'Restore this backup?', body: `It replaces your current progress with the backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'that file'}.`, confirm: 'Restore backup' });
      if (!ok) return;
      await importAll(data);
      await loadState();
      toast('Backup restored.');
      onRefresh();
    } catch (err) {
      toast(err.message.startsWith('This file') ? err.message : 'That file couldn’t be read as a Kakitori backup.', { error: true });
    } finally {
      e.target.value = '';
    }
  });
}
