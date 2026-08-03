// Database SQLite locale (un solo file, zero server esterni)
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'data', 'sistema.db'));
db.pragma('journal_mode = WAL');

// Schema: contenuti, lead, conversazioni, prenotazioni, log DM (per i guardrail)
db.exec(`
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT DEFAULT 'demo',
  pillar TEXT,
  topic TEXT,
  hook TEXT,
  caption TEXT,
  hashtags TEXT,
  cta TEXT,
  status TEXT DEFAULT 'da_approvare',      -- da_approvare | approvato | scartato | pubblicato
  scheduled_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ig_user_id TEXT,
  username TEXT,
  source TEXT,                              -- keyword / canale d'ingresso
  email TEXT,
  status TEXT DEFAULT 'nuovo',              -- nuovo | in_qualifica | qualificato | scartato | prenotato
  score INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,
  role TEXT,                                -- lead | ai | agent
  text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,
  slot TEXT,
  status TEXT DEFAULT 'da_confermare',      -- da_confermare | confermato | annullato | no_show
  created_at TEXT DEFAULT (datetime('now'))
);

-- log invii DM per far rispettare i limiti Meta (1/utente/24h, 200/h)
CREATE TABLE IF NOT EXISTS dm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ig_user_id TEXT,
  sent_at TEXT DEFAULT (datetime('now'))
);
`);

export default db;
