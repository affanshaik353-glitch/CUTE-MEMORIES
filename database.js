/* Browser persistence for Cute Memories. IndexedDB holds large photo blobs. */
(function () {
  const DB_NAME = 'CuteMemoriesDB';
  const DB_VERSION = 1;
  const STORE = 'photos';
  let connection;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB is unavailable in this browser.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => { connection = request.result; resolve(connection); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Photo storage is busy in another tab.'));
    });
  }

  async function getDB() {
    if (connection) return connection;
    return openDB();
  }

  function transaction(mode, action) {
    return getDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      action(store, resolve, reject);
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
      tx.onerror = () => reject(tx.error || new Error('Storage transaction failed.'));
    }));
  }

  window.MemoryDB = {
    async getAll() {
      return transaction('readonly', (store, resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async put(photo) {
      return transaction('readwrite', (store, resolve, reject) => {
        const req = store.put(photo);
        req.onsuccess = () => resolve(photo);
        req.onerror = () => reject(req.error);
      });
    },
    async delete(id) {
      return transaction('readwrite', (store, resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async clear() {
      return transaction('readwrite', (store, resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  };

  window.MemoryStore = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        window.dispatchEvent(new CustomEvent('memory-storage-error', { detail: error }));
        return false;
      }
    },
    remove(key) {
      localStorage.removeItem(key);
    }
  };
})();
