import { describe, expect, it, vi } from 'vitest';
import {
  SAMPLE_M3U,
  buildSimpleM3U,
  captureGeminiRequest,
  countHttpStreamLines,
  curatedGeminiJson,
  geminiTextResponse,
  iptvCallsWithInit,
  iptvCategoryUrl,
  mockKV,
  seedStationsCache,
  stubIptvAndGemini,
  testEnv,
} from './helpers';

describe('test helpers', () => {
  it('seeds mockKV and supports get/put/delete', async () => {
    const kv = mockKV({ 'stations:music': '[]' });
    await expect(kv.get('stations:music')).resolves.toBe('[]');
    await kv.put('stations:jazz', '[{"name":"J"}]');
    await expect(kv.get('stations:jazz')).resolves.toBe('[{"name":"J"}]');
    await kv.delete('stations:music');
    await expect(kv.get('stations:music')).resolves.toBeNull();
  });

  it('builds testEnv with VERSION and optional overrides', () => {
    const env = testEnv({ GEMINI_API_KEY: 'k', VERSION: '9.9.9' });
    expect(env.VERSION).toBe('9.9.9');
    expect(env.GEMINI_API_KEY).toBe('k');
    expect(env.CATALOG_CACHE).toBeTruthy();
  });

  it('exposes a multi-station SAMPLE_M3U for route stubs', () => {
    expect(SAMPLE_M3U).toContain('#EXTM3U');
    expect(SAMPLE_M3U).toContain('Alpha FM');
    expect(SAMPLE_M3U).toContain('Zeta FM');
    expect([...SAMPLE_M3U.matchAll(/^https:\/\//gm)]).toHaveLength(6);
  });

  it('wraps Gemini text in the generateContent candidate shape', async () => {
    const res = geminiTextResponse('hello');
    const body = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('hello');
  });

  it('stubIptvAndGemini serves M3U, Gemini, and 404 for other hosts', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: curatedGeminiJson(),
    }) as unknown as (input: string) => Promise<Response>;
    const iptv = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(iptv.status).toBe(200);
    expect(await iptv.text()).toContain('Alpha FM');

    const gemini = await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=x',
    );
    expect(gemini.status).toBe(200);
    const payload = (await gemini.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(payload.candidates[0].content.parts[0].text).toContain('Alpha FM');

    const other = await fetchMock('https://example.com/other');
    expect(other.status).toBe(404);
  });

  it('stubIptvAndGemini returns iptvStatus when m3u is null', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 502 }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(502);
  });

  it('stubIptvAndGemini accepts a gemini factory and defaults to 500', async () => {
    const factory = vi.fn(() => new Response('custom', { status: 418 }));
    const withFactory = stubIptvAndGemini({ gemini: factory }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await withFactory('https://generativelanguage.googleapis.com/v1beta/x');
    expect(res.status).toBe(418);
    expect(factory).toHaveBeenCalledOnce();

    const degraded = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const boom = await degraded('https://generativelanguage.googleapis.com/v1beta/x');
    expect(boom.status).toBe(500);
  });

  it('builds iptv category URLs matching the Worker CDN layout', () => {
    expect(iptvCategoryUrl('jazz')).toBe(
      'https://iptv-org.github.io/iptv/categories/jazz.m3u',
    );
    expect(iptvCategoryUrl('music')).toMatch(/\/music\.m3u$/);
  });

  it('counts http(s) stream lines in SAMPLE_M3U', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    expect(countHttpStreamLines('#EXTM3U\n')).toBe(0);
    expect(countHttpStreamLines('rtmp://x\nhttps://ok\n')).toBe(1);
  });

  it('curatedGeminiJson defaults to a single Alpha FM pick', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      name: string;
    }>;
    expect(picks).toHaveLength(1);
    expect(picks[0].name).toBe('Alpha FM');
  });

  it('mockKV list/getWithMetadata stubs return empty-shaped results', async () => {
    const kv = mockKV();
    await expect(kv.list()).resolves.toMatchObject({ keys: [], list_complete: true });
    await expect(kv.getWithMetadata('missing')).resolves.toMatchObject({
      value: null,
      metadata: null,
    });
  });

  it('overwrites an existing mockKV key on put', async () => {
    const kv = mockKV({ 'stations:music': 'old' });
    await kv.put('stations:music', 'new');
    await expect(kv.get('stations:music')).resolves.toBe('new');
  });

  it('builds independent testEnv objects without shared KV', () => {
    const a = testEnv();
    const b = testEnv();
    expect(a.CATALOG_CACHE).not.toBe(b.CATALOG_CACHE);
    expect(a.VERSION).toBe('0.1.0-test');
  });

  it('curatedGeminiJson accepts custom station picks', async () => {
    const res = curatedGeminiJson([
      {
        name: 'Custom FM',
        url: 'https://example.com/custom.m3u8',
        editorial: 'Custom.',
        genre: 'jazz',
        logo: 'https://cdn.example/c.png',
      },
    ]);
    const body = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      name: string;
      genre: string;
      logo?: string;
    }>;
    expect(picks).toEqual([
      {
        name: 'Custom FM',
        url: 'https://example.com/custom.m3u8',
        editorial: 'Custom.',
        genre: 'jazz',
        logo: 'https://cdn.example/c.png',
      },
    ]);
  });

  it('counts http but not uppercase HTTP schemes', () => {
    expect(countHttpStreamLines('HTTP://x\nhttps://y\n')).toBe(1);
  });

  it('builds iptv URLs for every VALID_GENRES-like slug without encoding', () => {
    expect(iptvCategoryUrl('entertainment')).toBe(
      'https://iptv-org.github.io/iptv/categories/entertainment.m3u',
    );
    expect(iptvCategoryUrl('lo-fi')).toContain('/lo-fi.m3u');
  });

  it('stubIptvAndGemini defaults iptvStatus to 503 when m3u is null', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(503);
  });

  it('geminiTextResponse returns application/json', () => {
    const res = geminiTextResponse('x');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('stubIptvAndGemini matches iptv-org anywhere in the URL string', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '#EXTM3U\n' }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://cdn.example/proxy?u=https://iptv-org.github.io/x');
    expect(res.status).toBe(200);
  });

  it('stubIptvAndGemini stringifies Request poorly but accepts URL objects', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 418 }) as unknown as (
      input: RequestInfo | URL,
    ) => Promise<Response>;
    // String(Request) === "[object Request]" — does not match iptv-org / gemini hosts
    const fromRequest = await fetchMock(
      new Request('https://iptv-org.github.io/iptv/categories/music.m3u'),
    );
    expect(fromRequest.status).toBe(404);

    const fromUrl = await fetchMock(
      new URL('https://iptv-org.github.io/iptv/categories/music.m3u'),
    );
    expect(fromUrl.status).toBe(418);
  });

  it('countHttpStreamLines trims before scheme checks', () => {
    expect(countHttpStreamLines('  https://a  \n\thttp://b\n')).toBe(2);
  });

  it('testEnv leaves GEMINI_API_KEY undefined unless overridden', () => {
    expect(testEnv().GEMINI_API_KEY).toBeUndefined();
    expect(testEnv({ GEMINI_API_KEY: 'x' }).GEMINI_API_KEY).toBe('x');
  });

  it('mockKV delete is a no-op for missing keys', async () => {
    const kv = mockKV();
    await expect(kv.delete('missing')).resolves.toBeUndefined();
    await expect(kv.get('missing')).resolves.toBeNull();
  });

  it('SAMPLE_M3U station display names are unique', () => {
    const names = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(6);
  });

  it('iptvCategoryUrl does not encode slashes or query characters', () => {
    expect(iptvCategoryUrl('a/b')).toBe(
      'https://iptv-org.github.io/iptv/categories/a/b.m3u',
    );
  });

  it('curatedGeminiJson returns a Response that can be read once', async () => {
    const res = curatedGeminiJson();
    await expect(res.json()).resolves.toBeTruthy();
    await expect(res.json()).rejects.toThrow();
  });

  it('stubIptvAndGemini default gemini body is the literal boom text', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.googleapis.com/v1beta/x');
    expect(await res.text()).toBe('boom');
  });

  it('stubIptvAndGemini accepts an empty M3U string body', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '' }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('stubIptvAndGemini honors an explicit iptvStatus 404 with null m3u', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 404 }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('down');
  });

  it('countHttpStreamLines returns 0 for empty and CR-only bodies', () => {
    expect(countHttpStreamLines('')).toBe(0);
    expect(countHttpStreamLines('\r\n\r\n')).toBe(0);
    expect(countHttpStreamLines('#EXTM3U\n#EXTINF:-1,X\n')).toBe(0);
  });

  it('mockKV get/put can be overridden to reject for failure-path tests', async () => {
    const kv = mockKV();
    (kv.get as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('get fail'));
    (kv.put as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('put fail'));
    await expect(kv.get('x')).rejects.toThrow('get fail');
    await expect(kv.put('x', 'y')).rejects.toThrow('put fail');
  });

  it('curatedGeminiJson embeds custom station payloads', async () => {
    const res = curatedGeminiJson([
      {
        name: 'Custom',
        url: 'https://example.com/c.m3u8',
        editorial: 'note',
        genre: 'jazz',
        logo: 'https://cdn.example/c.png',
      },
    ]);
    const body = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const parsed = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{ name: string }>;
    expect(parsed[0].name).toBe('Custom');
  });

  it('iptvCategoryUrl appends .m3u for each genre slug', () => {
    expect(iptvCategoryUrl('music')).toBe(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    expect(iptvCategoryUrl('entertainment')).toContain('/entertainment.m3u');
  });

  it('SAMPLE_M3U contains only https stream lines', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    expect(SAMPLE_M3U).not.toMatch(/^http:\/\//m);
  });

  it('geminiTextResponse wraps text in the candidates/parts shape', async () => {
    const body = (await geminiTextResponse('hello').json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('hello');
  });

  it('stubIptvAndGemini invokes a gemini factory each time', async () => {
    let n = 0;
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        n += 1;
        return new Response(`n=${n}`, { status: 200 });
      },
    }) as unknown as (input: string) => Promise<Response>;
    expect(await (await fetchMock('https://generativelanguage.googleapis.com/x')).text()).toBe('n=1');
    expect(await (await fetchMock('https://generativelanguage.googleapis.com/x')).text()).toBe('n=2');
  });

  it('testEnv spreads overrides after defaults so VERSION can be cleared', () => {
    expect(testEnv({ VERSION: undefined }).VERSION).toBeUndefined();
  });

  it('mockKV list and getWithMetadata return empty stubs', async () => {
    const kv = mockKV({ a: '1' });
    await expect(kv.list()).resolves.toMatchObject({ keys: [], list_complete: true });
    await expect(kv.getWithMetadata('a')).resolves.toMatchObject({ value: null, metadata: null });
  });

  it('SAMPLE_M3U group-title is Music for every seeded station', () => {
    const groups = [...SAMPLE_M3U.matchAll(/group-title="([^"]+)"/g)].map((m) => m[1]);
    expect(groups.every((g) => g === 'Music')).toBe(true);
    expect(groups).toHaveLength(6);
  });

  it('countHttpStreamLines ignores rtmp and scheme-less paths', () => {
    expect(countHttpStreamLines('rtmp://x\n/relative\nhttps://ok\n')).toBe(1);
  });

  it('stubIptvAndGemini matches generativelanguage host substring', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: new Response('ok', { status: 200 }),
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.googleapis.com/custom');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('iptvCategoryUrl appends .m3u even when genre already ends with .m3u', () => {
    expect(iptvCategoryUrl('music.m3u')).toBe(
      'https://iptv-org.github.io/iptv/categories/music.m3u.m3u',
    );
  });

  it('geminiTextResponse can wrap empty string text', async () => {
    const body = (await geminiTextResponse('').json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('');
  });

  it('mockKV seed is copied — mutating the seed object later does not affect store', async () => {
    const seed: Record<string, string> = { k: 'v' };
    const kv = mockKV(seed);
    seed.k = 'mutated';
    await expect(kv.get('k')).resolves.toBe('v');
  });

  it('curatedGeminiJson default genre is music', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{ genre: string }>;
    expect(picks[0].genre).toBe('music');
  });

  it('testEnv can replace CATALOG_CACHE with a custom mock', async () => {
    const kv = mockKV({ x: '1' });
    const env = testEnv({ CATALOG_CACHE: kv });
    await expect(env.CATALOG_CACHE.get('x')).resolves.toBe('1');
  });

  it('stubIptvAndGemini returns 404 body nope for unrelated hosts', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://example.com/');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });
  it('mockKV.put accepts expirationTtl options without throwing', async () => {
    const kv = mockKV();
    await expect(
      (kv.put as unknown as (k: string, v: string, o?: object) => Promise<void>)(
        'stations:music',
        '[]',
        { expirationTtl: 3600 },
      ),
    ).resolves.toBeUndefined();
    await expect(kv.get('stations:music')).resolves.toBe('[]');
  });

  it('stubIptvAndGemini with m3u undefined uses SAMPLE_M3U', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SAMPLE_M3U);
  });

  it('geminiTextResponse always has exactly one candidate and one part', async () => {
    const body = (await geminiTextResponse('x').json()) as {
      candidates: Array<{ content: { parts: unknown[] } }>;
    };
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].content.parts).toHaveLength(1);
  });

  it('curatedGeminiJson round-trips model text through JSON.parse', async () => {
    const body = (await curatedGeminiJson([
      { name: 'X', url: 'https://x', editorial: 'e', genre: 'jazz', logo: 'https://l' },
    ]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      name: string;
      logo?: string;
    }>;
    expect(picks).toEqual([
      { name: 'X', url: 'https://x', editorial: 'e', genre: 'jazz', logo: 'https://l' },
    ]);
  });

  it('countHttpStreamLines ignores http URLs inside EXTINF attribute values', () => {
    const m3u = `#EXTINF:-1 tvg-logo="https://cdn.example/logo.png" tvg-name="A",A
https://example.com/a.m3u8
`;
    expect(countHttpStreamLines(m3u)).toBe(1);
  });

  it('iptvCategoryUrl with empty genre still builds a categories path', () => {
    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');
  });

  it('testEnv always exposes CATALOG_CACHE', () => {
    expect(testEnv()).toHaveProperty('CATALOG_CACHE');
    expect(Object.keys(testEnv()).sort()).toEqual(['CATALOG_CACHE', 'VERSION']);
  });

  it('SAMPLE_M3U omits tvg-logo and tvg-language so degrade logo paths stay honest', () => {
    expect(SAMPLE_M3U).not.toMatch(/tvg-logo=/);
    expect(SAMPLE_M3U).not.toMatch(/tvg-language=/);
    expect(SAMPLE_M3U).not.toMatch(/tvg-country=/);
  });

  it('buildSimpleM3U emits EXTINF attributes only when provided', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://example.com/a.m3u8', group: 'Jazz', language: 'en' },
      { name: 'B', url: 'https://example.com/b.m3u8' },
    ]);
    expect(m3u).toMatch(/tvg-name="A"/);
    expect(m3u).toMatch(/group-title="Jazz"/);
    expect(m3u).toMatch(/tvg-language="en"/);
    expect(m3u).toMatch(/tvg-name="B"/);
    expect(m3u.split('tvg-logo=')).toHaveLength(1); // only the header check — no logo attrs
    expect(countHttpStreamLines(m3u)).toBe(2);
  });

  it('buildSimpleM3U can include logo and country', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'C',
        url: 'https://example.com/c.m3u8',
        logo: 'https://cdn/c.png',
        country: 'US',
      },
    ]);
    expect(m3u).toMatch(/tvg-logo="https:\/\/cdn\/c\.png"/);
    expect(m3u).toMatch(/tvg-country="US"/);
  });

  it('stubIptvAndGemini with empty-string m3u returns 200 empty body', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '' }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('stubIptvAndGemini with m3u null uses iptvStatus default 503', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');
  });

  it('stubIptvAndGemini with m3u null honors custom iptvStatus', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 418 }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/rock.m3u');
    expect(res.status).toBe(418);
  });

  it('stubIptvAndGemini gemini callback form is invoked per request', async () => {
    let calls = 0;
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        calls += 1;
        return geminiTextResponse('[]');
      },
    }) as unknown as (input: string) => Promise<Response>;
    await fetchMock('https://generativelanguage.googleapis.com/v1beta/models/x');
    await fetchMock('https://generativelanguage.googleapis.com/v1beta/models/x');
    expect(calls).toBe(2);
  });

  it('stubIptvAndGemini returns 404 for unrelated hosts', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://example.com/other');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('buildSimpleM3U ends with a trailing newline and starts with #EXTM3U', () => {
    const m3u = buildSimpleM3U([{ name: 'A', url: 'https://example.com/a.m3u8' }]);
    expect(m3u.startsWith('#EXTM3U\n')).toBe(true);
    expect(m3u.endsWith('\n')).toBe(true);
  });

  it('countHttpStreamLines trims before counting', () => {
    expect(countHttpStreamLines('  https://example.com/a.m3u8  \nhttp://example.com/b')).toBe(2);
  });

  it('iptvCategoryUrl encodes no extra path segments for plain genre ids', () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(iptvCategoryUrl('late night')).toBe(
      'https://iptv-org.github.io/iptv/categories/late night.m3u',
    );
  });

  it('mockKV delete removes keys and list stays empty stub', async () => {
    const kv = mockKV({ a: '1' });
    await kv.delete('a');
    await expect(kv.get('a')).resolves.toBeNull();
    await expect(kv.list()).resolves.toMatchObject({ keys: [], list_complete: true });
  });

  it('curatedGeminiJson default fixture names Alpha FM', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{ name: string }>;
    expect(picks[0].name).toBe('Alpha FM');
  });

  it('stubIptvAndGemini serves per-genre bodies via iptvByGenre', async () => {
    const jazz = buildSimpleM3U([{ name: 'Jazz Only', url: 'https://example.com/jazz-only.m3u8' }]);
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz, music: null },
      iptvStatus: 502,
      m3u: SAMPLE_M3U,
    }) as unknown as (input: string) => Promise<Response>;

    const jazzRes = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(jazzRes.status).toBe(200);
    expect(await jazzRes.text()).toContain('Jazz Only');

    const musicRes = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(musicRes.status).toBe(502);

    // Unlisted genres still use the default m3u body
    const rockRes = await fetchMock('https://iptv-org.github.io/iptv/categories/rock.m3u');
    expect(rockRes.status).toBe(200);
    expect(await rockRes.text()).toContain('Alpha FM');
  });

  it('stubIptvAndGemini iptvByGenre null falls back to iptvStatus default 503', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { ambient: null },
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/ambient.m3u');
    expect(res.status).toBe(503);
  });

  it('buildSimpleM3U([]) yields only the #EXTM3U header plus trailing newline', () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
  });

  it('curatedGeminiJson round-trips optional logo when provided', async () => {
    const res = curatedGeminiJson([
      {
        name: 'Logo FM',
        url: 'https://example.com/logo.m3u8',
        editorial: 'has logo',
        genre: 'jazz',
        logo: 'https://cdn.example/logo.png',
      },
    ]);
    const body = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      logo?: string;
    }>;
    expect(picks[0].logo).toBe('https://cdn.example/logo.png');
  });

  it('seedStationsCache serializes objects and preserves existing keys', () => {
    const seeded = seedStationsCache('jazz', [{ name: 'J', url: 'https://x' }], {
      'stations:music': '[]',
    });
    expect(seeded['stations:music']).toBe('[]');
    expect(JSON.parse(seeded['stations:jazz'])).toEqual([{ name: 'J', url: 'https://x' }]);
  });

  it('seedStationsCache keeps raw strings untouched', () => {
    expect(seedStationsCache('music', 'not-json')['stations:music']).toBe('not-json');
  });

  it('captureGeminiRequest returns null when Gemini was never called', () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('captureGeminiRequest extracts url/method/body from Gemini calls', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse('[]'),
    });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [], generationConfig: { temperature: 0.7 } }),
      },
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured).not.toBeNull();
    expect(captured!.method).toBe('POST');
    expect(captured!.url).toContain('generativelanguage.googleapis.com');
    expect(captured!.body).toHaveProperty('generationConfig');
  });

  it('iptvCallsWithInit is empty for bare stubIptvAndGemini iptv hits', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    await (fetchMock as unknown as (input: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('iptvCallsWithInit records calls that passed a RequestInit', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => {
      return new Response(SAMPLE_M3U, { status: 200 });
    });
    await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u', {
      method: 'GET',
    });
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
  });

  it('mockKV.put records options but get still returns only the string value', async () => {
    const kv = mockKV();
    await kv.put('stations:music', '[]', { expirationTtl: 3600 });
    await expect(kv.get('stations:music')).resolves.toBe('[]');
    expect(kv.put).toHaveBeenCalledWith('stations:music', '[]', { expirationTtl: 3600 });
  });

  it('iptvByGenre miss falls through to default m3u body', async () => {
    const jazz = buildSimpleM3U([{ name: 'Jazz', url: 'https://example.com/j.m3u8' }]);
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz },
      m3u: SAMPLE_M3U,
    }) as unknown as (input: string) => Promise<Response>;
    const rock = await fetchMock('https://iptv-org.github.io/iptv/categories/rock.m3u');
    expect(rock.status).toBe(200);
    expect(await rock.text()).toContain('Alpha FM');
  });

  it('iptvByGenre + global m3u null serves mapped genre and 503s unmapped', async () => {
    const jazz = buildSimpleM3U([{ name: 'Jazz', url: 'https://example.com/j.m3u8' }]);
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz },
      m3u: null,
    }) as unknown as (input: string) => Promise<Response>;
    expect((await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u')).status).toBe(
      200,
    );
    expect((await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u')).status).toBe(
      503,
    );
  });

  it('captureGeminiRequest defaults method GET and body {} when init omitted', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured!.method).toBe('GET');
    expect(captured!.body).toEqual({});
  });

  it('captureGeminiRequest picks the first Gemini call when multiple exist', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    const call = fetchMock as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    await call(
      'https://generativelanguage.googleapis.com/v1beta/models/first:generateContent?key=k',
      { method: 'POST', body: JSON.stringify({ n: 1 }) },
    );
    await call(
      'https://generativelanguage.googleapis.com/v1beta/models/second:generateContent?key=k',
      { method: 'POST', body: JSON.stringify({ n: 2 }) },
    );
    expect(captureGeminiRequest(fetchMock)!.url).toContain('models/first:');
    expect(captureGeminiRequest(fetchMock)!.body).toEqual({ n: 1 });
  });

  it('buildSimpleM3U emits language+group+logo+country when all present', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        group: 'G',
        language: 'en',
        country: 'US',
        logo: 'https://cdn/full.png',
      },
    ]);
    expect(m3u).toContain('tvg-name="Full"');
    expect(m3u).toContain('tvg-logo="https://cdn/full.png"');
    expect(m3u).toContain('group-title="G"');
    expect(m3u).toContain('tvg-language="en"');
    expect(m3u).toContain('tvg-country="US"');
  });

  it('buildSimpleM3U does not emit null attr tokens when optionals omitted', () => {
    const m3u = buildSimpleM3U([{ name: 'Bare', url: 'https://example.com/bare.m3u8' }]);
    expect(m3u).not.toMatch(/\bnull\b/);
    expect(m3u).not.toContain('tvg-logo');
    expect(m3u).not.toContain('group-title');
  });

  it('seedStationsCache overwrites the same genre key', () => {
    const first = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const second = seedStationsCache('music', [{ name: 'B', url: 'https://b' }], first);
    expect(JSON.parse(second['stations:music'])).toEqual([{ name: 'B', url: 'https://b' }]);
  });

  it('seedStationsCache serializes empty array as []', () => {
    expect(seedStationsCache('rock', [])['stations:rock']).toBe('[]');
  });

  it('countHttpStreamLines ignores leading spaces before URL via trim', () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="A",A
   https://example.com/a.m3u8
#EXTINF:-1 tvg-name="B",B
http://example.com/b.m3u8
`;
    expect(countHttpStreamLines(m3u)).toBe(2);
  });

  it('stubIptvAndGemini iptvStatus 404 with iptvByGenre null returns 404', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: null },
      iptvStatus: 404,
    }) as unknown as (input: string) => Promise<Response>;
    expect((await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u')).status).toBe(
      404,
    );
  });

  it('geminiTextResponse does not include finishReason', async () => {
    const body = (await geminiTextResponse('hi').json()) as Record<string, unknown>;
    const candidate = (body.candidates as Array<Record<string, unknown>>)[0];
    expect(candidate).not.toHaveProperty('finishReason');
  });

  it('curatedGeminiJson([]) yields model text []', async () => {
    const body = (await curatedGeminiJson([]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('[]');
  });

  it('iptvCategoryUrl embeds spaces raw without encodeURIComponent', () => {
    expect(iptvCategoryUrl('late night')).toBe(
      'https://iptv-org.github.io/iptv/categories/late night.m3u',
    );
  });

  it('iptvCallsWithInit ignores Gemini calls that have init', async () => {
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.includes('generativelanguage')) return geminiTextResponse('[]');
      return new Response(SAMPLE_M3U, { status: 200 });
    });
    await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    await fetchMock('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k', {
      method: 'POST',
      body: '{}',
    });
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('mockKV.get returns null not undefined for missing keys', async () => {
    const kv = mockKV();
    await expect(kv.get('missing')).resolves.toBeNull();
    await expect(kv.get('missing')).resolves.not.toBeUndefined();
  });

  it('testEnv keeps empty-string GEMINI_API_KEY (falsy for /curate)', () => {
    const env = testEnv({ GEMINI_API_KEY: '' });
    expect(env.GEMINI_API_KEY).toBe('');
    expect(Boolean(env.GEMINI_API_KEY)).toBe(false);
  });

  it('SAMPLE_M3U has exactly 6 http(s) stream lines', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it('captureGeminiRequest returns headers from the RequestInit', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    const headers = { 'content-type': 'application/json', 'x-test': '1' };
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ contents: [] }),
      },
    );
    expect(captureGeminiRequest(fetchMock)!.headers).toEqual(headers);
  });

  it('captureGeminiRequest throws when body is invalid JSON', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'POST', body: '{not-json' },
    );
    expect(() => captureGeminiRequest(fetchMock)).toThrow();
  });

  it('stubIptvAndGemini prefers iptvByGenre over default m3u for matching genres', async () => {
    const jazz = buildSimpleM3U([{ name: 'Jazz Only', url: 'https://example.com/jazz.m3u8' }]);
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      iptvByGenre: { jazz },
    });
    const jazzRes = await (fetchMock as unknown as (input: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/jazz.m3u',
    );
    const musicRes = await (fetchMock as unknown as (input: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    expect(await jazzRes.text()).toContain('Jazz Only');
    expect(await musicRes.text()).toContain('Alpha FM');
  });

  it('buildSimpleM3U emits attributes in name/logo/group/language/country order', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Ordered',
        url: 'https://example.com/o.m3u8',
        logo: 'https://l',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
    const extinf = m3u.split('\n').find((l) => l.startsWith('#EXTINF'))!;
    const nameIdx = extinf.indexOf('tvg-name=');
    const logoIdx = extinf.indexOf('tvg-logo=');
    const groupIdx = extinf.indexOf('group-title=');
    const langIdx = extinf.indexOf('tvg-language=');
    const countryIdx = extinf.indexOf('tvg-country=');
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(logoIdx).toBeGreaterThan(nameIdx);
    expect(groupIdx).toBeGreaterThan(logoIdx);
    expect(langIdx).toBeGreaterThan(groupIdx);
    expect(countryIdx).toBeGreaterThan(langIdx);
  });

  it('stubIptvAndGemini Request inputs miss host match and return 404', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    const res = await (
      fetchMock as unknown as (input: RequestInfo) => Promise<Response>
    )(new Request('https://iptv-org.github.io/iptv/categories/music.m3u'));
    // String(Request) === "[object Request]" — documented quirk
    expect(res.status).toBe(404);
    expect(String(new Request('https://iptv-org.github.io/iptv/categories/music.m3u'))).toBe(
      '[object Request]',
    );
  });

  it('seedStationsCache merges without overwriting unrelated existing keys', () => {
    const seeded = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }], {
      'stations:music': '[]',
      other: 'keep',
    });
    expect(seeded).toEqual({
      'stations:music': '[]',
      other: 'keep',
      'stations:jazz': JSON.stringify([{ name: 'J', url: 'https://j' }]),
    });
  });

  it('buildSimpleM3U emits empty quoted attrs when optionals are empty strings', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'E',
        url: 'https://example.com/e.m3u8',
        logo: '',
        group: '',
        language: '',
        country: '',
      },
    ]);
    expect(m3u).toContain('tvg-logo=""');
    expect(m3u).toContain('group-title=""');
    expect(m3u).toContain('tvg-language=""');
    expect(m3u).toContain('tvg-country=""');
  });

  it('countHttpStreamLines returns 0 for header-only and non-http playlists', () => {
    expect(countHttpStreamLines('#EXTM3U\n')).toBe(0);
    expect(countHttpStreamLines('#EXTM3U\n#EXTINF:-1,A\nrtmp://x\n')).toBe(0);
  });

  it('iptvCategoryUrl joins genre without encoding slashes or queries', () => {
    expect(iptvCategoryUrl('jazz')).toBe(
      'https://iptv-org.github.io/iptv/categories/jazz.m3u',
    );
    expect(iptvCategoryUrl('a/b')).toBe(
      'https://iptv-org.github.io/iptv/categories/a/b.m3u',
    );
  });

  it('mockKV delete is a no-op for missing keys and removes existing ones', async () => {
    const kv = mockKV({ a: '1' });
    await kv.delete('missing');
    await kv.delete('a');
    expect(await kv.get('a')).toBeNull();
  });

  it('testEnv spreads overrides after defaults so CATALOG_CACHE can be replaced', () => {
    const custom = mockKV({ 'stations:music': '[]' });
    const env = testEnv({ CATALOG_CACHE: custom, VERSION: 'x' });
    expect(env.CATALOG_CACHE).toBe(custom);
    expect(env.VERSION).toBe('x');
  });

  it('geminiTextResponse wraps text inside candidates[0].content.parts[0]', async () => {
    const res = geminiTextResponse('hello');
    const body = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('hello');
  });

  it('curatedGeminiJson default station matches Alpha FM fixture shape', async () => {
    const res = curatedGeminiJson();
    const text = (
      (await res.json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      }
    ).candidates[0].content.parts[0].text;
    expect(JSON.parse(text)).toEqual([
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'Default curated pick.',
        genre: 'music',
      },
    ]);
  });

  it('SAMPLE_M3U station names are Alpha through Zeta FM', () => {
    const names = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('stubIptvAndGemini returns 404 for non-iptv non-gemini hosts', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://example.com/other');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });
});
