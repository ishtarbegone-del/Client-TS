import fs from 'fs';

import Packet from '#/io/Packet.js';
import JagFX from '#/sound/JagFX.js';
import Tone from '#/sound/Tone.js';

const src = process.argv[2];
const dest = process.argv[3];
if (!src || !dest) {
    throw new Error('usage: bun run tools/RenderSynth.ts <in.synth> <out.wav>');
}

const raw = new Uint8Array(fs.readFileSync(src));
const buf = new Packet(raw);
JagFX.waveBytes = new Uint8Array(44100 * 10);
JagFX.waveBuffer = new Packet(JagFX.waveBytes);
Tone.init();
const fx = new JagFX();
fx.load(buf);
fx.optimiseStart();
const wav = fx.getWave(1);
if (!wav) {
    throw new Error(`failed to render ${src}`);
}
fs.mkdirSync(dest.substring(0, Math.max(dest.lastIndexOf('/'), dest.lastIndexOf('\\'))), { recursive: true });
fs.writeFileSync(dest, wav.data.subarray(0, wav.pos));
console.log(`wrote ${dest} bytes=${wav.pos}`);
