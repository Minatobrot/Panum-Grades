// Einführung in einem Panel. Sie muss einmal ganz durchlaufen werden (kein Überspringen); wer das Panel
// vorher schliesst, sieht sie beim nächsten Öffnen wieder von vorn.
// Ob sie fertig ist, steht im Kalender-Speicher (IndexedDB) und übersteht damit auch resetAllData().

(function () {
  'use strict';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // steps: [{
  //   title, text,
  //   points: ['…'],              Aufzählung unter dem Text
  //   warn: true,                 hervorgehobene Karte für das, was man wissen muss
  //   confirm: 'Ich habe …',      Häkchen, ohne das es nicht weitergeht
  //   target: '#css',             Element, das hervorgehoben wird (ohne target: Karte in der Mitte, Rest abgedunkelt)
  //   mustClick: true,            weiter geht es nur mit einem Klick auf das Ziel
  //   until: () => bool,          weiter geht es von selbst, sobald das zutrifft
  //   waitText: '…',              Hinweis statt Weiter-Knopf bei mustClick/until
  //   place: 'top',               Karte oben statt unten
  //   onlyIf: () => bool          Schritt auslassen, wenn das nicht zutrifft
  // }]
  // Liefert ein Promise, das erfüllt ist, sobald die Einführung durch ist (oder früher schon durch war).
  function start(key, steps) {
    const db = window.PanumCalendarDb;
    const metaKey = 'tour_' + key;

    return db.getMeta(metaKey).catch(() => true).then((seen) => {
      if (seen) return undefined;

      return new Promise((resolve) => {
        let index = -1;
        let marked = null;
        let polling = null;

        const backdrop = el('div', 'tour-backdrop');
        const card = el('div', 'tour');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        const dots = el('div', 'tour-dots');
        steps.forEach(() => dots.appendChild(el('span', 'tour-dot')));
        const title = el('div', 'tour-title');
        const text = el('div', 'tour-text');
        const points = el('ul', 'tour-points');
        const confirm = el('label', 'tour-confirm');
        const confirmBox = document.createElement('input');
        confirmBox.type = 'checkbox';
        const confirmText = el('span');
        confirm.appendChild(confirmBox);
        confirm.appendChild(confirmText);
        const actions = el('div', 'tour-actions');
        const hint = el('span', 'tour-wait');
        const next = el('button', 'btn primary');
        next.type = 'button';
        actions.appendChild(hint);
        actions.appendChild(next);
        [dots, title, text, points, confirm, actions].forEach((node) => card.appendChild(node));

        function unmark() {
          clearInterval(polling);
          if (marked) {
            marked.classList.remove('tour-target');
            marked.removeEventListener('click', forward);
            marked = null;
          }
        }

        function finish() {
          unmark();
          backdrop.remove();
          card.remove();
          document.body.classList.remove('tour-open-top');
          db.setMeta(metaKey, true).catch(() => {}).then(resolve);
        }

        function forward() {
          show(index + 1);
        }

        function show(i) {
          unmark();
          while (i < steps.length && steps[i].onlyIf && !steps[i].onlyIf()) i += 1;
          if (i >= steps.length) {
            finish();
            return;
          }
          index = i;
          const step = steps[i];

          Array.from(dots.children).forEach((dot, n) => dot.classList.toggle('on', n <= i));
          title.textContent = step.title;
          text.textContent = step.text || '';
          text.hidden = !step.text;
          points.textContent = '';
          (step.points || []).forEach((point) => points.appendChild(el('li', '', point)));
          points.hidden = !(step.points && step.points.length);

          confirm.hidden = !step.confirm;
          confirmBox.checked = false;
          confirmText.textContent = step.confirm || '';

          const target = step.target ? document.querySelector(step.target) : null;
          const visible = !!(target && !target.closest('[hidden]'));
          // Ohne sichtbares Ziel gibt es nichts anzuklicken: dann geht es mit dem Knopf weiter
          const waitsForClick = !!step.mustClick && visible;
          const waitsForState = !!step.until;

          next.hidden = waitsForClick || waitsForState;
          next.disabled = !!step.confirm;
          next.textContent = i === steps.length - 1 ? 'Fertig' : 'Weiter';
          hint.textContent = (waitsForClick || waitsForState) ? (step.waitText || '') : '';

          const modal = !visible && !waitsForState;
          backdrop.hidden = !modal;
          card.classList.toggle('tour-modal', modal);
          card.classList.toggle('tour-warn', !!step.warn);
          card.classList.toggle('tour-top', step.place === 'top');
          document.body.classList.toggle('tour-open-top', step.place === 'top');

          if (visible) {
            marked = target;
            target.classList.add('tour-target');
            if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
            if (waitsForClick) target.addEventListener('click', forward);
          }
          if (waitsForState) {
            polling = setInterval(() => {
              if (step.until()) show(index + 1);
            }, 250);
          }
        }

        confirmBox.addEventListener('change', () => { next.disabled = !confirmBox.checked; });
        next.addEventListener('click', () => {
          if (!next.disabled) show(index + 1);
        });

        document.body.appendChild(backdrop);
        document.body.appendChild(card);
        show(0);
      });
    });
  }

  window.PanumTour = { start: start };
})();
