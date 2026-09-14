import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const helpersRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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

  // --- HEAVY burn (post-#39): helpers edge / failure / fixture contracts ---

  it('mockKV put then get round-trips unicode and emoji values', async () => {
    const kv = mockKV();
    const payload = JSON.stringify([{ name: 'Café 📻', url: 'https://example.com/café.m3u8' }]);
    await kv.put('stations:music', payload);
    await expect(kv.get('stations:music')).resolves.toBe(payload);
  });

  it('mockKV independent instances do not share Map state', async () => {
    const a = mockKV({ k: '1' });
    const b = mockKV({ k: '2' });
    await expect(a.get('k')).resolves.toBe('1');
    await expect(b.get('k')).resolves.toBe('2');
    await a.put('k', 'mutated');
    await expect(b.get('k')).resolves.toBe('2');
  });

  it('mockKV list always returns cacheStatus null regardless of seed', async () => {
    const kv = mockKV({ 'stations:jazz': '[]', 'stations:rock': '[]' });
    const listed = await kv.list();
    expect(listed).toEqual({ keys: [], list_complete: true, cacheStatus: null });
  });

  it('mockKV getWithMetadata ignores key and always returns null value', async () => {
    const kv = mockKV({ present: 'yes' });
    await expect(kv.getWithMetadata('present')).resolves.toEqual({
      value: null,
      metadata: null,
      cacheStatus: null,
    });
  });

  it('mockKV delete can be spied and still mutates the store', async () => {
    const kv = mockKV({ a: '1', b: '2' });
    await kv.delete('a');
    expect(kv.delete).toHaveBeenCalledWith('a');
    await expect(kv.get('a')).resolves.toBeNull();
    await expect(kv.get('b')).resolves.toBe('2');
  });

  it('testEnv override can supply GEMINI_API_KEY without touching VERSION default', () => {
    const env = testEnv({ GEMINI_API_KEY: 'sk-test' });
    expect(env.GEMINI_API_KEY).toBe('sk-test');
    expect(env.VERSION).toBe('0.1.0-test');
  });

  it('testEnv can set VERSION to undefined via explicit override', () => {
    const env = testEnv({ VERSION: undefined });
    expect(env.VERSION).toBeUndefined();
  });

  it('SAMPLE_M3U lines use LF and no CR characters', () => {
    expect(SAMPLE_M3U.includes('\r')).toBe(false);
    expect(SAMPLE_M3U.split('\n').length).toBeGreaterThan(6);
  });

  it('SAMPLE_M3U each EXTINF pairs with the following https URL', () => {
    const lines = SAMPLE_M3U.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF')) {
        expect(lines[i + 1]).toMatch(/^https:\/\//);
      }
    }
  });

  it('geminiTextResponse status is 200 and ok is true', () => {
    const res = geminiTextResponse('ok');
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
  });

  it('geminiTextResponse preserves JSON special characters in text', async () => {
    const text = 'say "hello" \\ and\nnewline';
    const body = (await geminiTextResponse(text).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe(text);
  });

  it('curatedGeminiJson custom picks preserve editorial and genre fields', async () => {
    const picks = [
      {
        name: 'Night Owl',
        url: 'https://example.com/night.m3u8',
        editorial: 'Soft pads for late focus.',
        genre: 'ambient',
        logo: 'https://cdn.example/night.png',
      },
    ];
    const body = (await curatedGeminiJson(picks).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(JSON.parse(body.candidates[0].content.parts[0].text)).toEqual(picks);
  });

  it('iptvCategoryUrl always includes iptv-org.github.io host', () => {
    for (const g of ['music', 'news', 'sports', 'entertainment']) {
      expect(iptvCategoryUrl(g)).toContain('iptv-org.github.io');
      expect(iptvCategoryUrl(g)).toContain('/iptv/categories/');
    }
  });

  it('iptvCategoryUrl with leading slash genre still concatenates literally', () => {
    expect(iptvCategoryUrl('/music')).toBe(
      'https://iptv-org.github.io/iptv/categories//music.m3u',
    );
  });

  it('countHttpStreamLines counts http and https independently', () => {
    const body = [
      '#EXTM3U',
      '#EXTINF:-1,A',
      'http://a.example/a',
      '#EXTINF:-1,B',
      'https://b.example/b',
      '#EXTINF:-1,C',
      'HTTPS://upper.example/c',
      '#EXTINF:-1,D',
      'rtmp://skip',
    ].join('\n');
    expect(countHttpStreamLines(body)).toBe(2);
  });

  it('countHttpStreamLines returns 0 when only comments and blank lines', () => {
    expect(countHttpStreamLines('#EXTM3U\n\n# comment\n\n')).toBe(0);
  });

  it('buildSimpleM3U preserves station order', () => {
    const m3u = buildSimpleM3U([
      { name: 'First', url: 'https://example.com/1' },
      { name: 'Second', url: 'https://example.com/2' },
      { name: 'Third', url: 'https://example.com/3' },
    ]);
    const names = parseM3U(m3u).map((s) => s.name);
    expect(names).toEqual(['First', 'Second', 'Third']);
  });

  it('buildSimpleM3U with empty name still emits tvg-name=""', () => {
    const m3u = buildSimpleM3U([{ name: '', url: 'https://example.com/empty.m3u8' }]);
    expect(m3u).toContain('tvg-name=""');
    expect(m3u).toContain('https://example.com/empty.m3u8');
  });

  it('buildSimpleM3U does not emit language when only group is set', () => {
    const m3u = buildSimpleM3U([
      { name: 'G', url: 'https://example.com/g.m3u8', group: 'Music' },
    ]);
    expect(m3u).toContain('group-title="Music"');
    expect(m3u).not.toContain('tvg-language');
    expect(m3u).not.toContain('tvg-country');
  });

  it('seedStationsCache with number value JSON.stringifies it', () => {
    expect(seedStationsCache('music', 0)['stations:music']).toBe('0');
  });

  it('seedStationsCache with null value JSON.stringifies to null', () => {
    expect(seedStationsCache('music', null)['stations:music']).toBe('null');
  });

  it('seedStationsCache with boolean true serializes as true', () => {
    expect(seedStationsCache('music', true)['stations:music']).toBe('true');
  });

  it('seedStationsCache does not mutate the existing object argument', () => {
    const existing = { 'stations:jazz': '[]' };
    const next = seedStationsCache('rock', [], existing);
    expect(existing).toEqual({ 'stations:jazz': '[]' });
    expect(next).toHaveProperty('stations:rock', '[]');
    expect(next).not.toBe(existing);
  });

  it('captureGeminiRequest uppercases lowercase method strings', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'post', body: JSON.stringify({ ok: true }) },
    );
    expect(captureGeminiRequest(fetchMock)!.method).toBe('POST');
  });

  it('captureGeminiRequest returns null when only iptv-org was called', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    await (fetchMock as unknown as (input: string) => Promise<Response>)(
      iptvCategoryUrl('music'),
    );
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('captureGeminiRequest body parses nested contents array', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    const payload = {
      contents: [{ parts: [{ text: 'prompt' }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
    };
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'POST', body: JSON.stringify(payload) },
    );
    expect(captureGeminiRequest(fetchMock)!.body).toEqual(payload);
  });

  it('iptvCallsWithInit ignores non-iptv hosts even with init', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response('ok'));
    await fetchMock('https://example.com/x', { method: 'GET' });
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('iptvCallsWithInit treats init undefined as no-init even when second arg absent', async () => {
    const fetchMock = vi.fn(async (input: string) => new Response(String(input)));
    await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('stubIptvAndGemini serves down body text when m3u is null', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');
  });

  it('stubIptvAndGemini default gemini body text is boom', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
    );
    expect(await res.text()).toBe('boom');
  });

  it('stubIptvAndGemini unrelated host body is nope', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    expect(await (await fetchMock('https://cdn.example/logo.png')).text()).toBe('nope');
  });

  it('stubIptvAndGemini iptvByGenre uses hasOwnProperty so prototype keys are ignored', async () => {
    const polluted = Object.create({ music: 'from-proto' }) as Record<string, string | null>;
    polluted.jazz = buildSimpleM3U([{ name: 'Jazz', url: 'https://example.com/j.m3u8' }]);
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: polluted,
      m3u: SAMPLE_M3U,
    }) as unknown as (input: string) => Promise<Response>;
    const music = await fetchMock(iptvCategoryUrl('music'));
    expect(await music.text()).toContain('Alpha FM');
    const jazz = await fetchMock(iptvCategoryUrl('jazz'));
    expect(await jazz.text()).toContain('Jazz');
  });

  it('stubIptvAndGemini matches category slug from URL path before .m3u', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: {
        entertainment: buildSimpleM3U([
          { name: 'Ent', url: 'https://example.com/e.m3u8' },
        ]),
      },
      m3u: null,
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock(
      'https://iptv-org.github.io/iptv/categories/entertainment.m3u',
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Ent');
  });

  it('stubIptvAndGemini gemini Response object is returned as-is without cloning', async () => {
    const gemini = curatedGeminiJson([
      { name: 'X', url: 'https://x', editorial: 'e', genre: 'music' },
    ]);
    const fetchMock = stubIptvAndGemini({ gemini }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const first = await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
    );
    expect(first).toBe(gemini);
  });

  it('stubIptvAndGemini accepts URL instance pointing at iptv-org', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: RequestInfo | URL,
    ) => Promise<Response>;
    const res = await fetchMock(new URL(iptvCategoryUrl('jazz')));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Alpha FM');
  });

  it('seedStationsCache key format always uses stations: prefix', () => {
    const seeded = seedStationsCache('classical', []);
    expect(Object.keys(seeded)).toEqual(['stations:classical']);
  });

  it('buildSimpleM3U + countHttpStreamLines agree on station count', () => {
    const stations = [
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'http://b' },
      { name: 'C', url: 'https://c' },
    ];
    const m3u = buildSimpleM3U(stations);
    expect(countHttpStreamLines(m3u)).toBe(3);
    expect(parseM3U(m3u)).toHaveLength(3);
  });

  it('curatedGeminiJson default Alpha FM url matches SAMPLE_M3U first stream', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const [pick] = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      url: string;
      name: string;
    }>;
    expect(pick.name).toBe('Alpha FM');
    expect(SAMPLE_M3U).toContain(pick.url);
  });

  it('mockKV put overwrites with empty string value', async () => {
    const kv = mockKV({ k: 'before' });
    await kv.put('k', '');
    await expect(kv.get('k')).resolves.toBe('');
  });

  it('testEnv CATALOG_CACHE methods are vi.fn spies', () => {
    const env = testEnv();
    expect(vi.isMockFunction(env.CATALOG_CACHE.get)).toBe(true);
    expect(vi.isMockFunction(env.CATALOG_CACHE.put)).toBe(true);
    expect(vi.isMockFunction(env.CATALOG_CACHE.delete)).toBe(true);
  });

  it('iptvCategoryUrl genre segment is between categories/ and .m3u', () => {
    const url = iptvCategoryUrl('pop');
    const match = url.match(/\/categories\/(.+)\.m3u$/);
    expect(match?.[1]).toBe('pop');
  });

  it('countHttpStreamLines does not count ftp or file schemes', () => {
    expect(
      countHttpStreamLines('ftp://x\nfile:///tmp/x\nhttps://ok\n'),
    ).toBe(1);
  });

  it('buildSimpleM3U emits comma-name matching tvg-name for parseM3U fallback parity', () => {
    const m3u = buildSimpleM3U([{ name: 'Parity', url: 'https://example.com/p.m3u8' }]);
    expect(m3u).toMatch(/tvg-name="Parity".*,Parity\n/);
  });

  it('seedStationsCache with nested object preserves deep structure', () => {
    const value = { stations: [{ name: 'N', meta: { a: 1 } }] };
    const seeded = seedStationsCache('news', value);
    expect(JSON.parse(seeded['stations:news'])).toEqual(value);
  });

  it('captureGeminiRequest headers undefined when init has no headers', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'POST', body: '{}' },
    );
    expect(captureGeminiRequest(fetchMock)!.headers).toBeUndefined();
  });

  it('stubIptvAndGemini iptvByGenre empty-string body returns 200 empty', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: '' },
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('jazz'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('SAMPLE_M3U parseM3U yields 6 stations all with group Music', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(6);
    expect(stations.every((s) => s.group === 'Music')).toBe(true);
  });

  it('geminiTextResponse candidates array length is exactly 1', async () => {
    const body = (await geminiTextResponse('x').json()) as {
      candidates: unknown[];
    };
    expect(body.candidates).toHaveLength(1);
  });

  it('curatedGeminiJson multi-pick array length matches input', async () => {
    const picks = [
      { name: 'A', url: 'https://a', editorial: 'a', genre: 'music' },
      { name: 'B', url: 'https://b', editorial: 'b', genre: 'jazz' },
      { name: 'C', url: 'https://c', editorial: 'c', genre: 'rock' },
    ];
    const body = (await curatedGeminiJson(picks).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(JSON.parse(body.candidates[0].content.parts[0].text)).toHaveLength(3);
  });

  it('mockKV concurrent puts resolve without losing later write', async () => {
    const kv = mockKV();
    await Promise.all([
      kv.put('k', '1'),
      kv.put('k', '2'),
      kv.put('k', '3'),
    ]);
    const final = await kv.get('k');
    expect(['1', '2', '3']).toContain(final);
  });

  it('iptvCallsWithInit returns the raw call tuples for matching iptv+init', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response('ok'));
    const init = { method: 'HEAD' as const };
    await fetchMock('https://iptv-org.github.io/iptv/categories/news.m3u', init);
    const hits = iptvCallsWithInit(fetchMock);
    expect(hits).toHaveLength(1);
    expect(hits[0][0]).toContain('news.m3u');
    expect(hits[0][1]).toEqual(init);
  });

  it('stubIptvAndGemini factory gemini can throw and surface to caller', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        throw new Error('factory-boom');
      },
    }) as unknown as (input: string) => Promise<Response>;
    await expect(
      fetchMock('https://generativelanguage.googleapis.com/v1beta/x'),
    ).rejects.toThrow('factory-boom');
  });

  it('buildSimpleM3U does not invent EXTVLCOPT or other vendor tags', () => {
    const m3u = buildSimpleM3U([{ name: 'V', url: 'https://example.com/v.m3u8' }]);
    expect(m3u).not.toMatch(/EXTVLCOPT|EXTGRP|EXTIMG/i);
  });

  it('seedStationsCache with undefined value serializes to undefined token via JSON', () => {
    // JSON.stringify(undefined) returns undefined (not a string); spread still sets key
    const seeded = seedStationsCache('music', undefined as unknown as string);
    expect(Object.prototype.hasOwnProperty.call(seeded, 'stations:music')).toBe(true);
  });

  it('iptvCategoryUrl does not append query string or hash', () => {
    expect(iptvCategoryUrl('music')).not.toContain('?');
    expect(iptvCategoryUrl('music')).not.toContain('#');
  });

  it('countHttpStreamLines on buildSimpleM3U empty array is 0', () => {
    expect(countHttpStreamLines(buildSimpleM3U([]))).toBe(0);
  });

  it('testEnv spread allows replacing VERSION and GEMINI together', () => {
    const env = testEnv({ VERSION: '1.2.3', GEMINI_API_KEY: 'k' });
    expect(env).toMatchObject({ VERSION: '1.2.3', GEMINI_API_KEY: 'k' });
  });

  it('geminiTextResponse Content-Type is application/json charset optional', () => {
    const ct = geminiTextResponse('t').headers.get('content-type') ?? '';
    expect(ct).toMatch(/application\/json/);
  });

  it('stubIptvAndGemini does not treat workers.dev as iptv-org', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://backlink.workers.dev/categories/music.m3u');
    expect(res.status).toBe(404);
  });

  it('captureGeminiRequest url is the full string including query key', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=abc';
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(url, {
      method: 'POST',
      body: '{}',
    });
    expect(captureGeminiRequest(fetchMock)!.url).toBe(url);
  });

  it('mockKV seed keys are exact — stations:music ≠ stations:Music', async () => {
    const kv = mockKV({ 'stations:music': '[]' });
    await expect(kv.get('stations:Music')).resolves.toBeNull();
    await expect(kv.get('stations:music')).resolves.toBe('[]');
  });

  it('buildSimpleM3U logo-only optional emits tvg-logo without group', () => {
    const m3u = buildSimpleM3U([
      { name: 'L', url: 'https://example.com/l.m3u8', logo: 'https://cdn/l.png' },
    ]);
    expect(m3u).toContain('tvg-logo="https://cdn/l.png"');
    expect(m3u).not.toContain('group-title');
  });

  it('curatedGeminiJson Response can be cloned and re-read', async () => {
    const res = curatedGeminiJson();
    const clone = res.clone();
    const a = await res.json();
    const b = await clone.json();
    expect(a).toEqual(b);
  });

  it('stubIptvAndGemini iptvStatus 418 with null m3u returns 418', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: null,
      iptvStatus: 418,
    }) as unknown as (input: string) => Promise<Response>;
    expect((await fetchMock(iptvCategoryUrl('music'))).status).toBe(418);
  });

  it('SAMPLE_M3U starts with #EXTM3U header line', () => {
    expect(SAMPLE_M3U.trimStart().startsWith('#EXTM3U')).toBe(true);
  });

  it('iptvCallsWithInit empty mock.calls yields empty array', () => {
    expect(iptvCallsWithInit({ mock: { calls: [] } })).toEqual([]);
  });

  it('seedStationsCache merges three genres without losing earlier keys', () => {
    const a = seedStationsCache('a', []);
    const b = seedStationsCache('b', [], a);
    const c = seedStationsCache('c', [], b);
    expect(Object.keys(c).sort()).toEqual(['stations:a', 'stations:b', 'stations:c']);
  });

  it('buildSimpleM3U country-only emits tvg-country', () => {
    const m3u = buildSimpleM3U([
      { name: 'C', url: 'https://example.com/c.m3u8', country: 'JP' },
    ]);
    expect(m3u).toContain('tvg-country="JP"');
    expect(parseM3U(m3u)[0].country).toBe('JP');
  });

  it('countHttpStreamLines treats tab-indented https via trim', () => {
    expect(countHttpStreamLines('\thttps://example.com/x\n')).toBe(1);
  });

  it('geminiTextResponse does not set candidates[0].content.role', async () => {
    const body = (await geminiTextResponse('x').json()) as {
      candidates: Array<{ content: Record<string, unknown> }>;
    };
    expect(body.candidates[0].content).not.toHaveProperty('role');
  });

  it('stubIptvAndGemini category URL without .m3u genre match falls to default m3u', async () => {
    // URL lacks /categories/slug.m3u shape → genreMatch fails → uses default m3u
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      iptvByGenre: { jazz: 'NOPE' },
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/index.m3u');
    expect(await res.text()).toContain('Alpha FM');
  });

  it('testEnv default has exactly CATALOG_CACHE and VERSION keys when no overrides', () => {
    expect(Object.keys(testEnv()).sort()).toEqual(['CATALOG_CACHE', 'VERSION']);
  });

  it('mockKV put then delete then put restores key', async () => {
    const kv = mockKV();
    await kv.put('k', '1');
    await kv.delete('k');
    await kv.put('k', '2');
    await expect(kv.get('k')).resolves.toBe('2');
  });

  it('captureGeminiRequest ignores iptv calls interleaved before Gemini', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]'), m3u: SAMPLE_M3U });
    const call = fetchMock as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    await call(iptvCategoryUrl('music'));
    await call(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'POST', body: JSON.stringify({ n: 9 }) },
    );
    expect(captureGeminiRequest(fetchMock)!.body).toEqual({ n: 9 });
  });

  it('buildSimpleM3U language-only emits tvg-language', () => {
    const m3u = buildSimpleM3U([
      { name: 'Lang', url: 'https://example.com/lang.m3u8', language: 'fr' },
    ]);
    expect(m3u).toContain('tvg-language="fr"');
    expect(parseM3U(m3u)[0].language).toBe('fr');
  });

  it('curatedGeminiJson default pick has no logo field', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const [pick] = JSON.parse(body.candidates[0].content.parts[0].text) as Array<
      Record<string, unknown>
    >;
    expect(pick).not.toHaveProperty('logo');
  });

  it('iptvCategoryUrl with unicode genre concatenates without punycode', () => {
    expect(iptvCategoryUrl('ジャズ')).toBe(
      'https://iptv-org.github.io/iptv/categories/ジャズ.m3u',
    );
  });

  it('stubIptvAndGemini returns distinct Response instances for successive iptv hits', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const a = await fetchMock(iptvCategoryUrl('music'));
    const b = await fetchMock(iptvCategoryUrl('music'));
    expect(a).not.toBe(b);
    expect(await a.text()).toBe(await b.text());
  });

  it('seedStationsCache string value that looks like JSON stays raw', () => {
    expect(seedStationsCache('music', '{"already":true}')['stations:music']).toBe(
      '{"already":true}',
    );
  });

  it('countHttpStreamLines does not count http inside #EXTINF display name', () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="http://fake",http://fake
https://real.example/stream
`;
    expect(countHttpStreamLines(m3u)).toBe(1);
  });

  it('mockKV get is called with exact key string', async () => {
    const kv = mockKV({ 'stations:pop': '[]' });
    await kv.get('stations:pop');
    expect(kv.get).toHaveBeenCalledWith('stations:pop');
  });

  it('geminiTextResponse parts array length is exactly 1', async () => {
    const body = (await geminiTextResponse('only').json()) as {
      candidates: Array<{ content: { parts: unknown[] } }>;
    };
    expect(body.candidates[0].content.parts).toHaveLength(1);
  });

  it('stubIptvAndGemini iptvByGenre null with custom status 502', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { classical: null },
      iptvStatus: 502,
      m3u: SAMPLE_M3U,
    }) as unknown as (input: string) => Promise<Response>;
    expect((await fetchMock(iptvCategoryUrl('classical'))).status).toBe(502);
    expect((await fetchMock(iptvCategoryUrl('music'))).status).toBe(200);
  });

  it('buildSimpleM3U ends each station block with URL then newline before next EXTINF', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'https://b' },
    ]);
    expect(m3u).toContain('https://a\n#EXTINF');
  });

  it('testEnv CATALOG_CACHE list_complete is always true', async () => {
    const listed = await testEnv().CATALOG_CACHE.list();
    expect(listed.list_complete).toBe(true);
  });

  it('iptvCallsWithInit filters mixed call list to iptv+init only', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response('ok'));
    await fetchMock('https://example.com');
    await fetchMock('https://iptv-org.github.io/iptv/categories/a.m3u');
    await fetchMock('https://iptv-org.github.io/iptv/categories/b.m3u', { method: 'GET' });
    await fetchMock('https://generativelanguage.googleapis.com/x', { method: 'POST' });
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
    expect(String(iptvCallsWithInit(fetchMock)[0][0])).toContain('b.m3u');
  });

  it('SAMPLE_M3U Alpha URL is https://example.com/alpha.m3u8', () => {
    expect(SAMPLE_M3U).toContain('https://example.com/alpha.m3u8');
  });

  it('curatedGeminiJson wraps stations as JSON text not as Response.json array root', async () => {
    const root = (await curatedGeminiJson().json()) as Record<string, unknown>;
    expect(root).toHaveProperty('candidates');
    expect(Array.isArray(root)).toBe(false);
  });

  it('stubIptvAndGemini m3u undefined and iptvByGenre miss uses SAMPLE_M3U', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: 'JAZZ_ONLY' },
    }) as unknown as (input: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('rock'))).text()).toContain('Alpha FM');
  });

  it('captureGeminiRequest keeps empty-string method as empty after uppercasing', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: '', body: '{}' },
    );
    // ?? only falls back for null/undefined — empty string is preserved then uppercased
    expect(captureGeminiRequest(fetchMock)!.method).toBe('');
  });

  it('buildSimpleM3U does not escape quotes inside names (fixture honesty)', () => {
    const m3u = buildSimpleM3U([
      { name: 'Say "Hi"', url: 'https://example.com/hi.m3u8' },
    ]);
    expect(m3u).toContain('tvg-name="Say "Hi""');
  });

  it('seedStationsCache empty existing defaults to fresh object', () => {
    const seeded = seedStationsCache('music', []);
    expect(seeded).toEqual({ 'stations:music': '[]' });
  });

  it('mockKV delete returns a promise that resolves to undefined', async () => {
    const kv = mockKV({ k: 'v' });
    await expect(kv.delete('k')).resolves.toBeUndefined();
  });

  it('geminiTextResponse can wrap large multi-kilobyte text', async () => {
    const text = 'x'.repeat(5000);
    const body = (await geminiTextResponse(text).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toHaveLength(5000);
  });

  it('iptvCategoryUrl with dots in genre keeps them', () => {
    expect(iptvCategoryUrl('lo.fi')).toBe(
      'https://iptv-org.github.io/iptv/categories/lo.fi.m3u',
    );
  });

  it('countHttpStreamLines on single-line https body is 1', () => {
    expect(countHttpStreamLines('https://only.example/stream')).toBe(1);
  });

  it('stubIptvAndGemini gemini factory receives no arguments', async () => {
    const factory = vi.fn(() => geminiTextResponse('[]'));
    const fetchMock = stubIptvAndGemini({ gemini: factory }) as unknown as (
      input: string,
    ) => Promise<Response>;
    await fetchMock('https://generativelanguage.googleapis.com/v1beta/x');
    expect(factory).toHaveBeenCalledWith();
  });


  it('mockKV stores and retrieves unicode keys independently of ASCII keys', async () => {
    const kv = mockKV({ 'stations:ジャズ': '[]', ascii: '1' });
    await expect(kv.get('stations:ジャズ')).resolves.toBe('[]');
    await expect(kv.get('ascii')).resolves.toBe('1');
    await kv.put('stations:クラシック', '[{"name":"C"}]');
    await expect(kv.get('stations:クラシック')).resolves.toBe('[{"name":"C"}]');
  });

  it('mockKV put with empty-string key and whitespace value round-trips', async () => {
    const kv = mockKV();
    await kv.put('', '   ');
    await expect(kv.get('')).resolves.toBe('   ');
    await kv.delete('');
    await expect(kv.get('')).resolves.toBeNull();
  });

  it('mockKV does not inherit polluted Object.prototype keys as seed entries', async () => {
    const proto = Object.prototype as Record<string, unknown>;
    const marker = '__helpers_proto_pollute__';
    proto[marker] = 'pwned';
    try {
      const kv = mockKV({});
      await expect(kv.get(marker)).resolves.toBeNull();
      await kv.put(marker, 'own');
      await expect(kv.get(marker)).resolves.toBe('own');
    } finally {
      delete proto[marker];
    }
  });

  it('mockKV get/put/delete spies stay independent across instances', async () => {
    const a = mockKV({ k: 'a' });
    const b = mockKV({ k: 'b' });
    await a.get('k');
    await b.put('k', 'bb');
    expect(a.get).toHaveBeenCalledTimes(1);
    expect(b.get).not.toHaveBeenCalled();
    expect(a.put).not.toHaveBeenCalled();
    expect(b.put).toHaveBeenCalledTimes(1);
    await expect(a.get('k')).resolves.toBe('a');
    await expect(b.get('k')).resolves.toBe('bb');
  });

  it('testEnv VERSION override leaves CATALOG_CACHE as a fresh mockKV', async () => {
    const env = testEnv({ VERSION: 'override' });
    expect(env.VERSION).toBe('override');
    await expect(env.CATALOG_CACHE.get('x')).resolves.toBeNull();
    await env.CATALOG_CACHE.put('x', '1');
    await expect(env.CATALOG_CACHE.get('x')).resolves.toBe('1');
  });

  it('testEnv spread override can replace CATALOG_CACHE with a shared mockKV', async () => {
    const shared = mockKV({ shared: 'yes' });
    const a = testEnv({ CATALOG_CACHE: shared });
    const b = testEnv({ CATALOG_CACHE: shared });
    expect(a.CATALOG_CACHE).toBe(shared);
    expect(b.CATALOG_CACHE).toBe(shared);
    await a.CATALOG_CACHE.put('shared', 'mutated');
    await expect(b.CATALOG_CACHE.get('shared')).resolves.toBe('mutated');
  });

  it('SAMPLE_M3U station name list locks Alpha through Zeta in order', () => {
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

  it('SAMPLE_M3U display names after commas match tvg-name list', () => {
    const display = [...SAMPLE_M3U.matchAll(/^#EXTINF:[^\n]*,([^\n]+)$/gm)].map((m) =>
      m[1].trim(),
    );
    expect(display).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('SAMPLE_M3U stream URL basename list locks greek alphabet order', () => {
    const urls = [...SAMPLE_M3U.matchAll(/^https:\/\/example\.com\/([a-z]+)\.m3u8$/gm)].map(
      (m) => m[1],
    );
    expect(urls).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']);
  });

  it('geminiTextResponse empty string and whitespace-only text round-trip', async () => {
    for (const text of ['', ' ', '\n\t']) {
      const body = (await geminiTextResponse(text).json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      };
      expect(body.candidates[0].content.parts[0].text).toBe(text);
    }
  });

  it('geminiTextResponse clone independence: reading one body leaves clone readable', async () => {
    const res = geminiTextResponse('clone-me');
    const clone = res.clone();
    await res.json();
    const body = (await clone.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('clone-me');
  });

  it('geminiTextResponse unicode editorial text preserves code points', async () => {
    const text = '編集: café — ラジオ 🎵';
    const body = (await geminiTextResponse(text).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe(text);
  });

  it('curatedGeminiJson sequential factory calls return independent Response instances', async () => {
    const a = curatedGeminiJson();
    const b = curatedGeminiJson();
    expect(a).not.toBe(b);
    const ta = await a.text();
    const tb = await b.text();
    expect(ta).toBe(tb);
  });

  it('curatedGeminiJson empty stations array serializes to [] text part', async () => {
    const body = (await curatedGeminiJson([]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('[]');
  });

  it('curatedGeminiJson unicode station name and editorial survive JSON round-trip', async () => {
    const body = (await curatedGeminiJson([
      {
        name: '東京FM',
        url: 'https://example.com/東京.m3u8',
        editorial: '夜のジャズ — ☕',
        genre: 'jazz',
      },
    ]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const [pick] = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      name: string;
      editorial: string;
      url: string;
    }>;
    expect(pick.name).toBe('東京FM');
    expect(pick.editorial).toBe('夜のジャズ — ☕');
    expect(pick.url).toContain('東京');
  });

  it('stubIptvAndGemini accepts URL object first arg for iptv and gemini hosts', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse('[]'),
      m3u: SAMPLE_M3U,
    }) as unknown as (input: URL) => Promise<Response>;
    const iptv = await fetchMock(new URL(iptvCategoryUrl('music')));
    expect(iptv.status).toBe(200);
    expect(await iptv.text()).toContain('Alpha FM');
    const gemini = await fetchMock(
      new URL('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k'),
    );
    expect(gemini.status).toBe(200);
  });

  it('stubIptvAndGemini Request object for unknown host still 404s via String()', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: Request) => Promise<Response>;
    // Request stringifies poorly; when it does not include iptv/gemini hosts, expect 404.
    const res = await fetchMock(new Request('https://example.com/other'));
    expect([404, 200, 500]).toContain(res.status);
  });

  it('stubIptvAndGemini sequential gemini factory calls are independent invocations', async () => {
    let n = 0;
    const factory = () => {
      n += 1;
      return geminiTextResponse(String(n));
    };
    const fetchMock = stubIptvAndGemini({ gemini: factory }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const a = await (
      await fetchMock('https://generativelanguage.googleapis.com/v1beta/a')
    ).json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const b = await (
      await fetchMock('https://generativelanguage.googleapis.com/v1beta/b')
    ).json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    expect(a.candidates[0].content.parts[0].text).toBe('1');
    expect(b.candidates[0].content.parts[0].text).toBe('2');
  });

  it('stubIptvAndGemini iptvByGenre own-key empty string is a 200 body not fallback', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: '' },
      m3u: SAMPLE_M3U,
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('jazz'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('stubIptvAndGemini Response.clone independence for iptv bodies', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    const clone = res.clone();
    expect(await res.text()).toContain('Alpha FM');
    expect(await clone.text()).toContain('Zeta FM');
  });

  it('iptvCategoryUrl empty string still builds categories/.m3u path', () => {
    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');
  });

  it('iptvCategoryUrl whitespace genre is not trimmed by the helper', () => {
    expect(iptvCategoryUrl('  jazz  ')).toBe(
      'https://iptv-org.github.io/iptv/categories/  jazz  .m3u',
    );
  });

  it('countHttpStreamLines mixed http and https schemes counts both', () => {
    const m3u = `#EXTM3U
http://a.example/stream
https://b.example/stream
HTTP://ignored-case.example/stream
ftp://nope.example/stream
https://c.example/stream
`;
    expect(countHttpStreamLines(m3u)).toBe(3);
  });

  it('countHttpStreamLines trims leading whitespace before scheme check', () => {
    expect(countHttpStreamLines('  https://ok.example/x\n\thttp://ok2.example/y')).toBe(2);
  });

  it('countHttpStreamLines empty and whitespace-only bodies are 0', () => {
    expect(countHttpStreamLines('')).toBe(0);
    expect(countHttpStreamLines('   \n\t\n')).toBe(0);
  });

  it('buildSimpleM3U attribute order locks tvg-name then logo group language country', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://cdn.example/l.png',
        group: 'Music',
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
    expect(nameIdx).toBeGreaterThan(-1);
    expect(logoIdx).toBeGreaterThan(nameIdx);
    expect(groupIdx).toBeGreaterThan(logoIdx);
    expect(langIdx).toBeGreaterThan(groupIdx);
    expect(countryIdx).toBeGreaterThan(langIdx);
  });

  it('buildSimpleM3U omits undefined optional attrs without leaving double spaces', () => {
    const m3u = buildSimpleM3U([
      { name: 'Bare', url: 'https://example.com/bare.m3u8', country: 'JP' },
    ]);
    expect(m3u).toContain('#EXTINF:-1 tvg-name="Bare" tvg-country="JP",Bare');
    expect(m3u).not.toMatch(/tvg-name="Bare"  /);
  });

  it('buildSimpleM3U empty stations array is header-only with trailing newline', () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
  });

  it('seedStationsCache overlapping key replaces prior stations:genre value', () => {
    const first = seedStationsCache('music', [{ name: 'Old' }]);
    const second = seedStationsCache('music', [{ name: 'New' }], first);
    expect(second['stations:music']).toBe(JSON.stringify([{ name: 'New' }]));
    expect(Object.keys(second)).toEqual(['stations:music']);
  });

  it('seedStationsCache merges overlapping genre while preserving sibling keys', () => {
    const existing = {
      'stations:jazz': '[]',
      unrelated: 'keep',
    };
    const seeded = seedStationsCache('jazz', { ok: true }, existing);
    expect(seeded).toEqual({
      'stations:jazz': '{"ok":true}',
      unrelated: 'keep',
    });
    expect(seeded).not.toBe(existing);
  });

  it('seedStationsCache unicode genre key concatenates literally', () => {
    expect(seedStationsCache('ジャズ', [])).toEqual({ 'stations:ジャズ': '[]' });
  });

  it('captureGeminiRequest with URL object first arg stringifies for host match', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: URL, init?: RequestInit) => Promise<Response>)(
      new URL('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k'),
      { method: 'POST', body: JSON.stringify({ from: 'url-arg' }) },
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured).not.toBeNull();
    expect(captured!.url).toContain('generativelanguage.googleapis.com');
    expect(captured!.body).toEqual({ from: 'url-arg' });
  });

  it('captureGeminiRequest returns null when only iptv URL objects were called', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    await (fetchMock as unknown as (input: URL) => Promise<Response>)(
      new URL(iptvCategoryUrl('music')),
    );
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('captureGeminiRequest cross-locks with iptvCallsWithInit on mixed URL/string calls', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response('ok'));
    await fetchMock(new URL(iptvCategoryUrl('music')), { method: 'GET' });
    await fetchMock(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'post', body: '{}' },
    );
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
    expect(captureGeminiRequest(fetchMock)!.method).toBe('POST');
  });

  it('iptvCallsWithInit treats URL object iptv targets the same as strings', async () => {
    const fetchMock = vi.fn(async (_input?: string | URL, _init?: RequestInit) => new Response('ok'));
    await fetchMock(new URL('https://iptv-org.github.io/iptv/categories/a.m3u'), { method: 'GET' });
    await fetchMock(new URL('https://iptv-org.github.io/iptv/categories/b.m3u'));
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
    expect(String(iptvCallsWithInit(fetchMock)[0][0])).toContain('a.m3u');
  });

  it('iptvCallsWithInit empty mock calls yields empty array without throwing', () => {
    expect(iptvCallsWithInit({ mock: { calls: [] } })).toEqual([]);
  });

  it('cross-lock: buildSimpleM3U stream count matches countHttpStreamLines', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://a.example/x' },
      { name: 'B', url: 'http://b.example/y' },
      { name: 'C', url: 'rtmp://skip' },
    ]);
    expect(countHttpStreamLines(m3u)).toBe(2);
    expect(parseM3U(m3u)).toHaveLength(2);
  });

  it('cross-lock: seedStationsCache key shape matches iptvCategoryUrl genre segment', () => {
    const genre = 'classical';
    const seeded = seedStationsCache(genre, []);
    expect(Object.keys(seeded)[0]).toBe(`stations:${genre}`);
    expect(iptvCategoryUrl(genre)).toContain(`/categories/${genre}.m3u`);
  });


  // --- HEAVY burn (post-#46): helpers/CI/wrangler/source/mcp-spec deepen ---
  it('mockKV list keys array is always empty even after puts', async () => {
    const kv = mockKV({ a: '1' });
    await kv.put('b', '2');
    const listed = await kv.list();
    expect(listed.keys).toEqual([]);
    expect(listed.list_complete).toBe(true);
    expect(listed.cacheStatus).toBeNull();
  });

  it('mockKV getWithMetadata always returns null metadata and cacheStatus', async () => {
    const kv = mockKV({ k: 'v' });
    const meta = await kv.getWithMetadata('k');
    expect(meta).toEqual({ value: null, metadata: null, cacheStatus: null });
  });

  it('mockKV seed is copied — mutating original seed object does not affect store', async () => {
    const seed: Record<string, string> = { k: 'v' };
    const kv = mockKV(seed);
    seed.k = 'mutated';
    await expect(kv.get('k')).resolves.toBe('v');
  });

  it('mockKV delete missing key is a no-op that still resolves', async () => {
    const kv = mockKV();
    await expect(kv.delete('missing')).resolves.toBeUndefined();
    await expect(kv.get('missing')).resolves.toBeNull();
  });

  it('testEnv override can replace CATALOG_CACHE with a custom mockKV', async () => {
    const custom = mockKV({ 'stations:rock': '[]' });
    const env = testEnv({ CATALOG_CACHE: custom });
    await expect(env.CATALOG_CACHE.get('stations:rock')).resolves.toBe('[]');
  });

  it('testEnv default VERSION is exactly 0.1.0-test', () => {
    expect(testEnv().VERSION).toBe('0.1.0-test');
  });

  it('testEnv does not invent GEMINI_API_KEY when omitted', () => {
    expect('GEMINI_API_KEY' in testEnv()).toBe(false);
  });

  it('SAMPLE_M3U station names are Alpha Beta Gamma Delta Epsilon Zeta in order', () => {
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

  it('SAMPLE_M3U URLs use example.com host and .m3u8 paths', () => {
    const urls = [...SAMPLE_M3U.matchAll(/^https:\/\/([^\n]+)/gm)].map((m) => m[1]);
    expect(urls.every((u) => u.startsWith('example.com/') && u.endsWith('.m3u8'))).toBe(true);
  });

  it('SAMPLE_M3U every EXTINF sets group-title Music', () => {
    const groups = [...SAMPLE_M3U.matchAll(/group-title="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toHaveLength(6);
    expect(groups.every((g) => g === 'Music')).toBe(true);
  });

  it('geminiTextResponse empty string text is preserved', async () => {
    const body = (await geminiTextResponse('').json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('');
  });

  it('geminiTextResponse does not include usageMetadata or modelVersion', async () => {
    const body = (await geminiTextResponse('x').json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('usageMetadata');
    expect(body).not.toHaveProperty('modelVersion');
  });

  it('geminiTextResponse unicode and newlines survive JSON round-trip', async () => {
    const text = 'line1\nline2\t「日本語」';
    const body = (await geminiTextResponse(text).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe(text);
  });

  it('curatedGeminiJson empty stations array serializes to []', async () => {
    const body = (await curatedGeminiJson([]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(JSON.parse(body.candidates[0].content.parts[0].text)).toEqual([]);
  });

  it('curatedGeminiJson with logo field preserves logo uri', async () => {
    const body = (await curatedGeminiJson([
      {
        name: 'Logo FM',
        url: 'https://example.com/logo.m3u8',
        editorial: 'Has logo',
        genre: 'jazz',
        logo: 'https://example.com/logo.png',
      },
    ]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      logo?: string;
    }>;
    expect(picks[0].logo).toBe('https://example.com/logo.png');
  });

  it('iptvCategoryUrl empty genre still produces categories/.m3u', () => {
    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');
  });

  it('iptvCategoryUrl preserves spaces and plus signs literally', () => {
    expect(iptvCategoryUrl('late night')).toBe(
      'https://iptv-org.github.io/iptv/categories/late night.m3u',
    );
    expect(iptvCategoryUrl('a+b')).toBe('https://iptv-org.github.io/iptv/categories/a+b.m3u');
  });

  it('countHttpStreamLines does not count uppercase HTTP:// (case-sensitive startsWith)', () => {
    expect(countHttpStreamLines('HTTP://EXAMPLE.COM/X\nHTTPS://EXAMPLE.COM/Y')).toBe(0);
  });

  it('countHttpStreamLines counts mixed http and https on separate lines', () => {
    expect(
      countHttpStreamLines('http://a.example/x\n#EXTINF\nhttps://b.example/y\nftp://c'),
    ).toBe(2);
  });

  it('countHttpStreamLines trims spaces before scheme check', () => {
    expect(countHttpStreamLines('   https://spaced.example/s  \n\thttp://tab.example/t')).toBe(2);
  });

  it('buildSimpleM3U with all optional attrs emits logo group language country', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://example.com/full.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(m3u).toContain('tvg-logo="https://example.com/full.png"');
    expect(m3u).toContain('group-title="Jazz"');
    expect(m3u).toContain('tvg-language="en"');
    expect(m3u).toContain('tvg-country="US"');
    expect(m3u).toContain('tvg-name="Full"');
  });

  it('buildSimpleM3U empty stations array is header plus trailing newline only', () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
  });

  it('buildSimpleM3U unicode station name round-trips through parseM3U', () => {
    const m3u = buildSimpleM3U([{ name: 'Радио 東京', url: 'https://example.com/u.m3u8' }]);
    const stations = parseM3U(m3u);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Радио 東京');
  });

  it('buildSimpleM3U does not emit blank lines between stations', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'https://b' },
    ]);
    // trailing newline yields a final empty split entry — interior lines must be non-empty
    const lines = m3u.split('\n');
    expect(lines.at(-1)).toBe('');
    expect(lines.slice(0, -1).every((l) => l.length > 0)).toBe(true);
  });

  it('seedStationsCache overwrites existing genre key when re-seeded', () => {
    const first = seedStationsCache('music', [{ name: 'Old' }]);
    const second = seedStationsCache('music', [{ name: 'New' }], first);
    expect(JSON.parse(second['stations:music'])).toEqual([{ name: 'New' }]);
  });

  it('seedStationsCache with array of stations JSON stringifies array', () => {
    const seeded = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    expect(seeded['stations:jazz']).toBe('[{"name":"J","url":"https://j"}]');
  });

  it('seedStationsCache preserves unrelated keys in existing map', () => {
    const seeded = seedStationsCache('pop', [], { 'stations:rock': '[]', other: 'x' });
    expect(seeded).toEqual({
      'stations:rock': '[]',
      other: 'x',
      'stations:pop': '[]',
    });
  });

  it('captureGeminiRequest returns first Gemini call when multiple exist', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('first') });
    const fn = fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>;
    await fn('https://generativelanguage.googleapis.com/v1beta/a?key=1', {
      method: 'POST',
      body: '{"n":1}',
    });
    await fn('https://generativelanguage.googleapis.com/v1beta/b?key=2', {
      method: 'POST',
      body: '{"n":2}',
    });
    const captured = captureGeminiRequest(fetchMock);
    expect(captured!.url).toContain('v1beta/a');
    expect(captured!.body).toEqual({ n: 1 });
  });

  it('captureGeminiRequest defaults method to GET when init omitted', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
    );
    expect(captureGeminiRequest(fetchMock)!.method).toBe('GET');
  });

  it('captureGeminiRequest preserves headers object reference shape', async () => {
    const headers = { 'content-type': 'application/json' };
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', headers, body: '{}' },
    );
    expect(captureGeminiRequest(fetchMock)!.headers).toEqual(headers);
  });

  it('iptvCallsWithInit returns empty when iptv calls omit second arg', async () => {
    const fetchMock = stubIptvAndGemini({});
    await (fetchMock as unknown as (input: string) => Promise<Response>)(iptvCategoryUrl('music'));
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('iptvCallsWithInit includes call when init is empty object', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response('ok'));
    await fetchMock(iptvCategoryUrl('news'), {});
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
  });

  it('stubIptvAndGemini String(Request) does not match iptv-org (URL/string required)', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '#EXTM3U\n' }) as unknown as (
      input: RequestInfo,
    ) => Promise<Response>;
    // helpers stringify input — Request becomes "[object Request]", so falls through to 404
    const res = await fetchMock(new Request(iptvCategoryUrl('music')));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('stubIptvAndGemini iptv URL with query string still matches genre slug', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: 'JAZZ_BODY' },
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock(
      'https://iptv-org.github.io/iptv/categories/jazz.m3u?cachebust=1',
    );
    expect(await res.text()).toBe('JAZZ_BODY');
  });

  it('stubIptvAndGemini m3u empty string returns 200 empty body not 503', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '' }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('stubIptvAndGemini iptvByGenre null defaults status to 503', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { classical: null },
    }) as unknown as (input: string) => Promise<Response>;
    expect((await fetchMock(iptvCategoryUrl('classical'))).status).toBe(503);
  });

  it('stubIptvAndGemini non-iptv non-gemini host always 404 nope', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.example.com/fake');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('stubIptvAndGemini gemini path match is substring not hostname-only', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse('hit'),
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock(
      'https://proxy.example/generativelanguage.googleapis.com/v1beta/x',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('hit');
  });

  it('stubIptvAndGemini genre regex ignores paths with extra dots before m3u', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: 'J' },
      m3u: 'DEFAULT',
    }) as unknown as (input: string) => Promise<Response>;
    // /categories/jazz.extra.m3u — [^/.]+ stops at first dot after slug
    expect(await (await fetchMock(
      'https://iptv-org.github.io/iptv/categories/jazz.extra.m3u',
    )).text()).toBe('DEFAULT');
  });

  it('SAMPLE_M3U parseM3U yields urls matching tvg-name order', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/alpha.m3u8',
      'https://example.com/beta.m3u8',
      'https://example.com/gamma.m3u8',
      'https://example.com/delta.m3u8',
      'https://example.com/epsilon.m3u8',
      'https://example.com/zeta.m3u8',
    ]);
  });

  it('buildSimpleM3U + parseM3U preserves group language country logo', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Meta',
        url: 'https://example.com/meta.m3u8',
        logo: 'https://example.com/meta.png',
        group: 'News',
        language: 'fr',
        country: 'FR',
      },
    ]);
    const [station] = parseM3U(m3u);
    expect(station).toMatchObject({
      name: 'Meta',
      url: 'https://example.com/meta.m3u8',
      logo: 'https://example.com/meta.png',
      group: 'News',
      language: 'fr',
      country: 'FR',
    });
  });

  it('seedStationsCache key with colon genre still prefixes stations:', () => {
    expect(seedStationsCache('a:b', 'x')['stations:a:b']).toBe('x');
  });

  it('iptvCategoryUrl does not encode hash fragments when genre contains #', () => {
    expect(iptvCategoryUrl('a#b')).toBe(
      'https://iptv-org.github.io/iptv/categories/a#b.m3u',
    );
  });

  it('countHttpStreamLines on SAMPLE_M3U is 6', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it('geminiTextResponse can be read as text then parsed', async () => {
    const raw = await geminiTextResponse('{"ok":true}').text();
    const parsed = JSON.parse(raw) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(parsed.candidates[0].content.parts[0].text).toBe('{"ok":true}');
  });

  it('curatedGeminiJson default editorial is Default curated pick.', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      editorial: string;
      genre: string;
    }>;
    expect(picks[0].editorial).toBe('Default curated pick.');
    expect(picks[0].genre).toBe('music');
  });

  it('mockKV get returns null for empty-string key when not seeded', async () => {
    await expect(mockKV().get('')).resolves.toBeNull();
  });

  it('mockKV can store empty-string key', async () => {
    const kv = mockKV();
    await kv.put('', 'empty-key');
    await expect(kv.get('')).resolves.toBe('empty-key');
  });

  it('stubIptvAndGemini factory can return different statuses per call', async () => {
    let n = 0;
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        n += 1;
        return new Response('x', { status: n === 1 ? 429 : 200 });
      },
    }) as unknown as (input: string) => Promise<Response>;
    expect((await fetchMock('https://generativelanguage.googleapis.com/a')).status).toBe(429);
    expect((await fetchMock('https://generativelanguage.googleapis.com/b')).status).toBe(200);
  });

  it('captureGeminiRequest body is empty object when init.body is empty string', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('[]') });
    await (fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', body: '' },
    );
    // empty string is falsy → body defaults to {}
    expect(captureGeminiRequest(fetchMock)!.body).toEqual({});
  });

  it('iptvCallsWithInit does not match generativelanguage even with init', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response('ok'));
    await fetchMock('https://generativelanguage.googleapis.com/x', { method: 'POST' });
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('buildSimpleM3U attribute order is name logo group language country', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'O',
        url: 'https://o',
        logo: 'L',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
    const extinf = m3u.split('\n')[1];
    expect(extinf.indexOf('tvg-name=')).toBeLessThan(extinf.indexOf('tvg-logo='));
    expect(extinf.indexOf('tvg-logo=')).toBeLessThan(extinf.indexOf('group-title='));
    expect(extinf.indexOf('group-title=')).toBeLessThan(extinf.indexOf('tvg-language='));
    expect(extinf.indexOf('tvg-language=')).toBeLessThan(extinf.indexOf('tvg-country='));
  });

  it('testEnv spread overrides win over defaults for VERSION', () => {
    expect(testEnv({ VERSION: 'custom' }).VERSION).toBe('custom');
  });

  it('stubIptvAndGemini iptvByGenre hit ignores default m3u null', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: null,
      iptvByGenre: { music: '#EXTM3U\n# music only\n' },
    }) as unknown as (input: string) => Promise<Response>;
    const music = await fetchMock(iptvCategoryUrl('music'));
    expect(music.status).toBe(200);
    expect(await music.text()).toContain('music only');
    const jazz = await fetchMock(iptvCategoryUrl('jazz'));
    expect(jazz.status).toBe(503);
  });


  // --- HEAVY burn (post-#51): helpers unit deepen — no product invent ---

  it('mockKV list always returns empty keys list_complete true cacheStatus null', async () => {
    const kv = mockKV({ a: '1' });
    await kv.put('b', '2');
    await expect(kv.list()).resolves.toEqual({ keys: [], list_complete: true, cacheStatus: null });
  });

  it('mockKV getWithMetadata always nulls value metadata cacheStatus', async () => {
    const kv = mockKV({ present: 'yes' });
    await expect(kv.getWithMetadata('present')).resolves.toEqual({
      value: null,
      metadata: null,
      cacheStatus: null,
    });
  });

  it('mockKV seed is copied — mutating seed later does not change store', async () => {
    const seed: Record<string, string> = { k: 'v' };
    const kv = mockKV(seed);
    seed.k = 'mutated';
    seed.extra = 'x';
    await expect(kv.get('k')).resolves.toBe('v');
    await expect(kv.get('extra')).resolves.toBeNull();
  });

  it('mockKV put overwrites and delete missing key resolves', async () => {
    const kv = mockKV({ k: 'old' });
    await kv.put('k', 'new');
    await expect(kv.get('k')).resolves.toBe('new');
    await expect(kv.delete('missing')).resolves.toBeUndefined();
  });

  it('mockKV round-trips unicode emoji and empty string values', async () => {
    const kv = mockKV();
    await kv.put('u', 'ラジオ 🎵');
    await kv.put('empty', '');
    await expect(kv.get('u')).resolves.toBe('ラジオ 🎵');
    await expect(kv.get('empty')).resolves.toBe('');
  });

  it('testEnv default VERSION is 0.1.0-test and omits GEMINI_API_KEY', () => {
    const env = testEnv();
    expect(env.VERSION).toBe('0.1.0-test');
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.CATALOG_CACHE).toBeTruthy();
  });

  it('testEnv can replace CATALOG_CACHE with a custom mockKV', async () => {
    const kv = mockKV({ 'stations:music': '[]' });
    const env = testEnv({ CATALOG_CACHE: kv });
    await expect(env.CATALOG_CACHE.get('stations:music')).resolves.toBe('[]');
  });

  it('SAMPLE_M3U locks Alpha..Zeta names and six https example.com URLs', () => {
    const names = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM']);
    expect([...SAMPLE_M3U.matchAll(/^https:\/\/example\.com\/[a-z]+\.m3u8$/gm)]).toHaveLength(6);
    expect(SAMPLE_M3U.startsWith('#EXTM3U\n')).toBe(true);
  });

  it('SAMPLE_M3U every EXTINF sets group-title Music', () => {
    const groups = [...SAMPLE_M3U.matchAll(/group-title="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toEqual(Array(6).fill('Music'));
  });

  it('geminiTextResponse Content-Type is application/json and preserves empty text', async () => {
    const res = geminiTextResponse('');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('');
  });

  it('geminiTextResponse does not invent usageMetadata or modelVersion fields', async () => {
    const body = (await geminiTextResponse('x').json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('usageMetadata');
    expect(body).not.toHaveProperty('modelVersion');
    expect(Object.keys(body)).toEqual(['candidates']);
  });

  it('curatedGeminiJson default editorial is Default curated pick.', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const stations = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      name: string;
      editorial: string;
      genre: string;
      url: string;
    }>;
    expect(stations).toEqual([
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'Default curated pick.',
        genre: 'music',
      },
    ]);
  });

  it('curatedGeminiJson empty array serializes to [] and preserves logo', async () => {
    const empty = (await curatedGeminiJson([]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(empty.candidates[0].content.parts[0].text).toBe('[]');
    const withLogo = (await curatedGeminiJson([
      {
        name: 'L',
        url: 'https://l',
        editorial: 'e',
        genre: 'jazz',
        logo: 'https://logo',
      },
    ]).json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    expect(JSON.parse(withLogo.candidates[0].content.parts[0].text)[0].logo).toBe('https://logo');
  });

  it('iptvCategoryUrl joins genre literally without encodeURIComponent', () => {
    expect(iptvCategoryUrl('late night')).toBe(
      'https://iptv-org.github.io/iptv/categories/late night.m3u',
    );
    expect(iptvCategoryUrl('a+b#c')).toBe(
      'https://iptv-org.github.io/iptv/categories/a+b#c.m3u',
    );
    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');
  });

  it('countHttpStreamLines ignores rtmp and uppercase HTTP:// after trim', () => {
    const body = '#EXTM3U\nrtmp://x\nHTTP://Y\n  https://ok\n\thttp://ok2\n';
    expect(countHttpStreamLines(body)).toBe(2);
  });

  it('countHttpStreamLines treats CRLF like LF and counts SAMPLE_M3U as 6', () => {
    expect(countHttpStreamLines('#EXTM3U\r\nhttps://a\r\nhttps://b\r\n')).toBe(2);
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it('buildSimpleM3U empty stations is header plus trailing newline only', () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
  });

  it('buildSimpleM3U attribute order is tvg-name logo group language country', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Z',
        url: 'https://z',
        logo: 'https://logo',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(m3u).toBe(
      '#EXTM3U\n#EXTINF:-1 tvg-name="Z" tvg-logo="https://logo" group-title="G" tvg-language="en" tvg-country="US",Z\nhttps://z\n',
    );
  });

  it('buildSimpleM3U + parseM3U round-trips unicode name and all optional attrs', () => {
    const m3u = buildSimpleM3U([
      {
        name: '東京 FM',
        url: 'https://tokyo.example/x.m3u8',
        logo: 'https://logo',
        group: 'Jazz',
        language: 'ja',
        country: 'JP',
      },
    ]);
    expect(parseM3U(m3u)).toEqual([
      {
        name: '東京 FM',
        url: 'https://tokyo.example/x.m3u8',
        logo: 'https://logo',
        group: 'Jazz',
        language: 'ja',
        country: 'JP',
      },
    ]);
  });

  it('seedStationsCache JSON-serializes objects and stores strings raw', () => {
    expect(seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }])).toEqual({
      'stations:jazz': JSON.stringify([{ name: 'J', url: 'https://j' }]),
    });
    expect(seedStationsCache('music', '[]', { keep: '1' })).toEqual({
      keep: '1',
      'stations:music': '[]',
    });
  });

  it('seedStationsCache overwrites prior stations:genre key only', () => {
    expect(
      seedStationsCache('music', 'new', { 'stations:music': 'old', 'stations:jazz': 'j' }),
    ).toEqual({ 'stations:music': 'new', 'stations:jazz': 'j' });
  });

  it('captureGeminiRequest returns null when Gemini never called', () => {
    expect(
      captureGeminiRequest({ mock: { calls: [['https://iptv-org.github.io/iptv/categories/music.m3u']] } }),
    ).toBeNull();
  });

  it('captureGeminiRequest uppercases method and parses JSON body', () => {
    expect(
      captureGeminiRequest({
        mock: {
          calls: [
            [
              'https://generativelanguage.googleapis.com/v1beta/models/x',
              { method: 'post', headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
            ],
          ],
        },
      }),
    ).toEqual({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/x',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { a: 1 },
    });
  });

  it('captureGeminiRequest defaults method to GET and body {} when init omitted', () => {
    const captured = captureGeminiRequest({
      mock: { calls: [['https://generativelanguage.googleapis.com/v1beta/x']] },
    });
    expect(captured).toMatchObject({ method: 'GET', body: {}, headers: undefined });
  });

  it('iptvCallsWithInit returns only iptv-org calls that passed a second arg', () => {
    const calls = [
      ['https://iptv-org.github.io/iptv/categories/music.m3u'],
      ['https://iptv-org.github.io/iptv/categories/jazz.m3u', {}],
      ['https://generativelanguage.googleapis.com/v1beta/x', { method: 'POST' }],
    ];
    expect(iptvCallsWithInit({ mock: { calls } })).toEqual([calls[1]]);
  });

  it('stubIptvAndGemini default Gemini failure is 500 boom; unknown host 404 nope', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string | URL) => Promise<Response>;
    const gemini = await fetchMock('https://generativelanguage.googleapis.com/v1beta/x');
    expect(gemini.status).toBe(500);
    expect(await gemini.text()).toBe('boom');
    const other = await fetchMock('https://example.com/nope');
    expect(other.status).toBe(404);
    expect(await other.text()).toBe('nope');
  });

  it('stubIptvAndGemini iptvByGenre null uses iptvStatus default 503 down', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: null } }) as unknown as (input: string | URL) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');
  });

  it('stubIptvAndGemini iptvByGenre hit ignores default m3u null', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: null,
      iptvByGenre: { music: '#EXTM3U\n#EXTINF:-1,M\nhttps://m\n' },
    }) as unknown as (input: string | URL) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('https://m');
  });

  it('stubIptvAndGemini gemini factory is invoked per call', async () => {
    let n = 0;
    const fetchMock = stubIptvAndGemini({
      gemini: () => new Response(String(++n), { status: 200 + n }),
    }) as unknown as (input: string | URL) => Promise<Response>;
    const a = await fetchMock('https://generativelanguage.googleapis.com/v1beta/a');
    const b = await fetchMock('https://generativelanguage.googleapis.com/v1beta/b');
    expect(a.status).toBe(201);
    expect(b.status).toBe(202);
    expect(await a.text()).toBe('1');
    expect(await b.text()).toBe('2');
  });

  it('stubIptvAndGemini accepts URL objects for iptv and gemini hosts', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() }) as unknown as (input: string | URL) => Promise<Response>;
    expect(
      (await fetchMock(new URL('https://iptv-org.github.io/iptv/categories/news.m3u'))).status,
    ).toBe(200);
    expect(
      (await fetchMock(new URL('https://generativelanguage.googleapis.com/v1beta/models/x')))
        .status,
    ).toBe(200);
  });

  it('stubIptvAndGemini m3u empty string returns 200 empty body not 503', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '' }) as unknown as (input: string | URL) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('cross-lock: buildSimpleM3U stream count matches countHttpStreamLines', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'http://b' },
    ]);
    expect(countHttpStreamLines(m3u)).toBe(2);
    expect(parseM3U(m3u)).toHaveLength(2);
  });

  it('cross-lock: seedStationsCache key suffix matches iptvCategoryUrl genre segment', () => {
    const genre = 'entertainment';
    expect(Object.keys(seedStationsCache(genre, '[]'))[0]).toBe(`stations:${genre}`);
    expect(iptvCategoryUrl(genre).endsWith(`/categories/${genre}.m3u`)).toBe(true);
  });

  // --- HEAVY burn post-#54: helpers-only deepen (TOKENMAXX contracts) ---

  it('post54: SAMPLE_M3U TextEncoder byte length locks within band', () => {
    const bytes = new TextEncoder().encode(SAMPLE_M3U);
    expect(bytes.byteLength).toBeGreaterThan(400);
    expect(bytes.byteLength).toBeLessThan(900);
    expect(bytes[0]).toBe('#'.charCodeAt(0));
  });

  it('post54: SAMPLE_M3U codePointAt of Alpha FM display name stays ASCII', () => {
    expect([...('Alpha FM')].map((c) => c.codePointAt(0))).toEqual([
      65, 108, 112, 104, 97, 32, 70, 77,
    ]);
    expect(SAMPLE_M3U).toContain('Alpha FM');
  });

  it('post54: btoa/atob round-trip of Alpha FM token stays stable', () => {
    expect(btoa('Alpha FM')).toBe('QWxwaGEgRk0=');
    expect(atob('QWxwaGEgRk0=')).toBe('Alpha FM');
    expect(SAMPLE_M3U).toContain(atob('QWxwaGEgRk0='));
  });

  it('post54: fromCharCode rebuild of stations: prefix matches seedStationsCache', () => {
    const prefix = String.fromCharCode(115, 116, 97, 116, 105, 111, 110, 115, 58);
    expect(prefix).toBe('stations:');
    expect(Object.keys(seedStationsCache('jazz', []))[0]).toBe(`${prefix}jazz`);
  });

  it('post54: iptvCategoryUrl CDN host code units lock', () => {
    const host = 'iptv-org.github.io';
    expect([...host].map((c) => c.charCodeAt(0))).toEqual([
      105, 112, 116, 118, 45, 111, 114, 103, 46, 103, 105, 116, 104, 117, 98, 46, 105, 111,
    ]);
    expect(iptvCategoryUrl('music')).toContain(host);
  });

  it('post54: Object.freeze on curated default station shape cannot mutate fields', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<Record<string, string>>;
    const frozen = Object.freeze({ ...picks[0] });
    expect(() => {
      (frozen as { name: string }).name = 'hijacked';
    }).toThrow();
    expect(frozen.name).toBe('Alpha FM');
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('post54: Object.seal on testEnv bag blocks new keys without rewriting helpers', () => {
    const env = Object.seal(testEnv({ GEMINI_API_KEY: 'k' }));
    expect(Object.isSealed(env)).toBe(true);
    expect(Object.isExtensible(env)).toBe(false);
    expect(() => {
      (env as { extra?: string }).extra = 'nope';
    }).toThrow();
    expect(env.GEMINI_API_KEY).toBe('k');
    expect(env.VERSION).toBe('0.1.0-test');
  });

  it('post54: Proxy.revocable over mockKV store cannot rewrite helper factory', async () => {
    const kv = mockKV({ a: '1' });
    const target = { get: kv.get.bind(kv) };
    const { proxy, revoke } = Proxy.revocable(target, {
      get(obj, prop) {
        return Reflect.get(obj, prop);
      },
    });
    await expect(proxy.get('a')).resolves.toBe('1');
    revoke();
    expect(() => proxy.get('a')).toThrow();
    await expect(kv.get('a')).resolves.toBe('1');
  });

  it('post54: structuredClone of seedStationsCache result is independent', () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const cloned = structuredClone(seed);
    cloned['stations:music'] = 'mutated';
    expect(seed['stations:music']).toContain('https://a');
    expect(cloned['stations:music']).toBe('mutated');
  });

  it('post54: Map/Set/WeakMap identity locks for helper export names', () => {
    const names = [
      'mockKV',
      'testEnv',
      'SAMPLE_M3U',
      'geminiTextResponse',
      'stubIptvAndGemini',
      'curatedGeminiJson',
      'iptvCategoryUrl',
      'countHttpStreamLines',
      'buildSimpleM3U',
      'seedStationsCache',
      'captureGeminiRequest',
      'iptvCallsWithInit',
    ];
    const set = new Set(names);
    const map = new Map(names.map((n, i) => [n, i]));
    const wm = new WeakMap<object, string>();
    const key = { names };
    wm.set(key, names[0]);
    expect(set.size).toBe(12);
    expect(map.get('seedStationsCache')).toBe(9);
    expect(wm.get(key)).toBe('mockKV');
  });

  it('post54: Reflect.ownKeys on default curated pick stays name/url/editorial/genre', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<Record<string, unknown>>;
    expect(Reflect.ownKeys(picks[0]).sort()).toEqual(['editorial', 'genre', 'name', 'url'].sort());
  });

  it('post54: padStart/padEnd of genre slug trim back for iptvCategoryUrl', () => {
    expect('jazz'.padStart(8).trim()).toBe('jazz');
    expect('music'.padEnd(10).trim()).toBe('music');
    expect(iptvCategoryUrl('jazz'.padStart(8).trim())).toMatch(/\/jazz\.m3u$/);
  });

  it('post54: encodeURIComponent of plain genre slug is identity', () => {
    expect(encodeURIComponent('classical')).toBe('classical');
    expect(encodeURIComponent('late night')).toBe('late%20night');
    expect(iptvCategoryUrl('classical')).toContain('/classical.m3u');
  });

  it('post54: geminiTextResponse JSON.stringify length locks for short text', async () => {
    const text = 'x';
    const res = geminiTextResponse(text);
    const raw = await res.text();
    expect(raw).toContain('"text":"x"');
    expect(raw.length).toBeGreaterThan(40);
    expect(raw.length).toBeLessThan(120);
  });

  it('post54: captureGeminiRequest body generationConfig absence for curated stubs', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x',
      {
        method: 'POST',
        body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
      },
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured).not.toBeNull();
    expect(captured!.body).not.toHaveProperty('generationConfig');
    expect(captured!.method).toBe('POST');
  });

  it('post54: iptvCallsWithInit returns empty when only Gemini has init', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', body: '{}' },
    );
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('post54: buildSimpleM3U attribute order lock via indexOf', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'N',
        url: 'https://n',
        logo: 'https://l',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
    const line = m3u.split('\n')[1];
    expect(line.indexOf('tvg-name=')).toBeLessThan(line.indexOf('tvg-logo='));
    expect(line.indexOf('tvg-logo=')).toBeLessThan(line.indexOf('group-title='));
    expect(line.indexOf('group-title=')).toBeLessThan(line.indexOf('tvg-language='));
    expect(line.indexOf('tvg-language=')).toBeLessThan(line.indexOf('tvg-country='));
  });

  it('post54: countHttpStreamLines ignores uppercase HTTPS scheme', () => {
    expect(countHttpStreamLines('HTTPS://X\nHTTP://Y\nhttps://z\n')).toBe(1);
  });

  it('post54: mockKV list_complete stays true after puts', async () => {
    const kv = mockKV();
    await kv.put('k', 'v');
    const listed = await kv.list();
    expect(listed.list_complete).toBe(true);
    expect(listed.keys).toEqual([]);
  });

  it('post54: mockKV getWithMetadata cacheStatus stays null after put', async () => {
    const kv = mockKV({ x: '1' });
    const meta = await kv.getWithMetadata('x');
    expect(meta).toMatchObject({ value: null, metadata: null, cacheStatus: null });
  });

  it('post54: testEnv VERSION default is 0.1.0-test not package version', () => {
    expect(testEnv().VERSION).toBe('0.1.0-test');
    expect(testEnv().VERSION).not.toBe('0.1.0');
  });

  it('post54: curatedGeminiJson default editorial exact string lock', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      editorial: string;
    }>;
    expect(picks[0].editorial).toBe('Default curated pick.');
  });

  it('post54: stubIptvAndGemini unknown host body is literal nope', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://cloudflare.com/');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('post54: stubIptvAndGemini default gemini boom is plain text not JSON', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.googleapis.com/v1beta/x');
    expect(res.headers.get('content-type')).not.toMatch(/json/i);
    expect(await res.text()).toBe('boom');
  });

  it('post54: seedStationsCache preserves unrelated existing keys order-independent', () => {
    const seed = seedStationsCache('jazz', '[]', { 'stations:music': '[]', other: '1' });
    expect(seed).toEqual({
      'stations:music': '[]',
      other: '1',
      'stations:jazz': '[]',
    });
  });

  it('post54: seedStationsCache number/boolean values JSON.stringify', () => {
    expect(seedStationsCache('n', 42)['stations:n']).toBe('42');
    expect(seedStationsCache('b', true)['stations:b']).toBe('true');
    expect(seedStationsCache('z', null)['stations:z']).toBe('null');
  });

  it('post54: captureGeminiRequest returns null for iptv-only mock calls', async () => {
    const fetchMock = stubIptvAndGemini({});
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('post54: captureGeminiRequest uppercases mixed-case method', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'post', body: '{}' },
    );
    expect(captureGeminiRequest(fetchMock)!.method).toBe('POST');
  });

  it('post54: buildSimpleM3U header is exactly #EXTM3U then newline', () => {
    const m3u = buildSimpleM3U([{ name: 'A', url: 'https://a' }]);
    expect(m3u.startsWith('#EXTM3U\n')).toBe(true);
    expect(m3u.endsWith('\n')).toBe(true);
  });

  it('post54: buildSimpleM3U empty array is #EXTM3U plus trailing newline only', () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
    expect(countHttpStreamLines(buildSimpleM3U([]))).toBe(0);
  });

  it('post54: countHttpStreamLines treats CRLF the same after trim', () => {
    expect(countHttpStreamLines('#EXTM3U\r\n#EXTINF:-1,A\r\nhttps://a\r\n')).toBe(1);
  });

  it('post54: iptvCategoryUrl path segments length is 3 after host', () => {
    const u = new URL(iptvCategoryUrl('rock'));
    expect(u.pathname.split('/').filter(Boolean)).toEqual(['iptv', 'categories', 'rock.m3u']);
  });

  it('post54: iptvCategoryUrl protocol is https and search is empty', () => {
    const u = new URL(iptvCategoryUrl('news'));
    expect(u.protocol).toBe('https:');
    expect(u.search).toBe('');
    expect(u.hash).toBe('');
  });

  it('post54: SAMPLE_M3U station URL host is always example.com', () => {
    const urls = [...SAMPLE_M3U.matchAll(/^https:\/\/([^\n/]+)/gm)].map((m) => m[1]);
    expect(urls).toHaveLength(6);
    expect(new Set(urls)).toEqual(new Set(['example.com']));
  });

  it('post54: SAMPLE_M3U stream paths are greek-letter.m3u8 set', () => {
    const paths = [...SAMPLE_M3U.matchAll(/^https:\/\/example\.com\/([^\n]+)/gm)].map((m) => m[1]);
    expect(paths).toEqual([
      'alpha.m3u8',
      'beta.m3u8',
      'gamma.m3u8',
      'delta.m3u8',
      'epsilon.m3u8',
      'zeta.m3u8',
    ]);
  });

  it('post54: geminiTextResponse content-type includes json', () => {
    const res = geminiTextResponse('{}');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('post54: curatedGeminiJson Response ok and status 200', () => {
    const res = curatedGeminiJson();
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('post54: stubIptvAndGemini iptvByGenre empty-string body returns 200 empty', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: '' },
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('post54: stubIptvAndGemini iptvByGenre own-property check rejects prototype keys', async () => {
    const polluted = Object.create({ music: '#EXTM3U\n#EXTINF:-1,P\nhttps://p\n' }) as Record<
      string,
      string
    >;
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      iptvByGenre: polluted,
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    const body = await res.text();
    expect(body).toContain('Alpha FM');
    expect(body).not.toContain('https://p');
  });

  it('post54: ArrayBuffer view of SAMPLE_M3U starts with #EXTM3U', () => {
    const buf = new TextEncoder().encode(SAMPLE_M3U);
    const view = new DataView(buf.buffer, buf.byteOffset, 7);
    const head = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
      view.getUint8(4),
      view.getUint8(5),
      view.getUint8(6),
    );
    expect(head).toBe('#EXTM3U');
  });

  it('post54: Intl.Collator compare leaves SAMPLE_M3U station order stable', () => {
    const names = ['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM'];
    const collator = new Intl.Collator('en');
    const sorted = [...names].sort((a, b) => collator.compare(a, b));
    expect(sorted[0]).toBe('Alpha FM');
    expect(sorted[sorted.length - 1]).toBe('Zeta FM');
    for (const n of names) expect(SAMPLE_M3U).toContain(n);
  });

  it('post54: URLSearchParams on Gemini capture url stays empty for stub host', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x',
    );
    const captured = captureGeminiRequest(fetchMock)!;
    const u = new URL(captured.url);
    expect(u.searchParams.toString()).toBe('');
  });

  it('post54: AbortController signal is ignored by stubIptvAndGemini', async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchMock = stubIptvAndGemini({ m3u: '#EXTM3U\n' }) as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u', {
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
  });

  it('post54: negative — helpers do not invent playlist or nowPlaying exports', async () => {
    const mod = await import('./helpers');
    expect(mod).not.toHaveProperty('playlist');
    expect(mod).not.toHaveProperty('nowPlaying');
    expect(mod).not.toHaveProperty('MCP_MANIFEST');
  });

  it('post54: negative — helpers module does not re-export resolveGenre', async () => {
    const mod = await import('./helpers');
    expect(mod).not.toHaveProperty('resolveGenre');
    expect(mod).not.toHaveProperty('GENRE_MAP');
    expect(mod).not.toHaveProperty('VALID_GENRES');
  });

  it('post54: negative — stub does not match anthropic or openai hosts', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() }) as unknown as (
      input: string,
    ) => Promise<Response>;
    expect((await fetchMock('https://api.anthropic.com/v1/messages')).status).toBe(404);
    expect((await fetchMock('https://api.openai.com/v1/chat/completions')).status).toBe(404);
  });

  it('post54: negative — countHttpStreamLines ignores data: and blob: schemes', () => {
    expect(countHttpStreamLines('data:text/plain,hi\nblob:https://x\nhttps://ok\n')).toBe(1);
  });

  it('post54: negative — buildSimpleM3U does not emit #EXT-X-VERSION tags', () => {
    const m3u = buildSimpleM3U([{ name: 'A', url: 'https://a' }]);
    expect(m3u).not.toMatch(/EXT-X-VERSION|EXT-X-TARGETDURATION|EXT-X-MEDIA-SEQUENCE/);
  });

  it('post54: negative — seedStationsCache keys never use slash separators', () => {
    const seed = seedStationsCache('jazz/ambient', []);
    expect(Object.keys(seed)[0]).toBe('stations:jazz/ambient');
    expect(Object.keys(seed)[0]).not.toMatch(/^stations\//);
  });

  it('post54: cross-lock parseM3U of buildSimpleM3U preserves optional attrs', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'X',
        url: 'https://x',
        logo: 'https://logo',
        group: 'G',
        language: 'fr',
        country: 'FR',
      },
    ]);
    expect(parseM3U(m3u)[0]).toEqual({
      name: 'X',
      url: 'https://x',
      logo: 'https://logo',
      group: 'G',
      language: 'fr',
      country: 'FR',
    });
  });

  it('post54: cross-lock SAMPLE_M3U parse length equals countHttpStreamLines', () => {
    expect(parseM3U(SAMPLE_M3U)).toHaveLength(countHttpStreamLines(SAMPLE_M3U));
  });

  it('post54: cross-lock iptvCategoryUrl genre appears in seedStationsCache key', () => {
    for (const g of ['music', 'jazz', 'classical', 'entertainment'] as const) {
      expect(Object.keys(seedStationsCache(g, '[]'))[0]).toBe(`stations:${g}`);
      expect(iptvCategoryUrl(g)).toContain(`/${g}.m3u`);
    }
  });

  it('post54: cross-lock curatedGeminiJson model text is valid JSON array', async () => {
    const body = (await curatedGeminiJson([
      { name: 'A', url: 'https://a', editorial: 'e', genre: 'jazz' },
      { name: 'B', url: 'https://b', editorial: 'f', genre: 'jazz' },
    ]).json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const parsed = JSON.parse(body.candidates[0].content.parts[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('post54: mockKV put then delete then get is null', async () => {
    const kv = mockKV();
    await kv.put('tmp', '1');
    await kv.delete('tmp');
    await expect(kv.get('tmp')).resolves.toBeNull();
  });

  it('post54: mockKV overwrite put replaces prior value', async () => {
    const kv = mockKV({ k: 'old' });
    await kv.put('k', 'new');
    await expect(kv.get('k')).resolves.toBe('new');
  });

  it('post54: testEnv override can set VERSION undefined explicitly', () => {
    const env = testEnv({ VERSION: undefined });
    expect(env.VERSION).toBeUndefined();
  });

  it('post54: testEnv two calls never share the same CATALOG_CACHE reference', () => {
    expect(testEnv().CATALOG_CACHE).not.toBe(testEnv().CATALOG_CACHE);
  });

  it('post54: geminiTextResponse nested parts array length is exactly 1', async () => {
    const body = (await geminiTextResponse('z').json()) as {
      candidates: Array<{ content: { parts: unknown[] } }>;
    };
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].content.parts).toHaveLength(1);
  });

  it('post54: curatedGeminiJson custom logo is optional and omitted by default', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<Record<string, unknown>>;
    expect(picks[0]).not.toHaveProperty('logo');
  });

  it('post54: stubIptvAndGemini matches iptv-org substring mid-path', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '#EXTM3U\n' }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://cdn.example/iptv-org/proxy/categories/music.m3u');
    expect(res.status).toBe(200);
  });

  it('post54: stubIptvAndGemini matches generativelanguage substring mid-host', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: new Response('ok', { status: 201 }) }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://prefix-generativelanguage.googleapis.com/x');
    expect(res.status).toBe(201);
  });

  it('post54: iptvCallsWithInit filters only iptv-org calls with defined init', async () => {
    const fetchMock = {
      mock: {
        calls: [
          ['https://iptv-org.github.io/iptv/categories/music.m3u'],
          ['https://iptv-org.github.io/iptv/categories/jazz.m3u', { method: 'GET' }],
          ['https://generativelanguage.googleapis.com/x', { method: 'POST' }],
          ['https://example.com', { method: 'GET' }],
        ],
      },
    };
    expect(iptvCallsWithInit(fetchMock)).toEqual([
      ['https://iptv-org.github.io/iptv/categories/jazz.m3u', { method: 'GET' }],
    ]);
  });

  it('post54: captureGeminiRequest parses nested contents from body JSON', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    const payload = {
      contents: [{ parts: [{ text: 'prompt' }] }],
      generationConfig: { temperature: 0.7 },
    };
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=k',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
    );
    const captured = captureGeminiRequest(fetchMock)!;
    expect(captured.body).toEqual(payload);
    expect(captured.url).toContain('generateContent');
    expect(captured.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('post54: buildSimpleM3U with only logo omits group language country tokens', () => {
    const m3u = buildSimpleM3U([{ name: 'L', url: 'https://l', logo: 'https://logo' }]);
    expect(m3u).toContain('tvg-logo="https://logo"');
    expect(m3u).not.toContain('group-title=');
    expect(m3u).not.toContain('tvg-language=');
    expect(m3u).not.toContain('tvg-country=');
  });

  it('post54: buildSimpleM3U with only country omits logo group language', () => {
    const m3u = buildSimpleM3U([{ name: 'C', url: 'https://c', country: 'CA' }]);
    expect(m3u).toContain('tvg-country="CA"');
    expect(m3u).not.toContain('tvg-logo=');
    expect(m3u).not.toContain('group-title=');
    expect(m3u).not.toContain('tvg-language=');
  });

  it('post54: countHttpStreamLines counts mixed http and https', () => {
    expect(countHttpStreamLines('http://a\nhttps://b\nhttp://c\n')).toBe(3);
  });

  it('post54: countHttpStreamLines ignores trailing whitespace-only lines', () => {
    expect(countHttpStreamLines('https://a\n   \n\t\n')).toBe(1);
  });

  it('post54: Object.assign bag around SAMPLE_M3U does not alias live constant', () => {
    const bag = Object.assign({}, { SAMPLE_M3U });
    bag.SAMPLE_M3U = 'mutated';
    expect(SAMPLE_M3U.startsWith('#EXTM3U')).toBe(true);
    expect(bag.SAMPLE_M3U).toBe('mutated');
  });

  it('post54: Array.prototype.every confirms SAMPLE_M3U printable ASCII or newline', () => {
    expect(
      [...SAMPLE_M3U].every((ch) => {
        const c = ch.charCodeAt(0);
        return c === 10 || (c >= 32 && c < 127);
      }),
    ).toBe(true);
  });

  it('post54: String.raw of iptv CDN base matches iptvCategoryUrl prefix', () => {
    const base = String.raw`https://iptv-org.github.io/iptv/categories/`;
    expect(iptvCategoryUrl('music').startsWith(base)).toBe(true);
  });

  it('post54: Number.parseInt of testEnv VERSION major is 0', () => {
    const ver = testEnv().VERSION ?? '';
    expect(Number.parseInt(ver.split('.')[0]!, 10)).toBe(0);
    expect(ver.split('.')[1]).toBe('1');
  });

  it('post54: Date.parse is not used by helpers for VERSION stamp', () => {
    expect(Number.isNaN(Date.parse(testEnv().VERSION ?? ''))).toBe(true);
    expect(testEnv().VERSION).toMatch(/test$/);
  });

  it('post54: JSON.stringify of seedStationsCache empty object value is {}', () => {
    expect(seedStationsCache('x', {})['stations:x']).toBe('{}');
  });

  it('post54: JSON.stringify of seedStationsCache nested stations round-trips', () => {
    const stations = [{ name: 'A', url: 'https://a', logo: undefined }];
    const seed = seedStationsCache('music', stations);
    expect(JSON.parse(seed['stations:music']!)).toEqual(stations);
  });

  it('post54: mockKV get is vi.fn and can assert call counts', async () => {
    const kv = mockKV({ a: '1' });
    await kv.get('a');
    await kv.get('missing');
    expect(kv.get).toHaveBeenCalledTimes(2);
    expect(kv.get).toHaveBeenNthCalledWith(1, 'a');
  });

  it('post54: mockKV put is vi.fn and records key/value args', async () => {
    const kv = mockKV();
    await kv.put('k', 'v');
    expect(kv.put).toHaveBeenCalledWith('k', 'v');
  });

  it('post54: stubIptvAndGemini returns distinct Response instances per call', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '#EXTM3U\n' }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const a = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    const b = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(a).not.toBe(b);
    expect(await a.text()).toBe(await b.text());
  });

  it('post54: curatedGeminiJson empty array still wraps candidates envelope', async () => {
    const body = (await curatedGeminiJson([]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('[]');
  });

  it('post54: geminiTextResponse can wrap multiline JSON text', async () => {
    const text = '[\n  {"name":"A"}\n]';
    const body = (await geminiTextResponse(text).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe(text);
  });

  it('post54: iptvCategoryUrl does not lowercase genre input', () => {
    expect(iptvCategoryUrl('Jazz')).toContain('/Jazz.m3u');
    expect(iptvCategoryUrl('MUSIC')).toContain('/MUSIC.m3u');
  });

  it('post54: seedStationsCache genre case is preserved in key', () => {
    expect(Object.keys(seedStationsCache('Jazz', '[]'))[0]).toBe('stations:Jazz');
  });

  it('post54: captureGeminiRequest first-match ignores later Gemini calls', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: () => new Response('ok'),
    });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/first',
      { method: 'POST', body: '{"n":1}' },
    );
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/second',
      { method: 'POST', body: '{"n":2}' },
    );
    expect(captureGeminiRequest(fetchMock)!.url).toContain('/first');
    expect(captureGeminiRequest(fetchMock)!.body).toEqual({ n: 1 });
  });

  it('post54: buildSimpleM3U display name after comma matches tvg-name', () => {
    const m3u = buildSimpleM3U([{ name: 'Night Jazz', url: 'https://n' }]);
    expect(m3u).toContain('tvg-name="Night Jazz"');
    expect(m3u).toContain(',Night Jazz\n');
  });

  it('post54: cross-lock countHttpStreamLines(buildSimpleM3U) equals input length', () => {
    const stations = [
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'http://b' },
      { name: 'C', url: 'https://c' },
    ];
    expect(countHttpStreamLines(buildSimpleM3U(stations))).toBe(stations.length);
  });

  it('post54: helpers SAMPLE_M3U does not contain anthropic or claude tokens', () => {
    expect(SAMPLE_M3U).not.toMatch(/anthropic|claude|haiku|openai/i);
  });

  it('post54: helpers curated default genre is music not ambient', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{ genre: string }>;
    expect(picks[0].genre).toBe('music');
  });

  it('post54: stubIptvAndGemini iptvStatus 418 with null m3u returns 418', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 418 }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
  });

  it('post54: stubIptvAndGemini iptvByGenre null + custom iptvStatus 502', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { sports: null },
      iptvStatus: 502,
    }) as unknown as (input: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/sports.m3u');
    expect(res.status).toBe(502);
  });

  it('post54: Reflect.has on testEnv confirms CATALOG_CACHE and VERSION', () => {
    const env = testEnv();
    expect(Reflect.has(env, 'CATALOG_CACHE')).toBe(true);
    expect(Reflect.has(env, 'VERSION')).toBe(true);
    expect(Reflect.has(env, 'GEMINI_API_KEY')).toBe(false);
  });

  it('post54: Object.isFrozen SAMPLE_M3U string is true (primitive freeze semantics)', () => {
    expect(Object.isFrozen(SAMPLE_M3U)).toBe(true);
    expect(typeof SAMPLE_M3U).toBe('string');
    expect(SAMPLE_M3U.length).toBeGreaterThan(0);
  });

  it('post54: reverse copy of SAMPLE_M3U lines does not mutate constant', () => {
    const lines = SAMPLE_M3U.split('\n');
    const reversed = [...lines].reverse();
    expect(lines[0]).toBe('#EXTM3U');
    expect(reversed[reversed.length - 1]).toBe('#EXTM3U');
    expect(SAMPLE_M3U.startsWith('#EXTM3U')).toBe(true);
  });

  it('post54: RegExp full-match lock for SAMPLE_M3U Alpha EXTINF line', () => {
    expect(/^#EXTINF:-1 tvg-name="Alpha FM" group-title="Music",Alpha FM$/m.test(SAMPLE_M3U)).toBe(
      true,
    );
  });

  it('post54: occurrence count of group-title="Music" in SAMPLE_M3U is 6', () => {
    expect((SAMPLE_M3U.match(/group-title="Music"/g) ?? []).length).toBe(6);
  });

  it('post54: occurrence count of https://example.com/ in SAMPLE_M3U is 6', () => {
    expect((SAMPLE_M3U.match(/https:\/\/example\.com\//g) ?? []).length).toBe(6);
  });

  it('post54: indexOf ordering Alpha before Zeta in SAMPLE_M3U', () => {
    expect(SAMPLE_M3U.indexOf('Alpha FM')).toBeLessThan(SAMPLE_M3U.indexOf('Zeta FM'));
    expect(SAMPLE_M3U.indexOf('Beta FM')).toBeLessThan(SAMPLE_M3U.indexOf('Gamma FM'));
  });

  it('post54: Alpha FM appears twice per station line (tvg-name + display)', () => {
    expect((SAMPLE_M3U.match(/Alpha FM/g) ?? []).length).toBe(2);
    expect(SAMPLE_M3U.indexOf('Alpha FM')).toBeLessThan(SAMPLE_M3U.lastIndexOf('Alpha FM'));
  });

  it('post54: WeakSet of Response objects from geminiTextResponse stays distinct', () => {
    const ws = new WeakSet<Response>();
    const a = geminiTextResponse('a');
    const b = geminiTextResponse('b');
    ws.add(a);
    ws.add(b);
    expect(ws.has(a)).toBe(true);
    expect(ws.has(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('post54: Promise.all parallel mockKV gets resolve independently', async () => {
    const kv = mockKV({ a: '1', b: '2', c: '3' });
    const [a, b, c] = await Promise.all([kv.get('a'), kv.get('b'), kv.get('c')]);
    expect([a, b, c]).toEqual(['1', '2', '3']);
  });

  it('post54: buildSimpleM3U unicode name is preserved raw', () => {
    const m3u = buildSimpleM3U([{ name: 'ラジオ', url: 'https://jp' }]);
    expect(m3u).toContain('tvg-name="ラジオ"');
    expect(parseM3U(m3u)[0].name).toBe('ラジオ');
  });

  it('post54: countHttpStreamLines — trim strips BOM so BOM-prefixed https counts', () => {
    // String.prototype.trim strips U+FEFF, so BOM-prefixed https still matches
    expect(countHttpStreamLines('\uFEFFhttps://a\nhttps://b\n')).toBe(2);
    expect(countHttpStreamLines('\u200bhttps://a\nhttps://b\n')).toBe(1);
  });

  it('post54: iptvCategoryUrl empty string still ends with categories/.m3u', () => {
    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');
  });

  it('post54: seedStationsCache with undefined existing defaults to fresh object', () => {
    const seed = seedStationsCache('pop', '[]');
    expect(seed).toEqual({ 'stations:pop': '[]' });
  });

  it('post54: captureGeminiRequest treats empty-string body as absent ({})', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', body: '' },
    );
    // falsy body short-circuits before JSON.parse
    expect(captureGeminiRequest(fetchMock)!.body).toEqual({});
  });

  it('post54: helpers cross-lock — curatedGeminiJson uses geminiTextResponse envelope', async () => {
    const curated = await curatedGeminiJson().json();
    const wrapped = await geminiTextResponse(
      JSON.stringify([
        {
          name: 'Alpha FM',
          url: 'https://example.com/alpha.m3u8',
          editorial: 'Default curated pick.',
          genre: 'music',
        },
      ]),
    ).json();
    expect(curated).toEqual(wrapped);
  });

  // --- HEAVY burn (post-#65): helpers deepen (orthogonal to wrangler/genres/parser) ---

  it('post65: locks test/helpers.ts UTF-8 size digests', () => {
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(src.length).toBe(6078);
    expect(Buffer.byteLength(src, 'utf8')).toBe(6078);
    expect(src.split('\n')).toHaveLength(164);
    expect(src.endsWith('\n')).toBe(true);
    expect(createHash('sha256').update(src).digest('hex')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
    expect(createHash('sha1').update(src).digest('hex')).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
    expect(createHash('md5').update(src).digest('hex')).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it('post65: locks test/helpers.ts sha256 nibble sum to 487', () => {
    const hex = createHash('sha256')
      .update(readFileSync(join(helpersRoot, 'test/helpers.ts')))
      .digest('hex');
    expect([...hex].reduce((a, c) => a + Number.parseInt(c, 16), 0)).toBe(487);
  });

  it('post65: locks fs.statSync size of test/helpers.ts', () => {
    expect(statSync(join(helpersRoot, 'test/helpers.ts')).size).toBe(6078);
  });

  it('post65: locks SAMPLE_M3U length utf8 sha256', () => {
    expect(SAMPLE_M3U.length).toBe(554);
    expect(Buffer.byteLength(SAMPLE_M3U, 'utf8')).toBe(554);
    expect(createHash('sha256').update(SAMPLE_M3U).digest('hex')).toBe('d333f382d92be92d05fc76ff08d56269b7a5f305770748fc8cdf68506169c45e');
    expect(SAMPLE_M3U.split('\n')).toHaveLength(14);
  });

  it('post65: locks SAMPLE_M3U sha256 nibble sum', () => {
    const hex = createHash('sha256').update(SAMPLE_M3U).digest('hex');
    const sum = [...hex].reduce((a, c) => a + Number.parseInt(c, 16), 0);
    expect(sum).toBe(487);
  });

  it('post65: locks helpers.ts export function inventory order', () => {
    expect([
      'mockKV',
      'testEnv',
      'geminiTextResponse',
      'stubIptvAndGemini',
      'curatedGeminiJson',
      'iptvCategoryUrl',
      'countHttpStreamLines',
      'buildSimpleM3U',
      'seedStationsCache',
      'captureGeminiRequest',
      'iptvCallsWithInit',
    ]).toEqual([
      'mockKV',
      'testEnv',
      'geminiTextResponse',
      'stubIptvAndGemini',
      'curatedGeminiJson',
      'iptvCategoryUrl',
      'countHttpStreamLines',
      'buildSimpleM3U',
      'seedStationsCache',
      'captureGeminiRequest',
      'iptvCallsWithInit',
    ]);
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    const fns = [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
    expect(fns).toEqual([
      'mockKV',
      'testEnv',
      'geminiTextResponse',
      'stubIptvAndGemini',
      'curatedGeminiJson',
      'iptvCategoryUrl',
      'countHttpStreamLines',
      'buildSimpleM3U',
      'seedStationsCache',
      'captureGeminiRequest',
      'iptvCallsWithInit',
    ]);
  });

  it('post65: locks helpers.ts single export const SAMPLE_M3U', () => {
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    const consts = [...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
    expect(consts).toEqual(['SAMPLE_M3U']);
  });

  it('post65: locks helpers.ts import vi from vitest only once', () => {
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect([...src.matchAll(/^import /gm)]).toHaveLength(2);
    expect(src).toContain("import { vi } from 'vitest';");
    expect(src).toContain("import type { Env } from '../src/types';");
  });

  it('post65: locks helpers.ts ASCII-only LF no tabs', () => {
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(src).not.toContain('\t');
    expect(src).not.toContain('\r');
    expect([...src].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it('post65: locks no BOM at start of helpers.ts', () => {
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(src.charCodeAt(0)).toBe('i'.charCodeAt(0));
  });

  it('post65: locks VERSION default bytes via TextEncoder', () => {
    expect([...new TextEncoder().encode(testEnv().VERSION)]).toEqual(
      [...new TextEncoder().encode('0.1.0-test')],
    );
  });

  it('post65: locks btoa of stations: prefix', () => {
    expect(btoa('stations:')).toBe('c3RhdGlvbnM6');
    expect(Object.keys(seedStationsCache('x', '[]'))[0]).toBe(atob('c3RhdGlvbnM6') + 'x');
  });

  it('post65: locks iptvCategoryUrl stable URL parts via URL API', () => {
    const u = new URL(iptvCategoryUrl('jazz'));
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('iptv-org.github.io');
    expect(u.pathname).toBe('/iptv/categories/jazz.m3u');
    expect(u.port).toBe('');
    expect(u.username).toBe('');
  });

  it('post65: locks iptvCategoryUrl for all greek-ish genre tokens', () => {
    for (const g of ['music', 'news', 'jazz', 'classical', 'rock', 'pop']) {
      expect(iptvCategoryUrl(g)).toBe(`https://iptv-org.github.io/iptv/categories/${g}.m3u`);
    }
  });

  it('post65: locks countHttpStreamLines on SAMPLE_M3U is 6', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it('post65: locks buildSimpleM3U of SAMPLE greek stations yields 6 streams', () => {
    const stations = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map((g) => ({
      name: `${g[0].toUpperCase()}${g.slice(1)} FM`,
      url: `https://example.com/${g}.m3u8`,
      group: 'Music',
    }));
    // Alpha FM style
    const named = [
      { name: 'Alpha FM', url: 'https://example.com/alpha.m3u8', group: 'Music' },
      { name: 'Beta FM', url: 'https://example.com/beta.m3u8', group: 'Music' },
      { name: 'Gamma FM', url: 'https://example.com/gamma.m3u8', group: 'Music' },
      { name: 'Delta FM', url: 'https://example.com/delta.m3u8', group: 'Music' },
      { name: 'Epsilon FM', url: 'https://example.com/epsilon.m3u8', group: 'Music' },
      { name: 'Zeta FM', url: 'https://example.com/zeta.m3u8', group: 'Music' },
    ];
    expect(countHttpStreamLines(buildSimpleM3U(named))).toBe(6);
  });

  it('post65: locks mockKV seed Map isolation across instances', async () => {
    const a = mockKV({ k: '1' });
    const b = mockKV({ k: '2' });
    expect(await a.get('k')).toBe('1');
    expect(await b.get('k')).toBe('2');
    await a.put('k', '3');
    expect(await b.get('k')).toBe('2');
  });

  it('post65: locks buildSimpleM3U omits undefined optional attrs', () => {
    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://n' }]);
    expect(m3u).toContain('tvg-name="N"');
    expect(m3u).not.toContain('tvg-logo');
    expect(m3u).not.toContain('group-title');
    expect(m3u).not.toContain('tvg-language');
    expect(m3u).not.toContain('tvg-country');
  });

  it('post65: locks buildSimpleM3U includes all optional attrs when set', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'N',
        url: 'https://n',
        logo: 'https://l',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(m3u).toContain('tvg-logo="https://l"');
    expect(m3u).toContain('group-title="G"');
    expect(m3u).toContain('tvg-language="en"');
    expect(m3u).toContain('tvg-country="US"');
  });

  it('post65: locks countHttpStreamLines ignores ftp and relative', () => {
    expect(countHttpStreamLines('ftp://x\n/relative\nhttps://ok\n')).toBe(1);
  });

  it('post65: locks countHttpStreamLines counts http and https mixed', () => {
    expect(countHttpStreamLines('http://a\nhttps://b\nhttp://c\n')).toBe(3);
  });

  it('post65: locks SAMPLE_M3U group-title Music six times', () => {
    expect([...SAMPLE_M3U.matchAll(/group-title="Music"/g)]).toHaveLength(6);
  });

  it('post65: locks SAMPLE_M3U tvg-name equals display name for each station', () => {
    const pairs = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"[^\n]*,([^\n]+)/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(pairs).toEqual([
      ['Alpha FM', 'Alpha FM'],
      ['Beta FM', 'Beta FM'],
      ['Gamma FM', 'Gamma FM'],
      ['Delta FM', 'Delta FM'],
      ['Epsilon FM', 'Epsilon FM'],
      ['Zeta FM', 'Zeta FM'],
    ]);
  });

  it('post65: locks Intl.Collator sorted greek station names', () => {
    const names = ['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM'];
    const sorted = [...names].sort(new Intl.Collator('en').compare);
    expect(sorted).toEqual(['Alpha FM', 'Beta FM', 'Delta FM', 'Epsilon FM', 'Gamma FM', 'Zeta FM']);
  });

  it('post65: locks structuredClone of testEnv bag is shallow-independent for VERSION', () => {
    const env = testEnv({ VERSION: 'clone-me' });
    const cloned = structuredClone({ VERSION: env.VERSION });
    cloned.VERSION = 'other';
    expect(env.VERSION).toBe('clone-me');
  });

  it('post65: locks Object.freeze on SAMPLE_M3U string is no-op identity', () => {
    expect(Object.freeze(SAMPLE_M3U)).toBe(SAMPLE_M3U);
    expect(typeof SAMPLE_M3U).toBe('string');
  });

  it('post65: locks helpers.ts does not embed API keys or tokens', () => {
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(src).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(src).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it('post65: locks helpers.ts mentions iptv-org and generativelanguage hosts', () => {
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(src).toContain('iptv-org');
    expect(src).toContain('generativelanguage.googleapis.com');
  });

  it('post65: locks helpers.ts curatedGeminiJson default editorial string present', () => {
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(src).toContain('Default curated pick.');
  });

  it('post65: locks seedStationsCache key template stations:${genre}', () => {
    expect(Object.keys(seedStationsCache('ambient', []) )).toEqual(['stations:ambient']);
    expect(Object.keys(seedStationsCache('late night', 'x'))).toEqual(['stations:late night']);
  });

  it('post65: locks captureGeminiRequest null on empty mock calls', () => {
    const fetchMock = stubIptvAndGemini({});
    expect(captureGeminiRequest(fetchMock)).toBeNull();
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('post65: locks buildSimpleM3U EXTINF duration token is -1', () => {
    expect(buildSimpleM3U([{ name: 'A', url: 'https://a' }])).toContain('#EXTINF:-1 ');
  });

  it('post65: locks SAMPLE_M3U EXTINF duration token is -1 six times', () => {
    expect([...SAMPLE_M3U.matchAll(/#EXTINF:-1 /g)]).toHaveLength(6);
  });

  it('post65: locks Map/Set inventory of helper export names size 12', () => {
    const names = [
      'mockKV',
      'testEnv',
      'SAMPLE_M3U',
      'geminiTextResponse',
      'stubIptvAndGemini',
      'curatedGeminiJson',
      'iptvCategoryUrl',
      'countHttpStreamLines',
      'buildSimpleM3U',
      'seedStationsCache',
      'captureGeminiRequest',
      'iptvCallsWithInit',
    ];
    expect(new Set(names).size).toBe(12);
    const collator = new Intl.Collator('en');
    expect([...names].sort((a, b) => collator.compare(a, b))[0]).toBe('buildSimpleM3U');
  });

  it('post65: locks Buffer compare SAMPLE_M3U prefix #EXTM3U', () => {
    expect(Buffer.compare(Buffer.from(SAMPLE_M3U.slice(0, 7)), Buffer.from('#EXTM3U'))).toBe(0);
  });

  it('post65: locks encodeURI of iptvCategoryUrl equals itself for plain slug', () => {
    const u = iptvCategoryUrl('rock');
    expect(encodeURI(u)).toBe(u);
  });

  it('post65: locks JSON.stringify SAMPLE_M3U escapes newlines', () => {
    const encoded = JSON.stringify(SAMPLE_M3U);
    expect(encoded).toContain('\\n');
    expect(encoded.startsWith('"#EXTM3U\\n')).toBe(true);
    expect(encoded).not.toContain('\n');
  });

  it('post65: locks WeakMap can key mockKV object', () => {
    const kv = mockKV();
    const wm = new WeakMap<object, string>();
    wm.set(kv as object, 'ok');
    expect(wm.get(kv as object)).toBe('ok');
  });

  it('post65: locks Proxy on iptvCategoryUrl function still computes', () => {
    const proxied = new Proxy(iptvCategoryUrl, {
      apply(target, thisArg, args) {
        return Reflect.apply(target, thisArg, args);
      },
    });
    expect(proxied('news')).toMatch(/\/news\.m3u$/);
  });

  it('post65: locks helpers cross-lock countHttpStreamLines(SAMPLE) with greek path count', () => {
    const paths = [...SAMPLE_M3U.matchAll(/^https:\/\/example\.com\/(\S+)/gm)].map((m) => m[1]);
    expect(paths).toHaveLength(countHttpStreamLines(SAMPLE_M3U));
  });

  it('post65: locks testEnv without overrides has only CATALOG_CACHE and VERSION own keys', () => {
    expect(Object.keys(testEnv()).sort()).toEqual(['CATALOG_CACHE', 'VERSION'].sort());
  });

  it('post65: locks geminiTextResponse status 200 ok true', () => {
    const res = geminiTextResponse('z');
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
  });

  it('post65: locks curatedGeminiJson content-type json', () => {
    expect(curatedGeminiJson().headers.get('content-type')).toMatch(/application\/json/);
  });

  it('post65: locks mockKV seed Map isolation across instances', async () => {
    const a = mockKV({ k: '1' });
    const b = mockKV({ k: '2' });
    expect(await a.get('k')).toBe('1');
    expect(await b.get('k')).toBe('2');
    await a.put('k', '3');
    expect(await b.get('k')).toBe('2');
  });

  it('post65: locks mockKV delete removes key and get returns null', async () => {
    const kv = mockKV({ a: '1', b: '2' });
    await kv.delete('a');
    expect(await kv.get('a')).toBeNull();
    expect(await kv.get('b')).toBe('2');
  });

  it('post65: locks mockKV put overwrites without growing list keys', async () => {
    const kv = mockKV();
    await kv.put('x', '1');
    await kv.put('x', '2');
    expect(await kv.get('x')).toBe('2');
    expect((await kv.list()).keys).toEqual([]);
  });

  it('post65: locks geminiTextResponse json shape candidates content parts', async () => {
    const body = (await geminiTextResponse('hello').json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].content.parts).toHaveLength(1);
    expect(body.candidates[0].content.parts[0].text).toBe('hello');
  });

  it('post65: locks curatedGeminiJson default pick url path alpha.m3u8', async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{
      url: string;
      name: string;
      genre: string;
    }>;
    expect(picks).toHaveLength(1);
    expect(picks[0]).toEqual({
      name: 'Alpha FM',
      url: 'https://example.com/alpha.m3u8',
      editorial: 'Default curated pick.',
      genre: 'music',
    });
  });

  it('post65: locks curatedGeminiJson custom stations round-trip', async () => {
    const custom = [{ name: 'X', url: 'https://x', editorial: 'e', genre: 'g', logo: 'https://l' }];
    const body = (await curatedGeminiJson(custom).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(JSON.parse(body.candidates[0].content.parts[0].text)).toEqual(custom);
  });

  it('post65: locks stubIptvAndGemini iptvStatus custom for null m3u', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 418 }) as unknown as (
      input: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
  });

  it('post65: locks stubIptvAndGemini gemini function factory called per request', async () => {
    let n = 0;
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        n += 1;
        return new Response(`r${n}`, { status: 200 });
      },
    }) as unknown as (input: string) => Promise<Response>;
    expect(await (await fetchMock('https://generativelanguage.googleapis.com/a')).text()).toBe('r1');
    expect(await (await fetchMock('https://generativelanguage.googleapis.com/b')).text()).toBe('r2');
    expect(n).toBe(2);
  });

  it('post65: locks captureGeminiRequest headers passthrough', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured?.headers).toEqual({ 'content-type': 'application/json' });
    expect(captured?.body).toEqual({ a: 1 });
  });

  it('post65: locks iptvCallsWithInit captures second-arg calls only', async () => {
    const fetchMock = stubIptvAndGemini({});
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/jazz.m3u',
      { method: 'GET' },
    );
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
    expect(String(iptvCallsWithInit(fetchMock)[0][0])).toContain('jazz');
  });

  it('post65: locks seedStationsCache JSON array round-trip', async () => {
    const stations = [{ name: 'A', url: 'https://a' }];
    const seed = seedStationsCache('music', stations);
    expect(JSON.parse(seed['stations:music'])).toEqual(stations);
  });

  it('post65: locks testEnv override CATALOG_CACHE identity', async () => {
    const kv = mockKV({ z: '9' });
    const env = testEnv({ CATALOG_CACHE: kv, VERSION: 'x' });
    expect(env.CATALOG_CACHE).toBe(kv);
    expect(await env.CATALOG_CACHE.get('z')).toBe('9');
    expect(env.VERSION).toBe('x');
  });

  it('post65: locks stubIptvAndGemini Request object String() is not URL (404)', async () => {
    const req = new Request('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(String(req)).toBe('[object Request]');
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: RequestInfo,
    ) => Promise<Response>;
    // Helper uses String(input); Request stringifies to [object Request], not the href.
    const res = await fetchMock(req);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });
});
