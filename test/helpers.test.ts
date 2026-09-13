import { describe, expect, it, vi } from 'vitest';
import { parseM3U } from '../src/parser';
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

  it('stubIptvAndGemini invokes gemini factory on every Gemini hit', async () => {
    let hits = 0;
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        hits += 1;
        return geminiTextResponse(`call-${hits}`);
      },
    }) as unknown as (input: string) => Promise<Response>;
    const a = await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
    );
    const b = await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
    );
    expect(hits).toBe(2);
    const textA = (
      (await a.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
    ).candidates[0].content.parts[0].text;
    const textB = (
      (await b.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
    ).candidates[0].content.parts[0].text;
    expect(textA).toBe('call-1');
    expect(textB).toBe('call-2');
  });

  it('stubIptvAndGemini prefers Response gemini over factory semantics when both not mixed', async () => {
    const fixed = geminiTextResponse('fixed');
    const fetchMock = stubIptvAndGemini({ gemini: fixed }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const first = await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
    );
    const second = await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
    );
    expect(
      (
        (await first.json()) as {
          candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
        }
      ).candidates[0].content.parts[0].text,
    ).toBe('fixed');
    // Same Response body can only be consumed once — second read is empty/throws depending on runtime
    await expect(second.json()).rejects.toThrow();
  });

  it('stubIptvAndGemini iptvByGenre empty-string body returns 200 with empty text', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: '' },
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('stubIptvAndGemini non-.m3u iptv-org path still matches host and uses default m3u', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/index.html');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Alpha FM');
  });

  it('stubIptvAndGemini genre regex requires /categories/{slug}.m3u shape', async () => {
    const jazz = buildSimpleM3U([{ name: 'J', url: 'https://example.com/j.m3u8' }]);
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      iptvByGenre: { jazz },
    }) as unknown as (input: string) => Promise<Response>;
    // Missing .m3u → genreMatch fails → falls through to default SAMPLE_M3U
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz');
    const body = await res.text();
    expect(body).toContain('Alpha FM');
    expect(body).not.toContain('tvg-name="J"');
  });

  it('mockKV list ignores seeded keys and always returns empty keys array', async () => {
    const kv = mockKV({ a: '1', b: '2' });
    const listed = await kv.list();
    expect(listed.keys).toEqual([]);
    expect(listed.list_complete).toBe(true);
    expect(listed.cacheStatus).toBeNull();
  });

  it('mockKV getWithMetadata ignores seeded values and returns null value', async () => {
    const kv = mockKV({ present: 'yes' });
    await expect(kv.getWithMetadata('present')).resolves.toEqual({
      value: null,
      metadata: null,
      cacheStatus: null,
    });
  });

  it('mockKV put overwrites and get returns latest string only', async () => {
    const kv = mockKV();
    await kv.put('k', 'v1');
    await kv.put('k', 'v2');
    expect(await kv.get('k')).toBe('v2');
  });

  it('mockKV round-trips unicode and emoji values', async () => {
    const kv = mockKV();
    await kv.put('stations:jazz', '{"name":"Café 🎵"}');
    expect(await kv.get('stations:jazz')).toBe('{"name":"Café 🎵"}');
  });

  it('testEnv default VERSION is 0.1.0-test and GEMINI_API_KEY undefined', () => {
    const env = testEnv();
    expect(env.VERSION).toBe('0.1.0-test');
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.CATALOG_CACHE).toBeTruthy();
  });

  it('testEnv can clear VERSION via override to undefined', () => {
    const env = testEnv({ VERSION: undefined });
    expect(env.VERSION).toBeUndefined();
  });

  it('geminiTextResponse returns ok Response with application/json content-type', async () => {
    const res = geminiTextResponse('x');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('geminiTextResponse preserves empty string and multiline model text', async () => {
    const empty = await geminiTextResponse('').json();
    const multi = await geminiTextResponse('line1\nline2').json();
    expect(
      (empty as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }).candidates[0]
        .content.parts[0].text,
    ).toBe('');
    expect(
      (multi as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }).candidates[0]
        .content.parts[0].text,
    ).toBe('line1\nline2');
  });

  it('curatedGeminiJson preserves multiple stations including logos', async () => {
    const res = curatedGeminiJson([
      {
        name: 'A',
        url: 'https://a',
        editorial: 'ea',
        genre: 'jazz',
        logo: 'https://logo/a.png',
      },
      { name: 'B', url: 'https://b', editorial: 'eb', genre: 'rock' },
    ]);
    const text = (
      (await res.json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      }
    ).candidates[0].content.parts[0].text;
    expect(JSON.parse(text)).toEqual([
      {
        name: 'A',
        url: 'https://a',
        editorial: 'ea',
        genre: 'jazz',
        logo: 'https://logo/a.png',
      },
      { name: 'B', url: 'https://b', editorial: 'eb', genre: 'rock' },
    ]);
  });

  it('iptvCategoryUrl appends .m3u even for empty genre', () => {
    expect(iptvCategoryUrl('')).toBe(
      'https://iptv-org.github.io/iptv/categories/.m3u',
    );
  });

  it('iptvCategoryUrl does not strip query or hash characters from genre', () => {
    expect(iptvCategoryUrl('jazz?x=1')).toBe(
      'https://iptv-org.github.io/iptv/categories/jazz?x=1.m3u',
    );
    expect(iptvCategoryUrl('rock#frag')).toBe(
      'https://iptv-org.github.io/iptv/categories/rock#frag.m3u',
    );
  });

  it('countHttpStreamLines is case-sensitive for scheme (HTTP:// ignored)', () => {
    expect(countHttpStreamLines('HTTP://upper.example/a\nhttps://lower.example/b\n')).toBe(1);
    expect(countHttpStreamLines('Https://mixed.example/c\n')).toBe(0);
  });

  it('countHttpStreamLines counts duplicate identical URLs separately', () => {
    const body = 'https://same.example/x\nhttps://same.example/x\n';
    expect(countHttpStreamLines(body)).toBe(2);
  });

  it('buildSimpleM3U preserves unicode names and special characters in attrs', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Café & Jazz',
        url: 'https://example.com/café.m3u8',
        group: 'Nu Jazz',
        language: 'fr',
        country: 'FR',
        logo: 'https://cdn/café.png',
      },
    ]);
    expect(m3u).toContain('tvg-name="Café & Jazz"');
    expect(m3u).toContain('group-title="Nu Jazz"');
    expect(m3u).toContain('https://example.com/café.m3u8');
    expect(m3u.endsWith('\n')).toBe(true);
  });

  it('buildSimpleM3U emits one EXTINF+URL pair per station in order', () => {
    const m3u = buildSimpleM3U([
      { name: 'One', url: 'https://example.com/1.m3u8' },
      { name: 'Two', url: 'https://example.com/2.m3u8' },
      { name: 'Three', url: 'https://example.com/3.m3u8' },
    ]);
    const lines = m3u.trimEnd().split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines.filter((l) => l.startsWith('#EXTINF'))).toHaveLength(3);
    expect(lines.filter((l) => l.startsWith('https://'))).toEqual([
      'https://example.com/1.m3u8',
      'https://example.com/2.m3u8',
      'https://example.com/3.m3u8',
    ]);
  });

  it('buildSimpleM3U always repeats display name after the comma', () => {
    const m3u = buildSimpleM3U([{ name: 'Echo', url: 'https://example.com/e.m3u8' }]);
    expect(m3u).toMatch(/#EXTINF:-1 tvg-name="Echo",Echo\n/);
  });

  it('seedStationsCache serializes numbers and booleans via JSON.stringify', () => {
    expect(seedStationsCache('n', 42)['stations:n']).toBe('42');
    expect(seedStationsCache('b', true)['stations:b']).toBe('true');
    expect(seedStationsCache('z', null)['stations:z']).toBe('null');
  });

  it('seedStationsCache does not mutate the existing object argument', () => {
    const existing = { keep: '1' };
    const next = seedStationsCache('music', [], existing);
    expect(existing).toEqual({ keep: '1' });
    expect(next).not.toBe(existing);
    expect(next.keep).toBe('1');
    expect(next['stations:music']).toBe('[]');
  });

  it('captureGeminiRequest uppercases lowercase method strings', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'post', body: JSON.stringify({ ok: true }) },
    );
    expect(captureGeminiRequest(fetchMock)!.method).toBe('POST');
  });

  it('captureGeminiRequest treats empty-string body as {}', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'POST', body: '' },
    );
    expect(captureGeminiRequest(fetchMock)!.body).toEqual({});
  });

  it('captureGeminiRequest skips iptv-org calls when finding Gemini', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      gemini: geminiTextResponse('[{"ok":1}]'),
    });
    const call = fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>;
    await call('https://iptv-org.github.io/iptv/categories/music.m3u');
    await call('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k', {
      method: 'POST',
      body: JSON.stringify({ n: 9 }),
    });
    const captured = captureGeminiRequest(fetchMock);
    expect(captured!.url).toContain('generativelanguage.googleapis.com');
    expect(captured!.body).toEqual({ n: 9 });
  });

  it('iptvCallsWithInit returns the full call tuples including init', async () => {
    const fetchMock = vi.fn(async (_input?: string, _init?: RequestInit) => {
      return new Response(SAMPLE_M3U, { status: 200 });
    });
    const init = { method: 'GET', headers: { 'x-a': '1' } };
    await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u', init);
    const hits = iptvCallsWithInit(fetchMock);
    expect(hits).toHaveLength(1);
    expect(hits[0][0]).toContain('iptv-org');
    expect(hits[0][1]).toEqual(init);
  });

  it('iptvCallsWithInit ignores calls where init is explicitly undefined', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => {
      return new Response(SAMPLE_M3U, { status: 200 });
    });
    await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u', undefined);
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('SAMPLE_M3U uses group-title Music and https stream URLs only', () => {
    const groups = [...SAMPLE_M3U.matchAll(/group-title="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(groups)).toEqual(new Set(['Music']));
    expect(SAMPLE_M3U).not.toMatch(/^http:\/\//m);
    expect([...SAMPLE_M3U.matchAll(/^https:\/\/example\.com\/[a-z]+\.m3u8$/gm)]).toHaveLength(6);
  });

  it('SAMPLE_M3U pairs each EXTINF with the following URL line', () => {
    const lines = SAMPLE_M3U.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines[0]).toBe('#EXTM3U');
    for (let i = 1; i < lines.length; i += 2) {
      expect(lines[i].startsWith('#EXTINF')).toBe(true);
      expect(lines[i + 1].startsWith('https://')).toBe(true);
    }
  });

  it('stubIptvAndGemini default gemini path returns 500 boom without opts.gemini', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('boom');
  });

  it('stubIptvAndGemini default m3u is SAMPLE_M3U when opts.m3u omitted', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(await res.text()).toBe(SAMPLE_M3U);
  });

  it('stubIptvAndGemini iptvByGenre own-property check treats inherited keys as miss', async () => {
    const proto = { jazz: buildSimpleM3U([{ name: 'Proto', url: 'https://p' }]) };
    const iptvByGenre = Object.create(proto) as Record<string, string | null>;
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      iptvByGenre,
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(await res.text()).toContain('Alpha FM');
  });

  it('stubIptvAndGemini accepts URL instances for iptv-org hosts', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: RequestInfo | URL,
    ) => Promise<Response>;
    const res = await fetchMock(new URL('https://iptv-org.github.io/iptv/categories/pop.m3u'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Beta FM');
  });

  it('curatedGeminiJson default omits logo key on the station object', async () => {
    const text = (
      (await curatedGeminiJson().json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      }
    ).candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(parsed[0]).not.toHaveProperty('logo');
  });

  it('seedStationsCache key template is always stations:{genre}', () => {
    expect(Object.keys(seedStationsCache('ambient', []))).toEqual(['stations:ambient']);
    expect(Object.keys(seedStationsCache('late night', '[]'))).toEqual(['stations:late night']);
  });

  it('captureGeminiRequest returns null for empty mock.calls', () => {
    expect(captureGeminiRequest({ mock: { calls: [] } })).toBeNull();
  });

  it('iptvCallsWithInit returns empty for empty mock.calls', () => {
    expect(iptvCallsWithInit({ mock: { calls: [] } })).toEqual([]);
  });

  it('mockKV delete after put then re-put works', async () => {
    const kv = mockKV();
    await kv.put('x', '1');
    await kv.delete('x');
    await kv.put('x', '2');
    expect(await kv.get('x')).toBe('2');
  });

  it('buildSimpleM3U does not escape quotes inside names (raw interpolation)', () => {
    const m3u = buildSimpleM3U([{ name: 'A"B', url: 'https://example.com/q.m3u8' }]);
    expect(m3u).toContain('tvg-name="A"B"');
  });

  it('countHttpStreamLines treats whitespace-only lines as non-streams', () => {
    expect(countHttpStreamLines('   \n\t\nhttps://ok\n')).toBe(1);
  });

  it('stubIptvAndGemini generativelanguage substring match is host-agnostic', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse('hit'),
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://evil.example/generativelanguage.googleapis.com/fake');
    expect(res.status).toBe(200);
    expect(
      (
        (await res.json()) as {
          candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
        }
      ).candidates[0].content.parts[0].text,
    ).toBe('hit');
  });

  it('stubIptvAndGemini iptv-org substring match is path-agnostic', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '#EXTM3U\n' }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://cdn.example/mirror/iptv-org/playlist.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('#EXTM3U\n');
  });

  it('testEnv override can set VERSION to empty string', () => {
    expect(testEnv({ VERSION: '' }).VERSION).toBe('');
  });

  it('geminiTextResponse candidates array length is exactly 1', async () => {
    const body = (await geminiTextResponse('t').json()) as {
      candidates: unknown[];
    };
    expect(body.candidates).toHaveLength(1);
  });

  it('buildSimpleM3U header is exactly #EXTM3U then newline', () => {
    expect(buildSimpleM3U([]).startsWith('#EXTM3U\n')).toBe(true);
  });

  it('seedStationsCache with undefined value serializes to undefined JSON omission via stringify', () => {
    // JSON.stringify(undefined) returns undefined (not a string) — helper still assigns it
    const seeded = seedStationsCache('u', undefined);
    expect(seeded['stations:u']).toBeUndefined();
  });

  it('captureGeminiRequest String()s URL object Gemini targets', async () => {
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) => {
      return geminiTextResponse('[]');
    });
    await fetchMock(
      new URL('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k'),
      { method: 'POST', body: '{}' },
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured!.url).toContain('generativelanguage.googleapis.com');
    expect(captured!.method).toBe('POST');
  });

  it('iptvCategoryUrl always uses iptv-org.github.io host and categories path', () => {
    for (const g of ['music', 'jazz', 'news']) {
      expect(iptvCategoryUrl(g)).toMatch(
        /^https:\/\/iptv-org\.github\.io\/iptv\/categories\/.+\.m3u$/,
      );
    }
  });

  it('stubIptvAndGemini with m3u empty string serves empty body at 200', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '' }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('mockKV seed entries are independent copies not live Map aliases of input object', async () => {
    const seed = { a: '1' };
    const kv = mockKV(seed);
    seed.a = 'mutated';
    expect(await kv.get('a')).toBe('1');
  });

  it('buildSimpleM3U round-trips through parseM3U for full attr stations', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Round',
        url: 'https://example.com/round-helper.m3u8',
        logo: 'https://cdn.example/r.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(parseM3U(m3u)).toEqual([
      {
        name: 'Round',
        url: 'https://example.com/round-helper.m3u8',
        logo: 'https://cdn.example/r.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
  });

  it('buildSimpleM3U round-trips through parseM3U for name+url only', () => {
    const m3u = buildSimpleM3U([{ name: 'Bare', url: 'https://example.com/bare-helper.m3u8' }]);
    expect(parseM3U(m3u)[0]).toMatchObject({
      name: 'Bare',
      url: 'https://example.com/bare-helper.m3u8',
    });
    expect(parseM3U(m3u)[0].logo).toBeUndefined();
  });

  it('countHttpStreamLines matches parseM3U length for SAMPLE_M3U', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(parseM3U(SAMPLE_M3U).length);
  });

  it('countHttpStreamLines counts both http and https but parseM3U also accepts both', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'http://example.com/a.m3u8' },
      { name: 'B', url: 'https://example.com/b.m3u8' },
    ]);
    expect(countHttpStreamLines(m3u)).toBe(2);
    expect(parseM3U(m3u)).toHaveLength(2);
  });

  it('countHttpStreamLines ignores rtmp lines that parseM3U also skips', () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="R",R
rtmp://example.com/live
#EXTINF:-1 tvg-name="H",H
https://example.com/h.m3u8
`;
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)).toHaveLength(1);
  });

  it('buildSimpleM3U emits trailing newline after last URL', () => {
    const m3u = buildSimpleM3U([{ name: 'T', url: 'https://example.com/t.m3u8' }]);
    expect(m3u.endsWith('\n')).toBe(true);
    expect(m3u.split('\n').filter(Boolean).at(-1)).toBe('https://example.com/t.m3u8');
  });

  it('buildSimpleM3U with empty stations is header-only parseM3U []', () => {
    expect(parseM3U(buildSimpleM3U([]))).toEqual([]);
  });

  it('buildSimpleM3U preserves empty-string optional attrs for parseM3U', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'E',
        url: 'https://example.com/e-helper.m3u8',
        logo: '',
        group: '',
        language: '',
        country: '',
      },
    ]);
    const [s] = parseM3U(m3u);
    expect(s.logo).toBe('');
    expect(s.group).toBe('');
    expect(s.language).toBe('');
    expect(s.country).toBe('');
  });

  it('countHttpStreamLines does not count http substrings inside tvg-logo', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'L',
        url: 'https://example.com/logo-count.m3u8',
        logo: 'https://cdn.example/a.png',
      },
    ]);
    expect(countHttpStreamLines(m3u)).toBe(1);
  });

  it('SAMPLE_M3U parseM3U names match Alpha..Zeta Greek letter order', () => {
    expect(parseM3U(SAMPLE_M3U).map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('iptvCategoryUrl genre segment is not URL-encoded by the helper', () => {
    expect(iptvCategoryUrl('smooth jazz')).toBe(
      'https://iptv-org.github.io/iptv/categories/smooth jazz.m3u',
    );
  });

  it('seedStationsCache can seed multiple genres without clobbering', () => {
    const a = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    const b = seedStationsCache('news', [{ name: 'N', url: 'https://n' }], a);
    expect(Object.keys(b).sort()).toEqual(['stations:jazz', 'stations:news']);
  });
  it('buildSimpleM3U round-trips through parseM3U for multi-station fixtures', () => {
    const m3u = buildSimpleM3U([
      { name: 'One', url: 'https://example.com/1.m3u8', group: 'G1', language: 'en', country: 'US' },
      { name: 'Two', url: 'https://example.com/2.m3u8', logo: 'https://cdn.example/2.png' },
    ]);
    const stations = parseM3U(m3u);
    expect(stations).toHaveLength(2);
    expect(stations[0]).toMatchObject({ name: 'One', group: 'G1', language: 'en', country: 'US' });
    expect(stations[1]).toMatchObject({ name: 'Two', logo: 'https://cdn.example/2.png' });
  });

  it('iptvCategoryUrl appends .m3u under categories path', () => {
    expect(iptvCategoryUrl('classical')).toBe(
      'https://iptv-org.github.io/iptv/categories/classical.m3u',
    );
  });

  it('countHttpStreamLines counts SAMPLE_M3U as 6', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it('geminiTextResponse wraps text inside candidates[0].content.parts[0].text', async () => {
    const data = (await geminiTextResponse('hello-quad').json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(data.candidates[0].content.parts[0].text).toBe('hello-quad');
  });

  it('curatedGeminiJson produces parseable JSON array text for stubbed Gemini', async () => {
    const data = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const parsed = JSON.parse(data.candidates[0].content.parts[0].text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('mockKV delete removes a previously put key', async () => {
    const kv = mockKV({ 'stations:music': '[]' });
    await kv.delete('stations:music');
    expect(await kv.get('stations:music')).toBeNull();
  });

  it('testEnv default VERSION is 0.1.0-test and can be overridden', () => {
    expect(testEnv().VERSION).toBe('0.1.0-test');
    expect(testEnv({ VERSION: '9.9.9' }).VERSION).toBe('9.9.9');
  });

  it('iptvCallsWithInit is empty when iptv fetches omit init', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: string,
    ) => Promise<Response>;
    await fetchMock(iptvCategoryUrl('jazz'));
    expect(iptvCallsWithInit(fetchMock as unknown as { mock: { calls: unknown[][] } })).toEqual([]);
  });


  it('stubIptvAndGemini accepts URL object inputs for iptv hosts', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: RequestInfo | URL,
    ) => Promise<Response>;
    const res = await fetchMock(new URL(iptvCategoryUrl('jazz')));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Alpha FM');
  });

  it('stubIptvAndGemini Request objects stringify to [object Request] and 404', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse('probe-text'),
    }) as unknown as (input: RequestInfo | URL) => Promise<Response>;
    const res = await fetchMock(
      new Request('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k', {
        method: 'POST',
      }),
    );
    // helpers use String(input); Request → "[object Request]" misses host substrings
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('buildSimpleM3U with empty stations yields header-only playlist', () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
    expect(countHttpStreamLines(buildSimpleM3U([]))).toBe(0);
  });

  it('countHttpStreamLines ignores rtmp and non-trimmed http mid-line', () => {
    const raw = 'rtmp://x\n  https://example.com/a.m3u8\nnot https://example.com/b.m3u8\n';
    expect(countHttpStreamLines(raw)).toBe(1);
  });

  it('seedStationsCache stringifies nested objects under stations:genre', () => {
    const seeded = seedStationsCache('pop', [{ name: 'N', meta: { a: 1 } }]);
    expect(JSON.parse(seeded['stations:pop'])).toEqual([{ name: 'N', meta: { a: 1 } }]);
  });

  it('captureGeminiRequest returns null when only iptv-org was called', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: string,
    ) => Promise<Response>;
    await fetchMock(iptvCategoryUrl('music'));
    expect(captureGeminiRequest(fetchMock as unknown as { mock: { calls: unknown[][] } })).toBeNull();
  });

  it('mockKV list ignores populated store (stub always empty keys)', async () => {
    const kv = mockKV({ 'stations:music': '[]', 'stations:jazz': '[]' });
    const listed = await kv.list();
    expect(listed.keys).toEqual([]);
    expect(listed.list_complete).toBe(true);
  });

  it('geminiTextResponse returns a Response with ok status 200', () => {
    const res = geminiTextResponse('x');
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
  });

  it('curatedGeminiJson custom stations round-trip through JSON.parse of model text', async () => {
    const stations = [
      {
        name: 'Custom FM',
        url: 'https://example.com/custom.m3u8',
        editorial: 'Custom blurb',
        genre: 'jazz',
        logo: 'https://cdn.example/c.png',
      },
    ];
    const data = (await curatedGeminiJson(stations).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(JSON.parse(data.candidates[0].content.parts[0].text)).toEqual(stations);
  });

  it('iptvCategoryUrl preserves characters that are not path-encoded', () => {
    expect(iptvCategoryUrl('jazz&x')).toBe(
      'https://iptv-org.github.io/iptv/categories/jazz&x.m3u',
    );
    expect(iptvCategoryUrl('../x')).toBe(
      'https://iptv-org.github.io/iptv/categories/../x.m3u',
    );
  });

  it('testEnv does not invent GEMINI_API_KEY when omitted', () => {
    expect(testEnv()).not.toHaveProperty('GEMINI_API_KEY');
    expect('GEMINI_API_KEY' in testEnv()).toBe(false);
  });

  it('stubIptvAndGemini returns 404 for non-iptv non-gemini hosts', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://example.com/other');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('iptvCallsWithInit captures second-arg init on iptv fetches', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    await fetchMock(iptvCategoryUrl('rock'), { method: 'GET' });
    const withInit = iptvCallsWithInit(fetchMock as unknown as { mock: { calls: unknown[][] } });
    expect(withInit).toHaveLength(1);
    expect(withInit[0][1]).toEqual({ method: 'GET' });
  });

  it('SAMPLE_M3U pairs each Alpha..Zeta name with a unique https URL', () => {
    const names = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"/g)].map((m) => m[1]);
    const urls = [...SAMPLE_M3U.matchAll(/^https:\/\/.+$/gm)].map((m) => m[0]);
    expect(names).toEqual(['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM']);
    expect(new Set(urls).size).toBe(6);
    expect(urls).toHaveLength(names.length);
  });

  it('seedStationsCache merges without mutating the existing object', () => {
    const existing = { 'stations:music': '[]' };
    const next = seedStationsCache('jazz', [], existing);
    expect(existing).toEqual({ 'stations:music': '[]' });
    expect(next).toEqual({ 'stations:music': '[]', 'stations:jazz': '[]' });
    expect(next).not.toBe(existing);
  });

  it('mockKV getWithMetadata always returns null value regardless of seed', async () => {
    const kv = mockKV({ 'stations:music': '[{"name":"X"}]' });
    await expect(kv.getWithMetadata('stations:music')).resolves.toEqual({
      value: null,
      metadata: null,
      cacheStatus: null,
    });
  });

});
