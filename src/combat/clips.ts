import type { Clip } from './anim';

/**
 * Hand-authored pose clips.
 *
 * Conventions, because euler angles on a hanging limb are easy to get backwards:
 *   - limbs (arms, legs) point down their local -Y, so +X swings them FORWARD.
 *   - the spine points up its local +Y, so -X leans it forward and +Z leans it left.
 *   - elbows bend with +X on the forearm; knees bend with -X on the shin.
 *   - on the LEFT arm, +Z pulls inward across the body; on the right arm, -Z does.
 *
 * Every strike is built as anticipation -> accelerate -> impact -> follow-through -> recover, with
 * the easing carrying the timing: `snap` overshoots into the impact key, `settle` lets the limb
 * spring back rather than sliding home linearly.
 */

// ---------------------------------------------------------------- locomotion

/**
 * Relaxed carry: blade low and forward in the right hand, off-hand free, weight easy.
 * The off-hand is released here so the IK doesn't drag the left arm across the body.
 */
export const IDLE: Clip = {
  name: 'idle', dur: 4.0, loop: true, mask: 'full', offHandFree: true,
  keys: [
    { t: 0, ease: 'inOut', pose: {
      hips: [0, -10, 0], spine: [-2, 4, 1], chest: [-1, 6, 0], head: [2, -7, 0],
      thighL: [8, 8, -3], shinL: [-12, 0, 0], footL: [0, -8, 0],
      thighR: [-6, -7, 3], shinR: [-14, 0, 0], footR: [0, 12, 0],
      upperArmR: [12, 6, -6], forearmR: [10, 0, 0], handR: [-24, 0, -8],
      upperArmL: [4, 0, -4], forearmL: [26, 0, 0], handL: [0, 0, 4],
    } },
    { t: 0.5, ease: 'inOut', pose: {
      hips: [0, -10, 0], spine: [-3, 4, 1], chest: [0, 6, 0], head: [0, -4, 0],
      thighL: [9, 8, -3], shinL: [-13, 0, 0], footL: [0, -8, 0],
      thighR: [-7, -7, 3], shinR: [-15, 0, 0], footR: [0, 12, 0],
      upperArmR: [11, 6, -7], forearmR: [12, 0, 0], handR: [-26, 0, -8],
      upperArmL: [5, 0, -5], forearmL: [28, 0, 0], handL: [0, 0, 4],
    } },
    { t: 1, ease: 'inOut', pose: {
      hips: [0, -10, 0], spine: [-2, 4, 1], chest: [-1, 6, 0], head: [2, -7, 0],
      thighL: [8, 8, -3], shinL: [-12, 0, 0], footL: [0, -8, 0],
      thighR: [-6, -7, 3], shinR: [-14, 0, 0], footR: [0, 12, 0],
      upperArmR: [12, 6, -6], forearmR: [10, 0, 0], handR: [-24, 0, -8],
      upperArmL: [4, 0, -4], forearmL: [26, 0, 0], handL: [0, 0, 4],
    } },
  ],
};

/**
 * Chudan: weight low, blade forward at chest height, both hands on the tsuka (the left is solved
 * onto the grip by IK). The stance you hold when something is coming at you.
 */
export const GUARD: Clip = {
  name: 'guard', dur: 2.6, loop: true, mask: 'full',
  keys: [
    { t: 0, ease: 'inOut', pose: {
      hips: [0, -30, 0], spine: [-8, 12, 2], chest: [-4, 14, 0], head: [3, -20, 0],
      thighL: [24, 16, -5], shinL: [-34, 0, 0], footL: [0, -14, 0],
      thighR: [-16, -14, 5], shinR: [-38, 0, 0], footR: [0, 16, 0],
      upperArmR: [28, 16, -24], forearmR: [40, 0, 0], handR: [-42, 0, -6],
      upperArmL: [36, -10, 30], forearmL: [70, 0, 0], handL: [0, 0, 10],
    } },
    { t: 0.5, ease: 'inOut', pose: {
      hips: [0, -29, 0], spine: [-9, 12, 2], chest: [-3, 14, 0], head: [1, -18, 0],
      thighL: [26, 16, -5], shinL: [-36, 0, 0], footL: [0, -14, 0],
      thighR: [-17, -14, 5], shinR: [-40, 0, 0], footR: [0, 16, 0],
      upperArmR: [26, 16, -25], forearmR: [42, 0, 0], handR: [-43, 0, -6],
      upperArmL: [34, -10, 31], forearmL: [72, 0, 0], handL: [0, 0, 10],
    } },
    { t: 1, ease: 'inOut', pose: {
      hips: [0, -30, 0], spine: [-8, 12, 2], chest: [-4, 14, 0], head: [3, -20, 0],
      thighL: [24, 16, -5], shinL: [-34, 0, 0], footL: [0, -14, 0],
      thighR: [-16, -14, 5], shinR: [-38, 0, 0], footR: [0, 16, 0],
      upperArmR: [28, 16, -24], forearmR: [40, 0, 0], handR: [-42, 0, -6],
      upperArmL: [36, -10, 30], forearmL: [70, 0, 0], handL: [0, 0, 10],
    } },
  ],
};

/** One full stride = one clip cycle: contact, pass, contact, pass. */
export const WALK: Clip = {
  name: 'walk', dur: 1, loop: true, mask: 'full', offHandFree: true,
  keys: [
    { t: 0, ease: 'inOut', pose: {
      hips: [0, -6, 0], spine: [-5, 3, 0], chest: [-2, -3, 0], head: [2, 0, 0],
      thighL: [26, 2, -2], shinL: [-12, 0, 0], footL: [-6, 0, 0],
      thighR: [-22, -2, 2], shinR: [-26, 0, 0], footR: [18, 0, 0],
      upperArmR: [4, 4, -8], forearmR: [14, 0, 0], handR: [-4, 0, -8],
      upperArmL: [46, 0, 24], forearmL: [72, 0, 0],
    } },
    { t: 0.25, ease: 'inOut', pose: {
      hips: [0, 0, 0], spine: [-6, 0, 0], chest: [-3, 0, 0], head: [2, 0, 0],
      thighL: [4, 2, -2], shinL: [-8, 0, 0], footL: [2, 0, 0],
      thighR: [2, -2, 2], shinR: [-42, 0, 0], footR: [20, 0, 0],
      upperArmR: [-2, 4, -8], forearmR: [16, 0, 0], handR: [-4, 0, -8],
      upperArmL: [40, 0, 24], forearmL: [66, 0, 0],
    } },
    { t: 0.5, ease: 'inOut', pose: {
      hips: [0, 6, 0], spine: [-5, -3, 0], chest: [-2, 3, 0], head: [2, 0, 0],
      thighL: [-22, 2, -2], shinL: [-26, 0, 0], footL: [18, 0, 0],
      thighR: [26, -2, 2], shinR: [-12, 0, 0], footR: [-6, 0, 0],
      upperArmR: [-8, 4, -8], forearmR: [18, 0, 0], handR: [-4, 0, -8],
      upperArmL: [34, 0, 24], forearmL: [58, 0, 0],
    } },
    { t: 0.75, ease: 'inOut', pose: {
      hips: [0, 0, 0], spine: [-6, 0, 0], chest: [-3, 0, 0], head: [2, 0, 0],
      thighL: [2, 2, -2], shinL: [-42, 0, 0], footL: [20, 0, 0],
      thighR: [4, -2, 2], shinR: [-8, 0, 0], footR: [2, 0, 0],
      upperArmR: [-2, 4, -8], forearmR: [16, 0, 0], handR: [-4, 0, -8],
      upperArmL: [40, 0, 24], forearmL: [66, 0, 0],
    } },
    { t: 1, ease: 'inOut', pose: {
      hips: [0, -6, 0], spine: [-5, 3, 0], chest: [-2, -3, 0], head: [2, 0, 0],
      thighL: [26, 2, -2], shinL: [-12, 0, 0], footL: [-6, 0, 0],
      thighR: [-22, -2, 2], shinR: [-26, 0, 0], footR: [18, 0, 0],
      upperArmR: [4, 4, -8], forearmR: [14, 0, 0], handR: [-4, 0, -8],
      upperArmL: [46, 0, 24], forearmL: [72, 0, 0],
    } },
  ],
  events: [{ t: 0.02, name: 'step' }, { t: 0.52, name: 'step' }],
};

/** Longer stride, deeper forward lean, bigger counter-rotation through the shoulders. */
export const RUN: Clip = {
  name: 'run', dur: 1, loop: true, mask: 'full', offHandFree: true,
  keys: [
    { t: 0, ease: 'out', pose: {
      hips: [0, -12, 0], spine: [-14, 6, 0], chest: [-6, -8, 0], head: [10, 0, 0],
      thighL: [48, 3, -3], shinL: [-24, 0, 0], footL: [-12, 0, 0],
      thighR: [-34, -3, 3], shinR: [-64, 0, 0], footR: [26, 0, 0],
      upperArmR: [-6, 4, -12], forearmR: [18, 0, 0], handR: [12, 0, -8],
      upperArmL: [74, 0, 26], forearmL: [96, 0, 0],
    } },
    { t: 0.25, ease: 'inOut', pose: {
      hips: [0, 0, 0], spine: [-16, 0, 0], chest: [-7, 0, 0], head: [11, 0, 0],
      thighL: [10, 3, -3], shinL: [-14, 0, 0], footL: [4, 0, 0],
      thighR: [8, -3, 3], shinR: [-96, 0, 0], footR: [30, 0, 0],
      upperArmR: [-14, 4, -12], forearmR: [22, 0, 0], handR: [12, 0, -8],
      upperArmL: [50, 0, 26], forearmL: [88, 0, 0],
    } },
    { t: 0.5, ease: 'out', pose: {
      hips: [0, 12, 0], spine: [-14, -6, 0], chest: [-6, 8, 0], head: [10, 0, 0],
      thighL: [-34, 3, -3], shinL: [-64, 0, 0], footL: [26, 0, 0],
      thighR: [48, -3, 3], shinR: [-24, 0, 0], footR: [-12, 0, 0],
      upperArmR: [-22, 4, -12], forearmR: [26, 0, 0], handR: [12, 0, -8],
      upperArmL: [22, 0, 26], forearmL: [82, 0, 0],
    } },
    { t: 0.75, ease: 'inOut', pose: {
      hips: [0, 0, 0], spine: [-16, 0, 0], chest: [-7, 0, 0], head: [11, 0, 0],
      thighL: [8, 3, -3], shinL: [-96, 0, 0], footL: [30, 0, 0],
      thighR: [10, -3, 3], shinR: [-14, 0, 0], footR: [4, 0, 0],
      upperArmR: [-14, 4, -12], forearmR: [22, 0, 0], handR: [12, 0, -8],
      upperArmL: [50, 0, 26], forearmL: [88, 0, 0],
    } },
    { t: 1, ease: 'out', pose: {
      hips: [0, -12, 0], spine: [-14, 6, 0], chest: [-6, -8, 0], head: [10, 0, 0],
      thighL: [48, 3, -3], shinL: [-24, 0, 0], footL: [-12, 0, 0],
      thighR: [-34, -3, 3], shinR: [-64, 0, 0], footR: [26, 0, 0],
      upperArmR: [-6, 4, -12], forearmR: [18, 0, 0], handR: [12, 0, -8],
      upperArmL: [74, 0, 26], forearmL: [96, 0, 0],
    } },
  ],
  events: [{ t: 0.02, name: 'step' }, { t: 0.52, name: 'step' }],
};

// ---------------------------------------------------------------- katana

/** Diagonal cut, high right to low left. Opens the combo. */
export const SLASH_1: Clip = {
  name: 'slash1', dur: 0.52, mask: 'upper', lunge: 0.9,
  keys: [
    // anticipation: blade cocks back over the right shoulder, chest winds away
    { t: 0, ease: 'out', pose: {
      spine: [-4, 6, 0], chest: [-2, 8, 0], head: [3, -8, 0],
      upperArmR: [40, 6, -10], forearmR: [72, 0, 0], handR: [0, 0, -10],
      upperArmL: [44, -8, 26], forearmL: [80, 0, 0],
    } },
    { t: 0.26, ease: 'in', pose: {
      spine: [-2, 26, -4], chest: [0, 24, -3], head: [0, 6, 0],
      upperArmR: [-38, 30, -46], forearmR: [96, 0, 0], handR: [0, 0, -24],
      upperArmL: [10, 10, 40], forearmL: [104, 0, 0],
    } },
    // impact: the blade is through the target, torso has rotated fully across
    { t: 0.52, ease: 'snap', pose: {
      spine: [-10, -22, 8], chest: [-6, -20, 6], head: [4, -26, 0],
      upperArmR: [96, -22, 30], forearmR: [26, 0, 0], handR: [0, 0, 6],
      upperArmL: [78, 4, 44], forearmL: [58, 0, 0],
    } },
    // follow-through past the line, then settle back to guard
    { t: 0.72, ease: 'settle', pose: {
      spine: [-12, -30, 10], chest: [-7, -26, 8], head: [4, -30, 0],
      upperArmR: [110, -28, 40], forearmR: [16, 0, 0], handR: [0, 0, 10],
      upperArmL: [88, 6, 48], forearmL: [46, 0, 0],
    } },
    { t: 1, ease: 'out', pose: {
      spine: [-7, 10, 2], chest: [-4, 12, 0], head: [4, -16, 0],
      upperArmR: [58, 10, -18], forearmR: [88, 0, 0], handR: [0, 0, -14],
      upperArmL: [62, -12, 34], forearmL: [96, 0, 0],
    } },
  ],
  events: [{ t: 0.30, name: 'swing' }, { t: 0.40, name: 'hitOpen' }, { t: 0.60, name: 'hitClose' }],
};

/** The return cut: horizontal, low left back to high right. */
export const SLASH_2: Clip = {
  name: 'slash2', dur: 0.48, mask: 'upper', lunge: 0.7,
  keys: [
    { t: 0, ease: 'out', pose: {
      spine: [-10, -22, 8], chest: [-6, -20, 6], head: [4, -22, 0],
      upperArmR: [96, -22, 30], forearmR: [26, 0, 0],
      upperArmL: [78, 4, 44], forearmL: [58, 0, 0],
    } },
    { t: 0.22, ease: 'in', pose: {
      spine: [-6, -34, 10], chest: [-4, -30, 8], head: [2, -30, 0],
      upperArmR: [84, -40, 44], forearmR: [70, 0, 0],
      upperArmL: [70, -10, 56], forearmL: [90, 0, 0],
    } },
    { t: 0.5, ease: 'snap', pose: {
      spine: [-6, 34, -8], chest: [-2, 30, -6], head: [0, 30, 0],
      upperArmR: [50, 44, -50], forearmR: [30, 0, 0],
      upperArmL: [40, 22, 10], forearmL: [66, 0, 0],
    } },
    { t: 0.7, ease: 'settle', pose: {
      spine: [-4, 40, -10], chest: [-1, 34, -7], head: [0, 34, 0],
      upperArmR: [40, 52, -58], forearmR: [22, 0, 0],
      upperArmL: [32, 26, 4], forearmL: [58, 0, 0],
    } },
    { t: 1, ease: 'out', pose: {
      spine: [-7, 10, 2], chest: [-4, 12, 0], head: [4, -16, 0],
      upperArmR: [58, 10, -18], forearmR: [88, 0, 0],
      upperArmL: [62, -12, 34], forearmL: [96, 0, 0],
    } },
  ],
  events: [{ t: 0.26, name: 'swing' }, { t: 0.36, name: 'hitOpen' }, { t: 0.58, name: 'hitClose' }],
};

/** Combo finisher: a rising cut that carries the whole body forward. */
export const SLASH_3: Clip = {
  name: 'slash3', dur: 0.78, mask: 'full', lunge: 1.5,
  keys: [
    { t: 0, ease: 'out', pose: {
      hips: [0, 24, 0], spine: [-6, 22, -6], chest: [-2, 20, -4], head: [0, 12, 0],
      thighL: [16, 12, -3], shinL: [-26, 0, 0], thighR: [-12, -10, 3], shinR: [-30, 0, 0],
      upperArmR: [50, 40, -50], forearmR: [30, 0, 0],
      upperArmL: [40, 20, 10], forearmL: [66, 0, 0],
    } },
    // deep coil: weight drops onto the back leg, blade drops to the right hip
    { t: 0.26, ease: 'in', pose: {
      hips: [0, 40, 0], spine: [-16, 30, -10], chest: [-8, 26, -6], head: [8, 4, 0],
      thighL: [44, 14, -3], shinL: [-52, 0, 0], thighR: [-16, -12, 3], shinR: [-46, 0, 0],
      upperArmR: [16, 46, -34], forearmR: [56, 0, 0],
      upperArmL: [24, 26, 24], forearmL: [78, 0, 0],
    } },
    // the cut: everything unwinds up and across to the left
    { t: 0.54, ease: 'snap', pose: {
      hips: [0, -30, 0], spine: [6, -30, 10], chest: [4, -26, 8], head: [-6, -18, 0],
      thighL: [10, -10, -3], shinL: [-14, 0, 0], thighR: [-30, 8, 3], shinR: [-24, 0, 0],
      upperArmR: [-62, -26, 34], forearmR: [24, 0, 0],
      upperArmL: [-36, -10, 40], forearmL: [50, 0, 0],
    } },
    { t: 0.74, ease: 'settle', pose: {
      hips: [0, -36, 0], spine: [8, -36, 12], chest: [5, -30, 9], head: [-8, -22, 0],
      thighL: [6, -12, -3], shinL: [-12, 0, 0], thighR: [-34, 10, 3], shinR: [-20, 0, 0],
      upperArmR: [-78, -32, 42], forearmR: [16, 0, 0],
      upperArmL: [-48, -14, 46], forearmL: [40, 0, 0],
    } },
    { t: 1, ease: 'out', pose: {
      hips: [0, -26, 0], spine: [-7, 10, 2], chest: [-4, 12, 0], head: [4, -16, 0],
      thighL: [20, 14, -4], shinL: [-30, 0, 0], thighR: [-14, -12, 4], shinR: [-34, 0, 0],
      upperArmR: [58, 10, -18], forearmR: [88, 0, 0],
      upperArmL: [62, -12, 34], forearmL: [96, 0, 0],
    } },
  ],
  events: [{ t: 0.30, name: 'swing' }, { t: 0.44, name: 'hitOpen' }, { t: 0.66, name: 'hitClose' }],
};

/** Heavy overhead. Long, readable wind-up; the payoff is the pause before it lands. */
export const HEAVY: Clip = {
  name: 'heavy', dur: 1.05, mask: 'full', lunge: 1.9,
  keys: [
    { t: 0, ease: 'out', pose: {
      hips: [0, -20, 0], spine: [-6, 8, 0], chest: [-3, 10, 0], head: [3, -12, 0],
      thighL: [18, 12, -4], shinL: [-28, 0, 0], thighR: [-12, -10, 4], shinR: [-32, 0, 0],
      upperArmR: [58, 10, -18], forearmR: [88, 0, 0],
      upperArmL: [62, -12, 34], forearmL: [96, 0, 0],
    } },
    // full extension overhead, back arched, front foot lifting — the anticipation everyone reads
    { t: 0.38, ease: 'inOut', pose: {
      hips: [0, 18, 0], spine: [12, 22, -6], chest: [8, 18, -4], head: [-10, 8, 0],
      thighL: [30, 12, -4], shinL: [-40, 0, 0], thighR: [-20, -10, 4], shinR: [-24, 0, 0],
      upperArmR: [-118, 12, -20], forearmR: [24, 0, 0],
      upperArmL: [-112, -12, 26], forearmL: [30, 0, 0],
    } },
    { t: 0.5, ease: 'in', pose: {
      hips: [0, 20, 0], spine: [16, 24, -6], chest: [10, 20, -4], head: [-12, 8, 0],
      thighL: [34, 12, -4], shinL: [-44, 0, 0], thighR: [-22, -10, 4], shinR: [-22, 0, 0],
      upperArmR: [-128, 12, -20], forearmR: [18, 0, 0],
      upperArmL: [-122, -12, 26], forearmL: [24, 0, 0],
    } },
    // impact: the whole body folds into the cut and the front knee drops
    { t: 0.66, ease: 'snap', pose: {
      hips: [0, -12, 0], spine: [-30, -6, 2], chest: [-16, -6, 0], head: [16, -6, 0],
      thighL: [58, 12, -4], shinL: [-72, 0, 0], thighR: [-26, -10, 4], shinR: [-40, 0, 0],
      upperArmR: [78, 4, -6], forearmR: [16, 0, 0],
      upperArmL: [80, -6, 22], forearmL: [20, 0, 0],
    } },
    { t: 0.8, ease: 'settle', pose: {
      hips: [0, -14, 0], spine: [-34, -8, 3], chest: [-18, -7, 0], head: [18, -8, 0],
      thighL: [62, 12, -4], shinL: [-78, 0, 0], thighR: [-28, -10, 4], shinR: [-42, 0, 0],
      upperArmR: [86, 4, -4], forearmR: [12, 0, 0],
      upperArmL: [88, -6, 20], forearmL: [16, 0, 0],
    } },
    { t: 1, ease: 'out', pose: {
      hips: [0, -26, 0], spine: [-7, 10, 2], chest: [-4, 12, 0], head: [4, -16, 0],
      thighL: [20, 14, -4], shinL: [-30, 0, 0], thighR: [-14, -12, 4], shinR: [-34, 0, 0],
      upperArmR: [58, 10, -18], forearmR: [88, 0, 0],
      upperArmL: [62, -12, 34], forearmL: [96, 0, 0],
    } },
  ],
  events: [{ t: 0.40, name: 'chargeUp' }, { t: 0.52, name: 'swingHeavy' }, { t: 0.60, name: 'hitOpen' }, { t: 0.80, name: 'hitClose' }],
};

/** A low, fast evade — crouch, push off, land absorbing. */
export const DODGE: Clip = {
  name: 'dodge', dur: 0.46, mask: 'full', ground: false,
  keys: [
    { t: 0, ease: 'in', pose: {
      hips: [0, -20, 0], spine: [-6, 8, 0], chest: [-3, 10, 0], head: [3, -12, 0],
      thighL: [20, 12, -4], shinL: [-30, 0, 0], thighR: [-14, -10, 4], shinR: [-34, 0, 0],
      upperArmR: [58, 10, -18], forearmR: [88, 0, 0], upperArmL: [62, -12, 34], forearmL: [96, 0, 0],
    } },
    // tuck
    { t: 0.3, ease: 'out', pose: {
      hips: [0, -16, 0], spine: [-34, 6, 0], chest: [-20, 8, 0], head: [22, -10, 0],
      thighL: [86, 12, -6], shinL: [-104, 0, 0], thighR: [64, -10, 6], shinR: [-116, 0, 0],
      upperArmR: [104, 12, -30], forearmR: [116, 0, 0], upperArmL: [108, -14, 44], forearmL: [120, 0, 0],
    } },
    // land, absorbing
    { t: 0.62, ease: 'settle', pose: {
      hips: [0, -22, 0], spine: [-20, 8, 0], chest: [-12, 10, 0], head: [14, -12, 0],
      thighL: [46, 12, -5], shinL: [-64, 0, 0], thighR: [-4, -10, 5], shinR: [-58, 0, 0],
      upperArmR: [74, 10, -22], forearmR: [96, 0, 0], upperArmL: [78, -12, 38], forearmL: [102, 0, 0],
    } },
    { t: 1, ease: 'out', pose: {
      hips: [0, -26, 0], spine: [-7, 10, 2], chest: [-4, 12, 0], head: [4, -16, 0],
      thighL: [20, 14, -4], shinL: [-30, 0, 0], thighR: [-14, -12, 4], shinR: [-34, 0, 0],
      upperArmR: [58, 10, -18], forearmR: [88, 0, 0], upperArmL: [62, -12, 34], forearmL: [96, 0, 0],
    } },
  ],
  events: [{ t: 0.02, name: 'dodge' }, { t: 0.58, name: 'step' }],
};

/** Flinch. Short, sharp, and out of the way fast so it never eats a combo. */
export const HIT_REACT: Clip = {
  name: 'hit', dur: 0.34, mask: 'upper', offHandFree: true,
  keys: [
    { t: 0, ease: 'out', pose: {} },
    { t: 0.22, ease: 'out', pose: {
      spine: [10, -12, -6], chest: [8, -10, -5], head: [-12, 14, 6],
      upperArmR: [24, 0, -30], forearmR: [56, 0, 0],
      upperArmL: [28, 0, 44], forearmL: [62, 0, 0],
    } },
    { t: 1, ease: 'settle', pose: {} },
  ],
};

/** Collapse. Ends folded on the ground so the dissolve has something to eat. */
export const DEATH: Clip = {
  name: 'death', dur: 1.15, mask: 'full', ground: false, offHandFree: true,
  keys: [
    { t: 0, ease: 'out', pose: {} },
    { t: 0.2, ease: 'out', pose: {
      spine: [16, -8, -8], chest: [10, -6, -6], head: [-16, 10, 8],
      thighL: [-10, 0, 0], thighR: [-6, 0, 0],
      upperArmR: [10, 0, -40], forearmR: [30, 0, 0], upperArmL: [14, 0, 52], forearmL: [34, 0, 0],
    } },
    // knees go first
    { t: 0.52, ease: 'in', pose: {
      hips: [-14, -10, 0], spine: [-26, -14, -10], chest: [-14, -10, -8], head: [26, 12, 10],
      thighL: [78, 4, -6], shinL: [-112, 0, 0], thighR: [72, -4, 6], shinR: [-118, 0, 0],
      upperArmR: [40, 0, -18], forearmR: [70, 0, 0], upperArmL: [44, 0, 30], forearmL: [74, 0, 0],
    } },
    { t: 1, ease: 'settle', pose: {
      hips: [-58, -12, 0], spine: [-44, -16, -12], chest: [-20, -12, -10], head: [34, 14, 12],
      thighL: [92, 6, -8], shinL: [-126, 0, 0], thighR: [88, -6, 8], shinR: [-130, 0, 0],
      upperArmR: [70, 0, -10], forearmR: [40, 0, 0], upperArmL: [74, 0, 20], forearmL: [44, 0, 0],
    } },
  ],
  events: [{ t: 0.5, name: 'fall' }],
};

// ---------------------------------------------------------------- nunchucks

/** Loose ready stance, the held baton low at the right hip; the free baton hangs and sways. */
export const NUN_IDLE: Clip = {
  name: 'nunIdle', dur: 3.2, loop: true, mask: 'full',
  keys: [
    { t: 0, ease: 'inOut', pose: {
      hips: [0, 14, 0], spine: [-5, -6, -1], chest: [-2, -8, 0], head: [2, 12, 0],
      thighL: [14, -8, -4], shinL: [-22, 0, 0], footL: [0, -10, 0],
      thighR: [-8, 8, 4], shinR: [-20, 0, 0], footR: [0, 14, 0],
      upperArmR: [6, 0, -12], forearmR: [46, 0, 0], handR: [-20, 30, 0],
      upperArmL: [30, 0, 8], forearmL: [64, 0, 0], handL: [0, 0, 6],
    } },
    { t: 0.5, ease: 'inOut', pose: {
      hips: [0, 12, 0], spine: [-6, -4, -1], chest: [-1, -7, 0], head: [1, 9, 0],
      thighL: [15, -8, -4], shinL: [-24, 0, 0], footL: [0, -10, 0],
      thighR: [-9, 8, 4], shinR: [-21, 0, 0], footR: [0, 14, 0],
      upperArmR: [4, 0, -14], forearmR: [50, 0, 0], handR: [-22, 20, 0],
      upperArmL: [28, 0, 10], forearmL: [60, 0, 0], handL: [0, 0, 6],
    } },
    { t: 1, ease: 'inOut', pose: {
      hips: [0, 14, 0], spine: [-5, -6, -1], chest: [-2, -8, 0], head: [2, 12, 0],
      thighL: [14, -8, -4], shinL: [-22, 0, 0], footL: [0, -10, 0],
      thighR: [-8, 8, 4], shinR: [-20, 0, 0], footR: [0, 14, 0],
      upperArmR: [6, 0, -12], forearmR: [46, 0, 0], handR: [-20, 30, 0],
      upperArmL: [30, 0, 8], forearmL: [64, 0, 0], handL: [0, 0, 6],
    } },
  ],
};

/** A flurry: three fast circular strikes with the body turning through each one. */
export const NUN_COMBO: Clip = {
  name: 'nunCombo', dur: 0.92, mask: 'full', lunge: 1.1,
  keys: [
    { t: 0, ease: 'in', pose: {
      hips: [0, 16, 0], spine: [-8, -8, 0], chest: [-4, -10, 0], head: [2, 12, 0],
      thighL: [16, -8, -3], shinL: [-24, 0, 0], thighR: [-10, 8, 3], shinR: [-28, 0, 0],
      upperArmR: [-40, 0, -36], forearmR: [120, 0, 0], handR: [0, 0, 0],
      upperArmL: [28, 0, 30], forearmL: [42, 0, 0],
    } },
    { t: 0.24, ease: 'snap', pose: {
      hips: [0, -18, 0], spine: [-12, 18, 6], chest: [-6, 16, 4], head: [4, -14, 0],
      thighL: [24, 6, -3], shinL: [-30, 0, 0], thighR: [-16, -6, 3], shinR: [-24, 0, 0],
      upperArmR: [86, -14, 26], forearmR: [40, 0, 0], handR: [0, 260, 0],
      upperArmL: [50, 8, 36], forearmL: [70, 0, 0],
    } },
    { t: 0.48, ease: 'snap', pose: {
      hips: [0, 22, 0], spine: [-10, -22, -6], chest: [-5, -18, -4], head: [4, 18, 0],
      thighL: [-14, -8, -3], shinL: [-26, 0, 0], thighR: [28, 8, 3], shinR: [-32, 0, 0],
      upperArmR: [-24, 18, -70], forearmR: [96, 0, 0], handR: [0, 520, 0],
      upperArmL: [16, -10, 60], forearmL: [88, 0, 0],
    } },
    { t: 0.74, ease: 'snap', pose: {
      hips: [0, -26, 0], spine: [-16, 26, 8], chest: [-8, 22, 6], head: [6, -20, 0],
      thighL: [34, 8, -3], shinL: [-42, 0, 0], thighR: [-20, -8, 3], shinR: [-30, 0, 0],
      upperArmR: [104, -20, 34], forearmR: [24, 0, 0], handR: [0, 800, 0],
      upperArmL: [66, 10, 40], forearmL: [58, 0, 0],
    } },
    { t: 1, ease: 'settle', pose: {
      hips: [0, 10, 0], spine: [-6, -6, 0], chest: [-3, -8, 0], head: [2, 10, 0],
      thighL: [10, -6, -3], shinL: [-18, 0, 0], thighR: [-6, 6, 3], shinR: [-22, 0, 0],
      upperArmR: [-30, 0, -40], forearmR: [110, 0, 0], handR: [0, 900, 0],
      upperArmL: [30, 0, 30], forearmL: [40, 0, 0],
    } },
  ],
  events: [
    { t: 0.10, name: 'swing' }, { t: 0.18, name: 'hitOpen' }, { t: 0.30, name: 'hitClose' },
    { t: 0.36, name: 'swing' }, { t: 0.42, name: 'hitOpen' }, { t: 0.54, name: 'hitClose' },
    { t: 0.62, name: 'swing' }, { t: 0.68, name: 'hitOpen' }, { t: 0.80, name: 'hitClose' },
  ],
};

/** Showing off between fights: a spinning hop with the chucks wrapped behind the back. */
export const NUN_FLOURISH: Clip = {
  name: 'nunFlourish', dur: 1.1, mask: 'full',
  keys: [
    { t: 0, ease: 'in', pose: {
      hips: [0, 10, 0], spine: [-6, -6, 0], chest: [-3, -8, 0],
      thighL: [10, -6, -3], shinL: [-18, 0, 0], thighR: [-6, 6, 3], shinR: [-22, 0, 0],
      upperArmR: [-30, 0, -40], forearmR: [110, 0, 0], upperArmL: [30, 0, 30], forearmL: [40, 0, 0],
    } },
    { t: 0.3, ease: 'out', pose: {
      hips: [0, 170, 0], spine: [-18, -20, 0], chest: [-8, -16, 0], head: [8, 20, 0],
      thighL: [72, -8, -6], shinL: [-96, 0, 0], thighR: [24, 8, 6], shinR: [-110, 0, 0],
      upperArmR: [-96, 0, -54], forearmR: [130, 0, 0], handR: [0, 400, 0],
      upperArmL: [-40, 0, 62], forearmL: [96, 0, 0],
    } },
    { t: 0.62, ease: 'snap', pose: {
      hips: [0, 350, 0], spine: [-10, 10, 0], chest: [-5, 8, 0], head: [4, -8, 0],
      thighL: [30, 6, -4], shinL: [-44, 0, 0], thighR: [-16, -6, 4], shinR: [-40, 0, 0],
      upperArmR: [40, 0, -50], forearmR: [96, 0, 0], handR: [0, 720, 0],
      upperArmL: [44, 0, 40], forearmL: [70, 0, 0],
    } },
    { t: 1, ease: 'settle', pose: {
      hips: [0, 370, 0], spine: [-6, -6, 0], chest: [-3, -8, 0], head: [2, 10, 0],
      thighL: [10, -6, -3], shinL: [-18, 0, 0], thighR: [-6, 6, 3], shinR: [-22, 0, 0],
      upperArmR: [-30, 0, -40], forearmR: [110, 0, 0], handR: [0, 900, 0],
      upperArmL: [30, 0, 30], forearmL: [40, 0, 0],
    } },
  ],
  events: [{ t: 0.3, name: 'step' }, { t: 0.62, name: 'step' }],
};

// ---------------------------------------------------------------- enemy

/** Hunched, arms loose — reads as wrong before it moves. */
export const ENEMY_IDLE: Clip = {
  name: 'enemyIdle', dur: 3.2, loop: true, mask: 'full',
  keys: [
    { t: 0, ease: 'inOut', pose: {
      hips: [0, 6, 0], spine: [-14, -4, 2], chest: [-8, -4, 1], head: [16, 6, -3],
      thighL: [12, 6, -5], shinL: [-22, 0, 0], thighR: [-8, -6, 5], shinR: [-18, 0, 0],
      upperArmR: [16, 0, -22], forearmR: [40, 0, 0], handR: [-34, 0, 0],
      upperArmL: [12, 0, 26], forearmL: [34, 0, 0],
    } },
    { t: 0.5, ease: 'inOut', pose: {
      hips: [0, 4, 0], spine: [-17, -3, 1], chest: [-10, -3, 0], head: [19, 4, -2],
      thighL: [13, 6, -5], shinL: [-24, 0, 0], thighR: [-9, -6, 5], shinR: [-19, 0, 0],
      upperArmR: [12, 0, -26], forearmR: [46, 0, 0], handR: [-36, 0, 0],
      upperArmL: [8, 0, 30], forearmL: [40, 0, 0],
    } },
    { t: 1, ease: 'inOut', pose: {
      hips: [0, 6, 0], spine: [-14, -4, 2], chest: [-8, -4, 1], head: [16, 6, -3],
      thighL: [12, 6, -5], shinL: [-22, 0, 0], thighR: [-8, -6, 5], shinR: [-18, 0, 0],
      upperArmR: [16, 0, -22], forearmR: [40, 0, 0], handR: [-34, 0, 0],
      upperArmL: [12, 0, 26], forearmL: [34, 0, 0],
    } },
  ],
};

/** Loping run — asymmetric, arms trailing, so it doesn't read like the player. */
export const ENEMY_RUN: Clip = {
  name: 'enemyRun', dur: 0.9, loop: true, mask: 'full', offHandFree: true,
  keys: [
    { t: 0, ease: 'out', pose: {
      hips: [0, -10, 0], spine: [-24, 5, 3], chest: [-10, -6, 2], head: [22, 2, -4],
      thighL: [44, 3, -4], shinL: [-28, 0, 0], footL: [-10, 0, 0],
      thighR: [-30, -3, 4], shinR: [-58, 0, 0], footR: [24, 0, 0],
      upperArmR: [-6, 0, -34], forearmR: [20, 0, 0], handR: [8, 0, 0], upperArmL: [40, 0, 40], forearmL: [86, 0, 0],
    } },
    { t: 0.25, ease: 'inOut', pose: {
      hips: [0, 0, 0], spine: [-26, 0, 2], chest: [-11, 0, 1], head: [23, 0, -3],
      thighL: [8, 3, -4], shinL: [-16, 0, 0], thighR: [6, -3, 4], shinR: [-88, 0, 0], footR: [28, 0, 0],
      upperArmR: [-14, 0, -34], forearmR: [20, 0, 0], handR: [8, 0, 0], upperArmL: [22, 0, 42], forearmL: [80, 0, 0],
    } },
    { t: 0.5, ease: 'out', pose: {
      hips: [0, 10, 0], spine: [-24, -5, 1], chest: [-10, 6, 0], head: [22, -2, -2],
      thighL: [-30, 3, -4], shinL: [-58, 0, 0], footL: [24, 0, 0],
      thighR: [44, -3, 4], shinR: [-28, 0, 0], footR: [-10, 0, 0],
      upperArmR: [-22, 0, -34], forearmR: [20, 0, 0], handR: [8, 0, 0], upperArmL: [-6, 0, 40], forearmL: [72, 0, 0],
    } },
    { t: 0.75, ease: 'inOut', pose: {
      hips: [0, 0, 0], spine: [-26, 0, 2], chest: [-11, 0, 1], head: [23, 0, -3],
      thighL: [6, 3, -4], shinL: [-88, 0, 0], footL: [28, 0, 0], thighR: [8, -3, 4], shinR: [-16, 0, 0],
      upperArmR: [-14, 0, -34], forearmR: [20, 0, 0], handR: [8, 0, 0], upperArmL: [22, 0, 42], forearmL: [80, 0, 0],
    } },
    { t: 1, ease: 'out', pose: {
      hips: [0, -10, 0], spine: [-24, 5, 3], chest: [-10, -6, 2], head: [22, 2, -4],
      thighL: [44, 3, -4], shinL: [-28, 0, 0], footL: [-10, 0, 0],
      thighR: [-30, -3, 4], shinR: [-58, 0, 0], footR: [24, 0, 0],
      upperArmR: [-6, 0, -34], forearmR: [20, 0, 0], handR: [8, 0, 0], upperArmL: [40, 0, 40], forearmL: [86, 0, 0],
    } },
  ],
  events: [{ t: 0.02, name: 'step' }, { t: 0.52, name: 'step' }],
};

/** Overhead chop with a long telegraph, so the player can learn to dodge it. */
export const ENEMY_ATTACK: Clip = {
  name: 'enemyAttack', dur: 1.0, mask: 'full', lunge: 1.0,
  keys: [
    { t: 0, ease: 'out', pose: {
      hips: [0, 6, 0], spine: [-14, -4, 2], chest: [-8, -4, 1], head: [16, 6, -3],
      thighL: [12, 6, -5], shinL: [-22, 0, 0], thighR: [-8, -6, 5], shinR: [-18, 0, 0],
      upperArmR: [16, 0, -22], forearmR: [40, 0, 0], upperArmL: [12, 0, 26], forearmL: [34, 0, 0],
    } },
    // the telegraph: arms up and back, weight loaded, held long enough to react to
    { t: 0.42, ease: 'inOut', pose: {
      hips: [0, 20, 0], spine: [14, 16, -4], chest: [10, 12, -2], head: [-14, 10, 0],
      thighL: [26, 8, -5], shinL: [-34, 0, 0], thighR: [-18, -8, 5], shinR: [-20, 0, 0],
      upperArmR: [-104, 10, -26], forearmR: [40, 0, 0], upperArmL: [-96, -10, 32], forearmL: [46, 0, 0],
    } },
    { t: 0.54, ease: 'in', pose: {
      hips: [0, 22, 0], spine: [18, 18, -4], chest: [12, 14, -2], head: [-16, 10, 0],
      upperArmR: [-116, 10, -26], forearmR: [34, 0, 0], upperArmL: [-108, -10, 32], forearmL: [40, 0, 0],
      thighL: [30, 8, -5], shinL: [-38, 0, 0], thighR: [-20, -8, 5], shinR: [-18, 0, 0],
    } },
    { t: 0.68, ease: 'snap', pose: {
      hips: [0, -8, 0], spine: [-34, -6, 3], chest: [-18, -6, 1], head: [24, -4, 0],
      thighL: [56, 8, -5], shinL: [-66, 0, 0], thighR: [-24, -8, 5], shinR: [-36, 0, 0],
      upperArmR: [80, 2, -8], forearmR: [18, 0, 0], upperArmL: [82, -4, 24], forearmL: [22, 0, 0],
    } },
    { t: 1, ease: 'settle', pose: {
      hips: [0, 6, 0], spine: [-14, -4, 2], chest: [-8, -4, 1], head: [16, 6, -3],
      thighL: [12, 6, -5], shinL: [-22, 0, 0], thighR: [-8, -6, 5], shinR: [-18, 0, 0],
      upperArmR: [16, 0, -22], forearmR: [40, 0, 0], upperArmL: [12, 0, 26], forearmL: [34, 0, 0],
    } },
  ],
  events: [{ t: 0.30, name: 'telegraph' }, { t: 0.56, name: 'swing' }, { t: 0.62, name: 'hitOpen' }, { t: 0.78, name: 'hitClose' }],
};

/** Staggered off balance by a hit. */
export const STAGGER: Clip = {
  name: 'stagger', dur: 0.42, mask: 'full',
  keys: [
    { t: 0, ease: 'out', pose: {} },
    { t: 0.24, ease: 'out', pose: {
      hips: [0, -8, 0], spine: [22, -16, -10], chest: [14, -12, -8], head: [-20, 18, 10],
      thighL: [-16, 0, -4], shinL: [-30, 0, 0], thighR: [10, 0, 4], shinR: [-44, 0, 0],
      upperArmR: [-14, 0, -46], forearmR: [40, 0, 0], upperArmL: [-8, 0, 58], forearmL: [46, 0, 0],
    } },
    { t: 1, ease: 'settle', pose: {} },
  ],
};

export const LOCOMOTION = { IDLE, GUARD, WALK, RUN };
