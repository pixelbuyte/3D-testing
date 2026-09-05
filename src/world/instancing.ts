import { BoundingBox, Entity, Mat4, Mesh, MeshInstance, Quat, StandardMaterial, Vec3, VertexBuffer, VertexFormat, BUFFER_STATIC, GraphicsDevice, Material, RenderComponent } from 'playcanvas';

export interface InstanceXform { x: number; y: number; z: number; yaw: number; scale: number; tiltX?: number; tiltZ?: number; }

const _m = new Mat4(); const _q = new Quat(); const _p = new Vec3(); const _s = new Vec3();

/** Fills a Float32Array with 4x4 matrices for the given transforms. */
export function packMatrices(xforms: InstanceXform[], out?: Float32Array, preMul?: Mat4): Float32Array {
  const data = out ?? new Float32Array(xforms.length * 16);
  for (let i = 0; i < xforms.length; i++) {
    const t = xforms[i];
    _q.setFromEulerAngles(t.tiltX ?? 0, t.yaw, t.tiltZ ?? 0);
    _p.set(t.x, t.y, t.z); _s.set(t.scale, t.scale, t.scale);
    _m.setTRS(_p, _q, _s);
    if (preMul) _m.mul(preMul);
    data.set(_m.data, i * 16);
  }
  return data;
}

/**
 * Creates an instanced draw for `mesh`/`material`, grouped spatially into cells so frustum culling
 * still discards far chunks. Returns the created entities (one per cell).
 */
export function createInstancedCells(
  device: GraphicsDevice, parent: Entity, name: string, mesh: Mesh, material: Material,
  xforms: InstanceXform[], cellSize = 24, preMul?: Mat4, castShadows = true,
): Entity[] {
  const cells = new Map<string, InstanceXform[]>();
  for (const t of xforms) {
    const k = `${Math.floor(t.x / cellSize)},${Math.floor(t.z / cellSize)}`;
    let l = cells.get(k); if (!l) { l = []; cells.set(k, l); }
    l.push(t);
  }
  const out: Entity[] = [];
  const meshBB = mesh.aabb;
  const radius = Math.max(meshBB.halfExtents.x, meshBB.halfExtents.y, meshBB.halfExtents.z) * 1.15 + meshBB.center.length();
  for (const [k, list] of cells) {
    const data = packMatrices(list, undefined, preMul);
    const vb = new VertexBuffer(device, VertexFormat.getDefaultInstancingFormat(device), list.length, { usage: BUFFER_STATIC, data: data.buffer as ArrayBuffer });
    const mi = new MeshInstance(mesh, material);
    mi.setInstancing(vb, true);
    mi.castShadow = castShadows;
    mi.receiveShadow = true;
    // bounds of the cell (positions + max instance radius)
    const min = new Vec3(Infinity, Infinity, Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity);
    for (const t of list) {
      const r = radius * t.scale;
      min.x = Math.min(min.x, t.x - r); min.y = Math.min(min.y, t.y - r); min.z = Math.min(min.z, t.z - r);
      max.x = Math.max(max.x, t.x + r); max.y = Math.max(max.y, t.y + r); max.z = Math.max(max.z, t.z + r);
    }
    const bb = new BoundingBox(); bb.setMinMax(min, max);
    mi.setCustomAabb(bb);
    const e = new Entity(`${name}-${k}`);
    e.addComponent('render', { meshInstances: [mi], castShadows, receiveShadows: true });
    parent.addChild(e);
    out.push(e);
  }
  return out;
}

/** Extracts mesh/material/node-transform triples from a container's render hierarchy. */
export function extractRenderables(root: Entity): { mesh: Mesh; material: StandardMaterial; transform: Mat4 }[] {
  const out: { mesh: Mesh; material: StandardMaterial; transform: Mat4 }[] = [];
  root.syncHierarchy();
  const rootInv = root.getWorldTransform().clone().invert();
  for (const c of root.findComponents('render')) {
    const r = c as RenderComponent;
    const local = new Mat4().mul2(rootInv, r.entity.getWorldTransform());
    for (const mi of r.meshInstances) out.push({ mesh: mi.mesh, material: mi.material as StandardMaterial, transform: local.clone() });
  }
  return out;
}
