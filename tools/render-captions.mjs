// Renders Nova's narration and the title cards as transparent PNG overlays.
//
// This ffmpeg build has no drawtext filter, so the type is laid out in a headless browser instead —
// which also means the trailer uses exactly the same fonts and treatment as the game's own HUD.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? 'demo/caps';
const W = 1600, H = 900;
fs.mkdirSync(OUT, { recursive: true });

// a/b are fractions of the trailer's running time, so the cut can change length freely
const CAPS = [
  { file: 'title.png', a: 0.010, b: 0.140, kind: 'title', line: 'ECHOES OF THE SHRINE', sub: 'a small cinematic game that runs in a browser' },
  { file: 'c1.png', a: 0.160, b: 0.255, kind: 'line', line: 'It rained here for a hundred years.' },
  { file: 'c2.png', a: 0.275, b: 0.375, kind: 'line', line: 'Then it stopped — and something started listening.' },
  { file: 'c3.png', a: 0.400, b: 0.495, kind: 'line', line: 'Three stones sleep under the moss.' },
  { file: 'c4.png', a: 0.515, b: 0.610, kind: 'line', line: 'Wake the first, and the lanterns remember fire.' },
  { file: 'c5.png', a: 0.630, b: 0.720, kind: 'line', line: 'Wake the second, and the inner gate yields.' },
  { file: 'c6.png', a: 0.740, b: 0.820, kind: 'line', line: 'Wake the third…' },
  { file: 'c7.png', a: 0.830, b: 0.900, kind: 'line', line: '…and the shrine answers.' },
  { file: 'card.png', a: 0.915, b: 0.995, kind: 'card', line: 'ECHOES OF THE SHRINE', sub: 'NARRATED BY NOVA', foot: 'PLAYCANVAS · WEBGPU-FIRST · WEBGL 2 FALLBACK' },
];

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=Inter:wght@300;400&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden}
  .wrap{position:relative;width:${W}px;height:${H}px;font-family:'Inter',system-ui,sans-serif}
  .who{position:absolute;left:7.5%;bottom:20%;font-size:15px;letter-spacing:.44em;color:#d8b273;
       text-shadow:0 2px 14px rgba(0,0,0,.95),0 0 40px rgba(0,0,0,.6)}
  .line{position:absolute;left:7.5%;bottom:12.5%;right:10%;font-family:'Cormorant Garamond',Georgia,serif;
        font-weight:300;font-size:46px;line-height:1.15;color:#ece4d6;
        text-shadow:0 2px 24px rgba(0,0,0,.95),0 0 60px rgba(0,0,0,.7)}
  .rule{position:absolute;left:7.5%;bottom:19.4%;width:34px;height:1px;background:#d8b273;opacity:.85}
  .ctitle{position:absolute;left:0;right:0;top:38%;text-align:center;font-family:'Cormorant Garamond',Georgia,serif;
          font-weight:300;font-size:74px;letter-spacing:.2em;color:#ece4d6;text-shadow:0 2px 36px rgba(0,0,0,.9)}
  .csub{position:absolute;left:0;right:0;top:53%;text-align:center;font-size:15px;letter-spacing:.42em;
        color:#d8b273;text-shadow:0 2px 14px rgba(0,0,0,.9)}
  .cfoot{position:absolute;left:0;right:0;top:59%;text-align:center;font-size:12px;letter-spacing:.3em;
         color:rgba(236,228,214,.5);text-shadow:0 2px 14px rgba(0,0,0,.9)}
  .tsub{position:absolute;left:0;right:0;top:52%;text-align:center;font-size:13px;letter-spacing:.34em;
        color:rgba(236,228,214,.7);text-transform:uppercase;text-shadow:0 2px 14px rgba(0,0,0,.9)}
</style></head><body><div class="wrap" id="w"></div></body></html>`;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(HTML, { waitUntil: 'load' });
// give the webfont a moment; the stack falls back to Georgia/DejaVu Serif if it cannot load
await page.waitForTimeout(2500);

for (const c of CAPS) {
  await page.evaluate((cap) => {
    const w = document.getElementById('w');
    if (cap.kind === 'line') {
      w.innerHTML = `<div class="rule"></div><div class="who">NOVA</div><div class="line">${cap.line}</div>`;
    } else if (cap.kind === 'title') {
      w.innerHTML = `<div class="ctitle">${cap.line}</div><div class="tsub">${cap.sub}</div>`;
    } else {
      w.innerHTML = `<div class="ctitle">${cap.line}</div><div class="csub">${cap.sub}</div><div class="cfoot">${cap.foot}</div>`;
    }
  }, c);
  await page.screenshot({ path: path.join(OUT, c.file), omitBackground: true });
  console.log(c.file);
}
fs.writeFileSync(path.join(OUT, 'captions.json'), JSON.stringify(CAPS.map(({ file, a, b }) => ({ file, a, b })), null, 2));
await browser.close();
console.log(`wrote ${CAPS.length} caption overlays to ${OUT}`);
