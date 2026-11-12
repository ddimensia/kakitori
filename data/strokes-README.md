# Stroke data

`strokes/*.json` is adapted from [KanjiVG](https://kanjivg.tagaini.net) by Ulrich Apel.

The changes: each character's stroke paths and stroke-number positions were extracted
from KanjiVG's SVG files, converted to JSON, and split into one file per 256 Unicode
code points. Variant files (Kaisho and others) were left out. The extraction script is
`tools/build_strokes.py`.

KanjiVG is licensed under Creative Commons Attribution-ShareAlike 3.0
(https://creativecommons.org/licenses/by-sa/3.0/). The full text is in
`KanjiVG-COPYING.txt`. These adapted files are shared under the same license.
