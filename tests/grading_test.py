"""Usage: python3 tests/grading_test.py <kanjivg/kanji dir> [lenient|normal|strict] [-v section...]
Run synthetic grading tests in the browser and summarise the results."""
import json, os, re, sys, random, statistics
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')
KVG = sys.argv[1]  # KanjiVG kanji directory (data only; parsed, never executed)
strictness = sys.argv[2] if len(sys.argv) > 2 else 'normal'

path_re = re.compile(r'<path[^>]*id="kvg:[0-9a-f]+-[A-Za-z]*-?s(\d+)"[^>]*\sd="([^"]+)"')
files = sorted(f for f in os.listdir(KVG) if f.endswith('-Kaisho.svg'))
random.seed(7)
variants = {}
for f in random.sample(files, 60):
    cp = int(f.split('-')[0], 16)
    txt = open(os.path.join(KVG, f), encoding='utf-8').read()
    strokes = sorted((int(n), d) for n, d in re.findall(r'<path[^>]*id="kvg:[^"]*-s(\d+)"[^>]*\sd="([^"]+)"', txt))
    if strokes:
        variants[chr(cp)] = [d for _, d in strokes]

js = open(os.path.join(os.path.dirname(__file__), 'grading_test.js'), encoding='utf-8').read()

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(service_workers='block')
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + '#today')
    page.wait_for_selector('.today')
    res = page.evaluate(js + '\nrunGradingTests(' + json.dumps(variants, ensure_ascii=False) + ', ' + json.dumps(strictness) + ')')
    b.close()

def summ(name, rows, show=False):
    if not rows:
        return
    scores = [r['score'] for r in rows]
    sug = {k: sum(1 for r in rows if r['sug'] == k) for k in (1, 2, 3, 4)}
    errs_ = {k: sum(1 for r in rows if r['err'][k] > 0) for k in ('order', 'direction', 'missing', 'extra')}
    ranks = [r['rank'] for r in rows if r['rank'] is not None]
    top1 = sum(1 for x in ranks if x == 0)
    print(f"{name:9s} n={len(rows):3d} score med={statistics.median(scores):5.1f} min={min(scores):3d} max={max(scores):3d}  "
          f"suggest x/△/○/◎={sug[1]}/{sug[2]}/{sug[3]}/{sug[4]}  flagged order={errs_['order']} dir={errs_['direction']} "
          f"missing={errs_['missing']} extra={errs_['extra']}  recog top1={top1}/{len(ranks)}")
    if show:
        for r in rows:
            print('   ', r['c'], r.get('drawn', ''), r['score'], r['sug'], r['err'], 'rank', r['rank'], 'top', r.get('top'), '|', '; '.join(r['issues'][:3]))

for k in ('correct', 'sloppy', 'variants', 'order', 'reversed', 'missing', 'wrong'):
    summ(k, res[k], show='-v' in sys.argv and k in sys.argv)
if errs:
    print('page errors:', errs)
