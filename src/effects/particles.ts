import {
  BLEND_ADDITIVE, BLEND_NORMAL, BUFFER_DYNAMIC, BoundingBox, Color, Entity, Mesh, MeshInstance,
  SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL, SEMANTIC_ATTR11, SEMANTIC_ATTR12, SEMANTIC_ATTR14, SEMANTIC_ATTR15,
  StandardMaterial, Vec3, VertexBuffer, VertexFormat,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { particleGLSL, particleWGSL } from '@/shaders/particles';
import { createMesh, emptyData, radialSprite } from '@/utils/geometry';
import { clamp01, rng, TAU } from '@/utils/math';
import { settings } from '@/core/settings';

export type SystemName = 'dust' | 'spores' | 'drips' | 'embers' | 'energy';

interface SystemDef {
  count: number;
  blend: number;
  color: Color;
  size: [number, number];
  softness: number;
  emissive: number;
  /** ceiling on the fade envelope, so alpha-blended systems stay translucent */
  alpha: number;
}

const DEFS: Record<SystemName, SystemDef> = {
  // `alpha` is a per-system ceiling on the fade envelope. The alpha-blended systems need it: a dust
  // mote at full alpha paints a solid pale dot a few pixels across, which reads as a stuck white
  // square rather than as floating dust. The additive systems can run hot because they only add.
  dust:   { count: 900, blend: BLEND_NORMAL,   color: new Color(0.58, 0.64, 0.76), size: [0.010, 0.032], softness: 3.6, emissive: 0.55, alpha: 0.30 },
  spores: { count: 260, blend: BLEND_ADDITIVE, color: new Color(0.42, 0.72, 0.66), size: [0.035, 0.10], softness: 3.0, emissive: 0.9, alpha: 0.75 },
  drips:  { count: 180, blend: BLEND_NORMAL,   color: new Color(0.60, 0.70, 0.84), size: [0.008, 0.020], softness: 2.4, emissive: 0.6, alpha: 0.50 },
  embers: { count: 320, blend: BLEND_ADDITIVE, color: new Color(1.00, 0.55, 0.20), size: [0.02, 0.07],  softness: 2.4, emissive: 3.0, alpha: 0.90 },
  energy: { count: 520, blend: BLEND_ADDITIVE, color: new Color(0.45, 0.95, 0.90), size: [0.03, 0.11],  softness: 2.4, emissive: 3.4, alpha: 0.90 },
};

const FLOATS = 16; // one default-instancing "matrix" slot per particle

interface System {
  def: SystemDef; data: Float32Array; vb: VertexBuffer; mi: MeshInstance; mat: StandardMaterial;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array; seed: Float32Array;
  live: number; enabled: boolean; density: number;
}

/**
 * CPU-simulated, GPU-instanced particles.
 *
 * Every system owns one preallocated Float32Array and one dynamic vertex buffer; simulation writes
 * straight into that array and uploads it once per frame, so the render loop allocates nothing.
 * Particles are recycled in place — there is no spawn/despawn churn.
 */
export class ParticleFX {
  root: Entity;
  private systems = new Map<SystemName, System>();
  private rand = rng(2024);
  private windX = 0.5; private windZ = 0.5; private windStrength = 1;
  private energyTarget = new Vec3();
  private energyStrength = 0;
  private time = 0;
  private right = new Float32Array(3);
  private up = new Float32Array(3);
  /** where new dust/spores are seeded — follows the player so the effect is always around them */
  private focus = new Vec3();

  constructor(private ctx: EngineContext, private camera: Entity) {
    this.root = new Entity('particles');
    ctx.app.root.addChild(this.root);
    for (const name of Object.keys(DEFS) as SystemName[]) this.create(name);
    this.setEnabled('embers', false);
    this.setEnabled('energy', false);
  }

  private quadMesh(): Mesh {
    const d = emptyData();
    d.positions.push(-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0);
    d.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    d.uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    d.indices.push(0, 1, 2, 2, 1, 3);
    return createMesh(this.ctx.device, d);
  }

  private create(name: SystemName): void {
    const def = DEFS[name];
    const n = def.count;
    const mat = new StandardMaterial();
    mat.name = `particles-${name}`;
    mat.useLighting = false;
    mat.useFog = true;
    mat.blendType = def.blend;
    mat.depthWrite = false;
    mat.cull = 0;
    mat.opacity = 1;
    mat.opacityMap = radialSprite(this.ctx.device);
    mat.opacityMapChannel = 'a';
    mat.emissive = def.color.clone();
    mat.emissiveIntensity = def.emissive;
    mat.shaderChunksVersion = '2.8';
    const g = mat.getShaderChunks(SHADERLANGUAGE_GLSL), w = mat.getShaderChunks(SHADERLANGUAGE_WGSL);
    for (const [k, v] of Object.entries(particleGLSL)) g.set(k, v);
    for (const [k, v] of Object.entries(particleWGSL)) w.set(k, v);
    // overriding transformInstancingVS disables the engine's automatic mapping, so bind the
    // default instancing semantics ourselves
    mat.setAttribute('instance_line1', SEMANTIC_ATTR11);
    mat.setAttribute('instance_line2', SEMANTIC_ATTR12);
    mat.setAttribute('instance_line3', SEMANTIC_ATTR14);
    mat.setAttribute('instance_line4', SEMANTIC_ATTR15);
    mat.setParameter('uPartParams', [def.softness * 0.5, 1, 0, 0]);
    mat.update();

    const data = new Float32Array(n * FLOATS);
    const vb = new VertexBuffer(this.ctx.device, VertexFormat.getDefaultInstancingFormat(this.ctx.device), n,
      { usage: BUFFER_DYNAMIC, data: data.buffer as ArrayBuffer });
    const mesh = this.quadMesh();
    const mi = new MeshInstance(mesh, mat);
    mi.setInstancing(vb, false);   // simulated around the camera: never frustum-cull the whole system
    mi.cull = false;
    mi.castShadow = false;
    mi.receiveShadow = false;
    const huge = new BoundingBox(new Vec3(0, 0, 0), new Vec3(500, 200, 500));
    mi.setCustomAabb(huge);
    const e = new Entity(`fx-${name}`);
    e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
    this.root.addChild(e);

    const sys: System = {
      def, data, vb, mi, mat,
      px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n),
      vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
      life: new Float32Array(n), maxLife: new Float32Array(n), seed: new Float32Array(n),
      live: n, enabled: true, density: 1,
    };
    for (let i = 0; i < n; i++) { sys.seed[i] = this.rand(); sys.life[i] = this.rand() * 6; sys.maxLife[i] = 1; }
    this.systems.set(name, sys);
    this.respawnAll(name);
  }

  private respawnAll(name: SystemName): void {
    const s = this.systems.get(name)!;
    for (let i = 0; i < s.def.count; i++) this.respawn(name, i, true);
  }

  private respawn(name: SystemName, i: number, initial = false): void {
    const s = this.systems.get(name)!;
    const r = this.rand;
    const f = this.focus;
    switch (name) {
      case 'dust': {
        const rad = 4 + r() * 26;
        const a = r() * TAU;
        s.px[i] = f.x + Math.cos(a) * rad; s.pz[i] = f.z + Math.sin(a) * rad;
        s.py[i] = f.y - 1.2 + r() * 9;
        s.vx[i] = (r() - 0.5) * 0.10; s.vy[i] = (r() - 0.3) * 0.05; s.vz[i] = (r() - 0.5) * 0.10;
        s.maxLife[i] = 12 + r() * 16;
        break;
      }
      case 'spores': {
        const rad = 3 + r() * 22;
        const a = r() * TAU;
        s.px[i] = f.x + Math.cos(a) * rad; s.pz[i] = f.z + Math.sin(a) * rad;
        s.py[i] = f.y - 1.4 + r() * 2.6;
        s.vx[i] = (r() - 0.5) * 0.09; s.vy[i] = 0.10 + r() * 0.16; s.vz[i] = (r() - 0.5) * 0.09;
        s.maxLife[i] = 9 + r() * 10;
        break;
      }
      case 'drips': {
        const rad = 2 + r() * 20;
        const a = r() * TAU;
        s.px[i] = f.x + Math.cos(a) * rad; s.pz[i] = f.z + Math.sin(a) * rad;
        s.py[i] = f.y + 3.5 + r() * 6;
        s.vx[i] = 0; s.vy[i] = -1.4 - r() * 1.4; s.vz[i] = 0;
        s.maxLife[i] = 2.5 + r() * 2.5;
        break;
      }
      case 'embers': {
        const src = this.emberSources.length ? this.emberSources[(Math.random() * this.emberSources.length) | 0] : null;
        const bx = src ? src.x : f.x, by = src ? src.y : f.y + 1, bz = src ? src.z : f.z;
        s.px[i] = bx + (r() - 0.5) * 0.22; s.py[i] = by + (r() - 0.5) * 0.16; s.pz[i] = bz + (r() - 0.5) * 0.22;
        s.vx[i] = (r() - 0.5) * 0.14; s.vy[i] = 0.25 + r() * 0.5; s.vz[i] = (r() - 0.5) * 0.14;
        s.maxLife[i] = 2.0 + r() * 2.6;
        break;
      }
      case 'energy': {
        const t = this.energyTarget;
        const rad = 1.5 + r() * 7;
        const a = r() * TAU;
        s.px[i] = t.x + Math.cos(a) * rad; s.pz[i] = t.z + Math.sin(a) * rad;
        s.py[i] = t.y - 1 + r() * 4;
        s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
        s.maxLife[i] = 3 + r() * 4;
        break;
      }
    }
    s.life[i] = initial ? r() * s.maxLife[i] : 0;
    s.seed[i] = r();
  }

  private emberSources: Vec3[] = [];
  setEmberSources(list: Vec3[]): void { this.emberSources = list; }
  setWind(dirX: number, dirZ: number, strength: number): void { this.windX = dirX; this.windZ = dirZ; this.windStrength = strength; }
  setEnergyTarget(pos: Vec3, strength: number): void { this.energyTarget.copy(pos); this.energyStrength = strength; }
  setEnabled(name: SystemName, on: boolean): void {
    const s = this.systems.get(name); if (!s) return;
    s.enabled = on;
    s.mi.visible = on;
  }
  setColor(name: SystemName, c: Color): void {
    const s = this.systems.get(name); if (!s) return;
    s.def.color.copy(c);
  }
  setDensity(name: SystemName, mult: number): void {
    const s = this.systems.get(name); if (!s) return;
    s.density = clamp01(mult);
  }

  update(dt: number, camPos: Vec3): void {
    this.time += dt;
    dt = Math.min(dt, 0.05);
    this.focus.copy(camPos);
    // billboard basis from the camera
    const cr = this.camera.right, cu = this.camera.up;
    this.right[0] = cr.x; this.right[1] = cr.y; this.right[2] = cr.z;
    this.up[0] = cu.x; this.up[1] = cu.y; this.up[2] = cu.z;

    const globalScale = settings.get('particleScale');
    for (const [name, s] of this.systems) {
      s.mat.setParameter('uPartRight', this.right);
      s.mat.setParameter('uPartUp', this.up);
      if (!s.enabled) { s.mi.instancingCount = 0; continue; }
      const active = Math.max(1, Math.round(s.def.count * clamp01(globalScale * s.density)));
      this.simulate(name, s, dt, active, camPos);
      s.vb.setData(s.data.buffer as ArrayBuffer);
      s.mi.instancingCount = active;
    }
  }

  private simulate(name: SystemName, s: System, dt: number, active: number, camPos: Vec3): void {
    const d = s.data;
    const col = s.def.color;
    const [sMin, sMax] = s.def.size;
    const t = this.time;
    const wx = this.windX * this.windStrength, wz = this.windZ * this.windStrength;
    for (let i = 0; i < active; i++) {
      s.life[i] += dt;
      if (s.life[i] >= s.maxLife[i]) this.respawn(name, i);
      const age = s.life[i] / s.maxLife[i];
      const seed = s.seed[i];

      // --- integrate
      if (name === 'dust' || name === 'spores') {
        // drift on the wind with a slow turbulent wobble
        const w = 0.35 + 0.65 * Math.sin(t * 0.13 + seed * 9);
        s.px[i] += (s.vx[i] + wx * 0.16 * w) * dt;
        s.pz[i] += (s.vz[i] + wz * 0.16 * w) * dt;
        s.py[i] += (s.vy[i] + Math.sin(t * 0.7 + seed * 12) * 0.02) * dt;
      } else if (name === 'drips') {
        s.vy[i] -= 4 * dt;
        s.py[i] += s.vy[i] * dt;
        s.px[i] += wx * 0.05 * dt; s.pz[i] += wz * 0.05 * dt;
      } else if (name === 'embers') {
        s.vy[i] += (0.55 - s.vy[i]) * dt * 0.8;
        s.px[i] += (s.vx[i] + wx * 0.10) * dt + Math.sin(t * 2.1 + seed * 15) * 0.006;
        s.py[i] += s.vy[i] * dt;
        s.pz[i] += (s.vz[i] + wz * 0.10) * dt + Math.cos(t * 1.7 + seed * 11) * 0.006;
      } else {
        // energy: orbit the target while spiralling inward, then get re-seeded
        const tx = this.energyTarget.x - s.px[i], tz = this.energyTarget.z - s.pz[i];
        const dist = Math.hypot(tx, tz) + 1e-3;
        const tangential = 1.9 * this.energyStrength;
        const inward = 0.55 * this.energyStrength;
        s.px[i] += (-tz / dist * tangential + tx / dist * inward) * dt;
        s.pz[i] += (tx / dist * tangential + tz / dist * inward) * dt;
        s.py[i] += (0.35 + Math.sin(t * 1.3 + seed * 20) * 0.4) * dt * this.energyStrength;
      }

      // --- recycle particles that drift too far from the player
      if (name === 'dust' || name === 'spores' || name === 'drips') {
        const dx = s.px[i] - camPos.x, dz = s.pz[i] - camPos.z;
        if (dx * dx + dz * dz > 44 * 44 || s.py[i] < camPos.y - 14 || s.py[i] > camPos.y + 26) this.respawn(name, i);
      }

      // --- fade envelope (in at birth, out at death)
      let alpha = Math.min(age * 6, 1) * Math.min((1 - age) * 3.2, 1) * DEFS[name].alpha;
      const flicker = 0.65 + 0.35 * Math.sin(t * (name === 'embers' ? 9 : 2.4) + seed * 30);
      alpha *= flicker;
      if (name === 'energy') alpha *= this.energyStrength;
      const size = (sMin + (sMax - sMin) * seed) * (name === 'embers' ? (1 - age * 0.6) : 1);

      const o = i * FLOATS;
      d[o] = s.px[i]; d[o + 1] = s.py[i]; d[o + 2] = s.pz[i]; d[o + 3] = size;
      d[o + 4] = col.r; d[o + 5] = col.g; d[o + 6] = col.b; d[o + 7] = alpha;
      d[o + 8] = seed * TAU + t * (name === 'embers' ? 0.9 : 0.15); d[o + 9] = 0; d[o + 10] = 0; d[o + 11] = 0;
      d[o + 12] = 0; d[o + 13] = 0; d[o + 14] = 0; d[o + 15] = 1;
    }
  }

  /** One-shot radial burst reusing the energy pool (used when a stone activates). */
  burst(pos: Vec3, strength = 1): void {
    const s = this.systems.get('energy'); if (!s) return;
    this.setEnabled('energy', true);
    const n = Math.min(s.def.count, Math.round(260 * strength));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * TAU, e = (this.rand() - 0.3) * 1.4;
      const sp = 2.5 + this.rand() * 5;
      s.px[i] = pos.x; s.py[i] = pos.y; s.pz[i] = pos.z;
      s.vx[i] = Math.cos(a) * Math.cos(e) * sp; s.vy[i] = Math.sin(e) * sp; s.vz[i] = Math.sin(a) * Math.cos(e) * sp;
      s.life[i] = 0; s.maxLife[i] = 1.6 + this.rand() * 1.8;
    }
  }
}
