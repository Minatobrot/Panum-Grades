# 🎓 Panum Grades

> Eine Browser-Erweiterung zur Verbesserung und Optimierung der Noten-Workflows in Schulnetz.

**Aktuelle Version: 3.1.4** · Chrome, Edge, Firefox · [Website](https://minatobrot.github.io/grades/)

---

## ✨ Funktionen

* **Notenrechner:** Zielnote und Probe-Noten in einem Panel. Die Zielnote rechnet Probe-Noten mit ein.
* **Live-Durchschnitte:** Schnitt pro Fach und gesamt, direkt auf der Seite „Aktuelle Noten“.
* **Pluspunkte:** Eigener Button mit Übersicht, optional Wert und Schalter direkt in der Notentabelle, „Fächer verbinden“.
* **Verbesserungen:** Zeigt, wo sich der Aufwand am meisten lohnt und welche Fächer gefährdet sind.
* **Prüfungen:** Holt den Prüfungsplan aus Schulnetz, zeigt nur die eigenen Kurse und exportiert als `.ics`.
* **Klassenkalender (freiwillig):** Hausaufgaben und Prüfungen gemeinsam mit der Klasse pflegen, mit Verlauf, Rückgängig, `.ics`-Abo (Google, webcal) und Handy-Ansicht per Code oder QR. Ohne Zustimmung bleibt der Kalender rein lokal.
* **Achievements:** Gamification mit Abzeichen und Fortschritt.
* **Dark Mode** für Schulnetz und alle Panels.
* **Button-Leiste:** Alle Buttons in einer Leiste, Anordnung im Popup änderbar, einzeln ein- und ausschaltbar.

## 🆕 Änderungen

### 3.1.4
* Klassenkalender: Schule wird vorerst fest als `ksa` gesetzt, damit Klassen derselben Schule zuverlässig zusammenfinden.
* Pluspunkte-Button wieder dabei (im Aussehen von 3.0.2), Anzeige in der Tabelle separat schaltbar (Standard: aus), Einführung beim ersten Öffnen.
* Popup: gelegentliche Tipps zu Funktionen.
* Klarere Hinweise im Code, welche Daten der Klassenkalender sendet.

### 3.1.0 – 3.1.3
* Neue Button-Leiste (`features/dock.js`), neues Aussehen (`themes/panum-ui.css`) in hell und dunkel.
* Notenrechner überarbeitet, Pluspunkte direkt in der Tabelle.
* Prüfungen: Fehler „zeigt Schultermine statt Prüfungen“ behoben, Filter auf eigene Kurse.

### 3.0.x
* Klassenkalender, Prüfungsplan, Server-Anbindung, Einführung, Kalender-Abo.
* Lokaler Speicher getrennt pro Schulnetz-Konto.

## 📦 Installation (Entwicklerversion)

1. Repository herunterladen oder klonen.
2. **Chrome/Edge:** `chrome://extensions` → Entwicklermodus → „Entpackte Erweiterung laden“ → Ordner wählen.
3. **Firefox:** `about:debugging` → „Dieser Firefox“ → „Temporäres Add-on laden“ → `manifest.json` wählen.

## 🗓️ Server für den Klassenkalender

Der Server liegt in [`server_new/`](server_new/), die API ist in [`SERVER_SPEC.md`](SERVER_SPEC.md) beschrieben. Node 24 ohne npm-Pakete, SQLite, ein Docker-Container. Namen werden nur als Hash gespeichert (Client: SHA-256, Server: HMAC mit `SERVER_SECRET`), Noten gibt es auf dem Server nicht. Er liefert auch die Handy-Ansicht (`server_new/public/`) aus. Einrichtung: siehe [`server_new/README.md`](server_new/README.md).

---

## 🛠️ Projektbetreuer & Mitwirkende

* **Hauptentwickler:** panumic (Code aktualisiert und gepflegt mit Unterstützung von KI).
* **Mitwirkende:** Besonderer Dank geht an TyZWt6v für die Mithilfe bei der Pflege des Projekts, einschließlich wichtiger Fehlerbehebungen für den Dark Mode.

## 💡 Feedback & Mitwirkung

Dein Feedback ist uns sehr wichtig! 
Wenn du einen Fehler (Bug) findest, allgemeines Feedback hast oder eine neue Funktion vorschlagen möchtest, kannst du jederzeit gerne ein **Issue eröffnen**.

---

## ⚖️ Lizenz

Dieses Projekt ist Open Source und steht unter der **AGPL-3.0 Lizenz**, mit Ausnahme von Drittanbieter-Komponenten, die in der Datei `THIRD-PARTY-LICENSES.md` übersichtlich aufgelistet sind.

*Hinweis: Dieses Projekt ist kein offizielles Angebot eines Kantons, einer Schule oder der Centerboard AG. Es handelt sich um eine völlig unabhängige Open-Source-Erweiterung.*

---

## ⚠️ Haftungsausschluss (Disclaimer)

* **Keine offizielle Verbindung:** Es besteht keine offizielle Zusammenarbeit oder Partnerschaft mit den Betreibern von Schulnetz. Diese Erweiterung ist ein unabhängiges Projekt.
* **Nutzung auf eigene Gefahr:** Das Add-on wird „wie besehen“ (*as-is*) und ohne jegliche Gewährleistung bereitgestellt. Für die Richtigkeit der angezeigten Daten – insbesondere Noten und Termine – sind weiterhin ausschließlich die offiziellen Anzeigen im originalen Schulnetz-System maßgeblich.

### 🔒 Datenschutz

* **Standardmässig lokal:** Noten, Einstellungen und Berechnungen werden ausschließlich lokal in deinem Browser verarbeitet und gespeichert. Standardmässig werden 0 Bytes an einen Server gesendet.
* **Klassenkalender (freiwillig):** Nur wenn du den Klassenkalender aktivierst und dem Teilen zustimmst, gehen Kalendereinträge (Titel, Fach, Datum, Notiz), Schule und Klasse, gehashte Namen der Klassenliste und dein Kurzname (z. B. „Anna M.“) an `calendar.panumic.com`. **Noten, Login-Daten und Schulnetz-Sitzungen werden nie gesendet.** Mit „Meine Daten löschen“ entfernst du alles auf dem Server.
* **Feedback:** Nur wenn du im Popup aktiv Feedback abschickst, wird dein Text an ein Google-Formular übermittelt.
* **Store-Statistiken:** Die Browser-Stores (Chrome, Edge, Firefox) erfassen eigene, anonyme Installationszahlen.
