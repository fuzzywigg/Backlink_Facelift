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
});

