// Packs raw Poly Haven downloads (assets-src/) into optimized runtime assets (public/assets/).
//  - PBR texture sets  -> WebP (1024px), normal maps at high quality
//  - HDRIs             -> copied (.hdr, loaded by the engine's HDR parser)
//  - glTF models       -> single .glb with WebP textures resized per-model
// Run: node tools/pack-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, weld, flatten, join } from '@gltf-transform/functions';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'assets');

const TEX_SIZE = { default: 1024 };
const MODEL_TEX_SIZE = {
  gothic_statue: 1024, Lantern_01: 1024, boulder_01: 1024, wooden_lantern_01: 1024, brass_diya_lantern: 512,
  rock_moss_set_01: 1024, rock_moss_set_02: 1024, fern_02: 1024, grass_medium_02: 512, grass_medium_01: 512,
  dead_tree_trunk: 1024, tree_stump_01: 512, rock_09: 512, nettle_plant: 512, celandine_01: 512, shrub_01: 512,
};

const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const mb = (f) => (fs.statSync(f).size / 1e6).toFixed(2) + 'MB';

async function packTextures() {
  const texRoot = path.join(SRC, 'textures');
  if (!fs.existsSync(texRoot)) return;
  for (const id of fs.readdirSync(texRoot)) {
    const dir = path.join(texRoot, id);
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/_(diff|nor_gl|arm|rough|ao)_\dk\.(jpg|png)$/);
      if (!m) continue;
      const map = m[1];
      const outDir = path.join(OUT, 'textures', id);
      ensure(outDir);
      const out = path.join(outDir, `${map}.webp`);
      if (fs.existsSync(out)) continue;
      const q = map === 'nor_gl' ? 92 : map === 'diff' ? 84 : 82;
      await sharp(path.join(dir, f)).resize(TEX_SIZE.default, TEX_SIZE.default, { fit: 'fill' }).webp({ quality: q, effort: 4 }).toFile(out);
      console.log('tex', id, map, mb(out));
    }
  }
  // Loose textures (tree leaves / bark from models we didn't fully download)
  const modelsRoot = path.join(SRC, 'models');
  for (const id of ['island_tree_01', 'tree_small_02', 'fir_tree_01']) {
    const dir = path.join(modelsRoot, id, 'textures');
    if (!fs.existsSync(dir)) continue;
    const outDir = path.join(OUT, 'textures', id);
    ensure(outDir);
    for (const f of fs.readdirSync(dir)) {
      const out = path.join(outDir, f.replace(/_1k\.jpg$/, '.webp').replace(`${id}_`, ''));
      if (fs.existsSync(out)) continue;
      await sharp(path.join(dir, f)).resize(1024, 1024, { fit: 'fill' }).webp({ quality: f.includes('nor') ? 92 : 84 }).toFile(out);
      console.log('tex', id, path.basename(out), mb(out));
    }
  }
}

function packHdris() {
  const dir = path.join(SRC, 'hdri');
  if (!fs.existsSync(dir)) return;
  ensure(path.join(OUT, 'hdri'));
  for (const f of fs.readdirSync(dir)) {
    const out = path.join(OUT, 'hdri', f);
    if (!fs.existsSync(out)) { fs.copyFileSync(path.join(dir, f), out); console.log('hdri', f, mb(out)); }
  }
}

async function packModels() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const root = path.join(SRC, 'models');
  ensure(path.join(OUT, 'models'));
  for (const id of fs.readdirSync(root)) {
    const gltf = path.join(root, id, `${id}_1k.gltf`);
    if (!fs.existsSync(gltf)) continue;
    const out = path.join(OUT, 'models', `${id}.glb`);
    if (fs.existsSync(out)) continue;
    const doc = await io.read(gltf);
    const size = MODEL_TEX_SIZE[id] ?? 512;
    await doc.transform(
      dedup(),
      flatten(),
      join(),
      weld(),
      resample(),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 84 }),
    );
    // report
    let tris = 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) { const idx = prim.getIndices(); tris += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3; }
    await io.write(out, doc);
    console.log('model', id, mb(out), 'tris', Math.round(tris));
  }
}

await packTextures();
packHdris();
await packModels();
console.log('PACK DONE');
