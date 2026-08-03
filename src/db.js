// Database SQLite locale (un solo file, zero server esterni)
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'data', 'sistema.db'));
db.pragma('journal_mode = WAL');

db.exec(`
-- Clienti gestiti (multi-cliente): ognuno ha la sua voce di brand e le sue keyword
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  brand_voice TEXT,
  pillars TEXT,                            -- JSON array di pilastri
  keywords TEXT,                           -- JSON array keyword comment-to-DM
  dm_template TEXT,                         -- messaggio DM di risposta
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER DEFAULT 1,
  pillar TEXT, topic TEXT,
  hook TEXT, caption TEXT, hashtags TEXT, cta TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'da_approvare',       -- da_approvare|approvato|scartato|pubblicato|errore
  scheduled_at TEXT,
  published_at TEXT,
  approved_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER DEFAULT 1,
  ig_user_id TEXT, username TEXT,
  source TEXT, email TEXT,
  consent INTEGER DEFAULT 0,                -- opt-in email raccolto?
  status TEXT DEFAULT 'nuovo',              -- nuovo|in_qualifica|qualificato|scartato|prenotato|stop
  score INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, role TEXT, text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, slot TEXT,
  status TEXT DEFAULT 'da_confermare',       -- da_confermare|confermato|annullato|no_show
  created_at TEXT DEFAULT (datetime('now'))
);

-- log invii DM per far rispettare i limiti Meta (1/utente/24h, 200/h)
CREATE TABLE IF NOT EXISTS dm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ig_user_id TEXT, sent_at TEXT DEFAULT (datetime('now'))
);

-- coda cold email (per warm-up e limiti giornalieri)
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER DEFAULT 1,
  to_email TEXT, subject TEXT, body TEXT,
  status TEXT DEFAULT 'in_coda',             -- in_coda|inviata|errore|annullata
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- approvazioni in sospeso (mappa messaggio Telegram -> entità)
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,                                 -- post|booking
  ref_id INTEGER,
  status TEXT DEFAULT 'in_attesa',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Cliente demo di default
const c = db.prepare('SELECT COUNT(*) n FROM clients').get().n;
if (c === 0) {
  db.prepare(`INSERT INTO clients (name, brand_voice, pillars, keywords, dm_template)
    VALUES (?,?,?,?,?)`).run(
    'Demo',
    'Tono diretto e concreto, dai del tu, frasi brevi, zero gergo.',
    JSON.stringify(['educativo', 'dietro le quinte', 'prova sociale', 'promozione']),
    JSON.stringify(['info', 'guida', 'voglio']),
    'Ciao! Come promesso ecco le info. Dimmi il tuo obiettivo e ti guido. (Rispondi STOP per non ricevere altri messaggi.)'
  );
}

export default db;
