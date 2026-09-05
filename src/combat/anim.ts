
/**
 * The action vocabulary the combat director speaks.
 *
 * A Clip names an action and carries its combat metadata (events, root motion, grounding). The
 * pose keys are the original hand-authored keyframes; the skinned bodies ignore them and play the
 * GLB track mapped to the clip's name instead, so the director never has to know which body it
 * is driving.
 */

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'snap' | 'settle';

export interface Key {
  /** normalised time within the clip, 0..1 */
  t: number;
  pose: Partial<Record<string, [number, number, number]>>;
  /** easing applied on the way OUT of this key toward the next */
  ease?: Ease;
}

export interface Clip {
  name: string;
  /** seconds */
  dur: number;
  loop?: boolean;
  /** 'upper' clips leave the legs to the locomotion blend */
  mask?: 'full' | 'upper';
  keys: Key[];
  /** fired once when playback crosses this normalised time; drives hit windows and sounds */
  events?: { t: number; name: string }[];
  /** root motion: metres forward over the clip, applied as a velocity curve */
  lunge?: number;
  /** false for airborne or prone clips, where snapping the feet to the ground is wrong */
  ground?: boolean;
  /** true when the off-hand leaves the weapon (a flourish, a fall), so the grip IK lets go */
  offHandFree?: boolean;
}


/** What a body's animator must offer the actor and the combat director, whatever drives the bones. */
export interface FighterAnimator {
  breathe: number;
  lean: number;
  leanSide: number;
  lookYaw: number;
  lookPitch: number;
  setEventHandler(fn: (name: string) => void): void;
  /** `speed` is the actor's real ground speed in m/s, for bodies whose clips have a natural stride */
  setLocomotion(a: Clip, b: Clip | null, mix: number, rate?: number, speed?: number): void;
  /** start a one-shot; returns the duration it will actually take */
  play(clip: Clip, fadeDur?: number): number;
  stopAction(): void;
  readonly actionName: string | null;
  readonly actionProgress: number;
  readonly busy: boolean;
  readonly grounded: boolean;
  readonly offHandOnWeapon: boolean;
  /** an attack is playing and its damage window has not closed yet: the blade wants fine sampling */
  readonly sweeping: boolean;
  consumeLunge(dt: number): number;
  update(dt: number): void;
}
