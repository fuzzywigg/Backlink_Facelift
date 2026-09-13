import { vi } from 'vitest';
import type { Env } from '../src/types';

/** In-memory KV stub for Worker route tests. */
export function mockKV(seed: Record<string, string> = {}): KVNamespace {
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

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    CATALOG_CACHE: mockKV(),
    VERSION: '0.1.0-test',
    ...overrides,
  };
}

export const SAMPLE_M3U = `#EXTM3U
#EXTINF:-1 tvg-name="Alpha FM" group-title="Music",Alpha FM
https://example.com/alpha.m3u8
#EXTINF:-1 tvg-name="Beta FM" group-title="Music",Beta FM
https://example.com/beta.m3u8
#EXTINF:-1 tvg-name="Gamma FM" group-title="Music",Gamma FM
https://example.com/gamma.m3u8
#EXTINF:-1 tvg-name="Delta FM" group-title="Music",Delta FM
https://example.com/delta.m3u8
#EXTINF:-1 tvg-name="Epsilon FM" group-title="Music",Epsilon FM
https://example.com/epsilon.m3u8
#EXTINF:-1 tvg-name="Zeta FM" group-title="Music",Zeta FM
https://example.com/zeta.m3u8
`;

/** Build a Gemini generateContent-shaped JSON response with the given model text. */
export function geminiTextResponse(text: string): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text }] } }],
  });
}

export function stubIptvAndGemini(opts: {
  m3u?: string | null;
  /** Per-category M3U bodies keyed by iptv-org slug (e.g. jazz, music). */
  iptvByGenre?: Record<string, string | null>;
  gemini?: Response | (() => Response);
  iptvStatus?: number;
}): ReturnType<typeof vi.fn> {
  const m3u = opts.m3u === undefined ? SAMPLE_M3U : opts.m3u;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('iptv-org')) {
      const genreMatch = url.match(/\/categories\/([^/.]+)\.m3u/);
      const genre = genreMatch?.[1];
      if (genre && opts.iptvByGenre && Object.prototype.hasOwnProperty.call(opts.iptvByGenre, genre)) {
        const body = opts.iptvByGenre[genre];
        if (body === null) return new Response('down', { status: opts.iptvStatus ?? 503 });
        return new Response(body, { status: 200 });
      }
      if (m3u === null) return new Response('down', { status: opts.iptvStatus ?? 503 });
      return new Response(m3u, { status: 200 });
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      if (typeof opts.gemini === 'function') return opts.gemini();
      if (opts.gemini) return opts.gemini;
      return new Response('boom', { status: 500 });
    }
    return new Response('nope', { status: 404 });
  });
}

/** Minimal curated Gemini JSON text for happy-path /curate stubs. */
export function curatedGeminiJson(
  stations: Array<{ name: string; url: string; editorial: string; genre: string; logo?: string }> = [
    {
      name: 'Alpha FM',
      url: 'https://example.com/alpha.m3u8',
      editorial: 'Default curated pick.',
      genre: 'music',
    },
  ],
): Response {
  return geminiTextResponse(JSON.stringify(stations));
}

/** Build an iptv-org category URL the Worker fetchStations helper would hit. */
export function iptvCategoryUrl(genre: string): string {
  return `https://iptv-org.github.io/iptv/categories/${genre}.m3u`;
}

/** Count http(s) stream URL lines in an M3U body (post-trim lines). */
export function countHttpStreamLines(m3u: string): number {
  return m3u
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http://') || l.startsWith('https://')).length;
}

/** Minimal EXTINF+URL fixture builder for edge-case route/parser tests. */
export function buildSimpleM3U(
  stations: Array<{ name: string; url: string; group?: string; language?: string; country?: string; logo?: string }>,
): string {
  const lines = ['#EXTM3U'];
  for (const s of stations) {
    const attrs = [
      `tvg-name="${s.name}"`,
      s.logo !== undefined ? `tvg-logo="${s.logo}"` : null,
      s.group !== undefined ? `group-title="${s.group}"` : null,
      s.language !== undefined ? `tvg-language="${s.language}"` : null,
      s.country !== undefined ? `tvg-country="${s.country}"` : null,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`#EXTINF:-1 ${attrs},${s.name}`);
    lines.push(s.url);
  }
  return `${lines.join('\n')}\n`;
}

/** Seed a genre cache key with a JSON-serialized or raw string value. */
export function seedStationsCache(
  genre: string,
  value: unknown,
  existing: Record<string, string> = {},
): Record<string, string> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return { ...existing, [`stations:${genre}`]: serialized };
}

/**
 * Extract the first generativelanguage.googleapis.com call from a vi fetch mock.
 * Returns null when Gemini was never hit.
 */
export function captureGeminiRequest(
  fetchMock: { mock: { calls: unknown[][] } },
): { url: string; method: string; headers: HeadersInit | undefined; body: Record<string, unknown> } | null {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('generativelanguage.googleapis.com'));
  if (!call) return null;
  const url = String(call[0]);
  const init = call[1] as RequestInit | undefined;
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  return {
    url,
    method: (init?.method ?? 'GET').toString().toUpperCase(),
    headers: init?.headers,
    body,
  };
}

/** Return iptv-org fetch calls that unexpectedly passed a RequestInit second arg. */
export function iptvCallsWithInit(fetchMock: { mock: { calls: unknown[][] } }): unknown[][] {
  return fetchMock.mock.calls.filter(
    (call) => String(call[0]).includes('iptv-org') && call[1] !== undefined,
  );
}
