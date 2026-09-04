/** Hooks used by tools/screenshot.mjs and for manual testing from the console. */
export interface DebugHooks {
  ready: boolean;
  stats: () => Record<string, unknown>;
  setCamera: (x: number, y: number, z: number, yawDeg: number, pitchDeg: number) => void;
  setState: (n: number) => void;
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
  return h;
}

export const urlParams = new URLSearchParams(location.search);
export const isShotMode = urlParams.has('shot');
