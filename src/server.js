// Server Express — collega tutti i moduli e serve la dashboard.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import db from './db.js';
import * as content from './modules/content.js';
import * as ig from './modules/instagram.js';
import * as setter from './modules/setter.js';
import * as booking from './modules/booking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- CONTENUTI ----------
app.get('/api/posts', (req, res) => res.json(content.listPosts(req.query.status)));
app.post('/api/posts/generate', async (req, res) => {
  const { topic, pillar, topics } = req.body || {};
  if (Array.isArray(topics)) return res.json(await content.generateBatch(topics));
  res.json(await content.generatePost({ topic, pillar }));
});
app.post('/api/posts/:id/status', (req, res) =>
  res.json(content.setStatus(Number(req.params.id), req.body.status, req.body.scheduled_at)));

// ---------- INSTAGRAM WEBHOOK ----------
app.get('/webhook/instagram', (req, res) => {
  const r = ig.verifyWebhook(req.query);
  if (r.ok) return res.status(200).send(r.challenge);
  res.sendStatus(403);
});
app.post('/webhook/instagram', async (req, res) => {
  res.sendStatus(200); // rispondi subito, poi elabora
  try { const out = await ig.handleEvent(req.body); console.log('IG event:', out); }
  catch (e) { console.error(e); }
});

// ---------- LEAD & SETTER ----------
app.get('/api/leads', (req, res) =>
  res.json(db.prepare('SELECT * FROM leads ORDER BY id DESC').all()));
app.post('/api/leads/:id/message', async (req, res) =>
  res.json(await setter.handleMessage(Number(req.params.id), req.body.text)));
app.get('/api/leads/:id/messages', (req, res) =>
  res.json(db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY id').all(Number(req.params.id))));

// ---------- BOOKING ----------
app.get('/api/slots', (req, res) => res.json(booking.getSlots()));
app.post('/api/bookings', (req, res) => res.json(booking.createBooking(req.body.lead_id, req.body.slot)));
app.post('/api/bookings/:id/confirm', (req, res) => res.json(booking.confirmBooking(Number(req.params.id))));
app.get('/api/bookings', (req, res) => res.json(booking.listBookings()));

// ---------- STATO ----------
app.get('/api/health', (req, res) => res.json({
  ok: true, provider: config.aiProvider, dryRun: config.dryRun,
  counts: {
    posts: db.prepare('SELECT COUNT(*) c FROM posts').get().c,
    leads: db.prepare('SELECT COUNT(*) c FROM leads').get().c,
    bookings: db.prepare('SELECT COUNT(*) c FROM bookings').get().c,
  }
}));

app.listen(config.port, () => {
  console.log(`\n  Sistema AI attivo su http://localhost:${config.port}`);
  console.log(`  AI provider: ${config.aiProvider} | DRY_RUN: ${config.dryRun}\n`);
});
