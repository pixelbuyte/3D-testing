/**
 * "Post-rain" surface treatment for StandardMaterial: darkens albedo and raises gloss on
 * upward-facing surfaces, with a global uWetness uniform. Uses the engine's texture placeholders,
 * so it composes with whatever maps the material has. GLSL + WGSL.
 */
export const wetGLSL: Record<string, string> = {
  litUserDeclarationPS: /* glsl */`
#ifdef FORWARD_PASS
uniform float uWetness;
uniform float uWetTop;   // how much more the top faces get (0..1)
float wetFactor() {
    #ifdef LIT_NEEDS_NORMAL
    vec3 n = normalize(vNormalW);
    float up = clamp(n.y, 0.0, 1.0);
    #else
    float up = 1.0;
    #endif
    return uWetness * mix(1.0 - uWetTop, 1.0, up);
}
#endif
`,
  diffusePS: /* glsl */`
uniform vec3 material_diffuse;
void getAlbedo() {
    dAlbedo = material_diffuse.rgb;
    #ifdef STD_DIFFUSE_TEXTURE
    dAlbedo *= {STD_DIFFUSE_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_UV}, textureBias)).{STD_DIFFUSE_TEXTURE_CHANNEL};
    #endif
    #ifdef STD_DIFFUSE_VERTEX
    dAlbedo *= saturate(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
    #endif
    dAlbedo *= mix(1.0, 0.62, wetFactor());
}
`,
  glossPS: /* glsl */`
#ifdef STD_GLOSS_CONSTANT
uniform float material_gloss;
#endif
void getGlossiness() {
    dGlossiness = 1.0;
    #ifdef STD_GLOSS_CONSTANT
    dGlossiness *= material_gloss;
    #endif
    #ifdef STD_GLOSS_TEXTURE
    dGlossiness *= texture2DBias({STD_GLOSS_TEXTURE_NAME}, {STD_GLOSS_TEXTURE_UV}, textureBias).{STD_GLOSS_TEXTURE_CHANNEL};
    #endif
    #ifdef STD_GLOSS_INVERT
    dGlossiness = 1.0 - dGlossiness;
    #endif
    float w = wetFactor();
    dGlossiness = mix(dGlossiness, max(dGlossiness, 0.72), w) + 0.0000001;
}
`,
};

export const wetWGSL: Record<string, string> = {
  litUserDeclarationPS: /* wgsl */`
#ifdef FORWARD_PASS
uniform uWetness: f32;
uniform uWetTop: f32;
fn wetFactor() -> f32 {
    #ifdef LIT_NEEDS_NORMAL
    let n = normalize(vNormalW);
    let up = clamp(n.y, 0.0, 1.0);
    #else
    let up = 1.0;
    #endif
    return uniform.uWetness * mix(1.0 - uniform.uWetTop, 1.0, up);
}
#endif
`,
  diffusePS: /* wgsl */`
uniform material_diffuse: vec3f;
fn getAlbedo() {
    dAlbedo = uniform.material_diffuse.rgb;
    #ifdef STD_DIFFUSE_TEXTURE
    dAlbedo = dAlbedo * {STD_DIFFUSE_TEXTURE_DECODE}(textureSampleBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_NAME}Sampler, {STD_DIFFUSE_TEXTURE_UV}, uniform.textureBias)).{STD_DIFFUSE_TEXTURE_CHANNEL};
    #endif
    #ifdef STD_DIFFUSE_VERTEX
    dAlbedo = dAlbedo * saturate3(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
    #endif
    dAlbedo = dAlbedo * mix(1.0, 0.62, wetFactor());
}
`,
  glossPS: /* wgsl */`
#ifdef STD_GLOSS_CONSTANT
uniform material_gloss: f32;
#endif
fn getGlossiness() {
    dGlossiness = 1.0;
    #ifdef STD_GLOSS_CONSTANT
    dGlossiness = dGlossiness * uniform.material_gloss;
    #endif
    #ifdef STD_GLOSS_TEXTURE
    dGlossiness = dGlossiness * textureSampleBias({STD_GLOSS_TEXTURE_NAME}, {STD_GLOSS_TEXTURE_NAME}Sampler, {STD_GLOSS_TEXTURE_UV}, uniform.textureBias).{STD_GLOSS_TEXTURE_CHANNEL};
    #endif
    #ifdef STD_GLOSS_INVERT
    dGlossiness = 1.0 - dGlossiness;
    #endif
    let w = wetFactor();
    dGlossiness = mix(dGlossiness, max(dGlossiness, 0.72), w) + 0.0000001;
}
`,
};
