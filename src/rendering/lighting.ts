import {
  Color, Entity, EnvLighting, FOG_EXP, SHADOW_PCF5_32F, SHADOW_PCSS_32F, SKYTYPE_DOME,
  Quat, Texture, Vec3, TONEMAP_ACES2, Scene,
} from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { AssetBank } from '@/assets/manifest';
import { settings, type Settings } from '@/core/settings';
import { AtmosphereFog } from './fog';
import { damp } from '@/utils/math';

/** Mood describes the world's lighting state; it is tweened as the stones awaken. */
export interface Mood {
  sunColor: Color; sunIntensity: number; skyIntensity: number; exposure: number;
  fogColor: Color; fogSunColor: Color; fogDensity: number; fogHeightFalloff: number;
  ambient: Color;
}

export const MOODS: Record<'dusk' | 'awakened' | 'opened' | 'finale', Mood> = {
  // A low sun rakes in from the north-east just above the ridge: the shrine is side/back lit,
  // shadows run long across the courtyard, and everything the sun misses sits in cold blue shade.
  dusk: {
    sunColor: new Color(1.0, 0.76, 0.58), sunIntensity: 2.5, skyIntensity: 0.24, exposure: 0.72,
    fogColor: new Color(0.125, 0.160, 0.215), fogSunColor: new Color(0.95, 0.52, 0.30), fogDensity: 0.0175, fogHeightFalloff: 0.085,
    ambient: new Color(0.045, 0.065, 0.098),
  },
  awakened: {
    sunColor: new Color(1.0, 0.74, 0.56), sunIntensity: 2.3, skyIntensity: 0.24, exposure: 0.74,
    fogColor: new Color(0.120, 0.160, 0.225), fogSunColor: new Color(0.95, 0.54, 0.32), fogDensity: 0.0170, fogHeightFalloff: 0.090,
    ambient: new Color(0.048, 0.070, 0.105),
  },
  opened: {
    sunColor: new Color(1.0, 0.72, 0.55), sunIntensity: 2.0, skyIntensity: 0.23, exposure: 0.76,
    fogColor: new Color(0.110, 0.155, 0.235), fogSunColor: new Color(0.90, 0.50, 0.34), fogDensity: 0.0165, fogHeightFalloff: 0.105,
    ambient: new Color(0.032, 0.053, 0.088),
  },
  finale: {
    sunColor: new Color(1.0, 0.78, 0.66), sunIntensity: 1.6, skyIntensity: 0.26, exposure: 0.80,
    fogColor: new Color(0.115, 0.175, 0.255), fogSunColor: new Color(0.78, 0.68, 0.66), fogDensity: 0.0155, fogHeightFalloff: 0.110,
    ambient: new Color(0.046, 0.075, 0.112),
  },
};

export class Lighting {
  sun: Entity;
  fill: Entity;
  fog: AtmosphereFog;
  sunDir = new Vec3(0.60, 0.40, 0.69).normalize(); // direction TO the sun: low, north-east of the shrine
  private scene: Scene;
  private target: Mood = cloneMood(MOODS.dusk);
  private current: Mood = cloneMood(MOODS.dusk);
  private blendSpeed = 0.6;

  constructor(private ctx: EngineContext, assets: AssetBank) {
    const { app, device } = ctx;
    this.scene = app.scene;
    this.fog = new AtmosphereFog(device);
    this.fog.setSunDirection(this.sunDir);

    // --- environment lighting from the HDR (skybox cubemap + prefiltered env atlas)
    const hdr = assets.hdr.resource as Texture;
    const skybox = EnvLighting.generateSkyboxCubemap(hdr);
    const lightingSource = EnvLighting.generateLightingSource(hdr, { size: 128 });
    const envAtlas = EnvLighting.generateAtlas(lightingSource, { size: 512 });
    lightingSource.destroy();
    this.scene.skybox = skybox;
    this.scene.envAtlas = envAtlas;
    this.scene.skyboxMip = 0;
    this.scene.skyboxIntensity = MOODS.dusk.skyIntensity;
    // rotate the HDR so its sun matches our directional light (kloppenheim_06 sun sits roughly at +X)
    this.scene.skyboxRotation = new Quat().setFromEulerAngles(0, 196, 0);
    this.scene.sky.type = SKYTYPE_DOME;
    this.scene.sky.center = new Vec3(0, 0.04, 0);
    this.scene.sky.node.setLocalScale(600, 600, 600);
    this.scene.sky.node.setLocalPosition(0, -40, 0);
    this.scene.ambientLight = MOODS.dusk.ambient.clone();
    this.scene.exposure = MOODS.dusk.exposure;

    // engine fog type just needs to be non-NONE for the fog chunk to be active; our override ignores its params
    this.scene.fog.type = FOG_EXP;
    this.scene.fog.density = 0.0;

    // --- clustered lighting for the many lantern point lights
    this.scene.clusteredLightingEnabled = true;
    const lp = this.scene.lighting;
    lp.shadowsEnabled = true;
    lp.cookiesEnabled = false;
    lp.maxLightsPerCell = 24;
    lp.shadowAtlasResolution = 2048;
    lp.cells = new Vec3(20, 6, 20);

    // --- key light: low dusk sun from the north-west, raking across the shrine
    this.sun = new Entity('sun');
    this.sun.addComponent('light', {
      type: 'directional',
      color: MOODS.dusk.sunColor.clone(),
      intensity: MOODS.dusk.sunIntensity,
      castShadows: true,
      shadowBias: 0.018,
      normalOffsetBias: 0.022,
      shadowIntensity: 0.96,
      cascadeDistribution: 0.62,
      cascadeBlend: 0.12,
      affectSpecularity: true,
    });
    this.sun.lookAt(this.sunDir.clone().mulScalar(-1));
    app.root.addChild(this.sun);

    // --- cool sky fill from above/behind (no shadows) — keeps shadowed areas from going dead
    this.fill = new Entity('skyfill');
    this.fill.addComponent('light', {
      type: 'directional', color: new Color(0.34, 0.50, 0.82), intensity: 1.5, castShadows: false, affectSpecularity: false,
    });
    this.fill.lookAt(new Vec3(-0.25, -1, -0.55));
    app.root.addChild(this.fill);

    this.applySettings(settings.all);
    settings.on('change', () => this.applySettings(settings.all));
  }

  applySettings(s: Readonly<Settings>): void {
    const l = this.sun.light!;
    l.shadowResolution = s.shadowResolution;
    l.shadowDistance = s.shadowDistance;
    l.numCascades = s.cascades;
    l.shadowType = s.softShadows && this.ctx.device.isWebGPU ? SHADOW_PCSS_32F : SHADOW_PCF5_32F;
    if (s.softShadows) { l.penumbraSize = 6; l.shadowSamples = 16; l.shadowBlockerSamples = 12; }
    l.shadowBias = s.softShadows ? 0.06 : 0.018;
    l.normalOffsetBias = 0.022;
  }

  setMood(mood: Mood, speed = 0.6): void {
    this.target = cloneMood(mood);
    this.blendSpeed = speed;
  }

  update(dt: number, camPos: Vec3): void {
    const c = this.current, t = this.target, k = this.blendSpeed;
    lerpColor(c.sunColor, t.sunColor, k, dt);
    lerpColor(c.fogColor, t.fogColor, k, dt);
    lerpColor(c.fogSunColor, t.fogSunColor, k, dt);
    lerpColor(c.ambient, t.ambient, k, dt);
    c.sunIntensity = damp(c.sunIntensity, t.sunIntensity, k, dt);
    c.skyIntensity = damp(c.skyIntensity, t.skyIntensity, k, dt);
    c.exposure = damp(c.exposure, t.exposure, k, dt);
    c.fogDensity = damp(c.fogDensity, t.fogDensity, k, dt);
    c.fogHeightFalloff = damp(c.fogHeightFalloff, t.fogHeightFalloff, k, dt);

    const l = this.sun.light!;
    l.color = c.sunColor; l.intensity = c.sunIntensity;
    if (Math.abs(this.scene.skyboxIntensity - c.skyIntensity) > 0.002) this.scene.skyboxIntensity = c.skyIntensity;
    this.scene.exposure = c.exposure;
    this.scene.ambientLight = c.ambient;
    const f = this.fog.state;
    f.color.copy(c.fogColor); f.sunColor.copy(c.fogSunColor); f.density = c.fogDensity; f.heightFalloff = c.fogHeightFalloff;
    this.fog.update(dt, camPos);
  }
}

function cloneMood(m: Mood): Mood {
  return { ...m, sunColor: m.sunColor.clone(), fogColor: m.fogColor.clone(), fogSunColor: m.fogSunColor.clone(), ambient: m.ambient.clone() };
}
function lerpColor(a: Color, b: Color, k: number, dt: number): void {
  a.r = damp(a.r, b.r, k, dt); a.g = damp(a.g, b.g, k, dt); a.b = damp(a.b, b.b, k, dt);
}
export { TONEMAP_ACES2 };
