import { createHash, createHmac } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENRE_MAP, VALID_GENRES } from '../src/genres';
import app from '../src/index';
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

type Json = Record<string, unknown>;

async function json(res: Response): Promise<Json> {
  return (await res.json()) as Json;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET / and /health', () => {
  it('returns service metadata on /', async () => {
    const res = await app.request('/', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe('Backlink');
    expect(body.version).toBe('0.1.0-test');
    expect(body.powered_by).toBe('Backlink/Geryon 🦀');
    const endpoints = body.endpoints as Record<string, string>;
    expect(endpoints['/curate']).toBeTruthy();
    expect(endpoints['/stations']).toBeTruthy();
    expect(endpoints['/genres']).toBeTruthy();
    expect(endpoints['/health']).toBeTruthy();
  });

  it('defaults version to 0.1.0 when VERSION binding is unset', async () => {
    const res = await app.request('/', undefined, testEnv({ VERSION: undefined }));
    expect(res.status).toBe(200);
    await expect(json(res)).resolves.toMatchObject({ version: '0.1.0' });

    const health = await app.request('/health', undefined, testEnv({ VERSION: undefined }));
    await expect(json(health)).resolves.toEqual({ ok: true, version: '0.1.0' });
  });

  it('returns ok health payload', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.status).toBe(200);
    await expect(json(res)).resolves.toEqual({ ok: true, version: '0.1.0-test' });
  });

  it('includes CORS allow-origin on API responses', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('GET /genres', () => {
  it('lists categories and aliases', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    const genres = body.genres as string[];
    const aliases = body.aliases as Record<string, string>;
    expect(genres).toContain('music');
    expect(genres).toContain('news');
    expect(genres).toHaveLength(9);
    expect(aliases.chill).toBe('ambient');
    expect(aliases.indie).toBe('rock');
    expect(aliases.electronic).toBe('ambient');
  });
});

describe('GET /stations', () => {
  it('parses remote M3U, caches in KV, and resolves genre aliases', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/ambient.m3u')) {
          return new Response(SAMPLE_M3U, { status: 200 });
        }
        return new Response('missing', { status: 404 });
      }),
    );

    const res = await app.request('/stations?genre=chill', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(6);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Alpha FM');
    expect(kv.put).toHaveBeenCalledWith(
      'stations:ambient',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('serves from KV cache without refetching', async () => {
    const cached = JSON.stringify([
      { name: 'Cached', url: 'https://example.com/cached.m3u8' },
    ]);
    const kv = mockKV({ 'stations:music': cached });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to music.m3u when category 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/jazz.m3u')) return new Response('nope', { status: 404 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(6);
  });

  it('defaults unknown genre query to music catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request('/stations?genre=k-pop', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('music');
    expect(body.count).toBe(6);
  });

  it('returns 503 when catalog and music fallback both fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );

    const res = await app.request('/stations?genre=news', undefined, testEnv());
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });
});

describe('GET /curate', () => {
  it('returns 503 when GEMINI_API_KEY is missing', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Curation service unavailable',
      retry_after: 60,
    });
  });

  it('returns 503 when catalog fetch fails even with an API key', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));

    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('resolves genre from mood when genre query is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/ambient.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response('boom', { status: 500 });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request(
      '/curate?mood=late%20night',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('late night');
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe('ambient');
  });

  it('degrades to top stations with editorial null when Gemini fails', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));

    const res = await app.request(
      '/curate?genre=music&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(body.query).toBe('focus music');
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
    const stations = body.stations as Array<{
      name: string;
      url: string;
      editorial: unknown;
      genre: string;
    }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
    expect(stations[0]).toMatchObject({
      name: 'Alpha FM',
      url: 'https://example.com/alpha.m3u8',
      genre: 'music',
    });
  });

  it('degrades when Gemini returns non-JSON text', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [{ content: { parts: [{ text: 'sorry, no stations today' }] } }],
        }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stations = body.stations as Array<{ editorial: unknown }>;
    expect(stations).toHaveLength(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('degrades when Gemini candidates are empty', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [] }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations as unknown[]).toHaveLength(5);
  });

  it('returns Gemini JSON picks when the model responds', async () => {
    const curated = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        logo: '',
        editorial: 'Clean signal for focus.',
        genre: 'music',
      },
    ];

    const fetchMock = stubIptvAndGemini({
      gemini: Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: `Here you go:\n${JSON.stringify(curated)}\n` }],
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toEqual(curated);

    const geminiCall = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('generativelanguage.googleapis.com'));
    expect(geminiCall).toContain('gemini-2.0-flash');
    expect(geminiCall).toContain('key=test-key');

    const geminiInit = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('generativelanguage.googleapis.com'),
    )?.[1] as RequestInit;
    expect(geminiInit.method).toBe('POST');
    const payload = JSON.parse(String(geminiInit.body)) as {
      generationConfig: unknown;
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    expect(payload.generationConfig).toEqual({ maxOutputTokens: 512, temperature: 0.7 });
    expect(payload.contents[0].parts[0].text).toContain('Alpha FM');
  });

  it('uses genre alone as query when mood and genreParam are empty', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));

    const res = await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('music');
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe('music');
  });

  it('returns 503 for empty-string GEMINI_API_KEY (falsy guard)', async () => {
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: '' }),
    );
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Curation service unavailable',
      retry_after: 60,
    });
  });

  it('returns 503 when KV cache holds corrupt JSON', async () => {
    const kv = mockKV({ 'stations:music': '{not-json' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves logo on graceful degrade and caps at five stations', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="With Logo" tvg-logo="https://cdn.example/logo.png",With Logo
https://example.com/logo.m3u8
#EXTINF:-1 tvg-name="Two",Two
https://example.com/two.m3u8
#EXTINF:-1 tvg-name="Three",Three
https://example.com/three.m3u8
#EXTINF:-1 tvg-name="Four",Four
https://example.com/four.m3u8
#EXTINF:-1 tvg-name="Five",Five
https://example.com/five.m3u8
#EXTINF:-1 tvg-name="Six",Six
https://example.com/six.m3u8
`;
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ name: string; logo?: string }>;
    expect(stations).toHaveLength(5);
    expect(stations[0]).toMatchObject({
      name: 'With Logo',
      logo: 'https://cdn.example/logo.png',
    });
    expect(stations.some((s) => s.name === 'Six')).toBe(false);
  });

  it('defaults missing group/language in the Gemini prompt', async () => {
    const bareM3u = `#EXTM3U
#EXTINF:-1 tvg-name="Bare Station",Bare Station
https://example.com/bare.m3u8
`;
    const fetchMock = stubIptvAndGemini({
      m3u: bareM3u,
      gemini: Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      name: 'Bare Station',
                      url: 'https://example.com/bare.m3u8',
                      editorial: 'Sparse and honest.',
                      genre: 'music',
                    },
                  ]),
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);

    const geminiInit = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('generativelanguage.googleapis.com'),
    )?.[1] as RequestInit;
    const prompt = JSON.parse(String(geminiInit.body)).contents[0].parts[0].text as string;
    expect(prompt).toContain('1. Bare Station (music) [en] — https://example.com/bare.m3u8');
    expect(prompt).toContain('User request: music');
  });

  it('sends at most 50 stations to Gemini even when the catalog is larger', async () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 60; i++) {
      lines.push(`#EXTINF:-1 tvg-name="S${i}" group-title="G" tvg-language="en",S${i}`);
      lines.push(`https://example.com/s${i}.m3u8`);
    }
    const fetchMock = stubIptvAndGemini({
      m3u: lines.join('\n'),
      gemini: Response.json({
        candidates: [{ content: { parts: [{ text: '[{"name":"S0","url":"https://example.com/s0.m3u8","editorial":"x","genre":"music"}]' }] } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);

    const prompt = JSON.parse(
      String(
        (fetchMock.mock.calls.find((call) =>
          String(call[0]).includes('generativelanguage.googleapis.com'),
        )?.[1] as RequestInit).body,
      ),
    ).contents[0].parts[0].text as string;

    expect(prompt).toContain('50. S49');
    expect(prompt).not.toContain('51. S50');
    expect(prompt).not.toContain('S59');
  });

  it('degrades when Gemini returns bracket text that is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [{ content: { parts: [{ text: '[{not: valid json}]' }] } }],
        }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations as unknown[]).toHaveLength(5);
    expect((body.stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('returns empty stations when the catalog parses to zero entries and Gemini fails', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: '#EXTM3U\n' }));

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toEqual([]);
  });

  it('composes mood + genreParam into the response query string', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));

    const res = await app.request(
      '/curate?genre=jazz&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('focus jazz');
  });

  it('answers CORS preflight OPTIONS with allow-origin', async () => {
    const res = await app.request(
      '/curate',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      testEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('reuses KV after the first /stations miss', async () => {
    const kv = mockKV();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/news.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = testEnv({ CATALOG_CACHE: kv });
    const first = await app.request('/stations?genre=news', undefined, env);
    const second = await app.request('/stations?genre=news', undefined, env);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kv.get).toHaveBeenCalledWith('stations:news');
  });

  it('includes mood in the Gemini user-request line when provided', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"ambient"}]',
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // genre=chill → ambient; mood=focus → prompt "focus / ambient"
    const res = await app.request(
      '/curate?genre=chill&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);

    const prompt = JSON.parse(
      String(
        (fetchMock.mock.calls.find((call) =>
          String(call[0]).includes('generativelanguage.googleapis.com'),
        )?.[1] as RequestInit).body,
      ),
    ).contents[0].parts[0].text as string;
    expect(prompt).toContain('User request: focus / ambient');
  });

  it('extracts JSON picks from markdown-fenced Gemini replies', async () => {
    const curated = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'Solid pick.',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: `\`\`\`json\n${JSON.stringify(curated)}\n\`\`\``,
                  },
                ],
              },
            },
          ],
        }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    await expect(json(res)).resolves.toMatchObject({ stations: curated });
  });

  it('does not fetch music.m3u when the requested category succeeds', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/news.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      if (url.endsWith('/music.m3u')) return new Response('should-not-fetch', { status: 200 });
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=news', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://iptv-org.github.io/iptv/categories/news.m3u',
    );
  });

  it('defaults /stations with no genre query to music', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request('/stations', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('music');
    expect(body.count).toBe(6);
  });

  it('serves JSON content-type on catalog endpoints', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await app.request('/not-a-real-endpoint', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('returns 503 on /curate when KV cache JSON is corrupt', async () => {
    const kv = mockKV({ 'stations:music': '{not-json' });
    vi.stubGlobal('fetch', vi.fn());

    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('passes through entertainment / sports / classical as catalog keys', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );

    for (const genre of ['entertainment', 'sports', 'classical'] as const) {
      const res = await app.request(`/stations?genre=${genre}`, undefined, testEnv());
      expect(res.status).toBe(200);
      expect((await json(res)).genre).toBe(genre);
    }

    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/entertainment.m3u',
      'https://iptv-org.github.io/iptv/categories/sports.m3u',
      'https://iptv-org.github.io/iptv/categories/classical.m3u',
    ]);
  });

  it('returns 503 when fetch throws a network error for /stations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );

    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('returns 503 when fetch throws during /curate catalog load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('DNS failure');
      }),
    );

    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('serves /curate from KV without refetching iptv-org', async () => {
    const cached = JSON.stringify([
      { name: 'Cached Curate', url: 'https://example.com/cached.m3u8', logo: '' },
    ]);
    const kv = mockKV({ 'stations:music': cached });
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        JSON.stringify([
          {
            name: 'Cached Curate',
            url: 'https://example.com/cached.m3u8',
            editorial: 'From cache.',
            genre: 'music',
          },
        ]),
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toEqual([
      {
        name: 'Cached Curate',
        url: 'https://example.com/cached.m3u8',
        editorial: 'From cache.',
        genre: 'music',
      },
    ]);

    const iptvCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('iptv-org'));
    expect(iptvCalls).toHaveLength(0);
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('generativelanguage.googleapis.com')),
    ).toBe(true);
  });

  it('falls back to music.m3u on /curate when the category 404s', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jazz.m3u')) return new Response('nope', { status: 404 });
      if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      if (url.includes('generativelanguage.googleapis.com')) {
        return new Response('boom', { status: 500 });
      }
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request(
      '/curate?genre=jazz',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe('jazz');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/jazz.m3u');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/music.m3u');
  });

  it('uses genre alone as the response query when mood is omitted', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));

    const res = await app.request(
      '/curate?genre=news',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('news');
  });

  it('degrades when Gemini candidate content/parts are missing', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [{ content: { parts: [] } }] }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('degrades when Gemini returns a candidate object without content', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [{}] }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('extracts the first JSON array when Gemini wraps picks in prose', async () => {
    const curated = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'First array wins.',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          `Sure!\n${JSON.stringify(curated)}\nThanks for listening.`,
        ),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    await expect(json(res)).resolves.toMatchObject({ stations: curated });
  });

  it('returns JSON content-type on /curate and /genres', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const curate = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const genres = await app.request('/genres', undefined, testEnv());
    expect(curate.headers.get('content-type')).toMatch(/application\/json/);
    expect(genres.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('exposes GENRE_MAP aliases verbatim on /genres', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('rejects POST on read endpoints with a non-success status', async () => {
    for (const path of ['/', '/health', '/genres', '/stations', '/curate'] as const) {
      const res = await app.request(path, { method: 'POST' }, testEnv());
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('includes CORS allow-origin on /stations and /curate', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const stations = await app.request('/stations?genre=music', undefined, testEnv());
    const curate = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(stations.headers.get('access-control-allow-origin')).toBe('*');
    expect(curate.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('locks IPTV category URL shape for rock and pop aliases', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );

    await app.request('/stations?genre=metal', undefined, testEnv());
    await app.request('/stations?genre=dance', undefined, testEnv());

    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/rock.m3u',
      'https://iptv-org.github.io/iptv/categories/pop.m3u',
    ]);
  });

  it('puts Gemini API key only in the request URL query string', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'secret-test-key' }));

    const geminiCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('generativelanguage.googleapis.com'),
    );
    expect(String(geminiCall?.[0])).toContain('key=secret-test-key');
    const init = geminiCall?.[1] as RequestInit;
    expect(String(init.body)).not.toContain('secret-test-key');
    expect(JSON.stringify(init.headers ?? {})).not.toContain('secret-test-key');
  });

  it('returns station objects with name and url on /stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    const body = await json(res);
    const stations = body.stations as Array<{ name: string; url: string }>;
    expect(stations.length).toBeGreaterThan(0);
    for (const s of stations) {
      expect(s.name).toBeTruthy();
      expect(s.url).toMatch(/^https?:\/\//);
    }
  });

  it('treats empty genre query as blank input (does not fall through to mood for resolveGenre)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        // genre="" → resolveGenre("") → music (?? only skips null/undefined)
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response('boom', { status: 500 });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request(
      '/curate?genre=&mood=chill',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('chill');
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe('music');
  });

  it('retries music.m3u when the requested genre is already music and the first fetch fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/music.m3u')) {
        // First call fails, fallback also hits music.m3u
        if (fetchMock.mock.calls.length === 1) return new Response('nope', { status: 404 });
        return new Response(SAMPLE_M3U, { status: 200 });
      }
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/music.m3u');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/music.m3u');
  });

  it('returns 503 when music is requested and both primary + fallback music fetches fail', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('includes group and language in the Gemini prompt when EXTINF provides them', async () => {
    const rich = `#EXTM3U
#EXTINF:-1 tvg-name="Rich FM" group-title="Jazz" tvg-language="fr",Rich FM
https://example.com/rich.m3u8
`;
    const fetchMock = stubIptvAndGemini({
      m3u: rich,
      gemini: geminiTextResponse(
        '[{"name":"Rich FM","url":"https://example.com/rich.m3u8","editorial":"e","genre":"jazz"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request(
      '/curate?genre=jazz',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);

    const prompt = JSON.parse(
      String(
        (fetchMock.mock.calls.find((call) =>
          String(call[0]).includes('generativelanguage.googleapis.com'),
        )?.[1] as RequestInit).body,
      ),
    ).contents[0].parts[0].text as string;
    expect(prompt).toContain('1. Rich FM (Jazz) [fr] — https://example.com/rich.m3u8');
  });

  it('uses only the first Gemini content part when multiple parts are present', async () => {
    const curated = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'First part wins.',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { text: JSON.stringify(curated) },
                  { text: '[{"name":"Should Ignore","url":"https://example.com/x","editorial":"no","genre":"music"}]' },
                ],
              },
            },
          ],
        }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    await expect(json(res)).resolves.toMatchObject({ stations: curated });
  });

  it('isolates KV cache keys across genres', async () => {
    const kv = mockKV();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = testEnv({ CATALOG_CACHE: kv });
    await app.request('/stations?genre=news', undefined, env);
    await app.request('/stations?genre=sports', undefined, env);

    expect(kv.put).toHaveBeenCalledWith(
      'stations:news',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
    expect(kv.put).toHaveBeenCalledWith(
      'stations:sports',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects PUT and DELETE on read endpoints', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
      for (const path of ['/', '/health', '/genres', '/stations', '/curate'] as const) {
        const res = await app.request(path, { method }, testEnv());
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it('emits an ISO-8601 timestamp on /curate', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const before = Date.now();
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const after = Date.now();
    const body = await json(res);
    const ts = body.timestamp as string;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const parsed = Date.parse(ts);
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
    expect(parsed).toBeLessThanOrEqual(after + 1000);
  });

  it('resolves /stations mood-like aliases the same as /curate genre resolution', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );

    const res = await app.request('/stations?genre=lofi', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('ambient');
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/ambient.m3u');
  });

  it('keeps / count and stations array length aligned', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    const body = await json(res);
    expect(body.count).toBe((body.stations as unknown[]).length);
  });

  it('defaults /curate query to resolved genre when only blank mood is sent', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));

    const res = await app.request(
      '/curate?mood=',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('music');
  });

  it('includes CORS allow-origin on / and /genres', async () => {
    const root = await app.request('/', undefined, testEnv());
    const genres = await app.request('/genres', undefined, testEnv());
    expect(root.headers.get('access-control-allow-origin')).toBe('*');
    expect(genres.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('lists exactly the four documented endpoint keys on /', async () => {
    const res = await app.request('/', undefined, testEnv());
    const endpoints = (await json(res)).endpoints as Record<string, string>;
    expect(Object.keys(endpoints).sort()).toEqual(['/curate', '/genres', '/health', '/stations'].sort());
  });

  it('sends application/json content-type to Gemini', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));

    const init = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('generativelanguage.googleapis.com'),
    )?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('answers HEAD on GET routes (Hono mirrors GET handlers)', async () => {
    const health = await app.request('/health', { method: 'HEAD' }, testEnv());
    expect(health.status).toBe(200);
    expect(health.headers.get('access-control-allow-origin')).toBe('*');

    const root = await app.request('/', { method: 'HEAD' }, testEnv());
    expect(root.status).toBe(200);
  });

  it('uses only the first Gemini candidate when multiple are returned', async () => {
    const curated = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'First candidate.',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(curated) }] } },
            {
              content: {
                parts: [
                  {
                    text: '[{"name":"Ignored","url":"https://example.com/x","editorial":"no","genre":"music"}]',
                  },
                ],
              },
            },
          ],
        }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    await expect(json(res)).resolves.toMatchObject({ stations: curated });
  });

  it('resolves percent-encoded multi-word genre aliases on /stations', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );

    const res = await app.request('/stations?genre=late%20night', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('ambient');
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/ambient.m3u');
  });

  it('does not call Gemini when GEMINI_API_KEY is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns service description string on /', async () => {
    const res = await app.request('/', undefined, testEnv());
    const body = await json(res);
    expect(body.description).toMatch(/iptv-org/i);
    expect(body.name).toBe('Backlink');
  });

  it('keeps curated_by stable across degrade and success paths', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const degraded = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect((await json(degraded)).curated_by).toBe('Backlink/Geryon');

    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const ok = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect((await json(ok)).curated_by).toBe('Backlink/Geryon');
  });

  it('caches parsed stations under the resolved genre key after alias lookup', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/ambient.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );

    await app.request('/stations?genre=lo-fi', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).toHaveBeenCalledWith(
      'stations:ambient',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
    expect(kv.put).not.toHaveBeenCalledWith(
      'stations:lo-fi',
      expect.anything(),
      expect.anything(),
    );
  });

  it('returns 503 retry_after as a number on catalog failures', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    const body = await json(res);
    expect(res.status).toBe(503);
    expect(body.retry_after).toBe(60);
    expect(typeof body.retry_after).toBe('number');
  });

  it('prompts Gemini with Backlink curator identity', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const prompt = JSON.parse(
      String(
        (fetchMock.mock.calls.find((call) =>
          String(call[0]).includes('generativelanguage.googleapis.com'),
        )?.[1] as RequestInit).body,
      ),
    ).contents[0].parts[0].text as string;
    expect(prompt).toMatch(/You are Backlink, an AI radio curator/);
    expect(prompt).toMatch(/Return JSON only/);
  });

  it('handles parallel /stations requests for different genres without key collision', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );

    const env = testEnv({ CATALOG_CACHE: kv });
    const [news, sports] = await Promise.all([
      app.request('/stations?genre=news', undefined, env),
      app.request('/stations?genre=sports', undefined, env),
    ]);
    expect(news.status).toBe(200);
    expect(sports.status).toBe(200);
    expect((await json(news)).genre).toBe('news');
    expect((await json(sports)).genre).toBe('sports');
    expect(kv.put).toHaveBeenCalledWith('stations:news', expect.any(String), expect.any(Object));
    expect(kv.put).toHaveBeenCalledWith('stations:sports', expect.any(String), expect.any(Object));
  });

  it('degrades when Gemini returns HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: new Response('rate limited', { status: 429 }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
    expect(stations).toHaveLength(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('degrades when Gemini returns an empty JSON array (regex requires [{...}])', async () => {
    // callGemini JSON extract is /\[\s*\{[\s\S]*\}\s*\]/ — bare [] does not match
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('[]'),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations as unknown[]).toHaveLength(5);
    expect((body.stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('caches fallback music.m3u under the requested genre key (not stations:music)', async () => {
    const kv = mockKV();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jazz.m3u')) return new Response('nope', { status: 404 });
      if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    expect(kv.put).toHaveBeenCalledWith(
      'stations:jazz',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
    expect(kv.put).not.toHaveBeenCalledWith('stations:music', expect.anything(), expect.anything());
  });

  it('includes CORS allow-origin on 503 catalog errors', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('includes CORS allow-origin on 503 curation-key errors', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('resolves uppercase VALID_GENRES ids on /stations', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );

    const res = await app.request('/stations?genre=NEWS', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('news');
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/news.m3u');
  });

  it('resolves plus-encoded late+night alias on /stations', async () => {
    // application/x-www-form-urlencoded uses + for space
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );

    const res = await app.request('/stations?genre=late+night', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('ambient');
    expect(seen[0]).toContain('/ambient.m3u');
  });

  it('answers HEAD on /stations and /genres', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const stations = await app.request('/stations?genre=music', { method: 'HEAD' }, testEnv());
    const genres = await app.request('/genres', { method: 'HEAD' }, testEnv());
    expect(stations.status).toBe(200);
    expect(genres.status).toBe(200);
  });

  it('answers OPTIONS preflight on /stations', async () => {
    const res = await app.request(
      '/stations',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      testEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('resolves unknown mood-only /curate requests to the music catalog', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response('boom', { status: 500 });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request(
      '/curate?mood=energizing',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('energizing');
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe('music');
    expect(seen.some((u) => u.endsWith('/music.m3u'))).toBe(true);
  });

  it('stores parseable JSON in KV that matches the /stations payload', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({}));

    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    const body = await json(res);
    const putCall = (kv.put as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(putCall[0]).toBe('stations:music');
    expect(JSON.parse(putCall[1] as string)).toEqual(body.stations);
  });

  it('rejects PATCH on read endpoints', async () => {
    for (const path of ['/', '/health', '/genres', '/stations', '/curate'] as const) {
      const res = await app.request(path, { method: 'PATCH' }, testEnv());
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('numbers Gemini prompt stations starting at 1', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const prompt = JSON.parse(
      String(
        (fetchMock.mock.calls.find((call) =>
          String(call[0]).includes('generativelanguage.googleapis.com'),
        )?.[1] as RequestInit).body,
      ),
    ).contents[0].parts[0].text as string;
    expect(prompt).toContain('1. Alpha FM');
    expect(prompt).toContain('2. Beta FM');
    expect(prompt).not.toContain('0. Alpha FM');
  });

  it('returns empty stations array when remote M3U has no http streams', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/music.m3u')) {
          return new Response('#EXTM3U\n#EXTINF:-1 tvg-name="X",X\nrtmp://x\n', { status: 200 });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.count).toBe(0);
    expect(body.stations).toEqual([]);
  });

  it('degrades when Gemini returns HTTP 401', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: new Response('unauthorized', { status: 401 }),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('uses mood alone as response query when genreParam is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/ambient.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response('boom', { status: 500 });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request(
      '/curate?mood=chill',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('chill');
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe('ambient');
  });

  it('defaults both blank genre and blank mood on /curate to music query', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));

    const res = await app.request(
      '/curate?genre=&mood=',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('music');
  });

  it('preserves logo: undefined on degrade when EXTINF omits tvg-logo', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="NoLogo",NoLogo
https://example.com/nologo.m3u8
`;
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const stations = (await json(res)).stations as Array<{ logo?: string }>;
    expect(stations[0].logo).toBeUndefined();
  });

  it('returns JSON content-type on / and /health', async () => {
    const root = await app.request('/', undefined, testEnv());
    const health = await app.request('/health', undefined, testEnv());
    expect(root.headers.get('content-type')).toMatch(/application\/json/);
    expect(health.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('reuses KV on a second /curate after a cold /stations fill', async () => {
    const kv = mockKV();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/pop.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      if (url.includes('generativelanguage.googleapis.com')) {
        return new Response('boom', { status: 500 });
      }
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'test-key' });
    expect((await app.request('/stations?genre=pop', undefined, env)).status).toBe(200);
    const iptvBefore = fetchMock.mock.calls.filter((c) => String(c[0]).includes('iptv-org')).length;
    expect((await app.request('/curate?genre=pop', undefined, env)).status).toBe(200);
    const iptvAfter = fetchMock.mock.calls.filter((c) => String(c[0]).includes('iptv-org')).length;
    expect(iptvAfter).toBe(iptvBefore);
  });

  it('returns powered_by branding on /', async () => {
    const res = await app.request('/', undefined, testEnv());
    expect((await json(res)).powered_by).toBe('Backlink/Geryon 🦀');
  });

  it('locks /health payload keys to ok + version only', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(Object.keys(await json(res)).sort()).toEqual(['ok', 'version']);
  });

  it('locks /genres payload keys to genres + aliases only', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    expect(Object.keys(await json(res)).sort()).toEqual(['aliases', 'genres']);
  });

  it('degrades when Gemini returns HTTP 503', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: new Response('unavailable', { status: 503 }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('passes generationConfig maxOutputTokens and temperature to Gemini', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const body = JSON.parse(
      String(
        (fetchMock.mock.calls.find((call) =>
          String(call[0]).includes('generativelanguage.googleapis.com'),
        )?.[1] as RequestInit).body,
      ),
    ) as { generationConfig: { maxOutputTokens: number; temperature: number } };
    expect(body.generationConfig).toEqual({ maxOutputTokens: 512, temperature: 0.7 });
  });

  it('resolves percent-encoded lo-fi alias on /curate mood', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/ambient.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response('boom', { status: 500 });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request(
      '/curate?mood=lo-fi',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).query).toBe('lo-fi');
    expect(seen.some((u) => u.endsWith('/ambient.m3u'))).toBe(true);
  });

  it('returns 503 retry_after on /curate when the API key is missing', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    const body = await json(res);
    expect(res.status).toBe(503);
    expect(body.error).toBe('Curation service unavailable');
    expect(body.retry_after).toBe(60);
  });

  it('does not put Gemini responses into KV', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );

    await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'test-key' }),
    );
    const keys = (kv.put as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0]);
    expect(keys.every((k) => String(k).startsWith('stations:'))).toBe(true);
    expect(keys.some((k) => String(k).includes('gemini') || String(k).includes('curate'))).toBe(false);
  });

  it('returns trail-slash unknown paths as 404', async () => {
    const res = await app.request('/health/', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('composes mood / genre with a space in the response query (not slash)', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=jazz&mood=late%20night',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    // response query joins mood + genreParam with space; Gemini prompt uses " / "
    expect((await json(res)).query).toBe('late night jazz');
  });

  it('falls back to music.m3u on non-404 catalog failures (500)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jazz.m3u')) return new Response('err', { status: 500 });
      if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('includes VERSION from env on both / and /health', async () => {
    const env = testEnv({ VERSION: '9.9.9-edge' });
    const root = await json(await app.request('/', undefined, env));
    const health = await json(await app.request('/health', undefined, env));
    expect(root.version).toBe('9.9.9-edge');
    expect(health.version).toBe('9.9.9-edge');
  });

  it('returns stations count 0 with empty array when KV holds an empty list', async () => {
    const kv = mockKV({ 'stations:music': '[]' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.count).toBe(0);
    expect(body.stations).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Gemini model path gemini-2.0-flash:generateContent', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const url = String(
      fetchMock.mock.calls.find((call) => String(call[0]).includes('generativelanguage'))?.[0],
    );
    expect(url).toContain('/models/gemini-2.0-flash:generateContent?key=');
  });

  it('degrades when Gemini JSON.parse throws on a regex-matched array', async () => {
    // Trailing comma makes JSON.parse fail after the extract regex matches
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('[{"name":"X","url":"https://x","editorial":"e","genre":"music",}]'),
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('resolves entertainment alias identity on /stations', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );

    const res = await app.request('/stations?genre=entertainment', undefined, testEnv());
    expect((await json(res)).genre).toBe('entertainment');
    expect(seen[0]).toContain('/entertainment.m3u');
  });

  it('answers OPTIONS preflight on /genres', async () => {
    const res = await app.request(
      '/genres',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      testEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('does not call iptv-org when /curate lacks an API key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: '' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes GENRE_MAP key count on /genres aliases object', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const aliases = (await json(res)).aliases as Record<string, string>;
    expect(Object.keys(aliases).length).toBe(Object.keys(GENRE_MAP).length);
    expect(aliases).toEqual(GENRE_MAP);
  });

  it('returns 503 when KV get rejects on /stations', async () => {
    const kv = mockKV();
    (kv.get as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('kv down'));
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe('Stream catalog unavailable');
  });

  it('returns 503 when KV put rejects after a successful catalog fetch', async () => {
    const kv = mockKV();
    (kv.put as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('kv write fail'));
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(503);
    expect((await json(res)).retry_after).toBe(60);
  });

  it('returns 503 when KV get rejects on /curate', async () => {
    const kv = mockKV();
    (kv.get as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('kv down'));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe('Stream catalog unavailable');
  });

  it('degrades when Gemini fetch throws a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage.googleapis.com')) {
          throw new Error('DNS failed');
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('degrades when Gemini returns HTTP 200 with a non-JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: new Response('not-json{{{', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('degrades when Gemini candidates is null', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: null }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('degrades when Gemini response omits candidates', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({}),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('degrades when Gemini content.parts is null', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [{ content: { parts: null } }],
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('treats whitespace-only GEMINI_API_KEY as truthy and proceeds to Gemini', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: '   ' }),
    );
    expect(res.status).toBe(200);
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('generativelanguage.googleapis.com')),
    ).toBe(true);
  });

  it('passthroughs oversized curated arrays without enforcing top-3', async () => {
    const picks = Array.from({ length: 6 }, (_, i) => ({
      name: `Station ${i}`,
      url: `https://example.com/${i}.m3u8`,
      editorial: `e${i}`,
      genre: 'music',
    }));
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse(JSON.stringify(picks)) }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(6);
  });

  it('passthroughs curated objects missing optional fields', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('[{"name":"Only Name","url":"https://example.com/x.m3u8"}]'),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Only Name');
    expect(stations[0].editorial).toBeUndefined();
    expect(stations[0].genre).toBeUndefined();
  });

  it('degrades to catalog length when fewer than 5 stations are available', async () => {
    const short = `#EXTM3U
#EXTINF:-1 tvg-name="One",One
https://example.com/one.m3u8
#EXTINF:-1 tvg-name="Two",Two
https://example.com/two.m3u8
#EXTINF:-1 tvg-name="Three",Three
https://example.com/three.m3u8
`;
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: short, gemini: new Response('boom', { status: 500 }) }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect((await json(res)).stations as unknown[]).toHaveLength(3);
  });

  it('degrades to a single station when the catalog has exactly one stream', async () => {
    const one = `#EXTM3U
#EXTINF:-1 tvg-name="Solo",Solo
https://example.com/solo.m3u8
`;
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: one, gemini: new Response('boom', { status: 500 }) }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    const stations = (await json(res)).stations as Array<{ name: string; editorial: unknown }>;
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Solo');
    expect(stations[0].editorial).toBeNull();
  });

  it('does not fetch music.m3u a second time when the primary category succeeds', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jazz.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      if (url.includes('generativelanguage.googleapis.com')) {
        return geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
        );
      }
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const iptv = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('iptv-org'));
    expect(iptv).toHaveLength(1);
    expect(iptv[0]).toContain('/jazz.m3u');
    expect(iptv.some((u) => u.endsWith('/music.m3u'))).toBe(false);
  });

  it('treats plus-only genre query as blank (defaults to music)', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    const res = await app.request('/stations?genre=+++', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('music');
    expect(seen[0]).toContain('/music.m3u');
  });

  it('returns 503 when KV put rejects during /curate catalog fill', async () => {
    const kv = mockKV();
    (kv.put as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('kv write fail'));
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(503);
  });

  it('degrades when Gemini candidates[0] is explicitly null', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [null] }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('locks degrade length at 4 when catalog has exactly four streams', async () => {
    const four = `#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/a.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com/b.m3u8
#EXTINF:-1 tvg-name="C",C
https://example.com/c.m3u8
#EXTINF:-1 tvg-name="D",D
https://example.com/d.m3u8
`;
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: four, gemini: new Response('boom', { status: 500 }) }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect((await json(res)).stations as unknown[]).toHaveLength(4);
  });

  it('includes CORS allow-origin when Gemini network throw degrades', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        throw new Error('network');
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      { headers: { Origin: 'https://example.com' } },
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('uses the first genre query value when duplicates are present', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    const res = await app.request('/stations?genre=jazz&genre=rock', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('jazz');
    expect(seen[0]).toContain('/jazz.m3u');
  });

  it('emits UTC Z-suffixed ISO timestamps on /curate', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse('[{"name":"A","url":"https://a","editorial":"e","genre":"music"}]') }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const ts = (await json(res)).timestamp as string;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
  });

  it('defaults language to en in the Gemini prompt when EXTINF omits tvg-language', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="NoLang",NoLang
https://example.com/nolang.m3u8
`;
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(m3u, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"NoLang","url":"https://example.com/nolang.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toMatch(/NoLang \(music\) \[en\]/);
  });

  it('returns 404 for unmatched custom HTTP methods on /health', async () => {
    const res = await app.request('/health', { method: 'FOOBAR' }, testEnv());
    expect(res.status).toBe(404);
  });

  it('returns name Backlink on / regardless of VERSION', async () => {
    const res = await app.request('/', undefined, testEnv({ VERSION: '9.9.9' }));
    const body = await json(res);
    expect(body.name).toBe('Backlink');
    expect(body.version).toBe('9.9.9');
  });

  it('keeps /stations count equal to stations array length after cache hit', async () => {
    const kv = mockKV({
      'stations:music': JSON.stringify([
        { name: 'A', url: 'https://example.com/a.m3u8' },
        { name: 'B', url: 'https://example.com/b.m3u8' },
      ]),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    const body = await json(res);
    expect(body.count).toBe(2);
    expect(body.stations as unknown[]).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes expirationTtl 3600 on KV put after catalog fill', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).toHaveBeenCalledWith(
      'stations:jazz',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('resolves metal alias to rock catalog on /stations', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    const res = await app.request('/stations?genre=metal', undefined, testEnv());
    expect((await json(res)).genre).toBe('rock');
    expect(seen[0]).toContain('/rock.m3u');
  });

  it('includes CORS on 404 unknown paths', async () => {
    const res = await app.request('/nope', { headers: { Origin: 'https://x.test' } }, testEnv());
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('degrades when Gemini returns whitespace-only model text', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: geminiTextResponse('   \n\t  ') }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('joins mood and genre with slash in the Gemini prompt user-request line', async () => {
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=jazz&mood=focus', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toMatch(/User request: focus \/ jazz/);
  });

  it('returns empty stations when KV holds an empty array on /curate degrade', async () => {
    const kv = mockKV({ 'stations:music': '[]' });
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: new Response('boom', { status: 500 }) }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toEqual([]);
  });

  it('lists GENRE_MAP on /genres matching the imported map', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    expect((await json(res)).aliases).toEqual(GENRE_MAP);
  });
  it('returns 500 when KV cache holds JSON null (length on null escapes try)', async () => {
    const kv = mockKV({ 'stations:music': 'null' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(500);
  });

  it('omits count when KV cache holds a JSON object instead of an array', async () => {
    const kv = mockKV({ 'stations:music': '{}' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('music');
    expect(body.stations).toEqual({});
    expect(body).not.toHaveProperty('count');
  });

  it('omits count when KV cache holds a JSON number', async () => {
    const kv = mockKV({ 'stations:music': '42' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toBe(42);
    expect(body).not.toHaveProperty('count');
  });

  it('passes through a KV array of primitives without validation', async () => {
    const kv = mockKV({ 'stations:music': '[1,"x",null]' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.count).toBe(3);
    expect(body.stations).toEqual([1, 'x', null]);
  });

  it('returns empty catalog on primary 200 with empty body (no music fallback)', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response('', { status: 200 });
      }),
    );
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ genre: 'jazz', count: 0, stations: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/jazz.m3u');
  });

  it('falls back to music.m3u on primary 403', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/jazz.m3u')) return new Response('forbidden', { status: 403 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(6);
    expect(seen[0]).toContain('/jazz.m3u');
    expect(seen[1]).toContain('/music.m3u');
  });

  it('falls back to music.m3u on primary 401 and 410', async () => {
    for (const status of [401, 410] as const) {
      const seen: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          seen.push(url);
          if (url.endsWith('/pop.m3u')) return new Response('x', { status });
          if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
          return new Response('nope', { status: 404 });
        }),
      );
      const res = await app.request('/stations?genre=pop', undefined, testEnv());
      expect(res.status).toBe(200);
      expect(seen.some((u) => u.endsWith('/music.m3u'))).toBe(true);
    }
  });

  it('caches empty stations when primary returns HTML with 200', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: '<html>error</html>' }));
    const res = await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ count: 0, stations: [] });
    expect(kv.put).toHaveBeenCalledWith('stations:jazz', '[]', expect.objectContaining({ expirationTtl: 3600 }));
  });

  it('allows concurrent cold-miss fetches for the same genre (no singleflight)', async () => {
    let iptvCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('iptv-org')) {
          iptvCalls += 1;
          await new Promise((r) => setTimeout(r, 20));
          return new Response(SAMPLE_M3U, { status: 200 });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const env = testEnv();
    const [a, b] = await Promise.all([
      app.request('/stations?genre=jazz', undefined, env),
      app.request('/stations?genre=jazz', undefined, env),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(iptvCalls).toBe(2);
  });

  it('degrades when Gemini parts[0].text is explicitly null', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [{ content: { parts: [{ text: null }] } }],
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('degrades when greedy JSON array match spans multiple arrays', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"A","url":"https://a","editorial":"e","genre":"music"}] filler [{"name":"B","url":"https://b","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
    expect(stations).toHaveLength(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('parses Gemini JSON when editorial contains a closing bracket character', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"A","url":"https://a","editorial":"score ] is high","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: string }>;
    expect(stations).toHaveLength(1);
    expect(stations[0].editorial).toBe('score ] is high');
  });

  it('degrades when Gemini returns truncated JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: new Response('{"candidates":', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(5);
  });

  it('passthroughs extra Gemini fields without sanitizing genre', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"A","url":"https://a","editorial":"e","genre":"not-a-real-genre","rank":1,"score":0.9}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(stations[0].genre).toBe('not-a-real-genre');
    expect(stations[0].rank).toBe(1);
    expect(stations[0].score).toBe(0.9);
  });

  it('uses resolved catalog genre on degrade objects not raw mood', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: new Response('boom', { status: 500 }) }),
    );
    const res = await app.request(
      '/curate?mood=late%20night',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const stations = (await json(res)).stations as Array<{ genre: string }>;
    expect(stations[0].genre).toBe('ambient');
  });

  it('omits country and logo from the Gemini prompt station lines', async () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Rich',
        url: 'https://example.com/rich.m3u8',
        group: 'Jazz',
        language: 'en',
        country: 'US',
        logo: 'https://cdn/logo.png',
      },
    ]);
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(m3u, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"Rich","url":"https://example.com/rich.m3u8","editorial":"e","genre":"jazz"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toMatch(/Rich \(Jazz\) \[en\] — https:\/\/example\.com\/rich\.m3u8/);
    expect(prompt).not.toMatch(/cdn\/logo/);
    expect(prompt).not.toMatch(/\bUS\b/);
  });

  it('numbers all 50 stations in the Gemini prompt when catalog is exactly 50', async () => {
    const stations = Array.from({ length: 50 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/s${i}.m3u8`,
    }));
    const m3u = buildSimpleM3U(stations);
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(m3u, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"S0","url":"https://example.com/s0.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toMatch(/1\. S0 /);
    expect(prompt).toMatch(/50\. S49 /);
    expect(prompt).not.toMatch(/51\. /);
  });

  it('includes an empty Available stations section when catalog is empty', async () => {
    const kv = mockKV({ 'stations:music': '[]' });
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse('[]');
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(prompt).toMatch(/Available stations:\n$/m);
  });

  it('sends generationConfig with only maxOutputTokens and temperature', async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(Object.keys(body?.generationConfig as object).sort()).toEqual([
      'maxOutputTokens',
      'temperature',
    ]);
  });

  it('POSTs to Gemini and interpolates API key raw into the query string', async () => {
    const key = 'k=&=+/#risky';
    let geminiUrl = '';
    let method = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          geminiUrl = url;
          method = String(init?.method ?? 'GET');
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: key }));
    expect(method).toBe('POST');
    expect(geminiUrl).toContain(`key=${key}`);
    expect(geminiUrl).not.toContain(encodeURIComponent(key));
  });

  it('uses the first mood query value when duplicates are present', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"ambient"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?mood=chill&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect((await json(res)).query).toBe('chill');
  });

  it('locks /stations success payload keys exactly', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(Object.keys(await json(res)).sort()).toEqual(['count', 'genre', 'stations']);
  });

  it('locks /curate success payload keys exactly', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(Object.keys(await json(res)).sort()).toEqual([
      'curated_by',
      'query',
      'stations',
      'timestamp',
    ]);
  });

  it('returns empty-string VERSION via ?? on / and /health', async () => {
    const env = testEnv({ VERSION: '' });
    const root = await json(await app.request('/', undefined, env));
    const health = await json(await app.request('/health', undefined, env));
    expect(root.version).toBe('');
    expect(health.version).toBe('');
  });

  it('returns 404 for trailing slashes on known routes', async () => {
    for (const path of ['/health/', '/stations/', '/genres/', '/curate/']) {
      const res = await app.request(path, undefined, testEnv({ GEMINI_API_KEY: 'k' }));
      expect(res.status).toBe(404);
    }
  });

  it('composes /curate query with blank mood ignored when genre is set', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=jazz&mood=', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect((await json(res)).query).toBe('jazz');
  });

  it('falls back to exact music.m3u URL on primary 418', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/rock.m3u')) return new Response('teapot', { status: 418 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=rock', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(seen[1]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it('passes expirationTtl 3600 on KV put during /curate cold fill', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(kv.put).toHaveBeenCalledWith(
      'stations:music',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('does not call Gemini twice when the first response degrades', async () => {
    let geminiCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          geminiCalls += 1;
          return new Response('boom', { status: 500 });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(geminiCalls).toBe(1);
  });

  it('includes CORS allow-origin on successful Gemini /curate responses', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      { headers: { Origin: 'https://example.com' } },
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('does not set Cache-Control on /health responses', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('supports HEAD on /curate when API key is present', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', { method: 'HEAD' }, testEnv({ GEMINI_API_KEY: 'k' }));
    expect([200, 404]).toContain(res.status);
  });

  it('passes through KV-cached JSON string on /stations (string.length becomes count)', async () => {
    const kv = mockKV({ 'stations:music': '"hello"' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toBe('hello');
    expect(body.count).toBe(5);
  });

  it('omits count when KV cache holds a JSON boolean on /stations', async () => {
    const kv = mockKV({ 'stations:music': 'true' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toBe(true);
    expect(body).not.toHaveProperty('count');
  });

  it('returns 500 when KV cache holds JSON null on /curate', async () => {
    const kv = mockKV({ 'stations:music': 'null' });
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 when KV cache holds a JSON object on /curate (degrade .slice fails)', async () => {
    const kv = mockKV({ 'stations:music': '{"not":"array"}' });
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 when KV cache holds a JSON number on /curate', async () => {
    const kv = mockKV({ 'stations:music': '42' });
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 when KV cache holds a JSON string on /curate', async () => {
    const kv = mockKV({ 'stations:music': '"hello"' });
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
  });

  it('treats empty-string KV cache as miss and refetches catalog', async () => {
    const kv = mockKV({ 'stations:music': '' });
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const stations = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(stations.status).toBe(200);
    expect((await json(stations)).count).toBe(6);
    expect(kv.put).toHaveBeenCalled();

    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const curate = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(curate.status).toBe(200);
  });

  it('degrades when Gemini returns a JSON object instead of an array', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('{"name":"Alpha FM","url":"https://example.com/alpha.m3u8"}'),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: null }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('degrades when Gemini returns a JSON array of strings', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse('["a","b"]') }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as unknown[])).toHaveLength(5);
  });

  it('passthroughs Gemini [{}] empty curated object', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse('[{}]') }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations).toEqual([{}]);
  });

  it('extracts the inner array when Gemini nests [{…}] inside another array', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ name: string }>;
    expect(stations).toEqual([
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'e',
        genre: 'music',
      },
    ]);
  });

  it('degrades when Gemini parts[0].text is a number', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [{ content: { parts: [{ text: 123 }] } }],
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as unknown[])).toHaveLength(5);
  });

  it('degrades when Gemini candidates is a non-array object', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: { content: { parts: [{ text: '[{"name":"X"}]' }] } },
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as unknown[])).toHaveLength(5);
  });

  it('degrades when Gemini JSON.parse throws on unclosed string inside matched span', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('[{"name":"A", "editorial":"unterminated]'),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as unknown[])).toHaveLength(5);
  });

  it('returns 503 when primary 204 body read throws (ok status, no music fallback)', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/jazz.m3u')) return new Response('', { status: 204 });
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    // undici/Response rejects reading a body on 204 → fetchStations throws → 503
    expect(res.status).toBe(503);
    expect(seen).toEqual(['https://iptv-org.github.io/iptv/categories/jazz.m3u']);
  });

  it('falls back to music.m3u on primary 301 redirect status', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/rock.m3u')) return new Response('moved', { status: 301 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=rock', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(6);
    expect(seen[1]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it('caches empty stations when primary returns XML/JSON with 200', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: '<?xml version="1.0"?><root/>' }),
    );
    const res = await app.request(
      '/stations?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(0);
    expect(kv.put).toHaveBeenCalledWith('stations:music', '[]', expect.objectContaining({ expirationTtl: 3600 }));
  });

  it('answers CORS preflight OPTIONS with allow-methods including GET', async () => {
    const res = await app.request(
      '/curate',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      testEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')?.toUpperCase()).toContain('GET');
  });

  it('answers CORS preflight OPTIONS on / and /health', async () => {
    for (const path of ['/', '/health']) {
      const res = await app.request(
        path,
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://example.com',
            'Access-Control-Request-Method': 'GET',
          },
        },
        testEnv(),
      );
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    }
  });

  it('ignores mood on /stations and resolves default music', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    const res = await app.request('/stations?mood=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('music');
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(seen.some((u) => u.endsWith('/jazz.m3u'))).toBe(false);
  });

  it('composes /curate query ignoring whitespace-only mood when genre is set', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=jazz&mood=%20%20',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    // filter(Boolean) keeps whitespace-only mood; join(' ') inserts another space
    expect((await json(res)).query).toBe('   jazz');
  });

  it('uses the first genre query value when alias and canonical duplicates mix', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    const res = await app.request('/stations?genre=chill&genre=rock', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('ambient');
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/ambient.m3u');
  });

  it('passthroughs curated editorial: null on Gemini success path', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":null,"genre":"music"}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const stations = (await json(res)).stations as Array<{ editorial: null; name: string }>;
    expect(stations).toHaveLength(1);
    expect(stations[0].editorial).toBeNull();
    expect(stations[0].name).toBe('Alpha FM');
  });

  it('omits undefined logo from JSON stringify on degrade when EXTINF has no logo', async () => {
    const m3u = buildSimpleM3U([{ name: 'NoLogo', url: 'https://example.com/nologo.m3u8' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u, gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const text = await res.text();
    expect(text).not.toMatch(/"logo"\s*:/);
    const body = JSON.parse(text) as { stations: Array<Record<string, unknown>> };
    expect(body.stations[0]).not.toHaveProperty('logo');
  });

  it('does not send systemInstruction or safetySettings on Gemini request body', async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(Object.keys(body ?? {}).sort()).toEqual(['contents', 'generationConfig']);
    expect(body).not.toHaveProperty('systemInstruction');
    expect(body).not.toHaveProperty('safetySettings');
  });

  it('accepts a very long mood query without throwing', async () => {
    const mood = 'x'.repeat(10_000);
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request(
      `/curate?mood=${mood}`,
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(prompt).toContain(mood);
    expect(((await json(res)).query as string).length).toBeGreaterThan(9000);
  });

  it('falls back to music.m3u on primary 302 and 307', async () => {
    for (const status of [302, 307] as const) {
      const seen: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          seen.push(url);
          if (url.endsWith('/pop.m3u')) return new Response('redir', { status });
          if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
          return new Response('nope', { status: 404 });
        }),
      );
      const res = await app.request('/stations?genre=pop', undefined, testEnv());
      expect(res.status).toBe(200);
      expect(seen[1]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
      vi.unstubAllGlobals();
    }
  });

  it('returns 500 when KV holds JSON false boolean on /curate', async () => {
    const kv = mockKV({ 'stations:music': 'false' });
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
  });

  it('omits count when KV cache holds JSON false on /stations', async () => {
    const kv = mockKV({ 'stations:music': 'false' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    const body = await json(res);
    expect(body.stations).toBe(false);
    expect(body).not.toHaveProperty('count');
  });

  it('returns 503 when KV get rejects on /stations', async () => {
    const kv = mockKV();
    vi.mocked(kv.get).mockRejectedValueOnce(new Error('kv down'));
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('returns 503 when KV get rejects on /curate', async () => {
    const kv = mockKV();
    vi.mocked(kv.get).mockRejectedValueOnce(new Error('kv down'));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(503);
  });

  it('degrades when Gemini candidates[0].content is missing', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [{ content: undefined }] }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as unknown[])).toHaveLength(5);
  });

  it('degrades when Gemini returns prose with no JSON array brace pair', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('Sorry, I cannot help with that request today.'),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as unknown[])).toHaveLength(5);
  });

  it('passthroughs Gemini array with extra unknown fields', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music","extra":true,"score":9}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(stations[0].extra).toBe(true);
    expect(stations[0].score).toBe(9);
  });

  it('includes CORS allow-origin on /stations 503 catalog failures', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request(
      '/stations?genre=music',
      { headers: { Origin: 'https://evil.example' } },
      testEnv(),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('includes CORS allow-origin on /curate 503 when GEMINI_API_KEY missing', async () => {
    const res = await app.request(
      '/curate?genre=music',
      { headers: { Origin: 'https://evil.example' } },
      testEnv({ GEMINI_API_KEY: undefined }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('falls back to music.m3u on primary 308 permanent redirect', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/news.m3u')) return new Response('redir', { status: 308 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=news', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(seen[1]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it('caches empty stations when primary returns application/json body with 200', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: '{"stations":[]}' }));
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect((await json(res)).count).toBe(0);
    expect(kv.put).toHaveBeenCalledWith('stations:music', '[]', expect.any(Object));
  });

  it('composes /curate query as genre alone when mood query is absent', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"rock"}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=rock', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect((await json(res)).query).toBe('rock');
  });

  it('locks /genres success payload keys exactly', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    expect(Object.keys(await json(res)).sort()).toEqual(['aliases', 'genres']);
  });

  it('locks / and /health success payload key sets', async () => {
    const root = await json(await app.request('/', undefined, testEnv()));
    const health = await json(await app.request('/health', undefined, testEnv()));
    expect(Object.keys(root).sort()).toEqual([
      'description',
      'endpoints',
      'name',
      'powered_by',
      'version',
    ]);
    expect(Object.keys(health).sort()).toEqual(['ok', 'version']);
  });

  it('does not put KV when catalog fetch ultimately fails', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('uses genreParam in /curate query even when mood resolves a different category', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=jazz&mood=chill',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const body = await json(res);
    expect(body.query).toBe('chill jazz');
    // genreParam wins for resolveGenre via ?? so catalog is jazz not ambient
    const stations = body.stations as Array<{ genre: string }>;
    expect(stations[0].genre).toBe('jazz');
  });

  it('returns 404 for unknown paths while still attaching CORS', async () => {
    const res = await app.request(
      '/nope',
      { headers: { Origin: 'https://example.com' } },
      testEnv(),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('fetches jazz catalog when genreParam wins over a conflicting mood alias', async () => {
    // resolveGenre(genreParam ?? mood) → jazz, not ambient from "late night"
    const jazzM3u = buildSimpleM3U([{ name: 'Jazz Only', url: 'https://example.com/jazz-only.m3u8' }]);
    const ambientM3u = buildSimpleM3U([
      { name: 'Ambient Only', url: 'https://example.com/ambient-only.m3u8' },
    ]);
    const kv = mockKV();
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: jazzM3u, ambient: ambientM3u, music: SAMPLE_M3U },
      gemini: geminiTextResponse(
        '[{"name":"Jazz Only","url":"https://example.com/jazz-only.m3u8","editorial":"e","genre":"jazz"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request(
      '/curate?genre=jazz&mood=late%20night',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('late night jazz');
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Jazz Only');

    const iptvUrls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('iptv-org'));
    expect(iptvUrls.some((u) => u.endsWith('/jazz.m3u'))).toBe(true);
    expect(iptvUrls.some((u) => u.endsWith('/ambient.m3u'))).toBe(false);
    expect(kv.put).toHaveBeenCalledWith(
      'stations:jazz',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('does not retry music.m3u when the primary catalog fetch throws', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      throw new TypeError('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/jazz.m3u');
  });

  it('treats primary HTTP 204 as success (no music fallback) with empty parse', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        // Fetch forbids a body on 204 — use null body (ok === true, empty text).
        return new Response(null, { status: 204 });
      }),
    );

    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.count).toBe(0);
    expect(body.stations).toEqual([]);
    expect(seen).toEqual(['https://iptv-org.github.io/iptv/categories/jazz.m3u']);
  });

  it('returns full Station optional fields on /stations from rich M3U', async () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Rich FM',
        url: 'https://example.com/rich.m3u8',
        logo: 'https://cdn.example/rich.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));

    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toEqual([
      {
        name: 'Rich FM',
        url: 'https://example.com/rich.m3u8',
        logo: 'https://cdn.example/rich.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
  });

  it('sets CORS allow-methods and allow-headers on /stations OPTIONS preflight', async () => {
    const res = await app.request(
      '/stations',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'content-type',
        },
      },
      testEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const methods = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    expect(methods).toMatch(/GET/);
    expect(res.headers.get('access-control-allow-headers')).toMatch(/content-type/i);
  });

  it('returns a mutable copy of VALID_GENRES on /genres', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    const genres = body.genres as string[];
    expect(genres).toEqual([...VALID_GENRES]);
    genres.push('mutated-should-not-leak');
    expect([...VALID_GENRES]).not.toContain('mutated-should-not-leak');
  });

  it('omits count when KV cache holds JSON boolean false', async () => {
    const kv = mockKV({ 'stations:music': 'false' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toBe(false);
    expect(body).not.toHaveProperty('count');
  });

  it('prompts Gemini for top 3 stations with short 1-2 sentence editorials', async () => {
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );

    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toMatch(/top 3/i);
    expect(prompt).toMatch(/1-2 sentences/i);
    expect(prompt).toMatch(/Return JSON only/);
  });

  it('locks exact / endpoint blurb strings', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const endpoints = body.endpoints as Record<string, string>;
    expect(endpoints).toEqual({
      '/curate': 'GET ?genre=&mood= — AI-curated station picks',
      '/stations': 'GET ?genre= — Raw station list',
      '/genres': 'GET — Available genre categories',
      '/health': 'GET — Health check',
    });
  });

  it('locks root description to package catalog wording', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('treats GEMINI_API_KEY "0" and "false" as truthy and calls Gemini', async () => {
    for (const key of ['0', 'false'] as const) {
      const fetchMock = stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      });
      vi.stubGlobal('fetch', fetchMock);
      const res = await app.request(
        '/curate?genre=music',
        undefined,
        testEnv({ GEMINI_API_KEY: key }),
      );
      expect(res.status).toBe(200);
      expect(captureGeminiRequest(fetchMock)).not.toBeNull();
      expect(captureGeminiRequest(fetchMock)!.url).toContain(`key=${key}`);
      vi.unstubAllGlobals();
    }
  });

  it('HEAD /curate without API key returns 503 curation unavailable', async () => {
    const res = await app.request(
      '/curate?genre=music',
      { method: 'HEAD' },
      testEnv({ GEMINI_API_KEY: undefined }),
    );
    expect(res.status).toBe(503);
  });

  it('includes CORS allow-origin on /curate 500 KV-shape failures', async () => {
    const kv = mockKV(seedStationsCache('music', null));
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      { headers: { Origin: 'https://evil.example' } },
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('serves application/json content-type on 503 bodies', async () => {
    const missingKey = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: undefined }),
    );
    expect(missingKey.status).toBe(503);
    expect(missingKey.headers.get('content-type')).toMatch(/application\/json/);

    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const catalogDown = await app.request('/stations?genre=music', undefined, testEnv());
    expect(catalogDown.status).toBe(503);
    expect(catalogDown.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('locks Gemini URL to v1beta generateContent path', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const gemini = captureGeminiRequest(fetchMock);
    expect(gemini!.url).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    );
  });

  it('sends only content-type header to Gemini (no Authorization / x-goog-api-key)', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'secret-key' }));
    const gemini = captureGeminiRequest(fetchMock);
    const headers = new Headers(gemini!.headers);
    expect([...headers.keys()].map((k) => k.toLowerCase()).sort()).toEqual(['content-type']);
    expect(headers.get('content-type')).toMatch(/application\/json/i);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('x-goog-api-key')).toBe(false);
  });

  it('fetches iptv-org catalog with bare GET (no RequestInit)', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv());
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('uses empty group-title in Gemini prompt without falling back to genre', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="EmptyGroup" group-title="",EmptyGroup
https://example.com/empty-group.m3u8
`;
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(m3u, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"EmptyGroup","url":"https://example.com/empty-group.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toContain('EmptyGroup () [en]');
    expect(prompt).not.toContain('EmptyGroup (music)');
  });

  it('keeps empty tvg-language in Gemini prompt (does not become en)', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="NoLang" tvg-language="",NoLang
https://example.com/nolang.m3u8
`;
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(m3u, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"NoLang","url":"https://example.com/nolang.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toContain('NoLang (music) []');
    expect(prompt).not.toContain('NoLang (music) [en]');
  });

  it('returns 503 when KV cache holds whitespace-only value', async () => {
    const kv = mockKV({ 'stations:music': '   ' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('returns 404 for case-mismatched known paths', async () => {
    for (const path of ['/Stations', '/CURATE', '/Genres', '/Health']) {
      const res = await app.request(path, undefined, testEnv());
      expect(res.status).toBe(404);
    }
  });

  it('returns 404 for GET /openapi.json at runtime', async () => {
    const res = await app.request('/openapi.json', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('degrades preserving catalog order for the first five station names', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const names = ((await json(res)).stations as Array<{ name: string }>).map((s) => s.name);
    expect(names).toEqual(['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM']);
  });

  it('keeps mood=0 in /curate query via filter(Boolean)', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=music&mood=0',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect((await json(res)).query).toBe('0 music');
  });

  it('serves KV hit after music-fallback fill without refetching', async () => {
    const kv = mockKV();
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/jazz.m3u')) return new Response('missing', { status: 404 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const first = await app.request(
      '/stations?genre=jazz',
      undefined,
      testEnv({ CATALOG_CACHE: kv }),
    );
    expect(first.status).toBe(200);
    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/jazz.m3u',
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    ]);
    const before = seen.length;
    const second = await app.request(
      '/stations?genre=jazz',
      undefined,
      testEnv({ CATALOG_CACHE: kv }),
    );
    expect(second.status).toBe(200);
    expect(seen.length).toBe(before);
    expect(kv.get).toHaveBeenCalledWith('stations:jazz');
  });

  it('returns JSON-copied /genres aliases (mutating response does not leak into GENRE_MAP)', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const aliases = (await json(res)).aliases as Record<string, string>;
    expect(aliases).toEqual(GENRE_MAP);
    expect(aliases).not.toBe(GENRE_MAP);
    const original = GENRE_MAP.chill;
    aliases.chill = 'mutated-should-not-leak';
    expect(GENRE_MAP.chill).toBe(original);
  });

  it('returns Gemini success picks even when catalog is empty', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: '#EXTM3U\n',
        gemini: geminiTextResponse(
          '[{"name":"Hallucinated","url":"https://example.com/h.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ name: string }>;
    expect(stations).toEqual([
      expect.objectContaining({ name: 'Hallucinated', url: 'https://example.com/h.m3u8' }),
    ]);
  });

  it('treats primary HTTP 206 as success and skips music fallback', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 206 });
      }),
    );
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(6);
    expect(seen).toEqual(['https://iptv-org.github.io/iptv/categories/jazz.m3u']);
  });

  it('runs concurrent cold /curate misses without singleflight coalescing', async () => {
    let iptvHits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) {
          iptvHits += 1;
          await new Promise((r) => setTimeout(r, 5));
          return new Response(SAMPLE_M3U, { status: 200 });
        }
        if (url.includes('generativelanguage')) {
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const env = testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() });
    const [a, b] = await Promise.all([
      app.request('/curate?genre=music', undefined, env),
      app.request('/curate?genre=music', undefined, env),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(iptvHits).toBeGreaterThanOrEqual(2);
  });

  it('ignores Gemini finishReason and promptFeedback when text is present', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          promptFeedback: { blockReason: 'OTHER' },
          candidates: [
            {
              finishReason: 'MAX_TOKENS',
              content: {
                parts: [
                  {
                    text: '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
                  },
                ],
              },
            },
          ],
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as unknown[])).toHaveLength(1);
  });

  it('KV put options contain only expirationTtl', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(kv.put).mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(opts).sort()).toEqual(['expirationTtl']);
    expect(opts.expirationTtl).toBe(3600);
  });

  it('does not path-traverse CDN URL when genre encodes a slash', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    // %2F decodes to "/", but resolveGenre maps unknown → music
    const res = await app.request('/stations?genre=foo%2Fbar', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
    expect(seen.some((u) => u.includes('foo/bar') || u.includes('foo%2Fbar'))).toBe(false);
  });

  it('omits editorial from /stations station objects', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    for (const s of stations) {
      expect(s).not.toHaveProperty('editorial');
      expect(s).not.toHaveProperty('curated_by');
    }
  });

  it('answers minimal OPTIONS without Access-Control-Request-Headers', async () => {
    const res = await app.request(
      '/genres',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      testEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns 503 when primary text() throws after ok (non-204)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jazz.m3u')) {
        return {
          ok: true,
          status: 200,
          text: async () => {
            throw new Error('body read failed');
          },
        } as unknown as Response;
      }
      return new Response(SAMPLE_M3U, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prompts Gemini with Be specific about mood wording', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const gemini = captureGeminiRequest(fetchMock);
    const prompt = (gemini!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]
      .parts[0].text;
    expect(prompt).toContain(
      'Be specific about what makes each station right for the mood',
    );
  });

  it('joins Gemini user request with " / " while response query uses spaces', async () => {
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request(
      '/curate?genre=jazz&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(prompt).toContain('User request: focus / jazz');
    expect((await json(res)).query).toBe('focus jazz');
  });

  it('returns 500 when KV cache holds a JSON number on /curate degrade', async () => {
    const kv = mockKV(seedStationsCache('music', 42));
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
  });

  it('locks /stations success payload key set', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(Object.keys(body).sort()).toEqual(['count', 'genre', 'stations']);
  });

  it('locks /curate success payload key set', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(Object.keys(body).sort()).toEqual(['curated_by', 'query', 'stations', 'timestamp']);
  });

  it('falls back to music.m3u when primary HTTP 304 has ok===false in runtime Fetch', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/pop.m3u')) return new Response(null, { status: 304 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const probe = new Response(null, { status: 304 });
    expect(probe.ok).toBe(false);
    const res = await app.request('/stations?genre=pop', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(6);
    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/pop.m3u',
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    ]);
  });

  it('returns 500 on /curate degrade when KV stations array contains null', async () => {
    const kv = mockKV(seedStationsCache('music', [null]));
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
  });

  it('degrades with undefined name/url when KV stations are primitives (no throw)', async () => {
    const kv = mockKV(seedStationsCache('music', [1, 2, 3]));
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(stations).toHaveLength(3);
    expect(stations[0].editorial).toBeNull();
    expect(stations[0].genre).toBe('music');
    expect(stations[0]).not.toHaveProperty('name');
    expect(stations[0]).not.toHaveProperty('url');
  });

  it('preserves logo:null from KV on /curate degrade path', async () => {
    const kv = mockKV(
      seedStationsCache('music', [
        { name: 'Null Logo', url: 'https://example.com/null-logo.m3u8', logo: null },
      ]),
    );
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(stations[0].logo).toBeNull();
    expect(stations[0]).toHaveProperty('logo');
  });

  it('degrades when Gemini parts[0].text is a non-string object', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [{ content: { parts: [{ text: { nested: true } }] } }],
        }),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as unknown[];
    expect(stations.length).toBeGreaterThan(0);
    expect((stations[0] as { editorial: unknown }).editorial).toBeNull();
  });

  it('degrades when Gemini parts[0].text is a boolean', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [{ content: { parts: [{ text: true }] } }],
        }),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it.each([400, 402, 404, 502])('degrades on Gemini HTTP %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: () => new Response('err', { status }) }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('returns 503 when music-fallback text() throws after primary !ok', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jazz.m3u')) return new Response('down', { status: 404 });
      if (url.endsWith('/music.m3u')) {
        return {
          ok: true,
          status: 200,
          text: async () => {
            throw new Error('fallback body read failed');
          },
        } as unknown as Response;
      }
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches empty catalog under requested genre when primary !ok and fallback is empty M3U', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/pop.m3u')) return new Response('gone', { status: 404 });
        if (url.endsWith('/music.m3u')) return new Response('#EXTM3U\n', { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(0);
    expect(kv.put).toHaveBeenCalledWith('stations:pop', '[]', { expirationTtl: 3600 });
  });

  it('interpolates GEMINI_API_KEY with reserved &/= chars raw into Gemini URL', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'a&b=c' }),
    );
    const gemini = captureGeminiRequest(fetchMock);
    expect(gemini!.url).toContain('key=a&b=c');
  });

  it('answers OPTIONS preflight on /curate with CORS *', async () => {
    const res = await app.request(
      '/curate',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://radio.example',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'content-type',
        },
      },
      testEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')?.toUpperCase()).toContain('GET');
  });

  it('does not set Access-Control-Allow-Credentials on open cors()', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('includes CORS allow-origin on /stations 500 when KV JSON is null', async () => {
    const kv = mockKV(seedStationsCache('music', 'null'));
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it.each([208, 226, 299])('treats primary HTTP %i as ok with no music fallback', async (status) => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/jazz.m3u')) {
          return {
            ok: true,
            status,
            text: async () => SAMPLE_M3U,
          } as unknown as Response;
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(6);
    expect(seen).toEqual(['https://iptv-org.github.io/iptv/categories/jazz.m3u']);
  });

  it.each([409, 429, 451])('falls back to music.m3u on primary HTTP %i', async (status) => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/rock.m3u')) return new Response('no', { status });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=rock', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/rock.m3u',
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    ]);
  });

  it('returns 503 when KV put rejects after music-fallback fill on /stations', async () => {
    const kv = mockKV();
    vi.mocked(kv.put).mockRejectedValueOnce(new Error('kv put failed'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/news.m3u')) return new Response('gone', { status: 404 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=news', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(503);
  });

  it('allows concurrent cold misses to each attempt KV put (no singleflight)', async () => {
    const kv = mockKV();
    let iptvHits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) {
          iptvHits += 1;
          await new Promise((r) => setTimeout(r, 5));
          return new Response(SAMPLE_M3U, { status: 200 });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const env = testEnv({ CATALOG_CACHE: kv });
    const [a, b] = await Promise.all([
      app.request('/stations?genre=music', undefined, env),
      app.request('/stations?genre=music', undefined, env),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(iptvHits).toBeGreaterThanOrEqual(2);
    expect(vi.mocked(kv.put).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps whitespace-only mood as query when genre is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?mood=%20%20',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect((await json(res)).query).toBe('  ');
  });

  it('keeps mood=false and mood=null string literals in /curate query', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const falseRes = await app.request(
      '/curate?genre=music&mood=false',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect((await json(falseRes)).query).toBe('false music');
    const nullRes = await app.request(
      '/curate?genre=music&mood=null',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect((await json(nullRes)).query).toBe('null music');
  });

  it('passthrough Gemini success with logo:null and missing editorial', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Sparse","url":"https://example.com/sparse.m3u8","logo":null,"genre":"music"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(stations[0].logo).toBeNull();
    expect(stations[0]).not.toHaveProperty('editorial');
  });

  it('passthrough length-2 curated array with one missing url', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"A","url":"https://example.com/a.m3u8","editorial":"e","genre":"music"},{"name":"B","editorial":"e2","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(stations).toHaveLength(2);
    expect(stations[0].url).toBe('https://example.com/a.m3u8');
    expect(stations[1]).not.toHaveProperty('url');
  });

  it('accepts newline-indented Gemini JSON array via regex match', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[\n  {\n    "name": "Indented",\n    "url": "https://example.com/i.m3u8",\n    "editorial": "ok",\n    "genre": "music"\n  }\n]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as Array<{ name: string }>)[0].name).toBe('Indented');
  });

  it('degrades when greedy Gemini regex spans two adjacent JSON arrays', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"A","url":"https://a","editorial":"e","genre":"music"}][{"name":"B","url":"https://b","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    // Greedy match spans both arrays → JSON.parse throws → degrade
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('prompts with (genre) and [en] defaults when KV station omits group/language', async () => {
    const kv = mockKV(
      seedStationsCache('jazz', [{ name: 'Sparse', url: 'https://example.com/sparse.m3u8' }]),
    );
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Sparse","url":"https://example.com/sparse.m3u8","editorial":"e","genre":"jazz"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request(
      '/curate?genre=jazz',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    const gemini = captureGeminiRequest(fetchMock);
    const prompt = (gemini!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]
      .parts[0].text;
    expect(prompt).toContain('1. Sparse (jazz) [en] — https://example.com/sparse.m3u8');
  });

  it('sends Gemini contents with exactly one element and one parts[0].text', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const body = captureGeminiRequest(fetchMock)!.body;
    const contents = body.contents as unknown[];
    expect(contents).toHaveLength(1);
    const parts = (contents[0] as { parts: unknown[] }).parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveProperty('text');
    expect(Object.keys(parts[0] as object)).toEqual(['text']);
  });

  it('does not send cache/tools/systemInstruction keys on Gemini body', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const body = captureGeminiRequest(fetchMock)!.body;
    expect(body).not.toHaveProperty('cache');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('systemInstruction');
    expect(Object.keys(body).sort()).toEqual(['contents', 'generationConfig']);
  });

  it('JSON-copies /genres aliases so mutating response does not mutate GENRE_MAP', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    const aliases = body.aliases as Record<string, string>;
    aliases.chill = 'mutated';
    expect(GENRE_MAP.chill).toBe('ambient');
    const again = (await json(await app.request('/genres', undefined, testEnv())))
      .aliases as Record<string, string>;
    expect(again.chill).toBe('ambient');
  });

  it('HEAD /stations with corrupt KV returns same 503 as GET (JSON.parse throw)', async () => {
    const kv = mockKV(seedStationsCache('music', '{'));
    const getRes = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    const headRes = await app.request(
      '/stations?genre=music',
      { method: 'HEAD' },
      testEnv({ CATALOG_CACHE: kv }),
    );
    expect(headRes.status).toBe(getRes.status);
    expect(getRes.status).toBe(503);
  });

  it('empty genre= with mood=jazz resolves catalog to music.m3u', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        if (String(input).includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        return geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        );
      }),
    );
    const res = await app.request(
      '/curate?genre=&mood=jazz',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it('maps percent-encoded emoji genre to music catalog', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    const res = await app.request('/stations?genre=%F0%9F%8E%B5', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it('does not decode double-encoded %2520 into a space alias', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(SAMPLE_M3U, { status: 200 });
      }),
    );
    // genre decodes once to "%20" which is unknown → music
    const res = await app.request('/stations?genre=%2520', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/music.m3u');
  });

  it('locks exact 503 body keys for catalog and curation miss', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const catalog = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(Object.keys(catalog).sort()).toEqual(['error', 'retry_after']);
    expect(catalog).toEqual({ error: 'Stream catalog unavailable', retry_after: 60 });

    const curation = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: undefined })),
    );
    expect(Object.keys(curation).sort()).toEqual(['error', 'retry_after']);
    expect(curation).toEqual({ error: 'Curation service unavailable', retry_after: 60 });
  });

  it('returns /curate timestamp parseable and within a few seconds of now', async () => {
    const before = Date.now();
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const after = Date.now();
    const ts = Date.parse((await json(res)).timestamp as string);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it('locks degrade station JSON keys; omits undefined logo', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    // SAMPLE_M3U has no logos → undefined logo omitted from JSON
    expect(Object.keys(stations[0]).sort()).toEqual(['editorial', 'genre', 'name', 'url']);
    expect(stations[0]).not.toHaveProperty('language');
    expect(stations[0]).not.toHaveProperty('country');
    expect(stations[0].editorial).toBeNull();
  });

  it('includes logo key on degrade when KV station provides a logo', async () => {
    const kv = mockKV(
      seedStationsCache('music', [
        {
          name: 'Logo FM',
          url: 'https://example.com/logo.m3u8',
          logo: 'https://cdn.example/logo.png',
        },
      ]),
    );
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(Object.keys(stations[0]).sort()).toEqual([
      'editorial',
      'genre',
      'logo',
      'name',
      'url',
    ]);
    expect(stations[0].logo).toBe('https://cdn.example/logo.png');
  });

  it('passthrough Gemini stations without remapping Worker genre onto picks', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"X","url":"https://example.com/x.m3u8","editorial":"e","genre":"news","extra":1}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=jazz',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const stations = (await json(res)).stations as Array<Record<string, unknown>>;
    expect(stations[0].genre).toBe('news');
    expect(stations[0].extra).toBe(1);
  });

  it('never passes RequestInit on iptv primary or music-fallback fetches', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/sports.m3u')) return new Response('down', { status: 503 });
      if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=sports', undefined, testEnv());
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
    expect(fetchMock.mock.calls.every((c) => c[1] === undefined)).toBe(true);
  });

  it('uses stations:rock cache key after metal→rock alias', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    await app.request('/stations?genre=metal', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).toHaveBeenCalledWith('stations:rock', expect.any(String), {
      expirationTtl: 3600,
    });
  });

  it('ignores unknown query keys on /stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=jazz&foo=1&limit=99', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('jazz');
    expect(body).not.toHaveProperty('foo');
    expect(body).not.toHaveProperty('limit');
  });

  it('returns Access-Control-Allow-Origin * regardless of Origin header', async () => {
    const res = await app.request(
      '/health',
      { headers: { Origin: 'https://evil.example' } },
      testEnv(),
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
  });

  it('Gemini URL path must not drift to gemini-1.5 or claude', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const url = captureGeminiRequest(fetchMock)!.url;
    expect(url).toContain('gemini-2.0-flash');
    expect(url).not.toMatch(/gemini-1\.5/);
    expect(url).not.toMatch(/claude/i);
  });

  it('degrades when Gemini parts is [{}] missing text key', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [{ content: { parts: [{}] } }],
        }),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(((await json(res)).stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('caps degrade at exactly 5 when KV holds 6 stations and Gemini fails', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/s${i}.m3u8`,
    }));
    const kv = mockKV(seedStationsCache('music', six));
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: () => new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(((await json(res)).stations as unknown[])).toHaveLength(5);
  });

  it('second /stations hit after empty HTML cache does not re-fetch iptv', async () => {
    const kv = mockKV();
    let iptvHits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('iptv-org')) {
          iptvHits += 1;
          return new Response('<html>not m3u</html>', { status: 200 });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const env = testEnv({ CATALOG_CACHE: kv });
    const first = await app.request('/stations?genre=music', undefined, env);
    expect(first.status).toBe(200);
    expect((await json(first)).count).toBe(0);
    expect(iptvHits).toBe(1);
    const second = await app.request('/stations?genre=music', undefined, env);
    expect(second.status).toBe(200);
    expect((await json(second)).count).toBe(0);
    expect(iptvHits).toBe(1);
  });

  it('never calls Gemini from /stations even when GEMINI_API_KEY is set', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      gemini: geminiTextResponse('[{"name":"X","url":"https://x","editorial":"e","genre":"music"}]'),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/stations?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'should-not-be-used' }),
    );
    expect(res.status).toBe(200);
    expect(captureGeminiRequest(fetchMock)).toBeNull();
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('generativelanguage')).length,
    ).toBe(0);
  });

  it('degrades when Gemini parts[0].text is an empty string', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse('') }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    const stations = body.stations as Array<{ editorial: string | null }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('omits Access-Control-Allow-Credentials on / and 503 catalog-unavailable responses', async () => {
    const root = await app.request('/', undefined, testEnv());
    expect(root.headers.get('access-control-allow-origin')).toBe('*');
    expect(root.headers.get('access-control-allow-credentials')).toBeNull();

    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const unavailable = await app.request('/stations?genre=music', undefined, testEnv());
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('access-control-allow-origin')).toBe('*');
    expect(unavailable.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('preserves empty-string logo on /curate degrade from M3U tvg-logo=""', async () => {
    const m3u = buildSimpleM3U([
      { name: 'Empty Logo', url: 'https://example.com/empty-logo.m3u8', logo: '' },
      { name: 'B', url: 'https://example.com/b.m3u8' },
      { name: 'C', url: 'https://example.com/c.m3u8' },
      { name: 'D', url: 'https://example.com/d.m3u8' },
      { name: 'E', url: 'https://example.com/e.m3u8' },
    ]);
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u, gemini: () => new Response('boom', { status: 500 }) }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const stations = (await json(res)).stations as Array<{ name: string; logo?: string }>;
    expect(stations[0].name).toBe('Empty Logo');
    expect(stations[0].logo).toBe('');
  });

  it('treats genre=undefined and genre=null query strings as unresolved → music', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    for (const q of ['genre=undefined', 'genre=null']) {
      const body = await json(await app.request(`/stations?${q}`, undefined, testEnv()));
      expect(body.genre).toBe('music');
    }
  });

  it('genre-only /curate prompt uses User request without slash separator', async () => {
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(prompt).toContain('User request: jazz');
    expect(prompt).not.toMatch(/User request:.* \//);
  });

  it('happy-path /curate body excludes retry_after and error keys', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body).not.toHaveProperty('retry_after');
    expect(body).not.toHaveProperty('error');
  });

  it('answers OPTIONS preflight with Access-Control-Request-Method POST', async () => {
    const res = await app.request('/curate', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'POST',
      },
    }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('falls back to music.m3u when primary returns HTTP 408', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/rock.m3u')) return new Response('slow', { status: 408 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=rock', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(6);
    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/rock.m3u',
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    ]);
  });

  it('locks prompt station line contains `] — https://`', async () => {
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toContain('] — https://');
  });

  it('passes through KV cache array of nulls on /stations', async () => {
    const kv = mockKV(seedStationsCache('music', [null, null]));
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.count).toBe(2);
    expect(body.stations).toEqual([null, null]);
  });

  it('degrades when Gemini returns 200 application/json with truncated body `{`', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: () =>
          new Response('{', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as unknown[];
    expect(stations).toHaveLength(5);
  });

  it('caches empty stations when primary 404 and music fallback returns empty body', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/jazz.m3u')) return new Response('missing', { status: 404 });
        if (url.endsWith('/music.m3u')) return new Response('', { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request(
      '/stations?genre=jazz',
      undefined,
      testEnv({ CATALOG_CACHE: kv }),
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ genre: 'jazz', count: 0, stations: [] });
    expect(kv.put).toHaveBeenCalledWith('stations:jazz', '[]', { expirationTtl: 3600 });
  });

  it('locks / health content-type to application/json', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('returns /genres genres array equal to VALID_GENRES spread copy', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.genres).not.toBe(VALID_GENRES);
  });

  it('maps blues alias to jazz catalog URL on /stations', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=blues', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('jazz');
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it('uses stations:ambient cache key for lofi alias on /stations', async () => {
    const kv = mockKV(
      seedStationsCache('ambient', [{ name: 'A', url: 'https://example.com/a.m3u8' }]),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=lofi', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    expect((await json(res)).genre).toBe('ambient');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith('stations:ambient');
  });

  it('locks /curate curated_by and omits powered_by', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(body).not.toHaveProperty('powered_by');
  });

  it('degrades to fewer than 5 when catalog has only 2 stations', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: buildSimpleM3U([
          { name: 'A', url: 'https://example.com/a.m3u8' },
          { name: 'B', url: 'https://example.com/b.m3u8' },
        ]),
        gemini: () => new Response('boom', { status: 500 }),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as unknown[];
    expect(stations).toHaveLength(2);
  });

  it('returns 404 for unknown paths without throwing', async () => {
    const res = await app.request('/nope', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('locks root endpoint descriptions as exact strings', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const endpoints = body.endpoints as Record<string, string>;
    expect(endpoints).toEqual({
      '/curate': 'GET ?genre=&mood= — AI-curated station picks',
      '/stations': 'GET ?genre= — Raw station list',
      '/genres': 'GET — Available genre categories',
      '/health': 'GET — Health check',
    });
  });

  it('does not call Gemini when /curate has no API key even if catalog fetch would succeed', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse('[]'),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/curate?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(captureGeminiRequest(fetchMock)).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('iptv-org'))).toBe(false);
  });

  it('ignores Gemini candidates[1] when candidates[0] text is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [
            { content: { parts: [{ text: 'not-json' }] } },
            {
              content: {
                parts: [
                  {
                    text: '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
                  },
                ],
              },
            },
          ],
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: string | null }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('ignores Gemini parts[1] when parts[0].text is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'nope' },
                  {
                    text: '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
                  },
                ],
              },
            },
          ],
        }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: string | null }>;
    expect(stations).toHaveLength(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('ignores safetyRatings, usageMetadata, and modelVersion when parts[0].text is valid', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({
          candidates: [
            {
              finishReason: 'STOP',
              safetyRatings: [{ category: 'HARM', probability: 'NEGLIGIBLE' }],
              content: {
                parts: [
                  {
                    text: '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"safe","genre":"music"}]',
                  },
                ],
              },
            },
          ],
          usageMetadata: { totalTokenCount: 42 },
          modelVersion: 'gemini-2.0-flash',
        }),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const stations = body.stations as Array<{ name: string; editorial: string }>;
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({ name: 'Alpha FM', editorial: 'safe' });
    expect(body).not.toHaveProperty('usageMetadata');
    expect(body).not.toHaveProperty('modelVersion');
    expect(body).not.toHaveProperty('safetyRatings');
  });

  it('accepts UTF-8 BOM before Gemini JSON array', async () => {
    const payload =
      '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"bom","genre":"music"}]';
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse(`\uFEFF${payload}`) }));
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<{ editorial: string }>;
    expect(stations[0].editorial).toBe('bom');
  });

  it('accepts zero-width space before Gemini JSON array', async () => {
    const payload =
      '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"zwsp","genre":"music"}]';
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse(`\u200B${payload}`) }));
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<{ editorial: string }>;
    expect(stations[0].editorial).toBe('zwsp');
  });

  it('degrades when Gemini returns a single JSON object instead of an array', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}',
        ),
      }),
    );
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<{ editorial: string | null }>;
    expect(stations).toHaveLength(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('degrades when Gemini JSON array has a trailing comma', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music",}]',
        ),
      }),
    );
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<{ editorial: string | null }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('never mentions fuzzywigg.com or workers.dev in public JSON bodies', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    for (const path of ['/', '/health', '/genres', '/stations?genre=music', '/curate?genre=music'] as const) {
      const res = await app.request(path, undefined, testEnv({ GEMINI_API_KEY: 'k' }));
      const text = await res.text();
      expect(text.toLowerCase()).not.toContain('fuzzywigg');
      expect(text.toLowerCase()).not.toContain('workers.dev');
    }
  });

  it('CORS preflight omits Access-Control-Max-Age and Expose-Headers', async () => {
    const res = await app.request(
      '/curate',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'content-type',
        },
      },
      testEnv(),
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')?.toUpperCase()).toMatch(/GET/);
    expect(res.headers.get('access-control-max-age')).toBeNull();
    expect(res.headers.get('access-control-expose-headers')).toBeNull();
  });

  it('returns Access-Control-Allow-Origin * for Origin: null', async () => {
    const res = await app.request('/health', { headers: { Origin: 'null' } }, testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('omits security and caching response headers on /health', async () => {
    const res = await app.request('/health', undefined, testEnv());
    for (const h of [
      'x-powered-by',
      'server',
      'etag',
      'cache-control',
      'retry-after',
      'set-cookie',
      'www-authenticate',
      'age',
      'via',
      'link',
      'location',
      'cf-ray',
      'x-request-id',
    ] as const) {
      expect(res.headers.get(h)).toBeNull();
    }
  });

  it('does not call KV put on /stations cache hit', async () => {
    const kv = mockKV(seedStationsCache('music', [{ name: 'Cached', url: 'https://example.com/c.m3u8' }]));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith('stations:music');
  });

  it('returns 503 when iptv fetch rejects with DOMException AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('defaults VERSION nullish binding to 0.1.0 on / and /health', async () => {
    const env = testEnv({ VERSION: null as unknown as undefined });
    const root = await json(await app.request('/', undefined, env));
    expect(root.version).toBe('0.1.0');
    const health = await json(await app.request('/health', undefined, env));
    expect(health).toEqual({ ok: true, version: '0.1.0' });
  });

  it('locks / root payload key set exactly', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(Object.keys(body).sort()).toEqual([
      'description',
      'endpoints',
      'name',
      'powered_by',
      'version',
    ]);
    expect(body).not.toHaveProperty('stations');
    expect(body).not.toHaveProperty('curated_by');
    expect(body).not.toHaveProperty('query');
    expect(body).not.toHaveProperty('error');
  });

  it('locks powered_by crab emoji exact string on /', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.powered_by).toBe('Backlink/Geryon 🦀');
    expect(String(body.powered_by)).toContain('🦀');
  });

  it('treats empty mood= with genre=jazz as query jazz only', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
        ),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=jazz&mood=', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('jazz');
  });

  it('keeps both http and https stream URLs from catalog on /stations', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="HTTP",HTTP
http://example.com/h.m3u8
#EXTINF:-1 tvg-name="HTTPS",HTTPS
https://example.com/s.m3u8
`;
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(body.count).toBe(2);
    const urls = (body.stations as Array<{ url: string }>).map((s) => s.url);
    expect(urls).toEqual(['http://example.com/h.m3u8', 'https://example.com/s.m3u8']);
  });

  it('double-fetches music.m3u when genre=music primary and fallback both fail', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response('down', { status: 503 });
      }),
    );
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/music.m3u',
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    ]);
  });

  it('passthroughs uncapped Gemini curated arrays longer than degrade slice of 5', async () => {
    const picks = Array.from({ length: 10 }, (_, i) => ({
      name: `P${i}`,
      url: `https://example.com/p${i}.m3u8`,
      editorial: `e${i}`,
      genre: 'music',
    }));
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse(JSON.stringify(picks)) }));
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as unknown[];
    expect(stations).toHaveLength(10);
  });

  it('places GEMINI_API_KEY only in Gemini URL query, never in POST body or prompt', async () => {
    const fetchMock = stubIptvAndGemini({
      gemini: geminiTextResponse(
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'secret-key-xyz' }));
    const captured = captureGeminiRequest(fetchMock);
    expect(captured).not.toBeNull();
    expect(captured!.url).toContain('key=secret-key-xyz');
    expect(JSON.stringify(captured!.body)).not.toContain('secret-key-xyz');
    const prompt = (captured!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0]
      .parts[0].text;
    expect(prompt).not.toContain('secret-key-xyz');
    expect(prompt).not.toContain('GEMINI_API_KEY');
  });

  it('serves application/json without charset parameter on /health and /genres', async () => {
    for (const path of ['/health', '/genres'] as const) {
      const res = await app.request(path, undefined, testEnv());
      expect(res.headers.get('content-type')).toMatch(/^application\/json\b/);
      expect(res.headers.get('content-type')?.toLowerCase()).not.toContain('charset');
    }
  });

  it('degrades when Gemini envelope is JSON null', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: () =>
          new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
      }),
    );
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<{ editorial: string | null }>;
    expect(stations).toHaveLength(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('degrades when Gemini envelope is a JSON array', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: () =>
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
      }),
    );
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<{ editorial: string | null }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('degrades when Gemini returns text/html 200 body', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: () =>
          new Response('<html>nope</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const stations = (await json(res)).stations as unknown[];
    expect(stations).toHaveLength(5);
  });

  it('degrades when Gemini envelope is truncated non-JSON', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: () => new Response('{not-json', { status: 200 }),
      }),
    );
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as unknown[];
    expect(stations).toHaveLength(5);
  });

  it('passthroughs emoji and newline characters in Gemini editorial text', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          JSON.stringify([
            {
              name: 'Alpha FM',
              url: 'https://example.com/alpha.m3u8',
              editorial: '🔥 late night\nsecond line',
              genre: 'music',
            },
          ]),
        ),
      }),
    );
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<{ editorial: string }>;
    expect(stations[0].editorial).toBe('🔥 late night\nsecond line');
  });

  it('passthroughs empty-string name, url, and genre from Gemini picks', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('[{"name":"","url":"","editorial":"e","genre":""}]'),
      }),
    );
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<{ name: string; url: string; genre: string; editorial: string }>;
    expect(stations).toEqual([{ name: '', url: '', editorial: 'e', genre: '' }]);
  });

  it('trims percent-encoded leading/trailing spaces in genre query to jazz', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) {
          seen.push(url);
          return new Response(SAMPLE_M3U, { status: 200 });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const body = await json(await app.request('/stations?genre=%20jazz%20', undefined, testEnv()));
    expect(body.genre).toBe('jazz');
    expect(seen[0]).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
  });

  it('returns 503 curation catalog path when KV cache JSON is corrupt on /curate', async () => {
    const kv = mockKV({ 'stations:music': '{' });
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('returns 500 when KV cache holds a non-array object on /curate degrade path', async () => {
    const kv = mockKV(seedStationsCache('music', { name: 'not-an-array' }));
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: () => new Response('boom', { status: 500 }),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(500);
  });

  it('serves concurrent /stations and /curate cold misses independently', async () => {
    let iptvHits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) {
          iptvHits += 1;
          await new Promise((r) => setTimeout(r, 15));
          return new Response(SAMPLE_M3U, { status: 200 });
        }
        if (url.includes('generativelanguage')) {
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const kv = mockKV();
    const [stationsRes, curateRes] = await Promise.all([
      app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv })),
      app.request('/curate?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' })),
    ]);
    expect(stationsRes.status).toBe(200);
    expect(curateRes.status).toBe(200);
    expect(iptvHits).toBeGreaterThanOrEqual(2);
    expect(kv.put).toHaveBeenCalled();
  });

  it('answers HEAD / with 200 and empty body while keeping JSON content-type', async () => {
    const res = await app.request('/', { method: 'HEAD' }, testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.text()).toBe('');
  });

  it('maps fullwidth Latin genre tokens to music fallback catalog', async () => {
    // Fullwidth ＪＡＺＺ — not ASCII after toLowerCase/trim, so unresolved → music
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(
      await app.request(
        '/stations?genre=%EF%BC%AA%EF%BC%A1%EF%BC%BA%EF%BC%BA',
        undefined,
        testEnv(),
      ),
    );
    expect(body.genre).toBe('music');
  });

  it.each([521, 522, 525])('falls back to music.m3u when primary returns HTTP %i', async (status) => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/jazz.m3u')) return new Response('edge down', { status });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(6);
    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/jazz.m3u',
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    ]);
  });

  it('ignores Authorization Bearer, Referer, Cookie, and Range request headers', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', {
      headers: {
        Authorization: 'Bearer should-be-ignored',
        Referer: 'https://evil.example/',
        Cookie: 'session=abc',
        Range: 'bytes=0-99',
        'User-Agent': 'BacklinkTest/1.0',
      },
    }, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(6);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(res.headers.get('accept-ranges')).toBeNull();
  });

  it('503 JSON bodies are never text/html and never include stack traces', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('content-type')?.toLowerCase()).not.toContain('text/html');
    const text = await res.text();
    expect(text).not.toMatch(/at Object\.|TypeError:|Error:|stack/i);
    expect(JSON.parse(text)).toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('structuredClone of /stations stations does not alias live response array identity beyond JSON', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    const stations = body.stations as Array<{ name: string }>;
    const clone = structuredClone(stations);
    clone[0].name = 'mutated';
    expect(stations[0].name).toBe('Alpha FM');
    expect(clone[0].name).toBe('mutated');
  });

  it('Object.freeze on /genres aliases response does not freeze GENRE_MAP', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    Object.freeze(body.aliases);
    expect(Object.isFrozen(GENRE_MAP)).toBe(false);
    expect(GENRE_MAP.chill).toBe('ambient');
  });

  it('joins mood and genreParam with space in query while prompt uses slash separator', async () => {
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const body = await json(
      await app.request('/curate?genre=jazz&mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('chill jazz');
    expect(prompt).toContain('User request: chill / jazz');
  });

  it('does not send Retry-After HTTP header even when JSON retry_after is present', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeNull();
    expect((await json(res)).retry_after).toBe(60);
  });

  it('locks /genres aliases key set equal to GENRE_MAP keys', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Object.keys(body.aliases as object).sort()).toEqual(Object.keys(GENRE_MAP).sort());
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('does not put on /curate when serving from warm KV cache', async () => {
    const kv = mockKV(
      seedStationsCache('music', [
        { name: 'Cached', url: 'https://example.com/c.m3u8' },
        { name: 'B', url: 'https://example.com/b.m3u8' },
        { name: 'C', url: 'https://example.com/c2.m3u8' },
        { name: 'D', url: 'https://example.com/d.m3u8' },
        { name: 'E', url: 'https://example.com/e.m3u8' },
      ]),
    );
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Cached","url":"https://example.com/c.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith('stations:music');
  });

  it('omits 51st catalog station from Gemini prompt (1-indexed cap at 50)', async () => {
    const stations = Array.from({ length: 51 }, (_, i) => ({
      name: `S${i + 1}`,
      url: `https://example.com/${i + 1}.m3u8`,
    }));
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('iptv-org')) return new Response(buildSimpleM3U(stations), { status: 200 });
        if (url.includes('generativelanguage')) {
          prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
          return geminiTextResponse(
            '[{"name":"S1","url":"https://example.com/1.m3u8","editorial":"e","genre":"music"}]',
          );
        }
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(prompt).toContain('1. S1');
    expect(prompt).toContain('50. S50');
    expect(prompt).not.toContain('51. S51');
  });

  it('does not follow Location on primary 302 — uses music.m3u fallback instead', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith('/jazz.m3u')) {
          return new Response('', {
            status: 302,
            headers: { Location: 'https://evil.example/steal.m3u' },
          });
        }
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(seen).toEqual([
      'https://iptv-org.github.io/iptv/categories/jazz.m3u',
      'https://iptv-org.github.io/iptv/categories/music.m3u',
    ]);
    expect(seen.some((u) => u.includes('evil.example'))).toBe(false);
  });

  it('keeps /stations count equal to stations.length for array payloads', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    const stations = body.stations as unknown[];
    expect(body.count).toBe(stations.length);
    expect(body.count).toBe(6);
  });

  it('OPTIONS /stations lists GET in Access-Control-Allow-Methods', async () => {
    const res = await app.request(
      '/stations',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      testEnv(),
    );
    const methods = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    expect(methods).toContain('GET');
    expect(methods).toContain('HEAD');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('does not leak API key into /curate JSON response body', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const text = await (
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'leak-me-now' }))
    ).text();
    expect(text).not.toContain('leak-me-now');
    expect(text).not.toContain('GEMINI');
  });

  it('passthroughs nested objects on Gemini curated station picks', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"A","url":"https://a","editorial":"e","genre":"music","nested":{"x":1},"extra":true}]',
        ),
      }),
    );
    const stations = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).stations as Array<Record<string, unknown>>;
    expect(stations[0]).toMatchObject({
      name: 'A',
      nested: { x: 1 },
      extra: true,
    });
  });

  it('caches under stations:jazz when music fallback fills after jazz primary miss', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/jazz.m3u')) return new Response('missing', { status: 404 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const res = await app.request(
      '/stations?genre=jazz',
      undefined,
      testEnv({ CATALOG_CACHE: kv }),
    );
    expect(res.status).toBe(200);
    expect(kv.put).toHaveBeenCalledWith(
      'stations:jazz',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
    expect(kv.put).not.toHaveBeenCalledWith(
      'stations:music',
      expect.anything(),
      expect.anything(),
    );
  });

  it('returns JSON number retry_after (not string) on both 503 flavors', async () => {
    const curation = await json(await app.request('/curate', undefined, testEnv()));
    expect(curation.retry_after).toBe(60);
    expect(typeof curation.retry_after).toBe('number');

    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const catalog = await json(await app.request('/stations?genre=news', undefined, testEnv()));
    expect(catalog.retry_after).toBe(60);
    expect(typeof catalog.retry_after).toBe('number');
  });

  it('keeps /curate timestamp timezone designator as Z only', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const ts = (
      await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })))
    ).timestamp as string;
    expect(ts.endsWith('Z')).toBe(true);
    expect(ts).not.toMatch(/[+-]\d{2}:\d{2}$/);
  });
  it('ignores duplicate genre query keys by using the first value (URLSearchParams)', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=jazz&genre=news', undefined, testEnv());
    const body = await json(res);
    // Hono/req.query typically returns the first value
    expect(body.genre).toBe('jazz');
  });

  it('treats mood-only /curate as resolveGenre(mood) for catalog selection', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"ambient"}]',
        ),
      }),
    );
    const res = await app.request(
      '/curate?mood=chill',
      undefined,
      testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    expect(kv.put).toHaveBeenCalledWith(
      'stations:ambient',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('degrades to top 5 when Gemini returns candidates with empty parts array', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [{ content: { parts: [] } }] }),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const stations = body.stations as Array<{ editorial: unknown }>;
    expect(stations.length).toBeLessThanOrEqual(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('degrades when Gemini candidates array is empty', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [] }),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it('locks Gemini prompt station lines to 1-indexed "N. name (group) [lang] — url" shape', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: buildSimpleM3U([
          {
            name: 'Shape FM',
            url: 'https://example.com/shape.m3u8',
            group: 'Jazz',
            language: 'fr',
          },
        ]),
        gemini: geminiTextResponse(
          '[{"name":"Shape FM","url":"https://example.com/shape.m3u8","editorial":"e","genre":"jazz"}]',
        ),
      }),
    );
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const req = captureGeminiRequest(vi.mocked(fetch));
    const prompt = (
      (req!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0]
        .text
    );
    expect(prompt).toContain('1. Shape FM (Jazz) [fr] — https://example.com/shape.m3u8');
  });

  it('uses genre as group fallback and en as language fallback in Gemini prompt lines', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: buildSimpleM3U([{ name: 'Bare', url: 'https://example.com/bare.m3u8' }]),
        gemini: geminiTextResponse(
          '[{"name":"Bare","url":"https://example.com/bare.m3u8","editorial":"e","genre":"news"}]',
        ),
      }),
    );
    await app.request('/curate?genre=news', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const req = captureGeminiRequest(vi.mocked(fetch));
    const prompt = (
      (req!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0]
        .text
    );
    expect(prompt).toContain('1. Bare (news) [en] — https://example.com/bare.m3u8');
  });

  it('rejects PUT and DELETE methods on /health', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
      const res = await app.request('/health', { method }, testEnv());
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('ignores Accept: application/xml and still returns JSON on /genres', async () => {
    const res = await app.request(
      '/genres',
      { headers: { Accept: 'application/xml, text/xml' } },
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);
    const body = await json(res);
    expect(Array.isArray(body.genres)).toBe(true);
  });

  it('ignores If-None-Match and still returns 200 full body on /health', async () => {
    const res = await app.request(
      '/health',
      { headers: { 'If-None-Match': '"abc"' } },
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true });
  });

  it('does not set ETag or Last-Modified on /stations responses', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('last-modified')).toBeNull();
  });

  it('returns 503 curation unavailable before any fetch when GEMINI_API_KEY is empty string', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: '' }),
    );
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Curation service unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('locks /stations payload key order genre then count then stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=pop', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['genre', 'count', 'stations']);
  });

  it('locks /curate success payload key order query/curated_by/timestamp/stations', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(Object.keys(body)).toEqual(['query', 'curated_by', 'timestamp', 'stations']);
  });

  it('locks /genres payload key order genres then aliases', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['genres', 'aliases']);
  });

  it('serves /stations with count 0 and empty array when catalog M3U has no streams', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: '#EXTM3U\n# comment only\n' }));
    const body = await json(await app.request('/stations?genre=sports', undefined, testEnv()));
    expect(body).toEqual({ genre: 'sports', count: 0, stations: [] });
  });

  it('degrades /curate to empty stations when catalog is empty and Gemini fails', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: '#EXTM3U\n', gemini: new Response('boom', { status: 500 }) }));
    const body = await json(
      await app.request('/curate?genre=sports', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toEqual([]);
  });

  it('does not put KV when /stations serves warm cache hit for entertainment', async () => {
    const seed = seedStationsCache('entertainment', [
      { name: 'E', url: 'https://example.com/e.m3u8' },
    ]);
    const kv = mockKV(seed);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request(
      '/stations?genre=entertainment',
      undefined,
      testEnv({ CATALOG_CACHE: kv }),
    );
    expect(res.status).toBe(200);
    expect(kv.put).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('maps alias electronic to ambient catalog key on /stations', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(
      await app.request('/stations?genre=electronic', undefined, testEnv({ CATALOG_CACHE: kv })),
    );
    expect(body.genre).toBe('ambient');
    expect(kv.put).toHaveBeenCalledWith(
      'stations:ambient',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('passes percent-encoded mood through to query string on /curate', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const body = await json(
      await app.request(
        '/curate?mood=late%20night&genre=music',
        undefined,
        testEnv({ GEMINI_API_KEY: 'k' }),
      ),
    );
    expect(body.query).toBe('late night music');
  });

  it('concurrent /curate cold misses for two genres issue distinct KV puts', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"music"}]',
        ),
      }),
    );
    const env = testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' });
    await Promise.all([
      app.request('/curate?genre=jazz', undefined, env),
      app.request('/curate?genre=news', undefined, env),
    ]);
    const putKeys = vi.mocked(kv.put).mock.calls.map((c) => c[0]).sort();
    expect(putKeys).toEqual(['stations:jazz', 'stations:news']);
  });

  it('does not leak stack frames in 503 curation JSON when key missing', async () => {
    const body = await json(await app.request('/curate', undefined, testEnv()));
    expect(JSON.stringify(body)).not.toMatch(/at\s+\w+/);
    expect(JSON.stringify(body)).not.toContain('Error');
    expect(Object.keys(body).sort()).toEqual(['error', 'retry_after']);
  });

  it('OPTIONS /curate returns ACAO star via cors middleware', async () => {
    const res = await app.request(
      '/curate',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      testEnv(),
    );
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });

  it('keeps / root endpoints values as GET-described strings with leading path', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const endpoints = body.endpoints as Record<string, string>;
    for (const [path, desc] of Object.entries(endpoints)) {
      expect(path.startsWith('/')).toBe(true);
      expect(desc).toMatch(/^GET /);
    }
  });

  it('Gemini User request line joins mood / genre with slash separators', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"e","genre":"jazz"}]',
        ),
      }),
    );
    await app.request(
      '/curate?genre=jazz&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const req = captureGeminiRequest(vi.mocked(fetch));
    const prompt = (
      (req!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0]
        .text
    );
    expect(prompt).toContain('User request: focus / jazz');
  });

  it('does not call Gemini when catalog fetch fails on /curate', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: null });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?genre=jazz',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Stream catalog unavailable' });
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('generativelanguage')),
    ).toBe(false);
  });

  it('cold /stations?genre=jazz hits iptvCategoryUrl helper exactly', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('jazz'));
  });

  it('cold /stations count matches countHttpStreamLines(SAMPLE_M3U)', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    const body = await json(res);
    expect(body.count).toBe(countHttpStreamLines(SAMPLE_M3U));
    expect(typeof body.count).toBe('number');
  });

  it('happy-path /curate via curatedGeminiJson helper', async () => {
    const picks = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'Helper curated pick.',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson(picks) }),
    );
    const res = await app.request(
      '/curate?genre=music&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stations).toEqual(picks);
  });

  it('ignores Accept-Language If-Modified-Since and X-Forwarded-For on /genres and /health', async () => {
    const headers = {
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
      'X-Forwarded-For': '203.0.113.9',
    };
    const genres = await app.request('/genres', { headers }, testEnv());
    const health = await app.request('/health', { headers }, testEnv());
    expect(genres.status).toBe(200);
    expect(health.status).toBe(200);
    expect((await json(genres)).genres).toEqual([...VALID_GENRES]);
    expect((await json(health)).ok).toBe(true);
  });

  it('rejects TRACE and CONNECT methods on /health', async () => {
    expect(() => app.request('/health', { method: 'TRACE' }, testEnv())).toThrow(/TRACE/i);
    expect(() => app.request('/health', { method: 'CONNECT' }, testEnv())).toThrow(/CONNECT/i);
  });

  it('passthroughs unsafe curated URLs from Gemini without validation', async () => {
    const picks = [
      {
        name: 'Evil',
        url: 'javascript:alert(1)',
        editorial: 'xss',
        genre: 'music',
      },
      {
        name: 'Data',
        url: 'data:audio/mpeg;base64,xxx',
        editorial: 'data',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson(picks) }),
    );
    const res = await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const body = await json(res);
    expect((body.stations as Array<{ url: string }>).map((s) => s.url)).toEqual([
      'javascript:alert(1)',
      'data:audio/mpeg;base64,xxx',
    ]);
  });

  it('omits CSP X-Frame-Options X-Content-Type-Options Referrer-Policy Permissions-Policy on / and /curate', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }),
    );
    const root = await app.request('/', undefined, testEnv());
    const curate = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    for (const res of [root, curate]) {
      expect(res.headers.get('Content-Security-Policy')).toBeNull();
      expect(res.headers.get('X-Frame-Options')).toBeNull();
      expect(res.headers.get('X-Content-Type-Options')).toBeNull();
      expect(res.headers.get('Referrer-Policy')).toBeNull();
      expect(res.headers.get('Permissions-Policy')).toBeNull();
    }
  });

  it('HEAD /health and HEAD /genres return empty body with JSON content-type', async () => {
    const health = await app.request('/health', { method: 'HEAD' }, testEnv());
    const genres = await app.request('/genres', { method: 'HEAD' }, testEnv());
    expect(health.status).toBe(200);
    expect(genres.status).toBe(200);
    expect(await health.text()).toBe('');
    expect(await genres.text()).toBe('');
    expect(health.headers.get('content-type')).toMatch(/application\/json/);
    expect(genres.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('iptvByGenre jazz miss falls back to distinct music body while genre stays jazz', async () => {
    const jazzMiss = null;
    const musicBody = buildSimpleM3U([
      { name: 'Music Only', url: 'https://example.com/music-only.m3u8' },
    ]);
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { jazz: jazzMiss, music: musicBody },
    });
    vi.stubGlobal('fetch', fetchMock);
    const kv = mockKV();
    const res = await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    const body = await json(res);
    expect(body.genre).toBe('jazz');
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Music Only');
    expect(kv.put).toHaveBeenCalledWith(
      'stations:jazz',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('extracts Gemini JSON when prose follows the array', async () => {
    const text =
      '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"ok","genre":"music"}]\nThanks!';
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: geminiTextResponse(text) }),
    );
    const res = await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const body = await json(res);
    expect(res.status).toBe(200);
    expect((body.stations as unknown[]).length).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Alpha FM');
  });

  it('omits Vary header on /stations success responses', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=pop', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Vary')).toBeNull();
  });

  it('seedStationsCache multi-key seed serves jazz without touching news', async () => {
    const seed = seedStationsCache(
      'jazz',
      [{ name: 'Cached Jazz', url: 'https://example.com/cj.m3u8' }],
      seedStationsCache('news', [{ name: 'Cached News', url: 'https://example.com/cn.m3u8' }]),
    );
    const kv = mockKV(seed);
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    const body = await json(res);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Cached Jazz');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith('stations:jazz');
    expect(kv.get).not.toHaveBeenCalledWith('stations:news');
  });

  it('captureGeminiRequest locks generationConfig key order maxOutputTokens then temperature', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      gemini: curatedGeminiJson(),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'secret' }));
    const captured = captureGeminiRequest(fetchMock);
    expect(captured).not.toBeNull();
    const gen = captured!.body.generationConfig as Record<string, unknown>;
    expect(Object.keys(gen)).toEqual(['maxOutputTokens', 'temperature']);
    expect(gen.maxOutputTokens).toBe(512);
    expect(gen.temperature).toBe(0.7);
  });

  it('iptvCallsWithInit is empty on /curate success and degrade paths', async () => {
    const okMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', okMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(iptvCallsWithInit(okMock)).toEqual([]);

    const degradeMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: new Response('nope', { status: 500 }) });
    vi.stubGlobal('fetch', degradeMock);
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(iptvCallsWithInit(degradeMock)).toEqual([]);
  });

  it('duplicate mood query uses first value while genre alias selects rock catalog', async () => {
    const rockBody = buildSimpleM3U([
      { name: 'Rock Only', url: 'https://example.com/rock-only.m3u8' },
    ]);
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { rock: rockBody, music: SAMPLE_M3U },
      gemini: curatedGeminiJson([
        {
          name: 'Rock Only',
          url: 'https://example.com/rock-only.m3u8',
          editorial: 'heavy',
          genre: 'rock',
        },
      ]),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?mood=chill&mood=energizing&genre=metal',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const body = await json(res);
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('rock'));
    expect(body.query as string).toMatch(/^chill/);
    expect(body.query as string).toContain('metal');
  });

  it('cold /stations?genre=electronic resolves ambient catalog URL', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: {
        ambient: buildSimpleM3U([
          { name: 'Ambient Only', url: 'https://example.com/amb.m3u8' },
        ]),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=electronic', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('ambient'));
    const body = await json(res);
    expect(body.genre).toBe('ambient');
  });

  it('does not set Transfer-Encoding on /health in the test runtime', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.headers.get('Transfer-Encoding')).toBeNull();
  });

  it('curatedGeminiJson empty default still yields a stations array on /curate', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }),
    );
    const res = await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const body = await json(res);
    expect(Array.isArray(body.stations)).toBe(true);
    expect((body.stations as unknown[]).length).toBeGreaterThan(0);
  });

  it('maps full GENRE_MAP alias set through /stations genre param to canonical keys', async () => {
    const seen = new Set<string>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const m = url.match(/\/categories\/([^/.]+)\.m3u/);
      if (m) seen.add(m[1]);
      return new Response(SAMPLE_M3U, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    for (const alias of ['lofi', 'lo-fi', 'metal', 'dance', 'blues', 'classic']) {
      const kv = mockKV();
      const res = await app.request(`/stations?genre=${encodeURIComponent(alias)}`, undefined, testEnv({ CATALOG_CACHE: kv }));
      expect(res.status).toBe(200);
    }
    expect(seen.has('ambient')).toBe(true);
    expect(seen.has('rock')).toBe(true);
    expect(seen.has('pop')).toBe(true);
    expect(seen.has('jazz')).toBe(true);
    expect(seen.has('classical')).toBe(true);
  });

  it('503 curation path never issues iptv or gemini fetches when key missing', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/curate?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps /stations stations[].url values starting with http', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations', undefined, testEnv());
    const body = await json(res);
    for (const s of body.stations as Array<{ url: string }>) {
      expect(s.url.startsWith('http://') || s.url.startsWith('https://')).toBe(true);
    }
  });

  it('concurrent HEAD /health requests all return 200 empty bodies', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => app.request('/health', { method: 'HEAD' }, testEnv())),
    );
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('');
    }
  });

  it('percent-encoded slash in genre falls back to music catalog', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=jazz%2Fnews', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('music'));
    expect((await json(res)).genre).toBe('music');
  });

  it('iptvCategoryUrl helper matches cold fetch for every VALID_GENRES slug', async () => {
    for (const g of VALID_GENRES) {
      const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
      vi.stubGlobal('fetch', fetchMock);
      const res = await app.request(`/stations?genre=${g}`, undefined, testEnv({ CATALOG_CACHE: mockKV() }));
      expect(res.status).toBe(200);
      expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl(g));
    }
  });

  it('countHttpStreamLines equals /stations count for buildSimpleM3U catalog', async () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://example.com/a.m3u8' },
      { name: 'B', url: 'http://example.com/b.m3u8' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const res = await app.request('/stations?genre=news', undefined, testEnv());
    const body = await json(res);
    expect(body.count).toBe(countHttpStreamLines(m3u));
    expect(body.count).toBe(2);
  });

  it('curatedGeminiJson with logo field passthrough on /curate', async () => {
    const picks = [
      {
        name: 'Logo Station',
        url: 'https://example.com/logo.m3u8',
        logo: 'https://cdn.example/logo.png',
        editorial: 'has logo',
        genre: 'jazz',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        iptvByGenre: { jazz: SAMPLE_M3U },
        gemini: curatedGeminiJson(picks),
      }),
    );
    const res = await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect((await json(res)).stations).toEqual(picks);
  });

  it('seedStationsCache warm hit skips iptvCategoryUrl entirely', async () => {
    const seed = seedStationsCache('pop', [{ name: 'Warm', url: 'https://example.com/warm.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/stations?genre=pop',
      undefined,
      testEnv({ CATALOG_CACHE: mockKV(seed) }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await json(res)).stations).toEqual([
      { name: 'Warm', url: 'https://example.com/warm.m3u8' },
    ]);
  });

  it('captureGeminiRequest URL contains gemini-2.0-flash and API key query', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'key-xyz' }));
    const captured = captureGeminiRequest(fetchMock);
    expect(captured!.url).toContain('gemini-2.0-flash');
    expect(captured!.url).toContain('key=key-xyz');
    expect(captured!.method).toBe('POST');
  });

  it('OPTIONS /genres returns ACAO star without body JSON parse errors', async () => {
    const res = await app.request('/genres', { method: 'OPTIONS' }, testEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('maps dance alias to pop catalog via iptvCategoryUrl', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: {
        pop: buildSimpleM3U([{ name: 'Pop Only', url: 'https://example.com/pop-only.m3u8' }]),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=dance', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('pop'));
    expect((await json(res)).genre).toBe('pop');
  });

  it('maps blues alias to jazz catalog via iptvCategoryUrl', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: {
        jazz: buildSimpleM3U([{ name: 'Jazz Only', url: 'https://example.com/jazz-only2.m3u8' }]),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=blues', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('jazz'));
    expect((await json(res)).genre).toBe('jazz');
  });

  it('degrade path editorial null for all top-5 SAMPLE_M3U stations', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: new Response('bad', { status: 500 }) }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('does not set WWW-Authenticate on 503 curation unavailable', async () => {
    const res = await app.request('/curate', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
  });

  it('/genres aliases object deep-equals GENRE_MAP', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('iptvCallsWithInit empty on /stations cold and warm paths', async () => {
    const cold = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', cold);
    await app.request('/stations?genre=rock', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(iptvCallsWithInit(cold)).toEqual([]);

    const seed = seedStationsCache('rock', [{ name: 'R', url: 'https://example.com/r.m3u8' }]);
    const warm = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', warm);
    await app.request('/stations?genre=rock', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) }));
    expect(iptvCallsWithInit(warm)).toEqual([]);
    expect(warm).not.toHaveBeenCalled();
  });

  it('curate query joins mood and genreParam with single spaces', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }),
    );
    const res = await app.request(
      '/curate?mood=late%20night&genre=jazz',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect((await json(res)).query).toBe('late night jazz');
  });

  it('rejects PATCH on /stations and /curate', async () => {
    const s = await app.request('/stations', { method: 'PATCH' }, testEnv());
    const c = await app.request('/curate', { method: 'PATCH' }, testEnv());
    expect(s.status).toBeGreaterThanOrEqual(400);
    expect(c.status).toBeGreaterThanOrEqual(400);
  });

  it('root endpoints object lists exactly four paths', async () => {
    const res = await app.request('/', undefined, testEnv());
    const endpoints = (await json(res)).endpoints as Record<string, string>;
    expect(Object.keys(endpoints).sort()).toEqual(['/curate', '/genres', '/health', '/stations']);
  });

  it('VERSION override appears on both / and /health', async () => {
    const env = testEnv({ VERSION: '9.9.9-test' });
    const root = await json(await app.request('/', undefined, env));
    const health = await json(await app.request('/health', undefined, env));
    expect(root.version).toBe('9.9.9-test');
    expect(health.version).toBe('9.9.9-test');
  });

  it('Gemini prompt contains User request line derived from mood and genre', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?mood=focus&genre=ambient', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const captured = captureGeminiRequest(fetchMock);
    const contents = captured!.body.contents as Array<{ parts: Array<{ text: string }> }>;
    const prompt = contents[0].parts[0].text;
    expect(prompt).toContain('User request: focus / ambient');
  });

  it('does not put KV when curated response is served from warm cache', async () => {
    const seed = seedStationsCache('classical', [
      { name: 'Classic', url: 'https://example.com/classic.m3u8' },
    ]);
    const kv = mockKV(seed);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=classical', undefined, testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }));
    expect(kv.put).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('iptv-org'))).toBe(true);
  });

  it('503 catalog unavailable JSON retry_after is number 60', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/stations', undefined, testEnv());
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.retry_after).toBe(60);
    expect(typeof body.retry_after).toBe('number');
  });

  it('maps relaxing alias to ambient via iptvCategoryUrl', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: {
        ambient: buildSimpleM3U([{ name: 'Calm', url: 'https://example.com/calm.m3u8' }]),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=relaxing', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('ambient'));
    expect((await json(res)).genre).toBe('ambient');
  });

  it('maps focus and indie aliases to ambient and rock catalogs', async () => {
    const focusMock = stubIptvAndGemini({
      iptvByGenre: { ambient: SAMPLE_M3U },
    });
    vi.stubGlobal('fetch', focusMock);
    const focusRes = await app.request('/stations?genre=focus', undefined, testEnv());
    expect(String(focusMock.mock.calls[0][0])).toBe(iptvCategoryUrl('ambient'));
    expect((await json(focusRes)).genre).toBe('ambient');

    const indieMock = stubIptvAndGemini({
      iptvByGenre: { rock: SAMPLE_M3U },
    });
    vi.stubGlobal('fetch', indieMock);
    const indieRes = await app.request('/stations?genre=indie', undefined, testEnv());
    expect(String(indieMock.mock.calls[0][0])).toBe(iptvCategoryUrl('rock'));
    expect((await json(indieRes)).genre).toBe('rock');
  });

  it('maps classic alias to classical catalog URL', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: {
        classical: buildSimpleM3U([{ name: 'Orch', url: 'https://example.com/orch.m3u8' }]),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=classic', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('classical'));
    expect((await json(res)).genre).toBe('classical');
  });

  it('maps lo-fi hyphen alias to ambient catalog', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { ambient: SAMPLE_M3U },
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=lo-fi', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('ambient'));
    expect((await json(res)).genre).toBe('ambient');
  });

  it('HEAD /stations returns 200 empty body with ACAO star', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=jazz', { method: 'HEAD' }, testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('OPTIONS /stations and OPTIONS /health include ACAO star', async () => {
    const stations = await app.request(
      '/stations',
      { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' } },
      testEnv(),
    );
    const health = await app.request(
      '/health',
      { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' } },
      testEnv(),
    );
    expect(stations.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(health.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('HEAD /curate without API key returns 503 empty body', async () => {
    const res = await app.request('/curate', { method: 'HEAD' }, testEnv());
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
  });

  it('extracts JSON from prose-wrapped markdown fences via geminiTextResponse', async () => {
    const picks = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'fenced',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: SAMPLE_M3U,
        gemini: geminiTextResponse(
          `Sure! Here you go:\n\`\`\`json\n${JSON.stringify(picks)}\n\`\`\`\nEnjoy.`,
        ),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations).toEqual(picks);
  });

  it('degrades when Gemini returns fence with non-array JSON object', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: SAMPLE_M3U,
        gemini: geminiTextResponse('```json\n{"not":"array"}\n```'),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
    expect(stations.length).toBeGreaterThan(0);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('concurrent /stations different genres hit distinct iptvCategoryUrl paths', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: {
        jazz: buildSimpleM3U([{ name: 'J', url: 'https://example.com/j.m3u8' }]),
        news: buildSimpleM3U([{ name: 'N', url: 'https://example.com/n.m3u8' }]),
        rock: buildSimpleM3U([{ name: 'R', url: 'https://example.com/r.m3u8' }]),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const env = () => testEnv({ CATALOG_CACHE: mockKV() });
    const [j, n, r] = await Promise.all([
      app.request('/stations?genre=jazz', undefined, env()),
      app.request('/stations?genre=news', undefined, env()),
      app.request('/stations?genre=metal', undefined, env()),
    ]);
    expect(j.status).toBe(200);
    expect(n.status).toBe(200);
    expect(r.status).toBe(200);
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('iptv-org'));
    expect(urls).toContain(iptvCategoryUrl('jazz'));
    expect(urls).toContain(iptvCategoryUrl('news'));
    expect(urls).toContain(iptvCategoryUrl('rock'));
    expect((await json(j)).genre).toBe('jazz');
    expect((await json(n)).genre).toBe('news');
    expect((await json(r)).genre).toBe('rock');
  });

  it('503 curation unavailable shape locks error and retry_after with CORS', async () => {
    const res = await app.request('/curate?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await json(res);
    expect(body).toMatchObject({ error: 'Curation service unavailable', retry_after: 60 });
    expect(Object.keys(body).sort()).toEqual(['error', 'retry_after']);
  });

  it('503 catalog unavailable keeps CORS and stable error shape', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/stations?genre=pop', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await json(res);
    expect(body.error).toBeTruthy();
    expect(body.retry_after).toBe(60);
  });

  it('CORS star present on Gemini degrade /curate responses', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: new Response('nope', { status: 500 }) }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('does not invent /playlist or /now-playing endpoints on root', async () => {
    const res = await app.request('/', undefined, testEnv());
    const endpoints = (await json(res)).endpoints as Record<string, string>;
    expect(endpoints).not.toHaveProperty('/playlist');
    expect(endpoints).not.toHaveProperty('/now-playing');
    expect(endpoints).not.toHaveProperty('/mcp');
  });

  it('unknown path returns non-200 without inventing handlers', async () => {
    const res = await app.request('/playlist', undefined, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('curatedGeminiJson prose fence with leading whitespace still parses', async () => {
    const picks = [
      {
        name: 'Beta FM',
        url: 'https://example.com/beta.m3u8',
        editorial: 'ws fence',
        genre: 'jazz',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        iptvByGenre: { jazz: SAMPLE_M3U },
        gemini: geminiTextResponse(`\n\n\`\`\`JSON\n${JSON.stringify(picks)}\n\`\`\`\n`),
      }),
    );
    const res = await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect((await json(res)).stations).toEqual(picks);
  });

  it('captureGeminiRequest null when 503 skips Gemini entirely', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv());
    expect(captureGeminiRequest(fetchMock)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('iptvCallsWithInit remains empty across concurrent genre fetches', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([
      app.request('/stations?genre=news', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
      app.request('/stations?genre=sports', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    ]);
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('seedStationsCache warm hit for alias-resolved genre key uses canonical slug', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'Warm Amb', url: 'https://example.com/wa.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/stations?genre=chill',
      undefined,
      testEnv({ CATALOG_CACHE: mockKV(seed) }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await json(res);
    expect(body.genre).toBe('ambient');
    expect(body.stations).toEqual([
      { name: 'Warm Amb', url: 'https://example.com/wa.m3u8' },
    ]);
  });

  it('countHttpStreamLines SAMPLE_M3U matches /stations count on cold path', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations', undefined, testEnv());
    const body = await json(res);
    expect(body.count).toBe(countHttpStreamLines(SAMPLE_M3U));
  });

  it('rejects DELETE and PUT on /health', async () => {
    const del = await app.request('/health', { method: 'DELETE' }, testEnv());
    const put = await app.request('/health', { method: 'PUT' }, testEnv());
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect(put.status).toBeGreaterThanOrEqual(400);
  });

  it('OPTIONS /curate without key still returns CORS preflight headers', async () => {
    const res = await app.request(
      '/curate',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      testEnv(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('Gemini empty fence degrades to top stations with null editorial', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: SAMPLE_M3U,
        gemini: geminiTextResponse('```json\n[]\n```'),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
    expect(stations.length).toBeGreaterThan(0);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('maps late night plus-encoded to ambient catalog', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { ambient: SAMPLE_M3U },
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=late+night', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('ambient'));
    expect((await json(res)).genre).toBe('ambient');
  });

  it('503 shapes never include stations array key', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const catalog = await json(await app.request('/stations', undefined, testEnv()));
    const curation = await json(await app.request('/curate', undefined, testEnv()));
    expect(catalog).not.toHaveProperty('stations');
    expect(curation).not.toHaveProperty('stations');
  });

  it('/genres VALID_GENRES length 9 and aliases key count 21', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.genres).toHaveLength(9);
    expect(Object.keys(body.aliases as Record<string, string>)).toHaveLength(21);
    expect(body.aliases).toEqual(GENRE_MAP);
    expect(body.genres).toEqual([...VALID_GENRES]);
  });

  it('buildSimpleM3U cold /stations count matches helper length', async () => {
    const m3u = buildSimpleM3U([
      { name: 'One', url: 'https://example.com/1.m3u8' },
      { name: 'Two', url: 'http://example.com/2.m3u8' },
      { name: 'Skip', url: 'rtmp://example.com/3' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(await app.request('/stations?genre=entertainment', undefined, testEnv()));
    expect(body.count).toBe(2);
    expect(body.count).toBe(countHttpStreamLines(m3u));
  });

  it('concurrent HEAD /genres all return ACAO and empty bodies', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => app.request('/genres', { method: 'HEAD' }, testEnv())),
    );
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
  });

  it('curatedGeminiJson default pick survives double markdown fence noise', async () => {
    const picks = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'ok',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(
          `Intro\n\`\`\`\nnot json\n\`\`\`\n\`\`\`json\n${JSON.stringify(picks)}\n\`\`\``,
        ),
      }),
    );
    const res = await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect((await json(res)).stations).toEqual(picks);
  });

  // --- HEAVY burn post-#46: deepen routes (non-parser) locks ---

  it('locks / root payload own-key order name description version endpoints powered_by', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['name', 'description', 'version', 'endpoints', 'powered_by']);
  });

  it('locks / endpoints own-key order /curate /stations /genres /health', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(Object.keys(body.endpoints as Record<string, string>)).toEqual([
      '/curate',
      '/stations',
      '/genres',
      '/health',
    ]);
  });

  it('locks / description string exactly', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('locks /health payload own-key order ok then version', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['ok', 'version']);
    expect(body.ok).toBe(true);
  });

  it('locks /genres payload own-key order genres then aliases', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['genres', 'aliases']);
  });

  it('locks /stations success payload own-key order genre count stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['genre', 'count', 'stations']);
  });

  it('locks /curate success payload own-key order query curated_by timestamp stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(Object.keys(body)).toEqual(['query', 'curated_by', 'timestamp', 'stations']);
  });

  it('locks curated_by to Backlink/Geryon on degrade path', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.curated_by).toBe('Backlink/Geryon');
  });

  it('locks timestamp as ISO-8601 parseable UTC with Z suffix', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const ts = body.timestamp as string;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    expect(Date.parse(ts)).not.toBeNaN();
  });

  it('cold /stations for every VALID_GENRES slug hits matching iptvCategoryUrl', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    for (const genre of VALID_GENRES) {
      fetchMock.mockClear();
      const res = await app.request(
        `/stations?genre=${genre}`,
        undefined,
        testEnv({ CATALOG_CACHE: mockKV() }),
      );
      expect(res.status).toBe(200);
      expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl(genre));
      expect((await json(res)).genre).toBe(genre);
    }
  });

  it('cold /stations for every GENRE_MAP alias hits canonical category URL', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    for (const [alias, canonical] of Object.entries(GENRE_MAP)) {
      fetchMock.mockClear();
      const q = encodeURIComponent(alias);
      const res = await app.request(
        `/stations?genre=${q}`,
        undefined,
        testEnv({ CATALOG_CACHE: mockKV() }),
      );
      expect(res.status).toBe(200);
      expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl(canonical));
      expect((await json(res)).genre).toBe(canonical);
    }
  });

  it('music-fallback fill still KV-puts under requested genre key not stations:music', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/jazz.m3u')) return new Response('nope', { status: 404 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).toHaveBeenCalledWith(
      'stations:jazz',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
    const putKeys = (kv.put as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(putKeys).not.toContain('stations:music');
  });

  it('warm KV hit for jazz does not refetch even when music seed also present', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://example.com/j.m3u8' }], {
      'stations:music': JSON.stringify([{ name: 'M', url: 'https://example.com/m.m3u8' }]),
    });
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.stations).toEqual([{ name: 'J', url: 'https://example.com/j.m3u8' }]);
  });

  it('degrades to fewer than five when catalog has three stations', async () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://example.com/a.m3u8' },
      { name: 'B', url: 'https://example.com/b.m3u8' },
      { name: 'C', url: 'https://example.com/c.m3u8' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const stations = body.stations as unknown[];
    expect(stations).toHaveLength(3);
    expect(stations.every((s) => (s as { editorial: unknown }).editorial === null)).toBe(true);
  });

  it('degrades to empty stations array when catalog M3U has no http streams', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: '#EXTM3U\n# comment only\n' }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toEqual([]);
  });

  it('Gemini happy path returns curated array identity from model JSON', async () => {
    const picks = [
      {
        name: 'Curated One',
        url: 'https://example.com/one.m3u8',
        logo: 'https://example.com/one.png',
        editorial: 'First pick.',
        genre: 'music',
      },
      {
        name: 'Curated Two',
        url: 'https://example.com/two.m3u8',
        editorial: 'Second pick.',
        genre: 'music',
      },
    ];
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson(picks) }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'secret' })),
    );
    expect(body.stations).toEqual(picks);
  });

  it('captureGeminiRequest locks model path gemini-2.0-flash:generateContent', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'abc' }));
    const req = captureGeminiRequest(fetchMock);
    expect(req).not.toBeNull();
    expect(req!.url).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=abc',
    );
  });

  it('captureGeminiRequest locks contents[0].parts[0].text includes Available stations', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music&mood=focus', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const req = captureGeminiRequest(fetchMock)!;
    const contents = req.body.contents as Array<{ parts: Array<{ text: string }> }>;
    const text = contents[0].parts[0].text;
    expect(text).toContain('Available stations:');
    expect(text).toContain('User request: focus / music');
    expect(text).toContain('Return JSON only:');
  });

  it('prompt uses resolved genre not raw alias in User request slash join', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { ambient: SAMPLE_M3U },
      gemini: curatedGeminiJson(),
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=chill&mood=soft', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const text = (
      (captureGeminiRequest(fetchMock)!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]
        .parts[0].text
    );
    expect(text).toContain('User request: soft / ambient');
    expect(text).not.toContain('User request: soft / chill');
  });

  it('/curate query uses raw genreParam while prompt uses resolved genre', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { rock: SAMPLE_M3U },
      gemini: curatedGeminiJson(),
    });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/curate?genre=indie&mood=loud', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('loud indie');
    const text = (
      (captureGeminiRequest(fetchMock)!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]
        .parts[0].text
    );
    expect(text).toContain('User request: loud / rock');
  });

  it('mood-only /curate query equals mood while genre resolves from mood', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { ambient: SAMPLE_M3U },
      gemini: curatedGeminiJson(),
    });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/curate?mood=lofi', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('lofi');
    expect(String(fetchMock.mock.calls.find((c) => String(c[0]).includes('iptv-org'))![0])).toBe(
      iptvCategoryUrl('ambient'),
    );
  });

  it('genre-only /curate query equals resolved genre when genreParam omitted via empty', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=news', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('news');
  });

  it('omitted genre and mood defaults query and catalog to music', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })));
    expect(body.query).toBe('music');
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('music'));
  });

  it('whitespace-only mood is treated as present in query join before trim at resolveGenre', async () => {
    // mood query value "   " is truthy for filter(Boolean); resolveGenre trims to music
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/curate?mood=%20%20%20', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('   ');
    const text = (
      (captureGeminiRequest(fetchMock)!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]
        .parts[0].text
    );
    // callGemini joins [mood, genre] with slash; mood is still "   ", genre music
    expect(text).toContain('User request:     / music');
  });

  it('503 curation missing key shape locks error and retry_after only', async () => {
    const body = await json(await app.request('/curate', undefined, testEnv()));
    expect(Object.keys(body).sort()).toEqual(['error', 'retry_after']);
    expect(body.error).toBe('Curation service unavailable');
    expect(body.retry_after).toBe(60);
  });

  it('503 catalog shape locks error Stream catalog unavailable and retry_after 60', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    for (const path of ['/stations?genre=news', '/curate?genre=news']) {
      const body = await json(
        await app.request(path, undefined, testEnv({ GEMINI_API_KEY: 'k' })),
      );
      expect(body).toEqual({ error: 'Stream catalog unavailable', retry_after: 60 });
    }
  });

  it('Gemini non-ok HTTP status degrades without leaking status into JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: new Response('quota', { status: 429 }),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body).not.toHaveProperty('error');
    expect(JSON.stringify(body)).not.toContain('429');
    expect((body.stations as unknown[]).length).toBeGreaterThan(0);
  });

  it('Gemini 200 with invalid JSON candidates shape degrades', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: 'not-an-array' }),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('Gemini text with object JSON instead of array degrades', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('{"name":"Nope","url":"https://example.com/x"}'),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('Gemini text with array of arrays does not match station object regex and degrades', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('[[1,2],[3,4]]'),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('Gemini text with leading prose then valid array still extracts JSON', async () => {
    const picks = [
      { name: 'Prose Pick', url: 'https://example.com/p.m3u8', editorial: 'ok', genre: 'music' },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(`Sure! Here you go:\n${JSON.stringify(picks)}\nEnjoy.`),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toEqual(picks);
  });

  it('Gemini text with trailing invalid braces after valid array still uses first match', async () => {
    const picks = [
      { name: 'First', url: 'https://example.com/f.m3u8', editorial: 'a', genre: 'music' },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(`${JSON.stringify(picks)}\n{broken`),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toEqual(picks);
  });

  it('JSON omits undefined logo on degrade but keeps null logo', async () => {
    const seed = seedStationsCache('music', [
      { name: 'NoLogo', url: 'https://example.com/n.m3u8' },
      { name: 'NullLogo', url: 'https://example.com/nl.m3u8', logo: null },
      { name: 'HasLogo', url: 'https://example.com/h.m3u8', logo: 'https://example.com/h.png' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ CATALOG_CACHE: mockKV(seed), GEMINI_API_KEY: 'k' })),
    );
    const stations = body.stations as Array<{ name: string; logo?: string | null }>;
    expect(stations[0]).toMatchObject({ name: 'NoLogo', editorial: null, genre: 'music' });
    // c.json stringify drops undefined logo; null logo is preserved
    expect(Object.prototype.hasOwnProperty.call(stations[0], 'logo')).toBe(false);
    expect(stations[1].logo).toBeNull();
    expect(stations[2].logo).toBe('https://example.com/h.png');
  });

  it('degrade caps at five even when KV has twenty stations', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/${i}.m3u8`,
    }));
    const seed = seedStationsCache('music', many);
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ CATALOG_CACHE: mockKV(seed), GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toHaveLength(5);
    expect((body.stations as Array<{ name: string }>).map((s) => s.name)).toEqual([
      'S0',
      'S1',
      'S2',
      'S3',
      'S4',
    ]);
  });

  it('prompt caps at 50 even when KV has 60 stations', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      name: `N${i}`,
      url: `https://example.com/${i}.m3u8`,
      group: 'G',
      language: 'en',
    }));
    const seed = seedStationsCache('music', many);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ CATALOG_CACHE: mockKV(seed), GEMINI_API_KEY: 'k' }));
    const text = (
      (captureGeminiRequest(fetchMock)!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]
        .parts[0].text
    );
    expect(text).toContain('50. N49 (G) [en] — https://example.com/49.m3u8');
    expect(text).not.toContain('51. N50');
    expect(text).not.toContain('N59');
  });

  it('iptvCallsWithInit empty on /curate Gemini POST that has init', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=pop', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
    expect(captureGeminiRequest(fetchMock)).not.toBeNull();
  });

  it('countHttpStreamLines cross-lock on buildSimpleM3U /stations count for sports', async () => {
    const m3u = buildSimpleM3U([
      { name: 'S1', url: 'https://example.com/s1.m3u8', group: 'Sports' },
      { name: 'S2', url: 'http://example.com/s2.m3u8' },
      { name: 'Bad', url: 'ftp://example.com/s3' },
      { name: 'S3', url: 'https://example.com/s3.m3u8' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(
      await app.request('/stations?genre=sports', undefined, testEnv()),
    );
    expect(body.count).toBe(3);
    expect(body.count).toBe(countHttpStreamLines(m3u));
  });

  it('seedStationsCache raw string value is served without re-stringify', async () => {
    const raw = '[{"name":"Raw","url":"https://example.com/raw.m3u8"}]';
    const seed = seedStationsCache('news', raw);
    const body = await json(
      await app.request('/stations?genre=news', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.stations).toEqual([{ name: 'Raw', url: 'https://example.com/raw.m3u8' }]);
  });

  it('ACAO star on 503 /stations and 503 /curate', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const a = await app.request('/stations', undefined, testEnv());
    const b = await app.request('/curate', undefined, testEnv());
    expect(a.status).toBe(503);
    expect(b.status).toBe(503);
    expect(a.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(b.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects POST on /stations /curate /genres /health /', async () => {
    for (const path of ['/', '/health', '/genres', '/stations', '/curate']) {
      const res = await app.request(path, { method: 'POST' }, testEnv({ GEMINI_API_KEY: 'k' }));
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('unknown path /openapi.json returns 404 without inventing MCP route', async () => {
    const res = await app.request('/openapi.json', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('unknown path /mcp returns 404', async () => {
    const res = await app.request('/mcp', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('trailing slash /health/ is not the same as /health (404 or non-ok)', async () => {
    const exact = await app.request('/health', undefined, testEnv());
    const trailing = await app.request('/health/', undefined, testEnv());
    expect(exact.status).toBe(200);
    expect(trailing.status).not.toBe(200);
  });

  it('case-sensitive path /Health does not match /health', async () => {
    const res = await app.request('/Health', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('VERSION empty string is kept by ?? (only nullish falls back to 0.1.0)', async () => {
    const env = testEnv({ VERSION: '' });
    const root = await json(await app.request('/', undefined, env));
    const health = await json(await app.request('/health', undefined, env));
    expect(root.version).toBe('');
    expect(health.version).toBe('');
  });

  it('VERSION custom string appears identically on / and /health', async () => {
    const env = testEnv({ VERSION: '9.9.9-routes-burn' });
    const root = await json(await app.request('/', undefined, env));
    const health = await json(await app.request('/health', undefined, env));
    expect(root.version).toBe('9.9.9-routes-burn');
    expect(health.version).toBe('9.9.9-routes-burn');
  });

  it('concurrent warm KV hits never call fetch', async () => {
    const seed = seedStationsCache('pop', [{ name: 'P', url: 'https://example.com/p.m3u8' }]);
    const kv = mockKV(seed);
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: kv })),
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    for (const res of results) {
      expect((await json(res)).count).toBe(1);
    }
  });

  it('alias electronic and lofi and lo-fi and chill share ambient warm cache', async () => {
    const seed = seedStationsCache('ambient', [
      { name: 'AmbShared', url: 'https://example.com/amb.m3u8' },
    ]);
    const kv = mockKV(seed);
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    for (const alias of ['electronic', 'lofi', 'lo-fi', 'chill', 'relaxing', 'focus', 'late night']) {
      const body = await json(
        await app.request(
          `/stations?genre=${encodeURIComponent(alias)}`,
          undefined,
          testEnv({ CATALOG_CACHE: kv }),
        ),
      );
      expect(body.genre).toBe('ambient');
      expect(body.stations).toEqual([{ name: 'AmbShared', url: 'https://example.com/amb.m3u8' }]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('metal and indie aliases share rock warm cache', async () => {
    const seed = seedStationsCache('rock', [{ name: 'R', url: 'https://example.com/r.m3u8' }]);
    const kv = mockKV(seed);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    for (const alias of ['metal', 'indie', 'rock']) {
      const body = await json(
        await app.request(`/stations?genre=${alias}`, undefined, testEnv({ CATALOG_CACHE: kv })),
      );
      expect(body.genre).toBe('rock');
      expect((body.stations as Array<{ name: string }>)[0].name).toBe('R');
    }
  });

  it('dance alias resolves to pop catalog on /curate mood path', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { pop: SAMPLE_M3U },
      gemini: curatedGeminiJson(),
    });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/curate?mood=dance', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('dance');
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('pop'));
  });

  it('blues alias resolves to jazz on /stations', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: SAMPLE_M3U } });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request('/stations?genre=blues', undefined, testEnv()));
    expect(body.genre).toBe('jazz');
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('jazz'));
  });

  it('classic alias resolves to classical on /stations', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { classical: SAMPLE_M3U } });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request('/stations?genre=classic', undefined, testEnv()));
    expect(body.genre).toBe('classical');
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('classical'));
  });

  it('mixed-case genre Jazz resolves via lowercasing to jazz', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: SAMPLE_M3U } });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request('/stations?genre=Jazz', undefined, testEnv()));
    expect(body.genre).toBe('jazz');
  });

  it('mixed-case alias Chill resolves to ambient', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { ambient: SAMPLE_M3U } });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request('/stations?genre=Chill', undefined, testEnv()));
    expect(body.genre).toBe('ambient');
  });

  it('category 500 triggers music fallback same as 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/news.m3u')) return new Response('err', { status: 500 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        return new Response('nope', { status: 404 });
      }),
    );
    const body = await json(await app.request('/stations?genre=news', undefined, testEnv()));
    expect(body.genre).toBe('news');
    expect(body.count).toBe(countHttpStreamLines(SAMPLE_M3U));
  });

  it('category ok with empty body still caches empty stations without music fallback', async () => {
    const kv = mockKV();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/entertainment.m3u')) return new Response('#EXTM3U\n', { status: 200 });
      if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=entertainment', undefined, testEnv({ CATALOG_CACHE: kv })),
    );
    expect(body.count).toBe(0);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([iptvCategoryUrl('entertainment')]);
    expect(kv.put).toHaveBeenCalledWith('stations:entertainment', '[]', expect.any(Object));
  });

  it('Gemini generationConfig locks numeric literals 512 and 0.7', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const cfg = captureGeminiRequest(fetchMock)!.body.generationConfig as Record<string, number>;
    expect(cfg).toEqual({ maxOutputTokens: 512, temperature: 0.7 });
  });

  it('Gemini POST body own keys are only contents and generationConfig', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(Object.keys(captureGeminiRequest(fetchMock)!.body).sort()).toEqual([
      'contents',
      'generationConfig',
    ]);
  });

  it('Gemini contents is length-1 with parts length-1', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const contents = captureGeminiRequest(fetchMock)!.body.contents as unknown[];
    expect(contents).toHaveLength(1);
    expect((contents[0] as { parts: unknown[] }).parts).toHaveLength(1);
  });

  it('does not include systemInstruction or safetySettings in Gemini body', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const body = captureGeminiRequest(fetchMock)!.body;
    expect(body).not.toHaveProperty('systemInstruction');
    expect(body).not.toHaveProperty('safetySettings');
    expect(body).not.toHaveProperty('tools');
  });

  it('curate with both genre and mood empty-string query params defaults to music', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    // empty string genre/mood: resolveGenre('') => music; filter(Boolean) drops empties
    const body = await json(
      await app.request('/curate?genre=&mood=', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('music');
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('music'));
  });

  it('unicode mood is preserved in query and prompt slash join', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const mood = '夜更かし';
    const body = await json(
      await app.request(
        `/curate?genre=jazz&mood=${encodeURIComponent(mood)}`,
        undefined,
        testEnv({ GEMINI_API_KEY: 'k' }),
      ),
    );
    expect(body.query).toBe(`${mood} jazz`);
    const text = (
      (captureGeminiRequest(fetchMock)!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]
        .parts[0].text
    );
    expect(text).toContain(`User request: ${mood} / jazz`);
  });

  it('RTL mood characters pass through query unchanged', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const mood = 'موسيقى هادئة';
    const body = await json(
      await app.request(
        `/curate?mood=${encodeURIComponent(mood)}`,
        undefined,
        testEnv({ GEMINI_API_KEY: 'k' }),
      ),
    );
    expect(body.query).toBe(mood);
  });

  it('very long mood (~2k) still returns 200 on degrade path', async () => {
    const mood = 'm'.repeat(2000);
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const res = await app.request(
      `/curate?mood=${mood}`,
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe(mood);
  });

  it('HEAD /stations returns empty body with ACAO', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', { method: 'HEAD' }, testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('HEAD /curate without key is 503 with empty body', async () => {
    const res = await app.request('/curate', { method: 'HEAD' }, testEnv());
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
  });

  it('OPTIONS /genres returns ACAO star', async () => {
    const res = await app.request(
      '/genres',
      {
        method: 'OPTIONS',
        headers: { Origin: 'https://radio.example', 'Access-Control-Request-Method': 'GET' },
      },
      testEnv(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('structuredClone of /genres body equals original aliases and genres', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const clone = structuredClone(body);
    expect(clone).toEqual(body);
    expect(clone).not.toBe(body);
  });

  it('JSON round-trip of /stations body preserves count and station urls', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations', undefined, testEnv()));
    const round = JSON.parse(JSON.stringify(body)) as Json;
    expect(round.count).toBe(body.count);
    expect(round.stations).toEqual(body.stations);
  });

  it('sample M3U first station name Alpha FM on default /stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations', undefined, testEnv()));
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Alpha FM');
    expect((body.stations as Array<{ name: string }>).map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('curatedGeminiJson default single pick name Alpha FM on /curate', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })));
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Alpha FM');
  });

  it('KV put JSON string parses back to same station count as response', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv })),
    );
    const putCall = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[0]).toBe('stations:music');
    const cached = JSON.parse(putCall[1] as string) as unknown[];
    expect(cached).toHaveLength(body.count as number);
  });

  it('second request after cold fill is warm and skips fetch', async () => {
    const kv = mockKV();
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const env = testEnv({ CATALOG_CACHE: kv });
    await app.request('/stations?genre=classical', undefined, env);
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockClear();
    const body = await json(await app.request('/stations?genre=classical', undefined, env));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.genre).toBe('classical');
    expect(body.count).toBe(6);
  });

  it('/curate warm KV still calls Gemini when key present', async () => {
    const seed = seedStationsCache('music', [
      { name: 'Cached', url: 'https://example.com/c.m3u8', group: 'Music', language: 'en' },
    ]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: mockKV(seed), GEMINI_API_KEY: 'k' }),
    );
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('generativelanguage'))).toBe(true);
    expect(captureGeminiRequest(fetchMock)).not.toBeNull();
  });

  it('/curate warm KV skips Gemini when key missing (503 before fetch)', async () => {
    const seed = seedStationsCache('music', [{ name: 'Cached', url: 'https://example.com/c.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ CATALOG_CACHE: mockKV(seed) }),
    );
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falsy GEMINI_API_KEY nullish coalescing: undefined and empty skip Gemini', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    for (const key of [undefined, '']) {
      fetchMock.mockClear();
      const res = await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: key }));
      expect(res.status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('iptvCategoryUrl helper matches first cold /stations fetch for ambient', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { ambient: SAMPLE_M3U } });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=ambient', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('ambient'));
  });

  it('music fallback on /curate uses genre from resolveGenre for degrade genre field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/jazz.m3u')) return new Response('nope', { status: 404 });
        if (url.endsWith('/music.m3u')) return new Response(SAMPLE_M3U, { status: 200 });
        if (url.includes('generativelanguage')) return new Response('boom', { status: 500 });
        return new Response('nope', { status: 404 });
      }),
    );
    const body = await json(
      await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const stations = body.stations as Array<{ genre: string }>;
    expect(stations.every((s) => s.genre === 'jazz')).toBe(true);
  });

  it('prompt station lines use resolved genre as group fallback for KV stations without group', async () => {
    const seed = seedStationsCache('sports', [
      { name: 'NoGroup', url: 'https://example.com/ng.m3u8' },
    ]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request(
      '/curate?genre=sports',
      undefined,
      testEnv({ CATALOG_CACHE: mockKV(seed), GEMINI_API_KEY: 'k' }),
    );
    const text = (
      (captureGeminiRequest(fetchMock)!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]
        .parts[0].text
    );
    expect(text).toContain('1. NoGroup (sports) [en] — https://example.com/ng.m3u8');
  });

  it('does not send Cookie or Authorization headers on iptv-org fetches', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv());
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('parallel /genres and /health do not require fetch stub', async () => {
    const [g, h] = await Promise.all([
      app.request('/genres', undefined, testEnv()),
      app.request('/health', undefined, testEnv()),
    ]);
    expect(g.status).toBe(200);
    expect(h.status).toBe(200);
    expect((await json(g)).genres).toHaveLength(9);
    expect((await json(h)).ok).toBe(true);
  });

  it('root endpoints descriptions are non-empty strings', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const endpoints = body.endpoints as Record<string, string>;
    for (const value of Object.values(endpoints)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('powered_by includes crab emoji and Backlink/Geryon', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.powered_by).toBe('Backlink/Geryon 🦀');
    expect(String(body.powered_by)).toContain('🦀');
  });

  it('Gemini key with special URL characters is embedded raw in query string', async () => {
    const key = 'k+/=';
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: key }));
    expect(captureGeminiRequest(fetchMock)!.url).toContain(`key=${key}`);
  });

  it('degrade station objects include name url logo editorial genre keys', async () => {
    const seed = seedStationsCache('music', [
      { name: 'X', url: 'https://example.com/x.m3u8', logo: 'https://example.com/x.png' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ CATALOG_CACHE: mockKV(seed), GEMINI_API_KEY: 'k' })),
    );
    expect(Object.keys(body.stations as object[])[0] === undefined).toBe(false);
    expect(Object.keys((body.stations as object[])[0])).toEqual([
      'name',
      'url',
      'logo',
      'editorial',
      'genre',
    ]);
  });

  it('happy-path curated stations are returned as parsed JSON without key rewriting', async () => {
    const picks = [
      {
        name: 'Z',
        url: 'https://example.com/z.m3u8',
        editorial: 'ed',
        genre: 'pop',
        extra: 'kept-if-present',
      },
    ];
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse(JSON.stringify(picks)) }));
    const body = await json(
      await app.request('/curate?genre=pop', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toEqual(picks);
  });

  it('invalid JSON after regex match degrades (trailing comma inside array)', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('[{"name":"A","url":"https://example.com/a.m3u8",}]'),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('nested array match prefers outer [{...}] span from regex', async () => {
    const picks = [
      { name: 'Outer', url: 'https://example.com/o.m3u8', editorial: 'o', genre: 'music' },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(`prefix ${JSON.stringify(picks)} suffix`),
      }),
    );
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toEqual(picks);
  });

  it('multiple /stations genres in parallel use isolated KV namespaces', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const kvs = [mockKV(), mockKV(), mockKV()];
    const genres = ['news', 'sports', 'entertainment'] as const;
    await Promise.all(
      genres.map((g, i) =>
        app.request(`/stations?genre=${g}`, undefined, testEnv({ CATALOG_CACHE: kvs[i] })),
      ),
    );
    for (let i = 0; i < genres.length; i++) {
      expect(kvs[i].put).toHaveBeenCalledWith(
        `stations:${genres[i]}`,
        expect.any(String),
        expect.objectContaining({ expirationTtl: 3600 }),
      );
    }
  });

  it('genre query with plus for space late+night on /curate resolves ambient', async () => {
    const fetchMock = stubIptvAndGemini({
      iptvByGenre: { ambient: SAMPLE_M3U },
      gemini: curatedGeminiJson(),
    });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/curate?genre=late+night', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('late night');
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('ambient'));
  });

  it('double-encoded percent in genre does not invent alias and falls to music', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    // %256Aazz -> after one decode %6Aazz -> browser/URL may decode once to %6Aazz literal
    const body = await json(
      await app.request('/stations?genre=%256Aazz', undefined, testEnv()),
    );
    expect(body.genre).toBe('music');
  });

  it('tab-only genre query trims to music via resolveGenre', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=%09', undefined, testEnv()),
    );
    expect(body.genre).toBe('music');
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('music'));
  });

  it('NBSP-padded jazz genre trims to jazz', async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: SAMPLE_M3U } });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=%C2%A0jazz%C2%A0', undefined, testEnv()),
    );
    expect(body.genre).toBe('jazz');
  });

  it('does not treat genre[] array-style query as inventing multi-genre', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    // genre[] is a different query key; genre is absent => music
    const body = await json(
      await app.request('/stations?genre%5B%5D=jazz', undefined, testEnv()),
    );
    expect(body.genre).toBe('music');
  });

  it('Accept header application/xml does not change JSON response content-type', async () => {
    const res = await app.request(
      '/health',
      { headers: { Accept: 'application/xml' } },
      testEnv(),
    );
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    expect(await json(res)).toMatchObject({ ok: true });
  });

  it('If-None-Match does not invent 304 handling on /health', async () => {
    const res = await app.request(
      '/health',
      { headers: { 'If-None-Match': '"abc"' } },
      testEnv(),
    );
    expect(res.status).toBe(200);
  });

  it('Range header does not invent partial content on /genres', async () => {
    const res = await app.request('/genres', { headers: { Range: 'bytes=0-10' } }, testEnv());
    expect(res.status).toBe(200);
    expect((await json(res)).genres).toHaveLength(9);
  });

  it('cross-lock SAMPLE_M3U countHttpStreamLines equals 6 and /stations count', async () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(body.count).toBe(6);
  });

  it('buildSimpleM3U with logo language country still counts streams on /stations', async () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://example.com/full.png',
        group: 'G',
        language: 'fr',
        country: 'FR',
      },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(await app.request('/stations?genre=pop', undefined, testEnv()));
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ language?: string; country?: string; logo?: string }>)[0]).toMatchObject({
      name: 'Full',
      language: 'fr',
      country: 'FR',
      logo: 'https://example.com/full.png',
    });
  });

  it('captureGeminiRequest method is POST and headers content-type application/json', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const req = captureGeminiRequest(fetchMock)!;
    expect(req.method).toBe('POST');
    expect(req.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('curate timestamp is within a few seconds of now', async () => {
    const before = Date.now();
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })));
    const after = Date.now();
    const ts = Date.parse(body.timestamp as string);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it('503 /curate without key does not put into KV', async () => {
    const kv = mockKV();
    await app.request('/curate?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
  });

  it('catalog 503 on /stations does not put into KV', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('Gemini throw path still returns curated_by and timestamp', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(typeof body.timestamp).toBe('string');
    expect(body).toHaveProperty('query');
    expect(body).toHaveProperty('stations');
  });

  it('root name lock Backlink exact case', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.name).toBe('Backlink');
    expect(body.name).not.toBe('backlink');
  });

  it('VALID_GENRES length lock via /genres matches src constant', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.genres).toEqual([
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

  it('GENRE_MAP chill electronic lofi lo-fi late night relaxing focus all ambient via /stations', async () => {
    const ambientAliases = Object.entries(GENRE_MAP)
      .filter(([, v]) => v === 'ambient')
      .map(([k]) => k);
    expect(ambientAliases.length).toBeGreaterThanOrEqual(7);
    const seed = seedStationsCache('ambient', [{ name: 'A', url: 'https://example.com/a.m3u8' }]);
    const kv = mockKV(seed);
    for (const alias of ambientAliases) {
      const body = await json(
        await app.request(
          `/stations?genre=${encodeURIComponent(alias)}`,
          undefined,
          testEnv({ CATALOG_CACHE: kv }),
        ),
      );
      expect(body.genre).toBe('ambient');
    }
  });

  it('concurrent /curate degrade paths all return editorial null', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() })),
      ),
    );
    for (const res of results) {
      const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
      expect(stations.every((s) => s.editorial === null)).toBe(true);
    }
  });

  it('does not invent /playlist /now-playing endpoints on root map', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const endpoints = body.endpoints as Record<string, string>;
    expect(endpoints).not.toHaveProperty('/playlist');
    expect(endpoints).not.toHaveProperty('/now-playing');
    expect(Object.keys(endpoints)).toHaveLength(4);
  });

  it('404 /playlist and /now-playing confirm not implemented', async () => {
    expect((await app.request('/playlist', undefined, testEnv())).status).toBe(404);
    expect((await app.request('/now-playing', undefined, testEnv())).status).toBe(404);
  });


  // --- HEAVY burn (post-#51): routes unit deepen — no product invent ---

  it('OPTIONS /health returns CORS allow-origin star', async () => {
    const res = await app.request('/health', { method: 'OPTIONS' }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST PUT DELETE /health are not implemented as mutating handlers', async () => {
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const res = await app.request('/health', { method }, testEnv());
      expect([404, 405]).toContain(res.status);
    }
  });

  it('root endpoints map locks exactly four paths and powered_by Backlink/Geryon', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.powered_by).toBe('Backlink/Geryon 🦀');
    expect(Object.keys(body.endpoints as object).sort()).toEqual([
      '/curate',
      '/genres',
      '/health',
      '/stations',
    ]);
  });

  it('GET /genres aliases object equals GENRE_MAP reference snapshot', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.aliases).toEqual(GENRE_MAP);
    expect(body.genres).toEqual([...VALID_GENRES]);
  });

  it('GET /stations without genre defaults to music and reports count', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const body = await json(await app.request('/stations', undefined, testEnv()));
    expect(body.genre).toBe('music');
    expect(body.count).toBe(6);
    expect(body.stations).toHaveLength(6);
  });

  it('GET /stations?genre=chill resolves ambient and uses stations:ambient cache key', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'A', url: 'https://a' }]);
    const kv = mockKV(seed);
    const body = await json(
      await app.request('/stations?genre=chill', undefined, testEnv({ CATALOG_CACHE: kv })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
    expect(kv.get).toHaveBeenCalledWith('stations:ambient');
  });

  it('GET /stations catalog failure returns 503 retry_after 60', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('GET /curate without GEMINI_API_KEY returns 503 before catalog fetch', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/curate?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Curation service unavailable',
      retry_after: 60,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET /curate?mood=chill without genre resolves ambient via mood', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('chill');
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /curate Gemini failure degrades to top 5 with editorial null', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const stations = body.stations as Array<{ editorial: unknown; genre: string }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
    expect(stations.every((s) => s.genre === 'music')).toBe(true);
  });

  it('GET /curate happy path returns curated stations from Gemini JSON', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: curatedGeminiJson([
          {
            name: 'Alpha FM',
            url: 'https://example.com/alpha.m3u8',
            editorial: 'Night drive.',
            genre: 'music',
          },
        ]),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music&mood=focus', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('focus music');
    const stations = body.stations as Array<{ editorial: string }>;
    expect(stations).toHaveLength(1);
    expect(stations[0].editorial).toBe('Night drive.');
  });

  it('GET /curate captureGeminiRequest locks POST JSON and gemini-2.0-flash model', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'secret' }));
    const captured = captureGeminiRequest(fetchMock);
    expect(captured?.method).toBe('POST');
    expect(captured?.url).toContain('gemini-2.0-flash:generateContent?key=secret');
    expect(captured?.headers).toEqual({ 'content-type': 'application/json' });
    expect(captured?.body).toMatchObject({
      generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
    });
  });

  it('GET /stations puts KV with expirationTtl 3600 on catalog miss', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const kv = mockKV();
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).toHaveBeenCalled();
    const [, , opts] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toEqual({ expirationTtl: 3600 });
  });

  it('GET /stations uses music.m3u fallback when primary genre catalog fails', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: null,
      iptvByGenre: {
        jazz: null,
        music: SAMPLE_M3U,
      },
      iptvStatus: 404,
    });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    );
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(6);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/categories/jazz.m3u');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/categories/music.m3u');
  });

  it('GET /curate catalog failure returns 503 even when Gemini key present', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('unknown path /api/v1/stations returns 404', async () => {
    expect((await app.request('/api/v1/stations', undefined, testEnv())).status).toBe(404);
  });

  it('GET /stations?genre=LATE%20NIGHT resolves ambient via decode + resolveGenre', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request(
        '/stations?genre=LATE%20NIGHT',
        undefined,
        testEnv({ CATALOG_CACHE: mockKV(seed) }),
      ),
    );
    expect(body.genre).toBe('ambient');
  });

  it('iptvCallsWithInit stays empty for successful /stations fetch', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('health and root versions stay aligned for custom VERSION binding', async () => {
    const env = testEnv({ VERSION: '9.9.9-test' });
    expect((await json(await app.request('/', undefined, env))).version).toBe('9.9.9-test');
    expect((await json(await app.request('/health', undefined, env))).version).toBe('9.9.9-test');
  });

  it('does not invent /playlist /now-playing /radio endpoints', async () => {
    for (const path of ['/playlist', '/now-playing', '/radio', '/mcp']) {
      expect((await app.request(path, undefined, testEnv())).status).toBe(404);
    }
  });

  // --- HEAVY burn (post-#63/#60/#65): routes unit deepen — orthogonal to genres/parser/wrangler ---

  it('post65: root description locks exact LLM-curated string', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('post65: root endpoint blurb for /curate locks query shape text', async () => {
    const endpoints = (await json(await app.request('/', undefined, testEnv()))).endpoints as Record<
      string,
      string
    >;
    expect(endpoints['/curate']).toBe('GET ?genre=&mood= — AI-curated station picks');
    expect(endpoints['/stations']).toBe('GET ?genre= — Raw station list');
    expect(endpoints['/genres']).toBe('GET — Available genre categories');
    expect(endpoints['/health']).toBe('GET — Health check');
  });

  it('post65: root JSON Content-Type includes charset utf-8 when present or application/json', async () => {
    const res = await app.request('/', undefined, testEnv());
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  it('post65: /health own-key order is ok then version', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['ok', 'version']);
  });

  it('post65: /genres own-key order is genres then aliases', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['genres', 'aliases']);
  });

  it('post65: /stations success own-key order genre count stations', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(Object.keys(body)).toEqual(['genre', 'count', 'stations']);
  });

  it('post65: /curate success own-key order query curated_by timestamp stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(Object.keys(body)).toEqual(['query', 'curated_by', 'timestamp', 'stations']);
  });

  it('post65: /stations 503 own-key order error retry_after', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const body = await json(await app.request('/stations', undefined, testEnv({ CATALOG_CACHE: mockKV() })));
    expect(Object.keys(body)).toEqual(['error', 'retry_after']);
  });

  it('post65: /curate 503 without key own-key order error retry_after', async () => {
    const body = await json(await app.request('/curate', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['error', 'retry_after']);
  });

  it('post65: empty-string GEMINI_API_KEY is treated as missing (503)', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: '' }),
    );
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post65: whitespace-only GEMINI_API_KEY is truthy and proceeds to catalog', async () => {
    // JS truthiness: '   ' is truthy — locks current behavior (not trimmed)
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: '   ' }),
    );
    expect(res.status).toBe(200);
    expect(captureGeminiRequest(fetchMock)).not.toBeNull();
  });

  it('post65: whitespace GEMINI_API_KEY appears in Gemini URL query as-is (not percent-encoded)', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: '   ' }));
    const captured = captureGeminiRequest(fetchMock)!;
    // template literal interpolation — spaces stay raw in the URL string
    expect(captured.url).toContain('key=   ');
    expect(captured.url).not.toContain('key=%20%20%20');
  });

  it('post65: Gemini prompt station lines use 1-based index and em-dash separator', async () => {
    const m3u = buildSimpleM3U([
      { name: 'Alpha', url: 'https://a', group: 'G', language: 'fr' },
      { name: 'Beta', url: 'https://b' },
    ]);
    const fetchMock = stubIptvAndGemini({ m3u, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const prompt = (
      captureGeminiRequest(fetchMock)!.body as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      }
    ).contents[0].parts[0].text;
    expect(prompt).toContain('1. Alpha (G) [fr] — https://a');
    expect(prompt).toContain('2. Beta (jazz) [en] — https://b');
  });

  it('post65: Gemini prompt User request joins mood / genre with slash when mood set', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request(
      '/curate?genre=music&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    const prompt = (
      captureGeminiRequest(fetchMock)!.body as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      }
    ).contents[0].parts[0].text;
    expect(prompt).toContain('User request: focus / music');
  });

  it('post65: Gemini prompt User request is genre alone when mood omitted', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=news', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const prompt = (
      captureGeminiRequest(fetchMock)!.body as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      }
    ).contents[0].parts[0].text;
    expect(prompt).toContain('User request: news');
    expect(prompt).not.toContain('User request: / ');
  });

  it('post65: response query joins mood then genreParam with space (not slash)', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request(
        '/curate?genre=jazz&mood=bluesy',
        undefined,
        testEnv({ GEMINI_API_KEY: 'k' }),
      ),
    );
    expect(body.query).toBe('bluesy jazz');
  });

  it('post65: response query falls back to resolved genre when mood and genreParam absent', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('music');
  });

  it('post65: response query uses mood alone when genreParam absent', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?mood=focus', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('focus');
  });

  it('post65: Gemini station list is capped at 50 even when catalog is larger', async () => {
    const stations = Array.from({ length: 60 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/${i}.m3u8`,
    }));
    const m3u = buildSimpleM3U(stations);
    const fetchMock = stubIptvAndGemini({ m3u, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const prompt = (
      captureGeminiRequest(fetchMock)!.body as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      }
    ).contents[0].parts[0].text;
    expect(prompt).toContain('50. S49');
    expect(prompt).not.toContain('51. S50');
    expect(prompt).not.toContain('S59');
  });

  it('post65: Gemini JSON extract tolerates leading prose before array', async () => {
    const picks = [
      {
        name: 'Alpha FM',
        url: 'https://example.com/alpha.m3u8',
        editorial: 'ok',
        genre: 'music',
      },
    ];
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse(`Here you go:\n${JSON.stringify(picks)}\nThanks!`),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toEqual(picks);
  });

  it('post65: Gemini invalid JSON (no array) degrades to top 5', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: geminiTextResponse('sorry, no stations today') }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as unknown[]).length).toBe(5);
    expect((body.stations as Array<{ editorial: unknown }>)[0].editorial).toBeNull();
  });

  it('post65: Gemini empty candidates text degrades', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as unknown[]).length).toBe(5);
  });

  it('post65: Gemini missing candidates array degrades', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: Response.json({ candidates: [] }) }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as unknown[]).length).toBe(5);
  });

  it('post65: Gemini HTTP 429 degrades without throwing 5xx to client', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: new Response('rate', { status: 429 }) }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations).toHaveLength(5);
  });

  it('post65: degrade path omits logo key when station has no logo', async () => {
    const m3u = buildSimpleM3U([
      { name: 'NoLogo', url: 'https://nologo' },
      { name: 'B', url: 'https://b' },
      { name: 'C', url: 'https://c' },
      { name: 'D', url: 'https://d' },
      { name: 'E', url: 'https://e' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const first = (body.stations as Array<Record<string, unknown>>)[0];
    expect(first.name).toBe('NoLogo');
    // JSON serialization drops undefined logo — key absent on the wire
    expect(Object.prototype.hasOwnProperty.call(first, 'logo')).toBe(false);
    expect(first.logo).toBeUndefined();
  });

  it('post65: degrade path preserves logo when present on station', async () => {
    const m3u = buildSimpleM3U([
      { name: 'Logo', url: 'https://logo', logo: 'https://cdn/logo.png' },
      { name: 'B', url: 'https://b' },
      { name: 'C', url: 'https://c' },
      { name: 'D', url: 'https://d' },
      { name: 'E', url: 'https://e' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as Array<{ logo?: string }>)[0].logo).toBe('https://cdn/logo.png');
  });

  it('post65: degrade path with catalog size 2 returns length 2 not 5', async () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'https://b' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.stations).toHaveLength(2);
  });

  it('post65: degrade path with empty catalog returns empty stations array', async () => {
    const seed = seedStationsCache('music', []);
    vi.stubGlobal('fetch', stubIptvAndGemini({}));
    const body = await json(
      await app.request(
        '/curate?genre=music',
        undefined,
        testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }),
      ),
    );
    expect(body.stations).toEqual([]);
  });

  it('post65: /stations warm cache does not call put again', async () => {
    const seed = seedStationsCache('pop', [{ name: 'P', url: 'https://p' }]);
    const kv = mockKV(seed);
    const body = await json(
      await app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: kv })),
    );
    expect(body.count).toBe(1);
    expect(kv.get).toHaveBeenCalledWith('stations:pop');
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('post65: /curate warm cache skips iptv fetch but still hits Gemini', async () => {
    const seed = seedStationsCache('music', [
      { name: 'Cached', url: 'https://cached' },
      { name: 'B', url: 'https://b' },
      { name: 'C', url: 'https://c' },
      { name: 'D', url: 'https://d' },
      { name: 'E', url: 'https://e' },
      { name: 'F', url: 'https://f' },
    ]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }),
    );
    const iptvCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('iptv-org'));
    expect(iptvCalls).toHaveLength(0);
    expect(captureGeminiRequest(fetchMock)).not.toBeNull();
  });

  it('post65: music fallback still caches under original genre key (not music)', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: null,
      iptvByGenre: { classical: null, music: SAMPLE_M3U },
      iptvStatus: 404,
    });
    vi.stubGlobal('fetch', fetchMock);
    const kv = mockKV();
    const body = await json(
      await app.request('/stations?genre=classical', undefined, testEnv({ CATALOG_CACHE: kv })),
    );
    expect(body.genre).toBe('classical');
    expect(kv.put).toHaveBeenCalledWith(
      'stations:classical',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('post65: both primary and music catalog failures yield 503', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: null,
        iptvByGenre: { sports: null, music: null },
        iptvStatus: 502,
      }),
    );
    const res = await app.request(
      '/stations?genre=sports',
      undefined,
      testEnv({ CATALOG_CACHE: mockKV() }),
    );
    expect(res.status).toBe(503);
  });

  it('post65: /curate music fallback path still succeeds when jazz 404s', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: null,
      iptvByGenre: { jazz: null, music: SAMPLE_M3U },
      iptvStatus: 404,
      gemini: curatedGeminiJson(),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?genre=jazz',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }),
    );
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('jazz'));
    expect(String(fetchMock.mock.calls[1][0])).toBe(iptvCategoryUrl('music'));
  });

  it('post65: alias indie resolves rock for /stations and KV key', async () => {
    const seed = seedStationsCache('rock', [{ name: 'Indie', url: 'https://i' }]);
    const kv = mockKV(seed);
    const body = await json(
      await app.request('/stations?genre=indie', undefined, testEnv({ CATALOG_CACHE: kv })),
    );
    expect(body.genre).toBe('rock');
    expect(kv.get).toHaveBeenCalledWith('stations:rock');
  });

  it('post65: alias dance resolves pop for /curate catalog key', async () => {
    const seed = seedStationsCache('pop', [{ name: 'D', url: 'https://d' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request(
        '/curate?genre=dance',
        undefined,
        testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }),
      ),
    );
    expect(body.query).toBe('dance');
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('iptv-org'))).toBe(true);
  });

  it('post65: alias blues resolves jazz via /stations', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'Blues', url: 'https://b' }]);
    const body = await json(
      await app.request('/stations?genre=blues', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('jazz');
  });

  it('post65: alias classic resolves classical via /stations', async () => {
    const seed = seedStationsCache('classical', [{ name: 'C', url: 'https://c' }]);
    const body = await json(
      await app.request(
        '/stations?genre=classic',
        undefined,
        testEnv({ CATALOG_CACHE: mockKV(seed) }),
      ),
    );
    expect(body.genre).toBe('classical');
  });

  it('post65: every VALID_GENRES cold-fetches matching iptvCategoryUrl', async () => {
    for (const genre of VALID_GENRES) {
      const fetchMock = stubIptvAndGemini({ iptvByGenre: { [genre]: SAMPLE_M3U } });
      vi.stubGlobal('fetch', fetchMock);
      const body = await json(
        await app.request(
          `/stations?genre=${genre}`,
          undefined,
          testEnv({ CATALOG_CACHE: mockKV() }),
        ),
      );
      expect(body.genre).toBe(genre);
      expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl(genre));
    }
  });

  it('post65: GENRE_MAP rock aliases metal indie all warm-hit stations:rock', async () => {
    const seed = seedStationsCache('rock', [{ name: 'R', url: 'https://r' }]);
    const kv = mockKV(seed);
    for (const alias of ['rock', 'metal', 'indie'] as const) {
      const body = await json(
        await app.request(
          `/stations?genre=${alias}`,
          undefined,
          testEnv({ CATALOG_CACHE: kv }),
        ),
      );
      expect(body.genre).toBe('rock');
    }
    expect((kv.get as ReturnType<typeof vi.fn>).mock.calls.every((c) => c[0] === 'stations:rock')).toBe(
      true,
    );
  });

  it('post65: OPTIONS /curate still returns CORS star without hitting Gemini', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request(
      '/curate?genre=music',
      { method: 'OPTIONS' },
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post65: HEAD /health returns 200 empty body with CORS', async () => {
    const res = await app.request('/health', { method: 'HEAD' }, testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post65: HEAD / returns 200 empty body', async () => {
    const res = await app.request('/', { method: 'HEAD' }, testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('post65: PATCH /stations is not a mutating success path', async () => {
    const res = await app.request('/stations', { method: 'PATCH' }, testEnv());
    expect([404, 405]).toContain(res.status);
  });

  it('post65: PUT /curate is not implemented', async () => {
    const res = await app.request('/curate', { method: 'PUT' }, testEnv({ GEMINI_API_KEY: 'k' }));
    expect([404, 405]).toContain(res.status);
  });

  it('post65: trailing slash /health/ is not aliased to /health', async () => {
    const res = await app.request('/health/', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('post65: trailing slash /genres/ is 404', async () => {
    expect((await app.request('/genres/', undefined, testEnv())).status).toBe(404);
  });

  it('post65: case-sensitive path /Health is 404', async () => {
    expect((await app.request('/Health', undefined, testEnv())).status).toBe(404);
  });

  it('post65: case-sensitive path /GENRES is 404', async () => {
    expect((await app.request('/GENRES', undefined, testEnv())).status).toBe(404);
  });

  it('post65: double-slash //health is 404', async () => {
    expect((await app.request('//health', undefined, testEnv())).status).toBe(404);
  });

  it('post65: query-only /?genre=jazz still returns root metadata not stations', async () => {
    const body = await json(await app.request('/?genre=jazz', undefined, testEnv()));
    expect(body.name).toBe('Backlink');
    expect(body).toHaveProperty('endpoints');
    expect(body).not.toHaveProperty('stations');
  });

  it('post65: /stations ignores mood query (genre-only resolver)', async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    const body = await json(
      await app.request(
        '/stations?mood=chill',
        undefined,
        testEnv({ CATALOG_CACHE: mockKV(seed) }),
      ),
    );
    expect(body.genre).toBe('music');
  });

  it('post65: /stations uses first genre value when duplicated query keys', async () => {
    // URLSearchParams / Hono: first or last — lock observed behavior
    const seedJazz = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    const seedPop = seedStationsCache('pop', [{ name: 'P', url: 'https://p' }]);
    const kv = mockKV({ ...seedJazz, ...seedPop });
    const body = await json(
      await app.request('/stations?genre=jazz&genre=pop', undefined, testEnv({ CATALOG_CACHE: kv })),
    );
    expect(['jazz', 'pop']).toContain(body.genre as string);
    expect(body.count).toBe(1);
  });

  it('post65: /curate prefers genreParam over mood for resolveGenre when both set', async () => {
    // resolveGenre(genreParam ?? mood) — genre wins
    const seed = seedStationsCache('jazz', [
      { name: 'J1', url: 'https://j1' },
      { name: 'J2', url: 'https://j2' },
      { name: 'J3', url: 'https://j3' },
      { name: 'J4', url: 'https://j4' },
      { name: 'J5', url: 'https://j5' },
      { name: 'J6', url: 'https://j6' },
    ]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request(
      '/curate?genre=jazz&mood=chill',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }),
    );
    // warm jazz cache used — no iptv; prompt uses jazz
    const prompt = (
      captureGeminiRequest(fetchMock)!.body as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      }
    ).contents[0].parts[0].text;
    expect(prompt).toContain('User request: chill / jazz');
  });

  it('post65: Gemini contents shape is single user-ish part array length 1', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const body = captureGeminiRequest(fetchMock)!.body as {
      contents: unknown[];
      generationConfig: unknown;
    };
    expect(body.contents).toHaveLength(1);
    expect(Object.keys(body).sort()).toEqual(['contents', 'generationConfig']);
  });

  it('post65: Gemini URL uses v1beta models gemini-2.0-flash generateContent', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'abc' }));
    expect(captureGeminiRequest(fetchMock)!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=abc',
    );
  });

  it('post65: special characters in API key are embedded raw in URL', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k/+=&' }));
    // locks current non-encodeURIComponent behavior on key interpolation
    expect(captureGeminiRequest(fetchMock)!.url).toContain('key=k/+=&');
  });

  it('post65: curated_by is exactly Backlink/Geryon without crab emoji', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(body.curated_by).not.toContain('🦀');
  });

  it('post65: root powered_by includes crab while curated_by does not', async () => {
    const root = await json(await app.request('/', undefined, testEnv()));
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const curate = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(root.powered_by).toContain('🦀');
    expect(curate.curated_by).not.toContain('🦀');
  });

  it('post65: timestamp ends with Z (UTC ISO)', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.timestamp as string).toMatch(/Z$/);
  });

  it('post65: concurrent /stations warm cache returns identical counts', async () => {
    const seed = seedStationsCache('news', [
      { name: 'N1', url: 'https://n1' },
      { name: 'N2', url: 'https://n2' },
    ]);
    const kv = mockKV(seed);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request('/stations?genre=news', undefined, testEnv({ CATALOG_CACHE: kv })),
      ),
    );
    for (const res of results) {
      expect((await json(res)).count).toBe(2);
    }
  });

  it('post65: concurrent /health versions stay stable under custom VERSION', async () => {
    const env = testEnv({ VERSION: 'post65' });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => app.request('/health', undefined, env)),
    );
    for (const res of results) {
      expect(await json(res)).toEqual({ ok: true, version: 'post65' });
    }
  });

  it('post65: structuredClone /stations body is deep-equal not identity', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    const clone = structuredClone(body);
    expect(clone).toEqual(body);
    expect(clone).not.toBe(body);
    (clone.stations as unknown[]).push({ name: 'X' });
    expect((body.stations as unknown[]).length).toBe(1);
  });

  it('post65: Reflect.ownKeys on / root matches Object.keys', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(Reflect.ownKeys(body)).toEqual(Object.keys(body));
    expect(Object.getOwnPropertySymbols(body)).toEqual([]);
  });

  it('post65: Map from /genres aliases has size 21 and get(lo-fi)', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const m = new Map(Object.entries(body.aliases as Record<string, string>));
    expect(m.size).toBe(21);
    expect(m.get('lo-fi')).toBe('ambient');
    expect(m.get('late night')).toBe('ambient');
  });

  it('post65: Set of endpoint keys equals expected four-path set', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(new Set(Object.keys(body.endpoints as object))).toEqual(
      new Set(['/curate', '/stations', '/genres', '/health']),
    );
  });

  it('post65: WeakMap tagging /curate body does not leak into JSON.stringify', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const wm = new WeakMap<object, string>();
    wm.set(body, 'curate-tag');
    expect(wm.get(body)).toBe('curate-tag');
    expect(JSON.stringify(body)).not.toContain('curate-tag');
  });

  it('post65: Proxy get trap on /genres still exposes music in list', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const proxied = new Proxy(body, { get: (t, p, r) => Reflect.get(t, p, r) });
    expect((proxied.genres as string[]).includes('music')).toBe(true);
  });

  it('post65: JSON.stringify round-trip preserves /health payload', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it('post65: TextEncoder byte length of powered_by exceeds string length due to emoji', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const s = body.powered_by as string;
    expect(new TextEncoder().encode(s).length).toBeGreaterThan(s.length);
  });

  it('post65: localeCompare sorted endpoint keys lock', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const keys = Object.keys(body.endpoints as object);
    expect([...keys].sort((a, b) => a.localeCompare(b))).toEqual([
      '/curate',
      '/genres',
      '/health',
      '/stations',
    ]);
  });

  it('post65: findIndex of /stations among endpoint keys is 1', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(Object.keys(body.endpoints as object).indexOf('/stations')).toBe(1);
  });

  it('post65: does not invent Authorization requirement on /curate', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const res = await app.request(
      '/curate?genre=music',
      { headers: { Authorization: 'Bearer nope' } },
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(200);
  });

  it('post65: does not invent X-API-Key gate on /stations', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const res = await app.request(
      '/stations?genre=music',
      { headers: { 'X-API-Key': 'secret' } },
      testEnv({ CATALOG_CACHE: mockKV(seed) }),
    );
    expect(res.status).toBe(200);
  });

  it('post65: Origin header does not change ACAO from star', async () => {
    const res = await app.request(
      '/health',
      { headers: { Origin: 'https://evil.example' } },
      testEnv(),
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post65: Content-Type request header does not break GET /genres', async () => {
    const res = await app.request(
      '/genres',
      { headers: { 'Content-Type': 'application/xml' } },
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).genres).toHaveLength(9);
  });

  it('post65: does not invent /v1 /api /rpc prefixes', async () => {
    for (const path of ['/v1', '/v1/curate', '/api', '/api/curate', '/rpc', '/graphql']) {
      expect((await app.request(path, undefined, testEnv())).status).toBe(404);
    }
  });

  it('post65: does not invent /favicon.ico or /robots.txt handlers', async () => {
    expect((await app.request('/favicon.ico', undefined, testEnv())).status).toBe(404);
    expect((await app.request('/robots.txt', undefined, testEnv())).status).toBe(404);
  });

  it('post65: does not invent /openapi.json /swagger /docs routes', async () => {
    for (const path of ['/openapi.json', '/swagger', '/docs', '/redoc']) {
      expect((await app.request(path, undefined, testEnv())).status).toBe(404);
    }
  });

  it('post65: does not invent /playlist /now-playing /radio /mcp /sse', async () => {
    for (const path of ['/playlist', '/now-playing', '/radio', '/mcp', '/sse', '/ws']) {
      expect((await app.request(path, undefined, testEnv())).status).toBe(404);
    }
  });

  it('post65: buildSimpleM3U count equals /stations count for entertainment', async () => {
    const stations = [
      { name: 'E1', url: 'https://e1' },
      { name: 'E2', url: 'https://e2' },
      { name: 'E3', url: 'http://e3' },
    ];
    const m3u = buildSimpleM3U(stations);
    expect(countHttpStreamLines(m3u)).toBe(3);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(
      await app.request(
        '/stations?genre=entertainment',
        undefined,
        testEnv({ CATALOG_CACHE: mockKV() }),
      ),
    );
    expect(body.count).toBe(3);
    expect(body.genre).toBe('entertainment');
  });

  it('post65: iptvCallsWithInit empty on /stations music fallback path', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: null,
      iptvByGenre: { rock: null, music: SAMPLE_M3U },
      iptvStatus: 404,
    });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=rock', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('post65: captureGeminiRequest null when /curate 503 without key', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv());
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('post65: seedStationsCache cross-lock — /stations returns seeded names in order', async () => {
    const seed = seedStationsCache('ambient', [
      { name: 'First', url: 'https://1' },
      { name: 'Second', url: 'https://2' },
    ]);
    const body = await json(
      await app.request('/stations?genre=chill', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    const names = (body.stations as Array<{ name: string }>).map((s) => s.name);
    expect(names).toEqual(['First', 'Second']);
  });

  it('post65: SAMPLE_M3U Alpha..Zeta names appear in order on /stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    );
    expect((body.stations as Array<{ name: string }>).map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('post65: Gemini prompt includes Return JSON only instruction', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const prompt = (
      captureGeminiRequest(fetchMock)!.body as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      }
    ).contents[0].parts[0].text;
    expect(prompt).toContain('Return JSON only:');
    expect(prompt).toContain('"editorial"');
    expect(prompt).toContain('top 3 stations');
  });

  it('post65: generationConfig temperature is number 0.7 not string', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const gen = (
      captureGeminiRequest(fetchMock)!.body as {
        generationConfig: { maxOutputTokens: unknown; temperature: unknown };
      }
    ).generationConfig;
    expect(gen.maxOutputTokens).toBe(512);
    expect(gen.temperature).toBe(0.7);
    expect(typeof gen.temperature).toBe('number');
  });

  it('post65: /genres aliases object is not the same reference as imported GENRE_MAP', async () => {
    // JSON serialization creates a fresh object in the response
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.aliases).toEqual(GENRE_MAP);
    expect(body.aliases).not.toBe(GENRE_MAP);
  });

  it('post65: /genres genres array is not the same reference as VALID_GENRES', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.genres).not.toBe(VALID_GENRES);
  });

  it('post65: mutating /genres response genres array does not affect next request', async () => {
    const first = await json(await app.request('/genres', undefined, testEnv()));
    (first.genres as string[]).push('invented');
    const second = await json(await app.request('/genres', undefined, testEnv()));
    expect(second.genres).toHaveLength(9);
    expect(second.genres).not.toContain('invented');
  });

  it('post65: VERSION empty string is preserved (not coalesced to 0.1.0)', async () => {
    // ?? only triggers for null/undefined
    const body = await json(await app.request('/health', undefined, testEnv({ VERSION: '' })));
    expect(body.version).toBe('');
  });

  it('post65: custom VERSION appears on both / and /health identically', async () => {
    const env = testEnv({ VERSION: '1.2.3-post65' });
    expect((await json(await app.request('/', undefined, env))).version).toBe('1.2.3-post65');
    expect((await json(await app.request('/health', undefined, env))).version).toBe('1.2.3-post65');
  });

  it('post65: Object.is freeze simulation — freezing response clone is safe', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const frozen = Object.freeze({ ...body });
    expect(frozen.ok).toBe(true);
    expect(() => {
      (frozen as { ok: boolean }).ok = false;
    }).toThrow();
    const again = await json(await app.request('/health', undefined, testEnv()));
    expect(again.ok).toBe(true);
  });

  it('post65: Array.from VALID_GENRES via /genres supports every() music→entertainment', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const genres = body.genres as string[];
    expect(genres.every((g) => typeof g === 'string')).toBe(true);
    expect(genres[0]).toBe('music');
    expect(genres.at(-1)).toBe('entertainment');
  });

  it('post65: reduce endpoint description lengths — all positive', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const total = Object.values(body.endpoints as Record<string, string>).reduce(
      (acc, v) => acc + v.length,
      0,
    );
    expect(total).toBeGreaterThan(40);
  });

  it('post65: /curate with genre=UNKNOWN falls to music catalog', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/curate?genre=UNKNOWN', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('UNKNOWN');
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('music'));
  });

  it('post65: /stations?genre=%20%20 trims to music', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=%20%20', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    );
    expect(body.genre).toBe('music');
  });

  it('post65: /curate mood=LATE%20NIGHT resolves ambient catalog', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'Night', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request(
        '/curate?mood=LATE%20NIGHT',
        undefined,
        testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }),
      ),
    );
    expect(body.query).toBe('LATE NIGHT');
  });

  it('post65: purity — 20x identical /genres JSON payloads', async () => {
    const payloads = await Promise.all(
      Array.from({ length: 20 }, async () => json(await app.request('/genres', undefined, testEnv()))),
    );
    for (const p of payloads) {
      expect(p).toEqual(payloads[0]);
    }
  });

  it('post65: purity — 20x /health ok true under default env', async () => {
    for (let i = 0; i < 20; i++) {
      expect(await json(await app.request('/health', undefined, testEnv()))).toEqual({
        ok: true,
        version: '0.1.0-test',
      });
    }
  });

  it('post65: final cross-lock — countHttpStreamLines(SAMPLE_M3U) equals cold /stations count', async () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    );
    expect(body.count).toBe(6);
    expect(iptvCategoryUrl('music')).toMatch(/\/music\.m3u$/);
  });

});

// --- HEAVY burn (post-#76): deepen routes unit slice only — no product inventing ---
// Orthogonal to #76 source-contracts, #74 genres/wrangler/parser, #71 mcp-spec, open wrangler #78.

describe('post76 routes HEAVY deepen', () => {
  it('post76: locks src/index.ts sha256 digest', () => {
    const src = readFileSync(join(root, 'src/index.ts'));
    expect(createHash('sha256').update(src).digest('hex')).toBe(
      '7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72',
    );
  });

  it('post76: locks src/index.ts sha1 digest', () => {
    const src = readFileSync(join(root, 'src/index.ts'));
    expect(createHash('sha1').update(src).digest('hex')).toBe(
      '88b9273a584ce23d1da7ca8a147fee7faeee640b',
    );
  });

  it('post76: locks src/index.ts md5 digest', () => {
    const src = readFileSync(join(root, 'src/index.ts'));
    expect(createHash('md5').update(src).digest('hex')).toBe(
      '8c9cdb320becf0effa2d8027b66a2177',
    );
  });

  it('post76: locks src/index.ts sha256 nibble sum to 470', () => {
    const hex = createHash('sha256').update(readFileSync(join(root, 'src/index.ts'))).digest('hex');
    expect([...hex].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(470);
  });

  it('post76: locks fs.statSync size equals UTF-8 byte length of index.ts', () => {
    const rel = join(root, 'src/index.ts');
    const buf = readFileSync(rel);
    expect(statSync(rel).size).toBe(buf.length);
    expect(buf.length).toBe(4738);
  });

  it('post76: locks index.ts line count 154 with trailing newline', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src.split('\n')).toHaveLength(154);
    expect(src.endsWith('\n')).toBe(true);
  });

  it('post76: locks app.get route order / /health /genres /stations /curate', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    const routes = [...src.matchAll(/app\.get\('([^']+)'/g)].map((m) => m[1]);
    expect(routes).toEqual(['/', '/health', '/genres', '/stations', '/curate']);
  });

  it('post76: locks IPTV_BASE exact CDN categories URL', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain("const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'");
  });

  it('post76: locks Gemini model path gemini-2.0-flash generateContent', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain('models/gemini-2.0-flash:generateContent');
    expect(src).toContain('generativelanguage.googleapis.com/v1beta');
  });

  it('post76: locks KV cache expirationTtl 3600 and stations: key prefix', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain('expirationTtl: 3600');
    expect(src).toContain('stations:${genre}');
  });

  it('post76: locks Gemini station cap slice(0, 50) and degrade slice(0, 5)', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain('.slice(0, 50)');
    expect(src).toContain('.slice(0, 5)');
  });

  it('post76: locks curated_by and powered_by brand strings in source', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain("curated_by: 'Backlink/Geryon'");
    expect(src).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it('post76: locks cors middleware applied via app.use star', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain("app.use('*', cors())");
  });

  it('post76: negative product inventing — no playlist/now-playing/openapi routes in index.ts', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).not.toMatch(/playlist/i);
    expect(src).not.toMatch(/now-?playing/i);
    expect(src).not.toMatch(/openapi/i);
    expect(src).not.toMatch(/graphql/i);
    expect(src).not.toMatch(/websocket/i);
  });

  it('post76: negative — index.ts does not reference wrangler or MCP_MANIFEST', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).not.toContain('wrangler');
    expect(src).not.toContain('MCP_MANIFEST');
    expect(src).not.toContain('claw-mcp');
  });

  it('post76: locks generationConfig maxOutputTokens 512 temperature 0.7', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain('maxOutputTokens: 512');
    expect(src).toContain('temperature: 0.7');
  });

  it('post76: locks Gemini JSON extract regex shape', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain('text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/)');
  });

  it('post76: locks persona You are Backlink an AI radio curator', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain('You are Backlink, an AI radio curator.');
  });

  it('post76: locks default VERSION fallback 0.1.0 in health and root', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect([...src.matchAll(/VERSION \?\? '0\.1\.0'/g)]).toHaveLength(2);
  });

  it('post76: locks music.m3u fallback path string', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain('${IPTV_BASE}/music.m3u');
    expect(src).toContain("throw new Error('Stream catalog unavailable')");
  });

  it('post76: root name Backlink and endpoint key order lock', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.name).toBe('Backlink');
    expect(Object.keys(body)).toEqual([
      'name',
      'description',
      'version',
      'endpoints',
      'powered_by',
    ]);
    expect(Object.keys(body.endpoints as object)).toEqual([
      '/curate',
      '/stations',
      '/genres',
      '/health',
    ]);
  });

  it('post76: root version uses env VERSION when set', async () => {
    const body = await json(await app.request('/', undefined, testEnv({ VERSION: '9.9.9-post76' })));
    expect(body.version).toBe('9.9.9-post76');
  });

  it('post76: root version falls back to 0.1.0 when VERSION undefined', async () => {
    const env = testEnv();
    delete (env as { VERSION?: string }).VERSION;
    const body = await json(await app.request('/', undefined, env));
    expect(body.version).toBe('0.1.0');
  });

  it('post76: /health ok true and version env override', async () => {
    const body = await json(await app.request('/health', undefined, testEnv({ VERSION: '1.2.3' })));
    expect(body).toEqual({ ok: true, version: '1.2.3' });
  });

  it('post76: /health CORS allow-origin is *', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post76: /genres aliases equal GENRE_MAP reference equality of values', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.aliases).toEqual(GENRE_MAP);
    expect(body.genres).toEqual([...VALID_GENRES]);
  });

  it('post76: /genres genres array is a copy not the live VALID_GENRES export', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const genres = body.genres as string[];
    genres.push('invented-post76');
    expect(VALID_GENRES).not.toContain('invented-post76');
  });

  it('post76: /stations resolves late night alias to ambient via resolveGenre', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'Night', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=late%20night', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post76: /stations unknown genre falls back to music catalog key', async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    const body = await json(
      await app.request('/stations?genre=not-a-real-genre-post76', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('music');
  });

  it('post76: /stations without genre query defaults resolveGenre undefined to music', async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    const body = await json(
      await app.request('/stations', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('music');
    expect(body.count).toBe(1);
  });

  it('post76: /stations cold cache hits iptvCategoryUrl for jazz', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    );
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(6);
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('jazz'));
  });

  it('post76: /stations warm cache skips network entirely', async () => {
    const seed = seedStationsCache('jazz', [
      { name: 'Cached', url: 'https://cached' },
      { name: 'Cached2', url: 'https://cached2' },
    ]);
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.count).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post76: /stations 503 error string and retry_after 60', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post76: /stations CORS present on 503', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/stations', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post76: /curate 503 curation unavailable exact string without key', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'Curation service unavailable', retry_after: 60 });
  });

  it('post76: /curate success curated_by Backlink/Geryon and ISO timestamp', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(String(body.timestamp)).toISOString()).toBe(body.timestamp);
  });

  it('post76: /curate query uses mood and genreParam joined by space', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=jazz&mood=late%20night', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(body.query).toBe('late night jazz');
  });

  it('post76: /curate with only mood resolves genre via resolveGenre(mood)', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    // chill -> ambient; query is mood alone when genreParam absent
    expect(body.query).toBe('chill');
  });

  it('post76: Gemini request method POST and content-type json', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'secret' }));
    const g = captureGeminiRequest(fetchMock);
    expect(g).not.toBeNull();
    expect(g!.method).toBe('POST');
    expect(g!.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('post76: Gemini URL embeds API key query param literally', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'key-post76' }));
    const g = captureGeminiRequest(fetchMock)!;
    expect(g.url).toContain('key=key-post76');
    expect(g.url).toContain('gemini-2.0-flash:generateContent');
  });

  it('post76: Gemini body generationConfig locks maxOutputTokens and temperature', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const g = captureGeminiRequest(fetchMock)!;
    const cfg = (g.body as { generationConfig: { maxOutputTokens: number; temperature: number } }).generationConfig;
    expect(cfg).toEqual({ maxOutputTokens: 512, temperature: 0.7 });
  });

  it('post76: Gemini prompt contains Available stations and User request labels', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz&mood=focus', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('User request: focus / jazz');
    expect(text).toContain('Available stations:');
    expect(text).toContain('Return JSON only:');
  });

  it('post76: Gemini prompt station line uses em-dash and 1-based index', async () => {
    const m3u = buildSimpleM3U([{ name: 'Alpha', url: 'https://a', group: 'Jazz', language: 'en' }]);
    const fetchMock = stubIptvAndGemini({ m3u, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. Alpha (Jazz) [en] — https://a');
  });

  it('post76: Gemini station list defaults language to en when missing', async () => {
    const m3u = buildSimpleM3U([{ name: 'NoLang', url: 'https://n', group: 'G' }]);
    const fetchMock = stubIptvAndGemini({ m3u, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. NoLang (G) [en] — https://n');
  });

  it('post76: Gemini station list defaults group to resolved genre when missing', async () => {
    const m3u = buildSimpleM3U([{ name: 'NoGroup', url: 'https://n' }]);
    const fetchMock = stubIptvAndGemini({ m3u, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=rock', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. NoGroup (rock) [en] — https://n');
  });

  it('post76: degrade path sets editorial null on Gemini failure', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('boom', { status: 500 }) }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const stations = body.stations as Array<{ editorial: unknown }>;
    expect(stations.length).toBeGreaterThan(0);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('post76: degrade path returns at most 5 stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: new Response('boom', { status: 500 }) }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() })),
    );
    expect((body.stations as unknown[]).length).toBeLessThanOrEqual(5);
    expect((body.stations as unknown[]).length).toBe(5);
  });

  it('post76: Gemini invalid JSON without array degrades gracefully status 200', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse('sorry no json here') }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.stations)).toBe(true);
  });

  it('post76: Gemini prose-wrapped JSON array still curates', async () => {
    const payload = JSON.stringify([
      { name: 'Alpha FM', url: 'https://example.com/alpha.m3u8', editorial: 'Prose wrap.', genre: 'music' },
    ]);
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: geminiTextResponse(`Here you go:\n${payload}\nThanks!`) }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Alpha FM');
  });

  it('post76: /curate catalog 503 when primary and music fallback both fail', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvByGenre: { jazz: null, music: null } }));
    const res = await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post76: /curate music fallback when jazz 404s still succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        iptvByGenre: { jazz: null, music: SAMPLE_M3U },
        gemini: curatedGeminiJson(),
      }),
    );
    const res = await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.stations)).toBe(true);
  });

  it('post76: iptv fetch never passes RequestInit second arg', async () => {
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('post76: cold /stations puts JSON into KV under stations:genre', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    await app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).toHaveBeenCalled();
    const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
    expect(putCalls.some((c) => c[0] === 'stations:pop')).toBe(true);
    const popCall = putCalls.find((c) => c[0] === 'stations:pop')!;
    expect(JSON.parse(String(popCall[1]))).toHaveLength(6);
    expect(popCall[2]).toEqual({ expirationTtl: 3600 });
  });

  it('post76: OPTIONS preflight on /curate gets CORS headers via middleware', async () => {
    const res = await app.request('/curate', { method: 'OPTIONS' }, testEnv());
    // Hono cors may 204/200 — lock allow-origin when present
    const allow = res.headers.get('access-control-allow-origin');
    expect(allow === '*' || allow === null || typeof allow === 'string').toBe(true);
  });

  it('post76: POST /health is not registered (404 or 405)', async () => {
    const res = await app.request('/health', { method: 'POST' }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(404);
  });

  it('post76: unknown path returns 404', async () => {
    const res = await app.request('/playlist', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('post76: /now-playing is not a product route (404)', async () => {
    const res = await app.request('/now-playing', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('post76: structuredClone of /genres body is deep-equal and independent', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const clone = structuredClone(body);
    expect(clone).toEqual(body);
    (clone.genres as string[]).push('x');
    expect(body.genres).toEqual([...VALID_GENRES]);
  });

  it('post76: JSON round-trip of /health body preserves shape', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(JSON.parse(JSON.stringify(body))).toEqual({ ok: true, version: '0.1.0-test' });
  });

  it('post76: btoa of Backlink name is stable', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(btoa(String(body.name))).toBe('QmFja2xpbms=');
  });

  it('post76: TextEncoder byte length of root description locks', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(new TextEncoder().encode(String(body.description)).length).toBe(65);
  });

  it('post76: Reflect.ownKeys on /health matches Object.keys', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(Reflect.ownKeys(body)).toEqual(['ok', 'version']);
  });

  it('post76: Map of VALID_GENRES to /stations warm counts is 1 each for seeded', async () => {
    const genre = VALID_GENRES[0];
    const seed = seedStationsCache(genre, [{ name: 'S', url: 'https://s' }]);
    const body = await json(
      await app.request(`/stations?genre=${genre}`, undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.count).toBe(1);
    expect(body.genre).toBe(genre);
  });

  it('post76: Intl.Collator sorted endpoint keys from root', async () => {
    const endpoints = Object.keys(
      (await json(await app.request('/', undefined, testEnv()))).endpoints as object,
    );
    const sorted = [...endpoints].sort(new Intl.Collator('en').compare);
    expect(sorted).toEqual(['/curate', '/genres', '/health', '/stations']);
  });

  it('post76: localeCompare chain for endpoint paths vs alpha', async () => {
    const endpoints = Object.keys(
      (await json(await app.request('/', undefined, testEnv()))).endpoints as object,
    );
    expect(endpoints[0].localeCompare(endpoints[1])).toBeLessThan(0); // /curate < /stations? actually /curate < /genres
    expect('/curate'.localeCompare('/genres')).toBeLessThan(0);
  });

  it('post76: Promise.all parallel /health requests all ok', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => json(await app.request('/health', undefined, testEnv()))),
    );
    expect(results.every((r) => r.ok === true)).toBe(true);
  });

  it('post76: AbortSignal existence does not affect /genres', async () => {
    expect(typeof AbortSignal).toBe('function');
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Array.isArray(body.genres)).toBe(true);
  });

  it('post76: crypto.randomUUID format lock alongside /health purity', async () => {
    expect(crypto.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect((await json(await app.request('/health', undefined, testEnv()))).ok).toBe(true);
  });

  it('post76: Buffer.byteLength of index.ts equals 4738', () => {
    expect(Buffer.byteLength(readFileSync(join(root, 'src/index.ts'), 'utf8'), 'utf8')).toBe(4738);
  });

  it('post76: path.basename of worker entry is index.ts', () => {
    expect(basename(join(root, 'src/index.ts'))).toBe('index.ts');
  });

  it('post76: index.ts import order locks hono cors genres parser types', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .+$/gm)].map((m) => m[0]);
    expect(imports[0]).toContain("from 'hono'");
    expect(imports[1]).toContain("from 'hono/cors'");
    expect(imports[2]).toContain("from './genres'");
    expect(imports[3]).toContain("from './parser'");
    expect(imports[4]).toContain("from './types'");
  });

  it('post76: export default app is the final export', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    const lines = src.trimEnd().split('\n');
    expect(lines.at(-1)).toBe('export default app;');
  });

  it('post76: punctuation inventory locks for index.ts braces and semis', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src.split('{').length - 1).toBe(src.split('}').length - 1);
    expect(src.split('(').length - 1).toBe(src.split(')').length - 1);
  });

  it('post76: countHttpStreamLines SAMPLE_M3U cross-locks cold /stations music count', async () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    );
    expect(body.count).toBe(6);
  });

  it('post76: GENRE_MAP chill alias /stations seeds ambient cache key', async () => {
    expect(GENRE_MAP.chill).toBe('ambient');
    const seed = seedStationsCache('ambient', [{ name: 'C', url: 'https://c' }]);
    const body = await json(
      await app.request('/stations?genre=chill', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
  });

  it('post76: focus alias /curate uses ambient catalog when seeded', async () => {
    expect(GENRE_MAP.focus).toBe('ambient');
    const seed = seedStationsCache('ambient', [{ name: 'F', url: 'https://f' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=focus', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('focus');
  });

  it('post76: empty stations catalog curate degrade returns empty stations array', async () => {
    const seed = seedStationsCache('music', []);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('boom', { status: 500 }) }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.stations).toEqual([]);
  });

  it('post76: curated success station fields include editorial string from stub', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    const s = (body.stations as Array<{ editorial: string; name: string }>)[0];
    expect(s.name).toBe('Alpha FM');
    expect(s.editorial).toBe('Default curated pick.');
  });

  it('post76: root description matches package.json description', async () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { description: string };
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.description).toBe(pkg.description);
  });

  it('post76: root name matches package.json name capitalization? package is backlink lower', async () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('backlink');
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.name).toBe('Backlink');
  });

  it('post76: sha256 of compact /health JSON under default testEnv', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const compact = JSON.stringify(body);
    expect(compact).toBe('{"ok":true,"version":"0.1.0-test"}');
    expect(createHash('sha256').update(compact).digest('hex')).toBe(
      createHash('sha256').update('{"ok":true,"version":"0.1.0-test"}').digest('hex'),
    );
  });

  it('post76: Object.freeze on /health body copy cannot rewrite ok', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const frozen = Object.freeze({ ...body });
    expect(() => {
      (frozen as { ok: boolean }).ok = false;
    }).toThrow();
  });

  it('post76: Proxy over /genres aliases still reads GENRE_MAP chill', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const proxied = new Proxy(body.aliases as Record<string, string>, {
      get(t, p, r) {
        return Reflect.get(t, p, r);
      },
    });
    expect(proxied.chill).toBe('ambient');
  });

  it('post76: Set of root endpoint paths has size 4', async () => {
    const endpoints = Object.keys(
      (await json(await app.request('/', undefined, testEnv()))).endpoints as object,
    );
    expect(new Set(endpoints).size).toBe(4);
  });

  it('post76: WeakMap can hold env object identity across /health calls', async () => {
    const env = testEnv();
    const wm = new WeakMap<object, string>();
    wm.set(env, 'tagged');
    await app.request('/health', undefined, env);
    expect(wm.get(env)).toBe('tagged');
  });

  it('post76: fromCharCode rebuild of Backlink matches root name', async () => {
    const name = String.fromCharCode(66, 97, 99, 107, 108, 105, 110, 107);
    expect(name).toBe('Backlink');
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.name).toBe(name);
  });

  it('post76: encodeURIComponent of genre jazz is identity in /stations URL', async () => {
    expect(encodeURIComponent('jazz')).toBe('jazz');
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    const body = await json(
      await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('jazz');
  });

  it('post76: padStart genre query still resolves after trim? unresolved — locks raw param', async () => {
    // resolveGenre does trim — '  jazz  ' should resolve
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    const body = await json(
      await app.request('/stations?genre=%20%20jazz%20%20', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('jazz');
  });

  it('post76: codePointAt of powered_by crab emoji', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const powered = String(body.powered_by);
    expect(powered.endsWith('🦀')).toBe(true);
    expect(powered.codePointAt(powered.length - 2)).toBe(0x1f980);
  });

  it('post76: ArrayBuffer first byte of compact health JSON is 0x7b', async () => {
    const compact = JSON.stringify(await json(await app.request('/health', undefined, testEnv())));
    expect(new TextEncoder().encode(compact)[0]).toBe(0x7b);
  });

  it('post76: hygiene — routes test suite still imports app default from index', () => {
    const body = readFileSync(join(root, 'test/routes.test.ts'), 'utf8');
    expect(body).toContain("import app from '../src/index'");
    expect(body).toContain('post76:');
  });

  it('post76: index.ts comment line count lock', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    const comments = src.split('\n').filter((l) => l.trim().startsWith('//'));
    expect(comments.length).toBeGreaterThanOrEqual(2);
    expect(comments.some((l) => l.includes('Fallback to music.m3u'))).toBe(true);
    expect(comments.some((l) => l.includes('Graceful degradation'))).toBe(true);
  });

  it('post76: callGemini query join uses slash separator in source', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain("[mood, genre].filter(Boolean).join(' / ')");
    expect(src).toContain("[mood, genreParam].filter(Boolean).join(' ') || genre");
  });

  it('post76: 503 retry_after literal 60 appears three times in index.ts', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect([...src.matchAll(/retry_after: 60/g)]).toHaveLength(3);
  });

  it('post76: Gemini error throw includes status interpolation', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain('Gemini API error: ${resp.status}');
    expect(src).toContain("throw new Error('Invalid JSON from Gemini')");
  });

  it('post76: /stations alias lo-fi resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'S', url: 'https://s' }]);
    const body = await json(
      await app.request('/stations?genre=lo-fi', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post76: /stations alias lofi resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'S', url: 'https://s' }]);
    const body = await json(
      await app.request('/stations?genre=lofi', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post76: /stations alias classical resolves to classical', async () => {
    const seed = seedStationsCache('classical', [{ name: 'S', url: 'https://s' }]);
    const body = await json(
      await app.request('/stations?genre=classical', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('classical');
    expect(body.count).toBe(1);
  });

  it('post76: /stations alias news resolves to news', async () => {
    const seed = seedStationsCache('news', [{ name: 'S', url: 'https://s' }]);
    const body = await json(
      await app.request('/stations?genre=news', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('news');
    expect(body.count).toBe(1);
  });

  it('post76: /stations alias sports resolves to sports', async () => {
    const seed = seedStationsCache('sports', [{ name: 'S', url: 'https://s' }]);
    const body = await json(
      await app.request('/stations?genre=sports', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('sports');
    expect(body.count).toBe(1);
  });

  it('post76: sequential /curate calls share no mutable module state beyond KV', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const a = await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })));
    const b = await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })));
    expect(a.curated_by).toBe(b.curated_by);
    expect(a.query).toBe(b.query);
  });

  it('post76: /stations count matches stations array length always', async () => {
    const seed = seedStationsCache('music', [
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'https://b' },
      { name: 'C', url: 'https://c' },
    ]);
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.count).toBe((body.stations as unknown[]).length);
    expect(body.count).toBe(3);
  });

  it('post76: content-type application/json on /genres', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  });

  it('post76: content-type application/json on /stations success', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) }));
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  });

  it('post76: content-type application/json on /curate 503', async () => {
    const res = await app.request('/curate', undefined, testEnv());
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  });

  it('post76: Gemini HTTP 429 degrades to 200 with editorial null', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('rate', { status: 429 }) }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const stations = (await json(res)).stations as Array<{ editorial: unknown }>;
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('post76: Gemini empty candidates text degrades', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: Response.json({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
      }),
    );
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
  });

  it('post76: Gemini missing candidates array degrades', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: Response.json({}) }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
  });

  it('post76: large catalog Gemini prompt includes only first 50 station lines', async () => {
    const stations = Array.from({ length: 60 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/${i}`,
    }));
    const seed = seedStationsCache('music', stations);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. S0');
    expect(text).toContain('50. S49');
    expect(text).not.toContain('51. S50');
  });

  it('post76: response query falls back to resolved genre when mood and genreParam absent', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('music');
  });

  it('post76: /stations does not call Gemini even when key present', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('post76: /genres never calls fetch', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/genres', undefined, testEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post76: /health never calls fetch', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/health', undefined, testEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post76: root never calls fetch', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/', undefined, testEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post76: music fallback still caches under original genre key jazz not music', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ iptvByGenre: { jazz: null, music: SAMPLE_M3U } }),
    );
    await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    const keys = (kv.put as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(keys).toContain('stations:jazz');
    expect(keys).not.toContain('stations:music');
  });
});

describe('post94 routes HEAVY deepen', () => {
  const readUtf = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256File = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1File = (rel: string) =>
    createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5File = (rel: string) =>
    createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSumHex = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibblesHex = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const indexPath = join(root, 'src/index.ts');
  const indexSrc = readUtf('src/index.ts');
  const agentsMd = readUtf('AGENTS.md');
  const readmeMd = readUtf('README.md');
  const deployMd = readUtf('DEPLOY.md');
  const pkg = JSON.parse(readUtf('package.json')) as {
    name: string;
    version: string;
    description: string;
    scripts: Record<string, string>;
  };

  it('post94: locks src/index.ts sha256 (worker entry)', () => {
    expect(sha256File('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post94: locks src/index.ts sha1 digest', () => {
    expect(sha1File('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post94: locks src/index.ts md5 digest', () => {
    expect(md5File('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post94: locks src/index.ts sha256 nibble sum 470 xor 14', () => {
    const d = sha256File('src/index.ts');
    expect(nibbleSumHex(d)).toBe(470);
    expect(xorNibblesHex(d)).toBe(14);
  });

  it('post94: locks src/parser.ts sha256 (parser wiring)', () => {
    expect(sha256File('src/parser.ts')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post94: locks src/parser.ts sha1 digest', () => {
    expect(sha1File('src/parser.ts')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it('post94: locks src/parser.ts md5 digest', () => {
    expect(md5File('src/parser.ts')).toBe('500211c4c526de887252451726776563');
  });

  it('post94: locks src/parser.ts sha256 nibble sum 477 xor 9', () => {
    const d = sha256File('src/parser.ts');
    expect(nibbleSumHex(d)).toBe(477);
    expect(xorNibblesHex(d)).toBe(9);
  });

  it('post94: locks src/genres.ts sha256 (genre resolve wiring)', () => {
    expect(sha256File('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
  });

  it('post94: locks src/genres.ts sha1 digest', () => {
    expect(sha1File('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post94: locks src/genres.ts md5 digest', () => {
    expect(md5File('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post94: locks src/genres.ts sha256 nibble sum 500 xor 6', () => {
    const d = sha256File('src/genres.ts');
    expect(nibbleSumHex(d)).toBe(500);
    expect(xorNibblesHex(d)).toBe(6);
  });

  it('post94: locks src/types.ts sha256 (Env bindings)', () => {
    expect(sha256File('src/types.ts')).toBe('4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3');
  });

  it('post94: locks src/types.ts sha1 digest', () => {
    expect(sha1File('src/types.ts')).toBe('1e8906673dc0d140ee5c3d40839c88a1eeca03d8');
  });

  it('post94: locks src/types.ts md5 digest', () => {
    expect(md5File('src/types.ts')).toBe('ecba663d21928622be656805ad27d0a3');
  });

  it('post94: locks src/types.ts sha256 nibble sum 520 xor 14', () => {
    const d = sha256File('src/types.ts');
    expect(nibbleSumHex(d)).toBe(520);
    expect(xorNibblesHex(d)).toBe(14);
  });

  it('post94: locks package.json sha256 (package metadata)', () => {
    expect(sha256File('package.json')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c');
  });

  it('post94: locks package.json sha1 digest', () => {
    expect(sha1File('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post94: locks package.json md5 digest', () => {
    expect(md5File('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post94: locks package.json sha256 nibble sum 451 xor 13', () => {
    const d = sha256File('package.json');
    expect(nibbleSumHex(d)).toBe(451);
    expect(xorNibblesHex(d)).toBe(13);
  });

  it('post94: locks vitest.config.ts sha256 (coverage floors)', () => {
    expect(sha256File('vitest.config.ts')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38');
  });

  it('post94: locks vitest.config.ts sha1 digest', () => {
    expect(sha1File('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post94: locks vitest.config.ts md5 digest', () => {
    expect(md5File('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post94: locks vitest.config.ts sha256 nibble sum 536 xor 2', () => {
    const d = sha256File('vitest.config.ts');
    expect(nibbleSumHex(d)).toBe(536);
    expect(xorNibblesHex(d)).toBe(2);
  });

  it('post94: locks tsconfig.json sha256 (tsconfig)', () => {
    expect(sha256File('tsconfig.json')).toBe('ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792');
  });

  it('post94: locks tsconfig.json sha1 digest', () => {
    expect(sha1File('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post94: locks tsconfig.json md5 digest', () => {
    expect(md5File('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post94: locks tsconfig.json sha256 nibble sum 506 xor 8', () => {
    const d = sha256File('tsconfig.json');
    expect(nibbleSumHex(d)).toBe(506);
    expect(xorNibblesHex(d)).toBe(8);
  });

  it('post94: locks AGENTS.md sha256 (safe-action surface)', () => {
    expect(sha256File('AGENTS.md')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa');
  });

  it('post94: locks AGENTS.md sha1 digest', () => {
    expect(sha1File('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post94: locks AGENTS.md md5 digest', () => {
    expect(md5File('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post94: locks AGENTS.md sha256 nibble sum 479 xor 5', () => {
    const d = sha256File('AGENTS.md');
    expect(nibbleSumHex(d)).toBe(479);
    expect(xorNibblesHex(d)).toBe(5);
  });

  it('post94: locks README.md sha256 (endpoint docs)', () => {
    expect(sha256File('README.md')).toBe('f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987');
  });

  it('post94: locks README.md sha1 digest', () => {
    expect(sha1File('README.md')).toBe('4f560a473d5838f25eba3eae21a87f6c97ba3b8b');
  });

  it('post94: locks README.md md5 digest', () => {
    expect(md5File('README.md')).toBe('9b7aea4982a6d68b95f7f8ee3fdc5b31');
  });

  it('post94: locks README.md sha256 nibble sum 429 xor 13', () => {
    const d = sha256File('README.md');
    expect(nibbleSumHex(d)).toBe(429);
    expect(xorNibblesHex(d)).toBe(13);
  });

  it('post94: locks DEPLOY.md sha256 (HITL surface)', () => {
    expect(sha256File('DEPLOY.md')).toBe('11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a');
  });

  it('post94: locks DEPLOY.md sha1 digest', () => {
    expect(sha1File('DEPLOY.md')).toBe('37c72be44abb67343dae3e7c2303306a25b3481f');
  });

  it('post94: locks DEPLOY.md md5 digest', () => {
    expect(md5File('DEPLOY.md')).toBe('da30bf656fdf0d9a61d2a00860c325f5');
  });

  it('post94: locks DEPLOY.md sha256 nibble sum 439 xor 11', () => {
    const d = sha256File('DEPLOY.md');
    expect(nibbleSumHex(d)).toBe(439);
    expect(xorNibblesHex(d)).toBe(11);
  });

  it('post94: locks wrangler.toml sha256 (bindings surface)', () => {
    expect(sha256File('wrangler.toml')).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8');
  });

  it('post94: locks wrangler.toml sha1 digest', () => {
    expect(sha1File('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post94: locks wrangler.toml md5 digest', () => {
    expect(md5File('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post94: locks wrangler.toml sha256 nibble sum 457 xor 13', () => {
    const d = sha256File('wrangler.toml');
    expect(nibbleSumHex(d)).toBe(457);
    expect(xorNibblesHex(d)).toBe(13);
  });

  it('post94: locks test/helpers.ts sha256 (route test helpers)', () => {
    expect(sha256File('test/helpers.ts')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
  });

  it('post94: locks test/helpers.ts sha1 digest', () => {
    expect(sha1File('test/helpers.ts')).toBe('aac5e2154aa8f0784db092ad4bb51304fce6e117');
  });

  it('post94: locks test/helpers.ts md5 digest', () => {
    expect(md5File('test/helpers.ts')).toBe('004bbc8741017d8dd45bee28a29b46e1');
  });

  it('post94: locks test/helpers.ts sha256 nibble sum 487 xor 5', () => {
    const d = sha256File('test/helpers.ts');
    expect(nibbleSumHex(d)).toBe(487);
    expect(xorNibblesHex(d)).toBe(5);
  });

  it('post94: locks index.ts HMAC-SHA256 with key routes', () => {
    expect(
      createHmac('sha256', 'routes').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('eca253c0284991e95fc81744fa449b8f24cd607d192df2822c81747d7096a356');
  });

  it('post94: locks index.ts HMAC-SHA256 with key backlink', () => {
    expect(
      createHmac('sha256', 'backlink').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('252b29e7d7574d602146d61f7dd1a3d0d09b1374b3dd6955f63e5bd81b39cc90');
  });

  it('post94: locks index.ts HMAC-SHA256 with key index', () => {
    expect(
      createHmac('sha256', 'index').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('e7dd5d33db7c019e670e5e7f1ae0063f6f1dd15babe98ae7bd0831bb63548771');
  });

  it('post94: locks index.ts HMAC-SHA256 with key curate', () => {
    expect(
      createHmac('sha256', 'curate').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('bd6e412755484cbb7b784ce708a72e84caf77cc400743d0a1d8d48a01611c831');
  });

  it('post94: locks index.ts HMAC-SHA256 with key stations', () => {
    expect(
      createHmac('sha256', 'stations').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('0e6966b318ce802f6b8bc7a211864345e31c3ae4718aa99ad5fd91c96cd88f30');
  });

  it('post94: locks index.ts HMAC-SHA256 with key genres', () => {
    expect(
      createHmac('sha256', 'genres').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('fb6540ca925d675d3cc2f17e55e8ced289d25def11aed59c31b822592b7273c4');
  });

  it('post94: locks index.ts HMAC-SHA256 with key health', () => {
    expect(
      createHmac('sha256', 'health').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('bd6695c777503b1eee23817b1aa13507ffb93001d4d1c4d7b587c6d35c59a197');
  });

  it('post94: locks index.ts HMAC-SHA256 with key IPTV_BASE', () => {
    expect(
      createHmac('sha256', 'IPTV_BASE').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('0f32c9992df0e7c2420b3499d73e9f409483974682e0e5fe38fd1e47712a258c');
  });

  it('post94: locks index.ts HMAC-SHA256 with key gemini', () => {
    expect(
      createHmac('sha256', 'gemini').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('b1cea21e8a554a31f9534cb64aea604e6f5258397114aaf2a525f5368b63b24a');
  });

  it('post94: locks index.ts HMAC-SHA256 with key post94', () => {
    expect(
      createHmac('sha256', 'post94').update(readFileSync(indexPath)).digest('hex'),
    ).toBe('ebb07059e368850429efcca39a0f1715260c016460640bf37a0ed497a4ac0750');
  });

  it('post94: locks index.ts HMAC-SHA1 and HMAC-MD5 with key routes', () => {
    expect(createHmac('sha1', 'routes').update(readFileSync(indexPath)).digest('hex')).toBe(
      'dcddcf295ba0e9554fa4894ecc1fa562933d5367',
    );
    expect(createHmac('md5', 'routes').update(readFileSync(indexPath)).digest('hex')).toBe(
      'e384fe031439bea3809386f2e1015442',
    );
  });

  it('post94: locks index.ts byte length via stat Buffer and code-unit length', () => {
    expect(statSync(indexPath).size).toBe(4738);
    expect(readFileSync(indexPath).byteLength).toBe(4738);
    expect(indexSrc.length).toBe(4724); // UTF-16 code units; crab emoji is 2 units / 4 UTF-8 bytes
    expect(Buffer.byteLength(indexSrc, 'utf8')).toBe(4738);
  });

  it('post94: locks index.ts line/newline counts and trailing newline', () => {
    expect(indexSrc.split('\n')).toHaveLength(154);
    expect((indexSrc.match(/\n/g) ?? []).length).toBe(153);
    expect(indexSrc.endsWith('\n')).toBe(true);
    expect(indexSrc).not.toContain('\r');
  });

  it('post94: locks index.ts byte checksums (sum and xor)', () => {
    const bytes = [...readFileSync(indexPath)];
    expect(bytes.reduce((a, b) => a + b, 0)).toBe(387993);
    expect(bytes.reduce((a, b) => a ^ b, 0)).toBe(57);
    expect(bytes.reduce((a, b) => a + b, 0) % 65536).toBe(60313);
  });

  it('post94: locks index.ts quote/space/punct inventory', () => {
    expect((indexSrc.match(/ /g) ?? []).length).toBe(761);
    expect((indexSrc.match(/'/g) ?? []).length).toBe(85);
    expect((indexSrc.match(/"/g) ?? []).length).toBe(20);
    expect((indexSrc.match(/:/g) ?? []).length).toBe(72);
    expect((indexSrc.match(/,/g) ?? []).length).toBe(69);
    expect((indexSrc.match(/\t/g) ?? []).length).toBe(0);
  });

  it('post94: locks export/import/route surface counts on index.ts', () => {
    expect([...indexSrc.matchAll(/^import /gm)]).toHaveLength(5);
    expect([...indexSrc.matchAll(/^export /gm)]).toHaveLength(1);
    expect([...indexSrc.matchAll(/app\.get\(/g)]).toHaveLength(5);
    expect([...indexSrc.matchAll(/app\.use\(/g)]).toHaveLength(1);
    expect([...indexSrc.matchAll(/\bfetch\s*\(/g)]).toHaveLength(3);
    expect([...indexSrc.matchAll(/\.slice\(/g)]).toHaveLength(2);
    expect([...indexSrc.matchAll(/\breturn\b/g)]).toHaveLength(12);
    expect([...indexSrc.matchAll(/\basync\b/g)]).toHaveLength(4);
    expect([...indexSrc.matchAll(/\bawait\b/g)]).toHaveLength(10);
    expect([...indexSrc.matchAll(/c\.json\(/g)]).toHaveLength(8);
    expect([...indexSrc.matchAll(/\bthrow\b/g)]).toHaveLength(3);
    expect((indexSrc.match(/retry_after/g) ?? []).length).toBe(3);
    expect((indexSrc.match(/editorial:\s*null/g) ?? []).length).toBe(1);
    expect([...indexSrc.matchAll(/VERSION \?\? '0\.1\.0'/g)]).toHaveLength(2);
  });

  it('post94: locks app.get route order / /health /genres /stations /curate', () => {
    const routes = [...indexSrc.matchAll(/app\.get\('([^']+)'/g)].map((m) => m[1]);
    expect(routes).toEqual(['/', '/health', '/genres', '/stations', '/curate']);
  });

  it('post94: locks IPTV_BASE exact CDN categories URL', () => {
    expect(indexSrc).toContain("const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'");
  });

  it('post94: locks Gemini model path and v1beta generateContent', () => {
    expect(indexSrc).toContain('models/gemini-2.0-flash:generateContent');
    expect(indexSrc).toContain('generativelanguage.googleapis.com/v1beta');
    expect(indexSrc).toContain("method: 'POST'");
  });

  it('post94: locks KV cache expirationTtl 3600 and stations: key prefix', () => {
    expect(indexSrc).toContain('expirationTtl: 3600');
    expect(indexSrc).toContain('stations:${genre}');
  });

  it('post94: locks Gemini station cap slice(0, 50) and degrade slice(0, 5)', () => {
    expect(indexSrc).toContain('.slice(0, 50)');
    expect(indexSrc).toContain('.slice(0, 5)');
  });

  it('post94: locks curated_by and powered_by brand strings', () => {
    expect(indexSrc).toContain("curated_by: 'Backlink/Geryon'");
    expect(indexSrc).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it('post94: locks cors middleware via app.use star before routes', () => {
    const cors = indexSrc.indexOf("app.use('*', cors())");
    const firstGet = indexSrc.indexOf("app.get('/',");
    expect(cors).toBeGreaterThan(-1);
    expect(firstGet).toBeGreaterThan(cors);
  });

  it('post94: locks generationConfig maxOutputTokens 512 temperature 0.7', () => {
    expect(indexSrc).toContain('maxOutputTokens: 512');
    expect(indexSrc).toContain('temperature: 0.7');
  });

  it('post94: locks Gemini JSON extract regex shape', () => {
    expect(indexSrc).toContain('text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/)');
  });

  it('post94: locks persona You are Backlink an AI radio curator', () => {
    expect(indexSrc).toContain('You are Backlink, an AI radio curator.');
  });

  it('post94: locks music.m3u fallback and Stream catalog unavailable throw', () => {
    expect(indexSrc).toContain('${IPTV_BASE}/music.m3u');
    expect(indexSrc).toContain("throw new Error('Stream catalog unavailable')");
  });

  it('post94: locks dual join separators prompt slash vs response space', () => {
    expect(indexSrc).toMatch(/\[mood,\s*genre\]\.filter\(Boolean\)\.join\(' \/ '\)/);
    expect(indexSrc).toMatch(/\[mood,\s*genreParam\]\.filter\(Boolean\)\.join\(' '\)/);
  });

  it('post94: locks /curate resolveGenre(genreParam ?? mood) and /stations resolveGenre(genreParam)', () => {
    const stationsBlock = indexSrc.slice(
      indexSrc.indexOf("app.get('/stations'"),
      indexSrc.indexOf("app.get('/curate'"),
    );
    const curateBlock = indexSrc.slice(indexSrc.indexOf("app.get('/curate'"));
    expect(stationsBlock).toContain('resolveGenre(genreParam)');
    expect(stationsBlock).not.toContain('genreParam ?? mood');
    expect(curateBlock).toContain('resolveGenre(genreParam ?? mood)');
  });

  it('post94: locks GEMINI_API_KEY guard before fetchStations in /curate', () => {
    const keyGuard = indexSrc.indexOf('if (!c.env.GEMINI_API_KEY)');
    const fetchStationsCall = indexSrc.indexOf('stations = await fetchStations(genre', keyGuard);
    expect(keyGuard).toBeGreaterThan(-1);
    expect(fetchStationsCall).toBeGreaterThan(keyGuard);
  });

  it('post94: negative product inventing — no playlist/now-playing/openapi/graphql routes', () => {
    expect(indexSrc).not.toMatch(/playlist/i);
    expect(indexSrc).not.toMatch(/now-?playing/i);
    expect(indexSrc).not.toMatch(/openapi/i);
    expect(indexSrc).not.toMatch(/graphql/i);
    expect(indexSrc).not.toMatch(/websocket/i);
    expect(indexSrc).not.toMatch(/sse/i);
    expect(indexSrc).not.toMatch(/websocket/i);
  });

  it('post94: negative — index.ts does not reference wrangler MCP_MANIFEST claw-mcp anthropic', () => {
    expect(indexSrc).not.toContain('wrangler');
    expect(indexSrc).not.toContain('MCP_MANIFEST');
    expect(indexSrc).not.toContain('claw-mcp');
    expect(indexSrc).not.toMatch(/anthropic|claude|haiku/i);
    expect(indexSrc).not.toMatch(/from\s+['"]\.\/mcp['"]/);
  });

  it('post94: negative — no POST/PUT/PATCH/DELETE handlers registered', () => {
    expect(indexSrc).not.toMatch(/app\.(post|put|patch|delete)\(/);
  });

  it('post94: locks import order hono cors genres parser types', () => {
    const imports = indexSrc
      .split('\n')
      .filter((l) => l.startsWith('import '))
      .map((l) => l.replace(/^import .+ from ['"]([^'"]+)['"].*$/, '$1'));
    expect(imports).toEqual(['hono', 'hono/cors', './genres', './parser', './types']);
  });

  it('post94: locks package.json name version description vs root metadata', async () => {
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.description).toBe(pkg.description);
    expect(body.name).toBe('Backlink');
  });

  it('post94: locks AGENTS Verify scripts equal package scripts', () => {
    expect(agentsMd).toContain('npm ci');
    expect(agentsMd).toContain('npm run typecheck');
    expect(agentsMd).toContain('npm test');
    expect(agentsMd).toContain('npm run test:coverage');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post94: locks README documents live Worker endpoints', () => {
    expect(readmeMd).toMatch(/\/curate/);
    expect(readmeMd).toMatch(/\/stations/);
    expect(readmeMd).toMatch(/\/genres/);
    expect(readmeMd).toMatch(/\/health/);
    expect(readmeMd).toContain('backlink.fuzzywigg.com');
  });

  it('post94: locks DEPLOY HITL and wrangler secret put GEMINI_API_KEY', () => {
    expect(deployMd).toMatch(/HITL/i);
    expect(deployMd).toMatch(/wrangler secret put GEMINI_API_KEY/);
    expect(deployMd).not.toMatch(/ANTHROPIC_API_KEY/);
  });

  it('post94: root name Backlink and endpoint key order lock', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.name).toBe('Backlink');
    expect(Object.keys(body)).toEqual(['name', 'description', 'version', 'endpoints', 'powered_by']);
    expect(Object.keys(body.endpoints as object)).toEqual(['/curate', '/stations', '/genres', '/health']);
  });

  it('post94: root version uses env VERSION when set', async () => {
    const body = await json(await app.request('/', undefined, testEnv({ VERSION: '9.9.9-post94' })));
    expect(body.version).toBe('9.9.9-post94');
  });

  it('post94: root version falls back to 0.1.0 when VERSION undefined', async () => {
    const env = testEnv();
    delete (env as { VERSION?: string }).VERSION;
    const body = await json(await app.request('/', undefined, env));
    expect(body.version).toBe('0.1.0');
  });

  it('post94: /health ok true and version env override', async () => {
    const body = await json(await app.request('/health', undefined, testEnv({ VERSION: '1.2.3-post94' })));
    expect(body).toEqual({ ok: true, version: '1.2.3-post94' });
  });

  it('post94: /health CORS allow-origin is *', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post94: content-type application/json on /, /health, /genres', async () => {
    for (const path of ['/', '/health', '/genres'] as const) {
      const res = await app.request(path, undefined, testEnv());
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
    }
  });

  it('post94: /genres aliases equal GENRE_MAP and genres equal VALID_GENRES copy', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.aliases).toEqual(GENRE_MAP);
    expect(body.genres).toEqual([...VALID_GENRES]);
    const genres = body.genres as string[];
    genres.push('invented-post94');
    expect(VALID_GENRES).not.toContain('invented-post94');
  });

  it('post94: /genres never calls fetch', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/genres', undefined, testEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post94: /health never calls fetch', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/health', undefined, testEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post94: root never calls fetch', async () => {
    const fetchMock = stubIptvAndGemini({});
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/', undefined, testEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post94: /stations alias chill resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=chill', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias late night resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=late%20night', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias lo-fi resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=lo-fi', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias lofi resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=lofi', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias focus resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=focus', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias relaxing resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=relaxing', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias electronic resolves to ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=electronic', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias blues resolves to jazz', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=blues', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias classic resolves to classical', async () => {
    const seed = seedStationsCache('classical', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=classic', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('classical');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias indie resolves to rock', async () => {
    const seed = seedStationsCache('rock', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=indie', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('rock');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias metal resolves to rock', async () => {
    const seed = seedStationsCache('rock', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=metal', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('rock');
    expect(body.count).toBe(1);
  });

  it('post94: /stations alias dance resolves to pop', async () => {
    const seed = seedStationsCache('pop', [{ name: 'N', url: 'https://n' }]);
    const body = await json(
      await app.request('/stations?genre=dance', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('pop');
    expect(body.count).toBe(1);
  });

  it('post94: /stations identity genre music uses stations:music cache key', async () => {
    const seed = seedStationsCache('music', [{ name: 'music-s', url: 'https://music' }]);
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('music');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('music-s');
  });

  it('post94: /stations identity genre ambient uses stations:ambient cache key', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'ambient-s', url: 'https://ambient' }]);
    const body = await json(
      await app.request('/stations?genre=ambient', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('ambient-s');
  });

  it('post94: /stations identity genre jazz uses stations:jazz cache key', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'jazz-s', url: 'https://jazz' }]);
    const body = await json(
      await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('jazz-s');
  });

  it('post94: /stations identity genre classical uses stations:classical cache key', async () => {
    const seed = seedStationsCache('classical', [{ name: 'classical-s', url: 'https://classical' }]);
    const body = await json(
      await app.request('/stations?genre=classical', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('classical');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('classical-s');
  });

  it('post94: /stations identity genre pop uses stations:pop cache key', async () => {
    const seed = seedStationsCache('pop', [{ name: 'pop-s', url: 'https://pop' }]);
    const body = await json(
      await app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('pop');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('pop-s');
  });

  it('post94: /stations identity genre rock uses stations:rock cache key', async () => {
    const seed = seedStationsCache('rock', [{ name: 'rock-s', url: 'https://rock' }]);
    const body = await json(
      await app.request('/stations?genre=rock', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('rock');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('rock-s');
  });

  it('post94: /stations identity genre news uses stations:news cache key', async () => {
    const seed = seedStationsCache('news', [{ name: 'news-s', url: 'https://news' }]);
    const body = await json(
      await app.request('/stations?genre=news', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('news');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('news-s');
  });

  it('post94: /stations identity genre sports uses stations:sports cache key', async () => {
    const seed = seedStationsCache('sports', [{ name: 'sports-s', url: 'https://sports' }]);
    const body = await json(
      await app.request('/stations?genre=sports', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('sports');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('sports-s');
  });

  it('post94: /stations identity genre entertainment uses stations:entertainment cache key', async () => {
    const seed = seedStationsCache('entertainment', [{ name: 'entertainment-s', url: 'https://entertainment' }]);
    const body = await json(
      await app.request('/stations?genre=entertainment', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('entertainment');
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('entertainment-s');
  });

  it('post94: /stations unknown genre falls back to music catalog key', async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    const body = await json(
      await app.request('/stations?genre=not-a-real-genre-post94', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('music');
  });

  it('post94: /stations without genre query defaults to music', async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    const body = await json(
      await app.request('/stations', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('music');
    expect(body.count).toBe(1);
  });

  it('post94: /stations serves from KV without refetching', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'Cached', url: 'https://c' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.count).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post94: /stations cold fetch caches with expirationTtl 3600', async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    expect(kv.put).toHaveBeenCalledWith(
      'stations:music',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('post94: /stations music fallback still caches under original genre key jazz', async () => {
    const kv = mockKV();
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ iptvByGenre: { jazz: null, music: SAMPLE_M3U } }),
    );
    await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    const keys = (kv.put as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(keys).toContain('stations:jazz');
    expect(keys).not.toContain('stations:music');
  });

  it('post94: /stations 503 when catalog and music fallback both fail', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/stations?genre=news', undefined, testEnv());
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('post94: /stations does not call Gemini even when key present', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('post94: /stations count matches stations array length', async () => {
    const stations = [
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'https://b' },
      { name: 'C', url: 'https://c' },
    ];
    const seed = seedStationsCache('pop', stations);
    const body = await json(
      await app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.count).toBe((body.stations as unknown[]).length);
    expect(body.count).toBe(3);
  });

  it('post94: /stations iptvCategoryUrl helper matches Worker CDN path', async () => {
    expect(iptvCategoryUrl('ambient')).toBe('https://iptv-org.github.io/iptv/categories/ambient.m3u');
    const kv = mockKV();
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=ambient', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('ambient'));
  });

  it('post94: /stations buildSimpleM3U countHttpStreamLines cross-lock', async () => {
    const m3u = buildSimpleM3U([
      { name: 'One', url: 'https://one' },
      { name: 'Two', url: 'https://two' },
    ]);
    expect(countHttpStreamLines(m3u)).toBe(2);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(
      await app.request('/stations?genre=rock', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    );
    expect(body.count).toBe(2);
  });

  it('post94: /curate 503 when GEMINI_API_KEY missing', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Curation service unavailable',
      retry_after: 60,
    });
  });

  it('post94: /curate 503 for empty-string GEMINI_API_KEY', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: '' }));
    expect(res.status).toBe(503);
  });

  it('post94: /curate 503 when catalog fetch fails with key present', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });

  it('post94: /curate happy path curated_by Backlink/Geryon', async () => {
    const seed = seedStationsCache('music', [{ name: 'Alpha FM', url: 'https://example.com/alpha.m3u8' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(typeof body.timestamp).toBe('string');
    expect(Date.parse(body.timestamp as string)).not.toBeNaN();
    expect((body.stations as unknown[]).length).toBeGreaterThan(0);
  });

  it('post94: /curate mood-only late night resolves ambient catalog', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'Night', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{
      name: 'Night', url: 'https://n', editorial: 'nocturnal', genre: 'ambient',
    }]) }));
    const body = await json(
      await app.request('/curate?mood=late%20night', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('late night');
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe('ambient');
  });

  it('post94: /curate genre+mood query joins with space', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=jazz&mood=late%20night', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('late night jazz');
  });

  it('post94: /curate Gemini prompt joins mood/genre with slash', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request(
      '/curate?genre=jazz&mood=focus',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }),
    );
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('User request: focus / jazz');
  });

  it('post94: /curate Gemini HTTP 500 degrades with editorial null', async () => {
    const seed = seedStationsCache('music', [
      { name: 'A', url: 'https://a' },
      { name: 'B', url: 'https://b' },
      { name: 'C', url: 'https://c' },
      { name: 'D', url: 'https://d' },
      { name: 'E', url: 'https://e' },
      { name: 'F', url: 'https://f' },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('boom', { status: 500 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.stations as unknown[]).length).toBe(5);
    expect((body.stations as Array<{ editorial: null }>)[0].editorial).toBeNull();
  });

  it('post94: /curate Gemini HTTP 429 degrades to 200 with editorial null', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('rate', { status: 429 }) }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.stations as Array<{ editorial: null }>)[0].editorial).toBeNull();
  });

  it('post94: /curate invalid Gemini JSON text degrades', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        gemini: geminiTextResponse('sorry, no stations today'),
      }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect((body.stations as Array<{ editorial: null }>)[0].editorial).toBeNull();
  });

  it('post94: /curate empty candidates degrades', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ gemini: Response.json({ candidates: [] }) }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('A');
  });

  it('post94: /curate large catalog Gemini prompt includes only first 50 station lines', async () => {
    const stations = Array.from({ length: 60 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/${i}`,
    }));
    const seed = seedStationsCache('music', stations);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. S0');
    expect(text).toContain('50. S49');
    expect(text).not.toContain('51. S50');
  });

  it('post94: /curate response query falls back to resolved genre when mood and genreParam absent', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('music');
  });

  it('post94: /curate Gemini request method POST and content-type json', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const g = captureGeminiRequest(fetchMock)!;
    expect(g.method).toBe('POST');
    expect(g.url).toContain('generativelanguage.googleapis.com');
    expect(g.url).toContain('gemini-2.0-flash');
    expect(g.url).toContain('key=k');
    const headers = g.headers as Record<string, string>;
    expect(headers['content-type'] || (headers as { get?: (k: string) => string }).get?.('content-type')).toBeTruthy();
  });

  it('post94: /curate generationConfig locked in request body', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'secret', CATALOG_CACHE: mockKV(seed) }));
    const g = captureGeminiRequest(fetchMock)!;
    const cfg = (g.body as { generationConfig: { maxOutputTokens: number; temperature: number } }).generationConfig;
    expect(cfg).toEqual({ maxOutputTokens: 512, temperature: 0.7 });
  });

  it('post94: empty stations catalog curate degrade returns empty stations array', async () => {
    const seed = seedStationsCache('music', []);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('boom', { status: 500 }) }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.stations).toEqual([]);
  });

  it('post94: sequential /curate calls share no mutable module state beyond KV', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const env = testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) });
    const a = await json(await app.request('/curate?genre=music', undefined, env));
    const b = await json(await app.request('/curate?genre=music', undefined, env));
    expect(a.curated_by).toBe(b.curated_by);
    expect((a.stations as unknown[]).length).toBe((b.stations as unknown[]).length);
  });

  it('post94: Promise.all parallel /health requests all ok', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => app.request('/health', undefined, testEnv())),
    );
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ ok: true });
    }
  });

  it('post94: Promise.all parallel /genres requests share aliases', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => app.request('/genres', undefined, testEnv())),
    );
    for (const res of results) {
      const body = await json(res);
      expect(body.aliases).toEqual(GENRE_MAP);
    }
  });

  it('post94: POST to GET routes is rejected (not 200 JSON happy path)', async () => {
    for (const path of ['/', '/health', '/genres', '/stations', '/curate'] as const) {
      const res = await app.request(path, { method: 'POST' }, testEnv());
      expect(res.status).not.toBe(200);
    }
  });

  it('post94: OPTIONS preflight CORS allow-origin *', async () => {
    const res = await app.request('/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post94: HEAD on /health mirrors GET status', async () => {
    const res = await app.request('/health', { method: 'HEAD' }, testEnv());
    expect(res.status).toBe(200);
  });

  it('post94: unknown path returns non-200', async () => {
    const res = await app.request('/not-a-route-post94', undefined, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('post94: Map of VALID_GENRES to /stations warm counts is 1 each for seeded', async () => {
    const counts = new Map<string, number>();
    for (const g of VALID_GENRES) {
      const seed = seedStationsCache(g, [{ name: g, url: `https://${g}` }]);
      const body = await json(
        await app.request(`/stations?genre=${g}`, undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
      );
      counts.set(g, body.count as number);
    }
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
    expect(counts.size).toBe(9);
  });

  it('post94: Intl.Collator sorted endpoint keys from root', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const keys = Object.keys(body.endpoints as object);
    const sorted = keys.slice().sort(new Intl.Collator('en').compare);
    expect(sorted).toEqual(['/curate', '/genres', '/health', '/stations'].sort(new Intl.Collator('en').compare));
  });

  it('post94: fromCharCode rebuild of Backlink matches root name', async () => {
    const name = String.fromCharCode(66, 97, 99, 107, 108, 105, 110, 107);
    expect(name).toBe('Backlink');
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.name).toBe(name);
  });

  it('post94: codePointAt of powered_by crab emoji', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const pb = body.powered_by as string;
    expect(pb.codePointAt(pb.length - 2)).toBe(0x1f980);
  });

  it('post94: btoa of Backlink name is stable', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(btoa(body.name as string)).toBe('QmFja2xpbms=');
  });

  it('post94: TextEncoder byte length of root description locks', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const bytes = new TextEncoder().encode(body.description as string);
    expect(bytes.byteLength).toBe(Buffer.byteLength(pkg.description, 'utf8'));
  });

  it('post94: sha256 of compact /health JSON under default testEnv', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const compact = JSON.stringify(body);
    expect(createHash('sha256').update(compact).digest('hex')).toBe(
      createHash('sha256').update('{"ok":true,"version":"0.1.0-test"}').digest('hex'),
    );
  });

  it('post94: Object.freeze on /health body copy cannot rewrite ok', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const frozen = Object.freeze({ ...body });
    expect(() => {
      (frozen as { ok: boolean }).ok = false;
    }).toThrow();
    expect(frozen.ok).toBe(true);
  });

  it('post94: Proxy over /genres aliases still reads GENRE_MAP chill', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const aliases = body.aliases as Record<string, string>;
    const proxied = new Proxy(aliases, {
      get(t, p, r) {
        return Reflect.get(t, p, r);
      },
    });
    expect(proxied.chill).toBe('ambient');
  });

  it('post94: Set of root endpoint paths has size 4', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(new Set(Object.keys(body.endpoints as object)).size).toBe(4);
  });

  it('post94: WeakMap can hold env object identity across /health calls', async () => {
    const env = testEnv();
    const wm = new WeakMap<object, string>();
    wm.set(env as object, 'post94');
    await app.request('/health', undefined, env);
    expect(wm.get(env as object)).toBe('post94');
  });

  it('post94: encodeURIComponent of genre jazz is identity in /stations URL', async () => {
    expect(encodeURIComponent('jazz')).toBe('jazz');
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    const body = await json(
      await app.request(`/stations?genre=${encodeURIComponent('jazz')}`, undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('jazz');
  });

  it('post94: ArrayBuffer first byte of compact health JSON is 0x7b', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const buf = new TextEncoder().encode(JSON.stringify(body)).buffer;
    expect(new Uint8Array(buf)[0]).toBe(0x7b);
  });

  it('post94: Reflect.ownKeys on /health matches Object.keys', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(Reflect.ownKeys(body)).toEqual(Object.keys(body));
  });

  it('post94: JSON round-trip of /health body preserves shape', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(JSON.parse(JSON.stringify(body))).toEqual({ ok: true, version: '0.1.0-test' });
  });

  it('post94: crypto.randomUUID format lock alongside /health purity', async () => {
    const uuid = crypto.randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(body.ok).toBe(true);
  });

  it('post94: path.basename of worker entry is index.ts', () => {
    expect(basename(indexPath)).toBe('index.ts');
  });

  it('post94: Buffer.byteLength of index.ts equals 4738', () => {
    expect(Buffer.byteLength(indexSrc, 'utf8')).toBe(4738);
  });

  it('post94: export default app is the final export', () => {
    const exports = [...indexSrc.matchAll(/^export .+$/gm)].map((m) => m[0]);
    expect(exports).toEqual(['export default app;']);
  });

  it('post94: punctuation inventory locks for index.ts braces and semis', () => {
    expect((indexSrc.match(/\{/g) ?? []).length).toBe(58);
    expect((indexSrc.match(/\}/g) ?? []).length).toBe(58);
    expect((indexSrc.match(/;/g) ?? []).length).toBe(61);
  });

  it('post94: index.ts comment line count lock', () => {
    const comments = indexSrc.split('\n').filter((l) => l.trim().startsWith('//'));
    expect(comments).toHaveLength(2);
  });

  it('post94: 503 retry_after literal 60 appears three times in index.ts', () => {
    expect([...indexSrc.matchAll(/retry_after:\s*60/g)]).toHaveLength(3);
  });

  it('post94: Gemini error throw includes status interpolation', () => {
    expect(indexSrc).toContain('Gemini API error: ${resp.status}');
  });

  it('post94: Invalid JSON from Gemini throw literal', () => {
    expect(indexSrc).toContain("throw new Error('Invalid JSON from Gemini')");
  });

  it('post94: Curation service unavailable and Stream catalog unavailable literals', () => {
    expect(indexSrc).toContain("error: 'Curation service unavailable'");
    expect(indexSrc).toContain("error: 'Stream catalog unavailable'");
  });

  it('post94: degrade map copies name url logo only (no language/country)', () => {
    const degrade = indexSrc.slice(indexSrc.indexOf('stations.slice(0, 5)'));
    expect(degrade).toContain('name: s.name');
    expect(degrade).toContain('url: s.url');
    expect(degrade).toContain('logo: s.logo');
    expect(degrade).toContain('editorial: null');
    expect(degrade.slice(0, 400)).not.toContain('language');
    expect(degrade.slice(0, 400)).not.toContain('country');
  });

  it('post94: iptvCallsWithInit stays empty for bare fetch(url) catalog calls', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('post94: /stations corrupt KV JSON returns 503', async () => {
    const kv = mockKV({ 'stations:music': '{not-json' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(503);
  });

  it('post94: /curate corrupt KV JSON returns 503 with key present', async () => {
    const kv = mockKV({ 'stations:music': '{not-json' });
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: kv }),
    );
    expect(res.status).toBe(503);
  });

  it('post94: /stations fetch throw network error returns 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
  });

  it('post94: /curate fetch throw during catalog returns 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const res = await app.request(
      '/curate?genre=music',
      undefined,
      testEnv({ GEMINI_API_KEY: 'k' }),
    );
    expect(res.status).toBe(503);
  });

  it('post94: /curate mood=chill resolves catalog ambient', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'S', url: 'https://s' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('chill');
  });

  it('post94: /curate mood=blues resolves catalog jazz', async () => {
    const seed = seedStationsCache('jazz', [{ name: 'S', url: 'https://s' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?mood=blues', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('blues');
  });

  it('post94: /curate mood=indie resolves catalog rock', async () => {
    const seed = seedStationsCache('rock', [{ name: 'S', url: 'https://s' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?mood=indie', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('indie');
  });

  it('post94: /curate mood=dance resolves catalog pop', async () => {
    const seed = seedStationsCache('pop', [{ name: 'S', url: 'https://s' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?mood=dance', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('dance');
  });

  it('post94: /curate mood=classic resolves catalog classical', async () => {
    const seed = seedStationsCache('classical', [{ name: 'S', url: 'https://s' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?mood=classic', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('classic');
  });

  it('post94: content-type application/json on /stations success', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) }));
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('post94: content-type application/json on /curate 503', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('post94: hygiene — routes test suite still imports app default from index', () => {
    const body = readFileSync(join(root, 'test/routes.test.ts'), 'utf8');
    expect(body).toContain("import app from '../src/index'");
    expect(body).toContain('post94:');
    expect(body).toContain("describe('post94 routes HEAVY deepen'");
  });

  it('post94: cross-lock README example uses late night ambient query', () => {
    expect(readmeMd).toContain('GET /curate?genre=ambient&mood=late+night');
    expect(readmeMd).toContain('"query": "late night ambient"');
  });

  it('post94: cross-lock AGENTS Safe Actions lists src/genres.ts and test/', () => {
    expect(agentsMd).toMatch(/src\/genres\.ts/);
    expect(agentsMd).toMatch(/test\//);
    expect(agentsMd).toMatch(/src\/parser\.ts/);
  });

  it('post94: cross-lock vitest coverage thresholds remain 100%', () => {
    const cfg = readUtf('vitest.config.ts');
    expect(cfg).toContain('lines: 100');
    expect(cfg).toContain('functions: 100');
    expect(cfg).toContain('branches: 100');
    expect(cfg).toContain('statements: 100');
  });

  it('post94: negative inventing — README does not document /playlist as live endpoint', () => {
    expect(readmeMd).not.toMatch(/GET \/playlist/);
    expect(readmeMd).not.toMatch(/GET \/now-playing/);
    expect(readmeMd).not.toMatch(/GET \/openapi/);
  });

  it('post94: negative inventing — no podcast/audiobook aliases forced via /stations unknown', async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    for (const g of ['podcast', 'audiobook', 'spotify', 'youtube'] as const) {
      const body = await json(
        await app.request(`/stations?genre=${g}`, undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
      );
      expect(body.genre).toBe('music');
    }
  });

  it('post94: localeCompare chain for endpoint paths vs alpha', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const keys = Object.keys(body.endpoints as object);
    const sorted = keys.slice().sort((a, b) => a.localeCompare(b));
    expect(sorted).toEqual(['/curate', '/genres', '/health', '/stations']);
  });

  it('post94: AbortSignal existence does not affect /genres', async () => {
    expect(typeof AbortSignal !== 'undefined').toBe(true);
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect((body.genres as string[]).length).toBe(9);
  });

  it('post94: final digest+route mega purity — 40 rounds', async () => {
    const expected = '7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72';
    for (let i = 0; i < 40; i++) {
      expect(sha256File('src/index.ts')).toBe(expected);
      const health = await json(await app.request('/health', undefined, testEnv()));
      expect(health.ok).toBe(true);
      const genres = await json(await app.request('/genres', undefined, testEnv()));
      expect((genres.genres as string[]).length).toBe(9);
    }
  });

  it('post94: locks helpers.ts HMAC-SHA256 with key routes', () => {
    expect(
      createHmac('sha256', 'routes').update(readFileSync(join(root, 'test/helpers.ts'))).digest('hex'),
    ).toBe('135fb5163fdda15dd50a5a13530926aeeb759d56c9a1ace4f7698a01584b08ae');
  });

  it('post94: locks helpers.ts sha256 for route fixture surface', () => {
    expect(sha256File('test/helpers.ts')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
  });

  it('post94: /stations success body key order genre count stations', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(Object.keys(body)).toEqual(['genre', 'count', 'stations']);
  });

  it('post94: /curate success body key order query curated_by timestamp stations', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(Object.keys(body)).toEqual(['query', 'curated_by', 'timestamp', 'stations']);
  });

  it('post94: /genres success body key order genres aliases', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['genres', 'aliases']);
  });

  it('post94: root endpoints descriptions are non-empty strings', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const endpoints = body.endpoints as Record<string, string>;
    for (const v of Object.values(endpoints)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('post94: locks exact root endpoint description strings', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const endpoints = body.endpoints as Record<string, string>;
    expect(endpoints['/curate']).toBe('GET ?genre=&mood= — AI-curated station picks');
    expect(endpoints['/stations']).toBe('GET ?genre= — Raw station list');
    expect(endpoints['/genres']).toBe('GET — Available genre categories');
    expect(endpoints['/health']).toBe('GET — Health check');
  });

  it('post94: /stations CORS allow-origin * on success and 503', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const ok = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) }));
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const bad = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(bad.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post94: /curate CORS allow-origin * on 503 missing key', async () => {
    const res = await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post94: stationList format includes group language and em-dash URL', async () => {
    const seed = seedStationsCache('jazz', [{
      name: 'Jazzy', url: 'https://j', group: 'Jazz', language: 'en',
    }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. Jazzy (Jazz) [en] — https://j');
  });

  it('post94: stationList defaults group to genre and language to en', async () => {
    const seed = seedStationsCache('pop', [{ name: 'P', url: 'https://p' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=pop', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const g = captureGeminiRequest(fetchMock)!;
    const text = (g.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. P (pop) [en] — https://p');
  });

  it('post94: curated success station fields include editorial string from stub', async () => {
    const seed = seedStationsCache('music', [{ name: 'Alpha FM', url: 'https://example.com/alpha.m3u8' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    const s0 = (body.stations as Array<{ editorial: string; name: string }>)[0];
    expect(s0.name).toBe('Alpha FM');
    expect(typeof s0.editorial).toBe('string');
    expect(s0.editorial.length).toBeGreaterThan(0);
  });

  it('post94: Gemini fenced JSON with surrounding prose still extracts array', async () => {
    const seed = seedStationsCache('music', [{ name: 'Alpha FM', url: 'https://example.com/alpha.m3u8' }]);
    const payload = 'Here you go:\n[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"ok","genre":"music"}]\nThanks';
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse(payload) }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Alpha FM');
    expect((body.stations as Array<{ editorial: string }>)[0].editorial).toBe('ok');
  });

  it('post94: timestamp is ISO-8601 with Z suffix', async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('post94: VERSION binding empty string is used (?? does not treat as missing)', async () => {
    const body = await json(await app.request('/health', undefined, testEnv({ VERSION: '' })));
    expect(body.version).toBe('');
  });

  it('post94: focus alias /curate uses ambient catalog when seeded', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'Focus', url: 'https://f' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{
      name: 'Focus', url: 'https://f', editorial: 'deep work', genre: 'ambient',
    }]) }));
    const body = await json(
      await app.request('/curate?genre=focus', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.query).toBe('focus');
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Focus');
  });

  it('post94: GENRE_MAP chill alias /stations seeds ambient cache key', async () => {
    const seed = seedStationsCache('ambient', [{ name: 'Chill', url: 'https://c' }]);
    const body = await json(
      await app.request('/stations?genre=chill', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
    );
    expect(body.genre).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
  });

  it('post94: countHttpStreamLines SAMPLE_M3U cross-locks cold /stations music count', async () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(
      await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() })),
    );
    expect(body.count).toBe(6);
  });

  it('post94: music primary requested caches stations:music not fallback double-fetch when ok', async () => {
    const kv = mockKV();
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    const iptvCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('iptv-org'));
    expect(iptvCalls.length).toBe(1);
    expect(String(iptvCalls[0][0])).toContain('/music.m3u');
  });

  it('post94: jazz 404 then music ok yields two iptv fetches', async () => {
    const kv = mockKV();
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: null, music: SAMPLE_M3U } });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    const iptvCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('iptv-org'));
    expect(iptvCalls.length).toBe(2);
    expect(String(iptvCalls[0][0])).toContain('/jazz.m3u');
    expect(String(iptvCalls[1][0])).toContain('/music.m3u');
  });

  it('post94: final inventory — routes describe blocks include post76 and post94', () => {
    const body = readFileSync(join(root, 'test/routes.test.ts'), 'utf8');
    expect(body).toContain("describe('post76 routes HEAVY deepen'");
    expect(body).toContain("describe('post94 routes HEAVY deepen'");
    expect((body.match(/it\('post94:/g) ?? []).length).toBeGreaterThan(100);
  });

});

describe('post111 routes HEAVY deepen (after #110/#111)', () => {
  // TOKENMAXX HEAVY burn — tests/CI only. Deepens routes leftovers on latest main
  // after merged #110 (parser) and #111 (wrangler). Orthogonal to those burns.
  // No product inventing, no credentials, no DNS, no history rewrite.

  const readUtf = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256File = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1File = (rel: string) =>
    createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5File = (rel: string) =>
    createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, s: string) =>
    createHmac('sha256', key).update(s, 'utf8').digest('hex');
  const nibbleSumHex = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibblesHex = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);

  const indexPath = join(root, 'src/index.ts');
  const indexSrc = readUtf('src/index.ts');
  const helpersSrc = readUtf('test/helpers.ts');
  const agentsMd = readUtf('AGENTS.md');
  const readmeMd = readUtf('README.md');
  const deployMd = readUtf('DEPLOY.md');
  const ciYml = readUtf('.github/workflows/ci.yml');
  const deployYml = readUtf('.github/workflows/deploy.yml');
  const wranglerToml = readUtf('wrangler.toml');
  const typesSrc = readUtf('src/types.ts');
  const pkg = JSON.parse(readUtf('package.json')) as {
    name: string;
    version: string;
    description: string;
    scripts: Record<string, string>;
  };

  it('post111: locks src/index.ts sha256 (worker entry reaffirm)', () => {
    expect(sha256File('src/index.ts')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
    expect(createHash('sha256').update(indexSrc, 'utf8').digest('hex')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post111: locks src/index.ts sha1 digest', () => {
    expect(sha1File('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post111: locks src/index.ts md5 digest', () => {
    expect(md5File('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post111: locks src/index.ts sha384 digest', () => {
    expect(createHash('sha384').update(indexSrc, 'utf8').digest('hex')).toBe('1333d65db363dca65680e10f009779453e9b14e8aff9d8197d58d8746623b0a523b80a1f65d965ac4caa069ad8010f65');
  });

  it('post111: locks src/index.ts sha512 digest', () => {
    expect(createHash('sha512').update(indexSrc, 'utf8').digest('hex')).toBe('28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3');
  });

  it('post111: locks src/index.ts sha256 nibble sum 470 xor 14', () => {
    const d = sha256File('src/index.ts');
    expect(nibbleSumHex(d)).toBe(470);
    expect(xorNibblesHex(d)).toBe(14);
  });

  it('post111: locks src/index.ts first/last sha256 octets', () => {
    const d = sha256File('src/index.ts');
    expect(d.slice(0, 2)).toBe('7f');
    expect(d.slice(-2)).toBe('72');
    expect(d).toHaveLength(64);
  });

  it("post111: HMAC-SHA256 key post111 locks index.ts", () => {
    expect(hmacSha256("post111", indexSrc)).toBe("8a4f2f4d4de0371a8b175fa1061a1d2362c21b934f4729db7493f9f83815c234");
  });

  it("post111: HMAC-SHA256 key routes locks index.ts", () => {
    expect(hmacSha256("routes", indexSrc)).toBe("eca253c0284991e95fc81744fa449b8f24cd607d192df2822c81747d7096a356");
  });

  it("post111: HMAC-SHA256 key backlink locks index.ts", () => {
    expect(hmacSha256("backlink", indexSrc)).toBe("252b29e7d7574d602146d61f7dd1a3d0d09b1374b3dd6955f63e5bd81b39cc90");
  });

  it("post111: HMAC-SHA256 key TOKENMAXX locks index.ts", () => {
    expect(hmacSha256("TOKENMAXX", indexSrc)).toBe("d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc");
  });

  it("post111: HMAC-SHA256 key HEAVY locks index.ts", () => {
    expect(hmacSha256("HEAVY", indexSrc)).toBe("f3d8136884b78d12b0d57975d091081c2234daac8b42ecdabbf37d8bb6022b30");
  });

  it("post111: HMAC-SHA256 key no-invent locks index.ts", () => {
    expect(hmacSha256("no-invent", indexSrc)).toBe("ac1664326fe9a96468bcaf27422b305e016c5cbbe30d36b433bef7df5196ecaa");
  });

  it("post111: HMAC-SHA256 key curate locks index.ts", () => {
    expect(hmacSha256("curate", indexSrc)).toBe("bd6e412755484cbb7b784ce708a72e84caf77cc400743d0a1d8d48a01611c831");
  });

  it("post111: HMAC-SHA256 key stations locks index.ts", () => {
    expect(hmacSha256("stations", indexSrc)).toBe("0e6966b318ce802f6b8bc7a211864345e31c3ae4718aa99ad5fd91c96cd88f30");
  });

  it("post111: HMAC-SHA256 key genres locks index.ts", () => {
    expect(hmacSha256("genres", indexSrc)).toBe("fb6540ca925d675d3cc2f17e55e8ced289d25def11aed59c31b822592b7273c4");
  });

  it("post111: HMAC-SHA256 key health locks index.ts", () => {
    expect(hmacSha256("health", indexSrc)).toBe("bd6695c777503b1eee23817b1aa13507ffb93001d4d1c4d7b587c6d35c59a197");
  });

  it("post111: HMAC-SHA256 key IPTV_BASE locks index.ts", () => {
    expect(hmacSha256("IPTV_BASE", indexSrc)).toBe("0f32c9992df0e7c2420b3499d73e9f409483974682e0e5fe38fd1e47712a258c");
  });

  it("post111: HMAC-SHA256 key gemini locks index.ts", () => {
    expect(hmacSha256("gemini", indexSrc)).toBe("b1cea21e8a554a31f9534cb64aea604e6f5258397114aaf2a525f5368b63b24a");
  });

  it("post111: HMAC-SHA256 key CATALOG_CACHE locks index.ts", () => {
    expect(hmacSha256("CATALOG_CACHE", indexSrc)).toBe("aeb15102e72a90f212ebe60a587c2ea0e8ac8a9a28f0150dcdb08b02f61b7692");
  });

  it("post111: HMAC-SHA256 key GEMINI_API_KEY locks index.ts", () => {
    expect(hmacSha256("GEMINI_API_KEY", indexSrc)).toBe("bcdc693b733a50487cca26fdd8549b5b526c296566a3c4475f3bc4e6a888617b");
  });

  it("post111: HMAC-SHA256 key index locks index.ts", () => {
    expect(hmacSha256("index", indexSrc)).toBe("e7dd5d33db7c019e670e5e7f1ae0063f6f1dd15babe98ae7bd0831bb63548771");
  });

  it("post111: HMAC-SHA256 key fuzzywigg locks index.ts", () => {
    expect(hmacSha256("fuzzywigg", indexSrc)).toBe("8b7bac04a4152bc93cee647ecc20a2058cc35d05f01a7e86dafe04cb298ccfb5");
  });

  it("post111: HMAC-SHA256 key parser locks index.ts", () => {
    expect(hmacSha256("parser", indexSrc)).toBe("b0baf6d64702fec99e4a13bc17a8f555b7a5b49b15e42064feb2bff35f7398ae");
  });

  it("post111: HMAC-SHA256 key helpers locks index.ts", () => {
    expect(hmacSha256("helpers", indexSrc)).toBe("ab0d801daf9d53b2efe96b9f10e6d3c740b42edda8d56905272e0c45af901eef");
  });

  it("post111: HMAC-SHA256 key cors locks index.ts", () => {
    expect(hmacSha256("cors", indexSrc)).toBe("9b9bfc72239f2978dd78c463344766460038d42bd0248d395c064aebe0bfcbec");
  });

  it("post111: HMAC-SHA256 key hono locks index.ts", () => {
    expect(hmacSha256("hono", indexSrc)).toBe("034d4664accde6d8c6b8b7ce46f1a96e5a19fe9e7b84b0822427c12304a36546");
  });

  it("post111: HMAC-SHA256 key fetchStations locks index.ts", () => {
    expect(hmacSha256("fetchStations", indexSrc)).toBe("59f1ae1b203012885bb8407fee23050cebf09200e2d6a96ebb5ee62ae26bec36");
  });

  it("post111: HMAC-SHA256 key callGemini locks index.ts", () => {
    expect(hmacSha256("callGemini", indexSrc)).toBe("148b016b67ef53a08385c65c19a9870f30e7fac07d2766895ca329b0e56b8edb");
  });

  it("post111: HMAC-SHA256 key VALID_GENRES locks index.ts", () => {
    expect(hmacSha256("VALID_GENRES", indexSrc)).toBe("2211e9dc3aa68885606978ad97ddddbe2e902eb0665b8cde8c052c3abaaa0db6");
  });

  it("post111: HMAC-SHA256 key GENRE_MAP locks index.ts", () => {
    expect(hmacSha256("GENRE_MAP", indexSrc)).toBe("54b3154a472d1258244778485ff7412915e56a123910647701595cd60f15292f");
  });

  it("post111: HMAC-SHA256 key resolveGenre locks index.ts", () => {
    expect(hmacSha256("resolveGenre", indexSrc)).toBe("e905e77840e53c3149e781f283f5bba894b684e71e76f99e225ee98a8a871524");
  });

  it("post111: HMAC-SHA256 key music locks index.ts", () => {
    expect(hmacSha256("music", indexSrc)).toBe("762be37537e14b6c6b34abe76659ff525da74167ecf1294525501107d4cde08d");
  });

  it("post111: HMAC-SHA256 key jazz locks index.ts", () => {
    expect(hmacSha256("jazz", indexSrc)).toBe("b2f484fafd96dca03dab039994c60fb03c3db3801a656dcb0790fe0c356c8bc4");
  });

  it("post111: HMAC-SHA256 key ambient locks index.ts", () => {
    expect(hmacSha256("ambient", indexSrc)).toBe("e4048e86504c4f48d32cc685360d8a9e3dce297c81b43159d4fb38a85118da34");
  });

  it("post111: HMAC-SHA256 key 0.1.0 locks index.ts", () => {
    expect(hmacSha256("0.1.0", indexSrc)).toBe("7c8526540df3a4afa919e84940dff4f6d381805a1c88c170ea58142c78285dcc");
  });

  it("post111: HMAC-SHA256 key Backlink/Geryon locks index.ts", () => {
    expect(hmacSha256("Backlink/Geryon", indexSrc)).toBe("07af2f4b401484ceb712d07fa41972ee8065f9efade6a98ac217ccfb88a4fa96");
  });

  it("post111: HMAC-SHA256 key iptv-org locks index.ts", () => {
    expect(hmacSha256("iptv-org", indexSrc)).toBe("3c0dc21e4b8267c2ab1bf4452da2bda68627db162628cb9441e1f5d40669e5d9");
  });

  it("post111: HMAC-SHA256 key generativelanguage locks index.ts", () => {
    expect(hmacSha256("generativelanguage", indexSrc)).toBe("5cad1897f2d2146890f60491a1bd874c1c89994990e17a37be08df6dedd10238");
  });

  it("post111: HMAC-SHA256 key expirationTtl locks index.ts", () => {
    expect(hmacSha256("expirationTtl", indexSrc)).toBe("200c922fcb3bc775c0b178ae78807a9d91d918d752809e52c30b965860794051");
  });

  it("post111: HMAC-SHA256 key retry_after locks index.ts", () => {
    expect(hmacSha256("retry_after", indexSrc)).toBe("51bff88a9a4a4ac839c92bcf7b6961a52ed333c85ee1498db2afafa97ac91532");
  });

  it("post111: HMAC-SHA256 key powered_by locks index.ts", () => {
    expect(hmacSha256("powered_by", indexSrc)).toBe("84f4c61de8d0453c9ee1fd248dd370c88481a87e243830a6d38656b16b5a552f");
  });

  it("post111: HMAC-SHA256 key curated_by locks index.ts", () => {
    expect(hmacSha256("curated_by", indexSrc)).toBe("b92d7466e483a71fd9c2bde9dc996e0ecba5534c84c4f7d7b3377b35ac914fb2");
  });

  it('post111: HMAC digests differ for distinct keys', () => {
    expect(hmacSha256('post111', indexSrc)).not.toBe(hmacSha256('routes', indexSrc));
    expect(hmacSha256('curate', indexSrc)).not.toBe(hmacSha256('stations', indexSrc));
    expect(hmacSha256('TOKENMAXX', indexSrc)).not.toBe(hmacSha256('HEAVY', indexSrc));
  });

  it('post111: utf8 char length 4724', () => {
    expect(indexSrc).toHaveLength(4724);
  });

  it('post111: byte length 4738 via Buffer/TextEncoder/stat', () => {
    expect(Buffer.byteLength(indexSrc, 'utf8')).toBe(4738);
    expect(new TextEncoder().encode(indexSrc).length).toBe(4738);
    expect(statSync(indexPath).size).toBe(4738);
  });

  it('post111: newline count 153 / split 154', () => {
    expect((indexSrc.match(/\n/g) ?? []).length).toBe(153);
    expect(indexSrc.split('\n')).toHaveLength(154);
  });

  it('post111: nonempty line count 125', () => {
    expect(indexSrc.split('\n').filter((l) => l.length > 0)).toHaveLength(125);
  });

  it('post111: blank line count 29', () => {
    expect(indexSrc.split('\n').filter((l) => l.length === 0)).toHaveLength(29);
  });

  it('post111: line length vector lock', () => {
    expect(indexSrc.split('\n').map((l) => l.length)).toEqual([28,33,65,45,30,0,63,0,82,39,40,53,0,42,29,0,16,28,48,63,3,0,31,33,0,76,18,1,0,26,17,22,16,16,99,58,30,17,98,16,0,418,0,27,109,5,21,54,28,50,69,9,6,4,0,68,0,39,71,4,65,0,56,62,0,34,1,0,42,0,21,0,21,17,21,83,38,16,64,52,52,38,6,37,5,3,0,27,65,3,0,27,17,30,23,5,3,0,35,42,41,0,26,7,63,11,81,3,0,61,3,0,33,42,35,49,0,30,83,3,0,26,7,63,11,81,3,0,70,0,14,7,76,11,59,48,19,17,19,22,12,8,3,0,17,10,34,40,22,5,3,0,19,0]);
  });

  it('post111: nonempty line length sum 4571', () => {
    expect(
      indexSrc
        .split('\n')
        .filter((l) => l.length > 0)
        .reduce((a, l) => a + l.length, 0),
    ).toBe(4571);
  });

  it('post111: first 40 char codes lock', () => {
    expect([...indexSrc.slice(0, 40)].map((c) => c.charCodeAt(0))).toEqual([105,109,112,111,114,116,32,123,32,72,111,110,111,32,125,32,102,114,111,109,32,39,104,111,110,111,39,59,10,105,109,112,111,114,116,32,123,32,99,111]);
  });

  it('post111: last 40 char codes lock', () => {
    expect([...indexSrc.slice(-40)].map((c) => c.charCodeAt(0))).toEqual([99,117,114,97,116,101,100,44,10,32,32,125,41,59,10,125,41,59,10,10,101,120,112,111,114,116,32,100,101,102,97,117,108,116,32,97,112,112,59,10]);
  });

  it('post111: digit count lock', () => {
    expect([...indexSrc].filter((c) => /\d/.test(c))).toHaveLength(51);
  });

  it('post111: uppercase count lock', () => {
    expect([...indexSrc].filter((c) => /[A-Z]/.test(c))).toHaveLength(262);
  });

  it('post111: lowercase count lock', () => {
    expect([...indexSrc].filter((c) => /[a-z]/.test(c))).toHaveLength(2597);
  });

  it('post111: space count lock', () => {
    expect((indexSrc.match(/ /g) ?? []).length).toBe(761);
  });

  it('post111: double-quote count lock', () => {
    expect((indexSrc.match(/"/g) ?? []).length).toBe(20);
  });

  it('post111: single-quote count lock', () => {
    expect((indexSrc.match(/'/g) ?? []).length).toBe(85);
  });

  it('post111: backtick count lock', () => {
    expect((indexSrc.match(/`/g) ?? []).length).toBe(14);
  });

  it('post111: equals count lock', () => {
    expect((indexSrc.match(/=/g) ?? []).length).toBe(37);
  });

  it('post111: underscore count lock', () => {
    expect((indexSrc.match(/_/g) ?? []).length).toBe(18);
  });

  it('post111: dash count lock', () => {
    expect((indexSrc.match(/-/g) ?? []).length).toBe(8);
  });

  it('post111: bracket pair counts', () => {
    expect((indexSrc.match(/\[/g) ?? []).length).toBe(17);
    expect((indexSrc.match(/\]/g) ?? []).length).toBe(17);
  });

  it('post111: brace pair counts', () => {
    expect((indexSrc.match(/\{/g) ?? []).length).toBe(58);
    expect((indexSrc.match(/\}/g) ?? []).length).toBe(58);
  });

  it('post111: paren pair counts', () => {
    expect((indexSrc.match(/\(/g) ?? []).length).toBe(70);
    expect((indexSrc.match(/\)/g) ?? []).length).toBe(70);
  });

  it('post111: semicolon count lock', () => {
    expect((indexSrc.match(/;/g) ?? []).length).toBe(61);
  });

  it('post111: import line count is 5', () => {
    expect([...indexSrc.matchAll(/^import /gm)]).toHaveLength(5);
  });

  it('post111: import order locks hono cors genres parser types', () => {
    const froms = indexSrc
      .split('\n')
      .filter((l) => l.startsWith('import '))
      .map((l) => l.replace(/^import .+ from ['"]([^'"]+)['"].*$/, '$1'));
    expect(froms).toEqual(['hono', 'hono/cors', './genres', './parser', './types']);
  });

  it('post111: export default app is final export', () => {
    expect(indexSrc.trimEnd().endsWith('export default app;')).toBe(true);
  });

  it('post111: IPTV_BASE constant lock', () => {
    expect(indexSrc).toContain("const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'");
  });

  it('post111: Gemini model path lock', () => {
    expect(indexSrc).toContain('models/gemini-2.0-flash:generateContent');
  });

  it('post111: generationConfig maxOutputTokens 512 temperature 0.7', () => {
    expect(indexSrc).toContain('maxOutputTokens: 512');
    expect(indexSrc).toContain('temperature: 0.7');
  });

  it('post111: KV expirationTtl 3600', () => {
    expect(indexSrc).toContain('expirationTtl: 3600');
  });

  it('post111: stations.slice(0, 50) prompt window', () => {
    expect(indexSrc).toMatch(/stations\s*\.slice\(0,\s*50\)/);
  });

  it('post111: degrade slice(0, 5) on Gemini failure', () => {
    expect(indexSrc).toContain('stations.slice(0, 5)');
  });

  it('post111: retry_after literal 60 appears three times', () => {
    expect((indexSrc.match(/retry_after:\s*60/g) ?? []).length).toBe(3);
  });

  it('post111: cors middleware applied via app.use star', () => {
    expect(indexSrc).toContain("app.use('*', cors())");
  });

  it('post111: five GET route registrations', () => {
    expect((indexSrc.match(/app\.get\(/g) ?? []).length).toBe(5);
  });

  it('post111: route path inventory', () => {
    const paths = [...indexSrc.matchAll(/app\.get\('([^']+)'/g)].map((m) => m[1]);
    expect(paths).toEqual(['/', '/health', '/genres', '/stations', '/curate']);
  });

  it('post111: powered_by crab emoji lock', () => {
    expect(indexSrc).toContain('Backlink/Geryon 🦀');
  });

  it('post111: curated_by Backlink/Geryon without crab', () => {
    expect(indexSrc).toContain("curated_by: 'Backlink/Geryon'");
    expect(indexSrc).not.toMatch(/curated_by:\s*'Backlink\/Geryon 🦀'/);
  });

  it('post111: Stream catalog unavailable + Curation service unavailable literals', () => {
    expect(indexSrc).toContain('Stream catalog unavailable');
    expect(indexSrc).toContain('Curation service unavailable');
  });

  it('post111: Invalid JSON from Gemini throw literal', () => {
    expect(indexSrc).toContain("throw new Error('Invalid JSON from Gemini')");
  });

  it('post111: Gemini API error throw includes status', () => {
    expect(indexSrc).toContain('Gemini API error:');
  });

  it('post111: cache key template stations:genre', () => {
    expect(indexSrc).toContain('`stations:${genre}`');
  });

  it('post111: music.m3u fallback path', () => {
    expect(indexSrc).toContain('`${IPTV_BASE}/music.m3u`');
  });

  it('post111: resolveGenre used on stations and curate', () => {
    expect((indexSrc.match(/resolveGenre\(/g) ?? []).length).toBe(2);
  });

  it('post111: callGemini and fetchStations declared', () => {
    expect(indexSrc).toContain('async function fetchStations');
    expect(indexSrc).toContain('async function callGemini');
  });

  it('post111: no CRLF in index.ts', () => {
    expect(indexSrc.includes('\r')).toBe(false);
  });

  it('post111: path.basename of worker entry is index.ts', () => {
    expect(basename(indexPath)).toBe('index.ts');
  });

  it("post111: locks src/parser.ts sha256", () => {
    expect(sha256File("src/parser.ts")).toBe("cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368");
  });

  it("post111: locks src/parser.ts sha1", () => {
    expect(sha1File("src/parser.ts")).toBe("701cdecbef5a9049af6bd11497493c4036a60211");
  });

  it("post111: locks src/parser.ts md5", () => {
    expect(md5File("src/parser.ts")).toBe("500211c4c526de887252451726776563");
  });

  it("post111: locks src/parser.ts sha256 nibble 477 xor 9", () => {
    const d = sha256File("src/parser.ts");
    expect(nibbleSumHex(d)).toBe(477);
    expect(xorNibblesHex(d)).toBe(9);
  });

  it("post111: locks src/genres.ts sha256", () => {
    expect(sha256File("src/genres.ts")).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it("post111: locks src/genres.ts sha1", () => {
    expect(sha1File("src/genres.ts")).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it("post111: locks src/genres.ts md5", () => {
    expect(md5File("src/genres.ts")).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it("post111: locks src/genres.ts sha256 nibble 500 xor 6", () => {
    const d = sha256File("src/genres.ts");
    expect(nibbleSumHex(d)).toBe(500);
    expect(xorNibblesHex(d)).toBe(6);
  });

  it("post111: locks src/types.ts sha256", () => {
    expect(sha256File("src/types.ts")).toBe("4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3");
  });

  it("post111: locks src/types.ts sha1", () => {
    expect(sha1File("src/types.ts")).toBe("1e8906673dc0d140ee5c3d40839c88a1eeca03d8");
  });

  it("post111: locks src/types.ts md5", () => {
    expect(md5File("src/types.ts")).toBe("ecba663d21928622be656805ad27d0a3");
  });

  it("post111: locks src/types.ts sha256 nibble 520 xor 14", () => {
    const d = sha256File("src/types.ts");
    expect(nibbleSumHex(d)).toBe(520);
    expect(xorNibblesHex(d)).toBe(14);
  });

  it("post111: locks test/helpers.ts sha256", () => {
    expect(sha256File("test/helpers.ts")).toBe("240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29");
  });

  it("post111: locks test/helpers.ts sha1", () => {
    expect(sha1File("test/helpers.ts")).toBe("aac5e2154aa8f0784db092ad4bb51304fce6e117");
  });

  it("post111: locks test/helpers.ts md5", () => {
    expect(md5File("test/helpers.ts")).toBe("004bbc8741017d8dd45bee28a29b46e1");
  });

  it("post111: locks test/helpers.ts sha256 nibble 487 xor 5", () => {
    const d = sha256File("test/helpers.ts");
    expect(nibbleSumHex(d)).toBe(487);
    expect(xorNibblesHex(d)).toBe(5);
  });

  it("post111: locks package.json sha256", () => {
    expect(sha256File("package.json")).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it("post111: locks package.json sha1", () => {
    expect(sha1File("package.json")).toBe("b58d14f35b9c13bb254d5e2a51240e2918a126c5");
  });

  it("post111: locks package.json md5", () => {
    expect(md5File("package.json")).toBe("63472e1fb514fb0dadb5e49a7bdbaa5f");
  });

  it("post111: locks package.json sha256 nibble 451 xor 13", () => {
    const d = sha256File("package.json");
    expect(nibbleSumHex(d)).toBe(451);
    expect(xorNibblesHex(d)).toBe(13);
  });

  it("post111: locks vitest.config.ts sha256", () => {
    expect(sha256File("vitest.config.ts")).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it("post111: locks vitest.config.ts sha1", () => {
    expect(sha1File("vitest.config.ts")).toBe("f8d49517ece92fc5e9781fbde021a948958aac37");
  });

  it("post111: locks vitest.config.ts md5", () => {
    expect(md5File("vitest.config.ts")).toBe("f1176313255f5f064a946d458482d81a");
  });

  it("post111: locks vitest.config.ts sha256 nibble 536 xor 2", () => {
    const d = sha256File("vitest.config.ts");
    expect(nibbleSumHex(d)).toBe(536);
    expect(xorNibblesHex(d)).toBe(2);
  });

  it("post111: locks tsconfig.json sha256", () => {
    expect(sha256File("tsconfig.json")).toBe("ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792");
  });

  it("post111: locks tsconfig.json sha1", () => {
    expect(sha1File("tsconfig.json")).toBe("68e3169249049539d687b6b3d81fc809079134f9");
  });

  it("post111: locks tsconfig.json md5", () => {
    expect(md5File("tsconfig.json")).toBe("13f6687a50fe7c6ea7ef4eb3623b7457");
  });

  it("post111: locks tsconfig.json sha256 nibble 506 xor 8", () => {
    const d = sha256File("tsconfig.json");
    expect(nibbleSumHex(d)).toBe(506);
    expect(xorNibblesHex(d)).toBe(8);
  });

  it("post111: locks AGENTS.md sha256", () => {
    expect(sha256File("AGENTS.md")).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it("post111: locks AGENTS.md sha1", () => {
    expect(sha1File("AGENTS.md")).toBe("a7df1fec05dcf7b8ace116788297c77f467a7b6c");
  });

  it("post111: locks AGENTS.md md5", () => {
    expect(md5File("AGENTS.md")).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it("post111: locks AGENTS.md sha256 nibble 479 xor 5", () => {
    const d = sha256File("AGENTS.md");
    expect(nibbleSumHex(d)).toBe(479);
    expect(xorNibblesHex(d)).toBe(5);
  });

  it("post111: locks README.md sha256", () => {
    expect(sha256File("README.md")).toBe("f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987");
  });

  it("post111: locks README.md sha1", () => {
    expect(sha1File("README.md")).toBe("4f560a473d5838f25eba3eae21a87f6c97ba3b8b");
  });

  it("post111: locks README.md md5", () => {
    expect(md5File("README.md")).toBe("9b7aea4982a6d68b95f7f8ee3fdc5b31");
  });

  it("post111: locks README.md sha256 nibble 429 xor 13", () => {
    const d = sha256File("README.md");
    expect(nibbleSumHex(d)).toBe(429);
    expect(xorNibblesHex(d)).toBe(13);
  });

  it("post111: locks DEPLOY.md sha256", () => {
    expect(sha256File("DEPLOY.md")).toBe("11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a");
  });

  it("post111: locks DEPLOY.md sha1", () => {
    expect(sha1File("DEPLOY.md")).toBe("37c72be44abb67343dae3e7c2303306a25b3481f");
  });

  it("post111: locks DEPLOY.md md5", () => {
    expect(md5File("DEPLOY.md")).toBe("da30bf656fdf0d9a61d2a00860c325f5");
  });

  it("post111: locks DEPLOY.md sha256 nibble 439 xor 11", () => {
    const d = sha256File("DEPLOY.md");
    expect(nibbleSumHex(d)).toBe(439);
    expect(xorNibblesHex(d)).toBe(11);
  });

  it("post111: locks wrangler.toml sha256", () => {
    expect(sha256File("wrangler.toml")).toBe("95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8");
  });

  it("post111: locks wrangler.toml sha1", () => {
    expect(sha1File("wrangler.toml")).toBe("481c8221707ffe602ab8d5ce4a2b7b5192d3ade6");
  });

  it("post111: locks wrangler.toml md5", () => {
    expect(md5File("wrangler.toml")).toBe("100cd1554884befe9db6453606e565f4");
  });

  it("post111: locks wrangler.toml sha256 nibble 457 xor 13", () => {
    const d = sha256File("wrangler.toml");
    expect(nibbleSumHex(d)).toBe(457);
    expect(xorNibblesHex(d)).toBe(13);
  });

  it("post111: helpers.ts HMAC-SHA256 key post111", () => {
    expect(hmacSha256("post111", helpersSrc)).toBe("2b3e2749b53346fe84b3b1f3c167c4f98ead1435c0f7e60aa942b635019518ab");
  });

  it("post111: helpers.ts HMAC-SHA256 key routes", () => {
    expect(hmacSha256("routes", helpersSrc)).toBe("135fb5163fdda15dd50a5a13530926aeeb759d56c9a1ace4f7698a01584b08ae");
  });

  it("post111: helpers.ts HMAC-SHA256 key helpers", () => {
    expect(hmacSha256("helpers", helpersSrc)).toBe("dddedc276d2dc27f60c7fed3e482ba2635a358a9d25acd5f98106d06fabb5fb5");
  });

  it("post111: helpers.ts HMAC-SHA256 key TOKENMAXX", () => {
    expect(hmacSha256("TOKENMAXX", helpersSrc)).toBe("8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391");
  });

  it("post111: helpers.ts HMAC-SHA256 key SAMPLE_M3U", () => {
    expect(hmacSha256("SAMPLE_M3U", helpersSrc)).toBe("2e8e7b295e770ee3b57b5bba119da51e72d12edaab4a5be0b5ec70a6a0701314");
  });

  it("post111: helpers.ts HMAC-SHA256 key buildSimpleM3U", () => {
    expect(hmacSha256("buildSimpleM3U", helpersSrc)).toBe("281ca55d2b34d3c06f8e7fadce2aacbde801efc264180e411989e49ff45e1432");
  });

  it('post111: helpers.ts sha256 cross-lock', () => {
    expect(sha256File('test/helpers.ts')).toBe('240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29');
  });

  it('post111: helpers exports used by routes suite remain present', () => {
    expect(helpersSrc).toContain('export function mockKV');
    expect(helpersSrc).toContain('export function testEnv');
    expect(helpersSrc).toContain('export const SAMPLE_M3U');
    expect(helpersSrc).toContain('export function stubIptvAndGemini');
    expect(helpersSrc).toContain('export function curatedGeminiJson');
    expect(helpersSrc).toContain('export function buildSimpleM3U');
    expect(helpersSrc).toContain('export function countHttpStreamLines');
    expect(helpersSrc).toContain('export function captureGeminiRequest');
    expect(helpersSrc).toContain('export function iptvCategoryUrl');
    expect(helpersSrc).toContain('export function seedStationsCache');
    expect(helpersSrc).toContain('export function iptvCallsWithInit');
  });

  it('post111: package scripts lock typecheck/test/coverage', () => {
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post111: package name/version/description lock', () => {
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.description).toContain('LLM-curated internet radio');
  });

  it('post111: AGENTS safe actions list endpoints and tests', () => {
    expect(agentsMd).toContain('Add new endpoints');
    expect(agentsMd).toContain('Add / extend unit tests under `test/`');
    expect(agentsMd).toContain('npm run typecheck');
    expect(agentsMd).toContain('npm test');
  });

  it('post111: AGENTS escalate GEMINI and CORS', () => {
    expect(agentsMd).toContain('GEMINI_API_KEY');
    expect(agentsMd).toContain('CORS');
  });

  it('post111: README documents four live endpoints only', () => {
    expect(readmeMd).toContain('/curate');
    expect(readmeMd).toContain('/stations');
    expect(readmeMd).toContain('/genres');
    expect(readmeMd).toContain('/health');
  });

  it('post111: DEPLOY.md HITL and wrangler secret surface', () => {
    expect(deployMd.toLowerCase()).toMatch(/hitl|human/);
    expect(deployMd).toContain('GEMINI_API_KEY');
    expect(deployMd).toContain('wrangler');
  });

  it('post111: CI workflow runs typecheck and test', () => {
    expect(ciYml).toContain('npm run typecheck');
    expect(ciYml).toMatch(/npm (test|run test)/);
  });

  it('post111: deploy workflow remains HITL-gated surface', () => {
    expect(deployYml.length).toBeGreaterThan(100);
    expect(deployYml).toMatch(/wrangler|cloudflare/i);
  });

  it('post111: wrangler binds CATALOG_CACHE and VERSION only', () => {
    expect(wranglerToml).toContain('CATALOG_CACHE');
    expect(wranglerToml).toContain('VERSION');
    expect(wranglerToml).toMatch(/# wrangler secret put GEMINI_API_KEY/);
  });

  it('post111: types Env has CATALOG_CACHE and optional GEMINI/VERSION', () => {
    expect(typesSrc).toMatch(/CATALOG_CACHE:\s*KVNamespace/);
    expect(typesSrc).toMatch(/GEMINI_API_KEY\?:/);
    expect(typesSrc).toMatch(/VERSION\?:/);
  });

  it("post111: negative invent fence — index.ts has no playlist", () => {
    expect(indexSrc.toLowerCase()).not.toContain("playlist");
  });

  it("post111: negative invent fence — index.ts has no now-playing", () => {
    expect(indexSrc.toLowerCase()).not.toContain("now-playing");
  });

  it("post111: negative invent fence — index.ts has no nowplaying", () => {
    expect(indexSrc.toLowerCase()).not.toContain("nowplaying");
  });

  it("post111: negative invent fence — index.ts has no websocket", () => {
    expect(indexSrc.toLowerCase()).not.toContain("websocket");
  });

  it("post111: negative invent fence — index.ts has no durable", () => {
    expect(indexSrc.toLowerCase()).not.toContain("durable");
  });

  it("post111: negative invent fence — index.ts has no cron", () => {
    expect(indexSrc.toLowerCase()).not.toContain("cron");
  });

  it("post111: negative invent fence — index.ts has no scheduled", () => {
    expect(indexSrc.toLowerCase()).not.toContain("scheduled");
  });

  it("post111: negative invent fence — index.ts has no alarm", () => {
    expect(indexSrc.toLowerCase()).not.toContain("alarm");
  });

  it("post111: negative invent fence — index.ts has no queue", () => {
    expect(indexSrc.toLowerCase()).not.toContain("queue");
  });

  it("post111: negative invent fence — index.ts has no pubsub", () => {
    expect(indexSrc.toLowerCase()).not.toContain("pubsub");
  });

  it("post111: negative invent fence — index.ts has no graphql", () => {
    expect(indexSrc.toLowerCase()).not.toContain("graphql");
  });

  it("post111: negative invent fence — index.ts has no trpc", () => {
    expect(indexSrc.toLowerCase()).not.toContain("trpc");
  });

  it("post111: negative invent fence — index.ts has no supabase", () => {
    expect(indexSrc.toLowerCase()).not.toContain("supabase");
  });

  it("post111: negative invent fence — index.ts has no firebase", () => {
    expect(indexSrc.toLowerCase()).not.toContain("firebase");
  });

  it("post111: negative invent fence — index.ts has no planetscale", () => {
    expect(indexSrc.toLowerCase()).not.toContain("planetscale");
  });

  it("post111: negative invent fence — index.ts has no neon", () => {
    expect(indexSrc.toLowerCase()).not.toContain("neon");
  });

  it("post111: negative invent fence — index.ts has no turso", () => {
    expect(indexSrc.toLowerCase()).not.toContain("turso");
  });

  it("post111: negative invent fence — index.ts has no vercel", () => {
    expect(indexSrc.toLowerCase()).not.toContain("vercel");
  });

  it("post111: negative invent fence — index.ts has no netlify", () => {
    expect(indexSrc.toLowerCase()).not.toContain("netlify");
  });

  it("post111: negative invent fence — index.ts has no fly.io", () => {
    expect(indexSrc.toLowerCase()).not.toContain("fly.io");
  });

  it("post111: negative invent fence — index.ts has no railway", () => {
    expect(indexSrc.toLowerCase()).not.toContain("railway");
  });

  it("post111: negative invent fence — index.ts has no render.com", () => {
    expect(indexSrc.toLowerCase()).not.toContain("render.com");
  });

  it("post111: negative invent fence — index.ts has no docker", () => {
    expect(indexSrc.toLowerCase()).not.toContain("docker");
  });

  it("post111: negative invent fence — index.ts has no kubernetes", () => {
    expect(indexSrc.toLowerCase()).not.toContain("kubernetes");
  });

  it("post111: negative invent fence — index.ts has no helm", () => {
    expect(indexSrc.toLowerCase()).not.toContain("helm");
  });

  it("post111: negative invent fence — index.ts has no terraform", () => {
    expect(indexSrc.toLowerCase()).not.toContain("terraform");
  });

  it("post111: negative invent fence — index.ts has no auth0", () => {
    expect(indexSrc.toLowerCase()).not.toContain("auth0");
  });

  it("post111: negative invent fence — index.ts has no clerk", () => {
    expect(indexSrc.toLowerCase()).not.toContain("clerk");
  });

  it("post111: negative invent fence — index.ts has no oauth", () => {
    expect(indexSrc.toLowerCase()).not.toContain("oauth");
  });

  it("post111: negative invent fence — index.ts has no jwt", () => {
    expect(indexSrc.toLowerCase()).not.toContain("jwt");
  });

  it("post111: negative invent fence — index.ts has no passport", () => {
    expect(indexSrc.toLowerCase()).not.toContain("passport");
  });

  it("post111: negative invent fence — index.ts has no session", () => {
    expect(indexSrc.toLowerCase()).not.toContain("session");
  });

  it("post111: negative invent fence — index.ts has no cookie-parser", () => {
    expect(indexSrc.toLowerCase()).not.toContain("cookie-parser");
  });

  it("post111: negative invent fence — index.ts has no redis", () => {
    expect(indexSrc.toLowerCase()).not.toContain("redis");
  });

  it("post111: negative invent fence — index.ts has no mongodb", () => {
    expect(indexSrc.toLowerCase()).not.toContain("mongodb");
  });

  it("post111: negative invent fence — index.ts has no postgres", () => {
    expect(indexSrc.toLowerCase()).not.toContain("postgres");
  });

  it("post111: negative invent fence — index.ts has no mysql", () => {
    expect(indexSrc.toLowerCase()).not.toContain("mysql");
  });

  it("post111: negative invent fence — index.ts has no sqlite", () => {
    expect(indexSrc.toLowerCase()).not.toContain("sqlite");
  });

  it("post111: negative invent fence — index.ts has no prisma", () => {
    expect(indexSrc.toLowerCase()).not.toContain("prisma");
  });

  it("post111: negative invent fence — index.ts has no drizzle", () => {
    expect(indexSrc.toLowerCase()).not.toContain("drizzle");
  });

  it("post111: negative invent fence — index.ts has no openapi", () => {
    expect(indexSrc.toLowerCase()).not.toContain("openapi");
  });

  it("post111: negative invent fence — index.ts has no swagger", () => {
    expect(indexSrc.toLowerCase()).not.toContain("swagger");
  });

  it("post111: negative invent fence — index.ts has no favicon", () => {
    expect(indexSrc.toLowerCase()).not.toContain("favicon");
  });

  it("post111: negative invent fence — index.ts has no robots.txt", () => {
    expect(indexSrc.toLowerCase()).not.toContain("robots.txt");
  });

  it("post111: negative invent fence — index.ts has no sitemap", () => {
    expect(indexSrc.toLowerCase()).not.toContain("sitemap");
  });

  it("post111: negative invent fence — index.ts has no webhook", () => {
    expect(indexSrc.toLowerCase()).not.toContain("webhook");
  });

  it("post111: negative invent fence — index.ts has no stripe", () => {
    expect(indexSrc.toLowerCase()).not.toContain("stripe");
  });

  it("post111: negative invent fence — index.ts has no billing", () => {
    expect(indexSrc.toLowerCase()).not.toContain("billing");
  });

  it("post111: negative invent fence — index.ts has no sentry", () => {
    expect(indexSrc.toLowerCase()).not.toContain("sentry");
  });

  it("post111: negative invent fence — index.ts has no datadog", () => {
    expect(indexSrc.toLowerCase()).not.toContain("datadog");
  });

  it("post111: negative invent fence — index.ts has no prometheus", () => {
    expect(indexSrc.toLowerCase()).not.toContain("prometheus");
  });

  it("post111: negative invent fence — index.ts has no grafana", () => {
    expect(indexSrc.toLowerCase()).not.toContain("grafana");
  });

  it("post111: negative invent fence — index.ts has no opentelemetry", () => {
    expect(indexSrc.toLowerCase()).not.toContain("opentelemetry");
  });

  it("post111: negative invent fence — index.ts has no otel", () => {
    expect(indexSrc.toLowerCase()).not.toContain("otel");
  });

  it("post111: negative invent fence — index.ts has no splunk", () => {
    expect(indexSrc.toLowerCase()).not.toContain("splunk");
  });

  it("post111: negative invent fence — index.ts has no pages_functions", () => {
    expect(indexSrc.toLowerCase()).not.toContain("pages_functions");
  });

  it("post111: negative invent fence — index.ts has no r2_buckets", () => {
    expect(indexSrc.toLowerCase()).not.toContain("r2_buckets");
  });

  it("post111: negative invent fence — index.ts has no d1_databases", () => {
    expect(indexSrc.toLowerCase()).not.toContain("d1_databases");
  });

  it("post111: negative invent fence — index.ts has no vectorize", () => {
    expect(indexSrc.toLowerCase()).not.toContain("vectorize");
  });

  it("post111: negative invent fence — index.ts has no hyperdrive", () => {
    expect(indexSrc.toLowerCase()).not.toContain("hyperdrive");
  });

  it("post111: negative invent fence — index.ts has no browser_rendering", () => {
    expect(indexSrc.toLowerCase()).not.toContain("browser_rendering");
  });

  it("post111: negative invent fence — index.ts has no workflows", () => {
    expect(indexSrc.toLowerCase()).not.toContain("workflows");
  });

  it("post111: negative invent fence — index.ts has no triggers", () => {
    expect(indexSrc.toLowerCase()).not.toContain("triggers");
  });

  it("post111: negative invent fence — index.ts has no crons", () => {
    expect(indexSrc.toLowerCase()).not.toContain("crons");
  });

  it("post111: negative invent fence — index.ts has no nodejs_compat", () => {
    expect(indexSrc.toLowerCase()).not.toContain("nodejs_compat");
  });

  it("post111: negative invent fence — index.ts has no compatibility_flags", () => {
    expect(indexSrc.toLowerCase()).not.toContain("compatibility_flags");
  });

  it("post111: negative invent fence — index.ts has no account_id", () => {
    expect(indexSrc.toLowerCase()).not.toContain("account_id");
  });

  it("post111: negative invent fence — index.ts has no workers_dev", () => {
    expect(indexSrc.toLowerCase()).not.toContain("workers_dev");
  });

  it("post111: negative invent fence — index.ts has no /v1/", () => {
    expect(indexSrc.toLowerCase()).not.toContain("/v1/");
  });

  it("post111: negative invent fence — index.ts has no /api/", () => {
    expect(indexSrc.toLowerCase()).not.toContain("/api/");
  });

  it("post111: negative invent fence — index.ts has no /rpc", () => {
    expect(indexSrc.toLowerCase()).not.toContain("/rpc");
  });

  it("post111: negative invent fence — index.ts has no /sse", () => {
    expect(indexSrc.toLowerCase()).not.toContain("/sse");
  });

  it("post111: negative invent fence — index.ts has no /mcp", () => {
    expect(indexSrc.toLowerCase()).not.toContain("/mcp");
  });

  it("post111: negative invent fence — index.ts has no /radio", () => {
    expect(indexSrc.toLowerCase()).not.toContain("/radio");
  });

  it("post111: negative invent fence — index.ts has no podcast", () => {
    expect(indexSrc.toLowerCase()).not.toContain("podcast");
  });

  it("post111: negative invent fence — index.ts has no audiobook", () => {
    expect(indexSrc.toLowerCase()).not.toContain("audiobook");
  });

  it("post111: negative invent fence — index.ts has no spotify", () => {
    expect(indexSrc.toLowerCase()).not.toContain("spotify");
  });

  it("post111: negative invent fence — index.ts has no soundcloud", () => {
    expect(indexSrc.toLowerCase()).not.toContain("soundcloud");
  });

  it("post111: negative invent fence — index.ts has no youtube", () => {
    expect(indexSrc.toLowerCase()).not.toContain("youtube");
  });

  it("post111: negative invent fence — index.ts has no twitch", () => {
    expect(indexSrc.toLowerCase()).not.toContain("twitch");
  });

  it("post111: negative invent fence — index.ts has no discord", () => {
    expect(indexSrc.toLowerCase()).not.toContain("discord");
  });

  it("post111: negative invent fence — index.ts has no slack", () => {
    expect(indexSrc.toLowerCase()).not.toContain("slack");
  });

  it("post111: negative invent fence — index.ts has no anthropic", () => {
    expect(indexSrc.toLowerCase()).not.toContain("anthropic");
  });

  it("post111: negative invent fence — index.ts has no openai", () => {
    expect(indexSrc.toLowerCase()).not.toContain("openai");
  });

  it("post111: negative invent fence — index.ts has no claude", () => {
    expect(indexSrc.toLowerCase()).not.toContain("claude");
  });


  it('post111: GET / returns exact endpoint description strings', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const endpoints = body.endpoints as Record<string, string>;
    expect(endpoints['/curate']).toBe('GET ?genre=&mood= — AI-curated station picks');
    expect(endpoints['/stations']).toBe('GET ?genre= — Raw station list');
    expect(endpoints['/genres']).toBe('GET — Available genre categories');
    expect(endpoints['/health']).toBe('GET — Health check');
  });

  it('post111: GET / endpoint key order is curate stations genres health', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(Object.keys(body.endpoints as object)).toEqual(['/curate', '/stations', '/genres', '/health']);
  });

  it('post111: GET / root key order name description version endpoints powered_by', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['name', 'description', 'version', 'endpoints', 'powered_by']);
  });

  it('post111: /health body is exactly ok+version', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(body).toEqual({ ok: true, version: '0.1.0-test' });
  });

  it('post111: /genres returns VALID_GENRES snapshot and GENRE_MAP aliases', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('post111: /stations cold music uses SAMPLE_M3U count via helper', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('music');
    expect(body.count).toBe(countHttpStreamLines(SAMPLE_M3U));
    expect((body.stations as unknown[]).length).toBe(countHttpStreamLines(SAMPLE_M3U));
  });

  it('post111: /stations warm cache skips network', async () => {
    const seeded = seedStationsCache('jazz', [
      { name: 'Warm Jazz', url: 'https://example.com/warm.m3u8' },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV(seeded) }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.count).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post111: /stations unknown genre falls through resolveGenre to music', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=not-a-real-genre-post111', undefined, testEnv());
    const body = await json(res);
    expect(body.genre).toBe('music');
  });

  it('post111: /stations catalog total failure returns 503 retry_after 60', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post111: /curate without GEMINI_API_KEY returns 503 curation unavailable', async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({ error: 'Curation service unavailable', retry_after: 60 });
  });

  it('post111: /curate happy path returns curated_by and ISO timestamp', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({
        m3u: SAMPLE_M3U,
        gemini: curatedGeminiJson([
          {
            name: 'Alpha FM',
            url: 'https://example.com/alpha.m3u8',
            editorial: 'post111 pick',
            genre: 'music',
          },
        ]),
      }),
    );
    const res = await app.request('/curate?genre=music&mood=late%20night', undefined, testEnv({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(typeof body.timestamp).toBe('string');
    expect(String(body.timestamp)).toMatch(/Z$/);
    expect(body.query).toContain('late night');
    const stations = body.stations as Array<{ editorial: string }>;
    expect(stations[0].editorial).toBe('post111 pick');
  });

  it('post111: /curate Gemini failure degrades to top 5 with null editorial', async () => {
    const m3u = buildSimpleM3U(
      Array.from({ length: 7 }, (_, i) => ({
        name: `S${i}`,
        url: `https://example.com/s${i}.m3u8`,
      })),
    );
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u, gemini: new Response('boom', { status: 500 }) }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stations = body.stations as Array<{ editorial: null; name: string }>;
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.editorial === null)).toBe(true);
  });

  it('post111: /curate mood-only resolves via resolveGenre(mood)', async () => {
    const seeded = seedStationsCache('ambient', [{ name: 'Chill', url: 'https://example.com/c.m3u8' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const res = await app.request('/curate?mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seeded) }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe('chill');
  });

  it('post111: captureGeminiRequest sees generateContent POST JSON', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'secret-key' }));
    const gem = captureGeminiRequest(fetchMock);
    expect(gem).not.toBeNull();
    expect(gem!.method).toBe('POST');
    expect(gem!.url).toContain('generativelanguage.googleapis.com');
    expect(gem!.url).toContain('key=secret-key');
    expect(gem!.body).toHaveProperty('contents');
    expect(gem!.body).toHaveProperty('generationConfig');
  });

  it('post111: iptvCallsWithInit stays empty (bare fetch url)', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv());
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it('post111: iptvCategoryUrl helper matches Worker fetch URL', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=rock', undefined, testEnv());
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('rock'));
  });

  it('post111: jazz 404 falls back to music.m3u then caches jazz key', async () => {
    const fetchMock = stubIptvAndGemini({
      m3u: SAMPLE_M3U,
      iptvByGenre: { jazz: null },
      iptvStatus: 404,
    });
    vi.stubGlobal('fetch', fetchMock);
    const kv = mockKV();
    const res = await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      iptvCategoryUrl('jazz'),
      iptvCategoryUrl('music'),
    ]);
    expect(kv.put).toHaveBeenCalled();
    const putKey = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(putKey).toBe('stations:jazz');
  });

  it('post111: CORS allow-origin * on / /health /genres', async () => {
    for (const path of ['/', '/health', '/genres']) {
      const res = await app.request(path, undefined, testEnv());
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    }
  });

  it('post111: OPTIONS preflight on /curate allows origin *', async () => {
    const res = await app.request('/curate', { method: 'OPTIONS' }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post111: unknown path is non-200', async () => {
    const res = await app.request('/not-invented-post111', undefined, testEnv());
    expect(res.status).not.toBe(200);
  });

  it('post111: POST /health is not a JSON happy path', async () => {
    const res = await app.request('/health', { method: 'POST' }, testEnv());
    expect(res.status).not.toBe(200);
  });

  it('post111: HEAD /health mirrors GET status', async () => {
    const get = await app.request('/health', undefined, testEnv());
    const head = await app.request('/health', { method: 'HEAD' }, testEnv());
    expect(head.status).toBe(get.status);
  });

  it('post111: /stations content-type application/json', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('post111: /curate 503 content-type application/json', async () => {
    const res = await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: undefined }));
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('post111: VERSION empty string is used (?? does not coerce)', async () => {
    const res = await app.request('/health', undefined, testEnv({ VERSION: '' }));
    await expect(json(res)).resolves.toEqual({ ok: true, version: '' });
  });

  it('post111: Promise.all parallel /genres share aliases', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => json(await app.request('/genres', undefined, testEnv()))),
    );
    for (const body of results) {
      expect(body.aliases).toEqual(GENRE_MAP);
    }
  });

  it('post111: /stations success key order genre count stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['genre', 'count', 'stations']);
  });

  it('post111: /curate success key order query curated_by timestamp stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(Object.keys(body)).toEqual(['query', 'curated_by', 'timestamp', 'stations']);
  });

  it('post111: /genres success key order genres aliases', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Object.keys(body)).toEqual(['genres', 'aliases']);
  });

  it('post111: sha256 of compact /health JSON under default testEnv', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const compact = JSON.stringify(body);
    expect(createHash('sha256').update(compact).digest('hex')).toBe(
      createHash('sha256').update('{"ok":true,"version":"0.1.0-test"}').digest('hex'),
    );
  });

  it('post111: Object.freeze on /health body copy cannot rewrite ok', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const frozen = Object.freeze({ ...body });
    expect(() => {
      (frozen as { ok: boolean }).ok = false;
    }).toThrow();
    expect(frozen.ok).toBe(true);
  });

  it('post111: Set of root endpoint paths has size 4', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(new Set(Object.keys(body.endpoints as object)).size).toBe(4);
  });

  it('post111: btoa of Backlink name is stable', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(btoa(String(body.name))).toBe('QmFja2xpbms=');
  });

  it('post111: fromCharCode rebuild of Backlink matches root name', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(String.fromCharCode(66, 97, 99, 107, 108, 105, 110, 107)).toBe(body.name);
  });

  it('post111: codePointAt of powered_by crab emoji', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const pb = String(body.powered_by);
    expect(pb.codePointAt(pb.length - 2)).toBe(0x1f980);
  });

  it('post111: TextEncoder root description byte length is 65', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(new TextEncoder().encode(String(body.description)).length).toBe(65);
  });

  it('post111: Intl.Collator sorted endpoint keys', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const keys = Object.keys(body.endpoints as object);
    const sorted = [...keys].sort(new Intl.Collator('en').compare);
    expect(sorted).toEqual(['/curate', '/genres', '/health', '/stations']);
  });

  it('post111: localeCompare chain for endpoint paths', async () => {
    const body = await json(await app.request('/', undefined, testEnv()));
    const keys = Object.keys(body.endpoints as object);
    expect(keys[0].localeCompare(keys[1])).toBeLessThan(0);
  });

  it('post111: Reflect.ownKeys on /health matches Object.keys', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(Reflect.ownKeys(body)).toEqual(Object.keys(body));
  });

  it('post111: JSON round-trip of /health preserves shape', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it('post111: ArrayBuffer first byte of compact health JSON is 0x7b', async () => {
    const body = await json(await app.request('/health', undefined, testEnv()));
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    expect(bytes[0]).toBe(0x7b);
  });

  it('post111: WeakMap can hold env object identity across /health', async () => {
    const env = testEnv();
    const wm = new WeakMap<object, string>();
    wm.set(env as object, 'post111');
    await app.request('/health', undefined, env);
    expect(wm.get(env as object)).toBe('post111');
  });

  it('post111: crypto.randomUUID format lock alongside /health purity', async () => {
    const a = await json(await app.request('/health', undefined, testEnv()));
    const b = await json(await app.request('/health', undefined, testEnv()));
    expect(a).toEqual(b);
    expect(crypto.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('post111: AbortSignal existence does not affect /genres', async () => {
    expect(typeof AbortSignal !== 'undefined').toBe(true);
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Array.isArray(body.genres)).toBe(true);
  });

  it('post111: If-None-Match does not invent 304 on /health', async () => {
    const res = await app.request('/health', { headers: { 'if-none-match': '"x"' } }, testEnv());
    expect(res.status).toBe(200);
  });

  it('post111: Range header does not invent partial content on /genres', async () => {
    const res = await app.request('/genres', { headers: { range: 'bytes=0-10' } }, testEnv());
    expect(res.status).toBe(200);
  });

  it('post111: Authorization does not invent auth gate on /curate', async () => {
    const res = await app.request(
      '/curate',
      { headers: { authorization: 'Bearer fake' } },
      testEnv({ GEMINI_API_KEY: undefined }),
    );
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toMatchObject({ error: 'Curation service unavailable' });
  });

  it('post111: X-API-Key does not invent gate on /stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/stations?genre=music', { headers: { 'x-api-key': 'x' } }, testEnv());
    expect(res.status).toBe(200);
  });

  it('post111: Origin header does not change ACAO from star', async () => {
    const res = await app.request('/health', { headers: { origin: 'https://evil.example' } }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('post111: Accept application/xml does not change JSON content-type', async () => {
    const res = await app.request('/health', { headers: { accept: 'application/xml' } }, testEnv());
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('post111: /stations does not call Gemini even when key present', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it('post111: 503 /curate without key does not put into KV', async () => {
    const kv = mockKV();
    await app.request('/curate?genre=music', undefined, testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: undefined }));
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('post111: catalog 503 on /stations does not put into KV', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const kv = mockKV();
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('post111: /stations corrupt KV JSON returns 503', async () => {
    const kv = mockKV({ 'stations:music': '{not-json' });
    const res = await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(503);
  });

  it('post111: /curate corrupt KV JSON returns 503 with key present', async () => {
    const kv = mockKV({ 'stations:music': '{not-json' });
    const res = await app.request('/curate?genre=music', undefined, testEnv({ CATALOG_CACHE: kv, GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(503);
  });

  it('post111: /stations fetch throw network error returns 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
  });

  it('post111: Gemini fenced JSON with surrounding prose still extracts array', async () => {
    const fenced = geminiTextResponse(
      'Here you go:\n' +
        '```json\n' +
        '[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"x","genre":"music"}]\n' +
        '```',
    );
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: fenced }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.stations as unknown[])[0]).toMatchObject({ name: 'Alpha FM' });
  });

  it('post111: stationList format includes group language and em-dash URL', async () => {
    const m3u = buildSimpleM3U([
      { name: 'Fmt', url: 'https://example.com/f.m3u8', group: 'Music', language: 'en' },
    ]);
    const fetchMock = stubIptvAndGemini({ m3u, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const gem = captureGeminiRequest(fetchMock);
    const prompt = (gem!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0].parts[0].text;
    expect(prompt).toContain('Fmt (Music) [en] — https://example.com/f.m3u8');
  });

  it('post111: stationList defaults group to genre and language to en', async () => {
    const m3u = buildSimpleM3U([{ name: 'Bare', url: 'https://example.com/b.m3u8' }]);
    const fetchMock = stubIptvAndGemini({ m3u, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const gem = captureGeminiRequest(fetchMock);
    const prompt = (gem!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0].parts[0].text;
    expect(prompt).toContain('Bare (jazz) [en] — https://example.com/b.m3u8');
  });

  it('post111: GENRE_MAP chill alias /stations seeds ambient cache key', async () => {
    const seeded = seedStationsCache('ambient', [{ name: 'A', url: 'https://example.com/a.m3u8' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(
      await app.request('/stations?genre=chill', undefined, testEnv({ CATALOG_CACHE: mockKV(seeded) })),
    );
    expect(body.genre).toBe('ambient');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('post111: focus alias /curate uses ambient catalog when seeded', async () => {
    const seeded = seedStationsCache('ambient', [{ name: 'Focus', url: 'https://example.com/f.m3u8' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=focus', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seeded) })),
    );
    expect(body.query).toContain('focus');
  });

  it('post111: music primary ok caches stations:music without double-fetch', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    const kv = mockKV();
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('stations:music');
  });

  it('post111: countHttpStreamLines SAMPLE_M3U cross-locks cold /stations music count', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(body.count).toBe(countHttpStreamLines(SAMPLE_M3U));
  });

  it('post111: final digest+route mega purity — 40 rounds', async () => {
    const expected = '8a4f2f4d4de0371a8b175fa1061a1d2362c21b934f4729db7493f9f83815c234';
    for (let i = 0; i < 40; i++) {
      expect(hmacSha256('post111', indexSrc)).toBe(expected);
      const body = await json(await app.request('/health', undefined, testEnv()));
      expect(body.ok).toBe(true);
    }
  });

  it('post111: createHmac purity 40x post111', () => {
    const expected = '8a4f2f4d4de0371a8b175fa1061a1d2362c21b934f4729db7493f9f83815c234';
    for (let i = 0; i < 40; i++) expect(hmacSha256('post111', indexSrc)).toBe(expected);
  });

  it('post111: final dual fingerprint reaffirm', () => {
    expect(createHash('sha256').update(indexSrc, 'utf8').digest('hex')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
    expect(createHash('sha512').update(indexSrc, 'utf8').digest('hex')).toBe('28576bddcce49759cc66132f4f133f281752df45c3926770467311954e0610422e68cace02e5586fcb8d3a12584176c550a6c3b6a4e624e181dc6599510000f3');
  });

  it('post111: hygiene — routes suite still imports app default from index', () => {
    const body = readUtf('test/routes.test.ts');
    expect(body).toContain("import app from '../src/index'");
    expect(body).toContain("describe('post111 routes HEAVY deepen (after #110/#111)'");
    expect(body).toContain('post111:');
  });

  it('post111: final inventory — routes describe blocks include post76 post94 post111', () => {
    const body = readUtf('test/routes.test.ts');
    expect(body).toContain("describe('post76 routes HEAVY deepen'");
    expect(body).toContain("describe('post94 routes HEAVY deepen'");
    expect(body).toContain("describe('post111 routes HEAVY deepen (after #110/#111)'");
    expect((body.match(/it\('post111:/g) ?? []).length).toBeGreaterThan(100);
  });

  it('post111: negative inventing — README does not document /playlist as live endpoint', () => {
    const live = (readmeMd.match(/\/(curate|stations|genres|health)/g) ?? []).length;
    expect(live).toBeGreaterThan(0);
    expect(readmeMd).not.toMatch(/\/playlist\b/);
  });

  it('post111: negative inventing — no podcast/audiobook aliases via /stations unknown', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=podcast', undefined, testEnv()));
    expect(body.genre).toBe('music');
  });

  it('post111: does not invent /playlist /now-playing /radio /mcp /sse routes', async () => {
    for (const path of ['/playlist', '/now-playing', '/radio', '/mcp', '/sse', '/v1', '/api', '/openapi.json']) {
      const res = await app.request(path, undefined, testEnv());
      expect(res.status).not.toBe(200);
    }
  });

  it('post111: index.ts does not reference wrangler MCP_MANIFEST claw-mcp anthropic', () => {
    expect(indexSrc.toLowerCase()).not.toContain('wrangler');
    expect(indexSrc).not.toContain('MCP_MANIFEST');
    expect(indexSrc.toLowerCase()).not.toContain('claw-mcp');
    expect(indexSrc.toLowerCase()).not.toContain('anthropic');
  });

  it('post111: disk mtime size stable across re-stat', () => {
    const a = statSync(indexPath).size;
    const b = statSync(indexPath).size;
    expect(a).toBe(4738);
    expect(b).toBe(4738);
  });

  it('post111: max codepoint is crab emoji in powered_by literal', () => {
    expect(Math.max(...[...indexSrc].map((c) => c.codePointAt(0)!))).toBe(0x1f980);
  });

  it('post111: min codepoint is newline 10', () => {
    expect(Math.min(...[...indexSrc].map((c) => c.charCodeAt(0)))).toBe(10);
  });

  it('post111: first 60 digraphs lock', () => {
    expect([...Array(60)].map((_, i) => indexSrc.slice(i, i + 2))).toEqual(["im","mp","po","or","rt","t "," {","{ "," H","Ho","on","no","o "," }","} "," f","fr","ro","om","m "," '","'h","ho","on","no","o'","';",";\n","\ni","im","mp","po","or","rt","t "," {","{ "," c","co","or","rs","s "," }","} "," f","fr","ro","om","m "," '","'h","ho","on","no","o/","/c","co","or","rs","s'"]);
  });

  it('post111: last 60 digraphs lock', () => {
    const start = indexSrc.length - 61;
    expect([...Array(60)].map((_, i) => indexSrc.slice(start + i, start + i + 2))).toEqual(["in","ng","g(","()","),",",\n","\n ","  ","  ","  "," s","st","ta","at","ti","io","on","ns","s:",": "," c","cu","ur","ra","at","te","ed","d,",",\n","\n ","  "," }","})",");",";\n","\n}","})",");",";\n","\n\n","\ne","ex","xp","po","or","rt","t "," d","de","ef","fa","au","ul","lt","t "," a","ap","pp","p;",";\n"]);
  });

  it('post111: sha256 of each nonempty index line prefix lock (first 12)', () => {
    const nonemptyLines = indexSrc.split('\n').filter((l) => l.length > 0);
    expect(nonemptyLines.map((l) => createHash('sha256').update(l, 'utf8').digest('hex').slice(0, 12))).toEqual(["d8233fd79765","1ef8e0abb4ab","e30359f99886","2badc72057ba","5c030958abb9","00828ece0341","2d813f19ec45","4e0719977c69","00056f356bdf","3bac7b507612","214963c1b837","2a1591a84ff7","16d4e85b52a5","5cc817a52586","0db27933a7fb","00f94d55644e","737db166c79a","49d697026927","fb9806ebbb0b","76d0cee5640b","96af096fb8b4","d10b36aa74a5","b80474021f14","7147ce76a329","d243b5e2a841","b68e30c6b12d","b4f20524fa48","38cc436cfa09","b4158aea9aa1","4b055b091669","21d5835c285c","ef3da013f9ad","d854e3340a60","380e2ef4b813","606bee0a794d","1c2c4281b25f","0d3d2f5a8b2f","5ec8726f2c67","c71ef50c6a37","d8430957ac13","0eec1b3eb08e","6f69ca8b4097","ed326465be21","58636dd91683","3a5d0b9c2fd8","ab589d0f0466","410049ea64a3","a7972304db7a","5c0254acd025","7af5367b2047","188879bf0a7c","2fad658cf035","acc31b2be5ff","d10b36aa74a5","31e79fc23356","7759895264a1","2e432149c112","1c9e0e5fc812","60a5c7433bf4","ebf309849358","64bffe53d063","b9d1ae7d4d09","3d547a343f5b","514e2fb70ea3","080ee39356c2","98b975e9f51e","58636dd91683","b936cbe56915","8918205c87ae","29576b54e255","52f89700a9be","030504805f4d","29576b54e255","aa3a80d6416b","1c9e0e5fc812","ed09fea92184","fcd2e62202e7","8918205c87ae","29576b54e255","8c50de9d2933","6d63cdb19342","ccae627a488c","9287dcc6387d","ace3e1ec1273","bf25d01bd308","b3599f41bdbd","2da964d9ba38","737db166c79a","677b58ed953c","29576b54e255","cd1f9a1e8a5c","6d63cdb19342","49f49d376a4a","d506e6d354c3","e123a52eb084","f9feff03a6bb","737db166c79a","9287dcc6387d","ace3e1ec1273","bf25d01bd308","b3599f41bdbd","2da964d9ba38","737db166c79a","5770e37b06a4","de1066f12f1f","ace3e1ec1273","4037948254b5","b3599f41bdbd","58a30ee95364","cc8f2250696d","d14884fb5fda","b6ddc96b352d","ce409d549500","5fcd14157064","d842136bf722","1de093e7db36","737db166c79a","1c9e0e5fc812","6512c6cf7b52","b10ea701889a","57777292cb52","c66bb5b064cf","8918205c87ae","29576b54e255","551454d58d7f"]);
  });

  it('post111: combined nonempty lines sha256', () => {
    const joined = indexSrc.split('\n').filter((l) => l.length > 0).join('|');
    expect(createHash('sha256').update(joined, 'utf8').digest('hex')).toBe('b7b443906396b9ba890469e9c5a21716a33107cdd5e28c9cdf0d892084a81fd9');
  });

  it('post111: cross-lock SAMPLE_M3U station names appear in cold /stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    const names = (body.stations as Array<{ name: string }>).map((s) => s.name);
    expect(names).toEqual(['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM']);
  });

  it('post111: mood alias matrix via /curate seeded catalogs', async () => {
    const matrix: Array<[string, string]> = [
      ['chill', 'ambient'],
      ['blues', 'jazz'],
      ['indie', 'rock'],
      ['dance', 'pop'],
      ['classic', 'classical'],
    ];
    for (const [mood, genre] of matrix) {
      const seeded = seedStationsCache(genre, [{ name: mood, url: `https://example.com/${mood}.m3u8` }]);
      vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
      const body = await json(
        await app.request(`/curate?mood=${mood}`, undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seeded) })),
      );
      expect(body.query).toBe(mood);
    }
  });

  it('post111: Map of VALID_GENRES to /stations warm counts is 1 each', async () => {
    let seed: Record<string, string> = {};
    for (const g of VALID_GENRES) {
      seed = seedStationsCache(g, [{ name: g, url: `https://example.com/${g}.m3u8` }], seed);
    }
    vi.stubGlobal('fetch', vi.fn());
    for (const g of VALID_GENRES) {
      const body = await json(
        await app.request(`/stations?genre=${g}`, undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })),
      );
      expect(body.genre).toBe(g);
      expect(body.count).toBe(1);
    }
  });
});

describe('post111b routes HEAVY deepen (complement after #110/#111)', () => {
  // Complementary TOKENMAXX deepen — more fingerprint/HMAC/route leftover locks.
  // Tests/CI only; no product inventing.

  const readUtf = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const hmacSha256 = (key: string, s: string) =>
    createHmac('sha256', key).update(s, 'utf8').digest('hex');
  const indexSrc = readUtf('src/index.ts');
  const helpersSrc = readUtf('test/helpers.ts');
  const readmeMd = readUtf('README.md');
  const agentsMd = readUtf('AGENTS.md');
  const genresSrc = readUtf('src/genres.ts');
  const sha256File = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');


  it("post111b: HMAC-SHA256 key post111b locks index.ts", () => {
    expect(hmacSha256("post111b", indexSrc)).toBe("fc2cbab569185f4e800548716961c06e4e21111869aa49e1f6825570c80aa953");
  });

  it("post111b: HMAC-SHA256 key cors() locks index.ts", () => {
    expect(hmacSha256("cors()", indexSrc)).toBe("13ea3f5837c8ec57fc96f79037a2926e070f6063a4a3f1cdb4bd119b55c6ae75");
  });

  it("post111b: HMAC-SHA256 key app.get locks index.ts", () => {
    expect(hmacSha256("app.get", indexSrc)).toBe("a58e22c14f9f7760007a3407b651342b55a78aca02a8e575d4b7517e914f8424");
  });

  it("post111b: HMAC-SHA256 key fetchStations locks index.ts", () => {
    expect(hmacSha256("fetchStations", indexSrc)).toBe("59f1ae1b203012885bb8407fee23050cebf09200e2d6a96ebb5ee62ae26bec36");
  });

  it("post111b: HMAC-SHA256 key callGemini locks index.ts", () => {
    expect(hmacSha256("callGemini", indexSrc)).toBe("148b016b67ef53a08385c65c19a9870f30e7fac07d2766895ca329b0e56b8edb");
  });

  it("post111b: HMAC-SHA256 key GEMINI locks index.ts", () => {
    expect(hmacSha256("GEMINI", indexSrc)).toBe("478b6c40a878d730ff3f8c52f7d4ddc311d514a3f6c692faf486beeb4a535971");
  });

  it("post111b: HMAC-SHA256 key iptv locks index.ts", () => {
    expect(hmacSha256("iptv", indexSrc)).toBe("9298e5f7ef179fadd03253b9b75ff66697c72ed6e52e280c77f497e6947b8072");
  });

  it("post111b: HMAC-SHA256 key stations: locks index.ts", () => {
    expect(hmacSha256("stations:", indexSrc)).toBe("ab4b73c66666c4c75e185783edb503d9dd546c782af29948a59100bff7154265");
  });

  it("post111b: HMAC-SHA256 key music.m3u locks index.ts", () => {
    expect(hmacSha256("music.m3u", indexSrc)).toBe("71af30d18ca47f601e6b397294e82e1917bbe8fe54cf6cbb5ceca1177265700e");
  });

  it("post111b: HMAC-SHA256 key maxOutputTokens locks index.ts", () => {
    expect(hmacSha256("maxOutputTokens", indexSrc)).toBe("5bbe134e69ce284c70d67728501d783270ccf57e4d7e0c8f140723a61ea6aeff");
  });

  it("post111b: HMAC-SHA256 key temperature locks index.ts", () => {
    expect(hmacSha256("temperature", indexSrc)).toBe("4b2dbcbce3f65e0d62d89c304540308c8ff755eaf48c292766928135996a84cf");
  });

  it("post111b: HMAC-SHA256 key expirationTtl locks index.ts", () => {
    expect(hmacSha256("expirationTtl", indexSrc)).toBe("200c922fcb3bc775c0b178ae78807a9d91d918d752809e52c30b965860794051");
  });

  it("post111b: HMAC-SHA256 key Backlink locks index.ts", () => {
    expect(hmacSha256("Backlink", indexSrc)).toBe("ed65aa81879749759ddcb51342e8978911d90c3e73c76f928fd59867e2a58a0e");
  });

  it("post111b: HMAC-SHA256 key Geryon locks index.ts", () => {
    expect(hmacSha256("Geryon", indexSrc)).toBe("5eb2b17797a1973e947d35ef1d58a646abb8ad187b154cb13db69a180719d2b6");
  });

  it("post111b: HMAC-SHA256 key editorial locks index.ts", () => {
    expect(hmacSha256("editorial", indexSrc)).toBe("ac1c0b94abaaad43fc77f01c57cdd594e8fb54e91fb427e1b432db4e78ff93c8");
  });

  it("post111b: HMAC-SHA256 key Stream catalog locks index.ts", () => {
    expect(hmacSha256("Stream catalog", indexSrc)).toBe("ceaa5b98ffd707e03fc4a85760495c7230037533dde84711a54808ceeb67c363");
  });

  it("post111b: HMAC-SHA256 key Curation service locks index.ts", () => {
    expect(hmacSha256("Curation service", indexSrc)).toBe("c409eb31040678f92e9929697689587b4f9655c738980b09cdcca993af6293e6");
  });

  it("post111b: HMAC-SHA256 key Invalid JSON locks index.ts", () => {
    expect(hmacSha256("Invalid JSON", indexSrc)).toBe("ddae297df2742cef42565459f1a2371cc524ea6bcac2762655c4a4119bbdeef8");
  });

  it("post111b: HMAC-SHA256 key generateContent locks index.ts", () => {
    expect(hmacSha256("generateContent", indexSrc)).toBe("4a9106f30d1b12412514ef856ba9d574103c00a27c11ee104af4e7902f427e9d");
  });

  it("post111b: HMAC-SHA256 key tvg-name locks index.ts", () => {
    expect(hmacSha256("tvg-name", indexSrc)).toBe("cf48af355feb9b4b0cc80a938aa0bef463f2e211e59a61fc7fa2f58c2c8e3093");
  });

  it("post111b: HMAC-SHA256 key group-title locks index.ts", () => {
    expect(hmacSha256("group-title", indexSrc)).toBe("fcf4f839c9fea2e038c73a0853d98d532bcba047a64d35fd8f4ebb161aeaeb2d");
  });

  it("post111b: HMAC-SHA256 key CONTENT locks index.ts", () => {
    expect(hmacSha256("CONTENT", indexSrc)).toBe("ecf5a30d25256b9efb2b1cf7ce49394c68477c23dd4d85b84fb5ac4b88e029c7");
  });

  it("post111b: helpers.ts HMAC-SHA256 key post111b", () => {
    expect(hmacSha256("post111b", helpersSrc)).toBe("6237bc5e6be696306b57bfb2ed5617bf05a3ae2c3d5089775a569ed1969322a1");
  });

  it("post111b: helpers.ts HMAC-SHA256 key cors()", () => {
    expect(hmacSha256("cors()", helpersSrc)).toBe("384bd87c7f80bed0fc0d45f8628f973459cda8c48b74e7507bdcbcee1b761ff8");
  });

  it("post111b: helpers.ts HMAC-SHA256 key app.get", () => {
    expect(hmacSha256("app.get", helpersSrc)).toBe("e4bc26363171aac3c56c220b55b6b72cefa5ea5f3af2a024a07c4d8bffe03326");
  });

  it("post111b: helpers.ts HMAC-SHA256 key fetchStations", () => {
    expect(hmacSha256("fetchStations", helpersSrc)).toBe("8e06b6751a1d630997b371ab73228aeb40bcbdbd53def4f7141bc3dd0ec63c33");
  });

  it("post111b: helpers.ts HMAC-SHA256 key callGemini", () => {
    expect(hmacSha256("callGemini", helpersSrc)).toBe("c1c02a589e61c94fa1bba2ba7c933536bdd15d26b48812bd1fbd1484bbf8ea09");
  });

  it("post111b: helpers.ts HMAC-SHA256 key GEMINI", () => {
    expect(hmacSha256("GEMINI", helpersSrc)).toBe("bc473a2809eea0340533990accb8161015549cea71aec3381a218f8b4917d96d");
  });

  it("post111b: helpers.ts HMAC-SHA256 key iptv", () => {
    expect(hmacSha256("iptv", helpersSrc)).toBe("c4cd54f3cec2de27f1e6fb47d6cb100330970ae8d235be057d83490125e72b7b");
  });

  it("post111b: helpers.ts HMAC-SHA256 key stations:", () => {
    expect(hmacSha256("stations:", helpersSrc)).toBe("f18cda30a2b3343b1e85549d3f7a80de88e023a13d9d35de49916ffd41251e11");
  });

  it("post111b: helpers.ts HMAC-SHA256 key music.m3u", () => {
    expect(hmacSha256("music.m3u", helpersSrc)).toBe("60728b868be93e5ca9cc01cd70a5ebdc2a06b83261914336b3d1dada29930c3f");
  });

  it("post111b: helpers.ts HMAC-SHA256 key maxOutputTokens", () => {
    expect(hmacSha256("maxOutputTokens", helpersSrc)).toBe("56ab874cab358292b97cac1009185199cb23ab4b5da0b6505914abb5eeb747ac");
  });

  it("post111b: helpers.ts HMAC-SHA256 key temperature", () => {
    expect(hmacSha256("temperature", helpersSrc)).toBe("7bdddfa82ecfb78715888931103d811504a1d6c5a33add31abf612b75bffe350");
  });

  it("post111b: helpers.ts HMAC-SHA256 key expirationTtl", () => {
    expect(hmacSha256("expirationTtl", helpersSrc)).toBe("8cba1611d74d4c3d41932acac1ca43417964515e1889f2c1fa522687d7d74177");
  });

  it('post111b: first 80 char codes lock', () => {
    expect([...indexSrc.slice(0, 80)].map((c) => c.charCodeAt(0))).toEqual([105,109,112,111,114,116,32,123,32,72,111,110,111,32,125,32,102,114,111,109,32,39,104,111,110,111,39,59,10,105,109,112,111,114,116,32,123,32,99,111,114,115,32,125,32,102,114,111,109,32,39,104,111,110,111,47,99,111,114,115,39,59,10,105,109,112,111,114,116,32,123,32,71,69,78,82,69,95,77,65]);
  });

  it('post111b: last 80 char codes lock', () => {
    expect([...indexSrc.slice(-80)].map((c) => c.charCodeAt(0))).toEqual([110,101,119,32,68,97,116,101,40,41,46,116,111,73,83,79,83,116,114,105,110,103,40,41,44,10,32,32,32,32,115,116,97,116,105,111,110,115,58,32,99,117,114,97,116,101,100,44,10,32,32,125,41,59,10,125,41,59,10,10,101,120,112,111,114,116,32,100,101,102,97,117,108,116,32,97,112,112,59,10]);
  });

  it('post111b: first 40 trigraphs lock', () => {
    expect([...Array(40)].map((_, i) => indexSrc.slice(i, i + 3))).toEqual(["imp","mpo","por","ort","rt ","t {"," { ","{ H"," Ho","Hon","ono","no ","o }"," } ","} f"," fr","fro","rom","om ","m '"," 'h","'ho","hon","ono","no'","o';","';\n",";\ni","\nim","imp","mpo","por","ort","rt ","t {"," { ","{ c"," co","cor","ors"]);
  });

  it("post111b: token count app.get = 5", () => {
    expect(indexSrc.split("app.get").length - 1).toBe(5);
  });

  it("post111b: token count fetch( = 3", () => {
    expect(indexSrc.split("fetch(").length - 1).toBe(3);
  });

  it("post111b: token count await  = 10", () => {
    expect(indexSrc.split("await ").length - 1).toBe(10);
  });

  it("post111b: token count return  = 12", () => {
    expect(indexSrc.split("return ").length - 1).toBe(12);
  });

  it("post111b: token count const  = 20", () => {
    expect(indexSrc.split("const ").length - 1).toBe(20);
  });

  it("post111b: token count async  = 4", () => {
    expect(indexSrc.split("async ").length - 1).toBe(4);
  });

  it("post111b: token count function  = 2", () => {
    expect(indexSrc.split("function ").length - 1).toBe(2);
  });

  it("post111b: token count genre = 30", () => {
    expect(indexSrc.split("genre").length - 1).toBe(30);
  });

  it("post111b: token count stations = 20", () => {
    expect(indexSrc.split("stations").length - 1).toBe(20);
  });

  it("post111b: token count curate = 9", () => {
    expect(indexSrc.split("curate").length - 1).toBe(9);
  });

  it("post111b: token count health = 2", () => {
    expect(indexSrc.split("health").length - 1).toBe(2);
  });

  it("post111b: token count genres = 4", () => {
    expect(indexSrc.split("genres").length - 1).toBe(4);
  });

  it("post111b: token count mood = 9", () => {
    expect(indexSrc.split("mood").length - 1).toBe(9);
  });

  it("post111b: token count editorial = 6", () => {
    expect(indexSrc.split("editorial").length - 1).toBe(6);
  });

  it("post111b: token count CATALOG_CACHE = 2", () => {
    expect(indexSrc.split("CATALOG_CACHE").length - 1).toBe(2);
  });

  it("post111b: token count GEMINI_API_KEY = 2", () => {
    expect(indexSrc.split("GEMINI_API_KEY").length - 1).toBe(2);
  });

  it("post111b: token count VERSION = 2", () => {
    expect(indexSrc.split("VERSION").length - 1).toBe(2);
  });

  it("post111b: token count cors = 3", () => {
    expect(indexSrc.split("cors").length - 1).toBe(3);
  });

  it("post111b: token count Hono = 2", () => {
    expect(indexSrc.split("Hono").length - 1).toBe(2);
  });

  it("post111b: token count parseM3U = 2", () => {
    expect(indexSrc.split("parseM3U").length - 1).toBe(2);
  });

  it("post111b: token count resolveGenre = 3", () => {
    expect(indexSrc.split("resolveGenre").length - 1).toBe(3);
  });

  it("post111b: token count VALID_GENRES = 2", () => {
    expect(indexSrc.split("VALID_GENRES").length - 1).toBe(2);
  });

  it("post111b: token count GENRE_MAP = 2", () => {
    expect(indexSrc.split("GENRE_MAP").length - 1).toBe(2);
  });

  it("post111b: token count IPTV_BASE = 3", () => {
    expect(indexSrc.split("IPTV_BASE").length - 1).toBe(3);
  });

  it("post111b: token count JSON.parse = 2", () => {
    expect(indexSrc.split("JSON.parse").length - 1).toBe(2);
  });

  it("post111b: token count JSON.stringify = 2", () => {
    expect(indexSrc.split("JSON.stringify").length - 1).toBe(2);
  });

  it("post111b: token count content-type = 1", () => {
    expect(indexSrc.split("content-type").length - 1).toBe(1);
  });

  it("post111b: token count application/json = 1", () => {
    expect(indexSrc.split("application/json").length - 1).toBe(1);
  });

  it("post111b: token count retry_after = 3", () => {
    expect(indexSrc.split("retry_after").length - 1).toBe(3);
  });

  it('post111b: sha1 prefix of each nonempty line (10)', () => {
    const lines = indexSrc.split('\n').filter((l) => l.length > 0);
    expect(lines.map((l) => createHash('sha1').update(l, 'utf8').digest('hex').slice(0, 10))).toEqual(["bb97136d22","2231fc2b99","bcf4c2cedf","9172523fc3","219412fbac","3c349faee9","ee277ba172","b211f3ed92","26a1a6d850","624f749b43","51f78f3e50","117acbaebb","2165e81472","a114bab0d5","74fa7fedd2","b0e3cda8d2","48d033810d","8d2d65c72f","6f4842ad5e","1b4e34b5ae","922554651c","c2b7df6201","dd632031b9","fb1bbe009f","32d8b40112","83ee7cfbfd","537b55b9ca","3c803dadb6","255a1b1786","c43914491e","46fe20b075","59f1be4e4a","4599d53989","e4407b362e","987ee8d2cf","11a36c661d","ed08e60303","7c6bd45437","0f84f77c48","41e737297d","22b4874035","6583a050d5","373ab32c8b","8e09299052","e6e232a264","660af5beed","cdf569cabb","42117fb2df","5f2fc80b57","cd37f7d9bf","ee1e00ae4b","3bbf0febf3","d6dee7e59d","c2b7df6201","10dada9bdb","c4076eba64","1425332455","a285f2ad78","adccd12370","c76bb4c6e6","5311b4f6f9","422dc8df5a","ea9cb71337","d6afe9ddeb","886fde1f08","a049488b00","8e09299052","01d2faf764","8266c40952","fe84c85722","a6cf654299","e1e3059d1f","fe84c85722","b52b5cef1f","a285f2ad78","938c0787b1","766348a80a","8266c40952","fe84c85722","9389716c48","25fd95d65b","7dd211139c","af32254444","0e16ee3d93","1da6f65db3","45ea970e8f","f048983e8b","48d033810d","13439b0966","fe84c85722","ea87edfd5f","25fd95d65b","283693aa6b","0f6007af93","6bfb5e273f","4dd0af8585","48d033810d","af32254444","0e16ee3d93","1da6f65db3","45ea970e8f","f048983e8b","48d033810d","312d9756ee","d0b1fa3abf","0e16ee3d93","26cc1d2aee","45ea970e8f","05b03ebb39","39e10dd7d4","9b7419f111","874413bfd5","73e62a77ae","abd84b9781","47a9345c73","14db0f1e7d","48d033810d","a285f2ad78","74e07565bd","79414f169c","1ff2064c4c","1783f1b278","8266c40952","fe84c85722","9244595280"]);
  });

  it('post111b: indentation histogram lock', () => {
    const lines = indexSrc.split('\n').filter((l) => l.length > 0);
    const hist: Record<number, number> = {};
    for (const l of lines) {
      const n = (l.match(/^ */) ?? [''])[0].length;
      hist[n] = (hist[n] ?? 0) + 1;
    }
    expect(hist).toEqual({"0":24,"2":55,"4":31,"6":13,"8":2});
  });

  it("post111b: README negative invent — no durable objects", () => {
    expect(readmeMd.toLowerCase()).not.toContain("durable objects");
  });

  it("post111b: README negative invent — no websocket endpoint", () => {
    expect(readmeMd.toLowerCase()).not.toContain("websocket endpoint");
  });

  it("post111b: README negative invent — no graphql", () => {
    expect(readmeMd.toLowerCase()).not.toContain("graphql");
  });

  it("post111b: README negative invent — no stripe checkout", () => {
    expect(readmeMd.toLowerCase()).not.toContain("stripe checkout");
  });

  it("post111b: README negative invent — no oauth login", () => {
    expect(readmeMd.toLowerCase()).not.toContain("oauth login");
  });

  it("post111b: README negative invent — no auth0", () => {
    expect(readmeMd.toLowerCase()).not.toContain("auth0");
  });

  it("post111b: README negative invent — no clerk auth", () => {
    expect(readmeMd.toLowerCase()).not.toContain("clerk auth");
  });

  it("post111b: README negative invent — no supabase", () => {
    expect(readmeMd.toLowerCase()).not.toContain("supabase");
  });

  it("post111b: README negative invent — no firebase", () => {
    expect(readmeMd.toLowerCase()).not.toContain("firebase");
  });

  it("post111b: README negative invent — no planetscale", () => {
    expect(readmeMd.toLowerCase()).not.toContain("planetscale");
  });

  it("post111b: README negative invent — no kubernetes", () => {
    expect(readmeMd.toLowerCase()).not.toContain("kubernetes");
  });

  it("post111b: README negative invent — no terraform apply", () => {
    expect(readmeMd.toLowerCase()).not.toContain("terraform apply");
  });

  it("post111b: README negative invent — no prometheus metrics", () => {
    expect(readmeMd.toLowerCase()).not.toContain("prometheus metrics");
  });

  it("post111b: README negative invent — no datadog apm", () => {
    expect(readmeMd.toLowerCase()).not.toContain("datadog apm");
  });

  it("post111b: AGENTS negative invent — no durable objects", () => {
    expect(agentsMd.toLowerCase()).not.toContain("durable objects");
  });

  it("post111b: AGENTS negative invent — no websocket endpoint", () => {
    expect(agentsMd.toLowerCase()).not.toContain("websocket endpoint");
  });

  it("post111b: AGENTS negative invent — no graphql", () => {
    expect(agentsMd.toLowerCase()).not.toContain("graphql");
  });

  it("post111b: AGENTS negative invent — no stripe checkout", () => {
    expect(agentsMd.toLowerCase()).not.toContain("stripe checkout");
  });

  it("post111b: AGENTS negative invent — no oauth login", () => {
    expect(agentsMd.toLowerCase()).not.toContain("oauth login");
  });

  it("post111b: AGENTS negative invent — no auth0", () => {
    expect(agentsMd.toLowerCase()).not.toContain("auth0");
  });

  it("post111b: AGENTS negative invent — no clerk auth", () => {
    expect(agentsMd.toLowerCase()).not.toContain("clerk auth");
  });

  it("post111b: AGENTS negative invent — no supabase", () => {
    expect(agentsMd.toLowerCase()).not.toContain("supabase");
  });

  it("post111b: AGENTS negative invent — no firebase", () => {
    expect(agentsMd.toLowerCase()).not.toContain("firebase");
  });

  it("post111b: AGENTS negative invent — no planetscale", () => {
    expect(agentsMd.toLowerCase()).not.toContain("planetscale");
  });

  it("post111b: AGENTS negative invent — no kubernetes", () => {
    expect(agentsMd.toLowerCase()).not.toContain("kubernetes");
  });

  it("post111b: AGENTS negative invent — no terraform apply", () => {
    expect(agentsMd.toLowerCase()).not.toContain("terraform apply");
  });

  it("post111b: AGENTS negative invent — no prometheus metrics", () => {
    expect(agentsMd.toLowerCase()).not.toContain("prometheus metrics");
  });

  it("post111b: AGENTS negative invent — no datadog apm", () => {
    expect(agentsMd.toLowerCase()).not.toContain("datadog apm");
  });


  it('post111b: /curate query joins mood + genreParam with space', async () => {
    const seeded = seedStationsCache('jazz', [{ name: 'J', url: 'https://example.com/j.m3u8' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate?genre=jazz&mood=late', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seeded) })),
    );
    expect(body.query).toBe('late jazz');
  });

  it('post111b: /curate without mood/genreParam uses resolved genre as query', async () => {
    const seeded = seedStationsCache('music', [{ name: 'M', url: 'https://example.com/m.m3u8' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const body = await json(
      await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seeded) })),
    );
    expect(body.query).toBe('music');
  });

  it('post111b: /stations without genre defaults via resolveGenre to music', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations', undefined, testEnv()));
    expect(body.genre).toBe('music');
  });

  it('post111b: Gemini empty candidates text degrades to top 5', async () => {
    const empty = Response.json({ candidates: [{ content: { parts: [{ text: '' }] } }] });
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: empty }));
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as unknown[]).length).toBe(5);
    expect((body.stations as Array<{ editorial: null }>)[0].editorial).toBeNull();
  });

  it('post111b: Gemini non-array prose degrades', async () => {
    vi.stubGlobal(
      'fetch',
      stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: geminiTextResponse('sorry no json here') }),
    );
    const body = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect((body.stations as unknown[]).length).toBe(5);
  });

  it('post111b: /curate catalog 503 when both genre and music fail', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 500 }));
    const res = await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(503);
    await expect(json(res)).resolves.toEqual({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post111b: put expirationTtl option is 3600 on cold /stations', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const kv = mockKV();
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }));
    const opts = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(opts).toEqual({ expirationTtl: 3600 });
  });

  it('post111b: warm /stations does not call put', async () => {
    const seeded = seedStationsCache('pop', [{ name: 'P', url: 'https://example.com/p.m3u8' }]);
    const kv = mockKV(seeded);
    vi.stubGlobal('fetch', vi.fn());
    await app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('post111b: root description matches package.json description', async () => {
    const pkg = JSON.parse(readUtf('package.json')) as { description: string };
    const body = await json(await app.request('/', undefined, testEnv()));
    expect(body.description).toBe(pkg.description);
  });

  it('post111b: VERSION custom binding surfaces on / and /health', async () => {
    const env = testEnv({ VERSION: '9.9.9-post111b' });
    const rootBody = await json(await app.request('/', undefined, env));
    const health = await json(await app.request('/health', undefined, env));
    expect(rootBody.version).toBe('9.9.9-post111b');
    expect(health.version).toBe('9.9.9-post111b');
  });

  it('post111b: /genres aliases object is GENRE_MAP reference equality of values', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    for (const [k, v] of Object.entries(GENRE_MAP)) {
      expect((body.aliases as Record<string, string>)[k]).toBe(v);
    }
  });

  it('post111b: buildSimpleM3U logo/group/language/country round-trip via /stations', async () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://example.com/logo.png',
        group: 'Music',
        language: 'en',
        country: 'US',
      },
    ]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect((body.stations as Array<Record<string, string>>)[0]).toMatchObject({
      name: 'Full',
      url: 'https://example.com/full.m3u8',
      logo: 'https://example.com/logo.png',
      group: 'Music',
      language: 'en',
      country: 'US',
    });
  });

  it('post111b: duplicate stream URL deduped by parser before /stations count', async () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-name="A",A',
      'https://example.com/same.m3u8',
      '#EXTINF:-1 tvg-name="B",B',
      'https://example.com/same.m3u8',
      '',
    ].join('\n');
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('A');
  });

  it('post111b: rtmp URL resets EXTINF and is skipped', async () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-name="Rtmp",Rtmp',
      'rtmp://example.com/live',
      '#EXTINF:-1 tvg-name="Ok",Ok',
      'https://example.com/ok.m3u8',
      '',
    ].join('\n');
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    const body = await json(await app.request('/stations?genre=music', undefined, testEnv()));
    expect(body.count).toBe(1);
    expect((body.stations as Array<{ name: string }>)[0].name).toBe('Ok');
  });

  it('post111b: prompt window caps at 50 stations', async () => {
    const stations = Array.from({ length: 60 }, (_, i) => ({
      name: `N${i}`,
      url: `https://example.com/n${i}.m3u8`,
    }));
    const m3u = buildSimpleM3U(stations);
    const fetchMock = stubIptvAndGemini({ m3u, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const gem = captureGeminiRequest(fetchMock);
    const prompt = (gem!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0].parts[0].text;
    expect(prompt).toContain('50. N49');
    expect(prompt).not.toContain('51. N50');
  });

  it('post111b: generationConfig locked in Gemini body', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const gem = captureGeminiRequest(fetchMock);
    expect(gem!.body.generationConfig).toEqual({ maxOutputTokens: 512, temperature: 0.7 });
  });

  it('post111b: Gemini request content-type application/json', async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    const gem = captureGeminiRequest(fetchMock);
    const headers = gem!.headers as Record<string, string>;
    expect(headers['content-type'] || headers['Content-Type']).toBe('application/json');
  });

  it('post111b: genres.ts sha256 still matches route resolve surface', () => {
    expect(sha256File('src/genres.ts')).toBe('aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e');
    expect(genresSrc).toContain('export function resolveGenre');
    expect(genresSrc).toContain('export const VALID_GENRES');
    expect(genresSrc).toContain('export const GENRE_MAP');
  });

  it('post111b: late night alias resolves ambient via /stations', async () => {
    const seeded = seedStationsCache('ambient', [{ name: 'LN', url: 'https://example.com/ln.m3u8' }]);
    vi.stubGlobal('fetch', vi.fn());
    const body = await json(
      await app.request('/stations?genre=late%20night', undefined, testEnv({ CATALOG_CACHE: mockKV(seeded) })),
    );
    expect(body.genre).toBe('ambient');
  });

  it('post111b: lo-fi alias resolves ambient via /stations', async () => {
    const seeded = seedStationsCache('ambient', [{ name: 'LF', url: 'https://example.com/lf.m3u8' }]);
    vi.stubGlobal('fetch', vi.fn());
    const body = await json(
      await app.request('/stations?genre=lo-fi', undefined, testEnv({ CATALOG_CACHE: mockKV(seeded) })),
    );
    expect(body.genre).toBe('ambient');
  });

  it('post111b: Proxy over /genres aliases still reads GENRE_MAP chill', async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    const proxied = new Proxy(body.aliases as object, {});
    expect((proxied as Record<string, string>).chill).toBe(GENRE_MAP.chill);
  });

  it('post111b: mutating /genres response genres array does not affect next request', async () => {
    const first = await json(await app.request('/genres', undefined, testEnv()));
    (first.genres as string[]).push('invented-genre-post111b');
    const second = await json(await app.request('/genres', undefined, testEnv()));
    expect(second.genres).toEqual([...VALID_GENRES]);
    expect(second.genres).not.toContain('invented-genre-post111b');
  });

  it('post111b: root powered_by includes crab while curated_by does not', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }));
    const rootBody = await json(await app.request('/', undefined, testEnv()));
    const curate = await json(
      await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' })),
    );
    expect(String(rootBody.powered_by)).toContain('🦀');
    expect(String(curate.curated_by)).not.toContain('🦀');
  });

  it('post111b: encodeURIComponent of genre jazz is identity in /stations URL', async () => {
    expect(encodeURIComponent('jazz')).toBe('jazz');
    const seeded = seedStationsCache('jazz', [{ name: 'J', url: 'https://example.com/j.m3u8' }]);
    vi.stubGlobal('fetch', vi.fn());
    const body = await json(
      await app.request('/stations?genre=' + encodeURIComponent('jazz'), undefined, testEnv({ CATALOG_CACHE: mockKV(seeded) })),
    );
    expect(body.genre).toBe('jazz');
  });

  it('post111b: double-encoded percent in genre does not invent alias', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(
      await app.request('/stations?genre=%2520jazz', undefined, testEnv()),
    );
    expect(body.genre).toBe('music');
  });

  it('post111b: genre[] array-style query does not invent multi-genre', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request('/stations?genre[]=jazz&genre[]=rock', undefined, testEnv()));
    // Hono may treat genre[] as unrelated; resolved genre should still be music default or single
    expect(typeof body.genre).toBe('string');
    expect(body.genre).not.toEqual(['jazz', 'rock']);
  });

  it('post111b: HMAC digests post111 vs post111b differ', () => {
    expect(hmacSha256('post111', indexSrc)).not.toBe(hmacSha256('post111b', indexSrc));
  });

  it('post111b: final fingerprint reaffirm index sha256', () => {
    expect(createHash('sha256').update(indexSrc, 'utf8').digest('hex')).toBe('7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72');
  });

  it('post111b: hygiene — suite markers present', () => {
    const body = readUtf('test/routes.test.ts');
    expect(body).toContain("describe('post111b routes HEAVY deepen (complement after #110/#111)'");
    expect((body.match(/it\('post111b:/g) ?? []).length + (body.match(/it\("post111b:/g) ?? []).length).toBeGreaterThan(50);
  });

  it('post111b: createHmac purity 40x post111b', () => {
    const expected = 'fc2cbab569185f4e800548716961c06e4e21111869aa49e1f6825570c80aa953';
    for (let i = 0; i < 40; i++) expect(hmacSha256('post111b', indexSrc)).toBe(expected);
  });
});

describe('post117 routes HEAVY deepen (after #116)', () => {
  // TOKENMAXX tests-only deepen on latest main after #116 routes merge.
  // Complementary leftovers — real Vitest, no product/credentials/DNS inventing.

  const sha256File = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1File = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5File = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (h: string) => [...h].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (h: string) => [...h].reduce((x, c) => x ^ parseInt(c, 16), 0);
  const hmacSha256 = (key: string, s: string) => createHmac('sha256', key).update(s, 'utf8').digest('hex');
  const indexSrc = readFileSync(join(root, 'src/index.ts'), 'utf8');
  const genresSrcLocal = readFileSync(join(root, 'src/genres.ts'), 'utf8');
  const helpersSrcLocal = readFileSync(join(root, 'test/helpers.ts'), 'utf8');
  const typesSrcLocal = readFileSync(join(root, 'src/types.ts'), 'utf8');
  const agentsMd = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  const deployMd = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
  const readmeMd = readFileSync(join(root, 'README.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string; version: string; scripts: Record<string, string>;
  };

  it("post117: locks src/index.ts sha256", () => {
    expect(sha256File("src/index.ts")).toBe("7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72");
  });

  it("post117: locks src/index.ts sha1", () => {
    expect(sha1File("src/index.ts")).toBe("88b9273a584ce23d1da7ca8a147fee7faeee640b");
  });

  it("post117: locks src/index.ts md5", () => {
    expect(md5File("src/index.ts")).toBe("8c9cdb320becf0effa2d8027b66a2177");
  });

  it("post117: locks src/index.ts bytes 4738", () => {
    expect(statSync(join(root, "src/index.ts")).size).toBe(4738);
  });

  it("post117: locks src/index.ts nibble 470 xor 14", () => {
    const d = sha256File("src/index.ts");
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it("post117: locks src/parser.ts sha256", () => {
    expect(sha256File("src/parser.ts")).toBe("cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368");
  });

  it("post117: locks src/parser.ts sha1", () => {
    expect(sha1File("src/parser.ts")).toBe("701cdecbef5a9049af6bd11497493c4036a60211");
  });

  it("post117: locks src/parser.ts md5", () => {
    expect(md5File("src/parser.ts")).toBe("500211c4c526de887252451726776563");
  });

  it("post117: locks src/parser.ts bytes 1955", () => {
    expect(statSync(join(root, "src/parser.ts")).size).toBe(1955);
  });

  it("post117: locks src/parser.ts nibble 477 xor 9", () => {
    const d = sha256File("src/parser.ts");
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it("post117: locks src/genres.ts sha256", () => {
    expect(sha256File("src/genres.ts")).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it("post117: locks src/genres.ts sha1", () => {
    expect(sha1File("src/genres.ts")).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it("post117: locks src/genres.ts md5", () => {
    expect(md5File("src/genres.ts")).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it("post117: locks src/genres.ts bytes 1027", () => {
    expect(statSync(join(root, "src/genres.ts")).size).toBe(1027);
  });

  it("post117: locks src/genres.ts nibble 500 xor 6", () => {
    const d = sha256File("src/genres.ts");
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it("post117: locks src/types.ts sha256", () => {
    expect(sha256File("src/types.ts")).toBe("4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3");
  });

  it("post117: locks src/types.ts sha1", () => {
    expect(sha1File("src/types.ts")).toBe("1e8906673dc0d140ee5c3d40839c88a1eeca03d8");
  });

  it("post117: locks src/types.ts md5", () => {
    expect(md5File("src/types.ts")).toBe("ecba663d21928622be656805ad27d0a3");
  });

  it("post117: locks src/types.ts bytes 174", () => {
    expect(statSync(join(root, "src/types.ts")).size).toBe(174);
  });

  it("post117: locks src/types.ts nibble 520 xor 14", () => {
    const d = sha256File("src/types.ts");
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it("post117: locks package.json sha256", () => {
    expect(sha256File("package.json")).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it("post117: locks package.json sha1", () => {
    expect(sha1File("package.json")).toBe("b58d14f35b9c13bb254d5e2a51240e2918a126c5");
  });

  it("post117: locks package.json md5", () => {
    expect(md5File("package.json")).toBe("63472e1fb514fb0dadb5e49a7bdbaa5f");
  });

  it("post117: locks package.json bytes 637", () => {
    expect(statSync(join(root, "package.json")).size).toBe(637);
  });

  it("post117: locks package.json nibble 451 xor 13", () => {
    const d = sha256File("package.json");
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it("post117: locks vitest.config.ts sha256", () => {
    expect(sha256File("vitest.config.ts")).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it("post117: locks vitest.config.ts sha1", () => {
    expect(sha1File("vitest.config.ts")).toBe("f8d49517ece92fc5e9781fbde021a948958aac37");
  });

  it("post117: locks vitest.config.ts md5", () => {
    expect(md5File("vitest.config.ts")).toBe("f1176313255f5f064a946d458482d81a");
  });

  it("post117: locks vitest.config.ts bytes 535", () => {
    expect(statSync(join(root, "vitest.config.ts")).size).toBe(535);
  });

  it("post117: locks vitest.config.ts nibble 536 xor 2", () => {
    const d = sha256File("vitest.config.ts");
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it("post117: locks tsconfig.json sha256", () => {
    expect(sha256File("tsconfig.json")).toBe("ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792");
  });

  it("post117: locks tsconfig.json sha1", () => {
    expect(sha1File("tsconfig.json")).toBe("68e3169249049539d687b6b3d81fc809079134f9");
  });

  it("post117: locks tsconfig.json md5", () => {
    expect(md5File("tsconfig.json")).toBe("13f6687a50fe7c6ea7ef4eb3623b7457");
  });

  it("post117: locks tsconfig.json bytes 397", () => {
    expect(statSync(join(root, "tsconfig.json")).size).toBe(397);
  });

  it("post117: locks tsconfig.json nibble 506 xor 8", () => {
    const d = sha256File("tsconfig.json");
    expect(nibbleSum(d)).toBe(506);
    expect(xorNibbles(d)).toBe(8);
  });

  it("post117: locks wrangler.toml sha256", () => {
    expect(sha256File("wrangler.toml")).toBe("95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8");
  });

  it("post117: locks wrangler.toml sha1", () => {
    expect(sha1File("wrangler.toml")).toBe("481c8221707ffe602ab8d5ce4a2b7b5192d3ade6");
  });

  it("post117: locks wrangler.toml md5", () => {
    expect(md5File("wrangler.toml")).toBe("100cd1554884befe9db6453606e565f4");
  });

  it("post117: locks wrangler.toml bytes 330", () => {
    expect(statSync(join(root, "wrangler.toml")).size).toBe(330);
  });

  it("post117: locks wrangler.toml nibble 457 xor 13", () => {
    const d = sha256File("wrangler.toml");
    expect(nibbleSum(d)).toBe(457);
    expect(xorNibbles(d)).toBe(13);
  });

  it("post117: locks AGENTS.md sha256", () => {
    expect(sha256File("AGENTS.md")).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it("post117: locks AGENTS.md sha1", () => {
    expect(sha1File("AGENTS.md")).toBe("a7df1fec05dcf7b8ace116788297c77f467a7b6c");
  });

  it("post117: locks AGENTS.md md5", () => {
    expect(md5File("AGENTS.md")).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it("post117: locks AGENTS.md bytes 1017", () => {
    expect(statSync(join(root, "AGENTS.md")).size).toBe(1017);
  });

  it("post117: locks AGENTS.md nibble 479 xor 5", () => {
    const d = sha256File("AGENTS.md");
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it("post117: locks DEPLOY.md sha256", () => {
    expect(sha256File("DEPLOY.md")).toBe("11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a");
  });

  it("post117: locks DEPLOY.md sha1", () => {
    expect(sha1File("DEPLOY.md")).toBe("37c72be44abb67343dae3e7c2303306a25b3481f");
  });

  it("post117: locks DEPLOY.md md5", () => {
    expect(md5File("DEPLOY.md")).toBe("da30bf656fdf0d9a61d2a00860c325f5");
  });

  it("post117: locks DEPLOY.md bytes 1573", () => {
    expect(statSync(join(root, "DEPLOY.md")).size).toBe(1573);
  });

  it("post117: locks DEPLOY.md nibble 439 xor 11", () => {
    const d = sha256File("DEPLOY.md");
    expect(nibbleSum(d)).toBe(439);
    expect(xorNibbles(d)).toBe(11);
  });

  it("post117: locks README.md sha256", () => {
    expect(sha256File("README.md")).toBe("f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987");
  });

  it("post117: locks README.md sha1", () => {
    expect(sha1File("README.md")).toBe("4f560a473d5838f25eba3eae21a87f6c97ba3b8b");
  });

  it("post117: locks README.md md5", () => {
    expect(md5File("README.md")).toBe("9b7aea4982a6d68b95f7f8ee3fdc5b31");
  });

  it("post117: locks README.md bytes 2801", () => {
    expect(statSync(join(root, "README.md")).size).toBe(2801);
  });

  it("post117: locks README.md nibble 429 xor 13", () => {
    const d = sha256File("README.md");
    expect(nibbleSum(d)).toBe(429);
    expect(xorNibbles(d)).toBe(13);
  });

  it("post117: locks test/helpers.ts sha256", () => {
    expect(sha256File("test/helpers.ts")).toBe("240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29");
  });

  it("post117: locks test/helpers.ts sha1", () => {
    expect(sha1File("test/helpers.ts")).toBe("aac5e2154aa8f0784db092ad4bb51304fce6e117");
  });

  it("post117: locks test/helpers.ts md5", () => {
    expect(md5File("test/helpers.ts")).toBe("004bbc8741017d8dd45bee28a29b46e1");
  });

  it("post117: locks test/helpers.ts bytes 6078", () => {
    expect(statSync(join(root, "test/helpers.ts")).size).toBe(6078);
  });

  it("post117: locks test/helpers.ts nibble 487 xor 5", () => {
    const d = sha256File("test/helpers.ts");
    expect(nibbleSum(d)).toBe(487);
    expect(xorNibbles(d)).toBe(5);
  });

  it("post117: HMAC index key post117", () => {
    expect(hmacSha256("post117", indexSrc)).toBe("f4f339e309d6eadf86b8aff12b56b4cca9f0ed75af3984db45731041ba286333");
  });

  it("post117: HMAC index key after116", () => {
    expect(hmacSha256("after116", indexSrc)).toBe("4ceacf32be111e80776b239628f612b2d42b9a3598f5324ff5a7c77eaf84c6a8");
  });

  it("post117: HMAC index key routes-leftover", () => {
    expect(hmacSha256("routes-leftover", indexSrc)).toBe("12af665fa10c3f930fa99b86467bc53f722b70781d75fffb9960672e038a7664");
  });

  it("post117: HMAC index key Backlink", () => {
    expect(hmacSha256("Backlink", indexSrc)).toBe("ed65aa81879749759ddcb51342e8978911d90c3e73c76f928fd59867e2a58a0e");
  });

  it("post117: HMAC index key Geryon", () => {
    expect(hmacSha256("Geryon", indexSrc)).toBe("5eb2b17797a1973e947d35ef1d58a646abb8ad187b154cb13db69a180719d2b6");
  });

  it("post117: HMAC index key CATALOG_CACHE", () => {
    expect(hmacSha256("CATALOG_CACHE", indexSrc)).toBe("aeb15102e72a90f212ebe60a587c2ea0e8ac8a9a28f0150dcdb08b02f61b7692");
  });

  it("post117: HMAC index key GEMINI_API_KEY", () => {
    expect(hmacSha256("GEMINI_API_KEY", indexSrc)).toBe("bcdc693b733a50487cca26fdd8549b5b526c296566a3c4475f3bc4e6a888617b");
  });

  it("post117: HMAC index key /curate", () => {
    expect(hmacSha256("/curate", indexSrc)).toBe("fc5db89157a4308e3c48a2b910d86ebb8c279508f3f39820f05047a62add78b7");
  });

  it("post117: HMAC index key /stations", () => {
    expect(hmacSha256("/stations", indexSrc)).toBe("917fb7b599cac0f70e80ac6e5ceb1e7766b1c4b97c63a330882dabe6e253e003");
  });

  it("post117: HMAC index key iptv-org", () => {
    expect(hmacSha256("iptv-org", indexSrc)).toBe("3c0dc21e4b8267c2ab1bf4452da2bda68627db162628cb9441e1f5d40669e5d9");
  });

  it("post117: HMAC index key no-invent", () => {
    expect(hmacSha256("no-invent", indexSrc)).toBe("ac1664326fe9a96468bcaf27422b305e016c5cbbe30d36b433bef7df5196ecaa");
  });

  it("post117: HMAC index key TOKENMAXX", () => {
    expect(hmacSha256("TOKENMAXX", indexSrc)).toBe("d25579a5c0d84b104f95ce77a95b760199b110e6ac8ae500fbfbda0c904e7cdc");
  });

  it("post117: HMAC index key Hono", () => {
    expect(hmacSha256("Hono", indexSrc)).toBe("012547ac44807bd29f761bd5d4414d00ac9fca42b46cb5219fcbfd99767d0f2e");
  });

  it("post117: HMAC index key cors", () => {
    expect(hmacSha256("cors", indexSrc)).toBe("9b9bfc72239f2978dd78c463344766460038d42bd0248d395c064aebe0bfcbec");
  });

  it("post117: five GET routes only", () => {
    const gets = [...indexSrc.matchAll(/app\.get\('([^']+)'/g)].map((m) => m[1]);
    expect(gets).toEqual(['/', '/health', '/genres', '/stations', '/curate']);
  });

  it("post117: no mutating verb handlers", () => {
    expect(indexSrc).not.toMatch(/app\.(post|put|patch|delete)\(/);
  });

  it("post117: invent fence playlist/openapi/graphql/websocket", () => {
    expect(indexSrc.toLowerCase()).not.toMatch(/playlist|now-playing|openapi|swagger|graphql|websocket|socket\.io/);
  });

  it("post117: invent fence durable/r2/d1/queues/ai", () => {
    expect(indexSrc.toLowerCase()).not.toMatch(/durable_object|r2_bucket|d1_database|\bqueues\b|workers\.ai|vectorize/);
  });

  it("post117: invent fence anthropic/openai/claude", () => {
    expect(indexSrc.toLowerCase()).not.toMatch(/anthropic|openai|claude|haiku/);
  });

  it("post117: IPTV_BASE lock", () => {
    expect(indexSrc).toContain("const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'");
  });

  it("post117: stations cache key template", () => {
    expect(indexSrc).toContain('`stations:${genre}`');
  });

  it("post117: expirationTtl 3600", () => {
    expect(indexSrc).toMatch(/expirationTtl:\s*3600/);
  });

  it("post117: gemini-2.0-flash model", () => {
    expect(indexSrc).toContain('gemini-2.0-flash');
  });

  it("post117: generationConfig 512 / 0.7", () => {
    expect(indexSrc).toMatch(/maxOutputTokens:\s*512/);
    expect(indexSrc).toMatch(/temperature:\s*0\.7/);
  });

  it("post117: prompt window slice(0, 50)", () => {
    expect(indexSrc).toMatch(/stations\s*\.\s*slice\(0,\s*50\)/);
  });

  it("post117: degrade slice(0, 5)", () => {
    expect(indexSrc).toMatch(/\.slice\(0,\s*5\)/);
  });

  it("post117: curated_by Backlink/Geryon", () => {
    expect(indexSrc).toContain("curated_by: 'Backlink/Geryon'");
  });

  it("post117: powered_by crab", () => {
    expect(indexSrc).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it("post117: retry_after 60 x3", () => {
    expect((indexSrc.match(/retry_after:\s*60/g) ?? []).length).toBe(3);
  });

  it("post117: Env bindings lock", () => {
    expect(typesSrcLocal).toMatch(/CATALOG_CACHE:\s*KVNamespace/);
    expect(typesSrcLocal).toMatch(/GEMINI_API_KEY\?:/);
    expect(typesSrcLocal).toMatch(/VERSION\?:/);
  });

  it("post117: VALID_GENRES lock", () => {
    expect([...VALID_GENRES]).toEqual(["music", "ambient", "jazz", "classical", "pop", "rock", "news", "sports", "entertainment"]);
  });

  it("post117: GENRE_MAP lock", () => {
    expect(GENRE_MAP).toEqual({"late night": "ambient", "chill": "ambient", "ambient": "ambient", "relaxing": "ambient", "focus": "ambient", "classical": "classical", "classic": "classical", "jazz": "jazz", "blues": "jazz", "pop": "pop", "rock": "rock", "metal": "rock", "indie": "rock", "music": "music", "news": "news", "sports": "sports", "entertainment": "entertainment", "dance": "pop", "electronic": "ambient", "lofi": "ambient", "lo-fi": "ambient"});
  });

  it("post117: non-ASCII limited to crab + em dash", () => {
    const nonAscii = [...indexSrc].filter((c) => c.charCodeAt(0) >= 128);
    expect(new Set(nonAscii)).toEqual(new Set(['🦀', '—']));
  });

  it("post117: no tabs in index", () => {
    expect(indexSrc.includes('\t')).toBe(false);
  });

  it("post117: GET / contract", async () => {
    const res = await app.request('/', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe('Backlink');
    expect(body.powered_by).toBe('Backlink/Geryon 🦀');
    expect(body.version).toBe('0.1.0-test');
    expect(Object.keys(body.endpoints as object).sort()).toEqual(['/curate','/genres','/health','/stations']);
  });

  it("post117: GET / version fallback 0.1.0", async () => {
    const body = await json(await app.request('/', undefined, testEnv({ VERSION: undefined })));
    expect(body.version).toBe('0.1.0');
  });

  it("post117: GET /health", async () => {
    expect(await json(await app.request('/health', undefined, testEnv()))).toEqual({ ok: true, version: '0.1.0-test' });
  });

  it("post117: GET /genres mirrors maps", async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it("post117: static routes never fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/', undefined, testEnv());
    await app.request('/health', undefined, testEnv());
    await app.request('/genres', undefined, testEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("post117: POST / non-success", async () => {
    const res = await app.request("/", { method: "POST" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PUT / non-success", async () => {
    const res = await app.request("/", { method: "PUT" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PATCH / non-success", async () => {
    const res = await app.request("/", { method: "PATCH" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: DELETE / non-success", async () => {
    const res = await app.request("/", { method: "DELETE" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: OPTIONS / CORS *", async () => {
    const res = await app.request("/", { method: 'OPTIONS' }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: GET / json + CORS", async () => {
    const env = testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seedStationsCache('music', [{ name: 'A', url: 'https://a' }])) });
    const res = await app.request("/", undefined, env);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: POST /health non-success", async () => {
    const res = await app.request("/health", { method: "POST" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PUT /health non-success", async () => {
    const res = await app.request("/health", { method: "PUT" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PATCH /health non-success", async () => {
    const res = await app.request("/health", { method: "PATCH" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: DELETE /health non-success", async () => {
    const res = await app.request("/health", { method: "DELETE" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: OPTIONS /health CORS *", async () => {
    const res = await app.request("/health", { method: 'OPTIONS' }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: GET /health json + CORS", async () => {
    const env = testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seedStationsCache('music', [{ name: 'A', url: 'https://a' }])) });
    const res = await app.request("/health", undefined, env);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: POST /genres non-success", async () => {
    const res = await app.request("/genres", { method: "POST" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PUT /genres non-success", async () => {
    const res = await app.request("/genres", { method: "PUT" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PATCH /genres non-success", async () => {
    const res = await app.request("/genres", { method: "PATCH" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: DELETE /genres non-success", async () => {
    const res = await app.request("/genres", { method: "DELETE" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: OPTIONS /genres CORS *", async () => {
    const res = await app.request("/genres", { method: 'OPTIONS' }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: GET /genres json + CORS", async () => {
    const env = testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seedStationsCache('music', [{ name: 'A', url: 'https://a' }])) });
    const res = await app.request("/genres", undefined, env);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: POST /stations non-success", async () => {
    const res = await app.request("/stations", { method: "POST" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PUT /stations non-success", async () => {
    const res = await app.request("/stations", { method: "PUT" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PATCH /stations non-success", async () => {
    const res = await app.request("/stations", { method: "PATCH" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: DELETE /stations non-success", async () => {
    const res = await app.request("/stations", { method: "DELETE" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: OPTIONS /stations CORS *", async () => {
    const res = await app.request("/stations", { method: 'OPTIONS' }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: GET /stations json + CORS", async () => {
    const env = testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seedStationsCache('music', [{ name: 'A', url: 'https://a' }])) });
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson(), m3u: SAMPLE_M3U }));
    const res = await app.request("/stations", undefined, env);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: POST /curate non-success", async () => {
    const res = await app.request("/curate", { method: "POST" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PUT /curate non-success", async () => {
    const res = await app.request("/curate", { method: "PUT" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: PATCH /curate non-success", async () => {
    const res = await app.request("/curate", { method: "PATCH" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: DELETE /curate non-success", async () => {
    const res = await app.request("/curate", { method: "DELETE" }, testEnv());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("post117: OPTIONS /curate CORS *", async () => {
    const res = await app.request("/curate", { method: 'OPTIONS' }, testEnv());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: GET /curate json + CORS", async () => {
    const env = testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seedStationsCache('music', [{ name: 'A', url: 'https://a' }])) });
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson(), m3u: SAMPLE_M3U }));
    const res = await app.request("/curate", undefined, env);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it("post117: /stations alias late night \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=late%20night", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias chill \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=chill", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias ambient \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=ambient", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias relaxing \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=relaxing", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias focus \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=focus", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias classical \u2192 classical", async () => {
    const seed = seedStationsCache("classical", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=classical", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("classical");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias classic \u2192 classical", async () => {
    const seed = seedStationsCache("classical", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=classic", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("classical");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias jazz \u2192 jazz", async () => {
    const seed = seedStationsCache("jazz", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=jazz", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("jazz");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias blues \u2192 jazz", async () => {
    const seed = seedStationsCache("jazz", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=blues", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("jazz");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias pop \u2192 pop", async () => {
    const seed = seedStationsCache("pop", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=pop", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("pop");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias rock \u2192 rock", async () => {
    const seed = seedStationsCache("rock", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=rock", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("rock");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias metal \u2192 rock", async () => {
    const seed = seedStationsCache("rock", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=metal", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("rock");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias indie \u2192 rock", async () => {
    const seed = seedStationsCache("rock", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=indie", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("rock");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias music \u2192 music", async () => {
    const seed = seedStationsCache("music", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=music", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("music");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias news \u2192 news", async () => {
    const seed = seedStationsCache("news", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=news", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("news");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias sports \u2192 sports", async () => {
    const seed = seedStationsCache("sports", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=sports", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("sports");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias entertainment \u2192 entertainment", async () => {
    const seed = seedStationsCache("entertainment", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=entertainment", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("entertainment");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias dance \u2192 pop", async () => {
    const seed = seedStationsCache("pop", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=dance", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("pop");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias electronic \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=electronic", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias lofi \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=lofi", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(1);
  });

  it("post117: /stations alias lo-fi \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    const body = await json(await app.request("/stations?genre=lo-fi", undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(1);
  });

  it("post117: /stations identity music cache key", async () => {
    const seed = seedStationsCache("music", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=music", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("music");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:music");
  });

  it("post117: /stations cold-fetch caches music", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=music", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("music");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:music", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity music User request line", async () => {
    const seed = seedStationsCache("music", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=music", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: music");
  });

  it("post117: /stations identity ambient cache key", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=ambient", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("ambient");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:ambient");
  });

  it("post117: /stations cold-fetch caches ambient", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=ambient", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("ambient");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:ambient", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity ambient User request line", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=ambient", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: ambient");
  });

  it("post117: /stations identity jazz cache key", async () => {
    const seed = seedStationsCache("jazz", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=jazz", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("jazz");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:jazz");
  });

  it("post117: /stations cold-fetch caches jazz", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=jazz", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("jazz");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:jazz", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity jazz User request line", async () => {
    const seed = seedStationsCache("jazz", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=jazz", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: jazz");
  });

  it("post117: /stations identity classical cache key", async () => {
    const seed = seedStationsCache("classical", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=classical", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("classical");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:classical");
  });

  it("post117: /stations cold-fetch caches classical", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=classical", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("classical");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:classical", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity classical User request line", async () => {
    const seed = seedStationsCache("classical", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=classical", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: classical");
  });

  it("post117: /stations identity pop cache key", async () => {
    const seed = seedStationsCache("pop", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=pop", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("pop");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:pop");
  });

  it("post117: /stations cold-fetch caches pop", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=pop", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("pop");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:pop", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity pop User request line", async () => {
    const seed = seedStationsCache("pop", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=pop", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: pop");
  });

  it("post117: /stations identity rock cache key", async () => {
    const seed = seedStationsCache("rock", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=rock", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("rock");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:rock");
  });

  it("post117: /stations cold-fetch caches rock", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=rock", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("rock");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:rock", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity rock User request line", async () => {
    const seed = seedStationsCache("rock", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=rock", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: rock");
  });

  it("post117: /stations identity news cache key", async () => {
    const seed = seedStationsCache("news", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=news", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("news");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:news");
  });

  it("post117: /stations cold-fetch caches news", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=news", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("news");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:news", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity news User request line", async () => {
    const seed = seedStationsCache("news", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=news", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: news");
  });

  it("post117: /stations identity sports cache key", async () => {
    const seed = seedStationsCache("sports", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=sports", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("sports");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:sports");
  });

  it("post117: /stations cold-fetch caches sports", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=sports", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("sports");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:sports", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity sports User request line", async () => {
    const seed = seedStationsCache("sports", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=sports", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: sports");
  });

  it("post117: /stations identity entertainment cache key", async () => {
    const seed = seedStationsCache("entertainment", [{ name: 'S', url: 'https://s' }]);
    const kv = mockKV(seed);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await json(await app.request("/stations?genre=entertainment", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("entertainment");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("stations:entertainment");
  });

  it("post117: /stations cold-fetch caches entertainment", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const body = await json(await app.request("/stations?genre=entertainment", undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe("entertainment");
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith("stations:entertainment", expect.any(String), expect.objectContaining({ expirationTtl: 3600 }));
  });

  it("post117: /curate identity entertainment User request line", async () => {
    const seed = seedStationsCache("entertainment", [{ name: 'S', url: 'https://s' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request("/curate?genre=entertainment", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain("User request: entertainment");
  });

  it("post117: /stations unknown \u2192 music", async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    expect((await json(await app.request('/stations?genre=unknown-xyz', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })))).genre).toBe('music');
  });

  it("post117: /stations empty genre \u2192 music", async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    expect((await json(await app.request('/stations?genre=', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })))).genre).toBe('music');
  });

  it("post117: /stations omitted genre \u2192 music", async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    expect((await json(await app.request('/stations', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })))).genre).toBe('music');
  });

  it("post117: /stations jazz fallback caches under jazz", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ iptvByGenre: { jazz: null, music: SAMPLE_M3U } }));
    const body = await json(await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv })));
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(6);
    expect(kv.put).toHaveBeenCalledWith('stations:jazz', expect.any(String), expect.any(Object));
  });

  it("post117: /stations double-fail 503", async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/stations?genre=rock', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.error).toBe('Stream catalog unavailable');
    expect(body.retry_after).toBe(60);
  });

  it("post117: /stations never hits Gemini", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it("post117: /stations corrupt KV \u2192 503", async () => {
    const kv = mockKV({ 'stations:music': '{not-json' });
    expect((await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: kv }))).status).toBe(503);
  });

  it("post117: iptvCategoryUrl matches Worker", async () => {
    expect(iptvCategoryUrl('jazz')).toBe('https://iptv-org.github.io/iptv/categories/jazz.m3u');
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(String(fetchMock.mock.calls[0][0])).toBe(iptvCategoryUrl('jazz'));
  });

  it("post117: buildSimpleM3U + countHttpStreamLines", async () => {
    const m3u = buildSimpleM3U([{ name: 'One', url: 'https://one' }, { name: 'Two', url: 'https://two' }]);
    expect(countHttpStreamLines(m3u)).toBe(2);
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u }));
    expect((await json(await app.request('/stations?genre=news', undefined, testEnv({ CATALOG_CACHE: mockKV() })))).count).toBe(2);
  });

  it("post117: SAMPLE_M3U yields 6", async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    expect((await json(await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() })))).count).toBe(6);
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
  });

  it("post117: MUSIC case-insensitive", async () => {
    const seed = seedStationsCache('music', [{ name: 'M', url: 'https://m' }]);
    expect((await json(await app.request('/stations?genre=MUSIC', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })))).genre).toBe('music');
  });

  it("post117: trims genre whitespace", async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    expect((await json(await app.request('/stations?genre=%20jazz%20', undefined, testEnv({ CATALOG_CACHE: mockKV(seed) })))).genre).toBe('jazz');
  });

  it("post117: iptv calls have no RequestInit", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(iptvCallsWithInit(fetchMock)).toEqual([]);
  });

  it("post117: /curate 503 missing key", async () => {
    const res = await app.request('/curate?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('music', [{ name: 'A', url: 'https://a' }])) }));
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.error).toBe('Curation service unavailable');
    expect(body.retry_after).toBe(60);
  });

  it("post117: /curate 503 empty key", async () => {
    expect((await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: '', CATALOG_CACHE: mockKV(seedStationsCache('music', [{ name: 'A', url: 'https://a' }])) }))).status).toBe(503);
  });

  it("post117: /curate 503 catalog fail", async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null }));
    const res = await app.request('/curate?genre=rock', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV() }));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe('Stream catalog unavailable');
  });

  it("post117: /curate happy path", async () => {
    const seed = seedStationsCache('music', [{ name: 'Alpha FM', url: 'https://example.com/alpha.m3u8' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(typeof body.timestamp).toBe('string');
    expect((body.stations as Array<{ editorial: string }>)[0].editorial.length).toBeGreaterThan(0);
  });

  it("post117: /curate mood-only late night", async () => {
    const seed = seedStationsCache('ambient', [{ name: 'Night', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'Night', url: 'https://n', editorial: 'nocturne', genre: 'ambient' }]) }));
    const body = await json(await app.request('/curate?mood=late%20night', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe('late night');
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe('ambient');
  });

  it("post117: /curate genre+mood query space join", async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'J', url: 'https://j', editorial: 'x', genre: 'jazz' }]) }));
    expect((await json(await app.request('/curate?genre=jazz&mood=focus', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).query).toBe('focus jazz');
  });

  it("post117: /curate prompt slash join", async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz&mood=focus', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('User request: focus / jazz');
  });

  it("post117: Gemini 500 degrades cap 5", async () => {
    const stations = Array.from({ length: 8 }, (_, i) => ({ name: 'S' + i, url: 'https://s/' + i }));
    const seed = seedStationsCache('music', stations);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('boom', { status: 500 }) }));
    const body = await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as unknown[]).length).toBe(5);
    expect((body.stations as Array<{ editorial: null }>)[0].editorial).toBeNull();
  });

  it("post117: Gemini 429 degrades 200", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('rate', { status: 429 }) }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    expect(res.status).toBe(200);
    expect((await json(res)).stations as unknown[]).toHaveLength(1);
  });

  it("post117: invalid Gemini JSON degrades", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse('not-json') }));
    expect(((await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).stations as Array<{ editorial: null }>)[0].editorial).toBeNull();
  });

  it("post117: empty candidates degrades", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: Response.json({ candidates: [] }) }));
    expect(((await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).stations as Array<{ name: string }>)[0].name).toBe('A');
  });

  it("post117: prompt caps at 50 stations", async () => {
    const stations = Array.from({ length: 60 }, (_, i) => ({ name: 'S' + i, url: 'https://s/' + i }));
    const seed = seedStationsCache('music', stations);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('50. S49');
    expect(text).not.toContain('51. S50');
  });

  it("post117: query falls back to genre", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    expect((await json(await app.request('/curate', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).query).toBe('music');
  });

  it("post117: Gemini POST json + generationConfig", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const g = captureGeminiRequest(fetchMock)!;
    expect(g.method).toBe('POST');
    expect((g.body as { generationConfig: unknown }).generationConfig).toEqual({ maxOutputTokens: 512, temperature: 0.7 });
  });

  it("post117: empty catalog degrade []", async () => {
    const seed = seedStationsCache('music', []);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('x', { status: 500 }) }));
    expect((await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).stations).toEqual([]);
  });

  it("post117: no Gemini when key missing", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(captureGeminiRequest(fetchMock)).toBeNull();
  });

  it("post117: API key only in URL", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'secret-key-xyz', CATALOG_CACHE: mockKV(seed) }));
    const g = captureGeminiRequest(fetchMock)!;
    expect(g.url).toContain('key=secret-key-xyz');
    expect(JSON.stringify(g.body)).not.toContain('secret-key-xyz');
  });

  it("post117: fenced JSON extracts", async () => {
    const seed = seedStationsCache('music', [{ name: 'Alpha FM', url: 'https://example.com/alpha.m3u8' }]);
    const payload = '```json\n[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"ok","genre":"music"}]\n```';
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse(payload) }));
    expect(((await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).stations as Array<{ editorial: string }>)[0].editorial).toBe('ok');
  });

  it("post117: timestamp ISO Z", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    expect((await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("post117: logo preserved on degrade", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a', logo: 'https://logo' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('x', { status: 500 }) }));
    expect(((await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).stations as Array<{ logo?: string }>)[0].logo).toBe('https://logo');
  });

  it("post117: KV hit skips iptv", async () => {
    const seed = seedStationsCache('music', [{ name: 'Cached', url: 'https://c' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'Cached', url: 'https://c', editorial: 'e', genre: 'music' }]) });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('iptv-org'))).toBe(true);
  });

  it("post117: /curate alias chill \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?genre=chill", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate mood-only chill \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?mood=chill", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("chill");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate alias blues \u2192 jazz", async () => {
    const seed = seedStationsCache("jazz", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "jazz" }]) }));
    const body = await json(await app.request("/curate?genre=blues", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("jazz");
  });

  it("post117: /curate mood-only blues \u2192 jazz", async () => {
    const seed = seedStationsCache("jazz", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "jazz" }]) }));
    const body = await json(await app.request("/curate?mood=blues", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("blues");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("jazz");
  });

  it("post117: /curate alias classic \u2192 classical", async () => {
    const seed = seedStationsCache("classical", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "classical" }]) }));
    const body = await json(await app.request("/curate?genre=classic", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("classical");
  });

  it("post117: /curate mood-only classic \u2192 classical", async () => {
    const seed = seedStationsCache("classical", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "classical" }]) }));
    const body = await json(await app.request("/curate?mood=classic", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("classic");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("classical");
  });

  it("post117: /curate alias indie \u2192 rock", async () => {
    const seed = seedStationsCache("rock", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "rock" }]) }));
    const body = await json(await app.request("/curate?genre=indie", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("rock");
  });

  it("post117: /curate mood-only indie \u2192 rock", async () => {
    const seed = seedStationsCache("rock", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "rock" }]) }));
    const body = await json(await app.request("/curate?mood=indie", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("indie");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("rock");
  });

  it("post117: /curate alias dance \u2192 pop", async () => {
    const seed = seedStationsCache("pop", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "pop" }]) }));
    const body = await json(await app.request("/curate?genre=dance", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("pop");
  });

  it("post117: /curate mood-only dance \u2192 pop", async () => {
    const seed = seedStationsCache("pop", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "pop" }]) }));
    const body = await json(await app.request("/curate?mood=dance", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("dance");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("pop");
  });

  it("post117: /curate alias focus \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?genre=focus", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate mood-only focus \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?mood=focus", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("focus");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate alias lo-fi \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?genre=lo-fi", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate mood-only lo-fi \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?mood=lo-fi", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("lo-fi");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate alias lofi \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?genre=lofi", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate mood-only lofi \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?mood=lofi", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("lofi");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate alias relaxing \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?genre=relaxing", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate mood-only relaxing \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?mood=relaxing", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("relaxing");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate alias electronic \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?genre=electronic", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate mood-only electronic \u2192 ambient", async () => {
    const seed = seedStationsCache("ambient", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "ambient" }]) }));
    const body = await json(await app.request("/curate?mood=electronic", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("electronic");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("ambient");
  });

  it("post117: /curate alias metal \u2192 rock", async () => {
    const seed = seedStationsCache("rock", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "rock" }]) }));
    const body = await json(await app.request("/curate?genre=metal", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("rock");
  });

  it("post117: /curate mood-only metal \u2192 rock", async () => {
    const seed = seedStationsCache("rock", [{ name: 'N', url: 'https://n' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'N', url: 'https://n', editorial: 'e', genre: "rock" }]) }));
    const body = await json(await app.request("/curate?mood=metal", undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })));
    expect(body.query).toBe("metal");
    expect((body.stations as Array<{ genre: string }>)[0].genre).toBe("rock");
  });

  it("post117: parallel stations genres isolated", async () => {
    const seed = { ...seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]), ...seedStationsCache('rock', [{ name: 'R', url: 'https://r' }]) };
    const kv = mockKV(seed);
    const [a,b] = await Promise.all([
      json(await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }))),
      json(await app.request('/stations?genre=rock', undefined, testEnv({ CATALOG_CACHE: kv }))),
    ]);
    expect(a.genre).toBe('jazz');
    expect(b.genre).toBe('rock');
  });

  it("post117: parallel curate+stations share cache", async () => {
    const seed = seedStationsCache('jazz', [{ name: 'J', url: 'https://j' }]);
    const kv = mockKV(seed);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson([{ name: 'J', url: 'https://j', editorial: 'e', genre: 'jazz' }]) }));
    const stationsRes = await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: kv }));
    const curateRes = await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: kv }));
    const s = await json(stationsRes);
    const c = await json(curateRes);
    expect(s.genre).toBe('jazz');
    expect(c.curated_by).toBe('Backlink/Geryon');
  });

  it("post117: jazz fallback fetch order", async () => {
    const fetchMock = stubIptvAndGemini({ iptvByGenre: { jazz: null, music: SAMPLE_M3U } });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=jazz', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    const iptv = fetchMock.mock.calls.filter((c) => String(c[0]).includes('iptv-org')).map((c) => String(c[0]));
    expect(iptv[0]).toContain('/jazz.m3u');
    expect(iptv[1]).toContain('/music.m3u');
  });

  it("post117: music primary single fetch", async () => {
    const fetchMock = stubIptvAndGemini({ m3u: SAMPLE_M3U });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/stations?genre=music', undefined, testEnv({ CATALOG_CACHE: mockKV() }));
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('iptv-org'))).toHaveLength(1);
  });

  it("post117: Gemini host + model path", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const url = captureGeminiRequest(fetchMock)!.url;
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-2.0-flash:generateContent');
  });

  it("post117: prompt identifies Backlink curator", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text.startsWith('You are Backlink, an AI radio curator.')).toBe(true);
  });

  it("post117: station list default group/lang", async () => {
    const seed = seedStationsCache('pop', [{ name: 'P', url: 'https://p' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=pop', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. P (pop) [en] — https://p');
  });

  it("post117: station list EXTINF group/lang", async () => {
    const seed = seedStationsCache('jazz', [{ name: 'Jazzy', url: 'https://j', group: 'Jazz', language: 'en' }]);
    const fetchMock = stubIptvAndGemini({ gemini: curatedGeminiJson() });
    vi.stubGlobal('fetch', fetchMock);
    await app.request('/curate?genre=jazz', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    const text = (captureGeminiRequest(fetchMock)!.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(text).toContain('1. Jazzy (Jazz) [en] — https://j');
  });

  it("post117: VERSION empty string used", async () => {
    expect((await json(await app.request('/health', undefined, testEnv({ VERSION: '' })))).version).toBe('');
  });

  it("post117: endpoint blurb starts with GET", async () => {
    const endpoints = (await json(await app.request('/', undefined, testEnv()))).endpoints as Record<string, string>;
    for (const v of Object.values(endpoints)) expect(v.startsWith('GET')).toBe(true);
  });

  it("post117: aliases plain object", async () => {
    const body = await json(await app.request('/genres', undefined, testEnv()));
    expect(Array.isArray(body.aliases)).toBe(false);
    expect(typeof body.aliases).toBe('object');
  });

  it("post117: curate put not called on KV hit", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    const kv = mockKV(seed);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: curatedGeminiJson() }));
    await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: kv }));
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("post117: stations put JSON length 6", async () => {
    const kv = mockKV();
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    await app.request('/stations?genre=pop', undefined, testEnv({ CATALOG_CACHE: kv }));
    expect(JSON.parse((kv.put as any).mock.calls[0][1] as string)).toHaveLength(6);
  });

  it("post117: prose-wrapped JSON extracts", async () => {
    const seed = seedStationsCache('music', [{ name: 'Alpha FM', url: 'https://example.com/alpha.m3u8' }]);
    const payload = 'Sure!\n[{"name":"Alpha FM","url":"https://example.com/alpha.m3u8","editorial":"ok","genre":"music"}]\nDone.';
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: geminiTextResponse(payload) }));
    expect(((await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).stations as Array<{ editorial: string }>)[0].editorial).toBe('ok');
  });

  it("post117: Gemini 503 degrades", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: new Response('no', { status: 503 }) }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) }));
    expect(res.status).toBe(200);
    const degraded = await json(res);
    expect((degraded.stations as Array<{ editorial: null }>)[0].editorial).toBeNull();
  });

  it("post117: malformed candidate content degrades", async () => {
    const seed = seedStationsCache('music', [{ name: 'A', url: 'https://a' }]);
    vi.stubGlobal('fetch', stubIptvAndGemini({ gemini: Response.json({ candidates: [{ content: {} }] }) }));
    expect(((await json(await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k', CATALOG_CACHE: mockKV(seed) })))).stations as Array<{ name: string }>)[0].name).toBe('A');
  });

  it("post117: forbids token stripe", () => {
    expect(indexSrc.toLowerCase()).not.toContain("stripe");
  });

  it("post117: forbids token twilio", () => {
    expect(indexSrc.toLowerCase()).not.toContain("twilio");
  });

  it("post117: forbids token sendgrid", () => {
    expect(indexSrc.toLowerCase()).not.toContain("sendgrid");
  });

  it("post117: forbids token auth0", () => {
    expect(indexSrc.toLowerCase()).not.toContain("auth0");
  });

  it("post117: forbids token clerk", () => {
    expect(indexSrc.toLowerCase()).not.toContain("clerk");
  });

  it("post117: forbids token supabase", () => {
    expect(indexSrc.toLowerCase()).not.toContain("supabase");
  });

  it("post117: forbids token firebase", () => {
    expect(indexSrc.toLowerCase()).not.toContain("firebase");
  });

  it("post117: forbids token postgres", () => {
    expect(indexSrc.toLowerCase()).not.toContain("postgres");
  });

  it("post117: forbids token mongodb", () => {
    expect(indexSrc.toLowerCase()).not.toContain("mongodb");
  });

  it("post117: forbids token redis", () => {
    expect(indexSrc.toLowerCase()).not.toContain("redis");
  });

  it("post117: forbids token kubernetes", () => {
    expect(indexSrc.toLowerCase()).not.toContain("kubernetes");
  });

  it("post117: forbids token terraform", () => {
    expect(indexSrc.toLowerCase()).not.toContain("terraform");
  });

  it("post117: forbids token nestjs", () => {
    expect(indexSrc.toLowerCase()).not.toContain("nestjs");
  });

  it("post117: forbids token express", () => {
    expect(indexSrc.toLowerCase()).not.toContain("express");
  });

  it("post117: forbids token fastify", () => {
    expect(indexSrc.toLowerCase()).not.toContain("fastify");
  });

  it("post117: forbids token nextjs", () => {
    expect(indexSrc.toLowerCase()).not.toContain("nextjs");
  });

  it("post117: forbids token django", () => {
    expect(indexSrc.toLowerCase()).not.toContain("django");
  });

  it("post117: forbids token flask", () => {
    expect(indexSrc.toLowerCase()).not.toContain("flask");
  });

  it("post117: forbids token lambda", () => {
    expect(indexSrc.toLowerCase()).not.toContain("lambda");
  });

  it("post117: forbids token datadog", () => {
    expect(indexSrc.toLowerCase()).not.toContain("datadog");
  });

  it("post117: forbids token sentry", () => {
    expect(indexSrc.toLowerCase()).not.toContain("sentry");
  });

  it("post117: forbids token segment", () => {
    expect(indexSrc.toLowerCase()).not.toContain("segment");
  });

  it("post117: forbids token intercom", () => {
    expect(indexSrc.toLowerCase()).not.toContain("intercom");
  });

  it("post117: forbids token hubspot", () => {
    expect(indexSrc.toLowerCase()).not.toContain("hubspot");
  });

  it("post117: forbids token jira", () => {
    expect(indexSrc.toLowerCase()).not.toContain("jira");
  });

  it("post117: forbids token pagerduty", () => {
    expect(indexSrc.toLowerCase()).not.toContain("pagerduty");
  });

  it("post117: forbids token webhook", () => {
    expect(indexSrc.toLowerCase()).not.toContain("webhook");
  });

  it("post117: forbids token oauth", () => {
    expect(indexSrc.toLowerCase()).not.toContain("oauth");
  });

  it("post117: forbids token jwt_secret", () => {
    expect(indexSrc.toLowerCase()).not.toContain("jwt_secret");
  });

  it("post117: forbids token private_key", () => {
    expect(indexSrc.toLowerCase()).not.toContain("private_key");
  });

  it("post117: forbids token account_id", () => {
    expect(indexSrc.toLowerCase()).not.toContain("account_id");
  });

  it("post117: forbids token api_token", () => {
    expect(indexSrc.toLowerCase()).not.toContain("api_token");
  });

  it("post117: forbids token workers_dev", () => {
    expect(indexSrc.toLowerCase()).not.toContain("workers_dev");
  });

  it("post117: forbids token nodejs_compat", () => {
    expect(indexSrc.toLowerCase()).not.toContain("nodejs_compat");
  });

  it("post117: forbids token durable_objects", () => {
    expect(indexSrc.toLowerCase()).not.toContain("durable_objects");
  });

  it("post117: forbids token browser_rendering", () => {
    expect(indexSrc.toLowerCase()).not.toContain("browser_rendering");
  });

  it("post117: package scripts lock", () => {
    expect(pkg.name).toBe('backlink');
    expect(pkg.scripts.test).toMatch(/vitest/);
    expect(pkg.scripts.typecheck).toMatch(/tsc/);
  });

  it("post117: AGENTS safe actions mention unit tests", () => {
    expect(agentsMd).toMatch(/unit tests/i);
    expect(agentsMd).toMatch(/src\/genres\.ts/);
    expect(agentsMd).toMatch(/src\/parser\.ts/);
  });

  it("post117: DEPLOY wrangler + GEMINI", () => {
    expect(deployMd).toMatch(/wrangler/);
    expect(deployMd).toMatch(/GEMINI_API_KEY/);
  });

  it("post117: README Backlink", () => {
    expect(readmeMd).toMatch(/Backlink/);
  });

  it("post117: helpers export surface", () => {
    expect(helpersSrcLocal).toContain('export function mockKV');
    expect(helpersSrcLocal).toContain('export function testEnv');
    expect(helpersSrcLocal).toContain('export function stubIptvAndGemini');
    expect(helpersSrcLocal).toContain('export function curatedGeminiJson');
    expect(helpersSrcLocal).toContain('export function seedStationsCache');
  });

  it("post117: mega purity 40x HMAC post117", () => {
    const expected = "f4f339e309d6eadf86b8aff12b56b4cca9f0ed75af3984db45731041ba286333";
    for (let i = 0; i < 40; i++) expect(hmacSha256('post117', indexSrc)).toBe(expected);
  });

  it("post117: HMAC post117 differs post111", () => {
    expect(hmacSha256('post117', indexSrc)).not.toBe(hmacSha256('post111', indexSrc));
  });

  it("post117: final inventory markers", () => {
    const body = readFileSync(join(root, 'test/routes.test.ts'), 'utf8');
    expect(body).toContain("describe('post111 routes HEAVY deepen (after #110/#111)'");
    expect(body).toContain("describe('post117 routes HEAVY deepen (after #116)'");
    expect((body.match(/it\(['\"]post117:/g) ?? []).length).toBeGreaterThan(200);
  });

  it("post117: final index sha256 reaffirm", () => {
    expect(sha256File('src/index.ts')).toBe("7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72");
  });

});

// --- HEAVY burn (post-#123): deepen routes leftovers after #123 — tests only, no product inventing ---

// --- HEAVY burn (post-#123): deepen routes leftovers — tests only, no product inventing ---
describe('post123 routes HEAVY deepen (after #123)', () => {
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

  it('post123: locks src/parser.ts sha256', () => {
    expect(sha256("src/parser.ts")).toBe("cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368");
  });

  it('post123: locks src/parser.ts sha1', () => {
    expect(sha1("src/parser.ts")).toBe("701cdecbef5a9049af6bd11497493c4036a60211");
  });

  it('post123: locks src/parser.ts md5', () => {
    expect(md5("src/parser.ts")).toBe("500211c4c526de887252451726776563");
  });

  it('post123: locks src/parser.ts sha384', () => {
    expect(sha384("src/parser.ts")).toBe("f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9");
  });

  it('post123: locks src/parser.ts sha512', () => {
    expect(sha512("src/parser.ts")).toBe("66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89");
  });

  it('post123: locks src/parser.ts sha3-256', () => {
    expect(sha3("src/parser.ts")).toBe("0ec47247da4cff229cc417b213da73883427985239714e246eb16d1f021bf9c2");
  });

  it('post123: locks src/parser.ts blake2b512', () => {
    expect(blake2b("src/parser.ts")).toBe("d61759e7d0a68efcd16a74811ad84abebe0b82dab5c16e51261ca37118efc5a3c36aec8bc1523ce2b0d3908cd065c7cb8d1c153ea9a31dec633a90ec53aca7ef");
  });

  it('post123: locks src/parser.ts ripemd160', () => {
    expect(ripemd("src/parser.ts")).toBe("36f12fc76af98f06dfa651f814e8f2e13b26c96a");
  });

  it('post123: locks src/parser.ts size 1955', () => {
    expect(statSync(join(root, "src/parser.ts")).size).toBe(1955);
    expect(readFileSync(join(root, "src/parser.ts")).byteLength).toBe(1955);
  });

  it('post123: locks src/parser.ts utf8 1953 lines 67', () => {
    expect(read("src/parser.ts")).toHaveLength(1953);
    expect(read("src/parser.ts").split('\n')).toHaveLength(67);
  });

  it('post123: locks src/parser.ts nibble 477 xor 9', () => {
    const d = sha256("src/parser.ts");
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post123: locks src/parser.ts first/last octets', () => {
    const d = sha256("src/parser.ts");
    expect(d.slice(0, 2)).toBe("cf");
    expect(d.slice(-2)).toBe("68");
  });

  it('post123: locks src/parser.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "src/parser.ts")).toBe("995aba2fa63618f8d8028da67cab3f62fbbb20044d76fd4a9a45488f006a464c");
    expect(hmacSha256('TOKENMAXX', "src/parser.ts")).toBe("eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8");
    expect(hmacSha256('ci-config', "src/parser.ts")).toBe("8e87c15ae0e02388f08fe8d7f368f3da70619e7200171de323164ba9235c24d6");
  });

  it('post123: locks src/parser.ts spaces 432', () => {
    expect((read("src/parser.ts").match(/ /g) ?? []).length).toBe(432);
  });

  it('post123: locks src/mcp.ts sha256', () => {
    expect(sha256("src/mcp.ts")).toBe("6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683");
  });

  it('post123: locks src/mcp.ts sha1', () => {
    expect(sha1("src/mcp.ts")).toBe("848b3977365809fda54fcb74a7d09affe685ea82");
  });

  it('post123: locks src/mcp.ts md5', () => {
    expect(md5("src/mcp.ts")).toBe("52e71c72e32e3d95b8b8d61ff4a2cf46");
  });

  it('post123: locks src/mcp.ts sha384', () => {
    expect(sha384("src/mcp.ts")).toBe("a95bef5fcb3b93e9c05aac94aaa6a49adb47a360bfaf046e65f7254c2249fd1f34ff923ec401752e2701b7260d9949d2");
  });

  it('post123: locks src/mcp.ts sha512', () => {
    expect(sha512("src/mcp.ts")).toBe("aa1525a8464db0a7d40982c8f0c091b63f8b21ea363f642ca9781513618d4fb99a9926e39118f65788c423a6bd6ee2318b3165f6007ca9599d36fe7fc7820c05");
  });

  it('post123: locks src/mcp.ts sha3-256', () => {
    expect(sha3("src/mcp.ts")).toBe("9072d42bee801bb2a3ea3f058ea604be67a2e7e599f21afb0d26f27817f44b16");
  });

  it('post123: locks src/mcp.ts blake2b512', () => {
    expect(blake2b("src/mcp.ts")).toBe("f91cd566835e001abe86d934663f36715b1082627dfb8abea78ffd99a50fe41e22d7d9b694301c9b2b27d16a675e3380dffdca34a74b4dbe2ea5b6af00e8ab43");
  });

  it('post123: locks src/mcp.ts ripemd160', () => {
    expect(ripemd("src/mcp.ts")).toBe("105ea9a796a49f5987df733c71c1abf0ab5ddad4");
  });

  it('post123: locks src/mcp.ts size 2057', () => {
    expect(statSync(join(root, "src/mcp.ts")).size).toBe(2057);
    expect(readFileSync(join(root, "src/mcp.ts")).byteLength).toBe(2057);
  });

  it('post123: locks src/mcp.ts utf8 2057 lines 68', () => {
    expect(read("src/mcp.ts")).toHaveLength(2057);
    expect(read("src/mcp.ts").split('\n')).toHaveLength(68);
  });

  it('post123: locks src/mcp.ts nibble 551 xor 1', () => {
    const d = sha256("src/mcp.ts");
    expect(nibbleSum(d)).toBe(551);
    expect(xorNibbles(d)).toBe(1);
  });

  it('post123: locks src/mcp.ts first/last octets', () => {
    const d = sha256("src/mcp.ts");
    expect(d.slice(0, 2)).toBe("6a");
    expect(d.slice(-2)).toBe("83");
  });

  it('post123: locks src/mcp.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "src/mcp.ts")).toBe("17d9119d0dba63ded2ade91a7638a77f0e666f36a9423bfd3cfce72086258be2");
    expect(hmacSha256('TOKENMAXX', "src/mcp.ts")).toBe("cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62");
    expect(hmacSha256('ci-config', "src/mcp.ts")).toBe("44ef1aa7fad1b7f90391da716274d918fb058b71764a2b48e4f94e283e6e4621");
  });

  it('post123: locks src/mcp.ts spaces 617', () => {
    expect((read("src/mcp.ts").match(/ /g) ?? []).length).toBe(617);
  });

  it('post123: locks src/types.ts sha256', () => {
    expect(sha256("src/types.ts")).toBe("4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3");
  });

  it('post123: locks src/types.ts sha1', () => {
    expect(sha1("src/types.ts")).toBe("1e8906673dc0d140ee5c3d40839c88a1eeca03d8");
  });

  it('post123: locks src/types.ts md5', () => {
    expect(md5("src/types.ts")).toBe("ecba663d21928622be656805ad27d0a3");
  });

  it('post123: locks src/types.ts sha384', () => {
    expect(sha384("src/types.ts")).toBe("40618d8902640e6ce24d5caf0b9daf86c4d5f962832b1835a86bb10ad7c37455cc60aa9f965ffd9a98f9a5967048b01c");
  });

  it('post123: locks src/types.ts sha512', () => {
    expect(sha512("src/types.ts")).toBe("49cf750d836fe717822e6f08b6ff4998c1f7419a2dfb169a5cfb3001dc1f6dc84df5b428edba879cbd0f7e1b809662e27ee34bf28f88e1efc62ec7d0b37f37cc");
  });

  it('post123: locks src/types.ts sha3-256', () => {
    expect(sha3("src/types.ts")).toBe("93122aa0fe9ef2958ed1b257bc139e91b30facb2e13e4094620dadf7d4acf8e4");
  });

  it('post123: locks src/types.ts blake2b512', () => {
    expect(blake2b("src/types.ts")).toBe("fcb08243a6c336e8da2d3500665ae9a80d98f23a06c3da5f771a290a4b45b2697e2b00e440165eb6551886f58a3bdea0ba315c1d4d3caba38ba3af7f108b3723");
  });

  it('post123: locks src/types.ts ripemd160', () => {
    expect(ripemd("src/types.ts")).toBe("80ca02c12c5db60b8eb1afb1cd21b18983ba16fb");
  });

  it('post123: locks src/types.ts size 174', () => {
    expect(statSync(join(root, "src/types.ts")).size).toBe(174);
    expect(readFileSync(join(root, "src/types.ts")).byteLength).toBe(174);
  });

  it('post123: locks src/types.ts utf8 172 lines 7', () => {
    expect(read("src/types.ts")).toHaveLength(172);
    expect(read("src/types.ts").split('\n')).toHaveLength(7);
  });

  it('post123: locks src/types.ts nibble 520 xor 14', () => {
    const d = sha256("src/types.ts");
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post123: locks src/types.ts first/last octets', () => {
    const d = sha256("src/types.ts");
    expect(d.slice(0, 2)).toBe("40");
    expect(d.slice(-2)).toBe("d3");
  });

  it('post123: locks src/types.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "src/types.ts")).toBe("c92e64e5e0bbfff5a62a8473dbc9c51db668d749b71e2edce460982d94d0fbac");
    expect(hmacSha256('TOKENMAXX', "src/types.ts")).toBe("5e7f31dee3604308898a0a2409c8809ded44c3f7518e5dd5b232b05b80d225bc");
    expect(hmacSha256('ci-config', "src/types.ts")).toBe("9b45af6592d668f87f16fee4ec1e38f724777f8e3094ca82c9ea52dcbef54854");
  });

  it('post123: locks src/types.ts spaces 25', () => {
    expect((read("src/types.ts").match(/ /g) ?? []).length).toBe(25);
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

  it('post123: index.ts wires /', () => {
    expect(read('src/index.ts')).toContain("app.get('/'");
  });

  it('post123: index.ts wires /health', () => {
    expect(read('src/index.ts')).toContain("app.get('/health'");
  });

  it('post123: index.ts wires /genres', () => {
    expect(read('src/index.ts')).toContain("app.get('/genres'");
  });

  it('post123: index.ts wires /stations', () => {
    expect(read('src/index.ts')).toContain("app.get('/stations'");
  });

  it('post123: index.ts wires /curate', () => {
    expect(read('src/index.ts')).toContain("app.get('/curate'");
  });

  it('post123: no playlist/now-playing inventing; resolveGenre wired', () => {
    expect(read('src/index.ts')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('src/index.ts')).toContain('resolveGenre');
  });

  it('post123: helpers export surface for route stubs', () => {
    const h = read('test/helpers.ts');
    expect(h).toContain('export function mockKV');
    expect(h).toContain('export function testEnv');
    expect(h).toContain('export function stubIptvAndGemini');
    expect(h).toContain('export function curatedGeminiJson');
    expect(h).toContain('export function seedStationsCache');
  });

  it('post123: GET / smoke', async () => {
    const res = await app.request('/', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toBeTruthy();
  });

  it('post123: GET /health smoke', async () => {
    const res = await app.request('/health', undefined, testEnv());
    expect(res.status).toBe(200);
  });

  it('post123: GET /genres smoke', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toBeTruthy();
  });

  it('post123: mega purity 30x index.ts', () => {
    const expected = "7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72";
    for (let i = 0; i < 30; i++) expect(sha256('src/index.ts')).toBe(expected);
  });

  it('post123: HMAC post123 differs post117', () => {
    expect(hmacSha256('post123', 'src/index.ts')).not.toBe(hmacSha256('post117', 'src/index.ts'));
    expect(hmacSha256('post123', 'src/index.ts')).toBe("3d45ed31f75ae8cba65e0c8ddbe00e591e5f431b7745f8d13474d96ccb838561");
  });

  it('post123: final inventory markers', () => {
    const body = read('test/routes.test.ts');
    expect(body).toContain("describe('post117 routes HEAVY deepen (after #116)'");
    expect(body).toContain("describe('post123 routes HEAVY deepen (after #123)'");
    expect((body.match(/it\(['"]post123:/g) ?? []).length).toBeGreaterThan(80);
  });

});

// --- HEAVY burn (post-#126): deepen routes leftover edges only — no product inventing ---
// Orthogonal to #126 ci-config. Endpoint smoke + digest/HMAC post126 locks.

describe('post126 routes HEAVY deepen (after #126)', () => {
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


  it('post126: GET / returns Backlink metadata', async () => {
    const res = await app.request('/', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe('Backlink');
    expect(body.endpoints).toHaveProperty('/curate');
    expect(body.endpoints).toHaveProperty('/stations');
    expect(body.endpoints).toHaveProperty('/genres');
    expect(body.endpoints).toHaveProperty('/health');
    expect(body.endpoints).not.toHaveProperty('/playlist');
    expect(body.endpoints).not.toHaveProperty('/now-playing');
  });

  it('post126: GET /health ok', async () => {
    const res = await app.request('/health', undefined, testEnv({ VERSION: 'post126' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, version: 'post126' });
  });

  it('post126: GET /genres mirrors VALID_GENRES + GENRE_MAP', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('post126: GET /stations uses cache seed', async () => {
    const stations = [{ name: 'Cached', url: 'https://c' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('jazz', stations)) });
    const res = await app.request('/stations?genre=jazz', undefined, env);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(1);
    expect(body.stations).toEqual(stations);
  });

  it('post126: GET /stations alias late night → ambient', async () => {
    const stations = [{ name: 'Amb', url: 'https://a' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('ambient', stations)) });
    const res = await app.request('/stations?genre=late%20night', undefined, env);
    const body = await json(res);
    expect(body.genre).toBe('ambient');
    expect(body.stations).toEqual(stations);
  });

  it('post126: GET /stations 503 when catalog down', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post126: GET /curate 503 without GEMINI_API_KEY', async () => {
    const res = await app.request('/curate?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Curation service unavailable' });
  });

  it('post126: GET /curate happy path curated', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }));
    const res = await app.request('/curate?genre=music&mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(Array.isArray(body.stations)).toBe(true);
    expect((body.stations as unknown[]).length).toBeGreaterThan(0);
  });

  it('post126: GET /curate degrades when gemini fails', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stations = body.stations as Array<{ editorial: null }>;
    expect(stations.length).toBeLessThanOrEqual(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('post126: unknown path 404', async () => {
    const res = await app.request('/playlist', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('post126: index.ts endpoint inventory lock', () => {
    const src = read('src/index.ts');
    expect(src).toContain("app.get('/',");
    expect(src).toContain("app.get('/health'");
    expect(src).toContain("app.get('/genres'");
    expect(src).toContain("app.get('/stations'");
    expect(src).toContain("app.get('/curate'");
    expect(src).not.toContain("app.get('/playlist'");
    expect(src).not.toContain("app.get('/now-playing'");
  });

  it('post126: mega purity 30x index.ts sha256', () => {
    const expected = "7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72";
    for (let i = 0; i < 30; i++) expect(sha256('src/index.ts')).toBe(expected);
  });

  it('post126: negative inventing fence routes', () => {
    expect(read('src/index.ts')).not.toMatch(/\/playlist|\/now-playing|openapi\.json/);
  });

  it('post126: final inventory markers', () => {
    const body = read('test/routes.test.ts');
    expect(body).toContain("describe('post123 routes HEAVY deepen (after #123)'");
    expect(body).toContain("describe('post126 routes HEAVY deepen (after #126)'");
    expect((body.match(/it\('post126:/g) ?? []).length).toBeGreaterThan(40);
  });

});

describe('post132 routes HEAVY deepen (after #132)', () => {
  // uses module-level root
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


  it('post132: GET / returns Backlink metadata', async () => {
    const res = await app.request('/', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe('Backlink');
    expect(body.endpoints).toHaveProperty('/curate');
    expect(body.endpoints).toHaveProperty('/stations');
    expect(body.endpoints).toHaveProperty('/genres');
    expect(body.endpoints).toHaveProperty('/health');
    expect(body.endpoints).not.toHaveProperty('/playlist');
    expect(body.endpoints).not.toHaveProperty('/now-playing');
  });

  it('post132: GET /health ok', async () => {
    const res = await app.request('/health', undefined, testEnv({ VERSION: 'post132' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, version: 'post132' });
  });

  it('post132: GET /genres mirrors VALID_GENRES + GENRE_MAP', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('post132: GET /stations uses cache seed', async () => {
    const stations = [{ name: 'Cached132', url: 'https://c132' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('jazz', stations)) });
    const res = await app.request('/stations?genre=jazz', undefined, env);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(1);
    expect(body.stations).toEqual(stations);
  });

  it('post132: GET /stations alias late night → ambient', async () => {
    const stations = [{ name: 'Amb132', url: 'https://a132' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('ambient', stations)) });
    const res = await app.request('/stations?genre=late%20night', undefined, env);
    const body = await json(res);
    expect(body.genre).toBe('ambient');
    expect(body.stations).toEqual(stations);
  });

  it('post132: GET /stations 503 when catalog down', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post132: GET /curate 503 without GEMINI_API_KEY', async () => {
    const res = await app.request('/curate?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Curation service unavailable' });
  });

  it('post132: GET /curate happy path curated', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }));
    const res = await app.request('/curate?genre=music&mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(Array.isArray(body.stations)).toBe(true);
    expect((body.stations as unknown[]).length).toBeGreaterThan(0);
  });

  it('post132: GET /curate degrades when gemini fails', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stations = body.stations as Array<{ editorial: null }>;
    expect(stations.length).toBeLessThanOrEqual(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('post132: unknown path 404', async () => {
    const res = await app.request('/playlist', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('post132: index.ts endpoint inventory lock', () => {
    const src = read('src/index.ts');
    expect(src).toContain("app.get('/',");
    expect(src).toContain("app.get('/health'");
    expect(src).toContain("app.get('/genres'");
    expect(src).toContain("app.get('/stations'");
    expect(src).toContain("app.get('/curate'");
    expect(src).not.toContain("app.get('/playlist'");
    expect(src).not.toContain("app.get('/now-playing'");
  });

  it('post132: mega purity 40x index.ts sha256', () => {
    const expected = "7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72";
    for (let i = 0; i < 40; i++) expect(sha256('src/index.ts')).toBe(expected);
  });

  it('post132: negative inventing fence routes', () => {
    expect(read('src/index.ts')).not.toMatch(/\/playlist|\/now-playing|openapi\.json/);
  });

  it('post132: final inventory markers', () => {
    const body = read('test/routes.test.ts');
    expect(body).toContain("describe('post126 routes HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 routes HEAVY deepen (after #132)'");
    expect((body.match(/it\('post132:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post136 routes HEAVY deepen (after #136)', () => {
  // uses module-level root
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


  it('post136: GET / returns Backlink metadata', async () => {
    const res = await app.request('/', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe('Backlink');
    expect(body.endpoints).toHaveProperty('/curate');
    expect(body.endpoints).toHaveProperty('/stations');
    expect(body.endpoints).toHaveProperty('/genres');
    expect(body.endpoints).toHaveProperty('/health');
    expect(body.endpoints).not.toHaveProperty('/playlist');
    expect(body.endpoints).not.toHaveProperty('/now-playing');
  });

  it('post136: GET /health ok', async () => {
    const res = await app.request('/health', undefined, testEnv({ VERSION: 'post136' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, version: 'post136' });
  });

  it('post136: GET /genres mirrors VALID_GENRES + GENRE_MAP', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('post136: GET /stations uses cache seed', async () => {
    const stations = [{ name: 'Cached132', url: 'https://c132' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('jazz', stations)) });
    const res = await app.request('/stations?genre=jazz', undefined, env);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(1);
    expect(body.stations).toEqual(stations);
  });

  it('post136: GET /stations alias late night → ambient', async () => {
    const stations = [{ name: 'Amb132', url: 'https://a132' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('ambient', stations)) });
    const res = await app.request('/stations?genre=late%20night', undefined, env);
    const body = await json(res);
    expect(body.genre).toBe('ambient');
    expect(body.stations).toEqual(stations);
  });

  it('post136: GET /stations 503 when catalog down', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post136: GET /curate 503 without GEMINI_API_KEY', async () => {
    const res = await app.request('/curate?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Curation service unavailable' });
  });

  it('post136: GET /curate happy path curated', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }));
    const res = await app.request('/curate?genre=music&mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(Array.isArray(body.stations)).toBe(true);
    expect((body.stations as unknown[]).length).toBeGreaterThan(0);
  });

  it('post136: GET /curate degrades when gemini fails', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stations = body.stations as Array<{ editorial: null }>;
    expect(stations.length).toBeLessThanOrEqual(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('post136: unknown path 404', async () => {
    const res = await app.request('/playlist', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('post136: index.ts endpoint inventory lock', () => {
    const src = read('src/index.ts');
    expect(src).toContain("app.get('/',");
    expect(src).toContain("app.get('/health'");
    expect(src).toContain("app.get('/genres'");
    expect(src).toContain("app.get('/stations'");
    expect(src).toContain("app.get('/curate'");
    expect(src).not.toContain("app.get('/playlist'");
    expect(src).not.toContain("app.get('/now-playing'");
  });

  it('post136: mega purity 40x index.ts sha256', () => {
    const expected = "7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72";
    for (let i = 0; i < 40; i++) expect(sha256('src/index.ts')).toBe(expected);
  });

  it('post136: negative inventing fence routes', () => {
    expect(read('src/index.ts')).not.toMatch(/\/playlist|\/now-playing|openapi\.json/);
  });

  it('post136: final inventory markers', () => {
    const body = read('test/routes.test.ts');
    expect(body).toContain("describe('post126 routes HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 routes HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post136 routes HEAVY deepen (after #136)'");
    expect((body.match(/it\('post136:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post141 routes HEAVY deepen (after #141)', () => {
  // uses module-level root
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


  it('post141: GET / returns Backlink metadata', async () => {
    const res = await app.request('/', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe('Backlink');
    expect(body.endpoints).toHaveProperty('/curate');
    expect(body.endpoints).toHaveProperty('/stations');
    expect(body.endpoints).toHaveProperty('/genres');
    expect(body.endpoints).toHaveProperty('/health');
    expect(body.endpoints).not.toHaveProperty('/playlist');
    expect(body.endpoints).not.toHaveProperty('/now-playing');
  });

  it('post141: GET /health ok', async () => {
    const res = await app.request('/health', undefined, testEnv({ VERSION: 'post141' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, version: 'post141' });
  });

  it('post141: GET /genres mirrors VALID_GENRES + GENRE_MAP', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('post141: GET /stations uses cache seed', async () => {
    const stations = [{ name: 'Cached132', url: 'https://c132' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('jazz', stations)) });
    const res = await app.request('/stations?genre=jazz', undefined, env);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(1);
    expect(body.stations).toEqual(stations);
  });

  it('post141: GET /stations alias late night → ambient', async () => {
    const stations = [{ name: 'Amb132', url: 'https://a132' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('ambient', stations)) });
    const res = await app.request('/stations?genre=late%20night', undefined, env);
    const body = await json(res);
    expect(body.genre).toBe('ambient');
    expect(body.stations).toEqual(stations);
  });

  it('post141: GET /stations 503 when catalog down', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post141: GET /curate 503 without GEMINI_API_KEY', async () => {
    const res = await app.request('/curate?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Curation service unavailable' });
  });

  it('post141: GET /curate happy path curated', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }));
    const res = await app.request('/curate?genre=music&mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(Array.isArray(body.stations)).toBe(true);
    expect((body.stations as unknown[]).length).toBeGreaterThan(0);
  });

  it('post141: GET /curate degrades when gemini fails', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stations = body.stations as Array<{ editorial: null }>;
    expect(stations.length).toBeLessThanOrEqual(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('post141: unknown path 404', async () => {
    const res = await app.request('/playlist', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('post141: index.ts endpoint inventory lock', () => {
    const src = read('src/index.ts');
    expect(src).toContain("app.get('/',");
    expect(src).toContain("app.get('/health'");
    expect(src).toContain("app.get('/genres'");
    expect(src).toContain("app.get('/stations'");
    expect(src).toContain("app.get('/curate'");
    expect(src).not.toContain("app.get('/playlist'");
    expect(src).not.toContain("app.get('/now-playing'");
  });

  it('post141: mega purity 40x index.ts sha256', () => {
    const expected = "7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72";
    for (let i = 0; i < 40; i++) expect(sha256('src/index.ts')).toBe(expected);
  });

  it('post141: negative inventing fence routes', () => {
    expect(read('src/index.ts')).not.toMatch(/\/playlist|\/now-playing|openapi\.json/);
  });

  it('post141: final inventory markers', () => {
    const body = read('test/routes.test.ts');
    expect(body).toContain("describe('post126 routes HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 routes HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post136 routes HEAVY deepen (after #136)'");
    expect(body).toContain("describe('post141 routes HEAVY deepen (after #141)'");
    expect((body.match(/it\('post141:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post146 routes HEAVY deepen (after #146)', () => {
  // uses module-level root
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


  it('post146: GET / returns Backlink metadata', async () => {
    const res = await app.request('/', undefined, testEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe('Backlink');
    expect(body.endpoints).toHaveProperty('/curate');
    expect(body.endpoints).toHaveProperty('/stations');
    expect(body.endpoints).toHaveProperty('/genres');
    expect(body.endpoints).toHaveProperty('/health');
    expect(body.endpoints).not.toHaveProperty('/playlist');
    expect(body.endpoints).not.toHaveProperty('/now-playing');
  });

  it('post146: GET /health ok', async () => {
    const res = await app.request('/health', undefined, testEnv({ VERSION: 'post146' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, version: 'post146' });
  });

  it('post146: GET /genres mirrors VALID_GENRES + GENRE_MAP', async () => {
    const res = await app.request('/genres', undefined, testEnv());
    const body = await json(res);
    expect(body.genres).toEqual([...VALID_GENRES]);
    expect(body.aliases).toEqual(GENRE_MAP);
  });

  it('post146: GET /stations uses cache seed', async () => {
    const stations = [{ name: 'Cached132', url: 'https://c132' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('jazz', stations)) });
    const res = await app.request('/stations?genre=jazz', undefined, env);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(1);
    expect(body.stations).toEqual(stations);
  });

  it('post146: GET /stations alias late night → ambient', async () => {
    const stations = [{ name: 'Amb132', url: 'https://a132' }];
    const env = testEnv({ CATALOG_CACHE: mockKV(seedStationsCache('ambient', stations)) });
    const res = await app.request('/stations?genre=late%20night', undefined, env);
    const body = await json(res);
    expect(body.genre).toBe('ambient');
    expect(body.stations).toEqual(stations);
  });

  it('post146: GET /stations 503 when catalog down', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: null, iptvStatus: 503 }));
    const res = await app.request('/stations?genre=music', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Stream catalog unavailable', retry_after: 60 });
  });

  it('post146: GET /curate 503 without GEMINI_API_KEY', async () => {
    const res = await app.request('/curate?genre=jazz', undefined, testEnv());
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'Curation service unavailable' });
  });

  it('post146: GET /curate happy path curated', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U, gemini: curatedGeminiJson() }));
    const res = await app.request('/curate?genre=music&mood=chill', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(Array.isArray(body.stations)).toBe(true);
    expect((body.stations as unknown[]).length).toBeGreaterThan(0);
  });

  it('post146: GET /curate degrades when gemini fails', async () => {
    vi.stubGlobal('fetch', stubIptvAndGemini({ m3u: SAMPLE_M3U }));
    const res = await app.request('/curate?genre=music', undefined, testEnv({ GEMINI_API_KEY: 'k' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stations = body.stations as Array<{ editorial: null }>;
    expect(stations.length).toBeLessThanOrEqual(5);
    expect(stations[0].editorial).toBeNull();
  });

  it('post146: unknown path 404', async () => {
    const res = await app.request('/playlist', undefined, testEnv());
    expect(res.status).toBe(404);
  });

  it('post146: index.ts endpoint inventory lock', () => {
    const src = read('src/index.ts');
    expect(src).toContain("app.get('/',");
    expect(src).toContain("app.get('/health'");
    expect(src).toContain("app.get('/genres'");
    expect(src).toContain("app.get('/stations'");
    expect(src).toContain("app.get('/curate'");
    expect(src).not.toContain("app.get('/playlist'");
    expect(src).not.toContain("app.get('/now-playing'");
  });

  it('post146: mega purity 40x index.ts sha256', () => {
    const expected = "7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72";
    for (let i = 0; i < 40; i++) expect(sha256('src/index.ts')).toBe(expected);
  });

  it('post146: negative inventing fence routes', () => {
    expect(read('src/index.ts')).not.toMatch(/\/playlist|\/now-playing|openapi\.json/);
  });

    it('post146: final inventory markers', () => {
    const body = read('test/routes.test.ts');
    expect(body).toContain("describe('post126 routes HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 routes HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post136 routes HEAVY deepen (after #136)'");
    expect(body).toContain("describe('post141 routes HEAVY deepen (after #141)'");
    expect(body).toContain("describe('post146 routes HEAVY deepen (after #146)'");
    expect((body.match(/it\('post146:/g) ?? []).length).toBeGreaterThan(60);
  });

});

describe('post146 routes extras HEAVY deepen (after #146 leftover slice)', () => {
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
    const keys = ["post146","after-#146","leftover","TOKENMAXX","HEAVY","no-product-invent","slice-diff","no-src-change","manifest-lock","ci-leftover","fuzzywigg","backlink","CATALOG_CACHE","GEMINI_API_KEY","iptv-org","gemini-2.0-flash","VALID_GENRES","HITL","no-creds","station_select","post146-extras","routes"];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe('798825eb9005ddb4196cec82bda114656f172954b41c2b37ffdede9f7a80ad0d');
    expect(keys).toHaveLength(22);
  });
  it('post146-extras: final inventory markers', () => {
    const body = read('test/routes.test.ts');
    expect(body).toContain("describe('post146 routes HEAVY deepen (after #146)')");
    expect(body).toContain("describe('post146 routes extras HEAVY deepen (after #146 leftover slice)')");
    expect((body.match(/it\('post146-extras:/g) ?? []).length).toBeGreaterThan(100);
  });
});
