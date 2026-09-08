import './styles.css';
import {
  AppBase,
  AppOptions,
  Asset,
  CameraComponentSystem,
  Color,
  ContainerHandler,
  ContainerResource,
  DEVICETYPE_WEBGL2,
  DEVICETYPE_WEBGPU,
  Entity,
  FILLMODE_FILL_WINDOW,
  GraphicsDevice,
  LightComponentSystem,
  Quat,
  RenderComponentSystem,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
  createGraphicsDevice,
} from 'playcanvas';
import { makeSkinnedPlayer } from '@/combat/skinned';
import { GUARD, IDLE, SLASH_1 } from '@/combat/clips';
import type { EngineContext } from '@/core/engine';

type Part = 'head' | 'hand_l' | 'hand_r';
type DragMode = 'orbit' | Part | null;

const canvas = document.querySelector<HTMLCanvasElement>('#viewer-canvas')!;
const loading = document.querySelector<HTMLElement>('#viewer-loading')!;
const selection = document.querySelector<HTMLElement>('#selection')!;
const selectionName = selection.querySelector<HTMLElement>('.selection-name')!;
const hint = document.querySelector<HTMLElement>('#gesture-hint')!;
const rendererLabel = document.querySelector<HTMLElement>('.renderer')!;
const poseButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-pose]')];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

async function createViewerEngine(): Promise<EngineContext> {
  let device: GraphicsDevice;
  try {
    device = await createGraphicsDevice(canvas, {
      deviceTypes: [DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2],
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    device = await createGraphicsDevice(canvas, { deviceTypes: [DEVICETYPE_WEBGL2], antialias: true });
  }
  device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

  const options = new AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem];
  options.resourceHandlers = [ContainerHandler];
  const app = new AppBase(canvas);
  app.init(options);
  app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(RESOLUTION_AUTO);
  return {
    app,
    device,
    canvas,
    isWebGPU: device.isWebGPU,
    rendererName: device.isWebGPU ? 'WebGPU' : 'WebGL 2',
    supportsCompute: !!device.supportsCompute,
  };
}

function material(color: Color, metalness = 0, gloss = .45): StandardMaterial {
  const m = new StandardMaterial();
  m.diffuse = color;
  m.useMetalness = true;
  m.metalness = metalness;
  m.gloss = gloss;
  m.update();
  return m;
}

function addStudio(ctx: EngineContext): void {
  ctx.app.scene.ambientLight = new Color(.13, .16, .22);
  ctx.app.scene.exposure = 1.25;

  const floor = new Entity('viewer-floor');
  floor.addComponent('render', { type: 'cylinder', material: material(new Color(.045, .06, .085), .1, .35) });
  floor.setLocalScale(4.8, .035, 4.8);
  floor.setLocalPosition(0, -.055, 0);
  ctx.app.root.addChild(floor);

  const key = new Entity('key-light');
  key.addComponent('light', { type: 'directional', color: new Color(.66, .79, 1), intensity: 2.1, castShadows: true, shadowResolution: 2048 });
  key.setLocalEulerAngles(38, -38, 0);
  ctx.app.root.addChild(key);

  const rim = new Entity('rim-light');
  rim.addComponent('light', { type: 'omni', color: new Color(.25, .87, 1), intensity: 2.8, range: 5, castShadows: false });
  rim.setLocalPosition(-1.6, 1.5, .65);
  ctx.app.root.addChild(rim);

  const lantern = new Entity('lantern-light');
  lantern.addComponent('light', { type: 'omni', color: new Color(1, .55, .23), intensity: 2.2, range: 4, castShadows: false });
  lantern.setLocalPosition(1.7, 1.0, -1.2);
  ctx.app.root.addChild(lantern);
}

function loadContainer(ctx: EngineContext, url: string): Promise<ContainerResource> {
  const asset = new Asset('viewer-player', 'container', { url });
  ctx.app.assets.add(asset);
  return new Promise((resolve, reject) => {
    asset.once('load', () => resolve(asset.resource as ContainerResource));
    asset.once('error', reject);
    ctx.app.assets.load(asset);
  });
}

function applyWorldRotation(joint: Entity, delta: Quat): void {
  const parent = joint.parent as Entity | null;
  if (!parent) return;
  const parentWorld = parent.getRotation();
  const desiredWorld = new Quat().mul2(delta, joint.getRotation());
  const local = new Quat().mul2(new Quat().copy(parentWorld).invert(), desiredWorld);
  joint.setLocalRotation(local);
}

function solveCcdIk(target: Vec3, hand: Entity, forearm: Entity, upperArm: Entity): void {
  const from = new Vec3();
  const to = new Vec3();
  const delta = new Quat();
  for (let pass = 0; pass < 4; pass++) {
    for (const joint of [forearm, upperArm]) {
      from.sub2(hand.getPosition(), joint.getPosition());
      to.sub2(target, joint.getPosition());
      if (from.lengthSq() < 1e-6 || to.lengthSq() < 1e-6) continue;
      from.normalize();
      to.normalize();
      delta.setFromDirections(from, to);
      applyWorldRotation(joint, delta);
    }
  }
}

async function boot(): Promise<void> {
  const ctx = await createViewerEngine();
  const { app } = ctx;
  rendererLabel.textContent = ctx.rendererName;
  addStudio(ctx);

  const camera = new Entity('viewer-camera');
  camera.addComponent('camera', { clearColor: new Color(.018, .028, .047), fov: 34, nearClip: .05, farClip: 100 });
  app.root.addChild(camera);

  const container = await loadContainer(ctx, 'assets/characters/player.glb');
  const fighter = makeSkinnedPlayer(ctx, container);
  fighter.root.setLocalPosition(0, 0, 0);
  app.root.addChild(fighter.root);

  const model = fighter.root.findByName('model') as Entity;
  const head = fighter.root.findByName('Head') as Entity;
  const handL = fighter.root.findByName('hand_l') as Entity;
  const handR = fighter.root.findByName('hand_r') as Entity;
  const forearmL = fighter.root.findByName('lowerarm_l') as Entity;
  const forearmR = fighter.root.findByName('lowerarm_r') as Entity;
  const upperArmL = fighter.root.findByName('upperarm_l') as Entity;
  const upperArmR = fighter.root.findByName('upperarm_r') as Entity;
  const parts: Record<Part, Entity> = { head, hand_l: handL, hand_r: handR };

  let yaw = 180;
  let pitch = 6;
  let distance = 4.25;
  let dragMode: DragMode = null;
  let activePart: Part | null = null;
  let lastX = 0;
  let lastY = 0;
  let headYaw = 0;
  let headPitch = 0;
  let leftTarget: Vec3 | null = null;
  let rightTarget: Vec3 | null = null;
  let pointerDepth = 2;
  let currentPose: 'idle' | 'guard' = 'idle';
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;

  const activatePose = (name: 'idle' | 'guard') => {
    currentPose = name;
    fighter.animator.stopAction();
    fighter.animator.setLocomotion(name === 'guard' ? GUARD : IDLE, null, 0, name === 'guard' ? 1 / GUARD.dur : 1 / IDLE.dur, 0);
    poseButtons.forEach((button) => button.classList.toggle('active', button.dataset.pose === name));
  };
  activatePose('idle');

  const updateCamera = () => {
    const yr = yaw * Math.PI / 180;
    const pr = pitch * Math.PI / 180;
    camera.setPosition(Math.sin(yr) * Math.cos(pr) * distance, .92 + Math.sin(pr) * distance, Math.cos(yr) * Math.cos(pr) * distance);
    camera.lookAt(0, .93, 0);
  };
  updateCamera();

  const canvasPoint = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  };

  const screenPoint = new Vec3();
  const hitPart = (x: number, y: number): Part | null => {
    let best: Part | null = null;
    let bestDist = 76 * (canvas.width / canvas.clientWidth);
    for (const [name, bone] of Object.entries(parts) as [Part, Entity][]) {
      camera.camera!.worldToScreen(bone.getPosition(), screenPoint);
      const d = Math.hypot(screenPoint.x - x, screenPoint.y - y);
      if (d < bestDist) { bestDist = d; best = name; }
    }
    return best;
  };

  const selectPart = (part: Part | null) => {
    activePart = part;
    selection.hidden = !part;
    if (!part) return;
    selectionName.textContent = part === 'head' ? 'Head' : part === 'hand_l' ? 'Left Hand' : 'Right Hand';
    hint.textContent = part === 'head' ? 'DRAG TO TURN THE HEAD' : 'DRAG TO MOVE THE HAND';
  };

  const setHandTarget = (part: 'hand_l' | 'hand_r', x: number, y: number) => {
    const bone = parts[part];
    pointerDepth = camera.getPosition().distance(bone.getPosition());
    const target = camera.camera!.screenToWorld(x, y, pointerDepth, new Vec3());
    const shoulder = (part === 'hand_l' ? upperArmL : upperArmR).getPosition();
    const fromShoulder = target.clone().sub(shoulder);
    const maxReach = .72;
    if (fromShoulder.length() > maxReach) target.copy(shoulder).add(fromShoulder.normalize().mulScalar(maxReach));
    if (part === 'hand_l') leftTarget = target;
    else rightTarget = target;
  };

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    const p = canvasPoint(event);
    pointers.set(event.pointerId, p);
    lastX = p.x;
    lastY = p.y;
    const part = hitPart(p.x, p.y);
    dragMode = part ?? 'orbit';
    selectPart(part);
    if (part === 'hand_l' || part === 'hand_r') setHandTarget(part, p.x, p.y);
    hint.style.opacity = '.75';
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const p = canvasPoint(event);
    pointers.set(event.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const next = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance) distance = clamp(distance - (next - pinchDistance) * .006, 2.7, 6.2);
      pinchDistance = next;
      updateCamera();
      return;
    }
    const dx = p.x - lastX;
    const dy = p.y - lastY;
    if (dragMode === 'orbit') {
      yaw -= dx * .16;
      pitch = clamp(pitch + dy * .1, -12, 32);
      updateCamera();
    } else if (dragMode === 'head') {
      headYaw = clamp(headYaw - dx * .16, -55, 55);
      headPitch = clamp(headPitch + dy * .13, -28, 28);
    } else if (dragMode === 'hand_l' || dragMode === 'hand_r') {
      setHandTarget(dragMode, p.x, p.y);
    }
    lastX = p.x;
    lastY = p.y;
  });

  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    dragMode = null;
    hint.style.opacity = '1';
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (event) => {
    distance = clamp(distance + event.deltaY * .004, 2.7, 6.2);
    updateCamera();
  }, { passive: true });

  poseButtons.forEach((button) => button.addEventListener('click', () => {
    const pose = button.dataset.pose;
    if (pose === 'idle' || pose === 'guard') activatePose(pose);
    if (pose === 'slash') {
      fighter.animator.play(SLASH_1, .12);
      poseButtons.forEach((b) => b.classList.toggle('active', b === button));
      window.setTimeout(() => activatePose(currentPose), 850);
    }
    if (pose === 'reset') {
      headYaw = 0;
      headPitch = 0;
      leftTarget = null;
      rightTarget = null;
      selectPart(null);
      yaw = 180;
      pitch = 6;
      distance = 4.25;
      updateCamera();
      activatePose('idle');
      hint.textContent = 'DRAG TO ORBIT · PINCH TO ZOOM · TAP HEAD OR HAND';
    }
  }));

  app.on('update', (dt: number) => {
    fighter.animator.update(Math.min(dt, 1 / 20));
    if (headYaw || headPitch) {
      const offset = new Quat().setFromEulerAngles(headPitch, headYaw, 0);
      head.setLocalRotation(new Quat().mul2(head.getLocalRotation(), offset));
    }
    if (leftTarget) solveCcdIk(leftTarget, handL, forearmL, upperArmL);
    if (rightTarget) solveCcdIk(rightTarget, handR, forearmR, upperArmR);
    if (activePart) {
      camera.camera!.worldToScreen(parts[activePart].getPosition(), screenPoint);
      const rect = canvas.getBoundingClientRect();
      selection.style.left = `${screenPoint.x * rect.width / canvas.width}px`;
      selection.style.top = `${screenPoint.y * rect.height / canvas.height}px`;
    }
    model.setLocalPosition(0, Math.sin(performance.now() * .0016) * .004, 0);
  });

  const resize = () => { app.resizeCanvas(); updateCamera(); };
  window.addEventListener('resize', resize);
  app.start();
  requestAnimationFrame(() => loading.classList.add('done'));
}

boot().catch((error) => {
  console.error('[viewer] failed', error);
  loading.querySelector<HTMLElement>('.loading-copy')!.textContent = 'THE WARRIOR COULD NOT AWAKEN';
});
