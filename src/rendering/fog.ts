import { GraphicsDevice, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL, ShaderChunks, Vec3, Color } from 'playcanvas';

/**
 * Global height + distance fog with sun in-scattering and animated 3D noise.
 * Replaces the engine's `fogPS` chunk for every material (GLSL and WGSL),
 * so lit geometry, foliage and particles all share one atmosphere model.
 */

// ---------------------------------------------------------------- GLSL
const fogGLSL = /* glsl */`
float dBlendModeFogFactor = 1.0;
uniform vec3 uFogCamPos;
uniform vec4 uFogParams;   // density, heightFalloff, baseHeight, startDist
uniform vec4 uFogParams2;  // noiseScale, noiseStrength, maxFog, time
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uFogSunDir;

float efHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float efNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(efHash(i + vec3(0,0,0)), efHash(i + vec3(1,0,0)), f.x),
                   mix(efHash(i + vec3(0,1,0)), efHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(efHash(i + vec3(0,0,1)), efHash(i + vec3(1,0,1)), f.x),
                   mix(efHash(i + vec3(0,1,1)), efHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

#ifdef VERTEXSHADER
float getFogFactor(float depth) {
    float d = max(depth - uFogParams.w, 0.0);
    return clamp(exp(-d * uFogParams.x * 1.5), 0.0, 1.0);
}
vec3 addFog(vec3 color, float depth) {
    return mix(uFogColor * dBlendModeFogFactor, color, getFogFactor(depth));
}
#else
float efFogAmount(vec3 P) {
    vec3 C = uFogCamPos;
    vec3 V = P - C;
    float dist = length(V);
    vec3 dir = V / max(dist, 0.001);
    float d = max(dist - uFogParams.w, 0.0);
    float falloff = uFogParams.y;
    float base = uFogParams.z;
    // analytic integral of exp(-falloff * (y - base)) along the ray
    float camDensity = exp(-(C.y - base) * falloff);
    float dy = dir.y * falloff;
    float integral = abs(dy) > 0.0005 ? camDensity * (1.0 - exp(-d * dy)) / dy : camDensity * d;
    float amount = uFogParams.x * integral;
    // drifting noise modulation (cheap two-octave value noise)
    vec3 np = P * uFogParams2.x + vec3(uFogParams2.w * 0.05, uFogParams2.w * 0.02, uFogParams2.w * 0.035);
    float n = efNoise(np) * 0.65 + efNoise(np * 2.7 + 5.0) * 0.35;
    amount *= 1.0 + (n - 0.5) * 2.0 * uFogParams2.y;
    return amount;
}
float getFogFactor() {
    return 1.0 - min(1.0 - exp(-max(efFogAmount(vPositionW), 0.0)), uFogParams2.z);
}
vec3 addFog(vec3 color) {
    vec3 V = vPositionW - uFogCamPos;
    vec3 dir = V / max(length(V), 0.001);
    float sunAmount = pow(max(dot(dir, uFogSunDir), 0.0), 6.0);
    vec3 fogCol = mix(uFogColor, uFogSunColor, sunAmount) * dBlendModeFogFactor;
    return mix(fogCol, color, getFogFactor());
}
#endif
`;

// ---------------------------------------------------------------- WGSL
const fogWGSL = /* wgsl */`
#include "fogMathPS"
var<private> dBlendModeFogFactor : f32 = 1.0;
uniform uFogCamPos: vec3f;
uniform uFogParams: vec4f;
uniform uFogParams2: vec4f;
uniform uFogColor: vec3f;
uniform uFogSunColor: vec3f;
uniform uFogSunDir: vec3f;

fn efHash(pIn: vec3f) -> f32 { var p = fract(pIn * 0.3183099 + 0.1); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn efNoise(x: vec3f) -> f32 {
    let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(efHash(i + vec3f(0.0,0.0,0.0)), efHash(i + vec3f(1.0,0.0,0.0)), f.x),
                   mix(efHash(i + vec3f(0.0,1.0,0.0)), efHash(i + vec3f(1.0,1.0,0.0)), f.x), f.y),
               mix(mix(efHash(i + vec3f(0.0,0.0,1.0)), efHash(i + vec3f(1.0,0.0,1.0)), f.x),
                   mix(efHash(i + vec3f(0.0,1.0,1.0)), efHash(i + vec3f(1.0,1.0,1.0)), f.x), f.y), f.z);
}

#ifdef VERTEXSHADER
fn getFogFactor(depth: f32) -> f32 {
    let d = max(depth - uniform.uFogParams.w, 0.0);
    return clamp(exp(-d * uniform.uFogParams.x * 1.5), 0.0, 1.0);
}
fn addFog(color: vec3f, depth: f32) -> vec3f {
    return mix(uniform.uFogColor * dBlendModeFogFactor, color, getFogFactor(depth));
}
#else
fn efFogAmount(P: vec3f) -> f32 {
    let C = uniform.uFogCamPos;
    let V = P - C;
    let dist = length(V);
    let dir = V / max(dist, 0.001);
    let d = max(dist - uniform.uFogParams.w, 0.0);
    let falloff = uniform.uFogParams.y;
    let base = uniform.uFogParams.z;
    let camDensity = exp(-(C.y - base) * falloff);
    let dy = dir.y * falloff;
    var integral: f32;
    if (abs(dy) > 0.0005) { integral = camDensity * (1.0 - exp(-d * dy)) / dy; } else { integral = camDensity * d; }
    var amount = uniform.uFogParams.x * integral;
    let np = P * uniform.uFogParams2.x + vec3f(uniform.uFogParams2.w * 0.05, uniform.uFogParams2.w * 0.02, uniform.uFogParams2.w * 0.035);
    let n = efNoise(np) * 0.65 + efNoise(np * 2.7 + 5.0) * 0.35;
    amount = amount * (1.0 + (n - 0.5) * 2.0 * uniform.uFogParams2.y);
    return amount;
}
fn getFogFactor() -> f32 {
    return 1.0 - min(1.0 - exp(-max(efFogAmount(vPositionW), 0.0)), uniform.uFogParams2.z);
}
fn addFog(color: vec3f) -> vec3f {
    let V = vPositionW - uniform.uFogCamPos;
    let dir = V / max(length(V), 0.001);
    let sunAmount = pow(max(dot(dir, uniform.uFogSunDir), 0.0), 6.0);
    let fogCol = mix(uniform.uFogColor, uniform.uFogSunColor, sunAmount) * dBlendModeFogFactor;
    return mix(fogCol, color, getFogFactor());
}
#endif
`;

export interface FogState {
  density: number; heightFalloff: number; baseHeight: number; startDist: number;
  noiseScale: number; noiseStrength: number; maxFog: number;
  color: Color; sunColor: Color;
}

export class AtmosphereFog {
  state: FogState = {
    density: 0.012, heightFalloff: 0.09, baseHeight: 0.0, startDist: 2.0,
    noiseScale: 0.06, noiseStrength: 0.35, maxFog: 0.96,
    color: new Color(0.40, 0.46, 0.56), sunColor: new Color(1.0, 0.62, 0.42),
  };
  private time = 0;
  private camPos = [0, 0, 0];
  private params = new Float32Array(4);
  private params2 = new Float32Array(4);
  private col = new Float32Array(3);
  private sunCol = new Float32Array(3);
  private sunDir = new Float32Array(3);

  constructor(private device: GraphicsDevice) {
    ShaderChunks.get(device, SHADERLANGUAGE_GLSL).set('fogPS', fogGLSL);
    ShaderChunks.get(device, SHADERLANGUAGE_WGSL).set('fogPS', fogWGSL);
  }

  setSunDirection(dirToSun: Vec3): void {
    this.sunDir[0] = dirToSun.x; this.sunDir[1] = dirToSun.y; this.sunDir[2] = dirToSun.z;
  }

  update(dt: number, cam: Vec3): void {
    this.time += dt;
    const s = this.state, scope = this.device.scope;
    this.camPos[0] = cam.x; this.camPos[1] = cam.y; this.camPos[2] = cam.z;
    this.params[0] = s.density; this.params[1] = s.heightFalloff; this.params[2] = s.baseHeight; this.params[3] = s.startDist;
    this.params2[0] = s.noiseScale; this.params2[1] = s.noiseStrength; this.params2[2] = s.maxFog; this.params2[3] = this.time;
    this.col[0] = s.color.r; this.col[1] = s.color.g; this.col[2] = s.color.b;
    this.sunCol[0] = s.sunColor.r; this.sunCol[1] = s.sunColor.g; this.sunCol[2] = s.sunColor.b;
    scope.resolve('uFogCamPos').setValue(this.camPos);
    scope.resolve('uFogParams').setValue(this.params);
    scope.resolve('uFogParams2').setValue(this.params2);
    scope.resolve('uFogColor').setValue(this.col);
    scope.resolve('uFogSunColor').setValue(this.sunCol);
    scope.resolve('uFogSunDir').setValue(this.sunDir);
  }
}
