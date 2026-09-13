import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENRE_MAP } from '../src/genres';
import app from '../src/index';
import {
  SAMPLE_M3U,
  geminiTextResponse,
  mockKV,
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
});
