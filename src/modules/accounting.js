// 🌙 LUNA — contabilità: estratto conto → prima nota → cashflow → scadenze.
// Importa un CSV bancario (qualsiasi banca: il parser si adatta), categorizza i
// movimenti con l'AI (con euristica di sicurezza) e produce report leggibili.
import db from '../db.js';
import crypto from 'node:crypto';
import { complete, safeJson, guessCategory } from '../ai.js';

// ================= PARSING CSV =================
// Le banche italiane esportano con separatori e formati diversi: qui li normalizziamo.

function detectDelimiter(line) {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ';';
}

// Splitta una riga CSV rispettando le virgolette
function splitRow(line, delim) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === delim && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Importo in formato italiano ("1.234,56" / "-1.234,56" / "(1.234,56)") o inglese
export function parseAmount(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[€$\s]/g, '');
  if (/^-/.test(s)) { neg = true; s = s.slice(1); }
  if (/^\+/.test(s)) s = s.slice(1);
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56
  else if (lastDot > lastComma) s = s.replace(/,/g, '');                  // 1,234.56
  else s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

// Data in dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd → ISO yyyy-mm-dd
export function parseDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// Trova l'indice di colonna il cui header contiene una delle parole chiave
function findCol(headers, keys) {
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (!h) continue;
    if (keys.some(k => h.includes(k))) return i;
  }
  return -1;
}

export function parseStatement(csv) {
  const lines = String(csv).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], skipped: 0 };

  // molte banche mettono righe di intestazione prima della tabella: cerca la riga header vera
  let headerIdx = 0, delim = detectDelimiter(lines[0]);
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const d = detectDelimiter(lines[i]);
    const cells = splitRow(lines[i], d).map(norm);
    if (cells.some(c => /^data|^date/.test(c)) && cells.some(c => /importo|amount|dare|avere|entrat|uscit|addebit|accredit/.test(c))) {
      headerIdx = i; delim = d; break;
    }
  }

  const headers = splitRow(lines[headerIdx], delim);
  const cDate = findCol(headers, ['data contabile', 'data valuta', 'data operazione', 'data', 'date']);
  const cDesc = findCol(headers, ['descrizione', 'causale', 'operazione', 'description', 'dettagli', 'memo']);
  const cAmount = findCol(headers, ['importo', 'amount', 'valore']);
  const cIn = findCol(headers, ['entrate', 'accrediti', 'avere', 'credit']);
  const cOut = findCol(headers, ['uscite', 'addebiti', 'dare', 'debit']);

  const rows = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitRow(lines[i], delim);
    if (cells.length < 2) { skipped++; continue; }

    const date = parseDate(cDate >= 0 ? cells[cDate] : cells[0]);
    let description = (cDesc >= 0 ? cells[cDesc] : cells.slice(1, -1).join(' ')) || '';
    description = description.replace(/\s+/g, ' ').trim();

    let amount = null;
    if (cAmount >= 0) amount = parseAmount(cells[cAmount]);
    if (amount == null && (cIn >= 0 || cOut >= 0)) {
      const inc = cIn >= 0 ? parseAmount(cells[cIn]) : null;
      const out = cOut >= 0 ? parseAmount(cells[cOut]) : null;
      if (inc) amount = Math.abs(inc);
      else if (out) amount = -Math.abs(out);
    }
    if (amount == null) {
      // ultimo tentativo: la prima cella numerica plausibile partendo da destra
      for (let k = cells.length - 1; k >= 0; k--) {
        const n = parseAmount(cells[k]);
        if (n != null && n !== 0) { amount = n; break; }
      }
    }

    if (!date || amount == null || !description) { skipped++; continue; }
    rows.push({ date, description, amount });
  }
  return { rows, skipped };
}

// ================= IMPORT =================
const hashOf = (r) => crypto.createHash('sha1').update(`${r.date}|${r.description}|${r.amount}`).digest('hex');

export function importStatement({ csv, source = 'estratto-conto.csv', clientId = 1 } = {}) {
  const { rows, skipped } = parseStatement(csv);
  const ins = db.prepare(`INSERT OR IGNORE INTO transactions
    (client_id, date, description, amount, kind, category, source, hash) VALUES (?,?,?,?,?,?,?,?)`);
  let imported = 0, duplicates = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const h = hashOf(r);
      const info = ins.run(clientId, r.date, r.description, r.amount,
        r.amount >= 0 ? 'entrata' : 'uscita', 'da_categorizzare', source, h);
      if (info.changes) imported++; else duplicates++;
    }
  });
  tx();
  return { parsed: rows.length, imported, duplicates, skipped, source };
}

// ================= CATEGORIZZAZIONE =================
const CATEGORIES = [
  'ricavi', 'tasse e contributi', 'affitto', 'utenze', 'software e abbonamenti',
  'pubblicità', 'viaggi e trasferte', 'rappresentanza', 'consulenze',
  'personale e collaboratori', 'spese bancarie', 'attrezzatura', 'altro',
];

export async function categorizePending({ limit = 60, clientId = null } = {}) {
  let sql = "SELECT id, date, description, amount FROM transactions WHERE category='da_categorizzare'";
  const args = [];
  if (clientId) { sql += ' AND client_id=?'; args.push(clientId); }
  sql += ' ORDER BY id LIMIT ?'; args.push(limit);
  const pending = db.prepare(sql).all(...args);
  if (!pending.length) return { categorized: 0, pending: 0 };

  const system = `Sei il contabile di una PMI italiana. Classifica ogni movimento bancario
in UNA di queste categorie (usa esattamente queste stringhe): ${CATEGORIES.join(', ')}.
Gli importi positivi sono entrate, i negativi uscite. Rispondi SOLO con questo JSON:
{"items":[{"id":<id>,"category":"<categoria>","note":"<max 6 parole, opzionale>"}]}`;
  const lines = pending.map(t => `${t.id}|${t.date}|${t.description}|${t.amount.toFixed(2)}`).join('\n');
  const raw = await complete(system, `Movimenti (id|data|descrizione|importo):\n${lines}\n\nCategorizza (JSON):`);
  const j = safeJson(raw, { items: [] });

  const byId = new Map((j.items || []).map(i => [Number(i.id), i]));
  const upd = db.prepare('UPDATE transactions SET category=?, note=? WHERE id=?');
  let n = 0;
  const tx = db.transaction(() => {
    for (const t of pending) {
      const got = byId.get(t.id);
      // rete di sicurezza: se l'AI sbaglia o non risponde, usa l'euristica
      let cat = got && CATEGORIES.includes(String(got.category).toLowerCase())
        ? String(got.category).toLowerCase()
        : guessCategory(t.description);
      if (t.amount > 0 && cat === 'altro') cat = 'ricavi';
      upd.run(cat, got?.note || null, t.id);
      n++;
    }
  });
  tx();
  const left = db.prepare("SELECT COUNT(*) c FROM transactions WHERE category='da_categorizzare'").get().c;
  return { categorized: n, pending: left };
}

// ================= REPORT =================
const eur = (n) => `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export { eur };

export function summary({ from = null, to = null, clientId = null } = {}) {
  const where = [], args = [];
  if (from) { where.push('date >= ?'); args.push(from); }
  if (to) { where.push('date <= ?'); args.push(to); }
  if (clientId) { where.push('client_id = ?'); args.push(clientId); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount END),0) entrate,
      COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END),0) uscite,
      COUNT(*) movimenti FROM transactions${w}`).get(...args);
  const byCategory = db.prepare(`SELECT category, COUNT(*) n, SUM(amount) totale
      FROM transactions${w} GROUP BY category ORDER BY SUM(amount)`).all(...args);
  const byMonth = db.prepare(`SELECT substr(date,1,7) mese,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount END),0) entrate,
      COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END),0) uscite
      FROM transactions${w} GROUP BY substr(date,1,7) ORDER BY mese DESC LIMIT 12`).all(...args);

  return { ...totals, saldo: totals.entrate - totals.uscite, byCategory, byMonth };
}

// Testo pronto per Telegram / chat
export function report({ from = null, to = null, clientId = null } = {}) {
  const s = summary({ from, to, clientId });
  if (!s.movimenti) return '🌙 Nessun movimento caricato. Carica un estratto conto CSV dalla dashboard (tab Contabilità).';

  const top = s.byCategory.filter(c => c.totale < 0).slice(0, 5)
    .map(c => `   · ${c.category}: ${eur(-c.totale)}`).join('\n');
  const mese = s.byMonth[0];
  const dl = upcomingDeadlines(30);
  const pending = db.prepare("SELECT COUNT(*) c FROM transactions WHERE category='da_categorizzare'").get().c;

  return [
    `🌙 Report contabile (${s.movimenti} movimenti)`,
    `• Entrate: ${eur(s.entrate)}`,
    `• Uscite: ${eur(s.uscite)}`,
    `• Saldo: ${eur(s.saldo)}`,
    mese ? `• Ultimo mese (${mese.mese}): +${eur(mese.entrate)} / -${eur(mese.uscite)}` : '',
    top ? `• Prime voci di spesa:\n${top}` : '',
    pending ? `⚠️ ${pending} movimenti da categorizzare.` : '',
    dl.length ? `📅 Scadenze entro 30 giorni:\n${dl.map(d => `   · ${d.due_date} ${d.label}${d.amount ? ' — ' + eur(d.amount) : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

export function listTransactions({ limit = 200, category = null, clientId = null } = {}) {
  const where = [], args = [];
  if (category) { where.push('category = ?'); args.push(category); }
  if (clientId) { where.push('client_id = ?'); args.push(clientId); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  args.push(limit);
  return db.prepare(`SELECT * FROM transactions${w} ORDER BY date DESC, id DESC LIMIT ?`).all(...args);
}

// ================= SCADENZE =================
export function addDeadline({ due_date, label, amount = null, clientId = 1 } = {}) {
  const info = db.prepare('INSERT INTO deadlines (client_id, due_date, label, amount) VALUES (?,?,?,?)')
    .run(clientId, due_date, label, amount);
  return db.prepare('SELECT * FROM deadlines WHERE id=?').get(info.lastInsertRowid);
}

export function upcomingDeadlines(days = 30) {
  return db.prepare(`SELECT * FROM deadlines WHERE status='aperta'
    AND date(due_date) <= date('now', '+' || ? || ' days') ORDER BY due_date`).all(days);
}

export function setDeadlineStatus(id, status) {
  db.prepare('UPDATE deadlines SET status=? WHERE id=?').run(status, id);
  return db.prepare('SELECT * FROM deadlines WHERE id=?').get(id);
}
