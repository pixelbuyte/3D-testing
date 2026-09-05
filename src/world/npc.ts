import { Color, Entity, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { appendData, createMesh, cylinderData, emptyData, sphereData, transformData, type MeshData } from '@/utils/geometry';
import { clamp01, damp, dampAngle, lerp, rng, DEG, TAU } from '@/utils/math';

export type NpcKind = 'pilgrim' | 'singer' | 'kneeling';

export interface NpcOptions {
  kind: NpcKind;
  robe: Color;
  trim: Color;
  scale?: number;
  seed?: number;
  /** singer only: a soft self-illumination so she reads in the dusk */
  glow?: number;
  /** hooded figures hide the face; Nova is uncovered so she reads as a person */
  hooded?: boolean;
  /** face / hands colour */
  skin?: Color;
  /** hair or cowl colour; defaults to a very dark neutral */
  hair?: Color;
}

/**
 * A procedural robed figure.
 *
 * The shrine is seen at dusk through fog, so these are built for silhouette rather than detail:
 * a tapered robe, a shoulder yoke, a hooded head and simple arms, each on its own entity so the
 * idle can be animated by transform rather than by skinning. About 900 triangles per figure.
 */
export class Npc {
  root: Entity;
  private body: Entity;
  private head: Entity;
  private armL: Entity;
  private armR: Entity;
  private rand: () => number;
  private phase: number;
  private baseY = 0;
  private yaw = 0;
  private targetYaw = 0;
  private time = 0;
  private breath = 0;
  private headY = 1.61;
  readonly kind: NpcKind;
  /** filled in by the director for patrolling figures */
  waypoints: Vec3[] = [];
  private wpIndex = 0;
  private walkSpeed = 0;
  private moving = false;

  constructor(ctx: EngineContext, private opts: NpcOptions, position: Vec3, yawDeg = 0) {
    this.kind = opts.kind;
    this.rand = rng(opts.seed ?? 7);
    this.phase = this.rand() * TAU;
    const s = opts.scale ?? 1;

    const robeMat = new StandardMaterial();
    robeMat.name = `npc-robe-${opts.kind}`;
    robeMat.diffuse = opts.robe.clone();
    robeMat.useMetalness = true;
    robeMat.metalness = 0;
    robeMat.gloss = 0.18;
    if (opts.glow) { robeMat.emissive = opts.robe.clone(); robeMat.emissiveIntensity = opts.glow; }
    robeMat.update();

    const skinMat = new StandardMaterial();
    skinMat.name = `npc-skin-${opts.kind}`;
    skinMat.diffuse = (opts.skin ?? new Color(0.42, 0.33, 0.28)).clone();
    skinMat.useMetalness = true;
    skinMat.metalness = 0;
    skinMat.gloss = 0.26;
    if (opts.glow) { skinMat.emissive = skinMat.diffuse.clone(); skinMat.emissiveIntensity = opts.glow * 0.4; }
    skinMat.update();

    // hair (or the cowl on a hooded figure) is a separate, much darker material: without a
    // value break the head is just a ball the same colour all over and stops reading as a head
    const hairMat = new StandardMaterial();
    hairMat.name = `npc-hair-${opts.kind}`;
    hairMat.diffuse = (opts.hair ?? new Color(0.055, 0.048, 0.052)).clone();
    hairMat.useMetalness = true;
    hairMat.metalness = 0;
    hairMat.gloss = 0.34;
    hairMat.update();

    const trimMat = new StandardMaterial();
    trimMat.name = `npc-trim-${opts.kind}`;
    trimMat.diffuse = opts.trim.clone();
    trimMat.useMetalness = true;
    trimMat.metalness = 0;
    trimMat.gloss = 0.3;
    if (opts.glow) { trimMat.emissive = opts.trim.clone(); trimMat.emissiveIntensity = opts.glow * 1.6; }
    trimMat.update();

    this.root = new Entity(`npc-${opts.kind}`);
    this.root.setPosition(position);
    this.root.setEulerAngles(0, yawDeg, 0);
    this.yaw = this.targetYaw = yawDeg * DEG;
    this.baseY = position.y;

    // --- proportions, in metres for scale 1. A ~1.78 m figure; every part below is placed
    //     from this table so the constructor and the idle animation can never drift apart.
    //  A kneeling figure is not a standing one squashed: the legs fold away entirely and the
    //  robe pools on the stone, so it gets its own table and a much wider hem.
    const kneeling = opts.kind === 'kneeling';
    const HEM_Y = 0.00;
    const KNEE_Y = kneeling ? 0.19 : 0.36;
    const WAIST_Y = kneeling ? 0.52 : 0.98;
    const CHEST_Y = kneeling ? 0.87 : 1.34;
    const NECK_Y = kneeling ? 0.99 : 1.47;
    const HEAD_Y = kneeling ? 1.13 : 1.61;
    const HEM_R = kneeling ? 0.425 : 0.330;
    const KNEE_R = kneeling ? 0.385 : 0.300;
    this.headY = HEAD_Y * s;

    // A body is wider than it is deep and cloth hangs in folds, so the robe sections are built
    // here rather than with the plain cylinder helper: an elliptical cross-section (DEPTH) plus a
    // cosine radius modulation (folds) is what stops the figure reading as a turned cone.
    const DEPTH = 0.74;
    const seg = (r0: number, r1: number, y0: number, y1: number, folds = 5, amp = 0.045): MeshData => {
      const out = emptyData();
      const segs = 20, h = (y1 - y0) * s, y = y0 * s;
      const slope = (r0 - r1) / Math.max(h / s, 1e-4);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        // folds run vertically and shallow out toward the top, the way gathered cloth does
        const f0 = 1 + Math.cos(a * folds) * amp;
        const f1 = 1 + Math.cos(a * folds) * amp * 0.55;
        const rb = r0 * s * f0, rt = r1 * s * f1;
        // radial normal, tilted by the cone slope and skewed by the ellipse
        const nx = ca / DEPTH, nz = sa * DEPTH;
        const nl = 1 / Math.hypot(nx, slope, nz);
        out.positions.push(ca * rb, y, sa * rb * DEPTH, ca * rt, y + h, sa * rt * DEPTH);
        out.normals.push(nx * nl, slope * nl, nz * nl, nx * nl, slope * nl, nz * nl);
        out.uvs.push(i / segs, 0, i / segs, 1);
      }
      for (let i = 0; i < segs; i++) {
        const b = i * 2;
        out.indices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      }
      return out;
    };

    // --- under-robe: hem -> skirt -> torso -> shoulder slope, merged into one mesh
    const robe: MeshData = emptyData();
    appendData(robe, seg(HEM_R, KNEE_R, HEM_Y, KNEE_Y, 7, 0.055));
    appendData(robe, seg(KNEE_R, 0.210, KNEE_Y, WAIST_Y, 7, 0.050));
    appendData(robe, seg(0.210, 0.232, WAIST_Y, CHEST_Y, 5, 0.030));
    appendData(robe, seg(0.232, 0.085, CHEST_Y, NECK_Y, 5, 0.020));
    const robeMesh = createMesh(ctx.device, robe);

    // --- a shawl over the shoulders in the trim colour. It stops above the elbow so the arms
    //     break the silhouette: a wide pale shoulder mass over a narrow dark robe with arms
    //     hanging clear of it is what makes the figure read as a person at 30 m through fog.
    const mantle: MeshData = emptyData();
    const mr = kneeling ? 0.86 : 1;  // a folded figure has less shoulder to drape
    appendData(mantle, seg(0.286 * mr, 0.262 * mr, WAIST_Y + (kneeling ? 0.07 : 0.14), CHEST_Y - 0.03, 9, 0.035));
    appendData(mantle, seg(0.262 * mr, 0.243 * mr, CHEST_Y - 0.03, CHEST_Y + 0.04, 9, 0.025));
    appendData(mantle, seg(0.243 * mr, 0.096, CHEST_Y + 0.04, NECK_Y - 0.02, 5, 0.015));
    const mantleMesh = createMesh(ctx.device, mantle);

    // --- head: neck + skull in skin, hair/cowl as a separate dark shell
    const skinPart: MeshData = emptyData();
    appendData(skinPart, transformData(cylinderData(0.068 * s, 0.060 * s, 0.17 * s, 10, 1, false), [0, -0.150 * s, 0]));
    appendData(skinPart, transformData(sphereData(0.104 * s, 14, 10), [0, 0, 0], [0, 0, 0], [0.90, 1.15, 0.96]));
    const skinMesh = createMesh(ctx.device, skinPart);

    const hairPart: MeshData = emptyData();
    if (opts.hooded !== false) {
      // a cowl sitting back on the skull with a small brim forward, so the face stays in shadow
      appendData(hairPart, transformData(sphereData(0.140 * s, 14, 10), [0, 0.012 * s, -0.022 * s], [0, 0, 0], [1, 1.04, 1.06]));
      appendData(hairPart, transformData(cylinderData(0.148 * s, 0.114 * s, 0.055 * s, 14, 1, false), [0, 0.050 * s, 0.030 * s], [18, 0, 0]));
    } else {
      // Nova is uncovered: a low cap of hair swept back into a knot, leaving the face lit
      appendData(hairPart, transformData(sphereData(0.113 * s, 14, 10), [0, 0.030 * s, -0.016 * s], [0, 0, 0], [1.0, 0.80, 1.04]));
      appendData(hairPart, transformData(sphereData(0.058 * s, 10, 8), [0, -0.020 * s, -0.118 * s], [0, 0, 0], [1.0, 1.25, 0.85]));
    }
    const hairMesh = createMesh(ctx.device, hairPart);

    // --- arm: sleeve tapering to a hand, in the robe colour so it separates from the pale cape
    const arm: MeshData = emptyData();
    appendData(arm, transformData(cylinderData(0.078 * s, 0.055 * s, 0.48 * s, 8, 1, true), [0, -0.24 * s, 0]));
    const armMesh = createMesh(ctx.device, arm);
    const hand: MeshData = transformData(sphereData(0.056 * s, 8, 6), [0, -0.505 * s, 0], [0, 0, 0], [1, 1.1, 0.85]);
    const handMesh = createMesh(ctx.device, hand);

    this.body = new Entity('body');
    this.body.addComponent('render', { meshInstances: [new MeshInstance(robeMesh, robeMat)], castShadows: true, receiveShadows: true });
    this.root.addChild(this.body);

    const mantleEnt = new Entity('mantle');
    mantleEnt.addComponent('render', { meshInstances: [new MeshInstance(mantleMesh, trimMat)], castShadows: true, receiveShadows: true });
    this.body.addChild(mantleEnt);

    this.head = new Entity('head');
    this.head.addComponent('render', {
      meshInstances: [new MeshInstance(skinMesh, skinMat), new MeshInstance(hairMesh, hairMat)],
      castShadows: true, receiveShadows: true,
    });
    this.head.setLocalPosition(0, this.headY, 0);
    this.root.addChild(this.head);

    // shoulders sit outside the cape hem so the arms break the silhouette rather than hiding in it
    const makeArm = (side: number): Entity => {
      const e = new Entity(side < 0 ? 'armL' : 'armR');
      e.addComponent('render', {
        meshInstances: [new MeshInstance(armMesh, robeMat), new MeshInstance(handMesh, skinMat)],
        castShadows: true, receiveShadows: true,
      });
      e.setLocalPosition(side * 0.222 * s, (CHEST_Y - 0.015) * s, 0.010 * s);
      // a folded arm is shorter than a hanging one; the single rigid segment stands in for both
      if (kneeling) e.setLocalScale(1, 0.70, 1);
      this.body.addChild(e);
      return e;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    if (kneeling) this.head.setLocalEulerAngles(26, 0, 0);

    ctx.app.root.addChild(this.root);
  }

  /** Walk this figure between waypoints (used for the pilgrim on the path). */
  setPatrol(points: Vec3[], speed = 0.55): void {
    this.waypoints = points;
    this.walkSpeed = speed;
    this.moving = points.length > 1;
  }

  /** Turns the figure to face a world point over time. */
  faceTowards(x: number, z: number): void {
    const p = this.root.getPosition();
    this.targetYaw = Math.atan2(-(x - p.x), -(z - p.z));
  }

  update(dt: number, playerPos: Vec3, groundAt: (x: number, z: number) => number): void {
    this.time += dt;
    const s = this.opts.scale ?? 1;
    const t = this.time + this.phase;

    // --- patrol
    if (this.moving && this.waypoints.length > 1) {
      const p = this.root.getPosition();
      const target = this.waypoints[this.wpIndex];
      const dx = target.x - p.x, dz = target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      } else {
        const step = Math.min(this.walkSpeed * dt, d);
        const nx = p.x + (dx / d) * step, nz = p.z + (dz / d) * step;
        this.baseY = groundAt(nx, nz);
        this.root.setPosition(nx, this.baseY, nz);
        this.targetYaw = Math.atan2(-dx, -dz);
      }
    } else if (this.kind !== 'kneeling') {
      // idle figures glance at the player when they come close
      const d = Math.hypot(playerPos.x - this.root.getPosition().x, playerPos.z - this.root.getPosition().z);
      if (d < 14) this.faceTowards(playerPos.x, playerPos.z);
    }

    this.yaw = dampAngle(this.yaw, this.targetYaw, 1.6, dt);
    this.root.setEulerAngles(0, this.yaw / DEG, 0);

    // --- breathing: the torso rises and the robe settles
    this.breath = damp(this.breath, 0.5 + 0.5 * Math.sin(t * 0.9), 6, dt);
    const rise = this.breath * 0.012 * s;
    this.body.setLocalPosition(0, rise, 0);
    this.body.setLocalScale(1 + this.breath * 0.008, 1 - this.breath * 0.004, 1 + this.breath * 0.008);

    // --- a slow weight shift so they never look frozen
    const sway = Math.sin(t * 0.37) * 1.6 + Math.sin(t * 0.19 + 1.1) * 0.9;
    this.body.setLocalEulerAngles(0, 0, sway * 0.35);

    const walkPhase = this.moving ? Math.sin(this.time * 5.2) : 0;
    const headBob = this.moving ? Math.abs(Math.sin(this.time * 5.2)) * 0.012 : 0;
    this.head.setLocalPosition(0, this.headY + rise + headBob, 0);
    this.head.setLocalEulerAngles(
      Math.sin(t * 0.53) * 2.5 + (this.kind === 'singer' ? -6 : 0) + (this.kind === 'kneeling' ? 26 : 0),
      Math.sin(t * 0.31) * (this.kind === 'kneeling' ? 1.5 : 5), 0,
    );

    // --- arms: swing when walking, otherwise drift; the singer holds hers a little open
    //  +z roll swings +x toward +y, so the left arm needs the negative angle to splay outward
    if (this.kind === 'kneeling') {
      // hands folded into the lap, barely moving
      const rest = 24 + Math.sin(t * 0.45) * 1.2;
      this.armL.setLocalEulerAngles(rest, 0, -9);
      this.armR.setLocalEulerAngles(rest, 0, 9);
    } else {
      const open = this.kind === 'singer' ? 13 + Math.sin(t * 0.6) * 4 : 8 + Math.sin(t * 0.4) * 2;
      this.armL.setLocalEulerAngles(walkPhase * 16 + Math.sin(t * 0.5) * 3, 0, -open);
      this.armR.setLocalEulerAngles(-walkPhase * 16 + Math.sin(t * 0.5 + 2) * 3, 0, open);
    }
  }

  get position(): Vec3 { return this.root.getPosition(); }
  distanceTo(p: Vec3): number {
    const q = this.root.getPosition();
    return Math.hypot(p.x - q.x, p.z - q.z);
  }
  destroy(): void { this.root.destroy(); }
}

export { clamp01, lerp };
