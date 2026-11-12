"""Build a compact recognition reference set for the KanjiCanvas recognizer.

Inputs (passed as arguments, never imported):
  1. KanjiCanvas ref-patterns.js  (hand-written kanji patterns, already normalized)
  2. KanjiCanvas hiragana/ dir    (jTegaki XML hand-written samples)
  3. KanjiCanvas katakana/ dir
Output: JSON list [[char, strokeCount, [[x0,y0,x1,y1,...], ...]], ...] with integer coords.

Kana samples are normalized exactly like KanjiCanvas does for live input
(moment normalization, then feature points every 20 units).
"""
import json, math, os, re, sys
import xml.etree.ElementTree as ET

ref_js, hira_dir, kata_dir, out = sys.argv[1:5]


def moment_normalize(pattern):
    xs = [p[0] for s in pattern for p in s]
    ys = [p[1] for s in pattern for p in s]
    old_w = abs(max(xs) - min(xs))
    old_h = abs(max(ys) - min(ys))
    r1 = (old_w / old_h if old_h > old_w else (old_h / old_w if old_w else 0))
    r2 = math.sqrt(math.sin((math.pi / 2.0) * r1))
    aw, ah = 256.0, 256.0
    if old_h > old_w:
        aw = r2 * 256
    else:
        ah = r2 * 256
    xoff, yoff = (256 - aw) / 2, (256 - ah) / 2
    m00 = len(xs)
    xc, yc = sum(xs) / m00, sum(ys) / m00
    mu20 = sum((x - xc) ** 2 for x in xs)
    mu02 = sum((y - yc) ** 2 for y in ys)
    alpha = aw / (4 * math.sqrt(mu20 / m00)) if mu20 else 0
    beta = ah / (4 * math.sqrt(mu02 / m00)) if mu02 else 0
    return [[[alpha * (x - xc) + aw / 2 + xoff, beta * (y - yc) + ah / 2 + yoff] for x, y in s] for s in pattern]


def extract_features(pattern, interval=20.0):
    out = []
    for s in pattern:
        ex = []
        dist = 0.0
        for j in range(len(s)):
            if j == 0:
                ex.append(s[0])
            if j > 0:
                dist += math.dist(s[j - 1], s[j])
            if dist >= interval and j > 1:
                dist -= interval
                ex.append(s[j])
        if len(ex) == 1:
            ex.append(s[-1])
        elif dist > 0.75 * interval:
            ex.append(s[-1])
        out.append(ex)
    return out


def flat(stroke):
    return [int(round(v)) for p in stroke for v in p]


refs = []
src = open(ref_js, encoding='utf-8').read()
body = src[src.index('KanjiCanvas.refPatterns'):]
body = body[body.index('['):]
body = body[:body.rindex(']') + 1]
body = re.sub(r',\s*\]', ']', body)  # trailing commas
for ch, n, pat in json.loads(body):
    refs.append([ch, n, [flat(s) for s in pat]])
kanji_count = len(refs)

for d in (hira_dir, kata_dir):
    for fn in sorted(os.listdir(d)):
        if not fn.endswith('.xml'):
            continue
        ch = chr(int(fn[:-4], 16))
        root = ET.parse(os.path.join(d, fn)).getroot()
        strokes = [[[int(p.attrib['x']), int(p.attrib['y'])] for p in st] for st in root.iter('stroke')]
        strokes = [s for s in strokes if s]
        if not strokes:
            continue
        refs.append([ch, len(strokes), [flat(s) for s in extract_features(moment_normalize(strokes))]])

json.dump(refs, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(kanji_count, 'kanji +', len(refs) - kanji_count, 'kana patterns;', os.path.getsize(out), 'bytes')
