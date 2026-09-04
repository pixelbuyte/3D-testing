/** Keyboard + pointer-lock mouse input with per-frame consumption of "pressed" edges. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  enabled = true;
  private onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // clamp absurd deltas some browsers emit right after lock
      const dx = Math.max(-200, Math.min(200, e.movementX));
      const dy = Math.max(-200, Math.min(200, e.movementY));
      this.mouseDX += dx; this.mouseDY += dy;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; this.onLockChange(false); });
  }

  setLockListener(fn: (locked: boolean) => void): void { this.onLockChange = fn; }

  requestLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = (this.canvas as HTMLCanvasElement & { requestPointerLock(o?: unknown): Promise<void> | void }).requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => this.canvas.requestPointerLock());
    } catch { this.canvas.requestPointerLock(); }
  }
  releaseLock(): void { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code: string): boolean { return this.enabled && this.keys.has(code); }
  /** true only on the frame the key went down */
  wasPressed(code: string): boolean { return this.enabled && this.pressed.has(code); }
  /** call at end of frame */
  endFrame(): void { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; }

  get moveX(): number { return (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0); }
  get moveZ(): number { return (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0); }
  get sprint(): boolean { return this.down('ShiftLeft') || this.down('ShiftRight'); }
}
