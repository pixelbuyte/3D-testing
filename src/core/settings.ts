import { Emitter } from './events';

export type Preset = 'ultra' | 'high' | 'medium';

/** Everything the user (or a preset) can tune. Persisted to localStorage. */
export interface Settings {
  preset: Preset;
  renderScale: number;        // CameraFrame render target scale
  dynamicResolution: boolean; // adaptively lower renderScale to hold frame rate
  shadowResolution: number;
  shadowDistance: number;
  cascades: number;
  softShadows: boolean;       // PCSS on ultra
  ssao: boolean;
  ssaoSamples: number;
  taa: boolean;
  bloom: boolean;
  dof: boolean;
  dofHighQuality: boolean;
  grain: boolean;
  foliageDensity: number;     // instance density multiplier
  particleScale: number;      // particle count multiplier
  mistLayers: number;
  godRays: boolean;
  anisotropy: number;
  sensitivity: number;
  fov: number;
  volume: number;
  heroModel: string;
  customModelUrl: string;
}

const PRESETS: Record<Preset, Partial<Settings>> = {
  ultra: {
    renderScale: 1.0, dynamicResolution: false, shadowResolution: 4096, shadowDistance: 110, cascades: 4,
    softShadows: true, ssao: true, ssaoSamples: 16, taa: true, bloom: true, dof: true, dofHighQuality: true,
    foliageDensity: 1.25, particleScale: 1.5, mistLayers: 14, godRays: true, anisotropy: 16,
  },
  high: {
    renderScale: 1.0, dynamicResolution: true, shadowResolution: 2048, shadowDistance: 80, cascades: 3,
    softShadows: false, ssao: true, ssaoSamples: 10, taa: true, bloom: true, dof: true, dofHighQuality: false,
    foliageDensity: 1.0, particleScale: 1.0, mistLayers: 9, godRays: true, anisotropy: 8,
  },
  medium: {
    renderScale: 0.9, dynamicResolution: true, shadowResolution: 2048, shadowDistance: 70, cascades: 3,
    softShadows: false, ssao: true, ssaoSamples: 6, taa: true, bloom: true, dof: false, dofHighQuality: false,
    foliageDensity: 0.6, particleScale: 0.6, mistLayers: 5, godRays: false, anisotropy: 4,
  },
};

const DEFAULTS: Settings = {
  ...(PRESETS.high as Settings),
  preset: 'high',
  grain: true,
  sensitivity: 1.0,
  fov: 78,
  volume: 0.8,
  heroModel: 'gothic_statue',
  customModelUrl: '',
} as Settings;

const STORAGE_KEY = 'echoes.settings.v1';

type SettingsEvents = { change: { key: keyof Settings; value: unknown; all: Settings }; preset: Preset };

class SettingsStore extends Emitter<SettingsEvents> {
  private data: Settings;

  constructor() {
    super();
    this.data = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        // Only keep user-facing keys; preset-derived values are re-applied below
        const keep: (keyof Settings)[] = ['preset', 'renderScale', 'dynamicResolution', 'dof', 'grain', 'foliageDensity', 'sensitivity', 'fov', 'volume', 'heroModel', 'customModelUrl'];
        const presetVals = PRESETS[(saved.preset ?? 'high') as Preset] ?? PRESETS.high;
        this.data = { ...DEFAULTS, ...presetVals } as Settings;
        for (const k of keep) if (saved[k] !== undefined) (this.data as unknown as Record<string, unknown>)[k] = saved[k];
      }
    } catch { /* ignore */ }
    // URL overrides (used by the screenshot tool and for quick testing)
    const p = new URLSearchParams(location.search);
    const preset = p.get('preset');
    if (preset && preset in PRESETS) this.applyPreset(preset as Preset, false);
    if (p.has('noDof')) this.data.dof = false;
    if (p.has('noGrain')) this.data.grain = false;
    // capture/benchmark overrides used by tools/capture-video.mjs
    const scale = Number(p.get('scale'));
    if (Number.isFinite(scale) && scale > 0) { this.data.renderScale = scale; this.data.dynamicResolution = false; }
    // 'fast' strips the expensive full-screen passes; used only by the offline video capture,
    // where TAA jitter never converges anyway because the camera teleports every frame.
    if (p.has('fast')) { this.data.taa = false; this.data.ssao = false; this.data.dof = false; this.data.godRays = false; this.data.mistLayers = 3; }
    const foliage = Number(p.get('foliage'));
    if (Number.isFinite(foliage) && foliage > 0) this.data.foliageDensity = foliage;
  }

  get all(): Readonly<Settings> { return this.data; }
  get<K extends keyof Settings>(key: K): Settings[K] { return this.data[key]; }

  set<K extends keyof Settings>(key: K, value: Settings[K], persist = true): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    if (persist) this.persist();
    this.emit('change', { key, value, all: this.data });
  }

  applyPreset(preset: Preset, persist = true): void {
    Object.assign(this.data, PRESETS[preset], { preset });
    if (persist) this.persist();
    this.emit('preset', preset);
    this.emit('change', { key: 'preset', value: preset, all: this.data });
  }

  private persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
}

export const settings = new SettingsStore();
export const presetNames: Preset[] = ['ultra', 'high', 'medium'];
