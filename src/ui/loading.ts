/** Cinematic loading screen: animated 2D mist/motes background with the title and a progress line. */
export class LoadingScreen {
  private root = document.getElementById('loading')!;
  private bar = this.root.querySelector<HTMLElement>('.bar')!;
  private status = this.root.querySelector<HTMLElement>('.status')!;
  private enter = this.root.querySelector<HTMLButtonElement>('.enter')!;
  private hint = this.root.querySelector<HTMLElement>('.hint')!;
  private renderer = this.root.querySelector<HTMLElement>('.renderer')!;
  private canvas = document.getElementById('loading-bg') as HTMLCanvasElement;
  private ctx2d = this.canvas.getContext('2d')!;
  private raf = 0;
  private t0 = performance.now();
  private motes: { x: number; y: number; r: number; s: number; p: number }[] = [];
  private blobs: { x: number; y: number; r: number; vx: number; a: number }[] = [];
  private progress = 0;
  private shownProgress = 0;

  constructor() {
    for (let i = 0; i < 90; i++) this.motes.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, s: 0.2 + Math.random() * 0.8, p: Math.random() * 6.28 });
    for (let i = 0; i < 14; i++) this.blobs.push({ x: Math.random() * 1.4 - 0.2, y: 0.55 + Math.random() * 0.5, r: 0.18 + Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.01, a: 0.05 + Math.random() * 0.06 });
    const resize = () => { this.canvas.width = innerWidth; this.canvas.height = innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    this.draw();
  }

  setRenderer(name: string): void { this.renderer.textContent = name.toUpperCase(); }
  setStatus(text: string): void { this.status.textContent = text; }
  setProgress(p: number): void { this.progress = Math.max(this.progress, Math.min(1, p)); }

  /** Resolves when the user clicks enter (or immediately when `auto`). */
  waitForEnter(auto: boolean): Promise<void> {
    this.setProgress(1);
    this.status.textContent = 'The mist is ready.';
    return new Promise((resolve) => {
      if (auto) { resolve(); return; }
      this.enter.hidden = false; this.hint.hidden = false;
      this.enter.addEventListener('click', () => resolve(), { once: true });
      window.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') resolve(); }, { once: true });
    });
  }

  hide(): void {
    this.root.classList.add('fade');
    setTimeout(() => { this.root.hidden = true; cancelAnimationFrame(this.raf); }, 1700);
  }

  private draw = (): void => {
    this.raf = requestAnimationFrame(this.draw);
    const c = this.ctx2d, W = this.canvas.width, H = this.canvas.height;
    const t = (performance.now() - this.t0) / 1000;
    this.shownProgress += (this.progress - this.shownProgress) * 0.08;
    this.bar.style.width = `${(this.shownProgress * 100).toFixed(1)}%`;
    // sky gradient: deep teal-blue dusk to warm horizon
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05070c'); g.addColorStop(0.55, '#0b1220'); g.addColorStop(0.85, '#2a1f22'); g.addColorStop(1, '#4a2f25');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // distant ridge silhouettes
    c.fillStyle = '#070a10';
    for (let layer = 0; layer < 3; layer++) {
      c.beginPath(); c.moveTo(0, H);
      const base = H * (0.62 + layer * 0.08);
      for (let x = 0; x <= W; x += 12) {
        const n = Math.sin(x * 0.004 + layer * 3 + t * 0.02) * 0.5 + Math.sin(x * 0.011 + layer * 7) * 0.3 + Math.sin(x * 0.027 + layer) * 0.15;
        c.lineTo(x, base - n * H * 0.09 - layer * 4);
      }
      c.lineTo(W, H); c.closePath();
      c.globalAlpha = 0.55 + layer * 0.2; c.fill();
    }
    c.globalAlpha = 1;
    // torii silhouette (left-of-center for asymmetry)
    const gx = W * 0.5, gy = H * 0.74, gs = Math.min(W, H) * 0.09;
    c.fillStyle = '#04050a';
    c.fillRect(gx - gs * 0.9, gy - gs * 2.2, gs * 0.14, gs * 2.2);
    c.fillRect(gx + gs * 0.76, gy - gs * 2.2, gs * 0.14, gs * 2.2);
    c.fillRect(gx - gs * 1.25, gy - gs * 2.35, gs * 2.5, gs * 0.16);
    c.fillRect(gx - gs * 1.0, gy - gs * 1.95, gs * 2.0, gs * 0.1);
    // drifting mist blobs
    for (const b of this.blobs) {
      b.x += b.vx * 0.016; if (b.x < -0.4) b.x = 1.4; if (b.x > 1.4) b.x = -0.4;
      const rg = c.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, b.r * W);
      rg.addColorStop(0, `rgba(120,140,170,${b.a * (0.8 + 0.2 * Math.sin(t + b.x * 9))})`); rg.addColorStop(1, 'rgba(120,140,170,0)');
      c.fillStyle = rg; c.fillRect(0, 0, W, H);
    }
    // motes
    for (const m of this.motes) {
      const y = (m.y - t * 0.006 * m.s) % 1; const yy = y < 0 ? y + 1 : y;
      const x = m.x + Math.sin(t * 0.3 * m.s + m.p) * 0.01;
      const a = 0.25 + 0.35 * Math.sin(t * 1.3 * m.s + m.p);
      c.fillStyle = `rgba(216,178,115,${Math.max(a, 0.05)})`;
      c.beginPath(); c.arc(x * W, yy * H, m.r, 0, 6.283); c.fill();
    }
  };
}
