// Persistence: IndexedDB with an in-memory fallback.
// Stores: kv (settings, sync metadata), cards, subjects (WaniKani kanji data), log (review history).

const DB_NAME = 'kakitori';
const DB_VERSION = 1;
const STORES = ['kv', 'cards', 'subjects', 'log'];

let dbPromise = null;
let memory = null; // fallback when IndexedDB is unavailable

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('subjects')) db.createObjectStore('subjects', { keyPath: 'char' });
      if (!db.objectStoreNames.contains('log')) {
        const log = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
        log.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is open in another tab with an older version.'));
  });
  return dbPromise;
}

export async function initStore() {
  try {
    await openDb();
    return { persistent: true };
  } catch (err) {
    console.warn('IndexedDB unavailable, using memory only', err);
    memory = { kv: new Map(), cards: new Map(), subjects: new Map(), log: new Map(), logSeq: 0 };
    return { persistent: false };
  }
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then((r) => { result = r; });
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('transaction aborted'));
      }),
  );
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const keyOf = (store, obj) => (store === 'cards' ? obj.id : store === 'subjects' ? obj.char : obj.id);

export async function kvGet(key) {
  if (memory) return memory.kv.get(key);
  return tx('kv', 'readonly', (s) => reqP(s.get(key)));
}

export async function kvSet(key, value) {
  if (memory) { memory.kv.set(key, value); return; }
  return tx('kv', 'readwrite', (s) => { s.put(value, key); });
}

export async function getAll(store) {
  if (memory) return [...memory[store].values()];
  return tx(store, 'readonly', (s) => reqP(s.getAll()));
}

export async function putMany(store, items) {
  if (!items.length) return;
  if (memory) { for (const it of items) memory[store].set(keyOf(store, it), it); return; }
  return tx(store, 'readwrite', (s) => { for (const it of items) s.put(it); });
}

export const put = (store, item) => putMany(store, [item]);

export async function remove(store, key) {
  if (memory) { memory[store].delete(key); return; }
  return tx(store, 'readwrite', (s) => { s.delete(key); });
}

export async function addLog(entry) {
  if (memory) { const id = ++memory.logSeq; memory.log.set(id, { ...entry, id }); return id; }
  return tx('log', 'readwrite', (s) => reqP(s.add(entry)));
}

export async function logSince(ts) {
  if (memory) return [...memory.log.values()].filter((e) => e.ts >= ts);
  return tx('log', 'readonly', (s) => reqP(s.index('ts').getAll(IDBKeyRange.lowerBound(ts))));
}

export async function clearStore(store) {
  if (memory) { memory[store].clear(); return; }
  return tx(store, 'readwrite', (s) => { s.clear(); });
}

export async function exportAll() {
  const out = { app: 'kakitori', version: 1, exportedAt: new Date().toISOString(), kv: {} };
  for (const key of ['settings', 'sync']) out.kv[key] = await kvGet(key);
  if (out.kv.settings) out.kv.settings = { ...out.kv.settings, wkToken: '' };
  out.cards = await getAll('cards');
  out.subjects = await getAll('subjects');
  out.log = await getAll('log');
  return out;
}

export async function importAll(data) {
  if (!data || data.app !== 'kakitori' || !Array.isArray(data.cards)) throw new Error('This file is not a Kakitori backup.');
  const current = (await kvGet('settings')) || {};
  for (const store of ['cards', 'subjects', 'log']) await clearStore(store);
  await putMany('cards', data.cards);
  await putMany('subjects', data.subjects || []);
  await putMany('log', (data.log || []).map((e) => { const { id, ...rest } = e; return rest; }));
  if (data.kv?.settings) await kvSet('settings', { ...data.kv.settings, wkToken: current.wkToken || '' });
  if (data.kv?.sync) await kvSet('sync', data.kv.sync);
}

export async function wipeAll() {
  for (const store of STORES) await clearStore(store);
}
