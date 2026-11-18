// Pluspunkte direkt in der Tabelle "Aktuelle Noten": ein Wert pro Fach, darüber eine Zeile mit Summe und Schnitt.
// Zweite Ansicht neben dem Pluspunkte-Button (buttons/pluspoints-button.js). Standard: aus, einschaltbar im
// Panel des Buttons, im Popup und im Tutorial (Speicher-Key pluspointsInlineEnabled).
// Fächer aus-/einschalten und verbinden nutzt dieselben gespeicherten Einstellungen wie der Button
// (pluspointsHiddenFaecher, mergedSubjects).
//
// Liest die Noten nicht selbst: Quelle bleibt notenDaten vom Scraper in content.js.
// Schulnetz baut die Tabelle teils neu auf (Filter, Detailansicht), darum wird nach jeder Änderung nachgezogen.

(function () {
  'use strict';

  const G = window.PanumGrades;
  const GRADES_PAGE_ID = '21311';
  const ENABLED_KEY = 'pluspointsInlineEnabled';
  const CHANGED_EVENT = 'panum-pp-changed'; // Fächer-Schalter oder Verbindungen geändert (auch vom Panel des Buttons)
  const BAR_ID = 'panum-pp-bar';
  const DIALOG_ID = 'panum-pp-dialog';

  const LINK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8A3 3 0 0 0 7.2 13l.8-.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  const storage = typeof browser !== 'undefined' && browser.storage ? browser.storage : null;

  let enabled = false;
  let notenDaten = [];
  let renderTimer = null;
  let wasIncognito = false;

  function isGradesPage() {
    const params = new URLSearchParams(window.location.search);
    const output = (params.get('output') || '').toLowerCase();
    return params.get('pageid') === GRADES_PAGE_ID && output !== 'pdf' && output !== 'print';
  }

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Derselbe Schlüssel, den der Scraper als "fach" speichert (Text im <b> der Kurszeile)
  function fachKey(b) {
    const lines = b.textContent.trim().split('\n');
    return lines.length >= 2 ? lines[0].trim() + ' - ' + lines[1].trim() : lines[0].trim();
  }

  // Kurszeilen der Notentabelle: [{ row, fach, name }]. name = ausgeschriebenes Fach ("Biologie").
  function courseRows(doc) {
    const rows = [];
    doc.querySelectorAll('tr').forEach((detail) => {
      if (!Array.from(detail.classList).some((cls) => cls.endsWith('_detailrow'))) return;
      const row = detail.previousElementSibling;
      const b = row && row.querySelector('b');
      if (!b || !row.children.length) return;
      const cell = row.children[0];
      const name = cell.textContent.replace(b.textContent, '').replace(/\s+/g, ' ').trim();
      rows.push({ row: row, fach: fachKey(b), name: name || b.textContent.trim() });
    });
    return rows;
  }

  // Zwei Kurse können gleich heissen (Schwerpunktfach Biologie und Chemie): dann steht das Kürzel dabei
  function labels(rows) {
    const count = {};
    rows.forEach((r) => { count[r.name] = (count[r.name] || 0) + 1; });
    const map = {};
    rows.forEach((r) => { map[r.fach] = count[r.name] > 1 ? r.name + ' (' + r.fach + ')' : r.name; });
    return (fach) => map[fach] || G.shortName(fach);
  }

  function tone(points) {
    return points > 0 ? 'is-pos' : points < 0 ? 'is-neg' : 'is-zero';
  }

  function switchEl(checked, title, onChange) {
    const label = h('label', 'pg-switch');
    label.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('aria-label', title);
    input.addEventListener('change', () => onChange(input.checked));
    label.appendChild(input);
    label.appendChild(h('span', 'pg-switch-track'));
    return label;
  }

  function setHidden(key, hidden) {
    const list = G.loadHidden().filter((k) => k !== key);
    if (hidden) list.push(key);
    G.saveHidden(list);
    announce();
  }

  // Zeichnet die Tabelle neu (eigener Listener) und sagt es dem offenen Pluspunkte-Panel
  function announce() {
    document.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  }

  // ---------- Tabelle ----------

  function renderRow(entry, info, state, nameOf) {
    // In der Schnitt-Zelle, am rechten Rand: so stehen Wert und Schalter in allen Zeilen exakt untereinander.
    // Ans Ende gehängt, damit die Zelle weiter mit dem Schnitt beginnt (Dark Theme und Incognito lesen ihn dort).
    const cell = entry.row.children[1] || entry.row.children[0];
    let slot = entry.row.querySelector('.panum-pp');

    if (!info || info.points === null) {
      if (slot) slot.remove();
      cell.classList.remove('panum-pp-cell');
      return;
    }

    const group = info.group === null ? null : state.groups[info.group];
    const signature = [entry.fach, info.points, info.hidden, group ? group.name : ''].join('|');
    if (slot && slot.dataset.signature === signature && slot.parentNode === cell) return;

    if (slot) slot.remove();
    slot = h('span', 'pg panum-pp');
    slot.dataset.signature = signature;

    if (group) {
      const chip = h('span', 'pg-chip');
      chip.innerHTML = LINK_SVG;
      chip.appendChild(h('span', '', group.name));
      chip.title = 'Zählt zusammen mit anderen Fächern als «' + group.name + '». Die Punkte stehen oben in der Pluspunkte-Zeile.';
      slot.appendChild(chip);
    } else {
      const badge = h('span', 'pg-badge ' + (info.hidden ? 'is-off' : tone(info.points)), info.hidden ? '–' : G.formatPoints(info.points));
      badge.title = info.hidden
        ? nameOf(entry.fach) + ' zählt nicht für die Pluspunkte'
        : 'Pluspunkte für ' + nameOf(entry.fach) + ' (Schnitt ' + info.avg.toFixed(2) + ')';
      slot.appendChild(badge);
      slot.appendChild(switchEl(!info.hidden, 'Fach für die Pluspunkte mitzählen', (on) => setHidden(entry.fach, !on)));
    }
    // Die Klasse hält rechts in der Zelle den Platz frei, auf dem Wert und Schalter stehen
    cell.classList.add('panum-pp-cell');
    cell.appendChild(slot);
  }

  function renderBar(table, state, merged, nameOf) {
    const signature = JSON.stringify([state.total, state.average, state.count, state.groups, merged]);
    let bar = document.getElementById(BAR_ID);
    if (bar && bar.dataset.signature === signature && bar.nextElementSibling === table) return;

    if (bar) bar.remove();
    bar = h('div', 'pg panum-pp-bar');
    bar.id = BAR_ID;
    bar.dataset.signature = signature;

    const total = h('div', 'pg-stat');
    total.appendChild(h('span', 'pg-stat-label', 'Pluspunkte'));
    total.appendChild(h('span', 'pg-stat-value ' + tone(state.total), G.formatPoints(state.total)));
    total.title = 'Summe über ' + state.count + ' gezählte Fächer. Ungenügende Noten zählen doppelt.';
    bar.appendChild(total);

    const avg = h('div', 'pg-stat');
    avg.appendChild(h('span', 'pg-stat-label', 'Schnitt'));
    avg.appendChild(h('span', 'pg-stat-value', state.average === null ? '–' : state.average.toFixed(2)));
    avg.title = 'Durchschnitt über ' + state.count + ' gezählte Fächer';
    bar.appendChild(avg);

    state.groups.forEach((group, index) => {
      const chip = h('div', 'pg-group');
      chip.title = G.groupText(merged[index], nameOf) + (group.avg === null ? '' : ' · Schnitt ' + group.avg.toFixed(2));
      const name = h('span', 'pg-group-name');
      name.innerHTML = LINK_SVG;
      name.appendChild(h('span', '', group.name));
      chip.appendChild(name);
      if (group.points !== null) {
        chip.appendChild(h('span', 'pg-badge ' + (group.hidden ? 'is-off' : tone(group.points)), group.hidden ? '–' : G.formatPoints(group.points)));
        chip.appendChild(switchEl(!group.hidden, 'Verbindung für die Pluspunkte mitzählen', (on) => setHidden(group.key, !on)));
      }
      bar.appendChild(chip);
    });

    bar.appendChild(h('span', 'pg-spacer'));

    const mergeButton = h('button', 'pg-btn pg-btn-quiet', 'Fächer verbinden');
    mergeButton.type = 'button';
    mergeButton.addEventListener('click', openDialog);
    bar.appendChild(mergeButton);

    const info = h('span', 'pg-muted panum-pp-note', 'nur informativ');
    info.title = 'Berechnet von Panum Grades aus deinen Noten. Nicht verbindlich. Schalter neben einem Fach: Fach mitzählen oder nicht.';
    bar.appendChild(info);

    table.parentNode.insertBefore(bar, table);
  }

  function cleanup() {
    document.querySelectorAll('.panum-pp').forEach((node) => node.remove());
    document.querySelectorAll('.panum-pp-cell').forEach((node) => node.classList.remove('panum-pp-cell'));
    const bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
  }

  function isIncognito() {
    return !!document.querySelector('.sn-incognito-btn.active');
  }

  function render() {
    const rows = courseRows(document);
    const incognito = isIncognito();

    // Im Incognito-Modus stehen in der Tabelle Platzhalter. Danach die echten Noten neu einlesen lassen.
    if (wasIncognito && !incognito && window.notenrechnerDebug && window.notenrechnerDebug.scanAndSaveAll) {
      window.notenrechnerDebug.scanAndSaveAll();
    }
    wasIncognito = incognito;

    if (!enabled || incognito || !rows.length || !notenDaten.length) {
      cleanup();
      return;
    }

    const merged = G.loadMerged();
    const state = G.pluspoints(notenDaten, merged, G.loadHidden());
    const nameOf = labels(rows);
    const table = rows[0].row.closest('table');

    renderBar(table, state, merged, nameOf);
    rows.forEach((entry) => renderRow(entry, state.subjects[entry.fach], state, nameOf));
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 120);
  }

  // ---------- Dialog "Fächer verbinden" ----------

  function closeDialog() {
    const dialog = document.getElementById(DIALOG_ID);
    if (dialog) dialog.remove();
  }

  function openDialog() {
    closeDialog();
    const rows = courseRows(document);
    const nameOf = labels(rows);
    let selected = [];
    let percentages = [];

    const overlay = h('div', 'pg pg-modal-overlay');
    overlay.id = DIALOG_ID;
    const modal = h('div', 'pg-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Fächer verbinden');
    overlay.appendChild(modal);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeDialog(); });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeDialog(); }
    });

    function draw() {
      const merged = G.loadMerged();
      const used = new Set();
      merged.forEach((group) => group.subjects.forEach((subject) => used.add(subject)));
      modal.textContent = '';

      const head = h('div', 'pg-modal-head');
      head.appendChild(h('div', 'pg-modal-title', 'Fächer verbinden'));
      const x = h('button', 'pg-icon-btn', '×');
      x.type = 'button';
      x.title = 'Schliessen';
      x.addEventListener('click', closeDialog);
      head.appendChild(x);
      modal.appendChild(head);

      modal.appendChild(h('p', 'pg-muted', 'Verbundene Fächer zählen zusammen als eine Note, zum Beispiel beide Teile eines Schwerpunktfachs. Die Pluspunkte werden aus ihrem gemeinsamen Schnitt berechnet.'));

      if (merged.length) {
        modal.appendChild(h('div', 'pg-label', 'Bestehende Verbindungen'));
        merged.forEach((group, index) => {
          const item = h('div', 'pg-row pg-card');
          const text = h('div', 'pg-grow');
          text.appendChild(h('div', 'pg-strong', group.name || 'Verbindung ' + (index + 1)));
          text.appendChild(h('div', 'pg-muted', G.groupText(group, nameOf)));
          item.appendChild(text);
          const cut = h('button', 'pg-btn pg-btn-danger', 'Trennen');
          cut.type = 'button';
          cut.addEventListener('click', () => {
            const next = G.removeGroup(merged, G.loadHidden(), index);
            G.saveMerged(next.merged);
            G.saveHidden(next.hidden);
            draw();
            announce();
          });
          item.appendChild(cut);
          modal.appendChild(item);
        });
      }

      modal.appendChild(h('div', 'pg-label', 'Neue Verbindung: 2 bis ' + G.MAX_GROUP_SIZE + ' Fächer antippen'));
      const chips = h('div', 'pg-chips');
      const available = notenDaten.filter((fach) => !used.has(fach.fach));
      available.forEach((fach) => {
        const on = selected.includes(fach.fach);
        const chip = h('button', 'pg-pick' + (on ? ' is-on' : ''), nameOf(fach.fach));
        chip.type = 'button';
        chip.setAttribute('aria-pressed', String(on));
        chip.disabled = !on && selected.length >= G.MAX_GROUP_SIZE;
        chip.addEventListener('click', () => {
          selected = on ? selected.filter((s) => s !== fach.fach) : selected.concat([fach.fach]);
          percentages = selected.length ? G.equalPercentages(selected.length) : [];
          draw();
        });
        chips.appendChild(chip);
      });
      if (!available.length) chips.appendChild(h('span', 'pg-muted', 'Alle Fächer sind schon verbunden.'));
      modal.appendChild(chips);

      const error = h('div', 'pg-error');
      let nameInput = null;

      if (selected.length) {
        modal.appendChild(h('div', 'pg-label', 'Anteil am gemeinsamen Schnitt'));
        selected.forEach((subject, i) => {
          const line = h('div', 'pg-row');
          line.appendChild(h('span', 'pg-grow', nameOf(subject)));
          const input = h('input', 'pg-input pg-input-small');
          input.type = 'number';
          input.min = '1';
          input.max = '100';
          input.value = percentages[i];
          input.setAttribute('aria-label', 'Anteil ' + nameOf(subject) + ' in Prozent');
          input.addEventListener('input', () => { percentages[i] = parseInt(input.value, 10) || 0; });
          line.appendChild(input);
          line.appendChild(h('span', 'pg-muted', '%'));
          modal.appendChild(line);
        });

        modal.appendChild(h('div', 'pg-label', 'Name (freiwillig)'));
        nameInput = h('input', 'pg-input');
        nameInput.type = 'text';
        nameInput.maxLength = 40;
        nameInput.placeholder = 'Verbindung ' + (merged.length + 1);
        modal.appendChild(nameInput);
      }
      modal.appendChild(error);

      const foot = h('div', 'pg-modal-foot');
      const cancel = h('button', 'pg-btn', 'Schliessen');
      cancel.type = 'button';
      cancel.addEventListener('click', closeDialog);
      foot.appendChild(cancel);
      const save = h('button', 'pg-btn pg-btn-primary', 'Verbinden');
      save.type = 'button';
      save.disabled = selected.length < 2;
      save.addEventListener('click', () => {
        if (percentages.some((p) => p < 1) || percentages.reduce((a, b) => a + b, 0) !== 100) {
          error.textContent = 'Die Anteile müssen zusammen 100 % ergeben (jetzt ' + percentages.reduce((a, b) => a + b, 0) + ' %).';
          return;
        }
        merged.push({
          subjects: selected.slice(),
          percentages: percentages.slice(),
          name: (nameInput && nameInput.value.trim()) || 'Verbindung ' + (merged.length + 1)
        });
        G.saveMerged(merged);
        // Einzeln ausgeschaltete Fächer zählen in der Verbindung wieder mit, der Merker wäre sonst unsichtbar
        G.saveHidden(G.loadHidden().filter((key) => !selected.includes(key)));
        closeDialog();
        announce();
      });
      foot.appendChild(save);
      modal.appendChild(foot);
    }

    draw();
    document.body.appendChild(overlay);
  }

  // ---------- Start ----------

  function start() {
    if (!isGradesPage()) return;
    document.addEventListener(CHANGED_EVENT, render);

    const boot = (result) => {
      enabled = result[ENABLED_KEY] === true;
      notenDaten = Array.isArray(result.notenDaten) ? result.notenDaten : [];
      const begin = () => {
        render();
        new MutationObserver(scheduleRender).observe(document.body, { childList: true, subtree: true });
      };
      if (!notenDaten.length) {
        G.load().then((list) => { notenDaten = list; begin(); });
      } else {
        begin();
      }
    };

    if (!storage) {
      boot({});
      return;
    }
    storage.local.get([ENABLED_KEY, 'notenDaten']).then(boot, () => boot({}));
    storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[ENABLED_KEY]) enabled = changes[ENABLED_KEY].newValue === true;
      if (changes.notenDaten) notenDaten = Array.isArray(changes.notenDaten.newValue) ? changes.notenDaten.newValue : [];
      if (changes[ENABLED_KEY] || changes.notenDaten) scheduleRender();
    });
  }

  window.PanumPluspoints = { courseRows, labels, render, openDialog };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
