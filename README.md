# Echoes of the Shrine

A small, cinematic first-person exploration game that runs in the browser. You arrive at a forgotten
mountain shrine just after rainfall, at dusk. Three ancient stones sleep among the ruins. Wake them.

Built on **PlayCanvas Engine 2.x** with a **WebGPU-first** renderer and an automatic **WebGL 2**
fallback. Everything is TypeScript, bundled with Vite. The world — terrain, architecture, foliage,
water, weather, particles, music and sound — is generated at runtime from a small set of CC0 source
textures and props; there are no baked levels and no audio files.

---

## Running it

```bash
npm install          # install dependencies
npm run dev          # dev server at http://localhost:5173
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build at http://localhost:4173
```

The runtime assets in `public/assets` are committed, so `npm run dev` works immediately after
install. To regenerate them from source (requires network access to Poly Haven):

```bash
node tools/download-assets.mjs    # fetch CC0 sources into assets-src/ (not committed)
node tools/pack-assets.mjs        # -> WebP textures + GLB models in public/assets
node tools/simplify-models.mjs    # decimate the scan meshes to game-ready budgets
```

Headless visual review (uses the bundled Chromium via Playwright):

```bash
node tools/shots.mjs --preset high --out screenshots/run \
  --views "gate:0,3.5,-27,180,2;court:0,3,-6,180,-3"
```

### Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| Mouse | Look (pointer lock; click the canvas to capture) |
| `Shift` | Sprint (widens FOV slightly) |
| `Space` | Hop |
| `E` | Attune to a stone when the prompt appears |
| `Esc` | Settings / pause |

Useful URL parameters: `?preset=ultra|high|medium`, `?state=0..3` (jump to a world state),
`?webgl=1` (force the WebGL 2 path), `?shot=1` (skip the title screen, for tooling).

---

## Project structure

```
src/
  core/        engine bootstrap (device selection), settings store, event emitter, debug hooks
  rendering/   lighting + mood system, global height fog, CameraFrame post-processing
  world/       terrain field & renderer, shrine architecture, scatter/instancing, water,
               trees, leaf-atlas generation, materials, level layout
  player/      input, kinematic capsule collision, first-person controller
  gameplay/    game loop, director (states, stones, finale), energy stones
  effects/     particle systems, god rays and mist banks
  shaders/     GLSL + WGSL chunk overrides (terrain, wet surfaces, wind, water, particles, stone)
  audio/       procedural Web Audio engine and synthesis helpers
  ui/          loading screen, HUD, settings menu, stylesheet
  assets/      asset manifest / loader
  utils/       math, noise, geometry builders
tools/         asset download + packing pipeline, screenshot tools
public/assets/ packed runtime assets (textures, models, HDRI)
```

---

## Graphics techniques

**Rendering path**
- WebGPU requested first, automatic WebGL 2 fallback; every custom shader ships in both
  **WGSL and GLSL** so neither path is a downgrade in features.
- HDR scene target with ACES2 tone mapping through PlayCanvas' `CameraFrame` pipeline.

**Lighting**
- Image-based lighting from an HDRI: skybox cubemap + prefiltered environment atlas, rotated so the
  HDRI's sun agrees with the directional light.
- Low, warm key light raking in over the northern ridge with **cascaded shadow maps** (2–4 cascades
  by preset, PCSS soft shadows on Ultra/WebGPU), plus a cool sky-fill light so shadows read blue
  rather than black.
- **Clustered lighting** for the lantern and stone point lights — dozens of small lights at
  negligible cost.
- A *mood* system blends sun colour, intensity, exposure, ambient and fog between four authored
  states as the stones awaken.

**Custom shaders** (all GLSL + WGSL)
- *Terrain splat*: four PBR layers (forest floor, mossy rock, cobblestone, cliff) blended by slope,
  vertex-painted masks and height-map sharpening, with triplanar mapping on cliffs and macro-variation
  sampling to hide tiling.
- *Post-rain wetness*: darkened albedo and raised gloss driven by surface orientation, applied
  globally to architecture and props.
- *Puddles*: analytic ripple-ring gradients producing rain-drop normals on flat wet ground.
- *Water*: two scrolling layers of analytically-differentiated gradient noise for normals, expanding
  drip rings, depth-driven colour/gloss, Fresnel sky term, and an opacity fade that dissolves the
  shoreline so there is no hard rim.
- *Global height fog*: replaces the engine's fog chunk with an analytic height-integrated fog with
  sun in-scattering and animated 3D noise, shared by every material including particles.
- *Vertex wind*: height-weighted bending plus high-frequency flutter, phase-offset per world position
  so instances never move in lockstep; shared with the shadow pass so shadows agree with the geometry.
- *Energy stones*: additive faceted glow with a Fresnel rim, drifting interior bands and an
  activation shockwave.
- *Billboard particles*: `transformInstancingVS` is overridden to build a camera-facing basis
  directly from the instance stream, so the CPU never writes full matrices.

**Atmosphere**
- Height + distance fog with sun in-scattering and drifting noise.
- Camera-anchored light shafts that fade as the sun leaves view, plus drifting ground-mist banks,
  both with near/far camera fades so cards never pop through the viewer.
- Five particle systems (dust, spores, drips, embers, energy motes) on a shared instanced pool.

**Vegetation**
- Procedural trees: recursive tapered branches with crossed leaf cards at the tips.
- Leaf atlases are **generated at runtime** onto a canvas — procedural leaf shapes, midribs and
  veins, modulated by a photographic detail texture, with a derived normal map and an alpha-bleed
  pass so mipmaps don't darken the silhouettes.
- Everything else is GPU-instanced from decimated CC0 scans with deterministic rejection sampling
  against slope, moss masks, path corridors and keep-out zones.

---

## Performance work

- **Hardware instancing everywhere**, grouped into spatial cells so frustum culling discards whole
  clusters; foliage density is a live setting that adjusts `instancingCount` rather than rebuilding
  buffers.
- **Merged draw calls**: all shrine architecture is built into per-material merged meshes.
- Chunked terrain with tight per-chunk bounds.
- Scan meshes decimated with meshoptimizer to game-ready budgets (typically 250–900 triangles for
  scatter props); textures packed to 1K WebP.
- Preallocated typed arrays for particle simulation — no allocation inside the frame loop.
- **Adaptive resolution**: median frame time over a sliding window nudges the render-target scale in
  5% steps to hold ~60 fps.
- Three presets (Ultra / High / Medium) controlling shadow resolution and distance, cascade count,
  SSAO samples, DOF quality, foliage and particle density, mist layers and render scale.
- Device pixel ratio capped so high-DPI displays don't quadruple the fragment load.
- Asynchronous, progressive world build that yields to the browser between phases so the loading
  screen keeps animating.

---

## Audio

Entirely procedural Web Audio — no sound files ship with the game:

- Layered ambience: filtered pink-noise forest bed, a resonant wind filter on a random walk,
  occasional distant thunder, sparse crickets that thicken as the shrine wakes, and rain drips.
- Per-surface footsteps (stone, water, grass, rock, soil) with randomised pitch and level, plus
  landing and jump sounds.
- Spatialised (HRTF panner) shrine hums, water ambience, door grind and stone activations.
- A slow pentatonic score that layers in across four stages, climaxing with a swelling pad.
- Convolution reverb from generated impulse responses, switched between open / courtyard / sanctum
  as the player moves.

---

## Known limitations

- **WebGPU could not be verified in this environment.** The headless Chromium available here exposes
  WebGL 2 only (SwiftShader), so every screenshot in `screenshots/` is from the WebGL 2 fallback
  path. The WebGPU path is implemented — WGSL is provided for every custom chunk and the device is
  requested first — but it has not been run on real hardware.
- Frame rates in the shipped screenshots (~10 fps) are software-rasteriser numbers, not
  representative. Triangle load at High is roughly 5–11M submitted before culling; a real GPU should
  hold 60 fps, but this has not been measured on one.
- Particles use a distance fade rather than true soft-particle depth intersection.
- Light shafts and mist are camera-anchored cards, not true volumetrics.
- No Gaussian splats: no suitably-licensed capture of a shrine environment was available, and
  splats would not have provided the collision the gameplay needs.
- Collision is analytic (boxes, cylinders, heightfield) rather than a full physics engine — it is
  tuned for walking, and you can find places to stand on that a physics capsule would slide off.
- The leaf atlases are generated per session on the CPU; on very slow machines this adds about a
  second to load.

## Next five upgrades that would most improve the visuals

1. **True soft particles and depth-aware mist** by sampling the scene depth buffer, removing the
   remaining hard intersections where cards meet geometry.
2. **Screen-space reflections** on the wet stone and pools, which is where a post-rain scene gets
   most of its expensive look; the Fresnel sky term is currently standing in for it.
3. **Baked or voxel-based indirect light** in the courtyard and sanctum so bounce light from the
   lanterns actually spills onto the surrounding walls.
4. **Real tree assets with LODs and imposters**, replacing the procedural cards — canopy silhouette
   is the weakest remaining element and imposters would let the forest be several times denser.
5. **A WebGPU compute path for the particles**, moving the simulation off the CPU so the dust and
   ember counts can go up by an order of magnitude, with GPU sorting for correct alpha blending.

---

## Asset credits

All third-party assets are **CC0** from [Poly Haven](https://polyhaven.com/license): PBR texture
sets, the `kloppenheim_06` HDRI, and the scanned rock / plant / lantern / statue props listed in
`tools/download-assets.mjs`. They are repacked (WebP, decimated GLB) by the tools in `tools/`.
All shaders, geometry, audio and code in `src/` are original.

---

## Demo trailer

`demo/echoes-of-the-shrine.mp4` — a 39-second narrated trailer (1600×900, H.264 + AAC).

It is cut from real rendered frames of the game, with an on-screen narrator (**Nova**) and an
original procedural score. Regenerate the whole thing with:

```bash
node tools/capture-plates.mjs demo/plates    # render the still plates from the running game (~15 min)
node tools/render-captions.mjs demo/caps     # Nova's narration as transparent PNG overlays
node tools/make-soundtrack.mjs --seconds 40 --out demo/score.wav
node tools/build-trailer.mjs                 # Ken Burns + cross-dissolves + captions + score
```

**Why a montage rather than a real-time capture.** This environment has no GPU: the game runs on
Chromium's SwiftShader software rasteriser, where a single frame of this scene costs 20–30 seconds.
A 39-second capture at 24 fps would take over five hours, so `tools/capture-video.mjs` (which drives
the camera by frame index and would produce a true flythrough) is included but impractical here.
Instead `capture-plates.mjs` renders thirteen high-quality stills along the intended camera path and
`build-trailer.mjs` cuts them together with slow moves. Every frame is genuine engine output —
it is edited motion, not live gameplay footage. On a machine with a real GPU, run
`tools/capture-video.mjs` for the flythrough version.

The score (`tools/make-soundtrack.mjs`) is synthesised from scratch — minor-pentatonic plucks over a
drone, a wind bed, and a pad that blooms for the finale — mirroring the in-game audio design. Nova
is an original fictional narrator; no real person is depicted or implied.
