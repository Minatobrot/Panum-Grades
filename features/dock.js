// Schwebende Buttons auf der Notenseite: erzeugt sie, stellt sie auf, schaltet sie ein und aus
// und sorgt dafür, dass immer nur ein Panel offen ist.
// Wo ein Button steht, entscheidet allein features/dock-layout.js. Hier gibt es keine festen Positionen.

(function () {
  'use strict';

  const L = window.PanumDockLayout;
  const entries = new Map(); // name -> { def, options, button }
  const extraDefs = [];      // Buttons, die nicht in REGISTRY stehen: ans Ende der Reihe
  let settings = null;       // bleibt null, bis der Speicher gelesen ist (kein Aufblitzen ausgeschalteter Buttons)
  let userLayout = null;

  const storage = typeof browser !== 'undefined' && browser.storage ? browser.storage : null;

  function allDefs() {
    return L.REGISTRY.concat(extraDefs);
  }

  function definitionFor(name) {
    let def = allDefs().find((d) => d.name === name);
    if (!def) {
      def = { name: name, zone: 'row', label: name, buttonId: name + '-overlay-btn', storageKey: 'buttonEnabled_' + name };
      extraDefs.push(def);
    }
    return def;
  }

  function panelIdFor(def) {
    return def.panelId || def.buttonId.replace(/-btn$/, '-panel');
  }

  function isEnabled(def) {
    return !def.storageKey || !settings || settings[def.storageKey] !== false;
  }

  // Einige ältere Teile (Achievement-Toasts) lesen Ein/Aus aus dem localStorage der Seite
  function mirror(def) {
    if (!def.storageKey) return;
    try {
      localStorage.setItem(def.storageKey, String(isEnabled(def)));
    } catch (error) {
      // localStorage gesperrt: nicht schlimm
    }
  }

  function relayout() {
    if (!settings || !document.body) return;

    const items = L.applyUserLayout(allDefs(), userLayout).map((def) => ({
      name: def.name,
      zone: def.zone,
      visible: entries.has(def.name) && isEnabled(def)
    }));
    const layout = L.computeLayout(items, { width: window.innerWidth, height: window.innerHeight });

    entries.forEach((entry, name) => {
      const position = layout.positions[name];
      const button = entry.button;
      if (!position) {
        button.style.display = 'none';
        close(name);
        return;
      }
      button.style.right = position.right + 'px';
      button.style.bottom = position.bottom + 'px';
      button.style.display = '';
      if (!button.isConnected) document.body.appendChild(button);
    });

    const root = document.documentElement;
    root.style.setProperty('--panum-dock-right', layout.inset.right + 'px');
    root.style.setProperty('--panum-dock-bottom', layout.inset.bottom + 'px');
  }

  function isOpen(name) {
    const entry = entries.get(name);
    return !!entry && !!document.getElementById(panelIdFor(entry.def));
  }

  function close(name) {
    const entry = entries.get(name);
    if (!entry) return;
    const panel = document.getElementById(panelIdFor(entry.def));
    if (panel) {
      panel.remove();
      if (entry.options.close) entry.options.close();
    }
    entry.button.classList.remove('is-open');
    entry.button.setAttribute('aria-expanded', 'false');
  }

  function closeAll() {
    entries.forEach((entry, name) => close(name));
  }

  function open(name) {
    const entry = entries.get(name);
    if (!entry || !entry.options.open) return;
    closeAll();

    const panel = document.createElement('div');
    panel.id = panelIdFor(entry.def);
    panel.className = 'panum-dock-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', entry.options.title || entry.def.label);
    panel.style.setProperty('--panum-panel-width', (entry.options.width || 420) + 'px');
    panel.style.setProperty('--panum-panel-height', (entry.options.height || 480) + 'px');
    document.body.appendChild(panel);

    entry.button.classList.add('is-open');
    entry.button.setAttribute('aria-expanded', 'true');
    entry.options.open(panel);
  }

  function toggle(name) {
    const entry = entries.get(name);
    if (!entry) return;
    if (entry.options.onClick) {
      entry.options.onClick();
    } else if (isOpen(name)) {
      close(name);
    } else {
      open(name);
    }
  }

  // options: name, title, color, svg, und entweder
  //   open(panel) [+ close(), width, height]  für einen Button mit Panel, oder
  //   onClick()                               für einen Button ohne Panel.
  function add(options) {
    const existing = entries.get(options.name);
    if (existing) return existing.button;

    const def = definitionFor(options.name);
    const button = document.createElement('button');
    button.type = 'button';
    button.id = def.buttonId;
    button.className = 'panum-dock-btn';
    button.title = options.title || def.label;
    button.setAttribute('aria-label', button.title);
    if (options.open) button.setAttribute('aria-expanded', 'false');
    if (options.color) button.style.setProperty('--panum-accent', options.color);
    button.style.display = 'none';
    button.innerHTML = options.svg || '';
    button.addEventListener('click', () => toggle(options.name));

    entries.set(options.name, { def: def, options: options, button: button });
    relayout();
    return button;
  }

  // Für die Nachricht aus dem Popup (content.js). Der Speicher bleibt die Quelle, das hier ist nur schneller.
  function setEnabledByButtonId(buttonId, enabled) {
    const def = allDefs().find((d) => d.buttonId === buttonId);
    if (!def || !def.storageKey || !settings) return false;
    settings[def.storageKey] = !!enabled;
    mirror(def);
    relayout();
    return true;
  }

  function applySettings(result) {
    settings = result || {};
    userLayout = settings[L.LAYOUT_KEY] || null;
    allDefs().forEach(mirror);
    relayout();
  }

  function start() {
    const keys = L.REGISTRY.map((def) => def.storageKey).filter(Boolean).concat([L.LAYOUT_KEY]);

    if (!storage) {
      applySettings({});
    } else {
      storage.local.get(keys).then(applySettings, () => applySettings({}));
      storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !settings) return;
        Object.keys(changes).forEach((key) => { settings[key] = changes[key].newValue; });
        userLayout = settings[L.LAYOUT_KEY] || null;
        allDefs().forEach(mirror);
        relayout();
      });
    }

    window.addEventListener('resize', relayout);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAll();
    });
  }

  window.PanumDock = { add, open, close, closeAll, toggle, isOpen, relayout, setEnabledByButtonId };
  start();
})();
