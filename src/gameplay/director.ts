import { Color, Entity, MeshInstance, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL, StandardMaterial, BLEND_ADDITIVE, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { World } from '@/world/world';
import type { HUD } from '@/ui/hud';
import type { AudioEngine, HumHandle } from '@/audio/audio';
import { EnergyStone } from './stones';
import { LEVEL } from '@/world/level';
import { MOODS } from '@/rendering/lighting';
import { createMesh, cylinderData, whiteTexture } from '@/utils/geometry';
import { stoneGLSL, stoneWGSL } from '@/shaders/stone';
import { clamp01, damp, easeInOut, easeOutCubic } from '@/utils/math';

export type GameState = 0 | 1 | 2 | 3;

const STONE_COLORS = [new Color(0.35, 0.95, 0.85), new Color(0.55, 0.75, 1.0), new Color(1.0, 0.80, 0.45)];
const OBJECTIVES = [
  'Awaken the three stones',
  'Two stones remain',
  'One stone remains — the sanctum is open',
  'Return to the heart of the shrine',
];

/**
 * Drives the whole game loop: proximity/interaction with the three stones, the world changes each
 * activation triggers, and the finale. All world mutation flows through here so restarting is a
 * matter of resetting a handful of values.
 */
export class Director {
  stones: EnergyStone[] = [];
  state: GameState = 0;
  activated = 0;
  finished = false;
  private beam: Entity;
  private beamMat: StandardMaterial;
  private beamParams = new Float32Array([0, 0, 0, 0]);
  private beamAmount = 0;
  private doorOpen = 0;
  private doorTarget = 0;
  private lanternGlow = 0;
  private lanternTarget = 0;
  private hums: HumHandle[] = [];
  private nearest: EnergyStone | null = null;
  private cinematic = 0;
  private time = 0;
  private wetness = 1;
  private onCinematic: (active: boolean) => void = () => {};

  constructor(ctx: EngineContext, private world: World, private hud: HUD, private audio: AudioEngine) {
    for (let i = 0; i < LEVEL.stones.length; i++) {
      const def = LEVEL.stones[i];
      const base = world.shrine.pedestals[i] ?? new Vec3(def.x, world.field.heightAt(def.x, def.z), def.z);
      this.stones.push(new EnergyStone(ctx, def, base, STONE_COLORS[i]));
    }

    // --- finale beam: a tall additive column above the altar, hidden until the last stone
    const mat = new StandardMaterial();
    mat.name = 'beam';
    mat.useLighting = false;
    mat.useFog = true;
    mat.blendType = BLEND_ADDITIVE;
    mat.depthWrite = false;
    mat.cull = 0;
    mat.opacityMap = whiteTexture(ctx.device);
    mat.opacityMapChannel = 'a';
    mat.opacity = 0.42;
    mat.shaderChunksVersion = '2.8';
    const g = mat.getShaderChunks(SHADERLANGUAGE_GLSL), w = mat.getShaderChunks(SHADERLANGUAGE_WGSL);
    for (const [k, v] of Object.entries(stoneGLSL)) g.set(k, v);
    for (const [k, v] of Object.entries(stoneWGSL)) w.set(k, v);
    mat.setParameter('uStone', this.beamParams);
    mat.setParameter('uStoneColor', [0.65, 0.95, 1.0]);
    mat.update();
    this.beamMat = mat;
    const mesh = createMesh(ctx.device, cylinderData(1.15, 2.6, 220, 22, 0.05, false));
    const mi = new MeshInstance(mesh, mat);
    mi.castShadow = false; mi.receiveShadow = false; mi.cull = false;
    this.beam = new Entity('beam');
    this.beam.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
    const a = world.shrine.altarTop;
    this.beam.setPosition(a.x, a.y + 108, a.z);
    this.beam.enabled = false;
    ctx.app.root.addChild(this.beam);

    world.shrine.setDoorOpen(0);
  }

  setCinematicHandler(fn: (active: boolean) => void): void { this.onCinematic = fn; }

  /** Called once audio is unlocked, so the hums are spatialised from the start. */
  startAudio(): void {
    for (const s of this.stones) this.hums.push(this.audio.addShrineHum(s.interactPoint, 52 + s.def.id * 9));
    for (const p of this.world.water.all) this.audio.playWaterAmbience(new Vec3(p.x, p.level, p.z));
    this.audio.startMusic();
    this.audio.setMusicStage(0);
  }

  restart(): void {
    this.state = 0; this.activated = 0; this.finished = false;
    this.doorTarget = 0; this.doorOpen = 0;
    this.lanternTarget = 0;
    this.beamAmount = 0;
    this.beam.enabled = false;
    for (const s of this.stones) s.reset();
    this.world.shrine.setDoorOpenReset();
    this.world.lighting.setMood(MOODS.dusk, 1.2);
    this.world.fx.setEnabled('embers', false);
    this.world.fx.setEnabled('energy', false);
    this.audio.setAwakeness(0);
    this.audio.setMusicStage(0);
    this.hud.hideFinale();
    this.hud.setLetterbox(false);
    this.hud.setObjective(OBJECTIVES[0], 9);
  }

  /** Nearest stone the player can currently attune, if any. */
  private findTarget(playerPos: Vec3, forward: Vec3): EnergyStone | null {
    let best: EnergyStone | null = null;
    let bestScore = -Infinity;
    for (const s of this.stones) {
      if (s.active) continue;
      // stone 3 stays sealed until the courtyard doors have opened
      if (s.def.id === 3 && this.activated < 2) continue;
      const p = s.interactPoint;
      const dx = p.x - playerPos.x, dy = p.y - playerPos.y, dz = p.z - playerPos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 3.4) continue;
      const facing = (dx * forward.x + dy * forward.y + dz * forward.z) / Math.max(dist, 1e-3);
      if (facing < 0.25) continue;
      const score = facing - dist * 0.15;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  interact(): boolean {
    const s = this.nearest;
    if (!s || this.cinematic > 0) return false;
    s.activate();
    this.activated++;
    this.audio.playStoneActivate(s.def.id - 1, s.interactPoint);
    this.world.postfx.pulse = 1;
    this.world.fx.setEnabled('energy', true);
    this.world.fx.setEnergyTarget(s.interactPoint, 1);
    this.world.fx.setColor('energy', s.colorValue);
    this.world.fx.burst(s.interactPoint, 1);
    this.audio.setAwakeness(this.activated / 3);
    this.audio.setMusicStage(this.activated);
    this.applyState(this.activated as GameState);
    return true;
  }

  /** Applies the world change for a given number of awakened stones. Also used by ?state= debug. */
  applyState(n: GameState): void {
    this.state = n;
    this.activated = Math.max(this.activated, n);
    for (let i = 0; i < this.stones.length; i++) if (i < n && !this.stones[i].active) this.stones[i].activate();
    if (n >= 1) {
      // --- lanterns catch light, embers rise, insects wake
      this.lanternTarget = 1;
      this.world.fx.setEnabled('embers', true);
      this.world.lighting.setMood(MOODS.awakened, 0.35);
      this.hud.showToast('The lanterns remember', 4.5);
      this.hud.setObjective(OBJECTIVES[1], 8);
    }
    if (n >= 2) {
      // --- sealed courtyard opens, mist thickens and the light cools
      this.doorTarget = 1;
      this.audio.playDoorOpen(new Vec3(LEVEL.terraces.innerGate.x, LEVEL.terraces.innerGate.y + 2, LEVEL.terraces.innerGate.z));
      this.world.lighting.setMood(MOODS.opened, 0.3);
      this.world.atmosphere.setMistIntensity(1.7);
      this.hud.showToast('The inner gate yields', 4.5);
      this.hud.setObjective(OBJECTIVES[2], 8);
    }
    if (n >= 3) this.beginFinale();
  }

  private beginFinale(): void {
    if (this.finished) return;
    this.finished = true;
    this.cinematic = 14;
    this.beam.enabled = true;
    this.world.lighting.setMood(MOODS.finale, 0.18);
    this.world.atmosphere.setIntensity(2.2);
    this.audio.setMusicStage(3);
    this.audio.setSpace('sanctum');
    this.hud.setLetterbox(true);
    this.hud.setPrompt(null);
    this.hud.showToast('The shrine awakens', 7);
    this.hud.setObjective('', 0);
    this.onCinematic(true);
  }

  update(dt: number, playerPos: Vec3, eyePos: Vec3, forward: Vec3): void {
    this.time += dt;
    for (const s of this.stones) s.update(dt);
    for (let i = 0; i < this.hums.length; i++) this.hums[i]?.setIntensity(0.25 + this.stones[i].charge * 1.2);

    // --- lantern glow ramps in and drives the lantern emissive + ember particles
    this.lanternGlow = damp(this.lanternGlow, this.lanternTarget, 0.55, dt);
    const flicker = 0.86 + 0.14 * Math.sin(this.time * 6.1) * Math.sin(this.time * 2.3 + 1.1);
    this.world.shrine.lanternGlow.emissiveIntensity = this.lanternGlow * 9 * flicker;
    this.world.shrine.lanternGlow.update();
    this.world.shrine.setLanternLightLevel(this.lanternGlow * flicker);

    // --- doors slide open
    this.doorOpen = damp(this.doorOpen, this.doorTarget, 0.35, dt);
    if (this.doorTarget > 0 && this.doorOpen < 0.999) this.world.shrine.setDoorOpen(easeInOut(clamp01(this.doorOpen)));

    // --- the ground slowly dries as the shrine wakes (subtle, but it sells the world reacting)
    this.wetness = damp(this.wetness, 1 - this.activated * 0.12, 0.2, dt);
    this.world.terrain.setWetness(0.92 * this.wetness, 0.62, 1.0);

    // --- beam grows, then the completion card fades in
    if (this.finished) {
      this.cinematic = Math.max(0, this.cinematic - dt);
      this.beamAmount = damp(this.beamAmount, 1, 0.35, dt);
      const b = easeOutCubic(this.beamAmount);
      this.beamParams[0] = this.time;
      this.beamParams[1] = b * 1.5;
      this.beamParams[2] = 0.10;   // near-uniform column: the crystal banding reads as rings at this scale
      this.beamParams[3] = Math.max(0, 1 - this.beamAmount * 2);
      this.beamMat.setParameter('uStone', this.beamParams);
      const s = 0.4 + b * 0.9;
      this.beam.setLocalScale(s, 1, s);
      this.world.postfx.pulse = Math.max(this.world.postfx.pulse, (1 - this.beamAmount) * 0.5);
      this.world.fx.setEnergyTarget(this.world.shrine.altarTop, 1.6);
      if (this.cinematic <= 0 && !this.completionShown) {
        this.completionShown = true;
        this.hud.showFinale(() => this.requestRestart());
      }
      return;
    }

    // --- proximity + interaction prompt
    const target = this.findTarget(playerPos, forward);
    if (target !== this.nearest) {
      this.nearest = target;
      this.hud.setPrompt(target ? 'ATTUNE' : null);
      if (target) this.audio.playInteract('focus', target.interactPoint);
    }
    // energy motes stream toward whichever stone the player is near
    if (target) { this.world.fx.setEnabled('energy', true); this.world.fx.setEnergyTarget(target.interactPoint, 0.55); this.world.fx.setColor('energy', target.colorValue); }
    else if (this.activated === 0) this.world.fx.setEnabled('energy', false);

    // --- reverb space follows the player through the level
    const z = playerPos.z;
    this.audio.setSpace(z > 26 ? 'sanctum' : z > -14 ? 'courtyard' : 'open');
    void eyePos;
  }

  private completionShown = false;
  private restartHandler: () => void = () => {};
  setRestartHandler(fn: () => void): void { this.restartHandler = fn; }
  private requestRestart(): void { this.completionShown = false; this.restartHandler(); }

  get promptActive(): boolean { return this.nearest !== null; }
  get inCinematic(): boolean { return this.cinematic > 0; }
}
