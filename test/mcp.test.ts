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

  it('locks description_for_model verb set: Select/filter/get/ask', () => {
    const d = MCP_MANIFEST.description_for_model;
    expect(d).toMatch(/Select stations/);
    expect(d).toMatch(/filter by genre/);
    expect(d).toMatch(/get now-playing/);
    expect(d).toMatch(/ask the AI curator/);
  });
  it('keeps description_for_human free of tool names and endpoint paths', () => {
    expect(MCP_MANIFEST.description_for_human).not.toMatch(/station_select|now_playing|curator_prompt/);
    expect(MCP_MANIFEST.description_for_human).not.toMatch(/\/curate|\/genres|\/stations/);
  });
  it('JSON round-trip preserves tool property insertion order', () => {
    const cloned = JSON.parse(JSON.stringify(MCP_MANIFEST)) as typeof MCP_MANIFEST;
    expect(Object.keys(cloned.tools[3].input_schema.properties)).toEqual(['mood', 'genre']);
    expect(Object.keys(cloned.tools[0].input_schema.properties)).toEqual(['station_name']);
  });
  it('keeps every required array as a mutable Array instance', () => {
    for (const tool of MCP_MANIFEST.tools) {
      if (tool.input_schema.required) {
        expect(Array.isArray(tool.input_schema.required)).toBe(true);
        expect(Object.isFrozen(tool.input_schema.required)).toBe(false);
      }
    }
  });
  it('does not declare minLength/maxLength/pattern/format on any property', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop).not.toHaveProperty('minLength');
        expect(prop).not.toHaveProperty('maxLength');
        expect(prop).not.toHaveProperty('pattern');
        expect(prop).not.toHaveProperty('format');
        expect(prop).not.toHaveProperty('enum');
        expect(prop).not.toHaveProperty('default');
      }
    }
  });
  it('locks genre_filter.properties key order exactly genre', () => {
    expect(Object.keys(toolNamed('genre_filter').input_schema.properties)).toEqual(['genre']);
  });
  it('locks curator_prompt.required to mood only (genre optional)', () => {
    const tool = toolNamed('curator_prompt');
    expect(tool.input_schema.required).toEqual(['mood']);
    expect(Object.keys(tool.input_schema.properties)).toContain('genre');
  });
  it('keeps tools array extensible and unsealed', () => {
    expect(Object.isExtensible(MCP_MANIFEST.tools)).toBe(true);
    expect(Object.isSealed(MCP_MANIFEST.tools)).toBe(false);
    expect(Object.isFrozen(MCP_MANIFEST.tools)).toBe(false);
  });
  it('does not declare name_for_model with spaces or uppercase', () => {
    expect(MCP_MANIFEST.name_for_model).toMatch(/^[a-z]+$/);
  });
  it('name_for_human title-cases Backlink Radio with single space', () => {
    expect(MCP_MANIFEST.name_for_human.split(' ')).toEqual(['Backlink', 'Radio']);
  });
  it('api.url ends with .json and has exactly one slash', () => {
    expect(MCP_MANIFEST.api.url.endsWith('.json')).toBe(true);
    expect([...MCP_MANIFEST.api.url].filter((c) => c === '/')).toHaveLength(1);
  });
  it('every tool name contains an underscore (multi-token snake_case)', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toContain('_');
      expect(tool.name.split('_').length).toBeGreaterThanOrEqual(2);
    }
  });
  it('structuredClone tools are deep-equal but not same references', () => {
    const cloned = structuredClone(MCP_MANIFEST);
    expect(cloned).toEqual(MCP_MANIFEST);
    expect(cloned.tools).not.toBe(MCP_MANIFEST.tools);
    expect(cloned.tools[0]).not.toBe(MCP_MANIFEST.tools[0]);
  });
  it('does not declare parameters / arguments aliases for input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('parameters');
      expect(tool).not.toHaveProperty('arguments');
      expect(tool).not.toHaveProperty('inputSchema');
    }
  });
  it('locks exact station_select description string length', () => {
    expect(toolNamed('station_select').description).toBe(
      'Set the currently playing station by name.',
    );
    expect(toolNamed('station_select').description.length).toBe(42);
  });
  it('locks now_playing description to mention stream URL with capital URL', () => {
    expect(toolNamed('now_playing').description).toContain('stream URL');
    expect(toolNamed('now_playing').description).not.toContain('stream url');
  });
  it('genre_filter examples list is jazz, news, classical in that order', () => {
    const d = toolNamed('genre_filter').description;
    const m = d.match(/\(e\.g\.\s*([^)]+)\)/);
    expect(m?.[1]).toBe('jazz, news, classical');
  });
  it('curator_prompt mood e.g. list order focus work, late night jazz, morning energy', () => {
    const d = toolNamed('curator_prompt').input_schema.properties.mood!.description as string;
    const m = d.match(/\(e\.g\.\s*([^)]+)\)/);
    expect(m?.[1]).toBe('focus work, late night jazz, morning energy');
  });
  it('serializes entire manifest without null or undefined tokens', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toMatch(/:null/);
    expect(raw).not.toMatch(/undefined/);
  });
  it('tool count equals unique tool name count equals 4', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
  });
  it('does not declare servers, endpoints, or resources at top level', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('servers');
    expect(MCP_MANIFEST).not.toHaveProperty('endpoints');
    expect(MCP_MANIFEST).not.toHaveProperty('resources');
    expect(MCP_MANIFEST).not.toHaveProperty('prompts');
  });
  it('input_schema.properties for now_playing is === empty object reference stable', () => {
    const props = toolNamed('now_playing').input_schema.properties;
    expect(props).toEqual({});
    expect(Object.keys(props)).toHaveLength(0);
  });
  it('locks property description lengths within stable ceilings', () => {
    expect(toolNamed('station_select').input_schema.properties.station_name!.description!.length).toBe(
      46,
    );
    expect(toolNamed('genre_filter').input_schema.properties.genre!.description!.length).toBe(27);
    expect(toolNamed('curator_prompt').input_schema.properties.mood!.description!.length).toBe(88);
    expect(toolNamed('curator_prompt').input_schema.properties.genre!.description!.length).toBe(42);
  });
  it('description_for_model mentions Backlink by name once', () => {
    const matches = MCP_MANIFEST.description_for_model.match(/Backlink/g) ?? [];
    expect(matches).toHaveLength(1);
  });
  it('does not use camelCase tool names or kebab-case', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).not.toMatch(/[A-Z]/);
      expect(tool.name).not.toContain('-');
    }
  });
  it('keeps Object.keys(auth) and Object.keys(api) insertion order', () => {
    expect(Object.keys(MCP_MANIFEST.auth)).toEqual(['type']);
    expect(Object.keys(MCP_MANIFEST.api)).toEqual(['type', 'url']);
  });
  it('deep equality of tools[i] to find-by-name for all four tools', () => {
    for (const name of ['station_select', 'now_playing', 'genre_filter', 'curator_prompt'] as const) {
      expect(toolNamed(name)).toBe(MCP_MANIFEST.tools.find((t) => t.name === name));
    }
  });
  it('JSON.stringify tools preserves required key only when present', () => {
    const tools = JSON.parse(JSON.stringify(MCP_MANIFEST.tools)) as Array<{
      name: string;
      input_schema: { required?: string[] };
    }>;
    expect(tools.find((t) => t.name === 'now_playing')!.input_schema.required).toBeUndefined();
    expect(tools.find((t) => t.name === 'station_select')!.input_schema.required).toEqual([
      'station_name',
    ]);
  });
  it('manifest descriptions do not contain angle brackets or HTML', () => {
    expect(MCP_MANIFEST.description_for_model).not.toMatch(/<[^>]+>/);
    expect(MCP_MANIFEST.description_for_human).not.toMatch(/<[^>]+>/);
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description).not.toMatch(/<[^>]+>/);
    }
  });
  it('locks top-level key insertion order snapshot', () => {
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

});
