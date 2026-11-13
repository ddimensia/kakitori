"""Usage: serve the app on BASE (default http://127.0.0.1:8765/), then: python3 tests/known_test.py
Marking characters as already known: group selection, familiarity levels, spread of first
reviews, lesson queue, undo, single-character marking and keeping studied cards."""
import json, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')
OUT = os.environ.get('SHOTS', 'shots')
os.makedirs(OUT, exist_ok=True)

STATS = """(async () => {
  const s = await import('/js/state.js');
  const cards = [...s.state.cards.values()].filter(c => c.active);
  const pick = (kind) => cards.filter(c => c.kind === kind);
  const DAY = 86400000, now = Date.now();
  const summary = (list) => {
    const known = list.filter(c => c.markedKnown);
    const days = known.map(c => (c.due - now) / DAY);
    return { total: list.length, introduced: list.filter(c => c.introducedAt).length, known: known.length,
      dueMin: days.length ? Math.min(...days).toFixed(1) : null, dueMax: days.length ? Math.max(...days).toFixed(1) : null,
      levels: [...new Set(known.map(c => c.markedKnown.level))] };
  };
  return { hiragana: summary(pick('hiragana')), katakana: summary(pick('katakana')),
    queue: s.lessonQueue().available.map(c => c.char).join(''), due: s.dueCards().length };
})()"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1280, 'height': 860}, service_workers='block')
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text else None)
    page.goto(BASE + '#today'); page.wait_for_selector('.today')
    print('before:', page.evaluate(STATS))

    # Study あ first so we can check that already-studied characters are kept by default
    page.evaluate("(async () => { const s = await import('/js/state.js'); await s.markIntroduced(s.state.cards.get('h:あ')); })()")

    page.goto(BASE + '#characters'); page.wait_for_selector('.characters .cell')
    page.click('.sheet-group:has(h3:text-is("Hiragana 71")) .group-select, .sheet-group:first-child .group-select')
    page.wait_for_selector('.select-bar:not([hidden])')
    print('bar:', page.locator('.select-count').inner_text(), '| group button:', page.locator('.sheet-group').first.locator('.group-select').inner_text())
    # deselect one cell by clicking it
    page.click('.cell[data-card="h:ん"]')
    print('after deselecting ん:', page.locator('.select-count').inner_text())
    page.screenshot(path=f'{OUT}/known-selecting.png')
    page.click('[data-act="mark-known"]')
    page.wait_for_selector('dialog.familiar[open]')
    print('dialog:', page.locator('dialog.familiar h2').inner_text(), '| overwrite option:', page.locator('dialog.familiar input[name="overwrite"]').count())
    page.screenshot(path=f'{OUT}/known-dialog.png')
    page.check('dialog.familiar input[value="well"]')
    page.click('dialog.familiar button[value="ok"]')
    page.wait_for_selector('#toast.has-action.is-on')
    print('toast:', page.locator('#toast').inner_text().replace('\n', ' '))
    st = page.evaluate(STATS)
    print('after mark:', st)
    a = page.evaluate("(async () => { const s = await import('/js/state.js'); const c = s.state.cards.get('h:あ'); return [c.markedKnown || null, c.srs.state]; })()")
    print('studied あ kept as-is:', a)
    print('select mode ended:', page.locator('.select-bar').is_hidden())
    page.screenshot(path=f'{OUT}/known-after.png')

    # Undo
    page.click('#toast .toast-action')
    page.wait_for_timeout(300)
    print('after undo:', page.evaluate(STATS)['hiragana'])

    # Mark again with "Know it" and overwrite studied
    page.click('[data-act="select-mode"]')
    page.locator('.sheet-group').first.locator('.group-select').click()
    page.click('[data-act="mark-known"]')
    page.wait_for_selector('dialog.familiar[open]')
    page.check('dialog.familiar input[value="know"]')
    page.check('dialog.familiar input[name="overwrite"]')
    page.click('dialog.familiar button[value="ok"]')
    page.wait_for_timeout(300)
    st = page.evaluate(STATS)
    print('know + overwrite:', st['hiragana'], '| lessons now start with:', st['queue'][:10])

    # Single character from its detail dialog
    page.click('.cell[data-card="k:ア"]')
    page.wait_for_selector('dialog.detail[open]')
    page.click('dialog.detail [data-act="known"]')
    page.wait_for_selector('dialog.familiar[open]')
    print('single dialog:', page.locator('dialog.familiar h2').inner_text())
    page.check('dialog.familiar input[value="cold"]')
    page.click('dialog.familiar button[value="ok"]')
    page.wait_for_timeout(300)
    page.click('.cell[data-card="k:ア"]')
    page.wait_for_selector('dialog.detail[open]')
    print('detail stats:', page.locator('dialog.detail .stats').inner_text().replace('\n', ' | '))
    page.screenshot(path=f'{OUT}/known-detail.png')
    page.click('dialog.detail [data-act="close"]')

    # persistence
    page.reload(); page.wait_for_selector('.characters .cell')
    print('after reload:', page.evaluate(STATS)['hiragana'])
    print('errors:', errors or 'none')
    b.close()
