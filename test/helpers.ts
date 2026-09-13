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
  gemini?: Response | (() => Response);
  iptvStatus?: number;
}): ReturnType<typeof vi.fn> {
  const m3u = opts.m3u === undefined ? SAMPLE_M3U : opts.m3u;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('iptv-org')) {
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
