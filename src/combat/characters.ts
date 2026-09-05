import { Color, Entity, StandardMaterial, Vec3 } from 'playcanvas';
import { Animator, type FighterAnimator } from './anim';
import type { EngineContext } from '@/core/engine';
import { appendData, boxData, cylinderData, emptyData, sphereData, transformData, type MeshData } from '@/utils/geometry';
import { Rig, type Joint } from './rig';
import { buildKatana, buildNunchucks, type WeaponBuild } from './weapons';

/**
 * The cast: three silhouettes, one art direction.
 *
 * They have to be told apart instantly at 15 m in fog, so each is built around a different shape
 * language AND a different colour key: the katana fighter is black, layered and vertical with a
 * white streak in the hair; the nunchuck fighter is navy with cyan panels, narrow and diagonal;
 * the enemies are black with an orange kasa and mask, hunched and ragged.
 *
 * All the dressing is planar — tabard panels, coat tails, collar flaps, hair wedges — because flat
 * planks with a hem read as cloth, where more cylinders would just read as more balloon.
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
  animator: FighterAnimator;
  /** materials that flash white when a hit lands */
  flashMats: StandardMaterial[];
  chest(): Vec3;
  /** the procedural rig, when the body is one: feet grounding and the grip IK live in the actor */
  rig?: Rig;
  destroy(): void;
}

/** A Fighter around a procedural rig. */
function fromRig(rig: Rig, weapon: WeaponBuild, height: number, extra: Partial<Fighter> = {}): Fighter {
  return {
    rig, root: rig.root, scale: rig.scale, height, weapon, weaponEntity: weapon.entity,
    animator: new Animator(rig), flashMats: [rig.mats.accent],
    chest: () => rig.jointPos('chest'), destroy: () => rig.destroy(), ...extra,
  };
}

// ------------------------------------------------------------ shared pieces

/** The lower-face mask every fighter wears: a wrapped band under the eyes. Face is -Z. */
function faceMask(rig: Rig, mat = rig.mats.cloth): void {
  const s = rig.scale;
  const d = emptyData();
  appendData(d, transformData(boxData(0.176 * s, 0.072 * s, 0.060 * s), [0, 0.012 * s, -0.070 * s], [-6, 0, 0]));
  appendData(d, transformData(boxData(0.10 * s, 0.05 * s, 0.03 * s), [0, 0.004 * s, -0.104 * s]));   // the bridge over the nose
  rig.attach('head', d, mat);
}

/** Wrapped forearms: three leather bands, slightly staggered so they read as a wrap not a tube. */
function forearmWraps(rig: Rig, mat = rig.mats.leather): void {
  const s = rig.scale;
  for (const side of ['L', 'R'] as const) {
    const d = emptyData();
    for (let i = 0; i < 3; i++) {
      appendData(d, transformData(cylinderData(0.049 * s, 0.045 * s, 0.038 * s, 7, 1, false),
        [0, (-0.09 - i * 0.045) * s, 0], [0, i * 25, 0], [1.06, 1, 1.06]));
    }
    rig.attach(`forearm${side}` as Joint, d, mat);
  }
}

/** A hair mass built from angled wedges — a cap plus tufts, biased to the back of the skull. */
function hair(rig: Rig, mat = rig.mats.hair, o: { tufts?: number; topknot?: boolean; streak?: Color } = {}): void {
  const s = rig.scale;
  const d = emptyData();
  appendData(d, transformData(sphereData(0.112 * s, 8, 6), [0, 0.085 * s, 0.018 * s], [0, 0, 0], [0.96, 0.78, 1.0]));
  const n = o.tufts ?? 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const back = Math.cos(a);                        // +1 at the back, -1 over the face
    if (back < -0.55) continue;                      // keep the brow clear
    appendData(d, transformData(boxData(0.052 * s, 0.11 * s, 0.03 * s),
      [Math.sin(a) * 0.088 * s, (0.105 + back * 0.02) * s, Math.cos(a) * 0.082 * s],
      [-back * 34 - 12, -a * 180 / Math.PI + 90, Math.sin(a) * 30]));
  }
  rig.attach('head', d, mat);
  if (o.topknot) {
    const k = emptyData();
    appendData(k, transformData(cylinderData(0.032 * s, 0.020 * s, 0.10 * s, 6, 1, true), [0, 0.20 * s, 0.03 * s], [-38, 0, 0]));
    appendData(k, transformData(cylinderData(0.026 * s, 0.026 * s, 0.024 * s, 6, 1, true), [0, 0.156 * s, 0.006 * s], [-20, 0, 0]));
    rig.attach('head', k, mat);
  }
  if (o.streak) {
    // a single pale lock falling over the brow — the one detail that names the character at range
    const w = rig.material('streak', o.streak, { kind: 'hair' });
    const st = emptyData();
    appendData(st, transformData(boxData(0.06 * s, 0.12 * s, 0.028 * s), [-0.035 * s, 0.112 * s, -0.082 * s], [26, 18, -16]));
    appendData(st, transformData(boxData(0.04 * s, 0.09 * s, 0.024 * s), [0.03 * s, 0.13 * s, -0.076 * s], [22, -12, 12]));
    rig.attach('head', st, w);
  }
}


/** Wide trousers over the base leg — hakama-like on the thigh, gathered toward the boot. */
function trousers(rig: Rig, mat = rig.mats.cloth2, o: { thigh?: number; shin?: number; cuff?: boolean } = {}): void {
  const s = rig.scale;
  const th = o.thigh ?? 0.098, sh = o.shin ?? 0.086;
  for (const side of ['L', 'R'] as const) {
    const t = emptyData();
    appendData(t, transformData(cylinderData(th * s, (th + 0.004) * s, 0.36 * s, 7, 1, false), [0, -0.21 * s, 0]));
    rig.attach(`thigh${side}` as Joint, t, mat);
    const g = emptyData();
    appendData(g, transformData(cylinderData(sh * s, (sh * 0.72) * s, 0.30 * s, 7, 1, false), [0, -0.16 * s, 0]));
    rig.attach(`shin${side}` as Joint, g, mat);
    if (o.cuff !== false) {
      const c = emptyData();
      appendData(c, transformData(cylinderData(0.060 * s, 0.056 * s, 0.05 * s, 7, 1, false), [0, -0.33 * s, 0], [0, 0, 0], [1.02, 1, 1.02]));
      rig.attach(`shin${side}` as Joint, c, rig.mats.leather);
    }
  }
}

// ------------------------------------------------------------------ player

export function makeWarrior(ctx: EngineContext): Fighter {
  const rig = new Rig(ctx, 'warrior', {
    cloth: new Color(0.055, 0.055, 0.070),
    cloth2: new Color(0.070, 0.070, 0.088),
    leather: new Color(0.105, 0.095, 0.115),
    skin: new Color(0.54, 0.39, 0.31),
    hair: new Color(0.045, 0.045, 0.055),
    accent: new Color(0.32, 0.30, 0.66),
    accentGlow: 0.10,
  }, 1.0);
  rig.buildBody({ chest: 1.06, limbs: 1.0 });
  const s = rig.scale;
  const M = rig.mats;

  // --- collar and crossed lapels: the layered front the reference has
  const collar = emptyData();
  appendData(collar, transformData(cylinderData(0.085 * s, 0.10 * s, 0.09 * s, 8, 1, false), [0, 0.045 * s, -0.005 * s], [0, 0, 0], [1, 1, 0.9]));
  rig.attach('neck', collar, M.cloth);
  const lapels = emptyData();
  appendData(lapels, transformData(boxData(0.13 * s, 0.24 * s, 0.014 * s), [-0.045 * s, 0.06 * s, -0.128 * s], [-4, 0, -22]));
  appendData(lapels, transformData(boxData(0.13 * s, 0.24 * s, 0.014 * s), [0.045 * s, 0.05 * s, -0.132 * s], [-4, 0, 22]));
  rig.attach('chest', lapels, M.cloth);

  // --- layered shoulders: two stacked plates per side, the top one in leather
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? -1 : 1;
    const lower = emptyData();
    appendData(lower, transformData(boxData(0.125 * s, 0.045 * s, 0.15 * s), [sign * 0.008 * s, -0.005 * s, 0], [0, 0, sign * -20]));
    rig.attach(`upperArm${side}`, lower, M.cloth);
    const upper = emptyData();
    appendData(upper, transformData(boxData(0.10 * s, 0.04 * s, 0.12 * s), [sign * 0.004 * s, 0.045 * s, 0], [0, 0, sign * -16]));
    rig.attach(`upperArm${side}`, upper, M.leather);
  }

  // --- indigo sash with a hanging knot, then long coat tails to the knee
  const sash = emptyData();
  appendData(sash, transformData(cylinderData(0.152 * s, 0.150 * s, 0.075 * s, 8, 1, false), [0, 0.10 * s, 0], [0, 0, 0], [1, 1, 0.76]));
  appendData(sash, transformData(boxData(0.06 * s, 0.30 * s, 0.012 * s), [-0.13 * s, -0.08 * s, -0.04 * s], [4, 70, 6]));
  rig.attach('hips', sash, M.accent);
  rig.panels('hips', M.cloth, { angles: [155, 205], width: 0.15, length: 0.46, radius: 0.13, flare: 5 });
  rig.panels('hips', M.cloth, { angles: [-25, 25], width: 0.17, length: 0.50, radius: 0.12, flare: 4 });
  rig.panels('hips', M.cloth, { angles: [90, 270], width: 0.10, length: 0.42, radius: 0.15, flare: 8 });

  // --- the saya on the left hip, angled back, held by a cord
  const saya = emptyData();
  appendData(saya, transformData(boxData(0.032 * s, 0.86 * s, 0.05 * s), [-0.14 * s, -0.06 * s, 0.10 * s], [-22, 4, -64]));
  rig.attach('hips', saya, M.leather);
  const cord = emptyData();
  appendData(cord, transformData(cylinderData(0.018 * s, 0.018 * s, 0.06 * s, 6, 1, false), [-0.15 * s, 0.03 * s, 0.09 * s], [-22, 4, -64], [1.4, 1, 1.4]));
  rig.attach('hips', cord, M.accent);

  trousers(rig, M.cloth2, { thigh: 0.104, shin: 0.090 });
  forearmWraps(rig);
  faceMask(rig);
  hair(rig, M.hair, { tufts: 8, streak: new Color(0.90, 0.90, 0.93) });
  rig.build();

  const katana = buildKatana(ctx,
    rig.material('steel', new Color(0.84, 0.87, 0.92), { kind: 'blade' }),
    rig.material('wrap', new Color(0.16, 0.15, 0.19), { kind: 'leather' }),
    rig.material('fitting', new Color(0.46, 0.38, 0.22), { kind: 'metal' }));
  // seated in the fist: the tsuka runs through the closed hand along its grip axis
  katana.entity.setLocalPosition(0, -0.048 * s, 0.004 * s);
  katana.entity.setLocalEulerAngles(-112, 0, 0);
  rig.joints.handR.addChild(katana.entity);

  return fromRig(rig, katana, 1.80);
}

// ------------------------------------------------------------------- ally

export function makeAlly(ctx: EngineContext): Fighter {
  const rig = new Rig(ctx, 'ally', {
    cloth: new Color(0.11, 0.13, 0.30),
    cloth2: new Color(0.085, 0.095, 0.20),
    leather: new Color(0.12, 0.11, 0.13),
    skin: new Color(0.58, 0.42, 0.33),
    hair: new Color(0.25, 0.13, 0.07),
    accent: new Color(0.36, 0.86, 0.96),
    accentGlow: 0.30,
  }, 0.96);
  rig.buildBody({ chest: 0.96, limbs: 0.94 });
  const s = rig.scale;
  const M = rig.mats;

  // --- a short wrapped jacket with a cross-over front
  const jacket = emptyData();
  appendData(jacket, transformData(cylinderData(0.170 * s, 0.150 * s, 0.24 * s, 8, 1, false), [0, 0.06 * s, 0], [0, 0, 0], [1, 1, 0.70]));
  appendData(jacket, transformData(boxData(0.12 * s, 0.20 * s, 0.014 * s), [-0.04 * s, 0.05 * s, -0.118 * s], [-3, 0, -18]));
  rig.attach('chest', jacket, M.cloth);

  // --- cyan sash and the two hanging tabard panels that carry the whole silhouette
  const sash = emptyData();
  appendData(sash, transformData(cylinderData(0.150 * s, 0.148 * s, 0.09 * s, 8, 1, false), [0, 0.09 * s, 0], [0, 0, 0], [1, 1, 0.78]));
  appendData(sash, transformData(boxData(0.05 * s, 0.26 * s, 0.012 * s), [0.14 * s, -0.06 * s, 0.02 * s], [6, -80, -5]));
  rig.attach('hips', sash, M.accent);
  rig.panels('hips', M.accent, { angles: [160, 200], width: 0.13, length: 0.40, radius: 0.125, flare: 5 });
  rig.panels('hips', M.cloth, { angles: [0], width: 0.20, length: 0.36, radius: 0.13, flare: 4 });

  trousers(rig, M.cloth2, { thigh: 0.098, shin: 0.088 });

  forearmWraps(rig);
  faceMask(rig, M.cloth2);
  hair(rig, M.hair, { tufts: 6, topknot: true });
  rig.build();

  const chucks = buildNunchucks(ctx,
    rig.material('chuck-wood', new Color(0.14, 0.12, 0.16), { kind: 'leather' }),
    rig.material('chuck-chain', new Color(0.60, 0.62, 0.66), { kind: 'metal' }),
    rig.material('chuck-cap', new Color(0.40, 0.90, 1.0), { kind: 'metal', glow: 1.4 }));
  chucks.entity.setLocalPosition(0, -0.05 * s, 0.004 * s);
  chucks.entity.setLocalEulerAngles(-100, 0, 0);
  rig.joints.handR.addChild(chucks.entity);

  return fromRig(rig, chucks, 1.72, { freeChuck: chucks.free });
}

// ------------------------------------------------------------------ enemy

export type EnemyKind = 'grunt' | 'blade' | 'elite';

export function makeEnemy(ctx: EngineContext, kind: EnemyKind, seedTint = 0): Fighter {
  const elite = kind === 'elite';
  const scale = elite ? 1.10 : kind === 'blade' ? 1.0 : 0.95;
  const accent = elite ? new Color(0.96, 0.30, 0.18) : new Color(0.92, 0.44, 0.14);
  const rig = new Rig(ctx, `enemy-${kind}`, {
    cloth: new Color(0.060 + seedTint * 0.02, 0.055, 0.068 + seedTint * 0.02),
    cloth2: new Color(0.075, 0.070, 0.082),
    leather: new Color(0.11, 0.10, 0.10),
    skin: new Color(0.22, 0.18, 0.19),
    hair: new Color(0.04, 0.035, 0.04),
    accent,
    accentGlow: elite ? 0.55 : 0.25,
  }, scale);
  rig.buildBody({ chest: elite ? 1.12 : 0.98, limbs: elite ? 1.08 : 0.92 });
  const s = rig.scale;
  const M = rig.mats;

  // --- ragged cowl over the shoulders: torn panels hanging off the chest yoke
  rig.panels('chest', M.cloth, { angles: [20, 70, 120, 200, 250, 300], width: 0.09, length: 0.22, radius: 0.16, drop: -0.16, flare: 12 });

  // --- orange sash and a single front panel
  const sash = emptyData();
  appendData(sash, transformData(cylinderData(0.150 * s, 0.148 * s, 0.07 * s, 8, 1, false), [0, 0.09 * s, 0], [0, 0, 0], [1, 1, 0.76]));
  rig.attach('hips', sash, M.accent);
  rig.panels('hips', M.accent, { angles: [180], width: 0.14, length: 0.34, radius: 0.12, flare: 4 });
  rig.panels('hips', M.cloth, { angles: [-30, 30, 130, 230], width: 0.12, length: 0.40, radius: 0.13, flare: 6 });

  // --- the head: an orange face plate with a dark eye band, under a kasa (or a hood for grunts)
  const plateMat = rig.material('plate', accent, { kind: 'metal', glow: elite ? 0.5 : 0.22 });
  const plate = emptyData();
  appendData(plate, transformData(boxData(0.15 * s, 0.17 * s, 0.05 * s), [0, 0.045 * s, -0.082 * s], [-6, 0, 0]));
  rig.attach('head', plate, plateMat);
  const band = emptyData();
  appendData(band, transformData(boxData(0.16 * s, 0.03 * s, 0.03 * s), [0, 0.075 * s, -0.104 * s]));
  rig.attach('head', band, M.hair);
  if (kind === 'grunt') {
    const hood = emptyData();
    appendData(hood, transformData(sphereData(0.122 * s, 8, 6), [0, 0.07 * s, 0.02 * s], [0, 0, 0], [1, 1.02, 1.04]));
    rig.attach('head', hood, M.cloth);
  } else {
    const kasa = emptyData();
    const kr = (elite ? 0.26 : 0.23) * s, kh = (elite ? 0.20 : 0.17) * s;
    appendData(kasa, transformData(cylinderData(kr, 0.014 * s, kh, 8, 1, false), [0, (0.135 * s) + kh * 0.5, 0.01 * s], [5, 0, 0]));
    appendData(kasa, transformData(cylinderData(0.026 * s, 0.014 * s, 0.05 * s, 6, 1, true), [0, 0.135 * s + kh + 0.015 * s, 0.01 * s], [5, 0, 0]));   // finial
    rig.attach('head', kasa, M.leather);
    // the underside is what the player sees from below, so that is where the colour lives
    const under = emptyData();
    appendData(under, transformData(cylinderData(kr * 0.98, kr * 0.5, 0.012 * s, 8, 1, true), [0, 0.132 * s, 0.01 * s], [5, 0, 0]));
    rig.attach('head', under, M.accent);
  }

  trousers(rig, M.cloth2, { thigh: 0.100, shin: 0.084, cuff: false });
  forearmWraps(rig);
  rig.build();

  // --- a straight, plainer blade than the katana: the silhouette says "not a swordsman"
  const bladeMat = rig.material('blade', new Color(0.42, 0.43, 0.47), { kind: 'blade' });
  const len = elite ? 0.98 : 0.74;
  const w = emptyData();
  appendData(w, transformData(cylinderData(0.020 * s, 0.018 * s, 0.22 * s, 6, 1, true), [0, -0.02 * s, 0]));
  appendData(w, transformData(boxData(0.09 * s, 0.018 * s, 0.03 * s), [0, 0.095 * s, 0]));
  appendData(w, transformData(cylinderData(0.022 * s, 0.014 * s, len * s, 4, 1, true), [0, (0.10 + len * 0.5) * s, 0], [0, 45, 0], [1, 1, 0.35]));
  const holder = new Entity('weapon-holder');
  holder.setLocalPosition(0, -0.048 * s, 0.004 * s);
  holder.setLocalEulerAngles(-112, 0, 0);
  rig.joints.handR.addChild(holder);
  rig.attachTo(holder, w, bladeMat, 'enemy-blade');

  const blade: WeaponBuild = { entity: holder, base: new Vec3(0, 0.12 * s, 0), tip: new Vec3(0, (0.10 + len) * s, 0) };
  return fromRig(rig, blade, 1.80 * scale);
}

export type { MeshData };
