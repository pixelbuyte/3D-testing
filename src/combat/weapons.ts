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
  /** Moving damage-bearing part; defaults to the weapon root for a rigid blade. */
  strikeEntity?: Entity;
  /** local-space base and tip of the cutting edge, used for the trail and hit sweeps */
  base: Vec3;
  tip: Vec3;
  /** where the second hand closes on the grip, in weapon space; absent for one-handed weapons */
  offHandGrip?: Vec3;
}

/** A katana: curved blade with a visible spine and edge bevel, tsuba, diamond-wrapped tsuka. */
export function buildKatana(ctx: EngineContext, steel: StandardMaterial, wrap: StandardMaterial, fitting: StandardMaterial): WeaponBuild {
  const e = new Entity('katana');
  const L = 0.70;          // blade length
  const blade: MeshData = emptyData();
  // six short segments with a rising curve give the sori without a bend deformer; the blade is a
  // flattened hexagon so it has a spine, two flats and an edge rather than reading as a plank
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const y = 0.10 + L * t0;
    const curve = t0 * t0 * 0.06;
    const w = 0.028 - t0 * 0.006;
    appendData(blade, transformData(
      cylinderData(w, w * (t1 < 1 ? 1 : 0.55), L / segs + 0.003, 6, 1, false),
      [0, y + L / segs * 0.5, curve], [t0 * 4.0, 0, 0], [1, 1, 0.28]));
  }
  // the kissaki: a short taper to the point
  appendData(blade, transformData(cylinderData(0.022, 0.003, 0.09, 6, 1, false), [0, 0.10 + L + 0.043, 0.066], [7, 0, 0], [1, 1, 0.28]));
  const bladeEnt = new Entity('blade');
  bladeEnt.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, blade), steel)], castShadows: true });
  e.addChild(bladeEnt);

  const guard: MeshData = emptyData();
  appendData(guard, transformData(cylinderData(0.052, 0.052, 0.012, 8, 1, true), [0, 0.10, 0], [0, 0, 0], [1, 1, 0.55]));
  appendData(guard, transformData(cylinderData(0.022, 0.024, 0.02, 8, 1, true), [0, 0.088, 0]));    // fuchi collar
  appendData(guard, transformData(cylinderData(0.020, 0.017, 0.02, 8, 1, true), [0, -0.15, 0]));    // kashira cap
  const guardEnt = new Entity('tsuba');
  guardEnt.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, guard), fitting)], castShadows: true });
  e.addChild(guardEnt);

  // the wrap: alternating raised diamonds down the grip read as tsuka-ito at any distance
  const grip: MeshData = emptyData();
  appendData(grip, transformData(boxData(0.026, 0.24, 0.018), [0, -0.03, 0]));
  for (let i = 0; i < 6; i++) {
    appendData(grip, transformData(boxData(0.030, 0.022, 0.022), [0, 0.07 - i * 0.038, 0], [0, 0, i % 2 ? 26 : -26]));
  }
  const gripEnt = new Entity('tsuka');
  gripEnt.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, grip), wrap)], castShadows: true });
  e.addChild(gripEnt);

  return { entity: e, base: new Vec3(0, 0.12, 0), tip: new Vec3(0, 0.10 + L + 0.09, 0.075), offHandGrip: new Vec3(0, -0.105, 0) };
}

/** Nunchucks: two octagonal batons with lit caps, joined by an actual chain of links. */
export function buildNunchucks(ctx: EngineContext, wood: StandardMaterial, metal: StandardMaterial, cap: StandardMaterial): WeaponBuild & { free: Entity } {
  const e = new Entity('nunchucks');
  const stick = (): MeshData => {
    const d = emptyData();
    appendData(d, transformData(cylinderData(0.020, 0.023, 0.28, 8, 1, true), [0, -0.15, 0]));
    // a shallow groove band a third of the way down, so the baton is not a featureless rod
    appendData(d, transformData(cylinderData(0.0245, 0.0245, 0.012, 8, 1, true), [0, -0.105, 0]));
    return d;
  };
  const caps = (): MeshData => {
    const d = emptyData();
    appendData(d, transformData(cylinderData(0.0235, 0.021, 0.028, 8, 1, true), [0, -0.012, 0]));
    appendData(d, transformData(cylinderData(0.0225, 0.020, 0.024, 8, 1, true), [0, -0.288, 0]));
    return d;
  };
  const held = new Entity('chuck-held');
  held.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, stick()), wood), new MeshInstance(createMesh(ctx.device, caps()), cap)], castShadows: true });
  e.addChild(held);

  // the free baton hangs off a chain and is spun by the animation; its own entity so it can whip
  const pivot = new Entity('chain-pivot');
  pivot.setLocalPosition(0, 0.012, 0);
  const chain: MeshData = emptyData();
  for (let i = 0; i < 5; i++) {
    appendData(chain, transformData(chainLink(), [0, 0.014 + i * 0.026, 0], [0, i % 2 ? 90 : 0, 0]));
  }
  const chainEnt = new Entity('chain');
  chainEnt.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, chain), metal)], castShadows: false });
  pivot.addChild(chainEnt);

  const free = new Entity('chuck-free');
  free.setLocalPosition(0, 0.13, 0);
  free.addComponent('render', { meshInstances: [new MeshInstance(createMesh(ctx.device, stick()), wood), new MeshInstance(createMesh(ctx.device, caps()), cap)], castShadows: true });
  free.setLocalEulerAngles(180, 0, 0);
  pivot.addChild(free);
  e.addChild(pivot);

  return { entity: e, strikeEntity: free, base: new Vec3(0, -0.015, 0), tip: new Vec3(0, -0.29, 0), free: pivot };
}

/** Hollow oval links with alternating planes; the center is open, not a stack of discs. */
function chainLink(): MeshData {
  const d = emptyData(), segments = 10, tube = 4;
  for (let i = 0; i <= segments; i++) for (let j = 0; j <= tube; j++) {
    const a = i / segments * Math.PI * 2, b = j / tube * Math.PI * 2;
    const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
    d.positions.push(ca*(0.009+0.0025*cb),sa*(0.016+0.0025*cb),0.0025*sb);
    d.normals.push(ca*cb,sa*cb,sb);d.uvs.push(i/segments,j/tube);
  }
  for (let i=0;i<segments;i++) for(let j=0;j<tube;j++) {
    const a=i*(tube+1)+j,b=a+tube+1;
    d.indices.push(a,b,a+1,a+1,b,b+1);
  }
  return d;
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
