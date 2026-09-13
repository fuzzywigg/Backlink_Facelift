import { describe, expect, it } from 'vitest';
import { MCP_MANIFEST } from '../src/mcp';

function toolNamed(name: string) {
  const tool = MCP_MANIFEST.tools.find((t) => t.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('MCP_MANIFEST', () => {
  it('declares schema, naming, and open auth', () => {
    expect(MCP_MANIFEST.schema_version).toBe('v1');
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
    expect(MCP_MANIFEST.auth).toEqual({ type: 'none' });
    expect(MCP_MANIFEST.api).toEqual({ type: 'openapi', url: '/openapi.json' });
    expect(MCP_MANIFEST.description_for_model).toMatch(/AI-curated IPTV radio/i);
    expect(MCP_MANIFEST.description_for_human).toMatch(/iptv-org/i);
  });

  it('exposes the four claw-mcp tools with stable names', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(names).toEqual(['station_select', 'now_playing', 'genre_filter', 'curator_prompt']);
  });

  it('requires station_name for station_select', () => {
    const tool = toolNamed('station_select');
    expect(tool.description).toMatch(/currently playing/i);
    expect(tool.input_schema.required).toEqual(['station_name']);
    expect(tool.input_schema.properties.station_name?.type).toBe('string');
  });

  it('defines now_playing with an empty object schema', () => {
    const tool = toolNamed('now_playing');
    expect(tool.input_schema).toEqual({ type: 'object', properties: {} });
    expect(tool.description).toMatch(/stream URL/i);
  });

  it('requires genre for genre_filter', () => {
    const tool = toolNamed('genre_filter');
    expect(tool.description).toMatch(/jazz|news|classical/i);
    expect(tool.input_schema.required).toEqual(['genre']);
    expect(tool.input_schema.properties.genre?.description).toMatch(/Genre keyword/i);
  });

  it('requires mood and optionally accepts genre for curator_prompt', () => {
    const tool = toolNamed('curator_prompt');
    expect(tool.input_schema.required).toEqual(['mood']);
    expect(tool.input_schema.properties.mood?.type).toBe('string');
    expect(tool.input_schema.properties.genre?.type).toBe('string');
    expect(tool.description).toMatch(/mood/i);
  });

  it('keeps every tool schema typed as object', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeTypeOf('object');
    }
  });

  it('gives every tool a non-empty description', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.trim().length).toBeGreaterThan(10);
    }
  });

  it('keeps tool names unique', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('documents curator_prompt mood examples in the property description', () => {
    const tool = toolNamed('curator_prompt');
    expect(tool.input_schema.properties.mood?.description).toMatch(/focus work|late night jazz|morning energy/i);
  });

  it('keeps tool descriptions unique', () => {
    const descriptions = MCP_MANIFEST.tools.map((t) => t.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('documents every required property with a non-empty description', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const required = tool.input_schema.required ?? [];
      for (const key of required) {
        const prop = tool.input_schema.properties[key as keyof typeof tool.input_schema.properties];
        expect(prop, `${tool.name}.${key}`).toBeDefined();
        expect(prop?.description?.trim().length).toBeGreaterThan(5);
      }
    }
  });

  it('does not mark optional curator_prompt.genre as required', () => {
    const tool = toolNamed('curator_prompt');
    expect(tool.input_schema.required).not.toContain('genre');
    expect(tool.input_schema.properties.genre?.description).toMatch(/Optional genre/i);
  });

  it('locks station_select property description to name matching', () => {
    const tool = toolNamed('station_select');
    expect(tool.input_schema.properties.station_name?.description).toMatch(/Partial or full name/i);
  });

  it('exposes exactly four tools (no silent additions)', () => {
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('keeps human/model descriptions distinct and non-empty', () => {
    expect(MCP_MANIFEST.description_for_human.trim().length).toBeGreaterThan(10);
    expect(MCP_MANIFEST.description_for_model.trim().length).toBeGreaterThan(20);
    expect(MCP_MANIFEST.description_for_human).not.toBe(MCP_MANIFEST.description_for_model);
  });

  it('locks every tool property type to string when present', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const [key, prop] of Object.entries(tool.input_schema.properties)) {
        expect(prop, `${tool.name}.${key}`).toMatchObject({ type: 'string' });
      }
    }
  });

  it('keeps required arrays free of unknown property keys', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const props = Object.keys(tool.input_schema.properties);
      for (const key of tool.input_schema.required ?? []) {
        expect(props).toContain(key);
      }
    }
  });

  it('documents now_playing fields in the tool description', () => {
    const tool = toolNamed('now_playing');
    expect(tool.description.toLowerCase()).toMatch(/name/);
    expect(tool.description.toLowerCase()).toMatch(/genre/);
    expect(tool.description.toLowerCase()).toMatch(/country/);
  });

  it('keeps auth open and api openapi url rooted at /openapi.json', () => {
    expect(MCP_MANIFEST.auth.type).toBe('none');
    expect(MCP_MANIFEST.api.type).toBe('openapi');
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
    expect(MCP_MANIFEST.api.url.startsWith('/')).toBe(true);
  });

  it('orders tools with station_select first and curator_prompt last', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(names[0]).toBe('station_select');
    expect(names[names.length - 1]).toBe('curator_prompt');
  });

  it('keeps model/human names non-empty and distinct', () => {
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(MCP_MANIFEST.name_for_human).toContain('Backlink');
    expect(MCP_MANIFEST.name_for_model).not.toBe(MCP_MANIFEST.name_for_human);
  });

  it('locks top-level manifest keys to the known claw-mcp set', () => {
    expect(Object.keys(MCP_MANIFEST).sort()).toEqual(
      [
        'api',
        'auth',
        'description_for_human',
        'description_for_model',
        'name_for_human',
        'name_for_model',
        'schema_version',
        'tools',
      ].sort(),
    );
  });

  it('gives station_select exactly one property', () => {
    const tool = toolNamed('station_select');
    expect(Object.keys(tool.input_schema.properties)).toEqual(['station_name']);
  });

  it('gives genre_filter exactly one property', () => {
    const tool = toolNamed('genre_filter');
    expect(Object.keys(tool.input_schema.properties)).toEqual(['genre']);
  });

  it('gives curator_prompt exactly mood + genre properties', () => {
    const tool = toolNamed('curator_prompt');
    expect(Object.keys(tool.input_schema.properties).sort()).toEqual(['genre', 'mood']);
  });

  it('gives now_playing zero properties', () => {
    const tool = toolNamed('now_playing');
    expect(Object.keys(tool.input_schema.properties)).toEqual([]);
    expect(tool.input_schema.required).toBeUndefined();
  });

  it('mentions IPTV radio service in the model description', () => {
    expect(MCP_MANIFEST.description_for_model).toMatch(/station/i);
    expect(MCP_MANIFEST.description_for_model).toMatch(/genre/i);
    expect(MCP_MANIFEST.description_for_model).toMatch(/curator|mood/i);
  });

  it('keeps schema_version as a simple vN token', () => {
    expect(MCP_MANIFEST.schema_version).toMatch(/^v\d+$/);
  });

  it('keeps every tool name in snake_case', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it('keeps property descriptions unique within each tool', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const descs = Object.values(tool.input_schema.properties)
        .map((p) => p?.description)
        .filter(Boolean);
      expect(new Set(descs).size).toBe(descs.length);
    }
  });

  it('locks station_select / genre_filter / curator_prompt required arrays length', () => {
    expect(toolNamed('station_select').input_schema.required).toHaveLength(1);
    expect(toolNamed('genre_filter').input_schema.required).toHaveLength(1);
    expect(toolNamed('curator_prompt').input_schema.required).toHaveLength(1);
  });

  it('mentions radio or station in every tool description', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.toLowerCase()).toMatch(/station|genre|playing|curator|mood/);
    }
  });

  it('keeps openapi api.url as a root-relative path (not absolute http)', () => {
    expect(MCP_MANIFEST.api.url.startsWith('http')).toBe(false);
    expect(MCP_MANIFEST.api.url.startsWith('/')).toBe(true);
  });

  it('does not declare auth tokens or api keys in the manifest', () => {
    expect(JSON.stringify(MCP_MANIFEST)).not.toMatch(/api[_-]?key|bearer|oauth/i);
  });

  it('locks genre_filter property description to genre keyword wording', () => {
    const tool = toolNamed('genre_filter');
    expect(tool.input_schema.properties.genre?.description).toMatch(/Genre keyword to filter by/i);
  });

  it('keeps tools array reference stable across repeated reads', () => {
    expect(MCP_MANIFEST.tools).toBe(MCP_MANIFEST.tools);
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('locks curator_prompt mood description examples', () => {
    const mood = toolNamed('curator_prompt').input_schema.properties.mood?.description ?? '';
    expect(mood).toMatch(/focus work/i);
    expect(mood).toMatch(/late night jazz/i);
    expect(mood).toMatch(/morning energy/i);
  });

  it('keeps station_select description about setting the playing station', () => {
    expect(toolNamed('station_select').description).toMatch(/currently playing station/i);
  });

  it('keeps genre_filter description about returning a filtered list', () => {
    expect(toolNamed('genre_filter').description).toMatch(/list of stations filtered by genre/i);
  });

  it('does not mark any tool property as required when the property is absent', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const key of tool.input_schema.required ?? []) {
        expect(tool.input_schema.properties).toHaveProperty(key);
      }
    }
  });

  it('keeps human description mentioning iptv-org catalog', () => {
    expect(MCP_MANIFEST.description_for_human).toMatch(/iptv-org/i);
  });

  it('locks auth.type exactly to none', () => {
    expect(MCP_MANIFEST.auth).toEqual({ type: 'none' });
  });

  it('locks api.type exactly to openapi', () => {
    expect(MCP_MANIFEST.api).toEqual({ type: 'openapi', url: '/openapi.json' });
  });

  it('keeps every tool input_schema free of additionalProperties keys', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema).not.toHaveProperty('additionalProperties');
    }
  });

  it('orders required arrays to match declaration order for single-required tools', () => {
    expect(toolNamed('station_select').input_schema.required).toEqual(['station_name']);
    expect(toolNamed('genre_filter').input_schema.required).toEqual(['genre']);
    expect(toolNamed('curator_prompt').input_schema.required).toEqual(['mood']);
  });

  it('keeps schema_version at v1', () => {
    expect(MCP_MANIFEST.schema_version).toBe('v1');
  });

  it('does not nest tools inside tools (flat tool list only)', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('tools');
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('input_schema');
    }
  });

  it('keeps curator_prompt genre description about optional constraint', () => {
    expect(toolNamed('curator_prompt').input_schema.properties.genre?.description).toMatch(
      /Optional genre to constrain/i,
    );
  });

  it('survives JSON round-trip without dropping tools', () => {
    const cloned = JSON.parse(JSON.stringify(MCP_MANIFEST)) as typeof MCP_MANIFEST;
    expect(cloned).toEqual(MCP_MANIFEST);
    expect(cloned.tools).toHaveLength(MCP_MANIFEST.tools.length);
  });

  it('survives structuredClone without mutating the original', () => {
    const cloned = structuredClone(MCP_MANIFEST);
    cloned.name_for_human = 'mutated';
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
    expect(cloned.tools[0].name).toBe(MCP_MANIFEST.tools[0].name);
  });

  it('declares openapi url /openapi.json even though the Worker has no such route', () => {
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
  });

  it('keeps tool names unique and snake_case', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it('keeps every property description as a non-empty string', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties ?? {})) {
        expect(typeof prop.description).toBe('string');
        expect(prop.description!.length).toBeGreaterThan(0);
      }
    }
  });

  it('does not declare authentication headers or bearer tokens', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toMatch(/bearer|authorization|api[_-]?key|secret/i);
  });

  it('locks tool order to station_select → now_playing → genre_filter → curator_prompt', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('keeps now_playing input_schema properties empty', () => {
    expect(toolNamed('now_playing').input_schema.properties).toEqual({});
    expect(toolNamed('now_playing').input_schema.required).toBeUndefined();
  });

  it('keeps name_for_model as backlink lowercase', () => {
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(MCP_MANIFEST.name_for_human).toMatch(/Backlink/);
  });

  it('mentions AI curator in the model description', () => {
    expect(MCP_MANIFEST.description_for_model).toMatch(/AI[- ]curat/i);
    expect(MCP_MANIFEST.description_for_model).toMatch(/mood/i);
  });

  it('keeps each tool description free of absolute URLs', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description).not.toMatch(/https?:\/\//i);
    }
  });

  it('keeps input_schema.type exactly object for every tool', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('does not declare enum constraints on any tool property', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties ?? {})) {
        expect(prop).not.toHaveProperty('enum');
        expect(prop).not.toHaveProperty('const');
      }
    }
  });

  it('keeps station_select required array containing only station_name', () => {
    expect(toolNamed('station_select').input_schema.required).toEqual(['station_name']);
  });

  it('mentions filter or genre keyword examples in genre_filter description', () => {
    const d = toolNamed('genre_filter').description.toLowerCase();
    expect(d).toMatch(/jazz/);
    expect(d).toMatch(/news/);
    expect(d).toMatch(/classical/);
  });

  it('keeps curator_prompt as the only tool with two properties', () => {
    const counts = MCP_MANIFEST.tools.map((t) => Object.keys(t.input_schema.properties).length);
    expect(counts.filter((n) => n === 2)).toHaveLength(1);
    expect(Object.keys(toolNamed('curator_prompt').input_schema.properties)).toHaveLength(2);
  });

  it('keeps name_for_human exactly Backlink Radio', () => {
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
  });

  it('does not declare $schema or servers on the manifest', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('$schema');
    expect(MCP_MANIFEST).not.toHaveProperty('servers');
    expect(MCP_MANIFEST).not.toHaveProperty('prompts');
  });

  it('keeps every tool name free of backlink_ prefix (docs use that prefix)', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name.startsWith('backlink_')).toBe(false);
    }
  });

  it('serializes auth as a single-key object', () => {
    expect(Object.keys(MCP_MANIFEST.auth)).toEqual(['type']);
  });

  it('serializes api as type + url only', () => {
    expect(Object.keys(MCP_MANIFEST.api).sort()).toEqual(['type', 'url']);
  });

  it('keeps tool descriptions free of markdown code fences', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description).not.toContain('```');
    }
  });
  it('requires every required field to exist in properties', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const req of tool.input_schema.required ?? []) {
        expect(tool.input_schema.properties).toHaveProperty(req);
      }
    }
  });

  it('does not declare output_schema, annotations, or examples on tools', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('output_schema');
      expect(tool).not.toHaveProperty('annotations');
      expect(tool).not.toHaveProperty('examples');
    }
  });

  it('freezes tool name set length at four with stable sorted copy', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(names).toHaveLength(4);
    expect([...names].sort()).toEqual([
      'curator_prompt',
      'genre_filter',
      'now_playing',
      'station_select',
    ]);
  });

  it('keeps input_schema.properties as a plain object not an array', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Array.isArray(tool.input_schema.properties)).toBe(false);
      expect(typeof tool.input_schema.properties).toBe('object');
    }
  });

  it('exports a mutable (unfrozen) MCP_MANIFEST object', () => {
    expect(Object.isFrozen(MCP_MANIFEST)).toBe(false);
    expect(Object.isFrozen(MCP_MANIFEST.tools)).toBe(false);
  });

  it('does not reference Worker /curate or /stations paths in tool descriptions', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description).not.toMatch(/\/curate|\/stations|\/genres|\/health/);
    }
  });

  it('keeps api.url exactly /openapi.json with leading slash and no query', () => {
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
    expect(MCP_MANIFEST.api.url.startsWith('/')).toBe(true);
    expect(MCP_MANIFEST.api.url).not.toContain('?');
  });

  it('mentions IPTV radio service in description_for_model', () => {
    expect(MCP_MANIFEST.description_for_model).toMatch(/IPTV radio/i);
    expect(MCP_MANIFEST.description_for_human).toMatch(/iptv-org/i);
  });

  it('keeps auth.type exactly none', () => {
    expect(MCP_MANIFEST.auth.type).toBe('none');
  });

  it('keeps schema_version exactly v1', () => {
    expect(MCP_MANIFEST.schema_version).toBe('v1');
  });

  it('locks exact description_for_model and description_for_human strings', () => {
    expect(MCP_MANIFEST.description_for_model).toBe(
      'Interact with Backlink, an AI-curated IPTV radio service. Select stations, filter by genre, get now-playing info, and ask the AI curator to pick the best station for a mood.',
    );
    expect(MCP_MANIFEST.description_for_human).toBe(
      'AI-curated live radio from the iptv-org catalog.',
    );
  });

  it('locks exact tool description strings', () => {
    expect(toolNamed('station_select').description).toBe(
      'Set the currently playing station by name.',
    );
    expect(toolNamed('now_playing').description).toBe(
      'Get the currently playing station including name, genre, stream URL, and country.',
    );
    expect(toolNamed('genre_filter').description).toBe(
      'Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).',
    );
    expect(toolNamed('curator_prompt').description).toBe(
      'Ask the AI curator to pick and set the best station for a given mood or context.',
    );
  });

  it('locks exact property description strings', () => {
    expect(toolNamed('station_select').input_schema.properties.station_name!.description).toBe(
      'Partial or full name of the station to select.',
    );
    expect(toolNamed('genre_filter').input_schema.properties.genre!.description).toBe(
      'Genre keyword to filter by.',
    );
    expect(toolNamed('curator_prompt').input_schema.properties.mood!.description).toBe(
      'Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).',
    );
    expect(toolNamed('curator_prompt').input_schema.properties.genre!.description).toBe(
      'Optional genre to constrain the selection.',
    );
  });

  it('allows only type/properties/required keys on each input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const keys = Object.keys(tool.input_schema).sort();
      expect(keys.every((k) => ['type', 'properties', 'required'].includes(k))).toBe(true);
      expect(keys).toContain('type');
      expect(keys).toContain('properties');
      expect(tool.input_schema).not.toHaveProperty('$id');
      expect(tool.input_schema).not.toHaveProperty('title');
      expect(tool.input_schema).not.toHaveProperty('examples');
      expect(tool.input_schema).not.toHaveProperty('additionalProperties');
    }
  });

  it('omits required on now_playing (undefined, not empty array)', () => {
    expect(toolNamed('now_playing').input_schema.required).toBeUndefined();
    expect(toolNamed('now_playing').input_schema).not.toHaveProperty('required');
  });

  it('round-trips a deep mutate-then-restore on name_for_model', () => {
    const original = MCP_MANIFEST.name_for_model;
    (MCP_MANIFEST as { name_for_model: string }).name_for_model = 'mutated';
    expect(MCP_MANIFEST.name_for_model).toBe('mutated');
    (MCP_MANIFEST as { name_for_model: string }).name_for_model = original;
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
  });

  it('keeps every property type exactly string', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop.type).toBe('string');
      }
    }
  });

  it('keeps top-level manifest key set stable', () => {
    expect(Object.keys(MCP_MANIFEST).sort()).toEqual([
      'api',
      'auth',
      'description_for_human',
      'description_for_model',
      'name_for_human',
      'name_for_model',
      'schema_version',
      'tools',
    ]);
  });

  it('keeps each tool top-level keys exactly name/description/input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
    }
  });

  it('requires mood only on curator_prompt and genre only on genre_filter', () => {
    expect(toolNamed('curator_prompt').input_schema.required).toEqual(['mood']);
    expect(toolNamed('genre_filter').input_schema.required).toEqual(['genre']);
    expect(toolNamed('station_select').input_schema.required).toEqual(['station_name']);
  });

  it('keeps description_for_model longer than description_for_human', () => {
    expect(MCP_MANIFEST.description_for_model.length).toBeGreaterThan(
      MCP_MANIFEST.description_for_human.length,
    );
  });

  it('does not use snake_case spaces in tool names', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.name).not.toMatch(/\s/);
    }
  });

  it('keeps api.type exactly openapi', () => {
    expect(MCP_MANIFEST.api.type).toBe('openapi');
  });

  it('keeps curator_prompt property key insertion order mood then genre', () => {
    expect(Object.keys(toolNamed('curator_prompt').input_schema.properties)).toEqual([
      'mood',
      'genre',
    ]);
  });

  it('does not declare $id, $schema, or jsonSchema on tools', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('$id');
      expect(tool).not.toHaveProperty('$schema');
      expect(tool).not.toHaveProperty('jsonSchema');
      expect(tool.input_schema).not.toHaveProperty('$schema');
    }
  });

  it('keeps tools array as the live MCP_MANIFEST.tools reference', () => {
    expect(MCP_MANIFEST.tools).toBe(MCP_MANIFEST.tools);
    const first = MCP_MANIFEST.tools[0];
    expect(toolNamed('station_select')).toBe(first);
  });

  it('serializes to JSON without undefined holes in tool objects', () => {
    const roundTrip = JSON.parse(JSON.stringify(MCP_MANIFEST)) as typeof MCP_MANIFEST;
    expect(JSON.stringify(roundTrip)).not.toMatch(/undefined/);
    for (const tool of roundTrip.tools) {
      expect(Object.values(tool).every((v) => v !== undefined)).toBe(true);
    }
  });

  it('keeps station_select.required exactly ["station_name"] length 1', () => {
    const required = toolNamed('station_select').input_schema.required;
    expect(required).toEqual(['station_name']);
    expect(required).toHaveLength(1);
  });

  it('keeps schema_version exactly v1 string', () => {
    expect(MCP_MANIFEST.schema_version).toBe('v1');
    expect(typeof MCP_MANIFEST.schema_version).toBe('string');
  });

  it('keeps auth object keys exactly type=none', () => {
    expect(Object.keys(MCP_MANIFEST.auth).sort()).toEqual(['type']);
    expect(MCP_MANIFEST.auth.type).toBe('none');
  });

  it('keeps api object keys exactly type and url', () => {
    expect(Object.keys(MCP_MANIFEST.api).sort()).toEqual(['type', 'url']);
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
  });

  it('does not declare output_schema or annotations on any tool', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('output_schema');
      expect(tool).not.toHaveProperty('annotations');
      expect(tool).not.toHaveProperty('examples');
    }
  });

  it('locks exact name_for_model and name_for_human strings with length ceilings', () => {
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
    expect(MCP_MANIFEST.name_for_model.length).toBeLessThanOrEqual(32);
    expect(MCP_MANIFEST.name_for_human.length).toBeLessThanOrEqual(64);
  });

  it('deep-freezes a full manifest JSON snapshot for drift detection', () => {
    expect(JSON.parse(JSON.stringify(MCP_MANIFEST))).toEqual({
      schema_version: 'v1',
      name_for_model: 'backlink',
      name_for_human: 'Backlink Radio',
      description_for_model:
        'Interact with Backlink, an AI-curated IPTV radio service. Select stations, filter by genre, get now-playing info, and ask the AI curator to pick the best station for a mood.',
      description_for_human: 'AI-curated live radio from the iptv-org catalog.',
      auth: { type: 'none' },
      api: { type: 'openapi', url: '/openapi.json' },
      tools: [
        {
          name: 'station_select',
          description: 'Set the currently playing station by name.',
          input_schema: {
            type: 'object',
            properties: {
              station_name: {
                type: 'string',
                description: 'Partial or full name of the station to select.',
              },
            },
            required: ['station_name'],
          },
        },
        {
          name: 'now_playing',
          description:
            'Get the currently playing station including name, genre, stream URL, and country.',
          input_schema: { type: 'object', properties: {} },
        },
        {
          name: 'genre_filter',
          description:
            'Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).',
          input_schema: {
            type: 'object',
            properties: {
              genre: {
                type: 'string',
                description: 'Genre keyword to filter by.',
              },
            },
            required: ['genre'],
          },
        },
        {
          name: 'curator_prompt',
          description:
            'Ask the AI curator to pick and set the best station for a given mood or context.',
          input_schema: {
            type: 'object',
            properties: {
              mood: {
                type: 'string',
                description:
                  'Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).',
              },
              genre: {
                type: 'string',
                description: 'Optional genre to constrain the selection.',
              },
            },
            required: ['mood'],
          },
        },
      ],
    });
  });

  it('keeps station_select.properties key order exactly station_name', () => {
    expect(Object.keys(toolNamed('station_select').input_schema.properties)).toEqual([
      'station_name',
    ]);
  });

  it('keeps genre_filter description examples jazz, news, classical', () => {
    expect(toolNamed('genre_filter').description).toContain('jazz, news, classical');
  });

  it('keeps curator_prompt mood examples focus work / late night jazz / morning energy', () => {
    const mood = toolNamed('curator_prompt').input_schema.properties.mood;
    expect(mood).toBeDefined();
    const desc = mood!.description as string;
    expect(desc).toContain('focus work');
    expect(desc).toContain('late night jazz');
    expect(desc).toContain('morning energy');
  });

  it('does not declare logo_url / contact_email / legal_info_url on manifest', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('logo_url');
    expect(MCP_MANIFEST).not.toHaveProperty('contact_email');
    expect(MCP_MANIFEST).not.toHaveProperty('legal_info_url');
  });

  it('keeps auth and api as plain objects (not arrays)', () => {
    expect(Array.isArray(MCP_MANIFEST.auth)).toBe(false);
    expect(Array.isArray(MCP_MANIFEST.api)).toBe(false);
    expect(typeof MCP_MANIFEST.auth).toBe('object');
    expect(typeof MCP_MANIFEST.api).toBe('object');
  });

  it('tool descriptions do not mention Gemini, KV, or Workers', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description).not.toMatch(/Gemini|KV|Workers/i);
    }
  });

  it('keeps now_playing field mention order name→genre→stream URL→country', () => {
    const d = toolNamed('now_playing').description;
    const nameIdx = d.indexOf('name');
    const genreIdx = d.indexOf('genre');
    const streamIdx = d.indexOf('stream URL');
    const countryIdx = d.indexOf('country');
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(genreIdx).toBeGreaterThan(nameIdx);
    expect(streamIdx).toBeGreaterThan(genreIdx);
    expect(countryIdx).toBeGreaterThan(streamIdx);
  });

  it('keeps every input_schema property key set to type and description only', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(Object.keys(prop).sort()).toEqual(['description', 'type']);
      }
    }
  });

  it('does not declare strict, outputSchema, or $defs on tools or schemas', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('strict');
      expect(tool).not.toHaveProperty('outputSchema');
      expect(tool.input_schema).not.toHaveProperty('$defs');
      expect(tool.input_schema).not.toHaveProperty('strict');
      expect(tool.input_schema).not.toHaveProperty('outputSchema');
    }
  });

  it('locks schema_version + auth + api as one exact snapshot', () => {
    expect({
      schema_version: MCP_MANIFEST.schema_version,
      auth: MCP_MANIFEST.auth,
      api: MCP_MANIFEST.api,
    }).toEqual({
      schema_version: 'v1',
      auth: { type: 'none' },
      api: { type: 'openapi', url: '/openapi.json' },
    });
  });

  it('serializes now_playing input_schema without a required key', () => {
    const tool = toolNamed('now_playing');
    expect(JSON.stringify(tool.input_schema)).not.toMatch(/"required"/);
    expect(tool.input_schema).not.toHaveProperty('required');
  });

  it('locks tool order station_select → now_playing → genre_filter → curator_prompt', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('keeps every tool input_schema.type exactly object', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('locks curator_prompt required to mood only (genre optional)', () => {
    const tool = toolNamed('curator_prompt');
    expect(tool.input_schema.required).toEqual(['mood']);
    expect(tool.input_schema.properties).toHaveProperty('genre');
    expect(tool.input_schema.properties).toHaveProperty('mood');
  });

  it('locks station_select property key set to station_name only', () => {
    const tool = toolNamed('station_select');
    expect(Object.keys(tool.input_schema.properties)).toEqual(['station_name']);
  });

  it('locks genre_filter property key set to genre only', () => {
    const tool = toolNamed('genre_filter');
    expect(Object.keys(tool.input_schema.properties)).toEqual(['genre']);
  });

  it('keeps now_playing properties as an empty object', () => {
    const tool = toolNamed('now_playing');
    expect(tool.input_schema.properties).toEqual({});
  });

  it('JSON round-trips the full manifest without key loss', () => {
    expect(JSON.parse(JSON.stringify(MCP_MANIFEST))).toEqual(MCP_MANIFEST);
  });

  it('description_for_model mentions mood and curator capabilities', () => {
    expect(MCP_MANIFEST.description_for_model).toMatch(/mood/i);
    expect(MCP_MANIFEST.description_for_model).toMatch(/curator/i);
    expect(MCP_MANIFEST.description_for_model).toMatch(/genre/i);
  });

  it('does not nest tools inside api or auth objects', () => {
    expect(MCP_MANIFEST.api).not.toHaveProperty('tools');
    expect(MCP_MANIFEST.auth).not.toHaveProperty('tools');
  });

  it('keeps every tool name free of digits and hyphens', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.name).not.toMatch(/[0-9-]/);
    }
  });

  it('keeps required arrays as live arrays (mutable, not frozen)', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const required = tool.input_schema.required;
      if (required === undefined) continue;
      expect(Array.isArray(required)).toBe(true);
      expect(Object.isFrozen(required)).toBe(false);
    }
  });

  it('does not declare minLength, maxLength, pattern, or format on properties', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop).not.toHaveProperty('minLength');
        expect(prop).not.toHaveProperty('maxLength');
        expect(prop).not.toHaveProperty('pattern');
        expect(prop).not.toHaveProperty('format');
        expect(prop).not.toHaveProperty('default');
        expect(prop).not.toHaveProperty('nullable');
      }
    }
  });

  it('keeps tools as a dense Array.isArray with no holes', () => {
    expect(Array.isArray(MCP_MANIFEST.tools)).toBe(true);
    expect(MCP_MANIFEST.tools.length).toBe(4);
    expect(Object.keys(MCP_MANIFEST.tools)).toEqual(['0', '1', '2', '3']);
  });

  it('locks exact character lengths for top-level naming strings', () => {
    expect(MCP_MANIFEST.name_for_model.length).toBe(8);
    expect(MCP_MANIFEST.name_for_human.length).toBe(14);
    expect(MCP_MANIFEST.schema_version.length).toBe(2);
  });

  it('locks description_for_human exact length and trailing period', () => {
    expect(MCP_MANIFEST.description_for_human.endsWith('.')).toBe(true);
    expect(MCP_MANIFEST.description_for_human.length).toBe(48);
  });

  it('locks description_for_model exact length and trailing period', () => {
    expect(MCP_MANIFEST.description_for_model.endsWith('.')).toBe(true);
    expect(MCP_MANIFEST.description_for_model.length).toBe(173);
  });

  it('keeps every tool description ending with a period', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.endsWith('.')).toBe(true);
    }
  });

  it('keeps every property description ending with a period', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop.description!.endsWith('.')).toBe(true);
      }
    }
  });

  it('does not declare oneOf, anyOf, allOf, or not on schemas', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema).not.toHaveProperty('oneOf');
      expect(tool.input_schema).not.toHaveProperty('anyOf');
      expect(tool.input_schema).not.toHaveProperty('allOf');
      expect(tool.input_schema).not.toHaveProperty('not');
    }
  });

  it('indexes tools by stable position for claw-mcp consumers', () => {
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
    expect(MCP_MANIFEST.tools[1].name).toBe('now_playing');
    expect(MCP_MANIFEST.tools[2].name).toBe('genre_filter');
    expect(MCP_MANIFEST.tools[3].name).toBe('curator_prompt');
  });

  it('keeps station_name property free of title/examples/deprecated', () => {
    const prop = toolNamed('station_select').input_schema.properties.station_name!;
    expect(prop).not.toHaveProperty('title');
    expect(prop).not.toHaveProperty('examples');
    expect(prop).not.toHaveProperty('deprecated');
    expect(prop).not.toHaveProperty('readOnly');
  });

  it('JSON key order for tools preserves declaration order', () => {
    const raw = JSON.stringify(MCP_MANIFEST.tools);
    const select = raw.indexOf('"station_select"');
    const now = raw.indexOf('"now_playing"');
    const genre = raw.indexOf('"genre_filter"');
    const curator = raw.indexOf('"curator_prompt"');
    expect(select).toBeGreaterThan(-1);
    expect(now).toBeGreaterThan(select);
    expect(genre).toBeGreaterThan(now);
    expect(curator).toBeGreaterThan(genre);
  });

  it('does not declare mcp_version, openapi_version, or contact fields', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('mcp_version');
    expect(MCP_MANIFEST).not.toHaveProperty('openapi_version');
    expect(MCP_MANIFEST).not.toHaveProperty('contact');
    expect(MCP_MANIFEST).not.toHaveProperty('license');
  });

  it('keeps auth.type and api.type as lowercase tokens', () => {
    expect(MCP_MANIFEST.auth.type).toBe(MCP_MANIFEST.auth.type.toLowerCase());
    expect(MCP_MANIFEST.api.type).toBe(MCP_MANIFEST.api.type.toLowerCase());
  });

  it('keeps openapi url free of fragment and trailing slash', () => {
    expect(MCP_MANIFEST.api.url).not.toContain('#');
    expect(MCP_MANIFEST.api.url.endsWith('/')).toBe(false);
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
  });

  it('mentions Select / filter / now-playing / curator capability verbs in model description', () => {
    const d = MCP_MANIFEST.description_for_model;
    expect(d).toMatch(/Select stations/i);
    expect(d).toMatch(/filter by genre/i);
    expect(d).toMatch(/now-playing/i);
    expect(d).toMatch(/AI curator/i);
  });

  it('keeps human description free of tool names and endpoint paths', () => {
    const d = MCP_MANIFEST.description_for_human;
    expect(d).not.toMatch(/station_select|now_playing|genre_filter|curator_prompt/);
    expect(d).not.toMatch(/\/curate|\/stations|\/genres/);
  });

  it('locks exact tool description character lengths', () => {
    expect(toolNamed('station_select').description.length).toBe(42);
    expect(toolNamed('now_playing').description.length).toBe(81);
    expect(toolNamed('genre_filter').description.length).toBe(81);
    expect(toolNamed('curator_prompt').description.length).toBe(80);
  });

  it('locks exact property description character lengths', () => {
    expect(toolNamed('station_select').input_schema.properties.station_name!.description!.length).toBe(46);
    expect(toolNamed('genre_filter').input_schema.properties.genre!.description!.length).toBe(27);
    expect(toolNamed('curator_prompt').input_schema.properties.mood!.description!.length).toBe(88);
    expect(toolNamed('curator_prompt').input_schema.properties.genre!.description!.length).toBe(42);
  });

  it('does not declare deprecated or experimental flags on tools', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('deprecated');
      expect(tool).not.toHaveProperty('experimental');
      expect(tool).not.toHaveProperty('hidden');
    }
  });

  it('keeps required arrays without duplicates', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const required = tool.input_schema.required ?? [];
      expect(new Set(required).size).toBe(required.length);
    }
  });

  it('structuredClone tools independently from the live tools array', () => {
    const clone = structuredClone(MCP_MANIFEST.tools);
    clone[0].name = 'mutated_tool';
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
    expect(clone).not.toBe(MCP_MANIFEST.tools);
  });

  it('keeps Object.getOwnPropertyNames(MCP_MANIFEST) equal to Object.keys', () => {
    expect(Object.getOwnPropertyNames(MCP_MANIFEST).sort()).toEqual(Object.keys(MCP_MANIFEST).sort());
  });

  it('does not define prototype methods on the tools array beyond Array', () => {
    expect(Object.getPrototypeOf(MCP_MANIFEST.tools)).toBe(Array.prototype);
  });

  it('keeps genre_filter examples parenthetical jazz, news, classical with commas', () => {
    expect(toolNamed('genre_filter').description).toContain('(e.g. jazz, news, classical)');
  });

  it('keeps curator_prompt mood examples parenthetical with commas', () => {
    expect(toolNamed('curator_prompt').input_schema.properties.mood!.description).toContain(
      '(e.g. focus work, late night jazz, morning energy)',
    );
  });

  it('does not declare content-type or accept headers in the manifest JSON', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw.toLowerCase()).not.toMatch(/content-type|application\/json/);
  });

  it('keeps every tool name length between 8 and 20 inclusive', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name.length).toBeGreaterThanOrEqual(8);
      expect(tool.name.length).toBeLessThanOrEqual(20);
    }
  });

  it('locks snake_case segment counts per tool name', () => {
    expect(toolNamed('station_select').name.split('_')).toHaveLength(2);
    expect(toolNamed('now_playing').name.split('_')).toHaveLength(2);
    expect(toolNamed('genre_filter').name.split('_')).toHaveLength(2);
    expect(toolNamed('curator_prompt').name.split('_')).toHaveLength(2);
  });

  it('does not export MCP_MANIFEST as a class instance', () => {
    expect(MCP_MANIFEST.constructor).toBe(Object);
    expect(Object.prototype.toString.call(MCP_MANIFEST)).toBe('[object Object]');
  });

  it('keeps now_playing as the only tool without required and without properties', () => {
    const empty = MCP_MANIFEST.tools.filter(
      (t) => Object.keys(t.input_schema.properties).length === 0 && t.input_schema.required === undefined,
    );
    expect(empty).toHaveLength(1);
    expect(empty[0].name).toBe('now_playing');
  });

  it('keeps property keys free of camelCase and kebab-case', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const key of Object.keys(tool.input_schema.properties)) {
        expect(key).toMatch(/^[a-z]+(_[a-z]+)*$/);
        expect(key).not.toMatch(/[A-Z-]/);
      }
    }
  });

  it('deep-equals each tool against an inline fixture object', () => {
    expect(toolNamed('station_select')).toEqual({
      name: 'station_select',
      description: 'Set the currently playing station by name.',
      input_schema: {
        type: 'object',
        properties: {
          station_name: {
            type: 'string',
            description: 'Partial or full name of the station to select.',
          },
        },
        required: ['station_name'],
      },
    });
    expect(toolNamed('now_playing')).toEqual({
      name: 'now_playing',
      description:
        'Get the currently playing station including name, genre, stream URL, and country.',
      input_schema: { type: 'object', properties: {} },
    });
  });

  it('deep-equals genre_filter and curator_prompt against inline fixtures', () => {
    expect(toolNamed('genre_filter')).toEqual({
      name: 'genre_filter',
      description:
        'Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).',
      input_schema: {
        type: 'object',
        properties: {
          genre: {
            type: 'string',
            description: 'Genre keyword to filter by.',
          },
        },
        required: ['genre'],
      },
    });
    expect(toolNamed('curator_prompt')).toEqual({
      name: 'curator_prompt',
      description:
        'Ask the AI curator to pick and set the best station for a given mood or context.',
      input_schema: {
        type: 'object',
        properties: {
          mood: {
            type: 'string',
            description:
              'Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).',
          },
          genre: {
            type: 'string',
            description: 'Optional genre to constrain the selection.',
          },
        },
        required: ['mood'],
      },
    });
  });

  it('does not declare resources, prompts, or sampling capability blocks', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('resources');
    expect(MCP_MANIFEST).not.toHaveProperty('prompts');
    expect(MCP_MANIFEST).not.toHaveProperty('sampling');
    expect(MCP_MANIFEST).not.toHaveProperty('capabilities');
  });

  it('keeps description strings free of curly quotes and em dashes', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toMatch(/[\u2018\u2019\u201C\u201D\u2013\u2014]/);
  });

  it('Object.assign shallow copy shares nested tools reference', () => {
    const copy = Object.assign({}, MCP_MANIFEST);
    expect(copy.tools).toBe(MCP_MANIFEST.tools);
    expect(copy).not.toBe(MCP_MANIFEST);
  });

  it('keeps api.url path extension exactly .json', () => {
    expect(MCP_MANIFEST.api.url.endsWith('.json')).toBe(true);
    expect(MCP_MANIFEST.api.url.split('/').pop()).toBe('openapi.json');
  });

  it('enumerates tools with for...of in declaration order', () => {
    const names: string[] = [];
    for (const tool of MCP_MANIFEST.tools) names.push(tool.name);
    expect(names).toEqual(['station_select', 'now_playing', 'genre_filter', 'curator_prompt']);
  });

  it('keeps schema_version free of semver dots and prefixes beyond v', () => {
    expect(MCP_MANIFEST.schema_version).not.toContain('.');
    expect(MCP_MANIFEST.schema_version.startsWith('v')).toBe(true);
    expect(MCP_MANIFEST.schema_version.slice(1)).toMatch(/^\d+$/);
  });

  it('does not nest input_schema inside properties (flat schema only)', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop).not.toHaveProperty('properties');
        expect(prop).not.toHaveProperty('items');
        expect(prop).not.toHaveProperty('input_schema');
      }
    }
  });

  it('locks total property count across all tools at exactly 4', () => {
    const total = MCP_MANIFEST.tools.reduce(
      (n, t) => n + Object.keys(t.input_schema.properties).length,
      0,
    );
    expect(total).toBe(4);
  });

  it('locks total required field count across all tools at exactly 3', () => {
    const total = MCP_MANIFEST.tools.reduce(
      (n, t) => n + (t.input_schema.required?.length ?? 0),
      0,
    );
    expect(total).toBe(3);
  });

  it('keeps name_for_model ASCII lowercase and name_for_human title case', () => {
    expect(MCP_MANIFEST.name_for_model).toMatch(/^[a-z]+$/);
    expect(MCP_MANIFEST.name_for_human).toMatch(/^Backlink Radio$/);
  });

  it('does not declare x- extensions on the manifest or tools', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toMatch(/"x-/);
  });

  it('locks exact MCP_MANIFEST top-level string/object snapshot (sans tools)', () => {
    expect({
      schema_version: MCP_MANIFEST.schema_version,
      name_for_model: MCP_MANIFEST.name_for_model,
      name_for_human: MCP_MANIFEST.name_for_human,
      description_for_model: MCP_MANIFEST.description_for_model,
      description_for_human: MCP_MANIFEST.description_for_human,
      auth: MCP_MANIFEST.auth,
      api: MCP_MANIFEST.api,
    }).toEqual({
      schema_version: 'v1',
      name_for_model: 'backlink',
      name_for_human: 'Backlink Radio',
      description_for_model:
        'Interact with Backlink, an AI-curated IPTV radio service. Select stations, filter by genre, get now-playing info, and ask the AI curator to pick the best station for a mood.',
      description_for_human: 'AI-curated live radio from the iptv-org catalog.',
      auth: { type: 'none' },
      api: { type: 'openapi', url: '/openapi.json' },
    });
  });

  it('locks exact full tools array deep equality', () => {
    expect(MCP_MANIFEST.tools).toEqual([
      {
        name: 'station_select',
        description: 'Set the currently playing station by name.',
        input_schema: {
          type: 'object',
          properties: {
            station_name: {
              type: 'string',
              description: 'Partial or full name of the station to select.',
            },
          },
          required: ['station_name'],
        },
      },
      {
        name: 'now_playing',
        description:
          'Get the currently playing station including name, genre, stream URL, and country.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'genre_filter',
        description:
          'Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).',
        input_schema: {
          type: 'object',
          properties: {
            genre: {
              type: 'string',
              description: 'Genre keyword to filter by.',
            },
          },
          required: ['genre'],
        },
      },
      {
        name: 'curator_prompt',
        description:
          'Ask the AI curator to pick and set the best station for a given mood or context.',
        input_schema: {
          type: 'object',
          properties: {
            mood: {
              type: 'string',
              description:
                'Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).',
            },
            genre: {
              type: 'string',
              description: 'Optional genre to constrain the selection.',
            },
          },
          required: ['mood'],
        },
      },
    ]);
  });

  it('locks property declaration order for curator_prompt (mood before genre)', () => {
    expect(Object.keys(toolNamed('curator_prompt').input_schema.properties)).toEqual([
      'mood',
      'genre',
    ]);
  });

  it('locks station_select property declaration order to station_name only', () => {
    expect(Object.keys(toolNamed('station_select').input_schema.properties)).toEqual([
      'station_name',
    ]);
  });

  it('keeps every tool free of output_schema / annotations / examples keys', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('output_schema');
      expect(tool).not.toHaveProperty('annotations');
      expect(tool).not.toHaveProperty('examples');
      expect(tool).not.toHaveProperty('deprecated');
    }
  });

  it('keeps every property free of minLength/maxLength/pattern/format', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop).not.toHaveProperty('minLength');
        expect(prop).not.toHaveProperty('maxLength');
        expect(prop).not.toHaveProperty('pattern');
        expect(prop).not.toHaveProperty('format');
        expect(prop).not.toHaveProperty('default');
      }
    }
  });

  it('locks description_for_model exact character length', () => {
    expect(MCP_MANIFEST.description_for_model.length).toBe(173);
  });

  it('locks description_for_human exact character length', () => {
    expect(MCP_MANIFEST.description_for_human.length).toBe(48);
  });

  it('locks every tool description exact string', () => {
    expect(toolNamed('station_select').description).toBe(
      'Set the currently playing station by name.',
    );
    expect(toolNamed('now_playing').description).toBe(
      'Get the currently playing station including name, genre, stream URL, and country.',
    );
    expect(toolNamed('genre_filter').description).toBe(
      'Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).',
    );
    expect(toolNamed('curator_prompt').description).toBe(
      'Ask the AI curator to pick and set the best station for a given mood or context.',
    );
  });

  it('JSON.stringify then parse preserves tool required arrays', () => {
    const cloned = JSON.parse(JSON.stringify(MCP_MANIFEST)) as typeof MCP_MANIFEST;
    expect(cloned.tools.map((t) => t.input_schema.required)).toEqual([
      ['station_name'],
      undefined,
      ['genre'],
      ['mood'],
    ]);
  });

  it('keeps tools array extensible (not frozen) so agents can edit src/mcp.ts', () => {
    expect(Object.isFrozen(MCP_MANIFEST)).toBe(false);
    expect(Object.isFrozen(MCP_MANIFEST.tools)).toBe(false);
    expect(Object.isSealed(MCP_MANIFEST.tools)).toBe(false);
  });

  it('does not declare mcp_server or server_url top-level keys', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('mcp_server');
    expect(MCP_MANIFEST).not.toHaveProperty('server_url');
    expect(MCP_MANIFEST).not.toHaveProperty('base_url');
    expect(MCP_MANIFEST).not.toHaveProperty('version');
  });

  it('keeps auth.type and api.type as lowercase ascii tokens', () => {
    expect(MCP_MANIFEST.auth.type).toMatch(/^[a-z]+$/);
    expect(MCP_MANIFEST.api.type).toMatch(/^[a-z]+$/);
  });

  it('mentions IPTV and curator and mood in description_for_model', () => {
    const d = MCP_MANIFEST.description_for_model;
    expect(d).toMatch(/IPTV/);
    expect(d).toMatch(/curator/);
    expect(d).toMatch(/mood/);
    expect(d).toMatch(/genre/);
    expect(d).toMatch(/station/);
  });

  it('keeps description_for_human ending with a period', () => {
    expect(MCP_MANIFEST.description_for_human.endsWith('.')).toBe(true);
    expect(MCP_MANIFEST.description_for_model.endsWith('.')).toBe(true);
  });

  it('keeps every tool description ending with a period', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.endsWith('.')).toBe(true);
    }
  });

  it('locks tool name character lengths', () => {
    expect(toolNamed('station_select').name.length).toBe(14);
    expect(toolNamed('now_playing').name.length).toBe(11);
    expect(toolNamed('genre_filter').name.length).toBe(12);
    expect(toolNamed('curator_prompt').name.length).toBe(14);
  });

  it('finds tools by name via Array.prototype.find', () => {
    for (const name of ['station_select', 'now_playing', 'genre_filter', 'curator_prompt']) {
      expect(MCP_MANIFEST.tools.find((t) => t.name === name)?.name).toBe(name);
    }
  });

  it('keeps input_schema.required undefined (not empty array) for now_playing', () => {
    expect(toolNamed('now_playing').input_schema.required).toBeUndefined();
    expect('required' in toolNamed('now_playing').input_schema).toBe(false);
  });

  it('keeps required as own property on tools that declare it', () => {
    for (const name of ['station_select', 'genre_filter', 'curator_prompt'] as const) {
      expect(Object.hasOwn(toolNamed(name).input_schema, 'required')).toBe(true);
    }
  });

  it('does not use $ref or oneOf/anyOf/allOf in any schema', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toMatch(/"\$ref"|oneOf|anyOf|allOf/);
  });

  it('locks api.url to a single path segment openapi.json', () => {
    expect(MCP_MANIFEST.api.url.split('/').filter(Boolean)).toEqual(['openapi.json']);
  });

  it('keeps schema_version lexicographically before v2 and after v0', () => {
    expect(MCP_MANIFEST.schema_version > 'v0').toBe(true);
    expect(MCP_MANIFEST.schema_version < 'v2').toBe(true);
  });

  it('Object.keys on each tool equals name/description/input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
    }
  });

  it('Object.keys on each input_schema includes type and properties', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const keys = Object.keys(tool.input_schema);
      expect(keys).toContain('type');
      expect(keys).toContain('properties');
      expect(keys.every((k) => ['type', 'properties', 'required'].includes(k))).toBe(true);
    }
  });

  it('locks description_for_human character length within stable band', () => {
    const n = MCP_MANIFEST.description_for_human.length;
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(120);
  });

  it('tools.at(0) is station_select and tools.at(-1) is curator_prompt', () => {
    expect(MCP_MANIFEST.tools.at(0)?.name).toBe('station_select');
    expect(MCP_MANIFEST.tools.at(-1)?.name).toBe('curator_prompt');
  });

  it('locks station_name / genre / mood property descriptions exact strings', () => {
    expect(toolNamed('station_select').input_schema.properties.station_name?.description).toBe(
      'Partial or full name of the station to select.',
    );
    expect(toolNamed('genre_filter').input_schema.properties.genre?.description).toBe(
      'Genre keyword to filter by.',
    );
    expect(toolNamed('curator_prompt').input_schema.properties.mood?.description).toBe(
      'Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).',
    );
    expect(toolNamed('curator_prompt').input_schema.properties.genre?.description).toBe(
      'Optional genre to constrain the selection.',
    );
  });

  it('does not mention Cloudflare, Workers, or Gemini in claw-mcp descriptions', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toMatch(/Cloudflare|Workers|Gemini|Anthropic|OpenAI/i);
  });

  it('keeps name_for_model free of spaces and name_for_human containing a space', () => {
    expect(MCP_MANIFEST.name_for_model).not.toMatch(/\s/);
    expect(MCP_MANIFEST.name_for_human).toMatch(/\s/);
  });

  it('structuredClone then mutate nested tool does not affect original', () => {
    const cloned = structuredClone(MCP_MANIFEST);
    cloned.tools[0].name = 'mutated';
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('locks genre_filter examples jazz/news/classical as substring of description', () => {
    const d = toolNamed('genre_filter').description;
    expect(d.indexOf('jazz')).toBeLessThan(d.indexOf('news'));
    expect(d.indexOf('news')).toBeLessThan(d.indexOf('classical'));
  });

  it('locks curator_prompt mood examples order focus → late night → morning', () => {
    const d = toolNamed('curator_prompt').input_schema.properties.mood?.description ?? '';
    expect(d.indexOf('focus work')).toBeLessThan(d.indexOf('late night jazz'));
    expect(d.indexOf('late night jazz')).toBeLessThan(d.indexOf('morning energy'));
  });

  it('does not declare protocolVersion or capabilities on the manifest', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('protocolVersion');
    expect(MCP_MANIFEST).not.toHaveProperty('capabilities');
    expect(MCP_MANIFEST).not.toHaveProperty('clientInfo');
  });

  it('keeps tools as a dense array with no holes', () => {
    expect(MCP_MANIFEST.tools.length).toBe(4);
    expect(MCP_MANIFEST.tools.every((t) => t != null)).toBe(true);
    expect(Object.keys(MCP_MANIFEST.tools).length).toBe(4);
  });

  it('JSON round-trip byte-stable for sorted key serialization of tools names', () => {
    const a = JSON.stringify(MCP_MANIFEST.tools.map((t) => t.name));
    const b = JSON.stringify(
      JSON.parse(JSON.stringify(MCP_MANIFEST)).tools.map((t: { name: string }) => t.name),
    );
    expect(a).toBe(b);
    expect(a).toBe('["station_select","now_playing","genre_filter","curator_prompt"]');
  });

  it('structuredClone of MCP_MANIFEST is deep-equal and reference-distinct', () => {
    const clone = structuredClone(MCP_MANIFEST);
    expect(clone).toEqual(MCP_MANIFEST);
    expect(clone).not.toBe(MCP_MANIFEST);
    expect(clone.tools).not.toBe(MCP_MANIFEST.tools);
    expect(clone.tools[0]).not.toBe(MCP_MANIFEST.tools[0]);
  });

  it('locks station_select property key order exactly station_name', () => {
    const tool = MCP_MANIFEST.tools.find((t) => t.name === 'station_select')!;
    expect(Object.keys(tool.input_schema.properties)).toEqual(['station_name']);
  });

  it('locks curator_prompt property key order mood then genre', () => {
    const tool = MCP_MANIFEST.tools.find((t) => t.name === 'curator_prompt')!;
    expect(Object.keys(tool.input_schema.properties)).toEqual(['mood', 'genre']);
  });

  it('does not declare $schema, id, or $id on the manifest', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toMatch(/"\$schema"/);
    expect(raw).not.toMatch(/"\$id"/);
    expect(MCP_MANIFEST).not.toHaveProperty('id');
  });

  it('auth.type and api.type are distinct string literals', () => {
    expect(MCP_MANIFEST.auth.type).toBe('none');
    expect(MCP_MANIFEST.api.type).toBe('openapi');
    expect(MCP_MANIFEST.auth.type).not.toBe(MCP_MANIFEST.api.type);
  });

  it('Object.getOwnPropertyDescriptors tools entries are writable configurable enumerable', () => {
    for (let i = 0; i < MCP_MANIFEST.tools.length; i++) {
      const d = Object.getOwnPropertyDescriptor(MCP_MANIFEST.tools, i)!;
      expect(d.writable).toBe(true);
      expect(d.enumerable).toBe(true);
      expect(d.configurable).toBe(true);
    }
  });

  it('locks exact tool name character lengths', () => {
    const lens = Object.fromEntries(MCP_MANIFEST.tools.map((t) => [t.name, t.name.length]));
    expect(lens).toEqual({
      station_select: 14,
      now_playing: 11,
      genre_filter: 12,
      curator_prompt: 14,
    });
  });

  it('does not declare default values on any input property', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop).not.toHaveProperty('default');
        expect(prop).not.toHaveProperty('const');
        expect(prop).not.toHaveProperty('enum');
      }
    }
  });

  it('now_playing is the only tool without a required array', () => {
    const withRequired = MCP_MANIFEST.tools.filter((t) => 'required' in t.input_schema);
    const without = MCP_MANIFEST.tools.filter((t) => !('required' in t.input_schema));
    expect(without.map((t) => t.name)).toEqual(['now_playing']);
    expect(withRequired).toHaveLength(3);
  });

  it('keeps description_for_model free of markdown and backticks', () => {
    expect(MCP_MANIFEST.description_for_model).not.toMatch(/[`*_#]/);
  });

  it('keeps name_for_human words exactly two tokens', () => {
    expect(MCP_MANIFEST.name_for_human.split(/\s+/)).toEqual(['Backlink', 'Radio']);
  });

  it('api.url is a root-relative path not an absolute URL', () => {
    expect(MCP_MANIFEST.api.url.startsWith('/')).toBe(true);
    expect(MCP_MANIFEST.api.url).not.toMatch(/^https?:/i);
  });

  it('tools array length matches Object.keys index count', () => {
    expect(MCP_MANIFEST.tools.length).toBe(Object.keys(MCP_MANIFEST.tools).length);
  });

  it('JSON.stringify does not emit undefined holes in tools', () => {
    expect(JSON.stringify(MCP_MANIFEST.tools)).not.toContain('null');
    expect(JSON.stringify(MCP_MANIFEST.tools)).not.toContain('undefined');
  });

  it('locks curator_prompt as the only tool with two properties', () => {
    const counts = MCP_MANIFEST.tools.map((t) => ({
      name: t.name,
      n: Object.keys(t.input_schema.properties).length,
    }));
    expect(counts.filter((c) => c.n === 2).map((c) => c.name)).toEqual(['curator_prompt']);
    expect(counts.filter((c) => c.n === 0).map((c) => c.name)).toEqual(['now_playing']);
    expect(counts.filter((c) => c.n === 1).map((c) => c.name).sort()).toEqual([
      'genre_filter',
      'station_select',
    ]);
  });

  it('does not declare examples arrays on tools or properties', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toContain('"examples"');
    expect(raw).not.toContain('"example"');
  });

  it('schema_version compares less than v2 lexicographically', () => {
    expect(MCP_MANIFEST.schema_version < 'v2').toBe(true);
    expect(MCP_MANIFEST.schema_version > 'v0').toBe(true);
  });

  it('Object.isExtensible is true for manifest, auth, api, and tools', () => {
    expect(Object.isExtensible(MCP_MANIFEST)).toBe(true);
    expect(Object.isExtensible(MCP_MANIFEST.auth)).toBe(true);
    expect(Object.isExtensible(MCP_MANIFEST.api)).toBe(true);
    expect(Object.isExtensible(MCP_MANIFEST.tools)).toBe(true);
  });

  it('findIndex of now_playing is 1 and genre_filter is 2', () => {
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'now_playing')).toBe(1);
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'genre_filter')).toBe(2);
  });

  it('keeps every required entry a subset of properties keys', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const req of tool.input_schema.required ?? []) {
        expect(Object.keys(tool.input_schema.properties)).toContain(req);
      }
    }
  });

  it('locks description_for_model character length within stable band', () => {
    const n = MCP_MANIFEST.description_for_model.length;
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(400);
  });

  it('every tool input_schema owns exactly type and properties keys at minimum', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const keys = Object.keys(tool.input_schema);
      expect(keys).toContain('type');
      expect(keys).toContain('properties');
      expect(keys.every((k) => ['type', 'properties', 'required'].includes(k))).toBe(true);
    }
  });

  it('locks Object.keys(MCP_MANIFEST) insertion order unsorted', () => {
    expect(Object.keys(MCP_MANIFEST)).toEqual([
      'schema_version',
      'name_for_model',
      'name_for_human',
      'description_for_model',
      'description_for_human',
      'auth',
      'api',
      'tools',
    ]);
  });

  it('locks auth JSON.stringify byte-stable snapshot', () => {
    expect(JSON.stringify(MCP_MANIFEST.auth)).toBe('{"type":"none"}');
  });

  it('locks api JSON.stringify byte-stable snapshot with key order', () => {
    expect(JSON.stringify(MCP_MANIFEST.api)).toBe('{"type":"openapi","url":"/openapi.json"}');
  });

  it('keeps each tool input_schema as a distinct object identity', () => {
    const schemas = MCP_MANIFEST.tools.map((t) => t.input_schema);
    for (let i = 0; i < schemas.length; i++) {
      for (let j = i + 1; j < schemas.length; j++) {
        expect(schemas[i]).not.toBe(schemas[j]);
      }
    }
  });

  it('keeps each tool properties object as a distinct identity', () => {
    const props = MCP_MANIFEST.tools.map((t) => t.input_schema.properties);
    for (let i = 0; i < props.length; i++) {
      for (let j = i + 1; j < props.length; j++) {
        expect(props[i]).not.toBe(props[j]);
      }
    }
  });

  it('keeps required arrays as distinct identities where declared', () => {
    const requireds = MCP_MANIFEST.tools
      .map((t) => t.input_schema.required)
      .filter((r): r is string[] => Array.isArray(r));
    expect(requireds).toHaveLength(3);
    expect(requireds[0]).not.toBe(requireds[1]);
    expect(requireds[1]).not.toBe(requireds[2]);
    expect(requireds[0]).not.toBe(requireds[2]);
  });

  it('tools.slice copy mutation does not affect live manifest tools', () => {
    const copy = MCP_MANIFEST.tools.slice();
    copy.reverse();
    copy[0] = { ...copy[0], name: 'mutated' };
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('tools.concat([]) yields independent array identity', () => {
    const copy = MCP_MANIFEST.tools.concat([]);
    expect(copy).not.toBe(MCP_MANIFEST.tools);
    expect(copy).toEqual(MCP_MANIFEST.tools);
    copy.pop();
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('property descriptions are globally unique across all tools', () => {
    const descs: string[] = [];
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        descs.push((prop as { description: string }).description);
      }
    }
    expect(new Set(descs).size).toBe(descs.length);
    expect(descs.length).toBe(4);
  });

  it('JSON.stringify(MCP_MANIFEST) contains no tab or CR characters', () => {
    const s = JSON.stringify(MCP_MANIFEST);
    expect(s).not.toContain('\t');
    expect(s).not.toContain('\r');
  });

  it('tool names match snake_case charset and never end with underscore', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.name.endsWith('_')).toBe(false);
      expect(tool.name.startsWith('_')).toBe(false);
    }
  });

  it('TextEncoder UTF-8 byte lengths stay within stable bands for descriptions', () => {
    const enc = new TextEncoder();
    const modelBytes = enc.encode(MCP_MANIFEST.description_for_model).length;
    const humanBytes = enc.encode(MCP_MANIFEST.description_for_human).length;
    expect(modelBytes).toBe(MCP_MANIFEST.description_for_model.length);
    expect(humanBytes).toBe(MCP_MANIFEST.description_for_human.length);
    expect(modelBytes).toBeGreaterThan(100);
    expect(modelBytes).toBeLessThan(400);
    expect(humanBytes).toBeGreaterThan(20);
    expect(humanBytes).toBeLessThan(120);
    for (const tool of MCP_MANIFEST.tools) {
      const n = enc.encode(tool.description).length;
      expect(n).toBe(tool.description.length);
      expect(n).toBeGreaterThan(20);
      expect(n).toBeLessThan(200);
    }
  });

  it('Object.preventExtensions on tool copies still allows property reads', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const copy = { ...tool, input_schema: { ...tool.input_schema } };
      Object.preventExtensions(copy);
      expect(copy.name).toBe(tool.name);
      expect(copy.description).toBe(tool.description);
      expect(Object.isExtensible(copy)).toBe(false);
      expect(Object.isExtensible(tool)).toBe(true);
    }
  });

  it('Proxy around MCP_MANIFEST deep-equals via JSON.stringify', () => {
    const proxied = new Proxy(MCP_MANIFEST, {});
    expect(JSON.stringify(proxied)).toBe(JSON.stringify(MCP_MANIFEST));
    expect(proxied.tools).toHaveLength(4);
    expect(proxied.schema_version).toBe('v1');
  });

  it('locks tools.map name join exact CSV', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name).join(',')).toBe(
      'station_select,now_playing,genre_filter,curator_prompt',
    );
  });

  it('does not declare homepage locale contact_email or logo_url top-level keys', () => {
    for (const key of ['homepage', 'locale', 'contact_email', 'logo_url', 'terms_of_service']) {
      expect(MCP_MANIFEST).not.toHaveProperty(key);
    }
  });

  it('tool names and property keys are ASCII printable only', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toMatch(/^[\x20-\x7E]+$/);
      for (const key of Object.keys(tool.input_schema.properties)) {
        expect(key).toMatch(/^[\x20-\x7E]+$/);
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('schema_version matches /^v\\d+$/ and equals v1 exactly', () => {
    expect(MCP_MANIFEST.schema_version).toMatch(/^v\d+$/);
    expect(MCP_MANIFEST.schema_version).toBe('v1');
  });

  it('now_playing properties is a plain Object.prototype object', () => {
    const props = toolNamed('now_playing').input_schema.properties;
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(Object.keys(props)).toEqual([]);
  });

  it('keeps every tool object key set exactly name/description/input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
    }
  });

  it('locks first and last tool names via Array.prototype.at', () => {
    expect(MCP_MANIFEST.tools.at(0)?.name).toBe('station_select');
    expect(MCP_MANIFEST.tools.at(-1)?.name).toBe('curator_prompt');
  });

  it('structuredClone of tools array is deep-equal but distinct', () => {
    const cloned = structuredClone(MCP_MANIFEST.tools);
    expect(cloned).toEqual(MCP_MANIFEST.tools);
    expect(cloned).not.toBe(MCP_MANIFEST.tools);
    expect(cloned[0]).not.toBe(MCP_MANIFEST.tools[0]);
    expect(cloned[0].input_schema).not.toBe(MCP_MANIFEST.tools[0].input_schema);
  });

  it('does not declare servers resources prompts or completions blocks', () => {
    for (const key of ['servers', 'resources', 'prompts', 'completions', 'capabilities']) {
      expect(MCP_MANIFEST).not.toHaveProperty(key);
    }
  });

  it('keeps api.url as a root-relative path without host', () => {
    expect(MCP_MANIFEST.api.url.startsWith('/')).toBe(true);
    expect(MCP_MANIFEST.api.url).not.toMatch(/^https?:/i);
    expect(MCP_MANIFEST.api.url).not.toContain('://');
  });

  it('every required field name exists in the same tool properties', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const required = tool.input_schema.required ?? [];
      for (const r of required) {
        expect(tool.input_schema.properties).toHaveProperty(r);
      }
    }
  });

  it('JSON.parse(JSON.stringify(MCP_MANIFEST)) round-trips deep equality', () => {
    expect(JSON.parse(JSON.stringify(MCP_MANIFEST))).toEqual(MCP_MANIFEST);
  });

  it('locks total tools length at 4 and never sparse', () => {
    expect(MCP_MANIFEST.tools.length).toBe(4);
    expect(MCP_MANIFEST.tools.filter(() => true)).toHaveLength(4);
    expect([...'x'.repeat(MCP_MANIFEST.tools.length)]).toHaveLength(4);
  });

  it('description_for_model mentions stations genre and AI curator concepts', () => {
    const d = MCP_MANIFEST.description_for_model.toLowerCase();
    expect(d).toMatch(/station/);
    expect(d).toMatch(/genre/);
    expect(d).toMatch(/curator|ai/);
  });

  it('does not embed absolute URLs in any description string', () => {
    const blobs = [
      MCP_MANIFEST.description_for_model,
      MCP_MANIFEST.description_for_human,
      ...MCP_MANIFEST.tools.map((t) => t.description),
      ...MCP_MANIFEST.tools.flatMap((t) =>
        Object.values(t.input_schema.properties).map((p) => (p as { description: string }).description),
      ),
    ];
    for (const b of blobs) {
      expect(b).not.toMatch(/https?:\/\//i);
    }
  });

  it('auth.type none is the only auth key and value', () => {
    expect(Object.keys(MCP_MANIFEST.auth)).toEqual(['type']);
    expect(MCP_MANIFEST.auth.type).toBe('none');
  });

  it('api owns exactly type and url keys in declaration order', () => {
    expect(Object.keys(MCP_MANIFEST.api)).toEqual(['type', 'url']);
  });

  it('keeps claw-mcp tool names free of camelCase and kebab-case', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).not.toMatch(/[A-Z]/);
      expect(tool.name).not.toContain('-');
    }
  });

  it('locks exact character length of each tool name', () => {
    expect(
      Object.fromEntries(MCP_MANIFEST.tools.map((t) => [t.name, t.name.length])),
    ).toEqual({
      station_select: 14,
      now_playing: 11,
      genre_filter: 12,
      curator_prompt: 14,
    });
  });

  it('every property type is string and description is non-empty', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        const p = prop as { type: string; description: string };
        expect(p.type).toBe('string');
        expect(p.description.length).toBeGreaterThan(5);
      }
    }
  });

  it('tools.findIndex order matches declaration indices', () => {
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'station_select')).toBe(0);
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'now_playing')).toBe(1);
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'genre_filter')).toBe(2);
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'curator_prompt')).toBe(3);
  });

  it('JSON.stringify tools array has stable key order name then description then input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const serialized = JSON.stringify(tool);
      const nameIdx = serialized.indexOf('"name"');
      const descIdx = serialized.indexOf('"description"');
      const schemaIdx = serialized.indexOf('"input_schema"');
      expect(nameIdx).toBeGreaterThanOrEqual(0);
      expect(descIdx).toBeGreaterThan(nameIdx);
      expect(schemaIdx).toBeGreaterThan(descIdx);
    }
  });

  it('does not declare $schema or additionalProperties on input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema).not.toHaveProperty('$schema');
      expect(tool.input_schema).not.toHaveProperty('additionalProperties');
      expect(tool.input_schema).not.toHaveProperty('title');
    }
  });

  it('name_for_model is a single lowercase token without spaces', () => {
    expect(MCP_MANIFEST.name_for_model).toMatch(/^[a-z]+$/);
    expect(MCP_MANIFEST.name_for_model).not.toContain(' ');
  });

  it('name_for_human contains Backlink and Radio', () => {
    expect(MCP_MANIFEST.name_for_human).toContain('Backlink');
    expect(MCP_MANIFEST.name_for_human).toContain('Radio');
  });

  it('structuredClone of full manifest deep-equals and is distinct', () => {
    const cloned = structuredClone(MCP_MANIFEST);
    expect(cloned).toEqual(MCP_MANIFEST);
    expect(cloned).not.toBe(MCP_MANIFEST);
    expect(cloned.tools).not.toBe(MCP_MANIFEST.tools);
    expect(cloned.auth).not.toBe(MCP_MANIFEST.auth);
  });

  it('does not use enum or const constraints on any property', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop).not.toHaveProperty('enum');
        expect(prop).not.toHaveProperty('const');
        expect(prop).not.toHaveProperty('default');
      }
    }
  });

  it('keeps description_for_human free of markdown and HTML tags', () => {
    expect(MCP_MANIFEST.description_for_human).not.toMatch(/[*_`#<>]/);
  });

  it('keeps every tool description free of markdown emphasis markers', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description).not.toMatch(/\*\*|__/);
    }
  });

  it('Object.values(MCP_MANIFEST) length equals key count', () => {
    expect(Object.values(MCP_MANIFEST)).toHaveLength(Object.keys(MCP_MANIFEST).length);
  });

  it('tools array is iterable via values() and keys() index sync', () => {
    const fromValues = [...MCP_MANIFEST.tools.values()].map((t) => t.name);
    const fromKeys = [...MCP_MANIFEST.tools.keys()].map((i) => MCP_MANIFEST.tools[i].name);
    expect(fromValues).toEqual(fromKeys);
  });

  it('does not declare version or manifest_version top-level aliases', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('version');
    expect(MCP_MANIFEST).not.toHaveProperty('manifest_version');
    expect(MCP_MANIFEST).not.toHaveProperty('protocol_version');
  });

  it('curator_prompt genre property is optional (absent from required)', () => {
    const tool = toolNamed('curator_prompt');
    expect(tool.input_schema.required).toEqual(['mood']);
    expect(tool.input_schema.required).not.toContain('genre');
    expect(tool.input_schema.properties).toHaveProperty('genre');
  });

  it('station_select required is exactly station_name singleton', () => {
    expect(toolNamed('station_select').input_schema.required).toEqual(['station_name']);
  });

  it('genre_filter required is exactly genre singleton', () => {
    expect(toolNamed('genre_filter').input_schema.required).toEqual(['genre']);
  });

  it('locks total JSON.stringify(MCP_MANIFEST) length within a stable band', () => {
    const n = JSON.stringify(MCP_MANIFEST).length;
    expect(n).toBeGreaterThan(800);
    expect(n).toBeLessThan(4000);
  });

  it('every input_schema.type is exactly object', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('does not nest tools inside auth or api objects', () => {
    expect(MCP_MANIFEST.auth).not.toHaveProperty('tools');
    expect(MCP_MANIFEST.api).not.toHaveProperty('tools');
  });

  it('property descriptions do not mention HTTP methods or status codes', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        const d = (prop as { description: string }).description;
        expect(d).not.toMatch(/\b(GET|POST|PUT|DELETE|503|404)\b/);
      }
    }
  });

  it('keeps openapi api.type and none auth.type as non-empty short tokens', () => {
    expect(MCP_MANIFEST.api.type.length).toBeGreaterThan(3);
    expect(MCP_MANIFEST.api.type.length).toBeLessThan(16);
    expect(MCP_MANIFEST.auth.type.length).toBeGreaterThan(2);
    expect(MCP_MANIFEST.auth.type.length).toBeLessThan(16);
  });

  it('TextEncoder byte length of name_for_model equals char length (ASCII-only)', () => {
    const enc = new TextEncoder();
    expect(enc.encode(MCP_MANIFEST.name_for_model).length).toBe(MCP_MANIFEST.name_for_model.length);
    expect(enc.encode(MCP_MANIFEST.schema_version).length).toBe(MCP_MANIFEST.schema_version.length);
  });

  it('TextEncoder byte lengths for tool names match exact char lengths', () => {
    const enc = new TextEncoder();
    for (const tool of MCP_MANIFEST.tools) {
      expect(enc.encode(tool.name).byteLength).toBe(tool.name.length);
      expect([...tool.name].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    }
  });

  it('locks TextEncoder UTF-8 byte bands for human and model descriptions', () => {
    const enc = new TextEncoder();
    const human = enc.encode(MCP_MANIFEST.description_for_human).length;
    const model = enc.encode(MCP_MANIFEST.description_for_model).length;
    expect(human).toBeGreaterThan(20);
    expect(human).toBeLessThan(200);
    expect(model).toBeGreaterThan(80);
    expect(model).toBeLessThan(500);
    expect(model).toBeGreaterThan(human);
  });

  it('property description length bands stay within 10..120 chars', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        const n = (prop as { description: string }).description.length;
        expect(n).toBeGreaterThanOrEqual(10);
        expect(n).toBeLessThanOrEqual(120);
      }
    }
  });

  it('locks insertion-order Object.keys for top-level manifest', () => {
    expect(Object.keys(MCP_MANIFEST)).toEqual([
      'schema_version',
      'name_for_model',
      'name_for_human',
      'description_for_model',
      'description_for_human',
      'auth',
      'api',
      'tools',
    ]);
  });

  it('locks insertion-order Object.keys for station_select properties', () => {
    expect(Object.keys(toolNamed('station_select').input_schema.properties)).toEqual([
      'station_name',
    ]);
  });

  it('locks insertion-order Object.keys for curator_prompt properties mood then genre', () => {
    expect(Object.keys(toolNamed('curator_prompt').input_schema.properties)).toEqual([
      'mood',
      'genre',
    ]);
  });

  it('structuredClone independence: mutating clone.auth does not touch live auth', () => {
    const cloned = structuredClone(MCP_MANIFEST);
    cloned.auth.type = 'bearer';
    expect(MCP_MANIFEST.auth.type).toBe('none');
    expect(cloned.auth.type).toBe('bearer');
  });

  it('structuredClone independence: splicing clone.tools leaves live length 4', () => {
    const cloned = structuredClone(MCP_MANIFEST);
    cloned.tools.splice(0, 1);
    expect(cloned.tools).toHaveLength(3);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('declares no extra top-level keys beyond the locked eight', () => {
    const allowed = new Set([
      'schema_version',
      'name_for_model',
      'name_for_human',
      'description_for_model',
      'description_for_human',
      'auth',
      'api',
      'tools',
    ]);
    for (const k of Object.keys(MCP_MANIFEST)) {
      expect(allowed.has(k)).toBe(true);
    }
    expect(Object.keys(MCP_MANIFEST)).toHaveLength(8);
  });

  it('tool objects declare exactly name description input_schema keys', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
    }
  });

  it('ASCII-only names for model human schema_version and every tool', () => {
    const blobs = [
      MCP_MANIFEST.name_for_model,
      MCP_MANIFEST.name_for_human,
      MCP_MANIFEST.schema_version,
      ...MCP_MANIFEST.tools.map((t) => t.name),
    ];
    for (const b of blobs) {
      expect(/^[\x20-\x7E]+$/.test(b)).toBe(true);
    }
  });

  it('every tool name is snake_case with at least one underscore segment', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)+$/);
      expect(tool.name.startsWith('_')).toBe(false);
      expect(tool.name.endsWith('_')).toBe(false);
    }
  });

  it('tools.at(-1) is curator_prompt and tools.at(-2) is genre_filter', () => {
    expect(MCP_MANIFEST.tools.at(-1)?.name).toBe('curator_prompt');
    expect(MCP_MANIFEST.tools.at(-2)?.name).toBe('genre_filter');
    expect(MCP_MANIFEST.tools.at(3)?.name).toBe(MCP_MANIFEST.tools.at(-1)?.name);
  });

  it('Array.from(tools) yields same names as map callback', () => {
    expect(Array.from(MCP_MANIFEST.tools, (t) => t.name)).toEqual(
      MCP_MANIFEST.tools.map((t) => t.name),
    );
    expect(Array.from({ length: MCP_MANIFEST.tools.length }, (_, i) => MCP_MANIFEST.tools[i].name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('JSON.stringify key order for auth is type-first singleton', () => {
    expect(JSON.stringify(MCP_MANIFEST.auth)).toBe('{"type":"none"}');
  });

  it('JSON.stringify key order for api is type then url', () => {
    expect(JSON.stringify(MCP_MANIFEST.api)).toBe('{"type":"openapi","url":"/openapi.json"}');
  });

  it('JSON key order for input_schema places type before properties', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const s = JSON.stringify(tool.input_schema);
      expect(s.indexOf('"type"')).toBeLessThan(s.indexOf('"properties"'));
    }
  });

  it('Object.preventExtensions on structuredClone manifest still allows deep reads', () => {
    const copy = structuredClone(MCP_MANIFEST);
    Object.preventExtensions(copy);
    Object.preventExtensions(copy.auth);
    Object.preventExtensions(copy.api);
    expect(Object.isExtensible(copy)).toBe(false);
    expect(copy.tools).toHaveLength(4);
    expect(copy.api.url).toBe('/openapi.json');
    expect(() => {
      (copy as { extra?: string }).extra = 'nope';
    }).toThrow();
  });

  it('Object.preventExtensions on each tool copy preserves snake_case names', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const copy = Object.preventExtensions({ ...tool, input_schema: { ...tool.input_schema } });
      expect(copy.name).toMatch(/^[a-z_]+$/);
      expect(Object.isExtensible(copy)).toBe(false);
    }
  });

  it('TextEncoder byte length of JSON.stringify(tools) stays in a stable band', () => {
    const n = new TextEncoder().encode(JSON.stringify(MCP_MANIFEST.tools)).length;
    expect(n).toBeGreaterThan(400);
    expect(n).toBeLessThan(3000);
  });

  it('no extra keys on auth or api beyond locked sets', () => {
    expect(Object.keys(MCP_MANIFEST.auth)).toEqual(['type']);
    expect(Object.keys(MCP_MANIFEST.api)).toEqual(['type', 'url']);
    expect(Object.getOwnPropertyNames(MCP_MANIFEST.auth)).toEqual(['type']);
    expect(Object.getOwnPropertyNames(MCP_MANIFEST.api).sort()).toEqual(['type', 'url']);
  });

  it('Array.from(Object.keys(tools[0])) matches insertion order name description input_schema', () => {
    expect(Array.from(Object.keys(MCP_MANIFEST.tools[0]))).toEqual([
      'name',
      'description',
      'input_schema',
    ]);
  });

  it('structuredClone then preventExtensions nest does not alias live tools array', () => {
    const cloned = structuredClone(MCP_MANIFEST);
    Object.preventExtensions(cloned.tools);
    cloned.tools[0] = {
      name: 'hijacked',
      description: 'x',
      input_schema: { type: 'object', properties: {} },
    };
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
    expect(cloned.tools[0].name).toBe('hijacked');
  });

  it('locks exact snake_case underscore counts across tools', () => {
    const counts = Object.fromEntries(
      MCP_MANIFEST.tools.map((t) => [t.name, (t.name.match(/_/g) ?? []).length]),
    );
    expect(counts).toEqual({
      station_select: 1,
      now_playing: 1,
      genre_filter: 1,
      curator_prompt: 1,
    });
  });

  it('tools.at(out of range) is undefined while length stays 4', () => {
    expect(MCP_MANIFEST.tools.at(4)).toBeUndefined();
    expect(MCP_MANIFEST.tools.at(-5)).toBeUndefined();
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('JSON.parse(JSON.stringify) preserves insertion-order Object.keys for tools names', () => {
    const round = JSON.parse(JSON.stringify(MCP_MANIFEST)) as typeof MCP_MANIFEST;
    expect(round.tools.map((t) => t.name)).toEqual(Object.keys(
      Object.fromEntries(MCP_MANIFEST.tools.map((t) => [t.name, true])),
    ));
    expect(Object.keys(round)).toEqual(Object.keys(MCP_MANIFEST));
  });

  it('description_for_model TextEncoder length equals String length (BMP ASCII-heavy)', () => {
    const d = MCP_MANIFEST.description_for_model;
    expect(new TextEncoder().encode(d).length).toBe(d.length);
    expect([...d].length).toBe(d.length);
  });

  it('now_playing properties object has zero keys and Array.from empty', () => {
    const props = toolNamed('now_playing').input_schema.properties;
    expect(Object.keys(props)).toEqual([]);
    expect(Array.from(Object.keys(props))).toEqual([]);
    expect(Object.keys(props)).toHaveLength(0);
  });

  it('genre_filter property description length band is tight', () => {
    const d = (toolNamed('genre_filter').input_schema.properties.genre as { description: string })
      .description;
    expect(d.length).toBeGreaterThan(15);
    expect(d.length).toBeLessThan(60);
    expect(new TextEncoder().encode(d).length).toBe(d.length);
  });

});
