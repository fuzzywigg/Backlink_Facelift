import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { Env } from '../src/types';

const SAMPLE_M3U = `#EXTM3U
#EXTINF:-1 tvg-name="Alpha FM" group-title="Music",Alpha FM
https://example.com/alpha.m3u8
#EXTINF:-1 tvg-name="Beta FM" group-title="Music",Beta FM
https://example.com/beta.m3u8
#EXTINF:-1 tvg-name="Gamma FM" group-title="Music",Gamma FM
https://example.com/gamma.m3u8
`;

function mockKV(seed: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(seed));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null, cacheStatus: null })),
  } as unknown as KVNamespace;
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    CATALOG_CACHE: mockKV(),
    VERSION: '0.1.0-test',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET / and /health', () => {
  it('returns service metadata on /', async () => {
    const res = await app.request('/', undefined, env());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Backlink');
    expect(body.version).toBe('0.1.0-test');
    expect(body.endpoints['/curate']).toBeTruthy();
  });

  it('returns ok health payload', async () => {
    const res = await app.request('/health', undefined, env());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, version: '0.1.0-test' });
  });
});

describe('GET /genres', () => {
  it('lists categories and aliases', async () => {
    const res = await app.request('/genres', undefined, env());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.genres).toContain('music');
    expect(body.genres).toContain('news');
    expect(body.aliases.chill).toBe('ambient');
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

    const res = await app.request('/stations?genre=chill', undefined, env({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.genre).toBe('ambient');
    expect(body.count).toBe(3);
    expect(body.stations[0].name).toBe('Alpha FM');
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

    const res = await app.request('/stations?genre=music', undefined, env({ CATALOG_CACHE: kv }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.stations[0].name).toBe('Cached');
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

    const res = await app.request('/stations?genre=jazz', undefined, env());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.genre).toBe('jazz');
    expect(body.count).toBe(3);
  });

  it('returns 503 when catalog and music fallback both fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );

    const res = await app.request('/stations?genre=news', undefined, env());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Stream catalog unavailable',
      retry_after: 60,
    });
  });
});

describe('GET /curate', () => {
  it('returns 503 when GEMINI_API_KEY is missing', async () => {
    const res = await app.request('/curate?genre=music', undefined, env({ GEMINI_API_KEY: undefined }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Curation service unavailable',
      retry_after: 60,
    });
  });

  it('degrades to top stations with editorial null when Gemini fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) {
          return new Response(SAMPLE_M3U, { status: 200 });
        }
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response('boom', { status: 500 });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request(
      '/curate?genre=music&mood=focus',
      undefined,
      env({ GEMINI_API_KEY: 'test-key' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.curated_by).toBe('Backlink/Geryon');
    expect(body.query).toBe('focus music');
    expect(body.stations).toHaveLength(3);
    expect(body.stations.every((s: { editorial: unknown }) => s.editorial === null)).toBe(true);
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

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('iptv-org')) {
          return new Response(SAMPLE_M3U, { status: 200 });
        }
        if (url.includes('generativelanguage.googleapis.com')) {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [{ text: `Here you go:\n${JSON.stringify(curated)}\n` }],
                },
              },
            ],
          });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const res = await app.request('/curate?genre=music', undefined, env({ GEMINI_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stations).toEqual(curated);
  });
});
