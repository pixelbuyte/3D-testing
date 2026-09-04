import {
  BLEND_NONE, BoundingBox, Color, Entity, Mat4, Mesh, MeshInstance, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL,
  StandardMaterial, Vec3,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { AssetBank } from '@/assets/manifest';
import type { TerrainField } from './terrain';
import type { CollisionWorld } from '@/player/collision';
import { LEVEL } from './level';
import { createInstancedCells, extractRenderables, type InstanceXform } from './instancing';
import { buildTree, treeMaterials } from './trees';
import { buildLeafAtlas } from './leafAtlas';
import { windGLSL, windWGSL } from '@/shaders/wind';
import { clamp01, rng, smoothstep, lerp } from '@/utils/math';
import { fbm2 } from '@/utils/noise';
import { settings } from '@/core/settings';

interface Placement { xf: InstanceXform; }

/** One scatter layer = one source model (or procedural mesh) instanced across the level. */
interface Layer {
  name: string;
  meshes: { mesh: Mesh; material: StandardMaterial; pre: Mat4 }[];
  places: Placement[];
  castShadow: boolean;
  cellSize: number;
}

const _v = new Vec3();
const _m = new Mat4();

/**
 * Places and instances all vegetation, rocks and small debris.
 *
 * Placement is deterministic (seeded RNG + rejection sampling against terrain slope, masks and
 * keep-out zones). Every layer is drawn with hardware instancing, grouped into spatial cells so the
 * frustum culls whole cells at once. Foliage density is a live setting: the instance buffers are
 * built once at full density in shuffled order, and the setting simply lowers `instancingCount`.
 */
export class Scatter {
  root: Entity;
  private instances: MeshInstance[] = [];
  private fullCounts = new Map<MeshInstance, number>();
  private layers: Layer[] = [];
  private rand = rng(90210);

  constructor(private ctx: EngineContext, private assets: AssetBank, private field: TerrainField, private collision: CollisionWorld) {
    this.root = new Entity('scatter');
    ctx.app.root.addChild(this.root);
  }

  // ---------------------------------------------------------------- keep-out tests
  /** Distance from the pilgrim path polyline. */
  private pathDist(x: number, z: number): number {
    let best = 1e9;
    const p = LEVEL.path;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
      const abx = bx - ax, abz = bz - az;
      const t = clamp01(((x - ax) * abx + (z - az) * abz) / Math.max(abx * abx + abz * abz, 1e-6));
      best = Math.min(best, Math.hypot(x - (ax + abx * t), z - (az + abz * t)));
    }
    return best;
  }

  /** How "built" a location is: 1 inside a courtyard/terrace, 0 in the wild. */
  private builtness(x: number, z: number): number {
    let m = 0;
    const T = LEVEL.terraces;
    for (const key of Object.keys(T) as (keyof typeof T)[]) {
      const t = T[key];
      m = Math.max(m, 1 - smoothstep(t.r * 0.72, t.r * 1.15, Math.hypot(x - t.x, z - t.z)));
    }
    return m;
  }

  private poolDist(x: number, z: number): number {
    let best = 1e9;
    for (const p of LEVEL.pools) best = Math.min(best, Math.hypot(x - p.x, z - p.z) - p.r);
    return best;
  }

  private stoneDist(x: number, z: number): number {
    let best = 1e9;
    for (const s of LEVEL.stones) best = Math.min(best, Math.hypot(x - s.x, z - s.z));
    return best;
  }

  // ---------------------------------------------------------------- sampling
  /**
   * Rejection-samples `count` points in an annulus around the origin, accepting each only if
   * `accept` returns a probability that beats a random draw. Returns terrain-snapped placements.
   */
  private sample(count: number, rInner: number, rOuter: number, accept: (x: number, z: number, slope: number, built: number) => number,
    opts: { minScale: number; maxScale: number; alignSlope?: number; yOffset?: number; jitterYaw?: boolean } ): Placement[] {
    const out: Placement[] = [];
    const rand = this.rand;
    let guard = count * 40;
    while (out.length < count && guard-- > 0) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(lerp(rInner * rInner, rOuter * rOuter, rand()));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!this.field.inBounds(x, z, 4)) continue;
      const slope = this.field.slopeAt(x, z);
      const built = this.builtness(x, z);
      const p = accept(x, z, slope, built);
      if (p <= 0 || rand() > p) continue;
      const scale = lerp(opts.minScale, opts.maxScale, rand() * rand() + rand() * 0.35);
      const n = this.field.normalAt(x, z, _v);
      const align = opts.alignSlope ?? 0;
      out.push({
        xf: {
          x, y: this.field.heightAt(x, z) + (opts.yOffset ?? 0), z,
          yaw: opts.jitterYaw === false ? 0 : rand() * Math.PI * 2,
          scale,
          tiltX: align ? Math.atan2(-n.z, n.y) * align : (rand() - 0.5) * 0.06,
          tiltZ: align ? Math.atan2(n.x, n.y) * align : (rand() - 0.5) * 0.06,
        },
      });
    }
    return out;
  }

  private shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---------------------------------------------------------------- model templates
  /**
   * Instantiates a GLB once off-screen, harvests its (mesh, material, local-transform) triples and
   * normalises them so the model's base sits at y=0 and it is centred in x/z. Applies the wind
   * vertex shader to plant materials and converts blended foliage to alpha-test so it sorts and
   * shadows correctly.
   */
  private template(id: string, kind: 'plant' | 'solid', windAmount: number): Layer['meshes'] {
    const container = this.assets.model(id);
    const inst = container.instantiateRenderEntity();
    // measure combined local-space bounds
    const parts = extractRenderables(inst);
    const bb = new BoundingBox();
    let first = true;
    for (const p of parts) {
      const b = new BoundingBox();
      b.setFromTransformedAabb(p.mesh.aabb, p.transform);
      if (first) { bb.copy(b); first = false; } else bb.add(b);
    }
    inst.destroy();
    const min = bb.getMin(), center = bb.center;
    // normalise: centre x/z, drop base to y = 0
    _m.setTranslate(-center.x, -min.y, -center.z);
    const out: Layer['meshes'] = [];
    const seen = new Set<StandardMaterial>();
    for (const p of parts) {
      const mat = p.material;
      if (!seen.has(mat)) {
        seen.add(mat);
        if (kind === 'plant') {
          // BLEND foliage sorts badly and cannot cast shadows: force alpha test instead
          mat.blendType = BLEND_NONE;
          mat.alphaTest = 0.42;
          mat.depthWrite = true;
          mat.cull = 0;
          mat.twoSidedLighting = true;
          mat.opacityMapChannel = 'a';
        }
        mat.useMetalness = true;
        mat.shaderChunksVersion = '2.8';
        if (windAmount > 0) {
          const g = mat.getShaderChunks(SHADERLANGUAGE_GLSL), w = mat.getShaderChunks(SHADERLANGUAGE_WGSL);
          for (const [k, v] of Object.entries(windGLSL)) g.set(k, v);
          for (const [k, v] of Object.entries(windWGSL)) w.set(k, v);
          mat.setParameter('uWindAmount', windAmount);
        }
        mat.update();
      }
      out.push({ mesh: p.mesh, material: mat, pre: new Mat4().mul2(_m, p.transform) });
    }
    return out;
  }

  private addLayer(name: string, meshes: Layer['meshes'], places: Placement[], castShadow: boolean, cellSize: number): void {
    if (places.length === 0 || meshes.length === 0) return;
    this.shuffle(places);
    const xforms = places.map((p) => p.xf);
    for (const m of meshes) {
      const cells = createInstancedCells(this.ctx.device, this.root, name, m.mesh, m.material, xforms, cellSize, m.pre, castShadow);
      for (const cell of cells) {
        for (const mi of cell.render!.meshInstances) { this.fullCounts.set(mi, mi.instancingCount); this.instances.push(mi); }
      }
    }
    this.layers.push({ name, meshes, places, castShadow, cellSize });
  }

  // ---------------------------------------------------------------- build
  async build(onProgress: (p: number, status: string) => void): Promise<void> {
    const step = async (p: number, s: string) => { onProgress(p, s); await new Promise<void>((r) => requestAnimationFrame(() => r())); };

    // ---------- 1. trees: the forest that encloses and frames the level
    await step(0.05, 'Growing the forest…');
    const [atlasBroad, atlasConifer, atlasFern] = await Promise.all([
      buildLeafAtlas(this.ctx.device, 'assets/textures/island_tree_01/leaves_diff.webp', 'broadleaf', 11, 1024),
      buildLeafAtlas(this.ctx.device, 'assets/textures/fir_tree_01/twig_diff.webp', 'conifer', 23, 1024),
      buildLeafAtlas(this.ctx.device, 'assets/textures/tree_small_02/leaves_diff.webp', 'fern', 37, 512),
    ]);
    const tm = treeMaterials(this.assets, atlasBroad, atlasConifer);

    // Trees hug the perimeter (hiding the terrain boundary) and thin out toward the shrine,
    // with a handful of hero trees inside for foreground framing.
    const treeAccept = (x: number, z: number, slope: number, built: number): number => {
      if (slope > 0.55) return 0;
      if (this.pathDist(x, z) < 9.5) return 0;   // keep the walked corridor and its sightlines clear
      if (this.poolDist(x, z) < 2) return 0;
      if (this.stoneDist(x, z) < 10) return 0;
      if (built > 0.35) return 0;
      const r = Math.hypot(x, z);
      const density = smoothstep(16, 46, r);              // clearing around the shrine complex
      const clumping = clamp01(fbm2(x * 0.035, z * 0.035, 3) * 0.9 + 0.55);
      return density * clumping * (1 - built);
    };
    const bigTrees = this.sample(540, 20, 108, treeAccept, { minScale: 0.8, maxScale: 1.5 });
    const smallTrees = this.sample(300, 16, 100, (x, z, s, b) => treeAccept(x, z, s, b) * 0.9 + (b < 0.2 ? 0.15 : 0), { minScale: 0.5, maxScale: 0.95 });

    // three trunk/canopy variants per species so the silhouette does not repeat
    const speciesLayers: { species: 'broadleaf' | 'conifer'; seed: number; h: number; frac: number }[] = [
      { species: 'broadleaf', seed: 3, h: 13, frac: 0.30 },
      { species: 'broadleaf', seed: 8, h: 10, frac: 0.22 },
      { species: 'conifer', seed: 5, h: 17, frac: 0.28 },
      { species: 'conifer', seed: 12, h: 13, frac: 0.20 },
    ];
    let cursor = 0;
    for (const sl of speciesLayers) {
      const n = Math.round(bigTrees.length * sl.frac);
      const slice = bigTrees.slice(cursor, cursor + n); cursor += n;
      const t = buildTree(this.ctx.device, sl.species, sl.seed, sl.h);
      const leafMat = sl.species === 'conifer' ? tm.leavesConifer : tm.leavesBroad;
      const barkMat = sl.seed % 2 ? tm.barkB : tm.bark;
      this.addLayer(`tree-${sl.species}-${sl.seed}`, [{ mesh: t.trunk, material: barkMat, pre: new Mat4() }], slice, true, 46);
      this.addLayer(`leaf-${sl.species}-${sl.seed}`, [{ mesh: t.leaves, material: leafMat, pre: new Mat4() }], slice, true, 46);
      // trunks are solid: register collision for the ones near the play space
      for (const p of slice) {
        if (Math.hypot(p.xf.x, p.xf.z) < 62) this.collision.addCylinder(p.xf.x, p.xf.y - 0.5, p.xf.z, 0.34 * p.xf.scale * (sl.h / 12), 6);
      }
    }
    cursor = 0;
    for (const sl of [{ species: 'broadleaf' as const, seed: 21, h: 6.5, frac: 0.5 }, { species: 'conifer' as const, seed: 33, h: 7.5, frac: 0.5 }]) {
      const n = Math.round(smallTrees.length * sl.frac);
      const slice = smallTrees.slice(cursor, cursor + n); cursor += n;
      const t = buildTree(this.ctx.device, sl.species, sl.seed, sl.h);
      this.addLayer(`sapling-${sl.seed}`, [{ mesh: t.trunk, material: tm.bark, pre: new Mat4() }], slice, true, 40);
      this.addLayer(`sapling-leaf-${sl.seed}`, [{ mesh: t.leaves, material: sl.species === 'conifer' ? tm.leavesConifer : tm.leavesBroad, pre: new Mat4() }], slice, true, 40);
    }

    // ---------- 2. rocks and boulders
    await step(0.35, 'Setting the stones…');
    const rockAccept = (x: number, z: number, slope: number, built: number): number => {
      if (this.pathDist(x, z) < 2.6) return 0;
      if (built > 0.55) return 0;
      return clamp01(0.25 + slope * 1.5) * (1 - built * 0.8);
    };
    const rockSets: [string, number, number, number, number][] = [
      // id, count, rMin, rMax, maxScale
      ['rock_moss_set_01', 110, 6, 96, 1.1],
      ['rock_moss_set_02', 95, 6, 96, 1.1],
      ['rock_09', 260, 4, 80, 2.6],
    ];
    for (const [id, count, rMin, rMax, maxScale] of rockSets) {
      if (!this.assets.hasModel(id)) continue;
      const meshes = this.template(id, 'solid', 0);
      const places = this.sample(count, rMin, rMax, rockAccept, { minScale: maxScale * 0.45, maxScale, alignSlope: 0.55, yOffset: -0.12 });
      this.addLayer(id, meshes, places, true, 40);
      if (id.startsWith('rock_moss')) for (const p of places) if (Math.hypot(p.xf.x, p.xf.z) < 62) this.collision.addCylinder(p.xf.x, p.xf.y - 0.3, p.xf.z, 1.1 * p.xf.scale, 1.0 * p.xf.scale);
    }

    // ---------- 3. dead wood
    await step(0.5, 'Laying fallen wood…');
    for (const [id, count, maxScale] of [['dead_tree_trunk', 26, 1.4], ['tree_stump_01', 34, 1.2]] as [string, number, number][]) {
      if (!this.assets.hasModel(id)) continue;
      const meshes = this.template(id, 'solid', 0);
      const places = this.sample(count, 10, 92, (x, z, slope, built) => (built > 0.4 || this.pathDist(x, z) < 3.2 ? 0 : 0.8 - slope), { minScale: maxScale * 0.6, maxScale, alignSlope: 0.4 });
      this.addLayer(id, meshes, places, true, 44);
    }

    // ---------- 4. ground cover: ferns, shrubs, grass, flowers
    await step(0.62, 'Seeding moss and ferns…');
    const mossy = (x: number, z: number): number => this.field.maskAt(this.field.moss, x, z);
    const coverAccept = (mult: number, needMoss: number, avoidPath: number) => (x: number, z: number, slope: number, built: number): number => {
      if (this.pathDist(x, z) < avoidPath) return 0;
      if (this.poolDist(x, z) < 0.6) return 0;
      if (slope > 0.62) return 0;
      const m = mossy(x, z);
      if (m < needMoss) return 0;
      // richest right where the player walks, thinning into the distance
      const near = 1 - smoothstep(8, 46, Math.min(this.pathDist(x, z), Math.hypot(x, z) * 0.75));
      return clamp01(mult * (0.35 + m) * (0.45 + near * 0.85) * (1 - built * 0.85) * (1 - smoothstep(0.35, 0.62, slope)));
    };
    const covers: [string, number, number, number, number, number, number][] = [
      // id, count, rMax, minScale, maxScale, needMoss, avoidPath
      ['grass_medium_02', 3000, 58, 0.5, 1.35, 0.10, 1.2],
      ['fern_02', 800, 70, 0.55, 1.35, 0.22, 1.9],
      ['shrub_01', 480, 78, 0.6, 1.35, 0.20, 2.4],
      ['celandine_01', 600, 54, 0.55, 1.2, 0.24, 1.4],
      
    ];
    for (const [id, count, rMax, minScale, maxScale, needMoss, avoidPath] of covers) {
      if (!this.assets.hasModel(id)) continue;
      const meshes = this.template(id, 'plant', id.startsWith('grass') ? 0.9 : 0.55);
      const places = this.sample(count, 2, rMax, coverAccept(1, needMoss, avoidPath), { minScale, maxScale, alignSlope: 0.7, yOffset: -0.04 });
      this.addLayer(id, meshes, places, id !== 'grass_medium_02', 26);
    }

    // ---------- 5. handcrafted detail: pebbles, broken tiles, fallen leaves
    await step(0.82, 'Scattering the small things…');
    void atlasFern;
    this.buildDebris(tm);

    await step(1, 'Ready');
    this.applyDensity();
    settings.on('change', ({ key }) => { if (key === 'foliageDensity' || key === 'preset') this.applyDensity(); });
  }

  /**
   * Tiny, cheap props built from primitives: gravel chips, broken roof tiles near the ruins and
   * flat leaf-litter cards. Hundreds of these are what stop the ground reading as a bare texture.
   */
  private buildDebris(tm: ReturnType<typeof treeMaterials>): void {
    const dev = this.ctx.device;
    const lib = this.assets;
    // -- gravel chips (a squashed low-poly rock, instanced heavily)
    const { boxData, cylinderData, createMesh, transformData, appendData, emptyData } = geo;
    const chipData = emptyData();
    const cr = rng(5150);
    for (let i = 0; i < 3; i++) {
      appendData(chipData, transformData(cylinderData(0.09 + cr() * 0.05, 0.05 + cr() * 0.04, 0.05, 5, 2, true),
        [(cr() - 0.5) * 0.16, 0.025, (cr() - 0.5) * 0.16], [(cr() - 0.5) * 20, cr() * 180, (cr() - 0.5) * 20]));
    }
    const chipMesh = createMesh(dev, chipData);
    // untinted, these read as white confetti scattered over the ground: a chip is debris lying in
    // dirt, so it wants to be darker than the paving it sits on, not brighter
    const gravelMat = pbrMaterial(lib, 'rock_face_03', 'gravel', { tiling: 3.0, tint: new Color(0.55, 0.53, 0.50), wet: 0.85, wetTop: 0.5 });
    const gravel = this.sample(1100, 2, 62, (x, z, slope, built) => (slope > 0.5 ? 0 : 0.35 + this.pathDist(x, z) < 4 ? 0.9 : 0.35) * (built > 0.5 ? 0.9 : 0.5),
      { minScale: 0.5, maxScale: 1.7, alignSlope: 0.8, yOffset: -0.01 });
    this.addLayer('gravel', [{ mesh: chipMesh, material: gravelMat, pre: new Mat4() }], gravel, false, 24);

    // -- broken roof tiles / masonry shards, concentrated near the ruins and walls
    const shardData = emptyData();
    appendData(shardData, transformData(boxData(0.26, 0.035, 0.19, 3), [0, 0.018, 0], [0, 0, 0]));
    const shardMesh = createMesh(dev, shardData);
    const shardMat = pbrMaterial(lib, 'roof_slates_03', 'shards', { tiling: 2.2, tint: new Color(0.52, 0.51, 0.51), wet: 0.70, wetTop: 0.5 });
    const ruin = LEVEL.terraces.ruin, sanct = LEVEL.terraces.sanctum, court = LEVEL.terraces.courtyard;
    const nearRuins = (x: number, z: number): number => {
      const d = Math.min(Math.hypot(x - ruin.x, z - ruin.z) / 14, Math.hypot(x - sanct.x, z - sanct.z) / 20, Math.hypot(x - court.x, z - court.z) / 22);
      return clamp01(1.15 - d);
    };
    const shards = this.sample(420, 2, 55, (x, z, slope) => (slope > 0.4 ? 0 : nearRuins(x, z)), { minScale: 0.55, maxScale: 1.3, alignSlope: 0.95, yOffset: 0.0 });
    this.addLayer('shards', [{ mesh: shardMesh, material: shardMat, pre: new Mat4() }], shards, false, 24);

    // -- leaf litter cards using the fern atlas (very cheap, adds colour variation underfoot)
    const litterData = emptyData();
    const lr = rng(777);
    for (let i = 0; i < 4; i++) {
      const s = 0.35 + lr() * 0.35;
      appendData(litterData, transformData(planeQuad(s, s), [(lr() - 0.5) * 0.5, 0.012 + i * 0.002, (lr() - 0.5) * 0.5], [-90, lr() * 360, 0]));
    }
    const litterMesh = createMesh(dev, litterData);
    const litterMat = tm.leavesBroad.clone();
    litterMat.name = 'litter';
    litterMat.diffuse = new Color(0.72, 0.6, 0.42);
    litterMat.update();
    const litter = this.sample(900, 2, 58, (x, z, slope, built) => (slope > 0.35 ? 0 : clamp01(0.8 - built * 0.4) * clamp01(0.35 + mossyLike(this.field, x, z))),
      { minScale: 0.7, maxScale: 1.6, alignSlope: 1.0, yOffset: 0.0 });
    this.addLayer('litter', [{ mesh: litterMesh, material: litterMat, pre: new Mat4() }], litter, false, 26);
  }

  /** Live foliage-density control: thins every instanced cell without rebuilding buffers. */
  applyDensity(): void {
    const d = clamp01(settings.get('foliageDensity') / 1.5);
    for (const mi of this.instances) {
      const full = this.fullCounts.get(mi) ?? mi.instancingCount;
      mi.instancingCount = Math.max(1, Math.round(full * lerp(0.4, 1, d)));
    }
  }

  get drawableCount(): number { return this.instances.length; }
}

// --- local helpers kept at the bottom so the class reads top-down -------------------------------
import * as geo from '@/utils/geometry';
import { pbrMaterial } from './materials';

function planeQuad(w: number, h: number): geo.MeshData {
  const d = geo.emptyData();
  d.positions.push(-w / 2, 0, -h / 2, w / 2, 0, -h / 2, -w / 2, 0, h / 2, w / 2, 0, h / 2);
  d.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  // sample one quadrant of the 2x2 leaf atlas
  d.uvs.push(0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5);
  d.indices.push(0, 2, 1, 1, 2, 3);
  return d;
}
function mossyLike(field: TerrainField, x: number, z: number): number { return field.maskAt(field.moss, x, z); }
