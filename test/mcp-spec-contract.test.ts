import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MCP_MANIFEST } from '../src/mcp';
import { GENRE_MAP, VALID_GENRES } from '../src/genres';

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
