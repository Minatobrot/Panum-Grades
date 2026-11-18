// SQLite-Schema. Eine Datei, keine Migrationstools: neue Tabellen/Spalten kommen als weiterer Block unten dazu.

const { DatabaseSync } = require('node:sqlite');

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY,
      school TEXT NOT NULL,
      name TEXT NOT NULL,              -- klein geschrieben, zum Abgleich
      display TEXT NOT NULL,           -- wie im Schulnetz, z.B. "M3a"
      rev INTEGER NOT NULL DEFAULT 0,  -- zählt bei jeder Änderung an einem Eintrag hoch
      ics_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      UNIQUE (school, name)
    );

    -- Namen stehen nie im Klartext hier: name_hash = HMAC(SERVER_SECRET, Klasse + Hash vom Client)
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      name_hash TEXT NOT NULL,
      alias TEXT,                      -- Anzeigename "Vorname N.", vom Mitglied löschbar
      created_at TEXT NOT NULL,
      UNIQUE (class_id, name_hash)
    );

    -- Jedes Mitglied meldet die Teilnehmerliste, die es im Schulnetz sieht
    CREATE TABLE IF NOT EXISTS roster_votes (
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      name_hash TEXT NOT NULL,
      PRIMARY KEY (member_id, name_hash)
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,              -- extension | phone
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entries (
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0,
      rev INTEGER NOT NULL,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (class_id, id)
    );

    -- Jede Fassung eines Eintrags, damit jedes Mitglied Änderungen zurücknehmen kann
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL,
      action TEXT NOT NULL,            -- create | update | delete | revert
      data TEXT NOT NULL,              -- Eintrag nach der Änderung als JSON
      member_id INTEGER,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_entry ON history (class_id, entry_id);

    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,              -- member_joined | device_added
      member_id INTEGER,
      at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS link_codes (
      code_hash TEXT PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
  `);

  return db;
}

module.exports = { openDb };
