import {
  BLEND_NORMAL, BoundingBox, Color, Entity, Mesh, MeshInstance, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL,
  StandardMaterial, Vec3,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { TerrainField } from './terrain';
import { LEVEL } from './level';
import { waterGLSL, waterWGSL } from '@/shaders/water';
import { rng, clamp01 } from '@/utils/math';
import { snoise2 } from '@/utils/noise';

interface Pool { x: number; z: number; r: number; level: number; }

/**
 * Shallow pools left behind by the rain. Each is a radial fan whose rim is pinned to the terrain
 * (so there is never a visible seam) and whose interior is flat at the pool's water level.
 * Vertex colour .r stores normalised depth, which the shader uses for colour, gloss and edge fade.
 */
export class WaterPools {
  root: Entity;
  material: StandardMaterial;
  private pools: Pool[] = [];
  private params = new Float32Array([0, 0.65, 1.0, 1.0]);
  private time = 0;

  constructor(ctx: EngineContext, private field: TerrainField) {
    const { app } = ctx;
    this.root = new Entity('water');
    app.root.addChild(this.root);

    const m = new StandardMaterial();
    m.name = 'water';
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = 0.98;
    m.diffuse = new Color(1, 1, 1);
    m.blendType = BLEND_NORMAL;
    m.depthWrite = false;
    m.opacity = 0.94;
    m.diffuseVertexColor = true;
    m.useLighting = true;
    m.shaderChunksVersion = '2.8';
    const g = m.getShaderChunks(SHADERLANGUAGE_GLSL), w = m.getShaderChunks(SHADERLANGUAGE_WGSL);
    for (const [k, v] of Object.entries(waterGLSL)) g.set(k, v);
    for (const [k, v] of Object.entries(waterWGSL)) w.set(k, v);
    m.setParameter('uWaterA', this.params);
    m.setParameter('uWaterB', [0.26, 0.70, 0.22, 0.20]); // shallowFade, depthScale, foamWidth, distortion
    m.setParameter('uWaterSky', [0.30, 0.38, 0.50]);
    m.setParameter('uWaterShallow', [0.20, 0.225, 0.205]);
    m.setParameter('uWaterDeep', [0.045, 0.085, 0.090]);
    m.update();
    this.material = m;

    const rand = rng(31337);
    for (const p of LEVEL.pools) {
      // water level: a touch below the lowest terrain inside the basin
      let lowest = Infinity;
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        for (const rr of [0, 0.35, 0.7]) lowest = Math.min(lowest, field.heightAt(p.x + Math.cos(a) * p.r * rr, p.z + Math.sin(a) * p.r * rr));
      }
      const level = lowest + 0.055;
      this.pools.push({ x: p.x, z: p.z, r: p.r, level });
      this.root.addChild(this.buildPool(ctx, m, p.x, p.z, p.r, level, rand));
    }
  }

  /** Radial fan: centre vertex + `rings` × `segs` ring vertices, rim snapped onto the terrain. */
  private buildPool(ctx: EngineContext, mat: StandardMaterial, cx: number, cz: number, radius: number, level: number, rand: () => number): Entity {
    const segs = 40, rings = 7;
    const phase = rand() * 10;
    // irregular outline so pools never read as circles
    const rimAt = (a: number): number => radius * (0.72 + 0.28 * (0.5 + 0.5 * snoise2(Math.cos(a) * 1.4 + phase, Math.sin(a) * 1.4 - phase)));

    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    positions.push(cx, level, cz); normals.push(0, 1, 0); uvs.push(0.5, 0.5); colors.push(1, 1, 1, 1);
    for (let ring = 1; ring <= rings; ring++) {
      const t = ring / rings;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const rr = rimAt(a) * t;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        const bed = this.field.heightAt(x, z);
        // outermost ring sits exactly on the terrain so there is no floating rim
        const y = ring === rings ? Math.max(bed, level) : level;
        positions.push(x, y, z); normals.push(0, 1, 0); uvs.push(0.5 + Math.cos(a) * t * 0.5, 0.5 + Math.sin(a) * t * 0.5);
        const depth = clamp01((level - bed) / 0.42) * (1 - t * t * 0.15);
        colors.push(ring === rings ? 0 : depth, 1, 1, 1);
      }
    }
    for (let s = 0; s < segs; s++) indices.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let ring = 1; ring < rings; ring++) {
      const a0 = 1 + (ring - 1) * segs, b0 = 1 + ring * segs;
      for (let s = 0; s < segs; s++) {
        const sn = (s + 1) % segs;
        indices.push(a0 + s, b0 + sn, b0 + s, a0 + s, a0 + sn, b0 + sn);
      }
    }
    const mesh = new Mesh(ctx.device);
    mesh.setPositions(positions); mesh.setNormals(normals); mesh.setUvs(0, uvs); mesh.setColors(colors, 4); mesh.setIndices(indices);
    mesh.update();
    const bb = new BoundingBox();
    bb.setMinMax(new Vec3(cx - radius, level - 0.6, cz - radius), new Vec3(cx + radius, level + 0.2, cz + radius));
    mesh.aabb = bb;
    const mi = new MeshInstance(mesh, mat);
    mi.castShadow = false;
    mi.receiveShadow = true;
    const e = new Entity(`pool-${cx.toFixed(0)}-${cz.toFixed(0)}`);
    e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: true });
    return e;
  }

  /** Water surface height at a point, or null when outside every pool. Used for footsteps/splashes. */
  waterLevelAt(x: number, z: number): number | null {
    for (const p of this.pools) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.95) return p.level;
    return null;
  }

  nearestPool(x: number, z: number): { pos: Vec3; r: number; dist: number } | null {
    let best: Pool | null = null, bd = Infinity;
    for (const p of this.pools) { const d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; best = p; } }
    return best ? { pos: new Vec3(best.x, best.level, best.z), r: best.r, dist: bd } : null;
  }

  get all(): readonly Pool[] { return this.pools; }

  update(dt: number): void {
    this.time += dt;
    this.params[0] = this.time;
    this.material.setParameter('uWaterA', this.params);
  }
}
