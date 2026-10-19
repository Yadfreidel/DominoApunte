// Genera assets/sounds/victoria.wav: fanfarria corta (≈1,6 s) sintetizada, sin derechos de terceros.
// Uso: node scripts/generar-fanfarria.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 22050;
// Nota (Hz), inicio (s), duración (s): arpegio ascendente y acorde final.
const NOTES = [
  [523.25, 0.0, 0.16],
  [659.25, 0.15, 0.16],
  [783.99, 0.3, 0.16],
  [1046.5, 0.45, 1.1],
  [783.99, 0.45, 1.1],
  [659.25, 0.45, 1.1],
];
const total = 1.6;
const samples = new Float32Array(Math.ceil(total * RATE));
for (const [freq, start, dur] of NOTES) {
  const from = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  for (let i = 0; i < len && from + i < samples.length; i++) {
    const t = i / RATE;
    // Envolvente: ataque rápido y caída suave.
    const env = Math.min(1, t / 0.01) * Math.exp(-3 * (t / dur));
    // Tono tipo trompeta: fundamental + armónicos.
    const v = Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(4 * Math.PI * freq * t) + 0.25 * Math.sin(6 * Math.PI * freq * t);
    samples[from + i] += 0.18 * env * v;
  }
}
const data = Buffer.alloc(samples.length * 2);
samples.forEach((v, i) => data.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, i * 2));
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
mkdirSync(new URL('../assets/sounds/', import.meta.url), { recursive: true });
writeFileSync(new URL('../assets/sounds/victoria.wav', import.meta.url), Buffer.concat([header, data]));
console.log(`victoria.wav: ${Math.round((44 + data.length) / 1024)} KB`);
