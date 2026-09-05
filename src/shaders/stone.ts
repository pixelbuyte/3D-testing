/**
 * Energy-stone crystal shader: additive faceted glow with a Fresnel rim, animated interior
 * banding and an expanding shockwave on activation. GLSL + WGSL.
 */
export const stoneGLSL: Record<string, string> = {
  litUserDeclarationPS: /* glsl */`
uniform vec4 uStone;      // time, glow, contrast, pulse
uniform vec3 uStoneColor;
`,
  diffusePS: /* glsl */`
void getAlbedo() { dAlbedo = vec3(0.0); }
`,
  emissivePS: /* glsl */`
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
void getEmission() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(uFogCamPos - vPositionW);
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.2);
    // slow vertical bands drifting through the crystal
    float band = 0.5 + 0.5 * sin(vPositionW.y * 26.0 - uStone.x * 2.4 + fres * 6.0);
    float facet = mix(1.0, band, uStone.z);
    float core = mix(0.55, 1.0, fres);
    dEmission = uStoneColor * uStone.y * facet * core;
}
`,
  opacityPS: /* glsl */`
uniform float material_opacity;
uniform float material_alphaDitherScale;
void getOpacity() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(uFogCamPos - vPositionW);
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 1.6);
    dAlpha = clamp(0.30 + fres * 0.85 + uStone.w * 0.5, 0.0, 1.0) * material_opacity;
}
`,
};

export const stoneWGSL: Record<string, string> = {
  litUserDeclarationPS: /* wgsl */`
uniform uStone: vec4f;
uniform uStoneColor: vec3f;
`,
  diffusePS: /* wgsl */`
fn getAlbedo() { dAlbedo = vec3f(0.0); }
`,
  emissivePS: /* wgsl */`
uniform material_emissive: vec3f;
uniform material_emissiveIntensity: f32;
fn getEmission() {
    let n = normalize(vNormalW);
    let v = normalize(uniform.uFogCamPos - vPositionW);
    let fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.2);
    let band = 0.5 + 0.5 * sin(vPositionW.y * 26.0 - uniform.uStone.x * 2.4 + fres * 6.0);
    let facet = mix(1.0, band, uniform.uStone.z);
    let core = mix(0.55, 1.0, fres);
    dEmission = uniform.uStoneColor * uniform.uStone.y * facet * core;
}
`,
  opacityPS: /* wgsl */`
uniform material_opacity: f32;
uniform material_alphaDitherScale: f32;
fn getOpacity() {
    let n = normalize(vNormalW);
    let v = normalize(uniform.uFogCamPos - vPositionW);
    let fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 1.6);
    dAlpha = clamp(0.30 + fres * 0.85 + uniform.uStone.w * 0.5, 0.0, 1.0) * uniform.material_opacity;
}
`,
};
