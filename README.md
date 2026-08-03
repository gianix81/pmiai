# 🌟 Sirio — dipendenti artificiali self-hosted (zero tool a pagamento)

Progetto Node.js completo che sostituisce ManyChat, Buffer, GoHighLevel e SetSmart con codice che parla direttamente alle **API ufficiali gratuite**. Gira sul tuo PC o su un VPS. Database: un singolo file SQLite. Dipendenze: 3.

## Cosa fa — completo e testato (50 verifiche verdi)

- **Sirio (orchestratore)** — scrivi in linguaggio naturale (chat o Telegram) e Sirio **instrada all'agente giusto** (Sole/Stella/Luna/Cometa/Luce/Archivio), con memoria per conversazione, knowledge base e documenti consultati prima di agire, enum chiusi e whitelist chat_id.
- **⭐ Stella — contenuti** — l'AI genera post con la **voce di brand per cliente**, gate umano di approvazione, pubblicazione automatica allo slot previsto.
- **💡 Luce — lead** — **comment-to-DM** Instagram con guardrail Meta (1 DM/utente/24h, limite orario), firma `X-Hub-Signature-256`, cattura email + opt-out STOP; **AI setter** che qualifica e prenota la call.
- **☀️ Sole — assistente** — **morning brief proattivo** su Telegram + **Gmail e Google Calendar reali in sola lettura**: agenda del giorno e triage AI della posta (urgente / oggi / può aspettare / ignora).
- **🌙 Luna — contabilità** — carichi il **CSV dell'estratto conto** (qualsiasi banca), lei fa **prima nota, categorizzazione AI, cashflow per mese e categoria, scadenze**. Anti-duplicato incluso.
- **📚 Archivio (RAG)** — dai a Sirio **documenti lunghi** (listini, brand voice, FAQ, contratti): chunking + embeddings + vector store **dentro lo stesso SQLite**, con citazione delle fonti.
- **Cold email** — coda con limite giornaliero e opt-out automatico in calce.
- **Multi-cliente**, **approvazione da telefono** (Telegram), **sicurezza** (dashboard protetta, firma webhook, segreti solo nel `.env`).
- **AI mai bloccante** — timeout, retry con backoff e **fallback automatico** se il provider cade: il sistema continua a rispondere.

Tutto visibile nella **dashboard** su `http://localhost:3000` (login: `DASHBOARD_USER`/`DASHBOARD_PASS`).

## Avvio in 3 comandi

```bash
npm install
cp .env.example .env      # poi compila i valori
npm start                 # http://localhost:3000
```

Prova subito con dati demo e test automatico:

```bash
npm run seed              # popola contenuti, lead, prenotazione, email demo
npm test                  # smoke test: 50 verifiche su tutta la catena
npm run ai:check          # diagnostica: il provider AI e gli embeddings rispondono?
```

Di default `AI_PROVIDER=mock` e `DRY_RUN=true`: gira **senza chiavi e senza inviare nulla** davvero.

## Accendere l'AI vera (5 minuti, gratis)

1. Chiave gratuita su <https://aistudio.google.com/apikey>
2. Nel `.env`:
   ```
   AI_PROVIDER=gemini
   GEMINI_API_KEY=la_tua_chiave
   GEMINI_MODEL=gemini-2.5-flash
   ```
3. `npm run ai:check` → deve rispondere ✅ su generazione ed embeddings.

Alternativa 100% locale e offline: `AI_PROVIDER=ollama` (`ollama pull llama3.1 && ollama pull nomic-embed-text`).

Se il provider non risponde, Sirio **non si ferma**: ricade sul motore mock e lo scrive nei log (`AI_FALLBACK_MOCK=true`).

## Collegare Gmail + Calendar a Sole (sola lettura)

```bash
npm run google:auth       # apre il flusso OAuth e stampa il GOOGLE_REFRESH_TOKEN
```

Prima serve un progetto su Google Cloud con **Gmail API** e **Calendar API** abilitate e un ID client OAuth di tipo "Applicazione web" con redirect `http://localhost:5599/oauth/callback` (istruzioni passo-passo in cima a `src/scripts/google-auth.js`). I permessi richiesti sono **solo di lettura**: Sirio riassume, non scrive e non invia nulla.

## Usare Luna (contabilità)

1. Dalla banca esporta l'estratto conto in **CSV**.
2. Dashboard → tab **🌙 Contabilità** → trascina il file.
3. Luna importa (saltando i duplicati), categorizza con l'AI e mostra entrate/uscite/saldo, spese per categoria e scadenze.

Il parser gestisce i formati italiani più comuni: `Data;Descrizione;Importo` con importi `1.234,56`, oppure colonne separate `Entrate`/`Uscite` (o `Dare`/`Avere`), date `gg/mm/aaaa` o ISO, righe di intestazione prima della tabella.

## Usare l'Archivio (RAG)

Dashboard → tab **📚 Documenti** → incolla o carica un `.txt`/`.md` (listino, brand voice, FAQ, procedure), scegli a quale agente serve (`tutti` = conoscenza globale) e indicizza. Poi puoi chiedere a Sirio *"cosa dice il listino sul pacchetto Pro?"* e ricevere la risposta **con le fonti**.

Con `AI_PROVIDER=mock` gli embeddings sono **locali** (hashing lessicale): funziona ma coglie solo le parole in comune. Con Gemini/OpenAI diventa **semantico** (trova anche i sinonimi). C'è comunque una rete di sicurezza a parole chiave se i vettori non trovano nulla.

## Configurazione (nel `.env`)

| Cosa | Variabili | Come averlo |
|---|---|---|
| AI | `AI_PROVIDER` + chiave | `gemini` (free tier) o `ollama` (locale gratis) |
| Embeddings/RAG | `EMBED_PROVIDER`, `RAG_*` | segue AI_PROVIDER; `local` = senza chiavi |
| Instagram | `META_*`, `IG_BUSINESS_ID` | Meta Developer App + App Review, oppure ponte ManyChat |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | @BotFather (gratis) |
| Google (Sole) | `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` | `npm run google:auth` |
| Cold email | `SMTP_*` | il tuo dominio via Google/Brevo |
| Dashboard | `DASHBOARD_USER/PASS` | scegli tu |

## Cosa devi fare TU (quello che il codice non può fare da solo)

1. **Collegare Instagram** — **(B, veloce)** ponte **ManyChat** che chiama `POST /webhook/manychat` con `{user_input, contact_id}` e rimanda `$.output` — niente App Review, live in <2h (~15 €/mese); **(A)** Meta app tua, gratis ma con App Review ~20 giorni.
2. **Token e chiavi** — AI (Gemini), Telegram, Google, SMTP, eventuale Meta: li generi tu e li metti nel `.env`.
3. **Un dominio + VPS** — dominio ~10 €/anno, VPS ~5 €/mese (o gira sul tuo PC).
4. **Mettere `DRY_RUN=false`** quando sei pronto a inviare/pubblicare davvero.

Finché non fai queste, tutto gira in **dry-run** (logga invece di inviare) — utile per provarlo senza rischi.

## API principali

| Metodo | Endpoint | Cosa fa |
|---|---|---|
| POST | `/api/chat` | parla con Sirio (orchestratore) |
| POST | `/api/posts/generate` | genera un post (o un batch) |
| POST | `/webhook/manychat` | ponte Instagram senza App Review |
| POST | `/api/accounting/import` | carica un CSV estratto conto (body `text/csv`) |
| GET | `/api/accounting/summary` · `/report` | cashflow e report di Luna |
| POST | `/api/documents` · `/api/documents/ask` | indicizza un documento · chiedi ai documenti |
| GET | `/api/google/events` · `/triage` | agenda di oggi · triage email |
| GET | `/api/brief` · POST `/api/brief/send` | morning brief di Sole |
| GET | `/api/health` | stato completo (AI, RAG, conteggi) |

## Struttura

```
src/
  server.js          Express + auth + avvio scheduler/telegram
  config.js          legge .env + readiness()
  db.js              SQLite (clients, posts, leads, messages, bookings, emails,
                     dm_log, conversation_memory, knowledge, documents, chunks,
                     transactions, deadlines)
  ai.js              astrazione AI (mock/ollama/gemini/openai) + retry/fallback + embeddings
  modules/
    orchestrator.js  🌟 il router Sirio (agenti come tool + memoria + KB + RAG)
    content.js       ⭐ Stella — contenuti + voce di brand
    instagram.js     💡 Luce — comment-to-DM + guardrail + firma + ponte ManyChat
    setter.js        qualifica AI -> booking
    booking.js       slot + prenotazioni
    email.js         cold email + limite giornaliero + opt-out
    telegram.js      approvazione dal telefono (polling)
    knowledge.js     regole brevi per agente
    rag.js           📚 chunking + embeddings + vector store + ask con fonti
    accounting.js    🌙 Luna — CSV estratto conto, prima nota, cashflow, scadenze
    google.js        ☀️ Sole — Gmail + Calendar (sola lettura) + triage AI
    briefing.js      ☀️ morning brief proattivo
    scheduler.js     pubblica post + smaltisce coda email + brief
  public/index.html  dashboard (7 tab)
  scripts/
    ai-check.js      diagnostica provider AI + embeddings
    google-auth.js   OAuth una tantum -> refresh token
  seed.js            dati demo
  test.js            smoke test (npm test) — 50 verifiche
```

Vedi **DEPLOY.md** per portarlo online (GitHub → VPS → webhook).

> Compliance: usa **solo** l'API ufficiale Instagram o ManyChat. Mai automazioni che chiedono la password: contro le regole Meta = ban.
> I permessi Google sono in sola lettura. Gate umano su tutto ciò che si pubblica o si invia.
