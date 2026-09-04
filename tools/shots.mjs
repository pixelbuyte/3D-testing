// Multi-view screenshot tool: loads the game once, then flies the camera to each view.
// Usage: node tools/shots.mjs --preset medium --out screenshots/run1 --views "name:x,y,z,yaw,pitch;name2:..."
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const outDir = args.out ?? 'screenshots/run';
fs.mkdirSync(outDir, { recursive: true });
const W = Number(args.w ?? 1600), H = Number(args.h ?? 900);
const views = String(args.views ?? 'default:0,8,-30,0,-8').split(';').filter(Boolean).map((v) => {
  const [name, nums] = v.split(':');
  const [x, y, z, yaw, pitch] = nums.split(',').map(Number);
  return { name, x, y, z, yaw, pitch: pitch || 0 };
});

const url = new URL(args.url ?? 'http://localhost:5173/');
url.searchParams.set('shot', '1');
if (args.preset) url.searchParams.set('preset', args.preset);
if (args.state) url.searchParams.set('state', args.state);
if (args.webgl) url.searchParams.set('webgl', '1');
url.searchParams.set('cam', `${views[0].x},${views[0].y},${views[0].z},${views[0].yaw},${views[0].pitch}`);

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning' || args.verbose) logs.push(`[${t}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 8).join('\n')}`));
const t0 = Date.now();
await page.goto(url.toString(), { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction(() => globalThis.__ECHOES && globalThis.__ECHOES.ready === true, null, { timeout: Number(args.timeout ?? 400000), polling: 500 });
} catch { logs.push('[tool] timed out waiting for __ECHOES.ready'); }
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

for (const v of views) {
  await page.evaluate(([x, y, z, yaw, pitch]) => globalThis.__ECHOES.setCamera(x, y, z, yaw, pitch), [v.x, v.y, v.z, v.yaw, v.pitch]);
  await page.waitForTimeout(Number(args.wait ?? 2200));
  const file = path.join(outDir, `${v.name}.png`);
  await page.screenshot({ path: file });
  const stats = await page.evaluate(() => globalThis.__ECHOES.stats()).catch(() => null);
  console.log(`${v.name}  ${stats ? JSON.stringify(stats) : ''}`);
}
if (args.probe) {
  const probe = await page.evaluate((expr) => { try { return JSON.stringify(eval(expr)); } catch (e) { return 'ERR ' + e.message; } }, String(args.probe));
  console.log('probe:', probe);
}
if (logs.length) {
  fs.writeFileSync(path.join(outDir, 'console.log.txt'), logs.join('\n---\n'));
  const uniq = [...new Set(logs.map((l) => l.split('\n')[0].slice(0, 170)))];
  console.log(`--- ${logs.length} console msgs (${uniq.length} unique) ---`);
  for (const l of uniq.slice(0, 20)) console.log(l);
}
await browser.close();
