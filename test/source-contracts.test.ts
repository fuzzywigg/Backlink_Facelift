import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('source ↔ product contracts', () => {
  it('wires Gemini 2.0 Flash (not Anthropic) in the Worker', () => {
    const index = read('src/index.ts');
    expect(index).toContain('gemini-2.0-flash');
    expect(index).toContain('generativelanguage.googleapis.com');
    expect(index).toContain('GEMINI_API_KEY');
    expect(index).not.toMatch(/anthropic|claude|haiku/i);
  });

  it('fetches iptv-org category M3Us from the documented CDN base', () => {
    const index = read('src/index.ts');
    expect(index).toContain('https://iptv-org.github.io/iptv/categories');
    expect(index).toMatch(/expirationTtl:\s*3600/);
  });

  it('keeps Env bindings aligned with wrangler.toml', () => {
    const types = read('src/types.ts');
    expect(types).toContain('CATALOG_CACHE: KVNamespace');
    // Optional at runtime — /curate returns 503 when GEMINI_API_KEY is unset (#8)
    expect(types).toMatch(/GEMINI_API_KEY\?:\s*string/);
    expect(types).toMatch(/VERSION\?:\s*string/);
  });

  it('documents Gemini secret + HITL deploy constraints', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/wrangler secret put GEMINI_API_KEY/);
    expect(deploy).toMatch(/HITL/i);
    expect(deploy).not.toMatch(/ANTHROPIC_API_KEY/);
  });
});
