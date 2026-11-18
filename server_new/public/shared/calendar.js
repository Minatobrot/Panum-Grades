// Oberfläche des Klassenkalenders.
// In der Extension läuft sie als Seite im iframe des Panels, auf calendar.panumic.com als eigene Seite fürs Handy.

(function () {
  'use strict';

  const db = window.PanumCalendarDb;
  const sync = window.PanumSync;
  const standalone = !!window.PanumConfig.standalone;
  const SCHULNETZ_ORIGINS = ['https://www.schul-netz.com', 'https://schul-netz.com'];
  const ROSTER_DAYS = 14;

  let entries = [];
  let members = {};
  let session = null;
  let student = null;
  let school = '';
  let filter = 'all';
  let showPast = false;
  let showDeleted = false;
  let editingId = null;
  let undoTimer = null;
  let syncTimer = null;
  let syncing = false;
  let joining = false;
  let scopeKnown = false;
  let openScope = null;

  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  const sheetEl = $('sheet');
  const formEl = $('form');
  const statusEl = $('sync-status');

  function setDark(dark) {
    document.documentElement.classList.toggle('panum-dark-theme', !!dark);
  }

  if (standalone) {
    document.documentElement.classList.add('standalone');
    setDark(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } else {
    setDark(new URLSearchParams(window.location.search).get('theme') === 'dark');
  }

  function toParent(message) {
    SCHULNETZ_ORIGINS.forEach((origin) => window.parent.postMessage(message, origin));
  }

  function today() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function dayDiff(date) {
    const utc = (d) => Date.UTC(...d.split('-').map((n, i) => (i === 1 ? n - 1 : Number(n))));
    return Math.round((utc(date) - utc(today())) / 86400000);
  }

  function dayLabel(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'long' });
  }

  function relLabel(date) {
    const diff = dayDiff(date);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Morgen';
    if (diff === -1) return 'Gestern';
    if (diff > 1 && diff < 14) return 'in ' + diff + ' Tagen';
    return '';
  }

  function clock(iso) {
    return new Date(iso).toLocaleString('de-CH', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function who(memberId) {
    return (members && members[memberId]) || '';
  }

  function visibleEntries() {
    return entries
      .filter((entry) => !!entry.deleted === showDeleted)
      .filter((entry) => filter === 'all' || entry.type === filter)
      .sort((a, b) =>
        a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title)
      );
  }

  function renderEntry(entry) {
    const row = el('div', 'entry ' + entry.type + (entry.done ? ' done' : '') + (entry.deleted ? ' deleted' : ''));
    row.dataset.id = entry.id;
    row.appendChild(el('div', 'bar'));

    const body = el('div', 'body');
    body.appendChild(el('div', 'title', entry.title));

    const meta = el('div', 'meta');
    meta.appendChild(el('span', 'kind', entry.type === 'exam' ? 'Prüfung' : 'Hausaufgabe'));
    const details = [entry.subject, entry.time, entry.personal ? 'nur für dich' : who(entry.updatedBy)].filter(Boolean).join(' · ');
    if (details) meta.appendChild(document.createTextNode(' · ' + details));
    body.appendChild(meta);

    if (entry.note) body.appendChild(el('div', 'note', entry.note));
    row.appendChild(body);

    if (entry.type === 'homework' && !entry.deleted) {
      const check = el('label', 'check');
      check.title = 'Erledigt (den Haken siehst nur du)';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!entry.done;
      box.addEventListener('change', () => save(Object.assign({}, entry, { done: box.checked }), true));
      check.addEventListener('click', (e) => e.stopPropagation());
      check.appendChild(box);
      row.appendChild(check);
    }

    row.addEventListener('click', () => openForm(entry));
    return row;
  }

  function render() {
    const all = visibleEntries();
    const past = all.filter((entry) => dayDiff(entry.date) < 0);
    const shown = showPast || showDeleted ? all : all.filter((entry) => dayDiff(entry.date) >= 0);
    const deletedCount = entries.filter((entry) => entry.deleted).length;

    listEl.textContent = '';
    if (!shown.length) {
      const text = showDeleted ? 'Keine gelöschten Einträge.'
        : all.length ? 'Keine anstehenden Einträge.' : 'Noch keine Einträge. Lege den ersten an.';
      listEl.appendChild(el('div', 'empty', text));
    }

    let lastDate = null;
    shown.forEach((entry) => {
      if (entry.date !== lastDate) {
        lastDate = entry.date;
        const day = el('div', 'day' + (dayDiff(entry.date) === 0 ? ' today' : ''));
        day.appendChild(el('span', '', dayLabel(entry.date)));
        day.appendChild(el('span', 'rel', relLabel(entry.date)));
        listEl.appendChild(day);
      }
      listEl.appendChild(renderEntry(entry));
    });

    $('toggle-past').hidden = showDeleted || past.length === 0;
    $('toggle-past').textContent = showPast ? 'Vergangene ausblenden' : 'Vergangene anzeigen (' + past.length + ')';
    $('toggle-deleted').hidden = deletedCount === 0 && !showDeleted;
    $('toggle-deleted').textContent = showDeleted ? 'Zurück zum Kalender' : 'Gelöschte anzeigen (' + deletedCount + ')';

    const subjects = $('subjects');
    subjects.textContent = '';
    Array.from(new Set(entries.map((entry) => entry.subject).filter(Boolean))).sort().forEach((subject) => {
      const option = document.createElement('option');
      option.value = subject;
      subjects.appendChild(option);
    });
  }

  // keepStamp: Abhaken ist persönlich, zählt nicht als Änderung und geht nicht an die Klasse
  function save(entry, keepStamp) {
    if (!keepStamp) {
      entry.updatedAt = new Date().toISOString();
      entry.dirty = true;
    }
    const index = entries.findIndex((e) => e.id === entry.id);
    if (index === -1) entries.push(entry); else entries[index] = entry;
    render();
    const stored = db.putEntry(entry);
    if (!keepStamp) stored.then(() => scheduleSync(800));
    return stored;
  }

  // ---- Formular ----

  function openForm(entry) {
    editingId = entry ? entry.id : null;
    const deleted = !!(entry && entry.deleted);
    $('form-title').textContent = deleted ? 'Gelöschter Eintrag' : entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
    $('delete').hidden = !entry || deleted;
    $('submit').textContent = deleted ? 'Wiederherstellen' : session ? 'Für die Klasse speichern' : 'Speichern';
    $('share-note').textContent = session
      ? 'Sichtbar für alle in der ' + session.klasse + ', mit deinem Namen.'
      : 'Bleibt auf diesem Gerät. Deine Klasse sieht diesen Eintrag nicht.';
    $('share-note').classList.toggle('shared', !!session);
    formEl.reset();
    formEl.elements.type.value = entry ? entry.type : (filter === 'exam' ? 'exam' : 'homework');
    formEl.elements.title.value = entry ? entry.title : '';
    formEl.elements.subject.value = entry ? entry.subject || '' : '';
    formEl.elements.date.value = entry ? entry.date : today();
    formEl.elements.time.value = entry ? entry.time || '' : '';
    formEl.elements.note.value = entry ? entry.note || '' : '';

    const authors = $('authors');
    authors.hidden = !(entry && who(entry.createdBy));
    if (!authors.hidden) {
      authors.textContent = 'Erstellt von ' + who(entry.createdBy) +
        (who(entry.updatedBy) ? ' · zuletzt geändert von ' + who(entry.updatedBy) + ', ' + clock(entry.updatedAt) : '');
    }
    $('history').hidden = true;
    $('history').textContent = '';
    $('history-btn').hidden = !(entry && entry.rev && session);

    sheetEl.hidden = false;
    formEl.elements.title.focus();
  }

  function closeForm() {
    sheetEl.hidden = true;
    editingId = null;
  }

  function showUndo(text, undo) {
    clearTimeout(undoTimer);
    $('undo-text').textContent = text;
    $('undo-btn').onclick = () => {
      $('undo').hidden = true;
      undo();
    };
    $('undo').hidden = false;
    undoTimer = setTimeout(() => { $('undo').hidden = true; }, 7000);
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = formEl.elements.title.value.trim();
    if (!title || !formEl.elements.date.value) return;

    const old = entries.find((entry) => entry.id === editingId);
    save(Object.assign({}, old || { id: crypto.randomUUID(), createdAt: new Date().toISOString(), done: false }, {
      type: formEl.elements.type.value,
      title: title,
      subject: formEl.elements.subject.value.trim(),
      date: formEl.elements.date.value,
      time: formEl.elements.time.value,
      note: formEl.elements.note.value.trim(),
      deleted: false
    }));
    closeForm();
  });

  $('delete').addEventListener('click', () => {
    const entry = entries.find((e) => e.id === editingId);
    if (!entry) return;
    // Bleibt als gelöscht markiert liegen: so erfährt es die Klasse, und jeder kann es zurückholen
    save(Object.assign({}, entry, { deleted: true }));
    closeForm();
    showUndo('Eintrag gelöscht', () => save(Object.assign({}, entry, { deleted: false })));
  });

  $('history-btn').addEventListener('click', () => {
    const id = editingId;
    const box = $('history');
    $('history-btn').hidden = true;
    box.hidden = false;
    box.textContent = 'Verlauf wird geladen …';

    sync.history(id).then((result) => {
      if (editingId !== id) return;
      const labels = { create: 'erstellt', update: 'geändert', delete: 'gelöscht', revert: 'zurückgeholt' };
      box.textContent = '';
      result.history.forEach((item, i) => {
        const row = el('div', 'history-row');
        const info = el('div', 'history-info');
        info.appendChild(el('div', '', clock(item.at) + ' · ' + (result.members[item.memberId] || 'Unbekannt') + ' · ' + labels[item.action]));
        info.appendChild(el('div', 'meta', item.entry.title + ' · ' + dayLabel(item.entry.date) + (item.entry.time ? ' ' + item.entry.time : '')));
        row.appendChild(info);
        if (i > 0 && !item.entry.deleted) {
          const button = el('button', 'btn', 'Zurückholen');
          button.type = 'button';
          button.addEventListener('click', () => {
            sync.revert(id, item.id).then(() => {
              closeForm();
              runSync();
            }, () => { box.textContent = 'Zurückholen hat nicht geklappt.'; });
          });
          row.appendChild(button);
        }
        box.appendChild(row);
      });
    }, () => { box.textContent = 'Verlauf konnte nicht geladen werden.'; });
  });

  $('cancel').addEventListener('click', closeForm);
  sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) closeForm(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheetEl.hidden) closeForm(); });
  $('add').addEventListener('click', () => openForm(null));

  $('filters').addEventListener('click', (e) => {
    const button = e.target.closest('.filter');
    if (!button) return;
    filter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('active', b === button));
    render();
  });

  $('toggle-past').addEventListener('click', () => {
    showPast = !showPast;
    render();
  });

  $('toggle-deleted').addEventListener('click', () => {
    showDeleted = !showDeleted;
    render();
  });

  $('export').addEventListener('click', () => {
    const klasse = session ? session.klasse : student ? student.klasse : '';
    const name = 'Klassenkalender' + (klasse ? ' ' + klasse : '');
    const blob = new Blob([window.PanumIcs.buildIcs(entries, name)], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name.replace(/\s+/g, '-').toLowerCase() + '.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  });

  // ---- Verbindung zur Klasse ----

  function copy(text, button, label) {
    const done = () => {
      button.textContent = 'Kopiert';
      setTimeout(() => { button.textContent = label; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => window.prompt('Link kopieren:', text));
    } else {
      window.prompt('Link kopieren:', text);
    }
  }

  function showStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
  }

  // Überall muss klar sein, ob das hier die ganze Klasse sieht oder nur man selbst
  function showConnection() {
    const klasse = session ? session.klasse : student ? student.klasse : '';
    $('phone').hidden = !session;
    $('phone').textContent = standalone ? 'Weiteres Gerät verbinden' : 'Handy verbinden';
    $('ics-link').hidden = !session;
    $('welcome').hidden = !(standalone && !session);

    $('head-title').textContent = 'Klassenkalender' + (klasse ? ' ' + klasse : '');
    $('head-sub').textContent = session
      ? 'Geteilt: alle in der ' + klasse + ' sehen diese Einträge'
      : 'Hausaufgaben und Prüfungen' + (klasse ? ' der ' + klasse : '');

    $('share-banner').classList.toggle('shared', !!session);
    $('share-banner-title').textContent = session ? 'Geteilt mit der ganzen ' + klasse : 'Nur für dich';
    $('share-banner-text').textContent = session
      ? 'Alles, was hier steht, sehen alle in deiner Klasse. Deine Einträge erscheinen mit deinem Namen' +
        (session.alias ? ' (' + session.alias + ')' : '') + '. Jeder aus der Klasse kann sie ändern oder löschen.'
      : 'Dieser Kalender ist nicht mit deiner Klasse geteilt. Was du einträgst, bleibt auf diesem Gerät.';
  }

  function showNews(news) {
    if (!news.length) return;
    const names = Array.from(new Set(news.map((item) => who(item.memberId) || 'Jemand')));
    const joined = news.some((item) => item.kind === 'member_joined');
    $('notice-text').textContent = (joined ? 'Neu in der Klasse: ' : 'Neues Gerät verbunden: ') + names.join(', ');
    $('notice').hidden = false;
  }

  function reload() {
    return db.allEntries().then((stored) => {
      entries = stored;
      render();
    });
  }

  function runSync() {
    if (syncing || !session) return Promise.resolve();
    syncing = true;
    return sync.sync().then((result) => {
      if (result) {
        members = result.members;
        showStatus('Geteilt mit der Klasse ' + session.klasse + ' · abgeglichen ' +
          new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }));
        showNews(result.news);
      }
      return reload();
    }, (error) => {
      if (error.status === 401 || error.status === 403) {
        // Token ungültig oder nicht mehr auf der Liste: Verbindung ist weg, lokal bleibt alles
        session = null;
        showConnection();
        showStatus(standalone ? 'Dieses Handy ist nicht mehr verbunden.' : 'Verbindung zur Klasse verloren. Wird beim nächsten Öffnen neu aufgebaut.', true);
      } else if (error.status === 429) {
        showStatus('Zu viele Änderungen in kurzer Zeit. Der Abgleich läuft später weiter.', true);
      } else {
        showStatus('Server nicht erreichbar. Änderungen werden später abgeglichen.', true);
      }
    }).then(() => { syncing = false; });
  }

  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, delay);
  }

  function sameClass() {
    return session && student && session.klasse.toLowerCase() === student.klasse.toLowerCase();
  }

  // Extension: geteilt wird erst, wenn man dem ausdrücklich zugestimmt hat (einmal pro Konto).
  // optOut: undefined = noch nicht gefragt, false = teilen, true = nur lokal
  function connect() {
    if (standalone || !sync.enabled() || !student) return;
    db.getMeta('optOut').then((optOut) => {
      if (sameClass()) {
        $('connect').hidden = true;
        runSync();
        db.getMeta('rosterAt').then((at) => {
          if (!at || Date.now() - at > ROSTER_DAYS * 86400000) toParent({ panum: 'loadRoster' });
        });
        return;
      }
      $('connect').hidden = optOut !== true;
      if (optOut === true) return;
      if (optOut === undefined) {
        $('share-title').textContent = 'Mit der ' + student.klasse + ' teilen?';
        $('share-point-class').textContent = 'Alle in der ' + student.klasse + ' sehen, was du einträgst: Hausaufgaben und Prüfungen.';
        $('share-sheet').hidden = false;
        return;
      }
      if (!joining) {
        joining = true;
        showStatus('Verbinde mit der Klasse ' + student.klasse + ' …');
        toParent({ panum: 'loadRoster' });
      }
    });
  }

  function answerShare(share) {
    $('share-sheet').hidden = true;
    db.setMeta('optOut', !share).then(connect);
  }
  $('share-yes').addEventListener('click', () => answerShare(true));
  $('share-no').addEventListener('click', () => answerShare(false));

  function onRoster(data) {
    if (data.error) {
      if (joining) showStatus('Nicht verbunden: ' + data.error + '. Der Kalender bleibt lokal.', true);
      joining = false;
      return;
    }
    if (sameClass() && !joining) {
      sync.sendRoster(data.members).catch(() => {});
      return;
    }
    sync.join(school, student.klasse, data.self, data.members).then((joined) => {
      session = joined;
      joining = false;
      showConnection();
      return runSync();
    }, (error) => {
      joining = false;
      const reasons = {
        not_in_roster: 'Dein Name steht nicht auf der bestätigten Liste der Klasse',
        self_not_in_roster: 'Dein Name steht nicht auf der Teilnehmerliste',
        rate_limited: 'Zu viele Versuche, bitte später nochmals'
      };
      showStatus('Nicht verbunden: ' + (reasons[error.code] || 'Server nicht erreichbar') + '. Der Kalender bleibt lokal.', true);
    });
  }

  $('connect').addEventListener('click', () => {
    db.setMeta('optOut', false).then(connect);
  });

  $('notice-close').addEventListener('click', () => { $('notice').hidden = true; });

  // Abo: dieselbe .ics-Adresse in drei Formen (Google, webcal:// für Kalender-Apps, zum Kopieren)
  $('ics-link').addEventListener('click', () => {
    const webcal = session.icsUrl.replace(/^https?:/, 'webcal:');
    $('abo-url').value = session.icsUrl;
    $('abo-webcal').href = webcal;
    $('abo-google').href = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal);
    $('abo-sheet').hidden = false;
  });
  $('abo-copy').addEventListener('click', () => copy($('abo-url').value, $('abo-copy'), 'Link kopieren'));
  $('abo-close').addEventListener('click', () => { $('abo-sheet').hidden = true; });

  $('phone').addEventListener('click', () => {
    sync.link().then((link) => {
      $('phone-pin').textContent = link.pin.slice(0, 4) + ' ' + link.pin.slice(4);
      $('phone-url').value = link.url;
      $('phone-sheet').hidden = false;
      // Die Handy-Seite selbst hat keine QR-Bibliothek: dort gibt es nur Zahlencode und Link
      $('qr').hidden = !window.qrcode;
      if (!window.qrcode) {
        $('phone-hint').textContent = 'Der Code gilt 5 Minuten und nur einmal.';
        return;
      }
      const qr = window.qrcode(0, 'M');
      qr.addData(link.url);
      qr.make();
      const canvas = $('qr');
      const count = qr.getModuleCount();
      const cell = Math.floor(canvas.width / (count + 4));
      const offset = Math.floor((canvas.width - cell * count) / 2);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
        }
      }
    }, () => showStatus('Der Code fürs Handy konnte nicht erzeugt werden.', true));
  });
  $('phone-copy').addEventListener('click', () => copy($('phone-url').value, $('phone-copy'), 'Link kopieren'));
  $('phone-close').addEventListener('click', () => {
    $('phone-sheet').hidden = true;
    $('phone-url').value = '';
    $('phone-pin').textContent = '';
  });

  // Löschfunktion: eigene Daten auf dem Server und alles Lokale
  $('wipe').addEventListener('click', () => {
    const button = $('wipe');
    if (button.dataset.armed !== 'true') {
      button.dataset.armed = 'true';
      button.textContent = session ? 'Wirklich? Trennt dich auch von der Klasse' : 'Wirklich alles löschen?';
      setTimeout(() => {
        button.dataset.armed = 'false';
        button.textContent = 'Meine Daten löschen';
      }, 4000);
      return;
    }
    button.dataset.armed = 'false';
    button.textContent = 'Meine Daten löschen';
    sync.leave().then(() => db.wipe()).then(() => db.setMeta('optOut', true)).then(() => {
      entries = [];
      members = {};
      session = null;
      showStatus('Nur auf diesem Gerät gespeichert.');
      $('connect').hidden = standalone || !sync.enabled() || !student;
      showConnection();
      render();
    }, () => showStatus('Löschen auf dem Server hat nicht geklappt. Versuche es mit Internet nochmals.', true));
  });

  $('close').addEventListener('click', () => toParent({ panum: 'close' }));

  // Die Schulnetz-Seite (Content Script) meldet Theme, Klasse und auf Anfrage die Teilnehmerliste
  window.addEventListener('message', (event) => {
    if (standalone || event.source !== window.parent || !SCHULNETZ_ORIGINS.includes(event.origin) || !event.data) return;
    if (event.data.panum === 'theme') {
      setDark(event.data.dark);
    } else if (event.data.panum === 'init') {
      setDark(event.data.dark);
      if (scopeKnown) return;
      student = event.data.student || null;
      school = event.data.school || 'ksa'; // vorerst fest, bis die Schule aus dem Schulnetz gelesen wird
      // Der lokale Speicher gehört ab hier genau diesem Schulnetz-Konto (Schule, Klasse, Name)
      openScope(db.scopeFor(student, school), student ? { school: school, klasse: student.klasse, name: student.name } : null);
      showConnection();
      ready.then(intro).then(connect);
    } else if (event.data.panum === 'roster') {
      onRoster(event.data);
    }
  });

  // Handy: der QR-Code führt auf …/#link=<Einmal-Code>
  function redeemFromHash() {
    const match = window.location.hash.match(/^#link=([A-Za-z0-9_-]+)$/);
    if (!match) return Promise.resolve();
    // Der Code soll nicht in der Adresszeile oder im Verlauf stehen bleiben
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch (error) {
      window.location.hash = '';
    }
    return redeemCode(match[1]);
  }

  function redeemCode(code) {
    return sync.redeem(code).then((joined) => {
      session = joined;
      $('welcome-error').hidden = true;
    }, (error) => {
      $('welcome-error').hidden = false;
      $('welcome-error').textContent = error.code === 'invalid_code'
        ? 'Dieser Code ist abgelaufen oder wurde schon benutzt. Erzeuge am Computer einen neuen.'
        : error.code === 'rate_limited' ? 'Zu viele Versuche. Bitte später nochmals.'
          : 'Server nicht erreichbar. Bitte nochmals versuchen.';
    });
  }

  // App auf dem Home-Bildschirm: Zahlencode statt QR-Code
  $('welcome-go').addEventListener('click', () => {
    const code = $('welcome-code').value.replace(/\D/g, '');
    if (code.length !== 8) {
      $('welcome-error').hidden = false;
      $('welcome-error').textContent = 'Der Code hat 8 Ziffern.';
      return;
    }
    redeemCode(code).then(() => {
      if (!session) return;
      $('welcome-code').value = '';
      showConnection();
      runSync();
    });
  });

  // Gelesen wird erst, wenn feststeht, wessen Kalender das ist: in der Extension meldet das die Notenseite,
  // auf dem Handy gibt es genau ein Konto.
  const scoped = new Promise((resolve) => {
    openScope = (key, who) => {
      scopeKnown = true;
      resolve(db.useScope(key, who));
    };
  });
  if (standalone) openScope('handy', null);

  const ready = scoped.then(() => Promise.all([db.allEntries(), sync.getSession(), db.getMeta('members')])).then(([stored, storedSession, storedMembers]) => {
    entries = stored;
    session = storedSession || null;
    members = storedMembers || {};
    render();
  }).catch((error) => {
    console.warn('Klassenkalender: Speicher nicht lesbar:', error);
    listEl.appendChild(el('div', 'empty', 'Der lokale Speicher ist in diesem Fenster nicht verfügbar (z.B. privates Fenster).'));
  }).then(() => (standalone ? redeemFromHash() : null)).then(() => {
    showConnection();
    if (standalone && session) runSync();
  });

  // Einführung beim ersten Öffnen in der Extension. Erst danach kommt die Frage, ob geteilt werden soll.
  function intro() {
    if (standalone || !window.PanumTour) return Promise.resolve();
    const klasse = student ? student.klasse : 'deiner Klasse';
    return window.PanumTour.start('calendar2', [
      {
        title: 'Neu: der Klassenkalender der ' + klasse,
        text: 'Ein gemeinsamer Kalender für deine ganze Klasse, direkt im Schulnetz.',
        points: [
          'Hausaufgaben und Prüfungen eintragen, damit niemand etwas vergisst',
          'Alle in der ' + klasse + ' sehen dieselben Einträge und können sie ergänzen',
          'Auch auf dem Handy und in Google oder Apple Calendar',
          'Mit dem Button «Prüfungen» daneben holst du Prüfungen direkt aus dem Schulnetz'
        ]
      },
      {
        title: 'Wichtig: Deine Klasse sieht, was du einträgst',
        warn: true,
        text: 'Das ist kein privater Kalender. Sobald du ihn teilst, gilt:',
        points: [
          'Jeder Eintrag erscheint bei allen in der ' + klasse,
          'Dabei steht dein Name, zum Beispiel «Lea A.»',
          'Jeder aus der Klasse kann Einträge ändern, löschen und wieder zurückholen',
          'Schreib nichts Privates hinein. Andere Klassen sehen nichts, Noten werden nie geteilt'
        ],
        confirm: 'Verstanden: Was ich eintrage, sieht meine ganze Klasse.'
      },
      {
        title: 'Probier es aus',
        text: 'So trägst du eine Hausaufgabe oder Prüfung ein.',
        target: '#add',
        mustClick: true,
        waitText: 'Klick auf «Neuer Eintrag»'
      },
      {
        title: 'Das Formular',
        text: 'Hausaufgabe oder Prüfung wählen, Titel und Datum genügen. Was du speicherst, ist ein echter Eintrag. Zum Anschauen reicht «Abbrechen».',
        place: 'top',
        onlyIf: () => !sheetEl.hidden,
        until: () => sheetEl.hidden,
        waitText: 'Weiter geht es nach Speichern oder Abbrechen'
      },
      {
        title: 'Filtern und abhaken',
        text: 'Hier schaltest du zwischen Hausaufgaben und Prüfungen um. Erledigte Hausaufgaben hakst du rechts ab. Den Haken siehst nur du, nicht die Klasse.',
        target: '#filters'
      },
      {
        title: 'Geteilt oder nicht? Steht immer oben',
        text: 'Dieser Kasten sagt dir jederzeit, ob die Klasse deine Einträge sieht.',
        target: '#share-banner'
      },
      {
        title: 'Handy, Kalender-App, Löschen',
        text: 'Ganz unten:',
        points: [
          '«Handy verbinden» zeigt einen QR-Code für dein Handy',
          '«Kalender abonnieren» bringt alles in Google oder Apple Calendar',
          '«Meine Daten löschen» entfernt alles von dir, auch auf dem Server'
        ],
        target: '.foot',
        place: 'top'
      }
    ]);
  }

  setInterval(() => {
    if (!document.hidden && sheetEl.hidden) runSync();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sheetEl.hidden) runSync();
  });
})();
