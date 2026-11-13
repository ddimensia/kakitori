"""List the large static files the service worker stores at install time, so the
installed app works fully offline. Run after changing data/ or fonts/.

Usage: python3 tools/build_precache.py <app dir>
"""
import hashlib, json, os, sys

app = sys.argv[1]
files = []  # data/kanji-info.json is updated monthly, so sw.js keeps it with the app files instead
for folder in ('data/strokes', 'fonts'):
    for fn in sorted(os.listdir(os.path.join(app, folder))):
        if fn.endswith(('.json', '.woff2')):
            files.append(f'{folder}/{fn}')
size = sum(os.path.getsize(os.path.join(app, f)) for f in files)
h = hashlib.sha1()
for f in files:
    h.update(f.encode())
    h.update(open(os.path.join(app, f), 'rb').read())
# The version names the service worker's data cache: it changes only when these files do,
# so app updates don't re-download 15 MB of fonts and stroke data.
json.dump({'version': h.hexdigest()[:12], 'files': files, 'bytes': size}, open(os.path.join(app, 'precache.json'), 'w'), indent=0)
print(len(files), 'files,', round(size / 1e6, 1), 'MB')
