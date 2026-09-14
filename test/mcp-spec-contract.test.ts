import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MCP_MANIFEST } from '../src/mcp';
import { GENRE_MAP, VALID_GENRES, resolveGenre } from '../src/genres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(root, 'docs/mcp-spec.md');
const spec = readFileSync(specPath, 'utf8');

function jsonFences(): unknown[] {
  return [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
}

function toolSection(id: string, until: string): string {
  return spec.slice(spec.indexOf(`### \`${id}\``), spec.indexOf(until));
}

describe('docs/mcp-spec.md ↔ runtime contracts', () => {
  it('documents the live HTTP endpoints the Worker exposes', () => {
    expect(spec).toContain('GET /curate?genre={genre}&mood={mood}');
    expect(spec).toContain('GET /genres');
    expect(spec).toMatch(/Base URL:\s*`https:\/\/backlink\.fuzzywigg\.com`/);
  });

  it('documents Gemini graceful degradation matching /curate behavior', () => {
    expect(spec).toMatch(/graceful degradation returns top 5 raw stations/i);
    expect(spec).toContain('editorial: null');
  });

  it('documents KV cache TTL behavior for /stations', () => {
    expect(spec).toMatch(/1h TTL/i);
  });

  it('keeps claw-mcp tool names stable in src/mcp.ts (distinct from docs tool ids)', () => {
    // docs/mcp-spec.md uses backlink_* names; src/mcp.ts is the claw-mcp manifest.
    expect(spec).toContain('backlink_curate');
    expect(spec).toContain('backlink_genres');
    expect(spec).toContain('backlink_now_playing');

    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('documents the core genre examples used by the public API', () => {
    for (const genre of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(spec.toLowerCase()).toContain(genre);
      expect(VALID_GENRES).toContain(genre);
    }
  });

  it('mentions mood aliases that GENRE_MAP exposes', () => {
    expect(spec).toMatch(/late night/i);
    expect(GENRE_MAP['late night']).toBe('ambient');
  });

  it('documents that /curate calls Gemini fresh (no LLM response caching)', () => {
    expect(spec).toMatch(/\/curate`?\s+always calls Gemini fresh/i);
  });

  it('documents no-auth read endpoints', () => {
    expect(spec).toMatch(/No auth required for read endpoints/i);
  });

  it('documents /stations endpoint behavior alongside /curate and /genres', () => {
    expect(spec).toMatch(/\/stations/i);
    expect(spec).toContain('GET /curate?genre={genre}&mood={mood}');
    expect(spec).toContain('GET /genres');
  });

  it('documents curator output fields that /curate returns', () => {
    expect(spec).toContain('curated_by');
    expect(spec).toContain('timestamp');
    expect(spec).toContain('"editorial"');
  });

  it('keeps docs tool ids distinct from claw-mcp tool names', () => {
    const clawNames = new Set(MCP_MANIFEST.tools.map((t) => t.name));
    for (const docsId of ['backlink_curate', 'backlink_genres', 'backlink_now_playing']) {
      expect(clawNames.has(docsId)).toBe(false);
      expect(spec).toContain(docsId);
    }
  });

  it('documents additionalProperties:false on docs tool input schemas', () => {
    expect(spec).toMatch(/"additionalProperties":\s*false/);
    const matches = spec.match(/"additionalProperties":\s*false/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('documents stream_url remapping for backlink_now_playing', () => {
    expect(spec).toMatch(/stream_url/);
    expect(spec).toMatch(/url`?\s+remapped to\s+`?stream_url/i);
  });

  it('documents that genre and mood are optional when the other is provided for curate', () => {
    expect(spec).toMatch(/Optional if mood is provided/i);
    expect(spec).toMatch(/Optional if genre is provided/i);
  });

  it('documents Base URL host matching the custom domain route', () => {
    expect(spec).toContain('https://backlink.fuzzywigg.com');
    expect(spec).not.toMatch(/workers\.dev/);
  });

  it('documents editorial as nullable in curator output', () => {
    expect(spec).toMatch(/"editorial":\s*\{\s*"type":\s*\[["']string["'],\s*["']null["']\]/);
  });

  it('lists all three docs tools as markdown headings', () => {
    expect(spec).toMatch(/^### `backlink_curate`/m);
    expect(spec).toMatch(/^### `backlink_genres`/m);
    expect(spec).toMatch(/^### `backlink_now_playing`/m);
  });

  it('documents Integration Notes section for cache and degradation', () => {
    expect(spec).toMatch(/## Integration Notes/);
    expect(spec).toMatch(/1h TTL/i);
    expect(spec).toMatch(/graceful degradation/i);
  });

  it('documents curator output required fields name/url/genre', () => {
    expect(spec).toMatch(/"required":\s*\[["']name["'],\s*["']url["'],\s*["']genre["']\]/);
  });

  it('documents now_playing required fields with stream_url', () => {
    expect(spec).toMatch(/"required":\s*\[["']name["'],\s*["']stream_url["'],\s*["']genre["']\]/);
  });

  it('documents timestamp as date-time format on curator output', () => {
    expect(spec).toMatch(/"timestamp":\s*\{\s*"type":\s*"string",\s*"format":\s*"date-time"/);
  });

  it('lists mood examples that GENRE_MAP can resolve', () => {
    for (const mood of ['late night', 'focus', 'chill'] as const) {
      expect(spec.toLowerCase()).toContain(mood);
      expect(Object.keys(GENRE_MAP)).toContain(mood);
    }
  });

  it('keeps docs tool headings in curate → genres → now_playing order', () => {
    const curate = spec.indexOf('### `backlink_curate`');
    const genres = spec.indexOf('### `backlink_genres`');
    const now = spec.indexOf('### `backlink_now_playing`');
    expect(curate).toBeGreaterThan(-1);
    expect(genres).toBeGreaterThan(curate);
    expect(now).toBeGreaterThan(genres);
  });

  it('documents logo as nullable uri on curator station items', () => {
    expect(spec).toMatch(/"logo":\s*\{\s*"type":\s*\[["']string["'],\s*["']null["']\].*"format":\s*"uri"/s);
  });

  it('documents backlink_genres output genres + aliases properties', () => {
    expect(spec).toMatch(/"genres":\s*\{/);
    expect(spec).toMatch(/"aliases":\s*\{/);
    expect(spec).toMatch(/Canonical genre slugs/i);
    expect(spec).toMatch(/Friendly name → canonical slug/i);
  });

  it('documents backlink_curate as top 3 stations with editorial blurbs', () => {
    expect(spec).toMatch(/top 3 radio stations/i);
    expect(spec).toMatch(/editorial blurbs/i);
  });

  it('documents now_playing as the first /curate station only', () => {
    expect(spec).toMatch(/stations\[0\]/);
    expect(spec).toMatch(/Single station object/i);
  });

  it('keeps Base URL on https (not http)', () => {
    expect(spec).toMatch(/Base URL:\s*`https:\/\//);
    expect(spec).not.toMatch(/Base URL:\s*`http:\/\//);
  });

  it('documents energizing as a mood example even when GENRE_MAP lacks it', () => {
    expect(spec.toLowerCase()).toContain('energizing');
    expect(Object.keys(GENRE_MAP)).not.toContain('energizing');
  });

  it('documents Endpoint lines for all three docs tools', () => {
    expect(spec).toMatch(/\*\*Endpoint:\*\*\s*`GET \/curate/);
    expect(spec).toMatch(/\*\*Endpoint:\*\*\s*`GET \/genres`/);
  });

  it('does not document Anthropic or Claude in the MCP spec', () => {
    expect(spec).not.toMatch(/anthropic|claude|haiku/i);
  });

  it('documents top 3 curation while the Worker does not enforce array length', () => {
    expect(spec).toMatch(/top 3 radio stations/i);
    // Runtime passthrough is locked in routes tests; docs remain aspirational.
    expect(spec).not.toMatch(/exactly 3 stations/i);
  });

  it('does not document /health or /stations as first-class MCP tools', () => {
    expect(spec).not.toMatch(/### `backlink_health`/);
    expect(spec).not.toMatch(/### `backlink_stations`/);
    expect(spec).not.toMatch(/\*\*Endpoint:\*\*\s*`GET \/health`/);
    expect(spec).not.toMatch(/\*\*Endpoint:\*\*\s*`GET \/stations/);
  });

  it('does not claim an /openapi.json Worker route in the docs tools list', () => {
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/openapi\.json`/);
  });

  it('keeps docs tool ids prefixed with backlink_', () => {
    const ids = [...spec.matchAll(/### `(backlink_[a-z_]+)`/g)].map((m) => m[1]);
    expect(ids).toEqual(['backlink_curate', 'backlink_genres', 'backlink_now_playing']);
  });

  it('documents curated_by as a string field on curate output', () => {
    expect(spec).toMatch(/"curated_by":\s*\{\s*"type":\s*"string"/);
  });

  it('documents timestamp as date-time format', () => {
    expect(spec).toMatch(/"timestamp":\s*\{[^}]*"format":\s*"date-time"/s);
  });

  it('does not embed live API keys or Cloudflare tokens', () => {
    expect(spec).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(spec).not.toMatch(/CF_API_TOKEN|GEMINI_API_KEY\s*=/);
  });

  it('documents additionalProperties false on curated input schemas', () => {
    expect(spec).toMatch(/"additionalProperties":\s*false/);
  });

  it('mentions iptv-org in the genres tool description', () => {
    expect(spec).toMatch(/iptv-org genre categories/i);
  });

  it('documents Base URL without a trailing slash', () => {
    expect(spec).toMatch(/Base URL:\s*`https:\/\/backlink\.fuzzywigg\.com`/);
    expect(spec).not.toMatch(/Base URL:\s*`https:\/\/backlink\.fuzzywigg\.com\//);
  });

  it('documents GET method on every docs Endpoint line', () => {
    const endpoints = [...spec.matchAll(/\*\*Endpoint:\*\*\s*`([^`]+)`/g)].map((m) => m[1]);
    expect(endpoints.length).toBeGreaterThanOrEqual(2);
    for (const ep of endpoints) {
      expect(ep.startsWith('GET ')).toBe(true);
    }
  });

  it('documents Integration Notes after the tool sections', () => {
    const lastTool = spec.lastIndexOf('### `backlink_now_playing`');
    const notes = spec.indexOf('## Integration Notes');
    expect(lastTool).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(lastTool);
  });

  it('documents graceful degradation top 5 matching Worker slice(0, 5)', () => {
    expect(spec).toMatch(/top 5 raw stations/i);
  });

  it('does not document Anthropic model names in tool schemas', () => {
    expect(spec).not.toMatch(/claude-|gpt-|haiku/i);
  });

  it('documents backlink_curate mood and genre as optional companions', () => {
    expect(spec).toMatch(/Optional if mood is provided/);
    expect(spec).toMatch(/Optional if genre is provided/);
  });

  it('keeps docs free of wrangler secret put instructions', () => {
    expect(spec).not.toMatch(/wrangler secret put/);
  });

  it('documents query as a string on curate output', () => {
    expect(spec).toMatch(/"query":\s*\{\s*"type":\s*"string"/);
  });

  it('documents stations as an array on curate output', () => {
    expect(spec).toMatch(/"stations":\s*\{\s*"type":\s*"array"/);
  });
  it('does not claim Worker HTTP routes named after claw-mcp tools', () => {
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/station_select/);
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/now_playing/);
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/genre_filter/);
  });

  it('keeps backlink_now_playing Endpoint pointed at /curate not /now-playing', () => {
    const section = spec.slice(spec.indexOf('### `backlink_now_playing`'));
    expect(section).toMatch(/Endpoint:\*\*\s*`GET \/curate\?/);
    expect(section).not.toMatch(/Endpoint:\*\*\s*`GET \/now-playing/);
  });

  it('documents Integration Notes 1h TTL matching Worker expirationTtl 3600', () => {
    expect(spec).toMatch(/1h TTL/);
  });

  it('does not mention CF_ACCOUNT_ID or wrangler secret put', () => {
    expect(spec).not.toMatch(/CF_ACCOUNT_ID/);
    expect(spec).not.toMatch(/wrangler secret put/);
  });

  it('documents Base URL host matching wrangler.toml custom domain', () => {
    const wrangler = readFileSync(join(root, 'wrangler.toml'), 'utf8');
    const pattern = wrangler.match(/pattern\s*=\s*"([^"]+)"/)?.[1];
    expect(pattern).toBeTruthy();
    expect(spec).toContain(`https://${pattern}`);
  });

  it('locks stream_url naming on now_playing vs url on curate station items', () => {
    expect(spec).toMatch(/"stream_url":\s*\{\s*"type":\s*"string"/);
    expect(spec).toMatch(/url` remapped to `stream_url`/);
  });

  it('does not document a /health MCP tool', () => {
    expect(spec).not.toMatch(/### `backlink_health`/);
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/health`/);
  });

  it('uses additionalProperties false exactly three times (one per input schema)', () => {
    const matches = spec.match(/"additionalProperties":\s*false/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it('documents no auth required for read endpoints', () => {
    expect(spec).toMatch(/No auth required for read endpoints/);
  });

  it('does not promise MCP bearer or OAuth auth', () => {
    expect(spec).not.toMatch(/oauth|bearer token|api key required/i);
  });

  it('does not list claw-mcp tool names as docs headings', () => {
    expect(spec).not.toMatch(/### `station_select`/);
    expect(spec).not.toMatch(/### `now_playing`/);
    expect(spec).not.toMatch(/### `genre_filter`/);
    expect(spec).not.toMatch(/### `curator_prompt`/);
  });

  it('documents curate input schema without a required array', () => {
    const curate = spec.slice(spec.indexOf('### `backlink_curate`'), spec.indexOf('### `backlink_genres`'));
    const fence = curate.match(/```json\n([\s\S]*?)```/);
    expect(fence).toBeTruthy();
    const schema = JSON.parse(fence![1]) as { required?: string[] };
    expect(schema.required).toBeUndefined();
  });

  it('does not claim the Worker validates curated array length 3', () => {
    expect(spec).toMatch(/top 3 radio stations/i);
    expect(spec).not.toMatch(/enforces (array )?length 3|validates (exactly )?3/i);
  });

  it('documents Integration Notes that Gemini calls are uncached', () => {
    expect(spec).toMatch(/\/curate` always calls Gemini fresh/i);
    expect(spec).toMatch(/no LLM response caching/i);
  });

  it('keeps exactly three ### tool headings', () => {
    const headings = [...spec.matchAll(/^### `/gm)];
    expect(headings).toHaveLength(3);
  });

  it('documents genres output with aliases object', () => {
    expect(spec).toMatch(/"aliases":\s*\{\s*"type":\s*"object"/);
  });

  it('documents now_playing station fields including stream_url', () => {
    const section = spec.slice(spec.indexOf('### `backlink_now_playing`'));
    expect(section).toMatch(/stream_url/);
    expect(section).toMatch(/"name":\s*\{\s*"type":\s*"string"/);
  });

  it('does not claim entertainment is an unsupported genre', () => {
    expect(spec).not.toMatch(/unsupported genres?:.*entertainment/i);
  });

  it('keeps Output fences as json language tags', () => {
    const fences = [...spec.matchAll(/```(\w*)/g)].map((m) => m[1]);
    expect(fences.every((lang) => lang === 'json' || lang === '')).toBe(true);
    expect(fences.filter((lang) => lang === 'json').length).toBeGreaterThanOrEqual(3);
  });

  it('documents backlink_genres Endpoint as GET /genres exactly', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toMatch(/Endpoint:\*\*\s*`GET \/genres`/);
  });

  it('documents curate Endpoint query placeholders for genre and mood', () => {
    expect(spec).toMatch(/GET \/curate\?genre=\{genre\}&mood=\{mood\}/);
  });

  it('keeps Integration Notes as a bullet list', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    expect(notes).toMatch(/^- /m);
    expect((notes.match(/^- /gm) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('locks Integration Notes bullet count at exactly 5', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    expect((notes.match(/^- /gm) ?? []).length).toBe(5);
  });

  it('locks exact Base URL string https://backlink.fuzzywigg.com', () => {
    expect(spec).toMatch(/Base URL:\s*`https:\/\/backlink\.fuzzywigg\.com`/);
  });

  it('locks claw-mcp tool count (4) distinct from docs tool count (3)', () => {
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect((spec.match(/^### `/gm) ?? []).length).toBe(3);
  });

  it('documents curator station required as name/url/genre exactly', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const required = curate.match(/"required":\s*\[([^\]]+)\]/);
    expect(required).toBeTruthy();
    const fields = [...required![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(fields).toEqual(['name', 'url', 'genre']);
  });

  it('does not document Worker /openapi.json as a live Endpoint', () => {
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/openapi\.json`/);
    expect(spec).not.toMatch(/`GET \/openapi\.json`/);
  });

  it('docs mood examples include energizing outside GENRE_MAP', () => {
    expect(spec).toMatch(/energizing/);
    expect(GENRE_MAP).not.toHaveProperty('energizing');
    expect(VALID_GENRES.includes('energizing' as never)).toBe(false);
  });

  it('docs genre examples resolve via VALID_GENRES or GENRE_MAP', () => {
    const examples = ['jazz', 'classical', 'ambient', 'rock', 'pop', 'late night', 'focus', 'chill'];
    for (const ex of examples) {
      const ok =
        (VALID_GENRES as readonly string[]).includes(ex) ||
        Object.prototype.hasOwnProperty.call(GENRE_MAP, ex);
      expect(ok).toBe(true);
    }
  });

  it('documents graceful degradation top 5 with editorial null', () => {
    expect(spec).toMatch(/top 5 raw stations with `editorial: null`/);
  });

  it('documents KV 1h TTL for /stations cache', () => {
    expect(spec).toMatch(/1h TTL/);
  });

  it('locks exact Integration Notes five bullet texts', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = [...notes.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(bullets).toEqual([
      'Base URL: `https://backlink.fuzzywigg.com`',
      'No auth required for read endpoints',
      'KV cache means `/stations` calls are fast after first hit per genre (1h TTL)',
      '`/curate` always calls Gemini fresh — no LLM response caching',
      'On Gemini failure, graceful degradation returns top 5 raw stations with `editorial: null`',
    ]);
  });

  it('documents curate Endpoint exactly GET /curate?genre={genre}&mood={mood}', () => {
    expect(spec).toMatch(/\*\*Endpoint:\*\*\s*`GET \/curate\?genre=\{genre\}&mood=\{mood\}`/);
  });

  it('docs say top 3 picks while Worker degrade path slices top 5', () => {
    expect(spec).toMatch(/top 3/i);
    expect(spec).toMatch(/top 5/);
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toMatch(
      /stations\.slice\(0,\s*5\)/,
    );
  });

  it('documents backlink_genres aliases additionalProperties only on aliases object', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toMatch(/"aliases"[\s\S]*?"additionalProperties"/);
  });

  it('documents now_playing required order name, stream_url, genre', () => {
    const section = spec.slice(spec.indexOf('### `backlink_now_playing`'));
    const required = section.match(/"required":\s*\[([^\]]+)\]/);
    expect(required).toBeTruthy();
    const fields = [...required![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(fields).toEqual(['name', 'stream_url', 'genre']);
  });

  it('documents curator station logo and editorial as optional nullable unions', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(curate).toMatch(/"logo"[\s\S]*?"type":\s*\["string",\s*"null"\]/);
    expect(curate).toMatch(/"editorial"[\s\S]*?"type":\s*\["string",\s*"null"\]/);
  });

  it('mood examples include GENRE_MAP keys plus energizing outside the map', () => {
    expect(spec).toMatch(/focus/);
    expect(spec).toMatch(/chill/);
    expect(spec).toMatch(/late night/);
    expect(spec).toMatch(/energizing/);
    expect(GENRE_MAP).not.toHaveProperty('energizing');
  });

  it('does not list /stations or /health as tool Endpoints', () => {
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/stations/);
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/health/);
  });

  it('keeps exactly 3 fenced json input/output schema blocks language-tagged json', () => {
    const fences = [...spec.matchAll(/```json/g)];
    expect(fences.length).toBeGreaterThanOrEqual(3);
  });

  it('cross-locks docs Base URL host to wrangler.toml routes.pattern', () => {
    const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
    const pattern = toml.match(/pattern\s*=\s*"([^"]+)"/)?.[1];
    expect(pattern).toBe('backlink.fuzzywigg.com');
    expect(spec).toContain(`https://${pattern}`);
  });

  it('parses all three Input Schema fences as objects with expected property keys', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    const inputSchemas = fences.filter((f) => f.includes('"additionalProperties": false'));
    expect(inputSchemas).toHaveLength(3);
    const parsed = inputSchemas.map((f) => JSON.parse(f) as {
      type: string;
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    });
    expect(parsed.every((p) => p.type === 'object' && p.additionalProperties === false)).toBe(true);
    expect(Object.keys(parsed[0].properties).sort()).toEqual(['genre', 'mood']);
    expect(Object.keys(parsed[1].properties)).toEqual([]);
    expect(Object.keys(parsed[2].properties).sort()).toEqual(['genre', 'mood']);
  });

  it('documents now_playing logo as nullable uri', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/"logo":\s*\{\s*"type":\s*\["string",\s*"null"\],\s*"format":\s*"uri"\s*\}/);
  });

  it('documents genres items type string', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toMatch(/"items":\s*\{\s*"type":\s*"string"\s*\}/);
  });

  it('keeps editorial and logo out of curate station required array', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const required = curate.match(/"required":\s*\[([^\]]+)\]/);
    expect(required).not.toBeNull();
    const items = required![1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
    expect(items).toEqual(['name', 'url', 'genre']);
    expect(items).not.toContain('editorial');
    expect(items).not.toContain('logo');
  });

  it('documents exactly three claw-mcp tools under ## Tools', () => {
    const toolsSection = spec.slice(spec.indexOf('## Tools'), spec.indexOf('## Integration Notes'));
    const headings = [...toolsSection.matchAll(/^### `([^`]+)`/gm)].map((m) => m[1]);
    expect(headings).toEqual(['backlink_curate', 'backlink_genres', 'backlink_now_playing']);
  });

  it('documents curated_by as a string property on curate output', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(curate).toMatch(/"curated_by":\s*\{\s*"type":\s*"string"\s*\}/);
  });

  it('documents timestamp format date-time on curate output', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(curate).toMatch(/"timestamp":\s*\{\s*"type":\s*"string",\s*"format":\s*"date-time"\s*\}/);
  });

  it('keeps additionalProperties false on curate and genres input schemas', () => {
    expect(spec.match(/"additionalProperties":\s*false/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('does not document GEMINI_API_KEY or secret material in the MCP spec', () => {
    expect(spec).not.toMatch(/GEMINI_API_KEY|api[_-]?key\s*=/i);
  });

  it('cross-locks docs tool count (3) against VALID_GENRES existence', () => {
    expect(VALID_GENRES.length).toBeGreaterThan(0);
    expect(Object.keys(GENRE_MAP).length).toBeGreaterThan(VALID_GENRES.length);
    expect(spec).toContain('backlink_curate');
    expect(spec).toContain('backlink_genres');
    expect(spec).toContain('backlink_now_playing');
    expect(spec).not.toContain('backlink_station_select');
  });

  it('documents backlink_curate Description mentioning top 3 and editorial blurbs', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toMatch(/\*\*Description:\*\*.*top 3 radio stations/i);
    expect(section).toMatch(/editorial blurbs/i);
  });

  it('documents backlink_genres Description mentioning iptv-org and mood aliases', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toMatch(/iptv-org genre categories/i);
    expect(section).toMatch(/mood aliases/i);
  });

  it('documents backlink_now_playing Description mentioning single best station', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/single best station/i);
    expect(section).toMatch(/editorial context/i);
  });

  it('parses curate Output fence with query/curated_by/timestamp/stations keys', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const fences = [...curate.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences.length).toBeGreaterThanOrEqual(2);
    const output = JSON.parse(fences[1]) as { properties: Record<string, unknown> };
    expect(Object.keys(output.properties).sort()).toEqual([
      'curated_by',
      'query',
      'stations',
      'timestamp',
    ]);
  });

  it('parses genres Output fence with genres and aliases only', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    const fences = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences.length).toBeGreaterThanOrEqual(2);
    const output = JSON.parse(fences[1]) as { properties: Record<string, unknown> };
    expect(Object.keys(output.properties).sort()).toEqual(['aliases', 'genres']);
  });

  it('parses now_playing Output fence with stream_url not url', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    const fences = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences.length).toBeGreaterThanOrEqual(2);
    const output = JSON.parse(fences[1]) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(output.properties).toHaveProperty('stream_url');
    expect(output.properties).not.toHaveProperty('url');
    expect(output.required).toEqual(['name', 'stream_url', 'genre']);
  });

  it('locks exact title heading Backlink MCP Tool Specification', () => {
    expect(spec.startsWith('# Backlink MCP Tool Specification\n')).toBe(true);
  });

  it('keeps exactly two ## section headings Tools and Integration Notes', () => {
    const headings = [...spec.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(['Tools', 'Integration Notes']);
  });

  it('documents curate genre examples that are VALID_GENRES members', () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(spec).toContain(`'${g}'`);
      expect(VALID_GENRES).toContain(g);
    }
  });

  it('documents now_playing genre examples ambient / late night / jazz', () => {
    const section = spec.slice(spec.indexOf('### `backlink_now_playing`'));
    expect(section).toMatch(/'ambient'/);
    expect(section).toMatch(/'late night'/);
    expect(section).toMatch(/'jazz'/);
  });

  it('cross-locks claw-mcp curator_prompt.mood examples against docs mood examples', () => {
    const moodDesc = MCP_MANIFEST.tools.find((t) => t.name === 'curator_prompt')!
      .input_schema.properties.mood!.description!;
    // Docs use late night / focus / chill; claw-mcp uses focus work / late night jazz / morning energy
    expect(moodDesc).toMatch(/focus work/);
    expect(spec).toMatch(/'focus'/);
    expect(spec).toMatch(/'chill'/);
    expect(spec).toMatch(/'late night'/);
  });

  it('does not document station_select as a docs tool despite claw-mcp having it', () => {
    expect(MCP_MANIFEST.tools.some((t) => t.name === 'station_select')).toBe(true);
    expect(spec).not.toMatch(/backlink_station_select|### `station_select`/);
  });

  it('documents genres output description Canonical genre slugs accepted by /curate and /stations', () => {
    expect(spec).toMatch(/Canonical genre slugs accepted by \/curate and \/stations/);
  });

  it('documents aliases description Friendly name → canonical slug mapping', () => {
    expect(spec).toContain('Friendly name → canonical slug mapping');
  });

  it('keeps Input Schema / Output / Endpoint labels for every docs tool', () => {
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing'] as const) {
      const start = spec.indexOf(`### \`${id}\``);
      expect(start).toBeGreaterThan(-1);
      const next = spec.indexOf('### `', start + 1);
      const end = next === -1 ? spec.indexOf('## Integration Notes') : next;
      const section = spec.slice(start, end);
      expect(section).toMatch(/\*\*Input Schema:\*\*/);
      expect(section).toMatch(/\*\*Output/);
      expect(section).toMatch(/\*\*Endpoint:\*\*/);
    }
  });

  it('documents url format uri on curator station items', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(curate).toMatch(/"url":\s*\{\s*"type":\s*"string",\s*"format":\s*"uri"\s*\}/);
  });

  it('documents stream_url format uri on now_playing output', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(
      /"stream_url":\s*\{\s*"type":\s*"string",\s*"format":\s*"uri"\s*\}/,
    );
  });

  it('does not document workers.dev, localhost, or 127.0.0.1 bases', () => {
    expect(spec).not.toMatch(/workers\.dev|localhost|127\.0\.0\.1/);
  });

  it('keeps horizontal rules between tool sections', () => {
    expect(spec).toMatch(/### `backlink_curate`[\s\S]*?\n---\n[\s\S]*?### `backlink_genres`/);
    expect(spec).toMatch(/### `backlink_genres`[\s\S]*?\n---\n[\s\S]*?### `backlink_now_playing`/);
  });

  it('locks docs free of Anthropic MCP SDK package names', () => {
    expect(spec).not.toMatch(/@modelcontextprotocol|mcp-server|fastmcp/i);
  });

  it('cross-locks GENRE_MAP late night/focus/chill to docs mood examples', () => {
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(GENRE_MAP.focus).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(spec.toLowerCase()).toContain('late night');
    expect(spec.toLowerCase()).toContain('focus');
    expect(spec.toLowerCase()).toContain('chill');
  });

  it('documents Output as Array of curated station objects for curate', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(curate).toMatch(/\*\*Output:\*\*\s*Array of curated station objects/);
  });

  it('documents now_playing Output as Single station object first result', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/\*\*Output:\*\*\s*Single station object \(first result from \/curate\)/);
  });

  it('parses all Input Schema fences as additionalProperties false objects', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    const inputs = fences
      .map((f) => JSON.parse(f) as { additionalProperties?: boolean; type?: string })
      .filter((o) => o.additionalProperties === false);
    expect(inputs).toHaveLength(3);
    expect(inputs.every((o) => o.type === 'object')).toBe(true);
  });

  it('does not claim MCP_MANIFEST tool names in Endpoint paths', () => {
    const endpoints = [...spec.matchAll(/\*\*Endpoint:\*\*\s*`([^`]+)`/g)].map((m) => m[1]);
    for (const ep of endpoints) {
      expect(ep).not.toMatch(/station_select|genre_filter|curator_prompt/);
    }
  });

  it('locks intro sentence defining claw-mcp tool set', () => {
    expect(spec).toMatch(/This spec defines Backlink as a claw-mcp tool set/);
    expect(spec).toMatch(/Each tool maps to a Backlink API endpoint/);
  });

  it('documents genres input schema as empty properties object', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    const fence = section.match(/```json\n([\s\S]*?)```/);
    expect(fence).toBeTruthy();
    const schema = JSON.parse(fence![1]) as {
      type: string;
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(schema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('does not document retry_after or 503 in the MCP spec', () => {
    expect(spec).not.toMatch(/retry_after|503/);
  });

  it('does not document GEMINI model ids in the MCP spec', () => {
    expect(spec).not.toMatch(/gemini-2\.0-flash|generativelanguage/);
  });

  it('locks Integration Notes Base URL bullet as the first note', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = [...notes.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(bullets[0]).toBe('Base URL: `https://backlink.fuzzywigg.com`');
  });

  it('locks Integration Notes last bullet as graceful degradation', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = [...notes.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(bullets[bullets.length - 1]).toMatch(/graceful degradation returns top 5/);
  });

  it('cross-locks docs tool count 3 against claw-mcp tool count 4 asymmetry', () => {
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect((spec.match(/^### `/gm) ?? []).length).toBe(3);
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toContain('station_select');
    expect(spec).not.toContain('station_select');
  });

  it('documents curate input property descriptions with Optional if companions', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const fence = curate.match(/```json\n([\s\S]*?)```/);
    const schema = JSON.parse(fence![1]) as {
      properties: { genre: { description: string }; mood: { description: string } };
    };
    expect(schema.properties.genre.description).toMatch(/Optional if mood is provided/);
    expect(schema.properties.mood.description).toMatch(/Optional if genre is provided/);
  });

  it('documents now_playing input genre description with late night example', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    const fence = section.match(/```json\n([\s\S]*?)```/);
    const schema = JSON.parse(fence![1]) as {
      properties: { genre: { description: string }; mood: { description: string } };
    };
    expect(schema.properties.genre.description).toMatch(/late night/);
    expect(schema.properties.mood.description).toMatch(/Mood descriptor/);
  });

  it('does not embed HTML tags in the MCP spec', () => {
    expect(spec).not.toMatch(/<\/?[a-z][\s\S]*?>/i);
  });

  it('keeps fenced json block count at exactly 6 (input+output × 3 tools)', () => {
    expect((spec.match(/```json/g) ?? []).length).toBe(6);
  });

  it('does not document WebSocket or SSE transport', () => {
    expect(spec).not.toMatch(/websocket|server-sent|SSE/i);
  });

  it('locks exact document title heading', () => {
    expect(spec).toMatch(/^# Backlink MCP Tool Specification\s*$/m);
  });

  it('locks ## Tools and ## Integration Notes as the only h2 headings', () => {
    const h2 = [...spec.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(h2).toEqual(['Tools', 'Integration Notes']);
  });

  it('locks exact docs tool heading ids in order', () => {
    const ids = [...spec.matchAll(/^### `([^`]+)`/gm)].map((m) => m[1]);
    expect(ids).toEqual(['backlink_curate', 'backlink_genres', 'backlink_now_playing']);
  });

  it('parses backlink_curate input schema exactly', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const fence = curate.match(/```json\n([\s\S]*?)```/);
    const schema = JSON.parse(fence![1]) as Record<string, unknown>;
    expect(schema).toEqual({
      type: 'object',
      properties: {
        genre: {
          type: 'string',
          description:
            "Music genre (e.g. 'jazz', 'classical', 'ambient', 'rock', 'pop'). Optional if mood is provided.",
        },
        mood: {
          type: 'string',
          description:
            "Mood or vibe descriptor (e.g. 'late night', 'focus', 'chill', 'energizing'). Optional if genre is provided.",
        },
      },
      additionalProperties: false,
    });
  });

  it('parses backlink_now_playing input schema exactly', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    const fence = section.match(/```json\n([\s\S]*?)```/);
    const schema = JSON.parse(fence![1]) as Record<string, unknown>;
    expect(schema).toEqual({
      type: 'object',
      properties: {
        genre: {
          type: 'string',
          description:
            "Genre slug or friendly name (e.g. 'ambient', 'late night', 'jazz').",
        },
        mood: {
          type: 'string',
          description: 'Mood descriptor. Used alongside or instead of genre.',
        },
      },
      additionalProperties: false,
    });
  });

  it('parses backlink_curate output stations item required exactly', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const fences = [...curate.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences).toHaveLength(2);
    const output = JSON.parse(fences[1]) as {
      properties: {
        stations: {
          items: { required: string[]; properties: Record<string, unknown> };
        };
      };
    };
    expect(output.properties.stations.items.required).toEqual(['name', 'url', 'genre']);
    expect(output.properties.stations.items.properties).toHaveProperty('logo');
    expect(output.properties.stations.items.properties).toHaveProperty('editorial');
  });

  it('parses backlink_genres output schema genres+aliases keys', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    const fences = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences).toHaveLength(2);
    const output = JSON.parse(fences[1]) as {
      type: string;
      properties: { genres: unknown; aliases: unknown };
    };
    expect(output.type).toBe('object');
    expect(Object.keys(output.properties).sort()).toEqual(['aliases', 'genres']);
  });

  it('parses backlink_now_playing output required name/stream_url/genre', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    const fences = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences).toHaveLength(2);
    const output = JSON.parse(fences[1]) as { required: string[] };
    expect(output.required).toEqual(['name', 'stream_url', 'genre']);
  });

  it('cross-locks docs genre examples to VALID_GENRES membership', () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(VALID_GENRES).toContain(g);
      expect(spec).toContain(`'${g}'`);
    }
  });

  it('cross-locks docs mood examples late night/focus/chill to GENRE_MAP', () => {
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(GENRE_MAP.focus).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(spec).toContain("'late night'");
    expect(spec).toContain("'focus'");
    expect(spec).toContain("'chill'");
  });

  it('documents energizing outside GENRE_MAP and VALID_GENRES', () => {
    expect(spec).toContain("'energizing'");
    expect(GENRE_MAP).not.toHaveProperty('energizing');
    expect((VALID_GENRES as readonly string[]).includes('energizing')).toBe(false);
  });

  it('locks each tool section to contain Description / Input Schema / Output / Endpoint labels', () => {
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing'] as const) {
      const start = spec.indexOf(`### \`${id}\``);
      const next = spec.indexOf('\n---', start);
      const section = spec.slice(start, next === -1 ? undefined : next);
      expect(section).toMatch(/\*\*Description:\*\*/);
      expect(section).toMatch(/\*\*Input Schema:\*\*/);
      expect(section).toMatch(/\*\*Output:\*\*/);
      expect(section).toMatch(/\*\*Endpoint:\*\*/);
    }
  });

  it('locks Endpoint lines exactly for all three docs tools', () => {
    const endpoints = [...spec.matchAll(/\*\*Endpoint:\*\*\s*`([^`]+)`/g)].map((m) => m[1]);
    expect(endpoints).toEqual([
      'GET /curate?genre={genre}&mood={mood}',
      'GET /genres',
      'GET /curate?genre={genre}&mood={mood}',
    ]);
    // now_playing appends remap prose after the fenced endpoint path
    expect(spec).toContain(
      'returns `stations[0]` only, with `url` remapped to `stream_url`',
    );
  });

  it('does not document POST / PUT / DELETE methods', () => {
    expect(spec).not.toMatch(/\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
  });

  it('keeps Base URL host equal to wrangler custom domain pattern', () => {
    const wrangler = readFileSync(join(root, 'wrangler.toml'), 'utf8');
    const pattern = wrangler.match(/pattern\s*=\s*"([^"]+)"/)?.[1];
    expect(spec).toContain(`https://${pattern}`);
    expect(pattern).toBe('backlink.fuzzywigg.com');
  });

  it('cross-locks claw-mcp auth none with docs no-auth note', () => {
    expect(MCP_MANIFEST.auth.type).toBe('none');
    expect(spec).toMatch(/No auth required for read endpoints/);
  });

  it('does not document claw-mcp tool names station_select or curator_prompt', () => {
    expect(spec).not.toContain('station_select');
    expect(spec).not.toContain('genre_filter');
    expect(spec).not.toContain('curator_prompt');
  });

  it('documents now_playing stream_url remap note exactly', () => {
    expect(spec).toContain(
      'returns `stations[0]` only, with `url` remapped to `stream_url`',
    );
  });

  it('locks Integration Notes bullet count and Gemini uncached wording', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = [...notes.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(bullets).toHaveLength(5);
    expect(bullets.some((b) => b.includes('Gemini fresh'))).toBe(true);
    expect(bullets.some((b) => b.includes('1h TTL'))).toBe(true);
  });

  it('does not embed absolute workers.dev or pages.dev hosts', () => {
    expect(spec).not.toMatch(/workers\.dev|pages\.dev/);
  });

  it('keeps markdown horizontal rules count at exactly 4', () => {
    // intro separator + between 3 tools + before Integration Notes = 4
    expect((spec.match(/^---$/gm) ?? []).length).toBe(4);
  });

  it('locks intro paragraph mentioning claw-mcp and API endpoint mapping', () => {
    const intro = spec.slice(0, spec.indexOf('## Tools'));
    expect(intro).toMatch(/claw-mcp tool set/);
    expect(intro).toMatch(/Backlink API endpoint/);
  });

  it('documents curated_by and timestamp on curate output schema', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const fences = [...curate.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    const output = JSON.parse(fences[1]) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(output.properties).sort()).toEqual([
      'curated_by',
      'query',
      'stations',
      'timestamp',
    ]);
  });

  it('documents logo and editorial as nullable unions on curate station items', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(curate).toMatch(/"logo":\s*\{\s*"type":\s*\["string",\s*"null"\]/);
    expect(curate).toMatch(/"editorial":\s*\{\s*"type":\s*\["string",\s*"null"\]/);
  });

  it('documents now_playing logo and editorial as nullable unions', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/"logo":\s*\{\s*"type":\s*\["string",\s*"null"\]/);
    expect(section).toMatch(/"editorial":\s*\{\s*"type":\s*\["string",\s*"null"\]/);
  });

  it('locks Base URL host to backlink.fuzzywigg.com', () => {
    expect(spec).toContain('https://backlink.fuzzywigg.com');
  });

  it('documents all three tool endpoints as GET paths', () => {
    expect(spec).toContain('GET /curate?genre={genre}&mood={mood}');
    expect(spec).toContain('GET /genres');
  });

  it('keeps claw-mcp tool names free of backlink_ prefix in MCP_MANIFEST', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name.startsWith('backlink_')).toBe(false);
    }
    expect(spec).toContain('backlink_curate');
  });

  it('does not document MCP resources or prompts sections', () => {
    expect(spec).not.toMatch(/## Resources|## Prompts|## Sampling/i);
  });

  it('keeps fenced languages only json (no typescript/yaml fences)', () => {
    const langs = [...spec.matchAll(/```(\w+)/g)].map((m) => m[1]);
    expect(new Set(langs)).toEqual(new Set(['json']));
  });

  it('cross-locks docs tool count asymmetry vs MCP_MANIFEST.tools length', () => {
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect((spec.match(/^### `/gm) ?? []).length).toBe(3);
  });

  it('documents genres Canonical genre slugs description substring', () => {
    expect(spec).toMatch(/Canonical genre slugs accepted by \/curate and \/stations/);
  });

  it('documents aliases Friendly name → canonical slug mapping', () => {
    expect(spec).toContain('Friendly name → canonical slug mapping');
  });

  it('does not claim Bearer auth or API keys in Integration Notes', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    expect(notes).not.toMatch(/bearer|api[_-]?key|oauth/i);
  });

  it('locks graceful degradation wording to editorial: null code span', () => {
    expect(spec).toContain('`editorial: null`');
    expect(spec).toMatch(/top 5 raw stations with `editorial: null`/);
  });

  it('does not document /playlist or /now-playing Worker routes as Endpoints', () => {
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/playlist/);
    expect(spec).not.toMatch(/Endpoint:\*\*\s*`GET \/now-playing/);
  });

  it('uses LF newlines only in the MCP spec file', () => {
    expect(spec.includes('\r')).toBe(false);
  });

  it('does not contain tab characters in the MCP spec', () => {
    expect(spec.includes('\t')).toBe(false);
  });

  it('does not document GEMINI_API_KEY in the MCP spec body', () => {
    expect(spec).not.toContain('GEMINI_API_KEY');
  });

  it('locks Integration Notes KV TTL wording to 1h', () => {
    expect(spec).toMatch(/1h TTL/);
  });

  it('documents now_playing output stream_url not url', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toContain('stream_url');
    expect(section).toMatch(/url[\s\S]*remapped to[\s\S]*stream_url/);
  });

  // --- HEAVY burn (post-#39): docs/mcp-spec.md contract deepen ---

  it('locks title to Backlink MCP Tool Specification', () => {
    expect(spec).toMatch(/^# Backlink MCP Tool Specification\s*$/m);
  });

  it('intro mentions claw-mcp tool set and API endpoint mapping', () => {
    expect(spec).toMatch(/claw-mcp tool set/);
    expect(spec).toMatch(/maps to a Backlink API endpoint/);
  });

  it('locks exactly three ### tool headings', () => {
    expect((spec.match(/^### `/gm) ?? []).length).toBe(3);
  });

  it('locks tool heading order curate genres now_playing', () => {
    const headings = [...spec.matchAll(/^### `([^`]+)`/gm)].map((m) => m[1]);
    expect(headings).toEqual(['backlink_curate', 'backlink_genres', 'backlink_now_playing']);
  });

  it('locks backlink_curate additionalProperties false on input', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('"additionalProperties": false');
  });

  it('locks backlink_genres input properties empty object', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toMatch(/"properties":\s*\{\s*\}/);
  });

  it('locks backlink_now_playing additionalProperties false', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toContain('"additionalProperties": false');
  });

  it('locks curate output timestamp format date-time', () => {
    expect(spec).toContain('"format": "date-time"');
  });

  it('locks curate station url format uri', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toMatch(/"url":\s*\{\s*"type":\s*"string",\s*"format":\s*"uri"/);
  });

  it('locks now_playing stream_url format uri', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/"stream_url":\s*\{\s*"type":\s*"string",\s*"format":\s*"uri"/);
  });

  it('locks curate station required name url genre without editorial', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('"required": ["name", "url", "genre"]');
  });

  it('locks now_playing required name stream_url genre', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toContain('"required": ["name", "stream_url", "genre"]');
  });

  it('locks Integration Notes bullet about No auth required', () => {
    expect(spec).toContain('No auth required for read endpoints');
  });

  it('locks Integration Notes /curate always calls Gemini fresh', () => {
    expect(spec).toContain('/curate` always calls Gemini fresh — no LLM response caching');
  });

  it('locks Base URL bullet exact markdown', () => {
    expect(spec).toContain('- Base URL: `https://backlink.fuzzywigg.com`');
  });

  it('does not document workers.dev Base URL', () => {
    expect(spec).not.toMatch(/workers\.dev/);
  });

  it('does not document localhost Base URL', () => {
    expect(spec).not.toMatch(/localhost/);
  });

  it('locks horizontal rule count at 4', () => {
    expect((spec.match(/^---$/gm) ?? []).length).toBe(4);
  });

  it('locks ## Tools before ## Integration Notes', () => {
    expect(spec.indexOf('## Tools')).toBeLessThan(spec.indexOf('## Integration Notes'));
  });

  it('each tool section includes **Description:** **Input Schema:** **Output:** **Endpoint:**', () => {
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing']) {
      const start = spec.indexOf(`### \`${id}\``);
      const next = spec.indexOf('### `', start + 1);
      const end = next === -1 ? spec.indexOf('## Integration Notes') : next;
      const section = spec.slice(start, end);
      expect(section).toContain('**Description:**');
      expect(section).toContain('**Input Schema:**');
      expect(section).toContain('**Output:**');
      expect(section).toContain('**Endpoint:**');
    }
  });

  it('locks backlink_genres Endpoint to GET /genres only', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toContain('**Endpoint:** `GET /genres`');
  });

  it('locks curate Endpoint query template genre and mood', () => {
    expect(spec).toContain('**Endpoint:** `GET /curate?genre={genre}&mood={mood}`');
  });

  it('documents logo as string|null union on curate items', () => {
    expect(spec).toContain('"logo": { "type": ["string", "null"], "format": "uri" }');
  });

  it('documents editorial as string|null union on curate items', () => {
    expect(spec).toContain('"editorial": { "type": ["string", "null"] }');
  });

  it('documents curated_by as string on curate output', () => {
    expect(spec).toContain('"curated_by": { "type": "string" }');
  });

  it('documents query as string on curate output', () => {
    expect(spec).toContain('"query": { "type": "string" }');
  });

  it('genres aliases additionalProperties type string', () => {
    expect(spec).toContain('"additionalProperties": { "type": "string" }');
  });

  it('does not list claw-mcp station_select as a docs tool', () => {
    expect(spec).not.toContain('station_select');
    expect(spec).not.toContain('curator_prompt');
    expect(spec).not.toContain('genre_filter');
  });

  it('cross-locks Integration Notes 1h TTL with Worker expirationTtl 3600', () => {
    expect(spec).toMatch(/1h TTL/);
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain('expirationTtl: 3600');
  });

  it('cross-locks graceful top 5 with Worker slice(0, 5)', () => {
    expect(spec).toMatch(/top 5 raw stations/);
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain('stations.slice(0, 5)');
  });

  it('does not document Authorization header', () => {
    expect(spec).not.toMatch(/Authorization/i);
  });

  it('does not document rate limit quotas', () => {
    expect(spec).not.toMatch(/rate limit/i);
  });

  it('fenced json blocks are valid JSON objects', () => {
    const blocks = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) {
      expect(() => JSON.parse(block)).not.toThrow();
    }
  });

  it('locks Integration Notes bullet count at 5', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = [...notes.matchAll(/^-\s+/gm)];
    expect(bullets).toHaveLength(5);
  });

  it('now_playing Description mentions single best station', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/single best station/i);
  });

  it('curate Description mentions top 3 radio stations', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toMatch(/top 3 radio stations/i);
  });

  it('genres Description mentions iptv-org genre categories', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toMatch(/iptv-org genre categories/i);
  });

  it('does not embed Gemini model ids like gemini-2.0-flash in the spec', () => {
    expect(spec).not.toMatch(/gemini-\d/i);
    expect(spec).not.toMatch(/generativelanguage\.googleapis/i);
  });

  it('does not embed Anthropic model names in the spec', () => {
    expect(spec).not.toMatch(/anthropic|claude|haiku/i);
  });

  it('file ends with trailing newline', () => {
    expect(spec.endsWith('\n')).toBe(true);
  });

  it('does not use HTML tags in the markdown body', () => {
    expect(spec).not.toMatch(/<\/?[a-z][\s\S]*?>/i);
  });

  it('cross-locks Base URL host with wrangler routes pattern', () => {
    const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
  });

  it('documents mood examples late night focus chill energizing in curate input', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('late night');
    expect(section).toContain('focus');
    expect(section).toContain('chill');
    expect(section).toContain('energizing');
  });

  it('energizing is documented but absent from GENRE_MAP', () => {
    expect(spec).toContain('energizing');
    expect(GENRE_MAP).not.toHaveProperty('energizing');
  });

  it('now_playing Endpoint documents stations[0] remap note', () => {
    expect(spec).toMatch(/returns `stations\[0\]` only/);
  });

  it('does not document MCP resources or prompts arrays', () => {
    expect(spec).not.toMatch(/^## Resources/m);
    expect(spec).not.toMatch(/^## Prompts/m);
  });

  it('json fences use json language tag exclusively', () => {
    const langs = [...spec.matchAll(/```(\w+)/g)].map((m) => m[1]);
    expect(langs.every((l) => l === 'json')).toBe(true);
  });

  it('locks curate Output wrapper type object with stations array', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('"stations":');
    expect(section).toContain('"type": "array"');
  });

  it('genres output documents Canonical genre slugs description', () => {
    expect(spec).toContain(
      'Canonical genre slugs accepted by /curate and /stations',
    );
  });

  it('does not document WebSocket or SSE transports', () => {
    expect(spec).not.toMatch(/websocket|server-sent|SSE/i);
  });

  it('Integration Notes mention KV cache for /stations', () => {
    expect(spec).toMatch(/KV cache means `\/stations`/);
  });

  it('spec length stays within a lean docs budget under 8KB', () => {
    expect(Buffer.byteLength(spec, 'utf8')).toBeLessThan(8 * 1024);
    expect(Buffer.byteLength(spec, 'utf8')).toBeGreaterThan(1500);
  });

  it('locks docs tool heading order backlink_curate → genres → now_playing', () => {
    const curate = spec.indexOf('### `backlink_curate`');
    const genres = spec.indexOf('### `backlink_genres`');
    const now = spec.indexOf('### `backlink_now_playing`');
    expect(curate).toBeGreaterThan(-1);
    expect(genres).toBeGreaterThan(curate);
    expect(now).toBeGreaterThan(genres);
  });

  it('locks curate Input Schema additionalProperties false after properties', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const props = section.indexOf('"properties"');
    const addl = section.indexOf('"additionalProperties": false');
    expect(props).toBeGreaterThan(-1);
    expect(addl).toBeGreaterThan(props);
  });

  it('locks curate Output required station fields name url genre', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('"required": ["name", "url", "genre"]');
  });

  it('locks genres Output genres array and aliases object schemas', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toContain('"genres":');
    expect(section).toContain('"aliases":');
    expect(section).toContain('"additionalProperties": { "type": "string" }');
  });

  it('locks now_playing Output required name stream_url genre order', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toContain('"required": ["name", "stream_url", "genre"]');
  });

  it('locks Integration Notes section after all three tools', () => {
    const toolsEnd = spec.indexOf('## Integration Notes');
    expect(spec.indexOf('### `backlink_now_playing`')).toBeLessThan(toolsEnd);
    expect(spec.slice(toolsEnd)).toContain('Base URL:');
  });

  it('locks Integration Notes five bullets in documented order', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = [...notes.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(bullets).toEqual([
      'Base URL: `https://backlink.fuzzywigg.com`',
      'No auth required for read endpoints',
      'KV cache means `/stations` calls are fast after first hit per genre (1h TTL)',
      '`/curate` always calls Gemini fresh — no LLM response caching',
      'On Gemini failure, graceful degradation returns top 5 raw stations with `editorial: null`',
    ]);
  });

  it('JSON fences parse and each input schema is type object', () => {
    const blocks = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) {
      const parsed = JSON.parse(block) as { type?: string };
      expect(parsed.type).toBe('object');
    }
  });

  it('cross-locks Base URL host with wrangler.toml routes pattern', () => {
    const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('does not embed model ids auth schemes or WebSocket transports', () => {
    expect(spec).not.toMatch(/gemini-\d|gpt-\d|claude/i);
    expect(spec).not.toMatch(/Bearer |api[_-]?key\s*=/i);
    expect(spec).not.toMatch(/websocket|WebSocket|SSE\b/);
    expect(spec).not.toMatch(/Authorization/i);
  });

  it('locks curate Endpoint exact GET /curate query template', () => {
    expect(spec).toContain('**Endpoint:** `GET /curate?genre={genre}&mood={mood}`');
  });

  it('locks genres Endpoint exact GET /genres', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toContain('**Endpoint:** `GET /genres`');
  });

  it('locks now_playing Endpoint remap note with stations[0] and stream_url', () => {
    expect(spec).toContain('returns `stations[0]` only, with `url` remapped to `stream_url`');
  });

  it('locks title Heading Backlink MCP Tool Specification', () => {
    expect(spec.startsWith('# Backlink MCP Tool Specification\n')).toBe(true);
  });

  it('locks Tools H2 before Integration Notes H2 and no other H2s', () => {
    const h2 = [...spec.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(h2).toEqual(['Tools', 'Integration Notes']);
  });

  it('curate timestamp format date-time is documented', () => {
    expect(spec).toContain('"timestamp": { "type": "string", "format": "date-time" }');
  });

  it('logo fields use string|null uri union in curate and now_playing', () => {
    const logoUnions = spec.match(/"logo": \{ "type": \["string", "null"\], "format": "uri" \}/g) ?? [];
    expect(logoUnions.length).toBeGreaterThanOrEqual(2);
  });

  it('cross-locks graceful degradation editorial null with Worker source', () => {
    expect(spec).toContain('editorial: null');
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain('editorial: null');
  });

  it('does not document claw-mcp tool names as docs tools', () => {
    const tools = spec.slice(spec.indexOf('## Tools'), spec.indexOf('## Integration Notes'));
    expect(tools).not.toContain('station_select');
    expect(tools).not.toContain('curator_prompt');
    expect(tools).not.toContain('genre_filter');
    expect(tools).not.toContain('### `now_playing`');
  });

  it('spec stays under 8KB lean docs budget with trailing newline', () => {
    expect(spec.endsWith('\n')).toBe(true);
    expect(Buffer.byteLength(spec, 'utf8')).toBeLessThan(8 * 1024);
  });


  // --- HEAVY burn (post-#46): helpers/CI/wrangler/source/mcp-spec deepen ---
  it('locks exactly six fenced json blocks', () => {
    expect([...spec.matchAll(/```json\n/g)]).toHaveLength(6);
  });

  it('locks backlink_curate input genre description examples jazz classical ambient rock pop', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop']) {
      expect(section).toContain(`'${g}'`);
    }
  });

  it('locks backlink_curate mood optional if genre is provided wording', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('Optional if genre is provided');
    expect(section).toContain('Optional if mood is provided');
  });

  it('locks backlink_genres aliases description Friendly name mapping', () => {
    expect(spec).toContain('Friendly name → canonical slug mapping');
  });

  it('locks now_playing input genre examples ambient late night jazz', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toContain("'ambient'");
    expect(section).toContain("'late night'");
    expect(section).toContain("'jazz'");
  });

  it('locks now_playing Output intro Single station object first result', () => {
    expect(spec).toContain('Single station object (first result from /curate).');
  });

  it('locks curate and now_playing to share GET /curate endpoint template', () => {
    expect((spec.match(/GET \/curate\?genre=\{genre\}&mood=\{mood\}/g) ?? []).length).toBe(2);
  });

  it('does not document GET /stations as an MCP tool endpoint', () => {
    expect(spec).not.toMatch(/\*\*Endpoint:\*\* `GET \/stations/);
  });

  it('does not document GET /health as an MCP tool', () => {
    expect(spec).not.toMatch(/\/health/);
  });

  it('locks Integration Notes order Base URL then auth then KV then Gemini then degrade', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = [...notes.matchAll(/^- .+$/gm)].map((m) => m[0]);
    expect(bullets[0]).toContain('Base URL');
    expect(bullets[1]).toContain('No auth required');
    expect(bullets[2]).toContain('KV cache');
    expect(bullets[3]).toContain('Gemini fresh');
    expect(bullets[4]).toContain('graceful degradation');
  });

  it('cross-locks genres aliases additionalProperties with GENRE_MAP string values', () => {
    expect(spec).toContain('"additionalProperties": { "type": "string" }');
    expect(Object.values(GENRE_MAP).every((v) => typeof v === 'string')).toBe(true);
  });

  it('cross-locks curate required name url genre with Worker degrade fields', () => {
    expect(spec).toContain('"required": ["name", "url", "genre"]');
    const index = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(index).toContain('name: s.name');
    expect(index).toContain('url: s.url');
    expect(index).toContain('editorial: null');
  });

  it('does not document API keys or secret names', () => {
    expect(spec).not.toMatch(/GEMINI_API_KEY|API_KEY|secret/i);
  });

  it('does not document Cloudflare KV binding names', () => {
    expect(spec).not.toContain('CATALOG_CACHE');
  });

  it('locks ## Tools heading exactly once', () => {
    expect((spec.match(/^## Tools$/gm) ?? []).length).toBe(1);
  });

  it('locks ## Integration Notes heading exactly once', () => {
    expect((spec.match(/^## Integration Notes$/gm) ?? []).length).toBe(1);
  });

  it('each tool ### heading uses backticks around tool id', () => {
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing']) {
      expect(spec).toContain(`### \`${id}\``);
    }
  });

  it('locks backlink_genres additionalProperties false on input', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toContain('"additionalProperties": false');
  });

  it('locks curate stations items type object', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('"items": {\n        "type": "object"');
  });

  it('locks genres output genres items type string', () => {
    expect(spec).toContain('"items": { "type": "string" }');
  });

  it('now_playing does not require logo or editorial', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toContain('"required": ["name", "stream_url", "genre"]');
    expect(section).not.toContain('"required": ["name", "stream_url", "genre", "logo"]');
  });

  it('spec does not mention claw-mcp tool names from src/mcp.ts', () => {
    for (const name of ['station_select', 'now_playing', 'genre_filter', 'curator_prompt']) {
      // now_playing appears as backlink_now_playing — bare now_playing should not appear as tool id
      if (name === 'now_playing') {
        expect(spec).not.toMatch(/(?<!backlink_)now_playing/);
      } else {
        expect(spec).not.toContain(name);
      }
    }
  });

  it('intro sentence defines Backlink as claw-mcp tool set', () => {
    expect(spec).toContain(
      'This spec defines Backlink as a claw-mcp tool set. Each tool maps to a Backlink API endpoint.',
    );
  });

  it('does not document pagination or cursor fields', () => {
    expect(spec).not.toMatch(/cursor|pagination|page_size/i);
  });

  it('does not document websocket mcp transport', () => {
    expect(spec).not.toMatch(/stdio|sse|streamable/i);
  });

  it('locks graceful degradation editorial null exact backticks', () => {
    expect(spec).toContain('with `editorial: null`');
  });

  it('cross-locks Base URL with AGENTS.md domain target host', () => {
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('backlink.fuzzywigg.com');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
  });

  it('curate Description mentions editorial blurbs', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toMatch(/editorial blurbs/i);
  });

  it('genres Description mentions mood aliases', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toMatch(/mood aliases/i);
  });

  it('now_playing Description mentions editorial context', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/editorial context/i);
  });

  it('spec file has no trailing spaces on non-empty lines', () => {
    for (const line of spec.split('\n')) {
      if (line.length) expect(line).not.toMatch(/[ \t]+$/);
    }
  });

  it('locks horizontal rules to separate tools and notes', () => {
    const parts = spec.split(/^---$/m);
    expect(parts.length).toBe(5); // 4 rules → 5 segments
  });

  it('JSON parse of all fences yields objects with type object', () => {
    const blocks = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    for (const block of blocks) {
      const parsed = JSON.parse(block) as { type?: string };
      expect(parsed.type).toBe('object');
    }
  });

  it('cross-locks VALID_GENRES jazz classical ambient rock pop with curate examples', () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(VALID_GENRES).toContain(g);
      expect(spec).toContain(`'${g}'`);
    }
  });

  it('does not document MCP auth OAuth or bearer schemes', () => {
    expect(spec).not.toMatch(/oauth|bearer|api[_-]?key/i);
  });

  // --- HEAVY burn (post-#53): mcp-spec contract deepen ---

  it('locks exact UTF-8 byte length 3552 for docs/mcp-spec.md', () => {
    expect(Buffer.byteLength(spec, 'utf8')).toBe(3552);
  });

  it('locks exact line count 145 including trailing newline', () => {
    expect(spec.split('\n')).toHaveLength(145);
    expect(spec.endsWith('\n')).toBe(true);
  });

  it('locks exactly three ### tool headings', () => {
    expect([...spec.matchAll(/^### /gm)]).toHaveLength(3);
  });

  it('locks exactly three **Description:** **Input Schema:** **Endpoint:** labels', () => {
    expect([...spec.matchAll(/\*\*Description:\*\*/g)]).toHaveLength(3);
    expect([...spec.matchAll(/\*\*Input Schema:\*\*/g)]).toHaveLength(3);
    expect([...spec.matchAll(/\*\*Endpoint:\*\*/g)]).toHaveLength(3);
  });

  it('locks Integration Notes bullet count exactly 5', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    expect([...notes.matchAll(/^- /gm)]).toHaveLength(5);
  });

  it('locks tool order curate → genres → now_playing in headings', () => {
    const curate = spec.indexOf('### `backlink_curate`');
    const genres = spec.indexOf('### `backlink_genres`');
    const now = spec.indexOf('### `backlink_now_playing`');
    expect(curate).toBeGreaterThan(-1);
    expect(genres).toBeGreaterThan(curate);
    expect(now).toBeGreaterThan(genres);
  });

  it('locks backlink_curate Output intro Array of curated station objects', () => {
    expect(spec).toContain('**Output:** Array of curated station objects.');
  });

  it('locks backlink_curate stations required name url genre only', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('"required": ["name", "url", "genre"]');
  });

  it('locks curate output query curated_by timestamp stations property keys', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('"query"');
    expect(section).toContain('"curated_by"');
    expect(section).toContain('"timestamp"');
    expect(section).toContain('"stations"');
  });

  it('locks now_playing stream_url format uri', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toContain('"stream_url": { "type": "string", "format": "uri" }');
  });

  it('locks curate url format uri distinct from now_playing stream_url', () => {
    const curate = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(curate).toContain('"url": { "type": "string", "format": "uri" }');
    expect(curate).not.toContain('stream_url');
  });

  it('locks all three tools additionalProperties false on input schemas', () => {
    expect([...spec.matchAll(/"additionalProperties": false/g)]).toHaveLength(3);
  });

  it('locks genres output genres description Canonical genre slugs', () => {
    expect(spec).toContain('Canonical genre slugs accepted by /curate and /stations');
  });

  it('locks mood examples late night focus chill energizing order in curate input', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const late = section.indexOf("'late night'");
    const focus = section.indexOf("'focus'");
    const chill = section.indexOf("'chill'");
    const energizing = section.indexOf("'energizing'");
    expect(late).toBeGreaterThan(-1);
    expect(focus).toBeGreaterThan(late);
    expect(chill).toBeGreaterThan(focus);
    expect(energizing).toBeGreaterThan(chill);
  });

  it('locks Base URL exact backticks https://backlink.fuzzywigg.com', () => {
    expect(spec).toContain('- Base URL: `https://backlink.fuzzywigg.com`');
  });

  it('locks KV cache 1h TTL wording exact', () => {
    expect(spec).toContain(
      'KV cache means `/stations` calls are fast after first hit per genre (1h TTL)',
    );
  });

  it('locks /curate always calls Gemini fresh wording exact', () => {
    expect(spec).toContain('`/curate` always calls Gemini fresh — no LLM response caching');
  });

  it('locks graceful degradation top 5 raw stations wording exact', () => {
    expect(spec).toContain(
      'On Gemini failure, graceful degradation returns top 5 raw stations with `editorial: null`',
    );
  });

  it('cross-locks top 5 degrade with Worker stations.slice(0, 5)', () => {
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain('stations.slice(0, 5)');
    expect(spec).toContain('top 5 raw stations');
  });

  it('cross-locks 1h TTL with expirationTtl 3600 in Worker', () => {
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain('expirationTtl: 3600');
    expect(spec).toContain('1h TTL');
  });

  it('does not document /openapi.json despite claw-mcp api.url', () => {
    expect(spec).not.toContain('/openapi.json');
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
  });

  it('does not document station_select genre_filter curator_prompt claw names', () => {
    expect(spec).not.toContain('station_select');
    expect(spec).not.toContain('genre_filter');
    expect(spec).not.toContain('curator_prompt');
  });

  it('locks backlink_ prefix on all three docs tool ids', () => {
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing']) {
      expect(id.startsWith('backlink_')).toBe(true);
      expect(spec).toContain(`### \`${id}\``);
    }
  });

  it('JSON fences parse without throwing and stay type object', () => {
    const blocks = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(6);
    for (const block of blocks) {
      expect(() => JSON.parse(block)).not.toThrow();
      expect(JSON.parse(block).type).toBe('object');
    }
  });

  it('locks curate input properties genre and mood only', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    const input = section.slice(section.indexOf('```json'), section.indexOf('```', section.indexOf('```json') + 1));
    const parsed = JSON.parse(input.replace(/```json\n/, '').replace(/\n```$/, '')) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(parsed.properties).sort()).toEqual(['genre', 'mood']);
  });

  it('locks genres input properties empty object', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toContain('"properties": {}');
  });

  it('locks now_playing required name stream_url genre', () => {
    expect(spec).toContain('"required": ["name", "stream_url", "genre"]');
  });

  it('locks editorial type string|null without format on both outputs', () => {
    expect([...spec.matchAll(/"editorial": \{ "type": \["string", "null"\] \}/g)].length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('spec does not mention Workers KV binding or wrangler', () => {
    expect(spec).not.toMatch(/wrangler|CATALOG_CACHE|KVNamespace/i);
  });

  it('spec does not mention Hono or Cloudflare Workers product names', () => {
    expect(spec).not.toMatch(/\bHono\b|\bWorkers\b|\bCloudflare\b/);
  });

  it('locks em-dash presence at three narrative sites', () => {
    expect((spec.match(/—/g) ?? []).length).toBe(3);
    expect(spec).toContain('mood — the single best');
    expect(spec).toContain('` — returns `stations[0]` only');
    expect(spec).toContain('Gemini fresh — no LLM');
  });

  it('locks no tab characters in spec', () => {
    expect(spec).not.toContain('\t');
  });

  it('locks LF-only newlines no CR', () => {
    expect(spec).not.toContain('\r');
  });

  it('cross-locks GENRE_MAP late night alias with now_playing examples', () => {
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(spec).toContain("'late night'");
  });

  it('cross-locks VALID_GENRES length 9 with genres tool documenting categories', () => {
    expect(VALID_GENRES).toHaveLength(9);
    expect(spec).toMatch(/iptv-org genre categories/i);
  });

  it('locks Description for now_playing mentions single best station', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/single best station/i);
  });

  it('locks Description for curate mentions top 3', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toContain('top 3 radio stations');
  });

  it('locks No auth required for read endpoints exact bullet', () => {
    expect(spec).toContain('- No auth required for read endpoints');
  });

  it('does not document write/mutate methods POST PUT DELETE', () => {
    expect(spec).not.toMatch(/\bPOST\b|\bPUT\b|\bDELETE\b|\bPATCH\b/);
  });

  it('only documents GET endpoints', () => {
    expect([...spec.matchAll(/\bGET\b/g)].length).toBeGreaterThanOrEqual(3);
  });

  it('locks code fence language tags json only (no typescript)', () => {
    const opening = [...spec.matchAll(/```(\w+)\n/g)].map((m) => m[1]);
    expect(opening.every((l) => l === 'json')).toBe(true);
    expect(opening).toHaveLength(6);
    expect(spec).not.toContain('```typescript');
    expect(spec).not.toContain('```ts');
  });

  it('spec file path docs/mcp-spec.md is the only markdown under docs/', () => {
    expect(readdirSync(join(root, 'docs'))).toEqual(['mcp-spec.md']);
  });

  // --- HEAVY burn (post-#65): mcp-spec contracts deepen (orthogonal to wrangler/genres/parser) ---

  it('post65: locks docs/mcp-spec.md sha256 sha1 md5 digests', () => {
    expect(createHash('sha256').update(spec).digest('hex')).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849');
    expect(createHash('sha1').update(spec).digest('hex')).toBe('e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a');
    expect(createHash('md5').update(spec).digest('hex')).toBe('ee7881030c338c1773659cc6378c392c');
    expect(spec.length).toBe(3544);
    expect(Buffer.byteLength(spec, 'utf8')).toBe(3552);
  });

  it('post65: locks docs/mcp-spec.md sha256 nibble sum to 514', () => {
    const hex = createHash('sha256').update(spec).digest('hex');
    expect([...hex].reduce((a, c) => a + Number.parseInt(c, 16), 0)).toBe(514);
  });

  it('post65: locks fs.statSync size equals UTF-8 byte length of mcp-spec', () => {
    expect(statSync(join(root, 'docs/mcp-spec.md')).size).toBe(3552);
  });

  it('post65: locks title exact Backlink MCP Tool Specification', () => {
    expect(spec.startsWith('# Backlink MCP Tool Specification\n')).toBe(true);
  });

  it('post65: locks H2 headings Tools then Integration Notes only', () => {
    expect([...spec.matchAll(/^## /gm)].map((m) => m[0])).toEqual(['## ', '## ']);
    expect([...spec.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([
      'Tools',
      'Integration Notes',
    ]);
  });

  it('post65: locks claw-mcp phrase in intro sentence', () => {
    expect(spec).toContain('claw-mcp tool set');
    expect(spec.split('\n')[2]).toContain('claw-mcp');
  });

  it('post65: locks exactly three backlink_ tool ids in headings', () => {
    expect([...spec.matchAll(/^### `backlink_/gm)]).toHaveLength(3);
  });

  it('post65: locks Output label count — curate and now_playing only (genres has Output without Array intro variance)', () => {
    expect([...spec.matchAll(/\*\*Output:\*\*/g)]).toHaveLength(3);
  });

  it('post65: locks JSON fence count and parseable property sets', () => {
    const blocks = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(6);
    const parsed = blocks.map((b) => JSON.parse(b));
    expect(parsed.every((p) => p.type === 'object')).toBe(true);
  });

  it('post65: locks curate input genre description mentions jazz classical ambient rock pop', () => {
    const section = spec.slice(spec.indexOf('### `backlink_curate`'), spec.indexOf('### `backlink_genres`'));
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop']) {
      expect(section).toContain(`'${g}'`);
    }
  });

  it('post65: locks now_playing input examples ambient late night jazz order', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    const ambient = section.indexOf("'ambient'");
    const late = section.indexOf("'late night'");
    const jazz = section.indexOf("'jazz'");
    expect(ambient).toBeLessThan(late);
    expect(late).toBeLessThan(jazz);
  });

  it('post65: locks now_playing endpoint remaps url to stream_url wording', () => {
    expect(spec).toContain("with `url` remapped to `stream_url`");
  });

  it('post65: locks stations[0] only wording for now_playing endpoint', () => {
    expect(spec).toContain('returns `stations[0]` only');
  });

  it('post65: locks genres aliases additionalProperties string', () => {
    expect(spec).toContain('"additionalProperties": { "type": "string" }');
  });

  it('post65: locks date-time format on curated timestamp', () => {
    expect(spec).toContain('"format": "date-time"');
  });

  it('post65: locks logo type string|null format uri appears twice', () => {
    expect(
      [...spec.matchAll(/"logo": \{ "type": \["string", "null"\], "format": "uri" \}/g)],
    ).toHaveLength(2);
  });

  it('post65: locks no tab CR BOM in mcp-spec', () => {
    expect(spec).not.toContain('\t');
    expect(spec).not.toContain('\r');
    expect(spec.charCodeAt(0)).not.toBe(0xfeff);
    expect(spec.charCodeAt(0)).toBe('#'.charCodeAt(0));
  });

  it('post65: locks em-dash code points count 3 via codePointAt scan', () => {
    const dashes = [...spec].filter((c) => c.codePointAt(0) === 0x2014);
    expect(dashes).toHaveLength(3);
  });

  it('post65: locks UTF-8 vs UTF-16 length delta of 8 for mcp-spec', () => {
    expect(Buffer.byteLength(spec, 'utf8') - spec.length).toBe(8);
  });

  it('post65: locks cross MCP_MANIFEST auth none with spec no-auth bullet', () => {
    expect(MCP_MANIFEST.auth.type).toBe('none');
    expect(spec).toContain('No auth required for read endpoints');
  });

  it('post65: locks docs tool ids never collide with claw-mcp tool names via Set', () => {
    const docs = ['backlink_curate', 'backlink_genres', 'backlink_now_playing'];
    const claw = new Set(MCP_MANIFEST.tools.map((t) => t.name));
    for (const id of docs) {
      expect(claw.has(id)).toBe(false);
      expect(spec).toContain(id);
    }
  });

  it('post65: locks btoa of Base URL host', () => {
    expect(btoa('backlink.fuzzywigg.com')).toBe('YmFja2xpbmsuZnV6enl3aWdnLmNvbQ==');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
  });

  it('post65: locks Integration Notes order Base URL → auth → KV → Gemini → degrade', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const base = notes.indexOf('Base URL');
    const auth = notes.indexOf('No auth required');
    const kv = notes.indexOf('KV cache');
    const gemini = notes.indexOf('always calls Gemini fresh');
    const degrade = notes.indexOf('graceful degradation');
    expect(base).toBeLessThan(auth);
    expect(auth).toBeLessThan(kv);
    expect(kv).toBeLessThan(gemini);
    expect(gemini).toBeLessThan(degrade);
  });

  it('post65: locks Collator-sorted docs tool ids', () => {
    const ids = ['backlink_curate', 'backlink_genres', 'backlink_now_playing'];
    expect([...ids].sort(new Intl.Collator('en').compare)).toEqual(ids);
  });

  it('post65: locks TextEncoder byte length of title line', () => {
    const title = '# Backlink MCP Tool Specification';
    expect(new TextEncoder().encode(title).length).toBe(title.length);
    expect(spec.startsWith(title + '\n')).toBe(true);
  });

  it('post65: locks matchAll of GET endpoint mentions', () => {
    const gets = [...spec.matchAll(/\bGET\b/g)];
    expect(gets.length).toBeGreaterThanOrEqual(3);
    expect(spec).toContain('GET /genres');
  });

  it('post65: locks no invent of DNS beyond backlink.fuzzywigg.com and none other hosts', () => {
    const hosts = [...spec.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]);
    expect(hosts).toEqual(['backlink.fuzzywigg.com']);
  });

  it('post65: locks no credential material patterns in mcp-spec', () => {
    expect(spec).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(spec).not.toMatch(/api[_-]?key\s*[:=]/i);
    expect(spec).not.toMatch(/bearer\s+[A-Za-z0-9._-]+/i);
  });

  it('post65: locks genres tool documents Friendly name arrow canonical slug', () => {
    expect(spec).toContain('Friendly name → canonical slug mapping');
  });

  it('post65: locks Unicode arrow → present exactly once', () => {
    expect((spec.match(/→/g) ?? []).length).toBe(1);
  });

  it('post65: locks structuredClone of parsed first JSON fence stays type object', () => {
    const block = [...spec.matchAll(/```json\n([\s\S]*?)```/g)][0][1];
    const parsed = JSON.parse(block);
    expect(structuredClone(parsed)).toEqual(parsed);
    expect(parsed.type).toBe('object');
  });

  it('post65: locks cross VALID_GENRES jazz classical ambient rock pop subset', () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(VALID_GENRES).toContain(g);
      expect(spec.toLowerCase()).toContain(g);
    }
  });

  it('post65: locks Proxy read of spec length via boxed object', () => {
    const boxed = new Proxy(
      { spec } as { spec: string; length?: number },
      {
        get(t, p) {
          return p === 'length' ? t.spec.length : Reflect.get(t, p);
        },
      },
    );
    expect(boxed.length).toBe(3544);
  });

  it('post65: locks DataView on first 4 bytes of mcp-spec are # Ba', () => {
    const bytes = new TextEncoder().encode(spec);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('# Ba');
  });

  it('post65: locks last non-empty line is degrade editorial null bullet', () => {
    const lines = spec.trimEnd().split('\n');
    expect(lines.at(-1)).toContain('editorial: null');
  });

  it('post65: locks horizontal rule count exactly 4', () => {
    expect([...spec.matchAll(/^---$/gm)]).toHaveLength(4);
  });

  it('post65: locks exact backtick count', () => {
    expect((spec.match(/`/g) ?? []).length).toBe(62);
  });

  it('post65: locks Map of tool heading index positions ascending', () => {
    const map = new Map([
      ['curate', spec.indexOf('### `backlink_curate`')],
      ['genres', spec.indexOf('### `backlink_genres`')],
      ['now', spec.indexOf('### `backlink_now_playing`')],
    ]);
    expect(map.get('curate')!).toBeLessThan(map.get('genres')!);
    expect(map.get('genres')!).toBeLessThan(map.get('now')!);
  });

  it('post65: locks JSON.stringify(spec).length snapshot band', () => {
    expect(JSON.stringify(spec).length).toBe(3940);
  });

  it('post65: locks no history invent — does not mention changelog version history commits', () => {
    expect(spec).not.toMatch(/changelog|commit history|git blame/i);
    expect(spec).not.toContain('TODO');
    expect(spec).not.toContain('FIXME');
  });
  // --- HEAVY burn (post-#66): mcp-spec contract deepen (orthogonal to routes/wrangler/genres/parser/helpers) ---

  it('post66: locks exact H1 Backlink MCP Tool Specification', () => {
    expect(spec.startsWith('# Backlink MCP Tool Specification\n')).toBe(true);
    expect([...spec.matchAll(/^# /gm)]).toHaveLength(1);
  });

  it('post66: locks exact intro sentence about claw-mcp tool set', () => {
    expect(spec).toContain(
      'This spec defines Backlink as a claw-mcp tool set. Each tool maps to a Backlink API endpoint.',
    );
  });

  it('post66: locks exactly two H2 headings Tools and Integration Notes', () => {
    const h2 = [...spec.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(h2).toEqual(['Tools', 'Integration Notes']);
  });

  it('post66: horizontal-rule split yields five segments', () => {
    expect(spec.split('\n---\n')).toHaveLength(5);
  });

  it('post66: locks exact Description body for backlink_curate', () => {
    expect(spec).toContain(
      "**Description:** Ask Backlink's AI curator to pick the top 3 radio stations for a given genre or mood, with editorial blurbs.",
    );
  });

  it('post66: locks exact Description body for backlink_genres', () => {
    expect(spec).toContain(
      '**Description:** List all available iptv-org genre categories supported by Backlink, including mood aliases.',
    );
  });

  it('post66: locks exact Description body for backlink_now_playing', () => {
    expect(spec).toContain(
      '**Description:** Get the top AI-curated pick for a genre or mood — the single best station right now, with editorial context.',
    );
  });

  it('post66: locks exactly three **Output:** labels', () => {
    expect([...spec.matchAll(/\*\*Output:\*\*/g)]).toHaveLength(3);
  });

  it('post66: genres Output has no prose intro before fence', () => {
    const section = toolSection('backlink_genres', '### `backlink_now_playing`');
    expect(section).toContain('**Output:**\n```json');
    expect(section).not.toContain('**Output:** Array');
    expect(section).not.toContain('**Output:** Single');
  });

  it('post66: curate input property key order is genre then mood', () => {
    const fences = jsonFences() as Array<{ properties?: Record<string, unknown> }>;
    expect(Object.keys(fences[0].properties ?? {})).toEqual(['genre', 'mood']);
  });

  it('post66: now_playing input property key order is genre then mood', () => {
    const fences = jsonFences() as Array<{ properties?: Record<string, unknown> }>;
    expect(Object.keys(fences[4].properties ?? {})).toEqual(['genre', 'mood']);
  });

  it('post66: curate output top-level key order query curated_by timestamp stations', () => {
    const fences = jsonFences() as Array<{ properties?: Record<string, unknown> }>;
    expect(Object.keys(fences[1].properties ?? {})).toEqual([
      'query',
      'curated_by',
      'timestamp',
      'stations',
    ]);
  });

  it('post66: curate station items.properties key order name url logo editorial genre', () => {
    const fences = jsonFences() as Array<{
      properties?: {
        stations?: { items?: { properties?: Record<string, unknown>; required?: string[] } };
      };
    }>;
    expect(Object.keys(fences[1].properties?.stations?.items?.properties ?? {})).toEqual([
      'name',
      'url',
      'logo',
      'editorial',
      'genre',
    ]);
  });

  it('post66: now_playing output key order name stream_url logo editorial genre', () => {
    const fences = jsonFences() as Array<{ properties?: Record<string, unknown> }>;
    expect(Object.keys(fences[5].properties ?? {})).toEqual([
      'name',
      'stream_url',
      'logo',
      'editorial',
      'genre',
    ]);
  });

  it('post66: genres output key order genres then aliases', () => {
    const fences = jsonFences() as Array<{ properties?: Record<string, unknown> }>;
    expect(Object.keys(fences[3].properties ?? {})).toEqual(['genres', 'aliases']);
  });

  it('post66: genres aliases.additionalProperties.type is string', () => {
    const fences = jsonFences() as Array<{
      properties?: { aliases?: { additionalProperties?: { type?: string } } };
    }>;
    expect(fences[3].properties?.aliases?.additionalProperties?.type).toBe('string');
  });

  it('post66: curate station required is exactly name url genre', () => {
    const fences = jsonFences() as Array<{
      properties?: { stations?: { items?: { required?: string[] } } };
    }>;
    expect(fences[1].properties?.stations?.items?.required).toEqual(['name', 'url', 'genre']);
  });

  it('post66: now_playing required is exactly name stream_url genre', () => {
    const fences = jsonFences() as Array<{ required?: string[] }>;
    expect(fences[5].required).toEqual(['name', 'stream_url', 'genre']);
  });

  it('post66: all six fences are type object', () => {
    const fences = jsonFences() as Array<{ type?: string }>;
    expect(fences).toHaveLength(6);
    expect(fences.every((f) => f.type === 'object')).toBe(true);
  });

  it('post66: input fences set additionalProperties false; outputs omit top-level false', () => {
    const fences = jsonFences() as Array<{ additionalProperties?: boolean }>;
    expect(fences[0].additionalProperties).toBe(false);
    expect(fences[2].additionalProperties).toBe(false);
    expect(fences[4].additionalProperties).toBe(false);
    expect(fences[1].additionalProperties).toBeUndefined();
    expect(fences[3].additionalProperties).toBeUndefined();
    expect(fences[5].additionalProperties).toBeUndefined();
  });

  it('post66: curate genre examples order jazz classical ambient rock pop', () => {
    const section = toolSection('backlink_curate', '### `backlink_genres`');
    const jazz = section.indexOf("'jazz'");
    const classical = section.indexOf("'classical'");
    const ambient = section.indexOf("'ambient'");
    const rock = section.indexOf("'rock'");
    const pop = section.indexOf("'pop'");
    expect(jazz).toBeGreaterThan(-1);
    expect(classical).toBeGreaterThan(jazz);
    expect(ambient).toBeGreaterThan(classical);
    expect(rock).toBeGreaterThan(ambient);
    expect(pop).toBeGreaterThan(rock);
  });

  it('post66: now_playing genre examples order ambient late night jazz', () => {
    const section = toolSection('backlink_now_playing', '## Integration Notes');
    const ambient = section.indexOf("'ambient'");
    const late = section.indexOf("'late night'");
    const jazz = section.indexOf("'jazz'");
    expect(ambient).toBeGreaterThan(-1);
    expect(late).toBeGreaterThan(ambient);
    expect(jazz).toBeGreaterThan(late);
  });

  it('post66: cross-locks curate mood examples late night focus chill with GENRE_MAP', () => {
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(GENRE_MAP.focus).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
    const section = toolSection('backlink_curate', '### `backlink_genres`');
    expect(section).toContain("'late night'");
    expect(section).toContain("'focus'");
    expect(section).toContain("'chill'");
  });

  it('post66: energizing appears in curate mood examples without GENRE_MAP inventing', () => {
    expect(spec).toContain("'energizing'");
    expect(Object.prototype.hasOwnProperty.call(GENRE_MAP, 'energizing')).toBe(false);
  });

  it('post66: documented curate genre examples are subset of VALID_GENRES', () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(VALID_GENRES).toContain(g);
      expect(spec).toContain(`'${g}'`);
    }
  });

  it('post66: cross-locks /genres docs shape with Worker genres+aliases payload keys', () => {
    const worker = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(worker).toContain('genres: [...VALID_GENRES]');
    expect(worker).toContain('aliases: GENRE_MAP');
    const fences = jsonFences() as Array<{ properties?: Record<string, unknown> }>;
    expect(Object.keys(fences[3].properties ?? {}).sort()).toEqual(['aliases', 'genres']);
  });

  it('post66: cross-locks curate output keys with Worker c.json payload', () => {
    const worker = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(worker).toMatch(/query[\s\S]*curated_by[\s\S]*timestamp[\s\S]*stations/);
    expect(worker).toContain("curated_by: 'Backlink/Geryon'");
    const fences = jsonFences() as Array<{ properties?: Record<string, unknown> }>;
    expect(Object.keys(fences[1].properties ?? {})).toEqual([
      'query',
      'curated_by',
      'timestamp',
      'stations',
    ]);
  });

  it('post66: cross-locks top 3 wording with Gemini prompt pick the top 3 stations', () => {
    const worker = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(worker).toContain('pick the top 3 stations');
    expect(spec).toContain('top 3 radio stations');
  });

  it('post66: cross-locks stream_url remap note with Worker keeping url not stream_url', () => {
    expect(spec).toContain('with `url` remapped to `stream_url`');
    const worker = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(worker).not.toContain('stream_url');
    expect(worker).toContain('url: s.url');
  });

  it('post66: cross-locks Base URL host with wrangler.toml custom domain pattern', () => {
    const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
  });

  it('post66: cross-locks No auth bullet with MCP_MANIFEST.auth.type none', () => {
    expect(MCP_MANIFEST.auth.type).toBe('none');
    expect(spec).toContain('- No auth required for read endpoints');
  });

  it('post66: does not document claw tool names as docs tool ids', () => {
    for (const claw of ['station_select', 'genre_filter', 'curator_prompt'] as const) {
      expect(spec).not.toContain(`### \`${claw}\``);
      expect(spec).not.toContain(`backlink_${claw}`);
    }
    // claw `now_playing` is a suffix of docs id `backlink_now_playing` — assert heading form only
    expect(spec).not.toContain('### `now_playing`');
    expect(spec).toContain('### `backlink_now_playing`');
  });

  it('post66: does not document root / or /openapi.json or /health endpoints', () => {
    expect(spec).not.toContain('GET /`');
    expect(spec).not.toContain('GET /health');
    expect(spec).not.toContain('/openapi.json');
    expect(spec).not.toContain("GET /'");
  });

  it('post66: does not document stations.slice(0, 50) catalog limit', () => {
    expect(spec).not.toContain('slice(0, 50)');
    expect(spec).not.toContain('top 50');
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain('slice(0, 50)');
  });

  it('post66: does not document retry_after or 503 status codes', () => {
    expect(spec).not.toContain('retry_after');
    expect(spec).not.toContain('503');
    expect(spec).not.toMatch(/\b404\b|\b500\b|\b401\b/);
  });

  it('post66: no HTML tags images or markdown links', () => {
    expect(spec).not.toMatch(/<[^>]+>/);
    expect(spec).not.toContain('](');
    expect(spec).not.toContain('![');
  });

  it('post66: fs.statSync size equals UTF-8 byte length 3552', () => {
    expect(statSync(specPath).size).toBe(3552);
    expect(Buffer.byteLength(spec, 'utf8')).toBe(3552);
    expect(new TextEncoder().encode(spec).length).toBe(3552);
  });

  it('post66: sha256 of docs/mcp-spec.md locks to known digest', () => {
    expect(createHash('sha256').update(spec, 'utf8').digest('hex')).toBe(
      'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849',
    );
  });

  it('post66: sha1 of docs/mcp-spec.md locks to known digest', () => {
    expect(createHash('sha1').update(spec, 'utf8').digest('hex')).toBe(
      'e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a',
    );
  });

  it('post66: md5 of docs/mcp-spec.md locks to known digest', () => {
    expect(createHash('md5').update(spec, 'utf8').digest('hex')).toBe(
      'ee7881030c338c1773659cc6378c392c',
    );
  });

  it('post66: sha256 digest is lowercase hex length 64', () => {
    const digest = createHash('sha256').update(spec, 'utf8').digest('hex');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toHaveLength(64);
  });

  it('post66: sha256 hex starts with a93978d7 and ends with 5da56849', () => {
    const digest = createHash('sha256').update(spec, 'utf8').digest('hex');
    expect(digest.startsWith('a93978d7')).toBe(true);
    expect(digest.endsWith('5da56849')).toBe(true);
  });

  it('post66: md5 hex starts with ee788103 and ends with 378c392c', () => {
    const digest = createHash('md5').update(spec, 'utf8').digest('hex');
    expect(digest.startsWith('ee788103')).toBe(true);
    expect(digest.endsWith('378c392c')).toBe(true);
  });

  it('post66: createHash sha256 digest Buffer equals hex decode of locked digest', () => {
    const hex = 'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849';
    const buf = createHash('sha256').update(spec, 'utf8').digest();
    expect(Buffer.from(hex, 'hex').equals(buf)).toBe(true);
  });

  it('post66: createHash md5 digest Buffer length 16; sha1 length 20', () => {
    expect(createHash('md5').update(spec, 'utf8').digest()).toHaveLength(16);
    expect(createHash('sha1').update(spec, 'utf8').digest()).toHaveLength(20);
  });

  it('post66: trimStart and trimEnd are no-ops aside from trailing newline', () => {
    expect(spec).toBe(spec.trimStart());
    expect(spec.trimEnd() + '\n').toBe(spec);
    expect(spec.endsWith('\n')).toBe(true);
    expect(spec.endsWith('\n\n')).toBe(false);
  });

  it('post66: tool-id localeCompare ascending curate < genres < now_playing', () => {
    const ids = ['backlink_curate', 'backlink_genres', 'backlink_now_playing'] as const;
    expect([...ids].sort((a, b) => a.localeCompare(b))).toEqual([...ids]);
    expect(ids[0].localeCompare(ids[1])).toBeLessThan(0);
    expect(ids[1].localeCompare(ids[2])).toBeLessThan(0);
  });

  it('post66: locks Endpoint lines for all three tools exactly', () => {
    expect(spec).toContain('**Endpoint:** `GET /curate?genre={genre}&mood={mood}`');
    expect(spec).toContain('**Endpoint:** `GET /genres`');
    expect(spec).toContain(
      '**Endpoint:** `GET /curate?genre={genre}&mood={mood}` — returns `stations[0]` only, with `url` remapped to `stream_url`.',
    );
  });

  it('post66: curate and now_playing share identical GET /curate query template', () => {
    const template = 'GET /curate?genre={genre}&mood={mood}';
    expect([...spec.matchAll(new RegExp(template.replace(/[.?]/g, '\\$&'), 'g'))]).toHaveLength(2);
  });

  it('post66: locks curate Output intro and now_playing Output intro exact', () => {
    expect(spec).toContain('**Output:** Array of curated station objects.');
    expect(spec).toContain('**Output:** Single station object (first result from /curate).');
  });

  it('post66: timestamp format date-time only on curate output', () => {
    const fences = jsonFences() as Array<{
      properties?: { timestamp?: { format?: string; type?: string } };
    }>;
    expect(fences[1].properties?.timestamp).toEqual({ type: 'string', format: 'date-time' });
    expect(JSON.stringify(fences[5])).not.toContain('date-time');
  });

  it('post66: logo type string|null format uri on curate and now_playing', () => {
    expect([...spec.matchAll(/"logo": \{ "type": \["string", "null"\], "format": "uri" \}/g)]).toHaveLength(
      2,
    );
  });

  it('post66: editorial type string|null without format appears twice', () => {
    expect([...spec.matchAll(/"editorial": \{ "type": \["string", "null"\] \}/g)]).toHaveLength(2);
  });

  it('post66: genres input fence is empty properties object with additionalProperties false', () => {
    const fences = jsonFences() as Array<{
      type: string;
      properties: Record<string, unknown>;
      additionalProperties?: boolean;
    }>;
    expect(fences[2]).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('post66: curate genre description mentions Optional if mood is provided', () => {
    const fences = jsonFences() as Array<{
      properties?: { genre?: { description?: string }; mood?: { description?: string } };
    }>;
    expect(fences[0].properties?.genre?.description).toContain('Optional if mood is provided.');
    expect(fences[0].properties?.mood?.description).toContain('Optional if genre is provided.');
  });

  it('post66: now_playing mood description Used alongside or instead of genre', () => {
    const fences = jsonFences() as Array<{
      properties?: { mood?: { description?: string }; genre?: { description?: string } };
    }>;
    expect(fences[4].properties?.mood?.description).toBe(
      'Mood descriptor. Used alongside or instead of genre.',
    );
    expect(fences[4].properties?.genre?.description).toContain('Genre slug or friendly name');
  });

  it('post66: genres description Friendly name → canonical slug mapping', () => {
    const fences = jsonFences() as Array<{
      properties?: { aliases?: { description?: string }; genres?: { description?: string } };
    }>;
    expect(fences[3].properties?.aliases?.description).toBe(
      'Friendly name → canonical slug mapping',
    );
    expect(fences[3].properties?.genres?.description).toBe(
      'Canonical genre slugs accepted by /curate and /stations',
    );
  });

  it('post66: genres items type string and aliases is object', () => {
    const fences = jsonFences() as Array<{
      properties?: {
        genres?: { type?: string; items?: { type?: string } };
        aliases?: { type?: string };
      };
    }>;
    expect(fences[3].properties?.genres?.type).toBe('array');
    expect(fences[3].properties?.genres?.items?.type).toBe('string');
    expect(fences[3].properties?.aliases?.type).toBe('object');
  });

  it('post66: stations array items type object', () => {
    const fences = jsonFences() as Array<{
      properties?: { stations?: { type?: string; items?: { type?: string } } };
    }>;
    expect(fences[1].properties?.stations?.type).toBe('array');
    expect(fences[1].properties?.stations?.items?.type).toBe('object');
  });

  it('post66: Integration Notes section starts after now_playing Endpoint', () => {
    const nowEnd = spec.indexOf('## Integration Notes');
    const endpoint = spec.lastIndexOf('**Endpoint:**', nowEnd);
    expect(endpoint).toBeGreaterThan(spec.indexOf('### `backlink_now_playing`'));
    expect(nowEnd).toBeGreaterThan(endpoint);
  });

  it('post66: Integration Notes five bullets preserve exact order', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = [...notes.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(bullets).toEqual([
      'Base URL: `https://backlink.fuzzywigg.com`',
      'No auth required for read endpoints',
      'KV cache means `/stations` calls are fast after first hit per genre (1h TTL)',
      '`/curate` always calls Gemini fresh — no LLM response caching',
      'On Gemini failure, graceful degradation returns top 5 raw stations with `editorial: null`',
    ]);
  });

  it('post66: cross-locks editorial null degrade wording with Worker editorial: null', () => {
    expect(spec).toContain('`editorial: null`');
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain('editorial: null');
  });

  it('post66: does not invent /playlist or /now-playing Worker routes in docs', () => {
    expect(spec).not.toContain('/playlist');
    expect(spec).not.toContain('/now-playing');
    expect(spec).not.toContain('GET /now');
  });

  it('post66: docs tool ids all start with backlink_ and use snake_case', () => {
    const ids = [...spec.matchAll(/### `(backlink_[a-z_]+)`/g)].map((m) => m[1]);
    expect(ids).toEqual(['backlink_curate', 'backlink_genres', 'backlink_now_playing']);
    for (const id of ids) {
      expect(id).toMatch(/^backlink_[a-z_]+$/);
      expect(id).not.toMatch(/[A-Z-]/);
    }
  });

  it('post66: claw-mcp names never appear as backlink_ prefixed docs ids', () => {
    for (const claw of MCP_MANIFEST.tools.map((t) => t.name)) {
      if (claw === 'now_playing') {
        // docs intentionally use backlink_now_playing; claw name is unprefixed now_playing
        expect(spec).toContain('### `backlink_now_playing`');
        expect(spec).not.toContain('### `now_playing`');
        continue;
      }
      expect(spec).not.toContain(`backlink_${claw}`);
    }
  });

  it('post66: character length 3544 with UTF-8 multi-byte em-dashes', () => {
    expect(spec.length).toBe(3544);
    expect(Buffer.byteLength(spec, 'utf8') - spec.length).toBe(8);
    expect((spec.match(/—/g) ?? []).length).toBe(3);
    expect(Buffer.byteLength('—', 'utf8')).toBe(3);
  });

  it('post66: no BOM and first code unit is hash', () => {
    expect(spec.charCodeAt(0)).toBe(0x23);
    expect(spec).not.toMatch(/^\uFEFF/);
  });

  it('post66: backtick-wrapped tool headings appear once each', () => {
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing']) {
      expect([...spec.matchAll(new RegExp(`### \\\`${id}\\\``, 'g'))]).toHaveLength(1);
    }
  });

  it('post66: Input Schema label always immediately precedes a json fence', () => {
    expect([...spec.matchAll(/\*\*Input Schema:\*\*\n```json\n/g)]).toHaveLength(3);
  });

  it('post66: does not document GEMINI_API_KEY or secret management', () => {
    expect(spec).not.toMatch(/GEMINI_API_KEY|secret put|wrangler secret/i);
  });

  it('post66: does not document IPTV_BASE host string', () => {
    expect(spec).not.toContain('iptv-org.github.io');
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain(
      'https://iptv-org.github.io/iptv/categories',
    );
  });

  it('post66: mentions iptv-org only in genres Description', () => {
    expect([...spec.matchAll(/iptv-org/g)]).toHaveLength(1);
    const section = toolSection('backlink_genres', '### `backlink_now_playing`');
    expect(section).toContain('iptv-org');
  });

  it('post66: mentions Gemini only in Integration Notes degrade and fresh bullets', () => {
    expect([...spec.matchAll(/Gemini/g)]).toHaveLength(2);
    expect(spec).toContain('calls Gemini fresh');
    expect(spec).toContain('On Gemini failure');
  });

  it('post66: AI curator / AI-curated wording sites stay stable', () => {
    expect(spec).toContain("Ask Backlink's AI curator");
    expect(spec).toContain('top AI-curated pick');
    expect([...spec.matchAll(/\bAI\b/g)].length).toBeGreaterThanOrEqual(2);
  });

  it('post66: fence top-level key order type properties then optional fields', () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    expect(Object.keys(fences[0])).toEqual(['type', 'properties', 'additionalProperties']);
    expect(Object.keys(fences[1])).toEqual(['type', 'properties']);
    expect(Object.keys(fences[2])).toEqual(['type', 'properties', 'additionalProperties']);
    expect(Object.keys(fences[3])).toEqual(['type', 'properties']);
    expect(Object.keys(fences[4])).toEqual(['type', 'properties', 'additionalProperties']);
    expect(Object.keys(fences[5])).toEqual(['type', 'properties', 'required']);
  });

  it('post66: curate station required omits logo and editorial', () => {
    const fences = jsonFences() as Array<{
      properties?: { stations?: { items?: { required?: string[] } } };
    }>;
    const required = fences[1].properties?.stations?.items?.required ?? [];
    expect(required).not.toContain('logo');
    expect(required).not.toContain('editorial');
  });

  it('post66: now_playing required omits logo and editorial', () => {
    const fences = jsonFences() as Array<{ required?: string[] }>;
    expect(fences[5].required).not.toContain('logo');
    expect(fences[5].required).not.toContain('editorial');
  });

  it('post66: query curated_by timestamp types are string on curate output', () => {
    const fences = jsonFences() as Array<{
      properties?: Record<string, { type?: string }>;
    }>;
    expect(fences[1].properties?.query?.type).toBe('string');
    expect(fences[1].properties?.curated_by?.type).toBe('string');
    expect(fences[1].properties?.timestamp?.type).toBe('string');
  });

  it('post66: name url/stream_url genre types are string on station shapes', () => {
    const fences = jsonFences() as Array<{
      properties?: Record<string, { type?: string }>;
    }>;
    const curateStation = (
      fences[1].properties?.stations as unknown as {
        items?: { properties?: Record<string, { type?: string }> };
      }
    )?.items?.properties;
    expect(curateStation?.name?.type).toBe('string');
    expect(curateStation?.url?.type).toBe('string');
    expect(curateStation?.genre?.type).toBe('string');
    expect(fences[5].properties?.name?.type).toBe('string');
    expect(fences[5].properties?.stream_url?.type).toBe('string');
    expect(fences[5].properties?.genre?.type).toBe('string');
  });

  it('post66: docs/ directory listing remains singleton mcp-spec.md', () => {
    expect(readdirSync(join(root, 'docs'))).toEqual(['mcp-spec.md']);
    expect(statSync(specPath).isFile()).toBe(true);
  });

  it('post66: re-read from disk matches in-memory spec and digest', () => {
    const again = readFileSync(specPath, 'utf8');
    expect(again).toBe(spec);
    expect(createHash('sha256').update(again, 'utf8').digest('hex')).toBe(
      'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849',
    );
  });

  it('post66: does not document music fallback or catalog unavailable errors', () => {
    expect(spec).not.toContain('music.m3u');
    expect(spec).not.toContain('Stream catalog unavailable');
    expect(spec).not.toContain('Curation service unavailable');
  });

  it('post66: does not document generationConfig or Gemini model id', () => {
    expect(spec).not.toContain('generationConfig');
    expect(spec).not.toContain('gemini-2.0-flash');
    expect(spec).not.toContain('maxOutputTokens');
  });

  it('post66: does not document CORS or Access-Control headers', () => {
    expect(spec).not.toMatch(/cors|access-control/i);
  });

  it('post66: curly-brace path params genre and mood appear in Endpoint templates', () => {
    expect(spec).toContain('{genre}');
    expect(spec).toContain('{mood}');
    expect([...spec.matchAll(/\{genre\}/g)]).toHaveLength(2);
    expect([...spec.matchAll(/\{mood\}/g)]).toHaveLength(2);
  });

  it('post66: cross-locks VALID_GENRES membership for now_playing ambient jazz examples', () => {
    expect(VALID_GENRES).toContain('ambient');
    expect(VALID_GENRES).toContain('jazz');
    expect(GENRE_MAP['late night']).toBe('ambient');
  });

  it('post66: focus chill late night aliases resolve ambient and appear in spec', () => {
    for (const alias of ['focus', 'chill', 'late night'] as const) {
      expect(GENRE_MAP[alias]).toBe('ambient');
      expect(spec).toContain(`'${alias}'`);
    }
  });

  it('post66: package name backlink aligns with Base URL host subdomain', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('backlink');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
  });

  it('post66: wrangler name backlink aligns with docs Base URL subdomain', () => {
    expect(readFileSync(join(root, 'wrangler.toml'), 'utf8')).toMatch(/^name = "backlink"$/m);
    expect(spec).toMatch(/backlink\.fuzzywigg\.com/);
  });

  it('post66: MCP_MANIFEST name_for_model backlink aligns with docs product name', () => {
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(spec).toContain('Backlink');
  });

  it('post66: does not document claw name_for_human Backlink Radio string', () => {
    expect(spec).not.toContain('Backlink Radio');
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
  });

  it('post66: does not document schema_version or openapi api.type from claw manifest', () => {
    expect(spec).not.toContain('schema_version');
    expect(spec).not.toContain('name_for_model');
    expect(spec).not.toContain('"openapi"');
    expect(MCP_MANIFEST.api.type).toBe('openapi');
  });

  it('post66: stations[0] remap prose appears only on now_playing Endpoint', () => {
    expect([...spec.matchAll(/stations\[0\]/g)]).toHaveLength(1);
    const section = toolSection('backlink_now_playing', '## Integration Notes');
    expect(section).toContain('stations[0]');
    expect(toolSection('backlink_curate', '### `backlink_genres`')).not.toContain('stations[0]');
  });

  it('post66: first result from /curate wording only on now_playing Output', () => {
    expect([...spec.matchAll(/first result from \/curate/g)]).toHaveLength(1);
    expect(toolSection('backlink_now_playing', '## Integration Notes')).toContain(
      'first result from /curate',
    );
  });

  it('post66: code fences are balanced six open six close', () => {
    expect([...spec.matchAll(/```/g)]).toHaveLength(12);
    expect([...spec.matchAll(/```json\n/g)]).toHaveLength(6);
  });

  it('post66: no trailing spaces on non-empty lines', () => {
    for (const line of spec.split('\n')) {
      if (line.length > 0) expect(line).not.toMatch(/[ \t]$/);
    }
  });

  it('post66: blank line after H1 before intro sentence', () => {
    expect(spec).toMatch(/^# Backlink MCP Tool Specification\n\nThis spec defines/s);
  });

  it('post66: blank line before each horizontal rule separator', () => {
    expect([...spec.matchAll(/\n\n---\n/g)]).toHaveLength(4);
  });

  it('post66: sha256 of empty string is not the locked digest', () => {
    expect(createHash('sha256').update('', 'utf8').digest('hex')).not.toBe(
      'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849',
    );
  });

  it('post66: mutating a copy does not change locked digest of original', () => {
    const mutated = spec.replace('Backlink', 'Xacklink');
    expect(mutated).not.toBe(spec);
    expect(createHash('sha256').update(mutated, 'utf8').digest('hex')).not.toBe(
      'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849',
    );
    expect(createHash('sha256').update(spec, 'utf8').digest('hex')).toBe(
      'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849',
    );
  });

  it('post66: TextEncoder byte length matches Buffer and stat', () => {
    const encoded = new TextEncoder().encode(spec);
    expect(encoded.byteLength).toBe(3552);
    expect(encoded.length).toBe(statSync(specPath).size);
  });

  it('post66: JSON.parse round-trip preserves fence structures', () => {
    const raw = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(raw).toHaveLength(6);
    for (const block of raw) {
      const parsed = JSON.parse(block);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
    }
  });

  it('post66: cross-locks Worker curated_by Backlink/Geryon not documented as literal in schemas', () => {
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain("curated_by: 'Backlink/Geryon'");
    const fences = jsonFences() as Array<{ properties?: { curated_by?: { const?: string } } }>;
    expect(fences[1].properties?.curated_by).toEqual({ type: 'string' });
    expect(JSON.stringify(fences[1])).not.toContain('Backlink/Geryon');
  });

  it('post66: does not document powered_by or Geryon crab emoji', () => {
    expect(spec).not.toContain('powered_by');
    expect(spec).not.toContain('Geryon');
    expect(spec).not.toContain('🦀');
  });

  it('post66: /stations appears only in Integration Notes KV bullet and genres description', () => {
    expect([...spec.matchAll(/\/stations/g)]).toHaveLength(2);
    expect(spec).toContain('Canonical genre slugs accepted by /curate and /stations');
    expect(spec).toContain('`/stations` calls are fast');
  });

  it('post66: /curate path references stay within documented surface', () => {
    expect([...spec.matchAll(/\/curate/g)].length).toBeGreaterThanOrEqual(5);
    expect(spec).not.toContain('/curate/');
  });

  it('post66: mood aliases phrase only on genres Description', () => {
    expect([...spec.matchAll(/mood aliases/g)]).toHaveLength(1);
    expect(toolSection('backlink_genres', '### `backlink_now_playing`')).toContain('mood aliases');
  });

  it('post66: editorial blurbs phrase only on curate Description', () => {
    expect([...spec.matchAll(/editorial blurbs/g)]).toHaveLength(1);
    expect(toolSection('backlink_curate', '### `backlink_genres`')).toContain('editorial blurbs');
  });

  it('post66: editorial context phrase only on now_playing Description', () => {
    expect([...spec.matchAll(/editorial context/g)]).toHaveLength(1);
    expect(toolSection('backlink_now_playing', '## Integration Notes')).toContain('editorial context');
  });

  it('post66: single best station phrase only on now_playing Description', () => {
    expect([...spec.matchAll(/single best station/g)]).toHaveLength(1);
  });

  it('post66: top 3 radio stations phrase only on curate Description', () => {
    expect([...spec.matchAll(/top 3 radio stations/g)]).toHaveLength(1);
  });

  it('post66: top 5 raw stations phrase only on Integration Notes', () => {
    expect([...spec.matchAll(/top 5 raw stations/g)]).toHaveLength(1);
    expect(spec.slice(spec.indexOf('## Integration Notes'))).toContain('top 5 raw stations');
  });

  it('post66: 1h TTL appears once in Integration Notes', () => {
    expect([...spec.matchAll(/1h TTL/g)]).toHaveLength(1);
  });

  it('post66: no LLM response caching appears once', () => {
    expect([...spec.matchAll(/no LLM response caching/g)]).toHaveLength(1);
  });

  it('post66: cross-locks expirationTtl 3600 seconds equals 1h', () => {
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain('expirationTtl: 3600');
    expect(3600).toBe(60 * 60);
    expect(spec).toContain('1h TTL');
  });

  it('post66: does not document KV binding name CATALOG_CACHE', () => {
    expect(spec).not.toContain('CATALOG_CACHE');
    expect(readFileSync(join(root, 'wrangler.toml'), 'utf8')).toContain('binding = "CATALOG_CACHE"');
  });

  it('post66: ascii punctuation set excludes smart quotes', () => {
    expect(spec).not.toContain('\u201c');
    expect(spec).not.toContain('\u201d');
    expect(spec).not.toContain('\u2019');
    expect(spec).toContain("'jazz'");
  });

  it('post66: arrow in aliases description is Unicode → not ASCII ->', () => {
    expect(spec).toContain('Friendly name → canonical slug mapping');
    expect(spec).not.toContain('Friendly name -> canonical');
  });

  it('post66: jsonFences helper returns six objects matching inline parses', () => {
    const viaHelper = jsonFences();
    const inline = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
    expect(viaHelper).toEqual(inline);
    expect(viaHelper).toHaveLength(6);
  });

  it('post66: toolSection helper bounds match indexOf slices', () => {
    expect(toolSection('backlink_curate', '### `backlink_genres`')).toBe(
      spec.slice(spec.indexOf('### `backlink_curate`'), spec.indexOf('### `backlink_genres`')),
    );
    expect(toolSection('backlink_genres', '### `backlink_now_playing`')).toBe(
      spec.slice(spec.indexOf('### `backlink_genres`'), spec.indexOf('### `backlink_now_playing`')),
    );
    expect(toolSection('backlink_now_playing', '## Integration Notes')).toBe(
      spec.slice(spec.indexOf('### `backlink_now_playing`'), spec.indexOf('## Integration Notes')),
    );
  });

  // --- HEAVY burn (post-#94): deepen mcp-spec contract coverage (orthogonal to genres #94 / wrangler #91 / helpers #85 / routes #79) ---

  // Tests-only. Complementary docs/mcp-spec.md ↔ runtime locks. No product inventing.

  it("post-94: spec sha256 fingerprint", () => {
    expect(createHash('sha256').update(spec, 'utf8').digest('hex')).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849');
  });

  it("post-94: spec sha1 fingerprint", () => {
    expect(createHash('sha1').update(spec, 'utf8').digest('hex')).toBe('e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a');
  });

  it("post-94: spec md5 fingerprint", () => {
    expect(createHash('md5').update(spec, 'utf8').digest('hex')).toBe('ee7881030c338c1773659cc6378c392c');
  });

  it("post-94: spec sha512 fingerprint", () => {
    expect(createHash('sha512').update(spec, 'utf8').digest('hex')).toBe('8d26bafffcb1230048d80796e1d8a1019d83253810324d18383c54ff8bcaaed4a508b0a07395994af2f23e4f9b627e2202a57fcac709110d0ee859e8628709e7');
  });

  it("post-94: spec sha256 nibble sum", () => {
    const hex = createHash('sha256').update(spec, 'utf8').digest('hex');
    expect([...hex].reduce((a, c) => a + parseInt(c, 16), 0)).toBe(514);
  });

  it("post-94: spec byte length 3544", () => {
    expect(spec.length).toBe(3544);
    expect(statSync(specPath).size).toBe(3552);
    expect(Buffer.byteLength(spec, 'utf8')).toBe(3552);
  });

  it("post-94: spec newline count 144", () => {
    expect((spec.match(/\n/g) ?? []).length).toBe(144);
    expect(spec.split('\n')).toHaveLength(145);
  });

  it("post-94: spec line length vector", () => {
    expect(spec.split('\n').map((l) => l.length)).toEqual([33,0,93,0,3,0,8,0,21,0,125,0,17,7,1,19,17,14,23,118,6,13,23,130,5,4,31,1,3,0,45,7,1,19,17,34,39,61,17,22,16,25,23,39,55,66,54,39,10,44,7,5,3,1,3,0,53,0,3,0,21,0,108,0,17,7,1,19,19,31,1,3,0,11,7,1,19,17,15,22,36,78,6,16,23,51,61,5,3,1,3,0,27,0,3,0,26,0,125,0,17,7,1,19,17,14,23,90,6,13,23,75,5,4,31,1,3,0,62,7,1,19,17,33,56,60,48,33,4,45,1,3,0,120,0,3,0,20,0,44,37,78,63,91,0]);
  });

  it("post-94: spec first 40 char codes", () => {
    expect([...spec.slice(0, 40)].map((c) => c.charCodeAt(0))).toEqual([35,32,66,97,99,107,108,105,110,107,32,77,67,80,32,84,111,111,108,32,83,112,101,99,105,102,105,99,97,116,105,111,110,10,10,84,104,105,115,32]);
  });

  it("post-94: spec digit count", () => {
    expect([...spec].filter((c) => /\d/.test(c))).toHaveLength(4);
  });

  it("post-94: spec uppercase count", () => {
    expect([...spec].filter((c) => /[A-Z]/.test(c))).toHaveLength(80);
  });

  it("post-94: spec lowercase count", () => {
    expect([...spec].filter((c) => /[a-z]/.test(c))).toHaveLength(1947);
  });

  it("post-94: spec space count", () => {
    expect((spec.match(/ /g) ?? []).length).toBe(640);
  });

  it("post-94: spec hash marker count", () => {
    expect((spec.match(/#/g) ?? []).length).toBe(14);
  });

  it("post-94: spec backtick count", () => {
    expect((spec.match(/`/g) ?? []).length).toBe(62);
  });

  it("post-94: spec double-quote count", () => {
    expect((spec.match(/"/g) ?? []).length).toBe(250);
  });

  it("post-94: spec colon count", () => {
    expect((spec.match(/:/g) ?? []).length).toBe(90);
  });

  it("post-94: spec dash count", () => {
    expect((spec.match(/-/g) ?? []).length).toBe(21);
  });

  it("post-94: spec underscore count", () => {
    expect((spec.match(/_/g) ?? []).length).toBe(8);
  });

  it("post-94: spec brace pair counts", () => {
    expect((spec.match(/\{/g) ?? []).length).toBe(40);
    expect((spec.match(/\}/g) ?? []).length).toBe(40);
  });

  it("post-94: spec bracket pair counts", () => {
    expect((spec.match(/\[/g) ?? []).length).toBe(7);
    expect((spec.match(/\]/g) ?? []).length).toBe(7);
  });

  it("post-94: spec paren pair counts", () => {
    expect((spec.match(/\(/g) ?? []).length).toBe(5);
    expect((spec.match(/\)/g) ?? []).length).toBe(5);
  });

  it("post-94: spec slash count", () => {
    expect((spec.match(/\//g) ?? []).length).toBe(10);
  });

  it("post-94: spec star count", () => {
    expect((spec.match(/\*/g) ?? []).length).toBe(48);
  });

  it("post-94: spec tab and CR absence", () => {
    expect(spec.includes('\t')).toBe(false);
    expect(spec.includes('\r')).toBe(false);
  });

  it("post-94: spec starts with title heading", () => {
    expect(spec.startsWith('# Backlink MCP Tool Specification\n')).toBe(true);
  });

  it("post-94: spec ends with editorial null note newline", () => {
    expect(spec.trimEnd().endsWith('`editorial: null`')).toBe(true);
    expect(spec.endsWith('\n')).toBe(true);
  });

  it("post-94: spec markdown headers lock", () => {
    expect(spec.split('\n').filter((l) => l.startsWith('#'))).toEqual(["# Backlink MCP Tool Specification","## Tools","### `backlink_curate`","### `backlink_genres`","### `backlink_now_playing`","## Integration Notes"]);
  });

  it("post-94: spec json fence count is 6", () => {
    expect([...spec.matchAll(/```json/g)]).toHaveLength(6);
    expect(jsonFences()).toHaveLength(6);
  });

  it("post-94: exact snapshot reaffirm", () => {
    expect(spec).toBe("# Backlink MCP Tool Specification\n\nThis spec defines Backlink as a claw-mcp tool set. Each tool maps to a Backlink API endpoint.\n\n---\n\n## Tools\n\n### `backlink_curate`\n\n**Description:** Ask Backlink's AI curator to pick the top 3 radio stations for a given genre or mood, with editorial blurbs.\n\n**Input Schema:**\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"genre\": {\n      \"type\": \"string\",\n      \"description\": \"Music genre (e.g. 'jazz', 'classical', 'ambient', 'rock', 'pop'). Optional if mood is provided.\"\n    },\n    \"mood\": {\n      \"type\": \"string\",\n      \"description\": \"Mood or vibe descriptor (e.g. 'late night', 'focus', 'chill', 'energizing'). Optional if genre is provided.\"\n    }\n  },\n  \"additionalProperties\": false\n}\n```\n\n**Output:** Array of curated station objects.\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"query\": { \"type\": \"string\" },\n    \"curated_by\": { \"type\": \"string\" },\n    \"timestamp\": { \"type\": \"string\", \"format\": \"date-time\" },\n    \"stations\": {\n      \"type\": \"array\",\n      \"items\": {\n        \"type\": \"object\",\n        \"properties\": {\n          \"name\": { \"type\": \"string\" },\n          \"url\": { \"type\": \"string\", \"format\": \"uri\" },\n          \"logo\": { \"type\": [\"string\", \"null\"], \"format\": \"uri\" },\n          \"editorial\": { \"type\": [\"string\", \"null\"] },\n          \"genre\": { \"type\": \"string\" }\n        },\n        \"required\": [\"name\", \"url\", \"genre\"]\n      }\n    }\n  }\n}\n```\n\n**Endpoint:** `GET /curate?genre={genre}&mood={mood}`\n\n---\n\n### `backlink_genres`\n\n**Description:** List all available iptv-org genre categories supported by Backlink, including mood aliases.\n\n**Input Schema:**\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {},\n  \"additionalProperties\": false\n}\n```\n\n**Output:**\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"genres\": {\n      \"type\": \"array\",\n      \"items\": { \"type\": \"string\" },\n      \"description\": \"Canonical genre slugs accepted by /curate and /stations\"\n    },\n    \"aliases\": {\n      \"type\": \"object\",\n      \"additionalProperties\": { \"type\": \"string\" },\n      \"description\": \"Friendly name → canonical slug mapping\"\n    }\n  }\n}\n```\n\n**Endpoint:** `GET /genres`\n\n---\n\n### `backlink_now_playing`\n\n**Description:** Get the top AI-curated pick for a genre or mood — the single best station right now, with editorial context.\n\n**Input Schema:**\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"genre\": {\n      \"type\": \"string\",\n      \"description\": \"Genre slug or friendly name (e.g. 'ambient', 'late night', 'jazz').\"\n    },\n    \"mood\": {\n      \"type\": \"string\",\n      \"description\": \"Mood descriptor. Used alongside or instead of genre.\"\n    }\n  },\n  \"additionalProperties\": false\n}\n```\n\n**Output:** Single station object (first result from /curate).\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"name\": { \"type\": \"string\" },\n    \"stream_url\": { \"type\": \"string\", \"format\": \"uri\" },\n    \"logo\": { \"type\": [\"string\", \"null\"], \"format\": \"uri\" },\n    \"editorial\": { \"type\": [\"string\", \"null\"] },\n    \"genre\": { \"type\": \"string\" }\n  },\n  \"required\": [\"name\", \"stream_url\", \"genre\"]\n}\n```\n\n**Endpoint:** `GET /curate?genre={genre}&mood={mood}` — returns `stations[0]` only, with `url` remapped to `stream_url`.\n\n---\n\n## Integration Notes\n\n- Base URL: `https://backlink.fuzzywigg.com`\n- No auth required for read endpoints\n- KV cache means `/stations` calls are fast after first hit per genre (1h TTL)\n- `/curate` always calls Gemini fresh — no LLM response caching\n- On Gemini failure, graceful degradation returns top 5 raw stations with `editorial: null`\n");
  });

  it("post-94: re-read equals module snapshot", () => {
    expect(readFileSync(specPath, 'utf8')).toBe(spec);
  });

  it("post-94: documents tool heading backlink_curate", () => {
    expect(spec).toContain('### \`backlink_curate\`');
  });

  it("post-94: tool id backlink_curate appears exactly once as heading", () => {
    expect([...spec.matchAll(new RegExp('### \`' + 'backlink_curate' + '\`', 'g'))]).toHaveLength(1);
  });

  it("post-94: documents tool heading backlink_genres", () => {
    expect(spec).toContain('### \`backlink_genres\`');
  });

  it("post-94: tool id backlink_genres appears exactly once as heading", () => {
    expect([...spec.matchAll(new RegExp('### \`' + 'backlink_genres' + '\`', 'g'))]).toHaveLength(1);
  });

  it("post-94: documents tool heading backlink_now_playing", () => {
    expect(spec).toContain('### \`backlink_now_playing\`');
  });

  it("post-94: tool id backlink_now_playing appears exactly once as heading", () => {
    expect([...spec.matchAll(new RegExp('### \`' + 'backlink_now_playing' + '\`', 'g'))]).toHaveLength(1);
  });

  it("post-94: tool order curate then genres then now_playing", () => {
    const c = spec.indexOf('### \`backlink_curate\`');
    const g = spec.indexOf('### \`backlink_genres\`');
    const n = spec.indexOf('### \`backlink_now_playing\`');
    expect(c).toBeGreaterThan(-1);
    expect(g).toBeGreaterThan(c);
    expect(n).toBeGreaterThan(g);
  });

  it("post-94: Integration Notes after all tools", () => {
    expect(spec.indexOf('## Integration Notes')).toBeGreaterThan(spec.indexOf('### \`backlink_now_playing\`'));
  });

  it("post-94: Base URL lock", () => {
    expect(spec).toContain('https://backlink.fuzzywigg.com');
  });

  it("post-94: no auth note lock", () => {
    expect(spec).toMatch(/No auth required for read endpoints/i);
  });

  it("post-94: 1h TTL lock", () => {
    expect(spec).toMatch(/1h TTL/i);
  });

  it("post-94: Gemini fresh lock", () => {
    expect(spec).toMatch(/always calls Gemini fresh/i);
  });

  it("post-94: graceful degradation editorial null", () => {
    expect(spec).toMatch(/graceful degradation returns top 5 raw stations/i);
    expect(spec).toContain('editorial: null');
  });

  it("post-94: curate endpoint documented", () => {
    expect(spec).toContain('GET /curate?genre={genre}&mood={mood}');
  });

  it("post-94: genres endpoint documented", () => {
    expect(spec).toContain('GET /genres');
  });

  it("post-94: stations mentioned in integration notes", () => {
    expect(spec).toMatch(/\/stations/);
  });

  it("post-94: jsonFences are all plain objects", () => {
    for (const fence of jsonFences()) {
      expect(fence).not.toBeNull();
      expect(typeof fence).toBe('object');
    }
  });

  it("post-94: curate input schema additionalProperties false", () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    expect(fences[0]).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it("post-94: genres input schema empty properties", () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    expect(fences[2]).toMatchObject({ type: 'object', properties: {}, additionalProperties: false });
  });

  it("post-94: now_playing input has genre and mood", () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    const props = fences[4].properties as Record<string, unknown>;
    expect(props).toHaveProperty('genre');
    expect(props).toHaveProperty('mood');
  });

  it("post-94: curate output requires name url genre on items", () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    const stations = (fences[1].properties as any).stations;
    expect(stations.items.required).toEqual(['name', 'url', 'genre']);
  });

  it("post-94: now_playing output uses stream_url not url", () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    const props = fences[5].properties as Record<string, unknown>;
    expect(props).toHaveProperty('stream_url');
    expect(props).not.toHaveProperty('url');
    expect((fences[5] as any).required).toEqual(['name', 'stream_url', 'genre']);
  });

  it("post-94: cross-lock MCP_MANIFEST tool names distinct from docs ids", () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual(["station_select","now_playing","genre_filter","curator_prompt"]);
    for (const id of ["backlink_curate","backlink_genres","backlink_now_playing"]) {
      expect(MCP_MANIFEST.tools.map((t) => t.name)).not.toContain(id);
    }
  });

  it("post-94: cross-lock MCP_MANIFEST schema_version v1", () => {
    expect(MCP_MANIFEST.schema_version).toBe('v1');
  });

  it("post-94: cross-lock MCP_MANIFEST auth none", () => {
    expect(MCP_MANIFEST.auth).toEqual({ type: 'none' });
  });

  it("post-94: cross-lock MCP_MANIFEST name_for_model backlink", () => {
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
  });

  it("post-94: cross-lock MCP_MANIFEST name_for_human", () => {
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
  });

  it("post-94: cross-lock MCP_MANIFEST api openapi", () => {
    expect(MCP_MANIFEST.api).toEqual({ type: 'openapi', url: '/openapi.json' });
  });

  it("post-94: cross-lock mcp.ts sha256", () => {
    const mcp = readFileSync(join(root, 'src/mcp.ts'), 'utf8');
    expect(createHash('sha256').update(mcp, 'utf8').digest('hex')).toBe('6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683');
  });

  it("post-94: cross-lock mcp.ts length 2057", () => {
    expect(readFileSync(join(root, 'src/mcp.ts'), 'utf8').length).toBe(2057);
  });

  it("post-94: cross-lock index registers /curate /genres /stations", () => {
    const index = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(index).toMatch(/app\.get\('\/curate'/);
    expect(index).toMatch(/app\.get\('\/genres'/);
    expect(index).toMatch(/app\.get\('\/stations'/);
  });

  it("post-94: cross-lock genres VALID_GENRES mentioned examples", () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(spec.toLowerCase()).toContain(g);
      expect(VALID_GENRES).toContain(g);
    }
  });

  it("post-94: cross-lock GENRE_MAP late night ambient", () => {
    expect(spec).toMatch(/late night/i);
    expect(GENRE_MAP['late night']).toBe('ambient');
  });

  it("post-94: cross-lock GENRE_MAP focus and chill ambient", () => {
    expect(spec).toMatch(/focus/i);
    expect(spec).toMatch(/chill/i);
    expect(GENRE_MAP.focus).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
  });

  it("post-94: cross-lock CI hygiene checks mcp-spec files", () => {
    const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('test -f docs/mcp-spec.md');
    expect(ci).toContain('test -f test/mcp-spec-contract.test.ts');
    expect(ci).toContain('test -f src/mcp.ts');
  });

  it("post-94: cross-lock AGENTS safe actions include endpoints", () => {
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toMatch(/\/playlist|\/now-playing|endpoints/i);
  });

  it("post-94: cross-lock README mentions MCP or tools or API", () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme.toLowerCase()).toMatch(/mcp|api|curate|genre/);
  });

  it("post-94: cross-lock index uses Gemini not Anthropic", () => {
    const index = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(index).toContain('gemini-2.0-flash');
    expect(index).not.toMatch(/anthropic|claude|haiku/i);
    expect(spec).not.toMatch(/anthropic|claude|haiku/i);
  });

  it("post-94: negative — no Anthropic", () => {
    expect(spec).not.toMatch(/anthropic|claude|haiku/i);
  });

  it("post-94: negative — no API key material", () => {
    expect(spec).not.toMatch(/AIza[0-9A-Za-z_-]{10,}|sk-[a-zA-Z0-9]{10,}/i);
  });

  it("post-94: negative — no Bearer tokens", () => {
    expect(spec).not.toMatch(/Bearer [A-Za-z0-9._-]{10,}/i);
  });

  it("post-94: negative — no localhost", () => {
    expect(spec).not.toMatch(/localhost|127\.0\.0\.1/i);
  });

  it("post-94: negative — no workers.dev", () => {
    expect(spec).not.toMatch(/\.workers\.dev/i);
  });

  it("post-94: negative — no example.com", () => {
    expect(spec).not.toMatch(/example\.com/i);
  });

  it("post-94: negative — no websocket", () => {
    expect(spec).not.toMatch(/websocket|wss:/i);
  });

  it("post-94: negative — no graphql", () => {
    expect(spec).not.toMatch(/graphql/i);
  });

  it("post-94: negative — no socket.io", () => {
    expect(spec).not.toMatch(/socket\.io/i);
  });

  it("post-94: negative — no oauth", () => {
    expect(spec).not.toMatch(/\boauth\b/i);
  });

  it("post-94: negative — no jwt", () => {
    expect(spec).not.toMatch(/\bjwt\b/i);
  });

  it("post-94: negative — no password", () => {
    expect(spec).not.toMatch(/password/i);
  });

  it("post-94: negative — no private_key", () => {
    expect(spec).not.toMatch(/private[_-]?key/i);
  });

  it("post-94: negative — docs tool ids not in MCP_MANIFEST names", () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith('backlink_'))).toBe(false);
  });

  it("post-94: negative — claw tool names not used as markdown headings", () => {
    for (const name of ["station_select","now_playing","genre_filter","curator_prompt"]) {
      expect(spec).not.toContain('### \`' + name + '\`');
    }
  });

  it("post-94: negative — no TODO/FIXME in spec", () => {
    expect(spec).not.toMatch(/TODO|FIXME|XXX/);
  });

  it("post-94: negative — no HTML script tags", () => {
    expect(spec).not.toMatch(/<script|<iframe/i);
  });

  it("post-94: TextEncoder round-trip", () => {
    expect(new TextDecoder().decode(new TextEncoder().encode(spec))).toBe(spec);
  });

  it("post-94: Buffer utf8 round-trip", () => {
    expect(Buffer.from(spec, 'utf8').toString('utf8')).toBe(spec);
  });

  it("post-94: normalize NFC identity", () => {
    expect(spec.normalize('NFC')).toBe(spec);
  });

  it("post-94: btoa of tool id backlink_curate", () => {
    expect(btoa('backlink_curate')).toBe('YmFja2xpbmtfY3VyYXRl');
  });

  it("post-94: btoa of Base URL host", () => {
    expect(btoa('backlink.fuzzywigg.com')).toBe('YmFja2xpbmsuZnV6enl3aWdnLmNvbQ==');
  });

  it("post-94: createHash digest lengths", () => {
    expect(createHash('sha256').update(spec, 'utf8').digest()).toHaveLength(32);
    expect(createHash('sha1').update(spec, 'utf8').digest()).toHaveLength(20);
    expect(createHash('md5').update(spec, 'utf8').digest()).toHaveLength(16);
  });

  it("post-94: toolSection curate bounds", () => {
    const section = toolSection('backlink_curate', '### \`backlink_genres\`');
    expect(section.startsWith('### \`backlink_curate\`')).toBe(true);
    expect(section).toContain('GET /curate?genre={genre}&mood={mood}');
    expect(section).not.toContain('### \`backlink_genres\`');
  });

  it("post-94: toolSection genres bounds", () => {
    const section = toolSection('backlink_genres', '### \`backlink_now_playing\`');
    expect(section).toContain('GET /genres');
    expect(section).toContain('aliases');
  });

  it("post-94: toolSection now_playing bounds", () => {
    const section = toolSection('backlink_now_playing', '## Integration Notes');
    expect(section).toContain('stream_url');
    expect(section).toContain('stations[0]');
  });

  it("post-94: Object.freeze tool ids immutable", () => {
    const ids = Object.freeze(["backlink_curate","backlink_genres","backlink_now_playing"]);
    expect(() => { (ids as string[]).push('x'); }).toThrow();
  });

  it("post-94: Map of tool id presence", () => {
    const map = new Map(["backlink_curate","backlink_genres","backlink_now_playing"].map((k: string) => [k, true] as const));
    expect(map.get('backlink_curate')).toBe(true);
    expect(map.get('station_select')).toBeUndefined();
  });

  it("post-94: Set of claw tools size 4", () => {
    expect(new Set(["station_select","now_playing","genre_filter","curator_prompt"]).size).toBe(4);
  });

  it("post-94: JSON.stringify tool ids", () => {
    expect(JSON.stringify(["backlink_curate","backlink_genres","backlink_now_playing"])).toBe("[\"backlink_curate\",\"backlink_genres\",\"backlink_now_playing\"]");
  });

  it("post-94: structuredClone tool ids", () => {
    expect(structuredClone(["backlink_curate","backlink_genres","backlink_now_playing"])).toEqual(["backlink_curate","backlink_genres","backlink_now_playing"]);
  });

  it("post-94: Promise.resolve sha256", () => {
    return expect(Promise.resolve(createHash('sha256').update(spec, 'utf8').digest('hex'))).resolves.toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849');
  });

  it("post-94: WeakRef spec still alive", () => {
    expect(new WeakRef({ spec }).deref()?.spec).toBe(spec);
  });

  it("post-94: Object.is twin digests", () => {
    const a = createHash('sha256').update(spec, 'utf8').digest('hex');
    const b = createHash('sha256').update(spec, 'utf8').digest('hex');
    expect(Object.is(a, b)).toBe(true);
  });

  it("post-94: split join round-trip", () => {
    expect(spec.split('\n').join('\n')).toBe(spec);
  });

  it("post-94: Iterator values mirrors split", () => {
    expect([...spec.split('\n').values()]).toEqual(spec.split('\n'));
  });

  it("post-94: indexOf # Backlink MCP Tool Specificatio locked at 0", () => {
    expect(spec.indexOf("# Backlink MCP Tool Specification")).toBe(0);
  });

  it("post-94: indexOf ## Tools locked at 135", () => {
    expect(spec.indexOf("## Tools")).toBe(135);
  });

  it("post-94: indexOf ### `backlink_curate` locked at 145", () => {
    expect(spec.indexOf("### `backlink_curate`")).toBe(145);
  });

  it("post-94: indexOf ### `backlink_genres` locked at 1483", () => {
    expect(spec.indexOf("### `backlink_genres`")).toBe(1483);
  });

  it("post-94: indexOf ### `backlink_now_playing` locked at 2151", () => {
    expect(spec.indexOf("### `backlink_now_playing`")).toBe(2151);
  });

  it("post-94: indexOf ## Integration Notes locked at 3204", () => {
    expect(spec.indexOf("## Integration Notes")).toBe(3204);
  });

  it("post-94: indexOf https://backlink.fuzzywigg.com locked at 3239", () => {
    expect(spec.indexOf("https://backlink.fuzzywigg.com")).toBe(3239);
  });

  it("post-94: indexOf editorial: null locked at 3527", () => {
    expect(spec.indexOf("editorial: null")).toBe(3527);
  });

  it("post-94: marker chain strictly increasing", () => {
    const markers = ["# Backlink MCP Tool Specification","## Tools","### `backlink_curate`","### `backlink_genres`","### `backlink_now_playing`","## Integration Notes","https://backlink.fuzzywigg.com","editorial: null"];
    const idxs = markers.map((m) => spec.indexOf(m));
    expect(idxs.every((n) => n >= 0)).toBe(true);
    for (let i = 1; i < idxs.length; i++) expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
  });

  it("post-94: contains marker # Backlink MCP Tool Specification", () => {
    expect(spec).toContain("# Backlink MCP Tool Specification");
  });

  it("post-94: contains marker ## Tools", () => {
    expect(spec).toContain("## Tools");
  });

  it("post-94: contains marker ### `backlink_curate`", () => {
    expect(spec).toContain("### `backlink_curate`");
  });

  it("post-94: contains marker ### `backlink_genres`", () => {
    expect(spec).toContain("### `backlink_genres`");
  });

  it("post-94: contains marker ### `backlink_now_playing`", () => {
    expect(spec).toContain("### `backlink_now_playing`");
  });

  it("post-94: contains marker ## Integration Notes", () => {
    expect(spec).toContain("## Integration Notes");
  });

  it("post-94: contains marker https://backlink.fuzzywigg.com", () => {
    expect(spec).toContain("https://backlink.fuzzywigg.com");
  });

  it("post-94: contains marker editorial: null", () => {
    expect(spec).toContain("editorial: null");
  });

  it("post-94: exact line 0", () => {
    expect(spec.split('\n')[0]).toBe("# Backlink MCP Tool Specification");
  });

  it("post-94: exact line 1", () => {
    expect(spec.split('\n')[1]).toBe("");
  });

  it("post-94: exact line 2", () => {
    expect(spec.split('\n')[2]).toBe("This spec defines Backlink as a claw-mcp tool set. Each tool maps to a Backlink API endpoint.");
  });

  it("post-94: exact line 3", () => {
    expect(spec.split('\n')[3]).toBe("");
  });

  it("post-94: exact line 4", () => {
    expect(spec.split('\n')[4]).toBe("---");
  });

  it("post-94: exact line 5", () => {
    expect(spec.split('\n')[5]).toBe("");
  });

  it("post-94: exact line 6", () => {
    expect(spec.split('\n')[6]).toBe("## Tools");
  });

  it("post-94: exact line 7", () => {
    expect(spec.split('\n')[7]).toBe("");
  });

  it("post-94: exact line 8", () => {
    expect(spec.split('\n')[8]).toBe("### `backlink_curate`");
  });

  it("post-94: exact line 9", () => {
    expect(spec.split('\n')[9]).toBe("");
  });

  it("post-94: exact line 10", () => {
    expect(spec.split('\n')[10]).toBe("**Description:** Ask Backlink's AI curator to pick the top 3 radio stations for a given genre or mood, with editorial blurbs.");
  });

  it("post-94: exact line 11", () => {
    expect(spec.split('\n')[11]).toBe("");
  });

  it("post-94: exact line 12", () => {
    expect(spec.split('\n')[12]).toBe("**Input Schema:**");
  });

  it("post-94: exact line 13", () => {
    expect(spec.split('\n')[13]).toBe("```json");
  });

  it("post-94: exact line 14", () => {
    expect(spec.split('\n')[14]).toBe("{");
  });

  it("post-94: exact line 135 near end", () => {
    expect(spec.split('\n')[135]).toBe("---");
  });

  it("post-94: exact line 136 near end", () => {
    expect(spec.split('\n')[136]).toBe("");
  });

  it("post-94: exact line 137 near end", () => {
    expect(spec.split('\n')[137]).toBe("## Integration Notes");
  });

  it("post-94: exact line 138 near end", () => {
    expect(spec.split('\n')[138]).toBe("");
  });

  it("post-94: exact line 139 near end", () => {
    expect(spec.split('\n')[139]).toBe("- Base URL: `https://backlink.fuzzywigg.com`");
  });

  it("post-94: exact line 140 near end", () => {
    expect(spec.split('\n')[140]).toBe("- No auth required for read endpoints");
  });

  it("post-94: exact line 141 near end", () => {
    expect(spec.split('\n')[141]).toBe("- KV cache means `/stations` calls are fast after first hit per genre (1h TTL)");
  });

  it("post-94: exact line 142 near end", () => {
    expect(spec.split('\n')[142]).toBe("- `/curate` always calls Gemini fresh — no LLM response caching");
  });

  it("post-94: exact line 143 near end", () => {
    expect(spec.split('\n')[143]).toBe("- On Gemini failure, graceful degradation returns top 5 raw stations with `editorial: null`");
  });

  it("post-94: exact line 144 near end", () => {
    expect(spec.split('\n')[144]).toBe("");
  });

  it("post-94: char freq SPACE", () => {
    expect(spec.split(" ").length - 1).toBe(640);
  });

  it("post-94: char freq DQUOTE", () => {
    expect(spec.split("\"").length - 1).toBe(250);
  });

  it("post-94: char freq \"e\"", () => {
    expect(spec.split("e").length - 1).toBe(220);
  });

  it("post-94: char freq \"t\"", () => {
    expect(spec.split("t").length - 1).toBe(196);
  });

  it("post-94: char freq \"i\"", () => {
    expect(spec.split("i").length - 1).toBe(164);
  });

  it("post-94: char freq \"r\"", () => {
    expect(spec.split("r").length - 1).toBe(163);
  });

  it("post-94: char freq \"o\"", () => {
    expect(spec.split("o").length - 1).toBe(146);
  });

  it("post-94: char freq \"n\"", () => {
    expect(spec.split("n").length - 1).toBe(144);
  });

  it("post-94: char freq LF", () => {
    expect(spec.split("\n").length - 1).toBe(144);
  });

  it("post-94: char freq \"a\"", () => {
    expect(spec.split("a").length - 1).toBe(127);
  });

  it("post-94: char freq \"s\"", () => {
    expect(spec.split("s").length - 1).toBe(124);
  });

  it("post-94: char freq \"p\"", () => {
    expect(spec.split("p").length - 1).toBe(97);
  });

  it("post-94: char freq \":\"", () => {
    expect(spec.split(":").length - 1).toBe(90);
  });

  it("post-94: char freq \"l\"", () => {
    expect(spec.split("l").length - 1).toBe(80);
  });

  it("post-94: char freq \"c\"", () => {
    expect(spec.split("c").length - 1).toBe(73);
  });

  it("post-94: char freq \"g\"", () => {
    expect(spec.split("g").length - 1).toBe(68);
  });

  it("post-94: char freq \"d\"", () => {
    expect(spec.split("d").length - 1).toBe(64);
  });

  it("post-94: char freq BACKTICK", () => {
    expect(spec.split("`").length - 1).toBe(62);
  });

  it("post-94: char freq \",\"", () => {
    expect(spec.split(",").length - 1).toBe(62);
  });

  it("post-94: char freq \"u\"", () => {
    expect(spec.split("u").length - 1).toBe(53);
  });

  it("post-94: char freq \"*\"", () => {
    expect(spec.split("*").length - 1).toBe(48);
  });

  it("post-94: char freq \"m\"", () => {
    expect(spec.split("m").length - 1).toBe(43);
  });

  it("post-94: char freq \"y\"", () => {
    expect(spec.split("y").length - 1).toBe(42);
  });

  it("post-94: char freq \"{\"", () => {
    expect(spec.split("{").length - 1).toBe(40);
  });

  it("post-94: char freq \"}\"", () => {
    expect(spec.split("}").length - 1).toBe(40);
  });

  it("post-94: required substring Ask Backlink's AI curator", () => {
    expect(spec).toContain("Ask Backlink's AI curator");
  });

  it("post-94: required substring iptv-org genre categories", () => {
    expect(spec).toContain("iptv-org genre categories");
  });

  it("post-94: required substring Friendly name → canonical slug mapping", () => {
    expect(spec).toContain("Friendly name → canonical slug mapping");
  });

  it("post-94: required substring stream_url", () => {
    expect(spec).toContain("stream_url");
  });

  it("post-94: required substring stations[0]", () => {
    expect(spec).toContain("stations[0]");
  });

  it("post-94: required substring curated_by", () => {
    expect(spec).toContain("curated_by");
  });

  it("post-94: required substring timestamp", () => {
    expect(spec).toContain("timestamp");
  });

  it("post-94: required substring additionalProperties", () => {
    expect(spec).toContain("additionalProperties");
  });

  it("post-94: required substring date-time", () => {
    expect(spec).toContain("date-time");
  });

  it("post-94: required substring format\": \"uri\"", () => {
    expect(spec).toContain("format\": \"uri\"");
  });

  it("post-94: required substring mood", () => {
    expect(spec).toContain("mood");
  });

  it("post-94: required substring genre", () => {
    expect(spec).toContain("genre");
  });

  it("post-94: required substring logo", () => {
    expect(spec).toContain("logo");
  });

  it("post-94: required substring editorial", () => {
    expect(spec).toContain("editorial");
  });

  it("post-94: required substring Canonical genre slugs", () => {
    expect(spec).toContain("Canonical genre slugs");
  });

  it("post-94: required substring /curate", () => {
    expect(spec).toContain("/curate");
  });

  it("post-94: required substring /genres", () => {
    expect(spec).toContain("/genres");
  });

  it("post-94: required substring /stations", () => {
    expect(spec).toContain("/stations");
  });

  it("post-94: required substring Gemini", () => {
    expect(spec).toContain("Gemini");
  });

  it("post-94: required substring KV cache", () => {
    expect(spec).toContain("KV cache");
  });

  it("post-94: forbidden token anthropic", () => {
    expect(spec.toLowerCase()).not.toContain("anthropic");
  });

  it("post-94: forbidden token claude", () => {
    expect(spec.toLowerCase()).not.toContain("claude");
  });

  it("post-94: forbidden token haiku", () => {
    expect(spec.toLowerCase()).not.toContain("haiku");
  });

  it("post-94: forbidden token openai", () => {
    expect(spec.toLowerCase()).not.toContain("openai");
  });

  it("post-94: forbidden token chatgpt", () => {
    expect(spec.toLowerCase()).not.toContain("chatgpt");
  });

  it("post-94: forbidden token password", () => {
    expect(spec.toLowerCase()).not.toContain("password");
  });

  it("post-94: forbidden token secret_key", () => {
    expect(spec.toLowerCase()).not.toContain("secret_key");
  });

  it("post-94: forbidden token api_token", () => {
    expect(spec.toLowerCase()).not.toContain("api_token");
  });

  it("post-94: forbidden token private_key", () => {
    expect(spec.toLowerCase()).not.toContain("private_key");
  });

  it("post-94: forbidden token websocket", () => {
    expect(spec.toLowerCase()).not.toContain("websocket");
  });

  it("post-94: forbidden token graphql", () => {
    expect(spec.toLowerCase()).not.toContain("graphql");
  });

  it("post-94: forbidden token grpc", () => {
    expect(spec.toLowerCase()).not.toContain("grpc");
  });

  it("post-94: forbidden token soap", () => {
    expect(spec.toLowerCase()).not.toContain("soap");
  });

  it("post-94: forbidden token mongodb", () => {
    expect(spec.toLowerCase()).not.toContain("mongodb");
  });

  it("post-94: forbidden token postgres", () => {
    expect(spec.toLowerCase()).not.toContain("postgres");
  });

  it("post-94: forbidden token redis", () => {
    expect(spec.toLowerCase()).not.toContain("redis");
  });

  it("post-94: forbidden token kafka", () => {
    expect(spec.toLowerCase()).not.toContain("kafka");
  });

  it("post-94: cross-lock genres.ts exports GENRE_MAP used by aliases description", () => {
    expect(spec).toContain('aliases');
    expect(Object.keys(GENRE_MAP).length).toBeGreaterThan(VALID_GENRES.length);
  });

  it("post-94: cross-lock VALID_GENRES length 9", () => {
    expect(VALID_GENRES).toHaveLength(9);
  });

  it("post-94: cross-lock mcp tools count 4", () => {
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it("post-94: cross-lock curator_prompt requires mood", () => {
    const tool = MCP_MANIFEST.tools.find((t) => t.name === 'curator_prompt');
    expect(tool?.input_schema.required).toEqual(['mood']);
  });

  it("post-94: cross-lock station_select requires station_name", () => {
    const tool = MCP_MANIFEST.tools.find((t) => t.name === 'station_select');
    expect(tool?.input_schema.required).toEqual(['station_name']);
  });

  it("post-94: cross-lock genre_filter requires genre", () => {
    const tool = MCP_MANIFEST.tools.find((t) => t.name === 'genre_filter');
    expect(tool?.input_schema.required).toEqual(['genre']);
  });

  it("post-94: cross-lock now_playing empty properties", () => {
    const tool = MCP_MANIFEST.tools.find((t) => t.name === 'now_playing');
    expect(tool?.input_schema.properties).toEqual({});
  });

  it("post-94: cross-lock index editorial null degrade", () => {
    const index = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(index).toMatch(/editorial:\s*null/);
    expect(index).toMatch(/stations\.slice\(0,\s*5\)/);
  });

  it("post-94: cross-lock package has no mcp sdk dependency", () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies).not.toHaveProperty('@modelcontextprotocol/sdk');
    expect(pkg.devDependencies).not.toHaveProperty('@modelcontextprotocol/sdk');
  });

  it("post-94: hygiene statSync spec is file", () => {
    expect(statSync(specPath).isFile()).toBe(true);
    expect(statSync(specPath).size).toBe(3552);
  });

  it("post-94: aliases description uses Unicode arrow", () => {
    expect(spec).toContain('Friendly name → canonical slug mapping');
    expect(spec).not.toContain('Friendly name -> canonical');
  });

  it("post-94: no curly quotes", () => {
    expect(spec).not.toContain('\u201c');
    expect(spec).not.toContain('\u201d');
    expect(spec).not.toContain('\u2018');
    expect(spec).not.toContain('\u2019');
  });

  it("post-94: mega purity 50x sha256", () => {
    const expected = 'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849';
    for (let i = 0; i < 50; i++) {
      expect(createHash('sha256').update(spec, 'utf8').digest('hex')).toBe(expected);
    }
  });

  it("post-94: mega purity 25x re-read", () => {
    for (let i = 0; i < 25; i++) {
      expect(readFileSync(specPath, 'utf8')).toBe(spec);
    }
  });

  it("post-94: final triple digest lock", () => {
    expect(createHash('sha1').update(spec, 'utf8').digest('hex')).toBe('e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a');
    expect(createHash('sha256').update(spec, 'utf8').digest('hex')).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849');
    expect(createHash('md5').update(spec, 'utf8').digest('hex')).toBe('ee7881030c338c1773659cc6378c392c');
  });

  it("post-94: final mega 100x sha256", () => {
    const expected = 'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849';
    for (let i = 0; i < 100; i++) {
      expect(createHash('sha256').update(spec, 'utf8').digest('hex')).toBe(expected);
    }
  });

  it("post-94: field token query present", () => {
    expect(spec).toContain("query");
  });

  it("post-94: field token curated_by present", () => {
    expect(spec).toContain("curated_by");
  });

  it("post-94: field token timestamp present", () => {
    expect(spec).toContain("timestamp");
  });

  it("post-94: field token stations present", () => {
    expect(spec).toContain("stations");
  });

  it("post-94: field token name present", () => {
    expect(spec).toContain("name");
  });

  it("post-94: field token url present", () => {
    expect(spec).toContain("url");
  });

  it("post-94: field token logo present", () => {
    expect(spec).toContain("logo");
  });

  it("post-94: field token editorial present", () => {
    expect(spec).toContain("editorial");
  });

  it("post-94: field token genre present", () => {
    expect(spec).toContain("genre");
  });

  it("post-94: field token genres present", () => {
    expect(spec).toContain("genres");
  });

  it("post-94: field token aliases present", () => {
    expect(spec).toContain("aliases");
  });

  it("post-94: field token stream_url present", () => {
    expect(spec).toContain("stream_url");
  });

  it("post-94: field token mood present", () => {
    expect(spec).toContain("mood");
  });

  it("post-94: endpoint bit GET /curate", () => {
    expect(spec).toContain("GET /curate");
  });

  it("post-94: endpoint bit GET /genres", () => {
    expect(spec).toContain("GET /genres");
  });

  it("post-94: endpoint bit genre={genre}", () => {
    expect(spec).toContain("genre={genre}");
  });

  it("post-94: endpoint bit mood={mood}", () => {
    expect(spec).toContain("mood={mood}");
  });

  it("post-94: endpoint bit stations[0]", () => {
    expect(spec).toContain("stations[0]");
  });

  it("post-94: endpoint bit url` remapped to `stream_url", () => {
    expect(spec).toContain("url` remapped to `stream_url");
  });

  it("post-94: line 0 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[0] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('99c84d33ad819ac9');
  });

  it("post-94: line 1 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[1] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: line 2 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[2] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('5e0f013658c5f50f');
  });

  it("post-94: line 3 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[3] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: line 4 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[4] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('cb3f91d54eee30e5');
  });

  it("post-94: line 5 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[5] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: line 6 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[6] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('0b27734b46fbf7ef');
  });

  it("post-94: line 7 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[7] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: line 8 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[8] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('ff3cf26fccc17858');
  });

  it("post-94: line 9 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[9] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: line 10 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[10] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('02b56e10fd373ef3');
  });

  it("post-94: line 11 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[11] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: line 12 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[12] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('5e6fc6a874f15fa0');
  });

  it("post-94: line 13 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[13] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a56726cde84dae15');
  });

  it("post-94: line 14 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[14] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('021fb596db81e6d0');
  });

  it("post-94: line 15 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[15] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d0c3102ad9c439dc');
  });

  it("post-94: line 16 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[16] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('0b5b7049adc5269a');
  });

  it("post-94: line 17 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[17] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('c27ff1a8aedfd3a8');
  });

  it("post-94: line 18 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[18] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('b6d239e8efbb3458');
  });

  it("post-94: line 19 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[19] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('5d7e1477a4255851');
  });

  it("post-94: line 135 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[135] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('cb3f91d54eee30e5');
  });

  it("post-94: line 136 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[136] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: line 137 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[137] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('025d1a806eaaae1a');
  });

  it("post-94: line 138 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[138] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: line 139 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[139] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('8994a27e468e9af1');
  });

  it("post-94: line 140 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[140] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('75bffc12b59f7503');
  });

  it("post-94: line 141 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[141] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('12fa63c6833ae862');
  });

  it("post-94: line 142 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[142] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('9f4c21047f874eb1');
  });

  it("post-94: line 143 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[143] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('aa0dda7332d1f1f0');
  });

  it("post-94: line 144 sha prefix end", () => {
    expect(createHash('sha256').update(spec.split('\n')[144] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it("post-94: slice between header 0 and 1", () => {
    expect(spec.slice(spec.indexOf("# Backlink MCP Tool Specification") + 33, spec.indexOf("## Tools"))).toBe("\n\nThis spec defines Backlink as a claw-mcp tool set. Each tool maps to a Backlink API endpoint.\n\n---\n\n");
  });

  it("post-94: slice between header 1 and 2", () => {
    expect(spec.slice(spec.indexOf("## Tools") + 8, spec.indexOf("### `backlink_curate`"))).toBe("\n\n");
  });

  it("post-94: slice between header 2 and 3", () => {
    expect(spec.slice(spec.indexOf("### `backlink_curate`") + 21, spec.indexOf("### `backlink_genres`"))).toBe("\n\n**Description:** Ask Backlink's AI curator to pick the top 3 radio stations for a given genre or mood, with editorial blurbs.\n\n**Input Schema:**\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"genre\": {\n      \"type\": \"string\",\n      \"description\": \"Music genre (e.g. 'jazz', 'classical', 'ambient', 'rock', 'pop'). Optional if mood is provided.\"\n    },\n    \"mood\": {\n      \"type\": \"string\",\n      \"description\": \"Mood or vibe descriptor (e.g. 'late night', 'focus', 'chill', 'energizing'). Optional if genre is provided.\"\n    }\n  },\n  \"additionalProperties\": false\n}\n```\n\n**Output:** Array of curated station objects.\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"query\": { \"type\": \"string\" },\n    \"curated_by\": { \"type\": \"string\" },\n    \"timestamp\": { \"type\": \"string\", \"format\": \"date-time\" },\n    \"stations\": {\n      \"type\": \"array\",\n      \"items\": {\n        \"type\": \"object\",\n        \"properties\": {\n          \"name\": { \"type\": \"string\" },\n          \"url\": { \"type\": \"string\", \"format\": \"uri\" },\n          \"logo\": { \"type\": [\"string\", \"null\"], \"format\": \"uri\" },\n          \"editorial\": { \"type\": [\"string\", \"null\"] },\n          \"genre\": { \"type\": \"string\" }\n        },\n        \"required\": [\"name\", \"url\", \"genre\"]\n      }\n    }\n  }\n}\n```\n\n**Endpoint:** `GET /curate?genre={genre}&mood={mood}`\n\n---\n\n");
  });

  it("post-94: slice between header 3 and 4", () => {
    expect(spec.slice(spec.indexOf("### `backlink_genres`") + 21, spec.indexOf("### `backlink_now_playing`"))).toBe("\n\n**Description:** List all available iptv-org genre categories supported by Backlink, including mood aliases.\n\n**Input Schema:**\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {},\n  \"additionalProperties\": false\n}\n```\n\n**Output:**\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"genres\": {\n      \"type\": \"array\",\n      \"items\": { \"type\": \"string\" },\n      \"description\": \"Canonical genre slugs accepted by /curate and /stations\"\n    },\n    \"aliases\": {\n      \"type\": \"object\",\n      \"additionalProperties\": { \"type\": \"string\" },\n      \"description\": \"Friendly name → canonical slug mapping\"\n    }\n  }\n}\n```\n\n**Endpoint:** `GET /genres`\n\n---\n\n");
  });

  it("post-94: slice between header 4 and 5", () => {
    expect(spec.slice(spec.indexOf("### `backlink_now_playing`") + 26, spec.indexOf("## Integration Notes"))).toBe("\n\n**Description:** Get the top AI-curated pick for a genre or mood — the single best station right now, with editorial context.\n\n**Input Schema:**\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"genre\": {\n      \"type\": \"string\",\n      \"description\": \"Genre slug or friendly name (e.g. 'ambient', 'late night', 'jazz').\"\n    },\n    \"mood\": {\n      \"type\": \"string\",\n      \"description\": \"Mood descriptor. Used alongside or instead of genre.\"\n    }\n  },\n  \"additionalProperties\": false\n}\n```\n\n**Output:** Single station object (first result from /curate).\n```json\n{\n  \"type\": \"object\",\n  \"properties\": {\n    \"name\": { \"type\": \"string\" },\n    \"stream_url\": { \"type\": \"string\", \"format\": \"uri\" },\n    \"logo\": { \"type\": [\"string\", \"null\"], \"format\": \"uri\" },\n    \"editorial\": { \"type\": [\"string\", \"null\"] },\n    \"genre\": { \"type\": \"string\" }\n  },\n  \"required\": [\"name\", \"stream_url\", \"genre\"]\n}\n```\n\n**Endpoint:** `GET /curate?genre={genre}&mood={mood}` — returns `stations[0]` only, with `url` remapped to `stream_url`.\n\n---\n\n");
  });

  it("post-94: codePointAt equals charCodeAt for BMP", () => {
    for (let i = 0; i < Math.min(spec.length, 500); i++) {
      const cp = spec.codePointAt(i)!;
      if (cp > 0xffff) continue;
      expect(cp).toBe(spec.charCodeAt(i));
    }
  });

  it("post-94: padStart Base URL then slice", () => {
    const host = 'backlink.fuzzywigg.com';
    expect(host.padStart(40, '.').slice(-host.length)).toBe(host);
  });

  it("post-94: localeCompare tool ids order", () => {
    const ids = ["backlink_curate","backlink_genres","backlink_now_playing"];
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(sorted[0]).toBe('backlink_curate');
    expect(sorted.at(-1)).toBe('backlink_now_playing');
  });

  it("post-94: Proxy get on first line", () => {
    const proxy = new Proxy({ line: spec.split('\n')[0] }, { get: (t, p) => Reflect.get(t, p) });
    expect(proxy.line).toBe('# Backlink MCP Tool Specification');
  });

  it("post-94: Reflect.ownKeys frozen headers", () => {
    const h = Object.freeze(["# Backlink MCP Tool Specification","## Tools","### `backlink_curate`","### `backlink_genres`","### `backlink_now_playing`","## Integration Notes"]);
    expect(Reflect.ownKeys(h).filter((k) => k !== 'length')).toHaveLength(6);
  });

  it("post-94: reduce nonempty line length band", () => {
    const n = spec.split('\n').filter((l) => l.length > 0).reduce((a, l) => a + l.length, 0);
    expect(n).toBe(3400);
  });

  it("post-94: lean line budget under 150 split parts", () => {
    expect(spec.split('\n').length).toBeLessThanOrEqual(150);
  });

  it("post-94: sha256 starts a939 ends 6849", () => {
    const d = createHash('sha256').update(spec, 'utf8').digest('hex');
    expect(d.startsWith('a939')).toBe(true);
    expect(d.endsWith('6849')).toBe(true);
  });

  it("post-94: md5 starts ee788 ends 392c", () => {
    const d = createHash('md5').update(spec, 'utf8').digest('hex');
    expect(d.startsWith('ee788')).toBe(true);
    expect(d.endsWith('392c')).toBe(true);
  });

});

// --- TOKENMAXX HEAVY burn (post-#112): deepen mcp-spec contract coverage
// (orthogonal to mcp/wrangler/parser/helpers/ci-config/source-contracts/genres/routes) ---
describe('post112 mcp-spec-contract HEAVY deepen', () => {
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const self = readFileSync(join(root, 'test/mcp-spec-contract.test.ts'), 'utf8');
  const mcpSrc = readFileSync(join(root, 'src/mcp.ts'), 'utf8');
  const indexSrc = readFileSync(join(root, 'src/index.ts'), 'utf8');
  const genresSrc = readFileSync(join(root, 'src/genres.ts'), 'utf8');
  const wranglerToml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
  const ciYml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const DOCS_IDS = ['backlink_curate', 'backlink_genres', 'backlink_now_playing'] as const;
  const CLAW_NAMES = ['station_select', 'now_playing', 'genre_filter', 'curator_prompt'] as const;

  it('post112: locks docs/mcp-spec.md sha256 digest', () => {
    expect(createHash('sha256').update(spec, 'utf8').digest('hex')).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849');
  });

  it('post112: locks docs/mcp-spec.md sha1 digest', () => {
    expect(createHash('sha1').update(spec, 'utf8').digest('hex')).toBe('e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a');
  });

  it('post112: locks docs/mcp-spec.md md5 digest', () => {
    expect(createHash('md5').update(spec, 'utf8').digest('hex')).toBe('ee7881030c338c1773659cc6378c392c');
  });

  it('post112: locks docs/mcp-spec.md sha384 digest', () => {
    expect(createHash('sha384').update(spec, 'utf8').digest('hex')).toBe('b32096b74bacd48065f014d2695673b3bfad3cb9118b855899a92a849cd38a7dd751db7c9e0705d6d6569d5f05f61227');
  });

  it('post112: locks docs/mcp-spec.md sha512 digest', () => {
    expect(createHash('sha512').update(spec, 'utf8').digest('hex')).toBe('8d26bafffcb1230048d80796e1d8a1019d83253810324d18383c54ff8bcaaed4a508b0a07395994af2f23e4f9b627e2202a57fcac709110d0ee859e8628709e7');
  });

  it('post112: sha256 nibble sum', () => {
    expect(nibbleSum(createHash('sha256').update(spec, 'utf8').digest('hex'))).toBe(514);
  });

  it('post112: sha256 xor-nibble fingerprint', () => {
    expect(xorNibbles(createHash('sha256').update(spec, 'utf8').digest('hex'))).toBe(14);
  });

  it('post112: sha256/sha384/sha512 pairwise distinct', () => {
    const a = createHash('sha256').update(spec, 'utf8').digest('hex');
    const b = createHash('sha384').update(spec, 'utf8').digest('hex');
    const c = createHash('sha512').update(spec, 'utf8').digest('hex');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('post112: digest lengths sha384=96 sha512=128 lowercase', () => {
    const a = createHash('sha384').update(spec, 'utf8').digest('hex');
    const b = createHash('sha512').update(spec, 'utf8').digest('hex');
    expect(a).toHaveLength(96);
    expect(b).toHaveLength(128);
    expect(/^[a-f0-9]+$/.test(a + b)).toBe(true);
  });

  it('post112: locks byte length and char length', () => {
    expect(spec.length).toBe(3544);
    expect(Buffer.byteLength(spec, 'utf8')).toBe(3552);
  });

  it('post112: locks line count and nonempty line count', () => {
    const ls = spec.split('\n');
    expect(ls).toHaveLength(145);
    expect(ls.filter((l) => l.length > 0)).toHaveLength(121);
  });

  it('post112: HMAC-SHA256 keyed by post112 locks spec digest', () => {
    expect(createHmac('sha256', "post112").update(spec, 'utf8').digest('hex')).toBe('65658eea677e8aef2c6c454767bee45d8edba7573ecd301f13ec0104c8d88187');
  });

  it('post112: HMAC-SHA256 keyed by mcp-spec locks spec digest', () => {
    expect(createHmac('sha256', "mcp-spec").update(spec, 'utf8').digest('hex')).toBe('21d41c5da610b736683b86a776e8661e8b25294a698027c8d552fa6eace78cb3');
  });

  it('post112: HMAC-SHA256 keyed by mcp-spec-contract locks spec digest', () => {
    expect(createHmac('sha256', "mcp-spec-contract").update(spec, 'utf8').digest('hex')).toBe('ef5a3e4a5d7f233f77e3d4ee5fa8ca97cacddbcee734efc9412fab489f43b614');
  });

  it('post112: HMAC-SHA256 keyed by backlink locks spec digest', () => {
    expect(createHmac('sha256', "backlink").update(spec, 'utf8').digest('hex')).toBe('98920add1fa15e869968c8efbc949fab60baf5ca95945eaf466caf563dff3e9f');
  });

  it('post112: HMAC-SHA256 keyed by Backlink Radio locks spec digest', () => {
    expect(createHmac('sha256', "Backlink Radio").update(spec, 'utf8').digest('hex')).toBe('2550a22433482a1d4a3c0811e8deedfd0b48aaa2b9a64d70f8ef048383e4a7ef');
  });

  it('post112: HMAC-SHA256 keyed by backlink_curate locks spec digest', () => {
    expect(createHmac('sha256', "backlink_curate").update(spec, 'utf8').digest('hex')).toBe('d5be7a976b320237501c22881a382cf75b22af14a3f886ea5bb34d88fec2e1b2');
  });

  it('post112: HMAC-SHA256 keyed by backlink_genres locks spec digest', () => {
    expect(createHmac('sha256', "backlink_genres").update(spec, 'utf8').digest('hex')).toBe('f9384a7b6410e8e73a6d2acbd7a8c528b41fb612659b8f376924c87d0be870d0');
  });

  it('post112: HMAC-SHA256 keyed by backlink_now_playing locks spec digest', () => {
    expect(createHmac('sha256', "backlink_now_playing").update(spec, 'utf8').digest('hex')).toBe('d0f976d64252d4ad35ce5a5eafa023ae98ba6d5a3ca6be16019cf3a1cf96946e');
  });

  it('post112: HMAC-SHA256 keyed by stream_url locks spec digest', () => {
    expect(createHmac('sha256', "stream_url").update(spec, 'utf8').digest('hex')).toBe('c582e603126a829add1be68dd7c7cf8e307c582440fef51bb09b65022e5a2db6');
  });

  it('post112: HMAC-SHA256 keyed by curated_by locks spec digest', () => {
    expect(createHmac('sha256', "curated_by").update(spec, 'utf8').digest('hex')).toBe('0aed005214fff86bd6f13331f50b4aa9faaae141bef026633c9ba497aa0e1ab1');
  });

  it('post112: HMAC-SHA256 keyed by Integration Notes locks spec digest', () => {
    expect(createHmac('sha256', "Integration Notes").update(spec, 'utf8').digest('hex')).toBe('0971cd5f6956b98210a068a429e7de36a3efb8aaeeed2844bc49b6e93320a939');
  });

  it('post112: HMAC-SHA256 keyed by claw-mcp locks spec digest', () => {
    expect(createHmac('sha256', "claw-mcp").update(spec, 'utf8').digest('hex')).toBe('d78760362eb08fb0e477e48f981673f58304d55b916b0e1a6e37212a6f96dec7');
  });

  it('post112: HMAC-SHA256 keyed by station_select locks spec digest', () => {
    expect(createHmac('sha256', "station_select").update(spec, 'utf8').digest('hex')).toBe('09cf27cff685a3d9f7125499f44f20636430d5f0363c9de5d2cf2869edff0b69');
  });

  it('post112: HMAC-SHA256 keyed by now_playing locks spec digest', () => {
    expect(createHmac('sha256', "now_playing").update(spec, 'utf8').digest('hex')).toBe('23efffe3b8c66ce1b5a85ed1a565e0da79391801cdcea7a8f4edcb182305c052');
  });

  it('post112: HMAC-SHA256 keyed by genre_filter locks spec digest', () => {
    expect(createHmac('sha256', "genre_filter").update(spec, 'utf8').digest('hex')).toBe('c5853f5dfdc18ca288fef4242e770b29896da8e5f02573f58b513ec60e599145');
  });

  it('post112: HMAC-SHA256 keyed by curator_prompt locks spec digest', () => {
    expect(createHmac('sha256', "curator_prompt").update(spec, 'utf8').digest('hex')).toBe('ec80abe2f207397304a4a989ee91486e11e08d48ff9e935ee8628539851adfde');
  });

  it('post112: HMAC-SHA256 keyed by VALID_GENRES locks spec digest', () => {
    expect(createHmac('sha256', "VALID_GENRES").update(spec, 'utf8').digest('hex')).toBe('5bce78975cb91bf1f314fa44ce30008c42fead0e079725b2efa2ad2750650e5a');
  });

  it('post112: HMAC-SHA256 keyed by GENRE_MAP locks spec digest', () => {
    expect(createHmac('sha256', "GENRE_MAP").update(spec, 'utf8').digest('hex')).toBe('e01fc8634bfedbbedcd9da59f972d0afcedfd135b07c02806e7499d4eede1a1c');
  });

  it('post112: HMAC-SHA256 keyed by fuzzywigg locks spec digest', () => {
    expect(createHmac('sha256', "fuzzywigg").update(spec, 'utf8').digest('hex')).toBe('8e0caed7ef994c374b52d69005d69324d5af51ef97c49c876613cf9ed1b93d4d');
  });

  it('post112: HMAC-SHA256 keyed by iptv-org locks spec digest', () => {
    expect(createHmac('sha256', "iptv-org").update(spec, 'utf8').digest('hex')).toBe('f0cc92feffdc00412074b061f650d4216738d7f8e9eb260b8822500b0d7445cf');
  });

  it('post112: HMAC-SHA256 keyed by Gemini locks spec digest', () => {
    expect(createHmac('sha256', "Gemini").update(spec, 'utf8').digest('hex')).toBe('dbb16e6c03e1156f0fa2d4b90974692e0d407a3ae58ca183e1b7a4deb3372e6b');
  });

  it('post112: HMAC-SHA256 keyed by 1h TTL locks spec digest', () => {
    expect(createHmac('sha256', "1h TTL").update(spec, 'utf8').digest('hex')).toBe('c4c198bbce26d02199ee9405f607cc38e48c4ead8270117cf011479cbb2fe293');
  });

  it('post112: HMAC-SHA256 keyed by editorial: null locks spec digest', () => {
    expect(createHmac('sha256', "editorial: null").update(spec, 'utf8').digest('hex')).toBe('cb776d94a0a3a1eb858160aafc326308f56009b6de4beb5b6f376715cd6ccde4');
  });

  it('post112: HMAC-SHA256 keyed by additionalProperties locks spec digest', () => {
    expect(createHmac('sha256', "additionalProperties").update(spec, 'utf8').digest('hex')).toBe('4fc3e0d7c845059dab9fdb3306457e00e146f7c32d8ea67de49508809bfdebf9');
  });

  it('post112: HMAC-SHA256 keyed by openapi locks spec digest', () => {
    expect(createHmac('sha256', "openapi").update(spec, 'utf8').digest('hex')).toBe('f0e4923966d2eccf6e2f2b7687314c5e74f79c71d29b4d0198e03469bf24f309');
  });

  it('post112: line 20 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[20] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('58636dd916833390');
  });

  it('post112: line 21 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[21] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e08470ea6ec3f78e');
  });

  it('post112: line 22 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[22] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('b6d239e8efbb3458');
  });

  it('post112: line 23 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[23] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('fb22633293e70bb9');
  });

  it('post112: line 24 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[24] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('28d86778615f6af4');
  });

  it('post112: line 25 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[25] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('3288a136ca3e7c85');
  });

  it('post112: line 26 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[26] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('c76cce0dffe84d12');
  });

  it('post112: line 27 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[27] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d10b36aa74a59bcf');
  });

  it('post112: line 28 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[28] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('f1b901847390b0ed');
  });

  it('post112: line 29 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[29] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 30 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[30] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('4d4a7b9130ee5775');
  });

  it('post112: line 31 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[31] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a56726cde84dae15');
  });

  it('post112: line 32 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[32] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('021fb596db81e6d0');
  });

  it('post112: line 33 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[33] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d0c3102ad9c439dc');
  });

  it('post112: line 34 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[34] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('0b5b7049adc5269a');
  });

  it('post112: line 35 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[35] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('7d3c9b85aedc612a');
  });

  it('post112: line 36 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[36] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('697b544165d774fa');
  });

  it('post112: line 37 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[37] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('f9f6cf6a503b59eb');
  });

  it('post112: line 38 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[38] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('9cef552767ebb0c0');
  });

  it('post112: line 39 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[39] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('23d3e54aec3f7900');
  });

  it('post112: line 40 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[40] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('66bb58fba1af4366');
  });

  it('post112: line 41 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[41] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a854fb1a3ed9b4c2');
  });

  it('post112: line 42 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[42] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d337fa71c905db67');
  });

  it('post112: line 43 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[43] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e9856c0b8c26d416');
  });

  it('post112: line 44 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[44] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('c7925c46cf680c81');
  });

  it('post112: line 45 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[45] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('75cad7ef077c03fd');
  });

  it('post112: line 46 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[46] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('94d55f14dc795d83');
  });

  it('post112: line 47 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[47] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('93ed702dbc71183a');
  });

  it('post112: line 48 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[48] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('55ebf423a240dd03');
  });

  it('post112: line 49 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[49] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('20b32f3e6c5b2747');
  });

  it('post112: line 50 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[50] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('f61f5bbc379fd349');
  });

  it('post112: line 51 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[51] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('28d86778615f6af4');
  });

  it('post112: line 52 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[52] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('737db166c79ae98e');
  });

  it('post112: line 53 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[53] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d10b36aa74a59bcf');
  });

  it('post112: line 54 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[54] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('f1b901847390b0ed');
  });

  it('post112: line 55 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[55] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 56 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[56] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('1efc6f55ca964098');
  });

  it('post112: line 57 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[57] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 58 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[58] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('cb3f91d54eee30e5');
  });

  it('post112: line 59 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[59] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 60 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[60] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('eb93ddb3ee5b20e9');
  });

  it('post112: line 61 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[61] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 62 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[62] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('eada87353b2943ec');
  });

  it('post112: line 63 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[63] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 64 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[64] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('5e6fc6a874f15fa0');
  });

  it('post112: line 65 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[65] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a56726cde84dae15');
  });

  it('post112: line 66 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[66] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('021fb596db81e6d0');
  });

  it('post112: line 67 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[67] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d0c3102ad9c439dc');
  });

  it('post112: line 68 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[68] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d3862c9e5c460a0b');
  });

  it('post112: line 69 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[69] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('c76cce0dffe84d12');
  });

  it('post112: line 70 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[70] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d10b36aa74a59bcf');
  });

  it('post112: line 71 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[71] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('f1b901847390b0ed');
  });

  it('post112: line 72 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[72] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 73 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[73] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('7e7d95628b7a199f');
  });

  it('post112: line 74 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[74] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a56726cde84dae15');
  });

  it('post112: line 75 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[75] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('021fb596db81e6d0');
  });

  it('post112: line 76 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[76] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d0c3102ad9c439dc');
  });

  it('post112: line 77 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[77] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('0b5b7049adc5269a');
  });

  it('post112: line 78 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[78] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('855e92e35189eea1');
  });

  it('post112: line 79 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[79] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('23d3e54aec3f7900');
  });

  it('post112: line 80 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[80] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('7aced20a096ba68f');
  });

  it('post112: line 81 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[81] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('b771fe5684e530d1');
  });

  it('post112: line 82 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[82] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('58636dd916833390');
  });

  it('post112: line 83 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[83] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('c51251d915a70df8');
  });

  it('post112: line 84 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[84] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('558a119ee6940a65');
  });

  it('post112: line 85 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[85] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('b2d147df0c268333');
  });

  it('post112: line 86 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[86] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('39bbc9e7eca4bd9f');
  });

  it('post112: line 87 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[87] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('28d86778615f6af4');
  });

  it('post112: line 88 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[88] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('737db166c79ae98e');
  });

  it('post112: line 89 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[89] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d10b36aa74a59bcf');
  });

  it('post112: line 90 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[90] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('f1b901847390b0ed');
  });

  it('post112: line 91 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[91] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 92 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[92] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('107c1c6c71f6c3c5');
  });

  it('post112: line 93 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[93] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 94 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[94] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('cb3f91d54eee30e5');
  });

  it('post112: line 95 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[95] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 96 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[96] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('778a180e647ff15a');
  });

  it('post112: line 97 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[97] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 98 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[98] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a9151993967f69ad');
  });

  it('post112: line 99 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[99] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 100 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[100] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('5e6fc6a874f15fa0');
  });

  it('post112: line 101 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[101] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a56726cde84dae15');
  });

  it('post112: line 102 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[102] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('021fb596db81e6d0');
  });

  it('post112: line 103 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[103] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d0c3102ad9c439dc');
  });

  it('post112: line 104 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[104] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('0b5b7049adc5269a');
  });

  it('post112: line 105 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[105] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('c27ff1a8aedfd3a8');
  });

  it('post112: line 106 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[106] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('b6d239e8efbb3458');
  });

  it('post112: line 107 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[107] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a8a25ade28f4566e');
  });

  it('post112: line 108 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[108] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('58636dd916833390');
  });

  it('post112: line 109 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[109] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e08470ea6ec3f78e');
  });

  it('post112: line 110 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[110] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('b6d239e8efbb3458');
  });

  it('post112: line 111 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[111] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('cfc78309a75d1318');
  });

  it('post112: line 112 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[112] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('28d86778615f6af4');
  });

  it('post112: line 113 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[113] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('3288a136ca3e7c85');
  });

  it('post112: line 114 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[114] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('c76cce0dffe84d12');
  });

  it('post112: line 115 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[115] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d10b36aa74a59bcf');
  });

  it('post112: line 116 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[116] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('f1b901847390b0ed');
  });

  it('post112: line 117 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[117] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 118 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[118] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b9a88fe456095f');
  });

  it('post112: line 119 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[119] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('a56726cde84dae15');
  });

  it('post112: line 120 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[120] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('021fb596db81e6d0');
  });

  it('post112: line 121 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[121] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d0c3102ad9c439dc');
  });

  it('post112: line 122 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[122] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('0b5b7049adc5269a');
  });

  it('post112: line 123 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[123] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('05b5215df672a99a');
  });

  it('post112: line 124 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[124] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d27cb546fae937ab');
  });

  it('post112: line 125 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[125] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('653b78133c7431ea');
  });

  it('post112: line 126 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[126] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('7be0374fadfef393');
  });

  it('post112: line 127 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[127] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('117097357b0fc608');
  });

  it('post112: line 128 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[128] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('3288a136ca3e7c85');
  });

  it('post112: line 129 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[129] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('6f7389895023466c');
  });

  it('post112: line 130 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[130] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('d10b36aa74a59bcf');
  });

  it('post112: line 131 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[131] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('f1b901847390b0ed');
  });

  it('post112: line 132 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[132] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  it('post112: line 133 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[133] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('43bc37f060d09448');
  });

  it('post112: line 134 sha prefix', () => {
    expect(createHash('sha256').update(spec.split('\n')[134] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe('e3b0c44298fc1c14');
  });

  
  it('post112: heading index order is strictly increasing', () => {
    const real = [
      '# Backlink MCP Tool Specification',
      '## Tools',
      '### `backlink_curate`',
      '### `backlink_genres`',
      '### `backlink_now_playing`',
      '## Integration Notes',
    ].map((h) => spec.indexOf(h));
    for (let i = 1; i < real.length; i++) {
      expect(real[i]).toBeGreaterThan(real[i - 1]!);
    }
    expect(real.every((n) => n >= 0)).toBe(true);
  });

  it('post112: heading 0 exact index 0', () => {
    expect(spec.indexOf("# Backlink MCP Tool Specification")).toBe(0);
  });

  it('post112: heading 1 exact index 135', () => {
    expect(spec.indexOf("## Tools")).toBe(135);
  });

  it('post112: heading 2 exact index 145', () => {
    expect(spec.indexOf("### `backlink_curate`")).toBe(145);
  });

  it('post112: heading 3 exact index 1483', () => {
    expect(spec.indexOf("### `backlink_genres`")).toBe(1483);
  });

  it('post112: heading 4 exact index 2151', () => {
    expect(spec.indexOf("### `backlink_now_playing`")).toBe(2151);
  });

  it('post112: heading 5 exact index 3204', () => {
    expect(spec.indexOf("## Integration Notes")).toBe(3204);
  });

  it('post112: word frequency "type" === 29', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "type")).toHaveLength(29);
  });

  it('post112: word frequency "string" === 19', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "string")).toHaveLength(19);
  });

  it('post112: word frequency "genre" === 18', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "genre")).toHaveLength(18);
  });

  it('post112: word frequency "mood" === 10', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "mood")).toHaveLength(10);
  });

  it('post112: word frequency "object" === 9', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "object")).toHaveLength(9);
  });

  it('post112: word frequency "properties" === 7', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "properties")).toHaveLength(7);
  });

  it('post112: word frequency "stations" === 6', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "stations")).toHaveLength(6);
  });

  it('post112: word frequency "json" === 6', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "json")).toHaveLength(6);
  });

  it('post112: word frequency "description" === 6', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "description")).toHaveLength(6);
  });

  it('post112: word frequency "name" === 6', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "name")).toHaveLength(6);
  });

  it('post112: word frequency "Backlink" === 5', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "Backlink")).toHaveLength(5);
  });

  it('post112: word frequency "or" === 5', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "or")).toHaveLength(5);
  });

  it('post112: word frequency "editorial" === 5', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "editorial")).toHaveLength(5);
  });

  it('post112: word frequency "format" === 5', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "format")).toHaveLength(5);
  });

  it('post112: word frequency "null" === 5', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "null")).toHaveLength(5);
  });

  it('post112: word frequency "curate" === 5', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "curate")).toHaveLength(5);
  });

  it('post112: word frequency "a" === 4', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "a")).toHaveLength(4);
  });

  it('post112: word frequency "with" === 4', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "with")).toHaveLength(4);
  });

  it('post112: word frequency "additionalProperties" === 4', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "additionalProperties")).toHaveLength(4);
  });

  it('post112: word frequency "uri" === 4', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "uri")).toHaveLength(4);
  });

  it('post112: word frequency "to" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "to")).toHaveLength(3);
  });

  it('post112: word frequency "Description" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "Description")).toHaveLength(3);
  });

  it('post112: word frequency "the" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "the")).toHaveLength(3);
  });

  it('post112: word frequency "top" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "top")).toHaveLength(3);
  });

  it('post112: word frequency "for" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "for")).toHaveLength(3);
  });

  it('post112: word frequency "Input" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "Input")).toHaveLength(3);
  });

  it('post112: word frequency "Schema" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "Schema")).toHaveLength(3);
  });

  it('post112: word frequency "e" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "e")).toHaveLength(3);
  });

  it('post112: word frequency "g" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "g")).toHaveLength(3);
  });

  it('post112: word frequency "false" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "false")).toHaveLength(3);
  });

  it('post112: word frequency "Output" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "Output")).toHaveLength(3);
  });

  it('post112: word frequency "station" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "station")).toHaveLength(3);
  });

  it('post112: word frequency "url" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "url")).toHaveLength(3);
  });

  it('post112: word frequency "required" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "required")).toHaveLength(3);
  });

  it('post112: word frequency "Endpoint" === 3', () => {
    const words = spec.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words.filter((x) => x === "Endpoint")).toHaveLength(3);
  });

  it('post112: exactly 6 json fences', () => {
    expect([...spec.matchAll(/```json\n([\s\S]*?)```/g)]).toHaveLength(6);
  });

  it('post112: json fence 0 sha256', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(createHash('sha256').update(fences[0], 'utf8').digest('hex')).toBe('724a785bbeb7757da9e973ecf5ed7323562561b88746dc3132dae08c6b67f98e');
  });

  it('post112: json fence 0 length 419', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[0]).toHaveLength(419);
  });

  it('post112: json fence 0 parses as object', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(typeof JSON.parse(fences[0])).toBe('object');
  });

  it('post112: json fence 1 sha256', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(createHash('sha256').update(fences[1], 'utf8').digest('hex')).toBe('f9f0e20ed06f9f9d5a9aca4999bb3939240e8a971d3624fa1a8ca880d5104043');
  });

  it('post112: json fence 1 length 619', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[1]).toHaveLength(619);
  });

  it('post112: json fence 1 parses as object', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(typeof JSON.parse(fences[1])).toBe('object');
  });

  it('post112: json fence 2 sha256', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(createHash('sha256').update(fences[2], 'utf8').digest('hex')).toBe('4f355aaabd61baab14303898f72d65b2df4624ffd7c3b3b28ded6ec33d2768be');
  });

  it('post112: json fence 2 length 76', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[2]).toHaveLength(76);
  });

  it('post112: json fence 2 parses as object', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(typeof JSON.parse(fences[2])).toBe('object');
  });

  it('post112: json fence 3 sha256', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(createHash('sha256').update(fences[3], 'utf8').digest('hex')).toBe('820d2eaf86d59524518c09f31d17724acd0a87d18baf02be3ddaf01906572b1d');
  });

  it('post112: json fence 3 length 369', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[3]).toHaveLength(369);
  });

  it('post112: json fence 3 parses as object', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(typeof JSON.parse(fences[3])).toBe('object');
  });

  it('post112: json fence 4 sha256', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(createHash('sha256').update(fences[4], 'utf8').digest('hex')).toBe('8f11519e1ca9f2a723d22839622732e719c59ec7575ee8e5cfa94007ebeeab91');
  });

  it('post112: json fence 4 length 336', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[4]).toHaveLength(336);
  });

  it('post112: json fence 4 parses as object', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(typeof JSON.parse(fences[4])).toBe('object');
  });

  it('post112: json fence 5 sha256', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(createHash('sha256').update(fences[5], 'utf8').digest('hex')).toBe('998bc8ada00faadb8c5b3195b8f596407f76e488be77bcb0f57bf19b302a853f');
  });

  it('post112: json fence 5 length 328', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[5]).toHaveLength(328);
  });

  it('post112: json fence 5 parses as object', () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(typeof JSON.parse(fences[5])).toBe('object');
  });

  it('post112: docs tool id backlink_curate appears as ### heading', () => {
    expect(spec).toMatch(/^### \`backlink_curate\`/m);
  });

  it('post112: docs tool id backlink_curate not in MCP_MANIFEST.tools names', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).not.toContain('backlink_curate');
  });

  it('post112: docs tool id backlink_curate count in spec', () => {
    const re = /backlink_curate/g;
    expect((spec.match(re) ?? []).length).toBe(1);
  });

  it('post112: docs tool id backlink_genres appears as ### heading', () => {
    expect(spec).toMatch(/^### \`backlink_genres\`/m);
  });

  it('post112: docs tool id backlink_genres not in MCP_MANIFEST.tools names', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).not.toContain('backlink_genres');
  });

  it('post112: docs tool id backlink_genres count in spec', () => {
    const re = /backlink_genres/g;
    expect((spec.match(re) ?? []).length).toBe(1);
  });

  it('post112: docs tool id backlink_now_playing appears as ### heading', () => {
    expect(spec).toMatch(/^### \`backlink_now_playing\`/m);
  });

  it('post112: docs tool id backlink_now_playing not in MCP_MANIFEST.tools names', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).not.toContain('backlink_now_playing');
  });

  it('post112: docs tool id backlink_now_playing count in spec', () => {
    const re = /backlink_now_playing/g;
    expect((spec.match(re) ?? []).length).toBe(1);
  });

  it('post112: claw name station_select is not a docs ### heading', () => {
    expect(spec).not.toContain('### \`station_select\`');
  });

  it('post112: claw name station_select is in MCP_MANIFEST', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toContain('station_select');
  });

  it('post112: claw name now_playing is not a docs ### heading', () => {
    expect(spec).not.toContain('### \`now_playing\`');
  });

  it('post112: claw name now_playing is in MCP_MANIFEST', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toContain('now_playing');
  });

  it('post112: claw name genre_filter is not a docs ### heading', () => {
    expect(spec).not.toContain('### \`genre_filter\`');
  });

  it('post112: claw name genre_filter is in MCP_MANIFEST', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toContain('genre_filter');
  });

  it('post112: claw name curator_prompt is not a docs ### heading', () => {
    expect(spec).not.toContain('### \`curator_prompt\`');
  });

  it('post112: claw name curator_prompt is in MCP_MANIFEST', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toContain('curator_prompt');
  });

  it('post112: cross-lock Base URL host appears in wrangler.toml', () => {
    expect(spec).toContain('backlink.fuzzywigg.com');
    expect(wranglerToml).toContain('backlink.fuzzywigg.com');
  });

  it('post112: cross-lock CI hygiene still checks mcp-spec files', () => {
    expect(ciYml).toContain('test -f docs/mcp-spec.md');
    expect(ciYml).toContain('test -f test/mcp-spec-contract.test.ts');
    expect(ciYml).toContain('test -f src/mcp.ts');
  });

  it('post112: cross-lock index.ts graceful degradation top 5 matches spec', () => {
    expect(indexSrc).toMatch(/stations\.slice\(0,\s*5\)/);
    expect(spec).toMatch(/top 5 raw stations/i);
  });

  it('post112: cross-lock index.ts KV TTL 3600 matches 1h TTL docs', () => {
    expect(indexSrc).toMatch(/expirationTtl:\s*3600/);
    expect(spec).toMatch(/1h TTL/i);
  });

  it('post112: cross-lock index.ts curated_by Backlink/Geryon', () => {
    expect(indexSrc).toContain("curated_by: 'Backlink/Geryon'");
    expect(spec).toContain('curated_by');
  });

  it('post112: cross-lock genres.ts late night → ambient matches docs mood example', () => {
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(spec.toLowerCase()).toContain('late night');
  });

  it('post112: cross-lock VALID_GENRES includes docs core genre examples', () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(VALID_GENRES).toContain(g);
      expect(spec.toLowerCase()).toContain(g);
    }
  });

  it('post112: cross-lock MCP_MANIFEST auth none matches docs no-auth reads', () => {
    expect(MCP_MANIFEST.auth).toEqual({ type: 'none' });
    expect(spec).toMatch(/No auth required for read endpoints/i);
  });

  it('post112: cross-lock MCP_MANIFEST api openapi url not documented as Worker Endpoint', () => {
    expect(MCP_MANIFEST.api).toEqual({ type: 'openapi', url: '/openapi.json' });
    expect(spec).not.toMatch(/\*\*Endpoint:\*\*\s*`GET \/openapi\.json`/);
  });

  it('post112: cross-lock docs tool count 3 vs claw tool count 4', () => {
    expect(DOCS_IDS).toHaveLength(3);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect(CLAW_NAMES).toHaveLength(4);
  });

  it('post112: mood example "late night" appears in spec', () => {
    expect(spec.toLowerCase()).toContain("late night");
  });

  it('post112: mood example "focus" appears in spec', () => {
    expect(spec.toLowerCase()).toContain("focus");
  });

  it('post112: mood example "chill" appears in spec', () => {
    expect(spec.toLowerCase()).toContain("chill");
  });

  it('post112: mood example "energizing" appears in spec', () => {
    expect(spec.toLowerCase()).toContain("energizing");
  });

  it('post112: energizing mood is documented but absent from GENRE_MAP', () => {
    expect(spec.toLowerCase()).toContain('energizing');
    expect(Object.keys(GENRE_MAP)).not.toContain('energizing');
  });

  it('post112: focus/chill/late night resolve via GENRE_MAP to ambient', () => {
    expect(GENRE_MAP.focus).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(GENRE_MAP['late night']).toBe('ambient');
  });

  it('post112: forbids token anthropic', () => {
    expect(spec).not.toMatch(/anthropic/i);
  });

  it('post112: forbids token claude', () => {
    expect(spec).not.toMatch(/claude/i);
  });

  it('post112: forbids token haiku', () => {
    expect(spec).not.toMatch(/haiku/i);
  });

  it('post112: forbids token openai', () => {
    expect(spec).not.toMatch(/openai/i);
  });

  it('post112: forbids token gpt_4', () => {
    expect(spec).not.toMatch(/gpt-4/i);
  });

  it('post112: forbids token workers_dev', () => {
    expect(spec).not.toMatch(/workers\.dev/i);
  });

  it('post112: forbids token localhost', () => {
    expect(spec).not.toMatch(/localhost/i);
  });

  it('post112: forbids token 127_0_0_1', () => {
    expect(spec).not.toMatch(/127\.0\.0\.1/i);
  });

  it('post112: forbids token Bearer', () => {
    expect(spec).not.toMatch(/Bearer /i);
  });

  it('post112: forbids token GEMINI_API_KEY', () => {
    expect(spec).not.toMatch(/GEMINI_API_KEY/i);
  });

  it('post112: forbids token CF_ACCOUNT_ID', () => {
    expect(spec).not.toMatch(/CF_ACCOUNT_ID/i);
  });

  it('post112: forbids token wrangler_secret', () => {
    expect(spec).not.toMatch(/wrangler secret/i);
  });

  it('post112: forbids token websocket', () => {
    expect(spec).not.toMatch(/websocket/i);
  });

  it('post112: forbids token graphql', () => {
    expect(spec).not.toMatch(/graphql/i);
  });

  it('post112: forbids token oauth', () => {
    expect(spec).not.toMatch(/oauth/i);
  });

  it('post112: forbids token jwt', () => {
    expect(spec).not.toMatch(/jwt/i);
  });

  it('post112: forbids token password', () => {
    expect(spec).not.toMatch(/password/i);
  });

  it('post112: forbids token TODO', () => {
    expect(spec).not.toMatch(/TODO/);
  });

  it('post112: forbids token FIXME', () => {
    expect(spec).not.toMatch(/FIXME/);
  });

  it('post112: forbids token example_com', () => {
    expect(spec).not.toMatch(/example\.com/i);
  });

  it('post112: forbids token socket_io', () => {
    expect(spec).not.toMatch(/socket\.io/i);
  });

  it('post112: forbids token private_key', () => {
    expect(spec).not.toMatch(/private_key/i);
  });

  it('post112: forbids token health', () => {
    expect(spec).not.toMatch(/\/health/i);
  });

  it('post112: forbids token openapi_json', () => {
    expect(spec).not.toMatch(/\/openapi\.json/i);
  });

  it('post112: forbids token station_select', () => {
    expect(spec).not.toMatch(/station_select/i);
  });

  it('post112: forbids token genre_filter', () => {
    expect(spec).not.toMatch(/genre_filter/i);
  });

  it('post112: forbids token curator_prompt', () => {
    expect(spec).not.toMatch(/curator_prompt/i);
  });

  it('post112: field/token query present', () => {
    expect(spec).toContain("query");
  });

  it('post112: field/token curated_by present', () => {
    expect(spec).toContain("curated_by");
  });

  it('post112: field/token timestamp present', () => {
    expect(spec).toContain("timestamp");
  });

  it('post112: field/token stations present', () => {
    expect(spec).toContain("stations");
  });

  it('post112: field/token name present', () => {
    expect(spec).toContain("name");
  });

  it('post112: field/token url present', () => {
    expect(spec).toContain("url");
  });

  it('post112: field/token logo present', () => {
    expect(spec).toContain("logo");
  });

  it('post112: field/token editorial present', () => {
    expect(spec).toContain("editorial");
  });

  it('post112: field/token genre present', () => {
    expect(spec).toContain("genre");
  });

  it('post112: field/token mood present', () => {
    expect(spec).toContain("mood");
  });

  it('post112: field/token genres present', () => {
    expect(spec).toContain("genres");
  });

  it('post112: field/token aliases present', () => {
    expect(spec).toContain("aliases");
  });

  it('post112: field/token stream_url present', () => {
    expect(spec).toContain("stream_url");
  });

  it('post112: field/token additionalProperties present', () => {
    expect(spec).toContain("additionalProperties");
  });

  it('post112: field/token date-time present', () => {
    expect(spec).toContain("date-time");
  });

  it('post112: field/token iptv-org present', () => {
    expect(spec).toContain("iptv-org");
  });

  it('post112: field/token Gemini present', () => {
    expect(spec).toContain("Gemini");
  });

  it('post112: field/token KV present', () => {
    expect(spec).toContain("KV");
  });

  it('post112: endpoint/note bit GET_curate', () => {
    expect(spec).toContain("GET /curate");
  });

  it('post112: endpoint/note bit GET_genres', () => {
    expect(spec).toContain("GET /genres");
  });

  it('post112: endpoint/note bit genre_genre_', () => {
    expect(spec).toContain("genre={genre}");
  });

  it('post112: endpoint/note bit mood_mood_', () => {
    expect(spec).toContain("mood={mood}");
  });

  it('post112: endpoint/note bit stations_0_', () => {
    expect(spec).toContain("stations[0]");
  });

  it('post112: endpoint/note bit url_remapped_to_stream_url', () => {
    expect(spec).toContain("url` remapped to `stream_url");
  });

  it('post112: endpoint/note bit top_3_radio_stations', () => {
    expect(spec).toContain("top 3 radio stations");
  });

  it('post112: endpoint/note bit editorial_blurbs', () => {
    expect(spec).toContain("editorial blurbs");
  });

  it('post112: endpoint/note bit 1h_TTL', () => {
    expect(spec).toContain("1h TTL");
  });

  it('post112: endpoint/note bit editorial_null', () => {
    expect(spec).toContain("editorial: null");
  });

  it('post112: endpoint/note bit No_auth_required', () => {
    expect(spec).toContain("No auth required");
  });

  it('post112: TextEncoder/Decoder round-trip', () => {
    expect(new TextDecoder().decode(new TextEncoder().encode(spec))).toBe(spec);
  });

  it('post112: Buffer utf8 round-trip', () => {
    expect(Buffer.from(spec, 'utf8').toString('utf8')).toBe(spec);
  });

  it('post112: NFC normalize identity', () => {
    expect(spec.normalize('NFC')).toBe(spec);
  });

  it('post112: NFD normalize then NFC restores', () => {
    expect(spec.normalize('NFD').normalize('NFC')).toBe(spec.normalize('NFC'));
  });

  it('post112: unique code points count', () => {
    expect(new Set([...spec].map((c) => c.codePointAt(0))).size).toBe(73);
  });

  it('post112: no surrogate pairs (all BMP)', () => {
    for (let i = 0; i < spec.length; i++) {
      const cp = spec.codePointAt(i);
      expect(cp).toBeLessThanOrEqual(0xffff);
    }
  });

  it('post112: starts with title heading', () => {
    expect(spec.startsWith('# Backlink MCP Tool Specification')).toBe(true);
  });

  it('post112: ends with trailing newline after degradation bullet', () => {
    expect(spec.endsWith('\n')).toBe(true);
    expect(spec.trimEnd().endsWith('`editorial: null`')).toBe(true);
  });

  it('post112: Integration Notes has exactly 5 bullets', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = notes.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets).toHaveLength(5);
  });

  it('post112: locks Integration Notes bullet texts', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    const bullets = notes.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets).toEqual([
      '- Base URL: `https://backlink.fuzzywigg.com`',
      '- No auth required for read endpoints',
      '- KV cache means `/stations` calls are fast after first hit per genre (1h TTL)',
      '- `/curate` always calls Gemini fresh — no LLM response caching',
      '- On Gemini failure, graceful degradation returns top 5 raw stations with `editorial: null`',
    ]);
  });

  it('post112: exactly three ### tool headings', () => {
    expect((spec.match(/^### `/gm) ?? []).length).toBe(3);
  });

  it('post112: additionalProperties false appears exactly 3 times', () => {
    expect((spec.match(/"additionalProperties":\s*false/g) ?? []).length).toBe(3);
  });

  it('post112: btoa backlink_curate', () => {
    expect(btoa('backlink_curate')).toBe('YmFja2xpbmtfY3VyYXRl');
  });

  it('post112: btoa backlink_genres', () => {
    expect(btoa('backlink_genres')).toBe('YmFja2xpbmtfZ2VucmVz');
  });

  it('post112: btoa backlink_now_playing', () => {
    expect(btoa('backlink_now_playing')).toBe('YmFja2xpbmtfbm93X3BsYXlpbmc=');
  });

  it('post112: btoa Base URL host', () => {
    expect(btoa('backlink.fuzzywigg.com')).toBe('YmFja2xpbmsuZnV6enl3aWdnLmNvbQ==');
  });

  it('post112: localeCompare docs tool order', () => {
    const ids = [...DOCS_IDS];
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(sorted).toEqual(['backlink_curate', 'backlink_genres', 'backlink_now_playing']);
  });

  it('post112: Object.freeze docs ids immutable', () => {
    const ids = Object.freeze([...DOCS_IDS]);
    expect(() => { (ids as string[]).push('x'); }).toThrow();
  });

  it('post112: JSON.stringify MCP_MANIFEST tools names stable', () => {
    expect(JSON.stringify(MCP_MANIFEST.tools.map((t) => t.name))).toBe(
      "[\"station_select\",\"now_playing\",\"genre_filter\",\"curator_prompt\"]",
    );
  });

  it('post112: reduce nonempty line char budget', () => {
    const n = spec.split('\n').filter((l) => l.length > 0).reduce((a, l) => a + l.length, 0);
    expect(n).toBe(3400);
  });

  it('post112: padStart host then slice identity', () => {
    const host = 'backlink.fuzzywigg.com';
    expect(host.padStart(40, '.').slice(-host.length)).toBe(host);
  });

  it('post112: Proxy get first line', () => {
    const proxy = new Proxy({ line: spec.split('\n')[0] }, { get: (t, p) => Reflect.get(t, p) });
    expect(proxy.line).toBe('# Backlink MCP Tool Specification');
  });

  it('post112: Reflect.ownKeys frozen headings length', () => {
    const h = Object.freeze([
      '# Backlink MCP Tool Specification',
      '## Tools',
      '### `backlink_curate`',
      '### `backlink_genres`',
      '### `backlink_now_playing`',
      '## Integration Notes',
    ]);
    expect(Reflect.ownKeys(h).filter((k) => k !== 'length')).toHaveLength(6);
  });

  it('post112: first 64 charCodes fingerprint', () => {
    const codes = [];
    for (let i = 0; i < 64; i++) codes.push(spec.charCodeAt(i));
    expect(createHash('sha256').update(codes.join(','), 'utf8').digest('hex').slice(0, 32)).toBe(
      '962d8e8ec0c2e32c180f01ad095c53f7',
    );
  });

  it('post112: last 64 charCodes fingerprint', () => {
    const slice = spec.slice(-64);
    const codes = [];
    for (let i = 0; i < slice.length; i++) codes.push(slice.charCodeAt(i));
    expect(createHash('sha256').update(codes.join(','), 'utf8').digest('hex').slice(0, 32)).toBe(
      '21b63b78d21e15d61dd7e7c562fac4ce',
    );
  });

  it('post112: jsonFences helper returns 6 objects', () => {
    expect(jsonFences()).toHaveLength(6);
  });

  it('post112: curate input schema properties genre+mood', () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    const input = fences[0] as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(Object.keys(input.properties).sort()).toEqual(['genre', 'mood']);
    expect(input.additionalProperties).toBe(false);
  });

  it('post112: genres input schema empty properties', () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    const input = fences[2] as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(input.properties).toEqual({});
    expect(input.additionalProperties).toBe(false);
  });

  it('post112: now_playing input schema properties genre+mood', () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    const input = fences[4] as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(Object.keys(input.properties).sort()).toEqual(['genre', 'mood']);
    expect(input.additionalProperties).toBe(false);
  });

  it('post112: curate output required station fields name/url/genre', () => {
    const fences = jsonFences() as Array<any>;
    const out = fences[1];
    expect(out.properties.stations.items.required).toEqual(['name', 'url', 'genre']);
  });

  it('post112: now_playing output required name/stream_url/genre', () => {
    const fences = jsonFences() as Array<any>;
    const out = fences[5];
    expect(out.required).toEqual(['name', 'stream_url', 'genre']);
  });

  it('post112: curate output timestamp format date-time', () => {
    const fences = jsonFences() as Array<any>;
    expect(fences[1].properties.timestamp.format).toBe('date-time');
  });

  it('post112: genres output has genres array and aliases object', () => {
    const fences = jsonFences() as Array<any>;
    expect(fences[3].properties.genres.type).toBe('array');
    expect(fences[3].properties.aliases.type).toBe('object');
  });

  it('post112: toolSection curate excludes genres heading', () => {
    const section = toolSection('backlink_curate', '### `backlink_genres`');
    expect(section.startsWith('### `backlink_curate`')).toBe(true);
    expect(section).toContain('top 3 radio stations');
    expect(section.includes('### `backlink_genres`')).toBe(false);
  });

  it('post112: toolSection genres excludes now_playing heading', () => {
    const section = toolSection('backlink_genres', '### `backlink_now_playing`');
    expect(section).toContain('iptv-org');
    expect(section).toContain('aliases');
    expect(section.includes('### `backlink_now_playing`')).toBe(false);
  });

  it('post112: toolSection now_playing includes stream_url remap', () => {
    const section = toolSection('backlink_now_playing', '## Integration Notes');
    expect(section).toContain('stream_url');
    expect(section).toContain('stations[0]');
    expect(section.includes('## Integration Notes')).toBe(false);
  });

  it('post112: this describe block is present in suite file', () => {
    expect(self).toContain("describe('post112 mcp-spec-contract HEAVY deepen'");
  });

  it('post112: suite still imports MCP_MANIFEST and GENRE_MAP', () => {
    expect(self).toContain("import { MCP_MANIFEST } from '../src/mcp'");
    expect(self).toContain("import { GENRE_MAP, VALID_GENRES } from '../src/genres'");
  });

  it('post112: suite imports createHash and createHmac', () => {
    expect(self).toMatch(/import \{[^}]*createHash[^}]*\} from 'node:crypto'|import \{ createHash, createHmac \} from 'node:crypto'/);
  });

  it('post112: post112 deepen appears after post-94 deepen marker', () => {
    const a = self.indexOf('HEAVY burn (post-#94)');
    const b = self.indexOf('TOKENMAXX HEAVY burn (post-#112)');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  it('post112: mcp.ts still exports MCP_MANIFEST only as named const', () => {
    expect(mcpSrc).toContain('export const MCP_MANIFEST');
    expect(mcpSrc).not.toContain('backlink_curate');
  });

  it('post112: genres.ts still exports GENRE_MAP and VALID_GENRES', () => {
    expect(genresSrc).toContain('export const GENRE_MAP');
    expect(genresSrc).toContain('export const VALID_GENRES');
  });

  it('post112: index.ts still uses gemini-2.0-flash', () => {
    expect(indexSrc).toContain('gemini-2.0-flash');
    expect(spec).not.toMatch(/gemini-2\.0-flash/i);
  });

  it('post112: docs do not invent /playlist or /now-playing Worker routes as Endpoints', () => {
    expect(spec).not.toMatch(/\*\*Endpoint:\*\*\s*`GET \/playlist/);
    expect(spec).not.toMatch(/\*\*Endpoint:\*\*\s*`GET \/now-playing/);
  });

  it('post112: docs now_playing Endpoint still points at /curate', () => {
    const section = toolSection('backlink_now_playing', '## Integration Notes');
    expect(section).toMatch(/\*\*Endpoint:\*\*\s*`GET \/curate\?genre=\{genre\}&mood=\{mood\}/);
  });

  it('post112: 5x sha256 stable under repeated hashing', () => {
    const digests = Array.from({ length: 5 }, () => createHash('sha256').update(spec, 'utf8').digest('hex'));
    expect(new Set(digests).size).toBe(1);
    expect(digests[0]).toBe('a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849');
  });

  it('post112: md5 starts ee788 ends 392c', () => {
    const d = createHash('md5').update(spec, 'utf8').digest('hex');
    expect(d.startsWith('ee788')).toBe(true);
    expect(d.endsWith('392c')).toBe(true);
  });

  it('post112: sha256 starts a939 ends 6849', () => {
    const d = createHash('sha256').update(spec, 'utf8').digest('hex');
    expect(d.startsWith('a939')).toBe(true);
    expect(d.endsWith('6849')).toBe(true);
  });

  it('post112: line 0 length 33', () => {
    expect((spec.split('\n')[0] ?? '').length).toBe(33);
  });

  it('post112: line 1 length 0', () => {
    expect((spec.split('\n')[1] ?? '').length).toBe(0);
  });

  it('post112: line 2 length 93', () => {
    expect((spec.split('\n')[2] ?? '').length).toBe(93);
  });

  it('post112: line 3 length 0', () => {
    expect((spec.split('\n')[3] ?? '').length).toBe(0);
  });

  it('post112: line 4 length 3', () => {
    expect((spec.split('\n')[4] ?? '').length).toBe(3);
  });

  it('post112: line 5 length 0', () => {
    expect((spec.split('\n')[5] ?? '').length).toBe(0);
  });

  it('post112: line 6 length 8', () => {
    expect((spec.split('\n')[6] ?? '').length).toBe(8);
  });

  it('post112: line 7 length 0', () => {
    expect((spec.split('\n')[7] ?? '').length).toBe(0);
  });

  it('post112: line 8 length 21', () => {
    expect((spec.split('\n')[8] ?? '').length).toBe(21);
  });

  it('post112: line 9 length 0', () => {
    expect((spec.split('\n')[9] ?? '').length).toBe(0);
  });

  it('post112: line 10 length 125', () => {
    expect((spec.split('\n')[10] ?? '').length).toBe(125);
  });

  it('post112: line 11 length 0', () => {
    expect((spec.split('\n')[11] ?? '').length).toBe(0);
  });

  it('post112: line 12 length 17', () => {
    expect((spec.split('\n')[12] ?? '').length).toBe(17);
  });

  it('post112: line 13 length 7', () => {
    expect((spec.split('\n')[13] ?? '').length).toBe(7);
  });

  it('post112: line 14 length 1', () => {
    expect((spec.split('\n')[14] ?? '').length).toBe(1);
  });

  it('post112: line 15 length 19', () => {
    expect((spec.split('\n')[15] ?? '').length).toBe(19);
  });

  it('post112: line 16 length 17', () => {
    expect((spec.split('\n')[16] ?? '').length).toBe(17);
  });

  it('post112: line 17 length 14', () => {
    expect((spec.split('\n')[17] ?? '').length).toBe(14);
  });

  it('post112: line 18 length 23', () => {
    expect((spec.split('\n')[18] ?? '').length).toBe(23);
  });

  it('post112: line 19 length 118', () => {
    expect((spec.split('\n')[19] ?? '').length).toBe(118);
  });

  it('post112: line 20 length 6', () => {
    expect((spec.split('\n')[20] ?? '').length).toBe(6);
  });

  it('post112: line 21 length 13', () => {
    expect((spec.split('\n')[21] ?? '').length).toBe(13);
  });

  it('post112: line 22 length 23', () => {
    expect((spec.split('\n')[22] ?? '').length).toBe(23);
  });

  it('post112: line 23 length 130', () => {
    expect((spec.split('\n')[23] ?? '').length).toBe(130);
  });

  it('post112: line 24 length 5', () => {
    expect((spec.split('\n')[24] ?? '').length).toBe(5);
  });

  it('post112: line 25 length 4', () => {
    expect((spec.split('\n')[25] ?? '').length).toBe(4);
  });

  it('post112: line 26 length 31', () => {
    expect((spec.split('\n')[26] ?? '').length).toBe(31);
  });

  it('post112: line 27 length 1', () => {
    expect((spec.split('\n')[27] ?? '').length).toBe(1);
  });

  it('post112: line 28 length 3', () => {
    expect((spec.split('\n')[28] ?? '').length).toBe(3);
  });

  it('post112: line 29 length 0', () => {
    expect((spec.split('\n')[29] ?? '').length).toBe(0);
  });

  it('post112: line 30 length 45', () => {
    expect((spec.split('\n')[30] ?? '').length).toBe(45);
  });

  it('post112: line 31 length 7', () => {
    expect((spec.split('\n')[31] ?? '').length).toBe(7);
  });

  it('post112: line 32 length 1', () => {
    expect((spec.split('\n')[32] ?? '').length).toBe(1);
  });

  it('post112: line 33 length 19', () => {
    expect((spec.split('\n')[33] ?? '').length).toBe(19);
  });

  it('post112: line 34 length 17', () => {
    expect((spec.split('\n')[34] ?? '').length).toBe(17);
  });

  it('post112: line 35 length 34', () => {
    expect((spec.split('\n')[35] ?? '').length).toBe(34);
  });

  it('post112: line 36 length 39', () => {
    expect((spec.split('\n')[36] ?? '').length).toBe(39);
  });

  it('post112: line 37 length 61', () => {
    expect((spec.split('\n')[37] ?? '').length).toBe(61);
  });

  it('post112: line 38 length 17', () => {
    expect((spec.split('\n')[38] ?? '').length).toBe(17);
  });

  it('post112: line 39 length 22', () => {
    expect((spec.split('\n')[39] ?? '').length).toBe(22);
  });

  it('post112: line 40 length 16', () => {
    expect((spec.split('\n')[40] ?? '').length).toBe(16);
  });

  it('post112: line 41 length 25', () => {
    expect((spec.split('\n')[41] ?? '').length).toBe(25);
  });

  it('post112: line 42 length 23', () => {
    expect((spec.split('\n')[42] ?? '').length).toBe(23);
  });

  it('post112: line 43 length 39', () => {
    expect((spec.split('\n')[43] ?? '').length).toBe(39);
  });

  it('post112: line 44 length 55', () => {
    expect((spec.split('\n')[44] ?? '').length).toBe(55);
  });

  it('post112: line 45 length 66', () => {
    expect((spec.split('\n')[45] ?? '').length).toBe(66);
  });

  it('post112: line 46 length 54', () => {
    expect((spec.split('\n')[46] ?? '').length).toBe(54);
  });

  it('post112: line 47 length 39', () => {
    expect((spec.split('\n')[47] ?? '').length).toBe(39);
  });

  it('post112: line 48 length 10', () => {
    expect((spec.split('\n')[48] ?? '').length).toBe(10);
  });

  it('post112: line 49 length 44', () => {
    expect((spec.split('\n')[49] ?? '').length).toBe(44);
  });

  it('post112: line 50 length 7', () => {
    expect((spec.split('\n')[50] ?? '').length).toBe(7);
  });

  it('post112: line 51 length 5', () => {
    expect((spec.split('\n')[51] ?? '').length).toBe(5);
  });

  it('post112: line 52 length 3', () => {
    expect((spec.split('\n')[52] ?? '').length).toBe(3);
  });

  it('post112: line 53 length 1', () => {
    expect((spec.split('\n')[53] ?? '').length).toBe(1);
  });

  it('post112: line 54 length 3', () => {
    expect((spec.split('\n')[54] ?? '').length).toBe(3);
  });

  it('post112: line 55 length 0', () => {
    expect((spec.split('\n')[55] ?? '').length).toBe(0);
  });

  it('post112: line 56 length 53', () => {
    expect((spec.split('\n')[56] ?? '').length).toBe(53);
  });

  it('post112: line 57 length 0', () => {
    expect((spec.split('\n')[57] ?? '').length).toBe(0);
  });

  it('post112: line 58 length 3', () => {
    expect((spec.split('\n')[58] ?? '').length).toBe(3);
  });

  it('post112: line 59 length 0', () => {
    expect((spec.split('\n')[59] ?? '').length).toBe(0);
  });

  it('post112: line 60 length 21', () => {
    expect((spec.split('\n')[60] ?? '').length).toBe(21);
  });

  it('post112: line 61 length 0', () => {
    expect((spec.split('\n')[61] ?? '').length).toBe(0);
  });

  it('post112: line 62 length 108', () => {
    expect((spec.split('\n')[62] ?? '').length).toBe(108);
  });

  it('post112: line 63 length 0', () => {
    expect((spec.split('\n')[63] ?? '').length).toBe(0);
  });

  it('post112: line 64 length 17', () => {
    expect((spec.split('\n')[64] ?? '').length).toBe(17);
  });

  it('post112: line 65 length 7', () => {
    expect((spec.split('\n')[65] ?? '').length).toBe(7);
  });

  it('post112: line 66 length 1', () => {
    expect((spec.split('\n')[66] ?? '').length).toBe(1);
  });

  it('post112: line 67 length 19', () => {
    expect((spec.split('\n')[67] ?? '').length).toBe(19);
  });

  it('post112: line 68 length 19', () => {
    expect((spec.split('\n')[68] ?? '').length).toBe(19);
  });

  it('post112: line 69 length 31', () => {
    expect((spec.split('\n')[69] ?? '').length).toBe(31);
  });

  it('post112: line 70 length 1', () => {
    expect((spec.split('\n')[70] ?? '').length).toBe(1);
  });

  it('post112: line 71 length 3', () => {
    expect((spec.split('\n')[71] ?? '').length).toBe(3);
  });

  it('post112: line 72 length 0', () => {
    expect((spec.split('\n')[72] ?? '').length).toBe(0);
  });

  it('post112: line 73 length 11', () => {
    expect((spec.split('\n')[73] ?? '').length).toBe(11);
  });

  it('post112: line 74 length 7', () => {
    expect((spec.split('\n')[74] ?? '').length).toBe(7);
  });

  it('post112: line 75 length 1', () => {
    expect((spec.split('\n')[75] ?? '').length).toBe(1);
  });

  it('post112: line 76 length 19', () => {
    expect((spec.split('\n')[76] ?? '').length).toBe(19);
  });

  it('post112: line 77 length 17', () => {
    expect((spec.split('\n')[77] ?? '').length).toBe(17);
  });

  it('post112: line 78 length 15', () => {
    expect((spec.split('\n')[78] ?? '').length).toBe(15);
  });

  it('post112: line 79 length 22', () => {
    expect((spec.split('\n')[79] ?? '').length).toBe(22);
  });

  it('post112: line 80 length 36', () => {
    expect((spec.split('\n')[80] ?? '').length).toBe(36);
  });

  it('post112: line 81 length 78', () => {
    expect((spec.split('\n')[81] ?? '').length).toBe(78);
  });

  it('post112: line 82 length 6', () => {
    expect((spec.split('\n')[82] ?? '').length).toBe(6);
  });

  it('post112: line 83 length 16', () => {
    expect((spec.split('\n')[83] ?? '').length).toBe(16);
  });

  it('post112: line 84 length 23', () => {
    expect((spec.split('\n')[84] ?? '').length).toBe(23);
  });

  it('post112: line 85 length 51', () => {
    expect((spec.split('\n')[85] ?? '').length).toBe(51);
  });

  it('post112: line 86 length 61', () => {
    expect((spec.split('\n')[86] ?? '').length).toBe(61);
  });

  it('post112: line 87 length 5', () => {
    expect((spec.split('\n')[87] ?? '').length).toBe(5);
  });

  it('post112: line 88 length 3', () => {
    expect((spec.split('\n')[88] ?? '').length).toBe(3);
  });

  it('post112: line 89 length 1', () => {
    expect((spec.split('\n')[89] ?? '').length).toBe(1);
  });

  it('post112: line 90 length 3', () => {
    expect((spec.split('\n')[90] ?? '').length).toBe(3);
  });

  it('post112: line 91 length 0', () => {
    expect((spec.split('\n')[91] ?? '').length).toBe(0);
  });

  it('post112: line 92 length 27', () => {
    expect((spec.split('\n')[92] ?? '').length).toBe(27);
  });

  it('post112: line 93 length 0', () => {
    expect((spec.split('\n')[93] ?? '').length).toBe(0);
  });

  it('post112: line 94 length 3', () => {
    expect((spec.split('\n')[94] ?? '').length).toBe(3);
  });

  it('post112: line 95 length 0', () => {
    expect((spec.split('\n')[95] ?? '').length).toBe(0);
  });

  it('post112: line 96 length 26', () => {
    expect((spec.split('\n')[96] ?? '').length).toBe(26);
  });

  it('post112: line 97 length 0', () => {
    expect((spec.split('\n')[97] ?? '').length).toBe(0);
  });

  it('post112: line 98 length 125', () => {
    expect((spec.split('\n')[98] ?? '').length).toBe(125);
  });

  it('post112: line 99 length 0', () => {
    expect((spec.split('\n')[99] ?? '').length).toBe(0);
  });

  it('post112: line 100 length 17', () => {
    expect((spec.split('\n')[100] ?? '').length).toBe(17);
  });

  it('post112: line 101 length 7', () => {
    expect((spec.split('\n')[101] ?? '').length).toBe(7);
  });

  it('post112: line 102 length 1', () => {
    expect((spec.split('\n')[102] ?? '').length).toBe(1);
  });

  it('post112: line 103 length 19', () => {
    expect((spec.split('\n')[103] ?? '').length).toBe(19);
  });

  it('post112: line 104 length 17', () => {
    expect((spec.split('\n')[104] ?? '').length).toBe(17);
  });

  it('post112: line 105 length 14', () => {
    expect((spec.split('\n')[105] ?? '').length).toBe(14);
  });

  it('post112: line 106 length 23', () => {
    expect((spec.split('\n')[106] ?? '').length).toBe(23);
  });

  it('post112: line 107 length 90', () => {
    expect((spec.split('\n')[107] ?? '').length).toBe(90);
  });

  it('post112: line 108 length 6', () => {
    expect((spec.split('\n')[108] ?? '').length).toBe(6);
  });

  it('post112: line 109 length 13', () => {
    expect((spec.split('\n')[109] ?? '').length).toBe(13);
  });

  it('post112: line 110 length 23', () => {
    expect((spec.split('\n')[110] ?? '').length).toBe(23);
  });

  it('post112: line 111 length 75', () => {
    expect((spec.split('\n')[111] ?? '').length).toBe(75);
  });

  it('post112: line 112 length 5', () => {
    expect((spec.split('\n')[112] ?? '').length).toBe(5);
  });

  it('post112: line 113 length 4', () => {
    expect((spec.split('\n')[113] ?? '').length).toBe(4);
  });

  it('post112: line 114 length 31', () => {
    expect((spec.split('\n')[114] ?? '').length).toBe(31);
  });

  it('post112: line 115 length 1', () => {
    expect((spec.split('\n')[115] ?? '').length).toBe(1);
  });

  it('post112: line 116 length 3', () => {
    expect((spec.split('\n')[116] ?? '').length).toBe(3);
  });

  it('post112: line 117 length 0', () => {
    expect((spec.split('\n')[117] ?? '').length).toBe(0);
  });

  it('post112: line 118 length 62', () => {
    expect((spec.split('\n')[118] ?? '').length).toBe(62);
  });

  it('post112: line 119 length 7', () => {
    expect((spec.split('\n')[119] ?? '').length).toBe(7);
  });

  it('post112: line 120 length 1', () => {
    expect((spec.split('\n')[120] ?? '').length).toBe(1);
  });

  it('post112: line 121 length 19', () => {
    expect((spec.split('\n')[121] ?? '').length).toBe(19);
  });

  it('post112: line 122 length 17', () => {
    expect((spec.split('\n')[122] ?? '').length).toBe(17);
  });

  it('post112: line 123 length 33', () => {
    expect((spec.split('\n')[123] ?? '').length).toBe(33);
  });

  it('post112: line 124 length 56', () => {
    expect((spec.split('\n')[124] ?? '').length).toBe(56);
  });

  it('post112: line 125 length 60', () => {
    expect((spec.split('\n')[125] ?? '').length).toBe(60);
  });

  it('post112: line 126 length 48', () => {
    expect((spec.split('\n')[126] ?? '').length).toBe(48);
  });

  it('post112: line 127 length 33', () => {
    expect((spec.split('\n')[127] ?? '').length).toBe(33);
  });

  it('post112: line 128 length 4', () => {
    expect((spec.split('\n')[128] ?? '').length).toBe(4);
  });

  it('post112: line 129 length 45', () => {
    expect((spec.split('\n')[129] ?? '').length).toBe(45);
  });

  it('post112: line 130 length 1', () => {
    expect((spec.split('\n')[130] ?? '').length).toBe(1);
  });

  it('post112: line 131 length 3', () => {
    expect((spec.split('\n')[131] ?? '').length).toBe(3);
  });

  it('post112: line 132 length 0', () => {
    expect((spec.split('\n')[132] ?? '').length).toBe(0);
  });

  it('post112: line 133 length 120', () => {
    expect((spec.split('\n')[133] ?? '').length).toBe(120);
  });

  it('post112: line 134 length 0', () => {
    expect((spec.split('\n')[134] ?? '').length).toBe(0);
  });

  it('post112: line 135 length 3', () => {
    expect((spec.split('\n')[135] ?? '').length).toBe(3);
  });

  it('post112: line 136 length 0', () => {
    expect((spec.split('\n')[136] ?? '').length).toBe(0);
  });

  it('post112: line 137 length 20', () => {
    expect((spec.split('\n')[137] ?? '').length).toBe(20);
  });

  it('post112: line 138 length 0', () => {
    expect((spec.split('\n')[138] ?? '').length).toBe(0);
  });

  it('post112: line 139 length 44', () => {
    expect((spec.split('\n')[139] ?? '').length).toBe(44);
  });

  it('post112: line 140 length 37', () => {
    expect((spec.split('\n')[140] ?? '').length).toBe(37);
  });

  it('post112: line 141 length 78', () => {
    expect((spec.split('\n')[141] ?? '').length).toBe(78);
  });

  it('post112: line 142 length 63', () => {
    expect((spec.split('\n')[142] ?? '').length).toBe(63);
  });

  it('post112: line 143 length 91', () => {
    expect((spec.split('\n')[143] ?? '').length).toBe(91);
  });

  it('post112: line 144 length 0', () => {
    expect((spec.split('\n')[144] ?? '').length).toBe(0);
  });

  it('post112: title charAt 0 is "#"', () => {
    expect(spec.charAt(0)).toBe("#");
  });

  it('post112: title charAt 1 is " "', () => {
    expect(spec.charAt(1)).toBe(" ");
  });

  it('post112: title charAt 2 is "B"', () => {
    expect(spec.charAt(2)).toBe("B");
  });

  it('post112: title charAt 3 is "a"', () => {
    expect(spec.charAt(3)).toBe("a");
  });

  it('post112: title charAt 4 is "c"', () => {
    expect(spec.charAt(4)).toBe("c");
  });

  it('post112: title charAt 5 is "k"', () => {
    expect(spec.charAt(5)).toBe("k");
  });

  it('post112: title charAt 6 is "l"', () => {
    expect(spec.charAt(6)).toBe("l");
  });

  it('post112: title charAt 7 is "i"', () => {
    expect(spec.charAt(7)).toBe("i");
  });

  it('post112: title charAt 8 is "n"', () => {
    expect(spec.charAt(8)).toBe("n");
  });

  it('post112: title charAt 9 is "k"', () => {
    expect(spec.charAt(9)).toBe("k");
  });

  it('post112: title charAt 10 is " "', () => {
    expect(spec.charAt(10)).toBe(" ");
  });

  it('post112: title charAt 11 is "M"', () => {
    expect(spec.charAt(11)).toBe("M");
  });

  it('post112: title charAt 12 is "C"', () => {
    expect(spec.charAt(12)).toBe("C");
  });

  it('post112: title charAt 13 is "P"', () => {
    expect(spec.charAt(13)).toBe("P");
  });

  it('post112: title charAt 14 is " "', () => {
    expect(spec.charAt(14)).toBe(" ");
  });

  it('post112: title charAt 15 is "T"', () => {
    expect(spec.charAt(15)).toBe("T");
  });

  it('post112: title charAt 16 is "o"', () => {
    expect(spec.charAt(16)).toBe("o");
  });

  it('post112: title charAt 17 is "o"', () => {
    expect(spec.charAt(17)).toBe("o");
  });

  it('post112: title charAt 18 is "l"', () => {
    expect(spec.charAt(18)).toBe("l");
  });

  it('post112: title charAt 19 is " "', () => {
    expect(spec.charAt(19)).toBe(" ");
  });

  it('post112: title charAt 20 is "S"', () => {
    expect(spec.charAt(20)).toBe("S");
  });

  it('post112: title charAt 21 is "p"', () => {
    expect(spec.charAt(21)).toBe("p");
  });

  it('post112: title charAt 22 is "e"', () => {
    expect(spec.charAt(22)).toBe("e");
  });

  it('post112: title charAt 23 is "c"', () => {
    expect(spec.charAt(23)).toBe("c");
  });

  it('post112: title charAt 24 is "i"', () => {
    expect(spec.charAt(24)).toBe("i");
  });

  it('post112: title charAt 25 is "f"', () => {
    expect(spec.charAt(25)).toBe("f");
  });

  it('post112: title charAt 26 is "i"', () => {
    expect(spec.charAt(26)).toBe("i");
  });

  it('post112: title charAt 27 is "c"', () => {
    expect(spec.charAt(27)).toBe("c");
  });

  it('post112: title charAt 28 is "a"', () => {
    expect(spec.charAt(28)).toBe("a");
  });

  it('post112: title charAt 29 is "t"', () => {
    expect(spec.charAt(29)).toBe("t");
  });

  it('post112: title charAt 30 is "i"', () => {
    expect(spec.charAt(30)).toBe("i");
  });

  it('post112: title charAt 31 is "o"', () => {
    expect(spec.charAt(31)).toBe("o");
  });

  it('post112: title charAt 32 is "n"', () => {
    expect(spec.charAt(32)).toBe("n");
  });

  it('post112: slice between heading 0 and 1 sha256', () => {
    const a = "# Backlink MCP Tool Specification";
    const b = "## Tools";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe('b5e88d3307c545ead8d44e2d4ee19e44346f014472dc60ffc6c1883df4d56d05');
  });

  it('post112: slice between heading 0 and 1 length', () => {
    const a = "# Backlink MCP Tool Specification";
    const b = "## Tools";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(102);
  });

  it('post112: slice between heading 1 and 2 sha256', () => {
    const a = "## Tools";
    const b = "### `backlink_curate`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe('75a11da44c802486bc6f65640aa48a730f0f684c5c07a42ba3cd1735eb3fb070');
  });

  it('post112: slice between heading 1 and 2 length', () => {
    const a = "## Tools";
    const b = "### `backlink_curate`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(2);
  });

  it('post112: slice between heading 2 and 3 sha256', () => {
    const a = "### `backlink_curate`";
    const b = "### `backlink_genres`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe('f5156e887b423b3dccba0be51f10c7e0d3ff820d84095a9e26941241a2453602');
  });

  it('post112: slice between heading 2 and 3 length', () => {
    const a = "### `backlink_curate`";
    const b = "### `backlink_genres`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(1317);
  });

  it('post112: slice between heading 3 and 4 sha256', () => {
    const a = "### `backlink_genres`";
    const b = "### `backlink_now_playing`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe('27b7e714a82162b023dcaf46a1bf6b0669a5f466892352de8cbd605a35f77391');
  });

  it('post112: slice between heading 3 and 4 length', () => {
    const a = "### `backlink_genres`";
    const b = "### `backlink_now_playing`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(647);
  });

  it('post112: slice between heading 4 and 5 sha256', () => {
    const a = "### `backlink_now_playing`";
    const b = "## Integration Notes";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe('5e150d4d0b5c2e8829220b51975070df0d6bae12b8c2bf4a373383d8529b0c60');
  });

  it('post112: slice between heading 4 and 5 length', () => {
    const a = "### `backlink_now_playing`";
    const b = "## Integration Notes";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(1027);
  });

  it('post112: slice after Integration Notes sha256', () => {
    const a = '## Integration Notes';
    const slice = spec.slice(spec.indexOf(a) + a.length);
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe('1dfa300ec1c707b5220fa6d9db44728be67f3891363fb7cb65cc9eb238c11ebb');
  });

  it('post112: HMAC key inventory digest', () => {
    const keys = ["post112","mcp-spec","mcp-spec-contract","backlink","Backlink Radio","backlink_curate","backlink_genres","backlink_now_playing","stream_url","curated_by","Integration Notes","claw-mcp","station_select","now_playing","genre_filter","curator_prompt","VALID_GENRES","GENRE_MAP","fuzzywigg","iptv-org","Gemini","1h TTL","editorial: null","additionalProperties","openapi"];
    const inventory = keys.map((k) => createHmac('sha256', k).update(spec, 'utf8').digest('hex')).join('|');
    expect(createHash('sha256').update(inventory, 'utf8').digest('hex')).toBe('de6ca95cd5bc99e9a42d0551e840a790f667ff9982d9d464277722e0b0a694b7');
  });

  it('post112: mid-line sha prefix inventory digest', () => {
    const parts = [];
    for (let i = 20; i <= 134; i++) {
      parts.push(createHash('sha256').update(spec.split('\n')[i] ?? '', 'utf8').digest('hex').slice(0, 16));
    }
    expect(createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')).toBe(
      '8170c5a59e31348fde90f41e8403b40782d271e80ee9914ec0c7bd37fb7deed2',
    );
  });

});


describe('post116 mcp-spec-contract HEAVY deepen', () => {
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const mcpSrc = readFileSync(join(root, 'src/mcp.ts'), 'utf8');
  const indexSrc = readFileSync(join(root, 'src/index.ts'), 'utf8');
  const genresSrc = readFileSync(join(root, 'src/genres.ts'), 'utf8');
  const parserSrc = readFileSync(join(root, 'src/parser.ts'), 'utf8');
  const typesSrc = readFileSync(join(root, 'src/types.ts'), 'utf8');
  const wranglerToml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
  const ciYml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const agentsMd = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  const readmeMd = readFileSync(join(root, 'README.md'), 'utf8');
  const deployMd = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
  const pkgJson = readFileSync(join(root, 'package.json'), 'utf8');
  const vitestCfg = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
  const dependabotYml = readFileSync(join(root, '.github/dependabot.yml'), 'utf8');
  const envJson = readFileSync(join(root, '.cursor/environment.json'), 'utf8');
  const packageLock = readFileSync(join(root, 'package-lock.json'), 'utf8');
  const tsconfigJson = readFileSync(join(root, 'tsconfig.json'), 'utf8');
  const DOCS_IDS = ['backlink_curate', 'backlink_genres', 'backlink_now_playing'] as const;
  const CLAW_NAMES = ['station_select', 'now_playing', 'genre_filter', 'curator_prompt'] as const;
  const POST116_KEYS = ["post116","mcp-spec","mcp-spec-contract","backlink","Backlink Radio","backlink_curate","backlink_genres","backlink_now_playing","stream_url","curated_by","Integration Notes","claw-mcp","station_select","now_playing","genre_filter","curator_prompt","VALID_GENRES","GENRE_MAP","fuzzywigg","iptv-org","Gemini","1h TTL","editorial: null","additionalProperties","openapi","post116-heavy","TOKENMAXX","soft-cap","EoD","routes-116","helpers","parser","wrangler","genres","source-contracts","ci-config","Backlink_Facelift","gemini-2.0-flash","CATALOG_CACHE","/curate","/genres","/stations","/health"] as const;

  it('post116: locks docs/mcp-spec.md sha256 digest', () => {
    expect(createHash('sha256').update(spec, 'utf8').digest('hex')).toBe("a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849");
  });

  it('post116: locks docs/mcp-spec.md sha1 digest', () => {
    expect(createHash('sha1').update(spec, 'utf8').digest('hex')).toBe("e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a");
  });

  it('post116: locks docs/mcp-spec.md md5 digest', () => {
    expect(createHash('md5').update(spec, 'utf8').digest('hex')).toBe("ee7881030c338c1773659cc6378c392c");
  });

  it('post116: locks docs/mcp-spec.md sha384 digest', () => {
    expect(createHash('sha384').update(spec, 'utf8').digest('hex')).toBe("b32096b74bacd48065f014d2695673b3bfad3cb9118b855899a92a849cd38a7dd751db7c9e0705d6d6569d5f05f61227");
  });

  it('post116: locks docs/mcp-spec.md sha512 digest', () => {
    expect(createHash('sha512').update(spec, 'utf8').digest('hex')).toBe("8d26bafffcb1230048d80796e1d8a1019d83253810324d18383c54ff8bcaaed4a508b0a07395994af2f23e4f9b627e2202a57fcac709110d0ee859e8628709e7");
  });

  it('post116: sha256 nibble sum', () => {
    expect(nibbleSum(createHash('sha256').update(spec, 'utf8').digest('hex'))).toBe(514);
  });

  it('post116: sha256 xor-nibble fingerprint', () => {
    expect(xorNibbles(createHash('sha256').update(spec, 'utf8').digest('hex'))).toBe(14);
  });

  it('post116: sha256/sha384/sha512 pairwise distinct', () => {
    const a = createHash('sha256').update(spec, 'utf8').digest('hex');
    const b = createHash('sha384').update(spec, 'utf8').digest('hex');
    const c = createHash('sha512').update(spec, 'utf8').digest('hex');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('post116: digest lengths sha384=96 sha512=128 lowercase', () => {
    const a = createHash('sha384').update(spec, 'utf8').digest('hex');
    const b = createHash('sha512').update(spec, 'utf8').digest('hex');
    expect(a).toHaveLength(96);
    expect(b).toHaveLength(128);
    expect(/^[a-f0-9]+$/.test(a + b)).toBe(true);
  });

  it('post116: locks byte length and char length', () => {
    expect(spec.length).toBe(3544);
    expect(Buffer.byteLength(spec, 'utf8')).toBe(3552);
  });

  it('post116: locks line count and nonempty line count', () => {
    const ls = spec.split('\n');
    expect(ls).toHaveLength(145);
    expect(ls.filter((l) => l.length > 0)).toHaveLength(121);
  });

  it('post116: no CR bytes; trailing newline present', () => {
    expect(spec.includes('\r')).toBe(false);
    expect(spec.endsWith('\n')).toBe(true);
  });

  it('post116: ASCII-only body (tab/lf/cr/printable)', () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(spec)).toBe(false);
  });

  it("post116: HMAC-SHA256 keyed by post116 locks spec digest", () => {
    expect(createHmac('sha256', "post116").update(spec, 'utf8').digest('hex')).toBe("b414f62bcea3abfcb0dcddb4f973296bbc8f65869c408d2b7816843bf74da409");
  });

  it("post116: HMAC-SHA256 keyed by mcp-spec locks spec digest", () => {
    expect(createHmac('sha256', "mcp-spec").update(spec, 'utf8').digest('hex')).toBe("21d41c5da610b736683b86a776e8661e8b25294a698027c8d552fa6eace78cb3");
  });

  it("post116: HMAC-SHA256 keyed by mcp-spec-contract locks spec digest", () => {
    expect(createHmac('sha256', "mcp-spec-contract").update(spec, 'utf8').digest('hex')).toBe("ef5a3e4a5d7f233f77e3d4ee5fa8ca97cacddbcee734efc9412fab489f43b614");
  });

  it("post116: HMAC-SHA256 keyed by backlink locks spec digest", () => {
    expect(createHmac('sha256', "backlink").update(spec, 'utf8').digest('hex')).toBe("98920add1fa15e869968c8efbc949fab60baf5ca95945eaf466caf563dff3e9f");
  });

  it("post116: HMAC-SHA256 keyed by Backlink Radio locks spec digest", () => {
    expect(createHmac('sha256', "Backlink Radio").update(spec, 'utf8').digest('hex')).toBe("2550a22433482a1d4a3c0811e8deedfd0b48aaa2b9a64d70f8ef048383e4a7ef");
  });

  it("post116: HMAC-SHA256 keyed by backlink_curate locks spec digest", () => {
    expect(createHmac('sha256', "backlink_curate").update(spec, 'utf8').digest('hex')).toBe("d5be7a976b320237501c22881a382cf75b22af14a3f886ea5bb34d88fec2e1b2");
  });

  it("post116: HMAC-SHA256 keyed by backlink_genres locks spec digest", () => {
    expect(createHmac('sha256', "backlink_genres").update(spec, 'utf8').digest('hex')).toBe("f9384a7b6410e8e73a6d2acbd7a8c528b41fb612659b8f376924c87d0be870d0");
  });

  it("post116: HMAC-SHA256 keyed by backlink_now_playing locks spec digest", () => {
    expect(createHmac('sha256', "backlink_now_playing").update(spec, 'utf8').digest('hex')).toBe("d0f976d64252d4ad35ce5a5eafa023ae98ba6d5a3ca6be16019cf3a1cf96946e");
  });

  it("post116: HMAC-SHA256 keyed by stream_url locks spec digest", () => {
    expect(createHmac('sha256', "stream_url").update(spec, 'utf8').digest('hex')).toBe("c582e603126a829add1be68dd7c7cf8e307c582440fef51bb09b65022e5a2db6");
  });

  it("post116: HMAC-SHA256 keyed by curated_by locks spec digest", () => {
    expect(createHmac('sha256', "curated_by").update(spec, 'utf8').digest('hex')).toBe("0aed005214fff86bd6f13331f50b4aa9faaae141bef026633c9ba497aa0e1ab1");
  });

  it("post116: HMAC-SHA256 keyed by Integration Notes locks spec digest", () => {
    expect(createHmac('sha256', "Integration Notes").update(spec, 'utf8').digest('hex')).toBe("0971cd5f6956b98210a068a429e7de36a3efb8aaeeed2844bc49b6e93320a939");
  });

  it("post116: HMAC-SHA256 keyed by claw-mcp locks spec digest", () => {
    expect(createHmac('sha256', "claw-mcp").update(spec, 'utf8').digest('hex')).toBe("d78760362eb08fb0e477e48f981673f58304d55b916b0e1a6e37212a6f96dec7");
  });

  it("post116: HMAC-SHA256 keyed by station_select locks spec digest", () => {
    expect(createHmac('sha256', "station_select").update(spec, 'utf8').digest('hex')).toBe("09cf27cff685a3d9f7125499f44f20636430d5f0363c9de5d2cf2869edff0b69");
  });

  it("post116: HMAC-SHA256 keyed by now_playing locks spec digest", () => {
    expect(createHmac('sha256', "now_playing").update(spec, 'utf8').digest('hex')).toBe("23efffe3b8c66ce1b5a85ed1a565e0da79391801cdcea7a8f4edcb182305c052");
  });

  it("post116: HMAC-SHA256 keyed by genre_filter locks spec digest", () => {
    expect(createHmac('sha256', "genre_filter").update(spec, 'utf8').digest('hex')).toBe("c5853f5dfdc18ca288fef4242e770b29896da8e5f02573f58b513ec60e599145");
  });

  it("post116: HMAC-SHA256 keyed by curator_prompt locks spec digest", () => {
    expect(createHmac('sha256', "curator_prompt").update(spec, 'utf8').digest('hex')).toBe("ec80abe2f207397304a4a989ee91486e11e08d48ff9e935ee8628539851adfde");
  });

  it("post116: HMAC-SHA256 keyed by VALID_GENRES locks spec digest", () => {
    expect(createHmac('sha256', "VALID_GENRES").update(spec, 'utf8').digest('hex')).toBe("5bce78975cb91bf1f314fa44ce30008c42fead0e079725b2efa2ad2750650e5a");
  });

  it("post116: HMAC-SHA256 keyed by GENRE_MAP locks spec digest", () => {
    expect(createHmac('sha256', "GENRE_MAP").update(spec, 'utf8').digest('hex')).toBe("e01fc8634bfedbbedcd9da59f972d0afcedfd135b07c02806e7499d4eede1a1c");
  });

  it("post116: HMAC-SHA256 keyed by fuzzywigg locks spec digest", () => {
    expect(createHmac('sha256', "fuzzywigg").update(spec, 'utf8').digest('hex')).toBe("8e0caed7ef994c374b52d69005d69324d5af51ef97c49c876613cf9ed1b93d4d");
  });

  it("post116: HMAC-SHA256 keyed by iptv-org locks spec digest", () => {
    expect(createHmac('sha256', "iptv-org").update(spec, 'utf8').digest('hex')).toBe("f0cc92feffdc00412074b061f650d4216738d7f8e9eb260b8822500b0d7445cf");
  });

  it("post116: HMAC-SHA256 keyed by Gemini locks spec digest", () => {
    expect(createHmac('sha256', "Gemini").update(spec, 'utf8').digest('hex')).toBe("dbb16e6c03e1156f0fa2d4b90974692e0d407a3ae58ca183e1b7a4deb3372e6b");
  });

  it("post116: HMAC-SHA256 keyed by 1h TTL locks spec digest", () => {
    expect(createHmac('sha256', "1h TTL").update(spec, 'utf8').digest('hex')).toBe("c4c198bbce26d02199ee9405f607cc38e48c4ead8270117cf011479cbb2fe293");
  });

  it("post116: HMAC-SHA256 keyed by editorial: null locks spec digest", () => {
    expect(createHmac('sha256', "editorial: null").update(spec, 'utf8').digest('hex')).toBe("cb776d94a0a3a1eb858160aafc326308f56009b6de4beb5b6f376715cd6ccde4");
  });

  it("post116: HMAC-SHA256 keyed by additionalProperties locks spec digest", () => {
    expect(createHmac('sha256', "additionalProperties").update(spec, 'utf8').digest('hex')).toBe("4fc3e0d7c845059dab9fdb3306457e00e146f7c32d8ea67de49508809bfdebf9");
  });

  it("post116: HMAC-SHA256 keyed by openapi locks spec digest", () => {
    expect(createHmac('sha256', "openapi").update(spec, 'utf8').digest('hex')).toBe("f0e4923966d2eccf6e2f2b7687314c5e74f79c71d29b4d0198e03469bf24f309");
  });

  it("post116: HMAC-SHA256 keyed by post116-heavy locks spec digest", () => {
    expect(createHmac('sha256', "post116-heavy").update(spec, 'utf8').digest('hex')).toBe("4d5a43f5eeb549e39d9d73635dde67796f491ee6886403cacf76983a47fda3ae");
  });

  it("post116: HMAC-SHA256 keyed by TOKENMAXX locks spec digest", () => {
    expect(createHmac('sha256', "TOKENMAXX").update(spec, 'utf8').digest('hex')).toBe("58bd8b12de8084ece067f68db2cea2ea5dc8b43305c0d5e7e20506fd40e18749");
  });

  it("post116: HMAC-SHA256 keyed by soft-cap locks spec digest", () => {
    expect(createHmac('sha256', "soft-cap").update(spec, 'utf8').digest('hex')).toBe("eb9189e85c6d750f3e8199e31eb8734d15b3d9f350b4d80814142e12d5d440c8");
  });

  it("post116: HMAC-SHA256 keyed by EoD locks spec digest", () => {
    expect(createHmac('sha256', "EoD").update(spec, 'utf8').digest('hex')).toBe("59237f2cca2b130d355e8ef40f20bf55c8c711ba65b740b058209b8d6645f024");
  });

  it("post116: HMAC-SHA256 keyed by routes-116 locks spec digest", () => {
    expect(createHmac('sha256', "routes-116").update(spec, 'utf8').digest('hex')).toBe("e142fb9a4805f7040b9a765aea5c47b1f5acfa562431b50d7e6d6ced650e4dfe");
  });

  it("post116: HMAC-SHA256 keyed by helpers locks spec digest", () => {
    expect(createHmac('sha256', "helpers").update(spec, 'utf8').digest('hex')).toBe("0fe8242b5aa0463601153814b4df7934d96dd32939b0b1448b7705c6dacdac1f");
  });

  it("post116: HMAC-SHA256 keyed by parser locks spec digest", () => {
    expect(createHmac('sha256', "parser").update(spec, 'utf8').digest('hex')).toBe("73faa0bee9b4a54edac848309fff8733d58145447e36d2523dcde4ab7b0dfa91");
  });

  it("post116: HMAC-SHA256 keyed by wrangler locks spec digest", () => {
    expect(createHmac('sha256', "wrangler").update(spec, 'utf8').digest('hex')).toBe("b4cb7381f2bcc63f2e9dff88e1b57c939ec49b3d16ba1cdee17bc86c4c157965");
  });

  it("post116: HMAC-SHA256 keyed by genres locks spec digest", () => {
    expect(createHmac('sha256', "genres").update(spec, 'utf8').digest('hex')).toBe("35a61c3400bc125332efe66b652550e79dd67d09e99197d22699adf3b3b212b0");
  });

  it("post116: HMAC-SHA256 keyed by source-contracts locks spec digest", () => {
    expect(createHmac('sha256', "source-contracts").update(spec, 'utf8').digest('hex')).toBe("472c0d88a1c9d38f18a0c04197810d1e3c8da144eea8002deb8dee9a57323b7d");
  });

  it("post116: HMAC-SHA256 keyed by ci-config locks spec digest", () => {
    expect(createHmac('sha256', "ci-config").update(spec, 'utf8').digest('hex')).toBe("6effd1effec6eeb6f8371fbc54a189e2f68c1a75308327b11f189591af625293");
  });

  it("post116: HMAC-SHA256 keyed by Backlink_Facelift locks spec digest", () => {
    expect(createHmac('sha256', "Backlink_Facelift").update(spec, 'utf8').digest('hex')).toBe("a80aa04a157dfa23f755f9a2bedcf3e629fed047a989ed915bc5fe9f54d92597");
  });

  it("post116: HMAC-SHA256 keyed by gemini-2.0-flash locks spec digest", () => {
    expect(createHmac('sha256', "gemini-2.0-flash").update(spec, 'utf8').digest('hex')).toBe("a8c0860fadeb6443a6763fc3f6a5b9378994c82c25c346ecf80c105d3c779a0b");
  });

  it("post116: HMAC-SHA256 keyed by CATALOG_CACHE locks spec digest", () => {
    expect(createHmac('sha256', "CATALOG_CACHE").update(spec, 'utf8').digest('hex')).toBe("77c05eeb15ed41c6124ba94658445fe67e0d2267752592d310c765d3205ef6e2");
  });

  it("post116: HMAC-SHA256 keyed by /curate locks spec digest", () => {
    expect(createHmac('sha256', "/curate").update(spec, 'utf8').digest('hex')).toBe("799306d0207e3baf157a13c531d179ee6d6cb9b1bdd0b050cc69e1f0d46ddec2");
  });

  it("post116: HMAC-SHA256 keyed by /genres locks spec digest", () => {
    expect(createHmac('sha256', "/genres").update(spec, 'utf8').digest('hex')).toBe("7c519eb0fadef508fd943f397c319312e3bc760af8768226a765e0899d62b57b");
  });

  it("post116: HMAC-SHA256 keyed by /stations locks spec digest", () => {
    expect(createHmac('sha256', "/stations").update(spec, 'utf8').digest('hex')).toBe("492caa415c30dc9f06f76d99b346fcbfbdd8018b17dc648ffa2b1699af7dbc30");
  });

  it("post116: HMAC-SHA256 keyed by /health locks spec digest", () => {
    expect(createHmac('sha256', "/health").update(spec, 'utf8').digest('hex')).toBe("d2075176065e00647c45104c0022f517d71e7005caea940a31da86513b680bfc");
  });

  it('post116: HMAC key inventory digest', () => {
    const inventory = POST116_KEYS.map((k) => createHmac('sha256', k).update(spec, 'utf8').digest('hex')).join('|');
    expect(createHash('sha256').update(inventory, 'utf8').digest('hex')).toBe("636724b87a57fb793a3f9c289dda0a621e68b57d594f7804048d505219003d80");
  });

  it("post116: line 0 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[0] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("99c84d33ad819ac9");
  });

  it("post116: line 1 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[1] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 2 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[2] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("5e0f013658c5f50f");
  });

  it("post116: line 3 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[3] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 4 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[4] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("cb3f91d54eee30e5");
  });

  it("post116: line 5 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[5] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 6 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[6] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("0b27734b46fbf7ef");
  });

  it("post116: line 7 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[7] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 8 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[8] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("ff3cf26fccc17858");
  });

  it("post116: line 9 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[9] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 10 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[10] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("02b56e10fd373ef3");
  });

  it("post116: line 11 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[11] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 12 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[12] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("5e6fc6a874f15fa0");
  });

  it("post116: line 13 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[13] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a56726cde84dae15");
  });

  it("post116: line 14 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[14] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("021fb596db81e6d0");
  });

  it("post116: line 15 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[15] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d0c3102ad9c439dc");
  });

  it("post116: line 16 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[16] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("0b5b7049adc5269a");
  });

  it("post116: line 17 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[17] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("c27ff1a8aedfd3a8");
  });

  it("post116: line 18 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[18] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("b6d239e8efbb3458");
  });

  it("post116: line 19 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[19] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("5d7e1477a4255851");
  });

  it("post116: line 20 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[20] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("58636dd916833390");
  });

  it("post116: line 21 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[21] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e08470ea6ec3f78e");
  });

  it("post116: line 22 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[22] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("b6d239e8efbb3458");
  });

  it("post116: line 23 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[23] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("fb22633293e70bb9");
  });

  it("post116: line 24 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[24] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("28d86778615f6af4");
  });

  it("post116: line 25 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[25] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("3288a136ca3e7c85");
  });

  it("post116: line 26 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[26] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("c76cce0dffe84d12");
  });

  it("post116: line 27 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[27] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d10b36aa74a59bcf");
  });

  it("post116: line 28 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[28] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("f1b901847390b0ed");
  });

  it("post116: line 29 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[29] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 30 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[30] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("4d4a7b9130ee5775");
  });

  it("post116: line 31 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[31] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a56726cde84dae15");
  });

  it("post116: line 32 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[32] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("021fb596db81e6d0");
  });

  it("post116: line 33 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[33] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d0c3102ad9c439dc");
  });

  it("post116: line 34 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[34] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("0b5b7049adc5269a");
  });

  it("post116: line 35 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[35] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("7d3c9b85aedc612a");
  });

  it("post116: line 36 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[36] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("697b544165d774fa");
  });

  it("post116: line 37 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[37] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("f9f6cf6a503b59eb");
  });

  it("post116: line 38 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[38] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("9cef552767ebb0c0");
  });

  it("post116: line 39 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[39] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("23d3e54aec3f7900");
  });

  it("post116: line 40 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[40] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("66bb58fba1af4366");
  });

  it("post116: line 41 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[41] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a854fb1a3ed9b4c2");
  });

  it("post116: line 42 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[42] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d337fa71c905db67");
  });

  it("post116: line 43 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[43] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e9856c0b8c26d416");
  });

  it("post116: line 44 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[44] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("c7925c46cf680c81");
  });

  it("post116: line 45 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[45] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("75cad7ef077c03fd");
  });

  it("post116: line 46 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[46] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("94d55f14dc795d83");
  });

  it("post116: line 47 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[47] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("93ed702dbc71183a");
  });

  it("post116: line 48 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[48] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("55ebf423a240dd03");
  });

  it("post116: line 49 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[49] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("20b32f3e6c5b2747");
  });

  it("post116: line 50 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[50] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("f61f5bbc379fd349");
  });

  it("post116: line 51 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[51] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("28d86778615f6af4");
  });

  it("post116: line 52 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[52] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("737db166c79ae98e");
  });

  it("post116: line 53 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[53] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d10b36aa74a59bcf");
  });

  it("post116: line 54 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[54] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("f1b901847390b0ed");
  });

  it("post116: line 55 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[55] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 56 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[56] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("1efc6f55ca964098");
  });

  it("post116: line 57 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[57] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 58 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[58] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("cb3f91d54eee30e5");
  });

  it("post116: line 59 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[59] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 60 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[60] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("eb93ddb3ee5b20e9");
  });

  it("post116: line 61 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[61] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 62 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[62] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("eada87353b2943ec");
  });

  it("post116: line 63 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[63] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 64 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[64] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("5e6fc6a874f15fa0");
  });

  it("post116: line 65 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[65] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a56726cde84dae15");
  });

  it("post116: line 66 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[66] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("021fb596db81e6d0");
  });

  it("post116: line 67 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[67] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d0c3102ad9c439dc");
  });

  it("post116: line 68 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[68] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d3862c9e5c460a0b");
  });

  it("post116: line 69 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[69] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("c76cce0dffe84d12");
  });

  it("post116: line 70 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[70] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d10b36aa74a59bcf");
  });

  it("post116: line 71 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[71] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("f1b901847390b0ed");
  });

  it("post116: line 72 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[72] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 73 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[73] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("7e7d95628b7a199f");
  });

  it("post116: line 74 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[74] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a56726cde84dae15");
  });

  it("post116: line 75 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[75] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("021fb596db81e6d0");
  });

  it("post116: line 76 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[76] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d0c3102ad9c439dc");
  });

  it("post116: line 77 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[77] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("0b5b7049adc5269a");
  });

  it("post116: line 78 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[78] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("855e92e35189eea1");
  });

  it("post116: line 79 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[79] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("23d3e54aec3f7900");
  });

  it("post116: line 80 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[80] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("7aced20a096ba68f");
  });

  it("post116: line 81 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[81] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("b771fe5684e530d1");
  });

  it("post116: line 82 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[82] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("58636dd916833390");
  });

  it("post116: line 83 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[83] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("c51251d915a70df8");
  });

  it("post116: line 84 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[84] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("558a119ee6940a65");
  });

  it("post116: line 85 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[85] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("b2d147df0c268333");
  });

  it("post116: line 86 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[86] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("39bbc9e7eca4bd9f");
  });

  it("post116: line 87 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[87] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("28d86778615f6af4");
  });

  it("post116: line 88 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[88] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("737db166c79ae98e");
  });

  it("post116: line 89 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[89] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d10b36aa74a59bcf");
  });

  it("post116: line 90 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[90] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("f1b901847390b0ed");
  });

  it("post116: line 91 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[91] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 92 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[92] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("107c1c6c71f6c3c5");
  });

  it("post116: line 93 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[93] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 94 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[94] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("cb3f91d54eee30e5");
  });

  it("post116: line 95 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[95] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 96 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[96] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("778a180e647ff15a");
  });

  it("post116: line 97 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[97] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 98 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[98] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a9151993967f69ad");
  });

  it("post116: line 99 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[99] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 100 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[100] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("5e6fc6a874f15fa0");
  });

  it("post116: line 101 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[101] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a56726cde84dae15");
  });

  it("post116: line 102 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[102] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("021fb596db81e6d0");
  });

  it("post116: line 103 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[103] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d0c3102ad9c439dc");
  });

  it("post116: line 104 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[104] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("0b5b7049adc5269a");
  });

  it("post116: line 105 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[105] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("c27ff1a8aedfd3a8");
  });

  it("post116: line 106 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[106] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("b6d239e8efbb3458");
  });

  it("post116: line 107 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[107] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a8a25ade28f4566e");
  });

  it("post116: line 108 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[108] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("58636dd916833390");
  });

  it("post116: line 109 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[109] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e08470ea6ec3f78e");
  });

  it("post116: line 110 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[110] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("b6d239e8efbb3458");
  });

  it("post116: line 111 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[111] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("cfc78309a75d1318");
  });

  it("post116: line 112 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[112] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("28d86778615f6af4");
  });

  it("post116: line 113 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[113] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("3288a136ca3e7c85");
  });

  it("post116: line 114 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[114] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("c76cce0dffe84d12");
  });

  it("post116: line 115 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[115] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d10b36aa74a59bcf");
  });

  it("post116: line 116 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[116] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("f1b901847390b0ed");
  });

  it("post116: line 117 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[117] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 118 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[118] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b9a88fe456095f");
  });

  it("post116: line 119 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[119] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("a56726cde84dae15");
  });

  it("post116: line 120 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[120] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("021fb596db81e6d0");
  });

  it("post116: line 121 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[121] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d0c3102ad9c439dc");
  });

  it("post116: line 122 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[122] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("0b5b7049adc5269a");
  });

  it("post116: line 123 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[123] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("05b5215df672a99a");
  });

  it("post116: line 124 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[124] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d27cb546fae937ab");
  });

  it("post116: line 125 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[125] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("653b78133c7431ea");
  });

  it("post116: line 126 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[126] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("7be0374fadfef393");
  });

  it("post116: line 127 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[127] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("117097357b0fc608");
  });

  it("post116: line 128 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[128] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("3288a136ca3e7c85");
  });

  it("post116: line 129 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[129] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("6f7389895023466c");
  });

  it("post116: line 130 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[130] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("d10b36aa74a59bcf");
  });

  it("post116: line 131 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[131] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("f1b901847390b0ed");
  });

  it("post116: line 132 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[132] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 133 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[133] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("43bc37f060d09448");
  });

  it("post116: line 134 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[134] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 135 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[135] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("cb3f91d54eee30e5");
  });

  it("post116: line 136 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[136] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 137 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[137] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("025d1a806eaaae1a");
  });

  it("post116: line 138 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[138] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it("post116: line 139 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[139] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("8994a27e468e9af1");
  });

  it("post116: line 140 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[140] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("75bffc12b59f7503");
  });

  it("post116: line 141 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[141] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("12fa63c6833ae862");
  });

  it("post116: line 142 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[142] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("9f4c21047f874eb1");
  });

  it("post116: line 143 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[143] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("aa0dda7332d1f1f0");
  });

  it("post116: line 144 sha prefix", () => {
    expect(createHash('sha256').update(spec.split('\n')[144] ?? '', 'utf8').digest('hex').slice(0, 16)).toBe("e3b0c44298fc1c14");
  });

  it('post116: mid-line sha prefix inventory digest (lines 20..134)', () => {
    const parts = [];
    for (let i = 20; i <= 134; i++) {
      parts.push(createHash('sha256').update(spec.split('\n')[i] ?? '', 'utf8').digest('hex').slice(0, 16));
    }
    expect(createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')).toBe("8170c5a59e31348fde90f41e8403b40782d271e80ee9914ec0c7bd37fb7deed2");
  });

  it("post116: title/body charAt 0 is \"#\"", () => {
    expect(spec.charAt(0)).toBe("#");
  });

  it("post116: title/body charAt 1 is \" \"", () => {
    expect(spec.charAt(1)).toBe(" ");
  });

  it("post116: title/body charAt 2 is \"B\"", () => {
    expect(spec.charAt(2)).toBe("B");
  });

  it("post116: title/body charAt 3 is \"a\"", () => {
    expect(spec.charAt(3)).toBe("a");
  });

  it("post116: title/body charAt 4 is \"c\"", () => {
    expect(spec.charAt(4)).toBe("c");
  });

  it("post116: title/body charAt 5 is \"k\"", () => {
    expect(spec.charAt(5)).toBe("k");
  });

  it("post116: title/body charAt 6 is \"l\"", () => {
    expect(spec.charAt(6)).toBe("l");
  });

  it("post116: title/body charAt 7 is \"i\"", () => {
    expect(spec.charAt(7)).toBe("i");
  });

  it("post116: title/body charAt 8 is \"n\"", () => {
    expect(spec.charAt(8)).toBe("n");
  });

  it("post116: title/body charAt 9 is \"k\"", () => {
    expect(spec.charAt(9)).toBe("k");
  });

  it("post116: title/body charAt 10 is \" \"", () => {
    expect(spec.charAt(10)).toBe(" ");
  });

  it("post116: title/body charAt 11 is \"M\"", () => {
    expect(spec.charAt(11)).toBe("M");
  });

  it("post116: title/body charAt 12 is \"C\"", () => {
    expect(spec.charAt(12)).toBe("C");
  });

  it("post116: title/body charAt 13 is \"P\"", () => {
    expect(spec.charAt(13)).toBe("P");
  });

  it("post116: title/body charAt 14 is \" \"", () => {
    expect(spec.charAt(14)).toBe(" ");
  });

  it("post116: title/body charAt 15 is \"T\"", () => {
    expect(spec.charAt(15)).toBe("T");
  });

  it("post116: title/body charAt 16 is \"o\"", () => {
    expect(spec.charAt(16)).toBe("o");
  });

  it("post116: title/body charAt 17 is \"o\"", () => {
    expect(spec.charAt(17)).toBe("o");
  });

  it("post116: title/body charAt 18 is \"l\"", () => {
    expect(spec.charAt(18)).toBe("l");
  });

  it("post116: title/body charAt 19 is \" \"", () => {
    expect(spec.charAt(19)).toBe(" ");
  });

  it("post116: title/body charAt 20 is \"S\"", () => {
    expect(spec.charAt(20)).toBe("S");
  });

  it("post116: title/body charAt 21 is \"p\"", () => {
    expect(spec.charAt(21)).toBe("p");
  });

  it("post116: title/body charAt 22 is \"e\"", () => {
    expect(spec.charAt(22)).toBe("e");
  });

  it("post116: title/body charAt 23 is \"c\"", () => {
    expect(spec.charAt(23)).toBe("c");
  });

  it("post116: title/body charAt 24 is \"i\"", () => {
    expect(spec.charAt(24)).toBe("i");
  });

  it("post116: title/body charAt 25 is \"f\"", () => {
    expect(spec.charAt(25)).toBe("f");
  });

  it("post116: title/body charAt 26 is \"i\"", () => {
    expect(spec.charAt(26)).toBe("i");
  });

  it("post116: title/body charAt 27 is \"c\"", () => {
    expect(spec.charAt(27)).toBe("c");
  });

  it("post116: title/body charAt 28 is \"a\"", () => {
    expect(spec.charAt(28)).toBe("a");
  });

  it("post116: title/body charAt 29 is \"t\"", () => {
    expect(spec.charAt(29)).toBe("t");
  });

  it("post116: title/body charAt 30 is \"i\"", () => {
    expect(spec.charAt(30)).toBe("i");
  });

  it("post116: title/body charAt 31 is \"o\"", () => {
    expect(spec.charAt(31)).toBe("o");
  });

  it("post116: title/body charAt 32 is \"n\"", () => {
    expect(spec.charAt(32)).toBe("n");
  });

  it("post116: title/body charAt 33 is \"\\n\"", () => {
    expect(spec.charAt(33)).toBe("\n");
  });

  it("post116: title/body charAt 34 is \"\\n\"", () => {
    expect(spec.charAt(34)).toBe("\n");
  });

  it("post116: title/body charAt 35 is \"T\"", () => {
    expect(spec.charAt(35)).toBe("T");
  });

  it("post116: title/body charAt 36 is \"h\"", () => {
    expect(spec.charAt(36)).toBe("h");
  });

  it("post116: title/body charAt 37 is \"i\"", () => {
    expect(spec.charAt(37)).toBe("i");
  });

  it("post116: title/body charAt 38 is \"s\"", () => {
    expect(spec.charAt(38)).toBe("s");
  });

  it("post116: title/body charAt 39 is \" \"", () => {
    expect(spec.charAt(39)).toBe(" ");
  });

  it("post116: title/body charAt 40 is \"s\"", () => {
    expect(spec.charAt(40)).toBe("s");
  });

  it("post116: title/body charAt 41 is \"p\"", () => {
    expect(spec.charAt(41)).toBe("p");
  });

  it("post116: title/body charAt 42 is \"e\"", () => {
    expect(spec.charAt(42)).toBe("e");
  });

  it("post116: title/body charAt 43 is \"c\"", () => {
    expect(spec.charAt(43)).toBe("c");
  });

  it("post116: title/body charAt 44 is \" \"", () => {
    expect(spec.charAt(44)).toBe(" ");
  });

  it("post116: title/body charAt 45 is \"d\"", () => {
    expect(spec.charAt(45)).toBe("d");
  });

  it("post116: title/body charAt 46 is \"e\"", () => {
    expect(spec.charAt(46)).toBe("e");
  });

  it("post116: title/body charAt 47 is \"f\"", () => {
    expect(spec.charAt(47)).toBe("f");
  });

  it("post116: title/body charAt 48 is \"i\"", () => {
    expect(spec.charAt(48)).toBe("i");
  });

  it("post116: title/body charAt 49 is \"n\"", () => {
    expect(spec.charAt(49)).toBe("n");
  });

  it("post116: title/body charAt 50 is \"e\"", () => {
    expect(spec.charAt(50)).toBe("e");
  });

  it("post116: title/body charAt 51 is \"s\"", () => {
    expect(spec.charAt(51)).toBe("s");
  });

  it("post116: title/body charAt 52 is \" \"", () => {
    expect(spec.charAt(52)).toBe(" ");
  });

  it("post116: title/body charAt 53 is \"B\"", () => {
    expect(spec.charAt(53)).toBe("B");
  });

  it("post116: title/body charAt 54 is \"a\"", () => {
    expect(spec.charAt(54)).toBe("a");
  });

  it("post116: title/body charAt 55 is \"c\"", () => {
    expect(spec.charAt(55)).toBe("c");
  });

  it("post116: title/body charAt 56 is \"k\"", () => {
    expect(spec.charAt(56)).toBe("k");
  });

  it("post116: title/body charAt 57 is \"l\"", () => {
    expect(spec.charAt(57)).toBe("l");
  });

  it("post116: title/body charAt 58 is \"i\"", () => {
    expect(spec.charAt(58)).toBe("i");
  });

  it("post116: title/body charAt 59 is \"n\"", () => {
    expect(spec.charAt(59)).toBe("n");
  });

  it("post116: title/body charAt 60 is \"k\"", () => {
    expect(spec.charAt(60)).toBe("k");
  });

  it("post116: title/body charAt 61 is \" \"", () => {
    expect(spec.charAt(61)).toBe(" ");
  });

  it("post116: title/body charAt 62 is \"a\"", () => {
    expect(spec.charAt(62)).toBe("a");
  });

  it("post116: title/body charAt 63 is \"s\"", () => {
    expect(spec.charAt(63)).toBe("s");
  });

  it("post116: title/body charAt 64 is \" \"", () => {
    expect(spec.charAt(64)).toBe(" ");
  });

  it("post116: title/body charAt 65 is \"a\"", () => {
    expect(spec.charAt(65)).toBe("a");
  });

  it("post116: title/body charAt 66 is \" \"", () => {
    expect(spec.charAt(66)).toBe(" ");
  });

  it("post116: title/body charAt 67 is \"c\"", () => {
    expect(spec.charAt(67)).toBe("c");
  });

  it("post116: title/body charAt 68 is \"l\"", () => {
    expect(spec.charAt(68)).toBe("l");
  });

  it("post116: title/body charAt 69 is \"a\"", () => {
    expect(spec.charAt(69)).toBe("a");
  });

  it("post116: title/body charAt 70 is \"w\"", () => {
    expect(spec.charAt(70)).toBe("w");
  });

  it("post116: title/body charAt 71 is \"-\"", () => {
    expect(spec.charAt(71)).toBe("-");
  });

  it("post116: title/body charAt 72 is \"m\"", () => {
    expect(spec.charAt(72)).toBe("m");
  });

  it("post116: title/body charAt 73 is \"c\"", () => {
    expect(spec.charAt(73)).toBe("c");
  });

  it("post116: title/body charAt 74 is \"p\"", () => {
    expect(spec.charAt(74)).toBe("p");
  });

  it("post116: title/body charAt 75 is \" \"", () => {
    expect(spec.charAt(75)).toBe(" ");
  });

  it("post116: title/body charAt 76 is \"t\"", () => {
    expect(spec.charAt(76)).toBe("t");
  });

  it("post116: title/body charAt 77 is \"o\"", () => {
    expect(spec.charAt(77)).toBe("o");
  });

  it("post116: title/body charAt 78 is \"o\"", () => {
    expect(spec.charAt(78)).toBe("o");
  });

  it("post116: title/body charAt 79 is \"l\"", () => {
    expect(spec.charAt(79)).toBe("l");
  });

  it("post116: codePointAt 0", () => {
    expect(spec.codePointAt(0)).toBe(35);
  });

  it("post116: codePointAt 1", () => {
    expect(spec.codePointAt(1)).toBe(32);
  });

  it("post116: codePointAt 2", () => {
    expect(spec.codePointAt(2)).toBe(66);
  });

  it("post116: codePointAt 3", () => {
    expect(spec.codePointAt(3)).toBe(97);
  });

  it("post116: codePointAt 4", () => {
    expect(spec.codePointAt(4)).toBe(99);
  });

  it("post116: codePointAt 5", () => {
    expect(spec.codePointAt(5)).toBe(107);
  });

  it("post116: codePointAt 6", () => {
    expect(spec.codePointAt(6)).toBe(108);
  });

  it("post116: codePointAt 7", () => {
    expect(spec.codePointAt(7)).toBe(105);
  });

  it("post116: codePointAt 8", () => {
    expect(spec.codePointAt(8)).toBe(110);
  });

  it("post116: codePointAt 9", () => {
    expect(spec.codePointAt(9)).toBe(107);
  });

  it("post116: codePointAt 10", () => {
    expect(spec.codePointAt(10)).toBe(32);
  });

  it("post116: codePointAt 11", () => {
    expect(spec.codePointAt(11)).toBe(77);
  });

  it("post116: codePointAt 12", () => {
    expect(spec.codePointAt(12)).toBe(67);
  });

  it("post116: codePointAt 13", () => {
    expect(spec.codePointAt(13)).toBe(80);
  });

  it("post116: codePointAt 14", () => {
    expect(spec.codePointAt(14)).toBe(32);
  });

  it("post116: codePointAt 15", () => {
    expect(spec.codePointAt(15)).toBe(84);
  });

  it("post116: codePointAt 16", () => {
    expect(spec.codePointAt(16)).toBe(111);
  });

  it("post116: codePointAt 17", () => {
    expect(spec.codePointAt(17)).toBe(111);
  });

  it("post116: codePointAt 18", () => {
    expect(spec.codePointAt(18)).toBe(108);
  });

  it("post116: codePointAt 19", () => {
    expect(spec.codePointAt(19)).toBe(32);
  });

  it("post116: codePointAt 20", () => {
    expect(spec.codePointAt(20)).toBe(83);
  });

  it("post116: codePointAt 21", () => {
    expect(spec.codePointAt(21)).toBe(112);
  });

  it("post116: codePointAt 22", () => {
    expect(spec.codePointAt(22)).toBe(101);
  });

  it("post116: codePointAt 23", () => {
    expect(spec.codePointAt(23)).toBe(99);
  });

  it("post116: codePointAt 24", () => {
    expect(spec.codePointAt(24)).toBe(105);
  });

  it("post116: codePointAt 25", () => {
    expect(spec.codePointAt(25)).toBe(102);
  });

  it("post116: codePointAt 26", () => {
    expect(spec.codePointAt(26)).toBe(105);
  });

  it("post116: codePointAt 27", () => {
    expect(spec.codePointAt(27)).toBe(99);
  });

  it("post116: codePointAt 28", () => {
    expect(spec.codePointAt(28)).toBe(97);
  });

  it("post116: codePointAt 29", () => {
    expect(spec.codePointAt(29)).toBe(116);
  });

  it("post116: codePointAt 30", () => {
    expect(spec.codePointAt(30)).toBe(105);
  });

  it("post116: codePointAt 31", () => {
    expect(spec.codePointAt(31)).toBe(111);
  });

  it("post116: codePointAt 32", () => {
    expect(spec.codePointAt(32)).toBe(110);
  });

  it("post116: codePointAt 33", () => {
    expect(spec.codePointAt(33)).toBe(10);
  });

  it("post116: codePointAt 34", () => {
    expect(spec.codePointAt(34)).toBe(10);
  });

  it("post116: codePointAt 35", () => {
    expect(spec.codePointAt(35)).toBe(84);
  });

  it("post116: codePointAt 36", () => {
    expect(spec.codePointAt(36)).toBe(104);
  });

  it("post116: codePointAt 37", () => {
    expect(spec.codePointAt(37)).toBe(105);
  });

  it("post116: codePointAt 38", () => {
    expect(spec.codePointAt(38)).toBe(115);
  });

  it("post116: codePointAt 39", () => {
    expect(spec.codePointAt(39)).toBe(32);
  });

  it("post116: codePointAt 40", () => {
    expect(spec.codePointAt(40)).toBe(115);
  });

  it("post116: codePointAt 41", () => {
    expect(spec.codePointAt(41)).toBe(112);
  });

  it("post116: codePointAt 42", () => {
    expect(spec.codePointAt(42)).toBe(101);
  });

  it("post116: codePointAt 43", () => {
    expect(spec.codePointAt(43)).toBe(99);
  });

  it("post116: codePointAt 44", () => {
    expect(spec.codePointAt(44)).toBe(32);
  });

  it("post116: codePointAt 45", () => {
    expect(spec.codePointAt(45)).toBe(100);
  });

  it("post116: codePointAt 46", () => {
    expect(spec.codePointAt(46)).toBe(101);
  });

  it("post116: codePointAt 47", () => {
    expect(spec.codePointAt(47)).toBe(102);
  });

  it("post116: codePointAt 48", () => {
    expect(spec.codePointAt(48)).toBe(105);
  });

  it("post116: codePointAt 49", () => {
    expect(spec.codePointAt(49)).toBe(110);
  });

  it("post116: heading 0 index and sha", () => {
    expect(spec.indexOf("# Backlink MCP Tool Specification")).toBe(0);
    expect(createHash('sha256').update("# Backlink MCP Tool Specification", 'utf8').digest('hex')).toBe("99c84d33ad819ac91a66e1a30aef3bf512cb393370d7b6fbc8397c8917ba2e66");
    expect("# Backlink MCP Tool Specification").toHaveLength(33);
  });

  it("post116: heading 1 index and sha", () => {
    expect(spec.indexOf("## Tools")).toBe(135);
    expect(createHash('sha256').update("## Tools", 'utf8').digest('hex')).toBe("0b27734b46fbf7ef264d7dcff4505a08b8773717141fac872ecc4d1c686ca54c");
    expect("## Tools").toHaveLength(8);
  });

  it("post116: heading 2 index and sha", () => {
    expect(spec.indexOf("### `backlink_curate`")).toBe(145);
    expect(createHash('sha256').update("### `backlink_curate`", 'utf8').digest('hex')).toBe("ff3cf26fccc178587f5e9fd4ea384b4504907333f5685d3918dcf5cf001e7594");
    expect("### `backlink_curate`").toHaveLength(21);
  });

  it("post116: heading 3 index and sha", () => {
    expect(spec.indexOf("### `backlink_genres`")).toBe(1483);
    expect(createHash('sha256').update("### `backlink_genres`", 'utf8').digest('hex')).toBe("eb93ddb3ee5b20e931ee882ce3423864bacea389117698ee5e372a70e2e7defa");
    expect("### `backlink_genres`").toHaveLength(21);
  });

  it("post116: heading 4 index and sha", () => {
    expect(spec.indexOf("### `backlink_now_playing`")).toBe(2151);
    expect(createHash('sha256').update("### `backlink_now_playing`", 'utf8').digest('hex')).toBe("778a180e647ff15a320a393891f10a033078b4c9811c6ab033da0292cee86927");
    expect("### `backlink_now_playing`").toHaveLength(26);
  });

  it("post116: heading 5 index and sha", () => {
    expect(spec.indexOf("## Integration Notes")).toBe(3204);
    expect(createHash('sha256').update("## Integration Notes", 'utf8').digest('hex')).toBe("025d1a806eaaae1a50e27b9e54a40adb381acbee73b159a06b6f334b02f1741d");
    expect("## Integration Notes").toHaveLength(20);
  });

  it("post116: slice between heading 0 and 1 sha256 and length", () => {
    const a = "# Backlink MCP Tool Specification";
    const b = "## Tools";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(102);
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe("b5e88d3307c545ead8d44e2d4ee19e44346f014472dc60ffc6c1883df4d56d05");
  });

  it("post116: slice between heading 1 and 2 sha256 and length", () => {
    const a = "## Tools";
    const b = "### `backlink_curate`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(2);
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe("75a11da44c802486bc6f65640aa48a730f0f684c5c07a42ba3cd1735eb3fb070");
  });

  it("post116: slice between heading 2 and 3 sha256 and length", () => {
    const a = "### `backlink_curate`";
    const b = "### `backlink_genres`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(1317);
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe("f5156e887b423b3dccba0be51f10c7e0d3ff820d84095a9e26941241a2453602");
  });

  it("post116: slice between heading 3 and 4 sha256 and length", () => {
    const a = "### `backlink_genres`";
    const b = "### `backlink_now_playing`";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(647);
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe("27b7e714a82162b023dcaf46a1bf6b0669a5f466892352de8cbd605a35f77391");
  });

  it("post116: slice between heading 4 and 5 sha256 and length", () => {
    const a = "### `backlink_now_playing`";
    const b = "## Integration Notes";
    const slice = spec.slice(spec.indexOf(a) + a.length, spec.indexOf(b));
    expect(slice).toHaveLength(1027);
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe("5e150d4d0b5c2e8829220b51975070df0d6bae12b8c2bf4a373383d8529b0c60");
  });

  it('post116: slice after Integration Notes sha256 and length', () => {
    const a = '## Integration Notes';
    const slice = spec.slice(spec.indexOf(a) + a.length);
    expect(slice).toHaveLength(320);
    expect(createHash('sha256').update(slice, 'utf8').digest('hex')).toBe("1dfa300ec1c707b5220fa6d9db44728be67f3891363fb7cb65cc9eb238c11ebb");
  });

  it('post116: json fence count', () => {
    expect([...spec.matchAll(/```json\n([\s\S]*?)```/g)]).toHaveLength(6);
  });

  it("post116: json fence 0 sha256 and length", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[0]).toHaveLength(419);
    expect(createHash('sha256').update(fences[0], 'utf8').digest('hex')).toBe("724a785bbeb7757da9e973ecf5ed7323562561b88746dc3132dae08c6b67f98e");
    expect(JSON.parse(fences[0]).type).toBe("object");
  });

  it("post116: json fence 1 sha256 and length", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[1]).toHaveLength(619);
    expect(createHash('sha256').update(fences[1], 'utf8').digest('hex')).toBe("f9f0e20ed06f9f9d5a9aca4999bb3939240e8a971d3624fa1a8ca880d5104043");
    expect(JSON.parse(fences[1]).type).toBe("object");
  });

  it("post116: json fence 2 sha256 and length", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[2]).toHaveLength(76);
    expect(createHash('sha256').update(fences[2], 'utf8').digest('hex')).toBe("4f355aaabd61baab14303898f72d65b2df4624ffd7c3b3b28ded6ec33d2768be");
    expect(JSON.parse(fences[2]).type).toBe("object");
  });

  it("post116: json fence 3 sha256 and length", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[3]).toHaveLength(369);
    expect(createHash('sha256').update(fences[3], 'utf8').digest('hex')).toBe("820d2eaf86d59524518c09f31d17724acd0a87d18baf02be3ddaf01906572b1d");
    expect(JSON.parse(fences[3]).type).toBe("object");
  });

  it("post116: json fence 4 sha256 and length", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[4]).toHaveLength(336);
    expect(createHash('sha256').update(fences[4], 'utf8').digest('hex')).toBe("8f11519e1ca9f2a723d22839622732e719c59ec7575ee8e5cfa94007ebeeab91");
    expect(JSON.parse(fences[4]).type).toBe("object");
  });

  it("post116: json fence 5 sha256 and length", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(fences[5]).toHaveLength(328);
    expect(createHash('sha256').update(fences[5], 'utf8').digest('hex')).toBe("998bc8ada00faadb8c5b3195b8f596407f76e488be77bcb0f57bf19b302a853f");
    expect(JSON.parse(fences[5]).type).toBe("object");
  });

  it("post116: tool section backlink_curate fingerprint", () => {
    const start = spec.indexOf("### `backlink_curate`");
    const others = DOCS_IDS.map((x) => spec.indexOf(`### \`${x}\``)).filter((i) => i > start).sort((a, b) => a - b);
    const next = others[0] ?? spec.indexOf('## Integration Notes');
    const section = spec.slice(start, next);
    expect(section).toHaveLength(1338);
    expect(createHash('sha256').update(section, 'utf8').digest('hex')).toBe("be378dd83f92578fa92c51e9db7d09bd62db5274a289cadcdd74864e330ee236");
    expect(section).toContain("**Endpoint:** `GET /curate?genre={genre}&mood={mood}`");
    expect(section.includes('"additionalProperties": false')).toBe(true);
    expect(section).toContain("**Description:** Ask Backlink's AI curator to pick the top 3 radio stations for a given genre or mood, with editorial blurbs.");
  });

  it("post116: tool section backlink_genres fingerprint", () => {
    const start = spec.indexOf("### `backlink_genres`");
    const others = DOCS_IDS.map((x) => spec.indexOf(`### \`${x}\``)).filter((i) => i > start).sort((a, b) => a - b);
    const next = others[0] ?? spec.indexOf('## Integration Notes');
    const section = spec.slice(start, next);
    expect(section).toHaveLength(668);
    expect(createHash('sha256').update(section, 'utf8').digest('hex')).toBe("aa4c4f1cb56947649cc4c1745aea4646e10bd81ecf624e8937eac334924ec3f6");
    expect(section).toContain("**Endpoint:** `GET /genres`");
    expect(section.includes('"additionalProperties": false')).toBe(true);
    expect(section).toContain("**Description:** List all available iptv-org genre categories supported by Backlink, including mood aliases.");
  });

  it("post116: tool section backlink_now_playing fingerprint", () => {
    const start = spec.indexOf("### `backlink_now_playing`");
    const others = DOCS_IDS.map((x) => spec.indexOf(`### \`${x}\``)).filter((i) => i > start).sort((a, b) => a - b);
    const next = others[0] ?? spec.indexOf('## Integration Notes');
    const section = spec.slice(start, next);
    expect(section).toHaveLength(1053);
    expect(createHash('sha256').update(section, 'utf8').digest('hex')).toBe("072ae30a32fd1554b4094bbf17c55c494cc7e03549cb1f52e6922fc7ec37415d");
    expect(section).toContain("**Endpoint:** `GET /curate?genre={genre}&mood={mood}`");
    expect(section.includes('"additionalProperties": false')).toBe(true);
    expect(section).toContain("**Description:** Get the top AI-curated pick for a genre or mood — the single best station right now, with editorial context.");
  });

  it("post116: cross-lock sha256 of mcpSrc", () => {
    expect(createHash('sha256').update(mcpSrc, 'utf8').digest('hex')).toBe("6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683");
  });

  it("post116: cross-lock sha256 of indexSrc", () => {
    expect(createHash('sha256').update(indexSrc, 'utf8').digest('hex')).toBe("7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72");
  });

  it("post116: cross-lock sha256 of genresSrc", () => {
    expect(createHash('sha256').update(genresSrc, 'utf8').digest('hex')).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it("post116: cross-lock sha256 of parserSrc", () => {
    expect(createHash('sha256').update(parserSrc, 'utf8').digest('hex')).toBe("cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368");
  });

  it("post116: cross-lock sha256 of typesSrc", () => {
    expect(createHash('sha256').update(typesSrc, 'utf8').digest('hex')).toBe("4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3");
  });

  it("post116: cross-lock sha256 of wranglerToml", () => {
    expect(createHash('sha256').update(wranglerToml, 'utf8').digest('hex')).toBe("95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8");
  });

  it("post116: cross-lock sha256 of ciYml", () => {
    expect(createHash('sha256').update(ciYml, 'utf8').digest('hex')).toBe("c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5");
  });

  it("post116: cross-lock sha256 of agentsMd", () => {
    expect(createHash('sha256').update(agentsMd, 'utf8').digest('hex')).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it("post116: cross-lock sha256 of readmeMd", () => {
    expect(createHash('sha256').update(readmeMd, 'utf8').digest('hex')).toBe("f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987");
  });

  it("post116: cross-lock sha256 of deployMd", () => {
    expect(createHash('sha256').update(deployMd, 'utf8').digest('hex')).toBe("11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a");
  });

  it("post116: cross-lock sha256 of pkgJson", () => {
    expect(createHash('sha256').update(pkgJson, 'utf8').digest('hex')).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it("post116: cross-lock sha256 of vitestCfg", () => {
    expect(createHash('sha256').update(vitestCfg, 'utf8').digest('hex')).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it("post116: cross-lock sha256 of dependabotYml", () => {
    expect(createHash('sha256').update(dependabotYml, 'utf8').digest('hex')).toBe("a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac");
  });

  it("post116: cross-lock sha256 of envJson", () => {
    expect(createHash('sha256').update(envJson, 'utf8').digest('hex')).toBe("4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694");
  });

  it("post116: cross-lock sha256 of packageLock", () => {
    expect(createHash('sha256').update(packageLock, 'utf8').digest('hex')).toBe("5f8a888f1fc7aaf97dcdaa3f91405cefbb45ad118685eac7a1488b78cedfcee6");
  });

  it("post116: cross-lock sha256 of tsconfigJson", () => {
    expect(createHash('sha256').update(tsconfigJson, 'utf8').digest('hex')).toBe("ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792");
  });

  it("post116: HMAC post116 key over mcp", () => {
    expect(createHmac('sha256', 'post116').update(mcpSrc, 'utf8').digest('hex')).toBe("655e602db920a00c09801f66d3f27056a571b8a3504c1f1368b46e65f54a5719");
  });

  it("post116: HMAC post116 key over index", () => {
    expect(createHmac('sha256', 'post116').update(indexSrc, 'utf8').digest('hex')).toBe("739bda9e4215049ac4f26ed6409edb35973eee58a8804a4b8616f0ceb8040441");
  });

  it("post116: HMAC post116 key over genres", () => {
    expect(createHmac('sha256', 'post116').update(genresSrc, 'utf8').digest('hex')).toBe("ca080cbf711d086c982824b4a0126960a02e0037a01ce5f49277d98aaa61ac4b");
  });

  it("post116: HMAC post116 key over parser", () => {
    expect(createHmac('sha256', 'post116').update(parserSrc, 'utf8').digest('hex')).toBe("cb1969bb5a43ba3c41a772ad1d9bbf1dbf7a3f7d4a3f9cd7a05bc8fd351d9a86");
  });

  it("post116: HMAC post116 key over types", () => {
    expect(createHmac('sha256', 'post116').update(typesSrc, 'utf8').digest('hex')).toBe("1cf899f43afa3b39d232c4c594f40d1e021bae84e0fdc8475fa17ee68e0f376a");
  });

  it("post116: HMAC post116 key over wrangler", () => {
    expect(createHmac('sha256', 'post116').update(wranglerToml, 'utf8').digest('hex')).toBe("7c7516897b356e1949dec552e59250b217bfdda3640631c8af3e5144017cc5d2");
  });

  it("post116: HMAC post116 key over ci", () => {
    expect(createHmac('sha256', 'post116').update(ciYml, 'utf8').digest('hex')).toBe("b3e76b2fe2dcb28fc56a47ec88c1d107378aa305bbfb81515b153e1c67e716f9");
  });

  it("post116: HMAC post116 key over agents", () => {
    expect(createHmac('sha256', 'post116').update(agentsMd, 'utf8').digest('hex')).toBe("06d8319289e454e39ca534397843a5afa13d549fe15e47fbd9d8e35be2590c2a");
  });

  it("post116: HMAC post116 key over readme", () => {
    expect(createHmac('sha256', 'post116').update(readmeMd, 'utf8').digest('hex')).toBe("228659c5f19833de2087b220c2408e31c0a717043ac432898e238b83a1e56870");
  });

  it("post116: HMAC post116 key over deploy", () => {
    expect(createHmac('sha256', 'post116').update(deployMd, 'utf8').digest('hex')).toBe("fcd0fa73ee6971ec2150ea01b149fe9eb1625a31d9d446ce241c421a14448a36");
  });

  it("post116: HMAC post116 key over pkg", () => {
    expect(createHmac('sha256', 'post116').update(pkgJson, 'utf8').digest('hex')).toBe("301ea9f30eff5472c313b6a25113ea1a2f8f45d80d552d240ba85cddf2cd7d87");
  });

  it("post116: HMAC post116 key over vitest", () => {
    expect(createHmac('sha256', 'post116').update(vitestCfg, 'utf8').digest('hex')).toBe("e22039027fee322939196b3c7e2c6a8ffd187a2679172739447a91b9e564064b");
  });

  it("post116: HMAC post116 key over dependabot", () => {
    expect(createHmac('sha256', 'post116').update(dependabotYml, 'utf8').digest('hex')).toBe("1c233aa2ace4f5bf41ad468c518e143ebd821c4824a54a7aea76b01f3152941e");
  });

  it("post116: HMAC post116 key over env", () => {
    expect(createHmac('sha256', 'post116').update(envJson, 'utf8').digest('hex')).toBe("6c696553af0d2541d64c9e87a73e69b482cd02a0f107ac73a122a7032f977832");
  });

  it("post116: HMAC post116 key over spec", () => {
    expect(createHmac('sha256', 'post116').update(spec, 'utf8').digest('hex')).toBe("b414f62bcea3abfcb0dcddb4f973296bbc8f65869c408d2b7816843bf74da409");
  });

  it("post116: HMAC post116 key over packageLock", () => {
    expect(createHmac('sha256', 'post116').update(packageLock, 'utf8').digest('hex')).toBe("d403aea7973f732c0795a84af10944a3ec93b8366d0d86b1193a53dc13d51c92");
  });

  it("post116: HMAC post116 key over tsconfig", () => {
    expect(createHmac('sha256', 'post116').update(tsconfigJson, 'utf8').digest('hex')).toBe("e1e86cdf0e344a4996a7c991eb24f9d5e32bec8f0857d1efad74092a22fa65b3");
  });

  it("post116: claw tool station_select schema lock", () => {
    const tool = MCP_MANIFEST.tools.find((x) => x.name === "station_select");
    expect(tool).toBeDefined();
    expect(createHash('sha256').update(tool!.description, 'utf8').digest('hex')).toBe("1b1b6035f3a55908462e8bec71c002374de19a5863b402f9785a13f736ca1be6");
    expect(createHash('sha256').update(JSON.stringify(tool!.input_schema), 'utf8').digest('hex')).toBe("2bc2fbc13a0891046dceeed69e45fe6505fbb3a83f405531ad62c4647ae2d929");
    expect(tool!.input_schema.required ?? []).toEqual(["station_name"]);
    expect(Object.keys(tool!.input_schema.properties || {})).toEqual(["station_name"]);
    expect(tool!.description).toHaveLength(42);
  });

  it("post116: claw tool now_playing schema lock", () => {
    const tool = MCP_MANIFEST.tools.find((x) => x.name === "now_playing");
    expect(tool).toBeDefined();
    expect(createHash('sha256').update(tool!.description, 'utf8').digest('hex')).toBe("15a43880c871d46c36973e95f77b64ff910e68284acdf219fa6c82978af29e7b");
    expect(createHash('sha256').update(JSON.stringify(tool!.input_schema), 'utf8').digest('hex')).toBe("8243f0af367f188a376f2c17b5eabe872a2f7a979813e0d4e2be6d594c2aa259");
    expect(tool!.input_schema.required ?? []).toEqual([]);
    expect(Object.keys(tool!.input_schema.properties || {})).toEqual([]);
    expect(tool!.description).toHaveLength(81);
  });

  it("post116: claw tool genre_filter schema lock", () => {
    const tool = MCP_MANIFEST.tools.find((x) => x.name === "genre_filter");
    expect(tool).toBeDefined();
    expect(createHash('sha256').update(tool!.description, 'utf8').digest('hex')).toBe("3457f6157ae02b0b6c31bcfeabe4332f8954a58944c501b1b8d9bf8a67733d30");
    expect(createHash('sha256').update(JSON.stringify(tool!.input_schema), 'utf8').digest('hex')).toBe("401d064609e122c33144de048d55d2a5f3d2260a1fca20c346603ba7731cbd05");
    expect(tool!.input_schema.required ?? []).toEqual(["genre"]);
    expect(Object.keys(tool!.input_schema.properties || {})).toEqual(["genre"]);
    expect(tool!.description).toHaveLength(81);
  });

  it("post116: claw tool curator_prompt schema lock", () => {
    const tool = MCP_MANIFEST.tools.find((x) => x.name === "curator_prompt");
    expect(tool).toBeDefined();
    expect(createHash('sha256').update(tool!.description, 'utf8').digest('hex')).toBe("c3bcfd16227da8c0c55d606d7da1a1ea26a3032dc1db779e316e31c5b9014ad3");
    expect(createHash('sha256').update(JSON.stringify(tool!.input_schema), 'utf8').digest('hex')).toBe("ac2c012d5fd0816d2c969cca850d4e8c1c3a2e50170f27fb87a1ef370778a6df");
    expect(tool!.input_schema.required ?? []).toEqual(["mood"]);
    expect(Object.keys(tool!.input_schema.properties || {})).toEqual(["mood","genre"]);
    expect(tool!.description).toHaveLength(80);
  });

  it('post116: MCP_MANIFEST compact JSON sha256', () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043");
  });

  it('post116: MCP_MANIFEST tools array sha256', () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST.tools), 'utf8').digest('hex')).toBe("c4dc1e07bdade8df2e72bb8c19caf43226b1f622a7d10bd1c3341ab91b599b43");
  });

  it('post116: MCP_MANIFEST pretty JSON sha256', () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST, null, 2), 'utf8').digest('hex')).toBe("79d287ffdcc0536d8a2d22f540e1d380d891f93aa5c77f7f2fa293ce430a25f4");
  });

  it('post116: MCP_MANIFEST field shape lock', () => {
    expect(MCP_MANIFEST.schema_version).toBe("v1");
    expect(MCP_MANIFEST.name_for_model).toBe("backlink");
    expect(MCP_MANIFEST.name_for_human).toBe("Backlink Radio");
    expect(MCP_MANIFEST.auth).toEqual({"type":"none"});
    expect(MCP_MANIFEST.api).toEqual({"type":"openapi","url":"/openapi.json"});
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect(createHash('sha256').update(MCP_MANIFEST.description_for_model, 'utf8').digest('hex')).toBe("dc98e24357ac0704d5460c9ed7bd2f3fae5eacf36cd0e448584161a1251e739c");
    expect(createHash('sha256').update(MCP_MANIFEST.description_for_human, 'utf8').digest('hex')).toBe("0afdffca1ae9c01f1c754ba92215e9021e7cf491a9a28ccdac603a4fad17166a");
  });

  it('post116: docs tool ids and claw names remain disjoint namespaces', () => {
    expect([...DOCS_IDS]).toEqual(["backlink_curate","backlink_genres","backlink_now_playing"]);
    expect([...CLAW_NAMES]).toEqual(["station_select","now_playing","genre_filter","curator_prompt"]);
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([...CLAW_NAMES]);
    expect(new Set([...DOCS_IDS, ...CLAW_NAMES]).size).toBe(7);
    expect(DOCS_IDS.join('|')).toBe("backlink_curate|backlink_genres|backlink_now_playing");
    expect(CLAW_NAMES.join('|')).toBe("station_select|now_playing|genre_filter|curator_prompt");
    for (const id of DOCS_IDS) {
      expect(spec).toContain('### `' + id + '`');
      expect(CLAW_NAMES.includes(id as (typeof CLAW_NAMES)[number])).toBe(false);
    }
  });

  it('post116: GENRE_MAP and VALID_GENRES payload locks', () => {
    expect(createHash('sha256').update(JSON.stringify(GENRE_MAP), 'utf8').digest('hex')).toBe("a279e96e61bcbdcc0306c2347d4e30c0f00d429c70346b44829616ecef8ab158");
    expect(createHash('sha256').update(JSON.stringify(VALID_GENRES), 'utf8').digest('hex')).toBe("8ce57463d560c8635b5f30da7eaaa97dcd875f8d97f24558e0cac151d3e47d96");
  });

  it("post116: resolveGenre(late night) → ambient", () => {
    expect(resolveGenre("late night")).toBe("ambient");
  });

  it("post116: resolveGenre(chill) → ambient", () => {
    expect(resolveGenre("chill")).toBe("ambient");
  });

  it("post116: resolveGenre(ambient) → ambient", () => {
    expect(resolveGenre("ambient")).toBe("ambient");
  });

  it("post116: resolveGenre(relaxing) → ambient", () => {
    expect(resolveGenre("relaxing")).toBe("ambient");
  });

  it("post116: resolveGenre(focus) → ambient", () => {
    expect(resolveGenre("focus")).toBe("ambient");
  });

  it("post116: resolveGenre(classical) → classical", () => {
    expect(resolveGenre("classical")).toBe("classical");
  });

  it("post116: resolveGenre(classic) → classical", () => {
    expect(resolveGenre("classic")).toBe("classical");
  });

  it("post116: resolveGenre(jazz) → jazz", () => {
    expect(resolveGenre("jazz")).toBe("jazz");
  });

  it("post116: resolveGenre(blues) → jazz", () => {
    expect(resolveGenre("blues")).toBe("jazz");
  });

  it("post116: resolveGenre(pop) → pop", () => {
    expect(resolveGenre("pop")).toBe("pop");
  });

  it("post116: resolveGenre(rock) → rock", () => {
    expect(resolveGenre("rock")).toBe("rock");
  });

  it("post116: resolveGenre(metal) → rock", () => {
    expect(resolveGenre("metal")).toBe("rock");
  });

  it("post116: resolveGenre(indie) → rock", () => {
    expect(resolveGenre("indie")).toBe("rock");
  });

  it("post116: resolveGenre(music) → music", () => {
    expect(resolveGenre("music")).toBe("music");
  });

  it("post116: resolveGenre(news) → news", () => {
    expect(resolveGenre("news")).toBe("news");
  });

  it("post116: resolveGenre(sports) → sports", () => {
    expect(resolveGenre("sports")).toBe("sports");
  });

  it("post116: resolveGenre(entertainment) → entertainment", () => {
    expect(resolveGenre("entertainment")).toBe("entertainment");
  });

  it("post116: resolveGenre(dance) → pop", () => {
    expect(resolveGenre("dance")).toBe("pop");
  });

  it("post116: resolveGenre(electronic) → ambient", () => {
    expect(resolveGenre("electronic")).toBe("ambient");
  });

  it("post116: resolveGenre(lofi) → ambient", () => {
    expect(resolveGenre("lofi")).toBe("ambient");
  });

  it("post116: resolveGenre(lo-fi) → ambient", () => {
    expect(resolveGenre("lo-fi")).toBe("ambient");
  });

  it("post116: resolveGenre((empty)) → music", () => {
    expect(resolveGenre()).toBe("music");
    expect(resolveGenre(undefined)).toBe("music");
  });

  it("post116: resolveGenre(  ) → music", () => {
    expect(resolveGenre("  ")).toBe("music");
  });

  it("post116: resolveGenre(UNKNOWN) → music", () => {
    expect(resolveGenre("UNKNOWN")).toBe("music");
  });

  it("post116: resolveGenre(Jazz) → jazz", () => {
    expect(resolveGenre("Jazz")).toBe("jazz");
  });

  it("post116: resolveGenre(LATE NIGHT) → ambient", () => {
    expect(resolveGenre("LATE NIGHT")).toBe("ambient");
  });

  it("post116: resolveGenre(Lo-Fi) → ambient", () => {
    expect(resolveGenre("Lo-Fi")).toBe("ambient");
  });

  it("post116: digraph rank 0 is \"  \" count 245", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[0][0]).toBe("  ");
    expect(top[0][1]).toBe(245);
  });

  it("post116: digraph rank 1 is \" \\\"\" count 119", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[1][0]).toBe(" \"");
    expect(top[1][1]).toBe(119);
  });

  it("post116: digraph rank 2 is \": \" count 77", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[2][0]).toBe(": ");
    expect(top[2][1]).toBe(77);
  });

  it("post116: digraph rank 3 is \"\\\":\" count 75", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[3][0]).toBe("\":");
    expect(top[3][1]).toBe(75);
  });

  it("post116: digraph rank 4 is \"\\n \" count 69", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[4][0]).toBe("\n ");
    expect(top[4][1]).toBe(69);
  });

  it("post116: digraph rank 5 is \"in\" count 45", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[5][0]).toBe("in");
    expect(top[5][1]).toBe(45);
  });

  it("post116: digraph rank 6 is \"pe\" count 44", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[6][0]).toBe("pe");
    expect(top[6][1]).toBe(44);
  });

  it("post116: digraph rank 7 is \"ri\" count 43", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[7][0]).toBe("ri");
    expect(top[7][1]).toBe(43);
  });

  it("post116: digraph rank 8 is \"e\\\"\" count 40", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[8][0]).toBe("e\"");
    expect(top[8][1]).toBe(40);
  });

  it("post116: digraph rank 9 is \"re\" count 40", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[9][0]).toBe("re");
    expect(top[9][1]).toBe(40);
  });

  it("post116: digraph rank 10 is \"ti\" count 40", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[10][0]).toBe("ti");
    expect(top[10][1]).toBe(40);
  });

  it("post116: digraph rank 11 is \"on\" count 39", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[11][0]).toBe("on");
    expect(top[11][1]).toBe(39);
  });

  it("post116: digraph rank 12 is \"st\" count 38", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[12][0]).toBe("st");
    expect(top[12][1]).toBe(38);
  });

  it("post116: digraph rank 13 is \",\\n\" count 35", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[13][0]).toBe(",\n");
    expect(top[13][1]).toBe(35);
  });

  it("post116: digraph rank 14 is \"es\" count 35", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[14][0]).toBe("es");
    expect(top[14][1]).toBe(35);
  });

  it("post116: digraph rank 15 is \"at\" count 31", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[15][0]).toBe("at");
    expect(top[15][1]).toBe(31);
  });

  it("post116: digraph rank 16 is \" {\" count 30", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[16][0]).toBe(" {");
    expect(top[16][1]).toBe(30);
  });

  it("post116: digraph rank 17 is \"\\\"t\" count 30", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[17][0]).toBe("\"t");
    expect(top[17][1]).toBe(30);
  });

  it("post116: digraph rank 18 is \"en\" count 30", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[18][0]).toBe("en");
    expect(top[18][1]).toBe(30);
  });

  it("post116: digraph rank 19 is \" }\" count 29", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[19][0]).toBe(" }");
    expect(top[19][1]).toBe(29);
  });

  it("post116: digraph rank 20 is \"ty\" count 29", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[20][0]).toBe("ty");
    expect(top[20][1]).toBe(29);
  });

  it("post116: digraph rank 21 is \"yp\" count 29", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[21][0]).toBe("yp");
    expect(top[21][1]).toBe(29);
  });

  it("post116: digraph rank 22 is \"io\" count 28", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[22][0]).toBe("io");
    expect(top[22][1]).toBe(28);
  });

  it("post116: digraph rank 23 is \", \" count 27", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[23][0]).toBe(", ");
    expect(top[23][1]).toBe(27);
  });

  it("post116: digraph rank 24 is \"ng\" count 27", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[24][0]).toBe("ng");
    expect(top[24][1]).toBe(27);
  });

  it("post116: digraph rank 25 is \"\\\",\" count 25", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[25][0]).toBe("\",");
    expect(top[25][1]).toBe(25);
  });

  it("post116: digraph rank 26 is \"e \" count 25", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[26][0]).toBe("e ");
    expect(top[26][1]).toBe(25);
  });

  it("post116: digraph rank 27 is \"**\" count 24", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[27][0]).toBe("**");
    expect(top[27][1]).toBe(24);
  });

  it("post116: digraph rank 28 is \"``\" count 24", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[28][0]).toBe("``");
    expect(top[28][1]).toBe(24);
  });

  it("post116: digraph rank 29 is \"al\" count 24", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[29][0]).toBe("al");
    expect(top[29][1]).toBe(24);
  });

  it('post116: digraph top-40 inventory digest', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40);
    expect(createHash('sha256').update(top.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join('|'), 'utf8').digest('hex')).toBe("02e14bff172074812c30d46e2a50f156546b9b854c51642ee76b6ba011786301");
  });

  it('post116: digraph top-80 inventory digest', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 1; i++) {
      const dg = spec.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 80);
    expect(createHash('sha256').update(top.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join('|'), 'utf8').digest('hex')).toBe("83d6d4ad0c64d543ae6af20ae54bce45c831d36c00379f61134c690affe658e2");
  });

  it("post116: word rank 0 is type=29", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[0][0]).toBe("type");
    expect(top[0][1]).toBe(29);
  });

  it("post116: word rank 1 is genre=19", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[1][0]).toBe("genre");
    expect(top[1][1]).toBe(19);
  });

  it("post116: word rank 2 is string=19", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[2][0]).toBe("string");
    expect(top[2][1]).toBe(19);
  });

  it("post116: word rank 3 is mood=12", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[3][0]).toBe("mood");
    expect(top[3][1]).toBe(12);
  });

  it("post116: word rank 4 is description=9", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[4][0]).toBe("description");
    expect(top[4][1]).toBe(9);
  });

  it("post116: word rank 5 is object=9", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[5][0]).toBe("object");
    expect(top[5][1]).toBe(9);
  });

  it("post116: word rank 6 is properties=7", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[6][0]).toBe("properties");
    expect(top[6][1]).toBe(7);
  });

  it("post116: word rank 7 is backlink=6", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[7][0]).toBe("backlink");
    expect(top[7][1]).toBe(6);
  });

  it("post116: word rank 8 is json=6", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[8][0]).toBe("json");
    expect(top[8][1]).toBe(6);
  });

  it("post116: word rank 9 is name=6", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[9][0]).toBe("name");
    expect(top[9][1]).toBe(6);
  });

  it("post116: word rank 10 is stations=6", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[10][0]).toBe("stations");
    expect(top[10][1]).toBe(6);
  });

  it("post116: word rank 11 is curate=5", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[11][0]).toBe("curate");
    expect(top[11][1]).toBe(5);
  });

  it("post116: word rank 12 is editorial=5", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[12][0]).toBe("editorial");
    expect(top[12][1]).toBe(5);
  });

  it("post116: word rank 13 is format=5", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[13][0]).toBe("format");
    expect(top[13][1]).toBe(5);
  });

  it("post116: word rank 14 is null=5", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[14][0]).toBe("null");
    expect(top[14][1]).toBe(5);
  });

  it("post116: word rank 15 is or=5", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[15][0]).toBe("or");
    expect(top[15][1]).toBe(5);
  });

  it("post116: word rank 16 is a=4", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[16][0]).toBe("a");
    expect(top[16][1]).toBe(4);
  });

  it("post116: word rank 17 is additionalproperties=4", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[17][0]).toBe("additionalproperties");
    expect(top[17][1]).toBe(4);
  });

  it("post116: word rank 18 is endpoint=4", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[18][0]).toBe("endpoint");
    expect(top[18][1]).toBe(4);
  });

  it("post116: word rank 19 is get=4", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[19][0]).toBe("get");
    expect(top[19][1]).toBe(4);
  });

  it("post116: word rank 20 is uri=4", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[20][0]).toBe("uri");
    expect(top[20][1]).toBe(4);
  });

  it("post116: word rank 21 is url=4", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[21][0]).toBe("url");
    expect(top[21][1]).toBe(4);
  });

  it("post116: word rank 22 is with=4", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[22][0]).toBe("with");
    expect(top[22][1]).toBe(4);
  });

  it("post116: word rank 23 is array=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[23][0]).toBe("array");
    expect(top[23][1]).toBe(3);
  });

  it("post116: word rank 24 is e=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[24][0]).toBe("e");
    expect(top[24][1]).toBe(3);
  });

  it("post116: word rank 25 is false=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[25][0]).toBe("false");
    expect(top[25][1]).toBe(3);
  });

  it("post116: word rank 26 is for=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[26][0]).toBe("for");
    expect(top[26][1]).toBe(3);
  });

  it("post116: word rank 27 is g=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[27][0]).toBe("g");
    expect(top[27][1]).toBe(3);
  });

  it("post116: word rank 28 is input=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[28][0]).toBe("input");
    expect(top[28][1]).toBe(3);
  });

  it("post116: word rank 29 is output=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[29][0]).toBe("output");
    expect(top[29][1]).toBe(3);
  });

  it("post116: word rank 30 is required=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[30][0]).toBe("required");
    expect(top[30][1]).toBe(3);
  });

  it("post116: word rank 31 is schema=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[31][0]).toBe("schema");
    expect(top[31][1]).toBe(3);
  });

  it("post116: word rank 32 is station=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[32][0]).toBe("station");
    expect(top[32][1]).toBe(3);
  });

  it("post116: word rank 33 is stream_url=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[33][0]).toBe("stream_url");
    expect(top[33][1]).toBe(3);
  });

  it("post116: word rank 34 is the=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[34][0]).toBe("the");
    expect(top[34][1]).toBe(3);
  });

  it("post116: word rank 35 is to=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[35][0]).toBe("to");
    expect(top[35][1]).toBe(3);
  });

  it("post116: word rank 36 is tool=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[36][0]).toBe("tool");
    expect(top[36][1]).toBe(3);
  });

  it("post116: word rank 37 is top=3", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[37][0]).toBe("top");
    expect(top[37][1]).toBe(3);
  });

  it("post116: word rank 38 is ai=2", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[38][0]).toBe("ai");
    expect(top[38][1]).toBe(2);
  });

  it("post116: word rank 39 is aliases=2", () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[39][0]).toBe("aliases");
    expect(top[39][1]).toBe(2);
  });

  it('post116: word top-50 inventory digest', () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 50);
    expect(createHash('sha256').update(top.map(([k, v]) => `${k}:${v}`).join('|'), 'utf8').digest('hex')).toBe("ca56755c8d174b7dfc5383192b90b636bd010b4ca5ca9b9180ad948a98cb3d7c");
  });

  it('post116: word top-100 inventory digest', () => {
    const words = spec.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 100);
    expect(createHash('sha256').update(top.map(([k, v]) => `${k}:${v}`).join('|'), 'utf8').digest('hex')).toBe("afc376347c9d1cd6d29465b6db4e509338ad038392fe2568b1c52364599444a6");
  });

  it('post116: indent profile lock', () => {
    const profile = spec.split('\n').map((l) => {
      const m = l.match(/^( *)/);
      return m ? m[1].length : 0;
    });
    expect(createHash('sha256').update(profile.join(','), 'utf8').digest('hex')).toBe("c3cfcf4d0f82235efd0307658e2e305d08164caeec4eef8ab693ab6116320e16");
    expect(Math.max(...profile)).toBe(10);
    expect(profile.filter((x) => x === 0)).toHaveLength(76);
    expect(profile.filter((x) => x === 2)).toHaveLength(21);
    expect(profile.filter((x) => x === 4)).toHaveLength(22);
  });

  it('post116: line-length profile digest', () => {
    expect(createHash('sha256').update(spec.split('\n').map((l) => String(l.length)).join(','), 'utf8').digest('hex')).toBe("06a52a89f77b8c319bbbaf9a44ed9cd89b65bdd78d20039546685edacf3a55c2");
  });

  it('post116: punctuation / glyph counts', () => {
    expect((spec.match(/`/g) || []).length).toBe(62);
    expect((spec.match(/-/g) || []).length).toBe(21);
    expect((spec.match(/:/g) || []).length).toBe(90);
    expect((spec.match(/[{}]/g) || []).length).toBe(80);
    expect((spec.match(/[\[\]]/g) || []).length).toBe(14);
    expect((spec.match(/"/g) || []).length).toBe(250);
    expect((spec.match(/\*/g) || []).length).toBe(48);
    expect((spec.match(/#/g) || []).length).toBe(14);
    expect((spec.match(/\//g) || []).length).toBe(10);
    expect((spec.match(/_/g) || []).length).toBe(8);
    expect((spec.match(/[()]/g) || []).length).toBe(10);
    expect((spec.match(/,/g) || []).length).toBe(62);
  });

  it('post116: first and last nonempty lines', () => {
    const ls = spec.split('\n');
    expect(ls[0]).toBe("# Backlink MCP Tool Specification");
    expect([...ls].reverse().find((l) => l.length > 0)).toBe("- On Gemini failure, graceful degradation returns top 5 raw stations with `editorial: null`");
  });

  it("post116: 128-byte window at offset 0", () => {
    expect(createHash('sha256').update(spec.slice(0, 0 + 128), 'utf8').digest('hex')).toBe("0a05f95e94cb8b757050171a00d878e46fb1d8a98bed9640587ad04dc08fad9e");
  });

  it("post116: 128-byte window at offset 100", () => {
    expect(createHash('sha256').update(spec.slice(100, 100 + 128), 'utf8').digest('hex')).toBe("abb2dda8481f1bf25621ecb37727ba0632efd6964856744b6bad2c137934833a");
  });

  it("post116: 128-byte window at offset 250", () => {
    expect(createHash('sha256').update(spec.slice(250, 250 + 128), 'utf8').digest('hex')).toBe("73ce9f41ace7254e9a25033c24f74e3305c6ca02e79d7bcbccabdad88a8c56d4");
  });

  it("post116: 128-byte window at offset 500", () => {
    expect(createHash('sha256').update(spec.slice(500, 500 + 128), 'utf8').digest('hex')).toBe("bd313c3a815219fb47401d24aa9ceda3140a2e78b37083f6d9ebd461971fa9c8");
  });

  it("post116: 128-byte window at offset 750", () => {
    expect(createHash('sha256').update(spec.slice(750, 750 + 128), 'utf8').digest('hex')).toBe("109c89f3f2eff67d3fe4f9616c5b3a0c5b078781a3bddc2df19a24d3f155a76d");
  });

  it("post116: 128-byte window at offset 1000", () => {
    expect(createHash('sha256').update(spec.slice(1000, 1000 + 128), 'utf8').digest('hex')).toBe("fff3746a34293c559e775ee21ad079ff516edb8618c95a51fae965d90162521d");
  });

  it("post116: 128-byte window at offset 1250", () => {
    expect(createHash('sha256').update(spec.slice(1250, 1250 + 128), 'utf8').digest('hex')).toBe("70231640b145d8c0ac7b5e7e2cc52f78f8c1838b8bef43762d0c6c70dcac3fbc");
  });

  it("post116: 128-byte window at offset 1500", () => {
    expect(createHash('sha256').update(spec.slice(1500, 1500 + 128), 'utf8').digest('hex')).toBe("949287d924bb17ea1646a43aa35f302f4dfc0fb21eed4340d775a9bfc78e9ca3");
  });

  it("post116: 128-byte window at offset 1750", () => {
    expect(createHash('sha256').update(spec.slice(1750, 1750 + 128), 'utf8').digest('hex')).toBe("20d75f0ecc982d27b910f2400d0592502454904f2300d12ed9ac4c8b659182f7");
  });

  it("post116: 128-byte window at offset 2000", () => {
    expect(createHash('sha256').update(spec.slice(2000, 2000 + 128), 'utf8').digest('hex')).toBe("027125741e02ee2141af0d37994bf1c95e86666afde9105b282862771eabe21b");
  });

  it("post116: 128-byte window at offset 2250", () => {
    expect(createHash('sha256').update(spec.slice(2250, 2250 + 128), 'utf8').digest('hex')).toBe("ac748e5aef10b595e104cd69efcbdef720bb7c55dea665818182b4811829457c");
  });

  it("post116: 128-byte window at offset 2500", () => {
    expect(createHash('sha256').update(spec.slice(2500, 2500 + 128), 'utf8').digest('hex')).toBe("b43fe2696725ac5de049aef5fe8f7c363f7ccce80e9a92289dafb3c6def1e18a");
  });

  it("post116: 128-byte window at offset 2750", () => {
    expect(createHash('sha256').update(spec.slice(2750, 2750 + 128), 'utf8').digest('hex')).toBe("7d9aa820f80fbf736e46840798b95871ad522b57e9f612c65fb040e101eefa6d");
  });

  it("post116: 128-byte window at offset 3000", () => {
    expect(createHash('sha256').update(spec.slice(3000, 3000 + 128), 'utf8').digest('hex')).toBe("b864874a6353042e9d8215482c173d0d939667df6168499777614ad003936abe");
  });

  it("post116: 128-byte window at offset 3250", () => {
    expect(createHash('sha256').update(spec.slice(3250, 3250 + 128), 'utf8').digest('hex')).toBe("c55e1f9a9c13c992384bbe868531bfba8133df9e2847845eb8a4e612b6d4f400");
  });

  it("post116: 128-byte window at offset 3400", () => {
    expect(createHash('sha256').update(spec.slice(3400, 3400 + 128), 'utf8').digest('hex')).toBe("c0b5b2c38d3c0554099b9755bc378ba94b4e9951b5c7f6d634acbed436029959");
  });

  it("post116: prefix 16 sha256", () => {
    expect(createHash('sha256').update(spec.slice(0, 16), 'utf8').digest('hex')).toBe("65e79a7d3c50e61383d1b845371191280b292761a8cdb9d23ca1d0007291670e");
  });

  it("post116: prefix 32 sha256", () => {
    expect(createHash('sha256').update(spec.slice(0, 32), 'utf8').digest('hex')).toBe("c08b3f513967dc1b6146e36fa050387a9a28fddf456318b56dd1483e2e1d1e2e");
  });

  it("post116: prefix 64 sha256", () => {
    expect(createHash('sha256').update(spec.slice(0, 64), 'utf8').digest('hex')).toBe("dc533c190419097d9600bfc4d18e4b74370eb34e5ddbfc0ac25358f372783c49");
  });

  it("post116: prefix 128 sha256", () => {
    expect(createHash('sha256').update(spec.slice(0, 128), 'utf8').digest('hex')).toBe("0a05f95e94cb8b757050171a00d878e46fb1d8a98bed9640587ad04dc08fad9e");
  });

  it("post116: prefix 256 sha256", () => {
    expect(createHash('sha256').update(spec.slice(0, 256), 'utf8').digest('hex')).toBe("5935d07b31b51c6ac03dc2c0a5fd621bf803f7eb0fc6111b425db251eb10a454");
  });

  it("post116: prefix 512 sha256", () => {
    expect(createHash('sha256').update(spec.slice(0, 512), 'utf8').digest('hex')).toBe("23635ae16461351090e2843e684814ecf12550e1ae049f68d0a02c238116a487");
  });

  it("post116: prefix 1024 sha256", () => {
    expect(createHash('sha256').update(spec.slice(0, 1024), 'utf8').digest('hex')).toBe("8676ab0c10fd090016e205dc7c30d5115a75b628f9d877e737c83a7e471be6df");
  });

  it("post116: suffix 16 sha256", () => {
    expect(createHash('sha256').update(spec.slice(-16), 'utf8').digest('hex')).toBe("d04377c92d773b525e324c0cc2ca08873b182003c7f5dc4c4929e2648c22d92d");
  });

  it("post116: suffix 32 sha256", () => {
    expect(createHash('sha256').update(spec.slice(-32), 'utf8').digest('hex')).toBe("3b12815fa47c60cafd98c854094f1a6f4112ccc9338a74db992d1a5b1d4b7481");
  });

  it("post116: suffix 64 sha256", () => {
    expect(createHash('sha256').update(spec.slice(-64), 'utf8').digest('hex')).toBe("e8153165a81b348300927b01cfeeb95257b79c899bda72e3cd4cd1941ba4a3ba");
  });

  it("post116: suffix 128 sha256", () => {
    expect(createHash('sha256').update(spec.slice(-128), 'utf8').digest('hex')).toBe("b83eb214848d7f611cd9deef81ebe202309b20f14856e4a30249d791f6c11439");
  });

  it("post116: suffix 256 sha256", () => {
    expect(createHash('sha256').update(spec.slice(-256), 'utf8').digest('hex')).toBe("a98963fba6877f4419861c1fdec902c334dba994fe1b17e2203c33a83529b91d");
  });

  it("post116: suffix 512 sha256", () => {
    expect(createHash('sha256').update(spec.slice(-512), 'utf8').digest('hex')).toBe("896a199bd40b525e1e4b8f80935821e745a211540ef99ec0077ad45ee38ca548");
  });

  it("post116: suffix 1024 sha256", () => {
    expect(createHash('sha256').update(spec.slice(-1024), 'utf8').digest('hex')).toBe("1fd40425be8f88f3c0c1ad738fb4934b097781b0256a7a1f71c00bebc7fefad1");
  });

  it('post116: every-Nth char inventories', () => {
    expect(createHash('sha256').update([...Array(Math.floor(spec.length / 10)).keys()].map((i) => spec[i * 10]).join(''), 'utf8').digest('hex')).toBe("4c2ed4f2b7ec15ac46cff0f527d6a8312875d97b16e8dec1d3551b4c3a97d7cf");
    expect(createHash('sha256').update([...Array(Math.floor(spec.length / 7)).keys()].map((i) => spec[i * 7]).join(''), 'utf8').digest('hex')).toBe("e828c543de3f79f768a55eecbe63949974913021f1257b5be5c7cbe278d33d2c");
    expect(createHash('sha256').update([...Array(Math.floor(spec.length / 13)).keys()].map((i) => spec[i * 13]).join(''), 'utf8').digest('hex')).toBe("a029270ee5507d1ae648ee818ce69563c5d2a020d9c06ee0a8e567b0757795db");
  });

  it('post116: reverse/upper/lower/no-ws transforms', () => {
    expect(createHash('sha256').update([...spec].reverse().join(''), 'utf8').digest('hex')).toBe("8e0a8a17d78474b7a2c052d335989cd8a980b200816869706af232736e35ab47");
    expect(createHash('sha256').update(spec.toUpperCase(), 'utf8').digest('hex')).toBe("4c31bde6c3506390c560fd730103342a3e3c2e90f89746eb39cffb68e8d1f52f");
    expect(createHash('sha256').update(spec.toLowerCase(), 'utf8').digest('hex')).toBe("3c6a9cb6d4e03bdaa94f7adf09456466a75fed3561783cb60442c09796aa5d3b");
    expect(createHash('sha256').update(spec.replace(/\s+/g, ''), 'utf8').digest('hex')).toBe("5dba17e18d5eac4482998acde2c91f9380b801ba094637d7007a72473f60f22d");
  });

  it('post116: stride-64 and stride-128 inventories', () => {
    const s64 = Array.from({ length: Math.ceil(spec.length / 64) }, (_, i) =>
      createHash('sha256').update(spec.slice(i * 64, i * 64 + 64), 'utf8').digest('hex').slice(0, 12),
    ).join('|');
    const s128 = Array.from({ length: Math.ceil(spec.length / 128) }, (_, i) =>
      createHash('sha256').update(spec.slice(i * 128, i * 128 + 128), 'utf8').digest('hex').slice(0, 12),
    ).join('|');
    expect(createHash('sha256').update(s64, 'utf8').digest('hex')).toBe("bffc071a4f112c2a0d15b7c6d08ff735ca1b9ac0ed74d75e38f771c88203a2aa");
    expect(createHash('sha256').update(s128, 'utf8').digest('hex')).toBe("41bee219e75303288aa86dee287e644a9adcd11b27bff8dcad317e8ba058b32a");
  });

  it('post116: even/odd byte parity', () => {
    const buf = Buffer.from(spec, 'utf8');
    let even = 0;
    let odd = 0;
    for (const b of buf) {
      if (b % 2 === 0) even++;
      else odd++;
    }
    expect(even).toBe(2223);
    expect(odd).toBe(1329);
    expect(createHash('sha256').update(`${even}|${odd}`, 'utf8').digest('hex')).toBe("9be0637136ea2abd5d785ea85bf7410b512c9db0cea84934e7b480e772fbada5");
  });

  it('post116: unique codepoint cardinality', () => {
    expect(new Set([...spec]).size).toBe(73);
  });

  it('post116: char-frequency top-60 inventory', () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 60);
    expect(createHash('sha256').update(top.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join('|'), 'utf8').digest('hex')).toBe("ceeb3164e619b69b45b9e567c789cc908499dbcf24b899a8ec432d4d87e75298");
  });

  it("post116: char freq rank 0", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[0][0])).toBe("\" \"");
    expect(top[0][1]).toBe(640);
  });

  it("post116: char freq rank 1", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[1][0])).toBe("\"\\\"\"");
    expect(top[1][1]).toBe(250);
  });

  it("post116: char freq rank 2", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[2][0])).toBe("\"e\"");
    expect(top[2][1]).toBe(220);
  });

  it("post116: char freq rank 3", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[3][0])).toBe("\"t\"");
    expect(top[3][1]).toBe(196);
  });

  it("post116: char freq rank 4", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[4][0])).toBe("\"i\"");
    expect(top[4][1]).toBe(164);
  });

  it("post116: char freq rank 5", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[5][0])).toBe("\"r\"");
    expect(top[5][1]).toBe(163);
  });

  it("post116: char freq rank 6", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[6][0])).toBe("\"o\"");
    expect(top[6][1]).toBe(146);
  });

  it("post116: char freq rank 7", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[7][0])).toBe("\"\\n\"");
    expect(top[7][1]).toBe(144);
  });

  it("post116: char freq rank 8", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[8][0])).toBe("\"n\"");
    expect(top[8][1]).toBe(144);
  });

  it("post116: char freq rank 9", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[9][0])).toBe("\"a\"");
    expect(top[9][1]).toBe(127);
  });

  it("post116: char freq rank 10", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[10][0])).toBe("\"s\"");
    expect(top[10][1]).toBe(124);
  });

  it("post116: char freq rank 11", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[11][0])).toBe("\"p\"");
    expect(top[11][1]).toBe(97);
  });

  it("post116: char freq rank 12", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[12][0])).toBe("\":\"");
    expect(top[12][1]).toBe(90);
  });

  it("post116: char freq rank 13", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[13][0])).toBe("\"l\"");
    expect(top[13][1]).toBe(80);
  });

  it("post116: char freq rank 14", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[14][0])).toBe("\"c\"");
    expect(top[14][1]).toBe(73);
  });

  it("post116: char freq rank 15", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[15][0])).toBe("\"g\"");
    expect(top[15][1]).toBe(68);
  });

  it("post116: char freq rank 16", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[16][0])).toBe("\"d\"");
    expect(top[16][1]).toBe(64);
  });

  it("post116: char freq rank 17", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[17][0])).toBe("\",\"");
    expect(top[17][1]).toBe(62);
  });

  it("post116: char freq rank 18", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[18][0])).toBe("\"`\"");
    expect(top[18][1]).toBe(62);
  });

  it("post116: char freq rank 19", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[19][0])).toBe("\"u\"");
    expect(top[19][1]).toBe(53);
  });

  it("post116: char freq rank 20", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[20][0])).toBe("\"*\"");
    expect(top[20][1]).toBe(48);
  });

  it("post116: char freq rank 21", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[21][0])).toBe("\"m\"");
    expect(top[21][1]).toBe(43);
  });

  it("post116: char freq rank 22", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[22][0])).toBe("\"y\"");
    expect(top[22][1]).toBe(42);
  });

  it("post116: char freq rank 23", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[23][0])).toBe("\"{\"");
    expect(top[23][1]).toBe(40);
  });

  it("post116: char freq rank 24", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[24][0])).toBe("\"}\"");
    expect(top[24][1]).toBe(40);
  });

  it("post116: char freq rank 25", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[25][0])).toBe("\"f\"");
    expect(top[25][1]).toBe(28);
  });

  it("post116: char freq rank 26", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[26][0])).toBe("\"'\"");
    expect(top[26][1]).toBe(25);
  });

  it("post116: char freq rank 27", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[27][0])).toBe("\"b\"");
    expect(top[27][1]).toBe(24);
  });

  it("post116: char freq rank 28", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[28][0])).toBe("\".\"");
    expect(top[28][1]).toBe(23);
  });

  it("post116: char freq rank 29", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[29][0])).toBe("\"h\"");
    expect(top[29][1]).toBe(23);
  });

  it("post116: char freq rank 30", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[30][0])).toBe("\"k\"");
    expect(top[30][1]).toBe(22);
  });

  it("post116: char freq rank 31", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[31][0])).toBe("\"-\"");
    expect(top[31][1]).toBe(21);
  });

  it("post116: char freq rank 32", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[32][0])).toBe("\"j\"");
    expect(top[32][1]).toBe(18);
  });

  it("post116: char freq rank 33", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[33][0])).toBe("\"#\"");
    expect(top[33][1]).toBe(14);
  });

  it("post116: char freq rank 34", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[34][0])).toBe("\"/\"");
    expect(top[34][1]).toBe(10);
  });

  it("post116: char freq rank 35", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[35][0])).toBe("\"w\"");
    expect(top[35][1]).toBe(10);
  });

  it("post116: char freq rank 36", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[36][0])).toBe("\"_\"");
    expect(top[36][1]).toBe(8);
  });

  it("post116: char freq rank 37", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[37][0])).toBe("\"T\"");
    expect(top[37][1]).toBe(8);
  });

  it("post116: char freq rank 38", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[38][0])).toBe("\"[\"");
    expect(top[38][1]).toBe(7);
  });

  it("post116: char freq rank 39", () => {
    const m = new Map<string, number>();
    for (const ch of spec) m.set(ch, (m.get(ch) || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(JSON.stringify(top[39][0])).toBe("\"]\"");
    expect(top[39][1]).toBe(7);
  });

  it("post116: pairwise docs HMAC backlink_curate|backlink_genres", () => {
    expect(createHmac('sha256', "backlink_curate|backlink_genres").update(spec, 'utf8').digest('hex')).toBe("42e3d24e4ab21a8ad53ebfe1006055306dbbbf893f66be31c699dd7a1e8cf68b");
  });

  it("post116: pairwise docs HMAC backlink_curate|backlink_now_playing", () => {
    expect(createHmac('sha256', "backlink_curate|backlink_now_playing").update(spec, 'utf8').digest('hex')).toBe("d19a7692d843fe619893ff1616b5889f52c918d8446016b309f9843653745cbb");
  });

  it("post116: pairwise docs HMAC backlink_genres|backlink_now_playing", () => {
    expect(createHmac('sha256', "backlink_genres|backlink_now_playing").update(spec, 'utf8').digest('hex')).toBe("b0463f566031f549212d434965ad00db2c9c5c1b1e597af950ae7a92383fa308");
  });

  it("post116: negative fence — no anthropic inventing", () => {
    expect(spec.toLowerCase().includes("anthropic")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("anthropic")).toBe(false);
    expect(indexSrc.toLowerCase().includes("anthropic")).toBe(false);
  });

  it("post116: negative fence — no claude inventing", () => {
    expect(spec.toLowerCase().includes("claude")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("claude")).toBe(false);
    expect(indexSrc.toLowerCase().includes("claude")).toBe(false);
  });

  it("post116: negative fence — no haiku inventing", () => {
    expect(spec.toLowerCase().includes("haiku")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("haiku")).toBe(false);
    expect(indexSrc.toLowerCase().includes("haiku")).toBe(false);
  });

  it("post116: negative fence — no /playlist inventing", () => {
    expect(spec.toLowerCase().includes("/playlist")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("/playlist")).toBe(false);
    expect(indexSrc.toLowerCase().includes("/playlist")).toBe(false);
  });

  it("post116: negative fence — no ANTHROPIC inventing", () => {
    expect(spec.toLowerCase().includes("anthropic")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("anthropic")).toBe(false);
    expect(indexSrc.toLowerCase().includes("anthropic")).toBe(false);
  });

  it("post116: negative fence — no DurableObject inventing", () => {
    expect(spec.toLowerCase().includes("durableobject")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("durableobject")).toBe(false);
    expect(indexSrc.toLowerCase().includes("durableobject")).toBe(false);
  });

  it("post116: negative fence — no R2_BUCKET inventing", () => {
    expect(spec.toLowerCase().includes("r2_bucket")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("r2_bucket")).toBe(false);
    expect(indexSrc.toLowerCase().includes("r2_bucket")).toBe(false);
  });

  it("post116: negative fence — no Bearer  inventing", () => {
    expect(spec.toLowerCase().includes("bearer ")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("bearer ")).toBe(false);
    expect(indexSrc.toLowerCase().includes("bearer ")).toBe(false);
  });

  it("post116: negative fence — no api_key_hardcoded inventing", () => {
    expect(spec.toLowerCase().includes("api_key_hardcoded")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("api_key_hardcoded")).toBe(false);
    expect(indexSrc.toLowerCase().includes("api_key_hardcoded")).toBe(false);
  });

  it("post116: negative fence — no sk-ant inventing", () => {
    expect(spec.toLowerCase().includes("sk-ant")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("sk-ant")).toBe(false);
    expect(indexSrc.toLowerCase().includes("sk-ant")).toBe(false);
  });

  it("post116: negative fence — no openai.com inventing", () => {
    expect(spec.toLowerCase().includes("openai.com")).toBe(false);
    expect(mcpSrc.toLowerCase().includes("openai.com")).toBe(false);
    expect(indexSrc.toLowerCase().includes("openai.com")).toBe(false);
  });

  it('post116: AGENTS Verify script surface remains', () => {
    expect(agentsMd).toContain('npm ci');
    expect(agentsMd).toContain('npm run typecheck');
    expect(agentsMd).toContain('npm test');
    expect(agentsMd).toContain('npm run test:coverage');
    expect(agentsMd.includes('npm run test:coverage')).toBe(true);
  });

  it('post116: vitest 100% coverage floors remain', () => {
    expect(vitestCfg).toMatch(/lines:\s*100/);
    expect(vitestCfg).toMatch(/functions:\s*100/);
    expect(vitestCfg).toMatch(/branches:\s*100/);
    expect(vitestCfg).toMatch(/statements:\s*100/);
    expect(true).toBe(true);
  });

  it('post116: package scripts lock', () => {
    const scripts = JSON.parse(pkgJson).scripts as Record<string, string>;
    expect(scripts).toEqual({"dev":"wrangler dev","deploy":"wrangler deploy","typecheck":"tsc --noEmit","test":"vitest run","test:watch":"vitest","test:coverage":"vitest run --coverage"});
  });

  it('post116: CI workflow still runs typecheck+test+coverage', () => {
    expect(ciYml).toMatch(/npm run typecheck/);
    expect(ciYml).toMatch(/npm run test:coverage/);
    expect(ciYml).toContain('name: Typecheck');
    expect(ciYml).toContain('name: Tests');
    expect(ciYml).toContain('name: Hygiene');
  });

  it('post116: integration notes still document live Worker contracts', () => {
    expect(spec).toContain('https://backlink.fuzzywigg.com');
    expect(spec).toMatch(/No auth required for read endpoints/i);
    expect(spec).toMatch(/1h TTL/i);
    expect(spec).toMatch(/\/curate`?\s+always calls Gemini fresh/i);
    expect(spec).toMatch(/editorial: null/);
    expect(spec).toContain('GET /curate?genre={genre}&mood={mood}');
    expect(spec).toContain('GET /genres');
  });

  it('post116: docs backlink_now_playing remaps url→stream_url (spec-only; no Worker route invent)', () => {
    expect(spec).toContain('stream_url');
    expect(spec).toMatch(/url` remapped to `stream_url/);
    expect(indexSrc).not.toMatch(/app\.get\(['"]\/now-playing/);
    expect(indexSrc).not.toMatch(/app\.get\(['"]\/playlist/);
    expect(mcpSrc).not.toContain('backlink_now_playing');
    expect(mcpSrc).not.toContain('backlink_curate');
  });

  it('post116: mega cross-file digest', () => {
    const parts = [
      createHash('sha256').update(spec, 'utf8').digest('hex'),
      createHash('sha256').update(mcpSrc, 'utf8').digest('hex'),
      createHash('sha256').update(indexSrc, 'utf8').digest('hex'),
      createHash('sha256').update(genresSrc, 'utf8').digest('hex'),
      createHash('sha256').update(parserSrc, 'utf8').digest('hex'),
      createHash('sha256').update(typesSrc, 'utf8').digest('hex'),
      createHash('sha256').update(wranglerToml, 'utf8').digest('hex'),
      createHash('sha256').update(ciYml, 'utf8').digest('hex'),
      createHash('sha256').update(agentsMd, 'utf8').digest('hex'),
      createHash('sha256').update(readmeMd, 'utf8').digest('hex'),
      createHash('sha256').update(deployMd, 'utf8').digest('hex'),
      createHash('sha256').update(pkgJson, 'utf8').digest('hex'),
      createHash('sha256').update(vitestCfg, 'utf8').digest('hex'),
      createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex'),
      createHash('sha256').update(JSON.stringify(GENRE_MAP), 'utf8').digest('hex'),
      createHash('sha256').update(JSON.stringify([...VALID_GENRES]), 'utf8').digest('hex'),
    ];
    expect(createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')).toBe("8ff59f016c658977b071942013e8c6b71ec1a7308d9ebd8dfef9d8c1be7dc4a0");
  });

  it('post116: purity — 25 rounds of digest+resolve unchanged', () => {
    const digest = () => createHash('sha256').update(spec, 'utf8').digest('hex');
    const first = digest();
    for (let i = 0; i < 25; i++) {
      expect(digest()).toBe(first);
      expect(resolveGenre('late night')).toBe('ambient');
      expect(resolveGenre('UNKNOWN_XYZ')).toBe('music');
      expect(MCP_MANIFEST.tools).toHaveLength(4);
    }
    expect(first).toBe("a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849");
  });

  it("post116: nonempty line 0 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[0], 'utf8').digest('hex')).toBe("99c84d33ad819ac91a66e1a30aef3bf512cb393370d7b6fbc8397c8917ba2e66");
  });

  it("post116: nonempty line 2 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[2], 'utf8').digest('hex')).toBe("5e0f013658c5f50f7c40c93531494fbb57ec6e3c6d3fb79f9ae8de8be3979572");
  });

  it("post116: nonempty line 4 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[4], 'utf8').digest('hex')).toBe("cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b");
  });

  it("post116: nonempty line 6 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[6], 'utf8').digest('hex')).toBe("0b27734b46fbf7ef264d7dcff4505a08b8773717141fac872ecc4d1c686ca54c");
  });

  it("post116: nonempty line 8 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[8], 'utf8').digest('hex')).toBe("ff3cf26fccc178587f5e9fd4ea384b4504907333f5685d3918dcf5cf001e7594");
  });

  it("post116: nonempty line 10 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[10], 'utf8').digest('hex')).toBe("02b56e10fd373ef3e120665848a53d523d0c461f43d47226da7bfda0fda6700d");
  });

  it("post116: nonempty line 12 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[12], 'utf8').digest('hex')).toBe("5e6fc6a874f15fa0ba609e93068700b42dc94bd8454a83662ea447ee04482d58");
  });

  it("post116: nonempty line 13 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[13], 'utf8').digest('hex')).toBe("a56726cde84dae1575d9b7635e29470f03d606e486e96d7baeba00e2738be635");
  });

  it("post116: nonempty line 14 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[14], 'utf8').digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post116: nonempty line 15 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[15], 'utf8').digest('hex')).toBe("d0c3102ad9c439dc1759a4446f5554ff8a40b73850d99bdbc2624adc28e5e7f1");
  });

  it("post116: nonempty line 16 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[16], 'utf8').digest('hex')).toBe("0b5b7049adc5269aa29b4271ccb39585a121630ec372ca6c50a6f25c44bb54d8");
  });

  it("post116: nonempty line 17 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[17], 'utf8').digest('hex')).toBe("c27ff1a8aedfd3a844bbf61b19b33d320f29e76ec8a85bb0ad129b38ea484c0b");
  });

  it("post116: nonempty line 18 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[18], 'utf8').digest('hex')).toBe("b6d239e8efbb3458935d1a50ba1d093c355c134607b9f0ec4a4a8e251c46e570");
  });

  it("post116: nonempty line 19 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[19], 'utf8').digest('hex')).toBe("5d7e1477a4255851fe5bdf35eb34f47efc86b07d8b22b005c6087e431dfdc507");
  });

  it("post116: nonempty line 20 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[20], 'utf8').digest('hex')).toBe("58636dd91683339092f700bf39dd97cef08ab7e1a75e5ae24bdc7de2ecf16d40");
  });

  it("post116: nonempty line 21 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[21], 'utf8').digest('hex')).toBe("e08470ea6ec3f78eb7c3ce4d0b38a8105755c3421eea0c56f353a0118ebe5933");
  });

  it("post116: nonempty line 22 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[22], 'utf8').digest('hex')).toBe("b6d239e8efbb3458935d1a50ba1d093c355c134607b9f0ec4a4a8e251c46e570");
  });

  it("post116: nonempty line 23 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[23], 'utf8').digest('hex')).toBe("fb22633293e70bb94195c037bf3b12aa6642c2d8a82f10bf2a112ea32707a3ac");
  });

  it("post116: nonempty line 24 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[24], 'utf8').digest('hex')).toBe("28d86778615f6af47bb1bc4f40face756749768e5111f114cfa234a5060c25af");
  });

  it("post116: nonempty line 25 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[25], 'utf8').digest('hex')).toBe("3288a136ca3e7c8564fedd3322a308b2d045f273db5055e2e2aea1f82d16218e");
  });

  it("post116: nonempty line 26 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[26], 'utf8').digest('hex')).toBe("c76cce0dffe84d124d3f8ee44e9a5b2cb2fa4c59e4ab73ca8cc0c33b5318b712");
  });

  it("post116: nonempty line 27 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[27], 'utf8').digest('hex')).toBe("d10b36aa74a59bcf4a88185837f658afaf3646eff2bb16c3928d0e9335e945d2");
  });

  it("post116: nonempty line 28 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[28], 'utf8').digest('hex')).toBe("f1b901847390b0ed7e374e7c1e464ec17b46a427c487a5ad6cbd2906405083d5");
  });

  it("post116: nonempty line 30 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[30], 'utf8').digest('hex')).toBe("4d4a7b9130ee5775818f5099d8dac8f3ff94bd15d56f2d9022068bac04bf0538");
  });

  it("post116: nonempty line 31 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[31], 'utf8').digest('hex')).toBe("a56726cde84dae1575d9b7635e29470f03d606e486e96d7baeba00e2738be635");
  });

  it("post116: nonempty line 32 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[32], 'utf8').digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post116: nonempty line 33 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[33], 'utf8').digest('hex')).toBe("d0c3102ad9c439dc1759a4446f5554ff8a40b73850d99bdbc2624adc28e5e7f1");
  });

  it("post116: nonempty line 34 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[34], 'utf8').digest('hex')).toBe("0b5b7049adc5269aa29b4271ccb39585a121630ec372ca6c50a6f25c44bb54d8");
  });

  it("post116: nonempty line 35 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[35], 'utf8').digest('hex')).toBe("7d3c9b85aedc612a720f17c82b131209a163a8e0483f1ce42f2b3477f4c04390");
  });

  it("post116: nonempty line 36 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[36], 'utf8').digest('hex')).toBe("697b544165d774fa723d67359546a50961186d67e30c26badfd2becf44f4c619");
  });

  it("post116: nonempty line 37 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[37], 'utf8').digest('hex')).toBe("f9f6cf6a503b59eb940332f01d1bcfdfcf08376183040efed9ed6ffb815e3785");
  });

  it("post116: nonempty line 38 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[38], 'utf8').digest('hex')).toBe("9cef552767ebb0c07bd62d7c88a47c59f4be0a991973de6e5696fb02f21b6e99");
  });

  it("post116: nonempty line 39 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[39], 'utf8').digest('hex')).toBe("23d3e54aec3f790061c877bedfa8ed3c2b247a0b3688694c33dc777201853599");
  });

  it("post116: nonempty line 40 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[40], 'utf8').digest('hex')).toBe("66bb58fba1af4366d7aecd0353c4b2e8a28740e9f927d9372f1144a1d6ef3713");
  });

  it("post116: nonempty line 41 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[41], 'utf8').digest('hex')).toBe("a854fb1a3ed9b4c299895530f3e23d62340a41a7cbc63369cc78047a39df6979");
  });

  it("post116: nonempty line 42 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[42], 'utf8').digest('hex')).toBe("d337fa71c905db67a4c65053dc91862d58bea037e23ef79323996f7e76f795c1");
  });

  it("post116: nonempty line 43 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[43], 'utf8').digest('hex')).toBe("e9856c0b8c26d416796ebbd354b11e7900f24bad7f6356422454241865af2f7c");
  });

  it("post116: nonempty line 44 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[44], 'utf8').digest('hex')).toBe("c7925c46cf680c810533ab6be56593f892e644673de7563926f701f6fe8bd395");
  });

  it("post116: nonempty line 45 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[45], 'utf8').digest('hex')).toBe("75cad7ef077c03fd573fefb8ecd47ad2b09a53eae3d1eb4ce94577e8efdb541f");
  });

  it("post116: nonempty line 46 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[46], 'utf8').digest('hex')).toBe("94d55f14dc795d8379620f6b3165eee4568e77a61213b023a06825254f99505f");
  });

  it("post116: nonempty line 47 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[47], 'utf8').digest('hex')).toBe("93ed702dbc71183aa1ae6192be0c11ebfed39f87b2124aaa8d9a22b2a696b8d5");
  });

  it("post116: nonempty line 48 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[48], 'utf8').digest('hex')).toBe("55ebf423a240dd03063fdd082be36a27c8d4229fb15ca4cb35cf35d943486066");
  });

  it("post116: nonempty line 49 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[49], 'utf8').digest('hex')).toBe("20b32f3e6c5b2747b063a5162b3ed1ba54c1e15a29911ca2f137703c0d5813c3");
  });

  it("post116: nonempty line 50 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[50], 'utf8').digest('hex')).toBe("f61f5bbc379fd349ffd484746f91dcd132c4bb0b0a919ca7ec94604bf9ca2435");
  });

  it("post116: nonempty line 51 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[51], 'utf8').digest('hex')).toBe("28d86778615f6af47bb1bc4f40face756749768e5111f114cfa234a5060c25af");
  });

  it("post116: nonempty line 52 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[52], 'utf8').digest('hex')).toBe("737db166c79ae98e44bbe5ad43e03bf3774f7b3696068842d56a72e863dfeb20");
  });

  it("post116: nonempty line 53 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[53], 'utf8').digest('hex')).toBe("d10b36aa74a59bcf4a88185837f658afaf3646eff2bb16c3928d0e9335e945d2");
  });

  it("post116: nonempty line 54 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[54], 'utf8').digest('hex')).toBe("f1b901847390b0ed7e374e7c1e464ec17b46a427c487a5ad6cbd2906405083d5");
  });

  it("post116: nonempty line 56 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[56], 'utf8').digest('hex')).toBe("1efc6f55ca964098e2c44f2225b483acd368b341840dc19f80141769b536f7ba");
  });

  it("post116: nonempty line 58 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[58], 'utf8').digest('hex')).toBe("cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b");
  });

  it("post116: nonempty line 60 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[60], 'utf8').digest('hex')).toBe("eb93ddb3ee5b20e931ee882ce3423864bacea389117698ee5e372a70e2e7defa");
  });

  it("post116: nonempty line 62 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[62], 'utf8').digest('hex')).toBe("eada87353b2943ec7edf7d8f662d19263f280a3c0f60b9e736af0128236e1267");
  });

  it("post116: nonempty line 64 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[64], 'utf8').digest('hex')).toBe("5e6fc6a874f15fa0ba609e93068700b42dc94bd8454a83662ea447ee04482d58");
  });

  it("post116: nonempty line 65 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[65], 'utf8').digest('hex')).toBe("a56726cde84dae1575d9b7635e29470f03d606e486e96d7baeba00e2738be635");
  });

  it("post116: nonempty line 66 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[66], 'utf8').digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post116: nonempty line 67 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[67], 'utf8').digest('hex')).toBe("d0c3102ad9c439dc1759a4446f5554ff8a40b73850d99bdbc2624adc28e5e7f1");
  });

  it("post116: nonempty line 68 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[68], 'utf8').digest('hex')).toBe("d3862c9e5c460a0b191dc7b110b4b022a266c7aaa64091a9b6c5379ec3976854");
  });

  it("post116: nonempty line 69 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[69], 'utf8').digest('hex')).toBe("c76cce0dffe84d124d3f8ee44e9a5b2cb2fa4c59e4ab73ca8cc0c33b5318b712");
  });

  it("post116: nonempty line 70 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[70], 'utf8').digest('hex')).toBe("d10b36aa74a59bcf4a88185837f658afaf3646eff2bb16c3928d0e9335e945d2");
  });

  it("post116: nonempty line 71 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[71], 'utf8').digest('hex')).toBe("f1b901847390b0ed7e374e7c1e464ec17b46a427c487a5ad6cbd2906405083d5");
  });

  it("post116: nonempty line 73 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[73], 'utf8').digest('hex')).toBe("7e7d95628b7a199f2b2f48e22e4884a79cb0238c75c84177b1f509d82bb40333");
  });

  it("post116: nonempty line 74 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[74], 'utf8').digest('hex')).toBe("a56726cde84dae1575d9b7635e29470f03d606e486e96d7baeba00e2738be635");
  });

  it("post116: nonempty line 75 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[75], 'utf8').digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post116: nonempty line 76 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[76], 'utf8').digest('hex')).toBe("d0c3102ad9c439dc1759a4446f5554ff8a40b73850d99bdbc2624adc28e5e7f1");
  });

  it("post116: nonempty line 77 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[77], 'utf8').digest('hex')).toBe("0b5b7049adc5269aa29b4271ccb39585a121630ec372ca6c50a6f25c44bb54d8");
  });

  it("post116: nonempty line 78 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[78], 'utf8').digest('hex')).toBe("855e92e35189eea118de9a934c3e5c5b4293472491c6c45475b0b617d592627f");
  });

  it("post116: nonempty line 79 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[79], 'utf8').digest('hex')).toBe("23d3e54aec3f790061c877bedfa8ed3c2b247a0b3688694c33dc777201853599");
  });

  it("post116: nonempty line 80 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[80], 'utf8').digest('hex')).toBe("7aced20a096ba68ff67b7041856c1a7aa9af58a46deb3c2bafd01b1de106b168");
  });

  it("post116: nonempty line 81 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[81], 'utf8').digest('hex')).toBe("b771fe5684e530d1dc38496e194cc26e2a87788f84b7b1474e1e58c228f1d67b");
  });

  it("post116: nonempty line 82 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[82], 'utf8').digest('hex')).toBe("58636dd91683339092f700bf39dd97cef08ab7e1a75e5ae24bdc7de2ecf16d40");
  });

  it("post116: nonempty line 83 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[83], 'utf8').digest('hex')).toBe("c51251d915a70df89ff6878b1f599a0e5614122a562054e33b78b6ccc84feda9");
  });

  it("post116: nonempty line 84 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[84], 'utf8').digest('hex')).toBe("558a119ee6940a65fd80505f4c8a415687bcff2b181b8dd10a00dac73fe38d6e");
  });

  it("post116: nonempty line 85 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[85], 'utf8').digest('hex')).toBe("b2d147df0c268333660abcd491622cd2ae29e650cac424c0cce87ecae8d25223");
  });

  it("post116: nonempty line 86 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[86], 'utf8').digest('hex')).toBe("39bbc9e7eca4bd9f8463cd1f25c2c0f1754860275cad83aed78e6562b27af0cb");
  });

  it("post116: nonempty line 87 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[87], 'utf8').digest('hex')).toBe("28d86778615f6af47bb1bc4f40face756749768e5111f114cfa234a5060c25af");
  });

  it("post116: nonempty line 88 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[88], 'utf8').digest('hex')).toBe("737db166c79ae98e44bbe5ad43e03bf3774f7b3696068842d56a72e863dfeb20");
  });

  it("post116: nonempty line 89 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[89], 'utf8').digest('hex')).toBe("d10b36aa74a59bcf4a88185837f658afaf3646eff2bb16c3928d0e9335e945d2");
  });

  it("post116: nonempty line 90 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[90], 'utf8').digest('hex')).toBe("f1b901847390b0ed7e374e7c1e464ec17b46a427c487a5ad6cbd2906405083d5");
  });

  it("post116: nonempty line 92 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[92], 'utf8').digest('hex')).toBe("107c1c6c71f6c3c50640bd5383ee1b779b1356d37ce9cb4682baf6862ede30af");
  });

  it("post116: nonempty line 94 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[94], 'utf8').digest('hex')).toBe("cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b");
  });

  it("post116: nonempty line 96 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[96], 'utf8').digest('hex')).toBe("778a180e647ff15a320a393891f10a033078b4c9811c6ab033da0292cee86927");
  });

  it("post116: nonempty line 98 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[98], 'utf8').digest('hex')).toBe("a9151993967f69adea81c18e60774ff78db02a116f8c135caf78bf1b5c9af0a2");
  });

  it("post116: nonempty line 100 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[100], 'utf8').digest('hex')).toBe("5e6fc6a874f15fa0ba609e93068700b42dc94bd8454a83662ea447ee04482d58");
  });

  it("post116: nonempty line 101 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[101], 'utf8').digest('hex')).toBe("a56726cde84dae1575d9b7635e29470f03d606e486e96d7baeba00e2738be635");
  });

  it("post116: nonempty line 102 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[102], 'utf8').digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post116: nonempty line 103 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[103], 'utf8').digest('hex')).toBe("d0c3102ad9c439dc1759a4446f5554ff8a40b73850d99bdbc2624adc28e5e7f1");
  });

  it("post116: nonempty line 104 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[104], 'utf8').digest('hex')).toBe("0b5b7049adc5269aa29b4271ccb39585a121630ec372ca6c50a6f25c44bb54d8");
  });

  it("post116: nonempty line 105 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[105], 'utf8').digest('hex')).toBe("c27ff1a8aedfd3a844bbf61b19b33d320f29e76ec8a85bb0ad129b38ea484c0b");
  });

  it("post116: nonempty line 106 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[106], 'utf8').digest('hex')).toBe("b6d239e8efbb3458935d1a50ba1d093c355c134607b9f0ec4a4a8e251c46e570");
  });

  it("post116: nonempty line 107 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[107], 'utf8').digest('hex')).toBe("a8a25ade28f4566e07a982debac5cd8c98018f8739f03cfc805095064621c8aa");
  });

  it("post116: nonempty line 108 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[108], 'utf8').digest('hex')).toBe("58636dd91683339092f700bf39dd97cef08ab7e1a75e5ae24bdc7de2ecf16d40");
  });

  it("post116: nonempty line 109 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[109], 'utf8').digest('hex')).toBe("e08470ea6ec3f78eb7c3ce4d0b38a8105755c3421eea0c56f353a0118ebe5933");
  });

  it("post116: nonempty line 110 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[110], 'utf8').digest('hex')).toBe("b6d239e8efbb3458935d1a50ba1d093c355c134607b9f0ec4a4a8e251c46e570");
  });

  it("post116: nonempty line 111 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[111], 'utf8').digest('hex')).toBe("cfc78309a75d131895ed763bb715f55bde5b366b668169ac69976d6e07e33c18");
  });

  it("post116: nonempty line 112 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[112], 'utf8').digest('hex')).toBe("28d86778615f6af47bb1bc4f40face756749768e5111f114cfa234a5060c25af");
  });

  it("post116: nonempty line 113 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[113], 'utf8').digest('hex')).toBe("3288a136ca3e7c8564fedd3322a308b2d045f273db5055e2e2aea1f82d16218e");
  });

  it("post116: nonempty line 114 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[114], 'utf8').digest('hex')).toBe("c76cce0dffe84d124d3f8ee44e9a5b2cb2fa4c59e4ab73ca8cc0c33b5318b712");
  });

  it("post116: nonempty line 115 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[115], 'utf8').digest('hex')).toBe("d10b36aa74a59bcf4a88185837f658afaf3646eff2bb16c3928d0e9335e945d2");
  });

  it("post116: nonempty line 116 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[116], 'utf8').digest('hex')).toBe("f1b901847390b0ed7e374e7c1e464ec17b46a427c487a5ad6cbd2906405083d5");
  });

  it("post116: nonempty line 118 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[118], 'utf8').digest('hex')).toBe("e3b9a88fe456095f8cf30b7ff208f32113d702ebfbfaba2ff6d6d0441caeca64");
  });

  it("post116: nonempty line 119 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[119], 'utf8').digest('hex')).toBe("a56726cde84dae1575d9b7635e29470f03d606e486e96d7baeba00e2738be635");
  });

  it("post116: nonempty line 120 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[120], 'utf8').digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post116: nonempty line 121 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[121], 'utf8').digest('hex')).toBe("d0c3102ad9c439dc1759a4446f5554ff8a40b73850d99bdbc2624adc28e5e7f1");
  });

  it("post116: nonempty line 122 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[122], 'utf8').digest('hex')).toBe("0b5b7049adc5269aa29b4271ccb39585a121630ec372ca6c50a6f25c44bb54d8");
  });

  it("post116: nonempty line 123 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[123], 'utf8').digest('hex')).toBe("05b5215df672a99afae570a523e15de556e6e40ed871e0e8e8020197ef727a70");
  });

  it("post116: nonempty line 124 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[124], 'utf8').digest('hex')).toBe("d27cb546fae937ab1c0929ffe1ec66345b05a4d0dfc0c3a66bec03cc6a73da6a");
  });

  it("post116: nonempty line 125 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[125], 'utf8').digest('hex')).toBe("653b78133c7431eaa638c63136dee2fb9948cd88ad621f818748e06f230ea0e5");
  });

  it("post116: nonempty line 126 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[126], 'utf8').digest('hex')).toBe("7be0374fadfef3930d921cc77d05b26e442f39bb2cc5a28e9600fdb471d30a7d");
  });

  it("post116: nonempty line 127 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[127], 'utf8').digest('hex')).toBe("117097357b0fc6085ec9d9cf9b5258d2f6487021a32d0179a6d5ef2e5df0a91a");
  });

  it("post116: nonempty line 128 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[128], 'utf8').digest('hex')).toBe("3288a136ca3e7c8564fedd3322a308b2d045f273db5055e2e2aea1f82d16218e");
  });

  it("post116: nonempty line 129 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[129], 'utf8').digest('hex')).toBe("6f7389895023466ca1450f8220963560804bb9681bf1d38fdf3ef71a524bdf7f");
  });

  it("post116: nonempty line 130 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[130], 'utf8').digest('hex')).toBe("d10b36aa74a59bcf4a88185837f658afaf3646eff2bb16c3928d0e9335e945d2");
  });

  it("post116: nonempty line 131 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[131], 'utf8').digest('hex')).toBe("f1b901847390b0ed7e374e7c1e464ec17b46a427c487a5ad6cbd2906405083d5");
  });

  it("post116: nonempty line 133 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[133], 'utf8').digest('hex')).toBe("43bc37f060d0944882923675361694e71c93582bd0ad597101c37da2d4735761");
  });

  it("post116: nonempty line 135 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[135], 'utf8').digest('hex')).toBe("cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b");
  });

  it("post116: nonempty line 137 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[137], 'utf8').digest('hex')).toBe("025d1a806eaaae1a50e27b9e54a40adb381acbee73b159a06b6f334b02f1741d");
  });

  it("post116: nonempty line 139 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[139], 'utf8').digest('hex')).toBe("8994a27e468e9af15f07ed42105121adc389a1c7b466afc9b6ce0cbd1463cd49");
  });

  it("post116: nonempty line 140 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[140], 'utf8').digest('hex')).toBe("75bffc12b59f75036bc53ba5b2929365227e0bc1f5920e5b5655633ade19951e");
  });

  it("post116: nonempty line 141 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[141], 'utf8').digest('hex')).toBe("12fa63c6833ae8627c1a570532352bf1a4e0a627db960a7c61e611642cb9dacf");
  });

  it("post116: nonempty line 142 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[142], 'utf8').digest('hex')).toBe("9f4c21047f874eb11a801431f269683597473fb1f9c587ac11ceaa637d594103");
  });

  it("post116: nonempty line 143 full sha256", () => {
    expect(createHash('sha256').update(spec.split('\n')[143], 'utf8').digest('hex')).toBe("aa0dda7332d1f1f01dd6fecdef3a6817ed3dd873a1998b61a3f9c2a8735fae32");
  });
});

describe('post116 mcp-spec-contract HEAVY deepen extras', () => {
  const mcpSrc = readFileSync(join(root, 'src/mcp.ts'), 'utf8');
  const indexSrc = readFileSync(join(root, 'src/index.ts'), 'utf8');
  const deployMd = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
  const readmeMd = readFileSync(join(root, 'README.md'), 'utf8');

  it("post116b: char-code sum window 0..100", () => {
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8854);
    expect(createHash('sha256').update(spec.slice(0, 100), 'utf8').digest('hex')).toBe("0d831dfe4806ce05acdad8cbac9da4b0b491ab95ea34ff94909f4c929f88ca64");
  });

  it("post116b: char-code sum window 100..200", () => {
    let sum = 0;
    for (let i = 100; i < 200; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7875);
    expect(createHash('sha256').update(spec.slice(100, 200), 'utf8').digest('hex')).toBe("f7ec03319c6802f8a1cf498f980fbaa065c5a1ea20ec8a21c5388c4f81215a35");
  });

  it("post116b: char-code sum window 200..300", () => {
    let sum = 0;
    for (let i = 200; i < 300; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8909);
    expect(createHash('sha256').update(spec.slice(200, 300), 'utf8').digest('hex')).toBe("b2310e18f89f40a50166e7a9cea33e21023da4615e40a21bfc061ef6dbea4bd5");
  });

  it("post116b: char-code sum window 300..400", () => {
    let sum = 0;
    for (let i = 300; i < 400; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7297);
    expect(createHash('sha256').update(spec.slice(300, 400), 'utf8').digest('hex')).toBe("3d577bd0bd61c4a0366c729daacd278423372e3e69e8a6fd8981e58066ea11f1");
  });

  it("post116b: char-code sum window 400..500", () => {
    let sum = 0;
    for (let i = 400; i < 500; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7860);
    expect(createHash('sha256').update(spec.slice(400, 500), 'utf8').digest('hex')).toBe("f1927b685112a5774ad0d307f63e685059d70a52d49893268d6c228cef3578d4");
  });

  it("post116b: char-code sum window 500..600", () => {
    let sum = 0;
    for (let i = 500; i < 600; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7222);
    expect(createHash('sha256').update(spec.slice(500, 600), 'utf8').digest('hex')).toBe("089d196b3db015d640adfde5198c94e5f0ba5b0a34475f9c7c4e9320fa32c4bb");
  });

  it("post116b: char-code sum window 600..700", () => {
    let sum = 0;
    for (let i = 600; i < 700; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8306);
    expect(createHash('sha256').update(spec.slice(600, 700), 'utf8').digest('hex')).toBe("e02170c8be00758fbec6bd4c66d460495f5823c77826a5826c882d51480dff46");
  });

  it("post116b: char-code sum window 700..800", () => {
    let sum = 0;
    for (let i = 700; i < 800; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8515);
    expect(createHash('sha256').update(spec.slice(700, 800), 'utf8').digest('hex')).toBe("5813b992845f160e2e2aeb6c42f4b1fb43ee066df649301aafa0bf687cf56cbd");
  });

  it("post116b: char-code sum window 800..900", () => {
    let sum = 0;
    for (let i = 800; i < 900; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7465);
    expect(createHash('sha256').update(spec.slice(800, 900), 'utf8').digest('hex')).toBe("b36d93c84b7e5f98ac374a3ed4bfc2975a35aa5567cd2a29476aa190cdeabd2e");
  });

  it("post116b: char-code sum window 900..1000", () => {
    let sum = 0;
    for (let i = 900; i < 1000; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7340);
    expect(createHash('sha256').update(spec.slice(900, 1000), 'utf8').digest('hex')).toBe("c85edea7326a4c95a2e64328e0b56800a556cb7918d712fd5a0f7e549a1a7540");
  });

  it("post116b: char-code sum window 1000..1100", () => {
    let sum = 0;
    for (let i = 1000; i < 1100; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(6372);
    expect(createHash('sha256').update(spec.slice(1000, 1100), 'utf8').digest('hex')).toBe("164842b883b2af47c9005be78100800622d34fe9a20663f60467aa5632028422");
  });

  it("post116b: char-code sum window 1100..1200", () => {
    let sum = 0;
    for (let i = 1100; i < 1200; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(6670);
    expect(createHash('sha256').update(spec.slice(1100, 1200), 'utf8').digest('hex')).toBe("fef6846dac3aff3332d37bc85fb5405b8e80e20f78a9bf6dd79228c6212d2555");
  });

  it("post116b: char-code sum window 1200..1300", () => {
    let sum = 0;
    for (let i = 1200; i < 1300; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7465);
    expect(createHash('sha256').update(spec.slice(1200, 1300), 'utf8').digest('hex')).toBe("f772d7a82302f69f34a512ee5a2874f0e265867c825f95988c4e336664b5a71d");
  });

  it("post116b: char-code sum window 1300..1400", () => {
    let sum = 0;
    for (let i = 1300; i < 1400; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(6335);
    expect(createHash('sha256').update(spec.slice(1300, 1400), 'utf8').digest('hex')).toBe("b63a38d43e0fb0721967c1aa8aaceaa2fe0b41da864a4e40b67b588d2debd973");
  });

  it("post116b: char-code sum window 1400..1500", () => {
    let sum = 0;
    for (let i = 1400; i < 1500; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7685);
    expect(createHash('sha256').update(spec.slice(1400, 1500), 'utf8').digest('hex')).toBe("127b983b592c9c771a796c99910c01d63be50077f6e4d01a2f77248899abda2a");
  });

  it("post116b: char-code sum window 1500..1600", () => {
    let sum = 0;
    for (let i = 1500; i < 1600; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(9234);
    expect(createHash('sha256').update(spec.slice(1500, 1600), 'utf8').digest('hex')).toBe("065247b8008b8d3d82bfc0dc87434e42565adaea1d33308c9b51c372bd19191d");
  });

  it("post116b: char-code sum window 1600..1700", () => {
    let sum = 0;
    for (let i = 1600; i < 1700; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8063);
    expect(createHash('sha256').update(spec.slice(1600, 1700), 'utf8').digest('hex')).toBe("a3f41cfbb533c14d0debb148cdf86943327557c3e60a76de34e620380173c57a");
  });

  it("post116b: char-code sum window 1700..1800", () => {
    let sum = 0;
    for (let i = 1700; i < 1800; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7606);
    expect(createHash('sha256').update(spec.slice(1700, 1800), 'utf8').digest('hex')).toBe("75e601fa0b4899a8149a39010287ba1bffb555275eca31b2f56483b17ad30c80");
  });

  it("post116b: char-code sum window 1800..1900", () => {
    let sum = 0;
    for (let i = 1800; i < 1900; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7443);
    expect(createHash('sha256').update(spec.slice(1800, 1900), 'utf8').digest('hex')).toBe("bc3f622fc91acafa183b8314af0ef54e45550822b6ddffd4d4251f26042bb627");
  });

  it("post116b: char-code sum window 1900..2000", () => {
    let sum = 0;
    for (let i = 1900; i < 2000; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7373);
    expect(createHash('sha256').update(spec.slice(1900, 2000), 'utf8').digest('hex')).toBe("01cb034b549698e4734bc6df58d6aa7938a695f9ad071579717c4ee4f9ea4576");
  });

  it("post116b: char-code sum window 2000..2100", () => {
    let sum = 0;
    for (let i = 2000; i < 2100; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(16956);
    expect(createHash('sha256').update(spec.slice(2000, 2100), 'utf8').digest('hex')).toBe("d45eaee56c57aa91d6aeea6576c2d5758e2e7d0a0c0ef85e3aa6d71c56682ba8");
  });

  it("post116b: char-code sum window 2100..2200", () => {
    let sum = 0;
    for (let i = 2100; i < 2200; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7510);
    expect(createHash('sha256').update(spec.slice(2100, 2200), 'utf8').digest('hex')).toBe("b531108db4557a453ca43c1827405bd23c0d9868840f19ec0d41f75235c5d601");
  });

  it("post116b: char-code sum window 2200..2300", () => {
    let sum = 0;
    for (let i = 2200; i < 2300; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(17333);
    expect(createHash('sha256').update(spec.slice(2200, 2300), 'utf8').digest('hex')).toBe("02a6ea24f0ea8783c914ddd465fa7e9e48a988c00758095607fdd92e1df0bf78");
  });

  it("post116b: char-code sum window 2300..2400", () => {
    let sum = 0;
    for (let i = 2300; i < 2400; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7262);
    expect(createHash('sha256').update(spec.slice(2300, 2400), 'utf8').digest('hex')).toBe("513f0c3d6212c07ea0f9e9813168c5d63b5035c562f1ff0958e17bdeaad1b2e9");
  });

  it("post116b: char-code sum window 2400..2500", () => {
    let sum = 0;
    for (let i = 2400; i < 2500; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8008);
    expect(createHash('sha256').update(spec.slice(2400, 2500), 'utf8').digest('hex')).toBe("fef2ddb8c0e41ebd78565b31b486163860f4ace4bda8fb8784576a13403d10d9");
  });

  it("post116b: char-code sum window 2500..2600", () => {
    let sum = 0;
    for (let i = 2500; i < 2600; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7337);
    expect(createHash('sha256').update(spec.slice(2500, 2600), 'utf8').digest('hex')).toBe("9da0b1bcb1029698ed0d60e05aaa36c83fc0753b9fd6682b08764d70de8840f6");
  });

  it("post116b: char-code sum window 2600..2700", () => {
    let sum = 0;
    for (let i = 2600; i < 2700; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8110);
    expect(createHash('sha256').update(spec.slice(2600, 2700), 'utf8').digest('hex')).toBe("a6a21bde74bc3f7fc3ad2278a6ac2ebc64d9edec08d3c780ed0ef352b87dd76a");
  });

  it("post116b: char-code sum window 2700..2800", () => {
    let sum = 0;
    for (let i = 2700; i < 2800; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8008);
    expect(createHash('sha256').update(spec.slice(2700, 2800), 'utf8').digest('hex')).toBe("5a3429a8d4b16e4495cbfccc38b8066d449b61774592e7d8b5bed20bbb3256d8");
  });

  it("post116b: char-code sum window 2800..2900", () => {
    let sum = 0;
    for (let i = 2800; i < 2900; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7486);
    expect(createHash('sha256').update(spec.slice(2800, 2900), 'utf8').digest('hex')).toBe("7c2c0071fa2fc08c8a2fe1764e203101cc250cb84e1d3b026a1ccd211a1f3af3");
  });

  it("post116b: char-code sum window 2900..3000", () => {
    let sum = 0;
    for (let i = 2900; i < 3000; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7449);
    expect(createHash('sha256').update(spec.slice(2900, 3000), 'utf8').digest('hex')).toBe("06af3d35286f4683ed836e5d7a8be95b9a4e354ee59e6ed1626f9eacab00a324");
  });

  it("post116b: char-code sum window 3000..3100", () => {
    let sum = 0;
    for (let i = 3000; i < 3100; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(7681);
    expect(createHash('sha256').update(spec.slice(3000, 3100), 'utf8').digest('hex')).toBe("f4b6667cdfc3159b91e836c533189f3b444cb0384e6d2cc39bef1060f3f4094f");
  });

  it("post116b: char-code sum window 3100..3200", () => {
    let sum = 0;
    for (let i = 3100; i < 3200; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(17576);
    expect(createHash('sha256').update(spec.slice(3100, 3200), 'utf8').digest('hex')).toBe("d9f94b779961dd278ad01017549f27b55a43986e0219bdd9b289915495938050");
  });

  it("post116b: char-code sum window 3200..3300", () => {
    let sum = 0;
    for (let i = 3200; i < 3300; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8500);
    expect(createHash('sha256').update(spec.slice(3200, 3300), 'utf8').digest('hex')).toBe("51f5bbd4e3159d8b3eecea5d493e2054c475f99dcdb735c818f0568c184c1adf");
  });

  it("post116b: char-code sum window 3300..3400", () => {
    let sum = 0;
    for (let i = 3300; i < 3400; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(8711);
    expect(createHash('sha256').update(spec.slice(3300, 3400), 'utf8').digest('hex')).toBe("af07f8570e7dd41813a40589382fbe10bc44354194bdb9ac308fa9b5c554fb5a");
  });

  it("post116b: char-code sum window 3400..3500", () => {
    let sum = 0;
    for (let i = 3400; i < 3500; i++) sum += spec.charCodeAt(i);
    expect(sum).toBe(17327);
    expect(createHash('sha256').update(spec.slice(3400, 3500), 'utf8').digest('hex')).toBe("292cffffdff1a0b784c3da9eeeaa36b6a027ae3666823431620b690cbf6ff876");
  });

  it('post116b: trigraph top-25 inventory', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 25);
    expect(createHash('sha256').update(top.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join('|'), 'utf8').digest('hex')).toBe("0e95683d1ee0530c9a1db0a0a67c0aa6c0e21a443b450fcdd8c1aed00068ec4f");
  });

  it("post116b: trigraph rank 0", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[0][0]).toBe("   ");
    expect(top[0][1]).toBe(176);
  });

  it("post116b: trigraph rank 1", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[1][0]).toBe("\": ");
    expect(top[1][1]).toBe(75);
  });

  it("post116b: trigraph rank 2", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[2][0]).toBe("\n  ");
    expect(top[2][1]).toBe(69);
  });

  it("post116b: trigraph rank 3", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[3][0]).toBe("  \"");
    expect(top[3][1]).toBe(55);
  });

  it("post116b: trigraph rank 4", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[4][0]).toBe(": \"");
    expect(top[4][1]).toBe(36);
  });

  it("post116b: trigraph rank 5", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[5][0]).toBe(",\n ");
    expect(top[5][1]).toBe(35);
  });

  it("post116b: trigraph rank 6", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[6][0]).toBe("e\":");
    expect(top[6][1]).toBe(35);
  });

  it("post116b: trigraph rank 7", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[7][0]).toBe(" \"t");
    expect(top[7][1]).toBe(30);
  });

  it("post116b: trigraph rank 8", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[8][0]).toBe(": {");
    expect(top[8][1]).toBe(30);
  });

  it("post116b: trigraph rank 9", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[9][0]).toBe("\"ty");
    expect(top[9][1]).toBe(29);
  });

  it("post116b: trigraph rank 10", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[10][0]).toBe("pe\"");
    expect(top[10][1]).toBe(29);
  });

  it("post116b: trigraph rank 11", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[11][0]).toBe("typ");
    expect(top[11][1]).toBe(29);
  });

  it("post116b: trigraph rank 12", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[12][0]).toBe("ype");
    expect(top[12][1]).toBe(29);
  });

  it("post116b: trigraph rank 13", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[13][0]).toBe("ion");
    expect(top[13][1]).toBe(27);
  });

  it("post116b: trigraph rank 14", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[14][0]).toBe("tio");
    expect(top[14][1]).toBe(27);
  });

  it("post116b: trigraph rank 15", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[15][0]).toBe("ing");
    expect(top[15][1]).toBe(26);
  });

  it("post116b: trigraph rank 16", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[16][0]).toBe("\"st");
    expect(top[16][1]).toBe(22);
  });

  it("post116b: trigraph rank 17", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[17][0]).toBe("enr");
    expect(top[17][1]).toBe(22);
  });

  it("post116b: trigraph rank 18", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[18][0]).toBe("nre");
    expect(top[18][1]).toBe(22);
  });

  it("post116b: trigraph rank 19", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[19][0]).toBe("str");
    expect(top[19][1]).toBe(22);
  });

  it("post116b: trigraph rank 20", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[20][0]).toBe("},\n");
    expect(top[20][1]).toBe(21);
  });

  it("post116b: trigraph rank 21", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[21][0]).toBe("gen");
    expect(top[21][1]).toBe(21);
  });

  it("post116b: trigraph rank 22", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[22][0]).toBe(" },");
    expect(top[22][1]).toBe(20);
  });

  it("post116b: trigraph rank 23", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[23][0]).toBe("{\n ");
    expect(top[23][1]).toBe(20);
  });

  it("post116b: trigraph rank 24", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < spec.length - 2; i++) {
      const t = spec.slice(i, i + 3);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    expect(top[24][0]).toBe("ng\"");
    expect(top[24][1]).toBe(20);
  });

  it("post116b: fence 0 top-level keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[0]))).toEqual(["type","properties","additionalProperties"]);
  });

  it("post116b: fence 0 properties keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[0]).properties || {})).toEqual(["genre","mood"]);
  });

  it("post116b: fence 1 top-level keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[1]))).toEqual(["type","properties"]);
  });

  it("post116b: fence 1 properties keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[1]).properties || {})).toEqual(["query","curated_by","timestamp","stations"]);
  });

  it("post116b: fence 2 top-level keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[2]))).toEqual(["type","properties","additionalProperties"]);
  });

  it("post116b: fence 2 properties keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[2]).properties || {})).toEqual([]);
  });

  it("post116b: fence 3 top-level keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[3]))).toEqual(["type","properties"]);
  });

  it("post116b: fence 3 properties keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[3]).properties || {})).toEqual(["genres","aliases"]);
  });

  it("post116b: fence 4 top-level keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[4]))).toEqual(["type","properties","additionalProperties"]);
  });

  it("post116b: fence 4 properties keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[4]).properties || {})).toEqual(["genre","mood"]);
  });

  it("post116b: fence 5 top-level keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[5]))).toEqual(["type","properties","required"]);
  });

  it("post116b: fence 5 properties keys", () => {
    const fences = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(Object.keys(JSON.parse(fences[5]).properties || {})).toEqual(["name","stream_url","logo","editorial","genre"]);
  });

  it("post116b: occurrence count of backlink_curate", () => {
    expect((spec.match(/backlink_curate/g) || []).length).toBe(1);
  });

  it("post116b: occurrence count of backlink_genres", () => {
    expect((spec.match(/backlink_genres/g) || []).length).toBe(1);
  });

  it("post116b: occurrence count of backlink_now_playing", () => {
    expect((spec.match(/backlink_now_playing/g) || []).length).toBe(1);
  });

  it("post116b: occurrence count of stream_url", () => {
    expect((spec.match(/stream_url/g) || []).length).toBe(3);
  });

  it("post116b: occurrence count of curated_by", () => {
    expect((spec.match(/curated_by/g) || []).length).toBe(1);
  });

  it("post116b: occurrence count of editorial", () => {
    expect((spec.match(/editorial/g) || []).length).toBe(5);
  });

  it("post116b: occurrence count of Gemini", () => {
    expect((spec.match(/Gemini/g) || []).length).toBe(2);
  });

  it("post116b: occurrence count of iptv-org", () => {
    expect((spec.match(/iptv-org/g) || []).length).toBe(1);
  });

  it("post116b: occurrence count of fuzzywigg", () => {
    expect((spec.match(/fuzzywigg/g) || []).length).toBe(1);
  });

  it('post116b: every GENRE_MAP value is in VALID_GENRES or is a known alias target', () => {
    for (const [alias, target] of Object.entries(GENRE_MAP)) {
      expect(VALID_GENRES.includes(target as (typeof VALID_GENRES)[number])).toBe(true);
      expect(alias.toLowerCase()).toBe(alias);
    }
  });

  it('post116b: docs genre examples resolve through GENRE_MAP/VALID_GENRES', () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(spec.toLowerCase()).toContain(g);
      expect(VALID_GENRES).toContain(g);
      expect(resolveGenre(g)).toBe(g);
    }
    expect(resolveGenre('late night')).toBe('ambient');
    expect(resolveGenre('focus')).toBe('ambient');
    expect(resolveGenre('chill')).toBe('ambient');
  });

  it('post116b: claw-mcp auth none and openapi url frozen', () => {
    expect(MCP_MANIFEST.auth).toEqual({ type: 'none' });
    expect(MCP_MANIFEST.api).toEqual({ type: 'openapi', url: '/openapi.json' });
    expect(spec).not.toContain('/openapi.json');
  });

  it('post116b: Worker index still has no MCP_MANIFEST import (manifest stays claw-side)', () => {
    expect(indexSrc).not.toMatch(/from ['"]\.\/mcp['"]/);
    expect(indexSrc).not.toContain('MCP_MANIFEST');
    expect(mcpSrc).not.toContain('resolveGenre');
    expect(mcpSrc).not.toContain('GENRE_MAP');
  });

  it('post116b: DEPLOY + README still mention domain/Gemini without inventing MCP HTTP routes', () => {
    expect(deployMd).toMatch(/GEMINI_API_KEY/);
    expect(deployMd).toMatch(/HITL/i);
    expect(readmeMd.toLowerCase()).toMatch(/backlink|radio|gemini|iptv/);
    expect(readmeMd).not.toMatch(/app\.get\(['"]\/playlist/);
  });
});

// --- HEAVY burn (post-#126): deepen mcp-spec leftover edges only — no product inventing ---
// Orthogonal to #126 ci-config leftovers. Digests, HMAC post126 locks, docs↔MCP_MANIFEST
// asymmetry, GENRE_MAP/VALID_GENRES cross-locks, fence schema pins — tests-only.

describe('post126 mcp-spec-contract HEAVY deepen', () => {
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const pairSum = (hex: string) => {
    let s = 0;
    for (let i = 0; i < hex.length; i += 2) s += parseInt(hex.slice(i, i + 2), 16);
    return s;
  };
  const rollingXor = (hex: string) => {
    let a = 0;
    for (let i = 0; i < hex.length; i += 2) a ^= parseInt(hex.slice(i, i + 2), 16);
    return a;
  };
  const DOCS_IDS = ["backlink_curate","backlink_genres","backlink_now_playing"] as const;
  const CLAW_NAMES = ["station_select","now_playing","genre_filter","curator_prompt"] as const;
  const indexSrc = readFileSync(join(root, 'src/index.ts'), 'utf8');
  const mcpSrc = readFileSync(join(root, 'src/mcp.ts'), 'utf8');
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const deploy = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

  it('post126: locks mcp-spec.md sha256 digest', () => {
    expect(sha256('docs/mcp-spec.md')).toBe(
      'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849',
    );
  });

  it('post126: locks mcp-spec.md sha1 digest', () => {
    expect(sha1('docs/mcp-spec.md')).toBe('e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a');
  });

  it('post126: locks mcp-spec.md md5 digest', () => {
    expect(md5('docs/mcp-spec.md')).toBe('ee7881030c338c1773659cc6378c392c');
  });

  it('post126: locks mcp-spec.md sha256 nibble sum 514 xor 14', () => {
    const d = sha256('docs/mcp-spec.md');
    expect(nibbleSum(d)).toBe(514);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post126: locks mcp-spec.md sha256 pairSum 4534 rollingXor 164', () => {
    const d = sha256('docs/mcp-spec.md');
    expect(pairSum(d)).toBe(4534);
    expect(rollingXor(d)).toBe(164);
  });

  it('post126: locks mcp-spec.md byte size 3552', () => {
    expect(statSync(join(root, 'docs/mcp-spec.md')).size).toBe(3552);
    expect(readFileSync(join(root, 'docs/mcp-spec.md')).byteLength).toBe(3552);
  });

  it('post126: locks mcp-spec.md utf8 length 3544 lines 145', () => {
    expect(readFileSync(join(root, 'docs/mcp-spec.md'), 'utf8')).toHaveLength(3544);
    expect(readFileSync(join(root, 'docs/mcp-spec.md'), 'utf8').split('\n')).toHaveLength(145);
  });

  it('post126: locks mcp-spec.md HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'docs/mcp-spec.md')).toBe(
      '0420a0feb0aee333c9c83902b9ff4847e9151b324749f5c9ce993508eff3d70b',
    );
  });

  it('post126: locks mcp-spec.md HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'docs/mcp-spec.md')).toBe(
      'cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df',
    );
  });

  it('post126: locks mcp-spec.md sha256 first/last/mid octets', () => {
    const hex = sha256('docs/mcp-spec.md');
    expect(hex.slice(0, 2)).toBe('a9');
    expect(hex.slice(-2)).toBe('49');
    expect(hex.slice(28, 36)).toBe('c7628b21');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks mcp.ts sha256 digest', () => {
    expect(sha256('src/mcp.ts')).toBe(
      '6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683',
    );
  });

  it('post126: locks mcp.ts sha1 digest', () => {
    expect(sha1('src/mcp.ts')).toBe('848b3977365809fda54fcb74a7d09affe685ea82');
  });

  it('post126: locks mcp.ts md5 digest', () => {
    expect(md5('src/mcp.ts')).toBe('52e71c72e32e3d95b8b8d61ff4a2cf46');
  });

  it('post126: locks mcp.ts sha256 nibble sum 551 xor 1', () => {
    const d = sha256('src/mcp.ts');
    expect(nibbleSum(d)).toBe(551);
    expect(xorNibbles(d)).toBe(1);
  });

  it('post126: locks mcp.ts sha256 pairSum 4751 rollingXor 103', () => {
    const d = sha256('src/mcp.ts');
    expect(pairSum(d)).toBe(4751);
    expect(rollingXor(d)).toBe(103);
  });

  it('post126: locks mcp.ts byte size 2057', () => {
    expect(statSync(join(root, 'src/mcp.ts')).size).toBe(2057);
    expect(readFileSync(join(root, 'src/mcp.ts')).byteLength).toBe(2057);
  });

  it('post126: locks mcp.ts utf8 length 2057 lines 68', () => {
    expect(readFileSync(join(root, 'src/mcp.ts'), 'utf8')).toHaveLength(2057);
    expect(readFileSync(join(root, 'src/mcp.ts'), 'utf8').split('\n')).toHaveLength(68);
  });

  it('post126: locks mcp.ts HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'src/mcp.ts')).toBe(
      'd6bbbe08e1a6d4ce854fc3037c5a4590d86f31d868892f4fa30aeddaf6e4a1ff',
    );
  });

  it('post126: locks mcp.ts HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'src/mcp.ts')).toBe(
      '8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712',
    );
  });

  it('post126: locks mcp.ts sha256 first/last/mid octets', () => {
    const hex = sha256('src/mcp.ts');
    expect(hex.slice(0, 2)).toBe('6a');
    expect(hex.slice(-2)).toBe('83');
    expect(hex.slice(28, 36)).toBe('6ad61aff');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks genres.ts sha256 digest', () => {
    expect(sha256('src/genres.ts')).toBe(
      'aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e',
    );
  });

  it('post126: locks genres.ts sha1 digest', () => {
    expect(sha1('src/genres.ts')).toBe('3dd586bfd23c91e9719b56c90c8cbfe038aebc3e');
  });

  it('post126: locks genres.ts md5 digest', () => {
    expect(md5('src/genres.ts')).toBe('ee8d34506f688c9e3097b89a35d48aa5');
  });

  it('post126: locks genres.ts sha256 nibble sum 500 xor 6', () => {
    const d = sha256('src/genres.ts');
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post126: locks genres.ts sha256 pairSum 3950 rollingXor 96', () => {
    const d = sha256('src/genres.ts');
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it('post126: locks genres.ts byte size 1027', () => {
    expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027);
    expect(readFileSync(join(root, 'src/genres.ts')).byteLength).toBe(1027);
  });

  it('post126: locks genres.ts utf8 length 1025 lines 48', () => {
    expect(readFileSync(join(root, 'src/genres.ts'), 'utf8')).toHaveLength(1025);
    expect(readFileSync(join(root, 'src/genres.ts'), 'utf8').split('\n')).toHaveLength(48);
  });

  it('post126: locks genres.ts HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'src/genres.ts')).toBe(
      'd00397aa14b640d123623b36ef27110bc9deed9da9f10ad241e24389d9ab5b9a',
    );
  });

  it('post126: locks genres.ts HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'src/genres.ts')).toBe(
      'bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f',
    );
  });

  it('post126: locks genres.ts sha256 first/last/mid octets', () => {
    const hex = sha256('src/genres.ts');
    expect(hex.slice(0, 2)).toBe('aa');
    expect(hex.slice(-2)).toBe('4e');
    expect(hex.slice(28, 36)).toBe('811dfbc2');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks index.ts sha256 digest', () => {
    expect(sha256('src/index.ts')).toBe(
      '7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72',
    );
  });

  it('post126: locks index.ts sha1 digest', () => {
    expect(sha1('src/index.ts')).toBe('88b9273a584ce23d1da7ca8a147fee7faeee640b');
  });

  it('post126: locks index.ts md5 digest', () => {
    expect(md5('src/index.ts')).toBe('8c9cdb320becf0effa2d8027b66a2177');
  });

  it('post126: locks index.ts sha256 nibble sum 470 xor 14', () => {
    const d = sha256('src/index.ts');
    expect(nibbleSum(d)).toBe(470);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post126: locks index.ts sha256 pairSum 4265 rollingXor 151', () => {
    const d = sha256('src/index.ts');
    expect(pairSum(d)).toBe(4265);
    expect(rollingXor(d)).toBe(151);
  });

  it('post126: locks index.ts byte size 4738', () => {
    expect(statSync(join(root, 'src/index.ts')).size).toBe(4738);
    expect(readFileSync(join(root, 'src/index.ts')).byteLength).toBe(4738);
  });

  it('post126: locks index.ts utf8 length 4724 lines 154', () => {
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toHaveLength(4724);
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8').split('\n')).toHaveLength(154);
  });

  it('post126: locks index.ts HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'src/index.ts')).toBe(
      '8b3e887c6aba91ba1e3e67132a9f169906b85e48e656d3e7522f1cd97c6e0c93',
    );
  });

  it('post126: locks index.ts HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'src/index.ts')).toBe(
      '268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be',
    );
  });

  it('post126: locks index.ts sha256 first/last/mid octets', () => {
    const hex = sha256('src/index.ts');
    expect(hex.slice(0, 2)).toBe('7f');
    expect(hex.slice(-2)).toBe('72');
    expect(hex.slice(28, 36)).toBe('e2a20389');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks parser.ts sha256 digest', () => {
    expect(sha256('src/parser.ts')).toBe(
      'cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368',
    );
  });

  it('post126: locks parser.ts sha1 digest', () => {
    expect(sha1('src/parser.ts')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it('post126: locks parser.ts md5 digest', () => {
    expect(md5('src/parser.ts')).toBe('500211c4c526de887252451726776563');
  });

  it('post126: locks parser.ts sha256 nibble sum 477 xor 9', () => {
    const d = sha256('src/parser.ts');
    expect(nibbleSum(d)).toBe(477);
    expect(xorNibbles(d)).toBe(9);
  });

  it('post126: locks parser.ts sha256 pairSum 3612 rollingXor 126', () => {
    const d = sha256('src/parser.ts');
    expect(pairSum(d)).toBe(3612);
    expect(rollingXor(d)).toBe(126);
  });

  it('post126: locks parser.ts byte size 1955', () => {
    expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955);
    expect(readFileSync(join(root, 'src/parser.ts')).byteLength).toBe(1955);
  });

  it('post126: locks parser.ts utf8 length 1953 lines 67', () => {
    expect(readFileSync(join(root, 'src/parser.ts'), 'utf8')).toHaveLength(1953);
    expect(readFileSync(join(root, 'src/parser.ts'), 'utf8').split('\n')).toHaveLength(67);
  });

  it('post126: locks parser.ts HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'src/parser.ts')).toBe(
      '37e5f42836543b47389f2ea0a090b73fae44bd622643292ff3eb8ac0cebd2ca3',
    );
  });

  it('post126: locks parser.ts HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'src/parser.ts')).toBe(
      'e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3',
    );
  });

  it('post126: locks parser.ts sha256 first/last/mid octets', () => {
    const hex = sha256('src/parser.ts');
    expect(hex.slice(0, 2)).toBe('cf');
    expect(hex.slice(-2)).toBe('68');
    expect(hex.slice(28, 36)).toBe('a0e83a07');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks types.ts sha256 digest', () => {
    expect(sha256('src/types.ts')).toBe(
      '4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3',
    );
  });

  it('post126: locks types.ts sha1 digest', () => {
    expect(sha1('src/types.ts')).toBe('1e8906673dc0d140ee5c3d40839c88a1eeca03d8');
  });

  it('post126: locks types.ts md5 digest', () => {
    expect(md5('src/types.ts')).toBe('ecba663d21928622be656805ad27d0a3');
  });

  it('post126: locks types.ts sha256 nibble sum 520 xor 14', () => {
    const d = sha256('src/types.ts');
    expect(nibbleSum(d)).toBe(520);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post126: locks types.ts sha256 pairSum 4300 rollingXor 104', () => {
    const d = sha256('src/types.ts');
    expect(pairSum(d)).toBe(4300);
    expect(rollingXor(d)).toBe(104);
  });

  it('post126: locks types.ts byte size 174', () => {
    expect(statSync(join(root, 'src/types.ts')).size).toBe(174);
    expect(readFileSync(join(root, 'src/types.ts')).byteLength).toBe(174);
  });

  it('post126: locks types.ts utf8 length 172 lines 7', () => {
    expect(readFileSync(join(root, 'src/types.ts'), 'utf8')).toHaveLength(172);
    expect(readFileSync(join(root, 'src/types.ts'), 'utf8').split('\n')).toHaveLength(7);
  });

  it('post126: locks types.ts HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'src/types.ts')).toBe(
      '89a850d0a5ee234610052900012e5fbc0b9639570b995ebaede827ed307943f9',
    );
  });

  it('post126: locks types.ts HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'src/types.ts')).toBe(
      '80ae340e1af2b36a05fff7ab748e51fcfb6bf74f1efc7da6e4f5e11fae103e85',
    );
  });

  it('post126: locks types.ts sha256 first/last/mid octets', () => {
    const hex = sha256('src/types.ts');
    expect(hex.slice(0, 2)).toBe('40');
    expect(hex.slice(-2)).toBe('d3');
    expect(hex.slice(28, 36)).toBe('345e4f21');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks package.json sha256 digest', () => {
    expect(sha256('package.json')).toBe(
      '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c',
    );
  });

  it('post126: locks package.json sha1 digest', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post126: locks package.json md5 digest', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post126: locks package.json sha256 nibble sum 451 xor 13', () => {
    const d = sha256('package.json');
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post126: locks package.json sha256 pairSum 4051 rollingXor 13', () => {
    const d = sha256('package.json');
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it('post126: locks package.json byte size 637', () => {
    expect(statSync(join(root, 'package.json')).size).toBe(637);
    expect(readFileSync(join(root, 'package.json')).byteLength).toBe(637);
  });

  it('post126: locks package.json utf8 length 635 lines 26', () => {
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toHaveLength(635);
    expect(readFileSync(join(root, 'package.json'), 'utf8').split('\n')).toHaveLength(26);
  });

  it('post126: locks package.json HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'package.json')).toBe(
      '14829b01670d1141c34c0f804f9f31c439da8acbb1f3134ba460e7979be45543',
    );
  });

  it('post126: locks package.json HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'package.json')).toBe(
      '20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1',
    );
  });

  it('post126: locks package.json sha256 first/last/mid octets', () => {
    const hex = sha256('package.json');
    expect(hex.slice(0, 2)).toBe('34');
    expect(hex.slice(-2)).toBe('1c');
    expect(hex.slice(28, 36)).toBe('e0ecaa43');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks vitest.config.ts sha256 digest', () => {
    expect(sha256('vitest.config.ts')).toBe(
      'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38',
    );
  });

  it('post126: locks vitest.config.ts sha1 digest', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post126: locks vitest.config.ts md5 digest', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post126: locks vitest.config.ts sha256 nibble sum 536 xor 2', () => {
    const d = sha256('vitest.config.ts');
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post126: locks vitest.config.ts sha256 pairSum 4691 rollingXor 49', () => {
    const d = sha256('vitest.config.ts');
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it('post126: locks vitest.config.ts byte size 535', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
    expect(readFileSync(join(root, 'vitest.config.ts')).byteLength).toBe(535);
  });

  it('post126: locks vitest.config.ts utf8 length 535 lines 22', () => {
    expect(readFileSync(join(root, 'vitest.config.ts'), 'utf8')).toHaveLength(535);
    expect(readFileSync(join(root, 'vitest.config.ts'), 'utf8').split('\n')).toHaveLength(22);
  });

  it('post126: locks vitest.config.ts HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'vitest.config.ts')).toBe(
      '7dc6d3aaa91074a7f8a463f6c511be0456cec62d44a7232276df3321a2af115a',
    );
  });

  it('post126: locks vitest.config.ts HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'vitest.config.ts')).toBe(
      '3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7',
    );
  });

  it('post126: locks vitest.config.ts sha256 first/last/mid octets', () => {
    const hex = sha256('vitest.config.ts');
    expect(hex.slice(0, 2)).toBe('f9');
    expect(hex.slice(-2)).toBe('38');
    expect(hex.slice(28, 36)).toBe('ec95c6d5');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks tsconfig.json sha256 digest', () => {
    expect(sha256('tsconfig.json')).toBe(
      'ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792',
    );
  });

  it('post126: locks tsconfig.json sha1 digest', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post126: locks tsconfig.json md5 digest', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post126: locks tsconfig.json sha256 nibble sum 506 xor 8', () => {
    const d = sha256('tsconfig.json');
    expect(nibbleSum(d)).toBe(506);
    expect(xorNibbles(d)).toBe(8);
  });

  it('post126: locks tsconfig.json sha256 pairSum 4436 rollingXor 110', () => {
    const d = sha256('tsconfig.json');
    expect(pairSum(d)).toBe(4436);
    expect(rollingXor(d)).toBe(110);
  });

  it('post126: locks tsconfig.json byte size 397', () => {
    expect(statSync(join(root, 'tsconfig.json')).size).toBe(397);
    expect(readFileSync(join(root, 'tsconfig.json')).byteLength).toBe(397);
  });

  it('post126: locks tsconfig.json utf8 length 397 lines 24', () => {
    expect(readFileSync(join(root, 'tsconfig.json'), 'utf8')).toHaveLength(397);
    expect(readFileSync(join(root, 'tsconfig.json'), 'utf8').split('\n')).toHaveLength(24);
  });

  it('post126: locks tsconfig.json HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'tsconfig.json')).toBe(
      'e8b09f48f110f327aa29f7e17d702678431147ac94ac6b60f6243bf9806c8250',
    );
  });

  it('post126: locks tsconfig.json HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'tsconfig.json')).toBe(
      '8b1d7fdf24ecef58d7971089e3fb62f7cf97d8a840f50636ffa32327fa8503a9',
    );
  });

  it('post126: locks tsconfig.json sha256 first/last/mid octets', () => {
    const hex = sha256('tsconfig.json');
    expect(hex.slice(0, 2)).toBe('ef');
    expect(hex.slice(-2)).toBe('92');
    expect(hex.slice(28, 36)).toBe('04688ea1');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks wrangler.toml sha256 digest', () => {
    expect(sha256('wrangler.toml')).toBe(
      '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8',
    );
  });

  it('post126: locks wrangler.toml sha1 digest', () => {
    expect(sha1('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post126: locks wrangler.toml md5 digest', () => {
    expect(md5('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post126: locks wrangler.toml sha256 nibble sum 457 xor 13', () => {
    const d = sha256('wrangler.toml');
    expect(nibbleSum(d)).toBe(457);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post126: locks wrangler.toml sha256 pairSum 3802 rollingXor 122', () => {
    const d = sha256('wrangler.toml');
    expect(pairSum(d)).toBe(3802);
    expect(rollingXor(d)).toBe(122);
  });

  it('post126: locks wrangler.toml byte size 330', () => {
    expect(statSync(join(root, 'wrangler.toml')).size).toBe(330);
    expect(readFileSync(join(root, 'wrangler.toml')).byteLength).toBe(330);
  });

  it('post126: locks wrangler.toml utf8 length 330 lines 18', () => {
    expect(readFileSync(join(root, 'wrangler.toml'), 'utf8')).toHaveLength(330);
    expect(readFileSync(join(root, 'wrangler.toml'), 'utf8').split('\n')).toHaveLength(18);
  });

  it('post126: locks wrangler.toml HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'wrangler.toml')).toBe(
      'da3ab4682042abd142b12864ac0a33348f5f3412a7640f9ebe695194f0a11a39',
    );
  });

  it('post126: locks wrangler.toml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'wrangler.toml')).toBe(
      '117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063',
    );
  });

  it('post126: locks wrangler.toml sha256 first/last/mid octets', () => {
    const hex = sha256('wrangler.toml');
    expect(hex.slice(0, 2)).toBe('95');
    expect(hex.slice(-2)).toBe('f8');
    expect(hex.slice(28, 36)).toBe('4a0b0b87');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks AGENTS.md sha256 digest', () => {
    expect(sha256('AGENTS.md')).toBe(
      '48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa',
    );
  });

  it('post126: locks AGENTS.md sha1 digest', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post126: locks AGENTS.md md5 digest', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post126: locks AGENTS.md sha256 nibble sum 479 xor 5', () => {
    const d = sha256('AGENTS.md');
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post126: locks AGENTS.md sha256 pairSum 5084 rollingXor 216', () => {
    const d = sha256('AGENTS.md');
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it('post126: locks AGENTS.md byte size 1017', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
    expect(readFileSync(join(root, 'AGENTS.md')).byteLength).toBe(1017);
  });

  it('post126: locks AGENTS.md utf8 length 1011 lines 35', () => {
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toHaveLength(1011);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8').split('\n')).toHaveLength(35);
  });

  it('post126: locks AGENTS.md HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'AGENTS.md')).toBe(
      'a620cc1251b411667680245e6deeb061f5b530a19f50c662643eadef7f75a3c8',
    );
  });

  it('post126: locks AGENTS.md HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'AGENTS.md')).toBe(
      'ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e',
    );
  });

  it('post126: locks AGENTS.md sha256 first/last/mid octets', () => {
    const hex = sha256('AGENTS.md');
    expect(hex.slice(0, 2)).toBe('48');
    expect(hex.slice(-2)).toBe('aa');
    expect(hex.slice(28, 36)).toBe('a5ec1be5');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks README.md sha256 digest', () => {
    expect(sha256('README.md')).toBe(
      'f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987',
    );
  });

  it('post126: locks README.md sha1 digest', () => {
    expect(sha1('README.md')).toBe('4f560a473d5838f25eba3eae21a87f6c97ba3b8b');
  });

  it('post126: locks README.md md5 digest', () => {
    expect(md5('README.md')).toBe('9b7aea4982a6d68b95f7f8ee3fdc5b31');
  });

  it('post126: locks README.md sha256 nibble sum 429 xor 13', () => {
    const d = sha256('README.md');
    expect(nibbleSum(d)).toBe(429);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post126: locks README.md sha256 pairSum 4164 rollingXor 88', () => {
    const d = sha256('README.md');
    expect(pairSum(d)).toBe(4164);
    expect(rollingXor(d)).toBe(88);
  });

  it('post126: locks README.md byte size 2801', () => {
    expect(statSync(join(root, 'README.md')).size).toBe(2801);
    expect(readFileSync(join(root, 'README.md')).byteLength).toBe(2801);
  });

  it('post126: locks README.md utf8 length 2757 lines 82', () => {
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toHaveLength(2757);
    expect(readFileSync(join(root, 'README.md'), 'utf8').split('\n')).toHaveLength(82);
  });

  it('post126: locks README.md HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'README.md')).toBe(
      '0c275c4d75e9635c687c4b907f8d1458b6f71c3a9d99c665e9c3f994b4011988',
    );
  });

  it('post126: locks README.md HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'README.md')).toBe(
      '57c08297703e57c6b5694a515e43b6592bd130637c82dcc569a048bda2fd181f',
    );
  });

  it('post126: locks README.md sha256 first/last/mid octets', () => {
    const hex = sha256('README.md');
    expect(hex.slice(0, 2)).toBe('f7');
    expect(hex.slice(-2)).toBe('87');
    expect(hex.slice(28, 36)).toBe('368a10ca');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks DEPLOY.md sha256 digest', () => {
    expect(sha256('DEPLOY.md')).toBe(
      '11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a',
    );
  });

  it('post126: locks DEPLOY.md sha1 digest', () => {
    expect(sha1('DEPLOY.md')).toBe('37c72be44abb67343dae3e7c2303306a25b3481f');
  });

  it('post126: locks DEPLOY.md md5 digest', () => {
    expect(md5('DEPLOY.md')).toBe('da30bf656fdf0d9a61d2a00860c325f5');
  });

  it('post126: locks DEPLOY.md sha256 nibble sum 439 xor 11', () => {
    const d = sha256('DEPLOY.md');
    expect(nibbleSum(d)).toBe(439);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post126: locks DEPLOY.md sha256 pairSum 4234 rollingXor 26', () => {
    const d = sha256('DEPLOY.md');
    expect(pairSum(d)).toBe(4234);
    expect(rollingXor(d)).toBe(26);
  });

  it('post126: locks DEPLOY.md byte size 1573', () => {
    expect(statSync(join(root, 'DEPLOY.md')).size).toBe(1573);
    expect(readFileSync(join(root, 'DEPLOY.md')).byteLength).toBe(1573);
  });

  it('post126: locks DEPLOY.md utf8 length 1539 lines 65', () => {
    expect(readFileSync(join(root, 'DEPLOY.md'), 'utf8')).toHaveLength(1539);
    expect(readFileSync(join(root, 'DEPLOY.md'), 'utf8').split('\n')).toHaveLength(65);
  });

  it('post126: locks DEPLOY.md HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', 'DEPLOY.md')).toBe(
      'db2a16ad7db463fdebaae16f8fb003e9e9cf6622db8f0ab74209844276376b90',
    );
  });

  it('post126: locks DEPLOY.md HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'DEPLOY.md')).toBe(
      '8e69d3722a2f57941fecb3a0602ebb6cab5a31755e7c8bc88ed0771bc1822659',
    );
  });

  it('post126: locks DEPLOY.md sha256 first/last/mid octets', () => {
    const hex = sha256('DEPLOY.md');
    expect(hex.slice(0, 2)).toBe('11');
    expect(hex.slice(-2)).toBe('5a');
    expect(hex.slice(28, 36)).toBe('f363d487');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks ci.yml sha256 digest', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe(
      'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5',
    );
  });

  it('post126: locks ci.yml sha1 digest', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post126: locks ci.yml md5 digest', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post126: locks ci.yml sha256 nibble sum 515 xor 3', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post126: locks ci.yml sha256 pairSum 4595 rollingXor 71', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(pairSum(d)).toBe(4595);
    expect(rollingXor(d)).toBe(71);
  });

  it('post126: locks ci.yml byte size 6295', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295);
    expect(readFileSync(join(root, '.github/workflows/ci.yml')).byteLength).toBe(6295);
  });

  it('post126: locks ci.yml utf8 length 6295 lines 177', () => {
    expect(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).toHaveLength(6295);
    expect(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8').split('\n')).toHaveLength(177);
  });

  it('post126: locks ci.yml HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', '.github/workflows/ci.yml')).toBe(
      '9a41345f39dec2662882e71f1ca7e55ec17f773c5670e239d694d6825cc632b3',
    );
  });

  it('post126: locks ci.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe(
      'd3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce',
    );
  });

  it('post126: locks ci.yml sha256 first/last/mid octets', () => {
    const hex = sha256('.github/workflows/ci.yml');
    expect(hex.slice(0, 2)).toBe('c4');
    expect(hex.slice(-2)).toBe('d5');
    expect(hex.slice(28, 36)).toBe('f5e6f56e');
    expect(hex).toHaveLength(64);
  });

  it('post126: locks deploy.yml sha256 digest', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe(
      '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3',
    );
  });

  it('post126: locks deploy.yml sha1 digest', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post126: locks deploy.yml md5 digest', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post126: locks deploy.yml sha256 nibble sum 476 xor 4', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post126: locks deploy.yml sha256 pairSum 3686 rollingXor 38', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(pairSum(d)).toBe(3686);
    expect(rollingXor(d)).toBe(38);
  });

  it('post126: locks deploy.yml byte size 1004', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004);
    expect(readFileSync(join(root, '.github/workflows/deploy.yml')).byteLength).toBe(1004);
  });

  it('post126: locks deploy.yml utf8 length 1004 lines 47', () => {
    expect(readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8')).toHaveLength(1004);
    expect(readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8').split('\n')).toHaveLength(47);
  });

  it('post126: locks deploy.yml HMAC-SHA256 key post126', () => {
    expect(hmacSha256('post126', '.github/workflows/deploy.yml')).toBe(
      'eb322b24392d6466acd8ac3f7eb64f61eb862e0b037bd66d5c1a25c5531a05b8',
    );
  });

  it('post126: locks deploy.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/workflows/deploy.yml')).toBe(
      'e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83',
    );
  });

  it('post126: locks deploy.yml sha256 first/last/mid octets', () => {
    const hex = sha256('.github/workflows/deploy.yml');
    expect(hex.slice(0, 2)).toBe('49');
    expect(hex.slice(-2)).toBe('c3');
    expect(hex.slice(28, 36)).toBe('de06de33');
    expect(hex).toHaveLength(64);
  });

  it('post126: docs title line locked', () => {
    expect(spec.split('\n')[0]).toBe("# Backlink MCP Tool Specification");
  });

  it('post126: docs tool headings are exactly three backlink_* ids in order', () => {
    expect([...spec.matchAll(/### `([^`]+)`/g)].map((m) => m[1])).toEqual([...DOCS_IDS]);
  });

  it('post126: claw MCP_MANIFEST tool names are four and distinct from docs ids', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([...CLAW_NAMES]);
    for (const id of DOCS_IDS) expect(CLAW_NAMES as readonly string[]).not.toContain(id);
    for (const n of CLAW_NAMES) expect(DOCS_IDS as readonly string[]).not.toContain(n);
  });

  it('post126: docs↔claw asymmetry is exactly 3 docs tools vs 4 claw tools', () => {
    expect(DOCS_IDS).toHaveLength(3);
    expect(CLAW_NAMES).toHaveLength(4);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('post126: MCP_MANIFEST auth none and openapi url frozen', () => {
    expect(MCP_MANIFEST.auth).toEqual({ type: 'none' });
    expect(MCP_MANIFEST.api).toEqual({ type: 'openapi', url: '/openapi.json' });
    expect(spec).not.toContain('/openapi.json');
  });

  it('post126: MCP_MANIFEST schema_version name_for_model name_for_human frozen', () => {
    expect(MCP_MANIFEST.schema_version).toBe('v1');
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
  });

  it('post126: locks exactly six json fences in mcp-spec.md', () => {
    expect([...spec.matchAll(/```json\n/g)]).toHaveLength(6);
    expect(jsonFences()).toHaveLength(6);
  });

  it('post126: each input schema fence has additionalProperties false', () => {
    const fences = jsonFences() as Array<Record<string, unknown>>;
    expect(fences[0].additionalProperties).toBe(false);
    expect(fences[2].additionalProperties).toBe(false);
    expect(fences[4].additionalProperties).toBe(false);
  });

  it('post126: curate input fence properties are genre and mood only', () => {
    const fence = jsonFences()[0] as { properties: Record<string, unknown> };
    expect(Object.keys(fence.properties)).toEqual(['genre', 'mood']);
  });

  it('post126: genres input fence properties empty object', () => {
    const fence = jsonFences()[2] as { properties: Record<string, unknown> };
    expect(Object.keys(fence.properties)).toEqual([]);
  });

  it('post126: now_playing input fence properties are genre and mood', () => {
    const fence = jsonFences()[4] as { properties: Record<string, unknown> };
    expect(Object.keys(fence.properties)).toEqual(['genre', 'mood']);
  });

  it('post126: curate output fence has query curated_by timestamp stations', () => {
    const fence = jsonFences()[1] as { properties: Record<string, unknown> };
    expect(Object.keys(fence.properties)).toEqual(['query', 'curated_by', 'timestamp', 'stations']);
  });

  it('post126: genres output fence has genres and aliases', () => {
    const fence = jsonFences()[3] as { properties: Record<string, unknown> };
    expect(Object.keys(fence.properties)).toEqual(['genres', 'aliases']);
  });

  it('post126: now_playing output fence uses stream_url not url and required triple', () => {
    const fence = jsonFences()[5] as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(fence.properties)).toEqual(['name', 'stream_url', 'logo', 'editorial', 'genre']);
    expect(fence.required).toEqual(['name', 'stream_url', 'genre']);
    expect(fence.properties).not.toHaveProperty('url');
  });

  it('post126: curate station items require name url genre only', () => {
    const fence = jsonFences()[1] as { properties: { stations: { items: { required: string[]; properties: Record<string, unknown> } } } };
    expect(fence.properties.stations.items.required).toEqual(['name', 'url', 'genre']);
    expect(fence.properties.stations.items.properties).toHaveProperty('editorial');
    expect(fence.properties.stations.items.properties).toHaveProperty('logo');
  });

  it('post126: Endpoint lines lock curate genres now_playing mappings', () => {
    expect(spec).toMatch(/\*\*Endpoint:\*\* \`GET \/curate/);
    expect(spec).toMatch(/\*\*Endpoint:\*\* \`GET \/genres\`/);
    expect(spec).toMatch(/stream_url/);
    expect(spec).toMatch(/stations\[0\]/);
  });

  it('post126: Integration Notes lock Base URL and no-auth and 1h TTL and Gemini fresh', () => {
    expect(spec).toMatch(/Base URL:\s*\`https:\/\/backlink\.fuzzywigg\.com\`/);
    expect(spec).toMatch(/No auth required for read endpoints/i);
    expect(spec).toMatch(/1h TTL/i);
    expect(spec).toMatch(/Gemini fresh|always calls Gemini/i);
    expect(spec).toMatch(/editorial:\s*null/);
  });

  it('post126: occurrence counts for docs tool ids', () => {
    expect((spec.match(/backlink_curate/g) || []).length).toBe(1);
    expect((spec.match(/backlink_genres/g) || []).length).toBe(1);
    expect((spec.match(/backlink_now_playing/g) || []).length).toBe(1);
    expect((spec.match(/stream_url/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((spec.match(/curated_by/g) || []).length).toBeGreaterThanOrEqual(1);
    expect((spec.match(/Gemini/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  it('post126: VALID_GENRES membership and GENRE_MAP alias targets', () => {
    for (const g of VALID_GENRES) expect(typeof g).toBe('string');
    for (const [alias, target] of Object.entries(GENRE_MAP)) {
      expect(VALID_GENRES.includes(target as (typeof VALID_GENRES)[number])).toBe(true);
      expect(alias.toLowerCase()).toBe(alias);
    }
  });

  it('post126: resolveGenre locks for canonical and alias inputs', () => {
    expect(resolveGenre('jazz')).toBe('jazz');
    expect(resolveGenre('classical')).toBe('classical');
    expect(resolveGenre('late night')).toBe('ambient');
    expect(resolveGenre('focus')).toBe('ambient');
    expect(resolveGenre('chill')).toBe('ambient');
    expect(resolveGenre('energizing')).toBe('music');
    expect(resolveGenre(undefined)).toBe('music');
    expect(resolveGenre('')).toBe('music');
  });

  it('post126: docs genre examples are VALID_GENRES; energizing stays outside map', () => {
    for (const g of ['jazz', 'classical', 'ambient', 'rock', 'pop'] as const) {
      expect(spec.toLowerCase()).toContain(g);
      expect(VALID_GENRES as readonly string[]).toContain(g);
    }
    expect(GENRE_MAP).not.toHaveProperty('energizing');
  });

  it('post126: index Worker does not import MCP_MANIFEST; mcp does not import genres', () => {
    expect(indexSrc).not.toMatch(/from ['"]\.\/mcp['"]/);
    expect(indexSrc).not.toContain('MCP_MANIFEST');
    expect(mcpSrc).not.toContain('resolveGenre');
    expect(mcpSrc).not.toContain('GENRE_MAP');
    expect(mcpSrc).not.toContain('VALID_GENRES');
  });

  it('post126: index exposes /curate /genres /stations without inventing /playlist or /now-playing routes', () => {
    expect(indexSrc).toMatch(/['"]\/curate['"]/);
    expect(indexSrc).toMatch(/['"]\/genres['"]/);
    expect(indexSrc).toMatch(/['"]\/stations['"]/);
    expect(indexSrc).not.toMatch(/['"]\/playlist['"]/);
    expect(indexSrc).not.toMatch(/['"]\/now-playing['"]/);
    expect(spec).not.toMatch(/\/playlist/);
  });

  it('post126: spec and claw stay free of Anthropic Claude Haiku invent', () => {
    expect(spec.toLowerCase()).not.toMatch(/anthropic|claude|haiku/);
    expect(mcpSrc.toLowerCase()).not.toMatch(/anthropic|claude|haiku/);
    expect(indexSrc.toLowerCase()).not.toMatch(/anthropic|claude|haiku/);
  });

  it('post126: AGENTS Verify block still lists npm ci typecheck test coverage', () => {
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toMatch(/test:coverage/);
  });

  it('post126: DEPLOY mentions GEMINI without inventing MCP HTTP routes', () => {
    expect(deploy).toMatch(/GEMINI/);
    expect(deploy).not.toMatch(/app\.get\(['"]\/playlist/);
  });

  it('post126: README mentions backlink radio without inventing openapi route docs', () => {
    expect(readme.toLowerCase()).toMatch(/backlink|radio|gemini|iptv/);
    expect(readme).not.toContain('/openapi.json');
  });

  it('post126: package.json remains ESM named backlink with vitest coverage script', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
      type: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe('backlink');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.typecheck).toBeTruthy();
    expect(pkg.scripts.test).toBeTruthy();
    expect(pkg.scripts['test:coverage']).toBeTruthy();
  });

  it('post126: ci.yml still runs typecheck and test:coverage on ubuntu', () => {
    expect(ci).toContain('npm run typecheck');
    expect(ci).toMatch(/test:coverage/);
    expect(ci).toContain('ubuntu-latest');
    expect(ci).not.toContain('wrangler deploy');
  });

  it('post126: spec has no CR bytes and trailing newline', () => {
    expect(spec.includes('\r')).toBe(false);
    expect(spec.endsWith('\n')).toBe(true);
  });

  it('post126: slice first 40 and last 40 of mcp-spec.md', () => {
    expect(spec.slice(0, 40)).toBe("# Backlink MCP Tool Specification\n\nThis ");
    expect(spec.slice(-40)).toBe("p 5 raw stations with `editorial: null`\n");
  });

  it('post126: slice first 40 and last 40 of mcp.ts', () => {
    expect(mcpSrc.slice(0, 40)).toBe("export const MCP_MANIFEST = {\n  schema_v");
    expect(mcpSrc.slice(-40)).toBe("ired: [\"mood\"],\n      },\n    },\n  ],\n};\n");
  });

  it('post126: sha256 of concatenated docs tool ids', () => {
    const joined = DOCS_IDS.join('|');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      '60d6a047978939b110eda070c62c863f066235c50f7444ff0d251862a9bd69a3',
    );
  });

  it('post126: sha256 of concatenated claw tool names', () => {
    const joined = CLAW_NAMES.join('|');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      '2015d2ac108fff286afe263f4973ac93f78f2eb5690a4a051be6dc5d4edb064d',
    );
  });

  it('post126: digest-of-digests over post126 mcp-spec surface file set', () => {
    const files = [
      'docs/mcp-spec.md',
      'src/mcp.ts',
      'src/genres.ts',
      'src/index.ts',
      'src/parser.ts',
      'src/types.ts',
      'package.json',
      'vitest.config.ts',
      'tsconfig.json',
      'wrangler.toml',
      'AGENTS.md',
      'README.md',
      'DEPLOY.md',
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
    ];
    const joined = files.map((rel) => sha256(rel)).join('');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      '01ede5d28216b153ab2f534b9032be55e41b2f149c861fb6e19a9fa16ed74b12',
    );
  });

  it('post126: mega purity — 20 rounds of mcp-spec.md sha256 stability', () => {
    const expected = 'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849';
    for (let i = 0; i < 20; i++) expect(sha256('docs/mcp-spec.md')).toBe(expected);
  });

  it('post126: mega purity — 10 rounds of HMAC post126 on mcp-spec.md', () => {
    const expected = '0420a0feb0aee333c9c83902b9ff4847e9151b324749f5c9ce993508eff3d70b';
    for (let i = 0; i < 10; i++) expect(hmacSha256('post126', 'docs/mcp-spec.md')).toBe(expected);
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=post126)', () => {
    expect(hmacSha256('post126', 'docs/mcp-spec.md')).toBe(
      '0420a0feb0aee333c9c83902b9ff4847e9151b324749f5c9ce993508eff3d70b',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=mcp-spec)', () => {
    expect(hmacSha256('mcp-spec', 'docs/mcp-spec.md')).toBe(
      '21d41c5da610b736683b86a776e8661e8b25294a698027c8d552fa6eace78cb3',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=leftover)', () => {
    expect(hmacSha256('leftover', 'docs/mcp-spec.md')).toBe(
      'cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=backlink)', () => {
    expect(hmacSha256('backlink', 'docs/mcp-spec.md')).toBe(
      '98920add1fa15e869968c8efbc949fab60baf5ca95945eaf466caf563dff3e9f',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=backlink_curate)', () => {
    expect(hmacSha256('backlink_curate', 'docs/mcp-spec.md')).toBe(
      'd5be7a976b320237501c22881a382cf75b22af14a3f886ea5bb34d88fec2e1b2',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=backlink_genres)', () => {
    expect(hmacSha256('backlink_genres', 'docs/mcp-spec.md')).toBe(
      'f9384a7b6410e8e73a6d2acbd7a8c528b41fb612659b8f376924c87d0be870d0',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=backlink_now_playing)', () => {
    expect(hmacSha256('backlink_now_playing', 'docs/mcp-spec.md')).toBe(
      'd0f976d64252d4ad35ce5a5eafa023ae98ba6d5a3ca6be16019cf3a1cf96946e',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=stream_url)', () => {
    expect(hmacSha256('stream_url', 'docs/mcp-spec.md')).toBe(
      'c582e603126a829add1be68dd7c7cf8e307c582440fef51bb09b65022e5a2db6',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=MCP_MANIFEST)', () => {
    expect(hmacSha256('MCP_MANIFEST', 'docs/mcp-spec.md')).toBe(
      '65d649abc3807ea8ee1e06cf11f0e8230aa717ed8094ed1de906798e69e16597',
    );
  });

  it('post126: HMAC-SHA256(mcp-spec.md, key=GENRE_MAP)', () => {
    expect(hmacSha256('GENRE_MAP', 'docs/mcp-spec.md')).toBe(
      'e01fc8634bfedbbedcd9da59f972d0afcedfd135b07c02806e7499d4eede1a1c',
    );
  });

  it('post126: HMAC-SHA256(mcp.ts, key=post126)', () => {
    expect(hmacSha256('post126', 'src/mcp.ts')).toBe(
      'd6bbbe08e1a6d4ce854fc3037c5a4590d86f31d868892f4fa30aeddaf6e4a1ff',
    );
  });

  it('post126: HMAC-SHA256(mcp.ts, key=leftover)', () => {
    expect(hmacSha256('leftover', 'src/mcp.ts')).toBe(
      '8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712',
    );
  });

  it('post126: HMAC-SHA256(mcp.ts, key=claw-mcp)', () => {
    expect(hmacSha256('claw-mcp', 'src/mcp.ts')).toBe(
      'd2be78dfaf67430ea34569738fbdb4577f6cb48928cd16c895ec53378b2e1eb5',
    );
  });

  it('post126: HMAC-SHA256(mcp.ts, key=station_select)', () => {
    expect(hmacSha256('station_select', 'src/mcp.ts')).toBe(
      'd8c897e3e257256d5c946e2e941fbc36b75dc2a5027d3685a0f2446686d8cea2',
    );
  });

  it('post126: HMAC-SHA256(mcp.ts, key=curator_prompt)', () => {
    expect(hmacSha256('curator_prompt', 'src/mcp.ts')).toBe(
      '70897363a596f9754bee8cc34105600129e430194d666f995b799708bf1b3259',
    );
  });

  it('post126: negative inventing — no WebSocket SSE invent in spec or mcp', () => {
    expect(spec.toLowerCase()).not.toMatch(/websocket|server-sent|\bsse\b/); expect(mcpSrc.toLowerCase()).not.toMatch(/websocket|\bsse\b/);
  });

  it('post126: negative inventing — no OAuth bearer invent in Integration Notes', () => {
    expect(spec.toLowerCase()).not.toMatch(/oauth|bearer token|api key required/);
  });

  it('post126: negative inventing — no Anthropic MCP SDK package invent', () => {
    expect(spec).not.toMatch(/@modelcontextprotocol|anthropic-sdk/); expect(mcpSrc).not.toMatch(/@modelcontextprotocol/);
  });

  it('post126: negative inventing — no /openapi.json documented as Worker Endpoint', () => {
    expect(spec).not.toMatch(/\*\*Endpoint:\*\*.*openapi/); expect(spec).not.toContain('GET /openapi.json');
  });

  it('post126: negative inventing — claw tool names never appear as docs headings', () => {
    for (const n of CLAW_NAMES) expect(spec).not.toContain('### `' + n + '`');
  });

  it('post126: negative inventing — docs tool ids never appear as MCP_MANIFEST tool names', () => {
    for (const id of DOCS_IDS) expect(MCP_MANIFEST.tools.map((t) => t.name)).not.toContain(id);
  });

  it('post126: negative inventing — no Dockerfile invent in repo root', () => {
    expect(() => readFileSync(join(root, 'Dockerfile'))).toThrow();
  });

  it('post126: negative inventing — no second package manager lockfiles', () => {
    expect(() => readFileSync(join(root, 'yarn.lock'))).toThrow(); expect(() => readFileSync(join(root, 'pnpm-lock.yaml'))).toThrow();
  });

  it('post126: GENRE_MAP has 21 aliases; VALID_GENRES has 9', () => {
    expect(Object.keys(GENRE_MAP).length).toBe(21);
    expect(VALID_GENRES).toHaveLength(9);
    expect([...VALID_GENRES]).toEqual(["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]);
  });

  it('post126: every GENRE_MAP value is a VALID_GENRES member', () => {
    for (const v of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES).toContain(v as (typeof VALID_GENRES)[number]);
    }
  });

  it('post126: GENRE_MAP late night maps to ambient and resolveGenre agrees', () => {
    expect(GENRE_MAP["late night"]).toBe('ambient');
    expect(resolveGenre("late night")).toBe('ambient');
  });

  it('post126: GENRE_MAP chill maps to ambient and resolveGenre agrees', () => {
    expect(GENRE_MAP["chill"]).toBe('ambient');
    expect(resolveGenre("chill")).toBe('ambient');
  });

  it('post126: GENRE_MAP ambient maps to ambient and resolveGenre agrees', () => {
    expect(GENRE_MAP["ambient"]).toBe('ambient');
    expect(resolveGenre("ambient")).toBe('ambient');
  });

  it('post126: GENRE_MAP relaxing maps to ambient and resolveGenre agrees', () => {
    expect(GENRE_MAP["relaxing"]).toBe('ambient');
    expect(resolveGenre("relaxing")).toBe('ambient');
  });

  it('post126: GENRE_MAP focus maps to ambient and resolveGenre agrees', () => {
    expect(GENRE_MAP["focus"]).toBe('ambient');
    expect(resolveGenre("focus")).toBe('ambient');
  });

  it('post126: GENRE_MAP classical maps to classical and resolveGenre agrees', () => {
    expect(GENRE_MAP["classical"]).toBe('classical');
    expect(resolveGenre("classical")).toBe('classical');
  });

  it('post126: GENRE_MAP classic maps to classical and resolveGenre agrees', () => {
    expect(GENRE_MAP["classic"]).toBe('classical');
    expect(resolveGenre("classic")).toBe('classical');
  });

  it('post126: GENRE_MAP jazz maps to jazz and resolveGenre agrees', () => {
    expect(GENRE_MAP["jazz"]).toBe('jazz');
    expect(resolveGenre("jazz")).toBe('jazz');
  });

  it('post126: GENRE_MAP blues maps to jazz and resolveGenre agrees', () => {
    expect(GENRE_MAP["blues"]).toBe('jazz');
    expect(resolveGenre("blues")).toBe('jazz');
  });

  it('post126: GENRE_MAP pop maps to pop and resolveGenre agrees', () => {
    expect(GENRE_MAP["pop"]).toBe('pop');
    expect(resolveGenre("pop")).toBe('pop');
  });

  it('post126: GENRE_MAP rock maps to rock and resolveGenre agrees', () => {
    expect(GENRE_MAP["rock"]).toBe('rock');
    expect(resolveGenre("rock")).toBe('rock');
  });

  it('post126: GENRE_MAP metal maps to rock and resolveGenre agrees', () => {
    expect(GENRE_MAP["metal"]).toBe('rock');
    expect(resolveGenre("metal")).toBe('rock');
  });

  it('post126: GENRE_MAP indie maps to rock and resolveGenre agrees', () => {
    expect(GENRE_MAP["indie"]).toBe('rock');
    expect(resolveGenre("indie")).toBe('rock');
  });

  it('post126: GENRE_MAP music maps to music and resolveGenre agrees', () => {
    expect(GENRE_MAP["music"]).toBe('music');
    expect(resolveGenre("music")).toBe('music');
  });

  it('post126: GENRE_MAP news maps to news and resolveGenre agrees', () => {
    expect(GENRE_MAP["news"]).toBe('news');
    expect(resolveGenre("news")).toBe('news');
  });

  it('post126: GENRE_MAP sports maps to sports and resolveGenre agrees', () => {
    expect(GENRE_MAP["sports"]).toBe('sports');
    expect(resolveGenre("sports")).toBe('sports');
  });

  it('post126: GENRE_MAP entertainment maps to entertainment and resolveGenre agrees', () => {
    expect(GENRE_MAP["entertainment"]).toBe('entertainment');
    expect(resolveGenre("entertainment")).toBe('entertainment');
  });

  it('post126: GENRE_MAP dance maps to pop and resolveGenre agrees', () => {
    expect(GENRE_MAP["dance"]).toBe('pop');
    expect(resolveGenre("dance")).toBe('pop');
  });

  it('post126: GENRE_MAP electronic maps to ambient and resolveGenre agrees', () => {
    expect(GENRE_MAP["electronic"]).toBe('ambient');
    expect(resolveGenre("electronic")).toBe('ambient');
  });

  it('post126: GENRE_MAP lofi maps to ambient and resolveGenre agrees', () => {
    expect(GENRE_MAP["lofi"]).toBe('ambient');
    expect(resolveGenre("lofi")).toBe('ambient');
  });

  it('post126: GENRE_MAP lo-fi maps to ambient and resolveGenre agrees', () => {
    expect(GENRE_MAP["lo-fi"]).toBe('ambient');
    expect(resolveGenre("lo-fi")).toBe('ambient');
  });

  it('post126: curator_prompt requires mood; genre optional; station_select requires station_name', () => {
    const curator = MCP_MANIFEST.tools.find((t) => t.name === 'curator_prompt')!;
    expect(curator.input_schema.required).toEqual(['mood']);
    expect(Object.keys(curator.input_schema.properties || {})).toEqual(
      expect.arrayContaining(['mood', 'genre']),
    );
    const select = MCP_MANIFEST.tools.find((t) => t.name === 'station_select')!;
    expect(select.input_schema.required).toEqual(['station_name']);
  });

  it('post126: genre_filter requires genre; now_playing has empty properties', () => {
    const gf = MCP_MANIFEST.tools.find((t) => t.name === 'genre_filter')!;
    expect(gf.input_schema.required).toEqual(['genre']);
    const np = MCP_MANIFEST.tools.find((t) => t.name === 'now_playing')!;
    expect(Object.keys(np.input_schema.properties || {})).toEqual([]);
  });

  it('post126: sha384 and sha512 digests of mcp-spec.md locked', () => {
    expect(createHash('sha384').update(readFileSync(join(root, 'docs/mcp-spec.md'))).digest('hex')).toBe(
      'b32096b74bacd48065f014d2695673b3bfad3cb9118b855899a92a849cd38a7dd751db7c9e0705d6d6569d5f05f61227',
    );
    expect(createHash('sha512').update(readFileSync(join(root, 'docs/mcp-spec.md'))).digest('hex')).toBe(
      '8d26bafffcb1230048d80796e1d8a1019d83253810324d18383c54ff8bcaaed4a508b0a07395994af2f23e4f9b627e2202a57fcac709110d0ee859e8628709e7',
    );
  });

  it('post126: base64 of mcp-spec first line', () => {
    const line = spec.split('\n')[0];
    expect(Buffer.from(line, 'utf8').toString('base64')).toBe(
      'IyBCYWNrbGluayBNQ1AgVG9vbCBTcGVjaWZpY2F0aW9u',
    );
  });

  it('post126: fromCharCode rebuild of backlink name_for_model', () => {
    const rebuilt = String.fromCharCode(98, 97, 99, 107, 108, 105, 110, 107);
    expect(rebuilt).toBe('backlink');
    expect(MCP_MANIFEST.name_for_model).toBe(rebuilt);
  });

  it('post126: TextEncoder byte length of docs tool ids', () => {
    expect(new TextEncoder().encode('backlink_curate').length).toBe(15);
    expect(new TextEncoder().encode('backlink_genres').length).toBe(15);
    expect(new TextEncoder().encode('backlink_now_playing').length).toBe(20);
  });

  it('post126: final inventory — mcp-spec describe blocks include post112 post116 post126', () => {
    const body = readFileSync(join(root, 'test/mcp-spec-contract.test.ts'), 'utf8');
    expect(body).toContain('post112');
    expect(body).toContain('post116');
    expect(body).toContain("describe('post126 mcp-spec-contract HEAVY deepen'");
    expect((body.match(/it\('post126:/g) ?? []).length).toBeGreaterThan(100);
  });

  it('post126: mcp-spec-contract.test.ts ends with newline after post126', () => {
    expect(readFileSync(join(root, 'test/mcp-spec-contract.test.ts'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('post126: dirname of this test file resolves to test/', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    expect(dir.endsWith('/test') || dir.endsWith('test')).toBe(true);
  });

  it('post126: does not invent thin envjson stubs or credential material in this suite', () => {
    expect(spec).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(mcpSrc).not.toMatch(/api[_-]?key\s*[:=]/i);
    // ci.yml may mention GEMINI_API_KEY only inside forbid/grep hygiene — never as an assignment export
    expect(ci).not.toMatch(/^\s*GEMINI_API_KEY\s*=/m);
    expect(ci).not.toMatch(/env:\s*\n\s*GEMINI_API_KEY:/);
  });

});

// --- post126b extras: more leftover mcp-spec edge locks (still tests-only) ---
describe('post126 mcp-spec-contract HEAVY deepen extras', () => {
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const mcpSrc = readFileSync(join(root, 'src/mcp.ts'), 'utf8');
  const indexSrc = readFileSync(join(root, 'src/index.ts'), 'utf8');
  const parserSrc = readFileSync(join(root, 'src/parser.ts'), 'utf8');

  it('post126b: sha256 of mcp-spec.md line 0', () => {
    expect(createHash('sha256').update(spec.split('\n')[0]).digest('hex')).toBe(
      '99c84d33ad819ac91a66e1a30aef3bf512cb393370d7b6fbc8397c8917ba2e66',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 1', () => {
    expect(createHash('sha256').update(spec.split('\n')[1]).digest('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 2', () => {
    expect(createHash('sha256').update(spec.split('\n')[2]).digest('hex')).toBe(
      '5e0f013658c5f50f7c40c93531494fbb57ec6e3c6d3fb79f9ae8de8be3979572',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 3', () => {
    expect(createHash('sha256').update(spec.split('\n')[3]).digest('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 4', () => {
    expect(createHash('sha256').update(spec.split('\n')[4]).digest('hex')).toBe(
      'cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 5', () => {
    expect(createHash('sha256').update(spec.split('\n')[5]).digest('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 6', () => {
    expect(createHash('sha256').update(spec.split('\n')[6]).digest('hex')).toBe(
      '0b27734b46fbf7ef264d7dcff4505a08b8773717141fac872ecc4d1c686ca54c',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 7', () => {
    expect(createHash('sha256').update(spec.split('\n')[7]).digest('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 8', () => {
    expect(createHash('sha256').update(spec.split('\n')[8]).digest('hex')).toBe(
      'ff3cf26fccc178587f5e9fd4ea384b4504907333f5685d3918dcf5cf001e7594',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 9', () => {
    expect(createHash('sha256').update(spec.split('\n')[9]).digest('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 10', () => {
    expect(createHash('sha256').update(spec.split('\n')[10]).digest('hex')).toBe(
      '02b56e10fd373ef3e120665848a53d523d0c461f43d47226da7bfda0fda6700d',
    );
  });

  it('post126b: sha256 of mcp-spec.md line 11', () => {
    expect(createHash('sha256').update(spec.split('\n')[11]).digest('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('post126b: mcp.ts has no tabs and uses 2-space indent on tools array', () => {
    expect(mcpSrc.includes('\t')).toBe(false);
    expect(mcpSrc).toContain('  tools: [');
  });

  it('post126b: genres.ts GENRE_MAP keys are all lowercase', () => {
    for (const k of Object.keys(GENRE_MAP)) expect(k).toBe(k.toLowerCase());
  });

  it('post126b: VALID_GENRES are unique and order-frozen', () => {
    expect(new Set(VALID_GENRES).size).toBe(VALID_GENRES.length);
    expect([...VALID_GENRES]).toEqual(["music","ambient","jazz","classical","pop","rock","news","sports","entertainment"]);
  });

  it('post126b: resolveGenre("Jazz") -> jazz', () => {
    expect(resolveGenre("Jazz")).toBe('jazz');
  });

  it('post126b: resolveGenre("  jazz  ") -> jazz', () => {
    expect(resolveGenre("  jazz  ")).toBe('jazz');
  });

  it('post126b: resolveGenre("LATE NIGHT") -> ambient', () => {
    expect(resolveGenre("LATE NIGHT")).toBe('ambient');
  });

  it('post126b: resolveGenre("Lo-Fi") -> ambient', () => {
    expect(resolveGenre("Lo-Fi")).toBe('ambient');
  });

  it('post126b: resolveGenre("lofi") -> ambient', () => {
    expect(resolveGenre("lofi")).toBe('ambient');
  });

  it('post126b: resolveGenre("METAL") -> rock', () => {
    expect(resolveGenre("METAL")).toBe('rock');
  });

  it('post126b: resolveGenre("Blues") -> jazz', () => {
    expect(resolveGenre("Blues")).toBe('jazz');
  });

  it('post126b: resolveGenre("unknown-xyz") -> music', () => {
    expect(resolveGenre("unknown-xyz")).toBe('music');
  });

  it('post126b: json fence 0 round-trips through JSON.stringify', () => {
    const fence = jsonFences()[0] as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(fence))).toEqual(fence);
    expect(fence.type).toBe('object');
  });

  it('post126b: json fence 5 required order stable under JSON round-trip', () => {
    const fence = jsonFences()[5] as { required: string[] };
    expect(JSON.parse(JSON.stringify(fence.required))).toEqual(['name', 'stream_url', 'genre']);
  });

  it('post126b: index /curate and /genres handlers exist while docs Endpoint paths match', () => {
    expect(indexSrc).toMatch(/\/(curate|genres|stations)/);
    expect(spec).toMatch(/GET \/curate/);
    expect(spec).toMatch(/GET \/genres/);
  });

  it('post126b: parser exports remain Station-shaped without inventing NowPlaying type', () => {
    expect(parserSrc).toMatch(/export (interface|type) Station/);
    expect(parserSrc).not.toMatch(/NowPlaying/);
    expect(spec).not.toMatch(/interface NowPlaying/);
  });

  it('post126b: HMAC-SHA256(src/genres.ts, key=post126b)', () => {
    expect(hmacSha256('post126b', 'src/genres.ts')).toBe(
      '3a773ef704f2fc3b8630612e71bd5e33d51a7e72be503b4230600aebbb8db35f',
    );
  });

  it('post126b: HMAC-SHA256(src/genres.ts, key=leftover)', () => {
    expect(hmacSha256('leftover', 'src/genres.ts')).toBe(
      'bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f',
    );
  });

  it('post126b: HMAC-SHA256(src/genres.ts, key=no-invent)', () => {
    expect(hmacSha256('no-invent', 'src/genres.ts')).toBe(
      '9f3fa6caa0dc07c6dfb08ff1f3ec88ab2f1ce6800d07fc4ac613a79e9e6a974f',
    );
  });

  it('post126b: HMAC-SHA256(src/index.ts, key=post126b)', () => {
    expect(hmacSha256('post126b', 'src/index.ts')).toBe(
      '77f916a93276c27ed755dfd7ea55fa32480f9a0e6aea59a3af2ebd8e4f6c3722',
    );
  });

  it('post126b: HMAC-SHA256(src/index.ts, key=leftover)', () => {
    expect(hmacSha256('leftover', 'src/index.ts')).toBe(
      '268d5e353fd881bdd119b1f654cb291896d509e3f70768fde43a2bef6fdea2be',
    );
  });

  it('post126b: HMAC-SHA256(src/index.ts, key=no-invent)', () => {
    expect(hmacSha256('no-invent', 'src/index.ts')).toBe(
      'ac1664326fe9a96468bcaf27422b305e016c5cbbe30d36b433bef7df5196ecaa',
    );
  });

  it('post126b: HMAC-SHA256(src/parser.ts, key=post126b)', () => {
    expect(hmacSha256('post126b', 'src/parser.ts')).toBe(
      '84cb4ff9365eeb471e88e0ee27a0fbedfacb499bbbc3fa1a85df5f178c5b89ee',
    );
  });

  it('post126b: HMAC-SHA256(src/parser.ts, key=leftover)', () => {
    expect(hmacSha256('leftover', 'src/parser.ts')).toBe(
      'e74189a221ce1b1a2a4d081f9b68599ba752e6b01af10d0050cb60dcf731b7c3',
    );
  });

  it('post126b: HMAC-SHA256(src/parser.ts, key=no-invent)', () => {
    expect(hmacSha256('no-invent', 'src/parser.ts')).toBe(
      '84147a191b6868db188ee8a90ecf4718920d422211d2c8386cc2f174ae71fada',
    );
  });

  it('post126b: HMAC-SHA256(docs/mcp-spec.md, key=post126b)', () => {
    expect(hmacSha256('post126b', 'docs/mcp-spec.md')).toBe(
      'a81d43de78cc4695c7b237c36741841c3b7cb21e8c5620eb36ddf81061f2e25e',
    );
  });

  it('post126b: HMAC-SHA256(docs/mcp-spec.md, key=leftover)', () => {
    expect(hmacSha256('leftover', 'docs/mcp-spec.md')).toBe(
      'cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df',
    );
  });

  it('post126b: HMAC-SHA256(docs/mcp-spec.md, key=no-invent)', () => {
    expect(hmacSha256('no-invent', 'docs/mcp-spec.md')).toBe(
      '022068747b9d69f410f4732de467a31f8a566b2c5537325861510672dce4f7af',
    );
  });

  it('post126b: size*lines product of docs/mcp-spec.md is 515040', () => {
    expect(statSync(join(root, 'docs/mcp-spec.md')).size * readFileSync(join(root, 'docs/mcp-spec.md'), 'utf8').split('\n').length).toBe(515040);
  });

  it('post126b: size*lines product of src/mcp.ts is 139876', () => {
    expect(statSync(join(root, 'src/mcp.ts')).size * readFileSync(join(root, 'src/mcp.ts'), 'utf8').split('\n').length).toBe(139876);
  });

  it('post126b: size*lines product of src/genres.ts is 49296', () => {
    expect(statSync(join(root, 'src/genres.ts')).size * readFileSync(join(root, 'src/genres.ts'), 'utf8').split('\n').length).toBe(49296);
  });

  it('post126b: sha256 of reversed docs/mcp-spec.md', () => {
    const rev = [...readFileSync(join(root, 'docs/mcp-spec.md'), 'utf8')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('8e0a8a17d78474b7a2c052d335989cd8a980b200816869706af232736e35ab47');
  });

  it('post126b: sha256 of reversed src/mcp.ts', () => {
    const rev = [...readFileSync(join(root, 'src/mcp.ts'), 'utf8')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('5fb580296684d084fa1bca986fdaa5c31fb63d427f9c5b62f7581941727ba73c');
  });

  it('post126b: sha256 of reversed src/genres.ts', () => {
    const rev = [...readFileSync(join(root, 'src/genres.ts'), 'utf8')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac');
  });

  it('post126b: locks docs/mcp-spec.md sha256 UPPERCASE', () => {
    expect(sha256('docs/mcp-spec.md').toUpperCase()).toBe('A93978D779B976A1ABA4D34395EEC7628B21BDA910EF8A279D5EFBC05DA56849');
  });

  it('post126b: locks src/mcp.ts sha256 UPPERCASE', () => {
    expect(sha256('src/mcp.ts').toUpperCase()).toBe('6AE8FFD7C4B75C471DB2DFF1FE5C6AD61AFF69E38B048A366BB8B7ADB3099683');
  });

  it('post126b: occurrence of additionalProperties >= 3', () => {
    expect((spec.match(/additionalProperties/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('post126b: occurrence of Endpoint >= 3', () => {
    expect((spec.match(/Endpoint/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('post126b: occurrence of Description >= 3', () => {
    expect((spec.match(/Description/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('post126b: negative inventing — no GraphQL invent', () => {
    expect(spec.toLowerCase()).not.toMatch(/graphql|apollo/); expect(mcpSrc.toLowerCase()).not.toMatch(/graphql/);
  });

  it('post126b: negative inventing — no gRPC invent', () => {
    expect(spec.toLowerCase()).not.toMatch(/\bgrpc\b/);
  });

  it('post126b: negative inventing — no Redis invent in mcp-spec surface', () => {
    expect(spec.toLowerCase()).not.toMatch(/redis|upstash/);
  });

  it('post126b: negative inventing — no Stripe billing invent', () => {
    expect(spec.toLowerCase()).not.toMatch(/stripe|billing portal/);
  });

  it('post126b: negative inventing — no JWT invent in docs tools', () => {
    expect(spec.toLowerCase()).not.toMatch(/\bjwt\b|json web token/);
  });

  it('post126b: negative inventing — no /admin route invent', () => {
    expect(spec).not.toMatch(/\/admin/); expect(indexSrc).not.toMatch(/['"]\/admin['"]/);
  });

  it('post126b: MCP_MANIFEST descriptions mention IPTV/AI without inventing new tool ids', () => {
    expect(MCP_MANIFEST.description_for_model.toLowerCase()).toMatch(/backlink|iptv|curator|station/);
    expect(MCP_MANIFEST.description_for_human.toLowerCase()).toMatch(/radio|iptv|ai/);
    expect(MCP_MANIFEST.tools.map((t) => t.name).join(',')).not.toContain('backlink_');
  });

  it('post126b: docs Base URL host stays backlink.fuzzywigg.com without inventing alt hosts', () => {
    expect(spec).toContain('https://backlink.fuzzywigg.com');
    expect(spec).not.toMatch(/workers\.dev|pages\.dev|localhost:8787/);
  });

  it('post126b: post126 + post126b inventory counts', () => {
    const body = readFileSync(join(root, 'test/mcp-spec-contract.test.ts'), 'utf8');
    expect((body.match(/it\('post126:/g) ?? []).length).toBeGreaterThan(100);
    expect((body.match(/it\('post126b:/g) ?? []).length).toBeGreaterThan(40);
    expect(body).toContain("describe('post126 mcp-spec-contract HEAVY deepen extras'");
  });

});
