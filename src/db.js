// Database SQLite locale (un solo file, zero server esterni)
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'sistema.db'));
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

-- memoria conversazionale dell'orchestratore (session_key = chat_id Telegram)
CREATE TABLE IF NOT EXISTS conversation_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT,
  role TEXT,                                 -- user | assistant
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- knowledge base / policy per agente (consultata prima di agire, editabile a runtime)
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT,                                -- sirio(globale) | sole | stella | luna | cometa | luce
  content TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ========== RAG: documenti lunghi + chunk vettorializzati ==========
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER DEFAULT 1,
  agent TEXT DEFAULT 'sirio',                -- a quale agente serve (sirio = tutti)
  title TEXT,
  source TEXT,                               -- nome file / URL / "manuale"
  chars INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER,
  agent TEXT DEFAULT 'sirio',
  client_id INTEGER DEFAULT 1,
  ord INTEGER DEFAULT 0,
  text TEXT,
  dims INTEGER,
  model TEXT,
  embedding BLOB,                            -- Float32Array serializzato
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_agent ON chunks(agent);

-- ========== LUNA: prima nota / movimenti bancari ==========
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER DEFAULT 1,
  date TEXT,                                 -- ISO yyyy-mm-dd
  description TEXT,
  amount REAL,                               -- positivo = entrata, negativo = uscita
  category TEXT DEFAULT 'da_categorizzare',
  kind TEXT,                                 -- entrata | uscita
  source TEXT,                               -- nome file estratto conto
  hash TEXT UNIQUE,                          -- anti-duplicato (data+desc+importo)
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);

-- scadenze fiscali/pagamenti da ricordare (usate nel morning brief)
CREATE TABLE IF NOT EXISTS deadlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER DEFAULT 1,
  due_date TEXT,
  label TEXT,
  amount REAL,
  status TEXT DEFAULT 'aperta',              -- aperta|pagata|annullata
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Knowledge di default
if (db.prepare('SELECT COUNT(*) n FROM knowledge').get().n === 0) {
  const k = db.prepare('INSERT INTO knowledge (agent, content) VALUES (?,?)');
  k.run('sirio', 'Agenzia: Sirio Media House. Tono diretto e concreto. Non promettere risultati garantiti.');
  k.run('luce', 'Non fare mai cold DM di massa. Rispetta i limiti Meta (1 DM/utente/24h).');
  k.run('luna', 'Segnala sempre scadenze e incassi mancanti. Numeri sempre in euro.');
  k.run('sole', 'Non inviare mai email o inviti senza approvazione umana. Riassumi, non decidere.');
}

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
