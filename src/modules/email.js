// Cold email via SMTP (nodemailer). Rispetta un limite giornaliero per la deliverability.
// In DRY_RUN o senza SMTP configurato, logga soltanto.
import db from '../db.js';
import { config } from '../config.js';

let transporter = null;
async function getTransport() {
  if (transporter || !config.smtp.host) return transporter;
  const nodemailer = (await import('nodemailer')).default;
  transporter = nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

// Mette un'email in coda (non la invia subito: la manda lo scheduler nei limiti)
export function queue({ clientId = 1, to, subject, body }) {
  const info = db.prepare('INSERT INTO emails (client_id, to_email, subject, body) VALUES (?,?,?,?)')
    .run(clientId, to, subject, footer(body));
  return db.prepare('SELECT * FROM emails WHERE id = ?').get(info.lastInsertRowid);
}

// Aggiunge SEMPRE l'opt-out obbligatorio (compliance GDPR/CAN-SPAM)
function footer(body) {
  return `${body}\n\n—\nSe non desideri altre email, rispondi "STOP".`;
}

// Quante email sono già state inviate oggi (per il limite)
function sentToday() {
  return db.prepare(`SELECT COUNT(*) c FROM emails WHERE status='inviata' AND sent_at > date('now')`).get().c;
}

// Invia le email in coda fino al limite giornaliero
export async function processQueue() {
  let budget = config.smtp.dailyLimit - sentToday();
  if (budget <= 0) return { sent: 0, reason: 'limite giornaliero raggiunto' };
  const pending = db.prepare(`SELECT * FROM emails WHERE status='in_coda' ORDER BY id LIMIT ?`).all(budget);
  let sent = 0;
  for (const e of pending) {
    try {
      if (config.dryRun || !config.smtp.host) {
        console.log(`[DRY_RUN] EMAIL -> ${e.to_email}: ${e.subject}`);
      } else {
        const t = await getTransport();
        await t.sendMail({ from: config.smtp.from, to: e.to_email, subject: e.subject, text: e.body });
      }
      db.prepare(`UPDATE emails SET status='inviata', sent_at=datetime('now') WHERE id=?`).run(e.id);
      sent++;
    } catch (err) {
      db.prepare(`UPDATE emails SET status='errore' WHERE id=?`).run(e.id);
      console.error('email error', err.message);
    }
  }
  return { sent };
}

export function listEmails() {
  return db.prepare('SELECT * FROM emails ORDER BY id DESC LIMIT 100').all();
}
