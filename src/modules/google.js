// ☀️ SOLE — Gmail + Google Calendar in SOLA LETTURA.
// Zero dipendenze: parla direttamente alle API REST di Google con un refresh token.
// Se non è configurato, ogni funzione ritorna { configured:false } senza rompere nulla.
import { config } from '../config.js';
import { complete, safeJson } from '../ai.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export function isConfigured() {
  const g = config.google;
  return Boolean(g.clientId && g.clientSecret && g.refreshToken);
}

// ---------- access token (in cache finché valido) ----------
let cached = { token: null, exp: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const g = config.google;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: g.clientId, client_secret: g.clientSecret,
      refresh_token: g.refreshToken, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Google auth fallita: ${j.error_description || j.error || r.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function api(url) {
  const t = await accessToken();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google API ${r.status}: ${j?.error?.message || 'errore'}`);
  return j;
}

// ---------- CALENDAR ----------
export async function todayEvents({ dayOffset = 0 } = {}) {
  if (!isConfigured()) return { configured: false, events: [] };
  const start = new Date(); start.setDate(start.getDate() + dayOffset); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.google.calendarId)}/events`
    + `?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=25`;
  const j = await api(url);
  const events = (j.items || []).map(e => ({
    id: e.id,
    title: e.summary || '(senza titolo)',
    start: e.start?.dateTime || e.start?.date,
    allDay: !e.start?.dateTime,
    location: e.location || '',
    attendees: (e.attendees || []).length,
    link: e.htmlLink,
  }));
  return { configured: true, events };
}

export function formatEvents(events = []) {
  if (!events.length) return 'nessun impegno';
  return events.map(e => {
    const h = e.allDay ? 'tutto il giorno'
      : new Date(e.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    return `${h} — ${e.title}${e.location ? ' (' + e.location + ')' : ''}`;
  }).join('\n');
}

// ---------- GMAIL ----------
export async function recentEmails({ query = null, max = null } = {}) {
  if (!isConfigured()) return { configured: false, emails: [] };
  const q = query || config.google.gmailQuery;
  const n = max || config.google.maxEmails;
  const list = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${n}`);
  const ids = (list.messages || []).map(m => m.id);
  const emails = [];
  for (const id of ids) {
    const m = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`
      + `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const h = Object.fromEntries((m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
    emails.push({
      id,
      from: h.from || '',
      subject: h.subject || '(senza oggetto)',
      date: h.date || '',
      snippet: (m.snippet || '').slice(0, 220),
      link: `https://mail.google.com/mail/u/0/#inbox/${id}`,
    });
  }
  return { configured: true, emails };
}

// Triage AI: che cosa richiede una risposta oggi, cosa può aspettare, cosa ignorare.
export async function triageEmails({ query = null, max = null } = {}) {
  const { configured, emails } = await recentEmails({ query, max });
  if (!configured) return { configured: false, items: [] };
  if (!emails.length) return { configured: true, items: [], summary: 'Nessuna email nuova da smistare.' };

  const system = `Sei l'assistente di un imprenditore italiano. Smista le email.
Per ognuna assegna: priority ("urgente"|"oggi"|"puo_aspettare"|"ignora"),
reason (max 10 parole) e, se serve risposta, action (max 12 parole).
Rispondi SOLO con questo JSON: {"items":[{"id":"<id>","priority":"...","reason":"...","action":"..."}]}`;
  const lines = emails.map(e => `${e.id} | da: ${e.from} | oggetto: ${e.subject} | ${e.snippet}`).join('\n');
  const raw = await complete(system, `Email:\n${lines}\n\nSmista (JSON):`);
  const j = safeJson(raw, { items: [] });
  const byId = new Map((j.items || []).map(i => [String(i.id), i]));

  const RANK = { urgente: 0, oggi: 1, puo_aspettare: 2, ignora: 3 };
  const items = emails.map(e => {
    const t = byId.get(e.id) || {};
    const p = RANK[t.priority] != null ? t.priority : 'puo_aspettare';
    return { ...e, priority: p, reason: t.reason || '', action: t.action || '' };
  }).sort((a, b) => RANK[a.priority] - RANK[b.priority]);

  const urgenti = items.filter(i => i.priority === 'urgente').length;
  const oggi = items.filter(i => i.priority === 'oggi').length;
  return { configured: true, items, summary: `${items.length} email: ${urgenti} urgenti, ${oggi} da gestire oggi.` };
}

export function formatTriage(items = [], limit = 6) {
  const icon = { urgente: '🔴', oggi: '🟡', puo_aspettare: '⚪', ignora: '⚫' };
  return items.filter(i => i.priority !== 'ignora').slice(0, limit)
    .map(i => `${icon[i.priority]} ${i.subject} — ${shortFrom(i.from)}${i.action ? ' → ' + i.action : ''}`)
    .join('\n') || 'niente di urgente';
}

function shortFrom(from = '') {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from).trim().slice(0, 32);
}

// ---------- helper per lo script di autorizzazione ----------
export function authUrl(redirectUri = 'http://localhost:3000/oauth/callback') {
  const p = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code, redirectUri = 'http://localhost:3000/oauth/callback') {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'scambio codice fallito');
  return j; // contiene refresh_token
}
