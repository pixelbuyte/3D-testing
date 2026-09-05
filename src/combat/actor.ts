import { Color, Mat4, Quat, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { Fighter } from './characters';
import type { Clip, FighterAnimator } from './anim';
import { WeaponTrail } from './weapons';
import { clamp01, damp, dampAngle, DEG } from '@/utils/math';
import { COMBAT } from './config';
import type { BladeSweep, Capsule } from './hitdetect';

/**
 * A fighter in the world: skeleton + animator + weapon trail + the bit of physics it needs.
 *
 * Deliberately not a physics body. Combatants move on the terrain heightfield with a capsule-ish
 * radius and push apart from each other, which is all a staged encounter on flat shrine stone
 * actually needs, and it keeps every actor's cost to a handful of transform writes.
 */

export type Team = 'player' | 'ally' | 'enemy';

export interface ActorOpts {
  fighter: Fighter;
  team: Team;
  ground: (x: number, z: number) => number;
  trailColor: Color;
  trailLife?: number;
  maxHealth?: number;
  /** metres per second at full run */
  runSpeed?: number;
}

export class Actor {
  readonly fighter: Fighter;
  readonly team: Team;
  readonly anim: FighterAnimator;
  readonly pos = new Vec3();
  readonly vel = new Vec3();
  yaw = 0;                 // radians, smoothed
  targetYaw = 0;
  health: number;
  readonly maxHealth: number;
  readonly radius: number;
  readonly runSpeed: number;
  dead = false;
  /** counts down while the actor cannot act (attacking, staggered, dodging) */
  private locked = 0;
  /** frames where an attack's damage window is open */
  hitOpen = false;
  /** the window closed during this frame's animation step: the frame's sweep still counts */
  hitTail = false;
  /** who this attack has already hit, so one swing cannot hit the same target twice */
  readonly hitThisSwing = new Set<Actor>();
  private trail: WeaponTrail;
  private trailWant = 0;
  private ground: (x: number, z: number) => number;
  private wBase = new Vec3();
  private wTip = new Vec3();
  private speed01 = 0;
  private flash = 0;
  /** 0 = solid, 1 = fully dissolved */
  dissolve = 0;
  private baseAccent: Color;
  /** seconds of invulnerability left (the dodge's opening) */
  invulnerable = 0;
  /**
   * The blade's path through this frame as a chain of sweeps, world space, valid after finish().
   * Empty when no damage window was open. While a window is pending the animation is advanced in
   * sub-steps and the blade sampled after each, so the chain follows the swing at a fixed rate no
   * matter how long the frame was: two poses a tenth of a second apart do not describe a slash.
   */
  private readonly sweeps: BladeSweep[] = [];
  private sweepCount = 0;
  /** blade samples taken during pose(), in the root's own space, with where in the frame they fell */
  private readonly samples: { base: Vec3; tip: Vec3; f: number }[] = [];
  private sampleCount = 0;
  private readonly lastLocal = { base: new Vec3(), tip: new Vec3() };
  private lastLocalValid = false;
  /** where the root stood at the end of the previous frame, so samples can be placed along its motion */
  private readonly prevPlaced = new Vec3();
  private prevPlacedYaw = 0;
  private sweepValid = false;
  private readonly rootInv = new Mat4();
  private readonly rootAt = new Mat4();
  private readonly tmpPos = new Vec3();
  private readonly tmpQuat = new Quat();
  private readonly tmpScale = new Vec3();
  private readonly capA = new Vec3();
  private readonly capB = new Vec3();
  private readonly cap: Capsule;

  constructor(ctx: EngineContext, o: ActorOpts) {
    this.fighter = o.fighter;
    this.team = o.team;
    this.ground = o.ground;
    this.maxHealth = o.maxHealth ?? 100;
    this.health = this.maxHealth;
    // wide enough that fighters keep a readable gap: at 0.38 they piled into one clump and the
    // fight stopped being legible from any angle
    this.radius = 0.54 * o.fighter.scale;
    this.runSpeed = o.runSpeed ?? 5.2;
    this.anim = o.fighter.animator;
    this.trail = new WeaponTrail(ctx, o.trailColor, o.trailLife ?? 0.16);
    this.baseAccent = o.fighter.flashMats[0]?.emissive.clone() ?? new Color(0, 0, 0);
    this.cap = { a: this.capA, b: this.capB, radius: COMBAT.hurtbox.radius * o.fighter.scale };
    ctx.app.root.addChild(o.fighter.root);
  }

  /** The blade's travel over the last frame, in order, or nothing if no damage window was open. */
  bladeSweeps(): readonly BladeSweep[] {
    if (this.sweeps.length > this.sweepCount) this.sweeps.length = this.sweepCount;
    return this.sweeps;
  }

  /** The body's hurt capsule, feet to head, in world space. */
  capsule(): Capsule {
    const s = this.fighter.scale;
    this.capA.set(this.pos.x, this.pos.y + COMBAT.hurtbox.bottom * s, this.pos.z);
    this.capB.set(this.pos.x, this.pos.y + COMBAT.hurtbox.top * s, this.pos.z);
    return this.cap;
  }

  get root() { return this.fighter.root; }
  get busy(): boolean { return this.locked > 0; }
  /** remaining action lock, in seconds — surfaced in the debug stats */
  get lockLeft(): number { return this.locked; }
  /** chest height, for aiming look-at and camera focus */
  get chest(): Vec3 { return this.fighter.chest(); }

  spawn(x: number, z: number, yawDeg: number): void {
    this.pos.set(x, this.ground(x, z), z);
    this.yaw = this.targetYaw = yawDeg * DEG;
    this.root.setPosition(this.pos);
    this.root.setEulerAngles(0, yawDeg, 0);
    // do not sweep the blade in from wherever the body was before
    this.sweepValid = false;
    this.lastLocalValid = false;
  }

  /** Lock out input/AI for `t` seconds — used for the duration of an attack or a stagger. */
  lock(t: number): void { this.locked = Math.max(this.locked, t); }

  face(x: number, z: number): void {
    this.targetYaw = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
  }

  distanceTo(o: Actor): number { return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); }

  /**
   * Play an action clip and lock the actor for a fraction of however long it actually takes
   * (a little under the whole clip, so combos link). The fraction is of the body's own clip
   * length: a skinned body's slash and the procedural one's are not the same duration.
   */
  act(clip: Clip, lockFrac = 0.86, fade = 0.09): number {
    const dur = this.anim.play(clip, fade);
    this.lock(dur * lockFrac);
    this.hitThisSwing.clear();
    // an interrupting action closes whatever damage window the previous one left open
    this.hitOpen = false;
    this.hitTail = false;
    return dur;
  }

  setTrail(v: number): void { this.trailWant = v; }

  /** Blend locomotion by how fast the actor is actually moving. */
  setLocomotion(idle: Clip, walk: Clip, run: Clip, dt = 1 / 60): void {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = damp(this.speed01, clamp01(sp / this.runSpeed), 10, dt);
    if (this.speed01 < 0.02) {
      this.anim.setLocomotion(idle, null, 0, 1 / idle.dur, sp);
    } else if (this.speed01 < 0.5) {
      const m = this.speed01 / 0.5;
      // stride rate follows real speed so the feet don't skate
      this.anim.setLocomotion(idle, walk, m, 0.55 + m * 0.85, sp);
    } else {
      const m = (this.speed01 - 0.5) / 0.5;
      this.anim.setLocomotion(walk, run, m, 1.4 + m * 0.9, sp);
    }
    this.anim.lean = this.speed01 * 0.7;
  }

  /** White flash on the accent material, so a hit registers even off-screen-centre. */
  hitFlash(): void { this.flash = 1; }

  damage(n: number): boolean {
    if (this.dead || !Number.isFinite(n) || n <= 0) return false;
    this.health -= n;
    this.hitFlash();
    if (this.health <= 0) { this.health = 0; this.dead = true; return true; }
    return false;
  }

  /** World-space endpoints of the cutting edge this frame. */
  weaponSegment(): { base: Vec3; tip: Vec3 } {
    const w = this.fighter.weaponEntity;
    w.getWorldTransform().transformPoint(this.fighter.weapon.base, this.wBase);
    w.getWorldTransform().transformPoint(this.fighter.weapon.tip, this.wTip);
    return { base: this.wBase, tip: this.wTip };
  }

  /** Move under our own steam, then pose. Used by everyone except the player. */
  update(dt: number): void {
    this.pose(dt);
    // root motion from a lunging attack, along the facing direction, on the frame the clip moved
    const lunge = this.anim.consumeLunge(dt);
    if (lunge !== 0) {
      this.pos.x += -Math.sin(this.yaw) * lunge;
      this.pos.z += -Math.cos(this.yaw) * lunge;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y = this.ground(this.pos.x, this.pos.z);
    this.yaw = dampAngle(this.yaw, this.targetYaw, 9, dt);
    this.finish(dt);
  }

  /**
   * Advance the animation. The caller then moves `pos` (its own velocity plus whatever root motion
   * consumeLunge() reports for this frame) and calls finish(), which places the body and reads the
   * blade. The player's position belongs to the first-person controller, which is why this is
   * split: the controller integrates between the two halves.
   *
   * While an attack's damage window is pending or open, the frame is cut into sub-steps no longer
   * than the configured sample step and the blade is recorded after each one, in the root's own
   * space (the root has not moved yet). finish() lays those samples along the root's motion.
   */
  pose(dt: number): void {
    this.locked = Math.max(0, this.locked - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.sampleCount = 0;
    const fine = this.anim.sweeping;
    const n = fine ? Math.max(1, Math.min(COMBAT.blade.maxSamples, Math.ceil(dt / COMBAT.blade.sampleStep - 1e-6))) : 1;
    if (fine) this.rootInv.copy(this.root.getWorldTransform()).invert();
    const sub = dt / n;
    for (let k = 1; k <= n; k++) {
      this.anim.update(sub);
      if (!fine) continue;
      // the window closed during this sub-step: the sub-step's own travel still counts
      const active = this.hitOpen || this.hitTail;
      this.hitTail = false;
      const seg = this.weaponSegment();
      const f = k / n;
      if (active) {
        if (this.sampleCount === 0) {
          // the chain starts from where the blade was before this sub-step
          const s0 = this.sample(this.sampleCount++);
          if (this.lastLocalValid) { s0.base.copy(this.lastLocal.base); s0.tip.copy(this.lastLocal.tip); }
          else { this.rootInv.transformPoint(seg.base, s0.base); this.rootInv.transformPoint(seg.tip, s0.tip); }
          s0.f = (k - 1) / n;
        }
        const sm = this.sample(this.sampleCount++);
        this.rootInv.transformPoint(seg.base, sm.base);
        this.rootInv.transformPoint(seg.tip, sm.tip);
        sm.f = f;
      }
      this.rootInv.transformPoint(seg.base, this.lastLocal.base);
      this.rootInv.transformPoint(seg.tip, this.lastLocal.tip);
      this.lastLocalValid = true;
    }
    if (!fine) {
      this.hitTail = false;
      this.lastLocalValid = false;   // the next fine frame starts its chain from its own first sample
    }
  }

  private sample(i: number): { base: Vec3; tip: Vec3; f: number } {
    let s = this.samples[i];
    if (!s) { s = { base: new Vec3(), tip: new Vec3(), f: 0 }; this.samples[i] = s; }
    return s;
  }

  private sweepAt(i: number): BladeSweep {
    let s = this.sweeps[i];
    if (!s) { s = { prevBase: new Vec3(), prevTip: new Vec3(), base: new Vec3(), tip: new Vec3() }; this.sweeps[i] = s; }
    return s;
  }

  /** Place the body at `pos`/`yaw`, lay the frame's blade samples along the root's motion, tick trail and flash. */
  finish(dt: number): void {
    // a dissolving body sinks; the shrink happens in applyDissolve
    const py = this.pos.y - this.dissolve * 0.85;
    this.root.setPosition(this.pos.x, py, this.pos.z);
    this.root.setEulerAngles(0, this.yaw / DEG, 0);
    if (!this.sweepValid) { this.prevPlaced.set(this.pos.x, py, this.pos.z); this.prevPlacedYaw = this.yaw; this.sweepValid = true; }

    // --- the blade's travel this frame: each sample placed where the root was at that point of the frame
    this.sweepCount = 0;
    if (this.sampleCount > 1) {
      const scale = this.root.getLocalScale();
      let dyaw = this.yaw - this.prevPlacedYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      let prev = this.sample(0);
      let prevIsPlaced = false;
      for (let i = 1; i < this.sampleCount; i++) {
        const cur = this.sample(i);
        const sw = this.sweepAt(this.sweepCount++);
        if (!prevIsPlaced) this.place(prev, dyaw, scale, sw.prevBase, sw.prevTip);
        else { sw.prevBase.copy(this.sweeps[this.sweepCount - 2].base); sw.prevTip.copy(this.sweeps[this.sweepCount - 2].tip); }
        this.place(cur, dyaw, scale, sw.base, sw.tip);
        prev = cur; prevIsPlaced = true;
      }
    }
    this.prevPlaced.set(this.pos.x, py, this.pos.z);
    this.prevPlacedYaw = this.yaw;

    // --- weapon trail
    const seg = this.weaponSegment();
    this.trail.setStrength(this.trailWant);
    this.trail.update(dt, seg.base, seg.tip);
    this.trailWant = Math.max(0, this.trailWant - dt * 5);

    // --- hit flash rides the accent emissive back down
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      const f = this.flash * this.flash;
      for (const m of this.fighter.flashMats) {
        m.emissive.set(this.baseAccent.r + (1 - this.baseAccent.r) * f,
                       this.baseAccent.g + (1 - this.baseAccent.g) * f,
                       this.baseAccent.b + (1 - this.baseAccent.b) * f);
        m.emissiveIntensity = 0.85 + f * 5;
        m.update();
      }
    }
  }

  /** A root-space sample into world space, with the root interpolated along this frame's motion. */
  private place(s: { base: Vec3; tip: Vec3; f: number }, dyaw: number, scale: Vec3, outBase: Vec3, outTip: Vec3): void {
    const py = this.pos.y - this.dissolve * 0.85;
    this.tmpPos.set(
      this.prevPlaced.x + (this.pos.x - this.prevPlaced.x) * s.f,
      this.prevPlaced.y + (py - this.prevPlaced.y) * s.f,
      this.prevPlaced.z + (this.pos.z - this.prevPlaced.z) * s.f,
    );
    this.tmpQuat.setFromEulerAngles(0, (this.prevPlacedYaw + dyaw * s.f) / DEG, 0);
    this.tmpScale.copy(scale);
    this.rootAt.setTRS(this.tmpPos, this.tmpQuat, this.tmpScale);
    this.rootAt.transformPoint(s.base, outBase);
    this.rootAt.transformPoint(s.tip, outTip);
  }

  /** Pose and place without moving: the turntable preview. */
  updateVisual(dt: number): void { this.pose(dt); this.finish(dt); }

  /** Sink and shrink on defeat — cheap stand-in for a dissolve shader, and it reads. */
  applyDissolve(v: number): void {
    this.dissolve = v;
    const k = 1 - v;
    this.root.setLocalScale(k * 0.6 + 0.4, k, k * 0.6 + 0.4);
    this.root.enabled = v < 0.995;
  }

  destroy(): void { this.trail.destroy(); this.fighter.destroy(); }
}
