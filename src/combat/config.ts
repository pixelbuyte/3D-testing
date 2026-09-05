/**
 * Every tunable number in combat, in one place.
 *
 * Damage is applied by events on the animation timeline and hits are found by sweeping the blade
 * between frames, so none of these depend on the frame rate. Times are seconds, distances metres.
 */
export const COMBAT = {
  player: {
    maxHealth: 100,
    /** seconds after taking a hit during which the player cannot be hit again */
    hurtCooldown: 0.45,
    /** invulnerable from the start of the dodge for this long */
    dodgeInvulnerable: 0.25,
    /** damage per attack, by the clip name the director plays */
    damage: { slash1: 12, slash2: 14, slash3: 18, heavy: 28 } as Record<string, number>,
  },
  enemy: {
    maxHealth: { grunt: 65, blade: 65, elite: 110 } as Record<string, number>,
    /** enemy attack damage by clip */
    damage: { enemyAttack: 12, enemyAttack2: 14, enemyHeavy: 18 } as Record<string, number>,
    /** how close the enemy wants to be before it commits to a swing */
    attackRange: 1.9,
    /** where it stands while waiting for its turn */
    holdRange: 2.6,
    /** seconds between attacks, plus a random spread */
    cooldown: 1.4,
    cooldownSpread: 0.8,
    /** the enemy notices the player inside this radius */
    alertRadius: 14,
    /** chance a light hit interrupts a wind-up */
    staggerOnWindup: 0.5,
  },
  ally: {
    maxHealth: 120,
    damage: { nunCombo: 8, nunFlourish: 14 } as Record<string, number>,
  },
  blade: {
    /**
     * While an attack's damage window is pending or open, the animation is advanced in steps no
     * longer than this and the blade is sampled after each one, so the swept path follows the clip
     * at 60 Hz whatever the frame rate — two poses a tenth of a second apart do not describe a swing.
     */
    sampleStep: 1 / 60,
    /** at most this many animation samples per frame (dt is clamped by the engine anyway) */
    maxSamples: 12,
    /** the sweep between two samples is split so that no sub-step moves the tip further than this */
    maxSubStep: 0.12,
    /** hit tolerance added to the target's capsule radius: half the blade's thickness plus a little */
    thickness: 0.06,
    /** cosine of the widest angle off the attacker's facing a target may sit and still be hit */
    minFacingDot: -0.2,
  },
  hurtbox: {
    /**
     * body capsule: radius and the segment from the ground up. 0.30 is the shoulder half-width
     * plus a hand's breadth — a cut that visibly clears the body must not count, and the blade is
     * sampled at 60 Hz whatever the frame rate, so the capsule no longer has to make up for
     * missed samples.
     */
    radius: 0.30,
    bottom: 0.15,
    top: 1.65,
  },
  feel: {
    hitStopLight: 0.035,
    hitStopHeavy: 0.06,
    hitStopHurt: 0.045,
    /** camera impulse on landing a hit, 0..1 */
    shakeLight: 0.35,
    shakeHeavy: 0.7,
    shakeHurt: 0.8,
  },
} as const;

export type AttackName = keyof typeof COMBAT.player.damage;
