// MOTORE A — Contenuti: genera bozze con l'AI, le salva, gestisce l'approvazione.
import db from '../db.js';
import { complete, safeJson } from '../ai.js';

const BRAND_SYSTEM = `Sei il social media strategist del brand. Scrivi in italiano, tono diretto e concreto.
Restituisci SOLO JSON valido con i campi: hook (max 8 parole), caption (60-120 parole),
hashtags (array di 3-5), cta (una frase). Niente altro testo.`;

// Genera un singolo post per un pilastro/tema
export async function generatePost({ client = 'demo', pillar = 'educativo', topic = 'AI per le PMI' }) {
  const user = `Genera 1 post per il pilastro "${pillar}" sul tema: "${topic}".`;
  const raw = await complete(BRAND_SYSTEM, user);
  const j = safeJson(raw, {});
  const info = db.prepare(`INSERT INTO posts (client, pillar, topic, hook, caption, hashtags, cta)
    VALUES (?,?,?,?,?,?,?)`).run(
      client, pillar, topic,
      j.hook || '', j.caption || '',
      JSON.stringify(j.hashtags || []), j.cta || '');
  return getPost(info.lastInsertRowid);
}

// Genera un batch di post (es. un mini calendario)
export async function generateBatch(topics = [], client = 'demo') {
  const out = [];
  for (const t of topics) out.push(await generatePost({ client, topic: t }));
  return out;
}

export function listPosts(status) {
  const q = status
    ? db.prepare('SELECT * FROM posts WHERE status = ? ORDER BY id DESC')
    : db.prepare('SELECT * FROM posts ORDER BY id DESC');
  return (status ? q.all(status) : q.all()).map(decorate);
}

export function getPost(id) {
  return decorate(db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
}

// Approva/scarta/programma (il "gate umano")
export function setStatus(id, status, scheduledAt = null) {
  db.prepare('UPDATE posts SET status = ?, scheduled_at = ? WHERE id = ?').run(status, scheduledAt, id);
  return getPost(id);
}

function decorate(p) {
  if (!p) return null;
  return { ...p, hashtags: safeParse(p.hashtags) };
}
function safeParse(s) { try { return JSON.parse(s); } catch { return []; } }
