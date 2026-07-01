import Anthropic from "@anthropic-ai/sdk";

export interface Env {
  STATION_STATE: KVNamespace;
  ANTHROPIC_API_KEY: string;
  CURATOR_MODEL: string;
}

const IPTV_CATALOG_URL = "https://iptv-org.github.io/iptv/index.m3u";
const KV_CATALOG_KEY = "catalog:cached";
const KV_CATALOG_TTL = 3600; // 1 hour
const KV_CURRENT_STATION_KEY = "station:current";

interface Station {
  name: string;
  url: string;
  genre: string;
  country: string;
  logo?: string;
}

async function fetchCatalog(env: Env): Promise<Station[]> {
  const cached = await env.STATION_STATE.get(KV_CATALOG_KEY);
  if (cached) return JSON.parse(cached) as Station[];

  const res = await fetch(IPTV_CATALOG_URL);
  const text = await res.text();
  const stations = parseM3U(text);

  await env.STATION_STATE.put(KV_CATALOG_KEY, JSON.stringify(stations), {
    expirationTtl: KV_CATALOG_TTL,
  });
  return stations;
}

function parseM3U(m3u: string): Station[] {
  const lines = m3u.split("\n");
  const stations: Station[] = [];
  let current: Partial<Station> = {};

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const nameMatch = line.match(/,(.+)$/);
      const groupMatch = line.match(/group-title="([^"]+)"/);
      const countryMatch = line.match(/tvg-country="([^"]+)"/);
      const logoMatch = line.match(/tvg-logo="([^"]+)"/);
      current = {
        name: nameMatch?.[1]?.trim() ?? "Unknown",
        genre: groupMatch?.[1]?.trim() ?? "General",
        country: countryMatch?.[1]?.trim() ?? "",
        logo: logoMatch?.[1]?.trim(),
      };
    } else if (line.startsWith("http") && current.name) {
      stations.push({ ...(current as Station), url: line.trim() });
      current = {};
    }
  }
  return stations;
}

async function curateStation(
  stations: Station[],
  mood: string,
  env: Env
): Promise<Station> {
  // LLM curation stub — calls Claude to pick best station for mood
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const sample = stations.slice(0, 50).map((s) => `${s.name} [${s.genre}]`);

  const msg = await client.messages.create({
    model: env.CURATOR_MODEL,
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `You are a music curator. Given this mood/context: "${mood}", pick the BEST radio station from this list. Reply with ONLY the station name, nothing else.\n\nStations:\n${sample.join("\n")}`,
      },
    ],
  });

  const chosen = (msg.content[0] as { text: string }).text.trim();
  return stations.find((s) => s.name === chosen) ?? stations[0];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { method, pathname } = { method: request.method, pathname: url.pathname };

    // GET / — now_playing
    if (method === "GET" && pathname === "/") {
      const stations = await fetchCatalog(env);
      const raw = await env.STATION_STATE.get(KV_CURRENT_STATION_KEY);
      const current: Station = raw ? JSON.parse(raw) : stations[0];
      return Response.json({ now_playing: current });
    }

    // GET /stations?genre=jazz
    if (method === "GET" && pathname === "/stations") {
      const genre = url.searchParams.get("genre");
      let stations = await fetchCatalog(env);
      if (genre) {
        stations = stations.filter(
          (s) => s.genre.toLowerCase().includes(genre.toLowerCase())
        );
      }
      return Response.json({ stations, count: stations.length });
    }

    // GET /mcp — MCP tool manifest
    if (method === "GET" && pathname === "/mcp") {
      const { MCP_MANIFEST } = await import("./mcp");
      return Response.json(MCP_MANIFEST);
    }

    // POST /mcp/station_select
    if (method === "POST" && pathname === "/mcp/station_select") {
      const body = await request.json<{ station_name: string }>();
      const stations = await fetchCatalog(env);
      const station = stations.find((s) =>
        s.name.toLowerCase().includes(body.station_name.toLowerCase())
      );
      if (!station) {
        return Response.json({ error: "Station not found" }, { status: 404 });
      }
      await env.STATION_STATE.put(KV_CURRENT_STATION_KEY, JSON.stringify(station));
      return Response.json({ selected: station });
    }

    // POST /mcp/curator
    if (method === "POST" && pathname === "/mcp/curator") {
      const body = await request.json<{ mood: string; genre?: string }>();
      let stations = await fetchCatalog(env);
      if (body.genre) {
        stations = stations.filter((s) =>
          s.genre.toLowerCase().includes(body.genre!.toLowerCase())
        );
      }
      const station = await curateStation(stations, body.mood, env);
      await env.STATION_STATE.put(KV_CURRENT_STATION_KEY, JSON.stringify(station));
      return Response.json({ curated: station });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
