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
- **Hurt capsule tightened** to 0.30 m (was 0.38, a stand-in for the coarse-step misses the
  sub-stepped sampling has since removed) with 0.06 m of blade tolerance: a cut that visibly
  clears the body no longer counts, and the light attacks' reach is ≈2.0 m from body centre.
- **Sweep precision counters**: every attack has an id, every damage event is logged with
  attacker, target and amount, the animator reports anticipation / active / recovery, and the F1
  panel shows the attack id, frame phase, window state and the last damage events. The hit lab
  asserts that no attack id damages the same target twice.
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

- **"Pixelated" characters, two causes.** (1) The recolour masks stopped exactly at the UV
  island edges, so the gutters between islands kept the source atlas's pale colour; bilinear
  filtering and every mip level read a texel or two past the edge and put a bright speckled
  fringe on every panel of the outfit. The tint masks are now grown into the gutters before
  tinting (nearest-part propagation in the build tool), the base is written at JPEG quality 94 and
  the cloth normal map is softened, so the outfit reads as clean colour blocks. (2) Adaptive
  resolution on the high and medium presets dropped the render scale to 60% (48% effective on
  medium) whenever a frame took over 20 ms, which pixelates the sharp dark fighters while fog hides
  it on the scenery. The floor is now 85%, the medium preset starts at 90%, and the controller only
  steps down below ~45 fps and back up above ~62 fps. Verified with a close-up render at the
  high preset and full scale: the outfit reads as solid navy panels with the cyan belt, no seam
  speckle, clean silhouette edges, sword in the hand.
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
| Hit lab | Held enemy at 1.6 m and 2.3 m; light ×3, heavy, light ×3; then the same with the back turned. Steps 1/60, 1/30, 1/20, 1/10 s. | At 1.6 m: 12 / 14 / 18 then the killing heavy (21 left), nothing after death. At 2.3 m (beyond the light attacks' ≈2.0 m reach with the tightened 0.30 m capsule): the first two lights visibly fall short and land 0, the lunging third slash lands 18, the heavy 28, and the follow-up lights 12 / 7 finish it. Nothing with the back turned, no NaN, no (attack id, target) pair twice. Identical at all four step sizes. |
| AI duel | Enemy fights back; scripted swings and dodges. Steps 1/60, 1/20 s. | Enemy dies at 4.9 s / 12.9 s; player takes 12 or 14 per enemy hit (1 hit / 3 hits); states seen idle, alert, approach, combatIdle, attack, recover, hit, stagger, dying; no state held > 8 s; 0 attacks after death; no NaN. |
| Movement lab | Sprint in from 4.5 m and swing while still running; strafe under enemy attacks for 8 s; attack while the yaw sweeps 50°; the same with the back turned. Steps 1/60, 1/20 s. | Run-in swing lands 12 once at both steps; strafing player takes 12 / 14 with ≥ 2.1 s between hits and keeps moving every step; turning swing lands 12 once; back-turned turning swing lands 0; no NaN. |
| Wall lab | The 1.1 m stone lantern pillar between the fighters at 2.05 m; the same spacing on open stone (control); a 0.11 m torii post between them. Steps 1/60, 1/20 s. | Through the pillar: 0 / 0 / 0 / 0 at both steps. Open control: 12 / 14 / 18 / 21. Thin post: the swings whose contact point falls beside the post land, the ones behind it are blocked (12 / 0 / 18 / 28 at 1/60, 12 / 0 / 18 / 0 at 1/20) — the blade genuinely passes the post on one side, so the per-swing outcome depends on centimetres of contact position. |
| Slope lab | The steepest walkable patch within 45 m of the courtyard (17°, at x 45 z −24.5); enemy uphill, then downhill. Steps 1/60, 1/20 s. | 12 / 14 / 18 / 21 in all four cases; no NaN. |

The hit, wall, movement and slope labs were re-run after the capsule was tightened to 0.30 m; every result above is from that run (only the 2.3 m hit-lab row changed, as described).
| Staged encounters | The three encounters simulated end to end. | Still clear (64 / 22 / 52 swings). |
| Gameplay-camera fight capture | The AI 1v1 from the real third-person camera, one frame per 0.15 s, scripted player who closes, swings in reach and dodges on the enemy's commit. | Enemy dead by frame 12; player finishes on 62 HP; sword stays in the hand, feet on the stone, hit flash on the struck body only (`docs/shots/combat-fight.gif`). |
| Overlay capture | F2 overlay from the side, loop frozen, a light attack stepped to fixed phases. | Four fixed phases of a light attack against a held enemy at 1.7 m: before the window (no chain), window open (green chain, no contact, enemy 65 HP), the contact frame (chain red at the contact, enemy 65 → 53 HP and in `hit`, hit flash on that body only; `docs/shots/combat-overlay.jpg`), and after (window closed, no chain). Draw calls 3,153 in that view. |
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

## NEXT_SESSION_PLAN (as written on 2026-09-05)

Items 1 and 2 shipped in hour 4, below. Items 3–5 carry over to the plan at the end of this file.

1. Multi-enemy V1 (2–3 orange enemies). 2. Nunchuck ally on the same pipeline in a live fight.
3. Blade-path occlusion. 4. Feel pass on real hardware. 5. Remaining visual polish.

---

# Session report — Combat V1, hour 4 (2026-09-14)

Branch `claude/echoes-shrine-game-ht9tl2`, PR #5. Items 1 and 2 of the plan above, started only
now because the brief said not to until the 1v1 checklist had passed.

## Completed

- **The ring.** With two or three enemies on the player, only the enemy holding the attack token
  closes inside its reach and swings; the others take flank slots ±50° either side of it as seen
  from the player, a metre further out (2.8 m), so the whole ring stays inside the third-person
  view. Slots are handed out left to right in the order the flankers already stand, so two never
  swap sides through the holder; a flanker a long way from its slot walks around the ring, not
  across it. The token passes when its holder dies, when a circling holder's time is up (2.4–3.8 s),
  or from the holder itself at the end of its recover — never mid-swing, never twice in a second.
  The next holder is the enemy the player is looking at unless another has waited far longer. The
  holder keeps pressing until it is inside its own reach. A swing keeps the target it was
  telegraphed at. Bodies resolve their overlap within the frame (three passes, capped at 0.5 m) so
  no two ever stand in the same spot at any frame rate.
- **Targets.** Every enemy fights a target: the ally's duel partner fights her, everyone else the
  player; enemy blades cut whichever of the two is in the arc. The player token only ever passes
  among enemies on the player, so the ally's partner is left to her unless it is the last one
  standing.
- **The ally on the skinned pipeline, in a live fight.** State machine follow → approach →
  combatIdle → attack → recover, plus hit and downed. She picks the enemy that does not hold the
  token (on her side of the player first, a grunt before the elite), keeps it while it qualifies,
  rounds the player rather than crossing their line, flurries (the combo, or the spinning heavy one
  time in four), steps back a little and closes again the moment it is her turn. Health 120 from
  config: hurt cooldown 0.35 s, a hit during her own cut absorbed, otherwise a flinch; regen
  8 HP/s after 2.5 s without a hit; a 6.5 m leash breaks off a duel that drifts; at zero health she
  is down for 4 s (held death clip, a pulse on the outfit every 0.8 s, untargetable, out of the
  separation), then rolls up facing the player at 60% health. Her sweeps only ever run against
  enemies and the player's only against enemies: neither can damage the other, by construction.
- **Respawn.** The shrine pulls the player back with every enemy reset to idle and its swing
  abandoned with the window closed, and the ally re-summoned beside the player on her feet.
- **Tooling.** `arena(hold, dist, place, enemies, ally)`, `fighters()`, `allyHealth()`,
  `playerHealth()`, the token holder and the per-frame maximum of attackers on the player in
  `stats()`, the token and the ally on the F1 panel; the arena clears the damage log.

## Changed files

`src/combat/{combat,config}.ts`, `src/core/debug.ts`, `src/gameplay/game.ts`, `README.md`,
`SESSION_REPORT.md`, `DEVELOPMENT_LOG.md`, `docs/shots/combat-ring.jpg`,
`docs/shots/combat-ring-top.jpg`, `docs/shots/combat-ally.jpg`.

## Bugs fixed this session

- **Slots piled up after a death:** `slotAngle` divided by the live count but never re-ranked the
  indices, so with slots 0 and 2 of three alive both computed the same angle. Replaced by the
  anchored flank slots.
- **Two attackers at once:** the token could pass on its timer while the holder was mid-swing, and
  (found by the design critique) the end-of-recover pass ran for *any* enemy finishing a recover,
  not only the holder. Both closed.
- **The holder rested out of reach:** the 0.6 m slot band let the token holder stand at 2.0–2.2 m,
  outside its 1.9 m attack range, and never swing (a lone enemy hovered for 90 s in the first
  multi-enemy run). The holder now presses until inside `attackRange × 0.92`.
- **A 1/10 s frame straddled the slot band:** the last frame of a walk now lands on the slot.
- **Five clustered bodies kept 6 cm of overlap** with single-pass separation (the encounter lab);
  three passes.
- **An enemy reset to idle by the respawn kept its swing's window open** under the idle state
  (`openOnP` reached 2 in the encounter lab); the action is stopped and the window closed.
- **The ally's stand-in behaviour** (999 HP, run to 2.1 m, combo on a timer, benched by the arena)
  is gone.

## Test results

All logic tests run headless by stepping the game loop through `__ECHOES.simulate`; the scripted
player faces the nearest enemy, steps in when out of reach, swings on a rhythm and dodges on the
frame someone commits. The damage log is drained every 0.1 s by attack id, so every claim below
is over the whole fight.

| Lab | What it does | Result |
| --- | --- | --- |
| Multi-enemy | Two, then three enemies fanned in front of the player, no ally; steps 1/60, 1/20, 1/10 s. Asserts: never more than one enemy swinging at (or with a window open on) the player, from the director's per-frame count; no two bodies closer than their radii minus 3 cm; enemies holding a slot ≥ 35° apart and on the ring the design says (flankers within 12° of the holder's bearing ± 50° at 2.8 ± 0.6 m, the holder inside 2.5 m; a body off its slot for longer than 0.3 s fails); a token holder in reach swings within 4 s; no state held over 8 s; every enemy dies; every player-hit sample is a logged event; damage ∈ {12, 14} from enemies, {12, 14, 18, 28} from the player; no (attack id, target) pair twice; no NaN. | All six runs pass. Two enemies: both dead at 12.9 / 11.3 / 6.5 s (1/60, 1/20, 1/10); three enemies: all dead at 16.1 / 18.7 / 9.7 s. Attackers on the player at once: 1 in every run, windows open on the player at once: 1. Closest any two bodies came: 1.079–1.08 m against 1.08 m of radii, 0 overlaps. Slot-holders at least 45–52° apart; 0 / 83–110 samples off the ring geometry at 1/60 and 1/10, and at 1/20 s two or three samples (0.1 s, the frame of a token pass). The holder never circled in reach longer than 1.5 s; the longest hold was 7.3 s (the last enemy standing, with nobody to pass to). No stuck states, no duplicate pairs, no NaN; every player-hit sample matched a logged event. |
| Ally | Two enemies and the ally; the run continues 4.5 s past the last death. Asserts: no A→P or P→A event ever; she lands hits (8 / 14) and takes them (12 / 14); every drop in her health and the player's is a logged event; with two enemies standing she is never on the token holder (0 samples); never more than one enemy on her; she regenerates; a partner in reach is struck within 3.5 s; never stuck; the fight clears. Then her health set to 10 with the player only dodging. | Pass at 1/60 and 1/20 s: 0 events between her and the player either way over 64 / 48 samples; she landed 2 hits and took 2 / 1 (all values from the config), every drop in either health a logged event; on the token holder in 0 samples; at most one enemy on her; health regenerated after the lull; longest wait in reach 1.3 s; the fight cleared at 7.5 / 5.0 s. Downed path: down at 2.5 s, neither targeted nor hit while down, up 4.0 s later on 72 HP, re-engaged. |
| Encounter path | The real route: encounter 1 from idle spawns with the ally stepping out of the trees, a 4 s walk toward the shrine with the ally in tow, encounter 2 with the elite where her health and the player's are set to 1 (she goes down, the player is hit and respawns, every enemy back in idle with no swing live, the ally beside the player at 120), then the fight cleared. | Pass. Encounter 1 cleared at 9.7 s with the ally landing 2 hits, 0 events between her and the player, one attacker on the player at a time, no overlaps. The walk: 12.8 m in 4 s with her 2.1 m behind in `follow`. Encounter 2: she is down at 4.6 s; the player is hit and respawns at 4.8 s at the encounter's edge (0.3, 22.6) with all three enemies in `idle`, none attacking, and her beside the player (2.9 m) on 120 HP and already choosing a target; the fight then clears at 18 s (218 dealt by the player, 28 by her, 240 needed), the elite's hit on the player 16, the blades' 12 / 12 / 12, no overlaps, 0 events between her and the player. |
| AI duel, hit, wall, movement, slope | The previous session's labs, unchanged (the duel lab gained exit codes). | Duel: enemy dead at 4.9 s at both steps, 12/28/12/13 dealt, one hit taken, no attacks after death. Hit lab identical to the previous session at every distance and step. Wall lab identical (0/0/0/0 through the pillar, 12/14/18/21 open, the thin-post coin flip unchanged). Slope lab identical. Movement lab: run-in swing 12, turning swing 12, back-turned 0 at both steps; the strafe row now takes 12/12/12 and 14/14/12 with ≥ 2.1 s between hits (was 12/14 and 12) because the holder now presses inside its reach instead of resting at 2.2 m. |

Plates from the production build with the render scale pinned: the ring from the gameplay camera
(holder committing in front, a flanker to the left, the ally's duel behind) and from 8 m above with
the F2 capsules; the ally mid-flurry square-on. Taken with the loop released for the frames of each
screenshot: a paused loop leaves the fog and post-processing on their first frame, which put a
band across the horizon of the first set.

## Remaining bugs and known limitations

- **P2 — thin posts are a coin flip** and **P2 — enemies are tested at last frame's positions**:
  unchanged from the previous session.
- **P3 — an encounter's enemies can spawn outside their alert radius.** The trigger zone is 15 m
  and the alert radius 14 m, so a player who stops at the edge of a zone sees the banner and the
  spawn puffs and then nothing until they walk in. Pre-existing; not changed.
- **P3 — the downed pose is the enemies' death clip.** A held frame at ~55% of the track (on one
  knee) would read better than prone; needs a `holdAt` on the clip table and a look at the track.
- **Not measured:** frame time on real hardware (SwiftShader only). Draw calls in the 3v1 + ally
  courtyard fight: 3,435 at the high preset (3,145 in last session's 1v1). Production bundle:
  `index` 251.1 kB (79.7 kB gzip, was 242.9 / 76.8), the PlayCanvas chunk unchanged. The ring and
  the ally add no per-frame allocation beyond the token pass's sort; the slot assignment is a
  handful of `atan2` calls per enemy per frame.

## NEXT_SESSION_PLAN

1. **Blade-path occlusion:** sweep the blade chain itself against colliders so a thin post between
   fighters blocks the cut wherever the contact would fall; make the wall lab's post case a hard
   assertion.
2. **Feel pass on real hardware:** frame time on a GPU, then hit-stop, spark size, impact sound
   layering and the camera impulse against the fight capture; an attack telegraph flash on the
   wind-up.
3. **The ally's downed pose** held at a kneel (`holdAt` on the clip def) and an ally health bar
   beside the player's instead of toasts.
4. **Remaining visual polish:** foot planting on slopes (ankle IK only), the enemy's hood clipping
   at the shoulders in the recoil; a fight GIF of the ring for the README when the capture harness
   can afford it.
