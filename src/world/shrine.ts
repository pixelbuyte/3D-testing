import { Color, Entity, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { AssetBank } from '@/assets/manifest';
import type { TerrainField } from './terrain';
import type { CollisionWorld, BoxCollider } from '@/player/collision';
import { LEVEL } from './level';
import { MaterialLibrary } from './materials';
import { appendData, boxData, createMesh, cylinderData, emptyData, transformData, type MeshData } from '@/utils/geometry';
import { rng } from '@/utils/math';

export interface LanternSpot { pos: Vec3; group: 'path' | 'courtyard' | 'sanctum' | 'ruin' | 'grotto'; }
export interface DoorSet { left: Entity; right: Entity; colliders: BoxCollider[]; open: number; }

/**
 * Procedural shrine architecture, merged by material into a handful of draw calls,
 * registering colliders and gameplay anchor points as it goes.
 */
export class Shrine {
  root: Entity;
  mats: MaterialLibrary;
  lanterns: LanternSpot[] = [];
  lanternGlow!: StandardMaterial;
  doors!: DoorSet;
  altarTop = new Vec3();
  heroSlot = new Vec3();
  ringAnchor = new Vec3();
  pedestals: Vec3[] = [];
  private buckets = new Map<StandardMaterial, MeshData>();
  private rand = rng(4242);

  constructor(private ctx: EngineContext, assets: AssetBank, private field: TerrainField, private collision: CollisionWorld) {
    this.root = new Entity('shrine');
    ctx.app.root.addChild(this.root);
    this.mats = new MaterialLibrary(assets);
    this.lanternGlow = new StandardMaterial();
    this.lanternGlow.name = 'lantern-glow';
    this.lanternGlow.diffuse = new Color(0.05, 0.03, 0.02);
    this.lanternGlow.emissive = new Color(1.0, 0.62, 0.28);
    this.lanternGlow.emissiveIntensity = 0;
    this.lanternGlow.useMetalness = true; this.lanternGlow.metalness = 0; this.lanternGlow.gloss = 0.3;
    this.lanternGlow.update();

    this.buildGate();
    this.buildPathLanterns();
    this.buildCourtyard();
    this.buildGrotto();
    this.buildRuin();
    this.buildInnerGate();
    this.buildSanctum();
    this.flush();
    this.createLanternLights();
  }

  // ------------------------------------------------------------------ helpers
  private h(x: number, z: number): number { return this.field.heightAt(x, z); }

  private add(mat: StandardMaterial, data: MeshData): void {
    let b = this.buckets.get(mat);
    if (!b) { b = emptyData(); this.buckets.set(mat, b); }
    appendData(b, data);
  }
  private box(mat: StandardMaterial, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0, uv = 0.5, collide = true, rot: [number, number, number] = [0, rotY, 0]): void {
    this.add(mat, transformData(boxData(w, h, d, uv), [x, y, z], rot));
    if (collide) this.collision.addBox(x, y, z, w / 2, h / 2, d / 2, rotY * Math.PI / 180);
  }
  private cyl(mat: StandardMaterial, x: number, y: number, z: number, rb: number, rt: number, h: number, seg = 14, uv = 0.5, collide = true, rot: [number, number, number] = [0, 0, 0]): void {
    this.add(mat, transformData(cylinderData(rb, rt, h, seg, uv), [x, y, z], rot));
    if (collide) this.collision.addCylinder(x, y - h / 2, z, Math.max(rb, rt), h);
  }

  private flush(): void {
    for (const [mat, data] of this.buckets) {
      if (data.indices.length === 0) continue;
      const mesh = createMesh(this.ctx.device, data);
      const mi = new MeshInstance(mesh, mat);
      const e = new Entity(`shrine-${mat.name}`);
      e.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true });
      this.root.addChild(e);
    }
    this.buckets.clear();
  }

  /** Stone lantern (tōrō). Returns the glow position. */
  private stoneLantern(x: number, z: number, group: LanternSpot['group'], scale = 1): void {
    const m = this.mats.stoneBlocks;
    const y = this.h(x, z);
    const s = scale;
    this.box(m, x, y + 0.2 * s, z, 0.8 * s, 0.4 * s, 0.8 * s, this.rand() * 30, 0.8, true);
    this.cyl(m, x, y + 0.4 * s + 0.6 * s, z, 0.17 * s, 0.15 * s, 1.2 * s, 10, 0.8, false);
    this.box(m, x, y + 1.6 * s + 0.1 * s, z, 0.62 * s, 0.2 * s, 0.62 * s, 0, 0.8, false);
    // light chamber: four posts + glow panels
    const cy = y + 1.8 * s + 0.3 * s;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(m, x + dx * 0.24 * s, cy, z + dz * 0.24 * s, 0.1 * s, 0.6 * s, 0.1 * s, 0, 0.8, false);
    const glow = this.lanternGlow;
    this.add(glow, transformData(boxData(0.44 * s, 0.5 * s, 0.44 * s, 1), [x, cy, z]));
    // roof
    this.add(m, transformData(cylinderData(0.62 * s, 0.08 * s, 0.42 * s, 4, 0.8, true), [x, y + 2.1 * s + 0.21 * s, z], [0, 45, 0]));
    this.add(m, transformData(cylinderData(0.1 * s, 0.02 * s, 0.25 * s, 6, 0.8, true), [x, y + 2.52 * s + 0.12 * s, z]));
    this.lanterns.push({ pos: new Vec3(x, cy, z), group });
  }

  private torii(x: number, z: number, y: number, scale = 1, rotY = 0): void {
    const m = this.mats.woodRed, s = scale;
    const cr = Math.cos(rotY * Math.PI / 180), sr = Math.sin(rotY * Math.PI / 180);
    const p = (lx: number, lz: number): [number, number] => [x + lx * cr - lz * sr, z + lx * sr + lz * cr];
    for (const side of [-1, 1]) {
      const [px, pz] = p(side * 2.7 * s, 0);
      this.cyl(m, px, y + 3.1 * s, pz, 0.34 * s, 0.28 * s, 6.2 * s, 14, 0.6, true, [0, 0, side * -2.5]);
      this.cyl(this.mats.stoneBlocks, px, y + 0.25 * s, pz, 0.55 * s, 0.5 * s, 0.5 * s, 12, 0.8, false);
    }
    // kasagi (top lintel) with slight upturned ends
    this.box(m, x, y + 6.15 * s, z, 8.4 * s, 0.42 * s, 0.52 * s, rotY, 0.6, false);
    for (const side of [-1, 1]) {
      const [ex, ez] = p(side * 4.2 * s, 0);
      this.box(m, ex, y + 6.3 * s, ez, 1.0 * s, 0.36 * s, 0.5 * s, rotY, 0.6, false, [0, rotY, side * 12]);
    }
    this.box(m, x, y + 5.72 * s, z, 7.6 * s, 0.24 * s, 0.4 * s, rotY, 0.6, false);   // shimaki
    this.box(m, x, y + 4.75 * s, z, 6.9 * s, 0.3 * s, 0.34 * s, rotY, 0.6, false);   // nuki
    this.box(m, x, y + 5.25 * s, z, 0.5 * s, 0.7 * s, 0.3 * s, rotY, 0.6, false);    // gakuzuka
  }

  // ------------------------------------------------------------------ areas
  private buildGate(): void {
    const g = LEVEL.terraces.gate;
    this.torii(g.x, g.z, this.h(g.x, g.z) - 0.1, 1.0);
    // a smaller weathered gate further down the path, hinting at the approach
    const a = LEVEL.terraces.approach;
    this.torii(a.x - 0.5, a.z - 6, this.h(a.x - 0.5, a.z - 6) - 0.15, 0.78, -6);
    // irregular stepping stones on the slope up to the gate
    for (let z = g.z - 10; z < g.z - 1.5; z += 1.25) {
      for (let i = -1; i <= 1; i++) {
        const x = i * (1.15 + this.rand() * 0.35) + 0.3 * Math.sin(z * 1.7);
        const r = 0.42 + this.rand() * 0.22;
        this.cyl(this.mats.stoneTiles, x, this.h(x, z) + 0.05, z + (this.rand() - 0.5) * 0.4, r, r * 0.92, 0.2, 7, 1.4, false, [0, this.rand() * 60, 0]);
      }
    }
  }

  private buildPathLanterns(): void {
    const path = LEVEL.path;
    let d = 0;
    let next = 6;
    let side = 1;
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      while (next < d + len) {
        const t = (next - d) / len;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        const lx = px + nx * 3.1 * side, lz = pz + nz * 3.1 * side;
        if (Math.abs(lz - LEVEL.terraces.gate.z) > 3) this.stoneLantern(lx, lz, 'path', 0.9 + this.rand() * 0.15);
        side = -side;
        next += 9;
      }
      d += len;
    }
  }

  private buildCourtyard(): void {
    const c = LEVEL.terraces.courtyard;
    const m = this.mats.stoneWall;
    // broken perimeter wall with openings S (path), E (grotto), W (ruin), N (inner gate)
    const R = 17.5;
    for (let a = 0; a < 360; a += 7) {
      const rad = a * Math.PI / 180;
      const openings = [270, 0, 180, 90]; // degrees: S=270 (-z), E=0, W=180, N=90
      if (openings.some((o) => Math.abs(((a - o + 540) % 360) - 180) < 20)) continue;
      if (this.rand() < 0.14) continue; // collapsed segments
      const x = c.x + Math.cos(rad) * R, z = c.z + Math.sin(rad) * R;
      const y = this.h(x, z);
      const h = 0.9 + this.rand() * 0.9;
      this.box(m, x, y + h / 2 - 0.15, z, 2.3, h, 0.7, -a + 90, 0.6, true);
    }
    // corner pillars at the openings
    for (const a of [252, 288, 342, 18, 72, 108, 162, 198]) {
      const rad = a * Math.PI / 180;
      const x = c.x + Math.cos(rad) * R, z = c.z + Math.sin(rad) * R;
      const y = this.h(x, z);
      this.box(this.mats.stoneBlocks, x, y + 1.2, z, 1.1, 2.6, 1.1, -a + 90, 0.6, true);
      this.box(this.mats.stoneBlocks, x, y + 2.6, z, 1.4, 0.3, 1.4, -a + 90, 0.6, false);
    }
    // ring of lanterns
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      this.stoneLantern(c.x + Math.cos(a) * 11.5, c.z + Math.sin(a) * 11.5, 'courtyard', 1.1);
    }
    // central stone basin (chōzuya-like) — a low ring the player can walk around
    const bx = c.x + 5.5, bz = c.z - 2;
    this.cyl(this.mats.stoneBlocks, bx, this.h(bx, bz) + 0.3, bz, 1.5, 1.35, 0.6, 18, 0.7, true);
    this.cyl(this.mats.stoneTiles, bx, this.h(bx, bz) + 0.62, bz, 1.15, 1.15, 0.06, 18, 0.7, false);
    // banner posts flanking the path through the courtyard
    for (const z of [-9, -3, 3]) for (const side of [-1, 1]) {
      const x = c.x + side * 4.3;
      const y = this.h(x, z);
      this.cyl(this.mats.wood, x, y + 1.7, z, 0.11, 0.09, 3.4, 8, 0.6, true);
      this.box(this.mats.wood, x, y + 3.25, z, 0.16, 0.12, 1.5, 0, 0.6, false);
    }
  }

  private buildGrotto(): void {
    const g = LEVEL.terraces.grotto;
    const s = LEVEL.stones[0];
    const y = this.h(s.x, s.z);
    // pedestal ring
    this.cyl(this.mats.lichen, s.x, y + 0.22, s.z, 1.35, 1.15, 0.44, 16, 0.7, true);
    this.cyl(this.mats.stoneTiles, s.x, y + 0.58, s.z, 0.7, 0.55, 0.3, 12, 0.7, false);
    this.pedestals[0] = new Vec3(s.x, y + 0.73, s.z);
    // ruined arch fragments framing the grotto entrance
    const ax = g.x - 5.5, az = g.z - 2;
    this.box(this.mats.stoneWall, ax, this.h(ax, az) + 1.4, az, 0.9, 3.0, 0.9, 20, 0.6, true);
    this.box(this.mats.stoneWall, ax + 0.4, this.h(ax, az) + 3.1, az + 1.2, 0.8, 0.6, 3.0, 20, 0.6, false, [0, 20, 8]);
    this.stoneLantern(g.x - 3.5, g.z + 4.5, 'grotto', 0.9);
    this.stoneLantern(g.x + 1.5, g.z - 5, 'grotto', 0.85);
  }

  private buildRuin(): void {
    const r = LEVEL.terraces.ruin;
    const s = LEVEL.stones[1];
    // ring of broken pillars
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = r.x + Math.cos(a) * 5.6, z = r.z + Math.sin(a) * 5.6;
      const y = this.h(x, z);
      const h = 1.2 + this.rand() * 3.4;
      const tilt = (this.rand() - 0.5) * 6;
      this.cyl(this.mats.stoneBlocks, x, y + h / 2 - 0.1, z, 0.46, 0.42, h, 12, 0.6, true, [tilt, 0, tilt * 0.5]);
      this.cyl(this.mats.stoneBlocks, x, y + 0.15, z, 0.62, 0.55, 0.3, 12, 0.6, false);
      if (h > 4.2) this.cyl(this.mats.stoneBlocks, x, y + h + 0.1, z, 0.6, 0.6, 0.35, 12, 0.6, false);
    }
    // a fallen pillar
    const fx = r.x + 2.5, fz = r.z - 6.5;
    this.cyl(this.mats.stoneBlocks, fx, this.h(fx, fz) + 0.45, fz, 0.45, 0.42, 4.2, 12, 0.6, false, [0, 30, 88]);
    this.collision.addBox(fx, this.h(fx, fz) + 0.4, fz, 2.1, 0.45, 0.5, 30 * Math.PI / 180);
    // lintel remains between two pillars
    // stone 2 pedestal
    const y = this.h(s.x, s.z);
    this.box(this.mats.stoneTiles, s.x, y + 0.3, s.z, 1.8, 0.6, 1.8, 15, 0.8, true);
    this.cyl(this.mats.stoneBlocks, s.x, y + 0.78, s.z, 0.62, 0.5, 0.36, 12, 0.7, false);
    this.pedestals[1] = new Vec3(s.x, y + 0.96, s.z);
    // statue plinth
    const px = r.x - 1.5, pz = r.z + 6.5;
    this.box(this.mats.stoneBlocks, px, this.h(px, pz) + 0.45, pz, 1.6, 0.9, 1.6, 10, 0.7, true);
    this.stoneLantern(r.x + 6.5, r.z + 3.5, 'ruin', 0.95);
    this.stoneLantern(r.x - 6, r.z - 3, 'ruin', 0.95);
  }

  private buildInnerGate(): void {
    const g = LEVEL.terraces.innerGate;
    const y = this.h(g.x, g.z);
    const m = this.mats.stoneBlocks;
    // massive door pillars and lintel
    for (const side of [-1, 1]) {
      this.box(m, g.x + side * 3.2, y + 2.7, g.z, 1.4, 5.6, 1.6, 0, 0.55, true);
      this.box(m, g.x + side * 3.2, y + 5.6, g.z, 1.8, 0.4, 2.0, 0, 0.55, false);
    }
    this.box(m, g.x, y + 6.1, g.z, 8.6, 1.1, 1.7, 0, 0.55, false);
    this.box(this.mats.roof, g.x, y + 6.95, g.z, 9.6, 0.5, 2.6, 0, 1.0, false);
    // flanking walls sealing the sanctum (long, tall, with a stepped top)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const x = g.x + side * (5.2 + i * 2.6);
        const z = g.z + i * 0.35;
        const h = 4.2 - i * 0.35;
        this.box(this.mats.stoneWall, x, this.h(x, z) + h / 2 - 0.2, z, 2.7, h, 1.2, side * -6 * i, 0.6, true);
      }
    }
    // stairs up to the sanctum
    for (let i = 0; i < 6; i++) {
      const z = g.z + 2.4 + i * 0.7;
      const stepY = this.h(0, z);
      this.box(this.mats.stoneTiles, 0, stepY + 0.05, z, 6.2, 0.32, 0.72, 0, 0.9, false);
    }
    // the sealed doors (two slabs)
    const doorMat = this.mats.stoneTiles;
    const mk = (side: number): Entity => {
      const e = new Entity(`door-${side}`);
      const mesh = createMesh(this.ctx.device, boxData(2.5, 4.9, 0.45, 0.7));
      e.addComponent('render', { meshInstances: [new MeshInstance(mesh, doorMat)], castShadows: true });
      e.setPosition(g.x + side * 1.26, y + 2.45, g.z);
      this.root.addChild(e);
      return e;
    };
    const left = mk(-1), right = mk(1);
    const colliders = [this.collision.addBox(g.x - 1.26, y + 2.45, g.z, 1.25, 2.45, 0.25), this.collision.addBox(g.x + 1.26, y + 2.45, g.z, 1.25, 2.45, 0.25)];
    this.doors = { left, right, colliders, open: 0 };
    this.stoneLantern(g.x - 5.5, g.z - 4, 'courtyard', 1.15);
    this.stoneLantern(g.x + 5.5, g.z - 4, 'courtyard', 1.15);
  }

  private buildSanctum(): void {
    const s = LEVEL.terraces.sanctum;
    const sh = LEVEL.shrine;
    const base = this.h(sh.x, sh.z);
    const m = this.mats.stoneBlocks, tiles = this.mats.stoneTiles, wood = this.mats.woodRed;
    // platform tiers
    this.box(tiles, sh.x, base + 0.45, sh.z, 12.5, 0.9, 10.5, 0, 0.9, true);
    this.box(m, sh.x, base + 1.2, sh.z, 10.5, 0.6, 8.5, 0, 0.6, true);
    // steps down the south face
    for (let i = 0; i < 4; i++) this.box(tiles, sh.x, base + 0.15 + i * 0.3, sh.z - 5.3 - (3 - i) * 0.45, 4.5, 0.3, 0.5, 0, 0.9, true);
    // pillars
    const pillars: [number, number][] = [[-3.6, -2.8], [3.6, -2.8], [-3.6, 2.8], [3.6, 2.8], [-3.6, 0], [3.6, 0]];
    for (const [px, pz] of pillars) {
      this.cyl(wood, sh.x + px, base + 1.5 + 2.9, sh.z + pz, 0.36, 0.32, 5.8, 14, 0.6, true);
      this.cyl(m, sh.x + px, base + 1.5 + 0.2, sh.z + pz, 0.55, 0.45, 0.4, 12, 0.6, false);
    }
    // beams
    for (const pz of [-2.8, 0, 2.8]) this.box(wood, sh.x, base + 7.4, sh.z + pz, 8.4, 0.4, 0.5, 0, 0.6, false);
    for (const px of [-3.6, 3.6]) this.box(wood, sh.x + px, base + 7.4, sh.z, 0.5, 0.4, 6.4, 0, 0.6, false);
    // tiered roofs (4-sided cones read as pagoda pyramids)
    this.add(this.mats.roof, transformData(cylinderData(8.2, 1.2, 2.6, 4, 1.0, true), [sh.x, base + 7.6 + 1.3, sh.z], [0, 45, 0], [1.25, 1, 1]));
    this.box(wood, sh.x, base + 10.4, sh.z, 5.8, 0.8, 4.6, 0, 0.6, false);
    this.add(this.mats.roof, transformData(cylinderData(5.2, 0.3, 2.2, 4, 1.0, true), [sh.x, base + 10.8 + 1.1, sh.z], [0, 45, 0], [1.25, 1, 1]));
    this.cyl(m, sh.x, base + 13.4, sh.z, 0.22, 0.05, 1.6, 8, 0.6, false);
    // altar pedestal (stone 3)
    const st = LEVEL.stones[2];
    this.box(m, st.x, base + 1.5 + 0.55, st.z, 1.6, 1.1, 1.6, 0, 0.7, true);
    this.cyl(tiles, st.x, base + 1.5 + 1.25, st.z, 0.8, 0.62, 0.3, 12, 0.7, false);
    this.pedestals[2] = new Vec3(st.x, base + 1.5 + 1.42, st.z);
    this.altarTop.copy(this.pedestals[2]);
    // hero statue slot behind the altar
    this.box(m, sh.x, base + 1.5 + 0.35, sh.z + 2.9, 2.2, 0.7, 2.2, 0, 0.7, true);
    this.heroSlot.set(sh.x, base + 1.5 + 0.7, sh.z + 2.9);
    this.ringAnchor.set(sh.x, base + 9.5, sh.z);
    // sanctum perimeter: tall ruined walls and lanterns
    for (let a = 20; a < 340; a += 9) {
      if (a > 240 && a < 300) continue; // opening toward the inner gate (south)
      const rad = a * Math.PI / 180;
      const x = s.x + Math.cos(rad) * 15.5, z = s.z + Math.sin(rad) * 15.5;
      if (this.rand() < 0.2) continue;
      const h = 1.6 + this.rand() * 2.6;
      this.box(this.mats.stoneWall, x, this.h(x, z) + h / 2 - 0.2, z, 2.6, h, 0.9, -a + 90, 0.6, true);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      if (Math.abs(a - Math.PI * 1.5) < 0.5) continue;
      this.stoneLantern(s.x + Math.cos(a) * 11, s.z + Math.sin(a) * 11, 'sanctum', 1.15);
    }
  }

  private lanternLights: Entity[] = [];

  /** Creates one clustered point light per lantern; they stay dark until the first stone wakes. */
  createLanternLights(): void {
    if (this.lanternLights.length) return;
    for (const l of this.lanterns) {
      const e = new Entity('lantern-light');
      e.addComponent('light', {
        type: 'omni', color: new Color(1.0, 0.62, 0.28), intensity: 0, range: 9,
        castShadows: false, falloffMode: 1,
      });
      e.setPosition(l.pos.x, l.pos.y + 0.08, l.pos.z);
      this.root.addChild(e);
      this.lanternLights.push(e);
    }
  }

  setLanternLightLevel(v: number): void {
    for (const e of this.lanternLights) e.light!.intensity = v * 2.6;
  }

  /** Restores the doors to their sealed state (used by restart). */
  setDoorOpenReset(): void {
    const g = LEVEL.terraces.innerGate;
    const y = this.h(g.x, g.z);
    this.doors.open = 0;
    this.doors.left.setPosition(g.x - 1.26, y + 2.45, g.z);
    this.doors.right.setPosition(g.x + 1.26, y + 2.45, g.z);
    if (this.doors.colliders.length === 0) {
      this.doors.colliders = [
        this.collision.addBox(g.x - 1.26, y + 2.45, g.z, 1.25, 2.45, 0.25),
        this.collision.addBox(g.x + 1.26, y + 2.45, g.z, 1.25, 2.45, 0.25),
      ];
    }
  }

  /** Slides the sealed doors open (0 closed .. 1 open). */
  setDoorOpen(t: number): void {
    const d = this.doors;
    d.open = t;
    const g = LEVEL.terraces.innerGate;
    const y = this.h(g.x, g.z);
    d.left.setPosition(g.x - 1.26 - t * 2.6, y + 2.45, g.z + t * 0.3);
    d.right.setPosition(g.x + 1.26 + t * 2.6, y + 2.45, g.z + t * 0.3);
    if (t > 0.6 && d.colliders.length) { for (const c of d.colliders) this.collision.remove(c); d.colliders = []; }
  }
}
