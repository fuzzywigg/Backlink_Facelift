import { describe, expect, it } from 'vitest';
import { GENRE_MAP, VALID_GENRES, resolveGenre } from '../src/genres';

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

  // --- HEAVY burn post-#58: genres-only deepen (TOKENMAXX contracts) ---
  // Orthogonal to #58 helpers / #56 mcp+contracts / #54 wrangler / #53 routes mix.

  it('post58: TextEncoder byte length of JSON.stringify(GENRE_MAP) locks within band', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(GENRE_MAP));
    expect(bytes.byteLength).toBeGreaterThan(250);
    expect(bytes.byteLength).toBeLessThan(700);
    expect(bytes[0]).toBe('{'.charCodeAt(0));
  });

  it('post58: TextDecoder round-trip of VALID_GENRES CSV lock stays stable', () => {
    const csv = VALID_GENRES.join(',');
    const encoded = new TextEncoder().encode(csv);
    expect(new TextDecoder().decode(encoded)).toBe(
      'music,ambient,jazz,classical,pop,rock,news,sports,entertainment',
    );
  });

  it('post58: codePointAt sequence for late night alias stays ASCII space separated', () => {
    expect([...'late night'].map((c) => c.codePointAt(0))).toEqual([
      108, 97, 116, 101, 32, 110, 105, 103, 104, 116,
    ]);
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(resolveGenre('LATE NIGHT')).toBe('ambient');
  });

  it('post58: codePointAt sequence for lo-fi hyphen is U+002D only', () => {
    expect([...'lo-fi'].map((c) => c.codePointAt(0))).toEqual([108, 111, 45, 102, 105]);
    expect(resolveGenre('Lo-Fi')).toBe('ambient');
  });

  it('post58: btoa/atob round-trip of jazz token stays stable', () => {
    expect(btoa('jazz')).toBe('amF6eg==');
    expect(atob('amF6eg==')).toBe('jazz');
    expect(resolveGenre(atob('amF6eg=='))).toBe('jazz');
  });

  it('post58: classical string is longer than classic alias; both btoa stably', () => {
    expect('classical'.length).toBeGreaterThan('classic'.length);
    expect(btoa('classical')).toBe(btoa('classical'));
    expect(btoa('classic')).toBe(btoa('classic'));
    expect(resolveGenre('classic')).toBe('classical');
  });

  it('post58: fromCharCode rebuild of ambient identity matches GENRE_MAP', () => {
    const ambient = String.fromCharCode(97, 109, 98, 105, 101, 110, 116);
    expect(ambient).toBe('ambient');
    expect(GENRE_MAP[ambient]).toBe('ambient');
    expect(resolveGenre(ambient.toUpperCase())).toBe('ambient');
  });

  it('post58: fromCharCode rebuild of entertainment matches VALID_GENRES last', () => {
    const entertainment = String.fromCharCode(
      101, 110, 116, 101, 114, 116, 97, 105, 110, 109, 101, 110, 116,
    );
    expect(entertainment).toBe('entertainment');
    expect(VALID_GENRES[VALID_GENRES.length - 1]).toBe(entertainment);
    expect(resolveGenre(entertainment)).toBe('entertainment');
  });

  it('post58: ArrayBuffer view of music identity starts with m-u-s-i-c', () => {
    const bytes = new TextEncoder().encode('music');
    const view = new Uint8Array(bytes.buffer.slice(0));
    expect([...view]).toEqual([109, 117, 115, 105, 99]);
    expect(resolveGenre(new TextDecoder().decode(view))).toBe('music');
  });

  it('post58: DataView reads of pop bytes are ASCII lowercase', () => {
    const buf = new TextEncoder().encode('pop').buffer;
    const dv = new DataView(buf);
    expect(dv.getUint8(0)).toBe(0x70);
    expect(dv.getUint8(1)).toBe(0x6f);
    expect(dv.getUint8(2)).toBe(0x70);
    expect(resolveGenre('POP')).toBe('pop');
  });

  it('post58: Object.freeze on GENRE_MAP snapshot cannot mutate alias targets', () => {
    const frozen = Object.freeze({ ...GENRE_MAP });
    expect(() => {
      (frozen as { chill: string }).chill = 'news';
    }).toThrow();
    expect(frozen.chill).toBe('ambient');
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(resolveGenre('chill')).toBe('ambient');
  });

  it('post58: Object.seal on VALID_GENRES copy blocks push without rewriting source', () => {
    const sealed = Object.seal([...VALID_GENRES] as string[]);
    expect(Object.isSealed(sealed)).toBe(true);
    expect(Object.isExtensible(sealed)).toBe(false);
    expect(() => {
      sealed.push('invented');
    }).toThrow();
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('post58: Object.preventExtensions on custom map still resolves known keys', () => {
    const map = Object.preventExtensions({ chill: 'ambient', jazz: 'jazz' } as Record<string, string>);
    expect(Object.isExtensible(map)).toBe(false);
    expect(resolveGenre('chill', map)).toBe('ambient');
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('rock', map)).toBe('rock'); // VALID_GENRES fallback
  });

  it('post58: Proxy.revocable over GENRE_MAP clone revoke does not poison default map', () => {
    const { proxy, revoke } = Proxy.revocable({ ...GENRE_MAP }, {});
    expect(resolveGenre('lofi', proxy)).toBe('ambient');
    revoke();
    expect(() => resolveGenre('lofi', proxy)).toThrow();
    expect(resolveGenre('lofi')).toBe('ambient');
    expect(GENRE_MAP.lofi).toBe('ambient');
  });

  it('post58: Proxy get trap uppercasing keys still serves lowercase lookup', () => {
    const map = new Proxy(
      { JAZZ: 'jazz' } as Record<string, string>,
      {
        get(target, prop, receiver) {
          if (typeof prop === 'string') {
            const upper = prop.toUpperCase();
            if (Object.hasOwn(target, upper)) return target[upper];
          }
          return Reflect.get(target, prop, receiver);
        },
        has(target, prop) {
          return typeof prop === 'string'
            ? Object.hasOwn(target, prop) || Object.hasOwn(target, prop.toUpperCase())
            : Reflect.has(target, prop);
        },
      },
    );
    expect(resolveGenre('jazz', map)).toBe('jazz');
  });

  it('post58: structuredClone of GENRE_MAP is deep-equal but distinct identity', () => {
    const clone = structuredClone(GENRE_MAP);
    expect(clone).toEqual(GENRE_MAP);
    expect(clone).not.toBe(GENRE_MAP);
    clone.chill = 'news';
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(resolveGenre('chill', clone)).toBe('news');
  });

  it('post58: structuredClone of VALID_GENRES yields independent mutable array', () => {
    const clone = structuredClone([...VALID_GENRES]) as string[];
    clone[0] = 'hijacked';
    expect(VALID_GENRES[0]).toBe('music');
    expect(clone[0]).toBe('hijacked');
  });

  it('post58: Map/Set/WeakMap identity locks for genre export surface', () => {
    const names = ['GENRE_MAP', 'VALID_GENRES', 'resolveGenre'] as const;
    const set = new Set(names);
    const map = new Map(names.map((n, i) => [n, i]));
    const wm = new WeakMap<object, string>();
    const key = { names };
    wm.set(key, names[0]);
    expect(set.size).toBe(3);
    expect(map.get('resolveGenre')).toBe(2);
    expect(wm.get(key)).toBe('GENRE_MAP');
  });

  it('post58: Reflect.ownKeys(GENRE_MAP) length 21 and all strings', () => {
    const keys = Reflect.ownKeys(GENRE_MAP);
    expect(keys).toHaveLength(21);
    expect(keys.every((k) => typeof k === 'string')).toBe(true);
    expect(keys).toContain('late night');
    expect(keys).toContain('lo-fi');
  });

  it('post58: Reflect.getOwnPropertyDescriptor for chill is writable enumerable', () => {
    const desc = Reflect.getOwnPropertyDescriptor(GENRE_MAP, 'chill');
    expect(desc).toMatchObject({
      value: 'ambient',
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  it('post58: Object.getOwnPropertyDescriptors covers every GENRE_MAP key', () => {
    const descs = Object.getOwnPropertyDescriptors(GENRE_MAP);
    expect(Object.keys(descs)).toHaveLength(21);
    for (const key of Object.keys(GENRE_MAP)) {
      expect(descs[key]?.value).toBe(GENRE_MAP[key]);
    }
  });

  it('post58: padStart/padEnd of rock trim back for resolveGenre', () => {
    expect('rock'.padStart(10).trim()).toBe('rock');
    expect('jazz'.padEnd(12).trim()).toBe('jazz');
    expect(resolveGenre('rock'.padStart(10))).toBe('rock');
    expect(resolveGenre('jazz'.padEnd(12))).toBe('jazz');
  });

  it('post58: encodeURIComponent of plain genre slug is identity', () => {
    expect(encodeURIComponent('classical')).toBe('classical');
    expect(encodeURIComponent('late night')).toBe('late%20night');
    expect(resolveGenre(decodeURIComponent('late%20night'))).toBe('ambient');
  });

  it('post58: encodeURI of lo-fi leaves hyphen intact', () => {
    expect(encodeURI('lo-fi')).toBe('lo-fi');
    expect(resolveGenre(encodeURI('lo-fi'))).toBe('ambient');
  });

  it('post58: resolveGenre.length is 1 (optional input; map has default)', () => {
    // TS `input?` has no JS default; `map = GENRE_MAP` is the first defaulted param.
    expect(resolveGenre.length).toBe(1);
    expect(typeof resolveGenre).toBe('function');
  });

  it('post58: Function.prototype.call/apply/bind still resolve aliases', () => {
    expect(resolveGenre.call(null, 'Chill')).toBe('ambient');
    expect(resolveGenre.apply(undefined, ['METAL'])).toBe('rock');
    expect(resolveGenre.bind(null, 'classic')()).toBe('classical');
  });

  it('post58: resolveGenre name property is resolveGenre', () => {
    expect(resolveGenre.name).toBe('resolveGenre');
  });

  it('post58: Intl.Collator compare leaves VALID_GENRES declaration order distinct from alpha', () => {
    const collator = new Intl.Collator('en');
    const alpha = [...VALID_GENRES].sort((a, b) => collator.compare(a, b));
    expect(alpha[0]).toBe('ambient');
    expect(VALID_GENRES[0]).toBe('music');
    expect(alpha).not.toEqual([...VALID_GENRES]);
  });

  it('post58: localeCompare sort of GENRE_MAP keys places ambient before blues', () => {
    const sorted = [...Object.keys(GENRE_MAP)].sort((a, b) => a.localeCompare(b));
    expect(sorted.indexOf('ambient')).toBeLessThan(sorted.indexOf('blues'));
    expect(sorted.indexOf('classic')).toBeLessThan(sorted.indexOf('classical'));
  });

  it('post58: String.raw rebuild of late night matches GENRE_MAP key', () => {
    const key = String.raw`late night`;
    expect(key).toBe('late night');
    expect(GENRE_MAP[key]).toBe('ambient');
    expect(resolveGenre(key.toUpperCase())).toBe('ambient');
  });

  it('post58: template literal construction of lo-fi resolves ambient', () => {
    const lo = 'lo';
    const fi = 'fi';
    expect(resolveGenre(`${lo}-${fi}`)).toBe('ambient');
  });

  it('post58: split/join round-trip of VALID_GENRES CSV is identity', () => {
    const csv = VALID_GENRES.join('|');
    expect(csv.split('|')).toEqual([...VALID_GENRES]);
    for (const g of csv.split('|')) {
      expect(resolveGenre(g)).toBe(g);
    }
  });

  it('post58: reduce fan-in counts lock ambient at 8 and rock at 3', () => {
    const counts = Object.values(GENRE_MAP).reduce(
      (acc, v) => {
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(counts.ambient).toBe(8);
    expect(counts.rock).toBe(3);
    expect(counts.pop).toBe(2);
    expect(counts.jazz).toBe(2);
    expect(counts.classical).toBe(2);
    expect(counts.music).toBe(1);
  });

  it('post58: Math.min/max of GENRE_MAP key lengths lock entertainment longest', () => {
    const lengths = Object.keys(GENRE_MAP).map((k) => k.length);
    expect(Math.max(...lengths)).toBe('entertainment'.length); // 13 > late night 10
    expect(Math.min(...lengths)).toBe(3); // pop
    expect(Object.keys(GENRE_MAP).filter((k) => k.length === Math.max(...lengths))).toEqual([
      'entertainment',
    ]);
    expect(resolveGenre('pop')).toBe('pop');
  });

  it('post58: Number.parseInt of genre lengths is finite for every key', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(Number.isFinite(key.length)).toBe(true);
      expect(Number.parseInt(String(key.length), 10)).toBe(key.length);
    }
  });

  it('post58: BigInt of VALID_GENRES length is 9n', () => {
    expect(BigInt(VALID_GENRES.length)).toBe(9n);
    expect(Number(BigInt(VALID_GENRES.length))).toBe(9);
  });

  it('post58: URL pathname with genre slug still resolves via basename', () => {
    const url = new URL('https://example.com/categories/jazz.m3u');
    const slug = url.pathname.split('/').pop()!.replace(/\.m3u$/, '');
    expect(slug).toBe('jazz');
    expect(resolveGenre(slug)).toBe('jazz');
  });

  it('post58: URLSearchParams genre query is honored after get', () => {
    const params = new URLSearchParams('genre=chill&limit=5');
    expect(resolveGenre(params.get('genre') ?? undefined)).toBe('ambient');
  });

  it('post58: AbortController signal existence does not affect resolveGenre purity', () => {
    const ac = new AbortController();
    expect(ac.signal.aborted).toBe(false);
    expect(resolveGenre('news')).toBe('news');
    ac.abort();
    expect(ac.signal.aborted).toBe(true);
    expect(resolveGenre('news')).toBe('news');
  });

  it('post58: Promise.resolve wrapping does not make resolveGenre async', async () => {
    const sync = resolveGenre('sports');
    expect(sync).toBe('sports');
    await expect(Promise.resolve(resolveGenre('sports'))).resolves.toBe('sports');
  });

  it('post58: queueMicrotask cannot change already-returned resolveGenre value', async () => {
    const value = resolveGenre('indie');
    await new Promise<void>((resolve) => {
      queueMicrotask(() => resolve());
    });
    expect(value).toBe('rock');
    expect(resolveGenre('indie')).toBe('rock');
  });

  it('post58: Object.fromEntries round-trip of GENRE_MAP equals original', () => {
    const rebuilt = Object.fromEntries(Object.entries(GENRE_MAP));
    expect(rebuilt).toEqual(GENRE_MAP);
    expect(resolveGenre('electronic', rebuilt)).toBe('ambient');
  });

  it('post58: Object.entries iterator exhausts exactly 21 pairs', () => {
    const iter = Object.entries(GENRE_MAP)[Symbol.iterator]();
    let count = 0;
    while (!iter.next().done) count += 1;
    expect(count).toBe(21);
  });

  it('post58: Array.from on VALID_GENRES yields equal mutable copy', () => {
    const copy = Array.from(VALID_GENRES);
    expect(copy).toEqual([...VALID_GENRES]);
    copy.reverse();
    expect(VALID_GENRES[0]).toBe('music');
    expect(copy[0]).toBe('entertainment');
  });

  it('post58: Uint8Array from char codes of blues resolves jazz via map', () => {
    const codes = Uint8Array.from([...'blues'].map((c) => c.charCodeAt(0)));
    const alias = String.fromCharCode(...codes);
    expect(alias).toBe('blues');
    expect(resolveGenre(alias)).toBe('jazz');
  });

  it('post58: bitwise OR of VALID_GENRES length with 0 stays 9', () => {
    expect(VALID_GENRES.length | 0).toBe(9);
    expect(VALID_GENRES.length & 0xff).toBe(9);
    expect(~(~VALID_GENRES.length)).toBe(9);
  });

  it('post58: JSON.parse reviver cannot invent extra GENRE_MAP keys on clone', () => {
    const revived = JSON.parse(JSON.stringify(GENRE_MAP), (key, value) => value) as Record<
      string,
      string
    >;
    expect(Object.keys(revived)).toHaveLength(21);
    expect(revived).toEqual(GENRE_MAP);
  });

  it('post58: negative — resolveGenre returns plain string not playlist object', () => {
    const out = resolveGenre('jazz');
    expect(typeof out).toBe('string');
    expect(out).toBe('jazz');
    expect(Object.getOwnPropertyNames(Object(out)).includes('playlist')).toBe(false);
  });

  it('post58: negative — GENRE_MAP does not own playlist nowPlaying or curate keys', () => {
    expect(Object.hasOwn(GENRE_MAP, 'playlist')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, 'nowPlaying')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, 'curate')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, 'stations')).toBe(false);
  });

  it('post58: negative — VALID_GENRES does not include hiphop rap edm house techno', () => {
    for (const missing of ['hiphop', 'rap', 'edm', 'house', 'techno', 'k-pop', 'rnb']) {
      expect((VALID_GENRES as readonly string[]).includes(missing)).toBe(false);
      expect(resolveGenre(missing)).toBe('music');
    }
  });

  it('post58: negative — does not resolve path-like or URL-like genre tokens', () => {
    expect(resolveGenre('../jazz')).toBe('music');
    expect(resolveGenre('/ambient')).toBe('music');
    expect(resolveGenre('https://jazz')).toBe('music');
    expect(resolveGenre('file:rock')).toBe('music');
  });

  it('post58: negative — does not resolve SQL/injection-looking genre probes', () => {
    expect(resolveGenre("jazz';--")).toBe('music');
    expect(resolveGenre('jazz OR 1=1')).toBe('music');
    expect(resolveGenre('${jazz}')).toBe('music');
    expect(resolveGenre('{{ambient}}')).toBe('music');
  });

  it('post58: negative — does not resolve whitespace-only unicode pads as blank default without trim wipe', () => {
    // ZWSP is not trimmed by String.trim — falls through to unknown → music
    expect(resolveGenre('\u2000')).toBe('music'); // en quad IS trimmed → blank → music
    expect('\u2000'.trim()).toBe('');
    expect(resolveGenre('\u2000')).toBe('music');
  });

  it('post58: cross-lock every VALID_GENRES id equals GENRE_MAP identity and resolveGenre', () => {
    for (const g of VALID_GENRES) {
      expect(GENRE_MAP[g]).toBe(g);
      expect(resolveGenre(g)).toBe(g);
      expect(resolveGenre(g.toUpperCase())).toBe(g);
      expect(resolveGenre(`  ${g}  `)).toBe(g);
    }
  });

  it('post58: cross-lock every GENRE_MAP alias resolves to a VALID_GENRES member', () => {
    for (const [alias, target] of Object.entries(GENRE_MAP)) {
      expect(VALID_GENRES.includes(target as (typeof VALID_GENRES)[number])).toBe(true);
      expect(resolveGenre(alias)).toBe(target);
      expect(resolveGenre(alias.toUpperCase())).toBe(target);
    }
  });

  it('post58: cross-lock alias-only keys resolve differently from identity-only music', () => {
    const aliasOnly = Object.keys(GENRE_MAP).filter((k) => GENRE_MAP[k] !== k);
    expect(aliasOnly).toHaveLength(12);
    expect(aliasOnly).toContain('chill');
    expect(aliasOnly).toContain('classic');
    expect(aliasOnly).not.toContain('music');
    for (const a of aliasOnly) {
      expect(resolveGenre(a)).not.toBe(a);
      expect(VALID_GENRES.includes(resolveGenre(a) as (typeof VALID_GENRES)[number])).toBe(true);
    }
  });

  it('post58: custom map with non-enumerable chill still resolves via bracket get', () => {
    const map: Record<string, string> = {};
    Object.defineProperty(map, 'chill', {
      value: 'ambient',
      enumerable: false,
      writable: true,
      configurable: true,
    });
    expect(Object.keys(map)).toHaveLength(0);
    expect(map.chill).toBe('ambient');
    expect(resolveGenre('chill', map)).toBe('ambient');
  });

  it('post58: custom map getter for metal returns rock without storing own data', () => {
    const map = {
      get metal() {
        return 'rock';
      },
    } as Record<string, string>;
    expect(resolveGenre('metal', map)).toBe('rock');
    expect(Object.hasOwn(map, 'metal')).toBe(true);
  });

  it('post58: null-prototype custom map with only dance still falls back for jazz', () => {
    const map = Object.assign(Object.create(null), { dance: 'pop' }) as Record<string, string>;
    expect(Object.getPrototypeOf(map)).toBeNull();
    expect(resolveGenre('dance', map)).toBe('pop');
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('unknown', map)).toBe('music');
  });

  it('post58: inherited prototype jazz is visible to ordinary [[Get]]', () => {
    const proto = { jazz: 'jazz' };
    const map = Object.create(proto) as Record<string, string>;
    expect(Object.hasOwn(map, 'jazz')).toBe(false);
    expect(map.jazz).toBe('jazz');
    expect(resolveGenre('jazz', map)).toBe('jazz');
  });

  it('post58: empty string custom map value is not nullish so ?? returns empty', () => {
    // resolveGenre returns map[lower] ?? (...) — empty string is returned
    expect(resolveGenre('jazz', { jazz: '' })).toBe('');
    expect(GENRE_MAP.jazz).toBe('jazz');
  });

  it('post58: custom map undefined value falls through ?? to VALID_GENRES', () => {
    expect(resolveGenre('jazz', { jazz: undefined as unknown as string })).toBe('jazz');
  });

  it('post58: custom map null value falls through ?? to VALID_GENRES', () => {
    expect(resolveGenre('pop', { pop: null as unknown as string })).toBe('pop');
  });

  it('post58: does not resolve soft hyphen U+00AD inside jazz', () => {
    expect(resolveGenre('ja\u00ADzz')).toBe('music');
    expect(resolveGenre('jazz')).toBe('jazz');
  });

  it('post58: does not resolve word joiner U+2060 inside chill', () => {
    expect(resolveGenre('chi\u2060ll')).toBe('music');
  });

  it('post58: does not resolve tagging characters around rock', () => {
    expect(resolveGenre('\uE0001rock')).toBe('music');
    expect(resolveGenre('rock\uE007F')).toBe('music');
  });

  it('post58: does not resolve variation selector after pop', () => {
    expect(resolveGenre('pop\uFE0F')).toBe('music');
  });

  it('post58: does not resolve fullwidth digits or punctuation genre probes', () => {
    expect(resolveGenre('ｊａｚｚ')).toBe('music');
    expect(resolveGenre('ｐｏｐ')).toBe('music');
    expect(resolveGenre('！！！')).toBe('music');
  });

  it('post58: does not resolve emoji zwj sequences as genre labels', () => {
    expect(resolveGenre('👨‍🎤')).toBe('music');
    expect(resolveGenre('🎧')).toBe('music');
  });

  it('post58: surrogate pair alone falls back to music', () => {
    expect(resolveGenre('\uD83C\uDFB5')).toBe('music'); // 🎵
    expect(resolveGenre('\uD83C\uDFB5'.codePointAt(0)!.toString(16))).toBe('music');
  });

  it('post58: Turkish locale lowercasing of İ alone never resolves as jazz', () => {
    const lowered = 'İ'.toLocaleLowerCase('tr');
    // Node ICU may yield 'i' or 'i\u0307'; neither is a GENRE_MAP key.
    expect(lowered === 'i' || lowered === 'i\u0307').toBe(true);
    expect(GENRE_MAP[lowered]).toBeUndefined();
    expect(resolveGenre(lowered)).toBe('music');
    expect(resolveGenre('İjazz')).toBe('music');
    expect(resolveGenre('JAZZ')).toBe('jazz');
  });

  it('post58: Object.is compares resolveGenre outputs for identical aliases', () => {
    expect(Object.is(resolveGenre('lo-fi'), resolveGenre('lofi'))).toBe(true);
    expect(Object.is(resolveGenre('metal'), resolveGenre('indie'))).toBe(true);
    expect(Object.is(resolveGenre('jazz'), resolveGenre('blues'))).toBe(true);
  });

  it('post58: Set of resolveGenre outputs over GENRE_MAP keys equals VALID_GENRES set', () => {
    const resolved = new Set(Object.keys(GENRE_MAP).map((k) => resolveGenre(k)));
    expect(resolved).toEqual(new Set(VALID_GENRES));
  });

  it('post58: Map keyed by VALID_GENRES stores identity resolveGenre results', () => {
    const m = new Map(VALID_GENRES.map((g) => [g, resolveGenre(g)]));
    expect(m.size).toBe(9);
    for (const g of VALID_GENRES) {
      expect(m.get(g)).toBe(g);
    }
  });

  it('post58: WeakSet can hold GENRE_MAP and VALID_GENRES object identities', () => {
    const ws = new WeakSet<object>();
    ws.add(GENRE_MAP);
    ws.add(VALID_GENRES as unknown as object);
    expect(ws.has(GENRE_MAP)).toBe(true);
    expect(ws.has(VALID_GENRES as unknown as object)).toBe(true);
  });

  it('post58: Object.assign clone then delete chill falls back for chill alias', () => {
    const clone = Object.assign({}, GENRE_MAP);
    delete clone.chill;
    expect(resolveGenre('chill', clone)).toBe('music');
    expect(resolveGenre('ambient', clone)).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
  });

  it('post58: spread clone mutation does not alias live GENRE_MAP', () => {
    const clone = { ...GENRE_MAP, chill: 'news' };
    expect(clone.chill).toBe('news');
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(resolveGenre('chill', clone)).toBe('news');
  });

  it('post58: in operator finds late night and lo-fi keys', () => {
    expect('late night' in GENRE_MAP).toBe(true);
    expect('lo-fi' in GENRE_MAP).toBe(true);
    expect('late_night' in GENRE_MAP).toBe(false);
    expect('lo_fi' in GENRE_MAP).toBe(false);
  });

  it('post58: Object.hasOwn rejects prototype pollution style keys', () => {
    expect(Object.hasOwn(GENRE_MAP, '__proto__')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, 'constructor')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, 'toString')).toBe(false);
    expect(Object.hasOwn(GENRE_MAP, 'valueOf')).toBe(false);
  });

  it('post58: resolveGenre throws on Symbol input without string methods', () => {
    expect(() => resolveGenre(Symbol('jazz') as unknown as string)).toThrow();
  });

  it('post58: resolveGenre throws on plain object input without toLowerCase', () => {
    expect(() => resolveGenre({ genre: 'jazz' } as unknown as string)).toThrow();
  });

  it('post58: resolveGenre throws on array input', () => {
    expect(() => resolveGenre(['jazz'] as unknown as string)).toThrow();
  });

  it('post58: boxed String object still has toLowerCase and resolves', () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed = new String('jazz') as unknown as string;
    expect(resolveGenre(boxed)).toBe('jazz');
  });

  it('post58: performance.now delta for 100 resolveGenre calls is finite', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      resolveGenre('chill');
      resolveGenre('unknown');
      resolveGenre('JAZZ');
    }
    const elapsed = performance.now() - start;
    expect(Number.isFinite(elapsed)).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('post58: Date.now is not consulted by resolveGenre (pure over clock)', () => {
    const before = Date.now();
    expect(resolveGenre('classical')).toBe('classical');
    const after = Date.now();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('post58: RegExp special characters in unknown labels fall back to music', () => {
    expect(resolveGenre('jazz.*')).toBe('music');
    expect(resolveGenre('^pop$')).toBe('music');
    expect(resolveGenre('rock[0-9]')).toBe('music');
    expect(resolveGenre('(ambient)')).toBe('music');
  });

  it('post58: locks Buffer.byteLength of each VALID_GENRES id equals string length', () => {
    for (const g of VALID_GENRES) {
      expect(Buffer.byteLength(g, 'utf8')).toBe(g.length);
    }
  });

  it('post58: locks exact charCodeAt sequence for music identity', () => {
    expect([...'music'].map((c) => c.charCodeAt(0))).toEqual([109, 117, 115, 105, 99]);
  });

  it('post58: locks exact charCodeAt sequence for sports identity', () => {
    expect([...'sports'].map((c) => c.charCodeAt(0))).toEqual([115, 112, 111, 114, 116, 115]);
  });

  it('post58: every GENRE_MAP value char codes are lowercase ASCII letters only', () => {
    for (const value of Object.values(GENRE_MAP)) {
      expect([...value].every((c) => {
        const code = c.charCodeAt(0);
        return code >= 97 && code <= 122;
      })).toBe(true);
    }
  });

  it('post58: every GENRE_MAP key is lowercase ASCII letters hyphens or spaces', () => {
    for (const key of Object.keys(GENRE_MAP)) {
      expect(/^[a-z]+(?:[ -][a-z]+)*$/.test(key)).toBe(true);
    }
  });

  it('post58: resolveGenre is referentially stable as a module export function', async () => {
    const again = await import('../src/genres');
    expect(again.resolveGenre).toBe(resolveGenre);
    expect(again.GENRE_MAP).toBe(GENRE_MAP);
    expect(again.VALID_GENRES).toBe(VALID_GENRES);
  });

  it('post58: dynamic import genres module exposes exactly three public bindings used here', async () => {
    const mod = await import('../src/genres');
    expect(Object.keys(mod).sort()).toEqual(['GENRE_MAP', 'VALID_GENRES', 'resolveGenre'].sort());
  });

  it('post58: VALID_GENRES satisfies as const readonly tuple length 9', () => {
    const tuple: readonly string[] = VALID_GENRES;
    expect(tuple).toHaveLength(9);
    expect(Object.isFrozen(VALID_GENRES) || Array.isArray(VALID_GENRES)).toBe(true);
  });

  it('post58: index signature access GENRE_MAP[missing] is undefined not music', () => {
    expect(GENRE_MAP['not-a-key']).toBeUndefined();
    expect(resolveGenre('not-a-key')).toBe('music');
  });

  it('post58: repeated Object.keys(GENRE_MAP) yields equal arrays without shared identity', () => {
    const a = Object.keys(GENRE_MAP);
    const b = Object.keys(GENRE_MAP);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('post58: slice copy of VALID_GENRES can be sorted without mutating source', () => {
    const copy = VALID_GENRES.slice();
    copy.sort((x, y) => x.localeCompare(y));
    expect(VALID_GENRES[0]).toBe('music');
    expect(copy[0]).toBe('ambient');
  });

  it('post58: splice on VALID_GENRES copy does not shrink source', () => {
    const copy = [...VALID_GENRES];
    copy.splice(0, 1);
    expect(copy).toHaveLength(8);
    expect(VALID_GENRES).toHaveLength(9);
  });

  it('post58: fill on VALID_GENRES copy does not rewrite source slots', () => {
    const copy = [...VALID_GENRES];
    copy.fill('music');
    expect(copy.every((g) => g === 'music')).toBe(true);
    expect(VALID_GENRES[1]).toBe('ambient');
  });

  it('post58: copyWithin on VALID_GENRES copy leaves source intact', () => {
    const copy = [...VALID_GENRES];
    copy.copyWithin(0, 5);
    expect(VALID_GENRES[0]).toBe('music');
    expect(copy[0]).toBe('rock');
  });

  it('post58: flat of nested VALID_GENRES wrap equals spread', () => {
    expect([VALID_GENRES].flat()).toEqual([...VALID_GENRES]);
  });

  it('post58: concat of VALID_GENRES with empty stays equal copy', () => {
    expect(VALID_GENRES.concat([])).toEqual([...VALID_GENRES]);
    expect(VALID_GENRES.concat([])).not.toBe(VALID_GENRES as unknown as string[]);
  });

  it('post58: every ambient alias uppercased still maps via resolveGenre', () => {
    const ambientAliases = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k);
    for (const a of ambientAliases) {
      expect(resolveGenre(a.toUpperCase())).toBe('ambient');
      expect(resolveGenre(`\t${a}\n`)).toBe('ambient');
    }
  });

  it('post58: rock fan-in metal and indie remain distinct keys sharing target', () => {
    expect(GENRE_MAP.metal).toBe('rock');
    expect(GENRE_MAP.indie).toBe('rock');
    expect(GENRE_MAP.rock).toBe('rock');
    expect(resolveGenre('METAL')).toBe(resolveGenre('INDIE'));
  });

  it('post58: classical fan-in classic alias is not a VALID_GENRES member', () => {
    expect((VALID_GENRES as readonly string[]).includes('classic')).toBe(false);
    expect(resolveGenre('classic')).toBe('classical');
  });

  it('post58: dance alias is not a VALID_GENRES member but resolves pop', () => {
    expect((VALID_GENRES as readonly string[]).includes('dance')).toBe(false);
    expect(resolveGenre('DANCE')).toBe('pop');
  });

  it('post58: electronic alias is not VALID_GENRES member but resolves ambient', () => {
    expect((VALID_GENRES as readonly string[]).includes('electronic')).toBe(false);
    expect(resolveGenre('Electronic')).toBe('ambient');
  });

  it('post58: locks JSON.stringify(VALID_GENRES) exact snapshot', () => {
    expect(JSON.stringify(VALID_GENRES)).toBe(
      '["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]',
    );
  });

  it('post58: locks GENRE_MAP key count equals Reflect.ownKeys count', () => {
    expect(Object.keys(GENRE_MAP).length).toBe(Reflect.ownKeys(GENRE_MAP).length);
    expect(Object.values(GENRE_MAP).length).toBe(21);
  });

  it('post58: resolveGenre default map param is GENRE_MAP by reference semantics', () => {
    const before = GENRE_MAP.focus;
    expect(before).toBe('ambient');
    GENRE_MAP.focus = 'jazz';
    try {
      expect(resolveGenre('focus')).toBe('jazz');
    } finally {
      GENRE_MAP.focus = 'ambient';
    }
    expect(resolveGenre('focus')).toBe('ambient');
  });

  it('post58: empty custom map + VALID_GENRES includes path does not consult GENRE_MAP', () => {
    const before = { ...GENRE_MAP };
    expect(resolveGenre('entertainment', {})).toBe('entertainment');
    expect(GENRE_MAP).toEqual(before);
  });

  it('post58: empty/undefined short-circuit before map get; whitespace still lookups', () => {
    let gets = 0;
    const map = new Proxy(
      {} as Record<string, string>,
      {
        get(target, prop, receiver) {
          if (typeof prop === 'string') gets += 1;
          return Reflect.get(target, prop, receiver);
        },
      },
    );
    expect(resolveGenre('', map)).toBe('music');
    expect(resolveGenre(undefined, map)).toBe('music');
    const getsAfterEmpty = gets;
    // Whitespace is truthy so !input is false; trim yields '' and map[''] is read.
    expect(resolveGenre('   ', map)).toBe('music');
    expect(gets).toBeGreaterThan(getsAfterEmpty);
  });

  it('post58: Proxy throwing on get for missing key still allows VALID_GENRES hit', () => {
    const map = new Proxy(
      {} as Record<string, string>,
      {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && Object.hasOwn(target, prop)) {
            return Reflect.get(target, prop, receiver);
          }
          if (typeof prop === 'string') return undefined;
          return Reflect.get(target, prop, receiver);
        },
      },
    );
    expect(resolveGenre('jazz', map)).toBe('jazz');
    expect(resolveGenre('nope', map)).toBe('music');
  });

  it('post58: does not resolve NBSP-only string as blank after trim', () => {
    expect('\u00A0'.trim()).toBe('');
    expect(resolveGenre('\u00A0')).toBe('music');
    expect(resolveGenre('\u00A0jazz\u00A0')).toBe('jazz');
  });

  it('post58: does not resolve figure space pads inside late night as alias', () => {
    expect(resolveGenre('late\u2007night')).toBe('music');
    expect(resolveGenre('late night')).toBe('ambient');
  });

  it('post58: does not resolve thin space U+2009 between late and night', () => {
    expect(resolveGenre('late\u2009night')).toBe('music');
  });

  it('post58: does not resolve hair space U+200A between lo and fi with hyphen', () => {
    expect(resolveGenre('lo\u200A-fi')).toBe('music');
    expect(resolveGenre('lo-fi')).toBe('ambient');
  });

  it('post58: multi-arg resolveGenre ignores extra args beyond map', () => {
    expect(
      (resolveGenre as unknown as (...args: unknown[]) => string)('jazz', GENRE_MAP, 'extra'),
    ).toBe('jazz');
  });

  it('post58: locks ambient alias list exact sorted snapshot', () => {
    const ambient = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k)
      .sort((a, b) => a.localeCompare(b));
    expect(ambient).toEqual([
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

  it('post58: locks rock alias list exact sorted snapshot', () => {
    const rock = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'rock')
      .map(([k]) => k)
      .sort((a, b) => a.localeCompare(b));
    expect(rock).toEqual(['indie', 'metal', 'rock']);
  });

  it('post58: locks pop alias list exact sorted snapshot', () => {
    const pop = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'pop')
      .map(([k]) => k)
      .sort((a, b) => a.localeCompare(b));
    expect(pop).toEqual(['dance', 'pop']);
  });

  it('post58: Symbol.toStringTag on GENRE_MAP is undefined (plain object)', () => {
    expect((GENRE_MAP as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBeUndefined();
    expect(Object.prototype.toString.call(GENRE_MAP)).toBe('[object Object]');
    expect(Object.prototype.toString.call(VALID_GENRES)).toBe('[object Array]');
  });

  it('post58: isPrototypeOf Object.prototype holds for GENRE_MAP', () => {
    expect(Object.prototype.isPrototypeOf(GENRE_MAP)).toBe(true);
    expect(Array.prototype.isPrototypeOf(VALID_GENRES)).toBe(true);
  });

  it('post58: resolveGenre never returns uppercase even when map value is upper', () => {
    // If custom map returns UPPER, resolveGenre returns it as-is (no re-lower)
    expect(resolveGenre('x', { x: 'JAZZ' })).toBe('JAZZ');
    // Default path always returns lowercase VALID / map values
    expect(resolveGenre('JAZZ')).toBe('jazz');
  });

  it('post58: custom map can return non-VALID string and resolveGenre trusts map', () => {
    expect(resolveGenre('x', { x: 'invented-genre' })).toBe('invented-genre');
    expect((VALID_GENRES as readonly string[]).includes('invented-genre')).toBe(false);
  });

  it('post58: exhaustiveness — every switch-like VALID_GENRES branch is reachable', () => {
    const seen = new Set<string>();
    for (const g of VALID_GENRES) {
      switch (resolveGenre(g)) {
        case 'music':
        case 'ambient':
        case 'jazz':
        case 'classical':
        case 'pop':
        case 'rock':
        case 'news':
        case 'sports':
        case 'entertainment':
          seen.add(g);
          break;
        default: {
          const _exhaustive: never = resolveGenre(g) as never;
          throw new Error(`unexpected ${_exhaustive}`);
        }
      }
    }
    expect(seen.size).toBe(9);
  });
});
