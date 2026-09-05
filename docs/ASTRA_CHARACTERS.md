# Astra character contribution

Branch: `astra-characters`. Base: `8469d356fa4176bfcd3f53291f5d8dbee9a9557a` (latest main at preparation and final fetch). Claude's branch `claude/echoes-shrine-game-ht9tl2` was at `f630f3c`; its additional changes relative to main were only `DEVELOPMENT_LOG.md` and `SESSION_REPORT.md`. Neither was edited here. An existing uncommitted `docs/shots/player-skinned.jpg` in the other checkout was left untouched; this work used a separate worktree.

## Integration and status

This is an **opt-in character contribution, not final visual approval**. Default gameplay continues loading Claude's original GLBs. Open `?characterSet=astra` for gameplay with the new set, or `?atelier=1` for an isolated inspection lineup in the existing shrine world. Atelier offers all embedded clips, pose scrubbing, front/side/back rotation and detail/gameplay camera distances. It pauses gameplay using existing debug hooks; its independent animation evaluators never emit combat events.

Do not merge the earlier `astra` branch for this contribution. This branch was rebuilt on current main and deliberately excludes that branch's actor-loop, sweep, combat director and weapon implementation changes.

## Base, rig and materials

One shared Quaternius Universal humanoid/Modular Outfits base, using the repository's existing CC0 source pipeline and inherited UAL2/KayKit animation retargeting. See [CHARACTER_SOURCES.md](CHARACTER_SOURCES.md) for original sources and licenses. No new third-party asset was downloaded. `tools/style-characters.py` reads the pinned original player GLB from git, derives all three variants, adds weighted obi, split haori, scarf/mask and variant headwear, then the optimizer welds/simplifies/prunes the assets.

The 65-joint skeleton retains head, neck, spine, shoulders, arms, hands/fingers, pelvis, thighs, calves, feet and toes. Existing body skin weights and all 19 animation datasets per variant are retained; added cloth blends pelvis/thigh or spine weights and headwear follows the head. These are weighted cloth meshes, not simulated cloth. Existing runtime clip mappings, attack events, recovery, root motion and hit recoil are unchanged.

Materials use matte stylized PBR color factors, zero metalness on clothing, high roughness (mostly 0.88), retained eye detail and a modest existing rim shader. Existing body UVs are retained; added clothing has simple parametric UVs suitable for flat-color materials, not a uniquely packed painted atlas. Original source atlas padding and its builder are untouched.

| Character | Design | Triangles | GLB bytes | Render primitives |
| --- | --- | ---: | ---: | ---: |
| Player | Navy, cyan obi/tail, dark parted hair, katana | 12,891 | 1,631,084 | 19 |
| Ally | Brighter teal/cyan, shorter panels, tied topknot, nunchucks | 12,990 | 1,637,608 | 21 |
| Enemy | Charcoal, orange obi/tail, orange kasa, katana | 13,105 | 1,642,188 | 22 |

Each asset has 6 materials. Counts exclude runtime weapons/shadow passes; primitives are not total frame draw calls. No GPU frame-time claim has been verified. The new assets are additional optional downloads; normal gameplay does not download them.

## Weapon sockets

Each GLB includes `WeaponSocket_R` under `hand_r` and `WeaponSocket_L` under `hand_l`. Right socket translation is `[-0.031, 0.111, -0.005]`, quaternion `[0.19326, 0.09009, 0.28395, 0.93483]`; left is mirrored. Runtime uses the authored right socket if present, otherwise preserves the original runtime socket transform. Katana offset remains Y=-0.09. Astra's nunchuck held-baton offset is Y=+0.15; original-set offset stays -0.10. Both remain descendants of the hand bone throughout animation. The left socket is available for future support-hand integration; no two-hand IK is added.

Standalone `katana.glb` and `nunchucks.glb` are exported from Claude's unchanged runtime weapon builders for DCC inspection. Runtime still uses those existing builders. No sword sweep endpoints, nunchuck sweep behavior, damage or attack timing changes are included.

## Validation

- `npm ci --ignore-scripts`: passed.
- `npm run build`: passed (TypeScript + production Vite build).
- `npm run characters:test`: passed. Checks 15 routing cases, 9 protected file byte comparisons, unchanged animator/event table, all 57 animation datasets against the base, 6 hand sockets, and 513 sampled poses across the three rigs. Skin indices, weights, inverse binds, UV/normal presence, finite deformation and triangle budgets pass.
- Front/side/back offline renders of actual skinned GLB triangles were inspected in neutral lighting. The trio has coherent proportions and distinct color/headwear silhouettes. This is **not** PlayCanvas screenshot evidence or a collision/cloth-intersection test. The offline weapon preview uses a representative chain angle and player-style exported fittings, not variant-perfect runtime materials.
- Vite started successfully with `npx vite --host 127.0.0.1 --port 5174`. Connected Browser navigation to `http://127.0.0.1:5174/?atelier=1` failed with `net::ERR_BLOCKED_BY_CLIENT`. A separate HTTP probe did not connect either. No access restriction was bypassed.

| Rendered check | Result |
| --- | --- |
| Page identity / meaningful scene / no error overlay | Blocked before load |
| Console health | Unverified |
| In-shrine screenshots / gameplay-distance appearance | Unverified |
| Atelier controls and mobile layout | Unverified |
| Combat with Astra enabled | Unverified |

## Known issues and next steps

1. Dedicated nunchuck choreography is still missing: the inherited ally mapping uses sword-derived strikes. This branch intentionally does not adjust sweeps to compensate. Coordinate choreography and damage-window expectations with Claude before gameplay approval.
2. Cloth is only coarsely weighted. Sword/sash overlap is visible in the offline guard projection; exact clearance through attacks, dodge and death must be reviewed in Atelier. Gloves obscure fine finger detail; two-hand grip and weapon contact require close-up inspection. Do not call these final polished characters yet.
3. No two-hand IK, cloth simulation, nunchuck physics, extra LODs, GPU benchmark or complete end-to-end visual regression run was added.
4. On an accessible local game, review all clips at front/side/back, inspect hands/feet/weapon grip, compare `?characterSet=astra` with the default set under real lighting, and play Claude's combat tests. Fix character weights/socket calibration only; agree any shared combat change separately.
5. Run `npm run characters:test` and `npm run build` after integration. Protected-file comparisons intentionally pin this contribution's base; future legitimate Claude changes will require reviewing/updating those baseline checks, not reverting his changes.

## Every changed file

Added:

- `public/assets/characters/astra/player.glb`
- `public/assets/characters/astra/ally.glb`
- `public/assets/characters/astra/enemy.glb`
- `public/assets/characters/astra/katana.glb`
- `public/assets/characters/astra/nunchucks.glb`
- `src/characters/catalog.ts`
- `src/characters/atelier.ts`
- `src/characters/atelier.css`
- `tools/style-characters.py`
- `tools/optimize-characters.mjs`
- `tools/export-weapons.mjs`
- `tools/inspect-characters.py`
- `tools/validate-characters.py`
- `tools/test-character-compatibility.mjs`
- `docs/ASTRA_CHARACTERS.md`

Modified shared files (inspected against Claude's latest version before editing):

| File | Only change |
| --- | --- |
| `src/assets/manifest.ts` | Select optional Astra URLs while retaining asset IDs and default URLs. |
| `src/combat/skinned.ts` | Recognize authored hand socket, Astra nunchuck grip offset, matte-cloth rim/hit-flash materials. Animator and event timings unchanged. |
| `src/main.ts` | Four-line dynamic Atelier import/install behind `atelier=1`. |
| `src/core/debug.ts` | Atelier bypasses entry/pointer lock using existing shot-mode flag. |
| `package.json` | Three character-only build/validate/test scripts; no dependency change. |

No actor, combat director, AI, sweep/weapon builder, damage config, world, renderer, game loop, gameplay controller or input file changed. The original three character GLBs are byte-identical to main.

## Rebuild and merge

Requires Node dependencies (`npm ci`), Python with NumPy/Pillow, and git history containing the pinned base. A shallow checkout may need `git fetch --unshallow`. Run `npm run characters:build`, then tests/build. This only rewrites the dedicated Astra asset directory.

Review and merge this branch after coordinating with Claude; do not force-push or replace his files:

```sh
git fetch origin
git switch main
git pull --ff-only
git merge --no-ff origin/astra-characters
npm ci
npm run characters:test
npm run build
```

Use a clean worktree for these commands. If new work overlaps, resolve individual hunks preserving Claude's latest behavior. Most likely future conflicts are `src/combat/skinned.ts`, `src/assets/manifest.ts`, `src/main.ts`, `src/core/debug.ts` and `package.json`. His currently unmerged documentation-only changes do not overlap. Keep the assets opt-in until visual/combat review passes; switching the default is a separate coordinated decision.
