// MOTORE C (parte 2) — Booking: propone slot e crea la prenotazione.
// Slot generati localmente; per il calendario reale collega Cal.com self-host (open-source) via API.
import db from '../db.js';

// Genera slot liberi nei prossimi giorni (feriali, 10:00-17:00)
export function getSlots(days = 5) {
  const slots = [];
  const now = new Date();
  for (let d = 1; d <= days && slots.length < 6; d++) {
    const day = new Date(now.getTime() + d * 864e5);
    if (day.getDay() === 0 || day.getDay() === 6) continue; // salta weekend
    for (const h of [10, 15]) {
      day.setHours(h, 0, 0, 0);
      slots.push(day.toISOString());
    }
  }
  return slots.slice(0, 6);
}

// Crea una prenotazione (stato "da_confermare": passa dal gate umano)
export function createBooking(leadId, slot) {
  const info = db.prepare('INSERT INTO bookings (lead_id, slot) VALUES (?,?)').run(leadId, slot);
  db.prepare('UPDATE leads SET status = ? WHERE id = ?').run('prenotato', leadId);
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
}

export function confirmBooking(id) {
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('confermato', id);
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

export function listBookings() {
  return db.prepare(`SELECT b.*, l.username FROM bookings b LEFT JOIN leads l ON l.id = b.lead_id ORDER BY b.id DESC`).all();
}
