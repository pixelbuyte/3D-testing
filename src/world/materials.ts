import { Color, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL, StandardMaterial, Texture } from 'playcanvas';
import type { AssetBank, TextureSetId } from '@/assets/manifest';
import { wetGLSL, wetWGSL } from '@/shaders/wet';

export interface PbrOptions {
  tiling?: number;            // tiles per meter (UVs are world-scaled by the geometry builders)
  tint?: Color;
  wet?: number;               // 0..1 wetness
  wetTop?: number;            // upward-facing bias
  bumpiness?: number;
  gloss?: number;
  emissive?: Color; emissiveIntensity?: number;
  twoSided?: boolean;
  chunks?: { glsl: Record<string, string>; wgsl: Record<string, string> };
}

/** Physically based material from a packed Poly Haven set, with the post-rain wet treatment. */
export function pbrMaterial(assets: AssetBank, set: TextureSetId, name: string, o: PbrOptions = {}): StandardMaterial {
  const t = assets.set(set);
  return pbrFromTextures(t.diff, t.nor, t.arm, name, o);
}

export function pbrFromTextures(diff: Texture | null, nor: Texture | null, arm: Texture | null, name: string, o: PbrOptions = {}): StandardMaterial {
  const m = new StandardMaterial();
  m.name = name;
  const tiling = o.tiling ?? 1;
  if (diff) { m.diffuseMap = diff; m.diffuseMapTiling.set(tiling, tiling); }
  if (nor) { m.normalMap = nor; m.normalMapTiling.set(tiling, tiling); m.bumpiness = o.bumpiness ?? 1; }
  if (arm) {
    m.aoMap = arm; m.aoMapChannel = 'r'; m.aoMapTiling.set(tiling, tiling);
    m.glossMap = arm; m.glossMapChannel = 'g'; m.glossInvert = true; m.glossMapTiling.set(tiling, tiling);
    m.metalnessMap = arm; m.metalnessMapChannel = 'b'; m.metalnessMapTiling.set(tiling, tiling);
  }
  m.useMetalness = true;
  m.metalness = 1;
  m.gloss = o.gloss ?? 1;
  m.diffuse = o.tint ?? new Color(1, 1, 1);
  if (o.emissive) { m.emissive = o.emissive; m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  if (o.twoSided) { m.cull = 0; m.twoSidedLighting = true; }
  m.shaderChunksVersion = '2.8';
  const g = m.getShaderChunks(SHADERLANGUAGE_GLSL), w = m.getShaderChunks(SHADERLANGUAGE_WGSL);
  const wet = o.wet ?? 0.7;
  if (wet > 0) {
    for (const [k, v] of Object.entries(wetGLSL)) g.set(k, v);
    for (const [k, v] of Object.entries(wetWGSL)) w.set(k, v);
    m.setParameter('uWetness', wet);
    m.setParameter('uWetTop', o.wetTop ?? 0.6);
  }
  if (o.chunks) {
    for (const [k, v] of Object.entries(o.chunks.glsl)) g.set(k, v);
    for (const [k, v] of Object.entries(o.chunks.wgsl)) w.set(k, v);
  }
  m.update();
  return m;
}

/** Shared material library for the shrine architecture. */
export class MaterialLibrary {
  stoneBlocks: StandardMaterial;
  stoneTiles: StandardMaterial;
  stoneWall: StandardMaterial;
  wood: StandardMaterial;
  woodRed: StandardMaterial;
  roof: StandardMaterial;
  lichen: StandardMaterial;
  bark: StandardMaterial;
  mossRock: StandardMaterial;

  constructor(assets: AssetBank) {
    this.stoneBlocks = pbrMaterial(assets, 'sandstone_blocks_05', 'stone-blocks', { tiling: 0.55, tint: new Color(0.66, 0.68, 0.70), wet: 0.8 });
    this.stoneTiles = pbrMaterial(assets, 'stone_tiles_02', 'stone-tiles', { tiling: 0.9, tint: new Color(0.70, 0.73, 0.74), wet: 0.62, wetTop: 0.45 });
    this.stoneWall = pbrMaterial(assets, 'rustic_stone_wall_02', 'stone-wall', { tiling: 0.6, tint: new Color(0.66, 0.69, 0.71), wet: 0.75 });
    this.wood = pbrMaterial(assets, 'weathered_planks', 'wood', { tiling: 0.8, tint: new Color(0.46, 0.42, 0.38), wet: 0.7 });
    this.woodRed = pbrMaterial(assets, 'weathered_planks', 'wood-red', { tiling: 0.8, tint: new Color(0.44, 0.15, 0.12), wet: 0.72, bumpiness: 0.7 });
    this.roof = pbrMaterial(assets, 'roof_slates_03', 'roof', { tiling: 1.2, tint: new Color(0.42, 0.46, 0.52), wet: 0.9, wetTop: 0.9 });
    this.lichen = pbrMaterial(assets, 'lichen_rock', 'lichen-rock', { tiling: 0.5, tint: new Color(0.68, 0.72, 0.70), wet: 0.75 });
    this.bark = pbrMaterial(assets, 'bark_willow_02', 'bark', { tiling: 0.9, tint: new Color(0.52, 0.50, 0.48), wet: 0.6, wetTop: 0.3 });
    this.mossRock = pbrMaterial(assets, 'mossy_rock', 'moss-rock', { tiling: 0.45, tint: new Color(0.70, 0.76, 0.70), wet: 0.75 });
  }
}
