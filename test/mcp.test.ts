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

  // --- post-#49/#50 HEAVY deepen: complementary MCP_MANIFEST locks (tests-only) ---

  it('locks exact character lengths for top-level name and description fields', () => {
    expect(MCP_MANIFEST.schema_version.length).toBe(2);
    expect(MCP_MANIFEST.name_for_model.length).toBe(8);
    expect(MCP_MANIFEST.name_for_human.length).toBe(14);
    expect(MCP_MANIFEST.description_for_model.length).toBe(173);
    expect(MCP_MANIFEST.description_for_human.length).toBe(48);
  });

  it('locks exact character lengths for every tool description', () => {
    expect(
      Object.fromEntries(MCP_MANIFEST.tools.map((t) => [t.name, t.description.length])),
    ).toEqual({
      station_select: 42,
      now_playing: 81,
      genre_filter: 81,
      curator_prompt: 80,
    });
  });

  it('locks exact character lengths for every property description', () => {
    expect(
      toolNamed('station_select').input_schema.properties.station_name!.description.length,
    ).toBe(46);
    expect(toolNamed('genre_filter').input_schema.properties.genre!.description.length).toBe(27);
    expect(toolNamed('curator_prompt').input_schema.properties.mood!.description.length).toBe(88);
    expect(toolNamed('curator_prompt').input_schema.properties.genre!.description.length).toBe(42);
  });

  it('locks exact word counts for model and human descriptions', () => {
    expect(MCP_MANIFEST.description_for_model.split(/\s+/).filter(Boolean)).toHaveLength(29);
    expect(MCP_MANIFEST.description_for_human.split(/\s+/).filter(Boolean)).toHaveLength(7);
  });

  it('locks exact sentence counts via period-terminated clauses', () => {
    expect(MCP_MANIFEST.description_for_model.match(/\./g)).toHaveLength(2);
    expect(MCP_MANIFEST.description_for_human.match(/\./g)).toHaveLength(1);
    expect(toolNamed('station_select').description.match(/\./g)).toHaveLength(1);
    expect(toolNamed('now_playing').description.match(/\./g)).toHaveLength(1);
    expect(toolNamed('curator_prompt').description.match(/\./g)).toHaveLength(1);
    // genre_filter embeds "e.g." so three period code units total
    expect(toolNamed('genre_filter').description.match(/\./g)).toHaveLength(3);
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.endsWith('.')).toBe(true);
    }
  });
  it('keeps no double spaces or leading/trailing whitespace in any description', () => {
    const blobs = [
      MCP_MANIFEST.description_for_model,
      MCP_MANIFEST.description_for_human,
      ...MCP_MANIFEST.tools.map((t) => t.description),
      ...MCP_MANIFEST.tools.flatMap((t) =>
        Object.values(t.input_schema.properties).map((p) => (p as { description: string }).description),
      ),
    ];
    for (const b of blobs) {
      expect(b).toBe(b.trim());
      expect(b).not.toMatch(/  /);
      expect(b).not.toMatch(/\t|\r|\n/);
    }
  });

  it('Reflect.ownKeys on manifest equals Object.keys (no symbols)', () => {
    expect(Reflect.ownKeys(MCP_MANIFEST)).toEqual(Object.keys(MCP_MANIFEST));
    expect(Reflect.ownKeys(MCP_MANIFEST.auth)).toEqual(['type']);
    expect(Reflect.ownKeys(MCP_MANIFEST.api)).toEqual(['type', 'url']);
    for (const tool of MCP_MANIFEST.tools) {
      expect(Reflect.ownKeys(tool)).toEqual(['name', 'description', 'input_schema']);
    }
  });

  it('Reflect.has / Reflect.get mirror direct property access', () => {
    expect(Reflect.has(MCP_MANIFEST, 'tools')).toBe(true);
    expect(Reflect.has(MCP_MANIFEST, 'transport')).toBe(false);
    expect(Reflect.get(MCP_MANIFEST, 'schema_version')).toBe('v1');
    expect(Reflect.get(MCP_MANIFEST.api, 'url')).toBe('/openapi.json');
    expect(Reflect.get(toolNamed('now_playing').input_schema, 'required')).toBeUndefined();
  });

  it('Object.getOwnPropertyDescriptor locks writable enumerable configurable for top-level', () => {
    for (const key of Object.keys(MCP_MANIFEST) as (keyof typeof MCP_MANIFEST)[]) {
      const d = Object.getOwnPropertyDescriptor(MCP_MANIFEST, key);
      expect(d).toBeDefined();
      expect(d!.enumerable).toBe(true);
      expect(d!.configurable).toBe(true);
      expect(d!.writable).toBe(true);
      expect(d!.get).toBeUndefined();
      expect(d!.set).toBeUndefined();
    }
  });

  it('Object.getOwnPropertyDescriptor locks for each tool name description input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const key of ['name', 'description', 'input_schema'] as const) {
        const d = Object.getOwnPropertyDescriptor(tool, key);
        expect(d?.enumerable).toBe(true);
        expect(d?.configurable).toBe(true);
        expect(d?.writable).toBe(true);
      }
    }
  });

  it('Object.freeze on structuredClone isolates mutations from live manifest', () => {
    const frozen = Object.freeze(structuredClone(MCP_MANIFEST));
    expect(() => {
      (frozen as { schema_version: string }).schema_version = 'v9';
    }).toThrow();
    expect(MCP_MANIFEST.schema_version).toBe('v1');
    expect(Object.isFrozen(MCP_MANIFEST)).toBe(false);
  });

  it('Object.seal on structuredClone.tools blocks new keys but allows index writes', () => {
    const cloned = structuredClone(MCP_MANIFEST);
    Object.seal(cloned.tools);
    expect(Object.isSealed(cloned.tools)).toBe(true);
    expect(() => {
      (cloned.tools as unknown as { extra?: string }).extra = 'x';
    }).toThrow();
    cloned.tools[0] = {
      name: 'temp',
      description: 'temp',
      input_schema: { type: 'object', properties: {} },
    };
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('Proxy revoke after wrap still leaves live MCP_MANIFEST readable', () => {
    const { proxy, revoke } = Proxy.revocable(MCP_MANIFEST, {});
    expect(proxy.name_for_model).toBe('backlink');
    revoke();
    expect(() => proxy.name_for_model).toThrow();
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('Proxy get trap forwarding equals direct tool name list', () => {
    const seen: string[] = [];
    const proxied = new Proxy(MCP_MANIFEST.tools, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          seen.push((value as { name: string }).name);
        }
        return value;
      },
    });
    expect(proxied.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
    expect(seen).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('does not declare MCP SDK transport/roots/sampling/logging top-level keys', () => {
    for (const key of [
      'transport',
      'roots',
      'sampling',
      'logging',
      'notifications',
      'experimental',
      'instructions',
      'website_url',
      'legal_info_url',
      'contact_email',
    ]) {
      expect(MCP_MANIFEST).not.toHaveProperty(key);
    }
  });

  it('does not declare JSON Schema draft meta keywords on any property', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        for (const k of [
          'minLength',
          'maxLength',
          'pattern',
          'format',
          'examples',
          'deprecated',
          'readOnly',
          'writeOnly',
          'nullable',
          'anyOf',
          'oneOf',
          'allOf',
          '$ref',
        ]) {
          expect(prop).not.toHaveProperty(k);
        }
      }
    }
  });

  it('tool name underscore segments are exactly two lowercase tokens each', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const parts = tool.name.split('_');
      expect(parts).toHaveLength(2);
      for (const p of parts) {
        expect(p).toMatch(/^[a-z]+$/);
        expect(p.length).toBeGreaterThan(2);
      }
    }
  });

  it('locks exact underscore-split tokens for every tool name', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name.split('_'))).toEqual([
      ['station', 'select'],
      ['now', 'playing'],
      ['genre', 'filter'],
      ['curator', 'prompt'],
    ]);
  });

  it('localeCompare ascending of tool names differs from declaration order', () => {
    const declared = MCP_MANIFEST.tools.map((t) => t.name);
    const sorted = [...declared].sort((a, b) => a.localeCompare(b));
    expect(sorted).toEqual(['curator_prompt', 'genre_filter', 'now_playing', 'station_select']);
    expect(sorted).not.toEqual(declared);
  });

  it('for...of over tools yields declaration order without holes', () => {
    const names: string[] = [];
    for (const tool of MCP_MANIFEST.tools) {
      names.push(tool.name);
    }
    expect(names).toEqual(['station_select', 'now_playing', 'genre_filter', 'curator_prompt']);
  });

  it('tools.reduce fan-in of property counts equals 4 total properties', () => {
    const total = MCP_MANIFEST.tools.reduce(
      (acc, t) => acc + Object.keys(t.input_schema.properties).length,
      0,
    );
    expect(total).toBe(4);
    expect(
      MCP_MANIFEST.tools.reduce((acc, t) => acc + (t.input_schema.required?.length ?? 0), 0),
    ).toBe(3);
  });

  it('Map and Set derived from tool names stay size 4 and ordered via Array.from', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    const asSet = new Set(names);
    const asMap = new Map(names.map((n, i) => [n, i]));
    expect(asSet.size).toBe(4);
    expect(asMap.size).toBe(4);
    expect(Array.from(asSet)).toEqual(names);
    expect(Array.from(asMap.keys())).toEqual(names);
    expect(asMap.get('genre_filter')).toBe(2);
  });

  it('WeakMap identity keys tools without leaking across structuredClone', () => {
    const wm = new WeakMap<object, string>();
    for (const tool of MCP_MANIFEST.tools) {
      wm.set(tool, tool.name);
    }
    expect(wm.get(MCP_MANIFEST.tools[0])).toBe('station_select');
    const cloned = structuredClone(MCP_MANIFEST.tools[0]);
    expect(wm.has(cloned)).toBe(false);
    expect(wm.get(MCP_MANIFEST.tools[0])).toBe('station_select');
  });

  it('TextDecoder round-trip of JSON.stringify(MCP_MANIFEST) is byte-stable', () => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(dec.decode(enc.encode(raw))).toBe(raw);
    expect(JSON.parse(dec.decode(enc.encode(raw)))).toEqual(MCP_MANIFEST);
  });

  it('locks exact JSON.stringify length for auth api and tools slices', () => {
    expect(JSON.stringify(MCP_MANIFEST.auth).length).toBe(15);
    expect(JSON.stringify(MCP_MANIFEST.api).length).toBe(40);
    const toolsJson = JSON.stringify(MCP_MANIFEST.tools);
    expect(toolsJson.length).toBeGreaterThan(500);
    expect(toolsJson.length).toBeLessThan(2500);
    expect(toolsJson.startsWith('[')).toBe(true);
    expect(toolsJson.endsWith(']')).toBe(true);
  });

  it('locks exact full JSON.stringify(MCP_MANIFEST) character length', () => {
    expect(JSON.stringify(MCP_MANIFEST).length).toBe(1534);
  });
  it('name_for_human title-cases two words with single ASCII space', () => {
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
    expect([...MCP_MANIFEST.name_for_human].filter((c) => c === ' ')).toHaveLength(1);
    expect(MCP_MANIFEST.name_for_human.codePointAt(8)).toBe(0x20);
  });

  it('schema_version is exactly the two code units v and 1', () => {
    expect([...MCP_MANIFEST.schema_version]).toEqual(['v', '1']);
    expect(MCP_MANIFEST.schema_version.charCodeAt(0)).toBe(0x76);
    expect(MCP_MANIFEST.schema_version.charCodeAt(1)).toBe(0x31);
  });

  it('api.url path segments are empty root then openapi.json', () => {
    expect(MCP_MANIFEST.api.url.split('/')).toEqual(['', 'openapi.json']);
    expect(MCP_MANIFEST.api.url.endsWith('.json')).toBe(true);
    expect(MCP_MANIFEST.api.url.toLowerCase()).toBe(MCP_MANIFEST.api.url);
  });

  it('every tool description starts with a capital ASCII letter', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.charAt(0)).toMatch(/[A-Z]/);
      expect(tool.description.charCodeAt(0)).toBeGreaterThanOrEqual(65);
      expect(tool.description.charCodeAt(0)).toBeLessThanOrEqual(90);
    }
  });

  it('every property description starts with a capital ASCII letter', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        const d = (prop as { description: string }).description;
        expect(d.charAt(0)).toMatch(/[A-Z]/);
      }
    }
  });

  it('description_for_model starts with Interact and ends with mood period', () => {
    expect(MCP_MANIFEST.description_for_model.startsWith('Interact with Backlink')).toBe(true);
    expect(MCP_MANIFEST.description_for_model.endsWith('for a mood.')).toBe(true);
  });

  it('description_for_human starts with AI-curated and ends with catalog period', () => {
    expect(MCP_MANIFEST.description_for_human.startsWith('AI-curated')).toBe(true);
    expect(MCP_MANIFEST.description_for_human.endsWith('catalog.')).toBe(true);
  });

  it('required arrays are dense string arrays with no duplicates', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const req = tool.input_schema.required;
      if (req === undefined) continue;
      expect(Array.isArray(req)).toBe(true);
      expect(req.length).toBeGreaterThan(0);
      expect(new Set(req).size).toBe(req.length);
      expect(Object.keys(req)).toEqual([...Array(req.length).keys()].map(String));
    }
  });

  it('cross-tool required field names are unique except none shared', () => {
    const allRequired = MCP_MANIFEST.tools.flatMap((t) => t.input_schema.required ?? []);
    expect(allRequired).toEqual(['station_name', 'genre', 'mood']);
    expect(new Set(allRequired).size).toBe(3);
  });

  it('property key universe across tools is station_name genre mood only', () => {
    const keys = MCP_MANIFEST.tools.flatMap((t) => Object.keys(t.input_schema.properties));
    expect(keys.sort()).toEqual(['genre', 'genre', 'mood', 'station_name'].sort());
    expect(new Set(keys)).toEqual(new Set(['station_name', 'genre', 'mood']));
  });

  it('genre appears on genre_filter and curator_prompt only', () => {
    const owners = MCP_MANIFEST.tools
      .filter((t) => 'genre' in t.input_schema.properties)
      .map((t) => t.name);
    expect(owners).toEqual(['genre_filter', 'curator_prompt']);
  });

  it('Object.isExtensible is true for every nested schema object', () => {
    expect(Object.isExtensible(MCP_MANIFEST)).toBe(true);
    expect(Object.isExtensible(MCP_MANIFEST.tools)).toBe(true);
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.isExtensible(tool)).toBe(true);
      expect(Object.isExtensible(tool.input_schema)).toBe(true);
      expect(Object.isExtensible(tool.input_schema.properties)).toBe(true);
    }
  });

  it('sorted copy of tools by name does not mutate live declaration order', () => {
    const sorted = [...MCP_MANIFEST.tools].sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted.map((t) => t.name)[0]).toBe('curator_prompt');
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('JSON.stringify does not emit undefined required for now_playing', () => {
    const raw = JSON.stringify(toolNamed('now_playing'));
    expect(raw).not.toContain('required');
    expect(raw).toContain('"properties":{}');
  });

  it('station_select JSON contains required station_name adjacent to properties', () => {
    const raw = JSON.stringify(toolNamed('station_select').input_schema);
    expect(raw).toContain('"required":["station_name"]');
    expect(raw.indexOf('"properties"')).toBeLessThan(raw.indexOf('"required"'));
  });

  it('curator_prompt JSON places required mood after properties block', () => {
    const raw = JSON.stringify(toolNamed('curator_prompt').input_schema);
    expect(raw).toContain('"required":["mood"]');
    expect(raw.indexOf('"mood"')).toBeLessThan(raw.indexOf('"genre"'));
    expect(raw.indexOf('"properties"')).toBeLessThan(raw.indexOf('"required"'));
  });

  it('does not mention Claude ChatGPT OpenAI Anthropic in any description', () => {
    const blobs = [
      MCP_MANIFEST.description_for_model,
      MCP_MANIFEST.description_for_human,
      ...MCP_MANIFEST.tools.map((t) => t.description),
      ...MCP_MANIFEST.tools.flatMap((t) =>
        Object.values(t.input_schema.properties).map((p) => (p as { description: string }).description),
      ),
    ].join('\n');
    expect(blobs).not.toMatch(/Claude|ChatGPT|OpenAI|Anthropic|Gemini|Copilot/i);
  });

  it('iptv-org appears only in description_for_human not tool strings', () => {
    expect(MCP_MANIFEST.description_for_human).toMatch(/iptv-org/);
    expect(MCP_MANIFEST.description_for_model).not.toMatch(/iptv-org/);
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description).not.toMatch(/iptv-org/);
    }
  });

  it('Backlink brand token appears in model description and name_for_human only among names', () => {
    expect(MCP_MANIFEST.description_for_model).toMatch(/Backlink/);
    expect(MCP_MANIFEST.name_for_human).toMatch(/Backlink/);
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(MCP_MANIFEST.description_for_human).not.toMatch(/Backlink/);
  });

  it('tools.find and find-from-end agree on boundary tools', () => {
    expect(MCP_MANIFEST.tools.find((t) => t.name.endsWith('_select'))?.name).toBe('station_select');
    const fromEnd = [...MCP_MANIFEST.tools].reverse().find((t) => t.name.includes('_'));
    expect(fromEnd?.name).toBe('curator_prompt');
    expect(MCP_MANIFEST.tools.find((t) => t.name === 'missing')).toBeUndefined();
  });

  it('tools.some / every / includes semantics for name membership', () => {
    expect(MCP_MANIFEST.tools.some((t) => t.name === 'now_playing')).toBe(true);
    expect(MCP_MANIFEST.tools.every((t) => t.name.includes('_'))).toBe(true);
    expect(MCP_MANIFEST.tools.map((t) => t.name).includes('genre_filter')).toBe(true);
    expect(MCP_MANIFEST.tools.every((t) => t.input_schema.type === 'object')).toBe(true);
  });

  it('Object.assign shallow copy of auth/api does not alias nested identity wrongly', () => {
    const authCopy = Object.assign({}, MCP_MANIFEST.auth);
    const apiCopy = Object.assign({}, MCP_MANIFEST.api);
    expect(authCopy).toEqual(MCP_MANIFEST.auth);
    expect(authCopy).not.toBe(MCP_MANIFEST.auth);
    expect(apiCopy).toEqual(MCP_MANIFEST.api);
    expect(apiCopy).not.toBe(MCP_MANIFEST.api);
    authCopy.type = 'api_key';
    expect(MCP_MANIFEST.auth.type).toBe('none');
  });

  it('structuredClone then JSON.stringify equals live stringify', () => {
    expect(JSON.stringify(structuredClone(MCP_MANIFEST))).toBe(JSON.stringify(MCP_MANIFEST));
  });

  it('locks tool description first-word vocabulary Set', () => {
    const firstWords = MCP_MANIFEST.tools.map((t) => t.description.split(/\s+/)[0]);
    expect(firstWords).toEqual(['Set', 'Get', 'Return', 'Ask']);
    expect(new Set(firstWords).size).toBe(4);
  });

  it('locks property description first-word vocabulary Set', () => {
    const firstWords = MCP_MANIFEST.tools.flatMap((t) =>
      Object.values(t.input_schema.properties).map(
        (p) => (p as { description: string }).description.split(/\s+/)[0],
      ),
    );
    expect(firstWords).toEqual(['Partial', 'Genre', 'Describe', 'Optional']);
  });

  it('now_playing description mentions name genre stream URL and country', () => {
    const d = toolNamed('now_playing').description.toLowerCase();
    expect(d).toContain('name');
    expect(d).toContain('genre');
    expect(d).toContain('stream url');
    expect(d).toContain('country');
  });

  it('station_select description mentions currently playing and name', () => {
    const d = toolNamed('station_select').description.toLowerCase();
    expect(d).toContain('currently playing');
    expect(d).toContain('name');
  });

  it('genre_filter description parenthetical examples stay jazz news classical order', () => {
    const d = toolNamed('genre_filter').description;
    const jazz = d.indexOf('jazz');
    const news = d.indexOf('news');
    const classical = d.indexOf('classical');
    expect(jazz).toBeGreaterThan(-1);
    expect(news).toBeGreaterThan(jazz);
    expect(classical).toBeGreaterThan(news);
  });

  it('curator_prompt mood examples stay focus work → late night jazz → morning energy', () => {
    const d = toolNamed('curator_prompt').input_schema.properties.mood!.description;
    const a = d.indexOf('focus work');
    const b = d.indexOf('late night jazz');
    const c = d.indexOf('morning energy');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('does not declare output_schema or returns on any tool', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('output_schema');
      expect(tool).not.toHaveProperty('returns');
      expect(tool).not.toHaveProperty('annotations');
      expect(tool).not.toHaveProperty('strict');
    }
  });

  it('input_schema.properties values are plain objects with prototype Object.prototype', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(Object.getPrototypeOf(prop)).toBe(Object.prototype);
        expect(Object.keys(prop).sort()).toEqual(['description', 'type']);
      }
    }
  });

  it('property objects own exactly type then description in insertion order', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(Object.keys(prop)).toEqual(['type', 'description']);
        const s = JSON.stringify(prop);
        expect(s.indexOf('"type"')).toBeLessThan(s.indexOf('"description"'));
      }
    }
  });

  it('ArrayBuffer / Uint8Array view of tools JSON is ASCII-only', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(MCP_MANIFEST.tools));
    expect(bytes.every((b) => b < 128)).toBe(true);
    expect(bytes[0]).toBe(0x5b); // [
    expect(bytes[bytes.length - 1]).toBe(0x5d); // ]
  });

  it('tools.flatMap of property keys preserves cross-tool multiplicity', () => {
    expect(MCP_MANIFEST.tools.flatMap((t) => Object.keys(t.input_schema.properties))).toEqual([
      'station_name',
      'genre',
      'mood',
      'genre',
    ]);
  });

  it('Object.fromEntries of tool name→description is four unique entries', () => {
    const map = Object.fromEntries(MCP_MANIFEST.tools.map((t) => [t.name, t.description]));
    expect(Object.keys(map)).toHaveLength(4);
    expect(map.now_playing).toMatch(/stream URL/i);
    expect(map.curator_prompt).toMatch(/mood/i);
  });

  it('does not use non-ASCII punctuation in descriptions (no em-dash curly quotes)', () => {
    const blobs = [
      MCP_MANIFEST.description_for_model,
      MCP_MANIFEST.description_for_human,
      ...MCP_MANIFEST.tools.map((t) => t.description),
      ...MCP_MANIFEST.tools.flatMap((t) =>
        Object.values(t.input_schema.properties).map((p) => (p as { description: string }).description),
      ),
    ].join('');
    expect(blobs).not.toMatch(/[\u2013\u2014\u2018\u2019\u201C\u201D]/);
    expect([...blobs].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it('name_for_model lowercases to itself and uppercases to BACKLINK', () => {
    expect(MCP_MANIFEST.name_for_model.toLowerCase()).toBe('backlink');
    expect(MCP_MANIFEST.name_for_model.toUpperCase()).toBe('BACKLINK');
    expect(MCP_MANIFEST.name_for_model).toBe(MCP_MANIFEST.name_for_model.toLowerCase());
  });

  it('tools index access via bracket and at() stay synchronized', () => {
    for (let i = 0; i < MCP_MANIFEST.tools.length; i++) {
      expect(MCP_MANIFEST.tools[i]).toBe(MCP_MANIFEST.tools.at(i));
      expect(MCP_MANIFEST.tools[i].name).toBe(MCP_MANIFEST.tools.at(i)?.name);
    }
  });

  it('JSON.parse of tools-only stringify round-trips without auth/api leakage', () => {
    const toolsOnly = JSON.parse(JSON.stringify(MCP_MANIFEST.tools));
    expect(toolsOnly).toHaveLength(4);
    expect(JSON.stringify(toolsOnly)).not.toContain('schema_version');
    expect(JSON.stringify(toolsOnly)).not.toContain('openapi');
  });

  it('locks cumulative required+properties key counts per tool', () => {
    const summary = Object.fromEntries(
      MCP_MANIFEST.tools.map((t) => [
        t.name,
        {
          props: Object.keys(t.input_schema.properties).length,
          required: t.input_schema.required?.length ?? 0,
        },
      ]),
    );
    expect(summary).toEqual({
      station_select: { props: 1, required: 1 },
      now_playing: { props: 0, required: 0 },
      genre_filter: { props: 1, required: 1 },
      curator_prompt: { props: 2, required: 1 },
    });
  });

  it('Symbol.iterator on tools yields the same four tool object identities', () => {
    const viaIterator = [...MCP_MANIFEST.tools[Symbol.iterator]()];
    expect(viaIterator).toHaveLength(4);
    expect(viaIterator[0]).toBe(MCP_MANIFEST.tools[0]);
    expect(viaIterator[3]).toBe(MCP_MANIFEST.tools[3]);
  });

  it('Object.prototype.hasOwn confirms locked keys and rejects strangers', () => {
    expect(Object.hasOwn(MCP_MANIFEST, 'tools')).toBe(true);
    expect(Object.hasOwn(MCP_MANIFEST, 'toString')).toBe(false);
    expect(Object.hasOwn(MCP_MANIFEST.auth, 'type')).toBe(true);
    expect(Object.hasOwn(MCP_MANIFEST.api, 'url')).toBe(true);
    expect(Object.hasOwn(toolNamed('now_playing').input_schema, 'required')).toBe(false);
  });

  it('mutating a shallow-copied tools array element slot does not rebind live slot', () => {
    const shallow = MCP_MANIFEST.tools.slice();
    shallow[1] = {
      name: 'impostor',
      description: 'nope',
      input_schema: { type: 'object', properties: {} },
    };
    expect(MCP_MANIFEST.tools[1].name).toBe('now_playing');
    expect(shallow[1].name).toBe('impostor');
    expect(shallow[0]).toBe(MCP_MANIFEST.tools[0]);
  });

  it('deep property mutation on shared shallow copy aliases until structuredClone', () => {
    const shallowTool = { ...MCP_MANIFEST.tools[0] };
    expect(shallowTool.input_schema).toBe(MCP_MANIFEST.tools[0].input_schema);
    const deep = structuredClone(MCP_MANIFEST.tools[0]);
    expect(deep.input_schema).not.toBe(MCP_MANIFEST.tools[0].input_schema);
    deep.input_schema.properties.station_name!.description = 'mutated';
    expect(MCP_MANIFEST.tools[0].input_schema.properties.station_name!.description).toBe(
      'Partial or full name of the station to select.',
    );
  });

  it('locks hyphen tokens in descriptions while tool names stay hyphen-free', () => {
    expect(MCP_MANIFEST.description_for_human).toContain('AI-curated');
    expect(MCP_MANIFEST.description_for_human).toContain('iptv-org');
    expect(MCP_MANIFEST.description_for_model).toContain('AI-curated');
    expect(MCP_MANIFEST.description_for_model).toContain('now-playing');
    expect(MCP_MANIFEST.description_for_model.match(/-/g)).toHaveLength(2);
    expect(MCP_MANIFEST.description_for_human.match(/-/g)).toHaveLength(2);
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).not.toContain('-');
    }
  });
  it('tools filter by required presence yields three tools excluding now_playing', () => {
    const withRequired = MCP_MANIFEST.tools.filter((t) => t.input_schema.required !== undefined);
    expect(withRequired.map((t) => t.name)).toEqual([
      'station_select',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('tools filter by empty properties yields only now_playing', () => {
    const emptyProps = MCP_MANIFEST.tools.filter(
      (t) => Object.keys(t.input_schema.properties).length === 0,
    );
    expect(emptyProps).toHaveLength(1);
    expect(emptyProps[0].name).toBe('now_playing');
  });

  it('encodeURIComponent of name_for_model and api.url stay unescaped ASCII', () => {
    expect(encodeURIComponent(MCP_MANIFEST.name_for_model)).toBe('backlink');
    expect(encodeURIComponent(MCP_MANIFEST.api.url)).toBe('%2Fopenapi.json');
    expect(decodeURIComponent(encodeURIComponent(MCP_MANIFEST.api.url))).toBe('/openapi.json');
  });

  it('btoa/atob round-trip of name_for_model and schema_version', () => {
    expect(atob(btoa(MCP_MANIFEST.name_for_model))).toBe('backlink');
    expect(atob(btoa(MCP_MANIFEST.schema_version))).toBe('v1');
    expect(btoa(MCP_MANIFEST.name_for_model)).toBe('YmFja2xpbms=');
  });

  it('locks toolNamed helper consistency with find and index access', () => {
    for (let i = 0; i < MCP_MANIFEST.tools.length; i++) {
      const name = MCP_MANIFEST.tools[i].name;
      expect(toolNamed(name)).toBe(MCP_MANIFEST.tools[i]);
      expect(toolNamed(name)).toBe(MCP_MANIFEST.tools.find((t) => t.name === name));
    }
  });

  it('does not declare content_types media_type or response_mime_type anywhere', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toMatch(/content_types|media_type|response_mime_type|application\/json/i);
  });

  it('description_for_model comma count and conjunction structure stay stable', () => {
    expect(MCP_MANIFEST.description_for_model.split(',').length - 1).toBe(4);
    expect(MCP_MANIFEST.description_for_model).toMatch(/Select stations, filter by genre,/);
  });
  it('human description catalog token is iptv-org with hyphen not underscore', () => {
    expect(MCP_MANIFEST.description_for_human).toContain('iptv-org');
    expect(MCP_MANIFEST.description_for_human).not.toContain('iptv_org');
    expect(MCP_MANIFEST.description_for_human).not.toContain('iptvorg');
  });

  it('Object.keys on JSON-parsed clone preserves insertion order for tools entries', () => {
    const round = JSON.parse(JSON.stringify(MCP_MANIFEST)) as typeof MCP_MANIFEST;
    for (let i = 0; i < round.tools.length; i++) {
      expect(Object.keys(round.tools[i])).toEqual(['name', 'description', 'input_schema']);
      expect(round.tools[i].name).toBe(MCP_MANIFEST.tools[i].name);
    }
  });

  it('nullish coalescing on now_playing.required defaults to empty without mutating', () => {
    const req = toolNamed('now_playing').input_schema.required ?? [];
    expect(req).toEqual([]);
    expect(toolNamed('now_playing').input_schema.required).toBeUndefined();
  });

  it('optional chaining on missing tool property yields undefined not throw', () => {
    expect(
      (toolNamed('now_playing').input_schema.properties as { station_name?: { type: string } })
        .station_name?.type,
    ).toBeUndefined();
    expect(toolNamed('curator_prompt').input_schema.properties.genre?.type).toBe('string');
  });

  it('locks String.prototype.codePointAt sequence for name_for_model backlink', () => {
    const cps = [...MCP_MANIFEST.name_for_model].map((c) => c.codePointAt(0));
    expect(cps).toEqual([98, 97, 99, 107, 108, 105, 110, 107]);
  });

  it('locks String.prototype.codePointAt for schema_version v1', () => {
    expect([...MCP_MANIFEST.schema_version].map((c) => c.charCodeAt(0))).toEqual([118, 49]);
  });

  it('tools entries are not frozen sealed or non-extensible individually', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.isFrozen(tool)).toBe(false);
      expect(Object.isSealed(tool)).toBe(false);
      expect(Object.isExtensible(tool)).toBe(true);
    }
  });

  it('auth and api objects are distinct identities from each other and tools', () => {
    expect(MCP_MANIFEST.auth).not.toBe(MCP_MANIFEST.api as unknown);
    expect(MCP_MANIFEST.auth).not.toBe(MCP_MANIFEST.tools as unknown);
    expect(MCP_MANIFEST.api).not.toBe(MCP_MANIFEST.tools as unknown);
  });

  it('JSON.stringify replacer whitelist of keys still emits tools array', () => {
    const filtered = JSON.stringify(MCP_MANIFEST, [
      'schema_version',
      'name_for_model',
      'tools',
      'name',
    ]);
    expect(filtered).toContain('"schema_version":"v1"');
    expect(filtered).toContain('"name_for_model":"backlink"');
    expect(filtered).toContain('station_select');
    expect(filtered).not.toContain('openapi');
  });

  it('padStart/padEnd on tool names does not appear in live names', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toBe(tool.name.trim());
      expect(tool.name.padStart(20).trim()).toBe(tool.name);
      expect(tool.name.includes(' ')).toBe(false);
    }
  });

  it('locks total number of own string properties across entire manifest tree', () => {
    let count = 0;
    const walk = (v: unknown): void => {
      if (v === null || typeof v !== 'object') return;
      if (Array.isArray(v)) {
        for (const item of v) walk(item);
        return;
      }
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        count += 1;
        void k;
        walk(val);
      }
    };
    walk(MCP_MANIFEST);
    expect(count).toBe(46);
  });

  it('locks recursive JSON key occurrence counts for name and type', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw.split('"name"').length - 1).toBe(4);
    // auth.type + api.type + 4 input_schema.type + 4 property.type
    expect(raw.split('"type"').length - 1).toBe(10);
    expect(raw.split('"description"').length - 1).toBe(8); // 4 tools + 4 props
  });
  it('does not embed null literals in JSON.stringify(MCP_MANIFEST)', () => {
    expect(JSON.stringify(MCP_MANIFEST)).not.toContain('null');
    expect(JSON.stringify(MCP_MANIFEST)).not.toContain('true');
    expect(JSON.stringify(MCP_MANIFEST)).not.toContain('false');
  });

  it('number literals are absent from JSON except none in this manifest', () => {
    expect(JSON.stringify(MCP_MANIFEST)).not.toMatch(/:\d/);
  });

  it('tools index replacement copy leaves live tools untouched', () => {
    const replaced = MCP_MANIFEST.tools.map((t, i) =>
      i === 0
        ? {
            name: 'x',
            description: 'y',
            input_schema: { type: 'object', properties: {} },
          }
        : t,
    );
    expect(replaced[0].name).toBe('x');
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
    expect(replaced).not.toBe(MCP_MANIFEST.tools);
  });

  it('tools reverse copy puts curator_prompt first without live mutation', () => {
    const reversed = [...MCP_MANIFEST.tools].reverse();
    expect(reversed[0].name).toBe('curator_prompt');
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
    expect(reversed.map((t) => t.name)).toEqual([
      'curator_prompt',
      'genre_filter',
      'now_playing',
      'station_select',
    ]);
  });

  it('tools splice-removal copy leaves live length 4', () => {
    const spliced = MCP_MANIFEST.tools.filter((_, i) => i !== 1);
    expect(spliced).toHaveLength(3);
    expect(spliced.map((t) => t.name)).toEqual([
      'station_select',
      'genre_filter',
      'curator_prompt',
    ]);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('locks exact UTF-16 length equals code point length for all ASCII strings', () => {
    const strings = [
      MCP_MANIFEST.schema_version,
      MCP_MANIFEST.name_for_model,
      MCP_MANIFEST.name_for_human,
      MCP_MANIFEST.description_for_model,
      MCP_MANIFEST.description_for_human,
      MCP_MANIFEST.api.url,
      MCP_MANIFEST.api.type,
      MCP_MANIFEST.auth.type,
      ...MCP_MANIFEST.tools.map((t) => t.name),
      ...MCP_MANIFEST.tools.map((t) => t.description),
    ];
    for (const s of strings) {
      expect(s.length).toBe([...s].length);
      expect(s.length).toBe(new TextEncoder().encode(s).length);
    }
  });

  it('RegExp ^$ full-match locks for name_for_model and schema_version', () => {
    expect(/^backlink$/.test(MCP_MANIFEST.name_for_model)).toBe(true);
    expect(/^v1$/.test(MCP_MANIFEST.schema_version)).toBe(true);
    expect(/^Backlink Radio$/.test(MCP_MANIFEST.name_for_human)).toBe(true);
    expect(/^\/openapi\.json$/.test(MCP_MANIFEST.api.url)).toBe(true);
  });

  it('does not declare openapi version field beside api.type openapi', () => {
    expect(MCP_MANIFEST.api).not.toHaveProperty('version');
    expect(MCP_MANIFEST.api).not.toHaveProperty('openapi');
    expect(MCP_MANIFEST.api.type).toBe('openapi');
  });

  it('auth type none is lowercase and not null/nil/anonymous aliases', () => {
    expect(MCP_MANIFEST.auth.type).toBe('none');
    expect(MCP_MANIFEST.auth.type).not.toBe('None');
    expect(MCP_MANIFEST.auth.type).not.toBe('null');
    expect(MCP_MANIFEST.auth.type).not.toBe('anonymous');
  });

  it('curator_prompt is the only tool whose description mentions AI curator', () => {
    const hits = MCP_MANIFEST.tools.filter((t) => /AI curator/i.test(t.description));
    expect(hits.map((t) => t.name)).toEqual(['curator_prompt']);
  });

  it('station_select is the only tool whose description mentions currently playing station by name', () => {
    const hits = MCP_MANIFEST.tools.filter((t) => /currently playing station by name/i.test(t.description));
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('station_select');
  });

  it('locks indexOf positions for key substrings in description_for_model', () => {
    const d = MCP_MANIFEST.description_for_model;
    expect(d.indexOf('Backlink')).toBe(14);
    expect(d.indexOf('IPTV')).toBe(38);
    expect(d.indexOf('AI curator')).toBe(126);
  });

  it('locks indexOf positions for key substrings in description_for_human', () => {
    const d = MCP_MANIFEST.description_for_human;
    expect(d.indexOf('AI-curated')).toBe(0);
    expect(d.indexOf('iptv-org')).toBe(31);
    expect(d.indexOf('catalog')).toBe(40);
  });

  // --- HEAVY burn (post-#53): mcp unit deepen (orthogonal to routes/helpers/genres/parser) ---

  it('locks exact JSON.stringify(MCP_MANIFEST) byte length 1534', () => {
    expect(JSON.stringify(MCP_MANIFEST).length).toBe(1534);
    expect(Buffer.byteLength(JSON.stringify(MCP_MANIFEST), 'utf8')).toBe(1534);
  });

  it('locks exact JSON.stringify(tools) byte length 1095', () => {
    expect(JSON.stringify(MCP_MANIFEST.tools).length).toBe(1095);
  });

  it('locks description_for_model length 173 and word count 29', () => {
    expect(MCP_MANIFEST.description_for_model.length).toBe(173);
    expect(MCP_MANIFEST.description_for_model.split(/\s+/)).toHaveLength(29);
  });

  it('locks description_for_human length 48 and word count 7', () => {
    expect(MCP_MANIFEST.description_for_human.length).toBe(48);
    expect(MCP_MANIFEST.description_for_human.split(/\s+/)).toHaveLength(7);
  });

  it('locks per-tool description lengths station 42 now 81 genre 81 curator 80', () => {
    expect(toolNamed('station_select').description.length).toBe(42);
    expect(toolNamed('now_playing').description.length).toBe(81);
    expect(toolNamed('genre_filter').description.length).toBe(81);
    expect(toolNamed('curator_prompt').description.length).toBe(80);
  });

  it('locks property description lengths station_name 46 genre 27 mood 88 curator.genre 42', () => {
    expect(toolNamed('station_select').input_schema.properties.station_name!.description.length).toBe(46);
    expect(toolNamed('genre_filter').input_schema.properties.genre!.description.length).toBe(27);
    expect(toolNamed('curator_prompt').input_schema.properties.mood!.description.length).toBe(88);
    expect(toolNamed('curator_prompt').input_schema.properties.genre!.description.length).toBe(42);
  });

  it('locks tool name lengths 14 11 12 14 with exactly one underscore each', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name.length)).toEqual([14, 11, 12, 14]);
    expect(MCP_MANIFEST.tools.map((t) => (t.name.match(/_/g) ?? []).length)).toEqual([1, 1, 1, 1]);
  });

  it('locks top-level key insertion order schema→names→descriptions→auth→api→tools', () => {
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

  it('Reflect.ownKeys on manifest matches Object.keys with no symbols', () => {
    expect(Reflect.ownKeys(MCP_MANIFEST)).toEqual(Object.keys(MCP_MANIFEST));
    expect(Object.getOwnPropertySymbols(MCP_MANIFEST)).toEqual([]);
  });

  it('Object.getOwnPropertyDescriptors marks all top-level keys writable enumerable configurable', () => {
    for (const key of Object.keys(MCP_MANIFEST)) {
      const d = Object.getOwnPropertyDescriptor(MCP_MANIFEST, key)!;
      expect(d.enumerable).toBe(true);
      expect(d.writable).toBe(true);
      expect(d.configurable).toBe(true);
      expect(d.get).toBeUndefined();
      expect(d.set).toBeUndefined();
    }
  });

  it('Proxy get trap still surfaces schema_version and tools length', () => {
    const proxied = new Proxy(MCP_MANIFEST, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(proxied.schema_version).toBe('v1');
    expect(proxied.tools).toHaveLength(4);
  });

  it('structuredClone then mutate tools[0].name leaves live station_select', () => {
    const clone = structuredClone(MCP_MANIFEST);
    clone.tools[0].name = 'mutated_select';
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
    expect(clone.tools[0].name).toBe('mutated_select');
  });

  it('JSON.parse(JSON.stringify) clone is deep-equal but not identity-equal', () => {
    const round = JSON.parse(JSON.stringify(MCP_MANIFEST)) as typeof MCP_MANIFEST;
    expect(round).toEqual(MCP_MANIFEST);
    expect(round).not.toBe(MCP_MANIFEST);
    expect(round.tools).not.toBe(MCP_MANIFEST.tools);
    expect(round.auth).not.toBe(MCP_MANIFEST.auth);
  });

  it('Map from tool name→input_schema.type is four object entries', () => {
    const m = new Map(MCP_MANIFEST.tools.map((t) => [t.name, t.input_schema.type]));
    expect(m.size).toBe(4);
    expect([...m.values()].every((v) => v === 'object')).toBe(true);
    expect(m.get('now_playing')).toBe('object');
  });

  it('Set of property description strings has size 4 (all unique)', () => {
    const descs = MCP_MANIFEST.tools.flatMap((t) =>
      Object.values(t.input_schema.properties).map((p) => (p as { description: string }).description),
    );
    expect(descs).toHaveLength(4);
    expect(new Set(descs).size).toBe(4);
  });

  it('WeakMap can key live tool objects without leaking into JSON', () => {
    const wm = new WeakMap<object, string>();
    for (const tool of MCP_MANIFEST.tools) wm.set(tool, tool.name);
    expect(wm.get(MCP_MANIFEST.tools[2])).toBe('genre_filter');
    expect(JSON.stringify(MCP_MANIFEST)).not.toContain('WeakMap');
  });

  it('Array.prototype.reduce builds name→requiredLength map', () => {
    const reduced = MCP_MANIFEST.tools.reduce(
      (acc, t) => {
        acc[t.name] = t.input_schema.required?.length ?? 0;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(reduced).toEqual({
      station_select: 1,
      now_playing: 0,
      genre_filter: 1,
      curator_prompt: 1,
    });
  });

  it('tools sorted by name length then alpha locks order', () => {
    const sorted = [...MCP_MANIFEST.tools].sort((a, b) =>
      a.name.length === b.name.length ? a.name.localeCompare(b.name) : a.name.length - b.name.length,
    );
    expect(sorted.map((t) => t.name)).toEqual([
      'now_playing',
      'genre_filter',
      'curator_prompt',
      'station_select',
    ]);
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('tools reversed copy is curator→genre→now→station without live mutation', () => {
    expect([...MCP_MANIFEST.tools].reverse().map((t) => t.name)).toEqual([
      'curator_prompt',
      'genre_filter',
      'now_playing',
      'station_select',
    ]);
    expect(MCP_MANIFEST.tools.map((t) => t.name)[0]).toBe('station_select');
  });

  it('localeCompare of consecutive tool names is ascending snake_case alpha', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    const alpha = [...names].sort((a, b) => a.localeCompare(b));
    expect(alpha).toEqual(['curator_prompt', 'genre_filter', 'now_playing', 'station_select']);
  });

  it('does not declare servers resources prompts or $schema on manifest', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('servers');
    expect(MCP_MANIFEST).not.toHaveProperty('resources');
    expect(MCP_MANIFEST).not.toHaveProperty('prompts');
    expect(MCP_MANIFEST).not.toHaveProperty('$schema');
    expect(MCP_MANIFEST).not.toHaveProperty('version');
  });

  it('does not declare id title examples default or enum on any property', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(prop).not.toHaveProperty('id');
        expect(prop).not.toHaveProperty('title');
        expect(prop).not.toHaveProperty('examples');
        expect(prop).not.toHaveProperty('default');
        expect(prop).not.toHaveProperty('enum');
        expect(prop).not.toHaveProperty('minLength');
      }
    }
  });

  it('input_schema never declares additionalProperties or $defs', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema).not.toHaveProperty('additionalProperties');
      expect(tool.input_schema).not.toHaveProperty('$defs');
      expect(tool.input_schema).not.toHaveProperty('definitions');
      expect(tool.input_schema).not.toHaveProperty('oneOf');
    }
  });

  it('locks snake_case property keys only — no camelCase stationName moodGenre', () => {
    const keys = MCP_MANIFEST.tools.flatMap((t) => Object.keys(t.input_schema.properties));
    expect(keys.every((k) => /^[a-z]+(_[a-z]+)*$/.test(k))).toBe(true);
    expect(keys).not.toContain('stationName');
    expect(keys).not.toContain('moodGenre');
  });

  it('genre appears as property key on exactly genre_filter and curator_prompt', () => {
    const withGenre = MCP_MANIFEST.tools.filter((t) => 'genre' in t.input_schema.properties);
    expect(withGenre.map((t) => t.name)).toEqual(['genre_filter', 'curator_prompt']);
  });

  it('mood appears as property key on curator_prompt only', () => {
    const withMood = MCP_MANIFEST.tools.filter((t) => 'mood' in t.input_schema.properties);
    expect(withMood.map((t) => t.name)).toEqual(['curator_prompt']);
  });

  it('station_name appears as property key on station_select only', () => {
    const withStation = MCP_MANIFEST.tools.filter((t) => 'station_name' in t.input_schema.properties);
    expect(withStation.map((t) => t.name)).toEqual(['station_select']);
  });

  it('locks description_for_model verb sequence Select filter get ask', () => {
    const d = MCP_MANIFEST.description_for_model.toLowerCase();
    const select = d.indexOf('select stations');
    const filter = d.indexOf('filter by genre');
    const get = d.indexOf('get now-playing');
    const ask = d.indexOf('ask the ai curator');
    expect(select).toBeGreaterThan(-1);
    expect(filter).toBeGreaterThan(select);
    expect(get).toBeGreaterThan(filter);
    expect(ask).toBeGreaterThan(get);
  });

  it('locks name_for_human space-separated Backlink Radio title case', () => {
    expect(MCP_MANIFEST.name_for_human.split(' ')).toEqual(['Backlink', 'Radio']);
    expect(MCP_MANIFEST.name_for_human).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('api.url is absolute-path openapi.json under root not https', () => {
    expect(MCP_MANIFEST.api.url.startsWith('/')).toBe(true);
    expect(MCP_MANIFEST.api.url).not.toMatch(/^https?:/i);
    expect(MCP_MANIFEST.api.url.endsWith('.json')).toBe(true);
  });

  it('auth object own keys are exactly ["type"]', () => {
    expect(Object.keys(MCP_MANIFEST.auth)).toEqual(['type']);
  });

  it('api object own keys are exactly ["type","url"] in that order', () => {
    expect(Object.keys(MCP_MANIFEST.api)).toEqual(['type', 'url']);
  });

  it('TextEncoder encode of name_for_model is 8 bytes backlink', () => {
    const bytes = new TextEncoder().encode(MCP_MANIFEST.name_for_model);
    expect(Array.from(bytes)).toEqual([98, 97, 99, 107, 108, 105, 110, 107]);
  });

  it('TextDecoder round-trip of tools JSON preserves parse equality', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(MCP_MANIFEST.tools));
    const decoded = new TextDecoder().decode(bytes);
    expect(JSON.parse(decoded)).toEqual(MCP_MANIFEST.tools);
  });

  it('locks lastIndexOf underscore positions in tool names', () => {
    expect(toolNamed('station_select').name.lastIndexOf('_')).toBe(7);
    expect(toolNamed('now_playing').name.lastIndexOf('_')).toBe(3);
    expect(toolNamed('genre_filter').name.lastIndexOf('_')).toBe(5);
    expect(toolNamed('curator_prompt').name.lastIndexOf('_')).toBe(7);
  });

  it('split tool names on underscore yields verb_noun pairs', () => {
    expect(toolNamed('station_select').name.split('_')).toEqual(['station', 'select']);
    expect(toolNamed('now_playing').name.split('_')).toEqual(['now', 'playing']);
    expect(toolNamed('genre_filter').name.split('_')).toEqual(['genre', 'filter']);
    expect(toolNamed('curator_prompt').name.split('_')).toEqual(['curator', 'prompt']);
  });

  it('startsWith/endsWith locks for each tool name token', () => {
    expect(toolNamed('station_select').name.startsWith('station')).toBe(true);
    expect(toolNamed('station_select').name.endsWith('select')).toBe(true);
    expect(toolNamed('now_playing').name.startsWith('now')).toBe(true);
    expect(toolNamed('genre_filter').name.endsWith('filter')).toBe(true);
    expect(toolNamed('curator_prompt').name.startsWith('curator')).toBe(true);
  });

  it('replaceAll underscore→hyphen produces kebab ids unused by live names', () => {
    const kebab = MCP_MANIFEST.tools.map((t) => t.name.replaceAll('_', '-'));
    expect(kebab).toEqual([
      'station-select',
      'now-playing',
      'genre-filter',
      'curator-prompt',
    ]);
    for (const t of MCP_MANIFEST.tools) expect(t.name).not.toContain('-');
  });

  it('JSON.stringify space-2 pretty print still contains schema_version v1', () => {
    const pretty = JSON.stringify(MCP_MANIFEST, null, 2);
    expect(pretty).toContain('"schema_version": "v1"');
    expect(pretty.split('\n').length).toBeGreaterThan(40);
    expect(pretty.length).toBeGreaterThan(JSON.stringify(MCP_MANIFEST).length);
  });

  it('JSON.stringify replacer that drops tools yields auth/api without tools', () => {
    const filtered = JSON.stringify(MCP_MANIFEST, (key, value) => (key === 'tools' ? undefined : value));
    expect(filtered).toContain('"auth"');
    expect(filtered).toContain('"api"');
    expect(filtered).not.toContain('station_select');
  });

  it('Object.entries(tools) indices are 0..3 string keys', () => {
    expect(Object.entries(MCP_MANIFEST.tools).map(([k]) => k)).toEqual(['0', '1', '2', '3']);
  });

  it('Array.isArray(tools) true while auth/api are non-arrays', () => {
    expect(Array.isArray(MCP_MANIFEST.tools)).toBe(true);
    expect(Array.isArray(MCP_MANIFEST.auth)).toBe(false);
    expect(Array.isArray(MCP_MANIFEST.api)).toBe(false);
  });

  it('typeof checks lock string/object/object across top-level fields', () => {
    expect(typeof MCP_MANIFEST.schema_version).toBe('string');
    expect(typeof MCP_MANIFEST.name_for_model).toBe('string');
    expect(typeof MCP_MANIFEST.auth).toBe('object');
    expect(typeof MCP_MANIFEST.api).toBe('object');
    expect(typeof MCP_MANIFEST.tools).toBe('object');
  });

  it('freeze of a clone does not freeze the live manifest', () => {
    const clone = structuredClone(MCP_MANIFEST);
    Object.freeze(clone);
    expect(Object.isFrozen(clone)).toBe(true);
    expect(Object.isFrozen(MCP_MANIFEST)).toBe(false);
    expect(Object.isExtensible(MCP_MANIFEST)).toBe(true);
  });

  it('seal of a clone does not seal live tools array', () => {
    const clone = structuredClone(MCP_MANIFEST);
    Object.seal(clone.tools);
    expect(Object.isSealed(clone.tools)).toBe(true);
    expect(Object.isSealed(MCP_MANIFEST.tools)).toBe(false);
  });

  it('locks cumulative character class counts in name_for_model', () => {
    const n = MCP_MANIFEST.name_for_model;
    expect([...n].filter((c) => /[a-z]/.test(c))).toHaveLength(8);
    expect([...n].filter((c) => /[A-Z]/.test(c))).toHaveLength(0);
    expect([...n].filter((c) => /\d/.test(c))).toHaveLength(0);
  });

  it('locks name_for_human Title Case with single space no punctuation', () => {
    expect(MCP_MANIFEST.name_for_human).not.toMatch(/[.,!?;:]/);
    expect(MCP_MANIFEST.name_for_human).not.toMatch(/\s{2,}/);
    expect((MCP_MANIFEST.name_for_human.match(/ /g) ?? []).length).toBe(1);
  });

  it('description_for_model ends with period and human ends with period', () => {
    expect(MCP_MANIFEST.description_for_model.endsWith('.')).toBe(true);
    expect(MCP_MANIFEST.description_for_human.endsWith('.')).toBe(true);
  });

  it('tool descriptions end with period like property descriptions', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.endsWith('.')).toBe(true);
      expect(tool.description.endsWith('!')).toBe(false);
      expect(tool.description.endsWith('?')).toBe(false);
    }
  });

  it('property descriptions end with period for all four props', () => {
    const descs = MCP_MANIFEST.tools.flatMap((t) =>
      Object.values(t.input_schema.properties).map((p) => (p as { description: string }).description),
    );
    expect(descs.every((d) => d.endsWith('.'))).toBe(true);
  });

  it('locks required arrays as own arrays not shared identity across tools', () => {
    const reqs = MCP_MANIFEST.tools
      .map((t) => t.input_schema.required)
      .filter((r): r is string[] => Array.isArray(r));
    expect(reqs).toHaveLength(3);
    expect(reqs[0]).not.toBe(reqs[1]);
    expect(reqs[1]).not.toBe(reqs[2]);
  });

  it('now_playing is the only tool without required and without properties entries', () => {
    const empty = MCP_MANIFEST.tools.filter(
      (t) => !t.input_schema.required && Object.keys(t.input_schema.properties).length === 0,
    );
    expect(empty.map((t) => t.name)).toEqual(['now_playing']);
  });

  it('curator_prompt is the only tool with two properties', () => {
    const two = MCP_MANIFEST.tools.filter((t) => Object.keys(t.input_schema.properties).length === 2);
    expect(two.map((t) => t.name)).toEqual(['curator_prompt']);
  });

  it('locks findLastIndex of tool whose name includes prompt', () => {
    const idx = [...MCP_MANIFEST.tools]
      .map((t, i) => ({ t, i }))
      .reverse()
      .find(({ t }) => t.name.includes('prompt'))?.i;
    expect(idx).toBe(3);
    expect(
      [...MCP_MANIFEST.tools]
        .map((t, i) => ({ t, i }))
        .reverse()
        .find(({ t }) => t.name.includes('missing')),
    ).toBeUndefined();
  });

  it('locks findIndex positions for each tool name', () => {
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'station_select')).toBe(0);
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'now_playing')).toBe(1);
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'genre_filter')).toBe(2);
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'curator_prompt')).toBe(3);
  });

  it('with / without on a clone does not alter live tools', () => {
    const withExtra = [
      ...MCP_MANIFEST.tools,
      {
        name: 'extra_tool',
        description: 'should not leak',
        input_schema: { type: 'object' as const, properties: {} },
      },
    ];
    expect(withExtra).toHaveLength(5);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect(MCP_MANIFEST.tools.map((t) => t.name)).not.toContain('extra_tool');
  });

  it('Object.fromEntries Object.entries round-trip equals for auth and api', () => {
    expect(Object.fromEntries(Object.entries(MCP_MANIFEST.auth))).toEqual(MCP_MANIFEST.auth);
    expect(Object.fromEntries(Object.entries(MCP_MANIFEST.api))).toEqual(MCP_MANIFEST.api);
  });

  it('locks regex full-match for each tool name', () => {
    expect(/^station_select$/.test(toolNamed('station_select').name)).toBe(true);
    expect(/^now_playing$/.test(toolNamed('now_playing').name)).toBe(true);
    expect(/^genre_filter$/.test(toolNamed('genre_filter').name)).toBe(true);
    expect(/^curator_prompt$/.test(toolNamed('curator_prompt').name)).toBe(true);
  });

  it('does not embed mailto http https or file schemes in any description', () => {
    const blob = [
      MCP_MANIFEST.description_for_model,
      MCP_MANIFEST.description_for_human,
      ...MCP_MANIFEST.tools.map((t) => t.description),
      ...MCP_MANIFEST.tools.flatMap((t) =>
        Object.values(t.input_schema.properties).map((p) => (p as { description: string }).description),
      ),
    ].join('\n');
    expect(blob).not.toMatch(/https?:\/\//i);
    expect(blob).not.toMatch(/mailto:/i);
    expect(blob).not.toMatch(/file:\/\//i);
  });

  it('locks IPTV acronym uppercase only in description_for_model not human', () => {
    expect(MCP_MANIFEST.description_for_model).toContain('IPTV');
    expect(MCP_MANIFEST.description_for_human).not.toContain('IPTV');
    expect(MCP_MANIFEST.description_for_human).toContain('iptv-org');
  });

  it('locks radio token in model description human description and name_for_human', () => {
    expect(MCP_MANIFEST.description_for_model.toLowerCase()).toContain('radio');
    expect(MCP_MANIFEST.description_for_human.toLowerCase()).toContain('radio');
    expect(MCP_MANIFEST.name_for_human.toLowerCase()).toContain('radio');
  });

  it('values(tools).map name join with comma is stable CSV', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name).join(',')).toBe(
      'station_select,now_playing,genre_filter,curator_prompt',
    );
  });

  it('Number.isNaN / parseInt on schema_version suffix is 1', () => {
    expect(Number.parseInt(MCP_MANIFEST.schema_version.slice(1), 10)).toBe(1);
    expect(Number.isNaN(Number(MCP_MANIFEST.schema_version))).toBe(true);
  });

  it('locale lowercase en-US of name_for_human is backlink radio', () => {
    expect(MCP_MANIFEST.name_for_human.toLocaleLowerCase('en-US')).toBe('backlink radio');
  });

  it('trimStart/trimEnd are no-ops on all locked strings', () => {
    const strings = [
      MCP_MANIFEST.schema_version,
      MCP_MANIFEST.name_for_model,
      MCP_MANIFEST.name_for_human,
      MCP_MANIFEST.description_for_model,
      MCP_MANIFEST.description_for_human,
      ...MCP_MANIFEST.tools.map((t) => t.name),
      ...MCP_MANIFEST.tools.map((t) => t.description),
    ];
    for (const s of strings) {
      expect(s.trimStart()).toBe(s);
      expect(s.trimEnd()).toBe(s);
      expect(s.trim()).toBe(s);
    }
  });

  it('locks charAt 0 for schema v name b Backlink B descriptions I/A', () => {
    expect(MCP_MANIFEST.schema_version.charAt(0)).toBe('v');
    expect(MCP_MANIFEST.name_for_model.charAt(0)).toBe('b');
    expect(MCP_MANIFEST.name_for_human.charAt(0)).toBe('B');
    expect(MCP_MANIFEST.description_for_model.charAt(0)).toBe('I');
    expect(MCP_MANIFEST.description_for_human.charAt(0)).toBe('A');
  });

  it('slice(0,0) empty and slice() full copy for name_for_model', () => {
    expect(MCP_MANIFEST.name_for_model.slice(0, 0)).toBe('');
    expect(MCP_MANIFEST.name_for_model.slice()).toBe('backlink');
    expect(MCP_MANIFEST.name_for_model.slice(0, 4)).toBe('back');
    expect(MCP_MANIFEST.name_for_model.slice(-4)).toBe('link');
  });

  it('repeat of schema_version does not appear in live string', () => {
    expect(MCP_MANIFEST.schema_version).not.toBe(MCP_MANIFEST.schema_version.repeat(2));
    expect(MCP_MANIFEST.schema_version.repeat(2)).toBe('v1v1');
  });

  it('tools.every name matches /^[a-z]+_[a-z]+$/', () => {
    expect(MCP_MANIFEST.tools.every((t) => /^[a-z]+_[a-z]+$/.test(t.name))).toBe(true);
  });

  it('does not declare claw or mcp in tool names', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).not.toMatch(/claw|mcp|backlink/i);
    }
  });

  it('description_for_model mentions Backlink once and IPTV once', () => {
    expect((MCP_MANIFEST.description_for_model.match(/Backlink/g) ?? []).length).toBe(1);
    expect((MCP_MANIFEST.description_for_model.match(/IPTV/g) ?? []).length).toBe(1);
  });

  it('locks Object.is comparisons for string interned literals', () => {
    expect(Object.is(MCP_MANIFEST.schema_version, 'v1')).toBe(true);
    expect(Object.is(MCP_MANIFEST.auth.type, 'none')).toBe(true);
    expect(Object.is(MCP_MANIFEST.api.type, 'openapi')).toBe(true);
  });

  it('Array.prototype.keys on tools yields 0 1 2 3', () => {
    expect([...MCP_MANIFEST.tools.keys()]).toEqual([0, 1, 2, 3]);
  });

  it('Array.prototype.values identities match bracket access', () => {
    const values = [...MCP_MANIFEST.tools.values()];
    expect(values[0]).toBe(MCP_MANIFEST.tools[0]);
    expect(values[3]).toBe(MCP_MANIFEST.tools[3]);
  });

  it('Array.prototype.entries tuples stay [i, tool] synchronized', () => {
    for (const [i, tool] of MCP_MANIFEST.tools.entries()) {
      expect(tool).toBe(MCP_MANIFEST.tools[i]);
      expect(tool.name).toBe(MCP_MANIFEST.tools[i].name);
    }
  });

  it('locks exact station_select description string', () => {
    expect(toolNamed('station_select').description).toBe(
      'Set the currently playing station by name.',
    );
  });

  it('locks exact now_playing description string', () => {
    expect(toolNamed('now_playing').description).toBe(
      'Get the currently playing station including name, genre, stream URL, and country.',
    );
  });

  it('locks exact genre_filter description string', () => {
    expect(toolNamed('genre_filter').description).toBe(
      'Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).',
    );
  });

  it('locks exact curator_prompt description string', () => {
    expect(toolNamed('curator_prompt').description).toBe(
      'Ask the AI curator to pick and set the best station for a given mood or context.',
    );
  });

  it('locks exact description_for_model string', () => {
    expect(MCP_MANIFEST.description_for_model).toBe(
      'Interact with Backlink, an AI-curated IPTV radio service. Select stations, filter by genre, get now-playing info, and ask the AI curator to pick the best station for a mood.',
    );
  });

  it('locks exact description_for_human string', () => {
    expect(MCP_MANIFEST.description_for_human).toBe(
      'AI-curated live radio from the iptv-org catalog.',
    );
  });

  it('JSON.stringify auth and api fragments stay minimal', () => {
    expect(JSON.stringify(MCP_MANIFEST.auth)).toBe('{"type":"none"}');
    expect(JSON.stringify(MCP_MANIFEST.api)).toBe('{"type":"openapi","url":"/openapi.json"}');
  });

  it('does not use template-looking ${} sequences in any string field', () => {
    const raw = JSON.stringify(MCP_MANIFEST);
    expect(raw).not.toContain('${');
    expect(raw).not.toContain('#{');
  });

  it('locks total tools array length property descriptor value 4', () => {
    expect(MCP_MANIFEST.tools.length).toBe(4);
    expect('length' in MCP_MANIFEST.tools).toBe(true);
  });

  it('concat of tools with empty array returns new array equal to tools', () => {
    const concat = MCP_MANIFEST.tools.concat([]);
    expect(concat).toEqual(MCP_MANIFEST.tools);
    expect(concat).not.toBe(MCP_MANIFEST.tools);
  });

  it('flat(1) on tools is identity for already-flat tool list', () => {
    expect(MCP_MANIFEST.tools.flat()).toEqual(MCP_MANIFEST.tools);
    expect(MCP_MANIFEST.tools.flat(1)[0]).toBe(MCP_MANIFEST.tools[0]);
  });
});
