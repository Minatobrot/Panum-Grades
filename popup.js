// Minoshek built this with help from AI.

document.addEventListener("DOMContentLoaded", function() {
  const storage = browser.storage.local;
  const Layout = window.PanumDockLayout;
  const darkThemeSetting = {
    id: 'switch-dark-theme',
    storageKey: 'themeEnabled_dark',
    default: true
  };

  // Ein Schalter pro Eintrag. Die Buttons der Leiste kommen aus features/dock-layout.js (REGISTRY):
  // ein neuer Button braucht hier nichts ausser seinem Schalter "switch-<name>" in popup.html.
  // Pluspunkte gibt es zweimal, einzeln schaltbar: als Button (REGISTRY) und in der Notentabelle (Standard: aus).
  const switchSettings = {
    pluspointsInline: { id: 'switch-pluspoints-inline', storageKey: 'pluspointsInlineEnabled', default: false }
  };
  Layout.REGISTRY.forEach((def) => {
    switchSettings[def.name] = { id: 'switch-' + def.name, storageKey: def.storageKey, buttonId: def.buttonId };
  });

  let savedLayout = null;

  function sendToTab(message) {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) {
        browser.tabs.sendMessage(tabs[0].id, message).catch(() => {
          // Kein Schulnetz-Tab offen: die Einstellung ist gespeichert und gilt beim nächsten Laden
        });
      }
    });
  }

  function showState(switchElement) {
    const row = switchElement.closest('.button-setting');
    if (row) row.classList.toggle('is-off', !switchElement.checked);
  }

  function applyPopupTheme(isDark) {
    document.documentElement.classList.toggle('dark', isDark);
  }

  function loadSettings() {
    const keys = Object.values(switchSettings).map((setting) => setting.storageKey);
    keys.push(darkThemeSetting.storageKey, Layout.LAYOUT_KEY, TIPS_KEY);

    storage.get(keys).then((result) => {
      Object.values(switchSettings).forEach((setting) => {
        const switchElement = document.getElementById(setting.id);
        if (!switchElement) return;
        switchElement.checked = setting.default === false
          ? result[setting.storageKey] === true
          : result[setting.storageKey] !== false;
        showState(switchElement);
      });

      const darkThemeSwitch = document.getElementById(darkThemeSetting.id);
      const isDark = result[darkThemeSetting.storageKey] !== undefined
        ? !!result[darkThemeSetting.storageKey]
        : darkThemeSetting.default;
      if (darkThemeSwitch) darkThemeSwitch.checked = isDark;
      applyPopupTheme(isDark);

      savedLayout = result[Layout.LAYOUT_KEY] || null;
      renderLayout();
      maybeShowTip(result[TIPS_KEY]);
    });
  }

  // ---------- Tipps ----------
  // Niemand soll beim Installieren alles auf einmal lesen müssen. Darum: beim ersten Öffnen nichts,
  // danach zufällig bei etwa jedem zweiten Öffnen genau ein Tipp, jeder nur einmal.
  // Gespeichert unter panumPopupTips: { opens: Anzahl Öffnungen, seen: [id, ...] }.

  const TIPS_KEY = 'panumPopupTips';
  const TIP_CHANCE = 0.5;
  const TIPS = [
    { id: 'pluspoints', target: 'switch-pluspoints', title: 'Pluspunkte: Button oder Tabelle',
      text: 'Die Pluspunkte gibt es als Button und direkt in der Notentabelle. Beides schaltest du einzeln: beides, nur eines oder keines.' },
    { id: 'pluspoints-inline', target: 'switch-pluspoints-inline', title: 'Pluspunkte in der Tabelle',
      text: 'Mit diesem Schalter stehen die Punkte direkt neben jedem Fach, mit Summe und Schnitt über der Tabelle.' },
    { id: 'dark', target: 'switch-dark-theme', title: 'Dark Mode',
      text: 'Schulnetz in dunkel. Umschalten geht hier oder über den Mond oben rechts auf der Seite.' },
    { id: 'buttons', target: 'switch-calculator', title: 'Buttons ein- und ausschalten',
      text: 'Jeden Button auf der Notenseite kannst du hier ausschalten. Die übrigen rücken nach, es bleibt keine Lücke.' },
    { id: 'calculator', target: 'switch-calculator', title: 'Notenrechner',
      text: 'Er sagt dir, welche Note du für deinen Wunsch-Schnitt brauchst, und rechnet Probe-Noten mit ein.' },
    { id: 'improvement', target: 'switch-improvement', title: 'Verbesserungen',
      text: 'Zeigt, in welchen Fächern dir wenig zur nächsten halben Note fehlt und wo es knapp wird.' },
    { id: 'achievements', target: 'switch-achievements', title: 'Achievements',
      text: 'Erfolge für deine Noten. Wenn dich die Meldungen stören, schalte sie hier aus.' },
    { id: 'classcalendar', target: 'switch-classcalendar', title: 'Klassenkalender',
      text: 'Hausaufgaben und Prüfungen, geteilt mit deiner Klasse. Mit QR-Code auch auf dem Handy.' },
    { id: 'exams', target: 'switch-exams', title: 'Prüfungen',
      text: 'Holt deine anstehenden Prüfungen aus dem Schulnetz. Ein Klick übernimmt sie in den Klassenkalender.' },
    { id: 'layout', target: 'layout', title: 'Buttons anordnen',
      text: 'Unter «Anordnung» legst du fest, welche Buttons unten in der Reihe und welche rechts in der Spalte stehen.' },
    { id: 'bug', target: 'bugReportBtn', title: 'Bug melden',
      text: 'Etwas funktioniert nicht? Über «Bug melden» ganz unten kommt deine Meldung direkt an.' }
  ];

  function maybeShowTip(saved) {
    const state = {
      opens: saved && typeof saved.opens === 'number' ? saved.opens : 0,
      seen: saved && Array.isArray(saved.seen) ? saved.seen.slice() : []
    };
    const firstOpen = state.opens === 0;
    state.opens += 1;

    const card = document.getElementById('tip-card');
    const open = TIPS.filter((tip) => !state.seen.includes(tip.id) && document.getElementById(tip.target));
    if (!card || firstOpen || !open.length || Math.random() >= TIP_CHANCE) {
      storage.set({ [TIPS_KEY]: state });
      return;
    }

    const tip = open[Math.floor(Math.random() * open.length)];
    // Schon beim Anzeigen als gesehen gemerkt: wer das Popup einfach schliesst, bekommt ihn nicht nochmals
    state.seen.push(tip.id);
    storage.set({ [TIPS_KEY]: state });

    const target = document.getElementById(tip.target);
    const marked = target.closest('.button-setting') || target;
    document.getElementById('tip-title').textContent = '💡 ' + tip.title;
    document.getElementById('tip-text').textContent = tip.text;
    document.getElementById('tip-count').textContent = 'Tipp ' + state.seen.length + ' von ' + TIPS.length;
    card.hidden = false;
    marked.classList.add('tip-target');
    document.getElementById('tip-ok').addEventListener('click', () => {
      card.hidden = true;
      marked.classList.remove('tip-target');
    }, { once: true });
  }

  Object.values(switchSettings).forEach((setting) => {
    const switchElement = document.getElementById(setting.id);
    if (!switchElement) return;

    switchElement.addEventListener('change', function() {
      // Der Speicher ist die Quelle: die Notenseite hört auf Änderungen und rückt die Buttons selbst nach.
      storage.set({ [setting.storageKey]: this.checked });
      showState(this);
      if (setting.buttonId) {
        sendToTab({ action: 'toggleButton', buttonId: setting.buttonId, enabled: this.checked });
      }
    });
  });

  const darkThemeSwitch = document.getElementById(darkThemeSetting.id);
  if (darkThemeSwitch) {
    darkThemeSwitch.addEventListener('change', function() {
      storage.set({ [darkThemeSetting.storageKey]: this.checked });
      applyPopupTheme(this.checked);
      sendToTab({ action: 'toggleTheme', enabled: this.checked });
    });
  }

  // ---------- Anordnung ----------

  const ZONES = [
    { zone: 'row', title: 'Untere Reihe (von der Ecke nach links)', other: 'column', move: 'in die Spalte' },
    { zone: 'column', title: 'Rechte Spalte (von unten nach oben)', other: 'row', move: 'in die Reihe' }
  ];

  function saveLayout(defs) {
    savedLayout = { order: defs.map((def) => def.name), zones: {} };
    defs.forEach((def) => { savedLayout.zones[def.name] = def.zone; });
    storage.set({ [Layout.LAYOUT_KEY]: savedLayout });
    renderLayout();
  }

  function miniButton(text, title, disabled, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-btn';
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  function renderLayout() {
    const list = document.getElementById('layout-list');
    if (!list) return;
    list.textContent = '';
    const defs = Layout.applyUserLayout(Layout.REGISTRY, savedLayout);

    ZONES.forEach((group) => {
      const title = document.createElement('div');
      title.className = 'layout-zone-title';
      title.textContent = group.title;
      list.appendChild(title);

      const members = defs.filter((def) => def.zone === group.zone);
      if (!members.length) {
        const empty = document.createElement('div');
        empty.className = 'layout-empty';
        empty.textContent = 'leer';
        list.appendChild(empty);
      }

      members.forEach((def, i) => {
        const row = document.createElement('div');
        row.className = 'layout-row';
        const label = document.createElement('span');
        label.textContent = (i + 1) + '. ' + def.label;
        row.appendChild(label);

        // Tauscht den Platz mit dem Nachbarn in derselben Reihe bzw. Spalte
        const swap = (other) => {
          const next = defs.slice();
          const a = next.indexOf(def);
          const b = next.indexOf(other);
          next[a] = other;
          next[b] = def;
          saveLayout(next);
        };
        row.appendChild(miniButton('▲', def.label + ' einen Platz nach vorne', i === 0, () => swap(members[i - 1])));
        row.appendChild(miniButton('▼', def.label + ' einen Platz nach hinten', i === members.length - 1, () => swap(members[i + 1])));
        row.appendChild(miniButton(group.move, def.label + ' ' + group.move + ' verschieben', false, () => {
          // ans Ende der anderen Gruppe
          const next = defs.filter((d) => d !== def);
          next.push(Object.assign({}, def, { zone: group.other }));
          saveLayout(next);
        }));
        list.appendChild(row);
      });
    });
  }

  const layoutReset = document.getElementById('layout-reset');
  if (layoutReset) {
    layoutReset.addEventListener('click', () => {
      savedLayout = null;
      storage.remove(Layout.LAYOUT_KEY);
      renderLayout();
    });
  }

  const versionElement = document.getElementById('version');
  if (versionElement) versionElement.textContent = 'v' + browser.runtime.getManifest().version;

  loadSettings();

  initBugReport();
});

function initBugReport() {
  const bugReportBtn = document.getElementById('bugReportBtn');
  const modal = document.getElementById('bugReportModal');
  const closeBtn = document.getElementById('closeModal');
  const form = document.getElementById('bugReportForm');
  const submitBtn = document.getElementById('submitBtn');
  const successMessage = document.getElementById('successMessage');
  const errorMessage = document.getElementById('errorMessage');

  const browserInput = document.getElementById('userBrowser');
  browserInput.value = navigator.userAgent;

  bugReportBtn.addEventListener('click', () => {
    modal.classList.add('show');
    document.getElementById('bugTitle').focus();
  });

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeModal();
    }
  });

  function closeModal() {
    modal.classList.remove('show');
    successMessage.style.display = 'none';
    errorMessage.style.display = 'none';
    form.reset();
    browserInput.value = navigator.userAgent;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Bug Report senden';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird gesendet...';
    
    const formData = new FormData(form);
    const bugData = {
      title: formData.get('bugTitle'),
      type: formData.get('bugType'),
      description: formData.get('bugDescription'),
      steps: formData.get('bugSteps'),
      browser: formData.get('userBrowser'),
      email: formData.get('userEmail'),
      timestamp: new Date().toISOString(),
      extensionVersion: browser.runtime.getManifest().version
    };

    try {
      await submitBugReport(bugData);
      successMessage.style.display = 'block';
      errorMessage.style.display = 'none';
      form.style.display = 'none';
      
      setTimeout(() => {
        closeModal();
        form.style.display = 'block';
      }, 3000);
      
    } catch (error) {
      console.error('Error submitting bug report:', error);
      errorMessage.style.display = 'block';
      successMessage.style.display = 'none';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Bug Report senden';
    }
  });
}

async function submitBugReport(bugData) {
  const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeM0woz7Ev2fJ8eL5Kh6sdq8aauF6A7YAn_eA9aBu-lNRX_xg/formResponse';

  const userAgent = bugData.browser;
  let browserName = 'Unknown';
  let browserVersion = 'Unknown';
  
  if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
    browserName = 'Opera';
    const match = userAgent.match(/OPR\/([0-9.]+)/);
    if (match) browserVersion = match[1];
  } else if (userAgent.includes('Edg')) {
    browserName = 'Microsoft Edge';
    const match = userAgent.match(/Edg\/([0-9.]+)/);
    if (match) browserVersion = match[1];
  } else if (userAgent.includes('Chrome')) {
    browserName = 'Google Chrome';
    const match = userAgent.match(/Chrome\/([0-9.]+)/);
    if (match) browserVersion = match[1];
  } else if (userAgent.includes('Firefox')) {
    browserName = 'Mozilla Firefox';
    const match = userAgent.match(/Firefox\/([0-9.]+)/);
    if (match) browserVersion = match[1];
  } else if (userAgent.includes('Safari')) {
    browserName = 'Safari';
    const match = userAgent.match(/Version\/([0-9.]+)/);
    if (match) browserVersion = match[1];
  }
  
  const formattedBrowserInfo = browserName + ' ' + browserVersion + '\nBetriebssystem: ' + navigator.platform;
  
  const formData = new FormData();
  
  formData.append('entry.1060870630', bugData.title);                    // Problem Title
  formData.append('entry.1934190602', bugData.type);                     // Problem Type (radio button)
  formData.append('entry.1140599693', bugData.description);              // Detailed Description  
  formData.append('entry.1472756735', bugData.steps || 'Not provided');  // Steps to Reproduce
  formData.append('entry.1508442479', bugData.email || '');              // Email (optional)
  formData.append('entry.1658493229', formattedBrowserInfo + '\n\nExtension: Panum Grades v' + bugData.extensionVersion + '\nTimestamp: ' + new Date().toLocaleString('de-DE')); // Browser info with additional details

  console.log('Submitting bug report with data:', bugData);
  console.log('Form URL:', FORM_URL);
  console.log('Browser detected:', browserName, browserVersion);

  try {
    const response = await fetch(FORM_URL, {
      method: 'POST',
      mode: 'no-cors', // Required for Google Forms
      body: formData
    });

    console.log('Form submission completed');
    return Promise.resolve();
  } catch (error) {
    console.error('Error during form submission:', error);
    throw error;
  }
}