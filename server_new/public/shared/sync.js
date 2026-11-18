// Abgleich des lokalen Kalenders mit dem Klassen-Server (API: SERVER_SPEC.md).
// Zum Server gehen nur Kalendereinträge, gehashte Namen und der Alias ("Vorname N."). Nie Noten, nie Schulnetz-Sessions.

(function () {
  'use strict';

  const db = window.PanumCalendarDb;

  function enabled() {
    return !!(window.PanumConfig && window.PanumConfig.serverUrl);
  }

  async function api(method, path, body, token) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;

    const response = await fetch(window.PanumConfig.serverUrl.replace(/\/$/, '') + '/api/v1' + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit'
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(json.error || 'http_' + response.status);
      error.code = json.error;
      error.status = response.status;
      throw error;
    }
    return json;
  }

  async function sha256Hex(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Der volle Name wird nur als Hash gesendet. Zusätzlich geht der Alias ("Vorname N.") im Klartext an den Server.
  // Hinweis: Der Hash ist nicht geheim (Schule, Klasse und Name sind erratbar). Wer sie kennt, kann sich als diese Person ausgeben.
  function nameHash(school, klasse, name) {
    const clean = name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    return sha256Hex(school.toLowerCase() + '|' + klasse.toLowerCase() + '|' + clean);
  }

  function getSession() {
    return db.getMeta('session');
  }

  async function saveSession(result, school) {
    const session = {
      token: result.token,
      memberId: result.memberId,
      alias: result.alias,
      klasse: result.klasse,
      school: school || '',
      icsUrl: result.icsUrl
    };
    await db.setMeta('session', session);
    await db.setMeta('rev', 0);
    return session;
  }

  // self und members kommen aus der Schulnetz-Seite: { name, vorname }
  async function join(school, klasse, self, members) {
    const hashes = await Promise.all(members.map((m) => nameHash(school, klasse, m.name + ' ' + m.vorname)));
    const result = await api('POST', '/join', {
      school: school,
      klasse: klasse,
      self: await nameHash(school, klasse, self.name + ' ' + self.vorname),
      roster: hashes,
      alias: self.vorname.split(' ')[0] + ' ' + self.name[0] + '.'
    });
    await db.setMeta('rosterAt', Date.now());
    return saveSession(result, school);
  }

  async function sendRoster(session, members) {
    const hashes = await Promise.all(members.map((m) => nameHash(session.school, session.klasse, m.name + ' ' + m.vorname)));
    await api('POST', '/roster', { roster: hashes }, session.token);
    await db.setMeta('rosterAt', Date.now());
  }

  async function redeem(code) {
    const old = await getSession();
    const result = await api('POST', '/link/redeem', { code: code });
    // Anderes Konto auf diesem Handy als bisher: der alte Kalender darf nicht stehen bleiben
    if (old && (old.memberId !== result.memberId || old.klasse !== result.klasse)) await db.clearEntries();
    return saveSession(result);
  }

  async function dropSession() {
    await db.setMeta('session', null);
    await db.setMeta('rev', 0);
  }

  function isDirty(entry) {
    return !entry.personal && (entry.dirty || entry.rev === undefined);
  }

  function fromServer(remote, local) {
    return Object.assign({}, remote, {
      done: local ? !!local.done : false,
      kurs: local ? local.kurs : undefined,
      dirty: false
    });
  }

  // Erst eigene Änderungen hochladen, dann alles Neue der Klasse holen.
  // Liefert { members, news } oder null, wenn kein Abgleich eingerichtet ist.
  async function sync() {
    const session = enabled() ? await getSession() : null;
    if (!session) return null;

    try {
      const local = await db.allEntries();

      for (const entry of local.filter(isDirty)) {
        let saved = null;
        try {
          if (!entry.deleted) {
            saved = await api('PUT', '/entries/' + entry.id, {
              type: entry.type, title: entry.title, subject: entry.subject || '', date: entry.date,
              time: entry.time || '', note: entry.note || '', sourceId: entry.sourceId || ''
            }, session.token);
          } else if (entry.rev) {
            saved = await api('DELETE', '/entries/' + entry.id, null, session.token);
          }
        } catch (error) {
          if (error.status !== 404 && error.status !== 400) throw error;
        }
        // rev 0: lokal gelöscht oder vom Server abgelehnt, nicht nochmal versuchen
        await db.putEntry(saved ? fromServer(saved, entry) : Object.assign({}, entry, { dirty: false, rev: entry.rev || 0 }));
      }

      const since = (await db.getMeta('rev')) || 0;
      const pulled = await api('GET', '/entries?since=' + since, null, session.token);
      const byId = new Map((await db.allEntries()).map((entry) => [entry.id, entry]));
      for (const remote of pulled.entries) {
        const mine = byId.get(remote.id);
        if (mine && isDirty(mine)) continue;
        await db.putEntry(fromServer(remote, mine));
      }
      await db.setMeta('rev', pulled.rev);
      await db.setMeta('members', pulled.members);

      // Hinweis bei neuen Mitgliedern und Geräten (ausser den eigenen)
      const seen = await db.getMeta('activityId');
      const activity = (await api('GET', '/activity?since=' + (seen || 0), null, session.token)).activity;
      if (activity.length) await db.setMeta('activityId', activity[0].id);
      const news = seen === undefined ? [] : activity.filter((item) => item.memberId !== session.memberId);

      return { members: pulled.members, news: news };
    } catch (error) {
      // Token ungültig oder nicht mehr auf der Liste: beim nächsten Öffnen neu beitreten
      if (error.status === 401 || error.status === 403) await dropSession();
      throw error;
    }
  }

  async function withSession(action) {
    const session = await getSession();
    if (!session) throw new Error('not_connected');
    return action(session);
  }

  // Löschfunktion: eigene Daten auf dem Server entfernen
  async function leave() {
    const session = await getSession();
    if (session) {
      try {
        await api('DELETE', '/me', null, session.token);
      } catch (error) {
        if (error.status !== 401 && error.status !== 403) throw error;
      }
    }
    await dropSession();
  }

  window.PanumSync = {
    enabled: enabled,
    getSession: getSession,
    join: join,
    sendRoster: (members) => withSession((session) => sendRoster(session, members)),
    redeem: redeem,
    sync: sync,
    leave: leave,
    link: () => withSession((session) => api('POST', '/link', null, session.token)),
    history: (id) => withSession((session) => api('GET', '/entries/' + id + '/history', null, session.token)),
    revert: (id, historyId) => withSession((session) => api('POST', '/entries/' + id + '/revert', { historyId: historyId }, session.token))
  };
})();
