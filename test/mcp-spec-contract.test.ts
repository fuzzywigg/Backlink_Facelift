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
});
