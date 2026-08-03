// Smoke test completo: esercita tutti i moduli e verifica lo stato finale.
import db from './db.js';
import * as content from './modules/content.js';
import * as ig from './modules/instagram.js';
import * as booking from './modules/booking.js';
import * as email from './modules/email.js';
import * as scheduler from './modules/scheduler.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${m}`); };
console.log('\n== SMOKE TEST ==');

// 1. Contenuti
const posts = await content.generateBatch(['tema uno', 'tema due'], 1);
ok(posts.length === 2 && posts[0].hook, 'Contenuti generati con voce di brand');

// 2. Comment-to-DM + guardrail
const r1 = await ig.handleEvent({ entry: [{ changes: [{ field: 'comments', value: { text: 'voglio info', from: { id: '900', username: 'lucia' } } }] }] });
ok(r1[0].action === 'dm_inviato', 'Comment-to-DM: DM inviato');
const r2 = await ig.handleEvent({ entry: [{ changes: [{ field: 'comments', value: { text: 'info', from: { id: '900', username: 'lucia' } } }] }] });
ok(r2[0].action === 'bloccato', 'Guardrail 24h: secondo DM bloccato');

// 3. Risposta lead -> setter -> qualifica + booking + email capture
await ig.handleEvent({ entry: [{ messaging: [{ sender: { id: '900' }, message: { text: 'gestisco una palestra, la mia email e lucia@gym.it' } }] }] });
const lead = db.prepare("SELECT * FROM leads WHERE ig_user_id='900'").get();
ok(lead.email === 'lucia@gym.it' && lead.consent === 1, 'Email del lead catturata (opt-in)');
ok(['qualificato', 'prenotato'].includes(lead.status), 'Setter: lead qualificato (poi prenotato)');
const bk = db.prepare('SELECT * FROM bookings WHERE lead_id=?').get(lead.id);
ok(!!bk, 'Booking creato dal setter (da confermare)');

// 4. Opt-out STOP
await ig.handleEvent({ entry: [{ messaging: [{ sender: { id: '900' }, message: { text: 'STOP' } }] }] });
ok(db.prepare('SELECT status FROM leads WHERE id=?').get(lead.id).status === 'stop', 'Opt-out STOP rispettato');

// 5. Approvazione post + scheduler pubblica
content.setStatus(posts[0].id, 'approvato');
await scheduler.publishDuePosts();
ok(db.prepare('SELECT status FROM posts WHERE id=?').get(posts[0].id).status === 'pubblicato', 'Scheduler: post approvato pubblicato (dry-run)');

// 6. Cold email con opt-out + limite
email.queue({ to: 'x@y.it', subject: 'test', body: 'ciao' });
const res = await email.processQueue();
ok(res.sent >= 1, 'Cold email inviata (dry-run) con opt-out in calce');

// 7. Multi-cliente
const info = db.prepare("INSERT INTO clients (name,brand_voice,keywords) VALUES ('Studio X','tono formale','[\"prenota\"]')").run();
const p2 = await content.generatePost({ clientId: info.lastInsertRowid, topic: 'novita', notify: false });
ok(p2.client_id === info.lastInsertRowid, 'Multi-cliente: post generato per il secondo cliente');

// 8. ORCHESTRATORE SIRIO — routing verso gli agenti
const orch = await import('./modules/orchestrator.js');
const r_stella = await orch.handle('sess1', 'creami un post su come trovare clienti');
ok(r_stella.agent === 'stella', 'Orchestratore instrada a Stella (contenuti)');
const r_luna = await orch.handle('sess1', 'quanto ho incassato questo mese?');
ok(r_luna.agent === 'luna', 'Orchestratore instrada a Luna (contabilità)');
const r_sole = await orch.handle('sess1', 'mandami una mail a Marco');
ok(r_sole.agent === 'sole', 'Orchestratore instrada a Sole (assistente)');
const r_cometa = await orch.handle('sess1', 'crea una campagna ads su Meta');
ok(r_cometa.agent === 'cometa', 'Orchestratore instrada a Cometa (ads)');
const r_luce = await orch.handle('sess1', 'quanti lead abbiamo?');
ok(r_luce.agent === 'luce', 'Orchestratore instrada a Luce (lead)');
const r_chat = await orch.handle('sess1', 'ciao come va');
ok(r_chat.agent === null, 'Orchestratore risponde diretto alla chiacchiera');
const mem = db.prepare("SELECT COUNT(*) c FROM conversation_memory WHERE session_key='sess1'").get().c;
ok(mem >= 12, 'Memoria conversazionale salvata per session_key');

// 9. PONTE MANYCHAT (Instagram senza App Review)
const mc1 = await ig.replyToText('mc_777', 'ciao voglio info');
ok(typeof mc1 === 'string' && mc1.length > 0, 'Ponte ManyChat: risposta generata per un contatto');
await ig.replyToText('mc_777', 'ho una palestra, la mia email e test@gym.it');
const mcLead = db.prepare("SELECT * FROM leads WHERE ig_user_id='mc_777'").get();
ok(mcLead && mcLead.email === 'test@gym.it' && mcLead.source === 'manychat', 'Ponte ManyChat: lead creato + email catturata');

// 10. LAYER AI: fallback, retry, parsing tollerante
const ai = await import('./ai.js');
ok(ai.safeJson('```json\n{"a":1}\n```').a === 1, 'AI: parsing JSON tollerante (blocchi markdown)');
ok(ai.safeJson('rumore {"b":2} coda').b === 2, 'AI: parsing JSON dentro testo sporco');
ok(ai.safeJson('non json', { fallback: true }).fallback === true, 'AI: fallback su risposta non parsabile');
const st = ai.aiStatus();
ok(typeof st.calls === 'number' && st.calls > 0, 'AI: diagnostica e contatori attivi');

// 11. 📚 RAG — ingest, retrieval, domanda sui documenti
const rag = await import('./modules/rag.js');
const listino = `Listino Sirio Media House 2026.
Pacchetto Base: setup 1.500 euro una tantum, poi 890 euro al mese. Include contenuti e un canale di lead.

Pacchetto Pro: setup 3.000 euro, poi 1.800 euro al mese. Include contenuti, comment-to-DM, setter AI e prenotazione call.

Pacchetto Premium: da 5.000 a 8.000 euro di setup, poi da 3.500 a 5.000 euro al mese. Include tutto il Pro piu campagne ads gestite e reportistica dedicata.

Politica di pagamento: fattura anticipata a inizio mese, bonifico a 15 giorni.`;
const doc = await rag.ingest({ title: 'Listino 2026', text: listino, agent: 'sirio', source: 'listino.txt' });
ok(doc.chunks >= 1, `RAG: documento indicizzato in ${doc.chunks} chunk`);

const hits = await rag.search('quanto costa il pacchetto Pro al mese?');
ok(hits.length > 0 && /Pro/i.test(hits[0].text), 'RAG: retrieval trova il passaggio giusto');

const brandDoc = await rag.ingest({
  title: 'Brand voice Luce', agent: 'luce', source: 'voce.txt',
  text: 'La voce di Luce nei DM e sempre diretta e cordiale. Mai piu di due domande per messaggio. Non usare mai emoji nelle prime risposte. Chiudi sempre proponendo una call di 15 minuti.'
});
const hitsLuce = await rag.search('come devo scrivere i DM?', { agent: 'luce' });
ok(hitsLuce.length > 0, 'RAG: filtro per agente (Luce vede i suoi documenti + i globali)');
ok(brandDoc.agent === 'luce', 'RAG: documento assegnato a un agente specifico');

const answer = await rag.ask('quanto costa il pacchetto Pro?');
ok(typeof answer.answer === 'string' && answer.answer.length > 0 && answer.sources.length > 0, 'RAG: risposta con citazione delle fonti');

const r_arch = await orch.handle('sess1', 'nei documenti, qual e il prezzo del listino Pro?');
ok(r_arch.agent === 'archivio' || /listino|pro/i.test(r_arch.reply), 'Orchestratore: le domande sui documenti vanno all\'archivio');

const stats = rag.ragStats();
ok(stats.documents >= 2 && stats.chunks >= 2, 'RAG: statistiche vector store coerenti');

// 12. 🌙 LUNA — estratto conto CSV, categorizzazione, cashflow, scadenze
const acc = await import('./modules/accounting.js');
ok(acc.parseAmount('1.234,56') === 1234.56, 'Luna: importo italiano 1.234,56 letto correttamente');
ok(acc.parseAmount('-1.234,56') === -1234.56 && acc.parseAmount('(45,00)') === -45, 'Luna: importi negativi e fra parentesi');
ok(acc.parseDate('05/03/2026') === '2026-03-05' && acc.parseDate('2026-03-05') === '2026-03-05', 'Luna: date in formato italiano e ISO');

const csv = [
  'Data;Descrizione;Importo',
  '02/03/2026;BONIFICO IN ENTRATA SALDO FATTURA 12 STUDIO ROSSI;2.440,00',
  '03/03/2026;ADDEBITO SDD ENEL ENERGIA BOLLETTA;-182,40',
  '05/03/2026;PAGAMENTO GOOGLE ADS CAMPAGNA MARZO;-350,00',
  '07/03/2026;CANONE LOCAZIONE UFFICIO MARZO;-700,00',
  '10/03/2026;F24 AGENZIA ENTRATE IVA TRIMESTRE;-1.120,00',
  '15/03/2026;BONIFICO IN ENTRATA ACCONTO CLIENTE BIANCHI;1.000,00',
  'riga;rotta',
].join('\n');
const imp = acc.importStatement({ csv, source: 'test.csv' });
ok(imp.imported === 6 && imp.skipped >= 1, `Luna: importati ${imp.imported} movimenti (righe rotte scartate)`);

const imp2 = acc.importStatement({ csv, source: 'test.csv' });
ok(imp2.imported === 0 && imp2.duplicates === 6, 'Luna: reimport dello stesso file non duplica nulla');

const csvDareAvere = [
  'Data operazione,Causale,Entrate,Uscite',
  '20/03/2026,INCASSO POS GIORNATA,320.50,',
  '21/03/2026,COMMISSIONI BANCARIE TRIMESTRALI,,15.00',
].join('\n');
const imp3 = acc.importStatement({ csv: csvDareAvere, source: 'banca2.csv' });
ok(imp3.imported === 2, 'Luna: formato con colonne Entrate/Uscite separate');

const cat = await acc.categorizePending({});
ok(cat.categorized === 8 && cat.pending === 0, 'Luna: tutti i movimenti categorizzati');
const iva = db.prepare("SELECT category FROM transactions WHERE description LIKE '%F24%'").get();
ok(iva.category === 'tasse e contributi', 'Luna: F24 classificato come tasse e contributi');
const ads = db.prepare("SELECT category FROM transactions WHERE description LIKE '%GOOGLE ADS%'").get();
ok(ads.category === 'pubblicità', 'Luna: Google Ads classificato come pubblicità');

const sum = acc.summary({});
ok(Math.round(sum.entrate) === 3761 && Math.round(sum.uscite) === 2367, `Luna: cashflow entrate ${acc.eur(sum.entrate)} / uscite ${acc.eur(sum.uscite)}`);
ok(sum.byMonth.length >= 1 && sum.byCategory.length >= 4, 'Luna: aggregati per mese e per categoria');

const domani = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
acc.addDeadline({ due_date: domani, label: 'F24 mensile', amount: 620 });
ok(acc.upcomingDeadlines(7).length === 1, 'Luna: scadenza registrata e in arrivo entro 7 giorni');
ok(/Report contabile/.test(acc.report()) && /F24 mensile/.test(acc.report()), 'Luna: report testuale con scadenze');

const r_luna2 = await orch.handle('sess2', 'fammi il punto su incassi e spese');
ok(/Report contabile/.test(r_luna2.reply), 'Orchestratore: Luna risponde con i numeri veri');

// 13. ☀️ SOLE — Google (degrado elegante se non configurato)
const goog = await import('./modules/google.js');
const gStatus = goog.isConfigured();
const ev = await goog.todayEvents();
ok(ev.configured === gStatus, `Sole: Google ${gStatus ? 'collegato' : 'non collegato'} — nessun crash`);
ok(goog.formatEvents([]) === 'nessun impegno', 'Sole: formattazione agenda vuota');
ok(goog.formatEvents([{ title: 'Call Rossi', start: '2026-03-05T10:00:00+01:00', location: 'Zoom' }]).includes('Call Rossi'),
  'Sole: formattazione evento con orario e luogo');
ok(goog.authUrl().includes('gmail.readonly') && goog.authUrl().includes('calendar.readonly'),
  'Sole: permessi Google richiesti solo in lettura');

// 14. MORNING BRIEF proattivo (Sole) — ora include scadenze di Luna
const brief = await import('./modules/briefing.js');
const txt = await brief.dailyBrief();
ok(typeof txt === 'string' && /brief di oggi/i.test(txt) && /Appuntamenti/i.test(txt), 'Morning brief di Sole generato con i dati reali');
ok(/F24 mensile/.test(txt), 'Morning brief include le scadenze contabili di Luna');

console.log('\nStato finale:',
  db.prepare(`SELECT (SELECT COUNT(*) FROM clients) clienti,(SELECT COUNT(*) FROM posts) post,
    (SELECT COUNT(*) FROM leads) lead,(SELECT COUNT(*) FROM bookings) booking,(SELECT COUNT(*) FROM emails) email,
    (SELECT COUNT(*) FROM documents) documenti,(SELECT COUNT(*) FROM chunks) chunk,
    (SELECT COUNT(*) FROM transactions) movimenti`).get());
console.log(`\n${fail ? '❌' : '✅'} ${pass} test superati, ${fail} falliti`);
console.log('== FINE ==\n');
process.exit(fail ? 1 : 0);
