// Tiny IndexedDB wrapper. Three stores: kv (keyed blobs), attempts, sessions.
// Falls back to an in-memory + localStorage shim if IndexedDB is unavailable
// (some private-browsing modes), so the app still runs.

const DB_NAME = 'dryfire';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('attempts')) {
        const s = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
        s.createIndex('drillId', 'drillId');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

// ---- localStorage fallback -------------------------------------------------
const LS = {
  read(name) { try { return JSON.parse(localStorage.getItem('df:' + name) || 'null'); } catch { return null; } },
  write(name, v) { try { localStorage.setItem('df:' + name, JSON.stringify(v)); } catch {} },
};
let useFallback = false;
async function guard(fn, fallback) {
  if (!useFallback) {
    try { return await fn(); } catch (e) {
      if (e && e.message === 'no-idb') useFallback = true; else throw e;
    }
  }
  return fallback();
}

export const kv = {
  get: (key) => guard(async () => wrap((await store('kv')).get(key)),
    () => (LS.read('kv') || {})[key]),
  set: (key, val) => guard(async () => wrap((await store('kv', 'readwrite')).put(val, key)),
    () => { const all = LS.read('kv') || {}; all[key] = val; LS.write('kv', all); }),
  del: (key) => guard(async () => wrap((await store('kv', 'readwrite')).delete(key)),
    () => { const all = LS.read('kv') || {}; delete all[key]; LS.write('kv', all); }),
};

function listStore(name) {
  return {
    add: (rec) => guard(async () => wrap((await store(name, 'readwrite')).add(rec)),
      () => { const a = LS.read(name) || []; rec.id = (a.at(-1)?.id || 0) + 1; a.push(rec); LS.write(name, a); return rec.id; }),
    put: (rec) => guard(async () => wrap((await store(name, 'readwrite')).put(rec)),
      () => { const a = LS.read(name) || []; const i = a.findIndex(r => r.id === rec.id); if (i >= 0) a[i] = rec; else a.push(rec); LS.write(name, a); }),
    all: () => guard(async () => wrap((await store(name)).getAll()),
      () => LS.read(name) || []),
    clear: () => guard(async () => wrap((await store(name, 'readwrite')).clear()),
      () => LS.write(name, [])),
  };
}

export const attempts = listStore('attempts');
export const sessions = listStore('sessions');

export async function byDrill(drillId) {
  return guard(async () => wrap((await store('attempts')).index('drillId').getAll(drillId)),
    () => (LS.read('attempts') || []).filter(a => a.drillId === drillId));
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
  return false;
}

export async function wipeAll() {
  await kv.del('progress');
  await attempts.clear();
  await sessions.clear();
}
