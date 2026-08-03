// Scheduler: pubblica i post approvati arrivati a scadenza e smaltisce la coda email.
import db from '../db.js';
import * as ig from './instagram.js';
import * as email from './email.js';
import * as briefing from './briefing.js';

// Pubblica i post "approvato" con scheduled_at passato (o senza data = subito)
export async function publishDuePosts() {
  const due = db.prepare(`
    SELECT * FROM posts WHERE status='approvato'
    AND (scheduled_at IS NULL OR scheduled_at <= datetime('now'))
  `).all();
  for (const p of due) {
    try {
      const r = await ig.publishPost(p.caption + '\n' + safeTags(p.hashtags), p.image_url);
      const ok = r?.id || r?.dryRun;
      db.prepare(`UPDATE posts SET status=?, published_at=datetime('now') WHERE id=?`)
        .run(ok ? 'pubblicato' : 'errore', p.id);
      console.log(`  Scheduler: post #${p.id} ${ok ? 'pubblicato' : 'errore'}`);
    } catch (e) {
      db.prepare(`UPDATE posts SET status='errore' WHERE id=?`).run(p.id);
      console.error('publish error', e.message);
    }
  }
  return due.length;
}

function safeTags(s) { try { return JSON.parse(s).join(' '); } catch { return ''; } }

// Avvia i cicli periodici
export function start() {
  console.log('  Scheduler: attivo (pubblicazione post + coda email).');
  setInterval(() => publishDuePosts().catch(() => {}), 60_000);   // ogni minuto
  setInterval(() => email.processQueue().catch(() => {}), 120_000); // ogni 2 minuti
  briefing.start(); // morning brief proattivo di Sole
}
