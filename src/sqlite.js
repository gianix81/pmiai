// Adattatore SQLite — nessuna compilazione richiesta.
//
// Perché esiste: `better-sqlite3` è un modulo nativo e su Windows con Node
// recenti spesso non trova i binari precompilati, quindi pretende Visual Studio.
// Node 22.5+ ha SQLite DENTRO il runtime (`node:sqlite`): stesso motore, zero build.
//
// Qui esponiamo la piccola API di better-sqlite3 che il progetto usa davvero
// (prepare/run/get/all, exec, transaction) sopra `node:sqlite`, con fallback a
// `better-sqlite3` se qualcuno gira su Node vecchi.

let impl = null;

// `node:sqlite` è marcato "sperimentale" e stampa un avviso a ogni avvio:
// è solo rumore, il motore è lo stesso SQLite di sempre. Lo silenziamo.
const emit = process.emit;
process.emit = function (name, data, ...rest) {
  if (name === 'warning' && data?.name === 'ExperimentalWarning' && /SQLite/i.test(data.message || '')) return false;
  return emit.call(this, name, data, ...rest);
};

// --- 1° scelta: SQLite integrato in Node (nessuna dipendenza) ---
try {
  const { DatabaseSync } = await import('node:sqlite');
  impl = { kind: 'node:sqlite', DatabaseSync };
} catch { /* Node < 22.5: si prova il modulo nativo */ }

// --- fallback: better-sqlite3, se installato ---
if (!impl) {
  try {
    const mod = await import('better-sqlite3');
    impl = { kind: 'better-sqlite3', Database: mod.default };
  } catch {
    throw new Error(
      'Nessun motore SQLite disponibile.\n' +
      'Aggiorna Node alla 22.5 o superiore (consigliato: https://nodejs.org)\n' +
      'oppure installa better-sqlite3 con un compilatore C++ presente.'
    );
  }
}

export const engine = impl.kind;

export function openDatabase(file) {
  if (impl.kind === 'better-sqlite3') {
    const db = new impl.Database(file);
    db.pragma('journal_mode = WAL');
    return db;
  }

  const raw = new impl.DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');

  return {
    engine: 'node:sqlite',
    raw,
    exec: (sql) => raw.exec(sql),
    // node:sqlite non accetta `undefined` come parametro: lo normalizziamo a null,
    // e i boolean a 0/1 — così il codice dei moduli resta identico.
    prepare(sql) {
      const st = raw.prepare(sql);
      return {
        run: (...a) => st.run(...clean(a)),
        get: (...a) => st.get(...clean(a)),
        all: (...a) => st.all(...clean(a)),
      };
    },
    // Stessa firma di better-sqlite3: db.transaction(fn) -> funzione da chiamare.
    transaction(fn) {
      return (...args) => {
        raw.exec('BEGIN');
        try {
          const out = fn(...args);
          raw.exec('COMMIT');
          return out;
        } catch (e) {
          try { raw.exec('ROLLBACK'); } catch { }
          throw e;
        }
      };
    },
    pragma: (p) => raw.exec(`PRAGMA ${p}`),
    close: () => raw.close(),
  };
}

function clean(args) {
  return args.map(v => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}
