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
import { clamp01, damp, DEG, rng, smoothstep, wrapAngle } from '@/utils/math';

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
type AllyState = 'follow' | 'approach' | 'combatIdle' | 'attack' | 'recover' | 'hit' | 'downed';

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
  /** spawn order: who picks a ring slot first */
  slot: number;
  /** who this enemy is fighting: the player, or the ally while it is her duel partner */
  target: Actor;
  /** where on the ring around its target it wants to stand this frame: bearing and radius */
  ringAng: number;
  ringDist: number;
  /** bearing relative to the ring's anchor, for ordering the flankers left to right */
  ringRel: number;
  /** when it last received the attack token, so the wait is shared out */
  tokenAt: number;
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
  private allyState: AllyState = 'follow';
  /** state timer: the attack's length, the recover step, the flinch, the time down */
  private allyTimer = 0;
  private allyCd = 0;
  private allyAttackDur = 0;
  /** seconds until she reconsiders who to fight */
  private allyRetarget = 0;
  private allyHurtCd = 0;
  private allySinceHit = 0;
  private allyTarget: Enemy | null = null;
  /** only the enemy holding this may close and strike the player; everyone else flanks */
  private attackToken: Enemy | null = null;
  private tokenTimer = 0;
  private flankList: Enemy[] = [];
  private allyPulse = 0;
  /** the most enemies seen swinging at / with a window open on the player in one frame since the last arena — the labs' invariant */
  private maxAttackersOnP = 0;
  private maxOpenOnP = 0;
  private taughtControls = false;
  private playerHealth: number = COMBAT.player.maxHealth;
  private playerHurtCd = 0;
  private debugDraw: CombatDebugDraw;
  private hitOut: SweepHit = { point: new Vec3(), t: 0, distance: 0 };
  private enemyActorList: Actor[] = [];
  private friendlyList: Actor[] = [];
  /** tooling: per-frame sweep records while set */
  trace: Record<string, unknown>[] | null = null;
  /** the last damage events: attack id, attacker, target, damage, time — the F1 counters and the labs read it */
  readonly hitLog: { t: number; attack: number; src: string; target: string; dmg: number }[] = [];
  private logHit(src: Actor, target: Actor, dmg: number): void {
    this.hitLog.push({ t: +this.time.toFixed(3), attack: src.attackId, src: src.id, target: target.id, dmg });
    if (this.hitLog.length > 64) this.hitLog.shift();
  }
  private nextEnemyId = 1;
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

    this.ally = new Actor(ctx, {
      fighter: makeSkinnedFighter(ctx, requireModel(assets, 'char/ally'), 'ally'), team: 'ally', ground: g,
      trailColor: new Color(1.0, 0.62, 0.28), trailLife: 0.22, maxHealth: COMBAT.ally.maxHealth, runSpeed: 5.6,
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

    this.player.id = 'P';
    this.ally.id = 'A';
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
      case 'hitOpen': case 'hitClose': p.windowEvent(name); break;
      case 'dodge': this.audio.playCombat('dodge', p.pos); break;
      case 'step': this.audio.playFootstep(this.world.field.surfaceAt(p.pos.x, p.pos.z), 0.7, false); break;
    }
  }

  private onAllyEvent(name: string): void {
    const a = this.ally;
    switch (name) {
      case 'swing': a.setTrail(1); this.audio.playCombat('swingLight', a.pos); break;
      case 'hitOpen': case 'hitClose': a.windowEvent(name); break;
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

    this.submitCapsules();
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
        const en = this.spawnEnemy(sp.kind, x, z, 180, { encounter: e.id, slot: i, timer: 0.35 + i * 0.22, cooldown: 0.6 + i * 0.3 });
        this.fx.spawnPuff(en.actor.pos, sp.kind === 'elite' ? new Color(1, 0.4, 0.45) : new Color(0.6, 0.3, 0.9));
      }
      if (e.allyJoins && !this.allySpawned) {
        this.summonAlly(e.x - 3.2, e.z - 3.0, 0);
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
      case 'hitOpen': case 'hitClose': en.actor.windowEvent(name); break;
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
      if (facingDot(this.player.pos.x, this.player.pos.z, this.controller.yaw, e.actor.pos.x, e.actor.pos.z) < 0.25) continue;   // must be roughly in front
      bd = d; best = e;
    }
    this.lungeScale = best ? clamp01((bd - 1.5) / 1.6) : 0.12;
    if (best) {
      const want = Math.atan2(-(best.actor.pos.x - this.player.pos.x), -(best.actor.pos.z - this.player.pos.z));
      // nudge the camera yaw rather than snapping it: the player keeps authority
      this.controller.nudgeYaw(wrapAngle(want - this.controller.yaw) * 0.55);
    }
  }

  // ---------------------------------------------------------------- enemies

  private updateEnemies(dt: number): void {
    this.tokenTimer -= dt;
    this.resolveTargets();
    // the token moves on when its holder dies, or when its time is up while the holder is still only
    // circling; a holder that has committed keeps it through the swing and the step back, and hands
    // it on itself at the end of the recover, so no two enemies are ever swinging at the player
    const tok = this.attackToken;
    const circling = !tok || tok.state === 'idle' || tok.state === 'alert' || tok.state === 'approach' || tok.state === 'combatIdle';
    if (!tok || tok.actor.dead || tok.state === 'dying' || (this.tokenTimer <= 0 && circling)) { this.passToken(); this.resolveTargets(); }
    this.assignRing();
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
      const target = e.target;
      const d = a.distanceTo(target);
      // the right to strike: the player's attack token, or being the one on the ally
      const mine = this.attackToken === e || target === this.ally;

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

        // close to a slot on the ring around the target; the token holder's ring is inside reach
        case 'approach': {
          a.face(target.pos.x, target.pos.z);
          const arrived = this.steerToSlot(e, a, target, d, mine, dt);
          if (arrived) { e.state = 'combatIdle'; e.timer = 0; }
          break;
        }

        // at range: hold the slot, face the target, wait for the token, the cooldown and reach
        case 'combatIdle': {
          a.face(target.pos.x, target.pos.z);
          const arrived = this.steerToSlot(e, a, target, d, mine, dt);
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
          if (e.timer <= 0) { e.state = 'combatIdle'; if (this.attackToken === e) this.passToken(); }
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
      // the blade is aimed at the target but cuts whoever is in its arc
      this.sweepAttack(a, this.friendlyTargets(), (t, at) => t === this.player ? this.hurtPlayer(a, at) : this.hurtAlly(a, at));
    }

    let attackers = 0, open = 0;
    for (const e of this.enemies) {
      if (e.actor.dead || e.target !== this.player) continue;
      if (e.state === 'attack') attackers++;
      if (e.actor.hitOpen) open++;
    }
    if (attackers > this.maxAttackersOnP) this.maxAttackersOnP = attackers;
    if (open > this.maxOpenOnP) this.maxOpenOnP = open;

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
   * Move toward this enemy's slot on the ring around its target. Returns true once it is there.
   * The stop/start band is asymmetric so an enemy holding its slot does not shiver at the edge.
   */
  private steerToSlot(e: Enemy, a: Actor, target: Actor, d: number, closeIn: boolean, dt: number): boolean {
    const cur = this.bearingFrom(target, a);
    const err = wrapAngle(e.ringAng - cur);
    if (!closeIn && Math.abs(err) > 30 * DEG && d < e.ringDist + 1.2 && d > 0.3) {
      // a long way round the ring: walk around the target, not across it through the one attacking
      const s = err > 0 ? 1 : -1;
      const radial = Math.max(-1, Math.min(1, (e.ringDist - d) * 1.5));
      const vx = Math.cos(cur) * s + Math.sin(cur) * radial;
      const vz = -Math.sin(cur) * s + Math.cos(cur) * radial;
      const vl = Math.hypot(vx, vz) || 1;
      const sp = a.runSpeed * 0.62;
      a.vel.set((vx / vl) * sp, 0, (vz / vl) * sp);
      e.moving = true;
      return false;
    }
    const wantX = target.pos.x + Math.sin(e.ringAng) * e.ringDist;
    const wantZ = target.pos.z + Math.cos(e.ringAng) * e.ringDist;
    const dx = wantX - a.pos.x, dz = wantZ - a.pos.z;
    const dl = Math.hypot(dx, dz);
    // the one with the right to strike keeps pressing until it is inside its own reach — a wide
    // band there left it resting a hand's breadth out of range and never swinging
    if (closeIn) e.moving = e.moving ? dl > 0.12 : dl > 0.35 || d > COMBAT.enemy.attackRange * 0.92;
    else if (e.moving ? dl < 0.25 : dl > 0.6) e.moving = !e.moving;
    if (e.moving) {
      const sp = a.runSpeed * (d < 5 ? 0.62 : 1);
      if (dl <= sp * dt) {
        // the last frame of the walk lands on the slot exactly: a long frame must not overshoot the
        // stop band and leave the body pacing back and forth across it
        a.vel.set(dx / dt, 0, dz / dt);
        e.moving = false;
      } else {
        a.vel.set((dx / dl) * sp, 0, (dz / dl) * sp);
      }
    } else {
      a.vel.set(0, 0, 0);
    }
    return !e.moving;
  }

  /**
   * Who each enemy fights this frame: the ally's duel partner fights her, everyone else the player.
   * A swing that has started keeps its target through the cut and the step back, so a blade that was
   * telegraphed at one body is not turned onto the other halfway through.
   */
  private resolveTargets(): void {
    const allyUp = this.allySpawned && this.allyState !== 'downed';
    for (const e of this.enemies) {
      if (e.state === 'attack' || e.state === 'recover') continue;
      e.target = allyUp && this.allyTarget === e && this.attackToken !== e ? this.ally : this.player;
    }
  }

  /** Bearing of `a` as seen from `from`, in the ring's convention (x = sin, z = cos). */
  private bearingFrom(from: Actor, a: Actor): number {
    return Math.atan2(a.pos.x - from.pos.x, a.pos.z - from.pos.z);
  }

  /**
   * Where every enemy should stand this frame.
   *
   * The token holder closes straight in on its own bearing. The others take flank slots either side
   * of it as seen from the player, so the whole ring stays inside the third-person camera's view
   * instead of drifting round behind it. Flankers are ordered left to right by where they already
   * stand and the slots handed out in the same order, so two of them never swap sides through the
   * holder; a third (no encounter fields one) takes the outer slot on the side the camera looks.
   * An enemy on the ally simply closes in on her.
   */
  private assignRing(): void {
    const P = this.player, tok = this.attackToken;
    const fwd = this.controller.yaw + Math.PI;
    const anchor = tok && !tok.actor.dead && tok.state !== 'dying' ? this.bearingFrom(P, tok.actor) : fwd;
    const sp = COMBAT.enemy.ringSpacingDeg * DEG;
    const flank = this.flankList;
    flank.length = 0;
    for (const e of this.enemies) {
      if (e.actor.dead || e.state === 'dying') continue;
      if (e === tok || e.target === this.ally) {
        e.ringAng = this.bearingFrom(e.target, e.actor);
        e.ringDist = COMBAT.enemy.attackRange * 0.85;
        continue;
      }
      e.ringRel = wrapAngle(this.bearingFrom(P, e.actor) - anchor);
      e.ringDist = COMBAT.enemy.holdRange;
      flank.push(e);
    }
    if (!flank.length) return;
    if (flank.length === 1) { flank[0].ringAng = anchor + (flank[0].ringRel < 0 ? -sp : sp); return; }
    flank.sort((a, b) => a.ringRel - b.ringRel);
    const outerLeft = Math.abs(wrapAngle(anchor - 2 * sp - fwd)) < Math.abs(wrapAngle(anchor + 2 * sp - fwd));
    const slots = flank.length === 2 ? [-sp, sp] : outerLeft ? [-2 * sp, -sp, sp] : [-sp, sp, 2 * sp];
    for (let i = 0; i < flank.length; i++) flank[i].ringAng = anchor + slots[Math.min(i, slots.length - 1)];
  }

  /**
   * Hand the right to attack the player to the closest live enemy, preferring the elite.
   *
   * Without this every enemy in range commits at once, which reads as a pile-on and is impossible
   * to defend against; with it the fight has a rhythm and the other enemies stay visible. The ally's
   * duel partner is left to her unless it is the only one standing.
   */
  private passToken(): void {
    const live = this.enemies.filter((e) => !e.actor.dead && e.state !== 'dying');
    if (!live.length) { this.attackToken = null; return; }
    const allyUp = this.allySpawned && this.allyState !== 'downed';
    const free = allyUp ? live.filter((e) => e !== this.allyTarget) : live;
    const pool = free.length ? free : live;
    // the elite leads; otherwise the one the player is looking at, so the telegraph plays on screen
    // — unless another has waited much longer for its turn
    const fwd = this.controller.yaw + Math.PI;
    const off = (e: Enemy): number => Math.abs(wrapAngle(this.bearingFrom(this.player, e.actor) - fwd));
    pool.sort((a, b) => {
      const ea = a.kind === 'elite' ? -1 : 0, eb = b.kind === 'elite' ? -1 : 0;
      if (ea !== eb) return ea - eb;
      const oa = off(a), ob = off(b);
      if (Math.abs(oa - ob) > 30 * DEG) return oa - ob;
      return a.tokenAt - b.tokenAt;
    });
    // don't hand it straight back to whoever just used it, when there is anyone else
    const next = pool.find((e) => e !== this.attackToken) ?? pool[0];
    this.attackToken = next;
    next.tokenAt = this.time;
    this.tokenTimer = 2.4 + this.rand() * 1.4;
  }

  // ---------------------------------------------------------------- ally

  /** Back to her feet and her own mind, wherever she was: a held death frame only ends when another action takes over. */
  private standAlly(): void {
    if (this.allyState === 'downed') this.ally.act(C.DODGE, 0.8, 0.25);
    this.allyState = 'follow';
    this.allyTarget = null;
  }

  /** Put the ally into the fight at (x, z): the encounter that brings her in, and the arena. */
  private summonAlly(x: number, z: number, yawDeg: number): void {
    this.allySpawned = true;
    this.ally.root.enabled = true;
    this.ally.health = this.ally.maxHealth;
    this.standAlly();
    this.allyTimer = 0;
    this.allyCd = 0.5;
    this.allyHurtCd = 0;
    this.allySinceHit = 0;
    this.ally.spawn(x, z, yawDeg);
  }

  /**
   * The ally's mind: follow → approach → combatIdle → attack → recover, a flinch when hit, and a
   * spell on the ground when her health runs out. She fights the enemy the player is not fighting.
   */
  private updateAlly(dt: number): void {
    if (!this.allySpawned) return;
    const a = this.ally;
    const A = COMBAT.ally;
    this.allyTimer -= dt;
    this.allyCd -= dt;
    this.allyRetarget -= dt;
    this.allyHurtCd = Math.max(0, this.allyHurtCd - dt);
    this.allySinceHit += dt;

    if (this.allyState === 'downed') {
      a.vel.set(0, 0, 0);
      // a pulse on the accent every so often: down, not dead
      this.allyPulse -= dt;
      if (this.allyPulse <= 0) { a.hitFlash(); this.allyPulse = 0.8; }
      if (this.allyTimer <= 0) {
        // up with part of her health and the rest regenerating, facing the player so the roll
        // carries her back toward the fight; a held clip never fades on its own, a fresh action does
        a.health = Math.round(a.maxHealth * A.upHealth);
        a.yaw = a.targetYaw = Math.atan2(-(this.player.pos.x - a.pos.x), -(this.player.pos.z - a.pos.z));
        a.act(C.DODGE, 0.8, 0.25);
        this.allyState = 'follow';
        this.allyTarget = null;
        this.allySinceHit = 0;
        this.hud.showToast('SHE GETS BACK UP', 2.5);
      }
    } else {
      if (this.allySinceHit > A.regenDelay && a.health < a.maxHealth) a.health = Math.min(a.maxHealth, a.health + A.regenRate * dt);
      if (!this.allyTarget || this.allyTarget.actor.dead || this.allyTarget.state === 'dying' || this.allyRetarget <= 0) {
        this.allyTarget = this.chooseAllyTarget();
        this.allyRetarget = 1.2;
      }
      const t = this.allyTarget?.actor ?? null;
      const d = t ? a.distanceTo(t) : Infinity;

      switch (this.allyState) {
        case 'follow':
          if (t) { this.allyState = 'approach'; break; }
          this.followPlayer(a);
          break;

        // run at the target until the chucks can reach
        case 'approach': {
          if (!t) { this.allyState = 'follow'; break; }
          if (this.allyLeashed(a)) break;
          a.face(t.pos.x, t.pos.z);
          if (d <= A.attackRange * 0.9) { a.vel.set(0, 0, 0); this.allyState = 'combatIdle'; break; }
          const sp = a.runSpeed * (d < 4 ? 0.7 : 1);
          const P = this.player;
          if (a.distanceTo(P) < 3.5 && segmentDistanceXZ(a.pos, t.pos, P.pos) < 1.8) {
            // round the player, not through the fight in front of them and the blade in it
            const cur = this.bearingFrom(P, a);
            const s = wrapAngle(this.bearingFrom(P, t) - cur) > 0 ? 1 : -1;
            const radial = Math.max(-1, Math.min(1, (2.3 - a.distanceTo(P)) * 1.5));
            const vx = Math.cos(cur) * s + Math.sin(cur) * radial, vz = -Math.sin(cur) * s + Math.cos(cur) * radial;
            const vl = Math.hypot(vx, vz) || 1;
            a.vel.set((vx / vl) * sp * 0.85, 0, (vz / vl) * sp * 0.85);
          } else {
            const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, dl = Math.hypot(dx, dz) || 1;
            a.vel.set((dx / dl) * sp, 0, (dz / dl) * sp);
          }
          break;
        }

        // in reach: face the target and wait out the cooldown
        case 'combatIdle':
          if (!t) { this.allyState = 'follow'; break; }
          if (this.allyLeashed(a)) break;
          a.face(t.pos.x, t.pos.z);
          a.vel.set(0, 0, 0);
          // step back in once the partner has drifted, and at once when it is her turn and she is a hand short
          if (d > A.reengageRange || (this.allyCd <= 0 && d >= A.attackRange)) { this.allyState = 'approach'; break; }
          if (this.allyCd <= 0 && d < A.attackRange && !a.busy) {
            const clip = this.rand() < A.flourishChance ? C.NUN_FLOURISH : C.NUN_COMBO;
            this.allyAttackDur = a.act(clip, 0.9);
            this.allyTimer = this.allyAttackDur;
            this.allyState = 'attack';
          }
          break;

        // the flurry: track the target through the wind-up only, then the strikes are committed
        case 'attack':
          a.vel.set(0, 0, 0);
          if (t && this.allyTimer > this.allyAttackDur * 0.6) a.face(t.pos.x, t.pos.z);
          if (this.allyTimer <= 0) {
            this.allyState = 'recover';
            this.allyTimer = 0.2 + this.rand() * 0.15;
            this.allyCd = A.cooldown + this.rand() * A.cooldownSpread;
          }
          break;

        // a short step back, which resets the spacing for the next flurry without walking the duel away
        case 'recover': {
          if (t) {
            const bx = a.pos.x - t.pos.x, bz = a.pos.z - t.pos.z, bl = Math.hypot(bx, bz) || 1;
            a.vel.set((bx / bl) * 1.0, 0, (bz / bl) * 1.0);
            a.face(t.pos.x, t.pos.z);
          } else {
            a.vel.set(0, 0, 0);
          }
          if (this.allyTimer <= 0) this.allyState = t ? 'combatIdle' : 'follow';
          break;
        }

        // the flinch plays out, then back to it
        case 'hit':
          a.vel.set(0, 0, 0);
          if (this.allyTimer <= 0) this.allyState = t ? 'combatIdle' : 'follow';
          break;
      }
    }

    a.setLocomotion(C.NUN_IDLE, C.WALK, C.RUN, dt);
    // the free chuck spins constantly — it is most of what sells the character
    if (a.fighter.freeChuck && this.allyState !== 'downed') a.fighter.freeChuck.setLocalEulerAngles(0, 0, (this.time * 620) % 360);
    a.update(dt);
    a.setTrail(a.hitOpen ? 1 : 0.25);
    // her sweeps only ever run against enemies: she cannot damage the player by construction
    this.sweepAttack(a, this.enemyActors(), (t, at) => this.landHit(a, this.enemyOf(t), at));
  }

  /** No enemies: fall in behind the player's shoulder, and show off now and then. */
  private followPlayer(a: Actor): void {
    const px = this.controller.pos.x - Math.sin(this.controller.yaw + 0.9) * COMBAT.ally.followDistance;
    const pz = this.controller.pos.z - Math.cos(this.controller.yaw + 0.9) * COMBAT.ally.followDistance;
    const dx = px - a.pos.x, dz = pz - a.pos.z, dl = Math.hypot(dx, dz);
    if (dl > 1.6) {
      a.vel.set((dx / dl) * Math.min(a.runSpeed, dl * 1.6), 0, (dz / dl) * Math.min(a.runSpeed, dl * 1.6));
      a.face(px, pz);
    } else {
      a.vel.set(0, 0, 0);
      a.face(this.controller.pos.x, this.controller.pos.z);
      if (this.allyTimer <= 0) {
        if (!a.busy && this.rand() < 0.5) a.act(C.NUN_FLOURISH, 0.95);
        this.allyTimer = 3.5 + this.rand() * 4;
      }
    }
  }

  /**
   * The enemy the player is not fighting: whoever does not hold the attack token, the current one
   * kept while it still qualifies so she does not flit between targets. Among the rest, one on her
   * side of the player first (no crossing the player's line to reach it), a grunt before the elite
   * (the elite is the player's problem), then the nearest. When only the token holder is left she
   * joins the player on it. Nothing further from the player than her leash.
   */
  private chooseAllyTarget(): Enemy | null {
    const P = this.player;
    const live = this.enemies.filter((e) => !e.actor.dead && e.state !== 'dying' && e.actor.distanceTo(P) < COMBAT.ally.leash + 1);
    if (!live.length) return null;
    const free = live.filter((e) => e !== this.attackToken);
    const pool = free.length ? free : live;
    if (this.allyTarget && pool.includes(this.allyTarget)) return this.allyTarget;
    const mine = this.bearingFrom(P, this.ally);
    let best = pool[0], bs = Infinity;
    for (const e of pool) {
      const side = Math.abs(wrapAngle(this.bearingFrom(P, e.actor) - mine)) < Math.PI / 2 ? 0 : 10;
      const s = side + (e.kind === 'elite' ? 5 : 0) + e.actor.distanceTo(this.ally) * 0.1;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  /** A duel that has drifted too far from the player is broken off; the partner turns back to the player and the fight comes home. */
  private allyLeashed(a: Actor): boolean {
    if (a.distanceTo(this.player) <= COMBAT.ally.leash) return false;
    this.allyTarget = null;
    this.allyRetarget = 1.5;
    this.allyState = 'follow';
    a.vel.set(0, 0, 0);
    return true;
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

  /** What an enemy blade can cut: the player, and the ally while she is on her feet. */
  private friendlyTargets(): Actor[] {
    this.friendlyList.length = 0;
    this.friendlyList.push(this.player);
    if (this.allySpawned && this.allyState !== 'downed') this.friendlyList.push(this.ally);
    return this.friendlyList;
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
    this.logHit(src, p, dmg);
    p.act(C.HIT_REACT, 0.7);
    this.fx.spark(at, new Color(1.0, 0.5, 0.5), 14);
    this.audio.playCombat('hurt', p.pos);
    this.hitStop = COMBAT.feel.hitStopHurt;
    this.shake = COMBAT.feel.shakeHurt;
    this.hud.flashDamage();
    if (this.playerHealth <= 0) this.respawnPlayer();
  }

  /**
   * An enemy blade reached the ally. Same rules as for an enemy taking a hit: a cut during her own
   * strikes is absorbed, otherwise she flinches; at zero health she goes down for a while.
   */
  private hurtAlly(src: Actor, at: Vec3): void {
    const a = this.ally;
    if (this.allyState === 'downed' || this.allyHurtCd > 0) return;
    const name = src.anim.actionName ?? '';
    let dmg = COMBAT.enemy.damage[name] ?? 12;
    if (src.fighter.scale > 1.05) dmg = Math.round(dmg * 1.3);
    this.allyHurtCd = COMBAT.ally.hurtCooldown;
    this.allySinceHit = 0;
    a.health = Math.max(0, a.health - dmg);
    a.hitFlash();
    this.logHit(src, a, dmg);
    this.fx.spark(at, new Color(1.0, 0.7, 0.4), 12);
    this.audio.playCombat('impact', at);
    if (a.health <= 0) {
      this.allyState = 'downed';
      this.allyTimer = COMBAT.ally.downedTime;
      this.allyTarget = null;
      a.act(C.DEATH, 1);
      a.hitOpen = false;
      a.vel.set(0, 0, 0);
      this.hud.showToast('SHE IS DOWN', 3);
      return;
    }
    const windingUp = this.allyState === 'attack' && !a.hitOpen && this.allyTimer > this.allyAttackDur * 0.5;
    const swinging = this.allyState === 'attack' && !windingUp;
    if (swinging) return;   // absorbed: the flash and the sound already sold it
    this.allyTimer = a.act(C.HIT_REACT, 0.7) * 0.7;
    this.allyState = 'hit';
    this.allyCd = Math.max(this.allyCd, 0.4);
  }

  private landHit(src: Actor, e: Enemy, at: Vec3): void {
    const name = src.anim.actionName ?? '';
    const heavy = name === 'heavy' || name === 'nunFlourish';
    const table = src.team === 'player' ? COMBAT.player.damage : COMBAT.ally.damage;
    const dmg = table[name] ?? (src.team === 'player' ? 12 : 8);
    const killed = e.actor.damage(dmg);
    this.logHit(src, e.actor, dmg);
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
      // she comes back with the player, on her feet
      if (this.allySpawned) this.summonAlly(e.x - 2.2, e.z - e.radius * 0.8 - 0.8, 0);
    }
  }

  /** Push overlapping fighters apart so they never occupy the same spot. */
  private separate(dt: number): void {
    const all: Actor[] = [this.player, ...this.enemies.filter((e) => !e.actor.dead).map((e) => e.actor)];
    // a body on the ground is stepped over, not shoved around the ring for the time she is down
    if (this.allySpawned && this.allyState !== 'downed') all.push(this.ally);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-4) continue;
        // the overlap is resolved in the frame, whatever its length, capped so a bad spawn does not pop
        const push = Math.min(min - d, 0.3) * 0.5;
        void dt;
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

  /** Every enemy body is built here, so the three ways a fight can start cannot drift apart. */
  private spawnEnemy(kind: EnemyKind, x: number, z: number, yawDeg: number,
    o: { encounter: number; slot?: number; timer?: number; cooldown?: number; held?: boolean; maxHealth?: number }): Enemy {
    const a = new Actor(this.ctx, {
      fighter: this.enemyFighter(kind), team: 'enemy', ground: (gx, gz) => this.world.field.heightAt(gx, gz),
      trailColor: kind === 'elite' ? new Color(1.0, 0.35, 0.4) : new Color(1.0, 0.55, 0.2), trailLife: 0.13,
      maxHealth: o.maxHealth ?? COMBAT.enemy.maxHealth[kind] ?? 65, runSpeed: kind === 'elite' ? 3.6 : 4.4,
    });
    a.spawn(x, z, yawDeg);
    const en: Enemy = {
      actor: a, state: 'idle', timer: o.timer ?? 0, attackDur: 0.5, id: this.nextEnemyId++, cooldown: o.cooldown ?? 0, moving: false, held: o.held, kind,
      slot: o.slot ?? 0, target: this.player, ringAng: this.bearingFrom(this.player, a), ringDist: COMBAT.enemy.holdRange, ringRel: 0, tokenAt: -1e9, dieT: 0, encounter: o.encounter,
    };
    a.anim.setEventHandler((n) => this.onEnemyEvent(en, n));
    a.id = `e${en.id}`;
    this.enemies.push(en);
    return en;
  }

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
    this.standAlly();
    void g;

    if (!this.enemies.some((e) => e.encounter === -1)) this.spawnEnemy('blade', x, z, 0, { encounter: -1, maxHealth: 9999, timer: 9999 });
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

  private submitCapsules(): void {
    if (!this.debugDraw.enabled) return;
    this.debugDraw.capsule(this.player.capsule(), this.playerHurtCd > 0);
    if (this.ally.root.enabled) this.debugDraw.capsule(this.ally.capsule());
    for (const e of this.enemies) if (!e.actor.dead) this.debugDraw.capsule(e.actor.capsule());
  }

  /** Tooling: re-submit the overlay for a frame in which the fight itself is frozen. */
  drawDebugFrame(): void {
    this.submitCapsules();
    this.debugDraw.update(0);
  }
  setHitboxes(on: boolean): void { this.debugDraw.enabled = on; }

  /** Tooling: enemy health, so a scripted fight can assert that hits actually land. */
  debugEnemyHealth(): { id: number; hp: number; state: string; target: string }[] {
    return this.enemies.map((e) => ({ id: e.id, hp: Math.round(e.actor.health), state: e.state, target: e.target.id }));
  }

  /** Tooling: the ally's health, settable so a lab can drive her down without waiting for it. */
  debugAllyHealth(hp?: number): number {
    if (hp !== undefined) this.ally.health = Math.max(0, Math.min(this.ally.maxHealth, hp));
    return this.ally.health;
  }

  /** Tooling: every live body with its state and where it stands, so a lab can check spacing and intent. */
  debugFighters(): { id: string; team: string; hp: number; state: string; x: number; z: number; r: number; target: string; moving: boolean }[] {
    const p = this.player, c = this.controller.pos;   // the controller's position is the one separation moved this frame
    const out: ReturnType<CombatDirector['debugFighters']> = [{ id: p.id, team: p.team, hp: Math.round(this.playerHealth), state: p.anim.actionName ?? 'idle', x: +c.x.toFixed(3), z: +c.z.toFixed(3), r: p.radius, target: this.attackToken?.actor.id ?? '-', moving: Math.hypot(p.vel.x, p.vel.z) > 0.05 }];
    if (this.allySpawned) {
      const a = this.ally;
      out.push({ id: a.id, team: a.team, hp: Math.round(a.health), state: this.allyState, x: +a.pos.x.toFixed(3), z: +a.pos.z.toFixed(3), r: a.radius, target: this.allyTarget?.actor.id ?? '-', moving: Math.hypot(a.vel.x, a.vel.z) > 0.05 });
    }
    for (const e of this.enemies) {
      if (e.actor.dead) continue;
      out.push({ id: e.actor.id, team: e.kind, hp: Math.round(e.actor.health), state: e.state, x: +e.actor.pos.x.toFixed(3), z: +e.actor.pos.z.toFixed(3), r: e.actor.radius, target: e.target.id, moving: e.moving });
    }
    return out;
  }

  /**
   * Tooling: a fight on the flat courtyard stone. One to three enemies fanned across the player's
   * front at `dist`, the ally at the player's side or out of it. `hold` freezes the enemies' minds
   * so hit detection can be tested on its own.
   */
  forceDuel(hold = false, dist = 3.0, place?: { x: number; z: number; yaw: number; ex: number; ez: number }, enemies = 1, ally = false): void {
    const e = this.encounters[1] ?? this.encounters[0];
    const px = place ? place.x : e.x, pz = place ? place.z : e.z - 1.5;
    this.controller.pos.set(px, this.world.field.heightAt(px, pz), pz);
    this.controller.setYaw(place ? place.yaw * DEG : Math.PI);   // forward is -Z; by default the enemy stands at +Z
    for (const en of this.enemies) en.actor.destroy();
    this.enemies.length = 0;
    this.active = null;
    // the arena sits inside an encounter's trigger zone: disarm them all
    for (const enc of this.encounters) { enc.triggered = true; enc.cleared = true; }
    this.attackToken = null;
    const yaw = this.controller.yaw;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const n = Math.max(1, Math.min(3, Math.round(enemies)));
    const fan = n === 1 ? [0] : n === 2 ? [-30, 30] : [-35, 0, 35];
    for (let i = 0; i < n; i++) {
      const b = fan[i] * DEG;
      const ex = place && n === 1 ? place.ex : px + (fwd.x * Math.cos(b) + right.x * Math.sin(b)) * dist;
      const ez = place && n === 1 ? place.ez : pz + (fwd.z * Math.cos(b) + right.z * Math.sin(b)) * dist;
      this.spawnEnemy('blade', ex, ez, yaw / DEG + 180, { encounter: -2, slot: i, timer: hold ? 1e9 : 0.4 + i * 0.2, cooldown: 0.8 + i * 0.3, held: hold });
    }
    if (ally) {
      this.summonAlly(px - right.x * 2.2 - fwd.x * 0.8, pz - right.z * 2.2 - fwd.z * 0.8, yaw / DEG);
    } else {
      this.standAlly();
      this.allySpawned = false;
      this.ally.root.enabled = false;
    }
    this.hitLog.length = 0;
    this.maxAttackersOnP = 0;
    this.maxOpenOnP = 0;
    this.passToken();
  }

  /** Tooling: the player's health, settable so a lab can force the respawn without a long fight. */
  debugPlayerHealth(hp?: number): number {
    if (hp !== undefined) this.playerHealth = Math.max(1, Math.min(COMBAT.player.maxHealth, hp));
    return this.playerHealth;
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
      attackId: this.player.attackId, phase: this.player.anim.phase,
      hits: this.hitLog.slice(-4).map((h) => `#${h.attack} ${h.src}>${h.target} ${h.dmg}`).join('  '),
      preview: this.previewMode ?? '-',
      token: this.attackToken?.actor.id ?? '-',
      attackersOnP: this.maxAttackersOnP, openOnP: this.maxOpenOnP,
      ally: this.allySpawned ? `${this.allyState}@${Math.round(this.ally.health)}` : '-',
      allyTarget: this.allyTarget?.actor.id ?? '-',
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

/** Distance from `p` to the segment a→b on the ground plane. */
function segmentDistanceXZ(a: Vec3, b: Vec3, p: Vec3): number {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

export { smoothstep };
