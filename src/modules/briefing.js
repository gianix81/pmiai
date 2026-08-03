// ☀️ SOLE — proattività: morning brief automatico (lezione del corso Telegram).
// Alle ore impostate manda su Telegram un riassunto della giornata, senza che tu chieda.
import db from '../db.js';
import { config } from '../config.js';
import * as telegram from './telegram.js';

// Foto della giornata dai dati che già abbiamo
export function snapshot() {
  return {
    bookingsToday: db.prepare("SELECT COUNT(*) c FROM bookings WHERE date(slot)=date('now')").get().c,
    toApprove: db.prepare("SELECT COUNT(*) c FROM posts WHERE status='da_approvare'").get().c,
    newLeads: db.prepare("SELECT COUNT(*) c FROM leads WHERE date(created_at)=date('now')").get().c,
    emailsQueued: db.prepare("SELECT COUNT(*) c FROM emails WHERE status='in_coda'").get().c,
    hotLeads: db.prepare("SELECT COUNT(*) c FROM leads WHERE status='qualificato'").get().c,
  };
}

// Testo del brief (deterministico, sempre funziona; l'AI vera può poi riscriverlo più bello)
export async function dailyBrief() {
  const s = snapshot();
  return [
    '☀️ Buongiorno! Ecco il brief di oggi:',
    `• Appuntamenti in agenda: ${s.bookingsToday}`,
    `• Post da approvare: ${s.toApprove}`,
    `• Nuovi lead oggi: ${s.newLeads}`,
    `• Lead caldi da ricontattare: ${s.hotLeads}`,
    `• Email in coda: ${s.emailsQueued}`,
    'Buona giornata! 💪',
  ].join('\n');
}

export async function sendDailyBrief() {
  const text = await dailyBrief();
  await telegram.send(text);
  return text;
}

// Loop: controlla ogni minuto; scatta una sola volta al giorno all'ora impostata
let lastSent = '';
export function start() {
  const hour = config.briefHour;
  console.log(`  Sole: morning brief attivo alle ${hour}:00.`);
  setInterval(async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === hour && lastSent !== today) {
      lastSent = today;
      try { await sendDailyBrief(); } catch (e) { console.error('brief', e.message); }
    }
  }, 60_000);
}
