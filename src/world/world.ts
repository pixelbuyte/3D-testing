import { Color, Entity, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { AssetBank } from '@/assets/manifest';
import { TerrainField, TerrainRenderer } from './terrain';
import { Lighting } from '@/rendering/lighting';
import { PostFX } from '@/rendering/postfx';
import { CollisionWorld } from '@/player/collision';
import { settings } from '@/core/settings';
import { LEVEL } from './level';
import { Shrine } from './shrine';
import { Scatter } from './scatter';
import { WindState } from '@/shaders/wind';
import { WaterPools } from './water';
import { ParticleFX } from '@/effects/particles';
import { GodRays } from '@/effects/godrays';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Owns every scene system; the Game drives it. */
export class World {
  camera!: Entity;
  field!: TerrainField;
  terrain!: TerrainRenderer;
  lighting!: Lighting;
  postfx!: PostFX;
  collision!: CollisionWorld;
  shrine!: Shrine;
  scatter!: Scatter;
  wind!: WindState;
  water!: WaterPools;
  fx!: ParticleFX;
  atmosphere!: GodRays;
  time = 0;

  constructor(public ctx: EngineContext, public assets: AssetBank) {}

  async build(onProgress: (p: number, status: string) => void): Promise<void> {
    const { app } = this.ctx;
    onProgress(0.02, 'Shaping the mountain…');
    await nextFrame();
    this.field = new TerrainField();
    this.collision = new CollisionWorld(this.field);

    this.camera = new Entity('camera');
    this.camera.addComponent('camera', {
      fov: settings.get('fov'), nearClip: 0.08, farClip: 900, clearColor: new Color(0.02, 0.03, 0.05),
    });
    app.root.addChild(this.camera);
    this.camera.setPosition(LEVEL.spawn.x, this.field.heightAt(LEVEL.spawn.x, LEVEL.spawn.z) + 1.66, LEVEL.spawn.z);

    onProgress(0.12, 'Lighting the dusk…');
    await nextFrame();
    this.lighting = new Lighting(this.ctx, this.assets);
    this.postfx = new PostFX(this.ctx, this.camera.camera!);

    onProgress(0.2, 'Laying wet stone…');
    await nextFrame();
    this.terrain = new TerrainRenderer(this.ctx, this.assets, this.field);
    this.wind = new WindState(this.ctx.device.scope);

    onProgress(0.3, 'Raising the shrine…');
    await nextFrame();
    this.shrine = new Shrine(this.ctx, this.assets, this.field, this.collision);

    this.water = new WaterPools(this.ctx, this.field);

    this.scatter = new Scatter(this.ctx, this.assets, this.field, this.collision);
    await this.scatter.build((p, status) => onProgress(0.4 + p * 0.55, status));

    onProgress(0.96, 'Letting the mist in…');
    await nextFrame();
    this.fx = new ParticleFX(this.ctx, this.camera);
    this.fx.setEmberSources(this.shrine.lanterns.map((l) => l.pos));
    this.atmosphere = new GodRays(this.ctx, this.camera, this.lighting.sunDir);
    onProgress(1, 'Ready');
  }

  update(dt: number, camPos: Vec3): void {
    this.time += dt;
    this.lighting.update(dt, camPos);
    this.terrain.update(dt);
    this.wind.update(dt);
    this.water.update(dt);
    this.fx.update(dt, camPos);
    this.atmosphere.update(dt, camPos, this.camera.forward);
    this.postfx.update(dt, camPos);
  }
}
