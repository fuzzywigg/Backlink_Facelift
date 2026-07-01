# Backlink MCP Tool Specification

This spec defines Backlink as a claw-mcp tool set. Each tool maps to a Backlink API endpoint.

---

## Tools

### `backlink_curate`

**Description:** Ask Backlink's AI curator to pick the top 3 radio stations for a given genre or mood, with editorial blurbs.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "genre": {
      "type": "string",
      "description": "Music genre (e.g. 'jazz', 'classical', 'ambient', 'rock', 'pop'). Optional if mood is provided."
    },
    "mood": {
      "type": "string",
      "description": "Mood or vibe descriptor (e.g. 'late night', 'focus', 'chill', 'energizing'). Optional if genre is provided."
    }
  },
  "additionalProperties": false
}
```

**Output:** Array of curated station objects.
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string" },
    "curated_by": { "type": "string" },
    "timestamp": { "type": "string", "format": "date-time" },
    "stations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "url": { "type": "string", "format": "uri" },
          "logo": { "type": ["string", "null"], "format": "uri" },
          "editorial": { "type": ["string", "null"] },
          "genre": { "type": "string" }
        },
        "required": ["name", "url", "genre"]
      }
    }
  }
}
```

**Endpoint:** `GET /curate?genre={genre}&mood={mood}`

---

### `backlink_genres`

**Description:** List all available iptv-org genre categories supported by Backlink, including mood aliases.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

**Output:**
```json
{
  "type": "object",
  "properties": {
    "genres": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Canonical genre slugs accepted by /curate and /stations"
    },
    "aliases": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Friendly name → canonical slug mapping"
    }
  }
}
```

**Endpoint:** `GET /genres`

---

### `backlink_now_playing`

**Description:** Get the top AI-curated pick for a genre or mood — the single best station right now, with editorial context.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "genre": {
      "type": "string",
      "description": "Genre slug or friendly name (e.g. 'ambient', 'late night', 'jazz')."
    },
    "mood": {
      "type": "string",
      "description": "Mood descriptor. Used alongside or instead of genre."
    }
  },
  "additionalProperties": false
}
```

**Output:** Single station object (first result from /curate).
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "stream_url": { "type": "string", "format": "uri" },
    "logo": { "type": ["string", "null"], "format": "uri" },
    "editorial": { "type": ["string", "null"] },
    "genre": { "type": "string" }
  },
  "required": ["name", "stream_url", "genre"]
}
```

**Endpoint:** `GET /curate?genre={genre}&mood={mood}` — returns `stations[0]` only, with `url` remapped to `stream_url`.

---

## Integration Notes

- Base URL: `https://backlink.fuzzywigg.com`
- No auth required for read endpoints
- KV cache means `/stations` calls are fast after first hit per genre (1h TTL)
- `/curate` always calls Haiku fresh — no LLM response caching
- On Haiku failure, graceful degradation returns top 5 raw stations with `editorial: null`
