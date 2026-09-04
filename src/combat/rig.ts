import { Color, Entity, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { appendData, createMesh, cylinderData, emptyData, sphereData, transformData, type MeshData } from '@/utils/geometry';

/**
 * A jointed humanoid skeleton.
 *
 * The shrine's ambient NPCs (src/world/npc.ts) animate by moving whole body parts, which is fine
 * for someone standing still and breathing but falls apart the moment a limb has to bend. Combat
 * needs elbows and knees, so fighters get this instead: every joint is its own entity, geometry
 * hangs off the joint it belongs to, and animation is pure local rotation. No skinning, no bone
 * weights — at these silhouette sizes an articulated chain of solids reads the same and costs a
 * fraction of the setup.
 */
export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'upperArmL', 'forearmL', 'handL',
  'clavR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
] as const;

export type Joint = (typeof JOINTS)[number];

/** Local euler angles in degrees, per joint. Anything omitted holds its rest pose. */
export type Pose = Partial<Record<Joint, readonly [number, number, number]>>;

/** Joints an upper-body clip is allowed to touch, so attacks can play while the legs keep running. */
export const UPPER: readonly Joint[] = [
  'spine', 'chest', 'neck', 'head',
  'clavL', 'upperArmL', 'forearmL', 'handL',
  'clavR', 'upperArmR', 'forearmR', 'handR',
];

/**
 * Where each joint sits relative to its parent, and the rest rotation it holds.
 * Scaled by the character's height multiplier at build time.
 */
const SKELETON: Record<Joint, { parent: Joint | null; pos: readonly [number, number, number]; rest?: readonly [number, number, number] }> = {
  hips:      { parent: null,    pos: [0, 0.94, 0] },
  spine:     { parent: 'hips',  pos: [0, 0.15, 0] },
  chest:     { parent: 'spine', pos: [0, 0.20, 0] },
  neck:      { parent: 'chest', pos: [0, 0.19, 0] },
  head:      { parent: 'neck',  pos: [0, 0.10, 0] },

  // arms hang down: the rest pose rolls them outward slightly so they clear the ribcage
  clavL:     { parent: 'chest', pos: [-0.06, 0.145, 0] },
  upperArmL: { parent: 'clavL', pos: [-0.13, 0, 0], rest: [0, 0, -6] },
  forearmL:  { parent: 'upperArmL', pos: [0, -0.27, 0] },
  handL:     { parent: 'forearmL', pos: [0, -0.25, 0] },

  clavR:     { parent: 'chest', pos: [0.06, 0.145, 0] },
  upperArmR: { parent: 'clavR', pos: [0.13, 0, 0], rest: [0, 0, 6] },
  forearmR:  { parent: 'upperArmR', pos: [0, -0.27, 0] },
  handR:     { parent: 'forearmR', pos: [0, -0.25, 0] },

  thighL:    { parent: 'hips', pos: [-0.10, -0.05, 0] },
  shinL:     { parent: 'thighL', pos: [0, -0.43, 0] },
  footL:     { parent: 'shinL', pos: [0, -0.41, 0] },

  thighR:    { parent: 'hips', pos: [0.10, -0.05, 0] },
  shinR:     { parent: 'thighR', pos: [0, -0.43, 0] },
  footR:     { parent: 'shinR', pos: [0, -0.41, 0] },
};

export interface RigPalette {
  cloth: Color;      // robe / hakama
  armor: Color;      // plates, bracers, belt
  skin: Color;
  hair: Color;
  accent: Color;     // sash, glowing trim
  accentGlow?: number;
}

/** A limb solid: a tapered cylinder from the joint down toward its child. */
function limb(rTop: number, rBot: number, len: number, segs = 8): MeshData {
  return transformData(cylinderData(rBot, rTop, len, segs, 1, true), [0, -len * 0.5, 0]);
}

export class Rig {
  readonly root: Entity;
  readonly joints = {} as Record<Joint, Entity>;
  readonly scale: number;
  /** materials are exposed so characters can flash them on hit or dissolve them on defeat */
  readonly mats: { cloth: StandardMaterial; armor: StandardMaterial; skin: StandardMaterial; hair: StandardMaterial; accent: StandardMaterial };
  private restPose: Pose = {};
  private pending = new Map<Joint, Map<StandardMaterial, MeshData>>();

  constructor(private ctx: EngineContext, name: string, palette: RigPalette, scale = 1) {
    this.scale = scale;
    this.root = new Entity(name);

    const mk = (n: string, c: Color, gloss: number, glow = 0): StandardMaterial => {
      const m = new StandardMaterial();
      m.name = `${name}-${n}`;
      m.diffuse = c.clone();
      m.useMetalness = true;
      m.metalness = n === 'armor' ? 0.55 : 0;
      m.gloss = gloss;
      if (glow > 0) { m.emissive = c.clone(); m.emissiveIntensity = glow; }
      m.update();
      return m;
    };
    this.mats = {
      cloth: mk('cloth', palette.cloth, 0.20),
      armor: mk('armor', palette.armor, 0.55),
      skin: mk('skin', palette.skin, 0.26),
      hair: mk('hair', palette.hair, 0.34),
      accent: mk('accent', palette.accent, 0.40, palette.accentGlow ?? 0),
    };

    // --- build the joint hierarchy
    for (const j of JOINTS) {
      const def = SKELETON[j];
      const e = new Entity(j);
      e.setLocalPosition(def.pos[0] * scale, def.pos[1] * scale, def.pos[2] * scale);
      if (def.rest) { e.setLocalEulerAngles(def.rest[0], def.rest[1], def.rest[2]); this.restPose[j] = def.rest; }
      this.joints[j] = e;
    }
    for (const j of JOINTS) {
      const p = SKELETON[j].parent;
      (p ? this.joints[p] : this.root).addChild(this.joints[j]);
    }
  }

  /** The rotation a joint returns to when no clip is driving it. */
  get rest(): Pose { return this.restPose; }

  /**
   * Queue a mesh onto a joint, in that joint's local space.
   *
   * Queued rather than attached immediately so everything a character puts on one joint in one
   * material collapses into a single mesh at build() time. It matters: the first version made an
   * entity per piece, so a warrior cost ~30 draw calls and four fighters on screen tripled the
   * frame's draw-call count on their own.
   */
  attach(joint: Joint, data: MeshData, mat: StandardMaterial): void {
    let byMat = this.pending.get(joint);
    if (!byMat) { byMat = new Map(); this.pending.set(joint, byMat); }
    const existing = byMat.get(mat);
    if (existing) appendData(existing, data);
    else byMat.set(mat, data);
  }

  /** Realise every queued mesh. Characters call this once, after dressing the rig. */
  build(): void {
    for (const [joint, byMat] of this.pending) {
      for (const [mat, data] of byMat) {
        this.attachTo(this.joints[joint], data, mat, `${joint}-${mat.name}`);
      }
    }
    this.pending.clear();
  }

  /** Same, but onto any entity in the hierarchy — used for weapon holders. */
  attachTo(parent: Entity, data: MeshData, mat: StandardMaterial, name = 'geo'): MeshInstance {
    const mi = new MeshInstance(createMesh(this.ctx.device, data), mat);
    const e = new Entity(name);
    e.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true });
    parent.addChild(e);
    return mi;
  }

  /**
   * The default body: torso, head, arms and legs as tapered solids. Characters call this and then
   * add their own silhouette pieces (armour plates, a skirt, a mask) on top.
   */
  buildBody(o: { chest?: number; limbs?: number; skirt?: number; skirtAccent?: boolean } = {}): void {
    const s = this.scale;
    const bulk = o.limbs ?? 1;
    const M = this.mats;

    // --- pelvis + torso
    const hips = emptyData();
    appendData(hips, transformData(cylinderData(0.155 * s, 0.145 * s, 0.20 * s, 10, 1, true), [0, 0.02 * s, 0], [0, 0, 0], [1, 1, 0.78]));
    this.attach('hips', hips, M.cloth);

    const chestW = o.chest ?? 1;
    const spine = emptyData();
    appendData(spine, transformData(cylinderData(0.145 * s, 0.165 * s * chestW, 0.22 * s, 10, 1, true), [0, 0.10 * s, 0], [0, 0, 0], [1, 1, 0.72]));
    this.attach('spine', spine, M.cloth);

    const chest = emptyData();
    // ribcage tapering up into the shoulders, then the shoulder yoke across the top
    appendData(chest, transformData(cylinderData(0.165 * s * chestW, 0.150 * s * chestW, 0.20 * s, 10, 1, true), [0, 0.09 * s, 0], [0, 0, 0], [1, 1, 0.70]));
    appendData(chest, transformData(cylinderData(0.075 * s, 0.075 * s, 0.30 * s * chestW, 8, 1, true), [0, 0.145 * s, 0], [0, 0, 90], [1, 1, 0.8]));
    this.attach('chest', chest, M.cloth);

    const neck = emptyData();
    appendData(neck, transformData(cylinderData(0.055 * s, 0.050 * s, 0.12 * s, 8, 1, true), [0, 0.05 * s, 0]));
    this.attach('neck', neck, M.skin);

    const head = emptyData();
    appendData(head, transformData(sphereData(0.105 * s, 12, 9), [0, 0.05 * s, 0], [0, 0, 0], [0.90, 1.14, 0.96]));
    this.attach('head', head, M.skin);

    // --- arms
    for (const side of ['L', 'R'] as const) {
      const upper = emptyData();
      appendData(upper, transformData(sphereData(0.062 * s * bulk, 8, 6), [0, 0, 0]));            // shoulder ball
      appendData(upper, limb(0.058 * s * bulk, 0.048 * s * bulk, 0.27 * s));
      this.attach(`upperArm${side}` as Joint, upper, M.cloth);

      const fore = emptyData();
      appendData(fore, limb(0.048 * s * bulk, 0.038 * s * bulk, 0.25 * s));
      this.attach(`forearm${side}` as Joint, fore, M.skin);

      const hand = emptyData();
      appendData(hand, transformData(sphereData(0.046 * s, 7, 5), [0, -0.045 * s, 0], [0, 0, 0], [1, 1.25, 0.8]));
      this.attach(`hand${side}` as Joint, hand, M.skin);
    }

    // --- legs
    for (const side of ['L', 'R'] as const) {
      const thigh = emptyData();
      appendData(thigh, transformData(sphereData(0.082 * s * bulk, 8, 6), [0, 0, 0]));
      appendData(thigh, limb(0.080 * s * bulk, 0.062 * s * bulk, 0.43 * s));
      this.attach(`thigh${side}` as Joint, thigh, M.cloth);

      const shin = emptyData();
      appendData(shin, limb(0.060 * s * bulk, 0.044 * s * bulk, 0.41 * s));
      this.attach(`shin${side}` as Joint, shin, M.cloth);

      const foot = emptyData();
      appendData(foot, transformData(cylinderData(0.062 * s, 0.050 * s, 0.20 * s, 6, 1, true), [0, -0.025 * s, 0.045 * s], [90, 0, 0], [1, 1, 0.6]));
      this.attach(`foot${side}` as Joint, foot, M.armor);
    }

    // --- a short split skirt hanging off the hips reads as cloth without needing simulation
    const skirt = o.skirt ?? 0;
    if (skirt > 0) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const panel = emptyData();
        appendData(panel, transformData(
          cylinderData(0.075 * s, 0.055 * s, skirt * s, 4, 1, false),
          [Math.cos(a) * 0.135 * s, -skirt * 0.5 * s - 0.04 * s, Math.sin(a) * 0.105 * s],
          [Math.cos(a) * 7, -a / Math.PI * 180, Math.sin(a) * 7], [1.5, 1, 0.6]));
        this.attach('hips', panel, o.skirtAccent && i % 2 === 1 ? this.mats.accent : this.mats.cloth);
      }
    }
  }

  /** World position of a joint. PlayCanvas returns its internal vector, so copy before keeping it. */
  jointPos(j: Joint): Vec3 { return this.joints[j].getPosition(); }

  destroy(): void { this.root.destroy(); }
}
