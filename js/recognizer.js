// Main-thread wrapper around the recognition worker.

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./recognizer.worker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('Recognition worker unavailable', err);
    return null;
  }
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    console.warn('Recognition worker error', e.message);
    for (const p of pending.values()) p.reject(new Error('recognizer crashed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(msg, timeoutMs = 20000) {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('recognizer unavailable'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...msg, id });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('recognizer timed out'));
      }
    }, timeoutMs);
  });
}

/** Start loading the reference patterns in the background. */
export function warmRecognizer() {
  call({ type: 'warm' }).catch(() => {});
}

// Characters whose shapes are identical or nearly so; recognising one counts as the other.
const LOOKALIKES = [
  ['口', 'ロ'], ['力', 'カ'], ['工', 'エ'], ['二', 'ニ'], ['八', 'ハ'], ['夕', 'タ'], ['卜', 'ト'],
  ['へ', 'ヘ'], ['べ', 'ベ'], ['ぺ', 'ペ'], ['一', 'ー'],
];
const lookalikeMap = new Map();
for (const group of LOOKALIKES) for (const c of group) lookalikeMap.set(c, new Set([...(lookalikeMap.get(c) || []), ...group]));

export function sameShape(a, b) {
  return a === b || (lookalikeMap.get(a)?.has(b) ?? false);
}

/**
 * Recognise drawn strokes.
 * @returns {Promise<{candidates: [string, number][], rank: number}|null>}
 *   rank is the position of the target (or a look-alike) among candidates, -1 if absent.
 */
export async function recognizeStrokes(strokes, target, targetStrokes) {
  try {
    const res = await call({ type: 'recognize', strokes, target, targetStrokes });
    const candidates = res.candidates || [];
    const rank = candidates.findIndex(([c]) => sameShape(c, target));
    return { candidates, rank };
  } catch (err) {
    console.warn('Recognition skipped:', err.message);
    return null;
  }
}
