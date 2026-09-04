import {
  BLEND_ADDITIVE, Color, Entity, MeshInstance, StandardMaterial, Vec3,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { appendData, createMesh, cylinderData, emptyData, planeData, sphereData, transformData } from '@/utils/geometry';
import { clamp01, rng } from '@/utils/math';

/**
 * Combat effects, all pooled.
 *
 * Nothing here allocates during a fight: sparks, arcs and puffs are fixed-size pools of entities
 * that get re-armed and faded, because a garbage spike in the middle of a three-hit combo is
 * exactly where a browser game drops the frame you most needed.
 *
 * The effects are deliberately small and short. The reference the fight is aimed at reads because
 * of clean arcs and a hard flash on contact, not because the screen fills with fire.
 */

interface Item {
  e: Entity;
  mat: StandardMaterial;
  life: number;
  max: number;
  vel: Vec3;
  /** sparks: degrees/sec of tumble. puffs: base scale, since they never rotate. */
  spin: number;
  kind: 'spark' | 'arc' | 'puff' | 'charge';
  base: number;
}

const SPARKS = 48;
const ARCS = 6;
const PUFFS = 20;

export class CombatFX {
  private items: Item[] = [];
  private rand = rng(90210);
  private root: Entity;
  private tmp = new Vec3();

  constructor(ctx: EngineContext) {
    this.root = new Entity('combat-fx');
    ctx.app.root.addChild(this.root);

    // --- spark shard: a thin tapered sliver that reads as a struck fragment
    const shard = emptyData();
    appendData(shard, transformData(cylinderData(0.012, 0.001, 0.16, 4, 1, true), [0, 0.08, 0]));
    const shardMesh = createMesh(ctx.device, shard);

    // --- slash arc: a flat crescent aligned to the swing plane
    const arc = emptyData();
    const R = 1.15, W = 0.30, SEG = 14;
    for (let i = 0; i <= SEG; i++) {
      const a = -1.05 + (i / SEG) * 2.1;
      const t = i / SEG;
      const taper = Math.sin(t * Math.PI);
      appendData(arc, transformData(planeData(0.19, W * taper + 0.02, 1, 1),
        [Math.sin(a) * R, 0, Math.cos(a) * R], [90, -a / Math.PI * 180, 0]));
    }
    const arcMesh = createMesh(ctx.device, arc);

    // --- puff: a soft ball used for spawn smoke, dissolve bursts and charge glows
    const puffMesh = createMesh(ctx.device, sphereData(0.30, 10, 7));

    const mk = (kind: Item['kind'], mesh: typeof shardMesh, count: number): void => {
      for (let i = 0; i < count; i++) {
        const mat = new StandardMaterial();
        mat.name = `fx-${kind}`;
        mat.useLighting = false;
        mat.blendType = BLEND_ADDITIVE;
        mat.depthWrite = false;
        mat.cull = 0;
        mat.useFog = false;
        mat.emissive = new Color(1, 1, 1);
        mat.emissiveIntensity = 0;
        mat.update();
        const e = new Entity(`fx-${kind}-${i}`);
        e.addComponent('render', { meshInstances: [new MeshInstance(mesh, mat)], castShadows: false, receiveShadows: false });
        e.enabled = false;
        this.root.addChild(e);
        this.items.push({ e, mat, life: 0, max: 1, vel: new Vec3(), spin: 0, kind, base: 1 });
      }
    };
    mk('spark', shardMesh, SPARKS);
    mk('arc', arcMesh, ARCS);
    mk('puff', puffMesh, PUFFS);
  }

  private take(kind: Item['kind']): Item | null {
    for (const it of this.items) if (it.kind === kind && it.life <= 0) return it;
    return null;
  }

  /** A burst of shards away from the point of contact. */
  spark(at: Vec3, color: Color, count = 14): void {
    for (let i = 0; i < count; i++) {
      const it = this.take('spark');
      if (!it) return;
      const a = this.rand() * Math.PI * 2;
      const up = 0.25 + this.rand() * 0.9;
      const sp = 2.6 + this.rand() * 5.2;
      it.vel.set(Math.cos(a) * sp, up * sp * 0.7, Math.sin(a) * sp);
      it.e.setPosition(at.x + (this.rand() - 0.5) * 0.12, at.y + (this.rand() - 0.5) * 0.12, at.z + (this.rand() - 0.5) * 0.12);
      it.e.setEulerAngles(this.rand() * 360, this.rand() * 360, this.rand() * 360);
      it.e.setLocalScale(1, 0.7 + this.rand() * 0.9, 1);
      it.max = it.life = 0.22 + this.rand() * 0.26;
      it.base = 5.5;
      it.spin = (this.rand() - 0.5) * 900;
      it.mat.emissive.copy(color);
      it.e.enabled = true;
    }
  }

  /** The crescent left in the air where a blade passed. */
  slashArc(at: Vec3, yaw: number, size: number, color: Color): void {
    const it = this.take('arc');
    if (!it) return;
    it.e.setPosition(at.x, at.y, at.z);
    // tilt the crescent off vertical so it reads as a diagonal cut rather than a hoop
    it.e.setEulerAngles(64 + this.rand() * 28, yaw / Math.PI * 180 + 180, 24 + this.rand() * 30);
    it.e.setLocalScale(size, size, size);
    it.max = it.life = 0.20;
    it.base = 4.0;
    it.spin = 0;
    it.vel.set(0, 0, 0);
    it.mat.emissive.copy(color);
    it.e.enabled = true;
  }

  /** Dust kicked off the stone by a dodge or a landing. */
  dust(at: Vec3, count = 8): void {
    for (let i = 0; i < count; i++) {
      const it = this.take('puff');
      if (!it) return;
      const a = this.rand() * Math.PI * 2;
      it.vel.set(Math.cos(a) * 1.5, 0.5 + this.rand() * 0.6, Math.sin(a) * 1.5);
      it.e.setPosition(at.x + Math.cos(a) * 0.3, at.y + 0.08, at.z + Math.sin(a) * 0.3);
      it.max = it.life = 0.45 + this.rand() * 0.3;
      it.base = 0.32;
      it.spin = 0.42;
      it.mat.emissive.set(0.55, 0.5, 0.45);
      it.e.enabled = true;
    }
  }

  /** Energy gathering before a heavy blow or an enemy telegraph. */
  charge(at: Vec3, color: Color): void {
    const it = this.take('puff');
    if (!it) return;
    it.vel.set(0, 0.35, 0);
    it.e.setPosition(at.x, at.y, at.z);
    it.max = it.life = 0.30;
    it.base = 1.9;
    it.spin = 0.58;
    it.mat.emissive.copy(color);
    it.e.enabled = true;
  }

  /** Corruption smoke when an enemy arrives. */
  spawnPuff(at: Vec3, color: Color): void {
    if ((globalThis as Record<string, unknown>).__NOPUFF) return;
    for (let i = 0; i < 6; i++) {
      const it = this.take('puff');
      if (!it) return;
      const a = this.rand() * Math.PI * 2;
      it.vel.set(Math.cos(a) * 0.7, 0.9 + this.rand() * 0.7, Math.sin(a) * 0.7);
      it.e.setPosition(at.x + Math.cos(a) * 0.25, at.y + 0.3 + this.rand() * 0.9, at.z + Math.sin(a) * 0.25);
      it.max = it.life = 0.45 + this.rand() * 0.3;
      it.base = 0.85;
      it.spin = 0.5;
      it.mat.emissive.copy(color);
      it.e.enabled = true;
    }
  }

  /** The spirit leaving on defeat — rises and fades rather than exploding. */
  dissolveBurst(at: Vec3, color: Color): void {
    for (let i = 0; i < 10; i++) {
      const it = this.take('puff');
      if (!it) return;
      const a = this.rand() * Math.PI * 2;
      it.vel.set(Math.cos(a) * 0.55, 1.5 + this.rand() * 1.4, Math.sin(a) * 0.55);
      it.e.setPosition(at.x + Math.cos(a) * 0.3, at.y + this.rand() * 0.5, at.z + Math.sin(a) * 0.3);
      it.max = it.life = 0.7 + this.rand() * 0.5;
      it.base = 1.25;
      it.spin = 0.46;
      it.mat.emissive.copy(color);
      it.e.enabled = true;
    }
    this.spark(at, color, 18);
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.e.enabled = false; it.mat.emissiveIntensity = 0; it.mat.update(); continue; }
      const t = clamp01(it.life / it.max);

      if (it.kind === 'spark') {
        it.vel.y -= 16 * dt;
        this.tmp.copy(it.e.getPosition());
        it.e.setPosition(this.tmp.x + it.vel.x * dt, this.tmp.y + it.vel.y * dt, this.tmp.z + it.vel.z * dt);
        if (it.spin) it.e.rotateLocal(it.spin * dt, it.spin * 0.4 * dt, 0);
        it.mat.emissiveIntensity = it.base * t * t;
      } else if (it.kind === 'arc') {
        // the crescent expands slightly and thins out — a wipe, not a lingering ring
        const g = 1 + (1 - t) * 0.55;
        it.e.setLocalScale(g, g, g);
        it.mat.emissiveIntensity = it.base * t * t;
      } else {
        this.tmp.copy(it.e.getPosition());
        it.vel.y -= 1.1 * dt;
        it.e.setPosition(this.tmp.x + it.vel.x * dt, this.tmp.y + it.vel.y * dt, this.tmp.z + it.vel.z * dt);
        // grow as it fades, but let the brightness fall monotonically. The first version's growth
        // term cancelled the fade, so spawn puffs sat on screen at full brightness for seconds.
        const g = it.spin * (1 + (1 - t) * 1.6);
        it.e.setLocalScale(g, g, g);
        it.mat.emissiveIntensity = it.base * t * t;
      }
      it.mat.update();
    }
  }

  /** how many pooled effects are live — surfaced in the debug stats */
  get active(): number { let n = 0; for (const it of this.items) if (it.life > 0) n++; return n; }

  destroy(): void { this.root.destroy(); }
}
