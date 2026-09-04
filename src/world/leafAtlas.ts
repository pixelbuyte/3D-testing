import { ADDRESS_CLAMP_TO_EDGE, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, GraphicsDevice, PIXELFORMAT_RGBA8, Texture } from 'playcanvas';
import { rng } from '@/utils/math';

/**
 * Generates alpha-cutout leaf-cluster atlases at runtime.
 *
 * Each atlas is a 2x2 grid of four distinct clusters so instanced cards can pick a quadrant and
 * avoid visible repetition. Leaves are drawn procedurally (shape + midrib + gradient shading), then
 * modulated by a real photographic leaf texture for micro detail. The matching normal map is derived
 * from the drawn coverage as a height field, which gives the cards believable rounded shading instead
 * of the flat look of a plain billboard.
 */
export interface LeafAtlas { diffuse: Texture; normal: Texture; }
export type LeafStyle = 'broadleaf' | 'conifer' | 'fern';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

interface Ctx2D { c: HTMLCanvasElement; g: CanvasRenderingContext2D; }
function makeCanvas(size: number): Ctx2D {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return { c, g: c.getContext('2d', { willReadFrequently: true })! };
}

export async function buildLeafAtlas(
  device: GraphicsDevice, detailUrl: string, style: LeafStyle, seed = 7, size = 1024,
): Promise<LeafAtlas> {
  const detail = await loadImage(detailUrl);

  const q = size / 2;                       // quadrant size

  const col = makeCanvas(size);             // colour + coverage (alpha)
  const hgt = makeCanvas(size);             // height field for the derived normal map
  col.g.clearRect(0, 0, size, size);
  hgt.g.fillStyle = '#000'; hgt.g.fillRect(0, 0, size, size);

  // --- palettes: cool shaded green through to a warm sun-struck edge
  const palettes: Record<LeafStyle, [string, string, string]> = {
    broadleaf: ['#0b1509', '#1b2f14', '#354d20'],
    conifer: ['#08120b', '#132215', '#243520'],
    fern: ['#0a1709', '#182e14', '#304a22'],
  };
  const [dark, mid, light] = palettes[style];

  /** One leaf blade: teardrop outline, gradient fill, darker midrib. */
  const leaf = (g: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, rot: number, shade: number, heightMode: boolean) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.beginPath();
    g.moveTo(0, -len * 0.5);
    g.bezierCurveTo(wid * 0.62, -len * 0.28, wid * 0.72, len * 0.22, 0, len * 0.5);
    g.bezierCurveTo(-wid * 0.72, len * 0.22, -wid * 0.62, -len * 0.28, 0, -len * 0.5);
    g.closePath();
    if (heightMode) {
      // brighter = closer to the viewer; leaves rise toward their middle
      const grad = g.createLinearGradient(-wid * 0.5, 0, wid * 0.5, 0);
      const v = Math.round(120 + shade * 90);
      grad.addColorStop(0, `rgb(${v * 0.45 | 0},${v * 0.45 | 0},${v * 0.45 | 0})`);
      grad.addColorStop(0.5, `rgb(${v},${v},${v})`);
      grad.addColorStop(1, `rgb(${v * 0.45 | 0},${v * 0.45 | 0},${v * 0.45 | 0})`);
      g.fillStyle = grad;
    } else {
      const grad = g.createLinearGradient(0, -len * 0.5, 0, len * 0.5);
      grad.addColorStop(0, shade > 0.6 ? light : mid);
      grad.addColorStop(0.55, mid);
      grad.addColorStop(1, dark);
      g.fillStyle = grad;
    }
    g.fill();
    if (!heightMode) {
      g.strokeStyle = 'rgba(0,0,0,0.30)'; g.lineWidth = Math.max(1, len * 0.018);
      g.beginPath(); g.moveTo(0, -len * 0.46); g.lineTo(0, len * 0.46); g.stroke();
      // side veins
      g.lineWidth = Math.max(0.6, len * 0.008); g.strokeStyle = 'rgba(0,0,0,0.16)';
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        for (const s of [-1, 1]) {
          g.beginPath(); g.moveTo(0, -len * 0.45 + len * 0.9 * t);
          g.lineTo(s * wid * 0.42 * Math.sin(t * Math.PI), -len * 0.45 + len * 0.9 * t + len * 0.11);
          g.stroke();
        }
      }
    }
    g.restore();
  };

  const needle = (g: CanvasRenderingContext2D, x: number, y: number, rot: number, len: number, shade: number, heightMode: boolean) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    const v = Math.round(110 + shade * 100);
    g.strokeStyle = heightMode ? `rgb(${v},${v},${v})` : (shade > 0.55 ? light : mid);
    g.lineWidth = Math.max(1.2, len * 0.030); g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len); g.stroke();
    g.lineWidth = Math.max(1, len * 0.020);
    g.strokeStyle = heightMode ? `rgb(${(v * 0.8) | 0},${(v * 0.8) | 0},${(v * 0.8) | 0})` : (shade > 0.5 ? mid : dark);
    for (let i = 1; i < 22; i++) {
      const t = i / 22;
      const nl = len * (0.20 + 0.22 * Math.sin(t * Math.PI));
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(0, -len * t);
        g.lineTo(s * nl * 0.85, -len * t - nl * 0.42);
        g.stroke();
      }
    }
    g.restore();
  };

  const frond = (g: CanvasRenderingContext2D, x: number, y: number, rot: number, len: number, shade: number, heightMode: boolean) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.strokeStyle = heightMode ? '#b0b0b0' : mid;
    g.lineWidth = Math.max(1.4, len * 0.022); g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.06, -len * 0.5, len * 0.14, -len); g.stroke();
    for (let i = 1; i < 15; i++) {
      const t = i / 15;
      const l = len * (0.26 * Math.sin(t * Math.PI) + 0.05);
      const bx = len * 0.14 * t * t, by = -len * t;
      for (const s of [-1, 1]) leaf(g, bx + s * l * 0.45, by, l, l * 0.30, s * (1.15 - t * 0.35), shade * (0.6 + t * 0.5), heightMode);
    }
    g.restore();
  };

  /** Draws one cluster into a quadrant, on both the colour and height canvases. */
  const cluster = (qx: number, qy: number, variant: number) => {
    const cx = qx * q + q / 2, cy = qy * q + q / 2;
    const passes: [CanvasRenderingContext2D, boolean][] = [[hgt.g, true], [col.g, false]];
    for (const [g, heightMode] of passes) {
      const r2 = rng(seed * 31 + variant * 977);  // identical layout for both passes
      g.save();
      g.beginPath(); g.rect(qx * q, qy * q, q, q); g.clip();
      if (style === 'broadleaf') {
        const N = 70 + Math.floor(r2() * 26);
        for (let i = 0; i < N; i++) {
          const a = r2() * Math.PI * 2;
          const rr = Math.pow(r2(), 0.5) * q * 0.44;
          const len = q * (0.15 + r2() * 0.13);
          leaf(g, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, len, len * (0.40 + r2() * 0.22),
            a + Math.PI / 2 + (r2() - 0.5) * 1.1, r2(), heightMode);
        }
      } else if (style === 'conifer') {
        const N = 26 + Math.floor(r2() * 10);
        for (let i = 0; i < N; i++) {
          const a = r2() * Math.PI * 2;
          const rr = Math.pow(r2(), 0.62) * q * 0.36;
          needle(g, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, a + Math.PI / 2 + (r2() - 0.5) * 0.8, q * (0.22 + r2() * 0.15), r2(), heightMode);
        }
      } else {
        const N = 5 + Math.floor(r2() * 3);
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 + r2() * 0.5;
          frond(g, cx + Math.cos(a) * q * 0.05, cy + q * 0.34, a * 0.35 + (r2() - 0.5) * 0.5, q * (0.55 + r2() * 0.18), r2(), heightMode);
        }
      }
      g.restore();
    }
  };
  cluster(0, 0, 0); cluster(1, 0, 1); cluster(0, 1, 2); cluster(1, 1, 3);

  // --- modulate colour with photographic detail.
  // 'multiply' composites as source-over on the alpha channel, so drawing an opaque photo would
  // make the whole card opaque. Snapshot the coverage first, then mask it back with 'destination-in'.
  if (detail) {
    const mask = makeCanvas(size);
    mask.g.drawImage(col.c, 0, 0);
    col.g.globalCompositeOperation = 'multiply';
    col.g.globalAlpha = 0.38;
    const tile = style === 'conifer' ? 2 : 3, ts = size / tile;
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) col.g.drawImage(detail, x * ts, y * ts, ts, ts);
    col.g.globalAlpha = 1;
    col.g.globalCompositeOperation = 'destination-in';
    col.g.drawImage(mask.c, 0, 0);
    col.g.globalCompositeOperation = 'source-over';
  }

  // --- derive a normal map from the height field, writing flat normals where there is no coverage
  const hData = hgt.g.getImageData(0, 0, size, size).data;
  const cData = col.g.getImageData(0, 0, size, size).data;
  const nImg = col.g.createImageData(size, size);
  const nOut = nImg.data;
  const at = (x: number, y: number): number => {
    const xi = x < 0 ? 0 : x >= size ? size - 1 : x;
    const yi = y < 0 ? 0 : y >= size ? size - 1 : y;
    return hData[(yi * size + xi) * 4] / 255;
  };
  const strength = 2.6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    let nx = -dx, ny = -dy, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    nOut[i] = (nx * 0.5 + 0.5) * 255;
    nOut[i + 1] = (ny * 0.5 + 0.5) * 255;
    nOut[i + 2] = (nz * 0.5 + 0.5) * 255;
    nOut[i + 3] = 255;
  }
  // --- alpha bleed on the colour map: push leaf colour into transparent texels so mipmaps
  //     do not darken the silhouette edges.
  const bleed = new Uint8ClampedArray(cData);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (bleed[i + 3] > 8) continue;
      let r = 0, g2 = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = (yy * size + xx) * 4;
        if (bleed[j + 3] > 8) { r += bleed[j]; g2 += bleed[j + 1]; b += bleed[j + 2]; n++; }
      }
      if (n) { bleed[i] = r / n; bleed[i + 1] = g2 / n; bleed[i + 2] = b / n; bleed[i + 3] = 6; }
    }
  }
  const bleedImg = col.g.createImageData(size, size);
  bleedImg.data.set(bleed);
  col.g.putImageData(bleedImg, 0, 0);

  const nCanvas = makeCanvas(size);
  nCanvas.g.putImageData(nImg, 0, 0);

  const mk = (canvas: HTMLCanvasElement, srgb: boolean, name: string): Texture => {
    const t = new Texture(device, {
      name, width: size, height: size, format: PIXELFORMAT_RGBA8, mipmaps: true, srgb,
      minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR,
      addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE, anisotropy: 8,
    });
    t.setSource(canvas);
    return t;
  };
  return { diffuse: mk(col.c, true, `leaf-${style}-diff`), normal: mk(nCanvas.c, false, `leaf-${style}-nor`) };
}
