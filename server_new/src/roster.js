// Wer darf einer Klasse beitreten? Die ganze Regel steht hier, damit sie später ersetzt werden kann
// (z.B. durch einen Klassencode), ohne den Rest anzufassen.
//
// Regel: Ein Name gilt als bestätigt, sobald er in den gemeldeten Teilnehmerlisten von mindestens
// zwei verschiedenen Mitgliedern steht. Solange eine Klasse noch keinen bestätigten Namen hat,
// darf jeder beitreten, der in seiner eigenen Liste steht. Danach nur noch bestätigte Namen.

const MIN_VOTES = 2;

function confirmedNames(db, classId) {
  const rows = db.prepare(`
    SELECT v.name_hash FROM roster_votes v
    JOIN members m ON m.id = v.member_id
    WHERE m.class_id = ?
    GROUP BY v.name_hash HAVING COUNT(DISTINCT v.member_id) >= ?
  `).all(classId, MIN_VOTES);
  return new Set(rows.map((row) => row.name_hash));
}

// self und roster sind bereits serverseitig gehashte Namen
function canJoin(db, classId, self, roster) {
  if (!roster.includes(self)) return { ok: false, reason: 'self_not_in_roster' };
  const confirmed = confirmedNames(db, classId);
  if (confirmed.size > 0 && !confirmed.has(self)) return { ok: false, reason: 'not_in_roster' };
  return { ok: true, confirmed: confirmed.has(self) };
}

// Ein Mitglied bleibt nur gültig, solange sein Name bestätigt ist oder die Klasse noch unbestätigt ist
function isMemberValid(db, classId, nameHash) {
  const confirmed = confirmedNames(db, classId);
  return confirmed.size === 0 || confirmed.has(nameHash);
}

function saveVote(db, memberId, roster) {
  db.prepare('DELETE FROM roster_votes WHERE member_id = ?').run(memberId);
  const insert = db.prepare('INSERT OR IGNORE INTO roster_votes (member_id, name_hash) VALUES (?, ?)');
  roster.forEach((nameHash) => insert.run(memberId, nameHash));
}

module.exports = { canJoin, isMemberValid, saveVote, confirmedNames };
