import { Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { AssetBank } from '@/assets/manifest';
import type { World } from '@/world/world';
import { Input } from '@/player/input';
import { PlayerController } from '@/player/controller';
import { HUD } from '@/ui/hud';
import { SettingsMenu, type HeroModelSource } from '@/ui/menu';
import { AudioEngine } from '@/audio/audio';
import { Director, type GameState } from './director';
import { NpcDirector } from './npcs';
import { CombatDirector } from '@/combat/combat';
import { HeroProp } from '@/world/heroProp';
import { LEVEL } from '@/world/level';
import { installDebug, isShotMode, urlParams } from '@/core/debug';
import { DEG } from '@/utils/math';
import { settings } from '@/core/settings';

export class Game {
  input: Input;
  player: PlayerController;
  hud = new HUD();
  audio = new AudioEngine();
  director: Director;
  npcs: NpcDirector;
  combat: CombatDirector;
  private debugPanel = false;
  menu: SettingsMenu;
  hero: HeroProp;
  freeCam = false;
  private fpsT0 = performance.now(); private fpsN = 0; private fps = 0;
  private up = new Vec3(0, 1, 0);
  private audioStarted = false;

  constructor(private ctx: EngineContext, public world: World, public assets: AssetBank) {
    this.input = new Input(ctx.canvas);
    this.player = new PlayerController(this.input, world.collision, world.field, world.camera);
    this.player.setWaterQuery((x, z) => world.water.waterLevelAt(x, z));
    this.player.spawn(LEVEL.spawn.x, LEVEL.spawn.z, LEVEL.spawn.yaw);

    this.director = new Director(ctx, world, this.hud, this.audio);
    this.director.setRestartHandler(() => this.restart());
    this.director.setCinematicHandler((active) => {
      this.player.frozen = active;
      if (active) this.player.lookAt(world.shrine.altarTop.x, world.shrine.altarTop.y + 6, world.shrine.altarTop.z);
    });

    this.npcs = new NpcDirector(ctx, world, this.audio, this.hud);

    this.combat = new CombatDirector(ctx, world, this.audio, this.hud, this.player, assets);

    this.hero = new HeroProp(ctx, assets, world.shrine.heroSlot);
    void this.hero.set({ kind: 'builtin', id: settings.get('heroModel') });

    this.menu = new SettingsMenu({
      onResume: () => { if (!isShotMode) this.input.requestLock(); this.input.enabled = true; },
      onRestart: () => this.restart(),
      onHeroModelChange: (src) => void this.hero.set(src),
      getStats: () => this.stats(),
    });

    // footstep / landing audio
    this.player.on('footstep', ({ surface, intensity, sprint }) => this.audio.playFootstep(surface, intensity, sprint));
    this.player.on('land', ({ intensity, surface }) => this.audio.playLanding(intensity, surface));
    this.player.on('jump', () => this.audio.playJump());

    installDebug({
      ready: false,
      stats: () => this.stats(),
      setCamera: (x, y, z, yaw, pitch) => {
        this.freeCam = true; this.player.enabled = false;
        this.world.camera.setPosition(x, y, z);
        this.world.camera.setEulerAngles(pitch, yaw, 0);
      },
      setState: (n) => this.director.applyState(Math.max(0, Math.min(3, n)) as GameState),
      encounter: (n: number) => this.combat.forceEncounter(n),
      preview: (x: number, z: number, yaw: number, which?: string) => this.combat.preview(x, z, yaw, which as never),
      attack: (k: string) => this.combat.debugAttack(k as never),
      simulate: (sec: number, step?: number) => this.combat.simulate(sec, this.input, step),
      hitboxes: (on: boolean) => this.combat.setHitboxes(on),
      trace: (on: boolean) => { if (on) this.combat.trace = []; const t = this.combat.trace; if (!on) this.combat.trace = null; return t ?? []; },
      previewOff: () => this.combat.previewOff(),
      enemyHealth: () => this.combat.debugEnemyHealth(),
      arena: (hold?: boolean, dist?: number) => this.combat.forceDuel(hold, dist),
      setYaw: (deg: number) => this.player.setYaw(deg * Math.PI / 180),
      freeCam: (on) => { this.freeCam = on; this.player.enabled = !on; },
      world: this.world,
    });

    ctx.app.on('update', (dt: number) => this.update(dt));
  }

  start(): void {
    this.hud.show();
    this.hud.fadeIn();
    this.hud.setObjective('Awaken the three stones', 9);
    const unlock = async (): Promise<void> => {
      if (this.audioStarted) return;
      this.audioStarted = true;
      await this.audio.unlock();
      this.director.startAudio();
      this.npcs.startAudio();
    };
    if (!isShotMode) {
      this.input.requestLock();
      this.ctx.canvas.addEventListener('click', () => { if (!this.menu.isOpen) this.input.requestLock(); void unlock(); });
      window.addEventListener('keydown', () => void unlock(), { once: true });
      void unlock();
    }
    this.input.setLockListener((locked) => {
      // losing the pointer (Esc, alt-tab) should surface the menu rather than silently freeing the mouse
      if (!locked && !this.menu.isOpen && !isShotMode && !this.director.inCinematic) this.menu.open();
    });
    const st = urlParams.get('state');
    if (st) this.director.applyState(Math.max(0, Math.min(3, Number(st))) as GameState);

    let frames = 0;
    const onFrame = (): void => { if (++frames > 4 && window.__ECHOES) { window.__ECHOES.ready = true; this.ctx.app.off('frameend', onFrame); } };
    this.ctx.app.on('frameend', onFrame);
  }

  restart(): void {
    this.director.restart();
    this.player.spawn(LEVEL.spawn.x, LEVEL.spawn.z, LEVEL.spawn.yaw);
    this.player.frozen = false;
    this.hud.fadeOut();
    setTimeout(() => this.hud.fadeIn(), 600);
    if (!isShotMode) this.input.requestLock();
  }

  private update(dt: number): void {
    // Measure against the wall clock, not dt: the engine clamps dt to maxDeltaTime, so dividing by
    // it reports the clamp (a flat 10) rather than the frame rate, which hid a 10x slowdown.
    const now = performance.now();
    this.fpsN++;
    if (now - this.fpsT0 > 500) { this.fps = (this.fpsN * 1000) / (now - this.fpsT0); this.fpsT0 = now; this.fpsN = 0; }
    this.input.enabled = !this.menu.isOpen;

    if (!this.freeCam) {
      this.player.update(dt);
      if (this.input.wasPressed('F1')) { this.debugPanel = !this.debugPanel; if (!this.debugPanel) this.hud.setDebugStats(null); }
      if (this.input.wasPressed('F2')) this.hud.showToast(this.combat.toggleHitboxes() ? 'HITBOXES ON' : 'HITBOXES OFF', 1.5);
      if (this.input.wasPressed('KeyE') && !this.menu.isOpen) {
        // stones first, then whoever is standing next to you
        if (!this.director.interact() && !this.npcs.interact()) this.audio.playInteract('denied');
      }
      const d = this.world.collision.rayDistance(this.player.eyePosition, this.player.forward, 60);
      this.world.postfx.setFocus(d);
    }
    // the world keeps living even when a debug/free camera is driving, so timed events still play
    const pos = this.freeCam ? this.world.camera.getPosition() : this.player.pos;
    const fwd = this.freeCam ? this.world.camera.forward : this.player.forward;
    this.director.update(dt, pos, this.freeCam ? pos : this.player.eyePosition, fwd);
    this.npcs.update(dt, pos, this.director.activated, this.director.promptActive);
    this.npcs.setAwakeness(this.director.activated / 3);
    this.combat.update(dt, this.input, this.freeCam);
    this.hud.setVitals(this.combat.inCombat, this.combat.health01);
    if (this.debugPanel) {
      const st = this.stats() as Record<string, unknown>;
      this.hud.setDebugStats([
        `fps ${st.fps}  dt ${st.dt}  draw ${st.drawCalls}  tris ${st.triangles}`,
        `player hp ${st.health}  act ${st.act}  lock ${st.lock}  hitbox ${st.hitOpen ? 'ACTIVE' : '-'}  iframes ${st.iframes}`,
        `enemies ${st.enemies}  nearest ${st.nearest}  combo ${st.combo}`,
        `foes ${st.foes}`,
        `F1 panel  F2 hitboxes`,
      ].join('\n'));
    }
    this.applyShake(dt);

    this.world.update(dt, this.world.camera.getPosition());
    this.hero.update(dt);
    this.menu.update(dt);
    this.audio.update(dt, this.world.camera.getPosition(), this.world.camera.forward, this.up);
    this.input.endFrame();
  }

  /**
   * Impact shake, added on top of wherever the controller put the camera.
   *
   * Deliberately small and short: the brief asked not to overdo it, and on a third-person boom a
   * big shake reads as a broken camera rather than as force. Two decaying sine axes at different
   * frequencies avoid the tell-tale single-axis wobble.
   */
  private shakeT = 0;
  private applyShake(dt: number): void {
    const a = this.combat.shakeAmount;
    if (a <= 0.002) return;
    this.shakeT += dt;
    const cam = this.world.camera;
    const k = a * a * 0.85;
    const e = cam.getEulerAngles();
    cam.setEulerAngles(
      e.x + Math.sin(this.shakeT * 62) * k,
      e.y + Math.sin(this.shakeT * 47 + 1.3) * k * 1.2,
      e.z + Math.sin(this.shakeT * 39 + 2.1) * k * 0.9,
    );
  }

  stats(): Record<string, unknown> {
    const s = this.ctx.app.stats;
    const p = this.player.pos;
    return {
      renderer: this.ctx.rendererName,
      fps: Math.round(this.fps),
      drawCalls: s.drawCalls.total,
      triangles: s.frame.triangles,
      renderScale: this.world.postfx.effectiveScale,
      stones: `${this.director.activated}/3`,
      ...this.combat.stats(),
      position: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
      heading: `${Math.round(((this.player.yaw / DEG) % 360 + 360) % 360)}°`,
    };
  }
}
export { isShotMode };
export type { HeroModelSource };
