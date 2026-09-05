#!/usr/bin/env python3
"""Fail on invalid skinning, missing gameplay clips/sockets, or broken sampled poses."""
import importlib.util
import json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('qa',ROOT/'tools/inspect-characters.py')
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
required={'idle','walk','run','guard','slash1','slash2','slash3','heavy','dodge','hit','death'}
reports=[]
for variant in ('player','ally','enemy'):
    path=ROOT/'public/assets/characters'/f'{variant}.glb';g=qa.b.Gltf(str(path))
    assert required <= {a['name'] for a in g.g['animations']},variant+' missing clips'
    for side in ('l','r'):
        for name in ('hand_','upperarm_','lowerarm_','thigh_','calf_','foot_'):
            assert name+side in g.byname,(variant,name+side)
        socket=g.byname['WeaponSocket_'+side.upper()]
        assert g.parent[socket]==g.byname['hand_'+side]
        q=np.array(g.nodes[socket]['rotation']);assert abs(np.linalg.norm(q)-1)<1e-4
    triangles=0
    for n in g.nodes:
        if 'mesh' not in n:continue
        skin=g.g['skins'][n['skin']]
        assert np.isfinite(g.acc(skin['inverseBindMatrices'])).all()
        for p in g.g['meshes'][n['mesh']]['primitives']:
            a=p['attributes'];v=g.acc(a['POSITION']);wt=g.acc(a['WEIGHTS_0']);jn=g.acc(a['JOINTS_0'])
            idx=g.acc(p['indices']);triangles+=idx.size//3
            assert idx.max()<len(v) and idx.min()>=0
            assert np.isfinite(v).all() and np.isfinite(wt).all()
            assert np.allclose(wt.sum(1),1,atol=.002)
            assert wt.min()>=0 and jn.max()<len(skin['joints'])
            assert 'TEXCOORD_0' in a and 'NORMAL' in a
    assert triangles<16000,(variant,triangles)
    samples=0
    for a in g.g['animations']:
        duration=max(float(g.acc(s['input'])[-1,0]) for s in a['samplers'])
        for t in np.linspace(0,duration,9):
            meshes,worlds=qa.geometry(g,a['name'],float(t))
            for pos,_,_,_ in meshes:
                assert np.isfinite(pos).all()
                assert (np.max(pos,0)-np.min(pos,0)).max()<4,(variant,a['name'],'exploded mesh')
            samples+=1
    reports.append(dict(variant=variant,triangles=triangles,bytes=path.stat().st_size,
        joints=len(g.g['skins'][0]['joints']),materials=len(g.g['materials']),
        primitives=sum(len(m['primitives']) for m in g.g['meshes']),clips=len(g.g['animations']),poseSamples=samples))
print(json.dumps(reports,indent=2))
