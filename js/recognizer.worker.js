// Handwriting recognition worker: runs the KanjiCanvas matcher off the main thread.
import { recognize, buildPattern } from '../vendor/kanjicanvas-core.js';

let refsPromise = null;
let refChars = null;

function loadRefs() {
  if (!refsPromise) {
    refsPromise = fetch(new URL('../data/kc-refs.json', import.meta.url))
      .then((r) => {
        if (!r.ok) throw new Error(`reference patterns unavailable (${r.status})`);
        return r.json();
      })
      .then((list) => {
        const refs = list.map(([c, n, strokes]) => [
          c,
          n,
          strokes.map((flat) => {
            const pts = [];
            for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
            return pts;
          }),
        ]);
        refChars = new Set(refs.map((r) => r[0]));
        return refs;
      })
      .catch((err) => {
        refsPromise = null;
        throw err;
      });
  }
  return refsPromise;
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    const refs = await loadRefs();
    if (type === 'warm') {
      self.postMessage({ id, ok: true, size: refs.length });
      return;
    }
    const { strokes, target, targetStrokes } = e.data;
    let pool = refs;
    // Characters missing from the hand-written set get a pattern built from KanjiVG on the fly,
    // so the target can always compete against look-alikes.
    if (target && targetStrokes && targetStrokes.length && !refChars.has(target)) {
      pool = refs.concat([[target, targetStrokes.length, buildPattern(targetStrokes)]]);
    }
    const candidates = recognize(strokes, pool, 100);
    self.postMessage({ id, ok: true, candidates, targetKnown: refChars.has(target) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
