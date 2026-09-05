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
