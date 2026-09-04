import { rand, scaleNote } from './synth';

/**
 * A formant-synthesis singing voice.
 *
 * There are no vocal samples in this project, so Nova's song is built the way a vocal tract works:
 * a buzzy glottal source (pulse-ish sawtooth) at the fundamental, shaped by three parallel
 * band-pass "formant" resonances whose centre frequencies define the vowel. Add vibrato, a little
 * breath noise, and a legato envelope and it reads convincingly as wordless singing — especially at
 * a distance through fog and reverb.
 */

export interface Vowel { f: [number, number, number]; q: [number, number, number]; gain: [number, number, number]; }

/** Formant tables for a few open vowels (roughly a mezzo range). */
export const VOWELS: Record<'a' | 'o' | 'u' | 'e', Vowel> = {
  a: { f: [800, 1150, 2900], q: [8, 9, 11], gain: [1.0, 0.50, 0.22] },
  o: { f: [500, 900, 2400], q: [9, 10, 12], gain: [1.0, 0.42, 0.14] },
  u: { f: [350, 640, 2400], q: [10, 11, 12], gain: [1.0, 0.30, 0.10] },
  e: { f: [560, 1900, 2550], q: [9, 10, 12], gain: [1.0, 0.60, 0.26] },
};

export interface VoiceOptions {
  /** Where the singer stands. Undefined = non-spatial. */
  panner?: AudioNode;
  /** Base pitch of the voice in Hz (the tonic she sings around). */
  root?: number;
  /** 0..1 overall level. */
  level?: number;
}

export class SingingVoice {
  private out: GainNode;
  private osc: OscillatorNode | null = null;
  private sub: OscillatorNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private noiseGain!: GainNode;
  private vibrato: OscillatorNode | null = null;
  private vibratoGain!: GainNode;
  private formants: { filter: BiquadFilterNode; gain: GainNode }[] = [];
  private amp!: GainNode;
  private root: number;
  private level: number;
  private running = false;

  /** Phrase state, advanced by update(). */
  private noteTimer = 0;
  private degree = 0;
  private phrasePos = 0;
  private restTimer = 0;
  private intensity = 1;
  private harmony = 0;

  constructor(private ctx: AudioContext, private noiseBuf: AudioBuffer, opts: VoiceOptions = {}) {
    this.root = opts.root ?? 196;         // ~G3
    this.level = opts.level ?? 1;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(opts.panner ?? ctx.destination);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const ctx = this.ctx;

    // --- glottal source: a sawtooth is a decent stand-in for a glottal pulse train
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = this.root;
    // a quiet sine an octave down thickens the chest register
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = this.root / 2;

    // --- vibrato on the fundamental (and its sub), ~5.3 Hz
    this.vibrato = ctx.createOscillator();
    this.vibrato.type = 'sine';
    this.vibrato.frequency.value = 5.3;
    this.vibratoGain = ctx.createGain();
    this.vibratoGain.gain.value = 4.5;    // cents of detune
    this.vibrato.connect(this.vibratoGain);
    this.vibratoGain.connect(this.osc.detune);
    this.vibratoGain.connect(this.sub.detune);

    // --- breath: filtered noise mixed under the tone
    this.noise = ctx.createBufferSource();
    this.noise.buffer = this.noiseBuf;
    this.noise.loop = true;
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.value = 2200;
    breathFilter.Q.value = 0.8;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.05;
    this.noise.connect(breathFilter);
    breathFilter.connect(this.noiseGain);

    // --- the vocal tract: three parallel band-passes summed
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    const v = VOWELS.a;
    for (let i = 0; i < 3; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = v.f[i];
      filter.Q.value = v.q[i];
      const gain = ctx.createGain();
      gain.gain.value = v.gain[i];
      this.osc.connect(filter);
      this.sub.connect(filter);
      this.noiseGain.connect(filter);
      filter.connect(gain);
      gain.connect(this.amp);
      this.formants.push({ filter, gain });
    }
    this.amp.connect(this.out);

    this.osc.start();
    this.sub.start();
    this.noise.start();
    this.vibrato.start();
    this.out.gain.setTargetAtTime(this.level, ctx.currentTime, 1.5);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.6);
    for (const n of [this.osc, this.sub, this.noise, this.vibrato]) {
      try { (n as OscillatorNode | AudioBufferSourceNode | null)?.stop(t + 3); } catch { /* already stopped */ }
    }
  }

  /** 0..1 — how present the voice is (used for distance and for world state). */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    if (this.running) this.out.gain.setTargetAtTime(this.level * this.intensity, this.ctx.currentTime, 0.35);
  }

  /** 0..2 — extra harmony voices layered in as the shrine wakes. */
  setHarmony(n: number): void { this.harmony = n; }

  /** Smoothly morphs the vocal tract toward a vowel. */
  private setVowel(name: keyof typeof VOWELS, glide: number): void {
    const v = VOWELS[name];
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.formants.length; i++) {
      this.formants[i].filter.frequency.setTargetAtTime(v.f[i], t, glide);
      this.formants[i].gain.gain.setTargetAtTime(v.gain[i], t, glide);
    }
  }

  /** Sings one sustained note, gliding into it from the previous pitch (legato). */
  private sing(freq: number, dur: number, vowel: keyof typeof VOWELS): void {
    if (!this.osc || !this.sub) return;
    const t = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(freq, t, 0.06);
    this.sub.frequency.setTargetAtTime(freq / 2, t, 0.06);
    this.setVowel(vowel, 0.12);
    // a breathy onset then a rounded sustain and release
    const peak = 0.16 * (0.75 + this.intensity * 0.5);
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setValueAtTime(Math.max(this.amp.gain.value, 0.0001), t);
    this.amp.gain.linearRampToValueAtTime(peak, t + 0.28);
    this.amp.gain.setValueAtTime(peak, t + dur * 0.62);
    this.amp.gain.linearRampToValueAtTime(0.0001, t + dur);
    // vibrato deepens on longer notes
    this.vibratoGain.gain.setTargetAtTime(dur > 2 ? 9 : 4.5, t + 0.3, 0.4);
    this.noiseGain.gain.setTargetAtTime(0.05 + (1 - this.intensity) * 0.04, t, 0.3);
  }

  /** Drives the phrase. Call every frame. */
  update(dt: number): void {
    if (!this.running || this.intensity <= 0.02) return;
    if (this.restTimer > 0) { this.restTimer -= dt; return; }
    this.noteTimer -= dt;
    if (this.noteTimer > 0) return;

    // a slow, mostly stepwise pentatonic phrase with breaths between phrases
    const step = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
    this.degree = Math.max(-2, Math.min(9, this.degree + step));
    const freq = scaleNote(this.root, this.degree);
    const dur = rand(1.6, 3.4) - this.harmony * 0.15;
    const vowel = (['a', 'o', 'u', 'e'] as const)[Math.floor(Math.random() * 4)];
    this.sing(freq, dur, vowel);
    this.noteTimer = dur * 0.92;

    this.phrasePos++;
    if (this.phrasePos >= 4 + Math.floor(Math.random() * 3)) {
      this.phrasePos = 0;
      this.restTimer = rand(1.8, 3.6);
      this.degree = Math.max(-2, Math.min(4, this.degree - 2));
    }
  }

  get node(): GainNode { return this.out; }
}
