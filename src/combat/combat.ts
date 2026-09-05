import { Color, Vec3, type ContainerResource } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { World } from '@/world/world';
import type { AudioEngine } from '@/audio/audio';
import type { HUD } from '@/ui/hud';
import type { PlayerController } from '@/player/controller';
import type { Input } from '@/player/input';
import { Actor } from './actor';
import type { EnemyKind, Fighter } from './characters';
import { makeSkinnedFighter, makeSkinnedPlayer } from './skinned';
import type { AssetBank } from '@/assets/manifest';
import * as C from './clips';
import { CombatFX } from './fx';
import { COMBAT } from './config';
import { CombatDebugDraw } from './debugdraw';
import { facingDot, sweepBlade, type SweepHit } from './hitdetect';
import { clamp01, damp, DEG, rng, smoothstep } from '@/utils/math';

/**
 * The combat layer.
 *
 * Scope is deliberately small: one player, one ally, three staged encounters of two to four
 * enemies. Everything is a flat state machine driven by animation events — an attack opens its
 * damage window at `hitOpen` and closes it at `hitClose`, so the hit always lands on the frame the
 * blade is actually through the target rather than on a timer that drifts from the animation.
 *
 * The player keeps the tuned first-person controller for movement; this only borrows its position,
 * scales its speed during attacks, and swings the camera out to third person so the character and
 * the weapon arcs are visible.
 */

type EnemyState = 'idle' | 'alert' | 'approach' | 'combatIdle' | 'attack' | 'recover' | 'hit' | 'stagger' | 'dying';

interface Enemy {
  actor: Actor;
  state: EnemyState;
  timer: number;
  /** length of the attack clip the body is playing, so the wind-up knows when to stop tracking */
  attackDur: number;
  /** stable id for tooling (array indices shift when a body is reaped) */
  id: number;
  /** seconds until this enemy may swing again */
  cooldown: number;
  /** hysteresis for holding a ring slot without jittering at its edge */
  moving: boolean;
  /** tooling: never leaves idle (the hit lab's target dummy) */
  held?: boolean;
  kind: EnemyKind;
  /** slot around the player, so they surround instead of stacking */
  slot: number;
  dieT: number;
  encounter: number;
}

interface Encounter {
  id: number;
  x: number; z: number;
  radius: number;
  spawns: { kind: EnemyKind; dx: number; dz: number }[];
  banner: string;
  /** the ally joins from this one on */
  allyJoins: boolean;
  triggered: boolean;
  cleared: boolean;
}

function requireModel(assets: AssetBank | undefined, id: string): ContainerResource {
  if (!assets?.hasModel(id)) throw new Error(`character model not loaded: ${id}`);
  return assets.model(id);
}


export class CombatDirector {
  private player!: Actor;
  private ally!: Actor;
  private enemies: Enemy[] = [];
  private fx: CombatFX;
  private rand = rng(4242);
  private encounters: Encounter[];
  private active: Encounter | null = null;
  private combo = 0;
  private comboWindow = 0;
  private dodgeCd = 0;
  /** how much of an attack's scripted lunge to actually apply, set when the swing starts */
  private lungeScale = 0;
  private hitStop = 0;
  private shake = 0;
  private time = 0;
  private allySpawned = false;
  private allyTimer = 0;
  private allyTarget: Enemy | null = null;
  /** only the enemy holding this may close and strike; everyone else circles */
  private attackToken: Enemy | null = null;
  private tokenTimer = 0;
  private taughtControls = false;
  private playerHealth: number = COMBAT.player.maxHealth;
  private playerHurtCd = 0;
  private debugDraw: CombatDebugDraw;
  private hitOut: SweepHit = { point: new Vec3(), t: 0, distance: 0 };
  private enemyActorList: Actor[] = [];
  /** tooling: per-frame sweep records while set */
  trace: Record<string, unknown>[] | null = null;
  private nextEnemyId = 1;
  private playerTargets: Actor[] = [];
  private banner = '';
  private bannerT = 0;
  private tmp = new Vec3();
  /** exposed so the game loop can add camera shake without combat owning the camera */
  shakeAmount = 0;
  cleared = false;

  constructor(
    private ctx: EngineContext,
    private world: World,
    private audio: AudioEngine,
    private hud: HUD,
    private controller: PlayerController,
    private assets?: AssetBank,
  ) {
    const g = (x: number, z: number): number => world.field.heightAt(x, z);
    this.debugDraw = new CombatDebugDraw(ctx.app);
    this.fx = new CombatFX(ctx);

    this.player = new Actor(ctx, {
      fighter: makeSkinnedPlayer(ctx, requireModel(assets, 'char/player')), team: 'player', ground: g,
      trailColor: new Color(0.62, 0.90, 1.0), trailLife: 0.15, maxHealth: 100, runSpeed: 6.0,
    });
    this.player.root.enabled = false;
    this.playerTargets = [this.player];

    this.ally = new Actor(ctx, {
      fighter: makeSkinnedFighter(ctx, requireModel(assets, 'char/ally'), 'ally'), team: 'ally', ground: g,
      trailColor: new Color(1.0, 0.62, 0.28), trailLife: 0.22, maxHealth: 999, runSpeed: 5.6,
    });
    this.ally.root.enabled = false;

    // --- three staged fights along the existing route through the level
    this.encounters = [
      {
        id: 0, x: 0, z: -24, radius: 13, banner: 'THEY FOLLOWED YOU UP THE PATH',
        allyJoins: false, triggered: false, cleared: false,
        spawns: [{ kind: 'grunt', dx: -2.4, dz: 6.5 }, { kind: 'grunt', dx: 2.8, dz: 8.0 }],
      },
      {
        id: 1, x: 0, z: -2, radius: 15, banner: 'THE COURTYARD IS NOT EMPTY',
        allyJoins: true, triggered: false, cleared: false,
        spawns: [
          { kind: 'grunt', dx: -6.0, dz: 5.5 }, { kind: 'blade', dx: 5.2, dz: 6.2 },
          { kind: 'grunt', dx: 0.4, dz: 9.0 },
        ],
      },
      {
        id: 2, x: 0, z: 34, radius: 15, banner: 'SOMETHING OLD GUARDS THE SHRINE',
        allyJoins: true, triggered: false, cleared: false,
        spawns: [
          { kind: 'elite', dx: 0.0, dz: 6.0 },
          { kind: 'blade', dx: -5.0, dz: 4.0 }, { kind: 'blade', dx: 5.0, dz: 4.0 },
        ],
      },
    ];

    this.player.anim.setEventHandler((n) => this.onPlayerEvent(n));
    this.ally.anim.setEventHandler((n) => this.onAllyEvent(n));
  }

  // ---------------------------------------------------------------- events

  private onPlayerEvent(name: string): void {
    const p = this.player;
    switch (name) {
      case 'swing':
        p.setTrail(1);
        this.audio.playCombat('swing', p.pos);
        break;
      case 'swingHeavy':
        p.setTrail(1);
        this.audio.playCombat('swingHeavy', p.pos);
        break;
      case 'chargeUp':
        this.fx.charge(p.weaponSegment().tip, new Color(0.55, 0.9, 1.0));
        break;
      case 'hitOpen': p.hitOpen = true; p.hitThisSwing.clear(); break;
      case 'hitClose': p.hitOpen = false; p.hitTail = true; break;
      case 'dodge': this.audio.playCombat('dodge', p.pos); break;
      case 'step': this.audio.playFootstep(this.world.field.surfaceAt(p.pos.x, p.pos.z), 0.7, false); break;
    }
  }

  private onAllyEvent(name: string): void {
    const a = this.ally;
    switch (name) {
      case 'swing': a.setTrail(1); this.audio.playCombat('swingLight', a.pos); break;
      case 'hitOpen': a.hitOpen = true; a.hitThisSwing.clear(); break;
      case 'hitClose': a.hitOpen = false; a.hitTail = true; break;
      case 'step': this.audio.playFootstep(this.world.field.surfaceAt(a.pos.x, a.pos.z), 0.5, false); break;
    }
  }

  // ---------------------------------------------------------------- update

  private lastDt = 0;
  private ticks = 0;
  update(dt: number, input: Input, freeCam: boolean): void {
    this.lastDt = dt; this.ticks++;
    this.time += dt;
    if (this.previewMode) { this.updatePreview(dt); return; }
    // hit-stop: freeze for a couple of frames on a landed blow, which is most of the impact
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.12; }

    this.updateTriggers();
    // The fight keeps running under a debug/free camera — only the input and the camera coupling
    // are suspended — so screenshots and captures can be framed without freezing the action.
    this.updatePlayer(dt, input, !freeCam);
    this.updateEnemies(dt);
    this.updateAlly(dt);
    this.separate(dt);

    if (this.debugDraw.enabled) {
      this.debugDraw.capsule(this.player.capsule(), this.playerHurtCd > 0);
      if (this.ally.root.enabled) this.debugDraw.capsule(this.ally.capsule());
      for (const e of this.enemies) if (!e.actor.dead) this.debugDraw.capsule(e.actor.capsule());
    }
    this.debugDraw.update(dt);

    this.shake = damp(this.shake, 0, 7, dt);
    this.shakeAmount = this.shake;
    this.fx.update(dt);

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner = '';
    }
  }

  /** Arm the next encounter when the player walks into its zone. */
  private updateTriggers(): void {
    const p = this.controller.pos;
    for (const e of this.encounters) {
      if (e.triggered) continue;
      if (Math.hypot(p.x - e.x, p.z - e.z) > e.radius) continue;
      e.triggered = true;
      this.active = e;
      this.banner = e.banner;
      this.bannerT = 4;
      this.hud.showToast(e.banner, 4);
      if (!this.taughtControls) {
        this.taughtControls = true;
        setTimeout(() => this.hud.showToast('LMB STRIKE  ·  RMB HEAVY  ·  SPACE EVADE', 6), 4200);
      }
      this.audio.playCombat('encounter', this.tmp.set(e.x, p.y, e.z));
      for (let i = 0; i < e.spawns.length; i++) {
        const sp = e.spawns[i];
        const x = e.x + sp.dx, z = e.z + sp.dz;
        const a = new Actor(this.ctx, {
          fighter: this.enemyFighter(sp.kind),
          team: 'enemy',
          ground: (gx, gz) => this.world.field.heightAt(gx, gz),
          trailColor: sp.kind === 'elite' ? new Color(1.0, 0.35, 0.4) : new Color(0.75, 0.4, 1.0),
          trailLife: 0.13,
          maxHealth: COMBAT.enemy.maxHealth[sp.kind] ?? 65,
          runSpeed: sp.kind === 'elite' ? 3.6 : 4.4,
        });
        a.spawn(x, z, 180);
        const en: Enemy = { actor: a, state: 'idle', timer: 0.35 + i * 0.22, attackDur: 0.5, id: this.nextEnemyId++, cooldown: 0.6 + i * 0.3, moving: false, kind: sp.kind, slot: i, dieT: 0, encounter: e.id };
        a.anim.setEventHandler((n) => this.onEnemyEvent(en, n));
        this.enemies.push(en);
        this.fx.spawnPuff(a.pos, sp.kind === 'elite' ? new Color(1, 0.4, 0.45) : new Color(0.6, 0.3, 0.9));
      }
      if (e.allyJoins && !this.allySpawned) {
        this.allySpawned = true;
        this.ally.root.enabled = true;
        this.ally.spawn(e.x - 3.2, e.z - 3.0, 0);
        this.fx.spawnPuff(this.ally.pos, new Color(1, 0.6, 0.3));
        this.hud.showToast('AN ALLY STEPS OUT OF THE TREES', 3.5);
      }
    }
  }

  private onEnemyEvent(en: Enemy, name: string): void {
    switch (name) {
      case 'telegraph':
        this.fx.charge(en.actor.chest, new Color(0.9, 0.3, 1.0));
        this.audio.playCombat('telegraph', en.actor.pos);
        break;
      case 'swing': en.actor.setTrail(1); this.audio.playCombat('swingEnemy', en.actor.pos); break;
      case 'hitOpen': en.actor.hitOpen = true; en.actor.hitThisSwing.clear(); break;
      case 'hitClose': en.actor.hitOpen = false; en.actor.hitTail = true; break;
      case 'step': this.audio.playFootstep(this.world.field.surfaceAt(en.actor.pos.x, en.actor.pos.z), 0.55, false); break;
    }
  }

  // ---------------------------------------------------------------- player

  private updatePlayer(dt: number, input: Input, live: boolean): void {
    const p = this.player;
    const c = this.controller;
    const inFight = this.liveEnemies() > 0;

    // the body follows the controller; combat only ever nudges it
    p.pos.set(c.pos.x, c.pos.y, c.pos.z);
    p.vel.set(c.vel.x, 0, c.vel.z);
    p.yaw = p.targetYaw = c.yaw;
    p.root.enabled = c.thirdPersonBlend > 0.02 || inFight;

    if (live) {
      c.thirdPerson = inFight;
      // Space becomes the evade while a fight is live; hopping mid-duel reads as a bug
      c.suppressJump = inFight;
      // during an attack the character commits: movement drops away and the lunge carries them
      c.speedScale = p.busy ? 0.25 : 1;
    }

    this.comboWindow = Math.max(0, this.comboWindow - dt);
    if (this.comboWindow <= 0 && !p.busy) this.combo = 0;
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.playerHurtCd = Math.max(0, this.playerHurtCd - dt);

    // --- input
    if (live && !p.busy) {
      if (input.wasPressed('Mouse0')) {
        const clip = this.combo === 0 ? C.SLASH_1 : this.combo === 1 ? C.SLASH_2 : C.SLASH_3;
        p.act(clip, this.combo === 2 ? 0.9 : 0.68);
        this.combo = (this.combo + 1) % 3;
        this.comboWindow = 0.85;
        this.softTarget();
      } else if (input.wasPressed('Mouse2')) {
        p.act(C.HEAVY, 0.92);
        this.combo = 0;
        this.softTarget();
      } else if ((input.wasPressed('Space') || input.wasPressed('KeyQ')) && this.dodgeCd <= 0 && inFight) {
        p.act(C.DODGE, 0.8);
        p.invulnerable = COMBAT.player.dodgeInvulnerable;
        this.dodgeCd = 0.75;
        this.lungeScale = 1;
        this.fx.dust(p.pos, 10);
      }
    }

    p.setLocomotion(inFight ? C.GUARD : C.IDLE, C.WALK, C.RUN, dt);
    p.anim.breathe = p.busy ? 0.2 : 1;
    p.setTrail(p.hitOpen ? 1 : 0);
    p.pose(dt);

    // lunges move the character, not just the model — scaled by whether there is anything to close on
    const lunge = p.anim.consumeLunge(dt) * (p.anim.actionName === 'dodge' ? 1 : this.lungeScale);
    if (lunge !== 0) {
      c.pos.x += -Math.sin(c.yaw) * lunge;
      c.pos.z += -Math.cos(c.yaw) * lunge;
      p.pos.set(c.pos.x, c.pos.y, c.pos.z);
    }
    p.finish(dt);

    // the hit sweep reads the blade only after the pose has been applied, so the damage window
    // matches the frame the blade is actually through the target
    this.sweepAttack(p, this.enemyActors(), (t, at) => this.landHit(p, this.enemyOf(t), at));
  }

  /**
   * Turn toward the nearest enemy in front when a swing starts, and remember how far away it was.
   *
   * The distance feeds the lunge: an attack that always slides you a metre forward walks you out of
   * the fight when you swing at air, so the step-in only happens when there is something to step
   * toward, and only far enough to reach it.
   */
  /** Face a target without touching the lunge scale (used by the dodge). */
  private softTargetFace(): void { const keep = this.lungeScale; this.softTarget(); this.lungeScale = keep; }

  private softTarget(): void {
    let best: Enemy | null = null, bd = 6.5;
    for (const e of this.enemies) {
      if (e.actor.dead) continue;
      const d = e.actor.distanceTo(this.player);
      if (d > bd) continue;
      const dx = e.actor.pos.x - this.player.pos.x, dz = e.actor.pos.z - this.player.pos.z;
      const fx = -Math.sin(this.controller.yaw), fz = -Math.cos(this.controller.yaw);
      if ((dx * fx + dz * fz) / Math.max(0.01, d) < 0.25) continue;   // must be roughly in front
      bd = d; best = e;
    }
    this.lungeScale = best ? clamp01((bd - 1.5) / 1.6) : 0.12;
    if (best) {
      const want = Math.atan2(-(best.actor.pos.x - this.player.pos.x), -(best.actor.pos.z - this.player.pos.z));
      // nudge the camera yaw rather than snapping it: the player keeps authority
      let d = want - this.controller.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.controller.nudgeYaw(d * 0.55);
    }
  }

  // ---------------------------------------------------------------- enemies

  private updateEnemies(dt: number): void {
    const target = this.player;
    this.tokenTimer -= dt;
    if (!this.attackToken || this.attackToken.actor.dead || this.tokenTimer <= 0) this.passToken();
    for (const e of this.enemies) {
      const a = e.actor;
      if (e.state === 'dying') {
        e.dieT += dt;
        a.applyDissolve(clamp01((e.dieT - 1.0) / 0.9));
        a.vel.set(0, 0, 0);
        a.update(dt);
        continue;
      }
      e.timer -= dt;
      e.cooldown -= dt;
      const d = a.distanceTo(target);
      const mine = this.attackToken === e;

      switch (e.state) {
        // spawned, not yet aware: stands until the player is close or the spawn stagger elapses
        case 'idle':
          a.vel.set(0, 0, 0);
          if (e.timer <= 0 && d < COMBAT.enemy.alertRadius) { e.state = 'alert'; e.timer = 0.25 + this.rand() * 0.3; }
          break;

        // noticed: turn to face, then commit to closing in
        case 'alert':
          a.vel.set(0, 0, 0);
          a.face(target.pos.x, target.pos.z);
          if (e.timer <= 0) e.state = 'approach';
          break;

        // close to a slot on the ring around the player; the token holder's ring is inside reach
        case 'approach': {
          a.face(target.pos.x, target.pos.z);
          const arrived = this.steerToSlot(e, a, target, mine, d);
          if (arrived) { e.state = 'combatIdle'; e.timer = 0; }
          break;
        }

        // at range: hold the slot, face the player, wait for the token, the cooldown and reach
        case 'combatIdle': {
          a.face(target.pos.x, target.pos.z);
          const arrived = this.steerToSlot(e, a, target, mine, d);
          if (!arrived && d > COMBAT.enemy.holdRange * 1.6) { e.state = 'approach'; break; }
          if (mine && e.cooldown <= 0 && d < COMBAT.enemy.attackRange && !a.busy) {
            const clip = this.rand() < 0.35 ? C.ENEMY_ATTACK_2 : C.ENEMY_ATTACK;
            e.attackDur = a.act(clip, 0.95);
            a.vel.set(0, 0, 0);
            e.state = 'attack';
            e.timer = e.attackDur;
          }
          break;
        }

        // the swing: anticipation, active window and follow-through are the clip's own; the body
        // tracks the player only through the anticipation so the cut cannot curve after it commits
        case 'attack':
          a.vel.set(0, 0, 0);
          if (e.timer > e.attackDur * 0.6) a.face(target.pos.x, target.pos.z);
          if (e.timer <= 0) {
            e.state = 'recover';
            e.timer = 0.35 + this.rand() * 0.45;
            e.cooldown = COMBAT.enemy.cooldown + this.rand() * COMBAT.enemy.cooldownSpread;
          }
          break;

        // step back out of reach after committing, which resets the spacing for the next pass
        case 'recover': {
          const bx = a.pos.x - target.pos.x, bz = a.pos.z - target.pos.z, bl = Math.hypot(bx, bz) || 1;
          a.vel.set((bx / bl) * 1.9, 0, (bz / bl) * 1.9);
          a.face(target.pos.x, target.pos.z);
          if (e.timer <= 0) { e.state = 'combatIdle'; this.passToken(); }
          break;
        }

        // a light hit: the flinch plays out, then back to the ring
        case 'hit':
          a.vel.set(0, 0, 0);
          if (e.timer <= 0) { e.state = e.held ? 'idle' : 'combatIdle'; e.timer = e.held ? 1e9 : 0; e.cooldown = Math.max(e.cooldown, 0.4); }
          break;

        // an interrupted wind-up or a heavy blow: longer, with a small shove backwards
        case 'stagger': {
          const bx = a.pos.x - target.pos.x, bz = a.pos.z - target.pos.z, bl = Math.hypot(bx, bz) || 1;
          const push = Math.max(0, e.timer) * 0.9;
          a.vel.set((bx / bl) * push, 0, (bz / bl) * push);
          if (e.timer <= 0) { e.state = e.held ? 'idle' : 'combatIdle'; e.timer = e.held ? 1e9 : 0; e.cooldown = Math.max(e.cooldown, 0.7); }
          break;
        }
      }

      a.setLocomotion(C.ENEMY_IDLE, C.ENEMY_RUN, C.ENEMY_RUN, dt);
      a.update(dt);
      a.setTrail(a.hitOpen ? 1 : 0);
      this.sweepAttack(a, this.playerTargets, (_t, at) => this.hurtPlayer(a, at));
    }

    // reap fully dissolved enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.state === 'dying' && e.actor.dissolve >= 0.995) { e.actor.destroy(); this.enemies.splice(i, 1); }
    }

    if (this.active && this.liveEnemies() === 0 && !this.active.cleared) {
      this.active.cleared = true;
      this.hud.showToast(this.active.id === 2 ? 'THE WAY IS CLEAR' : 'CLEAR — FOR NOW', 3);
      this.audio.playCombat('clear', this.player.pos);
      this.controller.speedScale = 1;
      if (this.encounters.every((x) => x.cleared)) this.cleared = true;
      this.active = null;
    }
  }

  /**
   * Move toward this enemy's slot on the ring around the player. Returns true once it is there.
   * The stop/start band is asymmetric so an enemy holding its slot does not shiver at the edge.
   */
  private steerToSlot(e: Enemy, a: Actor, target: Actor, mine: boolean, d: number): boolean {
    const ring = mine ? COMBAT.enemy.attackRange * 0.85 : COMBAT.enemy.holdRange;
    const ang = this.slotAngle(e);
    const wantX = target.pos.x + Math.sin(ang) * ring;
    const wantZ = target.pos.z + Math.cos(ang) * ring;
    const dx = wantX - a.pos.x, dz = wantZ - a.pos.z;
    const dl = Math.hypot(dx, dz);
    if (e.moving ? dl < 0.25 : dl > 0.6) e.moving = !e.moving;
    if (e.moving) {
      const sp = a.runSpeed * (d < 5 ? 0.62 : 1);
      a.vel.set((dx / dl) * sp, 0, (dz / dl) * sp);
    } else {
      a.vel.set(0, 0, 0);
    }
    return !e.moving;
  }

  /**
   * Hand the right to attack to the closest live enemy, preferring the elite.
   *
   * Without this every enemy in range commits at once, which reads as a pile-on and is impossible
   * to defend against; with it the fight has a rhythm and the other enemies stay visible.
   */
  private passToken(): void {
    const live = this.enemies.filter((e) => !e.actor.dead && e.state !== 'dying');
    if (!live.length) { this.attackToken = null; return; }
    live.sort((a, b) => {
      const ea = a.kind === 'elite' ? -1 : 0, eb = b.kind === 'elite' ? -1 : 0;
      if (ea !== eb) return ea - eb;
      return a.actor.distanceTo(this.player) - b.actor.distanceTo(this.player);
    });
    // don't hand it straight back to whoever just used it
    const next = live.find((e) => e !== this.attackToken) ?? live[0];
    this.attackToken = next;
    this.tokenTimer = 2.4 + this.rand() * 1.4;
  }

  private slotAngle(e: Enemy): number {
    const live = this.enemies.filter((x) => !x.actor.dead).length || 1;
    return (e.slot / live) * Math.PI * 2 + this.time * 0.25;
  }

  // ---------------------------------------------------------------- ally

  private updateAlly(dt: number): void {
    if (!this.allySpawned) return;
    const a = this.ally;
    const live = this.enemies.filter((e) => !e.actor.dead);
    this.allyTimer -= dt;

    if (!this.allyTarget || this.allyTarget.actor.dead) {
      this.allyTarget = null;
      let bd = 999;
      for (const e of live) {
        const d = e.actor.distanceTo(a);
        if (d < bd) { bd = d; this.allyTarget = e; }
      }
    }

    if (this.allyTarget && !a.busy) {
      const t = this.allyTarget.actor;
      const d = a.distanceTo(t);
      a.face(t.pos.x, t.pos.z);
      if (d > 2.1) {
        const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, dl = Math.hypot(dx, dz) || 1;
        a.vel.set((dx / dl) * a.runSpeed, 0, (dz / dl) * a.runSpeed);
      } else {
        a.vel.set(0, 0, 0);
        if (this.allyTimer <= 0) {
          a.act(C.NUN_COMBO, 0.9);
          this.allyTimer = 0.9 + this.rand() * 0.7;
        }
      }
    } else if (!a.busy) {
      // no enemies: fall in behind the player, and show off now and then
      const px = this.controller.pos.x - Math.sin(this.controller.yaw + 0.9) * 2.6;
      const pz = this.controller.pos.z - Math.cos(this.controller.yaw + 0.9) * 2.6;
      const dx = px - a.pos.x, dz = pz - a.pos.z, dl = Math.hypot(dx, dz);
      if (dl > 1.6) {
        a.vel.set((dx / dl) * Math.min(a.runSpeed, dl * 1.6), 0, (dz / dl) * Math.min(a.runSpeed, dl * 1.6));
        a.face(px, pz);
      } else {
        a.vel.set(0, 0, 0);
        a.face(this.controller.pos.x, this.controller.pos.z);
        if (this.allyTimer <= 0 && this.rand() < 0.5) {
          a.act(C.NUN_FLOURISH, 0.95);
        }
        if (this.allyTimer <= 0) this.allyTimer = 3.5 + this.rand() * 4;
      }
    }

    a.setLocomotion(C.NUN_IDLE, C.WALK, C.RUN, dt);
    // the free chuck spins constantly — it is most of what sells the character
    if (a.fighter.freeChuck) a.fighter.freeChuck.setLocalEulerAngles(0, 0, (this.time * 620) % 360);
    a.update(dt);
    a.setTrail(a.hitOpen ? 1 : 0.25);
    this.sweepAttack(a, this.enemyActors(), (t, at) => this.landHit(a, this.enemyOf(t), at));
  }

  // ---------------------------------------------------------------- hits

  /**
   * Sweep an attacker's blade through the frame against every candidate body. A target is hit at
   * most once per swing, only while the clip's damage window is open, only if it sits in front of
   * the attacker, and only if nothing solid stands between the attacker and the point of contact.
   */
  private sweepAttack(src: Actor, targets: readonly Actor[], onHit: (target: Actor, at: Vec3) => void): void {
    const sweeps = src.bladeSweeps();
    if (sweeps.length === 0) return;
    let landed = false;
    for (const t of targets) {
      if (t === src || t.dead || src.hitThisSwing.has(t)) continue;
      const facing = facingDot(src.pos.x, src.pos.z, src.yaw, t.pos.x, t.pos.z);
      let swept = false;
      let nearest = Infinity;
      if (facing >= COMBAT.blade.minFacingDot) {
        const cap = t.capsule();
        // the chain in order, so the first contact along the swing is the one that counts
        for (const sw of sweeps) {
          if (sweepBlade(sw, cap, COMBAT.blade.thickness, COMBAT.blade.maxSubStep, this.hitOut)) { swept = true; break; }
          if (this.hitOut.distance < nearest) nearest = this.hitOut.distance;
        }
      }
      if (!swept) this.hitOut.distance = nearest;
      const wall = swept && this.blocked(src.chest, this.hitOut.point);
      if (this.trace) {
        const last = sweeps[sweeps.length - 1];
        this.trace.push({ t: +this.time.toFixed(3), act: src.anim.actionName ?? '-', prog: +src.anim.actionProgress.toFixed(2), facing: +facing.toFixed(2), swept, wall,
          d: +this.hitOut.distance.toFixed(2), n: sweeps.length, tip: [+last.tip.x.toFixed(2), +last.tip.y.toFixed(2), +last.tip.z.toFixed(2)], src: [+src.pos.x.toFixed(2), +src.pos.z.toFixed(2)], tgt: [+t.pos.x.toFixed(2), +t.pos.z.toFixed(2)], yaw: +(src.yaw * 57.3).toFixed(0) });
      }
      if (!swept || wall) continue;
      src.hitThisSwing.add(t);
      landed = true;
      this.debugDraw.point(this.hitOut.point);
      onHit(t, this.hitOut.point);
    }
    for (const sw of sweeps) this.debugDraw.sweep(sw, landed);
  }

  /** Is there level geometry between two points? Terrain does not count: fights are on open stone. */
  private blocked(from: Vec3, to: Vec3): boolean {
    return this.world.collision.segmentBlocked(from, to);
  }

  private enemyActors(): Actor[] {
    this.enemyActorList.length = 0;
    for (const e of this.enemies) if (!e.actor.dead) this.enemyActorList.push(e.actor);
    return this.enemyActorList;
  }

  private enemyOf(a: Actor): Enemy {
    const e = this.enemies.find((en) => en.actor === a);
    if (!e) throw new Error('actor is not an enemy');
    return e;
  }

  /** An enemy blade reached the player. The dodge's opening and the hurt cooldown are honoured here. */
  private hurtPlayer(src: Actor, at: Vec3): void {
    const p = this.player;
    if (p.invulnerable > 0) { this.fx.spark(at, new Color(0.7, 0.95, 1), 6); return; }
    if (this.playerHurtCd > 0) return;
    const name = src.anim.actionName ?? '';
    let dmg = COMBAT.enemy.damage[name] ?? 12;
    if (src.fighter.scale > 1.05) dmg = Math.round(dmg * 1.3);
    this.playerHurtCd = COMBAT.player.hurtCooldown;
    this.playerHealth = Math.max(0, this.playerHealth - dmg);
    p.act(C.HIT_REACT, 0.7);
    this.fx.spark(at, new Color(1.0, 0.5, 0.5), 14);
    this.audio.playCombat('hurt', p.pos);
    this.hitStop = COMBAT.feel.hitStopHurt;
    this.shake = COMBAT.feel.shakeHurt;
    this.hud.flashDamage();
    if (this.playerHealth <= 0) this.respawnPlayer();
  }

  private landHit(src: Actor, e: Enemy, at: Vec3): void {
    const name = src.anim.actionName ?? '';
    const heavy = name === 'heavy' || name === 'nunFlourish';
    const table = src.team === 'player' ? COMBAT.player.damage : COMBAT.ally.damage;
    const dmg = table[name] ?? (src.team === 'player' ? 12 : 8);
    const killed = e.actor.damage(dmg);
    const col = src.team === 'player' ? new Color(0.75, 0.95, 1.0) : new Color(1.0, 0.7, 0.35);
    this.fx.spark(at, col, heavy ? 26 : 15);
    this.fx.slashArc(at, src.yaw, heavy ? 1.5 : 1.0, col);
    this.audio.playCombat(heavy ? 'impactHeavy' : 'impact', at);
    this.hitStop = heavy ? COMBAT.feel.hitStopHeavy : COMBAT.feel.hitStopLight;
    if (src.team === 'player') this.shake = heavy ? COMBAT.feel.shakeHeavy : COMBAT.feel.shakeLight;

    if (killed) {
      e.state = 'dying';
      e.dieT = 0;
      e.actor.act(C.DEATH, 1);
      e.actor.hitOpen = false;
      this.fx.dissolveBurst(e.actor.chest, e.kind === 'elite' ? new Color(1, 0.4, 0.45) : new Color(0.65, 0.35, 0.95));
      this.audio.playCombat('defeat', e.actor.pos);
    } else {
      const heavy = (src.anim.actionName === 'heavy' || src.anim.actionName === 'nunFlourish');
      const windingUp = e.state === 'attack' && !e.actor.hitOpen && e.timer > e.attackDur * 0.5;
      const swinging = e.state === 'attack' && !windingUp;
      if (heavy || (windingUp && this.rand() < COMBAT.enemy.staggerOnWindup)) {
        // interrupted: the blow lands before the cut, or it was a heavy — a real stagger
        e.timer = e.actor.act(C.STAGGER, 0.8) * 0.9;
        e.state = 'stagger';
        e.actor.hitOpen = false;
      } else if (!swinging) {
        // a light hit outside a swing: a short flinch
        e.timer = e.actor.act(C.HIT_REACT, 0.7) * 0.7;
        e.state = 'hit';
      }
      // a light hit during the cut itself is absorbed: the flash and the sound already sold it
    }
  }

  private respawnPlayer(): void {
    this.playerHealth = COMBAT.player.maxHealth;
    this.hud.showToast('THE SHRINE PULLS YOU BACK', 3);
    // send the player back to the edge of the encounter rather than ending the run
    const e = this.active;
    if (e) {
      this.controller.pos.set(e.x, this.world.field.heightAt(e.x, e.z - e.radius * 0.8), e.z - e.radius * 0.8);
      for (const en of this.enemies) if (!en.actor.dead) { en.state = 'idle'; en.timer = 1.4; }
    }
  }

  /** Push overlapping fighters apart so they never occupy the same spot. */
  private separate(dt: number): void {
    const all: Actor[] = [this.player, ...this.enemies.filter((e) => !e.actor.dead).map((e) => e.actor)];
    if (this.allySpawned) all.push(this.ally);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) * Math.min(1, 12 * dt);
        const nx = dx / d, nz = dz / d;
        // the player is moved through the controller so collision stays authoritative
        if (a === this.player) { this.controller.pos.x -= nx * push; this.controller.pos.z -= nz * push; }
        else { a.pos.x -= nx * push; a.pos.z -= nz * push; }
        if (b === this.player) { this.controller.pos.x += nx * push; this.controller.pos.z += nz * push; }
        else { b.pos.x += nx * push; b.pos.z += nz * push; }
      }
    }
  }

  liveEnemies(): number { return this.enemies.filter((e) => !e.actor.dead).length; }
  get health01(): number { return this.playerHealth / COMBAT.player.maxHealth; }
  get inCombat(): boolean { return this.liveEnemies() > 0; }
  get bannerText(): string { return this.banner; }

  /** Every enemy is the skinned orange swordsman; the elite is the same body a little larger. */
  private enemyFighter(kind: EnemyKind): Fighter {
    return makeSkinnedFighter(this.ctx, requireModel(this.assets, 'char/enemy'), 'enemy', { scale: kind === 'elite' ? 1.08 : 1 });
  }

  /**
   * Tooling: line the three fighters up in front of the camera, each running a chosen clip.
   *
   * Character and animation work needs a tight loop — spawning a real encounter and chasing the
   * fight around the courtyard to see whether an elbow bends correctly wastes minutes per look.
   */
  preview(x: number, z: number, yawDeg: number, which: 'idle' | 'slash' | 'heavy' | 'combo' | 'run' | 'death' | 'hit' = 'idle'): void {
    const g = (gx: number, gz: number): number => this.world.field.heightAt(gx, gz);
    const fwd = { x: -Math.sin(yawDeg * DEG), z: -Math.cos(yawDeg * DEG) };
    const right = { x: Math.cos(yawDeg * DEG), z: -Math.sin(yawDeg * DEG) };
    const place = (a: Actor, side: number): void => {
      const px = x + fwd.x * 4.0 + right.x * side;
      const pz = z + fwd.z * 4.0 + right.z * side;
      a.root.enabled = true;
      a.spawn(px, pz, yawDeg + 180);
      a.vel.set(0, 0, 0);
    };

    place(this.player, -1.9);
    place(this.ally, 0);
    this.allySpawned = true;
    void g;

    if (!this.enemies.some((e) => e.encounter === -1)) {
      const fighter = this.enemyFighter('blade');
      const a = new Actor(this.ctx, {
        fighter, team: 'enemy', ground: (gx, gz) => this.world.field.heightAt(gx, gz),
        trailColor: new Color(0.75, 0.4, 1.0), maxHealth: 9999, runSpeed: 4.4,
      });
      const en: Enemy = { actor: a, state: 'idle', timer: 9999, attackDur: 0.5, id: this.nextEnemyId++, cooldown: 0, moving: false, kind: 'blade', slot: 0, dieT: 0, encounter: -1 };
      a.anim.setEventHandler((n) => this.onEnemyEvent(en, n));
      this.enemies.push(en);
    }
    const en = this.enemies.find((e) => e.encounter === -1)!;
    place(en.actor, 1.9);
    en.state = 'idle';
    en.timer = 9999;

    const loop = (a: Actor, clip: typeof C.SLASH_1): void => { a.act({ ...clip, loop: true }, 0, 0.05); };
    if (which === 'slash') { loop(this.player, C.SLASH_1); loop(this.ally, C.NUN_COMBO); loop(en.actor, C.ENEMY_ATTACK); }
    else if (which === 'heavy') { loop(this.player, C.HEAVY); loop(this.ally, C.NUN_FLOURISH); loop(en.actor, C.ENEMY_ATTACK); }
    else if (which === 'combo') { loop(this.player, C.SLASH_3); loop(this.ally, C.NUN_COMBO); loop(en.actor, C.STAGGER); }
    else if (which === 'death') { loop(this.player, C.DEATH); loop(this.ally, C.NUN_FLOURISH); loop(en.actor, C.DEATH); }
    else if (which === 'hit') { loop(this.player, C.HIT_REACT); loop(this.ally, C.HIT_REACT); loop(en.actor, C.STAGGER); }
    else if (which === 'run') {
      for (const a of [this.player, this.ally, en.actor]) { a.anim.stopAction(); a.vel.set(0, 0, 0); }
    } else {
      for (const a of [this.player, this.ally, en.actor]) a.anim.stopAction();
    }
    this.previewMode = which;
  }

  /** Leave preview mode: drop the turntable enemy and hand the fight back to the AI. */
  previewOff(): void {
    this.previewMode = null;
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].encounter === -1) { this.enemies[i].actor.destroy(); this.enemies.splice(i, 1); }
    for (const a of [this.player, this.ally]) a.anim.stopAction();
  }

  private previewMode: string | null = null;

  /** Preview mode drives the three fighters directly and skips all AI. */
  private updatePreview(dt: number): void {
    const run = this.previewMode === 'run';
    const actors: Actor[] = [this.player, this.ally, ...this.enemies.map((e) => e.actor)];
    for (const a of actors) {
      if (run) a.vel.set(0, 0, -a.runSpeed);   // pretend-move so the locomotion blend goes to run
      const isEnemy = this.enemies.some((e) => e.actor === a);
      const isAlly = a === this.ally;
      a.setLocomotion(
        isEnemy ? C.ENEMY_IDLE : isAlly ? C.NUN_IDLE : C.GUARD,
        isEnemy ? C.ENEMY_RUN : C.WALK,
        isEnemy ? C.ENEMY_RUN : C.RUN, dt);
      a.setTrail(a.hitOpen ? 1 : 0);
      a.updateVisual(dt);          // hold position: this is a turntable, not a fight
    }
    if (this.ally.fighter.freeChuck) this.ally.fighter.freeChuck.setLocalEulerAngles(0, 0, (this.time * 620) % 360);
    this.fx.update(dt);
  }

  /**
   * Tooling: fire an attack without a mouse.
   *
   * Pointer lock is unavailable in the headless capture harness, so the combat loop is verified by
   * driving the same code path the mouse would.
   */
  debugAttack(kind: 'light' | 'heavy' | 'dodge'): boolean {
    const p = this.player;
    if (p.busy) return false;
    if (kind === 'heavy') { p.act(C.HEAVY, 0.92); this.combo = 0; }
    else if (kind === 'dodge') { p.act(C.DODGE, 0.8); p.invulnerable = COMBAT.player.dodgeInvulnerable; this.lungeScale = 1; this.fx.dust(p.pos, 10); this.softTargetFace(); return true; }
    else {
      const clip = this.combo === 0 ? C.SLASH_1 : this.combo === 1 ? C.SLASH_2 : C.SLASH_3;
      p.act(clip, this.combo === 2 ? 0.9 : 0.68);
      this.combo = (this.combo + 1) % 3;
      this.comboWindow = 0.85;
    }
    this.softTarget();
    return true;
  }

  /**
   * Tooling: advance the fight without rendering.
   *
   * The headless capture environment runs the scene at about one frame per second on a software
   * rasteriser, so verifying "do the enemies close, do hits land, does the encounter clear" by
   * waiting in wall-clock time takes minutes per assertion. Stepping the simulation directly makes
   * the same checks take a fraction of a second and removes the frame-rate dependence entirely.
   */
  simulate(seconds: number, input: Input, step = 1 / 60): void {
    const n = Math.min(20000, Math.round(seconds / step));
    for (let i = 0; i < n; i++) this.update(step, input, false);
  }

  /** F2: draw hurt capsules, blade sweeps and contact points. */
  toggleHitboxes(): boolean { return this.debugDraw.toggle(); }
  setHitboxes(on: boolean): void { this.debugDraw.enabled = on; }

  /** Tooling: enemy health, so a scripted fight can assert that hits actually land. */
  debugEnemyHealth(): { id: number; hp: number; state: string }[] {
    return this.enemies.map((e) => ({ id: e.id, hp: Math.round(e.actor.health), state: e.state }));
  }

  /**
   * Tooling: a 1v1 on the flat courtyard stone. One enemy three metres in front of the player, the
   * ally out of it. `hold` freezes the enemy's mind so hit detection can be tested on its own.
   */
  forceDuel(hold = false, dist = 3.0, place?: { x: number; z: number; yaw: number; ex: number; ez: number }): void {
    const e = this.encounters[1] ?? this.encounters[0];
    const px = place ? place.x : e.x, pz = place ? place.z : e.z - 1.5;
    this.controller.pos.set(px, this.world.field.heightAt(px, pz), pz);
    this.controller.setYaw(place ? place.yaw * DEG : Math.PI);   // forward is -Z; by default the enemy stands at +Z
    for (const en of this.enemies) en.actor.destroy();
    this.enemies.length = 0;
    this.active = null;
    // the arena sits inside an encounter's trigger zone: disarm them all, and bench the ally
    for (const enc of this.encounters) { enc.triggered = true; enc.cleared = true; }
    this.allySpawned = false;
    this.ally.root.enabled = false;
    this.attackToken = null;
    const a = new Actor(this.ctx, {
      fighter: this.enemyFighter('blade'), team: 'enemy', ground: (gx, gz) => this.world.field.heightAt(gx, gz),
      trailColor: new Color(1.0, 0.55, 0.2), trailLife: 0.13, maxHealth: COMBAT.enemy.maxHealth.blade, runSpeed: 4.4,
    });
    if (place) a.spawn(place.ex, place.ez, 0); else a.spawn(px, pz + dist, 0);
    const en: Enemy = { actor: a, state: 'idle', timer: hold ? 1e9 : 0.4, attackDur: 0.5, id: this.nextEnemyId++, cooldown: 0.8, moving: false, held: hold, kind: 'blade', slot: 0, dieT: 0, encounter: -2 };
    a.anim.setEventHandler((n) => this.onEnemyEvent(en, n));
    this.enemies.push(en);
    this.passToken();
  }

  /** Debug/tooling: drop the player straight into an encounter. */
  forceEncounter(i: number): void {
    const e = this.encounters[Math.max(0, Math.min(this.encounters.length - 1, i))];
    if (!e || e.triggered) return;
    this.controller.pos.set(e.x, this.world.field.heightAt(e.x, e.z - 6), e.z - 6);
    this.updateTriggers();
  }

  stats(): Record<string, unknown> {
    return {
      enemies: this.liveEnemies(), health: Math.round(this.playerHealth), combo: this.combo,
      encounter: this.active?.id ?? -1, fx: this.fx.active,
      lock: this.player.lockLeft.toFixed(2), act: this.player.anim.actionName ?? '-', hitOpen: this.player.hitOpen, iframes: this.player.invulnerable.toFixed(2),
      preview: this.previewMode ?? '-',
      nearest: this.enemies.length ? Math.min(...this.enemies.map((e) => e.actor.distanceTo(this.player))).toFixed(1) : '-',
      foes: this.enemies.map((e) => `${e.state}@${e.actor.distanceTo(this.player).toFixed(1)}v${Math.hypot(e.actor.vel.x, e.actor.vel.z).toFixed(1)}`).join(' '),
      ppos: `${this.player.pos.x.toFixed(1)},${this.player.pos.z.toFixed(1)}`,
      dt: this.lastDt.toFixed(4), ticks: this.ticks,
    };
  }

  dispose(): void {
    this.player.destroy();
    this.ally.destroy();
    for (const e of this.enemies) e.actor.destroy();
    this.enemies.length = 0;
    this.fx.destroy();
  }
}

export { smoothstep };
