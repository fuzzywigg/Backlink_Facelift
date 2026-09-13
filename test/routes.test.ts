import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENRE_MAP, VALID_GENRES } from '../src/genres';
import app from '../src/index';
import {
  SAMPLE_M3U,
  buildSimpleM3U,
  captureGeminiRequest,
  geminiTextResponse,
  iptvCallsWithInit,
  mockKV,
  seedStationsCache,
  stubIptvAndGemini,
  testEnv,
} from './helpers';

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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
});

