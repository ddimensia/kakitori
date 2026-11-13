"""Compare a freshly built kanji-info.json with the current one, print a Markdown summary,
and exit with an error if the new file looks broken, so a scheduled update never commits it.

Usage: python3 tools/check_kanji_info.py CURRENT.json NEW.json
"""
import json, sys

old = json.load(open(sys.argv[1], encoding='utf-8'))
new = json.load(open(sys.argv[2], encoding='utf-8'))
ok, notes = True, []


def fail(msg):
    global ok
    ok = False
    notes.append(f'**Problem:** {msg}')


# The lists are fixed sets that change rarely; a big swing means a parsing or source problem.
for name, minimum in (('jlpt', 2000), ('grade', 2100), ('frequency', 2400)):
    a, b = old['lists'].get(name, []), new['lists'].get(name, [])
    if len(b) < minimum:
        fail(f'the {name} list has only {len(b)} kanji (expected at least {minimum}).')
    gone = set(a) - set(b)
    if len(gone) > len(a) * 0.02:
        fail(f'{len(gone)} kanji dropped out of the {name} list.')

K = new['kanji']
listed = set().union(*map(set, new['lists'].values()))
missing = [c for c in listed if c not in K]
if missing:
    fail(f'{len(missing)} listed kanji have no entry, e.g. {"".join(missing[:10])}.')
no_meaning = [c for c in listed if c in K and not K[c].get('m')]
if len(no_meaning) > len(listed) * 0.01:
    fail(f'{len(no_meaning)} kanji have no meaning.')
no_reading = [c for c in listed if c in K and not (K[c].get('on') or K[c].get('kun'))]
if len(no_reading) > len(listed) * 0.01:
    fail(f'{len(no_reading)} kanji have no reading.')
old_words = sum(1 for e in old['kanji'].values() if e.get('w'))
new_words = sum(1 for e in K.values() if e.get('w'))
if new_words < old_words * 0.9:
    fail(f'only {new_words} kanji have example words, down from {old_words}.')

changed = {f: 0 for f in ('m', 'on', 'kun', 'w')}
for c, e in K.items():
    o = old['kanji'].get(c, {})
    for f in changed:
        if e.get(f) != o.get(f):
            changed[f] += 1

src = new.get('sources', {})
print('### Kanji data update\n')
print(f"KANJIDIC2 {src.get('kanjidic2', {}).get('dictDate')}, JMdict {src.get('jmdict', {}).get('dictDate')}"
      f" (jmdict-simplified {src.get('jmdict', {}).get('version')}).\n")
print('| | Current | New |\n| --- | --- | --- |')
for name in ('jlpt', 'grade', 'frequency'):
    print(f"| {name} list | {len(old['lists'].get(name, []))} | {len(new['lists'].get(name, []))} |")
print(f'| kanji with example words | {old_words} | {new_words} |\n')
print(f"Changed: meanings {changed['m']}, on'yomi {changed['on']}, kun'yomi {changed['kun']}, example words {changed['w']} (of {len(K)} kanji).\n")
for n in notes:
    print(n + '\n')
sys.exit(0 if ok else 1)
