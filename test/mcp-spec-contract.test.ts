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

  // --- HEAVY burn (post-#43): docs/mcp-spec.md contract deepen ---

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

});
