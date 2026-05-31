// content/storage/idb.js — Wrapper mínimo sobre IndexedDB para dedup y colas.
(function () {
  const DB_NAME = "engine";
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("dedup")) db.createObjectStore("dedup");
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const result = fn(s);
      t.oncomplete = () => resolve(result?.result ?? result);
      t.onerror = () => reject(t.error);
    });
  }

  window.__engineIDB = { open, tx };
})();
