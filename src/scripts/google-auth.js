// Autorizzazione Google una tantum → ottieni il GOOGLE_REFRESH_TOKEN da mettere nel .env.
// Uso:  npm run google:auth
//
// Prima di lanciarlo (5 minuti, gratis):
// 1. console.cloud.google.com → crea un progetto
// 2. "API e servizi" → Abilita: Gmail API e Google Calendar API
// 3. "Schermata consenso OAuth" → Esterna → aggiungi te stesso fra gli utenti di test
// 4. "Credenziali" → ID client OAuth → tipo "Applicazione web"
//    URI di reindirizzamento autorizzato:  http://localhost:5599/oauth/callback
// 5. Copia Client ID e Client Secret nel .env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
import http from 'node:http';
import { config } from '../config.js';
import { authUrl, exchangeCode, SCOPES } from '../modules/google.js';

const PORT = 5599;
const REDIRECT = `http://localhost:${PORT}/oauth/callback`;

if (!config.google.clientId || !config.google.clientSecret) {
  console.error('\n❌ Mancano GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nel .env.');
  console.error('   Segui i 5 passi scritti in cima a questo file.\n');
  process.exit(1);
}

const url = authUrl(REDIRECT);
console.log('\n== AUTORIZZAZIONE GOOGLE (sola lettura) ==');
console.log(`Permessi richiesti:\n  - ${SCOPES.join('\n  - ')}`);
console.log('\n1) Apri questo link nel browser e accetta:\n');
console.log(url);
console.log(`\n2) Resto in ascolto su ${REDIRECT} …\n`);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth/callback')) { res.writeHead(404).end(); return; }
  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h3>Codice mancante.</h3>');
    return;
  }
  try {
    const tok = await exchangeCode(code, REDIRECT);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h2>✅ Fatto. Torna al terminale e copia il refresh token nel .env.</h2>');
    console.log('✅ Autorizzazione riuscita. Aggiungi al .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tok.refresh_token || '(non ricevuto: revoca l\'accesso e riprova)'}\n`);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<h3>Errore: ${e.message}</h3>`);
    console.error('❌', e.message);
  } finally {
    setTimeout(() => { server.close(); process.exit(0); }, 500);
  }
});
server.listen(PORT);
