/** Level layout constants — a single source of truth for terrain terraces, POIs and gameplay positions. */
export interface Terrace { x: number; z: number; r: number; y: number; }

export const LEVEL = {
  /** playable terrain extent (meters, centered on origin) */
  size: 300,
  cell: 1.25,
  spawn: { x: 0, z: -60, yaw: 0 },
  path: [
    [0, -66], [1.5, -56], [-2.5, -46], [-1.5, -36], [0.5, -28], [0, -21], [0, -12], [0, 0],
  ] as [number, number][],
  terraces: {
    spawn: { x: 0, z: -60, r: 11, y: 0.0 },
    approach: { x: -1, z: -40, r: 8, y: 0.9 },
    gate: { x: 0, z: -21, r: 9, y: 1.8 },
    courtyard: { x: 0, z: 0, r: 21, y: 2.4 },
    grotto: { x: 27, z: 9, r: 8.5, y: 3.1 },     // stone 1
    ruin: { x: -27, z: 12, r: 9.5, y: 3.6 },     // stone 2
    innerGate: { x: 0, z: 22, r: 6, y: 3.6 },
    sanctum: { x: 0, z: 38, r: 16, y: 5.2 },    // stone 3 + central shrine
  } satisfies Record<string, Terrace>,
  pools: [
    { x: 8.5, z: -7, r: 4.2 }, { x: -7.5, z: 5.5, r: 3.4 }, { x: 26.5, z: 12.5, r: 2.6 }, { x: -3, z: 33, r: 2.2 }, { x: 5, z: -30, r: 2.4 },
  ],
  stones: [
    { id: 1, x: 27.5, z: 11.5, name: 'Stone of the Grotto' },
    { id: 2, x: -28, z: 14.5, name: 'Stone of the Ruin' },
    { id: 3, x: 0, z: 40.5, name: 'Heart of the Shrine' },
  ],
  shrine: { x: 0, z: 47 },
  mountainRadius: 104,
};

export type TerraceKey = keyof typeof LEVEL.terraces;
