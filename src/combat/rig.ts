import { Color, Entity, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import {
  appendData, boxData, createMesh, cylinderData, emptyData, flatShade, sphereData, transformData, type MeshData,
} from '@/utils/geometry';
import { characterMaterial, type CharacterMaterialOpts } from './materials';

/**
 * A jointed humanoid skeleton.
 *
 * The shrine's ambient NPCs (src/world/npc.ts) animate by moving whole body parts, which is fine
 * for someone standing still and breathing but falls apart the moment a limb has to bend. Combat
 * needs elbows and knees, so fighters get this instead: every joint is its own entity, geometry
 * hangs off the joint it belongs to, and animation is pure local rotation. No skinning, no bone
 * weights — at these silhouette sizes an articulated chain of solids reads the same and costs a
 * fraction of the setup.
 *
 * Every mesh is flat-shaded at build time. Smooth-shaded low-segment cylinders read as balloons;
 * the same geometry with hard facets reads as carved, stylised form, and that is most of the
 * distance between a placeholder and a character.
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

/** Limb lengths in metres at scale 1 — the IK solver and the grounding pass both need them. */
export const UPPER_ARM = 0.27;
export const FOREARM = 0.25;
export const THIGH = 0.43;
export const SHIN = 0.41;
/** distance from the ankle joint down to the sole */
export const SOLE = 0.085;
export const HIPS_Y = 0.94;

/**
 * Where each joint sits relative to its parent, and the rest rotation it holds.
 * Scaled by the character's height multiplier at build time.
 */
const SKELETON: Record<Joint, { parent: Joint | null; pos: readonly [number, number, number]; rest?: readonly [number, number, number] }> = {
  hips:      { parent: null,    pos: [0, HIPS_Y, 0] },
  spine:     { parent: 'hips',  pos: [0, 0.15, 0] },
  chest:     { parent: 'spine', pos: [0, 0.20, 0] },
  neck:      { parent: 'chest', pos: [0, 0.19, 0] },
  head:      { parent: 'neck',  pos: [0, 0.10, 0] },

  // shoulders sit a little wider than the ribcage; the rest pose rolls the arms out to clear it
  clavL:     { parent: 'chest', pos: [-0.07, 0.145, 0] },
  upperArmL: { parent: 'clavL', pos: [-0.135, 0, 0], rest: [0, 0, -7] },
  forearmL:  { parent: 'upperArmL', pos: [0, -UPPER_ARM, 0] },
  handL:     { parent: 'forearmL', pos: [0, -FOREARM, 0] },

  clavR:     { parent: 'chest', pos: [0.07, 0.145, 0] },
  upperArmR: { parent: 'clavR', pos: [0.135, 0, 0], rest: [0, 0, 7] },
  forearmR:  { parent: 'upperArmR', pos: [0, -UPPER_ARM, 0] },
  handR:     { parent: 'forearmR', pos: [0, -FOREARM, 0] },

  thighL:    { parent: 'hips', pos: [-0.105, -0.05, 0] },
  shinL:     { parent: 'thighL', pos: [0, -THIGH, 0] },
  footL:     { parent: 'shinL', pos: [0, -SHIN, 0] },

  thighR:    { parent: 'hips', pos: [0.105, -0.05, 0] },
  shinR:     { parent: 'thighR', pos: [0, -THIGH, 0] },
  footR:     { parent: 'shinR', pos: [0, -SHIN, 0] },
};

export interface RigPalette {
  cloth: Color;      // main garment
  cloth2: Color;     // trousers / under-layer
  leather: Color;    // boots, belts, wraps, grips
  skin: Color;
  hair: Color;
  accent: Color;     // sash, trim
  accentGlow?: number;
}

/** A limb solid: a tapered prism from the joint down toward its child. */
function limb(rTop: number, rBot: number, len: number, segs = 7): MeshData {
  return transformData(cylinderData(rBot, rTop, len, segs, 1, true), [0, -len * 0.5, 0]);
}

export class Rig {
  readonly root: Entity;
  readonly joints = {} as Record<Joint, Entity>;
  readonly scale: number;
  /** materials are exposed so characters can flash them on hit or dissolve them on defeat */
  readonly mats: Record<'cloth' | 'cloth2' | 'leather' | 'skin' | 'hair' | 'accent', StandardMaterial>;
  private restPose: Pose = {};
  private pending = new Map<Joint, Map<StandardMaterial, MeshData>>();
  private extraMats: StandardMaterial[] = [];

  constructor(private ctx: EngineContext, name: string, palette: RigPalette, scale = 1) {
    this.scale = scale;
    this.root = new Entity(name);

    const mk = (n: string, c: Color, o: CharacterMaterialOpts): StandardMaterial =>
      characterMaterial(ctx, `${name}-${n}`, c, o);
    this.mats = {
      cloth:   mk('cloth', palette.cloth, { kind: 'cloth' }),
      cloth2:  mk('cloth2', palette.cloth2, { kind: 'cloth' }),
      leather: mk('leather', palette.leather, { kind: 'leather' }),
      skin:    mk('skin', palette.skin, { kind: 'skin' }),
      hair:    mk('hair', palette.hair, { kind: 'hair' }),
      accent:  mk('accent', palette.accent, { kind: 'cloth', glow: palette.accentGlow ?? 0 }),
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

  /** An extra material owned by this rig (a hair streak, a blade), so characters need no bookkeeping. */
  material(name: string, c: Color, o: CharacterMaterialOpts): StandardMaterial {
    const m = characterMaterial(this.ctx, `${this.root.name}-${name}`, c, o);
    this.extraMats.push(m);
    return m;
  }

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

  /** Realise every queued mesh, flat-shaded. Characters call this once, after dressing the rig. */
  build(): void {
    for (const [joint, byMat] of this.pending) {
      for (const [mat, data] of byMat) {
        this.attachTo(this.joints[joint], flatShade(data), mat, `${joint}-${mat.name}`);
      }
    }
    this.pending.clear();
  }

  /** Attach immediately onto any entity in the hierarchy — used for weapon holders. */
  attachTo(parent: Entity, data: MeshData, mat: StandardMaterial, name = 'geo'): MeshInstance {
    const mi = new MeshInstance(createMesh(this.ctx.device, data), mat);
    const e = new Entity(name);
    e.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true });
    parent.addChild(e);
    return mi;
  }

  /**
   * The default body. Characters call this and then add their own silhouette pieces on top.
   *
   * Proportions lean slightly heroic — a touch more shoulder and leg than life — because at the
   * distance the camera sits, true-to-life proportions read as short and soft.
   */
  buildBody(o: { chest?: number; limbs?: number } = {}): void {
    const s = this.scale;
    const bulk = o.limbs ?? 1;
    const M = this.mats;
    const chestW = o.chest ?? 1;

    // --- pelvis + torso: an eight-sided core, wider than deep
    const hips = emptyData();
    appendData(hips, transformData(cylinderData(0.150 * s, 0.140 * s, 0.20 * s, 8, 1, true), [0, 0.02 * s, 0], [0, 0, 0], [1, 1, 0.72]));
    this.attach('hips', hips, M.cloth2);

    const spine = emptyData();
    appendData(spine, transformData(cylinderData(0.140 * s, 0.160 * s * chestW, 0.22 * s, 8, 1, true), [0, 0.10 * s, 0], [0, 0, 0], [1, 1, 0.68]));
    this.attach('spine', spine, M.cloth);

    const chest = emptyData();
    // ribcage into the shoulders, then a yoke across the top that gives the trapezius line
    appendData(chest, transformData(cylinderData(0.160 * s * chestW, 0.135 * s * chestW, 0.20 * s, 8, 1, true), [0, 0.09 * s, 0], [0, 0, 0], [1, 1, 0.66]));
    appendData(chest, transformData(cylinderData(0.070 * s, 0.070 * s, 0.34 * s * chestW, 6, 1, true), [0, 0.15 * s, 0], [0, 0, 90], [1, 1, 0.75]));
    this.attach('chest', chest, M.cloth);

    const neck = emptyData();
    appendData(neck, transformData(cylinderData(0.052 * s, 0.048 * s, 0.12 * s, 6, 1, true), [0, 0.05 * s, 0]));
    this.attach('neck', neck, M.skin);

    // head: a squared-off skull, jaw slightly narrower than the crown
    const head = emptyData();
    appendData(head, transformData(sphereData(0.105 * s, 8, 6), [0, 0.055 * s, 0.005 * s], [0, 0, 0], [0.88, 1.16, 0.94]));
    this.attach('head', head, M.skin);

    // --- arms
    for (const side of ['L', 'R'] as const) {
      const upper = emptyData();
      appendData(upper, transformData(sphereData(0.064 * s * bulk, 7, 5), [0, 0, 0]));           // shoulder ball
      appendData(upper, limb(0.060 * s * bulk, 0.050 * s * bulk, UPPER_ARM * s));
      this.attach(`upperArm${side}` as Joint, upper, M.cloth);

      const fore = emptyData();
      appendData(fore, limb(0.050 * s * bulk, 0.040 * s * bulk, FOREARM * s));
      this.attach(`forearm${side}` as Joint, fore, M.skin);

      // a closed fist: palm block with a knuckle ridge and a thumb, hollow enough to wrap a grip.
      // Local -Y continues the forearm; the grip axis runs through the fist along local Z.
      const hand = emptyData();
      appendData(hand, transformData(boxData(0.074 * s, 0.078 * s, 0.062 * s), [0, -0.045 * s, 0.004 * s], [0, 0, 0]));
      appendData(hand, transformData(boxData(0.070 * s, 0.032 * s, 0.028 * s), [0, -0.086 * s, 0.026 * s], [18, 0, 0]));  // curled fingers
      appendData(hand, transformData(boxData(0.024 * s, 0.040 * s, 0.026 * s), [(side === 'L' ? 1 : -1) * 0.040 * s, -0.036 * s, 0.028 * s], [0, 0, 0])); // thumb
      this.attach(`hand${side}` as Joint, hand, M.skin);
    }

    // --- legs
    for (const side of ['L', 'R'] as const) {
      const thigh = emptyData();
      appendData(thigh, transformData(sphereData(0.090 * s * bulk, 7, 5), [0, 0, 0]));
      appendData(thigh, limb(0.090 * s * bulk, 0.070 * s * bulk, THIGH * s));
      this.attach(`thigh${side}` as Joint, thigh, M.cloth2);

      const shin = emptyData();
      appendData(shin, limb(0.068 * s * bulk, 0.050 * s * bulk, SHIN * s));
      this.attach(`shin${side}` as Joint, shin, M.cloth2);

      // a boot: ankle cuff, a foot that actually points forward, and a sole the grounding pass
      // can measure to. The toe sits 0.17 m ahead of the ankle so the foot has a direction.
      const foot = emptyData();
      appendData(foot, transformData(cylinderData(0.058 * s, 0.054 * s, 0.10 * s, 7, 1, true), [0, -0.03 * s, 0]));
      appendData(foot, transformData(boxData(0.086 * s, 0.062 * s, 0.24 * s), [0, -(SOLE - 0.031) * s, 0.055 * s]));
      appendData(foot, transformData(boxData(0.070 * s, 0.040 * s, 0.07 * s), [0, -(SOLE - 0.020) * s, 0.16 * s], [-8, 0, 0])); // toe cap
      this.attach(`foot${side}` as Joint, foot, M.leather);
    }
  }

  /**
   * Hanging cloth panels — a split skirt, coat tails, a tabard. Flat planks rather than cylinder
   * segments, which is what makes them read as cloth with a hem rather than as a lampshade.
   */
  panels(joint: Joint, mat: StandardMaterial, spec: { angles: number[]; width: number; length: number; radius: number; drop?: number; flare?: number; }): void {
    const s = this.scale;
    for (const deg of spec.angles) {
      const a = deg * Math.PI / 180;
      const d = emptyData();
      appendData(d, transformData(
        boxData(spec.width * s, spec.length * s, 0.012 * s),
        [Math.sin(a) * spec.radius * s, (-(spec.length * 0.5) - (spec.drop ?? 0.04)) * s, Math.cos(a) * spec.radius * s * 0.85],
        [Math.cos(a) * (spec.flare ?? 6), deg, -Math.sin(a) * (spec.flare ?? 6)]));
      this.attach(joint, d, mat);
    }
  }

  /** World position of a joint. PlayCanvas returns its internal vector, so copy before keeping it. */
  jointPos(j: Joint): Vec3 { return this.joints[j].getPosition(); }

  destroy(): void { this.root.destroy(); }
}
