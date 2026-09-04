import { JOINTS, UPPER, type Joint, type Pose, type Rig } from './rig';

/**
 * Pose-keyframe animation for the fighter rigs.
 *
 * Everything here exists to avoid the two things that make procedural characters look robotic:
 * linear interpolation and instant state changes. So keys carry their own easing curve (so a slash
 * can accelerate out of its wind-up and decelerate into its follow-through), state changes
 * cross-fade from a snapshot of wherever the body actually was, and an upper-body mask lets an
 * attack play over a run without the legs stopping.
 */

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'snap' | 'settle';

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  // overshoots slightly then comes back — anticipation and impact
  snap: (t) => { const c = 1.70158, d = c + 1; return 1 + d * (t - 1) ** 3 + c * (t - 1) ** 2; },
  // damped spring, for a limb settling after a strike
  settle: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 13)),
};

export interface Key {
  /** normalised time within the clip, 0..1 */
  t: number;
  pose: Pose;
  /** easing applied on the way OUT of this key toward the next */
  ease?: Ease;
}

export interface Clip {
  name: string;
  /** seconds */
  dur: number;
  loop?: boolean;
  /** 'upper' clips leave the legs to the locomotion blend */
  mask?: 'full' | 'upper';
  keys: Key[];
  /** fired once when playback crosses this normalised time; drives hit windows and sounds */
  events?: { t: number; name: string }[];
  /** root motion: metres forward over the clip, applied as a velocity curve */
  lunge?: number;
}

const ZERO: readonly [number, number, number] = [0, 0, 0];

/** Scratch pose objects, reused every frame so the animator never allocates. */
function blankPose(): Record<Joint, [number, number, number]> {
  const p = {} as Record<Joint, [number, number, number]>;
  for (const j of JOINTS) p[j] = [0, 0, 0];
  return p;
}

export class Animator {
  private cur: Record<Joint, [number, number, number]> = blankPose();
  private tmp: Record<Joint, [number, number, number]> = blankPose();
  private from: Record<Joint, [number, number, number]> = blankPose();

  /** continuously blended locomotion */
  private locoA: Clip | null = null;
  private locoB: Clip | null = null;
  private locoMix = 0;
  private locoPhase = 0;
  private locoRate = 1;

  /** a one-shot action layered over the top */
  private action: Clip | null = null;
  private actionT = 0;
  private fade = 0;
  private fadeDur = 0.12;
  private firedTo = -1;
  private onEvent: (name: string) => void = () => {};

  /** additive idle so a standing fighter is never perfectly still */
  breathe = 1;
  private time = 0;
  /** -1..1, drives a lean into the direction of travel */
  lean = 0;
  leanSide = 0;
  /** degrees, applied to the head on top of everything else */
  lookYaw = 0;
  lookPitch = 0;

  constructor(private rig: Rig) {}

  setEventHandler(fn: (name: string) => void): void { this.onEvent = fn; }

  /** Blend two locomotion clips continuously. `mix` 0 = a, 1 = b. */
  setLocomotion(a: Clip, b: Clip | null, mix: number, rate = 1): void {
    if (this.locoA !== a || this.locoB !== b) {
      // keep the phase when swapping clips so feet don't teleport mid-stride
      this.locoA = a; this.locoB = b;
    }
    this.locoMix = Math.max(0, Math.min(1, mix));
    this.locoRate = rate;
  }

  /** Start a one-shot clip, cross-fading from wherever the body currently is. */
  play(clip: Clip, fadeDur = 0.1): void {
    for (const j of JOINTS) { const c = this.cur[j], f = this.from[j]; f[0] = c[0]; f[1] = c[1]; f[2] = c[2]; }
    this.action = clip;
    this.actionT = 0;
    this.fade = 0;
    this.fadeDur = Math.max(0.001, fadeDur);
    this.firedTo = -1;
  }

  stopAction(): void { this.action = null; }
  get actionName(): string | null { return this.action?.name ?? null; }
  /** 0..1 through the current action, or 1 when idle */
  get actionProgress(): number { return this.action ? this.actionT / this.action.dur : 1; }
  get busy(): boolean { return this.action !== null; }

  /** Forward root motion the current action wants this frame, in metres. */
  consumeLunge(dt: number): number {
    if (!this.action?.lunge) return 0;
    const p = this.actionT / this.action.dur;
    // most of the travel lands in the first 45% of the clip, easing out
    const curve = (x: number): number => 1 - (1 - Math.min(1, x / 0.45)) ** 2;
    const before = curve(Math.max(0, (this.actionT - dt) / this.action.dur));
    return this.action.lunge * (curve(p) - before);
  }

  update(dt: number): void {
    this.time += dt;

    // --- 1. locomotion into `cur`
    if (this.locoA) {
      this.locoPhase = (this.locoPhase + dt * this.locoRate) % 1;
      sample(this.locoA, this.locoPhase, this.cur);
      if (this.locoB && this.locoMix > 0.001) {
        sample(this.locoB, this.locoPhase, this.tmp);
        for (const j of JOINTS) lerp3(this.cur[j], this.tmp[j], this.locoMix);
      }
    } else {
      for (const j of JOINTS) { const c = this.cur[j]; c[0] = c[1] = c[2] = 0; }
    }

    // --- 2. the action clip on top
    if (this.action) {
      this.actionT += dt;
      const p = this.actionT / this.action.dur;
      if (this.action.events) {
        for (const ev of this.action.events) {
          if (ev.t > this.firedTo && ev.t <= p) this.onEvent(ev.name);
        }
      }
      this.firedTo = p;
      if (p >= 1) {
        if (this.action.loop) { this.actionT = 0; this.firedTo = -1; }
        else { this.action = null; }
      }
    }
    if (this.action) {
      sample(this.action, Math.min(1, this.actionT / this.action.dur), this.tmp);
      this.fade = Math.min(1, this.fade + dt / this.fadeDur);
      const w = EASES.out(this.fade);
      // fading in: blend from the snapshot toward the clip; also blend out over the last 12%
      const p = this.actionT / this.action.dur;
      const outW = this.action.loop ? 1 : Math.min(1, (1 - p) / 0.12);
      const weight = w * Math.min(1, outW);
      const list = this.action.mask === 'upper' ? UPPER : JOINTS;
      for (const j of list) {
        // during the fade-in the reference is the snapshot, after it the underlying locomotion
        const base = this.fade < 1 ? this.from[j] : this.cur[j];
        const c = this.cur[j], t = this.tmp[j];
        c[0] = base[0] + (t[0] - base[0]) * weight;
        c[1] = base[1] + (t[1] - base[1]) * weight;
        c[2] = base[2] + (t[2] - base[2]) * weight;
      }
    }

    // --- 3. additive life: breathing, lean, head look
    const br = Math.sin(this.time * 1.5) * this.breathe;
    this.cur.spine[0] += br * 0.9;
    this.cur.chest[0] += br * 0.6;
    this.cur.chest[2] += this.leanSide * 5;
    this.cur.spine[0] += this.lean * 6;
    this.cur.head[1] += this.lookYaw;
    this.cur.head[0] += this.lookPitch;

    // --- 4. write to the skeleton, on top of each joint's rest rotation
    const rest = this.rig.rest;
    for (const j of JOINTS) {
      const c = this.cur[j];
      const r = rest[j] ?? ZERO;
      this.rig.joints[j].setLocalEulerAngles(c[0] + r[0], c[1] + r[1], c[2] + r[2]);
    }
  }
}

function lerp3(a: [number, number, number], b: readonly [number, number, number], t: number): void {
  a[0] += (b[0] - a[0]) * t;
  a[1] += (b[1] - a[1]) * t;
  a[2] += (b[2] - a[2]) * t;
}

/** Evaluate a clip at normalised time `p` into `out`. Joints the clip never mentions stay at 0. */
function sample(clip: Clip, p: number, out: Record<Joint, [number, number, number]>): void {
  for (const j of JOINTS) { const o = out[j]; o[0] = o[1] = o[2] = 0; }
  const keys = clip.keys;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= p) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = Math.max(1e-4, k1.t - k0.t);
  const raw = k1 === k0 ? 0 : Math.max(0, Math.min(1, (p - k0.t) / span));
  const t = EASES[k0.ease ?? 'inOut'](raw);

  for (const j of JOINTS) {
    const a = k0.pose[j];
    const b = k1.pose[j];
    if (!a && !b) continue;
    const av = a ?? ZERO, bv = b ?? ZERO;
    const o = out[j];
    o[0] = av[0] + (bv[0] - av[0]) * t;
    o[1] = av[1] + (bv[1] - av[1]) * t;
    o[2] = av[2] + (bv[2] - av[2]) * t;
  }
}
