// Captures a narrated cinematic flythrough of the game and encodes it to MP4.
//
// Two ideas make this work in a software-rendered environment:
//  1. The camera and the narration are driven by FRAME INDEX, not wall-clock time, so the output is
//     perfectly smooth at the target fps no matter how slowly each frame actually renders.
//  2. The narration is injected into the page and rendered by the browser in the game's own type,
//     rather than burned in later with ffmpeg's drawtext (which this ffmpeg build lacks).
//
// Usage: node tools/capture-video.mjs [--out demo/echoes.mp4] [--w 1024 --h 576] [--fps 24]
//                                     [--preset medium] [--scale 0.75] [--foliage 0.5] [--audio demo/score.wav]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));

const OUT = args.out ?? 'demo/echoes-of-the-shrine.mp4';
const W = Number(args.w ?? 1024), H = Number(args.h ?? 576), FPS = Number(args.fps ?? 24);
const AUDIO = args.audio ?? null;
const FRAMES = '/tmp/claude-0/-home-user-3D-testing/25f2e3e5-d2b0-543e-b5f5-5a357cd80d34/scratchpad/frames';
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// ---------------------------------------------------------------- shot list
// seconds, from [x,y,z,yaw,pitch] -> to [...], and the world state to switch to at the shot's start.
const SHOTS = [
  { s: 4.0, from: [2.5, 2.0, -68, 172, 1], to: [1.0, 2.2, -56, 176, 2], state: 0 },
  { s: 3.5, from: [0.5, 2.1, -52, 178, 3], to: [-0.5, 5.5, -40, 182, -4] },
  { s: 4.0, from: [-1.0, 2.4, -38, 181, 1], to: [0.0, 2.6, -25, 180, 2] },
  { s: 4.0, from: [0, 2.6, -24, 180, 1], to: [0, 2.8, -12, 180, -1], state: 1 },
  { s: 4.5, from: [-9, 3.2, -6, 205, -3], to: [9, 3.2, -6, 155, -3] },
  { s: 4.5, from: [0, 2.8, -4, 180, 2], to: [0, 3.0, 12, 180, 4], state: 2 },
  { s: 4.0, from: [0, 3.4, 16, 180, 6], to: [0, 4.2, 26, 180, 8], state: 3 },
  { s: 5.5, from: [0, 5.0, 30, 180, 6], to: [0, 16.0, 8, 180, -14] },
];
const DUR = SHOTS.reduce((a, s) => a + s.s, 0);

// ---------------------------------------------------------------- narration (seconds)
const CAPTIONS = [
  { a: 0.7, b: 4.4, line: 'It rained here for a hundred years.' },
  { a: 5.2, b: 9.0, line: 'Then it stopped, and something started listening.' },
  { a: 9.9, b: 13.7, line: 'Three stones sleep under the moss.' },
  { a: 14.6, b: 18.4, line: 'Wake the first, and the lanterns remember fire.' },
  { a: 19.4, b: 23.2, line: 'Wake the second, and the inner gate yields.' },
  { a: 24.2, b: 27.4, line: 'Wake the third…' },
  { a: 27.9, b: 31.2, line: '…and the shrine answers.' },
];
const TITLE = { a: 0.6, b: 5.4 };
const CARD = { a: DUR - 4.4, b: DUR };

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

const url = new URL(args.url ?? 'http://localhost:5173/');
url.searchParams.set('shot', '1');
url.searchParams.set('preset', String(args.preset ?? 'medium'));
if (args.scale) url.searchParams.set('scale', String(args.scale));
if (args.foliage) url.searchParams.set('foliage', String(args.foliage));
url.searchParams.set('cam', SHOTS[0].from.join(','));

const t0 = Date.now();
await page.goto(url.toString(), { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => globalThis.__ECHOES?.ready === true, null, { timeout: 900000, polling: 500 });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// --- inject the narration overlay, styled to match the game's HUD
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = `
    #narr { position: fixed; inset: 0; z-index: 45; pointer-events: none;
            font-family: 'Inter', system-ui, sans-serif; }
    #narr .who { position: absolute; left: 7.5%; bottom: 19%; font-size: 12px; letter-spacing: 0.42em;
                 color: #d8b273; text-shadow: 0 2px 12px rgba(0,0,0,.95); }
    #narr .line { position: absolute; left: 7.5%; bottom: 12%; right: 12%;
                  font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 300;
                  font-size: clamp(22px, 3.1vw, 40px); line-height: 1.15; color: #ece4d6;
                  text-shadow: 0 2px 20px rgba(0,0,0,.95); }
    #narr .title { position: absolute; left: 0; right: 0; top: 40%; text-align: center;
                   font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 300;
                   font-size: clamp(30px, 5.2vw, 64px); letter-spacing: 0.2em; color: #ece4d6;
                   text-shadow: 0 2px 30px rgba(0,0,0,.9); }
    #narr .sub { position: absolute; left: 0; right: 0; top: 55%; text-align: center;
                 font-size: 12px; letter-spacing: 0.4em; color: #d8b273; text-shadow: 0 2px 12px rgba(0,0,0,.9); }
    #narr .foot { position: absolute; left: 0; right: 0; top: 61%; text-align: center;
                  font-size: 10px; letter-spacing: 0.3em; color: rgba(236,228,214,.45); }
  `;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'narr';
  el.innerHTML = `<div class="who"></div><div class="line"></div>
                  <div class="title"></div><div class="sub"></div><div class="foot"></div>`;
  document.body.appendChild(el);
  const q = (s) => el.querySelector(s);
  globalThis.__NARR = { who: q('.who'), line: q('.line'), title: q('.title'), sub: q('.sub'), foot: q('.foot') };
});

await page.waitForTimeout(2500);

const fadeAlpha = (t, a, b, f) => {
  if (t < a || t > b) return 0;
  if (t < a + f) return (t - a) / f;
  if (t > b - f) return Math.max(0, (b - t) / f);
  return 1;
};

let frame = 0;
const total = Math.round(DUR * FPS);
for (const shot of SHOTS) {
  if (shot.state !== undefined) await page.evaluate((n) => globalThis.__ECHOES.setState(n), shot.state);
  const n = Math.round(shot.s * FPS);
  for (let i = 0; i < n; i++) {
    const t = smooth(i / Math.max(1, n - 1));
    const cam = shot.from.map((v, k) => lerp(v, shot.to[k], t));
    const now = frame / FPS;
    const cap = CAPTIONS.find((c) => now >= c.a && now <= c.b) ?? null;
    const payload = {
      cam,
      capAlpha: cap ? fadeAlpha(now, cap.a, cap.b, 0.55) : 0,
      capLine: cap ? cap.line : '',
      titleAlpha: fadeAlpha(now, TITLE.a, TITLE.b, 1.1),
      cardAlpha: fadeAlpha(now, CARD.a, CARD.b, 1.0),
      subAlpha: fadeAlpha(now, CARD.a + 0.5, CARD.b, 1.0),
      footAlpha: fadeAlpha(now, CARD.a + 0.9, CARD.b, 1.0),
    };
    await page.evaluate((p) => {
      const g = globalThis.__ECHOES, n2 = globalThis.__NARR;
      g.setCamera(p.cam[0], p.cam[1], p.cam[2], p.cam[3], p.cam[4]);
      n2.who.style.opacity = String(p.capAlpha);
      n2.who.textContent = p.capAlpha > 0 ? 'NOVA' : '';
      n2.line.style.opacity = String(p.capAlpha);
      n2.line.textContent = p.capLine;
      n2.title.style.opacity = String(p.titleAlpha);
      n2.title.textContent = p.titleAlpha > 0 ? 'ECHOES OF THE SHRINE' : '';
      const card = p.cardAlpha > 0;
      n2.title.style.opacity = String(card ? p.cardAlpha : p.titleAlpha);
      if (card) n2.title.textContent = 'ECHOES OF THE SHRINE';
      n2.sub.style.opacity = String(p.subAlpha);
      n2.sub.textContent = p.subAlpha > 0 ? 'NARRATED BY NOVA' : '';
      n2.foot.style.opacity = String(p.footAlpha);
      n2.foot.textContent = p.footAlpha > 0 ? 'PLAYCANVAS · WEBGPU-FIRST · RUNNING IN A BROWSER' : '';
    }, payload);
    await page.screenshot({ path: path.join(FRAMES, `f${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
    frame++;
    if (frame % 24 === 0) {
      const el = (Date.now() - t0) / 1000;
      const rate = (el - 0) / frame;
      console.log(`frame ${frame}/${total}  ${(frame / total * 100).toFixed(0)}%  ${el.toFixed(0)}s  eta ${(((total - frame) * rate) / 60).toFixed(1)}min`);
    }
  }
}
await browser.close();
console.log(`captured ${frame} frames in ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
if (errors.length) console.log('console errors:', [...new Set(errors)].slice(0, 5));

// ---------------------------------------------------------------- encode
const fade = 0.8;
const vf = `fade=t=in:st=0:d=${fade},fade=t=out:st=${(DUR - fade).toFixed(2)}:d=${fade},format=yuv420p`;
const cmd = ['-y', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.jpg')];
if (AUDIO && fs.existsSync(AUDIO)) cmd.push('-i', AUDIO);
cmd.push('-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20');
if (AUDIO && fs.existsSync(AUDIO)) cmd.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
cmd.push('-movflags', '+faststart', OUT);
execFileSync(ffmpegPath, cmd, { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB, ${DUR.toFixed(1)}s @ ${FPS}fps)`);
