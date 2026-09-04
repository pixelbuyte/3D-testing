// Headless visual-review tool. Usage:
//   node tools/screenshot.mjs --url http://localhost:5173 --out screenshots/a.png [--cam x,y,z,yaw,pitch] [--preset high] [--wait 3000] [--time 20] [--state 2] [--w 1600 --h 900]
// Uses the globally installed Playwright + bundled Chromium (WebGL2 via SwiftShader; WebGPU is not available headless).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const url = new URL(args.url ?? 'http://localhost:5173/');
url.searchParams.set('shot', '1');
if (args.preset) url.searchParams.set('preset', args.preset);
if (args.cam) url.searchParams.set('cam', args.cam);
if (args.time) url.searchParams.set('time', args.time);
if (args.state) url.searchParams.set('state', args.state);
if (args.webgl) url.searchParams.set('webgl', '1');
if (args.extra) for (const kv of String(args.extra).split('&')) { const [k, v] = kv.split('='); url.searchParams.set(k, v ?? '1'); }
const out = args.out ?? 'screenshots/shot.png';
fs.mkdirSync(path.dirname(out), { recursive: true });
const W = Number(args.w ?? 1600), H = Number(args.h ?? 900);

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`); else if (args.verbose) logs.push(`[${t}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
const t0 = Date.now();
await page.goto(url.toString(), { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction(() => globalThis.__ECHOES && globalThis.__ECHOES.ready === true, null, { timeout: Number(args.timeout ?? 240000), polling: 500 });
} catch (e) {
  logs.push('[tool] timed out waiting for __ECHOES.ready');
}
await page.waitForTimeout(Number(args.wait ?? 2500));
const stats = await page.evaluate(() => globalThis.__ECHOES ? globalThis.__ECHOES.stats() : null).catch(() => null);
await page.screenshot({ path: out });
console.log(`saved ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (stats) console.log('stats', JSON.stringify(stats));
if (logs.length) {
  fs.writeFileSync(out.replace(/\.png$/, '.log.txt'), logs.join('\n---\n'));
  console.log(`--- ${logs.length} console messages written to ${out.replace(/\.png$/, '.log.txt')} ---`);
  const uniq = [...new Set(logs.map(l => l.split('\n')[0].slice(0, 160)))];
  for (const l of uniq.slice(0, 25)) console.log(l);
}
await browser.close();
