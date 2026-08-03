// Diagnostica: verifica che il provider AI e gli embeddings funzionino davvero.
// Uso:  npm run ai:check
import { config, readiness } from '../config.js';
import { complete, embed, safeJson, aiStatus, cosine } from '../ai.js';

const line = (s = '') => console.log(s);
line('\n== CHECK AI ==');
line(`Provider testo : ${config.aiProvider}`);
line(`Provider embed : ${config.embedProvider}`);
line(`Stato          : ${JSON.stringify(readiness(), null, 2)}`);

if (config.aiProvider === 'mock') {
  line('\n⚠️  Sei in modalità mock: nessuna chiave configurata.');
  line('   Per l\'AI vera (gratis): https://aistudio.google.com/apikey');
  line('   Poi nel .env:  AI_PROVIDER=gemini  e  GEMINI_API_KEY=la_tua_chiave\n');
}

// 1. Generazione testo
line('\n1) Test generazione…');
const t0 = Date.now();
try {
  const raw = await complete(
    'Rispondi SOLO con JSON valido: {"ok":true,"lingua":"<lingua della domanda>","saluto":"<un saluto breve>"}',
    'Ciao, funzioni? Rispondi in italiano.'
  );
  const j = safeJson(raw, null);
  if (j) line(`   ✅ risposta in ${Date.now() - t0}ms → ${JSON.stringify(j).slice(0, 160)}`);
  else line(`   ⚠️  risposta non-JSON: ${String(raw).slice(0, 200)}`);
} catch (e) {
  line(`   ❌ ${e.message}`);
}

// 2. Embeddings + coerenza semantica
line('\n2) Test embeddings…');
try {
  const t1 = Date.now();
  const [a, b, c] = await embed([
    'Il listino prezzi del pacchetto Pro è 3.000 euro di setup.',
    'Quanto costa il pacchetto Pro?',
    'Ricetta della carbonara con guanciale e pecorino.',
  ]);
  const simRelated = cosine(a, b), simUnrelated = cosine(a, c);
  line(`   ✅ ${a.length} dimensioni in ${Date.now() - t1}ms`);
  line(`   affini: ${simRelated.toFixed(3)} | non affini: ${simUnrelated.toFixed(3)}`);
  line(simRelated > simUnrelated
    ? '   ✅ il retrieval distingue correttamente i testi affini'
    : '   ⚠️  distinzione debole: con embeddings locali è normale, con Gemini dovrebbe migliorare');
} catch (e) {
  line(`   ❌ ${e.message}`);
}

line(`\nContatori: ${JSON.stringify(aiStatus())}`);
line('== FINE ==\n');
