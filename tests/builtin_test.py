"""Usage: serve the app on BASE (default http://127.0.0.1:8765/), then: python3 tests/builtin_test.py
Built-in kanji lists (no WaniKani): switch lists, do a lesson and quiz with real mouse strokes,
search, check grouping and that progress survives switching lists."""
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')
OUT = os.environ.get('SHOTS', 'shots')
os.makedirs(OUT, exist_ok=True)


def glyph_points(page, ch):
    return page.evaluate(f"(async () => {{ const s = await import('/js/strokes.js'); const g = await s.getGlyph({json.dumps(ch)}); return g.points; }})()")


def draw(page, strokes, scale=0.85, shift=(4, 3)):
    box = page.locator('.pad-ink').bounding_box()
    k = box['width'] / 109
    for pts in strokes:
        pts = pts[::2] + [pts[-1]]
        xy = lambda p: (box['x'] + (54.5 + (p[0] - 54.5) * scale + shift[0]) * k, box['y'] + (54.5 + (p[1] - 54.5) * scale + shift[1]) * k)
        page.mouse.move(*xy(pts[0]))
        page.mouse.down()
        for p in pts[1:]:
            page.mouse.move(*xy(p))
        page.mouse.up()


def set_source(page, value):
    page.goto(BASE + '#settings')
    page.wait_for_selector('select[name="kanjiSource"]')
    page.select_option('select[name="kanjiSource"]', value)
    page.wait_for_function("document.querySelector('#toast').textContent === 'Saved.'", timeout=15000)
    page.wait_for_timeout(300)


def groups(page):
    page.goto(BASE + '#today')
    page.wait_for_selector('.today')
    return [g for g in page.locator('.sheet-group h3').all_inner_texts() if g.startswith('Kanji')]


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1280, 'height': 860}, service_workers='block')
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text else None)

    set_source(page, 'jlpt')
    print('settings help:', page.locator('select[name="kanjiSource"] + .help').inner_text()[:90], '| WK section shown:', page.locator('legend', has_text='WaniKani').count())
    page.screenshot(path=f'{OUT}/builtin-settings.png')
    g = groups(page)
    print('JLPT groups:', [x.split('\n')[0] for x in g])
    print('wk line:', page.locator('.wk-line').inner_text())
    print('lesson queue:', page.evaluate("(async () => { const s = await import('/js/state.js'); return s.lessonQueue().available.map(c => c.char).join(''); })()"))

    # lesson: study -> trace -> quiz, first kanji only, then end
    page.evaluate("(async () => { const s = await import('/js/state.js'); await s.saveSettings({ lessonOrder: 'kanji', lessonBatch: 2 }); })()")
    page.goto(BASE + '#today'); page.wait_for_selector('.today')
    page.click('[data-act="lessons"]')
    page.wait_for_selector('.is-study .player-host svg')
    page.wait_for_timeout(1200)
    print('study prompt:', page.locator('.prompt').inner_text().replace('\n', ' | ')[:200])
    page.screenshot(path=f'{OUT}/builtin-lesson-study.png')
    for _ in range(2):
        ch = page.locator('.prompt .answer-char').inner_text().strip()
        page.click('[data-act="trace"]')
        page.wait_for_selector('.is-trace .pad-ink')
        draw(page, glyph_points(page, ch), scale=1, shift=(0, 0))
        page.click('[data-act="check"]')
        page.wait_for_selector('.trace-actions:not([hidden])')
        page.click('[data-act="continue"]')
        page.wait_for_selector('.is-study, [data-act="quiz"]')
    page.click('[data-act="quiz"]')
    page.wait_for_selector('.desk .pad-ink')
    info = page.evaluate("(async () => { const s = await import('/js/state.js'); return Object.fromEntries(['日','一'].map(c => [s.kanjiInfo(c).meanings[0], c])); })()")
    meaning = page.locator('.prompt .meaning').inner_text().strip()
    print('quiz prompt:', page.locator('.prompt').inner_text().replace('\n', ' | ')[:200])
    ch = info[meaning]
    draw(page, glyph_points(page, ch))
    page.keyboard.press('Enter')
    page.wait_for_selector('.ratings:not([hidden])')
    page.wait_for_timeout(800)
    print('quiz', ch, 'score', page.locator('.score .num').inner_text(), '| suggested', page.locator('.rate.is-suggested').get_attribute('data-r'), '|', page.locator('.recog').inner_text())
    page.screenshot(path=f'{OUT}/builtin-quiz-feedback.png')
    page.keyboard.press('Enter')
    page.click('[data-act="end"]')
    page.wait_for_selector('.today')

    # search by meaning, hiragana for an on'yomi, and kun'yomi
    page.goto(BASE + '#characters'); page.wait_for_selector('.characters .cell')
    for q in ('fast', 'そく', 'はやい', '速'):
        page.fill('[data-q]', q); page.wait_for_timeout(250)
        print(f'search {q!r}:', page.locator('.result-count').inner_text(), ''.join(page.locator('.sheet .cell span').all_inner_texts()[:12]))
    page.fill('[data-q]', '')
    page.click('.cell[data-card="k:速"]'); page.wait_for_selector('dialog.detail[open]'); page.wait_for_timeout(1200)
    print('detail link:', page.locator('dialog .detail-info a').inner_text(), page.locator('dialog .detail-info a').get_attribute('href'))
    page.screenshot(path=f'{OUT}/builtin-detail.png')
    page.click('dialog [data-act="close"]')

    studied_before = page.evaluate("(async () => { const s = await import('/js/state.js'); return [...s.state.cards.values()].filter(c => c.kind==='kanji' && c.introducedAt).map(c => c.char).join(''); })()")
    set_source(page, 'grade')
    g = groups(page)
    print('grade groups:', [x.split('\n')[0] for x in g][:3], '…', [x.split('\n')[0] for x in g][-1])
    set_source(page, 'frequency')
    g = groups(page)
    print('frequency groups:', [x.split('\n')[0] for x in g][:2], '…', len(g), 'groups')
    studied_after = page.evaluate("(async () => { const s = await import('/js/state.js'); return [...s.state.cards.values()].filter(c => c.kind==='kanji' && c.introducedAt && c.active).map(c => c.char).join(''); })()")
    print('progress kept across lists:', studied_before, '->', studied_after)
    page.screenshot(path=f'{OUT}/builtin-today-frequency.png', full_page=False)
    set_source(page, 'none')
    print('none: kanji groups', len(groups(page)), '| wk line:', page.locator('.wk-line').inner_text())
    print('errors:', errors or 'none')
    b.close()
