// Astrazione AI: un'unica interfaccia, provider intercambiabile.
// "mock" funziona SENZA chiavi (per test). Gli altri richiedono setup.
import { config } from './config.js';

// Chiamata generica a un modello che restituisce testo, dato un prompt.
async function complete(system, user) {
  const p = config.aiProvider;
  if (p === 'mock') return mock(user);
  if (p === 'ollama') return ollama(system, user);
  if (p === 'gemini') return gemini(system, user);
  if (p === 'openai') return openai(system, user);
  return mock(user);
}

// ---------- MOCK (nessuna chiave, genera output plausibile) ----------
function mock(user) {
  // Caso ORCHESTRATORE (routing): riconosce il prompt "Instrada (JSON)"
  if (/Instrada \(JSON\)/i.test(user)) {
    const q = (user.match(/RICHIESTA:\s*([^\n]+)/i) || [, ''])[1].toLowerCase();
    let agent = null;
    if (/(post|carosell|reel|contenut|social|caption)/.test(q)) agent = 'stella';
    else if (/(incass|spes|fattur|contabil|prima nota|scadenz|iva|guadagn|bilanci)/.test(q)) agent = 'luna';
    else if (/(mail|email|agenda|appuntament|promemoria|calendar|ricerca|prenota\w* volo|hotel)/.test(q)) agent = 'sole';
    else if (/(campagn|ads|adv|pubblicit|sponsor|meta ads|budget)/.test(q)) agent = 'cometa';
    else if (/(lead|contatt|dm|qualific|vendit|call|cliente)/.test(q)) agent = 'luce';
    if (!agent) return JSON.stringify({ agent: null, task_description: '', direct_reply: 'Ciao! Dimmi cosa ti serve: contenuti, lead, contabilità, ads o assistente.' });
    return JSON.stringify({ agent, task_description: q, direct_reply: '' });
  }
  // Caso SETTER (qualifica lead): riconosce il prompt di conversazione
  if (/Conversazione:/i.test(user)) {
    const turns = (user.match(/lead:/gi) || []).length;
    if (turns >= 1) return JSON.stringify({
      reply: 'Perfetto, ho quel che serve. Ti propongo una call: ti va uno slot questa settimana?',
      qualified: true, score: 75, ask_booking: true,
    });
    return JSON.stringify({ reply: 'Ottimo! Qual è il tuo obiettivo principale e in che tempi?', qualified: false, score: 30, ask_booking: false });
  }
  // Caso CONTENUTI
  const topic = (user.match(/tema[:\s"]+([^"\n]+)/i) || [,'novità'])[1].trim();
  return JSON.stringify({
    hook: `Smetti di ignorare ${topic}: ecco perché conta`,
    caption: `Molti sottovalutano ${topic}, ma è ciò che separa chi cresce da chi resta fermo. In 3 punti: 1) parti da un obiettivo chiaro, 2) misura ciò che conta, 3) sii costante. Salva questo post per non dimenticarlo.`,
    hashtags: ['#crescita', '#strategia', `#${topic.replace(/\s+/g,'').toLowerCase()}`],
    cta: 'Scrivici "INFO" per saperne di più.'
  });
}

// ---------- OLLAMA (locale, gratis) ----------
async function ollama(system, user) {
  const r = await fetch(`${config.ollama.url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.ollama.model, prompt: `${system}\n\n${user}`, stream: false, format: 'json' }),
  });
  const j = await r.json();
  return j.response;
}

// ---------- GEMINI (free tier) ----------
async function gemini(system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

// ---------- OPENAI (a pagamento) ----------
async function openai(system, user) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openai.key}` },
    body: JSON.stringify({
      model: config.openai.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
    }),
  });
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || '{}';
}

// Helper: parsing sicuro del JSON restituito dal modello
export function safeJson(text, fallback = {}) {
  try { return JSON.parse(text); } catch {
    const m = text && text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return fallback;
  }
}

export { complete };
