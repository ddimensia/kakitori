"""Usage: serve the app on BASE (default http://127.0.0.1:8765/), then: python3 tests/recognizer_trust_test.py
The recognizer's misreads don't count against a drawing whose strokes match closely (a
lopsided ろ read as レ), but still count when the strokes are off (る drawn for ろ)."""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('ok -', msg)


JS = r"""
async () => {
  const { getGlyph } = await import('./js/strokes.js');
  const { gradeAttempt } = await import('./js/grader.js');
  const ro = await getGlyph('ろ'), ru = await getGlyph('る');
  const pad = (g, f = (x, y) => [x, y]) => g.points.map((s) => s.filter((_, i) => i % 2 === 0).map(([x, y]) => f(x, y)).map(([x, y]) => [x * 1.4 + 20, y * 1.4 + 10]));
  // ろ with its top bar drawn short and the bottom wide.
  const ys = ro.points.flat().map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const lopsided = pad(ro, (x, y) => { const t = (y - y0) / (y1 - y0); return [20 + (x - 20) * (0.75 + 0.35 * t), y]; });
  const misread = { candidates: [['レ', 1], ['し', 2], ['く', 3], ['つ', 4], ['へ', 5], ['ろ', 6]], rank: 5 };
  const a = gradeAttempt({ userStrokes: lopsided, glyph: ro, recognition: misread });
  const b = gradeAttempt({ userStrokes: lopsided, glyph: ro, recognition: null });
  const c = gradeAttempt({ userStrokes: pad(ru), glyph: ro, recognition: { candidates: [['る', 1], ['ろ', 2]], rank: 1 } });
  const d = gradeAttempt({ userStrokes: pad(ru), glyph: ro, recognition: { candidates: [['る', 1], ['そ', 2], ['ら', 3], ['ち', 4], ['の', 5]], rank: -1 } });
  return { a: [a.score, a.suggested, a.issues, a.recognised.counted], b: [b.score, b.suggested], c: [c.score, c.suggested], d: [d.score, d.suggested, d.issues, d.recognised.counted] };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(BASE + '#settings')
    pg.wait_for_selector('.settings-form')
    r = pg.evaluate(JS)
    print(r)
    check(r['a'][0] == r['b'][0] and r['a'][1] == r['b'][1], 'a lopsided ろ read as レ scores as if the recognizer agreed')
    check(not any('recognizer read' in i for i in r['a'][2]) and r['a'][3] is False, 'no "read as レ" message, marked not counted')
    check(r['a'][1] >= 3, 'and is graded as remembered')
    check(r['c'][1] == 1 and r['d'][1] == 1, 'る drawn for ろ still counts as forgotten')
    check(r['d'][3] is True, 'with the recognizer counted, since the strokes are off')
    b.close()
