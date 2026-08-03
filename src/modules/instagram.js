// MOTORE B — Comment-to-DM via Instagram Graph API (ufficiale, gratis).
// Include i guardrail di compliance Meta: 1 DM/utente/24h, limite orario, finestra 24h.
import db from '../db.js';
import { config } from '../config.js';

// Parole chiave che fanno scattare il DM (personalizzabili per cliente)
const TRIGGERS = ['info', 'guida', 'voglio'];

// Verifica del webhook (Meta invia una GET con hub.challenge)
export function verifyWebhook(query) {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === config.meta.verifyToken) {
    return { ok: true, challenge: query['hub.challenge'] };
  }
  return { ok: false };
}

// Gestisce un evento in arrivo (commento o messaggio)
export async function handleEvent(body) {
  const results = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'comments') {
        results.push(await onComment(change.value));
      }
    }
    for (const msg of entry.messaging || []) {
      results.push({ type: 'message', note: 'instrada al setter', from: msg.sender?.id });
    }
  }
  return results;
}

async function onComment(v) {
  const text = (v.text || '').toLowerCase();
  const userId = v.from?.id;
  const username = v.from?.username || '';
  const hit = TRIGGERS.find(k => text.includes(k));
  if (!hit) return { type: 'comment', action: 'ignorato', reason: 'nessuna keyword' };

  // GUARDRAIL 1: un solo DM per utente ogni 24h
  const recent = db.prepare(
    `SELECT COUNT(*) c FROM dm_log WHERE ig_user_id = ? AND sent_at > datetime('now','-1 day')`
  ).get(userId).c;
  if (recent > 0) return { type: 'comment', action: 'bloccato', reason: 'gia contattato in 24h' };

  // GUARDRAIL 2: limite orario per account
  const lastHour = db.prepare(
    `SELECT COUNT(*) c FROM dm_log WHERE sent_at > datetime('now','-1 hour')`
  ).get().c;
  if (lastHour >= config.maxDmPerHour) return { type: 'comment', action: 'in_coda', reason: 'limite orario raggiunto' };

  // Crea/aggiorna il lead
  const lead = db.prepare('SELECT * FROM leads WHERE ig_user_id = ?').get(userId)
    || { id: db.prepare('INSERT INTO leads (ig_user_id, username, source) VALUES (?,?,?)').run(userId, username, hit).lastInsertRowid };

  const dmText = `Ciao! Come promesso ecco le info. Dimmi il tuo obiettivo e ti guido. (Rispondi STOP per non ricevere altri messaggi.)`;
  await sendDM(userId, dmText);
  db.prepare('INSERT INTO dm_log (ig_user_id) VALUES (?)').run(userId);
  db.prepare('INSERT INTO messages (lead_id, role, text) VALUES (?, ?, ?)').run(lead.id, 'ai', dmText);

  return { type: 'comment', action: 'dm_inviato', user: username, keyword: hit };
}

// Invio DM: chiama davvero la Graph API, oppure logga se DRY_RUN
export async function sendDM(recipientId, text) {
  if (config.dryRun || !config.meta.pageToken) {
    console.log(`[DRY_RUN] DM -> ${recipientId}: ${text}`);
    return { dryRun: true };
  }
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${config.meta.pageToken}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  return r.json();
}

// Pubblicazione di un post approvato (Graph API, gratis)
export async function publishPost(caption, imageUrl) {
  if (config.dryRun || !config.meta.pageToken || !config.meta.igBusinessId) {
    console.log(`[DRY_RUN] PUBBLICA post: ${caption.slice(0, 60)}...`);
    return { dryRun: true };
  }
  const base = `https://graph.facebook.com/v21.0/${config.meta.igBusinessId}`;
  const create = await (await fetch(`${base}/media?access_token=${config.meta.pageToken}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption }),
  })).json();
  if (!create.id) return create;
  return (await fetch(`${base}/media_publish?creation_id=${create.id}&access_token=${config.meta.pageToken}`, { method: 'POST' })).json();
}
