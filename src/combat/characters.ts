import { Color, Entity, StandardMaterial, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { appendData, boxData, cylinderData, emptyData, sphereData, transformData, type MeshData } from '@/utils/geometry';
import { Rig } from './rig';
import { buildKatana, buildNunchucks, type WeaponBuild } from './weapons';

/**
 * The cast: three silhouettes, one art direction.
 *
 * They have to be told apart instantly at 15 m in fog, so each one is built around a different
 * shape language rather than a different colour — the warrior is broad-shouldered and vertical, the
 * ally is narrow and diagonal with a long trailing scarf, the enemies are hunched and ragged with a
 * pale mask that reads as the only bright thing on them.
 */

export interface Fighter {
  rig: Rig;
  weapon: WeaponBuild;
  /** the entity the trail samples, and that hit sweeps are measured from */
  weaponEntity: Entity;
  /** nunchucks only: the spinning half */
  freeChuck?: Entity;
  height: number;
}

function mat(name: string, c: Color, gloss: number, metal = 0, glow = 0): StandardMaterial {
  const m = new StandardMaterial();
  m.name = name;
  m.diffuse = c.clone();
  m.useMetalness = true;
  m.metalness = metal;
  m.gloss = gloss;
  if (glow > 0) { m.emissive = c.clone(); m.emissiveIntensity = glow; }
  m.update();
  return m;
}

/** Lamellar-ish chest plate: overlapping bands read as armour without modelling every scale. */
function plateBands(s: number, count: number, w: number, y0: number, step: number): MeshData {
  const d = emptyData();
  for (let i = 0; i < count; i++) {
    appendData(d, transformData(
      boxData(w * s * (1 - i * 0.035), 0.045 * s, 0.13 * s),
      [0, (y0 + i * step) * s, 0.005 * s], [-4, 0, 0]));
  }
  return d;
}

// ------------------------------------------------------------------ player

export function makeWarrior(ctx: EngineContext): Fighter {
  const rig = new Rig(ctx, 'warrior', {
    cloth: new Color(0.16, 0.18, 0.26),
    armor: new Color(0.32, 0.30, 0.29),
    skin: new Color(0.46, 0.35, 0.29),
    hair: new Color(0.06, 0.05, 0.06),
    accent: new Color(0.17, 0.44, 0.49),
    accentGlow: 0.14,
  }, 1.0);
  // the skirt stays all cloth: alternating it into the accent turned the character's whole lower
  // half into a bright cyan slab and pulled the eye off the blade
  rig.buildBody({ chest: 1.06, limbs: 1.0, skirt: 0.42 });
  const s = rig.scale;
  const M = rig.mats;

  // chest plate + shoulder guards: the broad, vertical silhouette
  rig.attach('chest', plateBands(s, 4, 0.29, 0.02, 0.052), M.armor);
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? -1 : 1;
    const pauldron = emptyData();
    appendData(pauldron, transformData(cylinderData(0.105 * s, 0.075 * s, 0.09 * s, 8, 1, true),
      [sign * 0.02 * s, 0.01 * s, 0], [0, 0, sign * -14], [1, 1, 0.82]));
    rig.attach(`upperArm${side}`, pauldron, M.armor);

    const bracer = emptyData();
    appendData(bracer, transformData(cylinderData(0.052 * s, 0.046 * s, 0.16 * s, 8, 1, true), [0, -0.12 * s, 0]));
    rig.attach(`forearm${side}`, bracer, M.armor);
  }

  // waist sash in the accent colour, plus the tail that hangs behind
  const sash = emptyData();
  appendData(sash, transformData(cylinderData(0.152 * s, 0.152 * s, 0.07 * s, 12, 1, false), [0, 0.10 * s, 0], [0, 0, 0], [1, 1, 0.80]));
  appendData(sash, transformData(boxData(0.07 * s, 0.34 * s, 0.012 * s), [0.10 * s, -0.06 * s, -0.11 * s], [6, -18, 4]));
  rig.attach('hips', sash, M.accent);

  // topknot
  const hair = emptyData();
  appendData(hair, transformData(sphereData(0.108 * s, 12, 9), [0, 0.062 * s, -0.008 * s], [0, 0, 0], [1, 0.72, 1.02]));
  appendData(hair, transformData(cylinderData(0.030 * s, 0.022 * s, 0.11 * s, 7, 1, true), [0, 0.16 * s, -0.045 * s], [26, 0, 0]));
  rig.attach('head', hair, M.hair);

  rig.build();

  const katana = buildKatana(ctx,
    mat('katana-steel', new Color(0.78, 0.82, 0.88), 0.92, 0.9),
    mat('katana-wrap', new Color(0.10, 0.11, 0.14), 0.3),
    mat('katana-fitting', new Color(0.42, 0.34, 0.18), 0.7, 0.8));
  // seated in the fist: the blade continues the line of the closed hand
  katana.entity.setLocalPosition(0, -0.05 * s, 0.015 * s);
  katana.entity.setLocalEulerAngles(-96, 0, 0);
  rig.joints.handR.addChild(katana.entity);

  return { rig, weapon: katana, weaponEntity: katana.entity, height: 1.78 };
}

// ------------------------------------------------------------------- ally

export function makeAlly(ctx: EngineContext): Fighter {
  const rig = new Rig(ctx, 'ally', {
    cloth: new Color(0.22, 0.13, 0.12),
    armor: new Color(0.26, 0.24, 0.23),
    skin: new Color(0.52, 0.40, 0.32),
    hair: new Color(0.07, 0.05, 0.05),
    accent: new Color(0.74, 0.30, 0.14),
    accentGlow: 0.16,
  }, 0.95);
  rig.buildBody({ chest: 0.94, limbs: 0.92, skirt: 0 });
  const s = rig.scale;
  const M = rig.mats;

  // short open jacket + wrapped waist: narrow, diagonal, nothing heavy on the shoulders
  const jacket = emptyData();
  appendData(jacket, transformData(cylinderData(0.175 * s, 0.155 * s, 0.26 * s, 10, 1, false), [0, 0.06 * s, 0], [0, 0, 0], [1, 1, 0.74]));
  rig.attach('chest', jacket, M.cloth);

  const wrap = emptyData();
  appendData(wrap, transformData(cylinderData(0.150 * s, 0.150 * s, 0.10 * s, 12, 1, false), [0, 0.09 * s, 0], [0, 0, 0], [1, 1, 0.80]));
  rig.attach('hips', wrap, M.accent);

  // the long scarf is the ally's whole silhouette read — it trails behind every spin
  const scarf = emptyData();
  appendData(scarf, transformData(cylinderData(0.062 * s, 0.058 * s, 0.09 * s, 10, 1, false), [0, 0.045 * s, 0]));
  rig.attach('neck', scarf, M.accent);
  const tail = emptyData();
  for (let i = 0; i < 4; i++) {
    appendData(tail, transformData(boxData(0.075 * s, 0.20 * s, 0.010 * s),
      [Math.sin(i * 1.1) * 0.03 * s, 0.02 * s - i * 0.185 * s, -0.07 * s - i * 0.055 * s],
      [-16 - i * 5, Math.sin(i * 1.7) * 12, Math.sin(i * 0.9) * 8]));
  }
  rig.attach('neck', tail, M.accent);

  const band = emptyData();
  appendData(band, transformData(sphereData(0.106 * s, 12, 9), [0, 0.05 * s, -0.01 * s], [0, 0, 0], [1, 0.66, 1.02]));
  rig.attach('head', band, M.hair);
  const headband = emptyData();
  appendData(headband, transformData(cylinderData(0.108 * s, 0.108 * s, 0.035 * s, 12, 1, false), [0, 0.075 * s, 0], [0, 0, 0], [1, 1, 0.96]));
  rig.attach('head', headband, M.accent);

  rig.build();

  const chucks = buildNunchucks(ctx,
    mat('chuck-wood', new Color(0.20, 0.13, 0.09), 0.45),
    mat('chuck-metal', new Color(0.55, 0.56, 0.58), 0.85, 0.9));
  chucks.entity.setLocalPosition(0, -0.06 * s, 0.01 * s);
  chucks.entity.setLocalEulerAngles(-100, 0, 0);
  rig.joints.handR.addChild(chucks.entity);

  return { rig, weapon: chucks, weaponEntity: chucks.entity, freeChuck: chucks.free, height: 1.69 };
}

// ------------------------------------------------------------------ enemy

export type EnemyKind = 'grunt' | 'blade' | 'elite';

export function makeEnemy(ctx: EngineContext, kind: EnemyKind, seedTint = 0): Fighter {
  const elite = kind === 'elite';
  const scale = elite ? 1.12 : kind === 'blade' ? 1.0 : 0.94;
  const rig = new Rig(ctx, `enemy-${kind}`, {
    cloth: new Color(0.135 + seedTint * 0.03, 0.120, 0.165 + seedTint * 0.04),
    armor: new Color(0.20, 0.18, 0.23),
    skin: new Color(0.19, 0.17, 0.21),
    hair: new Color(0.04, 0.035, 0.05),
    accent: elite ? new Color(0.95, 0.30, 0.34) : new Color(0.66, 0.34, 0.92),
    accentGlow: elite ? 2.6 : 1.6,
  }, scale);
  rig.buildBody({ chest: elite ? 1.14 : 0.96, limbs: elite ? 1.1 : 0.88, skirt: 0.30 });
  const s = rig.scale;
  const M = rig.mats;

  // ragged shoulder cowl — the hunched, torn silhouette
  const cowl = emptyData();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    appendData(cowl, transformData(boxData(0.10 * s, 0.20 * s + (i % 3) * 0.05 * s, 0.012 * s),
      [Math.cos(a) * 0.16 * s, 0.06 * s, Math.sin(a) * 0.13 * s],
      [8, -a / Math.PI * 180, Math.cos(a) * 10]));
  }
  rig.attach('chest', cowl, M.cloth);

  // The mask is the one pale, readable shape on an otherwise dark figure — but it is a face plate,
  // not a helmet: a saturated glowing sphere over the whole skull just reads as a coloured ball.
  const maskMat = mat(`enemy-mask-${kind}`, new Color(0.68, 0.64, 0.58), 0.42, 0, 0.10);
  const hood = emptyData();
  appendData(hood, transformData(sphereData(0.116 * s, 12, 9), [0, 0.05 * s, -0.02 * s], [0, 0, 0], [1, 1.04, 1.02]));
  rig.attach('head', hood, M.cloth);
  const mask = emptyData();
  appendData(mask, transformData(sphereData(0.098 * s, 10, 8), [0, 0.028 * s, 0.045 * s], [0, 0, 0], [0.86, 0.92, 0.55]));
  rig.attach('head', mask, maskMat);
  // two narrow eye slits carry the accent, so the glow is a detail rather than the whole head
  const eyes = emptyData();
  for (const sign of [-1, 1]) {
    appendData(eyes, transformData(boxData(0.026 * s, 0.010 * s, 0.008 * s),
      [sign * 0.036 * s, 0.045 * s, 0.098 * s], [0, 0, sign * 12]));
  }
  rig.attach('head', eyes, M.accent);

  if (elite) {
    // horns, so the elite is legible as "the big one" from across the courtyard
    for (const sign of [-1, 1]) {
      const horn = emptyData();
      appendData(horn, transformData(cylinderData(0.024 * s, 0.005 * s, 0.24 * s, 6, 1, true),
        [sign * 0.07 * s, 0.13 * s, -0.02 * s], [-22, 0, sign * 26]));
      rig.attach('head', horn, M.armor);
    }
  }

  // a crude cleaver rather than a katana — the silhouette says "not a swordsman"
  const bladeMat = mat(`enemy-blade-${kind}`, new Color(0.30, 0.31, 0.34), 0.68, 0.7);
  const len = elite ? 1.05 : 0.72;
  const w = emptyData();
  appendData(w, transformData(cylinderData(0.026 * s, 0.022 * s, 0.20 * s, 7, 1, true), [0, 0, 0]));
  appendData(w, transformData(boxData(0.055 * s, len * s, 0.014 * s), [0, (0.10 + len * 0.5) * s, 0]));
  appendData(w, transformData(boxData(0.078 * s, 0.17 * s, 0.012 * s), [0.013 * s, (0.10 + len * 0.86) * s, 0], [0, 0, -7]));

  rig.build();

  const holder = new Entity('weapon-holder');
  holder.setLocalPosition(0, -0.05 * s, 0.012 * s);
  holder.setLocalEulerAngles(-98, 0, 0);
  rig.joints.handR.addChild(holder);
  rig.attachTo(holder, w, bladeMat, 'enemy-blade');

  return {
    rig,
    weapon: { entity: holder, base: new Vec3(0, 0.12 * s, 0), tip: new Vec3(0, (0.10 + len) * s, 0) },
    weaponEntity: holder,
    height: 1.78 * scale,
  };
}
