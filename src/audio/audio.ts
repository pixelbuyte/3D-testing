import type { Vec3 } from 'playcanvas';
import { settings } from '@/core/settings';
import { adsr, blip, impulseResponse, noiseBuffer, pick, rand, scaleNote } from './synth';

export type Surface = 'ground' | 'stone' | 'water' | 'grass' | 'rock';
export type Space = 'open' | 'courtyard' | 'sanctum';

export interface HumHandle { setIntensity(v: number): void; dispose(): void; }

/**
 * Fully procedural audio. There are no sound files: every layer is synthesised from noise buffers,
 * oscillators, filters and a generated convolution reverb, so the whole soundtrack costs a few KB
 * of code instead of megabytes of assets.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private convolver!: ConvolverNode;
  private ambienceGain!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private noise = { white: null as AudioBuffer | null, pink: null as AudioBuffer | null, brown: null as AudioBuffer | null };
  private irs: Record<Space, AudioBuffer | null> = { open: null, courtyard: null, sanctum: null };
  private started = false;
  private time = 0;
  private nextThunder = 22;
  private nextChirp = 0;
  private nextDrip = 0;
  private awakeness = 0;
  private musicStage = -1;
  private nextNote = 0;
  private noteIndex = 0;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windTargetCut = 500;
  private windTargetGain = 0.1;
  private space: Space = 'open';

  get available(): boolean { return this.ctx !== null && this.ctx.state !== 'closed'; }
  get context(): AudioContext | null { return this.ctx; }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      if (!this.started) { this.startAmbience(); this.started = true; }
    } catch (err) {
      console.warn('[audio] unavailable', err);
      this.ctx = null;
    }
  }

  private build(): void {
    const ctx = this.ctx!;
    this.noise.white = noiseBuffer(ctx, 3, 'white');
    this.noise.pink = noiseBuffer(ctx, 5, 'pink');
    this.noise.brown = noiseBuffer(ctx, 5, 'brown');
    this.irs.open = impulseResponse(ctx, 1.6, 3.2, 0.85);
    this.irs.courtyard = impulseResponse(ctx, 2.4, 2.6, 0.7);
    this.irs.sanctum = impulseResponse(ctx, 4.5, 2.0, 0.55);

    this.master = ctx.createGain();
    this.master.gain.value = settings.get('volume');
    this.master.connect(ctx.destination);

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.irs.open;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.28;
    this.dry = ctx.createGain(); this.dry.gain.value = 1;
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);
    this.dry.connect(this.master);

    this.ambienceGain = ctx.createGain(); this.ambienceGain.gain.value = 0.55;
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0;
    this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = 0.9;
    for (const g of [this.ambienceGain, this.musicGain, this.sfxGain]) { g.connect(this.dry); g.connect(this.convolver); }

    settings.on('change', ({ key }) => {
      if (key === 'volume' && this.ctx) this.master.gain.setTargetAtTime(settings.get('volume'), this.ctx.currentTime, 0.05);
    });
  }

  private loop(buf: AudioBuffer, gain: number, dest: AudioNode, rate = 1): { src: AudioBufferSourceNode; g: GainNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(dest);
    src.start();
    return { src, g };
  }

  // ------------------------------------------------------------------ ambience
  private startAmbience(): void {
    const ctx = this.ctx!;
    // --- forest bed: pink noise through a wandering band-pass, widened by detuning the two channels
    const bed = ctx.createBiquadFilter();
    bed.type = 'bandpass'; bed.frequency.value = 900; bed.Q.value = 0.6;
    bed.connect(this.ambienceGain);
    this.loop(this.noise.pink!, 0.10, bed, 0.85);
    const bedHigh = ctx.createBiquadFilter();
    bedHigh.type = 'highpass'; bedHigh.frequency.value = 2600;
    bedHigh.connect(this.ambienceGain);
    this.loop(this.noise.white!, 0.008, bedHigh, 1.03);

    // --- wind: brown noise through a resonant low-pass driven by a slow random walk
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 420; this.windFilter.Q.value = 3.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.10;
    this.windFilter.connect(this.windGain); this.windGain.connect(this.ambienceGain);
    this.loop(this.noise.brown!, 0.7, this.windFilter, 0.7);

    // --- a faint low drone that grounds everything
    const drone = ctx.createOscillator();
    drone.type = 'sine'; drone.frequency.value = 48;
    const dg = ctx.createGain(); dg.gain.value = 0.035;
    drone.connect(dg); dg.connect(this.ambienceGain);
    drone.start();
  }

  setSpace(space: Space): void {
    if (!this.ctx || space === this.space) return;
    this.space = space;
    this.convolver.buffer = this.irs[space];
    const mix = space === 'sanctum' ? 0.5 : space === 'courtyard' ? 0.36 : 0.24;
    this.wet.gain.setTargetAtTime(mix, this.ctx.currentTime, 0.6);
  }
  setReverbMix(v: number): void { if (this.ctx) this.wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3); }
  setMasterVolume(v: number): void { if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  /** 0..1: how many stones are awake. Drives insect density and ambience colour. */
  setAwakeness(v: number): void { this.awakeness = v; }

  // ------------------------------------------------------------------ spatial helper
  private panner(pos: Vec3 | null): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return this.sfxGain;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.5;
    p.maxDistance = 90;
    p.rolloffFactor = 1.1;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.sfxGain);
    return p;
  }

  private burstNoise(buf: AudioBuffer, dest: AudioNode, filter: BiquadFilterNode, gain: number, attack: number, decay: number, rate = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    src.loopStart = Math.random() * 0.5;
    const g = ctx.createGain();
    src.connect(filter); filter.connect(g); g.connect(dest);
    const t = ctx.currentTime;
    const end = blip(g.gain, t, gain, attack, decay);
    src.start(t, Math.random() * (buf.duration - 0.3));
    src.stop(end + 0.05);
  }

  // ------------------------------------------------------------------ one-shots
  playFootstep(surface: Surface, intensity: number, sprint: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dest = this.sfxGain;
    const vol = intensity * (sprint ? 0.42 : 0.3);
    const f = ctx.createBiquadFilter();
    switch (surface) {
      case 'stone': {
        f.type = 'bandpass'; f.frequency.value = rand(1400, 2600); f.Q.value = 1.1;
        this.burstNoise(this.noise.white!, dest, f, vol * 0.9, 0.001, rand(0.05, 0.09), rand(0.9, 1.2));
        // a short click transient gives the heel its snap
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = rand(150, 240);
        const og = ctx.createGain(); o.connect(og); og.connect(dest);
        const end = blip(og.gain, ctx.currentTime, vol * 0.35, 0.001, 0.05);
        o.start(); o.stop(end + 0.02);
        break;
      }
      case 'water': {
        f.type = 'bandpass'; f.frequency.value = rand(700, 1300); f.Q.value = 0.8;
        this.burstNoise(this.noise.white!, dest, f, vol * 1.3, 0.004, rand(0.16, 0.26), rand(0.7, 1.0));
        const sweep = ctx.createBiquadFilter();
        sweep.type = 'bandpass'; sweep.Q.value = 4;
        sweep.frequency.setValueAtTime(500, ctx.currentTime);
        sweep.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + 0.18);
        this.burstNoise(this.noise.white!, dest, sweep, vol * 0.6, 0.005, 0.2);
        break;
      }
      case 'rock': {
        f.type = 'bandpass'; f.frequency.value = rand(900, 1700); f.Q.value = 0.7;
        this.burstNoise(this.noise.pink!, dest, f, vol * 0.85, 0.002, rand(0.07, 0.12), rand(0.85, 1.15));
        break;
      }
      case 'grass': {
        f.type = 'highpass'; f.frequency.value = rand(1800, 3200);
        this.burstNoise(this.noise.white!, dest, f, vol * 0.55, 0.004, rand(0.09, 0.15), rand(0.9, 1.25));
        break;
      }
      default: {
        f.type = 'lowpass'; f.frequency.value = rand(600, 1100); f.Q.value = 0.5;
        this.burstNoise(this.noise.pink!, dest, f, vol * 0.8, 0.003, rand(0.07, 0.13), rand(0.8, 1.1));
      }
    }
  }

  playLanding(intensity: number, surface: Surface): void {
    if (!this.ctx) return;
    this.playFootstep(surface, Math.min(1, 0.7 + intensity), false);
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(rand(90, 130), ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.16);
    const g = ctx.createGain(); o.connect(g); g.connect(this.sfxGain);
    const end = blip(g.gain, ctx.currentTime, 0.28 * (0.5 + intensity), 0.004, 0.18);
    o.start(); o.stop(end + 0.05);
  }

  playJump(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
    this.burstNoise(this.noise.white!, this.sfxGain, f, 0.10, 0.004, 0.09, 1.3);
  }

  playInteract(kind: 'focus' | 'attune' | 'denied', pos?: Vec3): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dest = this.panner(pos ?? null);
    const base = kind === 'denied' ? 180 : kind === 'focus' ? 720 : 480;
    const o = ctx.createOscillator();
    o.type = kind === 'denied' ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(base, ctx.currentTime);
    if (kind === 'attune') o.frequency.exponentialRampToValueAtTime(base * 2, ctx.currentTime + 0.35);
    if (kind === 'denied') o.frequency.exponentialRampToValueAtTime(base * 0.6, ctx.currentTime + 0.2);
    const g = ctx.createGain(); o.connect(g); g.connect(dest);
    const end = blip(g.gain, ctx.currentTime, kind === 'focus' ? 0.055 : 0.12, 0.006, kind === 'attune' ? 0.5 : 0.22);
    o.start(); o.stop(end + 0.05);
  }

  /** A big rising swell with a bell strike; index 0..2 raises the pitch and brightness. */
  playStoneActivate(index: number, pos: Vec3): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dest = this.panner(pos);
    const root = 110 * Math.pow(2, index / 3);
    const t = ctx.currentTime;
    // rising noise swell
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(3000 + index * 900, t + 1.9);
    const src = ctx.createBufferSource(); src.buffer = this.noise.pink!; src.loop = true;
    const sg = ctx.createGain();
    src.connect(f); f.connect(sg); sg.connect(dest);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.30, t + 1.7);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    src.start(t); src.stop(t + 3.6);
    // bell strike with inharmonic partials
    for (const [mult, amp, dur] of [[1, 0.22, 4.0], [2.01, 0.12, 3.2], [2.99, 0.07, 2.4], [4.21, 0.045, 1.8]] as [number, number, number][]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = root * mult * 2;
      const g = ctx.createGain(); o.connect(g); g.connect(dest);
      const end = blip(g.gain, t + 1.55, amp, 0.008, dur);
      o.start(t + 1.55); o.stop(end + 0.1);
    }
  }

  playDoorOpen(pos: Vec3): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dest = this.panner(pos);
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 340; f.Q.value = 2;
    const src = ctx.createBufferSource(); src.buffer = this.noise.brown!; src.loop = true; src.playbackRate.value = 0.55;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.40, t + 0.5);
    g.gain.setValueAtTime(0.40, t + 2.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    // grinding modulation
    const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 11;
    const lg = ctx.createGain(); lg.gain.value = 130;
    lfo.connect(lg); lg.connect(f.frequency);
    lfo.start(t); lfo.stop(t + 4.3);
    src.start(t); src.stop(t + 4.3);
  }

  addShrineHum(pos: Vec3, baseFreq = 62): HumHandle {
    if (!this.ctx) return { setIntensity: () => {}, dispose: () => {} };
    const ctx = this.ctx;
    const dest = this.panner(pos);
    const g = ctx.createGain(); g.gain.value = 0;
    g.connect(dest);
    const oscs: OscillatorNode[] = [];
    // three slightly detuned partials produce a slow natural beating
    for (const [mult, detune, amp] of [[1, 0, 0.5], [1, 7, 0.4], [2.02, -5, 0.18], [3.98, 4, 0.06]] as [number, number, number][]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = baseFreq * mult; o.detune.value = detune;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(g); o.start();
      oscs.push(o);
    }
    // shimmering high partial
    const sh = ctx.createOscillator(); sh.type = 'triangle'; sh.frequency.value = baseFreq * 12;
    const shg = ctx.createGain(); shg.gain.value = 0.02;
    const shLfo = ctx.createOscillator(); shLfo.type = 'sine'; shLfo.frequency.value = 0.23;
    const shLfoG = ctx.createGain(); shLfoG.gain.value = 0.018;
    shLfo.connect(shLfoG); shLfoG.connect(shg.gain);
    sh.connect(shg); shg.connect(g); sh.start(); shLfo.start();
    oscs.push(sh, shLfo);
    return {
      setIntensity: (v: number) => g.gain.setTargetAtTime(Math.max(0, v) * 0.16, ctx.currentTime, 0.4),
      dispose: () => { for (const o of oscs) { try { o.stop(); } catch { /* already stopped */ } } },
    };
  }

  /** Spatialised pool ambience: a soft filtered trickle. */
  playWaterAmbience(pos: Vec3): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dest = this.panner(pos);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.value = 0.05;
    f.connect(g); g.connect(dest);
    const src = ctx.createBufferSource(); src.buffer = this.noise.white!; src.loop = true; src.playbackRate.value = 0.6;
    src.connect(f); src.start();
    // slow amplitude wobble so it never sounds like static
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
  }

  // ------------------------------------------------------------------ music
  startMusic(): void { if (this.ctx) { this.musicStage = Math.max(this.musicStage, 0); this.musicGain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 3); } }
  stopMusic(): void { if (this.ctx) this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 2); }
  setMusicStage(stage: number): void {
    if (!this.ctx) return;
    this.musicStage = stage;
    const level = [0.32, 0.42, 0.55, 0.85][Math.min(3, Math.max(0, stage))];
    this.musicGain.gain.setTargetAtTime(level, this.ctx.currentTime, 2.5);
    if (stage >= 3) this.finaleSwell();
  }

  private finaleSwell(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // a slow pad that blooms over ~12 s
    for (const mult of [1, 1.5, 2, 3, 4]) {
      const o = ctx.createOscillator();
      o.type = mult > 2 ? 'sine' : 'triangle';
      o.frequency.value = 55 * mult;
      o.detune.value = rand(-8, 8);
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o.connect(g); g.connect(this.musicGain);
      g.gain.exponentialRampToValueAtTime(0.09 / mult, t + 6);
      g.gain.setValueAtTime(0.09 / mult, t + 14);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 26);
      o.start(t); o.stop(t + 27);
    }
  }

  private playNote(): void {
    const ctx = this.ctx!;
    const stage = Math.max(0, this.musicStage);
    const root = 220;
    // wander up and down the pentatonic rather than looping a fixed phrase
    this.noteIndex += pick([-2, -1, 1, 1, 2, 3]);
    this.noteIndex = Math.max(-4, Math.min(11, this.noteIndex));
    const freq = scaleNote(root, this.noteIndex);
    const t = ctx.currentTime;
    const voices: [OscillatorType, number, number][] = [['sine', 1, 0.1], ['triangle', 2, 0.03]];
    if (stage >= 2) voices.push(['sine', 3, 0.018]);
    for (const [type, mult, amp] of voices) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq * mult;
      const g = ctx.createGain(); o.connect(g); g.connect(this.musicGain);
      const end = adsr(g.gain, t, amp, { attack: 0.02, decay: 0.5, sustain: 0.25, release: 2.2 }, 0.4);
      o.start(t); o.stop(end + 0.1);
    }
    if (stage >= 1 && Math.random() < 0.4) {
      // a low answering tone
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = scaleNote(root / 2, this.noteIndex - 3);
      const g = ctx.createGain(); o.connect(g); g.connect(this.musicGain);
      const end = adsr(g.gain, t + 0.5, 0.07, { attack: 0.4, decay: 1.2, sustain: 0.3, release: 3 }, 0.6);
      o.start(t + 0.5); o.stop(end + 0.1);
    }
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number, listenerPos: Vec3, forward: Vec3, up: Vec3): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = listenerPos.x; l.positionY.value = listenerPos.y; l.positionZ.value = listenerPos.z;
      l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(listenerPos.x, listenerPos.y, listenerPos.z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void })
        .setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }

    this.time += dt;
    const now = ctx.currentTime;

    // --- wind random walk
    this.windTargetCut += rand(-70, 70) * dt * 4;
    this.windTargetCut = Math.max(180, Math.min(1500, this.windTargetCut));
    this.windTargetGain += rand(-0.05, 0.05) * dt * 3;
    this.windTargetGain = Math.max(0.04, Math.min(0.30, this.windTargetGain));
    this.windFilter.frequency.setTargetAtTime(this.windTargetCut, now, 0.6);
    this.windGain.gain.setTargetAtTime(this.windTargetGain, now, 0.8);

    // --- distant thunder
    this.nextThunder -= dt;
    if (this.nextThunder <= 0) {
      this.nextThunder = rand(25, 70);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = rand(90, 190); f.Q.value = 1.2;
      const src = ctx.createBufferSource(); src.buffer = this.noise.brown!; src.loop = true; src.playbackRate.value = 0.4;
      const g = ctx.createGain();
      src.connect(f); f.connect(g); g.connect(this.ambienceGain);
      const dur = rand(2.5, 5);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(rand(0.10, 0.24), now + rand(0.3, 0.9));
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.start(now); src.stop(now + dur + 0.2);
    }

    // --- crickets, denser as the shrine wakes
    this.nextChirp -= dt;
    if (this.nextChirp <= 0) {
      this.nextChirp = rand(0.25, 1.6) / (0.5 + this.awakeness);
      const base = rand(3200, 5200);
      const t = now + rand(0, 0.1);
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = base * (1 + i * 0.004);
        const g = ctx.createGain(); o.connect(g); g.connect(this.ambienceGain);
        const st = t + i * 0.035;
        const end = blip(g.gain, st, 0.010 * (0.5 + this.awakeness * 0.8), 0.004, 0.03);
        o.start(st); o.stop(end + 0.01);
      }
    }

    // --- drips off the canopy
    this.nextDrip -= dt;
    if (this.nextDrip <= 0) {
      this.nextDrip = rand(0.6, 3.2);
      const o = ctx.createOscillator(); o.type = 'sine';
      const f0 = rand(900, 2400);
      o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.45, now + 0.09);
      const g = ctx.createGain(); o.connect(g); g.connect(this.ambienceGain);
      const end = blip(g.gain, now, rand(0.02, 0.06), 0.002, 0.1);
      o.start(now); o.stop(end + 0.02);
    }

    // --- music sequencer
    if (this.musicStage >= 0) {
      this.nextNote -= dt;
      if (this.nextNote <= 0) {
        this.nextNote = rand(1.6, 4.2) / (1 + this.musicStage * 0.25);
        this.playNote();
      }
    }
  }

  dispose(): void {
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
  }
}
