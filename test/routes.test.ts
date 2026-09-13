import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { SAMPLE_M3U, mockKV, stubIptvAndGemini, testEnv } from './helpers';

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
});
