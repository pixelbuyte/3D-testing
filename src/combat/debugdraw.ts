import { Color, Vec3, type AppBase } from 'playcanvas';
import type { Capsule, BladeSweep } from './hitdetect';

/**
 * Immediate-mode overlay for the combat volumes: body capsules, the blade sweep of every active
 * attack (green while it is dangerous, red on the frame it connects), and hit points. Off unless
 * the debug key turns it on, and it allocates nothing per frame when off.
 */
export class CombatDebugDraw {
  enabled = false;
  private sweeps: { sweep: BladeSweep; hit: boolean; life: number }[] = [];
  private points: { p: Vec3; life: number }[] = [];
  private readonly tmpA = new Vec3();
  private readonly tmpB = new Vec3();
  private static readonly CAPSULE = new Color(1, 0.85, 0.2);
  private static readonly CAPSULE_HURT = new Color(1, 0.3, 0.3);
  private static readonly SWEEP = new Color(0.3, 1, 0.4);
  private static readonly SWEEP_HIT = new Color(1, 0.25, 0.2);
  private static readonly POINT = new Color(1, 1, 1);

  constructor(private app: AppBase) {}

  toggle(): boolean { this.enabled = !this.enabled; return this.enabled; }

  /** remember a sweep for a few frames so it can be read at 1 fps in the capture harness too */
  sweep(s: BladeSweep, hit: boolean): void {
    if (!this.enabled) return;
    this.sweeps.push({
      sweep: { prevBase: s.prevBase.clone(), prevTip: s.prevTip.clone(), base: s.base.clone(), tip: s.tip.clone() },
      hit, life: hit ? 0.6 : 0.25,
    });
  }

  point(p: Vec3): void {
    if (!this.enabled) return;
    this.points.push({ p: p.clone(), life: 0.6 });
  }

  capsule(c: Capsule, hurt = false): void {
    if (!this.enabled) return;
    const col = hurt ? CombatDebugDraw.CAPSULE_HURT : CombatDebugDraw.CAPSULE;
    const N = 10;
    for (const end of [c.a, c.b]) {
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        this.tmpA.set(end.x + Math.cos(a0) * c.radius, end.y, end.z + Math.sin(a0) * c.radius);
        this.tmpB.set(end.x + Math.cos(a1) * c.radius, end.y, end.z + Math.sin(a1) * c.radius);
        this.app.drawLine(this.tmpA, this.tmpB, col, false);
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.tmpA.set(c.a.x + Math.cos(a) * c.radius, c.a.y, c.a.z + Math.sin(a) * c.radius);
      this.tmpB.set(c.b.x + Math.cos(a) * c.radius, c.b.y, c.b.z + Math.sin(a) * c.radius);
      this.app.drawLine(this.tmpA, this.tmpB, col, false);
    }
  }

  update(dt: number): void {
    if (!this.enabled) { this.sweeps.length = 0; this.points.length = 0; return; }
    for (const s of this.sweeps) {
      const col = s.hit ? CombatDebugDraw.SWEEP_HIT : CombatDebugDraw.SWEEP;
      this.app.drawLine(s.sweep.prevBase, s.sweep.prevTip, col, false);
      this.app.drawLine(s.sweep.base, s.sweep.tip, col, false);
      this.app.drawLine(s.sweep.prevTip, s.sweep.tip, col, false);
      this.app.drawLine(s.sweep.prevBase, s.sweep.base, col, false);
      s.life -= dt;
    }
    for (const p of this.points) {
      const r = 0.06;
      this.tmpA.set(p.p.x - r, p.p.y, p.p.z); this.tmpB.set(p.p.x + r, p.p.y, p.p.z); this.app.drawLine(this.tmpA, this.tmpB, CombatDebugDraw.POINT, false);
      this.tmpA.set(p.p.x, p.p.y - r, p.p.z); this.tmpB.set(p.p.x, p.p.y + r, p.p.z); this.app.drawLine(this.tmpA, this.tmpB, CombatDebugDraw.POINT, false);
      this.tmpA.set(p.p.x, p.p.y, p.p.z - r); this.tmpB.set(p.p.x, p.p.y, p.p.z + r); this.app.drawLine(this.tmpA, this.tmpB, CombatDebugDraw.POINT, false);
      p.life -= dt;
    }
    this.sweeps = this.sweeps.filter((s) => s.life > 0);
    this.points = this.points.filter((p) => p.life > 0);
  }
}
