/** Both sets share the existing char/player, char/ally and char/enemy asset IDs. */
export const ASTRA_BASE_COMMIT = '8469d356fa4176bfcd3f53291f5d8dbee9a9557a';

export function usesAstraCharacters(params: URLSearchParams): boolean {
  return params.get('characterSet') === 'astra' || params.get('atelier') === '1';
}

export function characterAssetUrl(id: 'player' | 'ally' | 'enemy', params: URLSearchParams): string {
  return `assets/characters/${usesAstraCharacters(params) ? 'astra/' : ''}${id}.glb`;
}
