// Astrazione AI: un'unica interfaccia, provider intercambiabile.
// "mock" funziona SENZA chiavi (per test). Gli altri richiedono setup.
//
// Novità v0.2:
//  - timeout + retry con backoff (429 / 5xx / rete)
//  - fallback automatico al mock se il provider fallisce (il sistema non si ferma mai)
//  - embeddings (per il RAG) con lo stesso schema di provider
//  - contatori/diagnostica esposti da aiStatus()
import { config } from './config.js';

// ---------- Diagnostica ----------
const stats = { calls: 0, ok: 0, retries: 0, failures: 0, fallbacks: 0, lastError: null };
export function aiStatus() {
  return { provider: config.aiProvider, model: modelName(), embedModel: embedModelName(), ...stats };
}
function modelName() {
  const p = config.aiProvider;
  if (p === 'gemini') return config.gemini.model;
  if (p === 'openai') return config.openai.model;
  if (p === 'ollama') return config.ollama.model;
  return 'mock';
}
function embedModelName() {
  const p = config.embedProvider;
  if (p === 'gemini') return config.gemini.embedModel;
  if (p === 'openai') return config.openai.embedModel;
  if (p === 'ollama') return config.ollama.embedModel;
  return 'locale (hashing)';
}

// ---------- Utility di rete ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, options, { timeout = config.ai.timeoutMs, label = 'ai' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) {
      const err = new Error(`${label} HTTP ${r.status}: ${text.slice(0, 300)}`);
      err.status = r.status;
      throw err;
    }
    try { return JSON.parse(text); } catch { return { _raw: text }; }
  } finally {
    clearTimeout(t);
  }
}

// Ritenta su errori temporanei (429 rate limit, 5xx, timeout/rete).
function retryable(e) {
  if (e?.name === 'AbortError') return true;
  if (e?.status === 429) return true;
  if (e?.status >= 500) return true;
  if (!e?.status) return true; // errore di rete
  return false;
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 0; attempt <= config.ai.retries; attempt++) {
    try {
      const out = await fn();
      stats.ok++;
      return out;
    } catch (e) {
      lastErr = e;
      stats.lastError = `${label}: ${e.message}`;
      if (attempt < config.ai.retries && retryable(e)) {
        stats.retries++;
        const wait = config.ai.retryBaseMs * Math.pow(2, attempt);
        if (config.ai.verbose) console.warn(`  [AI] ${label} fallito (${e.message.slice(0, 120)}) → riprovo tra ${wait}ms`);
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  stats.failures++;
  throw lastErr;
}

// ---------- COMPLETE: testo (di norma JSON) ----------
async function complete(system, user) {
  stats.calls++;
  const p = config.aiProvider;
  if (p === 'mock') return mock(user);

  try {
    if (p === 'ollama') return await withRetry(() => ollama(system, user), 'ollama');
    if (p === 'gemini') return await withRetry(() => gemini(system, user), 'gemini');
    if (p === 'openai') return await withRetry(() => openai(system, user), 'openai');
    return mock(user);
  } catch (e) {
    if (config.ai.fallbackMock) {
      stats.fallbacks++;
      console.error(`  [AI] ${p} non disponibile (${String(e.message).slice(0, 160)}) → uso il mock per non bloccare il sistema.`);
      return mock(user);
    }
    throw e;
  }
}

// ---------- MOCK (nessuna chiave, genera output plausibile) ----------
function mock(user) {
  // Caso ORCHESTRATORE (routing): riconosce il prompt "Instrada (JSON)"
  if (/Instrada \(JSON\)/i.test(user)) {
    const q = (user.match(/RICHIESTA:\s*([^\n]+)/i) || [, ''])[1].toLowerCase();
    let agent = null;
    if (/(document|listino|prezzi|prezzo|tariff|contratt|faq|procedur|policy|manuale|brand voice|archivio)/.test(q)) agent = 'archivio';
    else if (/(post|carosell|reel|contenut|social|caption)/.test(q)) agent = 'stella';
    else if (/(incass|spes|fattur|contabil|prima nota|scadenz|iva|guadagn|bilanci|cashflow|estratto conto)/.test(q)) agent = 'luna';
    else if (/(mail|email|agenda|appuntament|promemoria|calendar|ricerca|prenota\w* volo|hotel)/.test(q)) agent = 'sole';
    else if (/(campagn|ads|adv|pubblicit|sponsor|meta ads|budget)/.test(q)) agent = 'cometa';
    else if (/(lead|contatt|dm|qualific|vendit|call|cliente)/.test(q)) agent = 'luce';
    if (!agent) return JSON.stringify({ agent: null, task_description: '', direct_reply: 'Ciao! Dimmi cosa ti serve: contenuti, lead, contabilità, ads o assistente.' });
    return JSON.stringify({ agent, task_description: q, direct_reply: '' });
  }
  // Caso CATEGORIZZAZIONE MOVIMENTI (Luna)
  if (/Categorizza \(JSON\)/i.test(user)) {
    const rows = user.split('\n').filter(l => /^\d+\|/.test(l));
    return JSON.stringify({
      items: rows.map(l => {
        const parts = l.split('|');
        return { id: Number(parts[0]), category: guessCategory(parts.slice(1).join(' ')), note: '' };
      })
    });
  }
  // Caso RISPOSTA CON CONTESTO RAG
  if (/Rispondi usando SOLO il CONTESTO/i.test(user)) {
    const ctx = (user.split('CONTESTO:')[1] || '').split('DOMANDA:')[0].trim();
    if (!ctx) return JSON.stringify({ answer: 'Non ho documenti su questo argomento.', sources: [] });
    return JSON.stringify({ answer: ctx.split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 500), sources: [] });
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
  const topic = (user.match(/tema[:\s"]+([^"\n]+)/i) || [, 'novità'])[1].trim();
  return JSON.stringify({
    hook: `Smetti di ignorare ${topic}: ecco perché conta`,
    caption: `Molti sottovalutano ${topic}, ma è ciò che separa chi cresce da chi resta fermo. In 3 punti: 1) parti da un obiettivo chiaro, 2) misura ciò che conta, 3) sii costante. Salva questo post per non dimenticarlo.`,
    hashtags: ['#crescita', '#strategia', `#${topic.replace(/\s+/g, '').toLowerCase()}`],
    cta: 'Scrivici "INFO" per saperne di più.'
  });
}

// Euristica di categorizzazione (usata dal mock e come rete di sicurezza da Luna)
export function guessCategory(desc = '') {
  const d = String(desc).toLowerCase();
  if (/(bonifico in entrata|incasso|accredito|pagamento cliente|fattura n|pos |vendita|saldo fattura)/.test(d)) return 'ricavi';
  if (/(f24|agenzia entrate|iva|imposta|tass|inps|contribut)/.test(d)) return 'tasse e contributi';
  if (/(affitto|locazione|canone locazione)/.test(d)) return 'affitto';
  if (/(enel|eni|luce|gas|acqua|tim|vodafone|wind|fastweb|utenz|bolletta)/.test(d)) return 'utenze';
  if (/(ads|advertis|sponsorizz|campagna|pubblicit)/.test(d)) return 'pubblicità';
  if (/(google|meta |facebook|adobe|canva|openai|aws|hosting|dominio|abbonamento|saas|microsoft|apple|notion|figma)/.test(d)) return 'software e abbonamenti';
  if (/(carburante|benzina|autostrad|taxi|treno|volo|hotel|trasfert)/.test(d)) return 'viaggi e trasferte';
  if (/(ristorante|bar |pranzo|cena|caffè)/.test(d)) return 'rappresentanza';
  if (/(commercialista|consulen|avvocato|notaio|professionist)/.test(d)) return 'consulenze';
  if (/(stipendio|salario|compenso collaborat|freelance)/.test(d)) return 'personale e collaboratori';
  if (/(commission|spese banca|canone conto|bollo|imposta di bollo)/.test(d)) return 'spese bancarie';
  return 'altro';
}

// ---------- OLLAMA (locale, gratis) ----------
async function ollama(system, user) {
  const j = await fetchJson(`${config.ollama.url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.ollama.model, prompt: `${system}\n\n${user}`, stream: false, format: 'json' }),
  }, { label: 'ollama' });
  return j.response || '{}';
}

// ---------- GEMINI (free tier) ----------
async function gemini(system, user) {
  if (!config.gemini.key) { const e = new Error('GEMINI_API_KEY mancante'); e.status = 401; throw e; }
  const url = `${config.gemini.base}/models/${config.gemini.model}:generateContent`;
  const j = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: config.ai.temperature },
    }),
  }, { label: 'gemini' });
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text).filter(Boolean).join('');
  if (!text) {
    const reason = j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || 'risposta vuota';
    throw new Error(`gemini: nessun testo (${reason})`);
  }
  return text;
}

// ---------- OPENAI (a pagamento) ----------
async function openai(system, user) {
  if (!config.openai.key) { const e = new Error('OPENAI_API_KEY mancante'); e.status = 401; throw e; }
  const j = await fetchJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openai.key}` },
    body: JSON.stringify({
      model: config.openai.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: config.ai.temperature,
    }),
  }, { label: 'openai' });
  return j?.choices?.[0]?.message?.content || '{}';
}

// ================= EMBEDDINGS (per il RAG) =================
// Ritorna un array di vettori (uno per testo). Senza chiavi usa embeddings
// locali deterministici: il RAG resta testabile e utilizzabile a costo zero.
export async function embed(texts = []) {
  const list = (Array.isArray(texts) ? texts : [texts]).map(t => String(t || ''));
  if (!list.length) return [];
  const p = config.embedProvider;
  try {
    if (p === 'gemini') return await withRetry(() => geminiEmbed(list), 'gemini-embed');
    if (p === 'openai') return await withRetry(() => openaiEmbed(list), 'openai-embed');
    if (p === 'ollama') return await withRetry(() => ollamaEmbed(list), 'ollama-embed');
  } catch (e) {
    if (!config.ai.fallbackMock) throw e;
    stats.fallbacks++;
    console.error(`  [AI] embeddings ${p} non disponibili (${String(e.message).slice(0, 140)}) → uso embeddings locali.`);
  }
  return list.map(localEmbed);
}

async function geminiEmbed(list) {
  if (!config.gemini.key) { const e = new Error('GEMINI_API_KEY mancante'); e.status = 401; throw e; }
  const url = `${config.gemini.base}/models/${config.gemini.embedModel}:batchEmbedContents`;
  const j = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.key },
    body: JSON.stringify({
      requests: list.map(t => ({
        model: `models/${config.gemini.embedModel}`,
        content: { parts: [{ text: t }] },
        outputDimensionality: config.rag.dims,
      })),
    }),
  }, { label: 'gemini-embed' });
  const out = (j.embeddings || []).map(e => e.values);
  if (out.length !== list.length) throw new Error('gemini-embed: numero di vettori inatteso');
  return out.map(normalize);
}

async function openaiEmbed(list) {
  if (!config.openai.key) { const e = new Error('OPENAI_API_KEY mancante'); e.status = 401; throw e; }
  const j = await fetchJson('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openai.key}` },
    body: JSON.stringify({ model: config.openai.embedModel, input: list, dimensions: config.rag.dims }),
  }, { label: 'openai-embed' });
  return (j.data || []).map(d => normalize(d.embedding));
}

async function ollamaEmbed(list) {
  const out = [];
  for (const t of list) {
    const j = await fetchJson(`${config.ollama.url}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.ollama.embedModel, prompt: t }),
    }, { label: 'ollama-embed' });
    out.push(normalize(j.embedding || []));
  }
  return out;
}

// Embedding locale deterministico ("hashing trick" su parole + bigrammi).
// Non è semanticamente potente come un modello vero, ma cattura la sovrapposizione
// lessicale: sufficiente per far funzionare e testare il RAG senza chiavi.
export function localEmbed(text = '') {
  const dims = config.rag.dims;
  const v = new Array(dims).fill(0);
  const words = String(text).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2);
  const grams = [...words];
  for (let i = 0; i < words.length - 1; i++) grams.push(words[i] + '_' + words[i + 1]);
  for (const g of grams) v[hash(g) % dims] += 1;
  return normalize(v);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Normalizzazione L2: così la similarità coseno è un semplice prodotto scalare.
export function normalize(vec = []) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  return vec.map(x => x / n);
}

export function cosine(a = [], b = []) {
  const len = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

// Helper: parsing sicuro del JSON restituito dal modello
export function safeJson(text, fallback = {}) {
  try { return JSON.parse(text); } catch {
    if (!text) return fallback;
    const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) { try { return JSON.parse(fenced[1]); } catch { } }
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { } }
    return fallback;
  }
}

export { complete };
