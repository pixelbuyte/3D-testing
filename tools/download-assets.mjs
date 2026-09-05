// Downloads CC0 assets from Poly Haven into assets-src/ (raw, not committed).
// Run: node tools/download-assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'assets-src');
const PH = 'https://dl.polyhaven.org/file/ph-assets';

const textures = [
  // id, maps
  ['mossy_rock', ['diff', 'nor_gl', 'arm']],
  ['forest_ground_04', ['diff', 'nor_gl', 'arm']],
  ['rock_face_03', ['diff', 'nor_gl', 'arm']],
  ['brown_mud_leaves_01', ['diff', 'nor_gl', 'arm']],
  ['cobblestone_floor_08', ['diff', 'nor_gl', 'arm']],
  ['mossy_cobblestone', ['diff', 'nor_gl', 'arm']],
  ['rustic_stone_wall_02', ['diff', 'nor_gl', 'arm']],
  ['stone_tiles_02', ['diff', 'nor_gl', 'arm']],
  ['bark_willow_02', ['diff', 'nor_gl', 'arm']],
  ['weathered_planks', ['diff', 'nor_gl', 'arm']],
  ['roof_slates_03', ['diff', 'nor_gl', 'arm']],
  ['lichen_rock', ['diff', 'nor_gl', 'arm']],
  ['forest_leaves_02', ['diff', 'nor_gl', 'arm']],
  ['sandstone_blocks_05', ['diff', 'nor_gl', 'arm']],
];
const hdris = [
  ['kloppenheim_06', '2k'],
  ['misty_pines', '1k'],
  ['kiara_9_dusk', '1k'],
];
const models = [
  'rock_moss_set_01', 'rock_moss_set_02', 'fern_02', 'grass_medium_01', 'grass_medium_02',
  'Lantern_01', 'wooden_lantern_01', 'brass_diya_lantern', 'gothic_statue', 'dead_tree_trunk',
  'tree_stump_01', 'boulder_01', 'rock_09', 'nettle_plant', 'celandine_01', 'shrub_01',
];
// Individual leaf/twig texture files (from models we don't download whole)
const looseTextures = [
  ['island_tree_01', ['island_tree_01_leaves_diff_1k.jpg', 'island_tree_01_leaves_nor_gl_1k.jpg', 'island_tree_01_leaves_arm_1k.jpg', 'island_tree_01_diff_1k.jpg', 'island_tree_01_nor_gl_1k.jpg', 'island_tree_01_arm_1k.jpg']],
  ['tree_small_02', ['tree_small_02_leaves_diff_1k.jpg', 'tree_small_02_leaves_nor_gl_1k.jpg', 'tree_small_02_leaves_arm_1k.jpg']],
  ['fir_tree_01', ['fir_tree_01_twig_diff_1k.jpg', 'fir_tree_01_twig_nor_gl_1k.jpg', 'fir_tree_01_twig_arm_1k.jpg']],
];

async function dl(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'cached';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(dest, buf);
      return `${(buf.length / 1e6).toFixed(2)}MB`;
    } catch (e) {
      if (attempt === 3) { console.error('FAILED', url, String(e)); return 'failed'; }
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

const jobs = [];
for (const [id, maps] of textures) for (const m of maps)
  jobs.push([`${PH}/Textures/jpg/1k/${id}/${id}_${m}_1k.jpg`, path.join(OUT, 'textures', id, `${id}_${m}_1k.jpg`)]);
for (const [id, res] of hdris)
  jobs.push([`${PH}/HDRIs/hdr/${res}/${id}_${res}.hdr`, path.join(OUT, 'hdri', `${id}_${res}.hdr`)]);
for (const [id, files] of looseTextures) for (const f of files)
  jobs.push([`${PH}/Models/jpg/1k/${id}/${f}`, path.join(OUT, 'models', id, 'textures', f)]);

// Models: fetch file list from the API to get include URLs
for (const id of models) {
  const meta = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const g = meta.gltf?.['1k']?.gltf;
  if (!g) { console.error('no gltf for', id); continue; }
  jobs.push([g.url, path.join(OUT, 'models', id, `${id}_1k.gltf`)]);
  for (const [rel, info] of Object.entries(g.include || {}))
    jobs.push([info.url, path.join(OUT, 'models', id, rel)]);
}

// Also the license/attribution list
fs.writeFileSync(path.join(OUT, 'SOURCES.json'), JSON.stringify({ textures: textures.map(t => t[0]), hdris: hdris.map(h => h[0]), models, looseTextures: looseTextures.map(t => t[0]), license: 'CC0 1.0 (Poly Haven, https://polyhaven.com/license)' }, null, 2));

let i = 0;
const CONC = 6;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < jobs.length) {
    const [url, dest] = jobs[i++];
    const r = await dl(url, dest);
    console.log(r, path.relative(OUT, dest));
  }
}));
console.log('DONE', jobs.length, 'files');
