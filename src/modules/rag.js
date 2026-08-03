// 📚 RAG — memoria documentale di Sirio.
// Dai agli agenti conoscenza da documenti lunghi (listini, brand voice, FAQ, contratti)
// senza servizi esterni: chunking + embeddings + vector store dentro lo stesso SQLite.
//
// Perché non serve un vector DB: con qualche migliaio di chunk la ricerca "brute force"
// in memoria è istantanea (millisecondi). Si passa a pgvector solo oltre ~50k chunk.
import db from '../db.js';
import { config } from '../config.js';
import { embed, cosine, complete, safeJson } from '../ai.js';

// ---------- serializzazione vettori (Float32 compatto: 768 dims = 3 KB) ----------
function toBlob(vec) {
  const f = new Float32Array(vec);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}
function fromBlob(buf) {
  if (!buf) return [];
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  return Array.from(f);
}

// ---------- chunking: taglia sui paragrafi, con overlap per non spezzare il senso ----------
export function chunkText(text = '', size = config.rag.chunkChars, overlap = config.rag.chunkOverlap) {
  const clean = String(text).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const paras = clean.split(/\n\s*\n/);
  const chunks = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > size && buf) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - overlap)) + '\n\n' + p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
    // paragrafo singolo più lungo del chunk: spezzalo a forza
    while (buf.length > size * 1.6) {
      chunks.push(buf.slice(0, size).trim());
      buf = buf.slice(size - overlap);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(c => c.length > 20);
}

// ---------- INGEST: aggiungi un documento alla memoria ----------
export async function ingest({ title, text, agent = 'sirio', clientId = 1, source = 'manuale' } = {}) {
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error('Documento vuoto o troppo corto.');

  const info = db.prepare('INSERT INTO documents (client_id, agent, title, source, chars) VALUES (?,?,?,?,?)')
    .run(clientId, agent, title || source, source, String(text).length);
  const docId = info.lastInsertRowid;

  // embeddings a lotti (limite prudente per il free tier)
  const model = config.embedProvider;
  const insert = db.prepare(`INSERT INTO chunks (document_id, agent, client_id, ord, text, dims, model, embedding)
    VALUES (?,?,?,?,?,?,?,?)`);
  const BATCH = 20;
  let ord = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const vecs = await embed(slice);
    const tx = db.transaction(() => {
      slice.forEach((t, k) => {
        const v = vecs[k] || [];
        insert.run(docId, agent, clientId, ord++, t, v.length, model, toBlob(v));
      });
    });
    tx();
  }
  return { id: docId, title: title || source, chunks: chunks.length, agent };
}

// ---------- SEARCH: i k chunk più pertinenti ----------
export async function search(query, { agent = null, clientId = null, k = config.rag.topK } = {}) {
  if (!query || !String(query).trim()) return [];
  const total = db.prepare('SELECT COUNT(*) c FROM chunks').get().c;
  if (!total) return [];

  const [qv] = await embed([query]);
  let sql = 'SELECT id, document_id, agent, text, embedding FROM chunks';
  const where = [], args = [];
  // agent='sirio' = conoscenza globale, visibile a tutti
  if (agent) { where.push("(agent = ? OR agent = 'sirio')"); args.push(agent); }
  if (clientId) { where.push('client_id = ?'); args.push(clientId); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');

  const rows = db.prepare(sql).all(...args);
  const scored = rows.map(r => ({
    id: r.id, documentId: r.document_id, agent: r.agent, text: r.text,
    score: cosine(qv, fromBlob(r.embedding)),
  }));
  scored.sort((a, b) => b.score - a.score);
  let top = scored.filter(s => s.score >= config.rag.minScore).slice(0, k);

  // Rete di sicurezza lessicale: se i vettori non trovano nulla (tipico con gli
  // embeddings locali, che non colgono i sinonimi), cerca per parole chiave.
  if (!top.length) {
    const terms = tokens(query);
    if (terms.length) {
      const lex = rows.map(r => {
        const t = new Set(tokens(r.text));
        const matched = terms.filter(w => t.has(w)).length;
        return { id: r.id, documentId: r.document_id, agent: r.agent, text: r.text, score: matched / terms.length, lexical: true };
      }).filter(s => s.score >= 0.34).sort((a, b) => b.score - a.score);
      top = lex.slice(0, k);
    }
  }

  // arricchisci con il titolo del documento (per citare la fonte)
  const titles = new Map();
  for (const t of top) {
    if (!titles.has(t.documentId)) {
      const d = db.prepare('SELECT title FROM documents WHERE id=?').get(t.documentId);
      titles.set(t.documentId, d?.title || 'documento');
    }
    t.title = titles.get(t.documentId);
  }
  return top;
}

// Parole significative di un testo (senza accenti, senza stopword italiane)
const STOP = new Set(['come','cosa','quale','quali','della','delle','degli','sono','essere','deve','devo','dove','quando','perche','questo','questa','quello','quella','nella','nelle','negli','sul','sui','per','con','che','non','una','uno','del','dei','gli','più','piu','mio','mia','tuo','tua','fare','faccio','dei','alla','alle','agli']);
function tokens(s = '') {
  return [...new Set(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w)))];
}

// ---------- CONTEXT: blocco di testo pronto da iniettare nel prompt di un agente ----------
export async function contextFor(query, { agent = null, clientId = null, k = config.rag.topK } = {}) {
  const hits = await search(query, { agent, clientId, k });
  if (!hits.length) return { text: '', sources: [], hits: [] };
  const text = hits.map((h, i) => `[${i + 1}] (${h.title}) ${h.text}`).join('\n\n');
  const sources = [...new Set(hits.map(h => h.title))];
  return { text, sources, hits };
}

// ---------- ASK: domanda diretta ai documenti (risposta + fonti) ----------
export async function ask(question, { agent = null, clientId = null } = {}) {
  const ctx = await contextFor(question, { agent, clientId });
  if (!ctx.text) {
    return { answer: 'Non ho documenti che parlino di questo. Caricane uno con "Aggiungi documento".', sources: [] };
  }
  const system = `Sei l'archivio di conoscenza di Sirio Media House. Rispondi in italiano, breve e concreto.
Usa SOLO le informazioni del contesto. Se il contesto non basta, dillo apertamente.
Rispondi SOLO con questo JSON: {"answer":"<risposta>","sources":[<numeri dei passaggi usati>]}`;
  const raw = await complete(system, `Rispondi usando SOLO il CONTESTO.\n\nCONTESTO:\n${ctx.text}\n\nDOMANDA: ${question}`);
  const j = safeJson(raw, { answer: '', sources: [] });
  return {
    answer: j.answer || 'Non sono riuscito a formulare una risposta dai documenti.',
    sources: ctx.sources,
    used: ctx.hits.length,
  };
}

// ---------- gestione ----------
export function listDocuments() {
  return db.prepare(`SELECT d.*, (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) chunks
    FROM documents d ORDER BY d.id DESC`).all();
}

export function deleteDocument(id) {
  db.prepare('DELETE FROM chunks WHERE document_id=?').run(id);
  db.prepare('DELETE FROM documents WHERE id=?').run(id);
  return { deleted: id };
}

export function ragStats() {
  const d = db.prepare('SELECT COUNT(*) c FROM documents').get().c;
  const c = db.prepare('SELECT COUNT(*) c FROM chunks').get().c;
  const m = db.prepare('SELECT model, dims FROM chunks ORDER BY id DESC LIMIT 1').get();
  return { documents: d, chunks: c, model: m?.model || null, dims: m?.dims || config.rag.dims };
}
