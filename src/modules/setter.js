// MOTORE C (parte 1) — AI Setter: qualifica il lead in conversazione e assegna uno score.
import db from '../db.js';
import { complete, safeJson } from '../ai.js';

const SETTER_SYSTEM = `Sei un assistente che qualifica lead per prenotare una call.
Fai UNA domanda alla volta per capire: bisogno, budget, tempistica.
Restituisci SOLO JSON: { reply (testo per il lead), qualified (true/false),
score (0-100), ask_booking (true se e' ora di proporre uno slot) }.`;

// Gestisce un messaggio in arrivo da un lead e produce la risposta dell'AI
export async function handleMessage(leadId, text) {
  db.prepare('INSERT INTO messages (lead_id, role, text) VALUES (?,?,?)').run(leadId, 'lead', text);

  // Costruisce il contesto (memoria: gli LLM sono stateless, la storia la teniamo noi)
  const history = db.prepare('SELECT role, text FROM messages WHERE lead_id = ? ORDER BY id').all(leadId)
    .map(m => `${m.role}: ${m.text}`).join('\n');

  const raw = await complete(SETTER_SYSTEM, `Conversazione finora:\n${history}\n\nProduci il prossimo JSON.`);
  const j = safeJson(raw, { reply: 'Puoi dirmi di più sul tuo obiettivo?', qualified: false, score: 10, ask_booking: false });

  db.prepare('INSERT INTO messages (lead_id, role, text) VALUES (?,?,?)').run(leadId, 'ai', j.reply || '');
  db.prepare('UPDATE leads SET status = ?, score = ? WHERE id = ?')
    .run(j.qualified ? 'qualificato' : 'in_qualifica', j.score || 0, leadId);

  return j;
}
