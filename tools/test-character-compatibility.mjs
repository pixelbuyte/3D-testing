import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { NodeIO } from '@gltf-transform/core';

const source = readFileSync('src/characters/catalog.ts', 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { ASTRA_BASE_COMMIT: base, characterAssetUrl } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
for (const id of ['player', 'ally', 'enemy']) {
  for (const query of ['', 'characterSet=unknown', 'atelier=0']) {
    assert.equal(characterAssetUrl(id, new URLSearchParams(query)), `assets/characters/${id}.glb`);
  }
  for (const query of ['characterSet=astra', 'atelier=1']) {
    assert.equal(characterAssetUrl(id, new URLSearchParams(query)), `assets/characters/astra/${id}.glb`);
  }
}
const gitFile = path => execFileSync('git', ['show', `${base}:${path}`], { maxBuffer: 20 * 1024 * 1024 });
const protectedFiles = [
  'src/combat/actor.ts', 'src/combat/combat.ts', 'src/combat/anim.ts',
  'src/combat/weapons.ts', 'src/gameplay/game.ts', 'tools/build-character.py',
  ...['player', 'ally', 'enemy'].map(id => `public/assets/characters/${id}.glb`),
];
for (const path of protectedFiles) assert.deepEqual(readFileSync(path), gitFile(path), `${path} changed from pinned Claude base`);
const previous = gitFile('src/combat/skinned.ts').toString();
const current = readFileSync('src/combat/skinned.ts', 'utf8');
const unchangedAnimator = s => s.slice(s.indexOf('interface SkinnedClipDef'), s.indexOf('export function makeSkinnedFighter'));
assert.equal(unchangedAnimator(current), unchangedAnimator(previous), 'Clip timings or animator implementation changed');

const io = new NodeIO();
const original = await io.readBinary(gitFile('public/assets/characters/player.glb'));
function animationData(doc) {
  return doc.getRoot().listAnimations().map(a => ({ name: a.getName(), channels: a.listChannels().map(c => ({
    node: c.getTargetNode().getName(), path: c.getTargetPath(),
    interpolation: c.getSampler().getInterpolation(),
    input: [...c.getSampler().getInput().getArray()], output: [...c.getSampler().getOutput().getArray()],
  })) }));
}
const originalClips = animationData(original);
for (const id of ['player', 'ally', 'enemy']) {
  const doc = await io.read(`public/assets/characters/astra/${id}.glb`);
  assert.deepEqual(animationData(doc), originalClips, `${id}: animation data changed`);
  for (const side of ['l', 'r']) {
    const socket = doc.getRoot().listNodes().find(n => n.getName() === `WeaponSocket_${side.toUpperCase()}`);
    assert.equal(socket.getParentNode().getName(), `hand_${side}`);
  }
}
console.log('PASS: 15 route cases; 9 protected files; unchanged animator/events; all 57 clip datasets; 6 bone sockets.');
