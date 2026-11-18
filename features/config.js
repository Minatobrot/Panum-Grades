// Die einzige Stelle, an der die Server-Adresse steht. Alles andere leitet sich davon ab.
// Leer lassen ('') schaltet den Abgleich mit der Klasse ab, der Kalender bleibt dann rein lokal.

window.PanumConfig = {
  serverUrl: 'https://calendar.panumic.com',
  standalone: false
};
