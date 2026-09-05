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

- **Hits were frame-rate dependent.** The swept blade was rebuilt from two poses a frame apart; at
  1/20 s the second combo hit was lost and at 1/10 s nothing landed. Fixed by sampling the
  animation at a fixed rate while a window is pending (see Completed). Verified at 1/60 … 1/10.
- **Line of sight stepped over thin geometry.** The ray march sampled every 0.5 m from 0.5 m out,
  so a post or railing under half a metre could sit between samples. Replaced with an exact
  segment test against the colliders.
- **Root motion landed a frame early.** The lunge was consumed before the pose that produced it;
  `pose()` / `finish()` are now split around the controller's integration.
- **A damage window could stay open** after an interrupting action, and the frame on which
  `hitClose` fired was never swept (the blade's last centimetres of travel). `act()` closes the
  window; a tail flag keeps the closing sub-step.
- **The hit flash lit every fighter** because instances shared the container's materials; they are
  cloned per body now.
- **The 1v1 arena spawned inside a staged encounter's trigger** (three AI enemies and the ally
  joined the "held" test); a hit turned the held dummy into a live enemy; the trace showed near
  misses at 0.53 m because the sweep lerped the tip along the chord inside the swing arc. All three
  fixed (encounters disarmed, held flag honoured in every state, arc-aware sweep).
- **The frame-rate test compared enemies by array index**, which shifted when a body was reaped;
  `enemyHealth()` returns stable ids.
- **Hit reactions:** the KayKit flinch retargets with both arms locked out sideways; the UAL2
  knockback is on the ground within 0.2 s. Replaced by the additive recoil.
- Both local servers died during the usage pause; three concurrent SwiftShader captures timed each
  other out (captures now run one at a time).

## Test results

All logic tests run headless (Chromium on SwiftShader) by stepping the game loop through
`__ECHOES.simulate`, so they are independent of the render rate; each is run at several fixed
step sizes to prove the combat maths does not change with the frame rate.

| Lab | What it does | Result |
| --- | --- | --- |
| Hit lab | Held enemy at 1.6 m and 2.3 m; light ×3, heavy, light ×3; then the same with the back turned. Steps 1/60, 1/30, 1/20, 1/10 s. | Every case: 12 / 14 / 18 then the killing heavy (21 left), nothing after death, nothing with the back turned, no NaN. Identical at all four step sizes. |
| AI duel | Enemy fights back; scripted swings and dodges. Steps 1/60, 1/20 s. | Enemy dies at 4.9 s / 12.9 s; player takes 12 or 14 per enemy hit (1 hit / 3 hits); states seen idle, alert, approach, combatIdle, attack, recover, hit, stagger, dying; no state held > 8 s; 0 attacks after death; no NaN. |
| Movement lab | Sprint in from 4.5 m and swing while still running; strafe under enemy attacks for 8 s; attack while the yaw sweeps 50°; the same with the back turned. Steps 1/60, 1/20 s. | Run-in swing lands 12 once at both steps; strafing player takes 12 / 14 with ≥ 2.1 s between hits and keeps moving every step; turning swing lands 12 once; back-turned turning swing lands 0; no NaN. |
| Wall lab | The 1.1 m stone lantern pillar between the fighters at 2.05 m; the same spacing on open stone (control); a 0.11 m torii post between them. Steps 1/60, 1/20 s. | Through the pillar: 0 / 0 / 0 / 0 at both steps. Open control: 12 / 14 / 18 / 21. Thin post: the swings whose contact point falls beside the post land, the ones behind it are blocked (12 / 0 / 18 / 28 at 1/60, 12 / 0 / 18 / 0 at 1/20) — the blade genuinely passes the post on one side, so the per-swing outcome depends on centimetres of contact position. |
| Slope lab | The steepest walkable patch within 45 m of the courtyard (17°, at x 45 z −24.5); enemy uphill, then downhill. Steps 1/60, 1/20 s. | 12 / 14 / 18 / 21 in all four cases; no NaN. |
| Staged encounters | The three encounters simulated end to end. | Still clear (64 / 22 / 52 swings). |
| Gameplay-camera fight capture | The AI 1v1 from the real third-person camera, one frame per 0.15 s, scripted player who closes, swings in reach and dodges on the enemy's commit. | Enemy dead by frame 12; player finishes on 62 HP; sword stays in the hand, feet on the stone, hit flash on the struck body only (`docs/shots/combat-fight.gif`). |
| Overlay capture | F2 overlay from the side, loop frozen, a light attack stepped to fixed phases. | Side view shows both hurt capsules and the blade's sweep chain fanning from over the head down through the target's line (`docs/shots/combat-overlay.jpg`); the chain is green before contact and red with a contact point on the frame a hit lands. |
| Hit-reaction sheet | `preview('hit')` with the loop frozen, stepped to fixed phases of the recoil. | At 0.06 s all three bodies lean back with the head turned and the enemy (stagger, strength 1.7) further than the player and ally (light hit); the feet stay planted and the sword stays in the hand. |

Checklist from the brief: idle→attack ✓, run→attack ✓, three-hit combo ✓, heavy ✓, dodge (0.25 s
i-frames honoured; a mistimed dodge is hit, as intended) ✓, attack after dodge ✓ (duel), hit
during movement ✓, attack while turning ✓, uneven terrain ✓, walls ✓ (thick), kill mid-animation ✓
(the enemy dies on the frame the killing blow lands, whatever it was doing, and its window and
token are cleared), sword attached ✓, feet grounded ✓ (heightfield-placed; no foot IK on slopes
yet), no double damage ✓, no damage through walls ✓, no NaN ✓, no animation locks ✓ (no state held
over 8 s in any duel), dead enemy cannot attack ✓, FPS does not change combat math ✓.

## Remaining bugs and known limitations

- **P2 — thin posts are a coin flip.** A blade contact whose point falls beside a 0.11 m torii post
  is not blocked (the blade genuinely passes on that side), so against very thin geometry the
  per-swing outcome depends on centimetres of contact position and can differ between step sizes.
  Thick walls are consistent. A "blade path must also be clear" test (sweep the blade segment
  against colliders, not only the chest→contact ray) would close it.
- **P2 — enemies are tested at last frame's positions.** The player's sweep runs before the
  enemies move for the frame, so a running enemy is up to one frame (≤ 7 cm at 60 Hz) from where
  the sweep sees it. Harmless at the capsule sizes used, but it is a known asymmetry.
- **P3 — a sprinting player can shove a held enemy.** Separation is a rate, so a player running
  into a stationary body pushes it along; in a live fight the enemy is moving anyway.
- **P3 — no FPS measurement on real hardware.** The container renders through SwiftShader at about
  one frame per second, so the GPU frame rate cannot be measured here; draw calls and triangle
  counts are reported instead.
- **Not started (by design):** multiple enemies and the ally on the new pipeline in a live fight
  (the ally spawns with the old clip tables on the skinned body and is benched by the arena), a
  parry/block, perfect-dodge slow motion, attack telegraphs.

## Performance

The container renders through SwiftShader at roughly one frame per second, so a GPU frame rate
cannot be measured here; the numbers below are what can be.

| Measure | Value |
| --- | --- |
| Production bundle | `index` 242.9 kB (76.8 kB gzip), PlayCanvas chunk 1,408 kB (369 kB gzip), CSS 8.9 kB |
| Character GLBs | player 4.94 MB, enemy 5.02 MB, ally 5.11 MB (19 clips each) |
| Draw calls, medium preset, courtyard 1v1 | 3,145 per frame (whole scene; the fighters are a handful each) |
| Combat CPU | Blade sampling costs at most 12 animation sub-steps per attacking fighter per frame, only while a window is pending; the sweep itself is ≤ 48 segment tests per sample pair per target. Not measurable on this CPU-rendered path; expected well under 0.5 ms for five fighters on a desktop. |
| Logic stepping | 20,000 fixed steps per `simulate()` call cap; the full lab batch runs in about eight minutes of wall clock, almost all of it page load on SwiftShader. |

Real-hardware profiling (target 60 FPS, 45+ acceptable) is the first item of the next session's
feel pass.

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

1. **Multi-enemy V1 (2–3 orange enemies):** the attack token and ring slots already exist; add a
   second and third enemy to the courtyard encounter, tune `holdRange` / slot spacing so the ring
   reads, and extend the duel lab to assert one attacker at a time and no overlapping bodies.
2. **Nunchuck ally on the same pipeline in a live fight:** give the ally the Follow → CombatIdle →
   ApproachTarget → Attack → Recover → Hit machine, make it pick the enemy the player is not
   fighting, and prove it never damages the player (its sweeps target only enemies; add the
   assertion to the lab).
3. **Blade-path occlusion:** sweep the blade chain itself against colliders so a thin post between
   fighters blocks the cut wherever the contact would fall, and add the wall lab's post case as a
   hard assertion.
4. **Feel pass on real hardware:** measure frame time on a GPU, then tune hit-stop (the brief's
   30–45 / 50–75 ms bands), spark size, impact sound layering and the camera impulse against the
   fight capture; add an attack telegraph flash on the enemy's wind-up.
5. **Remaining visual polish:** foot planting on slopes for the skinned bodies (IK on the ankle
   only), the enemy's hood clipping at the shoulders in the recoil, and new README plates from the
   gameplay camera replacing the procedural-character shots.
