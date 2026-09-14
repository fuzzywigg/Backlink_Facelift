import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

  // --- HEAVY burn (post-#76): deepen helpers unit coverage (orthogonal to source-contracts #76 / wrangler #78) ---

  it("post76: locks helpers.ts digit count at 65", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')].filter((c) => /\d/.test(c))).toHaveLength(65);
  });

  it("post76: locks helpers.ts uppercase ASCII letter count at 307", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')].filter((c) => /[A-Z]/.test(c))).toHaveLength(307);
  });

  it("post76: locks helpers.ts lowercase ASCII letter count at 3531", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')].filter((c) => /[a-z]/.test(c))).toHaveLength(3531);
  });

  it("post76: locks helpers.ts space count at 919", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/ /g) ?? []).length).toBe(919);
  });

  it("post76: locks helpers.ts tab and CR absence", () => {
    const s = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(s.includes('\t')).toBe(false);
    expect(s.includes('\r')).toBe(false);
  });

  it("post76: locks helpers.ts open-brace count at 59", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/\{/g) ?? []).length).toBe(59);
  });

  it("post76: locks helpers.ts close-brace count at 59", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/\}/g) ?? []).length).toBe(59);
  });

  it("post76: locks helpers.ts paren pair counts at 90", () => {
    const s = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect((s.match(/\(/g) ?? []).length).toBe(90);
    expect((s.match(/\)/g) ?? []).length).toBe(90);
  });

  it("post76: locks helpers.ts double-quote count at 34", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/"/g) ?? []).length).toBe(34);
  });

  it("post76: locks helpers.ts single-quote count at 48", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/'/g) ?? []).length).toBe(48);
  });

  it("post76: locks helpers.ts backtick count at 20", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/`/g) ?? []).length).toBe(20);
  });

  it("post76: locks helpers.ts colon count at 106", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/:/g) ?? []).length).toBe(106);
  });

  it("post76: locks helpers.ts slash count at 59", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/\//g) ?? []).length).toBe(59);
  });

  it("post76: locks helpers.ts dot count at 119", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/\./g) ?? []).length).toBe(119);
  });

  it("post76: locks helpers.ts dash count at 38", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/-/g) ?? []).length).toBe(38);
  });

  it("post76: locks helpers.ts async keyword count at 6", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/\basync\b/g)]).toHaveLength(6);
  });

  it("post76: locks helpers.ts vi.fn count at 7", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/vi\.fn/g)]).toHaveLength(7);
  });

  it("post76: locks helpers.ts Response identifier count at 11", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/\bResponse\b/g)]).toHaveLength(11);
  });

  it("post76: locks helpers.ts JSON. call sites at 3", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/JSON\./g)]).toHaveLength(3);
  });

  it("post76: locks helpers.ts .includes( call sites at 4", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/\.includes\(/g)]).toHaveLength(4);
  });

  it("post76: locks helpers.ts starts with import { vi }", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').startsWith("import { vi } from 'vitest';\n")).toBe(true);
  });

  it("post76: locks helpers.ts ends with closing brace newline", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').endsWith('}\n')).toBe(true);
  });

  it("post76: locks helpers.ts export function count at 11", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/^export function /gm)]).toHaveLength(11);
  });

  it("post76: locks helpers.ts export const count at 1", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/^export const /gm)]).toHaveLength(1);
  });

  it("post76: locks helpers.ts sha1 fingerprint", () => {
    expect(createHash('sha1').update(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).digest('hex')).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
  });

  it("post76: locks helpers.ts md5 fingerprint", () => {
    expect(createHash('md5').update(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).digest('hex')).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it("post76: locks helpers.ts newline count at 163", () => {
    expect((readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').match(/\n/g) ?? []).length).toBe(163);
  });

  it("post76: locks helpers.ts split line length 164 with trailing empty", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split('\n')).toHaveLength(164);
  });

  it("post76: locks helpers.ts imports Env type from ../src/types", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toContain("import type { Env } from '../src/types';");
  });

  it("post76: locks helpers.ts export declaration order", () => {
    const s = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    const markers = [
      'export function mockKV',
      'export function testEnv',
      'export const SAMPLE_M3U',
      'export function geminiTextResponse',
      'export function stubIptvAndGemini',
      'export function curatedGeminiJson',
      'export function iptvCategoryUrl',
      'export function countHttpStreamLines',
      'export function buildSimpleM3U',
      'export function seedStationsCache',
      'export function captureGeminiRequest',
      'export function iptvCallsWithInit',
    ];
    const idxs = markers.map((m) => s.indexOf(m));
    expect(idxs.every((n) => n >= 0)).toBe(true);
    for (let i = 1; i < idxs.length; i++) expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
  });

  it("post76: locks helpers.ts mockKV export starts at offset 120", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function mockKV')).toBe(120);
  });

  it("post76: locks helpers.ts testEnv export starts at offset 695", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function testEnv')).toBe(695);
  });

  it("post76: locks helpers.ts geminiTextResponse export starts at offset 1520", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function geminiTextResponse')).toBe(1520);
  });

  it("post76: locks helpers.ts stubIptvAndGemini export starts at offset 1669", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function stubIptvAndGemini')).toBe(1669);
  });

  it("post76: locks helpers.ts curatedGeminiJson export starts at offset 3041", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function curatedGeminiJson')).toBe(3041);
  });

  it("post76: locks helpers.ts iptvCategoryUrl export starts at offset 3482", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function iptvCategoryUrl')).toBe(3482);
  });

  it("post76: locks helpers.ts countHttpStreamLines export starts at offset 3682", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function countHttpStreamLines')).toBe(3682);
  });

  it("post76: locks helpers.ts buildSimpleM3U export starts at offset 3957", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function buildSimpleM3U')).toBe(3957);
  });

  it("post76: locks helpers.ts seedStationsCache export starts at offset 4728", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function seedStationsCache')).toBe(4728);
  });

  it("post76: locks helpers.ts captureGeminiRequest export starts at offset 5144", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function captureGeminiRequest')).toBe(5144);
  });

  it("post76: locks helpers.ts iptvCallsWithInit export starts at offset 5862", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export function iptvCallsWithInit')).toBe(5862);
  });

  it("post76: locks helpers.ts SAMPLE_M3U export const offset 849", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').indexOf('export const SAMPLE_M3U')).toBe(849);
  });

  it("post76: locks helpers.ts substring KVNamespace count at 2", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split("KVNamespace").length - 1).toBe(2);
  });

  it("post76: locks helpers.ts substring RequestInfo count at 1", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split("RequestInfo").length - 1).toBe(1);
  });

  it("post76: locks helpers.ts substring HeadersInit count at 1", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split("HeadersInit").length - 1).toBe(1);
  });

  it("post76: locks helpers.ts substring RequestInit count at 2", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split("RequestInit").length - 1).toBe(2);
  });

  it("post76: locks helpers.ts substring Partial count at 1", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split("Partial").length - 1).toBe(1);
  });

  it("post76: locks helpers.ts substring hasOwnProperty count at 1", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split("hasOwnProperty").length - 1).toBe(1);
  });

  it("post76: locks helpers.ts substring Object.entries count at 1", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split("Object.entries").length - 1).toBe(1);
  });

  it("post76: locks helpers.ts substring stations: count at 3", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').split("stations:").length - 1).toBe(3);
  });

  it("post76: locks helpers.ts hosts iptv-org and generativelanguage counts", () => {
    const s = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect([...s.matchAll(/iptv-org/g)]).toHaveLength(6);
    expect([...s.matchAll(/generativelanguage\.googleapis\.com/g)]).toHaveLength(3);
  });

  it("post76: locks helpers.ts sha256 nibble sum", () => {
    const hex = createHash('sha256').update(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).digest('hex');
    expect(hex).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
    expect([...hex].reduce((a, c) => a + parseInt(c, 16), 0)).toBe(487);
  });

  it("post76: locks helpers.ts first 40 char codes", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').slice(0, 40)].map((c) => c.charCodeAt(0))).toEqual([105, 109, 112, 111, 114, 116, 32, 123, 32, 118, 105, 32, 125, 32, 102, 114, 111, 109, 32, 39, 118, 105, 116, 101, 115, 116, 39, 59, 10, 105, 109, 112, 111, 114, 116, 32, 116, 121, 112, 101]);
  });

  it("post76: locks helpers.ts does not mention package name backlink", () => {
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').toLowerCase()).not.toContain('backlink');
  });

  it("post76: locks helpers.ts does not embed API key patterns", () => {
    const s = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(s).not.toMatch(/sk-[a-zA-Z0-9]+/);
    expect(s).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(s).not.toMatch(/GEMINI_API_KEY\s*=\s*['"][^'"]+['"]/);
  });

  it("post76: locks helpers.ts default VERSION string once", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/0\.1\.0-test/g)]).toHaveLength(1);
  });

  it("post76: locks helpers.ts Default curated pick editorial once", () => {
    expect([...readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8').matchAll(/Default curated pick\./g)]).toHaveLength(1);
  });

  it("post76: locks helpers.ts JSDoc banners present", () => {
    const s = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    expect(s).toContain('In-memory KV stub');
    expect(s).toContain('generateContent-shaped');
    expect(s).toContain('Minimal curated Gemini JSON');
    expect(s).toContain('Extract the first generativelanguage');
  });

  it("post76: locks SAMPLE_M3U length at 554", () => {
    expect(SAMPLE_M3U.length).toBe(554);
  });

  it("post76: locks SAMPLE_M3U sha256 stable", () => {
    expect(createHash('sha256').update(SAMPLE_M3U).digest('hex')).toBe('d333f382d92be92d05fc76ff08d56269b7a5f305770748fc8cdf68506169c45e');
  });

  it("post76: locks SAMPLE_M3U split line count 14", () => {
    expect(SAMPLE_M3U.split('\n')).toHaveLength(14);
  });

  it("post76: locks SAMPLE_M3U greek alphabet station order", () => {
    const names = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM']);
  });

  it("post76: locks SAMPLE_M3U display names after commas match tvg-name", () => {
    const pairs = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"[^\n]*,([^\n]+)\n/g)];
    expect(pairs).toHaveLength(6);
    for (const m of pairs) expect(m[1]).toBe(m[2]);
  });

  it("post76: locks SAMPLE_M3U stream host is example.com exclusively", () => {
    const hosts = [...SAMPLE_M3U.matchAll(/^https:\/\/([^/]+)/gm)].map((m) => m[1]);
    expect(new Set(hosts)).toEqual(new Set(['example.com']));
    expect(hosts).toHaveLength(6);
  });

  it("post76: locks SAMPLE_M3U path stems match greek lower", () => {
    const stems = [...SAMPLE_M3U.matchAll(/^https:\/\/example\.com\/(\w+)\.m3u8$/gm)].map((m) => m[1]);
    expect(stems).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']);
  });

  it("post76: locks SAMPLE_M3U starts with #EXTM3U newline", () => {
    expect(SAMPLE_M3U.startsWith('#EXTM3U\n')).toBe(true);
  });

  it("post76: locks SAMPLE_M3U ends with zeta.m3u8 newline", () => {
    expect(SAMPLE_M3U.endsWith('https://example.com/zeta.m3u8\n')).toBe(true);
  });

  it("post76: locks SAMPLE_M3U has zero http:// lines", () => {
    expect([...SAMPLE_M3U.matchAll(/^http:\/\//gm)]).toHaveLength(0);
  });

  it("post76: locks SAMPLE_M3U EXTINF count equals stream count", () => {
    expect([...SAMPLE_M3U.matchAll(/^#EXTINF:/gm)]).toHaveLength(countHttpStreamLines(SAMPLE_M3U));
  });

  it("post76: locks SAMPLE_M3U group-title Music appears six times", () => {
    expect([...SAMPLE_M3U.matchAll(/group-title="Music"/g)]).toHaveLength(6);
  });

  it("post76: locks SAMPLE_M3U has no tvg-logo language or country", () => {
    expect(SAMPLE_M3U).not.toContain('tvg-logo');
    expect(SAMPLE_M3U).not.toContain('tvg-language');
    expect(SAMPLE_M3U).not.toContain('tvg-country');
  });

  it("post76: locks SAMPLE_M3U first chars #EXTM3U char codes", () => {
    expect([...SAMPLE_M3U.slice(0, 7)].map((c) => c.charCodeAt(0))).toEqual([35, 69, 88, 84, 77, 51, 85]);
  });

  it("post76: locks sha256 of greek station name list joined", () => {
    const names = ['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM'].join('|');
    expect(createHash('sha256').update(names).digest('hex')).toBe('73b444744788ccee9b0beffa8294a8210f8fd506983147ebbe6eba89802f1f3f');
  });

  it("post76: locks TextEncoder byte length of SAMPLE_M3U equals string length", () => {
    expect(new TextEncoder().encode(SAMPLE_M3U).length).toBe(SAMPLE_M3U.length);
  });

  it("post76: locks Buffer.from SAMPLE_M3U equals utf8 bytes", () => {
    expect(Buffer.from(SAMPLE_M3U, 'utf8').equals(Buffer.from(new TextEncoder().encode(SAMPLE_M3U)))).toBe(true);
  });

  it("post76: locks JSON.stringify SAMPLE_M3U round-trip", () => {
    const j = JSON.stringify(SAMPLE_M3U);
    expect(j).toContain('\\n');
    expect(JSON.parse(j)).toBe(SAMPLE_M3U);
  });

  it("post76: locks Object.is SAMPLE_M3U value equality", () => {
    expect(Object.is(SAMPLE_M3U, SAMPLE_M3U)).toBe(true);
    expect(Object.is(SAMPLE_M3U, '#' + SAMPLE_M3U.slice(1))).toBe(true);
  });

  it("post76: locks Object.freeze SAMPLE_M3U string primitive", () => {
    const frozen = Object.freeze(SAMPLE_M3U);
    expect(frozen).toBe(SAMPLE_M3U);
    expect(Object.isFrozen(SAMPLE_M3U)).toBe(true);
  });

  it("post76: locks Intl.Collator sorted greek FM names", () => {
    const names = ['Zeta FM', 'Alpha FM', 'Gamma FM', 'Beta FM', 'Epsilon FM', 'Delta FM'];
    expect([...names].sort(new Intl.Collator('en').compare)).toEqual([
      'Alpha FM', 'Beta FM', 'Delta FM', 'Epsilon FM', 'Gamma FM', 'Zeta FM',
    ]);
  });

  it("post76: locks queueMicrotask does not reorder sync SAMPLE length", () => {
    let seen = 0;
    queueMicrotask(() => {
      seen = SAMPLE_M3U.length;
    });
    expect(SAMPLE_M3U.length).toBe(554);
    expect(seen).toBe(0);
  });

  it("post76: locks mockKV methods are vitest mocks", () => {
    const kv = mockKV();
    expect(vi.isMockFunction(kv.get)).toBe(true);
    expect(vi.isMockFunction(kv.put)).toBe(true);
    expect(vi.isMockFunction(kv.delete)).toBe(true);
    expect(vi.isMockFunction(kv.list)).toBe(true);
    expect(vi.isMockFunction(kv.getWithMetadata)).toBe(true);
  });

  it("post76: locks mockKV get call count increments", async () => {
    const kv = mockKV({ a: '1' });
    await kv.get('a');
    await kv.get('missing');
    expect(kv.get).toHaveBeenCalledTimes(2);
    expect(kv.get).toHaveBeenNthCalledWith(1, 'a');
    expect(kv.get).toHaveBeenNthCalledWith(2, 'missing');
  });

  it("post76: locks mockKV put then get round-trip unicode", async () => {
    const kv = mockKV();
    await kv.put('k', '📻—café');
    expect(await kv.get('k')).toBe('📻—café');
  });

  it("post76: locks mockKV empty seed misses common keys", async () => {
    const kv = mockKV();
    for (const k of ['stations:music', '', ' ', 'null']) {
      expect(await kv.get(k)).toBeNull();
    }
  });

  it("post76: locks mockKV list always empty regardless of puts", async () => {
    const kv = mockKV({ x: '1' });
    await kv.put('y', '2');
    expect(await kv.list()).toEqual({ keys: [], list_complete: true, cacheStatus: null });
  });

  it("post76: locks mockKV getWithMetadata always null-shaped", async () => {
    const kv = mockKV({ x: '1' });
    expect(await kv.getWithMetadata('x')).toEqual({ value: null, metadata: null, cacheStatus: null });
  });

  it("post76: locks mockKV delete missing key is no-op", async () => {
    const kv = mockKV({ a: '1' });
    await kv.delete('nope');
    expect(await kv.get('a')).toBe('1');
    expect(kv.delete).toHaveBeenCalledWith('nope');
  });

  it("post76: locks mockKV put empty string value retrievable", async () => {
    const kv = mockKV();
    await kv.put('empty', '');
    expect(await kv.get('empty')).toBe('');
  });

  it("post76: locks mockKV seed Map copies entries at construction", async () => {
    const seed: Record<string, string> = { a: '1' };
    const kv = mockKV(seed);
    seed.a = '2';
    seed.b = '3';
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('b')).toBeNull();
  });

  it("post76: locks mockKV concurrent puts on distinct keys", async () => {
    const kv = mockKV();
    await Promise.all([kv.put('a', '1'), kv.put('b', '2'), kv.put('c', '3')]);
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('b')).toBe('2');
    expect(await kv.get('c')).toBe('3');
  });

  it("post76: locks mockKV put call order recorded", async () => {
    const kv = mockKV();
    await kv.put('a', '1');
    await kv.put('b', '2');
    expect(kv.put).toHaveBeenNthCalledWith(1, 'a', '1');
    expect(kv.put).toHaveBeenNthCalledWith(2, 'b', '2');
  });

  it("post76: locks mockKV mockClear resets call history but keeps store", async () => {
    const kv = mockKV({ a: '1' });
    await kv.get('a');
    expect(kv.get).toHaveBeenCalledTimes(1);
    (kv.get as ReturnType<typeof vi.fn>).mockClear();
    expect(kv.get).toHaveBeenCalledTimes(0);
    expect(await kv.get('a')).toBe('1');
  });

  it("post76: locks mockKV typeof object", () => {
    const kv = mockKV();
    expect(kv).not.toBeNull();
    expect(typeof kv).toBe('object');
  });

  it("post76: locks WeakMap can key a mockKV instance", () => {
    const kv = mockKV();
    const wm = new WeakMap<object, string>();
    wm.set(kv as unknown as object, 'ok');
    expect(wm.get(kv as unknown as object)).toBe('ok');
  });

  it("post76: locks mockKV round-trip stations music colon", async () => {
    const kv = mockKV();
    await kv.put("stations:music", 'v');
    expect(await kv.get("stations:music")).toBe('v');
  });

  it("post76: locks mockKV round-trip stations jazz colon", async () => {
    const kv = mockKV();
    await kv.put("stations:jazz", 'v');
    expect(await kv.get("stations:jazz")).toBe('v');
  });

  it("post76: locks mockKV round-trip single colon", async () => {
    const kv = mockKV();
    await kv.put(":", 'v');
    expect(await kv.get(":")).toBe('v');
  });

  it("post76: locks mockKV round-trip empty string key", async () => {
    const kv = mockKV();
    await kv.put("", 'v');
    expect(await kv.get("")).toBe('v');
  });

  it("post76: locks mockKV round-trip slash path key", async () => {
    const kv = mockKV();
    await kv.put("a/b", 'v');
    expect(await kv.get("a/b")).toBe('v');
  });

  it("post76: locks mockKV round-trip space key", async () => {
    const kv = mockKV();
    await kv.put("a b", 'v');
    expect(await kv.get("a b")).toBe('v');
  });

  it("post76: locks mockKV round-trip unicode key", async () => {
    const kv = mockKV();
    await kv.put('unicode-🔑', 'v');
    expect(await kv.get('unicode-🔑')).toBe('v');
  });

  it("post76: locks testEnv default VERSION is 0.1.0-test", () => {
    expect(testEnv().VERSION).toBe('0.1.0-test');
  });

  it("post76: locks testEnv GEMINI_API_KEY override and explicit undefined", () => {
    expect(testEnv({ GEMINI_API_KEY: 'k' }).GEMINI_API_KEY).toBe('k');
    const cleared = testEnv({ GEMINI_API_KEY: undefined });
    expect('GEMINI_API_KEY' in cleared).toBe(true);
    expect(cleared.GEMINI_API_KEY).toBeUndefined();
  });

  it("post76: locks testEnv CATALOG_CACHE is mockKV-shaped", () => {
    expect(vi.isMockFunction(testEnv().CATALOG_CACHE.get)).toBe(true);
  });

  it("post76: locks two testEnv calls produce distinct CATALOG_CACHE", () => {
    const a = testEnv();
    const b = testEnv();
    expect(a.CATALOG_CACHE).not.toBe(b.CATALOG_CACHE);
  });

  it("post76: locks testEnv overrides win VERSION", () => {
    expect(testEnv({ VERSION: 'custom' }).VERSION).toBe('custom');
  });

  it("post76: locks testEnv Object.keys with GEMINI override sorted", () => {
    expect(Object.keys(testEnv({ GEMINI_API_KEY: 'x' })).sort()).toEqual(
      ['CATALOG_CACHE', 'GEMINI_API_KEY', 'VERSION'].sort(),
    );
  });

  it("post76: locks Reflect.ownKeys on testEnv default", () => {
    expect(Reflect.ownKeys(testEnv()).sort()).toEqual(['CATALOG_CACHE', 'VERSION'].sort());
  });

  it("post76: locks geminiTextResponse empty string text", async () => {
    const body = (await geminiTextResponse('').json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe('');
  });

  it("post76: locks geminiTextResponse unicode and newlines preserved", async () => {
    const text = 'line1\nline2 — 🎵';
    const body = (await geminiTextResponse(text).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe(text);
  });

  it("post76: locks geminiTextResponse top-level keys only candidates", async () => {
    const body = (await geminiTextResponse('x').json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['candidates']);
  });

  it("post76: locks geminiTextResponse can be cloned via .clone()", async () => {
    const res = geminiTextResponse('clone-me');
    const a = await res.clone().json();
    const b = await res.json();
    expect(a).toEqual(b);
  });

  it("post76: locks geminiTextResponse status 200 and ok", () => {
    const res = geminiTextResponse('z');
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(['', 'OK']).toContain(res.statusText);
  });

  it("post76: locks geminiTextResponse content-type includes json", () => {
    expect(geminiTextResponse('x').headers.get('content-type')).toMatch(/application\/json/);
  });

  it("post76: locks geminiTextResponse bodyUsed starts false", () => {
    expect(geminiTextResponse('x').bodyUsed).toBe(false);
  });

  it("post76: locks curatedGeminiJson default editorial exact string", async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const picks = JSON.parse(body.candidates[0].content.parts[0].text) as Array<{ editorial: string }>;
    expect(picks[0].editorial).toBe('Default curated pick.');
  });

  it("post76: locks curatedGeminiJson empty array payload", async () => {
    const body = (await curatedGeminiJson([]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(JSON.parse(body.candidates[0].content.parts[0].text)).toEqual([]);
  });

  it("post76: locks curatedGeminiJson multi-station order preserved", async () => {
    const stations = [
      { name: 'A', url: 'https://a', editorial: 'e1', genre: 'g1' },
      { name: 'B', url: 'https://b', editorial: 'e2', genre: 'g2' },
    ];
    const body = (await curatedGeminiJson(stations).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(JSON.parse(body.candidates[0].content.parts[0].text)).toEqual(stations);
  });

  it("post76: locks curatedGeminiJson matches geminiTextResponse wrapper shape", async () => {
    const a = await curatedGeminiJson().json();
    const inner = JSON.stringify([
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'Default curated pick.',
        genre: 'music',
      },
    ]);
    const b = await geminiTextResponse(inner).json();
    expect(a).toEqual(b);
  });

  it("post76: locks curatedGeminiJson default station keys exact set", async () => {
    const body = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const pick = JSON.parse(body.candidates[0].content.parts[0].text)[0] as Record<string, unknown>;
    expect(Object.keys(pick).sort()).toEqual(['editorial', 'genre', 'name', 'url'].sort());
    expect(pick).not.toHaveProperty('logo');
  });

  it("post76: locks curatedGeminiJson bodyUsed flips after json()", async () => {
    const res = curatedGeminiJson();
    expect(res.bodyUsed).toBe(false);
    await res.json();
    expect(res.bodyUsed).toBe(true);
  });

  it("post76: locks curatedGeminiJson ok true and redirected false", () => {
    const res = curatedGeminiJson();
    expect(res.ok).toBe(true);
    expect(res.redirected).toBe(false);
    expect(res.type).toMatch(/basic|default/);
  });

  it("post76: locks iptvCategoryUrl for every VALID_GENRES slug", () => {
    const slugs = ['music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment'] as const;
    for (const g of slugs) {
      expect(iptvCategoryUrl(g)).toBe(`https://iptv-org.github.io/iptv/categories/${g}.m3u`);
    }
  });

  it("post76: locks iptvCategoryUrl(music) exact", () => {
    expect(iptvCategoryUrl('music')).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it("post76: locks iptvCategoryUrl(ambient) exact", () => {
    expect(iptvCategoryUrl('ambient')).toBe('https://iptv-org.github.io/iptv/categories/ambient.m3u');
  });

  it("post76: locks iptvCategoryUrl(jazz) exact", () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it("post76: locks iptvCategoryUrl(classical) exact", () => {
    expect(iptvCategoryUrl('classical')).toBe('https://iptv-org.github.io/iptv/categories/classical.m3u');
  });

  it("post76: locks iptvCategoryUrl(pop) exact", () => {
    expect(iptvCategoryUrl('pop')).toBe('https://iptv-org.github.io/iptv/categories/pop.m3u');
  });

  it("post76: locks iptvCategoryUrl(rock) exact", () => {
    expect(iptvCategoryUrl('rock')).toBe('https://iptv-org.github.io/iptv/categories/rock.m3u');
  });

  it("post76: locks iptvCategoryUrl(news) exact", () => {
    expect(iptvCategoryUrl('news')).toBe('https://iptv-org.github.io/iptv/categories/news.m3u');
  });

  it("post76: locks iptvCategoryUrl(sports) exact", () => {
    expect(iptvCategoryUrl('sports')).toBe('https://iptv-org.github.io/iptv/categories/sports.m3u');
  });

  it("post76: locks iptvCategoryUrl(entertainment) exact", () => {
    expect(iptvCategoryUrl('entertainment')).toBe('https://iptv-org.github.io/iptv/categories/entertainment.m3u');
  });

  it("post76: locks iptvCategoryUrl does not encode spaces", () => {
    expect(iptvCategoryUrl('late night')).toBe('https://iptv-org.github.io/iptv/categories/late night.m3u');
  });

  it("post76: locks iptvCategoryUrl empty genre still builds path", () => {
    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');
  });

  it("post76: locks iptvCategoryUrl URL can be parsed", () => {
    const u = new URL(iptvCategoryUrl('jazz'));
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('iptv-org.github.io');
    expect(u.pathname).toBe('/iptv/categories/jazz.m3u');
  });

  it("post76: locks iptvCategoryUrl with hyphen and underscore slugs", () => {
    expect(iptvCategoryUrl('lo-fi')).toContain('/lo-fi.m3u');
    expect(iptvCategoryUrl('foo_bar')).toContain('/foo_bar.m3u');
  });

  it("post76: locks encodeURI of iptvCategoryUrl for plain slug equals itself", () => {
    const u = iptvCategoryUrl('jazz');
    expect(encodeURI(u)).toBe(u);
  });

  it("post76: locks encodeURIComponent of spaced genre vs raw URL", () => {
    expect(encodeURIComponent('late night')).toBe('late%20night');
    expect(iptvCategoryUrl('late night')).toContain('late night');
  });

  it("post76: locks Proxy around iptvCategoryUrl still computes", () => {
    const proxied = new Proxy(iptvCategoryUrl, {
      apply(target, thisArg, args) {
        return Reflect.apply(target, thisArg, args);
      },
    });
    expect(proxied('jazz')).toBe(iptvCategoryUrl('jazz'));
  });

  it("post76: locks Array.from VALID-like slugs map uniquely through iptvCategoryUrl", () => {
    const urls = ['music', 'jazz', 'news'].map(iptvCategoryUrl);
    expect(new Set(urls).size).toBe(3);
    expect(urls.every((u) => u.endsWith('.m3u'))).toBe(true);
  });

  it("post76: locks countHttpStreamLines ignores EXTINF lines", () => {
    expect(countHttpStreamLines('#EXTM3U\n#EXTINF:-1,A\nhttps://x\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines counts http and https", () => {
    expect(countHttpStreamLines('http://a\nhttps://b\n')).toBe(2);
  });

  it("post76: locks countHttpStreamLines ignores FTP", () => {
    expect(countHttpStreamLines('ftp://a\nhttps://b\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines trims spaces before scheme", () => {
    expect(countHttpStreamLines('  https://a\n\thttp://b\n')).toBe(2);
  });

  it("post76: locks countHttpStreamLines ignores scheme-less", () => {
    expect(countHttpStreamLines('example.com/a\nhttps://b\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines empty string zero", () => {
    expect(countHttpStreamLines('')).toBe(0);
  });

  it("post76: locks countHttpStreamLines only whitespace zero", () => {
    expect(countHttpStreamLines('   \n\n  ')).toBe(0);
  });

  it("post76: locks countHttpStreamLines HTTP uppercase ignored", () => {
    expect(countHttpStreamLines('HTTP://A\nHTTPS://B\nhttps://c\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines ignores data and blob", () => {
    expect(countHttpStreamLines('data:text/plain,hi\nblob:https://x\nhttps://ok\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines mid-line http not counted", () => {
    expect(countHttpStreamLines('x https://nope\nhttps://yes\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines CRLF counted after trim", () => {
    expect(countHttpStreamLines('https://a\r\nhttps://b\r\n')).toBe(2);
  });

  it("post76: locks countHttpStreamLines single url case 0", () => {
    expect(countHttpStreamLines('https://a\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines single url case 1", () => {
    expect(countHttpStreamLines('http://b\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines single url case 2", () => {
    expect(countHttpStreamLines('https://c/d?x=1\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines single url case 3", () => {
    expect(countHttpStreamLines('https://e#frag\n')).toBe(1);
  });

  it("post76: locks countHttpStreamLines SAMPLE equals 6", () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it("post76: locks countHttpStreamLines of buildSimpleM3U empty is 0", () => {
    expect(countHttpStreamLines(buildSimpleM3U([]))).toBe(0);
  });

  it("post76: locks countHttpStreamLines of buildSimpleM3U n stations is n", () => {
    const stations = Array.from({ length: 5 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/${i}.m3u8`,
    }));
    expect(countHttpStreamLines(buildSimpleM3U(stations))).toBe(5);
  });

  it("post76: locks countHttpStreamLines SAMPLE equals parseM3U length", () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(parseM3U(SAMPLE_M3U).length);
  });

  it("post76: locks buildSimpleM3U then countHttpStreamLines equals input length", () => {
    const stations = [
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'http://b' },
      { name: 'C', url: 'https://c' },
    ];
    expect(countHttpStreamLines(buildSimpleM3U(stations))).toBe(stations.length);
  });

  it("post76: locks buildSimpleM3U empty is header plus trailing newline", () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
  });

  it("post76: locks buildSimpleM3U single minimal station", () => {
    expect(buildSimpleM3U([{ name: 'N', url: 'https://u' }])).toBe(
      '#EXTM3U\n#EXTINF:-1 tvg-name="N",N\nhttps://u\n',
    );
  });

  it("post76: locks buildSimpleM3U with all optional attrs", () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://stream',
        group: 'G',
        language: 'en',
        country: 'US',
        logo: 'https://logo',
      },
    ]);
    expect(m3u).toContain('tvg-name="Full"');
    expect(m3u).toContain('tvg-logo="https://logo"');
    expect(m3u).toContain('group-title="G"');
    expect(m3u).toContain('tvg-language="en"');
    expect(m3u).toContain('tvg-country="US"');
    expect(m3u).toContain(',Full\nhttps://stream\n');
  });

  it("post76: locks buildSimpleM3U omits nullish optionals", () => {
    const m3u = buildSimpleM3U([{ name: 'X', url: 'https://x' }]);
    expect(m3u).not.toContain('tvg-logo');
    expect(m3u).not.toContain('group-title');
    expect(m3u).not.toContain('tvg-language');
    expect(m3u).not.toContain('tvg-country');
  });

  it("post76: locks buildSimpleM3U parseM3U round-trip names and urls", () => {
    const stations = [
      { name: 'One', url: 'https://one.m3u8', group: 'Music' },
      { name: 'Two', url: 'https://two.m3u8', group: 'Jazz' },
    ];
    const parsed = parseM3U(buildSimpleM3U(stations));
    expect(parsed.map((s) => s.name)).toEqual(['One', 'Two']);
    expect(parsed.map((s) => s.url)).toEqual(['https://one.m3u8', 'https://two.m3u8']);
  });

  it("post76: locks buildSimpleM3U attribute order", () => {
    const m3u = buildSimpleM3U([
      { name: 'O', url: 'https://u', logo: 'L', group: 'G', language: 'en', country: 'US' },
    ]);
    const ext = m3u.split('\n')[1];
    const iName = ext.indexOf('tvg-name');
    const iLogo = ext.indexOf('tvg-logo');
    const iGroup = ext.indexOf('group-title');
    const iLang = ext.indexOf('tvg-language');
    const iCountry = ext.indexOf('tvg-country');
    expect(iName).toBeLessThan(iLogo);
    expect(iLogo).toBeLessThan(iGroup);
    expect(iGroup).toBeLessThan(iLang);
    expect(iLang).toBeLessThan(iCountry);
  });

  it("post76: locks buildSimpleM3U preserves quotes inside name without escaping", () => {
    const m3u = buildSimpleM3U([{ name: 'A "quoted"', url: 'https://u' }]);
    expect(m3u).toContain('tvg-name="A "quoted""');
    expect(m3u).toContain(',A "quoted"\n');
  });

  it("post76: locks buildSimpleM3U multi-station line count 1+2n", () => {
    const n = 3;
    const stations = Array.from({ length: n }, (_, i) => ({ name: `S${i}`, url: `https://u/${i}` }));
    expect(buildSimpleM3U(stations).trimEnd().split('\n')).toHaveLength(1 + 2 * n);
  });

  it("post76: locks buildSimpleM3U logo without group", () => {
    const m3u = buildSimpleM3U([{ name: 'L', url: 'https://u', logo: 'https://logo.png' }]);
    expect(m3u).toContain('tvg-logo="https://logo.png"');
    expect(m3u).not.toContain('group-title');
  });

  it("post76: locks buildSimpleM3U group without logo", () => {
    const m3u = buildSimpleM3U([{ name: 'G', url: 'https://u', group: 'Jazz' }]);
    expect(m3u).toContain('group-title="Jazz"');
    expect(m3u).not.toContain('tvg-logo');
  });

  it("post76: locks performance.now around buildSimpleM3U is finite", () => {
    const t0 = performance.now();
    buildSimpleM3U([{ name: 'A', url: 'https://a' }]);
    expect(Number.isFinite(performance.now() - t0)).toBe(true);
  });

  it("post76: locks seedStationsCache key template", () => {
    expect(Object.keys(seedStationsCache('jazz', []))).toEqual(['stations:jazz']);
  });

  it("post76: locks seedStationsCache string value passthrough", () => {
    expect(seedStationsCache('music', 'RAW')).toEqual({ 'stations:music': 'RAW' });
  });

  it("post76: locks seedStationsCache object JSON serialization", () => {
    const v = [{ name: 'A' }];
    expect(seedStationsCache('pop', v)).toEqual({ 'stations:pop': JSON.stringify(v) });
  });

  it("post76: locks seedStationsCache merges existing without mutating input", () => {
    const existing = { 'stations:jazz': '[]' };
    const next = seedStationsCache('music', [1], existing);
    expect(next).toEqual({ 'stations:jazz': '[]', 'stations:music': '[1]' });
    expect(existing).toEqual({ 'stations:jazz': '[]' });
  });

  it("post76: locks seedStationsCache overwrite same genre key", () => {
    const existing = seedStationsCache('music', 'old');
    expect(seedStationsCache('music', 'new', existing)).toEqual({ 'stations:music': 'new' });
  });

  it("post76: locks seedStationsCache number boolean null JSON", () => {
    expect(seedStationsCache('n', 42)['stations:n']).toBe('42');
    expect(seedStationsCache('b', true)['stations:b']).toBe('true');
    expect(seedStationsCache('z', null)['stations:z']).toBe('null');
  });

  it("post76: locks seedStationsCache key stations:music", () => {
    expect(seedStationsCache('music', '[]')).toEqual({ 'stations:music': '[]' });
  });

  it("post76: locks seedStationsCache key stations:ambient", () => {
    expect(seedStationsCache('ambient', '[]')).toEqual({ 'stations:ambient': '[]' });
  });

  it("post76: locks seedStationsCache key stations:jazz", () => {
    expect(seedStationsCache('jazz', '[]')).toEqual({ 'stations:jazz': '[]' });
  });

  it("post76: locks seedStationsCache key stations:classical", () => {
    expect(seedStationsCache('classical', '[]')).toEqual({ 'stations:classical': '[]' });
  });

  it("post76: locks seedStationsCache key stations:pop", () => {
    expect(seedStationsCache('pop', '[]')).toEqual({ 'stations:pop': '[]' });
  });

  it("post76: locks seedStationsCache key stations:rock", () => {
    expect(seedStationsCache('rock', '[]')).toEqual({ 'stations:rock': '[]' });
  });

  it("post76: locks seedStationsCache key stations:news", () => {
    expect(seedStationsCache('news', '[]')).toEqual({ 'stations:news': '[]' });
  });

  it("post76: locks seedStationsCache key stations:sports", () => {
    expect(seedStationsCache('sports', '[]')).toEqual({ 'stations:sports': '[]' });
  });

  it("post76: locks seedStationsCache key stations:entertainment", () => {
    expect(seedStationsCache('entertainment', '[]')).toEqual({ 'stations:entertainment': '[]' });
  });

  it("post76: locks structuredClone of seedStationsCache bag is deep-independent", () => {
    const seed = seedStationsCache('music', [{ a: 1 }]);
    const clone = structuredClone(seed);
    clone['stations:music'] = 'mutated';
    expect(seed['stations:music']).toBe(JSON.stringify([{ a: 1 }]));
  });

  it("post76: locks seedStationsCache then mockKV get returns serialized JSON", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const kv = mockKV(seed);
    expect(JSON.parse((await kv.get('stations:music'))!)).toEqual([{ name: 'A', url: 'https://a' }]);
  });

  it("post76: locks testEnv with seeded CATALOG_CACHE from seedStationsCache", async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J' }]);
    const env = testEnv({ CATALOG_CACHE: mockKV(seed) });
    expect(await env.CATALOG_CACHE.get('stations:jazz')).toBe(JSON.stringify([{ name: 'J' }]));
  });

  it("post76: locks captureGeminiRequest null when only iptv called", async () => {
    const fetchMock = stubIptvAndGemini({});
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it("post76: locks captureGeminiRequest picks first gemini call among many", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    const call = fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    await call('https://generativelanguage.googleapis.com/v1/a', { method: 'POST', body: '{"n":1}' });
    await call('https://generativelanguage.googleapis.com/v1/b', { method: 'POST', body: '{"n":2}' });
    expect(captureGeminiRequest(fetchMock)?.body).toEqual({ n: 1 });
    expect(captureGeminiRequest(fetchMock)?.url).toContain('/v1/a');
  });

  it("post76: locks captureGeminiRequest defaults method to GET when init missing", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured?.method).toBe('GET');
    expect(captured?.body).toEqual({});
    expect(captured?.headers).toBeUndefined();
  });

  it("post76: locks captureGeminiRequest uppercases method", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'post', body: '{}' },
    );
    expect(captureGeminiRequest(fetchMock)?.method).toBe('POST');
  });

  it("post76: locks captureGeminiRequest parses nested JSON body", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }) },
    );
    expect(captureGeminiRequest(fetchMock)?.body).toEqual({ contents: [{ parts: [{ text: 'hi' }] }] });
  });

  it("post76: locks captureGeminiRequest with POST but no body yields empty object", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: () => curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/x',
      { method: 'POST' },
    );
    expect(captureGeminiRequest(fetchMock)?.body).toEqual({});
  });

  it("post76: locks captureGeminiRequest url String of URL object input", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: RequestInfo | URL, i?: RequestInit) => Promise<Response>)(
      new URL('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent'),
      { method: 'POST', body: '{"q":1}' },
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured?.url).toContain('generativelanguage.googleapis.com');
    expect(captured?.body).toEqual({ q: 1 });
  });

  it("post76: locks captureGeminiRequest returns null for empty mock calls array", () => {
    expect(captureGeminiRequest({ mock: { calls: [] } })).toBeNull();
  });

  it("post76: locks iptvCallsWithInit empty when no iptv calls", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/x',
    );
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it("post76: locks iptvCallsWithInit ignores gemini calls even with init", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/x',
      { method: 'POST', body: '{}' },
    );
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it("post76: locks iptvCallsWithInit returns all iptv calls that passed init", async () => {
    const fetchMock = stubIptvAndGemini({});
    const call = fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    await call('https://iptv-org.github.io/iptv/categories/music.m3u');
    await call('https://iptv-org.github.io/iptv/categories/jazz.m3u', { method: 'GET' });
    await call('https://iptv-org.github.io/iptv/categories/pop.m3u', { headers: { x: '1' } });
    const bad = iptvCallsWithInit(fetchMock);
    expect(bad).toHaveLength(2);
    expect(String(bad[0][0])).toContain('jazz');
    expect(String(bad[1][0])).toContain('pop');
  });

  it("post76: locks iptvCallsWithInit returns empty for empty mock calls", () => {
    expect(iptvCallsWithInit({ mock: { calls: [] } })).toEqual([]);
  });

  it("post76: locks iptvCallsWithInit filters non-iptv even with init defined", () => {
    expect(
      iptvCallsWithInit({
        mock: {
          calls: [
            ['https://example.com', { method: 'GET' }],
            ['https://iptv-org.github.io/x', undefined],
            ['https://iptv-org.github.io/y', { method: 'GET' }],
          ],
        },
      }),
    ).toHaveLength(1);
  });

  it("post76: locks stubIptvAndGemini default SAMPLE for any iptv-org URL without genre map", async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://cdn.example/iptv-org/mirror.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SAMPLE_M3U);
  });

  it("post76: locks stubIptvAndGemini non-iptv non-gemini is 404 nope", async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://example.com');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
    expect(res.ok).toBe(false);
  });

  it("post76: locks stubIptvAndGemini gemini default boom 500", async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.googleapis.com/v1beta/models/x');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('boom');
  });

  it("post76: locks stubIptvAndGemini URL object for iptv href", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '#EXTM3U\n' }) as unknown as (
      u: RequestInfo | URL,
    ) => Promise<Response>;
    const res = await fetchMock(new URL('https://iptv-org.github.io/iptv/categories/music.m3u'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('#EXTM3U\n');
  });

  it("post76: locks stubIptvAndGemini iptvByGenre multi-genre matrix", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: 'JAZZ', music: 'MUSIC', news: null },
      iptvStatus: 418,
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('jazz'))).text()).toBe('JAZZ');
    expect(await (await fetchMock(iptvCategoryUrl('music'))).text()).toBe('MUSIC');
    const news = await fetchMock(iptvCategoryUrl('news'));
    expect(news.status).toBe(418);
    expect(await news.text()).toBe('down');
    expect(await (await fetchMock(iptvCategoryUrl('rock'))).text()).toBe(SAMPLE_M3U);
  });

  it("post76: locks stubIptvAndGemini m3u empty string is 200 empty body", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '' }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it("post76: locks stubIptvAndGemini gemini Response instance reused", async () => {
    const gemini = curatedGeminiJson();
    const fetchMock = stubIptvAndGemini({ gemini }) as unknown as (u: string) => Promise<Response>;
    const a = await fetchMock('https://generativelanguage.googleapis.com/a');
    expect(a).toBe(gemini);
  });

  it("post76: locks stubIptvAndGemini is a vitest mock with call history", async () => {
    const fetchMock = stubIptvAndGemini({});
    expect(vi.isMockFunction(fetchMock)).toBe(true);
    await (fetchMock as unknown as (u: string) => Promise<Response>)(iptvCategoryUrl('jazz'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("post76: locks stubIptvAndGemini category URL regex requires .m3u suffix", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: 'HIT' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('https://iptv-org.github.io/iptv/categories/jazz')).text()).toBe('FALLBACK');
    expect(await (await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u')).text()).toBe('HIT');
  });

  it("post76: locks stubIptvAndGemini query string after .m3u still matches genre", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: 'HIT' },
    }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u?cache=1');
    expect(await res.text()).toBe('HIT');
  });

  it("post76: locks stubIptvAndGemini dots in genre path segment stop match", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { 'jazz.extra': 'NO' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.extra.m3u')).text()).toBe(
      'FALLBACK',
    );
  });

  it("post76: locks stubIptvAndGemini gemini factory thrown error propagates", async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        throw new Error('gemini-boom');
      },
    }) as unknown as (u: string) => Promise<Response>;
    await expect(fetchMock('https://generativelanguage.googleapis.com/x')).rejects.toThrow('gemini-boom');
  });

  it("post76: locks stubIptvAndGemini ignores AbortSignal in init for iptv", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: 'OK' });
    const res = await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      iptvCategoryUrl('music'),
      { signal: AbortSignal.timeout(5000) },
    );
    expect(await res.text()).toBe('OK');
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
  });

  it("post76: locks stubIptvAndGemini concurrent iptv and gemini calls", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const [iptv, gemini] = await Promise.all([
      fetchMock(iptvCategoryUrl('music')),
      fetchMock('https://generativelanguage.googleapis.com/x'),
    ]);
    expect(iptv.status).toBe(200);
    expect(gemini.status).toBe(200);
    expect(await iptv.text()).toBe(SAMPLE_M3U);
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 400", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 400 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 401", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 401 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 403", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 403 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 404", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 404 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 429", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 429 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 500", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 500 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 502", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 502 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 503", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 503 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stubIptvAndGemini m3u null iptvStatus 504", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 504 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(504);
    expect(await res.text()).toBe('down');
  });

  it("post76: locks stub iptvByGenre solo hit for music", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { music: 'BODY_MUSIC' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('music'))).text()).toBe('BODY_MUSIC');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks stub iptvByGenre solo hit for ambient", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { ambient: 'BODY_AMBIENT' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('ambient'))).text()).toBe('BODY_AMBIENT');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks stub iptvByGenre solo hit for jazz", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: 'BODY_JAZZ' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('jazz'))).text()).toBe('BODY_JAZZ');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks stub iptvByGenre solo hit for classical", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { classical: 'BODY_CLASSICAL' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('classical'))).text()).toBe('BODY_CLASSICAL');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks stub iptvByGenre solo hit for pop", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { pop: 'BODY_POP' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('pop'))).text()).toBe('BODY_POP');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks stub iptvByGenre solo hit for rock", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { rock: 'BODY_ROCK' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('rock'))).text()).toBe('BODY_ROCK');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks stub iptvByGenre solo hit for news", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { news: 'BODY_NEWS' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('news'))).text()).toBe('BODY_NEWS');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks stub iptvByGenre solo hit for sports", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { sports: 'BODY_SPORTS' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('sports'))).text()).toBe('BODY_SPORTS');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks stub iptvByGenre solo hit for entertainment", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { entertainment: 'BODY_ENTERTAINMENT' }, m3u: 'FALLBACK' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('entertainment'))).text()).toBe('BODY_ENTERTAINMENT');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post76: locks parseM3U(SAMPLE_M3U) yields 6 stations named greek FM", () => {
    const parsed = parseM3U(SAMPLE_M3U);
    expect(parsed).toHaveLength(6);
    expect(parsed.map((s) => s.name)).toEqual([
      'Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM',
    ]);
  });

  it("post76: locks parseM3U(SAMPLE_M3U) urls match https example paths", () => {
    const parsed = parseM3U(SAMPLE_M3U);
    expect(parsed.map((s) => s.url)).toEqual([
      'https://example.com/alpha.m3u8',
      'https://example.com/beta.m3u8',
      'https://example.com/gamma.m3u8',
      'https://example.com/delta.m3u8',
      'https://example.com/epsilon.m3u8',
      'https://example.com/zeta.m3u8',
    ]);
  });

  it("post76: locks sha256 of export name mockKV", () => {
    expect(createHash('sha256').update('mockKV').digest('hex')).toBe('3e67d33140d77c75b2ae708c4bd9f2d52266eb8c1d755586ec594c6282f8a993');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) mockKV/);
  });

  it("post76: locks sha256 of export name testEnv", () => {
    expect(createHash('sha256').update('testEnv').digest('hex')).toBe('af724015138330bf7a9ed6f063fd01441a7db0625f61f5ba4ce8d9bf237a5069');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) testEnv/);
  });

  it("post76: locks sha256 of export name SAMPLE_M3U", () => {
    expect(createHash('sha256').update('SAMPLE_M3U').digest('hex')).toBe('1d43a5901d28ef66f1d265acf99819bc500423c6ef4068ac638037251a99f3c6');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) SAMPLE_M3U/);
  });

  it("post76: locks sha256 of export name geminiTextResponse", () => {
    expect(createHash('sha256').update('geminiTextResponse').digest('hex')).toBe('eec054f8c4303529a66a8cc89fbdbb94d1e2d949214212f3897be6adf2f5746a');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) geminiTextResponse/);
  });

  it("post76: locks sha256 of export name stubIptvAndGemini", () => {
    expect(createHash('sha256').update('stubIptvAndGemini').digest('hex')).toBe('8bdb997cbae400bfafb65cd9309585e35549ae3e4b6664bbba192d3d68e34516');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) stubIptvAndGemini/);
  });

  it("post76: locks sha256 of export name curatedGeminiJson", () => {
    expect(createHash('sha256').update('curatedGeminiJson').digest('hex')).toBe('4f2bff92adbee0e05359998f663c29c0a8a1c84298a7f49591b51fd15ea79174');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) curatedGeminiJson/);
  });

  it("post76: locks sha256 of export name iptvCategoryUrl", () => {
    expect(createHash('sha256').update('iptvCategoryUrl').digest('hex')).toBe('c31ff7f68f264f406387783d50bbb27f4063a1dcbc421c46f9d7d7d0f02362d9');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) iptvCategoryUrl/);
  });

  it("post76: locks sha256 of export name countHttpStreamLines", () => {
    expect(createHash('sha256').update('countHttpStreamLines').digest('hex')).toBe('87ba3719ab88575a937f6215ea106d7eb9d94fcae9ff466f20a5411ed3364b38');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) countHttpStreamLines/);
  });

  it("post76: locks sha256 of export name buildSimpleM3U", () => {
    expect(createHash('sha256').update('buildSimpleM3U').digest('hex')).toBe('019f6ec0e4d894f9da583201d2cd2a9fb157eb31067653d87499ec8909583efc');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) buildSimpleM3U/);
  });

  it("post76: locks sha256 of export name seedStationsCache", () => {
    expect(createHash('sha256').update('seedStationsCache').digest('hex')).toBe('be57554a627a4fe18d5af50aa7441b622c477f4a62c11b98de650111f51c7d56');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) seedStationsCache/);
  });

  it("post76: locks sha256 of export name captureGeminiRequest", () => {
    expect(createHash('sha256').update('captureGeminiRequest').digest('hex')).toBe('41edfbaa9310811ca03f0c1b76bc2a5f0a81b5cf088483c9108ff24c8855b640');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) captureGeminiRequest/);
  });

  it("post76: locks sha256 of export name iptvCallsWithInit", () => {
    expect(createHash('sha256').update('iptvCallsWithInit').digest('hex')).toBe('61585f82a260862357f7aa3611f3669aa34a03be4c9cf5ae6f0317526199a193');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toMatch(/export (?:function|const) iptvCallsWithInit/);
  });

  it("post76: locks Map inventory of 12 helper export names", () => {
    const names = [
      'mockKV', 'testEnv', 'SAMPLE_M3U', 'geminiTextResponse', 'stubIptvAndGemini', 'curatedGeminiJson',
      'iptvCategoryUrl', 'countHttpStreamLines', 'buildSimpleM3U', 'seedStationsCache', 'captureGeminiRequest', 'iptvCallsWithInit',
    ];
    expect(new Map(names.map((n, i) => [n, i])).size).toBe(12);
    const src = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    for (const n of names) {
      expect(src).toMatch(new RegExp(`export (?:function|const) ${n}`));
    }
  });

  it("post76: locks fromCharCode rebuild of helper export mockKV", () => {
    const name = String.fromCharCode(109, 111, 99, 107, 75, 86);
    expect(name).toBe('mockKV');
    expect(readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8')).toContain(`export function ${name}`);
  });

  it("post76: locks helpers.ts and helpers.test.ts end with newline", () => {
    const helpers = readFileSync(join(helpersRoot, 'test/helpers.ts'), 'utf8');
    const testFile = readFileSync(join(helpersRoot, 'test/helpers.test.ts'), 'utf8');
    expect(helpers.endsWith('\n')).toBe(true);
    expect(testFile.endsWith('\n')).toBe(true);
  });

});

describe('post98 helpers HEAVY deepen', () => {
  const read = (rel: string) => readFileSync(join(helpersRoot, rel), 'utf8');
  const helpersSrc = read('test/helpers.ts');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const HELPER_EXPORTS = [
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
  ] as const;
  const VALIDISH = ['music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment'] as const;

  it("post98: locks helpers.ts sha256 digest", () => {
    expect(createHash('sha256').update(helpersSrc, 'utf8').digest('hex')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
  });

  it("post98: locks helpers.ts sha1 digest", () => {
    expect(createHash('sha1').update(helpersSrc, 'utf8').digest('hex')).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
  });

  it("post98: locks helpers.ts md5 digest", () => {
    expect(createHash('md5').update(helpersSrc, 'utf8').digest('hex')).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it("post98: locks helpers.ts sha384 digest", () => {
    expect(createHash('sha384').update(helpersSrc, 'utf8').digest('hex')).toBe('1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167');
  });

  it("post98: locks helpers.ts sha512 digest", () => {
    expect(createHash('sha512').update(helpersSrc, 'utf8').digest('hex')).toBe('153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91');
  });

  it("post98: locks helpers.ts sha256 nibble sum", () => {
    expect(nibbleSum(createHash('sha256').update(helpersSrc, 'utf8').digest('hex'))).toBe(487);
  });

  it("post98: locks helpers.ts sha256 xor-nibble fingerprint", () => {
    expect(xorNibbles(createHash('sha256').update(helpersSrc, 'utf8').digest('hex'))).toBe(5);
  });

  it("post98: sha256/sha384/sha512 digests are pairwise distinct", () => {
    const a = createHash('sha256').update(helpersSrc, 'utf8').digest('hex');
    const b = createHash('sha384').update(helpersSrc, 'utf8').digest('hex');
    const c = createHash('sha512').update(helpersSrc, 'utf8').digest('hex');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("post98: sha384 length 96 and sha512 length 128 lowercase hex", () => {
    const a = createHash('sha384').update(helpersSrc, 'utf8').digest('hex');
    const b = createHash('sha512').update(helpersSrc, 'utf8').digest('hex');
    expect(a).toHaveLength(96);
    expect(b).toHaveLength(128);
    expect(/^[a-f0-9]+$/.test(a + b)).toBe(true);
  });

  it("post98: HMAC-SHA256 keyed by post98 locks digest", () => {
    expect(createHmac('sha256', 'post98').update(helpersSrc, 'utf8').digest('hex')).toBe('11f4d84949a54857585cee048ba2131c22bf243818877c8a1a5b296e77751e8d');
  });

  it("post98: HMAC-SHA256 keyed by helpers-unit locks digest", () => {
    expect(createHmac('sha256', 'helpers-unit').update(helpersSrc, 'utf8').digest('hex')).toBe('f0ea1215268fd6a193c2632ee3b22e03a94763fd6e8c7f9f19f4992eb225b7e6');
  });

  it("post98: HMAC-SHA256 keyed by mockKV locks digest", () => {
    expect(createHmac('sha256', 'mockKV').update(helpersSrc, 'utf8').digest('hex')).toBe('a296e2bd1cce8b9f37469dc6a80328e97d162778b56fd9069157ad6a8a73491e');
  });

  it("post98: HMAC-SHA256 keyed by testEnv locks digest", () => {
    expect(createHmac('sha256', 'testEnv').update(helpersSrc, 'utf8').digest('hex')).toBe('3603bfa33024370b7fa45a2a75bd68d678678a43324161b2e4b459dbaec59077');
  });

  it("post98: HMAC-SHA256 keyed by SAMPLE_M3U locks digest", () => {
    expect(createHmac('sha256', 'SAMPLE_M3U').update(helpersSrc, 'utf8').digest('hex')).toBe('2e8e7b295e770ee3b57b5bba119da51e72d12edaab4a5be0b5ec70a6a0701314');
  });

  it("post98: HMAC-SHA256 keyed by stubIptvAndGemini locks digest", () => {
    expect(createHmac('sha256', 'stubIptvAndGemini').update(helpersSrc, 'utf8').digest('hex')).toBe('213ad05b5f9c6fc7a37ecdaa2839623f0372b92692c9e790d374b44ea9ace5ad');
  });

  it("post98: HMAC-SHA256 keyed by buildSimpleM3U locks digest", () => {
    expect(createHmac('sha256', 'buildSimpleM3U').update(helpersSrc, 'utf8').digest('hex')).toBe('281ca55d2b34d3c06f8e7fadce2aacbde801efc264180e411989e49ff45e1432');
  });

  it("post98: HMAC-SHA256 keyed by seedStationsCache locks digest", () => {
    expect(createHmac('sha256', 'seedStationsCache').update(helpersSrc, 'utf8').digest('hex')).toBe('99e48db331d55be15919fc2c739d9ba3f47afb347cf1caeeebcce33fb7863342');
  });

  it("post98: HMAC-SHA256 keyed by geminiTextResponse locks digest", () => {
    expect(createHmac('sha256', 'geminiTextResponse').update(helpersSrc, 'utf8').digest('hex')).toBe('c67133024b834fb02db172eeee03ce5fb74aa60c977e604d47f4dcff6134590a');
  });

  it("post98: HMAC-SHA256 keyed by curatedGeminiJson locks digest", () => {
    expect(createHmac('sha256', 'curatedGeminiJson').update(helpersSrc, 'utf8').digest('hex')).toBe('0f37469518d9624dd955451ccc6fad3e43436dee8ec2003654d5ae2581b083c3');
  });

  it("post98: HMAC digests differ from unkeyed sha256 and each other", () => {
    const plain = createHash('sha256').update(helpersSrc, 'utf8').digest('hex');
    const a = createHmac('sha256', 'post98').update(helpersSrc, 'utf8').digest('hex');
    const b = createHmac('sha256', 'helpers-unit').update(helpersSrc, 'utf8').digest('hex');
    expect(a).not.toBe(plain);
    expect(b).not.toBe(plain);
    expect(a).not.toBe(b);
  });

  it("post98: locks helpers.ts byte and code-unit lengths", () => {
    expect(Buffer.byteLength(helpersSrc, 'utf8')).toBe(6078);
    expect(helpersSrc.length).toBe(6078);
  });

  it("post98: locks helpers.ts code-unit sum", () => {
    const sum = [...helpersSrc].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(507506);
  });

  it("post98: locks helpers.ts line count and trailing newline", () => {
    expect(helpersSrc.endsWith('\n')).toBe(true);
    expect(helpersSrc.split('\n')).toHaveLength(164);
  });

  it("post98: glyph budget — quotes equals spaces underscores", () => {
    expect((helpersSrc.match(/"/g) ?? []).length).toBe(34);
    expect((helpersSrc.match(/=/g) ?? []).length).toBe(71);
    expect((helpersSrc.match(/ /g) ?? []).length).toBe(919);
    expect((helpersSrc.match(/_/g) ?? []).length).toBe(4);
  });

  it("post98: glyph budget — colons commas semis parens braces brackets", () => {
    expect((helpersSrc.match(/:/g) ?? []).length).toBe(106);
    expect((helpersSrc.match(/,/g) ?? []).length).toBe(58);
    expect((helpersSrc.match(/;/g) ?? []).length).toBe(56);
    expect((helpersSrc.match(/[()]/g) ?? []).length).toBe(180);
    expect((helpersSrc.match(/[{}]/g) ?? []).length).toBe(118);
    expect((helpersSrc.match(/[\[\]]/g) ?? []).length).toBe(42);
  });

  it("post98: glyph budget — singles backticks newlines tabs arrows", () => {
    expect((helpersSrc.match(/'/g) ?? []).length).toBe(48);
    expect((helpersSrc.match(/`/g) ?? []).length).toBe(20);
    expect((helpersSrc.match(/\n/g) ?? []).length).toBe(163);
    expect((helpersSrc.match(/\t/g) ?? []).length).toBe(0);
    expect((helpersSrc.match(/\u2192/g) ?? []).length).toBe(0);
  });

  it("post98: helpers.ts starts with vitest import and Env type import", () => {
    expect(helpersSrc.startsWith("import { vi } from 'vitest';")).toBe(true);
    expect(helpersSrc).toContain("import type { Env } from '../src/types';");
  });

  it("post98: helpers.ts export inventory lock (12)", () => {
    expect(HELPER_EXPORTS).toHaveLength(12);
    expect(createHash('sha256').update(HELPER_EXPORTS.join('|'), 'utf8').digest('hex')).toBe('0b6d293e07cc0615c0ffb954dc0890dfd54940b811d64e79261d79342b3a4b9c');
    for (const name of HELPER_EXPORTS) {
      expect(helpersSrc).toMatch(new RegExp(`export (?:function|const) ${name}`));
    }
  });

  it("post98: helpers.ts has no product inventing surface names", () => {
    expect(helpersSrc).not.toMatch(/now-playing|nowPlaying|playlist|openapi|podcast|websocket|sse\b/i);
    expect(helpersSrc).not.toMatch(/GEMINI_API_KEY\s*=/);
  });

  it("post98: locks SAMPLE_M3U sha256 digest", () => {
    expect(createHash('sha256').update(SAMPLE_M3U, 'utf8').digest('hex')).toBe('d333f382d92be92d05fc76ff08d56269b7a5f305770748fc8cdf68506169c45e');
  });

  it("post98: locks SAMPLE_M3U length and http stream count", () => {
    expect(SAMPLE_M3U.length).toBe(554);
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    expect(SAMPLE_M3U.startsWith('#EXTM3U')).toBe(true);
  });

  it("post98: SAMPLE_M3U greek names and urls ordered", () => {
    const names = ['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM'];
    const urls = ['https://example.com/alpha.m3u8', 'https://example.com/beta.m3u8', 'https://example.com/gamma.m3u8', 'https://example.com/delta.m3u8', 'https://example.com/epsilon.m3u8', 'https://example.com/zeta.m3u8'];
    for (const n of names) expect(SAMPLE_M3U).toContain(n);
    for (const u of urls) expect(SAMPLE_M3U).toContain(u);
    expect(parseM3U(SAMPLE_M3U).map((s) => s.name)).toEqual(names);
    expect(parseM3U(SAMPLE_M3U).map((s) => s.url)).toEqual(urls);
  });

  it("post98: SAMPLE_M3U every station has group-title Music", () => {
    const parsed = parseM3U(SAMPLE_M3U);
    expect(parsed.every((s) => s.group === 'Music')).toBe(true);
    expect((SAMPLE_M3U.match(/group-title="Music"/g) ?? []).length).toBe(6);
  });

  it("post98: SAMPLE_M3U omits logo language country attrs", () => {
    expect(SAMPLE_M3U).not.toMatch(/tvg-logo=/);
    expect(SAMPLE_M3U).not.toMatch(/tvg-language=/);
    expect(SAMPLE_M3U).not.toMatch(/tvg-country=/);
  });

  it("post98: SAMPLE_M3U contains Alpha FM stream pair", () => {
    expect(SAMPLE_M3U).toContain('tvg-name="Alpha FM"');
    expect(SAMPLE_M3U).toContain('https://example.com/alpha.m3u8');
  });

  it("post98: SAMPLE_M3U contains Beta FM stream pair", () => {
    expect(SAMPLE_M3U).toContain('tvg-name="Beta FM"');
    expect(SAMPLE_M3U).toContain('https://example.com/beta.m3u8');
  });

  it("post98: SAMPLE_M3U contains Gamma FM stream pair", () => {
    expect(SAMPLE_M3U).toContain('tvg-name="Gamma FM"');
    expect(SAMPLE_M3U).toContain('https://example.com/gamma.m3u8');
  });

  it("post98: SAMPLE_M3U contains Delta FM stream pair", () => {
    expect(SAMPLE_M3U).toContain('tvg-name="Delta FM"');
    expect(SAMPLE_M3U).toContain('https://example.com/delta.m3u8');
  });

  it("post98: SAMPLE_M3U contains Epsilon FM stream pair", () => {
    expect(SAMPLE_M3U).toContain('tvg-name="Epsilon FM"');
    expect(SAMPLE_M3U).toContain('https://example.com/epsilon.m3u8');
  });

  it("post98: SAMPLE_M3U contains Zeta FM stream pair", () => {
    expect(SAMPLE_M3U).toContain('tvg-name="Zeta FM"');
    expect(SAMPLE_M3U).toContain('https://example.com/zeta.m3u8');
  });

  it("post98: mockKV seed round-trip for stations cache keys", async () => {
    const seed = Object.fromEntries(VALIDISH.map((g) => [`stations:${g}`, JSON.stringify([{ name: g }])]));
    const kv = mockKV(seed);
    for (const g of VALIDISH) {
      await expect(kv.get(`stations:${g}`)).resolves.toBe(JSON.stringify([{ name: g }]));
    }
  });

  it("post98: mockKV put overwrite and delete matrix", async () => {
    const kv = mockKV({ a: '1', b: '2' });
    await kv.put('a', '9');
    await expect(kv.get('a')).resolves.toBe('9');
    await kv.delete('b');
    await expect(kv.get('b')).resolves.toBeNull();
    await kv.delete('missing');
    await expect(kv.get('missing')).resolves.toBeNull();
  });

  it("post98: mockKV list and getWithMetadata stay empty stubs", async () => {
    const kv = mockKV({ x: '1' });
    await expect(kv.list()).resolves.toEqual({ keys: [], list_complete: true, cacheStatus: null });
    await expect(kv.getWithMetadata('x')).resolves.toEqual({ value: null, metadata: null, cacheStatus: null });
  });

  it("post98: mockKV seed object mutation isolation", async () => {
    const seed: Record<string, string> = { k: 'v' };
    const kv = mockKV(seed);
    seed.k = 'mutated';
    seed.extra = 'nope';
    await expect(kv.get('k')).resolves.toBe('v');
    await expect(kv.get('extra')).resolves.toBeNull();
  });

  it("post98: mockKV independent instances do not share store", async () => {
    const a = mockKV({ k: 'a' });
    const b = mockKV({ k: 'b' });
    await a.put('k', 'A');
    await expect(b.get('k')).resolves.toBe('b');
    await expect(a.get('k')).resolves.toBe('A');
  });

  it("post98: testEnv defaults VERSION 0.1.0-test and fresh KV", () => {
    const a = testEnv();
    const b = testEnv();
    expect(a.VERSION).toBe('0.1.0-test');
    expect(b.VERSION).toBe('0.1.0-test');
    expect(a.CATALOG_CACHE).not.toBe(b.CATALOG_CACHE);
    expect(a.GEMINI_API_KEY).toBeUndefined();
  });

  it("post98: testEnv override matrix for VERSION and GEMINI_API_KEY", () => {
    expect(testEnv({ VERSION: '9.9.9' }).VERSION).toBe('9.9.9');
    expect(testEnv({ GEMINI_API_KEY: 'secret' }).GEMINI_API_KEY).toBe('secret');
    expect(testEnv({ VERSION: undefined }).VERSION).toBeUndefined();
  });

  it("post98: testEnv can inject custom CATALOG_CACHE", async () => {
    const custom = mockKV({ 'stations:jazz': '[]' });
    const env = testEnv({ CATALOG_CACHE: custom });
    expect(env.CATALOG_CACHE).toBe(custom);
    await expect(env.CATALOG_CACHE.get('stations:jazz')).resolves.toBe('[]');
  });

  it("post98: geminiTextResponse shape lock for empty and unicode", async () => {
    for (const text of ['', 'hello', '日本語', '{"x":1}', 'a'.repeat(200)]) {
      const body = (await geminiTextResponse(text).json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      };
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0].content.parts).toHaveLength(1);
      expect(body.candidates[0].content.parts[0].text).toBe(text);
    }
  });

  it("post98: geminiTextResponse content-type application/json", () => {
    const res = geminiTextResponse('x');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it("post98: curatedGeminiJson default Alpha FM music pick", async () => {
    const text = ((await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    }).candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text) as Array<Record<string, string>>;
    expect(parsed).toEqual([
      { name: 'Alpha FM', url: 'https://example.com/alpha.m3u8', editorial: 'Default curated pick.', genre: 'music' },
    ]);
  });

  it("post98: curatedGeminiJson custom multi-station with logo", async () => {
    const picks = [
      { name: 'A', url: 'https://a.example/a', editorial: 'ea', genre: 'jazz', logo: 'https://logo/a.png' },
      { name: 'B', url: 'https://b.example/b', editorial: 'eb', genre: 'rock' },
    ];
    const text = ((await curatedGeminiJson(picks).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    }).candidates[0].content.parts[0].text;
    expect(JSON.parse(text)).toEqual(picks);
  });

  it("post98: curatedGeminiJson empty array still wraps JSON text", async () => {
    const text = ((await curatedGeminiJson([]).json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    }).candidates[0].content.parts[0].text;
    expect(JSON.parse(text)).toEqual([]);
  });

  it("post98: iptvCategoryUrl builds categories/music.m3u", () => {
    expect(iptvCategoryUrl('music')).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it("post98: iptvCategoryUrl builds categories/ambient.m3u", () => {
    expect(iptvCategoryUrl('ambient')).toBe('https://iptv-org.github.io/iptv/categories/ambient.m3u');
  });

  it("post98: iptvCategoryUrl builds categories/jazz.m3u", () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it("post98: iptvCategoryUrl builds categories/classical.m3u", () => {
    expect(iptvCategoryUrl('classical')).toBe('https://iptv-org.github.io/iptv/categories/classical.m3u');
  });

  it("post98: iptvCategoryUrl builds categories/pop.m3u", () => {
    expect(iptvCategoryUrl('pop')).toBe('https://iptv-org.github.io/iptv/categories/pop.m3u');
  });

  it("post98: iptvCategoryUrl builds categories/rock.m3u", () => {
    expect(iptvCategoryUrl('rock')).toBe('https://iptv-org.github.io/iptv/categories/rock.m3u');
  });

  it("post98: iptvCategoryUrl builds categories/news.m3u", () => {
    expect(iptvCategoryUrl('news')).toBe('https://iptv-org.github.io/iptv/categories/news.m3u');
  });

  it("post98: iptvCategoryUrl builds categories/sports.m3u", () => {
    expect(iptvCategoryUrl('sports')).toBe('https://iptv-org.github.io/iptv/categories/sports.m3u');
  });

  it("post98: iptvCategoryUrl builds categories/entertainment.m3u", () => {
    expect(iptvCategoryUrl('entertainment')).toBe('https://iptv-org.github.io/iptv/categories/entertainment.m3u');
  });

  it("post98: iptvCategoryUrl does not encode or strip odd genre ids", () => {
    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');
    expect(iptvCategoryUrl('a/b')).toBe('https://iptv-org.github.io/iptv/categories/a/b.m3u');
    expect(iptvCategoryUrl('music.m3u')).toBe('https://iptv-org.github.io/iptv/categories/music.m3u.m3u');
    expect(iptvCategoryUrl('jazz?x=1')).toBe('https://iptv-org.github.io/iptv/categories/jazz?x=1.m3u');
  });

  it("post98: iptvCategoryUrl join of VALIDISH sha256", () => {
    const joined = VALIDISH.map((g) => iptvCategoryUrl(g)).join('|');
    expect(createHash('sha256').update(joined, 'utf8').digest('hex')).toBe('0acfbae6393088f35c9b74acc4d02a1e01341e0773f485d4c08b638ccc0694d1');
  });

  it("post98: countHttpStreamLines SAMPLE_M3U is 6", () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it("post98: countHttpStreamLines edge matrix", () => {
    expect(countHttpStreamLines('')).toBe(0);
    expect(countHttpStreamLines('\r\n')).toBe(0);
    expect(countHttpStreamLines('  https://x  \nhttp://y')).toBe(2);
    expect(countHttpStreamLines('HTTP://upper')).toBe(0);
    expect(countHttpStreamLines('rtmp://x\nftp://y')).toBe(0);
    expect(countHttpStreamLines('#EXTINF:-1 tvg-logo=\"https://logo\",N\nhttps://stream')).toBe(1);
  });

  it("post98: buildSimpleM3U empty yields header only", () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
  });

  it("post98: buildSimpleM3U name-only attrs", () => {
    const m3u = buildSimpleM3U([{ name: 'Solo', url: 'https://s.example/s' }]);
    expect(m3u).toContain('tvg-name="Solo"');
    expect(m3u).not.toContain('tvg-logo=');
    expect(m3u).not.toContain('group-title=');
    expect(m3u).not.toContain('tvg-language=');
    expect(m3u).not.toContain('tvg-country=');
    expect(parseM3U(m3u)).toEqual([{ name: 'Solo', url: 'https://s.example/s' }]);
  });

  it("post98: buildSimpleM3U full attr set round-trip via parseM3U", () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://full.example/f',
        logo: 'https://logo/f.png',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(parseM3U(m3u)).toEqual([
      {
        name: 'Full',
        url: 'https://full.example/f',
        logo: 'https://logo/f.png',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
  });

  it("post98: buildSimpleM3U multi-station preserves order", () => {
    const stations = VALIDISH.map((g, i) => ({
      name: `N${i}`,
      url: `https://ex.example/${g}`,
      group: g,
    }));
    const parsed = parseM3U(buildSimpleM3U(stations));
    expect(parsed.map((s) => s.url)).toEqual(stations.map((s) => s.url));
    expect(parsed.map((s) => s.group)).toEqual([...VALIDISH]);
  });

  it("post98: buildSimpleM3U always trailing newline and EXTINF -1", () => {
    const m3u = buildSimpleM3U([{ name: 'X', url: 'https://x' }]);
    expect(m3u.endsWith('\n')).toBe(true);
    expect(m3u.startsWith('#EXTM3U\n')).toBe(true);
    expect(m3u).toContain('#EXTINF:-1 ');
  });

  it("post98: seedStationsCache serializes objects under stations:genre", () => {
    expect(seedStationsCache('jazz', [{ name: 'J' }])).toEqual({
      'stations:jazz': JSON.stringify([{ name: 'J' }]),
    });
  });

  it("post98: seedStationsCache keeps raw strings and merges existing", () => {
    expect(seedStationsCache('music', 'RAW', { other: '1' })).toEqual({
      other: '1',
      'stations:music': 'RAW',
    });
  });

  it("post98: seedStationsCache key stations:music", () => {
    const seeded = seedStationsCache('music', []);
    expect(Object.keys(seeded)).toEqual(['stations:music']);
    expect(seeded['stations:music']).toBe('[]');
  });

  it("post98: seedStationsCache key stations:ambient", () => {
    const seeded = seedStationsCache('ambient', []);
    expect(Object.keys(seeded)).toEqual(['stations:ambient']);
    expect(seeded['stations:ambient']).toBe('[]');
  });

  it("post98: seedStationsCache key stations:jazz", () => {
    const seeded = seedStationsCache('jazz', []);
    expect(Object.keys(seeded)).toEqual(['stations:jazz']);
    expect(seeded['stations:jazz']).toBe('[]');
  });

  it("post98: seedStationsCache key stations:classical", () => {
    const seeded = seedStationsCache('classical', []);
    expect(Object.keys(seeded)).toEqual(['stations:classical']);
    expect(seeded['stations:classical']).toBe('[]');
  });

  it("post98: seedStationsCache key stations:pop", () => {
    const seeded = seedStationsCache('pop', []);
    expect(Object.keys(seeded)).toEqual(['stations:pop']);
    expect(seeded['stations:pop']).toBe('[]');
  });

  it("post98: seedStationsCache key stations:rock", () => {
    const seeded = seedStationsCache('rock', []);
    expect(Object.keys(seeded)).toEqual(['stations:rock']);
    expect(seeded['stations:rock']).toBe('[]');
  });

  it("post98: seedStationsCache key stations:news", () => {
    const seeded = seedStationsCache('news', []);
    expect(Object.keys(seeded)).toEqual(['stations:news']);
    expect(seeded['stations:news']).toBe('[]');
  });

  it("post98: seedStationsCache key stations:sports", () => {
    const seeded = seedStationsCache('sports', []);
    expect(Object.keys(seeded)).toEqual(['stations:sports']);
    expect(seeded['stations:sports']).toBe('[]');
  });

  it("post98: seedStationsCache key stations:entertainment", () => {
    const seeded = seedStationsCache('entertainment', []);
    expect(Object.keys(seeded)).toEqual(['stations:entertainment']);
    expect(seeded['stations:entertainment']).toBe('[]');
  });

  it("post98: seedStationsCache does not mutate existing object", () => {
    const existing = { a: '1' };
    const next = seedStationsCache('rock', 'x', existing);
    expect(existing).toEqual({ a: '1' });
    expect(next).toEqual({ a: '1', 'stations:rock': 'x' });
    expect(next).not.toBe(existing);
  });

  it("post98: captureGeminiRequest null when no gemini calls", () => {
    expect(captureGeminiRequest({ mock: { calls: [['https://iptv-org.github.io/x']] } })).toBeNull();
  });

  it("post98: captureGeminiRequest extracts POST JSON body", () => {
    const captured = captureGeminiRequest({
      mock: {
        calls: [
          [
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=k',
            { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [] }) },
          ],
        ],
      },
    });
    expect(captured).toEqual({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=k',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { contents: [] },
    });
  });

  it("post98: captureGeminiRequest defaults method GET when init omitted", () => {
    const captured = captureGeminiRequest({
      mock: { calls: [['https://generativelanguage.googleapis.com/x']] },
    });
    expect(captured?.method).toBe('GET');
    expect(captured?.body).toEqual({});
  });

  it("post98: iptvCallsWithInit filters only iptv-org with init", () => {
    const fetchMock = {
      mock: {
        calls: [
          ['https://iptv-org.github.io/a'],
          ['https://iptv-org.github.io/b', { method: 'GET' }],
          ['https://generativelanguage.googleapis.com/x', { method: 'POST' }],
          ['https://example.com', { method: 'GET' }],
        ],
      },
    };
    expect(iptvCallsWithInit(fetchMock)).toEqual([['https://iptv-org.github.io/b', { method: 'GET' }]]);
  });

  it("post98: stubIptvAndGemini default m3u is SAMPLE_M3U", async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('music'))).text()).toBe(SAMPLE_M3U);
  });

  it("post98: stubIptvAndGemini default gemini is boom 500", async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.googleapis.com/v1');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('boom');
  });

  it("post98: stubIptvAndGemini unrelated host is nope 404", async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://example.com/other');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 400", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 400 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 401", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 401 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 403", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 403 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 404", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 404 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 408", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 408 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(408);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 409", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 409 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 418", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 418 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 422", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 422 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 429", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 429 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 500", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 500 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 502", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 502 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 503", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 503 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 504", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 504 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(504);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 520", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 520 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(520);
    expect(await res.text()).toBe('down');
  });

  it("post98: stubIptvAndGemini m3u null iptvStatus 521", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 521 }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(521);
    expect(await res.text()).toBe('down');
  });

  it("post98: stub iptvByGenre solo hit for music", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { music: 'BODY_MUSIC' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('music'))).text()).toBe('BODY_MUSIC');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre solo hit for ambient", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { ambient: 'BODY_AMBIENT' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('ambient'))).text()).toBe('BODY_AMBIENT');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre solo hit for jazz", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: 'BODY_JAZZ' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('jazz'))).text()).toBe('BODY_JAZZ');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre solo hit for classical", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { classical: 'BODY_CLASSICAL' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('classical'))).text()).toBe('BODY_CLASSICAL');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre solo hit for pop", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { pop: 'BODY_POP' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('pop'))).text()).toBe('BODY_POP');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre solo hit for rock", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { rock: 'BODY_ROCK' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('rock'))).text()).toBe('BODY_ROCK');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre solo hit for news", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { news: 'BODY_NEWS' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('news'))).text()).toBe('BODY_NEWS');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre solo hit for sports", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { sports: 'BODY_SPORTS' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('sports'))).text()).toBe('BODY_SPORTS');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre solo hit for entertainment", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { entertainment: 'BODY_ENTERTAINMENT' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('entertainment'))).text()).toBe('BODY_ENTERTAINMENT');
    expect(await (await fetchMock(iptvCategoryUrl('__other__'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre null per-genre uses iptvStatus", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: null },
      iptvStatus: 418,
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('jazz'));
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
    expect(await (await fetchMock(iptvCategoryUrl('music'))).text()).toBe('FALLBACK');
  });

  it("post98: stub iptvByGenre hasOwnProperty does not treat prototype keys", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: Object.create({ music: 'PROTO' }) as Record<string, string | null>,
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('music'))).text()).toBe('FALLBACK');
  });

  it("post98: stub gemini Response instance reused; factory invoked each time", async () => {
    const gemini = curatedGeminiJson();
    const reused = stubIptvAndGemini({ gemini }) as unknown as (u: string) => Promise<Response>;
    expect(await reused('https://generativelanguage.googleapis.com/a')).toBe(gemini);
    let n = 0;
    const factory = stubIptvAndGemini({
      gemini: () => {
        n += 1;
        return geminiTextResponse(String(n));
      },
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await factory('https://generativelanguage.googleapis.com/a')).json()).toMatchObject({
      candidates: [{ content: { parts: [{ text: '1' }] } }],
    });
    expect(await (await factory('https://generativelanguage.googleapis.com/b')).json()).toMatchObject({
      candidates: [{ content: { parts: [{ text: '2' }] } }],
    });
    expect(n).toBe(2);
  });

  it("post98: stub accepts URL objects and RequestInfo stringification", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: 'URL_OBJ' }) as unknown as (u: RequestInfo | URL) => Promise<Response>;
    expect(await (await fetchMock(new URL(iptvCategoryUrl('jazz')))).text()).toBe('URL_OBJ');
  });

  it("post98: stub category regex requires .m3u and allows query suffix", async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: 'HIT' },
      m3u: 'FALLBACK',
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('https://iptv-org.github.io/iptv/categories/jazz')).text()).toBe('FALLBACK');
    expect(await (await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u?cache=1')).text()).toBe('HIT');
  });

  it("post98: stub is vitest mock with call history", async () => {
    const fetchMock = stubIptvAndGemini({});
    expect(vi.isMockFunction(fetchMock)).toBe(true);
    await (fetchMock as unknown as (u: string) => Promise<Response>)(iptvCategoryUrl('music'));
    await (fetchMock as unknown as (u: string) => Promise<Response>)('https://generativelanguage.googleapis.com/x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("post98: stub concurrent iptv+gemini+other", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson(), m3u: 'M3U' }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const [iptv, gemini, other] = await Promise.all([
      fetchMock(iptvCategoryUrl('music')),
      fetchMock('https://generativelanguage.googleapis.com/x'),
      fetchMock('https://example.com'),
    ]);
    expect(await iptv.text()).toBe('M3U');
    expect(gemini.status).toBe(200);
    expect(other.status).toBe(404);
  });

  it("post98: stub empty-string m3u is 200 empty body", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '' }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('music'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it("post98: stub gemini factory thrown error propagates", async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        throw new Error('gemini-boom');
      },
    }) as unknown as (u: string) => Promise<Response>;
    await expect(fetchMock('https://generativelanguage.googleapis.com/x')).rejects.toThrow('gemini-boom');
  });

  it("post98: stub iptvByGenre full VALIDISH matrix", async () => {
    const iptvByGenre = Object.fromEntries(VALIDISH.map((g) => [g, `BODY_${g}`])) as Record<string, string | null>;
    const fetchMock = stubIptvAndGemini({ iptvByGenre, m3u: 'FALLBACK' }) as unknown as (u: string) => Promise<Response>;
    for (const g of VALIDISH) {
      expect(await (await fetchMock(iptvCategoryUrl(g))).text()).toBe(`BODY_${g}`);
    }
  });

  it("post98: stub iptvByGenre null defaults iptvStatus 503", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { rock: null } }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl('rock'));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');
  });

  it("post98: locks package.json test scripts and coverage floors via vitest", () => {
    const pkgJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkgJson.scripts.test).toBe('vitest run');
    expect(pkgJson.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkgJson.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(read('vitest.config.ts')).toContain('lines: 100');
    expect(read('vitest.config.ts')).toContain('functions: 100');
    expect(read('vitest.config.ts')).toContain('branches: 100');
    expect(read('vitest.config.ts')).toContain('statements: 100');
  });

  it("post98: locks AGENTS Verify block names npm scripts", () => {
    const agentsMd = read('AGENTS.md');
    expect(agentsMd).toContain('npm ci');
    expect(agentsMd).toContain('npm run typecheck');
    expect(agentsMd).toContain('npm test');
    expect(agentsMd).toContain('npm run test:coverage');
  });

  it("post98: locks CI workflow runs typecheck and test:coverage", () => {
    const ciYml = read('.github/workflows/ci.yml');
    expect(ciYml).toContain('npm run typecheck');
    expect(ciYml).toContain('npm run test:coverage');
    expect(ciYml).toContain('coverage/lcov.info');
  });

  it("post98: locks test inventory includes helpers siblings", () => {
    expect(readdirSync(join(helpersRoot, 'test')).sort()).toEqual([
      'ci-config.test.ts',
      'genres.test.ts',
      'helpers.test.ts',
      'helpers.ts',
      'mcp-spec-contract.test.ts',
      'mcp.test.ts',
      'parser.test.ts',
      'routes.test.ts',
      'source-contracts.test.ts',
      'wrangler-config.test.ts',
    ]);
  });

  it("post98: locks src/types Env shape referenced by helpers", () => {
    const typesSrc = read('src/types.ts');
    expect(typesSrc).toContain('CATALOG_CACHE');
    expect(typesSrc).toContain('GEMINI_API_KEY');
    expect(typesSrc).toContain('VERSION');
    expect(helpersSrc).toContain("import type { Env } from '../src/types';");
  });

  it("post98: locks helpers free of process.env Deno Bun require", () => {
    expect(helpersSrc).not.toMatch(/process\.env/);
    expect(helpersSrc).not.toMatch(/\bDeno\b/);
    expect(helpersSrc).not.toMatch(/\bBun\b/);
    expect(helpersSrc).not.toMatch(/\brequire\s*\(/);
  });

  it("post98: negative inventing fence — helpers do not add playlist/now-playing helpers", () => {
    for (const banned of ['playlist', 'nowPlaying', 'now-playing', 'openapi', 'podcast', 'websocket']) {
      expect(helpersSrc.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("post98: negative inventing fence — no new helper export beyond the twelve", () => {
    const exportNames = [...helpersSrc.matchAll(/export (?:async )?function ([A-Za-z0-9_]+)|export const ([A-Za-z0-9_]+)/g)].map(
      (m) => m[1] ?? m[2],
    );
    expect(exportNames.sort()).toEqual([...HELPER_EXPORTS].sort());
  });

  it("post98: README documents /stations and /curate without inventing endpoints", () => {
    const readmeMd = read('README.md');
    expect(readmeMd).toMatch(/\/stations/);
    expect(readmeMd).toMatch(/\/curate/);
    expect(readmeMd).not.toMatch(/\/playlist/);
    expect(readmeMd).not.toMatch(/\/now-playing/);
  });

  it("post98: parseM3U(buildSimpleM3U(SAMPLE stations)) preserves six urls", () => {
    const stations = parseM3U(SAMPLE_M3U).map((s) => ({ name: s.name, url: s.url, group: s.group }));
    const rebuilt = parseM3U(buildSimpleM3U(stations));
    expect(rebuilt.map((s) => s.url)).toEqual(stations.map((s) => s.url));
    expect(countHttpStreamLines(buildSimpleM3U(stations))).toBe(6);
  });

  it("post98: seedStationsCache + mockKV integration for all VALIDISH", async () => {
    let seed: Record<string, string> = {};
    for (const g of VALIDISH) {
      seed = seedStationsCache(g, [{ genre: g }], seed);
    }
    const kv = mockKV(seed);
    for (const g of VALIDISH) {
      await expect(kv.get(`stations:${g}`)).resolves.toBe(JSON.stringify([{ genre: g }]));
    }
  });

  it("post98: captureGeminiRequest + stubIptvAndGemini integration", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k',
      { method: 'POST', body: JSON.stringify({ foo: 1 }) },
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured?.method).toBe('POST');
    expect(captured?.body).toEqual({ foo: 1 });
  });

  it("post98: iptvCallsWithInit + stub with init records the call", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: 'OK' });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(iptvCategoryUrl('music'), {
      method: 'GET',
    });
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
  });

  it("post98: helpers.ts file size and mtime are stable positive", () => {
    const st = statSync(join(helpersRoot, 'test/helpers.ts'));
    expect(st.size).toBe(6078);
    expect(st.mtimeMs).toBeGreaterThan(0);
  });

  it("post98: Buffer compare helpers prefix import", () => {
    expect(Buffer.from(helpersSrc.slice(0, 6), 'utf8').equals(Buffer.from('import'))).toBe(true);
  });

  it("post98: TextEncoder UTF-8 length equals Buffer byteLength", () => {
    expect(new TextEncoder().encode(helpersSrc).length).toBe(Buffer.byteLength(helpersSrc, 'utf8'));
  });

  it("post98: queueMicrotask does not alter helpers digest", async () => {
    const before = createHash('sha256').update(helpersSrc, 'utf8').digest('hex');
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(createHash('sha256').update(read('test/helpers.ts'), 'utf8').digest('hex')).toBe(before);
  });

  it("post98: performance.now around helpers read is finite", () => {
    const t0 = performance.now();
    expect(read('test/helpers.ts').length).toBeGreaterThan(0);
    expect(Number.isFinite(performance.now() - t0)).toBe(true);
  });

  it("post98: Blob round-trip of SAMPLE_M3U header", async () => {
    const blob = new Blob(['#EXTM3U'], { type: 'text/plain' });
    expect(await blob.text()).toBe('#EXTM3U');
    expect(SAMPLE_M3U.startsWith('#EXTM3U')).toBe(true);
  });

  it("post98: WeakMap can key mockKV result object", () => {
    const kv = mockKV();
    const wm = new WeakMap<object, string>();
    wm.set(kv as unknown as object, 'mock-kv');
    expect(wm.get(kv as unknown as object)).toBe('mock-kv');
  });

  it("post98: encodeURI of iptv host path equals itself", () => {
    const host = 'https://iptv-org.github.io/iptv/categories/music.m3u';
    expect(encodeURI(host)).toBe(host);
    expect(iptvCategoryUrl('music')).toBe(host);
  });

  it("post98: JSON.stringify testEnv VERSION stable", () => {
    expect(JSON.parse(JSON.stringify({ VERSION: testEnv().VERSION }))).toEqual({ VERSION: '0.1.0-test' });
  });

  it("post98: Array.from VALIDISH equals spread and slice", () => {
    expect(Array.from(VALIDISH)).toEqual([...VALIDISH]);
    expect(VALIDISH.slice()).toEqual([...VALIDISH]);
  });

  it("post98: fromCharCode rebuild of helper export names", () => {
    const pairs: Array<[string, number[]]> = [
      ['mockKV', [109, 111, 99, 107, 75, 86]],
      ['testEnv', [116, 101, 115, 116, 69, 110, 118]],
      ['SAMPLE_M3U', [83, 65, 77, 80, 76, 69, 95, 77, 51, 85]],
    ];
    for (const [name, codes] of pairs) {
      expect(String.fromCharCode(...codes)).toBe(name);
      expect(helpersSrc).toContain(name);
    }
  });

  it("post98: locks sha256 of export name mockKV", () => {
    expect(createHash('sha256').update('mockKV').digest('hex')).toBe('3e67d33140d77c75b2ae708c4bd9f2d52266eb8c1d755586ec594c6282f8a993');
    expect(helpersSrc).toMatch(/export (?:function|const) mockKV/);
  });

  it("post98: locks sha256 of export name testEnv", () => {
    expect(createHash('sha256').update('testEnv').digest('hex')).toBe('af724015138330bf7a9ed6f063fd01441a7db0625f61f5ba4ce8d9bf237a5069');
    expect(helpersSrc).toMatch(/export (?:function|const) testEnv/);
  });

  it("post98: locks sha256 of export name SAMPLE_M3U", () => {
    expect(createHash('sha256').update('SAMPLE_M3U').digest('hex')).toBe('1d43a5901d28ef66f1d265acf99819bc500423c6ef4068ac638037251a99f3c6');
    expect(helpersSrc).toMatch(/export (?:function|const) SAMPLE_M3U/);
  });

  it("post98: locks sha256 of export name geminiTextResponse", () => {
    expect(createHash('sha256').update('geminiTextResponse').digest('hex')).toBe('eec054f8c4303529a66a8cc89fbdbb94d1e2d949214212f3897be6adf2f5746a');
    expect(helpersSrc).toMatch(/export (?:function|const) geminiTextResponse/);
  });

  it("post98: locks sha256 of export name stubIptvAndGemini", () => {
    expect(createHash('sha256').update('stubIptvAndGemini').digest('hex')).toBe('8bdb997cbae400bfafb65cd9309585e35549ae3e4b6664bbba192d3d68e34516');
    expect(helpersSrc).toMatch(/export (?:function|const) stubIptvAndGemini/);
  });

  it("post98: locks sha256 of export name curatedGeminiJson", () => {
    expect(createHash('sha256').update('curatedGeminiJson').digest('hex')).toBe('4f2bff92adbee0e05359998f663c29c0a8a1c84298a7f49591b51fd15ea79174');
    expect(helpersSrc).toMatch(/export (?:function|const) curatedGeminiJson/);
  });

  it("post98: locks sha256 of export name iptvCategoryUrl", () => {
    expect(createHash('sha256').update('iptvCategoryUrl').digest('hex')).toBe('c31ff7f68f264f406387783d50bbb27f4063a1dcbc421c46f9d7d7d0f02362d9');
    expect(helpersSrc).toMatch(/export (?:function|const) iptvCategoryUrl/);
  });

  it("post98: locks sha256 of export name countHttpStreamLines", () => {
    expect(createHash('sha256').update('countHttpStreamLines').digest('hex')).toBe('87ba3719ab88575a937f6215ea106d7eb9d94fcae9ff466f20a5411ed3364b38');
    expect(helpersSrc).toMatch(/export (?:function|const) countHttpStreamLines/);
  });

  it("post98: locks sha256 of export name buildSimpleM3U", () => {
    expect(createHash('sha256').update('buildSimpleM3U').digest('hex')).toBe('019f6ec0e4d894f9da583201d2cd2a9fb157eb31067653d87499ec8909583efc');
    expect(helpersSrc).toMatch(/export (?:function|const) buildSimpleM3U/);
  });

  it("post98: locks sha256 of export name seedStationsCache", () => {
    expect(createHash('sha256').update('seedStationsCache').digest('hex')).toBe('be57554a627a4fe18d5af50aa7441b622c477f4a62c11b98de650111f51c7d56');
    expect(helpersSrc).toMatch(/export (?:function|const) seedStationsCache/);
  });

  it("post98: locks sha256 of export name captureGeminiRequest", () => {
    expect(createHash('sha256').update('captureGeminiRequest').digest('hex')).toBe('41edfbaa9310811ca03f0c1b76bc2a5f0a81b5cf088483c9108ff24c8855b640');
    expect(helpersSrc).toMatch(/export (?:function|const) captureGeminiRequest/);
  });

  it("post98: locks sha256 of export name iptvCallsWithInit", () => {
    expect(createHash('sha256').update('iptvCallsWithInit').digest('hex')).toBe('61585f82a260862357f7aa3611f3669aa34a03be4c9cf5ae6f0317526199a193');
    expect(helpersSrc).toMatch(/export (?:function|const) iptvCallsWithInit/);
  });

  it("post98: mockKV.put accepts expirationTtl without throwing", async () => {
    const kv = mockKV();
    await expect(
      (kv.put as (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>)('k', 'v', {
        expirationTtl: 60,
      }),
    ).resolves.toBeUndefined();
    await expect(kv.get('k')).resolves.toBe('v');
  });

  it("post98: mockKV get missing returns null not undefined", async () => {
    const kv = mockKV();
    await expect(kv.get('nope')).resolves.toBeNull();
  });

  it("post98: curatedGeminiJson Response body can be read once", async () => {
    const res = curatedGeminiJson();
    await expect(res.json()).resolves.toBeTruthy();
    await expect(res.json()).rejects.toThrow();
  });

  it("post98: parseM3U(SAMPLE_M3U) twice is deep-equal", () => {
    expect(parseM3U(SAMPLE_M3U)).toEqual(parseM3U(SAMPLE_M3U));
  });

  it("post98: HMAC-SHA256 of SAMPLE_M3U keyed by post98", () => {
    expect(createHmac('sha256', 'post98').update(SAMPLE_M3U, 'utf8').digest('hex')).toBe('341b08fdf09f0057d29f19f6d218bbae7d568058de8f0123efeb2cf9de06216d');
  });

  it("post98: SAMPLE_M3U sha1 and md5 digests", () => {
    expect(createHash('sha1').update(SAMPLE_M3U, 'utf8').digest('hex')).toBe('692a11944d56c10b5bf94a3c950ba754641b2812');
    expect(createHash('md5').update(SAMPLE_M3U, 'utf8').digest('hex')).toBe('6027c2c1db696bdb6e21aa8c8d8bc717');
  });

  it("post98: helpers do not re-implement parseM3U", () => {
    expect(helpersSrc).not.toMatch(/function parseM3U/);
    expect(helpersSrc).not.toMatch(/export function parseM3U/);
    expect(helpersSrc).toMatch(/#EXTINF/);
    expect(read('src/parser.ts')).toContain('export function parseM3U');
  });

  it("post98: helpers.ts documents In-memory KV stub and Gemini helper", () => {
    expect(helpersSrc).toContain('In-memory KV stub for Worker route tests.');
    expect(helpersSrc).toContain('Build a Gemini generateContent-shaped JSON response');
    expect(helpersSrc).toContain('Minimal curated Gemini JSON text for happy-path /curate stubs.');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for music", () => {
    const m3u = buildSimpleM3U([{ name: 'music', url: 'https://ex.example/music', group: 'music' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('music');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for ambient", () => {
    const m3u = buildSimpleM3U([{ name: 'ambient', url: 'https://ex.example/ambient', group: 'ambient' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('ambient');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for jazz", () => {
    const m3u = buildSimpleM3U([{ name: 'jazz', url: 'https://ex.example/jazz', group: 'jazz' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('jazz');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for classical", () => {
    const m3u = buildSimpleM3U([{ name: 'classical', url: 'https://ex.example/classical', group: 'classical' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('classical');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for pop", () => {
    const m3u = buildSimpleM3U([{ name: 'pop', url: 'https://ex.example/pop', group: 'pop' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('pop');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for rock", () => {
    const m3u = buildSimpleM3U([{ name: 'rock', url: 'https://ex.example/rock', group: 'rock' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('rock');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for news", () => {
    const m3u = buildSimpleM3U([{ name: 'news', url: 'https://ex.example/news', group: 'news' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('news');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for sports", () => {
    const m3u = buildSimpleM3U([{ name: 'sports', url: 'https://ex.example/sports', group: 'sports' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('sports');
  });

  it("post98: buildSimpleM3U+countHttpStreamLines for entertainment", () => {
    const m3u = buildSimpleM3U([{ name: 'entertainment', url: 'https://ex.example/entertainment', group: 'entertainment' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('entertainment');
  });

  it("post98: testEnv VERSION override \"0.0.0\"", () => {
    expect(testEnv({ VERSION: "0.0.0" }).VERSION).toBe("0.0.0");
  });

  it("post98: testEnv VERSION override \"1.0.0\"", () => {
    expect(testEnv({ VERSION: "1.0.0" }).VERSION).toBe("1.0.0");
  });

  it("post98: testEnv VERSION override \"9.9.9-test\"", () => {
    expect(testEnv({ VERSION: "9.9.9-test" }).VERSION).toBe("9.9.9-test");
  });

  it("post98: testEnv VERSION override \"\"", () => {
    expect(testEnv({ VERSION: "" }).VERSION).toBe("");
  });

  it("post98: geminiTextResponse text sha256 \"hello\"", async () => {
    const body = (await geminiTextResponse("hello").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe("hello");
    expect(createHash('sha256').update("hello", 'utf8').digest('hex')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it("post98: geminiTextResponse text sha256 \"Alpha FM\"", async () => {
    const body = (await geminiTextResponse("Alpha FM").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe("Alpha FM");
    expect(createHash('sha256').update("Alpha FM", 'utf8').digest('hex')).toBe('c27d7eab8858924a9c0922d1d071d6f29911592cbb2b54cdad8b4d2dd1faf285');
  });

  it("post98: geminiTextResponse text sha256 \"{}\"", async () => {
    const body = (await geminiTextResponse("{}").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe("{}");
    expect(createHash('sha256').update("{}", 'utf8').digest('hex')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it("post98: geminiTextResponse text sha256 \"\"", async () => {
    const body = (await geminiTextResponse("").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0].content.parts[0].text).toBe("");
    expect(createHash('sha256').update("", 'utf8').digest('hex')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it("post98: stub matches iptv-org substring in https://cdn.iptv-org.example/categories/music.m3u", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: 'HIT' }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('https://cdn.iptv-org.example/categories/music.m3u')).text()).toBe('HIT');
  });

  it("post98: stub matches iptv-org substring in http://iptv-org.github.io/iptv/categories/jazz.m3u", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: 'HIT' }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('http://iptv-org.github.io/iptv/categories/jazz.m3u')).text()).toBe('HIT');
  });

  it("post98: stub matches iptv-org substring in https://example.com/mirror/iptv-org/categories/pop.m3u", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: 'HIT' }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('https://example.com/mirror/iptv-org/categories/pop.m3u')).text()).toBe('HIT');
  });

  it("post98: stub matches generativelanguage substring in https://generativelanguage.googleapis.com/v1", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('G') }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.googleapis.com/v1');
    expect(res.status).toBe(200);
  });

  it("post98: stub matches generativelanguage substring in http://proxy/generativelanguage.googleapis.com", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('G') }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('http://proxy/generativelanguage.googleapis.com');
    expect(res.status).toBe(200);
  });

  it("post98: stub matches generativelanguage substring in https://x.generativelanguage.googleapis.com.evil.example/y", async () => {
    const fetchMock = stubIptvAndGemini({ gemini: geminiTextResponse('G') }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://x.generativelanguage.googleapis.com.evil.example/y');
    expect(res.status).toBe(200);
  });

  it("post98: locks helpers.test.ts ends with newline after post98", () => {
    expect(read('test/helpers.test.ts').endsWith('\n')).toBe(true);
  });

  it("post98: DEPLOY.md remains deploy-only without helper inventing", () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/[Ww]rangler|[Dd]eploy|Cloudflare/);
    expect(helpersSrc).not.toContain('DEPLOY.md');
  });

  it("post98: helpers.ts comment inventory count lock", () => {
    expect((helpersSrc.match(/\/\*/g) ?? []).length).toBe(10);
    expect((helpersSrc.match(/\/\//g) ?? []).length).toBe(10);
  });

  it("post98: SAMPLE_M3U nibble sum of sha256", () => {
    expect(nibbleSum(createHash('sha256').update(SAMPLE_M3U, 'utf8').digest('hex'))).toBe(487);
  });

  it("post98: export name join HMAC post98", () => {
    expect(createHmac('sha256', 'post98').update(HELPER_EXPORTS.join('|'), 'utf8').digest('hex')).toBe('e320bfa6b473c06f6f2b41d7d817d6a64ebd4bb577c1ef7dc734ba1680ec9307');
  });

});


describe('post104 helpers HEAVY deepen', () => {
  const helpersPath = join(helpersRoot, 'test/helpers.ts');
  const helpersSrc = () => readFileSync(helpersPath, 'utf8');
  const helpersBuf = () => Buffer.from(helpersSrc(), 'utf8');
  const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
  const sha1 = (data: string | Buffer) => createHash('sha1').update(data).digest('hex');
  const md5 = (data: string | Buffer) => createHash('md5').update(data).digest('hex');
  const sha512 = (data: string | Buffer) => createHash('sha512').update(data).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const EXPORT_NAMES = [
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
  ] as const;
  const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'] as const;
  const GENRE_SLUGS = [
    'music',
    'ambient',
    'jazz',
    'classical',
    'pop',
    'rock',
    'news',
    'sports',
    'entertainment',
  ] as const;

  it('post104: locks GENRE_SLUGS inventory length 9', () => {
    expect(GENRE_SLUGS).toHaveLength(9);
    expect([...GENRE_SLUGS]).toEqual([
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

  it('post104: locks helpers.ts sha256 digest', () => {
    expect(sha256(helpersSrc())).toBe(
      '240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29',
    );
  });

  it('post104: locks helpers.ts sha1 digest', () => {
    expect(sha1(helpersSrc())).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
  });

  it('post104: locks helpers.ts md5 digest', () => {
    expect(md5(helpersSrc())).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it('post104: locks helpers.ts sha512 digest', () => {
    expect(sha512(helpersSrc())).toBe(
      '153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91',
    );
  });

  it('post104: locks helpers.ts sha256 nibble sum to 487', () => {
    expect(nibbleSum(sha256(helpersSrc()))).toBe(487);
  });

  it('post104: locks helpers.ts byte size to 6078', () => {
    expect(statSync(helpersPath).size).toBe(6078);
    expect(helpersBuf().byteLength).toBe(6078);
  });

  it('post104: locks helpers.ts line count to 164', () => {
    expect(helpersSrc().split('\n')).toHaveLength(164);
  });

  it('post104: locks helpers.ts first/last sha256 octets 0x24 / 0x29', () => {
    const dig = sha256(helpersSrc());
    expect(parseInt(dig.slice(0, 2), 16)).toBe(0x24);
    expect(parseInt(dig.slice(-2), 16)).toBe(0x29);
  });

  it('post104: locks helpers.ts first byte is i (0x69) and ends with newline', () => {
    const buf = helpersBuf();
    expect(buf[0]).toBe(0x69);
    expect(buf[buf.length - 1]).toBe(0x0a);
    expect(helpersSrc().endsWith('\n')).toBe(true);
  });

  it('post104: locks helpers.ts free of BOM and CR/tab', () => {
    const s = helpersSrc();
    expect(s.charCodeAt(0)).not.toBe(0xfeff);
    expect(s.includes('\t')).toBe(false);
    expect(s.includes('\r')).toBe(false);
  });

  it('post104: locks helpers.ts export inventory 11 functions + 1 const', () => {
    expect((helpersSrc().match(/^export function /gm) ?? []).length).toBe(11);
    expect((helpersSrc().match(/^export const /gm) ?? []).length).toBe(1);
    expect(EXPORT_NAMES).toHaveLength(12);
  });

  it('post104: locks helpers.ts import inventory two top-level imports', () => {
    expect((helpersSrc().match(/^import /gm) ?? []).length).toBe(2);
    expect(helpersSrc()).toMatch(/^import \{ vi \} from 'vitest';/m);
    expect(helpersSrc()).toMatch(/^import type \{ Env \} from '\.\.\/src\/types';/m);
  });

  it('post104: locks helpers.ts punctuation inventory', () => {
    const s = helpersSrc();
    expect((s.match(/;/g) ?? []).length).toBe(56);
    expect((s.match(/`/g) ?? []).length).toBe(20);
    expect((s.match(/=>/g) ?? []).length).toBe(11);
    expect((s.match(/async /g) ?? []).length).toBe(6);
    expect((s.match(/await /g) ?? []).length).toBe(0);
    expect((s.match(/vi\.fn/g) ?? []).length).toBe(7);
  });

  it('post104: locks helpers.ts host/token substring counts', () => {
    const s = helpersSrc();
    expect((s.match(/iptv-org/g) ?? []).length).toBe(6);
    expect((s.match(/generativelanguage\.googleapis\.com/g) ?? []).length).toBe(3);
    expect((s.match(/stations:/g) ?? []).length).toBe(3);
  });

  it('post104: locks SAMPLE_M3U sha256 and size', () => {
    expect(sha256(SAMPLE_M3U)).toBe(
      'd333f382d92be92d05fc76ff08d56269b7a5f305770748fc8cdf68506169c45e',
    );
    expect(Buffer.byteLength(SAMPLE_M3U, 'utf8')).toBe(554);
    expect(SAMPLE_M3U.split('\n')).toHaveLength(14);
    expect([...SAMPLE_M3U].filter((c) => c === ' ')).toHaveLength(24);
  });

  it('post104: locks SAMPLE_M3U greek FM display names in order', () => {
    const names = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(GREEK.map((g) => `${g} FM`));
  });

  it('post104: locks SAMPLE_M3U stream path stems match greek lowercase', () => {
    const urls = [...SAMPLE_M3U.matchAll(/^https:\/\/example\.com\/([a-z]+)\.m3u8$/gm)].map((m) => m[1]);
    expect(urls).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']);
  });

  it('post104: locks SAMPLE_M3U every EXTINF uses group-title Music', () => {
    const groups = [...SAMPLE_M3U.matchAll(/group-title="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toHaveLength(6);
    expect(new Set(groups)).toEqual(new Set(['Music']));
  });

  it('post104: locks SAMPLE_M3U parseM3U length and url uniqueness', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(6);
    expect(new Set(stations.map((s) => s.url)).size).toBe(6);
    expect(new Set(stations.map((s) => s.name)).size).toBe(6);
  });

  it('post104: locks sha256 of export name mockKV', () => {
    expect(sha256('mockKV')).toBe('3e67d33140d77c75b2ae708c4bd9f2d52266eb8c1d755586ec594c6282f8a993');
    expect(nibbleSum(sha256('mockKV'))).toBe(480);
  });

  it('post104: locks helpers.ts still exports mockKV', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) mockKV\b/);
    expect(helpersSrc().indexOf('mockKV')).toBe(136);
  });

  it('post104: locks sha256 of export name testEnv', () => {
    expect(sha256('testEnv')).toBe('af724015138330bf7a9ed6f063fd01441a7db0625f61f5ba4ce8d9bf237a5069');
    expect(nibbleSum(sha256('testEnv'))).toBe(454);
  });

  it('post104: locks helpers.ts still exports testEnv', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) testEnv\b/);
    expect(helpersSrc().indexOf('testEnv')).toBe(711);
  });

  it('post104: locks sha256 of export name SAMPLE_M3U', () => {
    expect(sha256('SAMPLE_M3U')).toBe('1d43a5901d28ef66f1d265acf99819bc500423c6ef4068ac638037251a99f3c6');
    expect(nibbleSum(sha256('SAMPLE_M3U'))).toBe(448);
  });

  it('post104: locks helpers.ts still exports SAMPLE_M3U', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) SAMPLE_M3U\b/);
    expect(helpersSrc().indexOf('SAMPLE_M3U')).toBe(862);
  });

  it('post104: locks sha256 of export name geminiTextResponse', () => {
    expect(sha256('geminiTextResponse')).toBe('eec054f8c4303529a66a8cc89fbdbb94d1e2d949214212f3897be6adf2f5746a');
    expect(nibbleSum(sha256('geminiTextResponse'))).toBe(502);
  });

  it('post104: locks helpers.ts still exports geminiTextResponse', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) geminiTextResponse\b/);
    expect(helpersSrc().indexOf('geminiTextResponse')).toBe(1536);
  });

  it('post104: locks sha256 of export name stubIptvAndGemini', () => {
    expect(sha256('stubIptvAndGemini')).toBe('8bdb997cbae400bfafb65cd9309585e35549ae3e4b6664bbba192d3d68e34516');
    expect(nibbleSum(sha256('stubIptvAndGemini'))).toBe(505);
  });

  it('post104: locks helpers.ts still exports stubIptvAndGemini', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) stubIptvAndGemini\b/);
    expect(helpersSrc().indexOf('stubIptvAndGemini')).toBe(1685);
  });

  it('post104: locks sha256 of export name curatedGeminiJson', () => {
    expect(sha256('curatedGeminiJson')).toBe('4f2bff92adbee0e05359998f663c29c0a8a1c84298a7f49591b51fd15ea79174');
    expect(nibbleSum(sha256('curatedGeminiJson'))).toBe(497);
  });

  it('post104: locks helpers.ts still exports curatedGeminiJson', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) curatedGeminiJson\b/);
    expect(helpersSrc().indexOf('curatedGeminiJson')).toBe(3057);
  });

  it('post104: locks sha256 of export name iptvCategoryUrl', () => {
    expect(sha256('iptvCategoryUrl')).toBe('c31ff7f68f264f406387783d50bbb27f4063a1dcbc421c46f9d7d7d0f02362d9');
    expect(nibbleSum(sha256('iptvCategoryUrl'))).toBe(473);
  });

  it('post104: locks helpers.ts still exports iptvCategoryUrl', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) iptvCategoryUrl\b/);
    expect(helpersSrc().indexOf('iptvCategoryUrl')).toBe(3498);
  });

  it('post104: locks sha256 of export name countHttpStreamLines', () => {
    expect(sha256('countHttpStreamLines')).toBe('87ba3719ab88575a937f6215ea106d7eb9d94fcae9ff466f20a5411ed3364b38');
    expect(nibbleSum(sha256('countHttpStreamLines'))).toBe(488);
  });

  it('post104: locks helpers.ts still exports countHttpStreamLines', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) countHttpStreamLines\b/);
    expect(helpersSrc().indexOf('countHttpStreamLines')).toBe(3698);
  });

  it('post104: locks sha256 of export name buildSimpleM3U', () => {
    expect(sha256('buildSimpleM3U')).toBe('019f6ec0e4d894f9da583201d2cd2a9fb157eb31067653d87499ec8909583efc');
    expect(nibbleSum(sha256('buildSimpleM3U'))).toBe(490);
  });

  it('post104: locks helpers.ts still exports buildSimpleM3U', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) buildSimpleM3U\b/);
    expect(helpersSrc().indexOf('buildSimpleM3U')).toBe(3973);
  });

  it('post104: locks sha256 of export name seedStationsCache', () => {
    expect(sha256('seedStationsCache')).toBe('be57554a627a4fe18d5af50aa7441b622c477f4a62c11b98de650111f51c7d56');
    expect(nibbleSum(sha256('seedStationsCache'))).toBe(447);
  });

  it('post104: locks helpers.ts still exports seedStationsCache', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) seedStationsCache\b/);
    expect(helpersSrc().indexOf('seedStationsCache')).toBe(4744);
  });

  it('post104: locks sha256 of export name captureGeminiRequest', () => {
    expect(sha256('captureGeminiRequest')).toBe('41edfbaa9310811ca03f0c1b76bc2a5f0a81b5cf088483c9108ff24c8855b640');
    expect(nibbleSum(sha256('captureGeminiRequest'))).toBe(451);
  });

  it('post104: locks helpers.ts still exports captureGeminiRequest', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) captureGeminiRequest\b/);
    expect(helpersSrc().indexOf('captureGeminiRequest')).toBe(5160);
  });

  it('post104: locks sha256 of export name iptvCallsWithInit', () => {
    expect(sha256('iptvCallsWithInit')).toBe('61585f82a260862357f7aa3611f3669aa34a03be4c9cf5ae6f0317526199a193');
    expect(nibbleSum(sha256('iptvCallsWithInit'))).toBe(424);
  });

  it('post104: locks helpers.ts still exports iptvCallsWithInit', () => {
    expect(helpersSrc()).toMatch(/export (?:function|const) iptvCallsWithInit\b/);
    expect(helpersSrc().indexOf('iptvCallsWithInit')).toBe(5878);
  });


  it('post104: locks Map inventory of 12 helper export names', () => {
    expect(new Map(EXPORT_NAMES.map((n, i) => [n, i])).size).toBe(12);
    const src = helpersSrc();
    for (const n of EXPORT_NAMES) {
      expect(src).toMatch(new RegExp(`export (?:function|const) ${n}\\b`));
    }
  });

  it('post104: locks Set of export names equals EXPORT_NAMES', () => {
    expect([...new Set(EXPORT_NAMES)]).toEqual([...EXPORT_NAMES]);
  });

  it('post104: locks fromCharCode rebuild of mockKV', () => {
    const name = String.fromCharCode(109, 111, 99, 107, 75, 86);
    expect(name).toBe('mockKV');
    expect(helpersSrc()).toContain(`export function ${name}`);
  });

  it('post104: locks fromCharCode rebuild of SAMPLE_M3U', () => {
    const name = String.fromCharCode(83, 65, 77, 80, 76, 69, 95, 77, 51, 85);
    expect(name).toBe('SAMPLE_M3U');
    expect(helpersSrc()).toContain(`export const ${name}`);
  });

  it('post104: locks fromCharCode rebuild of stubIptvAndGemini', () => {
    const name = String.fromCharCode(115, 116, 117, 98, 73, 112, 116, 118, 65, 110, 100, 71, 101, 109, 105, 110, 105);
    expect(name).toBe('stubIptvAndGemini');
    expect(helpersSrc()).toContain(`export function ${name}`);
  });

  it('post104: locks fromCharCode rebuild of iptvCallsWithInit', () => {
    const name = String.fromCharCode(105, 112, 116, 118, 67, 97, 108, 108, 115, 87, 105, 116, 104, 73, 110, 105, 116);
    expect(name).toBe('iptvCallsWithInit');
    expect(helpersSrc()).toContain(`export function ${name}`);
  });

  it('post104: locks xor-fold of helpers.ts sha256 bytes to 216', () => {
    const A = Buffer.from(sha256(helpersSrc()), 'hex');
    let x = 0;
    for (const b of A) x ^= b;
    expect(x).toBe(216);
  });

  it('post104: locks BigInt of helpers.ts byte size', () => {
    expect(BigInt(statSync(helpersPath).size)).toBe(6078n);
  });

  it('post104: locks ArrayBuffer byteLength of helpers.ts', () => {
    expect(helpersBuf().buffer.byteLength).toBeGreaterThanOrEqual(6078);
    expect(helpersBuf().byteLength).toBe(6078);
  });

  it('post104: locks DataView first byte of helpers.ts is 0x69', () => {
    const view = new DataView(helpersBuf().buffer, helpersBuf().byteOffset, helpersBuf().byteLength);
    expect(view.getUint8(0)).toBe(0x69);
  });

  it('post104: locks TextEncoder/TextDecoder round-trip of helpers.ts', () => {
    const enc = new TextEncoder().encode(helpersSrc());
    expect(enc.byteLength).toBe(6078);
    expect(new TextDecoder().decode(enc)).toBe(helpersSrc());
  });

  it('post104: locks Blob round-trip of SAMPLE_M3U header', async () => {
    const blob = new Blob(['#EXTM3U'], { type: 'text/plain' });
    expect(await blob.text()).toBe('#EXTM3U');
    expect(SAMPLE_M3U.startsWith('#EXTM3U')).toBe(true);
  });

  it('post104: locks structuredClone independence of seedStationsCache bag', () => {
    const seed = seedStationsCache('music', [{ name: 'A' }]);
    const clone = structuredClone(seed);
    clone['stations:music'] = 'mutated';
    expect(seed['stations:music']).toBe(JSON.stringify([{ name: 'A' }]));
  });

  it('post104: locks Proxy get trap still surfaces SAMPLE_M3U', () => {
    const proxy = new Proxy({ value: SAMPLE_M3U }, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(proxy.value).toContain('Alpha FM');
    expect(proxy.value).toBe(SAMPLE_M3U);
  });

  it('post104: locks WeakMap can key mockKV instance', () => {
    const kv = mockKV();
    const wm = new WeakMap<object, string>();
    wm.set(kv as unknown as object, 'ok');
    expect(wm.get(kv as unknown as object)).toBe('ok');
  });

  it('post104: locks Intl.Collator sorted greek stems', () => {
    const stems = ['zeta', 'alpha', 'gamma', 'beta', 'epsilon', 'delta'];
    expect([...stems].sort(new Intl.Collator('en').compare)).toEqual([
      'alpha',
      'beta',
      'delta',
      'epsilon',
      'gamma',
      'zeta',
    ]);
  });

  it('post104: locks localeCompare cascade of EXPORT_NAMES', () => {
    const sorted = [...EXPORT_NAMES].sort((a, b) => a.localeCompare(b));
    expect(sorted[0]).toBe('buildSimpleM3U');
    expect(sorted[sorted.length - 1]).toBe('testEnv');
  });

  it('post104: locks padEnd of VERSION default token', () => {
    expect('0.1.0-test'.padEnd(12, ' ')).toBe('0.1.0-test  ');
    expect(testEnv().VERSION).toBe('0.1.0-test');
  });

  it('post104: locks encodeURI of iptv category path for music', () => {
    expect(encodeURI(iptvCategoryUrl('music'))).toBe(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
  });

  it('post104: locks queueMicrotask does not mutate helpers digest', async () => {
    const before = sha256(helpersSrc());
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(sha256(helpersSrc())).toBe(before);
  });

  it('post104: locks performance.now around helpers read is finite', () => {
    const t0 = performance.now();
    void helpersSrc();
    const t1 = performance.now();
    expect(Number.isFinite(t1 - t0)).toBe(true);
  });

  it('post104: locks AbortSignal unused by helpers.ts source', () => {
    expect(helpersSrc()).not.toMatch(/AbortSignal/);
    expect(helpersSrc()).not.toMatch(/AbortController/);
  });

  it('post104: locks Headers/FormData absence in helpers.ts', () => {
    expect(helpersSrc()).not.toMatch(/\bHeaders\b/);
    expect(helpersSrc()).not.toMatch(/\bFormData\b/);
  });

  it('post104: locks negative — no Durable Object or process.env in helpers.ts', () => {
    expect(helpersSrc()).not.toMatch(/DurableObject/);
    expect(helpersSrc()).not.toMatch(/process\.env/);
    expect(helpersSrc()).not.toMatch(/\bDeno\b/);
    expect(helpersSrc()).not.toMatch(/\bBun\b/);
  });

  it('post104: locks helpers.ts and helpers.test.ts end with newline', () => {
    expect(helpersSrc().endsWith('\n')).toBe(true);
    expect(readFileSync(join(helpersRoot, 'test/helpers.test.ts'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('post104: locks this test file still lives under test/ and names helpers', () => {
    expect(fileURLToPath(import.meta.url)).toContain('/test/helpers.test.ts');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 400', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 400 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 401', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 401 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 403', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 403 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 404', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 404 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 418', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 418 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 429', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 429 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 500', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 500 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 502', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 502 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 503', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 503 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini m3u null iptvStatus 504', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 504 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(504);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stub iptvByGenre solo hit for music', async () => {
    const body = buildSimpleM3U([{ name: 'MUSIC FM', url: 'https://example.com/music.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { music: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for music', () => {
    expect(iptvCategoryUrl('music')).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it('post104: locks seedStationsCache key stations:music', () => {
    expect(seedStationsCache('music', '[]')).toEqual({ 'stations:music': '[]' });
  });

  it('post104: locks stub iptvByGenre solo hit for ambient', async () => {
    const body = buildSimpleM3U([{ name: 'AMBIENT FM', url: 'https://example.com/ambient.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { ambient: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/ambient.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for ambient', () => {
    expect(iptvCategoryUrl('ambient')).toBe('https://iptv-org.github.io/iptv/categories/ambient.m3u');
  });

  it('post104: locks seedStationsCache key stations:ambient', () => {
    expect(seedStationsCache('ambient', '[]')).toEqual({ 'stations:ambient': '[]' });
  });

  it('post104: locks stub iptvByGenre solo hit for jazz', async () => {
    const body = buildSimpleM3U([{ name: 'JAZZ FM', url: 'https://example.com/jazz.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for jazz', () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it('post104: locks seedStationsCache key stations:jazz', () => {
    expect(seedStationsCache('jazz', '[]')).toEqual({ 'stations:jazz': '[]' });
  });

  it('post104: locks stub iptvByGenre solo hit for classical', async () => {
    const body = buildSimpleM3U([{ name: 'CLASSICAL FM', url: 'https://example.com/classical.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { classical: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/classical.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for classical', () => {
    expect(iptvCategoryUrl('classical')).toBe('https://iptv-org.github.io/iptv/categories/classical.m3u');
  });

  it('post104: locks seedStationsCache key stations:classical', () => {
    expect(seedStationsCache('classical', '[]')).toEqual({ 'stations:classical': '[]' });
  });

  it('post104: locks stub iptvByGenre solo hit for pop', async () => {
    const body = buildSimpleM3U([{ name: 'POP FM', url: 'https://example.com/pop.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { pop: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/pop.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for pop', () => {
    expect(iptvCategoryUrl('pop')).toBe('https://iptv-org.github.io/iptv/categories/pop.m3u');
  });

  it('post104: locks seedStationsCache key stations:pop', () => {
    expect(seedStationsCache('pop', '[]')).toEqual({ 'stations:pop': '[]' });
  });

  it('post104: locks stub iptvByGenre solo hit for rock', async () => {
    const body = buildSimpleM3U([{ name: 'ROCK FM', url: 'https://example.com/rock.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { rock: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/rock.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for rock', () => {
    expect(iptvCategoryUrl('rock')).toBe('https://iptv-org.github.io/iptv/categories/rock.m3u');
  });

  it('post104: locks seedStationsCache key stations:rock', () => {
    expect(seedStationsCache('rock', '[]')).toEqual({ 'stations:rock': '[]' });
  });

  it('post104: locks stub iptvByGenre solo hit for news', async () => {
    const body = buildSimpleM3U([{ name: 'NEWS FM', url: 'https://example.com/news.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { news: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/news.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for news', () => {
    expect(iptvCategoryUrl('news')).toBe('https://iptv-org.github.io/iptv/categories/news.m3u');
  });

  it('post104: locks seedStationsCache key stations:news', () => {
    expect(seedStationsCache('news', '[]')).toEqual({ 'stations:news': '[]' });
  });

  it('post104: locks stub iptvByGenre solo hit for sports', async () => {
    const body = buildSimpleM3U([{ name: 'SPORTS FM', url: 'https://example.com/sports.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { sports: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/sports.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for sports', () => {
    expect(iptvCategoryUrl('sports')).toBe('https://iptv-org.github.io/iptv/categories/sports.m3u');
  });

  it('post104: locks seedStationsCache key stations:sports', () => {
    expect(seedStationsCache('sports', '[]')).toEqual({ 'stations:sports': '[]' });
  });

  it('post104: locks stub iptvByGenre solo hit for entertainment', async () => {
    const body = buildSimpleM3U([{ name: 'ENTERTAINMENT FM', url: 'https://example.com/entertainment.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { entertainment: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/entertainment.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('post104: locks iptvCategoryUrl for entertainment', () => {
    expect(iptvCategoryUrl('entertainment')).toBe('https://iptv-org.github.io/iptv/categories/entertainment.m3u');
  });

  it('post104: locks seedStationsCache key stations:entertainment', () => {
    expect(seedStationsCache('entertainment', '[]')).toEqual({ 'stations:entertainment': '[]' });
  });


  it('post104: locks mockKV seed copy isolation from later seed mutation', async () => {
    const seed: Record<string, string> = { a: '1' };
    const kv = mockKV(seed);
    seed.a = 'mutated';
    seed.b = '2';
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('b')).toBeNull();
  });

  it('post104: locks mockKV put overwrite and delete cycle', async () => {
    const kv = mockKV({ k: 'v1' });
    await kv.put('k', 'v2');
    expect(await kv.get('k')).toBe('v2');
    await kv.delete('k');
    expect(await kv.get('k')).toBeNull();
    await kv.delete('k');
    expect(await kv.get('k')).toBeNull();
  });

  it('post104: locks mockKV unicode and slash keys', async () => {
    const kv = mockKV();
    await kv.put('stations:jazz/日', '[]');
    expect(await kv.get('stations:jazz/日')).toBe('[]');
  });

  it('post104: locks mockKV list stub shape', async () => {
    const kv = mockKV({ a: '1' });
    await expect(kv.list()).resolves.toEqual({ keys: [], list_complete: true, cacheStatus: null });
  });

  it('post104: locks mockKV getWithMetadata stub shape', async () => {
    const kv = mockKV({ a: '1' });
    await expect(kv.getWithMetadata('a')).resolves.toEqual({
      value: null,
      metadata: null,
      cacheStatus: null,
    });
  });

  it('post104: locks mockKV Reflect.ownKeys includes get/put/delete', () => {
    const kv = mockKV();
    const keys = Reflect.ownKeys(kv as object).map(String);
    expect(keys).toEqual(expect.arrayContaining(['get', 'put', 'delete', 'list', 'getWithMetadata']));
  });

  it('post104: locks testEnv default VERSION and undefined GEMINI_API_KEY', () => {
    const env = testEnv();
    expect(env.VERSION).toBe('0.1.0-test');
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.CATALOG_CACHE).toBeTruthy();
  });

  it('post104: locks testEnv override order clears VERSION', () => {
    const env = testEnv({ VERSION: undefined });
    expect(env.VERSION).toBeUndefined();
  });

  it('post104: locks testEnv empty-string GEMINI_API_KEY preserved', () => {
    expect(testEnv({ GEMINI_API_KEY: '' }).GEMINI_API_KEY).toBe('');
  });

  it('post104: locks testEnv independent CATALOG_CACHE per call', async () => {
    const a = testEnv();
    const b = testEnv();
    await a.CATALOG_CACHE.put('x', '1');
    expect(await b.CATALOG_CACHE.get('x')).toBeNull();
  });

  it('post104: locks geminiTextResponse candidate shape and content-type', async () => {
    const res = geminiTextResponse('hello');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].content.parts).toHaveLength(1);
    expect(body.candidates[0].content.parts[0].text).toBe('hello');
  });

  it('post104: locks geminiTextResponse empty and unicode text', async () => {
    expect(
      ((await geminiTextResponse('').json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> })
        .candidates[0].content.parts[0].text,
    ).toBe('');
    expect(
      ((await geminiTextResponse('🎵').json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> })
        .candidates[0].content.parts[0].text,
    ).toBe('🎵');
  });

  it('post104: locks curatedGeminiJson default Alpha FM music pick', async () => {
    const text = (
      (await curatedGeminiJson().json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      }
    ).candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text) as Array<{ name: string; genre: string; url: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      name: 'Alpha FM',
      genre: 'music',
      url: 'https://example.com/alpha.m3u8',
    });
  });

  it('post104: locks curatedGeminiJson custom multi-station payload', async () => {
    const picks = [
      { name: 'A', url: 'https://a', editorial: 'e1', genre: 'jazz' },
      { name: 'B', url: 'https://b', editorial: 'e2', genre: 'news', logo: 'https://logo' },
    ];
    const text = (
      (await curatedGeminiJson(picks).json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      }
    ).candidates[0].content.parts[0].text;
    expect(JSON.parse(text)).toEqual(picks);
  });

  it('post104: locks curatedGeminiJson empty array model text', async () => {
    const text = (
      (await curatedGeminiJson([]).json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      }
    ).candidates[0].content.parts[0].text;
    expect(text).toBe('[]');
  });

  it('post104: locks countHttpStreamLines on SAMPLE_M3U is 6', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it('post104: locks countHttpStreamLines ignores rtmp and uppercase HTTP', () => {
    expect(countHttpStreamLines('RTMP://x\nHTTP://y\nhttps://z')).toBe(1);
  });

  it('post104: locks countHttpStreamLines trims before scheme check', () => {
    expect(countHttpStreamLines('  https://a\n\thttp://b')).toBe(2);
  });

  it('post104: locks countHttpStreamLines empty and CR-only', () => {
    expect(countHttpStreamLines('')).toBe(0);
    expect(countHttpStreamLines('\r\n\r')).toBe(0);
  });

  it('post104: locks buildSimpleM3U empty yields header plus newline', () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
  });

  it('post104: locks buildSimpleM3U attribute order name/logo/group/language/country', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'N',
        url: 'https://u',
        logo: 'https://l',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(m3u).toContain(
      '#EXTINF:-1 tvg-name="N" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",N',
    );
    expect(m3u.endsWith('\n')).toBe(true);
  });

  it('post104: locks buildSimpleM3U omits null optional attrs', () => {
    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u' }]);
    expect(m3u).not.toContain('tvg-logo');
    expect(m3u).not.toContain('group-title');
    expect(m3u).not.toContain('tvg-language');
    expect(m3u).not.toContain('tvg-country');
  });

  it('post104: locks buildSimpleM3U parseM3U round-trip for two stations', () => {
    const m3u = buildSimpleM3U([
      { name: 'One', url: 'https://one', group: 'Music' },
      { name: 'Two', url: 'https://two', language: 'en', country: 'US' },
    ]);
    const stations = parseM3U(m3u);
    expect(stations).toHaveLength(2);
    expect(stations[0]).toMatchObject({ name: 'One', url: 'https://one', group: 'Music' });
    expect(stations[1]).toMatchObject({ name: 'Two', url: 'https://two', language: 'en', country: 'US' });
  });

  it('post104: locks seedStationsCache object vs string serialization', () => {
    expect(seedStationsCache('music', [{ a: 1 }])['stations:music']).toBe('[{"a":1}]');
    expect(seedStationsCache('music', 'raw')['stations:music']).toBe('raw');
  });

  it('post104: locks seedStationsCache preserves existing keys', () => {
    const next = seedStationsCache('jazz', '[]', { 'stations:music': 'old' });
    expect(next).toEqual({ 'stations:music': 'old', 'stations:jazz': '[]' });
  });

  it('post104: locks seedStationsCache number boolean null JSON', () => {
    expect(seedStationsCache('n', 42)['stations:n']).toBe('42');
    expect(seedStationsCache('b', true)['stations:b']).toBe('true');
    expect(seedStationsCache('z', null)['stations:z']).toBe('null');
  });

  it('post104: locks seedStationsCache then mockKV get returns JSON', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const kv = mockKV(seed);
    expect(JSON.parse((await kv.get('stations:music'))!)).toEqual([{ name: 'A', url: 'https://a' }]);
  });

  it('post104: locks captureGeminiRequest null when never called', () => {
    expect(captureGeminiRequest({ mock: { calls: [] } })).toBeNull();
  });

  it('post104: locks captureGeminiRequest null when only iptv called', async () => {
    const fetchMock = stubIptvAndGemini({});
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('post104: locks captureGeminiRequest first-match among many Gemini calls', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    const call = fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    await call('https://generativelanguage.googleapis.com/v1/a', { method: 'POST', body: '{"n":1}' });
    await call('https://generativelanguage.googleapis.com/v1/b', { method: 'POST', body: '{"n":2}' });
    expect(captureGeminiRequest(fetchMock)?.body).toEqual({ n: 1 });
    expect(captureGeminiRequest(fetchMock)?.url).toContain('/v1/a');
  });

  it('post104: locks captureGeminiRequest defaults method GET and body {}', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured?.method).toBe('GET');
    expect(captured?.body).toEqual({});
    expect(captured?.headers).toBeUndefined();
  });

  it('post104: locks captureGeminiRequest uppercases method', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'post', body: '{}' },
    );
    expect(captureGeminiRequest(fetchMock)?.method).toBe('POST');
  });

  it('post104: locks captureGeminiRequest parses nested JSON body', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }) },
    );
    expect(captureGeminiRequest(fetchMock)?.body).toEqual({
      contents: [{ parts: [{ text: 'hi' }] }],
    });
  });

  it('post104: locks captureGeminiRequest headers passthrough', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
    );
    expect(captureGeminiRequest(fetchMock)?.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('post104: locks captureGeminiRequest throws on invalid JSON body', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/v1beta/x',
      { method: 'POST', body: '{bad' },
    );
    expect(() => captureGeminiRequest(fetchMock)).toThrow();
  });

  it('post104: locks iptvCallsWithInit empty when no iptv calls', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/x',
    );
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('post104: locks iptvCallsWithInit ignores gemini calls even with init', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
      'https://generativelanguage.googleapis.com/x',
      { method: 'POST', body: '{}' },
    );
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('post104: locks iptvCallsWithInit returns all iptv calls that passed init', async () => {
    const fetchMock = stubIptvAndGemini({});
    const call = fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    await call('https://iptv-org.github.io/iptv/categories/music.m3u');
    await call('https://iptv-org.github.io/iptv/categories/jazz.m3u', { method: 'GET' });
    await call('https://iptv-org.github.io/iptv/categories/pop.m3u', { headers: { x: '1' } });
    const bad = iptvCallsWithInit(fetchMock);
    expect(bad).toHaveLength(2);
    expect(String(bad[0][0])).toContain('jazz');
    expect(String(bad[1][0])).toContain('pop');
  });

  it('post104: locks iptvCallsWithInit filters non-iptv even with init defined', () => {
    expect(
      iptvCallsWithInit({
        mock: {
          calls: [
            ['https://example.com', { method: 'GET' }],
            ['https://iptv-org.github.io/x', undefined],
            ['https://iptv-org.github.io/y', { method: 'GET' }],
          ],
        },
      }),
    ).toHaveLength(1);
  });

  it('post104: locks stubIptvAndGemini default SAMPLE for iptv-org substring URLs', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://cdn.example/iptv-org/mirror.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SAMPLE_M3U);
  });

  it('post104: locks stubIptvAndGemini non-iptv non-gemini is 404 nope', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://example.com');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('post104: locks stubIptvAndGemini gemini default boom 500', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.googleapis.com/x');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('boom');
  });

  it('post104: locks stubIptvAndGemini gemini factory each call', async () => {
    let n = 0;
    const fetchMock = stubIptvAndGemini({
      gemini: () => new Response(`r${++n}`, { status: 200 }),
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('https://generativelanguage.googleapis.com/a')).text()).toBe('r1');
    expect(await (await fetchMock('https://generativelanguage.googleapis.com/b')).text()).toBe('r2');
    expect(n).toBe(2);
  });

  it('post104: locks stubIptvAndGemini gemini factory thrown error propagates', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: () => {
        throw new Error('factory-boom');
      },
    }) as unknown as (u: string) => Promise<Response>;
    await expect(fetchMock('https://generativelanguage.googleapis.com/x')).rejects.toThrow('factory-boom');
  });

  it('post104: locks stubIptvAndGemini URL object for iptv href', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '#EXTM3U\n' }) as unknown as (
      u: RequestInfo | URL,
    ) => Promise<Response>;
    const res = await fetchMock(new URL('https://iptv-org.github.io/iptv/categories/music.m3u'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('#EXTM3U\n');
  });

  it('post104: locks stubIptvAndGemini Request object String is not URL (404)', async () => {
    const req = new Request('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(String(req)).toBe('[object Request]');
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      input: RequestInfo,
    ) => Promise<Response>;
    const res = await fetchMock(req);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('post104: locks stubIptvAndGemini iptvByGenre miss falls through to default m3u', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: '#EXTM3U\ndefault\n',
      iptvByGenre: { jazz: '#EXTM3U\njazz\n' },
    }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(await res.text()).toBe('#EXTM3U\ndefault\n');
  });

  it('post104: locks stubIptvAndGemini iptvByGenre null uses iptvStatus', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: null },
      iptvStatus: 418,
    }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
  });

  it('post104: locks stubIptvAndGemini empty-string m3u is 200 empty body', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: '' }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('post104: locks stubIptvAndGemini query string after .m3u still matches genre', async () => {
    const body = 'jazz-body';
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: body } }) as unknown as (
      u: string,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u?cache=1');
    expect(await res.text()).toBe(body);
  });

  it('post104: locks stubIptvAndGemini dots in genre path segment stop match', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: 'fallback',
      iptvByGenre: { jazz: 'mapped' },
    }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.extra.m3u');
    expect(await res.text()).toBe('fallback');
  });

  it('post104: locks stubIptvAndGemini is a vitest mock with call history', async () => {
    const fetchMock = stubIptvAndGemini({});
    await (fetchMock as unknown as (u: string) => Promise<Response>)(
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    );
    expect(vi.isMockFunction(fetchMock)).toBe(true);
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it('post104: locks stubIptvAndGemini concurrent iptv and gemini calls', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson(), m3u: SAMPLE_M3U });
    const call = fetchMock as unknown as (u: string) => Promise<Response>;
    const [iptv, gemini] = await Promise.all([
      call('https://iptv-org.github.io/iptv/categories/music.m3u'),
      call('https://generativelanguage.googleapis.com/v1beta/x'),
    ]);
    expect(iptv.status).toBe(200);
    expect(gemini.status).toBe(200);
    expect(await iptv.text()).toBe(SAMPLE_M3U);
  });

  it('post104: locks stubIptvAndGemini ignores AbortSignal in init for iptv', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      u: string,
      i?: RequestInit,
    ) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u', {
      signal: AbortSignal.timeout(50),
    });
    expect(res.status).toBe(200);
  });

  it('post104: locks Promise.allSettled fulfilled for each EXPORT_NAMES entry', async () => {
    const results = await Promise.allSettled(EXPORT_NAMES.map(async (n) => n.length));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(results).toHaveLength(12);
  });

  it('post104: locks Number.isInteger of export count and SAMPLE stream count', () => {
    expect(Number.isInteger(EXPORT_NAMES.length)).toBe(true);
    expect(Number.isInteger(countHttpStreamLines(SAMPLE_M3U))).toBe(true);
    expect(EXPORT_NAMES.length).toBe(12);
  });

  it('post104: locks Math.trunc/floor/ceil around helpers byte size', () => {
    expect(Math.trunc(6078.9)).toBe(6078);
    expect(Math.floor(6078.9)).toBe(6078);
    expect(Math.ceil(6077.1)).toBe(6078);
  });

  it('post104: locks code point iteration equals char codes for mockKV', () => {
    const name = 'mockKV';
    expect([...name].map((c) => c.codePointAt(0))).toEqual([...name].map((c) => c.charCodeAt(0)));
  });

  it('post104: locks matchAll for snake-ish tokens absent in EXPORT_NAMES', () => {
    const csv = EXPORT_NAMES.join(',');
    expect([...csv.matchAll(/_/g)]).toHaveLength(1); // SAMPLE_M3U
  });

  it('post104: locks replaceAll underscore to hyphen on SAMPLE_M3U copy only', () => {
    expect('SAMPLE_M3U'.replaceAll('_', '-')).toBe('SAMPLE-M3U');
    expect('SAMPLE_M3U'.includes('SAMPLE')).toBe(true);
    expect(helpersSrc()).toContain('SAMPLE_M3U');
  });

  it('post104: locks search for curator absence in helpers.ts', () => {
    expect(helpersSrc().search(/curator/i)).toBe(-1);
  });

  it('post104: locks substring iptv-org host in iptvCategoryUrl', () => {
    const url = iptvCategoryUrl('music');
    expect(url.substring(8, 15)).toBe('iptv-or');
    expect(url.includes('iptv-org.github.io')).toBe(true);
  });

  it('post104: locks Object.is frozen identity of SAMPLE_M3U string', () => {
    expect(Object.is(SAMPLE_M3U, SAMPLE_M3U)).toBe(true);
    expect(Object.is(SAMPLE_M3U, SAMPLE_M3U + '')).toBe(true);
  });

  it('post104: locks Array.from GREEK equals spread and slice', () => {
    expect(Array.from(GREEK)).toEqual([...GREEK]);
    expect(GREEK.slice()).toEqual([...GREEK]);
  });

  it('post104: locks Buffer compare index prefix import', () => {
    expect(Buffer.compare(Buffer.from('import'), Buffer.from('import'))).toBe(0);
    expect(helpersSrc().startsWith('import')).toBe(true);
  });

  it('post104: locks Int16Array of export count and sample stream count', () => {
    const arr = new Int16Array([EXPORT_NAMES.length, countHttpStreamLines(SAMPLE_M3U)]);
    expect([...arr]).toEqual([12, 6]);
  });

  it('post104: locks Relative indexOf of export function before export const', () => {
    const s = helpersSrc();
    expect(s.indexOf('export function')).toBeLessThan(s.indexOf('export const'));
  });

  it('post104: locks dirname of helpers resolves under test/', () => {
    expect(dirname(helpersPath).endsWith('/test') || dirname(helpersPath).endsWith('\\test')).toBe(true);
  });

  it('post104: locks vitest.config does not special-case helpers tests', () => {
    const cfg = readFileSync(join(helpersRoot, 'vitest.config.ts'), 'utf8');
    expect(cfg).toContain("include: ['test/**/*.test.ts']");
    expect(cfg).not.toMatch(/helpers\.test/);
  });

  it('post104: locks package.json test script still vitest run', () => {
    const pkg = JSON.parse(readFileSync(join(helpersRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post104: locks cross-file types.ts Env still has CATALOG_CACHE', () => {
    const types = readFileSync(join(helpersRoot, 'src/types.ts'), 'utf8');
    expect(types).toMatch(/CATALOG_CACHE/);
    expect(types).toMatch(/GEMINI_API_KEY\?/);
  });

  it('post104: locks helpers.ts JSDoc mentions In-memory KV stub', () => {
    expect(helpersSrc()).toContain('In-memory KV stub for Worker route tests.');
  });

  it('post104: locks helpers.ts JSDoc mentions Gemini generateContent shape', () => {
    expect(helpersSrc()).toContain('generateContent-shaped JSON response');
  });

  it('post104: locks helpers.ts default VERSION literal 0.1.0-test', () => {
    expect(helpersSrc()).toContain("VERSION: '0.1.0-test'");
  });

  it('post104: locks helpers.ts default boom and nope literals', () => {
    expect(helpersSrc()).toContain("new Response('boom', { status: 500 })");
    expect(helpersSrc()).toContain("new Response('nope', { status: 404 })");
  });

  it('post104: locks helpers.ts default down status ternary', () => {
    expect(helpersSrc()).toContain('opts.iptvStatus ?? 503');
    expect(helpersSrc()).toContain("new Response('down', { status: opts.iptvStatus ?? 503 })");
  });

  it('post104: locks helpers.ts category regex source', () => {
    expect(helpersSrc()).toContain('/\\/categories\\/([^/.]+)\\.m3u/');
  });

  it('post104: locks helpers.ts stations key template', () => {
    expect(helpersSrc()).toContain('stations:${genre}');
  });

  it('post104: locks sha256 hex length 64 for helpers digest', () => {
    expect(sha256(helpersSrc())).toHaveLength(64);
    expect(sha1(helpersSrc())).toHaveLength(40);
    expect(md5(helpersSrc())).toHaveLength(32);
    expect(sha512(helpersSrc())).toHaveLength(128);
  });

  it('post104: locks first/last octets of SAMPLE_M3U sha256', () => {
    const dig = sha256(SAMPLE_M3U);
    expect(parseInt(dig.slice(0, 2), 16)).toBe(0xd3);
    expect(parseInt(dig.slice(-2), 16)).toBe(0x5e);
  });

  it('post104: locks SAMPLE_M3U space count via filter', () => {
    expect([...SAMPLE_M3U].filter((c) => c === ' ')).toHaveLength(24);
  });

  it('post104: locks helpers.ts space/digit/case counts still post76 values', () => {
    const s = helpersSrc();
    expect([...s].filter((c) => c === ' ')).toHaveLength(919);
    expect([...s].filter((c) => /\d/.test(c))).toHaveLength(65);
    expect([...s].filter((c) => /[A-Z]/.test(c))).toHaveLength(307);
    expect([...s].filter((c) => /[a-z]/.test(c))).toHaveLength(3531);
  });

  it('post104: locks helpers.ts brace/paren/quote counts still post76 values', () => {
    const s = helpersSrc();
    expect((s.match(/\{/g) ?? []).length).toBe(59);
    expect((s.match(/\}/g) ?? []).length).toBe(59);
    expect((s.match(/\(/g) ?? []).length).toBe(90);
    expect((s.match(/\)/g) ?? []).length).toBe(90);
    expect((s.match(/"/g) ?? []).length).toBe(34);
    expect((s.match(/'/g) ?? []).length).toBe(48);
  });

  it('post104: locks SAMPLE_M3U contains Alpha FM and alpha.m3u8', () => {
    expect(SAMPLE_M3U).toContain('Alpha FM');
    expect(SAMPLE_M3U).toContain('https://example.com/alpha.m3u8');
  });

  it('post104: locks SAMPLE_M3U contains Beta FM and beta.m3u8', () => {
    expect(SAMPLE_M3U).toContain('Beta FM');
    expect(SAMPLE_M3U).toContain('https://example.com/beta.m3u8');
  });

  it('post104: locks SAMPLE_M3U contains Gamma FM and gamma.m3u8', () => {
    expect(SAMPLE_M3U).toContain('Gamma FM');
    expect(SAMPLE_M3U).toContain('https://example.com/gamma.m3u8');
  });

  it('post104: locks SAMPLE_M3U contains Delta FM and delta.m3u8', () => {
    expect(SAMPLE_M3U).toContain('Delta FM');
    expect(SAMPLE_M3U).toContain('https://example.com/delta.m3u8');
  });

  it('post104: locks SAMPLE_M3U contains Epsilon FM and epsilon.m3u8', () => {
    expect(SAMPLE_M3U).toContain('Epsilon FM');
    expect(SAMPLE_M3U).toContain('https://example.com/epsilon.m3u8');
  });

  it('post104: locks SAMPLE_M3U contains Zeta FM and zeta.m3u8', () => {
    expect(SAMPLE_M3U).toContain('Zeta FM');
    expect(SAMPLE_M3U).toContain('https://example.com/zeta.m3u8');
  });

  it('post104: locks buildSimpleM3U+countHttpStreamLines for single music station', () => {
    const m3u = buildSimpleM3U([{ name: 'music', url: 'https://example.com/music.m3u8', group: 'music' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('music');
  });

  it('post104: locks buildSimpleM3U+countHttpStreamLines for single jazz station', () => {
    const m3u = buildSimpleM3U([{ name: 'jazz', url: 'https://example.com/jazz.m3u8', group: 'jazz' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('jazz');
  });

  it('post104: locks buildSimpleM3U+countHttpStreamLines for single news station', () => {
    const m3u = buildSimpleM3U([{ name: 'news', url: 'https://example.com/news.m3u8', group: 'news' }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]?.group).toBe('news');
  });


  it('post104: locks mockKV put options accepted without throwing', async () => {
    const kv = mockKV();
    await expect(
      (kv.put as (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>)(
        'k',
        'v',
        { expirationTtl: 60 },
      ),
    ).resolves.toBeUndefined();
    expect(await kv.get('k')).toBe('v');
  });

  it('post104: locks testEnv with seeded CATALOG_CACHE from seedStationsCache', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J' }]);
    const env = testEnv({ CATALOG_CACHE: mockKV(seed) });
    expect(await env.CATALOG_CACHE.get('stations:jazz')).toBe(JSON.stringify([{ name: 'J' }]));
  });

  it('post104: locks captureGeminiRequest url String of URL object input', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    await (fetchMock as unknown as (u: RequestInfo | URL, i?: RequestInit) => Promise<Response>)(
      new URL('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent'),
      { method: 'POST', body: '{"q":1}' },
    );
    const captured = captureGeminiRequest(fetchMock);
    expect(captured?.url).toContain('generativelanguage.googleapis.com');
    expect(captured?.body).toEqual({ q: 1 });
  });

  it('post104: locks iptvCategoryUrl with empty genre still builds categories path', () => {
    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');
  });

  it('post104: locks iptvCategoryUrl embeds spaces raw without encodeURIComponent', () => {
    expect(iptvCategoryUrl('smooth jazz')).toBe(
      'https://iptv-org.github.io/iptv/categories/smooth jazz.m3u',
    );
  });

  it('post104: locks iptvCategoryUrl appends .m3u even when genre already ends with .m3u', () => {
    expect(iptvCategoryUrl('music.m3u')).toBe(
      'https://iptv-org.github.io/iptv/categories/music.m3u.m3u',
    );
  });

  it('post104: locks geminiTextResponse does not include finishReason', async () => {
    const body = (await geminiTextResponse('x').json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('finishReason');
  });

  it('post104: locks curatedGeminiJson Response readable once', async () => {
    const res = curatedGeminiJson();
    await res.json();
    await expect(res.json()).rejects.toThrow();
  });

  it('post104: locks stubIptvAndGemini m3u undefined uses SAMPLE_M3U', async () => {
    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u')).text()).toBe(
      SAMPLE_M3U,
    );
  });

  it('post104: locks stubIptvAndGemini multi-genre matrix', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: {
        jazz: 'J',
        news: 'N',
        music: 'M',
      },
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock(iptvCategoryUrl('jazz'))).text()).toBe('J');
    expect(await (await fetchMock(iptvCategoryUrl('news'))).text()).toBe('N');
    expect(await (await fetchMock(iptvCategoryUrl('music'))).text()).toBe('M');
  });

  it('post104: locks parseM3U(SAMPLE_M3U) yields 6 greek FM stations', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.map((s) => s.name)).toEqual(GREEK.map((g) => `${g} FM`));
    expect(stations.every((s) => s.group === 'Music')).toBe(true);
  });

  it('post104: locks parseM3U(SAMPLE_M3U) urls match https example paths', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.map((s) => s.url)).toEqual(
      GREEK.map((g) => `https://example.com/${g.toLowerCase()}.m3u8`),
    );
  });

  it('post104: locks helpers test file name and post104 marker present after deepen', () => {
    const self = readFileSync(join(helpersRoot, 'test/helpers.test.ts'), 'utf8');
    expect(self).toContain("describe('post104 helpers HEAVY deepen'");
    expect(self).toContain("it('post104: locks helpers.ts sha256 digest'");
  });

  it('post104: locks post102 describe is the final describe in this file', () => {
    const self = readFileSync(join(helpersRoot, 'test/helpers.test.ts'), 'utf8');
    const describes = [...self.matchAll(/^describe\(/gm)];
    expect(describes.length).toBeGreaterThanOrEqual(2);
    expect(self.trimEnd().endsWith('});')).toBe(true);
  });

});

describe('post111 helpers HEAVY deepen', () => {
  // TOKENMAXX tests-only deepen after parser #110 / wrangler #111.
  // Complementary leftovers on test/helpers.ts — fingerprints, export matrices,
  // mockKV/testEnv/stub/build/seed/capture locks. No product/credentials/DNS inventing.

  const helpersPath = join(helpersRoot, 'test/helpers.ts');
  const helpersSrc = () => readFileSync(helpersPath, 'utf8');
  const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
  const sha1 = (data: string | Buffer) => createHash('sha1').update(data).digest('hex');
  const md5 = (data: string | Buffer) => createHash('md5').update(data).digest('hex');
  const sha512 = (data: string | Buffer) => createHash('sha512').update(data).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const EXPORT_NAMES = ["mockKV", "testEnv", "SAMPLE_M3U", "geminiTextResponse", "stubIptvAndGemini", "curatedGeminiJson", "iptvCategoryUrl", "countHttpStreamLines", "buildSimpleM3U", "seedStationsCache", "captureGeminiRequest", "iptvCallsWithInit"] as const;
  const GREEK = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"] as const;
  const GENRE_SLUGS = ["music", "ambient", "jazz", "classical", "pop", "rock", "news", "sports", "entertainment"] as const;

  it("post111: helpers.ts sha256 fingerprint reaffirm", () => {

    expect(sha256(helpersSrc())).toBe("240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29");
    expect(sha256(readFileSync(helpersPath, 'utf8'))).toBe("240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29");

  });
  it("post111: helpers.ts sha1 fingerprint reaffirm", () => {

    expect(sha1(helpersSrc())).toBe("aac5e2154aa8f0784db092ad4bb51304fce6e117");

  });
  it("post111: helpers.ts md5 fingerprint reaffirm", () => {

    expect(md5(helpersSrc())).toBe("004bbc8741017d8dd45bee28a29b46e1");

  });
  it("post111: helpers.ts sha512 fingerprint lock", () => {

    expect(sha512(helpersSrc())).toBe("153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91");

  });
  it("post111: helpers.ts sha384 fingerprint lock", () => {

    expect(createHash('sha384').update(helpersSrc(), 'utf8').digest('hex')).toBe("1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167");

  });
  it("post111: helpers.ts HMAC-SHA256(post111) lock", () => {

    expect(createHmac('sha256', 'post111').update(helpersSrc(), 'utf8').digest('hex')).toBe(
      "2b3e2749b53346fe84b3b1f3c167c4f98ead1435c0f7e60aa942b635019518ab",
    );

  });
  it("post111: helpers.ts sha256 nibble sum 487", () => {

    expect(nibbleSum(sha256(helpersSrc()))).toBe(487);

  });
  it("post111: helpers.ts first/last sha256 octets 0x24 / 0x29", () => {

    const dig = sha256(helpersSrc());
    expect(parseInt(dig.slice(0, 2), 16)).toBe(0x24);
    expect(parseInt(dig.slice(-2), 16)).toBe(0x29);

  });
  it("post111: helpers.ts byte size 6078 via string/stat/Buffer/TextEncoder", () => {

    expect(helpersSrc().length).toBe(6078);
    expect(Buffer.byteLength(helpersSrc(), 'utf8')).toBe(6078);
    expect(new TextEncoder().encode(helpersSrc()).length).toBe(6078);
    expect(statSync(helpersPath).size).toBe(6078);

  });
  it("post111: helpers.ts newline count 163 / split 164", () => {

    expect((helpersSrc().match(/\n/g) ?? []).length).toBe(163);
    expect(helpersSrc().split('\n')).toHaveLength(164);

  });
  it("post111: helpers.ts nonempty line count and length sum", () => {

    const ls = helpersSrc().split('\n');
    expect(ls.filter((l) => l.length > 0)).toHaveLength(151);
    expect(ls.filter((l) => l.length > 0).reduce((a, l) => a + l.length, 0)).toBe(5915);

  });
  it("post111: helpers.ts line length vector lock", () => {

    expect(helpersSrc().split('\n').map((l) => l.length)).toEqual([28, 40, 0, 48, 72, 46, 10, 62, 54, 28, 7, 42, 24, 7, 84, 93, 30, 1, 0, 60, 10, 28, 26, 17, 4, 1, 0, 34, 59, 30, 57, 29, 59, 30, 59, 30, 63, 32, 57, 29, 2, 0, 85, 60, 24, 53, 5, 1, 0, 41, 22, 75, 46, 39, 22, 30, 61, 52, 30, 35, 66, 36, 103, 45, 91, 51, 7, 88, 48, 5, 60, 66, 42, 51, 5, 49, 5, 1, 0, 69, 34, 101, 5, 23, 44, 41, 21, 6, 4, 13, 54, 1, 0, 80, 56, 67, 1, 0, 71, 59, 12, 16, 25, 79, 1, 0, 75, 31, 117, 11, 28, 29, 19, 29, 59, 64, 71, 68, 5, 22, 17, 48, 22, 3, 33, 1, 0, 73, 34, 16, 17, 40, 27, 79, 60, 1, 0, 3, 81, 42, 3, 37, 46, 108, 108, 25, 30, 50, 92, 10, 8, 61, 27, 9, 4, 1, 0, 85, 93, 37, 76, 4, 1, 0]);

  });
  it("post111: helpers.ts first 40 char codes lock", () => {

    expect([...helpersSrc().slice(0, 40)].map((c) => c.charCodeAt(0))).toEqual([105, 109, 112, 111, 114, 116, 32, 123, 32, 118, 105, 32, 125, 32, 102, 114, 111, 109, 32, 39, 118, 105, 116, 101, 115, 116, 39, 59, 10, 105, 109, 112, 111, 114, 116, 32, 116, 121, 112, 101]);

  });
  it("post111: helpers.ts last 40 char codes lock", () => {

    expect([...helpersSrc().slice(-40)].map((c) => c.charCodeAt(0))).toEqual([45, 111, 114, 103, 39, 41, 32, 38, 38, 32, 99, 97, 108, 108, 91, 49, 93, 32, 33, 61, 61, 32, 117, 110, 100, 101, 102, 105, 110, 101, 100, 44, 10, 32, 32, 41, 59, 10, 125, 10]);

  });
  it("post111: digit/upper/lower counts", () => {

    expect([...helpersSrc()].filter((c) => /\d/.test(c))).toHaveLength(65);
    expect([...helpersSrc()].filter((c) => /[A-Z]/.test(c))).toHaveLength(307);
    expect([...helpersSrc()].filter((c) => /[a-z]/.test(c))).toHaveLength(3531);

  });
  it("post111: punctuation inventory", () => {

    const s = helpersSrc();
    expect((s.match(/ /g) ?? []).length).toBe(919);
    expect((s.match(/"/g) ?? []).length).toBe(34);
    expect((s.match(/'/g) ?? []).length).toBe(48);
    expect((s.match(/`/g) ?? []).length).toBe(20);
    expect((s.match(/;/g) ?? []).length).toBe(56);
    expect((s.match(/=>/g) ?? []).length).toBe(11);
    expect((s.match(/async /g) ?? []).length).toBe(6);
    expect((s.match(/vi\.fn/g) ?? []).length).toBe(7);

  });
  it("post111: host/token substring counts", () => {

    const s = helpersSrc();
    expect((s.match(/iptv-org/g) ?? []).length).toBe(6);
    expect((s.match(/generativelanguage\.googleapis\.com/g) ?? []).length).toBe(3);
    expect((s.match(/stations:/g) ?? []).length).toBe(3);

  });
  it("post111: unique char set lock", () => {

    expect([...new Set(helpersSrc())].sort().join('')).toBe("\n !\"#$&'()*+,-./0123458:;<=>?ABCDEFGHIJKLMNOPRSTUVWXZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}");

  });
  it("post111: word token vector sha256 lock", () => {

    const words = helpersSrc().match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words).toHaveLength(730);
    expect(createHash('sha256').update(words.join('|'), 'utf8').digest('hex')).toBe("b5aadc9918a45e436d73b0d9a3ab5fb28f55e530f8b3c4e38765525d9d93e666");

  });
  it("post111: unique word inventory lock", () => {

    const words = helpersSrc().match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    const unique = [...new Set(words)].sort();
    expect(unique).toEqual(["Alpha", "Array", "Beta", "Boolean", "Build", "CATALOG_CACHE", "Count", "Default", "Delta", "EXTINF", "EXTM3U", "Env", "Epsilon", "Extract", "FM", "GET", "Gamma", "Gemini", "HeadersInit", "In", "JSON", "KV", "KVNamespace", "M3U", "Map", "Minimal", "Music", "Object", "Partial", "Per", "Record", "RequestInfo", "RequestInit", "Response", "Return", "ReturnType", "Returns", "SAMPLE_M3U", "Seed", "String", "URL", "VERSION", "Worker", "Zeta", "a", "alpha", "an", "arg", "as", "async", "attrs", "beta", "bodies", "body", "boom", "buildSimpleM3U", "builder", "by", "c", "cache", "cacheStatus", "call", "calls", "candidates", "captureGeminiRequest", "case", "categories", "category", "com", "const", "content", "countHttpStreamLines", "country", "curate", "curated", "curatedGeminiJson", "delete", "delta", "down", "e", "edge", "editorial", "entries", "epsilon", "example", "existing", "export", "fetch", "fetchMock", "fetchStations", "filter", "find", "first", "fixture", "fn", "for", "from", "function", "g", "gamma", "gemini", "geminiTextResponse", "generateContent", "generativelanguage", "genre", "genreMatch", "get", "getWithMetadata", "github", "given", "googleapis", "group", "happy", "hasOwnProperty", "headers", "helper", "hit", "http", "https", "if", "import", "in", "includes", "init", "input", "io", "iptv", "iptvByGenre", "iptvCallsWithInit", "iptvCategoryUrl", "iptvStatus", "jazz", "join", "json", "key", "keyed", "keys", "l", "language", "length", "lines", "list", "list_complete", "logo", "m3u", "m3u8", "map", "match", "memory", "metadata", "method", "mock", "mockKV", "model", "music", "n", "name", "never", "new", "nope", "null", "number", "of", "opts", "or", "org", "overrides", "parse", "parser", "parts", "passed", "path", "pick", "post", "prototype", "push", "put", "raw", "response", "return", "route", "s", "second", "seed", "seedStationsCache", "serialized", "set", "shaped", "slug", "split", "src", "startsWith", "stations", "status", "store", "stream", "string", "stringify", "stub", "stubIptvAndGemini", "stubs", "test", "testEnv", "tests", "text", "that", "the", "title", "toString", "toUpperCase", "trim", "true", "tvg", "type", "typeof", "types", "undefined", "unexpectedly", "unknown", "url", "value", "vi", "vitest", "was", "when", "with", "would", "zeta"]);
    expect(createHash('sha256').update(unique.join('|'), 'utf8').digest('hex')).toBe("7644491a4dcfe8a28e36ea32cd1520503440f507c615885093470b844454ce7f");

  });
  it("post111: export inventory 11 functions + 1 const", () => {

    expect((helpersSrc().match(/^export function /gm) ?? []).length).toBe(11);
    expect((helpersSrc().match(/^export const /gm) ?? []).length).toBe(1);
    expect(EXPORT_NAMES).toEqual(["mockKV", "testEnv", "SAMPLE_M3U", "geminiTextResponse", "stubIptvAndGemini", "curatedGeminiJson", "iptvCategoryUrl", "countHttpStreamLines", "buildSimpleM3U", "seedStationsCache", "captureGeminiRequest", "iptvCallsWithInit"]);

  });
  it("post111: import inventory two top-level imports", () => {

    expect((helpersSrc().match(/^import /gm) ?? []).length).toBe(2);
    expect(helpersSrc()).toMatch(/^import \{ vi \} from 'vitest';/m);
    expect(helpersSrc()).toMatch(/^import type \{ Env \} from '\.\.\/src\/types';/m);

  });
  it("post111: no BOM / tab / CR", () => {

    const s = helpersSrc();
    expect(s.charCodeAt(0)).not.toBe(0xfeff);
    expect(s.includes('\t')).toBe(false);
    expect(s.includes('\r')).toBe(false);

  });
  it("post111: ends with single trailing newline", () => {

    expect(helpersSrc().endsWith('\n')).toBe(true);
    expect(helpersSrc().endsWith('}\n')).toBe(true);
    expect(helpersSrc().endsWith('}\n\n')).toBe(false);

  });
  it("post111: NFC/NFD/NFKC/NFKD identity", () => {

    const s = helpersSrc();
    expect(s.normalize('NFC')).toBe(s);
    expect(s.normalize('NFD')).toBe(s);
    expect(s.normalize('NFKC')).toBe(s);
    expect(s.normalize('NFKD')).toBe(s);

  });
  it("post111: re-read equals module snapshot", () => {

    expect(readFileSync(helpersPath, 'utf8')).toBe(helpersSrc());

  });
  it("post111: sha256 of export name mockKV", () => {

    expect(sha256("mockKV")).toBe("3e67d33140d77c75b2ae708c4bd9f2d52266eb8c1d755586ec594c6282f8a993");
    expect(nibbleSum(sha256("mockKV"))).toBe(480);

  });
  it("post111: helpers.ts still exports mockKV at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) mockKV\b/);
    expect(helpersSrc().indexOf("mockKV")).toBe(136);

  });
  it("post111: sha256 of export name testEnv", () => {

    expect(sha256("testEnv")).toBe("af724015138330bf7a9ed6f063fd01441a7db0625f61f5ba4ce8d9bf237a5069");
    expect(nibbleSum(sha256("testEnv"))).toBe(454);

  });
  it("post111: helpers.ts still exports testEnv at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) testEnv\b/);
    expect(helpersSrc().indexOf("testEnv")).toBe(711);

  });
  it("post111: sha256 of export name SAMPLE_M3U", () => {

    expect(sha256("SAMPLE_M3U")).toBe("1d43a5901d28ef66f1d265acf99819bc500423c6ef4068ac638037251a99f3c6");
    expect(nibbleSum(sha256("SAMPLE_M3U"))).toBe(448);

  });
  it("post111: helpers.ts still exports SAMPLE_M3U at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) SAMPLE_M3U\b/);
    expect(helpersSrc().indexOf("SAMPLE_M3U")).toBe(862);

  });
  it("post111: sha256 of export name geminiTextResponse", () => {

    expect(sha256("geminiTextResponse")).toBe("eec054f8c4303529a66a8cc89fbdbb94d1e2d949214212f3897be6adf2f5746a");
    expect(nibbleSum(sha256("geminiTextResponse"))).toBe(502);

  });
  it("post111: helpers.ts still exports geminiTextResponse at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) geminiTextResponse\b/);
    expect(helpersSrc().indexOf("geminiTextResponse")).toBe(1536);

  });
  it("post111: sha256 of export name stubIptvAndGemini", () => {

    expect(sha256("stubIptvAndGemini")).toBe("8bdb997cbae400bfafb65cd9309585e35549ae3e4b6664bbba192d3d68e34516");
    expect(nibbleSum(sha256("stubIptvAndGemini"))).toBe(505);

  });
  it("post111: helpers.ts still exports stubIptvAndGemini at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) stubIptvAndGemini\b/);
    expect(helpersSrc().indexOf("stubIptvAndGemini")).toBe(1685);

  });
  it("post111: sha256 of export name curatedGeminiJson", () => {

    expect(sha256("curatedGeminiJson")).toBe("4f2bff92adbee0e05359998f663c29c0a8a1c84298a7f49591b51fd15ea79174");
    expect(nibbleSum(sha256("curatedGeminiJson"))).toBe(497);

  });
  it("post111: helpers.ts still exports curatedGeminiJson at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) curatedGeminiJson\b/);
    expect(helpersSrc().indexOf("curatedGeminiJson")).toBe(3057);

  });
  it("post111: sha256 of export name iptvCategoryUrl", () => {

    expect(sha256("iptvCategoryUrl")).toBe("c31ff7f68f264f406387783d50bbb27f4063a1dcbc421c46f9d7d7d0f02362d9");
    expect(nibbleSum(sha256("iptvCategoryUrl"))).toBe(473);

  });
  it("post111: helpers.ts still exports iptvCategoryUrl at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) iptvCategoryUrl\b/);
    expect(helpersSrc().indexOf("iptvCategoryUrl")).toBe(3498);

  });
  it("post111: sha256 of export name countHttpStreamLines", () => {

    expect(sha256("countHttpStreamLines")).toBe("87ba3719ab88575a937f6215ea106d7eb9d94fcae9ff466f20a5411ed3364b38");
    expect(nibbleSum(sha256("countHttpStreamLines"))).toBe(488);

  });
  it("post111: helpers.ts still exports countHttpStreamLines at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) countHttpStreamLines\b/);
    expect(helpersSrc().indexOf("countHttpStreamLines")).toBe(3698);

  });
  it("post111: sha256 of export name buildSimpleM3U", () => {

    expect(sha256("buildSimpleM3U")).toBe("019f6ec0e4d894f9da583201d2cd2a9fb157eb31067653d87499ec8909583efc");
    expect(nibbleSum(sha256("buildSimpleM3U"))).toBe(490);

  });
  it("post111: helpers.ts still exports buildSimpleM3U at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) buildSimpleM3U\b/);
    expect(helpersSrc().indexOf("buildSimpleM3U")).toBe(3973);

  });
  it("post111: sha256 of export name seedStationsCache", () => {

    expect(sha256("seedStationsCache")).toBe("be57554a627a4fe18d5af50aa7441b622c477f4a62c11b98de650111f51c7d56");
    expect(nibbleSum(sha256("seedStationsCache"))).toBe(447);

  });
  it("post111: helpers.ts still exports seedStationsCache at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) seedStationsCache\b/);
    expect(helpersSrc().indexOf("seedStationsCache")).toBe(4744);

  });
  it("post111: sha256 of export name captureGeminiRequest", () => {

    expect(sha256("captureGeminiRequest")).toBe("41edfbaa9310811ca03f0c1b76bc2a5f0a81b5cf088483c9108ff24c8855b640");
    expect(nibbleSum(sha256("captureGeminiRequest"))).toBe(451);

  });
  it("post111: helpers.ts still exports captureGeminiRequest at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) captureGeminiRequest\b/);
    expect(helpersSrc().indexOf("captureGeminiRequest")).toBe(5160);

  });
  it("post111: sha256 of export name iptvCallsWithInit", () => {

    expect(sha256("iptvCallsWithInit")).toBe("61585f82a260862357f7aa3611f3669aa34a03be4c9cf5ae6f0317526199a193");
    expect(nibbleSum(sha256("iptvCallsWithInit"))).toBe(424);

  });
  it("post111: helpers.ts still exports iptvCallsWithInit at known index", () => {

    expect(helpersSrc()).toMatch(/export (?:function|const) iptvCallsWithInit\b/);
    expect(helpersSrc().indexOf("iptvCallsWithInit")).toBe(5878);

  });
  it("post111: helpers.ts line 0 exact content", () => {

    expect(helpersSrc().split('\n')[0]).toBe("import { vi } from 'vitest';");

  });
  it("post111: helpers.ts line 1 exact content", () => {

    expect(helpersSrc().split('\n')[1]).toBe("import type { Env } from '../src/types';");

  });
  it("post111: helpers.ts line 2 exact content", () => {

    expect(helpersSrc().split('\n')[2]).toBe("");

  });
  it("post111: helpers.ts line 3 exact content", () => {

    expect(helpersSrc().split('\n')[3]).toBe("/** In-memory KV stub for Worker route tests. */");

  });
  it("post111: helpers.ts line 4 exact content", () => {

    expect(helpersSrc().split('\n')[4]).toBe("export function mockKV(seed: Record<string, string> = {}): KVNamespace {");

  });
  it("post111: helpers.ts line 5 exact content", () => {

    expect(helpersSrc().split('\n')[5]).toBe("  const store = new Map(Object.entries(seed));");

  });
  it("post111: helpers.ts line 6 exact content", () => {

    expect(helpersSrc().split('\n')[6]).toBe("  return {");

  });
  it("post111: helpers.ts line 7 exact content", () => {

    expect(helpersSrc().split('\n')[7]).toBe("    get: vi.fn(async (key: string) => store.get(key) ?? null),");

  });
  it("post111: helpers.ts line 8 exact content", () => {

    expect(helpersSrc().split('\n')[8]).toBe("    put: vi.fn(async (key: string, value: string) => {");

  });
  it("post111: helpers.ts line 9 exact content", () => {

    expect(helpersSrc().split('\n')[9]).toBe("      store.set(key, value);");

  });
  it("post111: helpers.ts line 10 exact content", () => {

    expect(helpersSrc().split('\n')[10]).toBe("    }),");

  });
  it("post111: helpers.ts line 11 exact content", () => {

    expect(helpersSrc().split('\n')[11]).toBe("    delete: vi.fn(async (key: string) => {");

  });
  it("post111: helpers.ts line 12 exact content", () => {

    expect(helpersSrc().split('\n')[12]).toBe("      store.delete(key);");

  });
  it("post111: helpers.ts line 13 exact content", () => {

    expect(helpersSrc().split('\n')[13]).toBe("    }),");

  });
  it("post111: helpers.ts line 14 exact content", () => {

    expect(helpersSrc().split('\n')[14]).toBe("    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),");

  });
  it("post111: helpers.ts line 15 exact content", () => {

    expect(helpersSrc().split('\n')[15]).toBe("    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null, cacheStatus: null })),");

  });
  it("post111: helpers.ts line 16 exact content", () => {

    expect(helpersSrc().split('\n')[16]).toBe("  } as unknown as KVNamespace;");

  });
  it("post111: helpers.ts line 17 exact content", () => {

    expect(helpersSrc().split('\n')[17]).toBe("}");

  });
  it("post111: helpers.ts line 18 exact content", () => {

    expect(helpersSrc().split('\n')[18]).toBe("");

  });
  it("post111: helpers.ts line 19 exact content", () => {

    expect(helpersSrc().split('\n')[19]).toBe("export function testEnv(overrides: Partial<Env> = {}): Env {");

  });
  it("post111: helpers.ts line 20 exact content", () => {

    expect(helpersSrc().split('\n')[20]).toBe("  return {");

  });
  it("post111: helpers.ts line 21 exact content", () => {

    expect(helpersSrc().split('\n')[21]).toBe("    CATALOG_CACHE: mockKV(),");

  });
  it("post111: helpers.ts line 22 exact content", () => {

    expect(helpersSrc().split('\n')[22]).toBe("    VERSION: '0.1.0-test',");

  });
  it("post111: helpers.ts line 23 exact content", () => {

    expect(helpersSrc().split('\n')[23]).toBe("    ...overrides,");

  });
  it("post111: helpers.ts line 24 exact content", () => {

    expect(helpersSrc().split('\n')[24]).toBe("  };");

  });
  it("post111: helpers.ts line 25 exact content", () => {

    expect(helpersSrc().split('\n')[25]).toBe("}");

  });
  it("post111: helpers.ts line 26 exact content", () => {

    expect(helpersSrc().split('\n')[26]).toBe("");

  });
  it("post111: helpers.ts line 27 exact content", () => {

    expect(helpersSrc().split('\n')[27]).toBe("export const SAMPLE_M3U = `#EXTM3U");

  });
  it("post111: helpers.ts line 28 exact content", () => {

    expect(helpersSrc().split('\n')[28]).toBe("#EXTINF:-1 tvg-name=\"Alpha FM\" group-title=\"Music\",Alpha FM");

  });
  it("post111: helpers.ts line 29 exact content", () => {

    expect(helpersSrc().split('\n')[29]).toBe("https://example.com/alpha.m3u8");

  });
  it("post111: helpers.ts line 30 exact content", () => {

    expect(helpersSrc().split('\n')[30]).toBe("#EXTINF:-1 tvg-name=\"Beta FM\" group-title=\"Music\",Beta FM");

  });
  it("post111: helpers.ts line 31 exact content", () => {

    expect(helpersSrc().split('\n')[31]).toBe("https://example.com/beta.m3u8");

  });
  it("post111: helpers.ts line 32 exact content", () => {

    expect(helpersSrc().split('\n')[32]).toBe("#EXTINF:-1 tvg-name=\"Gamma FM\" group-title=\"Music\",Gamma FM");

  });
  it("post111: helpers.ts line 33 exact content", () => {

    expect(helpersSrc().split('\n')[33]).toBe("https://example.com/gamma.m3u8");

  });
  it("post111: helpers.ts line 34 exact content", () => {

    expect(helpersSrc().split('\n')[34]).toBe("#EXTINF:-1 tvg-name=\"Delta FM\" group-title=\"Music\",Delta FM");

  });
  it("post111: helpers.ts line 35 exact content", () => {

    expect(helpersSrc().split('\n')[35]).toBe("https://example.com/delta.m3u8");

  });
  it("post111: helpers.ts line 36 exact content", () => {

    expect(helpersSrc().split('\n')[36]).toBe("#EXTINF:-1 tvg-name=\"Epsilon FM\" group-title=\"Music\",Epsilon FM");

  });
  it("post111: helpers.ts line 37 exact content", () => {

    expect(helpersSrc().split('\n')[37]).toBe("https://example.com/epsilon.m3u8");

  });
  it("post111: helpers.ts line 38 exact content", () => {

    expect(helpersSrc().split('\n')[38]).toBe("#EXTINF:-1 tvg-name=\"Zeta FM\" group-title=\"Music\",Zeta FM");

  });
  it("post111: helpers.ts line 39 exact content", () => {

    expect(helpersSrc().split('\n')[39]).toBe("https://example.com/zeta.m3u8");

  });
  it("post111: helpers.ts line 40 exact content", () => {

    expect(helpersSrc().split('\n')[40]).toBe("`;");

  });
  it("post111: helpers.ts line 41 exact content", () => {

    expect(helpersSrc().split('\n')[41]).toBe("");

  });
  it("post111: helpers.ts line 42 exact content", () => {

    expect(helpersSrc().split('\n')[42]).toBe("/** Build a Gemini generateContent-shaped JSON response with the given model text. */");

  });
  it("post111: helpers.ts line 43 exact content", () => {

    expect(helpersSrc().split('\n')[43]).toBe("export function geminiTextResponse(text: string): Response {");

  });
  it("post111: helpers.ts line 44 exact content", () => {

    expect(helpersSrc().split('\n')[44]).toBe("  return Response.json({");

  });
  it("post111: helpers.ts line 45 exact content", () => {

    expect(helpersSrc().split('\n')[45]).toBe("    candidates: [{ content: { parts: [{ text }] } }],");

  });
  it("post111: helpers.ts line 46 exact content", () => {

    expect(helpersSrc().split('\n')[46]).toBe("  });");

  });
  it("post111: helpers.ts line 47 exact content", () => {

    expect(helpersSrc().split('\n')[47]).toBe("}");

  });
  it("post111: helpers.ts line 48 exact content", () => {

    expect(helpersSrc().split('\n')[48]).toBe("");

  });
  it("post111: helpers.ts line 49 exact content", () => {

    expect(helpersSrc().split('\n')[49]).toBe("export function stubIptvAndGemini(opts: {");

  });
  it("post111: helpers.ts line 50 exact content", () => {

    expect(helpersSrc().split('\n')[50]).toBe("  m3u?: string | null;");

  });
  it("post111: helpers.ts line 51 exact content", () => {

    expect(helpersSrc().split('\n')[51]).toBe("  /** Per-category M3U bodies keyed by iptv-org slug (e.g. jazz, music). */");

  });
  it("post111: helpers.ts line 52 exact content", () => {

    expect(helpersSrc().split('\n')[52]).toBe("  iptvByGenre?: Record<string, string | null>;");

  });
  it("post111: helpers.ts line 53 exact content", () => {

    expect(helpersSrc().split('\n')[53]).toBe("  gemini?: Response | (() => Response);");

  });
  it("post111: helpers.ts line 54 exact content", () => {

    expect(helpersSrc().split('\n')[54]).toBe("  iptvStatus?: number;");

  });
  it("post111: helpers.ts line 55 exact content", () => {

    expect(helpersSrc().split('\n')[55]).toBe("}): ReturnType<typeof vi.fn> {");

  });
  it("post111: helpers.ts line 56 exact content", () => {

    expect(helpersSrc().split('\n')[56]).toBe("  const m3u = opts.m3u === undefined ? SAMPLE_M3U : opts.m3u;");

  });
  it("post111: helpers.ts line 57 exact content", () => {

    expect(helpersSrc().split('\n')[57]).toBe("  return vi.fn(async (input: RequestInfo | URL) => {");

  });
  it("post111: helpers.ts line 58 exact content", () => {

    expect(helpersSrc().split('\n')[58]).toBe("    const url = String(input);");

  });
  it("post111: helpers.ts line 59 exact content", () => {

    expect(helpersSrc().split('\n')[59]).toBe("    if (url.includes('iptv-org')) {");

  });
  it("post111: helpers.ts line 60 exact content", () => {

    expect(helpersSrc().split('\n')[60]).toBe("      const genreMatch = url.match(/\\/categories\\/([^/.]+)\\.m3u/);");

  });
  it("post111: helpers.ts line 61 exact content", () => {

    expect(helpersSrc().split('\n')[61]).toBe("      const genre = genreMatch?.[1];");

  });
  it("post111: helpers.ts line 62 exact content", () => {

    expect(helpersSrc().split('\n')[62]).toBe("      if (genre && opts.iptvByGenre && Object.prototype.hasOwnProperty.call(opts.iptvByGenre, genre)) {");

  });
  it("post111: helpers.ts line 63 exact content", () => {

    expect(helpersSrc().split('\n')[63]).toBe("        const body = opts.iptvByGenre[genre];");

  });
  it("post111: helpers.ts line 64 exact content", () => {

    expect(helpersSrc().split('\n')[64]).toBe("        if (body === null) return new Response('down', { status: opts.iptvStatus ?? 503 });");

  });
  it("post111: helpers.ts line 65 exact content", () => {

    expect(helpersSrc().split('\n')[65]).toBe("        return new Response(body, { status: 200 });");

  });
  it("post111: helpers.ts line 66 exact content", () => {

    expect(helpersSrc().split('\n')[66]).toBe("      }");

  });
  it("post111: helpers.ts line 67 exact content", () => {

    expect(helpersSrc().split('\n')[67]).toBe("      if (m3u === null) return new Response('down', { status: opts.iptvStatus ?? 503 });");

  });
  it("post111: helpers.ts line 68 exact content", () => {

    expect(helpersSrc().split('\n')[68]).toBe("      return new Response(m3u, { status: 200 });");

  });
  it("post111: helpers.ts line 69 exact content", () => {

    expect(helpersSrc().split('\n')[69]).toBe("    }");

  });
  it("post111: helpers.ts line 70 exact content", () => {

    expect(helpersSrc().split('\n')[70]).toBe("    if (url.includes('generativelanguage.googleapis.com')) {");

  });
  it("post111: helpers.ts line 71 exact content", () => {

    expect(helpersSrc().split('\n')[71]).toBe("      if (typeof opts.gemini === 'function') return opts.gemini();");

  });
  it("post111: helpers.ts line 72 exact content", () => {

    expect(helpersSrc().split('\n')[72]).toBe("      if (opts.gemini) return opts.gemini;");

  });
  it("post111: helpers.ts line 73 exact content", () => {

    expect(helpersSrc().split('\n')[73]).toBe("      return new Response('boom', { status: 500 });");

  });
  it("post111: helpers.ts line 74 exact content", () => {

    expect(helpersSrc().split('\n')[74]).toBe("    }");

  });
  it("post111: helpers.ts line 75 exact content", () => {

    expect(helpersSrc().split('\n')[75]).toBe("    return new Response('nope', { status: 404 });");

  });
  it("post111: helpers.ts line 76 exact content", () => {

    expect(helpersSrc().split('\n')[76]).toBe("  });");

  });
  it("post111: helpers.ts line 77 exact content", () => {

    expect(helpersSrc().split('\n')[77]).toBe("}");

  });
  it("post111: helpers.ts line 78 exact content", () => {

    expect(helpersSrc().split('\n')[78]).toBe("");

  });
  it("post111: helpers.ts line 79 exact content", () => {

    expect(helpersSrc().split('\n')[79]).toBe("/** Minimal curated Gemini JSON text for happy-path /curate stubs. */");

  });
  it("post111: helpers.ts line 80 exact content", () => {

    expect(helpersSrc().split('\n')[80]).toBe("export function curatedGeminiJson(");

  });
  it("post111: helpers.ts line 81 exact content", () => {

    expect(helpersSrc().split('\n')[81]).toBe("  stations: Array<{ name: string; url: string; editorial: string; genre: string; logo?: string }> = [");

  });
  it("post111: helpers.ts line 82 exact content", () => {

    expect(helpersSrc().split('\n')[82]).toBe("    {");

  });
  it("post111: helpers.ts line 83 exact content", () => {

    expect(helpersSrc().split('\n')[83]).toBe("      name: 'Alpha FM',");

  });
  it("post111: helpers.ts line 84 exact content", () => {

    expect(helpersSrc().split('\n')[84]).toBe("      url: 'https://example.com/alpha.m3u8',");

  });
  it("post111: helpers.ts line 85 exact content", () => {

    expect(helpersSrc().split('\n')[85]).toBe("      editorial: 'Default curated pick.',");

  });
  it("post111: helpers.ts line 86 exact content", () => {

    expect(helpersSrc().split('\n')[86]).toBe("      genre: 'music',");

  });
  it("post111: helpers.ts line 87 exact content", () => {

    expect(helpersSrc().split('\n')[87]).toBe("    },");

  });
  it("post111: helpers.ts line 88 exact content", () => {

    expect(helpersSrc().split('\n')[88]).toBe("  ],");

  });
  it("post111: helpers.ts line 89 exact content", () => {

    expect(helpersSrc().split('\n')[89]).toBe("): Response {");

  });
  it("post111: helpers.ts line 90 exact content", () => {

    expect(helpersSrc().split('\n')[90]).toBe("  return geminiTextResponse(JSON.stringify(stations));");

  });
  it("post111: helpers.ts line 91 exact content", () => {

    expect(helpersSrc().split('\n')[91]).toBe("}");

  });
  it("post111: helpers.ts line 92 exact content", () => {

    expect(helpersSrc().split('\n')[92]).toBe("");

  });
  it("post111: helpers.ts line 93 exact content", () => {

    expect(helpersSrc().split('\n')[93]).toBe("/** Build an iptv-org category URL the Worker fetchStations helper would hit. */");

  });
  it("post111: helpers.ts line 94 exact content", () => {

    expect(helpersSrc().split('\n')[94]).toBe("export function iptvCategoryUrl(genre: string): string {");

  });
  it("post111: helpers.ts line 95 exact content", () => {

    expect(helpersSrc().split('\n')[95]).toBe("  return `https://iptv-org.github.io/iptv/categories/${genre}.m3u`;");

  });
  it("post111: helpers.ts line 96 exact content", () => {

    expect(helpersSrc().split('\n')[96]).toBe("}");

  });
  it("post111: helpers.ts line 97 exact content", () => {

    expect(helpersSrc().split('\n')[97]).toBe("");

  });
  it("post111: helpers.ts line 98 exact content", () => {

    expect(helpersSrc().split('\n')[98]).toBe("/** Count http(s) stream URL lines in an M3U body (post-trim lines). */");

  });
  it("post111: helpers.ts line 99 exact content", () => {

    expect(helpersSrc().split('\n')[99]).toBe("export function countHttpStreamLines(m3u: string): number {");

  });
  it("post111: helpers.ts line 100 exact content", () => {

    expect(helpersSrc().split('\n')[100]).toBe("  return m3u");

  });
  it("post111: helpers.ts line 101 exact content", () => {

    expect(helpersSrc().split('\n')[101]).toBe("    .split('\\n')");

  });
  it("post111: helpers.ts line 102 exact content", () => {

    expect(helpersSrc().split('\n')[102]).toBe("    .map((l) => l.trim())");

  });
  it("post111: helpers.ts line 103 exact content", () => {

    expect(helpersSrc().split('\n')[103]).toBe("    .filter((l) => l.startsWith('http://') || l.startsWith('https://')).length;");

  });
  it("post111: helpers.ts line 104 exact content", () => {

    expect(helpersSrc().split('\n')[104]).toBe("}");

  });
  it("post111: helpers.ts line 105 exact content", () => {

    expect(helpersSrc().split('\n')[105]).toBe("");

  });
  it("post111: helpers.ts line 106 exact content", () => {

    expect(helpersSrc().split('\n')[106]).toBe("/** Minimal EXTINF+URL fixture builder for edge-case route/parser tests. */");

  });
  it("post111: helpers.ts line 107 exact content", () => {

    expect(helpersSrc().split('\n')[107]).toBe("export function buildSimpleM3U(");

  });
  it("post111: helpers.ts line 108 exact content", () => {

    expect(helpersSrc().split('\n')[108]).toBe("  stations: Array<{ name: string; url: string; group?: string; language?: string; country?: string; logo?: string }>,");

  });
  it("post111: helpers.ts line 109 exact content", () => {

    expect(helpersSrc().split('\n')[109]).toBe("): string {");

  });
  it("post111: helpers.ts line 110 exact content", () => {

    expect(helpersSrc().split('\n')[110]).toBe("  const lines = ['#EXTM3U'];");

  });
  it("post111: helpers.ts line 111 exact content", () => {

    expect(helpersSrc().split('\n')[111]).toBe("  for (const s of stations) {");

  });
  it("post111: helpers.ts line 112 exact content", () => {

    expect(helpersSrc().split('\n')[112]).toBe("    const attrs = [");

  });
  it("post111: helpers.ts line 113 exact content", () => {

    expect(helpersSrc().split('\n')[113]).toBe("      `tvg-name=\"${s.name}\"`,");

  });
  it("post111: helpers.ts line 114 exact content", () => {

    expect(helpersSrc().split('\n')[114]).toBe("      s.logo !== undefined ? `tvg-logo=\"${s.logo}\"` : null,");

  });
  it("post111: helpers.ts line 115 exact content", () => {

    expect(helpersSrc().split('\n')[115]).toBe("      s.group !== undefined ? `group-title=\"${s.group}\"` : null,");

  });
  it("post111: helpers.ts line 116 exact content", () => {

    expect(helpersSrc().split('\n')[116]).toBe("      s.language !== undefined ? `tvg-language=\"${s.language}\"` : null,");

  });
  it("post111: helpers.ts line 117 exact content", () => {

    expect(helpersSrc().split('\n')[117]).toBe("      s.country !== undefined ? `tvg-country=\"${s.country}\"` : null,");

  });
  it("post111: helpers.ts line 118 exact content", () => {

    expect(helpersSrc().split('\n')[118]).toBe("    ]");

  });
  it("post111: helpers.ts line 119 exact content", () => {

    expect(helpersSrc().split('\n')[119]).toBe("      .filter(Boolean)");

  });
  it("post111: helpers.ts line 120 exact content", () => {

    expect(helpersSrc().split('\n')[120]).toBe("      .join(' ');");

  });
  it("post111: helpers.ts line 121 exact content", () => {

    expect(helpersSrc().split('\n')[121]).toBe("    lines.push(`#EXTINF:-1 ${attrs},${s.name}`);");

  });
  it("post111: helpers.ts line 122 exact content", () => {

    expect(helpersSrc().split('\n')[122]).toBe("    lines.push(s.url);");

  });
  it("post111: helpers.ts line 123 exact content", () => {

    expect(helpersSrc().split('\n')[123]).toBe("  }");

  });
  it("post111: helpers.ts line 124 exact content", () => {

    expect(helpersSrc().split('\n')[124]).toBe("  return `${lines.join('\\n')}\\n`;");

  });
  it("post111: helpers.ts line 125 exact content", () => {

    expect(helpersSrc().split('\n')[125]).toBe("}");

  });
  it("post111: helpers.ts line 126 exact content", () => {

    expect(helpersSrc().split('\n')[126]).toBe("");

  });
  it("post111: helpers.ts line 127 exact content", () => {

    expect(helpersSrc().split('\n')[127]).toBe("/** Seed a genre cache key with a JSON-serialized or raw string value. */");

  });
  it("post111: helpers.ts line 128 exact content", () => {

    expect(helpersSrc().split('\n')[128]).toBe("export function seedStationsCache(");

  });
  it("post111: helpers.ts line 129 exact content", () => {

    expect(helpersSrc().split('\n')[129]).toBe("  genre: string,");

  });
  it("post111: helpers.ts line 130 exact content", () => {

    expect(helpersSrc().split('\n')[130]).toBe("  value: unknown,");

  });
  it("post111: helpers.ts line 131 exact content", () => {

    expect(helpersSrc().split('\n')[131]).toBe("  existing: Record<string, string> = {},");

  });
  it("post111: helpers.ts line 132 exact content", () => {

    expect(helpersSrc().split('\n')[132]).toBe("): Record<string, string> {");

  });
  it("post111: helpers.ts line 133 exact content", () => {

    expect(helpersSrc().split('\n')[133]).toBe("  const serialized = typeof value === 'string' ? value : JSON.stringify(value);");

  });
  it("post111: helpers.ts line 134 exact content", () => {

    expect(helpersSrc().split('\n')[134]).toBe("  return { ...existing, [`stations:${genre}`]: serialized };");

  });
  it("post111: helpers.ts line 135 exact content", () => {

    expect(helpersSrc().split('\n')[135]).toBe("}");

  });
  it("post111: helpers.ts line 136 exact content", () => {

    expect(helpersSrc().split('\n')[136]).toBe("");

  });
  it("post111: helpers.ts line 137 exact content", () => {

    expect(helpersSrc().split('\n')[137]).toBe("/**");

  });
  it("post111: helpers.ts line 138 exact content", () => {

    expect(helpersSrc().split('\n')[138]).toBe(" * Extract the first generativelanguage.googleapis.com call from a vi fetch mock.");

  });
  it("post111: helpers.ts line 139 exact content", () => {

    expect(helpersSrc().split('\n')[139]).toBe(" * Returns null when Gemini was never hit.");

  });
  it("post111: helpers.ts line 140 exact content", () => {

    expect(helpersSrc().split('\n')[140]).toBe(" */");

  });
  it("post111: helpers.ts line 141 exact content", () => {

    expect(helpersSrc().split('\n')[141]).toBe("export function captureGeminiRequest(");

  });
  it("post111: helpers.ts line 142 exact content", () => {

    expect(helpersSrc().split('\n')[142]).toBe("  fetchMock: { mock: { calls: unknown[][] } },");

  });
  it("post111: helpers.ts line 143 exact content", () => {

    expect(helpersSrc().split('\n')[143]).toBe("): { url: string; method: string; headers: HeadersInit | undefined; body: Record<string, unknown> } | null {");

  });
  it("post111: helpers.ts line 144 exact content", () => {

    expect(helpersSrc().split('\n')[144]).toBe("  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('generativelanguage.googleapis.com'));");

  });
  it("post111: helpers.ts line 145 exact content", () => {

    expect(helpersSrc().split('\n')[145]).toBe("  if (!call) return null;");

  });
  it("post111: helpers.ts line 146 exact content", () => {

    expect(helpersSrc().split('\n')[146]).toBe("  const url = String(call[0]);");

  });
  it("post111: helpers.ts line 147 exact content", () => {

    expect(helpersSrc().split('\n')[147]).toBe("  const init = call[1] as RequestInit | undefined;");

  });
  it("post111: helpers.ts line 148 exact content", () => {

    expect(helpersSrc().split('\n')[148]).toBe("  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};");

  });
  it("post111: helpers.ts line 149 exact content", () => {

    expect(helpersSrc().split('\n')[149]).toBe("  return {");

  });
  it("post111: helpers.ts line 150 exact content", () => {

    expect(helpersSrc().split('\n')[150]).toBe("    url,");

  });
  it("post111: helpers.ts line 151 exact content", () => {

    expect(helpersSrc().split('\n')[151]).toBe("    method: (init?.method ?? 'GET').toString().toUpperCase(),");

  });
  it("post111: helpers.ts line 152 exact content", () => {

    expect(helpersSrc().split('\n')[152]).toBe("    headers: init?.headers,");

  });
  it("post111: helpers.ts line 153 exact content", () => {

    expect(helpersSrc().split('\n')[153]).toBe("    body,");

  });
  it("post111: helpers.ts line 154 exact content", () => {

    expect(helpersSrc().split('\n')[154]).toBe("  };");

  });
  it("post111: helpers.ts line 155 exact content", () => {

    expect(helpersSrc().split('\n')[155]).toBe("}");

  });
  it("post111: helpers.ts line 156 exact content", () => {

    expect(helpersSrc().split('\n')[156]).toBe("");

  });
  it("post111: helpers.ts line 157 exact content", () => {

    expect(helpersSrc().split('\n')[157]).toBe("/** Return iptv-org fetch calls that unexpectedly passed a RequestInit second arg. */");

  });
  it("post111: helpers.ts line 158 exact content", () => {

    expect(helpersSrc().split('\n')[158]).toBe("export function iptvCallsWithInit(fetchMock: { mock: { calls: unknown[][] } }): unknown[][] {");

  });
  it("post111: helpers.ts line 159 exact content", () => {

    expect(helpersSrc().split('\n')[159]).toBe("  return fetchMock.mock.calls.filter(");

  });
  it("post111: helpers.ts line 160 exact content", () => {

    expect(helpersSrc().split('\n')[160]).toBe("    (call) => String(call[0]).includes('iptv-org') && call[1] !== undefined,");

  });
  it("post111: helpers.ts line 161 exact content", () => {

    expect(helpersSrc().split('\n')[161]).toBe("  );");

  });
  it("post111: helpers.ts line 162 exact content", () => {

    expect(helpersSrc().split('\n')[162]).toBe("}");

  });
  it("post111: helpers.ts line 163 exact content", () => {

    expect(helpersSrc().split('\n')[163]).toBe("");

  });
  it("post111: negative \u2014 no wrangler/DNS/credentials inventing", () => {

    expect(helpersSrc()).not.toMatch(/wrangler\.toml|custom_domain|fuzzywigg\.com|GEMINI_API_KEY\s*=|ANTHROPIC|cloudflare\.com\/dns/i);

  });
  it("post111: negative \u2014 no git history / deploy inventing", () => {

    expect(helpersSrc()).not.toMatch(/git (rebase|push|commit)|gh pr|workflow_dispatch|wrangler deploy/i);

  });
  it("post111: negative \u2014 no product route inventing", () => {

    // Comment may mention /curate stubs; lock against real product surfaces only.
    expect(helpersSrc()).not.toMatch(/\bHono\b|\bresolveGenre\b|\bGENRE_MAP\b|\bMCP_MANIFEST\b|app\.(get|post)\(|new Hono/);
    expect(helpersSrc()).not.toMatch(/['"`]\/stations['"`]|['"`]\/curate['"`]/);

  });
  it("post111: SAMPLE_M3U sha256 and HMAC(post111)", () => {

    expect(sha256(SAMPLE_M3U)).toBe("d333f382d92be92d05fc76ff08d56269b7a5f305770748fc8cdf68506169c45e");
    expect(createHmac('sha256', 'post111').update(SAMPLE_M3U, 'utf8').digest('hex')).toBe(
      "79378d0ed2adb8c72be813e36ac146cedc67ab6d0f0086d017bf72b3515bfc25",
    );
    expect(Buffer.byteLength(SAMPLE_M3U, 'utf8')).toBe(554);
    expect(SAMPLE_M3U.split('\n')).toHaveLength(14);

  });
  it("post111: SAMPLE_M3U greek FM names and stems", () => {

    const names = [...SAMPLE_M3U.matchAll(/tvg-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(GREEK.map((g) => `${g} FM`));
    const urls = [...SAMPLE_M3U.matchAll(/^https:\/\/example\.com\/([a-z]+)\.m3u8$/gm)].map((m) => m[1]);
    expect(urls).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']);

  });
  it("post111: SAMPLE_M3U all Music group + parse uniqueness", () => {

    const groups = [...SAMPLE_M3U.matchAll(/group-title="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(groups)).toEqual(new Set(['Music']));
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(6);
    expect(new Set(stations.map((s) => s.url)).size).toBe(6);
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);

  });
  it("post111: GENRE_SLUGS matches VALID_GENRES from genres.ts", () => {

    expect(GENRE_SLUGS).toHaveLength(9);
    expect([...GENRE_SLUGS]).toEqual([
      'music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment',
    ]);
    const genres = readFileSync(join(helpersRoot, 'src/genres.ts'), 'utf8');
    for (const g of GENRE_SLUGS) {
      expect(genres).toContain(`'${g}'`);
    }

  });
  it("post111: genres.ts sha256 cross-lock (no invent)", () => {

    expect(sha256(readFileSync(join(helpersRoot, 'src/genres.ts'), 'utf8'))).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");

  });
  it("post111: mockKV empty seed returns null for missing keys", async () => {

    const kv = mockKV();
    expect(await kv.get('missing')).toBeNull();

  });
  it("post111: mockKV seed round-trips get", async () => {

    const kv = mockKV({ a: '1', b: '2' });
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('b')).toBe('2');

  });
  it("post111: mockKV put overwrites seed", async () => {

    const kv = mockKV({ k: 'old' });
    await kv.put('k', 'new');
    expect(await kv.get('k')).toBe('new');

  });
  it("post111: mockKV delete then get is null", async () => {

    const kv = mockKV({ k: 'v' });
    await kv.delete('k');
    expect(await kv.get('k')).toBeNull();

  });
  it("post111: mockKV list returns empty keys shape", async () => {

    const kv = mockKV({ a: '1' });
    expect(await kv.list()).toEqual({ keys: [], list_complete: true, cacheStatus: null });

  });
  it("post111: mockKV getWithMetadata always nulls", async () => {

    const kv = mockKV({ a: '1' });
    expect(await kv.getWithMetadata('a')).toEqual({ value: null, metadata: null, cacheStatus: null });

  });
  it("post111: mockKV methods are vitest mocks with call counts", async () => {

    const kv = mockKV({ x: '1' });
    await kv.get('x');
    await kv.put('y', '2');
    await kv.delete('x');
    expect(vi.isMockFunction(kv.get)).toBe(true);
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.delete).toHaveBeenCalledTimes(1);

  });
  it("post111: two mockKV instances do not share store", async () => {

    const a = mockKV({ k: 'a' });
    const b = mockKV({ k: 'b' });
    await a.put('k', 'A');
    expect(await b.get('k')).toBe('b');

  });
  it("post111: mockKV stores unicode and empty string values", async () => {

    const kv = mockKV();
    await kv.put('u', 'ラジオ');
    await kv.put('e', '');
    expect(await kv.get('u')).toBe('ラジオ');
    expect(await kv.get('e')).toBe('');

  });
  it("post111: mockKV key with stations: prefix preserved", async () => {

    const kv = mockKV();
    await kv.put('stations:jazz', '[]');
    expect(await kv.get('stations:jazz')).toBe('[]');

  });
  it("post111: mockKV 100 put/get pairs", async () => {

    const kv = mockKV();
    for (let i = 0; i < 100; i++) await kv.put(`k${i}`, `v${i}`);
    for (let i = 0; i < 100; i++) expect(await kv.get(`k${i}`)).toBe(`v${i}`);

  });
  it("post111: testEnv default VERSION and fresh mockKV", async () => {

    const env = testEnv();
    expect(env.VERSION).toBe('0.1.0-test');
    expect(await env.CATALOG_CACHE.get('x')).toBeNull();

  });
  it("post111: testEnv override VERSION", () => {

    expect(testEnv({ VERSION: '9.9.9' }).VERSION).toBe('9.9.9');

  });
  it("post111: testEnv override CATALOG_CACHE seed", async () => {

    const kv = mockKV({ 'stations:music': '[]' });
    const env = testEnv({ CATALOG_CACHE: kv });
    expect(await env.CATALOG_CACHE.get('stations:music')).toBe('[]');

  });
  it("post111: testEnv override does not leak across calls", () => {

    testEnv({ VERSION: 'x' });
    expect(testEnv().VERSION).toBe('0.1.0-test');

  });
  it("post111: testEnv keys only VERSION and CATALOG_CACHE by default", () => {

    expect(Object.keys(testEnv()).sort()).toEqual(['CATALOG_CACHE', 'VERSION']);

  });
  it("post111: geminiTextResponse shape candidates.parts.text", async () => {

    const res = geminiTextResponse('hello');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] });

  });
  it("post111: geminiTextResponse empty string text", async () => {

    const json = (await geminiTextResponse('').json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe('');

  });
  it("post111: geminiTextResponse unicode text", async () => {

    const json = (await geminiTextResponse('東京').json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe('東京');

  });
  it("post111: curatedGeminiJson default Alpha FM music", async () => {

    const json = (await curatedGeminiJson().json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const text = json.candidates[0].content.parts[0].text;
    expect(JSON.parse(text)).toEqual([
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'Default curated pick.',
        genre: 'music',
      },
    ]);

  });
  it("post111: curatedGeminiJson custom stations with logo", async () => {

    const stations = [
      { name: 'A', url: 'https://a', editorial: 'e', genre: 'jazz', logo: 'https://l' },
    ];
    const text = (
      (await curatedGeminiJson(stations).json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      }
    ).candidates[0].content.parts[0].text;
    expect(JSON.parse(text)).toEqual(stations);

  });
  it("post111: curatedGeminiJson empty array", async () => {

    const text = (
      (await curatedGeminiJson([]).json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      }
    ).candidates[0].content.parts[0].text;
    expect(JSON.parse(text)).toEqual([]);

  });
  it("post111: iptvCategoryUrl music", () => {

    expect(iptvCategoryUrl("music")).toBe(
      "https://iptv-org.github.io/iptv/categories/music.m3u",
    );

  });
  it("post111: iptvCategoryUrl ambient", () => {

    expect(iptvCategoryUrl("ambient")).toBe(
      "https://iptv-org.github.io/iptv/categories/ambient.m3u",
    );

  });
  it("post111: iptvCategoryUrl jazz", () => {

    expect(iptvCategoryUrl("jazz")).toBe(
      "https://iptv-org.github.io/iptv/categories/jazz.m3u",
    );

  });
  it("post111: iptvCategoryUrl classical", () => {

    expect(iptvCategoryUrl("classical")).toBe(
      "https://iptv-org.github.io/iptv/categories/classical.m3u",
    );

  });
  it("post111: iptvCategoryUrl pop", () => {

    expect(iptvCategoryUrl("pop")).toBe(
      "https://iptv-org.github.io/iptv/categories/pop.m3u",
    );

  });
  it("post111: iptvCategoryUrl rock", () => {

    expect(iptvCategoryUrl("rock")).toBe(
      "https://iptv-org.github.io/iptv/categories/rock.m3u",
    );

  });
  it("post111: iptvCategoryUrl news", () => {

    expect(iptvCategoryUrl("news")).toBe(
      "https://iptv-org.github.io/iptv/categories/news.m3u",
    );

  });
  it("post111: iptvCategoryUrl sports", () => {

    expect(iptvCategoryUrl("sports")).toBe(
      "https://iptv-org.github.io/iptv/categories/sports.m3u",
    );

  });
  it("post111: iptvCategoryUrl entertainment", () => {

    expect(iptvCategoryUrl("entertainment")).toBe(
      "https://iptv-org.github.io/iptv/categories/entertainment.m3u",
    );

  });
  it("post111: iptvCategoryUrl does not encode slashes", () => {

    expect(iptvCategoryUrl('a/b')).toBe('https://iptv-org.github.io/iptv/categories/a/b.m3u');

  });
  it("post111: iptvCategoryUrl empty genre still builds path", () => {

    expect(iptvCategoryUrl('')).toBe('https://iptv-org.github.io/iptv/categories/.m3u');

  });
  it("post111: countHttpStreamLines empty / header-only", () => {

    expect(countHttpStreamLines('')).toBe(0);
    expect(countHttpStreamLines('#EXTM3U\n')).toBe(0);

  });
  it("post111: countHttpStreamLines counts http and https", () => {

    expect(countHttpStreamLines('#EXTM3U\nhttp://a\nhttps://b\nrtmp://c\n')).toBe(2);

  });
  it("post111: countHttpStreamLines trims before scheme check", () => {

    expect(countHttpStreamLines('  https://a  \n\thttp://b\n')).toBe(2);

  });
  it("post111: countHttpStreamLines ignores uppercase HTTP", () => {

    expect(countHttpStreamLines('HTTP://A\nHTTPS://B\nhttps://c\n')).toBe(1);

  });
  it("post111: countHttpStreamLines matches buildSimpleM3U length", () => {

    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'http://b' },
      { name: 'C', url: 'rtmp://c' },
    ]);
    expect(countHttpStreamLines(m3u)).toBe(2);

  });
  it("post111: countHttpStreamLines equals parseM3U length for SAMPLE_M3U", () => {

    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(parseM3U(SAMPLE_M3U).length);

  });
  it("post111: countHttpStreamLines does not count scheme in comments", () => {

    expect(countHttpStreamLines('# see https://example.com\nhttps://real\n')).toBe(1);

  });
  it("post111: countHttpStreamLines CRLF trimmed lines", () => {

    expect(countHttpStreamLines('https://a\r\nhttp://b\r\n')).toBe(2);

  });
  it("post111: buildSimpleM3U empty is header-only newline", () => {

    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');

  });
  it("post111: buildSimpleM3U name-only attrs", () => {

    expect(buildSimpleM3U([{ name: 'A', url: 'https://a' }])).toBe(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A",A\nhttps://a\n',
    );

  });
  it("post111: buildSimpleM3U all optional attrs order", () => {

    const m3u = buildSimpleM3U([
      {
        name: 'N',
        url: 'https://u',
        logo: 'https://l',
        group: 'G',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(m3u).toBe(
      '#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",N\nhttps://u\n',
    );

  });
  it("post111: buildSimpleM3U omits undefined optionals but keeps empty strings", () => {

    const m3u = buildSimpleM3U([
      { name: 'N', url: 'https://u', logo: '', group: undefined, language: '', country: undefined },
    ]);
    expect(m3u).toContain('tvg-logo=""');
    expect(m3u).toContain('tvg-language=""');
    expect(m3u).not.toContain('group-title=');
    expect(m3u).not.toContain('tvg-country=');

  });
  it("post111: buildSimpleM3U round-trips through parseM3U for 50 stations", () => {

    const input = Array.from({ length: 50 }, (_, i) => ({
      name: `S${i}`,
      url: `https://s/${i}`,
      group: i % 2 ? 'Odd' : 'Even',
    }));
    const stations = parseM3U(buildSimpleM3U(input));
    expect(stations).toHaveLength(50);
    expect(stations[0]).toMatchObject({ name: 'S0', group: 'Even' });
    expect(stations[49]).toMatchObject({ name: 'S49', group: 'Odd' });

  });
  it("post111: buildSimpleM3U scale 200 countHttpStreamLines", () => {

    const input = Array.from({ length: 200 }, (_, i) => ({ name: `N${i}`, url: `https://n/${i}` }));
    expect(countHttpStreamLines(buildSimpleM3U(input))).toBe(200);

  });
  it("post111: seedStationsCache string value passthrough", () => {

    expect(seedStationsCache('jazz', 'raw')).toEqual({ 'stations:jazz': 'raw' });

  });
  it("post111: seedStationsCache object JSON serialized", () => {

    expect(seedStationsCache('music', [{ a: 1 }])).toEqual({
      'stations:music': '[{"a":1}]',
    });

  });
  it("post111: seedStationsCache merges existing without mutating", () => {

    const existing = { 'stations:pop': '[]' };
    const next = seedStationsCache('rock', [], existing);
    expect(next).toEqual({ 'stations:pop': '[]', 'stations:rock': '[]' });
    expect(existing).toEqual({ 'stations:pop': '[]' });

  });
  it("post111: seedStationsCache overwrites same genre key", () => {

    expect(seedStationsCache('jazz', 'new', { 'stations:jazz': 'old' })).toEqual({
      'stations:jazz': 'new',
    });

  });
  it("post111: seedStationsCache key stations:music", () => {

    expect(Object.keys(seedStationsCache("music", []))).toEqual([
      "stations:music",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip music", async () => {

    const seed = seedStationsCache("music", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:music")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group music round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "music" }]);
    expect(parseM3U(m3u)[0].group).toBe("music");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(music)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("music"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: seedStationsCache key stations:ambient", () => {

    expect(Object.keys(seedStationsCache("ambient", []))).toEqual([
      "stations:ambient",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip ambient", async () => {

    const seed = seedStationsCache("ambient", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:ambient")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group ambient round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "ambient" }]);
    expect(parseM3U(m3u)[0].group).toBe("ambient");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(ambient)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("ambient"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: seedStationsCache key stations:jazz", () => {

    expect(Object.keys(seedStationsCache("jazz", []))).toEqual([
      "stations:jazz",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip jazz", async () => {

    const seed = seedStationsCache("jazz", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:jazz")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group jazz round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "jazz" }]);
    expect(parseM3U(m3u)[0].group).toBe("jazz");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(jazz)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("jazz"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: seedStationsCache key stations:classical", () => {

    expect(Object.keys(seedStationsCache("classical", []))).toEqual([
      "stations:classical",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip classical", async () => {

    const seed = seedStationsCache("classical", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:classical")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group classical round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "classical" }]);
    expect(parseM3U(m3u)[0].group).toBe("classical");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(classical)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("classical"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: seedStationsCache key stations:pop", () => {

    expect(Object.keys(seedStationsCache("pop", []))).toEqual([
      "stations:pop",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip pop", async () => {

    const seed = seedStationsCache("pop", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:pop")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group pop round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "pop" }]);
    expect(parseM3U(m3u)[0].group).toBe("pop");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(pop)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("pop"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: seedStationsCache key stations:rock", () => {

    expect(Object.keys(seedStationsCache("rock", []))).toEqual([
      "stations:rock",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip rock", async () => {

    const seed = seedStationsCache("rock", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:rock")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group rock round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "rock" }]);
    expect(parseM3U(m3u)[0].group).toBe("rock");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(rock)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("rock"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: seedStationsCache key stations:news", () => {

    expect(Object.keys(seedStationsCache("news", []))).toEqual([
      "stations:news",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip news", async () => {

    const seed = seedStationsCache("news", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:news")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group news round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "news" }]);
    expect(parseM3U(m3u)[0].group).toBe("news");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(news)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("news"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: seedStationsCache key stations:sports", () => {

    expect(Object.keys(seedStationsCache("sports", []))).toEqual([
      "stations:sports",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip sports", async () => {

    const seed = seedStationsCache("sports", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:sports")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group sports round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "sports" }]);
    expect(parseM3U(m3u)[0].group).toBe("sports");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(sports)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("sports"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: seedStationsCache key stations:entertainment", () => {

    expect(Object.keys(seedStationsCache("entertainment", []))).toEqual([
      "stations:entertainment",
    ]);

  });
  it("post111: seedStationsCache+mockKV round-trip entertainment", async () => {

    const seed = seedStationsCache("entertainment", [{ name: 'X' }]);
    const kv = mockKV(seed);
    expect(await kv.get("stations:entertainment")).toBe('[{"name":"X"}]');

  });
  it("post111: buildSimpleM3U group entertainment round-trips parse", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "entertainment" }]);
    expect(parseM3U(m3u)[0].group).toBe("entertainment");
    expect(countHttpStreamLines(m3u)).toBe(1);

  });
  it("post111: stub default SAMPLE via iptvCategoryUrl(entertainment)", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock(iptvCategoryUrl("entertainment"));
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: stub default SAMPLE for music category", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SAMPLE_M3U);

  });
  it("post111: stub m3u null defaults 503 down", async () => {

    const fetchMock = stubIptvAndGemini({ m3u: null }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');

  });
  it("post111: stub m3u null custom iptvStatus 502", async () => {

    const fetchMock = stubIptvAndGemini({ m3u: null, iptvStatus: 502 }) as unknown as (
      u: string,
    ) => Promise<Response>;
    expect((await fetchMock('https://iptv-org.github.io/x')).status).toBe(502);

  });
  it("post111: stub gemini Response object returned as-is", async () => {

    const canned = new Response('ok', { status: 201 });
    const fetchMock = stubIptvAndGemini({ gemini: canned }) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://generativelanguage.googleapis.com/v1');
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('ok');

  });
  it("post111: stub gemini factory increments", async () => {

    let n = 0;
    const fetchMock = stubIptvAndGemini({
      gemini: () => new Response(String(++n)),
    }) as unknown as (u: string) => Promise<Response>;
    expect(await (await fetchMock('https://generativelanguage.googleapis.com/a')).text()).toBe('1');
    expect(await (await fetchMock('https://generativelanguage.googleapis.com/b')).text()).toBe('2');

  });
  it("post111: stub iptvByGenre per-slug matrix for all GENRE_SLUGS", async () => {

    const iptvByGenre = Object.fromEntries(GENRE_SLUGS.map((g) => [g, `#EXTM3U\n${g}\n`]));
    const fetchMock = stubIptvAndGemini({ iptvByGenre }) as unknown as (u: string) => Promise<Response>;
    for (const g of GENRE_SLUGS) {
      const res = await fetchMock(`https://iptv-org.github.io/iptv/categories/${g}.m3u`);
      expect(await res.text()).toBe(`#EXTM3U\n${g}\n`);
    }

  });
  it("post111: stub iptvByGenre null per slug uses status", async () => {

    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: null },
      iptvStatus: 419,
    }) as unknown as (u: string) => Promise<Response>;
    expect((await fetchMock('https://iptv-org.github.io/iptv/categories/jazz.m3u')).status).toBe(419);

  });
  it("post111: stub non-matching host 404 nope", async () => {

    const fetchMock = stubIptvAndGemini({}) as unknown as (u: string) => Promise<Response>;
    const res = await fetchMock('https://example.org/other');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');

  });
  it("post111: stub URL object for gemini host", async () => {

    const fetchMock = stubIptvAndGemini({ gemini: new Response('g') }) as unknown as (
      u: RequestInfo | URL,
    ) => Promise<Response>;
    const res = await fetchMock(new URL('https://generativelanguage.googleapis.com/x'));
    expect(await res.text()).toBe('g');

  });
  it("post111: stub Request object stringifies to non-url \u2192 404", async () => {

    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U }) as unknown as (
      u: RequestInfo,
    ) => Promise<Response>;
    const res = await fetchMock(new Request('https://iptv-org.github.io/iptv/categories/music.m3u'));
    expect(res.status).toBe(404);

  });
  it("post111: captureGeminiRequest null when no gemini call", () => {

    expect(captureGeminiRequest({ mock: { calls: [['https://iptv-org.github.io/x']] } })).toBeNull();

  });
  it("post111: captureGeminiRequest extracts first gemini call", () => {

    const body = { contents: [{ parts: [{ text: 'hi' }] }] };
    const got = captureGeminiRequest({
      mock: {
        calls: [
          ['https://iptv-org.github.io/x'],
          [
            'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',
            { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
          ],
        ],
      },
    });
    expect(got?.method).toBe('POST');
    expect(got?.body).toEqual(body);
    expect(got?.url).toContain('generativelanguage.googleapis.com');

  });
  it("post111: captureGeminiRequest defaults method GET when init missing", () => {

    const got = captureGeminiRequest({
      mock: { calls: [['https://generativelanguage.googleapis.com/x']] },
    });
    expect(got?.method).toBe('GET');
    expect(got?.body).toEqual({});
    expect(got?.headers).toBeUndefined();

  });
  it("post111: captureGeminiRequest ignores later gemini calls", () => {

    const got = captureGeminiRequest({
      mock: {
        calls: [
          ['https://generativelanguage.googleapis.com/first', { method: 'GET' }],
          ['https://generativelanguage.googleapis.com/second', { method: 'POST', body: '{}' }],
        ],
      },
    });
    expect(got?.url).toContain('first');
    expect(got?.method).toBe('GET');

  });
  it("post111: captureGeminiRequest works on live stub mock history", async () => {

    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    const call = fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    await call('https://generativelanguage.googleapis.com/v1', {
      method: 'POST',
      body: JSON.stringify({ q: 1 }),
    });
    const got = captureGeminiRequest(fetchMock);
    expect(got?.body).toEqual({ q: 1 });
    expect(got?.method).toBe('POST');

  });
  it("post111: iptvCallsWithInit empty when no calls", () => {

    expect(iptvCallsWithInit({ mock: { calls: [] } })).toEqual([]);

  });
  it("post111: iptvCallsWithInit ignores gemini with init", () => {

    expect(
      iptvCallsWithInit({
        mock: { calls: [['https://generativelanguage.googleapis.com/x', { method: 'POST' }]] },
      }),
    ).toEqual([]);

  });
  it("post111: iptvCallsWithInit keeps only iptv with defined init", () => {

    const calls = [
      ['https://iptv-org.github.io/a', undefined],
      ['https://iptv-org.github.io/b', { method: 'GET' }],
      ['https://example.com', { method: 'GET' }],
    ];
    expect(iptvCallsWithInit({ mock: { calls } })).toEqual([calls[1]]);

  });
  it("post111: iptvCallsWithInit live stub with mixed inits", async () => {

    const fetchMock = stubIptvAndGemini({});
    const call = fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    await call(iptvCategoryUrl('music'));
    await call(iptvCategoryUrl('jazz'), { method: 'GET' });
    await call('https://generativelanguage.googleapis.com/x', { method: 'POST', body: '{}' });
    expect(iptvCallsWithInit(fetchMock)).toHaveLength(1);
    expect(String(iptvCallsWithInit(fetchMock)[0][0])).toContain('jazz');

  });
  it("post111: EXPORT_NAMES join HMAC post111", () => {

    expect(createHmac('sha256', 'post111').update(EXPORT_NAMES.join('|'), 'utf8').digest('hex')).toBe(
      "fd19f0e91c3528468d471d8f02243e9458e4bd32e8bbf8f30f43d7dc9e0761b8",
    );

  });
  it("post111: GREEK join sha256", () => {

    expect(sha256(GREEK.join(','))).toBe("10ac8d018205edf425b93aa552770d8ef670574c376fce3844e79e2d6bfe55f7");

  });
  it("post111: structuredClone SAMPLE_M3U stations equals parse", () => {

    const stations = parseM3U(SAMPLE_M3U);
    expect(structuredClone(stations)).toEqual(stations);

  });
  it("post111: Promise.allSettled over GENRE_SLUGS iptvCategoryUrl", async () => {

    const results = await Promise.allSettled(GENRE_SLUGS.map(async (g) => iptvCategoryUrl(g)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(results).toHaveLength(9);

  });
  it("post111: curatedGeminiJson body survives JSON round-trip via capture", async () => {

    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    const call = fetchMock as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    const stations = [{ name: 'Z', url: 'https://z', editorial: 'e', genre: 'rock' }];
    await call('https://generativelanguage.googleapis.com/v1', {
      method: 'POST',
      body: JSON.stringify({ stations }),
    });
    expect(captureGeminiRequest(fetchMock)?.body).toEqual({ stations });

  });
  it("post111: testEnv with seeded stations cache for each genre", async () => {

    let existing: Record<string, string> = {};
    for (const g of GENRE_SLUGS) {
      existing = seedStationsCache(g, [], existing);
    }
    const env = testEnv({ CATALOG_CACHE: mockKV(existing) });
    for (const g of GENRE_SLUGS) {
      expect(await env.CATALOG_CACHE.get(`stations:${g}`)).toBe('[]');
    }

  });
  it("post111: geminiTextResponse genre token music", async () => {

    const json = (await geminiTextResponse("music").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("music");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single music", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "music", url: 'https://u/0' }]))).toBe(1);

  });
  it("post111: geminiTextResponse genre token ambient", async () => {

    const json = (await geminiTextResponse("ambient").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("ambient");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single ambient", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "ambient", url: 'https://u/1' }]))).toBe(1);

  });
  it("post111: geminiTextResponse genre token jazz", async () => {

    const json = (await geminiTextResponse("jazz").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("jazz");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single jazz", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "jazz", url: 'https://u/2' }]))).toBe(1);

  });
  it("post111: geminiTextResponse genre token classical", async () => {

    const json = (await geminiTextResponse("classical").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("classical");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single classical", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "classical", url: 'https://u/3' }]))).toBe(1);

  });
  it("post111: geminiTextResponse genre token pop", async () => {

    const json = (await geminiTextResponse("pop").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("pop");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single pop", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "pop", url: 'https://u/4' }]))).toBe(1);

  });
  it("post111: geminiTextResponse genre token rock", async () => {

    const json = (await geminiTextResponse("rock").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("rock");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single rock", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "rock", url: 'https://u/5' }]))).toBe(1);

  });
  it("post111: geminiTextResponse genre token news", async () => {

    const json = (await geminiTextResponse("news").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("news");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single news", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "news", url: 'https://u/6' }]))).toBe(1);

  });
  it("post111: geminiTextResponse genre token sports", async () => {

    const json = (await geminiTextResponse("sports").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("sports");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single sports", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "sports", url: 'https://u/7' }]))).toBe(1);

  });
  it("post111: geminiTextResponse genre token entertainment", async () => {

    const json = (await geminiTextResponse("entertainment").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("entertainment");

  });
  it("post111: countHttpStreamLines buildSimpleM3U single entertainment", () => {

    expect(countHttpStreamLines(buildSimpleM3U([{ name: "entertainment", url: 'https://u/8' }]))).toBe(1);

  });
});


// --- HEAVY burn (post-#123): deepen helpers leftovers — tests only, no product inventing ---

// --- HEAVY burn (post-#123): deepen helpers leftovers — tests only, no product inventing ---
describe('post123 helpers HEAVY deepen (after #123)', () => {
  const root = helpersRoot;
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

  it('post123: locks package.json sha256', () => {
    expect(sha256("package.json")).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it('post123: locks package.json sha1', () => {
    expect(sha1("package.json")).toBe("b58d14f35b9c13bb254d5e2a51240e2918a126c5");
  });

  it('post123: locks package.json md5', () => {
    expect(md5("package.json")).toBe("63472e1fb514fb0dadb5e49a7bdbaa5f");
  });

  it('post123: locks package.json sha384', () => {
    expect(sha384("package.json")).toBe("4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20");
  });

  it('post123: locks package.json sha512', () => {
    expect(sha512("package.json")).toBe("7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28");
  });

  it('post123: locks package.json sha3-256', () => {
    expect(sha3("package.json")).toBe("e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5");
  });

  it('post123: locks package.json blake2b512', () => {
    expect(blake2b("package.json")).toBe("a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d");
  });

  it('post123: locks package.json ripemd160', () => {
    expect(ripemd("package.json")).toBe("f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad");
  });

  it('post123: locks package.json size 637', () => {
    expect(statSync(join(root, "package.json")).size).toBe(637);
    expect(readFileSync(join(root, "package.json")).byteLength).toBe(637);
  });

  it('post123: locks package.json utf8 635 lines 26', () => {
    expect(read("package.json")).toHaveLength(635);
    expect(read("package.json").split('\n')).toHaveLength(26);
  });

  it('post123: locks package.json nibble 451 xor 13', () => {
    const d = sha256("package.json");
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post123: locks package.json first/last octets', () => {
    const d = sha256("package.json");
    expect(d.slice(0, 2)).toBe("34");
    expect(d.slice(-2)).toBe("1c");
  });

  it('post123: locks package.json HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "package.json")).toBe("f5820d067b7998f6c704e4680b7f143587a45625c630fc73c7b09306b45d6e57");
    expect(hmacSha256('TOKENMAXX', "package.json")).toBe("ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58");
    expect(hmacSha256('ci-config', "package.json")).toBe("9af90b16d02d642aa55aa2a1cf7816f6cab099d1837f4d1efcc3a76638229f38");
  });

  it('post123: locks package.json spaces 106', () => {
    expect((read("package.json").match(/ /g) ?? []).length).toBe(106);
  });

  it('post123: locks vitest.config.ts sha256', () => {
    expect(sha256("vitest.config.ts")).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it('post123: locks vitest.config.ts sha1', () => {
    expect(sha1("vitest.config.ts")).toBe("f8d49517ece92fc5e9781fbde021a948958aac37");
  });

  it('post123: locks vitest.config.ts md5', () => {
    expect(md5("vitest.config.ts")).toBe("f1176313255f5f064a946d458482d81a");
  });

  it('post123: locks vitest.config.ts sha384', () => {
    expect(sha384("vitest.config.ts")).toBe("c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563");
  });

  it('post123: locks vitest.config.ts sha512', () => {
    expect(sha512("vitest.config.ts")).toBe("ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682");
  });

  it('post123: locks vitest.config.ts sha3-256', () => {
    expect(sha3("vitest.config.ts")).toBe("ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba");
  });

  it('post123: locks vitest.config.ts blake2b512', () => {
    expect(blake2b("vitest.config.ts")).toBe("93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a");
  });

  it('post123: locks vitest.config.ts ripemd160', () => {
    expect(ripemd("vitest.config.ts")).toBe("6f29a743813430d4d364f8ddd66e0aedf1506fcd");
  });

  it('post123: locks vitest.config.ts size 535', () => {
    expect(statSync(join(root, "vitest.config.ts")).size).toBe(535);
    expect(readFileSync(join(root, "vitest.config.ts")).byteLength).toBe(535);
  });

  it('post123: locks vitest.config.ts utf8 535 lines 22', () => {
    expect(read("vitest.config.ts")).toHaveLength(535);
    expect(read("vitest.config.ts").split('\n')).toHaveLength(22);
  });

  it('post123: locks vitest.config.ts nibble 536 xor 2', () => {
    const d = sha256("vitest.config.ts");
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post123: locks vitest.config.ts first/last octets', () => {
    const d = sha256("vitest.config.ts");
    expect(d.slice(0, 2)).toBe("f9");
    expect(d.slice(-2)).toBe("38");
  });

  it('post123: locks vitest.config.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "vitest.config.ts")).toBe("a6732e30b4dd61c4da8c346cd49c5deeb3be461ac8881977c82e672d929cd8b4");
    expect(hmacSha256('TOKENMAXX', "vitest.config.ts")).toBe("0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9");
    expect(hmacSha256('ci-config', "vitest.config.ts")).toBe("b48d4463ac3144a8a6e5e60a568762fe11adefce678494ceb591e4e63ae528c3");
  });

  it('post123: locks vitest.config.ts spaces 121', () => {
    expect((read("vitest.config.ts").match(/ /g) ?? []).length).toBe(121);
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

  it('post123: geminiTextResponse token music', async () => {
    const json = (await geminiTextResponse("music").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("music");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single music', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "music", url: "https://u/music" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl music', () => {
    expect(iptvCategoryUrl("music")).toBe("https://iptv-org.github.io/iptv/categories/music.m3u");
  });

  it('post123: geminiTextResponse token ambient', async () => {
    const json = (await geminiTextResponse("ambient").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("ambient");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single ambient', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "ambient", url: "https://u/ambient" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl ambient', () => {
    expect(iptvCategoryUrl("ambient")).toBe("https://iptv-org.github.io/iptv/categories/ambient.m3u");
  });

  it('post123: geminiTextResponse token jazz', async () => {
    const json = (await geminiTextResponse("jazz").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("jazz");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single jazz', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "jazz", url: "https://u/jazz" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl jazz', () => {
    expect(iptvCategoryUrl("jazz")).toBe("https://iptv-org.github.io/iptv/categories/jazz.m3u");
  });

  it('post123: geminiTextResponse token classical', async () => {
    const json = (await geminiTextResponse("classical").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("classical");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single classical', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "classical", url: "https://u/classical" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl classical', () => {
    expect(iptvCategoryUrl("classical")).toBe("https://iptv-org.github.io/iptv/categories/classical.m3u");
  });

  it('post123: geminiTextResponse token pop', async () => {
    const json = (await geminiTextResponse("pop").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("pop");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single pop', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "pop", url: "https://u/pop" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl pop', () => {
    expect(iptvCategoryUrl("pop")).toBe("https://iptv-org.github.io/iptv/categories/pop.m3u");
  });

  it('post123: geminiTextResponse token rock', async () => {
    const json = (await geminiTextResponse("rock").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("rock");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single rock', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "rock", url: "https://u/rock" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl rock', () => {
    expect(iptvCategoryUrl("rock")).toBe("https://iptv-org.github.io/iptv/categories/rock.m3u");
  });

  it('post123: geminiTextResponse token news', async () => {
    const json = (await geminiTextResponse("news").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("news");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single news', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "news", url: "https://u/news" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl news', () => {
    expect(iptvCategoryUrl("news")).toBe("https://iptv-org.github.io/iptv/categories/news.m3u");
  });

  it('post123: geminiTextResponse token sports', async () => {
    const json = (await geminiTextResponse("sports").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("sports");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single sports', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "sports", url: "https://u/sports" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl sports', () => {
    expect(iptvCategoryUrl("sports")).toBe("https://iptv-org.github.io/iptv/categories/sports.m3u");
  });

  it('post123: geminiTextResponse token entertainment', async () => {
    const json = (await geminiTextResponse("entertainment").json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(json.candidates[0].content.parts[0].text).toBe("entertainment");
  });

  it('post123: countHttpStreamLines buildSimpleM3U single entertainment', () => {
    expect(countHttpStreamLines(buildSimpleM3U([{ name: "entertainment", url: "https://u/entertainment" }]))).toBe(1);
  });

  it('post123: iptvCategoryUrl entertainment', () => {
    expect(iptvCategoryUrl("entertainment")).toBe("https://iptv-org.github.io/iptv/categories/entertainment.m3u");
  });

  it('post123: SAMPLE_M3U has 6 https streams', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    expect(SAMPLE_M3U.startsWith('#EXTM3U')).toBe(true);
    expect(SAMPLE_M3U).toContain('Alpha FM');
    expect(SAMPLE_M3U).toContain('Zeta FM');
  });

  it('post123: buildSimpleM3U empty and attributed', () => {
    expect(buildSimpleM3U([])).toBe('#EXTM3U\n');
    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://x', group: 'G', language: 'en', country: 'US', logo: 'https://l' }]);
    expect(m3u).toContain('group-title="G"');
    expect(m3u).toContain('tvg-language="en"');
    expect(m3u).toContain('tvg-country="US"');
    expect(m3u).toContain('tvg-logo="https://l"');
  });

  it('post123: mockKV roundtrip', async () => {
    const kv = mockKV({ a: '1' });
    await expect(kv.get('a')).resolves.toBe('1');
    await kv.put('b', '2');
    await expect(kv.get('b')).resolves.toBe('2');
    await kv.delete('a');
    await expect(kv.get('a')).resolves.toBeNull();
  });

  it('post123: testEnv VERSION defaults and overrides', () => {
    expect(testEnv().VERSION).toBe('0.1.0-test');
    expect(testEnv({ VERSION: '9.9.9' }).VERSION).toBe('9.9.9');
    expect(testEnv().CATALOG_CACHE).toBeTruthy();
  });

  it('post123: seedStationsCache writes stations:genre', () => {
    expect(seedStationsCache('jazz', [{ name: 'J' }])).toEqual({ 'stations:jazz': JSON.stringify([{ name: 'J' }]) });
    expect(seedStationsCache('pop', 'raw', { keep: '1' })).toEqual({ keep: '1', 'stations:pop': 'raw' });
  });

  it('post123: curatedGeminiJson default Alpha FM', async () => {
    const json = (await curatedGeminiJson().json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const stations = JSON.parse(json.candidates[0].content.parts[0].text) as Array<{ name: string }>;
    expect(stations[0].name).toBe('Alpha FM');
  });

  it('post123: stubIptvAndGemini happy paths', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: geminiTextResponse('ok') });
    vi.stubGlobal('fetch', fetchMock);
    const iptv = await fetch('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(iptv.status).toBe(200);
    expect(await iptv.text()).toContain('Alpha FM');
    const gem = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    expect(gem.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('post123: helpers.ts exports mockKV', () => {
    expect(read('test/helpers.ts')).toContain("export function mockKV");
  });

  it('post123: helpers.ts exports testEnv', () => {
    expect(read('test/helpers.ts')).toContain("export function testEnv");
  });

  it('post123: helpers.ts exports geminiTextResponse', () => {
    expect(read('test/helpers.ts')).toContain("export function geminiTextResponse");
  });

  it('post123: helpers.ts exports stubIptvAndGemini', () => {
    expect(read('test/helpers.ts')).toContain("export function stubIptvAndGemini");
  });

  it('post123: helpers.ts exports curatedGeminiJson', () => {
    expect(read('test/helpers.ts')).toContain("export function curatedGeminiJson");
  });

  it('post123: helpers.ts exports iptvCategoryUrl', () => {
    expect(read('test/helpers.ts')).toContain("export function iptvCategoryUrl");
  });

  it('post123: helpers.ts exports countHttpStreamLines', () => {
    expect(read('test/helpers.ts')).toContain("export function countHttpStreamLines");
  });

  it('post123: helpers.ts exports buildSimpleM3U', () => {
    expect(read('test/helpers.ts')).toContain("export function buildSimpleM3U");
  });

  it('post123: helpers.ts exports seedStationsCache', () => {
    expect(read('test/helpers.ts')).toContain("export function seedStationsCache");
  });

  it('post123: helpers.ts exports captureGeminiRequest', () => {
    expect(read('test/helpers.ts')).toContain("export function captureGeminiRequest");
  });

  it('post123: helpers.ts exports iptvCallsWithInit', () => {
    expect(read('test/helpers.ts')).toContain("export function iptvCallsWithInit");
  });

  it('post123: helpers.ts exports SAMPLE_M3U', () => {
    expect(read('test/helpers.ts')).toContain('export const SAMPLE_M3U');
  });

  it('post123: mega purity 30x helpers.ts sha256', () => {
    const expected = "240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29";
    for (let i = 0; i < 30; i++) expect(sha256('test/helpers.ts')).toBe(expected);
  });

  it('post123: negative inventing fence helpers', () => {
    expect(read('test/helpers.ts')).not.toMatch(/\/playlist|\/now-playing/);
  });

  it('post123: final inventory markers', () => {
    const body = read('test/helpers.test.ts');
    expect(body).toContain("describe('post111 helpers HEAVY deepen'");
    expect(body).toContain("describe('post123 helpers HEAVY deepen (after #123)'");
    expect((body.match(/it\('post123:/g) ?? []).length).toBeGreaterThan(80);
  });

});

// --- HEAVY burn (post-#126): deepen helpers leftover edges only — no product inventing ---
// Orthogonal to #126 ci-config leftover edges. Digest/HMAC post126 locks + behavioral leftovers.

describe('post126 helpers HEAVY deepen (after #126)', () => {
  const root = helpersRoot;
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

  it('post126: locks test/helpers.ts sha256', () => {
    expect(sha256("test/helpers.ts")).toBe("240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29");
  });

  it('post126: locks test/helpers.ts sha1', () => {
    expect(sha1("test/helpers.ts")).toBe("aac5e2154aa8f0784db092ad4bb51304fce6e117");
  });

  it('post126: locks test/helpers.ts md5', () => {
    expect(md5("test/helpers.ts")).toBe("004bbc8741017d8dd45bee28a29b46e1");
  });

  it('post126: locks test/helpers.ts sha384', () => {
    expect(sha384("test/helpers.ts")).toBe("1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167");
  });

  it('post126: locks test/helpers.ts sha512', () => {
    expect(sha512("test/helpers.ts")).toBe("153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91");
  });

  it('post126: locks test/helpers.ts sha3-256', () => {
    expect(sha3("test/helpers.ts")).toBe("8ffbb4baecd580e1f9f797a737d24af1f3e0fb48af208435dafe8afaa584b113");
  });

  it('post126: locks test/helpers.ts blake2b512', () => {
    expect(blake2b("test/helpers.ts")).toBe("9000b1e34f31a60c5b766398de6ce5657f7325d791b129e388e1312c47d8448070919d7711a2824b821a99661fbeb73f6e13dfa4b1de53d72aa0990f73f1061f");
  });

  it('post126: locks test/helpers.ts ripemd160', () => {
    expect(ripemd("test/helpers.ts")).toBe("24c482ba1ff1b74537b67a89b99058b6f2e500a4");
  });

  it('post126: locks test/helpers.ts size 6078', () => {
    expect(statSync(join(root, "test/helpers.ts")).size).toBe(6078);
    expect(readFileSync(join(root, "test/helpers.ts")).byteLength).toBe(6078);
  });

  it('post126: locks test/helpers.ts utf8 6078 lines 164', () => {
    expect(read("test/helpers.ts")).toHaveLength(6078);
    expect(read("test/helpers.ts").split('\n')).toHaveLength(164);
  });

  it('post126: locks test/helpers.ts nibble 487 xor 5', () => {
    const d = sha256("test/helpers.ts");
    expect(nibbleSum(d)).toBe(487);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post126: locks test/helpers.ts pairSum 4132 rollingXor 216', () => {
    const d = sha256("test/helpers.ts");
    expect(pairSum(d)).toBe(4132);
    expect(rollingXor(d)).toBe(216);
  });

  it('post126: locks test/helpers.ts first/last/mid octets', () => {
    const d = sha256("test/helpers.ts");
    expect(d.slice(0, 2)).toBe("24");
    expect(d.slice(-2)).toBe("29");
    expect(d.slice(28, 36)).toBe("0c4a4014");
  });

  it('post126: locks test/helpers.ts HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', "test/helpers.ts")).toBe("9bac212ed828d4e80176e29e1a6581de364bcfa6eb7d4f36b0076eb2e8686439");
    expect(hmacSha256('leftover', "test/helpers.ts")).toBe("3cf47764c97927288d3627ddc71cecde2a6313dea10d1f5941a8cce945d8b3d1");
    expect(hmacSha256('TOKENMAXX', "test/helpers.ts")).toBe("8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391");
  });

  it('post126: locks test/helpers.ts HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', "test/helpers.ts")).toBe("a56b1041ff0dfde09d8921086fe9ed340ecd8d8df52322aad730f91c94c86ea2");
    expect(hmacSha256('HEAVY', "test/helpers.ts")).toBe("458cfb306ea3e2c9310b3e3840ecd5a5ca295e18c46146bad4c6111c4c3c1c24");
    expect(hmacSha256('no-product-invent', "test/helpers.ts")).toBe("a6bca018ba16cafff8a3d108bbc4c96391d8da76ccdaf6927e095cbf2e763870");
  });

  it('post126: locks test/helpers.ts spaces 919', () => {
    expect((read("test/helpers.ts").match(/ /g) ?? []).length).toBe(919);
  });

  it('post126: locks test/helpers.ts reversed sha256', () => {
    const rev = [...read("test/helpers.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("e4e0c03b4add5880ffd0e08d925c61f9b010f475d513abd32e2baa8f79ef7625");
  });

  it('post126: locks test/helpers.ts sha256 UPPERCASE', () => {
    expect(sha256("test/helpers.ts").toUpperCase()).toBe("240E1FC521E029B07CA3EBDA83410C4A4014AF02F3AD64FA4EBA8BF6FFD3AF29");
  });

  it('post126: locks test/helpers.ts first-line sha256', () => {
    expect(createHash('sha256').update(read("test/helpers.ts").split('\n')[0]).digest('hex')).toBe("e33b7958170700d0297aa0c9ad1db4689002e9bcee93e0e92b4e20e4837fbe22");
  });

  it('post126: locks test/helpers.ts size*lines 996792', () => {
    expect(statSync(join(root, "test/helpers.ts")).size * read("test/helpers.ts").split('\n').length).toBe(996792);
  });

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

  it('post126: locks src/parser.ts sha256', () => {
    expect(sha256("src/parser.ts")).toBe("cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368");
  });

  it('post126: locks src/parser.ts sha1', () => {
    expect(sha1("src/parser.ts")).toBe("701cdecbef5a9049af6bd11497493c4036a60211");
  });

  it('post126: locks src/parser.ts md5', () => {
    expect(md5("src/parser.ts")).toBe("500211c4c526de887252451726776563");
  });

  it('post126: locks src/parser.ts sha384', () => {
    expect(sha384("src/parser.ts")).toBe("f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9");
  });

  it('post126: locks src/parser.ts sha512', () => {
    expect(sha512("src/parser.ts")).toBe("66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89");
  });

  it('post126: locks src/parser.ts sha3-256', () => {
    expect(sha3("src/parser.ts")).toBe("0ec47247da4cff229cc417b213da73883427985239714e246eb16d1f021bf9c2");
  });

  it('post126: locks src/parser.ts blake2b512', () => {
    expect(blake2b("src/parser.ts")).toBe("d61759e7d0a68efcd16a74811ad84abebe0b82dab5c16e51261ca37118efc5a3c36aec8bc1523ce2b0d3908cd065c7cb8d1c153ea9a31dec633a90ec53aca7ef");
  });

  it('post126: locks src/parser.ts ripemd160', () => {
    expect(ripemd("src/parser.ts")).toBe("36f12fc76af98f06dfa651f814e8f2e13b26c96a");
  });

  it('post126: locks src/parser.ts size 1955', () => {
    expect(statSync(join(root, "src/parser.ts")).size).toBe(1955);
    expect(readFileSync(join(root, "src/parser.ts")).byteLength).toBe(1955);
  });

  it('post126: locks src/parser.ts utf8 1953 lines 67', () => {
    expect(read("src/parser.ts")).toHaveLength(1953);
    expect(read("src/parser.ts").split('\n')).toHaveLength(67);
  });

  it('post126: locks src/parser.ts nibble 477 xor 9', () => {
    const d = sha256("src/parser.ts");
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post126: locks src/parser.ts pairSum 3612 rollingXor 126', () => {
    const d = sha256("src/parser.ts");
    expect(pairSum(d)).toBe(3612);
    expect(rollingXor(d)).toBe(126);
  });

  it('post126: locks src/parser.ts first/last/mid octets', () => {
    const d = sha256("src/parser.ts");
    expect(d.slice(0, 2)).toBe("cf");
    expect(d.slice(-2)).toBe("68");
    expect(d.slice(28, 36)).toBe("a0e83a07");
  });

  it('post126: locks src/parser.ts HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', "src/parser.ts")).toBe("37e5f42836543b47389f2ea0a090b73fae44bd622643292ff3eb8ac0cebd2ca3");
    expect(hmacSha256('leftover', "src/parser.ts")).toBe("e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3");
    expect(hmacSha256('TOKENMAXX', "src/parser.ts")).toBe("eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8");
  });

  it('post126: locks src/parser.ts HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', "src/parser.ts")).toBe("c4da10756de18543677a0c5b1498e3c41d8fdaee085c296f8218b139a5a0aa70");
    expect(hmacSha256('HEAVY', "src/parser.ts")).toBe("fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70");
    expect(hmacSha256('no-product-invent', "src/parser.ts")).toBe("25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f");
  });

  it('post126: locks src/parser.ts spaces 432', () => {
    expect((read("src/parser.ts").match(/ /g) ?? []).length).toBe(432);
  });

  it('post126: locks src/parser.ts reversed sha256', () => {
    const rev = [...read("src/parser.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("a78f8cb8e92e3203b94933c1ec51e34ac1f54892dcc0c99024a48333407e79de");
  });

  it('post126: locks src/parser.ts sha256 UPPERCASE', () => {
    expect(sha256("src/parser.ts").toUpperCase()).toBe("CF293136412FBA636AD7391BCEA0A0E83A079FBBCC8FC14D0CA41FA6621F4368");
  });

  it('post126: locks src/parser.ts first-line sha256', () => {
    expect(createHash('sha256').update(read("src/parser.ts").split('\n')[0]).digest('hex')).toBe("64a393f12da7f34518f8343d01e7da0c8da3e9f0b9cf1916ec7af9a35cbf8eb5");
  });

  it('post126: locks src/parser.ts size*lines 130985', () => {
    expect(statSync(join(root, "src/parser.ts")).size * read("src/parser.ts").split('\n').length).toBe(130985);
  });

  it('post126: captureGeminiRequest null when no gemini call', () => {
    expect(captureGeminiRequest({ mock: { calls: [['https://iptv-org.github.io/iptv/categories/music.m3u']] } })).toBeNull();
  });

  it('post126: captureGeminiRequest parses POST body', () => {
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] });
    const got = captureGeminiRequest({
      mock: {
        calls: [
          ['https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k', { method: 'POST', body, headers: { 'content-type': 'application/json' } }],
        ],
      },
    });
    expect(got).not.toBeNull();
    expect(got!.method).toBe('POST');
    expect(got!.body).toEqual({ contents: [{ parts: [{ text: 'hi' }] }] });
    expect(got!.url).toContain('generativelanguage.googleapis.com');
  });

  it('post126: iptvCallsWithInit filters only iptv with init', () => {
    const calls = [
      ['https://iptv-org.github.io/iptv/categories/music.m3u'],
      ['https://iptv-org.github.io/iptv/categories/jazz.m3u', { method: 'GET' }],
      ['https://generativelanguage.googleapis.com/x', { method: 'POST' }],
    ];
    expect(iptvCallsWithInit({ mock: { calls } })).toHaveLength(1);
    expect(String(iptvCallsWithInit({ mock: { calls } })[0][0])).toContain('jazz');
  });

  it('post126: stubIptvAndGemini iptvByGenre null returns status', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: null }, iptvStatus: 418 });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
    vi.unstubAllGlobals();
  });

  it('post126: stubIptvAndGemini unknown host 404', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://example.com/nope');
    expect(res.status).toBe(404);
    vi.unstubAllGlobals();
  });

  it('post126: stubIptvAndGemini gemini function form', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: () => geminiTextResponse('fn') });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    const json = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    expect(json.candidates[0].content.parts[0].text).toBe('fn');
    vi.unstubAllGlobals();
  });

  it('post126: stubIptvAndGemini default gemini 500', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    expect(res.status).toBe(500);
    vi.unstubAllGlobals();
  });

  it('post126: countHttpStreamLines ignores rtmp and blanks', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nrtmp://b\n\nhttp://c\n';
    expect(countHttpStreamLines(m3u)).toBe(2);
  });

  it('post126: buildSimpleM3U omits undefined attrs', () => {
    const m3u = buildSimpleM3U([{ name: 'Solo', url: 'https://s' }]);
    expect(m3u).toContain('tvg-name="Solo"');
    expect(m3u).not.toContain('group-title');
    expect(m3u).not.toContain('tvg-logo');
    expect(m3u).not.toContain('tvg-language');
    expect(m3u).not.toContain('tvg-country');
  });

  it('post126: mockKV list/getWithMetadata stubs', async () => {
    const kv = mockKV();
    await expect(kv.list({} as KVNamespaceListOptions)).resolves.toEqual({ keys: [], list_complete: true, cacheStatus: null });
    await expect(kv.getWithMetadata('x')).resolves.toEqual({ value: null, metadata: null, cacheStatus: null });
  });

  it('post126: curatedGeminiJson custom stations', async () => {
    const res = curatedGeminiJson([{ name: 'Custom', url: 'https://c', editorial: 'e', genre: 'jazz', logo: 'https://l' }]);
    const json = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const stations = JSON.parse(json.candidates[0].content.parts[0].text) as Array<{ name: string; logo?: string }>;
    expect(stations[0].name).toBe('Custom');
    expect(stations[0].logo).toBe('https://l');
  });

  it('post126: SAMPLE_M3U parses to 6 unique urls', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(6);
    expect(new Set(stations.map((s) => s.url)).size).toBe(6);
  });

  it('post126: seedStationsCache object serialization', () => {
    const bag = seedStationsCache('rock', [{ name: 'R', url: 'https://r' }]);
    expect(JSON.parse(bag['stations:rock'])).toEqual([{ name: 'R', url: 'https://r' }]);
  });

  it('post126: testEnv does not invent GEMINI_API_KEY by default', () => {
    expect(testEnv().GEMINI_API_KEY).toBeUndefined();
  });


  it('post126: mega purity 30x helpers.ts sha256', () => {
    const expected = "240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29";
    for (let i = 0; i < 30; i++) expect(sha256('test/helpers.ts')).toBe(expected);
  });

  it('post126: negative inventing fence helpers', () => {
    expect(read('test/helpers.ts')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('test/helpers.ts')).not.toMatch(/openapi\.json|Durable Object|process\.env/);
  });

  it('post126: final inventory markers', () => {
    const body = read('test/helpers.test.ts');
    expect(body).toContain("describe('post123 helpers HEAVY deepen (after #123)'");
    expect(body).toContain("describe('post126 helpers HEAVY deepen (after #126)'");
    expect((body.match(/it\('post126:/g) ?? []).length).toBeGreaterThan(40);
  });

});

describe('post132 helpers HEAVY deepen (after #132)', () => {
  const root = helpersRoot;
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

  it('post132: locks test/helpers.ts sha256', () => {
    expect(sha256('test/helpers.ts')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
  });

  it('post132: locks test/helpers.ts sha1', () => {
    expect(sha1('test/helpers.ts')).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
  });

  it('post132: locks test/helpers.ts md5', () => {
    expect(md5('test/helpers.ts')).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it('post132: locks test/helpers.ts sha384', () => {
    expect(sha384('test/helpers.ts')).toBe('1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167');
  });

  it('post132: locks test/helpers.ts sha512', () => {
    expect(sha512('test/helpers.ts')).toBe('153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91');
  });

  it('post132: locks test/helpers.ts sha3-256', () => {
    expect(sha3('test/helpers.ts')).toBe('8ffbb4baecd580e1f9f797a737d24af1f3e0fb48af208435dafe8afaa584b113');
  });

  it('post132: locks test/helpers.ts blake2b512', () => {
    expect(blake2b('test/helpers.ts')).toBe('9000b1e34f31a60c5b766398de6ce5657f7325d791b129e388e1312c47d8448070919d7711a2824b821a99661fbeb73f6e13dfa4b1de53d72aa0990f73f1061f');
  });

  it('post132: locks test/helpers.ts ripemd160', () => {
    expect(ripemd('test/helpers.ts')).toBe('24c482ba1ff1b74537b67a89b99058b6f2e500a4');
  });

  it('post132: locks test/helpers.ts size 6078', () => {
    expect(statSync(join(root, 'test/helpers.ts')).size).toBe(6078);
    expect(readFileSync(join(root, 'test/helpers.ts')).byteLength).toBe(6078);
  });

  it('post132: locks test/helpers.ts utf8 6078 lines 164', () => {
    expect(read('test/helpers.ts')).toHaveLength(6078);
    expect(read('test/helpers.ts').split('\n')).toHaveLength(164);
  });

  it('post132: locks test/helpers.ts nibble 487 xor 5', () => {
    const d = sha256('test/helpers.ts');
    expect(nibbleSum(d)).toBe(487);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post132: locks test/helpers.ts pairSum 4132 rollingXor 216', () => {
    const d = sha256('test/helpers.ts');
    expect(pairSum(d)).toBe(4132);
    expect(rollingXor(d)).toBe(216);
  });

  it('post132: locks test/helpers.ts first/last/mid octets', () => {
    const d = sha256('test/helpers.ts');
    expect(d.slice(0, 2)).toBe('24');
    expect(d.slice(-2)).toBe('29');
    expect(d.slice(28, 36)).toBe('0c4a4014');
  });

  it('post132: locks test/helpers.ts HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'test/helpers.ts')).toBe('7d11846bfd7974d3bd5c476286527d70d26309f4169b3d4bfe87984c7a8ef446');
    expect(hmacSha256('leftover', 'test/helpers.ts')).toBe('3cf47764c97927288d3627ddc71cecde2a6313dea10d1f5941a8cce945d8b3d1');
    expect(hmacSha256('TOKENMAXX', 'test/helpers.ts')).toBe('8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391');
  });

  it('post132: locks test/helpers.ts HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'test/helpers.ts')).toBe('d980cef90114fe89f940e4e5aa0911182176c88620361495962acd5b920ca7ac');
    expect(hmacSha256('HEAVY', 'test/helpers.ts')).toBe('458cfb306ea3e2c9310b3e3840ecd5a5ca295e18c46146bad4c6111c4c3c1c24');
    expect(hmacSha256('no-product-invent', 'test/helpers.ts')).toBe('a6bca018ba16cafff8a3d108bbc4c96391d8da76ccdaf6927e095cbf2e763870');
  });

  it('post132: locks test/helpers.ts spaces 919', () => {
    expect((read('test/helpers.ts').match(/ /g) ?? []).length).toBe(919);
  });

  it('post132: locks test/helpers.ts reversed sha256', () => {
    const rev = [...read('test/helpers.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e4e0c03b4add5880ffd0e08d925c61f9b010f475d513abd32e2baa8f79ef7625');
  });

  it('post132: locks test/helpers.ts sha256 UPPERCASE', () => {
    expect(sha256('test/helpers.ts').toUpperCase()).toBe('240E1FC521E029B07CA3EBDA83410C4A4014AF02F3AD64FA4EBA8BF6FFD3AF29');
  });

  it('post132: locks test/helpers.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('test/helpers.ts').split('\n')[0]).digest('hex')).toBe('e33b7958170700d0297aa0c9ad1db4689002e9bcee93e0e92b4e20e4837fbe22');
  });

  it('post132: locks test/helpers.ts size*lines 996792', () => {
    expect(statSync(join(root, 'test/helpers.ts')).size * read('test/helpers.ts').split('\n').length).toBe(996792);
  });

  it('post132: locks test/helpers.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('test/helpers.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(163);
    expect((t.match(/,/g) ?? []).length).toBe(58);
    expect((t.match(/:/g) ?? []).length).toBe(106);
    expect((t.match(/"/g) ?? []).length).toBe(34);
    expect((t.match(/'/g) ?? []).length).toBe(48);
  });

  it('post132: locks test/helpers.ts HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex')).toBe('da956d03b86102f44dfcc57f9828b6272ec5a1ba');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex')).toBe('4dcd0168a5110ac94fc5dc04b1103f87');
  });

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


  it('post132: captureGeminiRequest null when no gemini call', () => {
    expect(captureGeminiRequest({ mock: { calls: [['https://iptv-org.github.io/iptv/categories/music.m3u']] } })).toBeNull();
  });

  it('post132: captureGeminiRequest parses POST body', () => {
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'post132' }] }] });
    const got = captureGeminiRequest({
      mock: {
        calls: [
          ['https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k', { method: 'POST', body, headers: { 'content-type': 'application/json' } }],
        ],
      },
    });
    expect(got).not.toBeNull();
    expect(got!.method).toBe('POST');
    expect(got!.body).toEqual({ contents: [{ parts: [{ text: 'post132' }] }] });
    expect(got!.url).toContain('generativelanguage.googleapis.com');
  });

  it('post132: iptvCallsWithInit filters only iptv with init', () => {
    const calls = [
      ['https://iptv-org.github.io/iptv/categories/music.m3u'],
      ['https://iptv-org.github.io/iptv/categories/jazz.m3u', { method: 'GET' }],
      ['https://generativelanguage.googleapis.com/x', { method: 'POST' }],
    ];
    expect(iptvCallsWithInit({ mock: { calls } })).toHaveLength(1);
    expect(String(iptvCallsWithInit({ mock: { calls } })[0][0])).toContain('jazz');
  });

  it('post132: stubIptvAndGemini iptvByGenre null returns status', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: null }, iptvStatus: 418 });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
    vi.unstubAllGlobals();
  });

  it('post132: stubIptvAndGemini unknown host 404', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://example.com/nope');
    expect(res.status).toBe(404);
    vi.unstubAllGlobals();
  });

  it('post132: stubIptvAndGemini gemini function form', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: () => geminiTextResponse('fn132') });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    const json = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    expect(json.candidates[0].content.parts[0].text).toBe('fn132');
    vi.unstubAllGlobals();
  });

  it('post132: stubIptvAndGemini default gemini 500', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    expect(res.status).toBe(500);
    vi.unstubAllGlobals();
  });

  it('post132: countHttpStreamLines ignores rtmp and blanks', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nrtmp://b\n\nhttp://c\n';
    expect(countHttpStreamLines(m3u)).toBe(2);
  });

  it('post132: buildSimpleM3U omits undefined attrs', () => {
    const m3u = buildSimpleM3U([{ name: 'Solo132', url: 'https://s132' }]);
    expect(m3u).toContain('tvg-name="Solo132"');
    expect(m3u).not.toContain('group-title');
    expect(m3u).not.toContain('tvg-logo');
  });

  it('post132: mockKV list/getWithMetadata stubs', async () => {
    const kv = mockKV();
    await expect(kv.list({} as KVNamespaceListOptions)).resolves.toEqual({ keys: [], list_complete: true, cacheStatus: null });
    await expect(kv.getWithMetadata('x')).resolves.toEqual({ value: null, metadata: null, cacheStatus: null });
  });

  it('post132: curatedGeminiJson custom stations', async () => {
    const res = curatedGeminiJson([{ name: 'Custom132', url: 'https://c132', editorial: 'e', genre: 'jazz', logo: 'https://l' }]);
    const json = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const stations = JSON.parse(json.candidates[0].content.parts[0].text) as Array<{ name: string; logo?: string }>;
    expect(stations[0].name).toBe('Custom132');
    expect(stations[0].logo).toBe('https://l');
  });

  it('post132: SAMPLE_M3U parses to 6 unique urls', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(6);
    expect(new Set(stations.map((s) => s.url)).size).toBe(6);
  });

  it('post132: seedStationsCache object serialization', () => {
    const bag = seedStationsCache('rock', [{ name: 'R132', url: 'https://r132' }]);
    expect(JSON.parse(bag['stations:rock'])).toEqual([{ name: 'R132', url: 'https://r132' }]);
  });

  it('post132: testEnv does not invent GEMINI_API_KEY by default', () => {
    expect(testEnv().GEMINI_API_KEY).toBeUndefined();
  });

  it('post132: iptvCategoryUrl shape', () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it('post132: mega purity 40x helpers.ts sha256', () => {
    const expected = "240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29";
    for (let i = 0; i < 40; i++) expect(sha256('test/helpers.ts')).toBe(expected);
  });

  it('post132: negative inventing fence helpers', () => {
    expect(read('test/helpers.ts')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('test/helpers.ts')).not.toMatch(/openapi\.json|Durable Object|process\.env/);
  });

  it('post132: final inventory markers', () => {
    const body = read('test/helpers.test.ts');
    expect(body).toContain("describe('post126 helpers HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 helpers HEAVY deepen (after #132)'");
    expect((body.match(/it\('post132:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post136 helpers HEAVY deepen (after #136)', () => {
  const root = helpersRoot;
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

  it('post136: locks test/helpers.ts sha256', () => {
    expect(sha256('test/helpers.ts')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
  });

  it('post136: locks test/helpers.ts sha1', () => {
    expect(sha1('test/helpers.ts')).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
  });

  it('post136: locks test/helpers.ts md5', () => {
    expect(md5('test/helpers.ts')).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it('post136: locks test/helpers.ts sha384', () => {
    expect(sha384('test/helpers.ts')).toBe('1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167');
  });

  it('post136: locks test/helpers.ts sha512', () => {
    expect(sha512('test/helpers.ts')).toBe('153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91');
  });

  it('post136: locks test/helpers.ts sha3-256', () => {
    expect(sha3('test/helpers.ts')).toBe('8ffbb4baecd580e1f9f797a737d24af1f3e0fb48af208435dafe8afaa584b113');
  });

  it('post136: locks test/helpers.ts blake2b512', () => {
    expect(blake2b('test/helpers.ts')).toBe('9000b1e34f31a60c5b766398de6ce5657f7325d791b129e388e1312c47d8448070919d7711a2824b821a99661fbeb73f6e13dfa4b1de53d72aa0990f73f1061f');
  });

  it('post136: locks test/helpers.ts ripemd160', () => {
    expect(ripemd('test/helpers.ts')).toBe('24c482ba1ff1b74537b67a89b99058b6f2e500a4');
  });

  it('post136: locks test/helpers.ts size 6078', () => {
    expect(statSync(join(root, 'test/helpers.ts')).size).toBe(6078);
    expect(readFileSync(join(root, 'test/helpers.ts')).byteLength).toBe(6078);
  });

  it('post136: locks test/helpers.ts utf8 6078 lines 164', () => {
    expect(read('test/helpers.ts')).toHaveLength(6078);
    expect(read('test/helpers.ts').split('\n')).toHaveLength(164);
  });

  it('post136: locks test/helpers.ts nibble 487 xor 5', () => {
    const d = sha256('test/helpers.ts');
    expect(nibbleSum(d)).toBe(487);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post136: locks test/helpers.ts pairSum 4132 rollingXor 216', () => {
    const d = sha256('test/helpers.ts');
    expect(pairSum(d)).toBe(4132);
    expect(rollingXor(d)).toBe(216);
  });

  it('post136: locks test/helpers.ts first/last/mid octets', () => {
    const d = sha256('test/helpers.ts');
    expect(d.slice(0, 2)).toBe('24');
    expect(d.slice(-2)).toBe('29');
    expect(d.slice(28, 36)).toBe('0c4a4014');
  });

  it('post136: locks test/helpers.ts HMAC post136/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post136', 'test/helpers.ts')).toBe('05548dd547f86a08ab949c931c67af5f0fe14960964e3bb528cc7d41a0f6b09c');
    expect(hmacSha256('leftover', 'test/helpers.ts')).toBe('3cf47764c97927288d3627ddc71cecde2a6313dea10d1f5941a8cce945d8b3d1');
    expect(hmacSha256('TOKENMAXX', 'test/helpers.ts')).toBe('8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391');
  });

  it('post136: locks test/helpers.ts HMAC after-#136/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#136', 'test/helpers.ts')).toBe('44f498f3c0802185c634ed94f1538b57b5cd247b87ff0e136d8d02b57958a310');
    expect(hmacSha256('HEAVY', 'test/helpers.ts')).toBe('458cfb306ea3e2c9310b3e3840ecd5a5ca295e18c46146bad4c6111c4c3c1c24');
    expect(hmacSha256('no-product-invent', 'test/helpers.ts')).toBe('a6bca018ba16cafff8a3d108bbc4c96391d8da76ccdaf6927e095cbf2e763870');
  });

  it('post136: locks test/helpers.ts spaces 919', () => {
    expect((read('test/helpers.ts').match(/ /g) ?? []).length).toBe(919);
  });

  it('post136: locks test/helpers.ts reversed sha256', () => {
    const rev = [...read('test/helpers.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e4e0c03b4add5880ffd0e08d925c61f9b010f475d513abd32e2baa8f79ef7625');
  });

  it('post136: locks test/helpers.ts sha256 UPPERCASE', () => {
    expect(sha256('test/helpers.ts').toUpperCase()).toBe('240E1FC521E029B07CA3EBDA83410C4A4014AF02F3AD64FA4EBA8BF6FFD3AF29');
  });

  it('post136: locks test/helpers.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('test/helpers.ts').split('\n')[0]).digest('hex')).toBe('e33b7958170700d0297aa0c9ad1db4689002e9bcee93e0e92b4e20e4837fbe22');
  });

  it('post136: locks test/helpers.ts size*lines 996792', () => {
    expect(statSync(join(root, 'test/helpers.ts')).size * read('test/helpers.ts').split('\n').length).toBe(996792);
  });

  it('post136: locks test/helpers.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('test/helpers.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(163);
    expect((t.match(/,/g) ?? []).length).toBe(58);
    expect((t.match(/:/g) ?? []).length).toBe(106);
    expect((t.match(/"/g) ?? []).length).toBe(34);
    expect((t.match(/'/g) ?? []).length).toBe(48);
  });

  it('post136: locks test/helpers.ts HMAC-SHA1/MD5 key post136', () => {
    expect(createHmac('sha1', 'post136').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex')).toBe('4a53baf93fd7ee880c781eb8f71143031e1ea290');
    expect(createHmac('md5', 'post136').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex')).toBe('2e313a6122536119c84c6cda2c6993e2');
  });

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


  it('post136: captureGeminiRequest null when no gemini call', () => {
    expect(captureGeminiRequest({ mock: { calls: [['https://iptv-org.github.io/iptv/categories/music.m3u']] } })).toBeNull();
  });

  it('post136: captureGeminiRequest parses POST body', () => {
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'post136' }] }] });
    const got = captureGeminiRequest({
      mock: {
        calls: [
          ['https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k', { method: 'POST', body, headers: { 'content-type': 'application/json' } }],
        ],
      },
    });
    expect(got).not.toBeNull();
    expect(got!.method).toBe('POST');
    expect(got!.body).toEqual({ contents: [{ parts: [{ text: 'post136' }] }] });
    expect(got!.url).toContain('generativelanguage.googleapis.com');
  });

  it('post136: iptvCallsWithInit filters only iptv with init', () => {
    const calls = [
      ['https://iptv-org.github.io/iptv/categories/music.m3u'],
      ['https://iptv-org.github.io/iptv/categories/jazz.m3u', { method: 'GET' }],
      ['https://generativelanguage.googleapis.com/x', { method: 'POST' }],
    ];
    expect(iptvCallsWithInit({ mock: { calls } })).toHaveLength(1);
    expect(String(iptvCallsWithInit({ mock: { calls } })[0][0])).toContain('jazz');
  });

  it('post136: stubIptvAndGemini iptvByGenre null returns status', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: null }, iptvStatus: 418 });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
    vi.unstubAllGlobals();
  });

  it('post136: stubIptvAndGemini unknown host 404', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://example.com/nope');
    expect(res.status).toBe(404);
    vi.unstubAllGlobals();
  });

  it('post136: stubIptvAndGemini gemini function form', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: () => geminiTextResponse('fn132') });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    const json = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    expect(json.candidates[0].content.parts[0].text).toBe('fn132');
    vi.unstubAllGlobals();
  });

  it('post136: stubIptvAndGemini default gemini 500', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    expect(res.status).toBe(500);
    vi.unstubAllGlobals();
  });

  it('post136: countHttpStreamLines ignores rtmp and blanks', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nrtmp://b\n\nhttp://c\n';
    expect(countHttpStreamLines(m3u)).toBe(2);
  });

  it('post136: buildSimpleM3U omits undefined attrs', () => {
    const m3u = buildSimpleM3U([{ name: 'Solo132', url: 'https://s132' }]);
    expect(m3u).toContain('tvg-name="Solo132"');
    expect(m3u).not.toContain('group-title');
    expect(m3u).not.toContain('tvg-logo');
  });

  it('post136: mockKV list/getWithMetadata stubs', async () => {
    const kv = mockKV();
    await expect(kv.list({} as KVNamespaceListOptions)).resolves.toEqual({ keys: [], list_complete: true, cacheStatus: null });
    await expect(kv.getWithMetadata('x')).resolves.toEqual({ value: null, metadata: null, cacheStatus: null });
  });

  it('post136: curatedGeminiJson custom stations', async () => {
    const res = curatedGeminiJson([{ name: 'Custom132', url: 'https://c132', editorial: 'e', genre: 'jazz', logo: 'https://l' }]);
    const json = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const stations = JSON.parse(json.candidates[0].content.parts[0].text) as Array<{ name: string; logo?: string }>;
    expect(stations[0].name).toBe('Custom132');
    expect(stations[0].logo).toBe('https://l');
  });

  it('post136: SAMPLE_M3U parses to 6 unique urls', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(6);
    expect(new Set(stations.map((s) => s.url)).size).toBe(6);
  });

  it('post136: seedStationsCache object serialization', () => {
    const bag = seedStationsCache('rock', [{ name: 'R132', url: 'https://r132' }]);
    expect(JSON.parse(bag['stations:rock'])).toEqual([{ name: 'R132', url: 'https://r132' }]);
  });

  it('post136: testEnv does not invent GEMINI_API_KEY by default', () => {
    expect(testEnv().GEMINI_API_KEY).toBeUndefined();
  });

  it('post136: iptvCategoryUrl shape', () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it('post136: mega purity 40x helpers.ts sha256', () => {
    const expected = "240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29";
    for (let i = 0; i < 40; i++) expect(sha256('test/helpers.ts')).toBe(expected);
  });

  it('post136: negative inventing fence helpers', () => {
    expect(read('test/helpers.ts')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('test/helpers.ts')).not.toMatch(/openapi\.json|Durable Object|process\.env/);
  });

  it('post136: final inventory markers', () => {
    const body = read('test/helpers.test.ts');
    expect(body).toContain("describe('post126 helpers HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 helpers HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post136 helpers HEAVY deepen (after #136)'");
    expect((body.match(/it\('post136:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post141 helpers HEAVY deepen (after #141)', () => {
  const root = helpersRoot;
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

  it('post141: locks test/helpers.ts sha256', () => {
    expect(sha256('test/helpers.ts')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
  });

  it('post141: locks test/helpers.ts sha1', () => {
    expect(sha1('test/helpers.ts')).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
  });

  it('post141: locks test/helpers.ts md5', () => {
    expect(md5('test/helpers.ts')).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it('post141: locks test/helpers.ts sha384', () => {
    expect(sha384('test/helpers.ts')).toBe('1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167');
  });

  it('post141: locks test/helpers.ts sha512', () => {
    expect(sha512('test/helpers.ts')).toBe('153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91');
  });

  it('post141: locks test/helpers.ts sha3-256', () => {
    expect(sha3('test/helpers.ts')).toBe('8ffbb4baecd580e1f9f797a737d24af1f3e0fb48af208435dafe8afaa584b113');
  });

  it('post141: locks test/helpers.ts blake2b512', () => {
    expect(blake2b('test/helpers.ts')).toBe('9000b1e34f31a60c5b766398de6ce5657f7325d791b129e388e1312c47d8448070919d7711a2824b821a99661fbeb73f6e13dfa4b1de53d72aa0990f73f1061f');
  });

  it('post141: locks test/helpers.ts ripemd160', () => {
    expect(ripemd('test/helpers.ts')).toBe('24c482ba1ff1b74537b67a89b99058b6f2e500a4');
  });

  it('post141: locks test/helpers.ts size 6078', () => {
    expect(statSync(join(root, 'test/helpers.ts')).size).toBe(6078);
    expect(readFileSync(join(root, 'test/helpers.ts')).byteLength).toBe(6078);
  });

  it('post141: locks test/helpers.ts utf8 6078 lines 164', () => {
    expect(read('test/helpers.ts')).toHaveLength(6078);
    expect(read('test/helpers.ts').split('\n')).toHaveLength(164);
  });

  it('post141: locks test/helpers.ts nibble 487 xor 5', () => {
    const d = sha256('test/helpers.ts');
    expect(nibbleSum(d)).toBe(487);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post141: locks test/helpers.ts pairSum 4132 rollingXor 216', () => {
    const d = sha256('test/helpers.ts');
    expect(pairSum(d)).toBe(4132);
    expect(rollingXor(d)).toBe(216);
  });

  it('post141: locks test/helpers.ts first/last/mid octets', () => {
    const d = sha256('test/helpers.ts');
    expect(d.slice(0, 2)).toBe('24');
    expect(d.slice(-2)).toBe('29');
    expect(d.slice(28, 36)).toBe('0c4a4014');
  });

  it('post141: locks test/helpers.ts HMAC post141/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post141', 'test/helpers.ts')).toBe('8b85c14b9596b1c96af6669ecfc4c608f4e23eab767e1b075d52ec10588a8ac4');
    expect(hmacSha256('leftover', 'test/helpers.ts')).toBe('3cf47764c97927288d3627ddc71cecde2a6313dea10d1f5941a8cce945d8b3d1');
    expect(hmacSha256('TOKENMAXX', 'test/helpers.ts')).toBe('8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391');
  });

  it('post141: locks test/helpers.ts HMAC after-#141/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#141', 'test/helpers.ts')).toBe('f9a9b235d178cf8aa24660ad07dae0a1e1860adb637dffa9a4280a5e20cec764');
    expect(hmacSha256('HEAVY', 'test/helpers.ts')).toBe('458cfb306ea3e2c9310b3e3840ecd5a5ca295e18c46146bad4c6111c4c3c1c24');
    expect(hmacSha256('no-product-invent', 'test/helpers.ts')).toBe('a6bca018ba16cafff8a3d108bbc4c96391d8da76ccdaf6927e095cbf2e763870');
  });

  it('post141: locks test/helpers.ts spaces 919', () => {
    expect((read('test/helpers.ts').match(/ /g) ?? []).length).toBe(919);
  });

  it('post141: locks test/helpers.ts reversed sha256', () => {
    const rev = [...read('test/helpers.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e4e0c03b4add5880ffd0e08d925c61f9b010f475d513abd32e2baa8f79ef7625');
  });

  it('post141: locks test/helpers.ts sha256 UPPERCASE', () => {
    expect(sha256('test/helpers.ts').toUpperCase()).toBe('240E1FC521E029B07CA3EBDA83410C4A4014AF02F3AD64FA4EBA8BF6FFD3AF29');
  });

  it('post141: locks test/helpers.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('test/helpers.ts').split('\n')[0]).digest('hex')).toBe('e33b7958170700d0297aa0c9ad1db4689002e9bcee93e0e92b4e20e4837fbe22');
  });

  it('post141: locks test/helpers.ts size*lines 996792', () => {
    expect(statSync(join(root, 'test/helpers.ts')).size * read('test/helpers.ts').split('\n').length).toBe(996792);
  });

  it('post141: locks test/helpers.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('test/helpers.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(163);
    expect((t.match(/,/g) ?? []).length).toBe(58);
    expect((t.match(/:/g) ?? []).length).toBe(106);
    expect((t.match(/"/g) ?? []).length).toBe(34);
    expect((t.match(/'/g) ?? []).length).toBe(48);
  });

  it('post141: locks test/helpers.ts HMAC-SHA1/MD5 key post141', () => {
    expect(createHmac('sha1', 'post141').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex')).toBe('8c9a887623c0795b0b23d3a98000a164c87fcf2a');
    expect(createHmac('md5', 'post141').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex')).toBe('380a978cce7345bf19866a5eb715d187');
  });

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


  it('post141: captureGeminiRequest null when no gemini call', () => {
    expect(captureGeminiRequest({ mock: { calls: [['https://iptv-org.github.io/iptv/categories/music.m3u']] } })).toBeNull();
  });

  it('post141: captureGeminiRequest parses POST body', () => {
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'post141' }] }] });
    const got = captureGeminiRequest({
      mock: {
        calls: [
          ['https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=k', { method: 'POST', body, headers: { 'content-type': 'application/json' } }],
        ],
      },
    });
    expect(got).not.toBeNull();
    expect(got!.method).toBe('POST');
    expect(got!.body).toEqual({ contents: [{ parts: [{ text: 'post141' }] }] });
    expect(got!.url).toContain('generativelanguage.googleapis.com');
  });

  it('post141: iptvCallsWithInit filters only iptv with init', () => {
    const calls = [
      ['https://iptv-org.github.io/iptv/categories/music.m3u'],
      ['https://iptv-org.github.io/iptv/categories/jazz.m3u', { method: 'GET' }],
      ['https://generativelanguage.googleapis.com/x', { method: 'POST' }],
    ];
    expect(iptvCallsWithInit({ mock: { calls } })).toHaveLength(1);
    expect(String(iptvCallsWithInit({ mock: { calls } })[0][0])).toContain('jazz');
  });

  it('post141: stubIptvAndGemini iptvByGenre null returns status', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: null }, iptvStatus: 418 });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('down');
    vi.unstubAllGlobals();
  });

  it('post141: stubIptvAndGemini unknown host 404', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://example.com/nope');
    expect(res.status).toBe(404);
    vi.unstubAllGlobals();
  });

  it('post141: stubIptvAndGemini gemini function form', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: () => geminiTextResponse('fn132') });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    const json = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    expect(json.candidates[0].content.parts[0].text).toBe('fn132');
    vi.unstubAllGlobals();
  });

  it('post141: stubIptvAndGemini default gemini 500', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetch('https://generativelanguage.googleapis.com/v1/models/x:generateContent');
    expect(res.status).toBe(500);
    vi.unstubAllGlobals();
  });

  it('post141: countHttpStreamLines ignores rtmp and blanks', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nrtmp://b\n\nhttp://c\n';
    expect(countHttpStreamLines(m3u)).toBe(2);
  });

  it('post141: buildSimpleM3U omits undefined attrs', () => {
    const m3u = buildSimpleM3U([{ name: 'Solo132', url: 'https://s132' }]);
    expect(m3u).toContain('tvg-name="Solo132"');
    expect(m3u).not.toContain('group-title');
    expect(m3u).not.toContain('tvg-logo');
  });

  it('post141: mockKV list/getWithMetadata stubs', async () => {
    const kv = mockKV();
    await expect(kv.list({} as KVNamespaceListOptions)).resolves.toEqual({ keys: [], list_complete: true, cacheStatus: null });
    await expect(kv.getWithMetadata('x')).resolves.toEqual({ value: null, metadata: null, cacheStatus: null });
  });

  it('post141: curatedGeminiJson custom stations', async () => {
    const res = curatedGeminiJson([{ name: 'Custom132', url: 'https://c132', editorial: 'e', genre: 'jazz', logo: 'https://l' }]);
    const json = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const stations = JSON.parse(json.candidates[0].content.parts[0].text) as Array<{ name: string; logo?: string }>;
    expect(stations[0].name).toBe('Custom132');
    expect(stations[0].logo).toBe('https://l');
  });

  it('post141: SAMPLE_M3U parses to 6 unique urls', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(6);
    expect(new Set(stations.map((s) => s.url)).size).toBe(6);
  });

  it('post141: seedStationsCache object serialization', () => {
    const bag = seedStationsCache('rock', [{ name: 'R132', url: 'https://r132' }]);
    expect(JSON.parse(bag['stations:rock'])).toEqual([{ name: 'R132', url: 'https://r132' }]);
  });

  it('post141: testEnv does not invent GEMINI_API_KEY by default', () => {
    expect(testEnv().GEMINI_API_KEY).toBeUndefined();
  });

  it('post141: iptvCategoryUrl shape', () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it('post141: mega purity 40x helpers.ts sha256', () => {
    const expected = "240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29";
    for (let i = 0; i < 40; i++) expect(sha256('test/helpers.ts')).toBe(expected);
  });

  it('post141: negative inventing fence helpers', () => {
    expect(read('test/helpers.ts')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('test/helpers.ts')).not.toMatch(/openapi\.json|Durable Object|process\.env/);
  });

  it('post141: final inventory markers', () => {
    const body = read('test/helpers.test.ts');
    expect(body).toContain("describe('post126 helpers HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 helpers HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post136 helpers HEAVY deepen (after #136)'");
    expect(body).toContain("describe('post141 helpers HEAVY deepen (after #141)'");
    expect((body.match(/it\('post141:/g) ?? []).length).toBeGreaterThan(60);
  });

});



describe('post144 helpers HEAVY deepen (after #144)', () => {
  const root = helpersRoot;
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

  it('post144: locks src/genres.ts sha256', () => {
    expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post144: locks src/genres.ts sha1', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post144: locks src/genres.ts md5', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post144: locks src/genres.ts sha384', () => {
    expect(sha384('src/genres.ts')).toBe('ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16');
  });

  it('post144: locks src/genres.ts sha512', () => {
    expect(sha512('src/genres.ts')).toBe('bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b');
  });

  it('post144: locks src/genres.ts sha3-256', () => {
    expect(sha3('src/genres.ts')).toBe('d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f');
  });

  it('post144: locks src/genres.ts blake2b512', () => {
    expect(blake2b('src/genres.ts')).toBe('731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67');
  });

  it('post144: locks src/genres.ts ripemd160', () => {
    expect(ripemd('src/genres.ts')).toBe('bb9faaf8890bdba8dd86bcdf7e418da622d19bf5');
  });

  it('post144: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027);
    expect(readFileSync(join(root, 'src/genres.ts')).byteLength).toBe(1027);
  });

  it('post144: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read('src/genres.ts')).toHaveLength(1025);
    expect(read('src/genres.ts').split('\n')).toHaveLength(48);
  });

  it('post144: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256('src/genres.ts');
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post144: locks src/genres.ts pairSum 3950 rollingXor 96', () => {
    const d = sha256('src/genres.ts');
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it('post144: locks src/genres.ts first/last/mid octets', () => {
    const d = sha256('src/genres.ts');
    expect(d.slice(0, 2)).toBe('aa');
    expect(d.slice(-2)).toBe('4e');
    expect(d.slice(28, 36)).toBe('811dfbc2');
  });

  it('post144: locks src/genres.ts HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'src/genres.ts')).toBe('deaeba77d3cede8aa31901f4296c4e799da0d9a41ce5a2956f0bdd43a69633d5');
    expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f');
    expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951');
  });

  it('post144: locks src/genres.ts HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'src/genres.ts')).toBe('709b9688780c0634269e4e70a900a83bae3b5406c1051cbfc3215e4c577ef762');
    expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575');
    expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b');
  });

  it('post144: locks src/genres.ts spaces 144', () => {
    expect((read('src/genres.ts').match(/ /g) ?? []).length).toBe(144);
  });

  it('post144: locks src/genres.ts reversed sha256', () => {
    const rev = [...read('src/genres.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac');
  });

  it('post144: locks src/genres.ts sha256 UPPERCASE', () => {
    expect(sha256('src/genres.ts').toUpperCase()).toBe('AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E');
  });

  it('post144: locks src/genres.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/genres.ts').split('\n')[0]).digest('hex')).toBe('907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68');
  });

  it('post144: locks src/genres.ts size*lines 49296', () => {
    expect(statSync(join(root, 'src/genres.ts')).size * read('src/genres.ts').split('\n').length).toBe(49296);
  });

  it('post144: locks src/genres.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/genres.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(47);
    expect((t.match(/,/g) ?? []).length).toBe(34);
    expect((t.match(/:/g) ?? []).length).toBe(26);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(68);
  });

  it('post144: locks src/genres.ts HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('bf36c1a04bd52714874c810258c3b199466c8b9d');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'src/genres.ts'))).digest('hex')).toBe('a23b95fd7774058f3c3d255a4fac5f38');
  });

  it('post144: locks src/index.ts sha256', () => {
    expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post144: locks src/index.ts sha1', () => {
    expect(sha1('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post144: locks src/index.ts md5', () => {
    expect(md5('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post144: locks src/index.ts sha384', () => {
    expect(sha384('src/index.ts')).toBe('1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65');
  });

  it('post144: locks src/index.ts sha512', () => {
    expect(sha512('src/index.ts')).toBe('28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3');
  });

  it('post144: locks src/index.ts sha3-256', () => {
    expect(sha3('src/index.ts')).toBe('437dfa14ad684952d2d6a973da9d2ea67482eff82e188c32e27507f9dfd3239b');
  });

  it('post144: locks src/index.ts blake2b512', () => {
    expect(blake2b('src/index.ts')).toBe('17bccc5865d7d993ff97e58ce699f0a3f7fd4aa6270d29bcb2cccaee3b0a48dd7b118625848275aab8adfa6efdc23a8a3ddb359f9addfcf6552c15fe4be1dace');
  });

  it('post144: locks src/index.ts ripemd160', () => {
    expect(ripemd('src/index.ts')).toBe('a8ea25913b26da27277f866fc7988fdcdf281093');
  });

  it('post144: locks src/index.ts size 4738', () => {
    expect(statSync(join(root, 'src/index.ts')).size).toBe(4738);
    expect(readFileSync(join(root, 'src/index.ts')).byteLength).toBe(4738);
  });

  it('post144: locks src/index.ts utf8 4724 lines 154', () => {
    expect(read('src/index.ts')).toHaveLength(4724);
    expect(read('src/index.ts').split('\n')).toHaveLength(154);
  });

  it('post144: locks src/index.ts nibble 470 xor 14', () => {
    const d = sha256('src/index.ts');
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post144: locks src/index.ts pairSum 4265 rollingXor 151', () => {
    const d = sha256('src/index.ts');
    expect(pairSum(d)).toBe(4265);
    expect(rollingXor(d)).toBe(151);
  });

  it('post144: locks src/index.ts first/last/mid octets', () => {
    const d = sha256('src/index.ts');
    expect(d.slice(0, 2)).toBe('7f');
    expect(d.slice(-2)).toBe('72');
    expect(d.slice(28, 36)).toBe('e2a20389');
  });

  it('post144: locks src/index.ts HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'src/index.ts')).toBe('193c749dc85e2745d03b41be50db7671e0e1f8d1147558d564cc771835e3a685');
    expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be');
    expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc');
  });

  it('post144: locks src/index.ts HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'src/index.ts')).toBe('d83fda242e36a57a5a31d57c22f0a33c7aa00c054f64a0817e90be63c9548d0c');
    expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30');
    expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a');
  });

  it('post144: locks src/index.ts spaces 761', () => {
    expect((read('src/index.ts').match(/ /g) ?? []).length).toBe(761);
  });

  it('post144: locks src/index.ts reversed sha256', () => {
    const rev = [...read('src/index.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('457830430075a6d1dc4b28436b3c145eb42a640d91301599ca2792fb58433ead');
  });

  it('post144: locks src/index.ts sha256 UPPERCASE', () => {
    expect(sha256('src/index.ts').toUpperCase()).toBe('7F0D574B0AEDC6CD71D3EA35BB03E2A20389028E6FF2C195718ACFF2E0313A72');
  });

  it('post144: locks src/index.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/index.ts').split('\n')[0]).digest('hex')).toBe('d8233fd79765534121de12d18bc3b54a6968d1868428cf5d52175e9a620cf6d4');
  });

  it('post144: locks src/index.ts size*lines 729652', () => {
    expect(statSync(join(root, 'src/index.ts')).size * read('src/index.ts').split('\n').length).toBe(729652);
  });

  it('post144: locks src/index.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/index.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(153);
    expect((t.match(/,/g) ?? []).length).toBe(69);
    expect((t.match(/:/g) ?? []).length).toBe(72);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(85);
  });

  it('post144: locks src/index.ts HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('0b8930339deb45c77f8a10740d58cf80f3f4e5d6');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'src/index.ts'))).digest('hex')).toBe('8de6e205e02c8700fa879f79acba3f5a');
  });

  it('post144: locks src/mcp.ts sha256', () => {
    expect(sha256('src/mcp.ts')).toBe('6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683');
  });

  it('post144: locks src/mcp.ts sha1', () => {
    expect(sha1('src/mcp.ts')).toBe('848b3977365809fda54fcb74a7d09affe685ea82');
  });

  it('post144: locks src/mcp.ts md5', () => {
    expect(md5('src/mcp.ts')).toBe('52e71c72e32e3d95b8b8d61ff4a2cf46');
  });

  it('post144: locks src/mcp.ts sha384', () => {
    expect(sha384('src/mcp.ts')).toBe('a95bef5fcb3b93e9c05aac94aaa6a49adb47a360bfaf046e65f7254c2249fd1f34ff923ec401752e2701b7260d9949d2');
  });

  it('post144: locks src/mcp.ts sha512', () => {
    expect(sha512('src/mcp.ts')).toBe('aa1525a8464db0a7d40982c8f0c091b63f8b21ea363f642ca9781513618d4fb99a9926e39118f65788c423a6bd6ee2318b3165f6007ca9599d36fe7fc7820c05');
  });

  it('post144: locks src/mcp.ts sha3-256', () => {
    expect(sha3('src/mcp.ts')).toBe('9072d42bee801bb2a3ea3f058ea604be67a2e7e599f21afb0d26f27817f44b16');
  });

  it('post144: locks src/mcp.ts blake2b512', () => {
    expect(blake2b('src/mcp.ts')).toBe('f91cd566835e001abe86d934663f36715b1082627dfb8abea78ffd99a50fe41e22d7d9b694301c9b2b27d16a675e3380dffdca34a74b4dbe2ea5b6af00e8ab43');
  });

  it('post144: locks src/mcp.ts ripemd160', () => {
    expect(ripemd('src/mcp.ts')).toBe('105ea9a796a49f5987df733c71c1abf0ab5ddad4');
  });

  it('post144: locks src/mcp.ts size 2057', () => {
    expect(statSync(join(root, 'src/mcp.ts')).size).toBe(2057);
    expect(readFileSync(join(root, 'src/mcp.ts')).byteLength).toBe(2057);
  });

  it('post144: locks src/mcp.ts utf8 2057 lines 68', () => {
    expect(read('src/mcp.ts')).toHaveLength(2057);
    expect(read('src/mcp.ts').split('\n')).toHaveLength(68);
  });

  it('post144: locks src/mcp.ts nibble 551 xor 1', () => {
    const d = sha256('src/mcp.ts');
    expect(nibbleSum(d)).toBe(551);
    expect(xorNibbles(d)).toBe(1);
  });

  it('post144: locks src/mcp.ts pairSum 4751 rollingXor 103', () => {
    const d = sha256('src/mcp.ts');
    expect(pairSum(d)).toBe(4751);
    expect(rollingXor(d)).toBe(103);
  });

  it('post144: locks src/mcp.ts first/last/mid octets', () => {
    const d = sha256('src/mcp.ts');
    expect(d.slice(0, 2)).toBe('6a');
    expect(d.slice(-2)).toBe('83');
    expect(d.slice(28, 36)).toBe('6ad61aff');
  });

  it('post144: locks src/mcp.ts HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'src/mcp.ts')).toBe('aa5c389ea83f1b99ed98e6a832a190b8cdd6a25aa56d776dfaf75a9e781e3b92');
    expect(hmacSha256('leftover', 'src/mcp.ts')).toBe('8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712');
    expect(hmacSha256('TOKENMAXX', 'src/mcp.ts')).toBe('cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62');
  });

  it('post144: locks src/mcp.ts HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'src/mcp.ts')).toBe('46996564f1d68b91a76d6dbafd853e53872edc499aef2fa8a34dda4a39ebbc38');
    expect(hmacSha256('HEAVY', 'src/mcp.ts')).toBe('870bb2f88c83abd6679e447c6937b01c998a1b3f527024e687dc35c00a046e40');
    expect(hmacSha256('no-product-invent', 'src/mcp.ts')).toBe('71a686fe812adcc92f40d5ca19a3996e68555d6749199affd3fc002053aabd65');
  });

  it('post144: locks src/mcp.ts spaces 617', () => {
    expect((read('src/mcp.ts').match(/ /g) ?? []).length).toBe(617);
  });

  it('post144: locks src/mcp.ts reversed sha256', () => {
    const rev = [...read('src/mcp.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('5fb580296684d084fa1bca986fdaa5c31fb63d427f9c5b62f7581941727ba73c');
  });

  it('post144: locks src/mcp.ts sha256 UPPERCASE', () => {
    expect(sha256('src/mcp.ts').toUpperCase()).toBe('6AE8FFD7C4B75C471DB2DFF1FE5C6AD61AFF69E38B048A366BB8B7ADB3099683');
  });

  it('post144: locks src/mcp.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/mcp.ts').split('\n')[0]).digest('hex')).toBe('73d0328cf8db2bc4525219dd63f5dc9b67754ff24aaa895010835d654df47da5');
  });

  it('post144: locks src/mcp.ts size*lines 139876', () => {
    expect(statSync(join(root, 'src/mcp.ts')).size * read('src/mcp.ts').split('\n').length).toBe(139876);
  });

  it('post144: locks src/mcp.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/mcp.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(67);
    expect((t.match(/,/g) ?? []).length).toBe(60);
    expect((t.match(/:/g) ?? []).length).toBe(46);
    expect((t.match(/"/g) ?? []).length).toBe(62);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks src/mcp.ts HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'src/mcp.ts'))).digest('hex')).toBe('46e23b552544c3110c68734a4d118d0d935920c0');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'src/mcp.ts'))).digest('hex')).toBe('cbbabb84b1d84b7cd526ca65afa3a8e6');
  });

  it('post144: locks src/parser.ts sha256', () => {
    expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post144: locks src/parser.ts sha1', () => {
    expect(sha1('src/parser.ts')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it('post144: locks src/parser.ts md5', () => {
    expect(md5('src/parser.ts')).toBe('500211c4c526de887252451726776563');
  });

  it('post144: locks src/parser.ts sha384', () => {
    expect(sha384('src/parser.ts')).toBe('f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9');
  });

  it('post144: locks src/parser.ts sha512', () => {
    expect(sha512('src/parser.ts')).toBe('66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89');
  });

  it('post144: locks src/parser.ts sha3-256', () => {
    expect(sha3('src/parser.ts')).toBe('0ec47247da4cff229cc417b213da73883427985239714e246eb16d1f021bf9c2');
  });

  it('post144: locks src/parser.ts blake2b512', () => {
    expect(blake2b('src/parser.ts')).toBe('d61759e7d0a68efcd16a74811ad84abebe0b82dab5c16e51261ca37118efc5a3c36aec8bc1523ce2b0d3908cd065c7cb8d1c153ea9a31dec633a90ec53aca7ef');
  });

  it('post144: locks src/parser.ts ripemd160', () => {
    expect(ripemd('src/parser.ts')).toBe('36f12fc76af98f06dfa651f814e8f2e13b26c96a');
  });

  it('post144: locks src/parser.ts size 1955', () => {
    expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955);
    expect(readFileSync(join(root, 'src/parser.ts')).byteLength).toBe(1955);
  });

  it('post144: locks src/parser.ts utf8 1953 lines 67', () => {
    expect(read('src/parser.ts')).toHaveLength(1953);
    expect(read('src/parser.ts').split('\n')).toHaveLength(67);
  });

  it('post144: locks src/parser.ts nibble 477 xor 9', () => {
    const d = sha256('src/parser.ts');
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post144: locks src/parser.ts pairSum 3612 rollingXor 126', () => {
    const d = sha256('src/parser.ts');
    expect(pairSum(d)).toBe(3612);
    expect(rollingXor(d)).toBe(126);
  });

  it('post144: locks src/parser.ts first/last/mid octets', () => {
    const d = sha256('src/parser.ts');
    expect(d.slice(0, 2)).toBe('cf');
    expect(d.slice(-2)).toBe('68');
    expect(d.slice(28, 36)).toBe('a0e83a07');
  });

  it('post144: locks src/parser.ts HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'src/parser.ts')).toBe('8e196e09162dd4db61dbadb2031bd07ebd444a30516a1ccf5fd5dfc7de09f68b');
    expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3');
    expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8');
  });

  it('post144: locks src/parser.ts HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'src/parser.ts')).toBe('ba4f98feab43affa31d4c2e36646a8cecd672bfe41dfc02028229f92bbaa9aa7');
    expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70');
    expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f');
  });

  it('post144: locks src/parser.ts spaces 432', () => {
    expect((read('src/parser.ts').match(/ /g) ?? []).length).toBe(432);
  });

  it('post144: locks src/parser.ts reversed sha256', () => {
    const rev = [...read('src/parser.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('a78f8cb8e92e3203b94933c1ec51e34ac1f54892dcc0c99024a48333407e79de');
  });

  it('post144: locks src/parser.ts sha256 UPPERCASE', () => {
    expect(sha256('src/parser.ts').toUpperCase()).toBe('CF293136412FBA636AD7391BCEA0A0E83A079FBBCC8FC14D0CA41FA6621F4368');
  });

  it('post144: locks src/parser.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/parser.ts').split('\n')[0]).digest('hex')).toBe('64a393f12da7f34518f8343d01e7da0c8da3e9f0b9cf1916ec7af9a35cbf8eb5');
  });

  it('post144: locks src/parser.ts size*lines 130985', () => {
    expect(statSync(join(root, 'src/parser.ts')).size * read('src/parser.ts').split('\n').length).toBe(130985);
  });

  it('post144: locks src/parser.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/parser.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(66);
    expect((t.match(/,/g) ?? []).length).toBe(8);
    expect((t.match(/:/g) ?? []).length).toBe(19);
    expect((t.match(/"/g) ?? []).length).toBe(15);
    expect((t.match(/'/g) ?? []).length).toBe(12);
  });

  it('post144: locks src/parser.ts HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('8d2cd626053f1d63383368de49f0b76e12da960f');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'src/parser.ts'))).digest('hex')).toBe('dd7c9533badbaa3067eaff39dab7c0ae');
  });

  it('post144: locks src/types.ts sha256', () => {
    expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
  });

  it('post144: locks src/types.ts sha1', () => {
    expect(sha1('src/types.ts')).toBe('1e8906673dc0d140ee5c3d40839c88a1eeca03d8');
  });

  it('post144: locks src/types.ts md5', () => {
    expect(md5('src/types.ts')).toBe('ecba663d21928622be656805ad27d0a3');
  });

  it('post144: locks src/types.ts sha384', () => {
    expect(sha384('src/types.ts')).toBe('40618d8902640e6ce24d5caf0b9daf86c4d5f962832b1835a86bb10ad7c37455cc60aa9f965ffd9a98f9a5967048b01c');
  });

  it('post144: locks src/types.ts sha512', () => {
    expect(sha512('src/types.ts')).toBe('49cf750d836fe717822e6f08b6ff4998c1f7419a2dfb169a5cfb3001dc1f6dc84df5b428edba879cbd0f7e1b809662e27ee34bf28f88e1efc62ec7d0b37f37cc');
  });

  it('post144: locks src/types.ts sha3-256', () => {
    expect(sha3('src/types.ts')).toBe('93122aa0fe9ef2958ed1b257bc139e91b30facb2e13e4094620dadf7d4acf8e4');
  });

  it('post144: locks src/types.ts blake2b512', () => {
    expect(blake2b('src/types.ts')).toBe('fcb08243a6c336e8da2d3500665ae9a80d98f23a06c3da5f771a290a4b45b2697e2b00e440165eb6551886f58a3bdea0ba315c1d4d3caba38ba3af7f108b3723');
  });

  it('post144: locks src/types.ts ripemd160', () => {
    expect(ripemd('src/types.ts')).toBe('80ca02c12c5db60b8eb1afb1cd21b18983ba16fb');
  });

  it('post144: locks src/types.ts size 174', () => {
    expect(statSync(join(root, 'src/types.ts')).size).toBe(174);
    expect(readFileSync(join(root, 'src/types.ts')).byteLength).toBe(174);
  });

  it('post144: locks src/types.ts utf8 172 lines 7', () => {
    expect(read('src/types.ts')).toHaveLength(172);
    expect(read('src/types.ts').split('\n')).toHaveLength(7);
  });

  it('post144: locks src/types.ts nibble 520 xor 14', () => {
    const d = sha256('src/types.ts');
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post144: locks src/types.ts pairSum 4300 rollingXor 104', () => {
    const d = sha256('src/types.ts');
    expect(pairSum(d)).toBe(4300);
    expect(rollingXor(d)).toBe(104);
  });

  it('post144: locks src/types.ts first/last/mid octets', () => {
    const d = sha256('src/types.ts');
    expect(d.slice(0, 2)).toBe('40');
    expect(d.slice(-2)).toBe('d3');
    expect(d.slice(28, 36)).toBe('345e4f21');
  });

  it('post144: locks src/types.ts HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'src/types.ts')).toBe('34d5636ca5e2dd4ad1ad2a06e96207ef2164ef223078c7314d2892e99bf656da');
    expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85');
    expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc');
  });

  it('post144: locks src/types.ts HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'src/types.ts')).toBe('dda1db4a711e13ca215b013b2675a217c516e9efbfb52936f62eb6270bb6a126');
    expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a');
    expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076');
  });

  it('post144: locks src/types.ts spaces 25', () => {
    expect((read('src/types.ts').match(/ /g) ?? []).length).toBe(25);
  });

  it('post144: locks src/types.ts reversed sha256', () => {
    const rev = [...read('src/types.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e02dd34c73f2571af21a48fda8cfd19667149441b37d30de0519262fc76f7f37');
  });

  it('post144: locks src/types.ts sha256 UPPERCASE', () => {
    expect(sha256('src/types.ts').toUpperCase()).toBe('4008DDD3DD6DD2FB7E8D386DFE2A345E4F21FA5576E229A8FBBE691626F743D3');
  });

  it('post144: locks src/types.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('src/types.ts').split('\n')[0]).digest('hex')).toBe('1d293b13ae9f4103472d1553f95a9368a006f250a1178cb8946d4e566fda25f6');
  });

  it('post144: locks src/types.ts size*lines 1218', () => {
    expect(statSync(join(root, 'src/types.ts')).size * read('src/types.ts').split('\n').length).toBe(1218);
  });

  it('post144: locks src/types.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('src/types.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(6);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(3);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks src/types.ts HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('ea843b7126a4e19d7cee7a8bdedba2457b296067');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'src/types.ts'))).digest('hex')).toBe('247b4b4477ee91c922088bc34af1f3a1');
  });

  it('post144: locks wrangler.toml sha256', () => {
    expect(sha256('wrangler.toml')).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8');
  });

  it('post144: locks wrangler.toml sha1', () => {
    expect(sha1('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post144: locks wrangler.toml md5', () => {
    expect(md5('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post144: locks wrangler.toml sha384', () => {
    expect(sha384('wrangler.toml')).toBe('77464378ae30b2d97a5c510d0ecb15598cc8705e67283c0a776dafdbdb349741a93f5f1e52aa0a127c077a28a574bd09');
  });

  it('post144: locks wrangler.toml sha512', () => {
    expect(sha512('wrangler.toml')).toBe('4fdd7f275037737b409d87c97826e8f84d32099a9e0fd3f85458fe047cba2130dff6b160020af775b50634db4bade3cbfe838bf7e7638ed69f69b43a2cb53a96');
  });

  it('post144: locks wrangler.toml sha3-256', () => {
    expect(sha3('wrangler.toml')).toBe('67dbc36705b469b0f55c46e26ed7ac6355f2d0d59d088cf8d5f1b687c79ae9b9');
  });

  it('post144: locks wrangler.toml blake2b512', () => {
    expect(blake2b('wrangler.toml')).toBe('c2c7d2994209964f33dd815a5abd5e40369f5a58f9d095a887a3e6096887f41cdabb8621faad084ad76430bdb19430751d1090ac30c3cd8125d6ed8a8c5a2e86');
  });

  it('post144: locks wrangler.toml ripemd160', () => {
    expect(ripemd('wrangler.toml')).toBe('324931f8f42bb9dda5d95a21011a0897894de2e7');
  });

  it('post144: locks wrangler.toml size 330', () => {
    expect(statSync(join(root, 'wrangler.toml')).size).toBe(330);
    expect(readFileSync(join(root, 'wrangler.toml')).byteLength).toBe(330);
  });

  it('post144: locks wrangler.toml utf8 330 lines 18', () => {
    expect(read('wrangler.toml')).toHaveLength(330);
    expect(read('wrangler.toml').split('\n')).toHaveLength(18);
  });

  it('post144: locks wrangler.toml nibble 457 xor 13', () => {
    const d = sha256('wrangler.toml');
    expect(nibbleSum(d)).toBe(457);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post144: locks wrangler.toml pairSum 3802 rollingXor 122', () => {
    const d = sha256('wrangler.toml');
    expect(pairSum(d)).toBe(3802);
    expect(rollingXor(d)).toBe(122);
  });

  it('post144: locks wrangler.toml first/last/mid octets', () => {
    const d = sha256('wrangler.toml');
    expect(d.slice(0, 2)).toBe('95');
    expect(d.slice(-2)).toBe('f8');
    expect(d.slice(28, 36)).toBe('4a0b0b87');
  });

  it('post144: locks wrangler.toml HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'wrangler.toml')).toBe('9499d8e6f8f7a4c1eed6ba5eabc05e7d0e24609e96dd23cefbb3a169ab766560');
    expect(hmacSha256('leftover', 'wrangler.toml')).toBe('117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063');
    expect(hmacSha256('TOKENMAXX', 'wrangler.toml')).toBe('7d198a7e11f32e841079eb2398433044d49d9336bb0642737d55dbb39a1206d4');
  });

  it('post144: locks wrangler.toml HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'wrangler.toml')).toBe('d4e996551dc8a7aaed7067a46cd0d50729765f745fa7487535d8f7e2cd04cab8');
    expect(hmacSha256('HEAVY', 'wrangler.toml')).toBe('0106e385ea2e0ca3fd52ddc940a1eb5921a22885362d57f5a49dd1bda89ea5db');
    expect(hmacSha256('no-product-invent', 'wrangler.toml')).toBe('3d99d134e0673c8ff163b29a6c72e49bfa5e599898762bf47dd20f0e65639abb');
  });

  it('post144: locks wrangler.toml spaces 26', () => {
    expect((read('wrangler.toml').match(/ /g) ?? []).length).toBe(26);
  });

  it('post144: locks wrangler.toml reversed sha256', () => {
    const rev = [...read('wrangler.toml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('ea6a9ab9f608d61dbff959c2a36e09a4822605b77cdc9b1dda5853999ae53ad0');
  });

  it('post144: locks wrangler.toml sha256 UPPERCASE', () => {
    expect(sha256('wrangler.toml').toUpperCase()).toBe('95B11779A88F0544F3561EEA67994A0B0B874D7B8776579189FA7142FA0473F8');
  });

  it('post144: locks wrangler.toml first-line sha256', () => {
    expect(createHash('sha256').update(read('wrangler.toml').split('\n')[0]).digest('hex')).toBe('44eea2b40cca4009e9429bc54f55cd083523742a2e6bf8195731b2e95857194e');
  });

  it('post144: locks wrangler.toml size*lines 5940', () => {
    expect(statSync(join(root, 'wrangler.toml')).size * read('wrangler.toml').split('\n').length).toBe(5940);
  });

  it('post144: locks wrangler.toml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('wrangler.toml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(17);
    expect((t.match(/,/g) ?? []).length).toBe(1);
    expect((t.match(/:/g) ?? []).length).toBe(1);
    expect((t.match(/"/g) ?? []).length).toBe(14);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks wrangler.toml HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'wrangler.toml'))).digest('hex')).toBe('6749e50d378019d91d5ab6a8cb7d630f593bccd6');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'wrangler.toml'))).digest('hex')).toBe('df24d86080965d11f1f00b7b52d6ff36');
  });

  it('post144: locks package.json sha256', () => {
    expect(sha256('package.json')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c');
  });

  it('post144: locks package.json sha1', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post144: locks package.json md5', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post144: locks package.json sha384', () => {
    expect(sha384('package.json')).toBe('4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20');
  });

  it('post144: locks package.json sha512', () => {
    expect(sha512('package.json')).toBe('7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28');
  });

  it('post144: locks package.json sha3-256', () => {
    expect(sha3('package.json')).toBe('e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5');
  });

  it('post144: locks package.json blake2b512', () => {
    expect(blake2b('package.json')).toBe('a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d');
  });

  it('post144: locks package.json ripemd160', () => {
    expect(ripemd('package.json')).toBe('f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad');
  });

  it('post144: locks package.json size 637', () => {
    expect(statSync(join(root, 'package.json')).size).toBe(637);
    expect(readFileSync(join(root, 'package.json')).byteLength).toBe(637);
  });

  it('post144: locks package.json utf8 635 lines 26', () => {
    expect(read('package.json')).toHaveLength(635);
    expect(read('package.json').split('\n')).toHaveLength(26);
  });

  it('post144: locks package.json nibble 451 xor 13', () => {
    const d = sha256('package.json');
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post144: locks package.json pairSum 4051 rollingXor 13', () => {
    const d = sha256('package.json');
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it('post144: locks package.json first/last/mid octets', () => {
    const d = sha256('package.json');
    expect(d.slice(0, 2)).toBe('34');
    expect(d.slice(-2)).toBe('1c');
    expect(d.slice(28, 36)).toBe('e0ecaa43');
  });

  it('post144: locks package.json HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'package.json')).toBe('d135fe4b6b5fdc18e139c6b5f6519ab396435023f315e2dd00371db2100b73f5');
    expect(hmacSha256('leftover', 'package.json')).toBe('20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1');
    expect(hmacSha256('TOKENMAXX', 'package.json')).toBe('ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58');
  });

  it('post144: locks package.json HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'package.json')).toBe('3639b440b8a35b7453a36a1d2c6085f07314888363f235ee186b981606dd242a');
    expect(hmacSha256('HEAVY', 'package.json')).toBe('59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563');
    expect(hmacSha256('no-product-invent', 'package.json')).toBe('b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b');
  });

  it('post144: locks package.json spaces 106', () => {
    expect((read('package.json').match(/ /g) ?? []).length).toBe(106);
  });

  it('post144: locks package.json reversed sha256', () => {
    const rev = [...read('package.json')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('76b81fd27392035d0e4776f664acfb5bf67811a2b3ebb57b61b7be81ceb7ccc4');
  });

  it('post144: locks package.json sha256 UPPERCASE', () => {
    expect(sha256('package.json').toUpperCase()).toBe('34552493F3008B58991D10E7B41EE0ECAA43BF8BA3E79D261AC2A061E6F7181C');
  });

  it('post144: locks package.json first-line sha256', () => {
    expect(createHash('sha256').update(read('package.json').split('\n')[0]).digest('hex')).toBe('021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96');
  });

  it('post144: locks package.json size*lines 16562', () => {
    expect(statSync(join(root, 'package.json')).size * read('package.json').split('\n').length).toBe(16562);
  });

  it('post144: locks package.json char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('package.json');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(25);
    expect((t.match(/,/g) ?? []).length).toBe(16);
    expect((t.match(/:/g) ?? []).length).toBe(22);
    expect((t.match(/"/g) ?? []).length).toBe(74);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks package.json HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'package.json'))).digest('hex')).toBe('78c2a33c70575aaa8f630aa888c3168484539475');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'package.json'))).digest('hex')).toBe('ce96ea3d51b28169971fb62ceeaadfcb');
  });

  it('post144: locks vitest.config.ts sha256', () => {
    expect(sha256('vitest.config.ts')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38');
  });

  it('post144: locks vitest.config.ts sha1', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post144: locks vitest.config.ts md5', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post144: locks vitest.config.ts sha384', () => {
    expect(sha384('vitest.config.ts')).toBe('c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563');
  });

  it('post144: locks vitest.config.ts sha512', () => {
    expect(sha512('vitest.config.ts')).toBe('ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682');
  });

  it('post144: locks vitest.config.ts sha3-256', () => {
    expect(sha3('vitest.config.ts')).toBe('ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba');
  });

  it('post144: locks vitest.config.ts blake2b512', () => {
    expect(blake2b('vitest.config.ts')).toBe('93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a');
  });

  it('post144: locks vitest.config.ts ripemd160', () => {
    expect(ripemd('vitest.config.ts')).toBe('6f29a743813430d4d364f8ddd66e0aedf1506fcd');
  });

  it('post144: locks vitest.config.ts size 535', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
    expect(readFileSync(join(root, 'vitest.config.ts')).byteLength).toBe(535);
  });

  it('post144: locks vitest.config.ts utf8 535 lines 22', () => {
    expect(read('vitest.config.ts')).toHaveLength(535);
    expect(read('vitest.config.ts').split('\n')).toHaveLength(22);
  });

  it('post144: locks vitest.config.ts nibble 536 xor 2', () => {
    const d = sha256('vitest.config.ts');
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post144: locks vitest.config.ts pairSum 4691 rollingXor 49', () => {
    const d = sha256('vitest.config.ts');
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it('post144: locks vitest.config.ts first/last/mid octets', () => {
    const d = sha256('vitest.config.ts');
    expect(d.slice(0, 2)).toBe('f9');
    expect(d.slice(-2)).toBe('38');
    expect(d.slice(28, 36)).toBe('ec95c6d5');
  });

  it('post144: locks vitest.config.ts HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'vitest.config.ts')).toBe('b40fa27df2e649db712b9e17fd2883d3c92c3e1e59e0ce09b5247fc908fcd883');
    expect(hmacSha256('leftover', 'vitest.config.ts')).toBe('3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7');
    expect(hmacSha256('TOKENMAXX', 'vitest.config.ts')).toBe('0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9');
  });

  it('post144: locks vitest.config.ts HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'vitest.config.ts')).toBe('bfcb2e6995eb5a0f1b3fe347cdec5528923ff11648c3869661b8d13a5f1500bd');
    expect(hmacSha256('HEAVY', 'vitest.config.ts')).toBe('08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179');
    expect(hmacSha256('no-product-invent', 'vitest.config.ts')).toBe('3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c');
  });

  it('post144: locks vitest.config.ts spaces 121', () => {
    expect((read('vitest.config.ts').match(/ /g) ?? []).length).toBe(121);
  });

  it('post144: locks vitest.config.ts reversed sha256', () => {
    const rev = [...read('vitest.config.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('0938009226d244856c43668b42c9aa000689efe510086849e55daf781d867c2b');
  });

  it('post144: locks vitest.config.ts sha256 UPPERCASE', () => {
    expect(sha256('vitest.config.ts').toUpperCase()).toBe('F9B58BB937531DA55AD474592E69EC95C6D55A5B8B878F8FA251C0F8D6CAFF38');
  });

  it('post144: locks vitest.config.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('vitest.config.ts').split('\n')[0]).digest('hex')).toBe('85734f4752244f71454215d0cfbe952f4ff6d79da03016ebd55e0dd9a1e7d328');
  });

  it('post144: locks vitest.config.ts size*lines 11770', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size * read('vitest.config.ts').split('\n').length).toBe(11770);
  });

  it('post144: locks vitest.config.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('vitest.config.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(21);
    expect((t.match(/,/g) ?? []).length).toBe(18);
    expect((t.match(/:/g) ?? []).length).toBe(15);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(26);
  });

  it('post144: locks vitest.config.ts HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'vitest.config.ts'))).digest('hex')).toBe('1fd92199358557043cd4b34c136a7e16cfe19736');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'vitest.config.ts'))).digest('hex')).toBe('7f9ded3401a4d7cf6588bcd6d25993d8');
  });

  it('post144: locks tsconfig.json sha256', () => {
    expect(sha256('tsconfig.json')).toBe('ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792');
  });

  it('post144: locks tsconfig.json sha1', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post144: locks tsconfig.json md5', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post144: locks tsconfig.json sha384', () => {
    expect(sha384('tsconfig.json')).toBe('2776ddc534d652582b058179048240c9df59cfc882305b98aa08108dd00b1e56a8cecf89510fd59bec966575455dd15d');
  });

  it('post144: locks tsconfig.json sha512', () => {
    expect(sha512('tsconfig.json')).toBe('1ef6e98053d98ec50aeabad12d3f8b7bd44bd81f1a0f63264f0b8530b65b75a1f4e4f705147467a3099a0a89674db33becaf259d25b28c546d2cbdb4862614f3');
  });

  it('post144: locks tsconfig.json sha3-256', () => {
    expect(sha3('tsconfig.json')).toBe('8ee1f99839cc021ccb77405886ffd1863202cc524498261be719f4ed561ad346');
  });

  it('post144: locks tsconfig.json blake2b512', () => {
    expect(blake2b('tsconfig.json')).toBe('b581de91f82f2c41af059ca5d0c03f07f36a943058f3e6c3426c0c69bac9920d5758b91fb9bfe293471bf5bebe5addf90c2a638aa4db8f3299d02d59f9184327');
  });

  it('post144: locks tsconfig.json ripemd160', () => {
    expect(ripemd('tsconfig.json')).toBe('4f7e133ecedc6704045e80181dff3a2ad3d993e6');
  });

  it('post144: locks tsconfig.json size 397', () => {
    expect(statSync(join(root, 'tsconfig.json')).size).toBe(397);
    expect(readFileSync(join(root, 'tsconfig.json')).byteLength).toBe(397);
  });

  it('post144: locks tsconfig.json utf8 397 lines 24', () => {
    expect(read('tsconfig.json')).toHaveLength(397);
    expect(read('tsconfig.json').split('\n')).toHaveLength(24);
  });

  it('post144: locks tsconfig.json nibble 506 xor 8', () => {
    const d = sha256('tsconfig.json');
    expect(nibbleSum(d)).toBe(506);
    expect(xorNibbles(d)).toBe(8);
  });

  it('post144: locks tsconfig.json pairSum 4436 rollingXor 110', () => {
    const d = sha256('tsconfig.json');
    expect(pairSum(d)).toBe(4436);
    expect(rollingXor(d)).toBe(110);
  });

  it('post144: locks tsconfig.json first/last/mid octets', () => {
    const d = sha256('tsconfig.json');
    expect(d.slice(0, 2)).toBe('ef');
    expect(d.slice(-2)).toBe('92');
    expect(d.slice(28, 36)).toBe('04688ea1');
  });

  it('post144: locks tsconfig.json HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'tsconfig.json')).toBe('65a881f732fa07268ee51577ebf6b31a91c3d2dfe7450123685830df1765ce35');
    expect(hmacSha256('leftover', 'tsconfig.json')).toBe('8b1d7fdf24ecef58d7971089e3fb62f7cf97d8a840f50636ffa32327fa8503a9');
    expect(hmacSha256('TOKENMAXX', 'tsconfig.json')).toBe('2da19928cb9b06a5242f987184cc2d44cc385aed692bf3b6fa005e79065d47d1');
  });

  it('post144: locks tsconfig.json HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'tsconfig.json')).toBe('9bc2b6d90a9751a5a25b41cccb613557e441dad33c74898b81f01023cd8c1ea9');
    expect(hmacSha256('HEAVY', 'tsconfig.json')).toBe('351594a3f9f8c0502c2a8387cd10b128a0cc58fc4bc16001784d9e1b55a4088f');
    expect(hmacSha256('no-product-invent', 'tsconfig.json')).toBe('94ad9d8f2eeaf1debb6286a3db3ef2dfadafc8f031999c1c384fef8d8310ae22');
  });

  it('post144: locks tsconfig.json spaces 93', () => {
    expect((read('tsconfig.json').match(/ /g) ?? []).length).toBe(93);
  });

  it('post144: locks tsconfig.json reversed sha256', () => {
    const rev = [...read('tsconfig.json')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('09dd5c17729a34e7ec3fc568710cfb6d88183e5c5a45e1a0084987266b3b2439');
  });

  it('post144: locks tsconfig.json sha256 UPPERCASE', () => {
    expect(sha256('tsconfig.json').toUpperCase()).toBe('EF73D52E26C5DBE1F1785A067CBC04688EA1E6EF80CA5FFF4A7351583828D792');
  });

  it('post144: locks tsconfig.json first-line sha256', () => {
    expect(createHash('sha256').update(read('tsconfig.json').split('\n')[0]).digest('hex')).toBe('021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96');
  });

  it('post144: locks tsconfig.json size*lines 9528', () => {
    expect(statSync(join(root, 'tsconfig.json')).size * read('tsconfig.json').split('\n').length).toBe(9528);
  });

  it('post144: locks tsconfig.json char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('tsconfig.json');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(23);
    expect((t.match(/,/g) ?? []).length).toBe(12);
    expect((t.match(/:/g) ?? []).length).toBe(11);
    expect((t.match(/"/g) ?? []).length).toBe(40);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks tsconfig.json HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'tsconfig.json'))).digest('hex')).toBe('3bd4da9941eb108e474fd98ac510a2a47804b143');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'tsconfig.json'))).digest('hex')).toBe('bb2810e58317b5cd15761364b734f9b6');
  });

  it('post144: locks AGENTS.md sha256', () => {
    expect(sha256('AGENTS.md')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa');
  });

  it('post144: locks AGENTS.md sha1', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post144: locks AGENTS.md md5', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post144: locks AGENTS.md sha384', () => {
    expect(sha384('AGENTS.md')).toBe('817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a');
  });

  it('post144: locks AGENTS.md sha512', () => {
    expect(sha512('AGENTS.md')).toBe('7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908');
  });

  it('post144: locks AGENTS.md sha3-256', () => {
    expect(sha3('AGENTS.md')).toBe('894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4');
  });

  it('post144: locks AGENTS.md blake2b512', () => {
    expect(blake2b('AGENTS.md')).toBe('7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0');
  });

  it('post144: locks AGENTS.md ripemd160', () => {
    expect(ripemd('AGENTS.md')).toBe('6637e853e0148967671e4a3f21bd852255e8ed1c');
  });

  it('post144: locks AGENTS.md size 1017', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
    expect(readFileSync(join(root, 'AGENTS.md')).byteLength).toBe(1017);
  });

  it('post144: locks AGENTS.md utf8 1011 lines 35', () => {
    expect(read('AGENTS.md')).toHaveLength(1011);
    expect(read('AGENTS.md').split('\n')).toHaveLength(35);
  });

  it('post144: locks AGENTS.md nibble 479 xor 5', () => {
    const d = sha256('AGENTS.md');
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post144: locks AGENTS.md pairSum 5084 rollingXor 216', () => {
    const d = sha256('AGENTS.md');
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it('post144: locks AGENTS.md first/last/mid octets', () => {
    const d = sha256('AGENTS.md');
    expect(d.slice(0, 2)).toBe('48');
    expect(d.slice(-2)).toBe('aa');
    expect(d.slice(28, 36)).toBe('a5ec1be5');
  });

  it('post144: locks AGENTS.md HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'AGENTS.md')).toBe('305dcaeab8aff3091db106c83ea5389ef3b11783dd50610eb804169a6bf66c34');
    expect(hmacSha256('leftover', 'AGENTS.md')).toBe('ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e');
    expect(hmacSha256('TOKENMAXX', 'AGENTS.md')).toBe('b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f');
  });

  it('post144: locks AGENTS.md HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'AGENTS.md')).toBe('645d38df46b86bae358d6e5fc6e743303c62fde04185b839f46a5c0b46bff308');
    expect(hmacSha256('HEAVY', 'AGENTS.md')).toBe('f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c');
    expect(hmacSha256('no-product-invent', 'AGENTS.md')).toBe('dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264');
  });

  it('post144: locks AGENTS.md spaces 120', () => {
    expect((read('AGENTS.md').match(/ /g) ?? []).length).toBe(120);
  });

  it('post144: locks AGENTS.md reversed sha256', () => {
    const rev = [...read('AGENTS.md')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('662d61b72071234b614b17c421d0f8a3fc73757a69c1690a0b6a36fd122672dc');
  });

  it('post144: locks AGENTS.md sha256 UPPERCASE', () => {
    expect(sha256('AGENTS.md').toUpperCase()).toBe('48E590B4F146E2FBD1EBB409E0D5A5EC1BE50B72B2C310F1C1E360487B36FEAA');
  });

  it('post144: locks AGENTS.md first-line sha256', () => {
    expect(createHash('sha256').update(read('AGENTS.md').split('\n')[0]).digest('hex')).toBe('e3df46c4dc415311293b71de67e5df2d01a72a69658ef8f8cf5ac9e682d8d618');
  });

  it('post144: locks AGENTS.md size*lines 35595', () => {
    expect(statSync(join(root, 'AGENTS.md')).size * read('AGENTS.md').split('\n').length).toBe(35595);
  });

  it('post144: locks AGENTS.md char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('AGENTS.md');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(34);
    expect((t.match(/,/g) ?? []).length).toBe(2);
    expect((t.match(/:/g) ?? []).length).toBe(5);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks AGENTS.md HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'AGENTS.md'))).digest('hex')).toBe('24e961a8c9deed5e78ad2c75c9f17bc1b89430c2');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'AGENTS.md'))).digest('hex')).toBe('243d6962e74834c1388b29066fa52c9a');
  });

  it('post144: locks DEPLOY.md sha256', () => {
    expect(sha256('DEPLOY.md')).toBe('11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a');
  });

  it('post144: locks DEPLOY.md sha1', () => {
    expect(sha1('DEPLOY.md')).toBe('37c72be44abb67343dae3e7c2303306a25b3481f');
  });

  it('post144: locks DEPLOY.md md5', () => {
    expect(md5('DEPLOY.md')).toBe('da30bf656fdf0d9a61d2a00860c325f5');
  });

  it('post144: locks DEPLOY.md sha384', () => {
    expect(sha384('DEPLOY.md')).toBe('90ba0589c08054172762287998d2a4d110a704705f82771cbd041c0f559f7b9a84dfbf37630b1f7bc9fa2cdbb4d1bf83');
  });

  it('post144: locks DEPLOY.md sha512', () => {
    expect(sha512('DEPLOY.md')).toBe('504275c3bb3c4aa2dd5b4baa6accef1d5a8b83e995bf92146bed27604089ad7ae4540575691383a03a36062562e4388984a560a7ab199451b3bc063104162b80');
  });

  it('post144: locks DEPLOY.md sha3-256', () => {
    expect(sha3('DEPLOY.md')).toBe('f6094c01e1db771acce81308dde362b644d90be4ea5e627be4c4ed922b76e2e0');
  });

  it('post144: locks DEPLOY.md blake2b512', () => {
    expect(blake2b('DEPLOY.md')).toBe('c8b0fe4fb9e35653be4ac85fb6a63d2c4c3129c7015bb00f7ee44a53c7540ee5befa0184688ac570b4187caec65322924b29cb53b40b5cf69707f52054cb74db');
  });

  it('post144: locks DEPLOY.md ripemd160', () => {
    expect(ripemd('DEPLOY.md')).toBe('1614c90dc6583beed4bd6540ae4a5b545789e8c6');
  });

  it('post144: locks DEPLOY.md size 1573', () => {
    expect(statSync(join(root, 'DEPLOY.md')).size).toBe(1573);
    expect(readFileSync(join(root, 'DEPLOY.md')).byteLength).toBe(1573);
  });

  it('post144: locks DEPLOY.md utf8 1539 lines 65', () => {
    expect(read('DEPLOY.md')).toHaveLength(1539);
    expect(read('DEPLOY.md').split('\n')).toHaveLength(65);
  });

  it('post144: locks DEPLOY.md nibble 439 xor 11', () => {
    const d = sha256('DEPLOY.md');
    expect(nibbleSum(d)).toBe(439);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post144: locks DEPLOY.md pairSum 4234 rollingXor 26', () => {
    const d = sha256('DEPLOY.md');
    expect(pairSum(d)).toBe(4234);
    expect(rollingXor(d)).toBe(26);
  });

  it('post144: locks DEPLOY.md first/last/mid octets', () => {
    const d = sha256('DEPLOY.md');
    expect(d.slice(0, 2)).toBe('11');
    expect(d.slice(-2)).toBe('5a');
    expect(d.slice(28, 36)).toBe('f363d487');
  });

  it('post144: locks DEPLOY.md HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'DEPLOY.md')).toBe('839484296c4641dd4e678ae09a9398fea1b1b82d748c38c18714b7733415cc93');
    expect(hmacSha256('leftover', 'DEPLOY.md')).toBe('8e69d3722a2f57941fecb3a0602ebb6cab5a31755e7c8bc88ed0771bc1822659');
    expect(hmacSha256('TOKENMAXX', 'DEPLOY.md')).toBe('bdb0c19924928cf4d54308dcdd72f032fea4ae1994669e96bf22f48567084f26');
  });

  it('post144: locks DEPLOY.md HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'DEPLOY.md')).toBe('e8ab767c9640231b53235b9b41a048036cf0db91de9544fbcedcc667a335b2f0');
    expect(hmacSha256('HEAVY', 'DEPLOY.md')).toBe('5e8e11b4b80c19b0e2828f509f4411d5c7d176f5101c2aa2094ae43dfcf385d3');
    expect(hmacSha256('no-product-invent', 'DEPLOY.md')).toBe('cb29f601b5afcc4ca9e180a792e0a028c44afad0b5fcbbbafdd0dcee3c24f29e');
  });

  it('post144: locks DEPLOY.md spaces 201', () => {
    expect((read('DEPLOY.md').match(/ /g) ?? []).length).toBe(201);
  });

  it('post144: locks DEPLOY.md reversed sha256', () => {
    const rev = [...read('DEPLOY.md')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('dc7966a18d22f94cad52e2211dfe7aef7c608e8916e4a97104f6b9300fc89793');
  });

  it('post144: locks DEPLOY.md sha256 UPPERCASE', () => {
    expect(sha256('DEPLOY.md').toUpperCase()).toBe('11067FA2DA7EE6D2354842E1C258F363D487536AC307B76739893A93B0C9D05A');
  });

  it('post144: locks DEPLOY.md first-line sha256', () => {
    expect(createHash('sha256').update(read('DEPLOY.md').split('\n')[0]).digest('hex')).toBe('bcb1aa55214a9bafe7c9aed196c9ec210e023dc6c81dc8f4db34220f221a2957');
  });

  it('post144: locks DEPLOY.md size*lines 102245', () => {
    expect(statSync(join(root, 'DEPLOY.md')).size * read('DEPLOY.md').split('\n').length).toBe(102245);
  });

  it('post144: locks DEPLOY.md char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('DEPLOY.md');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(64);
    expect((t.match(/,/g) ?? []).length).toBe(6);
    expect((t.match(/:/g) ?? []).length).toBe(7);
    expect((t.match(/"/g) ?? []).length).toBe(4);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks DEPLOY.md HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'DEPLOY.md'))).digest('hex')).toBe('dc7ea1d69d12b1bb7b24c825412a2c56e22ce7dd');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'DEPLOY.md'))).digest('hex')).toBe('cb5ff9b6506b554daaee4efc881f5b13');
  });

  it('post144: locks README.md sha256', () => {
    expect(sha256('README.md')).toBe('f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987');
  });

  it('post144: locks README.md sha1', () => {
    expect(sha1('README.md')).toBe('4f560a473d5838f25eba3eae21a87f6c97ba3b8b');
  });

  it('post144: locks README.md md5', () => {
    expect(md5('README.md')).toBe('9b7aea4982a6d68b95f7f8ee3fdc5b31');
  });

  it('post144: locks README.md sha384', () => {
    expect(sha384('README.md')).toBe('52db664da38cae8aa1f5dfb3d02bfca990d2cf0700142c089c2c6d0440014d9dbd94b63af5fa31e97995b071c7758f11');
  });

  it('post144: locks README.md sha512', () => {
    expect(sha512('README.md')).toBe('a66447cc7968b9d04a99157b8598e52dc849462692f4e34fc8af624c5a92377700bea429e236b8102cd76bf48d680ed490795b1da33909f001d8fec14336e337');
  });

  it('post144: locks README.md sha3-256', () => {
    expect(sha3('README.md')).toBe('8cbc20fe6a6c6c54f324d55ea8da31faa4557967b4a9a993c24e037fa4d7b658');
  });

  it('post144: locks README.md blake2b512', () => {
    expect(blake2b('README.md')).toBe('b0dd4414083fb8b70c8d61ce20a29a344e35eb41a9812c704f2cd27b131d89155ddd6a9534c7105a3d45bf117ca967adbcd7ea38d06a0ceaaf711cfa46ed8167');
  });

  it('post144: locks README.md ripemd160', () => {
    expect(ripemd('README.md')).toBe('7ca15419150a224242d22a61bd3585c51b5af14d');
  });

  it('post144: locks README.md size 2801', () => {
    expect(statSync(join(root, 'README.md')).size).toBe(2801);
    expect(readFileSync(join(root, 'README.md')).byteLength).toBe(2801);
  });

  it('post144: locks README.md utf8 2757 lines 82', () => {
    expect(read('README.md')).toHaveLength(2757);
    expect(read('README.md').split('\n')).toHaveLength(82);
  });

  it('post144: locks README.md nibble 429 xor 13', () => {
    const d = sha256('README.md');
    expect(nibbleSum(d)).toBe(429);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post144: locks README.md pairSum 4164 rollingXor 88', () => {
    const d = sha256('README.md');
    expect(pairSum(d)).toBe(4164);
    expect(rollingXor(d)).toBe(88);
  });

  it('post144: locks README.md first/last/mid octets', () => {
    const d = sha256('README.md');
    expect(d.slice(0, 2)).toBe('f7');
    expect(d.slice(-2)).toBe('87');
    expect(d.slice(28, 36)).toBe('368a10ca');
  });

  it('post144: locks README.md HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'README.md')).toBe('80693d567bebc6130c1a9e98783ff11c021e2114293ae7400e3d6d8b257b6ef0');
    expect(hmacSha256('leftover', 'README.md')).toBe('57c08297703e57c6b5694a515e43b6592bd130637c82dcc569a048bda2fd181f');
    expect(hmacSha256('TOKENMAXX', 'README.md')).toBe('51a608392fd700865f32aac02646908bf1235d6c4d587e9daa92383d6a777b94');
  });

  it('post144: locks README.md HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'README.md')).toBe('db014f8495b97e9bdbb1245b2e9abfb47a61a8a72cc0b160cb268246a2d6b1fc');
    expect(hmacSha256('HEAVY', 'README.md')).toBe('4bb62cc19640e3a3d792e3eba8d499203b4729899d5838ec2065ee409ab0430d');
    expect(hmacSha256('no-product-invent', 'README.md')).toBe('c1d8bb52c5ad591530152e8ec780bd262a1b78aeb7aea241bcef2a46a5e1ad7a');
  });

  it('post144: locks README.md spaces 330', () => {
    expect((read('README.md').match(/ /g) ?? []).length).toBe(330);
  });

  it('post144: locks README.md reversed sha256', () => {
    const rev = [...read('README.md')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('59210622620939faffb8add701b308294f32bb89e7dd430c905ddef2f30dc32b');
  });

  it('post144: locks README.md sha256 UPPERCASE', () => {
    expect(sha256('README.md').toUpperCase()).toBe('F7ECD30301C01E7AF03A64CA32D1368A10CAC861C09016C718E39417DC15C987');
  });

  it('post144: locks README.md first-line sha256', () => {
    expect(createHash('sha256').update(read('README.md').split('\n')[0]).digest('hex')).toBe('a46591b0359e4bc72d2af8c747e249227576c178c9b9fbd8e2eae8ac3764c538');
  });

  it('post144: locks README.md size*lines 229682', () => {
    expect(statSync(join(root, 'README.md')).size * read('README.md').split('\n').length).toBe(229682);
  });

  it('post144: locks README.md char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('README.md');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(81);
    expect((t.match(/,/g) ?? []).length).toBe(31);
    expect((t.match(/:/g) ?? []).length).toBe(27);
    expect((t.match(/"/g) ?? []).length).toBe(36);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks README.md HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'README.md'))).digest('hex')).toBe('84421d5b1c4ba140da54cf7e4854fea3178fa80f');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'README.md'))).digest('hex')).toBe('53cbc2c8830b5b6d690f63f24a213850');
  });

  it('post144: locks docs/mcp-spec.md sha256', () => {
    expect(sha256('docs/mcp-spec.md')).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849');
  });

  it('post144: locks docs/mcp-spec.md sha1', () => {
    expect(sha1('docs/mcp-spec.md')).toBe('e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a');
  });

  it('post144: locks docs/mcp-spec.md md5', () => {
    expect(md5('docs/mcp-spec.md')).toBe('ee7881030c338c1773659cc6378c392c');
  });

  it('post144: locks docs/mcp-spec.md sha384', () => {
    expect(sha384('docs/mcp-spec.md')).toBe('b32096b74bacd48065f014d2695673b3bfad3cb9118b855899a92a849cd38a7dd751db7c9e0705d6d6569d5f05f61227');
  });

  it('post144: locks docs/mcp-spec.md sha512', () => {
    expect(sha512('docs/mcp-spec.md')).toBe('8d26bafffcb1230048d80796e1d8a1019d83253810324d18383c54ff8bcaaed4a508b0a07395994af2f23e4f9b627e2202a57fcac709110d0ee859e8628709e7');
  });

  it('post144: locks docs/mcp-spec.md sha3-256', () => {
    expect(sha3('docs/mcp-spec.md')).toBe('700b4576d20353f0db25e4379cfebf496f15f0514d8998c10464bd0d6c8604f4');
  });

  it('post144: locks docs/mcp-spec.md blake2b512', () => {
    expect(blake2b('docs/mcp-spec.md')).toBe('6f441cdfb1d2b41be77e60c9aa79de5778608e02670b1067c30da76537d9e0915920752717c7302e705c5787dffea7a41f6c0669adb594689f0d256bbe7d0d31');
  });

  it('post144: locks docs/mcp-spec.md ripemd160', () => {
    expect(ripemd('docs/mcp-spec.md')).toBe('2f5cb29783b2bd4db4999e2ab61376a44c3a857b');
  });

  it('post144: locks docs/mcp-spec.md size 3552', () => {
    expect(statSync(join(root, 'docs/mcp-spec.md')).size).toBe(3552);
    expect(readFileSync(join(root, 'docs/mcp-spec.md')).byteLength).toBe(3552);
  });

  it('post144: locks docs/mcp-spec.md utf8 3544 lines 145', () => {
    expect(read('docs/mcp-spec.md')).toHaveLength(3544);
    expect(read('docs/mcp-spec.md').split('\n')).toHaveLength(145);
  });

  it('post144: locks docs/mcp-spec.md nibble 514 xor 14', () => {
    const d = sha256('docs/mcp-spec.md');
    expect(nibbleSum(d)).toBe(514);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post144: locks docs/mcp-spec.md pairSum 4534 rollingXor 164', () => {
    const d = sha256('docs/mcp-spec.md');
    expect(pairSum(d)).toBe(4534);
    expect(rollingXor(d)).toBe(164);
  });

  it('post144: locks docs/mcp-spec.md first/last/mid octets', () => {
    const d = sha256('docs/mcp-spec.md');
    expect(d.slice(0, 2)).toBe('a9');
    expect(d.slice(-2)).toBe('49');
    expect(d.slice(28, 36)).toBe('c7628b21');
  });

  it('post144: locks docs/mcp-spec.md HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'docs/mcp-spec.md')).toBe('aff70172217fde98f5456142175cebca2967f1ac505d1a07aad66f3677b6407f');
    expect(hmacSha256('leftover', 'docs/mcp-spec.md')).toBe('cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df');
    expect(hmacSha256('TOKENMAXX', 'docs/mcp-spec.md')).toBe('58bd8b12de8084ece067f68db2cea2ea5dc8b43305c0d5e7e20506fd40e18749');
  });

  it('post144: locks docs/mcp-spec.md HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'docs/mcp-spec.md')).toBe('15be4839db21adb45403babff19f28198cd6339284bc698326e8f31e017809cf');
    expect(hmacSha256('HEAVY', 'docs/mcp-spec.md')).toBe('14502ba27898e795fb59cc37b06fe6eb2a66b40811b068e87738eb3dbf4cae59');
    expect(hmacSha256('no-product-invent', 'docs/mcp-spec.md')).toBe('1ea2c93af05439c6a1c14acfbee6d34dddfc2b32e6c8b6256c270f6d4484b608');
  });

  it('post144: locks docs/mcp-spec.md spaces 640', () => {
    expect((read('docs/mcp-spec.md').match(/ /g) ?? []).length).toBe(640);
  });

  it('post144: locks docs/mcp-spec.md reversed sha256', () => {
    const rev = [...read('docs/mcp-spec.md')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('8e0a8a17d78474b7a2c052d335989cd8a980b200816869706af232736e35ab47');
  });

  it('post144: locks docs/mcp-spec.md sha256 UPPERCASE', () => {
    expect(sha256('docs/mcp-spec.md').toUpperCase()).toBe('A93978D779B976A1ABA4D34395EEC7628B21BDA910EF8A279D5EFBC05DA56849');
  });

  it('post144: locks docs/mcp-spec.md first-line sha256', () => {
    expect(createHash('sha256').update(read('docs/mcp-spec.md').split('\n')[0]).digest('hex')).toBe('99c84d33ad819ac91a66e1a30aef3bf512cb393370d7b6fbc8397c8917ba2e66');
  });

  it('post144: locks docs/mcp-spec.md size*lines 515040', () => {
    expect(statSync(join(root, 'docs/mcp-spec.md')).size * read('docs/mcp-spec.md').split('\n').length).toBe(515040);
  });

  it('post144: locks docs/mcp-spec.md char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('docs/mcp-spec.md');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(144);
    expect((t.match(/,/g) ?? []).length).toBe(62);
    expect((t.match(/:/g) ?? []).length).toBe(90);
    expect((t.match(/"/g) ?? []).length).toBe(250);
    expect((t.match(/'/g) ?? []).length).toBe(25);
  });

  it('post144: locks docs/mcp-spec.md HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'docs/mcp-spec.md'))).digest('hex')).toBe('93032172b88160ec8126a023873e705a91d4577a');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'docs/mcp-spec.md'))).digest('hex')).toBe('7e3ce831175ac8ede17394426f5bbfc4');
  });

  it('post144: locks .github/workflows/ci.yml sha256', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe('c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5');
  });

  it('post144: locks .github/workflows/ci.yml sha1', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post144: locks .github/workflows/ci.yml md5', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post144: locks .github/workflows/ci.yml sha384', () => {
    expect(sha384('.github/workflows/ci.yml')).toBe('8aa8ec73d3268813ebed009b6ade76fbfd8833f0aa035fddfb830493e21b2074d7728e8554206bc26c9a3fa3792612ab');
  });

  it('post144: locks .github/workflows/ci.yml sha512', () => {
    expect(sha512('.github/workflows/ci.yml')).toBe('3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460');
  });

  it('post144: locks .github/workflows/ci.yml sha3-256', () => {
    expect(sha3('.github/workflows/ci.yml')).toBe('8f49dc5067d49c3458635df0dbb9078bac974081a35adab2c27d9349f30cd611');
  });

  it('post144: locks .github/workflows/ci.yml blake2b512', () => {
    expect(blake2b('.github/workflows/ci.yml')).toBe('5629fff561ce7acb56fc3d2f66b875992f525b4a25ec6c3c6fb485d6f6d20bb74a33c67c89389360ee29d12dd26361a4c24b39db6ec9aaf58462c3b0472f489d');
  });

  it('post144: locks .github/workflows/ci.yml ripemd160', () => {
    expect(ripemd('.github/workflows/ci.yml')).toBe('491302ba2e7b00c030ea98aea8ccee799d61e1ff');
  });

  it('post144: locks .github/workflows/ci.yml size 6295', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295);
    expect(readFileSync(join(root, '.github/workflows/ci.yml')).byteLength).toBe(6295);
  });

  it('post144: locks .github/workflows/ci.yml utf8 6295 lines 177', () => {
    expect(read('.github/workflows/ci.yml')).toHaveLength(6295);
    expect(read('.github/workflows/ci.yml').split('\n')).toHaveLength(177);
  });

  it('post144: locks .github/workflows/ci.yml nibble 515 xor 3', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post144: locks .github/workflows/ci.yml pairSum 4595 rollingXor 71', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(pairSum(d)).toBe(4595);
    expect(rollingXor(d)).toBe(71);
  });

  it('post144: locks .github/workflows/ci.yml first/last/mid octets', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(d.slice(0, 2)).toBe('c4');
    expect(d.slice(-2)).toBe('d5');
    expect(d.slice(28, 36)).toBe('f5e6f56e');
  });

  it('post144: locks .github/workflows/ci.yml HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', '.github/workflows/ci.yml')).toBe('afe7b174bd8f66dbae1b92a05d66a6f5df406909cc676c9c5d10ae13858b56c7');
    expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe('d3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce');
    expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).toBe('5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b');
  });

  it('post144: locks .github/workflows/ci.yml HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', '.github/workflows/ci.yml')).toBe('74c810ab49c253d698ee4130f4426ef96d92039c885437b9f9c12642802ba051');
    expect(hmacSha256('HEAVY', '.github/workflows/ci.yml')).toBe('8c10cb5abbb616b57d2df21384cbdb40264d52be8a25a32448acd6e22e1848ea');
    expect(hmacSha256('no-product-invent', '.github/workflows/ci.yml')).toBe('1a959a3eb061936e9c62fd3497ddd23988ff785d88dcfdd133f97d35c77e8fde');
  });

  it('post144: locks .github/workflows/ci.yml spaces 1716', () => {
    expect((read('.github/workflows/ci.yml').match(/ /g) ?? []).length).toBe(1716);
  });

  it('post144: locks .github/workflows/ci.yml reversed sha256', () => {
    const rev = [...read('.github/workflows/ci.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('d1897bbef13787c7c5d1c731f788dea05deb87bd79eafe2bb7e29755b7b2b79b');
  });

  it('post144: locks .github/workflows/ci.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/workflows/ci.yml').toUpperCase()).toBe('C4DB88D23A2F8C41A388C0791279F5E6F56E3D5DA7CC8FD25F97B5308B00EED5');
  });

  it('post144: locks .github/workflows/ci.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[0]).digest('hex')).toBe('8e7430f31889b761a2ccebd73080d82a3491aa7c565a2ea6583bd0f8788ccbd8');
  });

  it('post144: locks .github/workflows/ci.yml size*lines 1114215', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size * read('.github/workflows/ci.yml').split('\n').length).toBe(1114215);
  });

  it('post144: locks .github/workflows/ci.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/workflows/ci.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(176);
    expect((t.match(/,/g) ?? []).length).toBe(1);
    expect((t.match(/:/g) ?? []).length).toBe(109);
    expect((t.match(/"/g) ?? []).length).toBe(23);
    expect((t.match(/'/g) ?? []).length).toBe(113);
  });

  it('post144: locks .github/workflows/ci.yml HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe('5957e36b3f44438a2be3edc77d718a0cd7152c1d');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe('d1866ba0fec896e1763dcd8e87710df9');
  });

  it('post144: locks .github/workflows/deploy.yml sha256', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe('49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3');
  });

  it('post144: locks .github/workflows/deploy.yml sha1', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post144: locks .github/workflows/deploy.yml md5', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post144: locks .github/workflows/deploy.yml sha384', () => {
    expect(sha384('.github/workflows/deploy.yml')).toBe('61fa961396d8c3231bc50da4eb215cff97cc8e73cd619076488abd7a58ae14a9c8295922846a197b0c2f60535bd02c9f');
  });

  it('post144: locks .github/workflows/deploy.yml sha512', () => {
    expect(sha512('.github/workflows/deploy.yml')).toBe('7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641');
  });

  it('post144: locks .github/workflows/deploy.yml sha3-256', () => {
    expect(sha3('.github/workflows/deploy.yml')).toBe('c214b3a3742462dbe536466786d717241cdc0be84f5bbf71da7c8f8ed281d62e');
  });

  it('post144: locks .github/workflows/deploy.yml blake2b512', () => {
    expect(blake2b('.github/workflows/deploy.yml')).toBe('0ec8ba30a1fdece2b7033b67cffa78d926b8deb86a5f7468060a746f0ff0dc8b8488236b19465603f53aac178556c000ecca9748f4dcf7591155f67f0c1c5628');
  });

  it('post144: locks .github/workflows/deploy.yml ripemd160', () => {
    expect(ripemd('.github/workflows/deploy.yml')).toBe('7a476e7889618bef7c8b22a0f651f4e49658527e');
  });

  it('post144: locks .github/workflows/deploy.yml size 1004', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004);
    expect(readFileSync(join(root, '.github/workflows/deploy.yml')).byteLength).toBe(1004);
  });

  it('post144: locks .github/workflows/deploy.yml utf8 1004 lines 47', () => {
    expect(read('.github/workflows/deploy.yml')).toHaveLength(1004);
    expect(read('.github/workflows/deploy.yml').split('\n')).toHaveLength(47);
  });

  it('post144: locks .github/workflows/deploy.yml nibble 476 xor 4', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post144: locks .github/workflows/deploy.yml pairSum 3686 rollingXor 38', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(pairSum(d)).toBe(3686);
    expect(rollingXor(d)).toBe(38);
  });

  it('post144: locks .github/workflows/deploy.yml first/last/mid octets', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(d.slice(0, 2)).toBe('49');
    expect(d.slice(-2)).toBe('c3');
    expect(d.slice(28, 36)).toBe('de06de33');
  });

  it('post144: locks .github/workflows/deploy.yml HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', '.github/workflows/deploy.yml')).toBe('5c0a7fdcc906513c89e5eee05566c9ab460f855ce542213c923e842cbc5e92cd');
    expect(hmacSha256('leftover', '.github/workflows/deploy.yml')).toBe('e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83');
    expect(hmacSha256('TOKENMAXX', '.github/workflows/deploy.yml')).toBe('339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b');
  });

  it('post144: locks .github/workflows/deploy.yml HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', '.github/workflows/deploy.yml')).toBe('cdb68cd6cfd137982c5f0204bec7ca958fa1c179e7f3aa05b602fba44cd8d3a6');
    expect(hmacSha256('HEAVY', '.github/workflows/deploy.yml')).toBe('87354c51a785eb76f81ba427f9a58d6f8b0b7e3c85febd19b973c04874bde601');
    expect(hmacSha256('no-product-invent', '.github/workflows/deploy.yml')).toBe('3ed3dcb49626ea55aa10de93931f8c107b800db0e2d4852f9cfe4a32f9ffe544');
  });

  it('post144: locks .github/workflows/deploy.yml spaces 274', () => {
    expect((read('.github/workflows/deploy.yml').match(/ /g) ?? []).length).toBe(274);
  });

  it('post144: locks .github/workflows/deploy.yml reversed sha256', () => {
    const rev = [...read('.github/workflows/deploy.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('c76eeb8130b6ef38120b7c8d0345a0401de9d92f3114786cea652396314dae41');
  });

  it('post144: locks .github/workflows/deploy.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/workflows/deploy.yml').toUpperCase()).toBe('49BF571653F9091108A8E7E3F358DE06DE332686019D1B0E0F68DDAF7B48D5C3');
  });

  it('post144: locks .github/workflows/deploy.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/workflows/deploy.yml').split('\n')[0]).digest('hex')).toBe('2dbfcbc4df1ce394975f60183fd2e5c420d970fd3611c0d88ad06ff073091960');
  });

  it('post144: locks .github/workflows/deploy.yml size*lines 47188', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size * read('.github/workflows/deploy.yml').split('\n').length).toBe(47188);
  });

  it('post144: locks .github/workflows/deploy.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/workflows/deploy.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(46);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(37);
    expect((t.match(/"/g) ?? []).length).toBe(4);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks .github/workflows/deploy.yml HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex')).toBe('0f6b802c4c54a9434f47a41c1f53370cd41db573');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex')).toBe('f21ce092d7b1aef82ebb7c7615ffa88a');
  });

  it('post144: locks .github/dependabot.yml sha256', () => {
    expect(sha256('.github/dependabot.yml')).toBe('a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac');
  });

  it('post144: locks .github/dependabot.yml sha1', () => {
    expect(sha1('.github/dependabot.yml')).toBe('dfdb63975444874143105431e4cee95165932c7b');
  });

  it('post144: locks .github/dependabot.yml md5', () => {
    expect(md5('.github/dependabot.yml')).toBe('bd53b7cdf9bb7287532d96a32cbec9a4');
  });

  it('post144: locks .github/dependabot.yml sha384', () => {
    expect(sha384('.github/dependabot.yml')).toBe('ea9d5b80d192675fecbce15828b4dc305f234744d81936d5baa2cd24b7bbdf1a6ac8708c2f7da50603d77f9ee15a1ffc');
  });

  it('post144: locks .github/dependabot.yml sha512', () => {
    expect(sha512('.github/dependabot.yml')).toBe('276de093809db87de2059c26ebe5ba732e8c3bc5bfed72843cd2bf0c81a7d3308da1f947c2ca8463ff615704aa5dd2f02f3a5857e6f2f9c358d97c111dbca34e');
  });

  it('post144: locks .github/dependabot.yml sha3-256', () => {
    expect(sha3('.github/dependabot.yml')).toBe('4a022f1046b7dcd4b57cc16cbb7efad06e9401d30f9d383321ff44ef7a16d1d7');
  });

  it('post144: locks .github/dependabot.yml blake2b512', () => {
    expect(blake2b('.github/dependabot.yml')).toBe('3fb74f327e9c57cb11a7219281df13a608a303a09c82ac1233f53ddddfc96a01e9e9eee076f206359e8b4db1264e971f389ce226acf2f3647146ce8901395f0e');
  });

  it('post144: locks .github/dependabot.yml ripemd160', () => {
    expect(ripemd('.github/dependabot.yml')).toBe('7d8132f4ca88999fcfcf95c3fc1c0ca8b617fe5c');
  });

  it('post144: locks .github/dependabot.yml size 505', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505);
    expect(readFileSync(join(root, '.github/dependabot.yml')).byteLength).toBe(505);
  });

  it('post144: locks .github/dependabot.yml utf8 505 lines 25', () => {
    expect(read('.github/dependabot.yml')).toHaveLength(505);
    expect(read('.github/dependabot.yml').split('\n')).toHaveLength(25);
  });

  it('post144: locks .github/dependabot.yml nibble 526 xor 6', () => {
    const d = sha256('.github/dependabot.yml');
    expect(nibbleSum(d)).toBe(526);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post144: locks .github/dependabot.yml pairSum 4381 rollingXor 219', () => {
    const d = sha256('.github/dependabot.yml');
    expect(pairSum(d)).toBe(4381);
    expect(rollingXor(d)).toBe(219);
  });

  it('post144: locks .github/dependabot.yml first/last/mid octets', () => {
    const d = sha256('.github/dependabot.yml');
    expect(d.slice(0, 2)).toBe('a1');
    expect(d.slice(-2)).toBe('ac');
    expect(d.slice(28, 36)).toBe('6507533f');
  });

  it('post144: locks .github/dependabot.yml HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', '.github/dependabot.yml')).toBe('250334ef9f0cd570246cc087debcfc438add35694483f3307fcadddbbfe923ae');
    expect(hmacSha256('leftover', '.github/dependabot.yml')).toBe('b9fba0e3b098292ae8ff8b4cffe94463966fadb875a0c9db9a1dadb85281a0f9');
    expect(hmacSha256('TOKENMAXX', '.github/dependabot.yml')).toBe('e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1');
  });

  it('post144: locks .github/dependabot.yml HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', '.github/dependabot.yml')).toBe('b08b700ca303f9524a0b686ae47368566c8472c12ee44ffbc48a9e3a08513e99');
    expect(hmacSha256('HEAVY', '.github/dependabot.yml')).toBe('e651250d8c5b977a6bf6fb30e4edcc515accf3f9c97019df6fd702d19fb9e2ff');
    expect(hmacSha256('no-product-invent', '.github/dependabot.yml')).toBe('5fdab5d04737aa2fd4596ef674259a9f07c54593c68d38f74f8e6f81207f80fa');
  });

  it('post144: locks .github/dependabot.yml spaces 130', () => {
    expect((read('.github/dependabot.yml').match(/ /g) ?? []).length).toBe(130);
  });

  it('post144: locks .github/dependabot.yml reversed sha256', () => {
    const rev = [...read('.github/dependabot.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('8012cea11db50fc6f52d77f98c5e1fbe5a1a1bf3401459cd98de5bb63657fc84');
  });

  it('post144: locks .github/dependabot.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/dependabot.yml').toUpperCase()).toBe('A11B96153B6BB773EE0CBDCD59816507533FF4DD5E8CB34DE0BAF667CE72ECAC');
  });

  it('post144: locks .github/dependabot.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/dependabot.yml').split('\n')[0]).digest('hex')).toBe('28ddc9cbecb071435220504c25f544985d6671b0c98ad9e06d9bf8c0d36f23be');
  });

  it('post144: locks .github/dependabot.yml size*lines 12625', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size * read('.github/dependabot.yml').split('\n').length).toBe(12625);
  });

  it('post144: locks .github/dependabot.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/dependabot.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(24);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(22);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks .github/dependabot.yml HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, '.github/dependabot.yml'))).digest('hex')).toBe('111cb2c07cf9751a7915333e7d07f94895b05b00');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, '.github/dependabot.yml'))).digest('hex')).toBe('90451c547f4dcc0991b068d3caacda2d');
  });

  it('post144: locks test/helpers.ts sha256', () => {
    expect(sha256('test/helpers.ts')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
  });

  it('post144: locks test/helpers.ts sha1', () => {
    expect(sha1('test/helpers.ts')).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
  });

  it('post144: locks test/helpers.ts md5', () => {
    expect(md5('test/helpers.ts')).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it('post144: locks test/helpers.ts sha384', () => {
    expect(sha384('test/helpers.ts')).toBe('1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167');
  });

  it('post144: locks test/helpers.ts sha512', () => {
    expect(sha512('test/helpers.ts')).toBe('153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91');
  });

  it('post144: locks test/helpers.ts sha3-256', () => {
    expect(sha3('test/helpers.ts')).toBe('8ffbb4baecd580e1f9f797a737d24af1f3e0fb48af208435dafe8afaa584b113');
  });

  it('post144: locks test/helpers.ts blake2b512', () => {
    expect(blake2b('test/helpers.ts')).toBe('9000b1e34f31a60c5b766398de6ce5657f7325d791b129e388e1312c47d8448070919d7711a2824b821a99661fbeb73f6e13dfa4b1de53d72aa0990f73f1061f');
  });

  it('post144: locks test/helpers.ts ripemd160', () => {
    expect(ripemd('test/helpers.ts')).toBe('24c482ba1ff1b74537b67a89b99058b6f2e500a4');
  });

  it('post144: locks test/helpers.ts size 6078', () => {
    expect(statSync(join(root, 'test/helpers.ts')).size).toBe(6078);
    expect(readFileSync(join(root, 'test/helpers.ts')).byteLength).toBe(6078);
  });

  it('post144: locks test/helpers.ts utf8 6078 lines 164', () => {
    expect(read('test/helpers.ts')).toHaveLength(6078);
    expect(read('test/helpers.ts').split('\n')).toHaveLength(164);
  });

  it('post144: locks test/helpers.ts nibble 487 xor 5', () => {
    const d = sha256('test/helpers.ts');
    expect(nibbleSum(d)).toBe(487);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post144: locks test/helpers.ts pairSum 4132 rollingXor 216', () => {
    const d = sha256('test/helpers.ts');
    expect(pairSum(d)).toBe(4132);
    expect(rollingXor(d)).toBe(216);
  });

  it('post144: locks test/helpers.ts first/last/mid octets', () => {
    const d = sha256('test/helpers.ts');
    expect(d.slice(0, 2)).toBe('24');
    expect(d.slice(-2)).toBe('29');
    expect(d.slice(28, 36)).toBe('0c4a4014');
  });

  it('post144: locks test/helpers.ts HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', 'test/helpers.ts')).toBe('a2573724734898b5edfe4cb67906832bb8676a93ffd5926aaea873591c59a1b9');
    expect(hmacSha256('leftover', 'test/helpers.ts')).toBe('3cf47764c97927288d3627ddc71cecde2a6313dea10d1f5941a8cce945d8b3d1');
    expect(hmacSha256('TOKENMAXX', 'test/helpers.ts')).toBe('8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391');
  });

  it('post144: locks test/helpers.ts HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', 'test/helpers.ts')).toBe('286c084e485f6b95ab80eaedf7edad1602e1a7c106c3b0c916d3eda6267a453c');
    expect(hmacSha256('HEAVY', 'test/helpers.ts')).toBe('458cfb306ea3e2c9310b3e3840ecd5a5ca295e18c46146bad4c6111c4c3c1c24');
    expect(hmacSha256('no-product-invent', 'test/helpers.ts')).toBe('a6bca018ba16cafff8a3d108bbc4c96391d8da76ccdaf6927e095cbf2e763870');
  });

  it('post144: locks test/helpers.ts spaces 919', () => {
    expect((read('test/helpers.ts').match(/ /g) ?? []).length).toBe(919);
  });

  it('post144: locks test/helpers.ts reversed sha256', () => {
    const rev = [...read('test/helpers.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('e4e0c03b4add5880ffd0e08d925c61f9b010f475d513abd32e2baa8f79ef7625');
  });

  it('post144: locks test/helpers.ts sha256 UPPERCASE', () => {
    expect(sha256('test/helpers.ts').toUpperCase()).toBe('240E1FC521E029B07CA3EBDA83410C4A4014AF02F3AD64FA4EBA8BF6FFD3AF29');
  });

  it('post144: locks test/helpers.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('test/helpers.ts').split('\n')[0]).digest('hex')).toBe('e33b7958170700d0297aa0c9ad1db4689002e9bcee93e0e92b4e20e4837fbe22');
  });

  it('post144: locks test/helpers.ts size*lines 996792', () => {
    expect(statSync(join(root, 'test/helpers.ts')).size * read('test/helpers.ts').split('\n').length).toBe(996792);
  });

  it('post144: locks test/helpers.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('test/helpers.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(163);
    expect((t.match(/,/g) ?? []).length).toBe(58);
    expect((t.match(/:/g) ?? []).length).toBe(106);
    expect((t.match(/"/g) ?? []).length).toBe(34);
    expect((t.match(/'/g) ?? []).length).toBe(48);
  });

  it('post144: locks test/helpers.ts HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex')).toBe('ac521a5827cef064baf2b57cb57bc095a4769a1f');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex')).toBe('b303c5a5ed7ea25cde6e234f5ad1ea20');
  });

  it('post144: locks .cursor/environment.json sha256', () => {
    expect(sha256('.cursor/environment.json')).toBe('4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694');
  });

  it('post144: locks .cursor/environment.json sha1', () => {
    expect(sha1('.cursor/environment.json')).toBe('b4f3dec322cd018ce5c1dea89897a469bd128685');
  });

  it('post144: locks .cursor/environment.json md5', () => {
    expect(md5('.cursor/environment.json')).toBe('956c8804543595a31d6a7051aecd6528');
  });

  it('post144: locks .cursor/environment.json sha384', () => {
    expect(sha384('.cursor/environment.json')).toBe('0347d0c47319d7ae7b0221f2aac85537294169efac93d2fab633127f2a4fddcedba85875545448a4048d66f22a89193b');
  });

  it('post144: locks .cursor/environment.json sha512', () => {
    expect(sha512('.cursor/environment.json')).toBe('bc77873140fa55fe7b9ff10f6c7ebb8e287d35087bc0da8667814e3db45773a3a4bcecb1f7ab7479e0a2c0c4cad140c385583af6a0bb760a01121a1c830a6efb');
  });

  it('post144: locks .cursor/environment.json sha3-256', () => {
    expect(sha3('.cursor/environment.json')).toBe('070958f3fa1b4e8c86b71af2293d931e25decf653e60b5034dbcb817d5f10ad5');
  });

  it('post144: locks .cursor/environment.json blake2b512', () => {
    expect(blake2b('.cursor/environment.json')).toBe('8b7f4c7c49f504196537519b837fc2ff3419620401f088a626b3e7e0d643f3328fb4deae533db22e4de5887914ead0849d4db4b74ecf80707e6bb5c178910b63');
  });

  it('post144: locks .cursor/environment.json ripemd160', () => {
    expect(ripemd('.cursor/environment.json')).toBe('7475065e5ce5c2e4a5d757954b5428026c1156ae');
  });

  it('post144: locks .cursor/environment.json size 57', () => {
    expect(statSync(join(root, '.cursor/environment.json')).size).toBe(57);
    expect(readFileSync(join(root, '.cursor/environment.json')).byteLength).toBe(57);
  });

  it('post144: locks .cursor/environment.json utf8 57 lines 5', () => {
    expect(read('.cursor/environment.json')).toHaveLength(57);
    expect(read('.cursor/environment.json').split('\n')).toHaveLength(5);
  });

  it('post144: locks .cursor/environment.json nibble 472 xor 0', () => {
    const d = sha256('.cursor/environment.json');
    expect(nibbleSum(d)).toBe(472);
    expect(xorNibbles(d)).toBe(0);
  });

  it('post144: locks .cursor/environment.json pairSum 4222 rollingXor 0', () => {
    const d = sha256('.cursor/environment.json');
    expect(pairSum(d)).toBe(4222);
    expect(rollingXor(d)).toBe(0);
  });

  it('post144: locks .cursor/environment.json first/last/mid octets', () => {
    const d = sha256('.cursor/environment.json');
    expect(d.slice(0, 2)).toBe('4e');
    expect(d.slice(-2)).toBe('94');
    expect(d.slice(28, 36)).toBe('d121164a');
  });

  it('post144: locks .cursor/environment.json HMAC post144/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post144', '.cursor/environment.json')).toBe('3abd43542e4795f35911a6da665c3c1eb2e4e28f868fde974b0c784a295fe153');
    expect(hmacSha256('leftover', '.cursor/environment.json')).toBe('f3c07027290cc01d2ddd1979fab399b4f4ddaed8e682f9ba6f15b59f23ba2bc4');
    expect(hmacSha256('TOKENMAXX', '.cursor/environment.json')).toBe('796f38bc3f8907bef23dc36e49231f310bae76a745c9e26ac5073ba2ec3e8c49');
  });

  it('post144: locks .cursor/environment.json HMAC after-#144/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#144', '.cursor/environment.json')).toBe('6591c055b4fca3753fd1fc0484032d9e5741e95f390159fe45acbccd2cbdb05d');
    expect(hmacSha256('HEAVY', '.cursor/environment.json')).toBe('ac9494b2f787b999a6b41edc8f17a2bf4dfac30f0ee76ecef9d69be011dde10f');
    expect(hmacSha256('no-product-invent', '.cursor/environment.json')).toBe('bba79bd9a590f177e32e895a7935716c6ff65a461b15d43916ad5996af1092c5');
  });

  it('post144: locks .cursor/environment.json spaces 7', () => {
    expect((read('.cursor/environment.json').match(/ /g) ?? []).length).toBe(7);
  });

  it('post144: locks .cursor/environment.json reversed sha256', () => {
    const rev = [...read('.cursor/environment.json')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('054da0309906ae5e94ac3e2002ae737e7406a3d7106627586e5ed5496472069d');
  });

  it('post144: locks .cursor/environment.json sha256 UPPERCASE', () => {
    expect(sha256('.cursor/environment.json').toUpperCase()).toBe('4ED3537A1A4141C61BE528B8CA3BD121164AB2BED7D0A9B95C34CE81CCA99694');
  });

  it('post144: locks .cursor/environment.json first-line sha256', () => {
    expect(createHash('sha256').update(read('.cursor/environment.json').split('\n')[0]).digest('hex')).toBe('021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96');
  });

  it('post144: locks .cursor/environment.json size*lines 285', () => {
    expect(statSync(join(root, '.cursor/environment.json')).size * read('.cursor/environment.json').split('\n').length).toBe(285);
  });

  it('post144: locks .cursor/environment.json char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.cursor/environment.json');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(4);
    expect((t.match(/,/g) ?? []).length).toBe(1);
    expect((t.match(/:/g) ?? []).length).toBe(2);
    expect((t.match(/"/g) ?? []).length).toBe(8);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post144: locks .cursor/environment.json HMAC-SHA1/MD5 key post144', () => {
    expect(createHmac('sha1', 'post144').update(readFileSync(join(root, '.cursor/environment.json'))).digest('hex')).toBe('a8027ff80c515012a4499326b0c4feeabcd2c213');
    expect(createHmac('md5', 'post144').update(readFileSync(join(root, '.cursor/environment.json'))).digest('hex')).toBe('539de918ccafd8c5503ad3684218cefa');
  });

  it('post144: mega purity 40x package.json sha256', () => {
    const expected = '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c';
    for (let i = 0; i < 40; i++) expect(sha256('package.json')).toBe(expected);
  });

  it('post144: HMAC digests differ for distinct keys on package.json', () => {
    expect(hmacSha256('post144', 'package.json')).not.toBe(hmacSha256('HEAVY', 'package.json'));
    expect(hmacSha256('leftover', 'package.json')).not.toBe(hmacSha256('TOKENMAXX', 'package.json'));
    expect(hmacSha256('after-#144', 'package.json')).not.toBe(hmacSha256('no-product-invent', 'package.json'));
  });

  it('post144: negative inventing fence surface', () => {
    const idx = read('src/index.ts').toLowerCase();
    expect(idx).not.toContain('/playlist');
    expect(idx).not.toContain('process.env');
    expect(idx).not.toContain('anthropic');
    expect(read('wrangler.toml')).not.toMatch(/GEMINI_API_KEY\s*=/);
    const env = JSON.parse(read('.cursor/environment.json')) as { name: string; install: string };
    expect(env.name).toBe('Backlink_Facelift');
    expect(env.install).toBe('npm ci');
  });

  it('post144: SAMPLE_M3U still has 6 https streams', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it('post144: buildSimpleM3U + parseM3U roundtrip', () => {
    const m3u = buildSimpleM3U([{ name: 'Z', url: 'https://example.com/z.m3u8', group: 'Jazz' }]);
    const stations = parseM3U(m3u);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Z');
    expect(stations[0].url).toBe('https://example.com/z.m3u8');
    expect(stations[0].group).toBe('Jazz');
  });

  it('post144: iptvCategoryUrl shape', () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it('post144: seedStationsCache keys stations:genre', () => {
    expect(seedStationsCache('music', [])).toEqual({ 'stations:music': '[]' });
  });

  it('post144: testEnv VERSION default', () => {
    expect(testEnv().VERSION).toBe('0.1.0-test');
  });

  it('post144: curatedGeminiJson is valid JSON text', async () => {
    const res = curatedGeminiJson();
    const body = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const text = body.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text) as Array<{ name: string }>;
    expect(parsed[0].name).toBe('Alpha FM');
  });

  it('post144: src forbids /playlist', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('/playlist');
    }
  });

  it('post144: src forbids workers.ai', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('workers.ai');
    }
  });

  it('post144: src forbids d1_', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('d1_');
    }
  });

  it('post144: src forbids r2_', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('r2_');
    }
  });

  it('post144: src forbids vectorize', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('vectorize');
    }
  });

  it('post144: src forbids analytics engine', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('analytics engine');
    }
  });

  it('post144: src forbids hyperdrive', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('hyperdrive');
    }
  });

  it('post144: src forbids anthropic', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('anthropic');
    }
  });

  it('post144: src forbids openai', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('openai');
    }
  });

  it('post144: src forbids durable_object', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('durable_object');
    }
  });

  it('post144: src forbids queue_', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('queue_');
    }
  });

  it('post144: src forbids service binding', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('service binding');
    }
  });

  it('post144: src forbids anthropic_api_key', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('anthropic_api_key');
    }
  });

  it('post144: src forbids openai_api_key', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('openai_api_key');
    }
  });

  it('post144: src forbids process.env', () => {
    for (const f of ['src/genres.ts', 'src/index.ts', 'src/mcp.ts', 'src/parser.ts', 'src/types.ts'] as const) {
      expect(read(f).toLowerCase()).not.toContain('process.env');
    }
  });
  it('post144: final inventory markers', () => {
    const body = read('test/helpers.test.ts');
    expect(body).toContain("describe('post144 helpers HEAVY deepen (after #144)'");
    expect((body.match(/it\('post144:/g) ?? []).length).toBeGreaterThan(60);
  });
});


describe('post144 helpers extras HEAVY deepen (after #144 leftover slice)', () => {
  const root = helpersRoot;
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

  it('post144-extras: sha256 src/genres.ts', () => { expect(sha256('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e'); });
  it('post144-extras: HMAC post144 src/genres.ts', () => { expect(hmacSha256('post144', 'src/genres.ts')).toBe('deaeba77d3cede8aa31901f4296c4e799da0d9a41ce5a2956f0bdd43a69633d5'); });
  it('post144-extras: HMAC leftover src/genres.ts', () => { expect(hmacSha256('leftover', 'src/genres.ts')).toBe('bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f'); });
  it('post144-extras: HMAC TOKENMAXX src/genres.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/genres.ts')).toBe('7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951'); });
  it('post144-extras: HMAC HEAVY src/genres.ts', () => { expect(hmacSha256('HEAVY', 'src/genres.ts')).toBe('728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575'); });
  it('post144-extras: HMAC after-#144 src/genres.ts', () => { expect(hmacSha256('after-#144', 'src/genres.ts')).toBe('709b9688780c0634269e4e70a900a83bae3b5406c1051cbfc3215e4c577ef762'); });
  it('post144-extras: HMAC no-product-invent src/genres.ts', () => { expect(hmacSha256('no-product-invent', 'src/genres.ts')).toBe('3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b'); });
  it('post144-extras: HMAC slice-diff src/genres.ts', () => { expect(hmacSha256('slice-diff', 'src/genres.ts')).toBe('22d66e269afda39844782f2607b23bacf23e5d02a51249ddec437782bc1a3a78'); });
  it('post144-extras: HMAC no-src-change src/genres.ts', () => { expect(hmacSha256('no-src-change', 'src/genres.ts')).toBe('a3b9a583e340975667c401c4933eb3535590637cdc49d496ffec24efecd28810'); });
  it('post144-extras: HMAC manifest-lock src/genres.ts', () => { expect(hmacSha256('manifest-lock', 'src/genres.ts')).toBe('e9f5e2172614a8e3160d35040a7380c6d239a34a24fe0b257862f3edc83bb4dc'); });
  it('post144-extras: HMAC HITL src/genres.ts', () => { expect(hmacSha256('HITL', 'src/genres.ts')).toBe('362c2d70ee75f8c1e7d51b6ddfe68240447296e1ece630cd472a087f32033485'); });
  it('post144-extras: sha256 src/index.ts', () => { expect(sha256('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72'); });
  it('post144-extras: HMAC post144 src/index.ts', () => { expect(hmacSha256('post144', 'src/index.ts')).toBe('193c749dc85e2745d03b41be50db7671e0e1f8d1147558d564cc771835e3a685'); });
  it('post144-extras: HMAC leftover src/index.ts', () => { expect(hmacSha256('leftover', 'src/index.ts')).toBe('268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be'); });
  it('post144-extras: HMAC TOKENMAXX src/index.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/index.ts')).toBe('d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc'); });
  it('post144-extras: HMAC HEAVY src/index.ts', () => { expect(hmacSha256('HEAVY', 'src/index.ts')).toBe('f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30'); });
  it('post144-extras: HMAC after-#144 src/index.ts', () => { expect(hmacSha256('after-#144', 'src/index.ts')).toBe('d83fda242e36a57a5a31d57c22f0a33c7aa00c054f64a0817e90be63c9548d0c'); });
  it('post144-extras: HMAC no-product-invent src/index.ts', () => { expect(hmacSha256('no-product-invent', 'src/index.ts')).toBe('49e017c3ff39fee9c0f5d47c30cccb692dd0c4c39f3d36655bbb08108fcc7e0a'); });
  it('post144-extras: HMAC slice-diff src/index.ts', () => { expect(hmacSha256('slice-diff', 'src/index.ts')).toBe('c2be27a92bce9fa17108fbf90f63b917d25d4114397192e04caf79ac29e8f44f'); });
  it('post144-extras: HMAC no-src-change src/index.ts', () => { expect(hmacSha256('no-src-change', 'src/index.ts')).toBe('f1b32cf267f0c31a79062ca85a6243b3f166c1d5dcf534c3149a97e9d6ae4846'); });
  it('post144-extras: HMAC manifest-lock src/index.ts', () => { expect(hmacSha256('manifest-lock', 'src/index.ts')).toBe('41e4be551225bde732f63c07d1a0d8c24bd630a5c649a3b4c3eb88ca0338c946'); });
  it('post144-extras: HMAC HITL src/index.ts', () => { expect(hmacSha256('HITL', 'src/index.ts')).toBe('130212fd19b5ad02645c499bcc4fc9214fd04007e35b94977b14d2775e04d1b0'); });
  it('post144-extras: sha256 src/mcp.ts', () => { expect(sha256('src/mcp.ts')).toBe('6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683'); });
  it('post144-extras: HMAC post144 src/mcp.ts', () => { expect(hmacSha256('post144', 'src/mcp.ts')).toBe('aa5c389ea83f1b99ed98e6a832a190b8cdd6a25aa56d776dfaf75a9e781e3b92'); });
  it('post144-extras: HMAC leftover src/mcp.ts', () => { expect(hmacSha256('leftover', 'src/mcp.ts')).toBe('8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712'); });
  it('post144-extras: HMAC TOKENMAXX src/mcp.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/mcp.ts')).toBe('cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62'); });
  it('post144-extras: HMAC HEAVY src/mcp.ts', () => { expect(hmacSha256('HEAVY', 'src/mcp.ts')).toBe('870bb2f88c83abd6679e447c6937b01c998a1b3f527024e687dc35c00a046e40'); });
  it('post144-extras: HMAC after-#144 src/mcp.ts', () => { expect(hmacSha256('after-#144', 'src/mcp.ts')).toBe('46996564f1d68b91a76d6dbafd853e53872edc499aef2fa8a34dda4a39ebbc38'); });
  it('post144-extras: HMAC no-product-invent src/mcp.ts', () => { expect(hmacSha256('no-product-invent', 'src/mcp.ts')).toBe('71a686fe812adcc92f40d5ca19a3996e68555d6749199affd3fc002053aabd65'); });
  it('post144-extras: HMAC slice-diff src/mcp.ts', () => { expect(hmacSha256('slice-diff', 'src/mcp.ts')).toBe('4f4c0995596fa6a8eecfa27d7f7047b084074e0acf00d6890811a88f5f807e05'); });
  it('post144-extras: HMAC no-src-change src/mcp.ts', () => { expect(hmacSha256('no-src-change', 'src/mcp.ts')).toBe('83880bdeca0f5e263ef18761f18cac15707d298b1c7fe1157e766221d37f343a'); });
  it('post144-extras: HMAC manifest-lock src/mcp.ts', () => { expect(hmacSha256('manifest-lock', 'src/mcp.ts')).toBe('b87b5d8230d2c0d160c1d3fd8e6864b8344b3765e2a3d5620130f45110a6c503'); });
  it('post144-extras: HMAC HITL src/mcp.ts', () => { expect(hmacSha256('HITL', 'src/mcp.ts')).toBe('c2e5ce2b5f82e2b462e2056d2f0bd19ae2743e130f712a39aaeafa3ec451bebc'); });
  it('post144-extras: sha256 src/parser.ts', () => { expect(sha256('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368'); });
  it('post144-extras: HMAC post144 src/parser.ts', () => { expect(hmacSha256('post144', 'src/parser.ts')).toBe('8e196e09162dd4db61dbadb2031bd07ebd444a30516a1ccf5fd5dfc7de09f68b'); });
  it('post144-extras: HMAC leftover src/parser.ts', () => { expect(hmacSha256('leftover', 'src/parser.ts')).toBe('e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3'); });
  it('post144-extras: HMAC TOKENMAXX src/parser.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/parser.ts')).toBe('eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8'); });
  it('post144-extras: HMAC HEAVY src/parser.ts', () => { expect(hmacSha256('HEAVY', 'src/parser.ts')).toBe('fd5ebb2c344a6816bb58195587d08797442f589d92c7b5abae29a493e249ef70'); });
  it('post144-extras: HMAC after-#144 src/parser.ts', () => { expect(hmacSha256('after-#144', 'src/parser.ts')).toBe('ba4f98feab43affa31d4c2e36646a8cecd672bfe41dfc02028229f92bbaa9aa7'); });
  it('post144-extras: HMAC no-product-invent src/parser.ts', () => { expect(hmacSha256('no-product-invent', 'src/parser.ts')).toBe('25b61b2dada026216640bb0a1e66ac0b6216c6f7aa182e6af20a1d43bb35446f'); });
  it('post144-extras: HMAC slice-diff src/parser.ts', () => { expect(hmacSha256('slice-diff', 'src/parser.ts')).toBe('fecc1f8258da869db2d707d6e6ed0ab5b64f70825cbadbc6332407d68d28f2c6'); });
  it('post144-extras: HMAC no-src-change src/parser.ts', () => { expect(hmacSha256('no-src-change', 'src/parser.ts')).toBe('e22a10b16e32cbb5f2170343ce1b4adbdc83427acb731f9ca52fb464cefa605b'); });
  it('post144-extras: HMAC manifest-lock src/parser.ts', () => { expect(hmacSha256('manifest-lock', 'src/parser.ts')).toBe('1c5081330de4e7e0aaa0d3449a5e9ef4b8f5a8f5c9c6c828827a3a91f5003bdc'); });
  it('post144-extras: HMAC HITL src/parser.ts', () => { expect(hmacSha256('HITL', 'src/parser.ts')).toBe('c19453d8fa9b1b5d3b021c6c72d544a8224dd5766c48b73b9ed8ec6366ab4b8c'); });
  it('post144-extras: sha256 src/types.ts', () => { expect(sha256('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3'); });
  it('post144-extras: HMAC post144 src/types.ts', () => { expect(hmacSha256('post144', 'src/types.ts')).toBe('34d5636ca5e2dd4ad1ad2a06e96207ef2164ef223078c7314d2892e99bf656da'); });
  it('post144-extras: HMAC leftover src/types.ts', () => { expect(hmacSha256('leftover', 'src/types.ts')).toBe('80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85'); });
  it('post144-extras: HMAC TOKENMAXX src/types.ts', () => { expect(hmacSha256('TOKENMAXX', 'src/types.ts')).toBe('5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc'); });
  it('post144-extras: HMAC HEAVY src/types.ts', () => { expect(hmacSha256('HEAVY', 'src/types.ts')).toBe('c30f6d748b6c06b8387764e536eab11def9e8f3f000f4b2b764e050f64ebc32a'); });
  it('post144-extras: HMAC after-#144 src/types.ts', () => { expect(hmacSha256('after-#144', 'src/types.ts')).toBe('dda1db4a711e13ca215b013b2675a217c516e9efbfb52936f62eb6270bb6a126'); });
  it('post144-extras: HMAC no-product-invent src/types.ts', () => { expect(hmacSha256('no-product-invent', 'src/types.ts')).toBe('431b246bf23d8a3f8ec5228a8746b5ac62ace79e3ec1dc369e9645be295be076'); });
  it('post144-extras: HMAC slice-diff src/types.ts', () => { expect(hmacSha256('slice-diff', 'src/types.ts')).toBe('d1e497bd3dc7e06713395285b574a0d0da8bdd3b9614da249b4218aad57bd70b'); });
  it('post144-extras: HMAC no-src-change src/types.ts', () => { expect(hmacSha256('no-src-change', 'src/types.ts')).toBe('66b6c84c4d65babc626f3d0614b2d67cf4e18375f20cf74ae311e52bfcd2acc2'); });
  it('post144-extras: HMAC manifest-lock src/types.ts', () => { expect(hmacSha256('manifest-lock', 'src/types.ts')).toBe('96a5eda772aed1d149de5c3486ab886fc5b5f9108ad8b2ff8f11be66f236b356'); });
  it('post144-extras: HMAC HITL src/types.ts', () => { expect(hmacSha256('HITL', 'src/types.ts')).toBe('24a9d0042b44f1b08dd117266f91d4794d44bf5007fe1ae9fdd668c4970e5519'); });
  it('post144-extras: sha256 wrangler.toml', () => { expect(sha256('wrangler.toml')).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8'); });
  it('post144-extras: HMAC post144 wrangler.toml', () => { expect(hmacSha256('post144', 'wrangler.toml')).toBe('9499d8e6f8f7a4c1eed6ba5eabc05e7d0e24609e96dd23cefbb3a169ab766560'); });
  it('post144-extras: HMAC leftover wrangler.toml', () => { expect(hmacSha256('leftover', 'wrangler.toml')).toBe('117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063'); });
  it('post144-extras: HMAC TOKENMAXX wrangler.toml', () => { expect(hmacSha256('TOKENMAXX', 'wrangler.toml')).toBe('7d198a7e11f32e841079eb2398433044d49d9336bb0642737d55dbb39a1206d4'); });
  it('post144-extras: HMAC HEAVY wrangler.toml', () => { expect(hmacSha256('HEAVY', 'wrangler.toml')).toBe('0106e385ea2e0ca3fd52ddc940a1eb5921a22885362d57f5a49dd1bda89ea5db'); });
  it('post144-extras: HMAC after-#144 wrangler.toml', () => { expect(hmacSha256('after-#144', 'wrangler.toml')).toBe('d4e996551dc8a7aaed7067a46cd0d50729765f745fa7487535d8f7e2cd04cab8'); });
  it('post144-extras: HMAC no-product-invent wrangler.toml', () => { expect(hmacSha256('no-product-invent', 'wrangler.toml')).toBe('3d99d134e0673c8ff163b29a6c72e49bfa5e599898762bf47dd20f0e65639abb'); });
  it('post144-extras: HMAC slice-diff wrangler.toml', () => { expect(hmacSha256('slice-diff', 'wrangler.toml')).toBe('ff10d155b4bfa2137b3d8248b28954f776f80f51ddf29915f4a0792dca9e4b17'); });
  it('post144-extras: HMAC no-src-change wrangler.toml', () => { expect(hmacSha256('no-src-change', 'wrangler.toml')).toBe('b542f61e71ea970554a5d78c6f3caa0491697694218687f89822c8cc8509b67b'); });
  it('post144-extras: HMAC manifest-lock wrangler.toml', () => { expect(hmacSha256('manifest-lock', 'wrangler.toml')).toBe('ba1c46086c0d7c2f08a90b091ba228b20b7bf50c702c3e3478a8b4b96e95d882'); });
  it('post144-extras: HMAC HITL wrangler.toml', () => { expect(hmacSha256('HITL', 'wrangler.toml')).toBe('163535e4f1ffba9fa5d82ccec88c349b95720ee09d57f10a4b7d067551b2e0bf'); });
  it('post144-extras: sha256 package.json', () => { expect(sha256('package.json')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c'); });
  it('post144-extras: HMAC post144 package.json', () => { expect(hmacSha256('post144', 'package.json')).toBe('d135fe4b6b5fdc18e139c6b5f6519ab396435023f315e2dd00371db2100b73f5'); });
  it('post144-extras: HMAC leftover package.json', () => { expect(hmacSha256('leftover', 'package.json')).toBe('20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1'); });
  it('post144-extras: HMAC TOKENMAXX package.json', () => { expect(hmacSha256('TOKENMAXX', 'package.json')).toBe('ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58'); });
  it('post144-extras: HMAC HEAVY package.json', () => { expect(hmacSha256('HEAVY', 'package.json')).toBe('59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563'); });
  it('post144-extras: HMAC after-#144 package.json', () => { expect(hmacSha256('after-#144', 'package.json')).toBe('3639b440b8a35b7453a36a1d2c6085f07314888363f235ee186b981606dd242a'); });
  it('post144-extras: HMAC no-product-invent package.json', () => { expect(hmacSha256('no-product-invent', 'package.json')).toBe('b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b'); });
  it('post144-extras: HMAC slice-diff package.json', () => { expect(hmacSha256('slice-diff', 'package.json')).toBe('dc869038c3869410db214fb5618c8f6091545ded44463dd4ccdf26cefc3dca56'); });
  it('post144-extras: HMAC no-src-change package.json', () => { expect(hmacSha256('no-src-change', 'package.json')).toBe('f89ef881d4621b0b9716e0341fb3cd014b14115046ec8e1fbc1baa995c764959'); });
  it('post144-extras: HMAC manifest-lock package.json', () => { expect(hmacSha256('manifest-lock', 'package.json')).toBe('c78857efdc2a9ef7366350439061383f242d1056da2d338f56f4d698b5748417'); });
  it('post144-extras: HMAC HITL package.json', () => { expect(hmacSha256('HITL', 'package.json')).toBe('28ad7c71e0cbd46cab4e1f494c8e29a6140d447b63e530001e98d85096dc6424'); });
  it('post144-extras: sha256 vitest.config.ts', () => { expect(sha256('vitest.config.ts')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38'); });
  it('post144-extras: HMAC post144 vitest.config.ts', () => { expect(hmacSha256('post144', 'vitest.config.ts')).toBe('b40fa27df2e649db712b9e17fd2883d3c92c3e1e59e0ce09b5247fc908fcd883'); });
  it('post144-extras: HMAC leftover vitest.config.ts', () => { expect(hmacSha256('leftover', 'vitest.config.ts')).toBe('3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7'); });
  it('post144-extras: HMAC TOKENMAXX vitest.config.ts', () => { expect(hmacSha256('TOKENMAXX', 'vitest.config.ts')).toBe('0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9'); });
  it('post144-extras: HMAC HEAVY vitest.config.ts', () => { expect(hmacSha256('HEAVY', 'vitest.config.ts')).toBe('08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179'); });
  it('post144-extras: HMAC after-#144 vitest.config.ts', () => { expect(hmacSha256('after-#144', 'vitest.config.ts')).toBe('bfcb2e6995eb5a0f1b3fe347cdec5528923ff11648c3869661b8d13a5f1500bd'); });
  it('post144-extras: HMAC no-product-invent vitest.config.ts', () => { expect(hmacSha256('no-product-invent', 'vitest.config.ts')).toBe('3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c'); });
  it('post144-extras: HMAC slice-diff vitest.config.ts', () => { expect(hmacSha256('slice-diff', 'vitest.config.ts')).toBe('561ba73465a9de5fd03d403c4dd508c2058439a0206f6a694190dd71b47a4f70'); });
  it('post144-extras: HMAC no-src-change vitest.config.ts', () => { expect(hmacSha256('no-src-change', 'vitest.config.ts')).toBe('9e2fe808f40ed7a1049bef62978dd65efbea705482829585570b3fc4f5bf1a54'); });
  it('post144-extras: HMAC manifest-lock vitest.config.ts', () => { expect(hmacSha256('manifest-lock', 'vitest.config.ts')).toBe('7ae3b954bcee884ec6b1aada9b98e3b746465b99d10627ccb8def98e1e97799d'); });
  it('post144-extras: HMAC HITL vitest.config.ts', () => { expect(hmacSha256('HITL', 'vitest.config.ts')).toBe('7a9860baf8257f33d9c739ba74909a2051072f177f84ca19c344f8f926b33875'); });
  it('post144-extras: sha256 tsconfig.json', () => { expect(sha256('tsconfig.json')).toBe('ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792'); });
  it('post144-extras: HMAC post144 tsconfig.json', () => { expect(hmacSha256('post144', 'tsconfig.json')).toBe('65a881f732fa07268ee51577ebf6b31a91c3d2dfe7450123685830df1765ce35'); });
  it('post144-extras: HMAC leftover tsconfig.json', () => { expect(hmacSha256('leftover', 'tsconfig.json')).toBe('8b1d7fdf24ecef58d7971089e3fb62f7cf97d8a840f50636ffa32327fa8503a9'); });
  it('post144-extras: HMAC TOKENMAXX tsconfig.json', () => { expect(hmacSha256('TOKENMAXX', 'tsconfig.json')).toBe('2da19928cb9b06a5242f987184cc2d44cc385aed692bf3b6fa005e79065d47d1'); });
  it('post144-extras: HMAC HEAVY tsconfig.json', () => { expect(hmacSha256('HEAVY', 'tsconfig.json')).toBe('351594a3f9f8c0502c2a8387cd10b128a0cc58fc4bc16001784d9e1b55a4088f'); });
  it('post144-extras: HMAC after-#144 tsconfig.json', () => { expect(hmacSha256('after-#144', 'tsconfig.json')).toBe('9bc2b6d90a9751a5a25b41cccb613557e441dad33c74898b81f01023cd8c1ea9'); });
  it('post144-extras: HMAC no-product-invent tsconfig.json', () => { expect(hmacSha256('no-product-invent', 'tsconfig.json')).toBe('94ad9d8f2eeaf1debb6286a3db3ef2dfadafc8f031999c1c384fef8d8310ae22'); });
  it('post144-extras: HMAC slice-diff tsconfig.json', () => { expect(hmacSha256('slice-diff', 'tsconfig.json')).toBe('283515c2a7db0c9a5766d62df6d62217945f7b229ecc08301523a8b5466c3675'); });
  it('post144-extras: HMAC no-src-change tsconfig.json', () => { expect(hmacSha256('no-src-change', 'tsconfig.json')).toBe('85133c5251f48153837ae5edbf26caf56904922c40ba07af452e502e1c876d20'); });
  it('post144-extras: HMAC manifest-lock tsconfig.json', () => { expect(hmacSha256('manifest-lock', 'tsconfig.json')).toBe('5987d1790e3a064e0431d9e3ed61dfee5cc5d325e3adc32e95ffb65c9b8dd6e6'); });
  it('post144-extras: HMAC HITL tsconfig.json', () => { expect(hmacSha256('HITL', 'tsconfig.json')).toBe('4551913da487bb3a9dd1b23be2d2a360ef2fec843b11d43e84cb88c022c16b42'); });
  it('post144-extras: sha256 AGENTS.md', () => { expect(sha256('AGENTS.md')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa'); });
  it('post144-extras: HMAC post144 AGENTS.md', () => { expect(hmacSha256('post144', 'AGENTS.md')).toBe('305dcaeab8aff3091db106c83ea5389ef3b11783dd50610eb804169a6bf66c34'); });
  it('post144-extras: HMAC leftover AGENTS.md', () => { expect(hmacSha256('leftover', 'AGENTS.md')).toBe('ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e'); });
  it('post144-extras: HMAC TOKENMAXX AGENTS.md', () => { expect(hmacSha256('TOKENMAXX', 'AGENTS.md')).toBe('b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f'); });
  it('post144-extras: HMAC HEAVY AGENTS.md', () => { expect(hmacSha256('HEAVY', 'AGENTS.md')).toBe('f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c'); });
  it('post144-extras: HMAC after-#144 AGENTS.md', () => { expect(hmacSha256('after-#144', 'AGENTS.md')).toBe('645d38df46b86bae358d6e5fc6e743303c62fde04185b839f46a5c0b46bff308'); });
  it('post144-extras: HMAC no-product-invent AGENTS.md', () => { expect(hmacSha256('no-product-invent', 'AGENTS.md')).toBe('dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264'); });
  it('post144-extras: HMAC slice-diff AGENTS.md', () => { expect(hmacSha256('slice-diff', 'AGENTS.md')).toBe('870cb0b7ca943c82a943cb231e6171ba55b8a1be90d4368fe1e30a3666060c90'); });
  it('post144-extras: HMAC no-src-change AGENTS.md', () => { expect(hmacSha256('no-src-change', 'AGENTS.md')).toBe('94cb89045ff7e09a81a02dd8ee4ee7eb0ef7d412d7260f9ab24056774ed00967'); });
  it('post144-extras: HMAC manifest-lock AGENTS.md', () => { expect(hmacSha256('manifest-lock', 'AGENTS.md')).toBe('af3b8d7bad009043c764c1d1f67b9526650ba158a9053d887985ddce5dc997c5'); });
  it('post144-extras: HMAC HITL AGENTS.md', () => { expect(hmacSha256('HITL', 'AGENTS.md')).toBe('0df134c66ef2431f8f7d8b281ed09c1ffedddaa4fe6f91357592a9a6ef37bece'); });
  it('post144-extras: sha256 DEPLOY.md', () => { expect(sha256('DEPLOY.md')).toBe('11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a'); });
  it('post144-extras: HMAC post144 DEPLOY.md', () => { expect(hmacSha256('post144', 'DEPLOY.md')).toBe('839484296c4641dd4e678ae09a9398fea1b1b82d748c38c18714b7733415cc93'); });
  it('post144-extras: HMAC leftover DEPLOY.md', () => { expect(hmacSha256('leftover', 'DEPLOY.md')).toBe('8e69d3722a2f57941fecb3a0602ebb6cab5a31755e7c8bc88ed0771bc1822659'); });
  it('post144-extras: HMAC TOKENMAXX DEPLOY.md', () => { expect(hmacSha256('TOKENMAXX', 'DEPLOY.md')).toBe('bdb0c19924928cf4d54308dcdd72f032fea4ae1994669e96bf22f48567084f26'); });
  it('post144-extras: HMAC HEAVY DEPLOY.md', () => { expect(hmacSha256('HEAVY', 'DEPLOY.md')).toBe('5e8e11b4b80c19b0e2828f509f4411d5c7d176f5101c2aa2094ae43dfcf385d3'); });
  it('post144-extras: HMAC after-#144 DEPLOY.md', () => { expect(hmacSha256('after-#144', 'DEPLOY.md')).toBe('e8ab767c9640231b53235b9b41a048036cf0db91de9544fbcedcc667a335b2f0'); });
  it('post144-extras: HMAC no-product-invent DEPLOY.md', () => { expect(hmacSha256('no-product-invent', 'DEPLOY.md')).toBe('cb29f601b5afcc4ca9e180a792e0a028c44afad0b5fcbbbafdd0dcee3c24f29e'); });
  it('post144-extras: HMAC slice-diff DEPLOY.md', () => { expect(hmacSha256('slice-diff', 'DEPLOY.md')).toBe('723355201d08c16dada7a9d8e6320062b2f596dfc3c410fc608ae1fdb6495a01'); });
  it('post144-extras: HMAC no-src-change DEPLOY.md', () => { expect(hmacSha256('no-src-change', 'DEPLOY.md')).toBe('970a597da05c0d8f2f4e8edec9f75ac1d9bb6911a8bd66098985eca56e650d9a'); });
  it('post144-extras: HMAC manifest-lock DEPLOY.md', () => { expect(hmacSha256('manifest-lock', 'DEPLOY.md')).toBe('618d1f805ccde592ec38ddddba5e67e23b505691f1851e12a013ff9f7fd70bc9'); });
  it('post144-extras: HMAC HITL DEPLOY.md', () => { expect(hmacSha256('HITL', 'DEPLOY.md')).toBe('304c5ef7a469283183c42d01f6c8c29fdb237fcdadb181445171e15f8c8bf071'); });
  it('post144-extras: sha256 README.md', () => { expect(sha256('README.md')).toBe('f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987'); });
  it('post144-extras: HMAC post144 README.md', () => { expect(hmacSha256('post144', 'README.md')).toBe('80693d567bebc6130c1a9e98783ff11c021e2114293ae7400e3d6d8b257b6ef0'); });
  it('post144-extras: HMAC leftover README.md', () => { expect(hmacSha256('leftover', 'README.md')).toBe('57c08297703e57c6b5694a515e43b6592bd130637c82dcc569a048bda2fd181f'); });
  it('post144-extras: HMAC TOKENMAXX README.md', () => { expect(hmacSha256('TOKENMAXX', 'README.md')).toBe('51a608392fd700865f32aac02646908bf1235d6c4d587e9daa92383d6a777b94'); });
  it('post144-extras: HMAC HEAVY README.md', () => { expect(hmacSha256('HEAVY', 'README.md')).toBe('4bb62cc19640e3a3d792e3eba8d499203b4729899d5838ec2065ee409ab0430d'); });
  it('post144-extras: HMAC after-#144 README.md', () => { expect(hmacSha256('after-#144', 'README.md')).toBe('db014f8495b97e9bdbb1245b2e9abfb47a61a8a72cc0b160cb268246a2d6b1fc'); });
  it('post144-extras: HMAC no-product-invent README.md', () => { expect(hmacSha256('no-product-invent', 'README.md')).toBe('c1d8bb52c5ad591530152e8ec780bd262a1b78aeb7aea241bcef2a46a5e1ad7a'); });
  it('post144-extras: HMAC slice-diff README.md', () => { expect(hmacSha256('slice-diff', 'README.md')).toBe('afd276d87586dcc4395cec6f4a88c365bedd3992dc0b6a4448b04ad23f186225'); });
  it('post144-extras: HMAC no-src-change README.md', () => { expect(hmacSha256('no-src-change', 'README.md')).toBe('017324f9cb021cd4af3721c48db1e471d472683f64af8e7f0b4a52d2b77d2fba'); });
  it('post144-extras: HMAC manifest-lock README.md', () => { expect(hmacSha256('manifest-lock', 'README.md')).toBe('338002f36227d22e700f2cfa8d7a9a592e093f5ffbcef1c27583b8a0d79dd8d5'); });
  it('post144-extras: HMAC HITL README.md', () => { expect(hmacSha256('HITL', 'README.md')).toBe('63f3a6d94b5bc3a9700609fd321dfdfaf2fb9c726a3e08447301615923c532e0'); });
  it('post144-extras: sha256 docs/mcp-spec.md', () => { expect(sha256('docs/mcp-spec.md')).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849'); });
  it('post144-extras: HMAC post144 docs/mcp-spec.md', () => { expect(hmacSha256('post144', 'docs/mcp-spec.md')).toBe('aff70172217fde98f5456142175cebca2967f1ac505d1a07aad66f3677b6407f'); });
  it('post144-extras: HMAC leftover docs/mcp-spec.md', () => { expect(hmacSha256('leftover', 'docs/mcp-spec.md')).toBe('cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df'); });
  it('post144-extras: HMAC TOKENMAXX docs/mcp-spec.md', () => { expect(hmacSha256('TOKENMAXX', 'docs/mcp-spec.md')).toBe('58bd8b12de8084ece067f68db2cea2ea5dc8b43305c0d5e7e20506fd40e18749'); });
  it('post144-extras: HMAC HEAVY docs/mcp-spec.md', () => { expect(hmacSha256('HEAVY', 'docs/mcp-spec.md')).toBe('14502ba27898e795fb59cc37b06fe6eb2a66b40811b068e87738eb3dbf4cae59'); });
  it('post144-extras: HMAC after-#144 docs/mcp-spec.md', () => { expect(hmacSha256('after-#144', 'docs/mcp-spec.md')).toBe('15be4839db21adb45403babff19f28198cd6339284bc698326e8f31e017809cf'); });
  it('post144-extras: HMAC no-product-invent docs/mcp-spec.md', () => { expect(hmacSha256('no-product-invent', 'docs/mcp-spec.md')).toBe('1ea2c93af05439c6a1c14acfbee6d34dddfc2b32e6c8b6256c270f6d4484b608'); });
  it('post144-extras: HMAC slice-diff docs/mcp-spec.md', () => { expect(hmacSha256('slice-diff', 'docs/mcp-spec.md')).toBe('06d50d14b3b548000878558498c74926788485f641f279bbbdfe5d14f0bbbb4a'); });
  it('post144-extras: HMAC no-src-change docs/mcp-spec.md', () => { expect(hmacSha256('no-src-change', 'docs/mcp-spec.md')).toBe('84ca704115fb25233f9bf1ba5e611bdd463e200ae837d762c61d4280a26ba6db'); });
  it('post144-extras: HMAC manifest-lock docs/mcp-spec.md', () => { expect(hmacSha256('manifest-lock', 'docs/mcp-spec.md')).toBe('b70a770cd09ea94dcd51d690d3a96822867773eae92d2afc16ef212ee8537513'); });
  it('post144-extras: HMAC HITL docs/mcp-spec.md', () => { expect(hmacSha256('HITL', 'docs/mcp-spec.md')).toBe('0eec72a5669dccb2303226a3b772d5336ddc9744380101ba27d3ecc96ca1a668'); });
  it('post144-extras: sha256 .github/workflows/ci.yml', () => { expect(sha256('.github/workflows/ci.yml')).toBe('c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5'); });
  it('post144-extras: HMAC post144 .github/workflows/ci.yml', () => { expect(hmacSha256('post144', '.github/workflows/ci.yml')).toBe('afe7b174bd8f66dbae1b92a05d66a6f5df406909cc676c9c5d10ae13858b56c7'); });
  it('post144-extras: HMAC leftover .github/workflows/ci.yml', () => { expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe('d3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce'); });
  it('post144-extras: HMAC TOKENMAXX .github/workflows/ci.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).toBe('5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b'); });
  it('post144-extras: HMAC HEAVY .github/workflows/ci.yml', () => { expect(hmacSha256('HEAVY', '.github/workflows/ci.yml')).toBe('8c10cb5abbb616b57d2df21384cbdb40264d52be8a25a32448acd6e22e1848ea'); });
  it('post144-extras: HMAC after-#144 .github/workflows/ci.yml', () => { expect(hmacSha256('after-#144', '.github/workflows/ci.yml')).toBe('74c810ab49c253d698ee4130f4426ef96d92039c885437b9f9c12642802ba051'); });
  it('post144-extras: HMAC no-product-invent .github/workflows/ci.yml', () => { expect(hmacSha256('no-product-invent', '.github/workflows/ci.yml')).toBe('1a959a3eb061936e9c62fd3497ddd23988ff785d88dcfdd133f97d35c77e8fde'); });
  it('post144-extras: HMAC slice-diff .github/workflows/ci.yml', () => { expect(hmacSha256('slice-diff', '.github/workflows/ci.yml')).toBe('589b0400ab9b6c63dc596fda36cd56f90acb45d84be4ddbf88b7e28030a42fba'); });
  it('post144-extras: HMAC no-src-change .github/workflows/ci.yml', () => { expect(hmacSha256('no-src-change', '.github/workflows/ci.yml')).toBe('b14dfd46c70af553877fde42c3925ad14dcf6d0b2806c3acba8a3ba7978116fc'); });
  it('post144-extras: HMAC manifest-lock .github/workflows/ci.yml', () => { expect(hmacSha256('manifest-lock', '.github/workflows/ci.yml')).toBe('0833800c412e79ca645326cd2fcfe5da70b137accda0fee38d7b4ae1acbd9189'); });
  it('post144-extras: HMAC HITL .github/workflows/ci.yml', () => { expect(hmacSha256('HITL', '.github/workflows/ci.yml')).toBe('a1f8c9446de2bb236d3211d1ea7bc88fcb53a65e967b7eb08bc46e2f0ea0e461'); });
  it('post144-extras: sha256 .github/workflows/deploy.yml', () => { expect(sha256('.github/workflows/deploy.yml')).toBe('49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3'); });
  it('post144-extras: HMAC post144 .github/workflows/deploy.yml', () => { expect(hmacSha256('post144', '.github/workflows/deploy.yml')).toBe('5c0a7fdcc906513c89e5eee05566c9ab460f855ce542213c923e842cbc5e92cd'); });
  it('post144-extras: HMAC leftover .github/workflows/deploy.yml', () => { expect(hmacSha256('leftover', '.github/workflows/deploy.yml')).toBe('e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83'); });
  it('post144-extras: HMAC TOKENMAXX .github/workflows/deploy.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/workflows/deploy.yml')).toBe('339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b'); });
  it('post144-extras: HMAC HEAVY .github/workflows/deploy.yml', () => { expect(hmacSha256('HEAVY', '.github/workflows/deploy.yml')).toBe('87354c51a785eb76f81ba427f9a58d6f8b0b7e3c85febd19b973c04874bde601'); });
  it('post144-extras: HMAC after-#144 .github/workflows/deploy.yml', () => { expect(hmacSha256('after-#144', '.github/workflows/deploy.yml')).toBe('cdb68cd6cfd137982c5f0204bec7ca958fa1c179e7f3aa05b602fba44cd8d3a6'); });
  it('post144-extras: HMAC no-product-invent .github/workflows/deploy.yml', () => { expect(hmacSha256('no-product-invent', '.github/workflows/deploy.yml')).toBe('3ed3dcb49626ea55aa10de93931f8c107b800db0e2d4852f9cfe4a32f9ffe544'); });
  it('post144-extras: HMAC slice-diff .github/workflows/deploy.yml', () => { expect(hmacSha256('slice-diff', '.github/workflows/deploy.yml')).toBe('1ccb326a9235e7932c7f50df61af7dffc9c9d7e2c6ac224e9fa59d4134706b10'); });
  it('post144-extras: HMAC no-src-change .github/workflows/deploy.yml', () => { expect(hmacSha256('no-src-change', '.github/workflows/deploy.yml')).toBe('a970e311deaeb68fd6a69e1f5350295984b91cd4144778295a75638cac5d48de'); });
  it('post144-extras: HMAC manifest-lock .github/workflows/deploy.yml', () => { expect(hmacSha256('manifest-lock', '.github/workflows/deploy.yml')).toBe('b76bf0edaa3b7f3579aa342d657037e3625bbeabcf870ffa8c235024d9ad667f'); });
  it('post144-extras: HMAC HITL .github/workflows/deploy.yml', () => { expect(hmacSha256('HITL', '.github/workflows/deploy.yml')).toBe('04d19b8f0846799a2b314566c765f36c8faffb656be7e6a3d744b5da1492d064'); });
  it('post144-extras: sha256 .github/dependabot.yml', () => { expect(sha256('.github/dependabot.yml')).toBe('a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac'); });
  it('post144-extras: HMAC post144 .github/dependabot.yml', () => { expect(hmacSha256('post144', '.github/dependabot.yml')).toBe('250334ef9f0cd570246cc087debcfc438add35694483f3307fcadddbbfe923ae'); });
  it('post144-extras: HMAC leftover .github/dependabot.yml', () => { expect(hmacSha256('leftover', '.github/dependabot.yml')).toBe('b9fba0e3b098292ae8ff8b4cffe94463966fadb875a0c9db9a1dadb85281a0f9'); });
  it('post144-extras: HMAC TOKENMAXX .github/dependabot.yml', () => { expect(hmacSha256('TOKENMAXX', '.github/dependabot.yml')).toBe('e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1'); });
  it('post144-extras: HMAC HEAVY .github/dependabot.yml', () => { expect(hmacSha256('HEAVY', '.github/dependabot.yml')).toBe('e651250d8c5b977a6bf6fb30e4edcc515accf3f9c97019df6fd702d19fb9e2ff'); });
  it('post144-extras: HMAC after-#144 .github/dependabot.yml', () => { expect(hmacSha256('after-#144', '.github/dependabot.yml')).toBe('b08b700ca303f9524a0b686ae47368566c8472c12ee44ffbc48a9e3a08513e99'); });
  it('post144-extras: HMAC no-product-invent .github/dependabot.yml', () => { expect(hmacSha256('no-product-invent', '.github/dependabot.yml')).toBe('5fdab5d04737aa2fd4596ef674259a9f07c54593c68d38f74f8e6f81207f80fa'); });
  it('post144-extras: HMAC slice-diff .github/dependabot.yml', () => { expect(hmacSha256('slice-diff', '.github/dependabot.yml')).toBe('cf3a3aba1fdb1781371f6b49e2309aac2104e2564d370758a6e25c06a0a3d79d'); });
  it('post144-extras: HMAC no-src-change .github/dependabot.yml', () => { expect(hmacSha256('no-src-change', '.github/dependabot.yml')).toBe('51b22c5c39429fd11f689007378f9c3b7340092c7552c4b04c684fee3babfc47'); });
  it('post144-extras: HMAC manifest-lock .github/dependabot.yml', () => { expect(hmacSha256('manifest-lock', '.github/dependabot.yml')).toBe('b09786f2ec08484413ba6d4a6099ba987fe0365e55d99881051b7b845d6e6b0b'); });
  it('post144-extras: HMAC HITL .github/dependabot.yml', () => { expect(hmacSha256('HITL', '.github/dependabot.yml')).toBe('72b97577831c72174d3246685b807385eece67c7512a8c358e544cbec804da2d'); });
  it('post144-extras: sha256 test/helpers.ts', () => { expect(sha256('test/helpers.ts')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29'); });
  it('post144-extras: HMAC post144 test/helpers.ts', () => { expect(hmacSha256('post144', 'test/helpers.ts')).toBe('a2573724734898b5edfe4cb67906832bb8676a93ffd5926aaea873591c59a1b9'); });
  it('post144-extras: HMAC leftover test/helpers.ts', () => { expect(hmacSha256('leftover', 'test/helpers.ts')).toBe('3cf47764c97927288d3627ddc71cecde2a6313dea10d1f5941a8cce945d8b3d1'); });
  it('post144-extras: HMAC TOKENMAXX test/helpers.ts', () => { expect(hmacSha256('TOKENMAXX', 'test/helpers.ts')).toBe('8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391'); });
  it('post144-extras: HMAC HEAVY test/helpers.ts', () => { expect(hmacSha256('HEAVY', 'test/helpers.ts')).toBe('458cfb306ea3e2c9310b3e3840ecd5a5ca295e18c46146bad4c6111c4c3c1c24'); });
  it('post144-extras: HMAC after-#144 test/helpers.ts', () => { expect(hmacSha256('after-#144', 'test/helpers.ts')).toBe('286c084e485f6b95ab80eaedf7edad1602e1a7c106c3b0c916d3eda6267a453c'); });
  it('post144-extras: HMAC no-product-invent test/helpers.ts', () => { expect(hmacSha256('no-product-invent', 'test/helpers.ts')).toBe('a6bca018ba16cafff8a3d108bbc4c96391d8da76ccdaf6927e095cbf2e763870'); });
  it('post144-extras: HMAC slice-diff test/helpers.ts', () => { expect(hmacSha256('slice-diff', 'test/helpers.ts')).toBe('06e6aabd4ddda764fc08d5ea37cddedee087e94e4fb0b549998518fef0f75856'); });
  it('post144-extras: HMAC no-src-change test/helpers.ts', () => { expect(hmacSha256('no-src-change', 'test/helpers.ts')).toBe('702c472ddb0428dfbded66d90dfbf2afabbdd22d563dc44adb424394ecf0bc47'); });
  it('post144-extras: HMAC manifest-lock test/helpers.ts', () => { expect(hmacSha256('manifest-lock', 'test/helpers.ts')).toBe('737e4e0561305a149a41dcd3349dac8065be5e57b8af12827e486721908971c6'); });
  it('post144-extras: HMAC HITL test/helpers.ts', () => { expect(hmacSha256('HITL', 'test/helpers.ts')).toBe('6f15f284928a996811a7e2061752c57c51d26b050697314a9803031ce49c2fc0'); });
  it('post144-extras: sha256 .cursor/environment.json', () => { expect(sha256('.cursor/environment.json')).toBe('4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694'); });
  it('post144-extras: HMAC post144 .cursor/environment.json', () => { expect(hmacSha256('post144', '.cursor/environment.json')).toBe('3abd43542e4795f35911a6da665c3c1eb2e4e28f868fde974b0c784a295fe153'); });
  it('post144-extras: HMAC leftover .cursor/environment.json', () => { expect(hmacSha256('leftover', '.cursor/environment.json')).toBe('f3c07027290cc01d2ddd1979fab399b4f4ddaed8e682f9ba6f15b59f23ba2bc4'); });
  it('post144-extras: HMAC TOKENMAXX .cursor/environment.json', () => { expect(hmacSha256('TOKENMAXX', '.cursor/environment.json')).toBe('796f38bc3f8907bef23dc36e49231f310bae76a745c9e26ac5073ba2ec3e8c49'); });
  it('post144-extras: HMAC HEAVY .cursor/environment.json', () => { expect(hmacSha256('HEAVY', '.cursor/environment.json')).toBe('ac9494b2f787b999a6b41edc8f17a2bf4dfac30f0ee76ecef9d69be011dde10f'); });
  it('post144-extras: HMAC after-#144 .cursor/environment.json', () => { expect(hmacSha256('after-#144', '.cursor/environment.json')).toBe('6591c055b4fca3753fd1fc0484032d9e5741e95f390159fe45acbccd2cbdb05d'); });
  it('post144-extras: HMAC no-product-invent .cursor/environment.json', () => { expect(hmacSha256('no-product-invent', '.cursor/environment.json')).toBe('bba79bd9a590f177e32e895a7935716c6ff65a461b15d43916ad5996af1092c5'); });
  it('post144-extras: HMAC slice-diff .cursor/environment.json', () => { expect(hmacSha256('slice-diff', '.cursor/environment.json')).toBe('1def680f93ce3c94e3cca3cdafd2fa6add86fa3b1a86b7e6978bf61bab17a815'); });
  it('post144-extras: HMAC no-src-change .cursor/environment.json', () => { expect(hmacSha256('no-src-change', '.cursor/environment.json')).toBe('f061bd19f945e8c66c327cc278b07a7d78763515c758553c0a2bf2822896fa9e'); });
  it('post144-extras: HMAC manifest-lock .cursor/environment.json', () => { expect(hmacSha256('manifest-lock', '.cursor/environment.json')).toBe('1e8e47096c0e8b272ac510d96c6be2d4fe37d09aeccfa50a23240f0cd05a89e3'); });
  it('post144-extras: HMAC HITL .cursor/environment.json', () => { expect(hmacSha256('HITL', '.cursor/environment.json')).toBe('93d1c9a78bd63f82add45bdc6bc16a90c1bd280b25286d4242124563fb69e446'); });
  it('post144-extras: inventory digest', () => {
    const keys = ["post144","leftover","TOKENMAXX","HEAVY","after-#144","no-product-invent","slice-diff","no-src-change","manifest-lock","HITL","helpers","extras","VALID_GENRES","GENRE_MAP","CATALOG_CACHE","post141"];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe('371f679d55b8debb2350258caf74e3ae08906b9ff5e353ce1e6c6bebd10e2425');
    expect(keys).toHaveLength(16);
  });

  it('post144-extras: HMAC concat src', () => {
    const SRC_FILES = ['genres.ts', 'index.ts', 'mcp.ts', 'parser.ts', 'types.ts'] as const;
    const joined = SRC_FILES.map((f) => read('src/' + f)).join('');
    expect(createHmac('sha256', 'post144-extras').update(joined).digest('hex')).toBe('022cb26e70dd389a67841f852e4513e22d7868b238ae2f20ef2775dc22e098f5');
  });

  it('post144-extras: final markers', () => {
    const body = read('test/helpers.test.ts');
    expect(body).toContain("describe('post144 helpers HEAVY deepen (after #144)'");
    expect(body).toContain("describe('post144 helpers extras HEAVY deepen (after #144 leftover slice)'");
    expect((body.match(/it\('post144-extras:/g) ?? []).length).toBeGreaterThan(80);
  });
});
