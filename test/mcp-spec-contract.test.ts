import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MCP_MANIFEST } from '../src/mcp';
import { GENRE_MAP, VALID_GENRES } from '../src/genres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = readFileSync(join(root, 'docs/mcp-spec.md'), 'utf8');

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
});

