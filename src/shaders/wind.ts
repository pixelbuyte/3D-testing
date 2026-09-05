/**
 * Vertex wind for foliage as StandardMaterial chunk overrides. Bends geometry with height (local y),
 * with a per-position phase so instances don't move in lockstep, plus high-frequency leaf flutter.
 * Works for instanced and non-instanced draws, and is shared by the shadow/depth passes (consistent shadows).
 */
export const windGLSL: Record<string, string> = {
  litUserDeclarationVS: /* glsl */`
uniform vec4 uWind;       // strength, time, gust, flutter
uniform vec2 uWindDir;    // xz direction
`,
  litUserMainEndVS: /* glsl */`
{
    vec3 wp = dPositionW;
    float hgt = max(vertex_position.y, 0.0);
    float phase = dot(wp.xz, vec2(0.23, 0.17)) + uWind.y * 1.35;
    float sway = sin(phase) * 0.55 + sin(phase * 2.31 + 1.7) * 0.3 + sin(phase * 0.37) * 0.35 * uWind.z;
    float bend = hgt * hgt * uWind.x * 0.12;
    vec3 off = vec3(uWindDir.x, -0.15, uWindDir.y) * sway * bend;
    float fl = sin(uWind.y * 7.0 + wp.x * 2.7 + wp.z * 1.9 + hgt * 3.0) * uWind.w * 0.025 * min(hgt, 1.5);
    off += vec3(fl, fl * 0.4, -fl);
    wp += off;
    dPositionW = wp;
    #ifndef UV1LAYOUT
    gl_Position = matrix_viewProjection * vec4(wp, 1.0);
    #endif
    #ifdef LIT_NEEDS_NORMAL
    vPositionW = wp;
    #endif
}
`,
};

export const windWGSL: Record<string, string> = {
  litUserDeclarationVS: /* wgsl */`
uniform uWind: vec4f;
uniform uWindDir: vec2f;
`,
  litUserMainEndVS: /* wgsl */`
{
    var wp: vec3f = dPositionW;
    let hgt = max(vertex_position.y, 0.0);
    let phase = dot(wp.xz, vec2f(0.23, 0.17)) + uniform.uWind.y * 1.35;
    let sway = sin(phase) * 0.55 + sin(phase * 2.31 + 1.7) * 0.3 + sin(phase * 0.37) * 0.35 * uniform.uWind.z;
    let bend = hgt * hgt * uniform.uWind.x * 0.12;
    var off = vec3f(uniform.uWindDir.x, -0.15, uniform.uWindDir.y) * sway * bend;
    let fl = sin(uniform.uWind.y * 7.0 + wp.x * 2.7 + wp.z * 1.9 + hgt * 3.0) * uniform.uWind.w * 0.025 * min(hgt, 1.5);
    off = off + vec3f(fl, fl * 0.4, -fl);
    wp = wp + off;
    dPositionW = wp;
    output.position = uniform.matrix_viewProjection * vec4f(wp, 1.0);
    #ifdef LIT_NEEDS_NORMAL
    output.vPositionW = wp;
    #endif
}
`,
};

/** Global wind state written to the device scope each frame (all wind materials share it). */
export class WindState {
  strength = 1.0; gust = 1.0; flutter = 1.0; dirX = 0.72; dirZ = 0.69;
  private time = 0;
  private buf = new Float32Array(4);
  private dir = new Float32Array(2);
  constructor(private scope: { resolve(name: string): { setValue(v: unknown): void } }) {}
  update(dt: number): void {
    this.time += dt;
    // slow gust envelope
    const g = 0.6 + 0.4 * Math.sin(this.time * 0.21) * Math.sin(this.time * 0.077 + 1.3) + 0.15 * Math.sin(this.time * 0.9);
    this.buf[0] = this.strength * (0.8 + g * 0.5); this.buf[1] = this.time; this.buf[2] = this.gust; this.buf[3] = this.flutter;
    this.dir[0] = this.dirX; this.dir[1] = this.dirZ;
    this.scope.resolve('uWind').setValue(this.buf);
    this.scope.resolve('uWindDir').setValue(this.dir);
  }
}
