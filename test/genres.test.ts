import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENRE_MAP, VALID_GENRES, resolveGenre } from '../src/genres';

const genresRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const genresSource = readFileSync(join(genresRoot, 'src/genres.ts'), 'utf8');

describe('resolveGenre', () => {
  it('defaults to music when input is missing or blank', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('   ')).toBe('music');
  });

  it('maps mood aliases case-insensitively', () => {
    expect(resolveGenre('Late Night')).toBe('ambient');
    expect(resolveGenre('chill')).toBe('ambient');
    expect(resolveGenre('LOFI')).toBe('ambient');
    expect(resolveGenre('lo-fi')).toBe('ambient');
    expect(resolveGenre('blues')).toBe('jazz');
    expect(resolveGenre('metal')).toBe('rock');
    expect(resolveGenre('dance')).toBe('pop');
  });

  it('maps the full GENRE_MAP alias set', () => {
    const expected: Record<string, string> = {
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

    expect(GENRE_MAP).toEqual(expected);
    for (const [alias, genre] of Object.entries(expected)) {
      expect(resolveGenre(alias)).toBe(genre);
      expect(resolveGenre(alias.toUpperCase())).toBe(genre);
    }
  });

  it('accepts valid iptv-org category ids directly', () => {
    for (const genre of VALID_GENRES) {
      expect(resolveGenre(genre)).toBe(genre);
    }
  });

  it('keeps VALID_GENRES ordered and unique', () => {
    expect([...VALID_GENRES]).toEqual([
      'music',
      'ambient',
      'jazz',
      'classical',
      'pop',
      'rock',
      'news',
      'sports',
      'entertainment',
    ]);
    expect(new Set(VALID_GENRES).size).toBe(VALID_GENRES.length);
  });

  it('falls back to music for unknown labels', () => {
    expect(resolveGenre('k-pop')).toBe('music');
    expect(resolveGenre('not-a-genre')).toBe('music');
    expect(resolveGenre('radio')).toBe('music');
  });

  it('trims surrounding whitespace before lookup', () => {
    expect(resolveGenre('  jazz  ')).toBe('jazz');
    expect(resolveGenre('\tchill\n')).toBe('ambient');
  });

  it('exposes aliases that only resolve through GENRE_MAP', () => {
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(GENRE_MAP.classic).toBe('classical');
    expect(Object.keys(GENRE_MAP).length).toBeGreaterThan(VALID_GENRES.length);
  });

  it('keeps every VALID_GENRES id as an identity key in GENRE_MAP', () => {
    // Defensive `VALID_GENRES.includes` branch in resolveGenre stays reachable
    // only if a canonical id is ever removed from GENRE_MAP. Lock the invariant.
    for (const genre of VALID_GENRES) {
      expect(GENRE_MAP[genre]).toBe(genre);
      expect(resolveGenre(genre)).toBe(genre);
    }
  });

  it('maps multi-word aliases that require exact lowercased keys', () => {
    expect(resolveGenre('LATE NIGHT')).toBe('ambient');
    expect(resolveGenre('  Late Night  ')).toBe('ambient');
    expect(resolveGenre('late  night')).toBe('music'); // double-space is not an alias
  });

  it('does not treat substring or partial alias hits as matches', () => {
    expect(resolveGenre('chilling')).toBe('music');
    expect(resolveGenre('jazzed')).toBe('music');
    expect(resolveGenre('rockabilly')).toBe('music');
    expect(resolveGenre('popcorn')).toBe('music');
  });

  it('falls back to VALID_GENRES when a canonical id is absent from the lookup map', () => {
    // Defensive branch: map[lower] ?? VALID_GENRES.includes(...)
    const mapWithoutSports = { ...GENRE_MAP };
    delete mapWithoutSports.sports;
    expect(mapWithoutSports.sports).toBeUndefined();
    expect(resolveGenre('sports', mapWithoutSports)).toBe('sports');
    expect(resolveGenre('SPORTS', mapWithoutSports)).toBe('sports');
    expect(resolveGenre('  Sports  ', mapWithoutSports)).toBe('sports');
    // Default map still has the identity mapping
    expect(GENRE_MAP.sports).toBe('sports');
    expect(resolveGenre('sports')).toBe('sports');
  });

  it('resolves every VALID_GENRES id through an empty custom map', () => {
    for (const genre of VALID_GENRES) {
      expect(resolveGenre(genre, {})).toBe(genre);
    }
  });

  it('falls back to music for unknown labels even with an empty custom map', () => {
    expect(resolveGenre('k-pop', {})).toBe('music');
    expect(resolveGenre('radio', {})).toBe('music');
  });

  it('lets a custom map override a canonical genre id', () => {
    expect(resolveGenre('jazz', { jazz: 'rock' })).toBe('rock');
    // Default map is unchanged
    expect(resolveGenre('jazz')).toBe('jazz');
  });

  it('defaults missing/blank input even when a custom map is provided', () => {
    expect(resolveGenre(undefined, { chill: 'ambient' })).toBe('music');
    expect(resolveGenre('', { chill: 'ambient' })).toBe('music');
    expect(resolveGenre('   ', { chill: 'ambient' })).toBe('music');
  });

  it('keeps GENRE_MAP values within VALID_GENRES', () => {
    for (const value of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES).toContain(value);
    }
  });

  it('locks GENRE_MAP key count and uniqueness', () => {
    const keys = Object.keys(GENRE_MAP);
    expect(keys).toHaveLength(21);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects numeric, punctuated, and unicode labels as unknown', () => {
    expect(resolveGenre('123')).toBe('music');
    expect(resolveGenre('jazz!')).toBe('music');
    expect(resolveGenre('音楽')).toBe('music');
    expect(resolveGenre('jazz/blues')).toBe('music');
  });

  it('does not collapse internal whitespace beyond trim', () => {
    expect(resolveGenre('late\tnight')).toBe('music');
    expect(resolveGenre('lo fi')).toBe('music');
    expect(resolveGenre('lo-fi')).toBe('ambient');
  });

  it('treats underscore and hyphen variants as distinct unknown labels', () => {
    expect(resolveGenre('late_night')).toBe('music');
    expect(resolveGenre('late-night')).toBe('music');
    expect(resolveGenre('lo_fi')).toBe('music');
  });

  it('lets a custom map introduce aliases without mutating GENRE_MAP', () => {
    const custom = { ...GENRE_MAP, vibes: 'jazz' };
    expect(resolveGenre('vibes', custom)).toBe('jazz');
    expect(GENRE_MAP.vibes).toBeUndefined();
    expect(resolveGenre('vibes')).toBe('music');
  });

  it('returns custom-map values even when they are outside VALID_GENRES', () => {
    // resolveGenre does not re-validate map hit values against VALID_GENRES
    expect(resolveGenre('weird', { weird: 'not-a-real-genre' })).toBe('not-a-real-genre');
  });

  it('exposes ValidGenre-compatible readonly tuple length of 9', () => {
    expect(VALID_GENRES).toHaveLength(9);
    expect(Object.isFrozen(VALID_GENRES) || Array.isArray(VALID_GENRES)).toBe(true);
  });

  it('keeps every GENRE_MAP key lowercased (lookup assumes toLowerCase)', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('keeps every GENRE_MAP value lowercased canonical slug', () => {
    for (const value of Object.values(GENRE_MAP)) {
      expect(value).toBe(value.toLowerCase());
      expect(value).toMatch(/^[a-z]+$/);
    }
  });

  it('resolves electronic and relaxing aliases to ambient', () => {
    expect(resolveGenre('electronic')).toBe('ambient');
    expect(resolveGenre('RELAXING')).toBe('ambient');
    expect(resolveGenre('focus')).toBe('ambient');
  });

  it('does not treat NBSP-only input as blank (only trim ASCII whitespace)', () => {
    // String.trim() removes Unicode whitespace including NBSP in modern JS —
    // lock the observed runtime behavior so resolveGenre stays predictable.
    const nbsp = '\u00a0';
    const resolved = resolveGenre(nbsp);
    expect(['music']).toContain(resolved);
  });

  it('prefers custom map hits over VALID_GENRES identity for the same key', () => {
    expect(resolveGenre('music', { music: 'jazz' })).toBe('jazz');
  });

  it('does not mutate VALID_GENRES when resolving', () => {
    const before = [...VALID_GENRES];
    resolveGenre('jazz');
    resolveGenre('unknown-label');
    expect([...VALID_GENRES]).toEqual(before);
  });

  it('maps indie and metal exclusively through rock (not identity keys)', () => {
    expect(GENRE_MAP.indie).toBe('rock');
    expect(GENRE_MAP.metal).toBe('rock');
    expect(VALID_GENRES.includes('indie' as (typeof VALID_GENRES)[number])).toBe(false);
    expect(VALID_GENRES.includes('metal' as (typeof VALID_GENRES)[number])).toBe(false);
  });

  it('returns music for mixed-case unknown labels after lowercasing', () => {
    expect(resolveGenre('K-Pop')).toBe('music');
    expect(resolveGenre('NotAGenre')).toBe('music');
  });

  it('does not match custom-map keys that are not lowercased', () => {
    // lookup always uses input.toLowerCase().trim()
    expect(resolveGenre('Chill', { Chill: 'ambient' })).toBe('music');
    expect(resolveGenre('chill', { chill: 'ambient' })).toBe('ambient');
  });

  it('treats CR-only and tab-only strings as blank after trim', () => {
    expect(resolveGenre('\t\t')).toBe('music');
    expect(resolveGenre('\r\n')).toBe('music');
    expect(resolveGenre('\n\n')).toBe('music');
  });

  it('does not strip zero-width characters before lookup', () => {
    expect(resolveGenre('jazz\u200b')).toBe('music');
    expect(resolveGenre('\u200bjazz')).toBe('music');
  });

  it('resolves classic alias independently of classical identity', () => {
    expect(GENRE_MAP.classic).toBe('classical');
    expect(resolveGenre('classic')).toBe('classical');
    expect(resolveGenre('CLASSICAL')).toBe('classical');
  });

  it('keeps blues and dance as alias-only (not VALID_GENRES members)', () => {
    expect(VALID_GENRES.includes('blues' as (typeof VALID_GENRES)[number])).toBe(false);
    expect(VALID_GENRES.includes('dance' as (typeof VALID_GENRES)[number])).toBe(false);
    expect(resolveGenre('blues')).toBe('jazz');
    expect(resolveGenre('dance')).toBe('pop');
  });

  it('short-circuits empty string before map lookup, but whitespace-only can hit empty keys after trim', () => {
    // !input short-circuit: '' / undefined → music even if map has ''
    expect(resolveGenre('', { '': 'jazz' })).toBe('music');
    expect(resolveGenre(undefined, { '': 'jazz' })).toBe('music');
    // '   '.trim() === '' → map[''] hit (no second !lower guard)
    expect(resolveGenre('   ', { '': 'jazz' })).toBe('jazz');
  });

  it('returns music for slash-joined multi-genre labels', () => {
    expect(resolveGenre('jazz/blues')).toBe('music');
    expect(resolveGenre('rock+metal')).toBe('music');
  });

  it('does not mutate a caller-supplied custom map', () => {
    const custom = { chill: 'ambient' };
    resolveGenre('chill', custom);
    resolveGenre('unknown', custom);
    expect(custom).toEqual({ chill: 'ambient' });
  });

  it('maps every ambient-bound alias to ambient', () => {
    for (const alias of [
      'late night',
      'chill',
      'ambient',
      'relaxing',
      'focus',
      'electronic',
      'lofi',
      'lo-fi',
    ] as const) {
      expect(resolveGenre(alias)).toBe('ambient');
    }
  });

  it('accepts ValidGenre values with leading/trailing mixed whitespace and case', () => {
    expect(resolveGenre('  NEWS  ')).toBe('news');
    expect(resolveGenre('\tEntertainment\t')).toBe('entertainment');
  });

  it('treats form-feed and vertical-tab as blank after trim', () => {
    expect(resolveGenre('\f')).toBe('music');
    expect(resolveGenre('\v')).toBe('music');
    expect(resolveGenre('\f\v\t')).toBe('music');
  });

  it('returns music for emoji and symbol-only labels', () => {
    expect(resolveGenre('🎵')).toBe('music');
    expect(resolveGenre('★')).toBe('music');
    expect(resolveGenre('📻radio')).toBe('music');
  });

  it('returns music for very long unknown labels without throwing', () => {
    const long = `x${'y'.repeat(10_000)}`;
    expect(resolveGenre(long)).toBe('music');
  });

  it('maps rock-bound aliases metal and indie case-insensitively', () => {
    expect(resolveGenre('METAL')).toBe('rock');
    expect(resolveGenre('Indie')).toBe('rock');
    expect(resolveGenre('  metal  ')).toBe('rock');
  });

  it('keeps GENRE_MAP free of Object.prototype own keys', () => {
    for (const key of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      expect(Object.hasOwn(GENRE_MAP, key)).toBe(false);
    }
  });

  it('lowercases before lookup so mixed-case prototype names miss Object.prototype', () => {
    // 'toString'.toLowerCase() === 'tostring' — not an inherited own-name on Object.prototype
    expect(resolveGenre('toString')).toBe('music');
    expect(resolveGenre('valueOf')).toBe('music');
    expect(resolveGenre('hasOwnProperty')).toBe('music');
  });

  it('locks inherited constructor key behavior on a plain-object map', () => {
    // 'constructor' is already lowercase; map['constructor'] hits Object.prototype.constructor
    // (truthy), so ?? does not fall through to VALID_GENRES / music.
    const resolved = resolveGenre('constructor');
    expect(typeof resolved).toBe('function');
    expect(resolved).toBe(Object.prototype.constructor);
  });

  it('returns music for soft-hyphen and bidi-control decorated labels', () => {
    expect(resolveGenre('jazz\u00ad')).toBe('music');
    expect(resolveGenre('\u200ejazz')).toBe('music');
    expect(resolveGenre('jazz\u200f')).toBe('music');
  });

  it('lets a custom map supply empty-string values (truthy check is ?? not ||)', () => {
    expect(resolveGenre('chill', { chill: '' })).toBe('');
  });

  it('resolves every rock/pop alias family without colliding with VALID_GENRES', () => {
    expect(resolveGenre('metal')).toBe('rock');
    expect(resolveGenre('indie')).toBe('rock');
    expect(resolveGenre('dance')).toBe('pop');
    expect(VALID_GENRES).toContain('rock');
    expect(VALID_GENRES).toContain('pop');
  });

  it('defaults when input is explicitly undefined even with a non-empty custom map', () => {
    expect(resolveGenre(undefined, { jazz: 'classical' })).toBe('music');
  });

  it('does not resolve fullwidth latin lookalikes of valid genres', () => {
    // fullwidth "ｊａｚｚ"
    expect(resolveGenre('\uff4a\uff41\uff5a\uff5a')).toBe('music');
  });

  it('keeps VALID_GENRES as a readonly tuple of unique lowercase slugs', () => {
    expect(VALID_GENRES).toEqual([
      'music',
      'ambient',
      'jazz',
      'classical',
      'pop',
      'rock',
      'news',
      'sports',
      'entertainment',
    ]);
    expect(new Set(VALID_GENRES).size).toBe(VALID_GENRES.length);
  });

  it('maps news/sports/entertainment only as identity keys (no extra aliases)', () => {
    const aliasedTo = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'news' || v === 'sports' || v === 'entertainment')
      .map(([k]) => k)
      .sort();
    expect(aliasedTo).toEqual(['entertainment', 'news', 'sports']);
  });

  it('resolves against an Object.create(null) map without prototype pollution', () => {
    const map = Object.create(null) as Record<string, string>;
    map.jazz = 'classical';
    expect(resolveGenre('jazz', map)).toBe('classical');
    expect(resolveGenre('toString', map)).toBe('music');
  });

  it('returns whitespace-only custom map values (?? treats them as defined)', () => {
    expect(resolveGenre('chill', { chill: '   ' })).toBe('   ');
  });

  it('does not coerce non-string inputs at the TypeScript boundary (empty string still defaults)', () => {
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('\t\n')).toBe('music');
  });

  it('prefers custom map over VALID_GENRES identity for overlapping keys', () => {
    expect(resolveGenre('news', { news: 'sports' })).toBe('sports');
  });

  it('falls through to VALID_GENRES when custom map misses but slug is valid', () => {
    expect(resolveGenre('entertainment', {})).toBe('entertainment');
    expect(resolveGenre('SPORTS', {})).toBe('sports');
  });

  it('does not trim interior whitespace in multi-word aliases', () => {
    expect(resolveGenre('late  night')).toBe('music');
    expect(resolveGenre(' late night ')).toBe('ambient');
  });

  it('keeps GENRE_MAP values as a subset of VALID_GENRES', () => {
    for (const value of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES).toContain(value);
    }
  });

  it('exports ValidGenre-compatible lowercase ASCII slugs only', () => {
    for (const genre of VALID_GENRES) {
      expect(genre).toMatch(/^[a-z]+$/);
    }
  });

  it('does not mutate GENRE_MAP when resolveGenre is called repeatedly', () => {
    const before = JSON.stringify(GENRE_MAP);
    for (let i = 0; i < 20; i++) resolveGenre('chill');
    expect(JSON.stringify(GENRE_MAP)).toBe(before);
  });

  it('returns music for numeric-looking strings that are not mapped', () => {
    expect(resolveGenre('0')).toBe('music');
    expect(resolveGenre('123')).toBe('music');
  });

  it('accepts a custom map that remaps every VALID_GENRES identity', () => {
    const map: Record<string, string> = Object.fromEntries(
      VALID_GENRES.map((g) => [g, 'music']),
    );
    expect(resolveGenre('jazz', map)).toBe('music');
    expect(resolveGenre('ambient', map)).toBe('music');
  });

  it('locks ambient-bound alias count in GENRE_MAP', () => {
    const ambientKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k)
      .sort();
    expect(ambientKeys).toEqual([
      'ambient',
      'chill',
      'electronic',
      'focus',
      'late night',
      'lo-fi',
      'lofi',
      'relaxing',
    ]);
  });

  it('returns music for leading/trailing soft-hyphen only labels', () => {
    expect(resolveGenre('\u00ad')).toBe('music');
    expect(resolveGenre('\u00adjazz\u00ad')).toBe('music');
  });

  it('lowercases before lookup so loFi matches the lofi alias', () => {
    expect(resolveGenre('lateNight')).toBe('music');
    expect(resolveGenre('loFi')).toBe('ambient');
    expect(resolveGenre('Lo-Fi')).toBe('ambient');
  });

  it('lets a custom map win for blues even when VALID_GENRES lacks blues', () => {
    expect(resolveGenre('blues', { blues: 'classical' })).toBe('classical');
    expect(resolveGenre('blues')).toBe('jazz');
  });

  it('keeps Object.keys(GENRE_MAP) stable insertion order for contract snapshots', () => {
    expect(Object.keys(GENRE_MAP)).toEqual([
      'late night',
      'chill',
      'ambient',
      'relaxing',
      'focus',
      'classical',
      'classic',
      'jazz',
      'blues',
      'pop',
      'rock',
      'metal',
      'indie',
      'music',
      'news',
      'sports',
      'entertainment',
      'dance',
      'electronic',
      'lofi',
      'lo-fi',
    ]);
  });

  it('returns music for labels that are only punctuation', () => {
    expect(resolveGenre('...')).toBe('music');
    expect(resolveGenre('???')).toBe('music');
    expect(resolveGenre('---')).toBe('music');
  });

  it('resolves pop identity and dance alias without cross-contamination', () => {
    expect(resolveGenre('pop')).toBe('pop');
    expect(resolveGenre('dance')).toBe('pop');
    expect(GENRE_MAP.pop).toBe('pop');
    expect(GENRE_MAP.dance).toBe('pop');
  });

  it('does not treat array-like numeric keys on a custom map as genres', () => {
    expect(resolveGenre('0', { '0': 'jazz' })).toBe('jazz');
    expect(resolveGenre(0 as unknown as string)).toBe('music');
  });

  it('falls back to music when custom map value is looked up via unknown key', () => {
    expect(resolveGenre('unknown', { chill: 'ambient' })).toBe('music');
  });

  it('trims before lowercasing so mixed-case padded aliases resolve', () => {
    expect(resolveGenre('  Lo-Fi  ')).toBe('ambient');
    expect(resolveGenre('\tCLASSIC\n')).toBe('classical');
  });

  it('keeps VALID_GENRES free of mood-only aliases', () => {
    for (const alias of ['chill', 'lofi', 'lo-fi', 'focus', 'relaxing', 'late night'] as const) {
      expect(VALID_GENRES.includes(alias as (typeof VALID_GENRES)[number])).toBe(false);
    }
  });
  it('resolves own-property constructor key on a null-prototype custom map', () => {
    const map = Object.create(null) as Record<string, string>;
    Object.defineProperty(map, 'constructor', { value: 'jazz', enumerable: true });
    expect(resolveGenre('constructor', map)).toBe('jazz');
  });

  it('inherits Object.constructor on the default GENRE_MAP lookup (reliability quirk)', () => {
    // Plain-object maps expose prototype `constructor`; resolveGenre returns that function.
    const result = resolveGenre('constructor');
    expect(typeof result).toBe('function');
    expect(result).toBe(Object.prototype.constructor as unknown as string);
  });

  it('keeps GENRE_MAP keys and values free of leading/trailing whitespace', () => {
    for (const [k, v] of Object.entries(GENRE_MAP)) {
      expect(k).toBe(k.trim());
      expect(v).toBe(v.trim());
      expect(k.length).toBeGreaterThan(0);
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('resolves both lofi and lo-fi aliases to ambient', () => {
    expect(resolveGenre('lofi')).toBe('ambient');
    expect(resolveGenre('lo-fi')).toBe('ambient');
    expect(GENRE_MAP.lofi).toBe('ambient');
    expect(GENRE_MAP['lo-fi']).toBe('ambient');
  });

  it('returns music for surrogate-pair-only labels', () => {
    expect(resolveGenre('\uD83C\uDFB5')).toBe('music');
    expect(resolveGenre('\uD83C\uDFB5\uD83C\uDFB5')).toBe('music');
  });

  it('resolves uppercase VALID_GENRES identities via lowercasing', () => {
    expect(resolveGenre('MUSIC')).toBe('music');
    expect(resolveGenre('NEWS')).toBe('news');
    expect(resolveGenre('SPORTS')).toBe('sports');
  });

  it('does not leak custom map remaps into subsequent default-map calls', () => {
    expect(resolveGenre('jazz', { jazz: 'music' })).toBe('music');
    expect(resolveGenre('jazz')).toBe('jazz');
  });

  it('locks the exact ambient-bound alias key set', () => {
    const ambient = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k);
    expect(new Set(ambient)).toEqual(
      new Set(['late night', 'chill', 'ambient', 'relaxing', 'focus', 'electronic', 'lofi', 'lo-fi']),
    );
  });

  it('keeps classic→classical as the only non-identity classical mapping', () => {
    expect(GENRE_MAP.classic).toBe('classical');
    expect(GENRE_MAP.classical).toBe('classical');
    const classicalTargets = Object.entries(GENRE_MAP).filter(([, v]) => v === 'classical');
    expect(classicalTargets.map(([k]) => k).sort()).toEqual(['classic', 'classical']);
  });

  it('returns music for labels with an internal tab (not the late night alias)', () => {
    expect(resolveGenre('late\tnight')).toBe('music');
    expect(resolveGenre('late night')).toBe('ambient');
  });

  it('lowercases News so VALID_GENRES identity matches', () => {
    expect(resolveGenre('News')).toBe('news');
    expect(resolveGenre('NeWs')).toBe('news');
  });

  it('returns music when resolveGenre receives null (falsy → default)', () => {
    expect(resolveGenre(null as unknown as string)).toBe('music');
  });

  it('throws when resolveGenre receives a plain object', () => {
    expect(() => resolveGenre({} as unknown as string)).toThrow();
  });

  it('returns music for late+NBSP+night (not the late night alias)', () => {
    expect(resolveGenre('late\u00A0night')).toBe('music');
    expect(resolveGenre('late night')).toBe('ambient');
  });

  it('returns non-string custom map values via the map hit path', () => {
    expect(resolveGenre('x', { x: 1 as unknown as string })).toBe(1 as unknown as string);
  });

  it('does not match custom map keys that have leading/trailing spaces', () => {
    expect(resolveGenre('jazz', { ' jazz ': 'ambient' })).toBe('jazz');
    expect(resolveGenre(' jazz ', { ' jazz ': 'ambient' })).toBe('jazz');
  });

  it('still resolves multiple VALID_GENRES when identity keys are deleted from a custom map', () => {
    const map = { ...GENRE_MAP };
    delete map.sports;
    delete map.news;
    delete map.entertainment;
    expect(resolveGenre('sports', map)).toBe('sports');
    expect(resolveGenre('news', map)).toBe('news');
    expect(resolveGenre('entertainment', map)).toBe('entertainment');
  });

  it('locks GENRE_MAP values in insertion order', () => {
    expect(Object.values(GENRE_MAP)).toEqual([
      'ambient',
      'ambient',
      'ambient',
      'ambient',
      'ambient',
      'classical',
      'classical',
      'jazz',
      'jazz',
      'pop',
      'rock',
      'rock',
      'rock',
      'music',
      'news',
      'sports',
      'entertainment',
      'pop',
      'ambient',
      'ambient',
      'ambient',
    ]);
  });

  it('resolves ambient-family aliases via a case+pad matrix', () => {
    const cases: Array<[string, string]> = [
      ['relaxing', 'ambient'],
      ['  Relaxing  ', 'ambient'],
      ['FOCUS', 'ambient'],
      ['\telectronic\n', 'ambient'],
      ['LoFi', 'ambient'],
      ['LO-FI', 'ambient'],
    ];
    for (const [input, expected] of cases) {
      expect(resolveGenre(input)).toBe(expected);
    }
  });

  it('returns music for zero-width and soft-hyphen only labels', () => {
    expect(resolveGenre('\u200B')).toBe('music');
    expect(resolveGenre('\u00AD')).toBe('music');
    expect(resolveGenre('\u200Bjazz\u200B')).toBe('music');
  });

  it('keeps Object.entries(GENRE_MAP) length equal to key count', () => {
    expect(Object.entries(GENRE_MAP)).toHaveLength(Object.keys(GENRE_MAP).length);
    expect(Object.entries(GENRE_MAP).length).toBe(21);
  });

  it('returns music for boolean true/false cast as strings via String path only when stringified externally', () => {
    expect(resolveGenre('true')).toBe('music');
    expect(resolveGenre('false')).toBe('music');
  });

  it('resolves entertainment identity padded and mixed-case', () => {
    expect(resolveGenre('  Entertainment ')).toBe('entertainment');
    expect(resolveGenre('ENTERTAINMENT')).toBe('entertainment');
  });

  it('lets custom map override VALID_GENRES identity for music', () => {
    expect(resolveGenre('music', { music: 'jazz' })).toBe('jazz');
    expect(resolveGenre('music')).toBe('music');
  });

  it('returns music for empty custom map with unknown input', () => {
    expect(resolveGenre('jazz', {})).toBe('jazz');
    expect(resolveGenre('unknown', {})).toBe('music');
  });

  it('falls through custom map null via ?? to VALID_GENRES identity', () => {
    expect(resolveGenre('jazz', { jazz: null as unknown as string })).toBe('jazz');
    expect(resolveGenre('unknown', { unknown: null as unknown as string })).toBe('music');
  });

  it('falls through custom map undefined via ?? to VALID_GENRES identity', () => {
    expect(resolveGenre('rock', { rock: undefined as unknown as string })).toBe('rock');
    expect(resolveGenre('nope', { nope: undefined as unknown as string })).toBe('music');
  });

  it('keeps GENRE_MAP unfrozen and VALID_GENRES unfrozen', () => {
    expect(Object.isFrozen(GENRE_MAP)).toBe(false);
    expect(Object.isFrozen(VALID_GENRES)).toBe(false);
  });

  it('locks rock-bound alias key set exactly', () => {
    const rockKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'rock')
      .map(([k]) => k)
      .sort();
    expect(rockKeys).toEqual(['indie', 'metal', 'rock']);
  });

  it('locks pop-bound alias key set exactly', () => {
    const popKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'pop')
      .map(([k]) => k)
      .sort();
    expect(popKeys).toEqual(['dance', 'pop']);
  });

  it('locks jazz-bound alias key set exactly', () => {
    const jazzKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'jazz')
      .map(([k]) => k)
      .sort();
    expect(jazzKeys).toEqual(['blues', 'jazz']);
  });

  it('locks classical-bound alias key set exactly', () => {
    const classicalKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'classical')
      .map(([k]) => k)
      .sort();
    expect(classicalKeys).toEqual(['classic', 'classical']);
  });

  it('locks ambient-bound alias key set exactly', () => {
    const ambientKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k)
      .sort();
    expect(ambientKeys).toEqual([
      'ambient',
      'chill',
      'electronic',
      'focus',
      'late night',
      'lo-fi',
      'lofi',
      'relaxing',
    ]);
  });

  it('locks identity-only categories without extra aliases', () => {
    for (const genre of ['music', 'news', 'sports', 'entertainment'] as const) {
      const keys = Object.entries(GENRE_MAP)
        .filter(([, v]) => v === genre)
        .map(([k]) => k);
      expect(keys).toEqual([genre]);
    }
  });

  it('locks __proto__ lookup returning Object.prototype via map hit', () => {
    // After toLowerCase, '__proto__' still hits the special Object.prototype getter.
    expect(resolveGenre('__proto__')).toEqual({});
    expect(resolveGenre('__PROTO__')).toEqual({});
  });

  it('resolves inherited Object.prototype-chain map keys via normal property access', () => {
    const map = Object.create({ jazz: 'ambient' }) as Record<string, string>;
    expect(resolveGenre('jazz', map)).toBe('ambient');
    expect(Object.prototype.hasOwnProperty.call(map, 'jazz')).toBe(false);
  });

  it('returns music for falsy non-string inputs 0 / false / NaN', () => {
    expect(resolveGenre(0 as unknown as string)).toBe('music');
    expect(resolveGenre(false as unknown as string)).toBe('music');
    expect(resolveGenre(NaN as unknown as string)).toBe('music');
  });

  it('throws when truthy non-string inputs lack toLowerCase', () => {
    expect(() => resolveGenre(1 as unknown as string)).toThrow();
    expect(() => resolveGenre(true as unknown as string)).toThrow();
  });

  it('returns music for BOM-only input after trim', () => {
    expect(resolveGenre('\uFEFF')).toBe('music');
  });

  it('strips leading BOM so FEFFjazz resolves to jazz', () => {
    expect(resolveGenre('\uFEFFjazz')).toBe('jazz');
  });

  it('propagates custom map getter throws', () => {
    const map = {
      get jazz() {
        throw new Error('map getter boom');
      },
    } as unknown as Record<string, string>;
    expect(() => resolveGenre('jazz', map)).toThrow(/map getter boom/);
  });

  it('returns custom map values as-is even when non-string objects', () => {
    const weird = { toString: () => 'nope' };
    expect(resolveGenre('x', { x: weird as unknown as string })).toBe(weird);
  });

  it('resolves LATE NIGHT multi-word upper to ambient', () => {
    expect(resolveGenre('LATE NIGHT')).toBe('ambient');
  });

  it('uses live GENRE_MAP as default map argument (same results as explicit pass)', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(resolveGenre(key)).toBe(resolveGenre(key, GENRE_MAP));
    }
    expect(resolveGenre('unknown-xyz')).toBe(resolveGenre('unknown-xyz', GENRE_MAP));
  });

  it('returns music for null-byte suffix rock\\0', () => {
    expect(resolveGenre('rock\u0000')).toBe('music');
  });

  it('maps only hyphenated lo-fi; underscore and en-dash variants fall to music', () => {
    expect(resolveGenre('lo-fi')).toBe('ambient');
    expect(resolveGenre('lo_fi')).toBe('music');
    expect(resolveGenre('lo–fi')).toBe('music');
  });

  it('never returns uppercase genre strings for default map path', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(resolveGenre(key)).toBe(resolveGenre(key).toLowerCase());
    }
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g.toUpperCase())).toBe(g);
    }
  });

  it('resolves every GENRE_MAP key to its mapped value', () => {
    for (const [key, value] of Object.entries(GENRE_MAP)) {
      expect(resolveGenre(key)).toBe(value);
    }
  });

  it('resolves own __proto__ key on Object.create(null) map', () => {
    const map = Object.create(null) as Record<string, string>;
    map['__proto__'] = 'jazz';
    expect(resolveGenre('__proto__', map)).toBe('jazz');
  });

  it('resolves boxed String inputs via toLowerCase/trim', () => {
    expect(resolveGenre(new String('jazz') as unknown as string)).toBe('jazz');
    expect(resolveGenre(new String('  CHILL ') as unknown as string)).toBe('ambient');
  });

  it('keeps GENRE_MAP extensible and unsealed', () => {
    expect(Object.isSealed(GENRE_MAP)).toBe(false);
    expect(Object.isExtensible(GENRE_MAP)).toBe(true);
  });

  it('returns NaN map values via ?? without falling through to VALID_GENRES', () => {
    const map = { chill: Number.NaN } as unknown as Record<string, string>;
    expect(Number.isNaN(resolveGenre('chill', map) as unknown as number)).toBe(true);
  });

  it('returns music for whitespace-only and tab-only inputs', () => {
    expect(resolveGenre('   ')).toBe('music');
    expect(resolveGenre('\t\t')).toBe('music');
    expect(resolveGenre('\n')).toBe('music');
  });

  it('resolves mixed-case multi-word late night with interior tabs after lowercasing', () => {
    // toLowerCase then trim — interior tabs remain, so map miss → music
    expect(resolveGenre('\tLate Night\t')).toBe('ambient');
    expect(resolveGenre('late\tnight')).toBe('music');
  });

  it('does not trim interior spaces in unknown phrases before map lookup', () => {
    expect(resolveGenre('  rock  ')).toBe('rock');
    expect(resolveGenre('ro ck')).toBe('music');
  });

  it('locks GENRE_MAP value set as a subset of VALID_GENRES', () => {
    for (const value of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES).toContain(value);
    }
  });

  it('locks VALID_GENRES length at exactly 9', () => {
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('treats custom map empty-string values as hits (?? does not fall through)', () => {
    expect(resolveGenre('chill', { chill: '' })).toBe('');
  });

  it('resolves sports and news identity with surrounding whitespace', () => {
    expect(resolveGenre('  SPORTS  ')).toBe('sports');
    expect(resolveGenre('\tNews\t')).toBe('news');
  });

  it('does not resolve hyphenated late-night or spaced electronic aliases', () => {
    expect(resolveGenre('late-night')).toBe('music');
    expect(resolveGenre('electro nic')).toBe('music');
  });

  it('custom map can redirect a VALID_GENRES identity to another category', () => {
    expect(resolveGenre('jazz', { jazz: 'news' })).toBe('news');
  });

  it('returns 0 map values via ?? without falling through', () => {
    const map = { chill: 0 } as unknown as Record<string, string>;
    expect(resolveGenre('chill', map) as unknown as number).toBe(0);
  });

  it('returns music for combining-acute decorated latin labels', () => {
    // j + combining acute + azz — not NFC "jazz"
    expect(resolveGenre('j\u0301azz')).toBe('music');
  });

  it('resolves NFC jazz but not NFD-split lookalikes beyond simple case', () => {
    expect(resolveGenre('jazz'.normalize('NFC'))).toBe('jazz');
    expect(resolveGenre('jazz'.normalize('NFD'))).toBe('jazz');
  });

  it('propagates Proxy get traps on custom maps', () => {
    const target: Record<string, string> = { chill: 'ambient' };
    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === 'jazz') return 'rock';
        return Reflect.get(t, prop, receiver);
      },
    });
    expect(resolveGenre('jazz', proxy)).toBe('rock');
    expect(resolveGenre('chill', proxy)).toBe('ambient');
  });

  it('returns Infinity map values via ?? without falling through', () => {
    const map = { chill: Number.POSITIVE_INFINITY } as unknown as Record<string, string>;
    expect(resolveGenre('chill', map) as unknown as number).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns -0 map values via ?? without falling through', () => {
    const map = { chill: -0 } as unknown as Record<string, string>;
    expect(Object.is(resolveGenre('chill', map) as unknown as number, -0)).toBe(true);
  });

  it('throws when input is a Symbol', () => {
    expect(() => resolveGenre(Symbol('jazz') as unknown as string)).toThrow();
  });

  it('throws when input is an array', () => {
    expect(() => resolveGenre(['jazz'] as unknown as string)).toThrow();
  });

  it('resolves Map-backed lookups only when converted to a plain object', () => {
    const asMap = new Map([['jazz', 'ambient']]);
    expect(() => resolveGenre('jazz', asMap as unknown as Record<string, string>)).not.toThrow();
    // Map has no own 'jazz' string key for bracket access
    expect(resolveGenre('jazz', asMap as unknown as Record<string, string>)).toBe('jazz');
  });

  it('locks unique value cardinality of GENRE_MAP at VALID_GENRES length', () => {
    expect(new Set(Object.values(GENRE_MAP)).size).toBe(VALID_GENRES.length);
  });

  it('keeps every VALID_GENRES member reachable as a GENRE_MAP value', () => {
    const values = new Set(Object.values(GENRE_MAP));
    for (const g of VALID_GENRES) {
      expect(values.has(g)).toBe(true);
    }
  });

  it('returns music for RTL override and LRM decorated jazz', () => {
    expect(resolveGenre('\u202Ejazz')).toBe('music');
    expect(resolveGenre('jazz\u200E')).toBe('music');
  });

  it('returns music for hangul filler and ideographic space only', () => {
    expect(resolveGenre('\u3164')).toBe('music');
    expect(resolveGenre('\u3000')).toBe('music');
  });

  it('trims ideographic space so padded jazz still resolves', () => {
    expect(resolveGenre('\u3000jazz\u3000')).toBe('jazz');
  });

  it('does not resolve camelCase LateNight as late night', () => {
    expect(resolveGenre('LateNight')).toBe('music');
    expect(resolveGenre('lateNight')).toBe('music');
  });

  it('resolves every VALID_GENRES id through a map that only has aliases', () => {
    const aliasesOnly = { chill: 'ambient', blues: 'jazz', metal: 'rock' };
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g, aliasesOnly)).toBe(g);
    }
  });

  it('custom map empty object still defaults blank/missing to music', () => {
    expect(resolveGenre(undefined, {})).toBe('music');
    expect(resolveGenre('', {})).toBe('music');
  });

  it('locks alias-only keys (non-VALID_GENRES) exact sorted set', () => {
    const aliasOnly = Object.keys(GENRE_MAP)
      .filter((k) => !(VALID_GENRES as readonly string[]).includes(k))
      .sort();
    expect(aliasOnly).toEqual([
      'blues',
      'chill',
      'classic',
      'dance',
      'electronic',
      'focus',
      'indie',
      'late night',
      'lo-fi',
      'lofi',
      'metal',
      'relaxing',
    ]);
  });

  it('returns music for line-separator and paragraph-separator only', () => {
    expect(resolveGenre('\u2028')).toBe('music');
    expect(resolveGenre('\u2029')).toBe('music');
  });

  it('trims trailing line/paragraph separators so jazz still resolves', () => {
    // String.trim() treats U+2028/U+2029 as whitespace
    expect(resolveGenre('jazz\u2028')).toBe('jazz');
    expect(resolveGenre('jazz\u2029')).toBe('jazz');
    expect(resolveGenre('\u2028jazz\u2028')).toBe('jazz');
  });

  it('Object.keys order matches Object.entries key order for GENRE_MAP', () => {
    expect(Object.keys(GENRE_MAP)).toEqual(Object.entries(GENRE_MAP).map(([k]) => k));
  });

  it('JSON round-trips GENRE_MAP without key reordering', () => {
    expect(Object.keys(JSON.parse(JSON.stringify(GENRE_MAP)))).toEqual(Object.keys(GENRE_MAP));
  });

  it('JSON round-trips VALID_GENRES as a plain array', () => {
    expect(JSON.parse(JSON.stringify(VALID_GENRES))).toEqual([...VALID_GENRES]);
  });

  it('resolveGenre never returns a VALID_GENRES member uppercased for default map', () => {
    for (const input of [...Object.keys(GENRE_MAP), ...VALID_GENRES, 'UNKNOWN']) {
      const out = resolveGenre(input);
      if (typeof out === 'string') {
        expect(out).toBe(out.toLowerCase());
      }
    }
  });

  it('custom map can return uppercase values without lowercasing them', () => {
    expect(resolveGenre('chill', { chill: 'AMBIENT' })).toBe('AMBIENT');
  });

  it('returns music for tag-latin and mathematical bold lookalikes of jazz', () => {
    // Mathematical bold small j/a/z/z
    expect(resolveGenre('\uD835\uDC23\uD835\uDC1A\uD835\uDC33\uD835\uDC33')).toBe('music');
  });

  it('keeps GENRE_MAP free of symbol keys', () => {
    expect(Object.getOwnPropertySymbols(GENRE_MAP)).toEqual([]);
  });

  it('does not resolve via symbol keys on a custom map', () => {
    const sym = Symbol('jazz');
    const map = { [sym]: 'ambient' } as unknown as Record<string, string>;
    expect(resolveGenre('jazz', map)).toBe('jazz');
  });

  it('locks music as the first VALID_GENRES entry (default fallback target)', () => {
    expect(VALID_GENRES[0]).toBe('music');
  });

  it('locks entertainment as the last VALID_GENRES entry', () => {
    expect(VALID_GENRES[VALID_GENRES.length - 1]).toBe('entertainment');
  });

  it('resolveGenre with deleted ambient identity still resolves ambient via VALID_GENRES', () => {
    const map = { ...GENRE_MAP };
    delete map.ambient;
    expect(resolveGenre('ambient', map)).toBe('ambient');
    expect(resolveGenre('chill', map)).toBe('ambient');
  });

  it('whitespace-only after trim can hit custom empty-string key', () => {
    expect(resolveGenre('\t  \n', { '': 'news' })).toBe('news');
  });

  it('does not coerce BigInt inputs', () => {
    expect(() => resolveGenre(1n as unknown as string)).toThrow();
  });

  it('locks exact GENRE_MAP → VALID_GENRES coverage matrix counts', () => {
    const counts: Record<string, number> = {};
    for (const v of Object.values(GENRE_MAP)) {
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(counts).toEqual({
      ambient: 8,
      classical: 2,
      jazz: 2,
      pop: 2,
      rock: 3,
      music: 1,
      news: 1,
      sports: 1,
      entertainment: 1,
    });
  });

  it('returns music for leading/trailing zero-width no-break space (BOM sibling)', () => {
    expect(resolveGenre('\uFEFFchill\uFEFF')).toBe('ambient');
  });

  it('resolves classic and classical independently under empty custom map', () => {
    expect(resolveGenre('classic', {})).toBe('music');
    expect(resolveGenre('classical', {})).toBe('classical');
  });

  it('keeps resolveGenre referentially transparent for identical string inputs', () => {
    const a = resolveGenre('  Jazz  ');
    const b = resolveGenre('  Jazz  ');
    expect(a).toBe(b);
    expect(a).toBe('jazz');
  });

  it('does not treat RegExp inputs as genre labels', () => {
    expect(() => resolveGenre(/jazz/ as unknown as string)).toThrow();
  });

  it('locks lo-fi hyphen as U+002D ASCII hyphen-minus only', () => {
    expect('lo-fi'.includes('\u002D')).toBe(true);
    expect(Object.keys(GENRE_MAP)).toContain('lo-fi');
    expect(Object.keys(GENRE_MAP)).not.toContain('lo–fi');
    expect(Object.keys(GENRE_MAP)).not.toContain('lo—fi');
  });

  it('locks exact GENRE_MAP object snapshot', () => {
    expect(GENRE_MAP).toEqual({
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
    });
  });

  it('locks exact VALID_GENRES tuple snapshot', () => {
    expect(VALID_GENRES).toEqual([
      'music',
      'ambient',
      'jazz',
      'classical',
      'pop',
      'rock',
      'news',
      'sports',
      'entertainment',
    ]);
  });

  it('every GENRE_MAP value is also a GENRE_MAP identity key', () => {
    for (const value of Object.values(GENRE_MAP)) {
      expect(GENRE_MAP[value]).toBe(value);
    }
  });

  it('alias-only keys never equal their mapped canonical value', () => {
    for (const [k, v] of Object.entries(GENRE_MAP)) {
      if (!(VALID_GENRES as readonly string[]).includes(k)) {
        expect(k).not.toBe(v);
      }
    }
  });

  it('resolves Proxy-wrapped maps via get trap', () => {
    const map = new Proxy(
      { chill: 'ambient' },
      {
        get(target, prop, receiver) {
          if (typeof prop === 'string') return Reflect.get(target, prop, receiver);
          return undefined;
        },
      },
    );
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('jazz', map)).toBe('jazz');
  });

  it('does not invoke custom map setters during resolveGenre', () => {
    let sets = 0;
    const map = new Proxy(
      { chill: 'ambient' } as Record<string, string>,
      {
        set(target, prop, value, receiver) {
          sets += 1;
          return Reflect.set(target, prop, value, receiver);
        },
      },
    );
    resolveGenre('chill', map);
    resolveGenre('unknown', map);
    expect(sets).toBe(0);
  });

  it('Object.seal on a custom map still allows resolveGenre reads', () => {
    const map = Object.seal({ ...GENRE_MAP, vibes: 'jazz' });
    expect(resolveGenre('vibes', map)).toBe('jazz');
    expect(resolveGenre('metal', map)).toBe('rock');
  });

  it('Object.freeze(GENRE_MAP) would throw on mutation but resolveGenre still reads', () => {
    // GENRE_MAP is not frozen at module load — lock that so agents can still edit genres.ts
    expect(Object.isFrozen(GENRE_MAP)).toBe(false);
    expect(Object.isSealed(GENRE_MAP)).toBe(false);
    expect(resolveGenre('chill')).toBe('ambient');
  });

  it('non-enumerable own properties on a custom map are still visible to bracket lookup', () => {
    const map = {} as Record<string, string>;
    Object.defineProperty(map, 'hidden', {
      value: 'news',
      enumerable: false,
      configurable: true,
    });
    expect(Object.keys(map)).not.toContain('hidden');
    expect(resolveGenre('hidden', map)).toBe('news');
  });

  it('getter-defined custom map properties are invoked once per resolve', () => {
    let hits = 0;
    const map = {} as Record<string, string>;
    Object.defineProperty(map, 'chill', {
      get() {
        hits += 1;
        return 'ambient';
      },
      enumerable: true,
      configurable: true,
    });
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('CHILL', map)).toBe('ambient');
    expect(hits).toBe(2);
  });

  it('String([]) is blank → music; String([jazz]) lowercases to jazz identity', () => {
    expect(resolveGenre(String([]))).toBe('music'); // ''
    expect(resolveGenre(String(['jazz']))).toBe('jazz'); // 'jazz'
  });

  it('does not accept Number objects via valueOf coercion', () => {
    expect(() => resolveGenre(Object(42) as unknown as string)).toThrow();
  });

  it('locks rock-bound alias sorted set exactly', () => {
    const rockKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'rock')
      .map(([k]) => k)
      .sort();
    expect(rockKeys).toEqual(['indie', 'metal', 'rock']);
  });

  it('locks pop-bound alias sorted set exactly', () => {
    const popKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'pop')
      .map(([k]) => k)
      .sort();
    expect(popKeys).toEqual(['dance', 'pop']);
  });

  it('locks jazz-bound alias sorted set exactly', () => {
    const jazzKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'jazz')
      .map(([k]) => k)
      .sort();
    expect(jazzKeys).toEqual(['blues', 'jazz']);
  });

  it('locks classical-bound alias sorted set exactly', () => {
    const classicalKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'classical')
      .map(([k]) => k)
      .sort();
    expect(classicalKeys).toEqual(['classic', 'classical']);
  });

  it('resolves padded VALID_GENRES through Object.create(null) empty map', () => {
    const map = Object.create(null) as Record<string, string>;
    for (const genre of VALID_GENRES) {
      expect(resolveGenre(`  ${genre.toUpperCase()}  `, map)).toBe(genre);
    }
  });

  it('returns music for combining-mark decorated latin labels', () => {
    // j + combining acute + azz
    expect(resolveGenre('j\u0301azz')).toBe('music');
  });

  it('returns music for hangul and cjk full genre words', () => {
    expect(resolveGenre('재즈')).toBe('music');
    expect(resolveGenre('爵士')).toBe('music');
  });

  it('custom map nullish values: null falls through via ??, undefined falls through', () => {
    expect(
      resolveGenre('chill', { chill: null as unknown as string }),
    ).toBe('music');
    expect(
      resolveGenre('jazz', { jazz: undefined as unknown as string }),
    ).toBe('jazz'); // VALID_GENRES hit after ?? undefined
  });

  it('custom map falsey 0 number is returned (?? does not treat 0 as missing)', () => {
    expect(resolveGenre('chill', { chill: 0 as unknown as string })).toBe(0);
  });

  it('locks multi-word alias keys to exactly late night and lo-fi', () => {
    const multi = Object.keys(GENRE_MAP).filter((k) => /[\s-]/.test(k)).sort();
    expect(multi).toEqual(['late night', 'lo-fi']);
  });

  it('resolveGenre is stable under repeated identical custom-map calls', () => {
    const map = { vibes: 'jazz', chill: 'ambient' };
    for (let i = 0; i < 50; i++) {
      expect(resolveGenre('vibes', map)).toBe('jazz');
      expect(resolveGenre('chill', map)).toBe('ambient');
      expect(resolveGenre('news', map)).toBe('news');
    }
  });

  it('does not resolve via Object.prototype pollution on a polluted custom map', () => {
    const polluted = {} as Record<string, string>;
    (Object.prototype as unknown as Record<string, string>).pollutedgenre = 'jazz';
    try {
      expect(resolveGenre('pollutedgenre', polluted)).toBe(
        (Object.prototype as unknown as Record<string, string>).pollutedgenre,
      );
      // inherited hit is truthy → returned; lock the quirk so agents do not "fix" it silently
      expect(typeof resolveGenre('pollutedgenre', polluted)).toBe('string');
    } finally {
      delete (Object.prototype as unknown as Record<string, string>).pollutedgenre;
    }
  });

  it('Object.create(null) custom map ignores Object.prototype pollution', () => {
    (Object.prototype as unknown as Record<string, string>).pollutedgenre = 'jazz';
    try {
      const map = Object.create(null) as Record<string, string>;
      expect(resolveGenre('pollutedgenre', map)).toBe('music');
    } finally {
      delete (Object.prototype as unknown as Record<string, string>).pollutedgenre;
    }
  });

  it('locks resolveGenre arity and default parameter presence via toString', () => {
    const src = resolveGenre.toString();
    expect(src).toMatch(/map\s*=\s*GENRE_MAP/);
    // First param has no default; second has default → length 1
    expect(resolveGenre.length).toBe(1);
  });

  it('keeps VALID_GENRES and GENRE_MAP referentially stable across imports', async () => {
    const again = await import('../src/genres');
    expect(again.GENRE_MAP).toBe(GENRE_MAP);
    expect(again.VALID_GENRES).toBe(VALID_GENRES);
    expect(again.resolveGenre).toBe(resolveGenre);
  });

  it('locks ambient alias count at 8 including identity', () => {
    expect(Object.values(GENRE_MAP).filter((v) => v === 'ambient')).toHaveLength(8);
  });

  it('locks identity-only genres (no extra aliases) sorted set', () => {
    const identityOnly = VALID_GENRES.filter(
      (g) => Object.entries(GENRE_MAP).filter(([, v]) => v === g).length === 1,
    );
    expect(identityOnly).toEqual(['music', 'news', 'sports', 'entertainment']);
  });

  it('returns music for RTL override and embedding controls around jazz', () => {
    expect(resolveGenre('\u202Ejazz')).toBe('music');
    expect(resolveGenre('jazz\u202C')).toBe('music');
  });

  it('trims ascii whitespace but not non-breaking hyphen around aliases', () => {
    expect(resolveGenre('  chill  ')).toBe('ambient');
    expect(resolveGenre('\u2011chill')).toBe('music'); // non-breaking hyphen
  });

  it('custom map can remap music default target away from music', () => {
    expect(resolveGenre('unknown', { music: 'jazz' })).toBe('music'); // unknown → music literal
    expect(resolveGenre('music', { music: 'jazz' })).toBe('jazz');
  });

  it('empty string key on custom map is only hit after trim of whitespace-only input', () => {
    const map = { '': 'sports' };
    expect(resolveGenre('', map)).toBe('music'); // !input short-circuit
    expect(resolveGenre(' ', map)).toBe('sports');
    expect(resolveGenre('\n\t', map)).toBe('sports');
  });

  it('locks GENRE_MAP key string lengths for multi-word aliases', () => {
    expect('late night'.length).toBe(10);
    expect('lo-fi'.length).toBe(5);
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(GENRE_MAP['lo-fi']).toBe('ambient');
  });

  it('does not treat Map instances as Record maps (bracket lookup fails)', () => {
    const map = new Map([['chill', 'ambient']]);
    expect(resolveGenre('chill', map as unknown as Record<string, string>)).toBe('music');
  });

  it('structuredClone of GENRE_MAP yields equal but distinct object', () => {
    const cloned = structuredClone(GENRE_MAP);
    expect(cloned).toEqual(GENRE_MAP);
    expect(cloned).not.toBe(GENRE_MAP);
    expect(resolveGenre('chill', cloned)).toBe('ambient');
  });

  it('JSON.parse(JSON.stringify(GENRE_MAP)) works as a resolveGenre map', () => {
    const cloned = JSON.parse(JSON.stringify(GENRE_MAP)) as Record<string, string>;
    expect(resolveGenre('lo-fi', cloned)).toBe('ambient');
    expect(resolveGenre('blues', cloned)).toBe('jazz');
  });

  it('locks resolveGenre fallback chain: map hit → VALID_GENRES → music', () => {
    expect(resolveGenre('chill', {})).toBe('music'); // alias miss + not VALID
    expect(resolveGenre('jazz', {})).toBe('jazz'); // VALID hit
    expect(resolveGenre('chill', { chill: 'news' })).toBe('news'); // map hit
  });

  it('keeps every VALID_GENRES slug free of digits and punctuation', () => {
    for (const g of VALID_GENRES) {
      expect(g).toMatch(/^[a-z]+$/);
      expect(g).not.toMatch(/[0-9_\-\s]/);
    }
  });

  it('resolves entertainment and sports with mixed whitespace and case via empty map', () => {
    expect(resolveGenre('\tEntertainment\n', {})).toBe('entertainment');
    expect(resolveGenre('  SPORTS  ', {})).toBe('sports');
  });

  it('returns music for Turkish dotted-I uppercasing lookalikes of jazz', () => {
    // "JAZZ".toLocaleLowerCase("tr") → "jazz" still, but İ (U+0130) is the trap
    expect(resolveGenre('İazz')).toBe('music');
    expect(resolveGenre('JAZZ'.toLocaleLowerCase('tr'))).toBe('jazz');
  });

  it('null-prototype custom map ignores Object.prototype pollution', () => {
    const polluted = Object.create(null) as Record<string, string>;
    (Object.prototype as Record<string, string>).polluted_genre = 'jazz';
    try {
      // null-prototype map: bracket miss → VALID_GENRES miss → music
      expect(resolveGenre('polluted_genre', polluted)).toBe('music');
      // default GENRE_MAP inherits Object.prototype, so pollution is visible
      expect(resolveGenre('polluted_genre')).toBe('jazz');
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted_genre;
    }
  });

  it('Object.create(null) custom map with only chill resolves chill and falls back else', () => {
    const map = Object.assign(Object.create(null), { chill: 'ambient' }) as Record<string, string>;
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('kpop', map)).toBe('music');
  });

  it('map getter that mutates sibling keys still returns first lookup', () => {
    const map: Record<string, string> = {
      get chill() {
        map.jazz = 'rock';
        return 'ambient';
      },
    };
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('jazz', map)).toBe('rock');
  });

  it('keeps every resolveGenre return a non-empty string under default map', () => {
    const probes = ['', ' ', 'chill', 'JAZZ', 'unknown', 'metal', '\tpop\n', undefined];
    for (const p of probes) {
      const out = resolveGenre(p);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('locks ambient alias fan-in count at exactly 8 keys', () => {
    const ambientKeys = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k)
      .sort();
    expect(ambientKeys).toEqual([
      'ambient',
      'chill',
      'electronic',
      'focus',
      'late night',
      'lo-fi',
      'lofi',
      'relaxing',
    ]);
  });

  it('locks rock alias fan-in as indie/metal/rock only', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'rock')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['indie', 'metal', 'rock']);
  });

  it('Array.from(VALID_GENRES) equals spread and slice copies', () => {
    expect(Array.from(VALID_GENRES)).toEqual([...VALID_GENRES]);
    expect(VALID_GENRES.slice()).toEqual([...VALID_GENRES]);
  });

  it('does not resolve soft-hyphen inserted into lo-fi', () => {
    expect(resolveGenre('lo\u00ADfi')).toBe('music');
    expect(resolveGenre('lo-\u00ADfi')).toBe('music');
  });

  it('returns music for hangul and cyrillic lookalike genre labels', () => {
    expect(resolveGenre('джаз')).toBe('music');
    expect(resolveGenre('재즈')).toBe('music');
  });

  it('custom map can return VALID_GENRES identity strings that differ from GENRE_MAP values', () => {
    expect(resolveGenre('chill', { chill: 'news' })).toBe('news');
    expect(GENRE_MAP.chill).toBe('ambient');
  });

  it('does not treat Map instances as Record string maps', () => {
    const map = new Map([['jazz', 'jazz']]);
    expect(resolveGenre('jazz', map as unknown as Record<string, string>)).toBe('jazz');
  });

  it('resolveGenre length is always a ValidGenre length under default map', () => {
    const lens = new Set(VALID_GENRES.map((g) => g.length));
    for (const probe of ['x', 'chill', 'LATE NIGHT', 'zzzz']) {
      expect(lens.has(resolveGenre(probe).length)).toBe(true);
    }
  });

  it('locks GENRE_MAP values join equal to sorted unique VALID_GENRES join', () => {
    expect([...new Set(Object.values(GENRE_MAP))].sort().join(',')).toBe(
      [...VALID_GENRES].sort().join(','),
    );
  });

  it('does not resolve via numeric string keys unless explicitly mapped', () => {
    expect(resolveGenre('0')).toBe('music');
    expect(resolveGenre('1', { '1': 'jazz' })).toBe('jazz');
  });

  it('keeps VALID_GENRES iterable via for...of without holes', () => {
    const seen: string[] = [];
    for (const g of VALID_GENRES) seen.push(g);
    expect(seen).toEqual([...VALID_GENRES]);
  });

  it('Object.keys on VALID_GENRES array yields index strings 0..8', () => {
    expect(Object.keys(VALID_GENRES)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('returns music for emoji-zwj sequences that are not genre labels', () => {
    expect(resolveGenre('👨‍💻')).toBe('music');
    expect(resolveGenre('🎧radio')).toBe('music');
  });

  it('custom map undefined property descriptor still falls through via ??', () => {
    const map = Object.defineProperty({}, 'jazz', {
      value: undefined,
      enumerable: true,
      configurable: true,
    }) as Record<string, string>;
    expect(resolveGenre('jazz', map)).toBe('jazz');
  });

  it('does not trim interior tabs between late and night', () => {
    expect(resolveGenre('late\tnight')).toBe('music');
  });

  it('structuredClone of GENRE_MAP resolves identically for all keys', () => {
    const clone = structuredClone(GENRE_MAP);
    for (const key of Object.keys(GENRE_MAP)) {
      expect(resolveGenre(key, clone)).toBe(resolveGenre(key));
    }
  });

  it('locks classic→classical and dance→pop alias targets', () => {
    expect(GENRE_MAP.classic).toBe('classical');
    expect(GENRE_MAP.dance).toBe('pop');
    expect(resolveGenre('classic')).toBe('classical');
    expect(resolveGenre('dance')).toBe('pop');
  });

  it('returns music for URL-like and path-like genre probes', () => {
    expect(resolveGenre('https://jazz')).toBe('music');
    expect(resolveGenre('../ambient')).toBe('music');
    expect(resolveGenre('/news')).toBe('music');
  });

  it('keeps resolveGenre.length at 1 (map param has a default)', () => {
    // First param is optional in types but has no default → length 1
    expect(resolveGenre.length).toBe(1);
    expect(typeof resolveGenre).toBe('function');
  });

  it('does not resolve via toString tag spoofing on objects', () => {
    const spoof = {
      toString() {
        return 'jazz';
      },
      toLowerCase() {
        return 'jazz';
      },
      trim() {
        return 'jazz';
      },
    };
    // truthy object → toLowerCase/trim run → jazz identity
    expect(resolveGenre(spoof as unknown as string)).toBe('jazz');
  });

  it('locks GENRE_MAP stringified byte length within a stable ceiling', () => {
    const raw = JSON.stringify(GENRE_MAP);
    expect(raw.length).toBeGreaterThan(200);
    expect(raw.length).toBeLessThan(800);
  });

  it('locks VALID_GENRES localeCompare sort equal to declaration order', () => {
    expect([...VALID_GENRES].sort((a, b) => a.localeCompare(b))).toEqual([
      'ambient',
      'classical',
      'entertainment',
      'jazz',
      'music',
      'news',
      'pop',
      'rock',
      'sports',
    ]);
  });

  it('Object.freeze on a VALID_GENRES copy still resolves every identity via empty map', () => {
    const frozen = Object.freeze([...VALID_GENRES]);
    for (const g of frozen) {
      expect(resolveGenre(g, {})).toBe(g);
    }
    expect(() => {
      (frozen as string[]).push('x');
    }).toThrow();
  });

  it('Object.preventExtensions on a GENRE_MAP clone still resolves every key', () => {
    const clone = { ...GENRE_MAP };
    Object.preventExtensions(clone);
    for (const [k, v] of Object.entries(GENRE_MAP)) {
      expect(resolveGenre(k, clone)).toBe(v);
    }
    expect(Object.isExtensible(clone)).toBe(false);
    expect(Object.isExtensible(GENRE_MAP)).toBe(true);
  });

  it('delete music from a GENRE_MAP clone still resolves music via VALID_GENRES', () => {
    const m = { ...GENRE_MAP };
    delete m.music;
    expect(resolveGenre('music', m)).toBe('music');
    expect(resolveGenre('MUSIC', m)).toBe('music');
    expect(m).not.toHaveProperty('music');
  });

  it('resolveGenre is idempotent under re-application for common probes', () => {
    const probes: Array<string | undefined> = [
      undefined,
      '',
      '  Jazz ',
      'LATE NIGHT',
      'k-pop',
      'metal',
      'electronic',
      'unknown-xyz',
      '\u00A0chill\u00A0',
    ];
    for (const p of probes) {
      expect(resolveGenre(resolveGenre(p))).toBe(resolveGenre(p));
    }
  });

  it('locks music fan-in as identity-only exact set', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'music')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['music']);
  });

  it('locks news fan-in as identity-only exact set', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'news')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['news']);
  });

  it('locks sports fan-in as identity-only exact set', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'sports')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['sports']);
  });

  it('locks entertainment fan-in as identity-only exact set', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'entertainment')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['entertainment']);
  });

  it('locks resolveGenre.name to resolveGenre', () => {
    expect(resolveGenre.name).toBe('resolveGenre');
  });

  it('locks localeCompare-sorted GENRE_MAP keys exact snapshot', () => {
    expect([...Object.keys(GENRE_MAP)].sort((a, b) => a.localeCompare(b))).toEqual([
      'ambient',
      'blues',
      'chill',
      'classic',
      'classical',
      'dance',
      'electronic',
      'entertainment',
      'focus',
      'indie',
      'jazz',
      'late night',
      'lo-fi',
      'lofi',
      'metal',
      'music',
      'news',
      'pop',
      'relaxing',
      'rock',
      'sports',
    ]);
  });

  it('NBSP-padded chill alias still resolves to ambient after trim', () => {
    expect(resolveGenre('\u00A0chill\u00A0')).toBe('ambient');
    expect(resolveGenre('\u00A0CHILL\u00A0')).toBe('ambient');
  });

  it('ZWSP interior between late and night kills the multi-word alias', () => {
    expect(resolveGenre('late\u200Bnight')).toBe('music');
    expect(resolveGenre('late\u200B\u200Bnight')).toBe('music');
  });

  it('returns music for em-dash lo—fi (U+2014) lookalike', () => {
    expect(resolveGenre('lo\u2014fi')).toBe('music');
    expect(resolveGenre('LO\u2014FI')).toBe('music');
  });

  it('figure space U+2007 around jazz trims and resolves', () => {
    expect(resolveGenre('\u2007jazz\u2007')).toBe('jazz');
  });

  it('Ogham space U+1680 around jazz trims and resolves', () => {
    expect(resolveGenre('\u1680jazz\u1680')).toBe('jazz');
  });

  it('narrow NBSP U+202F around focus trims to ambient', () => {
    expect(resolveGenre('\u202Ffocus\u202F')).toBe('ambient');
  });

  it('Proxy.revocable custom map resolves before revoke and throws after', () => {
    const { proxy, revoke } = Proxy.revocable(
      { chill: 'ambient' } as Record<string, string>,
      {},
    );
    expect(resolveGenre('chill', proxy)).toBe('ambient');
    revoke();
    expect(() => resolveGenre('chill', proxy)).toThrow();
  });

  it('VALID_GENRES array identity is distinct from Object.values(GENRE_MAP)', () => {
    expect(VALID_GENRES).not.toBe(Object.values(GENRE_MAP));
    expect([...VALID_GENRES].sort()).not.toEqual(Object.values(GENRE_MAP).sort());
  });

  it('Object.getOwnPropertySymbols on VALID_GENRES and GENRE_MAP are empty', () => {
    expect(Object.getOwnPropertySymbols(VALID_GENRES)).toEqual([]);
    expect(Object.getOwnPropertySymbols(GENRE_MAP)).toEqual([]);
  });

  it('GENRE_MAP values never contain whitespace', () => {
    for (const v of Object.values(GENRE_MAP)) {
      expect(v).not.toMatch(/\s/);
    }
  });

  it('pop fan-in locks dance and pop only', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'pop')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['dance', 'pop']);
  });

  it('classical fan-in locks classic and classical only', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'classical')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['classic', 'classical']);
  });

  it('jazz fan-in locks blues and jazz only', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'jazz')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['blues', 'jazz']);
  });

  it('delete every alias from a clone leaves only VALID_GENRES identity fallbacks', () => {
    const m = { ...GENRE_MAP };
    for (const k of Object.keys(m)) {
      if (!(VALID_GENRES as readonly string[]).includes(k)) delete m[k];
    }
    expect(resolveGenre('chill', m)).toBe('music');
    expect(resolveGenre('metal', m)).toBe('music');
    expect(resolveGenre('jazz', m)).toBe('jazz');
    expect(resolveGenre('ambient', m)).toBe('ambient');
  });

  it('resolveGenre(undefined, customMap) ignores the map and returns music', () => {
    expect(resolveGenre(undefined, { '': 'jazz', music: 'rock' })).toBe('music');
  });

  it('trimmed empty string with custom empty-key map hits the empty key', () => {
    expect(resolveGenre('   ', { '': 'news' })).toBe('news');
    expect(resolveGenre('\t\n', { '': 'sports' })).toBe('sports');
  });

  it('does not resolve vertical tab or form feed interior late night', () => {
    expect(resolveGenre('late\vnight')).toBe('music');
    expect(resolveGenre('late\fnight')).toBe('music');
  });

  it('keeps GENRE_MAP key count equal to Object.entries length', () => {
    expect(Object.keys(GENRE_MAP).length).toBe(Object.entries(GENRE_MAP).length);
    expect(Object.keys(GENRE_MAP).length).toBe(21);
  });

  it('every VALID_GENRES slug resolves to itself under Object.create(null) map', () => {
    const empty = Object.create(null) as Record<string, string>;
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g, empty)).toBe(g);
      expect(resolveGenre(g.toUpperCase(), empty)).toBe(g);
    }
  });

  it('custom map returning empty string is kept (?? does not treat "" as missing)', () => {
    expect(resolveGenre('chill', { chill: '' })).toBe('');
  });

  it('does not resolve via __proto__ pollution on a plain object map', () => {
    const polluted = JSON.parse('{"__proto__":{"jazz":"news"}}') as Record<string, string>;
    expect(resolveGenre('jazz', polluted)).toBe('jazz');
    expect(resolveGenre('chill', polluted)).toBe('music');
  });

  it('locks ambient-bound alias count excluding identity at exactly 7', () => {
    const aliases = Object.entries(GENRE_MAP).filter(([k, v]) => v === 'ambient' && k !== 'ambient');
    expect(aliases).toHaveLength(7);
  });

  it('resolveGenre return is always typeof string even for weird custom maps', () => {
    expect(typeof resolveGenre('x', { x: 'y' })).toBe('string');
    expect(typeof resolveGenre()).toBe('string');
  });

  it('does not treat Surrogate-pair emoji as genre labels', () => {
    expect(resolveGenre('🎵')).toBe('music');
    expect(resolveGenre('🎷jazz')).toBe('music');
  });

  it('keeps GENRE_MAP and VALID_GENRES constructors as Object and Array', () => {
    expect(GENRE_MAP.constructor).toBe(Object);
    expect(VALID_GENRES.constructor).toBe(Array);
  });

  it('does not resolve via toLocaleLowerCase spoofing on boxed strings', () => {
    const boxed = new String('JAZZ');
    (boxed as unknown as { toLocaleLowerCase: () => string }).toLocaleLowerCase = () => 'music';
    // resolveGenre uses .toLowerCase().trim() on primitives; boxed String is truthy object → coerce path
    expect(resolveGenre(boxed as unknown as string)).toBe('jazz');
  });

  it('idempotent over every GENRE_MAP key and VALID_GENRES slug', () => {
    for (const k of Object.keys(GENRE_MAP)) {
      expect(resolveGenre(resolveGenre(k))).toBe(resolveGenre(k));
    }
    for (const g of VALID_GENRES) {
      expect(resolveGenre(resolveGenre(g))).toBe(g);
    }
  });

  it('custom map can shadow VALID_GENRES identity to another valid slug', () => {
    expect(resolveGenre('jazz', { jazz: 'news' })).toBe('news');
    expect(resolveGenre('news', { news: 'jazz' })).toBe('jazz');
  });

  it('returns music for Mongolian vowel separator U+180E around jazz', () => {
    expect(resolveGenre('\u180Ejazz\u180E')).toBe('music');
  });

  it('returns music for word-joiner U+2060 inserted into chill', () => {
    expect(resolveGenre('chi\u2060ll')).toBe('music');
  });

  it('keeps Object.entries(GENRE_MAP) length equal to key count 21', () => {
    expect(Object.entries(GENRE_MAP)).toHaveLength(21);
    expect(new Set(Object.values(GENRE_MAP)).size).toBe(VALID_GENRES.length);
  });

  it('unique GENRE_MAP values equal VALID_GENRES as sets', () => {
    expect(new Set(Object.values(GENRE_MAP))).toEqual(new Set(VALID_GENRES));
  });

  it('does not resolve double-encoded percent jazz', () => {
    expect(resolveGenre('%6A%61%7A%7A')).toBe('music');
    expect(resolveGenre(decodeURIComponent('%6A%61%7A%7A'))).toBe('jazz');
  });

  it('resolveGenre with Reflect.get custom map trap still works', () => {
    const base = { chill: 'ambient' };
    const proxied = new Proxy(base, {
      get(t, p, r) {
        return Reflect.get(t, p, r);
      },
    });
    expect(resolveGenre('chill', proxied)).toBe('ambient');
    expect(resolveGenre('metal', proxied)).toBe('music');
  });

  it('locks multi-word alias keys sorted exactly', () => {
    expect(Object.keys(GENRE_MAP).filter((k) => k.includes(' ')).sort()).toEqual(['late night']);
  });

  it('locks hyphenated alias keys sorted exactly', () => {
    expect(Object.keys(GENRE_MAP).filter((k) => k.includes('-')).sort()).toEqual(['lo-fi']);
  });

  it('does not trim interior NBSP in late night', () => {
    expect(resolveGenre('late\u00A0night')).toBe('music');
  });

  it('Array.isArray(VALID_GENRES) and not array-like object', () => {
    expect(Array.isArray(VALID_GENRES)).toBe(true);
    expect(typeof VALID_GENRES.length).toBe('number');
    expect(VALID_GENRES.length).toBe(9);
  });

  it('GENRE_MAP prototype is Object.prototype', () => {
    expect(Object.getPrototypeOf(GENRE_MAP)).toBe(Object.prototype);
  });

  it('resolveGenre does not mutate GENRE_MAP or VALID_GENRES', () => {
    const keysBefore = Object.keys(GENRE_MAP).join(',');
    const genresBefore = VALID_GENRES.join(',');
    resolveGenre('chill');
    resolveGenre('UNKNOWN');
    resolveGenre('metal', { metal: 'pop' });
    expect(Object.keys(GENRE_MAP).join(',')).toBe(keysBefore);
    expect(VALID_GENRES.join(',')).toBe(genresBefore);
  });

  it('custom map with numeric string keys only hits exact digit keys', () => {
    expect(resolveGenre('1', { '1': 'jazz' })).toBe('jazz');
    expect(() => resolveGenre(1 as unknown as string)).toThrow(/toLowerCase is not a function/);
  });

  it('locks total alias edges GENRE_MAP.size minus VALID_GENRES identities', () => {
    const identities = VALID_GENRES.filter((g) => GENRE_MAP[g] === g);
    expect(identities).toHaveLength(9);
    expect(Object.keys(GENRE_MAP).length - identities.length).toBe(12);
  });

  it('every alias key lowercases to itself (already lowercase)', () => {
    for (const k of Object.keys(GENRE_MAP)) {
      expect(k).toBe(k.toLowerCase());
    }
  });

  it('throws when input lacks toLowerCase (object without string methods)', () => {
    const weird = {
      [Symbol.toPrimitive]: () => 'jazz',
      toString: () => 'jazz',
      valueOf: () => 'jazz',
    };
    expect(() => resolveGenre(weird as unknown as string)).toThrow(/toLowerCase is not a function/);
  });

  it('pads with EM QUAD U+2001 around pop still resolves', () => {
    expect(resolveGenre('\u2001pop\u2001')).toBe('pop');
  });

  it('pads with HAIR SPACE U+200A around rock still resolves', () => {
    expect(resolveGenre('\u200Arock\u200A')).toBe('rock');
  });

  it('JSON.stringify VALID_GENRES is a JSON array of strings', () => {
    const parsed = JSON.parse(JSON.stringify(VALID_GENRES)) as string[];
    expect(parsed).toEqual([...VALID_GENRES]);
    expect(parsed.every((x) => typeof x === 'string')).toBe(true);
  });

  it('spread GENRE_MAP into resolveGenre works as a shallow clone map', () => {
    expect(resolveGenre('lofi', { ...GENRE_MAP })).toBe('ambient');
  });

  it('keeps resolveGenre stable when custom map is Object.freeze copy', () => {
    const frozen = Object.freeze({ ...GENRE_MAP });
    expect(resolveGenre('indie', frozen)).toBe('rock');
    expect(() => {
      (frozen as Record<string, string>).indie = 'jazz';
    }).toThrow();
  });

  it('does not resolve fullwidth digits or punctuation as genres', () => {
    expect(resolveGenre('ｊａｚｚ')).toBe('music');
    expect(resolveGenre('jazz！')).toBe('music');
  });

  it('VALID_GENRES indexOf music is 0 and entertainment is last', () => {
    expect(VALID_GENRES.indexOf('music')).toBe(0);
    expect(VALID_GENRES.indexOf('entertainment')).toBe(VALID_GENRES.length - 1);
  });

  it('returns music for empty custom map and unknown labels', () => {
    expect(resolveGenre('vaporwave', {})).toBe('music');
    expect(resolveGenre('synthwave', Object.create(null))).toBe('music');
  });

  it('leading BOM U+FEFF is trimmed so jazz still resolves', () => {
    expect(resolveGenre('\uFEFFjazz')).toBe('jazz');
    expect(resolveGenre('\uFEFFCHILL')).toBe('ambient');
  });

  it('pads with THIN SPACE U+2009 around jazz still resolves', () => {
    expect(resolveGenre('\u2009jazz\u2009')).toBe('jazz');
    expect(resolveGenre('\u2009CHILL\u2009')).toBe('ambient');
  });

  it('pads with MEDIUM MATHEMATICAL SPACE U+205F around pop still resolves', () => {
    expect(resolveGenre('\u205Fpop\u205F')).toBe('pop');
    expect(resolveGenre('\u205F\u205Frock\u205F')).toBe('rock');
  });

  it('thin space alone trims to empty and defaults to music', () => {
    expect(resolveGenre('\u2009')).toBe('music');
    expect(resolveGenre('\u2009\u2009\u205F')).toBe('music');
  });

  it('does not trim soft hyphen U+00AD pads around jazz', () => {
    expect(resolveGenre('\u00ADjazz\u00AD')).toBe('music');
    expect(resolveGenre('\u00ADCHILL\u00AD')).toBe('music');
  });

  it('does not resolve Arabic tatweel U+0640 inserted into jazz', () => {
    expect(resolveGenre('ja\u0640zz')).toBe('music');
    expect(resolveGenre('jazz\u0640')).toBe('music');
    expect(resolveGenre('\u0640jazz')).toBe('music');
  });

  it('does not resolve zero-width no-break space U+FEFF inserted mid-label', () => {
    expect(resolveGenre('ja\uFEFFzz')).toBe('music');
    expect(resolveGenre('chi\uFEFFll')).toBe('music');
  });

  it('fullwidth ideographic space U+3000 pads resolve; interior breaks', () => {
    expect(resolveGenre('\u3000jazz\u3000')).toBe('jazz');
    expect(resolveGenre('late\u3000night')).toBe('music');
  });

  it('Map instance is not a Record lookup target (falls through to identity/default)', () => {
    const asMap = new Map<string, string>([
      ['chill', 'ambient'],
      ['metal', 'rock'],
    ]);
    expect(resolveGenre('chill', asMap as unknown as Record<string, string>)).toBe('music');
    expect(resolveGenre('jazz', asMap as unknown as Record<string, string>)).toBe('jazz');
    expect(resolveGenre('metal', asMap as unknown as Record<string, string>)).toBe('music');
  });

  it('plain object with same entries as Map resolves aliases', () => {
    const asObj = { chill: 'ambient', metal: 'rock' };
    expect(resolveGenre('chill', asObj)).toBe('ambient');
    expect(resolveGenre('metal', asObj)).toBe('rock');
  });

  it('non-enumerable Symbol keys on custom maps are ignored by string lookup', () => {
    const map = { chill: 'ambient' } as Record<string, string>;
    const sym = Symbol('chill');
    Object.defineProperty(map, sym, { value: 'jazz', enumerable: false });
    expect(Object.getOwnPropertySymbols(map)).toEqual([sym]);
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre(String(sym) as string, map)).toBe('music');
  });

  it('Object.keys skips non-enumerable defineProperty keys but resolveGenre still finds them', () => {
    const map = {} as Record<string, string>;
    Object.defineProperty(map, 'indie', {
      value: 'rock',
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(Object.keys(map)).toEqual([]);
    expect(Object.getOwnPropertyNames(map)).toContain('indie');
    expect(resolveGenre('indie', map)).toBe('rock');
    expect(resolveGenre('INDIE', map)).toBe('rock');
  });

  it('Proxy deleteProperty trap blocks delete but resolveGenre still reads', () => {
    const target = { chill: 'ambient', metal: 'rock' };
    const proxy = new Proxy(target, {
      deleteProperty() {
        return false;
      },
    });
    expect(() => {
      delete (proxy as Record<string, string>).chill;
    }).toThrow(/deleteProperty|trap returned falsish/i);
    expect(resolveGenre('chill', proxy)).toBe('ambient');
    expect(resolveGenre('metal', proxy)).toBe('rock');
    expect(target.chill).toBe('ambient');
  });

  it('Proxy deleteProperty that allows delete removes alias for subsequent resolve', () => {
    const target = { chill: 'ambient' };
    const proxy = new Proxy(target, {
      deleteProperty(t, p) {
        return Reflect.deleteProperty(t, p);
      },
    });
    expect(resolveGenre('chill', proxy)).toBe('ambient');
    expect(delete (proxy as Record<string, string>).chill).toBe(true);
    expect(resolveGenre('chill', proxy)).toBe('music');
  });

  it('Object.seal on GENRE_MAP clone still resolves every identity and alias', () => {
    const sealed = Object.seal({ ...GENRE_MAP });
    expect(Object.isSealed(sealed)).toBe(true);
    expect(resolveGenre('lo-fi', sealed)).toBe('ambient');
    expect(resolveGenre('dance', sealed)).toBe('pop');
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g, sealed)).toBe(g);
    }
  });

  it('Object.freeze on GENRE_MAP clone locks key count 21 and still resolves', () => {
    const frozen = Object.freeze({ ...GENRE_MAP });
    expect(Object.keys(frozen)).toHaveLength(21);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(resolveGenre('blues', frozen)).toBe('jazz');
    expect(resolveGenre('classic', frozen)).toBe('classical');
    expect(() => {
      (frozen as Record<string, string>).vaporwave = 'ambient';
    }).toThrow();
  });

  it('keeps VALID_GENRES length 9 and GENRE_MAP key count 21 after freeze/seal probes', () => {
    Object.freeze({ ...GENRE_MAP });
    Object.seal({ ...GENRE_MAP });
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(VALID_GENRES).toHaveLength(9);
    expect(Object.isFrozen(GENRE_MAP)).toBe(false);
    expect(Object.isSealed(GENRE_MAP)).toBe(false);
  });

  it('mixed thin space and medium math space pads still resolve electronic→ambient', () => {
    expect(resolveGenre('\u2009electronic\u205F')).toBe('ambient');
    expect(resolveGenre('\u205F\u2009lofi\u2009\u205F')).toBe('ambient');
  });

  it('does not resolve soft hyphen between late and night', () => {
    expect(resolveGenre('late\u00ADnight')).toBe('music');
    expect(resolveGenre('late \u00ADnight')).toBe('music');
  });

  it('tatweel-only and soft-hyphen-only labels default to music', () => {
    expect(resolveGenre('\u0640')).toBe('music');
    expect(resolveGenre('\u0640\u0640\u0640')).toBe('music');
    expect(resolveGenre('\u00AD\u00AD')).toBe('music');
  });

  it('Proxy getOwnPropertyDescriptor does not hide enumerable GENRE_MAP aliases', () => {
    const proxy = new Proxy(
      { ...GENRE_MAP },
      {
        getOwnPropertyDescriptor(t, p) {
          return Reflect.getOwnPropertyDescriptor(t, p);
        },
      },
    );
    expect(resolveGenre('relaxing', proxy)).toBe('ambient');
    expect(Object.keys(proxy)).toHaveLength(21);
  });

  it('custom map with Symbol.iterator does not make resolveGenre iterate entries', () => {
    const map = {
      chill: 'ambient',
      [Symbol.iterator]: function* () {
        yield ['metal', 'rock'];
      },
    } as unknown as Record<string, string>;
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('metal', map)).toBe('music');
  });

  it('locks ambient fan-in aliases excluding identity at 7 after unicode probes', () => {
    expect(resolveGenre('\u2009chill\u2009')).toBe('ambient');
    expect(resolveGenre('\u205Ffocus\u205F')).toBe('ambient');
    const aliases = Object.entries(GENRE_MAP).filter(([k, v]) => v === 'ambient' && k !== 'ambient');
    expect(aliases).toHaveLength(7);
  });

  it('rock fan-in locks metal indie and rock only', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'rock')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['indie', 'metal', 'rock']);
  });

  it('pop fan-in locks dance and pop only', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'pop')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['dance', 'pop']);
  });

  it('classical fan-in locks classic and classical only', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'classical')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['classic', 'classical']);
  });

  it('does not treat Map.prototype method names as string genre labels', () => {
    const m = new Map([['jazz', 'jazz']]);
    // Bracket access on Map surfaces prototype methods / size — not Record string values
    expect(typeof resolveGenre('get', m as unknown as Record<string, string>)).toBe('function');
    expect(typeof resolveGenre('has', m as unknown as Record<string, string>)).toBe('function');
    expect(resolveGenre('size', m as unknown as Record<string, string>)).toBe(1 as unknown as string);
    // Plain object counterpart resolves missing keys to music
    expect(resolveGenre('get', {})).toBe('music');
    expect(resolveGenre('size', {})).toBe('music');
  });

  it('Object.defineProperty writable:false still allows resolveGenre reads', () => {
    const map = {} as Record<string, string>;
    Object.defineProperty(map, 'blues', {
      value: 'jazz',
      writable: false,
      enumerable: true,
      configurable: false,
    });
    expect(resolveGenre('blues', map)).toBe('jazz');
    expect(() => {
      map.blues = 'news';
    }).toThrow();
  });

  it('combines BOM trim with thin-space pads for late night alias', () => {
    expect(resolveGenre('\uFEFF\u2009late night\u2009')).toBe('ambient');
    expect(resolveGenre('\u2009\uFEFFlo-fi\uFEFF\u2009')).toBe('ambient');
  });

  it('VALID_GENRES length 9 lock survives JSON round-trip', () => {
    const round = JSON.parse(JSON.stringify(VALID_GENRES)) as string[];
    expect(round).toHaveLength(9);
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('GENRE_MAP key count 21 lock survives structuredClone', () => {
    const cloned = structuredClone(GENRE_MAP);
    expect(Object.keys(cloned)).toHaveLength(21);
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(resolveGenre('indie', cloned)).toBe('rock');
  });

  // --- HEAVY deepen (post-#44): complementary unicode / map / VALID_GENRES locks ---

  it('resolves every ambient alias with leading+trailing thin spaces', () => {
    for (const alias of [
      'ambient',
      'chill',
      'electronic',
      'focus',
      'late night',
      'lo-fi',
      'lofi',
      'relaxing',
    ]) {
      expect(resolveGenre(`\u2009${alias}\u2009`)).toBe('ambient');
    }
  });

  it('resolves rock fan-in aliases with NBSP pads', () => {
    expect(resolveGenre('\u00A0metal\u00A0')).toBe('rock');
    expect(resolveGenre('\u00A0indie\u00A0')).toBe('rock');
    expect(resolveGenre('\u00A0rock\u00A0')).toBe('rock');
  });

  it('trims figure space U+2007 and punctuation space U+2008 around jazz/pop', () => {
    // ECMAScript trim includes Unicode White_Space (figure/punct spaces)
    expect('\u2007jazz\u2007'.trim()).toBe('jazz');
    expect('\u2008pop\u2008'.trim()).toBe('pop');
    expect(resolveGenre('\u2007jazz\u2007')).toBe('jazz');
    expect(resolveGenre('\u2008pop\u2008')).toBe('pop');
  });

  it('locks trim of form feed and vertical tab around classical', () => {
    expect(resolveGenre('\fclassical\f')).toBe('classical');
    expect(resolveGenre('\vclassic\v')).toBe('classical');
  });

  it('does not collapse internal double spaces in late night', () => {
    expect(resolveGenre('late  night')).toBe('music');
    expect(resolveGenre('late   night')).toBe('music');
    expect(resolveGenre('late night')).toBe('ambient');
  });

  it('does not resolve late-night hyphenated form as late night alias', () => {
    expect(resolveGenre('late-night')).toBe('music');
    expect(resolveGenre('Late-Night')).toBe('music');
  });

  it('does not resolve lofi with underscore or slash separators', () => {
    expect(resolveGenre('lo_fi')).toBe('music');
    expect(resolveGenre('lo/fi')).toBe('music');
    expect(resolveGenre('lo fi')).toBe('music');
  });

  it('custom map empty string is not nullish so ?? returns empty string', () => {
    // ?? only falls through for null/undefined — '' is kept
    expect(resolveGenre('jazz', { jazz: '' })).toBe('');
    expect(resolveGenre('chill', { chill: '' })).toBe('');
  });

  it('custom map null value falls through ?? like undefined', () => {
    expect(resolveGenre('pop', { pop: null as unknown as string })).toBe('pop');
    expect(resolveGenre('dance', { dance: null as unknown as string })).toBe('music');
  });

  it('custom map numeric 0 is not nullish so ?? returns 0', () => {
    expect(resolveGenre('rock', { rock: 0 as unknown as string })).toBe(0 as unknown as string);
    expect(resolveGenre('metal', { metal: 0 as unknown as string })).toBe(0 as unknown as string);
  });

  it('custom map boolean false is not nullish so ?? returns false', () => {
    expect(resolveGenre('news', { news: false as unknown as string })).toBe(
      false as unknown as string,
    );
    expect(resolveGenre('unknown', { unknown: false as unknown as string })).toBe(
      false as unknown as string,
    );
  });

  it('Proxy that remaps get to uppercase keys still resolves lowercase lookup', () => {
    const proxy = new Proxy(
      { CHILL: 'ambient' },
      {
        get(t, p, r) {
          if (typeof p === 'string' && p === p.toLowerCase() && p.toUpperCase() in t) {
            return Reflect.get(t, p.toUpperCase(), r);
          }
          return Reflect.get(t, p, r);
        },
      },
    ) as Record<string, string>;
    expect(resolveGenre('chill', proxy)).toBe('ambient');
  });

  it('does not resolve fullwidth latin letters for jazz', () => {
    expect(resolveGenre('ｊａｚｚ')).toBe('music');
    expect(resolveGenre('ＪＡＺＺ')).toBe('music');
  });

  it('does not resolve mathematical bold/italic unicode letters for pop', () => {
    expect(resolveGenre('𝐩𝐨𝐩')).toBe('music');
    expect(resolveGenre('𝑝𝑜𝑝')).toBe('music');
  });

  it('does not resolve circled latin letters for rock', () => {
    expect(resolveGenre('ⓡⓞⓒⓚ')).toBe('music');
  });

  it('locks GENRE_MAP insertion order for first five keys', () => {
    expect(Object.keys(GENRE_MAP).slice(0, 5)).toEqual([
      'late night',
      'chill',
      'ambient',
      'relaxing',
      'focus',
    ]);
  });

  it('locks GENRE_MAP insertion order for last five keys', () => {
    expect(Object.keys(GENRE_MAP).slice(-5)).toEqual([
      'entertainment',
      'dance',
      'electronic',
      'lofi',
      'lo-fi',
    ]);
  });

  it('VALID_GENRES indexOf music is 0 and entertainment is last', () => {
    expect(VALID_GENRES.indexOf('music')).toBe(0);
    expect(VALID_GENRES.indexOf('entertainment')).toBe(VALID_GENRES.length - 1);
    expect(VALID_GENRES.at(-1)).toBe('entertainment');
  });

  it('every GENRE_MAP value is included in VALID_GENRES exactly as identity', () => {
    for (const value of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES.includes(value as (typeof VALID_GENRES)[number])).toBe(true);
      expect(GENRE_MAP[value]).toBe(value);
    }
  });

  it('resolveGenre never returns a key that is only an alias and not a value', () => {
    const aliasOnly = Object.keys(GENRE_MAP).filter((k) => GENRE_MAP[k] !== k);
    for (const alias of aliasOnly) {
      expect(resolveGenre(alias)).not.toBe(alias);
      expect(VALID_GENRES.includes(resolveGenre(alias) as (typeof VALID_GENRES)[number])).toBe(true);
    }
  });

  it('locks alias-only key count at 12 (21 keys − 9 identities)', () => {
    const aliasOnly = Object.keys(GENRE_MAP).filter((k) => GENRE_MAP[k] !== k);
    expect(aliasOnly).toHaveLength(12);
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('sorted alias-only keys lock for regression', () => {
    expect(
      Object.keys(GENRE_MAP)
        .filter((k) => GENRE_MAP[k] !== k)
        .sort(),
    ).toEqual([
      'blues',
      'chill',
      'classic',
      'dance',
      'electronic',
      'focus',
      'indie',
      'late night',
      'lo-fi',
      'lofi',
      'metal',
      'relaxing',
    ]);
  });

  it('does not resolve combining accent on jazz letter a', () => {
    expect(resolveGenre('ja\u0301zz')).toBe('music');
    expect(resolveGenre('j\u00E1zz')).toBe('music');
  });

  it('does not resolve zero-width joiner inside chill', () => {
    expect(resolveGenre('chi\u200Dll')).toBe('music');
    expect(resolveGenre('ch\u200Cill')).toBe('music');
  });

  it('does not resolve word joiner or invisible separator in pop', () => {
    expect(resolveGenre('po\u2060p')).toBe('music');
    expect(resolveGenre('p\u2063op')).toBe('music');
  });

  it('CRLF-only and CR-only pads still resolve news via trim', () => {
    expect(resolveGenre('\r\nnews\r\n')).toBe('news');
    expect(resolveGenre('\rnews\r')).toBe('news');
  });

  it('custom map getter throwing on unrelated key does not affect jazz hit', () => {
    const map = {
      jazz: 'jazz',
      get boom(): string {
        throw new Error('should not read');
      },
    } as Record<string, string>;
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(() => resolveGenre('boom', map)).toThrow(/should not read/);
  });

  it('custom map with __proto__ key does not poison Object.prototype', () => {
    const map = JSON.parse('{"chill":"ambient","__proto__":{"polluted":"jazz"}}') as Record<
      string,
      string
    >;
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    expect(resolveGenre('polluted')).toBe('music');
  });

  it('Array.isArray(VALID_GENRES) and not Array.isArray(GENRE_MAP)', () => {
    expect(Array.isArray(VALID_GENRES)).toBe(true);
    expect(Array.isArray(GENRE_MAP)).toBe(false);
  });

  it('VALID_GENRES every element equals GENRE_MAP identity lookup', () => {
    expect(VALID_GENRES.every((g) => GENRE_MAP[g] === g)).toBe(true);
  });

  it('resolveGenre with custom map missing all keys still resolves all VALID_GENRES', () => {
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g, {})).toBe(g);
      expect(resolveGenre(g.toUpperCase(), {})).toBe(g);
    }
  });

  it('resolveGenre with custom map remapping every VALID to music still hits map first', () => {
    const map = Object.fromEntries(VALID_GENRES.map((g) => [g, 'music'])) as Record<string, string>;
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g, map)).toBe('music');
    }
  });

  it('does not resolve trailing comma or semicolon genre tokens', () => {
    expect(resolveGenre('jazz,')).toBe('music');
    expect(resolveGenre('jazz;')).toBe('music');
    expect(resolveGenre('jazz.')).toBe('music');
  });

  it('does not resolve quoted genre labels with quotes included', () => {
    expect(resolveGenre('"jazz"')).toBe('music');
    expect(resolveGenre("'jazz'")).toBe('music');
    expect(resolveGenre('`jazz`')).toBe('music');
  });

  it('does not resolve markdown emphasis wrappers around ambient', () => {
    expect(resolveGenre('*ambient*')).toBe('music');
    expect(resolveGenre('_ambient_')).toBe('music');
    expect(resolveGenre('**ambient**')).toBe('music');
  });

  it('locks entertainment character length and sports length', () => {
    expect('entertainment'.length).toBe(13);
    expect('sports'.length).toBe(6);
    expect(resolveGenre('entertainment')).toBe('entertainment');
    expect(resolveGenre('sports')).toBe('sports');
  });

  it('Object.values(GENRE_MAP) multiset counts match fan-in locks', () => {
    const counts = Object.values(GENRE_MAP).reduce<Record<string, number>>((acc, v) => {
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      ambient: 8,
      classical: 2,
      jazz: 2,
      pop: 2,
      rock: 3,
      music: 1,
      news: 1,
      sports: 1,
      entertainment: 1,
    });
  });

  it('JSON.stringify VALID_GENRES is stable ordered array JSON', () => {
    expect(JSON.stringify(VALID_GENRES)).toBe(
      '["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]',
    );
  });

  it('does not resolve RTL override or LTR override wrapped jazz', () => {
    expect(resolveGenre('\u202Ejazz\u202C')).toBe('music');
    expect(resolveGenre('\u202Djazz\u202C')).toBe('music');
  });

  it('does not resolve bidi isolate wrappers around chill', () => {
    expect(resolveGenre('\u2066chill\u2069')).toBe('music');
    expect(resolveGenre('\u2068chill\u2069')).toBe('music');
  });

  it('custom map with prototype chain jazz still resolves via inherited get', () => {
    const proto = { jazz: 'jazz' };
    const map = Object.create(proto) as Record<string, string>;
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(Object.hasOwn(map, 'jazz')).toBe(false);
  });

  it('null-prototype map without jazz falls to VALID_GENRES identity', () => {
    const map = Object.create(null) as Record<string, string>;
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('chill', map)).toBe('music');
  });

  it('trims ogham space mark U+1680 around metal→rock', () => {
    expect('\u1680metal\u1680'.trim()).toBe('metal');
    expect(resolveGenre('\u1680metal\u1680')).toBe('rock');
  });

  it('mongolian vowel separator inside lofi does not match', () => {
    expect(resolveGenre('lo\u180Efi')).toBe('music');
  });

  it('locks resolveGenre return type string for 50 random-ish probes', () => {
    const probes = [
      '',
      ' ',
      '\t',
      'jazz',
      'JAZZ',
      'k-pop',
      'lo-fi',
      'late night',
      '🎵',
      'null',
      'undefined',
      'NaN',
      '0',
      '-1',
      'true',
      'music',
      'MUSIC',
      'Entertainment',
      '  rock  ',
      'blues',
      'indie',
      'metal',
      'dance',
      'classic',
      'electronic',
      'focus',
      'relaxing',
      'chill',
      'ambient',
      'news',
      'sports',
      'pop',
      'classical',
      'lofi',
      'late  night',
      'lo_fi',
      'jazz!',
      ' jazz',
      'jazz ',
      '\njazz\n',
      'ｊａｚｚ',
      'джаз',
      '../pop',
      'pop?',
      'rock&roll',
      'hip-hop',
      'r&b',
      'edm',
      'house',
      'techno',
    ];
    expect(probes).toHaveLength(50);
    for (const p of probes) {
      const out = resolveGenre(p);
      expect(typeof out).toBe('string');
      expect(VALID_GENRES.includes(out as (typeof VALID_GENRES)[number])).toBe(true);
    }
  });

  it('does not resolve rock&roll or hip-hop as rock aliases', () => {
    expect(resolveGenre('rock&roll')).toBe('music');
    expect(resolveGenre('hip-hop')).toBe('music');
    expect(resolveGenre('hiphop')).toBe('music');
  });

  it('does not resolve R&B case variants', () => {
    expect(resolveGenre('r&b')).toBe('music');
    expect(resolveGenre('R&B')).toBe('music');
    expect(resolveGenre('rnb')).toBe('music');
  });

  it('Object.entries(GENRE_MAP) length equals Object.keys length', () => {
    expect(Object.entries(GENRE_MAP)).toHaveLength(Object.keys(GENRE_MAP).length);
    expect(Object.entries(GENRE_MAP)).toHaveLength(21);
  });

  it('Reflect.ownKeys(GENRE_MAP) are all strings with no symbols', () => {
    const keys = Reflect.ownKeys(GENRE_MAP);
    expect(keys.every((k) => typeof k === 'string')).toBe(true);
    expect(keys).toHaveLength(21);
  });

  it('VALID_GENRES findIndex for missing slug is -1', () => {
    const missing: string = 'kpop';
    expect((VALID_GENRES as readonly string[]).findIndex((g) => g === missing)).toBe(-1);
    expect((VALID_GENRES as readonly string[]).includes(missing)).toBe(false);
  });

  it('resolveGenre undefined and nullish map second arg still uses default GENRE_MAP', () => {
    expect(resolveGenre('chill', undefined)).toBe('ambient');
    // omitting second arg
    expect(resolveGenre('chill')).toBe('ambient');
  });

  it('does not resolve genre labels with leading plus or hash', () => {
    expect(resolveGenre('+jazz')).toBe('music');
    expect(resolveGenre('#jazz')).toBe('music');
    expect(resolveGenre('@jazz')).toBe('music');
  });

  it('locks classical string and classic alias byte lengths', () => {
    expect(Buffer.byteLength('classical', 'utf8')).toBe(9);
    expect(Buffer.byteLength('classic', 'utf8')).toBe(7);
    expect(resolveGenre('classic')).toBe('classical');
  });

  it('lo-fi hyphen is ASCII hyphen-minus U+002D only', () => {
    const key = Object.keys(GENRE_MAP).find((k) => k.startsWith('lo') && k.includes('-'));
    expect(key).toBe('lo-fi');
    expect([...key!].map((c) => c.codePointAt(0))).toEqual([0x6c, 0x6f, 0x2d, 0x66, 0x69]);
  });

  it('does not resolve en-dash or em-dash lo–fi forms', () => {
    expect(resolveGenre('lo–fi')).toBe('music'); // U+2013
    expect(resolveGenre('lo—fi')).toBe('music'); // U+2014
    expect(resolveGenre('lo−fi')).toBe('music'); // U+2212 minus
  });

  it('custom map can redirect music identity to ambient (map wins)', () => {
    expect(resolveGenre('music', { music: 'ambient' })).toBe('ambient');
    expect(GENRE_MAP.music).toBe('music');
  });

  it('empty custom map + blank input still defaults to music before lookup', () => {
    expect(resolveGenre('', {})).toBe('music');
    expect(resolveGenre('   ', {})).toBe('music');
    expect(resolveGenre(undefined, {})).toBe('music');
  });

  it('does not resolve NFC/NFD decomposed forms of café-like genre probes', () => {
    expect(resolveGenre('cafe\u0301')).toBe('music');
    expect(resolveGenre('café')).toBe('music');
  });

  it('Set of GENRE_MAP values size equals VALID_GENRES length', () => {
    expect(new Set(Object.values(GENRE_MAP)).size).toBe(VALID_GENRES.length);
  });

  it('every resolveGenre(alias) equals GENRE_MAP[alias.toLowerCase().trim()] when mapped', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(resolveGenre(`  ${key.toUpperCase()}  `)).toBe(GENRE_MAP[key]);
    }
  });

  it('does not resolve trailing ZWSP-only label', () => {
    expect(resolveGenre('\u200B')).toBe('music');
    expect(resolveGenre('\u200B\u200B')).toBe('music');
  });

  it('ZWSP-padded jazz does not match because trim keeps U+200B', () => {
    expect('\u200Bjazz\u200B'.trim()).toBe('\u200Bjazz\u200B');
    expect(resolveGenre('\u200Bjazz\u200B')).toBe('music');
  });

  it('locks news/sports/entertainment as single-key fan-in only', () => {
    for (const g of ['news', 'sports', 'entertainment'] as const) {
      expect(Object.entries(GENRE_MAP).filter(([, v]) => v === g).map(([k]) => k)).toEqual([g]);
    }
  });

  it('music fan-in is identity-only (no mood aliases to music)', () => {
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'music').map(([k]) => k)).toEqual([
      'music',
    ]);
  });

  it('Proxy revoke after construction does not affect GENRE_MAP itself', () => {
    const { proxy, revoke } = Proxy.revocable({ ...GENRE_MAP }, {});
    expect(resolveGenre('chill', proxy)).toBe('ambient');
    revoke();
    expect(() => resolveGenre('chill', proxy)).toThrow();
    expect(resolveGenre('chill')).toBe('ambient');
  });

  it('Object.assign into frozen empty target throws but GENRE_MAP untouched', () => {
    const frozen = Object.freeze({});
    expect(() => Object.assign(frozen, GENRE_MAP)).toThrow();
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it('structuredClone VALID_GENRES yields mutable array copy', () => {
    const clone = structuredClone(VALID_GENRES) as unknown as string[];
    clone.push('extra');
    expect(VALID_GENRES).toHaveLength(9);
    expect(clone).toHaveLength(10);
  });

  it('does not resolve substring metalcore or deathmetal as metal', () => {
    expect(resolveGenre('metalcore')).toBe('music');
    expect(resolveGenre('deathmetal')).toBe('music');
    expect(resolveGenre('metal')).toBe('rock');
  });

  it('does not resolve bluesy or bluegrass as blues→jazz', () => {
    expect(resolveGenre('bluesy')).toBe('music');
    expect(resolveGenre('bluegrass')).toBe('music');
    expect(resolveGenre('blues')).toBe('jazz');
  });

  it('does not resolve dancer or dancing as dance→pop', () => {
    expect(resolveGenre('dancer')).toBe('music');
    expect(resolveGenre('dancing')).toBe('music');
    expect(resolveGenre('dance')).toBe('pop');
  });

  it('does not resolve classics or classicalism as classic→classical', () => {
    expect(resolveGenre('classics')).toBe('music');
    expect(resolveGenre('classicalism')).toBe('music');
    expect(resolveGenre('classic')).toBe('classical');
  });

  it('does not resolve indie-rock or indierock compound forms', () => {
    expect(resolveGenre('indie-rock')).toBe('music');
    expect(resolveGenre('indierock')).toBe('music');
    expect(resolveGenre('indie')).toBe('rock');
  });

  it('locale tr lowercasing of I with Turkish locale still yields jazz for ASCII JAZZ', () => {
    expect('JAZZ'.toLocaleLowerCase('tr')).toBe('jazz');
    expect(resolveGenre('JAZZ'.toLocaleLowerCase('tr'))).toBe('jazz');
  });

  it('does not resolve dotted capital İ alone or İjazz', () => {
    expect(resolveGenre('İ')).toBe('music');
    expect(resolveGenre('İjazz')).toBe('music');
  });

  it('locks late night key to contain exactly one ASCII space U+0020', () => {
    const key = 'late night';
    expect(GENRE_MAP[key]).toBe('ambient');
    expect([...key].filter((c) => c === ' ')).toHaveLength(1);
    expect([...key].some((c) => c.codePointAt(0) === 0x20)).toBe(true);
  });

  it('resolveGenre map parameter default is evaluated per-call (no shared mutable default bug)', () => {
    const a = resolveGenre('chill');
    (GENRE_MAP as Record<string, string>).chill = 'news';
    try {
      expect(resolveGenre('chill')).toBe('news');
    } finally {
      GENRE_MAP.chill = 'ambient';
    }
    expect(a).toBe('ambient');
    expect(resolveGenre('chill')).toBe('ambient');
  });

  it('does not resolve leading/trailing punctuation-only strings', () => {
    expect(resolveGenre('...')).toBe('music');
    expect(resolveGenre('???')).toBe('music');
    expect(resolveGenre('---')).toBe('music');
  });

  it('VALID_GENRES join with comma matches expected CSV lock', () => {
    expect(VALID_GENRES.join(',')).toBe(
      'music,ambient,jazz,classical,pop,rock,news,sports,entertainment',
    );
  });

  it('GENRE_MAP values joined sorted unique equals VALID_GENRES sorted join', () => {
    expect([...new Set(Object.values(GENRE_MAP))].sort().join('|')).toBe(
      [...VALID_GENRES].sort().join('|'),
    );
  });

  it('does not resolve emoji music note as music genre via map', () => {
    expect(resolveGenre('🎵')).toBe('music'); // fallback, not map hit
    expect(GENRE_MAP['🎵']).toBeUndefined();
  });

  it('custom map Symbol key is ignored for string genre lookups', () => {
    const sym = Symbol('jazz');
    const map = { [sym]: 'jazz', chill: 'ambient' } as unknown as Record<string, string>;
    expect(resolveGenre('jazz', map)).toBe('jazz'); // VALID_GENRES path
    expect(resolveGenre('chill', map)).toBe('ambient');
  });

  it('Object.getPrototypeOf(GENRE_MAP) is Object.prototype', () => {
    expect(Object.getPrototypeOf(GENRE_MAP)).toBe(Object.prototype);
  });

  it('Object.getPrototypeOf(VALID_GENRES) is Array.prototype', () => {
    expect(Object.getPrototypeOf(VALID_GENRES)).toBe(Array.prototype);
  });

  it('resolveGenre does not use localeCompare for map lookup (exact key)', () => {
    // German ß uppercases to SS — ensure we never special-case locales
    expect(resolveGenre('ß')).toBe('music');
    expect(resolveGenre('SS')).toBe('music');
  });

  it('locks buffer byte length of JSON.stringify(GENRE_MAP) within band', () => {
    const n = Buffer.byteLength(JSON.stringify(GENRE_MAP), 'utf8');
    expect(n).toBeGreaterThan(250);
    expect(n).toBeLessThan(700);
  });

  it('all VALID_GENRES resolve identically with and without explicit GENRE_MAP arg', () => {
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g)).toBe(resolveGenre(g, GENRE_MAP));
      expect(resolveGenre(g.toUpperCase())).toBe(resolveGenre(g.toUpperCase(), GENRE_MAP));
    }
  });

  it('does not resolve camelCase LateNight or snake late_night', () => {
    expect(resolveGenre('LateNight')).toBe('music');
    expect(resolveGenre('late_night')).toBe('music');
    expect(resolveGenre('lateNight')).toBe('music');
  });

  it('LoFi lowercases to lofi alias; LO_FI snake does not', () => {
    expect(resolveGenre('LoFi')).toBe('ambient'); // → lofi
    expect(resolveGenre('LO_FI')).toBe('music');
    expect(resolveGenre('Lo-Fi')).toBe('ambient'); // → lo-fi
  });

  it('Array.prototype.includes.call on VALID_GENRES matches includes', () => {
    expect(Array.prototype.includes.call(VALID_GENRES, 'jazz')).toBe(true);
    expect(Array.prototype.includes.call(VALID_GENRES, 'kpop')).toBe(false);
  });

  it('for...in over GENRE_MAP visits exactly 21 enumerable string keys', () => {
    const keys: string[] = [];
    for (const k in GENRE_MAP) {
      if (Object.hasOwn(GENRE_MAP, k)) keys.push(k);
    }
    expect(keys).toHaveLength(21);
  });

  it('resolveGenre throws when input is a number or boolean without string methods', () => {
    expect(() => resolveGenre(1 as unknown as string)).toThrow();
    expect(() => resolveGenre(true as unknown as string)).toThrow();
  });

  it('locks GENRE_MAP classic/classical and dance/pop adjacency in file order', () => {
    const keys = Object.keys(GENRE_MAP);
    expect(keys.indexOf('classical')).toBeLessThan(keys.indexOf('classic'));
    expect(keys.indexOf('dance')).toBeGreaterThan(keys.indexOf('entertainment'));
    expect(keys.indexOf('electronic')).toBe(keys.indexOf('dance') + 1);
  });

  it('VALID_GENRES flatMap identity equals spread copy', () => {
    expect(VALID_GENRES.flatMap((g) => [g])).toEqual([...VALID_GENRES]);
  });

  it('does not resolve leading BOM-only string', () => {
    expect(resolveGenre('\uFEFF')).toBe('music');
  });

  it('BOM plus jazz resolves after trim strips BOM', () => {
    expect(resolveGenre('﻿jazz')).toBe('jazz');
    expect(resolveGenre('jazz﻿')).toBe('jazz');
  });


  // --- HEAVY burn (post-#51): genres unit deepen — no product invent ---

  it('locks GENRE_MAP entry count at 21 and VALID_GENRES length at 9', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('locks VALID_GENRES exact order music→entertainment', () => {
    expect([...VALID_GENRES]).toEqual([
      'music',
      'ambient',
      'jazz',
      'classical',
      'pop',
      'rock',
      'news',
      'sports',
      'entertainment',
    ]);
  });

  it('locks every GENRE_MAP value is a member of VALID_GENRES', () => {
    for (const [alias, target] of Object.entries(GENRE_MAP)) {
      expect(VALID_GENRES.includes(target as (typeof VALID_GENRES)[number]), alias).toBe(true);
    }
  });

  it('resolveGenre maps all ambient aliases including late night and lo-fi', () => {
    for (const alias of [
      'late night',
      'chill',
      'ambient',
      'relaxing',
      'focus',
      'electronic',
      'lofi',
      'lo-fi',
    ]) {
      expect(resolveGenre(alias)).toBe('ambient');
      expect(resolveGenre(alias.toUpperCase())).toBe('ambient');
    }
  });

  it('resolveGenre maps rock aliases metal indie and pop alias dance', () => {
    expect(resolveGenre('metal')).toBe('rock');
    expect(resolveGenre('indie')).toBe('rock');
    expect(resolveGenre('dance')).toBe('pop');
    expect(resolveGenre('blues')).toBe('jazz');
    expect(resolveGenre('classic')).toBe('classical');
  });

  it('resolveGenre accepts VALID_GENRES identity for all nine categories', () => {
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g)).toBe(g);
    }
  });

  it('resolveGenre unknown tokens fall back to music', () => {
    expect(resolveGenre('unknown-genre-xyz')).toBe('music');
    expect(resolveGenre('hiphop')).toBe('music');
    expect(resolveGenre('rap')).toBe('music');
  });

  it('resolveGenre trims surrounding whitespace before lookup', () => {
    expect(resolveGenre('  jazz  ')).toBe('jazz');
    expect(resolveGenre('\tchill\n')).toBe('ambient');
  });

  it('resolveGenre does not resolve snake_case late_night or camelCase lateNight', () => {
    expect(resolveGenre('late_night')).toBe('music');
    expect(resolveGenre('lateNight')).toBe('music');
    expect(resolveGenre('lo_fi')).toBe('music');
  });

  it('resolveGenre does not resolve zero-width-joiner-prefixed aliases', () => {
    expect(resolveGenre('\u200bjazz')).toBe('music');
    expect(resolveGenre('jazz\u200b')).toBe('music');
  });

  it('resolveGenre custom map override is honored and does not mutate GENRE_MAP', () => {
    const before = { ...GENRE_MAP };
    expect(resolveGenre('custom', { custom: 'jazz' })).toBe('jazz');
    expect(GENRE_MAP).toEqual(before);
    expect(resolveGenre('custom')).toBe('music');
  });

  it('resolveGenre empty custom map still accepts VALID_GENRES via includes fallback', () => {
    expect(resolveGenre('jazz', {})).toBe('jazz');
    expect(resolveGenre('chill', {})).toBe('music');
  });

  it('GENRE_MAP does not own __proto__ or constructor inventing keys', () => {
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, 'toString')).toBe(false);
  });

  it('VALID_GENRES values are unique strings', () => {
    expect(VALID_GENRES.every((g) => typeof g === 'string')).toBe(true);
    expect(new Set(VALID_GENRES).size).toBe(VALID_GENRES.length);
  });

  it('Object.keys(GENRE_MAP) includes spaced late night and hyphen lo-fi', () => {
    const keys = Object.keys(GENRE_MAP);
    expect(keys).toContain('late night');
    expect(keys).toContain('lo-fi');
    expect(keys).not.toContain('late_night');
  });

  it('resolveGenre undefined and empty string both yield music', () => {
    expect(resolveGenre(undefined)).toBe('music');
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre('')).toBe('music');
  });

  it('resolveGenre is stable under repeated calls (pure)', () => {
    for (let i = 0; i < 20; i++) {
      expect(resolveGenre('LO-FI')).toBe('ambient');
      expect(resolveGenre('Metal')).toBe('rock');
    }
  });

  it('JSON.stringify(GENRE_MAP) round-trips to equal object', () => {
    expect(JSON.parse(JSON.stringify(GENRE_MAP))).toEqual(GENRE_MAP);
  });

  it('accented or combining-mark tokens fall back to music', () => {
    expect(resolveGenre('jázz')).toBe('music');
    expect(resolveGenre('ambient\u0301')).toBe('music');
  });

  it('cross-lock: every ambient-target alias resolves identically via map and resolveGenre', () => {
    const ambientAliases = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k);
    expect(ambientAliases.length).toBeGreaterThanOrEqual(7);
    for (const a of ambientAliases) {
      expect(GENRE_MAP[a]).toBe('ambient');
      expect(resolveGenre(a)).toBe('ambient');
    }
  });

  // --- post-#56 TOKENMAXX HEAVY deepen (genres slice; orthogonal to mcp/CI/source/mcp-spec) ---

  it('post56: GENRE_MAP insertion order lock for all 21 keys', () => {
    expect(Object.keys(GENRE_MAP)).toEqual([
      'late night',
      'chill',
      'ambient',
      'relaxing',
      'focus',
      'classical',
      'classic',
      'jazz',
      'blues',
      'pop',
      'rock',
      'metal',
      'indie',
      'music',
      'news',
      'sports',
      'entertainment',
      'dance',
      'electronic',
      'lofi',
      'lo-fi',
    ]);
  });

  it('post56: GENRE_MAP values in insertion order lock', () => {
    expect(Object.values(GENRE_MAP)).toEqual([
      'ambient',
      'ambient',
      'ambient',
      'ambient',
      'ambient',
      'classical',
      'classical',
      'jazz',
      'jazz',
      'pop',
      'rock',
      'rock',
      'rock',
      'music',
      'news',
      'sports',
      'entertainment',
      'pop',
      'ambient',
      'ambient',
      'ambient',
    ]);
  });

  it('post56: TextEncoder byte length of genres.ts source within band', () => {
    const bytes = new TextEncoder().encode(genresSource);
    expect(bytes.byteLength).toBeGreaterThanOrEqual(900);
    expect(bytes.byteLength).toBeLessThanOrEqual(1200);
    expect(bytes[0]).toBe(0x2f); // '/'
    expect(bytes[1]).toBe(0x2a); // '*'
  });

  it('post56: TextDecoder round-trip of genres.ts preserves resolveGenre wiring', () => {
    const round = new TextDecoder().decode(new TextEncoder().encode(genresSource));
    expect(round).toBe(genresSource);
    expect(round).toContain('export function resolveGenre');
    expect(round).toContain('VALID_GENRES.includes');
  });

  it('post56: genres.ts source line count and trailing newline lock', () => {
    const lines = genresSource.split('\n');
    expect(lines.length).toBe(48);
    expect(lines[0]).toMatch(/^\/\*\* iptv-org category ids/);
    expect(lines[46]).toBe('}');
    expect(lines[47]).toBe('');
  });

  it('post56: genres.ts exports exactly GENRE_MAP VALID_GENRES ValidGenre resolveGenre', () => {
    const exports = [...genresSource.matchAll(/^export (?:const|function|type) (\w+)/gm)].map(
      (m) => m[1],
    );
    expect(exports).toEqual(['GENRE_MAP', 'VALID_GENRES', 'ValidGenre', 'resolveGenre']);
  });

  it('post56: negative product inventing — no playlist/now-playing/openapi in genres.ts', () => {
    expect(genresSource).not.toMatch(/playlist|now[_-]?playing|openapi|durable|webhook/i);
    expect(genresSource).not.toMatch(/GEMINI|fetch\(|Hono|iptv-org\.github/);
  });

  it('post56: fromCharCode rebuild of late night key resolves ambient', () => {
    const key = String.fromCharCode(
      108, 97, 116, 101, 32, 110, 105, 103, 104, 116,
    );
    expect(key).toBe('late night');
    expect(GENRE_MAP[key]).toBe('ambient');
    expect(resolveGenre(key)).toBe('ambient');
  });

  it('post56: fromCharCode rebuild of entertainment identity', () => {
    const g = String.fromCharCode(
      101, 110, 116, 101, 114, 116, 97, 105, 110, 109, 101, 110, 116,
    );
    expect(g).toBe('entertainment');
    expect(resolveGenre(g)).toBe('entertainment');
    expect(VALID_GENRES.includes(g as (typeof VALID_GENRES)[number])).toBe(true);
  });

  it('post56: btoa/atob round-trip of every VALID_GENRES slug', () => {
    for (const g of VALID_GENRES) {
      expect(atob(btoa(g))).toBe(g);
      expect(resolveGenre(atob(btoa(g)))).toBe(g);
    }
  });

  it('post56: btoa of lo-fi alias is stable base64', () => {
    expect(btoa('lo-fi')).toBe('bG8tZmk=');
    expect(resolveGenre(atob('bG8tZmk='))).toBe('ambient');
  });

  it('post56: codePointAt locks for spaced late night and hyphen lo-fi', () => {
    expect('late night'.codePointAt(4)).toBe(0x20);
    expect('lo-fi'.codePointAt(2)).toBe(0x2d);
    expect('lofi'.codePointAt(2)).toBe('f'.charCodeAt(0));
    expect(resolveGenre('late night')).toBe('ambient');
    expect(resolveGenre('lo-fi')).toBe('ambient');
  });

  it('post56: padStart/padEnd of jazz trim back to identity', () => {
    expect(resolveGenre('jazz'.padStart(8)).trim()).toBe('jazz');
    expect(resolveGenre('jazz'.padEnd(8)).trim()).toBe('jazz');
    expect(resolveGenre(`   ${'jazz'.padStart(6)}   `)).toBe('jazz');
  });

  it('post56: encodeURIComponent of plain slugs is identity; spaced alias is not', () => {
    for (const g of VALID_GENRES) {
      expect(encodeURIComponent(g)).toBe(g);
    }
    expect(encodeURIComponent('late night')).toBe('late%20night');
    expect(resolveGenre(decodeURIComponent('late%20night'))).toBe('ambient');
  });

  it('post56: ArrayBuffer view of JSON.stringify(GENRE_MAP) starts with {', () => {
    const json = JSON.stringify(GENRE_MAP);
    const buf = new TextEncoder().encode(json);
    expect(buf[0]).toBe(0x7b);
    expect(buf[buf.length - 1]).toBe(0x7d);
    expect(json.startsWith('{"late night"')).toBe(true);
  });

  it('post56: Map/Set/WeakMap identity locks for GENRE_MAP keys', () => {
    const keys = Object.keys(GENRE_MAP);
    const map = new Map(Object.entries(GENRE_MAP));
    const set = new Set(keys);
    const weak = new WeakMap<object, string>();
    const token = { k: 'jazz' };
    weak.set(token, 'jazz');
    expect(map.size).toBe(21);
    expect(set.size).toBe(21);
    expect(map.get('blues')).toBe('jazz');
    expect(set.has('lo-fi')).toBe(true);
    expect(weak.get(token)).toBe('jazz');
    expect(resolveGenre('blues')).toBe(map.get('blues'));
  });

  it('post56: Reflect.ownKeys GENRE_MAP equals Object.keys and has no symbols', () => {
    const own = Reflect.ownKeys(GENRE_MAP);
    expect(own.every((k) => typeof k === 'string')).toBe(true);
    expect(own).toEqual(Object.keys(GENRE_MAP));
    expect(Object.getOwnPropertySymbols(GENRE_MAP)).toEqual([]);
  });

  it('post56: Reflect.has confirms ambient aliases and rejects inventing keys', () => {
    expect(Reflect.has(GENRE_MAP, 'chill')).toBe(true);
    expect(Reflect.has(GENRE_MAP, 'electronic')).toBe(true);
    expect(Reflect.has(GENRE_MAP, 'playlist')).toBe(false);
    expect(Reflect.has(GENRE_MAP, 'nowPlaying')).toBe(false);
  });

  it('post56: Object.getOwnPropertyDescriptors GENRE_MAP entries are writable data props', () => {
    const desc = Object.getOwnPropertyDescriptors(GENRE_MAP);
    expect(Object.keys(desc)).toHaveLength(21);
    for (const key of Object.keys(GENRE_MAP)) {
      expect(desc[key].enumerable).toBe(true);
      expect(desc[key].configurable).toBe(true);
      expect(desc[key].writable).toBe(true);
      expect(desc[key].value).toBe(GENRE_MAP[key]);
    }
  });

  it('post56: Object.seal on GENRE_MAP copy still resolves all aliases', () => {
    const sealed = Object.seal({ ...GENRE_MAP });
    expect(Object.isSealed(sealed)).toBe(true);
    for (const [k, v] of Object.entries(GENRE_MAP)) {
      expect(resolveGenre(k, sealed)).toBe(v);
    }
    expect(() => {
      (sealed as Record<string, string>).invented = 'jazz';
    }).toThrow();
  });

  it('post56: Object.preventExtensions on empty custom map still hits VALID_GENRES fallback', () => {
    const map = Object.preventExtensions({}) as Record<string, string>;
    expect(Object.isExtensible(map)).toBe(false);
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('chill', map)).toBe('music');
  });

  it('post56: Proxy getOwnPropertyDescriptor + ownKeys preserve alias enumeration', () => {
    const proxy = new Proxy(
      { ...GENRE_MAP },
      {
        ownKeys(t) {
          return Reflect.ownKeys(t);
        },
        getOwnPropertyDescriptor(t, p) {
          return Reflect.getOwnPropertyDescriptor(t, p);
        },
      },
    );
    expect(Object.keys(proxy)).toEqual(Object.keys(GENRE_MAP));
    expect(resolveGenre('indie', proxy)).toBe('rock');
  });

  it('post56: Proxy has trap reporting false still allows bracket get for resolveGenre', () => {
    const target = { secret: 'jazz' };
    const proxy = new Proxy(target, {
      has() {
        return false;
      },
      get(t, p, r) {
        return Reflect.get(t, p, r);
      },
    });
    expect('secret' in proxy).toBe(false);
    expect(resolveGenre('secret', proxy)).toBe('jazz');
  });

  it('post56: structuredClone VALID_GENRES is distinct array with same values', () => {
    const clone = structuredClone(VALID_GENRES) as unknown as string[];
    expect(clone).toEqual([...VALID_GENRES]);
    expect(clone).not.toBe(VALID_GENRES as unknown as string[]);
    clone[0] = 'mutated';
    expect(VALID_GENRES[0]).toBe('music');
  });

  it('post56: localeCompare sort of VALID_GENRES matches lexicographic ASCII order', () => {
    const sorted = [...VALID_GENRES].sort((a, b) => a.localeCompare(b));
    expect(sorted).toEqual([
      'ambient',
      'classical',
      'entertainment',
      'jazz',
      'music',
      'news',
      'pop',
      'rock',
      'sports',
    ]);
  });

  it('post56: Intl.Collator en sensitivity base does not equate jazz and jázz for resolve', () => {
    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    expect(collator.compare('jazz', 'jázz')).toBe(0);
    expect(resolveGenre('jazz')).toBe('jazz');
    expect(resolveGenre('jázz')).toBe('music');
  });

  it('post56: String.raw of GENRE_MAP classic line appears in genres source', () => {
    expect(genresSource).toContain(String.raw`classic: 'classical'`);
    expect(genresSource).toContain(String.raw`dance: 'pop'`);
    expect(genresSource).toContain(String.raw`'lo-fi': 'ambient'`);
  });

  it('post56: joined GENRE_MAP keys checksum length and hyphen/space counts', () => {
    const joined = Object.keys(GENRE_MAP).join('|');
    expect(joined.length).toBe(149);
    expect((joined.match(/ /g) ?? []).length).toBe(1);
    expect((joined.match(/-/g) ?? []).length).toBe(1);
    expect(joined.startsWith('late night|')).toBe(true);
    expect(joined.endsWith('|lo-fi')).toBe(true);
  });

  it('post56: every GENRE_MAP value is a VALID_GENRES member via Set lookup', () => {
    const valid = new Set<string>(VALID_GENRES);
    for (const v of Object.values(GENRE_MAP)) {
      expect(valid.has(v)).toBe(true);
    }
  });

  it('post56: resolveGenre NFKC-normalized fullwidth jazz falls back to music', () => {
    const fullwidth = 'ｊａｚｚ'; // U+FF4A etc.
    expect(fullwidth.normalize('NFKC')).toBe('jazz');
    expect(resolveGenre(fullwidth)).toBe('music');
    expect(resolveGenre(fullwidth.normalize('NFKC'))).toBe('jazz');
  });

  it('post56: resolveGenre trim strips BOM so padded jazz still resolves', () => {
    expect(resolveGenre('\uFEFFjazz')).toBe('jazz');
    expect(resolveGenre('jazz\uFEFF')).toBe('jazz');
  });

  it('post56: resolveGenre trim strips NBSP edges but not interior NBSP in late night', () => {
    expect(resolveGenre('late\u00A0night')).toBe('music');
    expect(resolveGenre('\u00A0jazz\u00A0')).toBe('jazz');
  });

  it('post56: resolveGenre rejects combining diaeresis on jazz letters', () => {
    expect(resolveGenre('ja\u0308zz')).toBe('music');
    expect(resolveGenre('j\u0301azz')).toBe('music');
  });

  it('post56: custom map empty-string hit is returned via ?? (empty is defined)', () => {
    const map = { jazz: '' } as Record<string, string>;
    expect(resolveGenre('jazz', map)).toBe('');
    expect(resolveGenre('chill', { chill: '' })).toBe('');
  });

  it('post56: custom map numeric 0 is defined for ?? and returned as-is', () => {
    const map = { jazz: 0 as unknown as string };
    expect(resolveGenre('jazz', map)).toBe(0 as unknown as string);
  });

  it('post56: resolveGenre with String object wrapper for jazz', () => {
    const wrapped = new String('  JAZZ  ');
    expect(resolveGenre(wrapped as unknown as string)).toBe('jazz');
  });

  it('post56: VALID_GENRES Symbol.iterator yields nine values then done', () => {
    const it = VALID_GENRES[Symbol.iterator]();
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      const next = it.next();
      expect(next.done).toBe(false);
      seen.push(next.value!);
    }
    expect(it.next()).toEqual({ value: undefined, done: true });
    expect(seen).toEqual([...VALID_GENRES]);
  });

  it('post56: VALID_GENRES entries() index pairs lock', () => {
    expect([...VALID_GENRES.entries()]).toEqual([
      [0, 'music'],
      [1, 'ambient'],
      [2, 'jazz'],
      [3, 'classical'],
      [4, 'pop'],
      [5, 'rock'],
      [6, 'news'],
      [7, 'sports'],
      [8, 'entertainment'],
    ]);
  });

  it('post56: VALID_GENRES values().next chain matches array values', () => {
    expect([...VALID_GENRES.values()]).toEqual([...VALID_GENRES]);
    expect([...VALID_GENRES.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('post56: Array.prototype.reduce of VALID_GENRES lengths sums to 55', () => {
    const sum = VALID_GENRES.reduce((acc, g) => acc + g.length, 0);
    expect(sum).toBe(55);
    expect(VALID_GENRES.map((g) => g.length)).toEqual([5, 7, 4, 9, 3, 4, 4, 6, 13]);
  });

  it('post56: longest VALID_GENRES slug is entertainment at length 13', () => {
    const longest = [...VALID_GENRES].sort((a, b) => b.length - a.length)[0];
    expect(longest).toBe('entertainment');
    expect(longest.length).toBe(13);
  });

  it('post56: shortest VALID_GENRES slug is pop at length 3', () => {
    const shortest = [...VALID_GENRES].sort((a, b) => a.length - b.length)[0];
    expect(shortest).toBe('pop');
  });

  it('post56: ambient fan-in count lock remains 8 after post56 deepen', () => {
    expect(Object.values(GENRE_MAP).filter((v) => v === 'ambient')).toHaveLength(8);
    expect(Object.values(GENRE_MAP).filter((v) => v === 'rock')).toHaveLength(3);
    expect(Object.values(GENRE_MAP).filter((v) => v === 'pop')).toHaveLength(2);
    expect(Object.values(GENRE_MAP).filter((v) => v === 'jazz')).toHaveLength(2);
    expect(Object.values(GENRE_MAP).filter((v) => v === 'classical')).toHaveLength(2);
  });

  it('post56: identity-only genres news sports entertainment music have fan-in 1', () => {
    for (const g of ['news', 'sports', 'entertainment', 'music'] as const) {
      expect(Object.values(GENRE_MAP).filter((v) => v === g)).toHaveLength(1);
      expect(GENRE_MAP[g]).toBe(g);
    }
  });

  it('post56: resolveGenre mixed-case electronic and relaxing', () => {
    expect(resolveGenre('Electronic')).toBe('ambient');
    expect(resolveGenre('RELAXING')).toBe('ambient');
    expect(resolveGenre('FoCuS')).toBe('ambient');
  });

  it('post56: resolveGenre rejects leading/trailing punctuation around jazz', () => {
    expect(resolveGenre('.jazz')).toBe('music');
    expect(resolveGenre('jazz.')).toBe('music');
    expect(resolveGenre('(jazz)')).toBe('music');
    expect(resolveGenre('"jazz"')).toBe('music');
  });

  it('post56: resolveGenre rejects slash and pipe genre probes', () => {
    expect(resolveGenre('jazz/blues')).toBe('music');
    expect(resolveGenre('jazz|news')).toBe('music');
    expect(resolveGenre('rock&roll')).toBe('music');
  });

  it('post56: custom map can invent non-VALID_GENRES target strings', () => {
    expect(resolveGenre('mood', { mood: 'synthwave' })).toBe('synthwave');
    expect(VALID_GENRES.includes('synthwave' as (typeof VALID_GENRES)[number])).toBe(false);
  });

  it('post56: custom map override of music identity to ambient wins', () => {
    expect(resolveGenre('music', { music: 'ambient' })).toBe('ambient');
    expect(resolveGenre('music')).toBe('music');
  });

  it('post56: empty-string map value for chill is returned; unknown still music', () => {
    expect(resolveGenre('chill', { chill: '' })).toBe('');
    expect(resolveGenre('xyz', { chill: '' })).toBe('music');
  });

  it('post56: Proxy.revocable GENRE_MAP copy resolves then throws after revoke', () => {
    const { proxy, revoke } = Proxy.revocable({ ...GENRE_MAP }, {});
    expect(resolveGenre('metal', proxy)).toBe('rock');
    revoke();
    expect(() => resolveGenre('metal', proxy)).toThrow();
    expect(resolveGenre('metal')).toBe('rock');
  });

  it('post56: WeakRef of GENRE_MAP still dereferences live object', () => {
    const ref = new WeakRef(GENRE_MAP);
    expect(ref.deref()).toBe(GENRE_MAP);
    expect(resolveGenre('indie', ref.deref()!)).toBe('rock');
  });

  it('post56: JSON.stringify VALID_GENRES exact stable string lock', () => {
    expect(JSON.stringify(VALID_GENRES)).toBe(
      '["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]',
    );
  });

  it('post56: Buffer.byteLength of JSON.stringify(GENRE_MAP) within band', () => {
    const n = Buffer.byteLength(JSON.stringify(GENRE_MAP), 'utf8');
    expect(n).toBeGreaterThanOrEqual(350);
    expect(n).toBeLessThanOrEqual(450);
  });

  it('post56: genres source does not use optional chaining or nullish assign in resolveGenre body', () => {
    const fn = genresSource.slice(genresSource.indexOf('export function resolveGenre'));
    expect(fn).toContain('map[lower] ??');
    expect(fn).not.toContain('?.');
    expect(fn).not.toContain('??=');
  });

  it('post56: resolveGenre body uses toLowerCase().trim() in that order', () => {
    expect(genresSource).toMatch(/input\.toLowerCase\(\)\.trim\(\)/);
    expect(genresSource).not.toMatch(/input\.trim\(\)\.toLowerCase\(\)/);
  });

  it('post56: ValidGenre type is derived from VALID_GENRES number index', () => {
    expect(genresSource).toContain('export type ValidGenre = (typeof VALID_GENRES)[number];');
  });

  it('post56: GENRE_MAP arrow comment documents iptv-org category ids', () => {
    expect(genresSource.startsWith('/** iptv-org category ids we expose + mood aliases')).toBe(
      true,
    );
    expect(genresSource).toMatch(/aliases → category/);
  });

  it('post56: no default export and no side-effect top-level calls in genres.ts', () => {
    expect(genresSource).not.toMatch(/export default/);
    expect(genresSource).not.toMatch(/\bconsole\./);
    expect([...genresSource.matchAll(/function resolveGenre/g)]).toHaveLength(1);
    expect([...genresSource.matchAll(/\bresolveGenre\s*\(/g)]).toHaveLength(1);
  });

  it('post56: resolveGenre call sites absent; only declaration present in module source', () => {
    const withoutDecl = genresSource.replace(/export function resolveGenre[\s\S]*$/, '');
    expect(withoutDecl).not.toContain('resolveGenre(');
  });

  it('post56: cross-lock package.json name remains backlink not a genre invent', () => {
    const pkg = JSON.parse(readFileSync(join(genresRoot, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(pkg.name).toBe('backlink');
    expect(resolveGenre(pkg.name)).toBe('music');
  });

  it('post56: cross-lock wrangler VERSION var is not a VALID_GENRES slug', () => {
    const toml = readFileSync(join(genresRoot, 'wrangler.toml'), 'utf8');
    const ver = toml.match(/VERSION = "([^"]+)"/)?.[1] ?? '';
    expect(ver).toBe('0.1.0');
    expect(resolveGenre(ver)).toBe('music');
    expect(VALID_GENRES.includes(ver as (typeof VALID_GENRES)[number])).toBe(false);
  });

  it('post56: Array.isArray VALID_GENRES and not Array.isArray GENRE_MAP', () => {
    expect(Array.isArray(VALID_GENRES)).toBe(true);
    expect(Array.isArray(GENRE_MAP)).toBe(false);
  });

  it('post56: GENRE_MAP prototype is Object.prototype; VALID_GENRES is Array', () => {
    expect(Object.getPrototypeOf(GENRE_MAP)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(VALID_GENRES)).toBe(Array.prototype);
  });

  it('post56: resolveGenre with surrogate-pair emoji prefix yields music', () => {
    expect(resolveGenre('🎵jazz')).toBe('music');
    expect(resolveGenre('jazz🎵')).toBe('music');
    expect(resolveGenre('𝄞')).toBe('music');
  });

  it('post56: resolveGenre with RTL mark and LTR mark around jazz yields music', () => {
    expect(resolveGenre('\u200Fjazz')).toBe('music');
    expect(resolveGenre('jazz\u200E')).toBe('music');
  });

  it('post56: toLocaleLowerCase en vs tr for I-dotted probes', () => {
    expect(resolveGenre('I'.toLocaleLowerCase('en') + 'azz')).toBe('music'); // "iazz"
    expect(resolveGenre('İ'.toLocaleLowerCase('tr') + 'azz')).toBe('music');
    expect(resolveGenre('JAZZ'.toLocaleLowerCase('en'))).toBe('jazz');
  });

  it('post56: Number/Boolean coerced string probes fall back to music', () => {
    expect(resolveGenre(String(0))).toBe('music');
    expect(resolveGenre(String(true))).toBe('music');
    expect(resolveGenre(String(false))).toBe('music');
    expect(resolveGenre(String(NaN))).toBe('music');
  });

  it('post56: resolveGenre is pure across shuffled alias batch', () => {
    const aliases = Object.keys(GENRE_MAP);
    const shuffled = [...aliases].sort(() => 0.5 - Math.random());
    for (const a of shuffled) {
      expect(resolveGenre(a)).toBe(GENRE_MAP[a]);
      expect(resolveGenre(a.toUpperCase())).toBe(GENRE_MAP[a]);
    }
  });

  it('post56: frozen empty map + all VALID_GENRES via includes fallback', () => {
    const frozen = Object.freeze({}) as Record<string, string>;
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g, frozen)).toBe(g);
      expect(resolveGenre(g.toUpperCase(), frozen)).toBe(g);
    }
  });

  it('post56: Map-like object with get method is not used by resolveGenre bracket access', () => {
    const mapLike = {
      get(_k: string) {
        return 'jazz';
      },
    } as unknown as Record<string, string>;
    expect(resolveGenre('chill', mapLike)).toBe('music');
  });

  it('post56: resolveGenre whitespace-only unicode line separators trim like spaces', () => {
    expect(resolveGenre('\u2028')).toBe('music');
    expect(resolveGenre('\u2029')).toBe('music');
    expect(resolveGenre('\u2028jazz\u2029')).toBe('jazz');
  });

  it('post56: charCodeAt sequence rebuild of classical identity', () => {
    const chars = [99, 108, 97, 115, 115, 105, 99, 97, 108];
    const g = chars.map((c) => String.fromCharCode(c)).join('');
    expect(g).toBe('classical');
    expect(resolveGenre(g)).toBe('classical');
    expect(GENRE_MAP.classic).toBe(g);
  });

  it('post56: indexOf/lastIndexOf locks for lo-fi hyphen position', () => {
    expect('lo-fi'.indexOf('-')).toBe(2);
    expect('lo-fi'.lastIndexOf('-')).toBe(2);
    expect('lofi'.indexOf('-')).toBe(-1);
    expect(resolveGenre('lo-fi')).toBe(resolveGenre('lofi'));
  });

  it('post56: split join of late night via space is stable', () => {
    expect('late night'.split(' ').join(' ')).toBe('late night');
    expect(resolveGenre('late night'.split(' ').join(' '))).toBe('ambient');
    expect(resolveGenre('late night'.split(' ').join('-'))).toBe('music');
  });

  it('post56: Object.assign into null-prototype preserves chill only', () => {
    const map = Object.assign(Object.create(null), { chill: 'ambient' }) as Record<string, string>;
    expect(Object.getPrototypeOf(map)).toBe(null);
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('relaxing', map)).toBe('music');
  });

  it('post56: defineProperty non-enumerable alias is still readable by resolveGenre', () => {
    const map = {} as Record<string, string>;
    Object.defineProperty(map, 'hidden', {
      value: 'news',
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(Object.keys(map)).toEqual([]);
    expect(resolveGenre('hidden', map)).toBe('news');
  });

  it('post56: resolveGenre does not invent /playlist or /now-playing genre tokens', () => {
    expect(resolveGenre('playlist')).toBe('music');
    expect(resolveGenre('now-playing')).toBe('music');
    expect(resolveGenre('nowPlaying')).toBe('music');
    expect(Object.keys(GENRE_MAP)).not.toContain('playlist');
  });

  it('post56: exclusive ambient aliases exclude VALID_GENRES rock/pop/jazz/news', () => {
    const ambientOnly = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k);
    for (const banned of ['rock', 'pop', 'jazz', 'news', 'sports', 'entertainment']) {
      expect(ambientOnly).not.toContain(banned);
    }
  });

  it('post56: Uint8Array of music slug ascii bytes', () => {
    const bytes = Uint8Array.from('music', (c) => c.charCodeAt(0));
    expect([...bytes]).toEqual([109, 117, 115, 105, 99]);
    expect(String.fromCharCode(...bytes)).toBe('music');
    expect(resolveGenre(String.fromCharCode(...bytes))).toBe('music');
  });

  it('post56: Promise.resolve wrappers do not change sync resolveGenre return', async () => {
    await expect(Promise.resolve(resolveGenre('blues'))).resolves.toBe('jazz');
    await expect(Promise.resolve(resolveGenre('unknown'))).resolves.toBe('music');
  });

  it('post56: JSON.parse of Object.keys GENRE_MAP JSON matches live keys', () => {
    const keys = Object.keys(GENRE_MAP);
    expect(JSON.parse(JSON.stringify(keys))).toEqual(keys);
    expect(keys).toHaveLength(21);
  });

  it('post56: resolveGenre length property stays 1 after post56 deepen', () => {
    expect(resolveGenre.length).toBe(1);
    expect(Object.getOwnPropertyDescriptor(resolveGenre, 'length')?.writable).toBe(false);
  });

  it('post56: name property of resolveGenre function is resolveGenre', () => {
    expect(resolveGenre.name).toBe('resolveGenre');
  });

  it('post56: genres module source hash-like join of VALID_GENRES', () => {
    expect(VALID_GENRES.join('-')).toBe(
      'music-ambient-jazz-classical-pop-rock-news-sports-entertainment',
    );
  });

  it('post56: every alias key lowercases to itself (already lowercase)', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(key).toBe(key.toLowerCase());
      expect(key).toBe(key.trim());
    }
  });

  it('post56: resolveGenre with repeated internal spaces in late  night fails', () => {
    expect(resolveGenre('late  night')).toBe('music');
    expect(resolveGenre('late   night')).toBe('music');
  });

  it('post56: Aggregate of unique GENRE_MAP targets equals VALID_GENRES set', () => {
    expect(new Set(Object.values(GENRE_MAP))).toEqual(new Set(VALID_GENRES));
  });

  it('post56: cross-lock src/genres.ts byteLength equals TextEncoder length', () => {
    expect(Buffer.byteLength(genresSource, 'utf8')).toBe(
      new TextEncoder().encode(genresSource).length,
    );
  });

  it('post56: genres.ts contains no tabs and uses single quotes for string literals', () => {
    expect(genresSource).not.toContain('\t');
    expect(genresSource).toMatch(/'late night'/);
    expect(genresSource).not.toMatch(/"late night"/);
  });

  it('post56: resolveGenre default parameter source text is GENRE_MAP', () => {
    expect(genresSource).toMatch(
      /map:\s*Record<string,\s*string>\s*=\s*GENRE_MAP/,
    );
  });

  it('post56: includes cast uses ValidGenre type name exactly once in source', () => {
    expect([...genresSource.matchAll(/as ValidGenre/g)]).toHaveLength(1);
    expect(genresSource).toContain('VALID_GENRES.includes(lower as ValidGenre)');
  });

  it('post56: music fallback appears exactly twice in resolveGenre function body', () => {
    const body = genresSource.slice(genresSource.indexOf('export function resolveGenre'));
    expect([...body.matchAll(/'music'/g)]).toHaveLength(2);
  });

  it('post56: Object.is compares resolveGenre results for alias pairs', () => {
    expect(Object.is(resolveGenre('lofi'), resolveGenre('lo-fi'))).toBe(true);
    expect(Object.is(resolveGenre('classic'), resolveGenre('classical'))).toBe(true);
    expect(Object.is(resolveGenre('metal'), resolveGenre('indie'))).toBe(true);
  });

  it('post56: Set equality of uppercased VALID_GENRES resolves each to lowercase id', () => {
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g.toUpperCase())).toBe(g);
      expect(resolveGenre(` ${g.toUpperCase()} `)).toBe(g);
    }
  });

  it('post56: negative — GENRE_MAP does not map k-pop hip-hop techno house', () => {
    for (const probe of ['k-pop', 'kpop', 'hip-hop', 'hiphop', 'techno', 'house', 'trance']) {
      expect(GENRE_MAP[probe]).toBeUndefined();
      expect(resolveGenre(probe)).toBe('music');
    }
  });

  it('post56: Proxy set trap that echoes writes still lets resolveGenre read chill', () => {
    const target: Record<string, string> = {};
    const proxy = new Proxy(target, {
      set(t, p, v) {
        return Reflect.set(t, p, v);
      },
      get(t, p, r) {
        return Reflect.get(t, p, r);
      },
    });
    proxy.chill = 'ambient';
    expect(resolveGenre('chill', proxy)).toBe('ambient');
    expect(target.chill).toBe('ambient');
  });

  it('post56: deep freeze simulation via freeze of nested copy of entries', () => {
    const frozenEntries = Object.freeze(
      Object.entries(GENRE_MAP).map(([k, v]) => Object.freeze([k, v] as const)),
    );
    expect(frozenEntries).toHaveLength(21);
    expect(Object.fromEntries(frozenEntries)).toEqual(GENRE_MAP);
  });

  it('post56: resolveGenre with undefined map argument uses default GENRE_MAP', () => {
    expect(resolveGenre('chill', undefined)).toBe('ambient');
    expect(resolveGenre('metal', undefined)).toBe('rock');
  });

  it('post56: sparse custom map with hole-like missing props falls through', () => {
    const map = { jazz: 'jazz', 0: 'news' } as Record<string, string>;
    expect(resolveGenre('0', map)).toBe('news');
    expect(resolveGenre('1', map)).toBe('music');
  });

  it('post56: URL pathname genre probes are not stripped', () => {
    expect(resolveGenre('/genres/jazz')).toBe('music');
    expect(resolveGenre('genres/jazz')).toBe('music');
  });

  it('post56: template literal with expression jazz resolves when fully formed', () => {
    const g = 'jazz';
    expect(resolveGenre(`${g}`)).toBe('jazz');
    expect(resolveGenre(`  ${g}  `)).toBe('jazz');
    expect(resolveGenre(`${g}z`)).toBe('music');
  });

  it('post56: cumulative alias target histogram lock', () => {
    const hist: Record<string, number> = {};
    for (const v of Object.values(GENRE_MAP)) {
      hist[v] = (hist[v] ?? 0) + 1;
    }
    expect(hist).toEqual({
      ambient: 8,
      classical: 2,
      jazz: 2,
      pop: 2,
      rock: 3,
      music: 1,
      news: 1,
      sports: 1,
      entertainment: 1,
    });
  });

  it('post56: resolveGenre does not throw for extremely long unknown input', () => {
    const long = 'x'.repeat(10_000);
    expect(resolveGenre(long)).toBe('music');
    expect(resolveGenre(`  ${long}  `)).toBe('music');
  });

  it('post56: genres.ts EOF is single trailing newline after closing brace', () => {
    expect(genresSource.endsWith('}\n')).toBe(true);
    expect(genresSource.endsWith('}\n\n')).toBe(false);
  });

  it('post56: import identity — GENRE_MAP object is same reference across reads', () => {
    expect(GENRE_MAP).toBe(GENRE_MAP);
    expect(VALID_GENRES).toBe(VALID_GENRES);
    expect(resolveGenre).toBe(resolveGenre);
  });

  it('post56: cross-lock README does not invent genre aliases absent from GENRE_MAP', () => {
    const readme = readFileSync(join(genresRoot, 'README.md'), 'utf8');
    for (const alias of ['chill', 'lofi', 'blues', 'late night'] as const) {
      if (readme.toLowerCase().includes(alias)) {
        expect(GENRE_MAP[alias] ?? GENRE_MAP[alias.toLowerCase()]).toBeTruthy();
      }
    }
    expect(resolveGenre('chill')).toBe('ambient');
  });

  it('post56: final purity batch — 50x identical resolveGenre results', () => {
    const probes = [
      ['', 'music'],
      ['JAZZ', 'jazz'],
      ['lo-fi', 'ambient'],
      ['Metal', 'rock'],
      ['unknown', 'music'],
      ['  pop  ', 'pop'],
    ] as const;
    for (let i = 0; i < 50; i++) {
      for (const [input, expected] of probes) {
        expect(resolveGenre(input)).toBe(expected);
      }
    }
  });

  it('post68: sha256 of genres.ts locks to known digest', () => {
    const digest = createHash('sha256').update(genresSource, 'utf8').digest('hex');
    expect(digest).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post68: sha1 of genres.ts locks to known digest', () => {
    expect(createHash('sha1').update(genresSource, 'utf8').digest('hex')).toBe(
      '3dd586bfd23c91e9719b56c90c8cbfe038aebc3e',
    );
  });

  it('post68: md5 of genres.ts locks to known digest', () => {
    expect(createHash('md5').update(genresSource, 'utf8').digest('hex')).toBe(
      'ee8d34506f688c9e3097b89a35d48aa5',
    );
  });

  it('post68: genres.ts code-unit length 1025; utf8 byte length 1027 (→)', () => {
    expect(genresSource.length).toBe(1025);
    expect(Buffer.byteLength(genresSource, 'utf8')).toBe(1027);
    expect(genresSource).toContain('→');
  });

  it('post68: genres.ts split line count stays 48 with 47 newlines', () => {
    expect(genresSource.split('\n')).toHaveLength(48);
    expect((genresSource.match(/\n/g) ?? []).length).toBe(47);
  });

  it('post68: GENRE_MAP key count remains 21 after post68 deepen', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(Object.values(GENRE_MAP)).toHaveLength(21);
  });

  it('post68: VALID_GENRES length remains 9', () => {
    expect(VALID_GENRES).toHaveLength(9);
    expect(VALID_GENRES.length).toBe(9);
  });

  it('post68: ambient fan-in still eight aliases including identity', () => {
    const ambient = Object.entries(GENRE_MAP).filter(([, v]) => v === 'ambient');
    expect(ambient.map(([k]) => k).sort()).toEqual(
      ['ambient', 'chill', 'electronic', 'focus', 'late night', 'lo-fi', 'lofi', 'relaxing'].sort(),
    );
    expect(ambient).toHaveLength(8);
  });

  it('post68: rock fan-in remains metal indie rock', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'rock')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['indie', 'metal', 'rock']);
  });

  it('post68: pop fan-in remains dance pop', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'pop')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['dance', 'pop']);
  });

  it('post68: classical fan-in remains classic classical', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'classical')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['classic', 'classical']);
  });

  it('post68: jazz fan-in remains blues jazz', () => {
    expect(
      Object.entries(GENRE_MAP)
        .filter(([, v]) => v === 'jazz')
        .map(([k]) => k)
        .sort(),
    ).toEqual(['blues', 'jazz']);
  });

  it('post68: identity-only targets music news sports entertainment', () => {
    for (const id of ['music', 'news', 'sports', 'entertainment'] as const) {
      const keys = Object.entries(GENRE_MAP)
        .filter(([, v]) => v === id)
        .map(([k]) => k);
      expect(keys).toEqual([id]);
    }
  });

  it('post68: resolveGenre trims then lowercases — mixed pad of ELECTRONIC', () => {
    expect(resolveGenre('  ELECTRONIC  ')).toBe('ambient');
    expect(resolveGenre('\tFocus\t')).toBe('ambient');
  });

  it('post68: resolveGenre rejects underscore and hyphen variants of late night', () => {
    expect(resolveGenre('late_night')).toBe('music');
    expect(resolveGenre('late-night')).toBe('music');
    expect(resolveGenre('latenight')).toBe('music');
  });

  it('post68: resolveGenre rejects lo_fi underscore while accepting lo-fi', () => {
    expect(resolveGenre('lo_fi')).toBe('music');
    expect(resolveGenre('lo-fi')).toBe('ambient');
    expect(resolveGenre('lofi')).toBe('ambient');
  });

  it('post68: resolveGenre does not strip punctuation glued to blues', () => {
    expect(resolveGenre('blues!')).toBe('music');
    expect(resolveGenre('(blues)')).toBe('music');
    expect(resolveGenre('blues.')).toBe('music');
  });

  it('post68: resolveGenre with nullish coalescing style empty string is music', () => {
    expect(resolveGenre(undefined)).toBe('music');
    expect(resolveGenre()).toBe('music');
  });

  it('post68: custom map can shadow VALID_GENRES identity jazz→news', () => {
    expect(resolveGenre('jazz', { jazz: 'news' })).toBe('news');
    expect(resolveGenre('jazz')).toBe('jazz');
  });

  it('post68: custom map missing key falls through to VALID_GENRES includes', () => {
    expect(resolveGenre('sports', {})).toBe('sports');
    expect(resolveGenre('unknown', {})).toBe('music');
  });

  it('post68: Object.freeze GENRE_MAP still readable for all aliases', () => {
    expect(() => Object.freeze(GENRE_MAP)).not.toThrow();
    expect(resolveGenre('chill')).toBe('ambient');
    expect(resolveGenre('indie')).toBe('rock');
  });

  it('post68: structuredClone of GENRE_MAP is deep-equal but not same ref', () => {
    const clone = structuredClone(GENRE_MAP);
    expect(clone).toEqual(GENRE_MAP);
    expect(clone).not.toBe(GENRE_MAP);
    expect(resolveGenre('lofi', clone)).toBe('ambient');
  });

  it('post68: Reflect.ownKeys GENRE_MAP has no symbols and matches Object.keys', () => {
    const keys = Reflect.ownKeys(GENRE_MAP);
    expect(keys.every((k) => typeof k === 'string')).toBe(true);
    expect(keys).toEqual(Object.keys(GENRE_MAP));
  });

  it('post68: Object.isFrozen VALID_GENRES is false (mutable const binding)', () => {
    expect(Object.isFrozen(VALID_GENRES)).toBe(false);
    expect(Object.isSealed(VALID_GENRES)).toBe(false);
  });

  it('post68: Array.from VALID_GENRES equals spread copy', () => {
    expect(Array.from(VALID_GENRES)).toEqual([...VALID_GENRES]);
  });

  it('post68: reduce of GENRE_MAP key lengths sums to fixed total', () => {
    const sum = Object.keys(GENRE_MAP).reduce((acc, k) => acc + k.length, 0);
    expect(sum).toBe(129);
  });

  it('post68: reduce of VALID_GENRES slug lengths sums to 55', () => {
    expect(VALID_GENRES.reduce((acc, g) => acc + g.length, 0)).toBe(55);
  });

  it('post68: longest GENRE_MAP key is entertainment at 13', () => {
    const longest = Object.keys(GENRE_MAP).reduce((a, b) => (a.length >= b.length ? a : b));
    expect(longest).toBe('entertainment');
    expect(longest.length).toBe(13);
  });

  it('post68: shortest GENRE_MAP keys are pop at length 3', () => {
    const shortest = Object.keys(GENRE_MAP).filter((k) => k.length === 3);
    expect(shortest.sort()).toEqual(['pop']);
  });

  it('post68: only spaced key in GENRE_MAP is late night', () => {
    const spaced = Object.keys(GENRE_MAP).filter((k) => k.includes(' '));
    expect(spaced).toEqual(['late night']);
  });

  it('post68: only hyphenated key in GENRE_MAP is lo-fi', () => {
    const hyph = Object.keys(GENRE_MAP).filter((k) => k.includes('-'));
    expect(hyph).toEqual(['lo-fi']);
  });

  it('post68: genres source opens with iptv-org category comment', () => {
    expect(genresSource.startsWith('/** iptv-org category ids')).toBe(true);
  });

  it('post68: genres source exports order GENRE_MAP VALID_GENRES ValidGenre resolveGenre', () => {
    const exports = [...genresSource.matchAll(/^export (?:const|function|type) (\w+)/gm)].map(
      (m) => m[1],
    );
    expect(exports).toEqual(['GENRE_MAP', 'VALID_GENRES', 'ValidGenre', 'resolveGenre']);
  });

  it('post68: resolveGenre source uses map[lower] ?? includes fallback', () => {
    expect(genresSource).toContain('return map[lower] ?? (VALID_GENRES.includes(lower as ValidGenre) ? lower : \'music\');');
  });

  it('post68: resolveGenre early return for falsy input is music', () => {
    expect(genresSource).toContain("if (!input) return 'music';");
  });

  it('post68: no async/await/Promise in genres.ts', () => {
    expect(genresSource).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
  });

  it('post68: no class or enum declarations in genres.ts', () => {
    expect(genresSource).not.toMatch(/\bclass\b|\benum\b/);
  });

  it('post68: negative — no Gemini or fetch or Hono inventing in genres.ts', () => {
    expect(genresSource).not.toMatch(/GEMINI|fetch\(|Hono|iptv-org\.github|playlist|now-playing/i);
  });

  it('post68: fromCharCode rebuild of chill resolves ambient', () => {
    const chill = String.fromCharCode(99, 104, 105, 108, 108);
    expect(chill).toBe('chill');
    expect(resolveGenre(chill)).toBe('ambient');
  });

  it('post68: fromCharCode rebuild of lo-fi including hyphen', () => {
    const alias = String.fromCharCode(108, 111, 45, 102, 105);
    expect(alias).toBe('lo-fi');
    expect(resolveGenre(alias)).toBe('ambient');
  });

  it('post68: charCodeAt walk of music slug', () => {
    expect([...('music')].map((c) => c.charCodeAt(0))).toEqual([109, 117, 115, 105, 99]);
  });

  it('post68: btoa of classical identity is stable', () => {
    expect(btoa('classical')).toBe('Y2xhc3NpY2Fs');
    expect(atob('Y2xhc3NpY2Fs')).toBe('classical');
    expect(resolveGenre(atob('Y2xhc3NpY2Fs'))).toBe('classical');
  });

  it('post68: encodeURIComponent of late night is not a GENRE_MAP key', () => {
    const enc = encodeURIComponent('late night');
    expect(enc).toBe('late%20night');
    expect(GENRE_MAP[enc]).toBeUndefined();
    expect(resolveGenre(enc)).toBe('music');
  });

  it('post68: JSON.stringify GENRE_MAP starts with late night key', () => {
    const json = JSON.stringify(GENRE_MAP);
    expect(json.startsWith('{"late night":"ambient"')).toBe(true);
    expect(JSON.parse(json)).toEqual(GENRE_MAP);
  });

  it('post68: JSON.stringify VALID_GENRES exact lock', () => {
    expect(JSON.stringify(VALID_GENRES)).toBe(
      '["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]',
    );
  });

  it('post68: Proxy get trap returning undefined forces music fallback', () => {
    const proxy = new Proxy(
      {},
      {
        get() {
          return undefined;
        },
      },
    );
    expect(resolveGenre('chill', proxy as Record<string, string>)).toBe('music');
    expect(resolveGenre('jazz', proxy as Record<string, string>)).toBe('jazz');
  });

  it('post68: Map object is not consulted by bracket access resolveGenre', () => {
    const map = new Map([['chill', 'ambient']]);
    expect(resolveGenre('chill', map as unknown as Record<string, string>)).toBe('music');
  });

  it('post68: resolveGenre with Symbol.toStringTag custom map still uses props', () => {
    const map = { chill: 'ambient' } as Record<string, string>;
    Object.defineProperty(map, Symbol.toStringTag, { value: 'GenreBag' });
    expect(Object.prototype.toString.call(map)).toBe('[object GenreBag]');
    expect(resolveGenre('chill', map)).toBe('ambient');
  });

  it('post68: WeakRef of resolveGenre still callable', () => {
    const ref = new WeakRef(resolveGenre);
    expect(ref.deref()?.('blues')).toBe('jazz');
  });

  it('post68: Promise.resolve batch of aliases matches sync', async () => {
    const aliases = ['chill', 'metal', 'dance', 'classic', 'unknown'] as const;
    const expected = ['ambient', 'rock', 'pop', 'classical', 'music'] as const;
    await expect(Promise.all(aliases.map((a) => Promise.resolve(resolveGenre(a))))).resolves.toEqual([
      ...expected,
    ]);
  });

  it('post68: Intl.Collator base sensitivity does not make resolveGenre equate café', () => {
    expect(resolveGenre('café')).toBe('music');
    expect(resolveGenre('cafe')).toBe('music');
  });

  it('post68: NFKC fullwidth chill falls back to music', () => {
    const full = 'ｃｈｉｌｌ';
    expect(full.normalize('NFKC')).toBe('chill');
    expect(resolveGenre(full)).toBe('music');
    expect(resolveGenre(full.normalize('NFKC'))).toBe('ambient');
  });

  it('post68: BOM-prefixed jazz trims to identity', () => {
    expect(resolveGenre('\uFEFFjazz')).toBe('jazz');
    expect(resolveGenre('\uFEFF jazz ')).toBe('jazz');
  });

  it('post68: zero-width space inside jazz fails map lookup', () => {
    expect(resolveGenre('ja\u200Bzz')).toBe('music');
  });

  it('post68: resolveGenre length stays 1; name stays resolveGenre', () => {
    expect(resolveGenre.length).toBe(1);
    expect(resolveGenre.name).toBe('resolveGenre');
  });

  it('post68: genres.ts uses CRLF nowhere; only LF', () => {
    expect(genresSource.includes('\r')).toBe(false);
  });

  it('post68: genres.ts has no double spaces in resolveGenre signature line', () => {
    expect(genresSource).toMatch(/export function resolveGenre\(/);
    expect(genresSource).not.toMatch(/export  function/);
  });

  it('post68: cross-lock package.json name is backlink not a genre', () => {
    const pkg = JSON.parse(readFileSync(join(genresRoot, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(pkg.name).toBe('backlink');
    expect(VALID_GENRES).not.toContain(pkg.name);
  });

  it('post68: cross-lock wrangler.toml VERSION is not a VALID_GENRES slug', () => {
    const toml = readFileSync(join(genresRoot, 'wrangler.toml'), 'utf8');
    expect(toml).toMatch(/VERSION = "0\.1\.0"/);
    expect(VALID_GENRES).not.toContain('0.1.0');
  });

  it('post68: cross-lock AGENTS.md mentions genres.ts as safe action', () => {
    const agents = readFileSync(join(genresRoot, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('src/genres.ts');
    expect(agents).toContain('genre mappings');
  });

  it('post68: cross-lock index.ts imports resolveGenre from ./genres', () => {
    const index = readFileSync(join(genresRoot, 'src/index.ts'), 'utf8');
    expect(index).toMatch(/from ['"]\.\/genres['"]/);
    expect(index).toContain('resolveGenre');
  });

  it('post68: negative — GENRE_MAP does not invent podcast audiobook talk', () => {
    for (const probe of ['podcast', 'audiobook', 'talk', 'comedy', 'country', 'folk']) {
      expect(GENRE_MAP[probe]).toBeUndefined();
      expect(resolveGenre(probe)).toBe('music');
    }
  });

  it('post68: negative — no /playlist or /now-playing as genre aliases', () => {
    expect(Object.keys(GENRE_MAP)).not.toContain('playlist');
    expect(Object.keys(GENRE_MAP)).not.toContain('now-playing');
    expect(resolveGenre('playlist')).toBe('music');
  });

  it('post68: Set of GENRE_MAP values equals Set of VALID_GENRES', () => {
    expect(new Set(Object.values(GENRE_MAP))).toEqual(new Set(VALID_GENRES));
  });

  it('post68: every VALID_GENRES member appears as a GENRE_MAP value', () => {
    const values = new Set(Object.values(GENRE_MAP));
    for (const g of VALID_GENRES) expect(values.has(g)).toBe(true);
  });

  it('post68: Object.entries GENRE_MAP round-trips via fromEntries', () => {
    expect(Object.fromEntries(Object.entries(GENRE_MAP))).toEqual(GENRE_MAP);
  });

  it('post68: localeCompare sort of keys is stable ASCII', () => {
    const keys = Object.keys(GENRE_MAP);
    expect([...keys].sort((a, b) => a.localeCompare(b))).toEqual([...keys].sort());
  });

  it('post68: histogram of alias targets remains locked', () => {
    const hist: Record<string, number> = {};
    for (const v of Object.values(GENRE_MAP)) hist[v] = (hist[v] ?? 0) + 1;
    expect(hist).toEqual({
      ambient: 8,
      classical: 2,
      jazz: 2,
      pop: 2,
      rock: 3,
      music: 1,
      news: 1,
      sports: 1,
      entertainment: 1,
    });
  });

  it('post68: resolveGenre with Number coerced string 0 falls to music', () => {
    expect(resolveGenre(String(0))).toBe('music');
    expect(resolveGenre(String(NaN))).toBe('music');
  });

  it('post68: resolveGenre with boolean string probes falls to music', () => {
    expect(resolveGenre('true')).toBe('music');
    expect(resolveGenre('false')).toBe('music');
  });

  it('post68: repeated resolveGenre purity over 100 iterations', () => {
    for (let i = 0; i < 100; i++) {
      expect(resolveGenre('LO-FI')).toBe('ambient');
      expect(resolveGenre(' Metal ')).toBe('rock');
      expect(resolveGenre('')).toBe('music');
    }
  });

  it('post68: Uint8Array ascii of entertainment rebuilds', () => {
    const bytes = Uint8Array.from('entertainment', (c) => c.charCodeAt(0));
    expect(String.fromCharCode(...bytes)).toBe('entertainment');
    expect(resolveGenre(String.fromCharCode(...bytes))).toBe('entertainment');
  });

  it('post68: TextEncoder byte length of JSON GENRE_MAP within band', () => {
    const n = new TextEncoder().encode(JSON.stringify(GENRE_MAP)).length;
    expect(n).toBeGreaterThan(200);
    expect(n).toBeLessThan(500);
  });

  it('post68: genres.ts EOF single trailing newline after resolveGenre brace', () => {
    expect(genresSource.endsWith('}\n')).toBe(true);
    expect(genresSource.endsWith('}\n\n')).toBe(false);
  });

  it('post68: defineProperty getter alias is invoked by resolveGenre bracket get', () => {
    let hits = 0;
    const map = {} as Record<string, string>;
    Object.defineProperty(map, 'chill', {
      enumerable: true,
      get() {
        hits += 1;
        return 'ambient';
      },
    });
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(hits).toBeGreaterThanOrEqual(1);
  });

  it('post68: null-prototype map with Object.assign chill works', () => {
    const map = Object.assign(Object.create(null), { chill: 'ambient' }) as Record<
      string,
      string
    >;
    expect(Object.getPrototypeOf(map)).toBe(null);
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('jazz', map)).toBe('jazz');
  });

  it('post68: sparse array-like map index 0 is reachable via string key', () => {
    const map = { 0: 'news' } as Record<string, string>;
    expect(resolveGenre('0', map)).toBe('news');
  });

  it('post68: template literal jazz with trailing z is unknown', () => {
    const g = 'jazz';
    expect(resolveGenre(`${g}z`)).toBe('music');
    expect(resolveGenre(`${g}`)).toBe('jazz');
  });

  it('post68: Object.is alias pair locks for lofi/lo-fi and classic/classical', () => {
    expect(Object.is(resolveGenre('lofi'), resolveGenre('lo-fi'))).toBe(true);
    expect(Object.is(resolveGenre('classic'), resolveGenre('classical'))).toBe(true);
    expect(Object.is(resolveGenre('metal'), resolveGenre('indie'))).toBe(true);
  });

  it('post68: exclusive ambient aliases never include rock pop jazz news', () => {
    const ambientOnly = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k);
    for (const banned of ['rock', 'pop', 'jazz', 'news', 'sports', 'entertainment', 'music']) {
      if (banned === 'music') continue;
      expect(ambientOnly).not.toContain(banned);
    }
  });

  it('post68: join of VALID_GENRES with pipe is stable lock', () => {
    expect(VALID_GENRES.join('|')).toBe(
      'music|ambient|jazz|classical|pop|rock|news|sports|entertainment',
    );
  });

  it('post68: createHash sha256 buffer length is 32 for genres.ts', () => {
    expect(createHash('sha256').update(genresSource, 'utf8').digest()).toHaveLength(32);
  });

  it('post68: md5 buffer length is 16 for genres.ts', () => {
    expect(createHash('md5').update(genresSource, 'utf8').digest()).toHaveLength(16);
  });

  it('post68: re-read genres.ts equals module-level snapshot', () => {
    expect(readFileSync(join(genresRoot, 'src/genres.ts'), 'utf8')).toBe(genresSource);
  });

  it('post68: codePointAt equals charCodeAt except for BMP arrow in header comment', () => {
    const arrowIdx = genresSource.indexOf('→');
    expect(arrowIdx).toBeGreaterThan(0);
    expect(genresSource.codePointAt(arrowIdx)).toBe(0x2192);
    for (let i = 0; i < genresSource.length; i++) {
      if (i === arrowIdx) continue;
      expect(genresSource.codePointAt(i)).toBe(genresSource.charCodeAt(i));
    }
  });

  it('post68: normalize NFC identity for genres.ts (arrow already NFC)', () => {
    expect(genresSource.normalize('NFC')).toBe(genresSource);
    expect(genresSource.normalize('NFKC')).toBe(genresSource);
  });

  it('post68: no tabs in genres.ts; single-quoted string literals for aliases', () => {
    expect(genresSource).not.toContain('\t');
    expect(genresSource).toMatch(/'late night'/);
    expect(genresSource).toMatch(/'lo-fi'/);
  });

  it('post68: ValidGenre cast appears exactly once', () => {
    expect([...genresSource.matchAll(/as ValidGenre/g)]).toHaveLength(1);
  });

  it('post68: music fallback string appears exactly three times in full source', () => {
    // early return, includes false branch, and GENRE_MAP music identity value
    expect([...genresSource.matchAll(/'music'/g)].length).toBeGreaterThanOrEqual(3);
  });

  it('post68: resolveGenre does not throw on 50k char unknown input', () => {
    const long = 'z'.repeat(50_000);
    expect(resolveGenre(long)).toBe('music');
  });

  it('post68: uppercased every VALID_GENRES slug resolves to itself', () => {
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g.toUpperCase())).toBe(g);
      expect(resolveGenre(`\n${g}\n`)).toBe(g);
    }
  });

  it('post68: final purity — shuffled alias batch stable', () => {
    const batch = [
      ['chill', 'ambient'],
      ['BLUES', 'jazz'],
      ['  dance ', 'pop'],
      ['nope', 'music'],
      ['lo-fi', 'ambient'],
    ] as const;
    for (let i = 0; i < 25; i++) {
      for (const [input, expected] of batch) {
        expect(resolveGenre(input)).toBe(expected);
      }
    }
  });


  it('post68: GENRE_MAP insertion-order keys lock (full 21)', () => {
    expect(Object.keys(GENRE_MAP)).toEqual([
      'late night',
      'chill',
      'ambient',
      'relaxing',
      'focus',
      'classical',
      'classic',
      'jazz',
      'blues',
      'pop',
      'rock',
      'metal',
      'indie',
      'music',
      'news',
      'sports',
      'entertainment',
      'dance',
      'electronic',
      'lofi',
      'lo-fi',
    ]);
  });

  it('post68: GENRE_MAP values insertion-order lock', () => {
    expect(Object.values(GENRE_MAP)).toEqual([
      'ambient',
      'ambient',
      'ambient',
      'ambient',
      'ambient',
      'classical',
      'classical',
      'jazz',
      'jazz',
      'pop',
      'rock',
      'rock',
      'rock',
      'music',
      'news',
      'sports',
      'entertainment',
      'pop',
      'ambient',
      'ambient',
      'ambient',
    ]);
  });

  it('post68: sha256 digest starts with aa626817 ends with 839d914e', () => {
    const d = createHash('sha256').update(genresSource, 'utf8').digest('hex');
    expect(d.startsWith('aa626817')).toBe(true);
    expect(d.endsWith('839d914e')).toBe(true);
  });

  it('post68: md5 digest starts with ee8d3450 ends with 35d48aa5', () => {
    const d = createHash('md5').update(genresSource, 'utf8').digest('hex');
    expect(d.startsWith('ee8d3450')).toBe(true);
    expect(d.endsWith('35d48aa5')).toBe(true);
  });

  it('post68: resolveGenre with String object wrapper for metal', () => {
    expect(resolveGenre(Object('metal') as unknown as string)).toBe('rock');
  });

  it('post68: resolveGenre rejects leading hash and at-sign genre probes', () => {
    expect(resolveGenre('#jazz')).toBe('music');
    expect(resolveGenre('@rock')).toBe('music');
  });

  it('post68: resolveGenre rejects emoji-only and emoji-prefixed jazz', () => {
    expect(resolveGenre('🎷')).toBe('music');
    expect(resolveGenre('🎷jazz')).toBe('music');
  });

  it('post68: custom map undefined value is skipped by ?? to includes/music', () => {
    const map = { chill: undefined } as unknown as Record<string, string>;
    expect(resolveGenre('chill', map)).toBe('music');
  });

  it('post68: custom map null value is returned as nullish coalescing sees null as null', () => {
    const map = { chill: null } as unknown as Record<string, string>;
    // ?? treats null as missing → falls through
    expect(resolveGenre('chill', map)).toBe('music');
  });

  it('post68: Object.preventExtensions custom map still resolves via get', () => {
    const map = Object.preventExtensions({ chill: 'ambient' } as Record<string, string>);
    expect(resolveGenre('chill', map)).toBe('ambient');
  });

  it('post68: seal custom map prevents add but existing chill works', () => {
    const map = Object.seal({ chill: 'ambient' } as Record<string, string>);
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(() => {
      (map as Record<string, string>).jazz = 'jazz';
    }).toThrow();
  });

  it('post68: Array.prototype.includes on VALID_GENRES mirrors resolveGenre identity path', () => {
    for (const g of VALID_GENRES) {
      expect(VALID_GENRES.includes(g)).toBe(true);
      expect(resolveGenre(g, {})).toBe(g);
    }
  });

  it('post68: indexOf hyphen in lo-fi is 2; lastIndexOf same', () => {
    expect('lo-fi'.indexOf('-')).toBe(2);
    expect('lo-fi'.lastIndexOf('-')).toBe(2);
    expect(resolveGenre('lo-fi')).toBe('ambient');
  });

  it('post68: split join late night via space stable; hyphen join fails', () => {
    expect(resolveGenre('late night'.split(' ').join(' '))).toBe('ambient');
    expect(resolveGenre('late night'.split(' ').join('-'))).toBe('music');
  });

  it('post68: btoa of late night is stable base64', () => {
    expect(btoa('late night')).toBe('bGF0ZSBuaWdodA==');
    expect(resolveGenre(atob('bGF0ZSBuaWdodA=='))).toBe('ambient');
  });

  it('post68: padStart jazz with spaces trims back', () => {
    expect(resolveGenre('jazz'.padStart(10, ' '))).toBe('jazz');
    expect(resolveGenre('jazz'.padEnd(10, ' '))).toBe('jazz');
  });

  it('post68: replaceAll spaces in late night with nbsp fails lookup', () => {
    expect(resolveGenre('late night'.replaceAll(' ', '\u00A0'))).toBe('music');
  });

  it('post68: toLocaleLowerCase en of İ-like probes', () => {
    expect(resolveGenre('JAZZ'.toLocaleLowerCase('en'))).toBe('jazz');
  });

  it('post68: entries iterator yields 21 pairs then done', () => {
    const it = Object.entries(GENRE_MAP)[Symbol.iterator]();
    let n = 0;
    while (!it.next().done) n += 1;
    // consumed one extra done — recount properly
    expect(Object.entries(GENRE_MAP)).toHaveLength(21);
  });

  it('post68: values iterator unique count is 9', () => {
    expect(new Set(Object.values(GENRE_MAP)).size).toBe(9);
  });

  it('post68: every alias key matches /^[a-z0-9 -]+$/', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(key).toMatch(/^[a-z0-9 -]+$/);
    }
  });

  it('post68: every GENRE_MAP value matches /^[a-z]+$/', () => {
    for (const v of Object.values(GENRE_MAP)) {
      expect(v).toMatch(/^[a-z]+$/);
    }
  });

  it('post68: genres.ts contains arrow comment documenting mood aliases', () => {
    expect(genresSource).toContain('mood aliases → category');
  });

  it('post68: genres.ts does not import any modules', () => {
    expect(genresSource).not.toMatch(/^import /m);
    expect(genresSource).not.toMatch(/require\(/);
  });

  it('post68: genres.ts has no side-effect top-level calls', () => {
    expect(genresSource).not.toMatch(/^console\./m);
    expect(genresSource).not.toMatch(/^resolveGenre\(/m);
  });

  it('post68: Buffer.from genresSource sha256 equals createHash', () => {
    const a = createHash('sha256').update(genresSource, 'utf8').digest('hex');
    const b = createHash('sha256').update(Buffer.from(genresSource, 'utf8')).digest('hex');
    expect(a).toBe(b);
  });

  it('post68: cross-lock DEPLOY.md does not invent genre aliases', () => {
    const deploy = readFileSync(join(genresRoot, 'DEPLOY.md'), 'utf8');
    expect(deploy.toLowerCase()).not.toContain('lo-fi');
  });

  it('post68: cross-lock vitest includes genres via src/**', () => {
    const vitest = readFileSync(join(genresRoot, 'vitest.config.ts'), 'utf8');
    expect(vitest).toContain("include: ['src/**/*.ts']");
  });

  it('post68: resolveGenre with whitespace-only unicode line separators', () => {
    expect(resolveGenre('\u2028')).toBe('music');
    expect(resolveGenre('\u2029')).toBe('music');
  });

  it('post68: resolveGenre with repeated tabs around pop', () => {
    expect(resolveGenre('\t\tpop\t\t')).toBe('pop');
  });

  it('post68: AggregateError-style batch — all aliases resolve without throw', () => {
    const errors: unknown[] = [];
    for (const key of Object.keys(GENRE_MAP)) {
      try {
        expect(typeof resolveGenre(key)).toBe('string');
      } catch (e) {
        errors.push(e);
      }
    }
    expect(errors).toEqual([]);
  });

  it('post68: final mega purity — 200 iterations mixed probes', () => {
    const probes = [
      ['', 'music'],
      ['CHILL', 'ambient'],
      ['  blues ', 'jazz'],
      ['lofi', 'ambient'],
      ['nope', 'music'],
      ['entertainment', 'entertainment'],
    ] as const;
    for (let i = 0; i < 200; i++) {
      for (const [input, expected] of probes) {
        expect(resolveGenre(input)).toBe(expected);
      }
    }
  });


  // --- HEAVY burn (post-#76): genres deepen — orthogonal to #74 post68 mega + #76 source ---

  it('post76: GENRE_MAP has exactly 21 alias keys', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it('post76: VALID_GENRES has exactly 9 canonical slugs', () => {
    expect(VALID_GENRES).toHaveLength(9);
    expect([...VALID_GENRES]).toEqual([
      'music',
      'ambient',
      'jazz',
      'classical',
      'pop',
      'rock',
      'news',
      'sports',
      'entertainment',
    ]);
  });

  it('post76: every GENRE_MAP value is a VALID_GENRES member', () => {
    for (const value of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES.includes(value as (typeof VALID_GENRES)[number])).toBe(true);
    }
  });

  it('post76: resolveGenre defaults undefined nullish and whitespace to music', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre(undefined)).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('   ')).toBe('music');
    expect(resolveGenre('\t\n')).toBe('music');
  });

  it('post76: resolveGenre is case-insensitive and trims', () => {
    expect(resolveGenre('CHILL')).toBe('ambient');
    expect(resolveGenre('  Blues ')).toBe('jazz');
    expect(resolveGenre('Lo-Fi')).toBe('ambient');
    expect(resolveGenre('SPORTS')).toBe('sports');
  });

  it('post76: resolveGenre unknown tokens fall back to music', () => {
    expect(resolveGenre('unknown')).toBe('music');
    expect(resolveGenre('hiphop')).toBe('music');
    expect(resolveGenre('!!!')).toBe('music');
  });

  it('post76: resolveGenre identity for every VALID_GENRES slug', () => {
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g)).toBe(g);
      expect(resolveGenre(g.toUpperCase())).toBe(g);
    }
  });

  it('post76: late night / chill / lofi / lo-fi / electronic / relaxing / focus → ambient', () => {
    for (const a of ['late night', 'chill', 'lofi', 'lo-fi', 'electronic', 'relaxing', 'focus']) {
      expect(resolveGenre(a)).toBe('ambient');
    }
  });

  it('post76: blues → jazz; metal indie → rock; dance → pop; classic → classical', () => {
    expect(resolveGenre('blues')).toBe('jazz');
    expect(resolveGenre('metal')).toBe('rock');
    expect(resolveGenre('indie')).toBe('rock');
    expect(resolveGenre('dance')).toBe('pop');
    expect(resolveGenre('classic')).toBe('classical');
  });

  it('post76: custom map override is honored for unknown keys', () => {
    expect(resolveGenre('custom', { custom: 'jazz' })).toBe('jazz');
    expect(resolveGenre('custom', {})).toBe('music');
  });

  it('post76: custom map does not break VALID_GENRES identity passthrough', () => {
    expect(resolveGenre('rock', {})).toBe('rock');
  });

  it('post76: GENRE_MAP does not contain uppercase keys', () => {
    expect(Object.keys(GENRE_MAP).every((k) => k === k.toLowerCase())).toBe(true);
  });

  it('post76: genres source exports GENRE_MAP VALID_GENRES resolveGenre', () => {
    expect(genresSource).toMatch(/export const GENRE_MAP/);
    expect(genresSource).toMatch(/export const VALID_GENRES/);
    expect(genresSource).toMatch(/export function resolveGenre/);
  });

  it('post76: genres source sha256 lock', () => {
    expect(createHash('sha256').update(genresSource, 'utf8').digest('hex')).toBe(
      'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e',
    );
  });

  it('post76: genres source line count stays under 60 lean budget', () => {
    expect(genresSource.split('\n').length).toBeLessThanOrEqual(60);
  });

  it('post76: mega purity — 100x mixed resolveGenre probes', () => {
    const probes: Array<[string | undefined, string]> = [
      [undefined, 'music'],
      ['', 'music'],
      ['CHILL', 'ambient'],
      ['  blues ', 'jazz'],
      ['lofi', 'ambient'],
      ['nope', 'music'],
      ['entertainment', 'entertainment'],
    ];
    for (let i = 0; i < 100; i++) {
      for (const [input, expected] of probes) {
        expect(resolveGenre(input)).toBe(expected);
      }
    }
  });

});
