import {
  BoundingBox, Color, Entity, Mesh, MeshInstance, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL, StandardMaterial, Vec3,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { AssetBank } from '@/assets/manifest';
import { LEVEL, type Terrace } from './level';
import { fbm2, ridged2, snoise2 } from '@/utils/noise';
import { clamp01, smoothstep, lerp } from '@/utils/math';
import { terrainGLSL, terrainWGSL } from '@/shaders/terrain';

export type Surface = 'ground' | 'stone' | 'water' | 'grass' | 'rock';

/** CPU-side heightfield: authoritative for collision, placement and the render mesh. */
export class TerrainField {
  readonly size = LEVEL.size;
  readonly cell = LEVEL.cell;
  readonly n: number;             // vertices per side
  readonly heights: Float32Array;
  readonly paved: Float32Array;   // 0..1 cobblestone mask
  readonly moss: Float32Array;
  readonly puddle: Float32Array;
  private pathPts: { x: number; z: number; y: number; d: number }[] = [];

  constructor() {
    this.n = Math.round(this.size / this.cell) + 1;
    const N = this.n;
    this.heights = new Float32Array(N * N);
    this.paved = new Float32Array(N * N);
    this.moss = new Float32Array(N * N);
    this.puddle = new Float32Array(N * N);
    this.buildPath();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i * this.cell - this.size / 2, z = j * this.cell - this.size / 2;
      const s = this.sampleAnalytic(x, z);
      const k = j * N + i;
      this.heights[k] = s.y; this.paved[k] = s.paved; this.moss[k] = s.moss; this.puddle[k] = s.puddle;
    }
    // light smoothing pass keeps terraces crisp but removes 1m aliasing on slopes
    const tmp = new Float32Array(this.heights);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      tmp[k] = this.heights[k] * 0.5 + (this.heights[k - 1] + this.heights[k + 1] + this.heights[k - N] + this.heights[k + N]) * 0.125;
    }
    this.heights.set(tmp);
  }

  private buildPath(): void {
    const terr = LEVEL.terraces;
    const pts = LEVEL.path;
    const heightsAlong = [terr.spawn.y, 0.12, 0.55, 0.95, 1.45, terr.gate.y, 2.2, terr.courtyard.y];
    let d = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      this.pathPts.push({ x: pts[i][0], z: pts[i][1], y: heightsAlong[i], d });
    }
  }

  /** distance to path polyline and interpolated path height */
  private pathInfo(x: number, z: number): { dist: number; y: number } {
    let best = 1e9, bestY = 0;
    const p = this.pathPts;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i].x, az = p[i].z, bx = p[i + 1].x, bz = p[i + 1].z;
      const abx = bx - ax, abz = bz - az;
      const len2 = abx * abx + abz * abz;
      let t = ((x - ax) * abx + (z - az) * abz) / Math.max(len2, 1e-6);
      t = clamp01(t);
      const px = ax + abx * t, pz = az + abz * t;
      const dist = Math.hypot(x - px, z - pz);
      if (dist < best) { best = dist; bestY = lerp(p[i].y, p[i + 1].y, t); }
    }
    return { dist: best, y: bestY };
  }

  /** Analytic terrain definition. */
  sampleAnalytic(x: number, z: number): { y: number; paved: number; moss: number; puddle: number } {
    const r = Math.hypot(x, z);
    // rolling forest floor rising to the north
    let y = 0.035 * z + fbm2(x * 0.021 + 3.7, z * 0.021 - 1.2, 4) * 5.5 + fbm2(x * 0.085, z * 0.085, 3) * 1.1;
    // rocky backdrop ridge rising behind the shrine so the sanctum reads as carved into the mountain
    const back = smoothstep(56, 96, z) * (1 - smoothstep(30, 70, Math.abs(x)));
    y += back * (14 + ridged2(x * 0.02 + 2, z * 0.02, 3) * 22);
    // mountain ring enclosing the level (kept far from the play space; fog does the rest)
    const ring = smoothstep(LEVEL.mountainRadius, LEVEL.mountainRadius + 60, r);
    y += ring * (6 + ridged2(x * 0.014 + 9, z * 0.014 + 4, 4) * 22) + ring * ring * 28;

    let paved = 0, moss = 0, puddle = 0;
    // terraces
    const T = LEVEL.terraces;
    const flatten = (t: Terrace, edge: number, pave: number, paveR: number) => {
      const d = Math.hypot(x - t.x, z - t.z);
      const w = 1 - smoothstep(t.r, t.r + edge, d);
      if (w <= 0) return;
      const micro = snoise2(x * 0.5, z * 0.5) * 0.06 + snoise2(x * 0.11, z * 0.11) * 0.12;
      y = lerp(y, t.y + micro, w);
      if (pave > 0) {
        const pn = snoise2(x * 0.35 + 2, z * 0.35) * 0.5 + 0.5;
        const pw = (1 - smoothstep(paveR * 0.8, paveR * 1.05, d + (pn - 0.5) * 3)) * pave;
        paved = Math.max(paved, pw * w);
      }
    };
    flatten(T.spawn, 7, 0, 0);
    flatten(T.approach, 6, 0, 0);
    flatten(T.gate, 5, 0.85, 7);
    flatten(T.courtyard, 8, 0.9, 14);
    flatten(T.grotto, 5, 0.35, 4);
    flatten(T.ruin, 5, 0.6, 6);
    flatten(T.innerGate, 4, 0.9, 5.5);
    flatten(T.sanctum, 7, 0.95, 12);

    // path corridor
    const pi = this.pathInfo(x, z);
    const pw = 1 - smoothstep(2.2, 5.5, pi.dist);
    if (pw > 0) {
      y = lerp(y, pi.y + snoise2(x * 0.6, z * 0.6) * 0.05, pw);
      const worn = snoise2(x * 0.3, z * 0.3 + 7) * 0.5 + 0.5;
      paved = Math.max(paved, (1 - smoothstep(1.2, 2.4, pi.dist + worn * 0.8)) * 0.85);
    }
    // pools: shallow basins
    for (const p of LEVEL.pools) {
      const d = Math.hypot(x - p.x, z - p.z);
      const w = 1 - smoothstep(p.r * 0.55, p.r * 1.15, d);
      if (w > 0) { y -= w * 0.42; puddle = Math.max(puddle, w); paved *= 1 - w * 0.6; }
    }
    // moss where it's damp and flat-ish, with noise
    const mossN = fbm2(x * 0.09 + 11, z * 0.09 - 5, 3) * 0.5 + 0.5;
    moss = clamp01(mossN * 1.3 - 0.25) * (1 - paved);
    // low areas collect water: puddle mask from local noise
    const wetN = snoise2(x * 0.16 + 5, z * 0.16 + 9) * 0.5 + 0.5;
    puddle = Math.max(puddle, clamp01(wetN * 1.4 - 0.75) * (paved > 0.3 ? 1.0 : 0.55));
    return { y, paved: clamp01(paved), moss, puddle: clamp01(puddle) };
  }

  private idx(i: number, j: number): number { return clampInt(j, 0, this.n - 1) * this.n + clampInt(i, 0, this.n - 1); }

  heightAt(x: number, z: number): number {
    const fx = (x + this.size / 2) / this.cell, fz = (z + this.size / 2) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h00 = this.heights[this.idx(i, j)], h10 = this.heights[this.idx(i + 1, j)];
    const h01 = this.heights[this.idx(i, j + 1)], h11 = this.heights[this.idx(i + 1, j + 1)];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }
  maskAt(arr: Float32Array, x: number, z: number): number {
    const fx = (x + this.size / 2) / this.cell, fz = (z + this.size / 2) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    return lerp(lerp(arr[this.idx(i, j)], arr[this.idx(i + 1, j)], tx), lerp(arr[this.idx(i, j + 1)], arr[this.idx(i + 1, j + 1)], tx), tz);
  }
  normalAt(x: number, z: number, out = new Vec3()): Vec3 {
    const e = 0.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }
  slopeAt(x: number, z: number): number { return 1 - this.normalAt(x, z).y; }
  surfaceAt(x: number, z: number): Surface {
    if (this.maskAt(this.puddle, x, z) > 0.62 && this.slopeAt(x, z) < 0.08) return 'water';
    if (this.maskAt(this.paved, x, z) > 0.45) return 'stone';
    if (this.slopeAt(x, z) > 0.4) return 'rock';
    if (this.maskAt(this.moss, x, z) > 0.55) return 'grass';
    return 'ground';
  }
  inBounds(x: number, z: number, margin = 2): boolean {
    const h = this.size / 2 - margin;
    return x > -h && x < h && z > -h && z < h;
  }
}

const clampInt = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Builds the chunked terrain render mesh with the splat material. */
export class TerrainRenderer {
  root: Entity;
  material: StandardMaterial;
  private wetParams = new Float32Array([0.92, 0.62, 1.0, 0]);
  private time = 0;

  constructor(ctx: EngineContext, assets: AssetBank, public field: TerrainField) {
    const { app, device } = ctx;
    this.root = new Entity('terrain');
    app.root.addChild(this.root);

    const A = assets.set('forest_ground_04'), B = assets.set('mossy_rock'), C = assets.set('mossy_cobblestone'), D = assets.set('rock_face_03');
    const m = new StandardMaterial();
    m.name = 'terrain';
    m.diffuseMap = A.diff; m.normalMap = A.nor; m.aoMap = A.arm; m.glossMap = A.arm; m.glossMapChannel = 'g'; m.glossInvert = true;
    m.diffuseVertexColor = true;
    m.diffuse = new Color(0.62, 0.66, 0.62);
    m.useMetalness = true; m.metalness = 0; m.gloss = 1;
    m.aoIntensity = 1;
    m.bumpiness = 1;
    m.shaderChunksVersion = '2.8';
    const g = m.getShaderChunks(SHADERLANGUAGE_GLSL), w = m.getShaderChunks(SHADERLANGUAGE_WGSL);
    for (const [k, v] of Object.entries(terrainGLSL)) g.set(k, v);
    for (const [k, v] of Object.entries(terrainWGSL)) w.set(k, v);
    const bind = (prefix: string, set: { diff: unknown; nor: unknown; arm: unknown }) => {
      m.setParameter(`${prefix}_diff`, set.diff as never); m.setParameter(`${prefix}_nor`, set.nor as never); m.setParameter(`${prefix}_arm`, set.arm as never);
    };
    bind('uTerA', A); bind('uTerB', B); bind('uTerC', C); bind('uTerD', D);
    m.setParameter('uTerTiling', [0.28, 0.32, 0.45, 0.16]);
    m.setParameter('uTerWet', this.wetParams);
    // the cobble/forest-floor scans are very warm; cool and desaturate them to sit in a dusk palette
    m.setParameter('uTerTint', [0.66, 0.72, 0.74, 0.68]);
    m.update();
    this.material = m;

    // chunked mesh so the frustum culls what's behind the player
    const f = field, N = f.n, chunk = 30;
    const chunks = Math.floor((N - 1) / chunk);
    const half = f.size / 2;
    for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
      const i0 = ci * chunk, j0 = cj * chunk;
      const w0 = chunk + 1, h0 = chunk + 1;
      const pos = new Float32Array(w0 * h0 * 3), nor = new Float32Array(w0 * h0 * 3), uv = new Float32Array(w0 * h0 * 2), col = new Float32Array(w0 * h0 * 4);
      const idx = new Uint16Array(chunk * chunk * 6);
      const bb = new BoundingBox();
      let minY = 1e9, maxY = -1e9;
      const nrm = new Vec3();
      for (let j = 0; j < h0; j++) for (let i = 0; i < w0; i++) {
        const gi = i0 + i, gj = j0 + j;
        const x = gi * f.cell - half, z = gj * f.cell - half;
        const y = f.heights[gj * N + gi];
        const v = j * w0 + i;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        f.normalAt(x, z, nrm);
        nor[v * 3] = nrm.x; nor[v * 3 + 1] = nrm.y; nor[v * 3 + 2] = nrm.z;
        uv[v * 2] = i / chunk; uv[v * 2 + 1] = j / chunk;
        const k = gj * N + gi;
        col[v * 4] = f.paved[k]; col[v * 4 + 1] = f.moss[k]; col[v * 4 + 2] = f.puddle[k]; col[v * 4 + 3] = 1;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      let t = 0;
      for (let j = 0; j < chunk; j++) for (let i = 0; i < chunk; i++) {
        const a = j * w0 + i, b = a + 1, c = a + w0, d = c + 1;
        // alternate diagonal for a more natural triangulation
        if ((i + j) & 1) { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
        else { idx[t++] = a; idx[t++] = c; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = b; }
      }
      const mesh = new Mesh(device);
      mesh.setPositions(pos); mesh.setNormals(nor); mesh.setUvs(0, uv); mesh.setColors(col, 4); mesh.setIndices(idx);
      mesh.update();
      const x0 = i0 * f.cell - half, z0 = j0 * f.cell - half;
      bb.setMinMax(new Vec3(x0, minY - 0.5, z0), new Vec3(x0 + chunk * f.cell, maxY + 0.5, z0 + chunk * f.cell));
      mesh.aabb = bb;
      const mi = new MeshInstance(mesh, m);
      mi.castShadow = true;
      mi.receiveShadow = true;
      const e = new Entity(`terrain-${ci}-${cj}`);
      e.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true });
      this.root.addChild(e);
    }
  }

  setWetness(wet: number, puddleLevel: number, ripple: number): void {
    this.wetParams[0] = wet; this.wetParams[1] = puddleLevel; this.wetParams[2] = ripple;
  }

  update(dt: number): void {
    this.time += dt;
    this.wetParams[3] = this.time;
    this.material.setParameter('uTerWet', this.wetParams);
  }
}
