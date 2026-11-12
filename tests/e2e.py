"""Usage: serve the app on BASE (default http://127.0.0.1:8765/), then: python3 tests/e2e.py [desktop|tablet|phone]
End-to-end test with a mocked WaniKani API: sync, lessons, quiz, reviews, characters, settings.
Draws with real mouse events along KanjiVG strokes."""
import json, os, re, sys, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')
OUT = os.environ.get('SHOTS', 'shots')
os.makedirs(OUT, exist_ok=True)
VIEW = (sys.argv[1] if len(sys.argv) > 1 else 'desktop')

def kanji(id_, ch, level, pos, meanings, on, kun, vocab_ids=()):
    return {"id": id_, "object": "kanji", "url": f"https://api.wanikani.com/v2/subjects/{id_}", "data_updated_at": "2026-01-01T00:00:00Z",
            "data": {"level": level, "slug": ch, "hidden_at": None, "document_url": f"https://www.wanikani.com/kanji/{ch}", "characters": ch,
                     "meanings": [{"meaning": m, "primary": i == 0, "accepted_answer": True} for i, m in enumerate(meanings)],
                     "auxiliary_meanings": [],
                     "readings": [{"type": "onyomi", "primary": i == 0, "accepted_answer": True, "reading": r} for i, r in enumerate(on)] +
                                 [{"type": "kunyomi", "primary": False, "accepted_answer": False, "reading": r} for r in kun],
                     "component_subject_ids": [], "amalgamation_subject_ids": list(vocab_ids), "lesson_position": pos}}

def vocab(id_, chars, reading, meaning, comps, level=1):
    return {"id": id_, "object": "vocabulary", "data": {"level": level, "hidden_at": None, "characters": chars,
            "meanings": [{"meaning": meaning, "primary": True, "accepted_answer": True}],
            "readings": [{"primary": True, "accepted_answer": True, "reading": reading}], "component_subject_ids": comps}}

KANJI = [
    kanji(440, '一', 1, 1, ['One'], ['いち', 'いつ'], ['ひと']),
    kanji(441, '二', 1, 2, ['Two'], ['に'], ['ふた']),
    kanji(444, '人', 1, 3, ['Person'], ['じん', 'にん'], ['ひと']),
    kanji(449, '口', 1, 4, ['Mouth'], ['こう', 'く'], ['くち']),
    kanji(450, '大', 1, 5, ['Big', 'Large'], ['たい', 'だい'], ['おお']),
    kanji(476, '日', 2, 1, ['Sun', 'Day'], ['にち', 'じつ'], ['ひ', 'か']),
    kanji(453, '山', 1, 6, ['Mountain'], ['さん'], ['やま']),
    kanji(999, '早', 3, 1, ['Early', 'Fast'], ['そう'], ['はや']),
    kanji(998, '速', 9, 1, ['Fast'], ['そく'], ['はや']),
]
STAGES = {440: 5, 441: 5, 444: 4, 449: 3, 450: 1, 476: 2, 453: 0, 999: 6, 998: 5}
VOCAB = [vocab(2467, '一人', 'ひとり', 'Alone', [440, 444]), vocab(2468, '大人', 'おとな', 'Adult', [450, 444]),
         vocab(2470, '日本', 'にほん', 'Japan', [476]), vocab(2471, '人口', 'じんこう', 'Population', [444, 449])]

calls = []

def coll(items, url, next_url=None):
    return {"object": "collection", "url": url, "pages": {"per_page": 500, "next_url": next_url, "previous_url": None},
            "total_count": len(items), "data_updated_at": "2026-01-01T00:00:00Z", "data": items}

def handle(route):
    req = route.request
    u = urlparse(req.url)
    q = parse_qs(u.query)
    calls.append(u.path + '?' + u.query)
    if req.headers.get('authorization') != 'Bearer test-token-123':
        return route.fulfill(status=401, json={"error": "Unauthorized", "code": 401})
    headers = {'access-control-allow-origin': '*'}
    if u.path == '/v2/user':
        return route.fulfill(json={"object": "user", "data": {"username": "tsubasa", "level": 3, "subscription": {"max_level_granted": 60}}}, headers=headers)
    if u.path == '/v2/assignments':
        types = q.get('subject_types', [''])[0]
        if types == 'kanji':
            items = [{"id": 9000 + sid, "object": "assignment", "data": {"subject_id": sid, "subject_type": "kanji", "srs_stage": st,
                      "started_at": None if st == 0 else "2026-01-01T00:00:00Z"}} for sid, st in STAGES.items() if st > 0]
            # two pages to exercise pagination
            if 'page_after_id' in q:
                return route.fulfill(json=coll(items[4:], req.url), headers=headers)
            return route.fulfill(json=coll(items[:4], req.url, req.url + '&page_after_id=1'), headers=headers)
        items = [{"id": 8000 + v['id'], "object": "assignment", "data": {"subject_id": v['id'], "subject_type": "vocabulary", "srs_stage": 2}} for v in VOCAB]
        return route.fulfill(json=coll(items, req.url), headers=headers)
    if u.path == '/v2/subjects':
        ids = set(int(x) for x in q.get('ids', [''])[0].split(',') if x)
        items = [s for s in KANJI + VOCAB if s['id'] in ids]
        return route.fulfill(json=coll(items, req.url), headers=headers)
    return route.fulfill(status=404, json={})

KANA_JS = "(async () => { const k = await import('/js/kana.js'); return k.KANA.map(x => [x.char, x.kind, x.romaji, x.note]); })()"

def char_for_prompt(page, kana):
    kind = page.locator('.prompt .prompt-kind span').first.inner_text().strip().lower()
    if kind == 'kanji':
        meaning = page.locator('.prompt .meaning').inner_text().strip()
        for k in KANJI:
            if k['data']['meanings'][0]['meaning'] == meaning:
                return k['data']['characters']
        raise RuntimeError('unknown meaning ' + meaning)
    romaji = page.locator('.prompt .romaji').inner_text().strip()
    note = page.locator('.prompt .kana-note').inner_text().strip() if page.locator('.prompt .kana-note').count() else ''
    for ch, kd, r, n in kana:
        if kd == kind and r == romaji and n == note:
            return ch
    raise RuntimeError(f'unknown kana {kind} {romaji} {note}')

def glyph_points(page, ch):
    return page.evaluate(f"(async () => {{ const s = await import('/js/strokes.js'); const g = await s.getGlyph({json.dumps(ch)}); return g.points; }})()")

def draw(page, strokes, scale=0.85, shift=(4, 3), reverse=None, order=None):
    box = page.locator('.pad-ink').bounding_box()
    k = box['width'] / 109
    seq = list(range(len(strokes))) if order is None else order
    for idx in seq:
        pts = strokes[idx][::-1] if reverse == idx else strokes[idx]
        pts = pts[::2] + [pts[-1]]
        def xy(p):
            x = 54.5 + (p[0] - 54.5) * scale + shift[0]
            y = 54.5 + (p[1] - 54.5) * scale + shift[1]
            return box['x'] + x * k, box['y'] + y * k
        page.mouse.move(*xy(pts[0]))
        page.mouse.down()
        for p in pts[1:]:
            page.mouse.move(*xy(p), steps=1)
        page.mouse.up()

with sync_playwright() as p:
    b = p.chromium.launch()
    vp = {'desktop': {'width': 1280, 'height': 860}, 'tablet': {'width': 1024, 'height': 1366}, 'phone': {'width': 390, 'height': 844}}[VIEW]
    ctx = b.new_context(viewport=vp, service_workers='block', has_touch=VIEW != 'desktop', device_scale_factor=2 if VIEW == 'phone' else 1)
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type == 'error' and 'fonts' not in m.text and 'TUNNEL' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.route('https://api.wanikani.com/**', handle)
    page.goto(BASE + '#settings')
    page.wait_for_selector('.settings')
    kana = page.evaluate(KANA_JS)

    # wrong token first
    page.fill('input[name="wkToken"]', 'nope')
    page.locator('input[name="wkToken"]').dispatch_event('change')
    page.wait_for_selector('#toast.is-error', timeout=5000)
    print('bad token toast:', page.locator('#toast').inner_text())
    page.wait_for_timeout(500)
    page.fill('input[name="wkToken"]', 'test-token-123')
    page.locator('input[name="wkToken"]').dispatch_event('change')
    page.wait_for_function("document.querySelector('#toast').textContent.startsWith('Synced')", timeout=10000)
    print('sync toast:', page.locator('#toast').inner_text())
    print('api calls:', len(calls), [c.split('?')[0] for c in calls][-6:])
    page.screenshot(path=f'{OUT}/{VIEW}-settings.png', full_page=True)

    page.goto(BASE + '#today')
    page.wait_for_selector('.today .wk-line')
    print('wk line:', page.locator('.wk-line').inner_text())
    kanji_cells = page.locator('.sheet-group h3').all_inner_texts()
    print('groups:', kanji_cells)
    page.screenshot(path=f'{OUT}/{VIEW}-today-synced.png', full_page=True)

    # ---- Lessons ----
    print('lesson queue:', page.evaluate("(async () => { const s = await import('/js/state.js'); return s.lessonQueue().available.map(c => c.char).join(''); })()"))
    page.click('[data-act="lessons"]')
    page.wait_for_selector('.is-study .player-host svg')
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/{VIEW}-lesson-study.png')
    n_lessons = int(page.locator('.study-count').inner_text().split(' of ')[1])
    for i in range(n_lessons):
        try:
            page.wait_for_selector('.is-study', timeout=5000)
        except Exception:
            page.screenshot(path=f'{OUT}/{VIEW}-FAIL.png')
            print('errors:', errors)
            raise
        ch = page.locator('.prompt .answer-char').inner_text().strip()
        page.click('[data-act="trace"]')
        page.wait_for_selector('.is-trace .pad-ink')
        if i == 0:
            page.screenshot(path=f'{OUT}/{VIEW}-lesson-trace.png')
        draw(page, glyph_points(page, ch), scale=1.0, shift=(0, 0))
        page.click('[data-act="check"]')
        page.wait_for_selector('.trace-actions:not([hidden])')
        if i == 0:
            page.wait_for_timeout(900)
            page.screenshot(path=f'{OUT}/{VIEW}-lesson-trace-checked.png')
        print('trace', ch, page.locator('.score .num').inner_text())
        page.click('[data-act="continue"]')
    page.wait_for_selector('[data-act="quiz"]')
    page.screenshot(path=f'{OUT}/{VIEW}-lesson-quiz-intro.png')
    page.click('[data-act="quiz"]')

    # ---- Quiz: write each from memory; first one with wrong order, use undo-grade once ----
    seen = 0
    did_wrong = did_undo = did_hint = did_reveal = False
    while True:
        page.wait_for_selector('.desk .pad-ink, .summary', timeout=10000)
        if page.locator('.summary').count():
            break
        ch = char_for_prompt(page, kana)
        pts = glyph_points(page, ch)
        if seen == 0 and VIEW == 'desktop':
            page.screenshot(path=f'{OUT}/{VIEW}-review-prompt.png')
        if not did_hint and seen == 1:
            page.click('[data-act="hint"]')
            page.wait_for_timeout(300)
            page.screenshot(path=f'{OUT}/{VIEW}-review-hint.png')
            did_hint = True
        if not did_reveal and seen == 2:
            page.click('[data-act="reveal"]')
            did_reveal = True
        elif not did_wrong and len(pts) >= 2:
            draw(page, pts, order=list(range(len(pts)))[::-1])
            did_wrong = True
            page.keyboard.press('Enter')
        else:
            draw(page, pts)
            page.keyboard.press('Enter')
        page.wait_for_selector('.ratings:not([hidden]) .rate')
        page.wait_for_timeout(700)
        sug = page.locator('.rate.is-suggested').get_attribute('data-r') if page.locator('.rate.is-suggested').count() else None
        score = page.locator('.score .num').inner_text() if page.locator('.score .num').count() else '-'
        issues = page.locator('.issues li').all_inner_texts()
        times = page.locator('.rate-time').all_inner_texts()
        print(f'quiz {ch}: score {score} suggested {sug} times {times} issues {issues[:2]}')
        if seen < 4:
            page.screenshot(path=f'{OUT}/{VIEW}-review-feedback-{seen}.png')
        if not did_undo and seen == 3:
            w = page.locator('.writer').element_handle()
            page.keyboard.press('Enter')
            page.wait_for_function('el => !el.isConnected', arg=w)
            w = page.locator('.writer').element_handle()
            page.click('[data-act="undo-answer"]')
            page.wait_for_function('el => !el.isConnected', arg=w)
            page.wait_for_selector('.desk .pad-ink')
            print('  undo ->', char_for_prompt(page, kana))
            did_undo = True
            seen += 1
            continue
        w = page.locator('.writer').element_handle()
        page.keyboard.press('Enter')
        page.wait_for_function('el => !el.isConnected', arg=w)
        seen += 1
        if seen > 40:
            raise RuntimeError('quiz did not finish')
    page.screenshot(path=f'{OUT}/{VIEW}-quiz-summary.png', full_page=True)
    print('summary:', page.locator('.summary-line').inner_text())
    page.click('.summary [data-act="end"]')
    page.wait_for_selector('.today')
    print('today reviews due:', page.locator('.action .num').first.inner_text())
    page.screenshot(path=f'{OUT}/{VIEW}-today-after.png', full_page=True)

    # ---- Characters + detail ----
    page.goto(BASE + '#characters')
    page.wait_for_selector('.characters .cell')
    page.click('.seg [data-kind="kanji"]')
    page.locator('.characters .cell').first.click()
    page.wait_for_selector('dialog.detail[open]')
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/{VIEW}-detail.png')
    print('detail stats:', page.locator('dialog .stats').inner_text().replace('\n', ' | '))
    page.click('dialog [data-act="practice"]')
    page.wait_for_selector('.study .pad-ink')
    print('practice title:', page.locator('.study-title').inner_text())

    # ---- persistence: reload and check cards survived ----
    page.goto(BASE + '#today')
    page.reload()
    page.wait_for_selector('.today')
    print('after reload due:', page.locator('.action .num').first.inner_text(), '| studied:', page.locator('.sheet-head .sub').inner_text())
    print('errors:', errors or 'none')
    b.close()
