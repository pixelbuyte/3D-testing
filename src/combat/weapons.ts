import {
  BLEND_ADDITIVE, Color, Entity, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, StandardMaterial, Vec3,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { appendData, boxData, createMesh, cylinderData, emptyData, transformData, type MeshData } from '@/utils/geometry';
import { clamp01 } from '@/utils/math';

/**
 * Weapons and the ribbon trails they leave.
 *
 * The trail is the single cheapest thing that makes a swing read: it turns four animation keys into
 * a continuous arc the eye can follow. It is a strip built from the last N sampled positions of the
 * blade's base and tip, rebuilt in world space every frame — ~50 vertices, so the per-frame mesh
 * update costs nothing next to how much it buys.
 */

export interface WeaponBuild {
  entity: Entity;
  /** local-space base and tip of the cutting edge, used for the trail and hit sweeps */
  base: Vec3;
  tip: Vec3;
}

/** A katana: slightly curved blade, tsuba, wrapped grip. */
export function buildKatana(ctx: EngineContext, steel: StandardMaterial, wrap: StandardMaterial, fitting: StandardMaterial): WeaponBuild {
  const e = new Entity('katana');
  const L = 0.86;          // blade length
  const blade: MeshData = emptyData();
  // four short segments with a rising curve give the sori without a bend deformer
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const y = 0.10 + L * t0;
    const curve = t0 * t0 * 0.055;
    const w = 0.030 - t0 * 0.008;
    appendData(blade, transformData(
      boxData(w, L / segs + 0.004, 0.010),
      [0, y + L / segs * 0.5, curve], [t0 * 3.2, 0, 0]));
  }
  // the point
  appendData(blade, transformData(boxData(0.020, 0.10, 0.008), [0, 0.10 + L + 0.04, 0.062], [7, 0, 0]));
  const bladeMesh = createMesh(ctx.device, blade);
  const bladeEnt = new Entity('blade');
  bladeEnt.addComponent('render', { meshInstances: [new MeshInstance(bladeMesh, steel)], castShadows: true });
  e.addChild(bladeEnt);

  const guard: MeshData = emptyData();
  appendData(guard, transformData(cylinderData(0.055, 0.055, 0.014, 12, 1, true), [0, 0.10, 0], [90, 0, 0], [1, 1, 0.35]));
  const guardEnt = new Entity('tsuba');
  guardEnt.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, guard), fitting)], castShadows: true });
  e.addChild(guardEnt);

  const grip: MeshData = emptyData();
  appendData(grip, transformData(boxData(0.028, 0.24, 0.020), [0, -0.02, 0]));
  appendData(grip, transformData(cylinderData(0.020, 0.018, 0.02, 8, 1, true), [0, -0.145, 0]));
  const gripEnt = new Entity('tsuka');
  gripEnt.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, grip), wrap)], castShadows: true });
  e.addChild(gripEnt);

  return { entity: e, base: new Vec3(0, 0.12, 0), tip: new Vec3(0, 0.10 + L + 0.08, 0.07) };
}

/** Nunchucks: two batons on a short chain. The chain is posed, not simulated. */
export function buildNunchucks(ctx: EngineContext, wood: StandardMaterial, metal: StandardMaterial): WeaponBuild & { free: Entity } {
  const e = new Entity('nunchucks');
  const stick = (): MeshData => {
    const d = emptyData();
    appendData(d, transformData(cylinderData(0.023, 0.020, 0.30, 8, 1, true), [0, -0.15, 0]));
    appendData(d, transformData(cylinderData(0.026, 0.026, 0.016, 8, 1, true), [0, -0.006, 0]));
    appendData(d, transformData(cylinderData(0.026, 0.026, 0.016, 8, 1, true), [0, -0.295, 0]));
    return d;
  };
  const held = new Entity('chuck-held');
  held.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, stick()), wood)], castShadows: true });
  e.addChild(held);

  // the free baton hangs off a chain and is spun by the animation; its own entity so it can whip
  const pivot = new Entity('chain-pivot');
  pivot.setLocalPosition(0, 0.02, 0);
  const chain: MeshData = emptyData();
  for (let i = 0; i < 4; i++) appendData(chain, transformData(cylinderData(0.008, 0.008, 0.032, 5, 1, true), [0, 0.03 + i * 0.032, 0]));
  const chainEnt = new Entity('chain');
  chainEnt.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, chain), metal)], castShadows: false });
  pivot.addChild(chainEnt);

  const free = new Entity('chuck-free');
  free.setLocalPosition(0, 0.165, 0);
  free.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, stick()), wood)], castShadows: true });
  free.setLocalEulerAngles(180, 0, 0);
  pivot.addChild(free);
  e.addChild(pivot);

  return { entity: e, base: new Vec3(0, 0.02, 0), tip: new Vec3(0, 0.46, 0), free: pivot };
}

const MAX_SEG = 22;

/**
 * A ribbon that follows a weapon's cutting edge.
 *
 * Samples are taken in world space so the strip is independent of the wielder's transform; the
 * oldest samples fade out both in alpha and in width, which is what stops it looking like a solid
 * flag stuck to the sword.
 */
export class WeaponTrail {
  private entity: Entity;
  private mesh: Mesh;
  private mat: StandardMaterial;
  private mi: MeshInstance;
  private pos = new Float32Array(MAX_SEG * 2 * 3);
  // StandardMaterial's shader binds vertex_normal even with lighting off, so the strip has to
  // supply one; it is never shaded, so a constant up-normal is enough
  private nrm = new Float32Array(MAX_SEG * 2 * 3);
  private uv = new Float32Array(MAX_SEG * 2 * 2);
  private idx: number[] = [];
  private samples: { b: Vec3; t: Vec3; age: number }[] = [];
  private strength = 0;
  private fade = 0;

  constructor(ctx: EngineContext, color: Color, private life = 0.16) {
    this.mat = new StandardMaterial();
    this.mat.name = 'weapon-trail';
    this.mat.useLighting = false;
    this.mat.blendType = BLEND_ADDITIVE;
    this.mat.depthWrite = false;
    this.mat.cull = 0;
    this.mat.emissive = color.clone();
    this.mat.emissiveIntensity = 2.6;
    this.mat.useFog = false;
    this.mat.update();

    for (let i = 0; i < MAX_SEG - 1; i++) {
      const a = i * 2;
      this.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    for (let i = 0; i < MAX_SEG; i++) {
      const u = i / (MAX_SEG - 1);
      this.uv[i * 4] = u; this.uv[i * 4 + 1] = 0;
      this.uv[i * 4 + 2] = u; this.uv[i * 4 + 3] = 1;
    }
    for (let i = 0; i < MAX_SEG * 2; i++) { this.nrm[i * 3] = 0; this.nrm[i * 3 + 1] = 1; this.nrm[i * 3 + 2] = 0; }
    this.mesh = new Mesh(ctx.device);
    this.mesh.setPositions(this.pos);
    this.mesh.setNormals(this.nrm);
    this.mesh.setUvs(0, this.uv);
    this.mesh.setIndices(this.idx);
    this.mesh.update(PRIMITIVE_TRIANGLES, false);

    this.mi = new MeshInstance(this.mesh, this.mat);
    this.mi.cull = false;
    this.entity = new Entity('trail');
    this.entity.addComponent('render', { meshInstances: [this.mi], castShadows: false, receiveShadows: false });
    this.entity.enabled = false;
    ctx.app.root.addChild(this.entity);
    for (let i = 0; i < MAX_SEG; i++) this.samples.push({ b: new Vec3(), t: new Vec3(), age: 99 });
  }

  /** 0 = off, 1 = full. Ramped by the combat state so the trail only exists during a swing. */
  setStrength(v: number): void { this.strength = clamp01(v); }

  update(dt: number, base: Vec3, tip: Vec3): void {
    for (const s of this.samples) s.age += dt;
    if (this.strength > 0.01) {
      // push the newest sample on the front
      const last = this.samples.pop()!;
      last.b.copy(base); last.t.copy(tip); last.age = 0;
      this.samples.unshift(last);
      this.fade = 1;
    } else {
      this.fade = Math.max(0, this.fade - dt * 6);
    }

    if (this.fade <= 0.001) { this.entity.enabled = false; return; }
    this.entity.enabled = true;

    let n = 0;
    for (let i = 0; i < MAX_SEG; i++) {
      const s = this.samples[i];
      const a = 1 - clamp01(s.age / this.life);
      if (a <= 0) break;
      // the tail narrows toward the base as it ages, so the ribbon tapers to nothing
      const w = a * a;
      const o = n * 6;
      this.pos[o] = s.b.x; this.pos[o + 1] = s.b.y; this.pos[o + 2] = s.b.z;
      this.pos[o + 3] = s.b.x + (s.t.x - s.b.x) * w;
      this.pos[o + 4] = s.b.y + (s.t.y - s.b.y) * w;
      this.pos[o + 5] = s.b.z + (s.t.z - s.b.z) * w;
      n++;
    }
    if (n < 2) { this.entity.enabled = false; return; }
    // collapse the unused tail onto the last live sample so no stray triangles stretch away
    for (let i = n; i < MAX_SEG; i++) {
      const o = i * 6, p = (n - 1) * 6;
      for (let k = 0; k < 6; k++) this.pos[o + k] = this.pos[p + k];
    }
    this.mesh.setPositions(this.pos);
    this.mesh.update(PRIMITIVE_TRIANGLES, false);
    this.mat.emissiveIntensity = 2.6 * this.fade;
    this.mat.update();
  }

  destroy(): void { this.entity.destroy(); }
}
