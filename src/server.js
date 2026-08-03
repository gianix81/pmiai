// Server Express — collega tutti i moduli, sicurezza, scheduler e Telegram.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, readiness } from './config.js';
import db from './db.js';
import * as content from './modules/content.js';
import * as ig from './modules/instagram.js';
import * as setter from './modules/setter.js';
import * as booking from './modules/booking.js';
import * as email from './modules/email.js';
import * as telegram from './modules/telegram.js';
import * as scheduler from './modules/scheduler.js';
import * as orchestrator from './modules/orchestrator.js';
import * as knowledge from './modules/knowledge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// cattura il corpo grezzo per verificare la firma Meta
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// --- Auth base su dashboard e /api (NON sui webhook: Meta non manda credenziali) ---
function auth(req, res, next) {
  if (req.path.startsWith('/webhook')) return next();
  const h = req.headers.authorization || '';
  const [u, p] = Buffer.from(h.split(' ')[1] || '', 'base64').toString().split(':');
  if (u === config.dashboard.user && p === config.dashboard.pass) return next();
  res.set('WWW-Authenticate', 'Basic realm="Sistema AI"').status(401).send('Accesso richiesto');
}
app.use(auth);
app.use(express.static(path.join(__dirname, 'public')));

// ---------- CLIENTI ----------
app.get('/api/clients', (req, res) => res.json(db.prepare('SELECT * FROM clients ORDER BY id').all()));
app.post('/api/clients', (req, res) => {
  const { name, brand_voice, pillars, keywords, dm_template } = req.body || {};
  const info = db.prepare(`INSERT INTO clients (name, brand_voice, pillars, keywords, dm_template) VALUES (?,?,?,?,?)`)
    .run(name, brand_voice || '', JSON.stringify(pillars || []), JSON.stringify(keywords || []), dm_template || '');
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(info.lastInsertRowid));
});

// ---------- CONTENUTI ----------
app.get('/api/posts', (req, res) => res.json(content.listPosts(req.query.status, req.query.client_id)));
app.post('/api/posts/generate', async (req, res) => {
  const { topic, pillar, topics, client_id } = req.body || {};
  if (Array.isArray(topics)) return res.json(await content.generateBatch(topics, client_id || 1));
  res.json(await content.generatePost({ topic, pillar, clientId: client_id || 1 }));
});
app.post('/api/posts/:id/status', (req, res) =>
  res.json(content.setStatus(Number(req.params.id), req.body.status, req.body.scheduled_at)));

// ---------- INSTAGRAM WEBHOOK ----------
app.get('/webhook/instagram', (req, res) => {
  const r = ig.verifyWebhook(req.query);
  return r.ok ? res.status(200).send(r.challenge) : res.sendStatus(403);
});
app.post('/webhook/instagram', async (req, res) => {
  if (!ig.verifySignature(req.rawBody, req.headers['x-hub-signature-256'])) return res.sendStatus(403);
  res.sendStatus(200);
  try { console.log('IG event:', await ig.handleEvent(req.body)); } catch (e) { console.error(e); }
});

// ---------- PONTE MANYCHAT (Instagram senza App Review) ----------
// ManyChat chiama questo endpoint con { user_input, contact_id }.
// Nel mapping risposta di ManyChat usa il JSON path: $.output
app.post('/webhook/manychat', async (req, res) => {
  const uid = String(req.body.contact_id || 'manychat');
  const text = req.body.user_input || '';
  try {
    const reply = await ig.replyToText(uid, text);
    res.json({ output: reply });
  } catch (e) {
    console.error('manychat', e);
    res.json({ output: 'Un attimo, ci sono un problema tecnico. Riprova tra poco.' });
  }
});

// ---------- LEAD & SETTER ----------
app.get('/api/leads', (req, res) => res.json(db.prepare('SELECT * FROM leads ORDER BY id DESC').all()));
app.get('/api/leads/:id/messages', (req, res) =>
  res.json(db.prepare('SELECT * FROM messages WHERE lead_id=? ORDER BY id').all(Number(req.params.id))));
app.post('/api/leads/:id/message', async (req, res) =>
  res.json(await setter.handleMessage(Number(req.params.id), req.body.text)));

// ---------- BOOKING ----------
app.get('/api/slots', (_req, res) => res.json(booking.getSlots()));
app.get('/api/bookings', (_req, res) => res.json(booking.listBookings()));
app.post('/api/bookings', (req, res) => res.json(booking.createBooking(req.body.lead_id, req.body.slot)));
app.post('/api/bookings/:id/confirm', (req, res) => res.json(booking.confirmBooking(Number(req.params.id))));

// ---------- COLD EMAIL ----------
app.get('/api/emails', (_req, res) => res.json(email.listEmails()));
app.post('/api/emails/queue', (req, res) => res.json(email.queue(req.body)));
app.post('/api/emails/process', async (_req, res) => res.json(await email.processQueue()));

// ---------- ORCHESTRATORE SIRIO (chat naturale) ----------
app.post('/api/chat', async (req, res) => {
  const session = req.body.session || 'dashboard';
  res.json(await orchestrator.handle(session, req.body.text || ''));
});
app.get('/api/agents', (_req, res) =>
  res.json(Object.entries(orchestrator.AGENTS).map(([k, v]) => ({ name: k, emoji: v.emoji, desc: v.desc }))));

// ---------- KNOWLEDGE BASE ----------
app.get('/api/knowledge', (_req, res) => res.json(knowledge.listKnowledge()));
app.post('/api/knowledge', (req, res) => res.json(knowledge.addKnowledge(req.body.agent, req.body.content)));

// ---------- STATO ----------
app.get('/api/health', (_req, res) => res.json({
  ok: true, readiness: readiness(),
  counts: {
    clients: db.prepare('SELECT COUNT(*) c FROM clients').get().c,
    posts: db.prepare('SELECT COUNT(*) c FROM posts').get().c,
    leads: db.prepare('SELECT COUNT(*) c FROM leads').get().c,
    bookings: db.prepare('SELECT COUNT(*) c FROM bookings').get().c,
    emails: db.prepare('SELECT COUNT(*) c FROM emails').get().c,
  }
}));

app.listen(config.port, () => {
  const r = readiness();
  console.log(`\n  Sistema AI su http://localhost:${config.port}`);
  console.log(`  AI: ${r.ai} | Instagram: ${r.instagram} | Telegram: ${r.telegram} | Email: ${r.email} | DRY_RUN: ${r.dryRun}\n`);
  scheduler.start();
  telegram.startPolling();
});
