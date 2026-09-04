import '@/ui/styles.css';
import { LoadingScreen } from '@/ui/loading';
import { createEngine } from '@/core/engine';
import { AssetBank } from '@/assets/manifest';
import { World } from '@/world/world';
import { Game } from '@/gameplay/game';
import { isShotMode, urlParams } from '@/core/debug';

async function boot(): Promise<void> {
  const loading = new LoadingScreen();
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  loading.setStatus('Waking the renderer…');
  const engine = await createEngine(canvas, { forceWebGL: urlParams.has('webgl') });
  loading.setRenderer(engine.rendererName);

  loading.setStatus('Gathering stone and moss…');
  const assets = new AssetBank(engine.app);
  await assets.load((p) => loading.setProgress(p * 0.6));

  const world = new World(engine, assets);
  await world.build((p, status) => { loading.setProgress(0.6 + p * 0.4); loading.setStatus(status); });

  engine.app.start();
  const game = new Game(engine, world, assets);
  await loading.waitForEnter(isShotMode);
  loading.hide();
  game.start();
}

boot().catch((err) => {
  console.error('[boot] fatal', err);
  const status = document.querySelector<HTMLElement>('#loading .status');
  if (status) status.textContent = `Something broke while loading: ${err instanceof Error ? err.message : String(err)}`;
});
