// Baut eine .ics-Datei aus Kalendereinträgen. Kein DOM, kein Netzwerk.

(function () {
  'use strict';

  function escapeText(text) {
    return String(text || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // RFC 5545: Zeilen höchstens 75 Bytes, Fortsetzung mit Leerzeichen
  function fold(line) {
    const encoder = new TextEncoder();
    const parts = [];
    let current = '';
    let bytes = 0;
    for (const char of line) {
      const size = encoder.encode(char).length;
      if (bytes + size > (parts.length ? 74 : 75)) {
        parts.push(current);
        current = '';
        bytes = 0;
      }
      current += char;
      bytes += size;
    }
    parts.push(current);
    return parts.join('\r\n ');
  }

  function compactDate(date) {
    return date.replace(/-/g, '');
  }

  function nextDay(date) {
    const [y, m, d] = date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return next.toISOString().slice(0, 10);
  }

  function utcStamp(iso) {
    return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }

  function typeLabel(type) {
    return type === 'exam' ? 'Prüfung' : 'Hausaufgabe';
  }

  function buildEvent(entry) {
    const summary = typeLabel(entry.type) + (entry.subject ? ' ' + entry.subject : '') + ': ' + entry.title;
    const lines = [
      'BEGIN:VEVENT',
      'UID:' + entry.id + '@panum-klassenkalender',
      'DTSTAMP:' + utcStamp(entry.updatedAt)
    ];

    if (entry.time) {
      // Ohne Zeitzone ("floating"): gilt als Ortszeit, dazu X-WR-TIMEZONE im Kopf
      const start = compactDate(entry.date) + 'T' + entry.time.replace(':', '') + '00';
      lines.push('DTSTART:' + start);
      lines.push('DURATION:PT45M');
    } else {
      lines.push('DTSTART;VALUE=DATE:' + compactDate(entry.date));
      lines.push('DTEND;VALUE=DATE:' + compactDate(nextDay(entry.date)));
    }

    lines.push('SUMMARY:' + escapeText(summary));
    if (entry.note) lines.push('DESCRIPTION:' + escapeText(entry.note));
    lines.push('CATEGORIES:' + escapeText(typeLabel(entry.type)));
    lines.push('END:VEVENT');
    return lines;
  }

  function buildIcs(entries, calendarName) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Panum Grades//Klassenkalender//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escapeText(calendarName || 'Klassenkalender'),
      'X-WR-TIMEZONE:Europe/Zurich'
    ];
    entries
      .filter((entry) => !entry.deleted)
      .forEach((entry) => lines.push(...buildEvent(entry)));
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  const api = { buildIcs };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.PanumIcs = api;
  }
})();
