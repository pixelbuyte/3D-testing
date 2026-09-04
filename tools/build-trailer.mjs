// Cuts the demo trailer from the captured plates.
//
// Each plate gets a slow Ken Burns move (zoompan), shots cross-dissolve into each other, Nova's
// narration is composited from browser-rendered transparent PNGs (this ffmpeg build has no
// drawtext), and the procedural score is muxed underneath.
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const PLATES = args.plates ?? 'demo/plates';
const CAPS = args.caps ?? 'demo/caps';
const AUDIO = args.audio ?? 'demo/score.wav';
const OUT = args.out ?? 'demo/echoes-of-the-shrine.mp4';
const W = 1600, H = 900, FPS = 30;
const TMP = '/tmp/claude-0/-home-user-3D-testing/25f2e3e5-d2b0-543e-b5f5-5a357cd80d34/scratchpad/trailer';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// shot = plate file, seconds on screen, and the Ken Burns move (start/end zoom + pan direction)
const SHOTS = [
  ['01-path.png',      4.2, { z0: 1.00, z1: 1.10, dx: 0.0, dy: 0.0 }],
  ['02-approach.png',  4.0, { z0: 1.09, z1: 1.00, dx: -0.2, dy: 0.0 }],
  ['03-gate.png',      3.8, { z0: 1.00, z1: 1.11, dx: 0.0, dy: -0.1 }],
  ['04-forest.png',    3.2, { z0: 1.10, z1: 1.00, dx: 0.25, dy: 0.0 }],
  ['05-lanterns.png',  3.6, { z0: 1.00, z1: 1.10, dx: 0.1, dy: 0.0 }],
  ['06-court.png',     3.8, { z0: 1.08, z1: 1.00, dx: -0.15, dy: 0.05 }],
  ['07-pool.png',      2.4, { z0: 1.00, z1: 1.12, dx: 0.0, dy: 0.1 }],
  ['08-stone.png',     3.4, { z0: 1.12, z1: 1.00, dx: 0.0, dy: 0.0 }],
  ['09-ruin.png',      3.0, { z0: 1.00, z1: 1.10, dx: -0.2, dy: 0.0 }],
  ['10-innergate.png', 3.6, { z0: 1.00, z1: 1.13, dx: 0.0, dy: -0.05 }],
  ['11-sanctum.png',   3.6, { z0: 1.10, z1: 1.00, dx: 0.0, dy: 0.1 }],
  ['12-beamwide.png',  4.0, { z0: 1.00, z1: 1.12, dx: 0.0, dy: 0.0 }],
  ['13-crane.png',     5.0, { z0: 1.12, z1: 1.00, dx: 0.0, dy: 0.0 }],
];
const XF = 0.7; // cross-dissolve length

const have = SHOTS.filter(([f]) => fs.existsSync(path.join(PLATES, f)));
if (!have.length) { console.error(`no plates in ${PLATES}`); process.exit(1); }
if (have.length !== SHOTS.length) console.log(`note: using ${have.length}/${SHOTS.length} plates`);

// ---- 1. render each plate to a clip with its Ken Burns move
const clips = [];
have.forEach(([file, secs, kb], i) => {
  const n = Math.round(secs * FPS);
  const clip = path.join(TMP, `c${String(i).padStart(2, '0')}.mp4`);
  // zoompan works on an upscaled source so the pan stays sharp
  const zoom = `min(${kb.z0}+(${(kb.z1 - kb.z0).toFixed(4)})*on/${n},1.6)`;
  const xExpr = `iw/2-(iw/zoom/2)+(${(kb.dx * 0.5).toFixed(3)})*iw*on/${n}`;
  const yExpr = `ih/2-(ih/zoom/2)+(${(kb.dy * 0.5).toFixed(3)})*ih*on/${n}`;
  execFileSync(ffmpegPath, [
    '-y', '-loop', '1', '-i', path.join(PLATES, file), '-t', String(secs),
    '-vf', `scale=${W * 2}:${H * 2}:flags=lanczos,zoompan=z='${zoom}':x='${xExpr}':y='${yExpr}':d=${n}:s=${W}x${H}:fps=${FPS},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', clip,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  clips.push({ clip, secs });
  process.stdout.write(`.`);
});
console.log(` ${clips.length} clips`);

// ---- 2. chain them with cross-dissolves
const inputs = [];
clips.forEach((c) => inputs.push('-i', c.clip));
let filter = '';
let last = '0:v';
let offset = 0;
for (let i = 1; i < clips.length; i++) {
  offset += clips[i - 1].secs - XF;
  const out = `x${i}`;
  filter += `[${last}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(3)}[${out}];`;
  last = out;
}
const totalDur = clips.reduce((a, c) => a + c.secs, 0) - XF * (clips.length - 1);
filter += `[${last}]fade=t=in:st=0:d=1.0,fade=t=out:st=${(totalDur - 1.2).toFixed(2)}:d=1.2,format=yuv420p[v]`;
const base = path.join(TMP, 'base.mp4');
execFileSync(ffmpegPath, [...['-y'], ...inputs, '-filter_complex', filter, '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', base], { stdio: ['ignore', 'ignore', 'pipe'] });
console.log(`base montage ${totalDur.toFixed(1)}s`);

// ---- 3. overlay the narration PNGs (rendered by tools/render-captions.mjs) and mux the score
const capsMeta = path.join(CAPS, 'captions.json');
const cmd = ['-y', '-i', base];          // input 0 = the montage
let inputIndex = 0;
const parts = [];
let vLabel = '0:v';

if (fs.existsSync(capsMeta)) {
  const caps = JSON.parse(fs.readFileSync(capsMeta, 'utf8'))
    .map((c) => ({ ...c, a: c.a * totalDur, b: c.b * totalDur }))
    .filter((c) => fs.existsSync(path.join(CAPS, c.file)));
  for (const c of caps) {
    cmd.push('-loop', '1', '-t', String(totalDur), '-i', path.join(CAPS, c.file));
    inputIndex++;
    const f = 0.6;
    // fade the overlay's alpha in and out, then composite it only inside its window
    parts.push(`[${inputIndex}:v]format=rgba,fade=t=in:st=${c.a.toFixed(2)}:d=${f}:alpha=1,` +
               `fade=t=out:st=${(c.b - f).toFixed(2)}:d=${f}:alpha=1[o${inputIndex}]`);
    parts.push(`[${vLabel}][o${inputIndex}]overlay=0:0:enable='between(t,${c.a.toFixed(2)},${c.b.toFixed(2)})'[v${inputIndex}]`);
    vLabel = `v${inputIndex}`;
  }
  console.log(`overlaying ${caps.length} captions`);
} else {
  console.log('note: no captions found, writing without narration');
}

const hasAudio = fs.existsSync(AUDIO);
let audioIndex = -1;
if (hasAudio) { cmd.push('-i', AUDIO); inputIndex++; audioIndex = inputIndex; }

if (parts.length) cmd.push('-filter_complex', parts.join(';'));
cmd.push('-map', parts.length ? `[${vLabel}]` : '0:v');
if (hasAudio) cmd.push('-map', `${audioIndex}:a`, '-c:a', 'aac', '-b:a', '160k', '-shortest');
cmd.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT);

execFileSync(ffmpegPath, cmd, { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB, ${totalDur.toFixed(1)}s)`);
