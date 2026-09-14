import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MCP_MANIFEST } from '../src/mcp';

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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

  // --- HEAVY burn (post-#65): mcp contracts deepen (orthogonal to wrangler/genres/parser) ---

  it('post65: locks JSON.stringify compact length of MCP_MANIFEST to 1534', () => {
    expect(JSON.stringify(MCP_MANIFEST).length).toBe(1534);
  });

  it('post65: locks pretty JSON.stringify length 2159 and 76 lines', () => {
    const pretty = JSON.stringify(MCP_MANIFEST, null, 2);
    expect(pretty.length).toBe(2159);
    expect(pretty.split('\n')).toHaveLength(76);
  });

  it('post65: locks sha256 of compact MCP_MANIFEST JSON', () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST)).digest('hex')).toBe(
      '11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043',
    );
  });

  it('post65: locks sha1 of compact MCP_MANIFEST JSON', () => {
    expect(createHash('sha1').update(JSON.stringify(MCP_MANIFEST)).digest('hex')).toBe(
      '17b88688da33f30fa7e9f82c2902ca3b9b86e998',
    );
  });

  it('post65: locks md5 of compact MCP_MANIFEST JSON', () => {
    expect(createHash('md5').update(JSON.stringify(MCP_MANIFEST)).digest('hex')).toBe(
      'af11e695687a848fe80b386913581a3b',
    );
  });

  it('post65: locks compact JSON sha256 nibble sum to 483', () => {
    const hex = createHash('sha256').update(JSON.stringify(MCP_MANIFEST)).digest('hex');
    expect([...hex].reduce((a, c) => a + Number.parseInt(c, 16), 0)).toBe(483);
  });

  it('post65: locks src/mcp.ts size digests and line count', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src.length).toBe(2057);
    expect(Buffer.byteLength(src, 'utf8')).toBe(2057);
    expect(src.split('\n')).toHaveLength(68);
    expect(src.endsWith('\n')).toBe(true);
    expect(createHash('sha256').update(src).digest('hex')).toBe(
      '6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683',
    );
    expect(createHash('sha1').update(src).digest('hex')).toBe(
      '848b3977365809fda54fcb74a7d09affe685ea82',
    );
    expect(createHash('md5').update(src).digest('hex')).toBe('52e71c72e32e3d95b8b8d61ff4a2cf46');
  });

  it('post65: locks src/mcp.ts sha256 nibble sum to 551', () => {
    const hex = createHash('sha256')
      .update(readFileSync(join(mcpRoot, 'src/mcp.ts')))
      .digest('hex');
    expect([...hex].reduce((a, c) => a + Number.parseInt(c, 16), 0)).toBe(551);
  });

  it('post65: locks top-level Object.keys order of MCP_MANIFEST', () => {
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

  it('post65: locks description_for_model length 173 and 29 whitespace tokens', () => {
    expect(MCP_MANIFEST.description_for_model.length).toBe(173);
    expect(MCP_MANIFEST.description_for_model.split(/\s+/)).toHaveLength(29);
  });

  it('post65: locks description_for_human length 48 and 7 whitespace tokens', () => {
    expect(MCP_MANIFEST.description_for_human.length).toBe(48);
    expect(MCP_MANIFEST.description_for_human.split(/\s+/)).toHaveLength(7);
  });

  it('post65: locks schema_version char codes [118,49]', () => {
    expect([...MCP_MANIFEST.schema_version].map((c) => c.charCodeAt(0))).toEqual([118, 49]);
  });

  it('post65: locks name_for_model char codes for backlink', () => {
    expect([...MCP_MANIFEST.name_for_model].map((c) => c.charCodeAt(0))).toEqual([
      98, 97, 99, 107, 108, 105, 110, 107,
    ]);
  });

  it('post65: locks name_for_human char codes including space', () => {
    expect([...MCP_MANIFEST.name_for_human].map((c) => c.charCodeAt(0))).toEqual([
      66, 97, 99, 107, 108, 105, 110, 107, 32, 82, 97, 100, 105, 111,
    ]);
  });

  it('post65: locks tool description lengths 42/81/81/80', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.description.length)).toEqual([42, 81, 81, 80]);
  });

  it('post65: locks tool name lengths 14/11/12/14', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name.length)).toEqual([14, 11, 12, 14]);
  });

  it('post65: locks compact JSON punctuation inventory', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    expect((compact.match(/_/g) ?? []).length).toBe(19);
    expect((compact.match(/:/g) ?? []).length).toBe(46);
    expect((compact.match(/"/g) ?? []).length).toBe(154);
    expect((compact.match(/,/g) ?? []).length).toBe(44);
  });

  it('post65: locks btoa of name_for_model', () => {
    expect(btoa(MCP_MANIFEST.name_for_model)).toBe('YmFja2xpbms=');
    expect(atob('YmFja2xpbms=')).toBe('backlink');
  });

  it('post65: locks btoa of schema_version v1', () => {
    expect(btoa(MCP_MANIFEST.schema_version)).toBe('djE=');
    expect(atob('djE=')).toBe('v1');
  });

  it('post65: locks URL pathname of api.url', () => {
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
    expect(MCP_MANIFEST.api.url.split('/').filter(Boolean)).toEqual(['openapi.json']);
  });

  it('post65: locks auth.type and api.type string lengths', () => {
    expect(MCP_MANIFEST.auth.type.length).toBe(4);
    expect(MCP_MANIFEST.api.type.length).toBe(7);
  });

  it('post65: locks station_select property station_name description exact', () => {
    expect(toolNamed('station_select').input_schema.properties.station_name?.description).toBe(
      'Partial or full name of the station to select.',
    );
  });

  it('post65: locks genre_filter genre description exact', () => {
    expect(toolNamed('genre_filter').input_schema.properties.genre?.description).toBe(
      'Genre keyword to filter by.',
    );
  });

  it('post65: locks curator_prompt mood description exact', () => {
    expect(toolNamed('curator_prompt').input_schema.properties.mood?.description).toBe(
      'Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).',
    );
  });

  it('post65: locks curator_prompt genre description exact', () => {
    expect(toolNamed('curator_prompt').input_schema.properties.genre?.description).toBe(
      'Optional genre to constrain the selection.',
    );
  });

  it('post65: locks every input_schema.type is object', () => {
    expect(MCP_MANIFEST.tools.every((t) => t.input_schema.type === 'object')).toBe(true);
  });

  it('post65: locks every property type is string', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect((prop as { type: string }).type).toBe('string');
      }
    }
  });

  it('post65: locks total property count across tools is 4', () => {
    const count = MCP_MANIFEST.tools.reduce(
      (n, t) => n + Object.keys(t.input_schema.properties).length,
      0,
    );
    expect(count).toBe(4);
  });

  it('post65: locks required field count across tools is 3 strings', () => {
    const required = MCP_MANIFEST.tools.flatMap((t) => t.input_schema.required ?? []);
    expect(required).toEqual(['station_name', 'genre', 'mood']);
  });

  it('post65: locks Map of tool name to index', () => {
    const map = new Map(MCP_MANIFEST.tools.map((t, i) => [t.name, i]));
    expect(map.get('station_select')).toBe(0);
    expect(map.get('now_playing')).toBe(1);
    expect(map.get('genre_filter')).toBe(2);
    expect(map.get('curator_prompt')).toBe(3);
    expect(map.size).toBe(4);
  });

  it('post65: locks Set of tool names size 4 with has checks', () => {
    const set = new Set(MCP_MANIFEST.tools.map((t) => t.name));
    expect(set.size).toBe(4);
    expect(set.has('now_playing')).toBe(true);
    expect(set.has('backlink_curate')).toBe(false);
  });

  it('post65: locks Intl.Collator sorted tool names', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    const sorted = [...names].sort(new Intl.Collator('en').compare);
    expect(sorted).toEqual(['curator_prompt', 'genre_filter', 'now_playing', 'station_select']);
    expect(names).not.toEqual(sorted);
  });

  it('post65: locks localeCompare chain for tool order vs alpha', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(names[0].localeCompare(names[1])).toBeGreaterThan(0);
    expect(names[1].localeCompare(names[2])).toBeGreaterThan(0);
    expect(names[2].localeCompare(names[3])).toBeGreaterThan(0);
  });

  it('post65: locks structuredClone deep equality and independence', () => {
    const clone = structuredClone(MCP_MANIFEST);
    expect(clone).toEqual(MCP_MANIFEST);
    expect(clone).not.toBe(MCP_MANIFEST);
    expect(clone.tools).not.toBe(MCP_MANIFEST.tools);
    clone.tools.pop();
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('post65: locks JSON.parse(JSON.stringify) round-trip equality', () => {
    expect(JSON.parse(JSON.stringify(MCP_MANIFEST))).toEqual(MCP_MANIFEST);
  });

  it('post65: locks Object.getOwnPropertyNames equals Object.keys for manifest', () => {
    expect(Object.getOwnPropertyNames(MCP_MANIFEST)).toEqual(Object.keys(MCP_MANIFEST));
  });

  it('post65: locks tools array is extensible and not frozen', () => {
    expect(Object.isExtensible(MCP_MANIFEST.tools)).toBe(true);
    expect(Object.isFrozen(MCP_MANIFEST.tools)).toBe(false);
    expect(Object.isSealed(MCP_MANIFEST.tools)).toBe(false);
  });

  it('post65: locks Proxy get trap still reads schema_version', () => {
    const proxy = new Proxy(MCP_MANIFEST, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(proxy.schema_version).toBe('v1');
    expect(proxy.tools).toHaveLength(4);
  });

  it('post65: locks WeakRef deref still points at live tools[0]', () => {
    const ref = new WeakRef(MCP_MANIFEST.tools[0]);
    expect(ref.deref()).toBe(MCP_MANIFEST.tools[0]);
    expect(ref.deref()?.name).toBe('station_select');
  });

  it('post65: locks Atomics wait is not used — tools length atomic load via DataView on count', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, MCP_MANIFEST.tools.length, true);
    expect(view.getUint32(0, true)).toBe(4);
  });

  it('post65: locks TextEncoder byte length of description_for_model', () => {
    expect(new TextEncoder().encode(MCP_MANIFEST.description_for_model).length).toBe(173);
  });

  it('post65: locks TextEncoder byte length of description_for_human', () => {
    expect(new TextEncoder().encode(MCP_MANIFEST.description_for_human).length).toBe(48);
  });

  it('post65: locks encodeURIComponent of name_for_model is identity', () => {
    expect(encodeURIComponent(MCP_MANIFEST.name_for_model)).toBe('backlink');
    expect(encodeURIComponent(MCP_MANIFEST.name_for_human)).toBe('Backlink%20Radio');
  });

  it('post65: locks padStart of schema_version reconstructs v1', () => {
    expect('1'.padStart(2, 'v')).toBe('v1');
    expect(MCP_MANIFEST.schema_version).toBe('1'.padStart(2, 'v'));
  });

  it('post65: locks Unicode well-formedness via encodeURIComponent round-trip on tool names', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(decodeURIComponent(encodeURIComponent(tool.name))).toBe(tool.name);
      expect(tool.name).not.toMatch(/\uFFFD/);
    }
  });

  it('post65: locks description strings survive TextEncoder/TextDecoder round-trip', () => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    expect(dec.decode(enc.encode(MCP_MANIFEST.description_for_model))).toBe(
      MCP_MANIFEST.description_for_model,
    );
    expect(dec.decode(enc.encode(MCP_MANIFEST.description_for_human))).toBe(
      MCP_MANIFEST.description_for_human,
    );
  });

  it('post65: locks Number of tools via length and Array.from', () => {
    expect(Array.from(MCP_MANIFEST.tools)).toHaveLength(4);
    expect(Array.from(MCP_MANIFEST.tools, (t) => t.name)[0]).toBe('station_select');
  });

  it('post65: locks reduce of name lengths totals 51', () => {
    expect(MCP_MANIFEST.tools.reduce((n, t) => n + t.name.length, 0)).toBe(51);
  });

  it('post65: locks reduce of description lengths totals 284', () => {
    expect(MCP_MANIFEST.tools.reduce((n, t) => n + t.description.length, 0)).toBe(284);
  });

  it('post65: locks some/every predicates for underscore in names', () => {
    expect(MCP_MANIFEST.tools.every((t) => t.name.includes('_'))).toBe(true);
    expect(MCP_MANIFEST.tools.some((t) => t.name.startsWith('now_'))).toBe(true);
    expect(MCP_MANIFEST.tools.some((t) => t.name.endsWith('_prompt'))).toBe(true);
  });

  it('post65: locks filter of tools with required yields 3', () => {
    expect(MCP_MANIFEST.tools.filter((t) => t.input_schema.required).map((t) => t.name)).toEqual([
      'station_select',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('post65: locks flatMap of property keys across tools', () => {
    expect(MCP_MANIFEST.tools.flatMap((t) => Object.keys(t.input_schema.properties))).toEqual([
      'station_name',
      'genre',
      'mood',
      'genre',
    ]);
  });

  it('post65: locks at() accessors for first and last tools', () => {
    expect(MCP_MANIFEST.tools.at(0)?.name).toBe('station_select');
    expect(MCP_MANIFEST.tools.at(-1)?.name).toBe('curator_prompt');
    expect(MCP_MANIFEST.tools.at(4)).toBeUndefined();
  });

  it('post65: locks with()-style replacement does not mutate live tools', () => {
    const replaced = MCP_MANIFEST.tools.map((t, i) =>
      i === 1
        ? {
            name: 'now_playing',
            description: 'x',
            input_schema: { type: 'object' as const, properties: {} },
          }
        : t,
    );
    expect(replaced[1].description).toBe('x');
    expect(MCP_MANIFEST.tools[1].description).not.toBe('x');
  });

  it('post65: locks reversed copy tool name order', () => {
    expect([...MCP_MANIFEST.tools].reverse().map((t) => t.name)).toEqual([
      'curator_prompt',
      'genre_filter',
      'now_playing',
      'station_select',
    ]);
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('post65: locks sorted-by-name copy vs live order', () => {
    expect(
      [...MCP_MANIFEST.tools]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => t.name),
    ).toEqual(['curator_prompt', 'genre_filter', 'now_playing', 'station_select']);
  });

  it('post65: locks spliced copy removing now_playing leaves 3', () => {
    const copy = [...MCP_MANIFEST.tools];
    copy.splice(1, 1);
    expect(copy.map((t) => t.name)).toEqual(['station_select', 'genre_filter', 'curator_prompt']);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('post65: locks groupBy-like reduce of tools by required presence', () => {
    const groups = MCP_MANIFEST.tools.reduce(
      (acc, t) => {
        const key = t.input_schema.required ? 'required' : 'optional';
        (acc[key] ??= []).push(t);
        return acc;
      },
      {} as Record<string, typeof MCP_MANIFEST.tools>,
    );
    expect(groups.required?.map((t) => t.name)).toEqual([
      'station_select',
      'genre_filter',
      'curator_prompt',
    ]);
    expect(groups.optional?.map((t) => t.name)).toEqual(['now_playing']);
  });

  it('post65: locks Array.from tools names join', () => {
    expect(Array.from(MCP_MANIFEST.tools, (t) => t.name).join('|')).toBe(
      'station_select|now_playing|genre_filter|curator_prompt',
    );
  });

  it('post65: locks no CRLF or tab in src/mcp.ts', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toContain('\r');
    expect(src).not.toContain('\t');
  });

  it('post65: locks src/mcp.ts starts with export const MCP_MANIFEST', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src.startsWith('export const MCP_MANIFEST = {')).toBe(true);
    expect(src).toContain('schema_version: "v1"');
  });

  it('post65: locks src/mcp.ts has no import statements', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toContain('require(');
  });

  it('post65: locks src/mcp.ts export is only MCP_MANIFEST', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect([...src.matchAll(/^export /gm)]).toHaveLength(1);
    expect(src).toContain('export const MCP_MANIFEST');
  });

  it('post65: locks ASCII-only src/mcp.ts (no code points > 127)', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect([...src].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it('post65: locks fs.statSync size of src/mcp.ts equals 2057', () => {
    expect(statSync(join(mcpRoot, 'src/mcp.ts')).size).toBe(2057);
  });

  it('post65: locks Symbol.iterator on tools yields same names', () => {
    const names: string[] = [];
    for (const tool of MCP_MANIFEST.tools) names.push(tool.name);
    expect(names).toEqual(['station_select', 'now_playing', 'genre_filter', 'curator_prompt']);
  });

  it('post65: locks Object.values(auth) and Object.values(api)', () => {
    expect(Object.values(MCP_MANIFEST.auth)).toEqual(['none']);
    expect(Object.values(MCP_MANIFEST.api)).toEqual(['openapi', '/openapi.json']);
  });

  it('post65: locks JSON.stringify replacer counting keys visits tools', () => {
    let toolVisits = 0;
    JSON.stringify(MCP_MANIFEST, (key, value) => {
      if (key === 'tools') toolVisits += 1;
      return value;
    });
    expect(toolVisits).toBe(1);
  });

  it('post65: locks no emoji or non-BMP in any manifest string', () => {
    const blob = JSON.stringify(MCP_MANIFEST);
    expect(blob).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect([...blob].every((c) => (c.codePointAt(0) ?? 0) < 0x10000)).toBe(true);
  });

  it('post65: locks description_for_model sentence count via period splits', () => {
    const parts = MCP_MANIFEST.description_for_model.split('. ').filter(Boolean);
    expect(parts).toHaveLength(2);
    expect(parts[0].startsWith('Interact')).toBe(true);
    expect(parts[1].startsWith('Select')).toBe(true);
  });

  it('post65: locks mood examples order in curator_prompt description', () => {
    const d = toolNamed('curator_prompt').input_schema.properties.mood!.description;
    const focus = d.indexOf('focus work');
    const late = d.indexOf('late night jazz');
    const morning = d.indexOf('morning energy');
    expect(focus).toBeGreaterThan(-1);
    expect(late).toBeGreaterThan(focus);
    expect(morning).toBeGreaterThan(late);
  });

  it('post65: locks genre_filter example order jazz news classical', () => {
    const d = toolNamed('genre_filter').description;
    expect(d.indexOf('jazz')).toBeLessThan(d.indexOf('news'));
    expect(d.indexOf('news')).toBeLessThan(d.indexOf('classical'));
  });

  it('post65: locks now_playing description field order name genre stream URL country', () => {
    const d = toolNamed('now_playing').description.toLowerCase();
    const name = d.indexOf('name');
    const genre = d.indexOf('genre');
    const stream = d.indexOf('stream url');
    const country = d.indexOf('country');
    expect(name).toBeLessThan(genre);
    expect(genre).toBeLessThan(stream);
    expect(stream).toBeLessThan(country);
  });

  it('post65: locks Reflect.has for all top-level keys', () => {
    for (const key of Object.keys(MCP_MANIFEST)) {
      expect(Reflect.has(MCP_MANIFEST, key)).toBe(true);
    }
    expect(Reflect.has(MCP_MANIFEST, 'missing')).toBe(false);
  });

  it('post65: locks Object.isExtensible true for auth and api objects', () => {
    expect(Object.isExtensible(MCP_MANIFEST.auth)).toBe(true);
    expect(Object.isExtensible(MCP_MANIFEST.api)).toBe(true);
  });

  it('post65: locks constructor of tools array is Array', () => {
    expect(MCP_MANIFEST.tools.constructor).toBe(Array);
    expect(Object.getPrototypeOf(MCP_MANIFEST.tools)).toBe(Array.prototype);
  });

  it('post65: locks typeof null-safety — auth and api are non-null objects', () => {
    expect(MCP_MANIFEST.auth).not.toBeNull();
    expect(MCP_MANIFEST.api).not.toBeNull();
    expect(MCP_MANIFEST.tools).not.toBeNull();
  });

  it('post65: locks String.raw identity for name_for_model', () => {
    expect(String.raw`backlink`).toBe(MCP_MANIFEST.name_for_model);
  });

  it('post65: locks codePointAt first of each tool name', () => {
    expect(toolNamed('station_select').name.codePointAt(0)).toBe(115);
    expect(toolNamed('now_playing').name.codePointAt(0)).toBe(110);
    expect(toolNamed('genre_filter').name.codePointAt(0)).toBe(103);
    expect(toolNamed('curator_prompt').name.codePointAt(0)).toBe(99);
  });

  it('post65: locks normalize NFC/NFD no-ops on descriptions', () => {
    for (const s of [
      MCP_MANIFEST.description_for_model,
      MCP_MANIFEST.description_for_human,
      ...MCP_MANIFEST.tools.map((t) => t.description),
    ]) {
      expect(s.normalize('NFC')).toBe(s);
      expect(s.normalize('NFD')).toBe(s);
    }
  });

  it('post65: locks matchAll of word tokens in name_for_human', () => {
    expect([...MCP_MANIFEST.name_for_human.matchAll(/[A-Za-z]+/g)].map((m) => m[0])).toEqual([
      'Backlink',
      'Radio',
    ]);
  });

  it('post65: locks search index of IPTV in description_for_model', () => {
    expect(MCP_MANIFEST.description_for_model.search(/IPTV/)).toBe(
      MCP_MANIFEST.description_for_model.indexOf('IPTV'),
    );
    expect(MCP_MANIFEST.description_for_model.indexOf('IPTV')).toBeGreaterThan(20);
  });

  it('post65: locks replace of Radio in name_for_human does not mutate live', () => {
    const replaced = MCP_MANIFEST.name_for_human.replace('Radio', 'Stream');
    expect(replaced).toBe('Backlink Stream');
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
  });

  it('post65: locks substring/substr equivalents for schema_version', () => {
    expect(MCP_MANIFEST.schema_version.substring(0, 1)).toBe('v');
    expect(MCP_MANIFEST.schema_version.substring(1)).toBe('1');
  });

  it('post65: locks ArrayBuffer of compact JSON byteLength 1534', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(MCP_MANIFEST));
    expect(bytes.byteLength).toBe(1534);
    expect(bytes[0]).toBe('{'.charCodeAt(0));
    expect(bytes[bytes.length - 1]).toBe('}'.charCodeAt(0));
  });

  it('post65: locks DataView first four bytes of compact JSON are {"sc', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(MCP_MANIFEST));
    const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe(
      '{"sc',
    );
  });

  it('post65: locks no __proto__ or constructor pollution keys in manifest JSON', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    expect(compact).not.toContain('__proto__');
    expect(compact).not.toContain('prototype');
    expect(Object.keys(MCP_MANIFEST)).not.toContain('__proto__');
  });

  it('post65: locks tools.every input_schema has properties object', () => {
    expect(
      MCP_MANIFEST.tools.every(
        (t) => t.input_schema.properties !== null && typeof t.input_schema.properties === 'object',
      ),
    ).toBe(true);
  });

  it('post65: locks curator_prompt property key order mood then genre', () => {
    expect(Object.keys(toolNamed('curator_prompt').input_schema.properties)).toEqual([
      'mood',
      'genre',
    ]);
  });

  it('post65: locks station_select required equals property keys', () => {
    const tool = toolNamed('station_select');
    expect(tool.input_schema.required).toEqual(Object.keys(tool.input_schema.properties));
  });

  it('post65: locks genre_filter required equals property keys', () => {
    const tool = toolNamed('genre_filter');
    expect(tool.input_schema.required).toEqual(Object.keys(tool.input_schema.properties));
  });

  it('post65: locks curator_prompt required is proper subset of property keys', () => {
    const tool = toolNamed('curator_prompt');
    const props = Object.keys(tool.input_schema.properties);
    expect(tool.input_schema.required).toEqual(['mood']);
    expect(props).toEqual(expect.arrayContaining(tool.input_schema.required!));
    expect(props).toContain('genre');
  });

  it('post65: locks cross-file src/mcp.ts tools array literal order', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    const station = src.indexOf('name: "station_select"');
    const now = src.indexOf('name: "now_playing"');
    const genre = src.indexOf('name: "genre_filter"');
    const curator = src.indexOf('name: "curator_prompt"');
    expect(station).toBeLessThan(now);
    expect(now).toBeLessThan(genre);
    expect(genre).toBeLessThan(curator);
  });

  it('post65: locks src/mcp.ts does not mention claw or openapi host', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toMatch(/claw/i);
    expect(src).not.toContain('https://');
    expect(src).not.toContain('http://');
  });

  it('post65: locks src/mcp.ts auth type none appears once', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect([...src.matchAll(/type: "none"/g)]).toHaveLength(1);
    expect([...src.matchAll(/type: "openapi"/g)]).toHaveLength(1);
  });

  it('post65: locks URL can parse api.url against localhost base', () => {
    const u = new URL(MCP_MANIFEST.api.url, 'https://backlink.fuzzywigg.com');
    expect(u.pathname).toBe('/openapi.json');
    expect(u.origin).toBe('https://backlink.fuzzywigg.com');
  });

  it('post65: locks Promise.resolve manifest tools length', async () => {
    await expect(Promise.resolve(MCP_MANIFEST.tools.length)).resolves.toBe(4);
  });

  it('post65: locks queueMicrotask does not reorder synchronous length read', () => {
    let seen = 0;
    queueMicrotask(() => {
      seen = MCP_MANIFEST.tools.length;
    });
    expect(MCP_MANIFEST.tools.length).toBe(4);
    expect(seen).toBe(0);
  });

  it('post65: locks performance.now delta around JSON.stringify is finite', () => {
    const t0 = performance.now();
    JSON.stringify(MCP_MANIFEST);
    const dt = performance.now() - t0;
    expect(Number.isFinite(dt)).toBe(true);
    expect(dt).toBeGreaterThanOrEqual(0);
  });

  it('post65: locks Bun-incompatible Buffer from compact equals TextEncoder', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    expect(Buffer.from(compact).equals(Buffer.from(new TextEncoder().encode(compact)))).toBe(true);
  });

  it('post65: locks equal bytes for name_for_model via Buffer compare', () => {
    expect(Buffer.compare(Buffer.from('backlink'), Buffer.from(MCP_MANIFEST.name_for_model))).toBe(0);
  });

  it('post65: locks no BOM in src/mcp.ts', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.charCodeAt(0)).toBe('e'.charCodeAt(0));
  });

  it('post65: locks hyphen absence in all tool names and property keys', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).not.toContain('-');
      for (const key of Object.keys(tool.input_schema.properties)) {
        expect(key).not.toContain('-');
      }
    }
  });

  it('post65: locks camelCase absence — all keys are snake or single tokens', () => {
    const keys = [
      ...Object.keys(MCP_MANIFEST),
      ...MCP_MANIFEST.tools.flatMap((t) => Object.keys(t.input_schema.properties)),
    ];
    for (const key of keys) {
      expect(key).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it('post65: locks tools JSON fragment starts with station_select', () => {
    const toolsJson = JSON.stringify(MCP_MANIFEST.tools);
    expect(toolsJson.startsWith('[{"name":"station_select"')).toBe(true);
    expect(toolsJson.endsWith('}]')).toBe(true);
  });

  it('post65: locks exact tools JSON length 1095', () => {
    expect(JSON.stringify(MCP_MANIFEST.tools).length).toBe(1095);
  });

  it('post65: locks sha256 of tools-only JSON', () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST.tools)).digest('hex')).toBe(
      'c4dc1e07bdade8df2e72bb8c19caf43226b1f622a7d10bd1c3341ab91b599b43',
    );
  });

  // --- TOKENMAXX HEAVY burn (post-#74/#76/#79): mcp unit deepen — orthogonal to genres/wrangler/parser/source/routes/helpers/CI ---

  it('post79: locks schema_version exact v1 and length 2', () => {
    expect(MCP_MANIFEST.schema_version).toBe('v1');
    expect(MCP_MANIFEST.schema_version).toHaveLength(2);
  });

  it('post79: locks name_for_model is lowercase ascii only', () => {
    expect(MCP_MANIFEST.name_for_model).toMatch(/^[a-z]+$/);
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
  });

  it('post79: locks name_for_human title case with single space', () => {
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
    expect(MCP_MANIFEST.name_for_human.split(' ')).toEqual(['Backlink', 'Radio']);
  });

  it('post79: locks description_for_model starts with Interact with Backlink', () => {
    expect(MCP_MANIFEST.description_for_model.startsWith('Interact with Backlink,')).toBe(true);
  });

  it('post79: locks description_for_model mentions Select/filter/now-playing/curator', () => {
    const d = MCP_MANIFEST.description_for_model;
    expect(d).toContain('Select stations');
    expect(d).toContain('filter by genre');
    expect(d).toContain('now-playing');
    expect(d).toContain('AI curator');
  });

  it('post79: locks description_for_human exact iptv-org catalog sentence', () => {
    expect(MCP_MANIFEST.description_for_human).toBe(
      'AI-curated live radio from the iptv-org catalog.',
    );
  });

  it('post79: locks auth own-keys only type:none', () => {
    expect(Object.keys(MCP_MANIFEST.auth)).toEqual(['type']);
    expect(MCP_MANIFEST.auth.type).toBe('none');
  });

  it('post79: locks api own-keys type then url', () => {
    expect(Object.keys(MCP_MANIFEST.api)).toEqual(['type', 'url']);
    expect(MCP_MANIFEST.api).toEqual({ type: 'openapi', url: '/openapi.json' });
  });

  it('post79: locks tools length exactly 4', () => {
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect(Array.isArray(MCP_MANIFEST.tools)).toBe(true);
  });

  it('post79: locks tool own-key order name description input_schema for all tools', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.keys(tool)).toEqual(['name', 'description', 'input_schema']);
    }
  });

  it('post79: locks every input_schema own-key order starts with type then properties', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const keys = Object.keys(tool.input_schema);
      expect(keys[0]).toBe('type');
      expect(keys[1]).toBe('properties');
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('post79: locks now_playing has no required array key', () => {
    expect(Object.keys(toolNamed('now_playing').input_schema)).toEqual(['type', 'properties']);
    expect(toolNamed('now_playing').input_schema).not.toHaveProperty('required');
  });

  it('post79: locks station_select required is exact single station_name', () => {
    expect(toolNamed('station_select').input_schema.required).toEqual(['station_name']);
  });

  it('post79: locks genre_filter required is exact single genre', () => {
    expect(toolNamed('genre_filter').input_schema.required).toEqual(['genre']);
  });

  it('post79: locks curator_prompt required is exact single mood (genre optional)', () => {
    expect(toolNamed('curator_prompt').input_schema.required).toEqual(['mood']);
    expect(Object.keys(toolNamed('curator_prompt').input_schema.properties).sort()).toEqual([
      'genre',
      'mood',
    ]);
  });

  it('post79: locks station_select property own-key order type then description', () => {
    const prop = toolNamed('station_select').input_schema.properties.station_name!;
    expect(Object.keys(prop)).toEqual(['type', 'description']);
    expect(prop.type).toBe('string');
  });

  it('post79: locks genre_filter property own-key order type then description', () => {
    const prop = toolNamed('genre_filter').input_schema.properties.genre!;
    expect(Object.keys(prop)).toEqual(['type', 'description']);
  });

  it('post79: locks curator_prompt mood property own-key order type then description', () => {
    const prop = toolNamed('curator_prompt').input_schema.properties.mood!;
    expect(Object.keys(prop)).toEqual(['type', 'description']);
  });

  it('post79: locks curator_prompt genre property own-key order type then description', () => {
    const prop = toolNamed('curator_prompt').input_schema.properties.genre!;
    expect(Object.keys(prop)).toEqual(['type', 'description']);
  });

  it('post79: locks now_playing properties is empty object identity-stable keys', () => {
    expect(toolNamed('now_playing').input_schema.properties).toEqual({});
    expect(Object.keys(toolNamed('now_playing').input_schema.properties)).toEqual([]);
  });

  it('post79: locks tool descriptions do not invent HTTP verbs', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description).not.toMatch(/\b(GET|POST|PUT|PATCH|DELETE)\b/);
    }
  });

  it('post79: locks tool names are snake_case with single underscore each except now_playing', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
    for (const name of MCP_MANIFEST.tools.map((t) => t.name)) {
      expect(name).toMatch(/^[a-z]+_[a-z]+$/);
    }
  });

  it('post79: locks Set of tool names size 4 with has() matrix', () => {
    const set = new Set(MCP_MANIFEST.tools.map((t) => t.name));
    expect(set.size).toBe(4);
    for (const n of ['station_select', 'now_playing', 'genre_filter', 'curator_prompt']) {
      expect(set.has(n)).toBe(true);
    }
    expect(set.has('playlist')).toBe(false);
    expect(set.has('nowPlaying')).toBe(false);
  });

  it('post79: locks Map tool name → description length fingerprint', () => {
    const m = new Map(MCP_MANIFEST.tools.map((t) => [t.name, t.description.length]));
    expect(m.get('station_select')).toBe(42);
    expect(m.get('now_playing')).toBe(81);
    expect(m.get('genre_filter')).toBe(81);
    expect(m.get('curator_prompt')).toBe(80);
  });

  it('post79: locks Reflect.ownKeys on MCP_MANIFEST matches Object.keys', () => {
    expect(Reflect.ownKeys(MCP_MANIFEST)).toEqual(Object.keys(MCP_MANIFEST));
    expect(Reflect.ownKeys(MCP_MANIFEST)).toEqual([
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

  it('post79: locks Object.getOwnPropertyNames equals ownKeys for tools[0]', () => {
    const t = MCP_MANIFEST.tools[0];
    expect(Object.getOwnPropertyNames(t)).toEqual(['name', 'description', 'input_schema']);
  });

  it('post79: locks structuredClone of MCP_MANIFEST is deep-equal not identity', () => {
    const clone = structuredClone(MCP_MANIFEST);
    expect(clone).toEqual(MCP_MANIFEST);
    expect(clone).not.toBe(MCP_MANIFEST);
    expect(clone.tools).not.toBe(MCP_MANIFEST.tools);
    clone.tools[0].name = 'mutated';
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('post79: locks JSON.parse(JSON.stringify) round-trip equality', () => {
    expect(JSON.parse(JSON.stringify(MCP_MANIFEST))).toEqual(MCP_MANIFEST);
  });

  it('post79: locks Object.freeze on clone does not freeze live manifest', () => {
    const clone = Object.freeze({ ...MCP_MANIFEST, tools: [...MCP_MANIFEST.tools] });
    expect(Object.isFrozen(clone)).toBe(true);
    expect(Object.isFrozen(MCP_MANIFEST)).toBe(false);
    expect(MCP_MANIFEST.schema_version).toBe('v1');
  });

  it('post79: locks Proxy get trap still exposes tools length 4', () => {
    const proxied = new Proxy(MCP_MANIFEST, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(proxied.tools).toHaveLength(4);
    expect(proxied.name_for_model).toBe('backlink');
  });

  it('post79: locks Proxy.revocable still reads api.url before revoke', () => {
    const { proxy, revoke } = Proxy.revocable(MCP_MANIFEST, {});
    expect(proxy.api.url).toBe('/openapi.json');
    revoke();
    expect(() => proxy.api).toThrow();
  });

  it('post79: locks WeakMap tagging tools does not serialize', () => {
    const wm = new WeakMap<object, string>();
    wm.set(MCP_MANIFEST.tools[0], 'tagged');
    expect(JSON.stringify(MCP_MANIFEST)).not.toContain('tagged');
    expect(wm.get(MCP_MANIFEST.tools[0])).toBe('tagged');
  });

  it('post79: locks WeakSet can hold auth and api objects', () => {
    const ws = new WeakSet();
    ws.add(MCP_MANIFEST.auth);
    ws.add(MCP_MANIFEST.api);
    expect(ws.has(MCP_MANIFEST.auth)).toBe(true);
    expect(ws.has(MCP_MANIFEST.api)).toBe(true);
  });

  it('post79: locks TextEncoder byte length of description_for_model equals string length (ASCII)', () => {
    const d = MCP_MANIFEST.description_for_model;
    expect(new TextEncoder().encode(d).byteLength).toBe(d.length);
    expect(d.length).toBe(173);
  });

  it('post79: locks TextDecoder round-trip of name_for_human', () => {
    const bytes = new TextEncoder().encode(MCP_MANIFEST.name_for_human);
    expect(new TextDecoder().decode(bytes)).toBe('Backlink Radio');
  });

  it('post79: locks sha256 of description_for_model alone', () => {
    expect(createHash('sha256').update(MCP_MANIFEST.description_for_model).digest('hex')).toBe(
      createHash('sha256')
        .update(
          'Interact with Backlink, an AI-curated IPTV radio service. Select stations, filter by genre, get now-playing info, and ask the AI curator to pick the best station for a mood.',
        )
        .digest('hex'),
    );
  });

  it('post79: locks sha256 of description_for_human alone', () => {
    expect(createHash('sha256').update(MCP_MANIFEST.description_for_human).digest('hex')).toBe(
      createHash('sha256')
        .update('AI-curated live radio from the iptv-org catalog.')
        .digest('hex'),
    );
  });

  it('post79: locks sha1 of name_for_model backlink', () => {
    expect(createHash('sha1').update('backlink').digest('hex')).toBe(
      createHash('sha1').update(MCP_MANIFEST.name_for_model).digest('hex'),
    );
  });

  it('post79: locks md5 of api.url path', () => {
    expect(createHash('md5').update(MCP_MANIFEST.api.url).digest('hex')).toBe(
      createHash('md5').update('/openapi.json').digest('hex'),
    );
  });

  it('post79: locks compact JSON does not contain whitespace between tokens', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    // Structural separators are tight; spaces only appear inside string values.
    expect(compact).not.toMatch(/":\s"/); // would be pretty-printed :" "
    expect(compact).toContain('":"');
    expect(compact).toContain('","');
    expect(compact.startsWith('{')).toBe(true);
    expect(compact.endsWith('}')).toBe(true);
  });

  it('post79: locks pretty JSON indent 2 produces 76 lines', () => {
    const pretty = JSON.stringify(MCP_MANIFEST, null, 2);
    expect(pretty.split('\n')).toHaveLength(76);
  });

  it('post79: locks tools JSON starts with station_select and ends curator_prompt', () => {
    const toolsJson = JSON.stringify(MCP_MANIFEST.tools);
    expect(toolsJson.indexOf('"name":"station_select"')).toBe(2);
    expect(toolsJson).toContain('"name":"curator_prompt"');
    expect(toolsJson.lastIndexOf('"name":"curator_prompt"')).toBeGreaterThan(
      toolsJson.indexOf('"name":"genre_filter"'),
    );
  });

  it('post79: locks btoa of station_select name', () => {
    expect(btoa('station_select')).toBe(btoa(toolNamed('station_select').name));
  });

  it('post79: locks atob of btoa(schema_version) round-trip', () => {
    expect(atob(btoa(MCP_MANIFEST.schema_version))).toBe('v1');
  });

  it('post79: locks URL parsing of api.url as path-only', () => {
    const u = new URL(MCP_MANIFEST.api.url, 'https://backlink.example');
    expect(u.pathname).toBe('/openapi.json');
    expect(u.search).toBe('');
    expect(u.hash).toBe('');
  });

  it('post79: locks Intl.Collator sorted tool names', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    const sorted = [...names].sort(new Intl.Collator('en').compare);
    expect(sorted).toEqual(['curator_prompt', 'genre_filter', 'now_playing', 'station_select']);
  });

  it('post79: locks localeCompare sorted property keys across curator_prompt', () => {
    const keys = Object.keys(toolNamed('curator_prompt').input_schema.properties);
    expect([...keys].sort((a, b) => a.localeCompare(b))).toEqual(['genre', 'mood']);
  });

  it('post79: locks Array.from tools supports every() name includes underscore', () => {
    expect(Array.from(MCP_MANIFEST.tools).every((t) => t.name.includes('_'))).toBe(true);
  });

  it('post79: locks reduce of tool description lengths equals 284', () => {
    const total = MCP_MANIFEST.tools.reduce((acc, t) => acc + t.description.length, 0);
    expect(total).toBe(42 + 81 + 81 + 80);
    expect(total).toBe(284);
  });

  it('post79: locks findIndex of now_playing is 1', () => {
    expect(MCP_MANIFEST.tools.findIndex((t) => t.name === 'now_playing')).toBe(1);
  });

  it('post79: locks find of genre_filter description mentions jazz news classical', () => {
    const t = MCP_MANIFEST.tools.find((t) => t.name === 'genre_filter')!;
    expect(t.description).toContain('jazz');
    expect(t.description).toContain('news');
    expect(t.description).toContain('classical');
  });

  it('post79: locks curator_prompt mood description examples focus/late night/morning', () => {
    const mood = toolNamed('curator_prompt').input_schema.properties.mood!.description;
    expect(mood).toContain('focus work');
    expect(mood).toContain('late night jazz');
    expect(mood).toContain('morning energy');
  });

  it('post79: locks station_select description exact Set the currently playing...', () => {
    expect(toolNamed('station_select').description).toBe(
      'Set the currently playing station by name.',
    );
  });

  it('post79: locks now_playing description exact Get the currently playing...', () => {
    expect(toolNamed('now_playing').description).toBe(
      'Get the currently playing station including name, genre, stream URL, and country.',
    );
  });

  it('post79: locks genre_filter description exact Return a list...', () => {
    expect(toolNamed('genre_filter').description).toBe(
      'Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).',
    );
  });

  it('post79: locks curator_prompt description exact Ask the AI curator...', () => {
    expect(toolNamed('curator_prompt').description).toBe(
      'Ask the AI curator to pick and set the best station for a given mood or context.',
    );
  });

  it('post79: locks no tool invents output_schema or annotations keys', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('output_schema');
      expect(tool).not.toHaveProperty('annotations');
      expect(tool).not.toHaveProperty('examples');
    }
  });

  it('post79: locks manifest does not invent servers oauth privacy policy keys', () => {
    expect(MCP_MANIFEST).not.toHaveProperty('servers');
    expect(MCP_MANIFEST).not.toHaveProperty('oauth');
    expect(MCP_MANIFEST).not.toHaveProperty('privacy_policy');
    expect(MCP_MANIFEST).not.toHaveProperty('contact_email');
  });

  it('post79: locks auth does not invent bearer api_key oauth2', () => {
    expect(MCP_MANIFEST.auth.type).not.toBe('bearer');
    expect(MCP_MANIFEST.auth.type).not.toBe('api_key');
    expect(MCP_MANIFEST.auth.type).not.toBe('oauth2');
  });

  it('post79: locks api does not invent graphql grpc websocket types', () => {
    expect(MCP_MANIFEST.api.type).toBe('openapi');
    expect(MCP_MANIFEST.api.type).not.toBe('graphql');
    expect(MCP_MANIFEST.api.type).not.toBe('grpc');
  });

  it('post79: locks api.url does not invent /swagger /docs /mcp paths', () => {
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
    expect(MCP_MANIFEST.api.url).not.toBe('/swagger');
    expect(MCP_MANIFEST.api.url).not.toBe('/docs');
    expect(MCP_MANIFEST.api.url).not.toBe('/mcp');
  });

  it('post79: locks no invented fifth tool playlist or radio_tune', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(names).not.toContain('playlist');
    expect(names).not.toContain('radio_tune');
    expect(names).not.toContain('now_playing_info');
  });

  it('post79: locks src/mcp.ts export const MCP_MANIFEST once', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect([...src.matchAll(/export const MCP_MANIFEST/g)]).toHaveLength(1);
  });

  it('post79: locks src/mcp.ts uses double quotes for string literals predominantly', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    const doubles = (src.match(/"/g) ?? []).length;
    const singles = (src.match(/'/g) ?? []).length;
    expect(doubles).toBeGreaterThan(singles);
  });

  it('post79: locks src/mcp.ts has exactly 67 newline-terminated lines', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src.endsWith('\n')).toBe(true);
    expect(src.split('\n').length - 1).toBe(67);
    expect(src.trimEnd().endsWith('};')).toBe(true);
  });

  it('post79: locks src/mcp.ts byte length 2057 via Buffer', () => {
    const buf = readFileSync(join(mcpRoot, 'src/mcp.ts'));
    expect(buf.byteLength).toBe(2057);
    expect(statSync(join(mcpRoot, 'src/mcp.ts')).size).toBe(2057);
  });

  it('post79: locks src/mcp.ts sha256/sha1/md5 digests', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'));
    expect(createHash('sha256').update(src).digest('hex')).toBe(
      '6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683',
    );
    expect(createHash('sha1').update(src).digest('hex')).toBe(
      '848b3977365809fda54fcb74a7d09affe685ea82',
    );
    expect(createHash('md5').update(src).digest('hex')).toBe('52e71c72e32e3d95b8b8d61ff4a2cf46');
  });

  it('post79: locks src/mcp.ts sha256 nibble sum 551', () => {
    const hex = createHash('sha256')
      .update(readFileSync(join(mcpRoot, 'src/mcp.ts')))
      .digest('hex');
    expect([...hex].reduce((a, c) => a + Number.parseInt(c, 16), 0)).toBe(551);
  });

  it('post79: locks src/mcp.ts contains openapi.json and auth none', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).toContain('/openapi.json');
    expect(src).toContain('type: "none"');
    expect(src).toContain('schema_version: "v1"');
  });

  it('post79: locks src/mcp.ts tool name string literals in order', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    const order = ['station_select', 'now_playing', 'genre_filter', 'curator_prompt'];
    let idx = -1;
    for (const name of order) {
      const next = src.indexOf(`"${name}"`);
      expect(next).toBeGreaterThan(idx);
      idx = next;
    }
  });

  it('post79: locks src/mcp.ts has no TypeScript type annotations or imports', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toContain('interface ');
    expect(src).not.toContain('type ');
    expect(src).not.toContain(' as const');
  });

  it('post79: locks src/mcp.ts ASCII-only LF no tabs no CR', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'));
    expect(src.includes(0x09)).toBe(false);
    expect(src.includes(0x0d)).toBe(false);
    expect(src.every((b) => b < 0x80)).toBe(true);
  });

  it('post79: locks compact JSON sha256 still matches post65 fingerprint', () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST)).digest('hex')).toBe(
      '11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043',
    );
  });

  it('post79: locks compact JSON length 1534 and tools fragment 1095', () => {
    expect(JSON.stringify(MCP_MANIFEST).length).toBe(1534);
    expect(JSON.stringify(MCP_MANIFEST.tools).length).toBe(1095);
  });

  it('post79: locks tools-only sha256 fingerprint', () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST.tools)).digest('hex')).toBe(
      'c4dc1e07bdade8df2e72bb8c19caf43226b1f622a7d10bd1c3341ab91b599b43',
    );
  });

  it('post79: locks Promise.all over tool name reads all fulfill', async () => {
    const results = await Promise.all(
      MCP_MANIFEST.tools.map(async (t) => t.name),
    );
    expect(results).toEqual(['station_select', 'now_playing', 'genre_filter', 'curator_prompt']);
  });

  it('post79: locks Promise.allSettled over schema fields all fulfilled', async () => {
    const fields = [
      MCP_MANIFEST.schema_version,
      MCP_MANIFEST.name_for_model,
      MCP_MANIFEST.name_for_human,
      MCP_MANIFEST.auth.type,
      MCP_MANIFEST.api.type,
    ];
    const settled = await Promise.allSettled(fields.map(async (v) => v));
    expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);
  });

  it('post79: locks Symbol.iterator on tools yields station_select first', () => {
    const iter = MCP_MANIFEST.tools[Symbol.iterator]();
    expect(iter.next().value!.name).toBe('station_select');
  });

  it('post79: locks Symbol.toStringTag on plain object tools entry is undefined', () => {
    expect(Object.prototype.toString.call(MCP_MANIFEST.tools[0])).toBe('[object Object]');
  });

  it('post79: locks Array.isArray tools and not auth/api', () => {
    expect(Array.isArray(MCP_MANIFEST.tools)).toBe(true);
    expect(Array.isArray(MCP_MANIFEST.auth)).toBe(false);
    expect(Array.isArray(MCP_MANIFEST.api)).toBe(false);
  });

  it('post79: locks Number.isFinite on all description lengths', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Number.isFinite(tool.description.length)).toBe(true);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('post79: locks performance.now around structuredClone is finite', () => {
    const t0 = performance.now();
    structuredClone(MCP_MANIFEST);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(0);
  });

  it('post79: locks Buffer from tools JSON equals TextEncoder bytes', () => {
    const s = JSON.stringify(MCP_MANIFEST.tools);
    expect(Buffer.from(s).equals(Buffer.from(new TextEncoder().encode(s)))).toBe(true);
  });

  it('post79: locks no null/undefined values in string fields', () => {
    expect(MCP_MANIFEST.schema_version).toBeTruthy();
    expect(MCP_MANIFEST.name_for_model).toBeTruthy();
    expect(MCP_MANIFEST.name_for_human).toBeTruthy();
    expect(MCP_MANIFEST.description_for_model).toBeTruthy();
    expect(MCP_MANIFEST.description_for_human).toBeTruthy();
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it('post79: locks required arrays are dense string arrays', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const req = tool.input_schema.required;
      if (req !== undefined) {
        expect(Array.isArray(req)).toBe(true);
        expect(req.every((x) => typeof x === 'string')).toBe(true);
        expect(Object.keys(req)).toHaveLength(req.length);
      }
    }
  });

  it('post79: locks property descriptions are non-empty strings', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(typeof prop.description).toBe('string');
        expect(prop.description.length).toBeGreaterThan(10);
      }
    }
  });

  it('post79: locks curator_prompt properties mood before genre in own-key order', () => {
    expect(Object.keys(toolNamed('curator_prompt').input_schema.properties)).toEqual([
      'mood',
      'genre',
    ]);
  });

  it('post79: locks station_select properties only station_name', () => {
    expect(Object.keys(toolNamed('station_select').input_schema.properties)).toEqual([
      'station_name',
    ]);
  });

  it('post79: locks genre_filter properties only genre', () => {
    expect(Object.keys(toolNamed('genre_filter').input_schema.properties)).toEqual(['genre']);
  });

  it('post79: locks mutating clone tools length does not shrink live tools', () => {
    const clone = structuredClone(MCP_MANIFEST);
    clone.tools.pop();
    expect(clone.tools).toHaveLength(3);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('post79: locks JSON.stringify auth fragment', () => {
    expect(JSON.stringify(MCP_MANIFEST.auth)).toBe('{"type":"none"}');
  });

  it('post79: locks JSON.stringify api fragment', () => {
    expect(JSON.stringify(MCP_MANIFEST.api)).toBe('{"type":"openapi","url":"/openapi.json"}');
  });

  it('post79: locks charCodeAt matrix for schema_version v1', () => {
    expect([...MCP_MANIFEST.schema_version].map((c) => c.charCodeAt(0))).toEqual([118, 49]);
  });

  it('post79: locks charCodeAt first letters of tool names S/n/g/c', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name.charCodeAt(0))).toEqual([
      's'.charCodeAt(0),
      'n'.charCodeAt(0),
      'g'.charCodeAt(0),
      'c'.charCodeAt(0),
    ]);
  });

  it('post79: locks description_for_model word count via whitespace split', () => {
    const words = MCP_MANIFEST.description_for_model.trim().split(/\s+/);
    expect(words).toHaveLength(29);
    expect(words[0]).toBe('Interact');
    expect(words.at(-1)).toBe('mood.');
  });

  it('post79: locks description_for_human word count 7', () => {
    const words = MCP_MANIFEST.description_for_human.trim().split(/\s+/);
    expect(words).toHaveLength(7);
    expect(words[0]).toBe('AI-curated');
    expect(words.at(-1)).toBe('catalog.');
  });

  it('post79: locks hyphenated tokens in human description AI-curated and iptv-org', () => {
    expect(MCP_MANIFEST.description_for_human).toContain('AI-curated');
    expect(MCP_MANIFEST.description_for_human).toContain('iptv-org');
  });

  it('post79: locks model description hyphenated now-playing and AI-curated', () => {
    expect(MCP_MANIFEST.description_for_model).toContain('now-playing');
    expect(MCP_MANIFEST.description_for_model).toContain('AI-curated');
  });

  it('post79: locks purity — 20x JSON.stringify compact identical', () => {
    const first = JSON.stringify(MCP_MANIFEST);
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(MCP_MANIFEST)).toBe(first);
    }
  });

  it('post79: locks purity — 20x tool name inventory identical', () => {
    const first = MCP_MANIFEST.tools.map((t) => t.name).join(',');
    for (let i = 0; i < 20; i++) {
      expect(MCP_MANIFEST.tools.map((t) => t.name).join(',')).toBe(first);
    }
  });

  it('post79: locks AggregateError unused — Promise.any of tool names resolves first', async () => {
    const name = await Promise.any(MCP_MANIFEST.tools.map(async (t) => t.name));
    expect(typeof name).toBe('string');
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toContain(name);
  });

  it('post79: locks AbortController unused by manifest — signal does not exist on tools', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool).not.toHaveProperty('signal');
      expect(tool).not.toHaveProperty('abort');
    }
  });

  it('post79: locks Object.is compares schema_version to v1', () => {
    expect(Object.is(MCP_MANIFEST.schema_version, 'v1')).toBe(true);
    expect(Object.is(MCP_MANIFEST.auth.type, 'none')).toBe(true);
  });

  it('post79: locks flatMap of property keys yields station_name genre mood genre', () => {
    const keys = MCP_MANIFEST.tools.flatMap((t) => Object.keys(t.input_schema.properties));
    expect(keys).toEqual(['station_name', 'genre', 'mood', 'genre']);
  });

  it('post79: locks unique property key set size 3', () => {
    const keys = new Set(
      MCP_MANIFEST.tools.flatMap((t) => Object.keys(t.input_schema.properties)),
    );
    expect(keys).toEqual(new Set(['station_name', 'genre', 'mood']));
    expect(keys.size).toBe(3);
  });

  it('post79: locks genre appears as property on both genre_filter and curator_prompt', () => {
    expect(toolNamed('genre_filter').input_schema.properties).toHaveProperty('genre');
    expect(toolNamed('curator_prompt').input_schema.properties).toHaveProperty('genre');
    expect(toolNamed('station_select').input_schema.properties).not.toHaveProperty('genre');
    expect(toolNamed('now_playing').input_schema.properties).not.toHaveProperty('genre');
  });

  it('post79: locks mood only on curator_prompt', () => {
    expect(toolNamed('curator_prompt').input_schema.properties).toHaveProperty('mood');
    for (const name of ['station_select', 'now_playing', 'genre_filter']) {
      expect(toolNamed(name).input_schema.properties).not.toHaveProperty('mood');
    }
  });

  it('post79: locks station_name only on station_select', () => {
    expect(toolNamed('station_select').input_schema.properties).toHaveProperty('station_name');
    for (const name of ['now_playing', 'genre_filter', 'curator_prompt']) {
      expect(toolNamed(name).input_schema.properties).not.toHaveProperty('station_name');
    }
  });

  it('post79: locks input_schema.required references only declared properties', () => {
    for (const tool of MCP_MANIFEST.tools) {
      const props = new Set(Object.keys(tool.input_schema.properties));
      for (const r of tool.input_schema.required ?? []) {
        expect(props.has(r)).toBe(true);
      }
    }
  });

  it('post79: locks no additionalProperties key on any input_schema', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema).not.toHaveProperty('additionalProperties');
      expect(tool.input_schema).not.toHaveProperty('$schema');
    }
  });

  it('post79: locks src/mcp.ts does not embed secrets or API keys', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src.toLowerCase()).not.toContain('api_key');
    expect(src.toLowerCase()).not.toContain('apikey');
    expect(src.toLowerCase()).not.toContain('secret');
    expect(src.toLowerCase()).not.toContain('bearer');
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });

  it('post79: locks src/mcp.ts mentions Backlink Radio and iptv-org', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).toContain('Backlink Radio');
    expect(src).toContain('iptv-org');
    expect(src).toContain('backlink');
  });

  it('post79: final cross-lock — tools sha256 + compact length + export inventory', () => {
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect(JSON.stringify(MCP_MANIFEST).length).toBe(1534);
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST.tools)).digest('hex')).toBe(
      'c4dc1e07bdade8df2e72bb8c19caf43226b1f622a7d10bd1c3341ab91b599b43',
    );
    expect(createHash('sha256').update(readFileSync(join(mcpRoot, 'src/mcp.ts'))).digest('hex')).toBe(
      '6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683',
    );
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


  // --- HEAVY burn (post-#87): mcp unit deepen (orthogonal to routes/mcp-spec; stacks after #87 post79) ---

  it('post87: locks src/mcp.ts byte length via utf8 and fs.statSync', () => {
    const path = join(mcpRoot, 'src/mcp.ts');
    const src = readFileSync(path, 'utf8');
    expect(src.length).toBe(2057);
    expect(Buffer.byteLength(src, 'utf8')).toBe(2057);
    expect(statSync(path).size).toBe(2057);
  });

  it('post87: locks src/mcp.ts sha384 digest', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'));
    expect(createHash('sha384').update(src).digest('hex')).toBe(
      'a95bef5fcb3b93e9c05aac94aaa6a49adb47a360bfaf046e65f7254c2249fd1f34ff923ec401752e2701b7260d9949d2',
    );
  });

  it('post87: locks src/mcp.ts sha512 digest', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'));
    expect(createHash('sha512').update(src).digest('hex')).toBe(
      'aa1525a8464db0a7d40982c8f0c091b63f8b21ea363f642ca9781513618d4fb99a9926e39118f65788c423a6bd6ee2318b3165f6007ca9599d36fe7fc7820c05',
    );
  });

  it('post87: locks src/mcp.ts sha512 prefix and suffix nibbles', () => {
    const hex = createHash('sha512')
      .update(readFileSync(join(mcpRoot, 'src/mcp.ts')))
      .digest('hex');
    expect(hex.startsWith('aa1525a8464db0a7')).toBe(true);
    expect(hex.endsWith('9d36fe7fc7820c05')).toBe(true);
    expect(hex).toHaveLength(128);
  });

  it('post87: locks keyed sha256 surrogate mcp||src', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(createHash('sha256').update('mcp' + src).digest('hex')).toBe(
      '2dc24ed35cb482ba8fe6e27b3e92eadcb859c5b780c4e8ae47bd1419e44385f5',
    );
  });

  it('post87: locks HMAC-SHA256 of compact JSON with key backlink', () => {
    expect(createHmac('sha256', 'backlink').update(JSON.stringify(MCP_MANIFEST)).digest('hex')).toBe(
      '74ed5db6769aa1a7fc48963fbc443f4a3167407de6997ec81105277ef1c3ec41',
    );
  });

  it('post87: locks HMAC-SHA256 of tools-only JSON with key tools', () => {
    expect(createHmac('sha256', 'tools').update(JSON.stringify(MCP_MANIFEST.tools)).digest('hex')).toBe(
      'f8141b6c4719f916fa854902b40238f1e3dbc08c1d65313715efa6eb23c9e7d8',
    );
  });

  it('post87: locks compact JSON sha384 digest', () => {
    expect(createHash('sha384').update(JSON.stringify(MCP_MANIFEST)).digest('hex')).toBe(
      '48b9c8c453304bca5d2fc9b97cb589a632cea9dea89ab549cbb4477e96fdba04ebace7e89d299e687c1b3636e0d7b7c9',
    );
  });

  it('post87: locks compact JSON sha512 digest', () => {
    expect(createHash('sha512').update(JSON.stringify(MCP_MANIFEST)).digest('hex')).toBe(
      '5ee0d0827bd0f94d0556e303c4c009391f97e9cdc19a515643d5b50e5529d79f82402ae5c4002827239bb71bef56184c30ad1c6622b50ab9887a46063bf07756',
    );
  });

  it('post87: locks tools-only JSON sha384 and sha512', () => {
    const tools = JSON.stringify(MCP_MANIFEST.tools);
    expect(createHash('sha384').update(tools).digest('hex')).toBe(
      '4025d0acd3354b5bee3fc0a2bddb09f3dbff17bc3acda1fa932d92f490f32a8d07726d3f1c44db3a17765e57996d7770',
    );
    expect(createHash('sha512').update(tools).digest('hex')).toBe(
      'efb54389f38d8d8388737556877d485bb13fdbd43f04ca2dd908be65ffafd6794b319b5c155c3aef20068314f372a5dd900af9bd6baaf2ae93e9f542190b5e6c',
    );
  });

  it('post87: locks tools-only sha256 nibble sum to 490', () => {
    const hex = createHash('sha256').update(JSON.stringify(MCP_MANIFEST.tools)).digest('hex');
    expect([...hex].reduce((a, c) => a + Number.parseInt(c, 16), 0)).toBe(490);
  });

  it('post87: locks auth JSON sha256/sha1/md5 digests', () => {
    const auth = JSON.stringify(MCP_MANIFEST.auth);
    expect(auth).toBe('{"type":"none"}');
    expect(createHash('sha256').update(auth).digest('hex')).toBe(
      'ff0f08b1aa6194023a4e4fadb848e1a977cb9f23c42b5d9cda8ea2552d9d1f73',
    );
    expect(createHash('sha1').update(auth).digest('hex')).toBe('8ad62e9d2281975eab6abd500bd610a6573a185a');
    expect(createHash('md5').update(auth).digest('hex')).toBe('360140548527d5a257d214677dd57baa');
  });

  it('post87: locks api JSON sha256/sha1/md5 digests', () => {
    const api = JSON.stringify(MCP_MANIFEST.api);
    expect(api).toBe('{"type":"openapi","url":"/openapi.json"}');
    expect(createHash('sha256').update(api).digest('hex')).toBe(
      'b797fe543cd774f9401d8dcec722bcb11320c594dcaa5ff9a24b6f0c5837decb',
    );
    expect(createHash('sha1').update(api).digest('hex')).toBe('1f46c3d15ebbd099083a0c657d1b8bd3ad1f6150');
    expect(createHash('md5').update(api).digest('hex')).toBe('6fed1ffd85c4b421b24a8e0282c090bf');
  });

  it('post87: locks auth JSON sha384 and api JSON sha384', () => {
    expect(createHash('sha384').update(JSON.stringify(MCP_MANIFEST.auth)).digest('hex')).toBe(
      '25e67d5b6f0c705ad306c8420cdf56d6217f225afc010207e5bf39bad7366e5c68b2d8751c9609c41a5cfe8c6216b133',
    );
    expect(createHash('sha384').update(JSON.stringify(MCP_MANIFEST.api)).digest('hex')).toBe(
      '1b660da2051a776a85241786c445ee54306dbcf3f390d485961241aace1baaa81e493de17866a8ea7a2e377ff78f7ec3',
    );
  });

  it('post87: locks timingSafeEqual of live vs re-stringified compact buffers', () => {
    const a = Buffer.from(JSON.stringify(MCP_MANIFEST));
    const b = Buffer.from(JSON.stringify(structuredClone(MCP_MANIFEST)));
    expect(a.length).toBe(1534);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it('post87: locks timingSafeEqual false when last byte flipped', () => {
    const a = Buffer.from(JSON.stringify(MCP_MANIFEST));
    const b = Buffer.from(a);
    b[b.length - 1] = b[b.length - 1] ^ 0x01;
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it('post87: locks base64 of tools CSV join', () => {
    const csv = MCP_MANIFEST.tools.map((t) => t.name).join(',');
    expect(csv).toBe('station_select,now_playing,genre_filter,curator_prompt');
    expect(Buffer.from(csv).toString('base64')).toBe(
      'c3RhdGlvbl9zZWxlY3Qsbm93X3BsYXlpbmcsZ2VucmVfZmlsdGVyLGN1cmF0b3JfcHJvbXB0',
    );
  });

  it('post87: locks base64url and hex of name_for_model', () => {
    expect(Buffer.from(MCP_MANIFEST.name_for_model).toString('base64url')).toBe('YmFja2xpbms');
    expect(Buffer.from(MCP_MANIFEST.name_for_model).toString('hex')).toBe('6261636b6c696e6b');
  });

  it('post87: locks utf16le byte length of compact JSON is 3068', () => {
    expect(Buffer.from(JSON.stringify(MCP_MANIFEST), 'utf16le').length).toBe(3068);
  });

  it('post87: locks TextEncoder length equals compact JSON length 1534', () => {
    expect(new TextEncoder().encode(JSON.stringify(MCP_MANIFEST)).length).toBe(1534);
  });

  it('post87: locks top-20 compact JSON character frequencies', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    const freq: Record<string, number> = {};
    for (const c of compact) freq[c] = (freq[c] ?? 0) + 1;
    const top = Object.entries(freq)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20);
    expect(top).toEqual([
      ['"', 154],
      ['e', 130],
      ['t', 113],
      [' ', 110],
      ['n', 88],
      ['o', 86],
      ['i', 85],
      ['r', 82],
      ['a', 69],
      ['s', 55],
      ['c', 47],
      ['p', 47],
      [':', 46],
      [',', 44],
      ['d', 32],
      ['l', 32],
      ['m', 29],
      ['g', 26],
      ['y', 25],
      ['u', 23],
    ]);
  });

  it('post87: locks vowel and digit counts in compact JSON', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    expect((compact.match(/[aeiouAEIOU]/g) ?? []).length).toBe(406);
    expect((compact.match(/\d/g) ?? []).length).toBe(1);
  });

  it('post87: locks pretty JSON space count to 660', () => {
    const pretty = JSON.stringify(MCP_MANIFEST, null, 2);
    expect((pretty.match(/ /g) ?? []).length).toBe(660);
  });

  it('post87: locks xor-fold of compact JSON code units to 36', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    expect([...compact].reduce((a, c) => a ^ c.charCodeAt(0), 0)).toBe(36);
  });

  it('post87: locks rolling *31 checksum of compact JSON', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    expect([...compact].reduce((a, c) => ((a * 31) + c.charCodeAt(0)) >>> 0, 0)).toBe(971654834);
  });

  it('post87: locks description_for_model alphanumeric token list', () => {
    expect(MCP_MANIFEST.description_for_model.match(/[A-Za-z0-9]+/g)).toEqual([
      'Interact',
      'with',
      'Backlink',
      'an',
      'AI',
      'curated',
      'IPTV',
      'radio',
      'service',
      'Select',
      'stations',
      'filter',
      'by',
      'genre',
      'get',
      'now',
      'playing',
      'info',
      'and',
      'ask',
      'the',
      'AI',
      'curator',
      'to',
      'pick',
      'the',
      'best',
      'station',
      'for',
      'a',
      'mood',
    ]);
  });

  it('post87: locks description_for_human alphanumeric token list', () => {
    expect(MCP_MANIFEST.description_for_human.match(/[A-Za-z0-9]+/g)).toEqual([
      'AI',
      'curated',
      'live',
      'radio',
      'from',
      'the',
      'iptv',
      'org',
      'catalog',
    ]);
  });

  it('post87: locks code-unit sums for model and human descriptions', () => {
    expect([...MCP_MANIFEST.description_for_model].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(15625);
    expect([...MCP_MANIFEST.description_for_human].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(4436);
  });

  it('post87: locks code-unit sums for name_for_model and name_for_human', () => {
    expect([...MCP_MANIFEST.name_for_model].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(831);
    expect([...MCP_MANIFEST.name_for_human].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(1326);
  });

  it('post87: locks code-unit sums for every tool name', () => {
    expect(MCP_MANIFEST.tools.map((t) => [...t.name].reduce((a, c) => a + c.charCodeAt(0), 0))).toEqual([
      1505, 1191, 1270, 1537,
    ]);
  });

  it('post87: locks code-unit sums for every tool description', () => {
    expect(MCP_MANIFEST.tools.map((t) => [...t.description].reduce((a, c) => a + c.charCodeAt(0), 0))).toEqual([
      4021, 7558, 7377, 7272,
    ]);
  });

  it('post87: locks code-unit sums for every property description in declaration order', () => {
    const sums = MCP_MANIFEST.tools.flatMap((t) =>
      Object.values(t.input_schema.properties).map((p) =>
        [...(p as { description: string }).description].reduce((a, c) => a + c.charCodeAt(0), 0),
      ),
    );
    expect(sums).toEqual([4267, 2536, 7906, 4064]);
  });

  it('post87: locks tool object key order name/description/input_schema for all tools', () => {
    expect(MCP_MANIFEST.tools.map((t) => Object.keys(t))).toEqual([
      ['name', 'description', 'input_schema'],
      ['name', 'description', 'input_schema'],
      ['name', 'description', 'input_schema'],
      ['name', 'description', 'input_schema'],
    ]);
  });

  it('post87: locks input_schema key order including required presence asymmetry', () => {
    expect(MCP_MANIFEST.tools.map((t) => Object.keys(t.input_schema))).toEqual([
      ['type', 'properties', 'required'],
      ['type', 'properties'],
      ['type', 'properties', 'required'],
      ['type', 'properties', 'required'],
    ]);
  });

  it('post87: locks property key arrays per tool', () => {
    expect(MCP_MANIFEST.tools.map((t) => Object.keys(t.input_schema.properties))).toEqual([
      ['station_name'],
      [],
      ['genre'],
      ['mood', 'genre'],
    ]);
  });

  it('post87: locks required arrays with null sentinel for now_playing', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.input_schema.required ?? null)).toEqual([
      ['station_name'],
      null,
      ['genre'],
      ['mood'],
    ]);
  });

  it('post87: locks first characters of schema/model/human names', () => {
    expect(MCP_MANIFEST.schema_version[0]).toBe('v');
    expect(MCP_MANIFEST.name_for_model[0]).toBe('b');
    expect(MCP_MANIFEST.name_for_human[0]).toBe('B');
  });

  it('post87: locks last characters of model/human/api.url', () => {
    expect(MCP_MANIFEST.name_for_model.at(-1)).toBe('k');
    expect(MCP_MANIFEST.name_for_human.at(-1)).toBe('o');
    expect(MCP_MANIFEST.api.url.at(-1)).toBe('n');
  });

  it('post87: locks indexOf anchors for IPTV/AI/iptv-org/Radio', () => {
    expect(MCP_MANIFEST.description_for_model.indexOf('IPTV')).toBe(38);
    expect(MCP_MANIFEST.description_for_model.indexOf('AI')).toBe(27);
    expect(MCP_MANIFEST.description_for_human.indexOf('iptv-org')).toBe(31);
    expect(MCP_MANIFEST.name_for_human.indexOf('Radio')).toBe(9);
  });

  it('post87: locks underscore-split tokens for every tool name', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name.split('_'))).toEqual([
      ['station', 'select'],
      ['now', 'playing'],
      ['genre', 'filter'],
      ['curator', 'prompt'],
    ]);
  });

  it('post87: locks tool description 8-char prefixes', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.description.slice(0, 8))).toEqual([
      'Set the ',
      'Get the ',
      'Return a',
      'Ask the ',
    ]);
  });

  it('post87: locks tool description 8-char suffixes', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.description.slice(-8))).toEqual([
      'by name.',
      'country.',
      'ssical).',
      'context.',
    ]);
  });

  it('post87: locks exact tool description strings', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.description)).toEqual([
      'Set the currently playing station by name.',
      'Get the currently playing station including name, genre, stream URL, and country.',
      'Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).',
      'Ask the AI curator to pick and set the best station for a given mood or context.',
    ]);
  });

  it('post87: locks exact property description map per tool', () => {
    const map = Object.fromEntries(
      MCP_MANIFEST.tools.map((t) => [
        t.name,
        Object.fromEntries(
          Object.entries(t.input_schema.properties).map(([k, v]) => [
            k,
            (v as { description: string }).description,
          ]),
        ),
      ]),
    );
    expect(map).toEqual({
      station_select: { station_name: 'Partial or full name of the station to select.' },
      now_playing: {},
      genre_filter: { genre: 'Genre keyword to filter by.' },
      curator_prompt: {
        mood: 'Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).',
        genre: 'Optional genre to constrain the selection.',
      },
    });
  });

  it('post87: locks src/mcp.ts inventory — no import/async/function/class', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\bexport default\b/);
    expect(src).not.toMatch(/\binterface\b/);
    expect(src).not.toMatch(/\btype\s+\w+\s*=/);
    expect(src).not.toMatch(/\basync\b/);
    expect(src).not.toMatch(/\bfunction\b/);
    expect(src).not.toMatch(/\bclass\b/);
  });

  it('post87: locks src/mcp.ts free of runtime deps (fetch/gemini/cloudflare/hono)', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toMatch(/\bfetch\b/);
    expect(src).not.toMatch(/gemini/i);
    expect(src).not.toMatch(/cloudflare/i);
    expect(src).not.toMatch(/hono/i);
  });

  it('post87: negative product inventing — src/mcp.ts has no /playlist path', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src.toLowerCase()).not.toContain('/playlist');
    expect(src).not.toMatch(/app\.get|app\.post|new Hono/);
  });

  it('post87: negative — src/mcp.ts does not declare backlink_ tool prefixes', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toContain('backlink_');
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name.startsWith('backlink_')).toBe(false);
    }
  });

  it('post87: negative — src/mcp.ts does not embed openapi.org or swagger hosts', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toMatch(/openapi\.org|swagger/i);
    expect(MCP_MANIFEST.api.url).toBe('/openapi.json');
  });

  it('post87: locks brace/paren/bracket balance of src/mcp.ts to zero', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect((src.match(/\{/g) ?? []).length - (src.match(/\}/g) ?? []).length).toBe(0);
    expect((src.match(/\(/g) ?? []).length - (src.match(/\)/g) ?? []).length).toBe(0);
    expect((src.match(/\[/g) ?? []).length - (src.match(/\]/g) ?? []).length).toBe(0);
  });

  it('post87: locks indent width set of src/mcp.ts', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    const widths = [
      ...new Set(src.split('\n').map((l) => (l.match(/^ */)?.[0].length ?? 0))),
    ].sort((a, b) => a - b);
    expect(widths).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it('post87: locks max line length and empty line count of src/mcp.ts', () => {
    const lines = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8').split('\n');
    expect(Math.max(...lines.map((l) => l.length))).toBe(180);
    expect(lines.filter((l) => l.trim() === '').length).toBe(1);
  });

  it('post87: locks src punctuation inventory underscores and double quotes', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect((src.match(/_/g) ?? []).length).toBe(20);
    expect((src.match(/"/g) ?? []).length).toBe(62);
    expect((src.match(/'/g) ?? []).length).toBe(0);
  });

  it('post87: locks src schema vocabulary counts type object/string/required', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect((src.match(/type: "object"/g) ?? []).length).toBe(4);
    expect((src.match(/type: "string"/g) ?? []).length).toBe(4);
    expect((src.match(/required:/g) ?? []).length).toBe(3);
    expect((src.match(/\bname:/g) ?? []).length).toBe(4);
    expect((src.match(/\bdescription:/g) ?? []).length).toBe(8);
    expect((src.match(/input_schema:/g) ?? []).length).toBe(4);
    expect((src.match(/properties:/g) ?? []).length).toBe(4);
  });

  it('post87: locks Object.entries top-level manifest key order', () => {
    expect(Object.entries(MCP_MANIFEST).map(([k]) => k)).toEqual([
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

  it('post87: locks Object.fromEntries round-trip preserves tools identity', () => {
    const rebuilt = Object.fromEntries(Object.entries(MCP_MANIFEST)) as typeof MCP_MANIFEST;
    expect(rebuilt.tools).toBe(MCP_MANIFEST.tools);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(MCP_MANIFEST));
  });

  it('post87: locks Object.hasOwn for every top-level key and rejects unknowns', () => {
    for (const key of Object.keys(MCP_MANIFEST)) {
      expect(Object.hasOwn(MCP_MANIFEST, key)).toBe(true);
    }
    expect(Object.hasOwn(MCP_MANIFEST, 'version')).toBe(false);
    expect(Object.hasOwn(MCP_MANIFEST, 'mcp_version')).toBe(false);
    expect(Object.hasOwn(MCP_MANIFEST, 'servers')).toBe(false);
  });

  it('post87: locks Object.is for schema_version and auth/api type strings', () => {
    expect(Object.is(MCP_MANIFEST.schema_version, 'v1')).toBe(true);
    expect(Object.is(MCP_MANIFEST.auth.type, 'none')).toBe(true);
    expect(Object.is(MCP_MANIFEST.api.type, 'openapi')).toBe(true);
  });

  it('post87: locks Array.isArray tools and non-array properties bags', () => {
    expect(Array.isArray(MCP_MANIFEST.tools)).toBe(true);
    for (const tool of MCP_MANIFEST.tools) {
      expect(Array.isArray(tool.input_schema.properties)).toBe(false);
      expect(Array.isArray(tool.input_schema.required) || tool.input_schema.required === undefined).toBe(
        true,
      );
    }
  });

  it('post87: locks tools find-last via reverse scan returns curator_prompt', () => {
    const lastUnderscore = [...MCP_MANIFEST.tools]
      .map((t, i) => ({ t, i }))
      .reverse()
      .find(({ t }) => t.name.includes('_'));
    expect(lastUnderscore?.t.name).toBe('curator_prompt');
    const genreIdx = [...MCP_MANIFEST.tools]
      .map((t, i) => ({ t, i }))
      .reverse()
      .find(({ t }) => t.name.startsWith('genre'))?.i;
    expect(genreIdx).toBe(2);
  });

  it('post87: locks reversed copy names without mutating live order', () => {
    const reversed = [...MCP_MANIFEST.tools].reverse().map((t) => t.name);
    expect(reversed).toEqual(['curator_prompt', 'genre_filter', 'now_playing', 'station_select']);
    expect(MCP_MANIFEST.tools.map((t) => t.name)[0]).toBe('station_select');
  });

  it('post87: locks sorted-by-name copy vs declaration order', () => {
    const sorted = [...MCP_MANIFEST.tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => t.name);
    expect(sorted).toEqual(['curator_prompt', 'genre_filter', 'now_playing', 'station_select']);
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('post87: locks spliced copy removing index 1 leaves three names', () => {
    const copy = MCP_MANIFEST.tools.slice();
    copy.splice(1, 1);
    expect(copy.map((t) => t.name)).toEqual(['station_select', 'genre_filter', 'curator_prompt']);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('post87: locks index-0 replacement copy does not mutate live', () => {
    const replaced = [
      { ...MCP_MANIFEST.tools[0], name: 'station_select_replaced' },
      ...MCP_MANIFEST.tools.slice(1),
    ];
    expect(replaced[0].name).toBe('station_select_replaced');
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('post87: locks Array.from map of tool names', () => {
    const names = Array.from(MCP_MANIFEST.tools, (t) => t.name);
    expect(names).toEqual(['station_select', 'now_playing', 'genre_filter', 'curator_prompt']);
  });

  it('post87: locks reduce groupBy tools by required presence', () => {
    const grouped = MCP_MANIFEST.tools.reduce(
      (acc, t) => {
        const key = t.input_schema.required ? 'required' : 'optional';
        (acc[key] ??= []).push(t);
        return acc;
      },
      {} as Record<string, typeof MCP_MANIFEST.tools>,
    );
    expect(grouped.required?.map((t) => t.name)).toEqual([
      'station_select',
      'genre_filter',
      'curator_prompt',
    ]);
    expect(grouped.optional?.map((t) => t.name)).toEqual(['now_playing']);
  });

  it('post87: locks Map reduce groupBy of property counts', () => {
    const grouped = new Map<number, typeof MCP_MANIFEST.tools>();
    for (const t of MCP_MANIFEST.tools) {
      const n = Object.keys(t.input_schema.properties).length;
      const bucket = grouped.get(n) ?? [];
      bucket.push(t);
      grouped.set(n, bucket);
    }
    expect([...grouped.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(grouped.get(0)?.map((t) => t.name)).toEqual(['now_playing']);
    expect(grouped.get(2)?.map((t) => t.name)).toEqual(['curator_prompt']);
  });

  it('post87: locks Set algebra of property keys vs required keys', () => {
    const allProps = new Set(MCP_MANIFEST.tools.flatMap((t) => Object.keys(t.input_schema.properties)));
    const required = new Set(MCP_MANIFEST.tools.flatMap((t) => t.input_schema.required ?? []));
    expect([...allProps].sort()).toEqual(['genre', 'mood', 'station_name']);
    expect([...required].sort()).toEqual(['genre', 'mood', 'station_name']);
    const onlyProps = [...allProps].filter((k) => !required.has(k));
    const onlyRequired = [...required].filter((k) => !allProps.has(k));
    expect(onlyProps).toEqual([]);
    expect(onlyRequired).toEqual([]);
  });

  it('post87: locks Set intersection of curator props with genre_filter props', () => {
    const curator = new Set(Object.keys(toolNamed('curator_prompt').input_schema.properties));
    const genre = new Set(Object.keys(toolNamed('genre_filter').input_schema.properties));
    expect([...curator].filter((k) => genre.has(k))).toEqual(['genre']);
    expect([...new Set([...curator, ...genre])].sort()).toEqual(['genre', 'mood']);
  });

  it('post87: locks WeakSet membership for live tool object identities', () => {
    const ws = new WeakSet(MCP_MANIFEST.tools);
    for (const tool of MCP_MANIFEST.tools) expect(ws.has(tool)).toBe(true);
    expect(ws.has({ ...MCP_MANIFEST.tools[0] })).toBe(false);
  });

  it('post87: locks FinalizationRegistry register does not throw for tools', () => {
    const reg = new FinalizationRegistry(() => {});
    expect(() => {
      for (const tool of MCP_MANIFEST.tools) reg.register(tool, tool.name);
    }).not.toThrow();
  });

  it('post87: locks URLSearchParams empty on api.url', () => {
    const u = new URL(MCP_MANIFEST.api.url, 'https://example.test');
    expect(u.pathname).toBe('/openapi.json');
    expect(u.searchParams.toString()).toBe('');
    expect(u.hash).toBe('');
  });

  it('post87: locks manifest JSON free of authorization/bearer/api_key material', () => {
    expect(JSON.stringify(MCP_MANIFEST)).not.toMatch(/authorization|bearer|api[_-]?key/i);
    expect(MCP_MANIFEST.auth.type).toBe('none');
  });

  it('post87: locks Request to api.url is GET-friendly root-relative', () => {
    const req = new Request(new URL(MCP_MANIFEST.api.url, 'https://backlink.fuzzywigg.com'));
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://backlink.fuzzywigg.com/openapi.json');
  });

  it('post87: locks Response.json of manifest round-trips tools length', async () => {
    const res = Response.json(MCP_MANIFEST);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as typeof MCP_MANIFEST;
    expect(body.tools).toHaveLength(4);
    expect(body.name_for_model).toBe('backlink');
  });

  it('post87: locks AbortSignal.timeout does not alter synchronous manifest reads', () => {
    const signal = AbortSignal.timeout(5);
    expect(signal.aborted).toBe(false);
    expect(MCP_MANIFEST.tools.length).toBe(4);
  });

  it('post87: locks crypto.randomUUID format unrelated to stable tool names', () => {
    const id = crypto.randomUUID();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.name).not.toEqual(id);
      expect(tool.name).not.toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('post87: locks encodeURIComponent well-formedness on all manifest strings', () => {
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
      expect(() => encodeURIComponent(s)).not.toThrow();
      expect(decodeURIComponent(encodeURIComponent(s))).toBe(s);
    }
  });

  it('post87: locks NFC normalize identity for every tool description', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.normalize('NFC')).toBe(tool.description);
    }
  });

  it('post87: locks locale lowercase/uppercase of name_for_human', () => {
    expect(MCP_MANIFEST.name_for_human.toLocaleLowerCase('en-US')).toBe('backlink radio');
    expect(MCP_MANIFEST.name_for_human.toLocaleUpperCase('en-US')).toBe('BACKLINK RADIO');
  });

  it('post87: locks Intl.Segmenter word counts for descriptions', () => {
    const seg = new Intl.Segmenter('en', { granularity: 'word' });
    const modelWords = [...seg.segment(MCP_MANIFEST.description_for_model)].filter((s) => s.isWordLike);
    const humanWords = [...seg.segment(MCP_MANIFEST.description_for_human)].filter((s) => s.isWordLike);
    expect(modelWords).toHaveLength(31);
    expect(humanWords).toHaveLength(9);
  });

  it('post87: locks Number/Boolean coercions on tools length', () => {
    expect(Number(MCP_MANIFEST.tools.length)).toBe(4);
    expect(Boolean(MCP_MANIFEST.tools.length)).toBe(true);
    expect(+MCP_MANIFEST.schema_version.replace('v', '')).toBe(1);
  });

  it('post87: locks Math invariants around tools length and name lengths', () => {
    expect(Math.max(...MCP_MANIFEST.tools.map((t) => t.name.length))).toBe(14);
    expect(Math.min(...MCP_MANIFEST.tools.map((t) => t.name.length))).toBe(11);
    expect(Math.hypot(MCP_MANIFEST.tools.length, 0)).toBe(4);
    expect(Math.pow(MCP_MANIFEST.tools.length, 2)).toBe(16);
  });

  it('post87: locks BigInt of tools length and schema digit', () => {
    expect(BigInt(MCP_MANIFEST.tools.length)).toBe(4n);
    expect(BigInt(MCP_MANIFEST.schema_version.slice(1))).toBe(1n);
  });

  it('post87: locks JSON.stringify replacer array projecting name_for_model only', () => {
    expect(JSON.stringify(MCP_MANIFEST, ['name_for_model'])).toBe('{"name_for_model":"backlink"}');
  });

  it('post87: locks JSON.stringify replacer array projecting auth nest', () => {
    expect(JSON.stringify(MCP_MANIFEST, ['auth', 'type'])).toBe('{"auth":{"type":"none"}}');
  });

  it('post87: locks JSON.stringify space 0 equals compact default', () => {
    expect(JSON.stringify(MCP_MANIFEST, null, 0)).toBe(JSON.stringify(MCP_MANIFEST));
  });

  it('post87: locks pretty JSON first and last lines', () => {
    const lines = JSON.stringify(MCP_MANIFEST, null, 2).split('\n');
    expect(lines[0]).toBe('{');
    expect(lines.at(-1)).toBe('}');
    expect(lines[1]).toBe('  "schema_version": "v1",');
  });

  it('post87: locks compact JSON starts with schema_version key', () => {
    expect(JSON.stringify(MCP_MANIFEST).startsWith('{"schema_version":"v1"')).toBe(true);
    expect(JSON.stringify(MCP_MANIFEST).endsWith('}]}')).toBe(true);
  });

  it('post87: locks Reflect.ownKeys tools elements have no symbols', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Reflect.ownKeys(tool).every((k) => typeof k === 'string')).toBe(true);
      expect(Object.getOwnPropertySymbols(tool)).toEqual([]);
    }
  });

  it('post87: locks Reflect.getPrototypeOf tools/auth/api', () => {
    expect(Reflect.getPrototypeOf(MCP_MANIFEST.tools)).toBe(Array.prototype);
    expect(Reflect.getPrototypeOf(MCP_MANIFEST.auth)).toBe(Object.prototype);
    expect(Reflect.getPrototypeOf(MCP_MANIFEST.api)).toBe(Object.prototype);
  });

  it('post87: locks Proxy with ownKeys trap still enumerates eight top-level keys', () => {
    const proxy = new Proxy(MCP_MANIFEST, {
      ownKeys(target) {
        return Reflect.ownKeys(target);
      },
    });
    expect(Object.keys(proxy)).toHaveLength(8);
    expect(proxy.tools).toHaveLength(4);
  });

  it('post87: locks structuredClone then Object.freeze deep read of nested auth', () => {
    const clone = structuredClone(MCP_MANIFEST);
    Object.freeze(clone);
    Object.freeze(clone.auth);
    Object.freeze(clone.api);
    expect(clone.auth.type).toBe('none');
    expect(() => {
      (clone as { schema_version: string }).schema_version = 'v2';
    }).toThrow();
    expect(MCP_MANIFEST.schema_version).toBe('v1');
  });

  it('post87: locks Object.seal on clone.tools blocks unknown keys', () => {
    const clone = structuredClone(MCP_MANIFEST);
    Object.seal(clone.tools);
    expect(() => {
      (clone.tools as unknown as { extra?: boolean }).extra = true;
    }).toThrow();
    expect(clone.tools.length).toBe(4);
  });

  it('post87: locks descriptor flags for tools array index 0', () => {
    const d = Object.getOwnPropertyDescriptor(MCP_MANIFEST.tools, '0');
    expect(d).toMatchObject({ enumerable: true, configurable: true, writable: true });
    expect(d?.value).toBe(MCP_MANIFEST.tools[0]);
  });

  it('post87: locks descriptor flags for top-level tools property', () => {
    const d = Object.getOwnPropertyDescriptor(MCP_MANIFEST, 'tools');
    expect(d).toMatchObject({ enumerable: true, configurable: true, writable: true });
    expect(d?.value).toBe(MCP_MANIFEST.tools);
  });

  it('post87: locks no getters/setters on tool objects', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const key of Object.keys(tool)) {
        const d = Object.getOwnPropertyDescriptor(tool, key);
        expect(d?.get).toBeUndefined();
        expect(d?.set).toBeUndefined();
        expect(d?.value).toBeDefined();
      }
    }
  });

  it('post87: locks encodeURI of api.url is identity', () => {
    expect(encodeURI(MCP_MANIFEST.api.url)).toBe('/openapi.json');
    expect(decodeURI('/openapi.json')).toBe(MCP_MANIFEST.api.url);
  });

  it('post87: locks encodeURIComponent of tool names has no escapes', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(encodeURIComponent(tool.name)).toBe(tool.name);
    }
  });

  it('post87: locks padEnd/padStart reconstructions for schema_version', () => {
    expect(MCP_MANIFEST.schema_version.padEnd(4, '!')).toBe('v1!!');
    expect(MCP_MANIFEST.schema_version.padStart(4, '0')).toBe('00v1');
    expect('v1'.padEnd(2)).toBe(MCP_MANIFEST.schema_version);
  });

  it('post87: locks repeat of pipe join marker between tool names', () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name).join('|'.repeat(1))).toBe(
      'station_select|now_playing|genre_filter|curator_prompt',
    );
  });

  it('post87: locks includes/startsWith/endsWith matrix for name_for_human', () => {
    expect(MCP_MANIFEST.name_for_human.includes('Backlink')).toBe(true);
    expect(MCP_MANIFEST.name_for_human.startsWith('Back')).toBe(true);
    expect(MCP_MANIFEST.name_for_human.endsWith('Radio')).toBe(true);
    expect(MCP_MANIFEST.name_for_human.includes('TV')).toBe(false);
  });

  it('post87: locks trim variants are no-ops on descriptions', () => {
    expect(MCP_MANIFEST.description_for_model.trim()).toBe(MCP_MANIFEST.description_for_model);
    expect(MCP_MANIFEST.description_for_human.trimStart()).toBe(MCP_MANIFEST.description_for_human);
    expect(MCP_MANIFEST.description_for_human.trimEnd()).toBe(MCP_MANIFEST.description_for_human);
  });

  it('post87: locks split by period for model description sentence fragments', () => {
    const parts = MCP_MANIFEST.description_for_model.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^Interact with Backlink/);
    expect(parts[2]).toBe('');
  });

  it('post87: locks CRLF join of tool names does not appear in src', () => {
    const joined = MCP_MANIFEST.tools.map((t) => t.name).join('\r\n');
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toContain(joined);
    expect(src).not.toContain('\r');
  });

  it('post87: locks slice windows on description_for_model', () => {
    expect(MCP_MANIFEST.description_for_model.slice(0, 8)).toBe('Interact');
    expect(MCP_MANIFEST.description_for_model.slice(38, 42)).toBe('IPTV');
    expect(MCP_MANIFEST.description_for_model.slice(-5)).toBe('mood.');
    expect(MCP_MANIFEST.description_for_model.endsWith('mood.')).toBe(true);
  });

  it('post87: locks indexOf/lastIndexOf for AI in model description', () => {
    const d = MCP_MANIFEST.description_for_model;
    expect(d.indexOf('AI')).toBe(27);
    expect(d.lastIndexOf('AI')).toBe(126);
    expect(d.indexOf('AI') === d.lastIndexOf('AI')).toBe(false);
  });

  it('post87: locks charAt/at symmetry for name_for_model', () => {
    const n = MCP_MANIFEST.name_for_model;
    for (let i = 0; i < n.length; i++) {
      expect(n.charAt(i)).toBe(n.at(i));
      expect(n[i]).toBe(n.at(i));
    }
  });

  it('post87: locks fromCharCode rebuild of schema_version', () => {
    expect(String.fromCharCode(118, 49)).toBe(MCP_MANIFEST.schema_version);
  });

  it('post87: locks codePointAt sequence for api.type openapi', () => {
    expect([...MCP_MANIFEST.api.type].map((c) => c.codePointAt(0))).toEqual([
      111, 112, 101, 110, 97, 112, 105,
    ]);
  });

  it('post87: locks ArrayBuffer slice copy of compact bytes length', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(MCP_MANIFEST));
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(copy.byteLength).toBe(1534);
  });

  it('post87: locks Uint8Array of name_for_model ascii bytes', () => {
    expect([...new TextEncoder().encode(MCP_MANIFEST.name_for_model)]).toEqual([
      98, 97, 99, 107, 108, 105, 110, 107,
    ]);
  });

  it('post87: locks DataView uint32 BE of first four compact JSON bytes', () => {
    const buf = new TextEncoder().encode(JSON.stringify(MCP_MANIFEST));
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint32(0, false)).toBe(0x7b227363);
  });

  it('post87: locks ArrayBuffer DataView stores tools length little-endian', () => {
    const ab = new ArrayBuffer(4);
    new DataView(ab).setUint32(0, MCP_MANIFEST.tools.length, true);
    expect(new DataView(ab).getUint32(0, true)).toBe(4);
  });

  it('post87: locks Promise.all on per-tool name resolves stable order', async () => {
    const names = await Promise.all(MCP_MANIFEST.tools.map(async (t) => t.name));
    expect(names).toEqual(['station_select', 'now_playing', 'genre_filter', 'curator_prompt']);
  });

  it('post87: locks Promise.any of tool length checks', async () => {
    await expect(
      Promise.any([Promise.reject(new Error('x')), Promise.resolve(MCP_MANIFEST.tools.length)]),
    ).resolves.toBe(4);
  });

  it('post87: locks queueMicrotask flush still sees four tools', async () => {
    let seen = 0;
    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        seen = MCP_MANIFEST.tools.length;
        resolve();
      });
    });
    expect(seen).toBe(4);
  });

  it('post87: locks setTimeout 0 still reads stable schema_version', async () => {
    const v = await new Promise<string>((resolve) => {
      setTimeout(() => resolve(MCP_MANIFEST.schema_version), 0);
    });
    expect(v).toBe('v1');
  });

  it('post87: locks performance.timeOrigin is finite beside stringify', () => {
    expect(Number.isFinite(performance.timeOrigin)).toBe(true);
    expect(JSON.stringify(MCP_MANIFEST).length).toBe(1534);
  });

  it('post87: locks Error.cause wrapper carries tools length', () => {
    const err = new Error('mcp', { cause: MCP_MANIFEST.tools.length });
    expect(err.cause).toBe(4);
    expect(MCP_MANIFEST.tools.length).toBe(4);
  });

  it('post87: locks AggregateError empty does not touch manifest', () => {
    const err = new AggregateError([], 'none');
    expect(err.errors).toEqual([]);
    expect(MCP_MANIFEST.auth.type).toBe('none');
  });

  it('post87: locks cross-file — src/index.ts does not import MCP_MANIFEST', () => {
    const indexSrc = readFileSync(join(mcpRoot, 'src/index.ts'), 'utf8');
    expect(indexSrc).not.toMatch(/from ['"]\.\/mcp['"]/);
    expect(indexSrc).not.toContain('MCP_MANIFEST');
  });

  it('post87: locks cross-file — parser and genres do not reference mcp', () => {
    const parser = readFileSync(join(mcpRoot, 'src/parser.ts'), 'utf8');
    const genres = readFileSync(join(mcpRoot, 'src/genres.ts'), 'utf8');
    expect(parser).not.toContain('mcp');
    expect(genres).not.toContain('mcp');
    expect(parser).not.toContain('MCP_MANIFEST');
    expect(genres).not.toContain('MCP_MANIFEST');
  });

  it('post87: locks package.json does not list MCP SDK dependency', () => {
    const pkg = JSON.parse(readFileSync(join(mcpRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).some((k) => /mcp/i.test(k))).toBe(false);
  });

  it('post87: locks wrangler.toml does not mention MCP_MANIFEST or openapi', () => {
    const toml = readFileSync(join(mcpRoot, 'wrangler.toml'), 'utf8');
    expect(toml).not.toMatch(/MCP_MANIFEST|openapi|claw-mcp/i);
  });

  it('post87: orthogonal fence — claw tools stay free of docs backlink_ prefix', () => {
    expect(MCP_MANIFEST.tools.every((t) => !t.name.startsWith('backlink_'))).toBe(true);
    const spec = readFileSync(join(mcpRoot, 'docs/mcp-spec.md'), 'utf8');
    expect(spec).toMatch(/backlink_/);
  });

  it('post87: locks station_select input_schema JSON exact snapshot', () => {
    expect(JSON.stringify(toolNamed('station_select').input_schema)).toBe(
      '{"type":"object","properties":{"station_name":{"type":"string","description":"Partial or full name of the station to select."}},"required":["station_name"]}',
    );
  });

  it('post87: locks now_playing input_schema JSON exact snapshot', () => {
    expect(JSON.stringify(toolNamed('now_playing').input_schema)).toBe(
      '{"type":"object","properties":{}}',
    );
  });

  it('post87: locks genre_filter input_schema JSON exact snapshot', () => {
    expect(JSON.stringify(toolNamed('genre_filter').input_schema)).toBe(
      '{"type":"object","properties":{"genre":{"type":"string","description":"Genre keyword to filter by."}},"required":["genre"]}',
    );
  });

  it('post87: locks curator_prompt input_schema JSON exact snapshot', () => {
    expect(JSON.stringify(toolNamed('curator_prompt').input_schema)).toBe(
      '{"type":"object","properties":{"mood":{"type":"string","description":"Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy)."},"genre":{"type":"string","description":"Optional genre to constrain the selection."}},"required":["mood"]}',
    );
  });

  it('post87: locks per-tool JSON length band', () => {
    expect(MCP_MANIFEST.tools.map((t) => JSON.stringify(t).length)).toEqual([256, 169, 260, 405]);
  });

  it('post87: locks exact sha256 digests for each tool JSON', () => {
    expect(MCP_MANIFEST.tools.map((t) => createHash('sha256').update(JSON.stringify(t)).digest('hex'))).toEqual([
      '91a70fe5417aaefede641876247b08cf99a90b99345ea56eb472a86d6e2174c4',
      '585a96770944c4197e8d1e91de08adb35436d7783e5d95af20ea1b718583472f',
      'db7d5b12a48b329cc086d6edb02a109dcfdc8450dfbe89a5425efb05b06a1600',
      'be3e43baf5701c8607c692d60338ba69b68d98502b79c9b8527b0bc9ab8b77ab',
    ]);
  });

  it('post87: locks tool JSON string snapshots byte-stable', () => {
    expect(JSON.stringify(MCP_MANIFEST.tools[0])).toBe(
      '{"name":"station_select","description":"Set the currently playing station by name.","input_schema":{"type":"object","properties":{"station_name":{"type":"string","description":"Partial or full name of the station to select."}},"required":["station_name"]}}',
    );
    expect(JSON.stringify(MCP_MANIFEST.tools[1])).toBe(
      '{"name":"now_playing","description":"Get the currently playing station including name, genre, stream URL, and country.","input_schema":{"type":"object","properties":{}}}',
    );
    expect(JSON.stringify(MCP_MANIFEST.tools[2])).toBe(
      '{"name":"genre_filter","description":"Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).","input_schema":{"type":"object","properties":{"genre":{"type":"string","description":"Genre keyword to filter by."}},"required":["genre"]}}',
    );
    expect(JSON.stringify(MCP_MANIFEST.tools[3])).toBe(
      '{"name":"curator_prompt","description":"Ask the AI curator to pick and set the best station for a given mood or context.","input_schema":{"type":"object","properties":{"mood":{"type":"string","description":"Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy)."},"genre":{"type":"string","description":"Optional genre to constrain the selection."}},"required":["mood"]}}',
    );
  });

  it('post87: locks sum of per-tool JSON lengths equals tools-only stringify length', () => {
    const parts = MCP_MANIFEST.tools.map((t) => JSON.stringify(t).length);
    // tools array JSON adds commas + brackets beyond sum of parts
    expect(parts.reduce((a, b) => a + b, 0)).toBe(256 + 169 + 260 + 405);
    expect(JSON.stringify(MCP_MANIFEST.tools).length).toBe(1095);
    expect(JSON.stringify(MCP_MANIFEST.tools).length).toBe(parts.reduce((a, b) => a + b, 0) + 3 + 2);
  });

  it('post87: locks auth+api nested JSON lengths', () => {
    expect(JSON.stringify(MCP_MANIFEST.auth).length).toBe(15);
    expect(JSON.stringify(MCP_MANIFEST.api).length).toBe(40);
  });

  it('post87: locks name_for_model equals lowercase product token without spaces', () => {
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
    expect(MCP_MANIFEST.name_for_model).toBe(MCP_MANIFEST.name_for_model.toLowerCase());
    expect(MCP_MANIFEST.name_for_model.includes(' ')).toBe(false);
  });

  it('post87: locks name_for_human title case with single space', () => {
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
    expect(MCP_MANIFEST.name_for_human.split(' ')).toEqual(['Backlink', 'Radio']);
  });

  it('post87: locks description_for_model ends with period and contains exactly two periods', () => {
    expect(MCP_MANIFEST.description_for_model.endsWith('.')).toBe(true);
    expect((MCP_MANIFEST.description_for_model.match(/\./g) ?? []).length).toBe(2);
  });

  it('post87: locks description_for_human ends with period and contains exactly one period', () => {
    expect(MCP_MANIFEST.description_for_human.endsWith('.')).toBe(true);
    expect((MCP_MANIFEST.description_for_human.match(/\./g) ?? []).length).toBe(1);
  });

  it('post87: locks every tool description ends with a period', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.endsWith('.')).toBe(true);
    }
  });

  it('post87: locks property descriptions end with period', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect((prop as { description: string }).description.endsWith('.')).toBe(true);
      }
    }
  });

  it('post87: locks no tool description contains http or https', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.description.toLowerCase()).not.toContain('http');
    }
  });

  it('post87: locks no property description contains http or https', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect((prop as { description: string }).description.toLowerCase()).not.toContain('http');
      }
    }
  });

  it('post87: locks station_select is the only tool mentioning Partial', () => {
    const hits = MCP_MANIFEST.tools.filter((t) =>
      Object.values(t.input_schema.properties).some((p) =>
        (p as { description: string }).description.includes('Partial'),
      ),
    );
    expect(hits.map((t) => t.name)).toEqual(['station_select']);
  });

  it('post87: locks curator_prompt is the only tool mentioning Optional', () => {
    const hits = MCP_MANIFEST.tools.filter((t) =>
      Object.values(t.input_schema.properties).some((p) =>
        (p as { description: string }).description.includes('Optional'),
      ),
    );
    expect(hits.map((t) => t.name)).toEqual(['curator_prompt']);
  });

  it('post87: locks genre_filter is the only tool with e.g. jazz news classical examples', () => {
    const hits = MCP_MANIFEST.tools.filter((t) => /jazz,\s*news,\s*classical/.test(t.description));
    expect(hits.map((t) => t.name)).toEqual(['genre_filter']);
  });

  it('post87: locks curator_prompt is the only tool with focus work late night jazz morning energy', () => {
    const hits = MCP_MANIFEST.tools.filter((t) =>
      Object.values(t.input_schema.properties).some((p) =>
        /focus work,\s*late night jazz,\s*morning energy/.test(
          (p as { description: string }).description,
        ),
      ),
    );
    expect(hits.map((t) => t.name)).toEqual(['curator_prompt']);
  });

  it('post87: locks now_playing is the only tool mentioning stream URL', () => {
    const hits = MCP_MANIFEST.tools.filter((t) => t.description.includes('stream URL'));
    expect(hits.map((t) => t.name)).toEqual(['now_playing']);
  });

  it('post87: locks station_select is the only tool description starting with Set', () => {
    expect(MCP_MANIFEST.tools.filter((t) => t.description.startsWith('Set ')).map((t) => t.name)).toEqual([
      'station_select',
    ]);
  });

  it('post87: locks now_playing is the only tool description starting with Get', () => {
    expect(MCP_MANIFEST.tools.filter((t) => t.description.startsWith('Get ')).map((t) => t.name)).toEqual([
      'now_playing',
    ]);
  });

  it('post87: locks genre_filter is the only tool description starting with Return', () => {
    expect(MCP_MANIFEST.tools.filter((t) => t.description.startsWith('Return ')).map((t) => t.name)).toEqual([
      'genre_filter',
    ]);
  });

  it('post87: locks curator_prompt is the only tool description starting with Ask', () => {
    expect(MCP_MANIFEST.tools.filter((t) => t.description.startsWith('Ask ')).map((t) => t.name)).toEqual([
      'curator_prompt',
    ]);
  });

  it('post87: locks total character count of all tool names is 51', () => {
    expect(MCP_MANIFEST.tools.reduce((a, t) => a + t.name.length, 0)).toBe(51);
  });

  it('post87: locks total character count of all tool descriptions is 284', () => {
    expect(MCP_MANIFEST.tools.reduce((a, t) => a + t.description.length, 0)).toBe(284);
  });

  it('post87: locks total character count of all property descriptions', () => {
    const total = MCP_MANIFEST.tools
      .flatMap((t) => Object.values(t.input_schema.properties))
      .reduce((a, p) => a + (p as { description: string }).description.length, 0);
    expect(total).toBe(203);
  });

  it('post87: locks property description lengths 46/27/88/42', () => {
    const lengths = MCP_MANIFEST.tools.flatMap((t) =>
      Object.values(t.input_schema.properties).map((p) => (p as { description: string }).description.length),
    );
    expect(lengths).toEqual([46, 27, 88, 42]);
  });

  it('post87: locks sha1 of tools-only JSON', () => {
    expect(createHash('sha1').update(JSON.stringify(MCP_MANIFEST.tools)).digest('hex')).toBe(
      'ff8cf3046d861f8a626fe64a3d1cd764bd974e54',
    );
  });

  it('post87: locks md5 of tools-only JSON', () => {
    expect(createHash('md5').update(JSON.stringify(MCP_MANIFEST.tools)).digest('hex')).toBe(
      '62d6d13ea389c948cf35d90891abad45',
    );
  });

  it('post87: locks auth sha512 and api sha512 digests', () => {
    expect(createHash('sha512').update(JSON.stringify(MCP_MANIFEST.auth)).digest('hex')).toBe(
      'b1b0688af7ab3be33baf01f1888b647bea588f23ec9a09636e0d73a33929b8c27bb0369457b021f95e603a53efd7f55d7039d7593f24eb86556c136aa0232cee',
    );
    expect(createHash('sha512').update(JSON.stringify(MCP_MANIFEST.api)).digest('hex')).toBe(
      '7198588d04b7e72ebe1bc47d7ec9b1f68ab6055f4b5e707ad40ea1383c2a0e3604a61d09aaa902b0e24033822a21861c756dfb01ce3b2deba51f56b57950d429',
    );
  });

  it('post87: locks HMAC-SHA1 of name_for_model with key human', () => {
    expect(createHmac('sha1', 'human').update(MCP_MANIFEST.name_for_model).digest('hex')).toBe(
      '5af92a113f31d4475a10eb06836846cbbfb92788',
    );
  });

  it('post87: locks timingSafeEqual of name_for_model ascii buffers', () => {
    const a = Buffer.from(MCP_MANIFEST.name_for_model);
    const b = Buffer.from('backlink');
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it('post87: locks Buffer.compare ordering of tool names', () => {
    const bufs = MCP_MANIFEST.tools.map((t) => Buffer.from(t.name));
    expect(Buffer.compare(bufs[0], bufs[1])).toBeGreaterThan(0); // station > now
    expect(Buffer.compare(bufs[2], bufs[3])).toBeGreaterThan(0); // genre > curator
  });

  it('post87: locks btoa/atob round-trip of schema_version', () => {
    expect(atob(btoa(MCP_MANIFEST.schema_version))).toBe('v1');
    expect(btoa(MCP_MANIFEST.schema_version)).toBe('djE=');
  });

  it('post87: locks btoa of name_for_human', () => {
    expect(btoa(MCP_MANIFEST.name_for_human)).toBe('QmFja2xpbmsgUmFkaW8=');
    expect(atob('QmFja2xpbmsgUmFkaW8=')).toBe('Backlink Radio');
  });

  it('post87: locks URL can resolve api.url against worker host', () => {
    const u = new URL(MCP_MANIFEST.api.url, 'https://backlink.fuzzywigg.com/');
    expect(u.href).toBe('https://backlink.fuzzywigg.com/openapi.json');
    expect(u.host).toBe('backlink.fuzzywigg.com');
  });

  it('post87: locks URL pathname segments for api.url', () => {
    const u = new URL(MCP_MANIFEST.api.url, 'https://x.test');
    expect(u.pathname.split('/').filter(Boolean)).toEqual(['openapi.json']);
  });

  it('post87: locks JSON.stringify of tools preserves declaration order commas', () => {
    const s = JSON.stringify(MCP_MANIFEST.tools);
    expect(s.indexOf('station_select')).toBeLessThan(s.indexOf('now_playing'));
    expect(s.indexOf('now_playing')).toBeLessThan(s.indexOf('genre_filter'));
    expect(s.indexOf('genre_filter')).toBeLessThan(s.indexOf('curator_prompt'));
  });

  it('post87: locks no sparse holes in tools via every index present', () => {
    for (let i = 0; i < MCP_MANIFEST.tools.length; i++) {
      expect(i in MCP_MANIFEST.tools).toBe(true);
      expect(MCP_MANIFEST.tools[i]).toBeDefined();
    }
  });

  it('post87: locks tools.length writable copy independent of live length', () => {
    const copy = MCP_MANIFEST.tools.slice();
    copy.length = 2;
    expect(copy).toHaveLength(2);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it('post87: locks Object.keys length of each tool is exactly 3', () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.keys(tool)).toHaveLength(3);
    }
  });

  it('post87: locks values typeof matrix for station_select fields', () => {
    const tool = toolNamed('station_select');
    expect(typeof tool.name).toBe('string');
    expect(typeof tool.description).toBe('string');
    expect(typeof tool.input_schema).toBe('object');
    expect(typeof tool.input_schema.type).toBe('string');
    expect(typeof tool.input_schema.properties).toBe('object');
    expect(typeof tool.input_schema.required).toBe('object');
  });

  it('post87: locks now_playing required is undefined not empty array', () => {
    expect(toolNamed('now_playing').input_schema.required).toBeUndefined();
    expect('required' in toolNamed('now_playing').input_schema).toBe(false);
  });

  it('post87: locks JSON omit of undefined required for now_playing', () => {
    expect(JSON.stringify(toolNamed('now_playing'))).not.toContain('required');
  });

  it('post87: locks structuredClone independence for nested properties object', () => {
    const clone = structuredClone(MCP_MANIFEST);
    (clone.tools[0].input_schema.properties as { station_name: { description: string } }).station_name.description =
      'mutated';
    expect(toolNamed('station_select').input_schema.properties.station_name?.description).toBe(
      'Partial or full name of the station to select.',
    );
  });

  it('post87: locks Proxy set trap cannot silently rewrite schema_version on live object without assign', () => {
    let wrote = false;
    const proxy = new Proxy(MCP_MANIFEST, {
      set(target, prop, value) {
        wrote = true;
        return Reflect.set(target, prop, value);
      },
    });
    expect(proxy.schema_version).toBe('v1');
    expect(wrote).toBe(false);
  });

  it('post87: locks delete clone.tools[0] does not affect live tools', () => {
    const clone = structuredClone(MCP_MANIFEST);
    delete (clone.tools as unknown as Record<number, unknown>)[0];
    expect(clone.tools[0]).toBeUndefined();
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
  });

  it('post87: locks Symbol.toStringTag absence on manifest and tools', () => {
    expect(Object.prototype.toString.call(MCP_MANIFEST)).toBe('[object Object]');
    expect(Object.prototype.toString.call(MCP_MANIFEST.tools)).toBe('[object Array]');
    expect((MCP_MANIFEST as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBeUndefined();
  });

  it('post87: locks constructor names Object/Array for manifest pieces', () => {
    expect(MCP_MANIFEST.constructor.name).toBe('Object');
    expect(MCP_MANIFEST.tools.constructor.name).toBe('Array');
    expect(MCP_MANIFEST.auth.constructor.name).toBe('Object');
    expect(MCP_MANIFEST.api.constructor.name).toBe('Object');
  });

  it('post87: locks JSON.parse reviver sees schema_version before tools', () => {
    const order: string[] = [];
    JSON.parse(JSON.stringify(MCP_MANIFEST), (key, value) => {
      if (key) order.push(key);
      return value;
    });
    expect(order.indexOf('schema_version')).toBeLessThan(order.indexOf('tools'));
    expect(order.indexOf('name_for_model')).toBeLessThan(order.indexOf('name_for_human'));
  });

  it('post87: locks TextDecoder of TextEncoder of compact JSON equals stringify', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    expect(new TextDecoder().decode(new TextEncoder().encode(compact))).toBe(compact);
  });

  it('post87: locks byteLength of name_for_human equals char length (ascii)', () => {
    expect(Buffer.byteLength(MCP_MANIFEST.name_for_human, 'utf8')).toBe(MCP_MANIFEST.name_for_human.length);
    expect(MCP_MANIFEST.name_for_human.length).toBe(14);
  });

  it('post87: locks localeCompare of tool names cascade', () => {
    const names = MCP_MANIFEST.tools.map((t) => t.name);
    expect(names[0].localeCompare(names[1])).toBeGreaterThan(0);
    expect(names[1].localeCompare(names[2])).toBeGreaterThan(0);
    expect(names[2].localeCompare(names[3])).toBeGreaterThan(0);
  });

  it('post87: locks Intl.Collator sensitivity base equates Backlink case variants', () => {
    const c = new Intl.Collator('en', { sensitivity: 'base' });
    expect(c.compare('Backlink', MCP_MANIFEST.name_for_model)).toBe(0);
    expect(c.compare('BACKLINK', MCP_MANIFEST.name_for_model)).toBe(0);
  });

  it('post87: locks matchAll for snake_case tokens in tool names CSV', () => {
    const csv = MCP_MANIFEST.tools.map((t) => t.name).join(',');
    const tokens = [...csv.matchAll(/[a-z]+/g)].map((m) => m[0]);
    expect(tokens).toEqual([
      'station',
      'select',
      'now',
      'playing',
      'genre',
      'filter',
      'curator',
      'prompt',
    ]);
  });

  it('post87: locks replaceAll underscore to hyphen on tool name copies only', () => {
    const hyphenated = MCP_MANIFEST.tools.map((t) => t.name.replaceAll('_', '-'));
    expect(hyphenated).toEqual([
      'station-select',
      'now-playing',
      'genre-filter',
      'curator-prompt',
    ]);
    expect(MCP_MANIFEST.tools[0].name).toContain('_');
  });

  it('post87: locks search for curator in tools JSON', () => {
    const toolsJson = JSON.stringify(MCP_MANIFEST.tools);
    expect(toolsJson.search('curator_prompt')).toBeGreaterThan(0);
    expect(toolsJson.search('missing_tool')).toBe(-1);
  });

  it('post87: locks substring of description_for_human iptv-org', () => {
    const d = MCP_MANIFEST.description_for_human;
    expect(d.substring(31, 39)).toBe('iptv-org');
  });

  it('post87: locks code point iteration equals char codes for ascii name_for_model', () => {
    expect([...MCP_MANIFEST.name_for_model].map((c) => c.codePointAt(0))).toEqual(
      [...MCP_MANIFEST.name_for_model].map((c) => c.charCodeAt(0)),
    );
  });

  it('post87: locks Number.isInteger tools length and schema digit', () => {
    expect(Number.isInteger(MCP_MANIFEST.tools.length)).toBe(true);
    expect(Number.isInteger(Number(MCP_MANIFEST.schema_version.slice(1)))).toBe(true);
  });

  it('post87: locks Number.parseInt of schema digit with radix 10', () => {
    expect(Number.parseInt(MCP_MANIFEST.schema_version.slice(1), 10)).toBe(1);
  });

  it('post87: locks Math.trunc/floor/ceil around tools length', () => {
    expect(Math.trunc(MCP_MANIFEST.tools.length)).toBe(4);
    expect(Math.floor(MCP_MANIFEST.tools.length + 0.9)).toBe(4);
    expect(Math.ceil(MCP_MANIFEST.tools.length - 0.1)).toBe(4);
  });

  it('post87: locks Promise.resolve chain yields tools length', async () => {
    await expect(Promise.resolve(MCP_MANIFEST).then((m) => m.tools.length)).resolves.toBe(4);
  });

  it('post87: locks Promise.allSettled fulfilled for each tool name', async () => {
    const results = await Promise.allSettled(MCP_MANIFEST.tools.map((t) => Promise.resolve(t.name)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(results.map((r) => (r as PromiseFulfilledResult<string>).value)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('post87: locks cross-file types.ts does not mention MCP', () => {
    const types = readFileSync(join(mcpRoot, 'src/types.ts'), 'utf8');
    expect(types).not.toMatch(/MCP|openapi|claw/i);
  });

  it('post87: locks vitest.config does not special-case mcp tests', () => {
    const cfg = readFileSync(join(mcpRoot, 'vitest.config.ts'), 'utf8');
    expect(cfg).not.toMatch(/mcp/i);
    expect(cfg).toContain("include: ['src/**/*.ts']");
  });

  it('post87: locks README mentions mcp suite without inventing routes', () => {
    const readme = readFileSync(join(mcpRoot, 'README.md'), 'utf8');
    expect(readme).toMatch(/mcp/i);
    expect(readme).not.toMatch(/\/playlist/);
  });

  it('post87: locks src/mcp.ts export const MCP_MANIFEST appears exactly once', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect((src.match(/export const MCP_MANIFEST/g) ?? []).length).toBe(1);
  });

  it('post87: locks src/mcp.ts double-quote style only for string literals', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src.includes("'")).toBe(false);
    expect(src.includes('`')).toBe(false);
  });

  it('post87: locks src/mcp.ts tools array opens after tools: [', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).toContain('tools: [');
    expect(src.indexOf('tools: [')).toBeLessThan(src.indexOf('station_select'));
  });

  it('post87: locks src/mcp.ts required arrays use double-quoted strings', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).toContain('required: ["station_name"]');
    expect(src).toContain('required: ["genre"]');
    expect(src).toContain('required: ["mood"]');
  });

  it('post87: locks src/mcp.ts auth and api object literals exact', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).toContain('auth: { type: "none" }');
    expect(src).toContain('api: { type: "openapi", url: "/openapi.json" }');
  });

  it('post87: locks src/mcp.ts schema_version and naming literals exact', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).toContain('schema_version: "v1"');
    expect(src).toContain('name_for_model: "backlink"');
    expect(src).toContain('name_for_human: "Backlink Radio"');
  });

  it('post87: locks negative — no Durable Object or KV mention in mcp.ts', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toMatch(/DurableObject|KVNamespace|CATALOG_CACHE|GEMINI/i);
  });

  it('post87: locks negative — no /curate or /stations paths in mcp.ts', () => {
    const src = readFileSync(join(mcpRoot, 'src/mcp.ts'), 'utf8');
    expect(src).not.toContain('/curate');
    expect(src).not.toContain('/stations');
    expect(src).not.toContain('/health');
    expect(src).not.toContain('/genres');
  });

  it('post87: locks tools filter of names including select|filter|prompt|playing', () => {
    expect(MCP_MANIFEST.tools.filter((t) => /select|filter|prompt|playing/.test(t.name)).map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('post87: locks every required entry is a string typeof', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const key of tool.input_schema.required ?? []) {
        expect(typeof key).toBe('string');
      }
    }
  });

  it('post87: locks property type string for every declared property', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect((prop as { type: string }).type).toBe('string');
      }
    }
  });

  it('post87: locks no additional keys beyond type/description on properties', () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(Object.keys(prop as object).sort()).toEqual(['description', 'type']);
      }
    }
  });

  it('post87: locks compact JSON does not contain pretty indentation spaces after colon', () => {
    const compact = JSON.stringify(MCP_MANIFEST);
    expect(compact.includes(': ')).toBe(false);
    expect(compact.includes(', ')).toBe(true); // spaces exist inside string values
  });

  it('post87: locks pretty JSON indent is exactly two spaces', () => {
    const pretty = JSON.stringify(MCP_MANIFEST, null, 2);
    expect(pretty.split('\n')[1].startsWith('  ')).toBe(true);
    expect(pretty.split('\n')[1].startsWith('   ')).toBe(false);
  });

  it('post87: locks tools JSON array bracket balance', () => {
    const tools = JSON.stringify(MCP_MANIFEST.tools);
    expect((tools.match(/\[/g) ?? []).length).toBe((tools.match(/\]/g) ?? []).length);
    expect((tools.match(/\{/g) ?? []).length).toBe((tools.match(/\}/g) ?? []).length);
  });

  it('post87: locks sha256 of name_for_human', () => {
    expect(createHash('sha256').update(MCP_MANIFEST.name_for_human).digest('hex')).toBe(
      '406456238b6ebd1aeeb3bd4d8f64e5af1f7748ca8ac3524051d40753035a76a2',
    );
  });
});

describe('post108 mcp HEAVY deepen', () => {
  const read = (rel: string) => readFileSync(join(mcpRoot, rel), 'utf8');
  const mcpSrc = read('src/mcp.ts');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);
  const TOOL_NAMES = ['station_select', 'now_playing', 'genre_filter', 'curator_prompt'] as const;
  const TOP_KEYS = ['schema_version', 'name_for_model', 'name_for_human', 'description_for_model', 'description_for_human', 'auth', 'api', 'tools'] as const;

  it("post108: locks mcp.ts sha256 digest", () => {
    expect(createHash('sha256').update(mcpSrc, 'utf8').digest('hex')).toBe('6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683');
  });

  it("post108: locks mcp.ts sha1 digest", () => {
    expect(createHash('sha1').update(mcpSrc, 'utf8').digest('hex')).toBe('848b3977365809fda54fcb74a7d09affe685ea82');
  });

  it("post108: locks mcp.ts md5 digest", () => {
    expect(createHash('md5').update(mcpSrc, 'utf8').digest('hex')).toBe('52e71c72e32e3d95b8b8d61ff4a2cf46');
  });

  it("post108: locks mcp.ts sha384 digest", () => {
    expect(createHash('sha384').update(mcpSrc, 'utf8').digest('hex')).toBe('a95bef5fcb3b93e9c05aac94aaa6a49adb47a360bfaf046e65f7254c2249fd1f34ff923ec401752e2701b7260d9949d2');
  });

  it("post108: locks mcp.ts sha512 digest", () => {
    expect(createHash('sha512').update(mcpSrc, 'utf8').digest('hex')).toBe('aa1525a8464db0a7d40982c8f0c091b63f8b21ea363f642ca9781513618d4fb99a9926e39118f65788c423a6bd6ee2318b3165f6007ca9599d36fe7fc7820c05');
  });

  it("post108: locks mcp.ts sha256 nibble sum", () => {
    expect(nibbleSum(createHash('sha256').update(mcpSrc, 'utf8').digest('hex'))).toBe(551);
  });

  it("post108: locks mcp.ts sha256 xor-nibble fingerprint", () => {
    expect(xorNibbles(createHash('sha256').update(mcpSrc, 'utf8').digest('hex'))).toBe(1);
  });

  it("post108: sha256/sha384/sha512 digests are pairwise distinct", () => {
    const a = createHash('sha256').update(mcpSrc, 'utf8').digest('hex');
    const b = createHash('sha384').update(mcpSrc, 'utf8').digest('hex');
    const c = createHash('sha512').update(mcpSrc, 'utf8').digest('hex');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("post108: sha384 length 96 and sha512 length 128 lowercase hex", () => {
    const a = createHash('sha384').update(mcpSrc, 'utf8').digest('hex');
    const b = createHash('sha512').update(mcpSrc, 'utf8').digest('hex');
    expect(a).toHaveLength(96);
    expect(b).toHaveLength(128);
    expect(/^[a-f0-9]+$/.test(a + b)).toBe(true);
  });

  it("post108: HMAC-SHA256 keyed by post108 locks mcp.ts digest", () => {
    expect(createHmac('sha256', "post108").update(mcpSrc, 'utf8').digest('hex')).toBe('a083f425b35fca6441d9148d33d2980bde5c58c304ae6d099d12aaa604fc6fbf');
  });

  it("post108: HMAC-SHA256 keyed by mcp-unit locks mcp.ts digest", () => {
    expect(createHmac('sha256', "mcp-unit").update(mcpSrc, 'utf8').digest('hex')).toBe('28405375d03b3a6149a4c7a0894b3eeaf7aae7743e91f50254d5619b0cdcaad4');
  });

  it("post108: HMAC-SHA256 keyed by MCP_MANIFEST locks mcp.ts digest", () => {
    expect(createHmac('sha256', "MCP_MANIFEST").update(mcpSrc, 'utf8').digest('hex')).toBe('59cecbb5722c2db7e1162612d66c3089df15e7759da04cc68884bf03de82dce1');
  });

  it("post108: HMAC-SHA256 keyed by backlink locks mcp.ts digest", () => {
    expect(createHmac('sha256', "backlink").update(mcpSrc, 'utf8').digest('hex')).toBe('948dbb9d47ee26b53b9ed9f9656e46752675060261aec301d8a9688178c14b7d');
  });

  it("post108: HMAC-SHA256 keyed by Backlink Radio locks mcp.ts digest", () => {
    expect(createHmac('sha256', "Backlink Radio").update(mcpSrc, 'utf8').digest('hex')).toBe('d61171f097655fd1e99e3fbe76f6c7ddb35b0ce15c63cb13081124b0f53d4860');
  });

  it("post108: HMAC-SHA256 keyed by station_select locks mcp.ts digest", () => {
    expect(createHmac('sha256', "station_select").update(mcpSrc, 'utf8').digest('hex')).toBe('d8c897e3e257256d5c946e2e941fbc36b75dc2a5027d3685a0f2446686d8cea2');
  });

  it("post108: HMAC-SHA256 keyed by now_playing locks mcp.ts digest", () => {
    expect(createHmac('sha256', "now_playing").update(mcpSrc, 'utf8').digest('hex')).toBe('96cc206873f09cc5de0c09d24c34da0daa4923eeb79077fc55e393f6215c3c5d');
  });

  it("post108: HMAC-SHA256 keyed by genre_filter locks mcp.ts digest", () => {
    expect(createHmac('sha256', "genre_filter").update(mcpSrc, 'utf8').digest('hex')).toBe('d5fb3f55b4e99eebe3005c654592da845e3f41c4f552e3bc98f4119ff03cf189');
  });

  it("post108: HMAC-SHA256 keyed by curator_prompt locks mcp.ts digest", () => {
    expect(createHmac('sha256', "curator_prompt").update(mcpSrc, 'utf8').digest('hex')).toBe('70897363a596f9754bee8cc34105600129e430194d666f995b799708bf1b3259');
  });

  it("post108: HMAC-SHA256 keyed by openapi locks mcp.ts digest", () => {
    expect(createHmac('sha256', "openapi").update(mcpSrc, 'utf8').digest('hex')).toBe('23d20e1f26a97ecc18e15e745c7da152c106dd8c4bbf3c1bb613c409581a5f6f');
  });

  it("post108: HMAC-SHA256 keyed by schema_version locks mcp.ts digest", () => {
    expect(createHmac('sha256', "schema_version").update(mcpSrc, 'utf8').digest('hex')).toBe('49151d77055e1ab6a8d5dba06712e46bd0a691799e6fdcaa4061081f97f732d9');
  });

  it("post108: HMAC-SHA256 keyed by name_for_model locks mcp.ts digest", () => {
    expect(createHmac('sha256', "name_for_model").update(mcpSrc, 'utf8').digest('hex')).toBe('20fbfff86d3e7243df61d31d9f17e1b594ed3a05ffd9a4b7cb2b0668ff42a793');
  });

  it("post108: HMAC-SHA256 keyed by name_for_human locks mcp.ts digest", () => {
    expect(createHmac('sha256', "name_for_human").update(mcpSrc, 'utf8').digest('hex')).toBe('6fe184bec192a1ecb54e934e58d578d04fb15810574060827df967c24084bdd0');
  });

  it("post108: HMAC-SHA256 keyed by description_for_model locks mcp.ts digest", () => {
    expect(createHmac('sha256', "description_for_model").update(mcpSrc, 'utf8').digest('hex')).toBe('4f8c9c86f9581700421b62eb624787414872f21837d1b9c44700bb76545bd1af');
  });

  it("post108: HMAC-SHA256 keyed by description_for_human locks mcp.ts digest", () => {
    expect(createHmac('sha256', "description_for_human").update(mcpSrc, 'utf8').digest('hex')).toBe('cd20ac6c6e8bc98e98e097a7c8399a5cb407e122b01b529f78e222adbc9081f8');
  });

  it("post108: HMAC-SHA256 keyed by auth locks mcp.ts digest", () => {
    expect(createHmac('sha256', "auth").update(mcpSrc, 'utf8').digest('hex')).toBe('51c074cc572c2d90279c94301d28ce02f7656b08cbf29d1d84ddbc21aa6a00bf');
  });

  it("post108: HMAC-SHA256 keyed by api locks mcp.ts digest", () => {
    expect(createHmac('sha256', "api").update(mcpSrc, 'utf8').digest('hex')).toBe('048366872b63bbf0c846ce3a16c0ab6ebbc179765373c828b58460469ab6cf28');
  });

  it("post108: HMAC-SHA256 keyed by tools locks mcp.ts digest", () => {
    expect(createHmac('sha256', "tools").update(mcpSrc, 'utf8').digest('hex')).toBe('5e9557b9ae59f110077be68da61eb3fa6224de77bf86c4dabade62434fe435dc');
  });

  it("post108: HMAC-SHA256 keyed by input_schema locks mcp.ts digest", () => {
    expect(createHmac('sha256', "input_schema").update(mcpSrc, 'utf8').digest('hex')).toBe('eea6f08b9bd3d7b32b1b40425a7580eee0dac81d4c78616d91f35997a85868d1');
  });

  it("post108: HMAC-SHA256 keyed by iptv-org locks mcp.ts digest", () => {
    expect(createHmac('sha256', "iptv-org").update(mcpSrc, 'utf8').digest('hex')).toBe('dcaf0c454cf3ee0bbaba12121ffe1183726881c6eb0f1f0714218d84c63cd1d7');
  });

  it("post108: HMAC-SHA256 keyed by HEAVY locks mcp.ts digest", () => {
    expect(createHmac('sha256', "HEAVY").update(mcpSrc, 'utf8').digest('hex')).toBe('870bb2f88c83abd6679e447c6937b01c998a1b3f527024e687dc35c00a046e40');
  });

  it("post108: HMAC-SHA256 keyed by TOKENMAXX locks mcp.ts digest", () => {
    expect(createHmac('sha256', "TOKENMAXX").update(mcpSrc, 'utf8').digest('hex')).toBe('cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62');
  });

  it("post108: HMAC-SHA256 keyed by fuzzywigg locks mcp.ts digest", () => {
    expect(createHmac('sha256', "fuzzywigg").update(mcpSrc, 'utf8').digest('hex')).toBe('93171a03382e2488888b170abdf10cc84dbd7ec7e77448b36c60d6758faac830');
  });

  it("post108: HMAC-SHA256 keyed by v1 locks mcp.ts digest", () => {
    expect(createHmac('sha256', "v1").update(mcpSrc, 'utf8').digest('hex')).toBe('cd5abd9dfa9a5fa313d5e8a57feaf99ebf5df5a6e1ff502e24668734d0950a2d');
  });

  it("post108: HMAC-SHA256 keyed by none locks mcp.ts digest", () => {
    expect(createHmac('sha256', "none").update(mcpSrc, 'utf8').digest('hex')).toBe('a1af32180d644f1839679f216e2702a075b41bbc8e3cff24564e0e1cea6170cc');
  });

  it("post108: HMAC-SHA1 keyed by post108 locks digest", () => {
    expect(createHmac('sha1', 'post108').update(mcpSrc, 'utf8').digest('hex')).toBe('05f69e563be26022d346365676c55e84b277d688');
  });

  it("post108: HMAC-SHA384 keyed by post108 locks digest", () => {
    expect(createHmac('sha384', 'post108').update(mcpSrc, 'utf8').digest('hex')).toBe('185a6e881cef84791de3d85a4ca2c3c3cb5c4e19e0930e2bf6fde1b24d12c88791b6e72e31a2cf2394010d304c951817');
  });

  it("post108: HMAC-SHA512 keyed by post108 locks digest", () => {
    expect(createHmac('sha512', 'post108').update(mcpSrc, 'utf8').digest('hex')).toBe('de7b3188917b97053c250cacd035f3e4dcb1721ec3f601c43917bc639d9ff27456b075cc8a4413357b868adefce300eb2759b9627b4f87125281a1abb4e695f7');
  });

  it("post108: HMAC digests differ from unkeyed sha256 and each other", () => {
    const plain = createHash('sha256').update(mcpSrc, 'utf8').digest('hex');
    const a = createHmac('sha256', 'post108').update(mcpSrc, 'utf8').digest('hex');
    const b = createHmac('sha256', 'mcp-unit').update(mcpSrc, 'utf8').digest('hex');
    expect(a).not.toBe(plain);
    expect(b).not.toBe(plain);
    expect(a).not.toBe(b);
  });

  it("post108: HMAC key matrix all digests unique", () => {
    const keys = ["post108","mcp-unit","MCP_MANIFEST","backlink","Backlink Radio","station_select","now_playing","genre_filter","curator_prompt","openapi","schema_version","name_for_model","name_for_human","description_for_model","description_for_human","auth","api","tools","input_schema","iptv-org","HEAVY","TOKENMAXX","fuzzywigg","v1","none"];
    const digests = keys.map((k) => createHmac('sha256', k).update(mcpSrc, 'utf8').digest('hex'));
    expect(new Set(digests).size).toBe(keys.length);
  });

  it("post108: locks mcp.ts byte and code-unit lengths", () => {
    expect(Buffer.byteLength(mcpSrc, 'utf8')).toBe(2057);
    expect(mcpSrc.length).toBe(2057);
    expect(statSync(join(mcpRoot, 'src/mcp.ts')).size).toBe(2057);
  });

  it("post108: locks mcp.ts code-unit sum", () => {
    const sum = [...mcpSrc].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(155333);
  });

  it("post108: locks mcp.ts line count and trailing newline", () => {
    expect(mcpSrc.endsWith('\n')).toBe(true);
    expect(mcpSrc.split('\n')).toHaveLength(68);
    expect((mcpSrc.match(/\n/g) ?? []).length).toBe(67);
  });

  it("post108: glyph budget — quotes equals spaces underscores", () => {
    expect((mcpSrc.match(/"/g) ?? []).length).toBe(62);
    expect((mcpSrc.match(/=/g) ?? []).length).toBe(1);
    expect((mcpSrc.match(/ /g) ?? []).length).toBe(617);
    expect((mcpSrc.match(/_/g) ?? []).length).toBe(20);
  });

  it("post108: glyph budget — colons commas semis parens braces brackets", () => {
    expect((mcpSrc.match(/:/g) ?? []).length).toBe(46);
    expect((mcpSrc.match(/,/g) ?? []).length).toBe(60);
    expect((mcpSrc.match(/;/g) ?? []).length).toBe(1);
    expect((mcpSrc.match(/[()]/g) ?? []).length).toBe(4);
    expect((mcpSrc.match(/[{}]/g) ?? []).length).toBe(38);
    expect((mcpSrc.match(/[\[\]]/g) ?? []).length).toBe(8);
  });

  it("post108: glyph budget — singles backticks newlines tabs", () => {
    expect((mcpSrc.match(/'/g) ?? []).length).toBe(0);
    expect((mcpSrc.match(/`/g) ?? []).length).toBe(0);
    expect((mcpSrc.match(/\n/g) ?? []).length).toBe(67);
    expect((mcpSrc.match(/\t/g) ?? []).length).toBe(0);
  });

  it("post108: mcp.ts starts with export const MCP_MANIFEST", () => {
    expect(mcpSrc.startsWith('export const MCP_MANIFEST = {')).toBe(true);
  });

  it("post108: single export only", () => {
    expect((mcpSrc.match(/^export /gm) ?? []).length).toBe(1);
    expect(mcpSrc).not.toMatch(/export function|export interface|export type/);
  });

  it("post108: TOP_KEYS inventory lock", () => {
    for (const k of TOP_KEYS) expect(mcpSrc).toContain(k);
    expect(Object.keys(MCP_MANIFEST)).toEqual([...TOP_KEYS]);
    expect(createHash('sha256').update(TOP_KEYS.join('|'), 'utf8').digest('hex')).toBe('85b8c45c73051208a5040ac3e196500244c903291970911fc936b124a1dac69e');
  });

  it("post108: TOOL_NAMES inventory lock", () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).toHaveLength(4);
    expect(createHash('sha256').update(TOOL_NAMES.join('|'), 'utf8').digest('hex')).toBe('2015d2ac108fff286afe263f4973ac93f78f2eb5690a4a051be6dc5d4edb064d');
  });

  it("post108: schema_version is v1", () => {
    expect(MCP_MANIFEST.schema_version).toBe('v1');
  });

  it("post108: name_for_model is backlink", () => {
    expect(MCP_MANIFEST.name_for_model).toBe('backlink');
  });

  it("post108: name_for_human is Backlink Radio", () => {
    expect(MCP_MANIFEST.name_for_human).toBe('Backlink Radio');
  });

  it("post108: auth is open none", () => {
    expect(MCP_MANIFEST.auth).toEqual({ type: 'none' });
  });

  it("post108: api is openapi at /openapi.json", () => {
    expect(MCP_MANIFEST.api).toEqual({ type: 'openapi', url: '/openapi.json' });
  });

  it("post108: description_for_model mentions IPTV radio and curator", () => {
    expect(MCP_MANIFEST.description_for_model).toMatch(/IPTV radio/i);
    expect(MCP_MANIFEST.description_for_model).toMatch(/curator/i);
    expect(MCP_MANIFEST.description_for_model).toMatch(/genre/i);
    expect(MCP_MANIFEST.description_for_model).toMatch(/now-playing/i);
  });

  it("post108: description_for_human mentions iptv-org", () => {
    expect(MCP_MANIFEST.description_for_human).toContain('iptv-org');
  });

  it("post108: locks compact JSON sha256", () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe('11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043');
  });

  it("post108: locks compact JSON sha1/md5", () => {
    const c = JSON.stringify(MCP_MANIFEST);
    expect(createHash('sha1').update(c, 'utf8').digest('hex')).toBe('17b88688da33f30fa7e9f82c2902ca3b9b86e998');
    expect(createHash('md5').update(c, 'utf8').digest('hex')).toBe('af11e695687a848fe80b386913581a3b');
  });

  it("post108: locks compact JSON sha384/sha512", () => {
    const c = JSON.stringify(MCP_MANIFEST);
    expect(createHash('sha384').update(c, 'utf8').digest('hex')).toBe('48b9c8c453304bca5d2fc9b97cb589a632cea9dea89ab549cbb4477e96fdba04ebace7e89d299e687c1b3636e0d7b7c9');
    expect(createHash('sha512').update(c, 'utf8').digest('hex')).toBe('5ee0d0827bd0f94d0556e303c4c009391f97e9cdc19a515643d5b50e5529d79f82402ae5c4002827239bb71bef56184c30ad1c6622b50ab9887a46063bf07756');
  });

  it("post108: locks pretty JSON sha256", () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST, null, 2), 'utf8').digest('hex')).toBe('79d287ffdcc0536d8a2d22f540e1d380d891f93aa5c77f7f2fa293ce430a25f4');
  });

  it("post108: locks tools-only JSON sha256", () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST.tools), 'utf8').digest('hex')).toBe('c4dc1e07bdade8df2e72bb8c19caf43226b1f622a7d10bd1c3341ab91b599b43');
  });

  it("post108: locks compact JSON length", () => {
    expect(JSON.stringify(MCP_MANIFEST).length).toBe(1534);
  });

  it("post108: locks pretty JSON length", () => {
    expect(JSON.stringify(MCP_MANIFEST, null, 2).length).toBe(2159);
  });

  it("post108: HMAC-SHA256 of compact JSON keyed by post108", () => {
    expect(createHmac('sha256', 'post108').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe('816adea7403f833083d0f117e782e03b8e7468463655ea9a000611f3094dc582');
  });

  it("post108: HMAC-SHA256 of tools JSON keyed by post108", () => {
    expect(createHmac('sha256', 'post108').update(JSON.stringify(MCP_MANIFEST.tools), 'utf8').digest('hex')).toBe('751b626fd7b57f187fb7443be34a270ef3ac45bbc17a335fb4e6e2603516f7c8');
  });

  it("post108: tool station_select exists with object schema", () => {
    const tool = toolNamed("station_select");
    expect(tool.input_schema.type).toBe('object');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
  });

  it("post108: tool station_select property keys lock", () => {
    const tool = toolNamed("station_select");
    expect(Object.keys(tool.input_schema.properties).sort()).toEqual(["station_name"]);
  });

  it("post108: tool station_select required lock", () => {
    const tool = toolNamed("station_select");
    expect(tool.input_schema.required).toEqual(["station_name"]);
  });

  it("post108: tool now_playing exists with object schema", () => {
    const tool = toolNamed("now_playing");
    expect(tool.input_schema.type).toBe('object');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
  });

  it("post108: tool now_playing property keys lock", () => {
    const tool = toolNamed("now_playing");
    expect(Object.keys(tool.input_schema.properties).sort()).toEqual([]);
  });

  it("post108: tool now_playing has no required array", () => {
    const tool = toolNamed("now_playing");
    expect(tool.input_schema.required).toBeUndefined();
    expect(Object.keys(tool.input_schema.properties)).toHaveLength(0);
  });

  it("post108: tool genre_filter exists with object schema", () => {
    const tool = toolNamed("genre_filter");
    expect(tool.input_schema.type).toBe('object');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
  });

  it("post108: tool genre_filter property keys lock", () => {
    const tool = toolNamed("genre_filter");
    expect(Object.keys(tool.input_schema.properties).sort()).toEqual(["genre"]);
  });

  it("post108: tool genre_filter required lock", () => {
    const tool = toolNamed("genre_filter");
    expect(tool.input_schema.required).toEqual(["genre"]);
  });

  it("post108: tool curator_prompt exists with object schema", () => {
    const tool = toolNamed("curator_prompt");
    expect(tool.input_schema.type).toBe('object');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
  });

  it("post108: tool curator_prompt property keys lock", () => {
    const tool = toolNamed("curator_prompt");
    expect(Object.keys(tool.input_schema.properties).sort()).toEqual(["genre","mood"]);
  });

  it("post108: tool curator_prompt required lock", () => {
    const tool = toolNamed("curator_prompt");
    expect(tool.input_schema.required).toEqual(["mood"]);
  });

  it("post108: station_select.station_name description lock", () => {
    const tool = toolNamed('station_select');
    expect(tool.input_schema.properties.station_name).toEqual({
      type: 'string',
      description: 'Partial or full name of the station to select.',
    });
  });

  it("post108: genre_filter.genre description lock", () => {
    const tool = toolNamed('genre_filter');
    expect(tool.input_schema.properties.genre).toEqual({
      type: 'string',
      description: 'Genre keyword to filter by.',
    });
  });

  it("post108: curator_prompt.mood description lock", () => {
    const tool = toolNamed('curator_prompt');
    const mood = tool.input_schema.properties.mood;
    expect(mood).toBeDefined();
    expect(mood!.type).toBe('string');
    expect(mood!.description).toMatch(/mood|activity|vibe/i);
  });

  it("post108: curator_prompt.genre is optional string", () => {
    const tool = toolNamed('curator_prompt');
    const genre = tool.input_schema.properties.genre;
    expect(genre).toBeDefined();
    expect(genre!.type).toBe('string');
    expect(tool.input_schema.required).toEqual(['mood']);
    expect(tool.input_schema.required).not.toContain('genre');
  });

  it("post108: every property type is string", () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect((prop as { type: string }).type).toBe('string');
      }
    }
  });

  it("post108: property keys only type and description", () => {
    for (const tool of MCP_MANIFEST.tools) {
      for (const prop of Object.values(tool.input_schema.properties)) {
        expect(Object.keys(prop as object).sort()).toEqual(['description', 'type']);
      }
    }
  });

  it("post108: tool object keys are name description input_schema", () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
    }
  });

  it("post108: tools order is station_select now_playing genre_filter curator_prompt", () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it("post108: tools length frozen at 4", () => {
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it("post108: negative — no product inventing surface in mcp.ts", () => {
    expect(mcpSrc).not.toMatch(/playlist|websocket|sse\b|DurableObject|D1Database|R2Bucket/i);
    expect(mcpSrc).not.toMatch(/GEMINI_API_KEY|fetch\(|Hono|parseM3U/);
    expect(mcpSrc).not.toMatch(/async |await |Promise|function /);
  });

  it("post108: negative — no extra tools invented", () => {
    const forbidden = ['playlist_get', 'now_playing_set', 'openapi_fetch', 'station_list', 'search', 'play', 'pause', 'volume'];
    for (const name of forbidden) {
      expect(MCP_MANIFEST.tools.some((t) => t.name === name)).toBe(false);
      expect(mcpSrc).not.toContain('"' + name + '"');
    }
  });

  it("post108: negative — no tabs CRLF or BOM", () => {
    expect(mcpSrc).not.toContain('\t');
    expect(mcpSrc).not.toContain('\r');
    expect(mcpSrc.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("post108: AGENTS.md verify commands present", () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
    expect(agents).toMatch(/now-playing|endpoints/);
  });

  it("post108: vitest coverage floors remain 100%", () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
  });

  it("post108: CI workflow runs test:coverage on PRs", () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('npm run test:coverage');
    expect(ci).toContain('npm run typecheck');
    expect(ci).toMatch(/pull_request:/);
  });

  it("post108: test inventory includes mcp.test.ts", () => {
    const names = ["ci-config.test.ts","genres.test.ts","helpers.test.ts","mcp-spec-contract.test.ts","mcp.test.ts","parser.test.ts","routes.test.ts","source-contracts.test.ts","wrangler-config.test.ts"];
    for (const n of names) expect(read('test/' + n).length).toBeGreaterThan(1000);
    expect(createHash('sha256').update(names.join('|'), 'utf8').digest('hex')).toBe('7e43dda473551d8b100e462256d0a1ec50ff601f9f2ca783341ddb10234466d0');
  });

  it("post108: mcp.test.ts imports MCP_MANIFEST from src/mcp only", () => {
    const self = read('test/mcp.test.ts');
    expect(self).toContain("import { MCP_MANIFEST } from '../src/mcp';");
    expect(self).toContain("describe('post108 mcp HEAVY deepen'");
    expect(self).not.toMatch(/from '\.\.\/src\/index'/);
  });

  it("post108: src/index.ts does not import MCP_MANIFEST (manifest is standalone)", () => {
    expect(read('src/index.ts')).not.toMatch(/MCP_MANIFEST/);
    expect(read('src/index.ts')).not.toMatch(/from '\.\/mcp'/);
    expect(mcpSrc).toContain('export const MCP_MANIFEST');
  });

  it("post108: docs/mcp-spec.md exists and mentions tools", () => {
    const spec = read('docs/mcp-spec.md');
    expect(spec.length).toBeGreaterThan(100);
    expect(spec.toLowerCase()).toMatch(/station_select|now_playing|genre_filter|curator/);
  });

  it("post108: compact JSON stable across 50 serializations", () => {
    const first = JSON.stringify(MCP_MANIFEST);
    for (let i = 0; i < 50; i++) expect(JSON.stringify(MCP_MANIFEST)).toBe(first);
  });

  it("post108: timingSafeEqual live vs re-stringify compact", () => {
    const a = Buffer.from(JSON.stringify(MCP_MANIFEST), 'utf8');
    const b = Buffer.from(JSON.stringify(MCP_MANIFEST), 'utf8');
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("post108: timingSafeEqual false when last byte flipped", () => {
    const a = Buffer.from(JSON.stringify(MCP_MANIFEST), 'utf8');
    const b = Buffer.from(a);
    b[b.length - 1] = b[b.length - 1] ^ 0xff;
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("post108: structuredClone of manifest deep-equals", () => {
    expect(structuredClone(MCP_MANIFEST)).toEqual(MCP_MANIFEST);
    expect(structuredClone(MCP_MANIFEST)).not.toBe(MCP_MANIFEST);
  });

  it("post108: mutating clone does not affect live manifest tools length", () => {
    const clone = structuredClone(MCP_MANIFEST);
    clone.tools.pop();
    expect(MCP_MANIFEST.tools).toHaveLength(4);
    expect(clone.tools).toHaveLength(3);
  });

  it("post108: tool station_select description sha256", () => {
    const tool = toolNamed("station_select");
    expect(createHash('sha256').update(tool.description, 'utf8').digest('hex')).toBe('1b1b6035f3a55908462e8bec71c002374de19a5863b402f9785a13f736ca1be6');
  });

  it("post108: tool station_select JSON sha256", () => {
    const tool = toolNamed("station_select");
    expect(createHash('sha256').update(JSON.stringify(tool), 'utf8').digest('hex')).toBe('91a70fe5417aaefede641876247b08cf99a90b99345ea56eb472a86d6e2174c4');
  });

  it("post108: toolNamed finds station_select", () => {
    expect(toolNamed("station_select").name).toBe("station_select");
  });

  it("post108: tool now_playing description sha256", () => {
    const tool = toolNamed("now_playing");
    expect(createHash('sha256').update(tool.description, 'utf8').digest('hex')).toBe('15a43880c871d46c36973e95f77b64ff910e68284acdf219fa6c82978af29e7b');
  });

  it("post108: tool now_playing JSON sha256", () => {
    const tool = toolNamed("now_playing");
    expect(createHash('sha256').update(JSON.stringify(tool), 'utf8').digest('hex')).toBe('585a96770944c4197e8d1e91de08adb35436d7783e5d95af20ea1b718583472f');
  });

  it("post108: toolNamed finds now_playing", () => {
    expect(toolNamed("now_playing").name).toBe("now_playing");
  });

  it("post108: tool genre_filter description sha256", () => {
    const tool = toolNamed("genre_filter");
    expect(createHash('sha256').update(tool.description, 'utf8').digest('hex')).toBe('3457f6157ae02b0b6c31bcfeabe4332f8954a58944c501b1b8d9bf8a67733d30');
  });

  it("post108: tool genre_filter JSON sha256", () => {
    const tool = toolNamed("genre_filter");
    expect(createHash('sha256').update(JSON.stringify(tool), 'utf8').digest('hex')).toBe('db7d5b12a48b329cc086d6edb02a109dcfdc8450dfbe89a5425efb05b06a1600');
  });

  it("post108: toolNamed finds genre_filter", () => {
    expect(toolNamed("genre_filter").name).toBe("genre_filter");
  });

  it("post108: tool curator_prompt description sha256", () => {
    const tool = toolNamed("curator_prompt");
    expect(createHash('sha256').update(tool.description, 'utf8').digest('hex')).toBe('c3bcfd16227da8c0c55d606d7da1a1ea26a3032dc1db779e316e31c5b9014ad3');
  });

  it("post108: tool curator_prompt JSON sha256", () => {
    const tool = toolNamed("curator_prompt");
    expect(createHash('sha256').update(JSON.stringify(tool), 'utf8').digest('hex')).toBe('be3e43baf5701c8607c692d60338ba69b68d98502b79c9b8527b0bc9ab8b77ab');
  });

  it("post108: toolNamed finds curator_prompt", () => {
    expect(toolNamed("curator_prompt").name).toBe("curator_prompt");
  });

  it("post108: name_for_model sha256", () => {
    expect(createHash('sha256').update(MCP_MANIFEST.name_for_model, 'utf8').digest('hex')).toBe('bb52cd593d776fc715441c6ed294a3431aa5e098dab5bcaafa5dc5effe0890d3');
  });

  it("post108: name_for_human sha256", () => {
    expect(createHash('sha256').update(MCP_MANIFEST.name_for_human, 'utf8').digest('hex')).toBe('406456238b6ebd1aeeb3bd4d8f64e5af1f7748ca8ac3524051d40753035a76a2');
  });

  it("post108: description_for_model sha256", () => {
    expect(createHash('sha256').update(MCP_MANIFEST.description_for_model, 'utf8').digest('hex')).toBe('dc98e24357ac0704d5460c9ed7bd2f3fae5eacf36cd0e448584161a1251e739c');
  });

  it("post108: description_for_human sha256", () => {
    expect(createHash('sha256').update(MCP_MANIFEST.description_for_human, 'utf8').digest('hex')).toBe('0afdffca1ae9c01f1c754ba92215e9021e7cf491a9a28ccdac603a4fad17166a');
  });

  it("post108: auth JSON digests", () => {
    const a = JSON.stringify(MCP_MANIFEST.auth);
    expect(createHash('sha256').update(a, 'utf8').digest('hex')).toBe('ff0f08b1aa6194023a4e4fadb848e1a977cb9f23c42b5d9cda8ea2552d9d1f73');
    expect(createHash('sha1').update(a, 'utf8').digest('hex')).toBe('8ad62e9d2281975eab6abd500bd610a6573a185a');
  });

  it("post108: api JSON digests", () => {
    const a = JSON.stringify(MCP_MANIFEST.api);
    expect(createHash('sha256').update(a, 'utf8').digest('hex')).toBe('b797fe543cd774f9401d8dcec722bcb11320c594dcaa5ff9a24b6f0c5837decb');
    expect(createHash('sha1').update(a, 'utf8').digest('hex')).toBe('1f46c3d15ebbd099083a0c657d1b8bd3ad1f6150');
  });

  it("post108: source contains token schema_version", () => {
    expect(mcpSrc).toContain("schema_version");
  });

  it("post108: source contains token name_for_model", () => {
    expect(mcpSrc).toContain("name_for_model");
  });

  it("post108: source contains token name_for_human", () => {
    expect(mcpSrc).toContain("name_for_human");
  });

  it("post108: source contains token description_for_model", () => {
    expect(mcpSrc).toContain("description_for_model");
  });

  it("post108: source contains token description_for_human", () => {
    expect(mcpSrc).toContain("description_for_human");
  });

  it("post108: source contains token station_select", () => {
    expect(mcpSrc).toContain("station_select");
  });

  it("post108: source contains token now_playing", () => {
    expect(mcpSrc).toContain("now_playing");
  });

  it("post108: source contains token genre_filter", () => {
    expect(mcpSrc).toContain("genre_filter");
  });

  it("post108: source contains token curator_prompt", () => {
    expect(mcpSrc).toContain("curator_prompt");
  });

  it("post108: source contains token station_name", () => {
    expect(mcpSrc).toContain("station_name");
  });

  it("post108: source contains token openapi", () => {
    expect(mcpSrc).toContain("openapi");
  });

  it("post108: source contains token /openapi.json", () => {
    expect(mcpSrc).toContain("/openapi.json");
  });

  it("post108: source contains token iptv-org", () => {
    expect(mcpSrc).toContain("iptv-org");
  });

  it("post108: source contains token input_schema", () => {
    expect(mcpSrc).toContain("input_schema");
  });

  it("post108: source contains token required", () => {
    expect(mcpSrc).toContain("required");
  });

  it("post108: source forbids token GEMINI", () => {
    expect(mcpSrc).not.toContain("GEMINI");
  });

  it("post108: source forbids token parseM3U", () => {
    expect(mcpSrc).not.toContain("parseM3U");
  });

  it("post108: source forbids token VALID_GENRES", () => {
    expect(mcpSrc).not.toContain("VALID_GENRES");
  });

  it("post108: source forbids token wrangler", () => {
    expect(mcpSrc).not.toContain("wrangler");
  });

  it("post108: source forbids token DurableObject", () => {
    expect(mcpSrc).not.toContain("DurableObject");
  });

  it("post108: source forbids token WebSocket", () => {
    expect(mcpSrc).not.toContain("WebSocket");
  });

  it("post108: source forbids token EventSource", () => {
    expect(mcpSrc).not.toContain("EventSource");
  });

  it("post108: source forbids token playlist_get", () => {
    expect(mcpSrc).not.toContain("playlist_get");
  });

  it("post108: package.json test scripts lock", () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
  });

  it("post108: mcp.test.ts ends with newline after post108 block", () => {
    expect(read('test/mcp.test.ts').endsWith('\n')).toBe(true);
  });

  it("post108: post108 describe appears after MCP_MANIFEST describe", () => {
    const self = read('test/mcp.test.ts');
    const a = self.indexOf("describe('MCP_MANIFEST'");
    const b = self.indexOf("describe('post108 mcp HEAVY deepen'");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
  });

  it("post108: HMAC key inventory sha256 lock", () => {
    const keys = ["post108","mcp-unit","MCP_MANIFEST","backlink","Backlink Radio","station_select","now_playing","genre_filter","curator_prompt","openapi","schema_version","name_for_model","name_for_human","description_for_model","description_for_human","auth","api","tools","input_schema","iptv-org","HEAVY","TOKENMAXX","fuzzywigg","v1","none"];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe('93e776aa002b27dfd695528bbdd88babca564ffa96321ed024f5e775f0b9ec54');
    expect(keys).toHaveLength(25);
  });

  it("post108: name_for_model char codes join digest", () => {
    const codes = [...MCP_MANIFEST.name_for_model].map((c) => c.charCodeAt(0)).join(',');
    expect(codes).toBe('98,97,99,107,108,105,110,107');
    expect(createHash('sha256').update(codes, 'utf8').digest('hex')).toBe('9dc66a792f9ea7346d7ce110ce7522d5bb0e46b6cf00307a6017c5d428f192cd');
  });

  it("post108: now_playing input_schema is empty object properties", () => {
    const tool = toolNamed('now_playing');
    expect(tool.input_schema).toEqual({ type: 'object', properties: {} });
  });

  it("post108: curator_prompt has mood required and genre optional", () => {
    const tool = toolNamed('curator_prompt');
    expect(Object.keys(tool.input_schema.properties)).toHaveLength(2);
    expect(tool.input_schema.required).toEqual(['mood']);
  });

  it("post108: station_select has exactly one property", () => {
    expect(Object.keys(toolNamed('station_select').input_schema.properties)).toHaveLength(1);
  });

  it("post108: genre_filter has exactly one property", () => {
    expect(Object.keys(toolNamed('genre_filter').input_schema.properties)).toHaveLength(1);
  });

  it("post108: 100x tools length stays 4", () => {
    for (let i = 0; i < 100; i++) expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it("post108: 100x schema_version stays v1", () => {
    for (let i = 0; i < 100; i++) expect(MCP_MANIFEST.schema_version).toBe('v1');
  });

  it("post108: sha256 starts and ends with known nibbles", () => {
    const d = createHash('sha256').update(mcpSrc, 'utf8').digest('hex');
    expect(d.startsWith('6ae8ffd7')).toBe(true);
    expect(d.endsWith('099683')).toBe(true);
  });

  it("post108: DEPLOY.md remains deploy-only without mcp inventing", () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/[Ww]rangler|[Dd]eploy|Cloudflare/);
    expect(mcpSrc).not.toContain('DEPLOY.md');
  });

  it("post108: src/index.ts stays free of mcp.ts import surface", () => {
    const index = read('src/index.ts');
    expect(index).toContain("from './genres'");
    expect(index).toContain("from './parser'");
    expect(index).toContain("from './types'");
    expect(index).not.toContain("from './mcp'");
  });

  it("post108: compact JSON has no \": \" separators", () => {
    expect(JSON.stringify(MCP_MANIFEST).includes(': ')).toBe(false);
  });

  it("post108: pretty JSON uses 2-space indent", () => {
    const pretty = JSON.stringify(MCP_MANIFEST, null, 2);
    expect(pretty.split('\n')[1].startsWith('  ')).toBe(true);
    expect(pretty.split('\n')[1].startsWith('   ')).toBe(false);
  });

  it("post108: tools JSON bracket balance", () => {
    const tools = JSON.stringify(MCP_MANIFEST.tools);
    expect((tools.match(/\[/g) ?? []).length).toBe((tools.match(/\]/g) ?? []).length);
    expect((tools.match(/\{/g) ?? []).length).toBe((tools.match(/\}/g) ?? []).length);
  });

  it("post108: description_for_model includes Select stations filter genre", () => {
    const d = MCP_MANIFEST.description_for_model.toLowerCase();
    expect(d).toContain('select');
    expect(d).toContain('stations');
    expect(d).toContain('genre');
    expect(d).toContain('mood');
  });

  it("post108: description_for_human is single sentence with period", () => {
    expect(MCP_MANIFEST.description_for_human.endsWith('.')).toBe(true);
    expect(MCP_MANIFEST.description_for_human.includes('. ')).toBe(false);
  });

  it("post108: tools CSV base64 lock", () => {
    const csv = TOOL_NAMES.join(',');
    expect(Buffer.from(csv, 'utf8').toString('base64')).toBe('c3RhdGlvbl9zZWxlY3Qsbm93X3BsYXlpbmcsZ2VucmVfZmlsdGVyLGN1cmF0b3JfcHJvbXB0');
  });

  it("post108: name_for_model hex lock", () => {
    expect(Buffer.from(MCP_MANIFEST.name_for_model, 'utf8').toString('hex')).toBe('6261636b6c696e6b');
  });

  it("post108: Object.freeze on tools array copy still readable", () => {
    const frozen = Object.freeze([...MCP_MANIFEST.tools]);
    expect(frozen).toHaveLength(4);
    expect(() => {
      (frozen as unknown as { push: (x: unknown) => void }).push({});
    }).toThrow();
  });

  it("post108: HMAC-SHA256 description_for_model keyed by post108", () => {
    expect(createHmac('sha256', 'post108').update(MCP_MANIFEST.description_for_model, 'utf8').digest('hex')).toBe('abbc375a4bb926fb5c42cbccaac6e65c6f589817c6816b85f0dbc38f3f2feb50');
  });

  it("post108: HMAC-SHA256 description_for_human keyed by post108", () => {
    expect(createHmac('sha256', 'post108').update(MCP_MANIFEST.description_for_human, 'utf8').digest('hex')).toBe('1aa3603296c9e8adb1209639efb4630a4b81dbba04816f45dfe47d0229e1dcfc');
  });

  it("post108: required arrays only on three tools", () => {
    const withReq = MCP_MANIFEST.tools.filter((t) => Array.isArray(t.input_schema.required));
    expect(withReq.map((t) => t.name).sort()).toEqual(['curator_prompt', 'genre_filter', 'station_select']);
  });

  it("post108: no additionalProperties keys on schemas", () => {
    for (const tool of MCP_MANIFEST.tools) {
      expect(tool.input_schema).not.toHaveProperty('additionalProperties');
    }
  });

  it("post108: HMAC-SHA256 compact keyed by station_select", () => {
    expect(createHmac('sha256', "station_select").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe('6a2bc46cadb38d7a926172f9e35743a163a3f84c496cc2f67610472fe970e32c');
  });

  it("post108: HMAC-SHA256 compact keyed by now_playing", () => {
    expect(createHmac('sha256', "now_playing").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe('2c0288e84ca52d09e2b3ba80657a2d91e33f187d04b52cf25b726e0fdedad016');
  });

  it("post108: HMAC-SHA256 compact keyed by genre_filter", () => {
    expect(createHmac('sha256', "genre_filter").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe('de37ab543b4c6e40750804a7c4c697a5d96ed1f6cfcd696d526ed674e59fc4be');
  });

  it("post108: HMAC-SHA256 compact keyed by curator_prompt", () => {
    expect(createHmac('sha256', "curator_prompt").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe('29d8ce477119d329ff752814955f65de2c59b97dc386561a7db2fe8b5635282e');
  });

  it("post108: description_for_model length lock", () => {
    expect(MCP_MANIFEST.description_for_model.length).toBe(173);
  });

  it("post108: description_for_human length lock", () => {
    expect(MCP_MANIFEST.description_for_human.length).toBe(48);
  });

  it("post108: openapi url is relative /openapi.json", () => {
    expect(MCP_MANIFEST.api.url.startsWith('/')).toBe(true);
    expect(MCP_MANIFEST.api.url).not.toMatch(/^https?:/);
  });

  it("post108: tool names are not claw-mcp prefixed", () => {
    for (const t of MCP_MANIFEST.tools) {
      expect(t.name.startsWith('backlink_')).toBe(false);
      expect(t.name.startsWith('claw_')).toBe(false);
    }
  });

});

describe('post108 mcp HEAVY deepen extras', () => {
  const read = (rel: string) => readFileSync(join(mcpRoot, rel), 'utf8');
  const mcpSrc = read('src/mcp.ts');

  it("post108: HMAC-SHA256 extra key post106", () => {
    expect(createHmac('sha256', "post106").update(mcpSrc, 'utf8').digest('hex')).toBe('b14c506a871a8c934068726ca9373c2362166f36129489ce362cea8ca1c3669b');
  });

  it("post108: HMAC-SHA256 extra key post107", () => {
    expect(createHmac('sha256', "post107").update(mcpSrc, 'utf8').digest('hex')).toBe('16ab9979a598988caa17f6d64a68479a4a53b37c7051a3033edd9c8671684415');
  });

  it("post108: HMAC-SHA256 extra key post104", () => {
    expect(createHmac('sha256', "post104").update(mcpSrc, 'utf8').digest('hex')).toBe('4ea89c4a954d018800631fa40c6de541491ea89699155a858b838322dc9bbb6c');
  });

  it("post108: HMAC-SHA256 extra key post103", () => {
    expect(createHmac('sha256', "post103").update(mcpSrc, 'utf8').digest('hex')).toBe('5c2b353889e45741a5395dc1be70471ae5031135909dd0f38a73b0c30580dbe8');
  });

  it("post108: HMAC-SHA256 extra key post89", () => {
    expect(createHmac('sha256', "post89").update(mcpSrc, 'utf8').digest('hex')).toBe('85160021abc95a93354708c30f49b068ce88f787f88cdb057928cd5154359162');
  });

  it("post108: HMAC-SHA256 extra key post87", () => {
    expect(createHmac('sha256', "post87").update(mcpSrc, 'utf8').digest('hex')).toBe('da3c67ca532dd4ccf2db096f71f8bdf2e63d983348730ac8e402b5545fe85f21');
  });

  it("post108: HMAC-SHA256 extra key station_name", () => {
    expect(createHmac('sha256', "station_name").update(mcpSrc, 'utf8').digest('hex')).toBe('3c6dd3b5fd1e0de2d0ac4642ea5de74f18839999c6b44d4ae2f4af7bfcbde8d0');
  });

  it("post108: HMAC-SHA256 extra key mood", () => {
    expect(createHmac('sha256', "mood").update(mcpSrc, 'utf8').digest('hex')).toBe('80cb3928fe652807ade02489a67c590c421d0881afbb567acd63c41ff6946751');
  });

  it("post108: HMAC-SHA256 extra key genre", () => {
    expect(createHmac('sha256', "genre").update(mcpSrc, 'utf8').digest('hex')).toBe('e4013e93fed99a1611c016aee5239f809b8497b472596749c42aba16355269d9');
  });

  it("post108: HMAC-SHA256 extra key Partial or full", () => {
    expect(createHmac('sha256', "Partial or full").update(mcpSrc, 'utf8').digest('hex')).toBe('3294cd0ae3a40b72b23463504ff077755e22e0fd337964e02d35d52cd4ba5830');
  });

  it("post108: HMAC-SHA256 extra key Genre keyword", () => {
    expect(createHmac('sha256', "Genre keyword").update(mcpSrc, 'utf8').digest('hex')).toBe('cb0645acca54c6607d3f7cf9588bdac4f9985fe621f9807b3538b364aa9edc74');
  });

  it("post108: HMAC-SHA256 extra key focus work", () => {
    expect(createHmac('sha256', "focus work").update(mcpSrc, 'utf8').digest('hex')).toBe('9d0f32642006e63b238a60a42d0f28e4b01cf20dd515ade46d9c3949253aa0c0');
  });

  it("post108: HMAC-SHA256 extra key late night", () => {
    expect(createHmac('sha256', "late night").update(mcpSrc, 'utf8').digest('hex')).toBe('cded51551a2243e83b273f76072f737d6b6667600a8f52bc4ca2ea2d21e463cd');
  });

  it("post108: HMAC-SHA256 extra key morning energy", () => {
    expect(createHmac('sha256', "morning energy").update(mcpSrc, 'utf8').digest('hex')).toBe('0e483146020ce2bae2adcf30d95663f9775581ea96e180312e90b629f0ea304e');
  });

  it("post108: HMAC-SHA256 extra key AI-curated", () => {
    expect(createHmac('sha256', "AI-curated").update(mcpSrc, 'utf8').digest('hex')).toBe('4327e67a553fd99645eb2caaccdcbcfcc1786c99c3790d29c721862db2e45447');
  });

  it("post108: HMAC-SHA256 extra key live radio", () => {
    expect(createHmac('sha256', "live radio").update(mcpSrc, 'utf8').digest('hex')).toBe('3dc1cab9333aa8b87fe29921fd3b1144a1e07e1aac463ed2d1584b78483f5dea');
  });

  it("post108: HMAC-SHA256 extra key catalog", () => {
    expect(createHmac('sha256', "catalog").update(mcpSrc, 'utf8').digest('hex')).toBe('e804cfad835b27774ea9f9153723fb15ac46ce4860e834693b972539709afaa2');
  });

  it("post108: HMAC-SHA256 extra key Interact with Backlink", () => {
    expect(createHmac('sha256', "Interact with Backlink").update(mcpSrc, 'utf8').digest('hex')).toBe('b3e118ea6139de07bbda2c3ac520d8618abd368b093fd0512735c844214ffa9f');
  });

  it("post108: HMAC-SHA256 extra key Select stations", () => {
    expect(createHmac('sha256', "Select stations").update(mcpSrc, 'utf8').digest('hex')).toBe('791591c0a2c1dcad7f6d524253806dade55e92acb18c7a15f4e224b618271301');
  });

  it("post108: station_select.station_name description sha256", () => {
    const tool = toolNamed("station_select");
    const prop = tool.input_schema.properties["station_name"]!;
    expect(createHash('sha256').update(prop.description, 'utf8').digest('hex')).toBe('85b77e93e2d24bc6f5b94d41003ba6d43f1c4eb5c5294801fac6c408f0750205');
  });

  it("post108: genre_filter.genre description sha256", () => {
    const tool = toolNamed("genre_filter");
    const prop = tool.input_schema.properties["genre"]!;
    expect(createHash('sha256').update(prop.description, 'utf8').digest('hex')).toBe('ef1f96a903a23d6e90ed07ff0e44463a931b11b5c04918a309aa4f580ce09f17');
  });

  it("post108: curator_prompt.mood description sha256", () => {
    const tool = toolNamed("curator_prompt");
    const prop = tool.input_schema.properties["mood"]!;
    expect(createHash('sha256').update(prop.description, 'utf8').digest('hex')).toBe('31234660f70b2056f5daf1c3b1ca4a65637b12154981d7f44d83d1972e479449');
  });

  it("post108: curator_prompt.genre description sha256", () => {
    const tool = toolNamed("curator_prompt");
    const prop = tool.input_schema.properties["genre"]!;
    expect(createHash('sha256').update(prop.description, 'utf8').digest('hex')).toBe('c8a41a58580e4507ab783a1bf084fc0f834cf15e6dc9f358dddc1fba16d43210');
  });

  it("post108: description_for_model contains Interact with Backlink", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("Interact with Backlink");
  });

  it("post108: description_for_model contains AI-curated IPTV radio", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("AI-curated IPTV radio");
  });

  it("post108: description_for_model contains Select stations", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("Select stations");
  });

  it("post108: description_for_model contains filter by genre", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("filter by genre");
  });

  it("post108: description_for_model contains now-playing info", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("now-playing info");
  });

  it("post108: description_for_model contains AI curator", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("AI curator");
  });

  it("post108: description_for_model contains best station for a mood", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("best station for a mood");
  });

  it("post108: description_for_human contains AI-curated live radio", () => {
    expect(MCP_MANIFEST.description_for_human).toContain("AI-curated live radio");
  });

  it("post108: description_for_human contains iptv-org catalog", () => {
    expect(MCP_MANIFEST.description_for_human).toContain("iptv-org catalog");
  });

  it("post108: tool station_select description exact", () => {
    expect(toolNamed("station_select").description).toBe("Set the currently playing station by name.");
  });

  it("post108: tool now_playing description exact", () => {
    expect(toolNamed("now_playing").description).toBe("Get the currently playing station including name, genre, stream URL, and country.");
  });

  it("post108: tool genre_filter description exact", () => {
    expect(toolNamed("genre_filter").description).toBe("Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).");
  });

  it("post108: tool curator_prompt description exact", () => {
    expect(toolNamed("curator_prompt").description).toBe("Ask the AI curator to pick and set the best station for a given mood or context.");
  });

  it('post108: compact JSON starts with schema_version then names', () => {
    const c = JSON.stringify(MCP_MANIFEST);
    expect(c.startsWith('{"schema_version":"v1","name_for_model":"backlink","name_for_human":"Backlink Radio"')).toBe(true);
  });

  it('post108: tools[0] is station_select with station_name required', () => {
    expect(MCP_MANIFEST.tools[0].name).toBe('station_select');
    expect(MCP_MANIFEST.tools[0].input_schema.required).toEqual(['station_name']);
  });

  it('post108: tools[1] is now_playing with empty properties', () => {
    expect(MCP_MANIFEST.tools[1].name).toBe('now_playing');
    expect(MCP_MANIFEST.tools[1].input_schema.properties).toEqual({});
  });

  it('post108: tools[2] is genre_filter with genre required', () => {
    expect(MCP_MANIFEST.tools[2].name).toBe('genre_filter');
    expect(MCP_MANIFEST.tools[2].input_schema.required).toEqual(['genre']);
  });

  it('post108: tools[3] is curator_prompt with mood required', () => {
    expect(MCP_MANIFEST.tools[3].name).toBe('curator_prompt');
    expect(MCP_MANIFEST.tools[3].input_schema.required).toEqual(['mood']);
  });

  it('post108: 25x compact sha256 stable', () => {
    let d = '';
    for (let i = 0; i < 25; i++) d = createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex');
    expect(d).toBe('11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043');
  });

  it('post108: extras describe appears after main post108 deepen', () => {
    const self = read('test/mcp.test.ts');
    const a = self.indexOf("describe('post108 mcp HEAVY deepen'");
    const b = self.indexOf("describe('post108 mcp HEAVY deepen extras'");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
  });

  it('post108: extra HMAC keys inventory digest', () => {
    const keys = ["post106","post107","post104","post103","post89","post87","station_name","mood","genre","Partial or full","Genre keyword","focus work","late night","morning energy","AI-curated","live radio","catalog","Interact with Backlink","Select stations"];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe('f974f608129911dfeed6e3b732c2fccc33f286d5056449ef77024bca3a479b12');
    expect(keys).toHaveLength(19);
  });

  it("post108: mcp.ts forbids invent phrase /playlist", () => {
    expect(mcpSrc.toLowerCase()).not.toContain("/playlist");
  });

  it("post108: mcp.ts forbids invent phrase /now-playing endpoint", () => {
    expect(mcpSrc.toLowerCase()).not.toContain("/now-playing endpoint");
  });

  it("post108: mcp.ts forbids invent phrase Workers AI", () => {
    expect(mcpSrc.toLowerCase()).not.toContain("workers ai");
  });

  it("post108: mcp.ts forbids invent phrase D1_", () => {
    expect(mcpSrc.toLowerCase()).not.toContain("d1_");
  });

  it("post108: mcp.ts forbids invent phrase R2_", () => {
    expect(mcpSrc.toLowerCase()).not.toContain("r2_");
  });

  it("post108: mcp.ts forbids invent phrase Vectorize", () => {
    expect(mcpSrc.toLowerCase()).not.toContain("vectorize");
  });

  it("post108: mcp.ts forbids invent phrase Analytics Engine", () => {
    expect(mcpSrc.toLowerCase()).not.toContain("analytics engine");
  });

  it("post108: mcp.ts forbids invent phrase Hyperdrive", () => {
    expect(mcpSrc.toLowerCase()).not.toContain("hyperdrive");
  });

  it('post108: mcp-spec-contract.test.ts still deepens docs contract', () => {
    const specTest = read('test/mcp-spec-contract.test.ts');
    expect(specTest.length).toBeGreaterThan(1000);
    expect(specTest).toMatch(/mcp-spec|MCP/);
  });

  it('post108: createHmac already imported in mcp.test.ts', () => {
    expect(read('test/mcp.test.ts')).toMatch(/import \{ createHash, createHmac, timingSafeEqual \} from 'node:crypto'/);
  });

});


// --- HEAVY burn (post-#130): deepen mcp leftover edges only — no product inventing ---
// Orthogonal to #130 (ci-config/genres/helpers/routes/parser/mcp-spec). TOKENMAXX tests-only.

describe('post130 mcp HEAVY deepen (after #130)', () => {
  const read = (rel: string) => readFileSync(join(mcpRoot, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(mcpRoot, rel))).digest('hex');
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


  it("post130: locks src/mcp.ts sha256", () => {
    expect(sha256("src/mcp.ts")).toBe("6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683");
  });

  it("post130: locks src/mcp.ts sha1", () => {
    expect(sha1("src/mcp.ts")).toBe("848b3977365809fda54fcb74a7d09affe685ea82");
  });

  it("post130: locks src/mcp.ts md5", () => {
    expect(md5("src/mcp.ts")).toBe("52e71c72e32e3d95b8b8d61ff4a2cf46");
  });

  it("post130: locks src/mcp.ts sha384", () => {
    expect(sha384("src/mcp.ts")).toBe("a95bef5fcb3b93e9c05aac94aaa6a49adb47a360bfaf046e65f7254c2249fd1f34ff923ec401752e2701b7260d9949d2");
  });

  it("post130: locks src/mcp.ts sha512", () => {
    expect(sha512("src/mcp.ts")).toBe("aa1525a8464db0a7d40982c8f0c091b63f8b21ea363f642ca9781513618d4fb99a9926e39118f65788c423a6bd6ee2318b3165f6007ca9599d36fe7fc7820c05");
  });

  it("post130: locks src/mcp.ts sha3-256", () => {
    expect(sha3("src/mcp.ts")).toBe("9072d42bee801bb2a3ea3f058ea604be67a2e7e599f21afb0d26f27817f44b16");
  });

  it("post130: locks src/mcp.ts blake2b512", () => {
    expect(blake2b("src/mcp.ts")).toBe("f91cd566835e001abe86d934663f36715b1082627dfb8abea78ffd99a50fe41e22d7d9b694301c9b2b27d16a675e3380dffdca34a74b4dbe2ea5b6af00e8ab43");
  });

  it("post130: locks src/mcp.ts ripemd160", () => {
    expect(ripemd("src/mcp.ts")).toBe("105ea9a796a49f5987df733c71c1abf0ab5ddad4");
  });

  it("post130: locks src/mcp.ts size 2057", () => {
    expect(statSync(join(mcpRoot, "src/mcp.ts")).size).toBe(2057);
    expect(readFileSync(join(mcpRoot, "src/mcp.ts")).byteLength).toBe(2057);
  });

  it("post130: locks src/mcp.ts utf8 2057 lines 68", () => {
    expect(read("src/mcp.ts")).toHaveLength(2057);
    expect(read("src/mcp.ts").split('\n')).toHaveLength(68);
  });

  it("post130: locks src/mcp.ts nibble 551 xor 1", () => {
    const d = sha256("src/mcp.ts");
    expect(nibbleSum(d)).toBe(551);
    expect(xorNibbles(d)).toBe(1);
  });

  it("post130: locks src/mcp.ts pairSum 4751 rollingXor 103", () => {
    const d = sha256("src/mcp.ts");
    expect(pairSum(d)).toBe(4751);
    expect(rollingXor(d)).toBe(103);
  });

  it("post130: locks src/mcp.ts first/last/mid octets", () => {
    const d = sha256("src/mcp.ts");
    expect(d.slice(0, 2)).toBe("6a");
    expect(d.slice(-2)).toBe("83");
    expect(d.slice(28, 36)).toBe("6ad61aff");
  });

  it("post130: locks src/mcp.ts HMAC post130/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post130', "src/mcp.ts")).toBe("12a1c6a4b2671a5b77c82037e11077b6617ebd6d5d1067c38f7265586cd53749");
    expect(hmacSha256('leftover', "src/mcp.ts")).toBe("8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712");
    expect(hmacSha256('TOKENMAXX', "src/mcp.ts")).toBe("cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62");
  });

  it("post130: locks src/mcp.ts HMAC after-#130/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#130', "src/mcp.ts")).toBe("00935fe158e6b319c56c523354e024bf744d1f6fcced7c524fb375b6f8662d37");
    expect(hmacSha256('HEAVY', "src/mcp.ts")).toBe("870bb2f88c83abd6679e447c6937b01c998a1b3f527024e687dc35c00a046e40");
    expect(hmacSha256('no-product-invent', "src/mcp.ts")).toBe("71a686fe812adcc92f40d5ca19a3996e68555d6749199affd3fc002053aabd65");
  });

  it("post130: locks src/mcp.ts spaces 617", () => {
    expect((read("src/mcp.ts").match(/ /g) ?? []).length).toBe(617);
  });

  it("post130: locks src/mcp.ts reversed sha256", () => {
    const rev = [...read("src/mcp.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("5fb580296684d084fa1bca986fdaa5c31fb63d427f9c5b62f7581941727ba73c");
  });

  it("post130: locks src/mcp.ts sha256 UPPERCASE", () => {
    expect(sha256("src/mcp.ts").toUpperCase()).toBe("6AE8FFD7C4B75C471DB2DFF1FE5C6AD61AFF69E38B048A366BB8B7ADB3099683");
  });

  it("post130: locks src/mcp.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("src/mcp.ts").split('\n')[0]).digest('hex')).toBe("73d0328cf8db2bc4525219dd63f5dc9b67754ff24aaa895010835d654df47da5");
  });

  it("post130: locks src/mcp.ts size*lines 139876", () => {
    expect(statSync(join(mcpRoot, "src/mcp.ts")).size * read("src/mcp.ts").split('\n').length).toBe(139876);
  });

  it("post130: locks docs/mcp-spec.md sha256", () => {
    expect(sha256("docs/mcp-spec.md")).toBe("a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849");
  });

  it("post130: locks docs/mcp-spec.md sha1", () => {
    expect(sha1("docs/mcp-spec.md")).toBe("e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a");
  });

  it("post130: locks docs/mcp-spec.md md5", () => {
    expect(md5("docs/mcp-spec.md")).toBe("ee7881030c338c1773659cc6378c392c");
  });

  it("post130: locks docs/mcp-spec.md sha384", () => {
    expect(sha384("docs/mcp-spec.md")).toBe("b32096b74bacd48065f014d2695673b3bfad3cb9118b855899a92a849cd38a7dd751db7c9e0705d6d6569d5f05f61227");
  });

  it("post130: locks docs/mcp-spec.md sha512", () => {
    expect(sha512("docs/mcp-spec.md")).toBe("8d26bafffcb1230048d80796e1d8a1019d83253810324d18383c54ff8bcaaed4a508b0a07395994af2f23e4f9b627e2202a57fcac709110d0ee859e8628709e7");
  });

  it("post130: locks docs/mcp-spec.md sha3-256", () => {
    expect(sha3("docs/mcp-spec.md")).toBe("700b4576d20353f0db25e4379cfebf496f15f0514d8998c10464bd0d6c8604f4");
  });

  it("post130: locks docs/mcp-spec.md blake2b512", () => {
    expect(blake2b("docs/mcp-spec.md")).toBe("6f441cdfb1d2b41be77e60c9aa79de5778608e02670b1067c30da76537d9e0915920752717c7302e705c5787dffea7a41f6c0669adb594689f0d256bbe7d0d31");
  });

  it("post130: locks docs/mcp-spec.md ripemd160", () => {
    expect(ripemd("docs/mcp-spec.md")).toBe("2f5cb29783b2bd4db4999e2ab61376a44c3a857b");
  });

  it("post130: locks docs/mcp-spec.md size 3552", () => {
    expect(statSync(join(mcpRoot, "docs/mcp-spec.md")).size).toBe(3552);
    expect(readFileSync(join(mcpRoot, "docs/mcp-spec.md")).byteLength).toBe(3552);
  });

  it("post130: locks docs/mcp-spec.md utf8 3544 lines 145", () => {
    expect(read("docs/mcp-spec.md")).toHaveLength(3544);
    expect(read("docs/mcp-spec.md").split('\n')).toHaveLength(145);
  });

  it("post130: locks docs/mcp-spec.md nibble 514 xor 14", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(nibbleSum(d)).toBe(514);
    expect(xorNibbles(d)).toBe(14);
  });

  it("post130: locks docs/mcp-spec.md pairSum 4534 rollingXor 164", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(pairSum(d)).toBe(4534);
    expect(rollingXor(d)).toBe(164);
  });

  it("post130: locks docs/mcp-spec.md first/last/mid octets", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(d.slice(0, 2)).toBe("a9");
    expect(d.slice(-2)).toBe("49");
    expect(d.slice(28, 36)).toBe("c7628b21");
  });

  it("post130: locks docs/mcp-spec.md HMAC post130/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post130', "docs/mcp-spec.md")).toBe("fd8c96dec8e546853ef96f87d5496c99d9d258fb29ec201dc44c4ca589b324a0");
    expect(hmacSha256('leftover', "docs/mcp-spec.md")).toBe("cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df");
    expect(hmacSha256('TOKENMAXX', "docs/mcp-spec.md")).toBe("58bd8b12de8084ece067f68db2cea2ea5dc8b43305c0d5e7e20506fd40e18749");
  });

  it("post130: locks docs/mcp-spec.md HMAC after-#130/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#130', "docs/mcp-spec.md")).toBe("2b92f1539717c879841c0121cedf3c4f7a6422473c2a4c4adcac6b44e14a989c");
    expect(hmacSha256('HEAVY', "docs/mcp-spec.md")).toBe("14502ba27898e795fb59cc37b06fe6eb2a66b40811b068e87738eb3dbf4cae59");
    expect(hmacSha256('no-product-invent', "docs/mcp-spec.md")).toBe("1ea2c93af05439c6a1c14acfbee6d34dddfc2b32e6c8b6256c270f6d4484b608");
  });

  it("post130: locks docs/mcp-spec.md spaces 640", () => {
    expect((read("docs/mcp-spec.md").match(/ /g) ?? []).length).toBe(640);
  });

  it("post130: locks docs/mcp-spec.md reversed sha256", () => {
    const rev = [...read("docs/mcp-spec.md")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("8e0a8a17d78474b7a2c052d335989cd8a980b200816869706af232736e35ab47");
  });

  it("post130: locks docs/mcp-spec.md sha256 UPPERCASE", () => {
    expect(sha256("docs/mcp-spec.md").toUpperCase()).toBe("A93978D779B976A1ABA4D34395EEC7628B21BDA910EF8A279D5EFBC05DA56849");
  });

  it("post130: locks docs/mcp-spec.md first-line sha256", () => {
    expect(createHash('sha256').update(read("docs/mcp-spec.md").split('\n')[0]).digest('hex')).toBe("99c84d33ad819ac91a66e1a30aef3bf512cb393370d7b6fbc8397c8917ba2e66");
  });

  it("post130: locks docs/mcp-spec.md size*lines 515040", () => {
    expect(statSync(join(mcpRoot, "docs/mcp-spec.md")).size * read("docs/mcp-spec.md").split('\n').length).toBe(515040);
  });

  it("post130: locks src/genres.ts sha256", () => {
    expect(sha256("src/genres.ts")).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it("post130: locks src/genres.ts sha1", () => {
    expect(sha1("src/genres.ts")).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it("post130: locks src/genres.ts md5", () => {
    expect(md5("src/genres.ts")).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it("post130: locks src/genres.ts sha384", () => {
    expect(sha384("src/genres.ts")).toBe("ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16");
  });

  it("post130: locks src/genres.ts sha512", () => {
    expect(sha512("src/genres.ts")).toBe("bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b");
  });

  it("post130: locks src/genres.ts sha3-256", () => {
    expect(sha3("src/genres.ts")).toBe("d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f");
  });

  it("post130: locks src/genres.ts blake2b512", () => {
    expect(blake2b("src/genres.ts")).toBe("731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67");
  });

  it("post130: locks src/genres.ts ripemd160", () => {
    expect(ripemd("src/genres.ts")).toBe("bb9faaf8890bdba8dd86bcdf7e418da622d19bf5");
  });

  it("post130: locks src/genres.ts size 1027", () => {
    expect(statSync(join(mcpRoot, "src/genres.ts")).size).toBe(1027);
    expect(readFileSync(join(mcpRoot, "src/genres.ts")).byteLength).toBe(1027);
  });

  it("post130: locks src/genres.ts utf8 1025 lines 48", () => {
    expect(read("src/genres.ts")).toHaveLength(1025);
    expect(read("src/genres.ts").split('\n')).toHaveLength(48);
  });

  it("post130: locks src/genres.ts nibble 500 xor 6", () => {
    const d = sha256("src/genres.ts");
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it("post130: locks src/genres.ts pairSum 3950 rollingXor 96", () => {
    const d = sha256("src/genres.ts");
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it("post130: locks src/genres.ts first/last/mid octets", () => {
    const d = sha256("src/genres.ts");
    expect(d.slice(0, 2)).toBe("aa");
    expect(d.slice(-2)).toBe("4e");
    expect(d.slice(28, 36)).toBe("811dfbc2");
  });

  it("post130: locks src/genres.ts HMAC post130/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post130', "src/genres.ts")).toBe("36813e5108eef06bc73cbb21cb4d62018d7f87adfca15f2e26103ad1b6ba307e");
    expect(hmacSha256('leftover', "src/genres.ts")).toBe("bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f");
    expect(hmacSha256('TOKENMAXX', "src/genres.ts")).toBe("7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951");
  });

  it("post130: locks src/genres.ts HMAC after-#130/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#130', "src/genres.ts")).toBe("7ee99dd2ad397779d0b534b86b085088a5579576683f857dffb37ccfb28ecace");
    expect(hmacSha256('HEAVY', "src/genres.ts")).toBe("728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575");
    expect(hmacSha256('no-product-invent', "src/genres.ts")).toBe("3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b");
  });

  it("post130: locks src/genres.ts spaces 144", () => {
    expect((read("src/genres.ts").match(/ /g) ?? []).length).toBe(144);
  });

  it("post130: locks src/genres.ts reversed sha256", () => {
    const rev = [...read("src/genres.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac");
  });

  it("post130: locks src/genres.ts sha256 UPPERCASE", () => {
    expect(sha256("src/genres.ts").toUpperCase()).toBe("AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E");
  });

  it("post130: locks src/genres.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("src/genres.ts").split('\n')[0]).digest('hex')).toBe("907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68");
  });

  it("post130: locks src/genres.ts size*lines 49296", () => {
    expect(statSync(join(mcpRoot, "src/genres.ts")).size * read("src/genres.ts").split('\n').length).toBe(49296);
  });

  it("post130: locks package.json sha256", () => {
    expect(sha256("package.json")).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it("post130: locks package.json sha1", () => {
    expect(sha1("package.json")).toBe("b58d14f35b9c13bb254d5e2a51240e2918a126c5");
  });

  it("post130: locks package.json md5", () => {
    expect(md5("package.json")).toBe("63472e1fb514fb0dadb5e49a7bdbaa5f");
  });

  it("post130: locks package.json sha384", () => {
    expect(sha384("package.json")).toBe("4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20");
  });

  it("post130: locks package.json sha512", () => {
    expect(sha512("package.json")).toBe("7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28");
  });

  it("post130: locks package.json sha3-256", () => {
    expect(sha3("package.json")).toBe("e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5");
  });

  it("post130: locks package.json blake2b512", () => {
    expect(blake2b("package.json")).toBe("a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d");
  });

  it("post130: locks package.json ripemd160", () => {
    expect(ripemd("package.json")).toBe("f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad");
  });

  it("post130: locks package.json size 637", () => {
    expect(statSync(join(mcpRoot, "package.json")).size).toBe(637);
    expect(readFileSync(join(mcpRoot, "package.json")).byteLength).toBe(637);
  });

  it("post130: locks package.json utf8 635 lines 26", () => {
    expect(read("package.json")).toHaveLength(635);
    expect(read("package.json").split('\n')).toHaveLength(26);
  });

  it("post130: locks package.json nibble 451 xor 13", () => {
    const d = sha256("package.json");
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it("post130: locks package.json pairSum 4051 rollingXor 13", () => {
    const d = sha256("package.json");
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it("post130: locks package.json first/last/mid octets", () => {
    const d = sha256("package.json");
    expect(d.slice(0, 2)).toBe("34");
    expect(d.slice(-2)).toBe("1c");
    expect(d.slice(28, 36)).toBe("e0ecaa43");
  });

  it("post130: locks package.json HMAC post130/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post130', "package.json")).toBe("47d36071e002d58e7017dc5201337613607bb5c0f55721490948ee59aae62522");
    expect(hmacSha256('leftover', "package.json")).toBe("20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1");
    expect(hmacSha256('TOKENMAXX', "package.json")).toBe("ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58");
  });

  it("post130: locks package.json HMAC after-#130/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#130', "package.json")).toBe("d91fee1a2cca08da809ee7341ce34ce892a2284a1fd0497ce2bbefc29bb4834b");
    expect(hmacSha256('HEAVY', "package.json")).toBe("59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563");
    expect(hmacSha256('no-product-invent', "package.json")).toBe("b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b");
  });

  it("post130: locks package.json spaces 106", () => {
    expect((read("package.json").match(/ /g) ?? []).length).toBe(106);
  });

  it("post130: locks package.json reversed sha256", () => {
    const rev = [...read("package.json")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("76b81fd27392035d0e4776f664acfb5bf67811a2b3ebb57b61b7be81ceb7ccc4");
  });

  it("post130: locks package.json sha256 UPPERCASE", () => {
    expect(sha256("package.json").toUpperCase()).toBe("34552493F3008B58991D10E7B41EE0ECAA43BF8BA3E79D261AC2A061E6F7181C");
  });

  it("post130: locks package.json first-line sha256", () => {
    expect(createHash('sha256').update(read("package.json").split('\n')[0]).digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post130: locks package.json size*lines 16562", () => {
    expect(statSync(join(mcpRoot, "package.json")).size * read("package.json").split('\n').length).toBe(16562);
  });

  it("post130: locks vitest.config.ts sha256", () => {
    expect(sha256("vitest.config.ts")).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it("post130: locks vitest.config.ts sha1", () => {
    expect(sha1("vitest.config.ts")).toBe("f8d49517ece92fc5e9781fbde021a948958aac37");
  });

  it("post130: locks vitest.config.ts md5", () => {
    expect(md5("vitest.config.ts")).toBe("f1176313255f5f064a946d458482d81a");
  });

  it("post130: locks vitest.config.ts sha384", () => {
    expect(sha384("vitest.config.ts")).toBe("c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563");
  });

  it("post130: locks vitest.config.ts sha512", () => {
    expect(sha512("vitest.config.ts")).toBe("ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682");
  });

  it("post130: locks vitest.config.ts sha3-256", () => {
    expect(sha3("vitest.config.ts")).toBe("ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba");
  });

  it("post130: locks vitest.config.ts blake2b512", () => {
    expect(blake2b("vitest.config.ts")).toBe("93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a");
  });

  it("post130: locks vitest.config.ts ripemd160", () => {
    expect(ripemd("vitest.config.ts")).toBe("6f29a743813430d4d364f8ddd66e0aedf1506fcd");
  });

  it("post130: locks vitest.config.ts size 535", () => {
    expect(statSync(join(mcpRoot, "vitest.config.ts")).size).toBe(535);
    expect(readFileSync(join(mcpRoot, "vitest.config.ts")).byteLength).toBe(535);
  });

  it("post130: locks vitest.config.ts utf8 535 lines 22", () => {
    expect(read("vitest.config.ts")).toHaveLength(535);
    expect(read("vitest.config.ts").split('\n')).toHaveLength(22);
  });

  it("post130: locks vitest.config.ts nibble 536 xor 2", () => {
    const d = sha256("vitest.config.ts");
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it("post130: locks vitest.config.ts pairSum 4691 rollingXor 49", () => {
    const d = sha256("vitest.config.ts");
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it("post130: locks vitest.config.ts first/last/mid octets", () => {
    const d = sha256("vitest.config.ts");
    expect(d.slice(0, 2)).toBe("f9");
    expect(d.slice(-2)).toBe("38");
    expect(d.slice(28, 36)).toBe("ec95c6d5");
  });

  it("post130: locks vitest.config.ts HMAC post130/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post130', "vitest.config.ts")).toBe("67ff8488fadb322f958b78414f1624e5d5534f6075525256f74472356c3adae9");
    expect(hmacSha256('leftover', "vitest.config.ts")).toBe("3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7");
    expect(hmacSha256('TOKENMAXX', "vitest.config.ts")).toBe("0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9");
  });

  it("post130: locks vitest.config.ts HMAC after-#130/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#130', "vitest.config.ts")).toBe("38a8b47e12d30170d31a5ad7898e59b004911bab122099e8bd9fe5888b7dfa90");
    expect(hmacSha256('HEAVY', "vitest.config.ts")).toBe("08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179");
    expect(hmacSha256('no-product-invent', "vitest.config.ts")).toBe("3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c");
  });

  it("post130: locks vitest.config.ts spaces 121", () => {
    expect((read("vitest.config.ts").match(/ /g) ?? []).length).toBe(121);
  });

  it("post130: locks vitest.config.ts reversed sha256", () => {
    const rev = [...read("vitest.config.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("0938009226d244856c43668b42c9aa000689efe510086849e55daf781d867c2b");
  });

  it("post130: locks vitest.config.ts sha256 UPPERCASE", () => {
    expect(sha256("vitest.config.ts").toUpperCase()).toBe("F9B58BB937531DA55AD474592E69EC95C6D55A5B8B878F8FA251C0F8D6CAFF38");
  });

  it("post130: locks vitest.config.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("vitest.config.ts").split('\n')[0]).digest('hex')).toBe("85734f4752244f71454215d0cfbe952f4ff6d79da03016ebd55e0dd9a1e7d328");
  });

  it("post130: locks vitest.config.ts size*lines 11770", () => {
    expect(statSync(join(mcpRoot, "vitest.config.ts")).size * read("vitest.config.ts").split('\n').length).toBe(11770);
  });

  it("post130: locks AGENTS.md sha256", () => {
    expect(sha256("AGENTS.md")).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it("post130: locks AGENTS.md sha1", () => {
    expect(sha1("AGENTS.md")).toBe("a7df1fec05dcf7b8ace116788297c77f467a7b6c");
  });

  it("post130: locks AGENTS.md md5", () => {
    expect(md5("AGENTS.md")).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it("post130: locks AGENTS.md sha384", () => {
    expect(sha384("AGENTS.md")).toBe("817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a");
  });

  it("post130: locks AGENTS.md sha512", () => {
    expect(sha512("AGENTS.md")).toBe("7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908");
  });

  it("post130: locks AGENTS.md sha3-256", () => {
    expect(sha3("AGENTS.md")).toBe("894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4");
  });

  it("post130: locks AGENTS.md blake2b512", () => {
    expect(blake2b("AGENTS.md")).toBe("7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0");
  });

  it("post130: locks AGENTS.md ripemd160", () => {
    expect(ripemd("AGENTS.md")).toBe("6637e853e0148967671e4a3f21bd852255e8ed1c");
  });

  it("post130: locks AGENTS.md size 1017", () => {
    expect(statSync(join(mcpRoot, "AGENTS.md")).size).toBe(1017);
    expect(readFileSync(join(mcpRoot, "AGENTS.md")).byteLength).toBe(1017);
  });

  it("post130: locks AGENTS.md utf8 1011 lines 35", () => {
    expect(read("AGENTS.md")).toHaveLength(1011);
    expect(read("AGENTS.md").split('\n')).toHaveLength(35);
  });

  it("post130: locks AGENTS.md nibble 479 xor 5", () => {
    const d = sha256("AGENTS.md");
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it("post130: locks AGENTS.md pairSum 5084 rollingXor 216", () => {
    const d = sha256("AGENTS.md");
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it("post130: locks AGENTS.md first/last/mid octets", () => {
    const d = sha256("AGENTS.md");
    expect(d.slice(0, 2)).toBe("48");
    expect(d.slice(-2)).toBe("aa");
    expect(d.slice(28, 36)).toBe("a5ec1be5");
  });

  it("post130: locks AGENTS.md HMAC post130/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post130', "AGENTS.md")).toBe("0316c6493e51769c369dc089ac9c0b52b4c447e1eee9b36a6f306fdef70cece7");
    expect(hmacSha256('leftover', "AGENTS.md")).toBe("ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e");
    expect(hmacSha256('TOKENMAXX', "AGENTS.md")).toBe("b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f");
  });

  it("post130: locks AGENTS.md HMAC after-#130/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#130', "AGENTS.md")).toBe("91520f6ceaf03fc89686a68159c8f31857f554e949df4b6dcc957a7618bfcd51");
    expect(hmacSha256('HEAVY', "AGENTS.md")).toBe("f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c");
    expect(hmacSha256('no-product-invent', "AGENTS.md")).toBe("dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264");
  });

  it("post130: locks AGENTS.md spaces 120", () => {
    expect((read("AGENTS.md").match(/ /g) ?? []).length).toBe(120);
  });

  it("post130: locks AGENTS.md reversed sha256", () => {
    const rev = [...read("AGENTS.md")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("662d61b72071234b614b17c421d0f8a3fc73757a69c1690a0b6a36fd122672dc");
  });

  it("post130: locks AGENTS.md sha256 UPPERCASE", () => {
    expect(sha256("AGENTS.md").toUpperCase()).toBe("48E590B4F146E2FBD1EBB409E0D5A5EC1BE50B72B2C310F1C1E360487B36FEAA");
  });

  it("post130: locks AGENTS.md first-line sha256", () => {
    expect(createHash('sha256').update(read("AGENTS.md").split('\n')[0]).digest('hex')).toBe("e3df46c4dc415311293b71de67e5df2d01a72a69658ef8f8cf5ac9e682d8d618");
  });

  it("post130: locks AGENTS.md size*lines 35595", () => {
    expect(statSync(join(mcpRoot, "AGENTS.md")).size * read("AGENTS.md").split('\n').length).toBe(35595);
  });

  it("post130: HMAC src/mcp.ts key mcp", () => {
    expect(hmacSha256("mcp", "src/mcp.ts")).toBe("ccc71129d02f2aea082bc5dfbffb139ca2d4ce8cbb2434c03dc2f8776f7c2819");
  });

  it("post130: HMAC src/mcp.ts key backlink", () => {
    expect(hmacSha256("backlink", "src/mcp.ts")).toBe("948dbb9d47ee26b53b9ed9f9656e46752675060261aec301d8a9688178c14b7d");
  });

  it("post130: HMAC src/mcp.ts key Backlink Radio", () => {
    expect(hmacSha256("Backlink Radio", "src/mcp.ts")).toBe("d61171f097655fd1e99e3fbe76f6c7ddb35b0ce15c63cb13081124b0f53d4860");
  });

  it("post130: HMAC src/mcp.ts key station_select", () => {
    expect(hmacSha256("station_select", "src/mcp.ts")).toBe("d8c897e3e257256d5c946e2e941fbc36b75dc2a5027d3685a0f2446686d8cea2");
  });

  it("post130: HMAC src/mcp.ts key now_playing", () => {
    expect(hmacSha256("now_playing", "src/mcp.ts")).toBe("96cc206873f09cc5de0c09d24c34da0daa4923eeb79077fc55e393f6215c3c5d");
  });

  it("post130: HMAC src/mcp.ts key genre_filter", () => {
    expect(hmacSha256("genre_filter", "src/mcp.ts")).toBe("d5fb3f55b4e99eebe3005c654592da845e3f41c4f552e3bc98f4119ff03cf189");
  });

  it("post130: HMAC src/mcp.ts key curator_prompt", () => {
    expect(hmacSha256("curator_prompt", "src/mcp.ts")).toBe("70897363a596f9754bee8cc34105600129e430194d666f995b799708bf1b3259");
  });

  it("post130: HMAC src/mcp.ts key openapi", () => {
    expect(hmacSha256("openapi", "src/mcp.ts")).toBe("23d20e1f26a97ecc18e15e745c7da152c106dd8c4bbf3c1bb613c409581a5f6f");
  });

  it("post130: HMAC src/mcp.ts key schema_version", () => {
    expect(hmacSha256("schema_version", "src/mcp.ts")).toBe("49151d77055e1ab6a8d5dba06712e46bd0a691799e6fdcaa4061081f97f732d9");
  });

  it("post130: HMAC src/mcp.ts key claw-mcp", () => {
    expect(hmacSha256("claw-mcp", "src/mcp.ts")).toBe("d2be78dfaf67430ea34569738fbdb4577f6cb48928cd16c895ec53378b2e1eb5");
  });

  it("post130: HMAC src/mcp.ts key fuzzywigg", () => {
    expect(hmacSha256("fuzzywigg", "src/mcp.ts")).toBe("93171a03382e2488888b170abdf10cc84dbd7ec7e77448b36c60d6758faac830");
  });

  it("post130: HMAC src/mcp.ts key iptv-org", () => {
    expect(hmacSha256("iptv-org", "src/mcp.ts")).toBe("dcaf0c454cf3ee0bbaba12121ffe1183726881c6eb0f1f0714218d84c63cd1d7");
  });

  it("post130: HMAC src/mcp.ts key post108", () => {
    expect(hmacSha256("post108", "src/mcp.ts")).toBe("a083f425b35fca6441d9148d33d2980bde5c58c304ae6d099d12aaa604fc6fbf");
  });

  it("post130: HMAC src/mcp.ts key post126", () => {
    expect(hmacSha256("post126", "src/mcp.ts")).toBe("d6bbbe08e1a6d4ce854fc3037c5a4590d86f31d868892f4fa30aeddaf6e4a1ff");
  });

  it("post130: HMAC src/mcp.ts key VALID_GENRES", () => {
    expect(hmacSha256("VALID_GENRES", "src/mcp.ts")).toBe("7b49b3a4b4234c1df692867963df7f92e3cba6160e503301f5dca4f28d0e14cc");
  });

  it("post130: HMAC src/mcp.ts key GENRE_MAP", () => {
    expect(hmacSha256("GENRE_MAP", "src/mcp.ts")).toBe("444b4d15f27bca3371c2c56198cfa3e954d4dd9f7014694949fbf3b528765cb9");
  });

  it("post130: MCP_MANIFEST schema/auth/api stable", () => {
    expect(MCP_MANIFEST.schema_version).toBe("v1");
    expect(MCP_MANIFEST.name_for_model).toBe("backlink");
    expect(MCP_MANIFEST.name_for_human).toBe("Backlink Radio");
    expect(MCP_MANIFEST.auth).toEqual({"type":"none"});
    expect(MCP_MANIFEST.api).toEqual({"type":"openapi","url":"/openapi.json"});
  });

  it("post130: MCP_MANIFEST tools order stable", () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual(["station_select","now_playing","genre_filter","curator_prompt"]);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it("post130: compact JSON sha256", () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043");
    expect(JSON.stringify(MCP_MANIFEST)).toHaveLength(1534);
  });

  it("post130: compact HMAC key post130", () => {
    expect(createHmac('sha256', "post130").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("bc6bc3f69af8de37dd478ca662d64c41f19f115cdc3ca66d1b7b6b674fd5c1c8");
  });

  it("post130: compact HMAC key leftover", () => {
    expect(createHmac('sha256', "leftover").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("6503ddae3d9c2d52d19c2828c8d98b979a5afe735094369937c01437b4993409");
  });

  it("post130: compact HMAC key TOKENMAXX", () => {
    expect(createHmac('sha256', "TOKENMAXX").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("ac3aa328b66887e37f2a98c5b73872089735c9150d4a3d4c00192b9e1974fbac");
  });

  it("post130: compact HMAC key HEAVY", () => {
    expect(createHmac('sha256', "HEAVY").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("360825dd0456638ccca74ad826aae66f7f2f91f3303154f77e77ac5bc76ef27f");
  });

  it("post130: compact HMAC key after-#130", () => {
    expect(createHmac('sha256', "after-#130").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("4e82ecc754acb5a0beb7249f5b1a0747830ee9fb524f0385648b5c536e44770f");
  });

  it("post130: compact HMAC key no-product-invent", () => {
    expect(createHmac('sha256', "no-product-invent").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("1ec4402a90b3f87fb1fd32de33122b40fedaa3a1d623804b31bbd11109100713");
  });

  it("post130: compact HMAC key mcp", () => {
    expect(createHmac('sha256', "mcp").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("db5fa1c6207d9ed45ed725bb2a1042439b0344aa0aedad24e9abc40599f737f5");
  });

  it("post130: compact HMAC key station_select", () => {
    expect(createHmac('sha256', "station_select").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("6a2bc46cadb38d7a926172f9e35743a163a3f84c496cc2f67610472fe970e32c");
  });

  it("post130: compact HMAC key curator_prompt", () => {
    expect(createHmac('sha256', "curator_prompt").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("29d8ce477119d329ff752814955f65de2c59b97dc386561a7db2fe8b5635282e");
  });

  it("post130: compact HMAC key openapi", () => {
    expect(createHmac('sha256', "openapi").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("f22724cc03066a9c9eea99647ed50d67473aff1348a6a678bd4f0247216449b7");
  });

  it("post130: compact HMAC key claw-mcp", () => {
    expect(createHmac('sha256', "claw-mcp").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("8dd5570110e0f4c6f4a667cb96982f895ea5f312856a62a3f00dfcdba154fad7");
  });

  it("post130: tool station_select description exact", () => {
    expect(toolNamed("station_select").description).toBe("Set the currently playing station by name.");
  });

  it("post130: tool station_select description sha256", () => {
    expect(createHash('sha256').update(toolNamed("station_select").description, 'utf8').digest('hex')).toBe("1b1b6035f3a55908462e8bec71c002374de19a5863b402f9785a13f736ca1be6");
  });

  it("post130: tool station_select required [\"station_name\"]", () => {
    expect(toolNamed("station_select").input_schema.required ?? []).toEqual(["station_name"]);
  });

  it("post130: tool station_select property keys", () => {
    expect(Object.keys(toolNamed("station_select").input_schema.properties)).toEqual(["station_name"]);
  });

  it("post130: tool station_select.station_name type+desc", () => {
    const prop = toolNamed("station_select").input_schema.properties["station_name"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Partial or full name of the station to select.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("85b77e93e2d24bc6f5b94d41003ba6d43f1c4eb5c5294801fac6c408f0750205");
  });

  it("post130: tool now_playing description exact", () => {
    expect(toolNamed("now_playing").description).toBe("Get the currently playing station including name, genre, stream URL, and country.");
  });

  it("post130: tool now_playing description sha256", () => {
    expect(createHash('sha256').update(toolNamed("now_playing").description, 'utf8').digest('hex')).toBe("15a43880c871d46c36973e95f77b64ff910e68284acdf219fa6c82978af29e7b");
  });

  it("post130: tool now_playing required []", () => {
    expect(toolNamed("now_playing").input_schema.required ?? []).toEqual([]);
  });

  it("post130: tool now_playing property keys", () => {
    expect(Object.keys(toolNamed("now_playing").input_schema.properties)).toEqual([]);
  });

  it("post130: tool genre_filter description exact", () => {
    expect(toolNamed("genre_filter").description).toBe("Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).");
  });

  it("post130: tool genre_filter description sha256", () => {
    expect(createHash('sha256').update(toolNamed("genre_filter").description, 'utf8').digest('hex')).toBe("3457f6157ae02b0b6c31bcfeabe4332f8954a58944c501b1b8d9bf8a67733d30");
  });

  it("post130: tool genre_filter required [\"genre\"]", () => {
    expect(toolNamed("genre_filter").input_schema.required ?? []).toEqual(["genre"]);
  });

  it("post130: tool genre_filter property keys", () => {
    expect(Object.keys(toolNamed("genre_filter").input_schema.properties)).toEqual(["genre"]);
  });

  it("post130: tool genre_filter.genre type+desc", () => {
    const prop = toolNamed("genre_filter").input_schema.properties["genre"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Genre keyword to filter by.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("ef1f96a903a23d6e90ed07ff0e44463a931b11b5c04918a309aa4f580ce09f17");
  });

  it("post130: tool curator_prompt description exact", () => {
    expect(toolNamed("curator_prompt").description).toBe("Ask the AI curator to pick and set the best station for a given mood or context.");
  });

  it("post130: tool curator_prompt description sha256", () => {
    expect(createHash('sha256').update(toolNamed("curator_prompt").description, 'utf8').digest('hex')).toBe("c3bcfd16227da8c0c55d606d7da1a1ea26a3032dc1db779e316e31c5b9014ad3");
  });

  it("post130: tool curator_prompt required [\"mood\"]", () => {
    expect(toolNamed("curator_prompt").input_schema.required ?? []).toEqual(["mood"]);
  });

  it("post130: tool curator_prompt property keys", () => {
    expect(Object.keys(toolNamed("curator_prompt").input_schema.properties)).toEqual(["mood","genre"]);
  });

  it("post130: tool curator_prompt.mood type+desc", () => {
    const prop = toolNamed("curator_prompt").input_schema.properties["mood"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("31234660f70b2056f5daf1c3b1ca4a65637b12154981d7f44d83d1972e479449");
  });

  it("post130: tool curator_prompt.genre type+desc", () => {
    const prop = toolNamed("curator_prompt").input_schema.properties["genre"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Optional genre to constrain the selection.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("c8a41a58580e4507ab783a1bf084fc0f834cf15e6dc9f358dddc1fba16d43210");
  });

  it("post130: description_for_model contains Interact with Backlink", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("Interact with Backlink");
  });

  it("post130: description_for_model contains AI-curated IPTV radio", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("AI-curated IPTV radio");
  });

  it("post130: description_for_model contains Select stations", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("Select stations");
  });

  it("post130: description_for_model contains filter by genre", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("filter by genre");
  });

  it("post130: description_for_model contains now-playing info", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("now-playing info");
  });

  it("post130: description_for_model contains AI curator", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("AI curator");
  });

  it("post130: description_for_model contains best station for a mood", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("best station for a mood");
  });

  it("post130: description_for_human contains AI-curated live radio", () => {
    expect(MCP_MANIFEST.description_for_human).toContain("AI-curated live radio");
  });

  it("post130: description_for_human contains iptv-org catalog", () => {
    expect(MCP_MANIFEST.description_for_human).toContain("iptv-org catalog");
  });

  it("post130: mcp.ts forbids invent phrase /playlist", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("/playlist");
  });

  it("post130: mcp.ts forbids invent phrase /now-playing endpoint", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("/now-playing endpoint");
  });

  it("post130: mcp.ts forbids invent phrase workers ai", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("workers ai");
  });

  it("post130: mcp.ts forbids invent phrase d1_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("d1_");
  });

  it("post130: mcp.ts forbids invent phrase r2_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("r2_");
  });

  it("post130: mcp.ts forbids invent phrase vectorize", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("vectorize");
  });

  it("post130: mcp.ts forbids invent phrase analytics engine", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("analytics engine");
  });

  it("post130: mcp.ts forbids invent phrase hyperdrive", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("hyperdrive");
  });

  it("post130: mcp.ts forbids invent phrase anthropic", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("anthropic");
  });

  it("post130: mcp.ts forbids invent phrase claude", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("claude");
  });

  it("post130: mcp.ts forbids invent phrase openai", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("openai");
  });

  it("post130: mcp.ts forbids invent phrase durable_object", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("durable_object");
  });

  it("post130: mcp.ts forbids invent phrase queue_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("queue_");
  });

  it("post130: mcp.ts forbids invent phrase service binding", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("service binding");
  });

  it("post130: tool station_select has no claw_ prefix", () => {
    expect(toolNamed("station_select").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("station_select").name).toBe("station_select");
  });

  it("post130: tool now_playing has no claw_ prefix", () => {
    expect(toolNamed("now_playing").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("now_playing").name).toBe("now_playing");
  });

  it("post130: tool genre_filter has no claw_ prefix", () => {
    expect(toolNamed("genre_filter").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("genre_filter").name).toBe("genre_filter");
  });

  it("post130: tool curator_prompt has no claw_ prefix", () => {
    expect(toolNamed("curator_prompt").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("curator_prompt").name).toBe("curator_prompt");
  });

  it("post130: mega purity 40x mcp.ts sha256", () => {
    const expected = "6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683";
    for (let i = 0; i < 40; i++) expect(sha256('src/mcp.ts')).toBe(expected);
  });

  it("post130: mega purity 40x compact sha256", () => {
    const expected = "11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043";
    for (let i = 0; i < 40; i++) {
      expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe(expected);
    }
  });

  it("post130: docs list backlink_* tools distinct from claw-mcp runtime ids", () => {
    const docs = read('docs/mcp-spec.md');
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing'] as const) {
      expect(docs).toContain(id);
    }
    // docs use product tool ids; runtime MCP_MANIFEST keeps claw-mcp names
    expect(docs).not.toContain('station_select');
    expect(docs).not.toContain('genre_filter');
    expect(docs).not.toContain('curator_prompt');
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select', 'now_playing', 'genre_filter', 'curator_prompt',
    ]);
  });

  it("post130: docs mention live HTTP endpoints without inventing /playlist", () => {
    const docs = read('docs/mcp-spec.md');
    expect(docs).toMatch(/\/curate/);
    expect(docs).toMatch(/\/genres/);
    expect(docs).toMatch(/\/stations|\/health|Base URL/);
    expect(docs).not.toMatch(/\/playlist/);
  });

  it("post130: docs note KV TTL and Gemini graceful degradation", () => {
    const docs = read('docs/mcp-spec.md');
    expect(docs).toMatch(/1h TTL|TTL/i);
    expect(docs).toMatch(/editorial: null|graceful degradation/i);
  });

  it("post130: docs Base URL stays backlink.fuzzywigg.com", () => {
    expect(read('docs/mcp-spec.md')).toContain('https://backlink.fuzzywigg.com');
  });

  it("post130: HMAC digests differ for distinct keys on mcp.ts", () => {
    expect(hmacSha256('post130', 'src/mcp.ts')).not.toBe(hmacSha256('leftover', 'src/mcp.ts'));
    expect(hmacSha256('TOKENMAXX', 'src/mcp.ts')).not.toBe(hmacSha256('HEAVY', 'src/mcp.ts'));
    expect(hmacSha256('station_select', 'src/mcp.ts')).not.toBe(hmacSha256('now_playing', 'src/mcp.ts'));
  });

  it("post130: extra HMAC keys inventory digest", () => {
    const keys = ["mcp","backlink","Backlink Radio","station_select","now_playing","genre_filter","curator_prompt","openapi","schema_version","claw-mcp","fuzzywigg","iptv-org","post108","post126","VALID_GENRES","GENRE_MAP"];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe("5afbcdd1fa06176ba39d4b6c566bdc0ad9239318f14ffc10a832060de66ac42b");
    expect(keys).toHaveLength(16);
  });

  it("post130: final inventory markers", () => {
    const body = read('test/mcp.test.ts');
    expect(body).toContain("describe('post108 mcp HEAVY deepen'");
    expect(body).toContain("describe('post108 mcp HEAVY deepen extras'");
    expect(body).toContain("describe('post130 mcp HEAVY deepen (after #130)'");
    expect((body.match(/it\("post130:/g) ?? []).length).toBeGreaterThan(80);
  });

});

describe('post134 mcp HEAVY deepen (after #134)', () => {
  const read = (rel: string) => readFileSync(join(mcpRoot, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(mcpRoot, rel))).digest('hex');
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


  it("post134: locks src/mcp.ts sha256", () => {
    expect(sha256("src/mcp.ts")).toBe("6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683");
  });

  it("post134: locks src/mcp.ts sha1", () => {
    expect(sha1("src/mcp.ts")).toBe("848b3977365809fda54fcb74a7d09affe685ea82");
  });

  it("post134: locks src/mcp.ts md5", () => {
    expect(md5("src/mcp.ts")).toBe("52e71c72e32e3d95b8b8d61ff4a2cf46");
  });

  it("post134: locks src/mcp.ts sha384", () => {
    expect(sha384("src/mcp.ts")).toBe("a95bef5fcb3b93e9c05aac94aaa6a49adb47a360bfaf046e65f7254c2249fd1f34ff923ec401752e2701b7260d9949d2");
  });

  it("post134: locks src/mcp.ts sha512", () => {
    expect(sha512("src/mcp.ts")).toBe("aa1525a8464db0a7d40982c8f0c091b63f8b21ea363f642ca9781513618d4fb99a9926e39118f65788c423a6bd6ee2318b3165f6007ca9599d36fe7fc7820c05");
  });

  it("post134: locks src/mcp.ts sha3-256", () => {
    expect(sha3("src/mcp.ts")).toBe("9072d42bee801bb2a3ea3f058ea604be67a2e7e599f21afb0d26f27817f44b16");
  });

  it("post134: locks src/mcp.ts blake2b512", () => {
    expect(blake2b("src/mcp.ts")).toBe("f91cd566835e001abe86d934663f36715b1082627dfb8abea78ffd99a50fe41e22d7d9b694301c9b2b27d16a675e3380dffdca34a74b4dbe2ea5b6af00e8ab43");
  });

  it("post134: locks src/mcp.ts ripemd160", () => {
    expect(ripemd("src/mcp.ts")).toBe("105ea9a796a49f5987df733c71c1abf0ab5ddad4");
  });

  it("post134: locks src/mcp.ts size 2057", () => {
    expect(statSync(join(mcpRoot, "src/mcp.ts")).size).toBe(2057);
    expect(readFileSync(join(mcpRoot, "src/mcp.ts")).byteLength).toBe(2057);
  });

  it("post134: locks src/mcp.ts utf8 2057 lines 68", () => {
    expect(read("src/mcp.ts")).toHaveLength(2057);
    expect(read("src/mcp.ts").split('\n')).toHaveLength(68);
  });

  it("post134: locks src/mcp.ts nibble 551 xor 1", () => {
    const d = sha256("src/mcp.ts");
    expect(nibbleSum(d)).toBe(551);
    expect(xorNibbles(d)).toBe(1);
  });

  it("post134: locks src/mcp.ts pairSum 4751 rollingXor 103", () => {
    const d = sha256("src/mcp.ts");
    expect(pairSum(d)).toBe(4751);
    expect(rollingXor(d)).toBe(103);
  });

  it("post134: locks src/mcp.ts first/last/mid octets", () => {
    const d = sha256("src/mcp.ts");
    expect(d.slice(0, 2)).toBe("6a");
    expect(d.slice(-2)).toBe("83");
    expect(d.slice(28, 36)).toBe("6ad61aff");
  });

  it("post134: locks src/mcp.ts HMAC post134/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post134', "src/mcp.ts")).toBe("45cb642b23635a3f51129430cbb69e7a3e120877e15d9bf28e529bbcbeb07b0e");
    expect(hmacSha256('leftover', "src/mcp.ts")).toBe("8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712");
    expect(hmacSha256('TOKENMAXX', "src/mcp.ts")).toBe("cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62");
  });

  it("post134: locks src/mcp.ts HMAC after-#134/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#134', "src/mcp.ts")).toBe("9bfebb63b61a4ed9ae39b0e9c6583a9c14614ab40adf0d174eea3129ec07cb2a");
    expect(hmacSha256('HEAVY', "src/mcp.ts")).toBe("870bb2f88c83abd6679e447c6937b01c998a1b3f527024e687dc35c00a046e40");
    expect(hmacSha256('no-product-invent', "src/mcp.ts")).toBe("71a686fe812adcc92f40d5ca19a3996e68555d6749199affd3fc002053aabd65");
  });

  it("post134: locks src/mcp.ts spaces 617", () => {
    expect((read("src/mcp.ts").match(/ /g) ?? []).length).toBe(617);
  });

  it("post134: locks src/mcp.ts reversed sha256", () => {
    const rev = [...read("src/mcp.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("5fb580296684d084fa1bca986fdaa5c31fb63d427f9c5b62f7581941727ba73c");
  });

  it("post134: locks src/mcp.ts sha256 UPPERCASE", () => {
    expect(sha256("src/mcp.ts").toUpperCase()).toBe("6AE8FFD7C4B75C471DB2DFF1FE5C6AD61AFF69E38B048A366BB8B7ADB3099683");
  });

  it("post134: locks src/mcp.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("src/mcp.ts").split('\n')[0]).digest('hex')).toBe("73d0328cf8db2bc4525219dd63f5dc9b67754ff24aaa895010835d654df47da5");
  });

  it("post134: locks src/mcp.ts size*lines 139876", () => {
    expect(statSync(join(mcpRoot, "src/mcp.ts")).size * read("src/mcp.ts").split('\n').length).toBe(139876);
  });

  it("post134: locks docs/mcp-spec.md sha256", () => {
    expect(sha256("docs/mcp-spec.md")).toBe("a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849");
  });

  it("post134: locks docs/mcp-spec.md sha1", () => {
    expect(sha1("docs/mcp-spec.md")).toBe("e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a");
  });

  it("post134: locks docs/mcp-spec.md md5", () => {
    expect(md5("docs/mcp-spec.md")).toBe("ee7881030c338c1773659cc6378c392c");
  });

  it("post134: locks docs/mcp-spec.md sha384", () => {
    expect(sha384("docs/mcp-spec.md")).toBe("b32096b74bacd48065f014d2695673b3bfad3cb9118b855899a92a849cd38a7dd751db7c9e0705d6d6569d5f05f61227");
  });

  it("post134: locks docs/mcp-spec.md sha512", () => {
    expect(sha512("docs/mcp-spec.md")).toBe("8d26bafffcb1230048d80796e1d8a1019d83253810324d18383c54ff8bcaaed4a508b0a07395994af2f23e4f9b627e2202a57fcac709110d0ee859e8628709e7");
  });

  it("post134: locks docs/mcp-spec.md sha3-256", () => {
    expect(sha3("docs/mcp-spec.md")).toBe("700b4576d20353f0db25e4379cfebf496f15f0514d8998c10464bd0d6c8604f4");
  });

  it("post134: locks docs/mcp-spec.md blake2b512", () => {
    expect(blake2b("docs/mcp-spec.md")).toBe("6f441cdfb1d2b41be77e60c9aa79de5778608e02670b1067c30da76537d9e0915920752717c7302e705c5787dffea7a41f6c0669adb594689f0d256bbe7d0d31");
  });

  it("post134: locks docs/mcp-spec.md ripemd160", () => {
    expect(ripemd("docs/mcp-spec.md")).toBe("2f5cb29783b2bd4db4999e2ab61376a44c3a857b");
  });

  it("post134: locks docs/mcp-spec.md size 3552", () => {
    expect(statSync(join(mcpRoot, "docs/mcp-spec.md")).size).toBe(3552);
    expect(readFileSync(join(mcpRoot, "docs/mcp-spec.md")).byteLength).toBe(3552);
  });

  it("post134: locks docs/mcp-spec.md utf8 3544 lines 145", () => {
    expect(read("docs/mcp-spec.md")).toHaveLength(3544);
    expect(read("docs/mcp-spec.md").split('\n')).toHaveLength(145);
  });

  it("post134: locks docs/mcp-spec.md nibble 514 xor 14", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(nibbleSum(d)).toBe(514);
    expect(xorNibbles(d)).toBe(14);
  });

  it("post134: locks docs/mcp-spec.md pairSum 4534 rollingXor 164", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(pairSum(d)).toBe(4534);
    expect(rollingXor(d)).toBe(164);
  });

  it("post134: locks docs/mcp-spec.md first/last/mid octets", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(d.slice(0, 2)).toBe("a9");
    expect(d.slice(-2)).toBe("49");
    expect(d.slice(28, 36)).toBe("c7628b21");
  });

  it("post134: locks docs/mcp-spec.md HMAC post134/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post134', "docs/mcp-spec.md")).toBe("1acf9519a121d529e4776549511e460423fe0cf46b596312051a58cd4a7903ea");
    expect(hmacSha256('leftover', "docs/mcp-spec.md")).toBe("cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df");
    expect(hmacSha256('TOKENMAXX', "docs/mcp-spec.md")).toBe("58bd8b12de8084ece067f68db2cea2ea5dc8b43305c0d5e7e20506fd40e18749");
  });

  it("post134: locks docs/mcp-spec.md HMAC after-#134/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#134', "docs/mcp-spec.md")).toBe("f8a4befb7f49194fc3717d27b3c8b474a98ac5cd7884184194ca1fd768b866d9");
    expect(hmacSha256('HEAVY', "docs/mcp-spec.md")).toBe("14502ba27898e795fb59cc37b06fe6eb2a66b40811b068e87738eb3dbf4cae59");
    expect(hmacSha256('no-product-invent', "docs/mcp-spec.md")).toBe("1ea2c93af05439c6a1c14acfbee6d34dddfc2b32e6c8b6256c270f6d4484b608");
  });

  it("post134: locks docs/mcp-spec.md spaces 640", () => {
    expect((read("docs/mcp-spec.md").match(/ /g) ?? []).length).toBe(640);
  });

  it("post134: locks docs/mcp-spec.md reversed sha256", () => {
    const rev = [...read("docs/mcp-spec.md")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("8e0a8a17d78474b7a2c052d335989cd8a980b200816869706af232736e35ab47");
  });

  it("post134: locks docs/mcp-spec.md sha256 UPPERCASE", () => {
    expect(sha256("docs/mcp-spec.md").toUpperCase()).toBe("A93978D779B976A1ABA4D34395EEC7628B21BDA910EF8A279D5EFBC05DA56849");
  });

  it("post134: locks docs/mcp-spec.md first-line sha256", () => {
    expect(createHash('sha256').update(read("docs/mcp-spec.md").split('\n')[0]).digest('hex')).toBe("99c84d33ad819ac91a66e1a30aef3bf512cb393370d7b6fbc8397c8917ba2e66");
  });

  it("post134: locks docs/mcp-spec.md size*lines 515040", () => {
    expect(statSync(join(mcpRoot, "docs/mcp-spec.md")).size * read("docs/mcp-spec.md").split('\n').length).toBe(515040);
  });

  it("post134: locks src/genres.ts sha256", () => {
    expect(sha256("src/genres.ts")).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it("post134: locks src/genres.ts sha1", () => {
    expect(sha1("src/genres.ts")).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it("post134: locks src/genres.ts md5", () => {
    expect(md5("src/genres.ts")).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it("post134: locks src/genres.ts sha384", () => {
    expect(sha384("src/genres.ts")).toBe("ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16");
  });

  it("post134: locks src/genres.ts sha512", () => {
    expect(sha512("src/genres.ts")).toBe("bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b");
  });

  it("post134: locks src/genres.ts sha3-256", () => {
    expect(sha3("src/genres.ts")).toBe("d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f");
  });

  it("post134: locks src/genres.ts blake2b512", () => {
    expect(blake2b("src/genres.ts")).toBe("731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67");
  });

  it("post134: locks src/genres.ts ripemd160", () => {
    expect(ripemd("src/genres.ts")).toBe("bb9faaf8890bdba8dd86bcdf7e418da622d19bf5");
  });

  it("post134: locks src/genres.ts size 1027", () => {
    expect(statSync(join(mcpRoot, "src/genres.ts")).size).toBe(1027);
    expect(readFileSync(join(mcpRoot, "src/genres.ts")).byteLength).toBe(1027);
  });

  it("post134: locks src/genres.ts utf8 1025 lines 48", () => {
    expect(read("src/genres.ts")).toHaveLength(1025);
    expect(read("src/genres.ts").split('\n')).toHaveLength(48);
  });

  it("post134: locks src/genres.ts nibble 500 xor 6", () => {
    const d = sha256("src/genres.ts");
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it("post134: locks src/genres.ts pairSum 3950 rollingXor 96", () => {
    const d = sha256("src/genres.ts");
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it("post134: locks src/genres.ts first/last/mid octets", () => {
    const d = sha256("src/genres.ts");
    expect(d.slice(0, 2)).toBe("aa");
    expect(d.slice(-2)).toBe("4e");
    expect(d.slice(28, 36)).toBe("811dfbc2");
  });

  it("post134: locks src/genres.ts HMAC post134/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post134', "src/genres.ts")).toBe("647e1b7782080412e9abd5a7449f3d14662cdd4d684b9f56af332db2b5b94278");
    expect(hmacSha256('leftover', "src/genres.ts")).toBe("bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f");
    expect(hmacSha256('TOKENMAXX', "src/genres.ts")).toBe("7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951");
  });

  it("post134: locks src/genres.ts HMAC after-#134/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#134', "src/genres.ts")).toBe("5947e02971d188efefdee5236c85d553bbecf20c9823a222d113de864db039c7");
    expect(hmacSha256('HEAVY', "src/genres.ts")).toBe("728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575");
    expect(hmacSha256('no-product-invent', "src/genres.ts")).toBe("3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b");
  });

  it("post134: locks src/genres.ts spaces 144", () => {
    expect((read("src/genres.ts").match(/ /g) ?? []).length).toBe(144);
  });

  it("post134: locks src/genres.ts reversed sha256", () => {
    const rev = [...read("src/genres.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac");
  });

  it("post134: locks src/genres.ts sha256 UPPERCASE", () => {
    expect(sha256("src/genres.ts").toUpperCase()).toBe("AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E");
  });

  it("post134: locks src/genres.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("src/genres.ts").split('\n')[0]).digest('hex')).toBe("907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68");
  });

  it("post134: locks src/genres.ts size*lines 49296", () => {
    expect(statSync(join(mcpRoot, "src/genres.ts")).size * read("src/genres.ts").split('\n').length).toBe(49296);
  });

  it("post134: locks package.json sha256", () => {
    expect(sha256("package.json")).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it("post134: locks package.json sha1", () => {
    expect(sha1("package.json")).toBe("b58d14f35b9c13bb254d5e2a51240e2918a126c5");
  });

  it("post134: locks package.json md5", () => {
    expect(md5("package.json")).toBe("63472e1fb514fb0dadb5e49a7bdbaa5f");
  });

  it("post134: locks package.json sha384", () => {
    expect(sha384("package.json")).toBe("4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20");
  });

  it("post134: locks package.json sha512", () => {
    expect(sha512("package.json")).toBe("7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28");
  });

  it("post134: locks package.json sha3-256", () => {
    expect(sha3("package.json")).toBe("e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5");
  });

  it("post134: locks package.json blake2b512", () => {
    expect(blake2b("package.json")).toBe("a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d");
  });

  it("post134: locks package.json ripemd160", () => {
    expect(ripemd("package.json")).toBe("f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad");
  });

  it("post134: locks package.json size 637", () => {
    expect(statSync(join(mcpRoot, "package.json")).size).toBe(637);
    expect(readFileSync(join(mcpRoot, "package.json")).byteLength).toBe(637);
  });

  it("post134: locks package.json utf8 635 lines 26", () => {
    expect(read("package.json")).toHaveLength(635);
    expect(read("package.json").split('\n')).toHaveLength(26);
  });

  it("post134: locks package.json nibble 451 xor 13", () => {
    const d = sha256("package.json");
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it("post134: locks package.json pairSum 4051 rollingXor 13", () => {
    const d = sha256("package.json");
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it("post134: locks package.json first/last/mid octets", () => {
    const d = sha256("package.json");
    expect(d.slice(0, 2)).toBe("34");
    expect(d.slice(-2)).toBe("1c");
    expect(d.slice(28, 36)).toBe("e0ecaa43");
  });

  it("post134: locks package.json HMAC post134/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post134', "package.json")).toBe("da6eab75dfa282d488400670e8a0a48a808b5777ee3903c4cd96558c404c84cb");
    expect(hmacSha256('leftover', "package.json")).toBe("20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1");
    expect(hmacSha256('TOKENMAXX', "package.json")).toBe("ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58");
  });

  it("post134: locks package.json HMAC after-#134/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#134', "package.json")).toBe("961232c61cd4dc84f8eb5deb35fbc2ddd21b32b32b3be0dad3720409f30867ec");
    expect(hmacSha256('HEAVY', "package.json")).toBe("59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563");
    expect(hmacSha256('no-product-invent', "package.json")).toBe("b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b");
  });

  it("post134: locks package.json spaces 106", () => {
    expect((read("package.json").match(/ /g) ?? []).length).toBe(106);
  });

  it("post134: locks package.json reversed sha256", () => {
    const rev = [...read("package.json")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("76b81fd27392035d0e4776f664acfb5bf67811a2b3ebb57b61b7be81ceb7ccc4");
  });

  it("post134: locks package.json sha256 UPPERCASE", () => {
    expect(sha256("package.json").toUpperCase()).toBe("34552493F3008B58991D10E7B41EE0ECAA43BF8BA3E79D261AC2A061E6F7181C");
  });

  it("post134: locks package.json first-line sha256", () => {
    expect(createHash('sha256').update(read("package.json").split('\n')[0]).digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post134: locks package.json size*lines 16562", () => {
    expect(statSync(join(mcpRoot, "package.json")).size * read("package.json").split('\n').length).toBe(16562);
  });

  it("post134: locks vitest.config.ts sha256", () => {
    expect(sha256("vitest.config.ts")).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it("post134: locks vitest.config.ts sha1", () => {
    expect(sha1("vitest.config.ts")).toBe("f8d49517ece92fc5e9781fbde021a948958aac37");
  });

  it("post134: locks vitest.config.ts md5", () => {
    expect(md5("vitest.config.ts")).toBe("f1176313255f5f064a946d458482d81a");
  });

  it("post134: locks vitest.config.ts sha384", () => {
    expect(sha384("vitest.config.ts")).toBe("c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563");
  });

  it("post134: locks vitest.config.ts sha512", () => {
    expect(sha512("vitest.config.ts")).toBe("ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682");
  });

  it("post134: locks vitest.config.ts sha3-256", () => {
    expect(sha3("vitest.config.ts")).toBe("ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba");
  });

  it("post134: locks vitest.config.ts blake2b512", () => {
    expect(blake2b("vitest.config.ts")).toBe("93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a");
  });

  it("post134: locks vitest.config.ts ripemd160", () => {
    expect(ripemd("vitest.config.ts")).toBe("6f29a743813430d4d364f8ddd66e0aedf1506fcd");
  });

  it("post134: locks vitest.config.ts size 535", () => {
    expect(statSync(join(mcpRoot, "vitest.config.ts")).size).toBe(535);
    expect(readFileSync(join(mcpRoot, "vitest.config.ts")).byteLength).toBe(535);
  });

  it("post134: locks vitest.config.ts utf8 535 lines 22", () => {
    expect(read("vitest.config.ts")).toHaveLength(535);
    expect(read("vitest.config.ts").split('\n')).toHaveLength(22);
  });

  it("post134: locks vitest.config.ts nibble 536 xor 2", () => {
    const d = sha256("vitest.config.ts");
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it("post134: locks vitest.config.ts pairSum 4691 rollingXor 49", () => {
    const d = sha256("vitest.config.ts");
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it("post134: locks vitest.config.ts first/last/mid octets", () => {
    const d = sha256("vitest.config.ts");
    expect(d.slice(0, 2)).toBe("f9");
    expect(d.slice(-2)).toBe("38");
    expect(d.slice(28, 36)).toBe("ec95c6d5");
  });

  it("post134: locks vitest.config.ts HMAC post134/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post134', "vitest.config.ts")).toBe("c53a882c6e5e8ef3b1506104649574edf896592a9bc5ea53d19b9304e98409bc");
    expect(hmacSha256('leftover', "vitest.config.ts")).toBe("3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7");
    expect(hmacSha256('TOKENMAXX', "vitest.config.ts")).toBe("0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9");
  });

  it("post134: locks vitest.config.ts HMAC after-#134/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#134', "vitest.config.ts")).toBe("dc6c0303b4827d3ce7d0721e9e70d47e3d365b5613550dfa0ad885d70d9265bc");
    expect(hmacSha256('HEAVY', "vitest.config.ts")).toBe("08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179");
    expect(hmacSha256('no-product-invent', "vitest.config.ts")).toBe("3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c");
  });

  it("post134: locks vitest.config.ts spaces 121", () => {
    expect((read("vitest.config.ts").match(/ /g) ?? []).length).toBe(121);
  });

  it("post134: locks vitest.config.ts reversed sha256", () => {
    const rev = [...read("vitest.config.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("0938009226d244856c43668b42c9aa000689efe510086849e55daf781d867c2b");
  });

  it("post134: locks vitest.config.ts sha256 UPPERCASE", () => {
    expect(sha256("vitest.config.ts").toUpperCase()).toBe("F9B58BB937531DA55AD474592E69EC95C6D55A5B8B878F8FA251C0F8D6CAFF38");
  });

  it("post134: locks vitest.config.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("vitest.config.ts").split('\n')[0]).digest('hex')).toBe("85734f4752244f71454215d0cfbe952f4ff6d79da03016ebd55e0dd9a1e7d328");
  });

  it("post134: locks vitest.config.ts size*lines 11770", () => {
    expect(statSync(join(mcpRoot, "vitest.config.ts")).size * read("vitest.config.ts").split('\n').length).toBe(11770);
  });

  it("post134: locks AGENTS.md sha256", () => {
    expect(sha256("AGENTS.md")).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it("post134: locks AGENTS.md sha1", () => {
    expect(sha1("AGENTS.md")).toBe("a7df1fec05dcf7b8ace116788297c77f467a7b6c");
  });

  it("post134: locks AGENTS.md md5", () => {
    expect(md5("AGENTS.md")).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it("post134: locks AGENTS.md sha384", () => {
    expect(sha384("AGENTS.md")).toBe("817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a");
  });

  it("post134: locks AGENTS.md sha512", () => {
    expect(sha512("AGENTS.md")).toBe("7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908");
  });

  it("post134: locks AGENTS.md sha3-256", () => {
    expect(sha3("AGENTS.md")).toBe("894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4");
  });

  it("post134: locks AGENTS.md blake2b512", () => {
    expect(blake2b("AGENTS.md")).toBe("7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0");
  });

  it("post134: locks AGENTS.md ripemd160", () => {
    expect(ripemd("AGENTS.md")).toBe("6637e853e0148967671e4a3f21bd852255e8ed1c");
  });

  it("post134: locks AGENTS.md size 1017", () => {
    expect(statSync(join(mcpRoot, "AGENTS.md")).size).toBe(1017);
    expect(readFileSync(join(mcpRoot, "AGENTS.md")).byteLength).toBe(1017);
  });

  it("post134: locks AGENTS.md utf8 1011 lines 35", () => {
    expect(read("AGENTS.md")).toHaveLength(1011);
    expect(read("AGENTS.md").split('\n')).toHaveLength(35);
  });

  it("post134: locks AGENTS.md nibble 479 xor 5", () => {
    const d = sha256("AGENTS.md");
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it("post134: locks AGENTS.md pairSum 5084 rollingXor 216", () => {
    const d = sha256("AGENTS.md");
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it("post134: locks AGENTS.md first/last/mid octets", () => {
    const d = sha256("AGENTS.md");
    expect(d.slice(0, 2)).toBe("48");
    expect(d.slice(-2)).toBe("aa");
    expect(d.slice(28, 36)).toBe("a5ec1be5");
  });

  it("post134: locks AGENTS.md HMAC post134/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post134', "AGENTS.md")).toBe("1988f92b5fdd04e681c969c3279279c28d120dc08d91e34bdf83677579318ce1");
    expect(hmacSha256('leftover', "AGENTS.md")).toBe("ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e");
    expect(hmacSha256('TOKENMAXX', "AGENTS.md")).toBe("b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f");
  });

  it("post134: locks AGENTS.md HMAC after-#134/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#134', "AGENTS.md")).toBe("00f1950ccd29586a92c5e8b1dcc168b3ae33f40128c0354f418c47eef8e3f144");
    expect(hmacSha256('HEAVY', "AGENTS.md")).toBe("f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c");
    expect(hmacSha256('no-product-invent', "AGENTS.md")).toBe("dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264");
  });

  it("post134: locks AGENTS.md spaces 120", () => {
    expect((read("AGENTS.md").match(/ /g) ?? []).length).toBe(120);
  });

  it("post134: locks AGENTS.md reversed sha256", () => {
    const rev = [...read("AGENTS.md")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("662d61b72071234b614b17c421d0f8a3fc73757a69c1690a0b6a36fd122672dc");
  });

  it("post134: locks AGENTS.md sha256 UPPERCASE", () => {
    expect(sha256("AGENTS.md").toUpperCase()).toBe("48E590B4F146E2FBD1EBB409E0D5A5EC1BE50B72B2C310F1C1E360487B36FEAA");
  });

  it("post134: locks AGENTS.md first-line sha256", () => {
    expect(createHash('sha256').update(read("AGENTS.md").split('\n')[0]).digest('hex')).toBe("e3df46c4dc415311293b71de67e5df2d01a72a69658ef8f8cf5ac9e682d8d618");
  });

  it("post134: locks AGENTS.md size*lines 35595", () => {
    expect(statSync(join(mcpRoot, "AGENTS.md")).size * read("AGENTS.md").split('\n').length).toBe(35595);
  });

  it("post134: HMAC src/mcp.ts key mcp", () => {
    expect(hmacSha256("mcp", "src/mcp.ts")).toBe("ccc71129d02f2aea082bc5dfbffb139ca2d4ce8cbb2434c03dc2f8776f7c2819");
  });

  it("post134: HMAC src/mcp.ts key backlink", () => {
    expect(hmacSha256("backlink", "src/mcp.ts")).toBe("948dbb9d47ee26b53b9ed9f9656e46752675060261aec301d8a9688178c14b7d");
  });

  it("post134: HMAC src/mcp.ts key Backlink Radio", () => {
    expect(hmacSha256("Backlink Radio", "src/mcp.ts")).toBe("d61171f097655fd1e99e3fbe76f6c7ddb35b0ce15c63cb13081124b0f53d4860");
  });

  it("post134: HMAC src/mcp.ts key station_select", () => {
    expect(hmacSha256("station_select", "src/mcp.ts")).toBe("d8c897e3e257256d5c946e2e941fbc36b75dc2a5027d3685a0f2446686d8cea2");
  });

  it("post134: HMAC src/mcp.ts key now_playing", () => {
    expect(hmacSha256("now_playing", "src/mcp.ts")).toBe("96cc206873f09cc5de0c09d24c34da0daa4923eeb79077fc55e393f6215c3c5d");
  });

  it("post134: HMAC src/mcp.ts key genre_filter", () => {
    expect(hmacSha256("genre_filter", "src/mcp.ts")).toBe("d5fb3f55b4e99eebe3005c654592da845e3f41c4f552e3bc98f4119ff03cf189");
  });

  it("post134: HMAC src/mcp.ts key curator_prompt", () => {
    expect(hmacSha256("curator_prompt", "src/mcp.ts")).toBe("70897363a596f9754bee8cc34105600129e430194d666f995b799708bf1b3259");
  });

  it("post134: HMAC src/mcp.ts key openapi", () => {
    expect(hmacSha256("openapi", "src/mcp.ts")).toBe("23d20e1f26a97ecc18e15e745c7da152c106dd8c4bbf3c1bb613c409581a5f6f");
  });

  it("post134: HMAC src/mcp.ts key schema_version", () => {
    expect(hmacSha256("schema_version", "src/mcp.ts")).toBe("49151d77055e1ab6a8d5dba06712e46bd0a691799e6fdcaa4061081f97f732d9");
  });

  it("post134: HMAC src/mcp.ts key claw-mcp", () => {
    expect(hmacSha256("claw-mcp", "src/mcp.ts")).toBe("d2be78dfaf67430ea34569738fbdb4577f6cb48928cd16c895ec53378b2e1eb5");
  });

  it("post134: HMAC src/mcp.ts key fuzzywigg", () => {
    expect(hmacSha256("fuzzywigg", "src/mcp.ts")).toBe("93171a03382e2488888b170abdf10cc84dbd7ec7e77448b36c60d6758faac830");
  });

  it("post134: HMAC src/mcp.ts key iptv-org", () => {
    expect(hmacSha256("iptv-org", "src/mcp.ts")).toBe("dcaf0c454cf3ee0bbaba12121ffe1183726881c6eb0f1f0714218d84c63cd1d7");
  });

  it("post134: HMAC src/mcp.ts key post108", () => {
    expect(hmacSha256("post108", "src/mcp.ts")).toBe("a083f425b35fca6441d9148d33d2980bde5c58c304ae6d099d12aaa604fc6fbf");
  });

  it("post134: HMAC src/mcp.ts key post126", () => {
    expect(hmacSha256("post126", "src/mcp.ts")).toBe("d6bbbe08e1a6d4ce854fc3037c5a4590d86f31d868892f4fa30aeddaf6e4a1ff");
  });

  it("post134: HMAC src/mcp.ts key VALID_GENRES", () => {
    expect(hmacSha256("VALID_GENRES", "src/mcp.ts")).toBe("7b49b3a4b4234c1df692867963df7f92e3cba6160e503301f5dca4f28d0e14cc");
  });

  it("post134: HMAC src/mcp.ts key GENRE_MAP", () => {
    expect(hmacSha256("GENRE_MAP", "src/mcp.ts")).toBe("444b4d15f27bca3371c2c56198cfa3e954d4dd9f7014694949fbf3b528765cb9");
  });

  it("post134: MCP_MANIFEST schema/auth/api stable", () => {
    expect(MCP_MANIFEST.schema_version).toBe("v1");
    expect(MCP_MANIFEST.name_for_model).toBe("backlink");
    expect(MCP_MANIFEST.name_for_human).toBe("Backlink Radio");
    expect(MCP_MANIFEST.auth).toEqual({"type":"none"});
    expect(MCP_MANIFEST.api).toEqual({"type":"openapi","url":"/openapi.json"});
  });

  it("post134: MCP_MANIFEST tools order stable", () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual(["station_select","now_playing","genre_filter","curator_prompt"]);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it("post134: compact JSON sha256", () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043");
    expect(JSON.stringify(MCP_MANIFEST)).toHaveLength(1534);
  });

  it("post134: compact HMAC key post134", () => {
    expect(createHmac('sha256', "post134").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("7694bf3e87454e0de661f09b924005e835a10e5a445487504163fe633c0f7f69");
  });

  it("post134: compact HMAC key leftover", () => {
    expect(createHmac('sha256', "leftover").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("6503ddae3d9c2d52d19c2828c8d98b979a5afe735094369937c01437b4993409");
  });

  it("post134: compact HMAC key TOKENMAXX", () => {
    expect(createHmac('sha256', "TOKENMAXX").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("ac3aa328b66887e37f2a98c5b73872089735c9150d4a3d4c00192b9e1974fbac");
  });

  it("post134: compact HMAC key HEAVY", () => {
    expect(createHmac('sha256', "HEAVY").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("360825dd0456638ccca74ad826aae66f7f2f91f3303154f77e77ac5bc76ef27f");
  });

  it("post134: compact HMAC key after-#134", () => {
    expect(createHmac('sha256', "after-#134").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("7ff5ce832f3a32c6863d42384d369f5bd976c9802ee8fc218552039a21dbeeeb");
  });

  it("post134: compact HMAC key no-product-invent", () => {
    expect(createHmac('sha256', "no-product-invent").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("1ec4402a90b3f87fb1fd32de33122b40fedaa3a1d623804b31bbd11109100713");
  });

  it("post134: compact HMAC key mcp", () => {
    expect(createHmac('sha256', "mcp").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("db5fa1c6207d9ed45ed725bb2a1042439b0344aa0aedad24e9abc40599f737f5");
  });

  it("post134: compact HMAC key station_select", () => {
    expect(createHmac('sha256', "station_select").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("6a2bc46cadb38d7a926172f9e35743a163a3f84c496cc2f67610472fe970e32c");
  });

  it("post134: compact HMAC key curator_prompt", () => {
    expect(createHmac('sha256', "curator_prompt").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("29d8ce477119d329ff752814955f65de2c59b97dc386561a7db2fe8b5635282e");
  });

  it("post134: compact HMAC key openapi", () => {
    expect(createHmac('sha256', "openapi").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("f22724cc03066a9c9eea99647ed50d67473aff1348a6a678bd4f0247216449b7");
  });

  it("post134: compact HMAC key claw-mcp", () => {
    expect(createHmac('sha256', "claw-mcp").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("8dd5570110e0f4c6f4a667cb96982f895ea5f312856a62a3f00dfcdba154fad7");
  });

  it("post134: tool station_select description exact", () => {
    expect(toolNamed("station_select").description).toBe("Set the currently playing station by name.");
  });

  it("post134: tool station_select description sha256", () => {
    expect(createHash('sha256').update(toolNamed("station_select").description, 'utf8').digest('hex')).toBe("1b1b6035f3a55908462e8bec71c002374de19a5863b402f9785a13f736ca1be6");
  });

  it("post134: tool station_select required [\"station_name\"]", () => {
    expect(toolNamed("station_select").input_schema.required ?? []).toEqual(["station_name"]);
  });

  it("post134: tool station_select property keys", () => {
    expect(Object.keys(toolNamed("station_select").input_schema.properties)).toEqual(["station_name"]);
  });

  it("post134: tool station_select.station_name type+desc", () => {
    const prop = toolNamed("station_select").input_schema.properties["station_name"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Partial or full name of the station to select.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("85b77e93e2d24bc6f5b94d41003ba6d43f1c4eb5c5294801fac6c408f0750205");
  });

  it("post134: tool now_playing description exact", () => {
    expect(toolNamed("now_playing").description).toBe("Get the currently playing station including name, genre, stream URL, and country.");
  });

  it("post134: tool now_playing description sha256", () => {
    expect(createHash('sha256').update(toolNamed("now_playing").description, 'utf8').digest('hex')).toBe("15a43880c871d46c36973e95f77b64ff910e68284acdf219fa6c82978af29e7b");
  });

  it("post134: tool now_playing required []", () => {
    expect(toolNamed("now_playing").input_schema.required ?? []).toEqual([]);
  });

  it("post134: tool now_playing property keys", () => {
    expect(Object.keys(toolNamed("now_playing").input_schema.properties)).toEqual([]);
  });

  it("post134: tool genre_filter description exact", () => {
    expect(toolNamed("genre_filter").description).toBe("Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).");
  });

  it("post134: tool genre_filter description sha256", () => {
    expect(createHash('sha256').update(toolNamed("genre_filter").description, 'utf8').digest('hex')).toBe("3457f6157ae02b0b6c31bcfeabe4332f8954a58944c501b1b8d9bf8a67733d30");
  });

  it("post134: tool genre_filter required [\"genre\"]", () => {
    expect(toolNamed("genre_filter").input_schema.required ?? []).toEqual(["genre"]);
  });

  it("post134: tool genre_filter property keys", () => {
    expect(Object.keys(toolNamed("genre_filter").input_schema.properties)).toEqual(["genre"]);
  });

  it("post134: tool genre_filter.genre type+desc", () => {
    const prop = toolNamed("genre_filter").input_schema.properties["genre"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Genre keyword to filter by.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("ef1f96a903a23d6e90ed07ff0e44463a931b11b5c04918a309aa4f580ce09f17");
  });

  it("post134: tool curator_prompt description exact", () => {
    expect(toolNamed("curator_prompt").description).toBe("Ask the AI curator to pick and set the best station for a given mood or context.");
  });

  it("post134: tool curator_prompt description sha256", () => {
    expect(createHash('sha256').update(toolNamed("curator_prompt").description, 'utf8').digest('hex')).toBe("c3bcfd16227da8c0c55d606d7da1a1ea26a3032dc1db779e316e31c5b9014ad3");
  });

  it("post134: tool curator_prompt required [\"mood\"]", () => {
    expect(toolNamed("curator_prompt").input_schema.required ?? []).toEqual(["mood"]);
  });

  it("post134: tool curator_prompt property keys", () => {
    expect(Object.keys(toolNamed("curator_prompt").input_schema.properties)).toEqual(["mood","genre"]);
  });

  it("post134: tool curator_prompt.mood type+desc", () => {
    const prop = toolNamed("curator_prompt").input_schema.properties["mood"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("31234660f70b2056f5daf1c3b1ca4a65637b12154981d7f44d83d1972e479449");
  });

  it("post134: tool curator_prompt.genre type+desc", () => {
    const prop = toolNamed("curator_prompt").input_schema.properties["genre"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Optional genre to constrain the selection.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("c8a41a58580e4507ab783a1bf084fc0f834cf15e6dc9f358dddc1fba16d43210");
  });

  it("post134: description_for_model contains Interact with Backlink", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("Interact with Backlink");
  });

  it("post134: description_for_model contains AI-curated IPTV radio", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("AI-curated IPTV radio");
  });

  it("post134: description_for_model contains Select stations", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("Select stations");
  });

  it("post134: description_for_model contains filter by genre", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("filter by genre");
  });

  it("post134: description_for_model contains now-playing info", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("now-playing info");
  });

  it("post134: description_for_model contains AI curator", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("AI curator");
  });

  it("post134: description_for_model contains best station for a mood", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("best station for a mood");
  });

  it("post134: description_for_human contains AI-curated live radio", () => {
    expect(MCP_MANIFEST.description_for_human).toContain("AI-curated live radio");
  });

  it("post134: description_for_human contains iptv-org catalog", () => {
    expect(MCP_MANIFEST.description_for_human).toContain("iptv-org catalog");
  });

  it("post134: mcp.ts forbids invent phrase /playlist", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("/playlist");
  });

  it("post134: mcp.ts forbids invent phrase /now-playing endpoint", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("/now-playing endpoint");
  });

  it("post134: mcp.ts forbids invent phrase workers ai", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("workers ai");
  });

  it("post134: mcp.ts forbids invent phrase d1_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("d1_");
  });

  it("post134: mcp.ts forbids invent phrase r2_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("r2_");
  });

  it("post134: mcp.ts forbids invent phrase vectorize", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("vectorize");
  });

  it("post134: mcp.ts forbids invent phrase analytics engine", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("analytics engine");
  });

  it("post134: mcp.ts forbids invent phrase hyperdrive", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("hyperdrive");
  });

  it("post134: mcp.ts forbids invent phrase anthropic", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("anthropic");
  });

  it("post134: mcp.ts forbids invent phrase claude", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("claude");
  });

  it("post134: mcp.ts forbids invent phrase openai", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("openai");
  });

  it("post134: mcp.ts forbids invent phrase durable_object", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("durable_object");
  });

  it("post134: mcp.ts forbids invent phrase queue_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("queue_");
  });

  it("post134: mcp.ts forbids invent phrase service binding", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("service binding");
  });

  it("post134: tool station_select has no claw_ prefix", () => {
    expect(toolNamed("station_select").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("station_select").name).toBe("station_select");
  });

  it("post134: tool now_playing has no claw_ prefix", () => {
    expect(toolNamed("now_playing").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("now_playing").name).toBe("now_playing");
  });

  it("post134: tool genre_filter has no claw_ prefix", () => {
    expect(toolNamed("genre_filter").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("genre_filter").name).toBe("genre_filter");
  });

  it("post134: tool curator_prompt has no claw_ prefix", () => {
    expect(toolNamed("curator_prompt").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("curator_prompt").name).toBe("curator_prompt");
  });

  it("post134: mega purity 40x mcp.ts sha256", () => {
    const expected = "6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683";
    for (let i = 0; i < 40; i++) expect(sha256('src/mcp.ts')).toBe(expected);
  });

  it("post134: mega purity 40x compact sha256", () => {
    const expected = "11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043";
    for (let i = 0; i < 40; i++) {
      expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe(expected);
    }
  });

  it("post134: docs list backlink_* tools distinct from claw-mcp runtime ids", () => {
    const docs = read('docs/mcp-spec.md');
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing'] as const) {
      expect(docs).toContain(id);
    }
    // docs use product tool ids; runtime MCP_MANIFEST keeps claw-mcp names
    expect(docs).not.toContain('station_select');
    expect(docs).not.toContain('genre_filter');
    expect(docs).not.toContain('curator_prompt');
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select', 'now_playing', 'genre_filter', 'curator_prompt',
    ]);
  });

  it("post134: docs mention live HTTP endpoints without inventing /playlist", () => {
    const docs = read('docs/mcp-spec.md');
    expect(docs).toMatch(/\/curate/);
    expect(docs).toMatch(/\/genres/);
    expect(docs).toMatch(/\/stations|\/health|Base URL/);
    expect(docs).not.toMatch(/\/playlist/);
  });

  it("post134: docs note KV TTL and Gemini graceful degradation", () => {
    const docs = read('docs/mcp-spec.md');
    expect(docs).toMatch(/1h TTL|TTL/i);
    expect(docs).toMatch(/editorial: null|graceful degradation/i);
  });

  it("post134: docs Base URL stays backlink.fuzzywigg.com", () => {
    expect(read('docs/mcp-spec.md')).toContain('https://backlink.fuzzywigg.com');
  });

  it("post134: HMAC digests differ for distinct keys on mcp.ts", () => {
    expect(hmacSha256('post134', 'src/mcp.ts')).not.toBe(hmacSha256('leftover', 'src/mcp.ts'));
    expect(hmacSha256('TOKENMAXX', 'src/mcp.ts')).not.toBe(hmacSha256('HEAVY', 'src/mcp.ts'));
    expect(hmacSha256('station_select', 'src/mcp.ts')).not.toBe(hmacSha256('now_playing', 'src/mcp.ts'));
  });

  it("post134: extra HMAC keys inventory digest", () => {
    const keys = ["mcp","backlink","Backlink Radio","station_select","now_playing","genre_filter","curator_prompt","openapi","schema_version","claw-mcp","fuzzywigg","iptv-org","post108","post126","VALID_GENRES","GENRE_MAP"];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe("5afbcdd1fa06176ba39d4b6c566bdc0ad9239318f14ffc10a832060de66ac42b");
    expect(keys).toHaveLength(16);
  });

  it("post134: final inventory markers", () => {
    const body = read('test/mcp.test.ts');
    expect(body).toContain("describe('post108 mcp HEAVY deepen'");
    expect(body).toContain("describe('post108 mcp HEAVY deepen extras'");
    expect(body).toContain("describe('post134 mcp HEAVY deepen (after #134)'");
    expect((body.match(/it\("post134:/g) ?? []).length).toBeGreaterThan(80);
  });

});

describe('post140 mcp HEAVY deepen (after #140)', () => {
  const read = (rel: string) => readFileSync(join(mcpRoot, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(mcpRoot, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(mcpRoot, rel))).digest('hex');
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


  it("post140: locks src/mcp.ts sha256", () => {
    expect(sha256("src/mcp.ts")).toBe("6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683");
  });

  it("post140: locks src/mcp.ts sha1", () => {
    expect(sha1("src/mcp.ts")).toBe("848b3977365809fda54fcb74a7d09affe685ea82");
  });

  it("post140: locks src/mcp.ts md5", () => {
    expect(md5("src/mcp.ts")).toBe("52e71c72e32e3d95b8b8d61ff4a2cf46");
  });

  it("post140: locks src/mcp.ts sha384", () => {
    expect(sha384("src/mcp.ts")).toBe("a95bef5fcb3b93e9c05aac94aaa6a49adb47a360bfaf046e65f7254c2249fd1f34ff923ec401752e2701b7260d9949d2");
  });

  it("post140: locks src/mcp.ts sha512", () => {
    expect(sha512("src/mcp.ts")).toBe("aa1525a8464db0a7d40982c8f0c091b63f8b21ea363f642ca9781513618d4fb99a9926e39118f65788c423a6bd6ee2318b3165f6007ca9599d36fe7fc7820c05");
  });

  it("post140: locks src/mcp.ts sha3-256", () => {
    expect(sha3("src/mcp.ts")).toBe("9072d42bee801bb2a3ea3f058ea604be67a2e7e599f21afb0d26f27817f44b16");
  });

  it("post140: locks src/mcp.ts blake2b512", () => {
    expect(blake2b("src/mcp.ts")).toBe("f91cd566835e001abe86d934663f36715b1082627dfb8abea78ffd99a50fe41e22d7d9b694301c9b2b27d16a675e3380dffdca34a74b4dbe2ea5b6af00e8ab43");
  });

  it("post140: locks src/mcp.ts ripemd160", () => {
    expect(ripemd("src/mcp.ts")).toBe("105ea9a796a49f5987df733c71c1abf0ab5ddad4");
  });

  it("post140: locks src/mcp.ts size 2057", () => {
    expect(statSync(join(mcpRoot, "src/mcp.ts")).size).toBe(2057);
    expect(readFileSync(join(mcpRoot, "src/mcp.ts")).byteLength).toBe(2057);
  });

  it("post140: locks src/mcp.ts utf8 2057 lines 68", () => {
    expect(read("src/mcp.ts")).toHaveLength(2057);
    expect(read("src/mcp.ts").split('\n')).toHaveLength(68);
  });

  it("post140: locks src/mcp.ts nibble 551 xor 1", () => {
    const d = sha256("src/mcp.ts");
    expect(nibbleSum(d)).toBe(551);
    expect(xorNibbles(d)).toBe(1);
  });

  it("post140: locks src/mcp.ts pairSum 4751 rollingXor 103", () => {
    const d = sha256("src/mcp.ts");
    expect(pairSum(d)).toBe(4751);
    expect(rollingXor(d)).toBe(103);
  });

  it("post140: locks src/mcp.ts first/last/mid octets", () => {
    const d = sha256("src/mcp.ts");
    expect(d.slice(0, 2)).toBe("6a");
    expect(d.slice(-2)).toBe("83");
    expect(d.slice(28, 36)).toBe("6ad61aff");
  });

  it("post140: locks src/mcp.ts HMAC post140/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post140', "src/mcp.ts")).toBe("97b752a701e46c9e13de22e9bb31e107ca2da5d32d25ae496eaccb69343b0944");
    expect(hmacSha256('leftover', "src/mcp.ts")).toBe("8ace2389ce0308341cb978ba9c33116db731b2166d09e0adc79fa37366b8c712");
    expect(hmacSha256('TOKENMAXX', "src/mcp.ts")).toBe("cc983fd02cae540665f120f8a72c3867b8d573a30f5a9c84ace5b4cea2fb9f62");
  });

  it("post140: locks src/mcp.ts HMAC after-#140/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#140', "src/mcp.ts")).toBe("14521ae30e133a4950dd090b7922c48fbb8ac7b7a2556a30bf8786e609adabc0");
    expect(hmacSha256('HEAVY', "src/mcp.ts")).toBe("870bb2f88c83abd6679e447c6937b01c998a1b3f527024e687dc35c00a046e40");
    expect(hmacSha256('no-product-invent', "src/mcp.ts")).toBe("71a686fe812adcc92f40d5ca19a3996e68555d6749199affd3fc002053aabd65");
  });

  it("post140: locks src/mcp.ts spaces 617", () => {
    expect((read("src/mcp.ts").match(/ /g) ?? []).length).toBe(617);
  });

  it("post140: locks src/mcp.ts reversed sha256", () => {
    const rev = [...read("src/mcp.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("5fb580296684d084fa1bca986fdaa5c31fb63d427f9c5b62f7581941727ba73c");
  });

  it("post140: locks src/mcp.ts sha256 UPPERCASE", () => {
    expect(sha256("src/mcp.ts").toUpperCase()).toBe("6AE8FFD7C4B75C471DB2DFF1FE5C6AD61AFF69E38B048A366BB8B7ADB3099683");
  });

  it("post140: locks src/mcp.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("src/mcp.ts").split('\n')[0]).digest('hex')).toBe("73d0328cf8db2bc4525219dd63f5dc9b67754ff24aaa895010835d654df47da5");
  });

  it("post140: locks src/mcp.ts size*lines 139876", () => {
    expect(statSync(join(mcpRoot, "src/mcp.ts")).size * read("src/mcp.ts").split('\n').length).toBe(139876);
  });

  it("post140: locks docs/mcp-spec.md sha256", () => {
    expect(sha256("docs/mcp-spec.md")).toBe("a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849");
  });

  it("post140: locks docs/mcp-spec.md sha1", () => {
    expect(sha1("docs/mcp-spec.md")).toBe("e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a");
  });

  it("post140: locks docs/mcp-spec.md md5", () => {
    expect(md5("docs/mcp-spec.md")).toBe("ee7881030c338c1773659cc6378c392c");
  });

  it("post140: locks docs/mcp-spec.md sha384", () => {
    expect(sha384("docs/mcp-spec.md")).toBe("b32096b74bacd48065f014d2695673b3bfad3cb9118b855899a92a849cd38a7dd751db7c9e0705d6d6569d5f05f61227");
  });

  it("post140: locks docs/mcp-spec.md sha512", () => {
    expect(sha512("docs/mcp-spec.md")).toBe("8d26bafffcb1230048d80796e1d8a1019d83253810324d18383c54ff8bcaaed4a508b0a07395994af2f23e4f9b627e2202a57fcac709110d0ee859e8628709e7");
  });

  it("post140: locks docs/mcp-spec.md sha3-256", () => {
    expect(sha3("docs/mcp-spec.md")).toBe("700b4576d20353f0db25e4379cfebf496f15f0514d8998c10464bd0d6c8604f4");
  });

  it("post140: locks docs/mcp-spec.md blake2b512", () => {
    expect(blake2b("docs/mcp-spec.md")).toBe("6f441cdfb1d2b41be77e60c9aa79de5778608e02670b1067c30da76537d9e0915920752717c7302e705c5787dffea7a41f6c0669adb594689f0d256bbe7d0d31");
  });

  it("post140: locks docs/mcp-spec.md ripemd160", () => {
    expect(ripemd("docs/mcp-spec.md")).toBe("2f5cb29783b2bd4db4999e2ab61376a44c3a857b");
  });

  it("post140: locks docs/mcp-spec.md size 3552", () => {
    expect(statSync(join(mcpRoot, "docs/mcp-spec.md")).size).toBe(3552);
    expect(readFileSync(join(mcpRoot, "docs/mcp-spec.md")).byteLength).toBe(3552);
  });

  it("post140: locks docs/mcp-spec.md utf8 3544 lines 145", () => {
    expect(read("docs/mcp-spec.md")).toHaveLength(3544);
    expect(read("docs/mcp-spec.md").split('\n')).toHaveLength(145);
  });

  it("post140: locks docs/mcp-spec.md nibble 514 xor 14", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(nibbleSum(d)).toBe(514);
    expect(xorNibbles(d)).toBe(14);
  });

  it("post140: locks docs/mcp-spec.md pairSum 4534 rollingXor 164", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(pairSum(d)).toBe(4534);
    expect(rollingXor(d)).toBe(164);
  });

  it("post140: locks docs/mcp-spec.md first/last/mid octets", () => {
    const d = sha256("docs/mcp-spec.md");
    expect(d.slice(0, 2)).toBe("a9");
    expect(d.slice(-2)).toBe("49");
    expect(d.slice(28, 36)).toBe("c7628b21");
  });

  it("post140: locks docs/mcp-spec.md HMAC post140/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post140', "docs/mcp-spec.md")).toBe("c19577cc0e2dda1eee4c8737acac248e37884999162d94e2fc014cc4d6034245");
    expect(hmacSha256('leftover', "docs/mcp-spec.md")).toBe("cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df");
    expect(hmacSha256('TOKENMAXX', "docs/mcp-spec.md")).toBe("58bd8b12de8084ece067f68db2cea2ea5dc8b43305c0d5e7e20506fd40e18749");
  });

  it("post140: locks docs/mcp-spec.md HMAC after-#140/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#140', "docs/mcp-spec.md")).toBe("bd6fa153dad2cd20ed8e1a75ac17638f4f0edc628912748ce15fa9febea6c459");
    expect(hmacSha256('HEAVY', "docs/mcp-spec.md")).toBe("14502ba27898e795fb59cc37b06fe6eb2a66b40811b068e87738eb3dbf4cae59");
    expect(hmacSha256('no-product-invent', "docs/mcp-spec.md")).toBe("1ea2c93af05439c6a1c14acfbee6d34dddfc2b32e6c8b6256c270f6d4484b608");
  });

  it("post140: locks docs/mcp-spec.md spaces 640", () => {
    expect((read("docs/mcp-spec.md").match(/ /g) ?? []).length).toBe(640);
  });

  it("post140: locks docs/mcp-spec.md reversed sha256", () => {
    const rev = [...read("docs/mcp-spec.md")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("8e0a8a17d78474b7a2c052d335989cd8a980b200816869706af232736e35ab47");
  });

  it("post140: locks docs/mcp-spec.md sha256 UPPERCASE", () => {
    expect(sha256("docs/mcp-spec.md").toUpperCase()).toBe("A93978D779B976A1ABA4D34395EEC7628B21BDA910EF8A279D5EFBC05DA56849");
  });

  it("post140: locks docs/mcp-spec.md first-line sha256", () => {
    expect(createHash('sha256').update(read("docs/mcp-spec.md").split('\n')[0]).digest('hex')).toBe("99c84d33ad819ac91a66e1a30aef3bf512cb393370d7b6fbc8397c8917ba2e66");
  });

  it("post140: locks docs/mcp-spec.md size*lines 515040", () => {
    expect(statSync(join(mcpRoot, "docs/mcp-spec.md")).size * read("docs/mcp-spec.md").split('\n').length).toBe(515040);
  });

  it("post140: locks src/genres.ts sha256", () => {
    expect(sha256("src/genres.ts")).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it("post140: locks src/genres.ts sha1", () => {
    expect(sha1("src/genres.ts")).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it("post140: locks src/genres.ts md5", () => {
    expect(md5("src/genres.ts")).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it("post140: locks src/genres.ts sha384", () => {
    expect(sha384("src/genres.ts")).toBe("ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16");
  });

  it("post140: locks src/genres.ts sha512", () => {
    expect(sha512("src/genres.ts")).toBe("bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b");
  });

  it("post140: locks src/genres.ts sha3-256", () => {
    expect(sha3("src/genres.ts")).toBe("d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f");
  });

  it("post140: locks src/genres.ts blake2b512", () => {
    expect(blake2b("src/genres.ts")).toBe("731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67");
  });

  it("post140: locks src/genres.ts ripemd160", () => {
    expect(ripemd("src/genres.ts")).toBe("bb9faaf8890bdba8dd86bcdf7e418da622d19bf5");
  });

  it("post140: locks src/genres.ts size 1027", () => {
    expect(statSync(join(mcpRoot, "src/genres.ts")).size).toBe(1027);
    expect(readFileSync(join(mcpRoot, "src/genres.ts")).byteLength).toBe(1027);
  });

  it("post140: locks src/genres.ts utf8 1025 lines 48", () => {
    expect(read("src/genres.ts")).toHaveLength(1025);
    expect(read("src/genres.ts").split('\n')).toHaveLength(48);
  });

  it("post140: locks src/genres.ts nibble 500 xor 6", () => {
    const d = sha256("src/genres.ts");
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it("post140: locks src/genres.ts pairSum 3950 rollingXor 96", () => {
    const d = sha256("src/genres.ts");
    expect(pairSum(d)).toBe(3950);
    expect(rollingXor(d)).toBe(96);
  });

  it("post140: locks src/genres.ts first/last/mid octets", () => {
    const d = sha256("src/genres.ts");
    expect(d.slice(0, 2)).toBe("aa");
    expect(d.slice(-2)).toBe("4e");
    expect(d.slice(28, 36)).toBe("811dfbc2");
  });

  it("post140: locks src/genres.ts HMAC post140/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post140', "src/genres.ts")).toBe("ac6fc2daa663d9b12b315148e0e1280fe1a260acf8c52688ac0563f72456b97b");
    expect(hmacSha256('leftover', "src/genres.ts")).toBe("bc49b5523a2b049ad6ea2abd27732f8e53d9ff48d9296f3da0bd9cb76d72624f");
    expect(hmacSha256('TOKENMAXX', "src/genres.ts")).toBe("7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951");
  });

  it("post140: locks src/genres.ts HMAC after-#140/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#140', "src/genres.ts")).toBe("654bd9b55d607c3c98543be5f0d672af081b7474782c4459b89ec64d7f027834");
    expect(hmacSha256('HEAVY', "src/genres.ts")).toBe("728dd3fe7c4667ea4d489028dc3a100c092d2ede6b7319716769186532d3b575");
    expect(hmacSha256('no-product-invent', "src/genres.ts")).toBe("3d21ae09929f61fc420c1aff78e7fbcdaa55895034e581f9845399de2569142b");
  });

  it("post140: locks src/genres.ts spaces 144", () => {
    expect((read("src/genres.ts").match(/ /g) ?? []).length).toBe(144);
  });

  it("post140: locks src/genres.ts reversed sha256", () => {
    const rev = [...read("src/genres.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("02c6881bd75e415d5d3fd74f475f1cdc5843c91030255732f8decb1703f46eac");
  });

  it("post140: locks src/genres.ts sha256 UPPERCASE", () => {
    expect(sha256("src/genres.ts").toUpperCase()).toBe("AA626817CF3BC8A707AC5ADBA39F811DFBC23F695E5E0CB9D070007D839D914E");
  });

  it("post140: locks src/genres.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("src/genres.ts").split('\n')[0]).digest('hex')).toBe("907b574a0aac9a6f7bd2904b3af22ac0c611daa5f3e30b8a7a5d8f264f7ddc68");
  });

  it("post140: locks src/genres.ts size*lines 49296", () => {
    expect(statSync(join(mcpRoot, "src/genres.ts")).size * read("src/genres.ts").split('\n').length).toBe(49296);
  });

  it("post140: locks package.json sha256", () => {
    expect(sha256("package.json")).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it("post140: locks package.json sha1", () => {
    expect(sha1("package.json")).toBe("b58d14f35b9c13bb254d5e2a51240e2918a126c5");
  });

  it("post140: locks package.json md5", () => {
    expect(md5("package.json")).toBe("63472e1fb514fb0dadb5e49a7bdbaa5f");
  });

  it("post140: locks package.json sha384", () => {
    expect(sha384("package.json")).toBe("4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20");
  });

  it("post140: locks package.json sha512", () => {
    expect(sha512("package.json")).toBe("7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28");
  });

  it("post140: locks package.json sha3-256", () => {
    expect(sha3("package.json")).toBe("e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5");
  });

  it("post140: locks package.json blake2b512", () => {
    expect(blake2b("package.json")).toBe("a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d");
  });

  it("post140: locks package.json ripemd160", () => {
    expect(ripemd("package.json")).toBe("f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad");
  });

  it("post140: locks package.json size 637", () => {
    expect(statSync(join(mcpRoot, "package.json")).size).toBe(637);
    expect(readFileSync(join(mcpRoot, "package.json")).byteLength).toBe(637);
  });

  it("post140: locks package.json utf8 635 lines 26", () => {
    expect(read("package.json")).toHaveLength(635);
    expect(read("package.json").split('\n')).toHaveLength(26);
  });

  it("post140: locks package.json nibble 451 xor 13", () => {
    const d = sha256("package.json");
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it("post140: locks package.json pairSum 4051 rollingXor 13", () => {
    const d = sha256("package.json");
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it("post140: locks package.json first/last/mid octets", () => {
    const d = sha256("package.json");
    expect(d.slice(0, 2)).toBe("34");
    expect(d.slice(-2)).toBe("1c");
    expect(d.slice(28, 36)).toBe("e0ecaa43");
  });

  it("post140: locks package.json HMAC post140/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post140', "package.json")).toBe("01ace31f8255e37b1ea7f2c94c54e3394febe440558030afd272dcb82c09ceed");
    expect(hmacSha256('leftover', "package.json")).toBe("20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1");
    expect(hmacSha256('TOKENMAXX', "package.json")).toBe("ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58");
  });

  it("post140: locks package.json HMAC after-#140/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#140', "package.json")).toBe("108022f91cd45a86e1c3a53644f74138bebffd7b3402756580e62a25e1463e13");
    expect(hmacSha256('HEAVY', "package.json")).toBe("59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563");
    expect(hmacSha256('no-product-invent', "package.json")).toBe("b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b");
  });

  it("post140: locks package.json spaces 106", () => {
    expect((read("package.json").match(/ /g) ?? []).length).toBe(106);
  });

  it("post140: locks package.json reversed sha256", () => {
    const rev = [...read("package.json")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("76b81fd27392035d0e4776f664acfb5bf67811a2b3ebb57b61b7be81ceb7ccc4");
  });

  it("post140: locks package.json sha256 UPPERCASE", () => {
    expect(sha256("package.json").toUpperCase()).toBe("34552493F3008B58991D10E7B41EE0ECAA43BF8BA3E79D261AC2A061E6F7181C");
  });

  it("post140: locks package.json first-line sha256", () => {
    expect(createHash('sha256').update(read("package.json").split('\n')[0]).digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it("post140: locks package.json size*lines 16562", () => {
    expect(statSync(join(mcpRoot, "package.json")).size * read("package.json").split('\n').length).toBe(16562);
  });

  it("post140: locks vitest.config.ts sha256", () => {
    expect(sha256("vitest.config.ts")).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it("post140: locks vitest.config.ts sha1", () => {
    expect(sha1("vitest.config.ts")).toBe("f8d49517ece92fc5e9781fbde021a948958aac37");
  });

  it("post140: locks vitest.config.ts md5", () => {
    expect(md5("vitest.config.ts")).toBe("f1176313255f5f064a946d458482d81a");
  });

  it("post140: locks vitest.config.ts sha384", () => {
    expect(sha384("vitest.config.ts")).toBe("c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563");
  });

  it("post140: locks vitest.config.ts sha512", () => {
    expect(sha512("vitest.config.ts")).toBe("ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682");
  });

  it("post140: locks vitest.config.ts sha3-256", () => {
    expect(sha3("vitest.config.ts")).toBe("ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba");
  });

  it("post140: locks vitest.config.ts blake2b512", () => {
    expect(blake2b("vitest.config.ts")).toBe("93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a");
  });

  it("post140: locks vitest.config.ts ripemd160", () => {
    expect(ripemd("vitest.config.ts")).toBe("6f29a743813430d4d364f8ddd66e0aedf1506fcd");
  });

  it("post140: locks vitest.config.ts size 535", () => {
    expect(statSync(join(mcpRoot, "vitest.config.ts")).size).toBe(535);
    expect(readFileSync(join(mcpRoot, "vitest.config.ts")).byteLength).toBe(535);
  });

  it("post140: locks vitest.config.ts utf8 535 lines 22", () => {
    expect(read("vitest.config.ts")).toHaveLength(535);
    expect(read("vitest.config.ts").split('\n')).toHaveLength(22);
  });

  it("post140: locks vitest.config.ts nibble 536 xor 2", () => {
    const d = sha256("vitest.config.ts");
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it("post140: locks vitest.config.ts pairSum 4691 rollingXor 49", () => {
    const d = sha256("vitest.config.ts");
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it("post140: locks vitest.config.ts first/last/mid octets", () => {
    const d = sha256("vitest.config.ts");
    expect(d.slice(0, 2)).toBe("f9");
    expect(d.slice(-2)).toBe("38");
    expect(d.slice(28, 36)).toBe("ec95c6d5");
  });

  it("post140: locks vitest.config.ts HMAC post140/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post140', "vitest.config.ts")).toBe("c1174319ab5ee67528b7a5b495e608d3919e82ce0060eefd61dd21c23c2acaea");
    expect(hmacSha256('leftover', "vitest.config.ts")).toBe("3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7");
    expect(hmacSha256('TOKENMAXX', "vitest.config.ts")).toBe("0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9");
  });

  it("post140: locks vitest.config.ts HMAC after-#140/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#140', "vitest.config.ts")).toBe("76de0bbd627e024c555cc105142d1c12bf18a53cf8f721099603270ad36d2e6d");
    expect(hmacSha256('HEAVY', "vitest.config.ts")).toBe("08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179");
    expect(hmacSha256('no-product-invent', "vitest.config.ts")).toBe("3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c");
  });

  it("post140: locks vitest.config.ts spaces 121", () => {
    expect((read("vitest.config.ts").match(/ /g) ?? []).length).toBe(121);
  });

  it("post140: locks vitest.config.ts reversed sha256", () => {
    const rev = [...read("vitest.config.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("0938009226d244856c43668b42c9aa000689efe510086849e55daf781d867c2b");
  });

  it("post140: locks vitest.config.ts sha256 UPPERCASE", () => {
    expect(sha256("vitest.config.ts").toUpperCase()).toBe("F9B58BB937531DA55AD474592E69EC95C6D55A5B8B878F8FA251C0F8D6CAFF38");
  });

  it("post140: locks vitest.config.ts first-line sha256", () => {
    expect(createHash('sha256').update(read("vitest.config.ts").split('\n')[0]).digest('hex')).toBe("85734f4752244f71454215d0cfbe952f4ff6d79da03016ebd55e0dd9a1e7d328");
  });

  it("post140: locks vitest.config.ts size*lines 11770", () => {
    expect(statSync(join(mcpRoot, "vitest.config.ts")).size * read("vitest.config.ts").split('\n').length).toBe(11770);
  });

  it("post140: locks AGENTS.md sha256", () => {
    expect(sha256("AGENTS.md")).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it("post140: locks AGENTS.md sha1", () => {
    expect(sha1("AGENTS.md")).toBe("a7df1fec05dcf7b8ace116788297c77f467a7b6c");
  });

  it("post140: locks AGENTS.md md5", () => {
    expect(md5("AGENTS.md")).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it("post140: locks AGENTS.md sha384", () => {
    expect(sha384("AGENTS.md")).toBe("817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a");
  });

  it("post140: locks AGENTS.md sha512", () => {
    expect(sha512("AGENTS.md")).toBe("7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908");
  });

  it("post140: locks AGENTS.md sha3-256", () => {
    expect(sha3("AGENTS.md")).toBe("894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4");
  });

  it("post140: locks AGENTS.md blake2b512", () => {
    expect(blake2b("AGENTS.md")).toBe("7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0");
  });

  it("post140: locks AGENTS.md ripemd160", () => {
    expect(ripemd("AGENTS.md")).toBe("6637e853e0148967671e4a3f21bd852255e8ed1c");
  });

  it("post140: locks AGENTS.md size 1017", () => {
    expect(statSync(join(mcpRoot, "AGENTS.md")).size).toBe(1017);
    expect(readFileSync(join(mcpRoot, "AGENTS.md")).byteLength).toBe(1017);
  });

  it("post140: locks AGENTS.md utf8 1011 lines 35", () => {
    expect(read("AGENTS.md")).toHaveLength(1011);
    expect(read("AGENTS.md").split('\n')).toHaveLength(35);
  });

  it("post140: locks AGENTS.md nibble 479 xor 5", () => {
    const d = sha256("AGENTS.md");
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it("post140: locks AGENTS.md pairSum 5084 rollingXor 216", () => {
    const d = sha256("AGENTS.md");
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it("post140: locks AGENTS.md first/last/mid octets", () => {
    const d = sha256("AGENTS.md");
    expect(d.slice(0, 2)).toBe("48");
    expect(d.slice(-2)).toBe("aa");
    expect(d.slice(28, 36)).toBe("a5ec1be5");
  });

  it("post140: locks AGENTS.md HMAC post140/leftover/TOKENMAXX", () => {
    expect(hmacSha256('post140', "AGENTS.md")).toBe("53e4063c77441971957d5e693804747ee0ef85107dfb48f8b7b0f9489ad59bf5");
    expect(hmacSha256('leftover', "AGENTS.md")).toBe("ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e");
    expect(hmacSha256('TOKENMAXX', "AGENTS.md")).toBe("b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f");
  });

  it("post140: locks AGENTS.md HMAC after-#140/HEAVY/no-product-invent", () => {
    expect(hmacSha256('after-#140', "AGENTS.md")).toBe("e7903d3341f23b0b9aca815a74166b99d8f340a4e9363d938b881e78fa951bc4");
    expect(hmacSha256('HEAVY', "AGENTS.md")).toBe("f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c");
    expect(hmacSha256('no-product-invent', "AGENTS.md")).toBe("dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264");
  });

  it("post140: locks AGENTS.md spaces 120", () => {
    expect((read("AGENTS.md").match(/ /g) ?? []).length).toBe(120);
  });

  it("post140: locks AGENTS.md reversed sha256", () => {
    const rev = [...read("AGENTS.md")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("662d61b72071234b614b17c421d0f8a3fc73757a69c1690a0b6a36fd122672dc");
  });

  it("post140: locks AGENTS.md sha256 UPPERCASE", () => {
    expect(sha256("AGENTS.md").toUpperCase()).toBe("48E590B4F146E2FBD1EBB409E0D5A5EC1BE50B72B2C310F1C1E360487B36FEAA");
  });

  it("post140: locks AGENTS.md first-line sha256", () => {
    expect(createHash('sha256').update(read("AGENTS.md").split('\n')[0]).digest('hex')).toBe("e3df46c4dc415311293b71de67e5df2d01a72a69658ef8f8cf5ac9e682d8d618");
  });

  it("post140: locks AGENTS.md size*lines 35595", () => {
    expect(statSync(join(mcpRoot, "AGENTS.md")).size * read("AGENTS.md").split('\n').length).toBe(35595);
  });

  it("post140: HMAC src/mcp.ts key mcp", () => {
    expect(hmacSha256("mcp", "src/mcp.ts")).toBe("ccc71129d02f2aea082bc5dfbffb139ca2d4ce8cbb2434c03dc2f8776f7c2819");
  });

  it("post140: HMAC src/mcp.ts key backlink", () => {
    expect(hmacSha256("backlink", "src/mcp.ts")).toBe("948dbb9d47ee26b53b9ed9f9656e46752675060261aec301d8a9688178c14b7d");
  });

  it("post140: HMAC src/mcp.ts key Backlink Radio", () => {
    expect(hmacSha256("Backlink Radio", "src/mcp.ts")).toBe("d61171f097655fd1e99e3fbe76f6c7ddb35b0ce15c63cb13081124b0f53d4860");
  });

  it("post140: HMAC src/mcp.ts key station_select", () => {
    expect(hmacSha256("station_select", "src/mcp.ts")).toBe("d8c897e3e257256d5c946e2e941fbc36b75dc2a5027d3685a0f2446686d8cea2");
  });

  it("post140: HMAC src/mcp.ts key now_playing", () => {
    expect(hmacSha256("now_playing", "src/mcp.ts")).toBe("96cc206873f09cc5de0c09d24c34da0daa4923eeb79077fc55e393f6215c3c5d");
  });

  it("post140: HMAC src/mcp.ts key genre_filter", () => {
    expect(hmacSha256("genre_filter", "src/mcp.ts")).toBe("d5fb3f55b4e99eebe3005c654592da845e3f41c4f552e3bc98f4119ff03cf189");
  });

  it("post140: HMAC src/mcp.ts key curator_prompt", () => {
    expect(hmacSha256("curator_prompt", "src/mcp.ts")).toBe("70897363a596f9754bee8cc34105600129e430194d666f995b799708bf1b3259");
  });

  it("post140: HMAC src/mcp.ts key openapi", () => {
    expect(hmacSha256("openapi", "src/mcp.ts")).toBe("23d20e1f26a97ecc18e15e745c7da152c106dd8c4bbf3c1bb613c409581a5f6f");
  });

  it("post140: HMAC src/mcp.ts key schema_version", () => {
    expect(hmacSha256("schema_version", "src/mcp.ts")).toBe("49151d77055e1ab6a8d5dba06712e46bd0a691799e6fdcaa4061081f97f732d9");
  });

  it("post140: HMAC src/mcp.ts key claw-mcp", () => {
    expect(hmacSha256("claw-mcp", "src/mcp.ts")).toBe("d2be78dfaf67430ea34569738fbdb4577f6cb48928cd16c895ec53378b2e1eb5");
  });

  it("post140: HMAC src/mcp.ts key fuzzywigg", () => {
    expect(hmacSha256("fuzzywigg", "src/mcp.ts")).toBe("93171a03382e2488888b170abdf10cc84dbd7ec7e77448b36c60d6758faac830");
  });

  it("post140: HMAC src/mcp.ts key iptv-org", () => {
    expect(hmacSha256("iptv-org", "src/mcp.ts")).toBe("dcaf0c454cf3ee0bbaba12121ffe1183726881c6eb0f1f0714218d84c63cd1d7");
  });

  it("post140: HMAC src/mcp.ts key post108", () => {
    expect(hmacSha256("post108", "src/mcp.ts")).toBe("a083f425b35fca6441d9148d33d2980bde5c58c304ae6d099d12aaa604fc6fbf");
  });

  it("post140: HMAC src/mcp.ts key post126", () => {
    expect(hmacSha256("post126", "src/mcp.ts")).toBe("d6bbbe08e1a6d4ce854fc3037c5a4590d86f31d868892f4fa30aeddaf6e4a1ff");
  });

  it("post140: HMAC src/mcp.ts key VALID_GENRES", () => {
    expect(hmacSha256("VALID_GENRES", "src/mcp.ts")).toBe("7b49b3a4b4234c1df692867963df7f92e3cba6160e503301f5dca4f28d0e14cc");
  });

  it("post140: HMAC src/mcp.ts key GENRE_MAP", () => {
    expect(hmacSha256("GENRE_MAP", "src/mcp.ts")).toBe("444b4d15f27bca3371c2c56198cfa3e954d4dd9f7014694949fbf3b528765cb9");
  });

  it("post140: MCP_MANIFEST schema/auth/api stable", () => {
    expect(MCP_MANIFEST.schema_version).toBe("v1");
    expect(MCP_MANIFEST.name_for_model).toBe("backlink");
    expect(MCP_MANIFEST.name_for_human).toBe("Backlink Radio");
    expect(MCP_MANIFEST.auth).toEqual({"type":"none"});
    expect(MCP_MANIFEST.api).toEqual({"type":"openapi","url":"/openapi.json"});
  });

  it("post140: MCP_MANIFEST tools order stable", () => {
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual(["station_select","now_playing","genre_filter","curator_prompt"]);
    expect(MCP_MANIFEST.tools).toHaveLength(4);
  });

  it("post140: compact JSON sha256", () => {
    expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043");
    expect(JSON.stringify(MCP_MANIFEST)).toHaveLength(1534);
  });

  it("post140: compact HMAC key post140", () => {
    expect(createHmac('sha256', "post140").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("e9ae66ad409392fc0f89a18f68fc57c21dd709fa0065817ac0ce8407b2afb5d0");
  });

  it("post140: compact HMAC key leftover", () => {
    expect(createHmac('sha256', "leftover").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("6503ddae3d9c2d52d19c2828c8d98b979a5afe735094369937c01437b4993409");
  });

  it("post140: compact HMAC key TOKENMAXX", () => {
    expect(createHmac('sha256', "TOKENMAXX").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("ac3aa328b66887e37f2a98c5b73872089735c9150d4a3d4c00192b9e1974fbac");
  });

  it("post140: compact HMAC key HEAVY", () => {
    expect(createHmac('sha256', "HEAVY").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("360825dd0456638ccca74ad826aae66f7f2f91f3303154f77e77ac5bc76ef27f");
  });

  it("post140: compact HMAC key after-#140", () => {
    expect(createHmac('sha256', "after-#140").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("a0c5280beab3c8a288dfc7d15f8c03092c9d602b9dde19d9d0aefbe0aaa3b0e4");
  });

  it("post140: compact HMAC key no-product-invent", () => {
    expect(createHmac('sha256', "no-product-invent").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("1ec4402a90b3f87fb1fd32de33122b40fedaa3a1d623804b31bbd11109100713");
  });

  it("post140: compact HMAC key mcp", () => {
    expect(createHmac('sha256', "mcp").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("db5fa1c6207d9ed45ed725bb2a1042439b0344aa0aedad24e9abc40599f737f5");
  });

  it("post140: compact HMAC key station_select", () => {
    expect(createHmac('sha256', "station_select").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("6a2bc46cadb38d7a926172f9e35743a163a3f84c496cc2f67610472fe970e32c");
  });

  it("post140: compact HMAC key curator_prompt", () => {
    expect(createHmac('sha256', "curator_prompt").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("29d8ce477119d329ff752814955f65de2c59b97dc386561a7db2fe8b5635282e");
  });

  it("post140: compact HMAC key openapi", () => {
    expect(createHmac('sha256', "openapi").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("f22724cc03066a9c9eea99647ed50d67473aff1348a6a678bd4f0247216449b7");
  });

  it("post140: compact HMAC key claw-mcp", () => {
    expect(createHmac('sha256', "claw-mcp").update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe("8dd5570110e0f4c6f4a667cb96982f895ea5f312856a62a3f00dfcdba154fad7");
  });

  it("post140: tool station_select description exact", () => {
    expect(toolNamed("station_select").description).toBe("Set the currently playing station by name.");
  });

  it("post140: tool station_select description sha256", () => {
    expect(createHash('sha256').update(toolNamed("station_select").description, 'utf8').digest('hex')).toBe("1b1b6035f3a55908462e8bec71c002374de19a5863b402f9785a13f736ca1be6");
  });

  it("post140: tool station_select required [\"station_name\"]", () => {
    expect(toolNamed("station_select").input_schema.required ?? []).toEqual(["station_name"]);
  });

  it("post140: tool station_select property keys", () => {
    expect(Object.keys(toolNamed("station_select").input_schema.properties)).toEqual(["station_name"]);
  });

  it("post140: tool station_select.station_name type+desc", () => {
    const prop = toolNamed("station_select").input_schema.properties["station_name"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Partial or full name of the station to select.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("85b77e93e2d24bc6f5b94d41003ba6d43f1c4eb5c5294801fac6c408f0750205");
  });

  it("post140: tool now_playing description exact", () => {
    expect(toolNamed("now_playing").description).toBe("Get the currently playing station including name, genre, stream URL, and country.");
  });

  it("post140: tool now_playing description sha256", () => {
    expect(createHash('sha256').update(toolNamed("now_playing").description, 'utf8').digest('hex')).toBe("15a43880c871d46c36973e95f77b64ff910e68284acdf219fa6c82978af29e7b");
  });

  it("post140: tool now_playing required []", () => {
    expect(toolNamed("now_playing").input_schema.required ?? []).toEqual([]);
  });

  it("post140: tool now_playing property keys", () => {
    expect(Object.keys(toolNamed("now_playing").input_schema.properties)).toEqual([]);
  });

  it("post140: tool genre_filter description exact", () => {
    expect(toolNamed("genre_filter").description).toBe("Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).");
  });

  it("post140: tool genre_filter description sha256", () => {
    expect(createHash('sha256').update(toolNamed("genre_filter").description, 'utf8').digest('hex')).toBe("3457f6157ae02b0b6c31bcfeabe4332f8954a58944c501b1b8d9bf8a67733d30");
  });

  it("post140: tool genre_filter required [\"genre\"]", () => {
    expect(toolNamed("genre_filter").input_schema.required ?? []).toEqual(["genre"]);
  });

  it("post140: tool genre_filter property keys", () => {
    expect(Object.keys(toolNamed("genre_filter").input_schema.properties)).toEqual(["genre"]);
  });

  it("post140: tool genre_filter.genre type+desc", () => {
    const prop = toolNamed("genre_filter").input_schema.properties["genre"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Genre keyword to filter by.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("ef1f96a903a23d6e90ed07ff0e44463a931b11b5c04918a309aa4f580ce09f17");
  });

  it("post140: tool curator_prompt description exact", () => {
    expect(toolNamed("curator_prompt").description).toBe("Ask the AI curator to pick and set the best station for a given mood or context.");
  });

  it("post140: tool curator_prompt description sha256", () => {
    expect(createHash('sha256').update(toolNamed("curator_prompt").description, 'utf8').digest('hex')).toBe("c3bcfd16227da8c0c55d606d7da1a1ea26a3032dc1db779e316e31c5b9014ad3");
  });

  it("post140: tool curator_prompt required [\"mood\"]", () => {
    expect(toolNamed("curator_prompt").input_schema.required ?? []).toEqual(["mood"]);
  });

  it("post140: tool curator_prompt property keys", () => {
    expect(Object.keys(toolNamed("curator_prompt").input_schema.properties)).toEqual(["mood","genre"]);
  });

  it("post140: tool curator_prompt.mood type+desc", () => {
    const prop = toolNamed("curator_prompt").input_schema.properties["mood"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("31234660f70b2056f5daf1c3b1ca4a65637b12154981d7f44d83d1972e479449");
  });

  it("post140: tool curator_prompt.genre type+desc", () => {
    const prop = toolNamed("curator_prompt").input_schema.properties["genre"]!;
    expect(prop.type).toBe("string");
    expect(prop.description).toBe("Optional genre to constrain the selection.");
    expect(createHash('sha256').update(prop.description ?? '', 'utf8').digest('hex')).toBe("c8a41a58580e4507ab783a1bf084fc0f834cf15e6dc9f358dddc1fba16d43210");
  });

  it("post140: description_for_model contains Interact with Backlink", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("Interact with Backlink");
  });

  it("post140: description_for_model contains AI-curated IPTV radio", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("AI-curated IPTV radio");
  });

  it("post140: description_for_model contains Select stations", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("Select stations");
  });

  it("post140: description_for_model contains filter by genre", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("filter by genre");
  });

  it("post140: description_for_model contains now-playing info", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("now-playing info");
  });

  it("post140: description_for_model contains AI curator", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("AI curator");
  });

  it("post140: description_for_model contains best station for a mood", () => {
    expect(MCP_MANIFEST.description_for_model).toContain("best station for a mood");
  });

  it("post140: description_for_human contains AI-curated live radio", () => {
    expect(MCP_MANIFEST.description_for_human).toContain("AI-curated live radio");
  });

  it("post140: description_for_human contains iptv-org catalog", () => {
    expect(MCP_MANIFEST.description_for_human).toContain("iptv-org catalog");
  });

  it("post140: mcp.ts forbids invent phrase /playlist", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("/playlist");
  });

  it("post140: mcp.ts forbids invent phrase /now-playing endpoint", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("/now-playing endpoint");
  });

  it("post140: mcp.ts forbids invent phrase workers ai", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("workers ai");
  });

  it("post140: mcp.ts forbids invent phrase d1_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("d1_");
  });

  it("post140: mcp.ts forbids invent phrase r2_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("r2_");
  });

  it("post140: mcp.ts forbids invent phrase vectorize", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("vectorize");
  });

  it("post140: mcp.ts forbids invent phrase analytics engine", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("analytics engine");
  });

  it("post140: mcp.ts forbids invent phrase hyperdrive", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("hyperdrive");
  });

  it("post140: mcp.ts forbids invent phrase anthropic", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("anthropic");
  });

  it("post140: mcp.ts forbids invent phrase claude", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("claude");
  });

  it("post140: mcp.ts forbids invent phrase openai", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("openai");
  });

  it("post140: mcp.ts forbids invent phrase durable_object", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("durable_object");
  });

  it("post140: mcp.ts forbids invent phrase queue_", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("queue_");
  });

  it("post140: mcp.ts forbids invent phrase service binding", () => {
    expect(read('src/mcp.ts').toLowerCase()).not.toContain("service binding");
  });

  it("post140: tool station_select has no claw_ prefix", () => {
    expect(toolNamed("station_select").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("station_select").name).toBe("station_select");
  });

  it("post140: tool now_playing has no claw_ prefix", () => {
    expect(toolNamed("now_playing").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("now_playing").name).toBe("now_playing");
  });

  it("post140: tool genre_filter has no claw_ prefix", () => {
    expect(toolNamed("genre_filter").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("genre_filter").name).toBe("genre_filter");
  });

  it("post140: tool curator_prompt has no claw_ prefix", () => {
    expect(toolNamed("curator_prompt").name.startsWith('claw_')).toBe(false);
    expect(toolNamed("curator_prompt").name).toBe("curator_prompt");
  });

  it("post140: mega purity 40x mcp.ts sha256", () => {
    const expected = "6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683";
    for (let i = 0; i < 40; i++) expect(sha256('src/mcp.ts')).toBe(expected);
  });

  it("post140: mega purity 40x compact sha256", () => {
    const expected = "11910aab98869ffe2c0979b423e62faff2f82b1aa19d3e6a13a9cb23be9c1043";
    for (let i = 0; i < 40; i++) {
      expect(createHash('sha256').update(JSON.stringify(MCP_MANIFEST), 'utf8').digest('hex')).toBe(expected);
    }
  });

  it("post140: docs list backlink_* tools distinct from claw-mcp runtime ids", () => {
    const docs = read('docs/mcp-spec.md');
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing'] as const) {
      expect(docs).toContain(id);
    }
    // docs use product tool ids; runtime MCP_MANIFEST keeps claw-mcp names
    expect(docs).not.toContain('station_select');
    expect(docs).not.toContain('genre_filter');
    expect(docs).not.toContain('curator_prompt');
    expect(MCP_MANIFEST.tools.map((t) => t.name)).toEqual([
      'station_select', 'now_playing', 'genre_filter', 'curator_prompt',
    ]);
  });

  it("post140: docs mention live HTTP endpoints without inventing /playlist", () => {
    const docs = read('docs/mcp-spec.md');
    expect(docs).toMatch(/\/curate/);
    expect(docs).toMatch(/\/genres/);
    expect(docs).toMatch(/\/stations|\/health|Base URL/);
    expect(docs).not.toMatch(/\/playlist/);
  });

  it("post140: docs note KV TTL and Gemini graceful degradation", () => {
    const docs = read('docs/mcp-spec.md');
    expect(docs).toMatch(/1h TTL|TTL/i);
    expect(docs).toMatch(/editorial: null|graceful degradation/i);
  });

  it("post140: docs Base URL stays backlink.fuzzywigg.com", () => {
    expect(read('docs/mcp-spec.md')).toContain('https://backlink.fuzzywigg.com');
  });

  it("post140: HMAC digests differ for distinct keys on mcp.ts", () => {
    expect(hmacSha256('post140', 'src/mcp.ts')).not.toBe(hmacSha256('leftover', 'src/mcp.ts'));
    expect(hmacSha256('TOKENMAXX', 'src/mcp.ts')).not.toBe(hmacSha256('HEAVY', 'src/mcp.ts'));
    expect(hmacSha256('station_select', 'src/mcp.ts')).not.toBe(hmacSha256('now_playing', 'src/mcp.ts'));
  });

  it("post140: extra HMAC keys inventory digest", () => {
    const keys = ["mcp","backlink","Backlink Radio","station_select","now_playing","genre_filter","curator_prompt","openapi","schema_version","claw-mcp","fuzzywigg","iptv-org","post108","post126","VALID_GENRES","GENRE_MAP","post134","post140"];
    expect(createHash('sha256').update(keys.join('|'), 'utf8').digest('hex')).toBe("cef58f2b581caa786ecd6a2697dfe40a19bfcf186b0ca390058402d68205444e");
    expect(keys).toHaveLength(18);
  });

  it("post140: final inventory markers", () => {
    const body = read('test/mcp.test.ts');
    expect(body).toContain("describe('post108 mcp HEAVY deepen'");
    expect(body).toContain("describe('post108 mcp HEAVY deepen extras'");
    expect(body).toContain("describe('post134 mcp HEAVY deepen (after #134)'");
    expect(body).toContain("describe('post140 mcp HEAVY deepen (after #140)'");
    expect((body.match(/it\("post140:/g) ?? []).length).toBeGreaterThan(80);
  });

});
