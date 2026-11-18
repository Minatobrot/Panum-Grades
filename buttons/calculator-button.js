// Minoshek built this with help from AI.

// Notenrechner: ein Panel für beides.
//   1. Probe-Noten: beliebig viele Noten dazudenken und sehen, wie sich Schnitt und Pluspunkte ändern
//      (früher der eigene Button "Eigene Noten ausprobieren").
//   2. Zielnote: welche Note braucht es in der nächsten Prüfung für den Wunsch-Schnitt?
// Beides hängt zusammen: die Zielnote rechnet die Probe-Noten mit ein.

(function () {
  'use strict';

  const CLOSE_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M13 1L1 13M1 1L13 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_SVG = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="20" height="20" rx="4" fill="#1976d2"/><rect x="7" y="7" width="14" height="4" rx="1.5" fill="#fff"/><rect x="7" y="13" width="4" height="4" rx="1.5" fill="#fff"/><rect x="12" y="13" width="4" height="4" rx="1.5" fill="#fff"/><rect x="17" y="13" width="4" height="4" rx="1.5" fill="#fff"/><rect x="7" y="18" width="4" height="4" rx="1.5" fill="#fff"/><rect x="12" y="18" width="4" height="4" rx="1.5" fill="#fff"/></svg>';

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // "5,25" und "5.25" sind beide erlaubt. Leer oder ungültig: null.
  function parseNumber(text) {
    const value = parseFloat(String(text).replace(',', '.'));
    return isFinite(value) ? value : null;
  }

  function numberInput(placeholder, label, value) {
    const input = h('input', 'pg-input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    if (value !== undefined && value !== null) input.value = value;
    return input;
  }

  function tone(points) {
    return points > 0 ? 'is-pos' : points < 0 ? 'is-neg' : 'is-zero';
  }

  class CalculatorButton {
    constructor(buttonManager) {
      this.buttonManager = buttonManager;
      this.buttonId = 'notenrechner-calc-btn';
      this.panelId = 'notenrechner-calc-panel';
      this.selected = null; // gewähltes Fach bleibt, solange die Seite offen ist
    }

    create() {
      const button = window.PanumDock.add({
        name: 'calculator',
        title: 'Notenrechner',
        color: '#1976d2',
        svg: ICON_SVG,
        width: 400,
        height: 560,
        open: (panel) => this.fillPanel(panel)
      });
      if (this.buttonManager) this.buttonManager.registerButton(this.buttonId, button, {});
    }

    fillPanel(panel) {
      const G = window.PanumGrades;
      panel.classList.add('pg');

      const head = h('div', 'pg-panel-head');
      head.appendChild(h('div', 'pg-panel-title', 'Notenrechner'));
      head.appendChild(h('div', 'pg-panel-sub', 'Zielnote berechnen und Probe-Noten ausprobieren'));
      const close = h('button', 'pg-panel-close');
      close.type = 'button';
      close.title = 'Schliessen';
      close.setAttribute('aria-label', 'Schliessen');
      close.innerHTML = CLOSE_SVG;
      close.addEventListener('click', () => window.PanumDock.close('calculator'));
      head.appendChild(close);
      panel.appendChild(head);

      const body = h('div', 'pg-panel-body');
      panel.appendChild(body);

      G.load().then((notenDaten) => {
        if (!panel.isConnected) return;
        if (!notenDaten.length) {
          body.appendChild(h('p', 'pg-muted', 'Keine Noten gefunden. Öffne die Seite «Aktuelle Noten» einmal vollständig.'));
          body.firstChild.style.marginTop = '16px';
          return;
        }
        this.fillBody(body, notenDaten);
      });
    }

    fillBody(body, notenDaten) {
      const G = window.PanumGrades;
      const P = window.PanumPluspoints;
      const nameOf = P ? P.labels(P.courseRows(document)) : G.shortName;

      const fresh = () => ({ note: null, gewicht: 1 });
      let extras = [fresh()];

      // --- Fach ---
      body.appendChild(h('div', 'pg-label', 'Fach'));
      const select = h('select', 'pg-input');
      select.id = 'calc-subject-select';
      select.setAttribute('aria-label', 'Fach auswählen');
      notenDaten.forEach((fach) => {
        const option = h('option', '', nameOf(fach.fach) + '  ·  Ø ' + fach.durchschnitt);
        option.value = fach.fach;
        select.appendChild(option);
      });
      if (this.selected && notenDaten.some((f) => f.fach === this.selected)) select.value = this.selected;
      body.appendChild(select);

      const info = h('div', 'pg-card');
      info.id = 'calc-info';
      info.style.marginTop = '8px';
      body.appendChild(info);

      // --- Probe-Noten ---
      body.appendChild(h('div', 'pg-label', 'Probe-Noten: was wäre, wenn …'));
      const fields = h('div');
      fields.id = 'calc-extra-fields';
      body.appendChild(fields);
      const addButton = h('button', 'pg-btn pg-btn-quiet', '+ Weitere Note');
      addButton.type = 'button';
      addButton.id = 'calc-extra-add';
      body.appendChild(addButton);
      const extraResult = h('div', 'pg-result');
      extraResult.id = 'calc-extra-result';
      body.appendChild(extraResult);

      // --- Zielnote ---
      body.appendChild(h('div', 'pg-label', 'Zielnote: was brauche ich in der nächsten Prüfung?'));
      const goalRow = h('div', 'pg-row');
      const goalInput = numberInput('Wunsch-Schnitt, z.B. 5.0', 'Wunsch-Schnitt');
      goalInput.id = 'calc-goal-input';
      const weightInput = numberInput('Gewichtung', 'Gewichtung der nächsten Prüfung', '1');
      weightInput.id = 'calc-weight-input';
      weightInput.classList.add('pg-input-small');
      weightInput.title = 'Gewichtung der nächsten Prüfung';
      goalRow.appendChild(goalInput);
      goalRow.appendChild(h('span', 'pg-muted', '×'));
      goalRow.appendChild(weightInput);
      body.appendChild(goalRow);
      const goalResult = h('div', 'pg-result');
      goalResult.id = 'calc-result';
      body.appendChild(goalResult);

      const current = () => notenDaten.find((f) => f.fach === select.value);

      const showInfo = () => {
        const fach = current();
        const points = G.punkteFuerNote(fach.durchschnitt);
        info.textContent = '';
        const facts = h('div', 'pg-facts');
        facts.style.marginTop = '0';
        const avg = h('span', '', 'Schnitt ');
        avg.appendChild(h('b', '', String(fach.durchschnitt)));
        const pts = h('span', '', 'Pluspunkte ');
        pts.appendChild(h('b', tone(points), G.formatPoints(points)));
        facts.appendChild(avg);
        facts.appendChild(pts);
        info.appendChild(facts);
        const list = fach.noten.map((note, i) => note + (fach.gewichtungen[i] === 1 ? '' : ' (×' + fach.gewichtungen[i] + ')')).join(', ');
        info.appendChild(h('div', 'pg-muted pg-grades', 'Noten: ' + list));
      };

      const calculate = () => {
        const fach = current();
        const all = G.withExtras(fach, extras);

        // Probe-Noten
        extraResult.textContent = '';
        extraResult.className = 'pg-result';
        if (all.added > 0) {
          const avg = G.average(all.noten, all.gewichtungen);
          const points = G.punkteFuerNote(parseFloat(avg.toFixed(2)));
          extraResult.classList.add(tone(points));
          extraResult.appendChild(h('span', 'pg-result-big', avg.toFixed(2)));
          extraResult.appendChild(h('span', '', 'neuer Schnitt · Pluspunkte '));
          extraResult.appendChild(h('b', tone(points), G.formatPoints(points)));
        }

        // Zielnote
        goalResult.textContent = '';
        goalResult.className = 'pg-result';
        if (goalInput.value.trim() === '') return;
        const result = G.requiredGrade(all.noten, all.gewichtungen, parseNumber(goalInput.value), parseNumber(weightInput.value));
        if (!result) {
          goalResult.classList.add('is-warn');
          goalResult.textContent = 'Bitte Wunsch-Schnitt und Gewichtung als Zahl eingeben.';
          return;
        }
        if (result.needed > 6) {
          goalResult.classList.add('is-neg');
          goalResult.appendChild(h('div', 'pg-strong', 'Mit einer Prüfung nicht erreichbar'));
          goalResult.appendChild(h('div', '', 'Nötig wäre eine ' + result.needed.toFixed(2) + '. Mit einer 6 kommst du auf ' + result.best.toFixed(2) + '.'));
        } else if (result.needed < 1) {
          goalResult.classList.add('is-pos');
          goalResult.appendChild(h('div', 'pg-strong', 'Schon sicher'));
          goalResult.appendChild(h('div', '', 'Selbst mit einer 1 bleibt dein Schnitt bei ' + result.worst.toFixed(2) + '.'));
        } else {
          goalResult.classList.add(result.needed <= 4.5 ? 'is-pos' : result.needed <= 5.5 ? 'is-zero' : 'is-warn');
          goalResult.appendChild(h('span', 'pg-result-big', result.needed.toFixed(2)));
          goalResult.appendChild(h('span', '', 'brauchst du in der nächsten Prüfung'));
        }
        if (all.added > 0) {
          goalResult.appendChild(h('div', 'pg-muted', all.added === 1 ? 'Deine Probe-Note ist eingerechnet.' : 'Deine ' + all.added + ' Probe-Noten sind eingerechnet.'));
        }
      };

      const drawFields = () => {
        fields.textContent = '';
        extras.forEach((extra, i) => {
          const row = h('div', 'pg-row');
          const note = numberInput('Note (1 bis 6)', 'Probe-Note ' + (i + 1), extra.note);
          const weight = numberInput('Gewichtung', 'Gewichtung der Probe-Note ' + (i + 1), extra.gewicht);
          weight.classList.add('pg-input-small');
          weight.title = 'Gewichtung';
          note.addEventListener('input', () => { extra.note = parseNumber(note.value); calculate(); });
          weight.addEventListener('input', () => { extra.gewicht = parseNumber(weight.value); calculate(); });
          const remove = h('button', 'pg-icon-btn', '×');
          remove.type = 'button';
          remove.title = 'Entfernen';
          remove.addEventListener('click', () => {
            extras.splice(i, 1);
            if (!extras.length) extras.push(fresh());
            drawFields();
            calculate();
          });
          row.appendChild(note);
          row.appendChild(h('span', 'pg-muted', '×'));
          row.appendChild(weight);
          row.appendChild(remove);
          fields.appendChild(row);
        });
      };

      addButton.addEventListener('click', () => {
        extras.push(fresh());
        drawFields();
        const inputs = fields.querySelectorAll('.pg-row:last-child input');
        if (inputs[0]) inputs[0].focus();
      });
      select.addEventListener('change', () => {
        this.selected = select.value;
        extras = [fresh()];
        drawFields();
        showInfo();
        calculate();
      });
      goalInput.addEventListener('input', calculate);
      weightInput.addEventListener('input', calculate);

      drawFields();
      showInfo();
      calculate();
    }
  }

  window.CalculatorButton = CalculatorButton;
})();
