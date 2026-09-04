// Renders Nova's narration and the title cards as transparent PNG overlays.
//
// Nova is a character in the level, not just a voice-over: she stands at the head of the courtyard
// and her singing is synthesised at runtime, so the narration speaks as her ("some of us stayed").
//
// This ffmpeg build has no drawtext filter, so the type is laid out in a headless browser instead —
// which also means the trailer uses exactly the same fonts and treatment as the game's own HUD.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { timeline } from './trailer-shots.mjs';

const OUT = process.argv[2] ?? 'demo/caps';
const W = 1600, H = 900;
fs.mkdirSync(OUT, { recursive: true });

// Each line names the shot it belongs over, plus how far into that shot it appears and how long
// before the cut it clears. Absolute seconds are derived from the shared shot table, so a caption
// cannot drift onto the wrong shot when a length changes.
const CAPS = [
  { file: 'title.png', over: '01-path.png', lead: 0.5, tail: -2.5, kind: 'title', line: 'ECHOES OF THE SHRINE', sub: 'a small cinematic game that runs in a browser' },
  { file: 'c1.png', over: '03-gate.png', lead: 0.6, tail: -1.4, kind: 'line', line: 'It rained here for a hundred years.' },
  { file: 'c2.png', over: '05-lanterns.png', lead: 0.4, tail: -1.4, kind: 'line', line: 'Then it stopped — and something started listening.' },
  { file: 'c3.png', over: '14-tended.png', lead: 0.3, tail: 0.1, kind: 'line', line: 'Not everyone left when the lanterns went cold.' },
  { file: 'c4.png', over: '15-nova.png', lead: 0.9, tail: 0.3, kind: 'line', line: 'Some of us stayed, and sang to the stones.' },
  { file: 'c5.png', over: '16-watcher.png', lead: 0.1, tail: 0.7, kind: 'line', line: 'Some of us only wait.' },
  { file: 'c6.png', over: '08-stone.png', lead: 0.4, tail: 0.2, kind: 'line', line: 'Three stones sleep under the moss.' },
  { file: 'c7.png', over: '10-innergate.png', lead: -0.7, tail: 1.0, kind: 'line', line: 'Wake the first, and the lanterns remember fire.' },
  { file: 'c8.png', over: '17-kneel.png', lead: 0.3, tail: 0.3, kind: 'line', line: 'Wake the second, and the gate yields.' },
  { file: 'c9.png', over: '11-sanctum.png', lead: 1.0, tail: 0.2, kind: 'line', line: 'Wake the third…' },
  { file: 'c10.png', over: '12-beamwide.png', lead: 0.9, tail: 0.3, kind: 'line', line: '…and the shrine answers.' },
  { file: 'card.png', over: '13-crane.png', lead: 1.0, tail: 0.3, kind: 'card', line: 'ECHOES OF THE SHRINE', sub: 'NOVA — SUNG LIVE, NOT SAMPLED', foot: 'PLAYCANVAS · WEBGPU-FIRST · WEBGL 2 FALLBACK' },
];

const TL = timeline();
for (const c of CAPS) {
  const shot = TL.find(c.over);
  if (!shot) throw new Error(`caption ${c.file} names an unknown shot: ${c.over}`);
  c.a = shot.start + c.lead;
  c.b = shot.end - c.tail;
  if (c.b <= c.a) throw new Error(`caption ${c.file} has a non-positive window on ${c.over}`);
  // 0.6 s of that window is spent fading in and another 0.6 s fading out
  if (c.b - c.a < 2.0) console.warn(`warning: ${c.file} is only ${(c.b - c.a).toFixed(1)}s on screen`);
}

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
// absolute seconds, consumed verbatim by build-trailer.mjs
fs.writeFileSync(path.join(OUT, 'captions.json'), JSON.stringify(CAPS.map(({ file, a, b }) => ({ file, a, b })), null, 2));
await browser.close();
console.log(`wrote ${CAPS.length} caption overlays to ${OUT}`);
