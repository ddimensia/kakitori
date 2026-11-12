"""Build data/kanji-info.json: the built-in kanji lists (JLPT, school grade, frequency)
with meanings, readings and example words, for studying without WaniKani.

Usage:
  python3 tools/build_kanji_info.py KANJIS.json TANOS_KANJI_DIR VOCAB.json OUT.json

Inputs (data only; read, never executed):
  KANJIS.json      KANJIDIC2 as JSON (npm package kanjidic2-json). EDRDG, CC BY-SA 4.0.
  TANOS_KANJI_DIR  folder with n5_kanji.csv ... n1_kanji.csv (github.com/Bluskyo/JLPT_Vocabulary,
                   data/kanji/parsedData), Jonathan Waller's JLPT lists, CC BY.
  VOCAB.json       JMdict-derived word list with readings, glosses and JLPT tags (npm package
                   kotobako-data, kotobako-static.json). JMdict is EDRDG, CC BY-SA 4.0.
"""
import csv, json, os, sys

kanjidic_path, tanos_dir, vocab_path, out_path = sys.argv[1:5]

K = {k['literal']: k for k in json.load(open(kanjidic_path, encoding='utf-8'))}


def is_kanji(c):
    return '一' <= c <= '鿿' or c == '々'


# ---- Lists -------------------------------------------------------------------
jlpt_order, jlpt_level = [], {}
for n in (5, 4, 3, 2, 1):
    with open(os.path.join(tanos_dir, f'n{n}_kanji.csv'), encoding='utf-8') as f:
        for row in csv.DictReader(f):
            c = row['Kanji'].strip()
            if c and c not in jlpt_level:
                jlpt_level[c] = n
                jlpt_order.append(c)

INF = 10 ** 6
freq = lambda c: K[c].get('freq') or INF
strokes = lambda c: (K[c].get('strokeCounts') or [99])[0]

joyo = [c for c, k in K.items() if k.get('grade') and k['grade'] <= 8]
grade_order = sorted(joyo, key=lambda c: (K[c]['grade'], freq(c), strokes(c), c))
freq_order = sorted((c for c, k in K.items() if k.get('freq')), key=freq)

chars = set(jlpt_order) | set(grade_order) | set(freq_order)

# ---- Example words -------------------------------------------------------------
vocab = json.load(open(vocab_path, encoding='utf-8'))['datasets']['vocab']
JLPT_RANK = {'N5': 0, 'N4': 1, 'N3': 2, 'N2': 3, 'N1': 4}
candidates = {}
for v in vocab:
    w, r, m = v.get('word') or '', v.get('reading') or '', v.get('meanings') or []
    if not (2 <= len(w) <= 4) or not r or not m:
        continue
    if any(not (is_kanji(c) or '぀' <= c <= 'ヿ') for c in w):
        continue  # skip words with Latin letters, digits or symbols
    gloss = m[0].strip()
    if len(gloss) > 40:
        gloss = gloss[:39].rstrip() + '…'
    for c in set(w):
        if c not in chars:
            continue
        others = [o for o in w if is_kanji(o) and o != c]
        score = JLPT_RANK.get(v.get('jlpt'), 5) + 0.5 * (len(w) - 2)
        target_rank = freq(c)
        for o in others:
            if o not in K or freq(o) > max(target_rank, 1500) + 300:
                score += 2  # companion kanji much rarer than the one being practised
        if w.count(c) > 1:
            score += 3
        candidates.setdefault(c, []).append((score, w, r, gloss))

words = {}
for c, lst in candidates.items():
    lst.sort(key=lambda x: (x[0], x[1]))
    seen, picked = set(), []
    for score, w, r, g in lst:
        if w in seen:
            continue
        seen.add(w)
        picked.append([w, r, g])
        if len(picked) == 4:
            break
    words[c] = picked

# ---- Meanings and readings -----------------------------------------------------
def kun_list(raw):
    plain = [x for x in raw if not x.startswith('-') and not x.endswith('-')]
    out, seen = [], set()
    for x in plain or raw:
        key = x.replace('.', '')
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out[:5]


info = {}
for c in sorted(chars, key=lambda c: (freq(c), c)):
    k = K[c]
    rd = k.get('readings', {})
    entry = {
        'm': (k.get('meanings', {}).get('en') or [])[:6],
        'on': (rd.get('ja_on') or [])[:4],
        'kun': kun_list(rd.get('ja_kun') or []),
        's': strokes(c),
    }
    if k.get('grade'):
        entry['g'] = k['grade']
    if k.get('freq'):
        entry['f'] = k['freq']
    if c in jlpt_level:
        entry['j'] = jlpt_level[c]
    if words.get(c):
        entry['w'] = words[c]
    info[c] = entry

out = {
    'about': 'Kanji lists, meanings, readings and example words for Kakitori. '
             'Meanings, readings, school grades and frequency ranks: KANJIDIC2; example words: JMdict '
             '(both EDRDG, CC BY-SA 4.0, https://www.edrdg.org/edrdg/licence.html). '
             'JLPT levels: Jonathan Waller, tanos.co.uk, CC BY. This file is shared under CC BY-SA 4.0.',
    'lists': {'jlpt': jlpt_order, 'grade': grade_order, 'frequency': freq_order},
    'kanji': info,
}
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
no_words = [c for c in chars if not words.get(c)]
print(f"jlpt {len(jlpt_order)}, grade {len(grade_order)}, frequency {len(freq_order)}, kanji {len(info)}; "
      f"without example words: {len(no_words)}; {os.path.getsize(out_path) / 1e6:.2f} MB")
