// MOTORE A — Contenuti: genera bozze con l'AI (voce di brand per cliente),
// notifica su Telegram per l'approvazione, gestisce lo stato.
import db from '../db.js';
import { complete, safeJson } from '../ai.js';

function client(id = 1) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id) || { brand_voice: '', name: 'Demo' };
}

function systemFor(c) {
  return `Sei il social media strategist di "${c.name}". ${c.brand_voice || ''}
Scrivi in italiano. Restituisci SOLO JSON valido con: hook (max 8 parole),
caption (60-120 parole), hashtags (array 3-5), cta (una frase). Niente altro.`;
}

export async function generatePost({ clientId = 1, pillar = 'educativo', topic = 'AI per le PMI', notify = true } = {}) {
  const c = client(clientId);
  const raw = await complete(systemFor(c), `Genera 1 post per il pilastro "${pillar}" sul tema: "${topic}".`);
  const j = safeJson(raw, {});
  const info = db.prepare(`INSERT INTO posts (client_id, pillar, topic, hook, caption, hashtags, cta)
    VALUES (?,?,?,?,?,?,?)`).run(clientId, pillar, topic,
      j.hook || '', j.caption || '', JSON.stringify(j.hashtags || []), j.cta || '');
  const post = getPost(info.lastInsertRowid);
  if (notify) { // notifica Telegram (import dinamico per evitare cicli)
    import('./telegram.js').then(t => t.askPost(post)).catch(() => {});
  }
  return post;
}

export async function generateBatch(topics = [], clientId = 1) {
  const out = [];
  for (const t of topics) out.push(await generatePost({ clientId, topic: t }));
  return out;
}

export function listPosts(status, clientId) {
  let sql = 'SELECT * FROM posts', where = [], args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (clientId) { where.push('client_id = ?'); args.push(clientId); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC';
  return db.prepare(sql).all(...args).map(decorate);
}

export function getPost(id) { return decorate(db.prepare('SELECT * FROM posts WHERE id = ?').get(id)); }

// Gate umano: approva/scarta/programma. scheduledAt ISO opzionale.
export function setStatus(id, status, scheduledAt = null, approvedBy = 'dashboard') {
  db.prepare('UPDATE posts SET status = ?, scheduled_at = COALESCE(?, scheduled_at), approved_by = ? WHERE id = ?')
    .run(status, scheduledAt, approvedBy, id);
  return getPost(id);
}

function decorate(p) { return p ? { ...p, hashtags: safeParse(p.hashtags) } : null; }
function safeParse(s) { try { return JSON.parse(s); } catch { return []; } }
