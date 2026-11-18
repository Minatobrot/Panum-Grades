const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createApp } = require('../src/app');

const hash = (name) => crypto.createHash('sha256').update(name).digest('hex');
const NAMES = ['Ammann Lea', 'Berger Noah', 'Caduff Mia', 'Dürr Jan'];
const ROSTER = NAMES.map(hash);

async function start(options) {
  let time = new Date('2026-11-10T10:00:00Z');
  const app = createApp(Object.assign({
    dbFile: ':memory:',
    secret: 'test-secret-test-secret-test-secret-1234',
    publicUrl: 'https://calendar.example',
    trustProxy: true,
    publicDir: path.join(__dirname, '..', 'public'),
    now: () => time
  }, options));
  const server = http.createServer(app.handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  async function call(method, url, body, token, headers) {
    const response = await fetch(base + url, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, headers),
      body: body ? JSON.stringify(body) : undefined
    });
    const textBody = await response.text();
    let json = null;
    try { json = JSON.parse(textBody); } catch (error) { /* kein JSON */ }
    return { status: response.status, json, text: textBody, headers: response.headers };
  }

  const join = (name, extra) => call('POST', '/api/v1/join', Object.assign({
    school: 'ausserschwyz', klasse: 'M3a', self: hash(name), roster: ROSTER, alias: name.split(' ')[1] + ' ' + name[0] + '.'
  }, extra));

  return {
    app, call, join,
    advance: (minutes) => { time = new Date(time.getTime() + minutes * 60000); },
    stop: () => new Promise((resolve) => server.close(() => { app.close(); resolve(); }))
  };
}

const entry = { type: 'homework', title: 'Kapitel 4 lesen', subject: 'Deutsch', date: '2026-11-16', time: '', note: '' };
const ID = '11111111-1111-4111-8111-111111111111';

test('Beitritt: Token, Klasse wird mit dem zweiten Mitglied bestätigt', async () => {
  const s = await start();
  const a = await s.join(NAMES[0]);
  assert.strictEqual(a.status, 200);
  assert.ok(a.json.token.length >= 40);
  assert.strictEqual(a.json.klasse, 'M3a');
  assert.strictEqual(a.json.confirmed, false);
  assert.match(a.json.icsUrl, /^https:\/\/calendar\.example\/ics\/.+\.ics$/);

  const b = await s.join(NAMES[1]);
  assert.strictEqual(b.json.confirmed, true);
  assert.strictEqual((await s.call('GET', '/api/v1/me', null, a.json.token)).json.confirmed, true);
  await s.stop();
});

test('Beitritt: wer nicht auf der bestätigten Liste steht, kommt nicht hinein', async () => {
  const s = await start();
  await s.join(NAMES[0]);
  await s.join(NAMES[1]);

  const stranger = await s.join('Fremd Person', { roster: ROSTER.concat([hash('Fremd Person')]) });
  assert.strictEqual(stranger.status, 403);
  assert.strictEqual(stranger.json.error, 'not_in_roster');

  const notListed = await s.join('Fremd Person');
  assert.strictEqual(notListed.status, 403);
  assert.strictEqual(notListed.json.error, 'self_not_in_roster');
  await s.stop();
});

test('Beitritt: wer vor der Bestätigung mit erfundener Liste drin war, fliegt danach raus', async () => {
  const s = await start();
  const fake = await s.join('Fremd Person', { roster: [hash('Fremd Person'), hash('Noch Einer')] });
  assert.strictEqual(fake.status, 200);
  await s.join(NAMES[0]);
  await s.join(NAMES[1]);
  const after = await s.call('GET', '/api/v1/entries', null, fake.json.token);
  assert.strictEqual(after.status, 403);
  assert.strictEqual(after.json.error, 'not_in_roster');
  await s.stop();
});

test('Beitritt: Klassen sind getrennt, Gross/Klein im Klassennamen egal', async () => {
  const s = await start();
  const a = await s.join(NAMES[0]);
  const same = await s.join(NAMES[1], { klasse: 'm3A' });
  const other = await s.join(NAMES[0], { klasse: 'M3b' });
  await s.call('PUT', '/api/v1/entries/' + ID, entry, a.json.token);
  assert.strictEqual((await s.call('GET', '/api/v1/entries', null, same.json.token)).json.entries.length, 1);
  assert.strictEqual((await s.call('GET', '/api/v1/entries', null, other.json.token)).json.entries.length, 0);
  await s.stop();
});

test('Datenbank enthält weder Namen, Client-Hashes noch Tokens im Klartext', async () => {
  const file = path.join(require('node:os').tmpdir(), 'panum-test-' + process.pid + '.db');
  const s = await start({ dbFile: file });
  const a = await s.join(NAMES[0]);
  s.app.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const raw = fs.readFileSync(file).toString('latin1');
  assert.ok(!raw.includes('Ammann'));
  assert.ok(!raw.includes(ROSTER[0]));
  assert.ok(!raw.includes(a.json.token));
  await s.stop();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
});

test('ohne oder mit falschem Token: 401', async () => {
  const s = await start();
  assert.strictEqual((await s.call('GET', '/api/v1/entries')).status, 401);
  assert.strictEqual((await s.call('GET', '/api/v1/entries', null, 'falsch')).status, 401);
  await s.stop();
});

test('Einträge: anlegen, ändern, seit-Abgleich, löschen als Markierung', async () => {
  const s = await start();
  const a = (await s.join(NAMES[0])).json;
  const b = (await s.join(NAMES[1])).json;

  const created = await s.call('PUT', '/api/v1/entries/' + ID, entry, a.token);
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.json.rev, 1);
  assert.strictEqual(created.json.createdBy, a.memberId);

  const changed = await s.call('PUT', '/api/v1/entries/' + ID, Object.assign({}, entry, { title: 'Kapitel 5 lesen' }), b.token);
  assert.strictEqual(changed.json.rev, 2);
  assert.strictEqual(changed.json.createdBy, a.memberId);
  assert.strictEqual(changed.json.updatedBy, b.memberId);

  const all = await s.call('GET', '/api/v1/entries', null, b.token);
  assert.strictEqual(all.json.rev, 2);
  assert.strictEqual(all.json.entries[0].title, 'Kapitel 5 lesen');
  assert.strictEqual(all.json.members[a.memberId], 'Lea A.');
  assert.strictEqual((await s.call('GET', '/api/v1/entries?since=2', null, b.token)).json.entries.length, 0);

  const removed = await s.call('DELETE', '/api/v1/entries/' + ID, null, a.token);
  assert.strictEqual(removed.json.deleted, true);
  const since = await s.call('GET', '/api/v1/entries?since=2', null, b.token);
  assert.strictEqual(since.json.entries.length, 1);
  assert.strictEqual(since.json.entries[0].deleted, true);
  await s.stop();
});

test('Einträge: ungültige Felder werden abgelehnt', async () => {
  const s = await start();
  const a = (await s.join(NAMES[0])).json;
  const bad = [
    { type: 'grade' }, { title: '' }, { title: 'x'.repeat(121) }, { date: '16.11.2026' }, { date: '2026-13-40' },
    { time: '25:00' }, { note: 'x'.repeat(1001) }, { title: 5 }
  ];
  for (const change of bad) {
    const response = await s.call('PUT', '/api/v1/entries/' + ID, Object.assign({}, entry, change), a.token);
    assert.strictEqual(response.status, 400, JSON.stringify(change));
  }
  assert.strictEqual((await s.call('PUT', '/api/v1/entries/kurz', entry, a.token)).status, 404);
  assert.strictEqual((await s.call('GET', '/api/v1/entries', null, a.token)).json.entries.length, 0);
  await s.stop();
});

test('Verlauf und Rückgängig: jedes Mitglied kann eine frühere Fassung zurückholen', async () => {
  const s = await start();
  const a = (await s.join(NAMES[0])).json;
  const b = (await s.join(NAMES[1])).json;
  await s.call('PUT', '/api/v1/entries/' + ID, entry, a.token);
  await s.call('PUT', '/api/v1/entries/' + ID, Object.assign({}, entry, { title: 'Unsinn' }), b.token);
  await s.call('DELETE', '/api/v1/entries/' + ID, null, b.token);

  const history = (await s.call('GET', '/api/v1/entries/' + ID + '/history', null, a.token)).json.history;
  assert.deepStrictEqual(history.map((h) => h.action), ['delete', 'update', 'create']);
  assert.strictEqual(history[0].memberId, b.memberId);

  const first = history[2];
  const reverted = await s.call('POST', '/api/v1/entries/' + ID + '/revert', { historyId: first.id }, a.token);
  assert.strictEqual(reverted.json.title, 'Kapitel 4 lesen');
  assert.strictEqual(reverted.json.deleted, false);
  assert.strictEqual(reverted.json.rev, 4);
  assert.strictEqual((await s.call('POST', '/api/v1/entries/' + ID + '/revert', { historyId: 9999 }, a.token)).status, 404);
  await s.stop();
});

test('Aktivität: neue Mitglieder und Geräte sind für die Klasse sichtbar', async () => {
  const s = await start();
  const a = (await s.join(NAMES[0])).json;
  await s.join(NAMES[1]);
  await s.join(NAMES[1]);
  const activity = (await s.call('GET', '/api/v1/activity', null, a.token)).json;
  assert.deepStrictEqual(activity.activity.map((x) => x.kind), ['device_added', 'member_joined', 'member_joined']);
  await s.stop();
});

test('Geräte: höchstens drei pro Person, das älteste fällt weg', async () => {
  const s = await start();
  const tokens = [];
  for (let i = 0; i < 4; i++) {
    tokens.push((await s.join(NAMES[0])).json.token);
    s.advance(1);
  }
  assert.strictEqual((await s.call('GET', '/api/v1/me', null, tokens[0])).status, 401);
  const me = await s.call('GET', '/api/v1/me', null, tokens[3]);
  assert.strictEqual(me.json.devices, 3);
  await s.stop();
});

test('Handy-Login: Einmal-Code gilt 5 Minuten und nur einmal', async () => {
  const s = await start();
  const a = (await s.join(NAMES[0])).json;
  const link = (await s.call('POST', '/api/v1/link', null, a.token)).json;
  assert.match(link.url, /^https:\/\/calendar\.example\/#link=/);

  const phone = await s.call('POST', '/api/v1/link/redeem', { code: link.code });
  assert.strictEqual(phone.status, 200);
  assert.strictEqual(phone.json.memberId, a.memberId);
  assert.strictEqual((await s.call('GET', '/api/v1/entries', null, phone.json.token)).status, 200);
  assert.strictEqual((await s.call('POST', '/api/v1/link/redeem', { code: link.code })).status, 403);

  // Zahlencode zum Abtippen, mit oder ohne Leerzeichen
  const typed = (await s.call('POST', '/api/v1/link', null, a.token)).json;
  assert.match(typed.pin, /^\d{8}$/);
  const byPin = await s.call('POST', '/api/v1/link/redeem', { code: typed.pin.slice(0, 4) + ' ' + typed.pin.slice(4) });
  assert.strictEqual(byPin.status, 200);
  assert.strictEqual(byPin.json.memberId, a.memberId);
  assert.strictEqual((await s.call('POST', '/api/v1/link/redeem', { code: typed.pin })).status, 403);

  const late = (await s.call('POST', '/api/v1/link', null, a.token)).json;
  s.advance(6);
  assert.strictEqual((await s.call('POST', '/api/v1/link/redeem', { code: late.code })).status, 403);
  await s.stop();
});

test('.ics-Abo: über die geheime Klassen-URL ohne Token, ohne gelöschte Einträge', async () => {
  const s = await start();
  const a = (await s.join(NAMES[0])).json;
  await s.call('PUT', '/api/v1/entries/' + ID, entry, a.token);
  await s.call('PUT', '/api/v1/entries/22222222-2222-4222-8222-222222222222', Object.assign({}, entry, { title: 'Weg' }), a.token);
  await s.call('DELETE', '/api/v1/entries/22222222-2222-4222-8222-222222222222', null, a.token);

  const ics = await s.call('GET', new URL(a.icsUrl).pathname);
  assert.strictEqual(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(ics.text, /SUMMARY:Hausaufgabe Deutsch: Kapitel 4 lesen/);
  assert.match(ics.text, /X-WR-CALNAME:Klassenkalender M3a/);
  assert.doesNotMatch(ics.text, /Weg/);
  assert.strictEqual((await s.call('GET', '/ics/' + 'x'.repeat(43) + '.ics')).status, 404);
  await s.stop();
});

test('Löschfunktion: Geräte und Anzeigename weg, Einträge bleiben', async () => {
  const s = await start();
  const a = (await s.join(NAMES[0])).json;
  const b = (await s.join(NAMES[1])).json;
  await s.call('PUT', '/api/v1/entries/' + ID, entry, a.token);
  assert.strictEqual((await s.call('DELETE', '/api/v1/me', null, a.token)).status, 200);
  assert.strictEqual((await s.call('GET', '/api/v1/me', null, a.token)).status, 401);
  const list = (await s.call('GET', '/api/v1/entries', null, b.token)).json;
  assert.strictEqual(list.entries.length, 1);
  assert.strictEqual(list.members[a.memberId], 'Ehemaliges Mitglied');
  await s.stop();
});

test('Rate-Limit: pro Gerät, unabhängig von der IP', async () => {
  const s = await start();
  const a = (await s.join(NAMES[0])).json;
  let last = null;
  for (let i = 0; i < 61; i++) {
    last = await s.call('PUT', '/api/v1/entries/' + ID, entry, a.token, { 'X-Forwarded-For': '10.0.0.' + i });
  }
  assert.strictEqual(last.status, 429);
  s.advance(11);
  assert.strictEqual((await s.call('PUT', '/api/v1/entries/' + ID, entry, a.token)).status, 200);
  await s.stop();
});

test('Rate-Limit Beitritt: X-Forwarded-For zählt nur mit TRUST_PROXY', async () => {
  const trusted = await start();
  let last = null;
  for (let i = 0; i < 31; i++) last = await trusted.join(NAMES[0], { klasse: 'K' + i });
  assert.strictEqual(last.status, 429);
  await trusted.stop();

  const untrusted = await start({ trustProxy: false });
  for (let i = 0; i < 31; i++) {
    last = await untrusted.call('POST', '/api/v1/join', { school: 'x', klasse: 'K' + i, self: ROSTER[0], roster: ROSTER, alias: 'A' }, null, { 'X-Forwarded-For': '10.1.1.' + i });
  }
  assert.strictEqual(last.status, 429, 'gefälschter Header hilft nicht');
  await untrusted.stop();
});

test('CORS, Vorabfrage, zu grosser Body, kaputtes JSON, unbekannter Pfad', async () => {
  const s = await start();
  const options = await s.call('OPTIONS', '/api/v1/entries');
  assert.strictEqual(options.status, 204);
  assert.strictEqual(options.headers.get('access-control-allow-origin'), '*');
  assert.match(options.headers.get('access-control-allow-headers'), /Authorization/);

  const a = (await s.join(NAMES[0])).json;
  const big = await s.call('PUT', '/api/v1/entries/' + ID, Object.assign({}, entry, { note: 'x'.repeat(70000) }), a.token).catch(() => ({ status: 413 }));
  assert.strictEqual(big.status, 413);
  const broken = await s.call('POST', '/api/v1/join', '{kaputt');
  assert.strictEqual(broken.status, 400);
  assert.strictEqual(broken.json.error, 'invalid_json');
  assert.strictEqual((await s.call('GET', '/api/v2/nichts')).status, 404);
  assert.strictEqual((await s.call('GET', '/healthz')).json.ok, true);
  await s.stop();
});

test('Handy-Seite: / liefert die Seite, alle verlinkten Dateien sind da, nichts ausserhalb von public', async () => {
  const s = await start();
  const page = await s.call('GET', '/');
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(page.text, /Klassenkalender verbinden/);

  const linked = Array.from(page.text.matchAll(/(?:src|href)="([^"#]+)"/g)).map((m) => m[1]);
  assert.ok(linked.length >= 9);
  for (const file of linked.concat(['sw.js', 'icon-512.png'])) {
    assert.strictEqual((await s.call('GET', '/' + file)).status, 200, file);
  }
  const sw = (await s.call('GET', '/sw.js')).text;
  for (const file of Array.from(sw.matchAll(/'((?:shared\/)?[\w.-]+\.(?:js|css|png|webmanifest))'/g)).map((m) => m[1])) {
    assert.strictEqual((await s.call('GET', '/' + file)).status, 200, 'sw.js nennt ' + file);
  }

  for (const bad of ['/../src/app.js', '/shared/../../package.json', '/%2e%2e/package.json', '/src/app.js', '/data/calendar.db']) {
    assert.strictEqual((await s.call('GET', bad)).status, 404, bad);
  }
  await s.stop();
});

test('Handy-Seite ist aus features/classCalendar gebaut und aktuell (sonst: npm run pwa)', () => {
  const { build, target } = require('../../tools/build-pwa.js');
  for (const [file, content] of Object.entries(build())) {
    assert.strictEqual(fs.readFileSync(path.join(target, file), 'utf8').replace(/\r\n/g, '\n'), content, file);
  }
});

test('ics.js im Server ist dieselbe Datei wie in der Extension', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'src', 'ics.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', '..', 'features', 'classCalendar', 'ics.js'), 'utf8');
  assert.strictEqual(a.replace(/\r\n/g, '\n'), b.replace(/\r\n/g, '\n'));
});
