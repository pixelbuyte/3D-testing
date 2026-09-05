import type { Entity, StandardMaterial, Vec3 } from 'playcanvas';
import type { FighterAnimator } from './anim';
import type { WeaponBuild } from './weapons';

/**
 * What a fighter's body offers the actor and the combat director. Every body is a skinned
 * character built by tools/build-character.py and instantiated by src/combat/skinned.ts.
 */
export interface Fighter {
  /** the entity the actor positions and turns */
  root: Entity;
  scale: number;
  height: number;
  weapon: WeaponBuild;
  /** the entity the trail samples, and that hit sweeps are measured from */
  weaponEntity: Entity;
  /** nunchucks only: the spinning half */
  freeChuck?: Entity;
  /** Advance articulated attachments at the same substeps as the skeletal pose. */
  updateAttachments?(dt: number): void;
  animator: FighterAnimator;
  /** materials that flash white when a hit lands */
  flashMats: StandardMaterial[];
  chest(): Vec3;
  destroy(): void;
}

export type EnemyKind = 'grunt' | 'blade' | 'elite';
