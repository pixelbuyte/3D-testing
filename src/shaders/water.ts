/**
 * Standing-water shader as StandardMaterial chunk overrides (GLSL + WGSL).
 *
 * Technique
 *  - Two scrolling layers of gradient noise are differentiated analytically to build a normal;
 *    no normal texture is needed and the detail never tiles visibly.
 *  - Expanding ripple rings model drips still falling from the canopy after the rain.
 *  - Vertex colour .r carries normalised depth (0 at the shoreline, 1 at the centre). Depth drives
 *    albedo (bed tint -> deep green-blue), gloss, and the opacity fade that removes the hard rim.
 *  - The material is a metalness workflow at very high gloss, so the environment map supplies the
 *    Fresnel-weighted reflection for free; we only shape roughness and colour.
 */

const COMMON_GLSL = /* glsl */`
uniform vec4 uWaterA;   // time, rippleStrength, detailStrength, drips
uniform vec4 uWaterB;   // shallowFade, depthScale, foamWidth, distortion
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform vec3 uWaterSky;

float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
}
// height of the combined wave field at p
float wHeight(vec2 p, float t) {
    float h = 0.0;
    h += wNoise(p * 1.7 + vec2(t * 0.055, t * 0.031)) * 0.55;
    h += wNoise(p * 4.1 - vec2(t * 0.084, t * 0.043)) * 0.30;
    h += wNoise(p * 9.3 + vec2(-t * 0.13, t * 0.10)) * 0.15;
    return h;
}
// expanding rings from drips landing on the surface
vec2 wRipples(vec2 p, float t, float strength) {
    vec2 g = vec2(0.0);
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        vec2 q = p * (0.9 + fk * 0.55) + fk * 21.3;
        vec2 cell = floor(q), f = fract(q) - 0.5;
        float seed = wHash(cell + fk * 7.0);
        if (seed < 0.55) continue;                       // only some cells have a drip
        vec2 off = (vec2(wHash(cell + 3.1), wHash(cell + 9.7)) - 0.5) * 0.6;
        float phase = fract(t * 0.30 + seed * 4.13);
        vec2 d = f - off;
        float r = length(d) + 1e-4;
        float front = phase * 0.62;
        float wave = sin((r - front) * 46.0) * exp(-r * 5.0) * exp(-phase * 3.0) * smoothstep(front, front - 0.10, r);
        g += (d / r) * wave;
    }
    return g * strength;
}
`;

const COMMON_WGSL = /* wgsl */`
uniform uWaterA: vec4f;
uniform uWaterB: vec4f;
uniform uWaterShallow: vec3f;
uniform uWaterDeep: vec3f;
uniform uWaterSky: vec3f;

fn wHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn wNoise(p: vec2f) -> f32 {
    let i = floor(p); let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2f(1.0, 0.0)), u.x), mix(wHash(i + vec2f(0.0, 1.0)), wHash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn wHeight(p: vec2f, t: f32) -> f32 {
    var h = 0.0;
    h = h + wNoise(p * 1.7 + vec2f(t * 0.055, t * 0.031)) * 0.55;
    h = h + wNoise(p * 4.1 - vec2f(t * 0.084, t * 0.043)) * 0.30;
    h = h + wNoise(p * 9.3 + vec2f(-t * 0.13, t * 0.10)) * 0.15;
    return h;
}
fn wRipples(p: vec2f, t: f32, strength: f32) -> vec2f {
    var g = vec2f(0.0);
    for (var k: i32 = 0; k < 3; k = k + 1) {
        let fk = f32(k);
        let q = p * (0.9 + fk * 0.55) + fk * 21.3;
        let cell = floor(q); let f = fract(q) - 0.5;
        let seed = wHash(cell + fk * 7.0);
        if (seed >= 0.55) {
            let off = (vec2f(wHash(cell + 3.1), wHash(cell + 9.7)) - 0.5) * 0.6;
            let phase = fract(t * 0.30 + seed * 4.13);
            let d = f - off;
            let r = length(d) + 1e-4;
            let front = phase * 0.62;
            let wave = sin((r - front) * 46.0) * exp(-r * 5.0) * exp(-phase * 3.0) * smoothstep(front, front - 0.10, r);
            g = g + (d / r) * wave;
        }
    }
    return g * strength;
}
`;

export const waterGLSL: Record<string, string> = {
  litUserDeclarationPS: /* glsl */`
#ifdef FORWARD_PASS
${COMMON_GLSL}
#endif
`,
  normalMapPS: /* glsl */`
void getNormal() {
    vec2 p = vPositionW.xz;
    float t = uWaterA.x;
    // central differences on the analytic wave field -> tangent-space normal
    const float e = 0.035;
    float hx = wHeight(p + vec2(e, 0.0), t) - wHeight(p - vec2(e, 0.0), t);
    float hz = wHeight(p + vec2(0.0, e), t) - wHeight(p - vec2(0.0, e), t);
    vec2 grad = vec2(hx, hz) * (uWaterA.z / e) * 0.06;
    grad += wRipples(p, t, uWaterA.y);
    // calmer at the very edge where the film of water is thin
    float depth = clamp(vVertexColor.r, 0.0, 1.0);
    grad *= mix(0.35, 1.0, depth);
    dNormalW = normalize(vec3(-grad.x, 1.0, -grad.y));
}
`,
  diffusePS: /* glsl */`
void getAlbedo() {
    float depth = clamp(vVertexColor.r, 0.0, 1.0);
    float d = pow(depth, uWaterB.y);
    dAlbedo = mix(uWaterShallow, uWaterDeep, d);
    // a thin brighter band where the water meets the stone
    float foam = 1.0 - smoothstep(0.0, uWaterB.z, depth);
    dAlbedo = mix(dAlbedo, dAlbedo * 1.5 + vec3(0.05), foam * 0.5);
}
`,
  glossPS: /* glsl */`
void getGlossiness() {
    float depth = clamp(vVertexColor.r, 0.0, 1.0);
    dGlossiness = mix(0.90, 0.995, depth) + 0.0000001;
}
`,
  metalnessPS: /* glsl */`
void getMetalness() { dMetalness = 0.0; }
`,
  emissivePS: /* glsl */`
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
void getEmission() {
    // grazing angles pick up the sky: a cheap stand-in for a full planar reflection
    float fres = pow(1.0 - clamp(dot(dViewDirW, dNormalW), 0.0, 1.0), 4.0);
    dEmission = uWaterSky * fres * 0.9 + material_emissive * material_emissiveIntensity;
}
`,
  opacityPS: /* glsl */`
uniform float material_opacity;
uniform float material_alphaDitherScale;
void getOpacity() {
    float depth = clamp(vVertexColor.r, 0.0, 1.0);
    // wobble the shoreline so the fade line is never geometric
    float w = wNoise(vPositionW.xz * 3.3 + uWaterA.x * 0.05) - 0.5;
    float edge = smoothstep(0.0, uWaterB.x, depth + w * uWaterB.w);
    dAlpha = material_opacity * edge;
}
`,
};

export const waterWGSL: Record<string, string> = {
  litUserDeclarationPS: /* wgsl */`
#ifdef FORWARD_PASS
${COMMON_WGSL}
#endif
`,
  normalMapPS: /* wgsl */`
fn getNormal() {
    let p = vPositionW.xz;
    let t = uniform.uWaterA.x;
    let e = 0.035;
    let hx = wHeight(p + vec2f(e, 0.0), t) - wHeight(p - vec2f(e, 0.0), t);
    let hz = wHeight(p + vec2f(0.0, e), t) - wHeight(p - vec2f(0.0, e), t);
    var grad = vec2f(hx, hz) * (uniform.uWaterA.z / e) * 0.06;
    grad = grad + wRipples(p, t, uniform.uWaterA.y);
    let depth = clamp(vVertexColor.r, 0.0, 1.0);
    grad = grad * mix(0.35, 1.0, depth);
    dNormalW = normalize(vec3f(-grad.x, 1.0, -grad.y));
}
`,
  diffusePS: /* wgsl */`
fn getAlbedo() {
    let depth = clamp(vVertexColor.r, 0.0, 1.0);
    let d = pow(depth, uniform.uWaterB.y);
    var c = mix(uniform.uWaterShallow, uniform.uWaterDeep, d);
    let foam = 1.0 - smoothstep(0.0, uniform.uWaterB.z, depth);
    dAlbedo = mix(c, c * 1.5 + vec3f(0.05), foam * 0.5);
}
`,
  glossPS: /* wgsl */`
fn getGlossiness() {
    let depth = clamp(vVertexColor.r, 0.0, 1.0);
    dGlossiness = mix(0.90, 0.995, depth) + 0.0000001;
}
`,
  metalnessPS: /* wgsl */`
fn getMetalness() { dMetalness = 0.0; }
`,
  emissivePS: /* wgsl */`
uniform material_emissive: vec3f;
uniform material_emissiveIntensity: f32;
fn getEmission() {
    let fres = pow(1.0 - clamp(dot(dViewDirW, dNormalW), 0.0, 1.0), 4.0);
    dEmission = uniform.uWaterSky * fres * 0.9 + uniform.material_emissive * uniform.material_emissiveIntensity;
}
`,
  opacityPS: /* wgsl */`
uniform material_opacity: f32;
uniform material_alphaDitherScale: f32;
fn getOpacity() {
    let depth = clamp(vVertexColor.r, 0.0, 1.0);
    let w = wNoise(vPositionW.xz * 3.3 + uniform.uWaterA.x * 0.05) - 0.5;
    let edge = smoothstep(0.0, uniform.uWaterB.x, depth + w * uniform.uWaterB.w);
    dAlpha = uniform.material_opacity * edge;
}
`,
};
