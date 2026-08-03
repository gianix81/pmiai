# Guida al deploy — dal tuo PC alla produzione

Tre fasi: (1) metti il codice su GitHub, (2) fallo girare su un VPS, (3) collega il webhook Instagram sempre online.

---

## FASE 1 — Metti il progetto su GitHub

Hai già un repo Git inizializzato (con il primo commit). Devi solo collegarlo a GitHub.

1. Crea un repo vuoto su [github.com/new](https://github.com/new) (es. `sistema-ai`), **senza** README.
2. Nel terminale, dentro la cartella del progetto:

```bash
git remote add origin https://github.com/TUO-UTENTE/sistema-ai.git
git branch -M main
git push -u origin main
```

Da qui in poi, ogni modifica:

```bash
git add .
git commit -m "descrizione della modifica"
git push
```

> Il file `.env` **non** viene caricato (è nel `.gitignore`): i tuoi segreti restano solo sul server. Giusto così.

---

## FASE 2 — Fai girare il sistema su un VPS

Serve un server sempre acceso. Opzioni economiche: **Hetzner** (~4 €/mese), **Contabo**, **Hostinger VPS**, o il **free tier di Oracle Cloud**.

### Opzione A — con Docker (consigliata, più semplice)

Sul VPS (Ubuntu):

```bash
# 1. installa Docker
curl -fsSL https://get.docker.com | sh

# 2. clona il progetto
git clone https://github.com/TUO-UTENTE/sistema-ai.git
cd sistema-ai

# 3. crea il file .env dai valori d'esempio e compilalo
cp .env.example .env
nano .env        # metti chiavi AI, token Meta, DRY_RUN=false quando sei pronto

# 4. avvia (build + run in background, si riavvia da solo)
docker compose up -d --build
```

Il sistema gira su `http://IP_DEL_VPS:3000`. Per aggiornarlo dopo un push:

```bash
git pull && docker compose up -d --build
```

### Opzione B — senza Docker (Node + PM2)

```bash
# installa Node 22 e PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
sudo npm install -g pm2

git clone https://github.com/TUO-UTENTE/sistema-ai.git && cd sistema-ai
npm install
cp .env.example .env && nano .env

# avvia e rendi persistente ai riavvii del server
pm2 start src/server.js --name sistema-ai
pm2 save && pm2 startup
```

---

## FASE 3 — Webhook Instagram sempre online (HTTPS)

Meta richiede un URL **HTTPS pubblico** per il webhook. Due strade:

### Strada semplice — Cloudflare Tunnel (gratis, no dominio necessario)

```bash
# sul VPS
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
cloudflared tunnel --url http://localhost:3000
```

Ti dà un URL tipo `https://qualcosa.trycloudflare.com`. Il tuo webhook sarà:
`https://qualcosa.trycloudflare.com/webhook/instagram`

> Per un URL fisso e professionale, collega un tuo dominio a Cloudflare e crea un tunnel nominato (gratis anche quello).

### Strada classica — Nginx + Let's Encrypt (con dominio tuo)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d api.tuodominio.com
```

Poi configura Nginx come reverse proxy verso `localhost:3000` (esempio nel README della guida principale).

### Registra il webhook su Meta

Nella tua Meta Developer App → Webhooks → Instagram:
- **Callback URL**: `https://.../webhook/instagram`
- **Verify Token**: lo stesso valore di `META_VERIFY_TOKEN` nel tuo `.env`
- **Subscribe fields**: `comments`, `messages`, `mentions`

Se la verifica va a buon fine, Meta chiama il tuo server e riceve indietro `hub.challenge` (già gestito dal codice).

---

## Checklist go-live

- [ ] Codice su GitHub, `.env` **non** committato
- [ ] VPS attivo, container/PM2 in `restart: always`
- [ ] `.env` compilato: provider AI reale, token Meta, `DRY_RUN=false`
- [ ] Backup automatico della cartella `data/` (il database)
- [ ] Webhook HTTPS verificato su Meta
- [ ] App Meta in modalità **Live** + permessi in Advanced Access
- [ ] Test: un commento con keyword genera davvero un DM

---

## Backup del database

Il DB è un solo file: `data/sistema.db`. Backup giornaliero:

```bash
# esempio: copia datata in una cartella di backup
cp data/sistema.db ~/backup/sistema-$(date +%F).db
```

Per non perdere nulla, imposta un cron o un rsync verso uno storage esterno.
