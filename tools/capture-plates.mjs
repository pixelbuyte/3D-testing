// Captures the still "plates" the demo trailer is cut from.
//
// The scene costs ~20-30 s per frame on a software rasteriser, so a real-time capture is not
// practical here; instead we render a set of high-quality stills along the intended camera path and
// build the trailer from slow moves across them (see tools/build-trailer.mjs).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? 'demo/plates';
// `--only 17-kneel,05-lanterns` re-shoots just those plates; each one costs about a minute, so
// iterating on a single framing should not mean re-rendering the whole set.
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > -1 && process.argv[onlyArg + 1] ? new Set(process.argv[onlyArg + 1].split(',')) : null;
fs.mkdirSync(OUT, { recursive: true });

// name, [x, y, z, yaw, pitch], world state
const PLATES = [
  ['01-path',      [1.5, 2.2, -62, 176, 2], 0],
  ['02-approach',  [0, 4.0, -46, 180, 3], 0],
  ['03-gate',      [0, 3.5, -27, 180, 2], 0],
  ['04-forest',    [-24, 5, -30, 140, 2], 0],
  ['05-lanterns',  [0, 2.6, -22, 180, 1], 1],
  ['06-court',     [0, 3.0, -6, 180, -3], 1],
  ['07-pool',      [8.5, 2.0, -15, 172, -11], 1],
  ['08-stone',     [24.0, 4.0, 8.0, 225, -7], 1],
  ['09-ruin',      [-23.5, 4.0, 9.5, 138, -6], 1],
  ['10-innergate', [0, 3.0, 8, 180, 4], 2],
  ['11-sanctum',   [0, 5.0, 24, 180, 4], 3],
  ['12-beamwide',  [0, 9.0, 22, 180, 4], 3],
  ['13-crane',     [0, 16.0, 8, 180, -14], 3],
  // The people at the shrine. Camera heights are absolute: courtyard terrain runs 2.13-2.47 m and
  // the sanctum platform floor is 6.65 m. These framings came out of a review pass that scored
  // candidate angles on whether the figure reads as a person (target 15-30% of frame height),
  // whether anything bisects the frame, and whether the lower-left stays clear for the narration.
  ['14-tended',    [-12.8, 4.27, -6.4, 217, 0], 1],
  ['15-nova',      [-1.8, 3.90, 1.6, 162, 0], 1],
  ['16-watcher',   [-6.0, 4.15, -3.0, 107, -6], 1],
  ['17-kneel',     [-2.6, 7.95, 42.2, 259, -2], 2],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(400000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const t0 = Date.now();
await page.goto(`http://localhost:5173/?shot=1&preset=high&cam=${PLATES[0][1].join(',')}`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => globalThis.__ECHOES?.ready === true, null, { timeout: 900000, polling: 500 });
// hide the HUD: the trailer supplies its own type
await page.evaluate(() => {
  for (const id of ['grain', 'hud']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
});
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

let state = -1;
for (const [name, cam, st] of PLATES.filter(([n]) => !ONLY || ONLY.has(n))) {
  if (st !== state) { await page.evaluate((n) => globalThis.__ECHOES.setState(n), st); state = st; }
  await page.evaluate((c) => globalThis.__ECHOES.setCamera(c[0], c[1], c[2], c[3], c[4]), cam);
  // let the doors/beam/lanterns settle into the requested state
  await page.waitForTimeout(st >= 2 ? 9000 : 2500);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  console.log(`${name}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
if (errs.length) console.log('errors:', [...new Set(errs)].slice(0, 3));
console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
