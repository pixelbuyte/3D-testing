import { Asset, BoundingBox, ContainerResource, Entity, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { AssetBank } from '@/assets/manifest';
import type { HeroModelSource } from '@/ui/menu';
import { extractRenderables } from './instancing';

/**
 * The swappable statue behind the altar. Any of the bundled props can be used, or the player can
 * point it at their own GLB (by URL or by dropping a file in) — the model is auto-scaled and
 * grounded so anything sensible looks placed rather than floating.
 */
export class HeroProp {
  root: Entity;
  private current: Entity | null = null;
  private objectUrl: string | null = null;
  private time = 0;

  constructor(private ctx: EngineContext, private assets: AssetBank, slot: Vec3) {
    this.root = new Entity('hero-prop');
    this.root.setPosition(slot.x, slot.y, slot.z);
    ctx.app.root.addChild(this.root);
  }

  async set(source: HeroModelSource): Promise<void> {
    let entity: Entity | null = null;
    try {
      if (source.kind === 'builtin') {
        if (!this.assets.hasModel(source.id)) return;
        entity = this.assets.model(source.id).instantiateRenderEntity();
      } else {
        const url = source.kind === 'url' ? source.url : URL.createObjectURL(source.file);
        if (source.kind === 'file') { if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = url; }
        entity = await this.loadContainer(url);
      }
    } catch (err) {
      console.warn('[hero] failed to load model', err);
      return;
    }
    if (!entity) return;
    this.current?.destroy();
    this.current = entity;
    this.root.addChild(entity);
    this.fit(entity);
  }

  private loadContainer(url: string): Promise<Entity> {
    return new Promise((resolve, reject) => {
      const asset = new Asset(`hero-${Date.now()}`, 'container', { url, filename: 'model.glb' });
      asset.once('load', () => resolve((asset.resource as ContainerResource).instantiateRenderEntity()));
      asset.once('error', (e: unknown) => reject(e));
      this.ctx.app.assets.add(asset);
      this.ctx.app.assets.load(asset);
    });
  }

  /** Normalises an arbitrary model to ~2.1 m tall, centred on the plinth and sitting on it. */
  private fit(entity: Entity): void {
    entity.setLocalPosition(0, 0, 0);
    entity.setLocalScale(1, 1, 1);
    entity.syncHierarchy();
    const parts = extractRenderables(entity);
    if (!parts.length) return;
    const bb = new BoundingBox();
    let first = true;
    for (const p of parts) {
      const b = new BoundingBox();
      b.setFromTransformedAabb(p.mesh.aabb, p.transform);
      if (first) { bb.copy(b); first = false; } else bb.add(b);
    }
    const size = bb.halfExtents.clone().mulScalar(2);
    const height = Math.max(size.y, 0.05);
    const scale = 2.1 / height;
    entity.setLocalScale(scale, scale, scale);
    const min = bb.getMin(), center = bb.center;
    entity.setLocalPosition(-center.x * scale, -min.y * scale, -center.z * scale);
  }

  update(dt: number): void {
    this.time += dt;
    // a barely-there sway keeps the statue from feeling like a frozen prop
    this.root.setEulerAngles(0, Math.sin(this.time * 0.11) * 1.2, 0);
  }
}
