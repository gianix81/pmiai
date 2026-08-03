// Knowledge base / policy per agente. Consultata prima di agire (lezione dal corso).
import db from '../db.js';

// Restituisce le regole attive per un agente + quelle globali (sirio)
export function getKnowledge(agent) {
  const rows = db.prepare(
    `SELECT content FROM knowledge WHERE active=1 AND (agent=? OR agent='sirio') ORDER BY agent='sirio' DESC`
  ).all(agent);
  return rows.map(r => r.content);
}

export function addKnowledge(agent, content) {
  const info = db.prepare('INSERT INTO knowledge (agent, content) VALUES (?,?)').run(agent, content);
  return db.prepare('SELECT * FROM knowledge WHERE id=?').get(info.lastInsertRowid);
}

export function listKnowledge() {
  return db.prepare('SELECT * FROM knowledge ORDER BY agent, id').all();
}

export function setActive(id, active) {
  db.prepare('UPDATE knowledge SET active=? WHERE id=?').run(active ? 1 : 0, id);
}
