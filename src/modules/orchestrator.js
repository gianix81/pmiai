// ORCHESTRATORE SIRIO — il "classifier agent" del corso.
// Riceve un messaggio naturale, decide quale agente-tool usare, passa userQuery + task_description,
// tiene memoria per session_key, consulta la knowledge base, inietta data/ora.
import db from '../db.js';
import { complete, safeJson } from '../ai.js';
import { getKnowledge } from './knowledge.js';
import * as content from './content.js';

// --- Registro degli agenti (sotto-agenti come "tool", con descrizione trigger-oriented) ---
export const AGENTS = {
  sole:   { emoji: '☀️', desc: 'assistente: email, agenda, appuntamenti, promemoria, ricerche generiche', handler: soleHandler },
  stella: { emoji: '⭐', desc: 'contenuti e social: crea post, caption, caroselli, reel', handler: stellaHandler },
  luna:   { emoji: '🌙', desc: 'contabilità: incassi, spese, fatture, prima nota, scadenze, numeri', handler: lunaHandler },
  cometa: { emoji: '☄️', desc: 'campagne ads e marketing a pagamento (Meta/Google Ads)', handler: cometaHandler },
  luce:   { emoji: '💡', desc: 'lead e vendite: DM, qualifica contatti, prenotazione call, stato lead', handler: luceHandler },
};
const ENUM = Object.keys(AGENTS); // enum chiuso (evita mismatch)

// --- Memoria (session_key = chat_id) ---
function saveMemory(sessionKey, role, content) {
  db.prepare('INSERT INTO conversation_memory (session_key, role, content) VALUES (?,?,?)').run(sessionKey, role, content);
}
function getMemory(sessionKey, n = 10) {
  return db.prepare('SELECT role, content FROM conversation_memory WHERE session_key=? ORDER BY id DESC LIMIT ?')
    .all(sessionKey, n).reverse();
}

// --- Router: sceglie l'agente ---
async function route(text, history) {
  const toolList = ENUM.map(a => `- ${a}: ${AGENTS[a].desc}`).join('\n');
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const system = `Sei Sirio, l'orchestratore di un team di agenti AII. Oggi è ${now} (Europe/Rome).
Il tuo UNICO compito è instradare la richiesta all'agente giusto. Agenti disponibili:
${toolList}

Regole:
- ${getKnowledge('sirio').join(' ')}
- Se la richiesta è chiacchiera o non rientra in nessun agente, usa "direct_reply".
Rispondi SOLO con questo JSON:
{"agent": "<uno tra: ${ENUM.join(', ')} oppure null>", "task_description": "<cosa deve fare l'agente, in una frase>", "direct_reply": "<rispondi tu qui SOLO se agent è null, altrimenti stringa vuota>"}`;
  const conv = history.map(m => `${m.role}: ${m.content}`).join('\n');
  const raw = await complete(system, `Conversazione:\n${conv}\n\nRICHIESTA: ${text}\n\nInstrada (JSON):`);
  const j = safeJson(raw, { agent: null, task_description: '', direct_reply: 'Puoi ripetere?' });
  if (j.agent && !ENUM.includes(j.agent)) j.agent = null; // enum chiuso: validazione
  return j;
}

// --- Entry point ---
export async function handle(sessionKey, text) {
  saveMemory(sessionKey, 'user', text);
  const history = getMemory(sessionKey);
  const r = await route(text, history);

  let reply, agentUsed = r.agent;
  if (!r.agent) {
    reply = r.direct_reply || 'Non ho capito, puoi spiegarmi meglio?';
  } else {
    reply = await AGENTS[r.agent].handler({ query: text, task: r.task_description });
  }
  saveMemory(sessionKey, 'assistant', reply);
  return { agent: agentUsed, emoji: agentUsed ? AGENTS[agentUsed].emoji : '💬', reply };
}

// ---------- Handler dei singoli agenti ----------
// Ognuno consulta la propria knowledge base prima di agire.
async function stellaHandler({ query }) {
  const post = await content.generatePost({ topic: query, notify: false });
  return `⭐ Post pronto (in attesa di approvazione):\n"${post.hook}"\n${post.caption}`;
}
async function lunaHandler() {
  const b = db.prepare('SELECT COUNT(*) c FROM bookings').get().c;
  return `🌙 Report contabile (demo): nessun estratto conto caricato. Regole attive: ${getKnowledge('luna').join(' ')}`;
}
async function soleHandler({ task }) {
  return `☀️ Bozza pronta per: "${task}". (Collega Gmail/Calendar per inviare davvero.)`;
}
async function cometaHandler({ task }) {
  return `☄️ Campagna impostata in bozza per: "${task}". (Serve il Business Manager Meta per attivarla.)`;
}
async function luceHandler() {
  const leads = db.prepare('SELECT COUNT(*) c FROM leads').get().c;
  const booked = db.prepare("SELECT COUNT(*) c FROM leads WHERE status='prenotato'").get().c;
  return `💡 Lead totali: ${leads}, prenotati: ${booked}. Regole: ${getKnowledge('luce').join(' ')}`;
}
