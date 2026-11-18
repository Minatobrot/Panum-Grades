// Button "Klassenkalender" auf der Notenseite.

(function () {
  'use strict';

  window.PanumOverlay.ready.then(() => {
    window.PanumOverlay.addButton({
      name: 'classcalendar',
      title: 'Klassenkalender: Hausaufgaben und Prüfungen, geteilt mit deiner Klasse',
      color: '#00838f',
      svg: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="20" height="18" rx="4" fill="#00838f"/><rect x="8.5" y="3" width="3" height="6" rx="1.5" fill="#00838f" stroke="#fff"/><rect x="16.5" y="3" width="3" height="6" rx="1.5" fill="#00838f" stroke="#fff"/><rect x="7" y="12" width="14" height="9" rx="1.5" fill="#fff"/><rect x="9" y="14" width="3" height="2" rx="1" fill="#00838f"/><rect x="13" y="14" width="3" height="2" rx="1" fill="#00838f"/><rect x="17" y="14" width="2" height="2" rx="1" fill="#00838f"/><rect x="9" y="17" width="3" height="2" rx="1" fill="#00838f"/><rect x="13" y="17" width="3" height="2" rx="1" fill="#00838f"/></svg>`,
      page: 'features/classCalendar/calendar.html',
      width: 420,
      height: 620,
      // Das Panel fragt für den Beitritt zur Klasse nach der Teilnehmerliste.
      // Die Namen gehen nur an die eigene Extension-Seite, die sie vor dem Senden hasht.
      onMessage: (data, reply) => {
        if (data.panum !== 'loadRoster') return;
        const parse = window.PanumSchulnetzParse;
        const student = parse.parseStudent(document);
        if (!student) {
          reply({ panum: 'roster', error: 'Klasse nicht gefunden' });
          return;
        }
        window.PanumSchulnetzSession.loadRoster(student.klasse).then((members) => {
          const self = members ? parse.findSelf(members, student.name) : null;
          if (!self) {
            reply({ panum: 'roster', error: 'Du stehst nicht auf der Teilnehmerliste der ' + student.klasse });
          } else {
            reply({ panum: 'roster', members: members, self: self });
          }
        }, (error) => reply({ panum: 'roster', error: error.message }));
      }
    });
  });
})();
