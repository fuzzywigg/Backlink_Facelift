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

  it('declares exactly one [[routes]] custom domain block', () => {
    const routeBlocks = toml.match(/\[\[routes\]\]/g) ?? [];
    expect(routeBlocks).toHaveLength(1);
    expect(toml).toMatch(/custom_domain\s*=\s*true/);
  });

  it('keeps vars section limited to VERSION', () => {
    const varsSection = toml.split('[vars]')[1] ?? '';
    const assignments = [...varsSection.matchAll(/^\s*([A-Z_]+)\s*=/gm)].map((m) => m[1]);
    expect(assignments).toEqual(['VERSION']);
  });

  it('does not embed the live worker hostname in comments with credentials', () => {
    expect(toml).toContain('backlink.fuzzywigg.com');
    expect(toml).not.toMatch(/Authorization|Bearer|CF_API_TOKEN/i);
  });

  it('uses a 32-char hex KV namespace id', () => {
    const id = toml.match(/id\s*=\s*"([a-f0-9]+)"/)?.[1];
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });

  it('keeps main entry as a relative src path (not absolute)', () => {
    expect(toml).toMatch(/main\s*=\s*"src\/index\.ts"/);
    expect(toml).not.toMatch(/main\s*=\s*"\//);
  });

  it('does not declare secrets via [vars] or [secrets] tables', () => {
    expect(toml).not.toMatch(/\[secrets\]/i);
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=\s*"/);
  });

  it('keeps exactly one [[kv_namespaces]] block', () => {
    expect(toml.match(/\[\[kv_namespaces\]\]/g)).toHaveLength(1);
  });

  it('does not enable nodejs_compat or other compatibility flags', () => {
    expect(toml).not.toMatch(/compatibility_flags/);
    expect(toml).not.toMatch(/nodejs_compat/);
  });

  it('documents GEMINI secret put without embedding placeholder key material', () => {
    expect(toml).toMatch(/#\s*wrangler secret put GEMINI_API_KEY/);
    expect(toml).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });

  it('keeps custom_domain true for the fuzzywigg route only', () => {
    const routeSection = toml.split('[[routes]]')[1] ?? '';
    expect(routeSection).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(routeSection).toMatch(/custom_domain\s*=\s*true/);
    expect(routeSection).not.toMatch(/pattern\s*=\s*"\*"/);
  });

  it('does not declare [env.*] environment overrides', () => {
    expect(toml).not.toMatch(/\[env\./);
  });

  it('keeps top-level keys limited to known Worker config', () => {
    expect(toml).toMatch(/name\s*=/);
    expect(toml).toMatch(/main\s*=/);
    expect(toml).toMatch(/compatibility_date\s*=/);
    expect(toml).not.toMatch(/account_id\s*=/);
    expect(toml).not.toMatch(/api_token\s*=/i);
  });

  it('documents GEMINI via comment without Anthropic leftovers', () => {
    expect(toml).toMatch(/GEMINI_API_KEY/);
    expect(toml).not.toMatch(/ANTHROPIC|Claude|anthropic/i);
  });

  it('keeps KV id as lowercase hex only', () => {
    const id = toml.match(/id\s*=\s*"([a-f0-9]+)"/)?.[1] ?? '';
    expect(id).toBe(id.toLowerCase());
    expect(id).not.toMatch(/[A-F]/);
  });

  it('does not enable logpush or observability blocks', () => {
    expect(toml).not.toMatch(/logpush/i);
    expect(toml).not.toMatch(/\[observability\]/i);
  });

  it('keeps routes pattern host-only without path wildcards beyond the domain', () => {
    expect(toml).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(toml).not.toMatch(/pattern\s*=\s*"\*backlink/);
  });

  it('does not embed npm tokens or private registry URLs', () => {
    expect(toml).not.toMatch(/npm[_-]?token|registry\.npmjs|\/\/npm\./i);
  });

  it('keeps worker name as a single backlink token (no spaces)', () => {
    expect(toml).toMatch(/^\s*name\s*=\s*"backlink"\s*$/m);
  });

  it('places [[kv_namespaces]] before [[routes]]', () => {
    expect(toml.indexOf('[[kv_namespaces]]')).toBeLessThan(toml.indexOf('[[routes]]'));
  });

  it('places [vars] after routes', () => {
    expect(toml.indexOf('[[routes]]')).toBeLessThan(toml.indexOf('[vars]'));
  });

  it('does not declare minify or build upload rules', () => {
    expect(toml).not.toMatch(/\[build\]/i);
    expect(toml).not.toMatch(/minify\s*=/);
    expect(toml).not.toMatch(/\[site\]/);
  });

  it('keeps VERSION var quoted as 0.1.0', () => {
    expect(toml).toMatch(/VERSION\s*=\s*"0\.1\.0"/);
    expect(toml).not.toMatch(/VERSION\s*=\s*0\.1\.0\b/);
  });

  it('documents secrets via CLI comment only once', () => {
    const matches = toml.match(/wrangler secret put GEMINI_API_KEY/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('does not set workers_dev explicitly to false or true', () => {
    expect(toml).not.toMatch(/workers_dev\s*=/);
  });

  it('keeps custom domain pattern without scheme or path', () => {
    expect(toml).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(toml).not.toMatch(/pattern\s*=\s*"https?:\/\//);
  });

  it('does not declare preview_urls or routes zone_name', () => {
    expect(toml).not.toMatch(/preview_urls/i);
    expect(toml).not.toMatch(/zone_name\s*=/);
  });
  it('locks compatibility_date exactly to 2025-01-01', () => {
    expect(toml).toMatch(/compatibility_date\s*=\s*"2025-01-01"/);
  });

  it('locks CATALOG_CACHE KV id exactly', () => {
    expect(toml).toMatch(/id\s*=\s*"edb6ca4df12f4f45b40508b3dda3c432"/);
  });

  it('locks custom domain pattern exactly to backlink.fuzzywigg.com', () => {
    expect(toml).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(toml).toMatch(/custom_domain\s*=\s*true/);
  });

  it('does not declare queues, services, or tail_consumers', () => {
    expect(toml).not.toMatch(/\[\[queues/i);
    expect(toml).not.toMatch(/\[\[services/i);
    expect(toml).not.toMatch(/tail_consumers/i);
    expect(toml).not.toMatch(/\[triggers\]/i);
  });

  it('keeps main entry exact quoted src/index.ts', () => {
    expect(toml).toMatch(/^\s*main\s*=\s*"src\/index\.ts"\s*$/m);
  });

  it('does not declare account_id or api_token fields', () => {
    expect(toml).not.toMatch(/account_id\s*=/);
    expect(toml).not.toMatch(/api_token\s*=/);
  });

  it('keeps [vars] limited to VERSION only', () => {
    const varsSection = toml.split('[vars]')[1] ?? '';
    const nextSection = varsSection.search(/\n\[/);
    const body = nextSection === -1 ? varsSection : varsSection.slice(0, nextSection);
    const assignments = [...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]);
    expect(assignments).toEqual(['VERSION']);
  });

  it('documents secrets via CLI comment exactly once', () => {
    expect((toml.match(/wrangler secret put GEMINI_API_KEY/g) ?? []).length).toBe(1);
  });

  it('keeps exactly one [[kv_namespaces]] and one [[routes]] table', () => {
    expect((toml.match(/\[\[kv_namespaces\]\]/g) ?? []).length).toBe(1);
    expect((toml.match(/\[\[routes\]\]/g) ?? []).length).toBe(1);
    expect((toml.match(/^\[vars\]/gm) ?? []).length).toBe(1);
  });

  it('binds CATALOG_CACHE exactly once', () => {
    expect((toml.match(/binding\s*=\s*"CATALOG_CACHE"/g) ?? []).length).toBe(1);
  });

  it('does not declare durable_objects or r2_buckets', () => {
    expect(toml).not.toMatch(/durable_objects/i);
    expect(toml).not.toMatch(/r2_buckets/i);
    expect(toml).not.toMatch(/d1_databases/i);
  });

  it('keeps custom_domain true without zone_id', () => {
    expect(toml).toMatch(/custom_domain\s*=\s*true/);
    expect(toml).not.toMatch(/zone_id\s*=/);
  });

  it('does not embed GEMINI_API_KEY as a [vars] assignment', () => {
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
  });

  it('does not declare placement, limits, or migrations tables', () => {
    expect(toml).not.toMatch(/\[placement\]/i);
    expect(toml).not.toMatch(/\[limits\]/i);
    expect(toml).not.toMatch(/\[\[migrations\]\]/i);
    expect(toml).not.toMatch(/new_classes/i);
  });

  it('does not declare crons or scheduled handlers', () => {
    expect(toml).not.toMatch(/crons\s*=/);
    expect(toml).not.toMatch(/\[triggers\]/i);
    expect(toml).not.toMatch(/scheduled/i);
  });

  it('does not declare vectorize, ai, or browser bindings', () => {
    expect(toml).not.toMatch(/vectorize/i);
    expect(toml).not.toMatch(/\[ai\]/i);
    expect(toml).not.toMatch(/browser/i);
  });

  it('keeps top-level name before main before compatibility_date', () => {
    const nameIdx = toml.indexOf('name = "backlink"');
    const mainIdx = toml.indexOf('main = "src/index.ts"');
    const compatIdx = toml.indexOf('compatibility_date = "2025-01-01"');
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(mainIdx).toBeGreaterThan(nameIdx);
    expect(compatIdx).toBeGreaterThan(mainIdx);
  });

  it('does not set workers_dev or preview_urls', () => {
    expect(toml).not.toMatch(/workers_dev\s*=/);
    expect(toml).not.toMatch(/preview_urls\s*=/);
  });

  it('keeps secret comment block immediately after [vars]', () => {
    const afterVars = toml.slice(toml.indexOf('[vars]'));
    expect(afterVars).toMatch(/\[vars\]\s*\nVERSION = "0\.1\.0"\s*\n\n# Secrets/);
  });

  it('does not declare [triggers], workflows, or queue producers', () => {
    expect(toml).not.toMatch(/\[triggers\]/i);
    expect(toml).not.toMatch(/workflows/i);
    expect(toml).not.toMatch(/queue/i);
  });

  it('documents wrangler secret put GEMINI_API_KEY comment exactly', () => {
    expect(toml).toMatch(/# wrangler secret put GEMINI_API_KEY/);
  });

  it('does not declare singular route= key', () => {
    expect(toml).not.toMatch(/^route\s*=/m);
  });

  it('keeps kv_namespaces object keys exactly binding + id', () => {
    const kv = toml.slice(toml.indexOf('[[kv_namespaces]]'), toml.indexOf('[[routes]]'));
    const keys = [...kv.matchAll(/^\s*([a-z_]+)\s*=/gm)].map((m) => m[1]);
    expect(keys).toEqual(['binding', 'id']);
  });

  it('keeps routes object keys exactly pattern + custom_domain', () => {
    const routes = toml.slice(toml.indexOf('[[routes]]'), toml.indexOf('[vars]'));
    const keys = [...routes.matchAll(/^\s*([a-z_]+)\s*=/gm)].map((m) => m[1]);
    expect(keys).toEqual(['pattern', 'custom_domain']);
  });

  it('keeps VERSION equal to package.json version', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(toml).toMatch(new RegExp(`VERSION\\s*=\\s*"${pkg.version}"`));
  });

  it('does not declare a [dev] table', () => {
    expect(toml).not.toMatch(/\[dev\]/);
  });

  it('does not declare preview_id on the KV namespace', () => {
    expect(toml).not.toMatch(/preview_id\s*=/);
  });

  it('locks exact Secrets header comment after [vars]', () => {
    expect(toml).toContain('# Secrets (set via CLI, never commit):');
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
  });

  it('locks TOML table header set to kv_namespaces, routes, and vars only', () => {
    const headers = [...toml.matchAll(/^\[+([^\]]+)\]+/gm)].map((m) => m[1]);
    expect(headers).toEqual(['kv_namespaces', 'routes', 'vars']);
  });

  it('locks exact wrangler.toml top-level name/main/compatibility_date block', () => {
    expect(toml).toMatch(
      /^name = "backlink"\nmain = "src\/index\.ts"\ncompatibility_date = "2025-01-01"\n/m,
    );
  });

  it('does not declare node_compat, compatibility_flags, or minify', () => {
    expect(toml).not.toMatch(/node_compat\s*=/);
    expect(toml).not.toMatch(/compatibility_flags\s*=/);
    expect(toml).not.toMatch(/minify\s*=/);
  });

  it('does not declare env-specific tables like env.production', () => {
    expect(toml).not.toMatch(/\[env\./);
    expect(toml).not.toMatch(/\[\[env\./);
  });

  it('keeps custom_domain as bare true boolean (not quoted string)', () => {
    expect(toml).toMatch(/custom_domain\s*=\s*true\b/);
    expect(toml).not.toMatch(/custom_domain\s*=\s*"true"/);
  });

  it('locks CATALOG_CACHE binding spelling and KV id hex length 32', () => {
    expect(toml).toMatch(/binding\s*=\s*"CATALOG_CACHE"/);
    const id = toml.match(/id\s*=\s*"([a-f0-9]+)"/)?.[1];
    expect(id).toHaveLength(32);
    expect(id).toBe('edb6ca4df12f4f45b40508b3dda3c432');
  });

  it('does not embed plaintext secret assignments of any kind', () => {
    expect(toml).not.toMatch(/^\s*[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|KEY)\s*=\s*"[^"]+"/im);
  });

  it('keeps file free of trailing spaces on non-empty lines', () => {
    for (const line of toml.split('\n')) {
      if (line.length > 0) expect(line).not.toMatch(/\s$/);
    }
  });

  it('locks exact wrangler.toml file contents snapshot', () => {
    expect(toml).toBe(`name = "backlink"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "CATALOG_CACHE"
id = "edb6ca4df12f4f45b40508b3dda3c432"

[[routes]]
pattern = "backlink.fuzzywigg.com"
custom_domain = true

[vars]
VERSION = "0.1.0"

# Secrets (set via CLI, never commit):
# wrangler secret put GEMINI_API_KEY
`);
  });

  it('uses only LF newlines (no CR)', () => {
    expect(toml.includes('\r')).toBe(false);
  });

  it('contains no tab characters', () => {
    expect(toml.includes('\t')).toBe(false);
  });

  it('is ASCII-only (no non-ASCII bytes in Worker config)', () => {
    expect([...toml].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });

  it('declares exactly one [[kv_namespaces]] and one [[routes]] table', () => {
    expect((toml.match(/\[\[kv_namespaces\]\]/g) ?? []).length).toBe(1);
    expect((toml.match(/\[\[routes\]\]/g) ?? []).length).toBe(1);
    expect((toml.match(/^\[vars\]/gm) ?? []).length).toBe(1);
  });

  it('orders tables as kv_namespaces → routes → vars', () => {
    const kv = toml.indexOf('[[kv_namespaces]]');
    const routes = toml.indexOf('[[routes]]');
    const vars = toml.indexOf('[vars]');
    expect(kv).toBeGreaterThan(-1);
    expect(routes).toBeGreaterThan(kv);
    expect(vars).toBeGreaterThan(routes);
  });

  it('keeps blank line between top-level keys and first table', () => {
    expect(toml).toMatch(
      /compatibility_date = "2025-01-01"\n\n\[\[kv_namespaces\]\]/,
    );
  });

  it('keeps blank line between kv_namespaces and routes tables', () => {
    expect(toml).toMatch(/id = "edb6ca4df12f4f45b40508b3dda3c432"\n\n\[\[routes\]\]/);
  });

  it('keeps blank line between routes and vars tables', () => {
    expect(toml).toMatch(/custom_domain = true\n\n\[vars\]/);
  });

  it('does not declare account_id, api_token, or oauth tokens', () => {
    expect(toml).not.toMatch(/account_id\s*=/i);
    expect(toml).not.toMatch(/api_token\s*=/i);
    expect(toml).not.toMatch(/oauth/i);
  });

  it('does not declare durable_objects, r2_buckets, or services bindings', () => {
    expect(toml).not.toMatch(/durable_objects/i);
    expect(toml).not.toMatch(/r2_buckets/i);
    expect(toml).not.toMatch(/\[\[services\]\]/i);
  });

  it('does not declare analytics_engine or send_email bindings', () => {
    expect(toml).not.toMatch(/analytics_engine/i);
    expect(toml).not.toMatch(/send_email/i);
  });

  it('does not declare hyperdrive, mtls, or pipelines', () => {
    expect(toml).not.toMatch(/hyperdrive/i);
    expect(toml).not.toMatch(/mtls/i);
    expect(toml).not.toMatch(/pipelines/i);
  });

  it('pattern host is backlink.fuzzywigg.com without scheme or path', () => {
    expect(toml).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(toml).not.toMatch(/pattern\s*=\s*"https?:/);
    expect(toml).not.toMatch(/pattern\s*=\s*".*\//);
  });

  it('keeps only VERSION under [vars] (single assignment)', () => {
    const varsBlock = toml.slice(toml.indexOf('[vars]'));
    const assigns = [...varsBlock.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);
    expect(assigns).toEqual(['VERSION']);
  });

  it('comment lines are only the two Secrets documentation lines', () => {
    const comments = toml.split('\n').filter((l) => l.trimStart().startsWith('#'));
    expect(comments).toEqual([
      '# Secrets (set via CLI, never commit):',
      '# wrangler secret put GEMINI_API_KEY',
    ]);
  });

  it('ends with a trailing newline after the secret put comment', () => {
    expect(toml.endsWith('GEMINI_API_KEY\n')).toBe(true);
  });

  it('does not use single-quoted TOML strings for binding/id/pattern/VERSION', () => {
    expect(toml).not.toMatch(/binding\s*=\s'/);
    expect(toml).not.toMatch(/id\s*=\s'/);
    expect(toml).not.toMatch(/pattern\s*=\s'/);
    expect(toml).not.toMatch(/VERSION\s*=\s'/);
  });

  it('keeps name/main/compatibility_date as double-quoted strings', () => {
    expect(toml).toMatch(/^name = "backlink"$/m);
    expect(toml).toMatch(/^main = "src\/index\.ts"$/m);
    expect(toml).toMatch(/^compatibility_date = "2025-01-01"$/m);
  });

  it('does not declare logpush, tail_consumers, or observability', () => {
    expect(toml).not.toMatch(/logpush/i);
    expect(toml).not.toMatch(/tail_consumers/i);
    expect(toml).not.toMatch(/observability/i);
  });

  it('does not declare wasm_modules or text_blobs', () => {
    expect(toml).not.toMatch(/wasm_modules/i);
    expect(toml).not.toMatch(/text_blobs/i);
  });

  it('line count is stable at 18 split entries including trailing blank', () => {
    // 17 content lines + trailing newline → split length 18
    expect(toml.split('\n')).toHaveLength(18);
    expect(toml.endsWith('\n')).toBe(true);
  });

  it('KV id is lowercase hex only (no uppercase)', () => {
    const id = toml.match(/id\s*=\s*"([a-f0-9]+)"/)?.[1];
    expect(id).toBeDefined();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(id).not.toMatch(/[A-F]/);
  });

  it('does not set keep_vars or define secrets via toml', () => {
    expect(toml).not.toMatch(/keep_vars\s*=/);
    expect(toml).not.toMatch(/\[secrets\]/i);
    expect(toml).not.toMatch(/\[\[secrets\]\]/i);
  });

  it('main path is relative src/index.ts without leading ./', () => {
    expect(toml).toMatch(/main = "src\/index\.ts"/);
    expect(toml).not.toMatch(/main = "\.\/src\/index\.ts"/);
  });

  it('does not declare rules, build, or site upload config', () => {
    expect(toml).not.toMatch(/\[\[rules\]\]/);
    expect(toml).not.toMatch(/\[build\]/);
    expect(toml).not.toMatch(/\[site\]/);
  });

  it('custom_domain appears exactly once', () => {
    expect((toml.match(/custom_domain/g) ?? []).length).toBe(1);
  });

  it('CATALOG_CACHE binding appears exactly once', () => {
    expect((toml.match(/CATALOG_CACHE/g) ?? []).length).toBe(1);
  });

  it('does not declare node_compat or compatibility_flags', () => {
    expect(toml).not.toMatch(/node_compat/i);
    expect(toml).not.toMatch(/compatibility_flags/i);
  });

  it('does not declare minify, no_bundle, or tsconfig overrides', () => {
    expect(toml).not.toMatch(/^\s*minify\s*=/m);
    expect(toml).not.toMatch(/no_bundle/i);
    expect(toml).not.toMatch(/^\s*tsconfig\s*=/m);
  });

  it('KV namespace id matches the known production hex lock', () => {
    expect(toml).toMatch(/id\s*=\s*"edb6ca4df12f4f45b40508b3dda3c432"/);
  });

  it('section order is kv_namespaces then routes then vars', () => {
    const kv = toml.indexOf('[[kv_namespaces]]');
    const routes = toml.indexOf('[[routes]]');
    const vars = toml.indexOf('[vars]');
    expect(kv).toBeGreaterThan(-1);
    expect(routes).toBeGreaterThan(kv);
    expect(vars).toBeGreaterThan(routes);
  });

  it('top-level keys appear before first table header', () => {
    const firstTable = Math.min(
      toml.indexOf('[[kv_namespaces]]'),
      toml.indexOf('[[routes]]'),
      toml.indexOf('[vars]'),
    );
    const head = toml.slice(0, firstTable);
    expect(head).toMatch(/name\s*=/);
    expect(head).toMatch(/main\s*=/);
    expect(head).toMatch(/compatibility_date\s*=/);
  });

  it('does not declare workers_dev true/false explicitly', () => {
    expect(toml).not.toMatch(/workers_dev\s*=/);
  });

  it('secret put comment names GEMINI_API_KEY exactly once', () => {
    expect((toml.match(/GEMINI_API_KEY/g) ?? []).length).toBe(1);
    expect(toml).toContain('wrangler secret put GEMINI_API_KEY');
  });

  it('does not embed Cloudflare account or zone identifiers', () => {
    expect(toml).not.toMatch(/zone_id\s*=/i);
    expect(toml).not.toMatch(/account_id\s*=/i);
    expect(toml).not.toMatch(/route_id\s*=/i);
  });

  it('locks exact top-level key order: name, main, compatibility_date', () => {
    // first three assignment lines before tables
    const head = toml.split('\n').slice(0, 3);
    expect(head[0]).toBe('name = "backlink"');
    expect(head[1]).toBe('main = "src/index.ts"');
    expect(head[2]).toBe('compatibility_date = "2025-01-01"');
  });

  it('locks kv_namespaces block to binding then id lines', () => {
    const block = toml.split('[[kv_namespaces]]')[1].split('[[routes]]')[0];
    const assignments = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('='));
    expect(assignments).toEqual([
      'binding = "CATALOG_CACHE"',
      'id = "edb6ca4df12f4f45b40508b3dda3c432"',
    ]);
  });

  it('locks routes block to pattern then custom_domain lines', () => {
    const block = toml.split('[[routes]]')[1].split('[vars]')[0];
    const assignments = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('='));
    expect(assignments).toEqual([
      'pattern = "backlink.fuzzywigg.com"',
      'custom_domain = true',
    ]);
  });

  it('locks [vars] VERSION to package-aligned 0.1.0 string', () => {
    expect(toml).toMatch(/^VERSION = "0\.1\.0"$/m);
  });

  it('keeps Secrets documentation comments immediately after [vars]', () => {
    const afterVars = toml.split('[vars]')[1];
    expect(afterVars).toMatch(/VERSION = "0\.1\.0"\n\n# Secrets/);
    expect(afterVars).toContain('# Secrets (set via CLI, never commit):');
    expect(afterVars).toContain('# wrangler secret put GEMINI_API_KEY');
  });

  it('does not declare preview_urls, routes zone_name, or script_name', () => {
    expect(toml).not.toMatch(/preview_urls/i);
    expect(toml).not.toMatch(/zone_name/i);
    expect(toml).not.toMatch(/script_name/i);
  });

  it('does not declare placement, limits, or migrations tables', () => {
    expect(toml).not.toMatch(/\[placement\]/i);
    expect(toml).not.toMatch(/\[limits\]/i);
    expect(toml).not.toMatch(/\[\[migrations\]\]/i);
  });

  it('does not declare queues, vectorize, or browser bindings', () => {
    expect(toml).not.toMatch(/queues/i);
    expect(toml).not.toMatch(/vectorize/i);
    expect(toml).not.toMatch(/browser/i);
  });

  it('does not declare unsafe, find_additional_modules, or base_dir', () => {
    expect(toml).not.toMatch(/\[unsafe\]/i);
    expect(toml).not.toMatch(/find_additional_modules/i);
    expect(toml).not.toMatch(/base_dir\s*=/);
  });

  it('custom_domain is boolean true not a string', () => {
    expect(toml).toMatch(/custom_domain\s*=\s*true\b/);
    expect(toml).not.toMatch(/custom_domain\s*=\s*"true"/);
  });

  it('pattern does not include https:// or trailing slash', () => {
    expect(toml).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(toml).not.toMatch(/pattern\s*=\s*"https?:\/\//);
    expect(toml).not.toMatch(/pattern\s*=\s*".*\/"/);
  });

  it('worker name is lowercase backlink without org prefix', () => {
    expect(toml).toMatch(/^name = "backlink"$/m);
    expect(toml).not.toMatch(/name = "fuzzywigg/);
  });

  it('main entry points at TypeScript source not a built dist bundle', () => {
    expect(toml).toMatch(/main = "src\/index\.ts"/);
    expect(toml).not.toMatch(/main = "dist\//);
    expect(toml).not.toMatch(/main = "\.wrangler\//);
  });

  it('compatibility_date is first day of 2025 not a relative token', () => {
    expect(toml).toMatch(/compatibility_date = "2025-01-01"/);
    expect(toml).not.toMatch(/compatibility_date = "today"/);
  });

  it('does not declare vars assignments for GEMINI_API_KEY or CF tokens', () => {
    const vars = toml.split('[vars]')[1] ?? '';
    const assignments = vars
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='));
    expect(assignments).toEqual(['VERSION = "0.1.0"']);
    expect(assignments.join('\n')).not.toMatch(/GEMINI|CF_API|TOKEN/);
  });

  it('KV binding name uses SCREAMING_SNAKE CATALOG_CACHE', () => {
    expect(toml).toMatch(/binding = "CATALOG_CACHE"/);
    expect(toml).not.toMatch(/binding = "catalog_cache"/);
    expect(toml).not.toMatch(/binding = "CatalogCache"/);
  });

  it('file has no trailing whitespace on any line', () => {
    for (const line of toml.split('\n')) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('file uses spaces not mixed indentation for assignments', () => {
    const assignLines = toml.split('\n').filter((l) => /^\s+\S/.test(l));
    for (const line of assignLines) {
      expect(line.startsWith(' ')).toBe(true);
      expect(line.startsWith('\t')).toBe(false);
    }
  });

  it('does not declare [[durable_objects.bindings]] or [[r2_buckets]]', () => {
    expect(toml).not.toMatch(/durable_objects\.bindings/i);
    expect(toml).not.toMatch(/\[\[r2_buckets\]\]/i);
  });

  it('does not declare send_email, analytics_engine_datasets, or hyperdrive', () => {
    expect(toml).not.toMatch(/send_email/i);
    expect(toml).not.toMatch(/analytics_engine/i);
    expect(toml).not.toMatch(/hyperdrive/i);
  });

  it('Secrets comment uses never commit wording', () => {
    expect(toml).toContain('never commit');
  });

  it('does not set upload_source_maps or jsx flags', () => {
    expect(toml).not.toMatch(/upload_source_maps/i);
    expect(toml).not.toMatch(/jsx_factory|jsx_fragment/i);
  });

  it('route pattern host ends with fuzzywigg.com', () => {
    const pattern = toml.match(/pattern\s*=\s*"([^"]+)"/)?.[1];
    expect(pattern).toBe('backlink.fuzzywigg.com');
    expect(pattern?.endsWith('fuzzywigg.com')).toBe(true);
  });

  it('contains exactly three table headers (kv, routes, vars)', () => {
    const headers = [...toml.matchAll(/^\[+[^\]]+\]+$/gm)].map((m) => m[0]);
    expect(headers).toEqual(['[[kv_namespaces]]', '[[routes]]', '[vars]']);
  });

  it('does not declare [dev] local port overrides', () => {
    expect(toml).not.toMatch(/^\s*\[dev\]/m);
    expect(toml).not.toMatch(/ip_address|local_protocol/i);
  });

});
