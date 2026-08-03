// ☀️ SOLE — proattività: morning brief automatico (lezione del corso Telegram).
// Alle ore impostate manda su Telegram un riassunto della giornata, senza che tu chieda.
// Se Google è collegato aggiunge agenda reale + triage email; se no, resta sui dati interni.
import db from '../db.js';
import { config } from '../config.js';
import * as telegram from './telegram.js';
import * as google from './google.js';
import * as accounting from './accounting.js';

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

// Testo del brief (deterministico, sempre funziona; le parti Google si aggiungono se disponibili)
export async function dailyBrief() {
  const s = snapshot();
  const lines = [
    '☀️ Buongiorno! Ecco il brief di oggi:',
    `• Appuntamenti in agenda: ${s.bookingsToday}`,
    `• Post da approvare: ${s.toApprove}`,
    `• Nuovi lead oggi: ${s.newLeads}`,
    `• Lead caldi da ricontattare: ${s.hotLeads}`,
    `• Email in coda: ${s.emailsQueued}`,
  ];

  // Agenda Google reale
  if (google.isConfigured()) {
    try {
      const { events } = await google.todayEvents();
      lines.push('', `📅 Calendario (${events.length}):`, google.formatEvents(events));
    } catch (e) {
      lines.push('', `📅 Calendario non raggiungibile (${e.message.slice(0, 80)})`);
    }
    try {
      const t = await google.triageEmails();
      if (t.items?.length) lines.push('', `📧 ${t.summary}`, google.formatTriage(t.items, 5));
    } catch (e) {
      lines.push('', `📧 Gmail non raggiungibile (${e.message.slice(0, 80)})`);
    }
  }

  // Scadenze contabili di Luna entro 7 giorni
  const dl = accounting.upcomingDeadlines(7);
  if (dl.length) {
    lines.push('', '🌙 Scadenze entro 7 giorni:',
      ...dl.map(d => `• ${d.due_date} ${d.label}${d.amount ? ' — ' + accounting.eur(d.amount) : ''}`));
  }

  lines.push('', 'Buona giornata! 💪');
  return lines.join('\n');
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
