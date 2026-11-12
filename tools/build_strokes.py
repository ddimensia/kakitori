"""Extract KanjiVG stroke paths into sharded JSON: data/strokes/<cp>>8 hex>.json
Each shard: { "字": {"s": [d1, d2, ...], "n": [[x,y], ...]} }"""
import os, re, json, sys, collections
src = sys.argv[1]; out = sys.argv[2]
path_re = re.compile(r'<path[^>]*id="kvg:[0-9a-f]+-s(\d+)"[^>]*\sd="([^"]+)"')
num_re = re.compile(r'<text transform="matrix\(1 0 0 1 ([\d.\-]+) ([\d.\-]+)\)">(\d+)</text>')
shards = collections.defaultdict(dict)
count = 0
for fn in sorted(os.listdir(src)):
    if '-' in fn or not fn.endswith('.svg'): continue
    cp = int(fn[:-4], 16)
    if cp < 0x3000: continue
    txt = open(os.path.join(src, fn), encoding='utf-8').read()
    strokes = sorted((int(n), d) for n, d in path_re.findall(txt))
    if not strokes: continue
    nums = {int(k): [round(float(x), 1), round(float(y), 1)] for x, y, k in num_re.findall(txt)}
    entry = {"s": [d for _, d in strokes]}
    if nums: entry["n"] = [nums.get(i + 1) for i in range(len(strokes))]
    shards[cp >> 8][chr(cp)] = entry
    count += 1
total = 0
for k, v in shards.items():
    p = os.path.join(out, f"{k:02x}.json")
    s = json.dumps(v, ensure_ascii=False, separators=(',', ':'))
    open(p, 'w', encoding='utf-8').write(s)
    total += len(s.encode())
print(count, "chars;", len(shards), "shards;", round(total/1e6, 2), "MB")
