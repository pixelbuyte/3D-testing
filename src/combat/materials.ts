import { Color, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL, StandardMaterial, type Texture } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { generatedTexture } from '@/utils/geometry';

/**
 * Character materials.
 *
 * The environment is textured PBR and the first fighters were flat colours, which is most of why
 * they read as stand-ins. Two cheap things close the gap: a generated micro-texture (a cloth weave
 * or a leather grain, with a matching normal map) so surfaces have grain at close range, and a
 * fresnel rim so a dark figure separates from dark wet stone instead of dissolving into it.
 */

export interface CharacterMaterialOpts {
  kind: 'cloth' | 'leather' | 'skin' | 'hair' | 'metal' | 'blade';
  /** self-illumination in the material's own colour */
  glow?: number;
}

// ------------------------------------------------------------- rim light chunk

const rimDeclGLSL = /* glsl */`
uniform vec3 uRimColor;
uniform vec4 uRimParams; // strength, power, 0, 0
`;
const rimEmissiveGLSL = /* glsl */`
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
void getEmission() {
    dEmission = material_emissive * material_emissiveIntensity;
    // fresnel rim: brightest at grazing angles, which is exactly the silhouette edge
    float f = pow(1.0 - clamp(dot(dNormalW, dViewDirW), 0.0, 1.0), uRimParams.y);
    dEmission += uRimColor * f * uRimParams.x;
}
`;
const rimDeclWGSL = /* wgsl */`
uniform uRimColor: vec3f;
uniform uRimParams: vec4f;
`;
const rimEmissiveWGSL = /* wgsl */`
uniform material_emissive: vec3f;
uniform material_emissiveIntensity: f32;
fn getEmission() {
    dEmission = uniform.material_emissive * uniform.material_emissiveIntensity;
    let f = pow(1.0 - clamp(dot(dNormalW, dViewDirW), 0.0, 1.0), uniform.uRimParams.y);
    dEmission = dEmission + uniform.uRimColor * f * uniform.uRimParams.x;
}
`;

// ------------------------------------------------------------- generated detail

let clothDiffuse: Texture | null = null;
let clothNormal: Texture | null = null;
let leatherDiffuse: Texture | null = null;
let leatherNormal: Texture | null = null;

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Cheap value noise on the unit square, tileable at integer frequency. */
function noise(u: number, v: number, f: number): number {
  const x = u * f, y = v * f;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const w = (a: number, b: number): number => hash(((a % f) + f) % f, ((b % f) + f) % f);
  const n00 = w(xi, yi), n10 = w(xi + 1, yi), n01 = w(xi, yi + 1), n11 = w(xi + 1, yi + 1);
  return (n00 + (n10 - n00) * sx) * (1 - sy) + (n01 + (n11 - n01) * sx) * sy;
}

/** A height field → tangent-space normal map, wrapping at the edges so it tiles. */
function normalFromHeight(ctx: EngineContext, name: string, size: number, h: (u: number, v: number) => number, strength: number): Texture {
  return generatedTexture(ctx.device, name, size, (u, v) => {
    const e = 1 / size;
    const dx = h(u + e, v) - h(u - e, v);
    const dy = h(u, v + e) - h(u, v - e);
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    return [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1];
  });
}

function ensureTextures(ctx: EngineContext): void {
  if (clothDiffuse) return;
  // a twill: two crossed sine ridges plus a little value noise so it is not perfectly regular
  const weave = (u: number, v: number): number => {
    const a = Math.sin(u * Math.PI * 2 * 12) * Math.sin(v * Math.PI * 2 * 12);
    return 0.5 + a * 0.22 + (noise(u, v, 6) - 0.5) * 0.22;
  };
  clothDiffuse = generatedTexture(ctx.device, 'char-cloth', 64, (u, v) => {
    const w = 0.82 + weave(u, v) * 0.30;
    return [w, w, w, 1];
  });
  clothNormal = normalFromHeight(ctx, 'char-cloth-n', 64, weave, 1.6);

  // leather: broken cells from layered noise, with a faint sheen variation
  const grain = (u: number, v: number): number => noise(u, v, 8) * 0.6 + noise(u, v, 17) * 0.4;
  leatherDiffuse = generatedTexture(ctx.device, 'char-leather', 64, (u, v) => {
    const g = 0.78 + grain(u, v) * 0.32;
    return [g, g, g, 1];
  });
  leatherNormal = normalFromHeight(ctx, 'char-leather-n', 64, grain, 2.4);
}

// ------------------------------------------------------------- the material

/** Put the fresnel rim on a material that already exists (a glTF import, say). */
export function applyRim(m: StandardMaterial, rim: [number, number, number], strength: number, power: number): void {
  m.shaderChunksVersion = '2.8';
  const g = m.getShaderChunks(SHADERLANGUAGE_GLSL), w = m.getShaderChunks(SHADERLANGUAGE_WGSL);
  g.set('litUserDeclarationPS', rimDeclGLSL); g.set('emissivePS', rimEmissiveGLSL);
  w.set('litUserDeclarationPS', rimDeclWGSL); w.set('emissivePS', rimEmissiveWGSL);
  m.setParameter('uRimColor', rim);
  m.setParameter('uRimParams', [strength, power, 0, 0]);
}

export function characterMaterial(ctx: EngineContext, name: string, c: Color, o: CharacterMaterialOpts): StandardMaterial {
  ensureTextures(ctx);
  const m = new StandardMaterial();
  m.name = name;
  m.diffuse = c.clone();
  m.useMetalness = true;

  const tile = (t: number): void => { m.diffuseMapTiling.set(t, t); m.normalMapTiling.set(t, t); };
  let rim: [number, number, number] = [0.55, 0.68, 0.85];
  let rimStrength = 0.30, rimPower = 3.0;

  switch (o.kind) {
    case 'cloth':
      m.diffuseMap = clothDiffuse; m.normalMap = clothNormal; m.bumpiness = 0.45; tile(14);
      m.gloss = 0.24; m.metalness = 0;
      break;
    case 'leather':
      m.diffuseMap = leatherDiffuse; m.normalMap = leatherNormal; m.bumpiness = 0.6; tile(9);
      m.gloss = 0.52; m.metalness = 0.05;
      rimStrength = 0.22;
      break;
    case 'skin':
      m.gloss = 0.34; m.metalness = 0;
      rim = [0.9, 0.62, 0.5]; rimStrength = 0.22; rimPower = 3.5;
      break;
    case 'hair':
      m.gloss = 0.46; m.metalness = 0;
      rimStrength = 0.42; rimPower = 2.6;
      break;
    case 'metal':
      m.gloss = 0.86; m.metalness = 0.92;
      rimStrength = 0.18; rimPower = 4;
      break;
    case 'blade':
      // a mirror-metal blade reflects the dark dusk sky and reads as a black rod; a brighter,
      // less metallic steel with a touch of self-light reads as a blade from any angle
      m.gloss = 0.78; m.metalness = 0.55;
      m.emissive = c.clone(); m.emissiveIntensity = 0.18;
      rim = [0.85, 0.92, 1.0]; rimStrength = 0.55; rimPower = 2.5;
      break;
  }
  if (o.glow && o.glow > 0) { m.emissive = c.clone(); m.emissiveIntensity = o.glow; }

  m.shaderChunksVersion = '2.8';
  const g = m.getShaderChunks(SHADERLANGUAGE_GLSL), w = m.getShaderChunks(SHADERLANGUAGE_WGSL);
  g.set('litUserDeclarationPS', rimDeclGLSL); g.set('emissivePS', rimEmissiveGLSL);
  w.set('litUserDeclarationPS', rimDeclWGSL); w.set('emissivePS', rimEmissiveWGSL);
  m.setParameter('uRimColor', rim);
  m.setParameter('uRimParams', [rimStrength, rimPower, 0, 0]);
  m.update();
  return m;
}
