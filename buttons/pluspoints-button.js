// Minoshek built this with help from AI.

// Pluspunkte-Button: das Panel im Aussehen von vor 3.1.0 (grüner Kopf, Tabelle mit Schaltern, Gesamtpunkte),
// eingehängt in die neue Leiste (PanumDock regelt Position, Ein/Aus und "nur ein Panel offen").
// Daneben gibt es die Pluspunkte direkt in der Notentabelle (features/pluspoints/inline.js).
// Beides ist einzeln schaltbar:
//   buttonEnabled_pluspoints   Button in der Leiste (Standard: an)
//   pluspointsInlineEnabled    Anzeige in der Tabelle (Standard: aus), Schalter im Panel und im Popup
// Beide Ansichten rechnen mit features/grades.js und teilen sich die Einstellungen (Fächer aus, Verbindungen).
//
// Das Tutorial erscheint erst, wenn das Panel zum ersten Mal geöffnet wird (im Panel, nicht vorher).
// Meldet sich selbst an (wie Klassenkalender und Prüfungen), content.js bleibt dafür unberührt.
// Farben im Dark Mode: themes/panum-ui.css, Abschnitt "Pluspunkte-Panel".

(function () {
  'use strict';

  const GRADES_PAGE_ID = '21311';
  const NAME = 'pluspoints';
  const INLINE_KEY = 'pluspointsInlineEnabled';
  const BUTTON_KEY = 'buttonEnabled_pluspoints';
  const TUTORIAL_KEY = 'panumTutorialSeen_pluspoints';
  const TUTORIAL_ID = 'panum-pp-tutorial';
  const CHANGED_EVENT = 'panum-pp-changed';

  const ICON_SVG = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="6" width="4" height="20" rx="2" fill="#388e3c"/><rect x="6" y="14" width="20" height="4" rx="2" fill="#388e3c"/></svg>';
  const CLOSE_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 1L1 13M1 1L13 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const storage = typeof browser !== 'undefined' && browser.storage ? browser.storage : null;

  let inlineOn = false;
  let tutorialSeen = true;  // bis der Speicher gelesen ist: nichts einblenden
  let settingsRead = false;
  let notenDaten = [];
  let openPanel = null;     // das offene Panel, sonst null

  function isGradesPage() {
    const params = new URLSearchParams(window.location.search);
    const output = (params.get('output') || '').toLowerCase();
    return params.get('pageid') === GRADES_PAGE_ID && output !== 'pdf' && output !== 'print';
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setInline(on) {
    inlineOn = !!on;
    if (storage) storage.local.set({ [INLINE_KEY]: inlineOn });
  }

  // Sagt der Tabelle und dem Panel, dass sich Fächer-Schalter oder Verbindungen geändert haben
  function announce() {
    document.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  }

  // Schalter wie im alten Panel (32 × 20 px)
  function switchHtml(id, checked, label) {
    return `<label style="display:inline-block;width:32px;height:20px;position:relative;cursor:pointer;flex:none;" title="${esc(label)}">
      <input type="checkbox" id="${esc(id)}" aria-label="${esc(label)}" style="opacity:0;width:0;height:0;"${checked ? ' checked' : ''}>
      <span class="pp-switch-track" style="position:absolute;top:0;left:0;right:0;bottom:0;background:${checked ? '#388e3c' : '#ccc'};border-radius:10px;transition:all 0.3s ease;"></span>
      <span class="pp-switch-knob" style="position:absolute;left:${checked ? '14px' : '2px'};top:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:all 0.3s ease;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></span>
    </label>`;
  }

  // ---------- Panel ----------

  function fillPanel(panel) {
    openPanel = panel;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Schliessen';
    closeBtn.setAttribute('aria-label', 'Schliessen');
    closeBtn.innerHTML = CLOSE_SVG;
    closeBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      background: rgba(255, 255, 255, 0.2);
      border: none;
      border-radius: 12px;
      width: 32px; height: 32px;
      cursor: pointer;
      z-index: 2;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    `;
    closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.35)'; closeBtn.style.transform = 'scale(1.05)'; };
    closeBtn.onmouseout = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.2)'; closeBtn.style.transform = 'scale(1)'; };
    closeBtn.onclick = () => window.PanumDock.close(NAME);

    const content = document.createElement('div');
    content.style.cssText = 'padding: 0; overflow-y: auto; flex: 1; display: flex; flex-direction: column;';
    content.innerHTML = `
      <div class="pp-head" style="background: linear-gradient(135deg, #388e3c, #2e7d32); color: white; padding: 20px 18px 16px 18px; margin: 0;">
        <div style="font-size: 20px; font-weight: bold; margin-bottom: 6px;">📊 Pluspunkte Übersicht</div>
        <div style="font-size: 14px; opacity: 0.9; padding-right: 40px;">Verwalte deine Fach-Sichtbarkeit und sieh deine Punkteverteilung. <span style="font-size:12px;font-style:italic;opacity:0.85;">Nur informativ, nicht verbindlich.</span></div>
      </div>
      <div style="padding: 18px; flex: 1;">
        <div style="background: #f8f9fa; border-radius: 8px; padding: 12px; margin-bottom: 16px; border: 1px solid #e9ecef;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 13px; font-weight: 600; color: #495057;">⚙️ Fächer ein-/ausblenden:</label>
            <button id="merge-btn" type="button" style="background: #388e3c; color: white; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; font-weight: 600;">🔗 Fächer verbinden</button>
          </div>
          <div id="pluspoints-inline-row" style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e9ecef;">
            <label for="pluspoints-inline-switch" style="font-size: 13px; font-weight: 600; color: #495057; cursor: pointer;">📋 Auch in der Notentabelle anzeigen</label>
            <span id="pluspoints-inline-wrap"></span>
          </div>
        </div>
        <div id="pluspoints-table-wrap"></div>
      </div>
    `;
    panel.appendChild(content);
    panel.appendChild(closeBtn);

    const mergeBtn = panel.querySelector('#merge-btn');
    mergeBtn.onclick = () => {
      if (window.PanumPluspoints) window.PanumPluspoints.openDialog();
    };

    draw();
    showTutorial();

    window.PanumGrades.load().then((list) => {
      notenDaten = list;
      draw();
    });
  }

  // Zeilen wie im alten Panel: Verbindungen und einzelne Fächer, sortiert nach plus, null, minus, dann nach Name
  function tableItems(state, merged) {
    const G = window.PanumGrades;
    const items = [];
    state.groups.forEach((group, index) => {
      if (group.points === null) return;
      items.push({ type: 'merged', key: group.key, name: group.name, subText: G.groupText(merged[index]), avg: group.avg, points: group.points, isHidden: group.hidden, switchId: 'pluspoints-switch-merged-' + index });
    });
    notenDaten.forEach((fach) => {
      const info = state.subjects[fach.fach];
      if (!info || info.group !== null || info.points === null) return;
      items.push({ type: 'single', key: fach.fach, name: fach.fach, subText: null, avg: info.avg, points: info.points, isHidden: info.hidden, switchId: 'pluspoints-switch-' + encodeURIComponent(fach.fach) });
    });
    const rank = (item) => (item.points > 0 ? 0 : item.points === 0 ? 1 : 2);
    return items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  function drawInlineSwitch(panel) {
    const wrap = panel.querySelector('#pluspoints-inline-wrap');
    if (!wrap) return;
    wrap.innerHTML = switchHtml('pluspoints-inline-switch', inlineOn, 'Pluspunkte in der Notentabelle anzeigen');
    const input = wrap.querySelector('input');
    input.addEventListener('change', () => {
      setInline(input.checked);
      drawInlineSwitch(panel);
    });
  }

  function draw() {
    const panel = openPanel;
    if (!panel || !panel.isConnected) return;
    const wrap = panel.querySelector('#pluspoints-table-wrap');
    if (!wrap) return;
    const G = window.PanumGrades;

    drawInlineSwitch(panel);

    if (!notenDaten.length) {
      wrap.innerHTML = '<div style="text-align:center;color:#6c757d;font-size:13px;padding:24px 12px;">Keine Noten gefunden. Öffne die Seite «Aktuelle Noten» einmal vollständig.</div>';
      return;
    }

    const merged = G.loadMerged();
    const state = G.pluspoints(notenDaten, merged, G.loadHidden());
    const items = tableItems(state, merged);

    let html = `
      <div style="background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden; border: 1px solid #e9ecef;">
        <table id="pluspoints-table" style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background: linear-gradient(135deg, #f8f9fa, #e9ecef);">
              <th style="text-align:center;padding:12px 8px;width:40px;font-weight:600;color:#495057;user-select:none;">📋</th>
              <th style="text-align:left;padding:12px 8px;font-weight:600;color:#495057;">Fach</th>
              <th style="text-align:right;padding:12px 8px;font-weight:600;color:#495057;">Schnitt</th>
              <th style="text-align:right;padding:12px 8px;font-weight:600;color:#495057;">Punkte</th>
            </tr>
          </thead>
          <tbody>
    `;

    items.forEach((item) => {
      const checked = !item.isHidden;
      const sw = switchHtml(item.switchId, checked, item.name + ' für die Pluspunkte mitzählen');
      const displayName = item.type === 'merged' ? '🔗 ' + esc(item.name) : esc(item.name.replace(/ /g, '\n'));
      let rowStyle = 'background: #f0f9ff;';
      let fachCell;
      let schnittCell;
      let pointsCell;

      if (!checked) {
        fachCell = `<td style="padding:10px 8px;color:#aaa;text-decoration:line-through;white-space:pre-line;border-bottom:1px solid #f1f3f4;">${displayName}</td>`;
        schnittCell = '<td style="text-align:right;padding:10px 8px;color:#aaa;text-decoration:line-through;border-bottom:1px solid #f1f3f4;">-</td>';
        pointsCell = '<td class="pp-points" style="text-align:right;padding:10px 8px;color:#aaa;border-bottom:1px solid #f1f3f4;">-</td>';
        rowStyle = 'background:#f8f9fa;';
      } else {
        const subText = item.type === 'merged' ? `<div class="pp-sub" style="font-size:11px;color:#6c757d;">${esc(item.subText)}</div>` : '';
        const isNegative = item.points < 0;
        const isPositive = item.points > 0;
        const pointColor = isNegative ? '#dc3545' : (isPositive ? '#28a745' : '#6c757d');

        if (isNegative) {
          fachCell = `<td style="padding:10px 8px;color:#dc3545;font-weight:600;white-space:pre-line;border-bottom:1px solid #f1f3f4;">${displayName}${subText}</td>`;
        } else {
          const nameColor = item.type === 'merged' ? '#1976d2' : '#495057';
          const weight = item.type === 'merged' ? '600' : '400';
          fachCell = `<td style="padding:10px 8px;white-space:pre-line;border-bottom:1px solid #f1f3f4;color:${nameColor};font-weight:${weight};">${displayName}${subText}</td>`;
        }
        schnittCell = `<td style="text-align:right;padding:10px 8px;border-bottom:1px solid #f1f3f4;color:#495057;font-weight:500;">${item.avg.toFixed(2)}</td>`;
        pointsCell = `<td class="pp-points" style="text-align:right;padding:10px 8px;color:${pointColor};font-weight:600;border-bottom:1px solid #f1f3f4;">${G.formatPoints(item.points)}</td>`;
      }

      html += `<tr data-key="${esc(item.key)}"${checked ? '' : ' class="is-off"'} style="${rowStyle}">
        <td style="text-align:center;padding:10px 8px;border-bottom:1px solid #f1f3f4;">${sw}</td>
        ${fachCell}${schnittCell}${pointsCell}
      </tr>`;
    });

    const total = state.total;
    const totalColor = total < 0 ? '#dc3545' : '#28a745';
    html += `
          </tbody>
          <tfoot style="background: linear-gradient(135deg, #f8f9fa, #e9ecef);">
            <tr style="font-weight:700;background:rgba(${total < 0 ? '220,53,69' : '40,167,69'},0.1);">
              <td style="padding:10px 8px;"></td>
              <td style="padding:10px 8px;color:#495057;">🎯 Gesamtpunkte</td>
              <td style="padding:10px 8px;"></td>
              <td id="pluspoints-total" style="text-align:right;padding:10px 8px;color:${totalColor};font-size:16px;">${total}</td>
            </tr>
            <tr style="font-weight:600;">
              <td style="padding:10px 8px;"></td>
              <td style="padding:10px 8px;color:#495057;">📊 Durchschnitt</td>
              <td id="pluspoints-average" style="text-align:right;padding:10px 8px;color:#388e3c;font-weight:700;font-size:15px;">${state.average === null ? '-' : state.average.toFixed(2)}</td>
              <td style="padding:10px 8px;"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
    wrap.innerHTML = html;

    items.forEach((item) => {
      const input = Array.from(wrap.querySelectorAll('input')).find((node) => node.id === item.switchId);
      if (!input) return;
      input.addEventListener('change', () => {
        const hidden = G.loadHidden().filter((key) => key !== item.key);
        if (!input.checked) hidden.push(item.key);
        G.saveHidden(hidden);
        announce();
      });
    });
  }

  // ---------- Tutorial: erscheint beim ersten Öffnen des Panels, im Panel ----------

  function finishTutorial() {
    tutorialSeen = true;
    if (storage) storage.local.set({ [TUTORIAL_KEY]: true });
    const card = document.getElementById(TUTORIAL_ID);
    if (card) card.remove();
  }

  function showTutorial() {
    const panel = openPanel;
    if (!panel || !panel.isConnected || !settingsRead || tutorialSeen || panel.querySelector('#' + TUTORIAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = TUTORIAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Tipp zu den Pluspunkten');
    overlay.style.cssText = 'position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, 0.45); border-radius: 12px;';
    // Kopf und Tipp-Kasten wie im Achievements-Panel
    overlay.innerHTML = `
      <div class="pp-tutorial-card" style="width: 100%; max-width: 340px; background: #fff; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.25); overflow: hidden;">
        <div class="pp-tutorial-head" style="background: linear-gradient(135deg, #ffb300, #ffa000); color: white; padding: 16px 18px 12px 18px;">
          <div style="font-size: 18px; font-weight: bold; margin-bottom: 4px;">💡 Pluspunkte: Button oder Tabelle?</div>
          <div style="font-size: 13px; opacity: 0.9;">Kurz erklärt, dann bist du fertig</div>
        </div>
        <div style="padding: 16px 18px 18px 18px;">
          <div style="font-size: 13px; color: #495057; line-height: 1.5; margin-bottom: 10px;">Hier im Button findest du alle Fächer mit Schnitt und Pluspunkten.</div>
          <div style="font-size: 13px; color: #495057; line-height: 1.5; margin-bottom: 12px;">Lieber wie zuletzt direkt in der Notentabelle? Ein Klick, und die Anzeige in der Tabelle ist wieder da.</div>
          <div class="pp-tutorial-tip" style="font-size: 12px; color: #888; margin-bottom: 14px; padding: 8px; background: #fff8e1; border-radius: 6px; border-left: 3px solid #ffb300;">
            💡 <strong>Tipp:</strong> Du kannst die Anzeige in der Tabelle jederzeit hier im Pluspunkte-Button wieder ausschalten (Schalter «Auch in der Notentabelle anzeigen»).
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" id="panum-pp-tutorial-inline" style="flex: 1; background: #ffb300; color: white; border: 1px solid #ffb300; border-radius: 15px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer;">In der Tabelle anzeigen</button>
            <button type="button" id="panum-pp-tutorial-keep" style="flex: 1; background: white; color: #ffb300; border: 1px solid #ffb300; border-radius: 15px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer;">Nur Button</button>
          </div>
        </div>
      </div>
    `;
    panel.appendChild(overlay);

    overlay.querySelector('#panum-pp-tutorial-inline').onclick = () => {
      setInline(true);
      finishTutorial();
      draw();
    };
    overlay.querySelector('#panum-pp-tutorial-keep').onclick = finishTutorial;
  }

  // ---------- Start ----------

  function start() {
    if (!isGradesPage() || !window.PanumDock || !window.PanumGrades) return;

    window.PanumDock.add({
      name: NAME,
      title: 'Pluspunkte-Übersicht',
      color: '#388e3c',
      svg: ICON_SVG,
      width: 420,
      height: 660,
      open: fillPanel,
      close: () => { openPanel = null; }
    });

    document.addEventListener(CHANGED_EVENT, draw);

    if (!storage) return;
    storage.local.get([INLINE_KEY, TUTORIAL_KEY, 'notenDaten']).then((result) => {
      inlineOn = result[INLINE_KEY] === true;
      tutorialSeen = !!result[TUTORIAL_KEY];
      settingsRead = true;
      if (Array.isArray(result.notenDaten)) notenDaten = result.notenDaten;
      draw();
      showTutorial(); // falls das Panel schon offen ist, bevor der Speicher gelesen war
    }, () => {});

    storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[INLINE_KEY]) inlineOn = changes[INLINE_KEY].newValue === true;
      if (changes[TUTORIAL_KEY]) tutorialSeen = !!changes[TUTORIAL_KEY].newValue;
      if (changes.notenDaten && Array.isArray(changes.notenDaten.newValue)) notenDaten = changes.notenDaten.newValue;
      if (changes[INLINE_KEY] || changes.notenDaten) draw();
    });
  }

  window.PanumPluspointsButton = { INLINE_KEY, BUTTON_KEY, TUTORIAL_KEY, CHANGED_EVENT };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
