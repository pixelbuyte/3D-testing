#!/usr/bin/env python3
"""Derive the shrine trio from the committed, CC0-skinned player base.

No external asset downloads required. Run before optimize-characters.mjs.
The immutable git source makes rebuilds repeatable without doubling asset storage.
"""
import copy
import importlib.util
import math
from pathlib import Path
import subprocess
import tempfile
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASE = '6a9e832dac30ed0607888867daea4d2adf20842d'
spec = importlib.util.spec_from_file_location('base', ROOT / 'tools/build-character.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

PALETTES = {
    'player': dict(cloth='#18233f', leather='#202738', accent='#43b9cf', edge='#324461', hair='#14151e'),
    'ally': dict(cloth='#245471', leather='#23364b', accent='#75dedc', edge='#3e829a', hair='#251d22'),
    'enemy': dict(cloth='#272731', leather='#302c32', accent='#ed7028', edge='#504044', hair='#14141c'),
}

def linear(hexcode):
    c = np.array([int(hexcode[i:i+2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4).tolist()

def build(variant, source):
    g = base.Gltf(str(source))
    w = base.Writer()
    w.g = copy.deepcopy(g.g)
    w.buf = bytearray(g.bins[0])
    w.g['asset']['generator'] = 'Echoes Shrine Atelier 1.0 (shared Quaternius Universal base)'
    w.g['asset']['extras'] = {'variant': variant, 'baseCommit': BASE, 'meters': True}
    palette = PALETTES[variant]
    def material(name, color, rough=.88):
        w.g['materials'].append({'name': name, 'pbrMetallicRoughness': {
            'baseColorFactor': linear(color) + [1], 'metallicFactor': 0, 'roughnessFactor': rough}})
        return len(w.g['materials']) - 1
    mats = {k: material('shrine_' + k, v) for k, v in palette.items()}
    skin = material('skin', '#b88d79', .86)
    # Keep the UV-authored eyes; remove microscopic pore/cloth normals from the stylized body.
    eye = w.g['materials'][3]
    eye.pop('normalTexture', None)
    eye['pbrMetallicRoughness']['roughnessFactor'] = .65
    for mesh in w.g['meshes']:
        name = mesh['name']
        for p in mesh['primitives']:
            if name == 'Eyes': continue
            if name == 'Head' or (name == 'Arms' and p['material'] == 1): p['material'] = skin
            elif name in ('Hair', 'Brows'): p['material'] = mats['hair']
            elif name in ('Arms_Bracer', 'Feet_Boots'): p['material'] = mats['leather']
            elif name.startswith('Body_Belt'): p['material'] = mats['accent']
            else: p['material'] = mats['cloth']
    # Remove the asymmetric ranger armor and duplicate rigid belt. Anatomy remains untouched.
    for node in w.g['nodes']:
        if node.get('name') in ('Acc_Pauldron', 'Body_Belt_1', 'Body_Belt_1.001'):
            node.pop('mesh', None)
            node.pop('skin', None)
    # The ranger hair cap was tight on the larger superhero head at the temples/nape.
    # Expand its shell slightly around the scalp; keep the head and its skinning unchanged.
    hair_mesh=next(m for m in w.g['meshes'] if m['name']=='Hair')
    for p in hair_mesh['primitives']:
        pos=g.acc(p['attributes']['POSITION']).astype(np.float32)
        center=np.array([0,1.72,-.025],dtype=np.float32)
        pos=(pos-center)*np.array([1.1,1.04,1.1],dtype=np.float32)+center+np.array([0,.008,0],dtype=np.float32)
        p['attributes']['POSITION']=w.accessor(pos,'VEC3',5126,34962,minmax=True)
    slots = {g.name[j]: i for i, j in enumerate(g.g['skins'][0]['joints'])}

    def weights(pos, region):
        if region == 'head': return [('Head', 1)]
        if region == 'neck': return [('neck_01', .3), ('Head', .7)]
        if region == 'chest': return [('spine_03', .8), ('spine_02', .2)]
        if region == 'panel':
            t = max(0, min(.65, (1.10-pos[1]) / .65))
            return [('pelvis', 1-t), ('thigh_l' if pos[0] > 0 else 'thigh_r', t)]
        return [('pelvis', .6), ('spine_01', .4)]

    def mesh(name, vertices, triangles, mat, region, uv=None):
        p = np.asarray(vertices, dtype=np.float32)
        idx = np.asarray(triangles, dtype=np.uint16)
        normals = np.zeros_like(p)
        for tri in idx:
            a, b, c = p[tri]
            n = np.cross(b-a, c-a)
            normals[tri] += n
        normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-8)
        joints = np.zeros((len(p), 4), dtype=np.uint16)
        wt = np.zeros((len(p), 4), dtype=np.float32)
        for i, v in enumerate(p):
            for k, (bone, weight) in enumerate(weights(v, region)):
                joints[i,k], wt[i,k] = slots[bone], weight
        if uv is None: uv = [[v[0] + .5, v[1] / 2] for v in p]
        attrs = {'POSITION': w.accessor(p, 'VEC3', 5126, 34962, minmax=True),
                 'NORMAL': w.accessor(normals, 'VEC3', 5126, 34962),
                 'TEXCOORD_0': w.accessor(np.array(uv, dtype=np.float32), 'VEC2', 5126, 34962),
                 'JOINTS_0': w.accessor(joints, 'VEC4', 5123, 34962),
                 'WEIGHTS_0': w.accessor(wt, 'VEC4', 5126, 34962)}
        w.g['meshes'].append({'name': name, 'primitives': [{'attributes': attrs, 'material': mat,
            'indices': w.accessor(idx.reshape(-1,1), 'SCALAR', 5123, 34963), 'mode': 4}]})
        w.g['nodes'].append({'name': name, 'mesh': len(w.g['meshes'])-1, 'skin': 0})
        w.g['nodes'][0]['children'].append(len(w.g['nodes'])-1)

    def loft(name, rings, mat, region, sides=24):
        # y, x radius, z radius, center x, center z. Closed, smooth contour rings.
        vs, uv, ts = [], [], []
        for j, (y, rx, rz, cx, cz) in enumerate(rings):
            for i in range(sides+1):
                a = i / sides * 2 * math.pi
                vs.append([cx + rx*math.cos(a), y, cz + rz*math.sin(a)])
                uv.append([i/sides, j/(len(rings)-1)])
        for j in range(len(rings)-1):
            for i in range(sides):
                a = j*(sides+1)+i; b = a+sides+1
                ts.extend([[a, b, a+1], [a+1, b, b+1]])
        mesh(name, vs, ts, mat, region, uv)

    # A broad woven obi and its raised fold have more gameplay readability than thin belts.
    loft('Obi', [(1.09,.158,.14,0,.005),(1.115,.165,.145,0,.005),
                 (1.165,.158,.142,0,.005),(1.18,.15,.139,0,.005)], mats['accent'], 'waist')
    loft('Obi_fold', [(1.125,.166,.147,0,.005),(1.136,.168,.149,0,.005),
                     (1.145,.164,.147,0,.005)], mats['accent'], 'waist')
    # Curved, split haori panels. Separate front halves preserve leg and knee readability.
    # Closed thin shells avoid double-sided cloth and support consistent back-face lighting.
    def panel(name, side, back=False, narrow=False, accent=False):
        vs, uv, ts = [], [], []
        rows, cols = 7, 6
        length = .39 if variant == 'ally' else .49
        for layer in range(2):
            for j in range(rows):
                t = j/(rows-1)
                for i in range(cols):
                    u = i/(cols-1)
                    width = (.075 if narrow else .15) * (1+.25*t)
                    x = side*(.018 + u*width + .055*t)
                    y = 1.105-length*t + .018*math.sin(u*math.pi)*t
                    z = (.144+.018*t+.014*math.sin(u*math.pi*3)) * (-1 if back else 1)
                    z += (layer*.004 + (.012 if accent else 0)) * (-1 if back else 1)
                    vs.append([x,y,z]); uv.append([u,t])
        for layer in range(2):
            for j in range(rows-1):
                for i in range(cols-1):
                    a=layer*rows*cols+j*cols+i; b=a+cols
                    tris=[[a,a+1,b],[a+1,b+1,b]]
                    if (side<0) ^ back ^ (layer==0): tris=[t[::-1] for t in tris]
                    ts.extend(tris)
        # Stitch each boundary into the back layer.
        border=list(range(cols))+[j*cols+cols-1 for j in range(1,rows)]+list(range(rows*cols-2,(rows-1)*cols-1,-1))+[j*cols for j in range(rows-2,0,-1)]
        for a,b in zip(border,border[1:]+border[:1]): ts.extend([[a,b,a+rows*cols],[b,b+rows*cols,a+rows*cols]])
        mesh(name,vs,ts,mats['accent' if accent else 'cloth'],'panel',uv)
    for side in (-1,1):
        panel('Haori_front_'+str(side),side)
        panel('Haori_back_'+str(side),side,back=True)
    panel('Sash_tail', -1, narrow=True, accent=True)
    # Scarf and partial face covering retain visible eyes and the stylized jaw contour.
    loft('Scarf_collar',[(1.48,.09,.09,0,-.008),(1.52,.113,.106,0,-.002),
                        (1.56,.105,.095,0,0),(1.59,.084,.082,0,0)],mats['cloth'],'neck')
    loft('Face_wrap',[(1.592,.066,.091,0,.012),(1.62,.079,.105,0,.008),
                     (1.666,.086,.108,0,.002),(1.681,.081,.103,0,0)],mats['leather'],'head')
    if variant == 'ally':
        # A compact tied topknot is a different silhouette from the player's loose parted hair.
        loft('Topknot',[(1.80,.034,.04,0,-.056),(1.85,.047,.041,0,-.052),
                        (1.91,.036,.032,.012,-.052),(1.947,.002,.003,.024,-.043)],mats['hair'],'head',12)
        loft('Hair_tie',[(1.828,.035,.034,0,-.052),(1.846,.038,.037,0,-.052)],mats['accent'],'head',16)
    if variant == 'enemy':
        loft('Kasa',[(1.777,.001,.001,0,-.005),(1.78,.24,.215,0,-.005),(1.79,.24,.215,0,-.005),
                     (1.89,.075,.067,0,-.005),(1.927,.001,.001,0,-.005)],mats['accent'],'head',24)
        loft('Kasa_rim',[(1.776,.243,.218,0,-.005),(1.79,.245,.22,0,-.005)],mats['leather'],'head',24)
        loft('Kasa_crown',[(1.887,.078,.07,0,-.005),(1.91,.04,.035,0,-.005)],mats['leather'],'head',24)
    # Export attachment locators with the asset, rather than hiding calibration in runtime code.
    for side in ('r','l'):
        parent = g.byname['hand_'+side]
        w.g['nodes'].append({'name': 'WeaponSocket_'+side.upper(),
            'translation': [-.031 if side=='r' else .031,.111,-.005],
            'rotation': [.19326,.09009,.28395,.93483] if side=='r' else [.19326,-.09009,-.28395,.93483],
            'extras': {'katanaGripY': .09, 'nunchuckGripY': -.15}})
        w.g['nodes'][parent].setdefault('children',[]).append(len(w.g['nodes'])-1)
    output = ROOT/'public/assets/characters'/f'{variant}.glb'
    print(variant, w.write(str(output)))

if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as temp:
        source=Path(temp)/'base.glb'
        source.write_bytes(subprocess.check_output(['git','show',BASE+':public/assets/characters/player.glb'],cwd=ROOT))
        for variant in PALETTES: build(variant, source)
