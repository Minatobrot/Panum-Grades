// Buttons, deren Panel eine eigene Extension-Seite im iframe ist (Klassenkalender, Prüfungen).
// Button, Position, Ein/Aus und "nur ein Panel offen" übernimmt PanumDock (features/dock.js).
// Hier bleibt nur der iframe und der Nachrichtenweg zwischen Notenseite und Panel.

(function () {
  'use strict';

  const GRADES_PAGE_ID = '21311';
  const added = [];

  function extensionOrigin() {
    return browser.runtime.getURL('').replace(/\/$/, '');
  }

  function isGradesPage() {
    const params = new URLSearchParams(window.location.search);
    const output = (params.get('output') || '').toLowerCase();
    return params.get('pageid') === GRADES_PAGE_ID && output !== 'pdf' && output !== 'print';
  }

  function isDark() {
    return document.documentElement.classList.contains('panum-dark-theme');
  }

  function frameOf(entry) {
    const panel = document.getElementById(entry.panelId);
    return panel ? panel.querySelector('iframe') : null;
  }

  // options: name, title, color, svg, page, width, height, onMessage(data, reply)
  function addButton(options) {
    const entry = { name: options.name, panelId: options.name + '-overlay-panel', onMessage: options.onMessage };
    added.push(entry);

    window.PanumDock.add({
      name: options.name,
      title: options.title,
      color: options.color,
      svg: options.svg,
      width: options.width,
      height: options.height,
      open: (panel) => {
        const frame = document.createElement('iframe');
        frame.src = browser.runtime.getURL(options.page) + '?theme=' + (isDark() ? 'dark' : 'light');
        frame.title = options.title;
        frame.style.cssText = 'width: 100%; height: 100%; border: 0; display: block;';
        frame.addEventListener('load', () => {
          frame.contentWindow.postMessage({
            panum: 'init',
            dark: isDark(),
            student: window.PanumSchulnetzParse.parseStudent(document),
            // Pfadteil der Schule, z.B. "ausserschwyz" aus /ausserschwyz/index.php
            school: window.location.pathname.split('/')[1] || ''
          }, extensionOrigin());
        });
        panel.appendChild(frame);
      }
    });
  }

  function init() {
    window.addEventListener('message', (event) => {
      if (event.origin !== extensionOrigin() || !event.data) return;
      const entry = added.find((a) => {
        const frame = frameOf(a);
        return frame && frame.contentWindow === event.source;
      });
      if (!entry) return;

      if (event.data.panum === 'close') {
        window.PanumDock.close(entry.name);
      } else if (entry.onMessage) {
        entry.onMessage(event.data, (reply) => event.source.postMessage(reply, extensionOrigin()));
      }
    });

    // Theme-Schalter bei offenem Panel: das Panel wechselt mit
    new MutationObserver(() => {
      added.forEach((entry) => {
        const frame = frameOf(entry);
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ panum: 'theme', dark: isDark() }, extensionOrigin());
        }
      });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  window.PanumOverlay = { addButton };
  window.PanumOverlay.ready = new Promise((resolve) => {
    const start = () => {
      if (!isGradesPage()) return;
      init();
      resolve();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  });
})();
