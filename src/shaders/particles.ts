/**
 * Instanced camera-facing billboards for every particle system in the game.
 *
 * The instance stream reuses the engine's default instancing format (four vec4s), repurposed as:
 *   line1 = world position .xyz, size .w
 *   line2 = colour .rgb, alpha .w
 *   line3 = spin, softness, flicker phase, unused
 * `transformInstancingVS` is overridden to build a billboard basis from the camera axes instead of
 * decoding a model matrix, so the CPU never has to write full matrices.
 */

export const particleGLSL: Record<string, string> = {
  // All instance_* attributes stay inside this chunk: it is the only one the engine compiles with
  // the instancing semantics bound. The per-particle colour is handed to main() via a global.
  transformInstancingVS: /* glsl */`
attribute vec4 instance_line1;
attribute vec4 instance_line2;
attribute vec4 instance_line3;
attribute vec4 instance_line4;
uniform vec3 uPartRight;
uniform vec3 uPartUp;
mat4 getModelMatrix() {
    gPartColor = instance_line2;
    float s = instance_line1.w;
    float a = instance_line3.x;
    float ca = cos(a), sa = sin(a);
    vec3 r = (uPartRight * ca + uPartUp * sa) * s;
    vec3 u = (uPartUp * ca - uPartRight * sa) * s;
    vec3 n = normalize(cross(r, u));
    return mat4(vec4(r, 0.0), vec4(u, 0.0), vec4(n, 0.0), vec4(instance_line1.xyz, 1.0));
}
`,
  litUserDeclarationVS: /* glsl */`
varying vec4 vPartColor;
vec4 gPartColor = vec4(1.0);
`,
  litUserMainEndVS: /* glsl */`
vPartColor = gPartColor;
`,
  litUserDeclarationPS: /* glsl */`
varying vec4 vPartColor;
uniform vec4 uPartParams;   // softness, coreBoost, unused, unused
`,
  emissivePS: /* glsl */`
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
void getEmission() {
    dEmission = vPartColor.rgb * material_emissiveIntensity;
}
`,
  diffusePS: /* glsl */`
void getAlbedo() { dAlbedo = vec3(0.0); }
`,
  // The sprite shape comes from a generated radial texture sampled through the engine's own
  // opacity-map placeholders, so the UV expression is always the one the shader actually declares.
  opacityPS: /* glsl */`
uniform float material_opacity;
uniform float material_alphaDitherScale;
void getOpacity() {
    // The falloff is computed from the quad's own UV rather than sampled: a 64px sprite covering
    // ~10 screen pixels lands on a high mip and comes back flat, which turned every dust mote into
    // an opaque square. An analytic 1-r^2 is smooth at any size and cheaper besides. The opacity
    // map stays bound only so the engine still emits vUv0 for us.
    vec2 q = {STD_OPACITY_TEXTURE_UV} * 2.0 - 1.0;
    float shape = max(0.0, 1.0 - dot(q, q));
    dAlpha = pow(shape, uPartParams.x) * vPartColor.a * material_opacity;
}
`,
};

export const particleWGSL: Record<string, string> = {
  transformInstancingVS: /* wgsl */`
attribute instance_line1: vec4f;
attribute instance_line2: vec4f;
attribute instance_line3: vec4f;
attribute instance_line4: vec4f;
uniform uPartRight: vec3f;
uniform uPartUp: vec3f;
fn getModelMatrix() -> mat4x4f {
    gPartColor = instance_line2;
    let s = instance_line1.w;
    let a = instance_line3.x;
    let ca = cos(a); let sa = sin(a);
    let r = (uniform.uPartRight * ca + uniform.uPartUp * sa) * s;
    let u = (uniform.uPartUp * ca - uniform.uPartRight * sa) * s;
    let n = normalize(cross(r, u));
    return mat4x4f(vec4f(r, 0.0), vec4f(u, 0.0), vec4f(n, 0.0), vec4f(instance_line1.xyz, 1.0));
}
`,
  litUserDeclarationVS: /* wgsl */`
varying vPartColor: vec4f;
var<private> gPartColor: vec4f = vec4f(1.0);
`,
  litUserMainEndVS: /* wgsl */`
output.vPartColor = gPartColor;
`,
  litUserDeclarationPS: /* wgsl */`
uniform uPartParams: vec4f;
`,
  emissivePS: /* wgsl */`
uniform material_emissive: vec3f;
uniform material_emissiveIntensity: f32;
fn getEmission() {
    dEmission = vPartColor.rgb * uniform.material_emissiveIntensity;
}
`,
  diffusePS: /* wgsl */`
fn getAlbedo() { dAlbedo = vec3f(0.0); }
`,
  opacityPS: /* wgsl */`
uniform material_opacity: f32;
uniform material_alphaDitherScale: f32;
fn getOpacity() {
    // see the GLSL note: analytic falloff, because the sprite's mips flatten at particle scale
    let q = {STD_OPACITY_TEXTURE_UV} * 2.0 - 1.0;
    let shape = max(0.0, 1.0 - dot(q, q));
    dAlpha = pow(shape, uniform.uPartParams.x) * vPartColor.a * uniform.material_opacity;
}
`,
};

/** Soft additive card material used for mist banks and light shafts (no lighting, pure emissive). */
export const shaftGLSL: Record<string, string> = {
  litUserDeclarationPS: /* glsl */`
uniform vec4 uShaft;     // time, intensity, noiseScale, edgeSoftness
uniform vec4 uShaftFade; // nearStart, nearEnd, farStart, farEnd
uniform vec3 uShaftColor;
uniform vec3 uFogCamPos; // shared with the atmosphere fog, written once per frame
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1, 0)), f.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), f.x), f.y);
}
`,
  emissivePS: /* glsl */`
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
void getEmission() { dEmission = uShaftColor * uShaft.y; }
`,
  diffusePS: /* glsl */`
void getAlbedo() { dAlbedo = vec3(0.0); }
`,
  opacityPS: /* glsl */`
uniform float material_opacity;
uniform float material_alphaDitherScale;
void getOpacity() {
    float edge = texture2DBias({STD_OPACITY_TEXTURE_NAME}, {STD_OPACITY_TEXTURE_UV}, textureBias).{STD_OPACITY_TEXTURE_CHANNEL};
    vec2 np = vPositionW.xz * uShaft.z + vec2(uShaft.x * 0.03, uShaft.x * 0.021);
    float n = sNoise(np) * 0.6 + sNoise(np * 2.7 + 3.1) * 0.4;
    // fade out where the card passes through (or very near) the camera, and again in the far distance
    float d = distance(vPositionW, uFogCamPos);
    float near = smoothstep(uShaftFade.x, uShaftFade.y, d);
    float far = 1.0 - smoothstep(uShaftFade.z, uShaftFade.w, d);
    dAlpha = material_opacity * edge * (0.35 + n * 0.85) * near * far;
}
`,
};

export const shaftWGSL: Record<string, string> = {
  litUserDeclarationPS: /* wgsl */`
uniform uShaft: vec4f;
uniform uShaftFade: vec4f;
uniform uShaftColor: vec3f;
uniform uFogCamPos: vec3f;
fn sHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn sNoise(p: vec2f) -> f32 {
    let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2f(1.0, 0.0)), f.x), mix(sHash(i + vec2f(0.0, 1.0)), sHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
`,
  emissivePS: /* wgsl */`
uniform material_emissive: vec3f;
uniform material_emissiveIntensity: f32;
fn getEmission() { dEmission = uniform.uShaftColor * uniform.uShaft.y; }
`,
  diffusePS: /* wgsl */`
fn getAlbedo() { dAlbedo = vec3f(0.0); }
`,
  opacityPS: /* wgsl */`
uniform material_opacity: f32;
uniform material_alphaDitherScale: f32;
fn getOpacity() {
    let edge = textureSampleBias({STD_OPACITY_TEXTURE_NAME}, {STD_OPACITY_TEXTURE_NAME}Sampler, {STD_OPACITY_TEXTURE_UV}, uniform.textureBias).{STD_OPACITY_TEXTURE_CHANNEL};
    let np = vPositionW.xz * uniform.uShaft.z + vec2f(uniform.uShaft.x * 0.03, uniform.uShaft.x * 0.021);
    let n = sNoise(np) * 0.6 + sNoise(np * 2.7 + 3.1) * 0.4;
    let d = distance(vPositionW, uniform.uFogCamPos);
    let near = smoothstep(uniform.uShaftFade.x, uniform.uShaftFade.y, d);
    let far = 1.0 - smoothstep(uniform.uShaftFade.z, uniform.uShaftFade.w, d);
    dAlpha = uniform.material_opacity * edge * (0.35 + n * 0.85) * near * far;
}
`,
};
