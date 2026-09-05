import { Color, Entity, Vec3 } from 'playcanvas';
import type { EngineContext } from '@/core/engine';
import type { World } from '@/world/world';
import type { AudioEngine } from '@/audio/audio';
import type { HUD } from '@/ui/hud';
import type { SingingVoice } from '@/audio/voice';
import { Npc } from '@/world/npc';
import { LEVEL } from '@/world/level';
import { clamp01, damp, smoothstep } from '@/utils/math';

interface Placed { npc: Npc; light?: Entity; voice?: SingingVoice | null; role: string; label: string; lines: string[]; }

/** What each figure says when the player greets them, cycled so repeat visits differ. */
const LINES: Record<string, string[]> = {
  nova: [
    'The song is older than the stones. I only carry it.',
    'When all three wake, you will hear what I have been singing to.',
    'Keep walking. The shrine remembers the sound of feet.',
  ],
  walker: [
    'I have walked this path since the rain stopped. It does not end.',
    'The lanterns went cold a long time before I came.',
  ],
  kneeling: ['...'],
  'watcher-a': ['Three stones. Three. We counted them for years.'],
  'watcher-b': ['You are the first to come up in a long while.'],
  'watcher-ruin': ['This wall fell the night the light went out.'],
};

/**
 * Populates the shrine.
 *
 * Nova is the reason the place still feels tended: a singer standing at the head of the courtyard
 * whose wordless song is synthesised live (see src/audio/voice.ts) and spatialised, so it grows as
 * the player walks toward her and gains harmony as the stones wake. The other figures — pilgrims
 * on the path, one kneeling at the altar — are silent, and exist to give the level scale and life.
 */
export class NpcDirector {
  nova!: Npc;
  private all: Placed[] = [];
  private novaVoice: SingingVoice | null = null;
  private novaLight!: Entity;
  private novaGlow = 0;
  private time = 0;
  private nearest: Placed | null = null;
  private shownPrompt: string | null = null;
  private lineIndex = new Map<string, number>();

  constructor(ctx: EngineContext, private world: World, private audio: AudioEngine, private hud: HUD) {
    const g = (x: number, z: number): number => world.field.heightAt(x, z);

    // --- Nova: at the north end of the courtyard, facing back down the path (-z) toward the arriving player
    const nx = -3.4, nz = 6.5;
    this.nova = new Npc(ctx, {
      kind: 'singer', seed: 101, scale: 1.02,
      // a mid-value robe with a pale mantle: the contrast is what makes her read as a figure
      // rather than a glowing cone at 20 m through the fog
      robe: new Color(0.20, 0.24, 0.33), trim: new Color(0.55, 0.58, 0.63),
      hooded: false, skin: new Color(0.44, 0.34, 0.29), hair: new Color(0.06, 0.05, 0.06), glow: 0.06,
    }, new Vec3(nx, g(nx, nz), nz), 15);
    this.novaLight = new Entity('nova-light');
    this.novaLight.addComponent('light', {
      type: 'omni', color: new Color(0.62, 0.80, 0.95), intensity: 0, range: 7.5, castShadows: false,
    });
    this.novaLight.setPosition(nx, g(nx, nz) + 1.4, nz);
    ctx.app.root.addChild(this.novaLight);
    this.all.push({ npc: this.nova, light: this.novaLight, role: 'nova', label: 'LISTEN', lines: LINES.nova });
    world.collision.addCylinder(nx, g(nx, nz), nz, 0.42, 1.8);

    // --- a pilgrim walking the approach, back and forth between the gate and the lower path
    const wpts: [number, number][] = [[1.2, -34], [-0.8, -24], [0.4, -14], [-0.8, -24]];
    const px = wpts[0][0], pz = wpts[0][1];
    const walker = new Npc(ctx, {
      kind: 'pilgrim', seed: 202, scale: 0.97,
      robe: new Color(0.24, 0.22, 0.21), trim: new Color(0.40, 0.36, 0.31),
      skin: new Color(0.26, 0.22, 0.20),
    }, new Vec3(px, g(px, pz), pz), 0);
    walker.setPatrol(wpts.map(([x, z]) => new Vec3(x, g(x, z), z)), 0.62);
    this.all.push({ npc: walker, role: 'walker', label: 'GREET', lines: LINES.walker });

    // --- a figure kneeling at the altar in the sanctum
    //  on the sanctum platform itself (it starts at z = shrine.z - 5.25), kneeling toward the altar
    const kx = LEVEL.shrine.x + 1.1, kz = LEVEL.shrine.z - 4.1;
    const ky = world.shrine.altarTop.y - 1.42;
    const kneel = new Npc(ctx, {
      kind: 'kneeling', seed: 303, scale: 1.0,
      robe: new Color(0.20, 0.19, 0.20), trim: new Color(0.38, 0.35, 0.32),
      skin: new Color(0.24, 0.21, 0.19),
    }, new Vec3(kx, ky, kz), 25);
    this.all.push({ npc: kneel, role: 'kneeling', label: '', lines: LINES.kneeling });

    // --- two watchers at the courtyard edge, one by the ruin
    const spots: [number, number, number, string][] = [
      [10.5, -3.0, 250, 'watcher-a'],
      [-11.0, -1.5, 105, 'watcher-b'],
      [-22.0, 12.5, 140, 'watcher-ruin'],
    ];
    spots.forEach(([x, z, yaw, role], i) => {
      const npc = new Npc(ctx, {
        kind: 'pilgrim', seed: 400 + i * 37, scale: 0.93 + i * 0.03,
        robe: new Color(0.22 + i * 0.03, 0.21, 0.20), trim: new Color(0.38, 0.35, 0.31),
        skin: new Color(0.25, 0.22, 0.20),
      }, new Vec3(x, g(x, z), z), yaw);
      this.all.push({ npc, role, label: 'GREET', lines: LINES[role] ?? [] });
      world.collision.addCylinder(x, g(x, z), z, 0.40, 1.8);
    });
  }

  /** Called once audio is unlocked. */
  startAudio(): void {
    this.novaVoice = this.audio.createVoice(this.nova.position.clone().add(new Vec3(0, 1.45, 0)), 196, 0.85);
    const found = this.all.find((p) => p.role === 'nova');
    if (found) found.voice = this.novaVoice;
  }

  /** The shrine waking makes Nova's song fuller. */
  setAwakeness(v: number): void {
    this.novaVoice?.setHarmony(v * 2);
  }

  update(dt: number, playerPos: Vec3, activated: number, stonePromptActive = false): void {
    this.time += dt;
    const ground = (x: number, z: number): number => this.world.field.heightAt(x, z);
    for (const p of this.all) p.npc.update(dt, playerPos, ground);

    // --- Nova's presence: her voice and her light both swell as the player approaches
    const d = this.nova.distanceTo(playerPos);
    const proximity = 1 - smoothstep(6, 34, d);
    const target = clamp01(0.28 + proximity * 0.72);
    this.novaGlow = damp(this.novaGlow, target, 1.4, dt);
    this.novaVoice?.setIntensity(this.novaGlow);
    this.novaVoice?.update(dt);
    // she brightens with the shrine, and breathes with her own phrase
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 0.8);
    this.novaLight.light!.intensity = (0.5 + this.novaGlow * 1.5 + activated * 0.5) * pulse;

    // --- track whichever figure the player is closest to, for the interaction prompt
    let best: Placed | null = null, bd = Infinity;
    for (const p of this.all) {
      const dist = p.npc.distanceTo(playerPos);
      if (dist < bd) { bd = dist; best = p; }
    }
    this.nearest = bd < 3.2 && best && best.label ? best : null;

    // --- prompt arbitration: the stones own the HUD prompt whenever one is in reach, so we only
    //     drive it in the gaps and reset our own bookkeeping while they hold it
    if (stonePromptActive) { this.shownPrompt = null; return; }
    const label = this.nearest?.label ?? null;
    if (label !== this.shownPrompt) { this.hud.setPrompt(label); this.shownPrompt = label; }
  }

  /** Greet whoever the player is standing next to. Returns false if nobody is in reach. */
  interact(): boolean {
    const p = this.nearest;
    if (!p || p.lines.length === 0) return false;
    const i = this.lineIndex.get(p.role) ?? 0;
    this.hud.showToast(p.lines[i % p.lines.length], 5);
    this.lineIndex.set(p.role, i + 1);
    if (p.role === 'nova') {
      // she answers, then picks the phrase back up a little fuller
      this.novaGlow = Math.min(1, this.novaGlow + 0.25);
      this.novaVoice?.setIntensity(this.novaGlow);
    } else {
      this.audio.playInteract('focus', p.npc.position);
    }
    return true;
  }

  /** Non-null when the player is standing next to someone. */
  get nearbyRole(): string | null { return this.nearest?.role ?? null; }
  get novaPosition(): Vec3 { return this.nova.position; }

  dispose(): void {
    this.novaVoice?.stop();
    for (const p of this.all) p.npc.destroy();
  }
}
