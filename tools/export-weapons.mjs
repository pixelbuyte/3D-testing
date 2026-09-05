// Export the SAME procedural weapon meshes used by PlayCanvas, without a browser/GPU.
import { build } from 'esbuild';
import { NullGraphicsDevice, StandardMaterial, Color, AppBase, AppOptions, RenderComponentSystem } from 'playcanvas';
import { Document, NodeIO } from '@gltf-transform/core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'shrine-weapons-'));
try {
  const bundle = path.join(temporary, 'weapons.mjs');
  await build({ entryPoints:['src/combat/weapons.ts'], outfile:bundle, bundle:true, platform:'node', format:'esm',
    plugins:[{name:'shared-playcanvas',setup(b){b.onResolve({filter:/^playcanvas$/},()=>({path:fileURLToPath(import.meta.resolve('playcanvas')),external:true}));}}], logLevel:'silent' });
  const { buildKatana, buildNunchucks } = await import(pathToFileURL(bundle));
  const device = new NullGraphicsDevice({ width:1, height:1 });
  const app = new AppBase({id:'offline'}), options = new AppOptions();
  options.graphicsDevice=device; options.componentSystems=[RenderComponentSystem]; options.resourceHandlers=[]; app.init(options);
  const material = (name,c) => {const m=new StandardMaterial();m.name=name;m.diffuse=new Color(...c);return m;};
  const steel=material('steel',[.7,.76,.82]),wrap=material('wrap',[.025,.04,.07]),cap=material('fitting',[.1,.65,.72]);
  const all = {katana:buildKatana({device},steel,wrap,cap),nunchucks:buildNunchucks({device},wrap,steel,cap)};
  for (const [name,weapon] of Object.entries(all)) {
    const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene();
    const acc=(type,values)=>doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
    const visit=(e,parent)=>{
      const n=doc.createNode(e.name);const p=e.getLocalPosition(),q=e.getLocalRotation();
      n.setTranslation([p.x,p.y,p.z]).setRotation([q.x,q.y,q.z,q.w]);
      parent.addChild(n);
      if(e.render){
        const mesh=doc.createMesh(e.name);
        for(const mi of e.render.meshInstances){
          const positions=[],normals=[],uv=[],indices=[];
          mi.mesh.getPositions(positions);mi.mesh.getNormals(normals);mi.mesh.getUvs(0,uv);mi.mesh.getIndices(indices);
          const c=mi.material.diffuse;
          const mat=doc.createMaterial(mi.material.name).setBaseColorFactor([c.r,c.g,c.b,1]).setRoughnessFactor(.55).setMetallicFactor(mi.material.name==='steel'?.55:0);
          mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION',acc('VEC3',positions)).setAttribute('NORMAL',acc('VEC3',normals))
            .setAttribute('TEXCOORD_0',acc('VEC2',uv)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer)).setMaterial(mat));
        }
        n.setMesh(mesh);
      }
      for(const child of e.children)visit(child,n);
    };
    visit(weapon.entity,scene);
    await new NodeIO().write(`public/assets/characters/${name}.glb`,doc);
    console.log(`Exported ${name}.glb from runtime geometry`);
  }
} finally {await fs.rm(temporary,{recursive:true,force:true});}
