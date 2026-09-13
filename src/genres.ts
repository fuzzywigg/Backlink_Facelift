/** iptv-org category ids we expose + mood aliases → category. */
export const GENRE_MAP: Record<string, string> = {
  'late night': 'ambient',
  chill: 'ambient',
  ambient: 'ambient',
  relaxing: 'ambient',
  focus: 'ambient',
  classical: 'classical',
  classic: 'classical',
  jazz: 'jazz',
  blues: 'jazz',
  pop: 'pop',
  rock: 'rock',
  metal: 'rock',
  indie: 'rock',
  music: 'music',
  news: 'news',
  sports: 'sports',
  entertainment: 'entertainment',
  dance: 'pop',
  electronic: 'ambient',
  lofi: 'ambient',
  'lo-fi': 'ambient',
};

export const VALID_GENRES = [
  'music',
  'ambient',
  'jazz',
  'classical',
  'pop',
  'rock',
  'news',
  'sports',
  'entertainment',
] as const;

export type ValidGenre = (typeof VALID_GENRES)[number];

export function resolveGenre(
  input?: string,
  map: Record<string, string> = GENRE_MAP,
): string {
  if (!input) return 'music';
  const lower = input.toLowerCase().trim();
  return map[lower] ?? (VALID_GENRES.includes(lower as ValidGenre) ? lower : 'music');
}
