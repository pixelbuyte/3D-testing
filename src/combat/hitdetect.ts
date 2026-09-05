import { Vec3 } from 'playcanvas';

/**
 * Melee hit detection: the blade is swept between where it was last frame and where it is now, and
 * that sweep is tested against body capsules. Nothing here depends on the frame rate — a slow frame
 * just means a longer sweep, which is cut into sub-steps so a fast swing cannot tunnel through a
 * body — and nothing here decides *when* the blade is dangerous; the animation's active window
 * does that.
 */

export interface Capsule {
  /** the two ends of the body's axis, feet to head, world space */
  a: Vec3;
  b: Vec3;
  radius: number;
}

export interface BladeSweep {
  prevBase: Vec3;
  prevTip: Vec3;
  base: Vec3;
  tip: Vec3;
}

export interface SweepHit {
  /** where on the blade the contact happened, world space */
  point: Vec3;
  /** 0..1 through the frame's sweep — earlier is closer to the previous frame */
  t: number;
  /** closest distance between blade and body axis at contact */
  distance: number;
}

const _d1 = new Vec3(), _d2 = new Vec3(), _r = new Vec3(), _c1 = new Vec3(), _c2 = new Vec3();
const _sb = new Vec3(), _st = new Vec3();

/**
 * Closest points between segments p1→q1 and p2→q2 (Ericson, Real-Time Collision Detection 5.1.9).
 * Writes the closest points into c1 and c2 and returns the distance.
 */
export function segmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3, c1 = _c1, c2 = _c2): number {
  _d1.sub2(q1, p1);
  _d2.sub2(q2, p2);
  _r.sub2(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s = 0, t = 0;
  const EPS = 1e-8;
  if (a <= EPS && e <= EPS) {
    c1.copy(p1); c2.copy(p2);
    return c1.distance(c2);
  }
  if (a <= EPS) {
    s = 0; t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0; s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  c1.copy(p1).addScaled(_d1, s);
  c2.copy(p2).addScaled(_d2, t);
  return c1.distance(c2);
}

/**
 * Sweep a blade through the frame and report the first sub-step at which it comes within
 * `radius + tolerance` of the capsule's axis. `maxStep` bounds how far the tip may travel between
 * sub-steps, so a 20 m/s swing on a 100 ms frame is still tested every 12 cm.
 */
export function sweepBlade(sweep: BladeSweep, cap: Capsule, tolerance: number, maxStep: number, out: SweepHit): boolean {
  const travel = Math.max(sweep.tip.distance(sweep.prevTip), sweep.base.distance(sweep.prevBase));
  const steps = Math.max(1, Math.min(12, Math.ceil(travel / Math.max(0.01, maxStep))));
  const reach = cap.radius + tolerance;
  for (let k = 0; k <= steps; k++) {
    const f = k / steps;
    _sb.lerp(sweep.prevBase, sweep.base, f);
    _st.lerp(sweep.prevTip, sweep.tip, f);
    const d = segmentDistance(_sb, _st, cap.a, cap.b);
    if (d <= reach) {
      out.point.copy(_c1);
      out.t = f;
      out.distance = d;
      return true;
    }
  }
  return false;
}

/** cosine of the angle between the attacker's facing and the direction to the target, on the ground plane */
export function facingDot(attackerX: number, attackerZ: number, yaw: number, targetX: number, targetZ: number): number {
  const dx = targetX - attackerX, dz = targetZ - attackerZ;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return 1;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return (dx * fx + dz * fz) / len;
}
