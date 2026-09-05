# Development log — Combat V1 session

Autonomous session, 2026-09-05. Goal: one extremely reliable 1v1 sword fight on the skinned
character pipeline, then (only if stable) 2–3 enemies and the nunchuck ally, then polish.

## 10:05 UTC — session start

**Starting point.** PR #1 merged (skinned player, procedural ally/enemies, distance+arc hit
detection, three staged encounters). Working branch fast-forwarded onto main.

**Plan.**
1. Hour 1: every fighter on the skinned pipeline (orange enemy GLB built by the same tool), the
   procedural rig retired; player state machine verified from the gameplay camera.
2. Hour 2: swept-blade hit detection with anticipation/active/recovery windows, hurt capsules,
   wall and facing checks, one-hit-per-swing, centralised combat config, debug hitbox overlay.
3. Hour 3: one orange enemy with a real state machine; 1v1 arena; contact feedback tuned.
4. Hour 4: 2–3 enemies + ally only if the 1v1 is stable.
5. Hour 5: QA, polish, performance, SESSION_REPORT.md.

**Testing harness.** Headless Chromium on SwiftShader (~1 fps rendered), so logic is tested by
stepping the simulation (`__ECHOES.simulate`) and visuals by screenshots from fixed cameras.

## 10:20 UTC — checkpoint 1

**Built.** Character build tool now produces three variants from one config (player navy/cyan,
enemy black/orange with the hood up, ally black with long hair); `makeSkinnedFighter` builds any
of them with the right weapon (katana or nunchucks on the fitted hand socket) and clip table. The
procedural rig, its IK and its animator are deleted: `src/combat` has one character system.
`src/combat/config.ts` holds every combat number. `src/combat/hitdetect.ts` sweeps the blade between
frames (sub-stepped by travel distance) against body capsules; `src/combat/debugdraw.ts` is the F2
overlay (capsules, sweeps green/red, contact points). The director now damages only from sweeps
during the clip's active window, once per swing per target, in front of the attacker, with a
line-of-sight ray to the contact point; dodge gives 0.25 s of invulnerability.

**Tested.** Bare-scene renders of all three variants (grip, palettes, nunchucks) pass. In-shrine
cast render and the three-encounter simulation + a 60/20/10-step frame-rate test are running.

**Bugs found / fixed.** Vite dev server had died during the idle gap (restarted; renders now use a
production preview on :4173 so source edits no longer reload pages mid-capture). A stale render
crashed for exactly that reason before the switch.

**FPS.** Not measured this block (SwiftShader ≈ 1 fps rendered; logic tested by stepping).

**Next.** Read the simulation results; rewrite the enemy loop as the specified state machine with
cooldowns and ranges from config; add the 1v1 arena hook.

## 10:50 UTC — checkpoint 2

**Built.** Enemy loop rewritten as the specified state machine (idle → alert → approach →
combatIdle → attack → recover → combatIdle; hit / stagger / dying), with ranges, cooldowns and the
alert radius from `COMBAT.enemy`; ring slots with hysteresis so waiting enemies hold position
instead of jittering. 1v1 arena hook (`__ECHOES.arena(hold, dist)`) that benches the ally, disarms
the staged encounters and spawns one orange enemy in front of the player; per-frame sweep trace
(`__ECHOES.trace`) for the lab scripts; F1 stats panel and F2 hitbox overlay wired to keys.

**Hit detection is now frame-rate independent.** The blade path is no longer rebuilt from two
poses a frame apart: while an attack's damage window is pending or open, the animation advances in
sub-steps no longer than 1/60 s (`COMBAT.blade.sampleStep`) and the blade is recorded after each,
in the root's own space; on placement the samples are laid along the root's motion for the frame
and swept in order (`Actor.pose/finish`, `Actor.bladeSweeps`, `Director.sweepAttack`). Each sweep
segment is still arc-aware and sub-divided by travel distance.

**Tested.** Hit lab (held enemy at 1.6 m and 2.3 m; light×3, heavy, three more lights; then the
same with the back turned) at 1/60, 1/30, 1/20 and 1/10 s steps: every case lands exactly
12/14/18 then the killing heavy, nothing lands with the back turned, no NaN. Before this block
1/20 lost the second hit and 1/10 landed nothing. AI duel (enemy fights back, scripted swings and
dodges) at 1/60 and 1/20: enemy dies (≈5 s / ≈13 s), no stuck state, no attacks after death, no
NaN; enemy blade lands 12 or 14 on the player as configured.

**Bugs found / fixed.** Root motion consumed one frame before the pose that produced it (split
`pose()`/`finish()`); `hitOpen` stuck after an interrupted attack; `hitClose` firing before the
frame's sweep (tail flag); hits testing enemies by array index in the FPS test after a reap (stable
ids); arena spawning inside an encounter trigger (encounters disarmed); a hit turning the held
dummy into an active enemy; sweep chord cutting inside the swing arc; and the coarse-step misses
above.

**FPS.** SwiftShader only this block (logic stepped); a real measurement waits for the production
build profile in hour 5.

**Next.** Switch hit/stagger clips to the sword-fighter flinch track; verify the 1v1 visually from
the gameplay camera with the F2 overlay (idle→attack, run→attack, combo, heavy, dodge, walls, kill
mid-animation); feel pass on hit-stop, spark, sound and camera impulse.
