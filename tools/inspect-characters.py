#!/usr/bin/env python3
"""Offline geometry/skin QA. Renders actual GLB triangles; not a game-lighting capture."""
import argparse
import importlib.util
from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('base',ROOT/'tools/build-character.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

def matrix(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4,4).T
    q=np.array(n.get('rotation',[0,0,0,1]));q=q/np.linalg.norm(q)
    r=np.column_stack([b.qrot(q,np.eye(3)[i]) for i in range(3)])
    m=np.eye(4);m[:3,:3]=r@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m

def geometry(g,clip,t):
    nodes=[dict(n) for n in g.nodes]
    a=next(a for a in g.g['animations'] if a['name']==clip)
    for c in a['channels']:
        s=a['samplers'][c['sampler']];times=g.acc(s['input'])[:,0];v=g.acc(s['output'])
        path=c['target']['path'];nodes[c['target']['node']][path]=b.sample_channel(times,v,min(t,times[-1]),path=='rotation')
    worlds={}
    def world(i):
        if i not in worlds: worlds[i]=(world(g.parent[i]) if i in g.parent else np.eye(4))@matrix(nodes[i])
        return worlds[i]
    meshes=[]
    for ni,n in enumerate(nodes):
        if 'mesh' not in n: continue
        skin=g.g['skins'][n['skin']]
        ib=g.acc(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
        matrices=np.array([world(j)@ib[k] for k,j in enumerate(skin['joints'])])
        for p in g.g['meshes'][n['mesh']]['primitives']:
            att=p['attributes'];pos=g.acc(att['POSITION']);jn=g.acc(att['JOINTS_0']).astype(int);wt=g.acc(att['WEIGHTS_0'])
            sk=np.sum(matrices[jn]*wt[:,:,None,None],axis=1)
            ph=np.column_stack([pos,np.ones(len(pos))]);out=np.einsum('nij,nj->ni',sk,ph)[:,:3]
            normals=g.acc(att['NORMAL']);normals=np.einsum('nij,nj->ni',sk[:,:3,:3],normals)
            idx=g.acc(p['indices']).reshape(-1,3).astype(int)
            col=g.g['materials'][p['material']].get('pbrMetallicRoughness',{}).get('baseColorFactor',[.12,.12,.12,1])[:3]
            meshes.append((out,normals,idx,np.array(col)))
    return meshes,worlds

def weapon_geometry(character, worlds, variant, t):
    ally=variant=='ally'
    g=b.Gltf(str(ROOT/'public/assets/characters'/('nunchucks.glb' if ally else 'katana.glb')))
    socket=character.byname['WeaponSocket_R']
    n=character.nodes[socket]
    offset=np.eye(4);offset[1,3]=.15 if ally else -.09
    parent=worlds[character.parent[socket]]@matrix(n)@offset
    transforms={}
    def world(i):
        if i not in transforms:
            node=dict(g.nodes[i])
            if node.get('name')=='chain-pivot':
                a=math.radians(165+math.sin(t*2.4)*12)/2
                node['rotation']=[0,0,math.sin(a),math.cos(a)]
            transforms[i]=(world(g.parent[i]) if i in g.parent else parent)@matrix(node)
        return transforms[i]
    result=[]
    for i,n in enumerate(g.nodes):
        if 'mesh' not in n:continue
        m=world(i)
        for p in g.g['meshes'][n['mesh']]['primitives']:
            pos=g.acc(p['attributes']['POSITION']);nr=g.acc(p['attributes']['NORMAL'])
            pos=(np.column_stack([pos,np.ones(len(pos))])@m.T)[:,:3];nr=nr@m[:3,:3].T
            col=g.g['materials'][p['material']]['pbrMetallicRoughness']['baseColorFactor'][:3]
            result.append((pos,nr,g.acc(p['indices']).reshape(-1,3).astype(int),np.array(col)))
    return result

def render(out,clip='guard',time=.5,angle=0):
    W,H=1500,880
    im=Image.new('RGB',(W,H),'#19212b');d=ImageDraw.Draw(im)
    for y in range(H):
        t=y/H;d.line((0,y,W,y),fill=tuple(int(c*(1-t)+e*t) for c,e in zip((25,33,43),(49,57,65))))
    fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    font=ImageFont.truetype(fontpath,23);small=ImageFont.truetype(fontpath,15)
    d.text((46,28),'ECHOES OF THE SHRINE  /  CHARACTER ATELIER',font=font,fill='#d8e3e5')
    d.text((46,67),f'Actual skinned GLB geometry · {clip} at {time:.2f}s · {angle}° · offline neutral lighting',font=small,fill='#9fafb8')
    a=math.radians(angle);yaw=np.array([[math.cos(a),0,math.sin(a)],[0,1,0],[-math.sin(a),0,math.cos(a)]])
    pitch=.09;cam=np.array([[1,0,0],[0,math.cos(pitch),-math.sin(pitch)],[0,math.sin(pitch),math.cos(pitch)]])@yaw
    light=np.array([-.4,.75,.65]);light/=np.linalg.norm(light)
    for i,name in enumerate(['player','ally','enemy']):
        g=b.Gltf(str(ROOT/'public/assets/characters'/f'{name}.glb'))
        meshes,worlds=geometry(g,clip,time)
        meshes+=weapon_geometry(g,worlds,name,time)
        center=250+i*500;scale=310
        d.ellipse((center-95,727,center+95,753),fill='#20262e')
        pixels=np.array(im);depth=np.full((H,W),-np.inf)
        for pos,nrm,idx,col in meshes:
            p=pos@cam.T;n=nrm@cam.T
            for tri in idx:
                norm=n[tri].mean(0);norm/=max(np.linalg.norm(norm),1e-8)
                shade=.44+.7*max(0,float(norm@light))+.17*max(0,float(norm@np.array([.8,.2,-.5])))
                rgb=np.clip(col*shade,0,1);rgb=np.where(rgb<=.0031308,rgb*12.92,1.055*rgb**(1/2.4)-.055)
                pts=[(center+v[0]*scale,740-v[1]*scale) for v in p[tri]]
                xy=np.array(pts);lo=np.maximum(np.floor(xy.min(0)).astype(int),0);hi=np.minimum(np.ceil(xy.max(0)).astype(int),[W-1,H-1])
                if (hi<lo).any():continue
                x,y=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
                v0,v1,v2=xy
                den=(v1[1]-v2[1])*(v0[0]-v2[0])+(v2[0]-v1[0])*(v0[1]-v2[1])
                if abs(den)<1e-7:continue
                u=((v1[1]-v2[1])*(x-v2[0])+(v2[0]-v1[0])*(y-v2[1]))/den
                v=((v2[1]-v0[1])*(x-v2[0])+(v0[0]-v2[0])*(y-v2[1]))/den
                z=u*p[tri[0],2]+v*p[tri[1],2]+(1-u-v)*p[tri[2],2]
                ds=depth[lo[1]:hi[1]+1,lo[0]:hi[0]+1];ps=pixels[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
                visible=(u>=0)&(v>=0)&(u+v<=1)&(z>ds)
                ds[visible]=z[visible];ps[visible]=(rgb*255).astype(np.uint8)
        im=Image.fromarray(pixels);d=ImageDraw.Draw(im)
        d.text((center-70,791),name.upper(),font=font,fill=['#59c2d5','#88e2df','#f59758'][i])
    Path(out).parent.mkdir(parents=True,exist_ok=True);im.save(out)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--clip',default='guard');p.add_argument('--time',type=float,default=.5);p.add_argument('--angle',type=float,default=0);a=p.parse_args()
    render(a.out,a.clip,a.time,a.angle)
