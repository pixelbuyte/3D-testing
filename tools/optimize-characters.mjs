import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const io = new NodeIO();
for (const name of ['player', 'ally', 'enemy']) {
  const path = `public/assets/characters/astra/${name}.glb`;
  const doc = await io.read(path);
  // Skin attributes participate in simplification; no position-only decimation across joints.
  await doc.transform(prune({keepLeaves:true,keepAttributes:true}), dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: .36, error: .005 }), prune({keepLeaves:true,keepAttributes:true}), dedup());
  await io.write(path, doc);
  const tris = doc.getRoot().listMeshes().reduce((sum,m) => sum+m.listPrimitives().reduce((n,p)=>n+p.getIndices().getCount()/3,0),0);
  console.log(`${name}: ${tris} triangles`);
}

