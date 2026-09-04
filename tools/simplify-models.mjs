// Decimates heavy Poly Haven scans to game-ready triangle budgets (in place, public/assets/models/*.glb).
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIR = path.join(ROOT, 'public', 'assets', 'models');
// target triangle counts
// Scatter props are drawn hundreds of times, so they get hard game-ready budgets.
// Hero props the player walks right up to (statue, lanterns) keep more detail.
const TARGET = {
  rock_moss_set_01: 900, rock_moss_set_02: 900, boulder_01: 700, dead_tree_trunk: 700, shrub_01: 900,
  nettle_plant: 500, tree_stump_01: 600, celandine_01: 350, rock_09: 260,
  grass_medium_02: 260, grass_medium_01: 700, fern_02: 700,
  gothic_statue: 14000, Lantern_01: 4000, wooden_lantern_01: 3000, brass_diya_lantern: 3000,
};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
for (const [id, target] of Object.entries(TARGET)) {
  const file = path.join(DIR, `${id}.glb`);
  if (!fs.existsSync(file)) continue;
  const doc = await io.read(file);
  const count = () => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += i ? i.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3; } return t; };
  const before = count();
  if (before <= target * 1.05) { console.log('skip', id, Math.round(before)); continue; }
  const ratio = target / before;
  await doc.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.06, lockBorder: false }), dedup(), prune());
  await io.write(file, doc);
  console.log('simplified', id, Math.round(before), '->', Math.round(count()), (fs.statSync(file).size / 1e6).toFixed(2) + 'MB');
}
console.log('SIMPLIFY DONE');
