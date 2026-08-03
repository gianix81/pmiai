// Carica le variabili d'ambiente da .env (parser minimale, zero dipendenze)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const bool = (v, d) => (v == null ? d : v === 'true');

export const config = {
  port: Number(process.env.PORT || 3000),
  aiProvider: process.env.AI_PROVIDER || 'mock',
  ollama: { url: process.env.OLLAMA_URL || 'http://localhost:11434', model: process.env.OLLAMA_MODEL || 'llama3.1' },
  gemini: { key: process.env.GEMINI_API_KEY || '', model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' },
  openai: { key: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' },
  meta: {
    verifyToken: process.env.META_VERIFY_TOKEN || 'changeme',
    appSecret: process.env.META_APP_SECRET || '',
    pageToken: process.env.META_PAGE_TOKEN || '',
    igBusinessId: process.env.IG_BUSINESS_ID || '',
  },
  telegram: { token: process.env.TELEGRAM_BOT_TOKEN || '', chatId: process.env.TELEGRAM_CHAT_ID || '' },
  smtp: {
    host: process.env.SMTP_HOST || '', port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@example.com',
    dailyLimit: Number(process.env.EMAIL_DAILY_LIMIT || 25),
  },
  dashboard: { user: process.env.DASHBOARD_USER || 'admin', pass: process.env.DASHBOARD_PASS || 'cambiami' },
  dryRun: bool(process.env.DRY_RUN, true),
  maxDmPerHour: Number(process.env.MAX_DM_PER_HOUR || 180),
};

// Riepilogo di cosa è attivo (mostrato all'avvio)
export function readiness() {
  return {
    ai: config.aiProvider === 'mock' ? 'mock (configura una chiave per l\'AI vera)' : config.aiProvider,
    instagram: config.meta.pageToken ? 'collegato' : 'non collegato (serve token Meta)',
    telegram: config.telegram.token ? 'attivo' : 'non attivo (serve bot token)',
    email: config.smtp.host ? 'attivo' : 'non attivo (serve SMTP)',
    dryRun: config.dryRun,
  };
}
