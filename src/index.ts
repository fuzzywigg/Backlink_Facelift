import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { parseM3U, Station } from './parser';
import { Env } from './types';

const GENRE_MAP: Record<string, string> = {
  'late night': 'ambient',
  chill: 'ambient',
  ambient: 'ambient',
  relaxing: 'ambient',
  focus: 'ambient',
  classical: 'classical',
  classic: 'classical',
  jazz: 'jazz',
  blues: 'jazz',
  pop: 'pop',
  rock: 'rock',
  metal: 'rock',
  indie: 'rock',
  music: 'music',
  news: 'news',
  sports: 'sports',
  entertainment: 'entertainment',
  dance: 'pop',
  electronic: 'ambient',
  lofi: 'ambient',
  'lo-fi': 'ambient',
};

const VALID_GENRES = ['music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment'];
const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories';

function resolveGenre(input?: string): string {
  if (!input) return 'music';
  const lower = input.toLowerCase().trim();
  return GENRE_MAP[lower] ?? (VALID_GENRES.includes(lower) ? lower : 'music');
}

async function fetchStations(genre: string, kv: KVNamespace): Promise<Station[]> {
  const cacheKey = `stations:${genre}`;
  const cached = await kv.get(cacheKey);
  if (cached) return JSON.parse(cached) as Station[];

  const url = `${IPTV_BASE}/${genre}.m3u`;
  let res = await fetch(url);

  if (!res.ok) {
    // Fallback to music.m3u
    res = await fetch(`${IPTV_BASE}/music.m3u`);
    if (!res.ok) throw new Error('Stream catalog unavailable');
  }

  const raw = await res.text();
  const stations = parseM3U(raw);

  await kv.put(cacheKey, JSON.stringify(stations), { expirationTtl: 3600 });
  return stations;
}

async function callGemini(
  apiKey: string,
  stations: Station[],
  genre: string,
  mood?: string,
): Promise<Array<{ name: string; url: string; logo?: string; editorial: string; genre: string }>> {
  const query = [mood, genre].filter(Boolean).join(' / ');
  const stationList = stations
    .slice(0, 50)
    .map((s, i) => `${i + 1}. ${s.name} (${s.group ?? genre}) [${s.language ?? 'en'}] — ${s.url}`)
    .join('\n');

  const prompt = `You are Backlink, an AI radio curator. Given this list of radio stations and the user's request, pick the top 3 stations with a short editorial blurb (1-2 sentences max). Be specific about what makes each station right for the mood. Return JSON only: [{"name": "...", "url": "...", "logo": "...", "editorial": "...", "genre": "..."}]\n\nUser request: ${query}\n\nAvailable stations:\n${stationList}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
      }),
    },
  );

  if (!resp.ok) throw new Error(`Gemini API error: ${resp.status}`);

  const data = (await resp.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates[0]?.content?.parts[0]?.text ?? '';

  const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!jsonMatch) throw new Error('Invalid JSON from Gemini');

  return JSON.parse(jsonMatch[0]);
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/', (c) => {
  return c.json({
    name: 'Backlink',
    description: 'LLM-curated internet radio — editorial AI over iptv-org catalog',
    version: c.env.VERSION ?? '0.1.0',
    endpoints: {
      '/curate': 'GET ?genre=&mood= — AI-curated station picks',
      '/stations': 'GET ?genre= — Raw station list',
      '/genres': 'GET — Available genre categories',
      '/health': 'GET — Health check',
    },
    powered_by: 'Backlink/Geryon 🦀',
  });
});

app.get('/health', (c) => {
  return c.json({ ok: true, version: c.env.VERSION ?? '0.1.0' });
});

app.get('/genres', (c) => {
  return c.json({
    genres: VALID_GENRES,
    aliases: GENRE_MAP,
  });
});

app.get('/stations', async (c) => {
  const genreParam = c.req.query('genre');
  const genre = resolveGenre(genreParam);

  let stations: Station[];
  try {
    stations = await fetchStations(genre, c.env.CATALOG_CACHE);
  } catch {
    return c.json({ error: 'Stream catalog unavailable', retry_after: 60 }, 503);
  }

  return c.json({ genre, count: stations.length, stations });
});

app.get('/curate', async (c) => {
  const genreParam = c.req.query('genre');
  const mood = c.req.query('mood');
  const genre = resolveGenre(genreParam ?? mood);

  let stations: Station[];
  try {
    stations = await fetchStations(genre, c.env.CATALOG_CACHE);
  } catch {
    return c.json({ error: 'Stream catalog unavailable', retry_after: 60 }, 503);
  }

  const query = [mood, genreParam].filter(Boolean).join(' ') || genre;

  let curated;
  try {
    curated = await callGemini(c.env.GEMINI_API_KEY, stations, genre, mood);
  } catch {
    // Graceful degradation: return top 5 without editorial
    curated = stations.slice(0, 5).map((s) => ({
      name: s.name,
      url: s.url,
      logo: s.logo,
      editorial: null,
      genre,
    }));
  }

  return c.json({
    query,
    curated_by: 'Backlink/Geryon',
    timestamp: new Date().toISOString(),
    stations: curated,
  });
});

export default app;
