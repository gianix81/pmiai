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

export const config = {
  port: Number(process.env.PORT || 3000),
  aiProvider: process.env.AI_PROVIDER || 'mock',
  ollama: { url: process.env.OLLAMA_URL || 'http://localhost:11434', model: process.env.OLLAMA_MODEL || 'llama3.1' },
  gemini: { key: process.env.GEMINI_API_KEY || '', model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' },
  openai: { key: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' },
  meta: {
    verifyToken: process.env.META_VERIFY_TOKEN || 'changeme',
    pageToken: process.env.META_PAGE_TOKEN || '',
    igBusinessId: process.env.IG_BUSINESS_ID || '',
  },
  dryRun: (process.env.DRY_RUN || 'true') === 'true',
  maxDmPerHour: Number(process.env.MAX_DM_PER_HOUR || 180),
};
