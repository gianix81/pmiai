// Carica le variabili d'ambiente da .env (parser minimale, zero dipendenze)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const bool = (v, d) => (v == null || v === '' ? d : v === 'true');
const num = (v, d) => (v == null || v === '' ? d : Number(v));

const aiProvider = process.env.AI_PROVIDER || 'mock';

export const config = {
  port: num(process.env.PORT, 3000),

  // ---- AI ----
  aiProvider,
  // Provider per gli embeddings del RAG. Di default segue AI_PROVIDER
  // (ma con "mock"/"ollama-senza-embed" ricade sugli embeddings locali).
  embedProvider: process.env.EMBED_PROVIDER || (aiProvider === 'mock' ? 'local' : aiProvider),
  ai: {
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 30000),
    retries: num(process.env.AI_RETRIES, 2),
    retryBaseMs: num(process.env.AI_RETRY_BASE_MS, 800),
    temperature: num(process.env.AI_TEMPERATURE, 0.7),
    // Se il provider vero fallisce, ricadi sul mock invece di far crashare il sistema.
    fallbackMock: bool(process.env.AI_FALLBACK_MOCK, true),
    verbose: bool(process.env.AI_VERBOSE, false),
  },
  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.1',
    embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
  },
  gemini: {
    base: process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta',
    key: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    embedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
  },
  openai: {
    key: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    embedModel: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
  },

  // ---- RAG ----
  rag: {
    dims: num(process.env.RAG_DIMS, 768),        // dimensione dei vettori
    chunkChars: num(process.env.RAG_CHUNK_CHARS, 1100),
    chunkOverlap: num(process.env.RAG_CHUNK_OVERLAP, 180),
    topK: num(process.env.RAG_TOP_K, 4),
    minScore: num(process.env.RAG_MIN_SCORE, 0.12), // sotto questa soglia = non pertinente
  },

  meta: {
    verifyToken: process.env.META_VERIFY_TOKEN || 'changeme',
    appSecret: process.env.META_APP_SECRET || '',
    pageToken: process.env.META_PAGE_TOKEN || '',
    igBusinessId: process.env.IG_BUSINESS_ID || '',
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    // whitelist: solo questi chat_id possono usare l'orchestratore (sicurezza: bot pubblico)
    allowed: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean),
  },
  smtp: {
    host: process.env.SMTP_HOST || '', port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@example.com',
    dailyLimit: num(process.env.EMAIL_DAILY_LIMIT, 25),
  },

  // ---- Google (Sole: Gmail + Calendar, SOLA LETTURA) ----
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    // etichette/filtri Gmail per il triage (query in sintassi Gmail)
    gmailQuery: process.env.GMAIL_QUERY || 'is:unread newer_than:2d -category:promotions -category:social',
    maxEmails: num(process.env.GMAIL_MAX, 15),
  },

  dashboard: { user: process.env.DASHBOARD_USER || 'admin', pass: process.env.DASHBOARD_PASS || 'cambiami' },
  dryRun: bool(process.env.DRY_RUN, true),
  maxDmPerHour: num(process.env.MAX_DM_PER_HOUR, 180),
  briefHour: num(process.env.BRIEF_HOUR, 7), // ora del morning brief di Sole
};

// Motore SQLite in uso (informativo: non deve far fallire il config)
let dbEngine = 'sconosciuto';
try { dbEngine = (await import('./sqlite.js')).engine; } catch { }

// Riepilogo di cosa è attivo (mostrato all'avvio)
export function readiness() {
  return {
    ai: config.aiProvider === 'mock' ? "mock (configura una chiave per l'AI vera)" : `${config.aiProvider} · ${config.aiProvider === 'gemini' ? config.gemini.model : config.aiProvider === 'openai' ? config.openai.model : config.ollama.model}`,
    embeddings: config.embedProvider === 'local' ? 'locali (nessuna chiave)' : config.embedProvider,
    instagram: config.meta.pageToken ? 'collegato' : 'non collegato (serve token Meta)',
    telegram: config.telegram.token ? 'attivo' : 'non attivo (serve bot token)',
    email: config.smtp.host ? 'attivo' : 'non attivo (serve SMTP)',
    google: config.google.refreshToken ? 'collegato (Gmail+Calendar sola lettura)' : 'non collegato (npm run google:auth)',
    database: dbEngine,
    dryRun: config.dryRun,
  };
}
