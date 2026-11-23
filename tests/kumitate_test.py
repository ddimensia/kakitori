"""Kakitori reading Kumitate Kanji's shared progress, with both apps on one origin as on GitHub Pages.

Usage: python3 tests/kumitate_test.py
Needs a Kumitate Kanji checkout: KUMITATE_DIR, default ../kumitate-kanji next to this repo.
Starts its own server (PORT, default 8790) with /kakitori/ and /kumitate-kanji/ side by side.
"""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
KUMITATE = Path(os.environ.get('KUMITATE_DIR', ROOT.parent / 'kumitate-kanji')).resolve()
PORT = int(os.environ.get('PORT', '8790'))
ORIGIN = f'http://127.0.0.1:{PORT}'
KAKI = f'{ORIGIN}/kakitori/'
KUMI = f'{ORIGIN}/kumitate-kanji/'

if not (KUMITATE / 'js' / 'share.js').exists():
    sys.exit(f'Kumitate Kanji checkout not found at {KUMITATE} (set KUMITATE_DIR)')


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('ok -', msg)


site = tempfile.mkdtemp()
os.symlink(ROOT, os.path.join(site, 'kakitori'))
os.symlink(KUMITATE, os.path.join(site, 'kumitate-kanji'))
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                          cwd=site, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

DBS = "async () => (await indexedDB.databases()).map((d) => d.name).sort()"

# Place kanji at levels in Kumitate Kanji through its own modules (the same instances the page uses).
PLACE = """async ([chars, level]) => {
  const st = await import('./js/state.js');
  const { item } = await import('./js/data.js');
  await st.setLevel(chars.map((c) => item('k:' + c)), level);
}"""

READ_SUMMARY = """async () => {
  const r = indexedDB.open('kumitate-share');
  const db = await new Promise((res) => { r.onsuccess = () => res(r.result); });
  if (!db.objectStoreNames.contains('summary')) { db.close(); return null; }
  const v = await new Promise((res) => { const g = db.transaction('summary').objectStore('summary').get('progress'); g.onsuccess = () => res(g.result); });
  db.close();
  return v || null;
}"""

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1100, 'height': 900})
        errors = []
        ctx.on('weberror', lambda e: errors.append(str(e.error)))

        # 1. Kakitori first: choosing Kumitate Kanji before it has been used creates nothing.
        kk = ctx.new_page()
        kk.goto(KAKI + '#settings')
        kk.wait_for_selector('select[name="kanjiSource"]')
        kk.select_option('select[name="kanjiSource"]', 'kumitate')
        kk.wait_for_selector('select[name="kumitateStage"]')
        check('No Kumitate Kanji progress found' in kk.inner_text('.settings-form'), 'Settings says no progress was found yet')
        dbs = kk.evaluate(DBS)
        check('kumitate-share' not in dbs and 'yomitori' not in dbs, f'reading created no Kumitate Kanji database ({dbs})')
        kk.goto(KAKI + '#today')
        kk.wait_for_selector('.today')
        check('no progress in this browser yet' in kk.inner_text('.today'), 'Today says Kumitate Kanji has no progress yet')

        # 2. Study in Kumitate Kanji: 一 just learned, 二 and 三 well known (unlocked).
        km = ctx.new_page()
        km.goto(KUMI + '#browse')
        km.wait_for_selector('.browse, .page', timeout=30000)
        km.evaluate(PLACE, [['一'], 'learning'])
        km.evaluate(PLACE, [['二', '三'], 'settling'])
        summary = None
        for _ in range(60):  # the summary is written shortly after changes
            summary = km.evaluate(READ_SUMMARY)
            if summary and len(summary['kanji']) == 3:
                break
            km.wait_for_timeout(250)
        check(summary['format'] == 1 and summary['app'] == 'kumitate-kanji', 'Kumitate Kanji writes a format 1 summary')
        by = {k['ch']: k for k in summary['kanji']}
        check(set(by) == {'一', '二', '三'}, 'summary lists the three studied kanji')
        check(by['一']['passedAt'] is None and by['一']['stage'] == 'learning', '一 is learning and not passed')
        check(by['二']['passedAt'] and by['二']['stage'] == 'settling', '二 is settling and passed')
        orders = [k['order'] for k in summary['kanji']]
        check(orders == sorted(orders), 'summary is in curriculum order')

        # 3. Back in Kakitori (the tab becomes visible again): the kanji arrive.
        kk.bring_to_front()
        kk.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        kk.wait_for_function("document.querySelector('.today')?.innerText.includes('3 kanji started there')", timeout=10000)
        check(True, 'Today picks up the three kanji when the tab is shown again')
        kk.goto(KAKI + '#characters')
        kk.wait_for_selector('.page')
        text = kk.inner_text('main')
        check(all(c in text for c in '一二三'), 'the kanji are on the Characters page')

        # 4. Threshold: only kanji that have unlocked their words.
        kk.goto(KAKI + '#settings')
        kk.wait_for_selector('select[name="kumitateStage"]')
        kk.select_option('select[name="kumitateStage"]', 'passed')
        kk.wait_for_function("document.querySelector('#toast').textContent === 'Saved.'", timeout=10000)
        active = kk.evaluate("""async () => {
          const { state } = await import('./js/state.js');
          return [...state.cards.values()].filter((c) => c.kind === 'kanji' && c.active).map((c) => c.char).sort();
        }""")
        check(active == ['三', '二'], f'"unlocked their words" keeps only 二 and 三 ({active})')

        # 5. A reload reads it again; it survives Kumitate Kanji's summary being missing.
        km.close()
        kk.evaluate("""() => new Promise((res) => { const r = indexedDB.deleteDatabase('kumitate-share'); r.onsuccess = r.onerror = r.onblocked = () => res(); })""")
        kk.goto(KAKI + '#today')
        kk.reload()
        kk.wait_for_selector('.today')
        check('3 kanji started there' in kk.inner_text('.today'), 'Kakitori keeps the last list if the summary disappears')
        check('kumitate-share' not in kk.evaluate(DBS), 'and does not recreate the shared database')

        # 6. Kumitate Kanji copes with empty databases left by anything else on the site.
        ctx2 = b.new_context()
        pg = ctx2.new_page()
        pg.goto(ORIGIN + '/kakitori/icon.svg')
        pg.evaluate("""() => Promise.all(['yomitori', 'kumitate-share'].map((n) => new Promise((res) => {
          const r = indexedDB.open(n, 1); r.onsuccess = () => { r.result.close(); res(); };
        })))""")
        pg.goto(KUMI + '#browse')
        pg.wait_for_selector('.browse, .page', timeout=30000)
        pg.evaluate(PLACE, [['四'], 'learning'])
        stores = pg.evaluate("""async () => {
          const out = {};
          for (const n of ['yomitori', 'kumitate-share']) {
            const db = await new Promise((res) => { const r = indexedDB.open(n); r.onsuccess = () => res(r.result); });
            out[n] = [db.version, [...db.objectStoreNames].sort()];
            db.close();
          }
          return out;
        }""")
        check(stores['yomitori'][1] == ['cards', 'kv', 'log'], f'Kumitate Kanji repairs an empty study database ({stores["yomitori"]})')
        pg.wait_for_timeout(2500)
        stores = pg.evaluate("""async () => {
          const db = await new Promise((res) => { const r = indexedDB.open('kumitate-share'); r.onsuccess = () => res(r.result); });
          const s = [...db.objectStoreNames]; db.close(); return s;
        }""")
        check(stores == ['summary'], 'and an empty shared database')

        check(not errors, 'no page errors' + ('' if not errors else ': ' + '; '.join(errors)))
        b.close()
finally:
    server.terminate()
