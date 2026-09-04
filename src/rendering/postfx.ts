import { CameraComponent, CameraFrame, Color, SSAOTYPE_LIGHTING, SSAOTYPE_NONE, TONEMAP_ACES2, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import { settings, type Settings } from '@/core/settings';
import { damp } from '@/utils/math';

/**
 * Wraps PlayCanvas' CameraFrame render pipeline: HDR scene target, TAA, SSAO, bloom,
 * depth of field, color grading, vignette; plus adaptive render scale.
 */
export class PostFX {
  frame: CameraFrame;
  focusDistance = 12;
  private focusTarget = 12;
  private dynamicScale = 1;
  private frameTimes: number[] = [];
  private grainEl = document.getElementById('grain');
  /** extra bloom/exposure kick used during activation events */
  pulse = 0;

  camera: CameraComponent;

  constructor(ctx: EngineContext, camera: CameraComponent) {
    this.camera = camera;
    this.frame = new CameraFrame(ctx.app, camera);
    const f = this.frame;
    f.rendering.toneMapping = TONEMAP_ACES2;
    f.rendering.samples = 1;
    f.rendering.sceneColorMap = false;
    f.rendering.sceneDepthMap = true;
    f.rendering.sharpness = 0.12;
    f.bloom.blurLevel = 16;
    f.grading.enabled = true;
    f.grading.brightness = 0.98;
    f.grading.contrast = 1.16;
    f.grading.saturation = 1.02;
    f.grading.tint = new Color(0.95, 0.98, 1.09);
    f.vignette.inner = 0.34;
    f.vignette.outer = 1.18;
    f.vignette.curvature = 0.6;
    f.vignette.intensity = 0.62;
    f.vignette.color = new Color(0.02, 0.02, 0.03);
    f.fringing.intensity = 0;   // the sharpen pass already introduces edge colour; keep lenses clean
    f.taa.jitter = 1;
    f.dof.nearBlur = false;
    f.dof.focusRange = 26;
    f.dof.blurRadius = 3.2;
    f.dof.blurRings = 3;
    f.dof.blurRingPoints = 4;
    this.applySettings(settings.all);
    settings.on('change', () => this.applySettings(settings.all));
  }

  applySettings(s: Readonly<Settings>): void {
    const f = this.frame;
    f.rendering.renderTargetScale = s.renderScale * this.dynamicScale;
    f.taa.enabled = s.taa;
    f.rendering.sharpness = s.taa ? 0.14 : 0.0;
    f.ssao.type = s.ssao ? SSAOTYPE_LIGHTING : SSAOTYPE_NONE;
    f.ssao.blurEnabled = true;
    f.ssao.randomize = s.taa;
    f.ssao.intensity = 0.75;
    f.ssao.radius = 2.2;
    f.ssao.samples = s.ssaoSamples;
    f.ssao.power = 2.2;
    f.ssao.minAngle = 12;
    f.ssao.scale = 1;
    f.bloom.intensity = s.bloom ? 0.026 : 0;
    f.dof.enabled = s.dof;
    f.dof.highQuality = s.dofHighQuality;
    f.update();
    if (this.grainEl) this.grainEl.classList.toggle('off', !s.grain);
  }

  setFocus(distance: number): void { this.focusTarget = distance; }

  update(dt: number, _camPos: Vec3): void {
    const f = this.frame;
    // depth of field follows the gaze distance with a lazy focus pull
    this.focusDistance = damp(this.focusDistance, this.focusTarget, 3.5, dt);
    f.dof.focusDistance = this.focusDistance;
    f.dof.focusRange = Math.max(14, this.focusDistance * 1.8);
    f.bloom.intensity = (settings.get('bloom') ? 0.026 : 0) * (1 + this.pulse * 6);
    this.pulse = damp(this.pulse, 0, 1.5, dt);

    // adaptive resolution: hold ~60 fps by trading render scale in 5% steps
    if (settings.get('dynamicResolution')) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length >= 45) {
        const sorted = this.frameTimes.slice().sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        this.frameTimes.length = 0;
        const before = this.dynamicScale;
        if (median > 1 / 50) this.dynamicScale = Math.max(0.6, this.dynamicScale - 0.05);
        else if (median < 1 / 70) this.dynamicScale = Math.min(1, this.dynamicScale + 0.05);
        if (before !== this.dynamicScale) { f.rendering.renderTargetScale = settings.get('renderScale') * this.dynamicScale; f.update(); }
      }
    } else if (this.dynamicScale !== 1) {
      this.dynamicScale = 1;
      f.rendering.renderTargetScale = settings.get('renderScale'); f.update();
    }
    f.update();
  }

  get effectiveScale(): number { return settings.get('renderScale') * this.dynamicScale; }
}
