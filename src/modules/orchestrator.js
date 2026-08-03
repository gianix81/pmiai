// ORCHESTRATORE SIRIO — il "classifier agent" del corso.
// Riceve un messaggio naturale, decide quale agente-tool usare, passa userQuery + task_description,
// tiene memoria per session_key, consulta la knowledge base + il RAG, inietta data/ora.
import db from '../db.js';
import { complete, safeJson } from '../ai.js';
import { getKnowledge } from './knowledge.js';
import * as rag from './rag.js';
import * as content from './content.js';
import * as accounting from './accounting.js';
import * as google from './google.js';

// --- Registro degli agenti (sotto-agenti come "tool", con descrizione trigger-oriented) ---
export const AGENTS = {
  sole: { emoji: '☀️', desc: 'assistente: email, agenda, appuntamenti, promemoria, ricerche generiche', handler: soleHandler },
  stella: { emoji: '⭐', desc: 'contenuti e social: crea post, caption, caroselli, reel', handler: stellaHandler },
  luna: { emoji: '🌙', desc: 'contabilità: incassi, spese, fatture, prima nota, cashflow, scadenze, numeri', handler: lunaHandler },
  cometa: { emoji: '☄️', desc: 'campagne ads e marketing a pagamento (Meta/Google Ads)', handler: cometaHandler },
  luce: { emoji: '💡', desc: 'lead e vendite: DM, qualifica contatti, prenotazione call, stato lead', handler: luceHandler },
  archivio: { emoji: '📚', desc: 'domande sui documenti caricati: listini, prezzi, contratti, FAQ, brand voice, procedure', handler: archivioHandler },
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
  const system = `Sei Sirio, l'orchestratore di un team di agenti AI. Oggi è ${now} (Europe/Rome).
Il tuo UNICO compito è instradare la richiesta all'agente giusto. Agenti disponibili:
${toolList}

Regole:
- ${getKnowledge('sirio').join(' ')}
- Se la domanda riguarda informazioni contenute in documenti aziendali (prezzi, contratti, procedure), usa "archivio".
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
    try {
      reply = await AGENTS[r.agent].handler({ query: text, task: r.task_description });
    } catch (e) {
      console.error(`agente ${r.agent}:`, e.message);
      reply = `${AGENTS[r.agent].emoji} Ho avuto un problema tecnico: ${e.message}`;
    }
  }
  saveMemory(sessionKey, 'assistant', reply);
  return { agent: agentUsed, emoji: agentUsed ? AGENTS[agentUsed].emoji : '💬', reply };
}

// ---------- Handler dei singoli agenti ----------
// Ognuno consulta la propria knowledge base + i documenti (RAG) prima di agire.

// Contesto documentale, in forma breve, da appendere a una risposta
async function docsHint(query, agent) {
  try {
    const ctx = await rag.contextFor(query, { agent, k: 2 });
    if (!ctx.text) return '';
    return `\n📚 Dai tuoi documenti (${ctx.sources.join(', ')}): ${ctx.hits[0].text.slice(0, 220)}…`;
  } catch { return ''; }
}

async function stellaHandler({ query }) {
  const post = await content.generatePost({ topic: query, notify: false });
  return `⭐ Post pronto (in attesa di approvazione):\n"${post.hook}"\n${post.caption}`;
}

async function lunaHandler({ query }) {
  const base = accounting.report();
  const hint = await docsHint(query, 'luna');
  return base + hint;
}

async function soleHandler({ query, task }) {
  const parts = ['☀️'];
  if (google.isConfigured()) {
    try {
      const { events } = await google.todayEvents();
      parts.push(`Agenda di oggi:\n${google.formatEvents(events)}`);
    } catch (e) { parts.push(`Agenda non raggiungibile (${e.message}).`); }

    if (/mail|email|posta|inbox/i.test(`${query} ${task}`)) {
      try {
        const t = await google.triageEmails();
        parts.push(`\n📧 ${t.summary}\n${google.formatTriage(t.items)}`);
      } catch (e) { parts.push(`Gmail non raggiungibile (${e.message}).`); }
    }
  } else {
    parts.push(`Bozza pronta per: "${task}".\n(Collega Gmail e Calendar con \`npm run google:auth\` per lavorare sui dati veri.)`);
  }
  const hint = await docsHint(query, 'sole');
  return parts.join(' ') + hint;
}

async function cometaHandler({ task }) {
  return `☄️ Campagna impostata in bozza per: "${task}". (Serve il Business Manager Meta per attivarla.)`;
}

async function luceHandler({ query }) {
  const leads = db.prepare('SELECT COUNT(*) c FROM leads').get().c;
  const booked = db.prepare("SELECT COUNT(*) c FROM leads WHERE status='prenotato'").get().c;
  const hint = await docsHint(query, 'luce');
  return `💡 Lead totali: ${leads}, prenotati: ${booked}. Regole: ${getKnowledge('luce').join(' ')}${hint}`;
}

async function archivioHandler({ query }) {
  const r = await rag.ask(query);
  const src = r.sources?.length ? `\n\n📎 Fonti: ${r.sources.join(', ')}` : '';
  return `📚 ${r.answer}${src}`;
}
