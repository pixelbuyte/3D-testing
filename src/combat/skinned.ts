import {
  AnimClip, AnimEvaluator, Color, ContainerResource, DefaultAnimBinder, Entity, Quat, StandardMaterial, Vec3,
  type AnimTrack, type RenderComponent,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { Clip, FighterAnimator } from './anim';
import type { Fighter } from './characters';
import { applyRim } from './materials';
import { buildKatana } from './weapons';
import { clamp01 } from '@/utils/math';

/**
 * Skinned characters: a real humanoid skeleton with weighted skin, driven by animation tracks.
 *
 * The body is one GLB built offline by tools/build-character.py from CC0 sources (a Quaternius
 * Universal rig with a Modular Outfits body, UAL2 sword clips, KayKit locomotion retargeted onto
 * the same skeleton). This file is the runtime half: it instantiates the GLB, blends its clips with
 * the same cross-fade-from-wherever-the-body-is behaviour the procedural animator has, fires the
 * same events the combat director listens for, hands the clips' root motion back to the actor,
 * and hangs the weapon off a socket under the right hand bone.
 */

// ------------------------------------------------------------------ clip table

interface SkinnedClipDef {
  /** name of the track inside the GLB */
  track: string;
  loop?: boolean;
  /** playback multiplier on top of the actor's locomotion rate */
  speed?: number;
  /** ground speed in m/s this cycle covers at rate 1 — measured from the clip's stride by the build tool */
  naturalSpeed?: number;
  /** combat events at normalised times, in the vocabulary the director already speaks */
  events?: { t: number; name: string }[];
  /** clip that plays on its own once this one ends uninterrupted (a recovery back to stance) */
  next?: string;
  /** keep the last frame instead of fading back to locomotion (deaths) */
  hold?: boolean;
  /** metres of forward root motion in the track are multiplied by this before the actor sees them */
  rootMotion?: number;
  /** false for airborne or prone clips */
  ground?: boolean;
}

/** procedural clip name (what the director passes) → how the skinned body plays it */
const PLAYER_CLIPS: Record<string, SkinnedClipDef> = {
  idle: { track: 'idle', loop: true },
  guard: { track: 'guard', loop: true },
  walk: { track: 'walk', loop: true, naturalSpeed: 1.64 },
  run: { track: 'run', loop: true, naturalSpeed: 3.81 },
  slash1: { track: 'slash1', next: 'slash1_rec', rootMotion: 1, events: [{ t: 0.28, name: 'swing' }, { t: 0.36, name: 'hitOpen' }, { t: 0.80, name: 'hitClose' }] },
  slash2: { track: 'slash2', next: 'slash2_rec', rootMotion: 1, events: [{ t: 0.26, name: 'swing' }, { t: 0.32, name: 'hitOpen' }, { t: 0.72, name: 'hitClose' }] },
  slash3: { track: 'slash3', rootMotion: 1, events: [{ t: 0.34, name: 'swing' }, { t: 0.40, name: 'hitOpen' }, { t: 0.64, name: 'hitClose' }] },
  heavy: { track: 'heavy', rootMotion: 1, events: [{ t: 0.38, name: 'swing' }, { t: 0.44, name: 'hitOpen' }, { t: 0.70, name: 'hitClose' }] },
  dodge: { track: 'dodge', rootMotion: 1 },
  hit: { track: 'hit' },
  death: { track: 'death', hold: true, rootMotion: 1, ground: false },
  slash1_rec: { track: 'slash1_rec', rootMotion: 1 },
  slash2_rec: { track: 'slash2_rec', rootMotion: 1 },
};

// ------------------------------------------------------------------ loading

export interface SkinnedCharacter {
  entity: Entity;
  tracks: Map<string, AnimTrack>;
}

/** Instantiate a character GLB that is already in the asset bank. */
export function instantiateCharacter(container: ContainerResource): SkinnedCharacter {
  const entity = container.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
  const tracks = new Map<string, AnimTrack>();
  const anims = (container as unknown as { animations: { resource: AnimTrack }[] }).animations;
  for (const a of anims) {
    const t = a.resource;
    tracks.set(t.name, t);
  }
  return { entity, tracks };
}

// ------------------------------------------------------------------ animator

interface RootMotionCurve { times: Float32Array; z: Float32Array }

interface Playing {
  clip: AnimClip;
  def: SkinnedClipDef;
  name: string;
  dur: number;
  fade: number;
  fadeDur: number;
  firedTo: number;
  rm: RootMotionCurve | null;
  rmLast: number;
  recovery: boolean;
  loop: boolean;
}

/**
 * Drives an AnimEvaluator the way the procedural Animator drives its keyframes: two locomotion clips
 * blended by speed underneath, one action on top that fades in from wherever the body was, and
 * fades back out over its last stretch unless it is a hold.
 */
export class SkinnedAnimator implements FighterAnimator {
  private evaluator: AnimEvaluator;
  private clips = new Map<string, AnimClip>();
  private rmCurves = new Map<string, RootMotionCurve | null>();
  private locoA: string | null = null;
  private locoB: string | null = null;
  private locoMix = 0;
  private locoRate = 1;
  private locoSpeed = 0;
  private action: Playing | null = null;
  private prev: Playing | null = null;
  private onEvent: (name: string) => void = () => {};
  private time = 0;
  private spine: Entity | null;
  private head: Entity | null;
  private spineRest = new Quat();
  private headRest = new Quat();
  private tmpQ = new Quat();
  private tmpQ2 = new Quat();
  private pendingLunge = 0;

  breathe = 1;
  lean = 0;
  leanSide = 0;
  lookYaw = 0;
  lookPitch = 0;

  constructor(char: SkinnedCharacter, private table: Record<string, SkinnedClipDef> = PLAYER_CLIPS) {
    this.evaluator = new AnimEvaluator(new DefaultAnimBinder(char.entity));
    let order = 0;
    for (const [name, track] of char.tracks) {
      const clip = new AnimClip(track, 0, 1, false, false);
      clip.name = name;
      clip.blendWeight = 0;
      clip.blendOrder = order++;
      this.evaluator.addClip(clip);
      this.clips.set(name, clip);
      this.rmCurves.set(name, rootMotionCurve(track));
    }
    this.spine = char.entity.findByName('spine_02') as Entity | null;
    this.head = char.entity.findByName('Head') as Entity | null;
  }

  setEventHandler(fn: (name: string) => void): void { this.onEvent = fn; }

  private resolve(clip: Clip): SkinnedClipDef {
    return this.table[clip.name] ?? this.table.idle;
  }

  setLocomotion(a: Clip, b: Clip | null, mix: number, rate = 1, speed = 0): void {
    this.locoA = this.resolve(a).track;
    this.locoB = b ? this.resolve(b).track : null;
    this.locoMix = clamp01(mix);
    this.locoRate = rate;
    this.locoSpeed = speed;
  }

  play(clip: Clip, fadeDur = 0.1): number {
    const def = this.resolve(clip);
    return this.start(clip.name, def, fadeDur, !!clip.loop, false);
  }

  private start(name: string, def: SkinnedClipDef, fadeDur: number, loop: boolean, recovery: boolean): number {
    const ac = this.clips.get(def.track);
    if (!ac) return 0.5;
    // the outgoing action keeps playing under the new one for the length of the fade
    if (this.action && this.action.clip !== ac) this.prev = this.action;
    else if (this.action && this.action.clip === ac) this.prev = null;
    ac.time = 0;
    ac.loop = loop || !!def.loop;
    ac.speed = 1;
    ac.blendWeight = 0;
    this.action = {
      clip: ac, def, name, dur: ac.track.duration, fade: 0, fadeDur: Math.max(0.001, fadeDur), firedTo: -1,
      rm: this.rmCurves.get(def.track) ?? null, rmLast: 0, recovery, loop: ac.loop,
    };
    // AnimClip only advances while it is "playing"; restarting a finished clip needs the flag back
    (ac as unknown as { _playing: boolean })._playing = true;
    return ac.track.duration;
  }

  stopAction(): void {
    if (this.action) { this.prev = this.action; this.action = null; }
  }

  get actionName(): string | null { return this.action && !this.action.recovery ? this.action.name : null; }
  get actionProgress(): number { return this.action ? clamp01(this.action.clip.time / this.action.dur) : 1; }
  get busy(): boolean { return this.action !== null && !this.action.recovery; }
  get grounded(): boolean { return this.action?.def.ground !== false; }
  /** the skinned hands come from the animation itself; nothing to solve */
  get offHandOnWeapon(): boolean { return false; }

  consumeLunge(_dt: number): number {
    const v = this.pendingLunge;
    this.pendingLunge = 0;
    return v;
  }

  update(dt: number): void {
    this.time += dt;

    // --- locomotion: A sets the pose, B lerps over it by mix; playback rate follows real speed
    for (const c of this.clips.values()) c.blendWeight = 0;
    const a = this.locoA ? this.clips.get(this.locoA) : null;
    const b = this.locoB ? this.clips.get(this.locoB) : null;
    if (a) {
      a.blendWeight = 1;
      a.loop = true;
      a.speed = this.locoPlayback(this.locoA!, a);
      (a as unknown as { _playing: boolean })._playing = true;
      a.blendOrder = 0;
    }
    if (b && b !== a && this.locoMix > 0.001) {
      b.blendWeight = this.locoMix;
      b.loop = true;
      b.speed = this.locoPlayback(this.locoB!, b);
      (b as unknown as { _playing: boolean })._playing = true;
      b.blendOrder = 1;
      // keep the two cycles in phase, or a half-and-half blend averages a left step with a right one
      if (a) b.time = (a.time / a.track.duration) * b.track.duration;
    }

    // --- the action on top, and the one it replaced fading underneath it
    if (this.prev) {
      const p = this.prev;
      const w = this.actionWeight(p, dt) * (this.action ? 1 - easeOut(this.action.fade) : 1);
      p.clip.blendWeight = w;
      p.clip.blendOrder = 2;
      if (w <= 0.001 || p.clip.time >= p.dur - 1e-4 && !p.loop && !p.def.hold) this.prev = null;
    }
    if (this.action) {
      const ac = this.action;
      ac.fade = Math.min(1, ac.fade + dt / ac.fadeDur);
      ac.clip.blendWeight = easeOut(ac.fade) * this.actionWeight(ac, dt);
      ac.clip.blendOrder = 3;
    }

    this.evaluator.update(dt);

    // --- what the action did this frame: events, root motion, completion
    if (this.action) {
      const ac = this.action;
      const p = ac.dur > 0 ? ac.clip.time / ac.dur : 1;
      if (ac.loop && p < ac.firedTo - 0.5) {
        // wrapped: events fire again next lap, and root motion restarts from the clip's origin
        ac.firedTo = -1;
        ac.rmLast = ac.rm ? sampleCurve(ac.rm, 0) : 0;
      }
      if (ac.def.events) {
        for (const ev of ac.def.events) if (ev.t > ac.firedTo && ev.t <= p) this.onEvent(ev.name);
      }
      ac.firedTo = p;
      if (ac.rm && ac.def.rootMotion) {
        const z = sampleCurve(ac.rm, ac.clip.time);
        this.pendingLunge += (z - ac.rmLast) * ac.def.rootMotion;
        ac.rmLast = z;
      }
      if (!ac.loop && ac.clip.time >= ac.dur - 1e-4) {
        if (ac.def.hold) {
          // stay on the last frame
        } else if (ac.def.next && this.table[ac.def.next]) {
          this.start(ac.def.next, this.table[ac.def.next], 0.08, false, true);
        } else {
          this.prev = ac;
          this.action = null;
        }
      }
    }

    // --- additive life on top of the blend: breathing in the chest, the head tracking a target
    if (this.spine) {
      const br = Math.sin(this.time * 1.5) * this.breathe * 1.2 + this.lean * 5;
      this.tmpQ.setFromEulerAngles(br, 0, this.leanSide * 3);
      this.spineRest.copy(this.spine.getLocalRotation());
      this.tmpQ2.mul2(this.spineRest, this.tmpQ);
      this.spine.setLocalRotation(this.tmpQ2);
    }
    if (this.head && (this.lookYaw !== 0 || this.lookPitch !== 0)) {
      this.tmpQ.setFromEulerAngles(this.lookPitch, this.lookYaw, 0);
      this.headRest.copy(this.head.getLocalRotation());
      this.tmpQ2.mul2(this.headRest, this.tmpQ);
      this.head.setLocalRotation(this.tmpQ2);
    }
  }

  /** playback rate for a locomotion clip: real speed over the clip's own stride speed where it has one */
  private locoPlayback(track: string, clip: AnimClip): number {
    for (const d of Object.values(this.table)) {
      if (d.track !== track) continue;
      if (d.naturalSpeed) return Math.max(0.6, this.locoSpeed / d.naturalSpeed) * (d.speed ?? 1);
      return this.locoRate * clip.track.duration * (d.speed ?? 1);
    }
    return 1;
  }

  /** 1 through the body of a one-shot, easing to 0 over its last 15% so the pose hands back to locomotion */
  private actionWeight(p: Playing, _dt: number): number {
    if (p.loop || p.def.hold) return 1;
    const t = p.clip.time / Math.max(1e-4, p.dur);
    const out = p.def.next ? 1 : clamp01((1 - t) / 0.15);
    return Math.min(1, out);
  }
}

function easeOut(t: number): number { return 1 - (1 - t) ** 3; }

/** Pull the RootMotion node's translation curve out of a track, as forward metres over time. */
function rootMotionCurve(track: AnimTrack): RootMotionCurve | null {
  for (const curve of track.curves) {
    const path = curve.paths[0] as unknown as { entityPath?: string[]; propertyPath?: string[] } | string;
    const ep = typeof path === 'string' ? path : path.entityPath?.join('/') ?? '';
    const pp = typeof path === 'string' ? '' : path.propertyPath?.join('/') ?? '';
    if (!ep.endsWith('RootMotion') || pp !== 'localPosition') continue;
    const times = track.inputs[curve.input].data as Float32Array;
    const data = track.outputs[curve.output].data as Float32Array;
    const z = new Float32Array(times.length);
    for (let i = 0; i < times.length; i++) z[i] = data[i * 3 + 2];
    return { times, z };
  }
  return null;
}

function sampleCurve(c: RootMotionCurve, t: number): number {
  const n = c.times.length;
  if (n === 0) return 0;
  if (t <= c.times[0]) return c.z[0];
  if (t >= c.times[n - 1]) return c.z[n - 1];
  let i = 0;
  while (i < n - 2 && c.times[i + 1] <= t) i++;
  const a = c.times[i], b = c.times[i + 1];
  const f = b > a ? (t - a) / (b - a) : 0;
  return c.z[i] + (c.z[i + 1] - c.z[i]) * f;
}

// ------------------------------------------------------------------ the player body

export interface SocketTransform { pos: [number, number, number]; quat: [number, number, number, number]; grip: number }

/**
 * Where the katana sits in the right hand, in the hand bone's own space.
 *
 * Not eyeballed: the position is the centre of the closed fist measured from the finger bones, and
 * the rotation is fitted to the sword clips themselves — over the fast part of every swing the
 * blade has to lie across the hand's velocity with the edge leading, or the animation reads as a
 * thrust with a stick. `grip` is how far up the handle (katana-local Y) the fist closes.
 */
export const KATANA_SOCKET: SocketTransform = { pos: [-0.031, 0.111, -0.005], quat: [0.19326, 0.09009, 0.28395, 0.93483], grip: 0.04 };

export function makeSkinnedPlayer(ctx: EngineContext, container: ContainerResource): Fighter {
  const char = instantiateCharacter(container);
  const root = new Entity('player-body');
  // the GLB faces +Z; the game's forward is -Z
  const model = new Entity('model');
  model.setLocalEulerAngles(0, 180, 0);
  root.addChild(model);
  model.addChild(char.entity);

  // materials: keep the atlas's own detail, add the fresnel rim the environment lighting needs
  const mats = new Map<string, StandardMaterial>();
  for (const r of char.entity.findComponents('render') as RenderComponent[]) {
    for (const mi of r.meshInstances) {
      const m = mi.material as StandardMaterial;
      if (!mats.has(m.name)) mats.set(m.name, m);
    }
  }
  for (const [name, m] of mats) {
    if (name === 'outfit') applyRim(m, [0.55, 0.72, 0.95], 0.34, 3.0);
    else if (name.startsWith('skin')) applyRim(m, [0.9, 0.62, 0.5], 0.2, 3.5);
    else if (name === 'hair' || name === 'brows') applyRim(m, [0.55, 0.68, 0.9], 0.4, 2.6);
    m.update();
  }

  // the weapon: a socket under the hand bone, then the katana with a local offset inside it
  const hand = char.entity.findByName('hand_r') as Entity;
  const socket = new Entity('WeaponSocket');
  socket.setLocalPosition(KATANA_SOCKET.pos[0], KATANA_SOCKET.pos[1], KATANA_SOCKET.pos[2]);
  socket.setLocalRotation(new Quat(KATANA_SOCKET.quat[0], KATANA_SOCKET.quat[1], KATANA_SOCKET.quat[2], KATANA_SOCKET.quat[3]));
  hand.addChild(socket);
  const katana = buildKatana(ctx,
    characterMaterialFor(ctx, 'steel', new Color(0.84, 0.87, 0.92), 'blade'),
    characterMaterialFor(ctx, 'wrap', new Color(0.10, 0.14, 0.20), 'leather'),
    characterMaterialFor(ctx, 'fitting', new Color(0.20, 0.70, 0.80), 'metal'));
  katana.entity.setLocalPosition(0, -KATANA_SOCKET.grip, 0);
  socket.addChild(katana.entity);

  const animator = new SkinnedAnimator(char);
  const chestNode = char.entity.findByName('spine_02') as Entity;
  const chestPos = new Vec3();
  const outfit = mats.get('outfit');
  return {
    root, scale: 1, height: 1.81, weapon: katana, weaponEntity: katana.entity, animator,
    flashMats: outfit ? [outfit] : [],
    chest: () => chestPos.copy(chestNode.getPosition()),
    destroy: () => root.destroy(),
  };
}

import { characterMaterial } from './materials';
function characterMaterialFor(ctx: EngineContext, name: string, c: Color, kind: 'blade' | 'leather' | 'metal'): StandardMaterial {
  return characterMaterial(ctx, `player-${name}`, c, { kind });
}
