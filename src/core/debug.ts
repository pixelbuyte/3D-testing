/** Hooks used by tools/screenshot.mjs and for manual testing from the console. */
export interface DebugHooks {
  ready: boolean;
  stats: () => Record<string, unknown>;
  setCamera: (x: number, y: number, z: number, yawDeg: number, pitchDeg: number) => void;
  setState: (n: number) => void;
  /** tooling: jump straight into combat encounter n */
  encounter?: (n: number) => void;
  /** tooling: line the fighters up in front of a camera at (x,z,yaw) running one clip */
  preview?: (x: number, z: number, yaw: number, which?: string) => void;
  /** tooling: fire an attack without pointer lock */
  attack?: (kind: string) => boolean;
  /** tooling: advance the fight without rendering, optionally at a chosen step size */
  simulate?: (seconds: number, step?: number) => void;
  enemyHealth?: () => number[];
  /** tooling: the F2 hitbox overlay */
  hitboxes?: (on: boolean) => void;
  freeCam: (on: boolean) => void;
  world?: unknown;
}

declare global { interface Window { __ECHOES?: DebugHooks } }

export function installDebug(h: DebugHooks): DebugHooks {
  window.__ECHOES = h;
  const p = new URLSearchParams(location.search);
  const cam = p.get('cam');
  if (cam) {
    const [x, y, z, yaw, pitch] = cam.split(',').map(Number);
    h.freeCam(true);
    h.setCamera(x, y, z, yaw || 0, pitch || 0);
  }
  const st = p.get('state');
  if (st) h.setState(Number(st));
  const enc = p.get('encounter');
  if (enc && h.encounter) h.encounter(Number(enc));
  return h;
}

export const urlParams = new URLSearchParams(location.search);
export const isShotMode = urlParams.has('shot');
