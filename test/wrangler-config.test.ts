import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');

describe('wrangler.toml contracts', () => {
  it('points main at the Worker entry and sets a compatibility date', () => {
    expect(toml).toMatch(/^\s*name\s*=\s*"backlink"/m);
    expect(toml).toMatch(/^\s*main\s*=\s*"src\/index\.ts"/m);
    expect(toml).toMatch(/^\s*compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"/m);
  });

  it('binds CATALOG_CACHE KV without embedding secret values', () => {
    expect(toml).toMatch(/\[\[kv_namespaces\]\]/);
    expect(toml).toMatch(/binding\s*=\s*"CATALOG_CACHE"/);
    expect(toml).toMatch(/id\s*=\s*"[a-f0-9]{32}"/);
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(toml).not.toMatch(/ANTHROPIC_API_KEY/);
  });

  it('exposes VERSION as a non-secret var', () => {
    expect(toml).toMatch(/\[vars\]/);
    expect(toml).toMatch(/VERSION\s*=\s*"0\.1\.0"/);
  });

  it('documents secret setup via comment, not inline values', () => {
    expect(toml).toMatch(/wrangler secret put GEMINI_API_KEY/);
  });

  it('routes the custom domain without embedding API keys', () => {
    expect(toml).toMatch(/\[\[routes\]\]/);
    expect(toml).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(toml).toMatch(/custom_domain\s*=\s*true/);
    expect(toml).not.toMatch(/api[_-]?key\s*=/i);
  });

  it('does not enable workers.dev route overrides or durable objects', () => {
    expect(toml).not.toMatch(/durable_objects/i);
    expect(toml).not.toMatch(/workers_dev\s*=/);
    expect(toml).not.toMatch(/\[triggers\]/);
  });

  it('keeps a single KV namespace binding named CATALOG_CACHE', () => {
    const bindings = [...toml.matchAll(/binding\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(bindings).toEqual(['CATALOG_CACHE']);
  });

  it('locks compatibility_date to a concrete YYYY-MM-DD value', () => {
    expect(toml).toMatch(/compatibility_date\s*=\s*"2025-01-01"/);
  });

  it('does not declare [ai] or r2 / d1 bindings', () => {
    expect(toml).not.toMatch(/\[\[?r2/i);
    expect(toml).not.toMatch(/\[\[?d1/i);
    expect(toml).not.toMatch(/^\s*\[ai\]/m);
  });

  it('keeps worker name aligned with package name', () => {
    expect(toml).toMatch(/name\s*=\s*"backlink"/);
  });
});
