# Klassenkalender-Server

Kleiner HTTP-Dienst für den Klassenkalender der Panum-Grades-Extension. Node 24 ohne npm-Pakete, SQLite in einer Datei, ein Container. Die API ist in [`../SERVER_SPEC.md`](../SERVER_SPEC.md) beschrieben.

Der Server sieht nie Noten, Passwörter oder Schulnetz-Sessions. Namen kommen nur als Hash an.

## Start

```sh
cp .env.example .env
# in .env setzen: SERVER_SECRET (openssl rand -base64 48) und CADDY_NETWORK
docker compose up -d --build
docker compose logs -f        # erwartet: "Klassenkalender hört auf Port 38417"
```

Docker-Netzwerk von Caddy herausfinden:

```sh
docker inspect <dein-caddy-container> --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

## Ports

| Was | Wert | Quelle | Erreichbar von |
|---|---|---|---|
| Port im Container | `38417` | `APP_PORT` in `.env` | nur im Docker-Netzwerk `CADDY_NETWORK` |
| Port auf dem Host | keiner | – | – |
| Port auf dem Host (nur mit `docker-compose.hostport.yml`) | `47613` | `HOST_PORT` in `.env` | nur `127.0.0.1` |

In den Compose-Dateien steht kein Port fest drin, alles kommt aus `.env`.

## Caddy

Block für das Caddyfile (Container-Name und Port wie in `.env`):

```caddyfile
calendar.panumic.com {
	encode gzip
	reverse_proxy panum-calendar:38417
}
```

Danach Caddy neu laden: `docker exec <dein-caddy-container> caddy reload --config /etc/caddy/Caddyfile` (Pfad anpassen, falls dein Caddyfile woanders liegt).

Nur falls Caddy einmal direkt auf dem Host läuft statt in Docker: mit Host-Port starten. Der Port ist an `127.0.0.1` gebunden und deshalb aus anderen Containern nicht erreichbar.

```sh
docker compose -f docker-compose.yml -f docker-compose.hostport.yml up -d --build
```

```caddyfile
calendar.panumic.com {
	encode gzip
	reverse_proxy 127.0.0.1:47613
}
```

Der Dienst spricht intern nur HTTP. HTTPS und das Zertifikat macht Caddy. Auf dem VPS ist nichts zu ändern, solange er 80/443 schon zum Homeserver weiterleitet. Der DNS-Eintrag `calendar.panumic.com` muss auf den VPS zeigen.

### Echte Client-IP

Hinter VPS (iptables) und Caddy ist die echte IP oft nicht sichtbar. Darum hängen die Limits am Gerät und an der Klasse, die IP zählt nur zusätzlich beim Beitritt. `TRUST_PROXY=true` heisst: `X-Forwarded-For` wird geglaubt. Das ist nur richtig, solange niemand am Caddy vorbei auf den Container kommt, was ohne veröffentlichten Port der Fall ist.

## Prüfen

```sh
curl https://calendar.panumic.com/healthz      # {"ok":true}
curl -I https://calendar.panumic.com/          # 200, text/html
```

Im Browser zeigt `https://calendar.panumic.com` die Handy-Seite. Ohne verbundenes Gerät steht dort die Anleitung "Klassenkalender verbinden", kein Login-Formular: verbunden wird über den QR-Code aus der Extension.

## Handy-Seite

Liegt in `public/` und wird ins Image kopiert. `index.html` und `shared/` sind erzeugt: nach Änderungen an `features/classCalendar/` im Hauptordner `npm run pwa` laufen lassen, dann `public/` neu hochladen und `docker compose up -d --build`.

## Daten

- Datenbank: `./data/calendar.db` (plus `-wal` und `-shm`). Backup: Container stoppen und den Ordner `data/` kopieren, oder im Betrieb `sqlite3 data/calendar.db ".backup backup.db"`.
- `SERVER_SECRET` gehört zum Backup. Ohne das gleiche Geheimnis passt kein gespeicherter Name mehr, alle müssten neu beitreten.
- Eine Klasse zurücksetzen (z.B. falsch bestätigte Teilnehmerliste): `sqlite3 data/calendar.db "DELETE FROM classes WHERE school='ausserschwyz' AND name='m3a';"` löscht die Klasse samt Mitgliedern und Einträgen.

## Tests

```sh
npm test      # braucht Node 24, kein npm install nötig
```

## Update

```sh
docker compose up -d --build
```

Das Schema legt sich beim Start selbst an (`src/db.js`).
