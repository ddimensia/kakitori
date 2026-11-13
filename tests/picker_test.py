"""Usage: serve the app on BASE (default http://127.0.0.1:8765/), then: python3 tests/picker_test.py
Choose lessons: the Today buttons around the daily limit, picking characters (next batch, single
cells, groups), learning a selection past the limit in batches, and continuing today's lessons."""
import json, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')
OUT = os.environ.get('SHOTS', 'shots')
os.makedirs(OUT, exist_ok=True)

KANA_JS = "(async () => { const k = await import('/js/kana.js'); return k.KANA.map(x => [x.char, x.kind, x.romaji, x.note]); })()"
STATE = """(async () => {
  const s = await import('/js/state.js');
  return { today: s.introducedToday(), available: s.lessonQueue().available.length, pending: s.pendingLessons().length,
    introduced: [...s.state.cards.values()].filter(c => c.introducedAt).map(c => c.char).join('') };
})()"""


def char_for_prompt(page, kana):
    kind = page.locator('.prompt .prompt-kind span').first.inner_text().strip().lower()
    romaji = page.locator('.prompt .romaji').inner_text().strip()
    note = page.locator('.prompt .kana-note').inner_text().strip() if page.locator('.prompt .kana-note').count() else ''
    for ch, kd, r, n in kana:
        if kd == kind and r == romaji and n == note:
            return ch
    raise RuntimeError(f'unknown kana {kind} {romaji} {note}')


def glyph_points(page, ch):
    return page.evaluate(f"(async () => {{ const s = await import('/js/strokes.js'); const g = await s.getGlyph({json.dumps(ch)}); return g.points; }})()")


def draw(page, strokes, scale=0.85, shift=(4, 3)):
    box = page.locator('.pad-ink').bounding_box()
    k = box['width'] / 109
    for pts in strokes:
        pts = pts[::2] + [pts[-1]]
        def xy(p):
            return box['x'] + (54.5 + (p[0] - 54.5) * scale + shift[0]) * k, box['y'] + (54.5 + (p[1] - 54.5) * scale + shift[1]) * k
        page.mouse.move(*xy(pts[0]))
        page.mouse.down()
        for p in pts[1:]:
            page.mouse.move(*xy(p), steps=1)
        page.mouse.up()


def lessons_actions(page):
    return page.locator('.today .action').nth(1).locator('.action-row .btn').all_inner_texts()


def do_batch(page, kana, label):
    """Skip through the study steps, then write every quiz prompt. Returns the summary element."""
    page.wait_for_selector('.is-study')
    n = int(page.locator('.study-count').inner_text().split(' of ')[1])
    chars = []
    for i in range(n):
        page.wait_for_function(f"document.querySelector('.study-count')?.textContent === '{i + 1} of {n}' && document.querySelector('.is-study')")
        chars.append(page.locator('.prompt .answer-char').inner_text().strip())
        page.click('[data-act="skip"]')
    page.click('[data-act="quiz"]')
    for _ in range(40):
        page.wait_for_selector('.desk .pad-ink, .summary', timeout=10000)
        if page.locator('.summary').count():
            break
        draw(page, glyph_points(page, char_for_prompt(page, kana)))
        page.keyboard.press('Enter')
        page.wait_for_selector('.ratings:not([hidden]) .rate')
        w = page.locator('.writer').element_handle()
        page.keyboard.press('Enter')
        page.wait_for_function('el => !el.isConnected', arg=w)
    summary = page.locator('.summary')
    print(f'{label}: learned {"".join(chars)} | buttons {summary.locator(".summary-actions .btn").all_inner_texts()}'
          f' | primary {summary.locator(".btn.primary").inner_text()!r} | notes {summary.locator("p.sub").all_inner_texts()}')
    return summary


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1280, 'height': 860}, service_workers='block')
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text else None)
    page.goto(BASE + '#welcome'); page.click('.w-hero .w-cta'); page.wait_for_selector('.today')
    kana = page.evaluate(KANA_JS)
    print('fresh:', page.evaluate(STATE), '| lessons buttons:', lessons_actions(page))

    # Use up a daily limit of 2
    page.evaluate("""(async () => { const s = await import('/js/state.js'); await s.saveSettings({ newPerDay: 2 });
      for (const ch of ['h:あ', 'h:い']) await s.markIntroduced(s.state.cards.get(ch)); })()""")
    page.goto(BASE + '#characters'); page.goto(BASE + '#today'); page.wait_for_selector('.today')
    print('limit reached:', page.locator('.today .action').nth(1).locator('.num').inner_text(), 'new |',
          page.locator('.today .action').nth(1).locator('.sub').inner_text(), '| buttons:', lessons_actions(page))
    page.screenshot(path=f'{OUT}/picker-today.png')

    # ---- Choose lessons ----
    page.click('a[href="#lessons"]')
    page.wait_for_selector('.picker .cell')
    print('nav current:', page.locator('.nav a[aria-current="page"]').inner_text())
    print('sub:', page.locator('.picker .page-sub').inner_text())
    print('count:', page.locator('.result-count').inner_text(), '| start disabled:', page.locator('[data-act="start"]').is_disabled())
    page.click('[data-act="next-batch"]')
    print('next batch:', page.locator('.select-count').inner_text(),
          ''.join(page.locator('.cell.is-selected span').all_inner_texts()))
    page.click('.cell[data-card="k:ア"]')
    page.click('.cell[data-card="k:イ"]')
    print('plus ア イ:', page.locator('.select-count').inner_text())
    page.screenshot(path=f'{OUT}/picker-selected.png')
    kata = page.locator('.sheet-group', has=page.locator('h3', has_text='Katakana'))
    kata.locator('.group-select').click()
    print('katakana group:', page.locator('.select-count').inner_text(), '| button:', kata.locator('.group-select').inner_text())
    kata.locator('.group-select').click()
    print('katakana deselected:', page.locator('.select-count').inner_text())
    page.click('[data-kind="katakana"]')
    print('katakana filter:', page.locator('.result-count').inner_text(), '| groups:', page.locator('.sheet-group h3').all_inner_texts())
    page.click('[data-kind="all"]')
    page.click('[data-act="next-batch"]')
    page.click('.cell[data-card="k:ア"]')
    page.click('.cell[data-card="k:イ"]')
    print('ready:', page.locator('.select-count').inner_text())
    page.click('[data-act="start"]')
    s1 = do_batch(page, kana, 'chosen batch 1')
    page.screenshot(path=f'{OUT}/picker-continue.png')
    s1.locator('[data-act="next-lessons"]').click()
    s2 = do_batch(page, kana, 'chosen batch 2')
    s2.locator('[data-act="next-lessons"]').click()
    do_batch(page, kana, 'chosen batch 3')
    page.click('.summary [data-act="end"]')
    page.wait_for_selector('.today')
    st = page.evaluate(STATE)
    print('after chosen:', st, '| buttons:', lessons_actions(page))
    assert st['today'] == 14, st

    # ---- Today's lessons continue up to the limit ----
    page.evaluate("(async () => { const s = await import('/js/state.js'); await s.saveSettings({ newPerDay: 20 }); })()")
    page.goto(BASE + '#characters'); page.goto(BASE + '#today'); page.wait_for_selector('.today')
    print('limit 20:', page.locator('.today .action').nth(1).locator('.num').inner_text(), 'new | buttons:', lessons_actions(page))
    page.click('[data-act="lessons"]')
    s = do_batch(page, kana, 'today batch 1')
    s.locator('[data-act="next-lessons"]').click()
    s = do_batch(page, kana, 'today batch 2')
    page.click('.summary [data-act="end"]')
    page.wait_for_selector('.today')
    st = page.evaluate(STATE)
    print('after today:', st, '| buttons:', lessons_actions(page))
    assert st['today'] == 20, st

    # ---- Learn more anyway: one batch, no continue ----
    page.click('[data-act="lessons-extra"]')
    s = do_batch(page, kana, 'extra batch')
    assert s.locator('[data-act="next-lessons"]').count() == 0
    page.click('.summary [data-act="end"]')
    page.wait_for_selector('.today')
    print('after extra:', page.evaluate(STATE))

    # ---- Nothing left to choose ----
    page.evaluate("""(async () => { const s = await import('/js/state.js');
      for (const c of s.pendingLessons()) await s.markIntroduced(c); })()""")
    page.goto(BASE + '#lessons'); page.wait_for_selector('.picker')
    print('empty picker:', page.locator('.picker .empty').inner_text())
    page.goto(BASE + '#today'); page.wait_for_selector('.today')
    print('all started, buttons:', lessons_actions(page))
    print('errors:', errors)
    b.close()
