// Renders an original instrumental score for the demo video to a 16-bit WAV.
//
// This is the same musical design as the in-game audio (src/audio/) — minor pentatonic plucks over
// a low drone, with a wind/ambience bed and a pad that blooms for the finale — but rendered offline
// so it can be muxed into the captured video. Everything here is synthesised from scratch.
//
// Usage: node tools/make-soundtrack.mjs --seconds 34 --out demo/score.wav
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const SR = 44100;
const DUR = Number(args.seconds ?? 34);
const OUT = args.out ?? 'demo/score.wav';
const N = Math.floor(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);

// deterministic PRNG so the score is reproducible
let seed = 20260904 >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = (a, b) => a + rnd() * (b - a);

const PENT = [0, 3, 5, 7, 10];               // minor pentatonic
const note = (root, deg) => root * Math.pow(2, (PENT[((deg % 5) + 5) % 5] + Math.floor(deg / 5) * 12) / 12);

/** Adds a decaying sine/triangle partial with a soft attack. */
function pluck(t0, freq, amp, decay, pan = 0.5, tri = 0) {
  const start = Math.floor(t0 * SR);
  const len = Math.min(N - start, Math.floor(decay * 3.2 * SR));
  if (start < 0 || len <= 0) return;
  const gl = Math.sqrt(1 - pan), gr = Math.sqrt(pan);
  const w = 2 * Math.PI * freq / SR;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.012) * Math.exp(-t / decay);
    const ph = w * i;
    let s = Math.sin(ph);
    if (tri > 0) s += tri * (2 / Math.PI) * Math.asin(Math.sin(ph * 2));
    // gentle inharmonic shimmer, like a struck stone
    s += 0.10 * Math.sin(ph * 2.01) * Math.exp(-t / (decay * 0.5));
    const v = s * env * amp;
    L[start + i] += v * gl; R[start + i] += v * gr;
  }
}

/** Sustained drone / pad voice with a slow swell. */
function pad(t0, t1, freq, amp, detune = 0) {
  const start = Math.max(0, Math.floor(t0 * SR)), end = Math.min(N, Math.floor(t1 * SR));
  const dur = (end - start) / SR;
  const w = 2 * Math.PI * freq / SR, w2 = 2 * Math.PI * (freq * Math.pow(2, detune / 1200)) / SR;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SR;
    const env = Math.min(1, t / (dur * 0.35)) * Math.min(1, (dur - t) / (dur * 0.4));
    const s = (Math.sin(w * i) + 0.7 * Math.sin(w2 * i) + 0.25 * Math.sin(w * i * 2)) / 1.95;
    const v = s * env * amp;
    L[i] += v * 0.7; R[i] += v * 0.7;
  }
}

// ---- ambience bed: brown-ish noise through a slowly sweeping one-pole low pass, stereo decorrelated
{
  let lp1 = 0, lp2 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const cut = 0.02 + 0.014 * Math.sin(t * 0.21) + 0.010 * Math.sin(t * 0.061 + 1.3);
    b1 = (b1 + 0.02 * (rnd() * 2 - 1)) / 1.02;
    b2 = (b2 + 0.02 * (rnd() * 2 - 1)) / 1.02;
    lp1 += cut * (b1 * 3.2 - lp1);
    lp2 += cut * (b2 * 3.2 - lp2);
    // wind swells
    const gust = 0.5 + 0.5 * Math.sin(t * 0.13 + Math.sin(t * 0.037) * 2);
    const a = 0.055 * (0.45 + gust * 0.75);
    L[i] += lp1 * a; R[i] += lp2 * a;
  }
}

// ---- low drone that runs the whole piece, rising a fifth for the finale
pad(0, DUR * 0.72, 55, 0.085);
pad(DUR * 0.55, DUR, 82.4, 0.075, 6);

// ---- melody: a wandering pentatonic line whose density and register grow with the shots
{
  const root = 220;
  let deg = 0;
  let t = 1.2;
  while (t < DUR - 1.5) {
    const progress = t / DUR;
    // notes get closer together and brighter as the shrine wakes
    const gap = rand(1.5, 3.0) * (1 - progress * 0.5);
    deg += [-2, -1, 1, 1, 2, 3][Math.floor(rnd() * 6)];
    deg = Math.max(-3, Math.min(11, deg));
    const f = note(root, deg);
    const amp = 0.085 * (0.6 + progress * 0.7);
    pluck(t, f, amp, rand(1.6, 2.8), rand(0.3, 0.7), 0.25);
    // an octave shimmer above, sparser
    if (rnd() < 0.4) pluck(t + rand(0.05, 0.18), f * 2, amp * 0.30, rand(1.0, 1.8), rand(0.2, 0.8));
    // a low answering tone
    if (rnd() < 0.35) pluck(t + rand(0.3, 0.7), note(root / 2, deg - 3), amp * 0.55, rand(2.2, 3.4), 0.5);
    t += gap;
  }
}

// ---- finale: a pad chord blooms as the beam ignites (last ~35% of the piece)
{
  const fin = DUR * 0.66;
  for (const [mult, amp, det] of [[1, 0.075, 0], [1.5, 0.055, 5], [2, 0.045, -4], [3, 0.028, 7], [4, 0.018, -6]]) {
    pad(fin, DUR - 0.2, 110 * mult, amp, det);
  }
  // a single struck bell at the ignition
  for (const [m, a, d] of [[1, 0.13, 5.0], [2.01, 0.07, 4.0], [2.99, 0.04, 3.0], [4.21, 0.025, 2.2]]) {
    pluck(fin + 0.15, 220 * m, a, d, 0.5);
  }
}

// ---- master: soft-knee limiter + a short stereo tail so it does not sound dry
{
  // simple feedback delay for space
  const d1 = Math.floor(0.17 * SR), d2 = Math.floor(0.23 * SR);
  for (let i = d1; i < N; i++) L[i] += L[i - d1] * 0.22;
  for (let i = d2; i < N; i++) R[i] += R[i - d2] * 0.22;
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0 ? 0.82 / peak : 1;
  const fade = Math.floor(1.4 * SR);
  for (let i = 0; i < N; i++) {
    let a = 1;
    if (i < fade) a = i / fade;
    if (i > N - fade) a = (N - i) / fade;
    L[i] = Math.tanh(L[i] * g * a);
    R[i] = Math.tanh(R[i] * g * a);
  }
}

// ---- write a 16-bit stereo WAV
const bytes = N * 4;
const buf = Buffer.alloc(44 + bytes);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(bytes, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT}  ${DUR}s  ${(buf.length / 1e6).toFixed(2)} MB`);
