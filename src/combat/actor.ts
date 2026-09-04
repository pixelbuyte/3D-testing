import { Color, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { Fighter } from './characters';
import { Animator, type Clip } from './anim';
import { WeaponTrail } from './weapons';
import { clamp01, damp, dampAngle, DEG } from '@/utils/math';

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
  readonly anim: Animator;
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

  constructor(ctx: EngineContext, o: ActorOpts) {
    this.fighter = o.fighter;
    this.team = o.team;
    this.ground = o.ground;
    this.maxHealth = o.maxHealth ?? 100;
    this.health = this.maxHealth;
    // wide enough that fighters keep a readable gap: at 0.38 they piled into one clump and the
    // fight stopped being legible from any angle
    this.radius = 0.54 * o.fighter.rig.scale;
    this.runSpeed = o.runSpeed ?? 5.2;
    this.anim = new Animator(o.fighter.rig);
    this.trail = new WeaponTrail(ctx, o.trailColor, o.trailLife ?? 0.16);
    this.baseAccent = o.fighter.rig.mats.accent.emissive.clone();
    ctx.app.root.addChild(o.fighter.rig.root);
  }

  get root() { return this.fighter.rig.root; }
  get busy(): boolean { return this.locked > 0; }
  /** remaining action lock, in seconds — surfaced in the debug stats */
  get lockLeft(): number { return this.locked; }
  /** chest height, for aiming look-at and camera focus */
  get chest(): Vec3 { return this.fighter.rig.jointPos('chest'); }

  spawn(x: number, z: number, yawDeg: number): void {
    this.pos.set(x, this.ground(x, z), z);
    this.yaw = this.targetYaw = yawDeg * DEG;
    this.root.setPosition(this.pos);
    this.root.setEulerAngles(0, yawDeg, 0);
  }

  /** Lock out input/AI for `t` seconds — used for the duration of an attack or a stagger. */
  lock(t: number): void { this.locked = Math.max(this.locked, t); }

  face(x: number, z: number): void {
    this.targetYaw = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
  }

  distanceTo(o: Actor): number { return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); }

  /** Play an action clip and lock the actor for its duration (minus a little, so combos link). */
  act(clip: Clip, lockFor = clip.dur * 0.86, fade = 0.09): void {
    this.anim.play(clip, fade);
    this.lock(lockFor);
    this.hitThisSwing.clear();
  }

  setTrail(v: number): void { this.trailWant = v; }

  /** Blend locomotion by how fast the actor is actually moving. */
  setLocomotion(idle: Clip, walk: Clip, run: Clip): void {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = damp(this.speed01, clamp01(sp / this.runSpeed), 10, 1 / 60);
    if (this.speed01 < 0.02) {
      this.anim.setLocomotion(idle, null, 0, 1 / idle.dur);
    } else if (this.speed01 < 0.5) {
      const m = this.speed01 / 0.5;
      // stride rate follows real speed so the feet don't skate
      this.anim.setLocomotion(idle, walk, m, 0.55 + m * 0.85);
    } else {
      const m = (this.speed01 - 0.5) / 0.5;
      this.anim.setLocomotion(walk, run, m, 1.4 + m * 0.9);
    }
    this.anim.lean = this.speed01 * 0.7;
  }

  /** White flash on the accent material, so a hit registers even off-screen-centre. */
  hitFlash(): void { this.flash = 1; }

  damage(n: number): boolean {
    if (this.dead) return false;
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
    // root motion from a lunging attack, along the facing direction
    const lunge = this.anim.consumeLunge(dt);
    if (lunge !== 0) {
      this.pos.x += -Math.sin(this.yaw) * lunge;
      this.pos.z += -Math.cos(this.yaw) * lunge;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y = this.ground(this.pos.x, this.pos.z);
    this.yaw = dampAngle(this.yaw, this.targetYaw, 9, dt);

    this.updateVisual(dt);
  }

  /**
   * Pose, trail and timers, without moving.
   *
   * The player's position belongs to the first-person controller, so it takes this path instead of
   * update(). Splitting them matters: an earlier version had the player skip update() entirely,
   * which quietly meant its action lock never counted down (so exactly one swing ever fired) and
   * its weapon trail was never ticked.
   */
  updateVisual(dt: number): void {
    this.locked = Math.max(0, this.locked - dt);
    this.root.setPosition(this.pos);
    this.root.setEulerAngles(0, this.yaw / DEG, 0);

    this.anim.update(dt);

    // --- weapon trail
    const seg = this.weaponSegment();
    this.trail.setStrength(this.trailWant);
    this.trail.update(dt, seg.base, seg.tip);
    this.trailWant = Math.max(0, this.trailWant - dt * 5);

    // --- hit flash rides the accent emissive back down
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      const m = this.fighter.rig.mats.accent;
      const f = this.flash * this.flash;
      m.emissive.set(this.baseAccent.r + (1 - this.baseAccent.r) * f,
                     this.baseAccent.g + (1 - this.baseAccent.g) * f,
                     this.baseAccent.b + (1 - this.baseAccent.b) * f);
      m.emissiveIntensity = 0.85 + f * 5;
      m.update();
    }
  }

  /** Sink and shrink on defeat — cheap stand-in for a dissolve shader, and it reads. */
  applyDissolve(v: number): void {
    this.dissolve = v;
    const k = 1 - v;
    this.root.setLocalScale(k * 0.6 + 0.4, k, k * 0.6 + 0.4);
    this.root.setPosition(this.pos.x, this.pos.y - v * 0.85, this.pos.z);
    this.root.enabled = v < 0.995;
  }

  destroy(): void { this.trail.destroy(); this.fighter.rig.destroy(); }
}
