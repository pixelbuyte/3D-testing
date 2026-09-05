import { Entity, Mat4, Quat, Vec3 } from 'playcanvas';

/**
 * Analytic two-bone IK, in world space.
 *
 * Used for the off-hand on a two-handed weapon: the right arm is posed by the clip and carries the
 * katana, the left arm is solved every frame to reach a point on the hilt. That is how a
 * two-handed grip stays closed through a swing without authoring the left arm for every key —
 * and a hand that visibly holds the weapon is most of what makes the weapon look attached.
 *
 * Conventions match the rig: a limb points down its local -Y, and the forearm bends with +X,
 * which swings its tip toward the upper arm's local -Z.
 */

const _toT = new Vec3();
const _dirST = new Vec3();
const _perp = new Vec3();
const _E = new Vec3();
const _bend = new Vec3();
const _x = new Vec3();
const _y = new Vec3();
const _z = new Vec3();
const _m = new Mat4();
const _q = new Quat();

export function solveTwoBone(
  upper: Entity, fore: Entity, target: Vec3, pole: Vec3, lenA: number, lenB: number,
): void {
  const S = upper.getPosition();
  _toT.sub2(target, S);
  let d = _toT.length();
  const minD = Math.abs(lenA - lenB) + 1e-3, maxD = lenA + lenB - 1e-3;
  d = Math.max(minD, Math.min(maxD, d));
  _dirST.copy(_toT).normalize();

  // where the elbow goes: rotate the shoulder→target direction by the shoulder angle, in the
  // plane picked by the pole vector
  const cosA = (lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  _perp.copy(pole);
  _perp.sub(_dirST.clone().mulScalar(_perp.dot(_dirST)));
  if (_perp.lengthSq() < 1e-6) _perp.set(0, -1, 0);
  _perp.normalize();
  _E.copy(S)
    .add(_dirST.clone().mulScalar(Math.cos(A) * lenA))
    .add(_perp.clone().mulScalar(Math.sin(A) * lenA));

  // upper arm frame: local -Y runs shoulder→elbow, local -Z points where the forearm will bend
  _y.sub2(S, _E).normalize();                        // +Y = elbow→shoulder
  _bend.set(target.x - _E.x, target.y - _E.y, target.z - _E.z);
  _bend.sub(_y.clone().mulScalar(_bend.dot(_y)));    // strip the along-limb component
  if (_bend.lengthSq() < 1e-6) _bend.copy(_perp);
  _bend.normalize();
  _z.copy(_bend).mulScalar(-1);                      // +Z = away from the bend
  _x.cross(_y, _z).normalize();
  _z.cross(_x, _y).normalize();                      // re-orthogonalise
  const md = _m.data;
  md[0] = _x.x; md[1] = _x.y; md[2] = _x.z; md[3] = 0;
  md[4] = _y.x; md[5] = _y.y; md[6] = _y.z; md[7] = 0;
  md[8] = _z.x; md[9] = _z.y; md[10] = _z.z; md[11] = 0;
  md[12] = 0; md[13] = 0; md[14] = 0; md[15] = 1;
  _q.setFromMat4(_m);
  upper.setRotation(_q);

  const cosI = (lenA * lenA + lenB * lenB - d * d) / (2 * lenA * lenB);
  const interior = Math.acos(Math.max(-1, Math.min(1, cosI)));
  fore.setLocalEulerAngles(180 - interior * 180 / Math.PI, 0, 0);
}
