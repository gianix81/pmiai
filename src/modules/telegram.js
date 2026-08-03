// Approvazione dal telefono via Telegram (gratis, nessun URL pubblico: usa il polling).
import db from '../db.js';
import { config } from '../config.js';
import * as content from './content.js';
import * as booking from './booking.js';
import * as orchestrator from './orchestrator.js';

const API = t => `https://api.telegram.org/bot${config.telegram.token}/${t}`;
let offset = 0;

export function enabled() { return !!config.telegram.token && !!config.telegram.chatId; }

// Invia un messaggio con pulsanti inline
export async function send(text, buttons) {
  if (!enabled()) { console.log('[TELEGRAM off]', text); return; }
  const reply_markup = buttons ? { inline_keyboard: buttons } : undefined;
  await fetch(API('sendMessage'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.telegram.chatId, text, parse_mode: 'HTML', reply_markup }),
  }).catch(e => console.error('telegram send', e.message));
}

// Chiede l'approvazione di un post
export async function askPost(post) {
  await send(
    `📝 <b>Nuovo post da approvare</b>\n\n<b>${esc(post.hook)}</b>\n${esc(post.caption)}\n\n${(post.hashtags||[]).join(' ')}`,
    [[
      { text: '✅ Approva', callback_data: `post:approva:${post.id}` },
      { text: '❌ Scarta', callback_data: `post:scarta:${post.id}` },
    ]]
  );
}

// Chiede conferma di una prenotazione
export async function askBooking(b, lead) {
  await send(
    `📅 <b>Prenotazione da confermare</b>\nLead: @${esc(lead?.username || b.lead_id)}\nSlot: ${new Date(b.slot).toLocaleString('it-IT')}`,
    [[
      { text: '✅ Conferma', callback_data: `book:conferma:${b.id}` },
      { text: '❌ Rifiuta', callback_data: `book:rifiuta:${b.id}` },
    ]]
  );
}

// Polling: recupera gli aggiornamenti e gestisce i click sui pulsanti
export async function poll() {
  if (!enabled()) return;
  try {
    const r = await fetch(API(`getUpdates?timeout=0&offset=${offset}`)).then(r => r.json());
    for (const u of r.result || []) {
      offset = u.update_id + 1;
      if (u.callback_query) await onCallback(u.callback_query);
      else if (u.message && u.message.text) await onMessage(u.message);
    }
  } catch (e) { /* rete: riproverà al prossimo giro */ }
}

async function onCallback(cq) {
  const [kind, action, id] = (cq.data || '').split(':');
  let msg = 'Fatto';
  if (kind === 'post') {
    content.setStatus(Number(id), action === 'approva' ? 'approvato' : 'scartato', null, 'telegram');
    msg = action === 'approva' ? '✅ Post approvato (verrà pubblicato allo slot previsto)' : '❌ Post scartato';
  } else if (kind === 'book') {
    if (action === 'conferma') { booking.confirmBooking(Number(id)); msg = '✅ Prenotazione confermata'; }
    else { booking.setBookingStatus(Number(id), 'annullato'); msg = '❌ Prenotazione rifiutata'; }
  }
  // feedback all'utente
  await fetch(API('answerCallbackQuery'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: cq.id, text: msg }),
  }).catch(() => {});
  await send(msg);
}

// Messaggio di testo in arrivo -> orchestratore Sirio (con whitelist)
async function onMessage(msg) {
  const chatId = String(msg.chat.id);
  if (config.telegram.allowed.length && !config.telegram.allowed.includes(chatId)) {
    return; // non autorizzato: ignora (protegge i tuoi crediti AI)
  }
  if (/^\//.test(msg.text)) return; // ignora comandi tipo /start
  const out = await orchestrator.handle(chatId, msg.text);
  await send(`${out.emoji} ${out.reply}`);
}

// Avvia il polling periodico
export function startPolling(intervalMs = 3000) {
  if (!enabled()) { console.log('  Telegram: non configurato (approvazione via dashboard).'); return; }
  console.log('  Telegram: polling attivo.');
  setInterval(poll, intervalMs);
}

function esc(s) { return String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
