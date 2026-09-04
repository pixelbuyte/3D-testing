/** Low-level Web Audio helpers: noise buffers, generated impulse responses, envelopes, scales. */

export function noiseBuffer(ctx: BaseAudioContext, seconds: number, kind: 'white' | 'pink' | 'brown' = 'white'): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    if (kind === 'white') {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } else if (kind === 'pink') {
      // Paul Kellet's economical pink-noise filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  return buf;
}

/** Synthesised impulse response: exponentially decaying noise with a darkening tail. */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, darkness: number): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = Math.pow(1 - t, decay);
      const w = (Math.random() * 2 - 1) * env;
      // one-pole low pass whose cutoff falls with time -> the tail gets darker, like real rooms
      const a = Math.max(0.02, 1 - darkness * t);
      lp += a * (w - lp);
      d[i] = lp;
    }
    // a little early-reflection sparkle
    for (let k = 0; k < 6; k++) {
      const idx = Math.floor((0.008 + Math.random() * 0.05) * ctx.sampleRate);
      if (idx < n) d[idx] += (Math.random() * 2 - 1) * 0.4;
    }
  }
  return buf;
}

export interface Env { attack: number; decay: number; sustain: number; release: number; }

/** Applies an ADSR to a gain param starting at `t0`; returns the time the release ends. */
export function adsr(param: AudioParam, t0: number, peak: number, env: Env, holdFor: number): number {
  param.cancelScheduledValues(t0);
  param.setValueAtTime(0.0001, t0);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + env.attack);
  const sustainLevel = Math.max(peak * env.sustain, 0.0002);
  param.exponentialRampToValueAtTime(sustainLevel, t0 + env.attack + env.decay);
  const relStart = t0 + env.attack + env.decay + holdFor;
  param.setValueAtTime(sustainLevel, relStart);
  param.exponentialRampToValueAtTime(0.0001, relStart + env.release);
  return relStart + env.release;
}

/** Short percussive envelope (no sustain), the workhorse for footsteps and clicks. */
export function blip(param: AudioParam, t0: number, peak: number, attack: number, decay: number): number {
  param.cancelScheduledValues(t0);
  param.setValueAtTime(0.0001, t0);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
  param.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  return t0 + attack + decay;
}

/** Minor pentatonic, which is what gives the score its "old shrine" colour. */
export const PENTATONIC = [0, 3, 5, 7, 10];
export function scaleNote(root: number, degree: number): number {
  const oct = Math.floor(degree / PENTATONIC.length);
  const idx = ((degree % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  return root * Math.pow(2, (PENTATONIC[idx] + oct * 12) / 12);
}

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];
