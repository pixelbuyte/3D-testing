import { AppBase, Asset, AssetListLoader, ContainerResource, Texture } from 'playcanvas';
import { settings } from '@/core/settings';
import { characterAssetUrl } from '@/characters/catalog';

/** PBR texture sets packed by tools/pack-assets.mjs: assets/textures/<id>/{diff,nor_gl,arm}.webp */
export const TEXTURE_SETS = [
  'forest_ground_04', 'mossy_rock', 'rock_face_03', 'cobblestone_floor_08', 'mossy_cobblestone',
  'stone_tiles_02', 'rustic_stone_wall_02', 'sandstone_blocks_05', 'weathered_planks', 'bark_willow_02',
  'roof_slates_03', 'lichen_rock', 'brown_mud_leaves_01',
] as const;
export type TextureSetId = (typeof TEXTURE_SETS)[number];

/** Loose textures: assets/textures/<folder>/<file>.webp  (leaf/twig cards, bark) */
export const LOOSE_TEXTURES: Record<string, { folder: string; file: string; srgb: boolean }> = {
  leavesA_diff: { folder: 'island_tree_01', file: 'leaves_diff', srgb: true },
  leavesA_nor: { folder: 'island_tree_01', file: 'leaves_nor_gl', srgb: false },
  leavesB_diff: { folder: 'tree_small_02', file: 'leaves_diff', srgb: true },
  leavesB_nor: { folder: 'tree_small_02', file: 'leaves_nor_gl', srgb: false },
  twig_diff: { folder: 'fir_tree_01', file: 'twig_diff', srgb: true },
  twig_nor: { folder: 'fir_tree_01', file: 'twig_nor_gl', srgb: false },
  barkB_diff: { folder: 'island_tree_01', file: 'diff', srgb: true },
  barkB_nor: { folder: 'island_tree_01', file: 'nor_gl', srgb: false },
  barkB_arm: { folder: 'island_tree_01', file: 'arm', srgb: false },
};

export const MODELS = [
  'rock_moss_set_01', 'rock_moss_set_02', 'fern_02', 'grass_medium_02', 'Lantern_01', 'wooden_lantern_01',
  'brass_diya_lantern', 'gothic_statue', 'dead_tree_trunk', 'tree_stump_01', 'boulder_01', 'rock_09',
  'nettle_plant', 'celandine_01', 'shrub_01',
] as const;
export type ModelId = (typeof MODELS)[number];

/** skinned characters built by tools/build-character.py: assets/characters/<id>.glb */
export const CHARACTERS = ['player', 'enemy', 'ally'] as const;

export const SKY_HDR = 'kloppenheim_06_2k.hdr';

export interface TexSet { diff: Texture; nor: Texture; arm: Texture; }

export class AssetBank {
  private textures = new Map<string, Asset>();
  private models = new Map<string, Asset>();
  hdr!: Asset;

  constructor(private app: AppBase) {}

  register(): Asset[] {
    const list: Asset[] = [];
    const aniso = settings.get('anisotropy');
    const mk = (name: string, url: string, srgb: boolean) => {
      const a = new Asset(name, 'texture', { url }, { srgb, mipmaps: true, anisotropy: aniso });
      this.textures.set(name, a);
      list.push(a);
    };
    for (const id of TEXTURE_SETS) {
      mk(`${id}/diff`, `assets/textures/${id}/diff.webp`, true);
      mk(`${id}/nor`, `assets/textures/${id}/nor_gl.webp`, false);
      mk(`${id}/arm`, `assets/textures/${id}/arm.webp`, false);
    }
    for (const [name, t] of Object.entries(LOOSE_TEXTURES)) mk(name, `assets/textures/${t.folder}/${t.file}.webp`, t.srgb);
    for (const id of MODELS) {
      const a = new Asset(id, 'container', { url: `assets/models/${id}.glb` });
      this.models.set(id, a);
      list.push(a);
    }
    for (const id of CHARACTERS) {
      const a = new Asset(`char/${id}`, 'container', { url: characterAssetUrl(id, new URLSearchParams(location.search)) });
      this.models.set(`char/${id}`, a);
      list.push(a);
    }
    this.hdr = new Asset('sky-hdr', 'texture', { url: `assets/hdri/${SKY_HDR}` }, { mipmaps: false });
    list.push(this.hdr);
    return list;
  }

  tex(name: string): Texture {
    const a = this.textures.get(name);
    if (!a?.resource) throw new Error(`texture not loaded: ${name}`);
    return a.resource as Texture;
  }
  set(id: TextureSetId): TexSet {
    return { diff: this.tex(`${id}/diff`), nor: this.tex(`${id}/nor`), arm: this.tex(`${id}/arm`) };
  }
  model(id: ModelId | string): ContainerResource {
    const a = this.models.get(id);
    if (!a?.resource) throw new Error(`model not loaded: ${id}`);
    return a.resource as ContainerResource;
  }
  hasModel(id: string): boolean { return !!this.models.get(id)?.resource; }
  modelAsset(id: string): Asset | undefined { return this.models.get(id); }

  /** Loads every registered asset, reporting 0..1 progress. Individual failures are logged, not fatal. */
  load(onProgress: (p: number) => void): Promise<void> {
    const list = this.register();
    for (const a of list) this.app.assets.add(a);
    let done = 0;
    const total = list.length;
    const bump = () => { done++; onProgress(done / total); };
    for (const a of list) {
      a.once('load', bump);
      a.once('error', (err: unknown) => { console.error('[assets] failed', a.name, err); bump(); });
    }
    return new Promise((resolve) => {
      const loader = new AssetListLoader(list, this.app.assets);
      loader.load(() => resolve());
    });
  }
}
