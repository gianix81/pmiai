# 🌟 SIRIO — Brief di progetto (LEGGI QUESTO PER PRIMO)

> **Per la nuova sessione Cowork:** la cartella `pmiai/sistema-ai` è agganciata. Il codice è in `src/`. Leggi questo file per intero: contiene tutto (cos'è, cosa è fatto, cosa manca, come continuare). Poi puoi lavorare direttamente sui file.
>
> Ultimo aggiornamento: **3 agosto 2026** — versione `0.2.0` (50/50 test verdi).

---

## 1. Cos'è e chi

**Sirio** è un sistema di "dipendenti artificiali" in codice (Node.js, self-hosted, zero tool a pagamento obbligatori) per **Sirio Media House** (Giovanni). Obiettivo: creare — e poi **rivendere alle PMI** — un sistema AI che crea contenuti, genera lead, prenota appuntamenti e fa da assistente/contabile.

Filosofia: sostituire i tool a pagamento (ManyChat, Buffer, GoHighLevel, SetSmart) con codice che parla direttamente alle API ufficiali gratuite. L'AI può girare gratis in locale (Ollama) o con free tier (Gemini).

## 2. La costellazione Sirio (i nomi degli agenti)

**Sirio** = il sistema/orchestratore (la stella più luminosa che coordina). Sotto di lui:

| Nome | Ruolo | Stato |
|---|---|---|
| ☀️ **Sole** | Assistente: email, agenda, appuntamenti + morning brief proattivo | **Gmail + Calendar reali (sola lettura)** |
| ⭐ **Stella** | Contenuti & social: post, caption, caroselli, reel | testi ✅ · immagini/video ⛔ |
| 🌙 **Luna** | Contabilità: incassi, spese, prima nota, cashflow, scadenze | **completa da CSV estratto conto** |
| ☄️ **Cometa** | Campagne ads / marketing a pagamento | stub |
| 💡 **Luce** | Lead & vendite: DM, qualifica, prenotazione call | ✅ |
| 📚 **Archivio** | Domande sui documenti aziendali (RAG) | **nuovo** |

## 3. Cosa è GIÀ costruito e testato (50/50 test verdi con `npm test`)

### Nucleo (già c'era)
- 💬 **Orchestratore Sirio**: messaggio naturale → agente giusto. Classifier + `userQuery`+`task_description`, agenti come tool, memoria per session_key (chat_id), enum chiusi, data/ora iniettata, whitelist chat_id.
- ⭐ **Stella**: post con voce di brand per cliente, output JSON, gate umano di approvazione.
- 💡 **Luce**: comment-to-DM Instagram con guardrail Meta (1 DM/utente/24h, limite orario, opt-out STOP, cattura email), AI setter che qualifica e prenota. **Due strade Instagram**: (A) Meta app propria, (B) ponte ManyChat senza App Review via `POST /webhook/manychat`.
- ☀️ **Sole**: morning brief automatico su Telegram a un'ora impostabile.
- **Cold email** (SMTP + limite giornaliero + opt-out), **scheduler**, **approvazione via Telegram**, **knowledge base per agente**, **dashboard web**, **sicurezza**, **DRY_RUN=true** di default.

### Aggiunto in v0.2.0 (3 ago 2026)
- 🧠 **Layer AI production-ready** — modelli aggiornati (`gemini-2.5-flash`, `gemini-embedding-001`), timeout, **retry con backoff** su 429/5xx/rete, **fallback automatico al mock** se il provider cade (il sistema non si ferma mai), parsing JSON tollerante (blocchi markdown, testo sporco), contatori di diagnostica in `/api/health`, comando **`npm run ai:check`**.
- 📚 **RAG completo dentro SQLite** (`modules/rag.js`) — ingest documenti lunghi, chunking sui paragrafi con overlap, embeddings (Gemini/OpenAI/Ollama o **locali senza chiavi**), vector store in tabella `chunks` (Float32 compatto), ricerca coseno + **rete di sicurezza lessicale**, filtro per agente, `ask()` con **citazione delle fonti**. Nuovo agente **📚 Archivio** nell'orchestratore.
- 🌙 **Luna completa** (`modules/accounting.js`) — import **CSV estratto conto di qualsiasi banca** (rileva separatore, header sepolto, importi `1.234,56`, colonne Entrate/Uscite o Dare/Avere, date it/ISO), **anti-duplicato** via hash, **categorizzazione AI** su 13 categorie con euristica di sicurezza, **cashflow** per mese e categoria, **scadenze** (finiscono nel morning brief), report testuale pronto per Telegram.
- ☀️ **Sole collegato a Google** (`modules/google.js`) — Gmail + Calendar **in sola lettura**, zero dipendenze (REST + refresh token), **triage AI** della posta (urgente/oggi/può aspettare/ignora), agenda del giorno nel morning brief, **`npm run google:auth`** per ottenere il token in 2 minuti. Se non è configurato, degrada senza rompere nulla.
- 🖥 **Dashboard a 7 tab** — aggiunte **🌙 Contabilità** (drag&drop del CSV, KPI, movimenti, scadenze) e **📚 Documenti** (indicizza, chiedi, elimina).

### Struttura del codice
```
src/
  server.js          Express + auth + avvio scheduler/telegram
  config.js          legge .env (AI, RAG, Google, …) + readiness()
  db.js              SQLite (clients, posts, leads, messages, bookings, emails,
                     dm_log, conversation_memory, knowledge, documents, chunks,
                     transactions, deadlines)
  ai.js              astrazione AI + retry/fallback + embeddings + safeJson
  modules/
    orchestrator.js  🌟 router Sirio (agenti come tool + memoria + KB + RAG)
    content.js       ⭐ Stella
    instagram.js     💡 Luce (comment-to-DM, guardrail, ponte ManyChat)
    setter.js        qualifica AI -> booking
    booking.js       slot + prenotazioni
    email.js         cold email
    telegram.js      approvazioni + chat naturale con Sirio
    knowledge.js     regole brevi per agente
    rag.js           📚 chunking + embeddings + vector store + ask con fonti
    accounting.js    🌙 Luna — CSV, prima nota, cashflow, scadenze
    google.js        ☀️ Gmail + Calendar (sola lettura) + triage AI
    briefing.js      ☀️ morning brief proattivo
    scheduler.js     cron interni (post, email, brief)
  public/index.html  dashboard (7 tab)
  scripts/ai-check.js · google-auth.js
  seed.js · test.js  dati demo · smoke test (50 verifiche)
README.md            guida completa
DEPLOY.md            GitHub -> VPS -> webhook
```

### Comandi
```
npm install
npm run seed        # dati demo
npm test            # 50 verifiche ✅
npm start           # dashboard su http://localhost:3000 (login: admin / cambiami)
npm run ai:check    # il provider AI e gli embeddings rispondono?
npm run google:auth # collega Gmail + Calendar (sola lettura)
```

## 4. Cosa MANCA (roadmap aggiornata, in ordine di priorità)

1. **Accendere davvero Gemini** — il codice è pronto e testato: basta la chiave (gratis su aistudio.google.com/apikey) e due righe nel `.env`. Poi `npm run ai:check`. ⬅️ *dipende solo da Giovanni*
2. **Stella completa** — generazione immagini/caroselli (metodo Nano Banana + template Canva), montaggio video, auto-publish TikTok/YT/IG.
3. **Cometa completa** — creazione campagne Meta Ads via Marketing API.
4. **Luna, secondo giro** — lettura PDF/fatture elettroniche XML, riconciliazione fattura↔incasso, previsione cashflow a 90 giorni, export per il commercialista.
5. **Sole, secondo giro** — bozze di risposta email (con gate umano) e creazione eventi in calendario (oggi è sola lettura per sicurezza).
6. **Input vocale** su Telegram (Whisper) normalizzato a campo canonico.
7. **Deploy** su VPS (vedi DEPLOY.md) + webhook con Cloudflare Tunnel.
8. **Multi-tenant vero** — oggi il multi-cliente c'è sui contenuti/lead; per rivendere serve isolamento completo (dati, chiavi, dashboard per cliente).

## 5. Le cose che dipendono SOLO da Giovanni (il codice non può farle)

1. **Chiave Gemini** nel `.env` (5 minuti, gratis) → accende l'AI vera ovunque.
2. **Collegare Instagram**: strada B (ManyChat, veloce, no App Review, ~15€/mese) o A (Meta app propria, gratis ma App Review ~20 giorni).
3. **Progetto Google Cloud** (Gmail + Calendar API) → poi `npm run google:auth`.
4. **Altri token nel `.env`**: Telegram (@BotFather), SMTP, eventuale Meta.
5. **Dominio (~10€/anno) + VPS (~5€/mese)** — oppure gira sul suo PC.
6. **Mettere `DRY_RUN=false`** quando è pronto a inviare/pubblicare davvero.

## 6. Business & pricing (per rivendere il servizio)

- **Chi paga**: attività con alto valore-cliente (dentisti, avvocati, immobiliari, ristrutturazioni, palestre/PT premium, B2B). NON bar/piccolo retail a basso margine.
- **Pacchetti**: Base setup 1.500€ + 890€/mese · **Pro 3.000€ + 1.800€/mese** (di punta) · Premium 5-8k€ + 3.500-5.000€/mese.
- **Costi tuoi**: ~150€/mese struttura + ~125€/cliente. Margine 50-70%.
- **Modello**: ibrido (setup + retainer + bonus per appuntamento). Ancora di vendita: "costa meno di un dipendente e ti porta appuntamenti veri".
- **Nuova leva commerciale**: Luna (contabilità da estratto conto) e l'Archivio documentale sono i due pezzi che i concorrenti no-code non hanno — usali in demo.
- **Volume alternativo**: white-label GoHighLevel o prodotto self-service a basso prezzo.
- File di supporto già creati: `calcolatore-costi-prezzi.xlsx`, guida operativa, microsito 9:16.

## 7. Corsi digeriti (cosa ha prodotto ciascuno)

1. **Scibetta (dipendenti artificiali)** → architettura + nomi/ruoli degli agenti + **Luna** (il "Luca" del webinar).
2. **AppifyText (Tacchini)** → idea 2° servizio: gestionali/portali su misura (Baserow).
3. **Caroselli AI (Nano Banana)** → metodo immagini per Stella (da fare).
4. **n8n base + AI Foundations** → **l'orchestratore Sirio** (costruito).
5. **ManyChat (Yashika Jain)** → **Instagram senza App Review** (costruito, `/webhook/manychat`).
6. **Telegram morning brief (Aksa/MLtude)** → **Sole proattivo** (costruito, ora con agenda e posta reali).

## 8. Come continuare nella nuova sessione Cowork

1. La cartella `sistema-ai` è agganciata → hai accesso diretto ai file.
2. Leggi questo brief + `README.md`.
3. Verifica che tutto giri: `npm install && npm test` (deve dare **50 ✅**).
4. Prossimo passo consigliato: **mettere la chiave Gemini nel `.env`** e lanciare `npm run ai:check`. Da lì tutto il sistema (routing, contenuti, triage email, categorizzazione contabile, RAG semantico) passa da "plausibile" a "intelligente davvero".
5. Workflow git: dopo ogni modifica → `git add . && git commit -m "..." && git push` (repo GitHub: gianix81/pmiai).

---

### Regole d'oro (non dimenticarle)
- Instagram: **solo API ufficiale o ManyChat**. Mai tool che chiedono la password → ban.
- **Gate umano** su ciò che si pubblica/invia finché non c'è fiducia. Google è collegato in **sola lettura** apposta.
- **Contratto + DPA** coi clienti (GDPR: cliente = titolare, tu = responsabile). Disclaimer sui risultati e sui ban.
- Non automatizzare ciò che è più veloce a mano (l'automazione ha overhead).
- Non promettere "autopilota totale": il sistema amplifica, non sostituisce strategia e chiusura.
- Il `.env` non va **mai** committato (è già in `.gitignore`). Le chiavi restano solo lì.
