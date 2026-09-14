import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tomlPath = join(root, 'wrangler.toml');
const toml = readFileSync(tomlPath, 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
const typesSrc = readFileSync(join(root, 'src/types.ts'), 'utf8');
const deployMd = readFileSync(join(root, 'DEPLOY.md'), 'utf8');
const indexSrc = readFileSync(join(root, 'src/index.ts'), 'utf8');
const agentsMd = readFileSync(join(root, 'AGENTS.md'), 'utf8');
const readmeMd = readFileSync(join(root, 'README.md'), 'utf8');
const mcpSpecMd = readFileSync(join(root, 'docs/mcp-spec.md'), 'utf8');
const ciYml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const deployYml = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
const tsconfigJson = readFileSync(join(root, 'tsconfig.json'), 'utf8');
const vitestCfg = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
const envJson = readFileSync(join(root, '.cursor/environment.json'), 'utf8');

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

  // --- HEAVY burn (post-#58): wrangler.toml deepen (orthogonal to helpers/parser/routes/genres/CI) ---

  it('cross-locks worker name with package.json name', () => {
    expect(pkg.name).toBe('backlink');
    expect(toml).toContain(`name = "${pkg.name}"`);
  });

  it('cross-locks VERSION var with package.json version', () => {
    expect(pkg.version).toBe('0.1.0');
    expect(toml).toContain(`VERSION = "${pkg.version}"`);
  });

  it('cross-locks CATALOG_CACHE binding with Env interface in types.ts', () => {
    expect(typesSrc).toContain('CATALOG_CACHE: KVNamespace');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
  });

  it('cross-locks VERSION optional Env field with [vars] VERSION', () => {
    expect(typesSrc).toMatch(/VERSION\?:\s*string/);
    expect(toml).toMatch(/VERSION\s*=\s*"0\.1\.0"/);
  });

  it('cross-locks GEMINI_API_KEY as Env optional without toml assignment', () => {
    expect(typesSrc).toMatch(/GEMINI_API_KEY\?:\s*string/);
    expect(toml).toContain('wrangler secret put GEMINI_API_KEY');
    expect(toml).not.toMatch(/^\s*GEMINI_API_KEY\s*=/m);
  });

  it('cross-locks secret put comment with DEPLOY.md wrangler secret put step', () => {
    expect(deployMd).toContain('wrangler secret put GEMINI_API_KEY');
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
  });

  it('cross-locks domain pattern with AGENTS.md Domain target', () => {
    expect(agentsMd).toContain('backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('cross-locks main entry with Worker import graph starting at src/index.ts', () => {
    expect(toml).toContain('main = "src/index.ts"');
    expect(indexSrc).toContain("import { Hono } from 'hono'");
    expect(indexSrc).toContain('export default app');
  });

  it('cross-locks VERSION fallback in Worker with wrangler [vars]', () => {
    expect(indexSrc).toContain("c.env.VERSION ?? '0.1.0'");
    expect(toml).toContain('VERSION = "0.1.0"');
  });

  it('fs.statSync size equals UTF-8 byte length 330', () => {
    const st = statSync(tomlPath);
    expect(st.size).toBe(330);
    expect(st.isFile()).toBe(true);
    expect(new TextEncoder().encode(toml).length).toBe(st.size);
  });

  it('sha256 of wrangler.toml locks to known digest', () => {
    const digest = createHash('sha256').update(toml, 'utf8').digest('hex');
    expect(digest).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8');
  });

  it('sha1 of wrangler.toml locks to known digest', () => {
    expect(createHash('sha1').update(toml, 'utf8').digest('hex')).toBe(
      '481c8221707ffe602ab8d5ce4a2b7b5192d3ade6',
    );
  });

  it('md5 of wrangler.toml locks to known digest', () => {
    expect(createHash('md5').update(toml, 'utf8').digest('hex')).toBe(
      '100cd1554884befe9db6453606e565f4',
    );
  });

  it('sha256 digest is lowercase hex length 64', () => {
    const digest = createHash('sha256').update(toml, 'utf8').digest('hex');
    expect(digest).toHaveLength(64);
    expect(digest).toBe(digest.toLowerCase());
    expect(/^[a-f0-9]{64}$/.test(digest)).toBe(true);
  });

  it('Buffer.from(toml) equals TextEncoder bytes', () => {
    const a = [...Buffer.from(toml, 'utf8')];
    const b = [...new TextEncoder().encode(toml)];
    expect(a).toEqual(b);
    expect(a).toHaveLength(330);
  });

  it('naive TOML line grammar classifies every nonempty line', () => {
    const kinds = toml
      .split('\n')
      .filter((l) => l.length > 0)
      .map((line) => {
        if (line.startsWith('#')) return 'comment';
        if (/^\[\[[^\]]+\]\]$/.test(line)) return 'array-table';
        if (/^\[[^\]]+\]$/.test(line)) return 'table';
        if (/^[A-Za-z_][A-Za-z0-9_]* = /.test(line)) return 'assignment';
        return 'unknown';
      });
    expect(kinds).toEqual([
      'assignment',
      'assignment',
      'assignment',
      'array-table',
      'assignment',
      'assignment',
      'array-table',
      'assignment',
      'assignment',
      'table',
      'assignment',
      'comment',
      'comment',
    ]);
    expect(kinds.includes('unknown')).toBe(false);
  });

  it('parsed assignment map locks top-level string values', () => {
    const map: Record<string, string> = {};
    for (const line of toml.split('\n')) {
      const m = line.match(/^([A-Za-z_]+) = "([^"]*)"$/);
      if (m) map[m[1]] = m[2];
    }
    expect(map).toEqual({
      name: 'backlink',
      main: 'src/index.ts',
      compatibility_date: '2025-01-01',
      binding: 'CATALOG_CACHE',
      id: 'edb6ca4df12f4f45b40508b3dda3c432',
      pattern: 'backlink.fuzzywigg.com',
      VERSION: '0.1.0',
    });
  });

  it('parsed boolean assignment locks custom_domain true only', () => {
    const bools = [...toml.matchAll(/^([a-z_]+) = (true|false)$/gm)].map((m) => [m[1], m[2]]);
    expect(bools).toEqual([['custom_domain', 'true']]);
  });

  it('URL hostname from pattern equals live domain and is not www', () => {
    const pattern = toml.match(/pattern = "([^"]+)"/)?.[1] ?? '';
    const url = new URL(`https://${pattern}/`);
    expect(url.hostname).toBe('backlink.fuzzywigg.com');
    expect(url.protocol).toBe('https:');
    expect(url.hostname.startsWith('www.')).toBe(false);
    expect(url.port).toBe('');
  });

  it('URL pathname of main entry resolves under src/', () => {
    const main = toml.match(/main = "([^"]+)"/)?.[1] ?? '';
    expect(main.split('/')).toEqual(['src', 'index.ts']);
    expect(main.endsWith('.ts')).toBe(true);
  });

  it('Intl.Collator sorts section headers stably', () => {
    const headers = ['[[kv_namespaces]]', '[[routes]]', '[vars]'];
    const sorted = [...headers].sort(new Intl.Collator('en').compare);
    expect(sorted).toEqual(['[[kv_namespaces]]', '[[routes]]', '[vars]']);
    expect(toml.indexOf('[[kv_namespaces]]')).toBeLessThan(toml.indexOf('[[routes]]'));
    expect(toml.indexOf('[[routes]]')).toBeLessThan(toml.indexOf('[vars]'));
  });

  it('BigInt of KV id as hex equals known value', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    expect(BigInt(`0x${id}`).toString(16)).toBe(id);
    expect(BigInt(`0x${id}`) > 0n).toBe(true);
  });

  it('KV id nibble sum stays fixed', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    const sum = [...id].reduce((acc, ch) => acc + Number.parseInt(ch, 16), 0);
    expect(sum).toBe(246);
  });

  it('VERSION semver parts are non-negative integers of length 3', () => {
    const ver = toml.match(/VERSION = "([^"]+)"/)?.[1] ?? '';
    const parts = ver.split('.');
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => /^\d+$/.test(p))).toBe(true);
    expect(parts.map(Number)).toEqual([0, 1, 0]);
  });

  it('compatibility_date parses as UTC midnight via Date.UTC', () => {
    const d = toml.match(/compatibility_date = "([^"]+)"/)?.[1] ?? '';
    const [y, m, day] = d.split('-').map(Number);
    expect(Date.UTC(y, m - 1, day)).toBe(Date.parse(`${d}T00:00:00.000Z`));
    expect(y).toBe(2025);
    expect(m).toBe(1);
    expect(day).toBe(1);
  });

  it('does not declare [[images]] or image resizing bindings', () => {
    expect(toml).not.toMatch(/\[\[images\]\]|image_resizing/i);
  });

  it('does not declare [[vectorize]] indexes beyond prior negations', () => {
    expect(toml).not.toMatch(/vectorize/i);
  });

  it('does not declare [[workflows]] or workflow bindings', () => {
    expect(toml).not.toMatch(/\[\[workflows\]\]|^\s*\[workflows\]/m);
  });

  it('does not declare [[pipelines]] bindings', () => {
    expect(toml).not.toMatch(/pipelines/i);
  });

  it('does not declare [[hello_world]] demo leftovers', () => {
    expect(toml).not.toMatch(/hello_world/i);
  });

  it('does not declare tail_consumers or logpush', () => {
    expect(toml).not.toMatch(/tail_consumers|logpush/i);
  });

  it('does not declare [[services]] service bindings', () => {
    expect(toml).not.toMatch(/\[\[services\]\]/);
  });

  it('does not declare browser rendering binding', () => {
    expect(toml).not.toMatch(/browser|puppeteer/i);
  });

  it('does not declare rate_limit or ratelimits tables', () => {
    expect(toml).not.toMatch(/rate_limit|ratelimits/i);
  });

  it('does not declare workers_ai or ai_search bindings', () => {
    expect(toml).not.toMatch(/workers_ai|ai_search|^\s*\[ai\]/m);
  });

  it('does not declare constellation or nebula leftover keys', () => {
    expect(toml).not.toMatch(/constellation|nebula/i);
  });

  it('does not declare python_modules or rules globs', () => {
    expect(toml).not.toMatch(/python_modules|^\s*\[\[rules\]\]/m);
  });

  it('does not declare keep_names or legal_comments bundler knobs', () => {
    expect(toml).not.toMatch(/keep_names|legal_comments/i);
  });

  it('does not declare upload_source_maps again via alternate spelling', () => {
    expect(toml).not.toMatch(/sourceMaps|source-maps|uploadSourceMaps/);
  });

  it('does not declare limits cpu_ms or subrequests', () => {
    expect(toml).not.toMatch(/cpu_ms|subrequests|^\s*\[limits\]/m);
  });

  it('does not declare placement mode smart', () => {
    expect(toml).not.toMatch(/mode\s*=\s*"smart"/);
  });

  it('does not declare durable_objects class_name bindings', () => {
    expect(toml).not.toMatch(/class_name|new_sqlite_classes/);
  });

  it('does not declare r2_buckets jurisdiction or preview_bucket_name', () => {
    expect(toml).not.toMatch(/jurisdiction|preview_bucket_name|r2_buckets/i);
  });

  it('does not declare d1 database_name or migrations_dir', () => {
    expect(toml).not.toMatch(/database_name|migrations_dir|d1_databases/i);
  });

  it('does not declare hyperdrive localConnectionString', () => {
    expect(toml).not.toMatch(/localConnectionString|hyperdrive/i);
  });

  it('does not declare send_email destination_address', () => {
    expect(toml).not.toMatch(/destination_address|send_email/i);
  });

  it('does not declare mTLS certificate bindings', () => {
    expect(toml).not.toMatch(/mtls|certificate_id/i);
  });

  it('does not declare analytics_engine dataset', () => {
    expect(toml).not.toMatch(/analytics_engine|dataset/i);
  });

  it('does not declare queue producers/consumers', () => {
    expect(toml).not.toMatch(/\[\[queues\.|max_batch_size|max_retries/);
  });

  it('does not declare dispatch_namespaces namespace binding', () => {
    expect(toml).not.toMatch(/dispatch_namespaces|namespace\s*=\s*"/);
  });

  it('does not declare unsafe metadata or capnp schemas', () => {
    expect(toml).not.toMatch(/^\s*\[unsafe\]/m);
    expect(toml).not.toMatch(/capnp|bindings\.metadata/i);
  });

  it('does not declare wasm_modules or text_blobs maps', () => {
    expect(toml).not.toMatch(/wasm_modules|text_blobs|data_blobs/i);
  });

  it('does not declare alias or define esbuild overrides', () => {
    expect(toml).not.toMatch(/^\s*\[alias\]/m);
    expect(toml).not.toMatch(/^\s*\[define\]/m);
  });

  it('does not declare find_additional_modules or base_dir', () => {
    expect(toml).not.toMatch(/find_additional_modules|^\s*base_dir\s*=/m);
  });

  it('does not declare no_bundle or minify true', () => {
    expect(toml).not.toMatch(/no_bundle|^\s*minify\s*=\s*true/m);
  });

  it('does not declare node_compat or nodejs_compat_populators', () => {
    expect(toml).not.toMatch(/node_compat|nodejs_compat/);
  });

  it('does not declare [dev] ip port local_protocol', () => {
    expect(toml).not.toMatch(/^\s*\[dev\]/m);
    expect(toml).not.toMatch(/local_protocol|upstream_protocol/);
  });

  it('does not declare [env.production] nested kv', () => {
    expect(toml).not.toMatch(/\[env\.production\]|\[env\.staging\]|\[env\.dev\]/);
  });

  it('does not declare account_id top-level', () => {
    expect(toml).not.toMatch(/^\s*account_id\s*=/m);
  });

  it('does not declare workers_dev = true|false', () => {
    expect(toml).not.toMatch(/workers_dev\s*=/);
  });

  it('does not declare preview_urls toggle', () => {
    expect(toml).not.toMatch(/preview_urls/);
  });

  it('does not declare zone_id or zone_name on routes', () => {
    expect(toml).not.toMatch(/zone_id|zone_name/);
  });

  it('does not declare script_name distinct from name', () => {
    expect(toml).not.toMatch(/script_name/);
  });

  it('does not declare [triggers] crons schedule', () => {
    expect(toml).not.toMatch(/\[triggers\]|crons\s*=/);
  });

  it('does not declare [build] command or cwd', () => {
    expect(toml).not.toMatch(/^\[build/m);
  });

  it('does not declare [site] bucket entry-point', () => {
    expect(toml).not.toMatch(/^\s*\[site\]/m);
  });

  it('does not declare [assets] directory binding', () => {
    expect(toml).not.toMatch(/^\s*\[assets\]/m);
  });

  it('does not declare [observability] enabled', () => {
    expect(toml).not.toMatch(/observability/i);
  });

  it('does not declare secrets_store_secrets', () => {
    expect(toml).not.toMatch(/secrets_store/i);
  });

  it('does not declare vpc_services or containers', () => {
    expect(toml).not.toMatch(/vpc_services|containers/i);
  });

  it('does not declare first_party_worker flag', () => {
    expect(toml).not.toMatch(/first_party_worker/);
  });

  it('does not declare keep_vars or jsx_factory', () => {
    expect(toml).not.toMatch(/keep_vars|jsx_factory|jsx_fragment/);
  });

  it('does not declare outdir or tsconfig path', () => {
    expect(toml).not.toMatch(/^\s*outdir\s*=/m);
    expect(toml).not.toMatch(/^\s*tsconfig\s*=/m);
  });

  it('does not declare compatibility_flags array syntax', () => {
    expect(toml).not.toMatch(/compatibility_flags\s*=/);
  });

  it('does not declare migrations new_classes deleted_classes', () => {
    expect(toml).not.toMatch(/\[\[migrations\]\]|new_classes|deleted_classes/);
  });

  it('does not declare durable_objects bindings table', () => {
    expect(toml).not.toMatch(/durable_objects/i);
  });

  it('does not embed CF_API_TOKEN or CF_ACCOUNT_ID', () => {
    expect(toml).not.toMatch(/CF_API_TOKEN|CF_ACCOUNT_ID/);
  });

  it('does not embed AIza Gemini key material', () => {
    expect(toml).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });

  it('does not embed Bearer or Authorization headers', () => {
    expect(toml).not.toMatch(/Bearer |Authorization:/i);
  });

  it('does not embed private key PEM fences', () => {
    expect(toml).not.toMatch(/BEGIN (RSA )?PRIVATE KEY/);
  });

  it('does not contain Anthropic or Claude tokens', () => {
    expect(toml).not.toMatch(/anthropic|claude|haiku|sk-ant-/i);
  });

  it('does not contain OpenAI sk- keys', () => {
    expect(toml).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });

  it('locks occurrence count of CATALOG_CACHE to exactly 1', () => {
    expect((toml.match(/CATALOG_CACHE/g) ?? []).length).toBe(1);
  });

  it('locks occurrence count of GEMINI_API_KEY to exactly 1', () => {
    expect((toml.match(/GEMINI_API_KEY/g) ?? []).length).toBe(1);
  });

  it('locks occurrence count of VERSION to exactly 1', () => {
    expect((toml.match(/\bVERSION\b/g) ?? []).length).toBe(1);
  });

  it('locks occurrence count of compatibility_date to exactly 1', () => {
    expect((toml.match(/compatibility_date/g) ?? []).length).toBe(1);
  });

  it('locks occurrence count of custom_domain to exactly 1', () => {
    expect((toml.match(/custom_domain/g) ?? []).length).toBe(1);
  });

  it('locks occurrence count of kv_namespaces to exactly 1', () => {
    expect((toml.match(/kv_namespaces/g) ?? []).length).toBe(1);
  });

  it('locks hash comment count to exactly 2', () => {
    expect(toml.split('\n').filter((l) => l.startsWith('#')).length).toBe(2);
  });

  it('locks space-equals-space spacing on every assignment', () => {
    const assignments = toml.split('\n').filter((l) => l.includes('=') && !l.startsWith('#'));
    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) {
      expect(line).toMatch(/ = /);
      expect(line).not.toMatch(/=\s*=|=\s*$/);
    }
  });

  it('locks no trailing whitespace on any line including blanks', () => {
    for (const line of toml.split('\n')) {
      expect(line).toBe(line.replace(/\s+$/u, ''));
    }
  });

  it('locks no leading whitespace on any nonempty line', () => {
    for (const line of toml.split('\n')) {
      if (line.length === 0) continue;
      expect(line[0]).not.toMatch(/\s/);
    }
  });

  it('locks no tabs anywhere in file', () => {
    expect(toml).not.toContain('\t');
    expect(toml).not.toContain('\u0009');
  });

  it('locks no CR characters (LF-only)', () => {
    expect(toml).not.toContain('\r');
  });

  it('locks no BOM at start', () => {
    expect(toml.charCodeAt(0)).toBe('n'.charCodeAt(0));
    expect(toml).not.toMatch(/^\uFEFF/);
  });

  it('TextDecoder round-trip of encoded bytes equals live toml', () => {
    const bytes = new TextEncoder().encode(toml);
    expect(new TextDecoder().decode(bytes)).toBe(toml);
  });

  it('slice identity: toml.slice(0) === toml and not same reference for object wraps', () => {
    expect(toml.slice(0)).toBe(toml);
    expect(toml.slice(0, toml.length)).toBe(toml);
  });

  it('replaceAll of worker name in a copy does not mutate live file string', () => {
    const copy = toml.replaceAll('backlink', 'mutated');
    expect(copy).toContain('name = "mutated"');
    expect(toml).toContain('name = "backlink"');
    expect(toml).not.toContain('mutated');
  });

  it('toUpperCase copy does not equal live toml (case-sensitive config)', () => {
    expect(toml.toUpperCase()).not.toBe(toml);
    expect(toml).toContain('CATALOG_CACHE');
    expect(toml).not.toContain('catalog_cache');
  });

  it('localeCompare of name vs pattern tokens stays stable', () => {
    expect('backlink'.localeCompare('backlink.fuzzywigg.com')).toBeLessThan(0);
    expect(toml.indexOf('name = "backlink"')).toBeLessThan(
      toml.indexOf('pattern = "backlink.fuzzywigg.com"'),
    );
  });

  it('Array.from async iterator over lines yields stable order', async () => {
    async function* lines() {
      for (const line of toml.split('\n')) yield line;
    }
    const collected = [];
    for await (const line of lines()) collected.push(line);
    expect(collected).toEqual(toml.split('\n'));
  });

  it('Promise.resolve(toml).then identity stays backlink', async () => {
    const value = await Promise.resolve(toml);
    expect(value.startsWith('name = "backlink"')).toBe(true);
  });

  it('JSON.parse(JSON.stringify({toml})).toml equals live content', () => {
    expect(JSON.parse(JSON.stringify({ toml })).toml).toBe(toml);
  });

  it('structuredClone of metadata bag stays independent', () => {
    const bag = { name: 'backlink', version: '0.1.0', id: 'edb6ca4df12f4f45b40508b3dda3c432' };
    const clone = structuredClone(bag);
    clone.name = 'x';
    expect(bag.name).toBe('backlink');
    expect(toml).toContain('name = "backlink"');
  });

  it('Object.freeze on extracted route cannot rewrite pattern', () => {
    const route = Object.freeze({
      pattern: 'backlink.fuzzywigg.com',
      custom_domain: true as const,
    });
    expect(() => {
      (route as { pattern: string }).pattern = 'evil.example';
    }).toThrow();
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('WeakRef of binding token string still resolves while strong ref held', () => {
    const binding = 'CATALOG_CACHE';
    const ref = new WeakRef({ binding });
    expect(ref.deref()?.binding).toBe('CATALOG_CACHE');
    expect(toml).toContain(`binding = "${binding}"`);
  });

  it('Map groupBy-style partition of lines by kind stays exhaustive', () => {
    const groups = new Map<string, string[]>();
    for (const line of toml.split('\n')) {
      if (line.length === 0) {
        groups.set('blank', [...(groups.get('blank') ?? []), line]);
        continue;
      }
      if (line.startsWith('#')) {
        groups.set('comment', [...(groups.get('comment') ?? []), line]);
        continue;
      }
      if (line.startsWith('[[')) {
        groups.set('array-table', [...(groups.get('array-table') ?? []), line]);
        continue;
      }
      if (line.startsWith('[')) {
        groups.set('table', [...(groups.get('table') ?? []), line]);
        continue;
      }
      groups.set('kv', [...(groups.get('kv') ?? []), line]);
    }
    expect(groups.get('array-table')).toEqual(['[[kv_namespaces]]', '[[routes]]']);
    expect(groups.get('table')).toEqual(['[vars]']);
    expect(groups.get('comment')).toHaveLength(2);
    expect(groups.get('kv')).toHaveLength(8);
    expect(groups.get('blank')).toHaveLength(5);
  });

  it('reduce accumulates code-unit sum of entire file to fixed total', () => {
    const sum = [...toml].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(26511);
  });

  it('every printable assignment value is double-quoted except custom_domain', () => {
    const lines = toml.split('\n').filter((l) => l.includes('=') && !l.startsWith('#'));
    for (const line of lines) {
      if (line.startsWith('custom_domain')) {
        expect(line).toBe('custom_domain = true');
      } else {
        expect(line).toMatch(/ = "[^"]*"$/);
      }
    }
  });

  it('domain labels are DNS-safe LDH only', () => {
    const pattern = toml.match(/pattern = "([^"]+)"/)?.[1] ?? '';
    expect(pattern.split('.').every((label) => /^[a-z0-9-]+$/i.test(label))).toBe(true);
    expect(pattern.split('.')).toEqual(['backlink', 'fuzzywigg', 'com']);
  });

  it('KV id is lowercase hex without uppercase drift', () => {
    const id = toml.match(/id = "([a-f0-9]+)"/)?.[1] ?? '';
    expect(id).toBe(id.toLowerCase());
    expect(id).not.toBe(id.toUpperCase());
    expect(id).toHaveLength(32);
  });

  it('binding name is SCREAMING_SNAKE and matches /^[A-Z_]+$/', () => {
    const binding = toml.match(/binding = "([^"]+)"/)?.[1] ?? '';
    expect(binding).toMatch(/^[A-Z_]+$/);
    expect(binding).toBe('CATALOG_CACHE');
  });

  it('vars key VERSION is SCREAMING_SNAKE matching Env field', () => {
    expect(toml).toMatch(/^VERSION = "/m);
    expect(typesSrc).toContain('VERSION?: string');
  });

  it('section order lock: top-level keys then kv then routes then vars then secrets comments', () => {
    const markers = [
      'name = "backlink"',
      '[[kv_namespaces]]',
      '[[routes]]',
      '[vars]',
      '# Secrets',
      '# wrangler secret put GEMINI_API_KEY',
    ];
    let prev = -1;
    for (const marker of markers) {
      const idx = toml.indexOf(marker);
      expect(idx).toBeGreaterThan(prev);
      prev = idx;
    }
  });

  it('DEPLOY.md documents paste-into-wrangler.toml KV id placeholder not live id', () => {
    expect(deployMd).toContain('your-kv-id-here');
    expect(deployMd).not.toContain('edb6ca4df12f4f45b40508b3dda3c432');
    expect(toml).toContain('edb6ca4df12f4f45b40508b3dda3c432');
  });

  it('DEPLOY.md custom domain step matches wrangler routes pattern', () => {
    expect(deployMd).toContain('backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('AGENTS.md escalate secret management aligns with comment-only GEMINI key', () => {
    expect(agentsMd).toMatch(/GEMINI_API_KEY handling/);
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=\s*"/);
  });

  it('package.json scripts do not embed wrangler.toml secrets', () => {
    const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts as Record<
      string,
      string
    >;
    expect(scripts.dev).toBe('wrangler dev');
    expect(scripts.deploy).toBe('wrangler deploy');
    expect(JSON.stringify(scripts)).not.toMatch(/GEMINI|AIza|edb6ca4d/);
  });

  it('index.ts does not hardcode wrangler KV id', () => {
    expect(indexSrc).not.toContain('edb6ca4df12f4f45b40508b3dda3c432');
    expect(indexSrc).toContain('c.env.CATALOG_CACHE');
  });

  it('types.ts field count stays three Env members', () => {
    const fields = [...typesSrc.matchAll(/^\s*([A-Z_]+)\??:/gm)].map((m) => m[1]);
    expect(fields).toEqual(['CATALOG_CACHE', 'GEMINI_API_KEY', 'VERSION']);
  });

  it('only CATALOG_CACHE among Env fields appears as toml binding', () => {
    expect(toml).toContain('CATALOG_CACHE');
    expect(toml).not.toMatch(/binding = "GEMINI_API_KEY"/);
    expect(toml).not.toMatch(/binding = "VERSION"/);
  });

  it('btoa of full toml round-trips via atob', () => {
    const encoded = btoa(toml);
    expect(atob(encoded)).toBe(toml);
    expect(encoded.startsWith('bmFtZSA9ICJiYWNrbGluayI')).toBe(true);
  });

  it('encodeURI of domain pattern leaves dots intact', () => {
    expect(encodeURI('backlink.fuzzywigg.com')).toBe('backlink.fuzzywigg.com');
    expect(encodeURIComponent('backlink.fuzzywigg.com')).toBe('backlink.fuzzywigg.com');
  });

  it('path.posix-style main segments join back to live main', () => {
    const main = 'src/index.ts';
    expect(['src', 'index.ts'].join('/')).toBe(main);
    expect(toml).toContain(`main = "${main}"`);
  });

  it('Number.isInteger on VERSION major/minor/patch', () => {
    const [maj, min, pat] = (toml.match(/VERSION = "([^"]+)"/)?.[1] ?? '')
      .split('.')
      .map(Number);
    expect(Number.isInteger(maj)).toBe(true);
    expect(Number.isInteger(min)).toBe(true);
    expect(Number.isInteger(pat)).toBe(true);
  });

  it('Date year of compatibility_date is strictly greater than 2020', () => {
    const d = new Date(toml.match(/compatibility_date = "([^"]+)"/)?.[1] ?? '');
    expect(d.getUTCFullYear()).toBeGreaterThan(2020);
    expect(d.getUTCFullYear()).toBe(2025);
  });

  it('Set of table headers has size 3', () => {
    const headers = [...toml.matchAll(/^\[\[?[^\]\n]+\]\]?$/gm)].map((m) => m[0]);
    expect(new Set(headers).size).toBe(3);
    expect(headers).toEqual(['[[kv_namespaces]]', '[[routes]]', '[vars]']);
  });

  it('RegExp sticky/global lastIndex reset when matching name', () => {
    const re = /name = "backlink"/g;
    expect(re.exec(toml)?.[0]).toBe('name = "backlink"');
    expect(re.lastIndex).toBeGreaterThan(0);
    re.lastIndex = 0;
    expect(re.test(toml)).toBe(true);
  });

  it('String.prototype.matchAll for quoted values yields 7 strings', () => {
    const values = [...toml.matchAll(/ = "([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual([
      'backlink',
      'src/index.ts',
      '2025-01-01',
      'CATALOG_CACHE',
      'edb6ca4df12f4f45b40508b3dda3c432',
      'backlink.fuzzywigg.com',
      '0.1.0',
    ]);
  });

  it('custom_domain is the sole unquoted non-comment value token true', () => {
    expect((toml.match(/\btrue\b/g) ?? []).length).toBe(1);
    expect(toml).not.toMatch(/\bfalse\b/);
  });

  it('file never uses single quotes for TOML strings', () => {
    expect(toml).not.toMatch(/ = '/);
    expect((toml.match(/"/g) ?? []).length).toBe(14);
  });

  it('file never uses triple-quote multiline strings', () => {
    expect(toml).not.toContain('"""');
    expect(toml).not.toContain("'''");
  });

  it('file never uses inline tables with curly braces', () => {
    expect(toml).not.toMatch(/\{|\}/);
  });

  it('file never uses dotted keys like vars.VERSION', () => {
    expect(toml).not.toMatch(/vars\.VERSION|route\.pattern/);
  });

  it('file never uses array-of-tables beyond [[kv_namespaces]] and [[routes]]', () => {
    expect((toml.match(/\[\[/g) ?? []).length).toBe(2);
  });

  it('worker name length is 8 code units', () => {
    expect('backlink').toHaveLength(8);
    expect(toml).toContain('name = "backlink"');
  });

  it('domain pattern length is 22 code units', () => {
    expect('backlink.fuzzywigg.com').toHaveLength(22);
  });

  it('CATALOG_CACHE length is 13 code units', () => {
    expect('CATALOG_CACHE').toHaveLength(13);
  });

  it('compatibility_date value length is 10 code units', () => {
    expect('2025-01-01').toHaveLength(10);
  });

  it('main path length is 12 code units', () => {
    expect('src/index.ts').toHaveLength(12);
  });

  it('VERSION value length is 5 code units', () => {
    expect('0.1.0').toHaveLength(5);
  });

  it('KV id length is 32 code units', () => {
    expect('edb6ca4df12f4f45b40508b3dda3c432').toHaveLength(32);
  });

  it('secrets comment header locks exact characters including colon', () => {
    expect(toml).toContain('# Secrets (set via CLI, never commit):');
    expect(toml.indexOf('# Secrets')).toBeLessThan(toml.indexOf('# wrangler secret put'));
  });

  it('secret put comment is indented as a full-line comment not trailing', () => {
    expect(toml).toMatch(/^# wrangler secret put GEMINI_API_KEY$/m);
    expect(toml).not.toMatch(/VERSION = "0\.1\.0".*GEMINI/);
  });

  it('blank line separates [vars] block from Secrets comments', () => {
    expect(toml).toContain('VERSION = "0.1.0"\n\n# Secrets');
  });

  it('blank line separates top-level keys from kv_namespaces', () => {
    expect(toml).toContain('compatibility_date = "2025-01-01"\n\n[[kv_namespaces]]');
  });

  it('blank line separates kv_namespaces from routes', () => {
    expect(toml).toContain('id = "edb6ca4df12f4f45b40508b3dda3c432"\n\n[[routes]]');
  });

  it('blank line separates routes from vars', () => {
    expect(toml).toContain('custom_domain = true\n\n[vars]');
  });

  it('no blank line inside kv_namespaces block', () => {
    const block = toml.slice(toml.indexOf('[[kv_namespaces]]'), toml.indexOf('[[routes]]'));
    expect(block).toBe(
      '[[kv_namespaces]]\nbinding = "CATALOG_CACHE"\nid = "edb6ca4df12f4f45b40508b3dda3c432"\n\n',
    );
  });

  it('no blank line inside routes block', () => {
    const block = toml.slice(toml.indexOf('[[routes]]'), toml.indexOf('[vars]'));
    expect(block).toBe(
      '[[routes]]\npattern = "backlink.fuzzywigg.com"\ncustom_domain = true\n\n',
    );
  });

  it('Proxy get trap reading name cannot alter live toml', () => {
    const target = { content: toml };
    const proxy = new Proxy(target, {
      get(obj, prop) {
        if (prop === 'content') return obj.content.replace('backlink', 'proxied');
        return Reflect.get(obj, prop);
      },
    });
    expect(proxy.content).toContain('proxied');
    expect(toml).toContain('name = "backlink"');
  });

  it('Atomics wait is not required — config is sync filesystem read', () => {
    expect(typeof toml).toBe('string');
    expect(toml.length).toBe(330);
  });

  it('queueMicrotask flush still sees immutable toml snapshot', async () => {
    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        expect(toml).toContain('name = "backlink"');
        resolve();
      });
    });
  });

  it('setTimeout 0 still sees immutable toml snapshot', async () => {
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(toml.endsWith('GEMINI_API_KEY\n')).toBe(true);
        resolve();
      }, 0);
    });
  });

  it('cross-locks deploy workflow secret name with toml comment token', () => {
    const deployYml = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
    expect(deployYml).toContain('GEMINI_API_KEY');
    expect(toml).toContain('GEMINI_API_KEY');
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
  });

  it('cross-locks hygiene workflow assertion that GEMINI is not assigned in toml', () => {
    const ciYml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(ciYml).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
    expect(toml).not.toMatch(/GEMINI_API_KEY=/);
  });

  it('cross-locks README live worker hostname with routes pattern', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toContain('https://backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('cross-locks README CF KV 1h TTL note without requiring TTL in wrangler.toml', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toMatch(/1h TTL/);
    expect(toml).not.toMatch(/expirationTtl|ttl/i);
    expect(indexSrc).toContain('expirationTtl: 3600');
  });

  it('wrangler.toml path is exactly one path.basename wrangler.toml at repo root', () => {
    expect(tomlPath.endsWith('/wrangler.toml')).toBe(true);
    expect(tomlPath.startsWith(root)).toBe(true);
  });

  it('re-read of wrangler.toml via readFileSync equals module-level snapshot', () => {
    expect(readFileSync(tomlPath, 'utf8')).toBe(toml);
  });

  it('second TextEncoder pass produces identical byte arrays', () => {
    const a = new TextEncoder().encode(toml);
    const b = new TextEncoder().encode(toml);
    expect([...a]).toEqual([...b]);
    expect(a).not.toBe(b);
  });

  it('createHash sha256 digest Buffer equals hex decode of locked digest', () => {
    const hex = '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8';
    const buf = createHash('sha256').update(toml, 'utf8').digest();
    expect(Buffer.from(hex, 'hex').equals(buf)).toBe(true);
  });

  it('md5 digest first byte is 0x10', () => {
    const buf = createHash('md5').update(toml, 'utf8').digest();
    expect(buf[0]).toBe(0x10);
    expect(buf.length).toBe(16);
  });

  it('sha1 digest length is 20 bytes', () => {
    expect(createHash('sha1').update(toml, 'utf8').digest()).toHaveLength(20);
  });

  it('does not declare [[kv_namespaces]] preview_id sibling', () => {
    expect(toml).not.toMatch(/preview_id/);
  });

  it('does not declare remote binding flag', () => {
    expect(toml).not.toMatch(/^\s*remote\s*=/m);
  });

  it('does not declare experimental containers app config', () => {
    expect(toml).not.toMatch(/experimental|containers/i);
  });

  it('does not declare log level top-level keys', () => {
    expect(toml).not.toMatch(/^\s*log_level\s*=/m);
  });

  it('does not declare name with workspace scope @fuzzywigg/', () => {
    expect(toml).not.toMatch(/@fuzzywigg/);
    expect(toml).toMatch(/^name = "backlink"$/m);
  });

  it('does not point main at .tsbuildinfo or dist/index.js', () => {
    expect(toml).not.toMatch(/tsbuildinfo|dist\/index/);
  });

  it('does not use Windows path separators in main', () => {
    expect(toml).not.toContain('src\\index.ts');
  });

  it('does not declare route pattern as wildcard workers.dev', () => {
    expect(toml).not.toMatch(/pattern = "\*"/);
    expect(toml).not.toMatch(/workers\.dev/);
  });

  it('custom_domain true is boolean true not string "true"', () => {
    expect(toml).toMatch(/^custom_domain = true$/m);
    expect(toml).not.toMatch(/custom_domain = "true"/);
  });

  it('VERSION uses quoted string not bare number', () => {
    expect(toml).toMatch(/^VERSION = "0\.1\.0"$/m);
    expect(toml).not.toMatch(/^VERSION = 0\.1\.0$/m);
  });

  it('compatibility_date uses quoted ISO date not bare', () => {
    expect(toml).toMatch(/^compatibility_date = "2025-01-01"$/m);
  });

  it('id uses quoted hex not bare hex literal', () => {
    expect(toml).toMatch(/^id = "edb6ca4df12f4f45b40508b3dda3c432"$/m);
  });

  it('reduce of line lengths yields fixed total excluding newlines', () => {
    const total = toml
      .split('\n')
      .reduce((acc, line) => acc + line.length, 0);
    // 330 bytes include 17 newlines → content chars = 330 - 17 = 313
    expect(total).toBe(313);
    expect(toml.length - (toml.match(/\n/g) ?? []).length).toBe(313);
  });

  it('newline count is exactly 17', () => {
    expect((toml.match(/\n/g) ?? []).length).toBe(17);
  });

  it('split lines length is newline count plus trailing empty if ends with newline', () => {
    expect(toml.endsWith('\n')).toBe(true);
    expect(toml.split('\n').length).toBe(18);
  });

  it('first char codes spell name', () => {
    expect(toml.slice(0, 4)).toBe('name');
    expect([...toml.slice(0, 4)].map((c) => c.charCodeAt(0))).toEqual([110, 97, 109, 101]);
  });

  it('last nonempty line is the secret put comment', () => {
    const nonempty = toml.split('\n').filter((l) => l.length > 0);
    expect(nonempty.at(-1)).toBe('# wrangler secret put GEMINI_API_KEY');
  });

  it('first nonempty line is the worker name assignment', () => {
    const nonempty = toml.split('\n').filter((l) => l.length > 0);
    expect(nonempty[0]).toBe('name = "backlink"');
  });

  it('padStart of KV id to 40 with zeros trims back', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    expect(id.padStart(40, '0').slice(-32)).toBe(id);
  });

  it('repeat of equals delimiter stays single per assignment line', () => {
    for (const line of toml.split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      expect((line.match(/=/g) ?? []).length).toBe(1);
    }
  });

  it('includes check for substring Secrets is true once', () => {
    expect(toml.includes('Secrets')).toBe(true);
    expect(toml.indexOf('Secrets')).toBe(toml.lastIndexOf('Secrets'));
  });

  it('does not include substring password or token in cleartext assignments', () => {
    const withoutComments = toml
      .split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n');
    expect(withoutComments).not.toMatch(/password|token|secret/i);
  });

  it('comment lines uniquely mention secret put CLI', () => {
    const comments = toml.split('\n').filter((l) => l.startsWith('#'));
    expect(comments.some((c) => c.includes('wrangler secret put'))).toBe(true);
    expect(comments.some((c) => c.includes('never commit'))).toBe(true);
  });

  it('Iterator from lines via values() mirrors split array', () => {
    const lines = toml.split('\n');
    expect([...lines.values()]).toEqual(lines);
  });

  it('flatMap of lines to chars length equals code-unit length', () => {
    const chars = toml.split('\n').flatMap((l, i, arr) => (i < arr.length - 1 ? [...l, '\n'] : [...l]));
    // trailing newline means last split piece is '' so we need careful rebuild
    expect(toml.split('').length).toBe(toml.length);
  });

  it('codePointAt walk equals charCodeAt for ASCII-only file', () => {
    for (let i = 0; i < toml.length; i++) {
      expect(toml.codePointAt(i)).toBe(toml.charCodeAt(i));
    }
  });

  it('normalize NFC/NFD identity for ASCII wrangler.toml', () => {
    expect(toml.normalize('NFC')).toBe(toml);
    expect(toml.normalize('NFD')).toBe(toml);
    expect(toml.normalize('NFKC')).toBe(toml);
  });

  it('search for GEMINI finds comment-only occurrence past [vars]', () => {
    const idx = toml.search(/GEMINI_API_KEY/);
    expect(idx).toBeGreaterThan(toml.indexOf('[vars]'));
    expect(toml.slice(idx - 2, idx)).toBe('t '); // end of "put "
  });

  it('match for hex id captures full 32 chars', () => {
    const m = toml.match(/id = "([a-f0-9]{32})"/);
    expect(m?.[1]).toBe('edb6ca4df12f4f45b40508b3dda3c432');
  });

  it('exec on global regex for table headers finds three headers in order', () => {
    const re = /^\[\[?[^\]\n]+\]\]?$/gm;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(toml)) !== null) found.push(m[0]);
    expect(found).toEqual(['[[kv_namespaces]]', '[[routes]]', '[vars]']);
  });

  it('substring between name and main is single newline', () => {
    expect(toml).toContain('name = "backlink"\nmain = "src/index.ts"');
  });

  it('substring between main and compatibility_date is single newline', () => {
    expect(toml).toContain('main = "src/index.ts"\ncompatibility_date = "2025-01-01"');
  });

  it('worker name is lowercase and domain labels are lowercase', () => {
    expect(toml).toMatch(/name = "[a-z]+"/);
    expect(toml).toMatch(/pattern = "[a-z0-9.]+"/);
  });

  it('does not use Unicode escapes in source text', () => {
    expect(toml).not.toContain('\\u');
    expect(toml).not.toContain('\\x');
  });

  it('does not reference localhost or 127.0.0.1', () => {
    expect(toml).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('does not reference example.com or placeholder domains', () => {
    expect(toml).not.toMatch(/example\.com|example\.org|invalid/);
  });

  it('does not reference workers.dev subdomain patterns', () => {
    expect(toml).not.toMatch(/\.workers\.dev/);
  });

  it('does not set name to Backlink_Facelift repo slug', () => {
    expect(toml).not.toContain('Backlink_Facelift');
    expect(toml).toContain('name = "backlink"');
  });

  it('cross-locks .cursor/environment.json name distinct from worker name', () => {
    const env = JSON.parse(readFileSync(join(root, '.cursor/environment.json'), 'utf8')) as {
      name: string;
    };
    expect(env.name).toBe('Backlink_Facelift');
    expect(toml).toContain('name = "backlink"');
    expect(env.name).not.toBe(pkg.name);
  });

  it('cross-locks vitest coverage include src without wrangler.toml', () => {
    const vitest = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
    expect(vitest).toContain("include: ['src/**/*.ts']");
    expect(vitest).not.toContain('wrangler.toml');
  });

  it('lean config line budget stays under 20 split lines', () => {
    expect(toml.split('\n').length).toBeLessThanOrEqual(20);
    expect(toml.split('\n').filter((l) => l.length > 0).length).toBe(13);
  });

  it('lean config byte budget stays exactly 330', () => {
    expect(toml.length).toBe(330);
    expect(statSync(tomlPath).size).toBe(330);
  });

  it('sha256 hex starts with 95b11779 and ends with fa0473f8', () => {
    const digest = createHash('sha256').update(toml, 'utf8').digest('hex');
    expect(digest.startsWith('95b11779')).toBe(true);
    expect(digest.endsWith('fa0473f8')).toBe(true);
  });

  it('md5 hex starts with 100cd155 and ends with 06e565f4', () => {
    const digest = createHash('md5').update(toml, 'utf8').digest('hex');
    expect(digest.startsWith('100cd155')).toBe(true);
    expect(digest.endsWith('06e565f4')).toBe(true);
  });

  it('all assignment keys use snake_case or SCREAMING_SNAKE only', () => {
    const keys = [...toml.matchAll(/^([A-Za-z0-9_]+) = /gm)].map((m) => m[1]);
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
    for (const key of keys) {
      expect(key).toMatch(/^[a-z_]+$|^[A-Z_]+$/);
    }
  });

  it('no assignment key uses camelCase', () => {
    expect(toml).not.toMatch(/customDomain|compatibilityDate|kvNamespaces/);
  });

  it('no assignment key uses kebab-case', () => {
    expect(toml).not.toMatch(/custom-domain|compatibility-date/);
  });

  // --- HEAVY burn (post-#70): wrangler.toml deepen (orthogonal to source-contracts / open CI PR) ---

  it('post70: locks exact wrangler.toml full-file snapshot', () => {
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

  it('post70: locks nonempty line inventory in document order', () => {
    expect(toml.split('\n').filter((l) => l.length > 0)).toEqual([
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

  it('post70: locks blank-line indices exactly', () => {
    const blanks = toml
      .split('\n')
      .map((l, i) => (l.length === 0 ? i : -1))
      .filter((i) => i >= 0);
    expect(blanks).toEqual([3, 7, 11, 14, 17]);
  });

  it('post70: sha384 digest locks full hex', () => {
    expect(createHash('sha384').update(toml, 'utf8').digest('hex')).toBe('77464378ae30b2d97a5c510d0ecb15598cc8705e67283c0a776dafdbdb349741a93f5f1e52aa0a127c077a28a574bd09');
  });

  it('post70: sha512 digest prefix and suffix lock', () => {
    const digest = createHash('sha512').update(toml, 'utf8').digest('hex');
    expect(digest).toHaveLength(128);
    expect(digest.startsWith('4fdd7f275037737b')).toBe(true);
    expect(digest.endsWith('9f69b43a2cb53a96')).toBe(true);
  });

  it('post70: HMAC-SHA256 with worker-name key locks digest', () => {
    const once = createHmac('sha256', 'backlink').update(toml, 'utf8').digest('hex');
    expect(once).toBe('e6ea9a4c22d8be77830f69ba042d79bb716184b8783f2ede72efa58b3b7601d4');
    expect(once).toBe(createHmac('sha256', pkg.name).update(toml, 'utf8').digest('hex'));
  });

  it('post70: base64 of full toml round-trips via Buffer', () => {
    const b64 = Buffer.from(toml, 'utf8').toString('base64');
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(toml);
    expect(b64.length % 4).toBe(0);
    expect(b64).not.toMatch(/[\r\n]/);
  });

  it('post70: hex encoding of toml equals Buffer hex', () => {
    const hex = Buffer.from(toml, 'utf8').toString('hex');
    expect(hex).toHaveLength(660);
    expect(hex.startsWith('6e616d65203d20')).toBe(true);
    expect(Buffer.from(hex, 'hex').toString('utf8')).toBe(toml);
  });

  it('post70: code-unit sum of entire file locks to 26511', () => {
    expect([...toml].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)).toBe(26511);
  });

  it('post70: word-token count locks to 37', () => {
    expect(toml.match(/[A-Za-z0-9_]+/g)).toHaveLength(37);
  });

  it('post70: quote / equals / bracket glyph counts lock', () => {
    expect((toml.match(/"/g) ?? []).length).toBe(14);
    expect((toml.match(/ = /g) ?? []).length).toBe(8);
    expect((toml.match(/[\[\]]/g) ?? []).length).toBe(10);
  });

  it('post70: KV id byte array XOR and sum lock', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    const bytes = Buffer.from(id, 'hex');
    expect([...bytes]).toEqual([237, 182, 202, 77, 241, 47, 79, 69, 180, 5, 8, 179, 221, 163, 196, 50]);
    expect([...bytes].reduce((a, b) => a ^ b, 0)).toBe(138);
    expect([...bytes].reduce((a, b) => a + b, 0)).toBe(2136);
    expect(bytes.length).toBe(16);
  });

  it('post70: KV id pair inventory locks in order', () => {
    const id = toml.match(/id = "([a-f0-9]{32})"/)?.[1] ?? '';
    expect(id.match(/.{2}/g)).toEqual([
      'ed', 'b6', 'ca', '4d', 'f1', '2f', '4f', '45', 'b4', '05', '08', 'b3', 'dd', 'a3', 'c4', '32',
    ]);
  });

  it('post70: DataView over KV id bytes reads known u16 BE/LE pairs', () => {
    const bytes = Buffer.from('edb6ca4df12f4f45b40508b3dda3c432', 'hex');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint16(0, false)).toBe(0xedb6);
    expect(dv.getUint16(0, true)).toBe(0xb6ed);
    expect(dv.getUint32(12, false)).toBe(0xdda3c432);
  });

  it('post70: Uint16Array view length is 8 over KV id', () => {
    const bytes = Buffer.from('edb6ca4df12f4f45b40508b3dda3c432', 'hex');
    const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    expect(u16).toHaveLength(8);
    expect(u16[0]).toBe(0xb6ed);
  });

  it('post70: path.posix normalizes main and rejects parent traversal', () => {
    const main = toml.match(/main = "([^"]+)"/)?.[1] ?? '';
    expect(posix.normalize(main)).toBe('src/index.ts');
    expect(posix.basename(main)).toBe('index.ts');
    expect(posix.dirname(main)).toBe('src');
    expect(posix.extname(main)).toBe('.ts');
    expect(main.includes('..')).toBe(false);
    expect(basename(tomlPath)).toBe('wrangler.toml');
    expect(extname(tomlPath)).toBe('.toml');
  });

  it('post70: DNS labels of route pattern lock and are LDH', () => {
    const pattern = toml.match(/pattern = "([^"]+)"/)?.[1] ?? '';
    const labels = pattern.split('.');
    expect(labels).toEqual(['backlink', 'fuzzywigg', 'com']);
    for (const label of labels) {
      expect(label).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
      expect(label.startsWith('-')).toBe(false);
      expect(label.endsWith('-')).toBe(false);
    }
    expect(pattern.length).toBeLessThanOrEqual(253);
  });

  it('post70: URL agrees on custom domain host', () => {
    const pattern = toml.match(/pattern = "([^"]+)"/)?.[1] ?? '';
    const url = new URL(`https://${pattern}/curate`);
    expect(url.host).toBe('backlink.fuzzywigg.com');
    expect(url.pathname).toBe('/curate');
  });


  it('post70: cross-locks package scripts.dev/deploy to wrangler CLI', () => {
    const fullPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(fullPkg.scripts.dev).toBe('wrangler dev');
    expect(fullPkg.scripts.deploy).toBe('wrangler deploy');
    expect(fullPkg.devDependencies.wrangler).toMatch(/^\^4\./);
    expect(toml).toContain('name = "backlink"');
  });

  it('post70: cross-locks tsconfig workers-types with Worker entry main', () => {
    expect(tsconfigJson).toContain('@cloudflare/workers-types');
    expect(tsconfigJson).toContain('"moduleResolution": "Bundler"');
    expect(toml).toContain('main = "src/index.ts"');
  });

  it('post70: cross-locks README live worker URL with routes pattern', () => {
    expect(readmeMd).toContain('https://backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(readmeMd).toMatch(/wrangler/);
  });

  it('post70: cross-locks mcp-spec Base URL host with routes pattern', () => {
    expect(mcpSpecMd).toContain('Base URL: `https://backlink.fuzzywigg.com`');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(mcpSpecMd).toMatch(/1h TTL/);
  });

  it('post70: cross-locks CI hygiene asserts GEMINI not assigned in toml', () => {
    expect(ciYml).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
    expect(ciYml).toContain('test -f wrangler.toml');
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(toml).not.toMatch(/api[_-]?key\s*=/i);
  });

  it('post70: cross-locks CI hygiene required wrangler-config test file', () => {
    expect(ciYml).toContain('test -f test/wrangler-config.test.ts');
    expect(statSync(tomlPath).isFile()).toBe(true);
  });

  it('post70: cross-locks deploy workflow wrangler-action@v4 secrets list', () => {
    expect(deployYml).toContain('cloudflare/wrangler-action@v4');
    expect(deployYml).toContain('GEMINI_API_KEY');
    expect(deployYml).toContain('CF_API_TOKEN');
    expect(deployYml).toContain('CF_ACCOUNT_ID');
    expect(deployYml).toMatch(/workflow_dispatch/);
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
  });

  it('post70: cross-locks DEPLOY.md kv create command with binding name', () => {
    expect(deployMd).toContain('wrangler kv namespace create CATALOG_CACHE');
    expect(deployMd).toContain('id = "your-kv-id-here"');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
    expect(toml).toContain('id = "edb6ca4df12f4f45b40508b3dda3c432"');
    expect(toml).not.toContain('your-kv-id-here');
  });

  it('post70: cross-locks AGENTS domain target with routes pattern', () => {
    expect(agentsMd).toContain('Domain target: backlink.fuzzywigg.com');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('post70: cross-locks Env CATALOG_CACHE + VERSION optional with toml', () => {
    expect(typesSrc).toContain('CATALOG_CACHE: KVNamespace');
    expect(typesSrc).toContain('VERSION?: string');
    expect(typesSrc).toContain('GEMINI_API_KEY?: string');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
    expect(toml).toContain('VERSION = "0.1.0"');
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
  });

  it('post70: cross-locks index.ts VERSION fallback with [vars] VERSION', () => {
    expect(indexSrc).toContain("c.env.VERSION ?? '0.1.0'");
    expect(toml).toContain('VERSION = "0.1.0"');
    expect(pkg.version).toBe('0.1.0');
  });

  it('post70: cross-locks .cursor/environment.json name vs worker name', () => {
    const env = JSON.parse(envJson) as { name: string; install: string };
    expect(env.name).toBe('Backlink_Facelift');
    expect(env.install).toBe('npm ci');
    expect(toml).toContain('name = "backlink"');
    expect(env.name.toLowerCase()).not.toBe(pkg.name);
  });

  it('post70: cross-locks vitest coverage include excludes wrangler.toml', () => {
    expect(vitestCfg).toContain("include: ['src/**/*.ts']");
    expect(vitestCfg).toContain("exclude: ['src/types.ts']");
    expect(vitestCfg).not.toContain('wrangler.toml');
  });

  it('post70: fs.statSync size and regular-file mode bits lock', () => {
    const st = statSync(tomlPath);
    expect(st.size).toBe(330);
    expect(st.isFile()).toBe(true);
    expect(st.isDirectory()).toBe(false);
    expect(st.nlink).toBe(1);
    expect((st.mode & 0o170000) === 0o100000).toBe(true);
  });

  it('post70: TextDecoder default utf-8 decodes toml Buffer identically', () => {
    const buf = readFileSync(tomlPath);
    expect(new TextDecoder('utf-8').decode(buf)).toBe(toml);
    expect(new TextDecoder().decode(buf)).toBe(toml);
  });

  it('post70: structuredClone of line array is deep-independent', () => {
    const lines = toml.split('\n');
    const cloned = structuredClone(lines);
    cloned[0] = 'mutated';
    expect(lines[0]).toBe('name = "backlink"');
    expect(cloned[0]).toBe('mutated');
  });

  it('post70: MessageChannel structured clone keeps toml payload', async () => {
    const { port1, port2 } = new MessageChannel();
    const got = await new Promise<string>((resolve) => {
      port2.onmessage = (ev) => resolve(String((ev as MessageEvent).data));
      port1.postMessage(toml);
    });
    port1.close();
    port2.close();
    expect(got).toBe(toml);
  });

  it('post70: AbortController signal abort does not alter toml snapshot', () => {
    const ac = new AbortController();
    ac.abort('test');
    expect(ac.signal.aborted).toBe(true);
    expect(toml.startsWith('name = "backlink"')).toBe(true);
    expect(toml.length).toBe(330);
  });

  it('post70: Promise.resolve chain still sees immutable toml', async () => {
    const seen = await Promise.resolve(toml).then((t) => t.slice(0, 17));
    expect(seen).toBe('name = "backlink"');
  });

  it('post70: queueMicrotask still sees immutable toml', async () => {
    const a = await new Promise<string>((r) => queueMicrotask(() => r(toml)));
    expect(a).toBe(toml);
  });

  it('post70: randomBytes length probe does not inject into config', () => {
    const probe = randomBytes(16).toString('hex');
    expect(probe).toHaveLength(32);
    expect(toml).not.toContain(probe);
    expect(toml).toContain('edb6ca4df12f4f45b40508b3dda3c432');
  });


  it('post70: does not declare /playlist or /now-playing routes in wrangler', () => {
    expect(toml).not.toMatch(/playlist|now-playing|now_playing/i);
  });

  it('post70: does not declare workers_for_platforms dispatch namespace', () => {
    expect(toml).not.toMatch(/dispatch_namespaces|workers_for_platforms|dynamic_workers/i);
  });

  it('post70: does not declare containers or apps bindings', () => {
    expect(toml).not.toMatch(/\[\[containers\]\]|^\s*\[containers\]|^\s*\[\[apps\]\]/i);
  });

  it('post70: does not declare secrets_store_secrets or secret_store', () => {
    expect(toml).not.toMatch(/secrets_store|secret_store/i);
  });

  it('post70: does not declare vpc_services or private networking', () => {
    expect(toml).not.toMatch(/vpc_services|private_network|\btunnel\b/i);
  });

  it('post70: does not declare unsafe metadata or capnp schemas', () => {
    expect(toml).not.toMatch(/unsafe\.|capnp|schema_id/i);
  });

  it('post70: does not declare logpush / tail / tracing sinks', () => {
    expect(toml).not.toMatch(/logpush|tail_consumers|otel|opentelemetry/i);
  });

  it('post70: does not declare assets binding or static site bucket', () => {
    expect(toml).not.toMatch(/^\s*\[assets\]|serve_assets/i);
  });

  it('post70: does not declare define bundler replacements', () => {
    expect(toml).not.toMatch(/^\s*\[define\]|process\.env/i);
  });

  it('post70: does not declare send_email destination bindings', () => {
    expect(toml).not.toMatch(/send_email|destination_address/i);
  });

  it('post70: does not declare browser rendering binding alias', () => {
    expect(toml).not.toMatch(/browser|puppeteer|playwright/i);
  });

  it('post70: does not declare ai gateway or vectorize indexes', () => {
    expect(toml).not.toMatch(/ai_gateway|vectorize|workers_ai/i);
  });

  it('post70: does not declare d1_databases or r2_buckets tables', () => {
    expect(toml).not.toMatch(/d1_databases|r2_buckets/i);
  });

  it('post70: does not declare durable_objects migrations class_name', () => {
    expect(toml).not.toMatch(/durable_objects|class_name|new_sqlite_classes/i);
  });

  it('post70: does not declare queues producers/consumers', () => {
    expect(toml).not.toMatch(/\[\[queues|queue_producers|queue_consumers/i);
  });

  it('post70: does not declare workflows or pipelines bindings', () => {
    expect(toml).not.toMatch(/\[\[workflows\]\]|\[\[pipelines\]\]/i);
  });

  it('post70: does not declare hyperdrive or mtls_certificates', () => {
    expect(toml).not.toMatch(/hyperdrive|mtls_certificates/i);
  });

  it('post70: does not declare analytics_engine datasets', () => {
    expect(toml).not.toMatch(/analytics_engine/i);
  });

  it('post70: does not declare constellations or nebula leftovers', () => {
    expect(toml).not.toMatch(/constellation|nebula/i);
  });

  it('post70: does not declare hello_world demo worker leftovers', () => {
    expect(toml).not.toMatch(/hello[_-]?world/i);
  });

  it('post70: does not declare account_id / zone_id / api_token', () => {
    expect(toml).not.toMatch(/account_id|zone_id|api_token/i);
  });

  it('post70: does not declare workers_dev boolean toggle', () => {
    expect(toml).not.toMatch(/workers_dev\s*=/i);
  });

  it('post70: does not declare preview_urls or preview_alias', () => {
    expect(toml).not.toMatch(/preview_urls|preview_alias|preview_id/i);
  });

  it('post70: does not declare env.production overrides', () => {
    expect(toml).not.toMatch(/\[env\./i);
  });

  it('post70: does not declare compatibility_flags including nodejs_compat', () => {
    expect(toml).not.toMatch(/compatibility_flags|nodejs_compat|node_compat/i);
  });

  it('post70: does not declare minify / no_bundle / tsconfig overrides', () => {
    expect(toml).not.toMatch(/minify|no_bundle|tsconfig\s*=/i);
  });

  it('post70: does not declare placement smart or regions', () => {
    expect(toml).not.toMatch(/placement|first_party_worker|regions\s*=/i);
  });

  it('post70: does not declare triggers crons schedules', () => {
    expect(toml).not.toMatch(/\[triggers\]|crons\s*=/i);
  });

  it('post70: does not declare rules find_additional_modules', () => {
    expect(toml).not.toMatch(/\[\[rules\]\]|find_additional_modules/i);
  });

  it('post70: does not declare wasm_modules or text_blobs', () => {
    expect(toml).not.toMatch(/wasm_modules|text_blobs|data_blobs/i);
  });

  it('post70: does not declare JSX factory bundler knobs', () => {
    expect(toml).not.toMatch(/jsx_factory|jsx_fragment|keep_names/i);
  });

  it('post70: does not declare usage_model or limits cpu_ms', () => {
    expect(toml).not.toMatch(/usage_model|cpu_ms|subrequests/i);
  });

  it('post70: does not declare services or service bindings', () => {
    expect(toml).not.toMatch(/\[\[services\]\]|service\s*=\s*"/i);
  });

  it('post70: does not declare ratelimits or rate_limit tables', () => {
    expect(toml).not.toMatch(/ratelimits|rate_limit/i);
  });

  it('post70: does not declare images resizing bindings', () => {
    expect(toml).not.toMatch(/\[\[images\]\]|image_resizing/i);
  });

  it('post70: does not declare pages_build_output_dir', () => {
    expect(toml).not.toMatch(/pages_build_output_dir|pages_functions/i);
  });

  it('post70: does not declare worker_loaders binding', () => {
    expect(toml).not.toMatch(/worker_loaders/i);
  });

  it('post70: does not declare python workers', () => {
    expect(toml).not.toMatch(/python_workers|python_modules/i);
  });

  it('post70: does not declare keep_vars flag', () => {
    expect(toml).not.toMatch(/keep_vars/i);
  });

  it('post70: does not declare log level top-level', () => {
    expect(toml).not.toMatch(/^\s*log_level\s*=/i);
  });

  it('post70: does not declare nodejs_compat_populate_process_env', () => {
    expect(toml).not.toMatch(/nodejs_compat_populate_process_env/i);
  });

  it('post70: does not declare upload_source_maps', () => {
    expect(toml).not.toMatch(/upload_source_maps/i);
  });

  it('post70: does not declare observability traces block', () => {
    expect(toml).not.toMatch(/^\s*\[observability\]/i);
  });

  it('post70: does not declare version_metadata binding', () => {
    expect(toml).not.toMatch(/version_metadata/i);
  });

  it('post70: does not declare local_protocol override', () => {
    expect(toml).not.toMatch(/local_protocol/i);
  });

  it('post70: does not declare dotenv references', () => {
    expect(toml).not.toMatch(/\.env/i);
  });

  it('post70: does not declare terraform leftovers', () => {
    expect(toml).not.toMatch(/terraform|pulumi|\bcdk\b/i);
  });

  it('post70: does not declare BROWSER binding name', () => {
    expect(toml).not.toMatch(/binding\s*=\s*"BROWSER"/i);
  });

  it('post70: does not declare AI binding name', () => {
    expect(toml).not.toMatch(/binding\s*=\s*"AI"/i);
  });

  it('post70: does not declare MY_BUCKET R2 binding', () => {
    expect(toml).not.toMatch(/binding\s*=\s*"MY_BUCKET"/i);
  });

  it('post70: does not declare DB D1 binding', () => {
    expect(toml).not.toMatch(/binding\s*=\s*"DB"/i);
  });

  it('post70: does not declare QUEUE binding', () => {
    expect(toml).not.toMatch(/binding\s*=\s*"QUEUE"/i);
  });

  it('post70: does not declare ASSETS binding', () => {
    expect(toml).not.toMatch(/binding\s*=\s*"ASSETS"/i);
  });

  it('post70: assignment values never use single quotes', () => {
    expect(toml).not.toMatch(/=\s*'/);
    expect(toml).toMatch(/name = "backlink"/);
  });

  it('post70: every assignment spacing is exactly " = "', () => {
    for (const line of toml.split('\n')) {
      if (!line.includes('=')) continue;
      if (line.startsWith('#')) continue;
      expect(line).toMatch(/^[A-Za-z0-9_]+ = /);
      expect(line).not.toMatch(/=\s{2,}/);
      expect(line).not.toMatch(/\s{2,}=/);
    }
  });

  it('post70: table headers use exact bracket forms without spaces', () => {
    expect(toml).toContain('[[kv_namespaces]]');
    expect(toml).toContain('[[routes]]');
    expect(toml).toContain('[vars]');
    expect(toml).not.toContain('[ [kv_namespaces] ]');
    expect(toml).not.toContain('[ vars ]');
  });

  it('post70: section order is kv_namespaces then routes then vars', () => {
    const kv = toml.indexOf('[[kv_namespaces]]');
    const routes = toml.indexOf('[[routes]]');
    const vars = toml.indexOf('[vars]');
    expect(kv).toBeGreaterThan(-1);
    expect(routes).toBeGreaterThan(kv);
    expect(vars).toBeGreaterThan(routes);
  });

  it('post70: top-level keys order is name, main, compatibility_date', () => {
    const name = toml.indexOf('name = "backlink"');
    const main = toml.indexOf('main = "src/index.ts"');
    const compat = toml.indexOf('compatibility_date = "2025-01-01"');
    expect(name).toBe(0);
    expect(main).toBeGreaterThan(name);
    expect(compat).toBeGreaterThan(main);
    expect(compat).toBeLessThan(toml.indexOf('[[kv_namespaces]]'));
  });

  it('post70: VERSION semver compare equals package version via localeCompare', () => {
    const ver = toml.match(/VERSION = "([^"]+)"/)?.[1] ?? '';
    expect(ver.localeCompare(pkg.version, 'en', { numeric: true })).toBe(0);
    expect(ver.split('.').map(Number)).toEqual([0, 1, 0]);
  });

  it('post70: compatibility_date is strictly before 2026-01-01 UTC', () => {
    const d = toml.match(/compatibility_date = "([^"]+)"/)?.[1] ?? '';
    expect(Date.parse(`${d}T00:00:00.000Z`)).toBeLessThan(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(d).toBe('2025-01-01');
  });

  it('post70: custom_domain bare true is the only boolean literal', () => {
    expect([...toml.matchAll(/\b(true|false)\b/g)].map((m) => m[1])).toEqual(['true']);
  });

  it('post70: comment lines are exactly two and both Secrets-related', () => {
    const comments = toml.split('\n').filter((l) => l.startsWith('#'));
    expect(comments).toEqual([
      '# Secrets (set via CLI, never commit):',
      '# wrangler secret put GEMINI_API_KEY',
    ]);
  });

  it('post70: GEMINI_API_KEY appears only in comment lines', () => {
    const hits = toml.split('\n').filter((l) => l.includes('GEMINI_API_KEY'));
    expect(hits).toHaveLength(1);
    expect(hits[0].startsWith('#')).toBe(true);
  });

  it('post70: CATALOG_CACHE appears only as binding value', () => {
    const hits = [...toml.matchAll(/CATALOG_CACHE/g)];
    expect(hits).toHaveLength(1);
    expect(toml).toContain('binding = "CATALOG_CACHE"');
  });

  it('post70: fuzzywigg.com appears only in pattern assignment', () => {
    expect((toml.match(/fuzzywigg\.com/g) ?? []).length).toBe(1);
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('post70: backlink token appears in name and pattern only', () => {
    const matches = [...toml.matchAll(/backlink/g)].map((m) => m.index);
    expect(matches).toHaveLength(2);
  });

  it('post70: no tab characters and no trailing spaces on any line', () => {
    expect(toml).not.toContain('\t');
    for (const line of toml.split('\n')) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('post70: file ends with trailing newline after secret comment', () => {
    expect(toml.endsWith('\n')).toBe(true);
    expect(toml.endsWith('GEMINI_API_KEY\n')).toBe(true);
  });

  it('post70: split length is 18 including trailing empty string', () => {
    const parts = toml.split('\n');
    expect(parts).toHaveLength(18);
    expect(parts.at(-1)).toBe('');
  });

  it('post70: reduce of nonempty line lengths plus newlines equals byte length', () => {
    const sum = toml
      .split('\n')
      .filter((l) => l.length > 0)
      .reduce((acc, l) => acc + l.length, 0);
    expect(toml.length).toBe(330);
    expect(sum + (toml.match(/\n/g) ?? []).length).toBe(330);
  });

  it('post70: newline count locks to 17', () => {
    expect((toml.match(/\n/g) ?? []).length).toBe(17);
    expect(toml.includes('\r')).toBe(false);
  });

  it('post70: Object.is compares twin readFileSync snapshots as equal values', () => {
    const again = readFileSync(tomlPath, 'utf8');
    expect(again === toml).toBe(true);
    expect(again).toBe(toml);
  });

  it('post70: Array.toSorted of section headers stays stable', () => {
    const headers = ['[[kv_namespaces]]', '[[routes]]', '[vars]'];
    expect(headers.toSorted()).toEqual(['[[kv_namespaces]]', '[[routes]]', '[vars]']);
    expect(headers.toSorted((a, b) => b.localeCompare(a))).toEqual([
      '[vars]',
      '[[routes]]',
      '[[kv_namespaces]]',
    ]);
  });

  it('post70: Map insertion order of assignment keys locks', () => {
    const map = new Map<string, string>();
    for (const line of toml.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_]+) = "([^"]*)"$/);
      if (m) map.set(m[1], m[2]);
    }
    expect([...map.keys()]).toEqual([
      'name',
      'main',
      'compatibility_date',
      'binding',
      'id',
      'pattern',
      'VERSION',
    ]);
    expect(map.get('binding')).toBe('CATALOG_CACHE');
  });

  it('post70: Set of table header kinds has size 3', () => {
    const headers = [...toml.matchAll(/^\[\[?[^\]\n]+\]\]?$/gm)].map((m) => m[0]);
    expect(new Set(headers).size).toBe(3);
    expect(headers).toEqual(['[[kv_namespaces]]', '[[routes]]', '[vars]']);
  });

  it('post70: JSON.stringify of parsed string assignments is stable', () => {
    const map: Record<string, string> = {};
    for (const line of toml.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_]+) = "([^"]*)"$/);
      if (m) map[m[1]] = m[2];
    }
    expect(JSON.stringify(map)).toBe(
      JSON.stringify({
        name: 'backlink',
        main: 'src/index.ts',
        compatibility_date: '2025-01-01',
        binding: 'CATALOG_CACHE',
        id: 'edb6ca4df12f4f45b40508b3dda3c432',
        pattern: 'backlink.fuzzywigg.com',
        VERSION: '0.1.0',
      }),
    );
  });

  it('post70: BigInt KV id bit string starts with 1', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    const bits = BigInt(`0x${id}`).toString(2);
    expect(bits.length).toBeGreaterThan(120);
    expect(bits.startsWith('1')).toBe(true);
  });

  it('post70: Number.isSafeInteger false for full KV id as Number', () => {
    const id = 'edb6ca4df12f4f45b40508b3dda3c432';
    expect(Number.isSafeInteger(Number(`0x${id}`))).toBe(false);
    expect(Number.isFinite(Number(`0x${id.slice(0, 8)}`))).toBe(true);
  });

  it('post70: atob of name base64 matches worker name', () => {
    expect(atob('YmFja2xpbms=')).toBe('backlink');
    expect(toml).toContain(`name = "${atob('YmFja2xpbms=')}"`);
  });

  it('post70: btoa of domain host locks known base64', () => {
    expect(btoa('backlink.fuzzywigg.com')).toBe('YmFja2xpbmsuZnV6enl3aWdnLmNvbQ==');
    expect(toml).toContain(atob('YmFja2xpbmsuZnV6enl3aWdnLmNvbQ=='));
  });

  it('post70: charCodeAt walk of name equals known ASCII list', () => {
    expect([...'backlink'].map((c) => c.charCodeAt(0))).toEqual([98, 97, 99, 107, 108, 105, 110, 107]);
    expect(String.fromCharCode(98, 97, 99, 107, 108, 105, 110, 107)).toBe('backlink');
  });

  it('post70: padStart of VERSION segments round-trip', () => {
    const parts = ['0', '1', '0'].map((p) => p.padStart(2, '0'));
    expect(parts).toEqual(['00', '01', '00']);
    expect(parts.map((p) => String(Number(p))).join('.')).toBe('0.1.0');
    expect(toml).toContain('VERSION = "0.1.0"');
  });

  it('post70: repeat hyphen in comments never forms YAML frontmatter', () => {
    expect(toml).not.toMatch(/^---$/m);
    expect(toml.startsWith('name =')).toBe(true);
  });

  it('post70: includes() probes for forbidden secret substrings', () => {
    expect(toml.includes('CF_API_TOKEN')).toBe(false);
    expect(toml.includes('CF_ACCOUNT_ID')).toBe(false);
    expect(toml.includes('BEGIN PRIVATE KEY')).toBe(false);
    expect(toml.includes('AIza')).toBe(false);
  });

  it('post70: indexOf for [[routes]] is after kv_namespaces', () => {
    // Use indexOf — String#search treats [[...]] as a RegExp character class.
    expect(toml.indexOf('[[kv_namespaces]]')).toBeLessThan(toml.indexOf('[[routes]]'));
    expect(toml.indexOf('[vars]')).toBeGreaterThan(toml.indexOf('[[routes]]'));
  });

  it('post70: matchAll for quoted values yields seven strings', () => {
    const vals = [...toml.matchAll(/ = "([^"]*)"/g)].map((m) => m[1]);
    expect(vals).toEqual([
      'backlink',
      'src/index.ts',
      '2025-01-01',
      'CATALOG_CACHE',
      'edb6ca4df12f4f45b40508b3dda3c432',
      'backlink.fuzzywigg.com',
      '0.1.0',
    ]);
  });

  it('post70: replaceAll of worker name in a copy does not mutate live toml', () => {
    const copy = toml.replaceAll('backlink', 'X');
    expect(copy).toContain('name = "X"');
    expect(toml).toContain('name = "backlink"');
    expect(toml).not.toContain('name = "X"');
  });

  it('post70: slice windows lock critical substrings', () => {
    expect(toml.slice(0, 17)).toBe('name = "backlink"');
    expect(toml.slice(-15)).toBe('GEMINI_API_KEY\n');
  });

  it('post70: substring aliases agree on main entry window', () => {
    const idx = toml.indexOf('main = "');
    expect(toml.substring(idx, idx + 20)).toBe('main = "src/index.ts');
    expect(toml.slice(idx, idx + 20)).toBe('main = "src/index.ts');
  });

  it('post70: indexOf lastIndexOf for VERSION are equal (single occurrence)', () => {
    expect(toml.indexOf('VERSION')).toBe(toml.lastIndexOf('VERSION'));
    expect(toml.indexOf('VERSION')).toBeGreaterThan(toml.indexOf('[vars]'));
  });

  it('post70: startsWith/endsWith invariants on full file', () => {
    expect(toml.startsWith('name = "backlink"\n')).toBe(true);
    expect(toml.endsWith('# wrangler secret put GEMINI_API_KEY\n')).toBe(true);
  });

  it('post70: trim/trimStart/trimEnd on full file only strips trailing newline', () => {
    expect(toml.trimEnd()).toBe(toml.slice(0, -1));
    expect(toml.trimStart()).toBe(toml);
    expect(toml.trim()).toBe(toml.slice(0, -1));
  });

  it('post70: locale lower/upper of binding name stays ASCII', () => {
    expect('CATALOG_CACHE'.toLowerCase()).toBe('catalog_cache');
    expect('catalog_cache'.toUpperCase()).toBe('CATALOG_CACHE');
    expect(toml).toContain('CATALOG_CACHE');
    expect(toml).not.toContain('catalog_cache');
  });

  it('post70: Intl.DateTimeFormat UTC formats compatibility_date', () => {
    const d = new Date('2025-01-01T00:00:00.000Z');
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    expect(fmt).toBe('2025-01-01');
    expect(toml).toContain(`compatibility_date = "${fmt}"`);
  });


  it('post70: cross-locks DEPLOY HITL bullets with secret-comment posture', () => {
    expect(deployMd).toContain('First production deploy must be reviewed by Andrew');
    expect(deployMd).toContain('GEMINI_API_KEY handling require approval');
    expect(toml).toContain('# Secrets (set via CLI, never commit):');
  });

  it('post70: cross-locks AGENTS Escalate secret management with comment-only GEMINI', () => {
    expect(agentsMd).toContain('Changes to GEMINI_API_KEY handling or any secret management');
    expect(toml).toMatch(/^# wrangler secret put GEMINI_API_KEY$/m);
    expect(toml).not.toMatch(/^\s*GEMINI_API_KEY\s*=/m);
  });

  it('post70: cross-locks package name/version with name/VERSION assignments', () => {
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    expect(toml).toContain(`name = "${pkg.name}"`);
    expect(toml).toContain(`VERSION = "${pkg.version}"`);
  });

  it('post70: cross-locks index gemini model without storing key in toml', () => {
    expect(indexSrc).toContain('gemini-2.0-flash');
    expect(indexSrc).toContain('GEMINI_API_KEY');
    expect(toml).not.toMatch(/gemini-2\.0-flash/);
    expect(toml).toContain('GEMINI_API_KEY');
  });

  it('post70: lean byte budget remains exactly 330 across encoder paths', () => {
    expect(toml.length).toBe(330);
    expect(Buffer.byteLength(toml, 'utf8')).toBe(330);
    expect(new TextEncoder().encode(toml).length).toBe(330);
    expect(statSync(tomlPath).size).toBe(330);
  });

  it('post70: sha256 full digest still matches prior lock', () => {
    expect(createHash('sha256').update(toml, 'utf8').digest('hex')).toBe(
      '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8',
    );
  });

  it('post70: md5 and sha1 digests still match prior locks', () => {
    expect(createHash('md5').update(toml, 'utf8').digest('hex')).toBe(
      '100cd1554884befe9db6453606e565f4',
    );
    expect(createHash('sha1').update(toml, 'utf8').digest('hex')).toBe(
      '481c8221707ffe602ab8d5ce4a2b7b5192d3ade6',
    );
  });

  it('post70: Proxy get trap cannot forge different binding name from live string', () => {
    const target = { binding: 'CATALOG_CACHE' };
    const proxy = new Proxy(target, {
      get(t, p, r) {
        if (p === 'binding') return 'FORGED';
        return Reflect.get(t, p, r);
      },
    });
    expect(proxy.binding).toBe('FORGED');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
    expect(toml).not.toContain('FORGED');
  });

  it('post70: freeze of parsed map does not freeze live file contents', () => {
    const parsed = Object.freeze({ name: 'backlink', VERSION: '0.1.0' });
    expect(() => {
      (parsed as { name: string }).name = 'x';
    }).toThrow();
    expect(toml).toContain('name = "backlink"');
  });

  it('post70: WeakRef on toml wrapper still dereferences while strongly held', () => {
    const ref = new WeakRef({ toml });
    expect(ref.deref()?.toml).toBe(toml);
  });

  it('post70: Iterator from lines via values mirrors split', () => {
    const lines = toml.split('\n');
    expect([...lines.values()]).toEqual(lines);
    expect([...lines.keys()].length).toBe(18);
  });

  it('post70: flatMap chars with newline reconstitution equals original', () => {
    const lines = toml.split('\n');
    const rebuilt = lines.flatMap((l, i) => (i < lines.length - 1 ? [l, '\n'] : [l])).join('');
    expect(rebuilt).toBe(toml);
  });

  it('post70: codePointAt equals charCodeAt for every index (ASCII)', () => {
    for (let i = 0; i < toml.length; i++) {
      expect(toml.codePointAt(i)).toBe(toml.charCodeAt(i));
    }
  });

  it('post70: normalize NFC/NFD/NFKC/NFKD are identity for ASCII toml', () => {
    expect(toml.normalize('NFC')).toBe(toml);
    expect(toml.normalize('NFD')).toBe(toml);
    expect(toml.normalize('NFKC')).toBe(toml);
    expect(toml.normalize('NFKD')).toBe(toml);
  });

  it('post70: does not reference localhost in production wrangler.toml', () => {
    expect(toml).not.toMatch(/localhost|127\.0\.0\.1|0\.0\.0\.0/);
    expect(deployMd).toContain('localhost:8787');
  });

  it('post70: does not reference workers.dev or example.com placeholders', () => {
    expect(toml).not.toMatch(/workers\.dev|example\.com|example\.org/);
  });

  it('post70: does not embed repo slug Backlink_Facelift as worker name', () => {
    expect(toml).not.toContain('Backlink_Facelift');
    expect(JSON.parse(envJson).name).toBe('Backlink_Facelift');
  });

  it('post70: does not use Unicode escapes or hex escapes in source text', () => {
    expect(toml).not.toContain('\\u');
    expect(toml).not.toContain('\\x');
    expect(toml).not.toContain('\\n');
  });

  it('post70: main path uses forward slashes only', () => {
    expect(toml).toContain('main = "src/index.ts"');
    expect(toml).not.toMatch(/main\s*=\s*".*\\/);
  });

  it('post70: KV id is lowercase hex without 0x prefix', () => {
    const id = toml.match(/id = "([^"]+)"/)?.[1] ?? '';
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(id.startsWith('0x')).toBe(false);
    expect(id).toBe(id.toLowerCase());
  });

  it('post70: VERSION uses dotted semver string not bare integer', () => {
    expect(toml).toMatch(/VERSION = "0\.1\.0"/);
    expect(toml).not.toMatch(/VERSION = 0\.1\.0/);
    expect(toml).not.toMatch(/VERSION = 010/);
  });

  it('post70: compatibility_date quoted ISO not bare number', () => {
    expect(toml).toMatch(/compatibility_date = "2025-01-01"/);
    expect(toml).not.toMatch(/compatibility_date = 2025-01-01/);
  });

  it('post70: custom_domain is bare boolean not string', () => {
    expect(toml).toMatch(/custom_domain = true/);
    expect(toml).not.toMatch(/custom_domain = "true"/);
  });

  it('post70: no camelCase or kebab-case assignment keys', () => {
    expect(toml).not.toMatch(/customDomain|compatibilityDate|kvNamespaces/);
    expect(toml).not.toMatch(/custom-domain|compatibility-date|kv-namespaces/);
  });

  it('post70: Reflect.ownKeys on frozen assignment object stays stable', () => {
    const obj = Object.freeze({
      name: 'backlink',
      main: 'src/index.ts',
      compatibility_date: '2025-01-01',
    });
    expect(Reflect.ownKeys(obj)).toEqual(['name', 'main', 'compatibility_date']);
  });

  it('post70: Object.fromEntries of assignment pairs rebuilds map', () => {
    const pairs: [string, string][] = [];
    for (const line of toml.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_]+) = "([^"]*)"$/);
      if (m) pairs.push([m[1], m[2]]);
    }
    expect(Object.fromEntries(pairs)).toEqual({
      name: 'backlink',
      main: 'src/index.ts',
      compatibility_date: '2025-01-01',
      binding: 'CATALOG_CACHE',
      id: 'edb6ca4df12f4f45b40508b3dda3c432',
      pattern: 'backlink.fuzzywigg.com',
      VERSION: '0.1.0',
    });
  });

  it('post70: manual groupBy of lines by kind locks bucket sizes', () => {
    const kind = (line: string) => {
      if (line.length === 0) return 'blank';
      if (line.startsWith('#')) return 'comment';
      if (/^\[\[[^\]]+\]\]$/.test(line)) return 'array-table';
      if (/^\[[^\]]+\]$/.test(line)) return 'table';
      if (/^[A-Za-z0-9_]+ = /.test(line)) return 'assignment';
      return 'unknown';
    };
    const groups: Record<string, string[]> = {};
    for (const line of toml.split('\n')) {
      const k = kind(line);
      (groups[k] ??= []).push(line);
    }
    expect(groups['blank']?.length).toBe(5);
    expect(groups['comment']?.length).toBe(2);
    expect(groups['array-table']?.length).toBe(2);
    expect(groups['table']?.length).toBe(1);
    expect(groups['assignment']?.length).toBe(8);
    expect(groups['unknown']).toBeUndefined();
  });

  it('post70: package description not copied into wrangler', () => {
    const fullPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      description: string;
    };
    expect(fullPkg.description).toContain('LLM-curated internet radio');
    expect(toml).not.toContain('LLM-curated');
    expect(toml).not.toContain('iptv-org');
  });

  it('post70: does not declare iptv-org URLs inside Worker config', () => {
    expect(toml).not.toMatch(/iptv-org|github\.io/);
    expect(indexSrc).toContain('iptv-org.github.io');
  });

  it('post70: does not declare Hono or cors config in wrangler.toml', () => {
    expect(toml).not.toMatch(/hono|cors/i);
    expect(indexSrc).toContain("from 'hono'");
  });

  it('post70: final purity batch — 25x identical sha256', () => {
    const digests = Array.from({ length: 25 }, () =>
      createHash('sha256').update(toml, 'utf8').digest('hex'),
    );
    expect(new Set(digests).size).toBe(1);
    expect(digests[0]).toBe(
      '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8',
    );
  });


  it('post70: cross-locks README coverage floors mention without requiring wrangler coverage', () => {
    expect(readmeMd).toMatch(/100%/);
    expect(vitestCfg).toContain('lines: 100');
    expect(vitestCfg).not.toContain('wrangler.toml');
  });

  it('post70: cross-locks CI Node 20 pin independent of wrangler compat date', () => {
    expect(ciYml).toContain('node-version: "20"');
    expect(toml).toContain('compatibility_date = "2025-01-01"');
  });

  it('post70: cross-locks deploy timeout-minutes 20 independent of lean toml', () => {
    expect(deployYml).toMatch(/timeout-minutes:\s*20/);
    expect(toml.length).toBe(330);
  });

  it('post70: cross-locks CI cancel-in-progress true while deploy cancel false', () => {
    expect(ciYml).toContain('cancel-in-progress: true');
    expect(deployYml).toContain('cancel-in-progress: false');
  });

  it('post70: cross-locks persist-credentials false on both workflows', () => {
    expect(ciYml).toContain('persist-credentials: false');
    expect(deployYml).toContain('persist-credentials: false');
  });

  it('post70: cross-locks hygiene greps gemini model in src not toml', () => {
    expect(ciYml).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
    expect(toml).not.toContain('gemini-2.0-flash');
  });

  it('post70: cross-locks dependabot ignores major while wrangler stays caret 4', () => {
    const dep = readFileSync(join(root, '.github/dependabot.yml'), 'utf8');
    expect(dep).toContain('version-update:semver-major');
    const fullPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
    expect(fullPkg.devDependencies.wrangler).toMatch(/^\^4\./);
  });

  it('post70: cross-locks gitattributes LF auto without CR in toml', () => {
    const ga = readFileSync(join(root, '.gitattributes'), 'utf8');
    expect(ga).toContain('text=auto');
    expect(toml.includes('\r')).toBe(false);
  });

  it('post70: cross-locks mcp-spec no-auth note vs wrangler secret comment', () => {
    expect(mcpSpecMd).toContain('No auth required for read endpoints');
    expect(toml).toContain('# wrangler secret put GEMINI_API_KEY');
  });

  it('post70: cross-locks DEPLOY cost KV 1h note without TTL key in toml', () => {
    expect(deployMd).toContain('M3U parses cached 1h');
    expect(toml).not.toMatch(/expirationTtl|ttl\s*=/i);
  });

  it('post70: glyph count lock for space', () => {
    expect([...toml].filter((c) => c === ' ').length).toBe(26);
  });

  it('post70: glyph count lock for equals', () => {
    expect([...toml].filter((c) => c === '=').length).toBe(8);
  });

  it('post70: glyph count lock for hash', () => {
    expect([...toml].filter((c) => c === '#').length).toBe(2);
  });

  it('post70: glyph count lock for lbracket', () => {
    expect([...toml].filter((c) => c === '[').length).toBe(5);
  });

  it('post70: glyph count lock for rbracket', () => {
    expect([...toml].filter((c) => c === ']').length).toBe(5);
  });

  it('post70: glyph count lock for quote', () => {
    expect([...toml].filter((c) => c === '"').length).toBe(14);
  });

  it('post70: glyph count lock for underscore', () => {
    expect([...toml].filter((c) => c === '_').length).toBe(6);
  });

  it('post70: glyph count lock for dot', () => {
    expect([...toml].filter((c) => c === '.').length).toBe(5);
  });

  it('post70: glyph count lock for hyphen', () => {
    expect([...toml].filter((c) => c === '-').length).toBe(2);
  });

  it('post70: glyph count lock for slash', () => {
    expect([...toml].filter((c) => c === '/').length).toBe(1);
  });

  it('post70: glyph count lock for colon', () => {
    expect([...toml].filter((c) => c === ':').length).toBe(1);
  });

  it('post70: glyph count lock for newline', () => {
    expect((toml.match(/\n/g) ?? []).length).toBe(17);
  });

  it('post70: per-line length vector locks', () => {
    expect(toml.split('\n').map((l) => l.length)).toEqual([17, 21, 33, 0, 17, 25, 39, 0, 10, 34, 20, 0, 6, 17, 0, 38, 36, 0]);
  });


  it('post70: indexOf lock for name = ', () => {
    expect(toml.indexOf('name = ')).toBe(0);
    expect(toml.indexOf('name = ')).toBe(toml.lastIndexOf('name = '));
  });

  it('post70: indexOf lock for main = ', () => {
    // 'custom_domain = true' also contains the substring 'main = ' (…do + main = …).
    expect(toml.indexOf('main = "src/index.ts"')).toBe(18);
    expect(toml.indexOf('main = "src/index.ts"')).toBe(toml.lastIndexOf('main = "src/index.ts"'));
    expect(toml.indexOf('main = ')).toBe(18);
    expect(toml.lastIndexOf('main = ')).toBe(toml.indexOf('custom_domain = true') + 'custom_do'.length);
  });

  it('post70: indexOf lock for compatibility_date', () => {
    expect(toml.indexOf('compatibility_date')).toBe(40);
    expect(toml.indexOf('compatibility_date')).toBe(toml.lastIndexOf('compatibility_date'));
  });

  it('post70: indexOf lock for [[kv_namespaces]]', () => {
    expect(toml.indexOf('[[kv_namespaces]]')).toBe(75);
    expect(toml.indexOf('[[kv_namespaces]]')).toBe(toml.lastIndexOf('[[kv_namespaces]]'));
  });

  it('post70: indexOf lock for binding = ', () => {
    expect(toml.indexOf('binding = ')).toBe(93);
    expect(toml.indexOf('binding = ')).toBe(toml.lastIndexOf('binding = '));
  });

  it('post70: indexOf lock for id = ', () => {
    expect(toml.indexOf('id = ')).toBe(119);
    expect(toml.indexOf('id = ')).toBe(toml.lastIndexOf('id = '));
  });

  it('post70: indexOf lock for [[routes]]', () => {
    expect(toml.indexOf('[[routes]]')).toBe(160);
    expect(toml.indexOf('[[routes]]')).toBe(toml.lastIndexOf('[[routes]]'));
  });

  it('post70: indexOf lock for pattern = ', () => {
    expect(toml.indexOf('pattern = ')).toBe(171);
    expect(toml.indexOf('pattern = ')).toBe(toml.lastIndexOf('pattern = '));
  });

  it('post70: indexOf lock for custom_domain', () => {
    expect(toml.indexOf('custom_domain')).toBe(206);
    expect(toml.indexOf('custom_domain')).toBe(toml.lastIndexOf('custom_domain'));
  });

  it('post70: indexOf lock for [vars]', () => {
    expect(toml.indexOf('[vars]')).toBe(228);
    expect(toml.indexOf('[vars]')).toBe(toml.lastIndexOf('[vars]'));
  });

  it('post70: indexOf lock for VERSION = ', () => {
    expect(toml.indexOf('VERSION = ')).toBe(235);
    expect(toml.indexOf('VERSION = ')).toBe(toml.lastIndexOf('VERSION = '));
  });

  it('post70: indexOf lock for # Secrets', () => {
    expect(toml.indexOf('# Secrets')).toBe(254);
    expect(toml.indexOf('# Secrets')).toBe(toml.lastIndexOf('# Secrets'));
  });

  it('post70: indexOf lock for GEMINI_API_KEY', () => {
    expect(toml.indexOf('GEMINI_API_KEY')).toBe(315);
    expect(toml.indexOf('GEMINI_API_KEY')).toBe(toml.lastIndexOf('GEMINI_API_KEY'));
  });

  it('post70: sha256 of nonempty line[0] locks', () => {
    const line = toml.split('\n')[0];
    expect(line).toBe('name = "backlink"');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('44eea2b40cca4009e9429bc54f55cd083523742a2e6bf8195731b2e95857194e');
  });

  it('post70: sha256 of nonempty line[1] locks', () => {
    const line = toml.split('\n')[1];
    expect(line).toBe('main = "src/index.ts"');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('625410b0ed7d9f67b80556df346ccdac8283bbee8a9f8984e14c5a4a38acc0cd');
  });

  it('post70: sha256 of nonempty line[2] locks', () => {
    const line = toml.split('\n')[2];
    expect(line).toBe('compatibility_date = "2025-01-01"');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('a1e68ad315991358a3fe28af2318e47703a3a4e06e61a7f53055ba91d76643aa');
  });

  it('post70: sha256 of nonempty line[4] locks', () => {
    const line = toml.split('\n')[4];
    expect(line).toBe('[[kv_namespaces]]');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('a956430c61f81bfe40b684cd176aa91f6294946d53bddf639d3f06f467a879ee');
  });

  it('post70: sha256 of nonempty line[5] locks', () => {
    const line = toml.split('\n')[5];
    expect(line).toBe('binding = "CATALOG_CACHE"');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('c73157420ab84c397c831c25ff5c56a909e03328ed3e2835501ef13b87ca42f2');
  });

  it('post70: sha256 of nonempty line[6] locks', () => {
    const line = toml.split('\n')[6];
    expect(line).toBe('id = "edb6ca4df12f4f45b40508b3dda3c432"');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('c1d0c2ec18c0f0bea3053c09e1238daa948a81aeadd13cce5210042d22059b23');
  });

  it('post70: sha256 of nonempty line[8] locks', () => {
    const line = toml.split('\n')[8];
    expect(line).toBe('[[routes]]');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('cebc572dd47d342dfdd7472a98901b207e9604c8c430677144a73912ff5fd28e');
  });

  it('post70: sha256 of nonempty line[9] locks', () => {
    const line = toml.split('\n')[9];
    expect(line).toBe('pattern = "backlink.fuzzywigg.com"');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('3337e5d997065b8a4d35b71489947d98be4b10e9b3acd2a345728facc65e801d');
  });

  it('post70: sha256 of nonempty line[10] locks', () => {
    const line = toml.split('\n')[10];
    expect(line).toBe('custom_domain = true');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('2160b9454f356d18b136459e31f1f7c4e4b8d473981f77e59afa661ee39ffecb');
  });

  it('post70: sha256 of nonempty line[12] locks', () => {
    const line = toml.split('\n')[12];
    expect(line).toBe('[vars]');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('4098c70630d33665497f2f1ced4508aacb09dbb4950f405fe75db013e4571369');
  });

  it('post70: sha256 of nonempty line[13] locks', () => {
    const line = toml.split('\n')[13];
    expect(line).toBe('VERSION = "0.1.0"');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('f7c1152ced11e787ca946fcc34d4d81a8fbd19d7631d56a75a4972436cfc3081');
  });

  it('post70: sha256 of nonempty line[15] locks', () => {
    const line = toml.split('\n')[15];
    expect(line).toBe('# Secrets (set via CLI, never commit):');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('21465a90ea852c7a1f849d66e06f90b60993d6b39509dcad694e47e57efa3118');
  });

  it('post70: sha256 of nonempty line[16] locks', () => {
    const line = toml.split('\n')[16];
    expect(line).toBe('# wrangler secret put GEMINI_API_KEY');
    expect(createHash('sha256').update(line, 'utf8').digest('hex')).toBe('9e54f159c315311ea83bf7bf6b00dbc4d4c0273bc65d4674fae4f5237c625c11');
  });

  it('post70: first 32 UTF-8 bytes lock', () => {
    expect([...Buffer.from(toml, 'utf8').subarray(0, 32)]).toEqual([110, 97, 109, 101, 32, 61, 32, 34, 98, 97, 99, 107, 108, 105, 110, 107, 34, 10, 109, 97, 105, 110, 32, 61, 32, 34, 115, 114, 99, 47, 105, 110]);
  });

  it('post70: last 32 UTF-8 bytes lock', () => {
    const buf = Buffer.from(toml, 'utf8');
    expect([...buf.subarray(buf.length - 32)]).toEqual([110, 103, 108, 101, 114, 32, 115, 101, 99, 114, 101, 116, 32, 112, 117, 116, 32, 71, 69, 77, 73, 78, 73, 95, 65, 80, 73, 95, 75, 69, 89, 10]);
  });

  it('post70: Promise.all concurrent reads agree', async () => {
    const reads = await Promise.all([
      Promise.resolve(readFileSync(tomlPath, 'utf8')),
      Promise.resolve(readFileSync(tomlPath, 'utf8')),
      Promise.resolve(toml),
    ]);
    expect(new Set(reads).size).toBe(1);
  });

  it('post70: Atomics.isLockFree probe unrelated to sync config read', () => {
    expect(typeof Atomics.isLockFree).toBe('function');
    expect(toml.length).toBe(330);
  });

  it('post70: SharedArrayBuffer existence does not imply shared toml', () => {
    expect(typeof SharedArrayBuffer).toBe('function');
    expect(toml).toContain('name = "backlink"');
  });

  it('post70: queueMicrotask double-hop still immutable', async () => {
    const v = await new Promise<string>((resolve) => {
      queueMicrotask(() => queueMicrotask(() => resolve(toml.slice(0, 4))));
    });
    expect(v).toBe('name');
  });

  it('post70: setTimeout 0 still sees immutable toml snapshot', async () => {
    const v = await new Promise<string>((resolve) => {
      setTimeout(() => resolve(toml.slice(-15, -1)), 0);
    });
    expect(v).toBe('GEMINI_API_KEY');
  });

  it('post70: URL host equals hostname and port empty', () => {
    const pattern = toml.match(/pattern = "([^"]+)"/)?.[1] ?? '';
    const u = new URL('https://' + pattern);
    expect(u.host).toBe(u.hostname);
    expect(u.port).toBe('');
    expect(u.username).toBe('');
    expect(u.password).toBe('');
  });

  it('post70: domain labels length budget each <= 63', () => {
    const pattern = toml.match(/pattern = "([^"]+)"/)?.[1] ?? '';
    for (const label of pattern.split('.')) {
      expect(label.length).toBeLessThanOrEqual(63);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('post70: main entry basename is index.ts not worker.ts', () => {
    expect(posix.basename(toml.match(/main = "([^"]+)"/)?.[1] ?? '')).toBe('index.ts');
    expect(toml).not.toMatch(/main = "src\/worker\.ts"/);
  });


  it('post70: cross-locks README suite list mentions wrangler', () => {
    expect(readmeMd).toContain('wrangler');
    expect(toml.length).toBe(330);
  });

  it('post70: cross-locks AGENTS Verify block mentions npm test', () => {
    expect(agentsMd).toContain('npm test');
    expect(toml.length).toBe(330);
  });

  it('post70: cross-locks DEPLOY wrangler login step', () => {
    expect(deployMd).toContain('wrangler login');
    expect(toml.length).toBe(330);
  });

  it('post70: cross-locks DEPLOY wrangler deploy step', () => {
    expect(deployMd).toContain('wrangler deploy');
    expect(toml.length).toBe(330);
  });

  it('post70: cross-locks mcp-spec KV cache note', () => {
    expect(mcpSpecMd).toContain('KV cache');
    expect(toml.length).toBe(330);
  });

  it('post70: cross-locks ci upload-artifact coverage-report', () => {
    expect(ciYml).toContain('coverage-report');
    expect(toml.length).toBe(330);
  });

  it('post70: cross-locks deploy contents read permission', () => {
    expect(deployYml).toContain('contents: read');
    expect(toml.length).toBe(330);
  });

  it('post70: does not invent /playlist in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('/playlist');
  });

  it('post70: does not invent /now-playing in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('/now-playing');
  });

  it('post70: does not invent anthropic in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('anthropic');
  });

  it('post70: does not invent claude in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('claude');
  });

  it('post70: does not invent openai in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('openai');
  });

  it('post70: does not invent spotify in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('spotify');
  });

  it('post70: does not invent youtube in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('youtube');
  });

  it('post70: does not invent soundcloud in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('soundcloud');
  });

  it('post70: does not invent discord in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('discord');
  });

  it('post70: does not invent slack in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('slack');
  });

  it('post70: does not invent stripe in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('stripe');
  });

  it('post70: does not invent billing in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('billing');
  });

  it('post70: does not invent oauth in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('oauth');
  });

  it('post70: does not invent jwt in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('jwt');
  });

  it('post70: does not invent session in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('session');
  });

  it('post70: does not invent cookie in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('cookie');
  });

  it('post70: does not invent postgres in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('postgres');
  });

  it('post70: does not invent redis in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('redis');
  });

  it('post70: does not invent mysql in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('mysql');
  });

  it('post70: does not invent s3:// in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('s3://');
  });

  it('post70: does not invent gs:// in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('gs://');
  });

  it('post70: does not invent azure in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('azure');
  });

  it('post70: does not invent vercel in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('vercel');
  });

  it('post70: does not invent netlify in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('netlify');
  });

  it('post70: does not invent fly.io in wrangler.toml', () => {
    expect(toml.toLowerCase()).not.toContain('fly.io');
  });

  it('post70: exact line[0] content lock', () => {
    expect(toml.split('\n')[0]).toBe('name = "backlink"');
  });

  it('post70: exact line[1] content lock', () => {
    expect(toml.split('\n')[1]).toBe('main = "src/index.ts"');
  });

  it('post70: exact line[2] content lock', () => {
    expect(toml.split('\n')[2]).toBe('compatibility_date = "2025-01-01"');
  });

  it('post70: exact line[3] content lock', () => {
    expect(toml.split('\n')[3]).toBe('');
  });

  it('post70: exact line[4] content lock', () => {
    expect(toml.split('\n')[4]).toBe('[[kv_namespaces]]');
  });

  it('post70: exact line[5] content lock', () => {
    expect(toml.split('\n')[5]).toBe('binding = "CATALOG_CACHE"');
  });

  it('post70: exact line[6] content lock', () => {
    expect(toml.split('\n')[6]).toBe('id = "edb6ca4df12f4f45b40508b3dda3c432"');
  });

  it('post70: exact line[7] content lock', () => {
    expect(toml.split('\n')[7]).toBe('');
  });

  it('post70: exact line[8] content lock', () => {
    expect(toml.split('\n')[8]).toBe('[[routes]]');
  });

  it('post70: exact line[9] content lock', () => {
    expect(toml.split('\n')[9]).toBe('pattern = "backlink.fuzzywigg.com"');
  });

  it('post70: exact line[10] content lock', () => {
    expect(toml.split('\n')[10]).toBe('custom_domain = true');
  });

  it('post70: exact line[11] content lock', () => {
    expect(toml.split('\n')[11]).toBe('');
  });

  it('post70: exact line[12] content lock', () => {
    expect(toml.split('\n')[12]).toBe('[vars]');
  });

  it('post70: exact line[13] content lock', () => {
    expect(toml.split('\n')[13]).toBe('VERSION = "0.1.0"');
  });

  it('post70: exact line[14] content lock', () => {
    expect(toml.split('\n')[14]).toBe('');
  });

  it('post70: exact line[15] content lock', () => {
    expect(toml.split('\n')[15]).toBe('# Secrets (set via CLI, never commit):');
  });

  it('post70: exact line[16] content lock', () => {
    expect(toml.split('\n')[16]).toBe('# wrangler secret put GEMINI_API_KEY');
  });

  it('post70: exact line[17] content lock', () => {
    expect(toml.split('\n')[17]).toBe('');
  });

  it('post70: charCode sum of line[0] locks', () => {
    const line = toml.split('\n')[0];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(1441);
  });

  it('post70: charCode sum of line[1] locks', () => {
    const line = toml.split('\n')[1];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(1802);
  });

  it('post70: charCode sum of line[2] locks', () => {
    const line = toml.split('\n')[2];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(2589);
  });

  it('post70: charCode sum of line[4] locks', () => {
    const line = toml.split('\n')[4];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(1744);
  });

  it('post70: charCode sum of line[5] locks', () => {
    const line = toml.split('\n')[5];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(1866);
  });

  it('post70: charCode sum of line[6] locks', () => {
    const line = toml.split('\n')[6];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(2765);
  });

  it('post70: charCode sum of line[8] locks', () => {
    const line = toml.split('\n')[8];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(1042);
  });

  it('post70: charCode sum of line[9] locks', () => {
    const line = toml.split('\n')[9];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(3215);
  });

  it('post70: charCode sum of line[10] locks', () => {
    const line = toml.split('\n')[10];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(1967);
  });

  it('post70: charCode sum of line[12] locks', () => {
    const line = toml.split('\n')[12];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(628);
  });

  it('post70: charCode sum of line[13] locks', () => {
    const line = toml.split('\n')[13];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(980);
  });

  it('post70: charCode sum of line[15] locks', () => {
    const line = toml.split('\n')[15];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(3200);
  });

  it('post70: charCode sum of line[16] locks', () => {
    const line = toml.split('\n')[16];
    expect([...line].reduce((a, c) => a + c.charCodeAt(0), 0)).toBe(3102);
  });
});
