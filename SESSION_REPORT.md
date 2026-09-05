# Session report — Combat System V1

Branch `claude/echoes-shrine-game-ht9tl2`, PR #2 on top of the merged PR #1 (`da5b671`).
Session 2026-09-05, started 10:03 UTC; a usage-limit pause from ~10:55 to ~15:05 UTC cost most
of the planned five hours, so the work below is hours 1–3 of the plan plus the QA pass. Multi-enemy
and the ally on the new pipeline (hour 4) were deliberately not started: the brief says not to
until the 1v1 passes its checklist, and that checklist was completed only at the end of the session.

## Completed

- **One character system.** The procedural rig, its IK and its animator are deleted. Player, enemy
  and ally are three builds of the same skinned Universal-rig character (`tools/build-character.py
  --all`), driven by `SkinnedAnimator` with per-variant clip tables. Materials are cloned per
  instance so a hit flash stays on one body.
- **Swept-blade hit detection**, frame-rate independent by construction: while an attack's damage
  window is pending or open the animation advances in ≤ 1/60 s sub-steps and the blade is sampled
  after each; the samples are laid along the root's motion for the frame and swept in order against
  body capsules (arc-aware, sub-divided by travel). Damage is applied only inside the clip's
  `hitOpen`→`hitClose` window, once per swing per target, in front of the attacker, with an exact
  segment test against level colliders for line of sight. Dodge gives 0.25 s of invulnerability.
- **Centralised config** (`src/combat/config.ts`): player 100 HP; light 12/14/18; heavy 28; enemy
  65 HP; enemy damage 12/14/18; ranges, cooldowns, alert radius, capsule size, blade sampling,
  hit-stop and shake values.
- **Orange enemy state machine**: idle → alert → approach → combatIdle → attack → recover →
  combatIdle, plus hit, stagger, dying; ring slots with hysteresis; an attack token; light hits
  interrupt a wind-up half the time and are absorbed during the cut; a dead enemy never attacks.
- **Hit reaction** as an additive upper-body recoil on the stance (the source packs have no usable
  planted flinch).
- **Contact chain**: blade contact → damage → spark → impact sound → recoil → hit-stop (light 35 ms,
  heavy 60 ms, hurt 45 ms) → camera impulse.
- **Debug mode**: F1 stats panel, F2 hitbox overlay (capsules, sweep chains green/red, contact
  points). Both off in normal play.
- **Test tooling**: `__ECHOES.arena(hold, dist, place)`, `simulate(sec, step, move)` (steps the
  controller and the fight together with a scripted movement intent), `trace(on)`, `setYaw`,
  `enemyHealth()` with stable ids, `preview('hit')`.

## Changed files

Since `main` (`da5b671`): `src/combat/{actor,anim,characters,clips,combat,config,debugdraw,
hitdetect,skinned}.ts` (rig.ts and ik.ts deleted), `src/core/debug.ts`, `src/gameplay/game.ts`,
`src/player/{collision,controller,input}.ts`, `src/ui/hud.ts`, `src/assets/manifest.ts`,
`tools/build-character.py`, `public/assets/characters/{player,enemy,ally}.glb`,
`DEVELOPMENT_LOG.md`, `SESSION_REPORT.md`, `README.md`.

## Bugs fixed this session

TBD_BUGS

## Test results

TBD_TESTS

## Remaining bugs and known limitations

TBD_REMAINING

## Performance

TBD_PERF

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows, mouse | Move, look |
| `Shift` | Sprint |
| Left mouse | Light attack (three-hit combo, 12 / 14 / 18) |
| Right mouse | Heavy attack (28) |
| `Space` / `Q` | Dodge in a fight (0.25 s invulnerable); `Space` is Jump outside combat |
| `E` | Interact |
| `F1` / `F2` | Debug stats panel / hitbox overlay |
| `Esc` | Settings |

## NEXT_SESSION_PLAN

TBD_PLAN
