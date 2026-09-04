import {
  BLEND_ADDITIVE, BoundingBox, Color, Entity, MeshInstance, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL,
  StandardMaterial, Vec3,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { shaftGLSL, shaftWGSL } from '@/shaders/particles';
import { createMesh, emptyData, softRectSprite } from '@/utils/geometry';
import { clamp01, damp, rng } from '@/utils/math';
import { settings } from '@/core/settings';

/**
 * Fake volumetrics built from soft additive cards.
 *
 * - Light shafts: a fan of large quads aligned with the sun, anchored to the camera so they always
 *   read from wherever the player stands. They fade out as the sun leaves the view.
 * - Ground mist: wide horizontal cards that drift and counter-rotate near the terrain, which is what
 *   sells the "valley full of standing mist" look without a real volumetric pass.
 *
 * Both use the same animated-noise card material, so this is only a handful of draw calls.
 */
export class GodRays {
  root: Entity;
  private shaftRoot: Entity;
  private mistRoot: Entity;
  private shaftMat: StandardMaterial;
  private mistMat: StandardMaterial;
  private shaftParams = new Float32Array([0, 0.5, 0.02, 0.42]);
  private mistParams = new Float32Array([0, 0.30, 0.012, 0.62]);
  private mist: { e: Entity; y: number; speed: number; phase: number; scale: number }[] = [];
  private time = 0;
  private intensity = 1;
  private mistIntensity = 1;
  private shownIntensity = 0;
  private rand = rng(8181);

  constructor(private ctx: EngineContext, _camera: Entity, private sunDir: Vec3) {
    this.root = new Entity('atmosphere');
    ctx.app.root.addChild(this.root);
    this.shaftRoot = new Entity('shafts');
    this.mistRoot = new Entity('mist');
    this.root.addChild(this.shaftRoot);
    this.root.addChild(this.mistRoot);

    this.shaftMat = this.cardMaterial('shafts', new Color(1.0, 0.66, 0.42), this.shaftParams);
    this.mistMat = this.cardMaterial('mist', new Color(0.40, 0.50, 0.64), this.mistParams);

    this.buildShafts();
    this.buildMist();
    this.applySettings();
    settings.on('change', () => this.applySettings());
  }

  private cardMaterial(name: string, color: Color, params: Float32Array): StandardMaterial {
    const m = new StandardMaterial();
    m.name = name;
    m.useLighting = false;
    m.useFog = true;
    m.blendType = BLEND_ADDITIVE;
    m.depthWrite = false;
    m.cull = 0;
    m.opacity = 1;
    m.opacityMap = softRectSprite(this.ctx.device);
    m.opacityMapChannel = 'a';
    m.shaderChunksVersion = '2.8';
    const g = m.getShaderChunks(SHADERLANGUAGE_GLSL), w = m.getShaderChunks(SHADERLANGUAGE_WGSL);
    for (const [k, v] of Object.entries(shaftGLSL)) g.set(k, v);
    for (const [k, v] of Object.entries(shaftWGSL)) w.set(k, v);
    m.setParameter('uShaft', params);
    m.setParameter('uShaftFade', name === 'mist' ? [3, 22, 70, 150] : [10, 42, 90, 190]);
    m.setParameter('uShaftColor', [color.r, color.g, color.b]);
    m.update();
    return m;
  }

  /** A stack of long quads lying along the sun direction, forming a shaft "fan". */
  private buildShafts(): void {
    const count = 7;
    for (let i = 0; i < count; i++) {
      const w = 5 + this.rand() * 9;
      const h = 90;
      const d = emptyData();
      d.positions.push(-w / 2, -h / 2, 0, w / 2, -h / 2, 0, -w / 2, h / 2, 0, w / 2, h / 2, 0);
      d.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
      d.uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      d.indices.push(0, 1, 2, 2, 1, 3);
      const mesh = createMesh(this.ctx.device, d);
      mesh.aabb = new BoundingBox(new Vec3(0, 0, 0), new Vec3(h, h, h));
      const mi = new MeshInstance(mesh, this.shaftMat);
      mi.castShadow = false; mi.receiveShadow = false; mi.cull = false;
      const e = new Entity(`shaft-${i}`);
      e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
      // spread the cards across the shaft bundle
      e.setLocalPosition((this.rand() - 0.5) * 26, (this.rand() - 0.5) * 10, -18 - i * 5);
      e.setLocalEulerAngles(0, (this.rand() - 0.5) * 24, (this.rand() - 0.5) * 10);
      this.shaftRoot.addChild(e);
    }
  }

  /** Horizontal drifting mist banks hugging the ground. */
  private buildMist(): void {
    const layers = Math.max(3, settings.get('mistLayers'));
    for (let i = 0; i < layers; i++) {
      const size = 55 + this.rand() * 90;
      const d = emptyData();
      d.positions.push(-size / 2, 0, -size / 2, size / 2, 0, -size / 2, -size / 2, 0, size / 2, size / 2, 0, size / 2);
      d.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      d.uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      d.indices.push(0, 2, 1, 1, 2, 3);
      const mesh = createMesh(this.ctx.device, d);
      mesh.aabb = new BoundingBox(new Vec3(0, 0, 0), new Vec3(size, 6, size));
      const mi = new MeshInstance(mesh, this.mistMat);
      mi.castShadow = false; mi.receiveShadow = false; mi.cull = false;
      const e = new Entity(`mist-${i}`);
      e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
      const y = 0.4 + this.rand() * 4.5;
      e.setLocalPosition((this.rand() - 0.5) * 130, y, (this.rand() - 0.5) * 150);
      this.mistRoot.addChild(e);
      this.mist.push({ e, y, speed: 0.10 + this.rand() * 0.22, phase: this.rand() * 100, scale: size });
    }
  }

  private applySettings(): void {
    const on = settings.get('godRays');
    this.shaftRoot.enabled = on;
  }

  setIntensity(v: number): void { this.intensity = v; }
  setMistIntensity(v: number): void { this.mistIntensity = v; }
  setColor(shaft: Color, mist: Color): void {
    this.shaftMat.setParameter('uShaftColor', [shaft.r, shaft.g, shaft.b]);
    this.mistMat.setParameter('uShaftColor', [mist.r, mist.g, mist.b]);
  }

  update(dt: number, camPos: Vec3, camForward: Vec3): void {
    this.time += dt;
    // shafts anchor to the camera and point along the sun; they fade when the sun is behind us
    const facing = clamp01(camForward.dot(this.sunDir) * 1.4 + 0.15);
    this.shownIntensity = damp(this.shownIntensity, facing * this.intensity, 3, dt);
    this.shaftRoot.setPosition(camPos.x, camPos.y, camPos.z);
    // orient the fan so its long axis follows the sun direction projected into view
    const yaw = Math.atan2(this.sunDir.x, this.sunDir.z) * 180 / Math.PI;
    this.shaftRoot.setEulerAngles(0, yaw, 0);
    this.shaftParams[0] = this.time;
    this.shaftParams[1] = this.shownIntensity * 0.12;
    this.shaftMat.setParameter('uShaft', this.shaftParams);

    this.mistParams[0] = this.time;
    this.mistParams[1] = this.mistIntensity * 0.030;
    this.mistMat.setParameter('uShaft', this.mistParams);
    for (const m of this.mist) {
      // slow drift + counter-rotation keeps the banks from reading as flat cards
      const t = this.time * m.speed + m.phase;
      m.e.setLocalPosition(Math.sin(t * 0.5) * 22 + Math.sin(t * 0.13) * 40, m.y + Math.sin(t * 0.7) * 0.5, Math.cos(t * 0.37) * 34 + Math.cos(t * 0.11) * 46);
      m.e.setLocalEulerAngles(0, t * 5, 0);
    }
  }
}
