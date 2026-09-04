import { Color, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { World } from '@/world/world';
import type { AudioEngine } from '@/audio/audio';
import type { HUD } from '@/ui/hud';
import type { PlayerController } from '@/player/controller';
import type { Input } from '@/player/input';
import { Actor } from './actor';
import { makeAlly, makeEnemy, makeWarrior, type EnemyKind } from './characters';
import * as C from './clips';
import { CombatFX } from './fx';
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

type EnemyState = 'idle' | 'chase' | 'windup' | 'recover' | 'stagger' | 'dying';

interface Enemy {
  actor: Actor;
  state: EnemyState;
  timer: number;
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

const PLAYER_REACH = 2.5;
const ENEMY_REACH = 2.15;

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
  private playerHealth = 100;
  private playerHurtCd = 0;
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
  ) {
    const g = (x: number, z: number): number => world.field.heightAt(x, z);
    this.fx = new CombatFX(ctx);

    this.player = new Actor(ctx, {
      fighter: makeWarrior(ctx), team: 'player', ground: g,
      trailColor: new Color(0.62, 0.90, 1.0), trailLife: 0.15, maxHealth: 100, runSpeed: 6.0,
    });
    this.player.root.enabled = false;

    this.ally = new Actor(ctx, {
      fighter: makeAlly(ctx), team: 'ally', ground: g,
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
      case 'hitOpen': p.hitOpen = true; break;
      case 'hitClose': p.hitOpen = false; break;
      case 'dodge': this.audio.playCombat('dodge', p.pos); break;
      case 'step': this.audio.playFootstep(this.world.field.surfaceAt(p.pos.x, p.pos.z), 0.7, false); break;
    }
  }

  private onAllyEvent(name: string): void {
    const a = this.ally;
    switch (name) {
      case 'swing': a.setTrail(1); this.audio.playCombat('swingLight', a.pos); break;
      case 'hitOpen': a.hitOpen = true; break;
      case 'hitClose': a.hitOpen = false; break;
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
    this.separate();

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
          fighter: makeEnemy(this.ctx, sp.kind, this.rand()),
          team: 'enemy',
          ground: (gx, gz) => this.world.field.heightAt(gx, gz),
          trailColor: sp.kind === 'elite' ? new Color(1.0, 0.35, 0.4) : new Color(0.75, 0.4, 1.0),
          trailLife: 0.13,
          maxHealth: sp.kind === 'elite' ? 260 : sp.kind === 'blade' ? 130 : 90,
          runSpeed: sp.kind === 'elite' ? 3.6 : 4.4,
        });
        a.spawn(x, z, 180);
        const en: Enemy = { actor: a, state: 'idle', timer: 0.35 + i * 0.22, kind: sp.kind, slot: i, dieT: 0, encounter: e.id };
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
      case 'hitOpen': en.actor.hitOpen = true; break;
      case 'hitClose': en.actor.hitOpen = false; break;
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
        p.act(clip, clip.dur * (this.combo === 2 ? 0.9 : 0.68));
        this.combo = (this.combo + 1) % 3;
        this.comboWindow = 0.85;
        this.softTarget();
      } else if (input.wasPressed('Mouse2')) {
        p.act(C.HEAVY, C.HEAVY.dur * 0.92);
        this.combo = 0;
        this.softTarget();
      } else if ((input.wasPressed('Space') || input.wasPressed('KeyQ')) && this.dodgeCd <= 0 && inFight) {
        p.act(C.DODGE, C.DODGE.dur * 0.8);
        this.dodgeCd = 0.75;
        this.lungeScale = 1;
        this.fx.dust(p.pos, 10);
      }
    }

    // lunges move the character, not just the model — scaled by whether there is anything to close on
    const lunge = p.anim.consumeLunge(dt) * (p.anim.actionName === 'dodge' ? 1 : this.lungeScale);
    if (lunge !== 0) {
      c.pos.x += -Math.sin(c.yaw) * lunge;
      c.pos.z += -Math.cos(c.yaw) * lunge;
      p.pos.set(c.pos.x, c.pos.y, c.pos.z);
    }

    p.setLocomotion(inFight ? C.GUARD : C.IDLE, C.WALK, C.RUN);
    p.anim.breathe = p.busy ? 0.2 : 1;
    p.setTrail(p.hitOpen ? 1 : 0);
    p.updateVisual(dt);

    // the hit sweep reads the blade only after the pose has been applied, so the damage window
    // matches the frame the blade is actually through the target
    this.tickTrailAndHits(p, dt, p.weaponSegment(), 'enemy', PLAYER_REACH);
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
      const d = a.distanceTo(target);

      switch (e.state) {
        case 'idle':
          a.vel.set(0, 0, 0);
          a.face(target.pos.x, target.pos.z);
          if (e.timer <= 0) e.state = 'chase';
          break;

        case 'chase': {
          a.face(target.pos.x, target.pos.z);
          // Hold a ring around the player rather than crowding onto them. Only the enemy holding
          // the attack token closes into striking range; the rest circle at a readable distance,
          // which is both fairer and the only way three fighters stay legible on screen.
          const mine = this.attackToken === e;
          const ring = mine ? ENEMY_REACH * 0.88 : ENEMY_REACH * 1.75;
          const ang = this.slotAngle(e);
          const wantX = target.pos.x + Math.sin(ang) * ring;
          const wantZ = target.pos.z + Math.cos(ang) * ring;
          const dx = wantX - a.pos.x, dz = wantZ - a.pos.z;
          const dl = Math.hypot(dx, dz);
          const sp = a.runSpeed * (d < 5 ? 0.62 : 1);
          if (dl > 0.3) { a.vel.set((dx / dl) * sp, 0, (dz / dl) * sp); }
          else a.vel.set(0, 0, 0);
          if (mine && d < ENEMY_REACH && e.timer <= 0 && !a.busy) {
            a.act(C.ENEMY_ATTACK, C.ENEMY_ATTACK.dur * 0.95);
            a.vel.set(0, 0, 0);
            e.state = 'windup';
            e.timer = C.ENEMY_ATTACK.dur;
          }
          break;
        }

        case 'windup':
          a.vel.set(0, 0, 0);
          if (e.timer > C.ENEMY_ATTACK.dur * 0.5) a.face(target.pos.x, target.pos.z);
          if (e.timer <= 0) { e.state = 'recover'; e.timer = 0.35 + this.rand() * 0.6; }
          break;

        case 'recover': {
          // step back out of reach after committing, which resets the spacing for the next pass
          const bx = a.pos.x - target.pos.x, bz = a.pos.z - target.pos.z, bl = Math.hypot(bx, bz) || 1;
          a.vel.set((bx / bl) * 1.9, 0, (bz / bl) * 1.9);
          a.face(target.pos.x, target.pos.z);
          if (e.timer <= 0) { e.state = 'chase'; this.passToken(); }
          break;
        }

        case 'stagger':
          a.vel.set(0, 0, 0);
          if (e.timer <= 0) { e.state = 'chase'; e.timer = 0.25; }
          break;
      }

      a.setLocomotion(C.ENEMY_IDLE, C.ENEMY_RUN, C.ENEMY_RUN);
      a.update(dt);
      const seg = a.weaponSegment();
      a.setTrail(a.hitOpen ? 1 : 0);
      this.tickTrailAndHits(a, dt, seg, 'player', ENEMY_REACH);
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
          a.act(C.NUN_COMBO, C.NUN_COMBO.dur * 0.9);
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
          a.act(C.NUN_FLOURISH, C.NUN_FLOURISH.dur * 0.95);
        }
        if (this.allyTimer <= 0) this.allyTimer = 3.5 + this.rand() * 4;
      }
    }

    a.setLocomotion(C.NUN_IDLE, C.WALK, C.RUN);
    // the free chuck spins constantly — it is most of what sells the character
    if (a.fighter.freeChuck) a.fighter.freeChuck.setLocalEulerAngles(0, 0, (this.time * 620) % 360);
    a.update(dt);
    const seg = a.weaponSegment();
    a.setTrail(a.hitOpen ? 1 : 0.25);
    this.tickTrailAndHits(a, dt, seg, 'enemy', 2.3);
  }

  // ---------------------------------------------------------------- hits

  /**
   * One swing = one damage window. While it is open, anything on the other team inside the arc
   * takes the hit exactly once, and the impact is spent on feedback: hit-stop, shake, sparks.
   */
  private tickTrailAndHits(src: Actor, _dt: number, seg: { base: Vec3; tip: Vec3 }, vs: 'enemy' | 'player', reach: number): void {
    if (!src.hitOpen) return;
    const mid = this.tmp.set((seg.base.x + seg.tip.x) * 0.5, (seg.base.y + seg.tip.y) * 0.5, (seg.base.z + seg.tip.z) * 0.5);

    if (vs === 'enemy') {
      for (const e of this.enemies) {
        if (e.actor.dead || src.hitThisSwing.has(e.actor)) continue;
        const d = Math.hypot(e.actor.pos.x - src.pos.x, e.actor.pos.z - src.pos.z);
        if (d > reach + e.actor.radius) continue;
        // must be in the forward half — a swing does not hit behind you
        const dx = e.actor.pos.x - src.pos.x, dz = e.actor.pos.z - src.pos.z;
        const fx = -Math.sin(src.yaw), fz = -Math.cos(src.yaw);
        if ((dx * fx + dz * fz) / Math.max(0.01, d) < 0.1) continue;
        src.hitThisSwing.add(e.actor);
        this.landHit(src, e, mid);
      }
    } else {
      if (src.hitThisSwing.has(this.player) || this.playerHurtCd > 0) return;
      const d = Math.hypot(this.player.pos.x - src.pos.x, this.player.pos.z - src.pos.z);
      if (d > reach + 0.4) return;
      const dx = this.player.pos.x - src.pos.x, dz = this.player.pos.z - src.pos.z;
      const fx = -Math.sin(src.yaw), fz = -Math.cos(src.yaw);
      if ((dx * fx + dz * fz) / Math.max(0.01, d) < 0.1) return;
      src.hitThisSwing.add(this.player);
      // a dodge in progress is full invulnerability — that is the whole point of the button
      if (this.player.anim.actionName === 'dodge') { this.fx.spark(mid, new Color(0.7, 0.95, 1), 6); return; }
      this.playerHurtCd = 0.7;
      this.playerHealth = Math.max(0, this.playerHealth - (src.fighter.height > 1.9 ? 22 : 13));
      this.player.act(C.HIT_REACT, C.HIT_REACT.dur * 0.7);
      this.fx.spark(mid, new Color(1.0, 0.5, 0.5), 14);
      this.audio.playCombat('hurt', this.player.pos);
      this.hitStop = 0.05;
      this.shake = 1;
      this.hud.flashDamage();
      if (this.playerHealth <= 0) this.respawnPlayer();
    }
  }

  private landHit(src: Actor, e: Enemy, at: Vec3): void {
    const heavy = src.anim.actionName === 'heavy';
    const dmg = src.team === 'player' ? (heavy ? 55 : 26) : 18;
    const killed = e.actor.damage(dmg);
    const col = src.team === 'player' ? new Color(0.75, 0.95, 1.0) : new Color(1.0, 0.7, 0.35);
    this.fx.spark(at, col, heavy ? 26 : 15);
    this.fx.slashArc(at, src.yaw, heavy ? 1.5 : 1.0, col);
    this.audio.playCombat(heavy ? 'impactHeavy' : 'impact', at);
    this.hitStop = heavy ? 0.075 : 0.042;
    if (src.team === 'player') this.shake = heavy ? 1 : 0.55;

    if (killed) {
      e.state = 'dying';
      e.dieT = 0;
      e.actor.act(C.DEATH, C.DEATH.dur);
      e.actor.hitOpen = false;
      this.fx.dissolveBurst(e.actor.chest, e.kind === 'elite' ? new Color(1, 0.4, 0.45) : new Color(0.65, 0.35, 0.95));
      this.audio.playCombat('defeat', e.actor.pos);
    } else if (e.state !== 'windup' || this.rand() < 0.5) {
      e.actor.act(C.STAGGER, C.STAGGER.dur * 0.8);
      e.state = 'stagger';
      e.timer = C.STAGGER.dur * 0.8;
    }
  }

  private respawnPlayer(): void {
    this.playerHealth = 100;
    this.hud.showToast('THE SHRINE PULLS YOU BACK', 3);
    // send the player back to the edge of the encounter rather than ending the run
    const e = this.active;
    if (e) {
      this.controller.pos.set(e.x, this.world.field.heightAt(e.x, e.z - e.radius * 0.8), e.z - e.radius * 0.8);
      for (const en of this.enemies) if (!en.actor.dead) { en.state = 'idle'; en.timer = 1.4; }
    }
  }

  /** Push overlapping fighters apart so they never occupy the same spot. */
  private separate(): void {
    const all: Actor[] = [this.player, ...this.enemies.filter((e) => !e.actor.dead).map((e) => e.actor)];
    if (this.allySpawned) all.push(this.ally);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) * 0.5;
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
  get health01(): number { return this.playerHealth / 100; }
  get inCombat(): boolean { return this.liveEnemies() > 0; }
  get bannerText(): string { return this.banner; }

  /**
   * Tooling: line the three fighters up in front of the camera, each running a chosen clip.
   *
   * Character and animation work needs a tight loop — spawning a real encounter and chasing the
   * fight around the courtyard to see whether an elbow bends correctly wastes minutes per look.
   */
  preview(x: number, z: number, yawDeg: number, which: 'idle' | 'slash' | 'heavy' | 'combo' | 'run' | 'death' = 'idle'): void {
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
      const fighter = makeEnemy(this.ctx, 'blade', 0.5);
      const a = new Actor(this.ctx, {
        fighter, team: 'enemy', ground: (gx, gz) => this.world.field.heightAt(gx, gz),
        trailColor: new Color(0.75, 0.4, 1.0), maxHealth: 9999, runSpeed: 4.4,
      });
      const en: Enemy = { actor: a, state: 'idle', timer: 9999, kind: 'blade', slot: 0, dieT: 0, encounter: -1 };
      a.anim.setEventHandler((n) => this.onEnemyEvent(en, n));
      this.enemies.push(en);
    }
    const en = this.enemies.find((e) => e.encounter === -1)!;
    place(en.actor, 1.9);
    en.state = 'idle';
    en.timer = 9999;

    const loop = (a: Actor, clip: typeof C.SLASH_1): void => { a.act({ ...clip, loop: true }, 0.05, 0.05); };
    if (which === 'slash') { loop(this.player, C.SLASH_1); loop(this.ally, C.NUN_COMBO); loop(en.actor, C.ENEMY_ATTACK); }
    else if (which === 'heavy') { loop(this.player, C.HEAVY); loop(this.ally, C.NUN_FLOURISH); loop(en.actor, C.ENEMY_ATTACK); }
    else if (which === 'combo') { loop(this.player, C.SLASH_3); loop(this.ally, C.NUN_COMBO); loop(en.actor, C.STAGGER); }
    else if (which === 'death') { loop(this.player, C.DEATH); loop(this.ally, C.NUN_FLOURISH); loop(en.actor, C.DEATH); }
    else if (which === 'run') {
      for (const a of [this.player, this.ally, en.actor]) { a.anim.stopAction(); a.vel.set(0, 0, 0); }
    } else {
      for (const a of [this.player, this.ally, en.actor]) a.anim.stopAction();
    }
    this.previewMode = which;
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
        isEnemy ? C.ENEMY_RUN : C.RUN);
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
    if (kind === 'heavy') { p.act(C.HEAVY, C.HEAVY.dur * 0.92); this.combo = 0; }
    else if (kind === 'dodge') { p.act(C.DODGE, C.DODGE.dur * 0.8); this.lungeScale = 1; this.fx.dust(p.pos, 10); this.softTargetFace(); return true; }
    else {
      const clip = this.combo === 0 ? C.SLASH_1 : this.combo === 1 ? C.SLASH_2 : C.SLASH_3;
      p.act(clip, clip.dur * (this.combo === 2 ? 0.9 : 0.68));
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

  /** Tooling: enemy health, so a scripted fight can assert that hits actually land. */
  debugEnemyHealth(): number[] { return this.enemies.map((e) => Math.round(e.actor.health)); }

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
      lock: this.player.lockLeft.toFixed(2), act: this.player.anim.actionName ?? '-',
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
