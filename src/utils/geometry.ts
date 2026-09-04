import { BoundingBox, Geometry, GraphicsDevice, Mat4, Mesh, Quat, Vec3 } from 'playcanvas';
import * as pc from 'playcanvas';

/** Plain mesh data with world-scaled UVs, mergeable into single draw calls. */
export interface MeshData { positions: number[]; normals: number[]; uvs: number[]; indices: number[]; }

export const emptyData = (): MeshData => ({ positions: [], normals: [], uvs: [], indices: [] });

/** Axis-aligned box centered at origin, per-face UVs tiled at `uvScale` (tiles per meter). */
export function boxData(w: number, h: number, d: number, uvScale = 0.5): MeshData {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const faces: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number]; su: number; sv: number }[] = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], su: w, sv: h },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], su: w, sv: h },
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], su: d, sv: h },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], su: d, sv: h },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], su: w, sv: d },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], su: w, sv: d },
  ];
  const out = emptyData();
  for (const f of faces) {
    const base = out.positions.length / 3;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const su = (i - 0.5) * f.su, sv = (j - 0.5) * f.sv;
      out.positions.push(f.n[0] * hw + f.u[0] * su + f.v[0] * sv, f.n[1] * hh + f.u[1] * su + f.v[1] * sv, f.n[2] * hd + f.u[2] * su + f.v[2] * sv);
      out.normals.push(f.n[0], f.n[1], f.n[2]);
      out.uvs.push(i * f.su * uvScale, j * f.sv * uvScale);
    }
    out.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return out;
}

/** Y-axis cylinder/cone (bottom radius rb, top radius rt), centered at origin. */
export function cylinderData(rb: number, rt: number, h: number, segments = 16, uvScale = 0.5, caps = true): MeshData {
  const out = emptyData();
  const hh = h / 2;
  const circ = Math.PI * 2 * Math.max(rb, rt);
  const slope = (rb - rt) / h;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const nl = 1 / Math.hypot(1, slope);
    out.positions.push(ca * rb, -hh, sa * rb, ca * rt, hh, sa * rt);
    out.normals.push(ca * nl, slope * nl, sa * nl, ca * nl, slope * nl, sa * nl);
    out.uvs.push((i / segments) * circ * uvScale, 0, (i / segments) * circ * uvScale, h * uvScale);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    out.indices.push(a, b, c, c, b, d);
  }
  if (caps) {
    for (const [y, r, ny] of [[-hh, rb, -1], [hh, rt, 1]] as [number, number, number][]) {
      const center = out.positions.length / 3;
      out.positions.push(0, y, 0); out.normals.push(0, ny, 0); out.uvs.push(0, 0);
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        out.positions.push(ca * r, y, sa * r); out.normals.push(0, ny, 0); out.uvs.push(ca * r * uvScale, sa * r * uvScale);
      }
      for (let i = 0; i < segments; i++) {
        if (ny > 0) out.indices.push(center, center + 1 + i, center + 2 + i); else out.indices.push(center, center + 2 + i, center + 1 + i);
      }
    }
  }
  return out;
}

/** Subdivided XY plane (facing +Z), width w, height h, origin at top-center (for hanging cloth). */
export function planeData(w: number, h: number, sx: number, sy: number, uvRepeat = 1): MeshData {
  const out = emptyData();
  for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) {
    const u = i / sx, v = j / sy;
    out.positions.push((u - 0.5) * w, -v * h, 0);
    out.normals.push(0, 0, 1);
    out.uvs.push(u * uvRepeat, v * uvRepeat);
  }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, d = c + 1;
    out.indices.push(a, c, b, b, c, d);
  }
  return out;
}

const _m = new Mat4(); const _q = new Quat(); const _v = new Vec3(); const _n = new Vec3();

/** Transforms data in place by position / euler rotation (deg) / scale. */
export function transformData(data: MeshData, pos: [number, number, number], rotDeg: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): MeshData {
  _q.setFromEulerAngles(rotDeg[0], rotDeg[1], rotDeg[2]);
  _m.setTRS(new Vec3(pos[0], pos[1], pos[2]), _q, new Vec3(scale[0], scale[1], scale[2]));
  const p = data.positions, n = data.normals;
  for (let i = 0; i < p.length; i += 3) {
    _v.set(p[i], p[i + 1], p[i + 2]); _m.transformPoint(_v, _v); p[i] = _v.x; p[i + 1] = _v.y; p[i + 2] = _v.z;
    _n.set(n[i], n[i + 1], n[i + 2]); _q.transformVector(_n, _n); _n.normalize(); n[i] = _n.x; n[i + 1] = _n.y; n[i + 2] = _n.z;
  }
  return data;
}

export function appendData(target: MeshData, src: MeshData): void {
  const base = target.positions.length / 3;
  for (let i = 0; i < src.positions.length; i++) target.positions.push(src.positions[i]);
  for (let i = 0; i < src.normals.length; i++) target.normals.push(src.normals[i]);
  for (let i = 0; i < src.uvs.length; i++) target.uvs.push(src.uvs[i]);
  for (let i = 0; i < src.indices.length; i++) target.indices.push(src.indices[i] + base);
}

/** Creates a GPU mesh (with tangents for normal mapping). */
export function createMesh(device: GraphicsDevice, data: MeshData): Mesh {
  const g = new Geometry();
  g.positions = data.positions; g.normals = data.normals; g.uvs = data.uvs; g.indices = data.indices;
  g.calculateTangents();
  const mesh = Mesh.fromGeometry(device, g);
  // explicit AABB (fromGeometry computes one, but keep it tight for merged meshes)
  const bb = new BoundingBox();
  const p = data.positions;
  const min = new Vec3(Infinity, Infinity, Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < p.length; i += 3) { min.x = Math.min(min.x, p[i]); min.y = Math.min(min.y, p[i + 1]); min.z = Math.min(min.z, p[i + 2]); max.x = Math.max(max.x, p[i]); max.y = Math.max(max.y, p[i + 1]); max.z = Math.max(max.z, p[i + 2]); }
  bb.setMinMax(min, max);
  mesh.aabb = bb;
  return mesh;
}

/** Elongated crystal (two cones joined) for the energy stones. */
export function crystalData(r: number, h: number, sides = 6): MeshData {
  const out = emptyData();
  const yTop = h * 0.62, yBot = -h * 0.38;
  // ring
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const rr = r * (0.85 + 0.15 * ((i * 7) % 3) / 2);
    out.positions.push(ca * rr, 0, sa * rr);
  }
  out.positions.push(0, yTop, 0, 0, yBot, 0);
  const top = sides, bot = sides + 1;
  // flat-shaded faces: duplicate vertices per face for crisp facets
  const P = out.positions.slice(); out.positions.length = 0;
  const pushTri = (a: number, b: number, c: number) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = out.positions.length / 3;
    out.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    out.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    out.uvs.push(0, 0, 1, 0, 0.5, 1);
    out.indices.push(base, base + 1, base + 2);
  };
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; pushTri(i, top, j); pushTri(j, bot, i); }
  return out;
}

/**
 * 4x4 white texture. Materials whose shaders read `vUv0` need at least one mapped texture,
 * otherwise the engine never emits the UV0 varying — this is the cheapest way to opt in.
 */
let _white: import('playcanvas').Texture | null = null;
export function whiteTexture(device: GraphicsDevice): import('playcanvas').Texture {
  if (_white) return _white;
  const { Texture, PIXELFORMAT_RGBA8, FILTER_NEAREST, ADDRESS_CLAMP_TO_EDGE } = pc;
  const t = new Texture(device, { name: 'white', width: 4, height: 4, format: PIXELFORMAT_RGBA8, mipmaps: false, minFilter: FILTER_NEAREST, magFilter: FILTER_NEAREST, addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE });
  const px = t.lock() as Uint8Array;
  px.fill(255);
  t.unlock();
  _white = t;
  return t;
}

/** Generates an RGBA texture from a per-pixel callback returning [r,g,b,a] in 0..1. */
export function generatedTexture(device: GraphicsDevice, name: string, size: number,
  fn: (u: number, v: number) => [number, number, number, number]): import('playcanvas').Texture {
  const { Texture, PIXELFORMAT_RGBA8, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, ADDRESS_CLAMP_TO_EDGE } = pc;
  const t = new Texture(device, {
    name, width: size, height: size, format: PIXELFORMAT_RGBA8, mipmaps: true,
    minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR,
    addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE,
  });
  const px = t.lock() as Uint8Array;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, a] = fn((x + 0.5) / size, (y + 0.5) / size);
    const i = (y * size + x) * 4;
    px[i] = r * 255; px[i + 1] = g * 255; px[i + 2] = b * 255; px[i + 3] = a * 255;
  }
  t.unlock();
  return t;
}

let _radial: import('playcanvas').Texture | null = null;
/** Soft round particle sprite (alpha = radial falloff). */
export function radialSprite(device: GraphicsDevice): import('playcanvas').Texture {
  if (!_radial) {
    _radial = generatedTexture(device, 'sprite-radial', 64, (u, v) => {
      const dx = u * 2 - 1, dy = v * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.pow(Math.max(0, 1 - r), 2.0);
      return [1, 1, 1, a];
    });
  }
  return _radial;
}

let _softRect: import('playcanvas').Texture | null = null;
/** Soft-edged rectangle used by the mist/light-shaft cards so they never show a hard border. */
export function softRectSprite(device: GraphicsDevice): import('playcanvas').Texture {
  if (!_softRect) {
    _softRect = generatedTexture(device, 'sprite-softrect', 64, (u, v) => {
      const ex = Math.min(u, 1 - u) * 2, ey = Math.min(v, 1 - v) * 2;
      const s = (t: number) => { const c = Math.max(0, Math.min(1, t / 0.75)); return c * c * (3 - 2 * c); };
      return [1, 1, 1, s(ex) * s(ey)];
    });
  }
  return _softRect;
}

/** UV sphere (used for NPC heads / hoods). */
export function sphereData(r: number, segs = 12, rings = 8, uvScale = 1): MeshData {
  const out = emptyData();
  for (let j = 0; j <= rings; j++) {
    const v = j / rings, phi = v * Math.PI;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs, theta = u * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(theta);
      out.positions.push(x * r, y * r, z * r);
      out.normals.push(x, y, z);
      out.uvs.push(u * uvScale, v * uvScale);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + segs + 1;
    out.indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return out;
}
