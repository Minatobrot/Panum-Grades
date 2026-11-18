// Lädt Schulnetz-Seiten mit der laufenden Session des Tabs.
// id und transid werden bei jedem Aufruf neu aus der Seite gelesen und nirgends gespeichert oder geloggt.

(function () {
  'use strict';

  const COURSES_PAGE_ID = '22348';
  const EXAMS_PAGE_ID = '21312';

  function sessionParams() {
    const fromUrl = new URLSearchParams(window.location.search);
    if (fromUrl.get('id') && fromUrl.get('transid')) {
      return { id: fromUrl.get('id'), transid: fromUrl.get('transid') };
    }

    return sessionFromLinks(document);
  }

  function sessionFromLinks(doc) {
    for (const link of doc.querySelectorAll('a[href*="transid="]')) {
      try {
        const params = new URL(link.getAttribute('href'), window.location.href).searchParams;
        if (params.get('id') && params.get('transid')) {
          return { id: params.get('id'), transid: params.get('transid') };
        }
      } catch (error) {
        // ungültiger Link, nächster
      }
    }
    return null;
  }

  async function loadPage(params) {
    const session = sessionParams();
    if (!session) throw new Error('Keine Schulnetz-Session gefunden');

    const url = new URL('index.php', window.location.href);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('id', session.id);
    url.searchParams.set('transid', session.transid);

    const response = await fetch(url.href, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Schulnetz antwortet mit ' + response.status);

    const charset = ((response.headers.get('content-type') || '').match(/charset=([^;]+)/i) || [])[1] || 'utf-8';
    const html = new TextDecoder(charset.trim()).decode(await response.arrayBuffer());
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // Teilnehmer der eigenen Klasse: [{ name, vorname }] oder null, wenn nichts Passendes gefunden wurde.
  async function loadRoster(klasse) {
    const parse = window.PanumSchulnetzParse;
    const courses = parse.pickCourses(parse.parseCourses(await loadPage({ pageid: COURSES_PAGE_ID })), klasse);

    for (const course of courses.slice(0, 3)) {
      const doc = await loadPage({
        pageid: COURSES_PAGE_ID,
        listindex_s: course.index,
        tblName: 'Kursliste',
        sRow: 0,
        numRows: 1000000
      });
      const members = parse.parseRoster(doc, klasse);
      if (members && members.length > 1) return members;
    }
    return null;
  }

  function isoDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  // Der Prüfungsplan lädt pro Monatsansicht ein Fenster von 6 Wochen ab dem Montag vor dem Monatsersten.
  // Genau diese Abfrage wird hier wiederholt. Liefert das XML-Dokument oder null, wenn keine Daten kommen.
  async function loadExamMonth(session, monthOffset) {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const min = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
    const max = new Date(min.getFullYear(), min.getMonth(), min.getDate() + 42);

    const url = new URL('scheduler_processor.php', window.location.href);
    const params = {
      view: 'month',
      curr_date: isoDate(monthOffset === 0 ? today : first),
      min_date: isoDate(min),
      max_date: isoDate(max),
      ansicht: 'klassenuebersicht',
      showOnlyThisClass: -1,
      id: session.id,
      transid: session.transid,
      pageid: EXAMS_PAGE_ID,
      timeshift: today.getTimezoneOffset()
    };
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url.href, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error('Schulnetz antwortet mit ' + response.status);

    const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
    return xml.querySelector('data') ? xml : null;
  }

  async function loadExams(klasse, months) {
    let session = sessionParams();
    if (!session) throw new Error('Keine Schulnetz-Session gefunden');

    const parse = window.PanumSchulnetzParse;

    // scheduler_processor.php antwortet für den Kalender, der in dieser Session zuletzt geöffnet war.
    // War das nicht der Prüfungsplan, kommt gar nichts oder der Terminkalender der Schule
    // (Elternabende, Zukunftstag ...) statt der Prüfungen. Darum: enthält die erste Antwort keine einzige
    // Prüfung, den Prüfungsplan einmal im Hintergrund abrufen und es nochmals versuchen.
    let firstMonth = await loadExamMonth(session, 0);
    if (!firstMonth || parse.parseExams(firstMonth, klasse).length === 0) {
      const page = await loadPage({ pageid: EXAMS_PAGE_ID });
      session = sessionFromLinks(page) || session;
      firstMonth = await loadExamMonth(session, 0);
    }
    if (!firstMonth) throw new Error('Unerwartete Antwort vom Prüfungsplan');

    const found = new Map();
    // parseExams nimmt nur Prüfungen, andere Termine in derselben Antwort fallen weg
    const collect = (xml) => parse.parseExams(xml, klasse).forEach((exam) => found.set(exam.sourceId, exam));
    collect(firstMonth);
    for (let i = 1; i < (months || 5); i++) {
      const xml = await loadExamMonth(session, i);
      if (xml) collect(xml);
    }
    return Array.from(found.values());
  }

  window.PanumSchulnetzSession = { loadRoster, loadExams };
})();
