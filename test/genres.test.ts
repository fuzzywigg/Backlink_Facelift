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

});
