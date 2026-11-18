// Rechnen mit den Noten, die der Scraper in content.js gespeichert hat (notenDaten).
// Liest nur. Gemeinsam genutzt vom Notenrechner und von den Pluspunkten in der Notentabelle.

(function () {
  'use strict';

  const HIDDEN_KEY = 'pluspointsHiddenFaecher';
  const MERGED_KEY = 'mergedSubjects';
  const MAX_GROUP_SIZE = 4;

  // Pluspunkte nach Schweizer Promotionsregel: auf halbe Noten gerundet, ungenügende zählen doppelt
  function punkteFuerNote(note) {
    const n = Math.round(note * 2) / 2;
    if (n >= 6.0) return 2;
    if (n === 5.5) return 1.5;
    if (n === 5.0) return 1;
    if (n === 4.5) return 0.5;
    if (n === 4.0) return 0;
    if (n === 3.5) return -1;
    if (n === 3.0) return -2;
    if (n === 2.5) return -3;
    if (n === 2.0) return -4;
    if (n === 1.5) return -6;
    if (n <= 1.0) return -8;
    return 0;
  }

  function formatPoints(points) {
    return (points > 0 ? '+' : '') + points;
  }

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  // Gewichteter Schnitt, ungerundet. null, wenn nichts zählt.
  function average(noten, gewichtungen) {
    let sum = 0;
    let weights = 0;
    noten.forEach((note, i) => {
      const weight = gewichtungen[i];
      if (isNumber(note) && isNumber(weight) && weight > 0) {
        sum += note * weight;
        weights += weight;
      }
    });
    return weights > 0 ? sum / weights : null;
  }

  // Noten eines Fachs plus Probe-Noten [{ note, gewicht }]. Unvollständige Probe-Noten zählen nicht.
  function withExtras(fach, extras) {
    const valid = (extras || []).filter((e) => isNumber(e.note) && isNumber(e.gewicht) && e.gewicht > 0);
    return {
      noten: fach.noten.concat(valid.map((e) => e.note)),
      gewichtungen: fach.gewichtungen.concat(valid.map((e) => e.gewicht)),
      added: valid.length
    };
  }

  // Welche Note braucht es in der nächsten Prüfung (Gewichtung gewicht), damit der Schnitt ziel erreicht?
  // Ergebnis: { needed, reachable, best, worst }. best/worst = Schnitt mit einer 6 bzw. einer 1.
  function requiredGrade(noten, gewichtungen, ziel, gewicht) {
    if (!isNumber(ziel) || !isNumber(gewicht) || gewicht <= 0) return null;
    let sum = 0;
    let weights = 0;
    noten.forEach((note, i) => {
      sum += note * gewichtungen[i];
      weights += gewichtungen[i];
    });
    const needed = (ziel * (weights + gewicht) - sum) / gewicht;
    if (!isFinite(needed)) return null;
    return {
      needed: needed,
      reachable: needed <= 6 && needed >= 1,
      best: (sum + 6 * gewicht) / (weights + gewicht),
      worst: (sum + 1 * gewicht) / (weights + gewicht)
    };
  }

  function shortName(fachName) {
    return fachName.split(' - ')[1] || fachName;
  }

  function groupName(group, index) {
    return group.name || 'Verbindung ' + (index + 1);
  }

  // "Biologie + Chemie", mit Prozenten nur wenn sie nicht gleichmässig verteilt sind
  function groupText(group, nameOf) {
    const label = nameOf || shortName;
    const equalShare = Math.floor(100 / group.subjects.length);
    const custom = group.percentages.some((p) => Math.abs(p - equalShare) > 1);
    return group.subjects
      .map((subject, i) => label(subject) + (custom ? ' (' + group.percentages[i] + '%)' : ''))
      .join(' + ');
  }

  function groupKey(index) {
    return '__merged__' + index;
  }

  // Alles, was die Notentabelle für die Pluspunkte braucht.
  // merged: [{ name, subjects: [fach], percentages: [n] }], hidden: [fach | '__merged__<i>']
  // Ergebnis:
  //   subjects[fach] = { avg, points, hidden, group }   group = Index der Verbindung oder null
  //   groups[i]      = { name, text, avg, points, hidden, key }
  //   total, average = Summe der Punkte und Mittel der Schnitte über alles, was zählt
  function pluspoints(notenDaten, merged, hidden) {
    merged = Array.isArray(merged) ? merged : [];
    hidden = Array.isArray(hidden) ? hidden : [];

    const inGroup = new Map();
    merged.forEach((group, index) => group.subjects.forEach((subject) => inGroup.set(subject, index)));

    const counted = [];
    const subjects = {};
    notenDaten.forEach((fach) => {
      const group = inGroup.has(fach.fach) ? inGroup.get(fach.fach) : null;
      const avg = isNumber(fach.durchschnitt) ? fach.durchschnitt : null;
      const entry = {
        avg: avg,
        points: avg === null ? null : punkteFuerNote(avg),
        hidden: hidden.includes(fach.fach),
        group: group
      };
      subjects[fach.fach] = entry;
      if (group === null && avg !== null && !entry.hidden) counted.push(entry);
    });

    const groups = merged.map((group, index) => {
      let sum = 0;
      let weights = 0;
      group.subjects.forEach((subject, i) => {
        const fach = notenDaten.find((f) => f.fach === subject);
        if (fach && isNumber(fach.durchschnitt)) {
          const share = group.percentages[i] / 100;
          sum += fach.durchschnitt * share;
          weights += share;
        }
      });
      const avg = weights > 0 ? sum / weights : null;
      const entry = {
        name: groupName(group, index),
        text: groupText(group),
        avg: avg,
        points: avg === null ? null : punkteFuerNote(avg),
        hidden: hidden.includes(groupKey(index)),
        key: groupKey(index)
      };
      if (avg !== null && !entry.hidden) counted.push(entry);
      return entry;
    });

    return {
      subjects: subjects,
      groups: groups,
      total: counted.reduce((sum, entry) => sum + entry.points, 0),
      average: counted.length ? counted.reduce((sum, entry) => sum + entry.avg, 0) / counted.length : null,
      count: counted.length
    };
  }

  // Verbindung i entfernen. Die Ein/Aus-Merker der Verbindungen hängen am Index und rücken mit.
  function removeGroup(merged, hidden, index) {
    const nextHidden = [];
    hidden.forEach((key) => {
      const match = /^__merged__(\d+)$/.exec(key);
      if (!match) {
        nextHidden.push(key);
      } else if (Number(match[1]) < index) {
        nextHidden.push(key);
      } else if (Number(match[1]) > index) {
        nextHidden.push(groupKey(Number(match[1]) - 1));
      }
    });
    return { merged: merged.filter((group, i) => i !== index), hidden: nextHidden };
  }

  // Verteilt Prozente so, dass sie zusammen 100 ergeben (Rest geht an den ersten Eintrag)
  function normalizePercentages(values) {
    const clean = values.map((value) => Math.max(1, Math.min(100, parseInt(value, 10) || 0)));
    const total = clean.reduce((a, b) => a + b, 0);
    if (total === 100) return clean;
    const scaled = clean.map((value) => Math.max(1, Math.round(value * 100 / total)));
    scaled[0] += 100 - scaled.reduce((a, b) => a + b, 0);
    return scaled;
  }

  function equalPercentages(count) {
    return normalizePercentages(new Array(count).fill(Math.floor(100 / count)));
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('Panum Grades: konnte ' + key + ' nicht speichern', error);
    }
  }

  // notenDaten aus dem Extension-Speicher, sonst aus dem localStorage der Seite (wie bisher)
  function load() {
    const local = () => readJson('notenDaten', []);
    if (typeof browser === 'undefined' || !browser.storage || !browser.storage.local) {
      return Promise.resolve(local());
    }
    return browser.storage.local.get(['notenDaten']).then(
      (result) => (result && Array.isArray(result.notenDaten) ? result.notenDaten : local()),
      local
    );
  }

  const api = {
    HIDDEN_KEY, MERGED_KEY, MAX_GROUP_SIZE,
    punkteFuerNote, formatPoints, average, withExtras, requiredGrade,
    shortName, groupText, groupKey, pluspoints, removeGroup, normalizePercentages, equalPercentages,
    load,
    loadHidden: () => readJson(HIDDEN_KEY, []),
    saveHidden: (hidden) => writeJson(HIDDEN_KEY, hidden),
    loadMerged: () => readJson(MERGED_KEY, []),
    saveMerged: (merged) => writeJson(MERGED_KEY, merged)
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.PanumGrades = api;
  }
})();
