// Popola il DB con dati demo per vedere subito la dashboard in azione.
import { generateBatch } from './modules/content.js';
import * as ig from './modules/instagram.js';
import * as email from './modules/email.js';
import db from './db.js';

console.log('Genero contenuti demo…');
await generateBatch(['lead per dentisti', 'automazione DM', 'come scegliere una nicchia'], 1);

console.log('Simulo comment-to-DM…');
await ig.handleEvent({ entry: [{ changes: [{ field: 'comments', value: { text: 'Voglio INFO!', from: { id: '1001', username: 'mario_rossi' } } }] }] });

console.log('Simulo la risposta del lead (setter + booking)…');
await ig.handleEvent({ entry: [{ messaging: [{ sender: { id: '1001' }, message: { text: 'Ho uno studio dentistico, mi servono pazienti. la mia email e mario@studio.it' } }] }] });

console.log('Accodo una cold email demo…');
email.queue({ to: 'prospect@azienda.it', subject: 'Un\'idea per il tuo studio', body: 'Ciao, ho notato il tuo profilo...' });

console.log('Seed completato. Avvia con: npm start');
