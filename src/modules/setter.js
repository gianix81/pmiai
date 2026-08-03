// MOTORE C1 — AI Setter: qualifica il lead, e quando è pronto propone/crea la prenotazione.
import db from '../db.js';
import { complete, safeJson } from '../ai.js';
import * as booking from './booking.js';

const SETTER_SYSTEM = `Sei un assistente che qualifica lead per prenotare una call.
Fai UNA domanda alla volta per capire bisogno, budget e tempistica.
Restituisci SOLO JSON: { reply (testo breve per il lead), qualified (true/false),
score (0-100), ask_booking (true quando e' ora di proporre uno slot) }.`;

export async function handleMessage(leadId, text) {
  db.prepare('INSERT INTO messages (lead_id, role, text) VALUES (?,?,?)').run(leadId, 'lead', text);

  const history = db.prepare('SELECT role, text FROM messages WHERE lead_id=? ORDER BY id').all(leadId)
    .map(m => `${m.role}: ${m.text}`).join('\n');
  const raw = await complete(SETTER_SYSTEM, `Conversazione:\n${history}\n\nProduci il prossimo JSON.`);
  const j = safeJson(raw, { reply: 'Puoi dirmi di più sul tuo obiettivo?', qualified: false, score: 10, ask_booking: false });

  db.prepare('INSERT INTO messages (lead_id, role, text) VALUES (?,?,?)').run(leadId, 'ai', j.reply || '');
  db.prepare('UPDATE leads SET status=?, score=? WHERE id=?')
    .run(j.qualified ? 'qualificato' : 'in_qualifica', j.score || 0, leadId);

  // Se è ora di prenotare: crea una bozza di prenotazione e chiedi conferma umana su Telegram
  if (j.ask_booking || j.qualified) {
    const slot = booking.getSlots()[0];
    if (slot) {
      const b = booking.createBooking(leadId, slot);
      const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(leadId);
      import('./telegram.js').then(t => t.askBooking(b, lead)).catch(() => {});
      j.booking = b;
    }
  }
  return j;
}
