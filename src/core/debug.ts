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
  simulate?: (seconds: number, step?: number, move?: { x: number; z: number; sprint?: boolean }) => void;
  enemyHealth?: () => { id: number; hp: number; state: string }[];
  /** tooling: a 1v1 on flat stone; hold=true freezes the enemy for hit-detection tests */
  arena?: (hold?: boolean, dist?: number, place?: { x: number; z: number; yaw: number; ex: number; ez: number }) => void;
  /** tooling: turn the player to an absolute yaw in degrees */
  setYaw?: (deg: number) => void;
  /** tooling: the F2 hitbox overlay */
  hitboxes?: (on: boolean) => void;
  /** tooling: start (true) or stop-and-return (false) per-frame sweep records */
  trace?: (on: boolean) => Record<string, unknown>[];
  previewOff?: () => void;
  freeCam: (on: boolean) => void;
  /** tooling: freeze the game loop (simulate() still steps it) so a capture reads one exact frame */
  pause?: (on: boolean) => void;
  /** tooling: the damage log (attack id, attacker, target, damage, time) */
  hits?: () => { t: number; attack: number; src: string; target: string; dmg: number }[];
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
