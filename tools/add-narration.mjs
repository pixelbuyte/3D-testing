// Overlays the on-screen narration ("NOVA") and title cards onto the captured flythrough.
//
// Everything is drawn with ffmpeg's drawtext so no extra tooling is needed. Each caption fades in
// and out via an alpha expression, and the type is styled to match the game's own HUD: a small
// letterspaced gold speaker label over a larger off-white serif line.
//
// Usage: node tools/add-narration.mjs --in demo/raw.mp4 --out demo/echoes-demo.mp4 --duration 34
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const IN = args.in ?? 'demo/raw.mp4';
const OUT = args.out ?? 'demo/echoes-of-the-shrine.mp4';
const AUDIO = args.audio ?? null;
const D = Number(args.duration ?? 34);

const SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf';
const SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const GOLD = '0xd8b273';
const INK = '0xece4d6';

// Fractions of the running time, so the script re-times itself if the capture length changes.
const CAPTIONS = [
  { at: 0.02, to: 0.13, line: 'It rained here for a hundred years.' },
  { at: 0.15, to: 0.26, line: 'Then it stopped, and something started listening.' },
  { at: 0.29, to: 0.40, line: 'Three stones sleep under the moss.' },
  { at: 0.43, to: 0.54, line: 'Wake the first — and the lanterns remember fire.' },
  { at: 0.57, to: 0.68, line: 'Wake the second — and the inner gate yields.' },
  { at: 0.71, to: 0.80, line: 'Wake the third…' },
  { at: 0.82, to: 0.92, line: '…and the shrine answers.' },
];

/** ffmpeg drawtext needs these escaped inside a filter string. */
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\\\\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/%/g, '\\%');
/** Fake letterspacing — drawtext has no tracking control. */
const spaced = (s) => s.split('').join(' ');
/** Fade a caption in and out. */
const alpha = (a, b, f = 0.55) =>
  `if(lt(t,${a}),0,if(lt(t,${a + f}),(t-${a})/${f},if(lt(t,${b - f}),1,if(lt(t,${b}),(${b}-t)/${f},0))))`;

const filters = [];

// --- narration: a gold speaker label with the line beneath it, lower left
for (const c of CAPTIONS) {
  const a = c.at * D, b = c.to * D;
  filters.push([
    `drawtext=fontfile=${SANS}`,
    `text='${esc(spaced('NOVA'))}'`,
    'fontcolor=' + GOLD, 'fontsize=17', 'x=88', `y=h-152`,
    'shadowcolor=0x000000@0.85', 'shadowx=0', 'shadowy=2',
    `alpha='${alpha(a, b)}'`,
  ].join(':'));
  filters.push([
    `drawtext=fontfile=${SERIF}`,
    `text='${esc(c.line)}'`,
    'fontcolor=' + INK, 'fontsize=30', 'x=88', `y=h-118`,
    'shadowcolor=0x000000@0.9', 'shadowx=0', 'shadowy=2',
    `alpha='${alpha(a, b)}'`,
  ].join(':'));
}

// --- opening title, centred, over the first shot
filters.push([
  `drawtext=fontfile=${SERIF}`,
  `text='${esc(spaced('ECHOES OF THE SHRINE'))}'`,
  'fontcolor=' + INK, 'fontsize=44', 'x=(w-text_w)/2', 'y=(h/2)-40',
  'shadowcolor=0x000000@0.9', 'shadowx=0', 'shadowy=3',
  `alpha='${alpha(0.6, 5.2, 1.1)}'`,
].join(':'));

// --- closing card
const cardIn = D - 4.4;
filters.push([
  `drawtext=fontfile=${SERIF}`,
  `text='${esc(spaced('ECHOES OF THE SHRINE'))}'`,
  'fontcolor=' + INK, 'fontsize=42', 'x=(w-text_w)/2', 'y=(h/2)-52',
  'shadowcolor=0x000000@0.9', 'shadowx=0', 'shadowy=3',
  `alpha='${alpha(cardIn, D - 0.1, 1.0)}'`,
].join(':'));
filters.push([
  `drawtext=fontfile=${SANS}`,
  `text='${esc(spaced('NARRATED BY NOVA'))}'`,
  'fontcolor=' + GOLD, 'fontsize=16', 'x=(w-text_w)/2', 'y=(h/2)+16',
  'shadowcolor=0x000000@0.85', 'shadowx=0', 'shadowy=2',
  `alpha='${alpha(cardIn + 0.5, D - 0.1, 1.0)}'`,
].join(':'));
filters.push([
  `drawtext=fontfile=${SANS}`,
  `text='${esc(spaced('PLAYCANVAS  ·  WEBGPU  ·  IN A BROWSER'))}'`,
  'fontcolor=0x9aa3ad', 'fontsize=13', 'x=(w-text_w)/2', 'y=(h/2)+48',
  'shadowcolor=0x000000@0.85', 'shadowx=0', 'shadowy=2',
  `alpha='${alpha(cardIn + 0.9, D - 0.1, 1.0)}'`,
].join(':'));

const vf = filters.join(',') + ',format=yuv420p';
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const cmd = ['-y', '-i', IN];
if (AUDIO) cmd.push('-i', AUDIO);
cmd.push('-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20');
if (AUDIO) cmd.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
cmd.push('-movflags', '+faststart', OUT);
execFileSync(ffmpegPath, cmd, { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB)`);
