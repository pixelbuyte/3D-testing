/**
 * Terrain splat shader as StandardMaterial chunk overrides (GLSL + WGSL).
 * Layers: A forest floor, B mossy rock, C cobblestone (paths/courtyards), D cliff rock (triplanar).
 * Vertex color: r = paved mask, g = moss mask, b = puddle mask.
 * Post-rain wetness darkens albedo, raises gloss; puddles get flat mirror normals with rain-drop ripples.
 */

export const terrainGLSL: Record<string, string> = {
  litUserDeclarationPS: /* glsl */`
#ifdef FORWARD_PASS
uniform sampler2D uTerA_diff; uniform sampler2D uTerA_nor; uniform sampler2D uTerA_arm;
uniform sampler2D uTerB_diff; uniform sampler2D uTerB_nor; uniform sampler2D uTerB_arm;
uniform sampler2D uTerC_diff; uniform sampler2D uTerC_nor; uniform sampler2D uTerC_arm;
uniform sampler2D uTerD_diff; uniform sampler2D uTerD_nor; uniform sampler2D uTerD_arm;
uniform vec4 uTerTiling;
uniform vec4 uTerWet;  // wetness, puddleLevel, rippleStrength, time
uniform vec4 uTerTint; // rgb tint, a = saturation
vec3 terAlbedo; vec3 terNormalW; float terGloss; float terAo; bool terDone = false;

float terHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float terNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(terHash(i), terHash(i + vec2(1, 0)), f.x), mix(terHash(i + vec2(0, 1)), terHash(i + vec2(1, 1)), f.x), f.y);
}
vec2 terRipple(vec2 p, float t) {
    vec2 grad = vec2(0.0);
    for (int k = 0; k < 2; k++) {
        vec2 q = p * (1.0 + float(k) * 0.7) + float(k) * 13.7;
        vec2 cell = floor(q); vec2 f = fract(q) - 0.5;
        float h = terHash(cell + float(k));
        vec2 off = (vec2(terHash(cell + 1.3), terHash(cell + 7.1)) - 0.5) * 0.7;
        float phase = fract(t * 0.42 + h);
        vec2 d = f - off; float r = length(d) + 1e-4;
        float front = phase * 0.55;
        float wave = sin((r - front) * 42.0) * exp(-r * 4.0) * exp(-phase * 2.5) * smoothstep(front, front - 0.12, r);
        grad += (d / r) * wave;
    }
    return grad;
}
vec3 terSampleTri(sampler2D tex, vec3 p, vec3 n, float tiling) {
    vec3 w = abs(n); w = pow(w, vec3(4.0)); w /= (w.x + w.y + w.z);
    vec3 cx = texture2D(tex, p.zy * tiling).rgb;
    vec3 cy = texture2D(tex, p.xz * tiling).rgb;
    vec3 cz = texture2D(tex, p.xy * tiling).rgb;
    return cx * w.x + cy * w.y + cz * w.z;
}
void terEvaluate() {
    if (terDone) return;
    terDone = true;
    vec3 N = normalize(vNormalW);
    vec3 P = vPositionW;
    vec2 wp = P.xz;
    float slope = 1.0 - clamp(N.y, 0.0, 1.0);
    float macro = terNoise(wp * 0.045) * 0.6 + terNoise(wp * 0.13 + 3.1) * 0.4;
    vec4 vc = vVertexColor;

    // ---- layer weights
    float wD = smoothstep(0.30, 0.62, slope + (macro - 0.5) * 0.15);
    float wC = vc.r * (1.0 - wD);
    float wB = clamp(vc.g * 1.3 + smoothstep(0.10, 0.34, slope) * 0.9 + (macro - 0.5) * 0.9, 0.0, 1.0) * (1.0 - wD) * (1.0 - wC);
    float wA = max(1.0 - wB - wC - wD, 0.0);
    // sharpen transitions using texture heights (arm.r as proxy) for a more natural break-up
    vec2 uvA = wp * uTerTiling.x, uvB = wp * uTerTiling.y, uvC = wp * uTerTiling.z;
    vec3 armA = texture2D(uTerA_arm, uvA).rgb, armB = texture2D(uTerB_arm, uvB).rgb, armC = texture2D(uTerC_arm, uvC).rgb;
    vec3 armD = terSampleTri(uTerD_arm, P, N, uTerTiling.w);
    vec4 w = vec4(wA + armA.r * 0.25, wB + armB.r * 0.35, wC + armC.r * 0.3, wD + armD.r * 0.2) * vec4(wA, wB, wC, wD);
    w = pow(w, vec4(2.5)); w /= max(w.x + w.y + w.z + w.w, 1e-4);

    // ---- albedo (A gets a macro-variation second sample to hide tiling)
    vec3 colA = mix(texture2D(uTerA_diff, uvA).rgb, texture2D(uTerA_diff, uvA * 0.21 + 0.3).rgb, 0.4);
    vec3 colB = texture2D(uTerB_diff, uvB).rgb;
    vec3 colC = texture2D(uTerC_diff, uvC).rgb;
    vec3 colD = terSampleTri(uTerD_diff, P, N, uTerTiling.w);
    vec3 albedo = colA * w.x + colB * w.y + colC * w.z + colD * w.w;
    albedo *= 0.85 + macro * 0.3;

    // ---- normal (planar frame around the vertex normal)
    vec3 nA = texture2D(uTerA_nor, uvA).xyz * 2.0 - 1.0;
    vec3 nB = texture2D(uTerB_nor, uvB).xyz * 2.0 - 1.0;
    vec3 nC = texture2D(uTerC_nor, uvC).xyz * 2.0 - 1.0;
    vec3 nD = terSampleTri(uTerD_nor, P, N, uTerTiling.w) * 2.0 - 1.0;
    vec3 nTS = normalize(nA * w.x + nB * w.y * 1.15 + nC * w.z * 0.9 + nD * w.w * 1.3);

    // ---- arm
    vec3 arm = armA * w.x + armB * w.y + armC * w.z + armD * w.w;
    float gloss = 1.0 - arm.g;
    float ao = arm.r;

    // ---- post-rain wetness & puddles
    float wet = uTerWet.x;
    float low = 1.0 - smoothstep(0.02, 0.10, slope);
    float puddle = smoothstep(0.42, 0.72, vc.b + (macro - 0.5) * 0.28 + (uTerWet.y - 0.5) * 0.4) * low * (1.0 - wD);
    float damp = wet * (1.0 - puddle);
    albedo *= mix(1.0, 0.58, damp);
    albedo *= mix(1.0, 0.38, puddle);
    gloss = mix(gloss, max(gloss, 0.66), damp);
    gloss = mix(gloss, 0.985, puddle);
    vec2 rip = terRipple(wp * 1.4, uTerWet.w) * uTerWet.z;
    vec3 puddleN = normalize(vec3(rip.x, rip.y, 1.0));
    nTS = normalize(mix(nTS, puddleN, puddle));
    ao = mix(ao, 1.0, puddle);

    vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
    vec3 B = cross(T, N);
    terNormalW = normalize(T * nTS.x + B * nTS.y + N * nTS.z);
    albedo *= uTerTint.rgb;
    albedo = mix(vec3(dot(albedo, vec3(0.299, 0.587, 0.114))), albedo, uTerTint.a);
    terAlbedo = albedo;
    terGloss = gloss;
    terAo = ao;
}
#endif
`,
  diffusePS: /* glsl */`
void getAlbedo() { terEvaluate(); dAlbedo = terAlbedo; }
`,
  normalMapPS: /* glsl */`
void getNormal() { terEvaluate(); dNormalW = terNormalW; }
`,
  glossPS: /* glsl */`
void getGlossiness() { terEvaluate(); dGlossiness = terGloss + 0.0000001; }
`,
  aoPS: /* glsl */`
void getAO() { terEvaluate(); dAo = terAo; }
`,
};

export const terrainWGSL: Record<string, string> = {
  litUserDeclarationPS: /* wgsl */`
#ifdef FORWARD_PASS
var uTerA_diff: texture_2d<f32>; var uTerA_diffSampler: sampler; var uTerA_nor: texture_2d<f32>; var uTerA_norSampler: sampler; var uTerA_arm: texture_2d<f32>; var uTerA_armSampler: sampler;
var uTerB_diff: texture_2d<f32>; var uTerB_diffSampler: sampler; var uTerB_nor: texture_2d<f32>; var uTerB_norSampler: sampler; var uTerB_arm: texture_2d<f32>; var uTerB_armSampler: sampler;
var uTerC_diff: texture_2d<f32>; var uTerC_diffSampler: sampler; var uTerC_nor: texture_2d<f32>; var uTerC_norSampler: sampler; var uTerC_arm: texture_2d<f32>; var uTerC_armSampler: sampler;
var uTerD_diff: texture_2d<f32>; var uTerD_diffSampler: sampler; var uTerD_nor: texture_2d<f32>; var uTerD_norSampler: sampler; var uTerD_arm: texture_2d<f32>; var uTerD_armSampler: sampler;
uniform uTerTiling: vec4f;
uniform uTerWet: vec4f;
uniform uTerTint: vec4f;
var<private> terAlbedo: vec3f; var<private> terNormalW: vec3f; var<private> terGloss: f32; var<private> terAo: f32; var<private> terDone: bool = false;

fn terHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn terNoise(p: vec2f) -> f32 {
    let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(terHash(i), terHash(i + vec2f(1.0, 0.0)), f.x), mix(terHash(i + vec2f(0.0, 1.0)), terHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn terRipple(p: vec2f, t: f32) -> vec2f {
    var grad = vec2f(0.0);
    for (var k: i32 = 0; k < 2; k = k + 1) {
        let fk = f32(k);
        let q = p * (1.0 + fk * 0.7) + fk * 13.7;
        let cell = floor(q); let f = fract(q) - 0.5;
        let h = terHash(cell + fk);
        let off = (vec2f(terHash(cell + 1.3), terHash(cell + 7.1)) - 0.5) * 0.7;
        let phase = fract(t * 0.42 + h);
        let d = f - off; let r = length(d) + 1e-4;
        let front = phase * 0.55;
        let wave = sin((r - front) * 42.0) * exp(-r * 4.0) * exp(-phase * 2.5) * smoothstep(front, front - 0.12, r);
        grad = grad + (d / r) * wave;
    }
    return grad;
}
fn terTriWeights(n: vec3f) -> vec3f { var w = abs(n); w = pow(w, vec3f(4.0)); return w / (w.x + w.y + w.z); }
fn terEvaluate() {
    if (terDone) { return; }
    terDone = true;
    let N = normalize(vNormalW);
    let P = vPositionW;
    let wp = P.xz;
    let slope = 1.0 - clamp(N.y, 0.0, 1.0);
    let macro = terNoise(wp * 0.045) * 0.6 + terNoise(wp * 0.13 + 3.1) * 0.4;
    let vc = vVertexColor;
    let tw = terTriWeights(N);
    let tD = uniform.uTerTiling.w;

    let wD = smoothstep(0.30, 0.62, slope + (macro - 0.5) * 0.15);
    let wC = vc.r * (1.0 - wD);
    let wB = clamp(vc.g * 1.3 + smoothstep(0.10, 0.34, slope) * 0.9 + (macro - 0.5) * 0.9, 0.0, 1.0) * (1.0 - wD) * (1.0 - wC);
    let wA = max(1.0 - wB - wC - wD, 0.0);
    let uvA = wp * uniform.uTerTiling.x; let uvB = wp * uniform.uTerTiling.y; let uvC = wp * uniform.uTerTiling.z;
    let armA = textureSample(uTerA_arm, uTerA_armSampler, uvA).rgb;
    let armB = textureSample(uTerB_arm, uTerB_armSampler, uvB).rgb;
    let armC = textureSample(uTerC_arm, uTerC_armSampler, uvC).rgb;
    let armD = textureSample(uTerD_arm, uTerD_armSampler, P.zy * tD).rgb * tw.x + textureSample(uTerD_arm, uTerD_armSampler, P.xz * tD).rgb * tw.y + textureSample(uTerD_arm, uTerD_armSampler, P.xy * tD).rgb * tw.z;
    var w = vec4f(wA + armA.r * 0.25, wB + armB.r * 0.35, wC + armC.r * 0.3, wD + armD.r * 0.2) * vec4f(wA, wB, wC, wD);
    w = pow(w, vec4f(2.5)); w = w / max(w.x + w.y + w.z + w.w, 1e-4);

    let colA = mix(textureSample(uTerA_diff, uTerA_diffSampler, uvA).rgb, textureSample(uTerA_diff, uTerA_diffSampler, uvA * 0.21 + 0.3).rgb, 0.4);
    let colB = textureSample(uTerB_diff, uTerB_diffSampler, uvB).rgb;
    let colC = textureSample(uTerC_diff, uTerC_diffSampler, uvC).rgb;
    let colD = textureSample(uTerD_diff, uTerD_diffSampler, P.zy * tD).rgb * tw.x + textureSample(uTerD_diff, uTerD_diffSampler, P.xz * tD).rgb * tw.y + textureSample(uTerD_diff, uTerD_diffSampler, P.xy * tD).rgb * tw.z;
    var albedo = colA * w.x + colB * w.y + colC * w.z + colD * w.w;
    albedo = albedo * (0.85 + macro * 0.3);

    let nA = textureSample(uTerA_nor, uTerA_norSampler, uvA).xyz * 2.0 - 1.0;
    let nB = textureSample(uTerB_nor, uTerB_norSampler, uvB).xyz * 2.0 - 1.0;
    let nC = textureSample(uTerC_nor, uTerC_norSampler, uvC).xyz * 2.0 - 1.0;
    let nDs = textureSample(uTerD_nor, uTerD_norSampler, P.zy * tD).xyz * tw.x + textureSample(uTerD_nor, uTerD_norSampler, P.xz * tD).xyz * tw.y + textureSample(uTerD_nor, uTerD_norSampler, P.xy * tD).xyz * tw.z;
    let nD = nDs * 2.0 - 1.0;
    var nTS = normalize(nA * w.x + nB * w.y * 1.15 + nC * w.z * 0.9 + nD * w.w * 1.3);

    let arm = armA * w.x + armB * w.y + armC * w.z + armD * w.w;
    var gloss = 1.0 - arm.g;
    var ao = arm.r;

    let wet = uniform.uTerWet.x;
    let low = 1.0 - smoothstep(0.02, 0.10, slope);
    let puddle = smoothstep(0.42, 0.72, vc.b + (macro - 0.5) * 0.28 + (uniform.uTerWet.y - 0.5) * 0.4) * low * (1.0 - wD);
    let dampF = wet * (1.0 - puddle);
    albedo = albedo * mix(1.0, 0.58, dampF);
    albedo = albedo * mix(1.0, 0.38, puddle);
    gloss = mix(gloss, max(gloss, 0.66), dampF);
    gloss = mix(gloss, 0.985, puddle);
    let rip = terRipple(wp * 1.4, uniform.uTerWet.w) * uniform.uTerWet.z;
    let puddleN = normalize(vec3f(rip.x, rip.y, 1.0));
    nTS = normalize(mix(nTS, puddleN, puddle));
    ao = mix(ao, 1.0, puddle);

    let T = normalize(cross(N, vec3f(0.0, 0.0, 1.0)));
    let B = cross(T, N);
    terNormalW = normalize(T * nTS.x + B * nTS.y + N * nTS.z);
    albedo = albedo * uniform.uTerTint.rgb;
    albedo = mix(vec3f(dot(albedo, vec3f(0.299, 0.587, 0.114))), albedo, uniform.uTerTint.a);
    terAlbedo = albedo;
    terGloss = gloss;
    terAo = ao;
}
#endif
`,
  diffusePS: /* wgsl */`
fn getAlbedo() { terEvaluate(); dAlbedo = terAlbedo; }
`,
  normalMapPS: /* wgsl */`
fn getNormal() { terEvaluate(); dNormalW = terNormalW; }
`,
  glossPS: /* wgsl */`
fn getGlossiness() { terEvaluate(); dGlossiness = terGloss + 0.0000001; }
`,
  aoPS: /* wgsl */`
fn getAO() { terEvaluate(); dAo = terAo; }
`,
};
