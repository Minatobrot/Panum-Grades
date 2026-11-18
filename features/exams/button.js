// Button "Prüfungen" auf der Notenseite: holt den Prüfungsplan aus dem Schulnetz und reicht ihn ans Panel.

(function () {
  'use strict';

  window.PanumOverlay.ready.then(() => {
    window.PanumOverlay.addButton({
      name: 'exams',
      title: 'Prüfungen: aus dem Schulnetz in den Klassenkalender übernehmen',
      color: '#b34c27',
      glow: '#f0b9a4',
      svg: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="4" width="18" height="20" rx="4" fill="#b34c27"/><rect x="10" y="2.5" width="8" height="4" rx="2" fill="#b34c27" stroke="#fff"/><rect x="8" y="10" width="12" height="2" rx="1" fill="#fff"/><rect x="8" y="14" width="7" height="2" rx="1" fill="#fff"/><path d="M12.5 19.5l2 2 4-4.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      page: 'features/exams/exams.html',
      width: 420,
      height: 620,
      onMessage: (data, reply) => {
        if (data.panum !== 'loadExams') return;
        const student = window.PanumSchulnetzParse.parseStudent(document);
        if (!student) {
          reply({ panum: 'exams', error: 'Klasse nicht gefunden' });
          return;
        }
        window.PanumSchulnetzSession.loadExams(student.klasse).then(
          (exams) => {
            // Nur Prüfungen der Kurse, die bei dir unter "Aktuelle Noten" stehen.
            // Klappt der Abgleich nicht, bleibt die Liste vollständig (Stand 3.1.2).
            let own = exams;
            try {
              const parse = window.PanumSchulnetzParse;
              own = parse.filterOwnExams(exams, parse.parseGradeCourses(document));
            } catch (error) {
              console.warn('Panum Grades: Kursabgleich für Prüfungen fehlgeschlagen, zeige alle', error);
            }
            reply({ panum: 'exams', exams: own });
          },
          (error) => reply({ panum: 'exams', error: error.message })
        );
      }
    });
  });
})();
