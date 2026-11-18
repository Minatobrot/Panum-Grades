// Die eine Stelle, die festlegt, welche schwebenden Buttons es gibt und wo sie stehen.
// Kein DOM, kein Storage: läuft im Content Script, im Popup und in den Tests.
//
// Neuen Button hinzufügen: eine Zeile in REGISTRY, dazu im eigenen Skript PanumDock.add({ name, ... }).
// Button entfernen: Zeile löschen. Alles andere (Nachrücken, Ein/Aus, Panels schliessen) ergibt sich daraus.

(function () {
  'use strict';

  const MARGIN = 20; // Abstand zum Fensterrand
  const STEP = 60;   // 50 px Button + 10 px Lücke
  const TOP_RESERVE = 70; // Kopfzeile des Schulnetz bleibt frei

  // Reihenfolge = Reihenfolge ab der Ecke unten rechts.
  // zone 'row': untere Reihe, wächst nach links. zone 'column': rechte Spalte, wächst nach oben.
  const REGISTRY = [
    { name: 'achievements',  zone: 'row',    label: 'Achievements',    buttonId: 'gamification-overlay-btn',  storageKey: 'buttonEnabled_achievements' },
    { name: 'calculator',    zone: 'row',    label: 'Notenrechner',    buttonId: 'notenrechner-calc-btn',     storageKey: 'buttonEnabled_calculator' },
    { name: 'classcalendar', zone: 'row',    label: 'Klassenkalender', buttonId: 'classcalendar-overlay-btn', storageKey: 'buttonEnabled_classcalendar' },
    { name: 'pluspoints',    zone: 'column', label: 'Pluspunkte',      buttonId: 'pluspoints-overlay-btn',    storageKey: 'buttonEnabled_pluspoints' },
    { name: 'improvement',   zone: 'column', label: 'Verbesserungen',  buttonId: 'improvement-overlay-btn',   storageKey: 'buttonEnabled_improvement' },
    { name: 'exams',         zone: 'column', label: 'Prüfungen',       buttonId: 'exams-overlay-btn',         storageKey: 'buttonEnabled_exams' },
    { name: 'share',         zone: 'column', label: 'Teilen',          buttonId: 'panum-share-btn',           storageKey: 'buttonEnabled_share' }
  ];

  const LAYOUT_KEY = 'panumDockLayout';

  function isZone(zone) {
    return zone === 'row' || zone === 'column';
  }

  // saved: { order: [name, ...], zones: { name: 'row' | 'column' } } aus dem Popup, oder nichts.
  // Unbekannte Namen werden ignoriert, neue Buttons (noch nicht in saved.order) behalten ihren Platz aus REGISTRY.
  function applyUserLayout(registry, saved) {
    const order = saved && Array.isArray(saved.order) ? saved.order : [];
    const zones = saved && saved.zones && typeof saved.zones === 'object' ? saved.zones : {};
    const rank = (entry, index) => {
      const at = order.indexOf(entry.name);
      return at === -1 ? order.length + index : at;
    };
    return registry
      .map((entry, index) => ({ entry: entry, rank: rank(entry, index) }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ entry }) => Object.assign({}, entry, { zone: isZone(zones[entry.name]) ? zones[entry.name] : entry.zone }));
  }

  // items: [{ name, zone, visible }] in Anzeige-Reihenfolge. viewport: { width, height } oder nichts.
  // Ergebnis: positions[name] = { right, bottom } für jeden sichtbaren Button, inset = Platz, den Panels frei lassen.
  // Garantien: jede Position kommt genau einmal vor, Reihe und Spalte sind lückenlos, die Ecke ist besetzt.
  function computeLayout(items, viewport) {
    const visible = items.filter((item) => item.visible);
    const row = visible.filter((item) => item.zone !== 'column');
    const column = visible.filter((item) => item.zone === 'column');

    // Zu niedriges Fenster: was in der Spalte keinen Platz hat, geht ans Ende der Reihe
    const height = viewport && viewport.height;
    if (height) {
      const slots = Math.max(1, Math.floor((height - MARGIN - TOP_RESERVE) / STEP));
      while (column.length > 0 && column.length + (row.length ? 1 : 0) > slots) {
        row.push(column.pop());
      }
    }

    const positions = {};
    row.forEach((item, i) => {
      positions[item.name] = { right: MARGIN + i * STEP, bottom: MARGIN };
    });
    // Ohne Reihe beginnt die Spalte in der Ecke
    const lift = row.length ? 1 : 0;
    column.forEach((item, i) => {
      positions[item.name] = { right: MARGIN, bottom: MARGIN + (i + lift) * STEP };
    });

    return {
      positions: positions,
      inset: {
        right: column.length ? MARGIN + STEP : MARGIN,
        bottom: row.length ? MARGIN + STEP : MARGIN
      }
    };
  }

  const api = { REGISTRY, LAYOUT_KEY, MARGIN, STEP, applyUserLayout, computeLayout };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.PanumDockLayout = api;
  }
})();
