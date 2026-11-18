// Liest Name/Klasse, Teilnehmerliste und Prüfungen aus Schulnetz-Antworten. Kein Netzwerk, kein Storage.

(function () {
  'use strict';

  function cleanText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function sameText(a, b) {
    return cleanText(a).normalize('NFKC').toLowerCase() === cleanText(b).normalize('NFKC').toLowerCase();
  }

  // Kopfzeile der Notenseite: "Aktuelle Noten - Nachname Vorname (M3a)"
  function parseStudent(doc) {
    for (const h3 of doc.querySelectorAll('h3')) {
      const match = cleanText(h3.textContent).match(/^Aktuelle Noten\s*[-–—]\s*(.+?)\s*\(([^()]+)\)$/);
      if (match) {
        return { name: match[1], klasse: cleanText(match[2]) };
      }
    }
    return null;
  }

  // Kursauswahl links auf "Listen und Dokumente > Kurse": [{ index, name }]
  function parseCourses(doc) {
    const courses = [];
    doc.querySelectorAll('#clsList input[name="cls-sublist"]').forEach((input) => {
      const label = input.parentElement && input.parentElement.querySelector('.mdl-radio__label');
      const index = parseInt(input.value, 10);
      if (label && !isNaN(index)) {
        courses.push({ index: index, name: cleanText(label.textContent) });
      }
    });
    return courses;
  }

  // Kurse, in deren Name die Klasse als eigener Teil vorkommt ("KL-M3a-GiT").
  // Der Klassenstunden-Kurs (KL) kommt zuerst, weil dort die ganze Klasse drin ist.
  function pickCourses(courses, klasse) {
    const matching = courses.filter((course) =>
      course.name.split('-').some((part) => sameText(part, klasse))
    );
    const isKL = (course) => sameText(course.name.split('-')[0], 'KL');
    return matching.filter(isKL).concat(matching.filter((course) => !isKL(course)));
  }

  // Tabelle "Kursliste": nur Name und Vorname, nur Zeilen der eigenen Klasse.
  // Adresse, Telefon und Geburtsdatum stehen in derselben Tabelle und werden nicht gelesen.
  function parseRoster(doc, klasse) {
    const table = doc.getElementById('cls-table-Kursliste');
    if (!table) return null;

    const columns = {};
    table.querySelectorAll('thead th').forEach((th, i) => {
      const title = th.querySelector('[id^="th-title-"]');
      if (title) columns[cleanText(title.textContent)] = i;
    });
    if (columns.Name === undefined || columns.Vorname === undefined) return null;

    const members = [];
    table.querySelectorAll('tr[id^="row_Kursliste_"]').forEach((row) => {
      const cell = (i) => (row.children[i] ? cleanText(row.children[i].textContent) : '');
      if (columns.Kl !== undefined && !sameText(cell(columns.Kl), klasse)) return;
      const name = cell(columns.Name);
      const vorname = cell(columns.Vorname);
      if (name && vorname) members.push({ name: name, vorname: vorname });
    });
    return members;
  }

  // Die Kopfzeile nennt "Nachname Vorname" ohne Trennzeichen, die Liste hat getrennte Spalten.
  function findSelf(members, headerName) {
    const exact = members.filter((m) => sameText(m.name + ' ' + m.vorname, headerName));
    if (exact.length === 1) return exact[0];

    // Kopfzeile zeigt evtl. nur den ersten Vornamen
    const loose = members.filter((m) => {
      const first = m.vorname.split(' ')[0];
      return sameText(m.name + ' ' + first, headerName);
    });
    return loose.length === 1 ? loose[0] : null;
  }

  // Antwort von scheduler_processor.php (Prüfungsplan): <data><event>...</event></data>
  // "text" beginnt mit dem Kurs ("GS-M3a-HöC 1. Prüfung"), "klasse" nennt Klasse oder Kurs.
  function parseExams(xmlDoc, klasse) {
    const exams = [];
    xmlDoc.querySelectorAll('data > event').forEach((event) => {
      const field = (name) => {
        const node = event.querySelector(name);
        return node ? cleanText(node.textContent) : '';
      };

      const start = field('start_date').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
      const identity = field('identity');
      const text = field('text');
      if (!start || !identity || !text) return;
      // Nur Prüfungen: sie haben die Kennung "pru<Nummer>" und den Typ "1_pru".
      // Derselbe Dienst liefert je nach Session auch Schultermine (Elternabend, Zukunftstag), die gehören nicht hierher.
      if (!/^pru\d/i.test(identity) && !/pru/i.test(field('event_type'))) return;

      const space = text.indexOf(' ');
      const kurs = space === -1 ? '' : text.slice(0, space);
      const parts = kurs.split('-');
      const ownClass = field('klasse').split(',').some((k) => sameText(k, klasse));
      // Klassenkurs "GS-M3a-HöC": Fach vorne. Sonst ("SBC3a-CH", "EF3-PP"): Fach hinten.
      const subject = parts.some((part) => sameText(part, klasse)) ? parts[0] : parts[parts.length - 1];

      // 00:00 bis 00:00 am Folgetag heisst ganztägig
      const allDay = start[2] === '00:00' && /00:00(:00)?$/.test(field('end_date'));

      exams.push({
        sourceId: identity,
        date: start[1],
        time: allDay ? '' : start[2],
        title: space === -1 ? text : text.slice(space + 1),
        kurs: kurs,
        subject: subject,
        room: field('zimmerkuerzel'),
        note: field('markierung').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim(),
        // alle Klassen/Kurse, für die die Prüfung gilt ("EF3-BI,EF4-BI")
        klassen: field('klasse').split(',').map(cleanText).filter(Boolean),
        personal: !ownClass
      });
    });
    return exams;
  }

  // Kurse der Notenseite, so wie sie in der ersten Spalte stehen: "BI-M3a-KüR", "EF3-PP (EF)" -> "EF3-PP".
  // Jede Kurszeile hat direkt darunter eine Zeile "<n>_<m>_detailrow", auch ohne Noten.
  function parseGradeCourses(doc) {
    const courses = [];
    doc.querySelectorAll('tr').forEach((detail) => {
      if (!Array.from(detail.classList).some((cls) => cls.endsWith('_detailrow'))) return;
      const row = detail.previousElementSibling;
      const b = row && row.querySelector('b');
      if (!b) return;
      const code = cleanText(b.textContent).replace(/\s*\([^()]*\)$/, '');
      if (code && !courses.some((c) => courseKey(c) === courseKey(code))) courses.push(code);
    });
    return courses;
  }

  // Kürzel vergleichbar machen: Gross/Klein, Umlaut-Schreibweise, Bindestriche, Leerzeichen und der
  // Zusatz in Klammern spielen keine Rolle ("EF3-PP (EF)" = "ef3pp", "KüR" = "kur").
  function courseKey(code) {
    return cleanText(code)
      .replace(/\s*\([^()]*\)$/, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  // Der Prüfungsplan der Klasse enthält auch Kurse, die nur ein Teil der Klasse besucht (fremde Schwerpunkt-
  // und Ergänzungsfächer: "SSP3", "SWR3a-VWL", "EF3-SP"). Das Kürzel am Anfang jeder Prüfung ist dasselbe wie
  // in der ersten Spalte der Notenseite. Eine Prüfung bleibt, wenn
  //   - ihr Kürzel auf der Notenseite steht ("FR-M3a-DuC", "SBC3a-BI"), oder
  //   - die Notenseite in ihrer Kursliste vorkommt ("EF-BI ..." gilt für "EF3-BI,EF4-BI"), oder
  //   - sie für die ganze eigene Klasse gilt.
  // Passt über das Kürzel keine einzige Prüfung, stimmt etwas am Abgleich nicht: dann bleibt die Liste,
  // wie sie ist (alle Prüfungen), statt etwas Falsches wegzulassen.
  function filterOwnExams(exams, courses) {
    const keys = (courses || []).map(courseKey).filter(Boolean);
    const byCourse = (exam) =>
      keys.includes(courseKey(exam.kurs)) || (exam.klassen || []).some((k) => keys.includes(courseKey(k)));
    if (!exams.some(byCourse)) return exams;
    return exams.filter((exam) => byCourse(exam) || !exam.personal);
  }

  const api = { parseStudent, parseCourses, pickCourses, parseRoster, findSelf, parseExams, parseGradeCourses, filterOwnExams, sameText };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.PanumSchulnetzParse = api;
  }
})();
