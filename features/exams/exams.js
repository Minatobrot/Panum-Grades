// Panel "Prüfungen": zeigt den Schulnetz-Prüfungsplan und übernimmt Einträge auf Klick in den Klassenkalender.
// Läuft als Extension-Seite im iframe. Das Schulnetz fragt die Seite darüber ab (features/exams/button.js).

(function () {
  'use strict';

  const db = window.PanumCalendarDb;
  const SCHULNETZ_ORIGINS = ['https://www.schul-netz.com', 'https://schul-netz.com'];

  let exams = [];
  let entries = [];
  let student = null;
  let requested = false;
  let scoped = null;

  const listEl = document.getElementById('list');
  const statusEl = document.getElementById('status');
  const takeAllEl = document.getElementById('take-all');
  const exportEl = document.getElementById('export');
  const bannerEl = document.getElementById('share-banner');
  const bannerTitleEl = document.getElementById('share-banner-title');
  const bannerTextEl = document.getElementById('share-banner-text');

  function setDark(dark) {
    document.documentElement.classList.toggle('panum-dark-theme', !!dark);
  }

  setDark(new URLSearchParams(window.location.search).get('theme') === 'dark');

  function toParent(message) {
    SCHULNETZ_ORIGINS.forEach((origin) => window.parent.postMessage(message, origin));
  }

  function today() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function dayLabel(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'long' });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function noteFor(exam) {
    return [exam.room ? 'Zimmer ' + exam.room : '', exam.note].filter(Boolean).join('\n');
  }

  function entryFor(exam) {
    return entries.find((entry) => entry.sourceId === exam.sourceId && !entry.deleted);
  }

  // Im Schulnetz verschoben, nachdem der Eintrag übernommen wurde
  function isOutdated(exam, entry) {
    return entry.date !== exam.date || (entry.time || '') !== exam.time;
  }

  function take(exam) {
    const now = new Date().toISOString();
    const old = entryFor(exam);
    // Feste id aus der Schulnetz-Prüfung: übernehmen zwei aus der Klasse dieselbe Prüfung, bleibt es ein Eintrag
    const entry = Object.assign({}, old || { id: 'schulnetz-' + exam.sourceId, createdAt: now, done: false, title: exam.title, subject: exam.subject, note: noteFor(exam) }, {
      type: 'exam',
      date: exam.date,
      time: exam.time,
      sourceId: exam.sourceId,
      kurs: exam.kurs,
      // Prüfungen aus eigenen Kursen (Schwerpunkt, Ergänzungsfach) gehören nicht der ganzen Klasse
      personal: exam.personal,
      dirty: true,
      updatedAt: now
    });
    entries = entries.filter((e) => e.id !== entry.id).concat([entry]);
    return db.putEntry(entry);
  }

  // Übernommene Klassenprüfungen gehen an die Klasse, falls der Kalender verbunden ist
  function upload() {
    if (scoped) scoped.then(() => window.PanumSync.sync()).catch(() => {});
  }

  function upcoming() {
    return exams
      .filter((exam) => exam.date >= today())
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  }

  function render() {
    const shown = upcoming();
    const open = shown.filter((exam) => !entryFor(exam));

    listEl.textContent = '';
    statusEl.classList.remove('error');
    statusEl.textContent = shown.length
      ? shown.length + ' anstehende Prüfungen, ' + (shown.length - open.length) + ' davon im Kalender'
      : 'Im Prüfungsplan stehen keine anstehenden Prüfungen.';
    takeAllEl.disabled = open.length === 0;
    takeAllEl.textContent = open.length ? 'Alle übernehmen (' + open.length + ')' : 'Alle übernommen';
    exportEl.disabled = shown.length === 0;

    let lastDate = null;
    shown.forEach((exam) => {
      if (exam.date !== lastDate) {
        lastDate = exam.date;
        const day = el('div', 'day');
        day.appendChild(el('span', '', dayLabel(exam.date)));
        listEl.appendChild(day);
      }

      const row = el('div', 'entry exam');
      row.appendChild(el('div', 'bar'));

      const body = el('div', 'body');
      const title = el('div', 'title', exam.title);
      if (exam.personal) {
        const tag = el('span', 'tag', 'nur dein Kurs, bleibt bei dir');
        tag.title = 'Diese Prüfung gehört zu einem Kurs, den nicht die ganze Klasse besucht. Sie wird nie mit der Klasse geteilt.';
        title.appendChild(tag);
      }
      body.appendChild(title);
      body.appendChild(el('div', 'meta', [exam.kurs, exam.time, exam.room].filter(Boolean).join(' · ')));
      if (exam.note) body.appendChild(el('div', 'note', exam.note));
      row.appendChild(body);

      const side = el('div', 'side');
      const entry = entryFor(exam);
      if (entry && !isOutdated(exam, entry)) {
        side.appendChild(el('span', 'state', 'Im Kalender'));
      } else {
        const button = el('button', 'btn', entry ? 'Aktualisieren' : 'Übernehmen');
        if (entry) button.title = 'Datum oder Zeit wurde im Schulnetz geändert';
        button.addEventListener('click', () => take(exam).then(render).then(upload));
        side.appendChild(button);
      }
      row.appendChild(side);
      listEl.appendChild(row);
    });
  }

  function showError(text) {
    statusEl.classList.add('error');
    statusEl.textContent = text;
  }

  takeAllEl.addEventListener('click', () => {
    Promise.all(upcoming().filter((exam) => !entryFor(exam)).map(take)).then(render).then(upload);
  });

  // Direkt aus dem Prüfungsplan, auch ohne dass etwas übernommen wurde
  exportEl.addEventListener('click', () => {
    const now = new Date().toISOString();
    const asEntries = upcoming().map((exam) => ({
      id: exam.sourceId,
      type: 'exam',
      title: exam.title,
      subject: exam.subject,
      date: exam.date,
      time: exam.time,
      note: noteFor(exam),
      updatedAt: now
    }));
    const name = 'Prüfungen' + (student ? ' ' + student.klasse : '');
    const blob = new Blob([window.PanumIcs.buildIcs(asEntries, name)], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name.replace(/\s+/g, '-').toLowerCase() + '.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  });

  document.getElementById('close').addEventListener('click', () => toParent({ panum: 'close' }));

  // Sagt klar, wohin eine übernommene Prüfung geht: zur ganzen Klasse oder nur in den eigenen Kalender
  function showSharing(session) {
    const klasse = session ? session.klasse : student ? student.klasse : '';
    bannerEl.classList.toggle('shared', !!session);
    bannerTitleEl.textContent = session
      ? 'Übernommene Prüfungen sieht die ganze ' + klasse
      : 'Übernommene Prüfungen bleiben bei dir';
    bannerTextEl.textContent = session
      ? '«Übernehmen» trägt eine Prüfung in den Klassenkalender ein. Dort sehen sie alle in deiner Klasse, mit deinem Namen. Prüfungen mit «nur dein Kurs» gehen nicht an die Klasse.'
      : '«Übernehmen» trägt eine Prüfung in deinen Kalender ein. Er ist nicht mit der Klasse geteilt. Teilen kannst du im Klassenkalender einschalten.';
  }

  // Einführung beim ersten Öffnen, muss einmal ganz durchlaufen werden
  function intro() {
    if (!window.PanumTour) return;
    const klasse = student ? student.klasse : 'deiner Klasse';
    window.PanumTour.start('exams2', [
      {
        title: 'Neu: Prüfungen aus dem Schulnetz',
        text: 'Dieser Button liest deinen Prüfungsplan aus dem Schulnetz und zeigt die anstehenden Prüfungen.',
        points: [
          'Mit einem Klick kommt eine Prüfung in den Klassenkalender',
          'Ohne Klick wird nichts übernommen',
          'Als .ics-Datei kannst du sie auch in Google oder Apple Calendar laden'
        ]
      },
      {
        title: 'Wichtig: Wer sieht übernommene Prüfungen?',
        warn: true,
        points: [
          'Ist dein Klassenkalender geteilt, sehen alle in der ' + klasse + ' jede Prüfung, die du übernimmst',
          'Dabei steht dein Name',
          'Prüfungen mit «nur dein Kurs» (Schwerpunkt, Ergänzungsfach) bleiben immer nur bei dir',
          'Der Kasten oben sagt dir jederzeit, was gerade gilt'
        ],
        confirm: 'Verstanden: Übernommene Klassenprüfungen sieht meine ganze Klasse.'
      },
      {
        title: 'Übernehmen',
        text: '«Alle übernehmen» trägt alle auf einmal ein. Der Knopf rechts neben einer Prüfung nur diese eine.',
        target: '#take-all'
      },
      {
        title: 'Als Datei',
        text: '«.ics» speichert die Prüfungen als Kalender-Datei. Das geht auch, ohne etwas zu übernehmen oder zu teilen.',
        target: '#export'
      }
    ]);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !SCHULNETZ_ORIGINS.includes(event.origin) || !event.data) return;

    if (event.data.panum === 'theme') {
      setDark(event.data.dark);
    } else if (event.data.panum === 'init') {
      setDark(event.data.dark);
      student = event.data.student || null;
      if (!requested) {
        requested = true;
        // Der lokale Speicher gehört genau diesem Schulnetz-Konto, wie im Klassenkalender
        scoped = db.useScope(db.scopeFor(student, event.data.school),
          student ? { school: event.data.school || '', klasse: student.klasse, name: student.name } : null);
        scoped.then(() => window.PanumSync.getSession()).then(showSharing, () => showSharing(null));
        intro();
        toParent({ panum: 'loadExams' });
      }
    } else if (event.data.panum === 'exams') {
      if (event.data.error) {
        showError('Prüfungsplan konnte nicht geladen werden (' + event.data.error + '). Öffne im Schulnetz einmal den Prüfungsplan und versuche es erneut.');
        return;
      }
      exams = event.data.exams || [];
      (scoped || Promise.reject()).then(() => db.allEntries()).then((stored) => {
        entries = stored;
        render();
      }).catch(() => {
        entries = [];
        render();
      });
    }
  });
})();
