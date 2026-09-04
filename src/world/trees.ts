import { Color, Mesh, StandardMaterial, GraphicsDevice, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL, Texture, BLEND_NONE } from 'playcanvas';
import { appendData, createMesh, cylinderData, emptyData, transformData, type MeshData } from '@/utils/geometry';
import { rng } from '@/utils/math';
import { windGLSL, windWGSL } from '@/shaders/wind';
import { pbrFromTextures } from './materials';
import type { AssetBank } from '@/assets/manifest';
import type { LeafAtlas } from './leafAtlas';

export type TreeSpecies = 'broadleaf' | 'conifer';
export interface TreeMeshes { trunk: Mesh; leaves: Mesh; height: number; radius: number; }

/** Procedural trees: recursive tapered branches + crossed leaf-card clusters at branch tips. */
export function buildTree(device: GraphicsDevice, species: TreeSpecies, seed: number, height = 11): TreeMeshes {
  const rand = rng(seed);
  const trunk = emptyData();
  const leaves = emptyData();
  let maxR = 0;

  const card = (x: number, y: number, z: number, size: number, yaw: number, tilt: number, variant: number) => {
    // two crossed quads; UVs pick one of 4 atlas quadrants for variety
    const u0 = (variant % 2) * 0.5, v0 = Math.floor(variant / 2) % 2 * 0.5;
    for (let k = 0; k < 2; k++) {
      const a = yaw + k * Math.PI / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const base = leaves.positions.length / 3;
      const hs = size / 2;
      // quad corners in local: (-hs..hs, -hs..hs) rotated by yaw around Y then tilted
      const corners: [number, number][] = [[-hs, -hs], [hs, -hs], [-hs, hs], [hs, hs]];
      for (const [lx, ly] of corners) {
        const ty = ly * Math.cos(tilt), tz = ly * Math.sin(tilt);
        leaves.positions.push(x + lx * ca - tz * sa, y + ty, z + lx * sa + tz * ca);
        // normal biased upward for softer lighting on leaf cards
        leaves.normals.push(-sa * 0.4, 0.85, ca * 0.4);
        leaves.uvs.push(u0 + (lx > 0 ? 0.5 : 0), v0 + (ly > 0 ? 0 : 0.5));
      }
      leaves.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    maxR = Math.max(maxR, Math.hypot(x, z) + size * 0.5);
  };

  const branch = (x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number, len: number, r: number, depth: number) => {
    const ex = x + dirX * len, ey = y + dirY * len, ez = z + dirZ * len;
    const segs = depth === 0 ? 8 : depth === 1 ? 5 : 4;
    const tip = depth >= 2 ? r * 0.35 : r * 0.62;
    const data = cylinderData(r, tip, len, segs, 0.9, depth === 0);
    // orient cylinder (y-up) along dir
    const pitch = Math.acos(Math.max(-1, Math.min(1, dirY))) * 180 / Math.PI;
    const yaw = Math.atan2(dirX, dirZ) * 180 / Math.PI;
    transformData(data, [(x + ex) / 2, (y + ey) / 2, (z + ez) / 2], [pitch, yaw, 0]);
    appendData(trunk, data);
    if (depth >= (species === 'conifer' ? 2 : 3) || len < 0.9) {
      const n = species === 'conifer' ? 6 + Math.floor(rand() * 3) : 5 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const s = species === 'conifer' ? 0.62 + rand() * 0.34 : 0.78 + rand() * 0.55;
        const t = 0.45 + rand() * 0.6;
        card(x + dirX * len * t + (rand() - 0.5) * 1.5, y + dirY * len * t + (rand() - 0.5) * 1.0, z + dirZ * len * t + (rand() - 0.5) * 1.5, s, rand() * Math.PI, (rand() - 0.5) * 0.9, Math.floor(rand() * 4));
      }
      return;
    }
    const children = species === 'conifer' ? 5 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 2);
    for (let i = 0; i < children; i++) {
      const t = species === 'conifer' ? 0.3 + (i / children) * 0.65 : 0.55 + rand() * 0.45;
      const a = rand() * Math.PI * 2;
      const spread = species === 'conifer' ? 0.85 : 0.55 + rand() * 0.35;
      let ndx = dirX + Math.cos(a) * spread, ndy = dirY * (species === 'conifer' ? 0.25 : 0.7) + (species === 'conifer' ? -0.05 : 0.35), ndz = dirZ + Math.sin(a) * spread;
      const l = Math.hypot(ndx, ndy, ndz); ndx /= l; ndy /= l; ndz /= l;
      const cl = len * (species === 'conifer' ? 0.32 + (1 - t) * 0.3 : 0.55 + rand() * 0.2);
      branch(x + dirX * len * t, y + dirY * len * t, z + dirZ * len * t, ndx, ndy, ndz, cl, r * (species === 'conifer' ? 0.35 : 0.55), depth + 1);
    }
    if (species === 'conifer') {
      // leader continues upward with a top cluster
      card(ex, ey + 0.4, ez, 0.9, rand() * Math.PI, 0.2, 1);
      card(ex, ey - 0.2, ez, 1.1, rand() * Math.PI + 0.7, -0.2, 2);
    }
  };

  const trunkR = species === 'conifer' ? 0.22 + rand() * 0.08 : 0.3 + rand() * 0.14;
  const lean = (rand() - 0.5) * 0.12;
  branch(0, -0.3, 0, lean, 1, (rand() - 0.5) * 0.12, height * (species === 'conifer' ? 0.55 : 0.5), trunkR, 0);
  // roots flare
  appendData(trunk, transformData(cylinderData(trunkR * 1.9, trunkR * 1.05, 0.9, 10, 0.9, false), [0, 0.15, 0]));

  return { trunk: createMesh(device, trunk), leaves: createLeafMesh(device, leaves), height, radius: maxR };
}

function createLeafMesh(device: GraphicsDevice, data: MeshData): Mesh {
  return createMesh(device, data);
}

export function treeMaterials(assets: AssetBank, atlasBroad: LeafAtlas, atlasConifer: LeafAtlas): { bark: StandardMaterial; barkB: StandardMaterial; leavesBroad: StandardMaterial; leavesConifer: StandardMaterial } {
  const wind = { glsl: windGLSL, wgsl: windWGSL };
  const barkSet = assets.set('bark_willow_02');
  const bark = pbrFromTextures(barkSet.diff, barkSet.nor, barkSet.arm, 'bark', { tiling: 1, tint: new Color(0.75, 0.72, 0.66), wet: 0.6, wetTop: 0.2, chunks: wind });
  const barkB = pbrFromTextures(assets.tex('barkB_diff'), assets.tex('barkB_nor'), assets.tex('barkB_arm'), 'bark-b', { tiling: 1, tint: new Color(0.8, 0.78, 0.74), wet: 0.6, wetTop: 0.2, chunks: wind });
  const leafMat = (atlas: LeafAtlas, name: string, tint: Color): StandardMaterial => {
    const m = pbrFromTextures(atlas.diffuse, atlas.normal, null, name, { tint, wet: 0.3, wetTop: 0.5, twoSided: true, gloss: 0.55, chunks: wind });
    m.opacityMap = atlas.diffuse as Texture; m.opacityMapChannel = 'a';
    m.alphaTest = 0.52; m.blendType = BLEND_NONE;
    m.useMetalness = true; m.metalness = 0; m.gloss = 0.22;
    m.diffuseMapTiling.set(1, 1); m.normalMapTiling.set(1, 1); m.bumpiness = 0.6;
    // subtle translucency look: lift shadowed side via ambient occlusion off + emissive tint
    m.emissive = tint.clone().mulScalar(0.012);
    m.update();
    return m;
  };
  const leavesBroad = leafMat(atlasBroad, 'leaves-broad', new Color(0.34, 0.44, 0.30));
  const leavesConifer = leafMat(atlasConifer, 'leaves-conifer', new Color(0.26, 0.36, 0.28));
  return { bark, barkB, leavesBroad, leavesConifer };
}

export { SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL };
