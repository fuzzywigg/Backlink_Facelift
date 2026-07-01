# Backlink

AI-curated live radio from the [iptv-org](https://github.com/iptv-org/iptv) catalog, running as a Cloudflare Worker with MCP tool support.

## What is Backlink?

Backlink is a lightweight radio service that:
- Ingests the iptv-org M3U catalog (~8,000+ stations) and caches it in Cloudflare KV
- Filters stations by genre on demand
- Tracks the currently playing station per session
- Uses Claude (`claude-haiku-4-5`) to intelligently curate station picks based on mood or context
- Exposes an MCP-compatible tool manifest so AI assistants can control playback

## Quick Start

```bash
# Install dependencies
npm install

# Set required secrets
wrangler secret put ANTHROPIC_API_KEY

# Create a KV namespace and update wrangler.toml with the ID
wrangler kv namespace create STATION_STATE
# → copy the id into wrangler.toml [[kv_namespaces]] id field

# Local dev
npm run dev

# Deploy
npm run deploy
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Now-playing JSON |
| GET | `/stations?genre=jazz` | Filter stations by genre |
| GET | `/mcp` | MCP tool manifest |
| POST | `/mcp/station_select` | Select a station by name |
| POST | `/mcp/curator` | Ask Claude to pick best station for a mood |

### Example: Now Playing

```bash
curl https://backlink.<your-subdomain>.workers.dev/
# {"now_playing":{"name":"Jazz FM","url":"http://...","genre":"Jazz","country":"GB"}}
```

### Example: Curator

```bash
curl -X POST https://backlink.<your-subdomain>.workers.dev/mcp/curator \
  -H "Content-Type: application/json" \
  -d '{"mood":"late night coding focus","genre":"jazz"}'
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `station_select` | Set the currently playing station by name |
| `now_playing` | Get current station info (name, genre, URL, country) |
| `genre_filter` | List stations filtered by genre keyword |
| `curator_prompt` | Ask Claude to pick the best station for a mood |

## GitHub Actions Deploy

The workflow at `.github/workflows/deploy.yml` deploys on every push to `main`.

Required GitHub secrets:
- `CF_API_TOKEN` — Cloudflare API token with Worker:Edit permission
- `CF_ACCOUNT_ID` — Your Cloudflare account ID  
- `ANTHROPIC_API_KEY` — Anthropic API key for LLM curation

## Catalog Source

Station data is sourced from [iptv-org/iptv](https://github.com/iptv-org/iptv) and refreshed every hour via Cloudflare KV TTL.

## Stack

- **Runtime:** Cloudflare Workers (ES2022)
- **Language:** TypeScript (strict)
- **KV:** Cloudflare KV for station state + catalog cache
- **LLM:** Anthropic Claude (`claude-haiku-4-5`) via `@anthropic-ai/sdk`
- **Deploy:** `wrangler-action@v3`

