import { presetNames, settings, type Preset, type Settings } from '@/core/settings';

export type HeroModelSource =
  | { kind: 'builtin'; id: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File };

export interface MenuOptions {
  onResume: () => void;
  onRestart: () => void;
  onHeroModelChange: (source: HeroModelSource) => void;
  getStats: () => Record<string, unknown>;
}

/** Binds the #menu panel in index.html to the settings store. */
export class SettingsMenu {
  private root = document.getElementById('menu');
  private statsEl = this.root?.querySelector<HTMLElement>('.stats') ?? null;
  private open_ = false;
  private statsTimer = 0;

  constructor(private opts: MenuOptions) {
    if (!this.root) return;
    this.bindControls();
    this.bindActions();
    this.syncAll();
    settings.on('preset', () => this.syncAll());

    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      this.toggle();
    });
  }

  private each(selector: string, fn: (el: HTMLElement) => void): void {
    this.root?.querySelectorAll<HTMLElement>(selector).forEach(fn);
  }

  private bindControls(): void {
    this.each('[data-setting]', (el) => {
      const key = el.dataset.setting as keyof Settings;
      if (el.classList.contains('seg')) {
        el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
          b.addEventListener('click', () => {
            const v = b.dataset.value as Preset;
            if (presetNames.includes(v)) settings.applyPreset(v);
          });
        });
        return;
      }
      const input = el as HTMLInputElement | HTMLSelectElement;
      const handler = (): void => {
        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
          settings.set(key, input.checked as never);
        } else if (input instanceof HTMLInputElement && input.type === 'range') {
          settings.set(key, Number(input.value) as never);
        } else {
          settings.set(key, input.value as never);
          if (key === 'heroModel') this.onHeroSelect(input.value);
        }
        this.syncLabels();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });

    const file = this.root?.querySelector<HTMLInputElement>('[data-file="customModel"]');
    file?.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) this.opts.onHeroModelChange({ kind: 'file', file: f });
    });
    const url = this.root?.querySelector<HTMLInputElement>('[data-setting="customModelUrl"]');
    url?.addEventListener('change', () => {
      const v = url.value.trim();
      if (v) this.opts.onHeroModelChange({ kind: 'url', url: v });
    });
  }

  private onHeroSelect(value: string): void {
    this.each('.custom-model', (el) => { el.hidden = value !== 'custom'; });
    if (value !== 'custom') this.opts.onHeroModelChange({ kind: 'builtin', id: value });
  }

  private bindActions(): void {
    this.each('[data-action]', (el) => {
      el.addEventListener('click', () => {
        const a = el.dataset.action;
        if (a === 'resume') this.close();
        else if (a === 'restart') { this.close(); this.opts.onRestart(); }
      });
    });
  }

  /** Re-reads every control from the store (a preset overwrites many values at once). */
  private syncAll(): void {
    this.each('[data-setting]', (el) => {
      const key = el.dataset.setting as keyof Settings;
      const value = settings.get(key);
      if (el.classList.contains('seg')) {
        el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
        return;
      }
      const input = el as HTMLInputElement | HTMLSelectElement;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    });
    this.each('.custom-model', (el) => { el.hidden = settings.get('heroModel') !== 'custom'; });
    this.syncLabels();
  }

  private syncLabels(): void {
    const fmt: Record<string, (v: number) => string> = {
      renderScale: (v) => `${Math.round(v * 100)}%`,
      foliageDensity: (v) => `${Math.round(v * 100)}%`,
      sensitivity: (v) => v.toFixed(2),
      fov: (v) => `${Math.round(v)}°`,
      volume: (v) => `${Math.round(v * 100)}%`,
    };
    this.each('[data-val]', (el) => {
      const key = el.dataset.val as keyof Settings;
      const v = settings.get(key);
      el.textContent = typeof v === 'number' ? (fmt[key as string]?.(v) ?? String(v)) : String(v);
    });
  }

  open(): void { if (!this.root) return; this.root.hidden = false; this.open_ = true; this.syncAll(); }
  close(): void { if (!this.root) return; this.root.hidden = true; this.open_ = false; this.opts.onResume(); }
  toggle(): void { this.open_ ? this.close() : this.open(); }
  get isOpen(): boolean { return this.open_; }

  update(dt: number): void {
    if (!this.open_ || !this.statsEl) return;
    this.statsTimer -= dt;
    if (this.statsTimer > 0) return;
    this.statsTimer = 0.25;
    const s = this.opts.getStats();
    this.statsEl.textContent = Object.entries(s)
      .map(([k, v]) => `${k.toUpperCase().padEnd(13)} ${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}`)
      .join('\n');
  }
}
