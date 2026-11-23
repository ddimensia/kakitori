// Read the kanji progress that Kumitate Kanji shares with other apps on this site.
//
// Kumitate Kanji writes a summary to its own small database, 'kumitate-share' (format 1):
//   { format: 1, app: 'kumitate-kanji', updatedAt, kanji: [{ ch, order, jlpt, introducedAt, passedAt, stage }] }
// Both apps are served from the same origin (ddimensia.github.io), so they share IndexedDB.
// This module only reads. Opening a database that doesn't exist would create it, so the open
// has no version and the upgrade is aborted if one starts: a database that didn't exist
// stays that way, and Kumitate Kanji's own databases are never touched.

const SHARE_DB = 'kumitate-share';
const STORE = 'summary';
const KEY = 'progress';

/** How far along a kanji must be in Kumitate Kanji to be included. */
export const KUMITATE_THRESHOLDS = [
  { value: 'started', label: 'Every kanji you’ve started' },
  { value: 'fresh', label: 'Kanji past their first day of reviews' },
  { value: 'passed', label: 'Kanji that have unlocked their words' },
];

const PAST_FIRST_DAY = new Set(['fresh', 'settling', 'solid', 'mastered']);

export function meetsThreshold(k, threshold) {
  if (threshold === 'passed') return !!k.passedAt;
  if (threshold === 'fresh') return !!k.passedAt || PAST_FIRST_DAY.has(k.stage);
  return true;
}

/**
 * The shared summary, or null if Kumitate Kanji hasn't shared anything in this browser.
 * Rejects only if storage itself fails.
 */
export function readKumitate() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(SHARE_DB); } catch (err) { reject(err); return; }
    let missing = false;
    req.onupgradeneeded = () => {
      // The database didn't exist: abort so it isn't created.
      missing = true;
      req.transaction.abort();
    };
    req.onerror = (e) => {
      if (missing) { e.preventDefault(); resolve(null); } else reject(req.error);
    };
    req.onblocked = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(null); return; }
      let t;
      try { t = db.transaction(STORE, 'readonly'); } catch (err) { db.close(); reject(err); return; }
      const get = t.objectStore(STORE).get(KEY);
      get.onsuccess = () => {
        db.close();
        const v = get.result;
        resolve(v && v.format === 1 && Array.isArray(v.kanji) ? v : null);
      };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  });
}
