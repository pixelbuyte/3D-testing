import {
  BLEND_ADDITIVE, Color, Entity, MeshInstance, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL,
  StandardMaterial, Vec3,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { createMesh, crystalData, cylinderData, transformData, whiteTexture } from '@/utils/geometry';
import { clamp01, damp, easeOutCubic, TAU } from '@/utils/math';
import { stoneGLSL, stoneWGSL } from '@/shaders/stone';

export interface StoneDef { id: number; x: number; z: number; name: string; }

/**
 * One ancient energy stone: a floating faceted crystal above its pedestal, a halo, and an omni
 * light. Dormant stones are dim and slowly bobbing; activating one plays a short bloom of
 * brightness, spin-up and light before settling into a steady lit state.
 */
export class EnergyStone {
  root: Entity;
  crystal: Entity;
  halo: Entity;
  light: Entity;
  active = false;
  /** 0 dormant .. 1 fully awake */
  charge = 0;
  private target = 0;
  private pulse = 0;
  private spin = 0;
  private time = 0;
  private params = new Float32Array([0, 0, 0, 0]);
  private mat: StandardMaterial;
  private haloMat: StandardMaterial;
  readonly focus = new Vec3();

  constructor(ctx: EngineContext, public def: StoneDef, base: Vec3, private color: Color) {
    const { device } = ctx;
    this.root = new Entity(`stone-${def.id}`);
    this.root.setPosition(base.x, base.y, base.z);

    // --- crystal
    const mat = new StandardMaterial();
    mat.name = `stone-${def.id}`;
    mat.useLighting = false;
    mat.useFog = true;
    mat.blendType = BLEND_ADDITIVE;
    mat.depthWrite = false;
    mat.cull = 0;
    mat.opacityMap = whiteTexture(device);
    mat.opacityMapChannel = 'a';
    mat.shaderChunksVersion = '2.8';
    const g = mat.getShaderChunks(SHADERLANGUAGE_GLSL), w = mat.getShaderChunks(SHADERLANGUAGE_WGSL);
    for (const [k, v] of Object.entries(stoneGLSL)) g.set(k, v);
    for (const [k, v] of Object.entries(stoneWGSL)) w.set(k, v);
    mat.setParameter('uStone', this.params);
    mat.setParameter('uStoneColor', [color.r, color.g, color.b]);
    mat.update();
    this.mat = mat;

    const mesh = createMesh(device, crystalData(0.17, 0.72, 7));
    const mi = new MeshInstance(mesh, mat);
    mi.castShadow = false; mi.receiveShadow = false;
    this.crystal = new Entity('crystal');
    this.crystal.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
    this.crystal.setLocalPosition(0, 0.85, 0);
    this.root.addChild(this.crystal);

    // --- halo ring lying flat over the pedestal
    const haloMat = mat.clone();
    haloMat.name = `stone-halo-${def.id}`;
    haloMat.setParameter('uStone', this.params);
    haloMat.setParameter('uStoneColor', [color.r, color.g, color.b]);
    haloMat.update();
    this.haloMat = haloMat;
    const ring = createMesh(device, transformData(cylinderData(0.62, 0.62, 0.005, 26, 1, false), [0, 0, 0]));
    const hmi = new MeshInstance(ring, haloMat);
    hmi.castShadow = false; hmi.receiveShadow = false;
    this.halo = new Entity('halo');
    this.halo.addComponent('render', { meshInstances: [hmi], castShadows: false, receiveShadows: false });
    this.halo.setLocalPosition(0, 0.16, 0);
    this.root.addChild(this.halo);

    // --- omni light
    this.light = new Entity('stone-light');
    this.light.addComponent('light', {
      type: 'omni', color: color.clone(), intensity: 0, range: 11, castShadows: false,
    });
    this.light.setLocalPosition(0, 0.9, 0);
    this.root.addChild(this.light);

    this.focus.set(base.x, base.y + 0.85, base.z);
    ctx.app.root.addChild(this.root);
  }

  activate(): void { this.active = true; this.target = 1; this.pulse = 1; }
  reset(): void { this.active = false; this.target = 0; this.charge = 0; this.pulse = 0; }

  update(dt: number): void {
    this.time += dt;
    this.charge = damp(this.charge, this.target, 1.1, dt);
    this.pulse = damp(this.pulse, 0, 1.2, dt);
    const c = easeOutCubic(clamp01(this.charge));
    // dormant stones still glimmer faintly so the player can find them
    const glow = 0.10 + c * 1.5 + this.pulse * 3.2;
    this.params[0] = this.time;
    this.params[1] = glow;
    this.params[2] = 0.25 + c * 0.75;      // facet contrast
    this.params[3] = this.pulse;           // shockwave amount
    this.mat.setParameter('uStone', this.params);
    this.haloMat.setParameter('uStone', this.params);

    this.spin += dt * (0.25 + c * 1.6 + this.pulse * 5);
    const bob = Math.sin(this.time * (0.7 + c * 0.5)) * (0.045 + c * 0.05);
    this.crystal.setLocalPosition(0, 0.85 + bob, 0);
    this.crystal.setLocalEulerAngles(0, (this.spin * 180) / Math.PI, Math.sin(this.time * 0.4) * 5);
    const hs = 1 + c * 0.5 + this.pulse * 1.4;
    this.halo.setLocalScale(hs, 1, hs);
    this.halo.setLocalEulerAngles(0, (-this.spin * 60) / Math.PI, 0);
    this.light.light!.intensity = (0.15 + c * 5.5 + this.pulse * 9) * 0.55;
  }

  /** Player-facing interaction point. */
  get interactPoint(): Vec3 { return this.focus; }
  get colorValue(): Color { return this.color; }
  get phase(): number { return (this.time * 0.5) % TAU; }
}
