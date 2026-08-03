// Popola il DB con dati demo per vedere subito la dashboard in azione.
import { generateBatch } from './modules/content.js';
import * as ig from './modules/instagram.js';
import * as setter from './modules/setter.js';
import * as booking from './modules/booking.js';
import db from './db.js';

console.log('Genero contenuti demo…');
await generateBatch(['lead per dentisti', 'automazione DM', 'come scegliere una nicchia']);

console.log('Simulo un commento con keyword (comment-to-DM)…');
await ig.handleEvent({ entry: [{ changes: [{ field: 'comments', value: { text: 'Voglio INFO!', from: { id: '1001', username: 'mario_rossi' } } }] }] });

console.log('Simulo una conversazione del setter…');
const lead = db.prepare('SELECT * FROM leads LIMIT 1').get();
if (lead) {
  await setter.handleMessage(lead.id, 'Ho uno studio dentistico, mi servono nuovi pazienti');
  const b = booking.createBooking(lead.id, booking.getSlots()[0]);
  console.log('Prenotazione demo creata:', b.slot);
}
console.log('Seed completato.');
