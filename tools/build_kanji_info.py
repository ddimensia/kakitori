"""Build data/kanji-info.json: the built-in kanji lists (JLPT, school grade, frequency)
with meanings, readings and example words, for studying without WaniKani.

Usage:
  python3 tools/build_kanji_info.py KANJIDIC2.json JMDICT.json TANOS_KANJI_DIR JLPT_VOCAB_DIR OUT.json

Inputs (data only; read, never executed):
  KANJIDIC2.json   kanjidic2-en-*.json from a jmdict-simplified release
                   (github.com/scriptin/jmdict-simplified, rebuilt weekly from EDRDG's files).
                   KANJIDIC2 is EDRDG, CC BY-SA 4.0.
  JMDICT.json      jmdict-eng-*.json (the full English file, not "common") from the same release.
                   JMdict is EDRDG, CC BY-SA 4.0.
  TANOS_KANJI_DIR  folder with n5_kanji.csv ... n1_kanji.csv (github.com/Bluskyo/JLPT_Vocabulary,
                   data/kanji/parsedData), Jonathan Waller's JLPT kanji lists, CC BY.
  JLPT_VOCAB_DIR   folder with n1.csv ... n5.csv (github.com/jamsinclair/open-anki-jlpt-decks, src),
                   JLPT vocabulary lists, MIT. Used only to favor JLPT words as examples.

.github/workflows/update-kanji-data.yml runs this every month with the latest release, as
the EDRDG licence asks for regular updates from the most recent data.
"""
import csv, json, os, re, sys

kanjidic_path, jmdict_path, tanos_dir, vocab_dir, out_path = sys.argv[1:6]


def load_kanjidic(path):
    """KANJIDIC2 entries keyed by character, reduced to the fields used below."""
    data = json.load(open(path, encoding='utf-8'))
    out = {}
    for ch in data['characters']:
        misc = ch.get('misc') or {}
        rm = ch.get('readingMeaning') or {}
        readings, meanings = {'ja_on': [], 'ja_kun': []}, []
        for g in rm.get('groups') or []:
            for r in g.get('readings') or []:
                if r['type'] in readings:
                    readings[r['type']].append(r['value'])
            meanings += [m['value'] for m in g.get('meanings') or [] if m.get('lang', 'en') == 'en']
        out[ch['literal']] = {
            'freq': misc.get('frequency'), 'grade': misc.get('grade'),
            'strokeCounts': misc.get('strokeCounts') or [],
            'readings': readings, 'meanings': {'en': meanings},
        }
    return out, {k: data.get(k) for k in ('version', 'dictDate', 'databaseVersion')}


BAD_FORM = {'iK', 'oK', 'rK', 'sK', 'ik', 'ok', 'rk', 'sk'}  # irregular, outdated, rare, search-only


def load_vocab(path, vocab_dir):
    """JMdict words that are common or on a JLPT list: written form, reading, first gloss, JLPT level."""
    jlpt = {}
    for n in (1, 2, 3, 4, 5):
        with open(os.path.join(vocab_dir, f'n{n}.csv'), encoding='utf-8') as f:
            for row in csv.DictReader(f):
                # Either field can hold alternatives: "行く,いく; ゆく"
                for x in re.split(r'[;；、,]', row['expression']):
                    for r in re.split(r'[;；、,]', row['reading']):
                        x, r = (re.sub(r'[(（][^)）]*[)）]', '', t).strip(' 〜～') for t in (x, r))  # drop notes: "こす (みずを～)"
                        if r.endswith('する') and not x.endswith('する'):
                            r = r[:-2]  # suru verbs: "相談,そうだんする"
                        jlpt[(x, r)] = max(jlpt.get((x, r), 0), n)  # a word on several lists counts at its easiest
    data = json.load(open(path, encoding='utf-8'))
    out = []
    for e in data['words']:
        kanji = [k for k in e['kanji'] if not BAD_FORM & set(k['tags'])] or e['kanji']
        kana = [k for k in e['kana'] if not BAD_FORM & set(k['tags'])] or e['kana']
        if not kana or not e['sense']:
            continue
        in_kana = not e['kanji'] or 'uk' in e['sense'][0]['misc']
        # Match the list's spelling to this word's spellings. A kana spelling only counts for
        # words usually written in kana, or every homophone (こう, かう...) would match.
        forms = {k['text'] for k in e['kanji']} | ({k['text'] for k in e['kana']} if in_kana else set())
        level = max((jlpt.get((x, k['text']), 0) for x in forms for k in e['kana']), default=0)
        common = any(k['common'] for k in e['kanji'] + e['kana'])
        if not (common or level):
            continue
        if kanji and not in_kana:
            word = next((k for k in kanji if k['common']), kanji[0])['text']
        else:
            word = None  # usually written in kana
        if word:
            fits = [k for k in kana if '*' in k['appliesToKanji'] or word in k['appliesToKanji']] or kana
        else:
            fits = kana
        reading = next((k for k in fits if k['common']), fits[0])['text']
        word = word or reading
        sense = next((s for s in e['sense'] if '*' in s['appliesToKanji'] or word in s['appliesToKanji']), e['sense'][0])
        glosses = [g['text'] for g in sense['gloss']]
        if glosses:
            out.append({'word': word, 'reading': reading, 'meanings': glosses, 'jlpt': f'N{level}' if level else None})
    return out, {k: data.get(k) for k in ('version', 'dictDate')}


K, kanjidic_version = load_kanjidic(kanjidic_path)


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
vocab, jmdict_version = load_vocab(jmdict_path, vocab_dir)
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
    'sources': {'kanjidic2': kanjidic_version, 'jmdict': jmdict_version},
    'lists': {'jlpt': jlpt_order, 'grade': grade_order, 'frequency': freq_order},
    'kanji': info,
}
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
no_words = [c for c in chars if not words.get(c)]
print(f"jlpt {len(jlpt_order)}, grade {len(grade_order)}, frequency {len(freq_order)}, kanji {len(info)}; "
      f"without example words: {len(no_words)}; {os.path.getsize(out_path) / 1e6:.2f} MB")
