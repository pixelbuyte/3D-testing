import { Vec3 } from 'playcanvas';

/** Static analytic colliders — cheap and deterministic; no physics engine needed. */
export interface BoxCollider { kind: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; rotY: number; }
export interface CylinderCollider { kind: 'cyl'; x: number; y: number; z: number; r: number; h: number; }
export type Collider = BoxCollider | CylinderCollider;

export interface HeightProvider { heightAt(x: number, z: number): number; }

const tmp = new Vec3();

export class CollisionWorld {
  colliders: Collider[] = [];
  private grid = new Map<string, Collider[]>();
  private cellSize = 8;

  constructor(public terrain: HeightProvider) {}

  addBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0): BoxCollider {
    const c: BoxCollider = { kind: 'box', x, y, z, hx, hy, hz, rotY };
    this.add(c, Math.hypot(hx, hz)); return c;
  }
  addCylinder(x: number, y: number, z: number, r: number, h: number): CylinderCollider {
    const c: CylinderCollider = { kind: 'cyl', x, y, z, r, h };
    this.add(c, r); return c;
  }
  remove(c: Collider): void {
    this.colliders = this.colliders.filter((o) => o !== c);
    for (const list of this.grid.values()) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); }
  }
  private add(c: Collider, radius: number): void {
    this.colliders.push(c);
    const cs = this.cellSize;
    const x0 = Math.floor((c.x - radius) / cs), x1 = Math.floor((c.x + radius) / cs);
    const z0 = Math.floor((c.z - radius) / cs), z1 = Math.floor((c.z + radius) / cs);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = `${gx},${gz}`;
      let list = this.grid.get(k); if (!list) { list = []; this.grid.set(k, list); }
      list.push(c);
    }
  }
  private nearby(x: number, z: number): Collider[] {
    const cs = this.cellSize;
    const gx = Math.floor(x / cs), gz = Math.floor(z / cs);
    const out: Collider[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = this.grid.get(`${gx + dx},${gz + dz}`);
      if (list) for (const c of list) if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  /**
   * Resolves a capsule (feet position `pos`, radius r, height h) against static colliders by pushing it out
   * horizontally. Returns the corrected position in `pos`. Also reports whether the capsule is standing on a collider top.
   */
  resolve(pos: Vec3, radius: number, height: number, out: { standY: number | null }): void {
    out.standY = null;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of this.nearby(pos.x, pos.z)) {
        if (c.kind === 'cyl') {
          if (pos.y > c.y + c.h || pos.y + height < c.y) continue;
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const d = Math.hypot(dx, dz), minD = c.r + radius;
          if (d < minD) {
            // allow stepping onto low cylinders (stumps / stones)
            if (c.y + c.h - pos.y < 0.45 && c.y + c.h - pos.y > -0.05) { out.standY = Math.max(out.standY ?? -1e9, c.y + c.h); continue; }
            const push = (minD - d) / Math.max(d, 1e-4);
            pos.x += dx * push; pos.z += dz * push; moved = true;
          }
        } else {
          // oriented box: transform to local space
          const s = Math.sin(-c.rotY), co = Math.cos(-c.rotY);
          const lx0 = pos.x - c.x, lz0 = pos.z - c.z;
          const lx = lx0 * co - lz0 * s, lz = lx0 * s + lz0 * co;
          const top = c.y + c.hy, bottom = c.y - c.hy;
          if (pos.y > top || pos.y + height < bottom) continue;
          const ox = Math.abs(lx) - (c.hx + radius), oz = Math.abs(lz) - (c.hz + radius);
          if (ox < 0 && oz < 0) {
            // step-up onto low boxes (stairs, plinths)
            if (top - pos.y < 0.5 && top - pos.y > -0.05 && Math.abs(lx) < c.hx + radius * 0.6 && Math.abs(lz) < c.hz + radius * 0.6) {
              out.standY = Math.max(out.standY ?? -1e9, top); continue;
            }
            // push along the axis of least penetration
            let px = 0, pz = 0;
            if (ox > oz) px = -ox * Math.sign(lx || 1); else pz = -oz * Math.sign(lz || 1);
            // back to world
            const s2 = Math.sin(c.rotY), c2 = Math.cos(c.rotY);
            pos.x += px * c2 - pz * s2; pos.z += px * s2 + pz * c2; moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

  /** Simple ray march against terrain + colliders for gaze focus distance (DOF). */
  rayDistance(origin: Vec3, dir: Vec3, maxDist = 60): number {
    const step = 0.5;
    for (let d = 0.5; d < maxDist; d += step) {
      tmp.copy(dir).mulScalar(d).add(origin);
      if (tmp.y < this.terrain.heightAt(tmp.x, tmp.z)) return d;
      for (const c of this.nearby(tmp.x, tmp.z)) {
        if (c.kind === 'cyl') { if (tmp.y >= c.y && tmp.y <= c.y + c.h && Math.hypot(tmp.x - c.x, tmp.z - c.z) < c.r) return d; }
        else {
          const s = Math.sin(-c.rotY), co = Math.cos(-c.rotY);
          const lx0 = tmp.x - c.x, lz0 = tmp.z - c.z;
          const lx = lx0 * co - lz0 * s, lz = lx0 * s + lz0 * co;
          if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz && Math.abs(tmp.y - c.y) < c.hy) return d;
        }
      }
    }
    return maxDist;
  }
}
