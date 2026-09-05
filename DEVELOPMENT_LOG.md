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

## 15:20 UTC — checkpoint 3 (after a four-hour usage pause)

**Built.** Commit `7a7acb9` pushed and PR #2 opened for Combat V1. Hit reactions rebuilt: the
KayKit flinch retargets with both arms locked out sideways and the UAL2 knockback has the body
on the ground within 0.2 s, so neither can be a light-hit reaction. `hit` and `stagger` are now an
additive upper-body recoil layered on the stance (spine_01, spine_02, head; a sharp snap over the
first fifth, then an ease-out) inside `SkinnedAnimator`, with strength 1 / 0.34 s for a light hit
and 1.7 / 0.55 s for a stagger; the FSM's backward shove is unchanged. Line of sight is now an
exact segment test against the static colliders (`CollisionWorld.segmentBlocked`: slab test for
boxes, circle plus height range for cylinders) instead of a 0.5 m ray march that stepped over
thin posts. Tooling: `__ECHOES.simulate(sec, step, move)` steps the player controller together
with the fight, with a scripted movement intent, and `arena(hold, dist, place)` stages the duel at
explicit positions.

**Tested / testing.** Running now, one at a time (three concurrent SwiftShader captures timed
each other out): hit lab regression, AI duel, movement lab (attack while sprinting in, strafing
under enemy attacks, attacking while turning and with the back turned), wall lab (lantern pillar
between the fighters, open-ground control, torii post), slope lab (steepest walkable patch, enemy
uphill and downhill), and the hit-reaction sheet.

**Bugs found / fixed.** Both local servers had died during the pause (restarted). Ray-marched
line of sight could miss anything thinner than 0.5 m (replaced). `preview('hit')` mode added.

**FPS.** Still SwiftShader only; the production build profile comes with the session report.

**Next.** Read the lab results, fix what they show, re-render the 1v1 from the gameplay camera with
the F2 overlay, production build, SESSION_REPORT.md.

## 15:50 UTC — checkpoint 4

**Built.** Commits `df6c87b` and the recoil follow-up pushed to PR #2. The hit recoil now snaps
in over its first 15%, holds through 40% and eases out, with larger spine, chest and head angles
so it reads at gameplay distance. `__ECHOES.pause(on)` freezes the loop (the F2 overlay keeps
redrawing) so captures can read exact frames. README combat section rewritten for the skinned
pipeline and swept-blade hits; SESSION_REPORT.md drafted.

**Tested — the full lab batch passes at every step size** (details in the session report):
hit lab 12/14/18 + heavy at 1/60…1/10; AI duel ends in 4.9 s / 12.9 s with no stuck state, no
attacks after death, no NaN; movement lab (sprint-in swing, strafing under attack, turning swing,
back-turned swing) correct at 1/60 and 1/20; wall lab 0 damage through the 1.1 m lantern pillar
and full damage on open ground at both steps; slope lab (17° patch, enemy uphill and downhill)
full damage at both steps.

**Bugs found / fixed.** The first gameplay-camera fight capture showed a scripted player losing
90 HP while landing nothing after its second hit; a deterministic replay of the same script
(loop paused) showed a normal fight (one enemy hit taken, enemy dead at 2.95 s). The difference
was the capture's player standing still while the enemy stepped out of reach after every attack
and its dodge sliding *into* the swing at random phases: a script problem, not a combat one. The
capture script now closes the gap and dodges on the frame the enemy commits. Captures with the
full post-processing preset timed out on SwiftShader; they use the fast preset now.

**Known edge (documented, not fixed):** a swing whose contact point falls beside a 0.11 m torii
post is not blocked because the blade genuinely passes on that side; against very thin geometry
the per-swing outcome can differ between step sizes (12/0/18/28 vs 12/0/18/0). Thick walls are
consistent.

**FPS.** SwiftShader only; draw calls and triangles are read from the production build for the
report.

**Next.** Finish the gameplay-camera fight capture and the frozen-frame overlay and hit-reaction
sheets, assemble the GIF, replace the README combat plates, finish SESSION_REPORT.md, push.

## 16:05 UTC — session close

**Shipped.** PR #2 (Combat V1) was merged by pixelbuyte at 15:55 UTC; PR #3 carries the
session report, the gameplay-camera captures and the README plates.

**Verified visually.** Fight capture from the real third-person camera: the warrior closes on the
orange enemy, trades cuts, lands the heavy and finishes it by frame 12 (1.8 s of scripted time
plus the render loop), ending on 62 HP; sword in the hand throughout, both bodies on the stone.
Hit-reaction sheet at fixed phases: at 0.06 s all three bodies are already leaning back with the
head turned, at 0.12 s the recoil peaks (the staggered enemy furthest), by 0.30 s the light hit
has settled back into the stance while the stagger is still easing out. F2 overlay from the side:
both capsules and the blade's sweep chain fanning from over the head through the target's line.

**Not done, by the brief's own rule.** Multiple enemies and the ally on the new pipeline in a
live fight (hour 4) were not started: the 1v1 checklist was only completed in this final block.
They are items 1 and 2 of the next-session plan in `SESSION_REPORT.md`.

**FPS.** Not measurable here (SwiftShader). Draw calls 3,145 in the courtyard 1v1 at the medium
preset; bundle 242.9 kB + 1,408 kB PlayCanvas; GLBs ≈ 5 MB each.

## 20:25 UTC — checkpoint 5 (precision pass and the character look)

**Found.** The "pixelated" characters are the outfit atlas, not the mesh or the renderer: the
recolour masks were rasterised exactly on the UV islands, so every gutter between islands kept the
source atlas's pale colour. Bilinear filtering and every mip level read a texel or two past the
island edge, which put a bright speckled fringe on every panel of the outfit at any distance.
The tint masks are now grown into the gutters (nearest-part label propagation, `pad_masks` in
`tools/build-character.py`, working at 2048 before the 1024 output), the outfit JPEG is written at
quality 94, and the cloth normal map is softened (0.8 → 0.45) so the shading reads as clean
colour blocks like the reference plates. All three GLBs rebuilt.

**Built.** Attack ids on every `act()`, a damage log (attack id, attacker, target, damage, time;
`__ECHOES.hits()`), the anticipation / active / recovery phase from the animator, and the F1
panel now shows `attack #id  frames ACTIVE  window OPEN` plus the last four damage events. The hit
lab asserts that no (attack id, target) pair appears twice in the log. Code-review reuse
cleanups applied: one `spawnEnemy` for the three ways a fight starts (which also retires the
leftover purple trail on the preview enemy), one capsule-overlay submit for the live and the
frozen frame, one `BASE_CLIPS` table spread into the three variants, `wrapAngle` in math.ts used
by the animator, the soft-target and the sweep placement, `facingDot` in the soft-target, and the
damage-window events moved onto `Actor.windowEvent`. A shadowed `heavy` recompute in `landHit`
is deleted.

**Testing.** Hit lab (with the id assertion), AI duel and movement lab running against the
rebuilt GLBs; close-up render of the player at the high preset and the frozen-frame overlay
queued on the production build.

**20:35 addendum — second cause of the pixelated look.** The close-up render at the high preset
came out soft even with the fixed atlas: adaptive resolution had ratcheted the render scale down
to 60% (the medium preset starts at 80%, so 48% effective) because the SwiftShader frames were
over 20 ms — exactly what a mid-range GPU does at 1440p. The sharp dark fighters show the
upscale long before the fogged scenery does. The floor is now 85%, medium starts at 90%, and the
controller steps down only below ~45 fps and back up above ~62 fps (`src/rendering/postfx.ts`).
The capture scripts pin `scale=1` so renders judge the assets, not the frame rate.

**20:40 addendum — precision pass, capsule tightened.** With the blade sampled at 60 Hz whatever
the frame rate, the hurt capsule no longer has to cover missed samples: radius 0.38 → 0.30 m
(shoulder half-width plus a hand), blade tolerance 0.08 → 0.06 m. Hit lab: 1.6 m unchanged
(12 / 14 / 18 + heavy); 2.3 m now shows the first two light slashes falling visibly short and
landing 0, the lunging third and the heavy connecting — the light attacks' honest reach is
≈2.0 m from body centre (the wall lab's open-ground control at 2.05 m still lands 12 / 14 / 18 /
21). Identical at 1/60, 1/30, 1/20 and 1/10 s; no attack id damages the same target twice;
through the lantern pillar still 0 / 0 / 0 / 0. PR #3 merged; this goes out as a fresh PR.
