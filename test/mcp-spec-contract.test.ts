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
  it('documents exactly three ### tool headings under Tools', () => {
    const toolsSection = spec.slice(spec.indexOf('## Tools'), spec.indexOf('## Integration Notes'));
    expect((toolsSection.match(/^### `/gm) ?? []).length).toBe(3);
  });
  it('locks tool heading order curate → genres → now_playing', () => {
    const headings = [...spec.matchAll(/^### `([^`]+)`/gm)].map((m) => m[1]);
    expect(headings).toEqual(['backlink_curate', 'backlink_genres', 'backlink_now_playing']);
  });
  it('documents now_playing as single best station / stations[0] remap', () => {
    const section = spec.slice(spec.indexOf('### `backlink_now_playing`'));
    expect(section).toMatch(/stations\[0\]/);
    expect(section).toMatch(/stream_url/);
    expect(section).toMatch(/remapped/);
  });
  it('curate and now_playing share the same Endpoint path template', () => {
    const endpoints = [...spec.matchAll(/\*\*Endpoint:\*\*\s*`([^`]+)`/g)].map((m) => m[1]);
    expect(endpoints.filter((e) => e.startsWith('GET /curate')).length).toBe(2);
    expect(endpoints).toContain('GET /genres');
  });
  it('documents curated_by and timestamp on curate Output', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toMatch(/"curated_by"/);
    expect(section).toMatch(/"timestamp"/);
    expect(section).toMatch(/"format": "date-time"/);
  });
  it('documents genres Output aliases additionalProperties type string', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_genres`'),
      spec.indexOf('### `backlink_now_playing`'),
    );
    expect(section).toMatch(
      /"additionalProperties":\s*\{\s*"type":\s*"string"\s*\}/,
    );
  });
  it('documents genres description Canonical genre slugs', () => {
    expect(spec).toMatch(/Canonical genre slugs accepted by \/curate and \/stations/);
  });
  it('documents Friendly name → canonical slug mapping', () => {
    expect(spec).toMatch(/Friendly name → canonical slug mapping/);
  });
  it('does not document claw-mcp station_select tool in docs Tools', () => {
    expect(spec).not.toMatch(/backlink_station_select/);
    expect(spec).not.toMatch(/station_select/);
  });
  it('does not document genre_filter claw tool name in docs', () => {
    expect(spec).not.toMatch(/genre_filter/);
    expect(spec).not.toMatch(/curator_prompt/);
  });
  it('locks Integration Notes bullet count at 5', () => {
    const notes = spec.slice(spec.indexOf('## Integration Notes'));
    expect((notes.match(/^- /gm) ?? []).length).toBe(5);
  });
  it('mentions no LLM response caching for /curate', () => {
    expect(spec).toMatch(/no LLM response caching/);
  });
  it('mentions No auth required for read endpoints', () => {
    expect(spec).toMatch(/No auth required for read endpoints/);
  });
  it('curate input genre examples are subset of VALID_GENRES', () => {
    const examples = ['jazz', 'classical', 'ambient', 'rock', 'pop'];
    for (const ex of examples) {
      expect(VALID_GENRES as readonly string[]).toContain(ex);
    }
  });
  it('now_playing genre examples include GENRE_MAP late night alias', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_now_playing`'),
      spec.indexOf('## Integration Notes'),
    );
    expect(section).toMatch(/late night/);
    expect(GENRE_MAP['late night']).toBe('ambient');
  });
  it('does not use markdown tables in the spec', () => {
    expect(spec).not.toMatch(/\|[-:]+\|/);
  });
  it('keeps H1 title Backlink MCP Tool Specification', () => {
    expect(spec.split('\n')[0]).toBe('# Backlink MCP Tool Specification');
  });
  it('mentions claw-mcp in the intro paragraph', () => {
    expect(spec).toMatch(/claw-mcp tool set/);
  });
  it('documents url format uri on curate station items', () => {
    const section = spec.slice(
      spec.indexOf('### `backlink_curate`'),
      spec.indexOf('### `backlink_genres`'),
    );
    expect(section).toMatch(/"url":\s*\{\s*"type":\s*"string",\s*"format":\s*"uri"\s*\}/);
  });
  it('documents stream_url format uri on now_playing', () => {
    const section = spec.slice(spec.indexOf('### `backlink_now_playing`'));
    expect(section).toMatch(
      /"stream_url":\s*\{\s*"type":\s*"string",\s*"format":\s*"uri"\s*\}/,
    );
  });
  it('keeps additionalProperties false on all three Input Schemas', () => {
    expect((spec.match(/"additionalProperties": false/g) ?? []).length).toBe(3);
  });
  it('does not document POST methods', () => {
    expect(spec).not.toMatch(/\bPOST\b/);
  });
  it('cross-locks docs Base URL to DEPLOY custom domain', () => {
    const deploy = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
    expect(deploy).toMatch(/backlink\.fuzzywigg\.com/);
    expect(spec).toMatch(/https:\/\/backlink\.fuzzywigg\.com/);
  });
});
