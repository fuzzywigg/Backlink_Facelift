# Backlink 📻

> AI-curated internet radio. The editorial layer is the product.

Backlink wraps the [iptv-org](https://github.com/iptv-org/iptv) catalog (8,000+ free, legal streams) with Claude Haiku curation. Tell it a mood or genre — it picks the stations and explains why.

## API

```
GET /curate?genre=ambient&mood=late+night
→ { stations: [{ name, url, editorial, genre, logo }] }

GET /curate?genre=jazz
→ Top 3 jazz picks with editorial blurbs

GET /stations?genre=classical
→ Raw station list (no LLM)

GET /genres
→ Available iptv-org genre categories + aliases

GET /health
→ { ok: true, version: "0.1.0" }
```

## Example Response

```json
{
  "query": "late night ambient",
  "curated_by": "Backlink/Geryon",
  "timestamp": "2026-07-01T00:00:00.000Z",
  "stations": [
    {
      "name": "Drone Zone",
      "url": "https://...",
      "logo": "https://...",
      "editorial": "Deep, textural ambient perfect for 3am focus sessions. No beats, no vocals — just space.",
      "genre": "ambient"
    }
  ]
}
```

## Deploy Your Own

See [DEPLOY.md](./DEPLOY.md).

## Stack

- **Cloudflare Workers** — zero infra, global edge
- **Hono** — lightweight routing
- **iptv-org** — 8,000+ free stream catalog
- **Claude Haiku** — editorial curation
- **CF KV** — M3U parse cache (1h TTL)

## Available Genres

`music` · `ambient` · `jazz` · `classical` · `pop` · `rock` · `news` · `sports` · `entertainment`

Aliases: `late night` → ambient, `chill` → ambient, `lofi` → ambient, `blues` → jazz, etc.

## Part of the smtp.eth ecosystem

Built by [Andrew Pappas](https://fuzzywigg.com) / Geryon 🦀
