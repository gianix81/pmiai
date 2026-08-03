// MOTORE C2 — Booking: slot e prenotazioni. Per il calendario reale collega Cal.com self-host.
import db from '../db.js';

export function getSlots(days = 5) {
  const slots = [];
  const now = new Date();
  for (let d = 1; d <= days && slots.length < 6; d++) {
    const day = new Date(now.getTime() + d * 864e5);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (const h of [10, 15]) { const s = new Date(day); s.setHours(h, 0, 0, 0); slots.push(s.toISOString()); }
  }
  return slots.slice(0, 6);
}

export function createBooking(leadId, slot) {
  const info = db.prepare('INSERT INTO bookings (lead_id, slot) VALUES (?,?)').run(leadId, slot);
  db.prepare("UPDATE leads SET status='prenotato' WHERE id=?").run(leadId);
  return db.prepare('SELECT * FROM bookings WHERE id=?').get(info.lastInsertRowid);
}

export function setBookingStatus(id, status) {
  db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status, id);
  return db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
}

export function confirmBooking(id) { return setBookingStatus(id, 'confermato'); }

export function listBookings() {
  return db.prepare('SELECT b.*, l.username FROM bookings b LEFT JOIN leads l ON l.id=b.lead_id ORDER BY b.id DESC').all();
}
