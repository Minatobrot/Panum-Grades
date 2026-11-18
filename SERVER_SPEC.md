# SERVER_SPEC – Klassenkalender

Verbindliche Beschreibung des Servers in `server/`. Wer den Server neu baut oder prüft, hält sich an dieses Dokument. Die Tests in `server/test/api.test.js` decken jeden Abschnitt ab.

## 1. Rahmen

- Ein Dienst, ein Container, eine SQLite-Datei. Node 24, keine npm-Pakete.
- Spricht intern nur HTTP. HTTPS terminiert Caddy.
- Öffentliche Basis-URL: `https://calendar.panumic.com` (`PUBLIC_URL`). Die Extension kennt nur diese eine URL.
- Der Server erhält nie: Noten, Passwörter, Schulnetz-`id`/`transid`, Cookies, Namen im Klartext, Adressen.
- Antworten sind JSON (`application/json; charset=utf-8`), ausser dem .ics-Abo.
- Fehler: passender HTTP-Status und `{"error": "<code>"}`.
- Request-Body höchstens 64 KB, sonst `413 body_too_large`. Kein gültiges JSON-Objekt: `400 invalid_json`.

### Ports

| Was | Wert | Quelle |
|---|---|---|
| Port im Container | `38417` | `APP_PORT` |
| Port auf dem Host | keiner (Standard) | – |
| Port auf dem Host, nur mit `docker-compose.hostport.yml` | `127.0.0.1:47613` | `HOST_PORT` |

### Umgebungsvariablen

| Name | Pflicht | Bedeutung |
|---|---|---|
| `PUBLIC_URL` | ja | öffentliche Adresse ohne Schrägstrich am Ende |
| `SERVER_SECRET` | ja, mind. 32 Zeichen | Schlüssel für die Namens-Hashes. Darf sich nie ändern |
| `APP_PORT` | ja | Port im Container |
| `DB_FILE` | nein, Standard `/data/calendar.db` | SQLite-Datei |
| `TRUST_PROXY` | nein, `true` oder `false` | ob `X-Forwarded-For` für IP-Limits gilt |

Fehlt eine Pflichtvariable, beendet sich der Dienst mit einer Meldung und Exit-Code 1.

### CORS

Jede Antwort trägt `Access-Control-Allow-Origin: *`, erlaubt die Header `Authorization, Content-Type` und die Methoden `GET, POST, PUT, DELETE, OPTIONS`. `OPTIONS` antwortet `204`. Das ist zulässig, weil die Anmeldung nur über den `Authorization`-Header läuft und der Server nie Cookies setzt oder liest. So braucht die Extension keine `host_permissions` für den Server.

## 2. Anmeldung

### Namens-Hashes

1. Der Client normalisiert `Nachname Vorname`: Unicode NFKC, Kleinbuchstaben, Leerraum zu einem Leerzeichen, getrimmt.
2. Der Client bildet `clientHash = SHA-256("ausserschwyz|m3a|" + name)` als 64 Hex-Zeichen (Schule und Klasse klein geschrieben). Nur dieser Hash verlässt den Browser.
3. Der Server speichert `nameHash = HMAC-SHA256(SERVER_SECRET, school + "|" + klasse + "|" + clientHash)`. Der `clientHash` selbst wird nicht gespeichert.

Wirkung: Ein Datenbank-Leck allein verrät keine Namen. Wer Datenbank **und** `SERVER_SECRET` hat und Namen raten kann, kann sie bestätigen. Das ist die Grenze dieses Verfahrens.

### Beitrittsregel (`server/src/roster.js`)

- Jedes Mitglied meldet beim Beitritt die Teilnehmerliste seiner Klasse (Liste von `clientHash`).
- Ein Name ist **bestätigt**, sobald er in den gemeldeten Listen von mindestens zwei verschiedenen Mitgliedern steht.
- Hat die Klasse noch keinen bestätigten Namen, darf beitreten, wer in seiner eigenen Liste steht.
- Hat die Klasse bestätigte Namen, darf nur beitreten, wessen Name bestätigt ist. Sonst `403 not_in_roster`.
- Bei jedem Request wird geprüft, ob der Name des Mitglieds noch bestätigt ist (oder die Klasse noch unbestätigt). Sonst `403 not_in_roster`. Wer vor der Bestätigung mit erfundener Liste beigetreten ist, verliert so den Zugriff.
- Es gibt keinen Klassencode und keine Rollen. Alle Mitglieder sind gleichberechtigt.

Bekannte Schwächen, bewusst akzeptiert:

- Wer die Namen einer Klasse kennt und die Extension manipuliert, kann als eine dieser Personen beitreten.
- Zwei abgesprochene Geräte können eine Klasse, die noch niemand benutzt, mit einer erfundenen Liste bestätigen. Echte Schüler kommen dann nicht hinein, bis der Betreiber die Klasse zurücksetzt (siehe `server/README.md`).

Gegenmittel im System: Autor und Verlauf bei jedem Eintrag, Rückgängig für alle, Limits pro Gerät und Klasse, sichtbare Meldung bei neuen Mitgliedern und Geräten. Die Regel ist in einer Datei gekapselt (`canJoin`, `isMemberValid`, `saveVote`) und kann ersetzt werden.

### Geräte-Token

- Beim Beitritt und beim Einlösen eines Handy-Codes erzeugt der Server ein Token (32 Zufallsbytes, base64url). Gespeichert wird nur `SHA-256(token)`.
- Jeder weitere Request: `Authorization: Bearer <token>`. Fehlt es: `401 missing_token`. Unbekannt: `401 invalid_token`.
- Höchstens 3 Geräte pro Mitglied. Beim vierten wird das am längsten unbenutzte gelöscht.
- Tokens laufen nicht ab.

## 3. Datenmodell

Schema in `server/src/db.js`.

| Tabelle | Inhalt |
|---|---|
| `classes` | `school`, `name` (klein), `display`, `rev` (Zähler aller Änderungen), `ics_token` |
| `members` | `class_id`, `name_hash`, `alias` (Anzeigename, z.B. "Lea A.", löschbar) |
| `roster_votes` | pro Mitglied die gemeldeten `name_hash` |
| `devices` | `member_id`, `token_hash`, `kind` (`extension`, `phone`), `created_at`, `last_seen` |
| `entries` | Kalendereinträge, Primärschlüssel (`class_id`, `id`) |
| `history` | jede Fassung jedes Eintrags als JSON, mit Mitglied und Zeit |
| `activity` | `member_joined`, `device_added` |
| `link_codes` | Einmal-Codes fürs Handy (`code_hash`, `expires_at`) |

### Eintrag (JSON)

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "type": "homework",
  "title": "Kapitel 4 lesen",
  "subject": "Deutsch",
  "date": "2026-11-16",
  "time": "",
  "note": "",
  "sourceId": "",
  "deleted": false,
  "rev": 7,
  "createdBy": 3,
  "updatedBy": 5,
  "createdAt": "2026-11-10T10:00:00.000Z",
  "updatedAt": "2026-11-11T08:12:00.000Z"
}
```

| Feld | Regel |
|---|---|
| `id` | vom Client erzeugt (UUID), 8–64 Zeichen aus `A-Z a-z 0-9 -` |
| `type` | `homework` oder `exam` |
| `title` | 1–120 Zeichen |
| `subject` | 0–40 Zeichen |
| `date` | `YYYY-MM-DD`, gültiges Datum |
| `time` | leer (ganztägig) oder `HH:MM` |
| `note` | 0–1000 Zeichen |
| `sourceId` | 0–64 Zeichen, z.B. `pru38241` für eine Prüfung aus dem Schulnetz |
| `rev`, `createdBy`, `updatedBy`, Zeitstempel | setzt der Server |

Nicht auf dem Server: der Haken "erledigt" (persönlich, bleibt im Gerät) und Einträge mit `personal: true` (Prüfungen aus Kursen, die nicht die ganze Klasse besucht).

Verstoss gegen eine Feldregel: `400 invalid_field`.

## 4. Endpunkte

Präfix `/api/v1`. "Token" heisst: `Authorization: Bearer <token>` nötig.

| Methode | Pfad | Token | Zweck |
|---|---|---|---|
| POST | `/join` | nein | beitreten, Token erhalten |
| POST | `/link/redeem` | nein | Handy-Code gegen Token tauschen |
| GET | `/me` | ja | eigene Daten |
| DELETE | `/me` | ja | eigene Daten löschen |
| POST | `/roster` | ja | Teilnehmerliste neu melden |
| GET | `/entries?since=<rev>` | ja | Einträge abgleichen |
| PUT | `/entries/:id` | ja | Eintrag anlegen oder ändern |
| DELETE | `/entries/:id` | ja | Eintrag als gelöscht markieren |
| GET | `/entries/:id/history` | ja | Verlauf |
| POST | `/entries/:id/revert` | ja | frühere Fassung zurückholen |
| GET | `/activity?since=<id>` | ja | neue Mitglieder und Geräte |
| POST | `/link` | ja | Einmal-Code fürs Handy |

Ausserhalb des Präfix:

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/` und Dateien aus `public/` | Handy-Seite, siehe Abschnitt 7 |
| GET | `/ics/<icsToken>.ics` | .ics-Abo der Klasse, ohne Token, `text/calendar` |
| GET | `/healthz` | `{"ok": true}` |

### POST /join

```json
{ "school": "ausserschwyz", "klasse": "M3a", "self": "<clientHash>", "roster": ["<clientHash>", "..."], "alias": "Lea A." }
```

- `school`: 1–40 Zeichen aus `a-z 0-9 _ -` (Pfadteil der Schulnetz-URL).
- `klasse`: 1–20 Zeichen, Abgleich ohne Gross/Klein.
- `roster`: 2–80 Hashes. Muss `self` enthalten, sonst `403 self_not_in_roster`.
- `alias`: 1–40 Zeichen.

Antwort `200`:

```json
{ "token": "…", "memberId": 3, "alias": "Lea A.", "klasse": "M3a", "confirmed": true, "icsUrl": "https://calendar.panumic.com/ics/….ics" }
```

`confirmed` sagt, ob der eigene Name bestätigt ist. Ein erneuter Beitritt derselben Person ergibt ein weiteres Gerät und einen `device_added`-Eintrag, ein erster Beitritt `member_joined`.

### GET /me, DELETE /me

`GET` liefert `memberId`, `alias`, `klasse`, `confirmed`, `devices` (Anzahl), `icsUrl`.

`DELETE` löscht alle Geräte, die gemeldete Liste, offene Handy-Codes und den Anzeigenamen des Mitglieds. Seine Einträge bleiben der Klasse erhalten und zeigen als Autor "Ehemaliges Mitglied".

### POST /roster

Body `{ "roster": ["<clientHash>", "..."] }`. Ersetzt die gemeldete Liste des Mitglieds. Muss den eigenen Namen enthalten (`400 self_not_in_roster`).

### GET /entries

Antwort: `{ "rev": 12, "entries": [...], "members": { "3": "Lea A." } }`. Mit `since` nur Einträge mit `rev > since`, gelöschte eingeschlossen (`deleted: true`). Der Client merkt sich `rev` und fragt damit das nächste Mal.

### PUT /entries/:id

Body: `type`, `title`, `subject`, `date`, `time`, `note`, `sourceId`. Legt an oder überschreibt (die letzte Änderung gewinnt, die vorherige Fassung steht im Verlauf). Ein gelöschter Eintrag wird durch `PUT` wieder sichtbar. Antwort: der gespeicherte Eintrag.

### DELETE /entries/:id

Setzt `deleted: true`. Unbekannte `id`: `404 not_found`. Antwort: der Eintrag.

### GET /entries/:id/history, POST /entries/:id/revert

Verlauf: die letzten 50 Fassungen, neueste zuerst: `{ "history": [{ "id": 9, "action": "delete", "memberId": 5, "at": "…", "entry": {…} }], "members": {…} }`. `action` ist `create`, `update`, `delete` oder `revert`.

Revert: Body `{ "historyId": 7 }`. Schreibt diese Fassung als neue Fassung (`action: revert`). Jedes Mitglied darf das.

### GET /activity

`{ "activity": [{ "id": 4, "kind": "member_joined", "memberId": 6, "at": "…" }], "members": {…} }`, höchstens 50, neueste zuerst.

### POST /link, POST /link/redeem

`/link` liefert `{ "code": "…", "pin": "12345678", "url": "https://calendar.panumic.com/#link=…", "expiresAt": "…" }`.

- `code` steckt im QR-Code bzw. Link. Er steht hinter `#`, damit er nicht in Server- oder Proxy-Logs landet.
- `pin` sind 8 Ziffern zum Abtippen. Gedacht für die App auf dem Home-Bildschirm des iPhones: sie hat einen eigenen Speicher, getrennt von Safari, in dem der QR-Code geöffnet wird.
- Beide gelten 5 Minuten und je genau einmal.

`/link/redeem` mit `{ "code": "…" }` nimmt `code` oder `pin` (Leerzeichen werden entfernt) und liefert dieselbe Antwort wie `/join`, das Gerät hat `kind: phone`. Abgelaufen, benutzt oder unbekannt: `403 invalid_code`.

### GET /ics/<icsToken>.ics

Alle nicht gelöschten Einträge der Klasse als iCalendar (`server/src/ics.js`, identisch mit `features/classCalendar/ics.js`). Die URL ist das Geheimnis: wer sie hat, kann den Kalender lesen. Sie ist pro Klasse gleich.

## 5. Limits

Zähler pro Schlüssel im Arbeitsspeicher (nach Neustart leer). Überschreitung: `429 rate_limited`.

| Schlüssel | Grenze |
|---|---|
| Schreiben pro Gerät | 60 in 10 Minuten |
| Schreiben pro Klasse | 600 pro Stunde |
| Alle Requests pro Gerät | 600 in 10 Minuten |
| Beitritt pro Klasse | 60 pro Stunde |
| Beitritt pro IP | 30 pro Stunde |
| `/roster` pro Gerät | 10 pro Stunde |
| `/link` pro Gerät | 10 pro Stunde |
| `/link/redeem` pro IP | 20 pro Stunde |
| `/link/redeem` insgesamt | 600 pro Stunde |
| .ics pro IP | 120 pro Stunde |

Die IP stammt aus `X-Forwarded-For` (erster Wert), wenn `TRUST_PROXY=true`, sonst aus der Verbindung. Weil hinter VPS und Caddy alle dieselbe IP haben können, sind die IP-Grenzen grosszügig und die Grenzen pro Gerät und Klasse die eigentlichen.

## 6. Logs

Der Dienst loggt den Start und unerwartete Fehler (Methode, Pfad ohne .ics-Token, Meldung). Er loggt nie Tokens, Hashes, Aliasse oder Request-Inhalte.

## 7. Handy-Seite (PWA)

Der Server liefert unter `/` die Handy-Seite aus `server/public/` aus.

- Beim Start liest der Dienst alle Dateien aus `public/` mit den Endungen `.html`, `.js`, `.css`, `.png`, `.webmanifest` in den Speicher. Ausgeliefert wird nur, was in dieser Liste steht. Alles andere ergibt `404 not_found`.
- `/` entspricht `/index.html`.
- Header für diese Dateien: `Cache-Control: no-cache`, `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `Referrer-Policy: no-referrer`.
- `index.html` und `shared/*` werden mit `npm run pwa` (im Hauptordner) aus `features/classCalendar/` erzeugt. Es ist dieselbe Oberfläche wie das Panel in der Extension. Von Hand gepflegt sind nur `config.js`, `pwa.js`, `sw.js`, `manifest.webmanifest` und die Icons.
- Es gibt keinen Login-Bildschirm mit Passwort. Ohne Token zeigt die Seite die Anleitung "Handy verbinden". Der QR-Code aus der Extension führt auf `/#link=<code>`, die Seite löst ihn über `POST /api/v1/link/redeem` ein, speichert das Token in IndexedDB und entfernt den Code aus der Adresse.
- `sw.js` hält nur die Seite selbst vor (online zuerst das Netz, offline der Cache). Pfade unter `/api/`, `/ics/` und `/healthz` laufen nie durch den Cache.

## 8. Was der Client macht (Extension und Handy-Seite)

Code: `features/classCalendar/sync.js`. Zur Einordnung, der Server muss davon nichts wissen.

- Lokaler Speicher: getrennt nach Konto (Schule, Klasse, Name), siehe `features/classCalendar/scope.js`. Ein Token wird nie für ein anderes Konto benutzt, und nur Einträge des eigenen Kontos werden hochgeladen.
- Beitritt: automatisch beim ersten Öffnen des Kalenders auf der Notenseite. Die Teilnehmerliste wird alle 14 Tage neu gemeldet (`POST /roster`).
- Abgleich: beim Öffnen, nach jeder Änderung, jede Minute solange das Panel offen ist. Erst lokale Änderungen hochladen (`PUT`/`DELETE`), dann `GET /entries?since=<rev>`.
- Lokale Änderungen, die noch nicht hochgeladen sind, werden beim Holen nicht überschrieben.
- Prüfungen aus dem Schulnetz bekommen die `id` `schulnetz-<sourceId>`, damit dieselbe Prüfung von zwei Personen ein Eintrag bleibt.
- `401`/`403` beim Abgleich: der Client verwirft sein Token. Die Extension tritt beim nächsten Öffnen neu bei, das Handy braucht einen neuen QR-Code.
- "Meine Daten löschen": `DELETE /me`, danach lokaler Speicher leer und kein automatischer Neubeitritt, bis "Mit Klasse verbinden" geklickt wird.

## 9. Noch nicht gebaut

- Streaks/XP (Phase 7).
