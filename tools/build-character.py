#!/usr/bin/env python3
"""
Build a skinned, animated character GLB for Echoes of the Shrine from CC0 sources.

Sources (all CC0 1.0, see docs/CHARACTER_SOURCES.md):
  - Quaternius, Universal Base Characters (head, eyes, hair)   https://quaternius.com
  - Quaternius, Modular Character Outfits - Fantasy (outfit)
  - Quaternius, Universal Animation Library 2 (sword set, with root motion)
  - Kay Lousberg, KayKit Adventurers 2.0 (locomotion clips, retargeted onto the Universal rig)

What it does:
  1. Takes the Universal skeleton (65 joints) from the outfit file as the one skeleton.
  2. Merges the outfit meshes, the head cut out of the base body, the eyes and a hairstyle onto it,
     each keeping its own inverse bind matrices (they were all authored on this rig).
  3. Recolours the outfit atlas per part (body/legs/sleeves, leather, belts) so the character
     reads as the game's palette, and downsizes every texture to something a browser wants.
  4. Copies the sword clips from UAL2 (rotations + pelvis height only, so bone lengths stay the
     outfit's) and moves their root motion onto a dedicated `RootMotion` node the game reads.
  5. Retargets the KayKit locomotion clips onto the Universal rig through matching T-poses.
  6. Writes one GLB with embedded PNGs.

Usage:  python3 tools/build-character.py <sources dir> [out.glb]
"""
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

# ----------------------------------------------------------------------------- glTF reading

CT_DTYPE = {5120: 'i1', 5121: 'u1', 5122: 'i2', 5123: 'u2', 5125: 'u4', 5126: 'f4'}
TYPE_N = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class Gltf:
    def __init__(self, path):
        self.path = path
        self.dir = os.path.dirname(path)
        if path.lower().endswith('.glb'):
            with open(path, 'rb') as f:
                f.read(12)
                ln, _ = struct.unpack('<II', f.read(8))
                self.g = json.loads(f.read(ln))
                ln2, _ = struct.unpack('<II', f.read(8))
                self.bins = [f.read(ln2)]
        else:
            self.g = json.load(open(path))
            self.bins = [open(os.path.join(self.dir, b['uri']), 'rb').read() for b in self.g['buffers']]
        self.nodes = self.g['nodes']
        self.name = {i: n.get('name', f'node{i}') for i, n in enumerate(self.nodes)}
        self.byname = {v: k for k, v in self.name.items()}
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i

    def acc(self, i):
        a = self.g['accessors'][i]
        bv = self.g['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = TYPE_N[a['type']]
        dt = CT_DTYPE[a['componentType']]
        stride = bv.get('byteStride')
        buf = self.bins[bv.get('buffer', 0)]
        if stride and stride != n * np.dtype(dt).itemsize:
            rows = []
            for k in range(a['count']):
                rows.append(np.frombuffer(buf, dtype=dt, count=n, offset=off + k * stride))
            return np.array(rows)
        return np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n).copy()

    def image(self, idx):
        im = self.g['images'][idx]
        if 'uri' in im:
            p = os.path.join(self.dir, im['uri'])
            if not os.path.exists(p):
                # the base-character export references a couple of files by a mangled name
                alt = os.path.join(self.dir, im['uri'].replace('_png.png', '.png'))
                p = alt if os.path.exists(alt) else os.path.join(self.dir, '..', 'Textures', im['uri'].replace('_png.png', '.png'))
            return Image.open(p)
        bv = self.g['bufferViews'][im['bufferView']]
        data = self.bins[bv.get('buffer', 0)][bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        return Image.open(io.BytesIO(data))

    def material_texture_image(self, mat_idx, slot):
        m = self.g['materials'][mat_idx]
        ref = m.get('pbrMetallicRoughness', {}).get(slot) if slot in ('baseColorTexture', 'metallicRoughnessTexture') else m.get(slot)
        if not ref:
            return None
        return self.image(self.g['textures'][ref['index']]['source'])


# ----------------------------------------------------------------------------- maths

def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz])


def qinv(q):
    return np.array([-q[0], -q[1], -q[2], q[3]])


def qnorm(q):
    return q / np.linalg.norm(q)


def qrot(q, v):
    """rotate vector v by quaternion q"""
    u = q[:3]
    s = q[3]
    return 2 * np.dot(u, v) * u + (s * s - np.dot(u, u)) * v + 2 * s * np.cross(u, v)


def nlerp(a, b, t):
    if np.dot(a, b) < 0:
        b = -b
    return qnorm(a * (1 - t) + b * t)


def sample_channel(times, values, t, is_quat):
    if len(times) == 1:
        return values[0]
    i = int(np.searchsorted(times, t, side='right')) - 1
    i = max(0, min(i, len(times) - 2))
    a, b = times[i], times[i + 1]
    f = 0.0 if b <= a else (t - a) / (b - a)
    f = max(0.0, min(1.0, f))
    if is_quat:
        return nlerp(values[i], values[i + 1], f)
    return values[i] * (1 - f) + values[i + 1] * f


class Pose:
    """Evaluate a file's skeleton at time t of one of its animations: local and world rotations."""

    def __init__(self, gl, anim_name):
        self.gl = gl
        self.chans = {}
        self.dur = 0.0
        if anim_name is not None:
            anim = next(a for a in gl.g['animations'] if a['name'] == anim_name)
            for ch in anim['channels']:
                s = anim['samplers'][ch['sampler']]
                t = gl.acc(s['input'])[:, 0].astype(np.float64)
                v = gl.acc(s['output']).astype(np.float64)
                self.chans[(gl.name[ch['target']['node']], ch['target']['path'])] = (t, v)
                self.dur = max(self.dur, float(t[-1]))

    def local(self, node_name, t):
        nd = self.gl.nodes[self.gl.byname[node_name]]
        r = self.chans.get((node_name, 'rotation'))
        tr = self.chans.get((node_name, 'translation'))
        rot = sample_channel(r[0], r[1], t, True) if r else np.array(nd.get('rotation', [0, 0, 0, 1]), dtype=np.float64)
        pos = sample_channel(tr[0], tr[1], t, False) if tr else np.array(nd.get('translation', [0, 0, 0]), dtype=np.float64)
        return qnorm(rot), pos

    def world(self, t, names):
        """world rotation and position of every node in `names` (and their ancestors)"""
        out = {}

        def rec(n):
            if n in out:
                return out[n]
            rot, pos = self.local(n, t)
            p = self.gl.parent.get(self.gl.byname[n])
            if p is None:
                out[n] = (rot, pos)
            else:
                pr, pp = rec(self.gl.name[p])
                out[n] = (qnorm(qmul(pr, rot)), pp + qrot(pr, pos))
            return out[n]

        for n in names:
            rec(n)
        return out


# ----------------------------------------------------------------------------- GLB writer

class Writer:
    def __init__(self):
        self.buf = bytearray()
        self.g = {'asset': {'version': '2.0', 'generator': 'echoes build-character'}, 'buffers': [], 'bufferViews': [], 'accessors': [],
                  'images': [], 'textures': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
                  'materials': [], 'meshes': [], 'skins': [], 'nodes': [], 'scenes': [{'nodes': []}], 'scene': 0, 'animations': []}

    def _pad(self):
        while len(self.buf) % 4:
            self.buf += b'\0'

    def view(self, data, target=None, stride=None):
        self._pad()
        off = len(self.buf)
        self.buf += data
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            bv['target'] = target
        if stride:
            bv['byteStride'] = stride
        self.g['bufferViews'].append(bv)
        return len(self.g['bufferViews']) - 1

    def accessor(self, arr, gltype, ctype, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        bv = self.view(arr.tobytes(), target)
        a = {'bufferView': bv, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': gltype}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(axis=0).reshape(-1)]
            a['max'] = [float(x) for x in arr.max(axis=0).reshape(-1)]
        self.g['accessors'].append(a)
        return len(self.g['accessors']) - 1

    def image(self, pil, name, fmt='PNG'):
        b = io.BytesIO()
        if fmt == 'JPEG':
            pil.convert('RGB').save(b, fmt, quality=90, optimize=True)
        else:
            pil.save(b, fmt, optimize=True)
        bv = self.view(b.getvalue())
        self.g['images'].append({'name': name, 'mimeType': 'image/png' if fmt == 'PNG' else 'image/jpeg', 'bufferView': bv})
        self.g['textures'].append({'sampler': 0, 'source': len(self.g['images']) - 1})
        return len(self.g['textures']) - 1

    def write(self, path):
        self._pad()
        self.g['buffers'] = [{'byteLength': len(self.buf)}]
        js = json.dumps(self.g, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.buf)
        with open(path, 'wb') as f:
            f.write(b'glTF' + struct.pack('<II', 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
            f.write(struct.pack('<II', len(self.buf), 0x004E4942) + bytes(self.buf))
        return total


# ----------------------------------------------------------------------------- texture work

def resize(im, size):
    return im.convert('RGBA' if im.mode == 'RGBA' else 'RGB').resize((size, size), Image.LANCZOS)


def uv_mask(gl, mesh_names, size, prim_filter=None):
    """Rasterise the UV triangles of the named meshes into a 0/255 mask of the atlas."""
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    for m in gl.g['meshes']:
        if m['name'] not in mesh_names:
            continue
        for pi, pr in enumerate(m['primitives']):
            if prim_filter and not prim_filter(m['name'], pi, pr):
                continue
            uv = gl.acc(pr['attributes']['TEXCOORD_0'])
            idx = gl.acc(pr['indices']).reshape(-1, 3)
            for tri in idx:
                pts = [(float(uv[i][0]) * size, float(uv[i][1]) * size) for i in tri]
                d.polygon(pts, fill=255, outline=255)
    return mask


def recolour(im, mask, hue, sat, vmul, vadd=0.0, sat_scale=None):
    """Replace hue/saturation under `mask`, keeping the atlas's own shading in V."""
    hsv = np.array(im.convert('RGB').convert('HSV'), dtype=np.float32)
    m = np.array(mask.resize(im.size, Image.NEAREST), dtype=np.float32)[..., None] / 255.0
    h = np.full_like(hsv[..., :1], hue / 360.0 * 255.0)
    s = hsv[..., 1:2] * sat_scale if sat_scale is not None else np.full_like(hsv[..., :1], sat * 255.0)
    v = np.clip(hsv[..., 2:3] * vmul + vadd * 255.0, 0, 255)
    new = np.concatenate([h, np.clip(s, 0, 255), v], axis=-1)
    out = hsv * (1 - m) + new * m
    return Image.fromarray(out.astype(np.uint8), 'HSV').convert('RGB')


def roughness_to_mr(rough_im, size):
    """glTF metallicRoughness: G = roughness, B = metallic (0 for skin)."""
    r = np.array(rough_im.convert('L').resize((size, size), Image.LANCZOS))
    mr = np.stack([np.full_like(r, 255), r, np.zeros_like(r)], axis=-1)
    return Image.fromarray(mr, 'RGB')


# ----------------------------------------------------------------------------- characters

# Recolour tuples are (hue°, saturation, value multiplier, value add) applied under a UV mask.
CHARACTERS = {
    # blue/cyan swordsman: navy cloth, near-black leather, cyan belts, dark parted hair, no hood
    'player': dict(hair='Hair_SimpleParted', hood=False, hair_rgb=(6, 7, 10),
                   cloth=(228, 0.62, 0.50, 0.02), sleeves=(222, 0.55, 0.42, 0.02), leather=(230, 0.30, 0.34, 0.0),
                   belts=(188, 0.85, 1.05, 0.10), hood_col=None),
    # orange enemy: black cloth and leather, orange belts, orange hood up
    'enemy': dict(hair='Hair_Buzzed', hood=True, hair_rgb=(8, 6, 6),
                  cloth=(230, 0.18, 0.20, 0.0), sleeves=(230, 0.18, 0.18, 0.0), leather=(20, 0.28, 0.16, 0.0),
                  belts=(28, 0.95, 1.00, 0.12), hood_col=(26, 0.92, 0.85, 0.06)),
    # black ally/rival: black-navy cloth, dark belts, long dark hair
    'ally': dict(hair='Hair_Long', hood=False, hair_rgb=(10, 10, 13),
                 cloth=(232, 0.32, 0.22, 0.0), sleeves=(232, 0.32, 0.20, 0.0), leather=(230, 0.20, 0.16, 0.0),
                 belts=(215, 0.30, 0.42, 0.02), hood_col=None),
}


# ----------------------------------------------------------------------------- build

def main():
    src = sys.argv[1]
    if '--all' in sys.argv:
        for name in CHARACTERS:
            build(src, f'public/assets/characters/{name}.glb', CHARACTERS[name])
        return
    which = sys.argv[sys.argv.index('--character') + 1] if '--character' in sys.argv else 'player'
    out_path = next((a for a in sys.argv[2:] if a.endswith('.glb')), f'public/assets/characters/{which}.glb')
    build(src, out_path, CHARACTERS[which])


def build(src, out_path, cfg):
    P = {
        'body': f'{src}/ubc/x/Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf',
        'hair': f'{src}/ubc/x/Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/' + cfg['hair'] + '.gltf',
        'outfit': f'{src}/outfits/x/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits/Male_Ranger.gltf',
        'ual': f'{src}/ual/x/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard_RM.glb',
        'kk_general': f'{src}/kaykit/x/KayKit_Adventurers_2.0_FREE/Animations/gltf/Rig_Medium/Rig_Medium_General.glb',
        'kk_move': f'{src}/kaykit/x/KayKit_Adventurers_2.0_FREE/Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb',
    }
    body, hair, outfit, ual = Gltf(P['body']), Gltf(P['hair']), Gltf(P['outfit']), Gltf(P['ual'])
    kk = {'general': Gltf(P['kk_general']), 'move': Gltf(P['kk_move'])}
    W = Writer()

    # ---- 1. skeleton: the outfit's joints, in skin order, plus an Armature root and a RootMotion node
    skin_src = outfit.g['skins'][0]
    joints = skin_src['joints']
    joint_names = [outfit.name[j] for j in joints]
    node_index = {}                       # output index by joint name
    W.g['nodes'].append({'name': 'Armature', 'children': []})
    ARM = 0
    for j in joints:
        nd = outfit.nodes[j]
        o = {'name': outfit.name[j]}
        for k in ('translation', 'rotation', 'scale'):
            if k in nd:
                o[k] = nd[k]
        W.g['nodes'].append(o)
        node_index[outfit.name[j]] = len(W.g['nodes']) - 1
    for j in joints:
        kids = [node_index[outfit.name[c]] for c in outfit.nodes[j].get('children', []) if c in joints]
        if kids:
            W.g['nodes'][node_index[outfit.name[j]]]['children'] = kids
    root_joint = [j for j in joints if outfit.parent.get(j) not in joints][0]
    W.g['nodes'][ARM]['children'].append(node_index[outfit.name[root_joint]])
    W.g['nodes'].append({'name': 'RootMotion', 'translation': [0, 0, 0]})
    RM = len(W.g['nodes']) - 1
    W.g['nodes'][ARM]['children'].append(RM)
    W.g['scenes'][0]['nodes'] = [ARM]

    def add_skin(gl, skin):
        ibm = gl.acc(skin['inverseBindMatrices']).astype(np.float32)
        acc = W.accessor(ibm, 'MAT4', 5126)
        W.g['skins'].append({'joints': [node_index[gl.name[j]] for j in skin['joints']], 'inverseBindMatrices': acc, 'skeleton': node_index['root']})
        return len(W.g['skins']) - 1

    # ---- 2. textures and materials
    S_OUT, S_SKIN, S_HAIR = 1024, 1024, 512
    ranger_base = outfit.material_texture_image(0, 'baseColorTexture').convert('RGB')
    ranger_orm = outfit.material_texture_image(0, 'metallicRoughnessTexture').convert('RGB')
    ranger_nrm = outfit.material_texture_image(0, 'normalTexture').convert('RGB')
    MS = 1024
    cloth = uv_mask(outfit, {'Male_Ranger_Body', 'Male_Ranger_Legs'}, MS)
    sleeves = uv_mask(outfit, {'Male_Ranger_Arms'}, MS, lambda n, pi, pr: pr.get('material') == 0)
    leather = uv_mask(outfit, {'Male_Ranger_Arms_Bracer', 'Male_Ranger_Feet_Boots', 'Male_Ranger_Acc_Pauldron'}, MS)
    belts = uv_mask(outfit, {'Male_Ranger_Body_Belt_1', 'Male_Ranger_Body_Belt_1.001'}, MS)
    hood = uv_mask(outfit, {'Male_Ranger_Head_Hood'}, MS)
    base = ranger_base.resize((2048, 2048), Image.LANCZOS)

    def tint(img, mask, spec):
        h, sat, vmul, vadd = spec
        return recolour(img, mask, hue=h, sat=sat, vmul=vmul, vadd=vadd)
    base = tint(base, cloth, cfg['cloth'])
    base = tint(base, sleeves, cfg['sleeves'])
    base = tint(base, leather, cfg['leather'])
    base = tint(base, belts, cfg['belts'])
    if cfg.get('hood_col'):
        base = tint(base, hood, cfg['hood_col'])
    outfit_base_tex = W.image(base.resize((S_OUT, S_OUT), Image.LANCZOS), 'outfit_base', 'JPEG')
    outfit_orm_tex = W.image(resize(ranger_orm, 512), 'outfit_orm', 'JPEG')
    outfit_nrm_tex = W.image(resize(ranger_nrm, S_OUT), 'outfit_normal')
    W.g['materials'].append({'name': 'outfit', 'pbrMetallicRoughness': {'baseColorTexture': {'index': outfit_base_tex}, 'metallicRoughnessTexture': {'index': outfit_orm_tex}, 'metallicFactor': 1.0, 'roughnessFactor': 1.0},
                             'occlusionTexture': {'index': outfit_orm_tex, 'strength': 0.7}, 'normalTexture': {'index': outfit_nrm_tex, 'scale': 0.8}})
    M_OUTFIT = 0

    def skin_material(gl, mat_idx, name, size):
        bc = resize(gl.material_texture_image(mat_idx, 'baseColorTexture'), size)
        nr = resize(gl.material_texture_image(mat_idx, 'normalTexture'), min(size, 512)).convert('RGB')
        rough = gl.material_texture_image(mat_idx, 'metallicRoughnessTexture')
        mr = roughness_to_mr(rough, 256) if rough is not None else None
        m = {'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': W.image(bc.convert('RGB'), name + '_base', 'JPEG')}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0 if mr else 0.62},
             'normalTexture': {'index': W.image(nr, name + '_normal'), 'scale': 0.7}}
        if mr:
            m['pbrMetallicRoughness']['metallicRoughnessTexture'] = {'index': W.image(mr, name + '_mr')}
        W.g['materials'].append(m)
        return len(W.g['materials']) - 1

    M_HANDS = skin_material(outfit, 1, 'skin_hands', S_SKIN)
    M_HEAD = skin_material(body, 2, 'skin_head', S_SKIN)
    # eyes: colour + normal, low roughness
    eye_bc = resize(body.material_texture_image(1, 'baseColorTexture'), 256).convert('RGB')
    eye_nr = resize(body.material_texture_image(1, 'normalTexture'), 256).convert('RGB')
    W.g['materials'].append({'name': 'eyes', 'pbrMetallicRoughness': {'baseColorTexture': {'index': W.image(eye_bc, 'eye_base')}, 'metallicFactor': 0.0, 'roughnessFactor': 0.35}, 'normalTexture': {'index': W.image(eye_nr, 'eye_normal')}})
    M_EYES = len(W.g['materials']) - 1

    def hair_material(gl, mat_idx, name):
        bc = resize(gl.material_texture_image(mat_idx, 'baseColorTexture'), S_HAIR).convert('RGB')
        arr = np.array(bc, dtype=np.float32)
        lum = arr.mean(axis=-1, keepdims=True) / 255.0
        r0, g0, b0 = cfg['hair_rgb']
        dark = np.stack([lum * 34 + r0, lum * 34 + g0, lum * 46 + b0], axis=-1)[..., 0, :]  # near-black with a cast
        bc = Image.fromarray(np.clip(dark, 0, 255).astype(np.uint8), 'RGB')
        nr = resize(gl.material_texture_image(mat_idx, 'normalTexture'), 256).convert('RGB')
        W.g['materials'].append({'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': W.image(bc, name + '_base', 'JPEG')}, 'metallicFactor': 0.0, 'roughnessFactor': 0.78},
                                 'normalTexture': {'index': W.image(nr, name + '_normal'), 'scale': 0.6}})
        return len(W.g['materials']) - 1

    M_HAIR = hair_material(hair, 0, 'hair')
    M_BROWS = hair_material(body, 0, 'brows')

    # ---- 3. meshes
    def add_mesh(gl, mesh_name, out_name, mat_map, skin_idx, keep_tri=None):
        m = next(mm for mm in gl.g['meshes'] if mm['name'] == mesh_name)
        prims = []
        for pi, pr in enumerate(m['primitives']):
            A = pr['attributes']
            pos = gl.acc(A['POSITION']).astype(np.float32)
            nrm = gl.acc(A['NORMAL']).astype(np.float32)
            uv = gl.acc(A['TEXCOORD_0']).astype(np.float32)
            jn = gl.acc(A['JOINTS_0'])
            wt = gl.acc(A['WEIGHTS_0']).astype(np.float32)
            idx = gl.acc(pr['indices']).reshape(-1, 3).astype(np.uint32)
            if keep_tri is not None:
                keep = keep_tri(gl, pr, idx, pos, jn, wt)
                idx = idx[keep]
                used = np.unique(idx.reshape(-1))
                remap = np.full(pos.shape[0], -1, dtype=np.int64)
                remap[used] = np.arange(len(used))
                pos, nrm, uv, jn, wt = pos[used], nrm[used], uv[used], jn[used], wt[used]
                idx = remap[idx].astype(np.uint32)
            if idx.size == 0:
                continue
            jn16 = jn.astype(np.uint16)
            attrs = {'POSITION': W.accessor(pos, 'VEC3', 5126, 34962, minmax=True), 'NORMAL': W.accessor(nrm, 'VEC3', 5126, 34962),
                     'TEXCOORD_0': W.accessor(uv, 'VEC2', 5126, 34962), 'JOINTS_0': W.accessor(jn16, 'VEC4', 5123, 34962),
                     'WEIGHTS_0': W.accessor(wt, 'VEC4', 5126, 34962)}
            prims.append({'attributes': attrs, 'indices': W.accessor(idx.reshape(-1, 1), 'SCALAR', 5125, 34963), 'material': mat_map(pi, pr), 'mode': 4})
        W.g['meshes'].append({'name': out_name, 'primitives': prims})
        mi = len(W.g['meshes']) - 1
        # the source mesh node's own transform (normally identity under the armature)
        src_node = next(i for i, n in enumerate(gl.nodes) if n.get('mesh') == gl.g['meshes'].index(m))
        o = {'name': out_name, 'mesh': mi, 'skin': skin_idx}
        for k in ('translation', 'rotation', 'scale'):
            if k in gl.nodes[src_node]:
                o[k] = gl.nodes[src_node][k]
        W.g['nodes'].append(o)
        W.g['nodes'][ARM]['children'].append(len(W.g['nodes']) - 1)
        return sum(len(W.g['accessors'][p['indices']] and [0]) for p in prims)

    skin_outfit = add_skin(outfit, outfit.g['skins'][0])
    parts = ['Male_Ranger_Body', 'Male_Ranger_Legs', 'Male_Ranger_Arms_Bracer', 'Male_Ranger_Body_Belt_1', 'Male_Ranger_Body_Belt_1.001',
             'Male_Ranger_Feet_Boots', 'Male_Ranger_Acc_Pauldron'] + (['Male_Ranger_Head_Hood'] if cfg['hood'] else [])
    for name in parts:
        add_mesh(outfit, name, name.replace('Male_Ranger_', ''), lambda pi, pr: M_OUTFIT, skin_outfit)
    add_mesh(outfit, 'Male_Ranger_Arms', 'Arms', lambda pi, pr: M_OUTFIT if pr.get('material') == 0 else M_HANDS, skin_outfit)

    # the base body is cut down to the head: triangles whose weight sits on the head/neck bones
    skin_body = add_skin(body, body.g['skins'][0])
    bjn = body.g['skins'][0]['joints']
    head_slots = {i for i, j in enumerate(bjn) if body.name[j] in ('Head', 'neck_01')}

    def head_only(gl, pr, idx, pos, jn, wt):
        hw = np.zeros(pos.shape[0], dtype=np.float32)
        for k in range(4):
            hw += np.where(np.isin(jn[:, k], list(head_slots)), wt[:, k], 0)
        # everything the collar hides can go; the neck seam sits just above the outfit's collar
        vert_ok = (hw > 0.55) & (pos[:, 1] > 1.40)
        return vert_ok[idx].all(axis=1)

    add_mesh(body, 'Sphere.005_Retopology.004', 'Head', lambda pi, pr: M_HEAD, skin_body, keep_tri=head_only)
    add_mesh(body, 'Face', 'Brows', lambda pi, pr: M_BROWS, skin_body)
    add_mesh(body, 'Face.001', 'Eyes', lambda pi, pr: M_EYES, skin_body)
    skin_hair = add_skin(hair, hair.g['skins'][0])
    add_mesh(hair, hair.g['meshes'][0]['name'], 'Hair', lambda pi, pr: M_HAIR, skin_hair)

    # ---- 4. animations
    FPS = 30
    rest_local = {outfit.name[j]: (np.array(outfit.nodes[j].get('rotation', [0, 0, 0, 1]), dtype=np.float64), np.array(outfit.nodes[j].get('translation', [0, 0, 0]), dtype=np.float64)) for j in joints}
    root_rot = rest_local['root'][0]

    def write_clip(name, times, rots, pelvis_pos, root_z, loop_hint):
        """rots: {joint: (N,4)}, pelvis_pos: (N,3), root_z: (N,) forward metres or None"""
        t_acc = W.accessor(np.asarray(times, dtype=np.float32).reshape(-1, 1), 'SCALAR', 5126, minmax=True)
        samplers, channels = [], []
        for jn, q in rots.items():
            samplers.append({'input': t_acc, 'output': W.accessor(np.asarray(q, dtype=np.float32), 'VEC4', 5126), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': node_index[jn], 'path': 'rotation'}})
        samplers.append({'input': t_acc, 'output': W.accessor(np.asarray(pelvis_pos, dtype=np.float32), 'VEC3', 5126), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': node_index['pelvis'], 'path': 'translation'}})
        rm = np.zeros((len(times), 3), dtype=np.float32)
        if root_z is not None:
            rm[:, 2] = root_z
        samplers.append({'input': t_acc, 'output': W.accessor(rm, 'VEC3', 5126), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': RM, 'path': 'translation'}})
        W.g['animations'].append({'name': name, 'samplers': samplers, 'channels': channels, 'extras': {'loop': loop_hint, 'fps': FPS}})

    # 4a. Universal Animation Library clips: same skeleton, copy rotations + pelvis height, root -> RootMotion
    UAL_CLIPS = [
        # name, source, start, end, root motion scale, loop[, freeze-at]
        # the combat idle is the stance the sword recoveries settle into, held (breathing is added live)
        ('guard', 'Sword_Regular_A_Rec', 0.0, 2.0, 0.0, True, 0.96),
        ('slash1', 'Sword_Regular_A', 0.0, None, 1.0, False),
        ('slash1_rec', 'Sword_Regular_A_Rec', 0.0, None, 1.0, False),
        ('slash2', 'Sword_Regular_B', 0.0, None, 1.0, False),
        ('slash2_rec', 'Sword_Regular_B_Rec', 0.0, None, 1.0, False),
        ('slash3', 'Sword_Regular_C', 0.0, 1.35, 1.0, False),
        ('heavy', 'Sword_Heavy_Combo', 0.0, 0.95, 1.0, False),
        ('dodge', 'Slide_Start', 0.0, 0.62, 0.55, False),
        ('death', 'Hit_Knockback', 0.0, None, 0.35, False),
        ('block', 'Sword_Block', 0.0, None, 0.0, False),
        ('tpose', 'A_TPose', 0.0, 0.04, 0.0, False),
    ]
    for entry in UAL_CLIPS:
        name, srcname, t0, t1, rm_scale, loop = entry[:6]
        freeze = entry[6] if len(entry) > 6 else None
        pose = Pose(ual, srcname)
        if freeze is None:
            t1 = pose.dur if t1 is None else min(t1, pose.dur)
            n = max(2, int(round((t1 - t0) * FPS)) + 1)
            times = np.linspace(0, t1 - t0, n)
        else:
            times = np.array([0.0, t1])
        rots = {jn: [] for jn in joint_names}
        pel, rz = [], []
        z0 = None
        for tt in times:
            t = freeze if freeze is not None else t0 + tt
            for jn in joint_names:
                r, _ = pose.local(jn, t)
                rots[jn].append(r)
            _, ppos = pose.local('pelvis', t)
            pel.append(ppos)
            _, rpos = pose.local('root', t)
            z0 = rpos[2] if z0 is None else z0
            rz.append((rpos[2] - z0) * rm_scale)
        write_clip(name, times, rots, np.array(pel), np.array(rz), loop)

    # 4b. KayKit locomotion, retargeted through the two rigs' T-poses (world-space rotation deltas)
    BONEMAP = {'hips': 'pelvis', 'spine': 'spine_01', 'chest': 'spine_02', 'head': 'Head',
               'upperarm.l': 'upperarm_l', 'lowerarm.l': 'lowerarm_l', 'wrist.l': 'hand_l',
               'upperarm.r': 'upperarm_r', 'lowerarm.r': 'lowerarm_r', 'wrist.r': 'hand_r',
               'upperleg.l': 'thigh_l', 'lowerleg.l': 'calf_l', 'foot.l': 'foot_l', 'toes.l': 'ball_l',
               'upperleg.r': 'thigh_r', 'lowerleg.r': 'calf_r', 'foot.r': 'foot_r', 'toes.r': 'ball_r'}
    # target reference: the UAL T-pose applied to the outfit's bone lengths
    tpose = Pose(ual, 'A_TPose')
    t_ref_local = {jn: tpose.local(jn, 0.0)[0] for jn in joint_names}
    order = []                                   # joints in parent-first order

    def visit(j):
        order.append(outfit.name[j])
        for c in outfit.nodes[j].get('children', []):
            if c in joints:
                visit(c)
    visit(root_joint)
    tparent = {outfit.name[j]: (outfit.name[outfit.parent[j]] if outfit.parent.get(j) in joints else None) for j in joints}

    def target_world(local_rots):
        w = {}
        for jn in order:
            p = tparent[jn]
            w[jn] = qnorm(local_rots[jn]) if p is None else qnorm(qmul(w[p], local_rots[jn]))
        return w
    t_ref_world = target_world(t_ref_local)
    leg_t = abs(rest_local['calf_r'][1][1]) + abs(rest_local['foot_r'][1][1])

    KK_CLIPS = [('idle', 'general', 'Idle_A', True), ('idle2', 'general', 'Idle_B', True), ('walk', 'move', 'Walking_A', True),
                ('run', 'move', 'Running_A', True), ('run2', 'move', 'Running_B', True), ('hit', 'general', 'Hit_A', False), ('death2', 'general', 'Death_A', False)]
    for name, which, srcname, loop in KK_CLIPS:
        kg = kk[which]
        s_ref = Pose(kg, 'T-Pose').world(0.0, list(BONEMAP.keys()))
        src_leg = abs(kg.nodes[kg.byname['lowerleg.r']]['translation'][1]) + abs(kg.nodes[kg.byname['foot.r']]['translation'][1])
        pose = Pose(kg, srcname)
        n = max(2, int(round(pose.dur * FPS)) + 1)
        times = np.linspace(0, pose.dur, n)
        rots = {jn: [] for jn in joint_names}
        pel, rz = [], []
        hips_ref = s_ref['hips'][1]
        for t in times:
            sw = pose.world(t, list(BONEMAP.keys()))
            tw = {}
            local = {}
            for jn in order:
                p = tparent[jn]
                src = next((s for s, d in BONEMAP.items() if d == jn), None)
                if src is not None:
                    delta = qmul(sw[src][0], qinv(s_ref[src][0]))
                    tw[jn] = qnorm(qmul(delta, t_ref_world[jn]))
                else:
                    tw[jn] = qnorm(qmul(tw[p], t_ref_local[jn])) if p else qnorm(t_ref_local[jn])
                local[jn] = qnorm(qmul(qinv(tw[p]), tw[jn])) if p else tw[jn]
                rots[jn].append(local[jn])
            # hips travel: keep the vertical bob in proportion to the legs, damp the rest
            d = (sw['hips'][1] - hips_ref) * np.array([0.5, 0.75, 0.5]) * (leg_t / src_leg) ** 0.5
            pel.append(rest_local['pelvis'][1] + qrot(qinv(root_rot), d))
            rz.append(0.0)
        write_clip(name, times, rots, np.array(pel), np.array(rz), loop)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    total = W.write(out_path)
    tris = sum(W.g['accessors'][p['indices']]['count'] // 3 for m in W.g['meshes'] for p in m['primitives'])
    print(f'wrote {out_path}: {total / 1024:.0f} KB, {len(W.g["meshes"])} meshes, {tris} triangles, {len(W.g["animations"])} clips, {len(W.g["images"])} images')
    for a in W.g['animations']:
        n = W.g['accessors'][a['samplers'][0]['input']]['count']
        print(f"  clip {a['name']:12s} {n / FPS:.2f}s")


if __name__ == '__main__':
    main()
