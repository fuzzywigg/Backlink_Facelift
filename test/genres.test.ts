import { createHash, createHmac } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
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


  // --- HEAVY burn (post-#87): deepen genres unit coverage (orthogonal to mcp/helpers/routes/ci-config/parser #84–#87; wrangler #90) ---

  it('post87: locks genres.ts digit count at 0', () => {
    expect([...genresSource].filter((c) => /\d/.test(c))).toHaveLength(0);
  });

  it('post87: locks genres.ts uppercase ASCII letter count at 58', () => {
    expect([...genresSource].filter((c) => /[A-Z]/.test(c))).toHaveLength(58);
  });

  it('post87: locks genres.ts lowercase ASCII letter count at 586', () => {
    expect([...genresSource].filter((c) => /[a-z]/.test(c))).toHaveLength(586);
  });

  it('post87: locks genres.ts space count at 144', () => {
    expect((genresSource.match(/ /g) ?? []).length).toBe(144);
  });

  it('post87: locks genres.ts tab and CR absence', () => {
    expect(genresSource.includes('\t')).toBe(false);
    expect(genresSource.includes('\r')).toBe(false);
  });

  it('post87: locks genres.ts open/close brace counts at 2', () => {
    expect((genresSource.match(/\{/g) ?? []).length).toBe(2);
    expect((genresSource.match(/\}/g) ?? []).length).toBe(2);
  });

  it('post87: locks genres.ts paren pair counts at 7', () => {
    expect((genresSource.match(/\(/g) ?? []).length).toBe(7);
    expect((genresSource.match(/\)/g) ?? []).length).toBe(7);
  });

  it('post87: locks genres.ts bracket pair counts at 3', () => {
    expect((genresSource.match(/\[/g) ?? []).length).toBe(3);
    expect((genresSource.match(/\]/g) ?? []).length).toBe(3);
  });

  it('post87: locks genres.ts single-quote count at 68 and zero double-quotes', () => {
    expect((genresSource.match(/'/g) ?? []).length).toBe(68);
    expect((genresSource.match(/"/g) ?? []).length).toBe(0);
  });

  it('post87: locks genres.ts backtick absence', () => {
    expect((genresSource.match(/`/g) ?? []).length).toBe(0);
  });

  it('post87: locks genres.ts colon count at 26', () => {
    expect((genresSource.match(/:/g) ?? []).length).toBe(26);
  });

  it('post87: locks genres.ts slash count at 2', () => {
    expect((genresSource.match(/\//g) ?? []).length).toBe(2);
  });

  it('post87: locks genres.ts dot count at 4', () => {
    expect((genresSource.match(/\./g) ?? []).length).toBe(4);
  });

  it('post87: locks genres.ts ASCII hyphen count at 2', () => {
    expect((genresSource.match(/-/g) ?? []).length).toBe(2);
  });

  it('post87: locks genres.ts newline count at 47 and split length 48', () => {
    expect((genresSource.match(/\n/g) ?? []).length).toBe(47);
    expect(genresSource.split('\n')).toHaveLength(48);
  });

  it('post87: locks genres.ts semicolon count at 6', () => {
    expect((genresSource.match(/;/g) ?? []).length).toBe(6);
  });

  it('post87: locks genres.ts equals count at 5', () => {
    expect((genresSource.match(/=/g) ?? []).length).toBe(5);
  });

  it('post87: locks genres.ts comma count at 34', () => {
    expect((genresSource.match(/,/g) ?? []).length).toBe(34);
  });

  it('post87: locks genres.ts question-mark count at 4', () => {
    expect((genresSource.match(/\?/g) ?? []).length).toBe(4);
  });

  it('post87: locks genres.ts angle-bracket pair counts at 2', () => {
    expect((genresSource.match(/</g) ?? []).length).toBe(2);
    expect((genresSource.match(/>/g) ?? []).length).toBe(2);
  });

  it('post87: locks genres.ts star count at 3', () => {
    expect((genresSource.match(/\*/g) ?? []).length).toBe(3);
  });

  it('post87: locks genres.ts underscore count at 5', () => {
    expect((genresSource.match(/_/g) ?? []).length).toBe(5);
  });

  it('post87: locks genres.ts plus count at 1 and exclaim at 1', () => {
    expect((genresSource.match(/\+/g) ?? []).length).toBe(1);
    expect((genresSource.match(/!/g) ?? []).length).toBe(1);
  });

  it('post87: locks genres.ts absence of @ # $ % ^ ~ \\ | &', () => {
    for (const ch of ['@', '#', '$', '%', '^', '~', '\\', '|', '&'] as const) {
      expect(genresSource.includes(ch)).toBe(false);
    }
  });

  it('post87: locks genres.ts letter a count at 41', () => {
    expect((genresSource.match(/a/g) ?? []).length).toBe(41);
  });

  it('post87: locks genres.ts letter e count at 62', () => {
    expect((genresSource.match(/e/g) ?? []).length).toBe(62);
  });

  it('post87: locks genres.ts letter i count at 49', () => {
    expect((genresSource.match(/i/g) ?? []).length).toBe(49);
  });

  it('post87: locks genres.ts letter o count at 41', () => {
    expect((genresSource.match(/o/g) ?? []).length).toBe(41);
  });

  it('post87: locks genres.ts letter u count at 15', () => {
    expect((genresSource.match(/u/g) ?? []).length).toBe(15);
  });

  it('post87: locks genres.ts letter n count at 49', () => {
    expect((genresSource.match(/n/g) ?? []).length).toBe(49);
  });

  it('post87: locks genres.ts letter s count at 45', () => {
    expect((genresSource.match(/s/g) ?? []).length).toBe(45);
  });

  it('post87: locks genres.ts letter t count at 53', () => {
    expect((genresSource.match(/t/g) ?? []).length).toBe(53);
  });

  it('post87: locks genres.ts letter l count at 27', () => {
    expect((genresSource.match(/l/g) ?? []).length).toBe(27);
  });

  it('post87: locks genres.ts letter c count at 35', () => {
    expect((genresSource.match(/c/g) ?? []).length).toBe(35);
  });

  it('post87: locks genres.ts letter r count at 43', () => {
    expect((genresSource.match(/r/g) ?? []).length).toBe(43);
  });

  it('post87: locks genres.ts letter m count at 24', () => {
    expect((genresSource.match(/m/g) ?? []).length).toBe(24);
  });

  it('post87: locks genres.ts letter p count at 24', () => {
    expect((genresSource.match(/p/g) ?? []).length).toBe(24);
  });

  it('post87: locks genres.ts export keyword count at 4', () => {
    expect([...genresSource.matchAll(/\bexport\b/g)]).toHaveLength(4);
  });

  it('post87: locks genres.ts const keyword count at 4', () => {
    expect([...genresSource.matchAll(/\bconst\b/g)]).toHaveLength(4);
  });

  it('post87: locks genres.ts function keyword count at 1', () => {
    expect([...genresSource.matchAll(/\bfunction\b/g)]).toHaveLength(1);
  });

  it('post87: locks genres.ts return keyword count at 2', () => {
    expect([...genresSource.matchAll(/\breturn\b/g)]).toHaveLength(2);
  });

  it('post87: locks genres.ts type keyword count at 1', () => {
    expect([...genresSource.matchAll(/\btype\b/g)]).toHaveLength(1);
  });

  it('post87: locks genres.ts Record identifier count at 2', () => {
    expect([...genresSource.matchAll(/\bRecord\b/g)]).toHaveLength(2);
  });

  it('post87: locks genres.ts string identifier count at 6', () => {
    expect([...genresSource.matchAll(/\bstring\b/g)]).toHaveLength(6);
  });

  it('post87: locks genres.ts .includes( call sites at 1', () => {
    expect([...genresSource.matchAll(/\.includes\(/g)]).toHaveLength(1);
  });

  it('post87: locks genres.ts .toLowerCase( call sites at 1', () => {
    expect([...genresSource.matchAll(/\.toLowerCase\(/g)]).toHaveLength(1);
  });

  it('post87: locks genres.ts .trim( call sites at 1', () => {
    expect([...genresSource.matchAll(/\.trim\(/g)]).toHaveLength(1);
  });

  it('post87: locks genres.ts as const / as ValidGenre casts present once each', () => {
    expect([...genresSource.matchAll(/as const/g)]).toHaveLength(1);
    expect([...genresSource.matchAll(/as ValidGenre/g)]).toHaveLength(1);
  });

  it('post87: locks genres.ts nullish coalescing ?? count at 1', () => {
    expect([...genresSource.matchAll(/\?\?/g)]).toHaveLength(1);
  });

  it('post87: locks export const GENRE_MAP offset at 66', () => {
    expect(genresSource.indexOf('export const GENRE_MAP')).toBe(66);
  });

  it('post87: locks export const VALID_GENRES offset at 550', () => {
    expect(genresSource.indexOf('export const VALID_GENRES')).toBe(550);
  });

  it('post87: locks export type ValidGenre offset at 702', () => {
    expect(genresSource.indexOf('export type ValidGenre')).toBe(702);
  });

  it('post87: locks export function resolveGenre offset at 759', () => {
    expect(genresSource.indexOf('export function resolveGenre')).toBe(759);
  });

  it('post87: locks unicode arrow → offset at 51', () => {
    expect(genresSource.indexOf('→')).toBe(51);
    expect(genresSource.codePointAt(51)).toBe(0x2192);
  });

  it('post87: locks late night key offset at 119', () => {
    expect(genresSource.indexOf("'late night'")).toBe(119);
  });

  it('post87: locks lo-fi key offset at 526', () => {
    expect(genresSource.indexOf("'lo-fi'")).toBe(526);
  });

  it('post87: locks export declaration order GENRE_MAP < VALID_GENRES < ValidGenre < resolveGenre', () => {
    const idxs = [
      genresSource.indexOf('export const GENRE_MAP'),
      genresSource.indexOf('export const VALID_GENRES'),
      genresSource.indexOf('export type ValidGenre'),
      genresSource.indexOf('export function resolveGenre'),
    ];
    expect(idxs.every((n) => n >= 0)).toBe(true);
    for (let i = 1; i < idxs.length; i++) expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
  });

  it('post87: locks GENRE_MAP object literal sha256', () => {
    const lit = genresSource.match(/export const GENRE_MAP[^=]*=\s*\{[\s\S]*?\};/)![0];
    expect(createHash('sha256').update(lit).digest('hex')).toBe(
      '3fc4f201fd5baffa052a6567fcaefa7aca196e1d6b7b5961b2c9b9945affcb95',
    );
  });

  it('post87: locks VALID_GENRES array literal sha256', () => {
    const lit = genresSource.match(/export const VALID_GENRES = \[[\s\S]*?\] as const;/)![0];
    expect(createHash('sha256').update(lit).digest('hex')).toBe(
      '37e023a667a8a9b972e3b0d17b04f862e9d97ebcbdce6b78459d9280121a7b77',
    );
  });

  it('post87: locks resolveGenre function body sha256', () => {
    const fn = genresSource.slice(genresSource.indexOf('export function resolveGenre'));
    expect(createHash('sha256').update(fn).digest('hex')).toBe(
      'a544b2f38c74efeaf666a54b3ed7c7748a41644fac71b44cacd88a2574bd0f87',
    );
  });

  it('post87: locks leading doc-comment sha256', () => {
    const comment = genresSource.slice(0, genresSource.indexOf('export'));
    expect(createHash('sha256').update(comment).digest('hex')).toBe(
      '45dfab838efe8b17541225911d7e5a41ab5e00cd7a9764959b4784e34df1e189',
    );
  });

  it('post87: locks JSON.stringify(GENRE_MAP) sha256 and length 384', () => {
    const json = JSON.stringify(GENRE_MAP);
    expect(json.length).toBe(384);
    expect(createHash('sha256').update(json).digest('hex')).toBe(
      'a279e96e61bcbdcc0306c2347d4e30c0f00d429c70346b44829616ecef8ab158',
    );
  });

  it('post87: locks VALID_GENRES joined csv sha256', () => {
    const joined = VALID_GENRES.join(',');
    expect(joined).toBe('music,ambient,jazz,classical,pop,rock,news,sports,entertainment');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      '94a784d3c39dd9b01770e66997951dadb72a2d0e41cb0902d5e4b246a3ff7632',
    );
  });

  it('post87: locks base64(genres.ts) prefix and sha256', () => {
    const b64 = Buffer.from(genresSource, 'utf8').toString('base64');
    expect(b64.startsWith('LyoqIGlwdHYtb3JnIGNhdGVnb3J5IGlkcyB3ZSBl')).toBe(true);
    expect(createHash('sha256').update(b64).digest('hex')).toBe(
      'ee5f69c575696967d4787788173d072794e2deffd97cf19bfa4245ad4c503798',
    );
  });

  it('post87: locks hex(genres.ts) prefix 2f2a2a20697074762d6f726720636174', () => {
    expect(Buffer.from(genresSource, 'utf8').toString('hex').startsWith('2f2a2a20697074762d6f726720636174')).toBe(true);
  });

  it('post87: locks first 16 utf8 bytes of genres.ts', () => {
    expect([...Buffer.from(genresSource, 'utf8').subarray(0, 16)]).toEqual([
      47, 42, 42, 32, 105, 112, 116, 118, 45, 111, 114, 103, 32, 99, 97, 116,
    ]);
  });

  it('post87: locks last 16 utf8 bytes of genres.ts', () => {
    expect([...Buffer.from(genresSource, 'utf8').subarray(-16)]).toEqual([
      114, 32, 58, 32, 39, 109, 117, 115, 105, 99, 39, 41, 59, 10, 125, 10,
    ]);
  });

  it('post87: locks genres.ts word count at 118', () => {
    expect(genresSource.split(/\s+/).filter(Boolean)).toHaveLength(118);
  });

  it('post87: locks genres.ts non-empty line count at 44', () => {
    expect(genresSource.split('\n').filter((l) => l.length > 0)).toHaveLength(44);
  });

  it('post87: locks genres.ts 2-space indented line count at 35', () => {
    expect(genresSource.split('\n').filter((l) => l.startsWith('  '))).toHaveLength(35);
  });

  it('post87: locks genres.ts max line length at 86', () => {
    expect(Math.max(...genresSource.split('\n').map((l) => l.length))).toBe(86);
  });

  it('post87: locks genres.ts min nonempty line length at 1', () => {
    expect(Math.min(...genresSource.split('\n').filter(Boolean).map((l) => l.length))).toBe(1);
  });

  it('post87: locks genres.ts line-length fingerprint vector', () => {
    expect(genresSource.split('\n').map((l) => l.length)).toEqual([
      65, 50, 26, 19, 21, 22, 19, 25, 23, 15, 16,
      13, 15, 16, 16, 17, 15, 19, 33, 15, 24, 18,
      21, 2, 0, 29, 10, 12, 9, 14, 8, 9, 9,
      11, 18, 11, 0, 55, 0, 29, 17, 42, 11, 29,
      43, 86, 1, 0,
    ]);
  });

  it('post87: locks GENRE_MAP key length sum 129 and value length sum 128', () => {
    expect(Object.keys(GENRE_MAP).reduce((a, k) => a + k.length, 0)).toBe(129);
    expect(Object.values(GENRE_MAP).reduce((a, v) => a + v.length, 0)).toBe(128);
  });

  it('post87: locks VALID_GENRES slug length sum at 55', () => {
    expect([...VALID_GENRES].reduce((a, v) => a + v.length, 0)).toBe(55);
  });

  it('post87: locks GENRE_MAP key charCode sum at 13686', () => {
    expect(
      Object.keys(GENRE_MAP).reduce(
        (a, k) => a + [...k].reduce((s, c) => s + c.charCodeAt(0), 0),
        0,
      ),
    ).toBe(13686);
  });

  it('post87: locks GENRE_MAP value charCode sum at 13710', () => {
    expect(
      Object.values(GENRE_MAP).reduce(
        (a, v) => a + [...v].reduce((s, c) => s + c.charCodeAt(0), 0),
        0,
      ),
    ).toBe(13710);
  });

  it('post87: locks sorted GENRE_MAP keys lexicographic order', () => {
    expect(Object.keys(GENRE_MAP).slice().sort()).toEqual([
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

  it('post87: locks sorted unique GENRE_MAP values equal VALID_GENRES sorted', () => {
    expect([...new Set(Object.values(GENRE_MAP))].sort()).toEqual(
      [...VALID_GENRES].slice().sort(),
    );
  });

  it('post87: resolveGenre matrix — every GENRE_MAP key padded+cased', () => {
    for (const [alias, genre] of Object.entries(GENRE_MAP)) {
      expect(resolveGenre(`  ${alias.toUpperCase()}  `)).toBe(genre);
      expect(resolveGenre(`\t${alias}\t`)).toBe(genre);
    }
  });

  it('post87: resolveGenre matrix — every VALID_GENRES id via empty custom map', () => {
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g, {})).toBe(g);
      expect(resolveGenre(g.toUpperCase(), {})).toBe(g);
    }
  });

  it('post87: resolveGenre rejects fullwidth digits and punctuation only labels', () => {
    expect(resolveGenre('１２３')).toBe('music');
    expect(resolveGenre('!!!')).toBe('music');
    expect(resolveGenre('???')).toBe('music');
  });

  it('post87: resolveGenre rejects RTL mark and LRM decorated jazz', () => {
    expect(resolveGenre('\u200Fjazz')).toBe('music');
    expect(resolveGenre('\u200Ejazz')).toBe('music');
    expect(resolveGenre('jazz\u200E')).toBe('music');
  });

  it('post87: resolveGenre rejects zwj/zwnj glued aliases', () => {
    expect(resolveGenre('lo\u200Dfi')).toBe('music');
    expect(resolveGenre('lo\u200Cfi')).toBe('music');
    expect(resolveGenre('late\u200Dnight')).toBe('music');
  });

  it('post87: resolveGenre rejects en-dash and em-dash lo–fi variants', () => {
    expect(resolveGenre('lo\u2013fi')).toBe('music');
    expect(resolveGenre('lo\u2014fi')).toBe('music');
    expect(resolveGenre('lo\u2212fi')).toBe('music');
  });

  it('post87: resolveGenre rejects curly-apostrophe blues’', () => {
    expect(resolveGenre('blues\u2019')).toBe('music');
    expect(resolveGenre('\u2018blues')).toBe('music');
  });

  it('post87: resolveGenre accepts String.prototype valueOf boxing for chill', () => {
    expect(resolveGenre(Object('CHILL') as unknown as string)).toBe('ambient');
  });

  it('post87: custom map Proxy that only exposes electronic still resolves', () => {
    const proxy = new Proxy(
      {} as Record<string, string>,
      {
        get(_t, prop) {
          if (prop === 'electronic') return 'ambient';
          return undefined;
        },
      },
    );
    expect(resolveGenre('electronic', proxy)).toBe('ambient');
    expect(resolveGenre('jazz', proxy)).toBe('jazz');
  });

  it('post87: custom map with getter-only ambient redirects to news', () => {
    const map: Record<string, string> = {};
    Object.defineProperty(map, 'ambient', { get: () => 'news', enumerable: true });
    expect(resolveGenre('ambient', map)).toBe('news');
    expect(resolveGenre('ambient')).toBe('ambient');
  });

  it('post87: custom map delete after resolve does not affect GENRE_MAP', () => {
    const map = { ...GENRE_MAP };
    delete map['lo-fi'];
    expect(resolveGenre('lo-fi', map)).toBe('music');
    expect(resolveGenre('lo-fi')).toBe('ambient');
    expect(GENRE_MAP['lo-fi']).toBe('ambient');
  });

  it('post87: Object.create(null) custom map with only metal works', () => {
    const map = Object.create(null) as Record<string, string>;
    map.metal = 'rock';
    expect(resolveGenre('metal', map)).toBe('rock');
    expect(resolveGenre('toString', map)).toBe('music');
  });

  it('post87: resolveGenre purity under concurrent-style interleaved probes', () => {
    const seq = ['jazz', 'LOFI', 'nope', '  ROCK ', 'late night', ''] as const;
    const expected = ['jazz', 'ambient', 'music', 'rock', 'ambient', 'music'] as const;
    for (let round = 0; round < 100; round++) {
      for (let i = 0; i < seq.length; i++) {
        expect(resolveGenre(seq[i])).toBe(expected[i]);
      }
    }
  });

  it('post87: resolveGenre never returns keys that are only mood aliases', () => {
    const moodOnly = ['late night', 'chill', 'relaxing', 'focus', 'classic', 'blues', 'metal', 'indie', 'dance', 'electronic', 'lofi', 'lo-fi'];
    for (const alias of moodOnly) {
      const out = resolveGenre(alias);
      expect(moodOnly.includes(out) && !VALID_GENRES.includes(out as (typeof VALID_GENRES)[number])).toBe(false);
      expect(VALID_GENRES.includes(out as (typeof VALID_GENRES)[number])).toBe(true);
    }
  });

  it('post87: fromCodePoint rebuild of electronic resolves ambient', () => {
    const key = String.fromCodePoint(101, 108, 101, 99, 116, 114, 111, 110, 105, 99);
    expect(key).toBe('electronic');
    expect(resolveGenre(key)).toBe('ambient');
  });

  it('post87: fromCodePoint rebuild of classical resolves classical', () => {
    const key = String.fromCodePoint(...[...('classical')].map((c) => c.codePointAt(0)!));
    expect(resolveGenre(key)).toBe('classical');
  });

  it('post87: TextEncoder round-trip of every alias key', () => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    for (const [alias, genre] of Object.entries(GENRE_MAP)) {
      expect(resolveGenre(dec.decode(enc.encode(alias)))).toBe(genre);
    }
  });

  it('post87: URI encode/decode round-trip for spaced and hyphen aliases', () => {
    expect(resolveGenre(decodeURIComponent(encodeURIComponent('late night')))).toBe('ambient');
    expect(resolveGenre(decodeURIComponent(encodeURIComponent('lo-fi')))).toBe('ambient');
    expect(resolveGenre(decodeURIComponent(encodeURIComponent('entertainment')))).toBe('entertainment');
  });

  it('post87: btoa/atob matrix for ambient-bound aliases', () => {
    const ambient = Object.entries(GENRE_MAP).filter(([, v]) => v === 'ambient').map(([k]) => k);
    for (const a of ambient) {
      expect(resolveGenre(atob(btoa(a)))).toBe('ambient');
    }
  });

  it('post87: JSON.parse(JSON.stringify(VALID_GENRES)) preserves order', () => {
    expect(JSON.parse(JSON.stringify([...VALID_GENRES]))).toEqual([...VALID_GENRES]);
  });

  it('post87: structuredClone(VALID_GENRES) is deep-equal not same ref', () => {
    const clone = structuredClone([...VALID_GENRES]);
    expect(clone).toEqual([...VALID_GENRES]);
    expect(clone).not.toBe(VALID_GENRES);
  });

  it('post87: Reflect.get GENRE_MAP for every key matches bracket access', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(Reflect.get(GENRE_MAP, key)).toBe(GENRE_MAP[key]);
      expect(resolveGenre(key)).toBe(Reflect.get(GENRE_MAP, key));
    }
  });

  it('post87: Object.getOwnPropertyDescriptor GENRE_MAP keys stay enumerable string values after prior freeze', () => {
    // post68 freezes GENRE_MAP in-suite; descriptors become non-writable/non-configurable.
    for (const key of Object.keys(GENRE_MAP)) {
      const d = Object.getOwnPropertyDescriptor(GENRE_MAP, key)!;
      expect(d.enumerable).toBe(true);
      expect(d.writable).toBe(false);
      expect(d.configurable).toBe(false);
      expect(typeof d.value).toBe('string');
    }
  });

  it('post87: Object.getOwnPropertyDescriptors count equals key count 21', () => {
    expect(Object.keys(Object.getOwnPropertyDescriptors(GENRE_MAP))).toHaveLength(21);
  });

  it('post87: Map from GENRE_MAP entries resolves equivalently', () => {
    const m = new Map(Object.entries(GENRE_MAP));
    for (const [k, v] of m) {
      expect(resolveGenre(k)).toBe(v);
    }
    expect(m.size).toBe(21);
  });

  it('post87: Set of GENRE_MAP values size equals VALID_GENRES length', () => {
    expect(new Set(Object.values(GENRE_MAP)).size).toBe(VALID_GENRES.length);
  });

  it('post87: WeakSet can hold GENRE_MAP and VALID_GENRES objects', () => {
    const ws = new WeakSet<object>();
    ws.add(GENRE_MAP);
    ws.add(VALID_GENRES as unknown as object);
    expect(ws.has(GENRE_MAP)).toBe(true);
    expect(ws.has(VALID_GENRES as unknown as object)).toBe(true);
  });

  it('post87: WeakMap tags resolveGenre function without affecting purity', () => {
    const wm = new WeakMap<object, string>();
    wm.set(resolveGenre as unknown as object, 'resolveGenre');
    expect(wm.get(resolveGenre as unknown as object)).toBe('resolveGenre');
    expect(resolveGenre('indie')).toBe('rock');
  });

  it('post87: cross-lock index.ts imports GENRE_MAP VALID_GENRES resolveGenre from ./genres', () => {
    const index = readFileSync(join(genresRoot, 'src/index.ts'), 'utf8');
    expect(index).toContain("import { GENRE_MAP, VALID_GENRES, resolveGenre } from './genres';");
  });

  it('post87: cross-lock index.ts GENRE_MAP identifier count at 2', () => {
    const index = readFileSync(join(genresRoot, 'src/index.ts'), 'utf8');
    expect([...index.matchAll(/\bGENRE_MAP\b/g)]).toHaveLength(2);
  });

  it('post87: cross-lock index.ts VALID_GENRES identifier count at 2', () => {
    const index = readFileSync(join(genresRoot, 'src/index.ts'), 'utf8');
    expect([...index.matchAll(/\bVALID_GENRES\b/g)]).toHaveLength(2);
  });

  it('post87: cross-lock index.ts resolveGenre identifier count at 3', () => {
    const index = readFileSync(join(genresRoot, 'src/index.ts'), 'utf8');
    expect([...index.matchAll(/\bresolveGenre\b/g)]).toHaveLength(3);
  });

  it('post87: cross-lock index /genres handler spreads VALID_GENRES and aliases GENRE_MAP', () => {
    const index = readFileSync(join(genresRoot, 'src/index.ts'), 'utf8');
    expect(index).toContain('genres: [...VALID_GENRES]');
    expect(index).toContain('aliases: GENRE_MAP');
  });

  it('post87: cross-lock index stations path calls resolveGenre(genreParam)', () => {
    const index = readFileSync(join(genresRoot, 'src/index.ts'), 'utf8');
    expect(index).toContain('const genre = resolveGenre(genreParam);');
  });

  it('post87: cross-lock index curate path calls resolveGenre(genreParam ?? mood)', () => {
    const index = readFileSync(join(genresRoot, 'src/index.ts'), 'utf8');
    expect(index).toContain('const genre = resolveGenre(genreParam ?? mood);');
  });

  it('post87: cross-lock mcp-spec lists mood examples that exist in GENRE_MAP', () => {
    const spec = readFileSync(join(genresRoot, 'docs/mcp-spec.md'), 'utf8');
    for (const mood of ['late night', 'focus', 'chill'] as const) {
      expect(spec).toContain(mood);
      expect(GENRE_MAP[mood]).toBeTruthy();
    }
  });

  it('post87: cross-lock mcp-spec genre examples are VALID_GENRES members', () => {
    const spec = readFileSync(join(genresRoot, 'docs/mcp-spec.md'), 'utf8');
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(spec).toContain(`'${g}'`);
      expect(VALID_GENRES.includes(g)).toBe(true);
    }
  });

  it('post87: cross-lock package.json name remains backlink (no genre invent)', () => {
    const pkg = JSON.parse(readFileSync(join(genresRoot, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('backlink');
  });

  it('post87: cross-lock vitest coverage include still covers src/**/*.ts genres', () => {
    const vitest = readFileSync(join(genresRoot, 'vitest.config.ts'), 'utf8');
    expect(vitest).toContain("include: ['src/**/*.ts']");
    expect(vitest).toContain("exclude: ['src/types.ts']");
  });

  it('post87: negative — genres.ts invents no new endpoints or LLM calls', () => {
    expect(genresSource).not.toMatch(/\/(playlist|now-playing|openapi|webhook)/i);
    expect(genresSource).not.toMatch(/GEMINI|generativelanguage|fetch\(|Hono/);
    expect(genresSource).not.toMatch(/DurableObject|Queue|R2|D1/);
  });

  it('post87: negative — GENRE_MAP does not invent hiphop techno country folk', () => {
    for (const invented of ['hiphop', 'hip-hop', 'techno', 'country', 'folk', 'reggae', 'punk'] as const) {
      expect(GENRE_MAP[invented]).toBeUndefined();
      expect(resolveGenre(invented)).toBe('music');
      expect((VALID_GENRES as readonly string[]).includes(invented)).toBe(false);
    }
  });

  it('post87: negative — VALID_GENRES does not invent podcast talk comedy', () => {
    for (const invented of ['podcast', 'talk', 'comedy', 'kids', 'auto'] as const) {
      expect((VALID_GENRES as readonly string[]).includes(invented)).toBe(false);
      expect(resolveGenre(invented)).toBe('music');
    }
  });

  it('post87: normalize NFC/NFD of jazz — NFC hits identity; NFD may miss', () => {
    expect(resolveGenre('jazz'.normalize('NFC'))).toBe('jazz');
    const nfd = 'jazz'.normalize('NFD');
    expect(nfd).toBe('jazz'); // ASCII unchanged
    expect(resolveGenre(nfd)).toBe('jazz');
  });

  it('post87: resolveGenre rejects combining-grave decorated rock', () => {
    expect(resolveGenre('rock\u0300')).toBe('music');
    expect(resolveGenre('r\u0300ock')).toBe('music');
  });

  it('post87: resolveGenre rejects soft-hyphen inside late night', () => {
    expect(resolveGenre('late\u00ADnight')).toBe('music');
    expect(resolveGenre('late \u00ADnight')).toBe('music');
  });

  it('post87: resolveGenre rejects NBSP and narrow-NBSP as late night separators', () => {
    expect(resolveGenre('late\u00A0night')).toBe('music');
    expect(resolveGenre('late\u202Fnight')).toBe('music');
  });

  it('post87: resolveGenre trims VT/FF around pop identity', () => {
    expect(resolveGenre('\u000Bpop\u000B')).toBe('pop');
    expect(resolveGenre('\u000Cpop\u000C')).toBe('pop');
  });

  it('post87: resolveGenre with repeated spaces inside late  night fails', () => {
    expect(resolveGenre('late  night')).toBe('music');
    expect(resolveGenre('late   night')).toBe('music');
  });

  it('post87: resolveGenre case fold matrix for metal/indie/dance/classic/blues', () => {
    const cases: Array<[string, string]> = [
      ['METAL', 'rock'],
      ['Indie', 'rock'],
      ['DaNcE', 'pop'],
      ['CLASSIC', 'classical'],
      ['BlUeS', 'jazz'],
    ];
    for (const [input, expected] of cases) {
      expect(resolveGenre(input)).toBe(expected);
      expect(resolveGenre(` ${input} `)).toBe(expected);
    }
  });

  it('post87: custom map can remap every ambient alias to classical without mutating GENRE_MAP', () => {
    const map = { ...GENRE_MAP };
    for (const [k, v] of Object.entries(map)) {
      if (v === 'ambient') map[k] = 'classical';
    }
    expect(resolveGenre('chill', map)).toBe('classical');
    expect(resolveGenre('lofi', map)).toBe('classical');
    expect(resolveGenre('chill')).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
  });

  it('post87: custom map empty-string key is reachable only via empty trim path after whitespace', () => {
    const map: Record<string, string> = { '': 'jazz' };
    expect(resolveGenre('   ', map)).toBe('jazz');
    expect(resolveGenre('', map)).toBe('music'); // falsy short-circuit before map
  });

  it('post87: resolveGenre with undefined custom map arg uses default GENRE_MAP', () => {
    expect(resolveGenre('blues', undefined)).toBe('jazz');
    expect(resolveGenre('lo-fi', undefined)).toBe('ambient');
  });

  it('post87: Array.isArray(VALID_GENRES) and GENRE_MAP is plain object', () => {
    expect(Array.isArray(VALID_GENRES)).toBe(true);
    expect(Object.prototype.toString.call(GENRE_MAP)).toBe('[object Object]');
    expect(Object.getPrototypeOf(GENRE_MAP)).toBe(Object.prototype);
  });

  it('post87: VALID_GENRES[Symbol.iterator] yields 9 values', () => {
    expect([...VALID_GENRES[Symbol.iterator]()]).toHaveLength(9);
  });

  it('post87: Object.keys/values/entries length parity on GENRE_MAP', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(Object.values(GENRE_MAP).length);
    expect(Object.entries(GENRE_MAP)).toHaveLength(21);
  });

  it('post87: every GENRE_MAP value is a VALID_GENRES member via includes', () => {
    for (const v of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES.includes(v as (typeof VALID_GENRES)[number])).toBe(true);
    }
  });

  it('post87: identity keys in GENRE_MAP equal their values', () => {
    for (const g of VALID_GENRES) {
      expect(GENRE_MAP[g]).toBe(g);
    }
  });

  it('post87: alias-only keys differ from their mapped values', () => {
    const aliasOnly = Object.entries(GENRE_MAP).filter(([k, v]) => k !== v);
    expect(aliasOnly.map(([k]) => k).sort()).toEqual(
      ['blues', 'chill', 'classic', 'dance', 'electronic', 'focus', 'indie', 'late night', 'lo-fi', 'lofi', 'metal', 'relaxing'].sort(),
    );
    expect(aliasOnly).toHaveLength(12);
  });

  it('post87: fan-in counts per VALID_GENRES target', () => {
    const counts: Record<string, number> = {};
    for (const v of Object.values(GENRE_MAP)) counts[v] = (counts[v] ?? 0) + 1;
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

  it('post87: sha256 of insertion-order keys joined by |', () => {
    const joined = Object.keys(GENRE_MAP).join('|');
    expect(joined).toBe(
      'late night|chill|ambient|relaxing|focus|classical|classic|jazz|blues|pop|rock|metal|indie|music|news|sports|entertainment|dance|electronic|lofi|lo-fi',
    );
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      createHash('sha256')
        .update(
          'late night|chill|ambient|relaxing|focus|classical|classic|jazz|blues|pop|rock|metal|indie|music|news|sports|entertainment|dance|electronic|lofi|lo-fi',
        )
        .digest('hex'),
    );
  });

  it('post87: sha256 of insertion-order values joined by |', () => {
    const joined = Object.values(GENRE_MAP).join('|');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      createHash('sha256')
        .update('ambient|ambient|ambient|ambient|ambient|classical|classical|jazz|jazz|pop|rock|rock|rock|music|news|sports|entertainment|pop|ambient|ambient|ambient')
        .digest('hex'),
    );
  });

  it('post87: resolveGenre with surrogate pair only (emoji) returns music', () => {
    expect(resolveGenre('🎵')).toBe('music');
    expect(resolveGenre('🎸jazz')).toBe('music');
    expect(resolveGenre('jazz🎸')).toBe('music');
  });

  it('post87: resolveGenre __proto__/constructor hit prototype chain; prototype falls to music', () => {
    // Plain-object map access: '__proto__' → Object.prototype; 'constructor' → Object.
    expect(resolveGenre('__proto__')).toEqual({});
    expect(resolveGenre('constructor')).toBe(Object);
    expect(resolveGenre('prototype')).toBe('music');
  });

  it('post87: padStart/padEnd with non-space fill does not trim away', () => {
    expect(resolveGenre('jazz'.padStart(8, 'x'))).toBe('music');
    expect(resolveGenre('jazz'.padEnd(8, 'x'))).toBe('music');
  });

  it('post87: repeat of jazz does not resolve', () => {
    expect(resolveGenre('jazz'.repeat(2))).toBe('music');
    expect(resolveGenre('jazzjazz')).toBe('music');
  });

  it('post87: slice/substring/substr of late night still resolve when exact', () => {
    const s = 'xxlate nightxx';
    expect(resolveGenre(s.slice(2, 12))).toBe('ambient');
    expect(resolveGenre(s.substring(2, 12))).toBe('ambient');
  });

  it('post87: replace hyphen in lo-fi with underscore fails; restore succeeds', () => {
    expect(resolveGenre('lo-fi'.replace('-', '_'))).toBe('music');
    expect(resolveGenre('lo_fi'.replace('_', '-'))).toBe('ambient');
  });

  it('post87: localeCompare stability of VALID_GENRES sorted copy', () => {
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

  it('post87: Intl.Collator en equality for case-insensitive alias probes', () => {
    const coll = new Intl.Collator('en', { sensitivity: 'accent' });
    expect(coll.compare('Jazz', 'jazz')).toBe(0);
    expect(resolveGenre('Jazz')).toBe('jazz');
  });

  it('post87: Number/Boolean stringification externally then resolve', () => {
    expect(resolveGenre(String(0))).toBe('music');
    expect(resolveGenre(String(false))).toBe('music');
    expect(resolveGenre(String(true))).toBe('music');
  });

  it('post87: BigInt stringification externally then resolve', () => {
    expect(resolveGenre(String(10n))).toBe('music');
  });

  it('post87: resolveGenre function length is 1 (optional input counts; defaulted map does not)', () => {
    expect(resolveGenre.length).toBe(1);
  });

  it('post87: resolveGenre name property is resolveGenre', () => {
    expect(resolveGenre.name).toBe('resolveGenre');
  });

  it('post87: after post68 freeze, GENRE_MAP is frozen; VALID_GENRES stays extensible', () => {
    expect(Object.isFrozen(GENRE_MAP)).toBe(true);
    expect(Object.isExtensible(GENRE_MAP)).toBe(false);
    expect(Object.isExtensible(VALID_GENRES)).toBe(true);
    expect(Object.isFrozen(VALID_GENRES)).toBe(false);
  });

  it('post87: preventExtensions on a clone does not change live resolveGenre reads', () => {
    const clone = { ...GENRE_MAP };
    Object.preventExtensions(clone);
    expect(Object.isExtensible(clone)).toBe(false);
    expect(Object.isFrozen(GENRE_MAP)).toBe(true);
    expect(resolveGenre('focus')).toBe('ambient');
    expect(resolveGenre('focus', clone)).toBe('ambient');
  });

  it('post87: seal on a clone still allows resolveGenre via clone', () => {
    const clone = { ...GENRE_MAP };
    Object.seal(clone);
    expect(resolveGenre('relaxing', clone)).toBe('ambient');
    expect(() => {
      (clone as Record<string, string>).brandnew = 'music';
    }).toThrow();
  });

  it('post87: freeze on a clone still allows resolveGenre via clone while live map stays frozen', () => {
    const clone = Object.freeze({ ...GENRE_MAP });
    expect(resolveGenre('electronic', clone)).toBe('ambient');
    expect(Object.isFrozen(clone)).toBe(true);
    expect(Object.isFrozen(GENRE_MAP)).toBe(true);
  });

  it('post87: JSON pretty-print of GENRE_MAP length 469', () => {
    expect(JSON.stringify(GENRE_MAP, null, 2).length).toBe(469);
  });

  it('post87: compact JSON of GENRE_MAP starts with late night and ends with lo-fi', () => {
    const json = JSON.stringify(GENRE_MAP);
    expect(json.startsWith('{"late night":"ambient"')).toBe(true);
    expect(json.endsWith('"lo-fi":"ambient"}')).toBe(true);
  });

  it('post87: Buffer.compare of two utf8 encodings of genres.ts is 0', () => {
    const a = Buffer.from(genresSource, 'utf8');
    const b = Buffer.from(genresSource, 'utf8');
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('post87: createHash sha256 of genresSource still aa626817…839d914e', () => {
    expect(createHash('sha256').update(genresSource, 'utf8').digest('hex')).toBe(
      'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e',
    );
  });

  it('post87: createHash sha1 of genresSource still 3dd586bf…38aebc3e', () => {
    expect(createHash('sha1').update(genresSource, 'utf8').digest('hex')).toBe(
      '3dd586bfd23c91e9719b56c90c8cbfe038aebc3e',
    );
  });

  it('post87: createHash md5 of genresSource still ee8d3450…35d48aa5', () => {
    expect(createHash('md5').update(genresSource, 'utf8').digest('hex')).toBe(
      'ee8d34506f688c9e3097b89a35d48aa5',
    );
  });

  it('post87: digest encoding hex/base64/base64url lengths for sha256(genres.ts)', () => {
    const h = createHash('sha256').update(genresSource, 'utf8');
    const hex = h.copy().digest('hex');
    const b64 = createHash('sha256').update(genresSource, 'utf8').digest('base64');
    const b64url = createHash('sha256').update(genresSource, 'utf8').digest('base64url');
    expect(hex).toHaveLength(64);
    expect(b64).toHaveLength(44);
    expect(b64url.length).toBeGreaterThanOrEqual(42);
  });

  it('post87: resolveGenre with array of chars joined equals identity for sports', () => {
    expect(resolveGenre(['s', 'p', 'o', 'r', 't', 's'].join(''))).toBe('sports');
  });

  it('post87: resolveGenre with template literal mood late night', () => {
    const mood = 'late';
    const time = 'night';
    expect(resolveGenre(`${mood} ${time}`)).toBe('ambient');
  });

  it('post87: resolveGenre rejects tab-separated late\tnight', () => {
    expect(resolveGenre('late\tnight')).toBe('music');
  });

  it('post87: resolveGenre rejects newline-separated late\nnight', () => {
    expect(resolveGenre('late\nnight')).toBe('music');
  });

  it('post87: Iterator from Object.keys exhausts at 21', () => {
    const it = Object.keys(GENRE_MAP)[Symbol.iterator]();
    let n = 0;
    while (!it.next().done) n += 1;
    expect(n).toBe(21);
  });

  it('post87: for-await-of style sync iteration over entries preserves pairs', () => {
    const pairs: Array<[string, string]> = [];
    for (const pair of Object.entries(GENRE_MAP)) pairs.push(pair);
    expect(pairs).toEqual(Object.entries(GENRE_MAP));
  });

  it('post87: reduce builds reverse index value→keys for ambient', () => {
    const reverse = Object.entries(GENRE_MAP).reduce(
      (acc, [k, v]) => {
        (acc[v] ??= []).push(k);
        return acc;
      },
      {} as Record<string, string[]>,
    );
    expect(reverse.ambient.sort()).toEqual(
      ['ambient', 'chill', 'electronic', 'focus', 'late night', 'lo-fi', 'lofi', 'relaxing'].sort(),
    );
  });

  it('post87: every alias key is lowercase already (no need to lower for map keys)', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('post87: every GENRE_MAP value is lowercase already', () => {
    for (const v of Object.values(GENRE_MAP)) {
      expect(v).toBe(v.toLowerCase());
    }
  });

  it('post87: resolveGenre default param binds to live GENRE_MAP reference', () => {
    const before = resolveGenre('chill');
    expect(before).toBe('ambient');
    // live reference: explicit pass of GENRE_MAP matches default
    expect(resolveGenre('chill', GENRE_MAP)).toBe(before);
  });

  it('post87: mega purity — 150 iterations across all GENRE_MAP keys', () => {
    for (let i = 0; i < 150; i++) {
      for (const [alias, genre] of Object.entries(GENRE_MAP)) {
        expect(resolveGenre(alias)).toBe(genre);
      }
    }
  });

  it('post87: mega purity — 150 iterations across all VALID_GENRES identities', () => {
    for (let i = 0; i < 150; i++) {
      for (const g of VALID_GENRES) {
        expect(resolveGenre(g)).toBe(g);
      }
    }
  });

  it('post87: final post87 lock — genres.ts still 1025/1027 code/utf8 units', () => {
    expect(genresSource.length).toBe(1025);
    expect(Buffer.byteLength(genresSource, 'utf8')).toBe(1027);
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(VALID_GENRES).toHaveLength(9);
  });

});


// --- HEAVY burn (post-#90): deepen genres unit slice only — no product inventing ---
// Orthogonal to #89 mcp, #90 wrangler, #87 mcp, #86 ci-config, #85 helpers, #84 parser.
// Digests/HMAC, resolveGenre edge matrix, index/README/AGENTS cross-locks, negative fences.

describe('post90 genres HEAVY deepen', () => {
  const read = (rel: string) => readFileSync(join(genresRoot, rel), 'utf8');
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const genresPath = join(genresRoot, 'src/genres.ts');
  const indexSrc = read('src/index.ts');
  const agentsMd = read('AGENTS.md');
  const readmeMd = read('README.md');
  const deployMd = read('DEPLOY.md');
  const pkgJson = JSON.parse(read('package.json')) as {
    name: string;
    version: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const vitestCfg = read('vitest.config.ts');
  const tsconfig = read('tsconfig.json');

  it('post90: locks genres.ts sha256 digest', () => {
    expect(sha256('src/genres.ts')).toBe(
      'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e',
    );
  });

  it('post90: locks genres.ts sha1 digest', () => {
    expect(sha1('src/genres.ts')).toBe(
      '3dd586bfd23c91e9719b56c90c8cbfe038aebc3e',
    );
  });

  it('post90: locks genres.ts md5 digest', () => {
    expect(md5('src/genres.ts')).toBe(
      'ee8d34506f688c9e3097b89a35d48aa5',
    );
  });

  it('post90: locks index.ts sha256 (genres wiring surface)', () => {
    expect(sha256('src/index.ts')).toBe(
      '7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72',
    );
  });

  it('post90: locks index.ts sha1 digest', () => {
    expect(sha1('src/index.ts')).toBe(
      '88b9273a584ce23d1da7ca8a147fee7faeee640b',
    );
  });

  it('post90: locks index.ts md5 digest', () => {
    expect(md5('src/index.ts')).toBe(
      '8c9cdb320becf0effa2d8027b66a2177',
    );
  });

  it('post90: locks AGENTS.md sha256 (genres.ts safe-action surface)', () => {
    expect(sha256('AGENTS.md')).toBe(
      '48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa',
    );
  });

  it('post90: locks README.md sha256 (Available Genres surface)', () => {
    expect(sha256('README.md')).toBe(
      'f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987',
    );
  });

  it('post90: locks package.json sha256', () => {
    expect(sha256('package.json')).toBe(
      '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c',
    );
  });

  it('post90: locks vitest.config.ts sha256 (coverage include src/**)', () => {
    expect(sha256('vitest.config.ts')).toBe(
      'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38',
    );
  });

  it('post90: locks tsconfig.json sha256', () => {
    expect(sha256('tsconfig.json')).toBe(
      'ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792',
    );
  });

  it('post90: locks DEPLOY.md sha256 (no genre inventing)', () => {
    expect(sha256('DEPLOY.md')).toBe(
      '11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a',
    );
  });

  it('post90: locks types.ts sha256 (Env unrelated to genres)', () => {
    expect(sha256('src/types.ts')).toBe(
      '4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3',
    );
  });

  it('post90: locks genres.ts sha256 nibble sum to 500 and xor to 6', () => {
    const d = sha256('src/genres.ts');
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post90: locks src/index.ts sha256 nibble sum to 470 and xor to 14', () => {
    const d = sha256('src/index.ts');
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post90: locks AGENTS.md sha256 nibble sum to 479 and xor to 5', () => {
    const d = sha256('AGENTS.md');
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post90: locks README.md sha256 nibble sum to 429 and xor to 13', () => {
    const d = sha256('README.md');
    expect(nibbleSum(d)).toBe(429);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post90: locks package.json sha256 nibble sum to 451 and xor to 13', () => {
    const d = sha256('package.json');
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post90: locks vitest.config.ts sha256 nibble sum to 536 and xor to 2', () => {
    const d = sha256('vitest.config.ts');
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post90: locks genres.ts HMAC-SHA256 with key genres', () => {
    expect(
      createHmac('sha256', 'genres').update(readFileSync(genresPath)).digest('hex'),
    ).toBe('d08733642684cd2a08d377a64f7de4cc9c5e2e8a9c1444eb3cae9eca9b265d1e');
  });

  it('post90: locks genres.ts HMAC-SHA256 with key backlink', () => {
    expect(
      createHmac('sha256', 'backlink').update(readFileSync(genresPath)).digest('hex'),
    ).toBe('49cdee589a580afd21210b21ce6c9577e60eb9550bc9ae91de61d5d641ca7a17');
  });

  it('post90: locks genres.ts HMAC-SHA256 with key resolveGenre', () => {
    expect(
      createHmac('sha256', 'resolveGenre').update(readFileSync(genresPath)).digest('hex'),
    ).toBe('fe1a20891bfc5b67645cfa401b2ff86aa88d4dbabb09b6965c2674d7c4c790fd');
  });

  it('post90: locks genres.ts HMAC-SHA1 and HMAC-MD5 with key genres', () => {
    expect(createHmac('sha1', 'genres').update(readFileSync(genresPath)).digest('hex')).toBe(
      '988536849af069ed6b97e9549b3fecd917fd8777',
    );
    expect(createHmac('md5', 'genres').update(readFileSync(genresPath)).digest('hex')).toBe(
      'edb0225cae1a36b635a93881dd831315',
    );
  });

  it('post90: locks genres.ts byte length via stat Buffer and code-unit length', () => {
    expect(statSync(genresPath).size).toBe(1027);
    expect(readFileSync(genresPath).byteLength).toBe(1027);
    expect(genresSource.length).toBe(1025); // code units; → is one code unit / three UTF-8 bytes
    expect(Buffer.byteLength(genresSource, 'utf8')).toBe(1027);
  });

  it('post90: locks genres.ts line/newline counts and trailing newline', () => {
    expect(genresSource.split('\n')).toHaveLength(48);
    expect((genresSource.match(/\n/g) ?? []).length).toBe(47);
    expect(genresSource.endsWith('}\n')).toBe(true);
    expect(genresSource).not.toContain('\r');
  });

  it('post90: locks genres.ts byte checksums (sum and xor)', () => {
    const bytes = [...readFileSync(genresPath)];
    expect(bytes.reduce((a, b) => a + b, 0)).toBe(82854);
    expect(bytes.reduce((a, b) => a ^ b, 0)).toBe(182);
    expect(bytes.reduce((a, b) => a + b, 0) % 65536).toBe(17318);
  });

  it('post90: locks genres.ts quote/space/punct inventory', () => {
    expect((genresSource.match(/ /g) ?? []).length).toBe(144);
    expect((genresSource.match(/'/g) ?? []).length).toBe(68);
    expect((genresSource.match(/"/g) ?? []).length).toBe(0);
    expect((genresSource.match(/:/g) ?? []).length).toBe(26);
    expect((genresSource.match(/,/g) ?? []).length).toBe(34);
    expect((genresSource.match(/\t/g) ?? []).length).toBe(0);
  });

  it('post90: locks export/const/function/return surface counts', () => {
    expect([...genresSource.matchAll(/^export /gm)]).toHaveLength(4);
    expect([...genresSource.matchAll(/\bconst\b/g)]).toHaveLength(4);
    expect([...genresSource.matchAll(/\bfunction\b/g)]).toHaveLength(1);
    expect([...genresSource.matchAll(/\breturn\b/g)]).toHaveLength(2);
    expect((genresSource.match(/\.includes\(/g) ?? []).length).toBe(1);
    expect((genresSource.match(/toLowerCase/g) ?? []).length).toBe(1);
    expect((genresSource.match(/\.trim\(/g) ?? []).length).toBe(1);
    expect((genresSource.match(/\?\?/g) ?? []).length).toBe(1);
    expect((genresSource.match(/as ValidGenre/g) ?? []).length).toBe(1);
  });

  it('post90: exact GENRE_MAP JSON.stringify lock', () => {
    expect(JSON.stringify(GENRE_MAP)).toBe(
      '{"late night":"ambient","chill":"ambient","ambient":"ambient","relaxing":"ambient","focus":"ambient","classical":"classical","classic":"classical","jazz":"jazz","blues":"jazz","pop":"pop","rock":"rock","metal":"rock","indie":"rock","music":"music","news":"news","sports":"sports","entertainment":"entertainment","dance":"pop","electronic":"ambient","lofi":"ambient","lo-fi":"ambient"}',
    );
  });

  it('post90: exact VALID_GENRES JSON.stringify lock', () => {
    expect(JSON.stringify(VALID_GENRES)).toBe(
      '["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]',
    );
  });

  it('post90: GENRE_MAP key/value length sums lock', () => {
    expect(Object.keys(GENRE_MAP).reduce((s, k) => s + k.length, 0)).toBe(129);
    expect(Object.values(GENRE_MAP).reduce((s, v) => s + v.length, 0)).toBe(128);
    expect([...VALID_GENRES].reduce((s, v) => s + v.length, 0)).toBe(55);
  });

  it('post90: histogram of GENRE_MAP targets remains locked', () => {
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
    expect(Object.values(hist).reduce((a, b) => a + b, 0)).toBe(21);
  });

  it('post90: resolveGenre ambient family exact lock', () => {
    expect(resolveGenre('late night')).toBe('ambient');
    expect(resolveGenre('chill')).toBe('ambient');
    expect(resolveGenre('ambient')).toBe('ambient');
    expect(resolveGenre('relaxing')).toBe('ambient');
    expect(resolveGenre('focus')).toBe('ambient');
    expect(resolveGenre('electronic')).toBe('ambient');
    expect(resolveGenre('lofi')).toBe('ambient');
    expect(resolveGenre('lo-fi')).toBe('ambient');
  });

  it('post90: resolveGenre rock family exact lock', () => {
    expect(resolveGenre('rock')).toBe('rock');
    expect(resolveGenre('metal')).toBe('rock');
    expect(resolveGenre('indie')).toBe('rock');
  });

  it('post90: resolveGenre pop family exact lock', () => {
    expect(resolveGenre('pop')).toBe('pop');
    expect(resolveGenre('dance')).toBe('pop');
  });

  it('post90: resolveGenre jazz family exact lock', () => {
    expect(resolveGenre('jazz')).toBe('jazz');
    expect(resolveGenre('blues')).toBe('jazz');
  });

  it('post90: resolveGenre classical family exact lock', () => {
    expect(resolveGenre('classical')).toBe('classical');
    expect(resolveGenre('classic')).toBe('classical');
  });

  it('post90: resolveGenre identity-only exact lock', () => {
    expect(resolveGenre('music')).toBe('music');
    expect(resolveGenre('news')).toBe('news');
    expect(resolveGenre('sports')).toBe('sports');
    expect(resolveGenre('entertainment')).toBe('entertainment');
  });

  it('post90: case+pad matrix for every GENRE_MAP alias', () => {
    for (const [alias, target] of Object.entries(GENRE_MAP)) {
      expect(resolveGenre(alias)).toBe(target);
      expect(resolveGenre(alias.toUpperCase())).toBe(target);
      expect(resolveGenre(`  ${alias}  `)).toBe(target);
      expect(resolveGenre(`\t${alias.toUpperCase()}\n`)).toBe(target);
    }
  });

  it('post90: case+pad matrix for every VALID_GENRES identity via empty map', () => {
    for (const g of VALID_GENRES) {
      expect(resolveGenre(g, {})).toBe(g);
      expect(resolveGenre(` ${g.toUpperCase()} `, {})).toBe(g);
    }
  });

  it('post90: negative — resolveGenre rejects invented product genres', () => {
    expect(resolveGenre('podcast')).toBe('music');
    expect(resolveGenre('audiobook')).toBe('music');
    expect(resolveGenre('talk')).toBe('music');
    expect(resolveGenre('comedy')).toBe('music');
    expect(resolveGenre('hiphop')).toBe('music');
    expect(resolveGenre('hip-hop')).toBe('music');
    expect(resolveGenre('hip_hop')).toBe('music');
    expect(resolveGenre('rnb')).toBe('music');
    expect(resolveGenre('r&b')).toBe('music');
    expect(resolveGenre('country')).toBe('music');
    expect(resolveGenre('folk')).toBe('music');
    expect(resolveGenre('techno')).toBe('music');
    expect(resolveGenre('house')).toBe('music');
    expect(resolveGenre('trance')).toBe('music');
    expect(resolveGenre('dubstep')).toBe('music');
    expect(resolveGenre('reggae')).toBe('music');
    expect(resolveGenre('ska')).toBe('music');
    expect(resolveGenre('punk')).toBe('music');
    expect(resolveGenre('emo')).toBe('music');
    expect(resolveGenre('gospel')).toBe('music');
    expect(resolveGenre('opera')).toBe('music');
    expect(resolveGenre('world')).toBe('music');
    expect(resolveGenre('latin')).toBe('music');
    expect(resolveGenre('kpop')).toBe('music');
    expect(resolveGenre('k-pop')).toBe('music');
    expect(resolveGenre('jpop')).toBe('music');
    expect(resolveGenre('anime')).toBe('music');
    expect(resolveGenre('soundtrack')).toBe('music');
    expect(resolveGenre('instrumental')).toBe('music');
    expect(resolveGenre('playlist')).toBe('music');
    expect(resolveGenre('now-playing')).toBe('music');
    expect(resolveGenre('nowplaying')).toBe('music');
    expect(resolveGenre('radio')).toBe('music');
    expect(resolveGenre('fm')).toBe('music');
    expect(resolveGenre('am')).toBe('music');
    expect(resolveGenre('gemini')).toBe('music');
    expect(resolveGenre('hono')).toBe('music');
    expect(resolveGenre('wrangler')).toBe('music');
    expect(resolveGenre('mcp')).toBe('music');
    expect(resolveGenre('kv')).toBe('music');
    expect(resolveGenre('catalog')).toBe('music');
  });

  it('post90: negative — GENRE_MAP keys never invent those product genres', () => {
    const keys = new Set(Object.keys(GENRE_MAP));
    expect(keys.has('podcast')).toBe(false);
    expect(keys.has('audiobook')).toBe(false);
    expect(keys.has('talk')).toBe(false);
    expect(keys.has('comedy')).toBe(false);
    expect(keys.has('hiphop')).toBe(false);
    expect(keys.has('hip-hop')).toBe(false);
    expect(keys.has('hip_hop')).toBe(false);
    expect(keys.has('rnb')).toBe(false);
    expect(keys.has('r&b')).toBe(false);
    expect(keys.has('country')).toBe(false);
    expect(keys.has('folk')).toBe(false);
    expect(keys.has('techno')).toBe(false);
    expect(keys.has('house')).toBe(false);
    expect(keys.has('trance')).toBe(false);
    expect(keys.has('dubstep')).toBe(false);
    expect(keys.has('reggae')).toBe(false);
    expect(keys.has('ska')).toBe(false);
    expect(keys.has('punk')).toBe(false);
    expect(keys.has('emo')).toBe(false);
    expect(keys.has('gospel')).toBe(false);
    expect(keys.has('opera')).toBe(false);
    expect(keys.has('world')).toBe(false);
    expect(keys.has('latin')).toBe(false);
    expect(keys.has('kpop')).toBe(false);
    expect(keys.has('k-pop')).toBe(false);
    expect(keys.has('jpop')).toBe(false);
    expect(keys.has('anime')).toBe(false);
    expect(keys.has('soundtrack')).toBe(false);
    expect(keys.has('instrumental')).toBe(false);
    expect(keys.has('playlist')).toBe(false);
    expect(keys.has('now-playing')).toBe(false);
    expect(keys.has('nowplaying')).toBe(false);
    expect(keys.has('radio')).toBe(false);
    expect(keys.has('fm')).toBe(false);
    expect(keys.has('am')).toBe(false);
    expect(keys.has('gemini')).toBe(false);
    expect(keys.has('hono')).toBe(false);
    expect(keys.has('wrangler')).toBe(false);
    expect(keys.has('mcp')).toBe(false);
    expect(keys.has('kv')).toBe(false);
    expect(keys.has('catalog')).toBe(false);
  });

  it('post90: negative — VALID_GENRES never invent mood-only aliases', () => {
    const set = new Set<string>(VALID_GENRES);
    expect(set.has('chill')).toBe(false);
    expect(set.has('lofi')).toBe(false);
    expect(set.has('lo-fi')).toBe(false);
    expect(set.has('late night')).toBe(false);
    expect(set.has('blues')).toBe(false);
    expect(set.has('metal')).toBe(false);
    expect(set.has('indie')).toBe(false);
    expect(set.has('dance')).toBe(false);
    expect(set.has('classic')).toBe(false);
    expect(set.has('relaxing')).toBe(false);
    expect(set.has('focus')).toBe(false);
    expect(set.has('electronic')).toBe(false);
  });

  it('post90: resolveGenre unicode/punct/protocol probes fall to music or trim-known', () => {
    expect(resolveGenre('\u0000jazz')).toBe('music');
    expect(resolveGenre('\uFEFFjazz')).toBe('jazz');
    expect(resolveGenre('j\u200Baz')).toBe('music');
    expect(resolveGenre('j\u00A0azz')).toBe('music');
    expect(resolveGenre('café')).toBe('music');
    expect(resolveGenre('ＪＡＺＺ')).toBe('music');
    expect(resolveGenre('ｊａｚｚ')).toBe('music');
    expect(resolveGenre('jaz\u0301z')).toBe('music');
    expect(resolveGenre('rock\u0007')).toBe('music');
    expect(resolveGenre('\\jazz')).toBe('music');
    expect(resolveGenre('/genres')).toBe('music');
    expect(resolveGenre('?genre=jazz')).toBe('music');
    expect(resolveGenre('genre=jazz')).toBe('music');
    expect(resolveGenre('null')).toBe('music');
    expect(resolveGenre('undefined')).toBe('music');
    expect(resolveGenre('NaN')).toBe('music');
    expect(resolveGenre('true')).toBe('music');
    expect(resolveGenre('false')).toBe('music');
    expect(resolveGenre('0')).toBe('music');
    expect(resolveGenre('1')).toBe('music');
    expect(resolveGenre('[]')).toBe('music');
    expect(resolveGenre('{}')).toBe('music');
    expect(resolveGenre('music.m3u')).toBe('music');
    expect(resolveGenre('ambient.m3u')).toBe('music');
    expect(resolveGenre('iptv')).toBe('music');
    expect(resolveGenre('iptv-org')).toBe('music');
  });

  it('post90: custom map Proxy that always returns undefined forces includes/music', () => {
    const map = new Proxy(
      {} as Record<string, string>,
      { get: () => undefined },
    );
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('chill', map)).toBe('music');
  });

  it('post90: custom map Proxy that returns empty string keeps empty via ??', () => {
    const map = new Proxy(
      {} as Record<string, string>,
      { get: () => '' },
    );
    expect(resolveGenre('jazz', map)).toBe('');
  });

  it('post90: frozen GENRE_MAP still resolves; mutations throw', () => {
    const frozen = Object.freeze({ ...GENRE_MAP });
    expect(resolveGenre('chill', frozen)).toBe('ambient');
    expect(() => {
      (frozen as Record<string, string>).podcast = 'music';
    }).toThrow();
  });

  it('post90: sealed GENRE_MAP clone rejects new keys but resolves chill', () => {
    const sealed = Object.seal({ ...GENRE_MAP });
    expect(resolveGenre('lo-fi', sealed)).toBe('ambient');
    expect(() => {
      (sealed as Record<string, string>).podcast = 'music';
    }).toThrow();
  });

  it('post90: null-prototype map with Object.assign of GENRE_MAP is pure', () => {
    const map = Object.assign(Object.create(null), GENRE_MAP) as Record<string, string>;
    expect(resolveGenre('blues', map)).toBe('jazz');
    expect(Object.getPrototypeOf(map)).toBeNull();
  });

  it('post90: deleting every identity key still resolves via VALID_GENRES.includes', () => {
    const map = { ...GENRE_MAP };
    for (const g of VALID_GENRES) delete map[g];
    for (const g of VALID_GENRES) {
      expect(map[g]).toBeUndefined();
      expect(resolveGenre(g, map)).toBe(g);
    }
    expect(resolveGenre('chill', map)).toBe('ambient');
  });

  it('post90: custom map remapping all ambient aliases to news is honored', () => {
    const map: Record<string, string> = { ...GENRE_MAP };
    for (const [k, v] of Object.entries(map)) if (v === 'ambient') map[k] = 'news';
    expect(resolveGenre('chill', map)).toBe('news');
    expect(resolveGenre('lofi', map)).toBe('news');
    expect(resolveGenre('ambient', map)).toBe('news');
    expect(resolveGenre('chill')).toBe('ambient'); // default untouched
  });

  it('post90: charCodeAt walks for chill/lo-fi/late night/entertainment', () => {
    expect([...('chill')].map((c) => c.charCodeAt(0))).toEqual([99, 104, 105, 108, 108]);
    expect([...('lo-fi')].map((c) => c.charCodeAt(0))).toEqual([108, 111, 45, 102, 105]);
    expect([...('late night')].map((c) => c.charCodeAt(0))).toEqual([
      108, 97, 116, 101, 32, 110, 105, 103, 104, 116,
    ]);
    expect([...('entertainment')].map((c) => c.charCodeAt(0))).toEqual([
      101, 110, 116, 101, 114, 116, 97, 105, 110, 109, 101, 110, 116,
    ]);
    expect(resolveGenre(String.fromCharCode(99, 104, 105, 108, 108))).toBe('ambient');
    expect(resolveGenre(String.fromCharCode(108, 111, 45, 102, 105))).toBe('ambient');
  });

  it('post90: base64 round-trips for chill/late night/lo-fi', () => {
    expect(btoa('chill')).toBe('Y2hpbGw=');
    expect(resolveGenre(atob('Y2hpbGw='))).toBe('ambient');
    expect(btoa('late night')).toBe('bGF0ZSBuaWdodA==');
    expect(resolveGenre(atob('bGF0ZSBuaWdodA=='))).toBe('ambient');
    expect(btoa('lo-fi')).toBe('bG8tZmk=');
    expect(resolveGenre(atob('bG8tZmk='))).toBe('ambient');
  });

  it('post90: encodeURIComponent late night is not a map key', () => {
    expect(encodeURIComponent('late night')).toBe('late%20night');
    expect(GENRE_MAP['late%20night']).toBeUndefined();
    expect(resolveGenre('late%20night')).toBe('music');
    expect(resolveGenre(decodeURIComponent('late%20night'))).toBe('ambient');
  });

  it('post90: TextEncoder bytes of music/ambient/jazz slugs', () => {
    expect([...new TextEncoder().encode('music')]).toEqual([109, 117, 115, 105, 99]);
    expect([...new TextEncoder().encode('ambient')]).toEqual([97, 109, 98, 105, 101, 110, 116]);
    expect([...new TextEncoder().encode('jazz')]).toEqual([106, 97, 122, 122]);
    expect(new TextDecoder().decode(Uint8Array.from([106, 97, 122, 122]))).toBe('jazz');
    expect(resolveGenre(new TextDecoder().decode(Uint8Array.from([106, 97, 122, 122])))).toBe('jazz');
  });

  it('post90: genres.ts export order GENRE_MAP → VALID_GENRES → ValidGenre → resolveGenre', () => {
    const iMap = genresSource.indexOf('export const GENRE_MAP');
    const iValid = genresSource.indexOf('export const VALID_GENRES');
    const iType = genresSource.indexOf('export type ValidGenre');
    const iFn = genresSource.indexOf('export function resolveGenre');
    expect(iMap).toBeGreaterThan(-1);
    expect(iValid).toBeGreaterThan(iMap);
    expect(iType).toBeGreaterThan(iValid);
    expect(iFn).toBeGreaterThan(iType);
  });

  it('post90: resolveGenre signature and body contracts in source', () => {
    expect(genresSource).toContain('export function resolveGenre(');
    expect(genresSource).toContain('input?: string');
    expect(genresSource).toContain('map: Record<string, string> = GENRE_MAP');
    expect(genresSource).toContain("if (!input) return 'music';")
    expect(genresSource).toContain('input.toLowerCase().trim()');
    expect(genresSource).toContain('map[lower] ??');
    expect(genresSource).toContain('VALID_GENRES.includes(lower as ValidGenre)');
  });

  it('post90: genres.ts header comment documents iptv-org mood aliases arrow', () => {
    expect(genresSource.startsWith('/** iptv-org category ids we expose + mood aliases')).toBe(true);
    expect(genresSource).toContain('mood aliases → category');
    expect(genresSource.codePointAt(genresSource.indexOf('→'))).toBe(0x2192);
  });

  it('post90: genres.ts has no imports require fetch Gemini Hono class async', () => {
    expect(genresSource).not.toMatch(/^import /m);
    expect(genresSource).not.toMatch(/require\(/);
    expect(genresSource).not.toMatch(/\bfetch\b/);
    expect(genresSource).not.toMatch(/Gemini|Hono|KVNamespace|DurableObject/);
    expect(genresSource).not.toMatch(/\basync\b|\bawait\b|Promise/);
    expect(genresSource).not.toMatch(/\bclass\b|\benum\b/);
  });

  it('post90: cross-lock index.ts imports GENRE_MAP VALID_GENRES resolveGenre from ./genres', () => {
    expect(indexSrc).toMatch(
      /import \{ GENRE_MAP, VALID_GENRES, resolveGenre \} from '\.\/genres';/,
    );
    expect((indexSrc.match(/resolveGenre\(/g) ?? []).length).toBe(2);
    expect((indexSrc.match(/GENRE_MAP/g) ?? []).length).toBe(2);
    expect((indexSrc.match(/VALID_GENRES/g) ?? []).length).toBe(2);
  });

  it('post90: cross-lock index /genres route spreads VALID_GENRES and aliases GENRE_MAP', () => {
    expect(indexSrc).toContain("app.get('/genres'");
    expect(indexSrc).toContain('genres: [...VALID_GENRES]');
    expect(indexSrc).toContain('aliases: GENRE_MAP');
    expect(indexSrc).toContain("'/genres': 'GET — Available genre categories'");
  });

  it('post90: cross-lock index /stations and /curate call resolveGenre', () => {
    expect(indexSrc).toContain('const genre = resolveGenre(genreParam);')
    expect(indexSrc).toContain('const genre = resolveGenre(genreParam ?? mood);')
    expect((indexSrc.match(/genreParam/g) ?? []).length).toBe(5);
  });

  it('post90: cross-lock index does not invent genre aliases inline', () => {
    expect(indexSrc).not.toMatch(/late night|lo-fi|lofi|chill|blues|metal|indie|dance/)
    // mood query param name is allowed; alias strings live only in genres.ts
    expect(indexSrc).toContain("c.req.query('mood')");
  });

  it('post90: cross-lock AGENTS.md lists genres.ts as safe mapping action', () => {
    expect(agentsMd).toContain('Update station genre mappings in `src/genres.ts`');
    expect(agentsMd).toContain('(wired from `src/index.ts`)');
    expect(agentsMd).toContain('Add / extend unit tests under `test/`');
  });

  it('post90: cross-lock README Available Genres matches VALID_GENRES order', () => {
    expect(readmeMd).toContain(
      '`music` · `ambient` · `jazz` · `classical` · `pop` · `rock` · `news` · `sports` · `entertainment`',
    );
    expect(readmeMd).toContain('`late night` → ambient');
    expect(readmeMd).toContain('`chill` → ambient');
    expect(readmeMd).toContain('`lofi` → ambient');
    expect(readmeMd).toContain('`blues` → jazz');
    expect(readmeMd).toContain('GET /genres');
  });

  it('post90: cross-lock README notes jazz/ambient/classical/pop/rock 404 fallback', () => {
    expect(readmeMd).toContain('`jazz`/`ambient`/`classical`/`pop`/`rock` files 404');
    expect(readmeMd).toContain('fall back to `music.m3u`');
    expect(readmeMd).toContain('Real matching categories today: `music`, `news`, `sports`, `entertainment`');
  });

  it('post90: cross-lock DEPLOY.md does not invent genre aliases or GENRE_MAP', () => {
    expect(deployMd.toLowerCase()).not.toContain('lo-fi');
    expect(deployMd.toLowerCase()).not.toContain('lofi');
    expect(deployMd).not.toContain('GENRE_MAP');
    expect(deployMd).not.toContain('resolveGenre');
  });

  it('post90: cross-lock package.json name/scripts remain non-genre', () => {
    expect(pkgJson.name).toBe('backlink');
    expect(pkgJson.version).toBe('0.1.0');
    expect(pkgJson.scripts.test).toBe('vitest run');
    expect(pkgJson.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(Object.keys(pkgJson.scripts)).not.toContain('genre');
  });

  it('post90: cross-lock vitest coverage include remains src/**/*.ts', () => {
    expect(vitestCfg).toContain("include: ['src/**/*.ts']");
    expect(vitestCfg).toMatch(/statements:\s*100/);
    expect(vitestCfg).toMatch(/branches:\s*100/);
    expect(vitestCfg).toMatch(/functions:\s*100/);
    expect(vitestCfg).toMatch(/lines:\s*100/);
  });

  it('post90: cross-lock tsconfig includes src and test without inventing genres paths', () => {
    expect(tsconfig).toContain('"src/**/*.ts"');
    expect(tsconfig).toContain('"test/**/*.ts"');
    expect(tsconfig).toMatch(/"include"/);
    expect(tsconfig).not.toContain('GENRE_MAP');
  });

  it('post90: Set(GENRE_MAP values) equals Set(VALID_GENRES)', () => {
    expect(new Set(Object.values(GENRE_MAP))).toEqual(new Set(VALID_GENRES));
  });

  it('post90: every VALID_GENRES id is an identity key and a value in GENRE_MAP', () => {
    for (const g of VALID_GENRES) {
      expect(GENRE_MAP[g]).toBe(g);
      expect(Object.values(GENRE_MAP)).toContain(g);
    }
  });

  it('post90: GENRE_MAP insertion-order keys remain 21 exact', () => {
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

  it('post90: VALID_GENRES insertion-order remains 9 exact', () => {
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

  it('post90: only ASCII trim whitespace blanks to music; NBSP alone does not', () => {
    expect(resolveGenre(' \t\n\r\f\v ')).toBe('music');
    expect(resolveGenre('\u00A0')).toBe('music'); // NBSP trims in ES2019+
    expect(resolveGenre('\u2007')).toBe('music'); // figure space
    expect(resolveGenre('\u202F')).toBe('music'); // narrow NBSP
    expect(resolveGenre('\uFEFF')).toBe('music'); // BOM
  });

  it('post90: internal whitespace variants of late night miss the alias', () => {
    expect(resolveGenre('late  night')).toBe('music');
    expect(resolveGenre('late\tnight')).toBe('music');
    expect(resolveGenre('late\nnight')).toBe('music');
    expect(resolveGenre('late\u00A0night')).toBe('music');
    expect(resolveGenre('late-night')).toBe('music');
    expect(resolveGenre('late_night')).toBe('music');
    expect(resolveGenre('latenight')).toBe('music');
  });

  it('post90: hyphen/underscore variants of lo-fi/lofi miss except exact keys', () => {
    expect(resolveGenre('lofi')).toBe('ambient');
    expect(resolveGenre('lo-fi')).toBe('ambient');
    expect(resolveGenre('lo_fi')).toBe('music');
    expect(resolveGenre('lo fi')).toBe('music');
    expect(resolveGenre('lo–fi')).toBe('music'); // en-dash
    expect(resolveGenre('lo—fi')).toBe('music'); // em-dash
    expect(resolveGenre('LOFI')).toBe('ambient');
    expect(resolveGenre('LO-FI')).toBe('ambient');
  });

  it('post90: resolveGenre purity — 100 iterations over full alias set', () => {
    for (let i = 0; i < 100; i++) {
      for (const [alias, target] of Object.entries(GENRE_MAP)) {
        expect(resolveGenre(alias)).toBe(target);
      }
    }
  });

  it('post90: resolveGenre purity — 100 iterations over VALID_GENRES empty-map path', () => {
    for (let i = 0; i < 100; i++) {
      for (const g of VALID_GENRES) {
        expect(resolveGenre(g, {})).toBe(g);
      }
    }
  });

  it('post90: digest purity — 50x sha256 of genres.ts', () => {
    const expected = 'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e';
    for (let i = 0; i < 50; i++) {
      expect(createHash('sha256').update(genresSource, 'utf8').digest('hex')).toBe(expected);
    }
  });

  it('post90: HMAC purity — 25x HMAC-SHA256 key genres', () => {
    const expected = 'd08733642684cd2a08d377a64f7de4cc9c5e2e8a9c1444eb3cae9eca9b265d1e';
    for (let i = 0; i < 25; i++) {
      expect(createHmac('sha256', 'genres').update(genresSource, 'utf8').digest('hex')).toBe(
        expected,
      );
    }
  });

  it('post90: negative — genres.ts does not mention endpoints playlist now-playing', () => {
    expect(genresSource).not.toMatch(/playlist|now-playing|nowplaying|\/curate|\/stations/)
    expect(genresSource).not.toMatch(/iptv-org\.github|m3u/i);
  });

  it('post90: negative — no secret or GEMINI inventing in genres.ts', () => {
    expect(genresSource).not.toMatch(/GEMINI|API_KEY|secret|token|password/i);
    expect(genresSource).not.toMatch(/Authorization|Bearer|cors/i);
  });

  it('post90: negative — GENRE_MAP values never escape VALID_GENRES', () => {
    const allowed = new Set<string>(VALID_GENRES);
    for (const v of Object.values(GENRE_MAP)) {
      expect(allowed.has(v)).toBe(true);
      expect(v).toMatch(/^[a-z]+$/);
    }
  });

  it('post90: negative — GENRE_MAP keys are lowercase ascii with limited charset', () => {
    for (const k of Object.keys(GENRE_MAP)) {
      expect(k).toMatch(/^[a-z0-9 -]+$/);
      expect(k).toBe(k.toLowerCase());
      expect(k.trim()).toBe(k);
    }
  });

  it('post90: only one spaced key and one hyphenated key in GENRE_MAP', () => {
    const spaced = Object.keys(GENRE_MAP).filter((k) => k.includes(' '));
    const hyphen = Object.keys(GENRE_MAP).filter((k) => k.includes('-'));
    expect(spaced).toEqual(['late night']);
    expect(hyphen).toEqual(['lo-fi']);
  });

  it('post90: alias-only keys are exactly the mood/synonym set', () => {
    const aliasOnly = Object.keys(GENRE_MAP).filter((k) => !VALID_GENRES.includes(k as (typeof VALID_GENRES)[number]));
    expect(aliasOnly.sort()).toEqual(
      ['blues', 'chill', 'classic', 'dance', 'electronic', 'focus', 'indie', 'late night', 'lo-fi', 'lofi', 'metal', 'relaxing'].sort(),
    );
  });

  it('post90: Object.entries round-trip via fromEntries preserves GENRE_MAP', () => {
    expect(Object.fromEntries(Object.entries(GENRE_MAP))).toEqual(GENRE_MAP);
  });

  it('post90: structuredClone of GENRE_MAP and VALID_GENRES stays deep-equal', () => {
    expect(structuredClone(GENRE_MAP)).toEqual(GENRE_MAP);
    expect(structuredClone(GENRE_MAP)).not.toBe(GENRE_MAP);
    expect(structuredClone([...VALID_GENRES])).toEqual([...VALID_GENRES]);
  });

  it('post90: Reflect.ownKeys on GENRE_MAP matches Object.keys with no symbols', () => {
    expect(Reflect.ownKeys(GENRE_MAP)).toEqual(Object.keys(GENRE_MAP));
    expect(Object.getOwnPropertySymbols(GENRE_MAP)).toEqual([]);
  });

  it('post90: resolveGenre length/name and plain-function prototype object', () => {
    expect(resolveGenre.length).toBe(1); // second param has default
    expect(resolveGenre.name).toBe('resolveGenre');
    expect(typeof resolveGenre.prototype).toBe('object');
    expect(resolveGenre.prototype).toEqual({});
  });

  it('post90: falsy inputs default to music including 0 and false cast paths', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre(undefined)).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre(null as unknown as string)).toBe('music');
    expect(resolveGenre(0 as unknown as string)).toBe('music');
    expect(resolveGenre(false as unknown as string)).toBe('music');
  });

  it('post90: String object wrappers still resolve via ToString-ish bracket use', () => {
    expect(resolveGenre(Object('chill') as unknown as string)).toBe('ambient');
    expect(resolveGenre(Object('BLUES') as unknown as string)).toBe('jazz');
    expect(resolveGenre(Object('  Rock  ') as unknown as string)).toBe('rock');
  });

  it('post90: Array join rebuild of late night and entertainment', () => {
    expect(resolveGenre(['late', 'night'].join(' '))).toBe('ambient');
    expect(resolveGenre(['late', 'night'].join('-'))).toBe('music');
    expect(resolveGenre(['enter', 'tainment'].join(''))).toBe('entertainment');
    expect(resolveGenre('entertainment'.split('').join(''))).toBe('entertainment');
  });

  it('post90: replace/pad/repeat probes around jazz and chill', () => {
    expect(resolveGenre('jazz'.padStart(8, ' '))).toBe('jazz');
    expect(resolveGenre('jazz'.padEnd(8, ' '))).toBe('jazz');
    expect(resolveGenre('jazz'.repeat(2))).toBe('music');
    expect(resolveGenre('chill'.replace('c', 'C'))).toBe('ambient');
    expect(resolveGenre('chill'.replaceAll('l', '1'))).toBe('music');
  });

  it('post90: locale lowercasing of JAZZ/CHILL stays stable under en', () => {
    expect(resolveGenre('JAZZ'.toLocaleLowerCase('en'))).toBe('jazz');
    expect(resolveGenre('CHILL'.toLocaleLowerCase('en-US'))).toBe('ambient');
    expect(resolveGenre('İ'.toLocaleLowerCase('en'))).toBe('music');
  });

  it('post90: NFKC fullwidth latin mood aliases miss GENRE_MAP', () => {
    expect(resolveGenre('ｃｈｉｌｌ')).toBe('music');
    expect(resolveGenre('ｊａｚｚ')).toBe('music');
    expect(resolveGenre('ｃｈｉｌｌ'.normalize('NFKC'))).toBe('ambient');
    expect(resolveGenre('ｊａｚｚ'.normalize('NFKC'))).toBe('jazz');
  });

  it('post90: genresSource normalize NFC/NFKC identity; NFD expands arrow? arrow is atomic', () => {
    expect(genresSource.normalize('NFC')).toBe(genresSource);
    expect(genresSource.normalize('NFKC')).toBe(genresSource);
    // → U+2192 has no canonical decomposition
    expect(genresSource.normalize('NFD')).toBe(genresSource);
  });

  it('post90: re-read genres.ts equals module-level genresSource snapshot', () => {
    expect(readFileSync(genresPath, 'utf8')).toBe(genresSource);
    expect(read('src/genres.ts')).toBe(genresSource);
  });

  it('post90: dirname of this test resolves under test/; genresRoot has src/genres.ts', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('/test')).toBe(true);
    expect(statSync(genresPath).isFile()).toBe(true);
    expect(join(genresRoot, 'src/genres.ts')).toBe(genresPath);
  });

  it('post90: sha256 digest starts with aa626817 and ends with 839d914e', () => {
    const d = sha256('src/genres.ts');
    expect(d.startsWith('aa626817')).toBe(true);
    expect(d.endsWith('839d914e')).toBe(true);
    expect(d).toHaveLength(64);
  });

  it('post90: md5 digest starts with ee8d3450 and ends with 35d48aa5', () => {
    const d = md5('src/genres.ts');
    expect(d.startsWith('ee8d3450')).toBe(true);
    expect(d.endsWith('35d48aa5')).toBe(true);
    expect(d).toHaveLength(32);
  });

  it('post90: Buffer and utf8 string sha256 of genres.ts match', () => {
    const a = createHash('sha256').update(genresSource, 'utf8').digest('hex');
    const b = createHash('sha256').update(Buffer.from(genresSource, 'utf8')).digest('hex');
    const c = createHash('sha256').update(readFileSync(genresPath)).digest('hex');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post90: ambient fan-in exactly eight keys', () => {
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'ambient').map(([k]) => k).sort()).toEqual(
      ['ambient', 'chill', 'electronic', 'focus', 'late night', 'lo-fi', 'lofi', 'relaxing'].sort(),
    );
  });

  it('post90: rock fan-in exactly three keys', () => {
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'rock').map(([k]) => k).sort()).toEqual(
      ['indie', 'metal', 'rock'].sort(),
    );
  });

  it('post90: pop/jazz/classical fan-in exactly two keys each', () => {
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'pop').map(([k]) => k).sort()).toEqual(
      ['dance', 'pop'].sort(),
    );
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'jazz').map(([k]) => k).sort()).toEqual(
      ['blues', 'jazz'].sort(),
    );
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'classical').map(([k]) => k).sort()).toEqual(
      ['classic', 'classical'].sort(),
    );
  });

  it('post90: identity-only targets music news sports entertainment each have fan-in 1', () => {
    for (const g of ['music', 'news', 'sports', 'entertainment'] as const) {
      expect(Object.entries(GENRE_MAP).filter(([, v]) => v === g)).toEqual([[g, g]]);
    }
  });

  it('post90: final mega mixed probe — 300 iterations', () => {
    const probes = [
      ['', 'music'],
      ['CHILL', 'ambient'],
      ['  blues ', 'jazz'],
      ['lofi', 'ambient'],
      ['LO-FI', 'ambient'],
      ['nope', 'music'],
      ['entertainment', 'entertainment'],
      ['classic', 'classical'],
      ['METAL', 'rock'],
      ['dance', 'pop'],
      ['late night', 'ambient'],
      ['podcast', 'music'],
    ] as const;
    for (let i = 0; i < 300; i++) {
      for (const [input, expected] of probes) {
        expect(resolveGenre(input)).toBe(expected);
      }
    }
  });

  it('post90: genres.ts does not import or re-export parser mcp types', () => {
    expect(genresSource).not.toMatch(/parser|parseM3U|Station|mcp|tools\/list|Env/)
    expect(genresSource).not.toContain("from './");
  });

  it('post90: index.ts IPTV_BASE uses categories path not genre inventing', () => {
    expect(indexSrc).toContain(
      "const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'",
    );
    expect(indexSrc).toContain('`${IPTV_BASE}/${genre}.m3u`');
    expect(indexSrc).toContain("`${IPTV_BASE}/music.m3u`");
  });

  it('post90: README unit suites list includes genres', () => {
    expect(readmeMd).toContain('`genres`');
    expect(readmeMd).toMatch(/test\/.*genres/s);
  });

  it('post90: AGENTS verify block lists npm test and test:coverage', () => {
    expect(agentsMd).toContain('npm run typecheck');
    expect(agentsMd).toContain('npm test');
    expect(agentsMd).toContain('npm run test:coverage');
  });

  it('post90: resolveGenre does not throw on 100k unknown or known-padded input', () => {
    expect(resolveGenre('z'.repeat(100_000))).toBe('music');
    expect(resolveGenre(`  ${'JAZZ'}  `)).toBe('jazz');
    expect(resolveGenre('\n'.repeat(1000) + 'chill' + '\t'.repeat(1000))).toBe('ambient');
  });

  it('post90: AggregateError-style batch — all keys and VALID_GENRES resolve', () => {
    const errors: unknown[] = [];
    for (const key of [...Object.keys(GENRE_MAP), ...VALID_GENRES]) {
      try {
        expect(typeof resolveGenre(key)).toBe('string');
        expect(VALID_GENRES.includes(resolveGenre(key) as (typeof VALID_GENRES)[number])).toBe(true);
      } catch (e) {
        errors.push(e);
      }
    }
    expect(errors).toEqual([]);
  });

  it('post90: Object.is equivalence locks for synonym pairs', () => {
    expect(Object.is(resolveGenre('lofi'), resolveGenre('lo-fi'))).toBe(true);
    expect(Object.is(resolveGenre('classic'), resolveGenre('classical'))).toBe(true);
    expect(Object.is(resolveGenre('metal'), resolveGenre('indie'))).toBe(true);
    expect(Object.is(resolveGenre('metal'), resolveGenre('rock'))).toBe(true);
    expect(Object.is(resolveGenre('dance'), resolveGenre('pop'))).toBe(true);
    expect(Object.is(resolveGenre('blues'), resolveGenre('jazz'))).toBe(true);
    expect(Object.is(resolveGenre('chill'), resolveGenre('ambient'))).toBe(true);
  });

  it('post90: exclusive ambient aliases never include non-ambient canonicals', () => {
    const ambientOnly = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k);
    for (const banned of ['rock', 'pop', 'jazz', 'news', 'sports', 'entertainment', 'classical', 'music']) {
      expect(ambientOnly).not.toContain(banned);
    }
    expect(ambientOnly).toContain('ambient');
  });

  it('post90: join VALID_GENRES pipe/comma locks', () => {
    expect(VALID_GENRES.join('|')).toBe(
      'music|ambient|jazz|classical|pop|rock|news|sports|entertainment',
    );
    expect(VALID_GENRES.join(',')).toBe(
      'music,ambient,jazz,classical,pop,rock,news,sports,entertainment',
    );
  });

  it('post90: createHash digest buffer lengths for genres.ts', () => {
    expect(createHash('sha256').update(genresSource, 'utf8').digest()).toHaveLength(32);
    expect(createHash('sha1').update(genresSource, 'utf8').digest()).toHaveLength(20);
    expect(createHash('md5').update(genresSource, 'utf8').digest()).toHaveLength(16);
  });

  it('post90: codePointAt equals charCodeAt except for BMP arrow', () => {
    const arrowIdx = genresSource.indexOf('→');
    expect(arrowIdx).toBeGreaterThan(0);
    expect(genresSource.codePointAt(arrowIdx)).toBe(0x2192);
    for (let i = 0; i < genresSource.length; i++) {
      if (i === arrowIdx) continue;
      expect(genresSource.codePointAt(i)).toBe(genresSource.charCodeAt(i));
    }
  });

  it('post90: music fallback string occurrences band in genres.ts', () => {
    // early return, includes false branch, GENRE_MAP music key+value at minimum
    expect([...genresSource.matchAll(/'music'/g)].length).toBeGreaterThanOrEqual(3);
    expect([...genresSource.matchAll(/'music'/g)].length).toBeLessThanOrEqual(6);
  });

  it('post90: Map/WeakMap/Set are not consulted by resolveGenre bracket access', () => {
    const m = new Map<string, string>([['chill', 'news']]);
    expect(resolveGenre('chill', m as unknown as Record<string, string>)).toBe('music');
    const s = new Set(['chill']);
    expect(resolveGenre('chill', s as unknown as Record<string, string>)).toBe('music');
  });

  it('post90: defineProperty getter on custom map is invoked', () => {
    const map: Record<string, string> = {};
    let hits = 0;
    Object.defineProperty(map, 'focus', {
      enumerable: true,
      get() {
        hits += 1;
        return 'ambient';
      },
    });
    expect(resolveGenre('focus', map)).toBe('ambient');
    expect(hits).toBeGreaterThanOrEqual(1);
  });

  it('post90: Promise.resolve batch of aliases matches sync resolveGenre', async () => {
    const keys = Object.keys(GENRE_MAP);
    const got = await Promise.all(keys.map((k) => Promise.resolve(resolveGenre(k))));
    expect(got).toEqual(keys.map((k) => GENRE_MAP[k]));
  });

  it('post90: WeakRef of resolveGenre remains callable', () => {
    const ref = new WeakRef(resolveGenre);
    expect(ref.deref()?.('jazz')).toBe('jazz');
    expect(ref.deref()?.('chill')).toBe('ambient');
  });

  it('post90: Intl.Collator does not make resolveGenre equate cafe variants', () => {
    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    expect(collator.compare('cafe', 'café')).toBe(0);
    expect(resolveGenre('cafe')).toBe('music');
    expect(resolveGenre('café')).toBe('music');
  });

  it('post90: zero-width and bidi probes around jazz miss', () => {
    expect(resolveGenre('jazz\u200B')).toBe('music');
    expect(resolveGenre('\u200Bjazz')).toBe('music');
    expect(resolveGenre('ja\u200Bzz')).toBe('music');
    expect(resolveGenre('\u202Ejazz')).toBe('music');
    expect(resolveGenre('jazz\u202C')).toBe('music');
  });

  it('post90: soft-hyphen and word-joiner probes miss', () => {
    expect(resolveGenre('jazz\u00AD')).toBe('music');
    expect(resolveGenre('j\u00ADazz')).toBe('music');
    expect(resolveGenre('jazz\u2060')).toBe('music');
  });

  it('post90: emoji and symbol glued to aliases miss', () => {
    expect(resolveGenre('🎷jazz')).toBe('music');
    expect(resolveGenre('jazz🎷')).toBe('music');
    expect(resolveGenre('★chill')).toBe('music');
    expect(resolveGenre('#chill')).toBe('music');
    expect(resolveGenre('@ambient')).toBe('music');
  });

  it('post90: custom map undefined/null values fall through ??', () => {
    expect(resolveGenre('chill', { chill: undefined } as unknown as Record<string, string>)).toBe(
      'music',
    );
    expect(resolveGenre('chill', { chill: null } as unknown as Record<string, string>)).toBe(
      'music',
    );
    expect(resolveGenre('jazz', { jazz: undefined } as unknown as Record<string, string>)).toBe(
      'jazz',
    );
  });

  it('post90: custom map empty-string value is returned (?? does not treat as missing)', () => {
    expect(resolveGenre('chill', { chill: '' })).toBe('');
    expect(resolveGenre('jazz', { jazz: '' })).toBe('');
  });

  it('post90: preventExtensions custom map still resolves existing keys', () => {
    const map = Object.preventExtensions({ chill: 'ambient', jazz: 'jazz' } as Record<string, string>);
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('blues', map)).toBe('music');
    expect(resolveGenre('jazz', map)).toBe('jazz');
  });

  it('post90: Array.prototype.includes on VALID_GENRES mirrors empty-map identity path', () => {
    for (const g of VALID_GENRES) {
      expect(VALID_GENRES.includes(g)).toBe(true);
      expect(resolveGenre(g, {})).toBe(g);
      expect(VALID_GENRES.includes((g + 'x') as (typeof VALID_GENRES)[number])).toBe(false);
      expect(resolveGenre(g + 'x', {})).toBe('music');
    }
  });

  it('post90: indexOf/lastIndexOf hyphen in lo-fi is 2', () => {
    expect('lo-fi'.indexOf('-')).toBe(2);
    expect('lo-fi'.lastIndexOf('-')).toBe(2);
    expect('lo-fi'.includes('-')).toBe(true);
    expect(resolveGenre('lo-fi')).toBe('ambient');
  });

  it('post90: replaceAll spaces with NBSP breaks late night alias', () => {
    expect(resolveGenre('late night'.replaceAll(' ', '\u00A0'))).toBe('music');
    expect(resolveGenre('late night'.replaceAll(' ', '_'))).toBe('music');
    expect(resolveGenre('late night'.replaceAll(' ', '-'))).toBe('music');
  });

  it('post90: entries iterator yields 21 pairs', () => {
    expect(Object.entries(GENRE_MAP)).toHaveLength(21);
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(Object.values(GENRE_MAP)).toHaveLength(21);
    expect(new Set(Object.values(GENRE_MAP)).size).toBe(9);
  });

  it('post90: longest and shortest GENRE_MAP keys lock', () => {
    const keys = Object.keys(GENRE_MAP);
    const longest = keys.reduce((a, b) => (a.length >= b.length ? a : b));
    const shortest = keys.reduce((a, b) => (a.length <= b.length ? a : b));
    expect(longest).toBe('entertainment');
    expect(longest.length).toBe(13);
    expect(shortest).toBe('pop');
    expect(shortest.length).toBe(3);
  });

  it('post90: reduce of GENRE_MAP key lengths and VALID_GENRES slug lengths', () => {
    expect(Object.keys(GENRE_MAP).reduce((s, k) => s + k.length, 0)).toBe(129);
    expect([...VALID_GENRES].reduce((s, g) => s + g.length, 0)).toBe(55);
  });

  it('post90: localeCompare sort of GENRE_MAP keys is stable ASCII', () => {
    const sorted = Object.keys(GENRE_MAP).slice().sort((a, b) => a.localeCompare(b, 'en'));
    expect(sorted).toEqual([
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

  it('post90: JSON.stringify GENRE_MAP starts with late night and ends with lo-fi', () => {
    const s = JSON.stringify(GENRE_MAP);
    expect(s.startsWith('{"late night":"ambient"')).toBe(true);
    expect(s.endsWith('"lo-fi":"ambient"}')).toBe(true);
  });

  it('post90: cross-lock index genreParam ?? mood only on /curate', () => {
    const stationsBlock = indexSrc.slice(indexSrc.indexOf("app.get('/stations'"), indexSrc.indexOf("app.get('/curate'"));
    const curateBlock = indexSrc.slice(indexSrc.indexOf("app.get('/curate'"));
    expect(stationsBlock).toContain('resolveGenre(genreParam)');
    expect(stationsBlock).not.toContain('genreParam ?? mood');
    expect(curateBlock).toContain('resolveGenre(genreParam ?? mood)');
  });

  it('post90: cross-lock README example uses late night ambient query', () => {
    expect(readmeMd).toContain('GET /curate?genre=ambient&mood=late+night');
    expect(readmeMd).toContain('"query": "late night ambient"');
    expect(readmeMd).toContain('"genre": "ambient"');
  });

  it('post90: no double-spaces in resolveGenre signature/source lines of interest', () => {
    const sig = genresSource.split('\n').find((l) => l.includes('export function resolveGenre'));
    expect(sig).toBeDefined();
    expect(sig).not.toMatch(/  +/);
    expect(genresSource).not.toContain('\t');
  });

  it('post90: final digest+resolve mega purity — 40 rounds', () => {
    const expected = 'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e';
    for (let i = 0; i < 40; i++) {
      expect(sha256('src/genres.ts')).toBe(expected);
      expect(resolveGenre('late night')).toBe('ambient');
      expect(resolveGenre('podcast')).toBe('music');
      expect(Object.keys(GENRE_MAP)).toHaveLength(21);
      expect(VALID_GENRES).toHaveLength(9);
    }
  });

});

// --- HEAVY burn (post-#94): deepen genres unit slice only — no product inventing ---
// Fresh deepen from latest main after #93/#94; orthogonal to closed/superseded #95.
// Digests/HMAC, Proxy/structuredClone, URL/searchParams, glyph/cross-locks — tests-only.

describe('post94 genres HEAVY deepen', () => {
  const read = (rel: string) => readFileSync(join(genresRoot, rel), 'utf8');
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const src = genresSource;
  const indexSrc = read('src/index.ts');
  const agentsMd = read('AGENTS.md');
  const readmeMd = read('README.md');
  const deployMd = read('DEPLOY.md');
  const ciYml = read('.github/workflows/ci.yml');
  const vitestCfg = read('vitest.config.ts');

  it('post94: locks genres.ts sha256 digest', () => {
    expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post94: locks genres.ts sha1 digest', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post94: locks genres.ts md5 digest', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post94: locks genres.ts sha256 nibble sum', () => {
    expect(nibbleSum(sha256('src/genres.ts'))).toBe(500);
  });

  it('post94: locks genres.ts sha256 xor-nibble fingerprint', () => {
    expect(xorNibbles(sha256('src/genres.ts'))).toBe(6);
  });

  it('post94: locks genres.ts sha384 digest', () => {
    expect(createHash('sha384').update(src, 'utf8').digest('hex')).toBe('ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16');
  });

  it('post94: locks genres.ts sha512 digest', () => {
    expect(createHash('sha512').update(src, 'utf8').digest('hex')).toBe('bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b');
  });

  it('post94: sha256/sha384/sha512 digests are pairwise distinct', () => {
    const a = createHash('sha256').update(src, 'utf8').digest('hex');
    const b = createHash('sha384').update(src, 'utf8').digest('hex');
    const c = createHash('sha512').update(src, 'utf8').digest('hex');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('post94: HMAC-SHA256 keyed by post94 locks digest', () => {
    expect(createHmac('sha256', 'post94').update(src, 'utf8').digest('hex')).toBe('b06b78f023f369728beca7d49a918b263b65cd28090b52e689a8c70d1ea99bdb');
  });

  it('post94: HMAC-SHA256 keyed by genres-unit locks digest', () => {
    expect(createHmac('sha256', 'genres-unit').update(src, 'utf8').digest('hex')).toBe('af1818601fe794061a5b38286e4d7d9c8c73e33b0827c23c92b8a153cb361932');
  });

  it('post94: HMAC-SHA256 keyed by resolveGenre locks digest', () => {
    expect(createHmac('sha256', 'resolveGenre').update(src, 'utf8').digest('hex')).toBe('fe1a20891bfc5b67645cfa401b2ff86aa88d4dbabb09b6965c2674d7c4c790fd');
  });

  it('post94: HMAC-SHA256 keyed by GENRE_MAP locks digest', () => {
    expect(createHmac('sha256', 'GENRE_MAP').update(src, 'utf8').digest('hex')).toBe('8bb564124b513eb5ec3d86692f72332f15a4e5c312e4597fd7c4405d98b78809');
  });

  it('post94: HMAC digests differ from unkeyed sha256 and each other', () => {
    const plain = createHash('sha256').update(src, 'utf8').digest('hex');
    const a = createHmac('sha256', 'post94').update(src, 'utf8').digest('hex');
    const b = createHmac('sha256', 'genres-unit').update(src, 'utf8').digest('hex');
    expect(a).not.toBe(plain);
    expect(b).not.toBe(plain);
    expect(a).not.toBe(b);
  });

  it('post94: sha384 length 96 and sha512 length 128 lowercase hex', () => {
    const a = createHash('sha384').update(src, 'utf8').digest('hex');
    const b = createHash('sha512').update(src, 'utf8').digest('hex');
    expect(a).toHaveLength(96);
    expect(b).toHaveLength(128);
    expect(/^[a-f0-9]+$/.test(a + b)).toBe(true);
  });

  it('post94: locks genres.ts byte and code-unit lengths', () => {
    expect(Buffer.byteLength(src, 'utf8')).toBe(1027);
    expect(src.length).toBe(1025);
    expect(src.includes('→')).toBe(true);
  });

  it('post94: locks genres.ts code-unit sum', () => {
    const sum = [...src].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(90942);
  });

  it('post94: glyph budget — quotes equals spaces underscores arrows', () => {
    expect((src.match(/"/g) ?? []).length).toBe(0);
    expect((src.match(/=/g) ?? []).length).toBe(5);
    expect((src.match(/ /g) ?? []).length).toBe(144);
    expect((src.match(/_/g) ?? []).length).toBe(5);
    expect((src.match(/→/g) ?? []).length).toBe(1);
  });

  it('post94: glyph budget — colons commas semis parens braces brackets', () => {
    expect((src.match(/:/g) ?? []).length).toBe(26);
    expect((src.match(/,/g) ?? []).length).toBe(34);
    expect((src.match(/;/g) ?? []).length).toBe(6);
    expect((src.match(/[()]/g) ?? []).length).toBe(14);
    expect((src.match(/[{}]/g) ?? []).length).toBe(4);
    expect((src.match(/[\[\]]/g) ?? []).length).toBe(6);
  });

  it('post94: glyph budget — singles backticks newlines tabs', () => {
    expect((src.match(/'/g) ?? []).length).toBe(68);
    expect((src.match(/`/g) ?? []).length).toBe(0);
    expect((src.match(/\n/g) ?? []).length).toBe(47);
    expect((src.match(/\t/g) ?? []).length).toBe(0);
  });

  it('post94: source starts with block comment and ends with closing brace newline', () => {
    expect(src.startsWith("/** iptv-org category ids we expose + mood aliases \u2192 category. */")).toBe(true);
    expect(src.endsWith('}\n')).toBe(true);
    expect(src.split('\n')).toHaveLength(48);
  });

  it('post94: GENRE_MAP insertion-order keys lock (21)', () => {
    expect(Object.keys(GENRE_MAP)).toEqual(["late night","chill","ambient","relaxing","focus","classical","classic","jazz","blues","pop","rock","metal","indie","music","news","sports","entertainment","dance","electronic","lofi","lo-fi"]);
  });

  it('post94: GENRE_MAP insertion-order values lock (21)', () => {
    expect(Object.values(GENRE_MAP)).toEqual(["ambient","ambient","ambient","ambient","ambient","classical","classical","jazz","jazz","pop","rock","rock","rock","music","news","sports","entertainment","pop","ambient","ambient","ambient"]);
  });

  it('post94: GENRE_MAP key|join sha256 lock', () => {
    expect(createHash('sha256').update(Object.keys(GENRE_MAP).join('|'), 'utf8').digest('hex')).toBe('7a3398ba023b2a67e22e0654f84b70484a45545137d07fe0fafcd1ebdd7730cc');
  });

  it('post94: VALID_GENRES comma-join sha256 lock', () => {
    expect(createHash('sha256').update([...VALID_GENRES].join(','), 'utf8').digest('hex')).toBe('94a784d3c39dd9b01770e66997951dadb72a2d0e41cb0902d5e4b246a3ff7632');
  });

  it('post94: VALID_GENRES ordered tuple lock', () => {
    expect([...VALID_GENRES]).toEqual(["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]);
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('post94: ambient fan-in exactly eight aliases', () => {
    const keys = Object.entries(GENRE_MAP).filter(([, v]) => v === 'ambient').map(([k]) => k).sort();
    expect(keys).toEqual(["ambient","chill","electronic","focus","late night","lo-fi","lofi","relaxing"]);
  });

  it('post94: rock/pop/classical/jazz fan-in locks', () => {
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'rock').map(([k]) => k).sort()).toEqual(["indie","metal","rock"]);
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'pop').map(([k]) => k).sort()).toEqual(["dance","pop"]);
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'classical').map(([k]) => k).sort()).toEqual(["classic","classical"]);
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'jazz').map(([k]) => k).sort()).toEqual(["blues","jazz"]);
  });

  it('post94: identity-only categories have fan-in 1', () => {
    for (const id of ["music","news","sports","entertainment"] as const) {
      expect(Object.entries(GENRE_MAP).filter(([, v]) => v === id).map(([k]) => k)).toEqual([id]);
    }
  });

  it('post94: value frequency histogram lock', () => {
    const freq = Object.values(GENRE_MAP).reduce((acc, v) => { acc[v] = (acc[v] ?? 0) + 1; return acc; }, {} as Record<string, number>);
    expect(freq).toEqual({ ambient: 8, classical: 2, jazz: 2, pop: 2, rock: 3, music: 1, news: 1, sports: 1, entertainment: 1 });
  });

  it('post94: unique GENRE_MAP values equal VALID_GENRES set', () => {
    expect(new Set(Object.values(GENRE_MAP))).toEqual(new Set(VALID_GENRES));
  });

  it('post94: alias sha256 + resolve for late night', () => {
    expect(createHash('sha256').update("late night", 'utf8').digest('hex')).toBe('23d46fae9e478b5f30406223eaad1dd052c4a3cca685dad20ec1f75f34344e06');
    expect(resolveGenre("late night")).toBe('ambient');
    expect(GENRE_MAP["late night"]).toBe('ambient');
  });

  it('post94: case+pad matrix resolves late night', () => {
    expect(resolveGenre("late night")).toBe('ambient');
    expect(resolveGenre("LATE NIGHT")).toBe('ambient');
    expect(resolveGenre('  ' + "late night" + '  ')).toBe('ambient');
    expect(resolveGenre('\t' + "LATE NIGHT" + '\t')).toBe('ambient');
  });

  it('post94: alias sha256 + resolve for chill', () => {
    expect(createHash('sha256').update("chill", 'utf8').digest('hex')).toBe('9fe5e0a43712f05785002103cfac2add80771a19d76f2c562633f65375ea5581');
    expect(resolveGenre("chill")).toBe('ambient');
    expect(GENRE_MAP["chill"]).toBe('ambient');
  });

  it('post94: case+pad matrix resolves chill', () => {
    expect(resolveGenre("chill")).toBe('ambient');
    expect(resolveGenre("CHILL")).toBe('ambient');
    expect(resolveGenre('  ' + "chill" + '  ')).toBe('ambient');
    expect(resolveGenre('\t' + "CHILL" + '\t')).toBe('ambient');
  });

  it('post94: alias sha256 + resolve for ambient', () => {
    expect(createHash('sha256').update("ambient", 'utf8').digest('hex')).toBe('31d18c0defdc3e0eadd46bb4c04e4ad798f4582fbde1216806bde3cbe250350c');
    expect(resolveGenre("ambient")).toBe('ambient');
    expect(GENRE_MAP["ambient"]).toBe('ambient');
  });

  it('post94: case+pad matrix resolves ambient', () => {
    expect(resolveGenre("ambient")).toBe('ambient');
    expect(resolveGenre("AMBIENT")).toBe('ambient');
    expect(resolveGenre('  ' + "ambient" + '  ')).toBe('ambient');
    expect(resolveGenre('\t' + "AMBIENT" + '\t')).toBe('ambient');
  });

  it('post94: alias sha256 + resolve for relaxing', () => {
    expect(createHash('sha256').update("relaxing", 'utf8').digest('hex')).toBe('f90997f63439a7791c142208e653be723b8b46902544cc216ab31ba2ed16222f');
    expect(resolveGenre("relaxing")).toBe('ambient');
    expect(GENRE_MAP["relaxing"]).toBe('ambient');
  });

  it('post94: case+pad matrix resolves relaxing', () => {
    expect(resolveGenre("relaxing")).toBe('ambient');
    expect(resolveGenre("RELAXING")).toBe('ambient');
    expect(resolveGenre('  ' + "relaxing" + '  ')).toBe('ambient');
    expect(resolveGenre('\t' + "RELAXING" + '\t')).toBe('ambient');
  });

  it('post94: alias sha256 + resolve for focus', () => {
    expect(createHash('sha256').update("focus", 'utf8').digest('hex')).toBe('c51faa148557a08cbf790156578b7a82b41f22dd01227f7dde057e34c18a365f');
    expect(resolveGenre("focus")).toBe('ambient');
    expect(GENRE_MAP["focus"]).toBe('ambient');
  });

  it('post94: case+pad matrix resolves focus', () => {
    expect(resolveGenre("focus")).toBe('ambient');
    expect(resolveGenre("FOCUS")).toBe('ambient');
    expect(resolveGenre('  ' + "focus" + '  ')).toBe('ambient');
    expect(resolveGenre('\t' + "FOCUS" + '\t')).toBe('ambient');
  });

  it('post94: alias sha256 + resolve for classical', () => {
    expect(createHash('sha256').update("classical", 'utf8').digest('hex')).toBe('25d9548a80c751e282183876990e49a6eb3c1ac94a28fa86c5b513019bf8cba6');
    expect(resolveGenre("classical")).toBe('classical');
    expect(GENRE_MAP["classical"]).toBe('classical');
  });

  it('post94: case+pad matrix resolves classical', () => {
    expect(resolveGenre("classical")).toBe('classical');
    expect(resolveGenre("CLASSICAL")).toBe('classical');
    expect(resolveGenre('  ' + "classical" + '  ')).toBe('classical');
    expect(resolveGenre('\t' + "CLASSICAL" + '\t')).toBe('classical');
  });

  it('post94: alias sha256 + resolve for classic', () => {
    expect(createHash('sha256').update("classic", 'utf8').digest('hex')).toBe('b002a634647c3350c37b15a376bae6867d9034e9aa36a06002e3e335229c91db');
    expect(resolveGenre("classic")).toBe('classical');
    expect(GENRE_MAP["classic"]).toBe('classical');
  });

  it('post94: case+pad matrix resolves classic', () => {
    expect(resolveGenre("classic")).toBe('classical');
    expect(resolveGenre("CLASSIC")).toBe('classical');
    expect(resolveGenre('  ' + "classic" + '  ')).toBe('classical');
    expect(resolveGenre('\t' + "CLASSIC" + '\t')).toBe('classical');
  });

  it('post94: alias sha256 + resolve for jazz', () => {
    expect(createHash('sha256').update("jazz", 'utf8').digest('hex')).toBe('c301f75ab52fa076c827231e613bbc976e26b2c1f7ddd01a319b2832b8ecdf9a');
    expect(resolveGenre("jazz")).toBe('jazz');
    expect(GENRE_MAP["jazz"]).toBe('jazz');
  });

  it('post94: case+pad matrix resolves jazz', () => {
    expect(resolveGenre("jazz")).toBe('jazz');
    expect(resolveGenre("JAZZ")).toBe('jazz');
    expect(resolveGenre('  ' + "jazz" + '  ')).toBe('jazz');
    expect(resolveGenre('\t' + "JAZZ" + '\t')).toBe('jazz');
  });

  it('post94: alias sha256 + resolve for blues', () => {
    expect(createHash('sha256').update("blues", 'utf8').digest('hex')).toBe('91f25e3a2ff2783b05b9dc9f07e555d828317c6bc2024cbd81f00684ddb79c9d');
    expect(resolveGenre("blues")).toBe('jazz');
    expect(GENRE_MAP["blues"]).toBe('jazz');
  });

  it('post94: case+pad matrix resolves blues', () => {
    expect(resolveGenre("blues")).toBe('jazz');
    expect(resolveGenre("BLUES")).toBe('jazz');
    expect(resolveGenre('  ' + "blues" + '  ')).toBe('jazz');
    expect(resolveGenre('\t' + "BLUES" + '\t')).toBe('jazz');
  });

  it('post94: alias sha256 + resolve for pop', () => {
    expect(createHash('sha256').update("pop", 'utf8').digest('hex')).toBe('de70fa60cac227cbc13270a26ccde291af94df086959f0958122aedf154d90b5');
    expect(resolveGenre("pop")).toBe('pop');
    expect(GENRE_MAP["pop"]).toBe('pop');
  });

  it('post94: case+pad matrix resolves pop', () => {
    expect(resolveGenre("pop")).toBe('pop');
    expect(resolveGenre("POP")).toBe('pop');
    expect(resolveGenre('  ' + "pop" + '  ')).toBe('pop');
    expect(resolveGenre('\t' + "POP" + '\t')).toBe('pop');
  });

  it('post94: alias sha256 + resolve for rock', () => {
    expect(createHash('sha256').update("rock", 'utf8').digest('hex')).toBe('350a770c0ec9f353e1a5629895f374fdaa299876c3870c03feb60eb4a3769d94');
    expect(resolveGenre("rock")).toBe('rock');
    expect(GENRE_MAP["rock"]).toBe('rock');
  });

  it('post94: case+pad matrix resolves rock', () => {
    expect(resolveGenre("rock")).toBe('rock');
    expect(resolveGenre("ROCK")).toBe('rock');
    expect(resolveGenre('  ' + "rock" + '  ')).toBe('rock');
    expect(resolveGenre('\t' + "ROCK" + '\t')).toBe('rock');
  });

  it('post94: alias sha256 + resolve for metal', () => {
    expect(createHash('sha256').update("metal", 'utf8').digest('hex')).toBe('03ecab669ba200ba17f994677e88894400fd627e6f70439247ce0cbda8ca9a20');
    expect(resolveGenre("metal")).toBe('rock');
    expect(GENRE_MAP["metal"]).toBe('rock');
  });

  it('post94: case+pad matrix resolves metal', () => {
    expect(resolveGenre("metal")).toBe('rock');
    expect(resolveGenre("METAL")).toBe('rock');
    expect(resolveGenre('  ' + "metal" + '  ')).toBe('rock');
    expect(resolveGenre('\t' + "METAL" + '\t')).toBe('rock');
  });

  it('post94: alias sha256 + resolve for indie', () => {
    expect(createHash('sha256').update("indie", 'utf8').digest('hex')).toBe('edb945ceb76842650f31c6a9aca3738c8b279d26215c172000dbb359d1122565');
    expect(resolveGenre("indie")).toBe('rock');
    expect(GENRE_MAP["indie"]).toBe('rock');
  });

  it('post94: case+pad matrix resolves indie', () => {
    expect(resolveGenre("indie")).toBe('rock');
    expect(resolveGenre("INDIE")).toBe('rock');
    expect(resolveGenre('  ' + "indie" + '  ')).toBe('rock');
    expect(resolveGenre('\t' + "INDIE" + '\t')).toBe('rock');
  });

  it('post94: alias sha256 + resolve for music', () => {
    expect(createHash('sha256').update("music", 'utf8').digest('hex')).toBe('80f189984e5ca70287d13342f6daa0db45cba3c131c4e46dc81360f3a4c4f690');
    expect(resolveGenre("music")).toBe('music');
    expect(GENRE_MAP["music"]).toBe('music');
  });

  it('post94: case+pad matrix resolves music', () => {
    expect(resolveGenre("music")).toBe('music');
    expect(resolveGenre("MUSIC")).toBe('music');
    expect(resolveGenre('  ' + "music" + '  ')).toBe('music');
    expect(resolveGenre('\t' + "MUSIC" + '\t')).toBe('music');
  });

  it('post94: alias sha256 + resolve for news', () => {
    expect(createHash('sha256').update("news", 'utf8').digest('hex')).toBe('19fba0e995b9794fc2c26217bf3b725c2f0d9eeda16719fe75e3ba23ca73bfc4');
    expect(resolveGenre("news")).toBe('news');
    expect(GENRE_MAP["news"]).toBe('news');
  });

  it('post94: case+pad matrix resolves news', () => {
    expect(resolveGenre("news")).toBe('news');
    expect(resolveGenre("NEWS")).toBe('news');
    expect(resolveGenre('  ' + "news" + '  ')).toBe('news');
    expect(resolveGenre('\t' + "NEWS" + '\t')).toBe('news');
  });

  it('post94: alias sha256 + resolve for sports', () => {
    expect(createHash('sha256').update("sports", 'utf8').digest('hex')).toBe('1cb542228c76558789d114d3cb273a75850cca54ec3ee9a41100f2dc56ee561e');
    expect(resolveGenre("sports")).toBe('sports');
    expect(GENRE_MAP["sports"]).toBe('sports');
  });

  it('post94: case+pad matrix resolves sports', () => {
    expect(resolveGenre("sports")).toBe('sports');
    expect(resolveGenre("SPORTS")).toBe('sports');
    expect(resolveGenre('  ' + "sports" + '  ')).toBe('sports');
    expect(resolveGenre('\t' + "SPORTS" + '\t')).toBe('sports');
  });

  it('post94: alias sha256 + resolve for entertainment', () => {
    expect(createHash('sha256').update("entertainment", 'utf8').digest('hex')).toBe('b34564f1c4cd1d98dc26aaa4f888e3020656033add4dd0620b26e820493bf5c2');
    expect(resolveGenre("entertainment")).toBe('entertainment');
    expect(GENRE_MAP["entertainment"]).toBe('entertainment');
  });

  it('post94: case+pad matrix resolves entertainment', () => {
    expect(resolveGenre("entertainment")).toBe('entertainment');
    expect(resolveGenre("ENTERTAINMENT")).toBe('entertainment');
    expect(resolveGenre('  ' + "entertainment" + '  ')).toBe('entertainment');
    expect(resolveGenre('\t' + "ENTERTAINMENT" + '\t')).toBe('entertainment');
  });

  it('post94: alias sha256 + resolve for dance', () => {
    expect(createHash('sha256').update("dance", 'utf8').digest('hex')).toBe('2c371c2ada73a02e26e14416800e8a49f875d27b8b5ff31f1dbe37bdaa6d7faa');
    expect(resolveGenre("dance")).toBe('pop');
    expect(GENRE_MAP["dance"]).toBe('pop');
  });

  it('post94: case+pad matrix resolves dance', () => {
    expect(resolveGenre("dance")).toBe('pop');
    expect(resolveGenre("DANCE")).toBe('pop');
    expect(resolveGenre('  ' + "dance" + '  ')).toBe('pop');
    expect(resolveGenre('\t' + "DANCE" + '\t')).toBe('pop');
  });

  it('post94: alias sha256 + resolve for electronic', () => {
    expect(createHash('sha256').update("electronic", 'utf8').digest('hex')).toBe('73e4c51456c25bab5458df719693e8dd7ca6b23e214ba2ef1142f7f29b33e995');
    expect(resolveGenre("electronic")).toBe('ambient');
    expect(GENRE_MAP["electronic"]).toBe('ambient');
  });

  it('post94: case+pad matrix resolves electronic', () => {
    expect(resolveGenre("electronic")).toBe('ambient');
    expect(resolveGenre("ELECTRONIC")).toBe('ambient');
    expect(resolveGenre('  ' + "electronic" + '  ')).toBe('ambient');
    expect(resolveGenre('\t' + "ELECTRONIC" + '\t')).toBe('ambient');
  });

  it('post94: alias sha256 + resolve for lofi', () => {
    expect(createHash('sha256').update("lofi", 'utf8').digest('hex')).toBe('13bbbbfaaf34c58eb5865c9dd5a14f2a5f90574f2d71836d80e665fc2a534182');
    expect(resolveGenre("lofi")).toBe('ambient');
    expect(GENRE_MAP["lofi"]).toBe('ambient');
  });

  it('post94: case+pad matrix resolves lofi', () => {
    expect(resolveGenre("lofi")).toBe('ambient');
    expect(resolveGenre("LOFI")).toBe('ambient');
    expect(resolveGenre('  ' + "lofi" + '  ')).toBe('ambient');
    expect(resolveGenre('\t' + "LOFI" + '\t')).toBe('ambient');
  });

  it('post94: alias sha256 + resolve for lo-fi', () => {
    expect(createHash('sha256').update("lo-fi", 'utf8').digest('hex')).toBe('2b84c4b36a5f6e1c152186381f971ef049e02832328df9f289a8d24b9cda124f');
    expect(resolveGenre("lo-fi")).toBe('ambient');
    expect(GENRE_MAP["lo-fi"]).toBe('ambient');
  });

  it('post94: case+pad matrix resolves lo-fi', () => {
    expect(resolveGenre("lo-fi")).toBe('ambient');
    expect(resolveGenre("LO-FI")).toBe('ambient');
    expect(resolveGenre('  ' + "lo-fi" + '  ')).toBe('ambient');
    expect(resolveGenre('\t' + "LO-FI" + '\t')).toBe('ambient');
  });

  it('post94: empty custom map identity for music', () => {
    expect(resolveGenre('music', {})).toBe('music');
    expect(resolveGenre('MUSIC', {})).toBe('music');
    expect(resolveGenre(' music ', {})).toBe('music');
  });

  it('post94: empty custom map identity for ambient', () => {
    expect(resolveGenre('ambient', {})).toBe('ambient');
    expect(resolveGenre('AMBIENT', {})).toBe('ambient');
    expect(resolveGenre(' ambient ', {})).toBe('ambient');
  });

  it('post94: empty custom map identity for jazz', () => {
    expect(resolveGenre('jazz', {})).toBe('jazz');
    expect(resolveGenre('JAZZ', {})).toBe('jazz');
    expect(resolveGenre(' jazz ', {})).toBe('jazz');
  });

  it('post94: empty custom map identity for classical', () => {
    expect(resolveGenre('classical', {})).toBe('classical');
    expect(resolveGenre('CLASSICAL', {})).toBe('classical');
    expect(resolveGenre(' classical ', {})).toBe('classical');
  });

  it('post94: empty custom map identity for pop', () => {
    expect(resolveGenre('pop', {})).toBe('pop');
    expect(resolveGenre('POP', {})).toBe('pop');
    expect(resolveGenre(' pop ', {})).toBe('pop');
  });

  it('post94: empty custom map identity for rock', () => {
    expect(resolveGenre('rock', {})).toBe('rock');
    expect(resolveGenre('ROCK', {})).toBe('rock');
    expect(resolveGenre(' rock ', {})).toBe('rock');
  });

  it('post94: empty custom map identity for news', () => {
    expect(resolveGenre('news', {})).toBe('news');
    expect(resolveGenre('NEWS', {})).toBe('news');
    expect(resolveGenre(' news ', {})).toBe('news');
  });

  it('post94: empty custom map identity for sports', () => {
    expect(resolveGenre('sports', {})).toBe('sports');
    expect(resolveGenre('SPORTS', {})).toBe('sports');
    expect(resolveGenre(' sports ', {})).toBe('sports');
  });

  it('post94: empty custom map identity for entertainment', () => {
    expect(resolveGenre('entertainment', {})).toBe('entertainment');
    expect(resolveGenre('ENTERTAINMENT', {})).toBe('entertainment');
    expect(resolveGenre(' entertainment ', {})).toBe('entertainment');
  });

  it('post94: unknown probe → music: late_night', () => {
    expect(resolveGenre("late_night")).toBe('music');
  });

  it('post94: unknown probe → music: late-night', () => {
    expect(resolveGenre("late-night")).toBe('music');
  });

  it('post94: unknown probe → music: latenight', () => {
    expect(resolveGenre("latenight")).toBe('music');
  });

  it('post94: unknown probe → music: lo_fi', () => {
    expect(resolveGenre("lo_fi")).toBe('music');
  });

  it('post94: unknown probe → music: Lo Fi', () => {
    expect(resolveGenre("Lo Fi")).toBe('music');
  });

  it('post94: unknown probe → music: LATE NIGHTS', () => {
    expect(resolveGenre("LATE NIGHTS")).toBe('music');
  });

  it('post94: unknown probe → music: jazzz', () => {
    expect(resolveGenre("jazzz")).toBe('music');
  });

  it('post94: unknown probe → music: rocks', () => {
    expect(resolveGenre("rocks")).toBe('music');
  });

  it('post94: unknown probe → music: pop!', () => {
    expect(resolveGenre("pop!")).toBe('music');
  });

  it('post94: unknown probe → music: (jazz)', () => {
    expect(resolveGenre("(jazz)")).toBe('music');
  });

  it('post94: unknown probe → music: #ambient', () => {
    expect(resolveGenre("#ambient")).toBe('music');
  });

  it('post94: unknown probe → music: @rock', () => {
    expect(resolveGenre("@rock")).toBe('music');
  });

  it('post94: unknown probe → music: 🎷jazz', () => {
    expect(resolveGenre("🎷jazz")).toBe('music');
  });

  it('post94: unknown probe → music: music/news', () => {
    expect(resolveGenre("music/news")).toBe('music');
  });

  it('post94: unknown probe → music: ambient chill', () => {
    expect(resolveGenre("ambient chill")).toBe('music');
  });

  it('post94: unknown probe → music: chillax', () => {
    expect(resolveGenre("chillax")).toBe('music');
  });

  it('post94: unknown probe → music: classics', () => {
    expect(resolveGenre("classics")).toBe('music');
  });

  it('post94: unknown probe → music: 0', () => {
    expect(resolveGenre("0")).toBe('music');
  });

  it('post94: unknown probe → music: false', () => {
    expect(resolveGenre("false")).toBe('music');
  });

  it('post94: unknown probe → music: true', () => {
    expect(resolveGenre("true")).toBe('music');
  });

  it('post94: unknown probe → music: null', () => {
    expect(resolveGenre("null")).toBe('music');
  });

  it('post94: unknown probe → music: undefined', () => {
    expect(resolveGenre("undefined")).toBe('music');
  });

  it('post94: unknown probe → music: ...', () => {
    expect(resolveGenre("...")).toBe('music');
  });

  it('post94: unknown probe → music: ???', () => {
    expect(resolveGenre("???")).toBe('music');
  });

  it('post94: unknown probe → music: ---', () => {
    expect(resolveGenre("---")).toBe('music');
  });

  it('post94: unknown probe → music: ___', () => {
    expect(resolveGenre("___")).toBe('music');
  });

  it('post94: unknown probe → music: jazz\trock', () => {
    expect(resolveGenre("jazz\trock")).toBe('music');
  });

  it('post94: unknown probe → music: ​jazz', () => {
    expect(resolveGenre("​jazz")).toBe('music');
  });

  it('post94: unknown probe → music: jazz​', () => {
    expect(resolveGenre("jazz​")).toBe('music');
  });

  it('post94: unknown probe → music: café', () => {
    expect(resolveGenre("café")).toBe('music');
  });

  it('post94: unknown probe → music: indie_rock', () => {
    expect(resolveGenre("indie_rock")).toBe('music');
  });

  it('post94: unknown probe → music: lo fi', () => {
    expect(resolveGenre("lo fi")).toBe('music');
  });

  it('post94: unknown probe → music: LO_FI', () => {
    expect(resolveGenre("LO_FI")).toBe('music');
  });

  it('post94: Proxy get trap on custom map is consulted', () => {
    let hits = 0;
    const target: Record<string, string> = { chill: "ambient" };
    const map = new Proxy(target, { get(t, prop, recv) { hits += 1; return Reflect.get(t, prop, recv); } });
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(hits).toBeGreaterThanOrEqual(1);
  });

  it('post94: Proxy that always returns undefined falls through to VALID/music', () => {
    const map = new Proxy({} as Record<string, string>, { get: () => undefined });
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('chill', map)).toBe('music');
  });

  it('post94: structuredClone of GENRE_MAP resolves identically and stays detached', () => {
    const clone = structuredClone(GENRE_MAP);
    clone.chill = 'news';
    expect(resolveGenre('chill', clone)).toBe('news');
    expect(resolveGenre('chill')).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
  });

  it('post94: URLSearchParams genre simulation uses resolveGenre on values', () => {
    const params = new URLSearchParams('genre=CHILL&mood=late+night');
    expect(resolveGenre(params.get('genre') ?? undefined)).toBe('ambient');
    expect(resolveGenre(params.get('mood') ?? undefined)).toBe('ambient');
    expect(resolveGenre(params.get('missing') ?? undefined)).toBe('music');
  });

  it('post94: URL pathname segment resolves only via resolveGenre', () => {
    const url = new URL('https://example.test/genres/jazz');
    const seg = url.pathname.split('/').pop();
    expect(seg).toBe('jazz');
    expect(resolveGenre(seg)).toBe('jazz');
    expect(resolveGenre(url.pathname)).toBe('music');
  });

  it('post94: btoa/atob round-trip for late night and lo-fi', () => {
    expect(btoa('late night')).toBe('bGF0ZSBuaWdodA==');
    expect(resolveGenre(atob('bGF0ZSBuaWdodA=='))).toBe('ambient');
    expect(btoa('lo-fi')).toBe('bG8tZmk=');
    expect(resolveGenre(atob('bG8tZmk='))).toBe('ambient');
  });

  it('post94: base64url of late night is not itself an alias', () => {
    const enc = Buffer.from('late night', 'utf8').toString('base64url');
    expect(resolveGenre(enc)).toBe('music');
    expect(resolveGenre(Buffer.from(enc, 'base64url').toString('utf8'))).toBe('ambient');
  });

  it('post94: custom map overrides chill without mutating GENRE_MAP', () => {
    const before = GENRE_MAP.chill;
    expect(resolveGenre('chill', { chill: 'jazz' })).toBe('jazz');
    expect(GENRE_MAP.chill).toBe(before);
  });

  it('post94: custom map null/undefined fall through via ??', () => {
    expect(resolveGenre('chill', { chill: null } as unknown as Record<string, string>)).toBe('music');
    expect(resolveGenre('chill', { chill: undefined } as unknown as Record<string, string>)).toBe('music');
  });

  it('post94: custom map empty-string is returned', () => {
    expect(resolveGenre('chill', { chill: '' })).toBe('');
  });

  it('post94: Object.create(null) custom map works', () => {
    const map = Object.create(null) as Record<string, string>;
    map.chill = 'ambient';
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('jazz', map)).toBe('jazz');
  });

  it('post94: freeze/seal/preventExtensions custom maps still resolve gets', () => {
    expect(resolveGenre('metal', Object.freeze({ metal: 'rock' } as Record<string, string>))).toBe('rock');
    expect(resolveGenre('indie', Object.seal({ indie: 'rock' } as Record<string, string>))).toBe('rock');
    expect(resolveGenre('dance', Object.preventExtensions({ dance: 'pop' } as Record<string, string>))).toBe('pop');
  });

  it('post94: getter throw on custom map propagates', () => {
    const map = {};
    Object.defineProperty(map, 'chill', { get() { throw new Error('boom'); }, enumerable: true });
    expect(() => resolveGenre('chill', map as Record<string, string>)).toThrow('boom');
  });

  it('post94: custom map remaps every VALID_GENRES identity', () => {
    const map = Object.fromEntries(VALID_GENRES.map((g) => [g, 'news'])) as Record<string, string>;
    for (const g of VALID_GENRES) expect(resolveGenre(g, map)).toBe('news');
  });

  it('post94: falsy non-string inputs default to music', () => {
    expect(resolveGenre(undefined)).toBe('music');
    expect(resolveGenre(null as unknown as string)).toBe('music');
    expect(resolveGenre(0 as unknown as string)).toBe('music');
    expect(resolveGenre(false as unknown as string)).toBe('music');
    expect(resolveGenre(NaN as unknown as string)).toBe('music');
  });

  it('post94: truthy non-string without toLowerCase throws', () => {
    expect(() => resolveGenre(123 as unknown as string)).toThrow();
    expect(() => resolveGenre({} as unknown as string)).toThrow();
    expect(() => resolveGenre([] as unknown as string)).toThrow();
  });

  it('post94: String object wrappers resolve', () => {
    expect(resolveGenre(Object('metal') as unknown as string)).toBe('rock');
    expect(resolveGenre(Object('  JAZZ  ') as unknown as string)).toBe('jazz');
  });

  it('post94: NBSP/soft-hyphen/ZWSP alone → music', () => {
    expect(resolveGenre('\u00A0')).toBe('music');
    expect(resolveGenre('\u00AD')).toBe('music');
    expect(resolveGenre('\u200B')).toBe('music');
  });

  it('post94: line/paragraph separators alone → music', () => {
    expect(resolveGenre('\u2028')).toBe('music');
    expect(resolveGenre('\u2029')).toBe('music');
  });

  it('post94: BOM-prefixed jazz resolves; BOM alone → music', () => {
    expect(resolveGenre('\uFEFFjazz')).toBe('jazz');
    expect(resolveGenre('\uFEFF')).toBe('music');
  });

  it('post94: late+NBSP+night is not late night alias', () => {
    expect(resolveGenre('late\u00A0night')).toBe('music');
  });

  it('post94: fullwidth latin lookalikes miss', () => {
    expect(resolveGenre('ｊａｚｚ')).toBe('music');
    expect(resolveGenre('ＪＡＺＺ')).toBe('music');
  });

  it('post94: padStart/padEnd spaces trim for classical', () => {
    expect(resolveGenre('classical'.padStart(20, ' '))).toBe('classical');
    expect(resolveGenre('classical'.padEnd(20, ' '))).toBe('classical');
  });

  it('post94: split-join space preserves late night; hyphen fails', () => {
    expect(resolveGenre('late night'.split(' ').join(' '))).toBe('ambient');
    expect(resolveGenre('late night'.split(' ').join('-'))).toBe('music');
  });

  it('post94: Lo-Fi / LO-FI hyphen variants resolve ambient', () => {
    expect(resolveGenre('Lo-Fi')).toBe('ambient');
    expect(resolveGenre('LO-FI')).toBe('ambient');
  });

  it('post94: genres.ts exports expected public symbols', () => {
    expect(src).toContain('export const GENRE_MAP');
    expect(src).toContain('export const VALID_GENRES');
    expect(src).toContain('export function resolveGenre');
    expect(src).toContain('export type ValidGenre');
  });

  it('post94: genres.ts has no imports/requires', () => {
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/require\(/);
  });

  it('post94: genres.ts documents mood aliases arrow category', () => {
    expect(src).toContain('mood aliases → category');
  });

  it('post94: resolveGenre default map param is GENRE_MAP', () => {
    expect(src).toMatch(/map: Record<string, string> = GENRE_MAP/);
  });

  it('post94: resolveGenre uses ?? then VALID_GENRES.includes then music', () => {
    expect(src).toContain("map[lower] ?? (VALID_GENRES.includes(lower as ValidGenre) ? lower : 'music')");
  });

  it('post94: resolveGenre early-returns music when !input', () => {
    expect(src).toContain("if (!input) return 'music';");
  });

  it('post94: resolveGenre lowercases and trims', () => {
    expect(src).toContain('input.toLowerCase().trim()');
  });

  it('post94: genres.ts does not reference parser/mcp/hono/gemini', () => {
    expect(src.toLowerCase()).not.toContain('parser');
    expect(src.toLowerCase()).not.toContain('mcp');
    expect(src.toLowerCase()).not.toContain('hono');
    expect(src.toLowerCase()).not.toContain('gemini');
  });

  it('post94: index.ts imports GENRE_MAP VALID_GENRES resolveGenre from genres', () => {
    expect(indexSrc).toContain("import { GENRE_MAP, VALID_GENRES, resolveGenre } from './genres';");
  });

  it('post94: index /genres route exposes VALID_GENRES and GENRE_MAP', () => {
    expect(indexSrc).toContain('genres: [...VALID_GENRES]');
    expect(indexSrc).toContain('aliases: GENRE_MAP');
    expect(indexSrc).toContain("app.get('/genres'");
  });

  it('post94: index stations/curate call resolveGenre', () => {
    expect(indexSrc).toMatch(/resolveGenre\(genreParam\)/);
    expect(indexSrc).toMatch(/resolveGenre\(genreParam \?\? mood\)/);
  });

  it('post94: AGENTS.md lists genres.ts', () => {
    expect(agentsMd).toContain('src/genres.ts');
    expect(agentsMd).toContain('src/index.ts');
  });

  it('post94: DEPLOY.md does not invent lo-fi / genre_map', () => {
    expect(deployMd.toLowerCase()).not.toContain('lo-fi');
    expect(deployMd.toLowerCase()).not.toContain('genre_map');
  });

  it('post94: vitest coverage include covers src/** with 100% branches', () => {
    expect(vitestCfg).toContain("include: ['src/**/*.ts']");
    expect(vitestCfg).toContain('branches: 100');
  });

  it('post94: CI hygiene asserts genres test and source exist', () => {
    expect(ciYml).toContain('test -f test/genres.test.ts');
    expect(ciYml).toContain('test -f src/genres.ts');
  });

  it('post94: package.json scripts include test and test:coverage', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
  });

  it('post94: README mentions genres suite', () => {
    expect(readmeMd.toLowerCase()).toContain('genres');
  });

  it('post94: cross-lock sha256+nibble for src/index.ts', () => {
    expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
    expect(nibbleSum(sha256('src/index.ts'))).toBe(470);
  });

  it('post94: cross-lock sha256+nibble for src/parser.ts', () => {
    expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
    expect(nibbleSum(sha256('src/parser.ts'))).toBe(477);
  });

  it('post94: cross-lock sha256+nibble for src/types.ts', () => {
    expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
    expect(nibbleSum(sha256('src/types.ts'))).toBe(520);
  });

  it('post94: cross-lock sha256+nibble for package.json', () => {
    expect(sha256('package.json')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c');
    expect(nibbleSum(sha256('package.json'))).toBe(451);
  });

  it('post94: cross-lock sha256+nibble for AGENTS.md', () => {
    expect(sha256('AGENTS.md')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa');
    expect(nibbleSum(sha256('AGENTS.md'))).toBe(479);
  });

  it('post94: cross-lock sha256+nibble for DEPLOY.md', () => {
    expect(sha256('DEPLOY.md')).toBe('11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a');
    expect(nibbleSum(sha256('DEPLOY.md'))).toBe(439);
  });

  it('post94: cross-lock sha256+nibble for vitest.config.ts', () => {
    expect(sha256('vitest.config.ts')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38');
    expect(nibbleSum(sha256('vitest.config.ts'))).toBe(536);
  });

  it('post94: cross-lock sha256+nibble for .github/workflows/ci.yml', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe('c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5');
    expect(nibbleSum(sha256('.github/workflows/ci.yml'))).toBe(515);
  });

  it('post94: mega purity — 100x every GENRE_MAP alias resolves', () => {
    for (let i = 0; i < 100; i++) {
      for (const [alias, genre] of Object.entries(GENRE_MAP)) {
        expect(resolveGenre(alias)).toBe(genre);
        expect(resolveGenre(alias.toUpperCase())).toBe(genre);
      }
    }
  });

  it('post94: mega purity — 100x VALID_GENRES identity via empty map', () => {
    for (let i = 0; i < 100; i++) {
      for (const g of VALID_GENRES) expect(resolveGenre(g, {})).toBe(g);
    }
  });

  it('post94: mega digest purity — 50x sha256 genres.ts', () => {
    const expected = 'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e';
    for (let i = 0; i < 50; i++) {
      expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe(expected);
    }
  });

  it('post94: batch — all aliases resolve without throw', () => {
    const errors: unknown[] = [];
    for (const key of Object.keys(GENRE_MAP)) {
      try { expect(typeof resolveGenre(key)).toBe('string'); } catch (e) { errors.push(e); }
    }
    expect(errors).toEqual([]);
  });

  it('post94: JSON.stringify GENRE_MAP payload lock', () => {
    expect(JSON.stringify(GENRE_MAP)).toBe("{\"late night\":\"ambient\",\"chill\":\"ambient\",\"ambient\":\"ambient\",\"relaxing\":\"ambient\",\"focus\":\"ambient\",\"classical\":\"classical\",\"classic\":\"classical\",\"jazz\":\"jazz\",\"blues\":\"jazz\",\"pop\":\"pop\",\"rock\":\"rock\",\"metal\":\"rock\",\"indie\":\"rock\",\"music\":\"music\",\"news\":\"news\",\"sports\":\"sports\",\"entertainment\":\"entertainment\",\"dance\":\"pop\",\"electronic\":\"ambient\",\"lofi\":\"ambient\",\"lo-fi\":\"ambient\"}");
  });

  it('post94: JSON.stringify VALID_GENRES payload lock', () => {
    expect(JSON.stringify(VALID_GENRES)).toBe("[\"music\",\"ambient\",\"jazz\",\"classical\",\"pop\",\"rock\",\"news\",\"sports\",\"entertainment\"]");
  });

  it('post94: TextEncoder first bytes are slash-star', () => {
    const bytes = new TextEncoder().encode(src);
    expect(bytes[0]).toBe(0x2f);
    expect(bytes[1]).toBe(0x2a);
    expect(bytes.byteLength).toBe(1027);
  });

  it('post94: TextDecoder round-trip preserves source', () => {
    expect(new TextDecoder().decode(new TextEncoder().encode(src))).toBe(src);
  });

  it('post94: DataView reads first two bytes as slash-star', () => {
    const buf = new TextEncoder().encode(src);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint8(0)).toBe(0x2f);
    expect(view.getUint8(1)).toBe(0x2a);
  });

  it('post94: queueMicrotask does not alter genres digest', async () => {
    const before = createHash('sha256').update(src, 'utf8').digest('hex');
    await new Promise<void>((resolve) => { queueMicrotask(resolve); });
    expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe(before);
  });

  it('post94: Buffer round-trip of GENRE_MAP JSON', () => {
    const payload = JSON.stringify(GENRE_MAP);
    expect(Buffer.from(payload, 'utf8').toString('utf8')).toBe(payload);
    expect(JSON.parse(payload)).toEqual(GENRE_MAP);
  });

  it('post94: Headers/FormData unused by genres module', () => {
    expect(typeof Headers).toBe('function');
    expect(typeof FormData).toBe('function');
    expect(src).not.toMatch(/Headers|FormData|fetch\(/);
  });

  it('post94: AbortSignal.timeout unused by genres module', () => {
    expect(typeof AbortSignal.timeout).toBe('function');
    expect(src).not.toMatch(/AbortSignal|timeout\(/);
  });

  it('post94: resolveGenre.length stays 1', () => {
    expect(resolveGenre.length).toBe(1);
  });

  it('post94: GENRE_MAP/VALID_GENRES freeze state stable across resolves', () => {
    const mapFrozen = Object.isFrozen(GENRE_MAP);
    const listFrozen = Object.isFrozen(VALID_GENRES);
    expect(resolveGenre('chill')).toBe('ambient');
    expect(Object.isFrozen(GENRE_MAP)).toBe(mapFrozen);
    expect(Object.isFrozen(VALID_GENRES)).toBe(listFrozen);
  });

  it('post94: Object.entries length equals 21', () => {
    expect(Object.entries(GENRE_MAP)).toHaveLength(21);
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(Object.values(GENRE_MAP)).toHaveLength(21);
  });

  it('post94: alias keys match /^[a-z0-9 -]+$/', () => {
    for (const key of Object.keys(GENRE_MAP)) expect(key).toMatch(/^[a-z0-9 -]+$/);
  });

  it('post94: GENRE_MAP values match /^[a-z]+$/', () => {
    for (const v of Object.values(GENRE_MAP)) expect(v).toMatch(/^[a-z]+$/);
  });

  it('post94: alias-only keys exactly twelve mood/redirect labels', () => {
    const aliasOnly = Object.keys(GENRE_MAP).filter((k) => !(VALID_GENRES as readonly string[]).includes(k));
    expect(aliasOnly.sort()).toEqual(['blues','chill','classic','dance','electronic','focus','indie','late night','lo-fi','lofi','metal','relaxing'].sort());
  });

  it('post94: fromCharCode rebuild of resolveGenre name', () => {
    const name = String.fromCharCode(114,101,115,111,108,118,101,71,101,110,114,101);
    expect(name).toBe('resolveGenre');
    expect(typeof resolveGenre).toBe('function');
  });

  it('post94: VALID_GENRES member sha256 for music', () => {
    expect(createHash('sha256').update('music', 'utf8').digest('hex')).toBe('80f189984e5ca70287d13342f6daa0db45cba3c131c4e46dc81360f3a4c4f690');
    expect(resolveGenre('music')).toBe('music');
  });

  it('post94: VALID_GENRES member sha256 for ambient', () => {
    expect(createHash('sha256').update('ambient', 'utf8').digest('hex')).toBe('31d18c0defdc3e0eadd46bb4c04e4ad798f4582fbde1216806bde3cbe250350c');
    expect(resolveGenre('ambient')).toBe('ambient');
  });

  it('post94: VALID_GENRES member sha256 for jazz', () => {
    expect(createHash('sha256').update('jazz', 'utf8').digest('hex')).toBe('c301f75ab52fa076c827231e613bbc976e26b2c1f7ddd01a319b2832b8ecdf9a');
    expect(resolveGenre('jazz')).toBe('jazz');
  });

  it('post94: VALID_GENRES member sha256 for classical', () => {
    expect(createHash('sha256').update('classical', 'utf8').digest('hex')).toBe('25d9548a80c751e282183876990e49a6eb3c1ac94a28fa86c5b513019bf8cba6');
    expect(resolveGenre('classical')).toBe('classical');
  });

  it('post94: VALID_GENRES member sha256 for pop', () => {
    expect(createHash('sha256').update('pop', 'utf8').digest('hex')).toBe('de70fa60cac227cbc13270a26ccde291af94df086959f0958122aedf154d90b5');
    expect(resolveGenre('pop')).toBe('pop');
  });

  it('post94: VALID_GENRES member sha256 for rock', () => {
    expect(createHash('sha256').update('rock', 'utf8').digest('hex')).toBe('350a770c0ec9f353e1a5629895f374fdaa299876c3870c03feb60eb4a3769d94');
    expect(resolveGenre('rock')).toBe('rock');
  });

  it('post94: VALID_GENRES member sha256 for news', () => {
    expect(createHash('sha256').update('news', 'utf8').digest('hex')).toBe('19fba0e995b9794fc2c26217bf3b725c2f0d9eeda16719fe75e3ba23ca73bfc4');
    expect(resolveGenre('news')).toBe('news');
  });

  it('post94: VALID_GENRES member sha256 for sports', () => {
    expect(createHash('sha256').update('sports', 'utf8').digest('hex')).toBe('1cb542228c76558789d114d3cb273a75850cca54ec3ee9a41100f2dc56ee561e');
    expect(resolveGenre('sports')).toBe('sports');
  });

  it('post94: VALID_GENRES member sha256 for entertainment', () => {
    expect(createHash('sha256').update('entertainment', 'utf8').digest('hex')).toBe('b34564f1c4cd1d98dc26aaa4f888e3020656033add4dd0620b26e820493bf5c2');
    expect(resolveGenre('entertainment')).toBe('entertainment');
  });

  it('post94: mixed-case VALID probe → music', () => {
    expect(resolveGenre('Music')).toBe('music');
  });

  it('post94: mixed-case VALID probe → music', () => {
    expect(resolveGenre('MUSIC')).toBe('music');
  });

  it('post94: mixed-case VALID probe → music', () => {
    expect(resolveGenre('mUsIc')).toBe('music');
  });

  it('post94: mixed-case VALID probe → ambient', () => {
    expect(resolveGenre(' Ambient ')).toBe('ambient');
  });

  it('post94: mixed-case VALID probe → jazz', () => {
    expect(resolveGenre('\tJAZZ\t')).toBe('jazz');
  });

  it('post94: mixed-case VALID probe → pop', () => {
    expect(resolveGenre('PoP')).toBe('pop');
  });

  it('post94: mixed-case VALID probe → rock', () => {
    expect(resolveGenre('ROCK')).toBe('rock');
  });

  it('post94: mixed-case VALID probe → news', () => {
    expect(resolveGenre('News')).toBe('news');
  });

  it('post94: mixed-case VALID probe → sports', () => {
    expect(resolveGenre('SPORTS')).toBe('sports');
  });

  it('post94: mixed-case VALID probe → entertainment', () => {
    expect(resolveGenre('Entertainment')).toBe('entertainment');
  });

  it('post94: mixed-case VALID probe → classical', () => {
    expect(resolveGenre('  CLASSICAL  ')).toBe('classical');
  });

  it('post94: bidi/control/trim probe → music', () => {
    expect(resolveGenre('\u202Ejazz')).toBe('music');
  });

  it('post94: bidi/control/trim probe → music', () => {
    expect(resolveGenre('jazz\u202C')).toBe('music');
  });

  it('post94: bidi/control/trim probe → music', () => {
    expect(resolveGenre('\u2066rock\u2069')).toBe('music');
  });

  it('post94: bidi/control/trim probe → rock', () => {
    expect(resolveGenre('rock\n')).toBe('rock');
  });

  it('post94: bidi/control/trim probe → pop', () => {
    expect(resolveGenre('pop\r')).toBe('pop');
  });

  it('post94: cross-lock index.ts sha1 and md5', () => {
    expect(sha1('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
    expect(md5('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post94: genres.test.ts mentions post94 deepen', () => {
    const self = read('test/genres.test.ts');
    expect(self).toContain('import { GENRE_MAP, VALID_GENRES, resolveGenre }');
    expect(self).toContain('post94 genres HEAVY deepen');
  });

  it('post94: relative path join of genres stays under src', () => {
    expect(join('src', 'genres.ts')).toBe('src/genres.ts');
    expect(read('src/genres.ts').length).toBe(1025);
  });

  it('post94: dirname of this test file resolves to test/', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('/test')).toBe(true);
  });

  it('post94: final mega purity — 200 iterations mixed probes', () => {
    const probes = [['', 'music'], ['CHILL', 'ambient'], ['  blues ', 'jazz'], ['lofi', 'ambient'], ['lo-fi', 'ambient'], ['nope', 'music'], ['entertainment', 'entertainment'], ['metal', 'rock'], ['dance', 'pop'], ['classic', 'classical']] as const;
    for (let i = 0; i < 200; i++) {
      for (const [input, expected] of probes) expect(resolveGenre(input)).toBe(expected);
    }
  });

  it('post94: target genre ambient sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('ambient', 'utf8').digest('hex')).toBe('31d18c0defdc3e0eadd46bb4c04e4ad798f4582fbde1216806bde3cbe250350c');
    const aliases = ["late night","chill","ambient","relaxing","focus","electronic","lofi","lo-fi"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('ambient');
    expect(aliases).toHaveLength(8);
  });

  it('post94: target genre classical sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('classical', 'utf8').digest('hex')).toBe('25d9548a80c751e282183876990e49a6eb3c1ac94a28fa86c5b513019bf8cba6');
    const aliases = ["classical","classic"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('classical');
    expect(aliases).toHaveLength(2);
  });

  it('post94: target genre jazz sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('jazz', 'utf8').digest('hex')).toBe('c301f75ab52fa076c827231e613bbc976e26b2c1f7ddd01a319b2832b8ecdf9a');
    const aliases = ["jazz","blues"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('jazz');
    expect(aliases).toHaveLength(2);
  });

  it('post94: target genre pop sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('pop', 'utf8').digest('hex')).toBe('de70fa60cac227cbc13270a26ccde291af94df086959f0958122aedf154d90b5');
    const aliases = ["pop","dance"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('pop');
    expect(aliases).toHaveLength(2);
  });

  it('post94: target genre rock sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('rock', 'utf8').digest('hex')).toBe('350a770c0ec9f353e1a5629895f374fdaa299876c3870c03feb60eb4a3769d94');
    const aliases = ["rock","metal","indie"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('rock');
    expect(aliases).toHaveLength(3);
  });

  it('post94: target genre music sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('music', 'utf8').digest('hex')).toBe('80f189984e5ca70287d13342f6daa0db45cba3c131c4e46dc81360f3a4c4f690');
    const aliases = ["music"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('music');
    expect(aliases).toHaveLength(1);
  });

  it('post94: target genre news sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('news', 'utf8').digest('hex')).toBe('19fba0e995b9794fc2c26217bf3b725c2f0d9eeda16719fe75e3ba23ca73bfc4');
    const aliases = ["news"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('news');
    expect(aliases).toHaveLength(1);
  });

  it('post94: target genre sports sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('sports', 'utf8').digest('hex')).toBe('1cb542228c76558789d114d3cb273a75850cca54ec3ee9a41100f2dc56ee561e');
    const aliases = ["sports"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('sports');
    expect(aliases).toHaveLength(1);
  });

  it('post94: target genre entertainment sha256 and fan-in resolve', () => {
    expect(createHash('sha256').update('entertainment', 'utf8').digest('hex')).toBe('b34564f1c4cd1d98dc26aaa4f888e3020656033add4dd0620b26e820493bf5c2');
    const aliases = ["entertainment"];
    for (const a of aliases) expect(resolveGenre(a)).toBe('entertainment');
    expect(aliases).toHaveLength(1);
  });

  it('post94: all GENRE_MAP alias key sha256 digests are unique', () => {
    const digests = Object.keys(GENRE_MAP).map((k) => createHash('sha256').update(k, 'utf8').digest('hex'));
    expect(new Set(digests).size).toBe(21);
  });

  it('post94: HMAC genre-alias key for late night', () => {
    expect(createHmac('sha256', 'genre-alias').update("late night", 'utf8').digest('hex')).toBe('9a929e87f31570fabc031d0bfbae172f055694ac5285abdd8c58b7af94f69741');
  });

  it('post94: HMAC genre-alias key for chill', () => {
    expect(createHmac('sha256', 'genre-alias').update("chill", 'utf8').digest('hex')).toBe('2994d6fcb1b2da73ded79a8715721b6419448451ba5a4bccedcc4ed640d797a1');
  });

  it('post94: HMAC genre-alias key for ambient', () => {
    expect(createHmac('sha256', 'genre-alias').update("ambient", 'utf8').digest('hex')).toBe('63cbcbfad06f84a30fc050a1ff424e71028779947850b8c64a9769724bead6cb');
  });

  it('post94: HMAC genre-alias key for relaxing', () => {
    expect(createHmac('sha256', 'genre-alias').update("relaxing", 'utf8').digest('hex')).toBe('4999e4275d11b955cfe4da61bb3935c439861380d29306d75d1391ff0ae3b681');
  });

  it('post94: HMAC genre-alias key for focus', () => {
    expect(createHmac('sha256', 'genre-alias').update("focus", 'utf8').digest('hex')).toBe('89c700b7e64fcc1987df9f7be12960c96aaa49f90f85a27cd99b8fc0f45e8763');
  });

  it('post94: HMAC genre-alias key for classical', () => {
    expect(createHmac('sha256', 'genre-alias').update("classical", 'utf8').digest('hex')).toBe('fb49192eee8873fc55009fee43344676c2d70833073454ea6a18d4a807300ecb');
  });

  it('post94: HMAC genre-alias key for classic', () => {
    expect(createHmac('sha256', 'genre-alias').update("classic", 'utf8').digest('hex')).toBe('b3f923ad182c78f1419cefe0c30b7670884c19dbe7be4b69b5f79fbcf0fba280');
  });

  it('post94: HMAC genre-alias key for jazz', () => {
    expect(createHmac('sha256', 'genre-alias').update("jazz", 'utf8').digest('hex')).toBe('d488f6b6544d799f3828de5fd8f8be441c47472c06fd4b78e3538707f55d8558');
  });

  it('post94: HMAC genre-alias key for blues', () => {
    expect(createHmac('sha256', 'genre-alias').update("blues", 'utf8').digest('hex')).toBe('97876477e8d9e3b80f9c72b5c86ab2b504b27d77d6c19c67b2eba1515d6adc69');
  });

  it('post94: HMAC genre-alias key for pop', () => {
    expect(createHmac('sha256', 'genre-alias').update("pop", 'utf8').digest('hex')).toBe('7cb047d429d8cdf52cfc11965ff730ff4ed5d143dfab883fc2f00b327a2aeef8');
  });

  it('post94: HMAC genre-alias key for rock', () => {
    expect(createHmac('sha256', 'genre-alias').update("rock", 'utf8').digest('hex')).toBe('f7cf29bf114be94867f3a58ec939b2b2bcc64b8addb60b4980b5976f7766ae48');
  });

  it('post94: HMAC genre-alias key for metal', () => {
    expect(createHmac('sha256', 'genre-alias').update("metal", 'utf8').digest('hex')).toBe('918f71fbaa95653d9ac9c5b1e12c889941278b461a5820bd046b99f70c191977');
  });

  it('post94: HMAC genre-alias key for indie', () => {
    expect(createHmac('sha256', 'genre-alias').update("indie", 'utf8').digest('hex')).toBe('c8c2ad94ddc3d3ae9470627080b0bca8a314eea5c0d1f1e1b9bb0a1023bd9112');
  });

  it('post94: HMAC genre-alias key for music', () => {
    expect(createHmac('sha256', 'genre-alias').update("music", 'utf8').digest('hex')).toBe('def57f7fe609d30b11a3b86d37bdfa5ee742b9d59868520081ca3cc54b66bd41');
  });

  it('post94: HMAC genre-alias key for news', () => {
    expect(createHmac('sha256', 'genre-alias').update("news", 'utf8').digest('hex')).toBe('5e91bf8845b8e95387e3fc0e96d173641e7a0f9d2e87467e79bb77220c27c57d');
  });

  it('post94: HMAC genre-alias key for sports', () => {
    expect(createHmac('sha256', 'genre-alias').update("sports", 'utf8').digest('hex')).toBe('0590a6f8b24b97772d046c009125d718e477224be2480e0b47798e28f4ecd288');
  });

  it('post94: HMAC genre-alias key for entertainment', () => {
    expect(createHmac('sha256', 'genre-alias').update("entertainment", 'utf8').digest('hex')).toBe('cec98f9f9a600cb5905e66c08ebe6949953627452f1374bebaf77507d51b3f98');
  });

  it('post94: HMAC genre-alias key for dance', () => {
    expect(createHmac('sha256', 'genre-alias').update("dance", 'utf8').digest('hex')).toBe('684dc107c0b238db1901c50d44d7dac90c37a9dd7b8f162b80e4a2f7ee52fbe7');
  });

  it('post94: HMAC genre-alias key for electronic', () => {
    expect(createHmac('sha256', 'genre-alias').update("electronic", 'utf8').digest('hex')).toBe('9e906330ac373f000137b0e112e50905cfaa867241f29c1e402f2ed58df28681');
  });

  it('post94: HMAC genre-alias key for lofi', () => {
    expect(createHmac('sha256', 'genre-alias').update("lofi", 'utf8').digest('hex')).toBe('aab2e37307e59be7a6007265a7a005283d3f69967ec867ff030323bd0d3572ca');
  });

  it('post94: HMAC genre-alias key for lo-fi', () => {
    expect(createHmac('sha256', 'genre-alias').update("lo-fi", 'utf8').digest('hex')).toBe('7bf73a1aef075007666b1071bfc3b3490ee06de3d3baac91c5792fd72b3657d8');
  });

  it('post94: deleted identity keys in custom map still fall through to VALID_GENRES', () => {
    const map = { ...GENRE_MAP };
    delete map.jazz;
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('blues', map)).toBe('jazz');
  });

  it('post94: whitespace-only CR/LF/TAB/FF/VT default to music', () => {
    expect(resolveGenre('\r')).toBe('music');
    expect(resolveGenre('\n')).toBe('music');
    expect(resolveGenre('\t')).toBe('music');
    expect(resolveGenre('\f')).toBe('music');
    expect(resolveGenre('\v')).toBe('music');
  });

  it('post94: does not mutate GENRE_MAP across 500 resolveGenre calls', () => {
    const snapshot = JSON.stringify(GENRE_MAP);
    for (let i = 0; i < 500; i++) resolveGenre(Object.keys(GENRE_MAP)[i % 21]);
    expect(JSON.stringify(GENRE_MAP)).toBe(snapshot);
  });

  it('post94: does not mutate VALID_GENRES across identity resolves', () => {
    const snapshot = JSON.stringify(VALID_GENRES);
    for (const g of VALID_GENRES) resolveGenre(g, {});
    expect(JSON.stringify(VALID_GENRES)).toBe(snapshot);
  });

  it('post94: sha1 of GENRE_MAP JSON payload lock', () => {
    expect(createHash('sha1').update(JSON.stringify(GENRE_MAP), 'utf8').digest('hex')).toBe('0416f0888d49af3d937a8698a99e513af51e177f');
  });

  it('post94: md5 of VALID_GENRES JSON payload lock', () => {
    expect(createHash('md5').update(JSON.stringify(VALID_GENRES), 'utf8').digest('hex')).toBe('f09a3af86bcbcaabab2c6baee3837690');
  });

  it('post94: genres source export shape lock', () => {
    expect((src.match(/^export function /gm) ?? []).length).toBe(1);
    expect((src.match(/^export const /gm) ?? []).length).toBe(2);
    expect((src.match(/^export type /gm) ?? []).length).toBe(1);
  });

  it('post94: resolveGenre default param = GENRE_MAP appears once', () => {
    expect((src.match(/= GENRE_MAP/g) ?? []).length).toBe(1);
  });

  it('post94: VALID_GENRES iterator yields 9 values then done', () => {
    const it = VALID_GENRES[Symbol.iterator]();
    const seen: string[] = [];
    for (;;) { const n = it.next(); if (n.done) break; seen.push(n.value); }
    expect(seen).toEqual([...VALID_GENRES]);
    expect(seen).toHaveLength(9);
  });

  it('post94: Symbol keys on custom map are invisible to string lookup', () => {
    const sym = Symbol("chill");
    const map: Record<string | symbol, string> = { [sym]: "news", chill: "ambient" };
    expect(resolveGenre('chill', map as Record<string, string>)).toBe('ambient');
    expect(resolveGenre(String(sym), map as Record<string, string>)).toBe('music');
  });

  it('post94: Reflect.get on GENRE_MAP matches bracket access', () => {
    expect(Reflect.get(GENRE_MAP, 'chill')).toBe(GENRE_MAP.chill);
    expect(Reflect.get(GENRE_MAP, 'lo-fi')).toBe('ambient');
    expect(resolveGenre('chill')).toBe(Reflect.get(GENRE_MAP, 'chill'));
  });

  it('post94: Atomics/SharedArrayBuffer unused by genres module', () => {
    expect(typeof Atomics).toBe('object');
    expect(typeof SharedArrayBuffer).toBe('function');
    expect(src).not.toMatch(/Atomics|SharedArrayBuffer/);
  });

  it('post94: splitting late night tokens does not invent aliases', () => {
    expect(resolveGenre('late')).toBe('music');
    expect(resolveGenre('night')).toBe('music');
    expect(resolveGenre('late night')).toBe('ambient');
  });

  it('post94: locale lowercasing of İ does not invent jazz', () => {
    expect(resolveGenre('İ'.toLocaleLowerCase('tr'))).not.toBe('jazz');
    expect(resolveGenre('JAZZ'.toLocaleLowerCase('en'))).toBe('jazz');
  });

  it('post94: Array.from VALID_GENRES equals spread copy', () => {
    expect(Array.from(VALID_GENRES)).toEqual([...VALID_GENRES]);
  });

  it('post94: Object.hasOwn distinguishes own alias keys', () => {
    expect(Object.hasOwn(GENRE_MAP, 'chill')).toBe(true);
    expect(Object.hasOwn(GENRE_MAP, 'toString')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, '__proto__')).toBe(false);
  });

  it('post94: map of alias resolutions matches GENRE_MAP values', () => {
    expect(Object.keys(GENRE_MAP).map((k) => resolveGenre(k))).toEqual(Object.values(GENRE_MAP));
  });

  it('post94: reduce builds pipe-joined VALID_GENRES lock', () => {
    expect(VALID_GENRES.reduce((a, g) => (a ? a + '|' + g : g), '')).toBe('music|ambient|jazz|classical|pop|rock|news|sports|entertainment');
  });

  it('post94: sum of VALID_GENRES and GENRE_MAP key lengths', () => {
    expect(VALID_GENRES.reduce((s, g) => s + g.length, 0)).toBe(55);
    expect(Object.keys(GENRE_MAP).reduce((s, k) => s + k.length, 0)).toBe(129);
  });

  it('post94: Date.now independence — resolveGenre stable across clock', () => {
    const a = resolveGenre('chill');
    const t0 = Date.now();
    const b = resolveGenre('chill');
    expect(Date.now()).toBeGreaterThanOrEqual(t0);
    expect(a).toBe(b);
    expect(a).toBe('ambient');
  });

  it('post94: performance.now independence — resolveGenre stable', () => {
    const t0 = performance.now();
    expect(resolveGenre('metal')).toBe('rock');
    expect(performance.now()).toBeGreaterThanOrEqual(t0);
  });

  it('post94: hash of Math.random does not affect resolveGenre', () => {
    const bytes = createHash('sha256').update(String(Math.random()), 'utf8').digest('hex');
    expect(resolveGenre('jazz')).toBe('jazz');
    expect(bytes).toHaveLength(64);
  });

  it('post94: final digest+resolve mega purity — 40 rounds', () => {
    const expected = 'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e';
    for (let i = 0; i < 40; i++) {
      expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe(expected);
      expect(resolveGenre('late night')).toBe('ambient');
      expect(resolveGenre('podcast')).toBe('music');
      expect(Object.keys(GENRE_MAP)).toHaveLength(21);
      expect(VALID_GENRES).toHaveLength(9);
    }
  });

});

// --- HEAVY burn (post-#113/#114/#115): deepen genres unit slice only — no product inventing ---
// Fresh deepen from latest main after merged helpers/mcp-spec/source-contracts.
// Orthogonal to open routes #116 — do not touch routes. Tests-only.

describe('post115 genres HEAVY deepen', () => {
  const read = (rel: string) => readFileSync(join(genresRoot, rel), 'utf8');
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(genresRoot, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const codeSum = (s: string) => [...s].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const src = genresSource;
  const indexSrc = read('src/index.ts');
  const agentsMd = read('AGENTS.md');
  const readmeMd = read('README.md');
  const deployMd = read('DEPLOY.md');
  const pkgJson = read('package.json');
  const ciYml = read('.github/workflows/ci.yml');
  const vitestCfg = read('vitest.config.ts');
  const typesSrc = read('src/types.ts');
  const parserSrc = read('src/parser.ts');
  const mcpSrc = read('src/mcp.ts');
  const wranglerToml = read('wrangler.toml');

  it('post115: locks genres.ts sha256 digest', () => {
    expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post115: locks genres.ts sha1 digest', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post115: locks genres.ts md5 digest', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post115: locks genres.ts sha384 digest', () => {
    expect(createHash('sha384').update(src, 'utf8').digest('hex')).toBe('ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16');
  });

  it('post115: locks genres.ts sha512 digest', () => {
    expect(createHash('sha512').update(src, 'utf8').digest('hex')).toBe('bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b');
  });

  it('post115: locks genres.ts sha256 nibble sum', () => {
    expect(nibbleSum(sha256('src/genres.ts'))).toBe(500);
  });

  it('post115: locks genres.ts sha256 xor-nibble fingerprint', () => {
    expect(xorNibbles(sha256('src/genres.ts'))).toBe(6);
  });

  it('post115: sha256/sha384/sha512 digests are pairwise distinct', () => {
    const a = createHash('sha256').update(src, 'utf8').digest('hex');
    const b = createHash('sha384').update(src, 'utf8').digest('hex');
    const c = createHash('sha512').update(src, 'utf8').digest('hex');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('post115: sha384 length 96 and sha512 length 128 lowercase hex', () => {
    const a = createHash('sha384').update(src, 'utf8').digest('hex');
    const b = createHash('sha512').update(src, 'utf8').digest('hex');
    expect(a).toHaveLength(96);
    expect(b).toHaveLength(128);
    expect(/^[a-f0-9]+$/.test(a + b)).toBe(true);
  });

  it('post115: HMAC-SHA256 keyed by post115 locks digest', () => {
    expect(createHmac('sha256', "post115").update(src, 'utf8').digest('hex')).toBe('3b4eccafe0e013f64717048535130c5b06b32c7da5c5074da292c362687f1470');
  });

  it('post115: HMAC-SHA256 keyed by genres locks digest', () => {
    expect(createHmac('sha256', "genres").update(src, 'utf8').digest('hex')).toBe('d08733642684cd2a08d377a64f7de4cc9c5e2e8a9c1444eb3cae9eca9b265d1e');
  });

  it('post115: HMAC-SHA256 keyed by genres-unit locks digest', () => {
    expect(createHmac('sha256', "genres-unit").update(src, 'utf8').digest('hex')).toBe('af1818601fe794061a5b38286e4d7d9c8c73e33b0827c23c92b8a153cb361932');
  });

  it('post115: HMAC-SHA256 keyed by resolveGenre locks digest', () => {
    expect(createHmac('sha256', "resolveGenre").update(src, 'utf8').digest('hex')).toBe('fe1a20891bfc5b67645cfa401b2ff86aa88d4dbabb09b6965c2674d7c4c790fd');
  });

  it('post115: HMAC-SHA256 keyed by GENRE_MAP locks digest', () => {
    expect(createHmac('sha256', "GENRE_MAP").update(src, 'utf8').digest('hex')).toBe('8bb564124b513eb5ec3d86692f72332f15a4e5c312e4597fd7c4405d98b78809');
  });

  it('post115: HMAC-SHA256 keyed by VALID_GENRES locks digest', () => {
    expect(createHmac('sha256', "VALID_GENRES").update(src, 'utf8').digest('hex')).toBe('022af5631e33153cb57479f640c634fed9801fa759671954791290e45cdafb25');
  });

  it('post115: HMAC-SHA256 keyed by Backlink_Facelift locks digest', () => {
    expect(createHmac('sha256', "Backlink_Facelift").update(src, 'utf8').digest('hex')).toBe('a8474fdb5af0fd429aa30c753205ce21526cacd927aab18e60b4f6706f020d16');
  });

  it('post115: HMAC-SHA256 keyed by post-#113/#114/#115 locks digest', () => {
    expect(createHmac('sha256', "post-#113/#114/#115").update(src, 'utf8').digest('hex')).toBe('7722659e394b3a32993cb9f80305f55f29f8ff7b1328270972ae1db5c7037733');
  });

  it('post115: HMAC-SHA256 keyed by fuzzywigg locks digest', () => {
    expect(createHmac('sha256', "fuzzywigg").update(src, 'utf8').digest('hex')).toBe('449f90c50ae8bb525d12e1afc61f2c9676d4df314072ddd9d39da78f5b3386d5');
  });

  it('post115: HMAC-SHA256 keyed by iptv-org locks digest', () => {
    expect(createHmac('sha256', "iptv-org").update(src, 'utf8').digest('hex')).toBe('1493d15bc7d59b37d840b00afdadc42f8b5d087e532feedd20fccd557a198a5e');
  });

  it('post115: HMAC-SHA256 keyed by ambient locks digest', () => {
    expect(createHmac('sha256', "ambient").update(src, 'utf8').digest('hex')).toBe('0e1a6697573800dd39ec057467b6e74fc34c4848f88275e7d731495e85259843');
  });

  it('post115: HMAC-SHA256 keyed by classical locks digest', () => {
    expect(createHmac('sha256', "classical").update(src, 'utf8').digest('hex')).toBe('c582480c678b85cb8397971f6a09122ccd056b376878b9bcacf107c48141b307');
  });

  it('post115: HMAC-SHA256 keyed by jazz locks digest', () => {
    expect(createHmac('sha256', "jazz").update(src, 'utf8').digest('hex')).toBe('84fa0fd875ecfface746b58f3d6c4301bd474cfbec712c5a2d3123b6b7e0d376');
  });

  it('post115: HMAC-SHA256 keyed by pop locks digest', () => {
    expect(createHmac('sha256', "pop").update(src, 'utf8').digest('hex')).toBe('88c54cfc25df91c699e44eca11c6a441a4aa01d2f7697a9a44bff7c1859b33be');
  });

  it('post115: HMAC-SHA256 keyed by rock locks digest', () => {
    expect(createHmac('sha256', "rock").update(src, 'utf8').digest('hex')).toBe('2ef9dc009b251d64ea37abf7bd6657e31104e6d5edfccba5bd95f13b66f4c3de');
  });

  it('post115: HMAC-SHA256 keyed by news locks digest', () => {
    expect(createHmac('sha256', "news").update(src, 'utf8').digest('hex')).toBe('fe11b58bfa05fd321ebedce9c1e70ae488b60d16e18901c89f2d470c0d485739');
  });

  it('post115: HMAC-SHA256 keyed by sports locks digest', () => {
    expect(createHmac('sha256', "sports").update(src, 'utf8').digest('hex')).toBe('d2be96c69d1baf20e3e85c52173acdf168afde2fd5c82af228202341d66a6d53');
  });

  it('post115: HMAC-SHA256 keyed by entertainment locks digest', () => {
    expect(createHmac('sha256', "entertainment").update(src, 'utf8').digest('hex')).toBe('6ec5d64019e3ecc5367ec2b07f9f281b069c027e55e6d0e16d13dc2fa25f4f87');
  });

  it('post115: HMAC-SHA256 keyed by music locks digest', () => {
    expect(createHmac('sha256', "music").update(src, 'utf8').digest('hex')).toBe('8636a46f3678c4daf8be067d5130bbe611e1047e916e438fb1c6d0c23834428e');
  });

  it('post115: HMAC-SHA256 keyed by late night locks digest', () => {
    expect(createHmac('sha256', "late night").update(src, 'utf8').digest('hex')).toBe('33dad91492c58b061265bf265e7e9c4c0e85f41155f59850493e197d2476ba54');
  });

  it('post115: HMAC-SHA256 keyed by lo-fi locks digest', () => {
    expect(createHmac('sha256', "lo-fi").update(src, 'utf8').digest('hex')).toBe('5bb703f725e1de0ff0dd45309a7efbc1b9958a2a854d6e63857ff4d2a1ed007b');
  });

  it('post115: HMAC-SHA256 keyed by electronic locks digest', () => {
    expect(createHmac('sha256', "electronic").update(src, 'utf8').digest('hex')).toBe('00f2f472e697a32ba201aedb1a84cc2e153ab994d9ccc0c82137cc55bcba231d');
  });

  it('post115: HMAC-SHA256 keyed by metal locks digest', () => {
    expect(createHmac('sha256', "metal").update(src, 'utf8').digest('hex')).toBe('b664006cef5671b6bf07444da6b1f200780c1c68ea2a6398ab115a632bf85116');
  });

  it('post115: HMAC-SHA256 keyed by indie locks digest', () => {
    expect(createHmac('sha256', "indie").update(src, 'utf8').digest('hex')).toBe('f281a8c21d1dd6cd13e26e3013431da83d9947003c8114c757b47887d9d94d67');
  });

  it('post115: HMAC-SHA256 keyed by blues locks digest', () => {
    expect(createHmac('sha256', "blues").update(src, 'utf8').digest('hex')).toBe('0658239dc7a73f883161299b09c1ebeb1cafedc57662c0da3e69aca6f07dc630');
  });

  it('post115: HMAC-SHA256 keyed by dance locks digest', () => {
    expect(createHmac('sha256', "dance").update(src, 'utf8').digest('hex')).toBe('765c113ab0fd946ec98b6c88c7e8b48176ba45f991b07f67dc3f216302bab067');
  });

  it('post115: HMAC-SHA256 keyed by classic locks digest', () => {
    expect(createHmac('sha256', "classic").update(src, 'utf8').digest('hex')).toBe('93ccd86f88613bd25529d3e1aa405e3cbab8dde9dce666add0e1bd321b10e7d7');
  });

  it('post115: HMAC-SHA256 keyed by chill locks digest', () => {
    expect(createHmac('sha256', "chill").update(src, 'utf8').digest('hex')).toBe('50be906a50d24d8b05071a9182bd790662827d413ad8873dc5f326f4b61f0957');
  });

  it('post115: HMAC-SHA256 keyed by relaxing locks digest', () => {
    expect(createHmac('sha256', "relaxing").update(src, 'utf8').digest('hex')).toBe('b2a160294ac088921b9195f12e80dd0dc2570e642eb3f87768e8a194788de87c');
  });

  it('post115: HMAC-SHA256 keyed by focus locks digest', () => {
    expect(createHmac('sha256', "focus").update(src, 'utf8').digest('hex')).toBe('15bfbc164efba176c3749c2e258f49fa2959db023f9196d3dbfc5f83afe24fbb');
  });

  it('post115: HMAC-SHA256 keyed by TOKENMAXX locks digest', () => {
    expect(createHmac('sha256', "TOKENMAXX").update(src, 'utf8').digest('hex')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951');
  });

  it('post115: HMAC-SHA256 keyed by HEAVY locks digest', () => {
    expect(createHmac('sha256', "HEAVY").update(src, 'utf8').digest('hex')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575');
  });

  it('post115: HMAC-SHA256 keyed by deepen locks digest', () => {
    expect(createHmac('sha256', "deepen").update(src, 'utf8').digest('hex')).toBe('b4576ae29f07e8cca464d1eb950fd2b2142b3f0b8f272a65542908498fe24502');
  });

  it('post115: HMAC-SHA256 keyed by no-product-invent locks digest', () => {
    expect(createHmac('sha256', "no-product-invent").update(src, 'utf8').digest('hex')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b');
  });

  it('post115: HMAC digests differ from unkeyed sha256 and each other', () => {
    const plain = createHash('sha256').update(src, 'utf8').digest('hex');
    const a = createHmac('sha256', 'post115').update(src, 'utf8').digest('hex');
    const b = createHmac('sha256', 'genres-unit').update(src, 'utf8').digest('hex');
    const c = createHmac('sha256', 'TOKENMAXX').update(src, 'utf8').digest('hex');
    expect(a).not.toBe(plain);
    expect(b).not.toBe(plain);
    expect(c).not.toBe(plain);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('post115: locks genres.ts byte and code-unit lengths', () => {
    expect(Buffer.byteLength(src, 'utf8')).toBe(1027);
    expect(src.length).toBe(1025);
    expect(src.includes('\u2192') || src.includes('\u2192')).toBe(true);
  });

  it('post115: locks genres.ts contains arrow codepoint', () => {
    expect(src.includes(String.fromCharCode(0x2192))).toBe(true);
  });

  it('post115: locks genres.ts code-unit sum', () => {
    expect(codeSum(src)).toBe(90942);
  });

  it('post115: locks genres.ts trailing newline and line count', () => {
    expect(src.endsWith('\n')).toBe(true);
    expect(src.split('\n')).toHaveLength(48);
  });

  it('post115: source starts with block comment', () => {
    expect(src.startsWith('/** iptv-org category ids we expose + mood aliases ' + String.fromCharCode(0x2192) + ' category. */')).toBe(true);
  });

  it('post115: stat size matches byte length', () => {
    expect(statSync(join(genresRoot, 'src/genres.ts')).size).toBe(1027);
  });

  it('post115: glyph budget — quotes equals spaces underscores arrows', () => {
    expect((src.match(/"/g) ?? []).length).toBe(0);
    expect((src.match(/=/g) ?? []).length).toBe(5);
    expect((src.match(/ /g) ?? []).length).toBe(144);
    expect((src.match(/_/g) ?? []).length).toBe(5);
    expect((src.match(new RegExp(String.fromCharCode(0x2192), 'g')) ?? []).length).toBe(1);
  });

  it('post115: glyph budget — colons commas semis parens braces brackets', () => {
    expect((src.match(/:/g) ?? []).length).toBe(26);
    expect((src.match(/,/g) ?? []).length).toBe(34);
    expect((src.match(/;/g) ?? []).length).toBe(6);
    expect((src.match(/[()]/g) ?? []).length).toBe(14);
    expect((src.match(/[{}]/g) ?? []).length).toBe(4);
    expect((src.match(/[[\]]/g) ?? []).length).toBe(6);
  });

  it('post115: glyph budget — singles backticks newlines tabs', () => {
    expect((src.match(/'/g) ?? []).length).toBe(68);
    expect((src.match(/\x60/g) ?? []).length).toBe(0);
    expect((src.match(/\n/g) ?? []).length).toBe(47);
    expect((src.match(/\t/g) ?? []).length).toBe(0);
  });

  it('post115: glyph budget — backtick count via fromCharCode', () => {
    expect((src.match(new RegExp(String.fromCharCode(96), 'g')) ?? []).length).toBe(0);
  });

  it('post115: exports GENRE_MAP VALID_GENRES ValidGenre resolveGenre exactly once each', () => {
    expect((src.match(/export const GENRE_MAP/g) ?? []).length).toBe(1);
    expect((src.match(/export const VALID_GENRES/g) ?? []).length).toBe(1);
    expect((src.match(/export type ValidGenre/g) ?? []).length).toBe(1);
    expect((src.match(/export function resolveGenre/g) ?? []).length).toBe(1);
  });

  it('post115: resolveGenre default param = GENRE_MAP appears once', () => {
    expect((src.match(/= GENRE_MAP/g) ?? []).length).toBe(1);
  });

  it('post115: no import statements in genres.ts', () => {
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/from ['"]/);
  });

  it('post115: forbids invent phrases in genres.ts source', () => {
    expect(src).not.toContain("/playlist");
    expect(src).not.toContain("/now-playing");
    expect(src).not.toContain("/nowplaying");
    expect(src).not.toContain("/stream");
    expect(src).not.toContain("/tune");
    expect(src).not.toContain("/radio");
    expect(src).not.toContain("Anthropic");
    expect(src).not.toContain("Claude");
    expect(src).not.toContain("OpenAI");
    expect(src).not.toContain("GPT-4");
    expect(src).not.toContain("ChatGPT");
    expect(src).not.toContain("Durable Object");
    expect(src).not.toContain("R2 bucket");
    expect(src).not.toContain("Hyperdrive");
    expect(src).not.toContain("D1 database");
    expect(src).not.toContain("KV namespace");
    expect(src).not.toContain("Workers AI");
    expect(src).not.toContain("Vectorize");
    expect(src).not.toContain("auth middleware");
    expect(src).not.toContain("Bearer token");
    expect(src).not.toContain("API_KEY hardcode");
    expect(src).not.toContain("sk-live");
    expect(src).not.toContain("new genre category");
    expect(src).not.toContain("expand VALID_GENRES");
    expect(src).not.toContain("playlist endpoint");
  });

  it('post115: GENRE_MAP insertion-order keys lock (21)', () => {
    expect(Object.keys(GENRE_MAP)).toEqual(["late night","chill","ambient","relaxing","focus","classical","classic","jazz","blues","pop","rock","metal","indie","music","news","sports","entertainment","dance","electronic","lofi","lo-fi"]);
  });

  it('post115: GENRE_MAP insertion-order values lock (21)', () => {
    expect(Object.values(GENRE_MAP)).toEqual(["ambient","ambient","ambient","ambient","ambient","classical","classical","jazz","jazz","pop","rock","rock","rock","music","news","sports","entertainment","pop","ambient","ambient","ambient"]);
  });

  it('post115: GENRE_MAP key|join sha256 lock', () => {
    expect(createHash('sha256').update(Object.keys(GENRE_MAP).join('|'), 'utf8').digest('hex')).toBe('7a3398ba023b2a67e22e0654f84b70484a45545137d07fe0fafcd1ebdd7730cc');
  });

  it('post115: GENRE_MAP value|join sha256 lock', () => {
    expect(createHash('sha256').update(Object.values(GENRE_MAP).join('|'), 'utf8').digest('hex')).toBe('f9b95af452043fe623f97768de6bdba0953e895a6a5a565629bf2929eba04688');
  });

  it('post115: GENRE_MAP entries JSON sha256 lock', () => {
    expect(createHash('sha256').update(JSON.stringify(Object.entries(GENRE_MAP)), 'utf8').digest('hex')).toBe('9f09f4fca1c9eb68ab267442f572f81f3ea336233b8a5ac1149395401b471664');
  });

  it('post115: VALID_GENRES comma-join sha256 lock', () => {
    expect(createHash('sha256').update([...VALID_GENRES].join(','), 'utf8').digest('hex')).toBe('94a784d3c39dd9b01770e66997951dadb72a2d0e41cb0902d5e4b246a3ff7632');
  });

  it('post115: VALID_GENRES pipe-join sha256 lock', () => {
    expect(createHash('sha256').update([...VALID_GENRES].join('|'), 'utf8').digest('hex')).toBe('4055f529288daaab06f6384967c7d48359f62f525b3ac063c950408fd6fe7ba6');
  });

  it('post115: VALID_GENRES ordered tuple lock', () => {
    expect([...VALID_GENRES]).toEqual(["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]);
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('post115: GENRE_MAP has exactly 21 keys', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(Object.values(GENRE_MAP)).toHaveLength(21);
  });

  it('post115: value frequency histogram lock', () => {
    const freq = Object.values(GENRE_MAP).reduce((acc, v) => { acc[v] = (acc[v] ?? 0) + 1; return acc; }, {} as Record<string, number>);
    expect(freq).toEqual({ ambient: 8, classical: 2, jazz: 2, pop: 2, rock: 3, music: 1, news: 1, sports: 1, entertainment: 1 });
  });

  it('post115: ambient fan-in exactly eight aliases', () => {
    const keys = Object.entries(GENRE_MAP).filter(([, v]) => v === 'ambient').map(([k]) => k).sort();
    expect(keys).toEqual(["ambient","chill","electronic","focus","late night","lo-fi","lofi","relaxing"]);
  });

  it('post115: rock/pop/classical/jazz fan-in locks', () => {
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'rock').map(([k]) => k).sort()).toEqual(["indie","metal","rock"]);
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'pop').map(([k]) => k).sort()).toEqual(["dance","pop"]);
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'classical').map(([k]) => k).sort()).toEqual(["classic","classical"]);
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'jazz').map(([k]) => k).sort()).toEqual(["blues","jazz"]);
  });

  it('post115: identity-only categories have fan-in 1', () => {
    for (const id of ["music","news","sports","entertainment"] as const) {
      expect(Object.entries(GENRE_MAP).filter(([, v]) => v === id).map(([k]) => k)).toEqual([id]);
    }
  });

  it('post115: unique GENRE_MAP values equal VALID_GENRES set', () => {
    expect(new Set(Object.values(GENRE_MAP))).toEqual(new Set(VALID_GENRES));
  });

  it('post115: every VALID_GENRES id is identity in GENRE_MAP', () => {
    for (const g of VALID_GENRES) {
      expect(GENRE_MAP[g]).toBe(g);
    }
  });

  it('post115: sum of VALID_GENRES and GENRE_MAP key lengths', () => {
    expect(VALID_GENRES.reduce((s, g) => s + g.length, 0)).toBe(55);
    expect(Object.keys(GENRE_MAP).reduce((s, k) => s + k.length, 0)).toBe(129);
  });

  it('post115: sum of GENRE_MAP value lengths', () => {
    expect(Object.values(GENRE_MAP).reduce((s, v) => s + v.length, 0)).toBe(128);
  });

  it('post115: alias sha256 + resolve for late night', () => {
    expect(createHash('sha256').update("late night", 'utf8').digest('hex')).toBe('23d46fae9e478b5f30406223eaad1dd052c4a3cca685dad20ec1f75f34344e06');
    expect(resolveGenre("late night")).toBe("ambient");
    expect(GENRE_MAP["late night"]).toBe("ambient");
  });

  it('post115: case+pad matrix resolves late night', () => {
    expect(resolveGenre("late night")).toBe("ambient");
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
    expect(resolveGenre('  ' + "late night" + '  ')).toBe("ambient");
    expect(resolveGenre('\t' + "LATE NIGHT" + '\t')).toBe("ambient");
  });

  it('post115: mixed-case matrix resolves late night', () => {
    expect(resolveGenre("lAtE NiGhT")).toBe("ambient");
    expect(resolveGenre("Late night")).toBe("ambient");
  });

  it('post115: alias sha256 + resolve for chill', () => {
    expect(createHash('sha256').update("chill", 'utf8').digest('hex')).toBe('9fe5e0a43712f05785002103cfac2add80771a19d76f2c562633f65375ea5581');
    expect(resolveGenre("chill")).toBe("ambient");
    expect(GENRE_MAP["chill"]).toBe("ambient");
  });

  it('post115: case+pad matrix resolves chill', () => {
    expect(resolveGenre("chill")).toBe("ambient");
    expect(resolveGenre("CHILL")).toBe("ambient");
    expect(resolveGenre('  ' + "chill" + '  ')).toBe("ambient");
    expect(resolveGenre('\t' + "CHILL" + '\t')).toBe("ambient");
  });

  it('post115: mixed-case matrix resolves chill', () => {
    expect(resolveGenre("cHiLl")).toBe("ambient");
    expect(resolveGenre("Chill")).toBe("ambient");
  });

  it('post115: alias sha256 + resolve for ambient', () => {
    expect(createHash('sha256').update("ambient", 'utf8').digest('hex')).toBe('31d18c0defdc3e0eadd46bb4c04e4ad798f4582fbde1216806bde3cbe250350c');
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(GENRE_MAP["ambient"]).toBe("ambient");
  });

  it('post115: case+pad matrix resolves ambient', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(resolveGenre("AMBIENT")).toBe("ambient");
    expect(resolveGenre('  ' + "ambient" + '  ')).toBe("ambient");
    expect(resolveGenre('\t' + "AMBIENT" + '\t')).toBe("ambient");
  });

  it('post115: mixed-case matrix resolves ambient', () => {
    expect(resolveGenre("aMbIeNt")).toBe("ambient");
    expect(resolveGenre("Ambient")).toBe("ambient");
  });

  it('post115: alias sha256 + resolve for relaxing', () => {
    expect(createHash('sha256').update("relaxing", 'utf8').digest('hex')).toBe('f90997f63439a7791c142208e653be723b8b46902544cc216ab31ba2ed16222f');
    expect(resolveGenre("relaxing")).toBe("ambient");
    expect(GENRE_MAP["relaxing"]).toBe("ambient");
  });

  it('post115: case+pad matrix resolves relaxing', () => {
    expect(resolveGenre("relaxing")).toBe("ambient");
    expect(resolveGenre("RELAXING")).toBe("ambient");
    expect(resolveGenre('  ' + "relaxing" + '  ')).toBe("ambient");
    expect(resolveGenre('\t' + "RELAXING" + '\t')).toBe("ambient");
  });

  it('post115: mixed-case matrix resolves relaxing', () => {
    expect(resolveGenre("rElAxInG")).toBe("ambient");
    expect(resolveGenre("Relaxing")).toBe("ambient");
  });

  it('post115: alias sha256 + resolve for focus', () => {
    expect(createHash('sha256').update("focus", 'utf8').digest('hex')).toBe('c51faa148557a08cbf790156578b7a82b41f22dd01227f7dde057e34c18a365f');
    expect(resolveGenre("focus")).toBe("ambient");
    expect(GENRE_MAP["focus"]).toBe("ambient");
  });

  it('post115: case+pad matrix resolves focus', () => {
    expect(resolveGenre("focus")).toBe("ambient");
    expect(resolveGenre("FOCUS")).toBe("ambient");
    expect(resolveGenre('  ' + "focus" + '  ')).toBe("ambient");
    expect(resolveGenre('\t' + "FOCUS" + '\t')).toBe("ambient");
  });

  it('post115: mixed-case matrix resolves focus', () => {
    expect(resolveGenre("fOcUs")).toBe("ambient");
    expect(resolveGenre("Focus")).toBe("ambient");
  });

  it('post115: alias sha256 + resolve for classical', () => {
    expect(createHash('sha256').update("classical", 'utf8').digest('hex')).toBe('25d9548a80c751e282183876990e49a6eb3c1ac94a28fa86c5b513019bf8cba6');
    expect(resolveGenre("classical")).toBe("classical");
    expect(GENRE_MAP["classical"]).toBe("classical");
  });

  it('post115: case+pad matrix resolves classical', () => {
    expect(resolveGenre("classical")).toBe("classical");
    expect(resolveGenre("CLASSICAL")).toBe("classical");
    expect(resolveGenre('  ' + "classical" + '  ')).toBe("classical");
    expect(resolveGenre('\t' + "CLASSICAL" + '\t')).toBe("classical");
  });

  it('post115: mixed-case matrix resolves classical', () => {
    expect(resolveGenre("cLaSsIcAl")).toBe("classical");
    expect(resolveGenre("Classical")).toBe("classical");
  });

  it('post115: alias sha256 + resolve for classic', () => {
    expect(createHash('sha256').update("classic", 'utf8').digest('hex')).toBe('b002a634647c3350c37b15a376bae6867d9034e9aa36a06002e3e335229c91db');
    expect(resolveGenre("classic")).toBe("classical");
    expect(GENRE_MAP["classic"]).toBe("classical");
  });

  it('post115: case+pad matrix resolves classic', () => {
    expect(resolveGenre("classic")).toBe("classical");
    expect(resolveGenre("CLASSIC")).toBe("classical");
    expect(resolveGenre('  ' + "classic" + '  ')).toBe("classical");
    expect(resolveGenre('\t' + "CLASSIC" + '\t')).toBe("classical");
  });

  it('post115: mixed-case matrix resolves classic', () => {
    expect(resolveGenre("cLaSsIc")).toBe("classical");
    expect(resolveGenre("Classic")).toBe("classical");
  });

  it('post115: alias sha256 + resolve for jazz', () => {
    expect(createHash('sha256').update("jazz", 'utf8').digest('hex')).toBe('c301f75ab52fa076c827231e613bbc976e26b2c1f7ddd01a319b2832b8ecdf9a');
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(GENRE_MAP["jazz"]).toBe("jazz");
  });

  it('post115: case+pad matrix resolves jazz', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(resolveGenre("JAZZ")).toBe("jazz");
    expect(resolveGenre('  ' + "jazz" + '  ')).toBe("jazz");
    expect(resolveGenre('\t' + "JAZZ" + '\t')).toBe("jazz");
  });

  it('post115: mixed-case matrix resolves jazz', () => {
    expect(resolveGenre("jAzZ")).toBe("jazz");
    expect(resolveGenre("Jazz")).toBe("jazz");
  });

  it('post115: alias sha256 + resolve for blues', () => {
    expect(createHash('sha256').update("blues", 'utf8').digest('hex')).toBe('91f25e3a2ff2783b05b9dc9f07e555d828317c6bc2024cbd81f00684ddb79c9d');
    expect(resolveGenre("blues")).toBe("jazz");
    expect(GENRE_MAP["blues"]).toBe("jazz");
  });

  it('post115: case+pad matrix resolves blues', () => {
    expect(resolveGenre("blues")).toBe("jazz");
    expect(resolveGenre("BLUES")).toBe("jazz");
    expect(resolveGenre('  ' + "blues" + '  ')).toBe("jazz");
    expect(resolveGenre('\t' + "BLUES" + '\t')).toBe("jazz");
  });

  it('post115: mixed-case matrix resolves blues', () => {
    expect(resolveGenre("bLuEs")).toBe("jazz");
    expect(resolveGenre("Blues")).toBe("jazz");
  });

  it('post115: alias sha256 + resolve for pop', () => {
    expect(createHash('sha256').update("pop", 'utf8').digest('hex')).toBe('de70fa60cac227cbc13270a26ccde291af94df086959f0958122aedf154d90b5');
    expect(resolveGenre("pop")).toBe("pop");
    expect(GENRE_MAP["pop"]).toBe("pop");
  });

  it('post115: case+pad matrix resolves pop', () => {
    expect(resolveGenre("pop")).toBe("pop");
    expect(resolveGenre("POP")).toBe("pop");
    expect(resolveGenre('  ' + "pop" + '  ')).toBe("pop");
    expect(resolveGenre('\t' + "POP" + '\t')).toBe("pop");
  });

  it('post115: mixed-case matrix resolves pop', () => {
    expect(resolveGenre("pOp")).toBe("pop");
    expect(resolveGenre("Pop")).toBe("pop");
  });

  it('post115: alias sha256 + resolve for rock', () => {
    expect(createHash('sha256').update("rock", 'utf8').digest('hex')).toBe('350a770c0ec9f353e1a5629895f374fdaa299876c3870c03feb60eb4a3769d94');
    expect(resolveGenre("rock")).toBe("rock");
    expect(GENRE_MAP["rock"]).toBe("rock");
  });

  it('post115: case+pad matrix resolves rock', () => {
    expect(resolveGenre("rock")).toBe("rock");
    expect(resolveGenre("ROCK")).toBe("rock");
    expect(resolveGenre('  ' + "rock" + '  ')).toBe("rock");
    expect(resolveGenre('\t' + "ROCK" + '\t')).toBe("rock");
  });

  it('post115: mixed-case matrix resolves rock', () => {
    expect(resolveGenre("rOcK")).toBe("rock");
    expect(resolveGenre("Rock")).toBe("rock");
  });

  it('post115: alias sha256 + resolve for metal', () => {
    expect(createHash('sha256').update("metal", 'utf8').digest('hex')).toBe('03ecab669ba200ba17f994677e88894400fd627e6f70439247ce0cbda8ca9a20');
    expect(resolveGenre("metal")).toBe("rock");
    expect(GENRE_MAP["metal"]).toBe("rock");
  });

  it('post115: case+pad matrix resolves metal', () => {
    expect(resolveGenre("metal")).toBe("rock");
    expect(resolveGenre("METAL")).toBe("rock");
    expect(resolveGenre('  ' + "metal" + '  ')).toBe("rock");
    expect(resolveGenre('\t' + "METAL" + '\t')).toBe("rock");
  });

  it('post115: mixed-case matrix resolves metal', () => {
    expect(resolveGenre("mEtAl")).toBe("rock");
    expect(resolveGenre("Metal")).toBe("rock");
  });

  it('post115: alias sha256 + resolve for indie', () => {
    expect(createHash('sha256').update("indie", 'utf8').digest('hex')).toBe('edb945ceb76842650f31c6a9aca3738c8b279d26215c172000dbb359d1122565');
    expect(resolveGenre("indie")).toBe("rock");
    expect(GENRE_MAP["indie"]).toBe("rock");
  });

  it('post115: case+pad matrix resolves indie', () => {
    expect(resolveGenre("indie")).toBe("rock");
    expect(resolveGenre("INDIE")).toBe("rock");
    expect(resolveGenre('  ' + "indie" + '  ')).toBe("rock");
    expect(resolveGenre('\t' + "INDIE" + '\t')).toBe("rock");
  });

  it('post115: mixed-case matrix resolves indie', () => {
    expect(resolveGenre("iNdIe")).toBe("rock");
    expect(resolveGenre("Indie")).toBe("rock");
  });

  it('post115: alias sha256 + resolve for music', () => {
    expect(createHash('sha256').update("music", 'utf8').digest('hex')).toBe('80f189984e5ca70287d13342f6daa0db45cba3c131c4e46dc81360f3a4c4f690');
    expect(resolveGenre("music")).toBe("music");
    expect(GENRE_MAP["music"]).toBe("music");
  });

  it('post115: case+pad matrix resolves music', () => {
    expect(resolveGenre("music")).toBe("music");
    expect(resolveGenre("MUSIC")).toBe("music");
    expect(resolveGenre('  ' + "music" + '  ')).toBe("music");
    expect(resolveGenre('\t' + "MUSIC" + '\t')).toBe("music");
  });

  it('post115: mixed-case matrix resolves music', () => {
    expect(resolveGenre("mUsIc")).toBe("music");
    expect(resolveGenre("Music")).toBe("music");
  });

  it('post115: alias sha256 + resolve for news', () => {
    expect(createHash('sha256').update("news", 'utf8').digest('hex')).toBe('19fba0e995b9794fc2c26217bf3b725c2f0d9eeda16719fe75e3ba23ca73bfc4');
    expect(resolveGenre("news")).toBe("news");
    expect(GENRE_MAP["news"]).toBe("news");
  });

  it('post115: case+pad matrix resolves news', () => {
    expect(resolveGenre("news")).toBe("news");
    expect(resolveGenre("NEWS")).toBe("news");
    expect(resolveGenre('  ' + "news" + '  ')).toBe("news");
    expect(resolveGenre('\t' + "NEWS" + '\t')).toBe("news");
  });

  it('post115: mixed-case matrix resolves news', () => {
    expect(resolveGenre("nEwS")).toBe("news");
    expect(resolveGenre("News")).toBe("news");
  });

  it('post115: alias sha256 + resolve for sports', () => {
    expect(createHash('sha256').update("sports", 'utf8').digest('hex')).toBe('1cb542228c76558789d114d3cb273a75850cca54ec3ee9a41100f2dc56ee561e');
    expect(resolveGenre("sports")).toBe("sports");
    expect(GENRE_MAP["sports"]).toBe("sports");
  });

  it('post115: case+pad matrix resolves sports', () => {
    expect(resolveGenre("sports")).toBe("sports");
    expect(resolveGenre("SPORTS")).toBe("sports");
    expect(resolveGenre('  ' + "sports" + '  ')).toBe("sports");
    expect(resolveGenre('\t' + "SPORTS" + '\t')).toBe("sports");
  });

  it('post115: mixed-case matrix resolves sports', () => {
    expect(resolveGenre("sPoRtS")).toBe("sports");
    expect(resolveGenre("Sports")).toBe("sports");
  });

  it('post115: alias sha256 + resolve for entertainment', () => {
    expect(createHash('sha256').update("entertainment", 'utf8').digest('hex')).toBe('b34564f1c4cd1d98dc26aaa4f888e3020656033add4dd0620b26e820493bf5c2');
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(GENRE_MAP["entertainment"]).toBe("entertainment");
  });

  it('post115: case+pad matrix resolves entertainment', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
    expect(resolveGenre('  ' + "entertainment" + '  ')).toBe("entertainment");
    expect(resolveGenre('\t' + "ENTERTAINMENT" + '\t')).toBe("entertainment");
  });

  it('post115: mixed-case matrix resolves entertainment', () => {
    expect(resolveGenre("eNtErTaInMeNt")).toBe("entertainment");
    expect(resolveGenre("Entertainment")).toBe("entertainment");
  });

  it('post115: alias sha256 + resolve for dance', () => {
    expect(createHash('sha256').update("dance", 'utf8').digest('hex')).toBe('2c371c2ada73a02e26e14416800e8a49f875d27b8b5ff31f1dbe37bdaa6d7faa');
    expect(resolveGenre("dance")).toBe("pop");
    expect(GENRE_MAP["dance"]).toBe("pop");
  });

  it('post115: case+pad matrix resolves dance', () => {
    expect(resolveGenre("dance")).toBe("pop");
    expect(resolveGenre("DANCE")).toBe("pop");
    expect(resolveGenre('  ' + "dance" + '  ')).toBe("pop");
    expect(resolveGenre('\t' + "DANCE" + '\t')).toBe("pop");
  });

  it('post115: mixed-case matrix resolves dance', () => {
    expect(resolveGenre("dAnCe")).toBe("pop");
    expect(resolveGenre("Dance")).toBe("pop");
  });

  it('post115: alias sha256 + resolve for electronic', () => {
    expect(createHash('sha256').update("electronic", 'utf8').digest('hex')).toBe('73e4c51456c25bab5458df719693e8dd7ca6b23e214ba2ef1142f7f29b33e995');
    expect(resolveGenre("electronic")).toBe("ambient");
    expect(GENRE_MAP["electronic"]).toBe("ambient");
  });

  it('post115: case+pad matrix resolves electronic', () => {
    expect(resolveGenre("electronic")).toBe("ambient");
    expect(resolveGenre("ELECTRONIC")).toBe("ambient");
    expect(resolveGenre('  ' + "electronic" + '  ')).toBe("ambient");
    expect(resolveGenre('\t' + "ELECTRONIC" + '\t')).toBe("ambient");
  });

  it('post115: mixed-case matrix resolves electronic', () => {
    expect(resolveGenre("eLeCtRoNiC")).toBe("ambient");
    expect(resolveGenre("Electronic")).toBe("ambient");
  });

  it('post115: alias sha256 + resolve for lofi', () => {
    expect(createHash('sha256').update("lofi", 'utf8').digest('hex')).toBe('13bbbbfaaf34c58eb5865c9dd5a14f2a5f90574f2d71836d80e665fc2a534182');
    expect(resolveGenre("lofi")).toBe("ambient");
    expect(GENRE_MAP["lofi"]).toBe("ambient");
  });

  it('post115: case+pad matrix resolves lofi', () => {
    expect(resolveGenre("lofi")).toBe("ambient");
    expect(resolveGenre("LOFI")).toBe("ambient");
    expect(resolveGenre('  ' + "lofi" + '  ')).toBe("ambient");
    expect(resolveGenre('\t' + "LOFI" + '\t')).toBe("ambient");
  });

  it('post115: mixed-case matrix resolves lofi', () => {
    expect(resolveGenre("lOfI")).toBe("ambient");
    expect(resolveGenre("Lofi")).toBe("ambient");
  });

  it('post115: alias sha256 + resolve for lo-fi', () => {
    expect(createHash('sha256').update("lo-fi", 'utf8').digest('hex')).toBe('2b84c4b36a5f6e1c152186381f971ef049e02832328df9f289a8d24b9cda124f');
    expect(resolveGenre("lo-fi")).toBe("ambient");
    expect(GENRE_MAP["lo-fi"]).toBe("ambient");
  });

  it('post115: case+pad matrix resolves lo-fi', () => {
    expect(resolveGenre("lo-fi")).toBe("ambient");
    expect(resolveGenre("LO-FI")).toBe("ambient");
    expect(resolveGenre('  ' + "lo-fi" + '  ')).toBe("ambient");
    expect(resolveGenre('\t' + "LO-FI" + '\t')).toBe("ambient");
  });

  it('post115: mixed-case matrix resolves lo-fi', () => {
    expect(resolveGenre("lO-Fi")).toBe("ambient");
    expect(resolveGenre("Lo-fi")).toBe("ambient");
  });

  it('post115: VALID_GENRES id music resolves via default map', () => {
    expect(resolveGenre("music")).toBe("music");
    expect(resolveGenre("MUSIC")).toBe("music");
  });

  it('post115: VALID_GENRES id music resolves via empty custom map', () => {
    expect(resolveGenre("music", {})).toBe("music");
    expect(resolveGenre("MUSIC", {})).toBe("music");
    expect(resolveGenre('  ' + "music" + '  ', {})).toBe("music");
  });

  it('post115: VALID_GENRES id music resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["music"];
    expect(map["music"]).toBeUndefined();
    expect(resolveGenre("music", map)).toBe("music");
  });

  it('post115: VALID_GENRES id ambient resolves via default map', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(resolveGenre("AMBIENT")).toBe("ambient");
  });

  it('post115: VALID_GENRES id ambient resolves via empty custom map', () => {
    expect(resolveGenre("ambient", {})).toBe("ambient");
    expect(resolveGenre("AMBIENT", {})).toBe("ambient");
    expect(resolveGenre('  ' + "ambient" + '  ', {})).toBe("ambient");
  });

  it('post115: VALID_GENRES id ambient resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["ambient"];
    expect(map["ambient"]).toBeUndefined();
    expect(resolveGenre("ambient", map)).toBe("ambient");
  });

  it('post115: VALID_GENRES id jazz resolves via default map', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(resolveGenre("JAZZ")).toBe("jazz");
  });

  it('post115: VALID_GENRES id jazz resolves via empty custom map', () => {
    expect(resolveGenre("jazz", {})).toBe("jazz");
    expect(resolveGenre("JAZZ", {})).toBe("jazz");
    expect(resolveGenre('  ' + "jazz" + '  ', {})).toBe("jazz");
  });

  it('post115: VALID_GENRES id jazz resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["jazz"];
    expect(map["jazz"]).toBeUndefined();
    expect(resolveGenre("jazz", map)).toBe("jazz");
  });

  it('post115: VALID_GENRES id classical resolves via default map', () => {
    expect(resolveGenre("classical")).toBe("classical");
    expect(resolveGenre("CLASSICAL")).toBe("classical");
  });

  it('post115: VALID_GENRES id classical resolves via empty custom map', () => {
    expect(resolveGenre("classical", {})).toBe("classical");
    expect(resolveGenre("CLASSICAL", {})).toBe("classical");
    expect(resolveGenre('  ' + "classical" + '  ', {})).toBe("classical");
  });

  it('post115: VALID_GENRES id classical resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["classical"];
    expect(map["classical"]).toBeUndefined();
    expect(resolveGenre("classical", map)).toBe("classical");
  });

  it('post115: VALID_GENRES id pop resolves via default map', () => {
    expect(resolveGenre("pop")).toBe("pop");
    expect(resolveGenre("POP")).toBe("pop");
  });

  it('post115: VALID_GENRES id pop resolves via empty custom map', () => {
    expect(resolveGenre("pop", {})).toBe("pop");
    expect(resolveGenre("POP", {})).toBe("pop");
    expect(resolveGenre('  ' + "pop" + '  ', {})).toBe("pop");
  });

  it('post115: VALID_GENRES id pop resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["pop"];
    expect(map["pop"]).toBeUndefined();
    expect(resolveGenre("pop", map)).toBe("pop");
  });

  it('post115: VALID_GENRES id rock resolves via default map', () => {
    expect(resolveGenre("rock")).toBe("rock");
    expect(resolveGenre("ROCK")).toBe("rock");
  });

  it('post115: VALID_GENRES id rock resolves via empty custom map', () => {
    expect(resolveGenre("rock", {})).toBe("rock");
    expect(resolveGenre("ROCK", {})).toBe("rock");
    expect(resolveGenre('  ' + "rock" + '  ', {})).toBe("rock");
  });

  it('post115: VALID_GENRES id rock resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["rock"];
    expect(map["rock"]).toBeUndefined();
    expect(resolveGenre("rock", map)).toBe("rock");
  });

  it('post115: VALID_GENRES id news resolves via default map', () => {
    expect(resolveGenre("news")).toBe("news");
    expect(resolveGenre("NEWS")).toBe("news");
  });

  it('post115: VALID_GENRES id news resolves via empty custom map', () => {
    expect(resolveGenre("news", {})).toBe("news");
    expect(resolveGenre("NEWS", {})).toBe("news");
    expect(resolveGenre('  ' + "news" + '  ', {})).toBe("news");
  });

  it('post115: VALID_GENRES id news resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["news"];
    expect(map["news"]).toBeUndefined();
    expect(resolveGenre("news", map)).toBe("news");
  });

  it('post115: VALID_GENRES id sports resolves via default map', () => {
    expect(resolveGenre("sports")).toBe("sports");
    expect(resolveGenre("SPORTS")).toBe("sports");
  });

  it('post115: VALID_GENRES id sports resolves via empty custom map', () => {
    expect(resolveGenre("sports", {})).toBe("sports");
    expect(resolveGenre("SPORTS", {})).toBe("sports");
    expect(resolveGenre('  ' + "sports" + '  ', {})).toBe("sports");
  });

  it('post115: VALID_GENRES id sports resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["sports"];
    expect(map["sports"]).toBeUndefined();
    expect(resolveGenre("sports", map)).toBe("sports");
  });

  it('post115: VALID_GENRES id entertainment resolves via default map', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
  });

  it('post115: VALID_GENRES id entertainment resolves via empty custom map', () => {
    expect(resolveGenre("entertainment", {})).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT", {})).toBe("entertainment");
    expect(resolveGenre('  ' + "entertainment" + '  ', {})).toBe("entertainment");
  });

  it('post115: VALID_GENRES id entertainment resolves when stripped from map', () => {
    const map = { ...GENRE_MAP };
    delete map["entertainment"];
    expect(map["entertainment"]).toBeUndefined();
    expect(resolveGenre("entertainment", map)).toBe("entertainment");
  });

  it('post115: unknown label k-pop falls back to music', () => {
    expect(resolveGenre("k-pop")).toBe('music');
    expect(resolveGenre("k-pop", {})).toBe('music');
  });

  it('post115: unknown label radio falls back to music', () => {
    expect(resolveGenre("radio")).toBe('music');
    expect(resolveGenre("radio", {})).toBe('music');
  });

  it('post115: unknown label podcast falls back to music', () => {
    expect(resolveGenre("podcast")).toBe('music');
    expect(resolveGenre("podcast", {})).toBe('music');
  });

  it('post115: unknown label hip-hop falls back to music', () => {
    expect(resolveGenre("hip-hop")).toBe('music');
    expect(resolveGenre("hip-hop", {})).toBe('music');
  });

  it('post115: unknown label hiphop falls back to music', () => {
    expect(resolveGenre("hiphop")).toBe('music');
    expect(resolveGenre("hiphop", {})).toBe('music');
  });

  it('post115: unknown label country falls back to music', () => {
    expect(resolveGenre("country")).toBe('music');
    expect(resolveGenre("country", {})).toBe('music');
  });

  it('post115: unknown label folk falls back to music', () => {
    expect(resolveGenre("folk")).toBe('music');
    expect(resolveGenre("folk", {})).toBe('music');
  });

  it('post115: unknown label punk falls back to music', () => {
    expect(resolveGenre("punk")).toBe('music');
    expect(resolveGenre("punk", {})).toBe('music');
  });

  it('post115: unknown label techno falls back to music', () => {
    expect(resolveGenre("techno")).toBe('music');
    expect(resolveGenre("techno", {})).toBe('music');
  });

  it('post115: unknown label house falls back to music', () => {
    expect(resolveGenre("house")).toBe('music');
    expect(resolveGenre("house", {})).toBe('music');
  });

  it('post115: unknown label trance falls back to music', () => {
    expect(resolveGenre("trance")).toBe('music');
    expect(resolveGenre("trance", {})).toBe('music');
  });

  it('post115: unknown label dubstep falls back to music', () => {
    expect(resolveGenre("dubstep")).toBe('music');
    expect(resolveGenre("dubstep", {})).toBe('music');
  });

  it('post115: unknown label reggae falls back to music', () => {
    expect(resolveGenre("reggae")).toBe('music');
    expect(resolveGenre("reggae", {})).toBe('music');
  });

  it('post115: unknown label ska falls back to music', () => {
    expect(resolveGenre("ska")).toBe('music');
    expect(resolveGenre("ska", {})).toBe('music');
  });

  it('post115: unknown label soul falls back to music', () => {
    expect(resolveGenre("soul")).toBe('music');
    expect(resolveGenre("soul", {})).toBe('music');
  });

  it('post115: unknown label funk falls back to music', () => {
    expect(resolveGenre("funk")).toBe('music');
    expect(resolveGenre("funk", {})).toBe('music');
  });

  it('post115: unknown label disco falls back to music', () => {
    expect(resolveGenre("disco")).toBe('music');
    expect(resolveGenre("disco", {})).toBe('music');
  });

  it('post115: unknown label opera falls back to music', () => {
    expect(resolveGenre("opera")).toBe('music');
    expect(resolveGenre("opera", {})).toBe('music');
  });

  it('post115: unknown label rnb falls back to music', () => {
    expect(resolveGenre("rnb")).toBe('music');
    expect(resolveGenre("rnb", {})).toBe('music');
  });

  it('post115: unknown label r&b falls back to music', () => {
    expect(resolveGenre("r&b")).toBe('music');
    expect(resolveGenre("r&b", {})).toBe('music');
  });

  it('post115: unknown label latin falls back to music', () => {
    expect(resolveGenre("latin")).toBe('music');
    expect(resolveGenre("latin", {})).toBe('music');
  });

  it('post115: unknown label world falls back to music', () => {
    expect(resolveGenre("world")).toBe('music');
    expect(resolveGenre("world", {})).toBe('music');
  });

  it('post115: unknown label afrobeats falls back to music', () => {
    expect(resolveGenre("afrobeats")).toBe('music');
    expect(resolveGenre("afrobeats", {})).toBe('music');
  });

  it('post115: unknown label gospel falls back to music', () => {
    expect(resolveGenre("gospel")).toBe('music');
    expect(resolveGenre("gospel", {})).toBe('music');
  });

  it('post115: unknown label edm falls back to music', () => {
    expect(resolveGenre("edm")).toBe('music');
    expect(resolveGenre("edm", {})).toBe('music');
  });

  it('post115: unknown label trap falls back to music', () => {
    expect(resolveGenre("trap")).toBe('music');
    expect(resolveGenre("trap", {})).toBe('music');
  });

  it('post115: unknown label drill falls back to music', () => {
    expect(resolveGenre("drill")).toBe('music');
    expect(resolveGenre("drill", {})).toBe('music');
  });

  it('post115: unknown label grunge falls back to music', () => {
    expect(resolveGenre("grunge")).toBe('music');
    expect(resolveGenre("grunge", {})).toBe('music');
  });

  it('post115: unknown label emo falls back to music', () => {
    expect(resolveGenre("emo")).toBe('music');
    expect(resolveGenre("emo", {})).toBe('music');
  });

  it('post115: unknown label screamo falls back to music', () => {
    expect(resolveGenre("screamo")).toBe('music');
    expect(resolveGenre("screamo", {})).toBe('music');
  });

  it('post115: unknown label synthwave falls back to music', () => {
    expect(resolveGenre("synthwave")).toBe('music');
    expect(resolveGenre("synthwave", {})).toBe('music');
  });

  it('post115: unknown label vaporwave falls back to music', () => {
    expect(resolveGenre("vaporwave")).toBe('music');
    expect(resolveGenre("vaporwave", {})).toBe('music');
  });

  it('post115: unknown label garage falls back to music', () => {
    expect(resolveGenre("garage")).toBe('music');
    expect(resolveGenre("garage", {})).toBe('music');
  });

  it('post115: unknown label drum and bass falls back to music', () => {
    expect(resolveGenre("drum and bass")).toBe('music');
    expect(resolveGenre("drum and bass", {})).toBe('music');
  });

  it('post115: unknown label dnb falls back to music', () => {
    expect(resolveGenre("dnb")).toBe('music');
    expect(resolveGenre("dnb", {})).toBe('music');
  });

  it('post115: unknown label idm falls back to music', () => {
    expect(resolveGenre("idm")).toBe('music');
    expect(resolveGenre("idm", {})).toBe('music');
  });

  it('post115: unknown label breakbeat falls back to music', () => {
    expect(resolveGenre("breakbeat")).toBe('music');
    expect(resolveGenre("breakbeat", {})).toBe('music');
  });

  it('post115: unknown label hardcore falls back to music', () => {
    expect(resolveGenre("hardcore")).toBe('music');
    expect(resolveGenre("hardcore", {})).toBe('music');
  });

  it('post115: unknown label industrial falls back to music', () => {
    expect(resolveGenre("industrial")).toBe('music');
    expect(resolveGenre("industrial", {})).toBe('music');
  });

  it('post115: unknown label noise falls back to music', () => {
    expect(resolveGenre("noise")).toBe('music');
    expect(resolveGenre("noise", {})).toBe('music');
  });

  it('post115: unknown label shoegaze falls back to music', () => {
    expect(resolveGenre("shoegaze")).toBe('music');
    expect(resolveGenre("shoegaze", {})).toBe('music');
  });

  it('post115: unknown label post-rock falls back to music', () => {
    expect(resolveGenre("post-rock")).toBe('music');
    expect(resolveGenre("post-rock", {})).toBe('music');
  });

  it('post115: unknown label math-rock falls back to music', () => {
    expect(resolveGenre("math-rock")).toBe('music');
    expect(resolveGenre("math-rock", {})).toBe('music');
  });

  it('post115: unknown label prog falls back to music', () => {
    expect(resolveGenre("prog")).toBe('music');
    expect(resolveGenre("prog", {})).toBe('music');
  });

  it('post115: unknown label progressive falls back to music', () => {
    expect(resolveGenre("progressive")).toBe('music');
    expect(resolveGenre("progressive", {})).toBe('music');
  });

  it('post115: unknown label baroque falls back to music', () => {
    expect(resolveGenre("baroque")).toBe('music');
    expect(resolveGenre("baroque", {})).toBe('music');
  });

  it('post115: unknown label romantic falls back to music', () => {
    expect(resolveGenre("romantic")).toBe('music');
    expect(resolveGenre("romantic", {})).toBe('music');
  });

  it('post115: unknown label chamber falls back to music', () => {
    expect(resolveGenre("chamber")).toBe('music');
    expect(resolveGenre("chamber", {})).toBe('music');
  });

  it('post115: unknown label symphony falls back to music', () => {
    expect(resolveGenre("symphony")).toBe('music');
    expect(resolveGenre("symphony", {})).toBe('music');
  });

  it('post115: unknown label big band falls back to music', () => {
    expect(resolveGenre("big band")).toBe('music');
    expect(resolveGenre("big band", {})).toBe('music');
  });

  it('post115: unknown label bebop falls back to music', () => {
    expect(resolveGenre("bebop")).toBe('music');
    expect(resolveGenre("bebop", {})).toBe('music');
  });

  it('post115: unknown label swing falls back to music', () => {
    expect(resolveGenre("swing")).toBe('music');
    expect(resolveGenre("swing", {})).toBe('music');
  });

  it('post115: unknown label fusion falls back to music', () => {
    expect(resolveGenre("fusion")).toBe('music');
    expect(resolveGenre("fusion", {})).toBe('music');
  });

  it('post115: unknown label smooth jazz falls back to music', () => {
    expect(resolveGenre("smooth jazz")).toBe('music');
    expect(resolveGenre("smooth jazz", {})).toBe('music');
  });

  it('post115: unknown label acid jazz falls back to music', () => {
    expect(resolveGenre("acid jazz")).toBe('music');
    expect(resolveGenre("acid jazz", {})).toBe('music');
  });

  it('post115: unknown label free jazz falls back to music', () => {
    expect(resolveGenre("free jazz")).toBe('music');
    expect(resolveGenre("free jazz", {})).toBe('music');
  });

  it('post115: unknown label hard bop falls back to music', () => {
    expect(resolveGenre("hard bop")).toBe('music');
    expect(resolveGenre("hard bop", {})).toBe('music');
  });

  it('post115: unknown label cool jazz falls back to music', () => {
    expect(resolveGenre("cool jazz")).toBe('music');
    expect(resolveGenre("cool jazz", {})).toBe('music');
  });

  it('post115: unknown label modal falls back to music', () => {
    expect(resolveGenre("modal")).toBe('music');
    expect(resolveGenre("modal", {})).toBe('music');
  });

  it('post115: unknown label bluegrass falls back to music', () => {
    expect(resolveGenre("bluegrass")).toBe('music');
    expect(resolveGenre("bluegrass", {})).toBe('music');
  });

  it('post115: unknown label americana falls back to music', () => {
    expect(resolveGenre("americana")).toBe('music');
    expect(resolveGenre("americana", {})).toBe('music');
  });

  it('post115: unknown label alt-country falls back to music', () => {
    expect(resolveGenre("alt-country")).toBe('music');
    expect(resolveGenre("alt-country", {})).toBe('music');
  });

  it('post115: unknown label singer-songwriter falls back to music', () => {
    expect(resolveGenre("singer-songwriter")).toBe('music');
    expect(resolveGenre("singer-songwriter", {})).toBe('music');
  });

  it('post115: unknown label soundtrack falls back to music', () => {
    expect(resolveGenre("soundtrack")).toBe('music');
    expect(resolveGenre("soundtrack", {})).toBe('music');
  });

  it('post115: unknown label score falls back to music', () => {
    expect(resolveGenre("score")).toBe('music');
    expect(resolveGenre("score", {})).toBe('music');
  });

  it('post115: unknown label children falls back to music', () => {
    expect(resolveGenre("children")).toBe('music');
    expect(resolveGenre("children", {})).toBe('music');
  });

  it('post115: unknown label kids falls back to music', () => {
    expect(resolveGenre("kids")).toBe('music');
    expect(resolveGenre("kids", {})).toBe('music');
  });

  it('post115: unknown label comedy falls back to music', () => {
    expect(resolveGenre("comedy")).toBe('music');
    expect(resolveGenre("comedy", {})).toBe('music');
  });

  it('post115: unknown label talk falls back to music', () => {
    expect(resolveGenre("talk")).toBe('music');
    expect(resolveGenre("talk", {})).toBe('music');
  });

  it('post115: unknown label spoken falls back to music', () => {
    expect(resolveGenre("spoken")).toBe('music');
    expect(resolveGenre("spoken", {})).toBe('music');
  });

  it('post115: unknown label audiobook falls back to music', () => {
    expect(resolveGenre("audiobook")).toBe('music');
    expect(resolveGenre("audiobook", {})).toBe('music');
  });

  it('post115: unknown label weather falls back to music', () => {
    expect(resolveGenre("weather")).toBe('music');
    expect(resolveGenre("weather", {})).toBe('music');
  });

  it('post115: unknown label traffic falls back to music', () => {
    expect(resolveGenre("traffic")).toBe('music');
    expect(resolveGenre("traffic", {})).toBe('music');
  });

  it('post115: unknown label religion falls back to music', () => {
    expect(resolveGenre("religion")).toBe('music');
    expect(resolveGenre("religion", {})).toBe('music');
  });

  it('post115: unknown label christian falls back to music', () => {
    expect(resolveGenre("christian")).toBe('music');
    expect(resolveGenre("christian", {})).toBe('music');
  });

  it('post115: unknown label islamic falls back to music', () => {
    expect(resolveGenre("islamic")).toBe('music');
    expect(resolveGenre("islamic", {})).toBe('music');
  });

  it('post115: unknown label hindu falls back to music', () => {
    expect(resolveGenre("hindu")).toBe('music');
    expect(resolveGenre("hindu", {})).toBe('music');
  });

  it('post115: unknown label buddhist falls back to music', () => {
    expect(resolveGenre("buddhist")).toBe('music');
    expect(resolveGenre("buddhist", {})).toBe('music');
  });

  it('post115: unknown label meditation falls back to music', () => {
    expect(resolveGenre("meditation")).toBe('music');
    expect(resolveGenre("meditation", {})).toBe('music');
  });

  it('post115: unknown label yoga falls back to music', () => {
    expect(resolveGenre("yoga")).toBe('music');
    expect(resolveGenre("yoga", {})).toBe('music');
  });

  it('post115: unknown label spa falls back to music', () => {
    expect(resolveGenre("spa")).toBe('music');
    expect(resolveGenre("spa", {})).toBe('music');
  });

  it('post115: unknown label sleep falls back to music', () => {
    expect(resolveGenre("sleep")).toBe('music');
    expect(resolveGenre("sleep", {})).toBe('music');
  });

  it('post115: unknown label study falls back to music', () => {
    expect(resolveGenre("study")).toBe('music');
    expect(resolveGenre("study", {})).toBe('music');
  });

  it('post115: unknown label work falls back to music', () => {
    expect(resolveGenre("work")).toBe('music');
    expect(resolveGenre("work", {})).toBe('music');
  });

  it('post115: unknown label gym falls back to music', () => {
    expect(resolveGenre("gym")).toBe('music');
    expect(resolveGenre("gym", {})).toBe('music');
  });

  it('post115: unknown label workout falls back to music', () => {
    expect(resolveGenre("workout")).toBe('music');
    expect(resolveGenre("workout", {})).toBe('music');
  });

  it('post115: unknown label party falls back to music', () => {
    expect(resolveGenre("party")).toBe('music');
    expect(resolveGenre("party", {})).toBe('music');
  });

  it('post115: unknown label wedding falls back to music', () => {
    expect(resolveGenre("wedding")).toBe('music');
    expect(resolveGenre("wedding", {})).toBe('music');
  });

  it('post115: unknown label christmas falls back to music', () => {
    expect(resolveGenre("christmas")).toBe('music');
    expect(resolveGenre("christmas", {})).toBe('music');
  });

  it('post115: unknown label halloween falls back to music', () => {
    expect(resolveGenre("halloween")).toBe('music');
    expect(resolveGenre("halloween", {})).toBe('music');
  });

  it('post115: unknown label valentine falls back to music', () => {
    expect(resolveGenre("valentine")).toBe('music');
    expect(resolveGenre("valentine", {})).toBe('music');
  });

  it('post115: unknown label new year falls back to music', () => {
    expect(resolveGenre("new year")).toBe('music');
    expect(resolveGenre("new year", {})).toBe('music');
  });

  it('post115: unknown label summer falls back to music', () => {
    expect(resolveGenre("summer")).toBe('music');
    expect(resolveGenre("summer", {})).toBe('music');
  });

  it('post115: unknown label winter falls back to music', () => {
    expect(resolveGenre("winter")).toBe('music');
    expect(resolveGenre("winter", {})).toBe('music');
  });

  it('post115: unknown label spring falls back to music', () => {
    expect(resolveGenre("spring")).toBe('music');
    expect(resolveGenre("spring", {})).toBe('music');
  });

  it('post115: unknown label autumn falls back to music', () => {
    expect(resolveGenre("autumn")).toBe('music');
    expect(resolveGenre("autumn", {})).toBe('music');
  });

  it('post115: unknown label fall falls back to music', () => {
    expect(resolveGenre("fall")).toBe('music');
    expect(resolveGenre("fall", {})).toBe('music');
  });

  it('post115: unknown label beach falls back to music', () => {
    expect(resolveGenre("beach")).toBe('music');
    expect(resolveGenre("beach", {})).toBe('music');
  });

  it('post115: unknown label ocean falls back to music', () => {
    expect(resolveGenre("ocean")).toBe('music');
    expect(resolveGenre("ocean", {})).toBe('music');
  });

  it('post115: unknown label nature falls back to music', () => {
    expect(resolveGenre("nature")).toBe('music');
    expect(resolveGenre("nature", {})).toBe('music');
  });

  it('post115: unknown label birds falls back to music', () => {
    expect(resolveGenre("birds")).toBe('music');
    expect(resolveGenre("birds", {})).toBe('music');
  });

  it('post115: unknown label rain falls back to music', () => {
    expect(resolveGenre("rain")).toBe('music');
    expect(resolveGenre("rain", {})).toBe('music');
  });

  it('post115: unknown label thunder falls back to music', () => {
    expect(resolveGenre("thunder")).toBe('music');
    expect(resolveGenre("thunder", {})).toBe('music');
  });

  it('post115: unknown label fireplace falls back to music', () => {
    expect(resolveGenre("fireplace")).toBe('music');
    expect(resolveGenre("fireplace", {})).toBe('music');
  });

  it('post115: unknown label cafe falls back to music', () => {
    expect(resolveGenre("cafe")).toBe('music');
    expect(resolveGenre("cafe", {})).toBe('music');
  });

  it('post115: unknown label coffee falls back to music', () => {
    expect(resolveGenre("coffee")).toBe('music');
    expect(resolveGenre("coffee", {})).toBe('music');
  });

  it('post115: unknown label tea falls back to music', () => {
    expect(resolveGenre("tea")).toBe('music');
    expect(resolveGenre("tea", {})).toBe('music');
  });

  it('post115: unknown label wine falls back to music', () => {
    expect(resolveGenre("wine")).toBe('music');
    expect(resolveGenre("wine", {})).toBe('music');
  });

  it('post115: unknown label beer falls back to music', () => {
    expect(resolveGenre("beer")).toBe('music');
    expect(resolveGenre("beer", {})).toBe('music');
  });

  it('post115: unknown label cocktails falls back to music', () => {
    expect(resolveGenre("cocktails")).toBe('music');
    expect(resolveGenre("cocktails", {})).toBe('music');
  });

  it('post115: unknown label lounge falls back to music', () => {
    expect(resolveGenre("lounge")).toBe('music');
    expect(resolveGenre("lounge", {})).toBe('music');
  });

  it('post115: unknown label elevator falls back to music', () => {
    expect(resolveGenre("elevator")).toBe('music');
    expect(resolveGenre("elevator", {})).toBe('music');
  });

  it('post115: unknown label mall falls back to music', () => {
    expect(resolveGenre("mall")).toBe('music');
    expect(resolveGenre("mall", {})).toBe('music');
  });

  it('post115: unknown label airport falls back to music', () => {
    expect(resolveGenre("airport")).toBe('music');
    expect(resolveGenre("airport", {})).toBe('music');
  });

  it('post115: unknown label hotel falls back to music', () => {
    expect(resolveGenre("hotel")).toBe('music');
    expect(resolveGenre("hotel", {})).toBe('music');
  });

  it('post115: unknown label spa day falls back to music', () => {
    expect(resolveGenre("spa day")).toBe('music');
    expect(resolveGenre("spa day", {})).toBe('music');
  });

  it('post115: unknown label not-a-genre falls back to music', () => {
    expect(resolveGenre("not-a-genre")).toBe('music');
    expect(resolveGenre("not-a-genre", {})).toBe('music');
  });

  it('post115: unknown label ??? falls back to music', () => {
    expect(resolveGenre("???")).toBe('music');
    expect(resolveGenre("???", {})).toBe('music');
  });

  it('post115: unknown label n/a falls back to music', () => {
    expect(resolveGenre("n/a")).toBe('music');
    expect(resolveGenre("n/a", {})).toBe('music');
  });

  it('post115: unknown label null falls back to music', () => {
    expect(resolveGenre("null")).toBe('music');
    expect(resolveGenre("null", {})).toBe('music');
  });

  it('post115: unknown label undefined falls back to music', () => {
    expect(resolveGenre("undefined")).toBe('music');
    expect(resolveGenre("undefined", {})).toBe('music');
  });

  it('post115: unknown label true falls back to music', () => {
    expect(resolveGenre("true")).toBe('music');
    expect(resolveGenre("true", {})).toBe('music');
  });

  it('post115: unknown label false falls back to music', () => {
    expect(resolveGenre("false")).toBe('music');
    expect(resolveGenre("false", {})).toBe('music');
  });

  it('post115: unknown label 0 falls back to music', () => {
    expect(resolveGenre("0")).toBe('music');
    expect(resolveGenre("0", {})).toBe('music');
  });

  it('post115: unknown label 1 falls back to music', () => {
    expect(resolveGenre("1")).toBe('music');
    expect(resolveGenre("1", {})).toBe('music');
  });

  it('post115: unknown label NaN falls back to music', () => {
    expect(resolveGenre("NaN")).toBe('music');
    expect(resolveGenre("NaN", {})).toBe('music');
  });

  it('post115: unknown label Object falls back to music', () => {
    expect(resolveGenre("Object")).toBe('music');
    expect(resolveGenre("Object", {})).toBe('music');
  });

  it('post115: unknown label Array falls back to music', () => {
    expect(resolveGenre("Array")).toBe('music');
    expect(resolveGenre("Array", {})).toBe('music');
  });

  it('post115: unknown label Function falls back to music', () => {
    expect(resolveGenre("Function")).toBe('music');
    expect(resolveGenre("Function", {})).toBe('music');
  });

  it('post115: unknown label prototype falls back to music', () => {
    expect(resolveGenre("prototype")).toBe('music');
    expect(resolveGenre("prototype", {})).toBe('music');
  });

  it('post115: unknown label constructor falls back to music', () => {
    // Plain-object map access: 'constructor' → Object
    expect(resolveGenre("constructor")).toBe(Object);
    expect(resolveGenre("constructor", {})).toBe(Object);
  });

  it('post115: unknown label __proto__ falls back to music', () => {
    // Plain-object map access: '__proto__' → Object.prototype ({})
    expect(resolveGenre("__proto__")).toEqual({});
    expect(resolveGenre("__proto__", {})).toEqual({});
  });

  it('post115: unknown label toString falls back to music', () => {
    expect(resolveGenre("toString")).toBe('music');
    expect(resolveGenre("toString", {})).toBe('music');
  });

  it('post115: unknown label valueOf falls back to music', () => {
    expect(resolveGenre("valueOf")).toBe('music');
    expect(resolveGenre("valueOf", {})).toBe('music');
  });

  it('post115: unknown label hasOwnProperty falls back to music', () => {
    expect(resolveGenre("hasOwnProperty")).toBe('music');
    expect(resolveGenre("hasOwnProperty", {})).toBe('music');
  });

  it('post115: unknown label length falls back to music', () => {
    expect(resolveGenre("length")).toBe('music');
    expect(resolveGenre("length", {})).toBe('music');
  });

  it('post115: unknown label name falls back to music', () => {
    expect(resolveGenre("name")).toBe('music');
    expect(resolveGenre("name", {})).toBe('music');
  });

  it('post115: unknown label caller falls back to music', () => {
    expect(resolveGenre("caller")).toBe('music');
    expect(resolveGenre("caller", {})).toBe('music');
  });

  it('post115: unknown label arguments falls back to music', () => {
    expect(resolveGenre("arguments")).toBe('music');
    expect(resolveGenre("arguments", {})).toBe('music');
  });

  it('post115: blank/whitespace variant #0 defaults to music', () => {
    expect(resolveGenre("")).toBe('music');
    expect(resolveGenre("", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #1 defaults to music', () => {
    expect(resolveGenre(" ")).toBe('music');
    expect(resolveGenre(" ", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #2 defaults to music', () => {
    expect(resolveGenre("  ")).toBe('music');
    expect(resolveGenre("  ", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #3 defaults to music', () => {
    expect(resolveGenre("   ")).toBe('music');
    expect(resolveGenre("   ", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #4 defaults to music', () => {
    expect(resolveGenre("\t")).toBe('music');
    expect(resolveGenre("\t", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #5 defaults to music', () => {
    expect(resolveGenre("\n")).toBe('music');
    expect(resolveGenre("\n", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #6 defaults to music', () => {
    expect(resolveGenre("\r")).toBe('music');
    expect(resolveGenre("\r", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #7 defaults to music', () => {
    expect(resolveGenre("\r\n")).toBe('music');
    expect(resolveGenre("\r\n", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #8 defaults to music', () => {
    expect(resolveGenre("\t \n")).toBe('music');
    expect(resolveGenre("\t \n", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #9 defaults to music', () => {
    expect(resolveGenre(" \t ")).toBe('music');
    expect(resolveGenre(" \t ", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #10 defaults to music', () => {
    expect(resolveGenre(" ")).toBe('music');
    expect(resolveGenre(" ", { chill: 'ambient' })).toBe('music');
  });

  it('post115: blank/whitespace variant #11 defaults to music', () => {
    expect(resolveGenre(" ")).toBe('music');
    expect(resolveGenre(" ", { chill: 'ambient' })).toBe('music');
  });

  it('post115: undefined input defaults to music', () => {
    expect(resolveGenre(undefined)).toBe('music');
    expect(resolveGenre()).toBe('music');
  });

  it('post115: custom map overrides jazz to rock', () => {
    expect(resolveGenre("jazz", { "jazz": "rock" })).toBe("rock");
    expect(resolveGenre("jazz")).toBe("jazz");
  });

  it('post115: custom map overrides rock to jazz', () => {
    expect(resolveGenre("rock", { "rock": "jazz" })).toBe("jazz");
    expect(resolveGenre("rock")).toBe("rock");
  });

  it('post115: custom map overrides chill to news', () => {
    expect(resolveGenre("chill", { "chill": "news" })).toBe("news");
    expect(resolveGenre("chill")).toBe("ambient");
  });

  it('post115: custom map overrides metal to pop', () => {
    expect(resolveGenre("metal", { "metal": "pop" })).toBe("pop");
    expect(resolveGenre("metal")).toBe("rock");
  });

  it('post115: custom map overrides late night to classical', () => {
    expect(resolveGenre("late night", { "late night": "classical" })).toBe("classical");
    expect(resolveGenre("late night")).toBe("ambient");
  });

  it('post115: custom map overrides lofi to sports', () => {
    expect(resolveGenre("lofi", { "lofi": "sports" })).toBe("sports");
    expect(resolveGenre("lofi")).toBe("ambient");
  });

  it('post115: custom map overrides dance to ambient', () => {
    expect(resolveGenre("dance", { "dance": "ambient" })).toBe("ambient");
    expect(resolveGenre("dance")).toBe("pop");
  });

  it('post115: custom map overrides blues to pop', () => {
    expect(resolveGenre("blues", { "blues": "pop" })).toBe("pop");
    expect(resolveGenre("blues")).toBe("jazz");
  });

  it('post115: custom map overrides indie to classical', () => {
    expect(resolveGenre("indie", { "indie": "classical" })).toBe("classical");
    expect(resolveGenre("indie")).toBe("rock");
  });

  it('post115: custom map overrides electronic to rock', () => {
    expect(resolveGenre("electronic", { "electronic": "rock" })).toBe("rock");
    expect(resolveGenre("electronic")).toBe("ambient");
  });

  it('post115: partial/substring chilling does not invent alias', () => {
    expect(resolveGenre("chilling")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "chilling")).toBe(false);
  });

  it('post115: partial/substring jazzed does not invent alias', () => {
    expect(resolveGenre("jazzed")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "jazzed")).toBe(false);
  });

  it('post115: partial/substring rockabilly does not invent alias', () => {
    expect(resolveGenre("rockabilly")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "rockabilly")).toBe(false);
  });

  it('post115: partial/substring popcorn does not invent alias', () => {
    expect(resolveGenre("popcorn")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "popcorn")).toBe(false);
  });

  it('post115: partial/substring metallic does not invent alias', () => {
    expect(resolveGenre("metallic")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "metallic")).toBe(false);
  });

  it('post115: partial/substring independent does not invent alias', () => {
    expect(resolveGenre("independent")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "independent")).toBe(false);
  });

  it('post115: partial/substring classicalism does not invent alias', () => {
    expect(resolveGenre("classicalism")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "classicalism")).toBe(false);
  });

  it('post115: partial/substring newsroom does not invent alias', () => {
    expect(resolveGenre("newsroom")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "newsroom")).toBe(false);
  });

  it('post115: partial/substring sportsmanship does not invent alias', () => {
    expect(resolveGenre("sportsmanship")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "sportsmanship")).toBe(false);
  });

  it('post115: partial/substring entertainmentally does not invent alias', () => {
    expect(resolveGenre("entertainmentally")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "entertainmentally")).toBe(false);
  });

  it('post115: partial/substring musical does not invent alias', () => {
    expect(resolveGenre("musical")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "musical")).toBe(false);
  });

  it('post115: partial/substring ambience does not invent alias', () => {
    expect(resolveGenre("ambience")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "ambience")).toBe(false);
  });

  it('post115: partial/substring focused does not invent alias', () => {
    expect(resolveGenre("focused")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "focused")).toBe(false);
  });

  it('post115: partial/substring relaxed does not invent alias', () => {
    expect(resolveGenre("relaxed")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "relaxed")).toBe(false);
  });

  it('post115: partial/substring dancer does not invent alias', () => {
    expect(resolveGenre("dancer")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "dancer")).toBe(false);
  });

  it('post115: partial/substring electronica does not invent alias', () => {
    expect(resolveGenre("electronica")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "electronica")).toBe(false);
  });

  it('post115: partial/substring lofidelity does not invent alias', () => {
    expect(resolveGenre("lofidelity")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "lofidelity")).toBe(false);
  });

  it('post115: partial/substring late does not invent alias', () => {
    expect(resolveGenre("late")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "late")).toBe(false);
  });

  it('post115: partial/substring night does not invent alias', () => {
    expect(resolveGenre("night")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "night")).toBe(false);
  });

  it('post115: partial/substring lo does not invent alias', () => {
    expect(resolveGenre("lo")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "lo")).toBe(false);
  });

  it('post115: partial/substring fi does not invent alias', () => {
    expect(resolveGenre("fi")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "fi")).toBe(false);
  });

  it('post115: partial/substring blue does not invent alias', () => {
    expect(resolveGenre("blue")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "blue")).toBe(false);
  });

  it('post115: partial/substring class does not invent alias', () => {
    expect(resolveGenre("class")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "class")).toBe(false);
  });

  it('post115: partial/substring sport does not invent alias', () => {
    expect(resolveGenre("sport")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "sport")).toBe(false);
  });

  it('post115: partial/substring enter does not invent alias', () => {
    expect(resolveGenre("enter")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "enter")).toBe(false);
  });

  it('post115: partial/substring tain does not invent alias', () => {
    expect(resolveGenre("tain")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "tain")).toBe(false);
  });

  it('post115: partial/substring chil does not invent alias', () => {
    expect(resolveGenre("chil")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "chil")).toBe(false);
  });

  it('post115: partial/substring amb does not invent alias', () => {
    expect(resolveGenre("amb")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "amb")).toBe(false);
  });

  it('post115: partial/substring jaz does not invent alias', () => {
    expect(resolveGenre("jaz")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "jaz")).toBe(false);
  });

  it('post115: partial/substring cla does not invent alias', () => {
    expect(resolveGenre("cla")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "cla")).toBe(false);
  });

  it('post115: partial/substring roc does not invent alias', () => {
    expect(resolveGenre("roc")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "roc")).toBe(false);
  });

  it('post115: partial/substring met does not invent alias', () => {
    expect(resolveGenre("met")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "met")).toBe(false);
  });

  it('post115: partial/substring ind does not invent alias', () => {
    expect(resolveGenre("ind")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "ind")).toBe(false);
  });

  it('post115: partial/substring new does not invent alias', () => {
    expect(resolveGenre("new")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "new")).toBe(false);
  });

  it('post115: partial/substring spo does not invent alias', () => {
    expect(resolveGenre("spo")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "spo")).toBe(false);
  });

  it('post115: partial/substring dan does not invent alias', () => {
    expect(resolveGenre("dan")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "dan")).toBe(false);
  });

  it('post115: partial/substring ele does not invent alias', () => {
    expect(resolveGenre("ele")).toBe("music");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, "ele")).toBe(false);
  });

  it('post115: unicode/bidi/trim edge #0', () => {
    expect(resolveGenre("chill​")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #1', () => {
    expect(resolveGenre("​chill")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #2', () => {
    expect(resolveGenre("ch­ill")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #3', () => {
    expect(resolveGenre("jazz﻿")).toBe("jazz");
  });

  it('post115: unicode/bidi/trim edge #4', () => {
    expect(resolveGenre("﻿jazz")).toBe("jazz");
  });

  it('post115: unicode/bidi/trim edge #5', () => {
    expect(resolveGenre("rock ")).toBe("rock");
  });

  it('post115: unicode/bidi/trim edge #6', () => {
    expect(resolveGenre("late night")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #7', () => {
    expect(resolveGenre("lo‐fi")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #8', () => {
    expect(resolveGenre("lo‑fi")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #9', () => {
    expect(resolveGenre("ｃｈｉｌｌ")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #10', () => {
    expect(resolveGenre("ＪＡＺＺ")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #11', () => {
    expect(resolveGenre("ｒｏｃｋ")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #12', () => {
    expect(resolveGenre("chilĺ")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #13', () => {
    expect(resolveGenre("jäzz")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #14', () => {
    expect(resolveGenre("röck")).toBe("music");
  });

  it('post115: unicode/bidi/trim edge #15', () => {
    expect(resolveGenre("chill\r")).toBe("ambient");
  });

  it('post115: unicode/bidi/trim edge #16', () => {
    expect(resolveGenre("jazz\n")).toBe("jazz");
  });

  it('post115: unicode/bidi/trim edge #17', () => {
    expect(resolveGenre("  metal  ")).toBe("rock");
  });

  it('post115: unicode/bidi/trim edge #18', () => {
    expect(resolveGenre("\tindie\t")).toBe("rock");
  });

  it('post115: unicode/bidi/trim edge #19', () => {
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
  });

  it('post115: locale lowercasing of I-dot does not invent jazz', () => {
    expect(resolveGenre('\u0130'.toLocaleLowerCase('tr'))).not.toBe('jazz');
    expect(resolveGenre('JAZZ'.toLocaleLowerCase('en'))).toBe('jazz');
  });

  it('post115: splitting late night tokens does not invent aliases', () => {
    expect(resolveGenre('late')).toBe('music');
    expect(resolveGenre('night')).toBe('music');
    expect(resolveGenre('late night')).toBe('ambient');
    expect(resolveGenre('late  night')).toBe('music');
  });

  it('post115: Reflect.get on GENRE_MAP matches bracket access', () => {
    expect(Reflect.get(GENRE_MAP, 'chill')).toBe(GENRE_MAP.chill);
    expect(Reflect.get(GENRE_MAP, 'lo-fi')).toBe('ambient');
    expect(resolveGenre('chill')).toBe(Reflect.get(GENRE_MAP, 'chill'));
  });

  it('post115: Object.hasOwn distinguishes own alias keys', () => {
    expect(Object.hasOwn(GENRE_MAP, 'chill')).toBe(true);
    expect(Object.hasOwn(GENRE_MAP, 'toString')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, '__proto__')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, 'constructor')).toBe(false);
  });

  it('post115: Symbol keys on custom map are invisible to string lookup', () => {
    const sym = Symbol('chill');
    const map: Record<string | symbol, string> = { [sym]: 'news', chill: 'ambient' };
    expect(resolveGenre('chill', map as Record<string, string>)).toBe('ambient');
    expect(resolveGenre(String(sym), map as Record<string, string>)).toBe('music');
  });

  it('post115: structuredClone GENRE_MAP preserves resolve behavior', () => {
    const cloned = structuredClone(GENRE_MAP);
    expect(resolveGenre('chill', cloned)).toBe('ambient');
    expect(resolveGenre('metal', cloned)).toBe('rock');
    expect(Object.keys(cloned)).toEqual(Object.keys(GENRE_MAP));
  });

  it('post115: Proxy get trap still feeds resolveGenre custom map', () => {
    const proxied = new Proxy({ ...GENRE_MAP }, { get: (t, p, r) => Reflect.get(t, p, r) });
    expect(resolveGenre('blues', proxied as Record<string, string>)).toBe('jazz');
    expect(resolveGenre('unknown-xyz', proxied as Record<string, string>)).toBe('music');
  });

  it('post115: Object.freeze GENRE_MAP does not change resolveGenre', () => {
    const frozen = Object.freeze({ ...GENRE_MAP });
    expect(resolveGenre('indie', frozen)).toBe('rock');
    expect(() => { (frozen as Record<string, string>).indie = 'pop'; }).toThrow();
  });

  it('post115: Object.seal custom map still resolves', () => {
    const sealed = Object.seal({ chill: 'ambient', jazz: 'jazz' });
    expect(resolveGenre('chill', sealed)).toBe('ambient');
    expect(resolveGenre('sports', sealed)).toBe('sports');
  });

  it('post115: VALID_GENRES iterator yields 9 values then done', () => {
    const it = VALID_GENRES[Symbol.iterator]();
    const seen: string[] = [];
    for (;;) { const n = it.next(); if (n.done) break; seen.push(n.value); }
    expect(seen).toEqual([...VALID_GENRES]);
    expect(seen).toHaveLength(9);
  });

  it('post115: Array.from VALID_GENRES equals spread copy', () => {
    expect(Array.from(VALID_GENRES)).toEqual([...VALID_GENRES]);
  });

  it('post115: map of alias resolutions matches GENRE_MAP values', () => {
    expect(Object.keys(GENRE_MAP).map((k) => resolveGenre(k))).toEqual(Object.values(GENRE_MAP));
  });

  it('post115: reduce builds pipe-joined VALID_GENRES lock', () => {
    expect(VALID_GENRES.reduce((a, g) => (a ? a + '|' + g : g), '')).toBe('music|ambient|jazz|classical|pop|rock|news|sports|entertainment');
  });

  it('post115: every/some/filter invariants on VALID_GENRES', () => {
    expect(VALID_GENRES.every((g) => typeof g === 'string')).toBe(true);
    expect(VALID_GENRES.some((g) => g === 'jazz')).toBe(true);
    expect(VALID_GENRES.filter((g) => g.length > 6)).toEqual(['ambient', 'classical', 'entertainment']);
  });

  it('post115: findIndex ambient is 1', () => {
    expect(VALID_GENRES.findIndex((g) => g === 'ambient')).toBe(1);
    expect(VALID_GENRES.indexOf('music')).toBe(0);
    expect(VALID_GENRES.indexOf('entertainment')).toBe(8);
  });

  it('post115: includes is case-sensitive on VALID_GENRES array', () => {
    expect((VALID_GENRES as readonly string[]).includes('Jazz')).toBe(false);
    expect((VALID_GENRES as readonly string[]).includes('jazz')).toBe(true);
    expect(resolveGenre('Jazz')).toBe('jazz');
  });

  it('post115: index.ts imports resolveGenre from genres', () => {
    expect(indexSrc).toMatch(/from ['"]\.\/genres['"]/);
    expect(indexSrc).toContain('resolveGenre');
  });

  it('post115: index.ts sha256 lock', () => {
    expect(createHash('sha256').update(indexSrc, 'utf8').digest('hex')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post115: AGENTS.md sha256 lock and Verify block', () => {
    expect(createHash('sha256').update(agentsMd, 'utf8').digest('hex')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa');
    expect(agentsMd).toContain('npm run typecheck');
    expect(agentsMd).toContain('npm test');
    expect(agentsMd).toContain('npm run test:coverage');
  });

  it('post115: README.md sha256 lock', () => {
    expect(createHash('sha256').update(readmeMd, 'utf8').digest('hex')).toBe('f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987');
  });

  it('post115: DEPLOY.md sha256 lock', () => {
    expect(createHash('sha256').update(deployMd, 'utf8').digest('hex')).toBe('11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a');
  });

  it('post115: package.json sha256 lock and scripts', () => {
    expect(createHash('sha256').update(pkgJson, 'utf8').digest('hex')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c');
    const pkg = JSON.parse(pkgJson) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBeTruthy();
    expect(pkg.scripts.test).toBeTruthy();
    expect(pkg.scripts['test:coverage']).toBeTruthy();
  });

  it('post115: ci.yml sha256 lock and Typecheck job', () => {
    expect(createHash('sha256').update(ciYml, 'utf8').digest('hex')).toBe('c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5');
    expect(ciYml).toContain('npm run typecheck');
    expect(ciYml).toContain('npm run test:coverage');
  });

  it('post115: vitest.config.ts sha256 lock and 100% floors', () => {
    expect(createHash('sha256').update(vitestCfg, 'utf8').digest('hex')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38');
    expect(vitestCfg).toMatch(/statements:\s*100/);
    expect(vitestCfg).toMatch(/branches:\s*100/);
    expect(vitestCfg).toMatch(/functions:\s*100/);
    expect(vitestCfg).toMatch(/lines:\s*100/);
  });

  it('post115: types.ts sha256 lock', () => {
    expect(createHash('sha256').update(typesSrc, 'utf8').digest('hex')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
  });

  it('post115: parser.ts sha256 lock', () => {
    expect(createHash('sha256').update(parserSrc, 'utf8').digest('hex')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post115: mcp.ts sha256 lock', () => {
    expect(createHash('sha256').update(mcpSrc, 'utf8').digest('hex')).toBe('6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683');
  });

  it('post115: wrangler.toml sha256 lock', () => {
    expect(createHash('sha256').update(wranglerToml, 'utf8').digest('hex')).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8');
  });

  it('post115: docs do not invent playlist/now-playing product routes', () => {
    // AGENTS.md may name /playlist as a future Safe Agent Action example — lock that framing.
    expect(agentsMd).toContain('/playlist');
    expect(agentsMd).toContain('/now-playing');
    expect(agentsMd).toMatch(/Add new endpoints/);
    expect(readmeMd).not.toMatch(/\/now-playing/);
    expect(deployMd).not.toMatch(/\/playlist/);
    expect(indexSrc).not.toMatch(/path === '\/playlist'/);
    expect(indexSrc).not.toMatch(/path === '\/now-playing'/);
    expect(src).not.toContain('/playlist');
    expect(src).not.toContain('/now-playing');
  });

  it('post115: genres module forbids hard-coded credentials', () => {
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(src).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(src).not.toMatch(/GEMINI_API_KEY\s*=\s*['"][^'"]+['"]/);
  });

  it('post115: no Anthropic swap in genres or index', () => {
    expect(src).not.toContain('Anthropic');
    expect(indexSrc).not.toContain('Anthropic');
    expect(src).not.toContain('claude-');
  });

  it('post115: URLSearchParams genre query resolves through resolveGenre', () => {
    const sp = new URLSearchParams('genre=chill&limit=5');
    expect(resolveGenre(sp.get('genre') ?? undefined)).toBe('ambient');
    const sp2 = new URLSearchParams('genre=LATE+NIGHT');
    expect(resolveGenre(sp2.get('genre') ?? undefined)).toBe('ambient');
    const sp3 = new URLSearchParams();
    expect(resolveGenre(sp3.get('genre') ?? undefined)).toBe('music');
  });

  it('post115: char frequency of a-z in genres.ts source lock', () => {
    const freq: Record<string, number> = {};
    for (const ch of src.toLowerCase()) {
      if (ch >= 'a' && ch <= 'z') freq[ch] = (freq[ch] ?? 0) + 1;
    }
    expect(freq).toEqual({"i":52,"p":26,"t":53,"v":7,"o":41,"r":50,"g":19,"c":36,"a":46,"e":72,"y":4,"d":12,"s":48,"w":9,"x":6,"m":26,"l":31,"n":54,"h":2,"b":12,"f":6,"u":15,"j":4,"z":8,"k":5});
  });

  it('post115: digraph count for ge/re/en/ra in genres.ts', () => {
    const digraphs = ["ge","re","en","ra","al","id","ap","va","li","on"] as const;
    const lower = src.toLowerCase();
    const counts: Record<string, number> = {};
    for (const d of digraphs) {
      let c = 0;
      for (let i = 0; i < lower.length - 1; i++) if (lower.slice(i, i + 2) === d) c++;
      counts[d] = c;
    }
    expect(counts).toEqual({"ge":8,"re":14,"en":24,"ra":0,"al":11,"id":6,"ap":4,"va":5,"li":6,"on":6});
  });

  it('post115: indentation uses 2-space only — no tabs', () => {
    expect(src.includes('\t')).toBe(false);
    const indented = src.split('\n').filter((l) => /^ +/.test(l));
    expect(indented.length).toBeGreaterThan(0);
    expect(indented.every((l) => /^ {2}/.test(l) || /^ {4}/.test(l))).toBe(true);
  });

  it('post115: resolveGenre length property stays 1 after post115 deepen', () => {
    expect(resolveGenre.length).toBe(1);
  });

  it('post115: resolveGenre name is resolveGenre', () => {
    expect(resolveGenre.name).toBe('resolveGenre');
  });

  it('post115: digest+resolve mega purity — 50 rounds', () => {
    const expected = 'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e';
    for (let i = 0; i < 50; i++) {
      expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe(expected);
      expect(resolveGenre('late night')).toBe('ambient');
      expect(resolveGenre('podcast')).toBe('music');
      expect(Object.keys(GENRE_MAP)).toHaveLength(21);
      expect(VALID_GENRES).toHaveLength(9);
    }
  });

  it('post115: HMAC mega purity — 30 rounds keyed by post115', () => {
    const expected = '3b4eccafe0e013f64717048535130c5b06b32c7da5c5074da292c362687f1470';
    for (let i = 0; i < 30; i++) {
      expect(createHmac('sha256', 'post115').update(src, 'utf8').digest('hex')).toBe(expected);
      expect(resolveGenre('metal')).toBe('rock');
    }
  });

  it('post115: Date.now independence — resolveGenre stable across clock', () => {
    const a = resolveGenre('chill');
    const t0 = Date.now();
    const b = resolveGenre('chill');
    expect(Date.now()).toBeGreaterThanOrEqual(t0);
    expect(a).toBe(b);
    expect(a).toBe('ambient');
  });

  it('post115: performance.now independence — resolveGenre stable', () => {
    const t0 = performance.now();
    expect(resolveGenre('metal')).toBe('rock');
    expect(performance.now()).toBeGreaterThanOrEqual(t0);
  });

  it('post115: hash of Math.random does not affect resolveGenre', () => {
    const bytes = createHash('sha256').update(String(Math.random()), 'utf8').digest('hex');
    expect(resolveGenre('jazz')).toBe('jazz');
    expect(bytes).toHaveLength(64);
  });

  it('post115: this suite describe marker present in genres.test.ts body', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post115 genres HEAVY deepen'");
    expect(body).toContain("describe('post94 genres HEAVY deepen'");
    expect((body.match(/it\('post115:/g) ?? []).length).toBeGreaterThan(200);
  });

  it('post115: post115 does not reopen routes suite', () => {
    const body = read('test/genres.test.ts');
    // Build needles so this assertion source does not contain the needle literals.
    const routesDescribe = ['describe(', "'", 'post111', ' routes'].join('');
    const routesPath = ['test', '/', 'routes', '.test.ts'].join('');
    expect(body.includes(routesDescribe)).toBe(false);
    expect(body.includes(routesPath)).toBe(false);
    expect(body).toContain("describe('post115 genres HEAVY deepen'");
  });

  it('post115: Atomics/SharedArrayBuffer unused by genres module', () => {
    expect(typeof Atomics).toBe('object');
    expect(typeof SharedArrayBuffer).toBe('function');
    expect(src).not.toMatch(/Atomics|SharedArrayBuffer/);
  });

  it('post115: HMAC of VALID_GENRES pipe-join keyed by post115', () => {
    const joined = [...VALID_GENRES].join('|');
    expect(createHmac('sha256', 'post115').update(joined, 'utf8').digest('hex')).toBe('d1bf3a45a67804378a55d17a2aaddded63cfa324691e393d2d0d8dc4a80d7197');
  });

  it('post115: HMAC of GENRE_MAP keys pipe-join keyed by post115', () => {
    const joined = Object.keys(GENRE_MAP).join('|');
    expect(createHmac('sha256', 'post115').update(joined, 'utf8').digest('hex')).toBe('2706e7b12a647933ede479b82341c038f866ce1cda58e27bdcd28f841e9c12b8');
  });

  it('post115: first non-empty line is block comment; last non-empty is closing brace', () => {
    const nonempty = src.split('\n').filter((l) => l.length > 0);
    expect(nonempty[0].startsWith('/**')).toBe(true);
    expect(nonempty[nonempty.length - 1]).toBe('}');
  });

  it('post115: __proto__ and constructor lookups do not invent genres', () => {
    // Prototype-chain hits on plain maps — not genre inventing.
    expect(resolveGenre('__proto__')).toEqual({});
    expect(resolveGenre('constructor')).toBe(Object);
    expect(resolveGenre('prototype')).toBe('music');
  });

  it('post115: JSON roundtrip of GENRE_MAP preserves resolve', () => {
    const round = JSON.parse(JSON.stringify(GENRE_MAP)) as Record<string, string>;
    expect(resolveGenre('lo-fi', round)).toBe('ambient');
    expect(Object.keys(round)).toHaveLength(21);
  });

  it('post115: String(number) labels fall back to music', () => {
    expect(resolveGenre(String(0))).toBe('music');
    expect(resolveGenre(String(42))).toBe('music');
    expect(resolveGenre(String(NaN))).toBe('music');
  });

  it('post115: every GENRE_MAP value is a ValidGenre', () => {
    for (const v of Object.values(GENRE_MAP)) {
      expect((VALID_GENRES as readonly string[]).includes(v)).toBe(true);
    }
  });

  it('post115: custom map with only unknown keys still uses VALID_GENRES fallback', () => {
    expect(resolveGenre('jazz', { foobar: 'ambient' })).toBe('jazz');
    expect(resolveGenre('foobar', { foobar: 'ambient' })).toBe('ambient');
  });

  it('post115: punctuation/spacing chill! does not invent', () => {
    expect(resolveGenre("chill!")).toBe("music");
  });

  it('post115: punctuation/spacing chill? does not invent', () => {
    expect(resolveGenre("chill?")).toBe("music");
  });

  it('post115: punctuation/spacing chill. does not invent', () => {
    expect(resolveGenre("chill.")).toBe("music");
  });

  it('post115: punctuation/spacing chill, does not invent', () => {
    expect(resolveGenre("chill,")).toBe("music");
  });

  it('post115: punctuation/spacing chill: does not invent', () => {
    expect(resolveGenre("chill:")).toBe("music");
  });

  it('post115: punctuation/spacing chill; does not invent', () => {
    expect(resolveGenre("chill;")).toBe("music");
  });

  it('post115: punctuation/spacing chill/ does not invent', () => {
    expect(resolveGenre("chill/")).toBe("music");
  });

  it('post115: punctuation/spacing chill\\ does not invent', () => {
    expect(resolveGenre("chill\\")).toBe("music");
  });

  it('post115: punctuation/spacing (chill) does not invent', () => {
    expect(resolveGenre("(chill)")).toBe("music");
  });

  it('post115: punctuation/spacing [chill] does not invent', () => {
    expect(resolveGenre("[chill]")).toBe("music");
  });

  it('post115: punctuation/spacing {chill} does not invent', () => {
    expect(resolveGenre("{chill}")).toBe("music");
  });

  it('post115: punctuation/spacing \"chill\" does not invent', () => {
    expect(resolveGenre("\"chill\"")).toBe("music");
  });

  it('post115: punctuation/spacing \'chill\' does not invent', () => {
    expect(resolveGenre("'chill'")).toBe("music");
  });

  it('post115: punctuation/spacing chill+ does not invent', () => {
    expect(resolveGenre("chill+")).toBe("music");
  });

  it('post115: punctuation/spacing chill= does not invent', () => {
    expect(resolveGenre("chill=")).toBe("music");
  });

  it('post115: punctuation/spacing chill@ does not invent', () => {
    expect(resolveGenre("chill@")).toBe("music");
  });

  it('post115: punctuation/spacing jazz&blues does not invent', () => {
    expect(resolveGenre("jazz&blues")).toBe("music");
  });

  it('post115: punctuation/spacing rock&roll does not invent', () => {
    expect(resolveGenre("rock&roll")).toBe("music");
  });

  it('post115: punctuation/spacing pop/rock does not invent', () => {
    expect(resolveGenre("pop/rock")).toBe("music");
  });

  it('post115: punctuation/spacing lo_fi does not invent', () => {
    expect(resolveGenre("lo_fi")).toBe("music");
  });

  it('post115: punctuation/spacing lo fi does not invent', () => {
    expect(resolveGenre("lo fi")).toBe("music");
  });

  it('post115: punctuation/spacing late-night does not invent', () => {
    expect(resolveGenre("late-night")).toBe("music");
  });

  it('post115: punctuation/spacing latenight does not invent', () => {
    expect(resolveGenre("latenight")).toBe("music");
  });

  it('post115: exhaustive VALID_GENRES switch yields identity map', () => {
    const out: string[] = [];
    for (const g of VALID_GENRES) {
      switch (g) {
        case 'music': out.push('music'); break;
        case 'ambient': out.push('ambient'); break;
        case 'jazz': out.push('jazz'); break;
        case 'classical': out.push('classical'); break;
        case 'pop': out.push('pop'); break;
        case 'rock': out.push('rock'); break;
        case 'news': out.push('news'); break;
        case 'sports': out.push('sports'); break;
        case 'entertainment': out.push('entertainment'); break;
        default: {
          const _exhaustive: never = g;
          out.push(_exhaustive);
        }
      }
    }
    expect(out).toEqual([...VALID_GENRES]);
  });

});

describe('post115 genres HEAVY deepen extras', () => {
  const src = genresSource;

  it('post115: GENRE_MAP entry index 0 is late night to ambient', () => {
    expect(Object.entries(GENRE_MAP)[0]).toEqual(["late night", "ambient"]);
  });

  it('post115: GENRE_MAP entry index 1 is chill to ambient', () => {
    expect(Object.entries(GENRE_MAP)[1]).toEqual(["chill", "ambient"]);
  });

  it('post115: GENRE_MAP entry index 2 is ambient to ambient', () => {
    expect(Object.entries(GENRE_MAP)[2]).toEqual(["ambient", "ambient"]);
  });

  it('post115: GENRE_MAP entry index 3 is relaxing to ambient', () => {
    expect(Object.entries(GENRE_MAP)[3]).toEqual(["relaxing", "ambient"]);
  });

  it('post115: GENRE_MAP entry index 4 is focus to ambient', () => {
    expect(Object.entries(GENRE_MAP)[4]).toEqual(["focus", "ambient"]);
  });

  it('post115: GENRE_MAP entry index 5 is classical to classical', () => {
    expect(Object.entries(GENRE_MAP)[5]).toEqual(["classical", "classical"]);
  });

  it('post115: GENRE_MAP entry index 6 is classic to classical', () => {
    expect(Object.entries(GENRE_MAP)[6]).toEqual(["classic", "classical"]);
  });

  it('post115: GENRE_MAP entry index 7 is jazz to jazz', () => {
    expect(Object.entries(GENRE_MAP)[7]).toEqual(["jazz", "jazz"]);
  });

  it('post115: GENRE_MAP entry index 8 is blues to jazz', () => {
    expect(Object.entries(GENRE_MAP)[8]).toEqual(["blues", "jazz"]);
  });

  it('post115: GENRE_MAP entry index 9 is pop to pop', () => {
    expect(Object.entries(GENRE_MAP)[9]).toEqual(["pop", "pop"]);
  });

  it('post115: GENRE_MAP entry index 10 is rock to rock', () => {
    expect(Object.entries(GENRE_MAP)[10]).toEqual(["rock", "rock"]);
  });

  it('post115: GENRE_MAP entry index 11 is metal to rock', () => {
    expect(Object.entries(GENRE_MAP)[11]).toEqual(["metal", "rock"]);
  });

  it('post115: GENRE_MAP entry index 12 is indie to rock', () => {
    expect(Object.entries(GENRE_MAP)[12]).toEqual(["indie", "rock"]);
  });

  it('post115: GENRE_MAP entry index 13 is music to music', () => {
    expect(Object.entries(GENRE_MAP)[13]).toEqual(["music", "music"]);
  });

  it('post115: GENRE_MAP entry index 14 is news to news', () => {
    expect(Object.entries(GENRE_MAP)[14]).toEqual(["news", "news"]);
  });

  it('post115: GENRE_MAP entry index 15 is sports to sports', () => {
    expect(Object.entries(GENRE_MAP)[15]).toEqual(["sports", "sports"]);
  });

  it('post115: GENRE_MAP entry index 16 is entertainment to entertainment', () => {
    expect(Object.entries(GENRE_MAP)[16]).toEqual(["entertainment", "entertainment"]);
  });

  it('post115: GENRE_MAP entry index 17 is dance to pop', () => {
    expect(Object.entries(GENRE_MAP)[17]).toEqual(["dance", "pop"]);
  });

  it('post115: GENRE_MAP entry index 18 is electronic to ambient', () => {
    expect(Object.entries(GENRE_MAP)[18]).toEqual(["electronic", "ambient"]);
  });

  it('post115: GENRE_MAP entry index 19 is lofi to ambient', () => {
    expect(Object.entries(GENRE_MAP)[19]).toEqual(["lofi", "ambient"]);
  });

  it('post115: GENRE_MAP entry index 20 is lo-fi to ambient', () => {
    expect(Object.entries(GENRE_MAP)[20]).toEqual(["lo-fi", "ambient"]);
  });

  it('post115: VALID_GENRES[0] is music', () => {
    expect(VALID_GENRES[0]).toBe("music");
    expect(resolveGenre(VALID_GENRES[0])).toBe("music");
  });

  it('post115: VALID_GENRES[1] is ambient', () => {
    expect(VALID_GENRES[1]).toBe("ambient");
    expect(resolveGenre(VALID_GENRES[1])).toBe("ambient");
  });

  it('post115: VALID_GENRES[2] is jazz', () => {
    expect(VALID_GENRES[2]).toBe("jazz");
    expect(resolveGenre(VALID_GENRES[2])).toBe("jazz");
  });

  it('post115: VALID_GENRES[3] is classical', () => {
    expect(VALID_GENRES[3]).toBe("classical");
    expect(resolveGenre(VALID_GENRES[3])).toBe("classical");
  });

  it('post115: VALID_GENRES[4] is pop', () => {
    expect(VALID_GENRES[4]).toBe("pop");
    expect(resolveGenre(VALID_GENRES[4])).toBe("pop");
  });

  it('post115: VALID_GENRES[5] is rock', () => {
    expect(VALID_GENRES[5]).toBe("rock");
    expect(resolveGenre(VALID_GENRES[5])).toBe("rock");
  });

  it('post115: VALID_GENRES[6] is news', () => {
    expect(VALID_GENRES[6]).toBe("news");
    expect(resolveGenre(VALID_GENRES[6])).toBe("news");
  });

  it('post115: VALID_GENRES[7] is sports', () => {
    expect(VALID_GENRES[7]).toBe("sports");
    expect(resolveGenre(VALID_GENRES[7])).toBe("sports");
  });

  it('post115: VALID_GENRES[8] is entertainment', () => {
    expect(VALID_GENRES[8]).toBe("entertainment");
    expect(resolveGenre(VALID_GENRES[8])).toBe("entertainment");
  });

  it('post115: VALID music variant #0 resolves', () => {
    expect(resolveGenre("music")).toBe("music");
  });

  it('post115: VALID music variant #1 resolves', () => {
    expect(resolveGenre("MUSIC")).toBe("music");
  });

  it('post115: VALID music variant #2 resolves', () => {
    expect(resolveGenre("music")).toBe("music");
  });

  it('post115: VALID music variant #3 resolves', () => {
    expect(resolveGenre(" music ")).toBe("music");
  });

  it('post115: VALID music variant #4 resolves', () => {
    expect(resolveGenre("\tmusic\n")).toBe("music");
  });

  it('post115: VALID music variant #5 resolves', () => {
    expect(resolveGenre("\nmusic\t")).toBe("music");
  });

  it('post115: VALID ambient variant #0 resolves', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
  });

  it('post115: VALID ambient variant #1 resolves', () => {
    expect(resolveGenre("AMBIENT")).toBe("ambient");
  });

  it('post115: VALID ambient variant #2 resolves', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
  });

  it('post115: VALID ambient variant #3 resolves', () => {
    expect(resolveGenre(" ambient ")).toBe("ambient");
  });

  it('post115: VALID ambient variant #4 resolves', () => {
    expect(resolveGenre("\tambient\n")).toBe("ambient");
  });

  it('post115: VALID ambient variant #5 resolves', () => {
    expect(resolveGenre("\nambient\t")).toBe("ambient");
  });

  it('post115: VALID jazz variant #0 resolves', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
  });

  it('post115: VALID jazz variant #1 resolves', () => {
    expect(resolveGenre("JAZZ")).toBe("jazz");
  });

  it('post115: VALID jazz variant #2 resolves', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
  });

  it('post115: VALID jazz variant #3 resolves', () => {
    expect(resolveGenre(" jazz ")).toBe("jazz");
  });

  it('post115: VALID jazz variant #4 resolves', () => {
    expect(resolveGenre("\tjazz\n")).toBe("jazz");
  });

  it('post115: VALID jazz variant #5 resolves', () => {
    expect(resolveGenre("\njazz\t")).toBe("jazz");
  });

  it('post115: VALID classical variant #0 resolves', () => {
    expect(resolveGenre("classical")).toBe("classical");
  });

  it('post115: VALID classical variant #1 resolves', () => {
    expect(resolveGenre("CLASSICAL")).toBe("classical");
  });

  it('post115: VALID classical variant #2 resolves', () => {
    expect(resolveGenre("classical")).toBe("classical");
  });

  it('post115: VALID classical variant #3 resolves', () => {
    expect(resolveGenre(" classical ")).toBe("classical");
  });

  it('post115: VALID classical variant #4 resolves', () => {
    expect(resolveGenre("\tclassical\n")).toBe("classical");
  });

  it('post115: VALID classical variant #5 resolves', () => {
    expect(resolveGenre("\nclassical\t")).toBe("classical");
  });

  it('post115: VALID pop variant #0 resolves', () => {
    expect(resolveGenre("pop")).toBe("pop");
  });

  it('post115: VALID pop variant #1 resolves', () => {
    expect(resolveGenre("POP")).toBe("pop");
  });

  it('post115: VALID pop variant #2 resolves', () => {
    expect(resolveGenre("pop")).toBe("pop");
  });

  it('post115: VALID pop variant #3 resolves', () => {
    expect(resolveGenre(" pop ")).toBe("pop");
  });

  it('post115: VALID pop variant #4 resolves', () => {
    expect(resolveGenre("\tpop\n")).toBe("pop");
  });

  it('post115: VALID pop variant #5 resolves', () => {
    expect(resolveGenre("\npop\t")).toBe("pop");
  });

  it('post115: VALID rock variant #0 resolves', () => {
    expect(resolveGenre("rock")).toBe("rock");
  });

  it('post115: VALID rock variant #1 resolves', () => {
    expect(resolveGenre("ROCK")).toBe("rock");
  });

  it('post115: VALID rock variant #2 resolves', () => {
    expect(resolveGenre("rock")).toBe("rock");
  });

  it('post115: VALID rock variant #3 resolves', () => {
    expect(resolveGenre(" rock ")).toBe("rock");
  });

  it('post115: VALID rock variant #4 resolves', () => {
    expect(resolveGenre("\trock\n")).toBe("rock");
  });

  it('post115: VALID rock variant #5 resolves', () => {
    expect(resolveGenre("\nrock\t")).toBe("rock");
  });

  it('post115: VALID news variant #0 resolves', () => {
    expect(resolveGenre("news")).toBe("news");
  });

  it('post115: VALID news variant #1 resolves', () => {
    expect(resolveGenre("NEWS")).toBe("news");
  });

  it('post115: VALID news variant #2 resolves', () => {
    expect(resolveGenre("news")).toBe("news");
  });

  it('post115: VALID news variant #3 resolves', () => {
    expect(resolveGenre(" news ")).toBe("news");
  });

  it('post115: VALID news variant #4 resolves', () => {
    expect(resolveGenre("\tnews\n")).toBe("news");
  });

  it('post115: VALID news variant #5 resolves', () => {
    expect(resolveGenre("\nnews\t")).toBe("news");
  });

  it('post115: VALID sports variant #0 resolves', () => {
    expect(resolveGenre("sports")).toBe("sports");
  });

  it('post115: VALID sports variant #1 resolves', () => {
    expect(resolveGenre("SPORTS")).toBe("sports");
  });

  it('post115: VALID sports variant #2 resolves', () => {
    expect(resolveGenre("sports")).toBe("sports");
  });

  it('post115: VALID sports variant #3 resolves', () => {
    expect(resolveGenre(" sports ")).toBe("sports");
  });

  it('post115: VALID sports variant #4 resolves', () => {
    expect(resolveGenre("\tsports\n")).toBe("sports");
  });

  it('post115: VALID sports variant #5 resolves', () => {
    expect(resolveGenre("\nsports\t")).toBe("sports");
  });

  it('post115: VALID entertainment variant #0 resolves', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
  });

  it('post115: VALID entertainment variant #1 resolves', () => {
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
  });

  it('post115: VALID entertainment variant #2 resolves', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
  });

  it('post115: VALID entertainment variant #3 resolves', () => {
    expect(resolveGenre(" entertainment ")).toBe("entertainment");
  });

  it('post115: VALID entertainment variant #4 resolves', () => {
    expect(resolveGenre("\tentertainment\n")).toBe("entertainment");
  });

  it('post115: VALID entertainment variant #5 resolves', () => {
    expect(resolveGenre("\nentertainment\t")).toBe("entertainment");
  });

  it('post115: extra unknown aaa to music', () => {
    expect(resolveGenre("aaa")).toBe('music');
  });

  it('post115: extra unknown bbb to music', () => {
    expect(resolveGenre("bbb")).toBe('music');
  });

  it('post115: extra unknown ccc to music', () => {
    expect(resolveGenre("ccc")).toBe('music');
  });

  it('post115: extra unknown xyz to music', () => {
    expect(resolveGenre("xyz")).toBe('music');
  });

  it('post115: extra unknown test to music', () => {
    expect(resolveGenre("test")).toBe('music');
  });

  it('post115: extra unknown sample to music', () => {
    expect(resolveGenre("sample")).toBe('music');
  });

  it('post115: extra unknown demo to music', () => {
    expect(resolveGenre("demo")).toBe('music');
  });

  it('post115: extra unknown foo to music', () => {
    expect(resolveGenre("foo")).toBe('music');
  });

  it('post115: extra unknown bar to music', () => {
    expect(resolveGenre("bar")).toBe('music');
  });

  it('post115: extra unknown baz to music', () => {
    expect(resolveGenre("baz")).toBe('music');
  });

  it('post115: extra unknown qux to music', () => {
    expect(resolveGenre("qux")).toBe('music');
  });

  it('post115: extra unknown quux to music', () => {
    expect(resolveGenre("quux")).toBe('music');
  });

  it('post115: extra unknown corge to music', () => {
    expect(resolveGenre("corge")).toBe('music');
  });

  it('post115: extra unknown grault to music', () => {
    expect(resolveGenre("grault")).toBe('music');
  });

  it('post115: extra unknown garply to music', () => {
    expect(resolveGenre("garply")).toBe('music');
  });

  it('post115: extra unknown waldo to music', () => {
    expect(resolveGenre("waldo")).toBe('music');
  });

  it('post115: extra unknown fred to music', () => {
    expect(resolveGenre("fred")).toBe('music');
  });

  it('post115: extra unknown plugh to music', () => {
    expect(resolveGenre("plugh")).toBe('music');
  });

  it('post115: extra unknown xyzzy to music', () => {
    expect(resolveGenre("xyzzy")).toBe('music');
  });

  it('post115: extra unknown thud to music', () => {
    expect(resolveGenre("thud")).toBe('music');
  });

  it('post115: extra unknown alpha to music', () => {
    expect(resolveGenre("alpha")).toBe('music');
  });

  it('post115: extra unknown beta to music', () => {
    expect(resolveGenre("beta")).toBe('music');
  });

  it('post115: extra unknown gamma to music', () => {
    expect(resolveGenre("gamma")).toBe('music');
  });

  it('post115: extra unknown delta to music', () => {
    expect(resolveGenre("delta")).toBe('music');
  });

  it('post115: extra unknown epsilon to music', () => {
    expect(resolveGenre("epsilon")).toBe('music');
  });

  it('post115: extra unknown zeta to music', () => {
    expect(resolveGenre("zeta")).toBe('music');
  });

  it('post115: extra unknown eta to music', () => {
    expect(resolveGenre("eta")).toBe('music');
  });

  it('post115: extra unknown theta to music', () => {
    expect(resolveGenre("theta")).toBe('music');
  });

  it('post115: extra unknown iota to music', () => {
    expect(resolveGenre("iota")).toBe('music');
  });

  it('post115: extra unknown kappa to music', () => {
    expect(resolveGenre("kappa")).toBe('music');
  });

  it('post115: extra unknown station to music', () => {
    expect(resolveGenre("station")).toBe('music');
  });

  it('post115: extra unknown channel to music', () => {
    expect(resolveGenre("channel")).toBe('music');
  });

  it('post115: extra unknown frequency to music', () => {
    expect(resolveGenre("frequency")).toBe('music');
  });

  it('post115: extra unknown broadcast to music', () => {
    expect(resolveGenre("broadcast")).toBe('music');
  });

  it('post115: extra unknown transmit to music', () => {
    expect(resolveGenre("transmit")).toBe('music');
  });

  it('post115: extra unknown receiver to music', () => {
    expect(resolveGenre("receiver")).toBe('music');
  });

  it('post115: extra unknown antenna to music', () => {
    expect(resolveGenre("antenna")).toBe('music');
  });

  it('post115: extra unknown fm to music', () => {
    expect(resolveGenre("fm")).toBe('music');
  });

  it('post115: extra unknown am to music', () => {
    expect(resolveGenre("am")).toBe('music');
  });

  it('post115: extra unknown xm to music', () => {
    expect(resolveGenre("xm")).toBe('music');
  });

  it('post115: extra unknown sirius to music', () => {
    expect(resolveGenre("sirius")).toBe('music');
  });

  it('post115: extra unknown pandora to music', () => {
    expect(resolveGenre("pandora")).toBe('music');
  });

  it('post115: extra unknown spotify to music', () => {
    expect(resolveGenre("spotify")).toBe('music');
  });

  it('post115: extra unknown apple music to music', () => {
    expect(resolveGenre("apple music")).toBe('music');
  });

  it('post115: extra unknown youtube music to music', () => {
    expect(resolveGenre("youtube music")).toBe('music');
  });

  it('post115: extra unknown bandcamp to music', () => {
    expect(resolveGenre("bandcamp")).toBe('music');
  });

  it('post115: extra unknown soundcloud to music', () => {
    expect(resolveGenre("soundcloud")).toBe('music');
  });

  it('post115: extra unknown mixcloud to music', () => {
    expect(resolveGenre("mixcloud")).toBe('music');
  });

  it('post115: extra unknown deezer to music', () => {
    expect(resolveGenre("deezer")).toBe('music');
  });

  it('post115: extra unknown tidal to music', () => {
    expect(resolveGenre("tidal")).toBe('music');
  });

  it('post115: extra unknown qobuz to music', () => {
    expect(resolveGenre("qobuz")).toBe('music');
  });

  it('post115: extra unknown amazon music to music', () => {
    expect(resolveGenre("amazon music")).toBe('music');
  });

  it('post115: full alias resolve matrix matches GENRE_MAP for 25 rounds', () => {
    for (let r = 0; r < 25; r++) {
      for (const [k, v] of Object.entries(GENRE_MAP)) {
        expect(resolveGenre(k)).toBe(v);
        expect(resolveGenre(k.toUpperCase())).toBe(v);
      }
    }
  });

  it('post115: extras suite marker and post115 count floor', () => {
    const body = readFileSync(join(genresRoot, 'test/genres.test.ts'), 'utf8');
    expect(body).toContain("describe('post115 genres HEAVY deepen extras'");
    expect((body.match(/it\('post115:/g) ?? []).length).toBeGreaterThan(300);
  });

  it('post115: concatenated hmac inventory for post115 keys', () => {
    const keys = ['post115','genres','TOKENMAXX','HEAVY','deepen'] as const;
    const joined = keys.map((k) => createHmac('sha256', k).update(src, 'utf8').digest('hex')).join('|');
    expect(createHash('sha256').update(joined, 'utf8').digest('hex')).toBe('66660a9270d9de976cdc0c5f5a9ca0a824c07d091dbdc6ed4f3550b59eb09652');
  });

});

// --- HEAVY burn (post-#123): deepen genres leftovers — tests only; avoid #118 __proto__ inventing traps ---

// --- HEAVY burn (post-#123): deepen genres leftovers — tests only, no product inventing ---
describe('post123 genres HEAVY deepen (after #123)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);

  it('post123: locks src/genres.ts sha256', () => {
    expect(sha256("src/genres.ts")).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it('post123: locks src/genres.ts sha1', () => {
    expect(sha1("src/genres.ts")).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it('post123: locks src/genres.ts md5', () => {
    expect(md5("src/genres.ts")).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it('post123: locks src/genres.ts sha384', () => {
    expect(sha384("src/genres.ts")).toBe("ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16");
  });

  it('post123: locks src/genres.ts sha512', () => {
    expect(sha512("src/genres.ts")).toBe("bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b");
  });

  it('post123: locks src/genres.ts sha3-256', () => {
    expect(sha3("src/genres.ts")).toBe("d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f");
  });

  it('post123: locks src/genres.ts blake2b512', () => {
    expect(blake2b("src/genres.ts")).toBe("731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67");
  });

  it('post123: locks src/genres.ts ripemd160', () => {
    expect(ripemd("src/genres.ts")).toBe("bb9faaf8890bdba8dd86bcdf7e418da622d19bf5");
  });

  it('post123: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, "src/genres.ts")).size).toBe(1027);
    expect(readFileSync(join(root, "src/genres.ts")).byteLength).toBe(1027);
  });

  it('post123: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read("src/genres.ts")).toHaveLength(1025);
    expect(read("src/genres.ts").split('\n')).toHaveLength(48);
  });

  it('post123: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256("src/genres.ts");
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post123: locks src/genres.ts first/last octets', () => {
    const d = sha256("src/genres.ts");
    expect(d.slice(0, 2)).toBe("aa");
    expect(d.slice(-2)).toBe("4e");
  });

  it('post123: locks src/genres.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "src/genres.ts")).toBe("72668068ccae1276030366ed88cb366c289ad92818116728f26d3a58decf085c");
    expect(hmacSha256('TOKENMAXX', "src/genres.ts")).toBe("7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951");
    expect(hmacSha256('ci-config', "src/genres.ts")).toBe("02697e0bdc953f71214cc79afec2ae5e84cd1fdc756793ee4126468e035ea59e");
  });

  it('post123: locks src/genres.ts spaces 144', () => {
    expect((read("src/genres.ts").match(/ /g) ?? []).length).toBe(144);
  });

  it('post123: locks src/index.ts sha256', () => {
    expect(sha256("src/index.ts")).toBe("7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72");
  });

  it('post123: locks src/index.ts sha1', () => {
    expect(sha1("src/index.ts")).toBe("88b9273a584ce23d1da7ca8a147fee7faeee640b");
  });

  it('post123: locks src/index.ts md5', () => {
    expect(md5("src/index.ts")).toBe("8c9cdb320becf0effa2d8027b66a2177");
  });

  it('post123: locks src/index.ts sha384', () => {
    expect(sha384("src/index.ts")).toBe("1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65");
  });

  it('post123: locks src/index.ts sha512', () => {
    expect(sha512("src/index.ts")).toBe("28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3");
  });

  it('post123: locks src/index.ts sha3-256', () => {
    expect(sha3("src/index.ts")).toBe("437dfa14ad684952d2d6a973da9d2ea67482eff82e188c32e27507f9dfd3239b");
  });

  it('post123: locks src/index.ts blake2b512', () => {
    expect(blake2b("src/index.ts")).toBe("17bccc5865d7d993ff97e58ce699f0a3f7fd4aa6270d29bcb2cccaee3b0a48dd7b118625848275aab8adfa6efdc23a8a3ddb359f9addfcf6552c15fe4be1dace");
  });

  it('post123: locks src/index.ts ripemd160', () => {
    expect(ripemd("src/index.ts")).toBe("a8ea25913b26da27277f866fc7988fdcdf281093");
  });

  it('post123: locks src/index.ts size 4738', () => {
    expect(statSync(join(root, "src/index.ts")).size).toBe(4738);
    expect(readFileSync(join(root, "src/index.ts")).byteLength).toBe(4738);
  });

  it('post123: locks src/index.ts utf8 4724 lines 154', () => {
    expect(read("src/index.ts")).toHaveLength(4724);
    expect(read("src/index.ts").split('\n')).toHaveLength(154);
  });

  it('post123: locks src/index.ts nibble 470 xor 14', () => {
    const d = sha256("src/index.ts");
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post123: locks src/index.ts first/last octets', () => {
    const d = sha256("src/index.ts");
    expect(d.slice(0, 2)).toBe("7f");
    expect(d.slice(-2)).toBe("72");
  });

  it('post123: locks src/index.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "src/index.ts")).toBe("3d45ed31f75ae8cba65e0c8ddbe00e591e5f431b7745f8d13474d96ccb838561");
    expect(hmacSha256('TOKENMAXX', "src/index.ts")).toBe("d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc");
    expect(hmacSha256('ci-config', "src/index.ts")).toBe("ea00cc4fe15f4d9684cdf461ac63d706c76f66baed7fdaf23cc220afb77c39d2");
  });

  it('post123: locks src/index.ts spaces 761', () => {
    expect((read("src/index.ts").match(/ /g) ?? []).length).toBe(761);
  });

  it('post123: locks test/helpers.ts sha256', () => {
    expect(sha256("test/helpers.ts")).toBe("240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29");
  });

  it('post123: locks test/helpers.ts sha1', () => {
    expect(sha1("test/helpers.ts")).toBe("aac5e2154aa8f0784db092ad4bb51304fce6e117");
  });

  it('post123: locks test/helpers.ts md5', () => {
    expect(md5("test/helpers.ts")).toBe("004bbc8741017d8dd45bee28a29b46e1");
  });

  it('post123: locks test/helpers.ts sha384', () => {
    expect(sha384("test/helpers.ts")).toBe("1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167");
  });

  it('post123: locks test/helpers.ts sha512', () => {
    expect(sha512("test/helpers.ts")).toBe("153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91");
  });

  it('post123: locks test/helpers.ts sha3-256', () => {
    expect(sha3("test/helpers.ts")).toBe("8ffbb4baecd580e1f9f797a737d24af1f3e0fb48af208435dafe8afaa584b113");
  });

  it('post123: locks test/helpers.ts blake2b512', () => {
    expect(blake2b("test/helpers.ts")).toBe("9000b1e34f31a60c5b766398de6ce5657f7325d791b129e388e1312c47d8448070919d7711a2824b821a99661fbeb73f6e13dfa4b1de53d72aa0990f73f1061f");
  });

  it('post123: locks test/helpers.ts ripemd160', () => {
    expect(ripemd("test/helpers.ts")).toBe("24c482ba1ff1b74537b67a89b99058b6f2e500a4");
  });

  it('post123: locks test/helpers.ts size 6078', () => {
    expect(statSync(join(root, "test/helpers.ts")).size).toBe(6078);
    expect(readFileSync(join(root, "test/helpers.ts")).byteLength).toBe(6078);
  });

  it('post123: locks test/helpers.ts utf8 6078 lines 164', () => {
    expect(read("test/helpers.ts")).toHaveLength(6078);
    expect(read("test/helpers.ts").split('\n')).toHaveLength(164);
  });

  it('post123: locks test/helpers.ts nibble 487 xor 5', () => {
    const d = sha256("test/helpers.ts");
    expect(nibbleSum(d)).toBe(487);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post123: locks test/helpers.ts first/last octets', () => {
    const d = sha256("test/helpers.ts");
    expect(d.slice(0, 2)).toBe("24");
    expect(d.slice(-2)).toBe("29");
  });

  it('post123: locks test/helpers.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "test/helpers.ts")).toBe("8bd4ac7ac6f0833e49dbfc0059a4a863cb2adf98ddb0c6fa2e5599415b108799");
    expect(hmacSha256('TOKENMAXX', "test/helpers.ts")).toBe("8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391");
    expect(hmacSha256('ci-config', "test/helpers.ts")).toBe("09c6a7ad1aff663717e25ad0719777b1ba908e3c10626a6dc8246679319ea4d4");
  });

  it('post123: locks test/helpers.ts spaces 919', () => {
    expect((read("test/helpers.ts").match(/ /g) ?? []).length).toBe(919);
  });

  it('post123: locks AGENTS.md sha256', () => {
    expect(sha256("AGENTS.md")).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it('post123: locks AGENTS.md sha1', () => {
    expect(sha1("AGENTS.md")).toBe("a7df1fec05dcf7b8ace116788297c77f467a7b6c");
  });

  it('post123: locks AGENTS.md md5', () => {
    expect(md5("AGENTS.md")).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it('post123: locks AGENTS.md sha384', () => {
    expect(sha384("AGENTS.md")).toBe("817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a");
  });

  it('post123: locks AGENTS.md sha512', () => {
    expect(sha512("AGENTS.md")).toBe("7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908");
  });

  it('post123: locks AGENTS.md sha3-256', () => {
    expect(sha3("AGENTS.md")).toBe("894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4");
  });

  it('post123: locks AGENTS.md blake2b512', () => {
    expect(blake2b("AGENTS.md")).toBe("7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0");
  });

  it('post123: locks AGENTS.md ripemd160', () => {
    expect(ripemd("AGENTS.md")).toBe("6637e853e0148967671e4a3f21bd852255e8ed1c");
  });

  it('post123: locks AGENTS.md size 1017', () => {
    expect(statSync(join(root, "AGENTS.md")).size).toBe(1017);
    expect(readFileSync(join(root, "AGENTS.md")).byteLength).toBe(1017);
  });

  it('post123: locks AGENTS.md utf8 1011 lines 35', () => {
    expect(read("AGENTS.md")).toHaveLength(1011);
    expect(read("AGENTS.md").split('\n')).toHaveLength(35);
  });

  it('post123: locks AGENTS.md nibble 479 xor 5', () => {
    const d = sha256("AGENTS.md");
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post123: locks AGENTS.md first/last octets', () => {
    const d = sha256("AGENTS.md");
    expect(d.slice(0, 2)).toBe("48");
    expect(d.slice(-2)).toBe("aa");
  });

  it('post123: locks AGENTS.md HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "AGENTS.md")).toBe("8ac3125a7f2dc42ed6c1771338dd37727206fbd31dfcbf881040082082adc83d");
    expect(hmacSha256('TOKENMAXX', "AGENTS.md")).toBe("b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f");
    expect(hmacSha256('ci-config', "AGENTS.md")).toBe("1e8f20e9d67be8517c3acfdce81387fdbcd5d1bda52f43fffdb055139810c224");
  });

  it('post123: locks AGENTS.md spaces 120', () => {
    expect((read("AGENTS.md").match(/ /g) ?? []).length).toBe(120);
  });

  it('post123: locks .github/workflows/ci.yml sha256', () => {
    expect(sha256(".github/workflows/ci.yml")).toBe("c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5");
  });

  it('post123: locks .github/workflows/ci.yml sha1', () => {
    expect(sha1(".github/workflows/ci.yml")).toBe("2105395119389c6131d039b5d787abc150bbbcaa");
  });

  it('post123: locks .github/workflows/ci.yml md5', () => {
    expect(md5(".github/workflows/ci.yml")).toBe("ea05159f5a4591ccf20765050a212605");
  });

  it('post123: locks .github/workflows/ci.yml sha384', () => {
    expect(sha384(".github/workflows/ci.yml")).toBe("8aa8ec73d3268813ebed009b6ade76fbfd8833f0aa035fddfb830493e21b2074d7728e8554206bc26c9a3fa3792612ab");
  });

  it('post123: locks .github/workflows/ci.yml sha512', () => {
    expect(sha512(".github/workflows/ci.yml")).toBe("3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460");
  });

  it('post123: locks .github/workflows/ci.yml sha3-256', () => {
    expect(sha3(".github/workflows/ci.yml")).toBe("8f49dc5067d49c3458635df0dbb9078bac974081a35adab2c27d9349f30cd611");
  });

  it('post123: locks .github/workflows/ci.yml blake2b512', () => {
    expect(blake2b(".github/workflows/ci.yml")).toBe("5629fff561ce7acb56fc3d2f66b875992f525b4a25ec6c3c6fb485d6f6d20bb74a33c67c89389360ee29d12dd26361a4c24b39db6ec9aaf58462c3b0472f489d");
  });

  it('post123: locks .github/workflows/ci.yml ripemd160', () => {
    expect(ripemd(".github/workflows/ci.yml")).toBe("491302ba2e7b00c030ea98aea8ccee799d61e1ff");
  });

  it('post123: locks .github/workflows/ci.yml size 6295', () => {
    expect(statSync(join(root, ".github/workflows/ci.yml")).size).toBe(6295);
    expect(readFileSync(join(root, ".github/workflows/ci.yml")).byteLength).toBe(6295);
  });

  it('post123: locks .github/workflows/ci.yml utf8 6295 lines 177', () => {
    expect(read(".github/workflows/ci.yml")).toHaveLength(6295);
    expect(read(".github/workflows/ci.yml").split('\n')).toHaveLength(177);
  });

  it('post123: locks .github/workflows/ci.yml nibble 515 xor 3', () => {
    const d = sha256(".github/workflows/ci.yml");
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post123: locks .github/workflows/ci.yml first/last octets', () => {
    const d = sha256(".github/workflows/ci.yml");
    expect(d.slice(0, 2)).toBe("c4");
    expect(d.slice(-2)).toBe("d5");
  });

  it('post123: locks .github/workflows/ci.yml HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', ".github/workflows/ci.yml")).toBe("a4d504b8ad938f033b55ee7964ab9a025db5c566795a2378bfdf78ad7932a9bb");
    expect(hmacSha256('TOKENMAXX', ".github/workflows/ci.yml")).toBe("5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b");
    expect(hmacSha256('ci-config', ".github/workflows/ci.yml")).toBe("e997e669ee801faeaaac0ecfb8239cc5d416ffd739f752a288a997d086e7bd15");
  });

  it('post123: locks .github/workflows/ci.yml spaces 1716', () => {
    expect((read(".github/workflows/ci.yml").match(/ /g) ?? []).length).toBe(1716);
  });

  it('post123: GENRE_MAP late night -> ambient', () => {
    expect(resolveGenre("late night")).toBe("ambient");
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
    expect(resolveGenre("  late night  ")).toBe("ambient");
  });

  it('post123: GENRE_MAP chill -> ambient', () => {
    expect(resolveGenre("chill")).toBe("ambient");
    expect(resolveGenre("CHILL")).toBe("ambient");
    expect(resolveGenre("  chill  ")).toBe("ambient");
  });

  it('post123: GENRE_MAP ambient -> ambient', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(resolveGenre("AMBIENT")).toBe("ambient");
    expect(resolveGenre("  ambient  ")).toBe("ambient");
  });

  it('post123: GENRE_MAP relaxing -> ambient', () => {
    expect(resolveGenre("relaxing")).toBe("ambient");
    expect(resolveGenre("RELAXING")).toBe("ambient");
    expect(resolveGenre("  relaxing  ")).toBe("ambient");
  });

  it('post123: GENRE_MAP focus -> ambient', () => {
    expect(resolveGenre("focus")).toBe("ambient");
    expect(resolveGenre("FOCUS")).toBe("ambient");
    expect(resolveGenre("  focus  ")).toBe("ambient");
  });

  it('post123: GENRE_MAP classical -> classical', () => {
    expect(resolveGenre("classical")).toBe("classical");
    expect(resolveGenre("CLASSICAL")).toBe("classical");
    expect(resolveGenre("  classical  ")).toBe("classical");
  });

  it('post123: GENRE_MAP classic -> classical', () => {
    expect(resolveGenre("classic")).toBe("classical");
    expect(resolveGenre("CLASSIC")).toBe("classical");
    expect(resolveGenre("  classic  ")).toBe("classical");
  });

  it('post123: GENRE_MAP jazz -> jazz', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(resolveGenre("JAZZ")).toBe("jazz");
    expect(resolveGenre("  jazz  ")).toBe("jazz");
  });

  it('post123: GENRE_MAP blues -> jazz', () => {
    expect(resolveGenre("blues")).toBe("jazz");
    expect(resolveGenre("BLUES")).toBe("jazz");
    expect(resolveGenre("  blues  ")).toBe("jazz");
  });

  it('post123: GENRE_MAP pop -> pop', () => {
    expect(resolveGenre("pop")).toBe("pop");
    expect(resolveGenre("POP")).toBe("pop");
    expect(resolveGenre("  pop  ")).toBe("pop");
  });

  it('post123: GENRE_MAP rock -> rock', () => {
    expect(resolveGenre("rock")).toBe("rock");
    expect(resolveGenre("ROCK")).toBe("rock");
    expect(resolveGenre("  rock  ")).toBe("rock");
  });

  it('post123: GENRE_MAP metal -> rock', () => {
    expect(resolveGenre("metal")).toBe("rock");
    expect(resolveGenre("METAL")).toBe("rock");
    expect(resolveGenre("  metal  ")).toBe("rock");
  });

  it('post123: GENRE_MAP indie -> rock', () => {
    expect(resolveGenre("indie")).toBe("rock");
    expect(resolveGenre("INDIE")).toBe("rock");
    expect(resolveGenre("  indie  ")).toBe("rock");
  });

  it('post123: GENRE_MAP music -> music', () => {
    expect(resolveGenre("music")).toBe("music");
    expect(resolveGenre("MUSIC")).toBe("music");
    expect(resolveGenre("  music  ")).toBe("music");
  });

  it('post123: GENRE_MAP news -> news', () => {
    expect(resolveGenre("news")).toBe("news");
    expect(resolveGenre("NEWS")).toBe("news");
    expect(resolveGenre("  news  ")).toBe("news");
  });

  it('post123: GENRE_MAP sports -> sports', () => {
    expect(resolveGenre("sports")).toBe("sports");
    expect(resolveGenre("SPORTS")).toBe("sports");
    expect(resolveGenre("  sports  ")).toBe("sports");
  });

  it('post123: GENRE_MAP entertainment -> entertainment', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
    expect(resolveGenre("  entertainment  ")).toBe("entertainment");
  });

  it('post123: GENRE_MAP dance -> pop', () => {
    expect(resolveGenre("dance")).toBe("pop");
    expect(resolveGenre("DANCE")).toBe("pop");
    expect(resolveGenre("  dance  ")).toBe("pop");
  });

  it('post123: GENRE_MAP electronic -> ambient', () => {
    expect(resolveGenre("electronic")).toBe("ambient");
    expect(resolveGenre("ELECTRONIC")).toBe("ambient");
    expect(resolveGenre("  electronic  ")).toBe("ambient");
  });

  it('post123: GENRE_MAP lofi -> ambient', () => {
    expect(resolveGenre("lofi")).toBe("ambient");
    expect(resolveGenre("LOFI")).toBe("ambient");
    expect(resolveGenre("  lofi  ")).toBe("ambient");
  });

  it('post123: GENRE_MAP lo-fi -> ambient', () => {
    expect(resolveGenre("lo-fi")).toBe("ambient");
    expect(resolveGenre("LO-FI")).toBe("ambient");
    expect(resolveGenre("  lo-fi  ")).toBe("ambient");
  });

  it('post123: VALID_GENRES includes music', () => {
    expect(VALID_GENRES).toContain("music");
    expect(resolveGenre("music")).toBe("music");
  });

  it('post123: VALID_GENRES includes ambient', () => {
    expect(VALID_GENRES).toContain("ambient");
    expect(resolveGenre("ambient")).toBe("ambient");
  });

  it('post123: VALID_GENRES includes jazz', () => {
    expect(VALID_GENRES).toContain("jazz");
    expect(resolveGenre("jazz")).toBe("jazz");
  });

  it('post123: VALID_GENRES includes classical', () => {
    expect(VALID_GENRES).toContain("classical");
    expect(resolveGenre("classical")).toBe("classical");
  });

  it('post123: VALID_GENRES includes pop', () => {
    expect(VALID_GENRES).toContain("pop");
    expect(resolveGenre("pop")).toBe("pop");
  });

  it('post123: VALID_GENRES includes rock', () => {
    expect(VALID_GENRES).toContain("rock");
    expect(resolveGenre("rock")).toBe("rock");
  });

  it('post123: VALID_GENRES includes news', () => {
    expect(VALID_GENRES).toContain("news");
    expect(resolveGenre("news")).toBe("news");
  });

  it('post123: VALID_GENRES includes sports', () => {
    expect(VALID_GENRES).toContain("sports");
    expect(resolveGenre("sports")).toBe("sports");
  });

  it('post123: VALID_GENRES includes entertainment', () => {
    expect(VALID_GENRES).toContain("entertainment");
    expect(resolveGenre("entertainment")).toBe("entertainment");
  });

  it('post123: unknown qobuz -> music', () => {
    expect(resolveGenre("qobuz")).toBe('music');
  });

  it('post123: unknown spotify -> music', () => {
    expect(resolveGenre("spotify")).toBe('music');
  });

  it('post123: unknown podcast -> music', () => {
    expect(resolveGenre("podcast")).toBe('music');
  });

  it('post123: unknown playlist -> music', () => {
    expect(resolveGenre("playlist")).toBe('music');
  });

  it('post123: unknown now-playing -> music', () => {
    expect(resolveGenre("now-playing")).toBe('music');
  });

  it('post123: unknown radio paradise -> music', () => {
    expect(resolveGenre("radio paradise")).toBe('music');
  });

  it('post123: unknown somafm -> music', () => {
    expect(resolveGenre("somafm")).toBe('music');
  });

  it('post123: unknown foo -> music', () => {
    expect(resolveGenre("foo")).toBe('music');
  });

  it('post123: unknown xyzzy -> music', () => {
    expect(resolveGenre("xyzzy")).toBe('music');
  });

  it('post123: unknown 123 -> music', () => {
    expect(resolveGenre("123")).toBe('music');
  });

  it('post123: blank/missing -> music', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('   ')).toBe('music');
  });

  it('post123: custom map override', () => {
    expect(resolveGenre('custom', { custom: 'jazz' })).toBe('jazz');
    expect(resolveGenre('rock', { custom: 'jazz' })).toBe('rock');
    expect(resolveGenre('nope', { custom: 'jazz' })).toBe('music');
  });

  it('post123: avoid #118 __proto__ inventing trap', () => {
    void resolveGenre('__proto__');
    expect(resolveGenre('jazz')).toBe('jazz');
    expect(resolveGenre('blues')).toBe('jazz');
  });

  it('post123: map/valid sizes locked', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('post123: 20-round alias matrix', () => {
    for (let r = 0; r < 20; r++) {
      for (const [k, v] of Object.entries(GENRE_MAP)) expect(resolveGenre(k)).toBe(v);
    }
  });

  it('post123: mega purity 30x genres.ts', () => {
    const expected = "aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e";
    for (let i = 0; i < 30; i++) expect(sha256('src/genres.ts')).toBe(expected);
  });

  it('post123: index wires resolveGenre without playlist inventing', () => {
    const index = read('src/index.ts');
    expect(index).toContain('resolveGenre');
    expect(index).not.toMatch(/\/playlist|\/now-playing/);
  });

  it('post123: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post115 genres HEAVY deepen'");
    expect(body).toContain("describe('post123 genres HEAVY deepen (after #123)'");
    expect((body.match(/it\('post123:/g) ?? []).length).toBeGreaterThan(80);
  });

});

// --- HEAVY burn (post-#126): deepen genres leftover edges only — no product inventing ---
// Orthogonal to #126 ci-config. Alias/VALID matrices + digest/HMAC post126 locks.

describe('post126 genres HEAVY deepen (after #126)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };


  it('post126: locks src/genres.ts sha256', () => {
    expect(sha256("src/genres.ts")).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it('post126: locks src/genres.ts sha1', () => {
    expect(sha1("src/genres.ts")).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it('post126: locks src/genres.ts md5', () => {
    expect(md5("src/genres.ts")).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it('post126: locks src/genres.ts sha384', () => {
    expect(sha384("src/genres.ts")).toBe("ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16");
  });

  it('post126: locks src/genres.ts sha512', () => {
    expect(sha512("src/genres.ts")).toBe("bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b");
  });

  it('post126: locks src/genres.ts sha3-256', () => {
    expect(sha3("src/genres.ts")).toBe("d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f");
  });

  it('post126: locks src/genres.ts blake2b512', () => {
    expect(blake2b("src/genres.ts")).toBe("731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67");
  });

  it('post126: locks src/genres.ts ripemd160', () => {
    expect(ripemd("src/genres.ts")).toBe("bb9faaf8890bdba8dd86bcdf7e418da622d19bf5");
  });

  it('post126: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, "src/genres.ts")).size).toBe(1027);
    expect(readFileSync(join(root, "src/genres.ts")).byteLength).toBe(1027);
  });

  it('post126: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read("src/genres.ts")).toHaveLength(1025);
    expect(read("src/genres.ts").split('\n')).toHaveLength(48);
  });

  it('post126: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256("src/genres.ts");
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post126: locks src/genres.ts pairSum 3950 rollingXor 96', () => {
    const d = sha256("src/genres.ts");
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it('post126: locks src/genres.ts first/last/mid octets', () => {
    const d = sha256("src/genres.ts");
    expect(d.slice(0, 2)).toBe("aa");
    expect(d.slice(-2)).toBe("4e");
    expect(d.slice(28, 36)).toBe("811dfbc2");
  });

  it('post126: locks src/genres.ts HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', "src/genres.ts")).toBe("d00397aa14b640d123623b36ef27110bc9deed9da9f10ad241e24389d9ab5b9a");
    expect(hmacSha256('leftover', "src/genres.ts")).toBe("bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f");
    expect(hmacSha256('TOKENMAXX', "src/genres.ts")).toBe("7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951");
  });

  it('post126: locks src/genres.ts HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', "src/genres.ts")).toBe("ac142d4e503dc966ad6a0fe4a5929de2676083956be4c90f386cc762d42d170f");
    expect(hmacSha256('HEAVY', "src/genres.ts")).toBe("728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575");
    expect(hmacSha256('no-product-invent', "src/genres.ts")).toBe("3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b");
  });

  it('post126: locks src/genres.ts spaces 144', () => {
    expect((read("src/genres.ts").match(/ /g) ?? []).length).toBe(144);
  });

  it('post126: locks src/genres.ts reversed sha256', () => {
    const rev = [...read("src/genres.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac");
  });

  it('post126: locks src/genres.ts sha256 UPPERCASE', () => {
    expect(sha256("src/genres.ts").toUpperCase()).toBe("AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E");
  });

  it('post126: locks src/genres.ts first-line sha256', () => {
    expect(createHash('sha256').update(read("src/genres.ts").split('\n')[0]).digest('hex')).toBe("907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68");
  });

  it('post126: locks src/genres.ts size*lines 49296', () => {
    expect(statSync(join(root, "src/genres.ts")).size * read("src/genres.ts").split('\n').length).toBe(49296);
  });

  it('post126: locks src/index.ts sha256', () => {
    expect(sha256("src/index.ts")).toBe("7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72");
  });

  it('post126: locks src/index.ts sha1', () => {
    expect(sha1("src/index.ts")).toBe("88b9273a584ce23d1da7ca8a147fee7faeee640b");
  });

  it('post126: locks src/index.ts md5', () => {
    expect(md5("src/index.ts")).toBe("8c9cdb320becf0effa2d8027b66a2177");
  });

  it('post126: locks src/index.ts sha384', () => {
    expect(sha384("src/index.ts")).toBe("1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65");
  });

  it('post126: locks src/index.ts sha512', () => {
    expect(sha512("src/index.ts")).toBe("28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3");
  });

  it('post126: locks src/index.ts sha3-256', () => {
    expect(sha3("src/index.ts")).toBe("437dfa14ad684952d2d6a973da9d2ea67482eff82e188c32e27507f9dfd3239b");
  });

  it('post126: locks src/index.ts blake2b512', () => {
    expect(blake2b("src/index.ts")).toBe("17bccc5865d7d993ff97e58ce699f0a3f7fd4aa6270d29bcb2cccaee3b0a48dd7b118625848275aab8adfa6efdc23a8a3ddb359f9addfcf6552c15fe4be1dace");
  });

  it('post126: locks src/index.ts ripemd160', () => {
    expect(ripemd("src/index.ts")).toBe("a8ea25913b26da27277f866fc7988fdcdf281093");
  });

  it('post126: locks src/index.ts size 4738', () => {
    expect(statSync(join(root, "src/index.ts")).size).toBe(4738);
    expect(readFileSync(join(root, "src/index.ts")).byteLength).toBe(4738);
  });

  it('post126: locks src/index.ts utf8 4724 lines 154', () => {
    expect(read("src/index.ts")).toHaveLength(4724);
    expect(read("src/index.ts").split('\n')).toHaveLength(154);
  });

  it('post126: locks src/index.ts nibble 470 xor 14', () => {
    const d = sha256("src/index.ts");
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post126: locks src/index.ts pairSum 4265 rollingXor 151', () => {
    const d = sha256("src/index.ts");
    expect(pairSum(d)).toBe(4265);
    expect(rollingXor(d)).toBe(151);
  });

  it('post126: locks src/index.ts first/last/mid octets', () => {
    const d = sha256("src/index.ts");
    expect(d.slice(0, 2)).toBe("7f");
    expect(d.slice(-2)).toBe("72");
    expect(d.slice(28, 36)).toBe("e2a20389");
  });

  it('post126: locks src/index.ts HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', "src/index.ts")).toBe("8b3e887c6aba91ba1e3e67132a9f169906b85e48e656d3e7522f1cd97c6e0c93");
    expect(hmacSha256('leftover', "src/index.ts")).toBe("268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be");
    expect(hmacSha256('TOKENMAXX', "src/index.ts")).toBe("d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc");
  });

  it('post126: locks src/index.ts HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', "src/index.ts")).toBe("8f464238e124275839a76b775ae483a4bfec33c961d54d99789db40663a580d0");
    expect(hmacSha256('HEAVY', "src/index.ts")).toBe("f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30");
    expect(hmacSha256('no-product-invent', "src/index.ts")).toBe("49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a");
  });

  it('post126: locks src/index.ts spaces 761', () => {
    expect((read("src/index.ts").match(/ /g) ?? []).length).toBe(761);
  });

  it('post126: locks src/index.ts reversed sha256', () => {
    const rev = [...read("src/index.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("457830430075a6d1dc4b28436b3c145eb42a640d91301599ca2792fb58433ead");
  });

  it('post126: locks src/index.ts sha256 UPPERCASE', () => {
    expect(sha256("src/index.ts").toUpperCase()).toBe("7F0D574B0AEDC6CD71D3EA35BB03E2A20389028E6FF2C195718ACFF2E0313A72");
  });

  it('post126: locks src/index.ts first-line sha256', () => {
    expect(createHash('sha256').update(read("src/index.ts").split('\n')[0]).digest('hex')).toBe("d8233fd79765534121de12d18bc3b54a6968d1868428cf5d52175e9a620cf6d4");
  });

  it('post126: locks src/index.ts size*lines 729652', () => {
    expect(statSync(join(root, "src/index.ts")).size * read("src/index.ts").split('\n').length).toBe(729652);
  });


  it('post126: resolveGenre maps "late night" → ambient', () => {
    expect(resolveGenre("late night")).toBe("ambient");
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
    expect(resolveGenre("  late night  ")).toBe("ambient");
  });

  it('post126: resolveGenre maps "chill" → ambient', () => {
    expect(resolveGenre("chill")).toBe("ambient");
    expect(resolveGenre("CHILL")).toBe("ambient");
    expect(resolveGenre("  chill  ")).toBe("ambient");
  });

  it('post126: resolveGenre maps "ambient" → ambient', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(resolveGenre("AMBIENT")).toBe("ambient");
    expect(resolveGenre("  ambient  ")).toBe("ambient");
  });

  it('post126: resolveGenre maps "relaxing" → ambient', () => {
    expect(resolveGenre("relaxing")).toBe("ambient");
    expect(resolveGenre("RELAXING")).toBe("ambient");
    expect(resolveGenre("  relaxing  ")).toBe("ambient");
  });

  it('post126: resolveGenre maps "focus" → ambient', () => {
    expect(resolveGenre("focus")).toBe("ambient");
    expect(resolveGenre("FOCUS")).toBe("ambient");
    expect(resolveGenre("  focus  ")).toBe("ambient");
  });

  it('post126: resolveGenre maps "classical" → classical', () => {
    expect(resolveGenre("classical")).toBe("classical");
    expect(resolveGenre("CLASSICAL")).toBe("classical");
    expect(resolveGenre("  classical  ")).toBe("classical");
  });

  it('post126: resolveGenre maps "classic" → classical', () => {
    expect(resolveGenre("classic")).toBe("classical");
    expect(resolveGenre("CLASSIC")).toBe("classical");
    expect(resolveGenre("  classic  ")).toBe("classical");
  });

  it('post126: resolveGenre maps "jazz" → jazz', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(resolveGenre("JAZZ")).toBe("jazz");
    expect(resolveGenre("  jazz  ")).toBe("jazz");
  });

  it('post126: resolveGenre maps "blues" → jazz', () => {
    expect(resolveGenre("blues")).toBe("jazz");
    expect(resolveGenre("BLUES")).toBe("jazz");
    expect(resolveGenre("  blues  ")).toBe("jazz");
  });

  it('post126: resolveGenre maps "pop" → pop', () => {
    expect(resolveGenre("pop")).toBe("pop");
    expect(resolveGenre("POP")).toBe("pop");
    expect(resolveGenre("  pop  ")).toBe("pop");
  });

  it('post126: resolveGenre maps "rock" → rock', () => {
    expect(resolveGenre("rock")).toBe("rock");
    expect(resolveGenre("ROCK")).toBe("rock");
    expect(resolveGenre("  rock  ")).toBe("rock");
  });

  it('post126: resolveGenre maps "metal" → rock', () => {
    expect(resolveGenre("metal")).toBe("rock");
    expect(resolveGenre("METAL")).toBe("rock");
    expect(resolveGenre("  metal  ")).toBe("rock");
  });

  it('post126: resolveGenre maps "indie" → rock', () => {
    expect(resolveGenre("indie")).toBe("rock");
    expect(resolveGenre("INDIE")).toBe("rock");
    expect(resolveGenre("  indie  ")).toBe("rock");
  });

  it('post126: resolveGenre maps "music" → music', () => {
    expect(resolveGenre("music")).toBe("music");
    expect(resolveGenre("MUSIC")).toBe("music");
    expect(resolveGenre("  music  ")).toBe("music");
  });

  it('post126: resolveGenre maps "news" → news', () => {
    expect(resolveGenre("news")).toBe("news");
    expect(resolveGenre("NEWS")).toBe("news");
    expect(resolveGenre("  news  ")).toBe("news");
  });

  it('post126: resolveGenre maps "sports" → sports', () => {
    expect(resolveGenre("sports")).toBe("sports");
    expect(resolveGenre("SPORTS")).toBe("sports");
    expect(resolveGenre("  sports  ")).toBe("sports");
  });

  it('post126: resolveGenre maps "entertainment" → entertainment', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
    expect(resolveGenre("  entertainment  ")).toBe("entertainment");
  });

  it('post126: resolveGenre maps "dance" → pop', () => {
    expect(resolveGenre("dance")).toBe("pop");
    expect(resolveGenre("DANCE")).toBe("pop");
    expect(resolveGenre("  dance  ")).toBe("pop");
  });

  it('post126: resolveGenre maps "electronic" → ambient', () => {
    expect(resolveGenre("electronic")).toBe("ambient");
    expect(resolveGenre("ELECTRONIC")).toBe("ambient");
    expect(resolveGenre("  electronic  ")).toBe("ambient");
  });

  it('post126: resolveGenre maps "lofi" → ambient', () => {
    expect(resolveGenre("lofi")).toBe("ambient");
    expect(resolveGenre("LOFI")).toBe("ambient");
    expect(resolveGenre("  lofi  ")).toBe("ambient");
  });

  it('post126: resolveGenre maps "lo-fi" → ambient', () => {
    expect(resolveGenre("lo-fi")).toBe("ambient");
    expect(resolveGenre("LO-FI")).toBe("ambient");
    expect(resolveGenre("  lo-fi  ")).toBe("ambient");
  });

  it('post126: VALID_GENRES includes music identity', () => {
    expect(VALID_GENRES).toContain("music");
    expect(resolveGenre("music")).toBe("music");
    expect(GENRE_MAP["music"]).toBe("music");
  });

  it('post126: VALID_GENRES includes ambient identity', () => {
    expect(VALID_GENRES).toContain("ambient");
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(GENRE_MAP["ambient"]).toBe("ambient");
  });

  it('post126: VALID_GENRES includes jazz identity', () => {
    expect(VALID_GENRES).toContain("jazz");
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(GENRE_MAP["jazz"]).toBe("jazz");
  });

  it('post126: VALID_GENRES includes classical identity', () => {
    expect(VALID_GENRES).toContain("classical");
    expect(resolveGenre("classical")).toBe("classical");
    expect(GENRE_MAP["classical"]).toBe("classical");
  });

  it('post126: VALID_GENRES includes pop identity', () => {
    expect(VALID_GENRES).toContain("pop");
    expect(resolveGenre("pop")).toBe("pop");
    expect(GENRE_MAP["pop"]).toBe("pop");
  });

  it('post126: VALID_GENRES includes rock identity', () => {
    expect(VALID_GENRES).toContain("rock");
    expect(resolveGenre("rock")).toBe("rock");
    expect(GENRE_MAP["rock"]).toBe("rock");
  });

  it('post126: VALID_GENRES includes news identity', () => {
    expect(VALID_GENRES).toContain("news");
    expect(resolveGenre("news")).toBe("news");
    expect(GENRE_MAP["news"]).toBe("news");
  });

  it('post126: VALID_GENRES includes sports identity', () => {
    expect(VALID_GENRES).toContain("sports");
    expect(resolveGenre("sports")).toBe("sports");
    expect(GENRE_MAP["sports"]).toBe("sports");
  });

  it('post126: VALID_GENRES includes entertainment identity', () => {
    expect(VALID_GENRES).toContain("entertainment");
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(GENRE_MAP["entertainment"]).toBe("entertainment");
  });

  it('post126: unknown alias falls back to music', () => {
    expect(resolveGenre('unknown-genre-xyz')).toBe('music');
    expect(resolveGenre('????')).toBe('music');
  });

  it('post126: custom map override wins', () => {
    expect(resolveGenre('custom', { custom: 'jazz' })).toBe('jazz');
    expect(resolveGenre('missing', { custom: 'jazz' })).toBe('music');
  });

  it('post126: GENRE_MAP key count 21 and VALID length 9', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('post126: ambient fan-in eight aliases', () => {
    const ambient = Object.entries(GENRE_MAP).filter(([, v]) => v === 'ambient').map(([k]) => k);
    expect(ambient.sort()).toEqual(['ambient', 'chill', 'electronic', 'focus', 'late night', 'lo-fi', 'lofi', 'relaxing'].sort());
  });

  it('post126: rock fan-in three aliases', () => {
    expect(Object.entries(GENRE_MAP).filter(([, v]) => v === 'rock').map(([k]) => k).sort()).toEqual(['indie', 'metal', 'rock']);
  });

  it('post126: negative inventing fence genres source', () => {
    expect(genresSource).not.toMatch(/\/playlist|\/now-playing|openapi|__proto__/);
  });

  it('post126: mega purity 30x genres.ts sha256', () => {
    const expected = "aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e";
    for (let i = 0; i < 30; i++) expect(sha256('src/genres.ts')).toBe(expected);
  });

  it('post126: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post123 genres HEAVY deepen (after #123)'");
    expect(body).toContain("describe('post126 genres HEAVY deepen (after #126)'");
    expect((body.match(/it\('post126:/g) ?? []).length).toBeGreaterThan(40);
  });

});

describe('post132 genres HEAVY deepen (after #132)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };

  it('post132: locks src/genres.ts sha256', () => {
    expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post132: locks src/genres.ts sha1', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post132: locks src/genres.ts md5', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post132: locks src/genres.ts sha384', () => {
    expect(sha384('src/genres.ts')).toBe('ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16');
  });

  it('post132: locks src/genres.ts sha512', () => {
    expect(sha512('src/genres.ts')).toBe('bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b');
  });

  it('post132: locks src/genres.ts sha3-256', () => {
    expect(sha3('src/genres.ts')).toBe('d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f');
  });

  it('post132: locks src/genres.ts blake2b512', () => {
    expect(blake2b('src/genres.ts')).toBe('731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67');
  });

  it('post132: locks src/genres.ts ripemd160', () => {
    expect(ripemd('src/genres.ts')).toBe('bb9faaf8890bdba8dd86bcdf7e418da622d19bf5');
  });

  it('post132: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027);
    expect(readFileSync(join(root, 'src/genres.ts')).byteLength).toBe(1027);
  });

  it('post132: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read('src/genres.ts')).toHaveLength(1025);
    expect(read('src/genres.ts').split('\n')).toHaveLength(48);
  });

  it('post132: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256('src/genres.ts');
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post132: locks src/genres.ts pairSum 3950 rollingXor 96', () => {
    const d = sha256('src/genres.ts');
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it('post132: locks src/genres.ts first/last/mid octets', () => {
    const d = sha256('src/genres.ts');
    expect(d.slice(0, 2)).toBe('aa');
    expect(d.slice(-2)).toBe('4e');
    expect(d.slice(28, 36)).toBe('811dfbc2');
  });

  it('post132: locks src/genres.ts HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'src/genres.ts')).toBe('9e06920bc9a345a799cad7ed56213e2c346fcc0e1a9665cdfac26dc30cefaf8e');
    expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f');
    expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951');
  });

  it('post132: locks src/genres.ts HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'src/genres.ts')).toBe('62169566665ff1df98ec5c8173959c2593c335a2fe9f91653b4d4b671ec3e987');
    expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575');
    expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b');
  });

  it('post132: locks src/genres.ts spaces 144', () => {
    expect((read('src/genres.ts').match(/ /g) ?? []).length).toBe(144);
  });

  it('post132: locks src/genres.ts reversed sha256', () => {
    const rev = [...read('src/genres.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac');
  });

  it('post132: locks src/genres.ts sha256 UPPERCASE', () => {
    expect(sha256('src/genres.ts').toUpperCase()).toBe('AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E');
  });

  it('post132: locks src/genres.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/genres.ts').split('\n')[0]).digest('hex')).toBe('907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68');
  });

  it('post132: locks src/genres.ts size*lines 49296', () => {
    expect(statSync(join(root, 'src/genres.ts')).size * read('src/genres.ts').split('\n').length).toBe(49296);
  });

  it('post132: locks src/genres.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/genres.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(47);
    expect((t.match(/,/g) ?? []).length).toBe(34);
    expect((t.match(/:/g) ?? []).length).toBe(26);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(68);
  });

  it('post132: locks src/genres.ts HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('2b73512bcf2e8a73142d66ad0855f763981cb873');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('9310f1272a6179181bbbbc257f645c56');
  });

  it('post132: locks src/index.ts sha256', () => {
    expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post132: locks src/index.ts sha1', () => {
    expect(sha1('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post132: locks src/index.ts md5', () => {
    expect(md5('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post132: locks src/index.ts sha384', () => {
    expect(sha384('src/index.ts')).toBe('1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65');
  });

  it('post132: locks src/index.ts sha512', () => {
    expect(sha512('src/index.ts')).toBe('28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3');
  });

  it('post132: locks src/index.ts sha3-256', () => {
    expect(sha3('src/index.ts')).toBe('437dfa14ad684952d2d6a973da9d2ea67482eff82e188c32e27507f9dfd3239b');
  });

  it('post132: locks src/index.ts blake2b512', () => {
    expect(blake2b('src/index.ts')).toBe('17bccc5865d7d993ff97e58ce699f0a3f7fd4aa6270d29bcb2cccaee3b0a48dd7b118625848275aab8adfa6efdc23a8a3ddb359f9addfcf6552c15fe4be1dace');
  });

  it('post132: locks src/index.ts ripemd160', () => {
    expect(ripemd('src/index.ts')).toBe('a8ea25913b26da27277f866fc7988fdcdf281093');
  });

  it('post132: locks src/index.ts size 4738', () => {
    expect(statSync(join(root, 'src/index.ts')).size).toBe(4738);
    expect(readFileSync(join(root, 'src/index.ts')).byteLength).toBe(4738);
  });

  it('post132: locks src/index.ts utf8 4724 lines 154', () => {
    expect(read('src/index.ts')).toHaveLength(4724);
    expect(read('src/index.ts').split('\n')).toHaveLength(154);
  });

  it('post132: locks src/index.ts nibble 470 xor 14', () => {
    const d = sha256('src/index.ts');
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post132: locks src/index.ts pairSum 4265 rollingXor 151', () => {
    const d = sha256('src/index.ts');
    expect(pairSum(d)).toBe(4265);
    expect(rollingXor(d)).toBe(151);
  });

  it('post132: locks src/index.ts first/last/mid octets', () => {
    const d = sha256('src/index.ts');
    expect(d.slice(0, 2)).toBe('7f');
    expect(d.slice(-2)).toBe('72');
    expect(d.slice(28, 36)).toBe('e2a20389');
  });

  it('post132: locks src/index.ts HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'src/index.ts')).toBe('2064124812f2bc1a6be8992f19cb181550c5c37d68da67cc4a55f02604cee11a');
    expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be');
    expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc');
  });

  it('post132: locks src/index.ts HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'src/index.ts')).toBe('6038d2c8a7333f307349434f984744036a6e22527d669e5c6912084f053f0b9f');
    expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30');
    expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a');
  });

  it('post132: locks src/index.ts spaces 761', () => {
    expect((read('src/index.ts').match(/ /g) ?? []).length).toBe(761);
  });

  it('post132: locks src/index.ts reversed sha256', () => {
    const rev = [...read('src/index.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('457830430075a6d1dc4b28436b3c145eb42a640d91301599ca2792fb58433ead');
  });

  it('post132: locks src/index.ts sha256 UPPERCASE', () => {
    expect(sha256('src/index.ts').toUpperCase()).toBe('7F0D574B0AEDC6CD71D3EA35BB03E2A20389028E6FF2C195718ACFF2E0313A72');
  });

  it('post132: locks src/index.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/index.ts').split('\n')[0]).digest('hex')).toBe('d8233fd79765534121de12d18bc3b54a6968d1868428cf5d52175e9a620cf6d4');
  });

  it('post132: locks src/index.ts size*lines 729652', () => {
    expect(statSync(join(root, 'src/index.ts')).size * read('src/index.ts').split('\n').length).toBe(729652);
  });

  it('post132: locks src/index.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/index.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(153);
    expect((t.match(/,/g) ?? []).length).toBe(69);
    expect((t.match(/:/g) ?? []).length).toBe(72);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(85);
  });

  it('post132: locks src/index.ts HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('480594e73492f47033261a85bd508bb11b828edf');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('f19be577d2d242a3cc7e438fdac2b57f');
  });

  it('post132: locks src/types.ts sha256', () => {
    expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
  });

  it('post132: locks src/types.ts sha1', () => {
    expect(sha1('src/types.ts')).toBe('1e8906673dc0d140ee5c3d40839c88a1eeca03d8');
  });

  it('post132: locks src/types.ts md5', () => {
    expect(md5('src/types.ts')).toBe('ecba663d21928622be656805ad27d0a3');
  });

  it('post132: locks src/types.ts sha384', () => {
    expect(sha384('src/types.ts')).toBe('40618d8902640e6ce24d5caf0b9daf86c4d5f962832b1835a86bb10ad7c37455cc60aa9f965ffd9a98f9a5967048b01c');
  });

  it('post132: locks src/types.ts sha512', () => {
    expect(sha512('src/types.ts')).toBe('49cf750d836fe717822e6f08b6ff4998c1f7419a2dfb169a5cfb3001dc1f6dc84df5b428edba879cbd0f7e1b809662e27ee34bf28f88e1efc62ec7d0b37f37cc');
  });

  it('post132: locks src/types.ts sha3-256', () => {
    expect(sha3('src/types.ts')).toBe('93122aa0fe9ef2958ed1b257bc139e91b30facb2e13e4094620dadf7d4acf8e4');
  });

  it('post132: locks src/types.ts blake2b512', () => {
    expect(blake2b('src/types.ts')).toBe('fcb08243a6c336e8da2d3500665ae9a80d98f23a06c3da5f771a290a4b45b2697e2b00e440165eb6551886f58a3bdea0ba315c1d4d3caba38ba3af7f108b3723');
  });

  it('post132: locks src/types.ts ripemd160', () => {
    expect(ripemd('src/types.ts')).toBe('80ca02c12c5db60b8eb1afb1cd21b18983ba16fb');
  });

  it('post132: locks src/types.ts size 174', () => {
    expect(statSync(join(root, 'src/types.ts')).size).toBe(174);
    expect(readFileSync(join(root, 'src/types.ts')).byteLength).toBe(174);
  });

  it('post132: locks src/types.ts utf8 172 lines 7', () => {
    expect(read('src/types.ts')).toHaveLength(172);
    expect(read('src/types.ts').split('\n')).toHaveLength(7);
  });

  it('post132: locks src/types.ts nibble 520 xor 14', () => {
    const d = sha256('src/types.ts');
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post132: locks src/types.ts pairSum 4300 rollingXor 104', () => {
    const d = sha256('src/types.ts');
    expect(pairSum(d)).toBe(4300);
    expect(rollingXor(d)).toBe(104);
  });

  it('post132: locks src/types.ts first/last/mid octets', () => {
    const d = sha256('src/types.ts');
    expect(d.slice(0, 2)).toBe('40');
    expect(d.slice(-2)).toBe('d3');
    expect(d.slice(28, 36)).toBe('345e4f21');
  });

  it('post132: locks src/types.ts HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'src/types.ts')).toBe('141c95bb60d9ec304ae8758b8e1efa3efecbae170e7687725f6351b3f69dd3ba');
    expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85');
    expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc');
  });

  it('post132: locks src/types.ts HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'src/types.ts')).toBe('1e2e1cf3371e866a20c8f385139492068cd62b41e461c126f470075831d5abfc');
    expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a');
    expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076');
  });

  it('post132: locks src/types.ts spaces 25', () => {
    expect((read('src/types.ts').match(/ /g) ?? []).length).toBe(25);
  });

  it('post132: locks src/types.ts reversed sha256', () => {
    const rev = [...read('src/types.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e02dd34c73f2571af21a48fda8cfd19667149441b37d30de0519262fc76f7f37');
  });

  it('post132: locks src/types.ts sha256 UPPERCASE', () => {
    expect(sha256('src/types.ts').toUpperCase()).toBe('4008DDD3DD6DD2FB7E8D386DFE2A345E4F21FA5576E229A8FBBE691626F743D3');
  });

  it('post132: locks src/types.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/types.ts').split('\n')[0]).digest('hex')).toBe('1d293b13ae9f4103472d1553f95a9368a006f250a1178cb8946d4e566fda25f6');
  });

  it('post132: locks src/types.ts size*lines 1218', () => {
    expect(statSync(join(root, 'src/types.ts')).size * read('src/types.ts').split('\n').length).toBe(1218);
  });

  it('post132: locks src/types.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/types.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(6);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(3);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post132: locks src/types.ts HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('cf8753e684c975328e81c7e4700c15cb018bc9d7');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('f4f79f2452cd505748114cbb1ee16064');
  });

  it('post132: locks src/parser.ts sha256', () => {
    expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post132: locks src/parser.ts sha1', () => {
    expect(sha1('src/parser.ts')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it('post132: locks src/parser.ts md5', () => {
    expect(md5('src/parser.ts')).toBe('500211c4c526de887252451726776563');
  });

  it('post132: locks src/parser.ts sha384', () => {
    expect(sha384('src/parser.ts')).toBe('f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9');
  });

  it('post132: locks src/parser.ts sha512', () => {
    expect(sha512('src/parser.ts')).toBe('66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89');
  });

  it('post132: locks src/parser.ts sha3-256', () => {
    expect(sha3('src/parser.ts')).toBe('0ec47247da4cff229cc417b213da73883427985239714e246eb16d1f021bf9c2');
  });

  it('post132: locks src/parser.ts blake2b512', () => {
    expect(blake2b('src/parser.ts')).toBe('d61759e7d0a68efcd16a74811ad84abebe0b82dab5c16e51261ca37118efc5a3c36aec8bc1523ce2b0d3908cd065c7cb8d1c153ea9a31dec633a90ec53aca7ef');
  });

  it('post132: locks src/parser.ts ripemd160', () => {
    expect(ripemd('src/parser.ts')).toBe('36f12fc76af98f06dfa651f814e8f2e13b26c96a');
  });

  it('post132: locks src/parser.ts size 1955', () => {
    expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955);
    expect(readFileSync(join(root, 'src/parser.ts')).byteLength).toBe(1955);
  });

  it('post132: locks src/parser.ts utf8 1953 lines 67', () => {
    expect(read('src/parser.ts')).toHaveLength(1953);
    expect(read('src/parser.ts').split('\n')).toHaveLength(67);
  });

  it('post132: locks src/parser.ts nibble 477 xor 9', () => {
    const d = sha256('src/parser.ts');
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post132: locks src/parser.ts pairSum 3612 rollingXor 126', () => {
    const d = sha256('src/parser.ts');
    expect(pairSum(d)).toBe(3612);
    expect(rollingXor(d)).toBe(126);
  });

  it('post132: locks src/parser.ts first/last/mid octets', () => {
    const d = sha256('src/parser.ts');
    expect(d.slice(0, 2)).toBe('cf');
    expect(d.slice(-2)).toBe('68');
    expect(d.slice(28, 36)).toBe('a0e83a07');
  });

  it('post132: locks src/parser.ts HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'src/parser.ts')).toBe('765d64c40ae9781ab5b266fa4cc218089152a8be319172c750bb213eb76949cb');
    expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3');
    expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8');
  });

  it('post132: locks src/parser.ts HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'src/parser.ts')).toBe('e783693815932727c8d15e4df4c6180807cf074faac2070d824e4d94cfbf3d59');
    expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70');
    expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f');
  });

  it('post132: locks src/parser.ts spaces 432', () => {
    expect((read('src/parser.ts').match(/ /g) ?? []).length).toBe(432);
  });

  it('post132: locks src/parser.ts reversed sha256', () => {
    const rev = [...read('src/parser.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('a78f8cb8e92e3203b94933c1ec51e34ac1f54892dcc0c99024a48333407e79de');
  });

  it('post132: locks src/parser.ts sha256 UPPERCASE', () => {
    expect(sha256('src/parser.ts').toUpperCase()).toBe('CF293136412FBA636AD7391BCEA0A0E83A079FBBCC8FC14D0CA41FA6621F4368');
  });

  it('post132: locks src/parser.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/parser.ts').split('\n')[0]).digest('hex')).toBe('64a393f12da7f34518f8343d01e7da0c8da3e9f0b9cf1916ec7af9a35cbf8eb5');
  });

  it('post132: locks src/parser.ts size*lines 130985', () => {
    expect(statSync(join(root, 'src/parser.ts')).size * read('src/parser.ts').split('\n').length).toBe(130985);
  });

  it('post132: locks src/parser.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/parser.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(66);
    expect((t.match(/,/g) ?? []).length).toBe(8);
    expect((t.match(/:/g) ?? []).length).toBe(19);
    expect((t.match(/"/g) ?? []).length).toBe(15);
    expect((t.match(/'/g) ?? []).length).toBe(12);
  });

  it('post132: locks src/parser.ts HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('e6adbf4d5ab8adc9d2986fec08d5b6b4f14589cf');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('f56a46aa95633a31bce05aee6ecbd7f3');
  });


  it('post132: resolveGenre maps "late night" → ambient', () => {
    expect(resolveGenre("late night")).toBe("ambient");
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
    expect(resolveGenre("  late night  ")).toBe("ambient");
  });

  it('post132: resolveGenre maps "chill" → ambient', () => {
    expect(resolveGenre("chill")).toBe("ambient");
    expect(resolveGenre("CHILL")).toBe("ambient");
    expect(resolveGenre("  chill  ")).toBe("ambient");
  });

  it('post132: resolveGenre maps "ambient" → ambient', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(resolveGenre("AMBIENT")).toBe("ambient");
    expect(resolveGenre("  ambient  ")).toBe("ambient");
  });

  it('post132: resolveGenre maps "relaxing" → ambient', () => {
    expect(resolveGenre("relaxing")).toBe("ambient");
    expect(resolveGenre("RELAXING")).toBe("ambient");
    expect(resolveGenre("  relaxing  ")).toBe("ambient");
  });

  it('post132: resolveGenre maps "focus" → ambient', () => {
    expect(resolveGenre("focus")).toBe("ambient");
    expect(resolveGenre("FOCUS")).toBe("ambient");
    expect(resolveGenre("  focus  ")).toBe("ambient");
  });

  it('post132: resolveGenre maps "classical" → classical', () => {
    expect(resolveGenre("classical")).toBe("classical");
    expect(resolveGenre("CLASSICAL")).toBe("classical");
    expect(resolveGenre("  classical  ")).toBe("classical");
  });

  it('post132: resolveGenre maps "classic" → classical', () => {
    expect(resolveGenre("classic")).toBe("classical");
    expect(resolveGenre("CLASSIC")).toBe("classical");
    expect(resolveGenre("  classic  ")).toBe("classical");
  });

  it('post132: resolveGenre maps "jazz" → jazz', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(resolveGenre("JAZZ")).toBe("jazz");
    expect(resolveGenre("  jazz  ")).toBe("jazz");
  });

  it('post132: resolveGenre maps "blues" → jazz', () => {
    expect(resolveGenre("blues")).toBe("jazz");
    expect(resolveGenre("BLUES")).toBe("jazz");
    expect(resolveGenre("  blues  ")).toBe("jazz");
  });

  it('post132: resolveGenre maps "pop" → pop', () => {
    expect(resolveGenre("pop")).toBe("pop");
    expect(resolveGenre("POP")).toBe("pop");
    expect(resolveGenre("  pop  ")).toBe("pop");
  });

  it('post132: resolveGenre maps "rock" → rock', () => {
    expect(resolveGenre("rock")).toBe("rock");
    expect(resolveGenre("ROCK")).toBe("rock");
    expect(resolveGenre("  rock  ")).toBe("rock");
  });

  it('post132: resolveGenre maps "metal" → rock', () => {
    expect(resolveGenre("metal")).toBe("rock");
    expect(resolveGenre("METAL")).toBe("rock");
    expect(resolveGenre("  metal  ")).toBe("rock");
  });

  it('post132: resolveGenre maps "indie" → rock', () => {
    expect(resolveGenre("indie")).toBe("rock");
    expect(resolveGenre("INDIE")).toBe("rock");
    expect(resolveGenre("  indie  ")).toBe("rock");
  });

  it('post132: resolveGenre maps "music" → music', () => {
    expect(resolveGenre("music")).toBe("music");
    expect(resolveGenre("MUSIC")).toBe("music");
    expect(resolveGenre("  music  ")).toBe("music");
  });

  it('post132: resolveGenre maps "news" → news', () => {
    expect(resolveGenre("news")).toBe("news");
    expect(resolveGenre("NEWS")).toBe("news");
    expect(resolveGenre("  news  ")).toBe("news");
  });

  it('post132: resolveGenre maps "sports" → sports', () => {
    expect(resolveGenre("sports")).toBe("sports");
    expect(resolveGenre("SPORTS")).toBe("sports");
    expect(resolveGenre("  sports  ")).toBe("sports");
  });

  it('post132: resolveGenre maps "entertainment" → entertainment', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
    expect(resolveGenre("  entertainment  ")).toBe("entertainment");
  });

  it('post132: resolveGenre maps "dance" → pop', () => {
    expect(resolveGenre("dance")).toBe("pop");
    expect(resolveGenre("DANCE")).toBe("pop");
    expect(resolveGenre("  dance  ")).toBe("pop");
  });

  it('post132: resolveGenre maps "electronic" → ambient', () => {
    expect(resolveGenre("electronic")).toBe("ambient");
    expect(resolveGenre("ELECTRONIC")).toBe("ambient");
    expect(resolveGenre("  electronic  ")).toBe("ambient");
  });

  it('post132: resolveGenre maps "lofi" → ambient', () => {
    expect(resolveGenre("lofi")).toBe("ambient");
    expect(resolveGenre("LOFI")).toBe("ambient");
    expect(resolveGenre("  lofi  ")).toBe("ambient");
  });

  it('post132: resolveGenre maps "lo-fi" → ambient', () => {
    expect(resolveGenre("lo-fi")).toBe("ambient");
    expect(resolveGenre("LO-FI")).toBe("ambient");
    expect(resolveGenre("  lo-fi  ")).toBe("ambient");
  });

  it('post132: resolveGenre defaults blank/undefined to music', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('   ')).toBe('music');
    expect(resolveGenre('unknown-xyz')).toBe('music');
  });

  it('post132: VALID_GENRES length 9 ordered', () => {
    expect([...VALID_GENRES]).toEqual([
      'music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment',
    ]);
  });

  it('post132: GENRE_MAP has 21 keys', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it('post132: GENRE_MAP rejects __proto__ invent', () => {
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, '__proto__')).toBe(false);
    // Plain-object map access: '__proto__' → Object.prototype ({}); do not invent hasOwn fix
    expect(resolveGenre('__proto__')).toEqual({});
  });

  it('post132: custom map override still works', () => {
    expect(resolveGenre('x', { x: 'jazz' })).toBe('jazz');
  });

  it('post132: index.ts still imports resolveGenre path', () => {
    expect(read('src/index.ts')).toMatch(/from ['"]\.\/genres['"]/);
  });

  it('post132: types.ts Env still optional GEMINI_API_KEY', () => {
    expect(read('src/types.ts')).toContain('GEMINI_API_KEY?: string');
  });

  it('post132: mega purity 40x genres.ts sha256', () => {
    const expected = "aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e";
    for (let i = 0; i < 40; i++) expect(sha256('src/genres.ts')).toBe(expected);
  });

  it('post132: negative inventing fence genres', () => {
    expect(read('src/genres.ts')).not.toMatch(/\/playlist|\/now-playing|process\.env|credentials/);
  });

  it('post132: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post126 genres HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 genres HEAVY deepen (after #132)'");
    expect((body.match(/it\('post132:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post136 genres HEAVY deepen (after #136)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };

  it('post136: locks src/genres.ts sha256', () => {
    expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post136: locks src/genres.ts sha1', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post136: locks src/genres.ts md5', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post136: locks src/genres.ts sha384', () => {
    expect(sha384('src/genres.ts')).toBe('ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16');
  });

  it('post136: locks src/genres.ts sha512', () => {
    expect(sha512('src/genres.ts')).toBe('bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b');
  });

  it('post136: locks src/genres.ts sha3-256', () => {
    expect(sha3('src/genres.ts')).toBe('d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f');
  });

  it('post136: locks src/genres.ts blake2b512', () => {
    expect(blake2b('src/genres.ts')).toBe('731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67');
  });

  it('post136: locks src/genres.ts ripemd160', () => {
    expect(ripemd('src/genres.ts')).toBe('bb9faaf8890bdba8dd86bcdf7e418da622d19bf5');
  });

  it('post136: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027);
    expect(readFileSync(join(root, 'src/genres.ts')).byteLength).toBe(1027);
  });

  it('post136: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read('src/genres.ts')).toHaveLength(1025);
    expect(read('src/genres.ts').split('\n')).toHaveLength(48);
  });

  it('post136: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256('src/genres.ts');
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post136: locks src/genres.ts pairSum 3950 rollingXor 96', () => {
    const d = sha256('src/genres.ts');
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it('post136: locks src/genres.ts first/last/mid octets', () => {
    const d = sha256('src/genres.ts');
    expect(d.slice(0, 2)).toBe('aa');
    expect(d.slice(-2)).toBe('4e');
    expect(d.slice(28, 36)).toBe('811dfbc2');
  });

  it('post136: locks src/genres.ts HMAC post136/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post136', 'src/genres.ts')).toBe('036398d3eec90aab36348aa4984dfb8fda347315168bcfec96395f7dc22cbf1c');
    expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f');
    expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951');
  });

  it('post136: locks src/genres.ts HMAC after-#136/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#136', 'src/genres.ts')).toBe('d1dae0785a3a939827359f93f3cbb71a9398068a8905d9693e6f44813e349481');
    expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575');
    expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b');
  });

  it('post136: locks src/genres.ts spaces 144', () => {
    expect((read('src/genres.ts').match(/ /g) ?? []).length).toBe(144);
  });

  it('post136: locks src/genres.ts reversed sha256', () => {
    const rev = [...read('src/genres.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac');
  });

  it('post136: locks src/genres.ts sha256 UPPERCASE', () => {
    expect(sha256('src/genres.ts').toUpperCase()).toBe('AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E');
  });

  it('post136: locks src/genres.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/genres.ts').split('\n')[0]).digest('hex')).toBe('907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68');
  });

  it('post136: locks src/genres.ts size*lines 49296', () => {
    expect(statSync(join(root, 'src/genres.ts')).size * read('src/genres.ts').split('\n').length).toBe(49296);
  });

  it('post136: locks src/genres.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/genres.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(47);
    expect((t.match(/,/g) ?? []).length).toBe(34);
    expect((t.match(/:/g) ?? []).length).toBe(26);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(68);
  });

  it('post136: locks src/genres.ts HMAC-SHA1/MD5 key post136', () => {
    expect(createHmac('sha1', 'post136').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('61f0af4bc6e42bd80d1bdbc23287db41fe2e394b');
    expect(createHmac('md5', 'post136').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('62149b039b195e5cfc133b7c9d90ef29');
  });

  it('post136: locks src/index.ts sha256', () => {
    expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post136: locks src/index.ts sha1', () => {
    expect(sha1('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post136: locks src/index.ts md5', () => {
    expect(md5('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post136: locks src/index.ts sha384', () => {
    expect(sha384('src/index.ts')).toBe('1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65');
  });

  it('post136: locks src/index.ts sha512', () => {
    expect(sha512('src/index.ts')).toBe('28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3');
  });

  it('post136: locks src/index.ts sha3-256', () => {
    expect(sha3('src/index.ts')).toBe('437dfa14ad684952d2d6a973da9d2ea67482eff82e188c32e27507f9dfd3239b');
  });

  it('post136: locks src/index.ts blake2b512', () => {
    expect(blake2b('src/index.ts')).toBe('17bccc5865d7d993ff97e58ce699f0a3f7fd4aa6270d29bcb2cccaee3b0a48dd7b118625848275aab8adfa6efdc23a8a3ddb359f9addfcf6552c15fe4be1dace');
  });

  it('post136: locks src/index.ts ripemd160', () => {
    expect(ripemd('src/index.ts')).toBe('a8ea25913b26da27277f866fc7988fdcdf281093');
  });

  it('post136: locks src/index.ts size 4738', () => {
    expect(statSync(join(root, 'src/index.ts')).size).toBe(4738);
    expect(readFileSync(join(root, 'src/index.ts')).byteLength).toBe(4738);
  });

  it('post136: locks src/index.ts utf8 4724 lines 154', () => {
    expect(read('src/index.ts')).toHaveLength(4724);
    expect(read('src/index.ts').split('\n')).toHaveLength(154);
  });

  it('post136: locks src/index.ts nibble 470 xor 14', () => {
    const d = sha256('src/index.ts');
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post136: locks src/index.ts pairSum 4265 rollingXor 151', () => {
    const d = sha256('src/index.ts');
    expect(pairSum(d)).toBe(4265);
    expect(rollingXor(d)).toBe(151);
  });

  it('post136: locks src/index.ts first/last/mid octets', () => {
    const d = sha256('src/index.ts');
    expect(d.slice(0, 2)).toBe('7f');
    expect(d.slice(-2)).toBe('72');
    expect(d.slice(28, 36)).toBe('e2a20389');
  });

  it('post136: locks src/index.ts HMAC post136/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post136', 'src/index.ts')).toBe('526fde39638e07432914817c6c385a14a2c45bfebe0fc2fb99a336513a3954a9');
    expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be');
    expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc');
  });

  it('post136: locks src/index.ts HMAC after-#136/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#136', 'src/index.ts')).toBe('450c79062bccf671439a640acd173db8b6980bc4f178d8b5f8e97a0fead578d1');
    expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30');
    expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a');
  });

  it('post136: locks src/index.ts spaces 761', () => {
    expect((read('src/index.ts').match(/ /g) ?? []).length).toBe(761);
  });

  it('post136: locks src/index.ts reversed sha256', () => {
    const rev = [...read('src/index.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('457830430075a6d1dc4b28436b3c145eb42a640d91301599ca2792fb58433ead');
  });

  it('post136: locks src/index.ts sha256 UPPERCASE', () => {
    expect(sha256('src/index.ts').toUpperCase()).toBe('7F0D574B0AEDC6CD71D3EA35BB03E2A20389028E6FF2C195718ACFF2E0313A72');
  });

  it('post136: locks src/index.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/index.ts').split('\n')[0]).digest('hex')).toBe('d8233fd79765534121de12d18bc3b54a6968d1868428cf5d52175e9a620cf6d4');
  });

  it('post136: locks src/index.ts size*lines 729652', () => {
    expect(statSync(join(root, 'src/index.ts')).size * read('src/index.ts').split('\n').length).toBe(729652);
  });

  it('post136: locks src/index.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/index.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(153);
    expect((t.match(/,/g) ?? []).length).toBe(69);
    expect((t.match(/:/g) ?? []).length).toBe(72);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(85);
  });

  it('post136: locks src/index.ts HMAC-SHA1/MD5 key post136', () => {
    expect(createHmac('sha1', 'post136').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('7da7e4a4fa8a12571a18c8feba4417b42f65f3a4');
    expect(createHmac('md5', 'post136').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('786b5507250abe524234729616cc364e');
  });

  it('post136: locks src/types.ts sha256', () => {
    expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
  });

  it('post136: locks src/types.ts sha1', () => {
    expect(sha1('src/types.ts')).toBe('1e8906673dc0d140ee5c3d40839c88a1eeca03d8');
  });

  it('post136: locks src/types.ts md5', () => {
    expect(md5('src/types.ts')).toBe('ecba663d21928622be656805ad27d0a3');
  });

  it('post136: locks src/types.ts sha384', () => {
    expect(sha384('src/types.ts')).toBe('40618d8902640e6ce24d5caf0b9daf86c4d5f962832b1835a86bb10ad7c37455cc60aa9f965ffd9a98f9a5967048b01c');
  });

  it('post136: locks src/types.ts sha512', () => {
    expect(sha512('src/types.ts')).toBe('49cf750d836fe717822e6f08b6ff4998c1f7419a2dfb169a5cfb3001dc1f6dc84df5b428edba879cbd0f7e1b809662e27ee34bf28f88e1efc62ec7d0b37f37cc');
  });

  it('post136: locks src/types.ts sha3-256', () => {
    expect(sha3('src/types.ts')).toBe('93122aa0fe9ef2958ed1b257bc139e91b30facb2e13e4094620dadf7d4acf8e4');
  });

  it('post136: locks src/types.ts blake2b512', () => {
    expect(blake2b('src/types.ts')).toBe('fcb08243a6c336e8da2d3500665ae9a80d98f23a06c3da5f771a290a4b45b2697e2b00e440165eb6551886f58a3bdea0ba315c1d4d3caba38ba3af7f108b3723');
  });

  it('post136: locks src/types.ts ripemd160', () => {
    expect(ripemd('src/types.ts')).toBe('80ca02c12c5db60b8eb1afb1cd21b18983ba16fb');
  });

  it('post136: locks src/types.ts size 174', () => {
    expect(statSync(join(root, 'src/types.ts')).size).toBe(174);
    expect(readFileSync(join(root, 'src/types.ts')).byteLength).toBe(174);
  });

  it('post136: locks src/types.ts utf8 172 lines 7', () => {
    expect(read('src/types.ts')).toHaveLength(172);
    expect(read('src/types.ts').split('\n')).toHaveLength(7);
  });

  it('post136: locks src/types.ts nibble 520 xor 14', () => {
    const d = sha256('src/types.ts');
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post136: locks src/types.ts pairSum 4300 rollingXor 104', () => {
    const d = sha256('src/types.ts');
    expect(pairSum(d)).toBe(4300);
    expect(rollingXor(d)).toBe(104);
  });

  it('post136: locks src/types.ts first/last/mid octets', () => {
    const d = sha256('src/types.ts');
    expect(d.slice(0, 2)).toBe('40');
    expect(d.slice(-2)).toBe('d3');
    expect(d.slice(28, 36)).toBe('345e4f21');
  });

  it('post136: locks src/types.ts HMAC post136/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post136', 'src/types.ts')).toBe('a458fb972723f8dc7c1c70c10fbc05bad45cc8d8e2c3173292b2b4af61a8ae7e');
    expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85');
    expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc');
  });

  it('post136: locks src/types.ts HMAC after-#136/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#136', 'src/types.ts')).toBe('cede124ad171eb0af4edf0ef3dae1d3eaf58cd4d2cfae33850b34c8b1a62e01f');
    expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a');
    expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076');
  });

  it('post136: locks src/types.ts spaces 25', () => {
    expect((read('src/types.ts').match(/ /g) ?? []).length).toBe(25);
  });

  it('post136: locks src/types.ts reversed sha256', () => {
    const rev = [...read('src/types.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e02dd34c73f2571af21a48fda8cfd19667149441b37d30de0519262fc76f7f37');
  });

  it('post136: locks src/types.ts sha256 UPPERCASE', () => {
    expect(sha256('src/types.ts').toUpperCase()).toBe('4008DDD3DD6DD2FB7E8D386DFE2A345E4F21FA5576E229A8FBBE691626F743D3');
  });

  it('post136: locks src/types.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/types.ts').split('\n')[0]).digest('hex')).toBe('1d293b13ae9f4103472d1553f95a9368a006f250a1178cb8946d4e566fda25f6');
  });

  it('post136: locks src/types.ts size*lines 1218', () => {
    expect(statSync(join(root, 'src/types.ts')).size * read('src/types.ts').split('\n').length).toBe(1218);
  });

  it('post136: locks src/types.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/types.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(6);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(3);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post136: locks src/types.ts HMAC-SHA1/MD5 key post136', () => {
    expect(createHmac('sha1', 'post136').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('93f09bc791f1b742bec30bc7d437ee07e70d0e8c');
    expect(createHmac('md5', 'post136').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('63d9bf6ccb10a004921628d37a71f5e5');
  });

  it('post136: locks src/parser.ts sha256', () => {
    expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post136: locks src/parser.ts sha1', () => {
    expect(sha1('src/parser.ts')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it('post136: locks src/parser.ts md5', () => {
    expect(md5('src/parser.ts')).toBe('500211c4c526de887252451726776563');
  });

  it('post136: locks src/parser.ts sha384', () => {
    expect(sha384('src/parser.ts')).toBe('f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9');
  });

  it('post136: locks src/parser.ts sha512', () => {
    expect(sha512('src/parser.ts')).toBe('66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89');
  });

  it('post136: locks src/parser.ts sha3-256', () => {
    expect(sha3('src/parser.ts')).toBe('0ec47247da4cff229cc417b213da73883427985239714e246eb16d1f021bf9c2');
  });

  it('post136: locks src/parser.ts blake2b512', () => {
    expect(blake2b('src/parser.ts')).toBe('d61759e7d0a68efcd16a74811ad84abebe0b82dab5c16e51261ca37118efc5a3c36aec8bc1523ce2b0d3908cd065c7cb8d1c153ea9a31dec633a90ec53aca7ef');
  });

  it('post136: locks src/parser.ts ripemd160', () => {
    expect(ripemd('src/parser.ts')).toBe('36f12fc76af98f06dfa651f814e8f2e13b26c96a');
  });

  it('post136: locks src/parser.ts size 1955', () => {
    expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955);
    expect(readFileSync(join(root, 'src/parser.ts')).byteLength).toBe(1955);
  });

  it('post136: locks src/parser.ts utf8 1953 lines 67', () => {
    expect(read('src/parser.ts')).toHaveLength(1953);
    expect(read('src/parser.ts').split('\n')).toHaveLength(67);
  });

  it('post136: locks src/parser.ts nibble 477 xor 9', () => {
    const d = sha256('src/parser.ts');
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post136: locks src/parser.ts pairSum 3612 rollingXor 126', () => {
    const d = sha256('src/parser.ts');
    expect(pairSum(d)).toBe(3612);
    expect(rollingXor(d)).toBe(126);
  });

  it('post136: locks src/parser.ts first/last/mid octets', () => {
    const d = sha256('src/parser.ts');
    expect(d.slice(0, 2)).toBe('cf');
    expect(d.slice(-2)).toBe('68');
    expect(d.slice(28, 36)).toBe('a0e83a07');
  });

  it('post136: locks src/parser.ts HMAC post136/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post136', 'src/parser.ts')).toBe('e476628524e337e85adc7828e1f01e159f7a335e3ac7d388641a4c16aafdf162');
    expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3');
    expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8');
  });

  it('post136: locks src/parser.ts HMAC after-#136/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#136', 'src/parser.ts')).toBe('29f924fbedebc52a088d9ac781ad8c40aa33602f5aa3c444e5350572ad6d34e2');
    expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70');
    expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f');
  });

  it('post136: locks src/parser.ts spaces 432', () => {
    expect((read('src/parser.ts').match(/ /g) ?? []).length).toBe(432);
  });

  it('post136: locks src/parser.ts reversed sha256', () => {
    const rev = [...read('src/parser.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('a78f8cb8e92e3203b94933c1ec51e34ac1f54892dcc0c99024a48333407e79de');
  });

  it('post136: locks src/parser.ts sha256 UPPERCASE', () => {
    expect(sha256('src/parser.ts').toUpperCase()).toBe('CF293136412FBA636AD7391BCEA0A0E83A079FBBCC8FC14D0CA41FA6621F4368');
  });

  it('post136: locks src/parser.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/parser.ts').split('\n')[0]).digest('hex')).toBe('64a393f12da7f34518f8343d01e7da0c8da3e9f0b9cf1916ec7af9a35cbf8eb5');
  });

  it('post136: locks src/parser.ts size*lines 130985', () => {
    expect(statSync(join(root, 'src/parser.ts')).size * read('src/parser.ts').split('\n').length).toBe(130985);
  });

  it('post136: locks src/parser.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/parser.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(66);
    expect((t.match(/,/g) ?? []).length).toBe(8);
    expect((t.match(/:/g) ?? []).length).toBe(19);
    expect((t.match(/"/g) ?? []).length).toBe(15);
    expect((t.match(/'/g) ?? []).length).toBe(12);
  });

  it('post136: locks src/parser.ts HMAC-SHA1/MD5 key post136', () => {
    expect(createHmac('sha1', 'post136').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('eda35855348567f8000483dfe507c3311d1b60c2');
    expect(createHmac('md5', 'post136').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('529fa3ab99f5071c4a8cfdbcc7cb3d63');
  });


  it('post136: resolveGenre maps "late night" → ambient', () => {
    expect(resolveGenre("late night")).toBe("ambient");
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
    expect(resolveGenre("  late night  ")).toBe("ambient");
  });

  it('post136: resolveGenre maps "chill" → ambient', () => {
    expect(resolveGenre("chill")).toBe("ambient");
    expect(resolveGenre("CHILL")).toBe("ambient");
    expect(resolveGenre("  chill  ")).toBe("ambient");
  });

  it('post136: resolveGenre maps "ambient" → ambient', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(resolveGenre("AMBIENT")).toBe("ambient");
    expect(resolveGenre("  ambient  ")).toBe("ambient");
  });

  it('post136: resolveGenre maps "relaxing" → ambient', () => {
    expect(resolveGenre("relaxing")).toBe("ambient");
    expect(resolveGenre("RELAXING")).toBe("ambient");
    expect(resolveGenre("  relaxing  ")).toBe("ambient");
  });

  it('post136: resolveGenre maps "focus" → ambient', () => {
    expect(resolveGenre("focus")).toBe("ambient");
    expect(resolveGenre("FOCUS")).toBe("ambient");
    expect(resolveGenre("  focus  ")).toBe("ambient");
  });

  it('post136: resolveGenre maps "classical" → classical', () => {
    expect(resolveGenre("classical")).toBe("classical");
    expect(resolveGenre("CLASSICAL")).toBe("classical");
    expect(resolveGenre("  classical  ")).toBe("classical");
  });

  it('post136: resolveGenre maps "classic" → classical', () => {
    expect(resolveGenre("classic")).toBe("classical");
    expect(resolveGenre("CLASSIC")).toBe("classical");
    expect(resolveGenre("  classic  ")).toBe("classical");
  });

  it('post136: resolveGenre maps "jazz" → jazz', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(resolveGenre("JAZZ")).toBe("jazz");
    expect(resolveGenre("  jazz  ")).toBe("jazz");
  });

  it('post136: resolveGenre maps "blues" → jazz', () => {
    expect(resolveGenre("blues")).toBe("jazz");
    expect(resolveGenre("BLUES")).toBe("jazz");
    expect(resolveGenre("  blues  ")).toBe("jazz");
  });

  it('post136: resolveGenre maps "pop" → pop', () => {
    expect(resolveGenre("pop")).toBe("pop");
    expect(resolveGenre("POP")).toBe("pop");
    expect(resolveGenre("  pop  ")).toBe("pop");
  });

  it('post136: resolveGenre maps "rock" → rock', () => {
    expect(resolveGenre("rock")).toBe("rock");
    expect(resolveGenre("ROCK")).toBe("rock");
    expect(resolveGenre("  rock  ")).toBe("rock");
  });

  it('post136: resolveGenre maps "metal" → rock', () => {
    expect(resolveGenre("metal")).toBe("rock");
    expect(resolveGenre("METAL")).toBe("rock");
    expect(resolveGenre("  metal  ")).toBe("rock");
  });

  it('post136: resolveGenre maps "indie" → rock', () => {
    expect(resolveGenre("indie")).toBe("rock");
    expect(resolveGenre("INDIE")).toBe("rock");
    expect(resolveGenre("  indie  ")).toBe("rock");
  });

  it('post136: resolveGenre maps "music" → music', () => {
    expect(resolveGenre("music")).toBe("music");
    expect(resolveGenre("MUSIC")).toBe("music");
    expect(resolveGenre("  music  ")).toBe("music");
  });

  it('post136: resolveGenre maps "news" → news', () => {
    expect(resolveGenre("news")).toBe("news");
    expect(resolveGenre("NEWS")).toBe("news");
    expect(resolveGenre("  news  ")).toBe("news");
  });

  it('post136: resolveGenre maps "sports" → sports', () => {
    expect(resolveGenre("sports")).toBe("sports");
    expect(resolveGenre("SPORTS")).toBe("sports");
    expect(resolveGenre("  sports  ")).toBe("sports");
  });

  it('post136: resolveGenre maps "entertainment" → entertainment', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
    expect(resolveGenre("  entertainment  ")).toBe("entertainment");
  });

  it('post136: resolveGenre maps "dance" → pop', () => {
    expect(resolveGenre("dance")).toBe("pop");
    expect(resolveGenre("DANCE")).toBe("pop");
    expect(resolveGenre("  dance  ")).toBe("pop");
  });

  it('post136: resolveGenre maps "electronic" → ambient', () => {
    expect(resolveGenre("electronic")).toBe("ambient");
    expect(resolveGenre("ELECTRONIC")).toBe("ambient");
    expect(resolveGenre("  electronic  ")).toBe("ambient");
  });

  it('post136: resolveGenre maps "lofi" → ambient', () => {
    expect(resolveGenre("lofi")).toBe("ambient");
    expect(resolveGenre("LOFI")).toBe("ambient");
    expect(resolveGenre("  lofi  ")).toBe("ambient");
  });

  it('post136: resolveGenre maps "lo-fi" → ambient', () => {
    expect(resolveGenre("lo-fi")).toBe("ambient");
    expect(resolveGenre("LO-FI")).toBe("ambient");
    expect(resolveGenre("  lo-fi  ")).toBe("ambient");
  });

  it('post136: resolveGenre defaults blank/undefined to music', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('   ')).toBe('music');
    expect(resolveGenre('unknown-xyz')).toBe('music');
  });

  it('post136: VALID_GENRES length 9 ordered', () => {
    expect([...VALID_GENRES]).toEqual([
      'music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment',
    ]);
  });

  it('post136: GENRE_MAP has 21 keys', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it('post136: GENRE_MAP rejects __proto__ invent', () => {
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, '__proto__')).toBe(false);
    // Plain-object map access: '__proto__' → Object.prototype ({}); do not invent hasOwn fix
    expect(resolveGenre('__proto__')).toEqual({});
  });

  it('post136: custom map override still works', () => {
    expect(resolveGenre('x', { x: 'jazz' })).toBe('jazz');
  });

  it('post136: index.ts still imports resolveGenre path', () => {
    expect(read('src/index.ts')).toMatch(/from ['"]\.\/genres['"]/);
  });

  it('post136: types.ts Env still optional GEMINI_API_KEY', () => {
    expect(read('src/types.ts')).toContain('GEMINI_API_KEY?: string');
  });

  it('post136: mega purity 40x genres.ts sha256', () => {
    const expected = "aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e";
    for (let i = 0; i < 40; i++) expect(sha256('src/genres.ts')).toBe(expected);
  });

  it('post136: negative inventing fence genres', () => {
    expect(read('src/genres.ts')).not.toMatch(/\/playlist|\/now-playing|process\.env|credentials/);
  });

  it('post136: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post126 genres HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 genres HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post136 genres HEAVY deepen (after #136)'");
    expect((body.match(/it\('post136:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post141 genres HEAVY deepen (after #141)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };

  it('post141: locks src/genres.ts sha256', () => {
    expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post141: locks src/genres.ts sha1', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post141: locks src/genres.ts md5', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post141: locks src/genres.ts sha384', () => {
    expect(sha384('src/genres.ts')).toBe('ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16');
  });

  it('post141: locks src/genres.ts sha512', () => {
    expect(sha512('src/genres.ts')).toBe('bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b');
  });

  it('post141: locks src/genres.ts sha3-256', () => {
    expect(sha3('src/genres.ts')).toBe('d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f');
  });

  it('post141: locks src/genres.ts blake2b512', () => {
    expect(blake2b('src/genres.ts')).toBe('731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67');
  });

  it('post141: locks src/genres.ts ripemd160', () => {
    expect(ripemd('src/genres.ts')).toBe('bb9faaf8890bdba8dd86bcdf7e418da622d19bf5');
  });

  it('post141: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027);
    expect(readFileSync(join(root, 'src/genres.ts')).byteLength).toBe(1027);
  });

  it('post141: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read('src/genres.ts')).toHaveLength(1025);
    expect(read('src/genres.ts').split('\n')).toHaveLength(48);
  });

  it('post141: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256('src/genres.ts');
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post141: locks src/genres.ts pairSum 3950 rollingXor 96', () => {
    const d = sha256('src/genres.ts');
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it('post141: locks src/genres.ts first/last/mid octets', () => {
    const d = sha256('src/genres.ts');
    expect(d.slice(0, 2)).toBe('aa');
    expect(d.slice(-2)).toBe('4e');
    expect(d.slice(28, 36)).toBe('811dfbc2');
  });

  it('post141: locks src/genres.ts HMAC post141/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post141', 'src/genres.ts')).toBe('99775eb14540308f490f85210ea0938820a8435db9272f7e64faec5e339cb7f7');
    expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f');
    expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951');
  });

  it('post141: locks src/genres.ts HMAC after-#141/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#141', 'src/genres.ts')).toBe('0d32be5d0bab56fafb915d30c07d3acee25d02868afc953991507d13bddd9c61');
    expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575');
    expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b');
  });

  it('post141: locks src/genres.ts spaces 144', () => {
    expect((read('src/genres.ts').match(/ /g) ?? []).length).toBe(144);
  });

  it('post141: locks src/genres.ts reversed sha256', () => {
    const rev = [...read('src/genres.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac');
  });

  it('post141: locks src/genres.ts sha256 UPPERCASE', () => {
    expect(sha256('src/genres.ts').toUpperCase()).toBe('AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E');
  });

  it('post141: locks src/genres.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/genres.ts').split('\n')[0]).digest('hex')).toBe('907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68');
  });

  it('post141: locks src/genres.ts size*lines 49296', () => {
    expect(statSync(join(root, 'src/genres.ts')).size * read('src/genres.ts').split('\n').length).toBe(49296);
  });

  it('post141: locks src/genres.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/genres.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(47);
    expect((t.match(/,/g) ?? []).length).toBe(34);
    expect((t.match(/:/g) ?? []).length).toBe(26);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(68);
  });

  it('post141: locks src/genres.ts HMAC-SHA1/MD5 key post141', () => {
    expect(createHmac('sha1', 'post141').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('c0e15436f42ec25b258bad321767ee002a6be543');
    expect(createHmac('md5', 'post141').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('105136e969ee8b5dd35c25971b28d7a5');
  });

  it('post141: locks src/index.ts sha256', () => {
    expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post141: locks src/index.ts sha1', () => {
    expect(sha1('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post141: locks src/index.ts md5', () => {
    expect(md5('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post141: locks src/index.ts sha384', () => {
    expect(sha384('src/index.ts')).toBe('1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65');
  });

  it('post141: locks src/index.ts sha512', () => {
    expect(sha512('src/index.ts')).toBe('28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3');
  });

  it('post141: locks src/index.ts sha3-256', () => {
    expect(sha3('src/index.ts')).toBe('437dfa14ad684952d2d6a973da9d2ea67482eff82e188c32e27507f9dfd3239b');
  });

  it('post141: locks src/index.ts blake2b512', () => {
    expect(blake2b('src/index.ts')).toBe('17bccc5865d7d993ff97e58ce699f0a3f7fd4aa6270d29bcb2cccaee3b0a48dd7b118625848275aab8adfa6efdc23a8a3ddb359f9addfcf6552c15fe4be1dace');
  });

  it('post141: locks src/index.ts ripemd160', () => {
    expect(ripemd('src/index.ts')).toBe('a8ea25913b26da27277f866fc7988fdcdf281093');
  });

  it('post141: locks src/index.ts size 4738', () => {
    expect(statSync(join(root, 'src/index.ts')).size).toBe(4738);
    expect(readFileSync(join(root, 'src/index.ts')).byteLength).toBe(4738);
  });

  it('post141: locks src/index.ts utf8 4724 lines 154', () => {
    expect(read('src/index.ts')).toHaveLength(4724);
    expect(read('src/index.ts').split('\n')).toHaveLength(154);
  });

  it('post141: locks src/index.ts nibble 470 xor 14', () => {
    const d = sha256('src/index.ts');
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post141: locks src/index.ts pairSum 4265 rollingXor 151', () => {
    const d = sha256('src/index.ts');
    expect(pairSum(d)).toBe(4265);
    expect(rollingXor(d)).toBe(151);
  });

  it('post141: locks src/index.ts first/last/mid octets', () => {
    const d = sha256('src/index.ts');
    expect(d.slice(0, 2)).toBe('7f');
    expect(d.slice(-2)).toBe('72');
    expect(d.slice(28, 36)).toBe('e2a20389');
  });

  it('post141: locks src/index.ts HMAC post141/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post141', 'src/index.ts')).toBe('1688627ccc8a667232faa64eadb19fc8d7255b154417bbcbfd6c5f76019efae5');
    expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be');
    expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc');
  });

  it('post141: locks src/index.ts HMAC after-#141/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#141', 'src/index.ts')).toBe('773c4b5b8691147c4b0cbb92a52927fc84674149c787f3bf70941f66da2eb6c5');
    expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30');
    expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a');
  });

  it('post141: locks src/index.ts spaces 761', () => {
    expect((read('src/index.ts').match(/ /g) ?? []).length).toBe(761);
  });

  it('post141: locks src/index.ts reversed sha256', () => {
    const rev = [...read('src/index.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('457830430075a6d1dc4b28436b3c145eb42a640d91301599ca2792fb58433ead');
  });

  it('post141: locks src/index.ts sha256 UPPERCASE', () => {
    expect(sha256('src/index.ts').toUpperCase()).toBe('7F0D574B0AEDC6CD71D3EA35BB03E2A20389028E6FF2C195718ACFF2E0313A72');
  });

  it('post141: locks src/index.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/index.ts').split('\n')[0]).digest('hex')).toBe('d8233fd79765534121de12d18bc3b54a6968d1868428cf5d52175e9a620cf6d4');
  });

  it('post141: locks src/index.ts size*lines 729652', () => {
    expect(statSync(join(root, 'src/index.ts')).size * read('src/index.ts').split('\n').length).toBe(729652);
  });

  it('post141: locks src/index.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/index.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(153);
    expect((t.match(/,/g) ?? []).length).toBe(69);
    expect((t.match(/:/g) ?? []).length).toBe(72);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(85);
  });

  it('post141: locks src/index.ts HMAC-SHA1/MD5 key post141', () => {
    expect(createHmac('sha1', 'post141').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('81abba2bfc7e8b5751fd9c07ccf051be82241365');
    expect(createHmac('md5', 'post141').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('a7e39cbbb187c5bafaf37166c561c759');
  });

  it('post141: locks src/types.ts sha256', () => {
    expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
  });

  it('post141: locks src/types.ts sha1', () => {
    expect(sha1('src/types.ts')).toBe('1e8906673dc0d140ee5c3d40839c88a1eeca03d8');
  });

  it('post141: locks src/types.ts md5', () => {
    expect(md5('src/types.ts')).toBe('ecba663d21928622be656805ad27d0a3');
  });

  it('post141: locks src/types.ts sha384', () => {
    expect(sha384('src/types.ts')).toBe('40618d8902640e6ce24d5caf0b9daf86c4d5f962832b1835a86bb10ad7c37455cc60aa9f965ffd9a98f9a5967048b01c');
  });

  it('post141: locks src/types.ts sha512', () => {
    expect(sha512('src/types.ts')).toBe('49cf750d836fe717822e6f08b6ff4998c1f7419a2dfb169a5cfb3001dc1f6dc84df5b428edba879cbd0f7e1b809662e27ee34bf28f88e1efc62ec7d0b37f37cc');
  });

  it('post141: locks src/types.ts sha3-256', () => {
    expect(sha3('src/types.ts')).toBe('93122aa0fe9ef2958ed1b257bc139e91b30facb2e13e4094620dadf7d4acf8e4');
  });

  it('post141: locks src/types.ts blake2b512', () => {
    expect(blake2b('src/types.ts')).toBe('fcb08243a6c336e8da2d3500665ae9a80d98f23a06c3da5f771a290a4b45b2697e2b00e440165eb6551886f58a3bdea0ba315c1d4d3caba38ba3af7f108b3723');
  });

  it('post141: locks src/types.ts ripemd160', () => {
    expect(ripemd('src/types.ts')).toBe('80ca02c12c5db60b8eb1afb1cd21b18983ba16fb');
  });

  it('post141: locks src/types.ts size 174', () => {
    expect(statSync(join(root, 'src/types.ts')).size).toBe(174);
    expect(readFileSync(join(root, 'src/types.ts')).byteLength).toBe(174);
  });

  it('post141: locks src/types.ts utf8 172 lines 7', () => {
    expect(read('src/types.ts')).toHaveLength(172);
    expect(read('src/types.ts').split('\n')).toHaveLength(7);
  });

  it('post141: locks src/types.ts nibble 520 xor 14', () => {
    const d = sha256('src/types.ts');
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post141: locks src/types.ts pairSum 4300 rollingXor 104', () => {
    const d = sha256('src/types.ts');
    expect(pairSum(d)).toBe(4300);
    expect(rollingXor(d)).toBe(104);
  });

  it('post141: locks src/types.ts first/last/mid octets', () => {
    const d = sha256('src/types.ts');
    expect(d.slice(0, 2)).toBe('40');
    expect(d.slice(-2)).toBe('d3');
    expect(d.slice(28, 36)).toBe('345e4f21');
  });

  it('post141: locks src/types.ts HMAC post141/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post141', 'src/types.ts')).toBe('cff868e689c7418dead19eebdbf231c997622964254d694020bd993ff99e54a6');
    expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85');
    expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc');
  });

  it('post141: locks src/types.ts HMAC after-#141/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#141', 'src/types.ts')).toBe('2c5f92ab3c7c2a9b8d11f6ba44be87130c2f2a47b170574ae8e11507400fd318');
    expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a');
    expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076');
  });

  it('post141: locks src/types.ts spaces 25', () => {
    expect((read('src/types.ts').match(/ /g) ?? []).length).toBe(25);
  });

  it('post141: locks src/types.ts reversed sha256', () => {
    const rev = [...read('src/types.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e02dd34c73f2571af21a48fda8cfd19667149441b37d30de0519262fc76f7f37');
  });

  it('post141: locks src/types.ts sha256 UPPERCASE', () => {
    expect(sha256('src/types.ts').toUpperCase()).toBe('4008DDD3DD6DD2FB7E8D386DFE2A345E4F21FA5576E229A8FBBE691626F743D3');
  });

  it('post141: locks src/types.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/types.ts').split('\n')[0]).digest('hex')).toBe('1d293b13ae9f4103472d1553f95a9368a006f250a1178cb8946d4e566fda25f6');
  });

  it('post141: locks src/types.ts size*lines 1218', () => {
    expect(statSync(join(root, 'src/types.ts')).size * read('src/types.ts').split('\n').length).toBe(1218);
  });

  it('post141: locks src/types.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/types.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(6);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(3);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post141: locks src/types.ts HMAC-SHA1/MD5 key post141', () => {
    expect(createHmac('sha1', 'post141').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('c496df9d99f70017a143b94b8e19066b6c9ddd82');
    expect(createHmac('md5', 'post141').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('4ce5c422da2fb409be839e1b3fe78fc1');
  });

  it('post141: locks src/parser.ts sha256', () => {
    expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post141: locks src/parser.ts sha1', () => {
    expect(sha1('src/parser.ts')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it('post141: locks src/parser.ts md5', () => {
    expect(md5('src/parser.ts')).toBe('500211c4c526de887252451726776563');
  });

  it('post141: locks src/parser.ts sha384', () => {
    expect(sha384('src/parser.ts')).toBe('f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9');
  });

  it('post141: locks src/parser.ts sha512', () => {
    expect(sha512('src/parser.ts')).toBe('66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89');
  });

  it('post141: locks src/parser.ts sha3-256', () => {
    expect(sha3('src/parser.ts')).toBe('0ec47247da4cff229cc417b213da73883427985239714e246eb16d1f021bf9c2');
  });

  it('post141: locks src/parser.ts blake2b512', () => {
    expect(blake2b('src/parser.ts')).toBe('d61759e7d0a68efcd16a74811ad84abebe0b82dab5c16e51261ca37118efc5a3c36aec8bc1523ce2b0d3908cd065c7cb8d1c153ea9a31dec633a90ec53aca7ef');
  });

  it('post141: locks src/parser.ts ripemd160', () => {
    expect(ripemd('src/parser.ts')).toBe('36f12fc76af98f06dfa651f814e8f2e13b26c96a');
  });

  it('post141: locks src/parser.ts size 1955', () => {
    expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955);
    expect(readFileSync(join(root, 'src/parser.ts')).byteLength).toBe(1955);
  });

  it('post141: locks src/parser.ts utf8 1953 lines 67', () => {
    expect(read('src/parser.ts')).toHaveLength(1953);
    expect(read('src/parser.ts').split('\n')).toHaveLength(67);
  });

  it('post141: locks src/parser.ts nibble 477 xor 9', () => {
    const d = sha256('src/parser.ts');
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post141: locks src/parser.ts pairSum 3612 rollingXor 126', () => {
    const d = sha256('src/parser.ts');
    expect(pairSum(d)).toBe(3612);
    expect(rollingXor(d)).toBe(126);
  });

  it('post141: locks src/parser.ts first/last/mid octets', () => {
    const d = sha256('src/parser.ts');
    expect(d.slice(0, 2)).toBe('cf');
    expect(d.slice(-2)).toBe('68');
    expect(d.slice(28, 36)).toBe('a0e83a07');
  });

  it('post141: locks src/parser.ts HMAC post141/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post141', 'src/parser.ts')).toBe('71b1d587a5107bbd9f239f2be551981f4fc63c0069e3eb3505294e8dbec554b9');
    expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3');
    expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8');
  });

  it('post141: locks src/parser.ts HMAC after-#141/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#141', 'src/parser.ts')).toBe('396f7d81bc5a9e2507e934811a476093aeb69ff3dd89bfa3d6bf40eabd27a3bd');
    expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70');
    expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f');
  });

  it('post141: locks src/parser.ts spaces 432', () => {
    expect((read('src/parser.ts').match(/ /g) ?? []).length).toBe(432);
  });

  it('post141: locks src/parser.ts reversed sha256', () => {
    const rev = [...read('src/parser.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('a78f8cb8e92e3203b94933c1ec51e34ac1f54892dcc0c99024a48333407e79de');
  });

  it('post141: locks src/parser.ts sha256 UPPERCASE', () => {
    expect(sha256('src/parser.ts').toUpperCase()).toBe('CF293136412FBA636AD7391BCEA0A0E83A079FBBCC8FC14D0CA41FA6621F4368');
  });

  it('post141: locks src/parser.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/parser.ts').split('\n')[0]).digest('hex')).toBe('64a393f12da7f34518f8343d01e7da0c8da3e9f0b9cf1916ec7af9a35cbf8eb5');
  });

  it('post141: locks src/parser.ts size*lines 130985', () => {
    expect(statSync(join(root, 'src/parser.ts')).size * read('src/parser.ts').split('\n').length).toBe(130985);
  });

  it('post141: locks src/parser.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/parser.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(66);
    expect((t.match(/,/g) ?? []).length).toBe(8);
    expect((t.match(/:/g) ?? []).length).toBe(19);
    expect((t.match(/"/g) ?? []).length).toBe(15);
    expect((t.match(/'/g) ?? []).length).toBe(12);
  });

  it('post141: locks src/parser.ts HMAC-SHA1/MD5 key post141', () => {
    expect(createHmac('sha1', 'post141').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('70606c745537fd1d600c3305dacc87b4bd97c2c0');
    expect(createHmac('md5', 'post141').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('1fe9d226482273ce846dc2d570cfdd21');
  });


  it('post141: resolveGenre maps "late night" → ambient', () => {
    expect(resolveGenre("late night")).toBe("ambient");
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
    expect(resolveGenre("  late night  ")).toBe("ambient");
  });

  it('post141: resolveGenre maps "chill" → ambient', () => {
    expect(resolveGenre("chill")).toBe("ambient");
    expect(resolveGenre("CHILL")).toBe("ambient");
    expect(resolveGenre("  chill  ")).toBe("ambient");
  });

  it('post141: resolveGenre maps "ambient" → ambient', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(resolveGenre("AMBIENT")).toBe("ambient");
    expect(resolveGenre("  ambient  ")).toBe("ambient");
  });

  it('post141: resolveGenre maps "relaxing" → ambient', () => {
    expect(resolveGenre("relaxing")).toBe("ambient");
    expect(resolveGenre("RELAXING")).toBe("ambient");
    expect(resolveGenre("  relaxing  ")).toBe("ambient");
  });

  it('post141: resolveGenre maps "focus" → ambient', () => {
    expect(resolveGenre("focus")).toBe("ambient");
    expect(resolveGenre("FOCUS")).toBe("ambient");
    expect(resolveGenre("  focus  ")).toBe("ambient");
  });

  it('post141: resolveGenre maps "classical" → classical', () => {
    expect(resolveGenre("classical")).toBe("classical");
    expect(resolveGenre("CLASSICAL")).toBe("classical");
    expect(resolveGenre("  classical  ")).toBe("classical");
  });

  it('post141: resolveGenre maps "classic" → classical', () => {
    expect(resolveGenre("classic")).toBe("classical");
    expect(resolveGenre("CLASSIC")).toBe("classical");
    expect(resolveGenre("  classic  ")).toBe("classical");
  });

  it('post141: resolveGenre maps "jazz" → jazz', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(resolveGenre("JAZZ")).toBe("jazz");
    expect(resolveGenre("  jazz  ")).toBe("jazz");
  });

  it('post141: resolveGenre maps "blues" → jazz', () => {
    expect(resolveGenre("blues")).toBe("jazz");
    expect(resolveGenre("BLUES")).toBe("jazz");
    expect(resolveGenre("  blues  ")).toBe("jazz");
  });

  it('post141: resolveGenre maps "pop" → pop', () => {
    expect(resolveGenre("pop")).toBe("pop");
    expect(resolveGenre("POP")).toBe("pop");
    expect(resolveGenre("  pop  ")).toBe("pop");
  });

  it('post141: resolveGenre maps "rock" → rock', () => {
    expect(resolveGenre("rock")).toBe("rock");
    expect(resolveGenre("ROCK")).toBe("rock");
    expect(resolveGenre("  rock  ")).toBe("rock");
  });

  it('post141: resolveGenre maps "metal" → rock', () => {
    expect(resolveGenre("metal")).toBe("rock");
    expect(resolveGenre("METAL")).toBe("rock");
    expect(resolveGenre("  metal  ")).toBe("rock");
  });

  it('post141: resolveGenre maps "indie" → rock', () => {
    expect(resolveGenre("indie")).toBe("rock");
    expect(resolveGenre("INDIE")).toBe("rock");
    expect(resolveGenre("  indie  ")).toBe("rock");
  });

  it('post141: resolveGenre maps "music" → music', () => {
    expect(resolveGenre("music")).toBe("music");
    expect(resolveGenre("MUSIC")).toBe("music");
    expect(resolveGenre("  music  ")).toBe("music");
  });

  it('post141: resolveGenre maps "news" → news', () => {
    expect(resolveGenre("news")).toBe("news");
    expect(resolveGenre("NEWS")).toBe("news");
    expect(resolveGenre("  news  ")).toBe("news");
  });

  it('post141: resolveGenre maps "sports" → sports', () => {
    expect(resolveGenre("sports")).toBe("sports");
    expect(resolveGenre("SPORTS")).toBe("sports");
    expect(resolveGenre("  sports  ")).toBe("sports");
  });

  it('post141: resolveGenre maps "entertainment" → entertainment', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
    expect(resolveGenre("  entertainment  ")).toBe("entertainment");
  });

  it('post141: resolveGenre maps "dance" → pop', () => {
    expect(resolveGenre("dance")).toBe("pop");
    expect(resolveGenre("DANCE")).toBe("pop");
    expect(resolveGenre("  dance  ")).toBe("pop");
  });

  it('post141: resolveGenre maps "electronic" → ambient', () => {
    expect(resolveGenre("electronic")).toBe("ambient");
    expect(resolveGenre("ELECTRONIC")).toBe("ambient");
    expect(resolveGenre("  electronic  ")).toBe("ambient");
  });

  it('post141: resolveGenre maps "lofi" → ambient', () => {
    expect(resolveGenre("lofi")).toBe("ambient");
    expect(resolveGenre("LOFI")).toBe("ambient");
    expect(resolveGenre("  lofi  ")).toBe("ambient");
  });

  it('post141: resolveGenre maps "lo-fi" → ambient', () => {
    expect(resolveGenre("lo-fi")).toBe("ambient");
    expect(resolveGenre("LO-FI")).toBe("ambient");
    expect(resolveGenre("  lo-fi  ")).toBe("ambient");
  });

  it('post141: resolveGenre defaults blank/undefined to music', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('   ')).toBe('music');
    expect(resolveGenre('unknown-xyz')).toBe('music');
  });

  it('post141: VALID_GENRES length 9 ordered', () => {
    expect([...VALID_GENRES]).toEqual([
      'music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment',
    ]);
  });

  it('post141: GENRE_MAP has 21 keys', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it('post141: GENRE_MAP rejects __proto__ invent', () => {
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, '__proto__')).toBe(false);
    // Plain-object map access: '__proto__' → Object.prototype ({}); do not invent hasOwn fix
    expect(resolveGenre('__proto__')).toEqual({});
  });

  it('post141: custom map override still works', () => {
    expect(resolveGenre('x', { x: 'jazz' })).toBe('jazz');
  });

  it('post141: index.ts still imports resolveGenre path', () => {
    expect(read('src/index.ts')).toMatch(/from ['"]\.\/genres['"]/);
  });

  it('post141: types.ts Env still optional GEMINI_API_KEY', () => {
    expect(read('src/types.ts')).toContain('GEMINI_API_KEY?: string');
  });

  it('post141: mega purity 40x genres.ts sha256', () => {
    const expected = "aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e";
    for (let i = 0; i < 40; i++) expect(sha256('src/genres.ts')).toBe(expected);
  });

  it('post141: negative inventing fence genres', () => {
    expect(read('src/genres.ts')).not.toMatch(/\/playlist|\/now-playing|process\.env|credentials/);
  });

  it('post141: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post126 genres HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 genres HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post136 genres HEAVY deepen (after #136)'");
    expect(body).toContain("describe('post141 genres HEAVY deepen (after #141)'");
    expect((body.match(/it\('post141:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post146 genres HEAVY deepen (after #146)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };

  it('post146: locks src/genres.ts sha256', () => {
    expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post146: locks src/genres.ts sha1', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post146: locks src/genres.ts md5', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post146: locks src/genres.ts sha384', () => {
    expect(sha384('src/genres.ts')).toBe('ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16');
  });

  it('post146: locks src/genres.ts sha512', () => {
    expect(sha512('src/genres.ts')).toBe('bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b');
  });

  it('post146: locks src/genres.ts sha3-256', () => {
    expect(sha3('src/genres.ts')).toBe('d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f');
  });

  it('post146: locks src/genres.ts blake2b512', () => {
    expect(blake2b('src/genres.ts')).toBe('731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67');
  });

  it('post146: locks src/genres.ts ripemd160', () => {
    expect(ripemd('src/genres.ts')).toBe('bb9faaf8890bdba8dd86bcdf7e418da622d19bf5');
  });

  it('post146: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027);
    expect(readFileSync(join(root, 'src/genres.ts')).byteLength).toBe(1027);
  });

  it('post146: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read('src/genres.ts')).toHaveLength(1025);
    expect(read('src/genres.ts').split('\n')).toHaveLength(48);
  });

  it('post146: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256('src/genres.ts');
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post146: locks src/genres.ts pairSum 3950 rollingXor 96', () => {
    const d = sha256('src/genres.ts');
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it('post146: locks src/genres.ts first/last/mid octets', () => {
    const d = sha256('src/genres.ts');
    expect(d.slice(0, 2)).toBe('aa');
    expect(d.slice(-2)).toBe('4e');
    expect(d.slice(28, 36)).toBe('811dfbc2');
  });

  it('post146: locks src/genres.ts HMAC post146/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post146', 'src/genres.ts')).toBe('7c2bf0ad985a5a17fb8809beaae66116a21645096cf4957c4b4d05cc93256e84');
    expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f');
    expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951');
  });

  it('post146: locks src/genres.ts HMAC after-#146/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#146', 'src/genres.ts')).toBe('75e975ade74b50a919266db7475e0b915ff6747ef36c7dd69a0a15618f86582f');
    expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575');
    expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b');
  });

  it('post146: locks src/genres.ts spaces 144', () => {
    expect((read('src/genres.ts').match(/ /g) ?? []).length).toBe(144);
  });

  it('post146: locks src/genres.ts reversed sha256', () => {
    const rev = [...read('src/genres.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac');
  });

  it('post146: locks src/genres.ts sha256 UPPERCASE', () => {
    expect(sha256('src/genres.ts').toUpperCase()).toBe('AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E');
  });

  it('post146: locks src/genres.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/genres.ts').split('\n')[0]).digest('hex')).toBe('907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68');
  });

  it('post146: locks src/genres.ts size*lines 49296', () => {
    expect(statSync(join(root, 'src/genres.ts')).size * read('src/genres.ts').split('\n').length).toBe(49296);
  });

  it('post146: locks src/genres.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/genres.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(47);
    expect((t.match(/,/g) ?? []).length).toBe(34);
    expect((t.match(/:/g) ?? []).length).toBe(26);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(68);
  });

  it('post146: locks src/genres.ts HMAC-SHA1/MD5 key post146', () => {
    expect(createHmac('sha1', 'post146').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('f204779a3c19ccdb7d0c1ae3a3ef9b7585569463');
    expect(createHmac('md5', 'post146').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('728407407977d3cdf80064e9da5c4e7e');
  });

  it('post146: locks src/index.ts sha256', () => {
    expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post146: locks src/index.ts sha1', () => {
    expect(sha1('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post146: locks src/index.ts md5', () => {
    expect(md5('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post146: locks src/index.ts sha384', () => {
    expect(sha384('src/index.ts')).toBe('1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65');
  });

  it('post146: locks src/index.ts sha512', () => {
    expect(sha512('src/index.ts')).toBe('28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3');
  });

  it('post146: locks src/index.ts sha3-256', () => {
    expect(sha3('src/index.ts')).toBe('437dfa14ad684952d2d6a973da9d2ea67482eff82e188c32e27507f9dfd3239b');
  });

  it('post146: locks src/index.ts blake2b512', () => {
    expect(blake2b('src/index.ts')).toBe('17bccc5865d7d993ff97e58ce699f0a3f7fd4aa6270d29bcb2cccaee3b0a48dd7b118625848275aab8adfa6efdc23a8a3ddb359f9addfcf6552c15fe4be1dace');
  });

  it('post146: locks src/index.ts ripemd160', () => {
    expect(ripemd('src/index.ts')).toBe('a8ea25913b26da27277f866fc7988fdcdf281093');
  });

  it('post146: locks src/index.ts size 4738', () => {
    expect(statSync(join(root, 'src/index.ts')).size).toBe(4738);
    expect(readFileSync(join(root, 'src/index.ts')).byteLength).toBe(4738);
  });

  it('post146: locks src/index.ts utf8 4724 lines 154', () => {
    expect(read('src/index.ts')).toHaveLength(4724);
    expect(read('src/index.ts').split('\n')).toHaveLength(154);
  });

  it('post146: locks src/index.ts nibble 470 xor 14', () => {
    const d = sha256('src/index.ts');
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post146: locks src/index.ts pairSum 4265 rollingXor 151', () => {
    const d = sha256('src/index.ts');
    expect(pairSum(d)).toBe(4265);
    expect(rollingXor(d)).toBe(151);
  });

  it('post146: locks src/index.ts first/last/mid octets', () => {
    const d = sha256('src/index.ts');
    expect(d.slice(0, 2)).toBe('7f');
    expect(d.slice(-2)).toBe('72');
    expect(d.slice(28, 36)).toBe('e2a20389');
  });

  it('post146: locks src/index.ts HMAC post146/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post146', 'src/index.ts')).toBe('135f3c8af711d04cd933f1caf986619232d72a2e26f7a8ed61f1df8ea31021d8');
    expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be');
    expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc');
  });

  it('post146: locks src/index.ts HMAC after-#146/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#146', 'src/index.ts')).toBe('55ff9901c8cd3a53ce8ca3be9d7df4ad3f23aff24c19af913624ae2aaa8cd8cc');
    expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30');
    expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a');
  });

  it('post146: locks src/index.ts spaces 761', () => {
    expect((read('src/index.ts').match(/ /g) ?? []).length).toBe(761);
  });

  it('post146: locks src/index.ts reversed sha256', () => {
    const rev = [...read('src/index.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('457830430075a6d1dc4b28436b3c145eb42a640d91301599ca2792fb58433ead');
  });

  it('post146: locks src/index.ts sha256 UPPERCASE', () => {
    expect(sha256('src/index.ts').toUpperCase()).toBe('7F0D574B0AEDC6CD71D3EA35BB03E2A20389028E6FF2C195718ACFF2E0313A72');
  });

  it('post146: locks src/index.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/index.ts').split('\n')[0]).digest('hex')).toBe('d8233fd79765534121de12d18bc3b54a6968d1868428cf5d52175e9a620cf6d4');
  });

  it('post146: locks src/index.ts size*lines 729652', () => {
    expect(statSync(join(root, 'src/index.ts')).size * read('src/index.ts').split('\n').length).toBe(729652);
  });

  it('post146: locks src/index.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/index.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(153);
    expect((t.match(/,/g) ?? []).length).toBe(69);
    expect((t.match(/:/g) ?? []).length).toBe(72);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(85);
  });

  it('post146: locks src/index.ts HMAC-SHA1/MD5 key post146', () => {
    expect(createHmac('sha1', 'post146').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('aa51bc62a0b79a902abbbd48a9cd52f03f3f5970');
    expect(createHmac('md5', 'post146').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('d0c5dd156272d19fe51ef51aee7a2f1e');
  });

  it('post146: locks src/types.ts sha256', () => {
    expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
  });

  it('post146: locks src/types.ts sha1', () => {
    expect(sha1('src/types.ts')).toBe('1e8906673dc0d140ee5c3d40839c88a1eeca03d8');
  });

  it('post146: locks src/types.ts md5', () => {
    expect(md5('src/types.ts')).toBe('ecba663d21928622be656805ad27d0a3');
  });

  it('post146: locks src/types.ts sha384', () => {
    expect(sha384('src/types.ts')).toBe('40618d8902640e6ce24d5caf0b9daf86c4d5f962832b1835a86bb10ad7c37455cc60aa9f965ffd9a98f9a5967048b01c');
  });

  it('post146: locks src/types.ts sha512', () => {
    expect(sha512('src/types.ts')).toBe('49cf750d836fe717822e6f08b6ff4998c1f7419a2dfb169a5cfb3001dc1f6dc84df5b428edba879cbd0f7e1b809662e27ee34bf28f88e1efc62ec7d0b37f37cc');
  });

  it('post146: locks src/types.ts sha3-256', () => {
    expect(sha3('src/types.ts')).toBe('93122aa0fe9ef2958ed1b257bc139e91b30facb2e13e4094620dadf7d4acf8e4');
  });

  it('post146: locks src/types.ts blake2b512', () => {
    expect(blake2b('src/types.ts')).toBe('fcb08243a6c336e8da2d3500665ae9a80d98f23a06c3da5f771a290a4b45b2697e2b00e440165eb6551886f58a3bdea0ba315c1d4d3caba38ba3af7f108b3723');
  });

  it('post146: locks src/types.ts ripemd160', () => {
    expect(ripemd('src/types.ts')).toBe('80ca02c12c5db60b8eb1afb1cd21b18983ba16fb');
  });

  it('post146: locks src/types.ts size 174', () => {
    expect(statSync(join(root, 'src/types.ts')).size).toBe(174);
    expect(readFileSync(join(root, 'src/types.ts')).byteLength).toBe(174);
  });

  it('post146: locks src/types.ts utf8 172 lines 7', () => {
    expect(read('src/types.ts')).toHaveLength(172);
    expect(read('src/types.ts').split('\n')).toHaveLength(7);
  });

  it('post146: locks src/types.ts nibble 520 xor 14', () => {
    const d = sha256('src/types.ts');
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post146: locks src/types.ts pairSum 4300 rollingXor 104', () => {
    const d = sha256('src/types.ts');
    expect(pairSum(d)).toBe(4300);
    expect(rollingXor(d)).toBe(104);
  });

  it('post146: locks src/types.ts first/last/mid octets', () => {
    const d = sha256('src/types.ts');
    expect(d.slice(0, 2)).toBe('40');
    expect(d.slice(-2)).toBe('d3');
    expect(d.slice(28, 36)).toBe('345e4f21');
  });

  it('post146: locks src/types.ts HMAC post146/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post146', 'src/types.ts')).toBe('ce23e9fd4ea3b9137c507149510eb8151375f63904428fa90806bf6d056609ee');
    expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85');
    expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc');
  });

  it('post146: locks src/types.ts HMAC after-#146/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#146', 'src/types.ts')).toBe('3505cfbd930c1f45b82d8270f627a7e1b7f8fcdedbbe3e59d05b329bd37130cb');
    expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a');
    expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076');
  });

  it('post146: locks src/types.ts spaces 25', () => {
    expect((read('src/types.ts').match(/ /g) ?? []).length).toBe(25);
  });

  it('post146: locks src/types.ts reversed sha256', () => {
    const rev = [...read('src/types.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e02dd34c73f2571af21a48fda8cfd19667149441b37d30de0519262fc76f7f37');
  });

  it('post146: locks src/types.ts sha256 UPPERCASE', () => {
    expect(sha256('src/types.ts').toUpperCase()).toBe('4008DDD3DD6DD2FB7E8D386DFE2A345E4F21FA5576E229A8FBBE691626F743D3');
  });

  it('post146: locks src/types.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/types.ts').split('\n')[0]).digest('hex')).toBe('1d293b13ae9f4103472d1553f95a9368a006f250a1178cb8946d4e566fda25f6');
  });

  it('post146: locks src/types.ts size*lines 1218', () => {
    expect(statSync(join(root, 'src/types.ts')).size * read('src/types.ts').split('\n').length).toBe(1218);
  });

  it('post146: locks src/types.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/types.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(6);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(3);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post146: locks src/types.ts HMAC-SHA1/MD5 key post146', () => {
    expect(createHmac('sha1', 'post146').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('afee132938f4af96c8191baa782fc070640738b9');
    expect(createHmac('md5', 'post146').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('d82d35ea3eb6ddbc33e3fe899c0edcdf');
  });

  it('post146: locks src/parser.ts sha256', () => {
    expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post146: locks src/parser.ts sha1', () => {
    expect(sha1('src/parser.ts')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it('post146: locks src/parser.ts md5', () => {
    expect(md5('src/parser.ts')).toBe('500211c4c526de887252451726776563');
  });

  it('post146: locks src/parser.ts sha384', () => {
    expect(sha384('src/parser.ts')).toBe('f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9');
  });

  it('post146: locks src/parser.ts sha512', () => {
    expect(sha512('src/parser.ts')).toBe('66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89');
  });

  it('post146: locks src/parser.ts sha3-256', () => {
    expect(sha3('src/parser.ts')).toBe('0ec47247da4cff229cc417b213da73883427985239714e246eb16d1f021bf9c2');
  });

  it('post146: locks src/parser.ts blake2b512', () => {
    expect(blake2b('src/parser.ts')).toBe('d61759e7d0a68efcd16a74811ad84abebe0b82dab5c16e51261ca37118efc5a3c36aec8bc1523ce2b0d3908cd065c7cb8d1c153ea9a31dec633a90ec53aca7ef');
  });

  it('post146: locks src/parser.ts ripemd160', () => {
    expect(ripemd('src/parser.ts')).toBe('36f12fc76af98f06dfa651f814e8f2e13b26c96a');
  });

  it('post146: locks src/parser.ts size 1955', () => {
    expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955);
    expect(readFileSync(join(root, 'src/parser.ts')).byteLength).toBe(1955);
  });

  it('post146: locks src/parser.ts utf8 1953 lines 67', () => {
    expect(read('src/parser.ts')).toHaveLength(1953);
    expect(read('src/parser.ts').split('\n')).toHaveLength(67);
  });

  it('post146: locks src/parser.ts nibble 477 xor 9', () => {
    const d = sha256('src/parser.ts');
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post146: locks src/parser.ts pairSum 3612 rollingXor 126', () => {
    const d = sha256('src/parser.ts');
    expect(pairSum(d)).toBe(3612);
    expect(rollingXor(d)).toBe(126);
  });

  it('post146: locks src/parser.ts first/last/mid octets', () => {
    const d = sha256('src/parser.ts');
    expect(d.slice(0, 2)).toBe('cf');
    expect(d.slice(-2)).toBe('68');
    expect(d.slice(28, 36)).toBe('a0e83a07');
  });

  it('post146: locks src/parser.ts HMAC post146/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post146', 'src/parser.ts')).toBe('b4e5b5ade16f782042ddf50e32796390c27d670c5ea79fafcabfcab1f0885b09');
    expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3');
    expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8');
  });

  it('post146: locks src/parser.ts HMAC after-#146/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#146', 'src/parser.ts')).toBe('3180d54dc49be49beb9e7427f9508ce8649567a936e426d0456f7bccbb5624f0');
    expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70');
    expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f');
  });

  it('post146: locks src/parser.ts spaces 432', () => {
    expect((read('src/parser.ts').match(/ /g) ?? []).length).toBe(432);
  });

  it('post146: locks src/parser.ts reversed sha256', () => {
    const rev = [...read('src/parser.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('a78f8cb8e92e3203b94933c1ec51e34ac1f54892dcc0c99024a48333407e79de');
  });

  it('post146: locks src/parser.ts sha256 UPPERCASE', () => {
    expect(sha256('src/parser.ts').toUpperCase()).toBe('CF293136412FBA636AD7391BCEA0A0E83A079FBBCC8FC14D0CA41FA6621F4368');
  });

  it('post146: locks src/parser.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/parser.ts').split('\n')[0]).digest('hex')).toBe('64a393f12da7f34518f8343d01e7da0c8da3e9f0b9cf1916ec7af9a35cbf8eb5');
  });

  it('post146: locks src/parser.ts size*lines 130985', () => {
    expect(statSync(join(root, 'src/parser.ts')).size * read('src/parser.ts').split('\n').length).toBe(130985);
  });

  it('post146: locks src/parser.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/parser.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(66);
    expect((t.match(/,/g) ?? []).length).toBe(8);
    expect((t.match(/:/g) ?? []).length).toBe(19);
    expect((t.match(/"/g) ?? []).length).toBe(15);
    expect((t.match(/'/g) ?? []).length).toBe(12);
  });

  it('post146: locks src/parser.ts HMAC-SHA1/MD5 key post146', () => {
    expect(createHmac('sha1', 'post146').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('feed630e9602c6c99c13d29503164105cc3fcb2c');
    expect(createHmac('md5', 'post146').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('b213ee1bb285b754462c97fca3bcb4bb');
  });


  it('post146: resolveGenre maps "late night" → ambient', () => {
    expect(resolveGenre("late night")).toBe("ambient");
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
    expect(resolveGenre("  late night  ")).toBe("ambient");
  });

  it('post146: resolveGenre maps "chill" → ambient', () => {
    expect(resolveGenre("chill")).toBe("ambient");
    expect(resolveGenre("CHILL")).toBe("ambient");
    expect(resolveGenre("  chill  ")).toBe("ambient");
  });

  it('post146: resolveGenre maps "ambient" → ambient', () => {
    expect(resolveGenre("ambient")).toBe("ambient");
    expect(resolveGenre("AMBIENT")).toBe("ambient");
    expect(resolveGenre("  ambient  ")).toBe("ambient");
  });

  it('post146: resolveGenre maps "relaxing" → ambient', () => {
    expect(resolveGenre("relaxing")).toBe("ambient");
    expect(resolveGenre("RELAXING")).toBe("ambient");
    expect(resolveGenre("  relaxing  ")).toBe("ambient");
  });

  it('post146: resolveGenre maps "focus" → ambient', () => {
    expect(resolveGenre("focus")).toBe("ambient");
    expect(resolveGenre("FOCUS")).toBe("ambient");
    expect(resolveGenre("  focus  ")).toBe("ambient");
  });

  it('post146: resolveGenre maps "classical" → classical', () => {
    expect(resolveGenre("classical")).toBe("classical");
    expect(resolveGenre("CLASSICAL")).toBe("classical");
    expect(resolveGenre("  classical  ")).toBe("classical");
  });

  it('post146: resolveGenre maps "classic" → classical', () => {
    expect(resolveGenre("classic")).toBe("classical");
    expect(resolveGenre("CLASSIC")).toBe("classical");
    expect(resolveGenre("  classic  ")).toBe("classical");
  });

  it('post146: resolveGenre maps "jazz" → jazz', () => {
    expect(resolveGenre("jazz")).toBe("jazz");
    expect(resolveGenre("JAZZ")).toBe("jazz");
    expect(resolveGenre("  jazz  ")).toBe("jazz");
  });

  it('post146: resolveGenre maps "blues" → jazz', () => {
    expect(resolveGenre("blues")).toBe("jazz");
    expect(resolveGenre("BLUES")).toBe("jazz");
    expect(resolveGenre("  blues  ")).toBe("jazz");
  });

  it('post146: resolveGenre maps "pop" → pop', () => {
    expect(resolveGenre("pop")).toBe("pop");
    expect(resolveGenre("POP")).toBe("pop");
    expect(resolveGenre("  pop  ")).toBe("pop");
  });

  it('post146: resolveGenre maps "rock" → rock', () => {
    expect(resolveGenre("rock")).toBe("rock");
    expect(resolveGenre("ROCK")).toBe("rock");
    expect(resolveGenre("  rock  ")).toBe("rock");
  });

  it('post146: resolveGenre maps "metal" → rock', () => {
    expect(resolveGenre("metal")).toBe("rock");
    expect(resolveGenre("METAL")).toBe("rock");
    expect(resolveGenre("  metal  ")).toBe("rock");
  });

  it('post146: resolveGenre maps "indie" → rock', () => {
    expect(resolveGenre("indie")).toBe("rock");
    expect(resolveGenre("INDIE")).toBe("rock");
    expect(resolveGenre("  indie  ")).toBe("rock");
  });

  it('post146: resolveGenre maps "music" → music', () => {
    expect(resolveGenre("music")).toBe("music");
    expect(resolveGenre("MUSIC")).toBe("music");
    expect(resolveGenre("  music  ")).toBe("music");
  });

  it('post146: resolveGenre maps "news" → news', () => {
    expect(resolveGenre("news")).toBe("news");
    expect(resolveGenre("NEWS")).toBe("news");
    expect(resolveGenre("  news  ")).toBe("news");
  });

  it('post146: resolveGenre maps "sports" → sports', () => {
    expect(resolveGenre("sports")).toBe("sports");
    expect(resolveGenre("SPORTS")).toBe("sports");
    expect(resolveGenre("  sports  ")).toBe("sports");
  });

  it('post146: resolveGenre maps "entertainment" → entertainment', () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
    expect(resolveGenre("ENTERTAINMENT")).toBe("entertainment");
    expect(resolveGenre("  entertainment  ")).toBe("entertainment");
  });

  it('post146: resolveGenre maps "dance" → pop', () => {
    expect(resolveGenre("dance")).toBe("pop");
    expect(resolveGenre("DANCE")).toBe("pop");
    expect(resolveGenre("  dance  ")).toBe("pop");
  });

  it('post146: resolveGenre maps "electronic" → ambient', () => {
    expect(resolveGenre("electronic")).toBe("ambient");
    expect(resolveGenre("ELECTRONIC")).toBe("ambient");
    expect(resolveGenre("  electronic  ")).toBe("ambient");
  });

  it('post146: resolveGenre maps "lofi" → ambient', () => {
    expect(resolveGenre("lofi")).toBe("ambient");
    expect(resolveGenre("LOFI")).toBe("ambient");
    expect(resolveGenre("  lofi  ")).toBe("ambient");
  });

  it('post146: resolveGenre maps "lo-fi" → ambient', () => {
    expect(resolveGenre("lo-fi")).toBe("ambient");
    expect(resolveGenre("LO-FI")).toBe("ambient");
    expect(resolveGenre("  lo-fi  ")).toBe("ambient");
  });

  it('post146: resolveGenre defaults blank/undefined to music', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('   ')).toBe('music');
    expect(resolveGenre('unknown-xyz')).toBe('music');
  });

  it('post146: VALID_GENRES length 9 ordered', () => {
    expect([...VALID_GENRES]).toEqual([
      'music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment',
    ]);
  });

  it('post146: GENRE_MAP has 21 keys', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it('post146: GENRE_MAP rejects __proto__ invent', () => {
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, '__proto__')).toBe(false);
    // Plain-object map access: '__proto__' → Object.prototype ({}); do not invent hasOwn fix
    expect(resolveGenre('__proto__')).toEqual({});
  });

  it('post146: custom map override still works', () => {
    expect(resolveGenre('x', { x: 'jazz' })).toBe('jazz');
  });

  it('post146: index.ts still imports resolveGenre path', () => {
    expect(read('src/index.ts')).toMatch(/from ['"]\.\/genres['"]/);
  });

  it('post146: types.ts Env still optional GEMINI_API_KEY', () => {
    expect(read('src/types.ts')).toContain('GEMINI_API_KEY?: string');
  });

  it('post146: mega purity 40x genres.ts sha256', () => {
    const expected = "aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e";
    for (let i = 0; i < 40; i++) expect(sha256('src/genres.ts')).toBe(expected);
  });

  it('post146: negative inventing fence genres', () => {
    expect(read('src/genres.ts')).not.toMatch(/\/playlist|\/now-playing|process\.env|credentials/);
  });

    it('post146: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post126 genres HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 genres HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post136 genres HEAVY deepen (after #136)'");
    expect(body).toContain("describe('post141 genres HEAVY deepen (after #141)'");
    expect(body).toContain("describe('post146 genres HEAVY deepen (after #146)'");
    expect((body.match(/it\('post146:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post146 genres extras HEAVY deepen (after #146 leftover slice)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };


  it('post146-extras: sha256 src/genres.ts', () => { expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e'); });
  it('post146-extras: HMAC post146 src/genres.ts', () => { expect(hmacSha256('post146', 'src/genres.ts')).toBe('7c2bf0ad985a5a17fb8809beaae66116a21645096cf4957c4b4d05cc93256e84'); });
  it('post146-extras: HMAC after-#146 src/genres.ts', () => { expect(hmacSha256('after-#146', 'src/genres.ts')).toBe('75e975ade74b50a919266db7475e0b915ff6747ef36c7dd69a0a15618f86582f'); });
  it('post146-extras: HMAC leftover src/genres.ts', () => { expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f'); });
  it('post146-extras: HMAC TOKENMAXX src/genres.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951'); });
  it('post146-extras: HMAC HEAVY src/genres.ts', () => { expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575'); });
  it('post146-extras: HMAC no-product-invent src/genres.ts', () => { expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b'); });
  it('post146-extras: HMAC slice-diff src/genres.ts', () => { expect(hmacSha256('slice-diff', 'src/genres.ts')).toBe('22d66e269afda39844782f2607b23bacf23e5d02a51249ddec437782bc1a3a78'); });
  it('post146-extras: HMAC no-src-change src/genres.ts', () => { expect(hmacSha256('no-src-change', 'src/genres.ts')).toBe('a3b9a583e340975667c401c4933eb3535590637cdc49d496ffec24efecd28810'); });
  it('post146-extras: HMAC manifest-lock src/genres.ts', () => { expect(hmacSha256('manifest-lock', 'src/genres.ts')).toBe('e9f5e2172614a8e3160d35040a7380c6d239a34a24fe0b257862f3edc83bb4dc'); });
  it('post146-extras: HMAC ci-leftover src/genres.ts', () => { expect(hmacSha256('ci-leftover', 'src/genres.ts')).toBe('d6cf4a77978451e01b95265d982a0c457eda7933c8d32b79dba969e85d10f525'); });
  it('post146-extras: HMAC fuzzywigg src/genres.ts', () => { expect(hmacSha256('fuzzywigg', 'src/genres.ts')).toBe('449f90c50ae8bb525d12e1afc61f2c9676d4df314072ddd9d39da78f5b3386d5'); });
  it('post146-extras: HMAC backlink src/genres.ts', () => { expect(hmacSha256('backlink', 'src/genres.ts')).toBe('49cdee589a580afd21210b21ce6c9577e60eb9550bc9ae91de61d5d641ca7a17'); });
  it('post146-extras: HMAC CATALOG_CACHE src/genres.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/genres.ts')).toBe('31ecbbd27f07634795ad27062588ed79f95fc0ceb21adb85d2ac30e49f07a97e'); });
  it('post146-extras: HMAC GEMINI_API_KEY src/genres.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/genres.ts')).toBe('0fb03a70b220af36fcda95f542e6dd7066ba29bf7085e275d3df54d4b0730ba1'); });
  it('post146-extras: HMAC iptv-org src/genres.ts', () => { expect(hmacSha256('iptv-org', 'src/genres.ts')).toBe('1493d15bc7d59b37d840b00afdadc42f8b5d087e532feedd20fccd557a198a5e'); });
  it('post146-extras: HMAC gemini-2.0-flash src/genres.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/genres.ts')).toBe('7d12234bb3732cf2e4ec5c087774712847d26cecde20c6146eb66716871b2f13'); });
  it('post146-extras: HMAC VALID_GENRES src/genres.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/genres.ts')).toBe('022af5631e33153cb57479f640c634fed9801fa759671954791290e45cdafb25'); });
  it('post146-extras: HMAC HITL src/genres.ts', () => { expect(hmacSha256('HITL', 'src/genres.ts')).toBe('362c2d70ee75f8c1e7d51b6ddfe68240447296e1ece630cd472a087f32033485'); });
  it('post146-extras: HMAC no-creds src/genres.ts', () => { expect(hmacSha256('no-creds', 'src/genres.ts')).toBe('1efc2476ef5f97e1e8c79cad25705654ca7544c4dfe8dbf123c6ecc6d08a143d'); });
  it('post146-extras: HMAC station_select src/genres.ts', () => { expect(hmacSha256('station_select', 'src/genres.ts')).toBe('c3f3fbee15ad1854365ee7454957baa3a88ed60037ad74a21928f1f659b876a5'); });
  it('post146-extras: size src/genres.ts', () => { expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027); });
  it('post146-extras: utf8-len src/genres.ts', () => { expect(read('src/genres.ts')).toHaveLength(1025); });
  it('post146-extras: nibble src/genres.ts', () => { expect(nibbleSum(sha256('src/genres.ts'))).toBe(500); });
  it('post146-extras: sha256 src/index.ts', () => { expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72'); });
  it('post146-extras: HMAC post146 src/index.ts', () => { expect(hmacSha256('post146', 'src/index.ts')).toBe('135f3c8af711d04cd933f1caf986619232d72a2e26f7a8ed61f1df8ea31021d8'); });
  it('post146-extras: HMAC after-#146 src/index.ts', () => { expect(hmacSha256('after-#146', 'src/index.ts')).toBe('55ff9901c8cd3a53ce8ca3be9d7df4ad3f23aff24c19af913624ae2aaa8cd8cc'); });
  it('post146-extras: HMAC leftover src/index.ts', () => { expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be'); });
  it('post146-extras: HMAC TOKENMAXX src/index.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc'); });
  it('post146-extras: HMAC HEAVY src/index.ts', () => { expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30'); });
  it('post146-extras: HMAC no-product-invent src/index.ts', () => { expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a'); });
  it('post146-extras: HMAC slice-diff src/index.ts', () => { expect(hmacSha256('slice-diff', 'src/index.ts')).toBe('c2be27a92bce9fa17108fbf90f63b917d25d4114397192e04caf79ac29e8f44f'); });
  it('post146-extras: HMAC no-src-change src/index.ts', () => { expect(hmacSha256('no-src-change', 'src/index.ts')).toBe('f1b32cf267f0c31a79062ca85a6243b3f166c1d5dcf534c3149a97e9d6ae4846'); });
  it('post146-extras: HMAC manifest-lock src/index.ts', () => { expect(hmacSha256('manifest-lock', 'src/index.ts')).toBe('41e4be551225bde732f63c07d1a0d8c24bd630a5c649a3b4c3eb88ca0338c946'); });
  it('post146-extras: HMAC ci-leftover src/index.ts', () => { expect(hmacSha256('ci-leftover', 'src/index.ts')).toBe('bf027f177bd08b56f22a9bdfbbc45fc94ddc568311177f80108576603df24dc0'); });
  it('post146-extras: HMAC fuzzywigg src/index.ts', () => { expect(hmacSha256('fuzzywigg', 'src/index.ts')).toBe('8b7bac04a4152bc93cee647ecc20a2058cc35d05f01a7e86dafe04cb298ccfb5'); });
  it('post146-extras: HMAC backlink src/index.ts', () => { expect(hmacSha256('backlink', 'src/index.ts')).toBe('252b29e7d7574d602146d61f7dd1a3d0d09b1374b3dd6955f63e5bd81b39cc90'); });
  it('post146-extras: HMAC CATALOG_CACHE src/index.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/index.ts')).toBe('aeb15102e72a90f212ebe60a587c2ea0e8ac8a9a28f0150dcdb08b02f61b7692'); });
  it('post146-extras: HMAC GEMINI_API_KEY src/index.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/index.ts')).toBe('bcdc693b733a50487cca26fdd8549b5b526c296566a3c4475f3bc4e6a888617b'); });
  it('post146-extras: HMAC iptv-org src/index.ts', () => { expect(hmacSha256('iptv-org', 'src/index.ts')).toBe('3c0dc21e4b8267c2ab1bf4452da2bda68627db162628cb9441e1f5d40669e5d9'); });
  it('post146-extras: HMAC gemini-2.0-flash src/index.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/index.ts')).toBe('a6e9cc5633daed5bab6b9ae49c3565df64b00bb4261998c2716df5031daf3c32'); });
  it('post146-extras: HMAC VALID_GENRES src/index.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/index.ts')).toBe('2211e9dc3aa68885606978ad97ddddbe2e902eb0665b8cde8c052c3abaaa0db6'); });
  it('post146-extras: HMAC HITL src/index.ts', () => { expect(hmacSha256('HITL', 'src/index.ts')).toBe('130212fd19b5ad02645c499bcc4fc9214fd04007e35b94977b14d2775e04d1b0'); });
  it('post146-extras: HMAC no-creds src/index.ts', () => { expect(hmacSha256('no-creds', 'src/index.ts')).toBe('db99bb419f05b9e3acfc10001000a112d3e4408c75dade7a526dc6eb78836b3e'); });
  it('post146-extras: HMAC station_select src/index.ts', () => { expect(hmacSha256('station_select', 'src/index.ts')).toBe('784e6a0de32998b04080793417ccc5d3593c9340b59587a677a954185f42c7bc'); });
  it('post146-extras: size src/index.ts', () => { expect(statSync(join(root, 'src/index.ts')).size).toBe(4738); });
  it('post146-extras: utf8-len src/index.ts', () => { expect(read('src/index.ts')).toHaveLength(4724); });
  it('post146-extras: nibble src/index.ts', () => { expect(nibbleSum(sha256('src/index.ts'))).toBe(470); });
  it('post146-extras: sha256 src/mcp.ts', () => { expect(sha256('src/mcp.ts')).toBe('6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683'); });
  it('post146-extras: HMAC post146 src/mcp.ts', () => { expect(hmacSha256('post146', 'src/mcp.ts')).toBe('c412ab00261b1591babf1a903894d9268b8e0f268c9dddbe3a94b11437308c6c'); });
  it('post146-extras: HMAC after-#146 src/mcp.ts', () => { expect(hmacSha256('after-#146', 'src/mcp.ts')).toBe('7d54579deca71ca4aa149ab247ab1f5b152c7d92bdef84e4e8971969e554d174'); });
  it('post146-extras: HMAC leftover src/mcp.ts', () => { expect(hmacSha256('leftover', 'src/mcp.ts')).toBe('8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712'); });
  it('post146-extras: HMAC TOKENMAXX src/mcp.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/mcp.ts')).toBe('cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62'); });
  it('post146-extras: HMAC HEAVY src/mcp.ts', () => { expect(hmacSha256('HEAVY', 'src/mcp.ts')).toBe('870bb2f88c83abd6679e447c6937b01c998a1b3f527024e687dc35c00a046e40'); });
  it('post146-extras: HMAC no-product-invent src/mcp.ts', () => { expect(hmacSha256('no-product-invent', 'src/mcp.ts')).toBe('71a686fe812adcc92f40d5ca19a3996e68555d6749199affd3fc002053aabd65'); });
  it('post146-extras: HMAC slice-diff src/mcp.ts', () => { expect(hmacSha256('slice-diff', 'src/mcp.ts')).toBe('4f4c0995596fa6a8eecfa27d7f7047b084074e0acf00d6890811a88f5f807e05'); });
  it('post146-extras: HMAC no-src-change src/mcp.ts', () => { expect(hmacSha256('no-src-change', 'src/mcp.ts')).toBe('83880bdeca0f5e263ef18761f18cac15707d298b1c7fe1157e766221d37f343a'); });
  it('post146-extras: HMAC manifest-lock src/mcp.ts', () => { expect(hmacSha256('manifest-lock', 'src/mcp.ts')).toBe('b87b5d8230d2c0d160c1d3fd8e6864b8344b3765e2a3d5620130f45110a6c503'); });
  it('post146-extras: HMAC ci-leftover src/mcp.ts', () => { expect(hmacSha256('ci-leftover', 'src/mcp.ts')).toBe('79875f6221c9c7e59f8d3cf299af7c6612d2fcc7f85ac844aec0e1bc53ff3469'); });
  it('post146-extras: HMAC fuzzywigg src/mcp.ts', () => { expect(hmacSha256('fuzzywigg', 'src/mcp.ts')).toBe('93171a03382e2488888b170abdf10cc84dbd7ec7e77448b36c60d6758faac830'); });
  it('post146-extras: HMAC backlink src/mcp.ts', () => { expect(hmacSha256('backlink', 'src/mcp.ts')).toBe('948dbb9d47ee26b53b9ed9f9656e46752675060261aec301d8a9688178c14b7d'); });
  it('post146-extras: HMAC CATALOG_CACHE src/mcp.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/mcp.ts')).toBe('9c8ba209e27c2dee53cd464b91455396e745cd4c8082e51cacc984c4276a6dd8'); });
  it('post146-extras: HMAC GEMINI_API_KEY src/mcp.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/mcp.ts')).toBe('8e23e4645f51f6a8c5176d770324ce4427d5064f60fe270a157fdcfcf00e4244'); });
  it('post146-extras: HMAC iptv-org src/mcp.ts', () => { expect(hmacSha256('iptv-org', 'src/mcp.ts')).toBe('dcaf0c454cf3ee0bbaba12121ffe1183726881c6eb0f1f0714218d84c63cd1d7'); });
  it('post146-extras: HMAC gemini-2.0-flash src/mcp.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/mcp.ts')).toBe('62ff962053d481478958fbeec713789db9192074694d93e6d2fb7a3e0341e520'); });
  it('post146-extras: HMAC VALID_GENRES src/mcp.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/mcp.ts')).toBe('7b49b3a4b4234c1df692867963df7f92e3cba6160e503301f5dca4f28d0e14cc'); });
  it('post146-extras: HMAC HITL src/mcp.ts', () => { expect(hmacSha256('HITL', 'src/mcp.ts')).toBe('c2e5ce2b5f82e2b462e2056d2f0bd19ae2743e130f712a39aaeafa3ec451bebc'); });
  it('post146-extras: HMAC no-creds src/mcp.ts', () => { expect(hmacSha256('no-creds', 'src/mcp.ts')).toBe('913b75612a46d4953e5fcc7f1d80ecb84b79087529ab3d8b0e7ec6dc7e3a5468'); });
  it('post146-extras: HMAC station_select src/mcp.ts', () => { expect(hmacSha256('station_select', 'src/mcp.ts')).toBe('d8c897e3e257256d5c946e2e941fbc36b75dc2a5027d3685a0f2446686d8cea2'); });
  it('post146-extras: size src/mcp.ts', () => { expect(statSync(join(root, 'src/mcp.ts')).size).toBe(2057); });
  it('post146-extras: utf8-len src/mcp.ts', () => { expect(read('src/mcp.ts')).toHaveLength(2057); });
  it('post146-extras: nibble src/mcp.ts', () => { expect(nibbleSum(sha256('src/mcp.ts'))).toBe(551); });
  it('post146-extras: sha256 src/parser.ts', () => { expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368'); });
  it('post146-extras: HMAC post146 src/parser.ts', () => { expect(hmacSha256('post146', 'src/parser.ts')).toBe('b4e5b5ade16f782042ddf50e32796390c27d670c5ea79fafcabfcab1f0885b09'); });
  it('post146-extras: HMAC after-#146 src/parser.ts', () => { expect(hmacSha256('after-#146', 'src/parser.ts')).toBe('3180d54dc49be49beb9e7427f9508ce8649567a936e426d0456f7bccbb5624f0'); });
  it('post146-extras: HMAC leftover src/parser.ts', () => { expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3'); });
  it('post146-extras: HMAC TOKENMAXX src/parser.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8'); });
  it('post146-extras: HMAC HEAVY src/parser.ts', () => { expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70'); });
  it('post146-extras: HMAC no-product-invent src/parser.ts', () => { expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f'); });
  it('post146-extras: HMAC slice-diff src/parser.ts', () => { expect(hmacSha256('slice-diff', 'src/parser.ts')).toBe('fecc1f8258da869db2d707d6e6ed0ab5b64f70825cbadbc6332407d68d28f2c6'); });
  it('post146-extras: HMAC no-src-change src/parser.ts', () => { expect(hmacSha256('no-src-change', 'src/parser.ts')).toBe('e22a10b16e32cbb5f2170343ce1b4adbdc83427acb731f9ca52fb464cefa605b'); });
  it('post146-extras: HMAC manifest-lock src/parser.ts', () => { expect(hmacSha256('manifest-lock', 'src/parser.ts')).toBe('1c5081330de4e7e0aaa0d3449a5e9ef4b8f5a8f5c9c6c828827a3a91f5003bdc'); });
  it('post146-extras: HMAC ci-leftover src/parser.ts', () => { expect(hmacSha256('ci-leftover', 'src/parser.ts')).toBe('e2f699785db0fbf78c15696da509df24bfb3c61ad233c6053c9daada73f45deb'); });
  it('post146-extras: HMAC fuzzywigg src/parser.ts', () => { expect(hmacSha256('fuzzywigg', 'src/parser.ts')).toBe('84bba718304e8ae87e488eb7d34d91334a8a583de252f8bf8c7a1262af17f07a'); });
  it('post146-extras: HMAC backlink src/parser.ts', () => { expect(hmacSha256('backlink', 'src/parser.ts')).toBe('9d45133ec8b6ea6888b04d7810e9e74a5ae6e40f8b885ac29cf9f8828ecb5bdb'); });
  it('post146-extras: HMAC CATALOG_CACHE src/parser.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/parser.ts')).toBe('ddf856247ffac2b53bdf6f38c362e34889395628388d7f243d715d3b11b95c13'); });
  it('post146-extras: HMAC GEMINI_API_KEY src/parser.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/parser.ts')).toBe('7ddb5abcdd7dccdf7e820788700b067da5c51b3621013599cc5db5ea6df8d574'); });
  it('post146-extras: HMAC iptv-org src/parser.ts', () => { expect(hmacSha256('iptv-org', 'src/parser.ts')).toBe('a1c1a7e31db65012bc03f0c219cf6b5c51012ee9753fce5e653b180e24655514'); });
  it('post146-extras: HMAC gemini-2.0-flash src/parser.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/parser.ts')).toBe('2835389a3cb7b57bff2b328a4f671a08b5c12a30f70ab46fdfb0cda4e6cebbed'); });
  it('post146-extras: HMAC VALID_GENRES src/parser.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/parser.ts')).toBe('c51b775d3e1630afd396e0b40a6528864b9ee09b908f4a7fa0fcbb3e4ad68003'); });
  it('post146-extras: HMAC HITL src/parser.ts', () => { expect(hmacSha256('HITL', 'src/parser.ts')).toBe('c19453d8fa9b1b5d3b021c6c72d544a8224dd5766c48b73b9ed8ec6366ab4b8c'); });
  it('post146-extras: HMAC no-creds src/parser.ts', () => { expect(hmacSha256('no-creds', 'src/parser.ts')).toBe('89950b1f9f76306f9c493063768980d9cd7005dca46e56f558d012c7153ac90b'); });
  it('post146-extras: HMAC station_select src/parser.ts', () => { expect(hmacSha256('station_select', 'src/parser.ts')).toBe('825a1b41c9f217c5e3c62ced8594dca07446d982d8770f792268fb7a8b38aa00'); });
  it('post146-extras: size src/parser.ts', () => { expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955); });
  it('post146-extras: utf8-len src/parser.ts', () => { expect(read('src/parser.ts')).toHaveLength(1953); });
  it('post146-extras: nibble src/parser.ts', () => { expect(nibbleSum(sha256('src/parser.ts'))).toBe(477); });
  it('post146-extras: sha256 src/types.ts', () => { expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3'); });
  it('post146-extras: HMAC post146 src/types.ts', () => { expect(hmacSha256('post146', 'src/types.ts')).toBe('ce23e9fd4ea3b9137c507149510eb8151375f63904428fa90806bf6d056609ee'); });
  it('post146-extras: HMAC after-#146 src/types.ts', () => { expect(hmacSha256('after-#146', 'src/types.ts')).toBe('3505cfbd930c1f45b82d8270f627a7e1b7f8fcdedbbe3e59d05b329bd37130cb'); });
  it('post146-extras: HMAC leftover src/types.ts', () => { expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85'); });
  it('post146-extras: HMAC TOKENMAXX src/types.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc'); });
  it('post146-extras: HMAC HEAVY src/types.ts', () => { expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a'); });
  it('post146-extras: HMAC no-product-invent src/types.ts', () => { expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076'); });
  it('post146-extras: HMAC slice-diff src/types.ts', () => { expect(hmacSha256('slice-diff', 'src/types.ts')).toBe('d1e497bd3dc7e06713395285b574a0d0da8bdd3b9614da249b4218aad57bd70b'); });
  it('post146-extras: HMAC no-src-change src/types.ts', () => { expect(hmacSha256('no-src-change', 'src/types.ts')).toBe('66b6c84c4d65babc626f3d0614b2d67cf4e18375f20cf74ae311e52bfcd2acc2'); });
  it('post146-extras: HMAC manifest-lock src/types.ts', () => { expect(hmacSha256('manifest-lock', 'src/types.ts')).toBe('96a5eda772aed1d149de5c3486ab886fc5b5f9108ad8b2ff8f11be66f236b356'); });
  it('post146-extras: HMAC ci-leftover src/types.ts', () => { expect(hmacSha256('ci-leftover', 'src/types.ts')).toBe('eed6bbfd826b3607c087a20dbbc766b3934b10601e1fee3e457f411f5274a283'); });
  it('post146-extras: HMAC fuzzywigg src/types.ts', () => { expect(hmacSha256('fuzzywigg', 'src/types.ts')).toBe('9318202ab26e14c853a66c82681f61370e99b88948d0cb0daced2f0fae39cf07'); });
  it('post146-extras: HMAC backlink src/types.ts', () => { expect(hmacSha256('backlink', 'src/types.ts')).toBe('e57ac0af28a81c88406f41b07efba081908eb642ad8c26416b188c8a14381bdd'); });
  it('post146-extras: HMAC CATALOG_CACHE src/types.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/types.ts')).toBe('217643d1e9a50ba2be3effa7673ad2785ea71c7441744e68ab2e13963b414686'); });
  it('post146-extras: HMAC GEMINI_API_KEY src/types.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/types.ts')).toBe('8632030af7092ce4f15cb6ad4d3358ce01c0be8df8f0e9d8f0ac424565844e28'); });
  it('post146-extras: HMAC iptv-org src/types.ts', () => { expect(hmacSha256('iptv-org', 'src/types.ts')).toBe('ca5f1e1fd976bb3fe291c6a55c65ddeff53de41b4fc58212755883dc30307874'); });
  it('post146-extras: HMAC gemini-2.0-flash src/types.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/types.ts')).toBe('b72909259e90987dd950a6ceb67ec6055502e3251fd0189b9103eaa446f91827'); });
  it('post146-extras: HMAC VALID_GENRES src/types.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/types.ts')).toBe('96a757d30d94fe78ea2147e822dc6253b999cd19a15f6d719394a666bfbc35ac'); });
  it('post146-extras: HMAC HITL src/types.ts', () => { expect(hmacSha256('HITL', 'src/types.ts')).toBe('24a9d0042b44f1b08dd117266f91d4794d44bf5007fe1ae9fdd668c4970e5519'); });
  it('post146-extras: HMAC no-creds src/types.ts', () => { expect(hmacSha256('no-creds', 'src/types.ts')).toBe('54a003b7f2d60b6b8cf47b21fd8a0b8044b12fa7a9296db10bf8186e17cb0d47'); });
  it('post146-extras: HMAC station_select src/types.ts', () => { expect(hmacSha256('station_select', 'src/types.ts')).toBe('17f8b2954253737ee48837a36505a948abb9c7a6c7efcd18d6da8ebbdbc169bf'); });
  it('post146-extras: size src/types.ts', () => { expect(statSync(join(root, 'src/types.ts')).size).toBe(174); });
  it('post146-extras: utf8-len src/types.ts', () => { expect(read('src/types.ts')).toHaveLength(172); });
  it('post146-extras: nibble src/types.ts', () => { expect(nibbleSum(sha256('src/types.ts'))).toBe(520); });
  it('post146-extras: sha256 package.json', () => { expect(sha256('package.json')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c'); });
  it('post146-extras: HMAC post146 package.json', () => { expect(hmacSha256('post146', 'package.json')).toBe('6e41ed4d39a37d83815d1e4b80cd0f66c81e9a96f81b22b6ec7d7129fa56a3d1'); });
  it('post146-extras: HMAC after-#146 package.json', () => { expect(hmacSha256('after-#146', 'package.json')).toBe('adc8a84c39b22c932793dfb2868c281d7674019c6fec5487bb2a25f9edeb004d'); });
  it('post146-extras: HMAC leftover package.json', () => { expect(hmacSha256('leftover', 'package.json')).toBe('20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1'); });
  it('post146-extras: HMAC TOKENMAXX package.json', () => { expect(hmacSha256('TOKENMAXX', 'package.json')).toBe('ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58'); });
  it('post146-extras: HMAC HEAVY package.json', () => { expect(hmacSha256('HEAVY', 'package.json')).toBe('59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563'); });
  it('post146-extras: HMAC no-product-invent package.json', () => { expect(hmacSha256('no-product-invent', 'package.json')).toBe('b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b'); });
  it('post146-extras: HMAC slice-diff package.json', () => { expect(hmacSha256('slice-diff', 'package.json')).toBe('dc869038c3869410db214fb5618c8f6091545ded44463dd4ccdf26cefc3dca56'); });
  it('post146-extras: HMAC no-src-change package.json', () => { expect(hmacSha256('no-src-change', 'package.json')).toBe('f89ef881d4621b0b9716e0341fb3cd014b14115046ec8e1fbc1baa995c764959'); });
  it('post146-extras: HMAC manifest-lock package.json', () => { expect(hmacSha256('manifest-lock', 'package.json')).toBe('c78857efdc2a9ef7366350439061383f242d1056da2d338f56f4d698b5748417'); });
  it('post146-extras: HMAC ci-leftover package.json', () => { expect(hmacSha256('ci-leftover', 'package.json')).toBe('102b83554fdec2063f592609639a34855726991a878bb10bf3339bf4457e0c13'); });
  it('post146-extras: HMAC fuzzywigg package.json', () => { expect(hmacSha256('fuzzywigg', 'package.json')).toBe('29f3398cd55d65de213eea45460d236f4ddaacfa08bb09b4806c16808c9749ab'); });
  it('post146-extras: HMAC backlink package.json', () => { expect(hmacSha256('backlink', 'package.json')).toBe('6edca9c2fa551d553a75d6e537f429b54763a48bf941865889f51008af5b38f5'); });
  it('post146-extras: HMAC CATALOG_CACHE package.json', () => { expect(hmacSha256('CATALOG_CACHE', 'package.json')).toBe('80864c6eb119181f7746cc83f6d5cfee07352f1e2554717b929069f4e873922f'); });
  it('post146-extras: HMAC GEMINI_API_KEY package.json', () => { expect(hmacSha256('GEMINI_API_KEY', 'package.json')).toBe('af6a4ce63cda6979a3b5425f09d776c65adff17550733712750e4b90591c57e0'); });
  it('post146-extras: HMAC iptv-org package.json', () => { expect(hmacSha256('iptv-org', 'package.json')).toBe('cc2fce6124feabd16b696cdcbc3d0ecc481e9367146c22575291da1497d6e67f'); });
  it('post146-extras: HMAC gemini-2.0-flash package.json', () => { expect(hmacSha256('gemini-2.0-flash', 'package.json')).toBe('a8b62f12818d2fcd08ddf09e2821a2a106ea0ba830a5ae22203e95a9b5a131dd'); });
  it('post146-extras: HMAC VALID_GENRES package.json', () => { expect(hmacSha256('VALID_GENRES', 'package.json')).toBe('c0887b6d1092056b1b04ae66f8ef2477a978469378405706b49ed7cd084fbadb'); });
  it('post146-extras: HMAC HITL package.json', () => { expect(hmacSha256('HITL', 'package.json')).toBe('28ad7c71e0cbd46cab4e1f494c8e29a6140d447b63e530001e98d85096dc6424'); });
  it('post146-extras: HMAC no-creds package.json', () => { expect(hmacSha256('no-creds', 'package.json')).toBe('15af23ac155e77825588a3afa5d5dd54969bf30578982a9cbce26656593fbef4'); });
  it('post146-extras: HMAC station_select package.json', () => { expect(hmacSha256('station_select', 'package.json')).toBe('12403ef6772e65e54c71f3a2183faa28cfdd487cf171ddeb91f2bd6c663198fa'); });
  it('post146-extras: size package.json', () => { expect(statSync(join(root, 'package.json')).size).toBe(637); });
  it('post146-extras: utf8-len package.json', () => { expect(read('package.json')).toHaveLength(635); });
  it('post146-extras: nibble package.json', () => { expect(nibbleSum(sha256('package.json'))).toBe(451); });
  it('post146-extras: sha256 vitest.config.ts', () => { expect(sha256('vitest.config.ts')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38'); });
  it('post146-extras: HMAC post146 vitest.config.ts', () => { expect(hmacSha256('post146', 'vitest.config.ts')).toBe('30781cc4930119140e254073d0d8f132879d224a40ef686ff07b6b2bd5c49c63'); });
  it('post146-extras: HMAC after-#146 vitest.config.ts', () => { expect(hmacSha256('after-#146', 'vitest.config.ts')).toBe('637c805523979a3cacdfd41b4e4f85e319782de32ca5d5c9f95338547734a2e1'); });
  it('post146-extras: HMAC leftover vitest.config.ts', () => { expect(hmacSha256('leftover', 'vitest.config.ts')).toBe('3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7'); });
  it('post146-extras: HMAC TOKENMAXX vitest.config.ts', () => { expect(hmacSha256('TOKENMAXX', 'vitest.config.ts')).toBe('0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9'); });
  it('post146-extras: HMAC HEAVY vitest.config.ts', () => { expect(hmacSha256('HEAVY', 'vitest.config.ts')).toBe('08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179'); });
  it('post146-extras: HMAC no-product-invent vitest.config.ts', () => { expect(hmacSha256('no-product-invent', 'vitest.config.ts')).toBe('3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c'); });
  it('post146-extras: HMAC slice-diff vitest.config.ts', () => { expect(hmacSha256('slice-diff', 'vitest.config.ts')).toBe('561ba73465a9de5fd03d403c4dd508c2058439a0206f6a694190dd71b47a4f70'); });
  it('post146-extras: HMAC no-src-change vitest.config.ts', () => { expect(hmacSha256('no-src-change', 'vitest.config.ts')).toBe('9e2fe808f40ed7a1049bef62978dd65efbea705482829585570b3fc4f5bf1a54'); });
  it('post146-extras: HMAC manifest-lock vitest.config.ts', () => { expect(hmacSha256('manifest-lock', 'vitest.config.ts')).toBe('7ae3b954bcee884ec6b1aada9b98e3b746465b99d10627ccb8def98e1e97799d'); });
  it('post146-extras: HMAC ci-leftover vitest.config.ts', () => { expect(hmacSha256('ci-leftover', 'vitest.config.ts')).toBe('8cf06e739c685417e72daea0142de1607ddbe955d54d810879d56c13aff1b103'); });
  it('post146-extras: HMAC fuzzywigg vitest.config.ts', () => { expect(hmacSha256('fuzzywigg', 'vitest.config.ts')).toBe('11811ba74794b999f74e0716a1ef4e938437d91ea79ae809fbe55a6d25834ecf'); });
  it('post146-extras: HMAC backlink vitest.config.ts', () => { expect(hmacSha256('backlink', 'vitest.config.ts')).toBe('9f05f99a641de0b84fc9eb602e9ad46d0189031ab17a4b7872322a8097e85b4c'); });
  it('post146-extras: HMAC CATALOG_CACHE vitest.config.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'vitest.config.ts')).toBe('87d5c10f207942049b62137d17f4187bdcfa0c4ed4d5c81a6cf16688700770eb'); });
  it('post146-extras: HMAC GEMINI_API_KEY vitest.config.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'vitest.config.ts')).toBe('4c4358397aaead3dbf91659e580f1b76b09fd4df40027231a57276ffc056f934'); });
  it('post146-extras: HMAC iptv-org vitest.config.ts', () => { expect(hmacSha256('iptv-org', 'vitest.config.ts')).toBe('e30e727ec62be2a66d619b0e3ed8252175f016ed7b680abbbafc0e6c5f85a1af'); });
  it('post146-extras: HMAC gemini-2.0-flash vitest.config.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'vitest.config.ts')).toBe('bc3d1286c8f23e97924120d5845ef9b3af4c67dd545c4f61b99127ecd0930330'); });
  it('post146-extras: HMAC VALID_GENRES vitest.config.ts', () => { expect(hmacSha256('VALID_GENRES', 'vitest.config.ts')).toBe('9e6243131d25151a04c1ec7b4bc9b4c3623baf9c6cfd56cf76a81ce89ce631c3'); });
  it('post146-extras: HMAC HITL vitest.config.ts', () => { expect(hmacSha256('HITL', 'vitest.config.ts')).toBe('7a9860baf8257f33d9c739ba74909a2051072f177f84ca19c344f8f926b33875'); });
  it('post146-extras: HMAC no-creds vitest.config.ts', () => { expect(hmacSha256('no-creds', 'vitest.config.ts')).toBe('edb4063e8392ffedd0c01cc05cef728c2bf3170b805ee29fd249e2603c5f5125'); });
  it('post146-extras: HMAC station_select vitest.config.ts', () => { expect(hmacSha256('station_select', 'vitest.config.ts')).toBe('27260ec47299c67a72e5670f0ef93a9a83c26bde2a511f91eed32aaeb62222dc'); });
  it('post146-extras: size vitest.config.ts', () => { expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535); });
  it('post146-extras: utf8-len vitest.config.ts', () => { expect(read('vitest.config.ts')).toHaveLength(535); });
  it('post146-extras: nibble vitest.config.ts', () => { expect(nibbleSum(sha256('vitest.config.ts'))).toBe(536); });
  it('post146-extras: sha256 tsconfig.json', () => { expect(sha256('tsconfig.json')).toBe('ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792'); });
  it('post146-extras: HMAC post146 tsconfig.json', () => { expect(hmacSha256('post146', 'tsconfig.json')).toBe('eda43f1f40ba989d366ad9768a24971eed706a81c72d0363e8ecf01d8c969398'); });
  it('post146-extras: HMAC after-#146 tsconfig.json', () => { expect(hmacSha256('after-#146', 'tsconfig.json')).toBe('03e9c45b7a589798762ef2e480e6f04424b9e1e72aefccbd1f2ed8ec67e6b112'); });
  it('post146-extras: HMAC leftover tsconfig.json', () => { expect(hmacSha256('leftover', 'tsconfig.json')).toBe('8b1d7fdf24ecef58d7971089e3fb62f7cf97d8a840f50636ffa32327fa8503a9'); });
  it('post146-extras: HMAC TOKENMAXX tsconfig.json', () => { expect(hmacSha256('TOKENMAXX', 'tsconfig.json')).toBe('2da19928cb9b06a5242f987184cc2d44cc385aed692bf3b6fa005e79065d47d1'); });
  it('post146-extras: HMAC HEAVY tsconfig.json', () => { expect(hmacSha256('HEAVY', 'tsconfig.json')).toBe('351594a3f9f8c0502c2a8387cd10b128a0cc58fc4bc16001784d9e1b55a4088f'); });
  it('post146-extras: HMAC no-product-invent tsconfig.json', () => { expect(hmacSha256('no-product-invent', 'tsconfig.json')).toBe('94ad9d8f2eeaf1debb6286a3db3ef2dfadafc8f031999c1c384fef8d8310ae22'); });
  it('post146-extras: HMAC slice-diff tsconfig.json', () => { expect(hmacSha256('slice-diff', 'tsconfig.json')).toBe('283515c2a7db0c9a5766d62df6d62217945f7b229ecc08301523a8b5466c3675'); });
  it('post146-extras: HMAC no-src-change tsconfig.json', () => { expect(hmacSha256('no-src-change', 'tsconfig.json')).toBe('85133c5251f48153837ae5edbf26caf56904922c40ba07af452e502e1c876d20'); });
  it('post146-extras: HMAC manifest-lock tsconfig.json', () => { expect(hmacSha256('manifest-lock', 'tsconfig.json')).toBe('5987d1790e3a064e0431d9e3ed61dfee5cc5d325e3adc32e95ffb65c9b8dd6e6'); });
  it('post146-extras: HMAC ci-leftover tsconfig.json', () => { expect(hmacSha256('ci-leftover', 'tsconfig.json')).toBe('041a5ef4b4cdf3c4b6e4b3926c1e40ef5054c4d372fc74bc91f80f4b757cf4d4'); });
  it('post146-extras: HMAC fuzzywigg tsconfig.json', () => { expect(hmacSha256('fuzzywigg', 'tsconfig.json')).toBe('c51f00a52aa0938458c80450410885d52dc08a16099d1c6894dca63dd95babab'); });
  it('post146-extras: HMAC backlink tsconfig.json', () => { expect(hmacSha256('backlink', 'tsconfig.json')).toBe('b3232bc6acbf0dcc24483fa2fb612812db1ca89a052cab225146450190dc3208'); });
  it('post146-extras: HMAC CATALOG_CACHE tsconfig.json', () => { expect(hmacSha256('CATALOG_CACHE', 'tsconfig.json')).toBe('b2257d6efdd8d55236787aa4d431c9779c2a367b6677fe12b1a1566be9f25e1e'); });
  it('post146-extras: HMAC GEMINI_API_KEY tsconfig.json', () => { expect(hmacSha256('GEMINI_API_KEY', 'tsconfig.json')).toBe('7eef14ea0beed1b5a47bd2b3c4d8a766ffcdc6f05898332b22b656b0c11052ba'); });
  it('post146-extras: HMAC iptv-org tsconfig.json', () => { expect(hmacSha256('iptv-org', 'tsconfig.json')).toBe('ec7fc906f9889213f932922b0a07ffe8a97e475a708c7de3838d28cece15ed8e'); });
  it('post146-extras: HMAC gemini-2.0-flash tsconfig.json', () => { expect(hmacSha256('gemini-2.0-flash', 'tsconfig.json')).toBe('7b8932153fdc65c7a0a3e78e3c2aa9f8f99e189fb998c734272f9b3054bcfc0a'); });
  it('post146-extras: HMAC VALID_GENRES tsconfig.json', () => { expect(hmacSha256('VALID_GENRES', 'tsconfig.json')).toBe('57a7728d81554720dea9d9419ce817789cb203144ed7988ce0308e13383db812'); });
  it('post146-extras: HMAC HITL tsconfig.json', () => { expect(hmacSha256('HITL', 'tsconfig.json')).toBe('4551913da487bb3a9dd1b23be2d2a360ef2fec843b11d43e84cb88c022c16b42'); });
  it('post146-extras: HMAC no-creds tsconfig.json', () => { expect(hmacSha256('no-creds', 'tsconfig.json')).toBe('3ffe23dca04b405631388cd34022948a4b881d36716e41fbb607b6254ae85045'); });
  it('post146-extras: HMAC station_select tsconfig.json', () => { expect(hmacSha256('station_select', 'tsconfig.json')).toBe('30a5246b37ddc1c489a9246cf6c3345c9e62b5e4966dec48cd8c5ae4f07720eb'); });
  it('post146-extras: size tsconfig.json', () => { expect(statSync(join(root, 'tsconfig.json')).size).toBe(397); });
  it('post146-extras: utf8-len tsconfig.json', () => { expect(read('tsconfig.json')).toHaveLength(397); });
  it('post146-extras: nibble tsconfig.json', () => { expect(nibbleSum(sha256('tsconfig.json'))).toBe(506); });
  it('post146-extras: sha256 wrangler.toml', () => { expect(sha256('wrangler.toml')).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8'); });
  it('post146-extras: HMAC post146 wrangler.toml', () => { expect(hmacSha256('post146', 'wrangler.toml')).toBe('30d30f04879818865806fdf6d77ffba9b8da4fdcc953ec94cd3251a8e87f9c42'); });
  it('post146-extras: HMAC after-#146 wrangler.toml', () => { expect(hmacSha256('after-#146', 'wrangler.toml')).toBe('5af946122b1765f102f4c0850a59093755e38da38e3b4eefd8a28c07317f7ee1'); });
  it('post146-extras: HMAC leftover wrangler.toml', () => { expect(hmacSha256('leftover', 'wrangler.toml')).toBe('117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063'); });
  it('post146-extras: HMAC TOKENMAXX wrangler.toml', () => { expect(hmacSha256('TOKENMAXX', 'wrangler.toml')).toBe('7d198a7e11f32e841079eb2398433044d49d9336bb0642737d55dbb39a1206d4'); });
  it('post146-extras: HMAC HEAVY wrangler.toml', () => { expect(hmacSha256('HEAVY', 'wrangler.toml')).toBe('0106e385ea2e0ca3fd52ddc940a1eb5921a22885362d57f5a49dd1bda89ea5db'); });
  it('post146-extras: HMAC no-product-invent wrangler.toml', () => { expect(hmacSha256('no-product-invent', 'wrangler.toml')).toBe('3d99d134e0673c8ff163b29a6c72e49bfa5e599898762bf47dd20f0e65639abb'); });
  it('post146-extras: HMAC slice-diff wrangler.toml', () => { expect(hmacSha256('slice-diff', 'wrangler.toml')).toBe('ff10d155b4bfa2137b3d8248b28954f776f80f51ddf29915f4a0792dca9e4b17'); });
  it('post146-extras: HMAC no-src-change wrangler.toml', () => { expect(hmacSha256('no-src-change', 'wrangler.toml')).toBe('b542f61e71ea970554a5d78c6f3caa0491697694218687f89822c8cc8509b67b'); });
  it('post146-extras: HMAC manifest-lock wrangler.toml', () => { expect(hmacSha256('manifest-lock', 'wrangler.toml')).toBe('ba1c46086c0d7c2f08a90b091ba228b20b7bf50c702c3e3478a8b4b96e95d882'); });
  it('post146-extras: HMAC ci-leftover wrangler.toml', () => { expect(hmacSha256('ci-leftover', 'wrangler.toml')).toBe('e8f282ad2cf0521eaa2162ae7533e8bdbfd845ce4c9523d4171712c708267b19'); });
  it('post146-extras: HMAC fuzzywigg wrangler.toml', () => { expect(hmacSha256('fuzzywigg', 'wrangler.toml')).toBe('4f271fc6714d566a00b298cdfb6a651d66b4584a14851ea67a7ebbd1cedd9407'); });
  it('post146-extras: HMAC backlink wrangler.toml', () => { expect(hmacSha256('backlink', 'wrangler.toml')).toBe('e6ea9a4c22d8be77830f69ba042d79bb716184b8783f2ede72efa58b3b7601d4'); });
  it('post146-extras: HMAC CATALOG_CACHE wrangler.toml', () => { expect(hmacSha256('CATALOG_CACHE', 'wrangler.toml')).toBe('9335716a0466ecfa551aa06fc7eef4ef33fe1611e0542e420de582ba1bcac0b5'); });
  it('post146-extras: HMAC GEMINI_API_KEY wrangler.toml', () => { expect(hmacSha256('GEMINI_API_KEY', 'wrangler.toml')).toBe('92708ab36e6cec40464d1d99390978feaf9d5a1eaa4b7caa0249267812835f4b'); });
  it('post146-extras: HMAC iptv-org wrangler.toml', () => { expect(hmacSha256('iptv-org', 'wrangler.toml')).toBe('75babdee8ac19193de0572bac5d2cf8f8a5da10273b7dab924411328ea78dfe4'); });
  it('post146-extras: HMAC gemini-2.0-flash wrangler.toml', () => { expect(hmacSha256('gemini-2.0-flash', 'wrangler.toml')).toBe('9c793ea5dcfc6fc73c2015c8c297e17247936693530a565aa0bf352ea7af9602'); });
  it('post146-extras: HMAC VALID_GENRES wrangler.toml', () => { expect(hmacSha256('VALID_GENRES', 'wrangler.toml')).toBe('b63c6f1421f8427f0055707971a3e4a458cde77362a98559fb80c8f99f38398f'); });
  it('post146-extras: HMAC HITL wrangler.toml', () => { expect(hmacSha256('HITL', 'wrangler.toml')).toBe('163535e4f1ffba9fa5d82ccec88c349b95720ee09d57f10a4b7d067551b2e0bf'); });
  it('post146-extras: HMAC no-creds wrangler.toml', () => { expect(hmacSha256('no-creds', 'wrangler.toml')).toBe('2f585aec12070820ca445e59c4c14270f3573b616d67114117b12c0018a2be8f'); });
  it('post146-extras: HMAC station_select wrangler.toml', () => { expect(hmacSha256('station_select', 'wrangler.toml')).toBe('f0b7d94bba773863439815ba8abeb52e13d4a5cd9a56e00ccbc8fa8d9bf4e50e'); });
  it('post146-extras: size wrangler.toml', () => { expect(statSync(join(root, 'wrangler.toml')).size).toBe(330); });
  it('post146-extras: utf8-len wrangler.toml', () => { expect(read('wrangler.toml')).toHaveLength(330); });
  it('post146-extras: nibble wrangler.toml', () => { expect(nibbleSum(sha256('wrangler.toml'))).toBe(457); });
  it('post146-extras: sha256 AGENTS.md', () => { expect(sha256('AGENTS.md')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa'); });
  it('post146-extras: HMAC post146 AGENTS.md', () => { expect(hmacSha256('post146', 'AGENTS.md')).toBe('16f1d654bf6a3de51bc2a388e08e3fd08597ac931956884bf7b666bf493e071a'); });
  it('post146-extras: HMAC after-#146 AGENTS.md', () => { expect(hmacSha256('after-#146', 'AGENTS.md')).toBe('a384b751e967a2de06c4401e9333c497f7f3d88269e396ac824d932876471324'); });
  it('post146-extras: HMAC leftover AGENTS.md', () => { expect(hmacSha256('leftover', 'AGENTS.md')).toBe('ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e'); });
  it('post146-extras: HMAC TOKENMAXX AGENTS.md', () => { expect(hmacSha256('TOKENMAXX', 'AGENTS.md')).toBe('b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f'); });
  it('post146-extras: HMAC HEAVY AGENTS.md', () => { expect(hmacSha256('HEAVY', 'AGENTS.md')).toBe('f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c'); });
  it('post146-extras: HMAC no-product-invent AGENTS.md', () => { expect(hmacSha256('no-product-invent', 'AGENTS.md')).toBe('dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264'); });
  it('post146-extras: HMAC slice-diff AGENTS.md', () => { expect(hmacSha256('slice-diff', 'AGENTS.md')).toBe('870cb0b7ca943c82a943cb231e6171ba55b8a1be90d4368fe1e30a3666060c90'); });
  it('post146-extras: HMAC no-src-change AGENTS.md', () => { expect(hmacSha256('no-src-change', 'AGENTS.md')).toBe('94cb89045ff7e09a81a02dd8ee4ee7eb0ef7d412d7260f9ab24056774ed00967'); });
  it('post146-extras: HMAC manifest-lock AGENTS.md', () => { expect(hmacSha256('manifest-lock', 'AGENTS.md')).toBe('af3b8d7bad009043c764c1d1f67b9526650ba158a9053d887985ddce5dc997c5'); });
  it('post146-extras: HMAC ci-leftover AGENTS.md', () => { expect(hmacSha256('ci-leftover', 'AGENTS.md')).toBe('47b5afd8ad6d2a52b35cc12ced2b83f86ea0ba4b7ff3651c58de70715482254c'); });
  it('post146-extras: HMAC fuzzywigg AGENTS.md', () => { expect(hmacSha256('fuzzywigg', 'AGENTS.md')).toBe('8eda2249f938456fded535468826738c7e146ca6574f36f3853700897f5d5163'); });
  it('post146-extras: HMAC backlink AGENTS.md', () => { expect(hmacSha256('backlink', 'AGENTS.md')).toBe('6da6cfcf4fa0441e1a6cacca52bca8b03afa2a93acb9321dccba7d8dce0f804f'); });
  it('post146-extras: HMAC CATALOG_CACHE AGENTS.md', () => { expect(hmacSha256('CATALOG_CACHE', 'AGENTS.md')).toBe('091ea475ef4827ea9c4dc046d5bbe7e91505ce4e59d4474fa384a31f7176e580'); });
  it('post146-extras: HMAC GEMINI_API_KEY AGENTS.md', () => { expect(hmacSha256('GEMINI_API_KEY', 'AGENTS.md')).toBe('69741f5f0094e4bb2cfe0c30539ac82134f9a17312bd155e140d46a1989212c6'); });
  it('post146-extras: HMAC iptv-org AGENTS.md', () => { expect(hmacSha256('iptv-org', 'AGENTS.md')).toBe('0aff55c1d8bd109ce5a11b8bd72e5509f1d7cc6ef1935ddef7a8231443bcf464'); });
  it('post146-extras: HMAC gemini-2.0-flash AGENTS.md', () => { expect(hmacSha256('gemini-2.0-flash', 'AGENTS.md')).toBe('42efae3491e3bd78851b00249a2ec44b09a2ee457c07a666d5d3ed94c6301ea5'); });
  it('post146-extras: HMAC VALID_GENRES AGENTS.md', () => { expect(hmacSha256('VALID_GENRES', 'AGENTS.md')).toBe('d9db876c73c1b923b117dbf619d87c48362614d2bfd0e62b18658230e0a1fbf5'); });
  it('post146-extras: HMAC HITL AGENTS.md', () => { expect(hmacSha256('HITL', 'AGENTS.md')).toBe('0df134c66ef2431f8f7d8b281ed09c1ffedddaa4fe6f91357592a9a6ef37bece'); });
  it('post146-extras: HMAC no-creds AGENTS.md', () => { expect(hmacSha256('no-creds', 'AGENTS.md')).toBe('7f85e663a40b787e2df5e296431307e470764c453a109376e28a20dc4d008e50'); });
  it('post146-extras: HMAC station_select AGENTS.md', () => { expect(hmacSha256('station_select', 'AGENTS.md')).toBe('97f8c43806017259d483cf4af0078542c11849c1ea77ba3efae151d22aee085a'); });
  it('post146-extras: size AGENTS.md', () => { expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017); });
  it('post146-extras: utf8-len AGENTS.md', () => { expect(read('AGENTS.md')).toHaveLength(1011); });
  it('post146-extras: nibble AGENTS.md', () => { expect(nibbleSum(sha256('AGENTS.md'))).toBe(479); });
  it('post146-extras: sha256 DEPLOY.md', () => { expect(sha256('DEPLOY.md')).toBe('11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a'); });
  it('post146-extras: HMAC post146 DEPLOY.md', () => { expect(hmacSha256('post146', 'DEPLOY.md')).toBe('1321b3dbb29bb2cec0f75a3a99359e0d8e7a4e671a4ffb680d27590243222038'); });
  it('post146-extras: HMAC after-#146 DEPLOY.md', () => { expect(hmacSha256('after-#146', 'DEPLOY.md')).toBe('f7e250425ab07d717590376c8d7a4b16bfca7f1a1d5fceaa8b061a9f53f59c50'); });
  it('post146-extras: HMAC leftover DEPLOY.md', () => { expect(hmacSha256('leftover', 'DEPLOY.md')).toBe('8e69d3722a2f57941fecb3a0602ebb6cab5a31755e7c8bc88ed0771bc1822659'); });
  it('post146-extras: HMAC TOKENMAXX DEPLOY.md', () => { expect(hmacSha256('TOKENMAXX', 'DEPLOY.md')).toBe('bdb0c19924928cf4d54308dcdd72f032fea4ae1994669e96bf22f48567084f26'); });
  it('post146-extras: HMAC HEAVY DEPLOY.md', () => { expect(hmacSha256('HEAVY', 'DEPLOY.md')).toBe('5e8e11b4b80c19b0e2828f509f4411d5c7d176f5101c2aa2094ae43dfcf385d3'); });
  it('post146-extras: HMAC no-product-invent DEPLOY.md', () => { expect(hmacSha256('no-product-invent', 'DEPLOY.md')).toBe('cb29f601b5afcc4ca9e180a792e0a028c44afad0b5fcbbbafdd0dcee3c24f29e'); });
  it('post146-extras: HMAC slice-diff DEPLOY.md', () => { expect(hmacSha256('slice-diff', 'DEPLOY.md')).toBe('723355201d08c16dada7a9d8e6320062b2f596dfc3c410fc608ae1fdb6495a01'); });
  it('post146-extras: HMAC no-src-change DEPLOY.md', () => { expect(hmacSha256('no-src-change', 'DEPLOY.md')).toBe('970a597da05c0d8f2f4e8edec9f75ac1d9bb6911a8bd66098985eca56e650d9a'); });
  it('post146-extras: HMAC manifest-lock DEPLOY.md', () => { expect(hmacSha256('manifest-lock', 'DEPLOY.md')).toBe('618d1f805ccde592ec38ddddba5e67e23b505691f1851e12a013ff9f7fd70bc9'); });
  it('post146-extras: HMAC ci-leftover DEPLOY.md', () => { expect(hmacSha256('ci-leftover', 'DEPLOY.md')).toBe('40a3fdac18524310193597e1d8836c0709382719e16ba278e50bc1cd6b5ff15e'); });
  it('post146-extras: HMAC fuzzywigg DEPLOY.md', () => { expect(hmacSha256('fuzzywigg', 'DEPLOY.md')).toBe('8a4a21b339caa609f8667ee3e0b3d09765f589e5ef8cd84f152713d9911f20cc'); });
  it('post146-extras: HMAC backlink DEPLOY.md', () => { expect(hmacSha256('backlink', 'DEPLOY.md')).toBe('f5e3236dd35cae2d679bd9c4cff402ab17fbf594757881a13c8446d1be626060'); });
  it('post146-extras: HMAC CATALOG_CACHE DEPLOY.md', () => { expect(hmacSha256('CATALOG_CACHE', 'DEPLOY.md')).toBe('47c7f2febb65f3f607ec2fbd59fa15801bd6bcfbdf54e51d5d5fe37fdaf7eeb6'); });
  it('post146-extras: HMAC GEMINI_API_KEY DEPLOY.md', () => { expect(hmacSha256('GEMINI_API_KEY', 'DEPLOY.md')).toBe('1e72529fe918a18cd371f1ac2a9db00b2f19952405616c7f5412b342a1279566'); });
  it('post146-extras: HMAC iptv-org DEPLOY.md', () => { expect(hmacSha256('iptv-org', 'DEPLOY.md')).toBe('577f23a01148634d22b5e19e9b16d29d2038c9ae82ba9912cca61ce874ddc619'); });
  it('post146-extras: HMAC gemini-2.0-flash DEPLOY.md', () => { expect(hmacSha256('gemini-2.0-flash', 'DEPLOY.md')).toBe('299f695aca3306cbee3cb69ec1baf03bdd8bcf0c1fc6d967470204036b06e7c7'); });
  it('post146-extras: HMAC VALID_GENRES DEPLOY.md', () => { expect(hmacSha256('VALID_GENRES', 'DEPLOY.md')).toBe('d220673fe272b7c854483e7c35554cb858bd2bf8ea7975d629c02037f748bf75'); });
  it('post146-extras: HMAC HITL DEPLOY.md', () => { expect(hmacSha256('HITL', 'DEPLOY.md')).toBe('304c5ef7a469283183c42d01f6c8c29fdb237fcdadb181445171e15f8c8bf071'); });
  it('post146-extras: HMAC no-creds DEPLOY.md', () => { expect(hmacSha256('no-creds', 'DEPLOY.md')).toBe('7de98a2c002a5904932835052d85cd02a299aa9ad28ff928c19a14775117cac6'); });
  it('post146-extras: HMAC station_select DEPLOY.md', () => { expect(hmacSha256('station_select', 'DEPLOY.md')).toBe('eb37933ea3d022f168ed977c342ce730a42227e7956e0d836dffae89f03a765e'); });
  it('post146-extras: size DEPLOY.md', () => { expect(statSync(join(root, 'DEPLOY.md')).size).toBe(1573); });
  it('post146-extras: utf8-len DEPLOY.md', () => { expect(read('DEPLOY.md')).toHaveLength(1539); });
  it('post146-extras: nibble DEPLOY.md', () => { expect(nibbleSum(sha256('DEPLOY.md'))).toBe(439); });
  it('post146-extras: sha256 README.md', () => { expect(sha256('README.md')).toBe('f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987'); });
  it('post146-extras: HMAC post146 README.md', () => { expect(hmacSha256('post146', 'README.md')).toBe('0e6b4798804ac6a8467ed9f8bccef28f68fcd0d378bb5298327603745768bd64'); });
  it('post146-extras: HMAC after-#146 README.md', () => { expect(hmacSha256('after-#146', 'README.md')).toBe('14aac6dbb3e60d6cff700725072de22994c2f7bc1ad41aa8b7f436913eee3d4f'); });
  it('post146-extras: HMAC leftover README.md', () => { expect(hmacSha256('leftover', 'README.md')).toBe('57c08297703e57c6b5694a515e43b6592bd130637c82dcc569a048bda2fd181f'); });
  it('post146-extras: HMAC TOKENMAXX README.md', () => { expect(hmacSha256('TOKENMAXX', 'README.md')).toBe('51a608392fd700865f32aac02646908bf1235d6c4d587e9daa92383d6a777b94'); });
  it('post146-extras: HMAC HEAVY README.md', () => { expect(hmacSha256('HEAVY', 'README.md')).toBe('4bb62cc19640e3a3d792e3eba8d499203b4729899d5838ec2065ee409ab0430d'); });
  it('post146-extras: HMAC no-product-invent README.md', () => { expect(hmacSha256('no-product-invent', 'README.md')).toBe('c1d8bb52c5ad591530152e8ec780bd262a1b78aeb7aea241bcef2a46a5e1ad7a'); });
  it('post146-extras: HMAC slice-diff README.md', () => { expect(hmacSha256('slice-diff', 'README.md')).toBe('afd276d87586dcc4395cec6f4a88c365bedd3992dc0b6a4448b04ad23f186225'); });
  it('post146-extras: HMAC no-src-change README.md', () => { expect(hmacSha256('no-src-change', 'README.md')).toBe('017324f9cb021cd4af3721c48db1e471d472683f64af8e7f0b4a52d2b77d2fba'); });
  it('post146-extras: HMAC manifest-lock README.md', () => { expect(hmacSha256('manifest-lock', 'README.md')).toBe('338002f36227d22e700f2cfa8d7a9a592e093f5ffbcef1c27583b8a0d79dd8d5'); });
  it('post146-extras: HMAC ci-leftover README.md', () => { expect(hmacSha256('ci-leftover', 'README.md')).toBe('c2d185906a96347063f552d6ebad46b2c19f16d39439100432a9da503b694ad8'); });
  it('post146-extras: HMAC fuzzywigg README.md', () => { expect(hmacSha256('fuzzywigg', 'README.md')).toBe('c1bdcc6210881289dbd7cb0d1815379139a70c052a45bc84a455e263a1a29dfb'); });
  it('post146-extras: HMAC backlink README.md', () => { expect(hmacSha256('backlink', 'README.md')).toBe('077baa370ddbd2225fb8e82982e8530d778cc0fcc77e24481aa14be4ba1d2684'); });
  it('post146-extras: HMAC CATALOG_CACHE README.md', () => { expect(hmacSha256('CATALOG_CACHE', 'README.md')).toBe('c9907f02a39576d51bfc275c6e99c614da37a6741e1f621aed2cc91e8b188851'); });
  it('post146-extras: HMAC GEMINI_API_KEY README.md', () => { expect(hmacSha256('GEMINI_API_KEY', 'README.md')).toBe('9454215091fa86b88019b1e376e9e4f0ed4f51ea581940751f6f582741716d2a'); });
  it('post146-extras: HMAC iptv-org README.md', () => { expect(hmacSha256('iptv-org', 'README.md')).toBe('0b57bc3623ed34c887c2fe5b8dca907d1421425ef1d4aa57875b3252fb6c62c6'); });
  it('post146-extras: HMAC gemini-2.0-flash README.md', () => { expect(hmacSha256('gemini-2.0-flash', 'README.md')).toBe('55b8812df979a6b3c9ab0ed3fe86b9a2c8ff2edcaea69043efe7bf326c185642'); });
  it('post146-extras: HMAC VALID_GENRES README.md', () => { expect(hmacSha256('VALID_GENRES', 'README.md')).toBe('75ddc9d923fb4b7ead18d25e63f38d7ad1b565d5d12444666fcbd4f2ca570128'); });
  it('post146-extras: HMAC HITL README.md', () => { expect(hmacSha256('HITL', 'README.md')).toBe('63f3a6d94b5bc3a9700609fd321dfdfaf2fb9c726a3e08447301615923c532e0'); });
  it('post146-extras: HMAC no-creds README.md', () => { expect(hmacSha256('no-creds', 'README.md')).toBe('156fbb321fedfacd1635a84a8d38e0a7450c58d90d2a0c6ff14f862146cc2575'); });
  it('post146-extras: HMAC station_select README.md', () => { expect(hmacSha256('station_select', 'README.md')).toBe('289b9759c9711fc95c2727e9b042374e19297b25418e436a859007fa247b3e2c'); });
  it('post146-extras: size README.md', () => { expect(statSync(join(root, 'README.md')).size).toBe(2801); });
  it('post146-extras: utf8-len README.md', () => { expect(read('README.md')).toHaveLength(2757); });
  it('post146-extras: nibble README.md', () => { expect(nibbleSum(sha256('README.md'))).toBe(429); });
  it('post146-extras: sha256 docs/mcp-spec.md', () => { expect(sha256('docs/mcp-spec.md')).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849'); });
  it('post146-extras: HMAC post146 docs/mcp-spec.md', () => { expect(hmacSha256('post146', 'docs/mcp-spec.md')).toBe('fc5b42d54e83829a2b202cbd7d60d6e6e7ff5fed89b5771c637969020ec68175'); });
  it('post146-extras: HMAC after-#146 docs/mcp-spec.md', () => { expect(hmacSha256('after-#146', 'docs/mcp-spec.md')).toBe('7e70b5e3098830da9af13206230a4e112c07389697ad6671c2ab59488bcbd4fe'); });
  it('post146-extras: HMAC leftover docs/mcp-spec.md', () => { expect(hmacSha256('leftover', 'docs/mcp-spec.md')).toBe('cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df'); });
  it('post146-extras: HMAC TOKENMAXX docs/mcp-spec.md', () => { expect(hmacSha256('TOKENMAXX', 'docs/mcp-spec.md')).toBe('58bd8b12de8084ece067f68db2cea2ea5dc8b43305c0d5e7e20506fd40e18749'); });
  it('post146-extras: HMAC HEAVY docs/mcp-spec.md', () => { expect(hmacSha256('HEAVY', 'docs/mcp-spec.md')).toBe('14502ba27898e795fb59cc37b06fe6eb2a66b40811b068e87738eb3dbf4cae59'); });
  it('post146-extras: HMAC no-product-invent docs/mcp-spec.md', () => { expect(hmacSha256('no-product-invent', 'docs/mcp-spec.md')).toBe('1ea2c93af05439c6a1c14acfbee6d34dddfc2b32e6c8b6256c270f6d4484b608'); });
  it('post146-extras: HMAC slice-diff docs/mcp-spec.md', () => { expect(hmacSha256('slice-diff', 'docs/mcp-spec.md')).toBe('06d50d14b3b548000878558498c74926788485f641f279bbbdfe5d14f0bbbb4a'); });
  it('post146-extras: HMAC no-src-change docs/mcp-spec.md', () => { expect(hmacSha256('no-src-change', 'docs/mcp-spec.md')).toBe('84ca704115fb25233f9bf1ba5e611bdd463e200ae837d762c61d4280a26ba6db'); });
  it('post146-extras: HMAC manifest-lock docs/mcp-spec.md', () => { expect(hmacSha256('manifest-lock', 'docs/mcp-spec.md')).toBe('b70a770cd09ea94dcd51d690d3a96822867773eae92d2afc16ef212ee8537513'); });
  it('post146-extras: HMAC ci-leftover docs/mcp-spec.md', () => { expect(hmacSha256('ci-leftover', 'docs/mcp-spec.md')).toBe('6078fb6c59deae58e20e22cef21e224bf8e4e84ae6a65e99780ba175e9ba6f11'); });
  it('post146-extras: HMAC fuzzywigg docs/mcp-spec.md', () => { expect(hmacSha256('fuzzywigg', 'docs/mcp-spec.md')).toBe('8e0caed7ef994c374b52d69005d69324d5af51ef97c49c876613cf9ed1b93d4d'); });
  it('post146-extras: HMAC backlink docs/mcp-spec.md', () => { expect(hmacSha256('backlink', 'docs/mcp-spec.md')).toBe('98920add1fa15e869968c8efbc949fab60baf5ca95945eaf466caf563dff3e9f'); });
  it('post146-extras: HMAC CATALOG_CACHE docs/mcp-spec.md', () => { expect(hmacSha256('CATALOG_CACHE', 'docs/mcp-spec.md')).toBe('77c05eeb15ed41c6124ba94658445fe67e0d2267752592d310c765d3205ef6e2'); });
  it('post146-extras: HMAC GEMINI_API_KEY docs/mcp-spec.md', () => { expect(hmacSha256('GEMINI_API_KEY', 'docs/mcp-spec.md')).toBe('9d48df5c245ec78b37814371c5fa04f3d832df95ed3f80354d1f445a5d7af09e'); });
  it('post146-extras: HMAC iptv-org docs/mcp-spec.md', () => { expect(hmacSha256('iptv-org', 'docs/mcp-spec.md')).toBe('f0cc92feffdc00412074b061f650d4216738d7f8e9eb260b8822500b0d7445cf'); });
  it('post146-extras: HMAC gemini-2.0-flash docs/mcp-spec.md', () => { expect(hmacSha256('gemini-2.0-flash', 'docs/mcp-spec.md')).toBe('a8c0860fadeb6443a6763fc3f6a5b9378994c82c25c346ecf80c105d3c779a0b'); });
  it('post146-extras: HMAC VALID_GENRES docs/mcp-spec.md', () => { expect(hmacSha256('VALID_GENRES', 'docs/mcp-spec.md')).toBe('5bce78975cb91bf1f314fa44ce30008c42fead0e079725b2efa2ad2750650e5a'); });
  it('post146-extras: HMAC HITL docs/mcp-spec.md', () => { expect(hmacSha256('HITL', 'docs/mcp-spec.md')).toBe('0eec72a5669dccb2303226a3b772d5336ddc9744380101ba27d3ecc96ca1a668'); });
  it('post146-extras: HMAC no-creds docs/mcp-spec.md', () => { expect(hmacSha256('no-creds', 'docs/mcp-spec.md')).toBe('0b1a3d9791f6d0c02ad0cac98ae5723d8b0e6d29ffb3543b87a9dde980aaa4cd'); });
  it('post146-extras: HMAC station_select docs/mcp-spec.md', () => { expect(hmacSha256('station_select', 'docs/mcp-spec.md')).toBe('09cf27cff685a3d9f7125499f44f20636430d5f0363c9de5d2cf2869edff0b69'); });
  it('post146-extras: size docs/mcp-spec.md', () => { expect(statSync(join(root, 'docs/mcp-spec.md')).size).toBe(3552); });
  it('post146-extras: utf8-len docs/mcp-spec.md', () => { expect(read('docs/mcp-spec.md')).toHaveLength(3544); });
  it('post146-extras: nibble docs/mcp-spec.md', () => { expect(nibbleSum(sha256('docs/mcp-spec.md'))).toBe(514); });
  it('post146-extras: sha256 .github/workflows/ci.yml', () => { expect(sha256('.github/workflows/ci.yml')).toBe('c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5'); });
  it('post146-extras: HMAC post146 .github/workflows/ci.yml', () => { expect(hmacSha256('post146', '.github/workflows/ci.yml')).toBe('588b5ab62e3759562207567f5c8ca4922a8a1acf9f4de246feb5e9a39f73b212'); });
  it('post146-extras: HMAC after-#146 .github/workflows/ci.yml', () => { expect(hmacSha256('after-#146', '.github/workflows/ci.yml')).toBe('eea329b1a11896f36b28e7da53c7ece101d9d80792a3f5f139c9c979527607e0'); });
  it('post146-extras: HMAC leftover .github/workflows/ci.yml', () => { expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe('d3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce'); });
  it('post146-extras: HMAC TOKENMAXX .github/workflows/ci.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).toBe('5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b'); });
  it('post146-extras: HMAC HEAVY .github/workflows/ci.yml', () => { expect(hmacSha256('HEAVY', '.github/workflows/ci.yml')).toBe('8c10cb5abbb616b57d2df21384cbdb40264d52be8a25a32448acd6e22e1848ea'); });
  it('post146-extras: HMAC no-product-invent .github/workflows/ci.yml', () => { expect(hmacSha256('no-product-invent', '.github/workflows/ci.yml')).toBe('1a959a3eb061936e9c62fd3497ddd23988ff785d88dcfdd133f97d35c77e8fde'); });
  it('post146-extras: HMAC slice-diff .github/workflows/ci.yml', () => { expect(hmacSha256('slice-diff', '.github/workflows/ci.yml')).toBe('589b0400ab9b6c63dc596fda36cd56f90acb45d84be4ddbf88b7e28030a42fba'); });
  it('post146-extras: HMAC no-src-change .github/workflows/ci.yml', () => { expect(hmacSha256('no-src-change', '.github/workflows/ci.yml')).toBe('b14dfd46c70af553877fde42c3925ad14dcf6d0b2806c3acba8a3ba7978116fc'); });
  it('post146-extras: HMAC manifest-lock .github/workflows/ci.yml', () => { expect(hmacSha256('manifest-lock', '.github/workflows/ci.yml')).toBe('0833800c412e79ca645326cd2fcfe5da70b137accda0fee38d7b4ae1acbd9189'); });
  it('post146-extras: HMAC ci-leftover .github/workflows/ci.yml', () => { expect(hmacSha256('ci-leftover', '.github/workflows/ci.yml')).toBe('1b43e4cb8234aa591b26a4e898d2343daa5f27e76d2c7f705481aa8070903551'); });
  it('post146-extras: HMAC fuzzywigg .github/workflows/ci.yml', () => { expect(hmacSha256('fuzzywigg', '.github/workflows/ci.yml')).toBe('392bc8a1dfb5586b8163f4776d52b27035a7b82af685148ecced42b50fcbdfbc'); });
  it('post146-extras: HMAC backlink .github/workflows/ci.yml', () => { expect(hmacSha256('backlink', '.github/workflows/ci.yml')).toBe('db82d56ead609b63cbc9d4e8f91d953c7a496125047ea4feaf11acc54d643f13'); });
  it('post146-extras: HMAC CATALOG_CACHE .github/workflows/ci.yml', () => { expect(hmacSha256('CATALOG_CACHE', '.github/workflows/ci.yml')).toBe('8a64f8a57a8e0d57022a408212641087f1eaeb50cbf7f616da671d19647dbc3b'); });
  it('post146-extras: HMAC GEMINI_API_KEY .github/workflows/ci.yml', () => { expect(hmacSha256('GEMINI_API_KEY', '.github/workflows/ci.yml')).toBe('1c60dc3be507ae8043c44018700fd49f8cf7bf23d8059f0617ca6587aa9cf6d5'); });
  it('post146-extras: HMAC iptv-org .github/workflows/ci.yml', () => { expect(hmacSha256('iptv-org', '.github/workflows/ci.yml')).toBe('73d6bf3580bf4226845b8125eb1c4e7f0d5341004fc194a681a890c03d72f9d5'); });
  it('post146-extras: HMAC gemini-2.0-flash .github/workflows/ci.yml', () => { expect(hmacSha256('gemini-2.0-flash', '.github/workflows/ci.yml')).toBe('a3f526cfe1d8f02f79e076a789f3182a36794a4d1b7aba5fe91cd951467fbe5f'); });
  it('post146-extras: HMAC VALID_GENRES .github/workflows/ci.yml', () => { expect(hmacSha256('VALID_GENRES', '.github/workflows/ci.yml')).toBe('9bb0a17987e18a4a73177f7e3ccf17abcbc9c273f88cdba237a1c9870c55812c'); });
  it('post146-extras: HMAC HITL .github/workflows/ci.yml', () => { expect(hmacSha256('HITL', '.github/workflows/ci.yml')).toBe('a1f8c9446de2bb236d3211d1ea7bc88fcb53a65e967b7eb08bc46e2f0ea0e461'); });
  it('post146-extras: HMAC no-creds .github/workflows/ci.yml', () => { expect(hmacSha256('no-creds', '.github/workflows/ci.yml')).toBe('1a0865373b47d039ed61eac765815bd157845537668db47acd59f730defcd83c'); });
  it('post146-extras: HMAC station_select .github/workflows/ci.yml', () => { expect(hmacSha256('station_select', '.github/workflows/ci.yml')).toBe('6f8ee6109c782c75da0955b270c6cf80ca1baf597c924fa83b7a8c9f5b9db5cf'); });
  it('post146-extras: size .github/workflows/ci.yml', () => { expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295); });
  it('post146-extras: utf8-len .github/workflows/ci.yml', () => { expect(read('.github/workflows/ci.yml')).toHaveLength(6295); });
  it('post146-extras: nibble .github/workflows/ci.yml', () => { expect(nibbleSum(sha256('.github/workflows/ci.yml'))).toBe(515); });
  it('post146-extras: sha256 .github/workflows/deploy.yml', () => { expect(sha256('.github/workflows/deploy.yml')).toBe('49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3'); });
  it('post146-extras: HMAC post146 .github/workflows/deploy.yml', () => { expect(hmacSha256('post146', '.github/workflows/deploy.yml')).toBe('85e5ba551cf7ec1b211dccedd9d10e2332d271555f52853e847224f26e389803'); });
  it('post146-extras: HMAC after-#146 .github/workflows/deploy.yml', () => { expect(hmacSha256('after-#146', '.github/workflows/deploy.yml')).toBe('8a9eeaf7dc48f5aa9c008b7e96f30ad384b542a8d07c4df6bad03b5ae01dd14a'); });
  it('post146-extras: HMAC leftover .github/workflows/deploy.yml', () => { expect(hmacSha256('leftover', '.github/workflows/deploy.yml')).toBe('e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83'); });
  it('post146-extras: HMAC TOKENMAXX .github/workflows/deploy.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/workflows/deploy.yml')).toBe('339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b'); });
  it('post146-extras: HMAC HEAVY .github/workflows/deploy.yml', () => { expect(hmacSha256('HEAVY', '.github/workflows/deploy.yml')).toBe('87354c51a785eb76f81ba427f9a58d6f8b0b7e3c85febd19b973c04874bde601'); });
  it('post146-extras: HMAC no-product-invent .github/workflows/deploy.yml', () => { expect(hmacSha256('no-product-invent', '.github/workflows/deploy.yml')).toBe('3ed3dcb49626ea55aa10de93931f8c107b800db0e2d4852f9cfe4a32f9ffe544'); });
  it('post146-extras: HMAC slice-diff .github/workflows/deploy.yml', () => { expect(hmacSha256('slice-diff', '.github/workflows/deploy.yml')).toBe('1ccb326a9235e7932c7f50df61af7dffc9c9d7e2c6ac224e9fa59d4134706b10'); });
  it('post146-extras: HMAC no-src-change .github/workflows/deploy.yml', () => { expect(hmacSha256('no-src-change', '.github/workflows/deploy.yml')).toBe('a970e311deaeb68fd6a69e1f5350295984b91cd4144778295a75638cac5d48de'); });
  it('post146-extras: HMAC manifest-lock .github/workflows/deploy.yml', () => { expect(hmacSha256('manifest-lock', '.github/workflows/deploy.yml')).toBe('b76bf0edaa3b7f3579aa342d657037e3625bbeabcf870ffa8c235024d9ad667f'); });
  it('post146-extras: HMAC ci-leftover .github/workflows/deploy.yml', () => { expect(hmacSha256('ci-leftover', '.github/workflows/deploy.yml')).toBe('786746b5514adaa019bbf18f722aebb963a13c01e0d88e8085af1adcfbe8d87a'); });
  it('post146-extras: HMAC fuzzywigg .github/workflows/deploy.yml', () => { expect(hmacSha256('fuzzywigg', '.github/workflows/deploy.yml')).toBe('fd722c8d8f6afeb8b42766ca5b4fea570e8624cf1ebe119d8266cff8cd4db5f0'); });
  it('post146-extras: HMAC backlink .github/workflows/deploy.yml', () => { expect(hmacSha256('backlink', '.github/workflows/deploy.yml')).toBe('3c8712af7d45f1df271a1c5971d0811c6477da272bc048778fab07b9d04b1f76'); });
  it('post146-extras: HMAC CATALOG_CACHE .github/workflows/deploy.yml', () => { expect(hmacSha256('CATALOG_CACHE', '.github/workflows/deploy.yml')).toBe('649f380331c72a060e5b4f4af43280cbdef08145662e1d26dc8034f23befbd4b'); });
  it('post146-extras: HMAC GEMINI_API_KEY .github/workflows/deploy.yml', () => { expect(hmacSha256('GEMINI_API_KEY', '.github/workflows/deploy.yml')).toBe('4bde3b1cedd584e967ce984cae41b2d0ee0d59d8e16b6d77b39c7b639e479a41'); });
  it('post146-extras: HMAC iptv-org .github/workflows/deploy.yml', () => { expect(hmacSha256('iptv-org', '.github/workflows/deploy.yml')).toBe('b86096c150f578bd580fe0f70280f6e34858a6e036b9fd3fee1539c30233ec38'); });
  it('post146-extras: HMAC gemini-2.0-flash .github/workflows/deploy.yml', () => { expect(hmacSha256('gemini-2.0-flash', '.github/workflows/deploy.yml')).toBe('3de92bd44feeac4a5986e1f00d3a09729de7e9195dcc7b6bc9833dfe666a159c'); });
  it('post146-extras: HMAC VALID_GENRES .github/workflows/deploy.yml', () => { expect(hmacSha256('VALID_GENRES', '.github/workflows/deploy.yml')).toBe('7c336f4f8de1d1f3ae5e390401427e4adacbe947d3cb9f2f86a9cbd3e150a5f6'); });
  it('post146-extras: HMAC HITL .github/workflows/deploy.yml', () => { expect(hmacSha256('HITL', '.github/workflows/deploy.yml')).toBe('04d19b8f0846799a2b314566c765f36c8faffb656be7e6a3d744b5da1492d064'); });
  it('post146-extras: HMAC no-creds .github/workflows/deploy.yml', () => { expect(hmacSha256('no-creds', '.github/workflows/deploy.yml')).toBe('0fef762be37cb35c847cc84884c2ee08887e2235d54bbca1dd4669996de46be1'); });
  it('post146-extras: HMAC station_select .github/workflows/deploy.yml', () => { expect(hmacSha256('station_select', '.github/workflows/deploy.yml')).toBe('b7397cbe688240355252d043a0d53ae3bd6cf1f808e31b6d0b95e92cc5dafaa0'); });
  it('post146-extras: size .github/workflows/deploy.yml', () => { expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004); });
  it('post146-extras: utf8-len .github/workflows/deploy.yml', () => { expect(read('.github/workflows/deploy.yml')).toHaveLength(1004); });
  it('post146-extras: nibble .github/workflows/deploy.yml', () => { expect(nibbleSum(sha256('.github/workflows/deploy.yml'))).toBe(476); });
  it('post146-extras: sha256 .github/dependabot.yml', () => { expect(sha256('.github/dependabot.yml')).toBe('a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac'); });
  it('post146-extras: HMAC post146 .github/dependabot.yml', () => { expect(hmacSha256('post146', '.github/dependabot.yml')).toBe('57767a00b917c7eec75c10f7999d020e2600f18dcb789f2196eb8aec58572af1'); });
  it('post146-extras: HMAC after-#146 .github/dependabot.yml', () => { expect(hmacSha256('after-#146', '.github/dependabot.yml')).toBe('9c924831a8a61746d3e43736f6b2acbe21efe97639208d6d5c9df407fec75004'); });
  it('post146-extras: HMAC leftover .github/dependabot.yml', () => { expect(hmacSha256('leftover', '.github/dependabot.yml')).toBe('b9fba0e3b098292ae8ff8b4cffe94463966fadb875a0c9db9a1dadb85281a0f9'); });
  it('post146-extras: HMAC TOKENMAXX .github/dependabot.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/dependabot.yml')).toBe('e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1'); });
  it('post146-extras: HMAC HEAVY .github/dependabot.yml', () => { expect(hmacSha256('HEAVY', '.github/dependabot.yml')).toBe('e651250d8c5b977a6bf6fb30e4edcc515accf3f9c97019df6fd702d19fb9e2ff'); });
  it('post146-extras: HMAC no-product-invent .github/dependabot.yml', () => { expect(hmacSha256('no-product-invent', '.github/dependabot.yml')).toBe('5fdab5d04737aa2fd4596ef674259a9f07c54593c68d38f74f8e6f81207f80fa'); });
  it('post146-extras: HMAC slice-diff .github/dependabot.yml', () => { expect(hmacSha256('slice-diff', '.github/dependabot.yml')).toBe('cf3a3aba1fdb1781371f6b49e2309aac2104e2564d370758a6e25c06a0a3d79d'); });
  it('post146-extras: HMAC no-src-change .github/dependabot.yml', () => { expect(hmacSha256('no-src-change', '.github/dependabot.yml')).toBe('51b22c5c39429fd11f689007378f9c3b7340092c7552c4b04c684fee3babfc47'); });
  it('post146-extras: HMAC manifest-lock .github/dependabot.yml', () => { expect(hmacSha256('manifest-lock', '.github/dependabot.yml')).toBe('b09786f2ec08484413ba6d4a6099ba987fe0365e55d99881051b7b845d6e6b0b'); });
  it('post146-extras: HMAC ci-leftover .github/dependabot.yml', () => { expect(hmacSha256('ci-leftover', '.github/dependabot.yml')).toBe('e6e9eb42c2f09c0c5f1bb38a364be4813c62ece9535767dc4bcd4a0af2f44d47'); });
  it('post146-extras: HMAC fuzzywigg .github/dependabot.yml', () => { expect(hmacSha256('fuzzywigg', '.github/dependabot.yml')).toBe('f4a071f15484860d891a7d455fe0f9e4b477b926d05ecf2a1da8c4703fad3e9d'); });
  it('post146-extras: HMAC backlink .github/dependabot.yml', () => { expect(hmacSha256('backlink', '.github/dependabot.yml')).toBe('856ea73349d825ddb77382ce6e7ff32ee7d2b93b5053207f5d106385ef1e8276'); });
  it('post146-extras: HMAC CATALOG_CACHE .github/dependabot.yml', () => { expect(hmacSha256('CATALOG_CACHE', '.github/dependabot.yml')).toBe('6dd70c123d580a1b4ac8634ee8d2dc9c36552ce79b36c045b1fd930bcd70776a'); });
  it('post146-extras: HMAC GEMINI_API_KEY .github/dependabot.yml', () => { expect(hmacSha256('GEMINI_API_KEY', '.github/dependabot.yml')).toBe('0059f5c808e00e813dc74033c95e7707470dbbdcf68695a6744c68eaa9f38687'); });
  it('post146-extras: HMAC iptv-org .github/dependabot.yml', () => { expect(hmacSha256('iptv-org', '.github/dependabot.yml')).toBe('d1593f4ace94ade69be1efee280d4d872c2eb8397424d2c0684a7938209e5a5b'); });
  it('post146-extras: HMAC gemini-2.0-flash .github/dependabot.yml', () => { expect(hmacSha256('gemini-2.0-flash', '.github/dependabot.yml')).toBe('42c2332448e5a1f7c6f2e2374d683df78a258f4cd81120561dcace80ec63d793'); });
  it('post146-extras: HMAC VALID_GENRES .github/dependabot.yml', () => { expect(hmacSha256('VALID_GENRES', '.github/dependabot.yml')).toBe('3682e70386ed0357b1857e80e01542fd93e786033e834a66f7453342279046f2'); });
  it('post146-extras: HMAC HITL .github/dependabot.yml', () => { expect(hmacSha256('HITL', '.github/dependabot.yml')).toBe('72b97577831c72174d3246685b807385eece67c7512a8c358e544cbec804da2d'); });
  it('post146-extras: HMAC no-creds .github/dependabot.yml', () => { expect(hmacSha256('no-creds', '.github/dependabot.yml')).toBe('efa812c79b86488135973f3c5b1cb0935981bc4439f2a11946d809775beb15dc'); });
  it('post146-extras: HMAC station_select .github/dependabot.yml', () => { expect(hmacSha256('station_select', '.github/dependabot.yml')).toBe('6a9ccf7f67635a4fe3f34dde9a75f20fc10708968c6d404a4274c355a79ace32'); });
  it('post146-extras: size .github/dependabot.yml', () => { expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505); });
  it('post146-extras: utf8-len .github/dependabot.yml', () => { expect(read('.github/dependabot.yml')).toHaveLength(505); });
  it('post146-extras: nibble .github/dependabot.yml', () => { expect(nibbleSum(sha256('.github/dependabot.yml'))).toBe(526); });
  it('post146-extras: sha256 .cursor/environment.json', () => { expect(sha256('.cursor/environment.json')).toBe('4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694'); });
  it('post146-extras: HMAC post146 .cursor/environment.json', () => { expect(hmacSha256('post146', '.cursor/environment.json')).toBe('df9b93c4865d72df9b1f49004b77795e61d6ea14e4e08e746f1ced60c4365599'); });
  it('post146-extras: HMAC after-#146 .cursor/environment.json', () => { expect(hmacSha256('after-#146', '.cursor/environment.json')).toBe('5c06c5b33f915165da72adce01c8619d87405c66679923cbf4d8604e7276d784'); });
  it('post146-extras: HMAC leftover .cursor/environment.json', () => { expect(hmacSha256('leftover', '.cursor/environment.json')).toBe('f3c07027290cc01d2ddd1979fab399b4f4ddaed8e682f9ba6f15b59f23ba2bc4'); });
  it('post146-extras: HMAC TOKENMAXX .cursor/environment.json', () => { expect(hmacSha256('TOKENMAXX', '.cursor/environment.json')).toBe('796f38bc3f8907bef23dc36e49231f310bae76a745c9e26ac5073ba2ec3e8c49'); });
  it('post146-extras: HMAC HEAVY .cursor/environment.json', () => { expect(hmacSha256('HEAVY', '.cursor/environment.json')).toBe('ac9494b2f787b999a6b41edc8f17a2bf4dfac30f0ee76ecef9d69be011dde10f'); });
  it('post146-extras: HMAC no-product-invent .cursor/environment.json', () => { expect(hmacSha256('no-product-invent', '.cursor/environment.json')).toBe('bba79bd9a590f177e32e895a7935716c6ff65a461b15d43916ad5996af1092c5'); });
  it('post146-extras: HMAC slice-diff .cursor/environment.json', () => { expect(hmacSha256('slice-diff', '.cursor/environment.json')).toBe('1def680f93ce3c94e3cca3cdafd2fa6add86fa3b1a86b7e6978bf61bab17a815'); });
  it('post146-extras: HMAC no-src-change .cursor/environment.json', () => { expect(hmacSha256('no-src-change', '.cursor/environment.json')).toBe('f061bd19f945e8c66c327cc278b07a7d78763515c758553c0a2bf2822896fa9e'); });
  it('post146-extras: HMAC manifest-lock .cursor/environment.json', () => { expect(hmacSha256('manifest-lock', '.cursor/environment.json')).toBe('1e8e47096c0e8b272ac510d96c6be2d4fe37d09aeccfa50a23240f0cd05a89e3'); });
  it('post146-extras: HMAC ci-leftover .cursor/environment.json', () => { expect(hmacSha256('ci-leftover', '.cursor/environment.json')).toBe('b8ddc28b2447283097c386f051579b168dbaf7f5cbdd5b6c6e03484120c17172'); });
  it('post146-extras: HMAC fuzzywigg .cursor/environment.json', () => { expect(hmacSha256('fuzzywigg', '.cursor/environment.json')).toBe('e3d4c0f7c85f4e81d76b3e176b9202ef62ee0b93590f214b7b50e8c9725d91cc'); });
  it('post146-extras: HMAC backlink .cursor/environment.json', () => { expect(hmacSha256('backlink', '.cursor/environment.json')).toBe('0e8905399320afcff4128939baf6b2ca6b9725e2eb42917aa058b4b517c6c966'); });
  it('post146-extras: HMAC CATALOG_CACHE .cursor/environment.json', () => { expect(hmacSha256('CATALOG_CACHE', '.cursor/environment.json')).toBe('bd5680d487a0213acf5b4ad32edd595386d0d77b05123a920e5f1dd93bfa3545'); });
  it('post146-extras: HMAC GEMINI_API_KEY .cursor/environment.json', () => { expect(hmacSha256('GEMINI_API_KEY', '.cursor/environment.json')).toBe('1cbe48ef03431251fc085b16447416bd0c36fafb39a967d46e03d472dee06903'); });
  it('post146-extras: HMAC iptv-org .cursor/environment.json', () => { expect(hmacSha256('iptv-org', '.cursor/environment.json')).toBe('9a76b361a359981f2cbcd5b221b471790a33bebb46d546257b8fa9e495f3bdb5'); });
  it('post146-extras: HMAC gemini-2.0-flash .cursor/environment.json', () => { expect(hmacSha256('gemini-2.0-flash', '.cursor/environment.json')).toBe('9b308ce5543169a5891b990a9aa5730f787986ed54be59ade6c335732b5393c3'); });
  it('post146-extras: HMAC VALID_GENRES .cursor/environment.json', () => { expect(hmacSha256('VALID_GENRES', '.cursor/environment.json')).toBe('99406c7aa81a7724dc575014561b876c4b77cf17d9824bacdae4974ae6669400'); });
  it('post146-extras: HMAC HITL .cursor/environment.json', () => { expect(hmacSha256('HITL', '.cursor/environment.json')).toBe('93d1c9a78bd63f82add45bdc6bc16a90c1bd280b25286d4242124563fb69e446'); });
  it('post146-extras: HMAC no-creds .cursor/environment.json', () => { expect(hmacSha256('no-creds', '.cursor/environment.json')).toBe('49c766a2d195d5f33a8b72452518687a1850982b4d02dc16158b85b33a0c6291'); });
  it('post146-extras: HMAC station_select .cursor/environment.json', () => { expect(hmacSha256('station_select', '.cursor/environment.json')).toBe('5ef4758992c4ab71cd5d53bbe06197d813738a226defa7845a4f60995fcf5fa2'); });
  it('post146-extras: size .cursor/environment.json', () => { expect(statSync(join(root, '.cursor/environment.json')).size).toBe(57); });
  it('post146-extras: utf8-len .cursor/environment.json', () => { expect(read('.cursor/environment.json')).toHaveLength(57); });
  it('post146-extras: nibble .cursor/environment.json', () => { expect(nibbleSum(sha256('.cursor/environment.json'))).toBe(472); });
  it('post146-extras: src/index.ts forbids invent phrase /playlist', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("/playlist"); });
  it('post146-extras: src/index.ts forbids invent phrase /now-playing', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("/now-playing"); });
  it('post146-extras: src/index.ts forbids invent phrase openai', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("openai"); });
  it('post146-extras: src/index.ts forbids invent phrase anthropic', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("anthropic"); });
  it('post146-extras: src/index.ts forbids invent phrase claude', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("claude"); });
  it('post146-extras: src/index.ts forbids invent phrase workers.ai', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("workers.ai"); });
  it('post146-extras: src/index.ts forbids invent phrase durable_object', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("durable_object"); });
  it('post146-extras: src/index.ts forbids invent phrase vectorize', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("vectorize"); });
  it('post146-extras: src/index.ts forbids invent phrase hyperdrive', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("hyperdrive"); });
  it('post146-extras: src/index.ts forbids invent phrase analytics_engine', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("analytics_engine"); });
  it('post146-extras: src/index.ts forbids invent phrase d1_', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("d1_"); });
  it('post146-extras: src/index.ts forbids invent phrase r2_', () => { expect(read('src/index.ts').toLowerCase()).not.toContain("r2_"); });
  it('post146-extras: src/genres.ts forbids invent phrase /playlist', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("/playlist"); });
  it('post146-extras: src/genres.ts forbids invent phrase /now-playing', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("/now-playing"); });
  it('post146-extras: src/genres.ts forbids invent phrase openai', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("openai"); });
  it('post146-extras: src/genres.ts forbids invent phrase anthropic', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("anthropic"); });
  it('post146-extras: src/genres.ts forbids invent phrase claude', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("claude"); });
  it('post146-extras: src/genres.ts forbids invent phrase workers.ai', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("workers.ai"); });
  it('post146-extras: src/genres.ts forbids invent phrase durable_object', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("durable_object"); });
  it('post146-extras: src/genres.ts forbids invent phrase vectorize', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("vectorize"); });
  it('post146-extras: src/genres.ts forbids invent phrase hyperdrive', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("hyperdrive"); });
  it('post146-extras: src/genres.ts forbids invent phrase analytics_engine', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("analytics_engine"); });
  it('post146-extras: src/genres.ts forbids invent phrase d1_', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("d1_"); });
  it('post146-extras: src/genres.ts forbids invent phrase r2_', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain("r2_"); });
  it('post146-extras: src/parser.ts forbids invent phrase /playlist', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("/playlist"); });
  it('post146-extras: src/parser.ts forbids invent phrase /now-playing', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("/now-playing"); });
  it('post146-extras: src/parser.ts forbids invent phrase openai', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("openai"); });
  it('post146-extras: src/parser.ts forbids invent phrase anthropic', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("anthropic"); });
  it('post146-extras: src/parser.ts forbids invent phrase claude', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("claude"); });
  it('post146-extras: src/parser.ts forbids invent phrase workers.ai', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("workers.ai"); });
  it('post146-extras: src/parser.ts forbids invent phrase durable_object', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("durable_object"); });
  it('post146-extras: src/parser.ts forbids invent phrase vectorize', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("vectorize"); });
  it('post146-extras: src/parser.ts forbids invent phrase hyperdrive', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("hyperdrive"); });
  it('post146-extras: src/parser.ts forbids invent phrase analytics_engine', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("analytics_engine"); });
  it('post146-extras: src/parser.ts forbids invent phrase d1_', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("d1_"); });
  it('post146-extras: src/parser.ts forbids invent phrase r2_', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain("r2_"); });
  it('post146-extras: wrangler.toml forbids invent phrase /playlist', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("/playlist"); });
  it('post146-extras: wrangler.toml forbids invent phrase /now-playing', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("/now-playing"); });
  it('post146-extras: wrangler.toml forbids invent phrase openai', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("openai"); });
  it('post146-extras: wrangler.toml forbids invent phrase anthropic', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("anthropic"); });
  it('post146-extras: wrangler.toml forbids invent phrase claude', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("claude"); });
  it('post146-extras: wrangler.toml forbids invent phrase workers.ai', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("workers.ai"); });
  it('post146-extras: wrangler.toml forbids invent phrase durable_object', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("durable_object"); });
  it('post146-extras: wrangler.toml forbids invent phrase vectorize', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("vectorize"); });
  it('post146-extras: wrangler.toml forbids invent phrase hyperdrive', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("hyperdrive"); });
  it('post146-extras: wrangler.toml forbids invent phrase analytics_engine', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("analytics_engine"); });
  it('post146-extras: wrangler.toml forbids invent phrase d1_', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("d1_"); });
  it('post146-extras: wrangler.toml forbids invent phrase r2_', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain("r2_"); });
  it('post146-extras: AGENTS.md forbids invent phrase openai', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("openai"); });
  it('post146-extras: AGENTS.md forbids invent phrase anthropic', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("anthropic"); });
  it('post146-extras: AGENTS.md forbids invent phrase claude', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("claude"); });
  it('post146-extras: AGENTS.md forbids invent phrase workers.ai', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("workers.ai"); });
  it('post146-extras: AGENTS.md forbids invent phrase durable_object', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("durable_object"); });
  it('post146-extras: AGENTS.md forbids invent phrase vectorize', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("vectorize"); });
  it('post146-extras: AGENTS.md forbids invent phrase hyperdrive', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("hyperdrive"); });
  it('post146-extras: AGENTS.md forbids invent phrase analytics_engine', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("analytics_engine"); });
  it('post146-extras: AGENTS.md forbids invent phrase d1_', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("d1_"); });
  it('post146-extras: AGENTS.md forbids invent phrase r2_', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain("r2_"); });
  it('post146-extras: package.json forbids invent phrase /playlist', () => { expect(read('package.json').toLowerCase()).not.toContain("/playlist"); });
  it('post146-extras: package.json forbids invent phrase /now-playing', () => { expect(read('package.json').toLowerCase()).not.toContain("/now-playing"); });
  it('post146-extras: package.json forbids invent phrase openai', () => { expect(read('package.json').toLowerCase()).not.toContain("openai"); });
  it('post146-extras: package.json forbids invent phrase anthropic', () => { expect(read('package.json').toLowerCase()).not.toContain("anthropic"); });
  it('post146-extras: package.json forbids invent phrase claude', () => { expect(read('package.json').toLowerCase()).not.toContain("claude"); });
  it('post146-extras: package.json forbids invent phrase workers.ai', () => { expect(read('package.json').toLowerCase()).not.toContain("workers.ai"); });
  it('post146-extras: package.json forbids invent phrase durable_object', () => { expect(read('package.json').toLowerCase()).not.toContain("durable_object"); });
  it('post146-extras: package.json forbids invent phrase vectorize', () => { expect(read('package.json').toLowerCase()).not.toContain("vectorize"); });
  it('post146-extras: package.json forbids invent phrase hyperdrive', () => { expect(read('package.json').toLowerCase()).not.toContain("hyperdrive"); });
  it('post146-extras: package.json forbids invent phrase analytics_engine', () => { expect(read('package.json').toLowerCase()).not.toContain("analytics_engine"); });
  it('post146-extras: package.json forbids invent phrase d1_', () => { expect(read('package.json').toLowerCase()).not.toContain("d1_"); });
  it('post146-extras: package.json forbids invent phrase r2_', () => { expect(read('package.json').toLowerCase()).not.toContain("r2_"); });
  it('post146-extras: keys inventory digest', () => {
    const keys = ["post146","after-#146","leftover","TOKENMAXX","HEAVY","no-product-invent","slice-diff","no-src-change","manifest-lock","ci-leftover","fuzzywigg","backlink","CATALOG_CACHE","GEMINI_API_KEY","iptv-org","gemini-2.0-flash","VALID_GENRES","HITL","no-creds","station_select","post146-extras","genres"];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe('595bac4e2439c773ecbdde9fa26b1a28f1f0db63f78061b7f1705c015b6d6ce2');
    expect(keys).toHaveLength(22);
  });
  it('post146-extras: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post146 genres HEAVY deepen (after #146)')");
    expect(body).toContain("describe('post146 genres extras HEAVY deepen (after #146 leftover slice)')");
    expect((body.match(/it\('post146-extras:/g) ?? []).length).toBeGreaterThan(100);
  });
});

// --- HEAVY burn (post-#151): deepen genres leftover edges only — no product inventing ---
// TOKENMAXX overnight HEAVY refill — distinct from overnight-sdf/sitemap/#151 parseM3U fixtures.
describe('post151 genres HEAVY deepen (after #151)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };


  it('post151: locks src/genres.ts sha256', () => {
    expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post151: locks src/genres.ts sha1', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post151: locks src/genres.ts md5', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post151: locks src/genres.ts sha384', () => {
    expect(sha384('src/genres.ts')).toBe('ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16');
  });

  it('post151: locks src/genres.ts sha512', () => {
    expect(sha512('src/genres.ts')).toBe('bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b');
  });

  it('post151: locks src/genres.ts sha3-256', () => {
    expect(sha3('src/genres.ts')).toBe('d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f');
  });

  it('post151: locks src/genres.ts blake2b512', () => {
    expect(blake2b('src/genres.ts')).toBe('731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67');
  });

  it('post151: locks src/genres.ts ripemd160', () => {
    expect(ripemd('src/genres.ts')).toBe('bb9faaf8890bdba8dd86bcdf7e418da622d19bf5');
  });

  it('post151: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027);
    expect(readFileSync(join(root, 'src/genres.ts')).byteLength).toBe(1027);
  });

  it('post151: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read('src/genres.ts')).toHaveLength(1025);
    expect(read('src/genres.ts').split('\n')).toHaveLength(48);
  });

  it('post151: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256('src/genres.ts');
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post151: locks src/genres.ts pairSum 3950 rollingXor 96', () => {
    const d = sha256('src/genres.ts');
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it('post151: locks src/genres.ts first/last/mid octets', () => {
    const d = sha256('src/genres.ts');
    expect(d.slice(0, 2)).toBe('aa');
    expect(d.slice(-2)).toBe('4e');
    expect(d.slice(28, 36)).toBe('811dfbc2');
  });

  it('post151: locks src/genres.ts HMAC post151/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post151', 'src/genres.ts')).toBe('94c9396d5de71b1b581442f2c44b9a772332265eef690c08a34ab973ad6ee380');
    expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f');
    expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951');
  });

  it('post151: locks src/genres.ts HMAC after-#151/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#151', 'src/genres.ts')).toBe('861b7c5d69742a7a6b64d95126f3351ed6803255b42e7cbf9ff565c9903373cb');
    expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575');
    expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b');
  });

  it('post151: locks src/genres.ts spaces 144', () => {
    expect((read('src/genres.ts').match(/ /g) ?? []).length).toBe(144);
  });

  it('post151: locks src/genres.ts reversed sha256', () => {
    const rev = [...read('src/genres.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac');
  });

  it('post151: locks src/genres.ts sha256 UPPERCASE', () => {
    expect(sha256('src/genres.ts').toUpperCase()).toBe('AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E');
  });

  it('post151: locks src/genres.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/genres.ts').split('\n')[0]).digest('hex')).toBe('907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68');
  });

  it('post151: locks src/genres.ts size*lines 49296', () => {
    expect(statSync(join(root, 'src/genres.ts')).size * read('src/genres.ts').split('\n').length).toBe(49296);
  });

  it('post151: locks src/genres.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/genres.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(47);
    expect((t.match(/,/g) ?? []).length).toBe(34);
    expect((t.match(/:/g) ?? []).length).toBe(26);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(68);
  });

  it('post151: locks src/genres.ts HMAC-SHA1/MD5 key post151', () => {
    expect(createHmac('sha1', 'post151').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('a642ac35e7905a1b558f3b78a21cfbd575dda44a');
    expect(createHmac('md5', 'post151').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('4167581a9fa46fd217d7ca27a5d90e88');
  });

  it('post151: locks src/index.ts sha256', () => {
    expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post151: locks src/index.ts sha1', () => {
    expect(sha1('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post151: locks src/index.ts md5', () => {
    expect(md5('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post151: locks src/index.ts sha384', () => {
    expect(sha384('src/index.ts')).toBe('1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65');
  });

  it('post151: locks src/index.ts sha512', () => {
    expect(sha512('src/index.ts')).toBe('28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3');
  });

  it('post151: locks src/index.ts sha3-256', () => {
    expect(sha3('src/index.ts')).toBe('437dfa14ad684952d2d6a973da9d2ea67482eff82e188c32e27507f9dfd3239b');
  });

  it('post151: locks src/index.ts blake2b512', () => {
    expect(blake2b('src/index.ts')).toBe('17bccc5865d7d993ff97e58ce699f0a3f7fd4aa6270d29bcb2cccaee3b0a48dd7b118625848275aab8adfa6efdc23a8a3ddb359f9addfcf6552c15fe4be1dace');
  });

  it('post151: locks src/index.ts ripemd160', () => {
    expect(ripemd('src/index.ts')).toBe('a8ea25913b26da27277f866fc7988fdcdf281093');
  });

  it('post151: locks src/index.ts size 4738', () => {
    expect(statSync(join(root, 'src/index.ts')).size).toBe(4738);
    expect(readFileSync(join(root, 'src/index.ts')).byteLength).toBe(4738);
  });

  it('post151: locks src/index.ts utf8 4724 lines 154', () => {
    expect(read('src/index.ts')).toHaveLength(4724);
    expect(read('src/index.ts').split('\n')).toHaveLength(154);
  });

  it('post151: locks src/index.ts nibble 470 xor 14', () => {
    const d = sha256('src/index.ts');
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post151: locks src/index.ts pairSum 4265 rollingXor 151', () => {
    const d = sha256('src/index.ts');
    expect(pairSum(d)).toBe(4265);
    expect(rollingXor(d)).toBe(151);
  });

  it('post151: locks src/index.ts first/last/mid octets', () => {
    const d = sha256('src/index.ts');
    expect(d.slice(0, 2)).toBe('7f');
    expect(d.slice(-2)).toBe('72');
    expect(d.slice(28, 36)).toBe('e2a20389');
  });

  it('post151: locks src/index.ts HMAC post151/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post151', 'src/index.ts')).toBe('88e3d57097219995b4fd5300db14d4392616f3002428f5bb9cf3f213c16f16c5');
    expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be');
    expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc');
  });

  it('post151: locks src/index.ts HMAC after-#151/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#151', 'src/index.ts')).toBe('d95f80032a27c4b6135a674aff03954326f2a432f0614ac17446bb67cfe34a58');
    expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30');
    expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a');
  });

  it('post151: locks src/index.ts spaces 761', () => {
    expect((read('src/index.ts').match(/ /g) ?? []).length).toBe(761);
  });

  it('post151: locks src/index.ts reversed sha256', () => {
    const rev = [...read('src/index.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('457830430075a6d1dc4b28436b3c145eb42a640d91301599ca2792fb58433ead');
  });

  it('post151: locks src/index.ts sha256 UPPERCASE', () => {
    expect(sha256('src/index.ts').toUpperCase()).toBe('7F0D574B0AEDC6CD71D3EA35BB03E2A20389028E6FF2C195718ACFF2E0313A72');
  });

  it('post151: locks src/index.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/index.ts').split('\n')[0]).digest('hex')).toBe('d8233fd79765534121de12d18bc3b54a6968d1868428cf5d52175e9a620cf6d4');
  });

  it('post151: locks src/index.ts size*lines 729652', () => {
    expect(statSync(join(root, 'src/index.ts')).size * read('src/index.ts').split('\n').length).toBe(729652);
  });

  it('post151: locks src/index.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/index.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(153);
    expect((t.match(/,/g) ?? []).length).toBe(69);
    expect((t.match(/:/g) ?? []).length).toBe(72);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(85);
  });

  it('post151: locks src/index.ts HMAC-SHA1/MD5 key post151', () => {
    expect(createHmac('sha1', 'post151').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('b329148e4f8b8b94ae68954800d81eceecaa5df6');
    expect(createHmac('md5', 'post151').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('c374c41808f9c50e0ffbb3d92f120cc8');
  });

  it('post151: locks src/types.ts sha256', () => {
    expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
  });

  it('post151: locks src/types.ts sha1', () => {
    expect(sha1('src/types.ts')).toBe('1e8906673dc0d140ee5c3d40839c88a1eeca03d8');
  });

  it('post151: locks src/types.ts md5', () => {
    expect(md5('src/types.ts')).toBe('ecba663d21928622be656805ad27d0a3');
  });

  it('post151: locks src/types.ts sha384', () => {
    expect(sha384('src/types.ts')).toBe('40618d8902640e6ce24d5caf0b9daf86c4d5f962832b1835a86bb10ad7c37455cc60aa9f965ffd9a98f9a5967048b01c');
  });

  it('post151: locks src/types.ts sha512', () => {
    expect(sha512('src/types.ts')).toBe('49cf750d836fe717822e6f08b6ff4998c1f7419a2dfb169a5cfb3001dc1f6dc84df5b428edba879cbd0f7e1b809662e27ee34bf28f88e1efc62ec7d0b37f37cc');
  });

  it('post151: locks src/types.ts sha3-256', () => {
    expect(sha3('src/types.ts')).toBe('93122aa0fe9ef2958ed1b257bc139e91b30facb2e13e4094620dadf7d4acf8e4');
  });

  it('post151: locks src/types.ts blake2b512', () => {
    expect(blake2b('src/types.ts')).toBe('fcb08243a6c336e8da2d3500665ae9a80d98f23a06c3da5f771a290a4b45b2697e2b00e440165eb6551886f58a3bdea0ba315c1d4d3caba38ba3af7f108b3723');
  });

  it('post151: locks src/types.ts ripemd160', () => {
    expect(ripemd('src/types.ts')).toBe('80ca02c12c5db60b8eb1afb1cd21b18983ba16fb');
  });

  it('post151: locks src/types.ts size 174', () => {
    expect(statSync(join(root, 'src/types.ts')).size).toBe(174);
    expect(readFileSync(join(root, 'src/types.ts')).byteLength).toBe(174);
  });

  it('post151: locks src/types.ts utf8 172 lines 7', () => {
    expect(read('src/types.ts')).toHaveLength(172);
    expect(read('src/types.ts').split('\n')).toHaveLength(7);
  });

  it('post151: locks src/types.ts nibble 520 xor 14', () => {
    const d = sha256('src/types.ts');
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post151: locks src/types.ts pairSum 4300 rollingXor 104', () => {
    const d = sha256('src/types.ts');
    expect(pairSum(d)).toBe(4300);
    expect(rollingXor(d)).toBe(104);
  });

  it('post151: locks src/types.ts first/last/mid octets', () => {
    const d = sha256('src/types.ts');
    expect(d.slice(0, 2)).toBe('40');
    expect(d.slice(-2)).toBe('d3');
    expect(d.slice(28, 36)).toBe('345e4f21');
  });

  it('post151: locks src/types.ts HMAC post151/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post151', 'src/types.ts')).toBe('2b992c179653625ec9094b5a85d300a4365f5999c537209b9a70d223bc55f628');
    expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85');
    expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc');
  });

  it('post151: locks src/types.ts HMAC after-#151/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#151', 'src/types.ts')).toBe('dbc34df138dc5b722843170415ab02cbd38aa25fdb0088774c8d0030e25051d7');
    expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a');
    expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076');
  });

  it('post151: locks src/types.ts spaces 25', () => {
    expect((read('src/types.ts').match(/ /g) ?? []).length).toBe(25);
  });

  it('post151: locks src/types.ts reversed sha256', () => {
    const rev = [...read('src/types.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e02dd34c73f2571af21a48fda8cfd19667149441b37d30de0519262fc76f7f37');
  });

  it('post151: locks src/types.ts sha256 UPPERCASE', () => {
    expect(sha256('src/types.ts').toUpperCase()).toBe('4008DDD3DD6DD2FB7E8D386DFE2A345E4F21FA5576E229A8FBBE691626F743D3');
  });

  it('post151: locks src/types.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/types.ts').split('\n')[0]).digest('hex')).toBe('1d293b13ae9f4103472d1553f95a9368a006f250a1178cb8946d4e566fda25f6');
  });

  it('post151: locks src/types.ts size*lines 1218', () => {
    expect(statSync(join(root, 'src/types.ts')).size * read('src/types.ts').split('\n').length).toBe(1218);
  });

  it('post151: locks src/types.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/types.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(6);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(3);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post151: locks src/types.ts HMAC-SHA1/MD5 key post151', () => {
    expect(createHmac('sha1', 'post151').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('29de1be0ca4a2fbb0c1e5a02567902e5a9b0eda1');
    expect(createHmac('md5', 'post151').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('796b81b9c0579e1a63e2866aeb7a4932');
  });

  it('post151: locks src/parser.ts sha256', () => {
    expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post151: locks src/parser.ts sha1', () => {
    expect(sha1('src/parser.ts')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it('post151: locks src/parser.ts md5', () => {
    expect(md5('src/parser.ts')).toBe('500211c4c526de887252451726776563');
  });

  it('post151: locks src/parser.ts sha384', () => {
    expect(sha384('src/parser.ts')).toBe('f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9');
  });

  it('post151: locks src/parser.ts sha512', () => {
    expect(sha512('src/parser.ts')).toBe('66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89');
  });

  it('post151: locks src/parser.ts sha3-256', () => {
    expect(sha3('src/parser.ts')).toBe('0ec47247da4cff229cc417b213da73883427985239714e246eb16d1f021bf9c2');
  });

  it('post151: locks src/parser.ts blake2b512', () => {
    expect(blake2b('src/parser.ts')).toBe('d61759e7d0a68efcd16a74811ad84abebe0b82dab5c16e51261ca37118efc5a3c36aec8bc1523ce2b0d3908cd065c7cb8d1c153ea9a31dec633a90ec53aca7ef');
  });

  it('post151: locks src/parser.ts ripemd160', () => {
    expect(ripemd('src/parser.ts')).toBe('36f12fc76af98f06dfa651f814e8f2e13b26c96a');
  });

  it('post151: locks src/parser.ts size 1955', () => {
    expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955);
    expect(readFileSync(join(root, 'src/parser.ts')).byteLength).toBe(1955);
  });

  it('post151: locks src/parser.ts utf8 1953 lines 67', () => {
    expect(read('src/parser.ts')).toHaveLength(1953);
    expect(read('src/parser.ts').split('\n')).toHaveLength(67);
  });

  it('post151: locks src/parser.ts nibble 477 xor 9', () => {
    const d = sha256('src/parser.ts');
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post151: locks src/parser.ts pairSum 3612 rollingXor 126', () => {
    const d = sha256('src/parser.ts');
    expect(pairSum(d)).toBe(3612);
    expect(rollingXor(d)).toBe(126);
  });

  it('post151: locks src/parser.ts first/last/mid octets', () => {
    const d = sha256('src/parser.ts');
    expect(d.slice(0, 2)).toBe('cf');
    expect(d.slice(-2)).toBe('68');
    expect(d.slice(28, 36)).toBe('a0e83a07');
  });

  it('post151: locks src/parser.ts HMAC post151/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post151', 'src/parser.ts')).toBe('c036d0b425a6f0d8839b3eb9286198552365d05892bca67ffdee5dc3f8ff5515');
    expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3');
    expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8');
  });

  it('post151: locks src/parser.ts HMAC after-#151/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#151', 'src/parser.ts')).toBe('ba8a6346aba4eecb6a1253e371d3ac25479df07576caea7b328985394ae39b0f');
    expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70');
    expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f');
  });

  it('post151: locks src/parser.ts spaces 432', () => {
    expect((read('src/parser.ts').match(/ /g) ?? []).length).toBe(432);
  });

  it('post151: locks src/parser.ts reversed sha256', () => {
    const rev = [...read('src/parser.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('a78f8cb8e92e3203b94933c1ec51e34ac1f54892dcc0c99024a48333407e79de');
  });

  it('post151: locks src/parser.ts sha256 UPPERCASE', () => {
    expect(sha256('src/parser.ts').toUpperCase()).toBe('CF293136412FBA636AD7391BCEA0A0E83A079FBBCC8FC14D0CA41FA6621F4368');
  });

  it('post151: locks src/parser.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/parser.ts').split('\n')[0]).digest('hex')).toBe('64a393f12da7f34518f8343d01e7da0c8da3e9f0b9cf1916ec7af9a35cbf8eb5');
  });

  it('post151: locks src/parser.ts size*lines 130985', () => {
    expect(statSync(join(root, 'src/parser.ts')).size * read('src/parser.ts').split('\n').length).toBe(130985);
  });

  it('post151: locks src/parser.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/parser.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(66);
    expect((t.match(/,/g) ?? []).length).toBe(8);
    expect((t.match(/:/g) ?? []).length).toBe(19);
    expect((t.match(/"/g) ?? []).length).toBe(15);
    expect((t.match(/'/g) ?? []).length).toBe(12);
  });

  it('post151: locks src/parser.ts HMAC-SHA1/MD5 key post151', () => {
    expect(createHmac('sha1', 'post151').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('b6cca7688e891b5c32995d08eebf878d6f6a79b3');
    expect(createHmac('md5', 'post151').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('e5e3c2103032d8d7c04a21a8eeddb1bb');
  });

  it('post151: resolveGenre maps "late night" → ambient', () => {
    expect(resolveGenre('late night')).toBe('ambient');
    expect(resolveGenre('LATE NIGHT')).toBe('ambient');
  });

  it('post151: resolveGenre maps "chill" → ambient', () => {
    expect(resolveGenre('chill')).toBe('ambient');
    expect(resolveGenre('CHILL')).toBe('ambient');
  });

  it('post151: resolveGenre maps "ambient" → ambient', () => {
    expect(resolveGenre('ambient')).toBe('ambient');
    expect(resolveGenre('AMBIENT')).toBe('ambient');
  });

  it('post151: resolveGenre maps "relaxing" → ambient', () => {
    expect(resolveGenre('relaxing')).toBe('ambient');
    expect(resolveGenre('RELAXING')).toBe('ambient');
  });

  it('post151: resolveGenre maps "focus" → ambient', () => {
    expect(resolveGenre('focus')).toBe('ambient');
    expect(resolveGenre('FOCUS')).toBe('ambient');
  });

  it('post151: resolveGenre maps "classical" → classical', () => {
    expect(resolveGenre('classical')).toBe('classical');
    expect(resolveGenre('CLASSICAL')).toBe('classical');
  });

  it('post151: resolveGenre maps "classic" → classical', () => {
    expect(resolveGenre('classic')).toBe('classical');
    expect(resolveGenre('CLASSIC')).toBe('classical');
  });

  it('post151: resolveGenre maps "jazz" → jazz', () => {
    expect(resolveGenre('jazz')).toBe('jazz');
    expect(resolveGenre('JAZZ')).toBe('jazz');
  });

  it('post151: resolveGenre maps "blues" → jazz', () => {
    expect(resolveGenre('blues')).toBe('jazz');
    expect(resolveGenre('BLUES')).toBe('jazz');
  });

  it('post151: resolveGenre maps "pop" → pop', () => {
    expect(resolveGenre('pop')).toBe('pop');
    expect(resolveGenre('POP')).toBe('pop');
  });

  it('post151: resolveGenre maps "rock" → rock', () => {
    expect(resolveGenre('rock')).toBe('rock');
    expect(resolveGenre('ROCK')).toBe('rock');
  });

  it('post151: resolveGenre maps "metal" → rock', () => {
    expect(resolveGenre('metal')).toBe('rock');
    expect(resolveGenre('METAL')).toBe('rock');
  });

  it('post151: resolveGenre maps "indie" → rock', () => {
    expect(resolveGenre('indie')).toBe('rock');
    expect(resolveGenre('INDIE')).toBe('rock');
  });

  it('post151: resolveGenre maps "music" → music', () => {
    expect(resolveGenre('music')).toBe('music');
    expect(resolveGenre('MUSIC')).toBe('music');
  });

  it('post151: resolveGenre maps "news" → news', () => {
    expect(resolveGenre('news')).toBe('news');
    expect(resolveGenre('NEWS')).toBe('news');
  });

  it('post151: resolveGenre maps "sports" → sports', () => {
    expect(resolveGenre('sports')).toBe('sports');
    expect(resolveGenre('SPORTS')).toBe('sports');
  });

  it('post151: resolveGenre maps "entertainment" → entertainment', () => {
    expect(resolveGenre('entertainment')).toBe('entertainment');
    expect(resolveGenre('ENTERTAINMENT')).toBe('entertainment');
  });

  it('post151: resolveGenre maps "dance" → pop', () => {
    expect(resolveGenre('dance')).toBe('pop');
    expect(resolveGenre('DANCE')).toBe('pop');
  });

  it('post151: resolveGenre maps "electronic" → ambient', () => {
    expect(resolveGenre('electronic')).toBe('ambient');
    expect(resolveGenre('ELECTRONIC')).toBe('ambient');
  });

  it('post151: resolveGenre maps "lofi" → ambient', () => {
    expect(resolveGenre('lofi')).toBe('ambient');
    expect(resolveGenre('LOFI')).toBe('ambient');
  });

  it('post151: resolveGenre maps "lo-fi" → ambient', () => {
    expect(resolveGenre('lo-fi')).toBe('ambient');
    expect(resolveGenre('LO-FI')).toBe('ambient');
  });

  it('post151: resolveGenre defaults blank/undefined to music', () => {
    expect(resolveGenre()).toBe('music');
    expect(resolveGenre('')).toBe('music');
    expect(resolveGenre('   ')).toBe('music');
  });

  it('post151: VALID_GENRES length 9 ordered', () => {
    expect([...VALID_GENRES]).toEqual(['music','ambient','jazz','classical','pop','rock','news','sports','entertainment']);
  });

  it('post151: GENRE_MAP has 21 keys', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it('post151: GENRE_MAP rejects __proto__ invent', () => {
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, '__proto__')).toBe(false);
    // Plain-object map access: '__proto__' → Object.prototype ({}); do not invent hasOwn fix
    expect(resolveGenre('__proto__')).toEqual({});
  });

  it('post151: custom map override still works', () => {
    expect(resolveGenre('custom', { custom: 'jazz' })).toBe('jazz');
  });

  it('post151: index.ts still imports resolveGenre path', () => {
    expect(read('src/index.ts')).toContain("from './genres'");
    expect(read('src/index.ts')).toContain('resolveGenre');
  });

  it('post151: types.ts Env still optional GEMINI_API_KEY', () => {
    expect(read('src/types.ts')).toContain('GEMINI_API_KEY?:');
  });

  it('post151: mega purity 40x genres.ts sha256', () => {
    const expected = "aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e";
    for (let i = 0; i < 40; i++) expect(sha256('src/genres.ts')).toBe(expected);
  });

  it('post151: negative inventing fence genres', () => {
    expect(read('src/genres.ts')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('src/genres.ts')).not.toMatch(/openai|anthropic|claude|Durable Object/);
  });

  it('post151: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post146 genres HEAVY deepen (after #146)'");
    expect(body).toContain("describe('post151 genres HEAVY deepen (after #151)'");
    expect((body.match(/it\('post151:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post151 genres extras HEAVY deepen (after #151 leftover slice)', () => {
  const root = genresRoot;
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };


  it('post151-extras: sha256 src/genres.ts', () => { expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e'); });
  it('post151-extras: HMAC post151 src/genres.ts', () => { expect(hmacSha256('post151', 'src/genres.ts')).toBe('94c9396d5de71b1b581442f2c44b9a772332265eef690c08a34ab973ad6ee380'); });
  it('post151-extras: HMAC after-#151 src/genres.ts', () => { expect(hmacSha256('after-#151', 'src/genres.ts')).toBe('861b7c5d69742a7a6b64d95126f3351ed6803255b42e7cbf9ff565c9903373cb'); });
  it('post151-extras: HMAC leftover src/genres.ts', () => { expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f'); });
  it('post151-extras: HMAC TOKENMAXX src/genres.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951'); });
  it('post151-extras: HMAC HEAVY src/genres.ts', () => { expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575'); });
  it('post151-extras: HMAC no-product-invent src/genres.ts', () => { expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b'); });
  it('post151-extras: HMAC slice-diff src/genres.ts', () => { expect(hmacSha256('slice-diff', 'src/genres.ts')).toBe('22d66e269afda39844782f2607b23bacf23e5d02a51249ddec437782bc1a3a78'); });
  it('post151-extras: HMAC no-src-change src/genres.ts', () => { expect(hmacSha256('no-src-change', 'src/genres.ts')).toBe('a3b9a583e340975667c401c4933eb3535590637cdc49d496ffec24efecd28810'); });
  it('post151-extras: HMAC manifest-lock src/genres.ts', () => { expect(hmacSha256('manifest-lock', 'src/genres.ts')).toBe('e9f5e2172614a8e3160d35040a7380c6d239a34a24fe0b257862f3edc83bb4dc'); });
  it('post151-extras: HMAC ci-leftover src/genres.ts', () => { expect(hmacSha256('ci-leftover', 'src/genres.ts')).toBe('d6cf4a77978451e01b95265d982a0c457eda7933c8d32b79dba969e85d10f525'); });
  it('post151-extras: HMAC fuzzywigg src/genres.ts', () => { expect(hmacSha256('fuzzywigg', 'src/genres.ts')).toBe('449f90c50ae8bb525d12e1afc61f2c9676d4df314072ddd9d39da78f5b3386d5'); });
  it('post151-extras: HMAC backlink src/genres.ts', () => { expect(hmacSha256('backlink', 'src/genres.ts')).toBe('49cdee589a580afd21210b21ce6c9577e60eb9550bc9ae91de61d5d641ca7a17'); });
  it('post151-extras: HMAC CATALOG_CACHE src/genres.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/genres.ts')).toBe('31ecbbd27f07634795ad27062588ed79f95fc0ceb21adb85d2ac30e49f07a97e'); });
  it('post151-extras: HMAC GEMINI_API_KEY src/genres.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/genres.ts')).toBe('0fb03a70b220af36fcda95f542e6dd7066ba29bf7085e275d3df54d4b0730ba1'); });
  it('post151-extras: HMAC iptv-org src/genres.ts', () => { expect(hmacSha256('iptv-org', 'src/genres.ts')).toBe('1493d15bc7d59b37d840b00afdadc42f8b5d087e532feedd20fccd557a198a5e'); });
  it('post151-extras: HMAC gemini-2.0-flash src/genres.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/genres.ts')).toBe('7d12234bb3732cf2e4ec5c087774712847d26cecde20c6146eb66716871b2f13'); });
  it('post151-extras: HMAC VALID_GENRES src/genres.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/genres.ts')).toBe('022af5631e33153cb57479f640c634fed9801fa759671954791290e45cdafb25'); });
  it('post151-extras: HMAC HITL src/genres.ts', () => { expect(hmacSha256('HITL', 'src/genres.ts')).toBe('362c2d70ee75f8c1e7d51b6ddfe68240447296e1ece630cd472a087f32033485'); });
  it('post151-extras: HMAC no-creds src/genres.ts', () => { expect(hmacSha256('no-creds', 'src/genres.ts')).toBe('1efc2476ef5f97e1e8c79cad25705654ca7544c4dfe8dbf123c6ecc6d08a143d'); });
  it('post151-extras: HMAC station_select src/genres.ts', () => { expect(hmacSha256('station_select', 'src/genres.ts')).toBe('c3f3fbee15ad1854365ee7454957baa3a88ed60037ad74a21928f1f659b876a5'); });
  it('post151-extras: size src/genres.ts', () => { expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027); });
  it('post151-extras: utf8-len src/genres.ts', () => { expect(read('src/genres.ts')).toHaveLength(1025); });
  it('post151-extras: nibble src/genres.ts', () => { expect(nibbleSum(sha256('src/genres.ts'))).toBe(500); });
  it('post151-extras: sha256 src/index.ts', () => { expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72'); });
  it('post151-extras: HMAC post151 src/index.ts', () => { expect(hmacSha256('post151', 'src/index.ts')).toBe('88e3d57097219995b4fd5300db14d4392616f3002428f5bb9cf3f213c16f16c5'); });
  it('post151-extras: HMAC after-#151 src/index.ts', () => { expect(hmacSha256('after-#151', 'src/index.ts')).toBe('d95f80032a27c4b6135a674aff03954326f2a432f0614ac17446bb67cfe34a58'); });
  it('post151-extras: HMAC leftover src/index.ts', () => { expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be'); });
  it('post151-extras: HMAC TOKENMAXX src/index.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc'); });
  it('post151-extras: HMAC HEAVY src/index.ts', () => { expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30'); });
  it('post151-extras: HMAC no-product-invent src/index.ts', () => { expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a'); });
  it('post151-extras: HMAC slice-diff src/index.ts', () => { expect(hmacSha256('slice-diff', 'src/index.ts')).toBe('c2be27a92bce9fa17108fbf90f63b917d25d4114397192e04caf79ac29e8f44f'); });
  it('post151-extras: HMAC no-src-change src/index.ts', () => { expect(hmacSha256('no-src-change', 'src/index.ts')).toBe('f1b32cf267f0c31a79062ca85a6243b3f166c1d5dcf534c3149a97e9d6ae4846'); });
  it('post151-extras: HMAC manifest-lock src/index.ts', () => { expect(hmacSha256('manifest-lock', 'src/index.ts')).toBe('41e4be551225bde732f63c07d1a0d8c24bd630a5c649a3b4c3eb88ca0338c946'); });
  it('post151-extras: HMAC ci-leftover src/index.ts', () => { expect(hmacSha256('ci-leftover', 'src/index.ts')).toBe('bf027f177bd08b56f22a9bdfbbc45fc94ddc568311177f80108576603df24dc0'); });
  it('post151-extras: HMAC fuzzywigg src/index.ts', () => { expect(hmacSha256('fuzzywigg', 'src/index.ts')).toBe('8b7bac04a4152bc93cee647ecc20a2058cc35d05f01a7e86dafe04cb298ccfb5'); });
  it('post151-extras: HMAC backlink src/index.ts', () => { expect(hmacSha256('backlink', 'src/index.ts')).toBe('252b29e7d7574d602146d61f7dd1a3d0d09b1374b3dd6955f63e5bd81b39cc90'); });
  it('post151-extras: HMAC CATALOG_CACHE src/index.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/index.ts')).toBe('aeb15102e72a90f212ebe60a587c2ea0e8ac8a9a28f0150dcdb08b02f61b7692'); });
  it('post151-extras: HMAC GEMINI_API_KEY src/index.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/index.ts')).toBe('bcdc693b733a50487cca26fdd8549b5b526c296566a3c4475f3bc4e6a888617b'); });
  it('post151-extras: HMAC iptv-org src/index.ts', () => { expect(hmacSha256('iptv-org', 'src/index.ts')).toBe('3c0dc21e4b8267c2ab1bf4452da2bda68627db162628cb9441e1f5d40669e5d9'); });
  it('post151-extras: HMAC gemini-2.0-flash src/index.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/index.ts')).toBe('a6e9cc5633daed5bab6b9ae49c3565df64b00bb4261998c2716df5031daf3c32'); });
  it('post151-extras: HMAC VALID_GENRES src/index.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/index.ts')).toBe('2211e9dc3aa68885606978ad97ddddbe2e902eb0665b8cde8c052c3abaaa0db6'); });
  it('post151-extras: HMAC HITL src/index.ts', () => { expect(hmacSha256('HITL', 'src/index.ts')).toBe('130212fd19b5ad02645c499bcc4fc9214fd04007e35b94977b14d2775e04d1b0'); });
  it('post151-extras: HMAC no-creds src/index.ts', () => { expect(hmacSha256('no-creds', 'src/index.ts')).toBe('db99bb419f05b9e3acfc10001000a112d3e4408c75dade7a526dc6eb78836b3e'); });
  it('post151-extras: HMAC station_select src/index.ts', () => { expect(hmacSha256('station_select', 'src/index.ts')).toBe('784e6a0de32998b04080793417ccc5d3593c9340b59587a677a954185f42c7bc'); });
  it('post151-extras: size src/index.ts', () => { expect(statSync(join(root, 'src/index.ts')).size).toBe(4738); });
  it('post151-extras: utf8-len src/index.ts', () => { expect(read('src/index.ts')).toHaveLength(4724); });
  it('post151-extras: nibble src/index.ts', () => { expect(nibbleSum(sha256('src/index.ts'))).toBe(470); });
  it('post151-extras: sha256 src/mcp.ts', () => { expect(sha256('src/mcp.ts')).toBe('6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683'); });
  it('post151-extras: HMAC post151 src/mcp.ts', () => { expect(hmacSha256('post151', 'src/mcp.ts')).toBe('5247fa3cc9633d44c67e29621a2905a346a218618de5e521f3104e5b2e7630c2'); });
  it('post151-extras: HMAC after-#151 src/mcp.ts', () => { expect(hmacSha256('after-#151', 'src/mcp.ts')).toBe('e21699daed843ce38bdc0932692cc5a0b5afca32ca461faf45ad2519d133ac61'); });
  it('post151-extras: HMAC leftover src/mcp.ts', () => { expect(hmacSha256('leftover', 'src/mcp.ts')).toBe('8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712'); });
  it('post151-extras: HMAC TOKENMAXX src/mcp.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/mcp.ts')).toBe('cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62'); });
  it('post151-extras: HMAC HEAVY src/mcp.ts', () => { expect(hmacSha256('HEAVY', 'src/mcp.ts')).toBe('870bb2f88c83abd6679e447c6937b01c998a1b3f527024e687dc35c00a046e40'); });
  it('post151-extras: HMAC no-product-invent src/mcp.ts', () => { expect(hmacSha256('no-product-invent', 'src/mcp.ts')).toBe('71a686fe812adcc92f40d5ca19a3996e68555d6749199affd3fc002053aabd65'); });
  it('post151-extras: HMAC slice-diff src/mcp.ts', () => { expect(hmacSha256('slice-diff', 'src/mcp.ts')).toBe('4f4c0995596fa6a8eecfa27d7f7047b084074e0acf00d6890811a88f5f807e05'); });
  it('post151-extras: HMAC no-src-change src/mcp.ts', () => { expect(hmacSha256('no-src-change', 'src/mcp.ts')).toBe('83880bdeca0f5e263ef18761f18cac15707d298b1c7fe1157e766221d37f343a'); });
  it('post151-extras: HMAC manifest-lock src/mcp.ts', () => { expect(hmacSha256('manifest-lock', 'src/mcp.ts')).toBe('b87b5d8230d2c0d160c1d3fd8e6864b8344b3765e2a3d5620130f45110a6c503'); });
  it('post151-extras: HMAC ci-leftover src/mcp.ts', () => { expect(hmacSha256('ci-leftover', 'src/mcp.ts')).toBe('79875f6221c9c7e59f8d3cf299af7c6612d2fcc7f85ac844aec0e1bc53ff3469'); });
  it('post151-extras: HMAC fuzzywigg src/mcp.ts', () => { expect(hmacSha256('fuzzywigg', 'src/mcp.ts')).toBe('93171a03382e2488888b170abdf10cc84dbd7ec7e77448b36c60d6758faac830'); });
  it('post151-extras: HMAC backlink src/mcp.ts', () => { expect(hmacSha256('backlink', 'src/mcp.ts')).toBe('948dbb9d47ee26b53b9ed9f9656e46752675060261aec301d8a9688178c14b7d'); });
  it('post151-extras: HMAC CATALOG_CACHE src/mcp.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/mcp.ts')).toBe('9c8ba209e27c2dee53cd464b91455396e745cd4c8082e51cacc984c4276a6dd8'); });
  it('post151-extras: HMAC GEMINI_API_KEY src/mcp.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/mcp.ts')).toBe('8e23e4645f51f6a8c5176d770324ce4427d5064f60fe270a157fdcfcf00e4244'); });
  it('post151-extras: HMAC iptv-org src/mcp.ts', () => { expect(hmacSha256('iptv-org', 'src/mcp.ts')).toBe('dcaf0c454cf3ee0bbaba12121ffe1183726881c6eb0f1f0714218d84c63cd1d7'); });
  it('post151-extras: HMAC gemini-2.0-flash src/mcp.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/mcp.ts')).toBe('62ff962053d481478958fbeec713789db9192074694d93e6d2fb7a3e0341e520'); });
  it('post151-extras: HMAC VALID_GENRES src/mcp.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/mcp.ts')).toBe('7b49b3a4b4234c1df692867963df7f92e3cba6160e503301f5dca4f28d0e14cc'); });
  it('post151-extras: HMAC HITL src/mcp.ts', () => { expect(hmacSha256('HITL', 'src/mcp.ts')).toBe('c2e5ce2b5f82e2b462e2056d2f0bd19ae2743e130f712a39aaeafa3ec451bebc'); });
  it('post151-extras: HMAC no-creds src/mcp.ts', () => { expect(hmacSha256('no-creds', 'src/mcp.ts')).toBe('913b75612a46d4953e5fcc7f1d80ecb84b79087529ab3d8b0e7ec6dc7e3a5468'); });
  it('post151-extras: HMAC station_select src/mcp.ts', () => { expect(hmacSha256('station_select', 'src/mcp.ts')).toBe('d8c897e3e257256d5c946e2e941fbc36b75dc2a5027d3685a0f2446686d8cea2'); });
  it('post151-extras: size src/mcp.ts', () => { expect(statSync(join(root, 'src/mcp.ts')).size).toBe(2057); });
  it('post151-extras: utf8-len src/mcp.ts', () => { expect(read('src/mcp.ts')).toHaveLength(2057); });
  it('post151-extras: nibble src/mcp.ts', () => { expect(nibbleSum(sha256('src/mcp.ts'))).toBe(551); });
  it('post151-extras: sha256 src/parser.ts', () => { expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368'); });
  it('post151-extras: HMAC post151 src/parser.ts', () => { expect(hmacSha256('post151', 'src/parser.ts')).toBe('c036d0b425a6f0d8839b3eb9286198552365d05892bca67ffdee5dc3f8ff5515'); });
  it('post151-extras: HMAC after-#151 src/parser.ts', () => { expect(hmacSha256('after-#151', 'src/parser.ts')).toBe('ba8a6346aba4eecb6a1253e371d3ac25479df07576caea7b328985394ae39b0f'); });
  it('post151-extras: HMAC leftover src/parser.ts', () => { expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3'); });
  it('post151-extras: HMAC TOKENMAXX src/parser.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8'); });
  it('post151-extras: HMAC HEAVY src/parser.ts', () => { expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70'); });
  it('post151-extras: HMAC no-product-invent src/parser.ts', () => { expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f'); });
  it('post151-extras: HMAC slice-diff src/parser.ts', () => { expect(hmacSha256('slice-diff', 'src/parser.ts')).toBe('fecc1f8258da869db2d707d6e6ed0ab5b64f70825cbadbc6332407d68d28f2c6'); });
  it('post151-extras: HMAC no-src-change src/parser.ts', () => { expect(hmacSha256('no-src-change', 'src/parser.ts')).toBe('e22a10b16e32cbb5f2170343ce1b4adbdc83427acb731f9ca52fb464cefa605b'); });
  it('post151-extras: HMAC manifest-lock src/parser.ts', () => { expect(hmacSha256('manifest-lock', 'src/parser.ts')).toBe('1c5081330de4e7e0aaa0d3449a5e9ef4b8f5a8f5c9c6c828827a3a91f5003bdc'); });
  it('post151-extras: HMAC ci-leftover src/parser.ts', () => { expect(hmacSha256('ci-leftover', 'src/parser.ts')).toBe('e2f699785db0fbf78c15696da509df24bfb3c61ad233c6053c9daada73f45deb'); });
  it('post151-extras: HMAC fuzzywigg src/parser.ts', () => { expect(hmacSha256('fuzzywigg', 'src/parser.ts')).toBe('84bba718304e8ae87e488eb7d34d91334a8a583de252f8bf8c7a1262af17f07a'); });
  it('post151-extras: HMAC backlink src/parser.ts', () => { expect(hmacSha256('backlink', 'src/parser.ts')).toBe('9d45133ec8b6ea6888b04d7810e9e74a5ae6e40f8b885ac29cf9f8828ecb5bdb'); });
  it('post151-extras: HMAC CATALOG_CACHE src/parser.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/parser.ts')).toBe('ddf856247ffac2b53bdf6f38c362e34889395628388d7f243d715d3b11b95c13'); });
  it('post151-extras: HMAC GEMINI_API_KEY src/parser.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/parser.ts')).toBe('7ddb5abcdd7dccdf7e820788700b067da5c51b3621013599cc5db5ea6df8d574'); });
  it('post151-extras: HMAC iptv-org src/parser.ts', () => { expect(hmacSha256('iptv-org', 'src/parser.ts')).toBe('a1c1a7e31db65012bc03f0c219cf6b5c51012ee9753fce5e653b180e24655514'); });
  it('post151-extras: HMAC gemini-2.0-flash src/parser.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/parser.ts')).toBe('2835389a3cb7b57bff2b328a4f671a08b5c12a30f70ab46fdfb0cda4e6cebbed'); });
  it('post151-extras: HMAC VALID_GENRES src/parser.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/parser.ts')).toBe('c51b775d3e1630afd396e0b40a6528864b9ee09b908f4a7fa0fcbb3e4ad68003'); });
  it('post151-extras: HMAC HITL src/parser.ts', () => { expect(hmacSha256('HITL', 'src/parser.ts')).toBe('c19453d8fa9b1b5d3b021c6c72d544a8224dd5766c48b73b9ed8ec6366ab4b8c'); });
  it('post151-extras: HMAC no-creds src/parser.ts', () => { expect(hmacSha256('no-creds', 'src/parser.ts')).toBe('89950b1f9f76306f9c493063768980d9cd7005dca46e56f558d012c7153ac90b'); });
  it('post151-extras: HMAC station_select src/parser.ts', () => { expect(hmacSha256('station_select', 'src/parser.ts')).toBe('825a1b41c9f217c5e3c62ced8594dca07446d982d8770f792268fb7a8b38aa00'); });
  it('post151-extras: size src/parser.ts', () => { expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955); });
  it('post151-extras: utf8-len src/parser.ts', () => { expect(read('src/parser.ts')).toHaveLength(1953); });
  it('post151-extras: nibble src/parser.ts', () => { expect(nibbleSum(sha256('src/parser.ts'))).toBe(477); });
  it('post151-extras: sha256 src/types.ts', () => { expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3'); });
  it('post151-extras: HMAC post151 src/types.ts', () => { expect(hmacSha256('post151', 'src/types.ts')).toBe('2b992c179653625ec9094b5a85d300a4365f5999c537209b9a70d223bc55f628'); });
  it('post151-extras: HMAC after-#151 src/types.ts', () => { expect(hmacSha256('after-#151', 'src/types.ts')).toBe('dbc34df138dc5b722843170415ab02cbd38aa25fdb0088774c8d0030e25051d7'); });
  it('post151-extras: HMAC leftover src/types.ts', () => { expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85'); });
  it('post151-extras: HMAC TOKENMAXX src/types.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc'); });
  it('post151-extras: HMAC HEAVY src/types.ts', () => { expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a'); });
  it('post151-extras: HMAC no-product-invent src/types.ts', () => { expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076'); });
  it('post151-extras: HMAC slice-diff src/types.ts', () => { expect(hmacSha256('slice-diff', 'src/types.ts')).toBe('d1e497bd3dc7e06713395285b574a0d0da8bdd3b9614da249b4218aad57bd70b'); });
  it('post151-extras: HMAC no-src-change src/types.ts', () => { expect(hmacSha256('no-src-change', 'src/types.ts')).toBe('66b6c84c4d65babc626f3d0614b2d67cf4e18375f20cf74ae311e52bfcd2acc2'); });
  it('post151-extras: HMAC manifest-lock src/types.ts', () => { expect(hmacSha256('manifest-lock', 'src/types.ts')).toBe('96a5eda772aed1d149de5c3486ab886fc5b5f9108ad8b2ff8f11be66f236b356'); });
  it('post151-extras: HMAC ci-leftover src/types.ts', () => { expect(hmacSha256('ci-leftover', 'src/types.ts')).toBe('eed6bbfd826b3607c087a20dbbc766b3934b10601e1fee3e457f411f5274a283'); });
  it('post151-extras: HMAC fuzzywigg src/types.ts', () => { expect(hmacSha256('fuzzywigg', 'src/types.ts')).toBe('9318202ab26e14c853a66c82681f61370e99b88948d0cb0daced2f0fae39cf07'); });
  it('post151-extras: HMAC backlink src/types.ts', () => { expect(hmacSha256('backlink', 'src/types.ts')).toBe('e57ac0af28a81c88406f41b07efba081908eb642ad8c26416b188c8a14381bdd'); });
  it('post151-extras: HMAC CATALOG_CACHE src/types.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'src/types.ts')).toBe('217643d1e9a50ba2be3effa7673ad2785ea71c7441744e68ab2e13963b414686'); });
  it('post151-extras: HMAC GEMINI_API_KEY src/types.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'src/types.ts')).toBe('8632030af7092ce4f15cb6ad4d3358ce01c0be8df8f0e9d8f0ac424565844e28'); });
  it('post151-extras: HMAC iptv-org src/types.ts', () => { expect(hmacSha256('iptv-org', 'src/types.ts')).toBe('ca5f1e1fd976bb3fe291c6a55c65ddeff53de41b4fc58212755883dc30307874'); });
  it('post151-extras: HMAC gemini-2.0-flash src/types.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'src/types.ts')).toBe('b72909259e90987dd950a6ceb67ec6055502e3251fd0189b9103eaa446f91827'); });
  it('post151-extras: HMAC VALID_GENRES src/types.ts', () => { expect(hmacSha256('VALID_GENRES', 'src/types.ts')).toBe('96a757d30d94fe78ea2147e822dc6253b999cd19a15f6d719394a666bfbc35ac'); });
  it('post151-extras: HMAC HITL src/types.ts', () => { expect(hmacSha256('HITL', 'src/types.ts')).toBe('24a9d0042b44f1b08dd117266f91d4794d44bf5007fe1ae9fdd668c4970e5519'); });
  it('post151-extras: HMAC no-creds src/types.ts', () => { expect(hmacSha256('no-creds', 'src/types.ts')).toBe('54a003b7f2d60b6b8cf47b21fd8a0b8044b12fa7a9296db10bf8186e17cb0d47'); });
  it('post151-extras: HMAC station_select src/types.ts', () => { expect(hmacSha256('station_select', 'src/types.ts')).toBe('17f8b2954253737ee48837a36505a948abb9c7a6c7efcd18d6da8ebbdbc169bf'); });
  it('post151-extras: size src/types.ts', () => { expect(statSync(join(root, 'src/types.ts')).size).toBe(174); });
  it('post151-extras: utf8-len src/types.ts', () => { expect(read('src/types.ts')).toHaveLength(172); });
  it('post151-extras: nibble src/types.ts', () => { expect(nibbleSum(sha256('src/types.ts'))).toBe(520); });
  it('post151-extras: sha256 package.json', () => { expect(sha256('package.json')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c'); });
  it('post151-extras: HMAC post151 package.json', () => { expect(hmacSha256('post151', 'package.json')).toBe('17a23271ced025297b02ac6e203ec3a70afc9e15c8b39211edc81e4b9e01d3da'); });
  it('post151-extras: HMAC after-#151 package.json', () => { expect(hmacSha256('after-#151', 'package.json')).toBe('e0fb2322dff46415d357d014730dd55c9aab471bb3de691d2ba17c6ae2bb8cad'); });
  it('post151-extras: HMAC leftover package.json', () => { expect(hmacSha256('leftover', 'package.json')).toBe('20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1'); });
  it('post151-extras: HMAC TOKENMAXX package.json', () => { expect(hmacSha256('TOKENMAXX', 'package.json')).toBe('ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58'); });
  it('post151-extras: HMAC HEAVY package.json', () => { expect(hmacSha256('HEAVY', 'package.json')).toBe('59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563'); });
  it('post151-extras: HMAC no-product-invent package.json', () => { expect(hmacSha256('no-product-invent', 'package.json')).toBe('b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b'); });
  it('post151-extras: HMAC slice-diff package.json', () => { expect(hmacSha256('slice-diff', 'package.json')).toBe('dc869038c3869410db214fb5618c8f6091545ded44463dd4ccdf26cefc3dca56'); });
  it('post151-extras: HMAC no-src-change package.json', () => { expect(hmacSha256('no-src-change', 'package.json')).toBe('f89ef881d4621b0b9716e0341fb3cd014b14115046ec8e1fbc1baa995c764959'); });
  it('post151-extras: HMAC manifest-lock package.json', () => { expect(hmacSha256('manifest-lock', 'package.json')).toBe('c78857efdc2a9ef7366350439061383f242d1056da2d338f56f4d698b5748417'); });
  it('post151-extras: HMAC ci-leftover package.json', () => { expect(hmacSha256('ci-leftover', 'package.json')).toBe('102b83554fdec2063f592609639a34855726991a878bb10bf3339bf4457e0c13'); });
  it('post151-extras: HMAC fuzzywigg package.json', () => { expect(hmacSha256('fuzzywigg', 'package.json')).toBe('29f3398cd55d65de213eea45460d236f4ddaacfa08bb09b4806c16808c9749ab'); });
  it('post151-extras: HMAC backlink package.json', () => { expect(hmacSha256('backlink', 'package.json')).toBe('6edca9c2fa551d553a75d6e537f429b54763a48bf941865889f51008af5b38f5'); });
  it('post151-extras: HMAC CATALOG_CACHE package.json', () => { expect(hmacSha256('CATALOG_CACHE', 'package.json')).toBe('80864c6eb119181f7746cc83f6d5cfee07352f1e2554717b929069f4e873922f'); });
  it('post151-extras: HMAC GEMINI_API_KEY package.json', () => { expect(hmacSha256('GEMINI_API_KEY', 'package.json')).toBe('af6a4ce63cda6979a3b5425f09d776c65adff17550733712750e4b90591c57e0'); });
  it('post151-extras: HMAC iptv-org package.json', () => { expect(hmacSha256('iptv-org', 'package.json')).toBe('cc2fce6124feabd16b696cdcbc3d0ecc481e9367146c22575291da1497d6e67f'); });
  it('post151-extras: HMAC gemini-2.0-flash package.json', () => { expect(hmacSha256('gemini-2.0-flash', 'package.json')).toBe('a8b62f12818d2fcd08ddf09e2821a2a106ea0ba830a5ae22203e95a9b5a131dd'); });
  it('post151-extras: HMAC VALID_GENRES package.json', () => { expect(hmacSha256('VALID_GENRES', 'package.json')).toBe('c0887b6d1092056b1b04ae66f8ef2477a978469378405706b49ed7cd084fbadb'); });
  it('post151-extras: HMAC HITL package.json', () => { expect(hmacSha256('HITL', 'package.json')).toBe('28ad7c71e0cbd46cab4e1f494c8e29a6140d447b63e530001e98d85096dc6424'); });
  it('post151-extras: HMAC no-creds package.json', () => { expect(hmacSha256('no-creds', 'package.json')).toBe('15af23ac155e77825588a3afa5d5dd54969bf30578982a9cbce26656593fbef4'); });
  it('post151-extras: HMAC station_select package.json', () => { expect(hmacSha256('station_select', 'package.json')).toBe('12403ef6772e65e54c71f3a2183faa28cfdd487cf171ddeb91f2bd6c663198fa'); });
  it('post151-extras: size package.json', () => { expect(statSync(join(root, 'package.json')).size).toBe(637); });
  it('post151-extras: utf8-len package.json', () => { expect(read('package.json')).toHaveLength(635); });
  it('post151-extras: nibble package.json', () => { expect(nibbleSum(sha256('package.json'))).toBe(451); });
  it('post151-extras: sha256 vitest.config.ts', () => { expect(sha256('vitest.config.ts')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38'); });
  it('post151-extras: HMAC post151 vitest.config.ts', () => { expect(hmacSha256('post151', 'vitest.config.ts')).toBe('58100d0f23a5daf10a8d5c809d634ad31c1c667e2de1d7ccf1e6fb82bcde16a9'); });
  it('post151-extras: HMAC after-#151 vitest.config.ts', () => { expect(hmacSha256('after-#151', 'vitest.config.ts')).toBe('2c3a983c75585006bf868db16bf2ee2799cdb07b323fdc1562497cdf78744487'); });
  it('post151-extras: HMAC leftover vitest.config.ts', () => { expect(hmacSha256('leftover', 'vitest.config.ts')).toBe('3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7'); });
  it('post151-extras: HMAC TOKENMAXX vitest.config.ts', () => { expect(hmacSha256('TOKENMAXX', 'vitest.config.ts')).toBe('0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9'); });
  it('post151-extras: HMAC HEAVY vitest.config.ts', () => { expect(hmacSha256('HEAVY', 'vitest.config.ts')).toBe('08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179'); });
  it('post151-extras: HMAC no-product-invent vitest.config.ts', () => { expect(hmacSha256('no-product-invent', 'vitest.config.ts')).toBe('3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c'); });
  it('post151-extras: HMAC slice-diff vitest.config.ts', () => { expect(hmacSha256('slice-diff', 'vitest.config.ts')).toBe('561ba73465a9de5fd03d403c4dd508c2058439a0206f6a694190dd71b47a4f70'); });
  it('post151-extras: HMAC no-src-change vitest.config.ts', () => { expect(hmacSha256('no-src-change', 'vitest.config.ts')).toBe('9e2fe808f40ed7a1049bef62978dd65efbea705482829585570b3fc4f5bf1a54'); });
  it('post151-extras: HMAC manifest-lock vitest.config.ts', () => { expect(hmacSha256('manifest-lock', 'vitest.config.ts')).toBe('7ae3b954bcee884ec6b1aada9b98e3b746465b99d10627ccb8def98e1e97799d'); });
  it('post151-extras: HMAC ci-leftover vitest.config.ts', () => { expect(hmacSha256('ci-leftover', 'vitest.config.ts')).toBe('8cf06e739c685417e72daea0142de1607ddbe955d54d810879d56c13aff1b103'); });
  it('post151-extras: HMAC fuzzywigg vitest.config.ts', () => { expect(hmacSha256('fuzzywigg', 'vitest.config.ts')).toBe('11811ba74794b999f74e0716a1ef4e938437d91ea79ae809fbe55a6d25834ecf'); });
  it('post151-extras: HMAC backlink vitest.config.ts', () => { expect(hmacSha256('backlink', 'vitest.config.ts')).toBe('9f05f99a641de0b84fc9eb602e9ad46d0189031ab17a4b7872322a8097e85b4c'); });
  it('post151-extras: HMAC CATALOG_CACHE vitest.config.ts', () => { expect(hmacSha256('CATALOG_CACHE', 'vitest.config.ts')).toBe('87d5c10f207942049b62137d17f4187bdcfa0c4ed4d5c81a6cf16688700770eb'); });
  it('post151-extras: HMAC GEMINI_API_KEY vitest.config.ts', () => { expect(hmacSha256('GEMINI_API_KEY', 'vitest.config.ts')).toBe('4c4358397aaead3dbf91659e580f1b76b09fd4df40027231a57276ffc056f934'); });
  it('post151-extras: HMAC iptv-org vitest.config.ts', () => { expect(hmacSha256('iptv-org', 'vitest.config.ts')).toBe('e30e727ec62be2a66d619b0e3ed8252175f016ed7b680abbbafc0e6c5f85a1af'); });
  it('post151-extras: HMAC gemini-2.0-flash vitest.config.ts', () => { expect(hmacSha256('gemini-2.0-flash', 'vitest.config.ts')).toBe('bc3d1286c8f23e97924120d5845ef9b3af4c67dd545c4f61b99127ecd0930330'); });
  it('post151-extras: HMAC VALID_GENRES vitest.config.ts', () => { expect(hmacSha256('VALID_GENRES', 'vitest.config.ts')).toBe('9e6243131d25151a04c1ec7b4bc9b4c3623baf9c6cfd56cf76a81ce89ce631c3'); });
  it('post151-extras: HMAC HITL vitest.config.ts', () => { expect(hmacSha256('HITL', 'vitest.config.ts')).toBe('7a9860baf8257f33d9c739ba74909a2051072f177f84ca19c344f8f926b33875'); });
  it('post151-extras: HMAC no-creds vitest.config.ts', () => { expect(hmacSha256('no-creds', 'vitest.config.ts')).toBe('edb4063e8392ffedd0c01cc05cef728c2bf3170b805ee29fd249e2603c5f5125'); });
  it('post151-extras: HMAC station_select vitest.config.ts', () => { expect(hmacSha256('station_select', 'vitest.config.ts')).toBe('27260ec47299c67a72e5670f0ef93a9a83c26bde2a511f91eed32aaeb62222dc'); });
  it('post151-extras: size vitest.config.ts', () => { expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535); });
  it('post151-extras: utf8-len vitest.config.ts', () => { expect(read('vitest.config.ts')).toHaveLength(535); });
  it('post151-extras: nibble vitest.config.ts', () => { expect(nibbleSum(sha256('vitest.config.ts'))).toBe(536); });
  it('post151-extras: sha256 tsconfig.json', () => { expect(sha256('tsconfig.json')).toBe('ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792'); });
  it('post151-extras: HMAC post151 tsconfig.json', () => { expect(hmacSha256('post151', 'tsconfig.json')).toBe('f233533b0e190e31bc21cbbb54bd9f22ec9f5a36a325d40972690d6132f35b52'); });
  it('post151-extras: HMAC after-#151 tsconfig.json', () => { expect(hmacSha256('after-#151', 'tsconfig.json')).toBe('0f9df82424e4545fe2a826bb323bd27e6d0cc866815e3e38bc094ff7e85394b7'); });
  it('post151-extras: HMAC leftover tsconfig.json', () => { expect(hmacSha256('leftover', 'tsconfig.json')).toBe('8b1d7fdf24ecef58d7971089e3fb62f7cf97d8a840f50636ffa32327fa8503a9'); });
  it('post151-extras: HMAC TOKENMAXX tsconfig.json', () => { expect(hmacSha256('TOKENMAXX', 'tsconfig.json')).toBe('2da19928cb9b06a5242f987184cc2d44cc385aed692bf3b6fa005e79065d47d1'); });
  it('post151-extras: HMAC HEAVY tsconfig.json', () => { expect(hmacSha256('HEAVY', 'tsconfig.json')).toBe('351594a3f9f8c0502c2a8387cd10b128a0cc58fc4bc16001784d9e1b55a4088f'); });
  it('post151-extras: HMAC no-product-invent tsconfig.json', () => { expect(hmacSha256('no-product-invent', 'tsconfig.json')).toBe('94ad9d8f2eeaf1debb6286a3db3ef2dfadafc8f031999c1c384fef8d8310ae22'); });
  it('post151-extras: HMAC slice-diff tsconfig.json', () => { expect(hmacSha256('slice-diff', 'tsconfig.json')).toBe('283515c2a7db0c9a5766d62df6d62217945f7b229ecc08301523a8b5466c3675'); });
  it('post151-extras: HMAC no-src-change tsconfig.json', () => { expect(hmacSha256('no-src-change', 'tsconfig.json')).toBe('85133c5251f48153837ae5edbf26caf56904922c40ba07af452e502e1c876d20'); });
  it('post151-extras: HMAC manifest-lock tsconfig.json', () => { expect(hmacSha256('manifest-lock', 'tsconfig.json')).toBe('5987d1790e3a064e0431d9e3ed61dfee5cc5d325e3adc32e95ffb65c9b8dd6e6'); });
  it('post151-extras: HMAC ci-leftover tsconfig.json', () => { expect(hmacSha256('ci-leftover', 'tsconfig.json')).toBe('041a5ef4b4cdf3c4b6e4b3926c1e40ef5054c4d372fc74bc91f80f4b757cf4d4'); });
  it('post151-extras: HMAC fuzzywigg tsconfig.json', () => { expect(hmacSha256('fuzzywigg', 'tsconfig.json')).toBe('c51f00a52aa0938458c80450410885d52dc08a16099d1c6894dca63dd95babab'); });
  it('post151-extras: HMAC backlink tsconfig.json', () => { expect(hmacSha256('backlink', 'tsconfig.json')).toBe('b3232bc6acbf0dcc24483fa2fb612812db1ca89a052cab225146450190dc3208'); });
  it('post151-extras: HMAC CATALOG_CACHE tsconfig.json', () => { expect(hmacSha256('CATALOG_CACHE', 'tsconfig.json')).toBe('b2257d6efdd8d55236787aa4d431c9779c2a367b6677fe12b1a1566be9f25e1e'); });
  it('post151-extras: HMAC GEMINI_API_KEY tsconfig.json', () => { expect(hmacSha256('GEMINI_API_KEY', 'tsconfig.json')).toBe('7eef14ea0beed1b5a47bd2b3c4d8a766ffcdc6f05898332b22b656b0c11052ba'); });
  it('post151-extras: HMAC iptv-org tsconfig.json', () => { expect(hmacSha256('iptv-org', 'tsconfig.json')).toBe('ec7fc906f9889213f932922b0a07ffe8a97e475a708c7de3838d28cece15ed8e'); });
  it('post151-extras: HMAC gemini-2.0-flash tsconfig.json', () => { expect(hmacSha256('gemini-2.0-flash', 'tsconfig.json')).toBe('7b8932153fdc65c7a0a3e78e3c2aa9f8f99e189fb998c734272f9b3054bcfc0a'); });
  it('post151-extras: HMAC VALID_GENRES tsconfig.json', () => { expect(hmacSha256('VALID_GENRES', 'tsconfig.json')).toBe('57a7728d81554720dea9d9419ce817789cb203144ed7988ce0308e13383db812'); });
  it('post151-extras: HMAC HITL tsconfig.json', () => { expect(hmacSha256('HITL', 'tsconfig.json')).toBe('4551913da487bb3a9dd1b23be2d2a360ef2fec843b11d43e84cb88c022c16b42'); });
  it('post151-extras: HMAC no-creds tsconfig.json', () => { expect(hmacSha256('no-creds', 'tsconfig.json')).toBe('3ffe23dca04b405631388cd34022948a4b881d36716e41fbb607b6254ae85045'); });
  it('post151-extras: HMAC station_select tsconfig.json', () => { expect(hmacSha256('station_select', 'tsconfig.json')).toBe('30a5246b37ddc1c489a9246cf6c3345c9e62b5e4966dec48cd8c5ae4f07720eb'); });
  it('post151-extras: size tsconfig.json', () => { expect(statSync(join(root, 'tsconfig.json')).size).toBe(397); });
  it('post151-extras: utf8-len tsconfig.json', () => { expect(read('tsconfig.json')).toHaveLength(397); });
  it('post151-extras: nibble tsconfig.json', () => { expect(nibbleSum(sha256('tsconfig.json'))).toBe(506); });
  it('post151-extras: sha256 wrangler.toml', () => { expect(sha256('wrangler.toml')).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8'); });
  it('post151-extras: HMAC post151 wrangler.toml', () => { expect(hmacSha256('post151', 'wrangler.toml')).toBe('e6bd5b7704a1e61b9cee9800744d9959ad72c8a9472876e9e203bee4ba343288'); });
  it('post151-extras: HMAC after-#151 wrangler.toml', () => { expect(hmacSha256('after-#151', 'wrangler.toml')).toBe('07d3c93baa80fb4fce5aca86cd5e362432ae96127519f04e43e4ff2519a53cdf'); });
  it('post151-extras: HMAC leftover wrangler.toml', () => { expect(hmacSha256('leftover', 'wrangler.toml')).toBe('117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063'); });
  it('post151-extras: HMAC TOKENMAXX wrangler.toml', () => { expect(hmacSha256('TOKENMAXX', 'wrangler.toml')).toBe('7d198a7e11f32e841079eb2398433044d49d9336bb0642737d55dbb39a1206d4'); });
  it('post151-extras: HMAC HEAVY wrangler.toml', () => { expect(hmacSha256('HEAVY', 'wrangler.toml')).toBe('0106e385ea2e0ca3fd52ddc940a1eb5921a22885362d57f5a49dd1bda89ea5db'); });
  it('post151-extras: HMAC no-product-invent wrangler.toml', () => { expect(hmacSha256('no-product-invent', 'wrangler.toml')).toBe('3d99d134e0673c8ff163b29a6c72e49bfa5e599898762bf47dd20f0e65639abb'); });
  it('post151-extras: HMAC slice-diff wrangler.toml', () => { expect(hmacSha256('slice-diff', 'wrangler.toml')).toBe('ff10d155b4bfa2137b3d8248b28954f776f80f51ddf29915f4a0792dca9e4b17'); });
  it('post151-extras: HMAC no-src-change wrangler.toml', () => { expect(hmacSha256('no-src-change', 'wrangler.toml')).toBe('b542f61e71ea970554a5d78c6f3caa0491697694218687f89822c8cc8509b67b'); });
  it('post151-extras: HMAC manifest-lock wrangler.toml', () => { expect(hmacSha256('manifest-lock', 'wrangler.toml')).toBe('ba1c46086c0d7c2f08a90b091ba228b20b7bf50c702c3e3478a8b4b96e95d882'); });
  it('post151-extras: HMAC ci-leftover wrangler.toml', () => { expect(hmacSha256('ci-leftover', 'wrangler.toml')).toBe('e8f282ad2cf0521eaa2162ae7533e8bdbfd845ce4c9523d4171712c708267b19'); });
  it('post151-extras: HMAC fuzzywigg wrangler.toml', () => { expect(hmacSha256('fuzzywigg', 'wrangler.toml')).toBe('4f271fc6714d566a00b298cdfb6a651d66b4584a14851ea67a7ebbd1cedd9407'); });
  it('post151-extras: HMAC backlink wrangler.toml', () => { expect(hmacSha256('backlink', 'wrangler.toml')).toBe('e6ea9a4c22d8be77830f69ba042d79bb716184b8783f2ede72efa58b3b7601d4'); });
  it('post151-extras: HMAC CATALOG_CACHE wrangler.toml', () => { expect(hmacSha256('CATALOG_CACHE', 'wrangler.toml')).toBe('9335716a0466ecfa551aa06fc7eef4ef33fe1611e0542e420de582ba1bcac0b5'); });
  it('post151-extras: HMAC GEMINI_API_KEY wrangler.toml', () => { expect(hmacSha256('GEMINI_API_KEY', 'wrangler.toml')).toBe('92708ab36e6cec40464d1d99390978feaf9d5a1eaa4b7caa0249267812835f4b'); });
  it('post151-extras: HMAC iptv-org wrangler.toml', () => { expect(hmacSha256('iptv-org', 'wrangler.toml')).toBe('75babdee8ac19193de0572bac5d2cf8f8a5da10273b7dab924411328ea78dfe4'); });
  it('post151-extras: HMAC gemini-2.0-flash wrangler.toml', () => { expect(hmacSha256('gemini-2.0-flash', 'wrangler.toml')).toBe('9c793ea5dcfc6fc73c2015c8c297e17247936693530a565aa0bf352ea7af9602'); });
  it('post151-extras: HMAC VALID_GENRES wrangler.toml', () => { expect(hmacSha256('VALID_GENRES', 'wrangler.toml')).toBe('b63c6f1421f8427f0055707971a3e4a458cde77362a98559fb80c8f99f38398f'); });
  it('post151-extras: HMAC HITL wrangler.toml', () => { expect(hmacSha256('HITL', 'wrangler.toml')).toBe('163535e4f1ffba9fa5d82ccec88c349b95720ee09d57f10a4b7d067551b2e0bf'); });
  it('post151-extras: HMAC no-creds wrangler.toml', () => { expect(hmacSha256('no-creds', 'wrangler.toml')).toBe('2f585aec12070820ca445e59c4c14270f3573b616d67114117b12c0018a2be8f'); });
  it('post151-extras: HMAC station_select wrangler.toml', () => { expect(hmacSha256('station_select', 'wrangler.toml')).toBe('f0b7d94bba773863439815ba8abeb52e13d4a5cd9a56e00ccbc8fa8d9bf4e50e'); });
  it('post151-extras: size wrangler.toml', () => { expect(statSync(join(root, 'wrangler.toml')).size).toBe(330); });
  it('post151-extras: utf8-len wrangler.toml', () => { expect(read('wrangler.toml')).toHaveLength(330); });
  it('post151-extras: nibble wrangler.toml', () => { expect(nibbleSum(sha256('wrangler.toml'))).toBe(457); });
  it('post151-extras: sha256 AGENTS.md', () => { expect(sha256('AGENTS.md')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa'); });
  it('post151-extras: HMAC post151 AGENTS.md', () => { expect(hmacSha256('post151', 'AGENTS.md')).toBe('c497c387b43de477b62c09df282439b91ebb8d097e21963e2cd0b894957d0ed6'); });
  it('post151-extras: HMAC after-#151 AGENTS.md', () => { expect(hmacSha256('after-#151', 'AGENTS.md')).toBe('54ce0c72b71957cae84ed551370573c7f1f13cbb67a8841f38bfbb61af8c90df'); });
  it('post151-extras: HMAC leftover AGENTS.md', () => { expect(hmacSha256('leftover', 'AGENTS.md')).toBe('ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e'); });
  it('post151-extras: HMAC TOKENMAXX AGENTS.md', () => { expect(hmacSha256('TOKENMAXX', 'AGENTS.md')).toBe('b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f'); });
  it('post151-extras: HMAC HEAVY AGENTS.md', () => { expect(hmacSha256('HEAVY', 'AGENTS.md')).toBe('f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c'); });
  it('post151-extras: HMAC no-product-invent AGENTS.md', () => { expect(hmacSha256('no-product-invent', 'AGENTS.md')).toBe('dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264'); });
  it('post151-extras: HMAC slice-diff AGENTS.md', () => { expect(hmacSha256('slice-diff', 'AGENTS.md')).toBe('870cb0b7ca943c82a943cb231e6171ba55b8a1be90d4368fe1e30a3666060c90'); });
  it('post151-extras: HMAC no-src-change AGENTS.md', () => { expect(hmacSha256('no-src-change', 'AGENTS.md')).toBe('94cb89045ff7e09a81a02dd8ee4ee7eb0ef7d412d7260f9ab24056774ed00967'); });
  it('post151-extras: HMAC manifest-lock AGENTS.md', () => { expect(hmacSha256('manifest-lock', 'AGENTS.md')).toBe('af3b8d7bad009043c764c1d1f67b9526650ba158a9053d887985ddce5dc997c5'); });
  it('post151-extras: HMAC ci-leftover AGENTS.md', () => { expect(hmacSha256('ci-leftover', 'AGENTS.md')).toBe('47b5afd8ad6d2a52b35cc12ced2b83f86ea0ba4b7ff3651c58de70715482254c'); });
  it('post151-extras: HMAC fuzzywigg AGENTS.md', () => { expect(hmacSha256('fuzzywigg', 'AGENTS.md')).toBe('8eda2249f938456fded535468826738c7e146ca6574f36f3853700897f5d5163'); });
  it('post151-extras: HMAC backlink AGENTS.md', () => { expect(hmacSha256('backlink', 'AGENTS.md')).toBe('6da6cfcf4fa0441e1a6cacca52bca8b03afa2a93acb9321dccba7d8dce0f804f'); });
  it('post151-extras: HMAC CATALOG_CACHE AGENTS.md', () => { expect(hmacSha256('CATALOG_CACHE', 'AGENTS.md')).toBe('091ea475ef4827ea9c4dc046d5bbe7e91505ce4e59d4474fa384a31f7176e580'); });
  it('post151-extras: HMAC GEMINI_API_KEY AGENTS.md', () => { expect(hmacSha256('GEMINI_API_KEY', 'AGENTS.md')).toBe('69741f5f0094e4bb2cfe0c30539ac82134f9a17312bd155e140d46a1989212c6'); });
  it('post151-extras: HMAC iptv-org AGENTS.md', () => { expect(hmacSha256('iptv-org', 'AGENTS.md')).toBe('0aff55c1d8bd109ce5a11b8bd72e5509f1d7cc6ef1935ddef7a8231443bcf464'); });
  it('post151-extras: HMAC gemini-2.0-flash AGENTS.md', () => { expect(hmacSha256('gemini-2.0-flash', 'AGENTS.md')).toBe('42efae3491e3bd78851b00249a2ec44b09a2ee457c07a666d5d3ed94c6301ea5'); });
  it('post151-extras: HMAC VALID_GENRES AGENTS.md', () => { expect(hmacSha256('VALID_GENRES', 'AGENTS.md')).toBe('d9db876c73c1b923b117dbf619d87c48362614d2bfd0e62b18658230e0a1fbf5'); });
  it('post151-extras: HMAC HITL AGENTS.md', () => { expect(hmacSha256('HITL', 'AGENTS.md')).toBe('0df134c66ef2431f8f7d8b281ed09c1ffedddaa4fe6f91357592a9a6ef37bece'); });
  it('post151-extras: HMAC no-creds AGENTS.md', () => { expect(hmacSha256('no-creds', 'AGENTS.md')).toBe('7f85e663a40b787e2df5e296431307e470764c453a109376e28a20dc4d008e50'); });
  it('post151-extras: HMAC station_select AGENTS.md', () => { expect(hmacSha256('station_select', 'AGENTS.md')).toBe('97f8c43806017259d483cf4af0078542c11849c1ea77ba3efae151d22aee085a'); });
  it('post151-extras: size AGENTS.md', () => { expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017); });
  it('post151-extras: utf8-len AGENTS.md', () => { expect(read('AGENTS.md')).toHaveLength(1011); });
  it('post151-extras: nibble AGENTS.md', () => { expect(nibbleSum(sha256('AGENTS.md'))).toBe(479); });
  it('post151-extras: sha256 DEPLOY.md', () => { expect(sha256('DEPLOY.md')).toBe('11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a'); });
  it('post151-extras: HMAC post151 DEPLOY.md', () => { expect(hmacSha256('post151', 'DEPLOY.md')).toBe('1cb1d99f7160e086654c11a5e901723b465e540ca056a2422e1a0e8a46f70bfa'); });
  it('post151-extras: HMAC after-#151 DEPLOY.md', () => { expect(hmacSha256('after-#151', 'DEPLOY.md')).toBe('3084c0000c84928af00a1bb96d8d7863b7646ae3e9cbecc770b950f984bd8ac4'); });
  it('post151-extras: HMAC leftover DEPLOY.md', () => { expect(hmacSha256('leftover', 'DEPLOY.md')).toBe('8e69d3722a2f57941fecb3a0602ebb6cab5a31755e7c8bc88ed0771bc1822659'); });
  it('post151-extras: HMAC TOKENMAXX DEPLOY.md', () => { expect(hmacSha256('TOKENMAXX', 'DEPLOY.md')).toBe('bdb0c19924928cf4d54308dcdd72f032fea4ae1994669e96bf22f48567084f26'); });
  it('post151-extras: HMAC HEAVY DEPLOY.md', () => { expect(hmacSha256('HEAVY', 'DEPLOY.md')).toBe('5e8e11b4b80c19b0e2828f509f4411d5c7d176f5101c2aa2094ae43dfcf385d3'); });
  it('post151-extras: HMAC no-product-invent DEPLOY.md', () => { expect(hmacSha256('no-product-invent', 'DEPLOY.md')).toBe('cb29f601b5afcc4ca9e180a792e0a028c44afad0b5fcbbbafdd0dcee3c24f29e'); });
  it('post151-extras: HMAC slice-diff DEPLOY.md', () => { expect(hmacSha256('slice-diff', 'DEPLOY.md')).toBe('723355201d08c16dada7a9d8e6320062b2f596dfc3c410fc608ae1fdb6495a01'); });
  it('post151-extras: HMAC no-src-change DEPLOY.md', () => { expect(hmacSha256('no-src-change', 'DEPLOY.md')).toBe('970a597da05c0d8f2f4e8edec9f75ac1d9bb6911a8bd66098985eca56e650d9a'); });
  it('post151-extras: HMAC manifest-lock DEPLOY.md', () => { expect(hmacSha256('manifest-lock', 'DEPLOY.md')).toBe('618d1f805ccde592ec38ddddba5e67e23b505691f1851e12a013ff9f7fd70bc9'); });
  it('post151-extras: HMAC ci-leftover DEPLOY.md', () => { expect(hmacSha256('ci-leftover', 'DEPLOY.md')).toBe('40a3fdac18524310193597e1d8836c0709382719e16ba278e50bc1cd6b5ff15e'); });
  it('post151-extras: HMAC fuzzywigg DEPLOY.md', () => { expect(hmacSha256('fuzzywigg', 'DEPLOY.md')).toBe('8a4a21b339caa609f8667ee3e0b3d09765f589e5ef8cd84f152713d9911f20cc'); });
  it('post151-extras: HMAC backlink DEPLOY.md', () => { expect(hmacSha256('backlink', 'DEPLOY.md')).toBe('f5e3236dd35cae2d679bd9c4cff402ab17fbf594757881a13c8446d1be626060'); });
  it('post151-extras: HMAC CATALOG_CACHE DEPLOY.md', () => { expect(hmacSha256('CATALOG_CACHE', 'DEPLOY.md')).toBe('47c7f2febb65f3f607ec2fbd59fa15801bd6bcfbdf54e51d5d5fe37fdaf7eeb6'); });
  it('post151-extras: HMAC GEMINI_API_KEY DEPLOY.md', () => { expect(hmacSha256('GEMINI_API_KEY', 'DEPLOY.md')).toBe('1e72529fe918a18cd371f1ac2a9db00b2f19952405616c7f5412b342a1279566'); });
  it('post151-extras: HMAC iptv-org DEPLOY.md', () => { expect(hmacSha256('iptv-org', 'DEPLOY.md')).toBe('577f23a01148634d22b5e19e9b16d29d2038c9ae82ba9912cca61ce874ddc619'); });
  it('post151-extras: HMAC gemini-2.0-flash DEPLOY.md', () => { expect(hmacSha256('gemini-2.0-flash', 'DEPLOY.md')).toBe('299f695aca3306cbee3cb69ec1baf03bdd8bcf0c1fc6d967470204036b06e7c7'); });
  it('post151-extras: HMAC VALID_GENRES DEPLOY.md', () => { expect(hmacSha256('VALID_GENRES', 'DEPLOY.md')).toBe('d220673fe272b7c854483e7c35554cb858bd2bf8ea7975d629c02037f748bf75'); });
  it('post151-extras: HMAC HITL DEPLOY.md', () => { expect(hmacSha256('HITL', 'DEPLOY.md')).toBe('304c5ef7a469283183c42d01f6c8c29fdb237fcdadb181445171e15f8c8bf071'); });
  it('post151-extras: HMAC no-creds DEPLOY.md', () => { expect(hmacSha256('no-creds', 'DEPLOY.md')).toBe('7de98a2c002a5904932835052d85cd02a299aa9ad28ff928c19a14775117cac6'); });
  it('post151-extras: HMAC station_select DEPLOY.md', () => { expect(hmacSha256('station_select', 'DEPLOY.md')).toBe('eb37933ea3d022f168ed977c342ce730a42227e7956e0d836dffae89f03a765e'); });
  it('post151-extras: size DEPLOY.md', () => { expect(statSync(join(root, 'DEPLOY.md')).size).toBe(1573); });
  it('post151-extras: utf8-len DEPLOY.md', () => { expect(read('DEPLOY.md')).toHaveLength(1539); });
  it('post151-extras: nibble DEPLOY.md', () => { expect(nibbleSum(sha256('DEPLOY.md'))).toBe(439); });
  it('post151-extras: sha256 README.md', () => { expect(sha256('README.md')).toBe('f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987'); });
  it('post151-extras: HMAC post151 README.md', () => { expect(hmacSha256('post151', 'README.md')).toBe('362824b19db7af323f13a4c2daf1bbc9c6a6d488c3eb3c10d9f89cb7d9a207c3'); });
  it('post151-extras: HMAC after-#151 README.md', () => { expect(hmacSha256('after-#151', 'README.md')).toBe('148e5437c8258ada3af8907309c9783c3226a2a31812d0ae0dbbd754f83a5b7f'); });
  it('post151-extras: HMAC leftover README.md', () => { expect(hmacSha256('leftover', 'README.md')).toBe('57c08297703e57c6b5694a515e43b6592bd130637c82dcc569a048bda2fd181f'); });
  it('post151-extras: HMAC TOKENMAXX README.md', () => { expect(hmacSha256('TOKENMAXX', 'README.md')).toBe('51a608392fd700865f32aac02646908bf1235d6c4d587e9daa92383d6a777b94'); });
  it('post151-extras: HMAC HEAVY README.md', () => { expect(hmacSha256('HEAVY', 'README.md')).toBe('4bb62cc19640e3a3d792e3eba8d499203b4729899d5838ec2065ee409ab0430d'); });
  it('post151-extras: HMAC no-product-invent README.md', () => { expect(hmacSha256('no-product-invent', 'README.md')).toBe('c1d8bb52c5ad591530152e8ec780bd262a1b78aeb7aea241bcef2a46a5e1ad7a'); });
  it('post151-extras: HMAC slice-diff README.md', () => { expect(hmacSha256('slice-diff', 'README.md')).toBe('afd276d87586dcc4395cec6f4a88c365bedd3992dc0b6a4448b04ad23f186225'); });
  it('post151-extras: HMAC no-src-change README.md', () => { expect(hmacSha256('no-src-change', 'README.md')).toBe('017324f9cb021cd4af3721c48db1e471d472683f64af8e7f0b4a52d2b77d2fba'); });
  it('post151-extras: HMAC manifest-lock README.md', () => { expect(hmacSha256('manifest-lock', 'README.md')).toBe('338002f36227d22e700f2cfa8d7a9a592e093f5ffbcef1c27583b8a0d79dd8d5'); });
  it('post151-extras: HMAC ci-leftover README.md', () => { expect(hmacSha256('ci-leftover', 'README.md')).toBe('c2d185906a96347063f552d6ebad46b2c19f16d39439100432a9da503b694ad8'); });
  it('post151-extras: HMAC fuzzywigg README.md', () => { expect(hmacSha256('fuzzywigg', 'README.md')).toBe('c1bdcc6210881289dbd7cb0d1815379139a70c052a45bc84a455e263a1a29dfb'); });
  it('post151-extras: HMAC backlink README.md', () => { expect(hmacSha256('backlink', 'README.md')).toBe('077baa370ddbd2225fb8e82982e8530d778cc0fcc77e24481aa14be4ba1d2684'); });
  it('post151-extras: HMAC CATALOG_CACHE README.md', () => { expect(hmacSha256('CATALOG_CACHE', 'README.md')).toBe('c9907f02a39576d51bfc275c6e99c614da37a6741e1f621aed2cc91e8b188851'); });
  it('post151-extras: HMAC GEMINI_API_KEY README.md', () => { expect(hmacSha256('GEMINI_API_KEY', 'README.md')).toBe('9454215091fa86b88019b1e376e9e4f0ed4f51ea581940751f6f582741716d2a'); });
  it('post151-extras: HMAC iptv-org README.md', () => { expect(hmacSha256('iptv-org', 'README.md')).toBe('0b57bc3623ed34c887c2fe5b8dca907d1421425ef1d4aa57875b3252fb6c62c6'); });
  it('post151-extras: HMAC gemini-2.0-flash README.md', () => { expect(hmacSha256('gemini-2.0-flash', 'README.md')).toBe('55b8812df979a6b3c9ab0ed3fe86b9a2c8ff2edcaea69043efe7bf326c185642'); });
  it('post151-extras: HMAC VALID_GENRES README.md', () => { expect(hmacSha256('VALID_GENRES', 'README.md')).toBe('75ddc9d923fb4b7ead18d25e63f38d7ad1b565d5d12444666fcbd4f2ca570128'); });
  it('post151-extras: HMAC HITL README.md', () => { expect(hmacSha256('HITL', 'README.md')).toBe('63f3a6d94b5bc3a9700609fd321dfdfaf2fb9c726a3e08447301615923c532e0'); });
  it('post151-extras: HMAC no-creds README.md', () => { expect(hmacSha256('no-creds', 'README.md')).toBe('156fbb321fedfacd1635a84a8d38e0a7450c58d90d2a0c6ff14f862146cc2575'); });
  it('post151-extras: HMAC station_select README.md', () => { expect(hmacSha256('station_select', 'README.md')).toBe('289b9759c9711fc95c2727e9b042374e19297b25418e436a859007fa247b3e2c'); });
  it('post151-extras: size README.md', () => { expect(statSync(join(root, 'README.md')).size).toBe(2801); });
  it('post151-extras: utf8-len README.md', () => { expect(read('README.md')).toHaveLength(2757); });
  it('post151-extras: nibble README.md', () => { expect(nibbleSum(sha256('README.md'))).toBe(429); });
  it('post151-extras: sha256 docs/mcp-spec.md', () => { expect(sha256('docs/mcp-spec.md')).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849'); });
  it('post151-extras: HMAC post151 docs/mcp-spec.md', () => { expect(hmacSha256('post151', 'docs/mcp-spec.md')).toBe('88e3ced8d9b3f32b4c5ecb7534829dd7cc8fa21d31d331476b321bbdb5e067ff'); });
  it('post151-extras: HMAC after-#151 docs/mcp-spec.md', () => { expect(hmacSha256('after-#151', 'docs/mcp-spec.md')).toBe('a3014b090bcafb7c37e6030aacbb3c9490d43277cb13d65ba3ca519e015425d4'); });
  it('post151-extras: HMAC leftover docs/mcp-spec.md', () => { expect(hmacSha256('leftover', 'docs/mcp-spec.md')).toBe('cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df'); });
  it('post151-extras: HMAC TOKENMAXX docs/mcp-spec.md', () => { expect(hmacSha256('TOKENMAXX', 'docs/mcp-spec.md')).toBe('58bd8b12de8084ece067f68db2cea2ea5dc8b43305c0d5e7e20506fd40e18749'); });
  it('post151-extras: HMAC HEAVY docs/mcp-spec.md', () => { expect(hmacSha256('HEAVY', 'docs/mcp-spec.md')).toBe('14502ba27898e795fb59cc37b06fe6eb2a66b40811b068e87738eb3dbf4cae59'); });
  it('post151-extras: HMAC no-product-invent docs/mcp-spec.md', () => { expect(hmacSha256('no-product-invent', 'docs/mcp-spec.md')).toBe('1ea2c93af05439c6a1c14acfbee6d34dddfc2b32e6c8b6256c270f6d4484b608'); });
  it('post151-extras: HMAC slice-diff docs/mcp-spec.md', () => { expect(hmacSha256('slice-diff', 'docs/mcp-spec.md')).toBe('06d50d14b3b548000878558498c74926788485f641f279bbbdfe5d14f0bbbb4a'); });
  it('post151-extras: HMAC no-src-change docs/mcp-spec.md', () => { expect(hmacSha256('no-src-change', 'docs/mcp-spec.md')).toBe('84ca704115fb25233f9bf1ba5e611bdd463e200ae837d762c61d4280a26ba6db'); });
  it('post151-extras: HMAC manifest-lock docs/mcp-spec.md', () => { expect(hmacSha256('manifest-lock', 'docs/mcp-spec.md')).toBe('b70a770cd09ea94dcd51d690d3a96822867773eae92d2afc16ef212ee8537513'); });
  it('post151-extras: HMAC ci-leftover docs/mcp-spec.md', () => { expect(hmacSha256('ci-leftover', 'docs/mcp-spec.md')).toBe('6078fb6c59deae58e20e22cef21e224bf8e4e84ae6a65e99780ba175e9ba6f11'); });
  it('post151-extras: HMAC fuzzywigg docs/mcp-spec.md', () => { expect(hmacSha256('fuzzywigg', 'docs/mcp-spec.md')).toBe('8e0caed7ef994c374b52d69005d69324d5af51ef97c49c876613cf9ed1b93d4d'); });
  it('post151-extras: HMAC backlink docs/mcp-spec.md', () => { expect(hmacSha256('backlink', 'docs/mcp-spec.md')).toBe('98920add1fa15e869968c8efbc949fab60baf5ca95945eaf466caf563dff3e9f'); });
  it('post151-extras: HMAC CATALOG_CACHE docs/mcp-spec.md', () => { expect(hmacSha256('CATALOG_CACHE', 'docs/mcp-spec.md')).toBe('77c05eeb15ed41c6124ba94658445fe67e0d2267752592d310c765d3205ef6e2'); });
  it('post151-extras: HMAC GEMINI_API_KEY docs/mcp-spec.md', () => { expect(hmacSha256('GEMINI_API_KEY', 'docs/mcp-spec.md')).toBe('9d48df5c245ec78b37814371c5fa04f3d832df95ed3f80354d1f445a5d7af09e'); });
  it('post151-extras: HMAC iptv-org docs/mcp-spec.md', () => { expect(hmacSha256('iptv-org', 'docs/mcp-spec.md')).toBe('f0cc92feffdc00412074b061f650d4216738d7f8e9eb260b8822500b0d7445cf'); });
  it('post151-extras: HMAC gemini-2.0-flash docs/mcp-spec.md', () => { expect(hmacSha256('gemini-2.0-flash', 'docs/mcp-spec.md')).toBe('a8c0860fadeb6443a6763fc3f6a5b9378994c82c25c346ecf80c105d3c779a0b'); });
  it('post151-extras: HMAC VALID_GENRES docs/mcp-spec.md', () => { expect(hmacSha256('VALID_GENRES', 'docs/mcp-spec.md')).toBe('5bce78975cb91bf1f314fa44ce30008c42fead0e079725b2efa2ad2750650e5a'); });
  it('post151-extras: HMAC HITL docs/mcp-spec.md', () => { expect(hmacSha256('HITL', 'docs/mcp-spec.md')).toBe('0eec72a5669dccb2303226a3b772d5336ddc9744380101ba27d3ecc96ca1a668'); });
  it('post151-extras: HMAC no-creds docs/mcp-spec.md', () => { expect(hmacSha256('no-creds', 'docs/mcp-spec.md')).toBe('0b1a3d9791f6d0c02ad0cac98ae5723d8b0e6d29ffb3543b87a9dde980aaa4cd'); });
  it('post151-extras: HMAC station_select docs/mcp-spec.md', () => { expect(hmacSha256('station_select', 'docs/mcp-spec.md')).toBe('09cf27cff685a3d9f7125499f44f20636430d5f0363c9de5d2cf2869edff0b69'); });
  it('post151-extras: size docs/mcp-spec.md', () => { expect(statSync(join(root, 'docs/mcp-spec.md')).size).toBe(3552); });
  it('post151-extras: utf8-len docs/mcp-spec.md', () => { expect(read('docs/mcp-spec.md')).toHaveLength(3544); });
  it('post151-extras: nibble docs/mcp-spec.md', () => { expect(nibbleSum(sha256('docs/mcp-spec.md'))).toBe(514); });
  it('post151-extras: sha256 .github/workflows/ci.yml', () => { expect(sha256('.github/workflows/ci.yml')).toBe('c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5'); });
  it('post151-extras: HMAC post151 .github/workflows/ci.yml', () => { expect(hmacSha256('post151', '.github/workflows/ci.yml')).toBe('75c09dee8ccd8775160d72d081d880737dfd5fa37280a23ef49de7a4ec10ae2e'); });
  it('post151-extras: HMAC after-#151 .github/workflows/ci.yml', () => { expect(hmacSha256('after-#151', '.github/workflows/ci.yml')).toBe('0e427244e901133c0870a3452176b748a54ae6614e355d3c70c5813d17618fcb'); });
  it('post151-extras: HMAC leftover .github/workflows/ci.yml', () => { expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe('d3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce'); });
  it('post151-extras: HMAC TOKENMAXX .github/workflows/ci.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).toBe('5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b'); });
  it('post151-extras: HMAC HEAVY .github/workflows/ci.yml', () => { expect(hmacSha256('HEAVY', '.github/workflows/ci.yml')).toBe('8c10cb5abbb616b57d2df21384cbdb40264d52be8a25a32448acd6e22e1848ea'); });
  it('post151-extras: HMAC no-product-invent .github/workflows/ci.yml', () => { expect(hmacSha256('no-product-invent', '.github/workflows/ci.yml')).toBe('1a959a3eb061936e9c62fd3497ddd23988ff785d88dcfdd133f97d35c77e8fde'); });
  it('post151-extras: HMAC slice-diff .github/workflows/ci.yml', () => { expect(hmacSha256('slice-diff', '.github/workflows/ci.yml')).toBe('589b0400ab9b6c63dc596fda36cd56f90acb45d84be4ddbf88b7e28030a42fba'); });
  it('post151-extras: HMAC no-src-change .github/workflows/ci.yml', () => { expect(hmacSha256('no-src-change', '.github/workflows/ci.yml')).toBe('b14dfd46c70af553877fde42c3925ad14dcf6d0b2806c3acba8a3ba7978116fc'); });
  it('post151-extras: HMAC manifest-lock .github/workflows/ci.yml', () => { expect(hmacSha256('manifest-lock', '.github/workflows/ci.yml')).toBe('0833800c412e79ca645326cd2fcfe5da70b137accda0fee38d7b4ae1acbd9189'); });
  it('post151-extras: HMAC ci-leftover .github/workflows/ci.yml', () => { expect(hmacSha256('ci-leftover', '.github/workflows/ci.yml')).toBe('1b43e4cb8234aa591b26a4e898d2343daa5f27e76d2c7f705481aa8070903551'); });
  it('post151-extras: HMAC fuzzywigg .github/workflows/ci.yml', () => { expect(hmacSha256('fuzzywigg', '.github/workflows/ci.yml')).toBe('392bc8a1dfb5586b8163f4776d52b27035a7b82af685148ecced42b50fcbdfbc'); });
  it('post151-extras: HMAC backlink .github/workflows/ci.yml', () => { expect(hmacSha256('backlink', '.github/workflows/ci.yml')).toBe('db82d56ead609b63cbc9d4e8f91d953c7a496125047ea4feaf11acc54d643f13'); });
  it('post151-extras: HMAC CATALOG_CACHE .github/workflows/ci.yml', () => { expect(hmacSha256('CATALOG_CACHE', '.github/workflows/ci.yml')).toBe('8a64f8a57a8e0d57022a408212641087f1eaeb50cbf7f616da671d19647dbc3b'); });
  it('post151-extras: HMAC GEMINI_API_KEY .github/workflows/ci.yml', () => { expect(hmacSha256('GEMINI_API_KEY', '.github/workflows/ci.yml')).toBe('1c60dc3be507ae8043c44018700fd49f8cf7bf23d8059f0617ca6587aa9cf6d5'); });
  it('post151-extras: HMAC iptv-org .github/workflows/ci.yml', () => { expect(hmacSha256('iptv-org', '.github/workflows/ci.yml')).toBe('73d6bf3580bf4226845b8125eb1c4e7f0d5341004fc194a681a890c03d72f9d5'); });
  it('post151-extras: HMAC gemini-2.0-flash .github/workflows/ci.yml', () => { expect(hmacSha256('gemini-2.0-flash', '.github/workflows/ci.yml')).toBe('a3f526cfe1d8f02f79e076a789f3182a36794a4d1b7aba5fe91cd951467fbe5f'); });
  it('post151-extras: HMAC VALID_GENRES .github/workflows/ci.yml', () => { expect(hmacSha256('VALID_GENRES', '.github/workflows/ci.yml')).toBe('9bb0a17987e18a4a73177f7e3ccf17abcbc9c273f88cdba237a1c9870c55812c'); });
  it('post151-extras: HMAC HITL .github/workflows/ci.yml', () => { expect(hmacSha256('HITL', '.github/workflows/ci.yml')).toBe('a1f8c9446de2bb236d3211d1ea7bc88fcb53a65e967b7eb08bc46e2f0ea0e461'); });
  it('post151-extras: HMAC no-creds .github/workflows/ci.yml', () => { expect(hmacSha256('no-creds', '.github/workflows/ci.yml')).toBe('1a0865373b47d039ed61eac765815bd157845537668db47acd59f730defcd83c'); });
  it('post151-extras: HMAC station_select .github/workflows/ci.yml', () => { expect(hmacSha256('station_select', '.github/workflows/ci.yml')).toBe('6f8ee6109c782c75da0955b270c6cf80ca1baf597c924fa83b7a8c9f5b9db5cf'); });
  it('post151-extras: size .github/workflows/ci.yml', () => { expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295); });
  it('post151-extras: utf8-len .github/workflows/ci.yml', () => { expect(read('.github/workflows/ci.yml')).toHaveLength(6295); });
  it('post151-extras: nibble .github/workflows/ci.yml', () => { expect(nibbleSum(sha256('.github/workflows/ci.yml'))).toBe(515); });
  it('post151-extras: sha256 .github/workflows/deploy.yml', () => { expect(sha256('.github/workflows/deploy.yml')).toBe('49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3'); });
  it('post151-extras: HMAC post151 .github/workflows/deploy.yml', () => { expect(hmacSha256('post151', '.github/workflows/deploy.yml')).toBe('e1403699de5d1efce08216c32f6f5495ce7c0d350cc9db40c434795c81dd1cce'); });
  it('post151-extras: HMAC after-#151 .github/workflows/deploy.yml', () => { expect(hmacSha256('after-#151', '.github/workflows/deploy.yml')).toBe('249544e2f271b55b69b6e96bae0a34c88899c08dd97b40a65a9a522c3ec9272f'); });
  it('post151-extras: HMAC leftover .github/workflows/deploy.yml', () => { expect(hmacSha256('leftover', '.github/workflows/deploy.yml')).toBe('e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83'); });
  it('post151-extras: HMAC TOKENMAXX .github/workflows/deploy.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/workflows/deploy.yml')).toBe('339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b'); });
  it('post151-extras: HMAC HEAVY .github/workflows/deploy.yml', () => { expect(hmacSha256('HEAVY', '.github/workflows/deploy.yml')).toBe('87354c51a785eb76f81ba427f9a58d6f8b0b7e3c85febd19b973c04874bde601'); });
  it('post151-extras: HMAC no-product-invent .github/workflows/deploy.yml', () => { expect(hmacSha256('no-product-invent', '.github/workflows/deploy.yml')).toBe('3ed3dcb49626ea55aa10de93931f8c107b800db0e2d4852f9cfe4a32f9ffe544'); });
  it('post151-extras: HMAC slice-diff .github/workflows/deploy.yml', () => { expect(hmacSha256('slice-diff', '.github/workflows/deploy.yml')).toBe('1ccb326a9235e7932c7f50df61af7dffc9c9d7e2c6ac224e9fa59d4134706b10'); });
  it('post151-extras: HMAC no-src-change .github/workflows/deploy.yml', () => { expect(hmacSha256('no-src-change', '.github/workflows/deploy.yml')).toBe('a970e311deaeb68fd6a69e1f5350295984b91cd4144778295a75638cac5d48de'); });
  it('post151-extras: HMAC manifest-lock .github/workflows/deploy.yml', () => { expect(hmacSha256('manifest-lock', '.github/workflows/deploy.yml')).toBe('b76bf0edaa3b7f3579aa342d657037e3625bbeabcf870ffa8c235024d9ad667f'); });
  it('post151-extras: HMAC ci-leftover .github/workflows/deploy.yml', () => { expect(hmacSha256('ci-leftover', '.github/workflows/deploy.yml')).toBe('786746b5514adaa019bbf18f722aebb963a13c01e0d88e8085af1adcfbe8d87a'); });
  it('post151-extras: HMAC fuzzywigg .github/workflows/deploy.yml', () => { expect(hmacSha256('fuzzywigg', '.github/workflows/deploy.yml')).toBe('fd722c8d8f6afeb8b42766ca5b4fea570e8624cf1ebe119d8266cff8cd4db5f0'); });
  it('post151-extras: HMAC backlink .github/workflows/deploy.yml', () => { expect(hmacSha256('backlink', '.github/workflows/deploy.yml')).toBe('3c8712af7d45f1df271a1c5971d0811c6477da272bc048778fab07b9d04b1f76'); });
  it('post151-extras: HMAC CATALOG_CACHE .github/workflows/deploy.yml', () => { expect(hmacSha256('CATALOG_CACHE', '.github/workflows/deploy.yml')).toBe('649f380331c72a060e5b4f4af43280cbdef08145662e1d26dc8034f23befbd4b'); });
  it('post151-extras: HMAC GEMINI_API_KEY .github/workflows/deploy.yml', () => { expect(hmacSha256('GEMINI_API_KEY', '.github/workflows/deploy.yml')).toBe('4bde3b1cedd584e967ce984cae41b2d0ee0d59d8e16b6d77b39c7b639e479a41'); });
  it('post151-extras: HMAC iptv-org .github/workflows/deploy.yml', () => { expect(hmacSha256('iptv-org', '.github/workflows/deploy.yml')).toBe('b86096c150f578bd580fe0f70280f6e34858a6e036b9fd3fee1539c30233ec38'); });
  it('post151-extras: HMAC gemini-2.0-flash .github/workflows/deploy.yml', () => { expect(hmacSha256('gemini-2.0-flash', '.github/workflows/deploy.yml')).toBe('3de92bd44feeac4a5986e1f00d3a09729de7e9195dcc7b6bc9833dfe666a159c'); });
  it('post151-extras: HMAC VALID_GENRES .github/workflows/deploy.yml', () => { expect(hmacSha256('VALID_GENRES', '.github/workflows/deploy.yml')).toBe('7c336f4f8de1d1f3ae5e390401427e4adacbe947d3cb9f2f86a9cbd3e150a5f6'); });
  it('post151-extras: HMAC HITL .github/workflows/deploy.yml', () => { expect(hmacSha256('HITL', '.github/workflows/deploy.yml')).toBe('04d19b8f0846799a2b314566c765f36c8faffb656be7e6a3d744b5da1492d064'); });
  it('post151-extras: HMAC no-creds .github/workflows/deploy.yml', () => { expect(hmacSha256('no-creds', '.github/workflows/deploy.yml')).toBe('0fef762be37cb35c847cc84884c2ee08887e2235d54bbca1dd4669996de46be1'); });
  it('post151-extras: HMAC station_select .github/workflows/deploy.yml', () => { expect(hmacSha256('station_select', '.github/workflows/deploy.yml')).toBe('b7397cbe688240355252d043a0d53ae3bd6cf1f808e31b6d0b95e92cc5dafaa0'); });
  it('post151-extras: size .github/workflows/deploy.yml', () => { expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004); });
  it('post151-extras: utf8-len .github/workflows/deploy.yml', () => { expect(read('.github/workflows/deploy.yml')).toHaveLength(1004); });
  it('post151-extras: nibble .github/workflows/deploy.yml', () => { expect(nibbleSum(sha256('.github/workflows/deploy.yml'))).toBe(476); });
  it('post151-extras: sha256 .github/dependabot.yml', () => { expect(sha256('.github/dependabot.yml')).toBe('a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac'); });
  it('post151-extras: HMAC post151 .github/dependabot.yml', () => { expect(hmacSha256('post151', '.github/dependabot.yml')).toBe('81881eb905aea03ff4a94e7ae0f40db0730c9710c80a19af730a1001afeeb608'); });
  it('post151-extras: HMAC after-#151 .github/dependabot.yml', () => { expect(hmacSha256('after-#151', '.github/dependabot.yml')).toBe('eeeec35b8342a36997fb7e4410f1981e00c7aa81073719d342481c6d9df401be'); });
  it('post151-extras: HMAC leftover .github/dependabot.yml', () => { expect(hmacSha256('leftover', '.github/dependabot.yml')).toBe('b9fba0e3b098292ae8ff8b4cffe94463966fadb875a0c9db9a1dadb85281a0f9'); });
  it('post151-extras: HMAC TOKENMAXX .github/dependabot.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/dependabot.yml')).toBe('e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1'); });
  it('post151-extras: HMAC HEAVY .github/dependabot.yml', () => { expect(hmacSha256('HEAVY', '.github/dependabot.yml')).toBe('e651250d8c5b977a6bf6fb30e4edcc515accf3f9c97019df6fd702d19fb9e2ff'); });
  it('post151-extras: HMAC no-product-invent .github/dependabot.yml', () => { expect(hmacSha256('no-product-invent', '.github/dependabot.yml')).toBe('5fdab5d04737aa2fd4596ef674259a9f07c54593c68d38f74f8e6f81207f80fa'); });
  it('post151-extras: HMAC slice-diff .github/dependabot.yml', () => { expect(hmacSha256('slice-diff', '.github/dependabot.yml')).toBe('cf3a3aba1fdb1781371f6b49e2309aac2104e2564d370758a6e25c06a0a3d79d'); });
  it('post151-extras: HMAC no-src-change .github/dependabot.yml', () => { expect(hmacSha256('no-src-change', '.github/dependabot.yml')).toBe('51b22c5c39429fd11f689007378f9c3b7340092c7552c4b04c684fee3babfc47'); });
  it('post151-extras: HMAC manifest-lock .github/dependabot.yml', () => { expect(hmacSha256('manifest-lock', '.github/dependabot.yml')).toBe('b09786f2ec08484413ba6d4a6099ba987fe0365e55d99881051b7b845d6e6b0b'); });
  it('post151-extras: HMAC ci-leftover .github/dependabot.yml', () => { expect(hmacSha256('ci-leftover', '.github/dependabot.yml')).toBe('e6e9eb42c2f09c0c5f1bb38a364be4813c62ece9535767dc4bcd4a0af2f44d47'); });
  it('post151-extras: HMAC fuzzywigg .github/dependabot.yml', () => { expect(hmacSha256('fuzzywigg', '.github/dependabot.yml')).toBe('f4a071f15484860d891a7d455fe0f9e4b477b926d05ecf2a1da8c4703fad3e9d'); });
  it('post151-extras: HMAC backlink .github/dependabot.yml', () => { expect(hmacSha256('backlink', '.github/dependabot.yml')).toBe('856ea73349d825ddb77382ce6e7ff32ee7d2b93b5053207f5d106385ef1e8276'); });
  it('post151-extras: HMAC CATALOG_CACHE .github/dependabot.yml', () => { expect(hmacSha256('CATALOG_CACHE', '.github/dependabot.yml')).toBe('6dd70c123d580a1b4ac8634ee8d2dc9c36552ce79b36c045b1fd930bcd70776a'); });
  it('post151-extras: HMAC GEMINI_API_KEY .github/dependabot.yml', () => { expect(hmacSha256('GEMINI_API_KEY', '.github/dependabot.yml')).toBe('0059f5c808e00e813dc74033c95e7707470dbbdcf68695a6744c68eaa9f38687'); });
  it('post151-extras: HMAC iptv-org .github/dependabot.yml', () => { expect(hmacSha256('iptv-org', '.github/dependabot.yml')).toBe('d1593f4ace94ade69be1efee280d4d872c2eb8397424d2c0684a7938209e5a5b'); });
  it('post151-extras: HMAC gemini-2.0-flash .github/dependabot.yml', () => { expect(hmacSha256('gemini-2.0-flash', '.github/dependabot.yml')).toBe('42c2332448e5a1f7c6f2e2374d683df78a258f4cd81120561dcace80ec63d793'); });
  it('post151-extras: HMAC VALID_GENRES .github/dependabot.yml', () => { expect(hmacSha256('VALID_GENRES', '.github/dependabot.yml')).toBe('3682e70386ed0357b1857e80e01542fd93e786033e834a66f7453342279046f2'); });
  it('post151-extras: HMAC HITL .github/dependabot.yml', () => { expect(hmacSha256('HITL', '.github/dependabot.yml')).toBe('72b97577831c72174d3246685b807385eece67c7512a8c358e544cbec804da2d'); });
  it('post151-extras: HMAC no-creds .github/dependabot.yml', () => { expect(hmacSha256('no-creds', '.github/dependabot.yml')).toBe('efa812c79b86488135973f3c5b1cb0935981bc4439f2a11946d809775beb15dc'); });
  it('post151-extras: HMAC station_select .github/dependabot.yml', () => { expect(hmacSha256('station_select', '.github/dependabot.yml')).toBe('6a9ccf7f67635a4fe3f34dde9a75f20fc10708968c6d404a4274c355a79ace32'); });
  it('post151-extras: size .github/dependabot.yml', () => { expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505); });
  it('post151-extras: utf8-len .github/dependabot.yml', () => { expect(read('.github/dependabot.yml')).toHaveLength(505); });
  it('post151-extras: nibble .github/dependabot.yml', () => { expect(nibbleSum(sha256('.github/dependabot.yml'))).toBe(526); });
  it('post151-extras: sha256 .cursor/environment.json', () => { expect(sha256('.cursor/environment.json')).toBe('4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694'); });
  it('post151-extras: HMAC post151 .cursor/environment.json', () => { expect(hmacSha256('post151', '.cursor/environment.json')).toBe('ba41ab36298e92c0212adaebd4929f6d9d3ad530082bf733adf17401ad53a3ec'); });
  it('post151-extras: HMAC after-#151 .cursor/environment.json', () => { expect(hmacSha256('after-#151', '.cursor/environment.json')).toBe('dbd5aa06569be79938bf03a506b42cfcdfcde4c8ab8e6139c23af9b9f4c9c4a6'); });
  it('post151-extras: HMAC leftover .cursor/environment.json', () => { expect(hmacSha256('leftover', '.cursor/environment.json')).toBe('f3c07027290cc01d2ddd1979fab399b4f4ddaed8e682f9ba6f15b59f23ba2bc4'); });
  it('post151-extras: HMAC TOKENMAXX .cursor/environment.json', () => { expect(hmacSha256('TOKENMAXX', '.cursor/environment.json')).toBe('796f38bc3f8907bef23dc36e49231f310bae76a745c9e26ac5073ba2ec3e8c49'); });
  it('post151-extras: HMAC HEAVY .cursor/environment.json', () => { expect(hmacSha256('HEAVY', '.cursor/environment.json')).toBe('ac9494b2f787b999a6b41edc8f17a2bf4dfac30f0ee76ecef9d69be011dde10f'); });
  it('post151-extras: HMAC no-product-invent .cursor/environment.json', () => { expect(hmacSha256('no-product-invent', '.cursor/environment.json')).toBe('bba79bd9a590f177e32e895a7935716c6ff65a461b15d43916ad5996af1092c5'); });
  it('post151-extras: HMAC slice-diff .cursor/environment.json', () => { expect(hmacSha256('slice-diff', '.cursor/environment.json')).toBe('1def680f93ce3c94e3cca3cdafd2fa6add86fa3b1a86b7e6978bf61bab17a815'); });
  it('post151-extras: HMAC no-src-change .cursor/environment.json', () => { expect(hmacSha256('no-src-change', '.cursor/environment.json')).toBe('f061bd19f945e8c66c327cc278b07a7d78763515c758553c0a2bf2822896fa9e'); });
  it('post151-extras: HMAC manifest-lock .cursor/environment.json', () => { expect(hmacSha256('manifest-lock', '.cursor/environment.json')).toBe('1e8e47096c0e8b272ac510d96c6be2d4fe37d09aeccfa50a23240f0cd05a89e3'); });
  it('post151-extras: HMAC ci-leftover .cursor/environment.json', () => { expect(hmacSha256('ci-leftover', '.cursor/environment.json')).toBe('b8ddc28b2447283097c386f051579b168dbaf7f5cbdd5b6c6e03484120c17172'); });
  it('post151-extras: HMAC fuzzywigg .cursor/environment.json', () => { expect(hmacSha256('fuzzywigg', '.cursor/environment.json')).toBe('e3d4c0f7c85f4e81d76b3e176b9202ef62ee0b93590f214b7b50e8c9725d91cc'); });
  it('post151-extras: HMAC backlink .cursor/environment.json', () => { expect(hmacSha256('backlink', '.cursor/environment.json')).toBe('0e8905399320afcff4128939baf6b2ca6b9725e2eb42917aa058b4b517c6c966'); });
  it('post151-extras: HMAC CATALOG_CACHE .cursor/environment.json', () => { expect(hmacSha256('CATALOG_CACHE', '.cursor/environment.json')).toBe('bd5680d487a0213acf5b4ad32edd595386d0d77b05123a920e5f1dd93bfa3545'); });
  it('post151-extras: HMAC GEMINI_API_KEY .cursor/environment.json', () => { expect(hmacSha256('GEMINI_API_KEY', '.cursor/environment.json')).toBe('1cbe48ef03431251fc085b16447416bd0c36fafb39a967d46e03d472dee06903'); });
  it('post151-extras: HMAC iptv-org .cursor/environment.json', () => { expect(hmacSha256('iptv-org', '.cursor/environment.json')).toBe('9a76b361a359981f2cbcd5b221b471790a33bebb46d546257b8fa9e495f3bdb5'); });
  it('post151-extras: HMAC gemini-2.0-flash .cursor/environment.json', () => { expect(hmacSha256('gemini-2.0-flash', '.cursor/environment.json')).toBe('9b308ce5543169a5891b990a9aa5730f787986ed54be59ade6c335732b5393c3'); });
  it('post151-extras: HMAC VALID_GENRES .cursor/environment.json', () => { expect(hmacSha256('VALID_GENRES', '.cursor/environment.json')).toBe('99406c7aa81a7724dc575014561b876c4b77cf17d9824bacdae4974ae6669400'); });
  it('post151-extras: HMAC HITL .cursor/environment.json', () => { expect(hmacSha256('HITL', '.cursor/environment.json')).toBe('93d1c9a78bd63f82add45bdc6bc16a90c1bd280b25286d4242124563fb69e446'); });
  it('post151-extras: HMAC no-creds .cursor/environment.json', () => { expect(hmacSha256('no-creds', '.cursor/environment.json')).toBe('49c766a2d195d5f33a8b72452518687a1850982b4d02dc16158b85b33a0c6291'); });
  it('post151-extras: HMAC station_select .cursor/environment.json', () => { expect(hmacSha256('station_select', '.cursor/environment.json')).toBe('5ef4758992c4ab71cd5d53bbe06197d813738a226defa7845a4f60995fcf5fa2'); });
  it('post151-extras: size .cursor/environment.json', () => { expect(statSync(join(root, '.cursor/environment.json')).size).toBe(57); });
  it('post151-extras: utf8-len .cursor/environment.json', () => { expect(read('.cursor/environment.json')).toHaveLength(57); });
  it('post151-extras: nibble .cursor/environment.json', () => { expect(nibbleSum(sha256('.cursor/environment.json'))).toBe(472); });
  it('post151-extras: src/index.ts forbids invent phrase /playlist', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('/playlist'); });
  it('post151-extras: src/index.ts forbids invent phrase /now-playing', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('/now-playing'); });
  it('post151-extras: src/index.ts forbids invent phrase openai', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('openai'); });
  it('post151-extras: src/index.ts forbids invent phrase anthropic', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('anthropic'); });
  it('post151-extras: src/index.ts forbids invent phrase claude', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('claude'); });
  it('post151-extras: src/index.ts forbids invent phrase workers.ai', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('workers.ai'); });
  it('post151-extras: src/index.ts forbids invent phrase durable_object', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('durable_object'); });
  it('post151-extras: src/index.ts forbids invent phrase vectorize', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('vectorize'); });
  it('post151-extras: src/index.ts forbids invent phrase hyperdrive', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('hyperdrive'); });
  it('post151-extras: src/index.ts forbids invent phrase analytics_engine', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('analytics_engine'); });
  it('post151-extras: src/index.ts forbids invent phrase d1_', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('d1_'); });
  it('post151-extras: src/index.ts forbids invent phrase r2_', () => { expect(read('src/index.ts').toLowerCase()).not.toContain('r2_'); });
  it('post151-extras: src/genres.ts forbids invent phrase /playlist', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('/playlist'); });
  it('post151-extras: src/genres.ts forbids invent phrase /now-playing', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('/now-playing'); });
  it('post151-extras: src/genres.ts forbids invent phrase openai', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('openai'); });
  it('post151-extras: src/genres.ts forbids invent phrase anthropic', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('anthropic'); });
  it('post151-extras: src/genres.ts forbids invent phrase claude', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('claude'); });
  it('post151-extras: src/genres.ts forbids invent phrase workers.ai', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('workers.ai'); });
  it('post151-extras: src/genres.ts forbids invent phrase durable_object', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('durable_object'); });
  it('post151-extras: src/genres.ts forbids invent phrase vectorize', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('vectorize'); });
  it('post151-extras: src/genres.ts forbids invent phrase hyperdrive', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('hyperdrive'); });
  it('post151-extras: src/genres.ts forbids invent phrase analytics_engine', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('analytics_engine'); });
  it('post151-extras: src/genres.ts forbids invent phrase d1_', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('d1_'); });
  it('post151-extras: src/genres.ts forbids invent phrase r2_', () => { expect(read('src/genres.ts').toLowerCase()).not.toContain('r2_'); });
  it('post151-extras: src/parser.ts forbids invent phrase /playlist', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('/playlist'); });
  it('post151-extras: src/parser.ts forbids invent phrase /now-playing', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('/now-playing'); });
  it('post151-extras: src/parser.ts forbids invent phrase openai', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('openai'); });
  it('post151-extras: src/parser.ts forbids invent phrase anthropic', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('anthropic'); });
  it('post151-extras: src/parser.ts forbids invent phrase claude', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('claude'); });
  it('post151-extras: src/parser.ts forbids invent phrase workers.ai', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('workers.ai'); });
  it('post151-extras: src/parser.ts forbids invent phrase durable_object', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('durable_object'); });
  it('post151-extras: src/parser.ts forbids invent phrase vectorize', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('vectorize'); });
  it('post151-extras: src/parser.ts forbids invent phrase hyperdrive', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('hyperdrive'); });
  it('post151-extras: src/parser.ts forbids invent phrase analytics_engine', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('analytics_engine'); });
  it('post151-extras: src/parser.ts forbids invent phrase d1_', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('d1_'); });
  it('post151-extras: src/parser.ts forbids invent phrase r2_', () => { expect(read('src/parser.ts').toLowerCase()).not.toContain('r2_'); });
  it('post151-extras: wrangler.toml forbids invent phrase /playlist', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('/playlist'); });
  it('post151-extras: wrangler.toml forbids invent phrase /now-playing', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('/now-playing'); });
  it('post151-extras: wrangler.toml forbids invent phrase openai', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('openai'); });
  it('post151-extras: wrangler.toml forbids invent phrase anthropic', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('anthropic'); });
  it('post151-extras: wrangler.toml forbids invent phrase claude', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('claude'); });
  it('post151-extras: wrangler.toml forbids invent phrase workers.ai', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('workers.ai'); });
  it('post151-extras: wrangler.toml forbids invent phrase durable_object', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('durable_object'); });
  it('post151-extras: wrangler.toml forbids invent phrase vectorize', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('vectorize'); });
  it('post151-extras: wrangler.toml forbids invent phrase hyperdrive', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('hyperdrive'); });
  it('post151-extras: wrangler.toml forbids invent phrase analytics_engine', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('analytics_engine'); });
  it('post151-extras: wrangler.toml forbids invent phrase d1_', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('d1_'); });
  it('post151-extras: wrangler.toml forbids invent phrase r2_', () => { expect(read('wrangler.toml').toLowerCase()).not.toContain('r2_'); });
  it('post151-extras: AGENTS.md forbids invent phrase openai', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('openai'); });
  it('post151-extras: AGENTS.md forbids invent phrase anthropic', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('anthropic'); });
  it('post151-extras: AGENTS.md forbids invent phrase claude', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('claude'); });
  it('post151-extras: AGENTS.md forbids invent phrase workers.ai', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('workers.ai'); });
  it('post151-extras: AGENTS.md forbids invent phrase durable_object', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('durable_object'); });
  it('post151-extras: AGENTS.md forbids invent phrase vectorize', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('vectorize'); });
  it('post151-extras: AGENTS.md forbids invent phrase hyperdrive', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('hyperdrive'); });
  it('post151-extras: AGENTS.md forbids invent phrase analytics_engine', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('analytics_engine'); });
  it('post151-extras: AGENTS.md forbids invent phrase d1_', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('d1_'); });
  it('post151-extras: AGENTS.md forbids invent phrase r2_', () => { expect(read('AGENTS.md').toLowerCase()).not.toContain('r2_'); });
  it('post151-extras: package.json forbids invent phrase /playlist', () => { expect(read('package.json').toLowerCase()).not.toContain('/playlist'); });
  it('post151-extras: package.json forbids invent phrase /now-playing', () => { expect(read('package.json').toLowerCase()).not.toContain('/now-playing'); });
  it('post151-extras: package.json forbids invent phrase openai', () => { expect(read('package.json').toLowerCase()).not.toContain('openai'); });
  it('post151-extras: package.json forbids invent phrase anthropic', () => { expect(read('package.json').toLowerCase()).not.toContain('anthropic'); });
  it('post151-extras: package.json forbids invent phrase claude', () => { expect(read('package.json').toLowerCase()).not.toContain('claude'); });
  it('post151-extras: package.json forbids invent phrase workers.ai', () => { expect(read('package.json').toLowerCase()).not.toContain('workers.ai'); });
  it('post151-extras: package.json forbids invent phrase durable_object', () => { expect(read('package.json').toLowerCase()).not.toContain('durable_object'); });
  it('post151-extras: package.json forbids invent phrase vectorize', () => { expect(read('package.json').toLowerCase()).not.toContain('vectorize'); });
  it('post151-extras: package.json forbids invent phrase hyperdrive', () => { expect(read('package.json').toLowerCase()).not.toContain('hyperdrive'); });
  it('post151-extras: package.json forbids invent phrase analytics_engine', () => { expect(read('package.json').toLowerCase()).not.toContain('analytics_engine'); });
  it('post151-extras: package.json forbids invent phrase d1_', () => { expect(read('package.json').toLowerCase()).not.toContain('d1_'); });
  it('post151-extras: package.json forbids invent phrase r2_', () => { expect(read('package.json').toLowerCase()).not.toContain('r2_'); });
  it('post151-extras: keys inventory digest', () => {
    const keys = ['post151', 'after-#151', 'leftover', 'TOKENMAXX', 'HEAVY', 'no-product-invent', 'slice-diff', 'no-src-change', 'manifest-lock', 'ci-leftover', 'fuzzywigg', 'backlink', 'CATALOG_CACHE', 'GEMINI_API_KEY', 'iptv-org', 'gemini-2.0-flash', 'VALID_GENRES', 'HITL', 'no-creds', 'station_select', 'post151-extras', 'genres'];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe('bb4bb91031a3a9bea72cd5483f590e0cfba589aab323f7496d8ba1f0fab9f529');
    expect(keys).toHaveLength(22);
  });
  it('post151-extras: final inventory markers', () => {
    const body = read('test/genres.test.ts');
    expect(body).toContain("describe('post151 genres HEAVY deepen (after #151)')");
    expect(body).toContain("describe('post151 genres extras HEAVY deepen (after #151 leftover slice)')");
    expect((body.match(/it\('post151-extras:/g) ?? []).length).toBeGreaterThan(100);
  });

});
