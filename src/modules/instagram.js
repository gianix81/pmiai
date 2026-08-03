// MOTORE B — Comment-to-DM via Instagram Graph API (ufficiale, gratis).
// Guardrail Meta: 1 DM/utente/24h, limite orario, finestra 24h. Verifica firma webhook.
import crypto from 'node:crypto';
import db from '../db.js';
import { config } from '../config.js';

// Verifica del webhook (GET con hub.challenge)
export function verifyWebhook(query) {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === config.meta.verifyToken) {
    return { ok: true, challenge: query['hub.challenge'] };
  }
  return { ok: false };
}

// Verifica la firma X-Hub-Signature-256 (che l'evento venga davvero da Meta)
export function verifySignature(rawBody, signature) {
  if (!config.meta.appSecret) return true; // se non configurato, salta (dev)
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', config.meta.appSecret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
}

function clientKeywords(clientId = 1) {
  const c = db.prepare('SELECT keywords, dm_template FROM clients WHERE id = ?').get(clientId) || {};
  let kws = ['info', 'guida']; try { kws = JSON.parse(c.keywords) || kws; } catch {}
  return { kws, dm: c.dm_template || 'Ciao! Ecco le info. (Rispondi STOP per non ricevere altri messaggi.)' };
}

export async function handleEvent(body) {
  const results = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'comments') results.push(await onComment(change.value));
    }
    for (const msg of entry.messaging || []) results.push(await onMessage(msg));
  }
  return results;
}

async function onComment(v, clientId = 1) {
  const text = (v.text || '').toLowerCase();
  const userId = v.from?.id;
  const username = v.from?.username || '';
  const { kws, dm } = clientKeywords(clientId);
  const hit = kws.find(k => text.includes(k.toLowerCase()));
  if (!hit) return { type: 'comment', action: 'ignorato' };

  // GUARDRAIL 1: un solo DM per utente ogni 24h
  if (db.prepare(`SELECT COUNT(*) c FROM dm_log WHERE ig_user_id=? AND sent_at>datetime('now','-1 day')`).get(userId).c > 0)
    return { type: 'comment', action: 'bloccato', reason: 'gia contattato in 24h' };
  // GUARDRAIL 2: limite orario
  if (db.prepare(`SELECT COUNT(*) c FROM dm_log WHERE sent_at>datetime('now','-1 hour')`).get().c >= config.maxDmPerHour)
    return { type: 'comment', action: 'in_coda', reason: 'limite orario' };

  const lead = db.prepare('SELECT * FROM leads WHERE ig_user_id=?').get(userId)
    || { id: db.prepare('INSERT INTO leads (client_id, ig_user_id, username, source) VALUES (?,?,?,?)').run(clientId, userId, username, hit).lastInsertRowid };

  await sendDM(userId, dm);
  db.prepare('INSERT INTO dm_log (ig_user_id) VALUES (?)').run(userId);
  db.prepare('INSERT INTO messages (lead_id, role, text) VALUES (?,?,?)').run(lead.id, 'ai', dm);
  return { type: 'comment', action: 'dm_inviato', user: username, keyword: hit };
}

// Messaggio in arrivo (risposta del lead) -> STOP, cattura email, o passa al setter
async function onMessage(msg) {
  const userId = msg.sender?.id;
  const text = msg.message?.text || '';
  const lead = db.prepare('SELECT * FROM leads WHERE ig_user_id=?').get(userId);
  if (!lead) return { type: 'message', action: 'nessun_lead' };

  if (/^\s*stop\s*$/i.test(text)) {
    db.prepare(`UPDATE leads SET status='stop' WHERE id=?`).run(lead.id);
    return { type: 'message', action: 'opt_out' };
  }
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) db.prepare(`UPDATE leads SET email=?, consent=1 WHERE id=?`).run(emailMatch[0], lead.id);

  const setter = await import('./setter.js');
  const r = await setter.handleMessage(lead.id, text);
  if (r.reply) await sendDM(userId, r.reply);
  return { type: 'message', action: 'setter', qualified: r.qualified };
}

// Invio DM: chiama la Graph API, oppure logga se DRY_RUN
export async function sendDM(recipientId, text) {
  if (config.dryRun || !config.meta.pageToken) { console.log(`[DRY_RUN] DM -> ${recipientId}: ${text}`); return { dryRun: true }; }
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${config.meta.pageToken}`;
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }) }).then(r => r.json());
}

// Pubblicazione post (Graph API)
export async function publishPost(caption, imageUrl) {
  if (config.dryRun || !config.meta.pageToken || !config.meta.igBusinessId) { console.log(`[DRY_RUN] PUBBLICA: ${caption.slice(0,60)}...`); return { dryRun: true }; }
  const base = `https://graph.facebook.com/v21.0/${config.meta.igBusinessId}`;
  const create = await fetch(`${base}/media?access_token=${config.meta.pageToken}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption }) }).then(r => r.json());
  if (!create.id) return create;
  return fetch(`${base}/media_publish?creation_id=${create.id}&access_token=${config.meta.pageToken}`, { method: 'POST' }).then(r => r.json());
}
