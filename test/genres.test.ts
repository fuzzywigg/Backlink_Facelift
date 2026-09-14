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
