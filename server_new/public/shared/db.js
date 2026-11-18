// Roher Zugriff auf IndexedDB der Extension (bzw. der Handy-Seite). Die Trennung nach Konto macht scope.js.
// Bewusst nicht browser.storage.local: resetAllData() in content.js leert das beim Semesterwechsel,
// Kalender und Geräte-Token müssen das überleben.

(function () {
  'use strict';

  const DB_NAME = 'panumClassCalendar';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = (event) => {
          const db = request.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
          // Seit Version 2 liegt jeder Eintrag unter "Konto + id", damit zwei Konten im selben Browser
          // denselben Eintrag haben können, ohne sich zu überschreiben
          const items = db.createObjectStore('items', { keyPath: 'key' });
          if (event.oldVersion === 1) {
            const old = request.transaction.objectStore('entries');
            old.getAll().onsuccess = (e) => {
              e.target.result.forEach((entry) => items.put(Object.assign({}, entry, { key: '\n' + entry.id })));
              db.deleteObjectStore('entries');
            };
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  function run(storeName, mode, action) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = action(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  window.PanumRawDb = {
    items: () => run('items', 'readonly', (store) => store.getAll()),
    put: (item) => run('items', 'readwrite', (store) => store.put(item)),
    remove: (key) => run('items', 'readwrite', (store) => store.delete(key)),
    metaGet: (key) => run('meta', 'readonly', (store) => store.get(key)),
    metaSet: (key, value) => run('meta', 'readwrite', (store) => store.put(value, key)),
    metaDelete: (key) => run('meta', 'readwrite', (store) => store.delete(key)),
    metaKeys: () => run('meta', 'readonly', (store) => store.getAllKeys())
  };
})();
