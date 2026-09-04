import { Entity, Vec3 } from 'playcanvas';
import { Input } from './input';
import { CollisionWorld } from './collision';
import type { TerrainField, Surface } from '@/world/terrain';
import { settings } from '@/core/settings';
import { clamp, damp, dampAngle, lerp, DEG, TAU } from '@/utils/math';
import { Emitter } from '@/core/events';

type PlayerEvents = { footstep: { surface: Surface; intensity: number; sprint: boolean }; land: { intensity: number; surface: Surface }; jump: undefined };

const WALK = 3.3, SPRINT = 6.0, EYE = 1.66, RADIUS = 0.36, HEIGHT = 1.75, GRAVITY = 22, JUMP = 5.0;

/**
 * First-person controller with hand-tuned feel: exponential look damping, acceleration curves,
 * grounded head-bob driving footstep events, breathing, landing spring and sprint FOV.
 */
export class PlayerController extends Emitter<PlayerEvents> {
  pos = new Vec3();
  vel = new Vec3();
  yaw = 0;          // radians, smoothed
  pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  grounded = true;
  enabled = true;
  frozen = false;   // during cinematics: look allowed, no movement
  private bobPhase = 0;
  private bobAmount = 0;
  private lastBobSign = 1;
  private landY = 0;
  private landV = 0;
  private sprintF = 0;
  private time = 0;
  private wasGrounded = true;
  private airTime = 0;
  private fallSpeed = 0;
  private waterLevelAt: (x: number, z: number) => number | null = () => null;
  readonly forward = new Vec3();
  readonly eye = new Vec3();
  speed = 0;
  private standOut = { standY: null as number | null };
  private tmp = new Vec3();
  /** third-person framing: the camera orbits behind the character during combat */
  thirdPerson = false;
  private tpBlend = 0;
  tpDistance = 3.15;
  tpHeight = 1.52;
  tpShoulder = 0.52;
  /** combat can slow the character without touching the tuned acceleration curves */
  speedScale = 1;
  /** while a fight is live, Space is the dodge button rather than jump */
  suppressJump = false;
  private tpPos = new Vec3();
  private tpDir = new Vec3();

  constructor(private input: Input, private collision: CollisionWorld, private terrain: TerrainField, public camera: Entity) {
    super();
  }

  setWaterQuery(fn: (x: number, z: number) => number | null): void { this.waterLevelAt = fn; }

  spawn(x: number, z: number, yawDeg: number): void {
    this.pos.set(x, this.terrain.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = this.targetYaw = yawDeg * DEG;
    this.pitch = this.targetPitch = 0;
    this.grounded = true;
    this.applyCamera(0);
  }

  lookAt(x: number, y: number, z: number): void {
    const dx = x - this.pos.x, dz = z - this.pos.z, dy = y - (this.pos.y + EYE);
    this.targetYaw = Math.atan2(-dx, -dz);
    this.targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.yaw = this.targetYaw; this.pitch = this.targetPitch;
  }

  update(dt: number): void {
    this.time += dt;
    dt = Math.min(dt, 1 / 20);
    const inp = this.input;
    // ---- look
    if (this.enabled) {
      const sens = settings.get('sensitivity') * 0.0021;
      this.targetYaw -= inp.mouseDX * sens;
      this.targetPitch = clamp(this.targetPitch - inp.mouseDY * sens, -84 * DEG, 84 * DEG);
    }
    this.yaw = dampAngle(this.yaw, this.targetYaw, 30, dt);
    this.pitch = damp(this.pitch, this.targetPitch, 30, dt);

    // ---- movement intent
    let mx = 0, mz = 0, sprint = false, jump = false;
    if (this.enabled && !this.frozen) { mx = inp.moveX; mz = inp.moveZ; sprint = inp.sprint && mz > 0; jump = !this.suppressJump && inp.wasPressed('Space'); }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin yaw, 0, -cos yaw); right = (cos yaw, 0, -sin yaw)
    const wishX = (-sy) * mz + cy * mx;
    const wishZ = (-cy) * mz - sy * mx;
    const maxSpeed = (sprint ? SPRINT : WALK) * this.speedScale;
    const targetVX = wishX * maxSpeed, targetVZ = wishZ * maxSpeed;
    const accel = this.grounded ? (len > 0 ? 18 : 26) : 5;
    this.vel.x = damp(this.vel.x, targetVX, accel, dt);
    this.vel.z = damp(this.vel.z, targetVZ, accel, dt);

    // ---- gravity / jump
    if (this.grounded && jump) { this.vel.y = JUMP; this.grounded = false; this.emit('jump', undefined); }
    if (!this.grounded) { this.vel.y -= GRAVITY * dt; this.airTime += dt; this.fallSpeed = Math.min(this.vel.y, this.fallSpeed); }

    // ---- integrate horizontally with slope blocking
    const oldX = this.pos.x, oldZ = this.pos.z;
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    if (!this.terrain.inBounds(nx, nz, 6)) { nx = oldX; nz = oldZ; this.vel.x *= -0.2; this.vel.z *= -0.2; }
    const hOld = this.terrain.heightAt(oldX, oldZ);
    const hNew = this.terrain.heightAt(nx, nz);
    const climb = hNew - Math.max(this.pos.y, hOld);
    if (this.grounded && climb > 0.55) {
      // try sliding along each axis separately
      const hx = this.terrain.heightAt(nx, oldZ) - hOld, hz = this.terrain.heightAt(oldX, nz) - hOld;
      if (hx <= 0.55) { nz = oldZ; this.vel.z = 0; } else if (hz <= 0.55) { nx = oldX; this.vel.x = 0; } else { nx = oldX; nz = oldZ; this.vel.x = 0; this.vel.z = 0; }
    }
    this.pos.x = nx; this.pos.z = nz;
    this.pos.y += this.vel.y * dt;

    // ---- static colliders
    this.collision.resolve(this.pos, RADIUS, HEIGHT, this.standOut);

    // ---- ground contact
    let ground = this.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.standOut.standY !== null && this.standOut.standY > ground) ground = this.standOut.standY;
    if (this.pos.y <= ground + 0.02 || (this.grounded && this.pos.y < ground + 0.35 && this.vel.y <= 0)) {
      if (!this.grounded || this.pos.y < ground) {
        if (!this.wasGrounded && this.airTime > 0.15) {
          const impact = clamp((-this.fallSpeed - 3) / 9, 0.1, 1);
          this.landV -= 0.9 * impact + 0.25;
          this.emit('land', { intensity: impact, surface: this.surface() });
        }
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
      this.airTime = 0; this.fallSpeed = 0;
    } else {
      this.grounded = false;
    }
    this.wasGrounded = this.grounded;

    // ---- camera feel
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed = hs;
    const speedF = clamp(hs / WALK, 0, 2);
    const targetBob = this.grounded ? clamp(speedF, 0, 1.6) : 0;
    this.bobAmount = damp(this.bobAmount, targetBob, 8, dt);
    if (this.grounded && hs > 0.3) {
      const stride = sprint ? 1.75 : 1.45; // meters per full cycle (two steps)
      this.bobPhase += (hs / stride) * TAU * dt;
      const s = Math.sign(Math.sin(this.bobPhase)) || 1;
      if (s !== this.lastBobSign) {
        this.lastBobSign = s;
        this.emit('footstep', { surface: this.surface(), intensity: clamp(0.4 + speedF * 0.45, 0.3, 1.0), sprint });
      }
    }
    this.sprintF = damp(this.sprintF, sprint && hs > WALK * 1.1 ? 1 : 0, 4, dt);
    // landing spring
    this.landV += (-this.landY * 110 - this.landV * 13) * dt;
    this.landY += this.landV * dt;

    this.applyCamera(dt);
  }

  private applyCamera(dt: number): void {
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.042 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase * 0.5 + Math.PI * 0.5) * 0.018 * this.bobAmount;
    const breathY = Math.sin(this.time * 1.15) * 0.0045;
    const breathPitch = Math.sin(this.time * 0.85 + 1) * 0.0018;
    const roll = Math.sin(this.bobPhase * 0.5) * 0.0055 * this.bobAmount;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const rightX = cy, rightZ = -sy;
    this.eye.set(this.pos.x + rightX * bobX, this.pos.y + EYE + bobY + breathY + this.landY, this.pos.z + rightZ * bobX);
    const pitchDeg = (this.pitch + breathPitch) / DEG + this.landY * 6;

    // --- ease between first and third person rather than cutting: a hard swap on drawing the
    //     sword reads as a bug, and the blend doubles as the "step back into the fight" beat
    this.tpBlend = damp(this.tpBlend, this.thirdPerson ? 1 : 0, 5, dt || 1 / 60);
    if (this.tpBlend > 0.001) {
      this.camera.setEulerAngles(pitchDeg, this.yaw / DEG, roll / DEG);
      this.tpDir.copy(this.camera.forward);
      // orbit target sits at the character's chest, offset over the shoulder
      const tx = this.pos.x + rightX * this.tpShoulder;
      const ty = this.pos.y + this.tpHeight;
      const tz = this.pos.z + rightZ * this.tpShoulder;
      // pull in if the boom would pass through geometry
      const want = this.tpDistance;
      this.tmp.set(-this.tpDir.x, -this.tpDir.y, -this.tpDir.z);
      this.tpPos.set(tx, ty, tz);
      const hit = this.collision.rayDistance(this.tpPos, this.tmp, want + 0.4);
      const dist = Math.min(want, Math.max(0.9, hit - 0.32));
      this.tpPos.set(tx + this.tmp.x * dist, ty + this.tmp.y * dist, tz + this.tmp.z * dist);
      this.eye.lerp(this.eye, this.tpPos, this.tpBlend);
    }
    this.camera.setPosition(this.eye);
    this.camera.setEulerAngles(pitchDeg, this.yaw / DEG, roll / DEG);
    this.forward.copy(this.camera.forward);
    const cam = this.camera.camera;
    if (cam) cam.fov = lerp(settings.get('fov'), settings.get('fov') + 7, this.sprintF) + this.tpBlend * 4;
  }

  /**
   * Turn the view by `d` radians without fighting the mouse.
   *
   * Soft targeting uses this on the first frame of a swing: the character squares up to whoever is
   * in front, but only part of the way, so the player never feels the camera taken off them.
   */
  nudgeYaw(d: number): void { this.targetYaw += d; this.yaw += d * 0.6; }

  /** 0 while first-person, 1 once the third-person boom is fully out. */
  get thirdPersonBlend(): number { return this.tpBlend; }

  surface(): Surface {
    const wl = this.waterLevelAt(this.pos.x, this.pos.z);
    if (wl !== null && this.pos.y < wl + 0.05) return 'water';
    return this.terrain.surfaceAt(this.pos.x, this.pos.z);
  }

  get eyePosition(): Vec3 { return this.eye; }
  get isSprinting(): boolean { return this.sprintF > 0.5; }
  get tmpVec(): Vec3 { return this.tmp; }
}
