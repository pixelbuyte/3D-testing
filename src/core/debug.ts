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
  enemyHealth?: () => { id: number; hp: number; state: string; target: string }[];
  /** tooling: read the ally's health, or set it (to drive her down in a lab) */
  allyHealth?: (hp?: number) => number;
  /** tooling: read the player's health, or set it (to force the respawn in a lab) */
  playerHealth?: (hp?: number) => number;
  /**
   * tooling: every body on its feet — player 'P', ally 'A', enemies 'eN' (dissolving bodies are
   * gone) — with its team ('player', 'ally', or the enemy kind), state, position, separation radius
   * and whom it is on: for the player that is the enemy holding the attack token
   */
  fighters?: () => { id: string; team: string; hp: number; state: string; x: number; z: number; r: number; target: string; moving: boolean }[];
  /**
   * tooling: a fight on flat stone. hold=true freezes the enemies for hit-detection tests; `enemies`
   * (1–3) fans that many across the player's front at `dist`; `ally` puts her at the player's side
   */
  arena?: (hold?: boolean, dist?: number, place?: { x: number; z: number; yaw: number; ex: number; ez: number }, enemies?: number, ally?: boolean) => void;
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
