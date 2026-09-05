# Astra character pipeline

The `astra` branch derives all three shrine fighters from the existing CC0 Quaternius
Universal player base at commit `6a9e832dac30ed0607888867daea4d2adf20842d`.
This retains authored humanoid anatomy, fingers, boots, UVs, skinning, and retargeted
animations. Original contour-mesh garments add an obi, split haori panels, a sash,
scarf, face wrap, and role-specific head accents. These are actual skinned meshes,
not image planes or generated concept art.

| Asset | Design | Triangles | File bytes | Render primitives |
| --- | --- | ---: | ---: | ---: |
| `public/assets/characters/player.glb` | Navy, cyan obi, loose dark hair, katana | 12,891 | 1,631,084 | 19 |
| `public/assets/characters/ally.glb` | Blue/teal, pale cyan, shorter panels, tied topknot, nunchucks | 12,990 | 1,637,608 | 21 |
| `public/assets/characters/enemy.glb` | Charcoal, orange obi and compact kasa, katana | 13,105 | 1,642,188 | 22 |

The separate `katana.glb` and `nunchucks.glb` are exported from the same procedural
weapon functions the game uses. They are reusable inspection/DCC assets; runtime
continues to construct the weapons so variant fittings and combat endpoints stay
authoritative. Character triangle counts exclude weapons, shadow passes, and trails.

## Rebuild

```sh
npm ci
npm run characters:build
npm run build
```

Python dependencies: NumPy and Pillow. The original source commit must exist in the
local git object database. A shallow checkout of a newer commit may need a deeper
fetch containing the commit above. No Blender, online asset generation, proprietary
editor, or new source-pack download is needed for this variant build.

1. `tools/style-characters.py` reads the immutable source GLB through git and creates
   three consistent variants. Running it repeatedly never edits an already-decimated
   output. New rings and garment shells include UVs, normals and normalized weights.
2. `tools/optimize-characters.mjs` welds, simplifies with meshoptimizer, deduplicates,
   and removes unreferenced textures. **Keep leaf nodes and unused UV attributes**:
   the weapon sockets and UVs are intentional authoring data.
3. `tools/export-weapons.mjs` runs the real PlayCanvas weapon builders with its null
   graphics device and exports their geometry without requiring a browser.
4. `tools/validate-characters.py` checks topology references, weights, joints,
   attachments, required clips, triangle budgets, and 171 sampled poses per fighter.

`tools/build-character.py` remains the original source-pack assembler; see
[CHARACTER_SOURCES.md](CHARACTER_SOURCES.md) for its licenses and source URLs.
To adopt a newly assembled base, review it first and deliberately update the pinned
base commit in `style-characters.py`.

## Rig and clips

Each fighter uses the same 65-joint Universal skeleton: root, pelvis, spine chain,
neck, head, clavicles, upper/lower arms, hands and finger chains, thighs, calves,
feet and toe bones. Up to four weights per vertex. Existing source skins retain
their own inverse bind matrices; the added garments use the outfit skin.

The 19 retained clips include idle, walk, run, guard, three slashes, recoveries,
heavy, dodge, hit variants, block, death variants and a T-pose. Clip routing lives
in `src/combat/skinned.ts`. Root motion remains a dedicated `RootMotion` curve
consumed by the actor/controller, rather than silently moving the mesh away from
its gameplay capsule. Runtime flinch remains an additive reaction.

Cloth has bone deformation, not physics. Panels blend pelvis/thigh weights; the obi
blends pelvis/spine; head accessories use the head joint. This is a consistent base
for additional clips, not a claim of automatic compatibility with every Mixamo rig.

## Materials

Six used material slots per character: matte cloth, leather, accent fabric, hair,
skin and eyes. Fabric/leather use controlled roughness and sRGB-authored colors
converted into glTF linear factors. Fine ranger normal maps and pore maps are
removed. The eyes retain a small texture. UVs remain available for later painting.
Runtime uses restrained rim lighting on the named shrine materials and includes
them in hit flashes. Source meshes retain folds/buckles in geometry.

## Weapon attachments

Each GLB contains `WeaponSocket_R` under `hand_r` and `WeaponSocket_L` under `hand_l`.
Runtime checks right-hand ownership and uses the exported socket. The fallback
calibration for older assets is `KATANA_SOCKET` in `skinned.ts`.

- Right socket position: `[-0.031, 0.111, -0.005]` in hand-local meters.
- Quaternion: `[0.19326, 0.09009, 0.28395, 0.93483]` (x, y, z, w).
- Katana offset: local Y `-0.09`, seating the upper grip at the palm.
- Nunchuck offset: local Y `+0.15`, seating the middle of the held baton at the palm.
  The previous `-0.10` offset put that midpoint 25 cm below the socket.
- The free nunchuck is a child of the chain pivot, with hollow oval chain links.
  Its swing advances inside the actor's skeletal substeps, before hit sampling.
  Sweep/trail endpoints are on the actual moving baton, not the held weapon root.
- The left socket is available for future attachments; it is not used as a two-hand
  IK constraint. The current ally carries one linked nunchuck pair.

## Review and validation

Run the game and open `/?characters=1` to enter a courtyard lineup with animation,
front/side/back and pause controls. It uses the actual scene lighting and actor
path. `/?characters=1&webgl=1` requests WebGL2. The normal game loads the same assets
through its existing asset bank; no alternate placeholder path was introduced.

Offline geometric inspection is reproducible:

```sh
python3 tools/inspect-characters.py --out /tmp/front.png
python3 tools/inspect-characters.py --out /tmp/back.png --angle 180
python3 tools/inspect-characters.py --out /tmp/side.png --angle 90
python3 tools/inspect-characters.py --out /tmp/attack.png --clip slash1 --time 0.4
```

These images rasterize the exported GLB triangles and skin transforms with a depth
buffer. They are explicitly **offline neutral-light geometry previews**, not
screenshots of the game or evidence of PlayCanvas shader performance.

Verified during implementation: production TypeScript/Vite build; all three GLBs'
weights, joint indices, inverse binds, UVs, named sockets, required animation clips,
and 513 sampled deformation poses. Front/side/back and slash geometry were inspected.

The available browser rejected the local preview URL with `ERR_BLOCKED_BY_CLIENT`.
Consequently browser console health, review-panel interaction, actual shrine lighting,
WebGPU/WebGL rendering, gameplay camera readability, live combat collision timing,
and hardware FPS **have not been verified**. The implementation should receive that
visual/combat review before being called release-ready or merged.

## Remaining work / integration handoff

1. Run the review panel in the target browser; inspect grips and panel clearance
   during attack, dodge and death extremes. Adjust cloth weights if needed.
2. Give the ally dedicated nunchuck choreography. Its current body attacks still
   use sword-derived clips; the articulated weapon motion is procedural.
3. Review two-handed katana support and add off-hand IK if the selected attacks need
   it. Bone parenting guarantees attachment, not perfect finger/handle clearance
   at every frame.
4. Revalidate damage windows against the moving nunchuck; no gameplay balance claim
   is made for the newly corrected sweep path.
5. Profile actual enemies-on-screen and shadow passes. Roughly 13k triangles per
   fighter is moderate, but 19–22 body primitives still incur draw overhead. Consider
   material/skin batching and LODs after measuring the target device.

This is an implemented stylized character iteration with a repeatable pipeline.
Final art approval and in-game QA remain open; it is not a promise that these meshes
match the reference illustrations' polish pixel-for-pixel.
