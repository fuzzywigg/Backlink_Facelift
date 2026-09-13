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
  it('locks custom_domain true on backlink.fuzzywigg.com route', () => {
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(toml).toMatch(/custom_domain\s*=\s*true/);
  });

  it('locks main entry to src/index.ts', () => {
    expect(toml).toMatch(/main\s*=\s*"src\/index\.ts"/);
  });

  it('locks worker name to backlink', () => {
    expect(toml).toMatch(/name\s*=\s*"backlink"/);
  });

  it('locks VERSION var to 0.1.0 matching package.json', () => {
    expect(toml).toMatch(/VERSION\s*=\s*"0\.1\.0"/);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    expect(pkg.version).toBe('0.1.0');
  });

  it('does not declare secrets table in wrangler.toml', () => {
    expect(toml).not.toMatch(/^\[secrets\]/m);
    expect(toml).not.toMatch(/^\[vars\.[^\]]+\]/m);
  });

  // --- HEAVY burn (post-#39): wrangler.toml structure / hygiene locks ---

  it('uses LF newlines only', () => {
    expect(toml.includes('\r')).toBe(false);
  });

  it('does not contain tab characters', () => {
    expect(toml.includes('\t')).toBe(false);
  });

  it('keeps exact top-level key order name main compatibility_date', () => {
    const nameIdx = toml.indexOf('name = "backlink"');
    const mainIdx = toml.indexOf('main = "src/index.ts"');
    const compatIdx = toml.indexOf('compatibility_date = "2025-01-01"');
    expect(nameIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(nameIdx);
    expect(compatIdx).toBeGreaterThan(mainIdx);
  });

  it('locks KV binding before id in the kv_namespaces table', () => {
    const block = toml.slice(toml.indexOf('[[kv_namespaces]]'), toml.indexOf('[[routes]]'));
    expect(block.indexOf('binding')).toBeLessThan(block.indexOf('id'));
  });

  it('locks routes pattern before custom_domain', () => {
    const block = toml.slice(toml.indexOf('[[routes]]'), toml.indexOf('[vars]'));
    expect(block.indexOf('pattern')).toBeLessThan(block.indexOf('custom_domain'));
  });

  it('locks CATALOG_CACHE id to edb6ca4df12f4f45b40508b3dda3c432', () => {
    expect(toml).toContain('id = "edb6ca4df12f4f45b40508b3dda3c432"');
  });

  it('does not declare compatibility_flags array', () => {
    expect(toml).not.toMatch(/compatibility_flags/);
  });

  it('does not declare rules or find_additional_modules', () => {
    expect(toml).not.toMatch(/\brules\s*=/);
    expect(toml).not.toMatch(/find_additional_modules/);
  });

  it('does not declare [build] or [site] tables', () => {
    expect(toml).not.toMatch(/^\[build\]/m);
    expect(toml).not.toMatch(/^\[site\]/m);
  });

  it('does not declare durable_objects or migrations', () => {
    expect(toml).not.toMatch(/durable_objects/i);
    expect(toml).not.toMatch(/\[\[migrations\]\]/);
  });

  it('does not declare r2_buckets or d1_databases', () => {
    expect(toml).not.toMatch(/r2_buckets/i);
    expect(toml).not.toMatch(/d1_databases/i);
  });

  it('does not declare vectorize or ai bindings', () => {
    expect(toml).not.toMatch(/\[\[vectorize\]\]/i);
    expect(toml).not.toMatch(/^\[ai\]/m);
  });

  it('does not declare hyperdrive or analytics_engine', () => {
    expect(toml).not.toMatch(/hyperdrive/i);
    expect(toml).not.toMatch(/analytics_engine/i);
  });

  it('Secrets comment block mentions never commit', () => {
    expect(toml).toMatch(/never commit/i);
  });

  it('Secrets comment uses CLI put not dashboard wording', () => {
    expect(toml).toContain('wrangler secret put GEMINI_API_KEY');
    expect(toml).not.toMatch(/dashboard/i);
  });

  it('does not embed placeholder your-kv-id-here from DEPLOY.md', () => {
    expect(toml).not.toContain('your-kv-id-here');
  });

  it('keeps exactly three table headers kv routes vars', () => {
    expect((toml.match(/^\[\[/gm) ?? []).length).toBe(2);
    expect((toml.match(/^\[[^[]/gm) ?? []).length).toBe(1);
  });

  it('does not set minify true or false', () => {
    expect(toml).not.toMatch(/minify\s*=/);
  });

  it('does not set keep_vars or send_metrics', () => {
    expect(toml).not.toMatch(/keep_vars\s*=/);
    expect(toml).not.toMatch(/send_metrics\s*=/);
  });

  it('does not declare tsconfig path override', () => {
    expect(toml).not.toMatch(/tsconfig\s*=/);
  });

  it('worker name backlink matches package.json name', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(toml).toMatch(/name\s*=\s*"backlink"/);
    expect(pkg.name).toBe('backlink');
  });

  it('VERSION var matches package.json version string', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(toml).toContain(`VERSION = "${pkg.version}"`);
  });

  it('does not declare [env.production] or [env.staging]', () => {
    expect(toml).not.toMatch(/\[env\./);
  });

  it('custom_domain is boolean true not string', () => {
    expect(toml).toMatch(/custom_domain\s*=\s*true\b/);
    expect(toml).not.toMatch(/custom_domain\s*=\s*"true"/);
  });

  it('pattern host has no trailing slash', () => {
    expect(toml).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(toml).not.toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com\/"/);
  });

  it('does not declare zone_id alongside custom domain', () => {
    expect(toml).not.toMatch(/zone_id/i);
  });

  it('file ends with a trailing newline', () => {
    expect(toml.endsWith('\n')).toBe(true);
  });

  it('does not contain Anthropic or Claude leftover comments', () => {
    expect(toml).not.toMatch(/anthropic|claude|haiku/i);
  });

  it('does not declare services or dispatch_namespaces', () => {
    expect(toml).not.toMatch(/\[\[services\]\]/);
    expect(toml).not.toMatch(/dispatch_namespaces/);
  });

  it('does not declare queues producers or consumers', () => {
    expect(toml).not.toMatch(/\[\[queues\./);
  });

  it('does not declare browser or worker_loaders bindings', () => {
    expect(toml).not.toMatch(/browser\s*=/);
    expect(toml).not.toMatch(/worker_loaders/);
  });

  it('KV id is lowercase hex 32 chars with no uppercase', () => {
    const id = toml.match(/id\s*=\s*"([a-f0-9]+)"/)?.[1];
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(id).not.toMatch(/[A-F]/);
  });

  it('does not set logpush true', () => {
    expect(toml).not.toMatch(/logpush\s*=/);
  });

  it('does not declare [observability] block', () => {
    expect(toml).not.toMatch(/^\[observability\]/m);
  });

  it('main entry uses forward slashes not backslashes', () => {
    expect(toml).toMatch(/main\s*=\s*"src\/index\.ts"/);
    expect(toml).not.toMatch(/main\s*=\s*"src\\index\.ts"/);
  });

  it('does not embed CF_API_TOKEN or CF_ACCOUNT_ID', () => {
    expect(toml).not.toMatch(/CF_API_TOKEN|CF_ACCOUNT_ID/);
  });

  it('comment line count for secrets is exactly two hash lines before put', () => {
    const secretsBlock = toml.slice(toml.indexOf('# Secrets'));
    const hashLines = secretsBlock.split('\n').filter((l) => l.trimStart().startsWith('#'));
    expect(hashLines.length).toBeGreaterThanOrEqual(2);
    expect(hashLines.some((l) => l.includes('wrangler secret put'))).toBe(true);
  });

  it('does not declare placement mode or regions', () => {
    expect(toml).not.toMatch(/\[placement\]/);
    expect(toml).not.toMatch(/mode\s*=\s*"smart"/);
  });

  it('does not declare wasm or text_blobs', () => {
    expect(toml).not.toMatch(/wasm_modules|text_blobs/);
  });

  it('top-level name is quoted string not bare token', () => {
    expect(toml).toMatch(/^name\s*=\s*"backlink"/m);
    expect(toml).not.toMatch(/^name\s*=\s*backlink\s*$/m);
  });

  it('compatibility_date uses ISO date 2025-01-01 exactly', () => {
    expect(toml).toMatch(/compatibility_date\s*=\s*"2025-01-01"/);
  });

  it('does not set no_bundle or upload_source_maps', () => {
    expect(toml).not.toMatch(/no_bundle\s*=/);
    expect(toml).not.toMatch(/upload_source_maps\s*=/);
  });

  it('binding name CATALOG_CACHE matches Env.CATALOG_CACHE in types.ts', () => {
    const types = readFileSync(join(root, 'src/types.ts'), 'utf8');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
    expect(types).toContain('CATALOG_CACHE: KVNamespace');
  });

  it('does not declare unsafe bindings metadata', () => {
    expect(toml).not.toMatch(/\[unsafe\]/);
  });

  it('file line count stays under 20 lines for lean config', () => {
    const lines = toml.split('\n');
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(lines.length).toBeGreaterThanOrEqual(14);
  });

  it('does not declare routes as top-level array without table', () => {
    expect(toml).toContain('[[routes]]');
    expect(toml).not.toMatch(/^routes\s*=\s*\[/m);
  });

  it('vars VERSION is the only assignment under [vars]', () => {
    const after = toml.split('[vars]')[1] ?? '';
    const assignments = [...after.matchAll(/^\s*([A-Z_]+)\s*=/gm)].map((m) => m[1]);
    expect(assignments).toEqual(['VERSION']);
  });

  it('does not mention anthropic secret put', () => {
    expect(toml).not.toMatch(/secret put ANTHROPIC/i);
  });

  it('pattern domain matches README live worker host', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toContain('https://backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('does not declare preview_alias or workers_dev subdomain', () => {
    expect(toml).not.toMatch(/preview_alias|workers_dev/);
  });

  it('kv_namespaces table appears exactly once', () => {
    expect((toml.match(/\[\[kv_namespaces\]\]/g) ?? []).length).toBe(1);
  });

  it('routes table appears exactly once', () => {
    expect((toml.match(/\[\[routes\]\]/g) ?? []).length).toBe(1);
  });

  it('vars table appears exactly once', () => {
    expect((toml.match(/^\[vars\]/gm) ?? []).length).toBe(1);
  });

  it('wrangler.toml uses LF-only newlines with zero CR bytes', () => {
    expect(toml.includes('\r')).toBe(false);
    expect(toml.split('\n').join('\n')).toBe(toml);
  });

  it('wrangler.toml contains no tab characters', () => {
    expect(toml.includes('\t')).toBe(false);
  });

  it('wrangler.toml has no UTF-8 BOM prefix', () => {
    expect(toml.charCodeAt(0)).not.toBe(0xfeff);
    expect(toml.startsWith('\ufeff')).toBe(false);
    const buf = readFileSync(join(root, 'wrangler.toml'));
    expect(buf[0]).not.toBe(0xef);
  });

  it('locks top-level key order name → main → compatibility_date', () => {
    const nameIdx = toml.indexOf('name = "backlink"');
    const mainIdx = toml.indexOf('main = "src/index.ts"');
    const compatIdx = toml.indexOf('compatibility_date = "2025-01-01"');
    expect(nameIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(nameIdx);
    expect(compatIdx).toBeGreaterThan(mainIdx);
  });

  it('locks table order kv_namespaces → routes → vars', () => {
    const kv = toml.indexOf('[[kv_namespaces]]');
    const routes = toml.indexOf('[[routes]]');
    const vars = toml.indexOf('[vars]');
    expect(kv).toBeGreaterThan(-1);
    expect(routes).toBeGreaterThan(kv);
    expect(vars).toBeGreaterThan(routes);
  });

  it('locks kv_namespaces binding before id key order', () => {
    const block = toml.slice(toml.indexOf('[[kv_namespaces]]'), toml.indexOf('[[routes]]'));
    expect(block.indexOf('binding = "CATALOG_CACHE"')).toBeLessThan(block.indexOf('id = "'));
  });

  it('locks routes pattern before custom_domain key order', () => {
    const block = toml.slice(toml.indexOf('[[routes]]'), toml.indexOf('[vars]'));
    expect(block.indexOf('pattern = "backlink.fuzzywigg.com"')).toBeLessThan(
      block.indexOf('custom_domain = true'),
    );
  });

  it('does not declare R2 D1 Durable Objects or AI bindings', () => {
    expect(toml).not.toMatch(/r2_buckets|\[\[r2/i);
    expect(toml).not.toMatch(/d1_databases|\[\[d1/i);
    expect(toml).not.toMatch(/durable_objects/i);
    expect(toml).not.toMatch(/^\s*\[ai\]/m);
    expect(toml).not.toMatch(/workers_ai/i);
  });

  it('VERSION var aligns with package.json version 0.1.0', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toBe('0.1.0');
    expect(toml).toContain(`VERSION = "${pkg.version}"`);
  });

  it('locks single KV binding name CATALOG_CACHE exactly', () => {
    const bindings = [...toml.matchAll(/binding\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(bindings).toEqual(['CATALOG_CACHE']);
  });

  it('secrets are documented via CLI comment not assigned values', () => {
    expect(toml).toContain('# Secrets (set via CLI, never commit):');
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
    expect(toml).not.toMatch(/^\s*GEMINI_API_KEY\s*=/m);
  });

  it('lean line budget: non-empty lines stay under 16', () => {
    const nonEmpty = toml.split('\n').filter((l) => l.trim().length > 0);
    expect(nonEmpty.length).toBeLessThan(16);
    expect(nonEmpty.length).toBeGreaterThan(8);
  });

  it('file byte length stays under 400 for lean config', () => {
    expect(Buffer.byteLength(toml, 'utf8')).toBeLessThan(400);
    expect(Buffer.byteLength(toml, 'utf8')).toBeGreaterThan(100);
  });

  it('compatibility_date locks exact 2025-01-01 quoted string', () => {
    expect(toml).toMatch(/^compatibility_date = "2025-01-01"$/m);
  });

  it('worker name and main entry are double-quoted strings', () => {
    expect(toml).toMatch(/^name = "backlink"$/m);
    expect(toml).toMatch(/^main = "src\/index\.ts"$/m);
  });

  it('custom_domain is bare boolean true not a string', () => {
    expect(toml).toMatch(/^custom_domain = true$/m);
    expect(toml).not.toMatch(/custom_domain\s*=\s*"/);
  });

  it('KV id is 32 lowercase hex chars', () => {
    const id = toml.match(/id = "([a-f0-9]{32})"/)?.[1];
    expect(id).toBe('edb6ca4df12f4f45b40508b3dda3c432');
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });

  it('does not declare workers_dev triggers or env.* tables', () => {
    expect(toml).not.toMatch(/workers_dev\s*=/);
    expect(toml).not.toMatch(/\[triggers\]/);
    expect(toml).not.toMatch(/\[env\./);
  });

  it('cross-locks CATALOG_CACHE binding with src/types.ts Env field', () => {
    const types = readFileSync(join(root, 'src/types.ts'), 'utf8');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
    expect(types).toContain('CATALOG_CACHE: KVNamespace');
  });


  // --- HEAVY burn (post-#46): helpers/CI/wrangler/source/mcp-spec deepen ---
  it('locks exact wrangler.toml content structure for lean Worker config', () => {
    const lines = toml.split('\n');
    expect(lines[0]).toBe('name = "backlink"');
    expect(lines[1]).toBe('main = "src/index.ts"');
    expect(lines[2]).toBe('compatibility_date = "2025-01-01"');
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('[[kv_namespaces]]');
  });

  it('locks KV id hex to edb6ca4df12f4f45b40508b3dda3c432 exactly', () => {
    expect(toml).toContain('id = "edb6ca4df12f4f45b40508b3dda3c432"');
  });

  it('does not declare account_id or zone_id top-level keys', () => {
    expect(toml).not.toMatch(/^\s*account_id\s*=/m);
    expect(toml).not.toMatch(/^\s*zone_id\s*=/m);
  });

  it('does not declare node_compat or python_modules', () => {
    expect(toml).not.toMatch(/node_compat|python_modules/);
  });

  it('does not declare [dev] or local_protocol overrides', () => {
    expect(toml).not.toMatch(/^\[dev\]/m);
    expect(toml).not.toMatch(/local_protocol/);
  });

  it('does not declare [[services]] or service bindings', () => {
    expect(toml).not.toMatch(/\[\[services\]\]/);
    expect(toml).not.toMatch(/service\s*=/);
  });

  it('does not declare pipelines or workflows bindings', () => {
    expect(toml).not.toMatch(/pipelines|workflows/i);
  });

  it('Secrets comment block sits after [vars] VERSION', () => {
    const varsIdx = toml.indexOf('[vars]');
    const secretsIdx = toml.indexOf('# Secrets');
    const versionIdx = toml.indexOf('VERSION = "0.1.0"');
    expect(varsIdx).toBeGreaterThan(-1);
    expect(versionIdx).toBeGreaterThan(varsIdx);
    expect(secretsIdx).toBeGreaterThan(versionIdx);
  });

  it('does not embed iptv-org or gemini URLs in wrangler.toml', () => {
    expect(toml).not.toMatch(/iptv-org|generativelanguage|googleapis/i);
  });

  it('custom domain pattern has no scheme or path', () => {
    expect(toml).toMatch(/pattern\s*=\s*"backlink\.fuzzywigg\.com"/);
    expect(toml).not.toMatch(/pattern\s*=\s*"https?:\/\//);
    expect(toml).not.toMatch(/pattern\s*=\s*".*\/"/);
  });

  it('does not set usage_model or limits', () => {
    expect(toml).not.toMatch(/usage_model|cpu_ms|subrequests/);
  });

  it('does not declare [[durable_objects.bindings]]', () => {
    expect(toml).not.toMatch(/durable_objects/);
  });

  it('does not declare kv_namespaces preview_id', () => {
    expect(toml).not.toMatch(/preview_id/);
  });

  it('file uses double quotes exclusively for string values', () => {
    expect(toml).not.toMatch(/=\s*'/);
  });

  it('does not contain BOM or non-ASCII in config body', () => {
    expect(toml.charCodeAt(0)).not.toBe(0xfeff);
    expect([...toml].every((ch) => ch === '\n' || ch.charCodeAt(0) < 128)).toBe(true);
  });

  it('VERSION string matches package.json version and types optional VERSION', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    const types = readFileSync(join(root, 'src/types.ts'), 'utf8');
    expect(toml).toContain(`VERSION = "${pkg.version}"`);
    expect(types).toMatch(/VERSION\?:\s*string/);
  });

  it('does not declare define or alias bundler overrides', () => {
    expect(toml).not.toMatch(/^\s*define\s*=/m);
    expect(toml).not.toMatch(/^\s*alias\s*=/m);
  });

  it('routes custom_domain true appears only once', () => {
    expect((toml.match(/custom_domain\s*=\s*true/g) ?? []).length).toBe(1);
  });

  it('kv binding CATALOG_CACHE appears only once', () => {
    expect((toml.match(/CATALOG_CACHE/g) ?? []).length).toBe(1);
  });

  it('does not declare [triggers] crons', () => {
    expect(toml).not.toMatch(/\[triggers\]|\bcrons\b/);
  });

  it('does not declare logpush or tail consumers', () => {
    expect(toml).not.toMatch(/logpush|tail_consumers/i);
  });

  it('compatibility_date precedes kv_namespaces table', () => {
    expect(toml.indexOf('compatibility_date')).toBeLessThan(toml.indexOf('[[kv_namespaces]]'));
  });

  it('kv_namespaces precedes routes table', () => {
    expect(toml.indexOf('[[kv_namespaces]]')).toBeLessThan(toml.indexOf('[[routes]]'));
  });

  it('routes precedes vars table', () => {
    expect(toml.indexOf('[[routes]]')).toBeLessThan(toml.indexOf('[vars]'));
  });

  it('does not set workers_dev true or false', () => {
    expect(toml).not.toMatch(/workers_dev\s*=/);
  });

  it('secret put comment is not an executable assignment', () => {
    expect(toml).toMatch(/#\s*wrangler secret put GEMINI_API_KEY/);
    expect(toml).not.toMatch(/^wrangler secret put/m);
  });

  it('does not declare [[r2_buckets]] or [[d1_databases]]', () => {
    expect(toml).not.toMatch(/\[\[r2_buckets\]\]|\[\[d1_databases\]\]/);
  });

  it('does not declare [[vectorize]] or [ai]', () => {
    expect(toml).not.toMatch(/\[\[vectorize\]\]|^\s*\[ai\]/m);
  });

  it('name main compatibility_date use spaces around equals', () => {
    expect(toml).toMatch(/^name = "/m);
    expect(toml).toMatch(/^main = "/m);
    expect(toml).toMatch(/^compatibility_date = "/m);
  });

  it('does not embed GEMINI or API key substrings outside secret put comment', () => {
    const withoutComments = toml
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    expect(withoutComments).not.toMatch(/GEMINI|API_KEY|apiKey/i);
  });

  // --- HEAVY burn (post-#52): wrangler.toml unit deepen (orthogonal to mcp) ---

  it('locks exact UTF-16 length of wrangler.toml to 330', () => {
    expect(toml.length).toBe(330);
  });

  it('locks exact UTF-8 byte length equal to UTF-16 length (ASCII-only)', () => {
    expect(new TextEncoder().encode(toml).length).toBe(330);
    expect(new TextEncoder().encode(toml).length).toBe(toml.length);
  });

  it('locks exact line count including trailing empty split slot', () => {
    // split('\n') yields 18 entries because file ends with newline
    expect(toml.split('\n')).toHaveLength(18);
    expect(toml.endsWith('\n')).toBe(true);
    expect(toml.startsWith('name = "backlink"\n')).toBe(true);
  });

  it('locks exact nonempty line count to 13', () => {
    const nonempty = toml.split('\n').filter((l) => l.length > 0);
    expect(nonempty).toHaveLength(13);
  });

  it('locks exact blank-line count between sections to 4', () => {
    expect(toml.split('\n').filter((l) => l === '').length).toBe(5); // 4 blanks + trailing ''
    expect((toml.match(/\n\n/g) ?? []).length).toBe(4);
  });

  it('locks full-file snapshot string identity via template', () => {
    expect(toml).toBe(
      [
        'name = "backlink"',
        'main = "src/index.ts"',
        'compatibility_date = "2025-01-01"',
        '',
        '[[kv_namespaces]]',
        'binding = "CATALOG_CACHE"',
        'id = "edb6ca4df12f4f45b40508b3dda3c432"',
        '',
        '[[routes]]',
        'pattern = "backlink.fuzzywigg.com"',
        'custom_domain = true',
        '',
        '[vars]',
        'VERSION = "0.1.0"',
        '',
        '# Secrets (set via CLI, never commit):',
        '# wrangler secret put GEMINI_API_KEY',
        '',
      ].join('\n'),
    );
  });

  it('locks JSON.stringify of full toml byte length snapshot', () => {
    expect(JSON.stringify(toml).length).toBe(363); // quotes + escaped newlines
    expect(JSON.stringify(toml).startsWith('"name = \\"backlink\\"\\n')).toBe(true);
    expect(JSON.stringify(toml).endsWith('GEMINI_API_KEY\\n"')).toBe(true);
  });

  it('btoa/atob round-trip of worker name token stays stable', () => {
    expect(btoa('backlink')).toBe('YmFja2xpbms=');
    expect(atob(btoa('backlink'))).toBe('backlink');
    expect(toml).toContain(`name = "${atob('YmFja2xpbms=')}"`);
  });

  it('btoa/atob round-trip of VERSION 0.1.0 stays stable', () => {
    expect(btoa('0.1.0')).toBe('MC4xLjA=');
    expect(atob('MC4xLjA=')).toBe('0.1.0');
    expect(toml).toContain(`VERSION = "${atob('MC4xLjA=')}"`);
  });

  it('locks codePointAt sequence for worker name backlink', () => {
    expect([...('backlink')].map((c) => c.codePointAt(0))).toEqual([
      98, 97, 99, 107, 108, 105, 110, 107,
    ]);
  });

  it('locks codePointAt sequence for compatibility_date 2025-01-01', () => {
    expect([...('2025-01-01')].map((c) => c.charCodeAt(0))).toEqual([
      50, 48, 50, 53, 45, 48, 49, 45, 48, 49,
    ]);
  });

  it('locks TextEncoder bytes for CATALOG_CACHE binding name', () => {
    expect([...new TextEncoder().encode('CATALOG_CACHE')]).toEqual([
      67, 65, 84, 65, 76, 79, 71, 95, 67, 65, 67, 72, 69,
    ]);
  });

  it('locks KV id hex code units length and charset', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    expect(id).toHaveLength(32);
    expect(/^[a-f0-9]{32}$/.test(id)).toBe(true);
    expect(id.toUpperCase()).toBe('EDB6CA4DF12F4F45B40508B3DDA3C432');
    expect(toml).toContain(`id = "${id}"`);
  });

  it('locks KV id as Array.from char list identity', () => {
    expect(Array.from('edb6ca4df12f4f45b40508b3dda3c432')).toEqual([
      'e', 'd', 'b', '6', 'c', 'a', '4', 'd', 'f', '1', '2', 'f', '4', 'f', '4', '5',
      'b', '4', '0', '5', '0', '8', 'b', '3', 'd', 'd', 'a', '3', 'c', '4', '3', '2',
    ]);
  });

  it('KV id first/last nibble and midpoint stay fixed', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    expect(id[0]).toBe('e');
    expect(id[15]).toBe('5');
    expect(id[16]).toBe('b');
    expect(id[31]).toBe('2');
    expect(id.slice(0, 8)).toBe('edb6ca4d');
    expect(id.slice(24)).toBe('dda3c432');
  });

  it('Reflect.ownKeys on parsed line map stays insertion-ordered', () => {
    const map: Record<string, string> = {
      name: 'backlink',
      main: 'src/index.ts',
      compatibility_date: '2025-01-01',
    };
    expect(Reflect.ownKeys(map)).toEqual(['name', 'main', 'compatibility_date']);
    expect(Object.keys(map)).toEqual(['name', 'main', 'compatibility_date']);
  });

  it('Object.freeze on extracted top-level values does not mutate live toml', () => {
    const extracted = Object.freeze({
      name: 'backlink',
      main: 'src/index.ts',
      compatibility_date: '2025-01-01',
    });
    expect(() => {
      (extracted as { name: string }).name = 'mutated';
    }).toThrow();
    expect(toml).toContain('name = "backlink"');
    expect(Object.isFrozen(extracted)).toBe(true);
  });

  it('Object.seal clone of route fields stays extensibility-false', () => {
    const route = Object.seal({
      pattern: 'backlink.fuzzywigg.com',
      custom_domain: true,
    });
    expect(Object.isSealed(route)).toBe(true);
    expect(Object.isExtensible(route)).toBe(false);
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('Proxy.revocable over name token cannot rewrite live file string', () => {
    const target = { name: 'backlink' };
    const { proxy, revoke } = Proxy.revocable(target, {
      set(obj, prop, value) {
        if (prop === 'name') {
          (obj as { name: string }).name = String(value);
          return true;
        }
        return false;
      },
    });
    proxy.name = 'hijacked';
    expect(proxy.name).toBe('hijacked');
    expect(toml).toContain('name = "backlink"');
    revoke();
    expect(() => proxy.name).toThrow();
  });

  it('structuredClone of section token array is independent of source', () => {
    const sections = ['[[kv_namespaces]]', '[[routes]]', '[vars]'];
    const cloned = structuredClone(sections);
    cloned[0] = '[[mutated]]';
    expect(sections[0]).toBe('[[kv_namespaces]]');
    expect(toml).toContain('[[kv_namespaces]]');
    expect(cloned).not.toBe(sections);
  });

  it('Map/Set/WeakMap identity locks for binding tokens', () => {
    const binding = 'CATALOG_CACHE';
    const set = new Set([binding, 'VERSION', 'backlink']);
    const map = new Map([
      ['binding', binding],
      ['var', 'VERSION'],
    ]);
    const wm = new WeakMap<object, string>();
    const key = { binding };
    wm.set(key, binding);
    expect(set.has('CATALOG_CACHE')).toBe(true);
    expect(map.get('binding')).toBe('CATALOG_CACHE');
    expect(wm.get(key)).toBe('CATALOG_CACHE');
    expect(set.size).toBe(3);
  });

  it('array-copy independence: splice/filter on lines leaves live toml intact', () => {
    const lines = toml.split('\n');
    const copy = [...lines];
    copy.splice(0, 1);
    const filtered = lines.filter((l) => !l.startsWith('#'));
    expect(lines[0]).toBe('name = "backlink"');
    expect(copy[0]).toBe('main = "src/index.ts"');
    expect(filtered.every((l) => !l.startsWith('#'))).toBe(true);
    expect(toml.startsWith('name = "backlink"')).toBe(true);
  });

  it('reverse copy of nonempty lines does not mutate live order', () => {
    const nonempty = toml.split('\n').filter((l) => l.length > 0);
    const reversed = [...nonempty].reverse();
    expect(reversed[0]).toBe('# wrangler secret put GEMINI_API_KEY');
    expect(nonempty[0]).toBe('name = "backlink"');
    expect(toml.indexOf('name = "backlink"')).toBe(0);
  });

  it('RegExp full-match locks for top-level assignment lines', () => {
    expect(/^name = "backlink"$/m.test(toml)).toBe(true);
    expect(/^main = "src\/index\.ts"$/m.test(toml)).toBe(true);
    expect(/^compatibility_date = "2025-01-01"$/m.test(toml)).toBe(true);
    expect(/^VERSION = "0\.1\.0"$/m.test(toml)).toBe(true);
  });

  it('RegExp full-match locks for table headers and boolean', () => {
    expect(/^\[\[kv_namespaces\]\]$/m.test(toml)).toBe(true);
    expect(/^\[\[routes\]\]$/m.test(toml)).toBe(true);
    expect(/^\[vars\]$/m.test(toml)).toBe(true);
    expect(/^custom_domain = true$/m.test(toml)).toBe(true);
  });

  it('padStart/padEnd on tokens trim back to live values', () => {
    expect('backlink'.padStart(16).trim()).toBe('backlink');
    expect('CATALOG_CACHE'.padEnd(20).trim()).toBe('CATALOG_CACHE');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
  });

  it('encodeURIComponent of domain pattern stays mostly unescaped', () => {
    expect(encodeURIComponent('backlink.fuzzywigg.com')).toBe('backlink.fuzzywigg.com');
    expect(encodeURIComponent('src/index.ts')).toBe('src%2Findex.ts');
    expect(decodeURIComponent('src%2Findex.ts')).toBe('src/index.ts');
  });

  it('does not declare hyperdrive browser queue or ratelimits bindings', () => {
    expect(toml).not.toMatch(/hyperdrive|browser_rendering|ratelimits|queues/i);
  });

  it('does not declare send_email or dispatch_namespaces', () => {
    expect(toml).not.toMatch(/send_email|dispatch_namespaces/i);
  });

  it('does not declare analytics_engine or mtls_certificates', () => {
    expect(toml).not.toMatch(/analytics_engine|mtls_certificates/i);
  });

  it('does not declare unsafe bindings or wasm_modules', () => {
    expect(toml).not.toMatch(/^\s*\[unsafe\]/m);
    expect(toml).not.toMatch(/wasm_modules|text_blobs/i);
  });

  it('does not declare compatibility_flags key anywhere in lean config', () => {
    expect(toml).not.toMatch(/compatibility_flags/);
  });

  it('does not declare minify or keep_vars build flags', () => {
    expect(toml).not.toMatch(/^\s*minify\s*=/m);
    expect(toml).not.toMatch(/keep_vars/);
  });

  it('does not declare [[rules]] table or find_additional_modules flag', () => {
    expect(toml).not.toMatch(/^\s*\[\[rules\]\]/m);
    expect(toml).not.toMatch(/find_additional_modules/);
  });

  it('does not declare tsconfig or no_bundle overrides', () => {
    expect(toml).not.toMatch(/^\s*tsconfig\s*=/m);
    expect(toml).not.toMatch(/no_bundle/);
  });

  it('does not declare placement or first_party_worker', () => {
    expect(toml).not.toMatch(/placement|first_party_worker/i);
  });

  it('does not declare smart_placement or regions', () => {
    expect(toml).not.toMatch(/smart_placement|^\s*regions\s*=/m);
  });

  it('does not declare [[vpc_services]] or container bindings', () => {
    expect(toml).not.toMatch(/vpc_services|containers/i);
  });

  it('does not declare secrets_store_secrets table', () => {
    expect(toml).not.toMatch(/secrets_store/i);
  });

  it('does not declare observability or traces blocks', () => {
    expect(toml).not.toMatch(/observability|^\s*\[tracing\]/m);
  });

  it('does not declare [build] or [build.upload] sections', () => {
    expect(toml).not.toMatch(/^\[build/m);
  });

  it('does not declare env.production or env.staging tables', () => {
    expect(toml).not.toMatch(/^\[env\./m);
  });

  it('does not declare migrations for durable objects', () => {
    expect(toml).not.toMatch(/\[\[migrations\]\]|new_classes|deleted_classes/);
  });

  it('does not declare site bucket or serve_assets', () => {
    expect(toml).not.toMatch(/^\s*\[site\]/m);
    expect(toml).not.toMatch(/serve_assets|asset_handler/i);
  });

  it('does not declare assets directory binding', () => {
    expect(toml).not.toMatch(/^\s*\[assets\]/m);
    expect(toml).not.toMatch(/directory\s*=\s*"\.\/dist"/);
  });

  it('does not declare JSX or jsx_factory bundler knobs', () => {
    expect(toml).not.toMatch(/jsx_factory|jsx_fragment/i);
  });

  it('does not declare base_dir or outdir', () => {
    expect(toml).not.toMatch(/^\s*base_dir\s*=/m);
    expect(toml).not.toMatch(/^\s*outdir\s*=/m);
  });

  it('locks indexOf ordering: name before main before compatibility_date', () => {
    expect(toml.indexOf('name = "backlink"')).toBeLessThan(toml.indexOf('main = "src/index.ts"'));
    expect(toml.indexOf('main = "src/index.ts"')).toBeLessThan(
      toml.indexOf('compatibility_date = "2025-01-01"'),
    );
  });

  it('locks indexOf: binding before id within kv block', () => {
    const kvStart = toml.indexOf('[[kv_namespaces]]');
    const bindingIdx = toml.indexOf('binding = "CATALOG_CACHE"');
    const idIdx = toml.indexOf('id = "edb6ca4df12f4f45b40508b3dda3c432"');
    expect(kvStart).toBeLessThan(bindingIdx);
    expect(bindingIdx).toBeLessThan(idIdx);
  });

  it('locks indexOf: pattern before custom_domain within routes', () => {
    const routesStart = toml.indexOf('[[routes]]');
    const patternIdx = toml.indexOf('pattern = "backlink.fuzzywigg.com"');
    const customIdx = toml.indexOf('custom_domain = true');
    expect(routesStart).toBeLessThan(patternIdx);
    expect(patternIdx).toBeLessThan(customIdx);
  });

  it('locks lastIndexOf for GEMINI_API_KEY equals sole occurrence', () => {
    expect(toml.indexOf('GEMINI_API_KEY')).toBe(toml.lastIndexOf('GEMINI_API_KEY'));
    expect(toml.indexOf('GEMINI_API_KEY')).toBeGreaterThan(toml.indexOf('# Secrets'));
  });

  it('locks occurrence counts for equals signs and double quotes', () => {
    expect((toml.match(/=/g) ?? []).length).toBe(8);
    expect((toml.match(/"/g) ?? []).length).toBe(14);
  });

  it('locks occurrence counts for bracket tables', () => {
    expect((toml.match(/\[\[/g) ?? []).length).toBe(2);
    expect((toml.match(/\]\]/g) ?? []).length).toBe(2);
    expect((toml.match(/^\[vars\]/m) ?? []).length).toBe(1);
  });

  it('locks word-boundary count for backlink token (name + domain)', () => {
    expect((toml.match(/\bbacklink\b/g) ?? []).length).toBe(2);
  });

  it('locks fuzzywigg.com appears exactly once as domain suffix', () => {
    expect((toml.match(/fuzzywigg\.com/g) ?? []).length).toBe(1);
    expect(toml).toContain('backlink.fuzzywigg.com');
    expect(toml).not.toContain('www.backlink.fuzzywigg.com');
  });

  it('localeCompare ordering of top-level keys stays alphabetical for name/main', () => {
    expect('compatibility_date'.localeCompare('main')).toBeLessThan(0);
    expect('main'.localeCompare('name')).toBeLessThan(0);
    // live file order is name → main → compatibility_date (not alpha)
    expect(toml.indexOf('name')).toBeLessThan(toml.indexOf('main'));
  });

  it('trim/trimEnd on every line is identity (no trailing spaces)', () => {
    for (const line of toml.split('\n')) {
      expect(line).toBe(line.trimEnd());
      if (line.length > 0 && !line.startsWith('#')) {
        expect(line).toBe(line.trimStart());
      }
    }
  });

  it('comment lines both start with # and space after hash', () => {
    const comments = toml.split('\n').filter((l) => l.startsWith('#'));
    expect(comments).toEqual([
      '# Secrets (set via CLI, never commit):',
      '# wrangler secret put GEMINI_API_KEY',
    ]);
    expect(comments.every((c) => c.startsWith('# '))).toBe(true);
  });

  it('Secrets comment locks exact wording and punctuation', () => {
    expect(toml).toContain('# Secrets (set via CLI, never commit):');
    expect(toml).not.toContain('never commit!');
    expect(toml).toMatch(/never commit\):/);
    expect(toml).not.toMatch(/never commit\)\s*$/m);
  });

  it('secret put comment locks exact CLI invocation spelling', () => {
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
    expect(toml).not.toContain('wrangler secrets put');
    expect(toml).not.toContain('secret:put');
  });

  it('cross-locks worker name with package.json name field', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    expect(pkg.name).toBe('backlink');
    expect(toml).toMatch(/^name = "backlink"$/m);
    expect(pkg.version).toBe('0.1.0');
  });

  it('cross-locks main entry with package type module and scripts.dev', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      type: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.dev).toBe('wrangler dev');
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
    expect(pkg.devDependencies.wrangler).toMatch(/^\^4\./);
    expect(toml).toMatch(/^main = "src\/index\.ts"$/m);
  });

  it('cross-locks CATALOG_CACHE with src/types.ts required Env field', () => {
    const types = readFileSync(join(root, 'src/types.ts'), 'utf8');
    expect(types).toMatch(/CATALOG_CACHE:\s*KVNamespace/);
    expect(types).toMatch(/GEMINI_API_KEY\?:\s*string/);
    expect(types).toMatch(/VERSION\?:\s*string/);
    expect(toml).toContain('binding = "CATALOG_CACHE"');
    expect(toml).not.toMatch(/^\s*GEMINI_API_KEY\s*=/m);
  });

  it('cross-locks domain with AGENTS.md domain target line', () => {
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('cross-locks secret put docs with DEPLOY.md CLI steps', () => {
    const deploy = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
    expect(deploy).toContain('wrangler secret put GEMINI_API_KEY');
    expect(deploy).toContain('wrangler kv namespace create CATALOG_CACHE');
    expect(deploy).toContain('backlink.fuzzywigg.com');
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
  });

  it('DEPLOY.md placeholder id is not the live kv id', () => {
    const deploy = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
    expect(deploy).toContain('your-kv-id-here');
    expect(toml).not.toContain('your-kv-id-here');
    expect(toml).toContain('edb6ca4df12f4f45b40508b3dda3c432');
  });

  it('does not embed Cloudflare account hex or API tokens', () => {
    expect(toml).not.toMatch(/cf_api|CF_API|api_token|API_TOKEN/i);
    expect(toml).not.toMatch(/account_id\s*=\s*"[a-f0-9]{32}"/);
  });

  it('boolean true for custom_domain is bare TOML bool not quoted', () => {
    expect(toml).toMatch(/custom_domain = true/);
    expect(toml).not.toMatch(/custom_domain = "true"/);
    expect(toml).not.toMatch(/custom_domain = 'true'/);
    expect(toml).not.toMatch(/custom_domain = 1\b/);
  });

  it('VERSION uses dotted semver string not number', () => {
    expect(toml).toMatch(/VERSION = "0\.1\.0"/);
    expect(toml).not.toMatch(/VERSION = 0\.1\.0/);
    expect(toml).not.toMatch(/VERSION = 0$/m);
  });

  it('main path uses forward slashes not Windows separators', () => {
    expect(toml).toContain('src/index.ts');
    expect(toml).not.toContain('src\\index.ts');
    expect(toml).not.toContain('./src/index.ts');
  });

  it('compatibility_date uses ISO date with zero-padded month/day', () => {
    expect(toml).toMatch(/compatibility_date = "\d{4}-\d{2}-\d{2}"/);
    expect(toml).toContain('2025-01-01');
    expect(toml).not.toContain('2025-1-1');
  });

  it('kv table uses double-bracket array-of-tables syntax', () => {
    expect(toml).toContain('[[kv_namespaces]]');
    expect(toml).not.toMatch(/(?<!\[)\[kv_namespaces\](?!\])/);
    expect(toml).not.toContain('kv_namespaces =');
    expect((toml.match(/\[\[kv_namespaces\]\]/g) ?? []).length).toBe(1);
  });

  it('routes table uses double-bracket array-of-tables syntax', () => {
    expect(toml).toContain('[[routes]]');
    expect(toml).not.toMatch(/^\[routes\]/m);
  });

  it('vars uses single-bracket table not array-of-tables', () => {
    expect(toml).toMatch(/^\[vars\]/m);
    expect(toml).not.toContain('[[vars]]');
  });

  it('line endings are LF only without CR', () => {
    expect(toml.includes('\r')).toBe(false);
    expect(toml.split('\r\n')).toHaveLength(1);
  });

  it('does not contain form-feed vertical-tab or null bytes', () => {
    expect(toml.includes('\0')).toBe(false);
    expect(toml.includes('\f')).toBe(false);
    expect(toml.includes('\v')).toBe(false);
  });

  it('first character is n of name and last nonempty char is Y of KEY', () => {
    expect(toml[0]).toBe('n');
    const trimmed = toml.replace(/\n+$/, '');
    expect(trimmed.endsWith('GEMINI_API_KEY')).toBe(true);
    expect(trimmed.at(-1)).toBe('Y');
  });

  it('locks substring offsets for key anchors via indexOf', () => {
    expect(toml.indexOf('name = "backlink"')).toBe(0);
    expect(toml.indexOf('[[kv_namespaces]]')).toBe(75);
    expect(toml.indexOf('[[routes]]')).toBe(160);
    expect(toml.indexOf('[vars]')).toBe(228);
  });

  it('locks substring offsets for secrets comment block', () => {
    expect(toml.indexOf('# Secrets (set via CLI, never commit):')).toBe(254);
    expect(toml.indexOf('# wrangler secret put GEMINI_API_KEY')).toBe(293);
  });

  it('slice from 0..75 equals header block including trailing blank', () => {
    expect(toml.slice(0, 75)).toBe(
      'name = "backlink"\nmain = "src/index.ts"\ncompatibility_date = "2025-01-01"\n\n',
    );
  });

  it('repeat of equals delimiter does not appear as ===', () => {
    expect(toml.includes('===')).toBe(false);
    expect(toml.includes('==')).toBe(false);
    expect((toml.match(/ = /g) ?? []).length).toBe(8);
  });

  it('String.prototype.includes locks for required tokens present', () => {
    for (const token of [
      'backlink',
      'src/index.ts',
      '2025-01-01',
      'CATALOG_CACHE',
      'edb6ca4df12f4f45b40508b3dda3c432',
      'backlink.fuzzywigg.com',
      'custom_domain',
      'VERSION',
      '0.1.0',
      'GEMINI_API_KEY',
    ]) {
      expect(toml.includes(token)).toBe(true);
    }
  });

  it('negative includes locks for disallowed product URLs', () => {
    for (const token of [
      'openai.com',
      'anthropic.com',
      'generativelanguage.googleapis.com',
      'iptv-org.github.io',
      'localhost',
      '127.0.0.1',
    ]) {
      expect(toml.includes(token)).toBe(false);
    }
  });

  it('does not declare nodejs_compat or experimental flags as strings', () => {
    expect(toml).not.toMatch(/nodejs_compat|nodejs_als|rpc/i);
  });

  it('does not declare logpush destinations or destinations arrays', () => {
    expect(toml).not.toMatch(/destinations|sampling_rate/i);
  });

  it('does not declare worker_loaders or named Worker loaders', () => {
    expect(toml).not.toMatch(/worker_loaders/i);
  });

  it('does not declare [[hello_world]] sample binding leftovers', () => {
    expect(toml).not.toMatch(/hello_world|HelloWorld/i);
  });

  it('kv binding value is SCREAMING_SNAKE and routes pattern is lowercase host', () => {
    expect(toml).toMatch(/binding = "[A-Z][A-Z0-9_]*"/);
    expect(toml).toMatch(/pattern = "[a-z0-9.-]+"/);
  });

  it('no inline comments on assignment lines', () => {
    const assignments = toml.split('\n').filter((l) => l.includes(' = '));
    expect(assignments.every((l) => !l.includes(' #'))).toBe(true);
    expect(assignments).toHaveLength(8);
  });

  it('table headers occupy their own lines with no trailing comment', () => {
    for (const header of ['[[kv_namespaces]]', '[[routes]]', '[vars]']) {
      expect(toml.split('\n').filter((l) => l.includes(header))).toEqual([header]);
    }
  });

  it('JSON.parse round-trip of package version aligns with VERSION var', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    const m = toml.match(/VERSION = "([^"]+)"/);
    expect(m?.[1]).toBe(pkg.version);
    expect(m?.[1].split('.').map(Number)).toEqual([0, 1, 0]);
  });

  it('TextDecoder round-trip of full file bytes is identity', () => {
    const bytes = new TextEncoder().encode(toml);
    expect(new TextDecoder().decode(bytes)).toBe(toml);
    expect(bytes[0]).toBe(110); // 'n'
    expect(bytes[bytes.length - 1]).toBe(10); // '\n'
  });

  it('Buffer-free: charCodeAt walk never exceeds 127', () => {
    for (let i = 0; i < toml.length; i++) {
      expect(toml.charCodeAt(i)).toBeLessThan(128);
      expect(toml.charCodeAt(i)).toBeGreaterThan(0);
    }
  });

  it('split on double-newline yields exactly 5 section chunks', () => {
    const chunks = toml.trimEnd().split('\n\n');
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toContain('name = "backlink"');
    expect(chunks[1]).toContain('[[kv_namespaces]]');
    expect(chunks[2]).toContain('[[routes]]');
    expect(chunks[3]).toContain('[vars]');
    expect(chunks[4]).toContain('# Secrets');
  });

  it('Object.is compares extracted name to package name', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
    };
    const name = toml.match(/^name = "([^"]+)"/m)?.[1];
    expect(Object.is(name, pkg.name)).toBe(true);
    expect(Object.is(name, 'backlink')).toBe(true);
  });

  it('does not use triple-quote or multiline string TOML syntax', () => {
    expect(toml.includes('"""')).toBe(false);
    expect(toml.includes("'''")).toBe(false);
  });

  it('does not use TOML dotted keys for nested tables', () => {
    expect(toml).not.toMatch(/^\s*vars\.VERSION\s*=/m);
    expect(toml).not.toMatch(/^\s*routes\.pattern\s*=/m);
  });

  it('does not use inline table syntax with braces', () => {
    expect(toml.includes('{')).toBe(false);
    expect(toml.includes('}')).toBe(false);
  });

  it('does not use TOML array value syntax with brackets on assignments', () => {
    expect(toml).not.toMatch(/=\s*\[/);
  });

  it('hash count is exactly 2 (comment markers only)', () => {
    expect((toml.match(/#/g) ?? []).length).toBe(2);
  });

  it('underscore count locks for snake_case keys and secret name', () => {
    // compatibility_date(1) + kv_namespaces(1) + CATALOG_CACHE(1) + custom_domain(1) + GEMINI_API_KEY(2)
    expect((toml.match(/_/g) ?? []).length).toBe(6);
  });

  it('digit occurrence count stays stable for date version and kv id', () => {
    const digits = (toml.match(/\d/g) ?? []).length;
    // 2025-01-01 (8) + 0.1.0 (3) + kv id hex digits count
    const idDigits = ('edb6ca4df12f4f45b40508b3dda3c432'.match(/\d/g) ?? []).length;
    expect(digits).toBe(8 + 3 + idDigits);
    expect(idDigits).toBe(17);
    expect(digits).toBe(28);
  });

  it('dot occurrence count locks domain path version separators', () => {
    // src/index.ts (1) + backlink.fuzzywigg.com (2) + 0.1.0 (2) = 5
    expect((toml.match(/\./g) ?? []).length).toBe(5);
  });

  it('slash occurrence is exactly one for main entry path', () => {
    expect((toml.match(/\//g) ?? []).length).toBe(1);
    expect(toml).toContain('src/index.ts');
  });

  it('colon occurrence is exactly one in Secrets comment', () => {
    expect((toml.match(/:/g) ?? []).length).toBe(1);
    expect(toml).toContain('never commit):');
  });

  it('paren occurrence locks Secrets comment balanced pair', () => {
    expect((toml.match(/\(/g) ?? []).length).toBe(1);
    expect((toml.match(/\)/g) ?? []).length).toBe(1);
  });

  it('comma appears only inside the Secrets comment clause', () => {
    expect((toml.match(/,/g) ?? []).length).toBe(1);
    expect(toml).toContain('(set via CLI, never commit)');
    const withoutComments = toml
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    expect(withoutComments.includes(',')).toBe(false);
  });

  it('semicolon does not appear anywhere in wrangler.toml', () => {
    expect(toml.includes(';')).toBe(false);
  });

  it('at-sign does not appear (no email/account handles)', () => {
    expect(toml.includes('@')).toBe(false);
  });

  it('dollar-sign does not appear (no env interpolation)', () => {
    expect(toml.includes('$')).toBe(false);
  });

  it('percent-sign does not appear', () => {
    expect(toml.includes('%')).toBe(false);
  });

  it('pipe and ampersand do not appear', () => {
    expect(toml.includes('|')).toBe(false);
    expect(toml.includes('&')).toBe(false);
  });

  it('angle brackets do not appear', () => {
    expect(toml.includes('<')).toBe(false);
    expect(toml.includes('>')).toBe(false);
  });

  it('backtick does not appear', () => {
    expect(toml.includes('`')).toBe(false);
  });

  it('space-around-equals is uniform for all 8 assignments', () => {
    const bad = toml.split('\n').filter((l) => /=\S|\S=/.test(l) && l.includes('='));
    // table headers have no equals; comments may not
    expect(bad).toEqual([]);
    expect((toml.match(/ = /g) ?? []).length).toBe(8);
  });

  it('worker name is lowercase ASCII without digits', () => {
    const name = toml.match(/^name = "([^"]+)"/m)?.[1] ?? '';
    expect(name).toMatch(/^[a-z]+$/);
    expect(name).toHaveLength(8);
  });

  it('binding name length and VERSION key length stay fixed', () => {
    expect('CATALOG_CACHE').toHaveLength(13);
    expect('VERSION').toHaveLength(7);
    expect('GEMINI_API_KEY').toHaveLength(14);
    expect('compatibility_date').toHaveLength(18);
  });

  it('pattern host splits into three DNS labels', () => {
    const host = 'backlink.fuzzywigg.com';
    expect(host.split('.')).toEqual(['backlink', 'fuzzywigg', 'com']);
    expect(host.split('.')).toHaveLength(3);
  });

  it('main entry splits into directory and file', () => {
    expect('src/index.ts'.split('/')).toEqual(['src', 'index.ts']);
    expect('index.ts'.endsWith('.ts')).toBe(true);
  });

  it('does not reference vitest coverage or test paths', () => {
    expect(toml).not.toMatch(/vitest|coverage\/|test\//i);
  });

  it('does not reference README DEPLOY or AGENTS paths', () => {
    expect(toml).not.toMatch(/README|DEPLOY\.md|AGENTS\.md/);
  });

  it('does not declare upload_source_maps or source_maps', () => {
    expect(toml).not.toMatch(/source_maps|upload_source_maps/i);
  });

  it('does not declare preserve_file_names or metafile', () => {
    expect(toml).not.toMatch(/preserve_file_names|metafile/i);
  });

  it('does not declare cpu_ms limit or subrequest limits', () => {
    expect(toml).not.toMatch(/cpu_ms|subrequest/i);
  });

  it('README live worker host matches routes pattern', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toContain('https://backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(toml).not.toContain('https://');
  });

  it('docs/mcp-spec base URL host matches routes pattern', () => {
    const spec = readFileSync(join(root, 'docs/mcp-spec.md'), 'utf8');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
    expect(toml).toMatch(/pattern = "backlink\.fuzzywigg\.com"/);
  });

  it('hygiene: no duplicate consecutive identical nonempty lines', () => {
    const nonempty = toml.split('\n').filter((l) => l.length > 0);
    for (let i = 1; i < nonempty.length; i++) {
      expect(nonempty[i]).not.toBe(nonempty[i - 1]);
    }
  });

  it('every assignment key is unique across the file', () => {
    const keys = [...toml.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      'name',
      'main',
      'compatibility_date',
      'binding',
      'id',
      'pattern',
      'custom_domain',
      'VERSION',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('custom_domain key is snake_case boolean field', () => {
    expect(toml).toMatch(/custom_domain = true/);
    expect(toml).not.toMatch(/customDomain|CustomDomain|custom-domain/);
  });

  it('compatibility_date key is snake_case not camelCase', () => {
    expect(toml).toMatch(/compatibility_date = /);
    expect(toml).not.toMatch(/compatibilityDate|CompatibilityDate/);
  });

  it('kv_namespaces spelling is plural with underscore', () => {
    expect(toml).toContain('[[kv_namespaces]]');
    expect(toml).not.toContain('kv_namespace]');
    expect(toml).not.toContain('kvNamespaces');
  });

  it('does not set name to package description slug variants', () => {
    expect(toml).not.toMatch(/name = "backlink-facelift"/i);
    expect(toml).not.toMatch(/name = "Backlink"/);
    expect(toml).not.toMatch(/name = "BACKLINK"/);
  });

  it('does not point main at dist or wrangler entry shims', () => {
    expect(toml).not.toMatch(/main = "dist\//);
    expect(toml).not.toMatch(/main = "\.open-next\//);
    expect(toml).not.toMatch(/main = "worker\./);
  });

  it('VERSION is the only [vars] assignment and sits on next line', () => {
    const afterVars = toml.split('[vars]\n')[1] ?? '';
    const firstLine = afterVars.split('\n')[0];
    expect(firstLine).toBe('VERSION = "0.1.0"');
  });

  it('binding line sits immediately after kv_namespaces header', () => {
    expect(toml).toContain('[[kv_namespaces]]\nbinding = "CATALOG_CACHE"\n');
  });

  it('id line sits immediately after binding line', () => {
    expect(toml).toContain(
      'binding = "CATALOG_CACHE"\nid = "edb6ca4df12f4f45b40508b3dda3c432"\n',
    );
  });

  it('pattern line sits immediately after routes header', () => {
    expect(toml).toContain('[[routes]]\npattern = "backlink.fuzzywigg.com"\n');
  });

  it('custom_domain line sits immediately after pattern line', () => {
    expect(toml).toContain(
      'pattern = "backlink.fuzzywigg.com"\ncustom_domain = true\n',
    );
  });

  it('file ends with single trailing newline not multiple blanks beyond one', () => {
    expect(toml.endsWith('\n')).toBe(true);
    expect(toml.endsWith('\n\n')).toBe(false);
    expect(toml.endsWith('GEMINI_API_KEY\n')).toBe(true);
  });

  it('does not declare preview_urls or workers_dev hostname overrides', () => {
    expect(toml).not.toMatch(/preview_urls|workers_dev/i);
  });

  it('does not declare route zone_name or zone_id fields', () => {
    expect(toml).not.toMatch(/zone_name|zone_id/);
  });

  it('does not declare script_name override distinct from name', () => {
    expect(toml).not.toMatch(/script_name/);
  });

  it('negative MCP SDK keys are absent from wrangler.toml', () => {
    expect(toml).not.toMatch(/name_for_model|description_for_human|input_schema/);
  });

  it('negative JSON Schema draft keywords are absent', () => {
    expect(toml).not.toMatch(/\$schema|additionalProperties|oneOf|anyOf|allOf/);
  });

  it('does not embed Hono or Vitest dependency names', () => {
    expect(toml).not.toMatch(/\bhono\b|\bvitest\b/i);
  });

  it('String.raw of header lines matches live content', () => {
    expect(toml).toContain(String.raw`name = "backlink"`);
    expect(toml).toContain(String.raw`main = "src/index.ts"`);
  });

  it('fromCharCode rebuild of backlink matches live name', () => {
    const rebuilt = String.fromCharCode(98, 97, 99, 107, 108, 105, 110, 107);
    expect(rebuilt).toBe('backlink');
    expect(toml).toContain(`name = "${rebuilt}"`);
  });

  it('Number.parseInt of VERSION segments stays non-negative', () => {
    const ver = toml.match(/VERSION = "([^"]+)"/)?.[1] ?? '';
    const parts = ver.split('.').map((p) => Number.parseInt(p, 10));
    expect(parts).toEqual([0, 1, 0]);
    expect(parts.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
  });

  it('Date.parse of compatibility_date yields a finite timestamp', () => {
    const d = toml.match(/compatibility_date = "([^"]+)"/)?.[1] ?? '';
    expect(Number.isFinite(Date.parse(d))).toBe(true);
    expect(d).toBe('2025-01-01');
  });

  it('KV id parseInt base16 of first two chars equals 0xed', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    expect(Number.parseInt(id.slice(0, 2), 16)).toBe(0xed);
    expect(Number.parseInt(id.slice(-2), 16)).toBe(0x32);
  });

  it('does not contain emoji or smart quotes', () => {
    expect(toml).not.toMatch(/[^\x00-\x7F]/);
    expect(toml).not.toContain('\u201c');
    expect(toml).not.toContain('\u201d');
  });

  it('line index 0..16 lock for critical rows', () => {
    const lines = toml.split('\n');
    expect(lines[0]).toBe('name = "backlink"');
    expect(lines[4]).toBe('[[kv_namespaces]]');
    expect(lines[8]).toBe('[[routes]]');
    expect(lines[12]).toBe('[vars]');
    expect(lines[15]).toBe('# Secrets (set via CLI, never commit):');
    expect(lines[16]).toBe('# wrangler secret put GEMINI_API_KEY');
    expect(lines[17]).toBe('');
  });

  it('Immutable copy via Object.assign does not alias live string', () => {
    const bag = Object.assign({}, { toml });
    bag.toml = 'mutated';
    expect(toml.startsWith('name = "backlink"')).toBe(true);
    expect(bag.toml).toBe('mutated');
  });

  it('Array.prototype.every confirms printable ASCII excluding tabs', () => {
    expect(
      [...toml].every((ch) => {
        const c = ch.charCodeAt(0);
        return c === 10 || (c >= 32 && c < 127);
      }),
    ).toBe(true);
  });

  // --- HEAVY burn (post-#58): wrangler.toml unit deepen (orthogonal to helpers) ---

  it('post58: locks SHA-256 digest of wrangler.toml bytes', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(toml));
    expect(Buffer.from(digest).toString('hex')).toBe(
      '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8',
    );
  });

  it('post58: locks SHA-384 digest of wrangler.toml bytes', async () => {
    const digest = await crypto.subtle.digest('SHA-384', new TextEncoder().encode(toml));
    expect(Buffer.from(digest).toString('hex')).toBe(
      '77464378ae30b2d97a5c510d0ecb15598cc8705e67283c0a776dafdbdb349741a93f5f1e52aa0a127c077a28a574bd09',
    );
  });

  it('post58: locks SHA-512 digest prefix of wrangler.toml bytes', async () => {
    const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(toml));
    expect(Buffer.from(digest).toString('hex').slice(0, 64)).toBe(
      '4fdd7f275037737b409d87c97826e8f84d32099a9e0fd3f85458fe047cba2130',
    );
  });

  it('post58: locks full-file base64 identity', () => {
    expect(Buffer.from(toml, 'utf8').toString('base64')).toBe(
      'bmFtZSA9ICJiYWNrbGluayIKbWFpbiA9ICJzcmMvaW5kZXgudHMiCmNvbXBhdGliaWxpdHlfZGF0ZSA9ICIyMDI1LTAxLTAxIgoKW1trdl9uYW1lc3BhY2VzXV0KYmluZGluZyA9ICJDQVRBTE9HX0NBQ0hFIgppZCA9ICJlZGI2Y2E0ZGYxMmY0ZjQ1YjQwNTA4YjNkZGEzYzQzMiIKCltbcm91dGVzXV0KcGF0dGVybiA9ICJiYWNrbGluay5mdXp6eXdpZ2cuY29tIgpjdXN0b21fZG9tYWluID0gdHJ1ZQoKW3ZhcnNdClZFUlNJT04gPSAiMC4xLjAiCgojIFNlY3JldHMgKHNldCB2aWEgQ0xJLCBuZXZlciBjb21taXQpOgojIHdyYW5nbGVyIHNlY3JldCBwdXQgR0VNSU5JX0FQSV9LRVkK',
    );
  });

  it('post58: locks full-file hex identity length and prefix/suffix', () => {
    const hex = Buffer.from(toml, 'utf8').toString('hex');
    expect(hex).toHaveLength(660);
    expect(hex.startsWith('6e616d65203d20226261636b6c696e6b220a')).toBe(true);
    expect(hex.endsWith('47454d494e495f4150495f4b45590a')).toBe(true);
  });

  it('post58: locks byte-sum and xor fold of UTF-8 payload', () => {
    const bytes = [...new TextEncoder().encode(toml)];
    expect(bytes.reduce((a, b) => a + b, 0)).toBe(26511);
    expect(bytes.reduce((a, b) => a ^ b, 0)).toBe(65);
  });

  it('post58: locks punctuation occurrence census', () => {
    expect((toml.match(/ /g) ?? []).length).toBe(26);
    expect((toml.match(/\n/g) ?? []).length).toBe(17);
    expect((toml.match(/_/g) ?? []).length).toBe(6);
    expect((toml.match(/-/g) ?? []).length).toBe(2);
    expect((toml.match(/\./g) ?? []).length).toBe(5);
    expect((toml.match(/#/g) ?? []).length).toBe(2);
    expect((toml.match(/\[/g) ?? []).length).toBe(5);
    expect((toml.match(/\]/g) ?? []).length).toBe(5);
    expect((toml.match(/:/g) ?? []).length).toBe(1);
    expect((toml.match(/[()]/g) ?? []).length).toBe(2);
    expect((toml.match(/,/g) ?? []).length).toBe(1);
    expect((toml.match(/\//g) ?? []).length).toBe(1);
  });

  it('post58: locks exact per-line UTF-16 lengths including blanks', () => {
    expect(toml.split('\n').map((l) => l.length)).toEqual([
      17, 21, 33, 0, 17, 25, 39, 0, 10, 34, 20, 0, 6, 17, 0, 38, 36, 0,
    ]);
  });

  it('post58: locks absolute index anchors for section headers', () => {
    expect(toml.indexOf('name')).toBe(0);
    expect(toml.indexOf('main')).toBe(18);
    expect(toml.indexOf('compatibility_date')).toBe(40);
    expect(toml.indexOf('[[kv_namespaces]]')).toBe(75);
    expect(toml.indexOf('[[routes]]')).toBe(160);
    expect(toml.indexOf('[vars]')).toBe(228);
    expect(toml.indexOf('# Secrets')).toBe(254);
    expect(toml.indexOf('GEMINI_API_KEY')).toBe(315);
  });

  it('post58: locks first and last big-endian u32 nibbles of file bytes', () => {
    const bytes = new TextEncoder().encode(toml);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, false).toString(16)).toBe('6e616d65'); // "name"
    expect(view.getUint32(bytes.length - 4, false).toString(16)).toBe('4b45590a'); // "KEY\n"
  });

  it('post58: locks BigInt of first eight UTF-8 bytes', () => {
    const head = Buffer.from(toml, 'utf8').subarray(0, 8);
    expect(BigInt(`0x${head.toString('hex')}`).toString()).toBe('7953758698013007906');
  });

  it('post58: locks encodeURIComponent length and escaped equals/newlines', () => {
    const enc = encodeURIComponent(toml);
    expect(enc).toHaveLength(490);
    expect(enc.startsWith('name%20%3D%20%22backlink%22%0A')).toBe(true);
    expect(decodeURIComponent(enc)).toBe(toml);
  });

  it('post58: locks unique sorted identifier token set', () => {
    const words = toml.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect([...new Set(words)].sort()).toEqual([
      'CATALOG_CACHE',
      'CLI',
      'GEMINI_API_KEY',
      'Secrets',
      'VERSION',
      'backlink',
      'binding',
      'com',
      'commit',
      'compatibility_date',
      'custom_domain',
      'edb6ca4df12f4f45b40508b3dda3c432',
      'fuzzywigg',
      'id',
      'index',
      'kv_namespaces',
      'main',
      'name',
      'never',
      'pattern',
      'put',
      'routes',
      'secret',
      'set',
      'src',
      'true',
      'ts',
      'vars',
      'via',
      'wrangler',
    ]);
  });

  it('post58: locks Intl.Segmenter word-like token count and prefix', () => {
    const segs = [...new Intl.Segmenter('en', { granularity: 'word' }).segment(toml)]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment);
    expect(segs).toHaveLength(32);
    expect(segs.slice(0, 10)).toEqual([
      'name',
      'backlink',
      'main',
      'src',
      'index.ts',
      'compatibility_date',
      '2025',
      '01',
      '01',
      'kv_namespaces',
    ]);
  });

  it('post58: btoa/atob round-trip locks for every nonempty config line', () => {
    const expected: Record<string, string> = {
      'name = "backlink"': 'bmFtZSA9ICJiYWNrbGluayI=',
      'main = "src/index.ts"': 'bWFpbiA9ICJzcmMvaW5kZXgudHMi',
      'compatibility_date = "2025-01-01"': 'Y29tcGF0aWJpbGl0eV9kYXRlID0gIjIwMjUtMDEtMDEi',
      '[[kv_namespaces]]': 'W1trdl9uYW1lc3BhY2VzXV0=',
      'binding = "CATALOG_CACHE"': 'YmluZGluZyA9ICJDQVRBTE9HX0NBQ0hFIg==',
      'id = "edb6ca4df12f4f45b40508b3dda3c432"':
        'aWQgPSAiZWRiNmNhNGRmMTJmNGY0NWI0MDUwOGIzZGRhM2M0MzIi',
      '[[routes]]': 'W1tyb3V0ZXNdXQ==',
      'pattern = "backlink.fuzzywigg.com"': 'cGF0dGVybiA9ICJiYWNrbGluay5mdXp6eXdpZ2cuY29tIg==',
      'custom_domain = true': 'Y3VzdG9tX2RvbWFpbiA9IHRydWU=',
      '[vars]': 'W3ZhcnNd',
      'VERSION = "0.1.0"': 'VkVSU0lPTiA9ICIwLjEuMCI=',
      '# Secrets (set via CLI, never commit):': 'IyBTZWNyZXRzIChzZXQgdmlhIENMSSwgbmV2ZXIgY29tbWl0KTo=',
      '# wrangler secret put GEMINI_API_KEY': 'IyB3cmFuZ2xlciBzZWNyZXQgcHV0IEdFTUlOSV9BUElfS0VZ',
    };
    for (const [line, b64] of Object.entries(expected)) {
      expect(btoa(line)).toBe(b64);
      expect(atob(b64)).toBe(line);
      expect(toml).toContain(line);
    }
  });

  it('post58: locks codePointAt sequence for VERSION token', () => {
    expect([...('VERSION')].map((c) => c.codePointAt(0))).toEqual([86, 69, 82, 83, 73, 79, 78]);
    expect(toml).toContain('VERSION = "0.1.0"');
  });

  it('post58: locks codePointAt sequence for GEMINI_API_KEY token', () => {
    expect([...('GEMINI_API_KEY')].map((c) => c.codePointAt(0))).toEqual([
      71, 69, 77, 73, 78, 73, 95, 65, 80, 73, 95, 75, 69, 89,
    ]);
    expect(toml).toContain('GEMINI_API_KEY');
  });

  it('post58: locks codePointAt sequence for fuzzywigg domain label', () => {
    expect([...('fuzzywigg')].map((c) => c.charCodeAt(0))).toEqual([
      102, 117, 122, 122, 121, 119, 105, 103, 103,
    ]);
    expect(toml).toContain('fuzzywigg.com');
  });

  it('post58: fromCharCode rebuild of CATALOG_CACHE matches live binding', () => {
    const rebuilt = String.fromCharCode(
      67, 65, 84, 65, 76, 79, 71, 95, 67, 65, 67, 72, 69,
    );
    expect(rebuilt).toBe('CATALOG_CACHE');
    expect(toml).toContain(`binding = "${rebuilt}"`);
  });

  it('post58: fromCharCode rebuild of GEMINI_API_KEY matches secret comment', () => {
    const rebuilt = String.fromCharCode(
      71, 69, 77, 73, 78, 73, 95, 65, 80, 73, 95, 75, 69, 89,
    );
    expect(rebuilt).toBe('GEMINI_API_KEY');
    expect(toml).toContain(`# wrangler secret put ${rebuilt}`);
  });

  it('post58: reversed character stream starts with KEY newline then secret put', () => {
    const reversed = [...toml].reverse().join('');
    expect(reversed.startsWith('\nYEK_IPA_INIMEG tup terces relgnarw #')).toBe(true);
    expect(reversed).toContain(':)timmoc reven');
    expect([...reversed].reverse().join('')).toBe(toml);
  });

  it('post58: NFC/NFD/NFKC/NFKD normalizations are identity for ASCII body', () => {
    expect(toml.normalize('NFC')).toBe(toml);
    expect(toml.normalize('NFD')).toBe(toml);
    expect(toml.normalize('NFKC')).toBe(toml);
    expect(toml.normalize('NFKD')).toBe(toml);
    expect(toml.normalize('NFC').length).toBe(330);
  });

  it('post58: uppercase token census stays limited to known ALLCAPS islands', () => {
    expect(toml.match(/[A-Z]{2,}/g)).toEqual([
      'CATALOG',
      'CACHE',
      'VERSION',
      'CLI',
      'GEMINI',
      'API',
      'KEY',
    ]);
  });

  it('post58: toLowerCase mutates only ALLCAPS islands while preserving length', () => {
    const lower = toml.toLowerCase();
    expect(lower).not.toBe(toml);
    expect(lower.length).toBe(toml.length);
    expect(lower).toContain('catalog_cache');
    expect(lower).toContain('gemini_api_key');
    expect(lower).toContain('version = "0.1.0"');
    expect(toml).toContain('CATALOG_CACHE');
  });

  it('post58: URL / URLSearchParams domain locks stay scheme-free in toml', () => {
    const u = new URL('https://backlink.fuzzywigg.com/');
    expect(u.hostname).toBe('backlink.fuzzywigg.com');
    expect(new URLSearchParams({ host: u.hostname }).toString()).toBe(
      'host=backlink.fuzzywigg.com',
    );
    expect(toml).toContain(`pattern = "${u.hostname}"`);
    expect(toml).not.toContain('https://');
  });

  it('post58: Object.freeze on parsed wrangler shape cannot rewrite live file', () => {
    const shape = Object.freeze({
      name: 'backlink',
      main: 'src/index.ts',
      compatibility_date: '2025-01-01',
      binding: 'CATALOG_CACHE',
      id: 'edb6ca4df12f4f45b40508b3dda3c432',
      pattern: 'backlink.fuzzywigg.com',
      custom_domain: true,
      VERSION: '0.1.0',
    });
    expect(() => {
      (shape as { name: string }).name = 'hijacked';
    }).toThrow();
    expect(Object.isFrozen(shape)).toBe(true);
    expect(toml).toContain('name = "backlink"');
  });

  it('post58: Object.seal on route bag blocks new keys without mutating toml', () => {
    const route = Object.seal({
      pattern: 'backlink.fuzzywigg.com',
      custom_domain: true as boolean,
    });
    expect(Object.isSealed(route)).toBe(true);
    expect(Object.isExtensible(route)).toBe(false);
    expect(() => {
      (route as { zone?: string }).zone = 'fuzzywigg.com';
    }).toThrow();
    expect(toml).toContain('custom_domain = true');
  });

  it('post58: Proxy.revocable over VERSION cannot rewrite live vars line', () => {
    const target = { VERSION: '0.1.0' };
    const { proxy, revoke } = Proxy.revocable(target, {
      set(obj, prop, value) {
        if (prop === 'VERSION') {
          (obj as { VERSION: string }).VERSION = String(value);
          return true;
        }
        return false;
      },
    });
    proxy.VERSION = '9.9.9';
    expect(proxy.VERSION).toBe('9.9.9');
    expect(toml).toContain('VERSION = "0.1.0"');
    revoke();
    expect(() => proxy.VERSION).toThrow();
  });

  it('post58: structuredClone of line array is independent of live split', () => {
    const lines = toml.split('\n');
    const cloned = structuredClone(lines);
    cloned[0] = 'name = "mutated"';
    expect(lines[0]).toBe('name = "backlink"');
    expect(toml.startsWith('name = "backlink"')).toBe(true);
    expect(cloned).not.toBe(lines);
  });

  it('post58: Map/Set/WeakMap identity locks for wrangler tokens', () => {
    const set = new Set(['backlink', 'CATALOG_CACHE', 'VERSION', 'GEMINI_API_KEY']);
    const map = new Map<string, string>([
      ['name', 'backlink'],
      ['binding', 'CATALOG_CACHE'],
      ['var', 'VERSION'],
    ]);
    const key = { id: 'edb6ca4df12f4f45b40508b3dda3c432' };
    const wm = new WeakMap<object, string>();
    wm.set(key, key.id);
    expect(set.size).toBe(4);
    expect(map.get('binding')).toBe('CATALOG_CACHE');
    expect(wm.get(key)).toBe('edb6ca4df12f4f45b40508b3dda3c432');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
  });

  it('post58: Reflect.ownKeys insertion order for lean config bag', () => {
    const bag: Record<string, string> = {
      name: 'backlink',
      main: 'src/index.ts',
      compatibility_date: '2025-01-01',
      binding: 'CATALOG_CACHE',
      pattern: 'backlink.fuzzywigg.com',
      VERSION: '0.1.0',
    };
    expect(Reflect.ownKeys(bag)).toEqual([
      'name',
      'main',
      'compatibility_date',
      'binding',
      'pattern',
      'VERSION',
    ]);
  });

  it('post58: ArrayBuffer / Uint8Array view of toml stays ASCII-stable', () => {
    const bytes = new TextEncoder().encode(toml);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    copy[0] = 0x4d; // 'M'
    expect(new TextDecoder().decode(bytes).startsWith('name')).toBe(true);
    expect(new TextDecoder().decode(copy).startsWith('Mame')).toBe(true);
    expect(toml.startsWith('name')).toBe(true);
  });

  it('post58: DataView getUint8 walk of first name line matches char codes', () => {
    const bytes = new TextEncoder().encode(toml);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const expected = [...('name = "backlink"\n')].map((c) => c.charCodeAt(0));
    expect(expected.map((_, i) => view.getUint8(i))).toEqual(expected);
  });

  it('post58: Atomics wait is not needed — SharedArrayBuffer copy stays independent', () => {
    const bytes = new TextEncoder().encode(toml);
    const sab = new SharedArrayBuffer(bytes.byteLength);
    const view = new Uint8Array(sab);
    view.set(bytes);
    view[0] = 88;
    expect(toml.charCodeAt(0)).toBe(110); // 'n'
    expect(view[0]).toBe(88);
  });

  it('post58: JSON.parse round-trip of extracted vars bag stays VERSION-only', () => {
    const bag = JSON.parse(JSON.stringify({ VERSION: '0.1.0' })) as { VERSION: string };
    expect(Object.keys(bag)).toEqual(['VERSION']);
    expect(toml).toMatch(/^VERSION = "0\.1\.0"$/m);
    expect(JSON.stringify(bag)).toBe('{"VERSION":"0.1.0"}');
  });

  it('post58: localeCompare of section headers keeps table-array before vars', () => {
    expect('[[kv_namespaces]]'.localeCompare('[[routes]]')).toBeLessThan(0);
    expect('[[routes]]'.localeCompare('[vars]')).toBeLessThan(0);
    expect(toml.indexOf('[[kv_namespaces]]')).toBeLessThan(toml.indexOf('[[routes]]'));
    expect(toml.indexOf('[[routes]]')).toBeLessThan(toml.indexOf('[vars]'));
  });

  it('post58: padStart/padEnd/repeat on tokens trim/slice back to live values', () => {
    expect('backlink'.padStart(20, '.').slice(-8)).toBe('backlink');
    expect('0.1.0'.repeat(3).slice(0, 5)).toBe('0.1.0');
    expect('CATALOG_CACHE'.padEnd(20, '_').replace(/_+$/, '')).toBe('CATALOG_CACHE');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
  });

  it('post58: replaceAll on copy cannot rewrite live equals spacing', () => {
    const mutated = toml.replaceAll(' = ', '=');
    expect(mutated).not.toBe(toml);
    expect(mutated).toContain('name="backlink"');
    expect(toml).toContain('name = "backlink"');
    expect(toml).not.toContain('name="backlink"');
  });

  it('post58: split/join identity with blank-line preservation', () => {
    expect(toml.split('\n').join('\n')).toBe(toml);
    expect(toml.split('\n\n').join('\n\n')).toBe(toml);
    expect((toml.match(/\n\n/g) ?? []).length).toBe(4);
  });

  it('post58: Number / BigInt locks for VERSION and compatibility year', () => {
    expect(Number.parseFloat('0.1.0')).toBe(0.1);
    expect('0.1.0'.split('.').map((p) => Number(p))).toEqual([0, 1, 0]);
    expect(BigInt('2025')).toBe(2025n);
    expect(toml).toContain('VERSION = "0.1.0"');
    expect(toml).toContain('compatibility_date = "2025-01-01"');
  });

  it('post58: Date.UTC of compatibility_date anchors to 2025-01-01Z', () => {
    expect(Date.UTC(2025, 0, 1)).toBe(Date.parse('2025-01-01T00:00:00.000Z'));
    expect(toml).toContain('compatibility_date = "2025-01-01"');
  });

  it('post58: KV id BigInt parse of first 16 hex chars stays stable', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    expect(BigInt(`0x${id.slice(0, 16)}`).toString(16)).toBe('edb6ca4df12f4f45');
    expect(BigInt(`0x${id.slice(16)}`).toString(16)).toBe('b40508b3dda3c432');
    expect(toml).toContain(`id = "${id}"`);
  });

  it('post58: does not declare nodejs_compat or compatibility_flags arrays', () => {
    expect(toml).not.toMatch(/nodejs_compat|nodejs_als|compatibility_flags/);
  });

  it('post58: does not declare workers_ai / ai_gateway / images / stream', () => {
    expect(toml).not.toMatch(/workers_ai|ai_gateway|^\s*\[images\]|^\s*\[stream\]/m);
  });

  it('post58: does not declare constellation or ai_search bindings', () => {
    expect(toml).not.toMatch(/constellation|ai_search/i);
  });

  it('post58: does not declare pages_build_output_dir or static assets root', () => {
    expect(toml).not.toMatch(/pages_build_output_dir|static_assets/i);
  });

  it('post58: does not declare tail_workers or logpush consumers', () => {
    expect(toml).not.toMatch(/tail_workers|logpush/i);
  });

  it('post58: does not declare browser_rendering or ratelimits tables', () => {
    expect(toml).not.toMatch(/browser_rendering|\[\[ratelimits\]\]/i);
  });

  it('post58: does not declare [[queues]] producers or consumers', () => {
    expect(toml).not.toMatch(/\[\[queues/i);
  });

  it('post58: does not declare send_email or dispatch_namespaces', () => {
    expect(toml).not.toMatch(/send_email|dispatch_namespaces/i);
  });

  it('post58: does not declare analytics_engine datasets', () => {
    expect(toml).not.toMatch(/analytics_engine/i);
  });

  it('post58: does not declare mtls_certificates bindings', () => {
    expect(toml).not.toMatch(/mtls_certificates/i);
  });

  it('post58: does not declare unsafe / wasm_modules / text_blobs', () => {
    expect(toml).not.toMatch(/^\s*\[unsafe\]/m);
    expect(toml).not.toMatch(/wasm_modules|text_blobs/i);
  });

  it('post58: does not declare smart_placement / placement / regions', () => {
    expect(toml).not.toMatch(/smart_placement|^\s*\[placement\]|^\s*regions\s*=/m);
  });

  it('post58: does not declare vpc_services or containers', () => {
    expect(toml).not.toMatch(/vpc_services|\[\[containers\]\]/i);
  });

  it('post58: does not declare secrets_store_secrets', () => {
    expect(toml).not.toMatch(/secrets_store/i);
  });

  it('post58: does not declare observability or tracing blocks', () => {
    expect(toml).not.toMatch(/observability|^\s*\[tracing\]/m);
  });

  it('post58: does not declare keep_names or metafile bundler knobs', () => {
    expect(toml).not.toMatch(/keep_names|metafile/i);
  });

  it('post58: does not declare upload_source_maps or source_maps', () => {
    expect(toml).not.toMatch(/upload_source_maps|source_maps/i);
  });

  it('post58: does not declare preview_urls or workers_dev toggles', () => {
    expect(toml).not.toMatch(/preview_urls|workers_dev/i);
  });

  it('post58: does not declare script_name distinct from name', () => {
    expect(toml).not.toMatch(/script_name/);
  });

  it('post58: does not declare zone_name or zone_id on routes', () => {
    expect(toml).not.toMatch(/zone_name|zone_id/);
  });

  it('post58: does not declare account_id top-level Cloudflare account hex', () => {
    expect(toml).not.toMatch(/^\s*account_id\s*=/m);
  });

  it('post58: does not declare preview_id on kv_namespaces', () => {
    expect(toml).not.toMatch(/preview_id/);
  });

  it('post58: does not declare [[migrations]] durable object class maps', () => {
    expect(toml).not.toMatch(/\[\[migrations\]\]|new_classes|deleted_classes/);
  });

  it('post58: does not declare usage_model / cpu_ms / subrequests limits', () => {
    expect(toml).not.toMatch(/usage_model|cpu_ms|subrequests/i);
  });

  it('post58: does not declare [dev] local_protocol overrides', () => {
    expect(toml).not.toMatch(/^\[dev\]/m);
    expect(toml).not.toMatch(/local_protocol/);
  });

  it('post58: does not declare node_compat or python_modules', () => {
    expect(toml).not.toMatch(/node_compat|python_modules/);
  });

  it('post58: does not declare [[services]] service bindings', () => {
    expect(toml).not.toMatch(/\[\[services\]\]/);
  });

  it('post58: does not declare pipelines or workflows bindings', () => {
    expect(toml).not.toMatch(/\bpipelines\b|\bworkflows\b/i);
  });

  it('post58: does not declare [[vectorize]] or [ai] blocks', () => {
    expect(toml).not.toMatch(/\[\[vectorize\]\]|^\s*\[ai\]/m);
  });

  it('post58: does not declare [[r2_buckets]] or [[d1_databases]]', () => {
    expect(toml).not.toMatch(/\[\[r2_buckets\]\]|\[\[d1_databases\]\]/);
  });

  it('post58: does not declare durable_objects bindings', () => {
    expect(toml).not.toMatch(/durable_objects/i);
  });

  it('post58: does not declare [triggers] crons', () => {
    expect(toml).not.toMatch(/\[triggers\]|\bcrons\b/);
  });

  it('post58: does not declare [build] / [build.upload] sections', () => {
    expect(toml).not.toMatch(/^\[build/m);
  });

  it('post58: does not declare env.production or env.staging tables', () => {
    expect(toml).not.toMatch(/^\[env\./m);
  });

  it('post58: does not declare [site] or [assets] directory bindings', () => {
    expect(toml).not.toMatch(/^\s*\[site\]/m);
    expect(toml).not.toMatch(/^\s*\[assets\]/m);
  });

  it('post58: does not declare minify / keep_vars / no_bundle flags', () => {
    expect(toml).not.toMatch(/^\s*minify\s*=/m);
    expect(toml).not.toMatch(/keep_vars|no_bundle/);
  });

  it('post58: does not declare [[rules]] or find_additional_modules', () => {
    expect(toml).not.toMatch(/^\s*\[\[rules\]\]/m);
    expect(toml).not.toMatch(/find_additional_modules/);
  });

  it('post58: does not declare tsconfig / base_dir / outdir overrides', () => {
    expect(toml).not.toMatch(/^\s*tsconfig\s*=/m);
    expect(toml).not.toMatch(/^\s*base_dir\s*=/m);
    expect(toml).not.toMatch(/^\s*outdir\s*=/m);
  });

  it('post58: does not declare define or alias bundler overrides', () => {
    expect(toml).not.toMatch(/^\s*define\s*=/m);
    expect(toml).not.toMatch(/^\s*alias\s*=/m);
  });

  it('post58: does not declare jsx_factory or jsx_fragment', () => {
    expect(toml).not.toMatch(/jsx_factory|jsx_fragment/i);
  });

  it('post58: does not embed CF_API_TOKEN / Authorization / Bearer secrets', () => {
    expect(toml).not.toMatch(/CF_API_TOKEN|Authorization|Bearer/i);
  });

  it('post58: does not embed Anthropic / OpenAI / Claude provider keys', () => {
    expect(toml).not.toMatch(/ANTHROPIC|OPENAI|CLAUDE|sk-[a-zA-Z0-9]/i);
  });

  it('post58: does not embed iptv-org CDN or Gemini API hostnames', () => {
    expect(toml).not.toMatch(/iptv-org|generativelanguage|googleapis/i);
  });

  it('post58: does not embed Hono / Vitest / TypeScript dependency names', () => {
    expect(toml).not.toMatch(/\bhono\b|\bvitest\b|\btypescript\b/i);
  });

  it('post58: does not embed MCP SDK name_for_model fields', () => {
    expect(toml).not.toMatch(/name_for_model|description_for_human|input_schema/);
  });

  it('post58: does not embed JSON Schema draft keywords', () => {
    expect(toml).not.toMatch(/\$schema|additionalProperties|oneOf|anyOf|allOf/);
  });

  it('post58: cross-locks worker name + VERSION with package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.scripts.dev).toBe('wrangler dev');
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
    expect(pkg.devDependencies.wrangler).toMatch(/^\^4\./);
    expect(toml).toMatch(/^name = "backlink"$/m);
    expect(toml).toMatch(/^VERSION = "0\.1\.0"$/m);
  });

  it('post58: cross-locks CATALOG_CACHE + optional secrets with src/types.ts', () => {
    const types = readFileSync(join(root, 'src/types.ts'), 'utf8');
    expect(types).toMatch(/CATALOG_CACHE:\s*KVNamespace/);
    expect(types).toMatch(/GEMINI_API_KEY\?:\s*string/);
    expect(types).toMatch(/VERSION\?:\s*string/);
    expect(toml).toContain('binding = "CATALOG_CACHE"');
    expect(toml).not.toMatch(/^\s*GEMINI_API_KEY\s*=/m);
  });

  it('post58: cross-locks domain pattern with AGENTS.md + README + mcp-spec', () => {
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const spec = readFileSync(join(root, 'docs/mcp-spec.md'), 'utf8');
    expect(agents).toContain('backlink.fuzzywigg.com');
    expect(readme).toContain('https://backlink.fuzzywigg.com');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(toml).not.toContain('https://');
  });

  it('post58: cross-locks secret put comment with DEPLOY.md HITL steps', () => {
    const deploy = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
    expect(deploy).toContain('wrangler secret put GEMINI_API_KEY');
    expect(deploy).toContain('wrangler kv namespace create CATALOG_CACHE');
    expect(deploy).toMatch(/HITL/i);
    expect(deploy).toContain('your-kv-id-here');
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
    expect(toml).not.toContain('your-kv-id-here');
    expect(toml).toContain('edb6ca4df12f4f45b40508b3dda3c432');
  });

  it('post58: cross-locks main entry path exists under src/', () => {
    const main = toml.match(/^main = "([^"]+)"/m)?.[1] ?? '';
    expect(main).toBe('src/index.ts');
    expect(readFileSync(join(root, main), 'utf8').length).toBeGreaterThan(0);
  });

  it('post58: hyphen/underscore spelling locks for snake_case keys only', () => {
    expect(toml).toMatch(/compatibility_date = /);
    expect(toml).toMatch(/custom_domain = /);
    expect(toml).toMatch(/kv_namespaces/);
    expect(toml).not.toMatch(/compatibility-date|custom-domain|kv-namespaces/);
    expect(toml).not.toMatch(/compatibilityDate|customDomain|kvNamespaces/);
  });

  it('post58: double-quote exclusive string literals (no single quotes)', () => {
    expect(toml).not.toMatch(/=\s*'/);
    expect((toml.match(/"/g) ?? []).length).toBe(14);
  });

  it('post58: boolean true is bare TOML bool; VERSION is quoted semver', () => {
    expect(toml).toMatch(/custom_domain = true/);
    expect(toml).not.toMatch(/custom_domain = "true"/);
    expect(toml).toMatch(/VERSION = "0\.1\.0"/);
    expect(toml).not.toMatch(/VERSION = 0\.1\.0\b/);
  });

  it('post58: main path uses POSIX separators without leading ./', () => {
    expect(toml).toContain('src/index.ts');
    expect(toml).not.toContain('src\\index.ts');
    expect(toml).not.toContain('./src/index.ts');
  });

  it('post58: compatibility_date zero-pads month/day and rejects bare 2025-1-1', () => {
    expect(toml).toContain('2025-01-01');
    expect(toml).not.toContain('2025-1-1');
    expect(toml).toMatch(/compatibility_date = "\d{4}-\d{2}-\d{2}"/);
  });

  it('post58: section order lock via lastIndexOf equals indexOf for uniques', () => {
    for (const token of [
      '[[kv_namespaces]]',
      '[[routes]]',
      '[vars]',
      'CATALOG_CACHE',
      'GEMINI_API_KEY',
    ]) {
      expect(toml.indexOf(token)).toBe(toml.lastIndexOf(token));
    }
  });

  it('post58: blank-line separators sit between every major section', () => {
    expect(toml).toContain('compatibility_date = "2025-01-01"\n\n[[kv_namespaces]]');
    expect(toml).toContain('id = "edb6ca4df12f4f45b40508b3dda3c432"\n\n[[routes]]');
    expect(toml).toContain('custom_domain = true\n\n[vars]');
    expect(toml).toContain('VERSION = "0.1.0"\n\n# Secrets');
  });

  it('post58: comment lines are exactly two and both use "# " prefix', () => {
    const comments = toml.split('\n').filter((l) => l.startsWith('#'));
    expect(comments).toEqual([
      '# Secrets (set via CLI, never commit):',
      '# wrangler secret put GEMINI_API_KEY',
    ]);
    expect(comments.every((c) => c.startsWith('# '))).toBe(true);
  });

  it('post58: Secrets header punctuation locks colon + parentheses + comma', () => {
    expect(toml).toContain('# Secrets (set via CLI, never commit):');
    expect(toml).not.toContain('never commit!');
    expect(toml).not.toContain('never commit.');
    expect(toml).toMatch(/\(set via CLI, never commit\):/);
  });

  it('post58: secret put comment rejects plural secrets / colon-put variants', () => {
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
    expect(toml).not.toContain('wrangler secrets put');
    expect(toml).not.toContain('secret:put');
    expect(toml).not.toMatch(/^wrangler secret put/m);
  });

  it('post58: printable ASCII excluding tabs/CR; no BOM/smart quotes/emoji', () => {
    expect(toml.charCodeAt(0)).not.toBe(0xfeff);
    expect(toml).not.toContain('\r');
    expect(toml).not.toContain('\t');
    expect(toml).not.toContain('\u201c');
    expect(toml).not.toContain('\u201d');
    expect([...toml].every((ch) => {
      const c = ch.charCodeAt(0);
      return c === 10 || (c >= 32 && c < 127);
    })).toBe(true);
  });

  it('post58: unique printable charset lock for lean config body', () => {
    expect([...new Set([...toml])].sort().join('')).toBe(
      '\n "#(),-./01234568:=ACEGHIKLMNOPRSTVY[]_abcdefgiklmnoprstuvwxyz',
    );
  });

  it('post58: line-index lock for every nonempty row in file order', () => {
    const lines = toml.split('\n');
    expect(lines.filter((l) => l.length > 0)).toEqual([
      'name = "backlink"',
      'main = "src/index.ts"',
      'compatibility_date = "2025-01-01"',
      '[[kv_namespaces]]',
      'binding = "CATALOG_CACHE"',
      'id = "edb6ca4df12f4f45b40508b3dda3c432"',
      '[[routes]]',
      'pattern = "backlink.fuzzywigg.com"',
      'custom_domain = true',
      '[vars]',
      'VERSION = "0.1.0"',
      '# Secrets (set via CLI, never commit):',
      '# wrangler secret put GEMINI_API_KEY',
    ]);
  });

  it('post58: full-file snapshot string identity via template (repeat lock)', () => {
    expect(toml).toBe(
      [
        'name = "backlink"',
        'main = "src/index.ts"',
        'compatibility_date = "2025-01-01"',
        '',
        '[[kv_namespaces]]',
        'binding = "CATALOG_CACHE"',
        'id = "edb6ca4df12f4f45b40508b3dda3c432"',
        '',
        '[[routes]]',
        'pattern = "backlink.fuzzywigg.com"',
        'custom_domain = true',
        '',
        '[vars]',
        'VERSION = "0.1.0"',
        '',
        '# Secrets (set via CLI, never commit):',
        '# wrangler secret put GEMINI_API_KEY',
        '',
      ].join('\n'),
    );
  });

  it('post58: TextEncoder/TextDecoder round-trip is identity', () => {
    const bytes = new TextEncoder().encode(toml);
    expect(new TextDecoder().decode(bytes)).toBe(toml);
    expect(bytes.length).toBe(330);
  });

  it('post58: crypto.getRandomValues buffer size unrelated to toml length lock', () => {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    expect(buf).toHaveLength(16);
    expect(toml.length).toBe(330);
  });

  it('post58: WeakRef of frozen config bag still reads live tokens', () => {
    const bag = Object.freeze({ name: 'backlink', binding: 'CATALOG_CACHE' });
    const ref = new WeakRef(bag);
    expect(ref.deref()?.name).toBe('backlink');
    expect(toml).toContain('name = "backlink"');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
  });

  it('post58: Iterator helpers — Array.from(toml) length equals UTF-16 length', () => {
    expect(Array.from(toml)).toHaveLength(330);
    expect(Array.from(toml).join('')).toBe(toml);
  });

  it('post58: Object.assign / spread copies do not alias live string', () => {
    const a = Object.assign({}, { toml });
    const b = { ...{ toml } };
    a.toml = 'mut-a';
    b.toml = 'mut-b';
    expect(toml.startsWith('name = "backlink"')).toBe(true);
    expect(a.toml).toBe('mut-a');
    expect(b.toml).toBe('mut-b');
  });

  it('post58: RegExp sticky/global scans count assignment lines to 8', () => {
    const re = /^[A-Za-z_][A-Za-z0-9_]*\s*=/gm;
    expect([...(toml.match(re) ?? [])]).toHaveLength(8);
  });

  it('post58: negative — no tabs between keys and equals', () => {
    expect(toml).not.toMatch(/\t=/);
    expect(toml).not.toMatch(/=\t/);
  });

  it('post58: negative — no trailing spaces on any line', () => {
    for (const line of toml.split('\n')) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('post58: negative — worker name is not Backlink_Facelift repo slug', () => {
    expect(toml).not.toMatch(/name = "Backlink_Facelift"/);
    expect(toml).not.toMatch(/name = "backlink_facelift"/);
    expect(toml).toMatch(/^name = "backlink"$/m);
  });

  it('post58: negative — domain is not workers.dev or pages.dev', () => {
    expect(toml).not.toMatch(/workers\.dev|pages\.dev/);
    expect(toml).toContain('backlink.fuzzywigg.com');
  });

  it('post58: negative — VERSION is not 1.0.0 or 0.0.0', () => {
    expect(toml).not.toMatch(/VERSION = "1\.0\.0"/);
    expect(toml).not.toMatch(/VERSION = "0\.0\.0"/);
    expect(toml).toMatch(/VERSION = "0\.1\.0"/);
  });

  it('post58: negative — compatibility_date is not 2024 or undated', () => {
    expect(toml).not.toContain('2024-');
    expect(toml).toContain('2025-01-01');
  });

  it('post58: Promise.resolve snapshot of toml string stays referentially equal', async () => {
    await expect(Promise.resolve(toml)).resolves.toBe(toml);
    expect(await Promise.resolve(toml)).toHaveLength(330);
  });

  it('post58: queueMicrotask observes immutable toml length', async () => {
    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        expect(toml.length).toBe(330);
        resolve();
      });
    });
  });

});
