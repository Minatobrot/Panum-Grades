// Meldet den Service Worker an, damit die Seite installierbar ist und offline öffnet.
// Bittet den Browser, den Speicher (Token, Einträge) nicht von sich aus zu leeren
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
