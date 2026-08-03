// Smoke test completo: esercita tutti i moduli e verifica lo stato finale.
import db from './db.js';
import * as content from './modules/content.js';
import * as ig from './modules/instagram.js';
import * as booking from './modules/booking.js';
import * as email from './modules/email.js';
import * as scheduler from './modules/scheduler.js';

const ok = (c, m) => console.log(`${c ? '  ✅' : '  ❌'} ${m}`);
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
const pub = await scheduler.publishDuePosts();
ok(db.prepare('SELECT status FROM posts WHERE id=?').get(posts[0].id).status === 'pubblicato', 'Scheduler: post approvato pubblicato (dry-run)');

// 6. Cold email con opt-out + limite
email.queue({ to: 'x@y.it', subject: 'test', body: 'ciao' });
const res = await email.processQueue();
ok(res.sent >= 1, 'Cold email inviata (dry-run) con opt-out in calce');

// 7. Multi-cliente
const info = db.prepare("INSERT INTO clients (name,brand_voice,keywords) VALUES ('Studio X','tono formale','[\"prenota\"]')").run();
const p2 = await content.generatePost({ clientId: info.lastInsertRowid, topic: 'novita', notify: false });
ok(p2.client_id === info.lastInsertRowid, 'Multi-cliente: post generato per il secondo cliente');

// 8. ORCHESTRATORE SIRIO — routing verso i 5 agenti
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

console.log('\nStato finale:',
  db.prepare('SELECT (SELECT COUNT(*) FROM clients) c,(SELECT COUNT(*) FROM posts) p,(SELECT COUNT(*) FROM leads) l,(SELECT COUNT(*) FROM bookings) b,(SELECT COUNT(*) FROM emails) e').get());
console.log('== FINE ==\n');
