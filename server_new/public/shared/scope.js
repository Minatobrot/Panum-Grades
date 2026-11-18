// Lokaler Kalender-Speicher, getrennt nach Konto.
// Ein Konto ist Schule + Klasse + Name aus dem Schulnetz. Meldet sich im selben Browser jemand anderes an
// (andere Klasse oder andere Person), sieht er einen eigenen, leeren Kalender und ein eigenes Geräte-Token.
// Nichts aus einem Konto wird je unter einem anderen angezeigt oder hochgeladen.

(function () {
  'use strict';

  const raw = window.PanumRawDb;
  const SCOPED_META = ['session', 'rev', 'members', 'activityId', 'rosterAt', 'optOut'];
  let scope = null;

  function clean(text) {
    return String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // student: { name: "Nachname Vorname", klasse } aus der Kopfzeile der Notenseite
  function scopeFor(student, school) {
    if (!student) return 'unbekannt';
    return [clean(school), clean(student.klasse), clean(student.name)].join('|');
  }

  // Einführungen (tour_…) gelten für den Browser, alles andere für das Konto
  function metaKey(key) {
    if (key.startsWith('tour_')) return key;
    if (!scope) throw new Error('Kalender-Speicher: Konto noch nicht bekannt');
    return key + '@' + scope;
  }

  // Passt eine gespeicherte Verbindung zu der Person, die jetzt angemeldet ist?
  // alias ist "Vorname N.", who.name ist "Nachname Vorname".
  function sameOwner(session, who) {
    if (!who) return true;
    if (clean(session.klasse) !== clean(who.klasse)) return false;
    if (session.school && clean(session.school) !== clean(who.school)) return false;
    if (!session.alias || !who.name) return true;
    const alias = clean(session.alias);
    const name = clean(who.name);
    const initial = alias.charAt(alias.length - 2);
    return name.charAt(0) === initial && name.split(' ').includes(alias.split(' ')[0]);
  }

  async function moveScope(from, to) {
    for (const key of SCOPED_META) {
      const value = await raw.metaGet(key + from);
      if (value !== undefined) {
        await raw.metaSet(key + '@' + to, value);
        await raw.metaDelete(key + from);
      }
    }
  }

  // Daten von vor der Trennung (ohne Konto) einmalig einem Konto zuordnen.
  // Einträge, die schon auf dem Server liegen, werden verworfen und für die richtige Klasse neu geholt:
  // lokal lässt sich nicht mehr sagen, aus welcher Klasse sie stammen.
  async function adoptOldData(who) {
    const oldSession = await raw.metaGet('session');
    const loose = (await raw.items()).filter((item) => !item.scope);
    if (oldSession === undefined && !loose.length) return;

    let owner = scope;
    if (oldSession && !sameOwner(oldSession, who)) {
      owner = 'alt|' + clean(oldSession.school) + '|' + clean(oldSession.klasse) + '|' + clean(oldSession.alias);
    }
    await moveScope('', owner);
    await raw.metaSet('rev@' + owner, 0);

    for (const item of loose) {
      await raw.remove(item.key);
      if (!item.rev) {
        await raw.put(Object.assign({}, item, { scope: owner, key: owner + '\n' + item.id }));
      }
    }
  }

  // Wurde eine alte Verbindung beim ersten Mal jemand anderem zugeordnet ("alt|…"), holt sie sich
  // ihr Besitzer zurück, sobald er sich wieder anmeldet.
  async function reclaim(who) {
    if (!who || (await raw.metaGet('session@' + scope)) !== undefined) return;
    for (const key of await raw.metaKeys()) {
      if (typeof key !== 'string' || !key.startsWith('session@alt|')) continue;
      const session = await raw.metaGet(key);
      if (!session || !sameOwner(session, who)) continue;
      const old = key.slice('session@'.length);
      await moveScope('@' + old, scope);
      for (const item of (await raw.items()).filter((i) => i.scope === old)) {
        await raw.remove(item.key);
        await raw.put(Object.assign({}, item, { scope: scope, key: scope + '\n' + item.id }));
      }
      return;
    }
  }

  // Muss vor allem anderen aufgerufen werden. who: { school, klasse, name } oder null (Handy-Seite)
  async function useScope(key, who) {
    scope = key;
    await adoptOldData(who);
    await reclaim(who);
  }

  async function allEntries() {
    return (await raw.items()).filter((item) => item.scope === scope);
  }

  function putEntry(entry) {
    return raw.put(Object.assign({}, entry, { scope: scope, key: scope + '\n' + entry.id }));
  }

  async function clearEntries() {
    for (const item of await allEntries()) await raw.remove(item.key);
  }

  // Löscht alles dieses Kontos. Andere Konten im selben Browser bleiben unberührt.
  async function wipe() {
    await clearEntries();
    for (const key of SCOPED_META) await raw.metaDelete(key + '@' + scope);
  }

  window.PanumCalendarDb = {
    scopeFor: scopeFor,
    useScope: useScope,
    allEntries: allEntries,
    putEntry: putEntry,
    clearEntries: clearEntries,
    getMeta: (key) => raw.metaGet(metaKey(key)),
    setMeta: (key, value) => raw.metaSet(metaKey(key), value),
    wipe: wipe
  };
})();
