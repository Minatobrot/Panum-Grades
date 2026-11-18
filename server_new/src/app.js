// HTTP-API des Klassenkalenders. Beschreibung aller Endpunkte: SERVER_SPEC.md

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const roster = require('./roster');
const { buildIcs } = require('./ics');

const MAX_BODY = 64 * 1024;
const MAX_DEVICES = 3;
const LINK_MINUTES = 5;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

// Die Handy-Seite: alle Dateien aus public/ werden beim Start einmal gelesen.
// Ausgeliefert wird nur, was in dieser Liste steht, es gibt keinen Dateizugriff nach Pfad aus dem Request.
function loadPublic(dir) {
  const files = new Map();
  if (!dir || !fs.existsSync(dir)) return files;
  const walk = (folder, prefix) => {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (item.isDirectory()) {
        walk(path.join(folder, item.name), prefix + item.name + '/');
      } else if (TYPES[path.extname(item.name)]) {
        files.set(prefix + item.name, { body: fs.readFileSync(path.join(folder, item.name)), type: TYPES[path.extname(item.name)] });
      }
    }
  };
  walk(dir, '/');
  if (files.has('/index.html')) files.set('/', files.get('/index.html'));
  return files;
}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createApp(config) {
  const db = openDb(config.dbFile);
  const now = config.now || (() => new Date());
  const iso = () => now().toISOString();
  const buckets = new Map();
  const publicFiles = loadPublic(config.publicDir);

  // Zähler pro Schlüssel und Zeitfenster. Liegt im Speicher: nach einem Neustart beginnt jeder wieder bei null.
  function limit(key, max, minutes) {
    const time = now().getTime();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= time) {
      bucket = { count: 0, resetAt: time + minutes * 60000 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) throw new HttpError(429, 'rate_limited');
    if (buckets.size > 50000) {
      for (const [k, b] of buckets) if (b.resetAt <= time) buckets.delete(k);
    }
  }

  // X-Forwarded-For nur glauben, wenn der Dienst ausschliesslich hinter Caddy erreichbar ist (TRUST_PROXY=true)
  function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (config.trustProxy && forwarded) return String(forwarded).split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
  }

  function hashName(school, klasse, clientHash) {
    return crypto.createHmac('sha256', config.secret).update(school + '|' + klasse + '|' + clientHash).digest('hex');
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, 'body_too_large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('kein Objekt');
          resolve(body);
        } catch (error) {
          reject(new HttpError(400, 'invalid_json'));
        }
      });
      req.on('error', reject);
    });
  }

  function text(value, max, required) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string') throw new HttpError(400, 'invalid_field');
    value = value.trim();
    if (value.length > max || (required && !value)) throw new HttpError(400, 'invalid_field');
    return value;
  }

  function authenticate(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'missing_token');

    const row = db.prepare(`
      SELECT d.id AS device_id, d.kind, m.id AS member_id, m.name_hash, m.alias,
             c.id AS class_id, c.display, c.school, c.rev, c.ics_token
      FROM devices d JOIN members m ON m.id = d.member_id JOIN classes c ON c.id = m.class_id
      WHERE d.token_hash = ?
    `).get(sha256(token));
    if (!row) throw new HttpError(401, 'invalid_token');
    if (!roster.isMemberValid(db, row.class_id, row.name_hash)) throw new HttpError(403, 'not_in_roster');

    db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(iso(), row.device_id);
    return row;
  }

  function addDevice(memberId, kind) {
    const token = randomToken();
    db.prepare('INSERT INTO devices (member_id, token_hash, kind, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
      .run(memberId, sha256(token), kind, iso(), iso());
    // Mehr als MAX_DEVICES: das am längsten unbenutzte Gerät fällt weg (z.B. nach Neuinstallation)
    db.prepare(`
      DELETE FROM devices WHERE member_id = ? AND id NOT IN (
        SELECT id FROM devices WHERE member_id = ? ORDER BY last_seen DESC, id DESC LIMIT ?
      )
    `).run(memberId, memberId, MAX_DEVICES);
    return token;
  }

  function entryOut(row) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      subject: row.subject,
      date: row.date,
      time: row.time,
      note: row.note,
      sourceId: row.source_id,
      deleted: !!row.deleted,
      rev: row.rev,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function getEntry(classId, id) {
    return db.prepare('SELECT * FROM entries WHERE class_id = ? AND id = ?').get(classId, id);
  }

  function membersOut(classId) {
    const out = {};
    db.prepare('SELECT id, alias FROM members WHERE class_id = ?').all(classId)
      .forEach((m) => { out[m.id] = m.alias || 'Ehemaliges Mitglied'; });
    return out;
  }

  // Schreibt eine neue Fassung eines Eintrags und legt sie in den Verlauf
  function writeEntry(auth, id, fields, action) {
    const time = iso();
    db.exec('BEGIN IMMEDIATE');
    try {
      const rev = db.prepare('UPDATE classes SET rev = rev + 1 WHERE id = ? RETURNING rev').get(auth.class_id).rev;
      const old = getEntry(auth.class_id, id);
      db.prepare(`
        INSERT INTO entries (class_id, id, type, title, subject, date, time, note, source_id, deleted, rev,
                             created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (class_id, id) DO UPDATE SET
          type = excluded.type, title = excluded.title, subject = excluded.subject, date = excluded.date,
          time = excluded.time, note = excluded.note, source_id = excluded.source_id, deleted = excluded.deleted,
          rev = excluded.rev, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `).run(auth.class_id, id, fields.type, fields.title, fields.subject, fields.date, fields.time, fields.note,
        fields.sourceId, fields.deleted ? 1 : 0, rev, old ? old.created_by : auth.member_id, auth.member_id,
        old ? old.created_at : time, time);

      const saved = entryOut(getEntry(auth.class_id, id));
      db.prepare('INSERT INTO history (class_id, entry_id, action, data, member_id, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(auth.class_id, id, action, JSON.stringify(saved), auth.member_id, time);
      db.exec('COMMIT');
      return saved;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function limitWrite(auth) {
    limit('w:device:' + auth.device_id, 60, 10);
    limit('w:class:' + auth.class_id, 600, 60);
  }

  function entryFields(body) {
    const fields = {
      type: body.type,
      title: text(body.title, 120, true),
      subject: text(body.subject, 40),
      date: text(body.date, 10, true),
      time: text(body.time, 5),
      note: text(body.note, 1000),
      sourceId: text(body.sourceId, 64),
      deleted: false
    };
    if (fields.type !== 'homework' && fields.type !== 'exam') throw new HttpError(400, 'invalid_field');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || isNaN(Date.parse(fields.date))) throw new HttpError(400, 'invalid_field');
    if (fields.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.time)) throw new HttpError(400, 'invalid_field');
    return fields;
  }

  function sessionOut(token, member, cls, confirmed) {
    return {
      token: token,
      memberId: member.id,
      alias: member.alias,
      klasse: cls.display,
      confirmed: confirmed,
      icsUrl: config.publicUrl + '/ics/' + cls.ics_token + '.ics'
    };
  }

  // ---- Endpunkte ----

  async function join(req) {
    const body = await readBody(req);
    const school = text(body.school, 40, true).toLowerCase();
    const display = text(body.klasse, 20, true);
    const klasse = display.toLowerCase();
    const alias = text(body.alias, 40, true);
    const isHash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
    if (!/^[a-z0-9_-]+$/.test(school) || !isHash(body.self) || !Array.isArray(body.roster) ||
        body.roster.length < 2 || body.roster.length > 80 || !body.roster.every(isHash)) {
      throw new HttpError(400, 'invalid_field');
    }

    limit('join:ip:' + clientIp(req), 30, 60);
    limit('join:class:' + school + '|' + klasse, 60, 60);

    const self = hashName(school, klasse, body.self);
    const names = Array.from(new Set(body.roster.map((hash) => hashName(school, klasse, hash))));

    let cls = db.prepare('SELECT * FROM classes WHERE school = ? AND name = ?').get(school, klasse);
    if (!cls) {
      db.prepare('INSERT INTO classes (school, name, display, ics_token, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(school, klasse, display, randomToken(), iso());
      cls = db.prepare('SELECT * FROM classes WHERE school = ? AND name = ?').get(school, klasse);
    }

    const check = roster.canJoin(db, cls.id, self, names);
    if (!check.ok) throw new HttpError(403, check.reason);

    let member = db.prepare('SELECT * FROM members WHERE class_id = ? AND name_hash = ?').get(cls.id, self);
    if (!member) {
      db.prepare('INSERT INTO members (class_id, name_hash, alias, created_at) VALUES (?, ?, ?, ?)').run(cls.id, self, alias, iso());
      member = db.prepare('SELECT * FROM members WHERE class_id = ? AND name_hash = ?').get(cls.id, self);
      db.prepare('INSERT INTO activity (class_id, kind, member_id, at) VALUES (?, ?, ?, ?)').run(cls.id, 'member_joined', member.id, iso());
    } else {
      db.prepare('UPDATE members SET alias = ? WHERE id = ?').run(alias, member.id);
      member.alias = alias;
      db.prepare('INSERT INTO activity (class_id, kind, member_id, at) VALUES (?, ?, ?, ?)').run(cls.id, 'device_added', member.id, iso());
    }

    roster.saveVote(db, member.id, names);
    const token = addDevice(member.id, 'extension');
    return sessionOut(token, member, cls, roster.confirmedNames(db, cls.id).has(self));
  }

  // Die Extension meldet die Teilnehmerliste gelegentlich neu (Zu- und Abgänge während des Jahres)
  async function updateRoster(req, auth) {
    const body = await readBody(req);
    const isHash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
    if (!Array.isArray(body.roster) || body.roster.length < 2 || body.roster.length > 80 || !body.roster.every(isHash)) {
      throw new HttpError(400, 'invalid_field');
    }
    limit('roster:device:' + auth.device_id, 10, 60);
    const klasse = auth.display.toLowerCase();
    const names = Array.from(new Set(body.roster.map((hash) => hashName(auth.school, klasse, hash))));
    if (!names.includes(auth.name_hash)) throw new HttpError(400, 'self_not_in_roster');
    roster.saveVote(db, auth.member_id, names);
    return { ok: true };
  }

  function me(auth) {
    return {
      memberId: auth.member_id,
      alias: auth.alias,
      klasse: auth.display,
      confirmed: roster.confirmedNames(db, auth.class_id).has(auth.name_hash),
      devices: db.prepare('SELECT COUNT(*) AS n FROM devices WHERE member_id = ?').get(auth.member_id).n,
      icsUrl: config.publicUrl + '/ics/' + auth.ics_token + '.ics'
    };
  }

  // Löschfunktion: Geräte, gemeldete Liste und Anzeigename weg. Einträge bleiben der Klasse erhalten.
  function deleteMe(auth) {
    db.prepare('DELETE FROM devices WHERE member_id = ?').run(auth.member_id);
    db.prepare('DELETE FROM roster_votes WHERE member_id = ?').run(auth.member_id);
    db.prepare('DELETE FROM link_codes WHERE member_id = ?').run(auth.member_id);
    db.prepare('UPDATE members SET alias = NULL WHERE id = ?').run(auth.member_id);
    return { ok: true };
  }

  function listEntries(auth, url) {
    const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
    const rows = db.prepare('SELECT * FROM entries WHERE class_id = ? AND rev > ? ORDER BY rev').all(auth.class_id, since);
    return { rev: auth.rev, entries: rows.map(entryOut), members: membersOut(auth.class_id) };
  }

  async function putEntry(req, auth, id) {
    const fields = entryFields(await readBody(req));
    limitWrite(auth);
    return writeEntry(auth, id, fields, getEntry(auth.class_id, id) ? 'update' : 'create');
  }

  function deleteEntry(auth, id) {
    const old = getEntry(auth.class_id, id);
    if (!old) throw new HttpError(404, 'not_found');
    limitWrite(auth);
    return writeEntry(auth, id, Object.assign(entryOut(old), { deleted: true }), 'delete');
  }

  function entryHistory(auth, id) {
    const rows = db.prepare('SELECT id, action, data, member_id, at FROM history WHERE class_id = ? AND entry_id = ? ORDER BY id DESC LIMIT 50')
      .all(auth.class_id, id);
    if (!rows.length) throw new HttpError(404, 'not_found');
    return {
      history: rows.map((row) => ({ id: row.id, action: row.action, memberId: row.member_id, at: row.at, entry: JSON.parse(row.data) })),
      members: membersOut(auth.class_id)
    };
  }

  async function revertEntry(req, auth, id) {
    const body = await readBody(req);
    const row = db.prepare('SELECT data FROM history WHERE id = ? AND class_id = ? AND entry_id = ?')
      .get(Number(body.historyId) || 0, auth.class_id, id);
    if (!row) throw new HttpError(404, 'not_found');
    limitWrite(auth);
    return writeEntry(auth, id, JSON.parse(row.data), 'revert');
  }

  function listActivity(auth, url) {
    const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
    const rows = db.prepare('SELECT id, kind, member_id, at FROM activity WHERE class_id = ? AND id > ? ORDER BY id DESC LIMIT 50')
      .all(auth.class_id, since);
    return {
      activity: rows.map((row) => ({ id: row.id, kind: row.kind, memberId: row.member_id, at: row.at })),
      members: membersOut(auth.class_id)
    };
  }

  // Handy-Login: die Extension holt einen Einmal-Code und zeigt ihn als QR-Code/Link
  function createLink(auth) {
    limit('link:device:' + auth.device_id, 10, 60);
    const code = randomToken();
    const expires = new Date(now().getTime() + LINK_MINUTES * 60000).toISOString();
    db.prepare('DELETE FROM link_codes WHERE expires_at < ?').run(iso());
    // Zahlencode zum Abtippen, falls der QR-Code nicht dort landet, wo der Kalender installiert ist
    // (auf dem iPhone hat die App auf dem Home-Bildschirm einen eigenen Speicher, getrennt von Safari)
    const pin = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
    const insert = db.prepare('INSERT OR REPLACE INTO link_codes (code_hash, member_id, expires_at) VALUES (?, ?, ?)');
    insert.run(sha256(code), auth.member_id, expires);
    insert.run(sha256(pin), auth.member_id, expires);
    return { code: code, pin: pin, url: config.publicUrl + '/#link=' + code, expiresAt: expires };
  }

  async function redeemLink(req) {
    limit('redeem:ip:' + clientIp(req), 20, 60);
    limit('redeem:all', 600, 60);
    const body = await readBody(req);
    const hash = sha256(text(body.code, 100, true).replace(/\s+/g, ''));
    const row = db.prepare('SELECT * FROM link_codes WHERE code_hash = ?').get(hash);
    db.prepare('DELETE FROM link_codes WHERE code_hash = ?').run(hash);
    if (!row || row.expires_at < iso()) throw new HttpError(403, 'invalid_code');

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(row.member_id);
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(member.class_id);
    db.prepare('INSERT INTO activity (class_id, kind, member_id, at) VALUES (?, ?, ?, ?)').run(cls.id, 'device_added', member.id, iso());
    const token = addDevice(member.id, 'phone');
    return sessionOut(token, member, cls, roster.confirmedNames(db, cls.id).has(member.name_hash));
  }

  function ics(req, token) {
    limit('ics:ip:' + clientIp(req), 120, 60);
    const cls = db.prepare('SELECT * FROM classes WHERE ics_token = ?').get(token);
    if (!cls) throw new HttpError(404, 'not_found');
    const rows = db.prepare('SELECT * FROM entries WHERE class_id = ? AND deleted = 0 ORDER BY date, time').all(cls.id);
    return buildIcs(rows.map(entryOut), 'Klassenkalender ' + cls.display);
  }

  async function route(req, url) {
    const method = req.method;
    const path = url.pathname;

    if (method === 'GET' && path === '/healthz') return { ok: true };

    const icsMatch = path.match(/^\/ics\/([A-Za-z0-9_-]{20,})\.ics$/);
    if (method === 'GET' && icsMatch) return { raw: ics(req, icsMatch[1]), type: 'text/calendar; charset=utf-8' };

    if (method === 'GET' && publicFiles.has(path)) return { raw: publicFiles.get(path).body, type: publicFiles.get(path).type, page: true };

    if (!path.startsWith('/api/v1/')) throw new HttpError(404, 'not_found');
    const api = path.slice('/api/v1'.length);

    if (method === 'POST' && api === '/join') return join(req);
    if (method === 'POST' && api === '/link/redeem') return redeemLink(req);

    const auth = authenticate(req);
    limit('r:device:' + auth.device_id, 600, 10);

    if (method === 'GET' && api === '/me') return me(auth);
    if (method === 'DELETE' && api === '/me') return deleteMe(auth);
    if (method === 'POST' && api === '/roster') return updateRoster(req, auth);
    if (method === 'GET' && api === '/entries') return listEntries(auth, url);
    if (method === 'GET' && api === '/activity') return listActivity(auth, url);
    if (method === 'POST' && api === '/link') return createLink(auth);

    const entryMatch = api.match(/^\/entries\/([A-Za-z0-9-]{8,64})(\/history|\/revert)?$/);
    if (entryMatch) {
      const id = entryMatch[1];
      if (method === 'PUT' && !entryMatch[2]) return putEntry(req, auth, id);
      if (method === 'DELETE' && !entryMatch[2]) return deleteEntry(auth, id);
      if (method === 'GET' && entryMatch[2] === '/history') return entryHistory(auth, id);
      if (method === 'POST' && entryMatch[2] === '/revert') return revertEntry(req, auth, id);
    }

    throw new HttpError(404, 'not_found');
  }

  async function handle(req, res) {
    // Anmeldung läuft über das Token im Header, nie über Cookies. Darum darf jede Herkunft anfragen
    // (Extension-Seiten haben in Chrome und Firefox verschiedene Origins).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const result = await route(req, new URL(req.url, 'http://localhost'));
      if (result && result.raw !== undefined) {
        if (result.page) {
          // no-cache: der Browser fragt jedes Mal nach, offline springt der Service Worker ein
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
          res.setHeader('Referrer-Policy', 'no-referrer');
        }
        res.writeHead(200, { 'Content-Type': result.type });
        res.end(result.raw);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      // Nie Tokens, Namen oder Request-Inhalte loggen
      if (status === 500) console.error('Fehler bei', req.method, new URL(req.url, 'http://localhost').pathname.replace(/\/ics\/.*/, '/ics/…'), error.message);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error instanceof HttpError ? error.code : 'server_error' }));
    }
  }

  return { handle, db, close: () => db.close() };
}

module.exports = { createApp };
