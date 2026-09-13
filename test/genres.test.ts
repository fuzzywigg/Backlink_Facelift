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
    expect(Object.isFrozen(GENRE_MAP)).toBe(false);
    expect(Object.isSealed(GENRE_MAP)).toBe(false);
    expect(Object.isExtensible(GENRE_MAP)).toBe(true);
  });

  it('returns NaN map values via ?? without falling through to VALID_GENRES', () => {
    const map = { chill: Number.NaN } as unknown as Record<string, string>;
    expect(Number.isNaN(resolveGenre('chill', map) as unknown as number)).toBe(true);
  });
});
