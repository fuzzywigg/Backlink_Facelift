import { describe, expect, it, vi } from 'vitest';
import {
  SAMPLE_M3U,
  buildSimpleM3U,
  countHttpStreamLines,
  curatedGeminiJson,
  geminiTextResponse,
  iptvCategoryUrl,
  mockKV,
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
});
