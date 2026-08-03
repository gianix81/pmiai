# Sistema AI — Social + Lead + Booking (self-hosted, zero tool a pagamento)

Progetto Node.js completo che sostituisce ManyChat, Buffer, GoHighLevel e SetSmart con codice che parla direttamente alle **API ufficiali gratuite**. Gira sul tuo PC o su un VPS.

## Cosa fa — completo e testato

- **Contenuti** — l'AI genera post con la **voce di brand per cliente**, gate umano di approvazione, pubblicazione automatica allo slot previsto (scheduler).
- **Comment-to-DM** — webhook Instagram con **guardrail Meta** (1 DM/utente/24h, limite orario), verifica **firma X-Hub-Signature-256**, cattura email + opt-out STOP.
- **AI Setter + Booking** — qualifica il lead in conversazione, crea la prenotazione, chiede conferma su **Telegram**.
- **Cold email** — coda con **limite giornaliero** (deliverability) e **opt-out** automatico in calce.
- **Multi-cliente** — ogni cliente ha voce di brand, keyword e template propri.
- **Approvazione da telefono** — bot **Telegram** con pulsanti Approva/Scarta/Conferma.
- **Sicurezza** — dashboard protetta da password, firma webhook, segreti solo nel `.env`.

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
npm test                  # smoke test: 10 verifiche su tutta la catena
```

Di default `AI_PROVIDER=mock` e `DRY_RUN=true`: gira **senza chiavi e senza inviare nulla** davvero.

## Risultato del test (`npm test`)

```
✅ Contenuti generati con voce di brand
✅ Comment-to-DM: DM inviato
✅ Guardrail 24h: secondo DM bloccato
✅ Email del lead catturata (opt-in)
✅ Setter: lead qualificato (poi prenotato)
✅ Booking creato dal setter
✅ Opt-out STOP rispettato
✅ Scheduler: post approvato pubblicato
✅ Cold email inviata con opt-out
✅ Multi-cliente: post per il secondo cliente
```

## Configurazione (nel `.env`)

| Cosa | Variabili | Come averlo |
|---|---|---|
| AI | `AI_PROVIDER` + chiave | `ollama` (locale gratis) o `gemini` (free tier) |
| Instagram | `META_*`, `IG_BUSINESS_ID` | Meta Developer App + App Review |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | @BotFather (gratis) |
| Cold email | `SMTP_*` | il tuo dominio via Google/Brevo |
| Dashboard | `DASHBOARD_USER/PASS` | scegli tu |

## Cosa devi fare TU (le 4 cose che il codice non può fare da solo)

Il codice è completo. Restano solo le azioni che richiedono i **tuoi account**:

1. **App Review Meta** — gratis ma obbligatoria per Instagram in produzione (~20 giorni).
2. **Token e chiavi** — Meta, AI, SMTP, Telegram: li generi tu e li metti nel `.env`.
3. **Un dominio + VPS** — dominio ~10 €/anno, VPS ~5 €/mese (o gira sul tuo PC).
4. **Mettere `DRY_RUN=false`** quando sei pronto a inviare/pubblicare davvero.

Finché non fai queste, tutto gira in **dry-run** (logga invece di inviare) — utile per provarlo senza rischi.

## Struttura

```
src/
  server.js          Express + auth + avvio scheduler/telegram
  config.js          legge .env + readiness()
  db.js              SQLite (clients, posts, leads, messages, bookings, emails, dm_log)
  ai.js              astrazione AI (mock/ollama/gemini/openai)
  modules/
    content.js       contenuti + voce di brand
    instagram.js     comment-to-DM + guardrail + firma + publish
    setter.js        qualifica AI -> booking
    booking.js       slot + prenotazioni
    email.js         cold email + limite giornaliero + opt-out
    telegram.js      approvazione dal telefono (polling)
    scheduler.js     pubblica post + smaltisce coda email
  public/index.html  dashboard
  seed.js            dati demo
  test.js            smoke test (npm test)
```

Vedi **DEPLOY.md** per portarlo online (GitHub → VPS → webhook).

> Compliance: usa **solo** l'API ufficiale Instagram. Mai automazioni che chiedono la password: contro le regole Meta = ban.
