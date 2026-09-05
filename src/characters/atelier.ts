import { AnimClip, AnimEvaluator, DefaultAnimBinder, Entity, type AnimTrack } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { Game } from '@/gameplay/game';
import { makeSkinnedFighter, type Variant } from '@/combat/skinned';
import './atelier.css';

/** Inspection-only actors. Never emits combat events or advances the combat director. */
export function installAtelier(ctx: EngineContext, game: Game): void {
  window.__ECHOES?.pause?.(true);
  window.__ECHOES?.freeCam(true);
  game.input.enabled = false;
  const variants: Variant[] = ['player', 'ally', 'enemy'];
  const z = -10;
  const actors = variants.map((variant, index) => {
    const container = game.assets.model(`char/${variant}`);
    const fighter = makeSkinnedFighter(ctx, container, variant);
    ctx.app.root.addChild(fighter.root);
    const x = (index - 1) * 2.1;
    fighter.root.setPosition(x, game.world.field.heightAt(x, z), z);
    // Factory contract: fighter root -> orientation/scale model -> instantiated GLB.
    const model = fighter.root.children[0].children[0] as Entity;
    const evaluator = new AnimEvaluator(new DefaultAnimBinder(model));
    const tracks = (container as unknown as { animations: { resource: AnimTrack }[] }).animations;
    const clips = tracks.map(({ resource }) => {
      const clip = new AnimClip(resource, 0, 1, false, false);
      clip.blendWeight = 0;
      evaluator.addClip(clip);
      return clip;
    });
    return { fighter, evaluator, clips };
  });
  const panel = document.createElement('section');
  panel.className = 'character-atelier';
  panel.setAttribute('aria-label', 'Character Atelier');
  panel.innerHTML = `<h1>Character Atelier</h1>
    <p>PLAYER · ALLY · ENEMY / Astra opt-in set</p>
    <label>Animation <select aria-label="Animation"></select></label>
    <label>View <select aria-label="View"><option value="0">Front</option><option value="90">Side</option><option value="180">Back</option></select></label>
    <label>Distance <select aria-label="Distance"><option value="6.8">Detail</option><option value="11">Gameplay</option></select></label>
    <button type="button" aria-label="Play animation">Play</button>
    <label>Pose <input aria-label="Pose" type="range" min="0" max="1" step="0.001" value="0"></label>
    <output aria-live="off">0%</output>
    <p class="atelier-note">Inspection only; combat paused. Nunchuck clips remain sword-derived. Check cloth clearance before approval.</p>
    <a href="?characterSet=astra">Test Astra in game</a> · <a href="?">Return to original game</a>`;
  document.body.append(panel);
  const animation = panel.querySelector<HTMLSelectElement>('[aria-label="Animation"]')!;
  const view = panel.querySelector<HTMLSelectElement>('[aria-label="View"]')!;
  const distance = panel.querySelector<HTMLSelectElement>('[aria-label="Distance"]')!;
  const slider = panel.querySelector<HTMLInputElement>('input')!;
  const button = panel.querySelector('button')!;
  const output = panel.querySelector('output')!;
  for (const clip of actors[0].clips) animation.add(new Option(clip.track.name, clip.track.name));
  animation.value = 'guard';
  let playing = false;
  let phase = 0;
  function pose(): void {
    for (const actor of actors) {
      actor.fighter.root.setLocalEulerAngles(0, Number(view.value), 0);
      for (const clip of actor.clips) {
        clip.blendWeight = clip.track.name === animation.value ? 1 : 0;
        clip.time = clip.track.duration * phase;
      }
      actor.evaluator.update(0);
    }
    slider.value = String(phase);
    output.value = `${Math.round(phase * 100)}%`;
  }
  function camera(): void {
    const y = game.world.field.heightAt(0, z);
    game.world.camera.setPosition(0, y + 1.35, z - Number(distance.value));
    game.world.camera.lookAt(0, y + 0.95, z);
  }
  button.onclick = () => {
    playing = !playing;
    button.textContent = playing ? 'Pause' : 'Play';
    button.setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
  };
  slider.oninput = () => { phase = Number(slider.value); pose(); };
  animation.onchange = () => { phase = 0; pose(); };
  view.onchange = pose;
  distance.onchange = camera;
  const update = (dt: number): void => {
    if (!playing) return;
    const duration = actors[0].clips.find(c => c.track.name === animation.value)?.track.duration ?? 1;
    phase = (phase + Math.min(dt, 0.05) / Math.max(duration, 0.001)) % 1;
    pose();
  };
  ctx.app.on('update', update);
  ctx.app.once('destroy', () => {
    ctx.app.off('update', update);
    for (const actor of actors) actor.fighter.destroy();
    panel.remove();
  });
  camera();
  pose();
}
