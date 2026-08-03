# Sistema AI — Social + Lead + Booking (self-hosted, zero tool a pagamento)

Scheletro completo in Node.js che sostituisce i tool a pagamento (ManyChat, Buffer, GoHighLevel, SetSmart) con codice che parla direttamente alle **API ufficiali gratuite**. Gira sul tuo computer o su un VPS.

## Cosa fa (i 3 motori)

- **Contenuti** — genera post/caption/hashtag con l'AI, li salva, gate umano di approvazione, pubblicazione via Graph API.
- **Comment-to-DM** — webhook Instagram: intercetta i commenti con keyword e risponde in DM, con i **guardrail di compliance Meta** (1 DM per utente/24h, limite orario).
- **AI Setter + Booking** — qualifica il lead in conversazione (score) e crea prenotazioni con gate umano.

Tutto è visibile in una **dashboard web** (mobile-friendly) su `http://localhost:3000`.

## Avvio in 3 comandi

```bash
npm install
cp .env.example .env      # poi compila i valori
npm start                 # apri http://localhost:3000
```

Per popolare dati demo e vedere subito la dashboard piena:

```bash
npm run seed
```

Di default `AI_PROVIDER=mock` e `DRY_RUN=true`: gira **senza chiavi e senza inviare nulla** davvero. Perfetto per provarlo.

## Costo reale

| Pezzo | Costo |
|---|---|
| Codice + database (SQLite) | 0 € |
| AI (Ollama locale) | 0 € · oppure Gemini free tier |
| Instagram Graph API | 0 € (richiede App Review Meta) |
| Calendario (collega Cal.com self-host) | 0 € |
| Hosting | gira sul tuo PC, o VPS ~5 €/mese, o free tier |
| Dominio (per email/credibilità) | ~10 €/anno |

## Configurazione AI

Cambia `AI_PROVIDER` nel `.env`:

- `mock` — nessuna chiave, output di test (default)
- `ollama` — modello locale gratis. Installa [Ollama](https://ollama.com), poi `ollama run llama3.1`
- `gemini` — free tier. Chiave da [aistudio.google.com](https://aistudio.google.com)
- `openai` — a pagamento

## Collegare Instagram (produzione)

1. Crea una Meta Developer App (tipo Business) + Business Verification.
2. Ottieni i permessi `instagram_manage_comments`, `instagram_manage_messages` (App Review, ~20 giorni).
3. Metti `META_PAGE_TOKEN` e `IG_BUSINESS_ID` nel `.env`, e `DRY_RUN=false`.
4. Registra il webhook su `https://tuodominio/webhook/instagram` con il `META_VERIFY_TOKEN` scelto.
   Per esporre il localhost in HTTPS gratis: **Cloudflare Tunnel** o `ngrok`.

## Struttura

```
src/
  server.js            Express: collega tutto
  config.js            legge .env
  db.js                SQLite (posts, leads, messages, bookings, dm_log)
  ai.js                astrazione AI (mock/ollama/gemini/openai)
  modules/
    content.js         MOTORE A — contenuti
    instagram.js       MOTORE B — comment-to-DM + guardrail + publish
    setter.js          MOTORE C1 — qualifica AI
    booking.js         MOTORE C2 — slot + prenotazioni
  public/index.html    dashboard
  seed.js              dati demo
```

## Prossimi pezzi da aggiungere

- Approvazione via Telegram (gate umano dal telefono)
- Cold email con SPF/DKIM/DMARC + warm-up
- Integrazione Cal.com reale per gli slot
- Multi-cliente (già predisposto: campo `client` nei post)
- Scheduler automatico dei post approvati (cron)

> Nota compliance: usa **solo** l'API ufficiale Instagram. Mai automazioni che chiedono la password: sono contro le regole Meta e portano al ban.
