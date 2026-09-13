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

});
